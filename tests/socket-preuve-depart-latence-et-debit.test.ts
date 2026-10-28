// µ.socket — la preuve du départ d'un salon ne fausse plus l'écart entre battements que relève le serveur, et n'ajoute aucune trame
// à une boucle rejoindre / quitter. Le client envoyait un µ:ping de preuve un quart de seconde après chaque départ : le serveur, qui
// relève l'écart entre deux µ:ping reçus (`client.latency`, lu par `game.timeSeenBy`), en tirait un écart de quelques millisecondes
// (battement de 300 ms : 18 ms), et une boucle rejoindre / quitter toutes les 300 ms envoyait moitié plus de trames, assez pour qu'un
// limiteur serré (rate 8, burst 4, kickAfter 2) expulse le client au septième tour. Maintenant, toute réponse du serveur à une trame
// partie après le départ le prouve (le µ:pong d'un battement, le µ:ack d'une requête) ; faute de quoi, le µ:ping de preuve ne part
// qu'après une seconde sans aucun envoi (ou dès dix départs qu'aucun µ:ping n'a suivis), marqué `early` : le battement repart de
// lui, le serveur n'en relève aucun écart. Vrai serveur MJS-WS sur le transport mémoire, vrais clients
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src   = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

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
function client(id: string, heartbeat: number): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', src)(µ)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false }, heartbeat })
}
const pings   = (id: string) => liste(sortants, id).filter(m => m.t === 'µ:ping')
const retenus = (s: any) => Object.keys(s._mjs_roomLeaves).length
// l'écart que relève le serveur (`client.latency`) après chaque µ:ping reçu, lu toutes les 5 ms pendant `ms` (aucun tant qu'il n'en
// a relevé aucun)
async function ecarts(cote: any, ms: number): Promise<number[]> {
  const vus: number[] = [], t0 = Date.now()
  let dernier = cote.lastPingAt
  while (Date.now() - t0 < ms) {
    if (cote.lastPingAt !== dernier) { dernier = cote.lastPingAt; if (cote.latency != null) vus.push(cote.latency) }
    await pause(5)
  }
  return vus
}

