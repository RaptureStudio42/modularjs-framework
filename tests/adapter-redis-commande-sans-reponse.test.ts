// Ce que ce test garantit : le mini-client Redis de MJS WS (RedisConnection) ne garde pas, pour toujours, une commande qui ne reçoit
// jamais de réponse. Redis répond dans l'ordre des requêtes : une commande restée sans réponse (serveur gelé, réseau coupé à moitié,
// socket qui reste ouvert) restait dans la liste d'attente tant que le socket vivait, et sous un Redis muet cette liste grossissait
// d'une entrée par commande, sans fin (l'adaptateur de sauvegarde du serveur de jeu, qui retente une écriture toutes les 30 s par
// partie, en laissait une de plus à chaque tentative). Désormais chaque commande a 30 s : passé ce délai, l'ordre des réponses n'est
// plus sûr, la connexion est fermée, toutes les commandes en attente échouent avec une erreur qui dit le silence, puis la reconnexion
// à backoff reprend comme après une coupure. Une commande qui répond à temps n'est pas touchée, et la minuterie d'une commande réglée
// est retirée (jamais une minuterie périmée qui fermerait la connexion suivante). Les minuteries sont simulées : aucune vraie attente
// de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { EventEmitter } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { RedisAdapter, RedisConnection, encodeCommand } from '../src/mjs-ws/adapter-redis.js'
import { createPersistEngine, RedisPersistAdapter, resolvePersistOption } from '../src/mjs-server/index.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

// un faux socket : il garde ce qu'on lui écrit et ne répond à rien — un Redis qui a accepté la connexion puis s'est tu. destroy() ferme
// comme un vrai socket : l'événement 'close' arrive juste après l'appel, jamais dedans
class FauxSocket extends EventEmitter {
  ecrits: string[] = []
  detruit          = false
  write(data: string): boolean { this.ecrits.push(data); return true }
  destroy(): void { if (this.detruit) return; this.detruit = true; setImmediate(() => this.emit('close')) }
}

// la connexion à tester, câblée sur de faux sockets : chaque connexion ouverte (la 1re comme chaque reconnexion) est rangée dans
// `sockets` et se connecte aussitôt
function redisMuet(opts: Record<string, unknown> = {}) {
  const sockets: FauxSocket[] = []
  const logs                  = [] as Array<{ niveau: string; msg: string }>
  const conn: any             = new RedisConnection({
    host: 'x', port: 1, role: 'command', onConnected: () => {},
    onLog: (niveau: string, msg: string) => { logs.push({ niveau, msg }) },
    dial: () => { const socket = new FauxSocket(); sockets.push(socket); setImmediate(() => socket.emit('connect')); return socket as any },
    ...opts,
  })
  return { conn, sockets, logs }
}

// ce que devient une promesse : on la regarde sans l'attendre
function suivre(promesse: Promise<unknown>) {
  const sort = { etat: 'en attente', valeur: undefined as unknown, message: '' }
  promesse.then(valeur => { sort.etat = 'résolue'; sort.valeur = valeur }, (err: Error) => { sort.etat = 'rejetée'; sort.message = err.message })
  return sort
}

// l'avertissement du journal : il dit que Redis ne répond plus, le délai et combien de commandes sont restées sans réponse
const silences = (logs: Array<{ niveau: string; msg: string }>) => logs.filter(l => l.niveau === 'warn' && /ne répond plus/.test(l.msg))

