// µminmax($config.volume, 0, 10) — le `.volume` retombait autrefois hors des quotes
// (`'config'.volume`, clé undefined, jamais borné, sans la moindre erreur). Un chemin FIXE borne
// désormais la propriété (clé en tableau, cf. minmax-propriete.test.ts pour l'exécution) ; la
// forme documentée, sur une variable, est inchangée.

import assert from 'node:assert/strict'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { transpile } from '../src/transpiler/index.js'

describe('µminmax($x, min, max) — forme documentée, inchangée', () => {
  it("µminmax($x, 0, 10) → µ.minmax(_mjsThis, 'x', 0, 10)", () => {
    assert.equal(cleanJs('µminmax($x, 0, 10)'), "µ.minmax(_mjsThis, 'x', 0, 10)")
  })
})

describe('µminmax($config.volume, min, max) — un chemin fixe borne la propriété', () => {
  it("cleanJs : clé en tableau, jamais la forme cassée 'config'.volume", () => {
    assert.equal(cleanJs('µminmax($config.volume, 0, 10)'), "µ.minmax(_mjsThis, ['config', 'volume'], 0, 10)")
  })

  it('cleanJsExpr (interpolation) : même réécriture', () => {
    assert.equal(cleanJsExpr('µminmax($config.volume, 0, 10)'), "µ.minmax(_mjsThis, ['config', 'volume'], 0, 10)")
  })

  it('dans le <script> d\'un composant (forme parenthésée) : compile', async () => {
    const src = '<script>\n$config = {volume: 50}\nµminmax($config.volume, 0, 10)\n</script>\n<p>{$config.volume}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'minmax-chemin' }))
  })
})
