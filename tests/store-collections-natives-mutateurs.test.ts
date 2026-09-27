// Quatre défauts sur les collections natives (Map/Set/Array) rangées dans un
// µ.Store ou un µ.state :
//
// - lire .size d'une Map/Set d'un µ.Store lève TypeError : le proxy lit le
//   getter natif avec receiver = le proxy (Reflect.get(obj, prop, receiver)),
//   que Map.prototype.size/Set.prototype.size refusent (internal slot absent
//   sur un Proxy). Les getters des collections natives doivent être lus sur
//   la cible BRUTE.
// - µ.state : l'objet rendu par map.get(k) n'est pas ré-enveloppé (µ.Store le
//   fait déjà) — muter cet objet ne notifie personne.
// - fill()/copyWithin() manquent aux mutateurs suivis d'un µ.Store (déjà
//   suivis côté µ.state).
// - map.set(...) rend la Map BRUTE (le natif rend `this`) : chaîner
//   .set().set() échappe à la réactivité, dans µ.Store ET µ.state.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function mount(name: string) {
  const root = mjsTmp(`store-coll-${name}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  // `new µStore({})` dans la source : force la détection du module optionnel
  // mjs_store.ts (scan de features, cf. bundler/features.ts REGEX_STORE) —
  // sans ce signal textuel, `µ.Store` est absent du bundle et `new µ.Store(…)`
  // lève « is not a constructor » dans les tests ci-dessous.
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

describe('µ.Store — lire .size d\'une Map/Set stockée dans le store', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('store.data.map.size et store.data.set.size renvoient la vraie taille (pas de TypeError)', async () => {
    const { window } = await mount('storesize')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ map: new Map([['x', 1]]), set: new Set([1, 2]) })
      try { globalThis.result.map = store.data.map.size } catch (e) { globalThis.result.map = e.name }
      try { globalThis.result.set = store.data.set.size } catch (e) { globalThis.result.set = e.name }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.map, 1, 'lire .size d\'une Map ne doit jamais lever')
    assert.equal(result.set, 2, 'même garantie sur Set.prototype.size')
  })
})

describe('µ.state — Map.get(k) ré-enveloppe la valeur rendue (réactivité profonde)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('muter l\'objet rendu par state.map.get(k) notifie (même garantie que µ.Store)', async () => {
    const { window } = await mount('statemapget')
    window.eval(`
      globalThis.result = { notifications: 0, value: null }
      var state = µ.state({ map: new Map([['x', { n: 0 }]]) })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void state.map.get('x').n
      µ.activeComponent = null
      state.map.get('x').n = 2
      globalThis.result.value = state.map.get('x').n
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.value, 2, 'la mutation doit avoir bien eu lieu sur la Map interne')
    assert.equal(result.notifications, 1, 'le lecteur abonné à la valeur doit être notifié de la mutation')
  })
})

describe('fill()/copyWithin() sont des mutateurs suivis (notifient les abonnés)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µ.Store : store.data.list.fill(x) puis .copyWithin(...) notifient', async () => {
    const { window } = await mount('storefill')
    window.eval(`
      globalThis.result = { notifications: 0, list: null }
      var store = new µ.Store({ list: [1, 2] })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void store.data.list[0]
      µ.activeComponent = null
      store.data.list.fill(3)
      store.data.list.copyWithin(1, 0)
      globalThis.result.list = [store.data.list[0], store.data.list[1]]
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.deepEqual(result.list, [3, 3], 'les deux méthodes doivent muter le tableau normalement')
    assert.equal(result.notifications, 1, 'fill()/copyWithin() doivent notifier comme les autres mutateurs')
  })

  it('témoin non-régression µ.state : déjà suivis, aucune régression attendue', async () => {
    const { window } = await mount('statefill')
    window.eval(`
      globalThis.result = { notifications: 0, list: null }
      var state = µ.state({ list: [1, 2] })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void state.list[0]
      µ.activeComponent = null
      state.list.fill(3)
      state.list.copyWithin(1, 0)
      globalThis.result.list = [state.list[0], state.list[1]]
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.deepEqual(result.list, [3, 3])
    // µ.state notifie de façon SYNCHRONE à chaque appel mutateur (pas de
    // coalescence par microtâche, contrairement à µ.Store juste au-dessus) :
    // 2 appels mutateurs → 2 notifications, déjà le comportement actuel.
    assert.equal(result.notifications, 2)
  })
})

describe('map.set(...) rend le proxy réactif (pas la Map brute) : chaînage réactif', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µ.Store : chained.set(...).set(...) continue de notifier', async () => {
    const { window } = await mount('storechain')
    window.eval(`
      globalThis.result = { isProxy: false, notified: false }
      var store = new µ.Store({ map: new Map() })
      var chained = store.data.map.set('a', 0)
      globalThis.result.isProxy = chained === store.data.map
      µ.activeComponent = { _mjs_invalidate: () => { globalThis.result.notified = true } }
      void store.data.map.get('a')
      µ.activeComponent = null
      chained.set('a', 1)
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.isProxy, true, 'map.set(...) doit rendre le MÊME proxy réactif que store.data.map, pas la Map brute')
    assert.equal(result.notified, true, 'muter via la valeur de retour chaînée doit toujours notifier')
  })

  it('µ.state : chained.set(...).set(...) continue de notifier', async () => {
    const { window } = await mount('statechain')
    window.eval(`
      globalThis.result = { isProxy: false, notified: false }
      var state = µ.state({ map: new Map() })
      var chained = state.map.set('a', 0)
      globalThis.result.isProxy = chained === state.map
      µ.activeComponent = { _mjs_invalidate: () => { globalThis.result.notified = true } }
      void state.map.get('a')
      µ.activeComponent = null
      chained.set('a', 1)
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.isProxy, true, 'map.set(...) doit rendre le MÊME proxy réactif que state.map, pas la Map brute')
    assert.equal(result.notified, true, 'muter via la valeur de retour chaînée doit toujours notifier')
  })
})
