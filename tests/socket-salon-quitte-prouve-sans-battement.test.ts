// µ.socket — la preuve qu'un salon quitté l'est pour le serveur, avec ou sans battement de cœur. Le départ (µ:leave) était retenu
// jusqu'à la réponse (µ:pong) d'un battement parti après lui sur la même connexion : sans battement (`heartbeat: 0`), ou avec une
// reprise de session avant le premier battement (15 s par défaut), cette réponse ne venait jamais. Le départ repartait alors à
// CHAQUE reprise, sans fin, et la liste des départs retenus grossissait à chaque salon quitté ; quarante salons quittés repartaient
// à chaque reprise, et des reprises rapprochées vidaient le seau de débit du serveur jusqu'à l'expulsion (1008). Le client envoie
// maintenant lui-même un µ:ping après un départ (la connexion calme depuis une seconde, ou dès dix départs qu'aucun µ:ping n'a
// suivis ; aucun si un battement part entre-temps) et juste après les départs redits à une reprise : sa réponse prouve le départ.
// Il en retient au plus cinquante. Vrai serveur MJS-WS sur le transport mémoire, vrais clients
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src  = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// une seule fabrique de WebSocket, reposée avant chaque test (d'autres fichiers posent la leur) : chaque connexion `memory://<id>`
// relève ses trames reçues et envoyées
let transport: MemoryTransport
const recus    = new Map<string, any[]>()
const sortants = new Map<string, any[]>()
const liste    = (m: Map<string, any[]>, id: string) => { if (!m.has(id)) m.set(id, []); return m.get(id)! }
function fabrique(url: string, protocols?: any): any {
  const ws: any = transport.connect({ url, protocols })
  const id      = url.replace('memory://', '')
  let reel: any = null
  Object.defineProperty(ws, 'onmessage', { get() { return reel }, set(fn: any) { reel = fn && ((ev: any) => { liste(recus, id).push(JSON.parse(ev.data)); fn(ev) }) } })
  const envoyer = ws.send.bind(ws)
  ws.send = (d: any) => { liste(sortants, id).push(JSON.parse(d)); return envoyer(d) }
  return ws
}
// `heartbeat` : période du battement du client en ms, 0 = aucun battement, absent = celui par défaut (15 s, il ne bat jamais ici)
function client(id: string, heartbeat?: number): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', src)(µ)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false }, ...(heartbeat !== undefined ? { heartbeat } : {}) })
}
const accueils = (id: string) => liste(recus, id).filter(f => f.t === 'µ:welcome').length
const retenus  = (s: any) => Object.keys(s._mjs_roomLeaves).length

