// Flux — la réponse à un flux inconnu (`µ:sub-stream` / `µ:resync`) renvoyait dans son type le nom envoyé par le
// client, sans le couper : un nom de 60 000 caractères revenait en une trame de 60 Ko, à chaque demande. Un nom de flux
// inconnu de plus de 200 caractères (la borne des noms de salon) reçoit maintenant une erreur courte, sans son nom ; un
// nom ordinaire garde la réponse d'un flux inconnu (reset vide).
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — flux inconnu au nom trop long : réponse courte, sans le nom du client', function () {
  this.timeout(10000)

  it('µ:sub-stream et µ:resync d’un nom de 60 000 caractères : µ:error court ; 200 caractères : reset vide sous ce nom', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    await app.listen()
    try {
      const ws = transport.connect({})
      const brutes: string[] = []
      ws.onmessage = (ev: any) => brutes.push(String(ev.data))
      await tick()
      ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      await tick(5)
      brutes.length = 0
      const geant = 'f'.repeat(60000)
      ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: geant } }))
      ws.send(JSON.stringify({ t: 'µ:resync', p: { stream: geant, from: 0 } }))
      await tick(20)
      console.log('      réponses à un nom de 60 000 caractères :', brutes.map(b => b.length + ' caractères').join(' · '))
      assert.equal(brutes.length, 2)
      for (const b of brutes) {
        assert.ok(b.length < 300, `trame de ${b.length} caractères pour un nom inconnu`)
        const trame = JSON.parse(b)
        assert.equal(trame.t, 'µ:error')
        assert.equal(trame.p.message, t('ws.streams.nom-trop-long', { max: 200 }))
      }
      brutes.length = 0
      const ordinaire = 'g'.repeat(200)
      ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: ordinaire } }))
      await tick(20)
      assert.deepEqual(brutes.map(b => JSON.parse(b)), [{ t: ordinaire, seq: 0, p: { op: 'reset', values: {} } }])
    } finally {
      await app.stop()
    }
  })
})
