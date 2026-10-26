// Présence et flux face aux noms `__proto__`, `constructor` et `prototype`. Les magasins de `presence()` et de `stream()` sont
// des états réactifs (µ.state), qui refusent toujours ces trois noms : un pair ou une clé de flux de ce nom est écarté par
// l'état lui-même, seul contrôle (cf. reseau-noms-pieges-controles-une-fois-par-l-etat.test.ts, vrai runtime). Les données d'une entrée gardent, elles,
// toutes leurs clés : les champs d'une mise à jour (`update`) nommés ainsi étaient jetés sans rien dire, et un champ `__proto__`
// déjà présent dans une entrée devenait, à la mise à jour suivante, le prototype de la copie (l'entrée « héritait » de champs
// qu'elle n'avait pas). Même règle pour la charge de `welcome`, copiée sans sa session.
// Faux WebSocket : les trames du serveur sont jouées à la main.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const P = Object.prototype

class FauxWS {
  static tous: FauxWS[] = []
  url: string; readyState = 0; envoyes: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; FauxWS.tous.push(this) }
  send(data: string) { this.envoyes.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  // le texte brut : JSON.parse en fait des clés propres, `__proto__` compris, comme une vraie trame
  recevoirTexte(texte: string) { this.onmessage && this.onmessage({ data: texte }) }
  recevoir(obj: any) { this.recevoirTexte(JSON.stringify(obj)) }
}

const avant   = (globalThis as any).WebSocket
const aFermer: (() => void)[] = []

// traces : µ._mjs_logger rend un collecteur, comme au niveau de console 'log'
function connecter(url: string, welcome = '{"t":"µ:welcome","p":{}}'): { s: any, ws: FauxWS, traces: string[], cles: string[] } {
  const traces: string[] = []
  const cles: string[] = []
  const µ: any = { state: (i: any) => ({ ...i }), warn() {}, log() {}, error() {} }
  µ._mjs_logger = () => (m: string) => { traces.push(m) }
  µ._mjs_txt = (k: string, v: any, fr: string) => { cles.push(k); return fr.replace(/\{(\w+)\}/g, (_m: string, n: string) => String(v[n])) }
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { enabled: false } })
  aFermer.push(() => s.destroy())
  s.connect()
  const ws = FauxWS.tous[FauxWS.tous.length - 1]
  ws.ouvrir()
  ws.recevoirTexte(welcome)
  return { s, ws, traces, cles }
}

describe('présence et flux — les noms __proto__, constructor et prototype', () => {
  beforeEach(() => { FauxWS.tous = [] })
  afterEach(() => {
    const ratees: unknown[] = []
    while (aFermer.length) { try { aFermer.pop()!() } catch (e) { ratees.push(e) } }
    assert.deepEqual(ratees, [], 'fermetures sans erreur')
  })
  after(() => { (globalThis as any).WebSocket = avant })

  it('flux : les champs d\'une mise à jour nommés ainsi sont gardés comme des données', () => {
    const { s, ws, traces } = connecter('wss://noms/flux-champs')
    const flux = s.stream('flux')
    ws.recevoir({ t: 'flux', seq: 1, p: { op: 'add', key: 'a', value: { x: 1 } } })
    ws.recevoirTexte('{"t":"flux","seq":2,"p":{"op":"update","key":"a","patch":{"x":2,"constructor":"c","prototype":"p","__proto__":{"admin":true}}}}')
    const a = flux.a
    assert.equal(Object.getPrototypeOf(a), P, 'prototype de l\'entrée intact')
    assert.deepEqual(Object.keys(a).sort(), ['__proto__', 'constructor', 'prototype', 'x'])
    assert.equal(a.x, 2)
    assert.equal(a.constructor, 'c')
    assert.equal(a.prototype, 'p')
    assert.deepEqual(Object.getOwnPropertyDescriptor(a, '__proto__')!.value, { admin: true })
    assert.equal(a.admin, undefined, 'rien d\'hérité')
    assert.deepEqual(traces, [], 'aucune trace : rien n\'est écarté')
  })

  it('flux : un champ `__proto__` déjà dans l\'entrée reste un champ à la mise à jour suivante', () => {
    const { s, ws } = connecter('wss://noms/flux-reprise')
    const flux = s.stream('flux')
    ws.recevoirTexte('{"t":"flux","seq":1,"p":{"op":"add","key":"a","value":{"x":1,"__proto__":{"admin":true}}}}')
    ws.recevoir({ t: 'flux', seq: 2, p: { op: 'update', key: 'a', patch: { x: 2 } } })
    const a = flux.a
    assert.equal(Object.getPrototypeOf(a), P, 'prototype de l\'entrée intact')
    assert.equal(a.admin, undefined, 'rien d\'hérité')
    assert.equal(a.x, 2)
    assert.ok(P.hasOwnProperty.call(a, '__proto__'), 'le champ est toujours là')
  })

  it('welcome : la charge copiée garde un champ `__proto__` comme un champ, sans la session', () => {
    const recus: any[] = []
    const { s, ws } = connecter('wss://noms/welcome', '{"t":"µ:welcome","p":{}}')
    s.on('welcome', (p: any) => { recus.push(p) })
    ws.recevoirTexte('{"t":"µ:welcome","p":{"pseudo":"x","__proto__":{"admin":true}}}')
    const p = recus[recus.length - 1]
    assert.ok(p, 'welcome reçu')
    assert.equal(Object.getPrototypeOf(p), P, 'prototype de la charge intact')
    assert.equal(p.admin, undefined, 'rien d\'hérité')
    assert.deepEqual(Object.getOwnPropertyDescriptor(p, '__proto__')!.value, { admin: true })
    assert.equal(p.pseudo, 'x')
    assert.equal(P.hasOwnProperty.call(p, 'session'), false)
  })

  it('le client ne vérifie plus lui-même les noms de premier niveau : l\'état qui les range les refuse (un seul contrôle)', () => {
    assert.equal(SRC.includes('runesKey'), false, 'aucune trace de refus propre au client')
    assert.equal(SRC.includes('_mjs_storableKey'), false)
  })

})