describe('µ.socket — salon quitté : la preuve du départ, avec ou sans battement', function () {
  this.timeout(30000)
  let app: any = null
  beforeEach(() => { (globalThis as any).WebSocket = fabrique; transport = new MemoryTransport(); recus.clear(); sortants.clear() })
  afterEach(async () => { if (app) await app.stop(); app = null })

  // `fois` reprises de session rapprochées (coupure, 15 ms, reconnexion, 40 ms) : les µ:leave partis et les µ:error reçus à chacune
  async function reprises(a: any, fois: number) {
    const leaves: number[] = [], erreurs: string[] = []
    for (let k = 0; k < fois; k++) {
      assert.ok(a._mjs_ws, 'connexion encore ouverte avant la reprise ' + (k + 1) + ' (état ' + a.state + ', erreurs ' + JSON.stringify(erreurs) + ', expulsions pour débit ' + app.stats().garde.kicksDebit + ')')
      a._mjs_ws.close(1006, 'coupure'); await tick(15)
      const depuis = liste(sortants, 'a').length, r0 = liste(recus, 'a').length, w = accueils('a')
      a.connect()
      await attendre(() => accueils('a') === w + 1, 'reprise ' + (k + 1))
      await tick(40)
      leaves.push(liste(sortants, 'a').slice(depuis).filter(m => m.t === 'µ:leave').length)
      for (const f of liste(recus, 'a').slice(r0)) if (f.t === 'µ:error') erreurs.push(String(f.p && f.p.message))
    }
    return { leaves, erreurs }
  }

  for (const hb of [0, undefined]) {
    for (const horsLigne of [false, true]) {
      const nom = (hb === 0 ? 'sans battement' : 'battement par défaut, reprises avant lui') + ', départ ' + (horsLigne ? 'appelé hors ligne' : 'parti en ligne et traité')
      it(nom + ' : redit au plus à la première reprise, plus jamais ensuite, rien de retenu', async () => {
        app = mjsWs({ transport, heartbeat: 0, resume: true, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
        await app.listen()
        const a = client('a', hb)
        const s = a.room('salle')
        a.connect()
        await attendre(() => app.room('salle').size === 1, 'a dans le salon')
        if (horsLigne) { a._mjs_ws.close(1006, 'coupure'); await tick(15); s.leave(); a.connect(); await attendre(() => accueils('a') === 2, 'a de retour') }
        else s.leave()
        await attendre(() => app.room('salle').size === 0, 'départ traité par le serveur')
        const r = await reprises(a, 5)
        assert.ok(r.leaves.every(n => n <= 1), 'jamais plus d\'un µ:leave par reprise : ' + JSON.stringify(r.leaves))
        assert.deepEqual(r.leaves.slice(1), [0, 0, 0, 0], 'plus jamais redit après la première reprise : ' + JSON.stringify(r.leaves))
        assert.equal(retenus(a), 0, 'plus aucun départ retenu')
        assert.deepEqual(r.erreurs, [])
        a.destroy()
      })
    }
  }

  it('40 salons rejoints puis quittés en ligne, sans battement, puis 4 reprises rapprochées : aucune expulsion, aucun départ redit sans fin', async () => {
    app = mjsWs({ transport, heartbeat: 0, resume: true, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    await app.listen()
    const a = client('a', 0)
    a.connect()
    await attendre(() => a.state === 'open', 'ouvert')
    for (let i = 0; i < 40; i++) {
      const h = a.room('r' + i)
      await attendre(() => app.room('r' + i).size === 1, 'r' + i)
      h.leave()
      await attendre(() => app.room('r' + i).size === 0, 'r' + i + ' quitté')
    }
    const r = await reprises(a, 4)
    assert.deepEqual(r.leaves.slice(1), [0, 0, 0], 'les départs ne repartent pas à chaque reprise : ' + JSON.stringify(r.leaves))
    assert.deepEqual(r.erreurs, [], 'aucune erreur de débit')
    assert.equal(a.state, 'open')
    assert.equal(app.stats().garde.kicksDebit, 0, 'aucune expulsion pour débit')
    assert.equal(retenus(a), 0, 'plus aucun départ retenu')
    a.destroy()
  })

  it('80 salons pris puis quittés hors ligne : au plus 50 départs retenus, redits une fois à la reprise, sans erreur ni expulsion', async () => {
    app = mjsWs({ transport, heartbeat: 0, resume: true, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    await app.listen()
    const a = client('a', 0)
    a.connect()
    await attendre(() => a.state === 'open', 'ouvert')
    a._mjs_ws.close(1006, 'coupure'); await tick(15)
    for (let i = 0; i < 80; i++) a.room('h' + i).leave()
    assert.ok(retenus(a) <= 50, 'liste bornée : ' + retenus(a) + ' départs retenus')
    a.connect()
    await attendre(() => accueils('a') === 2, 'a de retour')
    await tick(40)
    const r = await reprises(a, 2)
    const premiers = liste(sortants, 'a').filter(m => m.t === 'µ:leave').length
    assert.ok(premiers <= 50, premiers + ' µ:leave en tout')
    assert.deepEqual(r.leaves, [0, 0], 'prouvés : plus rien ensuite')
    assert.deepEqual(r.erreurs, [])
    assert.equal(app.stats().garde.kicksDebit, 0)
    assert.equal(retenus(a), 0)
    a.destroy()
  })
})
