// Ce que ce test garantit, pour le mini-client Redis de MJS WS (RedisConnection) :
//   - chaque commande a son propre délai de 30 s, compté depuis son envoi : une commande envoyée pendant qu'une autre attend ne dépend pas
//     de la première (qui peut être réglée entre-temps) ; au délai, la liste des commandes en attente est vidée tout de suite, et
//     l'avertissement est écrit même pour une seule commande ;
//   - une poignée de main restée muette (AUTH sans réponse) est rapportée pour ce qu'elle est, un délai dépassé : le journal ne dit pas
//     « authentification en échec » (un mot de passe refusé, lui, le dit toujours).
// Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { EventEmitter } from 'node:events'
import { RedisConnection } from '../src/mjs-ws/adapter-redis.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }

// un faux socket qui ne répond à rien tant que le test ne lui fait pas émettre de données ; destroy() ferme comme un vrai socket
// (l'événement 'close' arrive juste après l'appel, jamais dedans)
class FauxSocket extends EventEmitter {
  ecrits: string[] = []
  detruit          = false
  write(data: string): boolean { this.ecrits.push(data); return true }
  destroy(): void { if (this.detruit) return; this.detruit = true; setImmediate(() => this.emit('close')) }
}

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

function suivre(promesse: Promise<unknown>) {
  const sort = { etat: 'en attente', message: '' }
  promesse.then(() => { sort.etat = 'résolue' }, (err: Error) => { sort.etat = 'rejetée'; sort.message = err.message })
  return sort
}

describe('adapter-redis — le délai de chaque commande, et la vraie cause d\'un silence', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('au délai, la liste des commandes en attente est vidée tout de suite, pas seulement quand la fermeture du socket arrive', async () => {
    const { conn } = redisMuet()
    conn.connect()
    await laisse()
    void conn.send(['PING']).catch(() => {})
    await laisse()
    assert.equal(conn._pending.length, 1, 'sanity : la commande attend')
    mock.timers.tick(DELAI)                  // sans rien laisser se dérouler : la fermeture du socket n'est pas encore arrivée
    assert.equal(conn._pending.length, 0, 'la liste est vidée par le délai lui-même')
    await laisse()
    conn.stop()
  })

  it('chaque commande a son délai : une commande envoyée pendant qu\'une autre attend échoue 30 s après SON envoi, même si la première a été réglée', async () => {
    const { conn, sockets } = redisMuet()
    conn.connect()
    await laisse()
    const premiere = suivre(conn.send(['INCR', 'a']))
    await avance(10000)
    const deuxieme = suivre(conn.send(['INCR', 'b']))
    await avance(10000)
    sockets[0].emit('data', Buffer.from(':1\r\n'))   // la première reçoit sa réponse, la deuxième attend toujours
    await laisse()
    assert.equal(premiere.etat, 'résolue', 'sanity : la première est réglée')
    assert.equal(deuxieme.etat, 'en attente', 'sanity : la deuxième attend')
    await avance(19999)                      // 29,999 s depuis l'envoi de la deuxième
    assert.equal(deuxieme.etat, 'en attente', 'trop tôt')
    await avance(1)
    assert.equal(deuxieme.etat, 'rejetée', 'la deuxième échoue 30 s après son envoi')
    assert.equal(sockets[0].detruit, true, 'la connexion est fermée')
    conn.stop()
  })

  it('une seule commande sans réponse : l\'avertissement est écrit, avec le compte d\'une commande', async () => {
    const { conn, logs } = redisMuet()
    conn.connect()
    await laisse()
    void conn.send(['PING']).catch(() => {})
    await avance(DELAI)
    const avertissements = logs.filter(l => l.niveau === 'warn' && /ne répond plus/.test(l.msg))
    assert.equal(avertissements.length, 1, `un avertissement : ${JSON.stringify(logs)}`)
    assert.match(avertissements[0].msg, /(^|\D)1 commande/, 'il compte une commande')
    conn.stop()
  })

  it('AUTH sans réponse : le journal dit le délai dépassé, jamais « authentification en échec »', async () => {
    const { conn, logs } = redisMuet({ password: 'secret' })
    conn.connect()
    void conn.send(['PING']).catch(() => {})
    await laisse()
    await avance(DELAI)
    await laisse()
    const faux = logs.filter(l => /authentification/.test(l.msg))
    assert.equal(faux.length, 0, `un silence n'est pas une authentification refusée : ${JSON.stringify(faux)}`)
    assert.ok(logs.some(l => l.niveau === 'warn' && /pas prête/.test(l.msg)), `le délai dépassé est dit : ${JSON.stringify(logs)}`)
    assert.equal(logs.filter(l => l.niveau === 'error').length, 0, 'aucune erreur : le délai est un avertissement')
    conn.stop()
  })

  it('un mot de passe refusé reste rapporté comme une authentification en échec (témoin : vert aussi sans le correctif)', async () => {
    const { conn, sockets, logs } = redisMuet({ password: 'faux' })
    conn.connect()
    void conn.send(['PING']).catch(() => {})
    await laisse()
    sockets[0].emit('data', Buffer.from('-WRONGPASS invalid username-password pair\r\n'))
    await laisse()
    assert.ok(logs.some(l => l.niveau === 'error' && /authentification/.test(l.msg)), `le refus est rapporté : ${JSON.stringify(logs)}`)
    conn.stop()
  })
})
