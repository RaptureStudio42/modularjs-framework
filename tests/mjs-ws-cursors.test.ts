// Paquet CURSEURS (mjs-ws/cursors.ts) contre de vrais clients µ.socket (MemoryTransport) — même
// patron que tests/socket-chat.test.ts : un visiteur envoie sa souris et sa sélection, les AUTRES
// membres du salon la reçoivent avec son identité (résolue par le serveur), jamais lui-même ; tout
// champ reçu est vérifié et recopié (rien d'autre ne passe) ; hors du salon, rien ; au-delà du
// débit, la trame est ignorée.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, cursorsPackage } from '../src/mjs-ws/index.js'
import { cleanPointer, cleanText } from '../src/mjs-ws/cursors.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

async function demarrer(opts: any = {}) {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
  app.use(cursorsPackage(opts))
  await app.listen()
  return { transport, app }
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

// un visiteur : sa connexion, le salon rejoint, les trames reçues
async function visiteur(transport: MemoryTransport, qui: any, url: string) {
  const µ   = makeClient(transport)
  const s   = µ.socket(url, { auth: () => qui, reconnect: { enabled: false } })
  const vus: any[] = []
  s.on('cursors:move', (p: any) => vus.push(p))
  s.room('cursors:doc')
  await tick(5)
  return { s, vus }
}

describe('mjs-ws — paquet CURSEURS', () => {
  it('la souris et la sélection d\'un visiteur arrivent aux autres, avec son identité ; jamais à lui-même', async () => {
    const { transport, app } = await demarrer()
    const a = await visiteur(transport, zora, 'memory://a')
    const b = await visiteur(transport, theo, 'memory://b')
    a.s.send('cursors:move', { room: 'doc', p: { a: [0, 2, -1, 1], x: 0.25, y: 0.5 }, t: { k: 'r', a: [0, 1, 0], ao: 2, b: [0, 1, 0], bo: 7 } })
    await tick(5)
    assert.deepEqual(b.vus, [{ room: 'doc', p: { a: [0, 2, -1, 1], x: 0.25, y: 0.5 }, t: { k: 'r', a: [0, 1, 0], ao: 2, b: [0, 1, 0], bo: 7 }, f: null, c: 0, from: { id: '1', name: 'Zora' } }])
    assert.deepEqual(a.vus, [], 'l\'envoyeur ne reçoit pas sa propre trame')
    assert.deepEqual(await b.s.request('cursors:me', {}), { id: '2', name: 'Theo' })
    await app.stop()
  })

  it('la balise active (f) et le compte des clics (c) arrivent aux autres, vérifiés comme le reste', async () => {
    const { transport, app } = await demarrer()
    const a = await visiteur(transport, zora, 'memory://a4')
    const b = await visiteur(transport, theo, 'memory://b4')
    a.s.send('cursors:move', { room: 'doc', p: null, t: null, f: [0, 3, -1, 2], c: 5 })
    a.s.send('cursors:move', { room: 'doc', p: null, t: null, f: ['button'], c: -2 })
    await tick(5)
    assert.deepEqual(b.vus.map((v: any) => [v.f, v.c]), [[[0, 3, -1, 2], 5], [null, 0]], 'un chemin fait de nombres, un compte entier positif')
    await app.stop()
  })

  it('un salon d\'au moins groupFrom membres (100 par défaut) : le serveur regroupe les positions — une trame cursors:moves par quart de seconde, la dernière position de chacun, la plus récente en tête, au plus le plus grand max des visiteurs plus une place pour la position de qui reçoit', async () => {
    const { transport, app } = await demarrer({ groupFrom: 3 })
    const ines = { id: '3', name: 'Ines' }
    const groupees = (s: any) => { const vus: any[] = []; s.on('cursors:moves', (p: any) => vus.push(p)); return vus }
    const a = await visiteur(transport, zora, 'memory://ga')
    const b = await visiteur(transport, theo, 'memory://gb')
    const c = await visiteur(transport, ines, 'memory://gc')
    const ga = groupees(a.s)
    const gc = groupees(c.s)
    for (const v of [a, b, c]) await v.s.request('cursors:me', { max: 2 })
    c.s.send('cursors:move', { room: 'doc', p: { a: [0], x: 0.05, y: 0.05 } })
    await tick(5)
    a.s.send('cursors:move', { room: 'doc', p: { a: [0], x: 0.1, y: 0.1 } })
    await tick(5)
    b.s.send('cursors:move', { room: 'doc', p: { a: [0], x: 0.2, y: 0.2 } })
    await tick(5)
    a.s.send('cursors:move', { room: 'doc', p: { a: [0], x: 0.3, y: 0.3 } })
    await tick(5)
    assert.deepEqual([...a.vus, ...b.vus, ...c.vus], [], 'plus une trame par position')
    await tick(300)
    assert.equal(gc.length, 1, 'une trame regroupée')
    assert.equal(gc[0].room, 'doc')
    assert.deepEqual(gc[0].list.map((e: any) => [e.from.id, e.p.x]), [['1', 0.3], ['2', 0.2], ['3', 0.05]], 'max 2 : les deux plus récentes et une de plus (celle de qui reçoit), la dernière position de chacun')
    assert.deepEqual(ga[0].list, gc[0].list, 'la même pour tous : chacun écarte la sienne')
    await tick(300)
    assert.equal(gc.length, 1, 'rien n\'a bougé : rien ne part')
    await app.stop()
  })

  it('un salon plus petit : une trame par position, tout de suite', async () => {
    const { transport, app } = await demarrer({ groupFrom: 4 })
    const a = await visiteur(transport, zora, 'memory://pa')
    const b = await visiteur(transport, theo, 'memory://pb')
    a.s.send('cursors:move', { room: 'doc', p: { a: [0], x: 0.1, y: 0.1 } })
    await tick(5)
    assert.equal(b.vus.length, 1)
    await app.stop()
  })

  it('tout champ reçu est vérifié et recopié : le reste ne passe pas', () => {
    assert.deepEqual(cleanPointer({ a: [1, 2], x: 0.5, y: 1, evil: '<img>' }), { a: [1, 2], x: 0.5, y: 1 })
    assert.equal(cleanPointer({ a: [1, 2], x: 1.5, y: 0 }), null, 'hors de la boîte')
    assert.equal(cleanPointer({ a: ['div'], x: 0, y: 0 }), null, 'un chemin fait de nombres')
    assert.equal(cleanPointer({ a: new Array(65).fill(0), x: 0, y: 0 }), null, 'un chemin de 64 pas au plus')
    assert.deepEqual(cleanText({ k: 'f', a: [3], s: 1, e: 4, v: 'mot de passe' }), { k: 'f', a: [3], s: 1, e: 4 })
    assert.equal(cleanText({ k: 'r', a: [1], ao: -1, b: [1], bo: 2 }), null)
    assert.equal(cleanText({ k: 'x', a: [1] }), null)
  })

  it('hors du salon : rien n\'est rediffusé', async () => {
    const { transport, app } = await demarrer()
    const b = await visiteur(transport, theo, 'memory://b2')
    const µ = makeClient(transport)
    const intrus = µ.socket('memory://c2', { auth: () => zora, reconnect: { enabled: false } })
    intrus.connect()
    await tick(5)
    intrus.send('cursors:move', { room: 'doc', p: { a: [0], x: 0, y: 0 }, t: null })
    await tick(5)
    assert.deepEqual(b.vus, [])
    await app.stop()
  })

  it('au-delà du débit, la trame est ignorée', async () => {
    const { transport, app } = await demarrer({ rateLimit: { rate: 1, burst: 2 } })
    const a = await visiteur(transport, zora, 'memory://a3')
    const b = await visiteur(transport, theo, 'memory://b3')
    for (let i = 0; i < 5; i++) a.s.send('cursors:move', { room: 'doc', p: { a: [i], x: 0, y: 0 }, t: null })
    await tick(5)
    assert.equal(b.vus.length, 2)
    await app.stop()
  })
})
