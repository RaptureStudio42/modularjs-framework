// µ.interp, µ.predict, µ.optimistic, µ.smooth et µ.spring copient des données venues du serveur ou de l'auteur. Une clé
// `__proto__` de ces données (JSON.parse en fait une clé propre) devenait le prototype de la copie : la copie « héritait » de
// champs qu'elle n'avait pas (`admin: true`), et la clé disparaissait des données (un coup prédit partait sans elle). Elle
// reste désormais une clé comme une autre. Les comparaisons qui décident de republier un miroir cherchaient une clé par `in`,
// qui la trouve sur le prototype : une entité ou un champ nommé `constructor` ou `toString` disparu du serveur restait affiché.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
const J = (s: string): any => JSON.parse(s)
const P = Object.prototype
const attendre = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function µbase(): any {
  return { state: (i: any) => ({ ...i }), warn() {}, error() {}, log() {}, _mjs_txt: (_k: string, _v: any, fr: string) => fr, _mjs_logger: () => null }
}
// la donnée est rangée en clé propre, le prototype de la copie reste celui d'un objet ordinaire
function cleGardee(o: any, nom: string): void {
  assert.equal(Object.getPrototypeOf(o), P, nom + ' : prototype intact')
  assert.ok(P.hasOwnProperty.call(o, '__proto__'), nom + ' : clé __proto__ gardée')
  assert.equal(o.admin, undefined, nom + ' : rien d\'hérité')
}
function partie(state: any): any {
  const hs: Record<string, Function> = {}
  return { hs, state, envoyes: [] as any[], move(_n: string, p: any) { this.envoyes.push(p); return Promise.resolve() }, on(n: string, f: Function) { hs[n] = f; return () => {} } }
}

describe('copies de données — une clé `__proto__` reste une clé, une clé disparue disparaît', () => {
  it('µ.interp : id et champ `__proto__` gardés ; entité `constructor` et champ `toString` retirés quand le serveur les retire', async () => {
    const µ = µbase(); new Function('µ', lire('mjs_interp.ts'))(µ)
    const g = partie({ e: J('{"a":{"x":1},"__proto__":{"x":5,"admin":true},"b":{"x":1,"__proto__":{"admin":true}}}') })
    const vue = µ.interp(g, { fields: ['e'], delay: 0 })
    try {
      await attendre(40)
      cleGardee(vue.e, 'dict')
      cleGardee(vue.e.b, 'entité')
      g.state.e = J('{"a":{"x":1,"toString":3},"constructor":{"x":2}}'); g.hs.state({}); await attendre(40)
      assert.ok(P.hasOwnProperty.call(vue.e, 'constructor'))
      g.state.e = J('{"a":{"x":1}}'); g.hs.state({}); await attendre(40)
      assert.deepEqual(Object.keys(vue.e), ['a'])
      assert.deepEqual(Object.keys(vue.e.a), ['x'])
    }
    finally { vue.stop() }
  })

  it('µ.predict : fragment et coup numéroté gardent `__proto__` ; champ `constructor` retiré quand le serveur le retire', () => {
    const µ = µbase(); new Function('µ', lire('mjs_predict.ts'))(µ)
    const g = partie({ moi: J('{"x":1,"__proto__":{"admin":true}}') })
    let vu: any = null
    const m = µ.predict(g, { fields: ['moi'], apply: (f: any) => { vu = f.moi } })
    try {
      cleGardee(m.moi, 'miroir')
      g.move('bouger', J('{"dx":1,"__proto__":{"admin":true}}'))
      cleGardee(vu, 'fragment rendu à apply')
      cleGardee(g.envoyes[0], 'coup envoyé')
      assert.ok(JSON.stringify(g.envoyes[0]).includes('"__proto__"'), 'le coup part avec sa clé')
      g.state.moi = J('{"x":1,"constructor":2}'); g.hs.state({ _ack: 1 })
      g.state.moi = J('{"x":1}'); g.hs.state({ _ack: 1 })
      assert.deepEqual(Object.keys(m.moi), ['x'])
    }
    finally { m.stop() }
  })

  it('µ.optimistic : le brouillon garde `__proto__` ; une clé `toString` retirée par le nouvel état quitte le store', () => {
    const µ = µbase(); new Function('µ', lire('mjs_optimistic.ts'))(µ)
    const store = µ.state({ n: 0, items: J('{"a":{"__proto__":{"admin":true}}}') })
    µ.optimistic(store, { apply: (s: any) => { s.n = 1 }, via: () => new Promise(() => {}) })
    assert.equal(store.n, 1)
    cleGardee(store.items.a, 'valeur republiée')
    const brut = J('{"n":0,"__proto__":{"admin":true}}')
    µ.optimistic(brut, { apply: (s: any) => { s.n = 1 }, via: () => new Promise(() => {}) })
    cleGardee(brut, 'store de premier niveau')
    const s3: any = { n: 0, toString: 1 }
    µ.optimistic(s3, { apply: () => ({ n: 1 }), via: () => new Promise(() => {}) })
    assert.deepEqual(Object.keys(s3), ['n'])
  })

  it('µ.smooth : échantillon et interpolation gardent `__proto__` ; une entité `toString` retirée de la source quitte la sortie', () => {
    const µ = µbase(); let tache: any = null
    µ.Ticker = { add: (t: any) => { tache = t }, remove() {} }
    new Function('µ', lire('mjs_smooth.ts'))(µ)
    const source: any = { a: J('{"x":0,"__proto__":{"admin":true}}'), toString: { x: 1 } }
    const out = µ.smooth(source, { delay: 0 })
    tache._mjs_step(Date.now())
    cleGardee(out.a, 'échantillon')
    assert.ok(P.hasOwnProperty.call(out, 'toString'))
    cleGardee(µ._mjs_smoothLerp({ x: 0 }, J('{"x":10,"__proto__":{"admin":true}}'), 0.5), 'interpolation')
    assert.equal(µ._mjs_smoothEq({ x: 1, constructor: 2 }, { x: 1 }), false)
    delete source.toString
    tache._mjs_step(Date.now())
    assert.equal(P.hasOwnProperty.call(out, 'toString'), false)
  })

  it('µ.spring : la valeur animée garde `__proto__` comme une clé', () => {
    const µ: any = { _mjs_interpolatorSet: new WeakSet(), Ticker: { add() {} } }
    new Function('µ', lire('mjs_spring.ts'))(µ)
    const s = µ.spring(J('{"x":0,"__proto__":{"admin":true}}'), 0.3, 0.5)
    cleGardee(s.current, 'valeur de départ')
    s.value = J('{"x":10,"__proto__":{"admin":true}}')
    for (let i = 0; i < 5000 && s._mjs_step(); i++) {}
    cleGardee(s.current, 'valeur animée')
    assert.ok(Math.abs(s.current.x - 10) < 0.5, 'x=' + s.current.x)
  })
})
