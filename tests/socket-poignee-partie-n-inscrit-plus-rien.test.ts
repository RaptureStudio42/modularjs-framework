// Une poignée de salon déjà partie (`leave()` fait, par exemple à la destruction de son composant) : un `on()` ou un
// `onLeft()` appelé ensuite (rappel d'une requête qui arrive tard) s'inscrivait quand même sur la connexion partagée —
// appelé tant qu'une autre poignée tenait le salon, ou de nouveau quand il était rejoint, et retenu jusqu'à la purge
// suivante (pour toujours si le salon restait quitté). Il n'inscrit plus rien ; en développement, une trace le dit (texte
// en français et en anglais), et le build de production la retire avec son texte, comme les autres traces.
// Faux WebSocket, pour voir exactement ce que le client envoie.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { cutRuntimeTraces, TRACE_ONLY_MESSAGES } from '../src/bundler/minify.js'

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

// traces de développement relevées (µ._mjs_logger rend µ.log au niveau 'log'), clés de texte demandées
function connecter(url: string): { s: any, ws: FauxWS, traces: string[], cles: string[] } {
  const traces: string[] = []
  const cles: string[] = []
  const µ: any = { state: (i: any) => ({ ...i }), error() {}, warn() {}, log() {} }
  µ._mjs_logger = () => (...a: any[]) => { traces.push(a.join(' ')) }
  µ._mjs_txt = (k: string, v: any, fr: string) => { cles.push(k); return fr.replace(/\{(\w+)\}/g, (m: string, n: string) => (v && n in v ? String(v[n]) : m)) }
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 } })
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { s, ws, traces, cles }
}

const exclure = (ws: FauxWS, salon: string): void => ws.recevoir({ t: 'µ:left', p: { room: salon, reason: 'kick' } })

// la connexion retient-elle encore cette valeur ? parcours de tout ce qu'elle référence
function retient(racine: any, cible: any): boolean {
  const vus = new Set<any>()
  const pile: any[] = [racine]
  while (pile.length) {
    const o = pile.pop()
    if (o === cible) return true
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || vus.has(o)) continue
    vus.add(o)
    for (const k of Object.keys(o)) pile.push(o[k])
  }
  return false
}

describe('µ.socket — une poignée de salon partie n\'inscrit plus rien', () => {
  beforeEach(() => { FauxWS.tous = [] })
  after(() => { (globalThis as any).WebSocket = avant })

  it('on() après leave(), salon encore tenu par une autre poignée : rien d\'inscrit, jamais appelé', () => {
    const { s, ws } = connecter('wss://partie/on')
    const autre = s.room('salle')
    const h = s.room('salle')
    h.leave()
    const appels: any[] = []
    const ecoute = (p: any) => appels.push(p)
    const off = h.on('coup', ecoute)
    assert.equal(typeof off, 'function', 'la fonction rendue reste appelable')
    assert.equal(retient(s, ecoute), false, 'la connexion ne retient pas le rappel')
    assert.equal(Object.keys(s._mjs_subs).includes('salle/coup'), false, 'aucun abonnement envoyé au serveur')
    const neuve: any[] = []
    autre.on('coup', (p: any) => neuve.push(p))
    ws.recevoir({ t: 'salle/coup', p: { n: 1 } })
    assert.deepEqual(appels, [], 'la poignée partie n\'est pas appelée')
    assert.deepEqual(neuve, [{ n: 1 }], 'la poignée encore là l\'est')
    assert.doesNotThrow(() => off())
    ws.recevoir({ t: 'salle/coup', p: { n: 2 } })
    assert.deepEqual(neuve, [{ n: 1 }, { n: 2 }], 'la fonction rendue ne retire rien à la poignée encore là')
  })

  it('onLeft() après leave(), salon encore tenu par une autre poignée : une exclusion ne l\'appelle pas', () => {
    const { s, ws } = connecter('wss://partie/onleft')
    const autre = s.room('salle')
    const h = s.room('salle')
    const vus: string[] = []
    autre.onLeft(() => vus.push('autre'))
    h.leave()
    const tardif = () => vus.push('partie')
    h.onLeft(tardif)
    assert.equal(retient(s, tardif), false, 'la connexion ne retient pas le rappel')
    exclure(ws, 'salle')
    assert.deepEqual(vus, ['autre'])
  })

  it('salon quitté par sa dernière poignée puis rejoint : on() et onLeft() tardifs de l\'ancienne ne reviennent pas', () => {
    const { s, ws } = connecter('wss://partie/rejoint')
    const h = s.room('salle')
    h.leave()
    const vus: string[] = []
    h.on('coup', () => vus.push('coup ancien'))
    h.onLeft(() => vus.push('exclusion ancienne'))
    const neuve = s.room('salle')
    neuve.on('coup', () => vus.push('coup neuf'))
    neuve.onLeft(() => vus.push('exclusion neuve'))
    ws.recevoir({ t: 'salle/coup', p: {} })
    exclure(ws, 'salle')
    assert.deepEqual(vus, ['coup neuf', 'exclusion neuve'])
  })

  it('en développement, chaque appel tardif le dit, avec la méthode et le salon ; une poignée encore là ne dit rien', () => {
    const { s, traces, cles } = connecter('wss://partie/trace')
    const h = s.room('salle')
    h.on('coup', () => {})
    h.onLeft(() => {})
    assert.deepEqual(traces, [], 'rien tant que la poignée est là')
    h.leave()
    h.on('coup', () => {})
    h.onLeft(() => {})
    assert.equal(traces.length, 2, traces.join('\n'))
    assert.match(traces[0], /on\(\)/)
    assert.match(traces[1], /onLeft\(\)/)
    for (const t of traces) assert.match(t, /salle/)
    assert.deepEqual(cles.filter(k => k === 'sockHandleGone').length, 2)
  })

  it('le texte existe en français et en anglais, avec les mêmes variables', () => {
    const fr = (RUNTIME_LABELS as any).fr.err.sockHandleGone
    const en = (RUNTIME_LABELS as any).en.err.sockHandleGone
    assert.equal(typeof fr, 'string')
    assert.equal(typeof en, 'string')
    const vars = (t: string): string[] => (t.match(/\{\w+\}/g) || []).sort()
    assert.deepEqual(vars(en), vars(fr))
    assert.deepEqual(vars(fr), ['{fn}', '{room}'].sort())
  })

  it('en production, la trace part avec son texte : ni l\'appel ni la clé dans le code construit', () => {
    assert.ok(TRACE_ONLY_MESSAGES.includes('sockHandleGone'), 'clé lue par la seule trace : retirée des fichiers de messages')
    assert.ok(SRC.includes('sockHandleGone'), 'la trace est dans la source')
    const prod = transformSync(cutRuntimeTraces(SRC), { loader: 'ts', minify: true, define: { MJS_TRACE: 'null' } }).code
    assert.equal(prod.includes('sockHandleGone'), false, 'trace retirée')
    assert.ok(prod.includes('sockSendDropped'), 'un avertissement ordinaire reste')
  })
})
