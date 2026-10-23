// Ce que ce test garantit : une connexion Redis de MJS WS (RedisConnection) qui n'arrive jamais à être prête ne retient pas, pour
// toujours, les commandes qui l'attendent. Une commande envoyée avant la fin de AUTH/SELECT attend dans une file que la connexion soit
// prête ; si le socket ne se connecte jamais (poignée de main TLS figée sous rediss://, qui n'a aucune borne, ou serveur qui n'accepte
// jamais), cette file grossissait d'une entrée par commande, sans fin (240 après vingt minutes), et RedisAdapter.start() restait
// suspendu sur son PING. Désormais une connexion a 30 s, comptées depuis son ouverture, pour devenir prête (connexion, poignée de main,
// AUTH et SELECT compris) : passé ce délai, elle est fermée, les commandes en attente échouent avec un message qui dit que la connexion
// n'est pas devenue prête, puis la reconnexion à backoff reprend. Une connexion qui devient prête à temps n'est pas touchée, et
// l'échéance de chaque connexion est retirée dès qu'elle est prête, fermée ou arrêtée (jamais une minuterie périmée qui fermerait la
// connexion suivante). Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { EventEmitter } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { RedisAdapter, RedisConnection, encodeCommand } from '../src/mjs-ws/adapter-redis.js'

const DELAY = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const settle  = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const advance = async (ms: number) => { mock.timers.tick(ms); await settle() }

// un faux socket : il garde ce qu'on lui écrit et ne dit rien de lui-même — c'est le test qui le fait parler. destroy() ferme comme un
// vrai socket : l'événement 'close' arrive juste après l'appel, jamais dedans
class FakeSocket extends EventEmitter {
  written: string[] = []
  destroyed         = false
  write(data: string): boolean { this.written.push(data); return true }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; setImmediate(() => this.emit('close')) }
}

// un faux socket qui ne signale jamais sa fermeture : destroy() ne fait rien d'autre que se souvenir de l'appel
class DeafSocket extends FakeSocket {
  destroy(): void { this.destroyed = true }
}

// la connexion à tester, câblée sur de faux sockets rangés dans `sockets` (le premier, puis un par reconnexion). Par défaut aucun ne se
// connecte jamais : poignée de main TLS figée, ou serveur qui n'accepte pas. `connects: true` les connecte aussitôt, `deaf: true` leur
// fait taire leur fermeture
function redis(opts: Record<string, unknown> = {}) {
  const { connects, deaf, ...rest } = opts
  const sockets: FakeSocket[]       = []
  const logs                        = [] as Array<{ level: string; msg: string }>
  const conn: any                   = new RedisConnection({
    host: 'x', port: 1, role: 'command', onConnected: () => {},
    onLog: (level: string, msg: string) => { logs.push({ level, msg }) },
    dial: () => { const socket = deaf ? new DeafSocket() : new FakeSocket(); sockets.push(socket); if (connects) setImmediate(() => socket.emit('connect')); return socket as any },
    ...rest,
  })
  return { conn, sockets, logs }
}

// ce que devient une promesse : on la regarde sans l'attendre
function follow(promise: Promise<unknown>) {
  const outcome = { state: 'en attente', value: undefined as unknown, message: '' }
  promise.then(value => { outcome.state = 'résolue'; outcome.value = value }, (err: Error) => { outcome.state = 'rejetée'; outcome.message = err.message })
  return outcome
}

// l'avertissement du journal : il dit que la connexion n'est pas prête, le délai et combien de commandes en attente ont été rejetées
const notReady = (logs: Array<{ level: string; msg: string }>) => logs.filter(l => l.level === 'warn' && /pas prête/.test(l.msg))

