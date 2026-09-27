// Un même objet rangé sous DEUX clés racines (`new µ.Store({a: shared, b: shared})`,
// `µ.state({a: shared, b: shared})`, ou deux variables d'état d'un composant qui pointent le
// même objet) : une mutation faite via une clé doit prévenir les lecteurs de TOUTES les clés
// par lesquelles cet objet a été atteint, pas seulement celle du proxy qui a muté — sinon un
// lecteur de la clé « b » ne voit jamais passer un changement pourtant fait sur SON objet, juste
// parce que la mutation est arrivée par « a ». Un objet NON partagé (une seule clé) ne doit
// recevoir qu'UNE notification, jamais plus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function mount(name: string) {
  const root = mjsTmp(`partage-${name}`)
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

describe('µ.Store — objet partagé sous deux clés racines : mutation via une clé, notification des DEUX', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le lecteur de la 1re clé (a) est aussi notifié quand la mutation arrive par la 2e clé (b)', async () => {
    const { window } = await mount('storealiasab')
    window.eval(`
      globalThis.result = { a: 0, b: 0 }
      var shared = { x: 0 }
      var store = new µ.Store({ a: shared, b: shared })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.a++ }
      void store.data.a.x
      µ.activeComponent = null
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.b++ }
      void store.data.b.x
      µ.activeComponent = null
      store.data.b.x = 1
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.b, 1, 'le lecteur de la clé qui a muté reste notifié')
    assert.equal(result.a, 1, "AVANT le fix : jamais notifié — la mutation partait uniquement sur la clé « b », « a » pointe pourtant le MÊME objet")
  })

  it('un objet NON partagé (une seule clé) ne reçoit toujours qu\'UNE notification', async () => {
    const { window } = await mount('storealiassolo')
    window.eval(`
      globalThis.result = { c: 0 }
      var store = new µ.Store({ c: { y: 0 } })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.c++ }
      void store.data.c.y
      µ.activeComponent = null
      store.data.c.y = 9
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.c, 1, 'pas de sur-notification pour un objet qui n\'est atteint que par une seule clé')
  })

  it('un même composant abonné aux DEUX clés aliasées n\'est invalidé qu\'UNE fois pour une seule mutation', async () => {
    const { window } = await mount('storealiasunseul')
    window.eval(`
      globalThis.result = { calls: 0 }
      var shared = { x: 0, y: 0 }
      var store = new µ.Store({ a: shared, b: shared })
      var comp = { _mjs_invalidate: () => globalThis.result.calls++ }
      µ.activeComponent = comp
      void store.data.a.x
      µ.activeComponent = null
      µ.activeComponent = comp
      void store.data.b.y
      µ.activeComponent = null
      store.data.a.x = 999
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.calls, 1, 'AVANT le fix : 2 — une invalidation par clé aliasée du fan-out, alors qu\'un seul composant lit les deux')
  })
})

describe('µ.state — objet partagé sous deux clés racines : mutation via une clé, notification des DEUX, sans doublon', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un lecteur de la clé racine « b » (SANS drill-down) est notifié quand la mutation arrive via « a »', async () => {
    const { window } = await mount('statealiasperte')
    window.eval(`
      globalThis.result = { notifB: 0 }
      var shared = { x: 0 }
      var state = µ.state({ a: shared, b: shared })
      void state.a.x
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifB++ }
      void state.b
      µ.activeComponent = null
      state.a.x = 999
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.notifB, 1, "AVANT le fix : jamais notifié — seule la clé de la toute PREMIÈRE lecture (« a », qui a créé le proxy niché) recevait la notification")
  })

  it('deux lecteurs qui drillent chacun leur propre clé restent notifiés UNE SEULE FOIS chacun (pas de double rendu)', async () => {
    const { window } = await mount('statealiasdouble')
    window.eval(`
      globalThis.result = { a: 0, b: 0 }
      var shared = { x: 0 }
      var state = µ.state({ a: shared, b: shared })
      var compA = { _mjs_invalidate: () => globalThis.result.a++ }
      var compB = { _mjs_invalidate: () => globalThis.result.b++ }
      µ.activeComponent = compA
      void state.a.x
      µ.activeComponent = null
      µ.activeComponent = compB
      void state.b.x
      µ.activeComponent = null
      state.b.x = 42
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.a, 1, 'le lecteur de "a" est notifié une fois (même objet muté)')
    assert.equal(result.b, 1, 'le lecteur de "b" (qui a lu ET muté) reste notifié UNE seule fois, pas deux — le cache de proxy niché est partagé entre les deux clés')
  })

  it('un objet NON partagé (une seule clé) ne reçoit toujours qu\'UNE notification', async () => {
    const { window } = await mount('statealiassolo')
    window.eval(`
      globalThis.result = { c: 0 }
      var state = µ.state({ c: { y: 0 } })
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.c++ }
      void state.c.y
      µ.activeComponent = null
      state.c.y = 9
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.c, 1, 'pas de sur-notification pour un objet qui n\'est atteint que par une seule clé')
  })

  it('state.a === state.b : identité stable, PAS un proxy par clé (comportement documenté, différent de µ.Store)', async () => {
    const { window } = await mount('statealiasidentite')
    window.eval(`
      globalThis.result = {}
      var shared = { x: 0 }
      var state = µ.state({ a: shared, b: shared })
      globalThis.result.same = state.a === state.b
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.same, true, 'µ.state garde un proxy UNIQUE par objet, quelle que soit la clé (contrairement à µ.Store)')
  })
})

const ALIAS_COMPONENT = [
  '<script>',
  'shared := { x: 0 }',
  '$a = shared',
  '$b = shared',
  // mutation via une fonction EXTERNE (frontière d'échappement, cf. réactivité état
  // profond) : force le passage par le Proxy _mjs_wrapDeep plutôt que par le chemin
  // compilé statiquement (µ._mjs_deepSet), pour cibler précisément ce filet.
  'setX = (o, v) -> o.x = v',
  '</script>',
  '<p class="a">{$a.x}</p>',
  '<p class="b">{$b.x}</p>',
  '<button class="setx" @click={setX($a, 5)}>set</button>',
].join('\n')

const ALIAS_SOLO_COMPONENT = [
  '<script>',
  '$c = { y: 0 }',
  'setY = (o, v) -> o.y = v',
  '</script>',
  '<p class="c">{$c.y}</p>',
  '<button class="sety" @click={setY($c, 9)}>set</button>',
].join('\n')

describe('état $ d\'un composant — deux variables qui pointent le même objet : mutation via l\'une, notification des DEUX', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = mjsTmp('etat-alias-deux-cles')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ea-alias.mjs'), ALIAS_COMPONENT)
    writeFileSync(join(srcDir, 'ea-solo.mjs'), ALIAS_SOLO_COMPONENT)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it("muter l'objet via un alias échappé de $a met aussi à jour le lecteur de $b (même objet)", async () => {
    const c = await app.mount('ea-alias')
    try {
      assert.equal(c.find('.a').textContent, '0')
      assert.equal(c.find('.b').textContent, '0')
      await c.click('.setx')
      assert.equal(c.find('.a').textContent, '5', 'la variable mutée affiche la nouvelle valeur')
      assert.equal(c.find('.b').textContent, '5', "AVANT le fix : resté à 0 — le proxy de _mjs_wrapDeep ne notifiait que la clé « a », jamais « b », bien que les deux variables pointent le MÊME objet")
    } finally {
      c.destroy()
    }
  })

  it('un objet NON partagé (une seule variable) continue de se comporter normalement', async () => {
    const c = await app.mount('ea-solo')
    try {
      assert.equal(c.find('.c').textContent, '0')
      await c.click('.sety')
      assert.equal(c.find('.c').textContent, '9')
    } finally {
      c.destroy()
    }
  })
})
