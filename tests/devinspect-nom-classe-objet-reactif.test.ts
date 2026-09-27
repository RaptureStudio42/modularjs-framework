// L'inspecteur affichait « Objet » — jamais le nom de la classe — pour une instance rangée dans
// un store/état réactif : la garde anti-pollution de prototype (CWE-1321) rend `.constructor`
// HÉRITÉ illisible à travers le proxy, à raison (protection VOULUE, pas à rouvrir). L'aperçu doit
// retrouver le nom de classe AUTREMENT, en lisant le prototype de la cible brute.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// `@dummy = new µStore({})` force l'inclusion du module µ.Store dans le core compilé — un
// composant qui ne le mentionne jamais ne l'embarque pas (détection de features au build).
const NEUTRE = [
  '<script lang="coffee">',
  '@dummy = new µStore({})',
  '$x ?= 1',
  '</script>',
  '<p>{$x}</p>',
].join('\n')

async function compilerCore() {
  const root   = mjsTmp('devinspect-ctor')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'dic-neutre.mjs'), NEUTRE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir)
  const core  = readFileSync(join(outDir, files.find(f => /^mjs_core-/.test(f))!), 'utf-8')
  await bundler.close()
  return core
}

function fenetreAvecCore(core: string) {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${stripEsm(core)}\nglobalThis.µ = µ;`)
  return window
}

describe('mjs_devinspect — nom de classe d\'une instance à travers un proxy réactif', function () {
  this.timeout(60000)

  let core: string

  before(async () => { core = await compilerCore() })
  after(async () => { await terminateSharedWorkerPool() })

  it('une instance de classe rangée dans un µ.Store affiche « Objet <NomDeClasse> », pas juste « Objet »', () => {
    const window = fenetreAvecCore(core)
    window.eval(`
      class Vehicule {}
      globalThis.store = new µ.Store({ v: new Vehicule() })
    `)
    const apercu = window.eval('µ._mjs_diApercu(store.data.v)')
    assert.equal(apercu, 'Objet Vehicule', "AVANT le fix : « Objet » seul — v.constructor rend undefined à travers le proxy réactif")
  })

  it('même résultat pour une instance rangée dans µ.state', () => {
    const window = fenetreAvecCore(core)
    window.eval(`
      class Vehicule {}
      globalThis.state = µ.state({ v: new Vehicule() })
    `)
    const apercu = window.eval('µ._mjs_diApercu(state.v)')
    assert.equal(apercu, 'Objet Vehicule')
  })

  it('.constructor reste undefined à travers le proxy — la garde anti-pollution n\'est PAS rouverte par ce correctif', () => {
    const window = fenetreAvecCore(core)
    window.eval(`
      class Vehicule {}
      globalThis.store = new µ.Store({ v: new Vehicule() })
    `)
    const ctor = window.eval('store.data.v.constructor')
    assert.equal(ctor, undefined, 'la lecture directe de .constructor reste bloquée, seul _mjs_diApercu contourne le blocage pour l\'AFFICHAGE, via le prototype de la cible brute')
  })

  it('un objet PLAIN (pas d\'instance de classe) rangé dans un store reste affiché « Objet », sans nom parasite', () => {
    const window = fenetreAvecCore(core)
    window.eval(`globalThis.store = new µ.Store({ v: { x: 1 } })`)
    const apercu = window.eval('µ._mjs_diApercu(store.data.v)')
    assert.equal(apercu, 'Objet', 'un objet plain (Object) ne doit jamais afficher "Objet Object"')
  })

  it('une instance de classe qui ne passe PAS par un proxy réactif (objet nu) affiche aussi son nom', () => {
    const window = fenetreAvecCore(core)
    window.eval(`class Vehicule {}; globalThis.brut = new Vehicule()`)
    const apercu = window.eval('µ._mjs_diApercu(brut)')
    assert.equal(apercu, 'Objet Vehicule', 'non-régression : le cas non proxifié fonctionnait déjà')
  })
})
