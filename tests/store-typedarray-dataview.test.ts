// TypedArray/DataView/ArrayBuffer rangés dans un µ.Store ou un µ.state : un getter ou une
// méthode native appelés avec `receiver`/`this` = le PROXY lève `TypeError … incompatible
// receiver` (internal slot absent), même défaut déjà corrigé pour Map/Set/Date. Écriture d'un
// INDEX (`store.data.v[0] = x`) passe par le trap `set` générique : les exotic ops indexées
// d'une TypedArray ignorent déjà le receiver côté moteur JS, donc déjà correcte — couverte ici
// comme témoin de cohérence, pas comme régression. Les méthodes qui MODIFIENT la vue (`set`,
// `fill`, `copyWithin`, `sort`, `reverse` d'une TypedArray ; les setters nommés d'une DataView,
// `setInt32`…) notifient les abonnés comme une écriture d'index ; les méthodes de lecture ne
// notifient jamais personne.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function mount(name: string) {
  const root = mjsTmp(`store-typed-${name}`)
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

describe('µ.Store — TypedArray/DataView lus comme les autres objets natifs', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('store.data.v.length (Int32Array) renvoie la vraie taille (pas de TypeError)', async () => {
    const { window } = await mount('storetalen')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ v: new Int32Array([1, 2, 3]) })
      try { globalThis.result.length = store.data.v.length } catch (e) { globalThis.result.length = e.name }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.length, 3, 'lire .length d\'une TypedArray ne doit jamais lever')
  })

  it('store.data.v.byteLength (DataView) renvoie la vraie taille (pas de TypeError)', async () => {
    const { window } = await mount('storedvlen')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ v: new DataView(new ArrayBuffer(8)) })
      try { globalThis.result.byteLength = store.data.v.byteLength } catch (e) { globalThis.result.byteLength = e.name }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.byteLength, 8, 'lire .byteLength d\'une DataView ne doit jamais lever')
  })

  it('écrire un index (store.data.v[0] = x) mute et notifie, comme µ.state pour la même valeur', async () => {
    const { window } = await mount('storetaidx')
    window.eval(`
      globalThis.result = { notifications: 0, value: null }
      var store = new µ.Store({ v: new Int32Array([1, 2, 3]) })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void store.data.v[0]
      µ.activeComponent = null
      store.data.v[0] = 99
      globalThis.result.value = store.data.v[0]
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.value, 99, 'écrire un index doit muter la TypedArray sous-jacente')
    assert.equal(result.notifications, 1, 'le lecteur de cet index doit être notifié')
  })

  it('store.data.v.map()/.subarray()/.at() (Int32Array) s\'exécutent sur la cible brute, sans notifier personne', async () => {
    const { window } = await mount('storetamet')
    window.eval(`
      globalThis.result = { notifications: 0 }
      var store = new µ.Store({ v: new Int32Array([1, 2, 3]) })
      void store.data.v
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      try {
        globalThis.result.map = Array.from(store.data.v.map(function (x) { return x * 2 }))
        globalThis.result.subarray = Array.from(store.data.v.subarray(1))
        globalThis.result.at = store.data.v.at(0)
      } catch (e) { globalThis.result.error = e.message }
      µ.activeComponent = null
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.error, undefined, `aucune méthode de lecture ne doit lever : ${result.error}`)
    assert.deepEqual(result.map, [2, 4, 6])
    assert.deepEqual(result.subarray, [2, 3])
    assert.equal(result.at, 1)
    assert.equal(result.notifications, 0, 'une méthode de LECTURE ne doit jamais notifier')
  })

  it('store.data.v.fill()/.set([..]) (Int32Array) mutent la cible ET notifient exactement une fois par appel', async () => {
    const { window } = await mount('storetamut')
    window.eval(`
      globalThis.result = { notifications: 0 }
      var store = new µ.Store({ v: new Int32Array([1, 2, 3]) })
      void store.data.v
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      store.data.v.fill(9)
    `)
    await new Promise(r => setTimeout(r, 30))
    let result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.notifications, 1, 'fill() doit notifier une seule fois')
    window.eval(`
      globalThis.result.notifications = 0
      store.data.v.set([5, 6])
      globalThis.result.value = Array.from(store.data.v)
    `)
    await new Promise(r => setTimeout(r, 30))
    result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.deepEqual(result.value, [5, 6, 9], 'set([..]) doit muter la TypedArray sous-jacente')
    assert.equal(result.notifications, 1, 'set([..]) doit notifier une seule fois')
    window.eval('µ.activeComponent = null')
  })

  it('store.data.v.getInt32() (DataView) ne notifie personne ; .setInt32() mute et notifie', async () => {
    const { window } = await mount('storedvset')
    window.eval(`
      globalThis.result = { notifications: 0 }
      var dv = new DataView(new ArrayBuffer(8))
      dv.setInt32(0, 1)
      var store = new µ.Store({ v: dv })
      void store.data.v
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      globalThis.result.read = store.data.v.getInt32(0)
    `)
    await new Promise(r => setTimeout(r, 30))
    let result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.read, 1)
    assert.equal(result.notifications, 0, 'une lecture (getInt32) ne doit notifier personne')
    window.eval(`
      store.data.v.setInt32(0, 42)
      globalThis.result.write = store.data.v.getInt32(0)
    `)
    await new Promise(r => setTimeout(r, 30))
    result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.write, 42, 'setInt32 doit muter la vue sous-jacente')
    assert.equal(result.notifications, 1, 'setInt32 doit notifier les abonnés comme une écriture d\'index')
    window.eval('µ.activeComponent = null')
  })

  it('store.data.v.byteLength et .slice() (ArrayBuffer brut) fonctionnent sans TypeError', async () => {
    const { window } = await mount('storeabraw')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ v: new ArrayBuffer(8) })
      try {
        globalThis.result.byteLength = store.data.v.byteLength
        globalThis.result.sliceLength = store.data.v.slice(0, 4).byteLength
      } catch (e) { globalThis.result.error = e.message }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.error, undefined, `lire .byteLength ou appeler .slice() sur un ArrayBuffer brut ne doit jamais lever : ${result.error}`)
    assert.equal(result.byteLength, 8)
    assert.equal(result.sliceLength, 4)
  })

  it('témoin µ.state : même scénario (lecture .length, écriture d\'index, notification) — parité vérifiée', async () => {
    const { window } = await mount('statetaidx')
    window.eval(`
      globalThis.result = { length: null, notifications: 0, value: null }
      var state = µ.state({ v: new Int32Array([1, 2, 3]) })
      globalThis.result.length = state.v.length
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void state.v[0]
      µ.activeComponent = null
      state.v[0] = 99
      globalThis.result.value = state.v[0]
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.length, 3)
    assert.equal(result.value, 99)
    assert.equal(result.notifications, 1, 'µ.state notifie de façon SYNCHRONE (pas de coalescence par microtâche, contrairement à µ.Store)')
  })

  it('l\'aperçu de l\'inspecteur de dev affiche le nom précis de la classe (Int32Array) sur une valeur lue depuis le store', async () => {
    const { window } = await mount('storetadi')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ v: new Int32Array([1, 2, 3]) })
      try { globalThis.result.apercu = µ._mjs_diApercu(store.data.v, 'typedarray') } catch (e) { globalThis.result.apercu = 'EXCEPTION: ' + e.message }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.apercu, 'Int32Array(3)', 'le nom générique « TypedArray » (v.constructor bloqué par la garde anti-pollution) ne doit pas apparaître à la place du nom précis')
  })

  it('le panneau reconnaît seul une vue binaire lue depuis un store ou un état (sans type fourni à la main)', async () => {
    const { window } = await mount('storetadikind')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ v: new Int32Array([1, 2, 3]), d: new DataView(new ArrayBuffer(4)) })
      var state = µ.state({ v: new Int32Array([1, 2]) })
      globalThis.result.kindStore = µ._mjs_diKind(store.data.v)
      globalThis.result.apercuStore = µ._mjs_diApercu(store.data.v)
      globalThis.result.kindDataView = µ._mjs_diKind(store.data.d)
      globalThis.result.apercuState = µ._mjs_diApercu(state.v)
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.kindStore, 'typedarray')
    assert.equal(result.apercuStore, 'Int32Array(3)')
    assert.equal(result.kindDataView, 'typedarray')
    assert.equal(result.apercuState, 'Int32Array(2)')
  })
})

describe('µ.state — mêmes méthodes, mêmes garanties de notification sur les vues binaires', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('state.v.map()/.subarray()/.at() (Int32Array) s\'exécutent sur la cible brute, sans notifier personne', async () => {
    const { window } = await mount('statetamet')
    window.eval(`
      globalThis.result = { notifications: 0 }
      var state = µ.state({ v: new Int32Array([1, 2, 3]) })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      try {
        globalThis.result.map = Array.from(state.v.map(function (x) { return x * 2 }))
        globalThis.result.subarray = Array.from(state.v.subarray(1))
        globalThis.result.at = state.v.at(0)
      } catch (e) { globalThis.result.error = e.message }
      µ.activeComponent = null
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.error, undefined, `aucune méthode de lecture ne doit lever : ${result.error}`)
    assert.deepEqual(result.map, [2, 4, 6])
    assert.deepEqual(result.subarray, [2, 3])
    assert.equal(result.at, 1)
    assert.equal(result.notifications, 0, 'une méthode de LECTURE ne doit jamais notifier')
  })

  it('state.v.fill()/.set([..]) (Int32Array) mutent la cible ET notifient exactement une fois par appel, de façon synchrone', async () => {
    const { window } = await mount('statetamut')
    window.eval(`
      globalThis.result = {}
      var state = µ.state({ v: new Int32Array([1, 2, 3]) })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void state.v
      globalThis.result.notifications = 0
      state.v.fill(9)
      globalThis.result.afterFill = { value: Array.from(state.v), notifications: globalThis.result.notifications }
      globalThis.result.notifications = 0
      state.v.set([5, 6])
      globalThis.result.afterSet = { value: Array.from(state.v), notifications: globalThis.result.notifications }
      µ.activeComponent = null
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.deepEqual(result.afterFill.value, [9, 9, 9])
    assert.equal(result.afterFill.notifications, 1, 'fill() doit notifier une seule fois, de façon synchrone')
    assert.deepEqual(result.afterSet.value, [5, 6, 9])
    assert.equal(result.afterSet.notifications, 1, 'set([..]) doit notifier une seule fois, de façon synchrone')
  })

  it('state.v.getInt32() (DataView) ne notifie personne ; .setInt32() mute et notifie', async () => {
    const { window } = await mount('statedvset')
    window.eval(`
      globalThis.result = {}
      var dv = new DataView(new ArrayBuffer(8))
      dv.setInt32(0, 1)
      var state = µ.state({ v: dv })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      globalThis.result.notifications = 0
      globalThis.result.read = state.v.getInt32(0)
      globalThis.result.readNotifications = globalThis.result.notifications
      state.v.setInt32(0, 42)
      globalThis.result.write = state.v.getInt32(0)
      globalThis.result.writeNotifications = globalThis.result.notifications
      µ.activeComponent = null
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.read, 1)
    assert.equal(result.readNotifications, 0, 'une lecture (getInt32) ne doit notifier personne')
    assert.equal(result.write, 42, 'setInt32 doit muter la vue sous-jacente')
    assert.equal(result.writeNotifications, 1, 'setInt32 doit notifier comme une écriture d\'index')
  })

  it('state.v.byteLength et .slice() (ArrayBuffer brut) fonctionnent sans TypeError', async () => {
    const { window } = await mount('stateabraw')
    window.eval(`
      globalThis.result = {}
      var state = µ.state({ v: new ArrayBuffer(8) })
      try {
        globalThis.result.byteLength = state.v.byteLength
        globalThis.result.sliceLength = state.v.slice(0, 4).byteLength
      } catch (e) { globalThis.result.error = e.message }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.error, undefined, `lire .byteLength ou appeler .slice() sur un ArrayBuffer brut ne doit jamais lever : ${result.error}`)
    assert.equal(result.byteLength, 8)
    assert.equal(result.sliceLength, 4)
  })

  it('non-régression : Map/Set/Date/tableau restent réactifs après l\'ajout des vues binaires à la même classification', async () => {
    const { window } = await mount('stateregress')
    window.eval(`
      globalThis.result = { notifications: 0 }
      var state = µ.state({ m: new Map(), s: new Set(), d: new Date(2020, 0, 1), a: [1, 2] })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void state.m; void state.s; void state.d; void state.a
      state.m.set('x', 1)
      state.s.add(1)
      state.d.setFullYear(2021)
      state.a.push(3)
      µ.activeComponent = null
      globalThis.result.mapSize = state.m.size
      globalThis.result.setSize = state.s.size
      globalThis.result.year = state.d.getFullYear()
      globalThis.result.arr = Array.from(state.a)
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.mapSize, 1)
    assert.equal(result.setSize, 1)
    assert.equal(result.year, 2021)
    assert.deepEqual(result.arr, [1, 2, 3])
    assert.equal(result.notifications, 4, 'chaque mutation (Map/Set/Date/Array) doit encore notifier une fois')
  })
})
