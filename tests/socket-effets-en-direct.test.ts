// La connexion MJS WS que partagent l'appli et ses effets en direct (*follow, *cursors, *react,
// *heatmap) — le vrai client µ.socket contre un vrai serveur mjsWs (MemoryTransport) :
//   - un envoi « volatil » (une position, un émoji) ne part jamais en file hors ligne : il ne chasse
//     pas les messages de l'appli, et rien n'est rejoué d'un coup à la reconnexion (le serveur
//     expulsait pour débit) ;
//   - le regroupement (coalesce) distingue une clé : deux salons du même type ne s'écrasent pas ;
//   - une erreur du serveur bien après un salon rejoint ne le fait plus oublier ;
//   - l'effet prend la connexion de sa variable (`sock`, `@sock` par défaut) sans la retenir : l'appli
//     la détruit, elle se ferme vraiment (plus d'identité d'avant qui traîne) et l'effet s'en détache ;
//     avec `auth`, il attend que l'appli l'ouvre ; sa variable vide, il ne prend aucune autre connexion
//     (ni celle de l'appli, ni la connexion `server` d'un autre effet) et le dit en console.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, cursorsPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', socketSrc)(µ)
  return µ
}

async function demarrer(extra: any = {}) {
  const transport = new MemoryTransport()
  const journal: string[] = []
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth ?? { id: 'anon' }, onLog: (_l: string, m: string) => { journal.push(m) }, ...extra })
  app.use(cursorsPackage())
  await app.listen()
  return { transport, app, journal }
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

