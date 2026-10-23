// Un champ caché aux lecteurs d'écran (aria-hidden="true") ET hors du parcours au clavier (tabindex="-1") n'est le champ de personne : le contrôle
// d'accessibilité ne lui demande plus d'étiquette. C'est l'ancre invisible de la bulle de validation de <@@editor>, ou le champ piège d'un formulaire
// contre les robots. Un champ caché d'un seul côté (ou aria-hidden="false") garde son alerte.
// Une appli qui écrit <@@editor> (avec sa barre) se construit, en développement comme en production, sans aucun avertissement d'accessibilité
// venu des modules du cœur : l'appli n'a pas à couper tout `lint.a11y` pour le faire taire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function alertesEtiquette(src: string): Promise<string[]> {
  const orig    = console.warn
  const alertes: string[] = []
  console.warn = (...a: unknown[]) => { alertes.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'ancre' }) } finally { console.warn = orig }
  return alertes.filter(m => /sans étiquette|without an associated label/.test(m))
}

// les lignes d'avertissement d'accessibilité venues d'un module du cœur, pendant la construction d'une appli qui écrit <@@editor>
async function alertesDuCoeur(env: 'dev' | 'prod'): Promise<string[]> {
  const root = mjsTmp('a11y-coeur-' + env)
  const src  = join(root, 'src')
  const out  = join(root, 'public')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'page.mjs'), '<form>\n  <label for="corps">Corps</label>\n  <@@editor id="corps" name="corps"></@@editor>\n</form>\n')
  const orig   = console.warn
  const lignes: string[] = []
  console.warn = (...a: unknown[]) => { lignes.push(a.map(String).join(' ')) }
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env })
  try {
    const stats = await b.compile()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    for (const w of stats.warnings as any[]) lignes.push(typeof w === 'string' ? w : String(w?.message ?? w))
  }
  finally {
    console.warn = orig
    await b.close()
  }
  return lignes.filter(l => /lint\.a11y/.test(l) && /core-/.test(l))
}

describe('lint.a11y — un champ hors d\'atteinte (aria-hidden="true" et tabindex="-1") n\'a pas besoin d\'étiquette', () => {
  it('caché aux lecteurs d\'écran et hors du parcours au clavier : pas d\'alerte', async () => {
    assert.deepEqual(await alertesEtiquette('<textarea class="ancre" tabindex="-1" aria-hidden="true"></textarea>\n'), [])
    assert.deepEqual(await alertesEtiquette('<input name="site" tabindex="-1" aria-hidden="true" autocomplete="off">\n'), [])
  })

  it('caché d\'un seul côté, ou aria-hidden="false" : l\'alerte reste', async () => {
    assert.equal((await alertesEtiquette('<textarea aria-hidden="true"></textarea>\n')).length, 1)
    assert.equal((await alertesEtiquette('<input name="a" tabindex="-1">\n')).length, 1)
    assert.equal((await alertesEtiquette('<select tabindex="-1" aria-hidden="false"><option>a</option></select>\n')).length, 1)
  })

  it('le texte de la valeur d\'un autre attribut n\'est pas un attribut : l\'alerte reste', async () => {
    assert.equal((await alertesEtiquette('<input name="a" placeholder="x aria-hidden=\'true\' tabindex=\'-1\'">\n')).length, 1)
    assert.equal((await alertesEtiquette('<input name="a" data-note=\'aria-hidden="true" tabindex="-1"\'>\n')).length, 1)
    assert.deepEqual(await alertesEtiquette('<input name="a" placeholder="l\'avion" aria-hidden="true" tabindex="-1">\n'), [], 'une apostrophe dans une valeur ne cache rien')
  })

  it('aria-hidden se lit comme les navigateurs : seul « true » écrit ainsi cache le champ partout', async () => {
    // Firefox ne cache que « true » exact, casse comprise ; WebKit que « true » à la casse près : une espace en trop, ou « TRUE », y laissent le champ
    // à la portée d'un lecteur d'écran, sans étiquette
    assert.equal((await alertesEtiquette('<input name="a" aria-hidden="true " tabindex="-1">\n')).length, 1)
    assert.equal((await alertesEtiquette('<input name="a" aria-hidden=" true" tabindex="-1">\n')).length, 1)
    assert.equal((await alertesEtiquette('<input name="a" aria-hidden="TRUE" tabindex="-1">\n')).length, 1)
    // tabindex se lit comme un entier : les blancs autour ne comptent pas
    assert.deepEqual(await alertesEtiquette('<input name="a" aria-hidden="true" tabindex=" -1 ">\n'), [])
  })
})

describe('lint.a11y — une appli qui écrit <@@editor> : aucun avertissement venu des modules du cœur', function () {
  this.timeout(120000)

  after(() => terminateSharedWorkerPool())

  for (const env of ['dev', 'prod'] as const) {
    it(`construction ${env === 'dev' ? 'de développement' : 'de production'}`, async () => {
      assert.deepEqual(await alertesDuCoeur(env), [])
    })
  }
})
