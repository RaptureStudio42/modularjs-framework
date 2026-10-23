// Les webhooks `connect` et `disconnect` recopiaient tous les en-têtes HTTP du visiteur, cookie de session et
// Authorization compris : ils partaient vers l'URL du webhook (http possible) et finissaient dans ses journaux.
// Désormais les en-têtes qui portent un secret du visiteur sont retirés du webhook (cookie, authorization,
// proxy-authorization, x-csrf-token, x-xsrf-token, set-cookie, quelle que soit la casse) ; les autres restent,
// et `client.meta.headers` reste entier côté serveur (opts.auth le lit toujours).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(pred: () => boolean, ms = 4000): Promise<void> {
  const debut = Date.now()
  while (!pred()) {
    if (Date.now() - debut > ms) throw new Error('attente expirée')
    await tick(5)
  }
}

const SENSIBLES = ['cookie', 'authorization', 'proxy-authorization', 'x-csrf-token', 'x-xsrf-token', 'set-cookie']

describe('MJS-WS — pont : webhooks connect/disconnect sans les en-têtes sensibles du visiteur', function () {
  this.timeout(10000)

  it('cookie, Authorization, jetons CSRF et set-cookie retirés ; user-agent et accept-language gardés ; meta du serveur intacte', async () => {
    const recus: string[] = []
    const back = createServer((req, res) => {
      let corps = ''
      req.on('data', (c) => { corps += c })
      req.on('end', () => { recus.push(corps); res.end('ok') })
    })
    await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
    const port = (back.address() as AddressInfo).port
    let cookieVuParAuth: unknown = null
    const transport = new MemoryTransport()
    const app = mjsWs({
      transport, heartbeat: 0,
      auth: (_h: any, meta: any) => { cookieVuParAuth = meta.headers?.cookie; return { id: 'u1' } },
      onLog: () => {},
      bridge: { port: 0, secret: 'secret-de-test-webhook-entetes', rateLimit: false, webhooks: { url: 'http://127.0.0.1:'+ port +'/hook', events: ['connect', 'disconnect'] } },
    })
    await app.listen()
    try {
      const s: any = transport.connect({
        origin: 'https://site.test',
        headers: {
          'cookie':              '_session=jeton-de-session-secret',
          'authorization':       'Bearer eyJ.secret.jwt',
          'proxy-authorization': 'Basic c2VjcmV0LXByb3h5',
          'X-CSRF-Token':        'csrf-secret',
          'x-xsrf-token':        'xsrf-secret',
          'set-cookie':          ['a=secret-un', 'b=secret-deux'],
          'user-agent':          'Navigateur/1.0',
          'accept-language':     'fr-FR',
        },
      })
      const trames: any[] = []
      s.onmessage = (ev: any) => { trames.push(JSON.parse(ev.data)) }
      await tick()
      s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: 'x' } }))
      await attendre(() => trames.some(f => f.t === 'µ:welcome'))
      await attendre(() => recus.length >= 1)
      assert.equal(cookieVuParAuth, '_session=jeton-de-session-secret', 'opts.auth lit toujours le cookie')
      const client = Array.from(app.clients)[0]
      assert.equal((client.meta.headers as any).cookie, '_session=jeton-de-session-secret', 'client.meta.headers reste entier côté serveur')
      s.close()
      await attendre(() => recus.length >= 2)

      for (const brut of recus) {
        const corps = JSON.parse(brut)
        assert.ok(corps.event === 'connect' || corps.event === 'disconnect', corps.event)
        const entetes = corps.client.meta.headers
        for (const nom of Object.keys(entetes)) assert.ok(!SENSIBLES.includes(nom.toLowerCase()), `en-tête « ${nom} » envoyé au webhook ${corps.event}`)
        assert.equal(entetes['user-agent'], 'Navigateur/1.0')
        assert.equal(entetes['accept-language'], 'fr-FR')
        assert.equal(corps.client.meta.origin, 'https://site.test')
        assert.doesNotMatch(brut, /secret/, `un secret du visiteur dans le webhook ${corps.event} : ${brut}`)
      }
    } finally {
      await app.stop()
      await new Promise<void>(r => back.close(() => r()))
    }
  })
})
