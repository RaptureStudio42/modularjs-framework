// garde contre le rebinding DNS : le serveur de développement (src/server/hmr.ts) et la voie non signée du pont MJS WS
// (/stats, /metrics, /state en boucle locale) lisaient chacun l'en-tête Host avec leur propre expression. Une seule aide
// lit maintenant le nom de l'en-tête Host pour les deux ; chaque côté garde sa liste de noms admis
import assert from 'node:assert/strict'
import { createDevHostCheck } from '../src/server/hmr.js'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { request } from 'node:http'

// GET brut (fetch n'envoie pas un Host choisi) ; rend le statut
function lire(port: number, chemin: string, host: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (host !== undefined) headers.host = host
    const req = request({ host: '127.0.0.1', port, path: chemin, method: 'GET', headers, setHost: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
    req.on('error', reject)
    req.end()
  })
}

describe('En-tête Host — une seule lecture pour le serveur de développement et le pont MJS WS', function () {
  this.timeout(15000)
  let hostHeaderName: (host: string | string[] | undefined) => string | undefined
  before(async () => { ({ hostHeaderName } = await import('../src/host-header.js')) })

  it('nom de l’en-tête : minuscules, sans le port, IPv6 sans crochets ; illisible ou absent → undefined', () => {
    assert.equal(hostHeaderName('LocalHost:3000'), 'localhost')
    assert.equal(hostHeaderName(' 127.0.0.1 '), '127.0.0.1')
    assert.equal(hostHeaderName('[::1]:8081'), '::1')
    assert.equal(hostHeaderName(['app.localhost:80', 'autre']), 'app.localhost')
    assert.equal(hostHeaderName('localhost:'), 'localhost')
    for (const illisible of [undefined, '', 'localhost:abc', '::1', '[::1', '[fe80::1%25eth0]']) assert.equal(hostHeaderName(illisible as any), undefined, String(illisible))
  })

  it('serveur de développement : les mêmes en-têtes admis ou refusés qu’avant', () => {
    const admis = createDevHostCheck('127.0.0.1', [], [])
    for (const h of ['localhost:5173', '127.0.0.1', '[::1]:5173', 'app.localhost']) assert.equal(admis(h), true, h)
    for (const h of [undefined, 'evil.example', 'localhost.evil.example', '127.0.0.1.evil.example', '[::1', 'localhost:abc']) assert.equal(admis(h), false, String(h))
  })

  it('pont MJS WS en boucle locale (/stats non signé) : les mêmes en-têtes admis ou refusés qu’avant', async () => {
    let port = 0
    const app = mjsWs({
      transport: new MemoryTransport(), heartbeat: 0, stats: true,
      bridge: { port: 0, secret: 'secret-de-test-entete-host-1234567890' },
      onLog: (_n, message, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute|universal bridge listening/.test(message)) port = meta.port },
    })
    await app.listen()
    try {
      for (const h of ['localhost:9', '127.0.0.1', '[::1]:9', 'LOCALHOST']) assert.equal(await lire(port, '/stats', h), 200, h)
      for (const h of ['evil.example', 'localhost.evil.example', '127.0.0.1.evil.example', '[::1', 'localhost:abc', 'app.localhost']) assert.equal(await lire(port, '/stats', h), 403, h)
    }
    finally {
      await app.stop()
    }
  })
})
