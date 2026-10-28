// µ.socket — un salon quitté reste quitté. Le départ de la dernière poignée d'un salon (`leave()`) appelé hors ligne ne pouvait pas
// envoyer son µ:leave : avec la reprise de session du serveur (`resume: true`), la session reprise gardait l'adhésion — le serveur
// comptait encore ce client dans le salon, lui en poussait les messages, et les autres membres le voyaient toujours présent. Le départ
// part désormais au `µ:welcome` repris, avant les re-joins ; celui qui était parti sur la connexion tombée depuis (peut-être perdu
// avec elle) repart aussi (sans effet sur un serveur qui l'avait reçu), à chaque reprise, tant que le serveur ne l'a pas traité :
// redit une seule fois, il se perdait de nouveau avec cette connexion et la reprise suivante n'en disait plus rien. La preuve : la
// réponse à un µ:ping parti après lui sur la même connexion (le serveur traite les trames d'une connexion dans l'ordre), battement de
// cœur ou µ:ping que le client envoie lui-même après un départ ; un accueil neuf n'a plus aucun salon, rien à défaire. Vrai serveur
// MJS-WS sur le transport mémoire, vrais clients
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
// relève ses trames reçues et envoyées ; `perdre` : la prochaine trame sortante de ce type, pour ce client, se perd avec la connexion
// (écrite, jamais arrivée) — elle et tout ce qui part après elle sur ce fil : une connexion livre ses trames dans l'ordre, celle qui en
// perd une ne livre plus la suite
let transport: MemoryTransport
const recus    = new Map<string, any[]>()
const sortants = new Map<string, any[]>()
const perdre   = new Set<string>()
const liste    = (m: Map<string, any[]>, id: string) => { if (!m.has(id)) m.set(id, []); return m.get(id)! }
function fabrique(url: string, protocols?: any): any {
  const ws: any = transport.connect({ url, protocols })
  const id      = url.replace('memory://', '')
  let reel: any = null
  Object.defineProperty(ws, 'onmessage', { get() { return reel }, set(fn: any) { reel = fn && ((ev: any) => { liste(recus, id).push(JSON.parse(ev.data)); fn(ev) }) } })
  const envoyer = ws.send.bind(ws)
  let coupe     = false
  ws.send = (d: any) => {
    const m = JSON.parse(d)
    liste(sortants, id).push(m)
    if (coupe || perdre.delete(id + ' ' + m.t)) { coupe = true; return }
    return envoyer(d)
  }
  return ws
}
// `heartbeat` : période du battement de cœur du client en ms (celui par défaut, 15 s, ne bat jamais pendant un test)
function client(id: string, heartbeat?: number): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', src)(µ)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false }, ...(heartbeat ? { heartbeat } : {}) })
}
const departs = (id: string, depuis: number) => liste(sortants, id).slice(depuis).filter(m => m.t === 'µ:leave').map(m => m.p.room)

