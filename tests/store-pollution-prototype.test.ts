// Pollution de prototype (CWE-1321) via un store/état réactif :
//
// - µ.Store ET µ.state : lire __proto__/constructor/prototype à travers
//   un proxy réactif enveloppait la valeur HÉRITÉE (Object.prototype pour
//   __proto__), qu'on pouvait ensuite muter — la pollution atteint TOUS les
//   objets du realm. Fix : dans chaque piège get, si la clé n'est PAS une
//   propriété PROPRE de la cible, rendre undefined. Une clé de CE nom posée
//   explicitement dans les données (propriété propre, ex. { constructor: 'Ferrari' })
//   continue de fonctionner normalement (registre à clés arbitraires).
// - µ.state : le proxy RACINE n'avait pas la garde de clé (_guardKey)
//   des proxys imbriqués : state.__proto__ = x remplaçait le prototype de l'état
//   sans le moindre avertissement. Même garde à la racine, pour set ET
//   defineProperty/deleteProperty.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function mount(name: string) {
  const root = mjsTmp(`store-proto-${name}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  const src = ['<script lang="coffee">', '@dummy = new µStore({})', '</script>', '<p>x</p>'].join('\n') + '\n'
  writeFileSync(join(srcDir, `${name}.mjs`), src)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const window: any = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  const files = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const compFile = files.find((f: string) => new RegExp(`^${name}-`).test(f))
  assert.ok(coreFile && compFile, 'core + composant compilés')

  const stripEsm = (s: string) => s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+/g, '')
    .replace(/import\.meta\.url/g, "'http://localhost/'")
  window.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)
  document.body.innerHTML = `<mjs-${name}></mjs-${name}>`
  await new Promise(r => setTimeout(r, 80))
  return { window, document }
}

describe('µ.Store — lire __proto__/constructor hérité rend undefined (pas de pollution)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('store.data.__proto__ est undefined ; store.data[k1][k2]=v avec k1="__proto__" est impossible', async () => {
    const { window } = await mount('storeprotoroot')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ obj: { x: 0 } })
      globalThis.result.protoIsUndefined = store.data.obj.__proto__ === undefined
      var k1 = '__proto__'
      var k2 = 'injectedByStore'
      try { store.data.obj[k1][k2] = 'PWNED'; globalThis.result.threw = null }
      catch (e) { globalThis.result.threw = e.name }
      globalThis.result.fuite = ({}).injectedByStore === 'PWNED'
      delete Object.prototype.injectedByStore
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.protoIsUndefined, true, 'lire __proto__ hérité à travers le proxy réactif doit rendre undefined')
    assert.equal(result.threw, 'TypeError', "écrire sur undefined[k2] doit lever — la pollution en 2 étapes doit être impossible")
    assert.equal(result.fuite, false, "Object.prototype ne doit jamais être pollué via ce chemin")
  })

  it('une donnée nommée « constructor » (propriété PROPRE, pas héritée) reste lisible et réactive', async () => {
    const { window } = await mount('storeownctor')
    // note : « constructor » reste, par ailleurs et sans lien avec ce correctif,
    // une clé refusée en ÉCRITURE directe par la garde µ._mjs_safeKey déjà en
    // place (set/deleteProperty/defineProperty, cf. mjs_store.ts) — ce test ne
    // porte que sur la LECTURE (le get trap) et sur la réactivité déclenchée
    // par la mutation d'une clé SŒUR du même objet.
    window.eval(`
      globalThis.result = { notifications: 0 }
      var store = new µ.Store({ car: { constructor: 'Ferrari', color: 'red' } })
      globalThis.result.readBefore = store.data.car.constructor
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void store.data.car.constructor
      µ.activeComponent = null
      store.data.car.color = 'blue'
      globalThis.result.readAfter = store.data.car.constructor
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.readBefore, 'Ferrari', 'une clé « constructor » posée explicitement dans les données doit se lire normalement')
    assert.equal(result.readAfter, 'Ferrari', 'et rester lisible après une mutation voisine')
    assert.equal(result.notifications, 1, 'lire cette clé doit poser un abonnement normal (pas assimilée à la clé protégée) : la mutation d\'une clé sœur du même objet notifie')
  })
})

