// Hash piégé : une longue suite de `/` suivie d'un segment (`#////…////a/`) faisait passer le retrait
// des `/` finaux de µ.Router._mjs_canonHash (exécuté dès le chargement, sur hashchange et au clic)
// en temps quadratique — un lien de 160 Ko gelait l'onglet plus de 5 s. Le retrait doit rester
// linéaire, sans changer le résultat.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUTER_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_router.ts'), 'utf-8')

function routeur() {
  const µ: any = { _mjs_logger: () => null, _mjs_txt: (_k: string, _p: any, f: string) => f, warn() {} }
  new Function('µ', ROUTER_SRC)(µ)
  return µ.Router
}

describe('mjs_router — _mjs_canonHash : temps linéaire sur un hash piégé', function () {
  it('100 000 `/` puis `a/` : traité en moins de 50 ms, slash final retiré', function () {
    const R = routeur()
    const n = 100000
    const t0 = performance.now()
    const sortie = R._mjs_canonHash('#' + '/'.repeat(n) + 'a/')
    const ms = performance.now() - t0
    assert.equal(sortie, '#' + '/'.repeat(n) + 'a')
    assert.ok(ms < 50, 'AVANT : temps quadratique (' + Math.round(ms) + ' ms pour ' + n + ' `/`)')
  })

  it('résultats inchangés sur les formes courantes', function () {
    const R = routeur()
    assert.equal(R._mjs_canonHash('#/about/'), '#/about')
    assert.equal(R._mjs_canonHash('#/about///'), '#/about')
    assert.equal(R._mjs_canonHash('#/a/?tri=x'), '#/a?tri=x')
    assert.equal(R._mjs_canonHash('#/'), '#/')
    assert.equal(R._mjs_canonHash('#///'), '#/')
    assert.equal(R._mjs_canonHash('#/about'), '#/about')
    assert.equal(R._mjs_canonHash('#section'), '#section')
    assert.equal(R._mjs_canonHash(''), '')
  })
})