describe('adapter-redis — une commande sans réponse ne reste pas en attente pour toujours', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('vingt minutes de silence : la liste des commandes en attente ne grossit pas d\'une entrée par commande', async () => {
    const { conn } = redisMuet()
    conn.connect()
    await laisse()                           // la connexion est ouverte, aucune réponse ne viendra
    for (let s = 0; s < 1200; s += 5) { void conn.send(['PUBLISH', 'canal', 'x']).catch(() => {}); await avance(5000) }
    const enAttente = conn._pending.length + conn._readyWaiters.length
    assert.ok(enAttente <= 8, `${enAttente} commandes en attente après vingt minutes de silence (une envoyée toutes les 5 s) : la liste ne doit garder que celles des dernières 30 s`)
    conn.stop()
  })

  it('une commande sans réponse au bout de 30 s : la connexion est fermée et la commande échoue avec un message qui dit le silence', async () => {
    const { conn, sockets } = redisMuet()
    conn.connect()
    await laisse()
    const sort = suivre(conn.send(['PING']))
    await avance(DELAI - 1)
    assert.equal(sort.etat, 'en attente', 'trop tôt : la réponse peut encore arriver')
    assert.equal(sockets[0].detruit, false, 'la connexion reste ouverte tant que la réponse peut arriver')

    await avance(1)
    assert.equal(sort.etat, 'rejetée', 'passé 30 s, la commande doit échouer')
    assert.match(sort.message, /sans réponse/, 'le message dit que la commande est restée sans réponse')
    assert.match(sort.message, /30 s/, 'le message donne le délai')
    assert.match(sort.message, /ordre des réponses/, 'le message dit pourquoi la connexion est fermée')
    assert.equal(sockets[0].detruit, true, 'la connexion est fermée')
    assert.equal(conn._pending.length, 0, 'plus aucune commande en attente')
    conn.stop()
  })

  it('toutes les commandes en attente échouent ensemble, avec le même message, et un seul avertissement les compte', async () => {
    const { conn, logs } = redisMuet()
    conn.connect()
    await laisse()
    const premiere = suivre(conn.send(['INCR', 'a']))
    await avance(10000)
    const deuxieme = suivre(conn.send(['INCR', 'b']))
    await avance(10000)
    const troisieme = suivre(conn.send(['INCR', 'c']))
    await avance(9999)                       // 29,999 s depuis la première commande
    assert.deepEqual([premiere.etat, deuxieme.etat, troisieme.etat], ['en attente', 'en attente', 'en attente'], 'trop tôt : aucune n\'a échoué')

    await avance(1)                          // la première atteint 30 s : l'ordre des réponses n'est plus sûr pour les trois
    assert.deepEqual([premiere.etat, deuxieme.etat, troisieme.etat], ['rejetée', 'rejetée', 'rejetée'], 'les trois échouent en même temps, pas 10 et 20 s plus tard')
    assert.equal(deuxieme.message, premiere.message, 'même message pour la deuxième')
    assert.equal(troisieme.message, premiere.message, 'même message pour la troisième')
    assert.equal(silences(logs).length, 1, `un seul avertissement : ${JSON.stringify(logs)}`)
    assert.match(silences(logs)[0].msg, /(^|\D)3 commande/, 'l\'avertissement compte les trois commandes')
    assert.match(silences(logs)[0].msg, /30 s/, 'l\'avertissement donne le délai')
    conn.stop()
  })

  it('la reconnexion existante reprend : après son délai (1 s) une nouvelle connexion s\'ouvre, et une commande y reçoit sa réponse', async () => {
    const { conn, sockets } = redisMuet()
    conn.connect()
    await laisse()
    void conn.send(['PING']).catch(() => {})
    await avance(DELAI)                      // la commande échoue, la connexion est fermée, la reconnexion est programmée
    assert.equal(sockets.length, 1, 'pas de nouvelle connexion avant le délai de reconnexion')
    await avance(999)
    assert.equal(sockets.length, 1, 'toujours pas, 999 ms après la fermeture')
    await avance(1)
    assert.equal(sockets.length, 2, 'la reconnexion est ouverte au bout de 1 s')

    const reponse = suivre(conn.send(['PING']))
    await laisse()
    assert.deepEqual(sockets[1].ecrits, [encodeCommand(['PING'])], 'la commande part sur la nouvelle connexion')
    sockets[1].emit('data', Buffer.from('+PONG\r\n'))
    await laisse()
    assert.equal(reponse.etat, 'résolue', 'la commande a reçu sa réponse')
    assert.equal(reponse.valeur, 'PONG')
    conn.stop()
  })

  it('une commande qui répond à 29 s n\'est pas touchée : aucune fermeture, aucun avertissement, même longtemps après (témoin : vert aussi sans la borne)', async () => {
    const { conn, sockets, logs } = redisMuet()
    conn.connect()
    await laisse()
    const sort = suivre(conn.send(['PING']))
    await avance(DELAI - 1000)
    assert.equal(sort.etat, 'en attente', 'sanity : la réponse n\'est pas encore arrivée')
    sockets[0].emit('data', Buffer.from('+PONG\r\n'))
    await laisse()
    assert.equal(sort.etat, 'résolue', 'la commande a reçu sa réponse à 29 s')

    await avance(DELAI * 2)                  // bien au-delà des 30 s de son départ : sa minuterie doit être retirée
    assert.equal(sockets[0].detruit, false, 'la connexion n\'est pas fermée par une minuterie oubliée')
    assert.equal(sockets.length, 1, 'aucune reconnexion')
    assert.deepEqual(logs, [], 'rien dans le journal')
    conn.stop()
  })

  it('une coupure normale retire les minuteries : la commande perdue ne ferme pas, 30 s plus tard, la connexion qui a pris le relais (témoin : vert aussi sans la borne)', async () => {
    const { conn, sockets, logs } = redisMuet()
    conn.connect()
    await laisse()
    const sort = suivre(conn.send(['PING']))
    await avance(10000)
    sockets[0].destroy()                     // le serveur coupe la connexion
    await laisse()
    assert.equal(sort.etat, 'rejetée', 'la commande perdue échoue à la coupure')
    assert.match(sort.message, /perdue/, 'avec le message de la coupure, pas celui du silence')
    await avance(1000)
    assert.equal(sockets.length, 2, 'sanity : la connexion a repris le relais')

    await avance(DELAI)                      // bien au-delà des 30 s de la commande perdue
    assert.equal(sockets[1].detruit, false, 'la nouvelle connexion n\'est pas fermée par la minuterie de la commande perdue')
    assert.deepEqual(silences(logs), [], 'aucun avertissement de silence')
    conn.stop()
  })

  it('stop() retire les minuteries des commandes en attente : elles échouent comme avant (adaptateur arrêté) et rien ne sonne ensuite (témoin : vert aussi sans la borne)', async () => {
    const { conn, sockets, logs } = redisMuet()
    conn.connect()
    await laisse()
    const sort = suivre(conn.send(['PING']))
    await avance(5000)
    conn.stop()
    await laisse()
    assert.equal(sort.etat, 'rejetée', 'la commande en attente échoue à l\'arrêt')
    assert.match(sort.message, /arrêté/, 'avec le message de l\'arrêt')

    await avance(DELAI * 2)
    assert.equal(sockets.length, 1, 'aucune reconnexion après l\'arrêt')
    assert.deepEqual(logs, [], 'rien dans le journal : aucune minuterie n\'a sonné')
  })

  it('aucune minuterie de commande ne reste armée derrière une commande réglée, quelle que soit la façon : réponse, coupure, délai ou arrêt', async () => {
    const armees   = new Set<unknown>()
    const retirees = new Set<unknown>()
    const sonnees  = new Set<unknown>()
    const armer    = globalThis.setTimeout
    const retirer  = globalThis.clearTimeout
    globalThis.setTimeout   = ((fn: any, ms: any, ...args: any[]) => { const h = armer(() => { sonnees.add(h); fn() }, ms, ...args); if (ms === DELAI) armees.add(h); return h }) as any
    globalThis.clearTimeout = ((h: any) => { retirees.add(h); return retirer(h) }) as any
    const restantes = () => Array.from(armees).filter(h => !retirees.has(h) && !sonnees.has(h)).length
    try {
      const { conn, sockets } = redisMuet()
      conn.connect()
      await laisse()
      void conn.send(['PING']).catch(() => {})
      await laisse()
      assert.equal(restantes(), 1, 'sanity : une commande en attente a sa minuterie')
      sockets[0].emit('data', Buffer.from('+PONG\r\n'))
      await laisse()
      assert.equal(restantes(), 0, 'réponse : la minuterie est retirée')

      void conn.send(['PING']).catch(() => {})
      await laisse()
      sockets[0].destroy()                   // coupure
      await laisse()
      assert.equal(restantes(), 0, 'coupure : la minuterie est retirée')

      await avance(1000)                     // la reconnexion ouvre le deuxième socket
      void conn.send(['PING']).catch(() => {})
      await laisse()
      assert.equal(restantes(), 1, 'sanity : la commande de la nouvelle connexion a sa minuterie')
      await avance(DELAI)                    // délai : la minuterie sonne, elle n'a plus rien à retirer
      assert.equal(restantes(), 0, 'délai : plus aucune minuterie armée')

      await avance(1000)                     // la reconnexion ouvre le troisième socket
      void conn.send(['PING']).catch(() => {})
      await laisse()
      assert.equal(restantes(), 1, 'sanity : une dernière commande en attente')
      conn.stop()
      await laisse()
      assert.equal(restantes(), 0, 'arrêt : la minuterie est retirée')
    } finally { globalThis.setTimeout = armer; globalThis.clearTimeout = retirer }
  })

  it('AUTH sans réponse : la commande qui attendait la connexion échoue au bout de 30 s avec un message qui dit le silence, et la reconnexion repart', async () => {
    const auth = encodeCommand(['AUTH', 'secret'])
    const { conn, sockets } = redisMuet({ password: 'secret' })
    conn.connect()
    const sort = suivre(conn.send(['PING']))   // attend AUTH avant de partir
    await laisse()
    assert.deepEqual(sockets[0].ecrits, [auth], 'sanity : seul AUTH est parti')

    await avance(DELAI - 1)
    assert.equal(sort.etat, 'en attente', 'trop tôt : AUTH peut encore répondre')
    await avance(1)
    assert.equal(sort.etat, 'rejetée', 'passé 30 s, la commande en attente échoue')
    assert.match(sort.message, /sans réponse/, 'le message dit le silence')
    assert.equal(sockets[0].detruit, true, 'la connexion est fermée')
    assert.deepEqual(sockets[0].ecrits, [auth], 'le PING n\'est jamais parti sur une connexion sans AUTH')

    await avance(1000)
    assert.equal(sockets.length, 2, 'la reconnexion repart')
    assert.deepEqual(sockets[1].ecrits, [auth], 'et recommence par AUTH')
    conn.stop()
  })

  it('connexion abonnée : un SUBSCRIBE sans accusé au bout de 30 s ferme la connexion, et la reconnexion repose l\'abonnement', async () => {
    const subscribe = encodeCommand(['SUBSCRIBE', 'notifs'])
    const { conn, sockets } = redisMuet({ role: 'subscriber', onConnected: () => { void conn.send(['SUBSCRIBE', 'notifs']).catch(() => {}) } })
    conn.connect()
    await laisse()
    assert.deepEqual(sockets[0].ecrits, [subscribe], 'sanity : SUBSCRIBE est parti, aucun accusé ne vient')

    await avance(DELAI - 1)
    assert.equal(sockets[0].detruit, false, 'trop tôt : l\'accusé peut encore arriver')
    await avance(1)
    assert.equal(sockets[0].detruit, true, 'passé 30 s, la connexion abonnée est fermée')
    await avance(1000)
    assert.equal(sockets.length, 2, 'la reconnexion repart')
    assert.deepEqual(sockets[1].ecrits, [subscribe], 'l\'abonnement est reposé sur la nouvelle connexion')

    sockets[1].emit('data', Buffer.from(encodeCommand(['subscribe', 'notifs', 1])))   // l'accusé arrive cette fois
    await laisse()
    assert.equal(conn._pending.length, 0, 'l\'accusé règle la commande')
    await avance(DELAI * 2)
    assert.equal(sockets[1].detruit, false, 'la connexion accusée n\'est pas fermée par une minuterie oubliée')
    conn.stop()
  })
})

