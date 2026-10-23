// Un modèle en fichier ne reçoit un alias court que si la balise courte mène bien au composant qui le
// porte : chacune des gardes de `modelsWithShortAliases` est prouvée seule, sur un cas que les autres
// laissent passer. Alias réservé (`core-…`, `mjs-…`, noms du framework) ; alias qui est le NOM d'un vrai
// composant dont le nom court est autre (`ab/ab-cd.mjs` s'écrit `<@cd>`, mais son nom est `ab-cd`) ;
// alias disputé par deux composants ; et le cas ordinaire, qui reçoit bien son alias.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Bundler } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// aucun fichier n'est écrit : les chemins ne servent qu'à calculer les noms
const ROOT = mjsTmp('alias-court-gardes')
const SRC  = join(ROOT, 'src')

function aliases(chemins: string[], modeles: Record<string, string[]>): Record<string, string[]> {
  const bundler: any = new Bundler({ sourceDir: SRC, outputDir: join(ROOT, 'out'), manifestPath: join(ROOT, 'bundle.js') })
  return bundler.modelsWithShortAliases(chemins.map(c => join(SRC, c)), modeles)
}

describe('modèles en fichier — chaque garde de l\'alias court, seule', () => {
  it('le cas ordinaire reçoit son alias (témoin : les refus qui suivent ne sont pas un résultat vide)', () => {
    const modeles = { 'doc-carte': ['compacte'] }
    assert.deepEqual(aliases(['doc/doc-carte.mjs', 'doc/doc-carte.compacte.mjs'], modeles), { 'doc-carte': ['compacte'], carte: ['compacte'] })
  })

  it('alias réservé : aucun alias, même sans rival (`doc/doc-core-x.mjs` s\'écrirait `core-x`)', () => {
    const modeles = { 'doc-core-x': ['compacte'] }
    assert.deepEqual(aliases(['doc/doc-core-x.mjs', 'doc/doc-core-x.compacte.mjs'], modeles), modeles)
    const framework = { 'doc-slot': ['compacte'] }
    assert.deepEqual(aliases(['doc/doc-slot.mjs', 'doc/doc-slot.compacte.mjs'], framework), framework)
  })

  it('alias qui est le nom d\'un vrai composant dont le nom court est autre : aucun alias', () => {
    // `ab/ab-cd.mjs` : nom `ab-cd`, nom court `cd` ; `zz/zz-ab-cd.mjs` : nom court `ab-cd` — personne d'autre ne porte ce nom court
    const modeles = { 'zz-ab-cd': ['compacte'] }
    assert.deepEqual(aliases(['ab/ab-cd.mjs', 'zz/zz-ab-cd.mjs', 'zz/zz-ab-cd.compacte.mjs'], modeles), modeles)
  })

  it('alias que deux composants se disputent : aucun alias', () => {
    const modeles = { 'doc-carte': ['compacte'] }
    assert.deepEqual(aliases(['doc/doc-carte.mjs', 'doc/doc-carte.compacte.mjs', 'tuto/tuto-carte.mjs'], modeles), modeles)
  })
})
