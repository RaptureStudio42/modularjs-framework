// proxy de décisions (src/mjs-ws/proxy.ts), `cache.ttl` — un refus dû à une panne du back (délai dépassé, réseau,
// statut non 2xx) était gardé tout le `ttl` comme une vraie décision : le visiteur restait dehors après le
// rétablissement du back. Seule une réponse du back se garde désormais
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { creerProxyDecision } from '../src/mjs-ws/proxy.js'

const SECRET = 'secret-de-test-proxy-panne-1234567890'

describe('MJS-WS — proxy de décisions : un refus de panne n\'est jamais gardé en cache', function () {
  this.timeout(15000)

  it('statut 503, puis délai dépassé : refus non gardés ; une vraie décision reste gardée', async () => {
    let mode: 'panne' | 'muet' | 'oui' | 'non' = 'panne'
    let appels = 0
    const back = createServer((req, res) => {
      appels++
      req.resume()
      req.on('end', () => {
        if (mode === 'muet') return
        if (mode === 'panne') { res.writeHead(503); res.end(); return }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ allow: mode === 'oui' }))
      })
    })
    await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
    const url     = 'http://127.0.0.1:'+ (back.address() as AddressInfo).port +'/decider'
    const decider = creerProxyDecision({ url, secret: SECRET, timeout: 300, cache: { ttl: 60000 } }, 'connect', (json: any) => json?.allow === true, () => {})
    try {
      assert.equal(await decider({ visiteur: 'a' }), false, 'back en panne : refus')
      mode = 'muet'
      assert.equal(await decider({ visiteur: 'a' }), false, 'back muet : refus au délai')
      mode = 'oui'
      assert.equal(await decider({ visiteur: 'a' }), true, 'back rétabli : il décide de nouveau')
      assert.equal(appels, 3)
      mode = 'non'
      assert.equal(await decider({ visiteur: 'a' }), true, 'la décision du back est gardée')
      assert.equal(appels, 3)
      assert.equal(await decider({ visiteur: 'b' }), false, 'un refus décidé par le back...')
      mode = 'oui'
      assert.equal(await decider({ visiteur: 'b' }), false, '... est gardé comme les autres décisions')
      assert.equal(appels, 4)
    }
    finally {
      back.closeAllConnections()
      await new Promise<void>(r => back.close(() => r()))
    }
  })
})
