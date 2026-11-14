// Le relevé des briques du cœur cherchait `µ.every(` collé : un appel écrit `µ.every (1000, fn)` (une espace avant la parenthèse,
// ou un retour à la ligne) passait inaperçu, le module `every` restait hors du cœur, et la garde du contrat refusait le build
// (« Cœur incomplet »). Il est reconnu comme les autres appels ; une mention sans appel (`f = µ.every`) l'embarque aussi, puisqu'elle
// peut être appelée plus tard ; un autre nom (`µ.everyday`) n'embarque rien.

import assert from 'node:assert/strict'
import { scanCompiledFeatures } from '../src/bundler/features.js'

describe('relevé des briques — µ.every appelé avec une espace', () => {
  it('µ.every (…) et µ.every\\n(…) embarquent every', () => {
    for (const js of ['µ.every (1000, () => tick())', 'µ.every\n(1000, () => tick())', 'µ . every(1000, () => tick())']) {
      assert.ok(scanCompiledFeatures(js).has('every'), JSON.stringify(js))
    }
  })

  it('témoin : µ.every(…) collé embarque every, une mention sans appel aussi, un autre nom non', () => {
    assert.ok(scanCompiledFeatures('µ.every(1000, () => tick())').has('every'))
    assert.ok(scanCompiledFeatures('const f = µ.every').has('every'))
    assert.equal(scanCompiledFeatures('µ.everyday(1)').has('every'), false)
  })
})