describe('adapter-redis — le serveur de jeu sur un Redis muet : ni la connexion ni l\'adaptateur ne retiennent une entrée par tentative', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('vingt minutes de panne muette : la liste de la connexion Redis ne grossit pas d\'une commande par tentative abandonnée du moteur', async () => {
    const adapter: any = new RedisPersistAdapter({ host: '127.0.0.1', port: 1, onLog: () => {} })
    adapter._conn      = redisMuet({ onConnected: () => { const file = adapter._ready.splice(0); for (const reveille of file) reveille() } }).conn
    const engine       = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, () => {})!
    const game         = partie('g-panne')
    engine.armGame(game)
    for (let s = 0; s < 1200; s += 5) { mute(game, s); await avance(5000) }
    const enAttente = adapter._conn._pending.length
    assert.ok(enAttente <= 2, `${enAttente} commandes en attente dans la connexion après vingt minutes de panne (une tentative abandonnée toutes les 30 s) : elle ne doit garder que la commande en cours`)
    assert.ok(adapter._inFlight.size <= 2, `${adapter._inFlight.size} écritures suivies par l'adaptateur : la liste ne doit retenir que celle en cours`)
    adapter._conn.stop()
  })

  it('load() au démarrage : un Redis muet ne gèle plus le démarrage, la lecture échoue au bout de 30 s et le serveur démarre sans restauration', async () => {
    const warns        = [] as string[]
    const adapter: any = new RedisPersistAdapter({ host: '127.0.0.1', port: 1, onLog: (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) } })
    adapter._conn      = redisMuet({ onConnected: () => { const file = adapter._ready.splice(0); for (const reveille of file) reveille() } }).conn
    let resultat: unknown = 'en attente'
    void adapter.load().then((lues: unknown) => { resultat = lues })
    await laisse()                           // la connexion est ouverte, HGETALL est parti et ne reçoit jamais de réponse
    await avance(DELAI - 1)
    assert.equal(resultat, 'en attente', 'trop tôt : la réponse peut encore arriver')
    await avance(1)
    assert.deepEqual(resultat, [], 'passé 30 s, load() rend la main : démarrage sans restauration')
    assert.ok(warns.some(w => /load\(\) a échoué/.test(w)), `un avertissement dit que la lecture a échoué : ${JSON.stringify(warns)}`)
    adapter._conn.stop()
  })
})

