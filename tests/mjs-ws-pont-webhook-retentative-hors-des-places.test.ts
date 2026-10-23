// webhooks du pont universel (src/mjs-ws/bridge.ts) — une livraison en échec attendait sa retentative (2 s, puis 10 s)
// en gardant sa place parmi les 4 envois en vol : un back tombé une seule seconde immobilisait les 4 places 12 s, et la
// file ne se vidait plus qu'à 4 événements toutes les 12 s. L'attente se fait désormais hors des places : l'événement
// suivant part tout de suite, et les retentatives arrivent toujours
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBridge, resolveBridgeOptions } from '../src/mjs-ws/bridge.js'
import { createStatsRegistry } from '../src/mjs-ws/stats.js'

const SECRET = 'secret-de-test-webhook-retentative-1234567890'

async function attendre(cond: () => boolean, ms: number): Promise<void> {
  const debut = Date.now()
  while (!cond()) {
    if (Date.now() - debut > ms) throw new Error('condition jamais atteinte en '+ ms +' ms')
    await new Promise<void>(r => setTimeout(r, 5))
  }
}

describe('MJS-WS — pont universel : une retentative de webhook ne garde pas sa place d\'envoi', function () {
  this.timeout(20000)

  it('4 événements en échec attendent leur retentative ; le 5e, émis back rétabli, part tout de suite', async () => {
    let enPanne    = true
    let tentatives = 0
    const arrivees = new Map<string, number>()
    const back = createServer((req, res) => {
      let corps = ''
      req.on('data', morceau => { corps += morceau })
      req.on('end', () => {
        tentatives++
        if (enPanne) { res.writeHead(500); res.end(); return }
        arrivees.set(JSON.parse(corps).client.id, Date.now())
        res.writeHead(200); res.end('ok')
      })
    })
    await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
    const url      = 'http://127.0.0.1:'+ (back.address() as AddressInfo).port +'/hook'
    const resolved = resolveBridgeOptions({ port: 0, secret: SECRET, webhooks: { url, events: ['connect'] } }, 0)
    const stats    = createStatsRegistry()
    const pont     = createBridge(resolved, { onLog: () => {}, stats } as any)
    try {
      for (let i = 1; i <= 4; i++) pont.notifyConnect({ id: 'c'+ i, identity: null, meta: {} } as any)
      await attendre(() => tentatives >= 4, 5000)
      enPanne = false
      const depart = Date.now()
      pont.notifyConnect({ id: 'c5', identity: null, meta: {} } as any)
      await attendre(() => arrivees.has('c5'), 5000)
      const delai = arrivees.get('c5')! - depart
      assert.ok(delai < 1000, 'le 5e événement a attendu '+ delai +' ms une place libre')
      // les 4 premiers arrivent à leur retentative (+2 s)
      await attendre(() => ['c1', 'c2', 'c3', 'c4'].every(id => arrivees.has(id)), 6000)
      assert.equal(stats.pont.webhooksEchoues, 4)
      assert.equal(stats.pont.webhooksEnvoyes, 5)
      assert.equal(stats.pont.webhooksAbandonnes, 0)
    }
    finally {
      await pont.stop()
      back.closeAllConnections()
      await new Promise<void>(r => back.close(() => r()))
    }
  })
})
