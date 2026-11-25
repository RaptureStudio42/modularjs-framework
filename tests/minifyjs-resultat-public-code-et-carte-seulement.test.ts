// `minifyJs`, exporté par le paquet, rend le texte compacté et sa carte, rien d'autre : le texte tel qu'esbuild l'a rendu, qui dispense
// le contrôle ESM du bundler de relire un fichier écrit à l'identique, reste interne au bundler et n'entre pas dans ce résultat

import assert from 'node:assert/strict'
import { minifyJs } from '../src/bundler/minify.js'

describe('minifyJs : le résultat public garde ses deux champs', function () {
  this.timeout(30000)

  it('compacté : `code` et `map`, sans champ en plus', async function () {
    const result = await minifyJs('export const a = 1 + 2;\n', { force: true, sourceMap: true })
    assert.deepEqual(Object.keys(result).sort(), ['code', 'map'])
  })

  it('rien à compacter : `code` seul', async function () {
    const result = await minifyJs('export const a = 1;\n', { force: false })
    assert.deepEqual(Object.keys(result), ['code'])
  })
})
