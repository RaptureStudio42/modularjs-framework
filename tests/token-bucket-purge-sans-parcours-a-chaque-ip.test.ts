// Seaux à jetons par IP (POST /__mjs/errors) : au-delà de 1000 adresses, CHAQUE adresse nouvelle
// déclenchait un parcours complet de la carte — des IPv6 tournantes (triviales à fabriquer)
// coûtaient un parcours par requête : 20 000 adresses, 13 s de boucle bloquée. La purge ne
// repasse désormais qu'après un délai, ou quand la carte a doublé depuis la dernière : coût
// constant amorti par adresse.

import assert from 'node:assert/strict'
import { TokenBucket, pruneIdleBuckets } from '../src/server/token-bucket.js'

describe('pruneIdleBuckets — pas de parcours complet à chaque adresse nouvelle', () => {
  it('20 000 adresses actives distinctes : moins de 300 ms', () => {
    const buckets = new Map<string, TokenBucket>()
    const t0 = performance.now()
    for (let i = 0; i < 20000; i++) {
      pruneIdleBuckets(buckets)
      const b = new TokenBucket(10, 0.5)
      b.take()
      buckets.set('2001:db8::' + i.toString(16), b)
    }
    const duree = performance.now() - t0
    assert.ok(duree < 300, `purge trop lente : ${duree.toFixed(0)} ms`)
  })
})
