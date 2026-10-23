// Les webhooks `connect` / `disconnect` recopiaient les en-têtes du visiteur moins une liste de noms interdits, élargie deux
// fois sans jamais tout couvrir : l'identité posée par d'autres proxys d'authentification partait encore (Remote-User de nginx
// auth_request, Apache ou Authelia, X-Forwarded-Groups d'oauth2-proxy, X-Userinfo de Kong, Pomerium, Vouch, le certificat
// client d'Envoy ou de nginx). Seule une courte liste d'en-têtes utiles et sans secret part désormais ; l'appli en ajoute
// d'autres par `webhooks.forwardHeaders`, validé à la déclaration
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { findConfig } from '../src/bundler/config.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

const IDENTITES: Record<string, string> = {
  'remote-user':             'secret-remote-user',
  'x-remote-user':           'secret-x-remote-user',
  'remote-email':            'secret-remote-email@corp.test',
  'x-forwarded-groups':      'secret-admins,finance',
  'x-userinfo':              'eyJ.secret-revendications-kong',
  'x-pomerium-claim-email':  'secret-pomerium@corp.test',
  'x-vouch-user':            'secret-vouch@corp.test',
  'x-forwarded-client-cert': 'By=spiffe://x;Subject="CN=secret-envoy"',
  'x-ssl-client-s-dn':       'CN=secret-client-dn,O=Corp',
}

const ORDINAIRES: Record<string, string> = {
  'host':                  'jeu.site.test',
  'user-agent':            'Navigateur/1.0',
  'accept-language':       'fr-FR',
  'x-request-id':          'req-42',
  'x-forwarded-proto':     'https',
  'sec-websocket-version': '13',
}

async function webhookConnect(forwardHeaders?: string[]): Promise<Record<string, unknown>> {
  const recus: string[] = []
  const back = createServer((req, res) => {
    let corps = ''
    req.on('data', (c) => { corps += c })
    req.on('end', () => { recus.push(corps); res.end('ok') })
  })
  await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
  const port = (back.address() as AddressInfo).port
  const transport = new MemoryTransport()
  const webhooks: any = { url: 'http://127.0.0.1:' + port + '/hook', events: ['connect'] }
  if (forwardHeaders) webhooks.forwardHeaders = forwardHeaders
  const app = mjsWs({ transport, heartbeat: 0, auth: () => ({ id: 'u1' }), onLog: () => {}, bridge: { port: 0, secret: 'secret-de-test-webhook-liste-permise', rateLimit: false, webhooks } })
  await app.listen()
  try {
    const s: any = transport.connect({ headers: { ...IDENTITES, ...ORDINAIRES } })
    await tick()
    s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    for (let i = 0; i < 400 && recus.length < 1; i++) await tick(5)
    assert.equal(recus.length, 1, 'webhook connect reçu')
    return JSON.parse(recus[0]).client.meta.headers
  }
  finally {
    await app.stop()
    await new Promise<void>(r => back.close(() => r()))
  }
}

describe('MJS-WS — pont : webhooks connect/disconnect, seuls les en-têtes permis partent', function () {
  this.timeout(10000)

  it('aucun en-tête d’identité d’un proxy d’authentification ; les en-têtes ordinaires restent', async () => {
    const entetes = await webhookConnect()
    assert.deepEqual(Object.keys(IDENTITES).filter(nom => nom in entetes), [], 'en-têtes d’identité dans le webhook')
    assert.doesNotMatch(JSON.stringify(entetes), /secret/)
    for (const [nom, valeur] of Object.entries(ORDINAIRES)) assert.equal(entetes[nom], valeur, nom)
  })

  it('webhooks.forwardHeaders ajoute des en-têtes à la liste, sans tenir compte de la casse', async () => {
    const entetes = await webhookConnect(['X-Remote-User', 'x-forwarded-groups'])
    assert.equal(entetes['x-remote-user'], IDENTITES['x-remote-user'])
    assert.equal(entetes['x-forwarded-groups'], IDENTITES['x-forwarded-groups'])
    assert.equal('remote-user' in entetes, false)
    assert.equal(entetes['user-agent'], 'Navigateur/1.0')
  })

  it('webhooks.forwardHeaders invalide : refus à la déclaration, qui nomme l’option', () => {
    for (const valeur of ['x-remote-user', ['nom avec espace'], [''], [42], [null], {}]) {
      assert.throws(() => mjsWs({ transport: new MemoryTransport(), heartbeat: 0, onLog: () => {}, bridge: { port: 0, secret: 'secret-de-test-webhook-liste-permise', webhooks: { url: 'http://127.0.0.1:9/hook', events: ['connect'], forwardHeaders: valeur } } } as any), /webhooks\.forwardHeaders/, JSON.stringify(valeur))
    }
  })

  it('mjs.config.json : ws.bridge.webhooks.forwardHeaders est une clé connue', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'mjs-webhook-entetes-'))
    try {
      writeFileSync(join(dossier, 'mjs.config.json'), JSON.stringify({ ws: { bridge: { secret: 'env:MJS_SECRET', webhooks: { url: 'http://127.0.0.1:9/hook', events: ['connect'], forwardHeaders: ['x-remote-user'] } } } }))
      assert.doesNotThrow(() => findConfig(dossier))
    }
    finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})