describe('µ.socket — un salon quitté reste quitté', () => {
  let app: any = null
  beforeEach(() => { (globalThis as any).WebSocket = fabrique; transport = new MemoryTransport(); recus.clear(); sortants.clear(); perdre.clear() })
  afterEach(async () => { await app.stop() })

  // a et b dans « salle », b en suit la présence
  async function deuxMembres(resume: boolean, heartbeat?: number) {
    app = mjsWs({ transport, heartbeat: 0, resume, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    await app.listen()
    const a = client('a', heartbeat), b = client('b')
    const salleA = a.room('salle')
    const presence = b.room('salle').presence()
    a.connect(); b.connect()
    await attendre(() => 'a' in presence && app.room('salle').size === 2, 'a et b dans le salon')
    return { a, b, salleA, presence }
  }
  // ce que le salon pousse encore à a, une fois revenu
  async function pousseEncore(): Promise<any[]> {
    const depuis = liste(recus, 'a').length
    app.room('salle').send('salle/annonce', { n: 1 })
    await tick(30)
    return liste(recus, 'a').slice(depuis).filter(f => f.t === 'salle/annonce')
  }

  for (const resume of [true, false]) {
    it('leave() hors ligne puis reconnexion (' + (resume ? 'session reprise' : 'accueil neuf') + ') : le serveur ne compte plus a, b ne le voit plus, le salon ne lui pousse plus rien', async () => {
      const { a, b, salleA, presence } = await deuxMembres(resume)
      a._mjs_ws.close(1006, 'coupure'); await tick(20)
      salleA.leave()
      const depuis = liste(sortants, 'a').length
      a.connect()
      await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 2, 'a de retour')
      await tick(30)
      assert.equal(liste(recus, 'a').filter(f => f.t === 'µ:welcome').at(-1).p.resumed === true, resume, 'accueil tel que demandé')
      assert.equal(app.room('salle').size, 1, 'le serveur ne compte plus a')
      assert.equal('a' in presence, false, 'b ne voit plus a')
      assert.deepEqual(await pousseEncore(), [], 'plus aucun message du salon pour a')
      assert.deepEqual(departs('a', depuis), resume ? ['salle'] : [], 'le départ part à la reprise, et seulement à elle')
      a.destroy(); b.destroy()
    })
  }

  it('départ parti juste avant la coupure, perdu avec elle : il repart à la reprise ; traité par le serveur (battement répondu), plus rien ensuite', async () => {
    const { a, b, salleA, presence } = await deuxMembres(true, 25)
    perdre.add('a µ:leave')
    salleA.leave()
    a._mjs_ws.close(1006, 'coupure'); await tick(20)
    const depuis = liste(sortants, 'a').length
    a.connect()
    await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 2, 'a de retour')
    await tick(30)
    assert.equal(app.room('salle').size, 1, 'le serveur ne compte plus a')
    assert.equal('a' in presence, false, 'b ne voit plus a')
    assert.deepEqual(await pousseEncore(), [], 'plus aucun message du salon pour a')
    assert.deepEqual(departs('a', depuis), ['salle'])
    // un battement de cœur parti après le départ redit, et sa réponse : le serveur l'a traité
    const pongs = liste(recus, 'a').filter(f => f.t === 'µ:pong').length
    await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:pong').length > pongs, 'un battement répondu')
    // une reprise de plus : rien à redire
    const ensuite = liste(sortants, 'a').length
    a._mjs_ws.close(1006, 'coupure'); await tick(20)
    a.connect()
    await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 3, 'a de retour, encore')
    assert.deepEqual(departs('a', ensuite), [], 'traité par le serveur : plus rien')
    a.destroy(); b.destroy()
  })

  for (const enLigne of [false, true]) {
    it('départ ' + (enLigne ? 'parti en ligne' : 'appelé hors ligne') + ', redit à la reprise puis perdu de nouveau avec cette connexion : la reprise suivante le redit encore', async () => {
      const { a, b, salleA, presence } = await deuxMembres(true)
      if (enLigne) perdre.add('a µ:leave')
      else { a._mjs_ws.close(1006, 'coupure'); await tick(20) }
      salleA.leave()
      if (enLigne) { a._mjs_ws.close(1006, 'coupure'); await tick(20) }
      // reprise 1 : le départ redit se perd avec elle
      perdre.add('a µ:leave')
      a.connect()
      await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 2, 'reprise 1')
      await tick(30)
      assert.equal(app.room('salle').size, 2, 'départ perdu : le serveur compte encore a')
      a._mjs_ws.close(1006, 'coupure'); await tick(20)
      // reprise 2
      const depuis = liste(sortants, 'a').length
      a.connect()
      await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 3, 'reprise 2')
      await tick(30)
      assert.equal(liste(recus, 'a').filter(f => f.t === 'µ:welcome').at(-1).p.resumed, true, 'session reprise')
      assert.deepEqual(departs('a', depuis), ['salle'], 'le départ est redit')
      assert.equal(app.room('salle').size, 1, 'le serveur ne compte plus a')
      assert.equal('a' in presence, false, 'b ne voit plus a')
      assert.deepEqual(await pousseEncore(), [], 'plus aucun message du salon pour a')
      a.destroy(); b.destroy()
    })
  }

  it('départ parti en ligne et traité par le serveur (battement répondu) : rien n\'est redit à la reprise', async () => {
    const { a, b, salleA, presence } = await deuxMembres(true, 25)
    salleA.leave()
    await attendre(() => app.room('salle').size === 1, 'départ reçu')
    const pongs = liste(recus, 'a').filter(f => f.t === 'µ:pong').length
    await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:pong').length > pongs, 'un battement répondu')
    a._mjs_ws.close(1006, 'coupure'); await tick(20)
    const depuis = liste(sortants, 'a').length
    a.connect()
    await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 2, 'a de retour')
    await tick(30)
    assert.deepEqual(departs('a', depuis), [], 'traité : plus rien à redire')
    assert.equal('a' in presence, false)
    a.destroy(); b.destroy()
  })

  it('hors ligne, leave() puis room() du même salon : a reste membre, aucun départ à la reprise', async () => {
    const { a, b, salleA, presence } = await deuxMembres(true)
    a._mjs_ws.close(1006, 'coupure'); await tick(20)
    salleA.leave()
    a.room('salle')
    const depuis = liste(sortants, 'a').length
    a.connect()
    await attendre(() => liste(recus, 'a').filter(f => f.t === 'µ:welcome').length === 2, 'a de retour')
    await tick(30)
    assert.deepEqual(departs('a', depuis), [])
    assert.equal(app.room('salle').size, 2)
    assert.equal('a' in presence, true)
    assert.equal((await pousseEncore()).length, 1, 'membre : le salon lui parle')
    a.destroy(); b.destroy()
  })
})
