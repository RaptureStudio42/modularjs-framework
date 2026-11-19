// Noms de classe réservés au framework — pourquoi ce test existe.
//
// Une classe de l'appli (`Nom.class.mjs`) s'enregistre sur `µ`. La construction refuse les noms que le framework y pose déjà
// (`FRAMEWORK_CLASS_NAMES`), mais la liste avait oublié `TypeError`, que le cœur pose (`µ.TypeError`) : une classe `TypeError` de
// l'appli passait la construction et prenait la place de celle du framework.
//
// Ce que le test garde : chaque nom à majuscule que le cœur pose sur `µ` est dans la liste, et une classe de ce nom est refusée.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FRAMEWORK_CLASS_NAMES, collectClasses } from '../src/bundler/class-files.js'
import { t } from '../src/messages/index.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime')

describe('noms de classe du framework — tous réservés', () => {
  it('chaque nom à majuscule que le cœur pose sur µ est réservé', () => {
    const poses = new Set<string>()
    for (const f of readdirSync(RUNTIME).filter(n => n.endsWith('.ts'))) {
      for (const m of readFileSync(join(RUNTIME, f), 'utf-8').matchAll(/µ\.([A-Z][A-Za-z0-9_]*) = /g)) poses.add(m[1])
    }
    assert.ok(poses.size > 0, 'aucun nom relevé : la recherche ne trouve plus les poses du cœur')
    assert.deepEqual([...poses].filter(n => !FRAMEWORK_CLASS_NAMES.includes(n)).sort(), [])
  })

  it('une classe TypeError de l\'appli est refusée, en nommant son fichier', () => {
    const attendu = t('bundler.class-name-framework', { file: 'TypeError.class.mjs', name: 'TypeError' })
    assert.throws(() => collectClasses(['/projet/src/TypeError.class.mjs'], '/projet/src', () => 'class TypeError\n  CODE = 1\n'), (e: any) => e.message === attendu)
  })
})