describe('µ.socket — preuve du départ d\'un salon : ni écart faussé chez le serveur, ni trame de plus', function () {
  this.timeout(30000)
  let app: any = null, cote: any = null
  beforeEach(() => { (globalThis as any).WebSocket = fabrique; transport = new MemoryTransport(); recus.clear(); sortants.clear(); cote = null })
  afterEach(async () => { if (app) await app.stop(); app = null })
  const serveur = async (opts: any = {}) => {
    app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, welcome: (c: any) => { cote = c; return {} }, onLog: () => {}, ...opts } as any)
    await app.listen()
  }

  it('battement de 300 ms, départ juste après un battement : le battement suivant le prouve, l\'écart relevé par le serveur reste sa période', async () => {
    await serveur()
    const a = client('a', 300)
    const s = a.room('salle')
    a.connect()
    await attendre(() => app.room('salle').size === 1 && cote, 'dans le salon')
    await attendre(() => pings('a').length >= 2, { message: 'deux battements', delai: 3000 })
    const n = pings('a').length
    await attendre(() => pings('a').length === n + 1, { message: 'battement suivant', delai: 1000 })
    s.leave()
    const vus = await ecarts(cote, 1300)
    assert.ok(vus.length >= 3, 'écarts relevés : ' + JSON.stringify(vus))
    assert.ok(Math.min(...vus) >= 200, 'AVANT : un écart de quelques ms après le départ — relevés ' + JSON.stringify(vus))
    assert.equal(pings('a').filter(m => m.p && m.p.early).length, 0, 'aucun µ:ping de preuve : le battement suffit')
    assert.equal(retenus(a), 0, 'départ prouvé')
    a.destroy()
  })

  it('battement de 1 200 ms, départ juste après un battement : un µ:ping de preuve marqué, le battement repart de lui, aucun écart faussé', async () => {
    await serveur()
    const a = client('a', 1200)
    const s = a.room('salle')
    a.connect()
    await attendre(() => app.room('salle').size === 1 && cote, 'dans le salon')
    await attendre(() => pings('a').length === 1, { message: 'premier battement', delai: 3000 })
    s.leave()
    const vus = await ecarts(cote, 2700)
    const preuves = pings('a').filter(m => m.p && m.p.early === true)
    assert.equal(preuves.length, 1, 'un µ:ping de preuve, marqué early : ' + JSON.stringify(pings('a')))
    assert.ok(vus.length >= 1, 'un écart relevé après le départ : ' + JSON.stringify(vus))
    assert.ok(Math.min(...vus) >= 1000, 'AVANT : 250 ms puis 950 ms — relevés ' + JSON.stringify(vus))
    assert.equal(retenus(a), 0, 'départ prouvé')
    a.destroy()
  })

  it('sans battement, deux départs l\'un après l\'autre : deux µ:ping de preuve marqués, le serveur n\'en relève aucun écart', async () => {
    await serveur()
    const a = client('a', 0)
    a.connect()
    await attendre(() => a.state === 'open' && cote, 'ouvert')
    for (const nom of ['un', 'deux']) {
      const h = a.room(nom)
      await attendre(() => app.room(nom).size === 1, nom)
      h.leave()
      await attendre(() => retenus(a) === 0, { message: 'départ de ' + nom + ' prouvé', delai: 2500 })
    }
    assert.deepEqual(pings('a').map(m => m.p && m.p.early), [true, true], 'AVANT : deux µ:ping sans marque')
    assert.equal(cote.latency, null, 'AVANT : l\'écart entre les deux preuves, relevé comme une période du battement')
    a.destroy()
  })

  it('limiteur serré (rate 8, burst 4, kickAfter 2), boucle rejoindre / quitter toutes les 300 ms : douze tours sans erreur, pas une trame de plus, puis une seule preuve', async () => {
    await serveur({ limits: { rate: 8, burst: 4, kickAfter: 2 } })
    const a = client('a', 0)
    a.connect()
    await attendre(() => a.state === 'open', 'ouvert')
    let tours = 0
    for (; tours < 12 && a.state === 'open'; tours++) { const h = a.room('boucle'); await pause(1); h.leave(); await pause(299) }
    const envoyes = liste(sortants, 'a').filter(m => m.t !== 'µ:hello').map(m => m.t)
    const erreurs = liste(recus, 'a').filter(f => f.t === 'µ:error').map(f => f.p && f.p.message)
    assert.equal(tours, 12, 'AVANT : expulsé au septième tour — erreurs ' + JSON.stringify(erreurs))
    assert.equal(a.state, 'open')
    assert.deepEqual(erreurs, [])
    assert.equal(envoyes.length, 24, 'un µ:join et un µ:leave par tour, rien d\'autre : ' + JSON.stringify(envoyes))
    await attendre(() => retenus(a) === 0, { message: 'dernier départ prouvé, la ligne calme', delai: 2500 })
    assert.equal(pings('a').length, 1, 'une seule preuve, après la boucle')
    assert.equal(app.stats().garde.kicksDebit, 0)
    a.destroy()
  })

  it('dix salons quittés à la suite, la ligne occupée : le µ:ping de preuve part au dixième départ, sans attendre qu\'elle se calme', async () => {
    await serveur()
    const a = client('a', 0)
    a.connect()
    await attendre(() => a.state === 'open', 'ouvert')
    for (let i = 0; i < 10; i++) {
      const h = a.room('r' + i)
      await attendre(() => app.room('r' + i).size === 1, 'r' + i)
      h.leave()
    }
    const types = liste(sortants, 'a').map(m => m.t)
    assert.equal(pings('a').length, 1, 'un µ:ping aussitôt : ' + JSON.stringify(types))
    assert.equal(types[types.length - 1], 'µ:ping', 'parti juste après le dixième µ:leave')
    assert.equal(pings('a')[0].p.early, true)
    await attendre(() => retenus(a) === 0, { message: 'les dix départs prouvés', delai: 500 })
    a.destroy()
  })

  it('une requête partie après le départ le prouve par sa réponse : aucun µ:ping', async () => {
    await serveur()
    app.serve('echo', (p: any) => p)
    const a = client('a', 0)
    const s = a.room('salle')
    a.connect()
    await attendre(() => app.room('salle').size === 1, 'dans le salon')
    s.leave()
    assert.deepEqual(await a.request('echo', { v: 1 }), { v: 1 })
    assert.equal(retenus(a), 0, 'AVANT : le départ attendait son µ:ping de preuve')
    await pause(1300)
    assert.equal(pings('a').length, 0, 'AVANT : un µ:ping de preuve en plus')
    a.destroy()
  })
})
