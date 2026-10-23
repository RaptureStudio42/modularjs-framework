// limites par adresse du serveur temps réel (src/mjs-ws/core.ts) et du pont (src/mjs-ws/bridge.ts) — une IPv6 comptait
// pour son adresse entière : un visiteur qui dispose d'un /56 (256 préfixes /64, des milliards d'adresses) changeait
// d'adresse à chaque connexion et contournait le plafond de connexions par adresse, le débit partagé, la mise au banc
// et le seau du pont. Une IPv6 compte désormais pour tout son préfixe /56, comme dans les comptes ; IPv4 inchangée
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { createBridgeRateLimiter } from '../src/mjs-ws/bridge.js'
import { TransportAvecAdresse } from './helpers/comptes-brut.js'
import type { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// arrivée d'une connexion depuis `adresse` : 'accueillie' (µ:welcome) ou le code de fermeture
async function arrivee(transport: MemoryTransport, adresse: string): Promise<'accueillie' | number> {
  const ws            = transport.connect({ headers: { 'x-adresse': adresse } })
  const trames: any[] = []
  let fermeture: number | null = null
  ws.onmessage = (ev: any) => trames.push(JSON.parse(String(ev.data)))
  ws.onclose   = (ev: { code: number }) => { fermeture = ev.code }
  await tick()
  if (fermeture === null) ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  const debut = Date.now()
  while (fermeture === null && !trames.some(m => m.t === 'µ:welcome')) {
    if (Date.now() - debut > 3000) throw new Error('ni accueil ni fermeture pour '+ adresse)
    await tick(2)
  }
  return fermeture ?? 'accueillie'
}

describe('MJS-WS — limites par adresse : une IPv6 compte pour son préfixe /56', function () {
  this.timeout(15000)

  it('plafond de connexions par adresse : trois adresses d\'un même /56 en font une ; un autre /56 et IPv4 à part', async () => {
    const transport = new TransportAvecAdresse()
    const app       = mjsWs({ transport, heartbeat: 0, limits: { maxConnectionsPerIp: 2 }, onLog: () => {} })
    await app.listen()
    try {
      assert.equal(await arrivee(transport, '2001:db8:aa:bb01::1'), 'accueillie')
      assert.equal(await arrivee(transport, '2001:db8:aa:bb02::1'), 'accueillie')
      assert.equal(await arrivee(transport, '2001:db8:aa:bbff:1:2:3:4'), 1013, 'troisième adresse du même /56 : plafond atteint')
      assert.equal(await arrivee(transport, '2001:db8:aa:cc00::1'), 'accueillie', 'un autre /56')
      assert.equal(await arrivee(transport, '203.0.113.5'), 'accueillie')
      assert.equal(await arrivee(transport, '203.0.113.6'), 'accueillie', 'IPv4 : chaque adresse compte seule')
    }
    finally {
      await app.stop()
    }
  })

  it('seau du pont : deux adresses d\'un même /56 partagent leur seau ; IPv4 écrite en IPv6 = la même adresse', () => {
    const limiteur = createBridgeRateLimiter({ perIp: { capacity: 1, windowMs: 60000 }, fails: { capacity: 1, windowMs: 60000 } })
    assert.equal(limiteur.admitGeneral('2001:db8:aa:bb01::1'), true)
    assert.equal(limiteur.admitGeneral('2001:db8:aa:bb02::9'), false, 'même /56 : seau déjà vide')
    assert.equal(limiteur.admitGeneral('2001:db8:aa:cc00::1'), true, 'un autre /56')
    assert.equal(limiteur.admitGeneral('::ffff:127.0.0.1'), true)
    assert.equal(limiteur.admitGeneral('127.0.0.1'), false, 'même adresse, autre écriture')
    assert.equal(limiteur.size, 3)
  })
})
