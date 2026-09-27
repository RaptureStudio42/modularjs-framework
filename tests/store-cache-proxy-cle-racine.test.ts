// Régression µ.Store : un même objet rangé sous DEUX clés racines. Le cache de
// proxys de _mjs_buildProxy était indexé par l'objet SEUL (WeakMap<target, proxy>) :
// la 2e clé retrouvait le proxy construit pour la 1re (rootKey figé dessus), donc
// ses lecteurs n'étaient jamais prévenus des mutations faites via la 2e clé —
// c'est la clé RACINE d'ORIGINE qui recevait la notification à leur place. Fix :
// cache à deux niveaux (objet, clé racine), même stratégie que _mjs_wrapDeep
// (mjs_element.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function mount(name: string) {
  const root = mjsTmp(`store-cache-${name}`)
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

describe('µ.Store — objet partagé sous deux clés racines : la 2e clé a son propre proxy', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un lecteur abonné à la 2e clé est notifié quand on mute via CETTE clé', async () => {
    const { window } = await mount('sharedkeys')
    window.eval(`
      globalThis.result = { notifications: 0, value: null }
      var shared = { x: 0 }
      var store = new µ.Store({ a: shared, b: shared })
      void store.data.a
      µ.activeComponent = { _mjs_invalidate: () => globalThis.result.notifications++ }
      void store.data.b.x
      µ.activeComponent = null
      store.data.b.x = 1
      globalThis.result.value = store.data.b.x
    `)
    await new Promise(r => setTimeout(r, 30))
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.value, 1, 'la mutation doit avoir bien eu lieu')
    assert.equal(result.notifications, 1, "le lecteur de la 2e clé (« b ») doit être notifié — AVANT le fix, la notification partait sur la 1re clé (« a »), jamais lue par ce lecteur")
  })

  it('deux clés distinctes pour le MÊME objet partagé obtiennent deux proxys DISTINCTS (un par clé racine)', async () => {
    const { window } = await mount('sharedidentity')
    window.eval(`
      globalThis.result = {}
      var shared = { x: 0 }
      var store = new µ.Store({ a: shared, b: shared })
      globalThis.result.sameProxy = store.data.a === store.data.b
      globalThis.result.sameRawTarget = µ._mjs_toRaw(store.data.a) === µ._mjs_toRaw(store.data.b)
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.sameRawTarget, true, 'les deux proxys doivent envelopper le MÊME objet brut (pas une copie)')
    assert.equal(result.sameProxy, false, 'chaque clé racine doit avoir SON PROPRE proxy (cache à deux niveaux), pas un proxy partagé au rootKey figé sur la 1re clé lue')
  })

  it('lire deux fois la MÊME clé retourne toujours le MÊME proxy (identité stable, pas de régression)', async () => {
    const { window } = await mount('sameidentity')
    window.eval(`
      globalThis.result = {}
      var store = new µ.Store({ a: { x: 0 } })
      globalThis.result.same = store.data.a === store.data.a
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.same, true, 'deux lectures de la même clé doivent retourner le même proxy (cache toujours actif pour un (objet, rootKey) identique)')
  })
})