describe('µ.socket — la connexion partagée avec les effets en direct', () => {
  it('un envoi volatil ne part pas en file hors ligne : le message de l\'appli reste seul, rejoué sans expulsion', async () => {
    const { transport, app, journal } = await demarrer()
    const µb = makeClient(transport)
    const b  = µb.socket('memory://temoin', { auth: () => theo, reconnect: { enabled: false } })
    const vus: string[] = []
    b.on('chat:send', () => vus.push('chat'))
    b.room('cursors:/')
    const µa = makeClient(transport)
    const a  = µa.socket('memory://coupe', { auth: () => zora, reconnect: { enabled: true, backoff: [300] } })
    a.room('cursors:/')
    await tick(10)
    assert.equal(a.state, 'open')
    // le réseau tombe : la connexion attend de se rouvrir
    a._mjs_ws.close()
    await tick(5)
    assert.notEqual(a.state, 'open')
    a.send('chat:send', { texte: 'bonjour' })
    for (let i = 0; i < 200; i++) a.send('cursors:move', { room: '/', p: null, t: null, i }, { volatile: true })
    for (let i = 0; i < 5; i++) a.send('cursors:move', { room: '/', p: null, t: null, i }, { volatile: true, coalesce: 5 })
    await tick(30)
    assert.deepEqual(a._mjs_queue.map((m: any) => m.type), ['chat:send'], 'rien des effets dans la file')
    await tick(600)
    assert.equal(a.state, 'open', 'rouverte')
    assert.ok(!journal.some((m) => /expuls/i.test(m)), 'pas d\'expulsion : ' + JSON.stringify(journal))
    a.destroy()
    b.destroy()
    await app.stop()
  })

  it('le regroupement distingue une clé : deux salons du même type partent tous les deux', async () => {
    const { transport, app } = await demarrer()
    const µb = makeClient(transport)
    const b  = µb.socket('memory://b2', { auth: () => theo, reconnect: { enabled: false } })
    const vus: string[] = []
    b.on('cursors:move', (p: any) => vus.push(p.room))
    b.room('cursors:a')
    b.room('cursors:b')
    const µa = makeClient(transport)
    const a  = µa.socket('memory://a2', { auth: () => zora, reconnect: { enabled: false } })
    a.room('cursors:a')
    a.room('cursors:b')
    await tick(10)
    a.send('cursors:move', { room: 'a', p: null, t: null }, { coalesce: 10, key: 'a' })
    a.send('cursors:move', { room: 'b', p: null, t: null }, { coalesce: 10, key: 'b' })
    await tick(60)
    assert.deepEqual(vus.sort(), ['a', 'b'])
    a.destroy()
    b.destroy()
    await app.stop()
  })

  it('une erreur du serveur bien après un salon rejoint ne le fait plus oublier', async () => {
    const { transport, app } = await demarrer()
    const µa = makeClient(transport)
    const a  = µa.socket('memory://a3', { auth: () => zora, reconnect: { enabled: false } })
    a.room('cursors:/page')
    await tick(10)
    assert.ok(a._mjs_rooms['cursors:/page'])
    // dix secondes plus tard, une trame que le serveur ne connaît pas : il répond par une erreur
    const debut = Date.now()
    a._mjs_now = () => debut + 10_000
    a.send('inconnu:type', {})
    await tick(10)
    assert.ok(a._mjs_rooms['cursors:/page'], 'le salon est toujours là : ' + JSON.stringify(Object.keys(a._mjs_rooms)))
    a.destroy()
    await app.stop()
  })

  it('le serveur n\'a pas le paquet d\'un effet en direct (followPackage oublié) : l\'effet le dit une fois en console, avec le paquet à ajouter', async () => {
    const { transport, app } = await demarrer()
    const µ = makeClient(transport)
    const erreurs: string[] = []
    µ.error = (m: string) => erreurs.push(m)
    const s = µ.socket('memory://sans-suivi', { reconnect: { enabled: false } })
    s.connect(); await tick(5)
    µ._mjs_fxPackage(s, 'follow:', '*follow', 'followPackage')
    µ._mjs_fxPackage(s, 'cursors:', '*cursors', 'cursorsPackage')
    s.send('follow:at', { room: '/', a: [0], y: 0 })
    s.send('follow:at', { room: '/', a: [1], y: 0 })
    s.send('cursors:move', { room: '/', p: null })
    await tick(10)
    assert.equal(erreurs.length, 1, 'une fois, et rien pour le paquet présent : ' + JSON.stringify(erreurs))
    assert.match(erreurs[0], /\*follow[\s\S]*follow:at[\s\S]*followPackage/)
    s.destroy()
    await app.stop()
  })

  it('l\'effet prend la connexion de sa variable sans la retenir : détruite par l\'appli, elle se ferme vraiment ; l\'effet s\'en détache', async () => {
    const { transport, app } = await demarrer()
    const µ = makeClient(transport)
    const liens: any[] = []
    const defaits: any[] = []
    const s1 = µ.socket('memory://appli1', { reconnect: { enabled: false } })
    const renonce = µ._mjs_fxSock(s1, undefined, 'aucune connexion', (k: any) => {
      liens.push(k)
      return () => defaits.push(k)
    })
    assert.equal(liens.length, 1)
    assert.ok(liens[0] === s1, 'la connexion de sa variable')
    assert.equal(s1._mjs_refs, 1, 'l\'effet ne la retient pas')
    s1.destroy()
    assert.equal(s1._mjs_destroyed, true, 'fermée pour de bon')
    assert.equal(defaits.length, 1, 'l\'effet s\'en est détaché')
    renonce()
    assert.equal(defaits.length, 1, 'rien à défaire de plus')
    await app.stop()
  })

  it('une connexion avec auth, pas encore ouverte : l\'effet ne l\'ouvre pas, il attend que l\'appli l\'ouvre', async () => {
    const { transport, app } = await demarrer()
    const µ = makeClient(transport)
    const s = µ.socket('memory://auth', { auth: () => zora, reconnect: { enabled: false } })
    const liens: any[] = []
    const renonce = µ._mjs_fxSock(s, undefined, 'aucune connexion', (k: any) => {
      liens.push(k)
      return () => {}
    })
    await tick(10)
    assert.equal(liens.length, 0, 'pas encore')
    assert.equal(s._mjs_ws, null, 'l\'effet ne l\'a pas ouverte')
    s.connect()
    await tick(10)
    assert.equal(liens.length, 1, 'ouverte par l\'appli : l\'effet s\'y branche')
    renonce()
    s.destroy()
    await app.stop()
  })

  it('sa variable vide : aucune autre connexion — ni celle de l\'appli, ni la connexion server d\'un autre effet ; il le dit en console', async () => {
    const { transport, app } = await demarrer()
    const µ = makeClient(transport)
    µ._mjs_sockGrace = 20
    const erreurs: string[] = []
    µ.error = (m: string) => erreurs.push(m)
    const appli = µ.socket('memory://appli', { reconnect: { enabled: false } })
    const autre = µ._mjs_fxSock(undefined, 'memory://effet', 'x', () => () => {})
    const liens: any[] = []
    const renonce = µ._mjs_fxSock(undefined, undefined, 'variable vide', (k: any) => {
      liens.push(k)
      return () => {}
    })
    await tick(60)
    assert.equal(liens.length, 0)
    assert.ok(erreurs.includes('variable vide'), JSON.stringify(erreurs))
    renonce()
    autre()
    appli.destroy()
    await app.stop()
  })
})
