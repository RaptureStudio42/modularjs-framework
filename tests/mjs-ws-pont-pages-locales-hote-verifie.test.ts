// Pont en boucle locale : /stats, /metrics, /state, /heatmap et /heatmap.json sont servis sans signature (outil de
// dev). Quel que soit l'en-tête Host, ils répondaient : une page web ouverte sur la même machine les lisait par
// rebinding DNS (son nom de domaine pointé vers 127.0.0.1, le navigateur envoie SON nom dans Host). Désormais la
// voie non signée n'accepte que les noms de la machine elle-même (localhost, 127.0.0.1, [::1]) : tout autre Host,
// ou aucun, reçoit un 403.
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { mjsWs, heatmapPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

function get(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, ko) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      const parts: Buffer[] = []
      res.on('data', (c: Buffer) => parts.push(c))
      res.on('end', () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }))
    })
    req.on('error', ko)
    req.end()
  })
}

// requête HTTP/1.0 sans aucun en-tête Host (le serveur de node ne l'exige qu'en HTTP/1.1)
function getSansHost(port: number, path: string): Promise<string> {
  return new Promise((ok, ko) => {
    const sock = connect(port, '127.0.0.1', () => sock.write('GET '+ path +' HTTP/1.0\r\n\r\n'))
    let brut = ''
    sock.on('data', (c) => { brut += c })
    sock.on('end', () => ok(brut))
    sock.on('error', ko)
  })
}

const ROUTES = ['/stats', '/metrics', '/state', '/heatmap', '/heatmap.json']

describe('MJS-WS — pont en boucle locale : pages non signées et en-tête Host (rebinding DNS)', function () {
  this.timeout(10000)

  let app: MjsWsApp
  let port = 0

  before(async () => {
    const transport = new MemoryTransport()
    app = mjsWs({
      transport, heartbeat: 0, stats: true,
      onLog: (_l, message, meta: any) => { if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port },
      bridge: { port: 0, secret: 'secret-de-test-pont-hote-local' },
    })
    app.use(heatmapPackage({ origins: ['https://site.test'], onLog: () => {} }))
    await app.listen()
  })

  after(async () => { await app.stop() })

  for (const host of ['attaquant.example', 'attaquant.example:PORT', 'localhost.attaquant.example', '127.0.0.1.attaquant.example:PORT']) {
    it(`Host « ${host} » → 403 sur les cinq pages, rien de l'état du serveur dans la réponse`, async () => {
      for (const route of ROUTES) {
        const r = await get(port, route, host.replace('PORT', String(port)))
        assert.equal(r.status, 403, route +' → '+ r.status +' '+ r.body.slice(0, 80))
        assert.doesNotMatch(r.body, /connexions|processId|pages/, route)
      }
    })
  }

  it('aucun en-tête Host → 403', async () => {
    const brut = await getSansHost(port, '/stats')
    assert.match(brut, /^HTTP\/1\.[01] 403/, brut.slice(0, 80))
  })

  for (const host of ['127.0.0.1:PORT', 'localhost:PORT', 'LOCALHOST:PORT', '[::1]:PORT', 'localhost', '127.0.0.1']) {
    it(`Host « ${host} » → les pages répondent toujours`, async () => {
      for (const route of ROUTES) {
        const r = await get(port, route, host.replace('PORT', String(port)))
        assert.equal(r.status, 200, route +' → '+ r.status +' '+ r.body.slice(0, 80))
      }
    })
  }

  it('/health ne dépend pas du Host', async () => {
    const r = await get(port, '/health', 'attaquant.example')
    assert.equal(r.status, 200)
  })
})
