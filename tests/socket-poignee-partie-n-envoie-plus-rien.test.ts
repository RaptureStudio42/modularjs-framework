// Une poignée de salon déjà partie (`leave()` fait, par exemple à la destruction de son composant) : `stream()` et
// `presence()` abonnaient encore la connexion partagée au salon (et l'y réabonnaient à chaque reconnexion, même salon
// quitté), `send()` et `request()` partaient encore en son nom. Plus rien ne part : `stream()` et `presence()` rendent un
// magasin qui ne reçoit rien, `send()` est sans effet, `request()` rend une promesse rejetée (`code: 'left'`). En
// développement, la même trace que pour `on()` et `onLeft()` le dit ; une poignée encore là marche comme avant.
// Faux WebSocket, pour voir exactement ce que le client envoie.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

class FauxWS {
  static tous: FauxWS[] = []
  url: string; readyState = 0; envoyes: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; FauxWS.tous.push(this) }
  send(data: string) { this.envoyes.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  recevoir(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
}

const avant   = (globalThis as any).WebSocket
const dernier = (): FauxWS => FauxWS.tous[FauxWS.tous.length - 1]
const ouverts: any[] = []

// traces de développement relevées (µ._mjs_logger rend µ.log au niveau 'log'), clés de texte demandées
function connecter(url: string): { s: any, ws: FauxWS, traces: string[], cles: string[] } {
  const traces: string[] = []
  const cles: string[] = []
  const µ: any = { state: (i: any) => ({ ...i }), error() {}, warn() {}, log() {} }
  µ._mjs_logger = () => (...a: any[]) => { traces.push(a.join(' ')) }
  µ._mjs_txt = (k: string, v: any, fr: string) => { cles.push(k); return fr.replace(/\{(\w+)\}/g, (m: string, n: string) => (v && n in v ? String(v[n]) : m)) }
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { enabled: false } })
  ouverts.push(s)
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { s, ws, traces, cles }
}

// trames parties qui parlent du salon, depuis l'indice `n` du journal du faux WebSocket
const duSalon = (ws: FauxWS, n: number, salon: string): any[] => ws.envoyes.slice(n).filter(f => JSON.stringify(f).includes(salon))

describe('µ.socket — une poignée de salon partie n\'envoie plus rien', () => {
  beforeEach(() => { FauxWS.tous = [] })
  // connexions fermées même si un test échoue : aucune minuterie ne survit au fichier
  afterEach(() => { while (ouverts.length) ouverts.pop().destroy() })
  after(() => { (globalThis as any).WebSocket = avant })

  it('stream() et presence() après leave(), salon encore tenu par une autre poignée : aucun abonnement', () => {
    const { s, ws } = connecter('wss://partie/flux')
    s.room('salle')
    const h = s.room('salle')
    h.leave()
    const n = ws.envoyes.length
    const flux = h.stream('score')
    const pres = h.presence()
    assert.equal(typeof flux, 'object', 'un magasin reste rendu')
    assert.equal(typeof pres, 'object', 'un magasin reste rendu')
    assert.deepEqual(ws.envoyes.slice(n), [], 'rien n\'est parti vers le serveur')
    assert.equal('salle/score' in s._mjs_streams, false, 'aucun flux inscrit')
    assert.equal('salle' in s._mjs_presence, false, 'aucune présence inscrite')
    assert.deepEqual(Object.keys(s._mjs_subs).filter(k => k.includes('salle')), [])
    ws.recevoir({ t: 'salle/score', p: { op: 'add', key: 'a', value: 1 }, seq: 1 })
    assert.deepEqual({ ...flux }, {}, 'le magasin de la poignée partie ne reçoit rien')
  })

  it('salon quitté par sa dernière poignée : stream() et presence() tardifs ne reviennent pas au prochain accueil', () => {
    const { s, ws } = connecter('wss://partie/reprise')
    const h = s.room('salle')
    h.leave()
    h.stream('score')
    h.presence()
    const n = ws.envoyes.length
    // l'accueil d'une reconnexion réabonne tout ce que la connexion retient
    ws.recevoir({ t: 'µ:welcome', p: {} })
    assert.deepEqual(duSalon(ws, n, 'salle'), [], 'ni flux, ni présence, ni salon réabonnés')
  })

  it('send() après leave() : rien ne part, rien n\'attend', () => {
    const { s, ws } = connecter('wss://partie/envoi')
    s.room('salle')
    const h = s.room('salle')
    h.leave()
    const n = ws.envoyes.length
    assert.equal(h.send('coup', { c: 1 }), false)
    h.send('coup', { c: 2 }, { debounce: 5 })
    h.send('coup', { c: 3 }, { coalesce: 5 })
    assert.deepEqual(ws.envoyes.slice(n), [], 'rien n\'est parti')
    assert.deepEqual(s._mjs_queue, [], 'rien en file')
    assert.deepEqual(Object.keys(s._mjs_debounce), [], 'aucun envoi différé')
    assert.deepEqual(Object.keys(s._mjs_coalesce), [], 'aucun envoi regroupé')
  })

  it('request() après leave() : promesse rejetée (code left), rien ne part, rien n\'attend de réponse', async () => {
    const { s, ws } = connecter('wss://partie/requete')
    const h = s.room('salle')
    h.leave()
    const n = ws.envoyes.length
    await assert.rejects(h.request('question', { q: 1 }), (e: any) => {
      assert.equal(e.code, 'left')
      assert.match(e.message, /salle/)
      return true
    })
    assert.deepEqual(ws.envoyes.slice(n), [], 'rien n\'est parti')
    assert.deepEqual(Object.keys(s._mjs_reqs), [], 'aucune requête en attente')
  })

  it('une poignée encore là : stream(), presence(), send() et request() partent comme avant', async () => {
    const { s, ws } = connecter('wss://partie/vivante')
    const h = s.room('salle')
    const n = ws.envoyes.length
    h.stream('score')
    h.presence()
    h.send('coup', { c: 1 })
    const r = h.request('question', { q: 1 })
    const parties = ws.envoyes.slice(n)
    assert.deepEqual(parties.map(f => f.t), ['µ:sub-stream', 'µ:sub-presence', 'salle/coup', 'salle/question'])
    ws.recevoir({ t: 'µ:ack', id: parties[3].id, p: { ok: true } })
    assert.deepEqual(await r, { ok: true })
  })

  it('en développement, chaque appel tardif le dit, avec la méthode et le salon ; une poignée encore là ne dit rien', async () => {
    const { s, traces, cles } = connecter('wss://partie/trace')
    const h = s.room('salle')
    h.stream('score')
    h.presence()
    h.send('coup', {})
    assert.deepEqual(traces, [], 'rien tant que la poignée est là')
    h.leave()
    h.stream('score')
    h.presence()
    h.send('coup', {})
    await h.request('question', {}).catch(() => {})
    assert.equal(traces.length, 4, traces.join('\n'))
    ;['stream', 'presence', 'send', 'request'].forEach((fn, i) => assert.match(traces[i], new RegExp(fn + '\\(\\)')))
    for (const t of traces) assert.match(t, /salle/)
    assert.equal(cles.filter(k => k === 'sockHandleGone').length, 4)
  })
})
