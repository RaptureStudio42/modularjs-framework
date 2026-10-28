// µ.lockstep — les reprises demandées après un apply() qui lève sont bornées, et un état faux n'est jamais laissé en silence. Un
// apply() qui ne levait qu'en direct (le rejeu passe) relançait une reprise complète (µgame:resync) par ordre fautif, sans plafond :
// dix ordres, dix reprises. Et après un rejeu qui avait levé une seule fois, plus aucune reprise n'était demandée de toute la partie :
// un défaut du direct plus tard chez un seul joueur laissait son état faux, sans erreur ni reprise. Maintenant : chaque ordre qui lève
// en direct demande la reprise, une à la fois, au plus trois par minute ; au-delà, l'erreur est dite et la partie signalée (événement
// 'divergence', raison 'apply-threw'), et la reprise attend la fin de la minute, relue à chaque tick. Un rejeu qui lève n'arrête plus
// rien. Vrai serveur MJS-Server (MemoryTransport), vrais clients (µ.socket, sock.game, µ.det, µ.lockstep) ; l'horloge des clients
// peut être avancée (`decalage`) pour passer la minute sans l'attendre
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runtime   = ['mjs_socket.ts', 'mjs_game.ts', 'mjs_det.ts', 'mjs_lockstep.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const pause     = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// horloge des clients seulement (le serveur garde la vraie)
let decalage = 0
class Horloge extends Date { static now() { return Date.now() + decalage } }

// une seule fabrique de WebSocket pour tout le fichier, reposée avant chaque test : chaque connexion `memory://<id>` relève, dans
// l'ordre, ses trames sortantes et reçues
let transport: MemoryTransport
const fil = new Map<string, Array<{ sens: 'out' | 'in', m: any }>>()
function fabrique(url: string, protocols?: any): any {
  const ws: any = transport.connect({ url, protocols })
  const id      = url.replace('memory://', '')
  if (!fil.has(id)) fil.set(id, [])
  const journal = fil.get(id)!
  let reel: any = null
  Object.defineProperty(ws, 'onmessage', { get() { return reel }, set(fn: any) { reel = fn && ((ev: any) => { journal.push({ sens: 'in', m: JSON.parse(ev.data) }); fn(ev) }) } })
  const envoyer = ws.send.bind(ws)
  ws.send = (d: any) => { journal.push({ sens: 'out', m: JSON.parse(d) }); return envoyer(d) }
  return ws
}
const resyncs = (id: string) => (fil.get(id) || []).filter(e => e.sens === 'out' && e.m.t === 'µgame:resync').length
// une à la fois : chaque µgame:resync part après la réponse (µ:ack) du précédent
function uneALaFois(id: string): boolean {
  let attendue: any = null
  for (const e of fil.get(id) || []) {
    if (e.sens === 'out' && e.m.t === 'µgame:resync') {
      if (attendue !== null) return false
      attendue = e.m.id
    }
    else if (e.sens === 'in' && e.m.t === 'µ:ack' && e.m.id === attendue) attendue = null
  }
  return true
}

describe('µ.lockstep — reprises bornées après un apply() qui lève', function () {
  this.timeout(20000)
  let app: any = null
  beforeEach(async () => {
    ;(globalThis as any).WebSocket = fabrique
    transport = new MemoryTransport()
    fil.clear()
    decalage = 0
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    app.game('rts', { mode: 'lockstep', seats: 2, code: true, tick: 30, seatTtl: 3000, emptyTtl: 5000, moves: {} })
    await app.listen()
  })
  afterEach(async () => { await app.stop() })

  // un joueur ; `leve(o)` : vrai quand apply() doit lever pour cet ordre, après en avoir appliqué une partie
  async function joueur(id: string, code: any, leve: (o: any) => boolean) {
    const erreurs: string[] = [], evenements: any[] = []
    const µ: any = { state: (i: any) => ({ ...i }), error: (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }, warn: () => {}, log: () => {} }
    poserMessages(µ)
    new Function('µ', 'Date', runtime)(µ, Horloge)
    const sock = µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
    sock.connect()
    await attendre(() => sock.state === 'open', id + ' connecté')
    const partie = sock.game('rts', { code })
    partie.on('event', (e: any) => { evenements.push(e) })
    const etat: any = µ.lockstep(partie, {
      state0: () => ({ n: 0, somme: 0 }),
      apply: (s: any, o: any) => { s.n++; if (leve(o)) throw new Error('défaut du jeu'); s.somme += etat.rng.int(1, 1000) + o.p.dx },
      every: 0,
    })
    await attendre(() => partie.state.status === 'playing', id + ' assis')
    return { sock, partie, etat, erreurs, evenements }
  }
  const vue = (etat: any) => JSON.stringify({ n: etat.n, somme: etat.somme })
  // apply() de x lève la première fois qu'il voit un ordre (un défaut du direct : le rejeu passe)
  const premiereFois = () => { const vus = new Set<number>(); return (o: any) => { if (vus.has(o.p.dx)) return false; vus.add(o.p.dx); return true } }
  const signalees = (x: any) => x.evenements.filter((e: any) => e.type === 'divergence' && e.p && e.p.reason === 'apply-threw')

  it('apply() lève en direct à chaque nouvel ordre chez x seul : trois reprises au plus, une à la fois, puis l\'erreur dite et la partie signalée', async () => {
    const x = await joueur('x', true, premiereFois())
    const y = await joueur('y', x.partie.state.code, () => false)
    for (let i = 1; i <= 10; i++) { y.partie.move('m', { dx: i }); await pause(60) }
    await attendre(() => y.etat.n === 10 && x.etat.n >= 10, () => 'les 10 ordres joués (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ')')
    await pause(200)
    assert.ok(resyncs('x') <= 3, 'au plus trois reprises : ' + resyncs('x'))
    assert.ok(resyncs('x') >= 1, 'au moins une reprise')
    assert.ok(uneALaFois('x'), 'une reprise à la fois')
    assert.equal(signalees(x).length, 1, 'partie signalée une fois : ' + JSON.stringify(x.evenements))
    assert.equal(typeof signalees(x)[0].p.tick, 'number')
    assert.equal(x.erreurs.filter(e => /apply\(\) a levé une erreur au tick \d+ :/.test(e)).length, 1, 'erreur du défaut dite une fois : ' + JSON.stringify(x.erreurs))
    assert.equal(x.erreurs.filter(e => /3 reprises de l'état en 60 s/.test(e)).length, 1, 'plafond dit une fois : ' + JSON.stringify(x.erreurs))
    assert.equal(resyncs('y'), 0)
    assert.deepEqual(y.erreurs, [])
    x.sock.destroy(); y.sock.destroy()
  })

  it('rejeu qui a levé une fois (défaut commun à tous), puis défaut du direct chez x seul : l\'état de x est repris, égal à celui de y', async () => {
    let x5 = 0
    const x = await joueur('x', true, (o: any) => o.p.dx === 99 || (o.p.dx === 5 && x5++ === 0))
    const y = await joueur('y', x.partie.state.code, (o: any) => o.p.dx === 99)
    for (const dx of [99, 1, 2]) { y.partie.move('m', { dx }); await pause(60) }
    await attendre(() => x.etat.n === 3 && y.etat.n === 3 && vue(x.etat) === vue(y.etat), () => 'défaut commun : mêmes états (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ')')
    const avant = resyncs('x')
    for (const dx of [5, 6, 7]) { y.partie.move('m', { dx }); await pause(60) }
    await attendre(() => x.etat.n === 6 && y.etat.n === 6 && vue(x.etat) === vue(y.etat), () => 'défaut du direct chez x : état repris, égal à y (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ', reprises ' + resyncs('x') + ')')
    assert.equal(resyncs('x'), avant + 1, 'une reprise de plus pour le défaut du direct')
    assert.equal(signalees(x).length, 1, 'le rejeu du défaut commun signalé une fois, pas de nouveau au rejeu suivant, qui lève au même ordre : ' + JSON.stringify(x.evenements))
    x.sock.destroy(); y.sock.destroy()
  })

  it('plafond atteint, puis la minute passée : la reprise attendue part au tick suivant et l\'état de x redevient celui de y', async () => {
    const x = await joueur('x', true, premiereFois())
    const y = await joueur('y', x.partie.state.code, () => false)
    for (let i = 1; i <= 4; i++) { y.partie.move('m', { dx: i }); await pause(60) }
    await attendre(() => y.etat.n === 4 && x.etat.n >= 4, 'les 4 ordres joués')
    await pause(200)
    assert.equal(resyncs('x'), 3, 'trois reprises, la quatrième attend')
    assert.equal(signalees(x).length, 1, 'partie signalée')
    assert.notEqual(vue(x.etat), vue(y.etat), 'état de x faux en attendant')
    decalage = 61000
    await attendre(() => resyncs('x') === 4, 'la reprise attendue part')
    await attendre(() => vue(x.etat) === vue(y.etat), () => 'état repris (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ')')
    assert.ok(uneALaFois('x'))
    x.sock.destroy(); y.sock.destroy()
  })
})
