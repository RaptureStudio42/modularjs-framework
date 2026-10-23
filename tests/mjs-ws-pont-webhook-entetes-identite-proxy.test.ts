// Les webhooks `connect` / `disconnect` laissaient encore partir vers l'URL du webhook des en-têtes d'identité posés par
// un proxy d'authentification devant l'appli : le jeton des revendications d'AWS ALB (x-amzn-oidc-data), l'identité
// d'Azure App Service (x-ms-client-principal, -name), un code à usage unique (x-otp), l'identité d'oauth2-proxy
// (x-forwarded-user, -email, -preferred-username). Ils sont retirés ; les en-têtes ordinaires restent
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

const IDENTITES: Record<string, string> = {
  'x-amzn-oidc-data':               'eyJ.secret-revendications-alb',
  'x-amzn-oidc-identity':           'secret-identite-alb',
  'x-ms-client-principal':          'eyJ.secret-principal-azure',
  'x-ms-client-principal-name':     'secret-nom@azure.test',
  'x-otp':                          'secret-123456',
  'x-forwarded-user':               'secret-utilisateur',
  'x-forwarded-email':              'secret-courriel@site.test',
  'x-forwarded-preferred-username': 'secret-pseudo',
  'x-auth-request-email':           'secret-auth-request@site.test',
}

describe('MJS-WS — pont : webhooks connect/disconnect sans les en-têtes d’identité d’un proxy d’authentification', function () {
  this.timeout(10000)

  it('oidc, principal, otp, x-forwarded-user / -email / -preferred-username, x-auth-request-* retirés ; les en-têtes ordinaires restent', async () => {
    const recus: string[] = []
    const back = createServer((req, res) => {
      let corps = ''
      req.on('data', (c) => { corps += c })
      req.on('end', () => { recus.push(corps); res.end('ok') })
    })
    await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
    const port = (back.address() as AddressInfo).port
    const transport = new MemoryTransport()
    const app = mjsWs({
      transport, heartbeat: 0, auth: () => ({ id: 'u1' }), onLog: () => {},
      bridge: { port: 0, secret: 'secret-de-test-webhook-identites', rateLimit: false, webhooks: { url: 'http://127.0.0.1:' + port + '/hook', events: ['connect', 'disconnect'] } },
    })
    await app.listen()
    try {
      const s: any = transport.connect({ headers: { ...IDENTITES, 'user-agent': 'Navigateur/1.0', 'accept-language': 'fr-FR', 'x-request-id': 'req-42', 'x-forwarded-proto': 'https' } })
      await tick()
      s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      for (let i = 0; i < 400 && recus.length < 1; i++) await tick(5)
      s.close()
      for (let i = 0; i < 400 && recus.length < 2; i++) await tick(5)
      assert.equal(recus.length, 2, 'connect et disconnect reçus')
      for (const brut of recus) {
        const corps   = JSON.parse(brut)
        const entetes = corps.client.meta.headers
        assert.deepEqual(Object.keys(IDENTITES).filter(nom => nom in entetes), [], `en-têtes d’identité dans le webhook ${corps.event}`)
        assert.doesNotMatch(brut, /secret/, `une identité du visiteur dans le webhook ${corps.event}`)
        assert.equal(entetes['user-agent'], 'Navigateur/1.0')
        assert.equal(entetes['accept-language'], 'fr-FR')
        assert.equal(entetes['x-request-id'], 'req-42')
        assert.equal(entetes['x-forwarded-proto'], 'https')
      }
    } finally {
      await app.stop()
      await new Promise<void>(r => back.close(() => r()))
    }
  })
})
