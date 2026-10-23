// Le relevé des briques du cœur cherchait `µ.every(` collé : un appel écrit `µ.every (1000, fn)` (une espace avant la parenthèse,
// ou un retour à la ligne) passait inaperçu, le module `every` restait hors du cœur, et la garde du contrat refusait le build
// (« Cœur incomplet »). Il est reconnu comme les autres appels ; une simple mention, sans appel, n'embarque toujours rien.

import assert from 'node:assert/strict'
import { scanCompiledFeatures } from '../src/bundler/features.js'

describe('relevé des briques — µ.every appelé avec une espace', () => {
  it('µ.every (…) et µ.every\\n(…) embarquent every', () => {
    for (const js of ['µ.every (1000, () => tick())', 'µ.every\n(1000, () => tick())', 'µ . every(1000, () => tick())']) {
      assert.ok(scanCompiledFeatures(js).has('every'), JSON.stringify(js))
    }
  })

  it('témoin : µ.every(…) collé embarque every, une mention sans appel non', () => {
    assert.ok(scanCompiledFeatures('µ.every(1000, () => tick())').has('every'))
    assert.equal(scanCompiledFeatures('const f = µ.every').has('every'), false)
    assert.equal(scanCompiledFeatures('µ.everyday(1)').has('every'), false)
  })
})
