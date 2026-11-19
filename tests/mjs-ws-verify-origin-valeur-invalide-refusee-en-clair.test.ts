// verifyOrigin : une valeur qui n'est ni une liste d'origines ni une fonction (null, une chaîne seule) est refusée à la
// construction avec un message qui nomme le réglage et donne les deux formes — jamais une TypeError brute
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'

describe('MJS-WS — verifyOrigin invalide : refus clair à la construction', () => {
  for (const raw of [null, 'https://mon-site.example', 42]) {
    it('verifyOrigin: ' + JSON.stringify(raw) + ' → erreur claire', () => {
      assert.throws(() => mjsWs({ transport: new MemoryTransport(), verifyOrigin: raw as any }), (err: unknown) => {
        assert.ok(!(err instanceof TypeError), 'TypeError brute : ' + String(err))
        assert.equal((err as Error).message, t('ws.index.verify-origin-invalid', { received: String(raw) }))
        return true
      })
    })
  }

  it('absent, une liste ou une fonction : accepté', () => {
    for (const verifyOrigin of [undefined, ['https://mon-site.example'], () => true]) assert.doesNotThrow(() => mjsWs({ transport: new MemoryTransport(), verifyOrigin }))
  })
})
