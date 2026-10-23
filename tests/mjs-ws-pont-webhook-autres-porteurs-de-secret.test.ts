// Les webhooks `connect` / `disconnect` retiraient le cookie et Authorization, mais laissaient partir vers l'URL du
// webhook les autres en-têtes qui portent un secret du visiteur : Sec-WebSocket-Protocol (le seul en-tête qu'un
// navigateur peut poser sur un WebSocket, où l'on met souvent le jeton), les jetons posés par un proxy
// d'authentification devant l'appli (oauth2-proxy, Cloudflare Access, Google IAP), une clé d'API. Tout en-tête dont le
// nom parle de jeton, de secret, d'authentification, de clé, de cookie, de session ou de signature est désormais retiré
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

const SECRETS: Record<string, string> = {
  'Sec-WebSocket-Protocol':      'access_token, eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InUxIn0.secret-protocole',
  'x-forwarded-access-token':    'ya29.secret-oauth2-proxy',
  'X-Auth-Request-Access-Token': 'secret-auth-request',
  'cf-access-jwt-assertion':     'eyJ.secret-cloudflare-access',
  'x-goog-iap-jwt-assertion':    'eyJ.secret-google-iap',
  'x-api-key':                   'sk_live_secret-cle-api',
  'x-session-id':                'secret-session',
  'x-hub-signature':             'sha256=secret-signature',
  'cookie':                      '_session=secret-cookie',
  'authorization':               'Bearer secret-autorisation',
}

describe('MJS-WS — pont : webhooks connect/disconnect sans aucun porteur de secret du visiteur', function () {
  this.timeout(10000)

  it('Sec-WebSocket-Protocol, jetons de proxy d’authentification, clé d’API, session, signature retirés ; les en-têtes ordinaires restent', async () => {
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
      bridge: { port: 0, secret: 'secret-de-test-webhook-porteurs', rateLimit: false, webhooks: { url: 'http://127.0.0.1:' + port + '/hook', events: ['connect', 'disconnect'] } },
    })
    await app.listen()
    try {
      const s: any = transport.connect({
        origin: 'https://site.test',
        headers: { ...SECRETS, 'user-agent': 'Navigateur/1.0', 'accept-language': 'fr-FR', 'x-request-id': 'req-42', 'sec-websocket-version': '13' },
      })
      const trames: any[] = []
      s.onmessage = (ev: any) => { trames.push(JSON.parse(ev.data)) }
      await tick()
      s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      for (let i = 0; i < 400 && recus.length < 1; i++) await tick(5)
      assert.equal((Array.from(app.clients)[0].meta.headers as any)['x-api-key'], SECRETS['x-api-key'], 'client.meta.headers reste entier côté serveur')
      s.close()
      for (let i = 0; i < 400 && recus.length < 2; i++) await tick(5)
      assert.equal(recus.length, 2, 'connect et disconnect reçus')

      for (const brut of recus) {
        const corps   = JSON.parse(brut)
        const entetes = corps.client.meta.headers
        const fuites  = Object.keys(SECRETS).filter(nom => brut.includes(SECRETS[nom].split('secret-').pop()!))
        assert.deepEqual(fuites, [], `secrets présents dans le webhook ${corps.event} : ${fuites.join(', ')}`)
        assert.doesNotMatch(brut, /secret/, `un secret du visiteur dans le webhook ${corps.event}`)
        assert.equal(entetes['user-agent'], 'Navigateur/1.0')
        assert.equal(entetes['accept-language'], 'fr-FR')
        assert.equal(entetes['x-request-id'], 'req-42')
        assert.equal(entetes['sec-websocket-version'], '13')
        assert.equal(corps.client.meta.origin, 'https://site.test')
      }
    } finally {
      await app.stop()
      await new Promise<void>(r => back.close(() => r()))
    }
  })
})