describe('adapter-redis — une connexion qui ne devient jamais prête ne retient pas pour toujours les commandes qui l\'attendent', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('vingt minutes sans que le socket se connecte jamais : la liste des commandes qui attendent la connexion ne grossit pas d\'une entrée par commande', async () => {
    const { conn } = redis()
    conn.connect()
    await settle()                           // le socket est ouvert, il ne se connectera jamais
    let most = 0
    for (let s = 0; s < 1200; s += 5) {
      void conn.send(['PUBLISH', 'canal', 'x']).catch(() => {})
      await advance(5000)
      most = Math.max(most, conn._readyWaiters.length)
    }
    assert.ok(most <= 9, `${most} commandes attendent la connexion au plus fort de ces vingt minutes (une envoyée toutes les 5 s) : la liste ne doit garder que celles des 40 dernières secondes, 30 s d'attente de la connexion puis 10 s avant la tentative suivante`)
    conn.stop()
  })

  it('une commande qui attend la connexion échoue 30 s après son ouverture avec un message qui dit que la connexion n\'est pas prête, et le socket est fermé', async () => {
    for (const role of ['command', 'subscriber']) {
      const { conn, sockets } = redis({ role })
      conn.connect()
      await settle()
      const outcome = follow(conn.send(['PING']))
      await advance(DELAY - 1)
      assert.equal(outcome.state, 'en attente', `${role} : trop tôt, la connexion peut encore s'établir`)
      assert.equal(sockets[0].destroyed, false, `${role} : le socket reste ouvert tant que la connexion peut encore s'établir`)

      await advance(1)
      assert.equal(outcome.state, 'rejetée', `${role} : passé 30 s sans connexion prête, la commande doit échouer`)
      assert.match(outcome.message, /pas prête/, `${role} : le message dit que la connexion n'est pas prête`)
      assert.match(outcome.message, /30 s/, `${role} : le message donne le délai`)
      assert.match(outcome.message, new RegExp(`\\(${role}\\)`), `${role} : le message nomme la connexion`)
      assert.equal(sockets[0].destroyed, true, `${role} : le socket est fermé`)
      assert.equal(conn._readyWaiters.length, 0, `${role} : plus aucune commande en attente`)
      conn.stop()
    }
  })

  it('trois commandes attendent : elles échouent ensemble, avec le même message, et un seul avertissement les compte', async () => {
    const { conn, logs } = redis()
    conn.connect()
    await settle()
    const first = follow(conn.send(['INCR', 'a']))
    await advance(10000)
    const second = follow(conn.send(['INCR', 'b']))
    await advance(10000)
    const third = follow(conn.send(['INCR', 'c']))
    await advance(9999)                      // 29,999 s depuis l'ouverture
    assert.deepEqual([first.state, second.state, third.state], ['en attente', 'en attente', 'en attente'], 'trop tôt : aucune n\'a échoué')

    await advance(1)                         // l'échéance de la connexion tombe : elle n'est pas prête, aucune des trois ne partira
    assert.deepEqual([first.state, second.state, third.state], ['rejetée', 'rejetée', 'rejetée'], 'les trois échouent en même temps, pas 10 et 20 s plus tard')
    assert.equal(second.message, first.message, 'même message pour la deuxième')
    assert.equal(third.message, first.message, 'même message pour la troisième')
    assert.equal(notReady(logs).length, 1, `un seul avertissement : ${JSON.stringify(logs)}`)
    assert.match(notReady(logs)[0].msg, /(^|\D)3 commande/, 'l\'avertissement compte les trois commandes')
    assert.match(notReady(logs)[0].msg, /30 s/, 'l\'avertissement donne le délai')
    conn.stop()
  })

  it('la reconnexion à backoff reprend, son délai s\'allonge tant que la connexion n\'est jamais prête (1 s, 2 s, 5 s), et une connexion prête sert à nouveau', async () => {
    const { conn, sockets } = redis()
    conn.connect()
    await settle()
    void conn.send(['PING']).catch(() => {})
    await advance(DELAY)                     // 1re échéance : le socket est fermé, la reconnexion est programmée
    assert.equal(sockets.length, 1, 'pas de nouvelle connexion avant le délai de reconnexion')
    await advance(999)
    assert.equal(sockets.length, 1, 'toujours pas, 999 ms après la fermeture')
    await advance(1)
    assert.equal(sockets.length, 2, 'la reconnexion est ouverte au bout de 1 s')

    await advance(DELAY)                     // 2e échéance : la nouvelle connexion n'est pas prête non plus
    assert.equal(sockets[1].destroyed, true, 'la nouvelle connexion a sa propre échéance de 30 s')
    await advance(1999)
    assert.equal(sockets.length, 2, 'la reconnexion suivante attend 2 s : la tentative précédente n\'a jamais abouti')
    await advance(1)
    assert.equal(sockets.length, 3, 'la deuxième reconnexion est ouverte au bout de 2 s')

    await advance(DELAY)                     // 3e échéance
    await advance(4999)
    assert.equal(sockets.length, 3, 'la reconnexion suivante attend 5 s')
    await advance(1)
    assert.equal(sockets.length, 4, 'la troisième reconnexion est ouverte au bout de 5 s')

    const reply = follow(conn.send(['PING']))
    sockets[3].emit('connect')               // cette fois la connexion s'établit
    await settle()
    assert.deepEqual(sockets[3].written, [encodeCommand(['PING'])], 'la commande part sur la connexion qui est prête')
    sockets[3].emit('data', Buffer.from('+PONG\r\n'))
    await settle()
    assert.equal(reply.state, 'résolue', 'la commande a reçu sa réponse')
    assert.equal(reply.value, 'PONG')
    conn.stop()
  })

  it('une connexion qui devient prête à 29 s n\'est pas fermée à 30 s : la commande qui attendait part et reçoit sa réponse, rien ne sonne ensuite (témoin : vert aussi sans l\'échéance)', async () => {
    const { conn, sockets, logs } = redis()
    conn.connect()
    await settle()
    const reply = follow(conn.send(['PING']))
    await advance(DELAY - 1000)
    assert.equal(reply.state, 'en attente', 'sanity : la connexion n\'est pas encore prête')
    sockets[0].emit('connect')               // la connexion s'établit à 29 s
    await settle()
    assert.deepEqual(sockets[0].written, [encodeCommand(['PING'])], 'la commande qui attendait part dès que la connexion est prête')
    sockets[0].emit('data', Buffer.from('+PONG\r\n'))
    await settle()
    assert.equal(reply.state, 'résolue', 'la commande a reçu sa réponse')

    await advance(DELAY * 2)                 // bien au-delà des 30 s de l'ouverture : l'échéance doit être retirée
    assert.equal(sockets[0].destroyed, false, 'la connexion prête n\'est pas fermée par une minuterie oubliée')
    assert.equal(sockets.length, 1, 'aucune reconnexion')
    assert.deepEqual(logs, [], 'rien dans le journal')
    conn.stop()
  })

  it('AUTH et SELECT qui répondent à 29 s : la connexion devient prête, la commande qui attendait part, et rien ne ferme la connexion ensuite (témoin : vert aussi sans l\'échéance)', async () => {
    const auth   = encodeCommand(['AUTH', 'secret'])
    const select = encodeCommand(['SELECT', '2'])
    const ping   = encodeCommand(['PING'])
    const { conn, sockets, logs } = redis({ connects: true, password: 'secret', db: 2 })
    conn.connect()
    const reply = follow(conn.send(['PING']))
    await settle()
    assert.deepEqual(sockets[0].written, [auth], 'sanity : seul AUTH est parti')
    await advance(DELAY - 1000)
    sockets[0].emit('data', Buffer.from('+OK\r\n'))   // AUTH répond à 29 s
    await settle()
    assert.deepEqual(sockets[0].written, [auth, select], 'SELECT part dès qu\'AUTH a répondu')
    sockets[0].emit('data', Buffer.from('+OK\r\n'))
    await settle()
    assert.deepEqual(sockets[0].written, [auth, select, ping], 'la commande qui attendait part une fois la connexion prête')
    sockets[0].emit('data', Buffer.from('+PONG\r\n'))
    await settle()
    assert.equal(reply.state, 'résolue', 'la commande a reçu sa réponse')

    await advance(DELAY * 2)
    assert.equal(sockets[0].destroyed, false, 'la connexion prête n\'est pas fermée par une minuterie oubliée')
    assert.equal(sockets.length, 1, 'aucune reconnexion')
    assert.deepEqual(logs, [], 'rien dans le journal')
    conn.stop()
  })

  it('AUTH sans réponse : les 30 s comptent depuis l\'ouverture de la connexion, pas depuis l\'envoi d\'AUTH — la commande qui attendait échoue, le socket est fermé, la reconnexion repart', async () => {
    const auth = encodeCommand(['AUTH', 'secret'])
    const { conn, sockets, logs } = redis({ password: 'secret' })
    conn.connect()
    await settle()
    const outcome = follow(conn.send(['PING']))   // attend AUTH avant de partir
    await advance(10000)
    sockets[0].emit('connect')               // le socket s'établit à 10 s : AUTH part, et ne reçoit aucune réponse
    await settle()
    assert.deepEqual(sockets[0].written, [auth], 'sanity : seul AUTH est parti')

    await advance(DELAY - 10000 - 1)         // 29,999 s depuis l'ouverture, 19,999 s depuis l'envoi d'AUTH
    assert.equal(outcome.state, 'en attente', 'trop tôt : la connexion peut encore devenir prête')
    await advance(1)
    assert.equal(outcome.state, 'rejetée', 'passé 30 s depuis l\'ouverture, la commande en attente échoue')
    assert.match(outcome.message, /pas prête/, 'le message dit que la connexion n\'est pas prête')
    assert.equal(sockets[0].destroyed, true, 'le socket est fermé')
    assert.deepEqual(sockets[0].written, [auth], 'le PING n\'est jamais parti sur une connexion sans AUTH')
    assert.ok(logs.some(l => /pas prête/.test(l.msg)), `le journal dit pourquoi : ${JSON.stringify(logs)}`)
    assert.ok(!logs.some(l => /authentification/.test(l.msg)), `un silence n'est pas rapporté comme une authentification en échec : ${JSON.stringify(logs)}`)
    assert.equal(notReady(logs).length, 1, `un seul avertissement : ${JSON.stringify(logs)}`)
    assert.match(notReady(logs)[0].msg, /(^|\D)1 commande/, 'l\'avertissement ne compte que la commande de l\'appelant, pas AUTH')

    await advance(1000)
    assert.equal(sockets.length, 2, 'la reconnexion repart')
    await advance(DELAY / 2)                 // la minuterie d'AUTH, retirée avec lui, ne ferme pas la nouvelle connexion (elle aurait sonné 10 s après l'échéance)
    assert.equal(sockets[1].destroyed, false, 'la nouvelle connexion n\'est pas fermée par la minuterie de l\'ancienne')
    conn.stop()
  })

  it('un socket fermé avant d\'être prêt : les commandes en attente échouent aussitôt, et l\'échéance de cette connexion ne ferme pas celle qui prend le relais, qui a la sienne', async () => {
    const { conn, sockets, logs } = redis()
    conn.connect()
    await settle()
    const outcome = follow(conn.send(['PING']))
    await advance(10000)
    sockets[0].destroy()                     // le serveur refuse ou coupe la connexion avant qu'elle soit prête
    await settle()
    assert.equal(outcome.state, 'rejetée', 'la commande en attente échoue à la coupure')
    assert.match(outcome.message, /perdue/, 'avec le message de la coupure, pas celui de l\'échéance')
    await advance(1000)
    assert.equal(sockets.length, 2, 'sanity : la reconnexion est ouverte à 11 s')

    await advance(20000)                     // 31 s : l'échéance de la 1re connexion aurait sonné à 30 s, 19 s après l'ouverture de la 2e
    assert.equal(sockets[1].destroyed, false, 'la nouvelle connexion n\'est pas fermée par l\'échéance de la précédente')
    assert.deepEqual(notReady(logs), [], 'aucun avertissement avant l\'échéance de la nouvelle connexion')
    await advance(10000)                     // 41 s : 30 s après l'ouverture de la 2e
    assert.equal(sockets[1].destroyed, true, 'la nouvelle connexion a sa propre échéance de 30 s, comptée depuis son ouverture')
    assert.equal(notReady(logs).length, 1, 'un avertissement, pour la nouvelle connexion')
    conn.stop()
  })

  it('stop() pendant l\'attente : les commandes échouent comme avant (adaptateur arrêté), rien ne sonne ensuite et aucune connexion ne se rouvre', async () => {
    const { conn, sockets, logs } = redis()
    conn.connect()
    await settle()
    const outcome = follow(conn.send(['PING']))
    await advance(5000)
    conn.stop()
    await settle()
    assert.equal(outcome.state, 'rejetée', 'la commande en attente échoue à l\'arrêt')
    assert.match(outcome.message, /arrêté/, 'avec le message de l\'arrêt')

    await advance(DELAY * 2)
    assert.equal(sockets.length, 1, 'aucune reconnexion après l\'arrêt')
    assert.deepEqual(logs, [], 'rien dans le journal : l\'échéance n\'a pas sonné')
  })

  it('stop() retire lui-même l\'échéance : il n\'attend pas que le socket signale sa fermeture, rien ne sonne ensuite même si elle ne vient jamais', async () => {
    const { conn, logs } = redis({ deaf: true })
    conn.connect()
    await settle()
    const outcome = follow(conn.send(['PING']))
    await advance(5000)
    conn.stop()                              // le socket ne dira jamais qu'il est fermé : seul stop() peut libérer l'échéance
    await settle()
    assert.equal(outcome.state, 'rejetée', 'la commande en attente échoue à l\'arrêt')

    await advance(DELAY * 2)
    assert.deepEqual(logs, [], 'rien dans le journal : l\'échéance a été retirée par stop() lui-même')
  })

  it('aucune minuterie d\'échéance ne reste armée derrière une connexion devenue prête, fermée, expirée ou arrêtée', async () => {
    const armed   = new Set<unknown>()
    const cleared = new Set<unknown>()
    const rung    = new Set<unknown>()
    const arm     = globalThis.setTimeout
    const clear   = globalThis.clearTimeout
    globalThis.setTimeout   = ((fn: any, ms: any, ...args: any[]) => { const h = arm(() => { rung.add(h); fn() }, ms, ...args); if (ms === DELAY) armed.add(h); return h }) as any
    globalThis.clearTimeout = ((h: any) => { cleared.add(h); return clear(h) }) as any
    const remaining = () => Array.from(armed).filter(h => !cleared.has(h) && !rung.has(h)).length
    try {
      const ready = redis({ connects: true })
      ready.conn.connect()
      assert.equal(remaining(), 1, 'sanity : une connexion qui vient de s\'ouvrir a son échéance')
      await settle()
      assert.equal(remaining(), 0, 'prête : l\'échéance est retirée')
      ready.conn.stop()
      await settle()

      const closed = redis()
      closed.conn.connect()
      assert.equal(remaining(), 1, 'sanity : la connexion suivante a son échéance')
      closed.sockets[0].destroy()            // coupure avant d'être prête
      await settle()
      assert.equal(remaining(), 0, 'fermée avant d\'être prête : l\'échéance est retirée')
      await advance(1000)                    // la reconnexion ouvre le deuxième socket
      assert.equal(remaining(), 1, 'sanity : la reconnexion a sa propre échéance')
      closed.conn.stop()
      await settle()
      assert.equal(remaining(), 0, 'arrêtée en attendant : l\'échéance est retirée')

      const expired = redis()
      expired.conn.connect()
      assert.equal(remaining(), 1, 'sanity : une dernière connexion a son échéance')
      await advance(DELAY)                   // l'échéance sonne : elle n'a plus rien à retirer
      assert.equal(remaining(), 0, 'expirée : plus aucune minuterie armée')
      expired.conn.stop()
      await settle()
      assert.equal(remaining(), 0, 'arrêtée après l\'échéance : rien ne reste')
    } finally { globalThis.setTimeout = arm; globalThis.clearTimeout = clear }
  })
})

