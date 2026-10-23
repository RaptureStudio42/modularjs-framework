// Un visiteur dont l'identité vaut `__proto__`, `constructor` ou `prototype` (un pseudo, un identifiant de connexion choisi par
// l'utilisateur) : chez les autres visiteurs de la page, la trousse des curseurs (*cursors, *follow) ne touche pas au prototype des
// objets — aucun objet de leur page ne gagne de clé, la fonction `Object` non plus, et ces curseurs se dessinent comme les autres quand la
// présence du salon les tient (la présence réelle, un état réactif, refuse ces noms : ils ne sont alors pas dessinés). Côté
// serveur, cursorsPackage et followPackage relaient sa position comme celle des autres : le serveur ne trie pas les noms, le client
// le fait seul, au plus près de son état.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { mjsWs, cursorsPackage, followPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const EFFET     = readFileSync(join(ICI, '../src/runtime/mjs_fx_cursors.ts'), 'utf8')
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// *cursors posé dans une page happy-dom, sa connexion simulée : les trames reçues passent par ses écouteurs
function page() {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`var µ = { _mjs_fxDefs: {}, _mjs_fxAdopt() {}, _mjs_fxRate() { return 4 }, elementAt() { return null },
    _mjs_dom: { getBoundingClientRect: (n) => n.getBoundingClientRect(), getRootNode: (n) => n.getRootNode(), addEventListener: (t, e, f, o) => t.addEventListener(e, f, o), removeEventListener: (t, e, f, o) => t.removeEventListener(e, f, o) },
    _mjs_fxRoomName: (s) => s.room || '/', _mjs_fxPackage() {}, _mjs_fxVar() { return null },
    _mjs_fxRoom: () => ({ presence: () => JSON.parse('{"__proto__":1,"constructor":1,"prototype":1}'), leave() {} }), error() {}, _mjs_msg: (k, a, t) => t };
  var ecoute = {};
  var sock = { state: 'open', on(t, f) { ecoute[t] = f; return () => {} }, send() {}, request() { return Promise.resolve({ id: 'moi' }) } };
  µ._mjs_fxSock = function(g, srv, msg, link) { var u = link(sock); return function() { u() } };
  ${EFFET}
  globalThis.µ = µ; globalThis.ecoute = ecoute;`)
  const zone = window.document.createElement('main')
  window.document.body.appendChild(zone)
  const off = window.µ._mjs_fxDefs.cursors.setup(zone, { room: 'r' }, null)
  return { window, off }
}

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

async function visiteur(transport: MemoryTransport, qui: any, url: string, salon: string, type: string) {
  const µ   = makeClient(transport)
  const s   = µ.socket(url, { auth: () => qui, reconnect: { enabled: false } })
  const vus: any[] = []
  s.on(type, (p: any) => vus.push(p))
  s.room(salon)
  await tick(5)
  return { s, vus }
}

describe('*cursors — une identité qui porte un nom du prototype', () => {
  it('chez les autres visiteurs, les curseurs de `__proto__` et de `constructor` ne touchent à aucun prototype, et se dessinent quand la présence les tient', async () => {
    const { window, off } = page()
    window.ecoute['cursors:move']({ room: 'r', p: null, t: null, f: null, c: 0, from: { id: '__proto__', name: 'Mallory' } })
    window.ecoute['cursors:move']({ room: 'r', p: null, t: null, f: null, c: 0, from: { id: 'constructor', name: 'Eve' } })
    window.ecoute['cursors:moves']({ room: 'r', list: [{ room: 'r', p: null, t: null, f: null, c: 1, from: { id: 'prototype', name: 'Ida' } }] })
    const vide: any = window.eval('({})')
    const cles: string[] = []
    for (const k in vide) cles.push(k)
    assert.deepEqual(Object.keys(window.Object.prototype), [], 'Object.prototype n\'a gagné aucune clé')
    assert.deepEqual(cles, [], 'un objet neuf de la page n\'a aucune clé héritée')
    assert.equal(window.Object.from, undefined, 'la fonction Object n\'a pas reçu les champs du curseur')
    await tick(60)
    const noms = Array.from(window.document.querySelectorAll('[mjs-fx-cursors-layer] [mjs-fx-cursor] b')).map((b: any) => b.textContent).sort()
    assert.deepEqual(noms, ['Eve', 'Ida', 'Mallory'], 'les trois curseurs sont dessinés, avec leur nom')
    off()
    window.close()
  })
})

describe('mjs-ws — la position d\'une identité qui porte un nom du prototype est relayée comme les autres', () => {
  it('cursorsPackage : `__proto__`, `constructor` et `prototype` partent comme un visiteur ordinaire', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    app.use(cursorsPackage())
    await app.listen()
    const temoin = await visiteur(transport, { id: '9', name: 'Theo' }, 'memory://t', 'cursors:doc', 'cursors:move')
    const ids = ['__proto__', 'constructor', 'prototype', '1']
    for (const id of ids) {
      const v = await visiteur(transport, { id, name: 'N' + id }, 'memory://' + id, 'cursors:doc', 'cursors:move')
      v.s.send('cursors:move', { room: 'doc', p: { a: [0], x: 0.5, y: 0.5 }, t: null, f: null, c: 0 })
    }
    await tick(10)
    assert.deepEqual(temoin.vus.map((m: any) => m.from.id), ids, 'tous rediffusés, dans l\'ordre')
    assert.deepEqual(Object.keys(Object.prototype), [], 'la mémoire du serveur n\'a gagné aucune clé héritée')
    await app.stop()
  })

  it('followPackage : la souris de celui qui mène part, qu\'il s\'appelle `__proto__` ou non', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    app.use(followPackage({ canLead: () => true }))
    await app.listen()
    const eleve = await visiteur(transport, { id: '9', name: 'Theo' }, 'memory://e', 'follow:cours', 'follow:cursor')
    for (const id of ['__proto__', '1']) {
      const v = await visiteur(transport, { id, name: 'N' + id }, 'memory://f' + id, 'follow:cours', 'follow:cursor')
      v.s.send('follow:cursor', { room: 'cours', p: { a: [0], x: 0.5, y: 0.5 }, t: null, f: null, c: 0 })
    }
    await tick(10)
    assert.deepEqual(eleve.vus.map((m: any) => m.from.id), ['__proto__', '1'], 'les deux rediffusées, dans l\'ordre')
    await app.stop()
  })
})