describe('µ.state — lire __proto__/constructor hérité rend undefined (pas de pollution)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('state.obj.__proto__ est undefined ; state.obj[k1][k2]=v avec k1="__proto__" est impossible', async () => {
    const { window } = await mount('stateprotonested')
    window.eval(`
      globalThis.result = {}
      var state = µ.state({ obj: { x: 0 } })
      globalThis.result.protoIsUndefined = state.obj.__proto__ === undefined
      var k1 = '__proto__'
      var k2 = 'injectedByState'
      try { state.obj[k1][k2] = 'PWNED'; globalThis.result.threw = null }
      catch (e) { globalThis.result.threw = e.name }
      globalThis.result.fuite = ({}).injectedByState === 'PWNED'
      delete Object.prototype.injectedByState
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.protoIsUndefined, true, 'lire __proto__ hérité à travers le proxy réactif doit rendre undefined')
    assert.equal(result.threw, 'TypeError', 'écrire sur undefined[k2] doit lever')
    assert.equal(result.fuite, false, 'Object.prototype ne doit jamais être pollué via ce chemin')
  })

  it('state.__proto__ (racine) est aussi undefined (pas seulement les niveaux imbriqués)', async () => {
    const { window } = await mount('staterootgetguard')
    window.eval(`
      globalThis.result = {}
      var state = µ.state({ a: 1 })
      globalThis.result.protoIsUndefined = state.__proto__ === undefined
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.protoIsUndefined, true, 'la racine doit suivre la MÊME garde que les proxys imbriqués')
  })

  it('une donnée nommée « constructor » (propriété PROPRE) reste lisible et réactive', async () => {
    // note : écriture directe de « constructor » hors périmètre, cf. commentaire
    // jumeau côté µ.Store ci-dessus (garde µ._mjs_safeKey déjà en place, non liée
    // à ce correctif) — on vérifie la LECTURE et la réactivité sur une clé sœur.
    const { window } = await mount('stateownctor')
    window.eval(`
      globalThis.result = { notifications: 0 }
      var state = µ.state({ car: { constructor: 'Ferrari', color: 'red' } })
      globalThis.result.readBefore = state.car.constructor
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void state.car.constructor
      µ.activeComponent = null
      state.car.color = 'blue'
      globalThis.result.readAfter = state.car.constructor
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.readBefore, 'Ferrari')
    assert.equal(result.readAfter, 'Ferrari')
    assert.equal(result.notifications, 1)
  })
})

describe('µ.state — la RACINE refuse __proto__ en écriture (set/defineProperty/deleteProperty), comme les niveaux imbriqués', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('state.__proto__ = x est refusé avec un avertissement, le prototype réel ne change pas', async () => {
    const { window } = await mount('staterootset')
    window.eval(`
      globalThis.result = { warned: 0 }
      var state = µ.state({ a: 1 })
      var evil = { injected: 42 }
      var origWarn = µ.warn
      µ.warn = function () { globalThis.result.warned++; return origWarn.apply(µ, arguments) }
      state.__proto__ = evil
      globalThis.result.protoChanged = Object.getPrototypeOf(state[µ._mjs_RAW]) === evil
      µ.warn = origWarn
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.warned, 1, 'un avertissement doit être émis (même garde que les proxys imbriqués)')
    assert.equal(result.protoChanged, false, 'le prototype réel de l\'état ne doit pas changer')
  })

  it('Object.defineProperty(state, "__proto__", …) est refusé (chemin d\'écriture différent de `set`)', async () => {
    const { window } = await mount('staterootdefine')
    window.eval(`
      globalThis.result = {}
      var state = µ.state({ a: 1 })
      var evil = { injected: 42 }
      try { Object.defineProperty(state, '__proto__', { value: evil, configurable: true }); globalThis.result.threw = null }
      catch (e) { globalThis.result.threw = e.name }
      globalThis.result.protoChanged = Object.getPrototypeOf(state[µ._mjs_RAW]) === evil
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.protoChanged, false, 'le prototype réel de l\'état ne doit pas changer')
    assert.equal(result.threw, 'TypeError', 'Object.defineProperty doit signaler un refus (trap defineProperty renvoie false)')
  })

  it('delete state.__proto__ est refusé avec un avertissement (symétrique de `set`)', async () => {
    const { window } = await mount('staterootdelete')
    window.eval(`
      globalThis.result = { warned: 0 }
      var state = µ.state({ a: 1 })
      var rawBefore = state[µ._mjs_RAW]
      var origWarn = µ.warn
      µ.warn = function () { globalThis.result.warned++; return origWarn.apply(µ, arguments) }
      delete state.__proto__
      globalThis.result.sameRaw = state[µ._mjs_RAW] === rawBefore
      µ.warn = origWarn
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.warned, 1, 'un avertissement doit être émis, même garde que `set`')
  })
})
