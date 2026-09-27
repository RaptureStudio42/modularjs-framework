// µ._mjs_universalDeps (registre des dépendances d'un µ.state universel) : le
// registre PAR CIBLE est un objet ordinaire { [clé]: Set<composant> }, avec une
// clé-sentinelle SYMBOL (µ._mjs_STRUCT) pour les lecteurs d'énumération.
//
// - _mjs_cleanupUniversalDeps parcourait ce registre par for…in / Object.keys,
//   aveugles à toute clé Symbol : si µ._mjs_STRUCT était la SEULE clé restante
//   (encore abonnée par d'AUTRES composants), le registre entier était supprimé
//   (perte de leurs abonnements), et le composant nettoyé restait lui-même
//   abonné pour CETTE clé (fuite — jamais invoqué « proprement », mais jamais
//   retiré non plus). Fix : Reflect.ownKeys (voit aussi les clés Symbol), ne
//   supprimer une entrée que si plus personne n'y est abonné.
// - Une clé nommée toString/constructor/valueOf faisait planter l'enregistrement
//   (deps[key] retombe sur la fonction héritée d'Object.prototype, .add() lève).
//   Fix : registre sans prototype (Object.create(null)).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function mount(name: string) {
  const root = mjsTmp(`store-registre-${name}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${name}.mjs`), '<p>x</p>\n')

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

describe('µ._mjs_cleanupUniversalDeps — voit la clé Symbol de structure (Reflect.ownKeys)', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it("nettoyer un composant détruit ne coupe pas les mises à jour d'un AUTRE composant encore abonné à l'énumération", async () => {
    const { window } = await mount('cleanupstruct')
    window.eval(`
      globalThis.result = { before: 0, after: 0 }
      globalThis.phase = 'before'
      var state = µ.state({ x: 0 })
      var reader = { _mjs_invalidate: () => globalThis.result[globalThis.phase]++ }
      var removed = { _mjs_invalidate: () => {} }
      for (var comp of [reader, removed]) {
        µ.activeComponent = comp
        Object.keys(state)
        µ.activeComponent = null
      }
      state.y = 1
      µ._mjs_cleanupUniversalDeps(removed)
      globalThis.phase = 'after'
      state.z = 2
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.before, 1, "le lecteur d'énumération doit être notifié avant tout nettoyage")
    assert.equal(result.after, 1, "AVANT le fix : nettoyer « removed » supprimait le registre ENTIER de la clé Symbol (Object.keys(deps) l'ignore) — « reader » cessait d'être notifié alors qu'il est toujours vivant")
  })

  it('un composant nettoyé (abonné via une énumération) ne reçoit plus jamais de notification', async () => {
    const { window } = await mount('cleanupleak')
    window.eval(`
      globalThis.result = { removed: 0, live: 0 }
      var state = µ.state({ x: 0 })
      var removed = { _mjs_invalidate: () => globalThis.result.removed++ }
      var live = { _mjs_invalidate: () => globalThis.result.live++ }
      µ.activeComponent = removed
      Object.keys(state)
      µ.activeComponent = live
      void state.x
      µ.activeComponent = null
      µ.activeComponent = null
      µ._mjs_cleanupUniversalDeps(removed)
      state.x = 2
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.live, 1, 'le composant encore vivant doit être notifié normalement')
    assert.equal(result.removed, 0, "AVANT le fix : l'abonnement de structure (clé Symbol) d'un composant nettoyé n'était jamais retiré (for…in l'ignore) — il continuait à être invoqué après son propre nettoyage")
  })
})

describe('registre de dépendances universelles — une clé nommée comme une méthode héritée fonctionne', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it("une donnée nommée toString/constructor est lisible et réactive, sans planter (AVANT le fix : « deps[key].add is not a function »)", async () => {
    const { window } = await mount('reservedkeys')
    window.eval(`
      globalThis.result = {}
      var state = µ.state({ toString: 'valeur métier', constructor: 'autre donnée' })
      try {
        globalThis.result.toStringFirstRead = state.toString
        µ.activeComponent = { _mjs_invalidate: () => {} }
        globalThis.result.toStringSecondRead = state.toString
        globalThis.result.constructorRead = state.constructor
        µ.activeComponent = null
        globalThis.result.ok = true
      } catch (e) {
        globalThis.result.ok = false
        globalThis.result.error = e.message
      }
    `)
    const result = JSON.parse(window.eval('JSON.stringify(globalThis.result)'))
    assert.equal(result.ok, true, `l'enregistrement de dépendance ne doit jamais planter sur ces noms : ${result.error}`)
    assert.equal(result.toStringFirstRead, 'valeur métier')
    assert.equal(result.toStringSecondRead, 'valeur métier')
    assert.equal(result.constructorRead, 'autre donnée')
  })
})
