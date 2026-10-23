// Démarrage du cœur : `µ._mjs_styleCache` (un objet) et `µ._mjs_baseStyleCache` (une Map) étaient créés au
// démarrage et jamais lus ni écrits ailleurs — du poids chez chaque client et deux allocations pour rien. Ils ne
// sont plus créés : aucun fichier du runtime ne les nomme, et le cœur démarré ne les porte pas.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterHote } from './helpers/coeur-monter.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

const ICI = dirname(fileURLToPath(import.meta.url))
const RT  = join(ICI, '../src/runtime/')

describe('démarrage du cœur — caches de style jamais lus', function () {
  this.timeout(60000)

  it('aucun fichier du runtime ne nomme _mjs_styleCache ni _mjs_baseStyleCache', () => {
    const fautifs = readdirSync(RT).filter((f) => f.endsWith('.ts')).filter((f) => /_mjs_(base)?[sS]tyleCache\b/.test(readFileSync(join(RT, f), 'utf-8')))
    assert.deepEqual(fautifs, [])
  })

  it('le cœur démarré ne les porte pas', async () => {
    const { window } = await monterHote('<p>x</p>', 'sans-caches-style')
    assert.deepEqual(brut(window.eval('[typeof µ._mjs_styleCache, typeof µ._mjs_baseStyleCache]')), ['undefined', 'undefined'])
  })
})