// attend, en temps réel, qu'une condition devienne vraie — les sockets de ce banc sont de vrais sockets, les minuteries seules sont simulées
async function attendre(condition: () => boolean, message: string) {
  const debut = performance.now()
  while (!condition()) {
    if (performance.now() - debut > 3000) assert.fail(message)
    await new Promise<void>(r => setImmediate(r))
  }
}

describe('adapter-redis — avec un vrai serveur qui accepte la connexion puis se tait', function () {
  this.timeout(15000)
  afterEach(() => { mock.timers.reset() })

  it('au bout de 30 s sans réponse, le client ferme la connexion (le serveur la voit se fermer) puis se reconnecte après le délai', async () => {
    const sockets: Socket[] = []
    const fermes            = new Set<Socket>()
    let muet                = false
    let commandeVue         = false
    const server: Server    = createServer((socket: Socket) => {
      sockets.push(socket)
      socket.on('data', (chunk: Buffer) => {
        const texte = chunk.toString('utf8')
        if (muet && texte.indexOf('PUBLISH') !== -1) commandeVue = true   // la commande arrive, aucune réponse ne repart
        if (!muet && texte.indexOf('PING') !== -1) socket.write('+PONG\r\n')
      })
      socket.on('close', () => { fermes.add(socket) })
      socket.on('error', () => {})
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as any).port
    const conn = new RedisConnection({ host: '127.0.0.1', port, role: 'command', onLog: () => {}, onConnected: () => {} })
    try {
      conn.connect()
      assert.equal(await conn.send(['PING']), 'PONG', 'sanity : la connexion répond tant que le serveur parle')
      muet = true
      mock.timers.enable({ apis: ['setTimeout'] })
      const sort = suivre(conn.send(['PUBLISH', 'canal', 'x']))
      await attendre(() => commandeVue, 'le serveur aurait dû recevoir la commande')
      assert.equal(sort.etat, 'en attente', 'sanity : la commande est en vol, sans réponse')

      await avance(DELAI)
      await attendre(() => fermes.has(sockets[0]), 'le client aurait dû fermer la connexion : le serveur ne l\'a pas vue se fermer 30 s après une commande sans réponse')
      assert.equal(sort.etat, 'rejetée', 'la commande échoue')
      assert.match(sort.message, /sans réponse/, 'avec un message qui dit le silence')
      await attendre(() => (conn as any)._socket === null, 'le client aurait dû constater la fermeture de sa connexion')

      await avance(1000)
      await attendre(() => sockets.length === 2, 'le client aurait dû se reconnecter au bout de 1 s')
      muet = false
      assert.equal(await conn.send(['PING']), 'PONG', 'la nouvelle connexion répond normalement')
    } finally {
      conn.stop()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('RedisAdapter.start() contre un serveur qui ne répond jamais au PING : le démarrage échoue au bout de 30 s au lieu de rester suspendu', async () => {
    const sockets: Socket[] = []
    let pingVu              = false
    const server: Server    = createServer((socket: Socket) => {
      sockets.push(socket)
      socket.on('data', (chunk: Buffer) => { if (chunk.toString('utf8').indexOf('PING') !== -1) pingVu = true })
      socket.on('error', () => {})
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port    = (server.address() as any).port
    const adapter = new RedisAdapter({ url: `redis://127.0.0.1:${port}`, onLog: () => {} })
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const demarrage = suivre(adapter.start())
      await attendre(() => pingVu, 'le serveur aurait dû recevoir le PING')
      await avance(DELAI - 1)
      assert.equal(demarrage.etat, 'en attente', 'trop tôt : le serveur peut encore répondre')
      await avance(1)
      assert.equal(demarrage.etat, 'rejetée', 'passé 30 s, start() doit échouer')
      assert.match(demarrage.message, /sans réponse/, 'avec un message qui dit le silence')
    } finally {
      await adapter.stop()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