// attend, en temps réel, qu'une condition devienne vraie — les sockets de ce banc sont de vrais sockets, les minuteries seules sont simulées
async function waitFor(condition: () => boolean, message: string) {
  const start = performance.now()
  while (!condition()) {
    if (performance.now() - start > 3000) assert.fail(message)
    await new Promise<void>(r => setImmediate(r))
  }
}

// un vrai serveur TCP qui accepte les connexions puis se tait : un client TLS lui envoie son ClientHello et n'obtient jamais de réponse,
// la poignée de main reste figée. `sockets` garde les connexions acceptées, `closed` celles que le client a refermées
async function silentServer() {
  const sockets: Socket[] = []
  const closed            = new Set<Socket>()
  const server: Server    = createServer((socket: Socket) => {
    sockets.push(socket)
    socket.on('data', () => {})
    socket.on('close', () => { closed.add(socket) })
    socket.on('error', () => {})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const port  = (server.address() as any).port
  const close = async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  return { sockets, closed, port, close }
}

describe('adapter-redis — avec un vrai serveur qui accepte la connexion TCP puis laisse la poignée de main TLS figée', function () {
  this.timeout(15000)
  afterEach(() => { mock.timers.reset() })

  it('au bout de 30 s sans connexion prête, la commande en attente échoue, le client ferme sa connexion (le serveur la voit se fermer) puis se reconnecte', async () => {
    const server = await silentServer()
    mock.timers.enable({ apis: ['setTimeout'] })
    const conn = new RedisConnection({ host: '127.0.0.1', port: server.port, tls: true, role: 'command', onLog: () => {}, onConnected: () => {} })
    try {
      conn.connect()
      const outcome = follow(conn.send(['PING']))
      await waitFor(() => server.sockets.length === 1, 'le serveur aurait dû accepter la connexion TCP')
      await advance(DELAY - 1)
      assert.equal(outcome.state, 'en attente', 'trop tôt : la poignée de main peut encore aboutir')
      assert.equal(server.closed.has(server.sockets[0]), false, 'trop tôt : la connexion reste ouverte')

      await advance(1)
      assert.equal(outcome.state, 'rejetée', 'passé 30 s, la commande qui attendait la connexion doit échouer')
      assert.match(outcome.message, /pas prête/, 'avec un message qui dit que la connexion n\'est pas prête')
      await waitFor(() => server.closed.has(server.sockets[0]), 'le client aurait dû fermer la connexion : le serveur ne l\'a pas vue se fermer 30 s après son ouverture')
      await waitFor(() => (conn as any)._socket === null, 'le client aurait dû constater la fermeture de sa connexion')

      await advance(1000)
      await waitFor(() => server.sockets.length === 2, 'le client aurait dû se reconnecter au bout de 1 s')
    } finally {
      conn.stop()
      await server.close()
    }
  })

  it('RedisAdapter.start() sur une poignée de main TLS figée : le démarrage échoue au bout de 30 s au lieu de rester suspendu sur son PING', async () => {
    const server  = await silentServer()
    const adapter = new RedisAdapter({ url: `rediss://127.0.0.1:${server.port}`, onLog: () => {} })
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const startup = follow(adapter.start())
      await waitFor(() => server.sockets.length === 2, 'le serveur aurait dû accepter les deux connexions (commandes et abonné)')
      await advance(DELAY - 1)
      assert.equal(startup.state, 'en attente', 'trop tôt : la poignée de main peut encore aboutir')
      await advance(1)
      assert.equal(startup.state, 'rejetée', 'passé 30 s, start() doit échouer')
      assert.match(startup.message, /pas prête/, 'avec un message qui dit que la connexion n\'est pas prête')
    } finally {
      await adapter.stop()
      await server.close()
    }
  })
})
