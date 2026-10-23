// Chaque départ d'un salon, même sans rapport avec les flux, repassait la garde `canSubscribe` de TOUS les flux suivis :
// une garde qui interroge la base ou le back était appelée N fois par µ:leave (20 flux suivis : 10 appels par trame,
// 100 connexions par adresse). Une garde n'est plus repassée qu'au départ d'un salon dont elle a lu l'appartenance
// (`app.room(nom).has(client)`) à sa dernière réponse
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function joueur(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://joueur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  return { trames, envoyer }
}

describe('MJS-WS — flux : départ d’un salon sans rapport, gardes canSubscribe épargnées', function () {
  this.timeout(10000)

  it('20 flux gardés suivis, 20 allers-retours dans un salon que leurs gardes ne lisent pas : aucun appel de garde', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    let appels = 0
    for (let i = 0; i < 20; i++) app.stream('tableau-' + i, { canSubscribe: async () => { appels++; return true } })
    await app.listen()
    try {
      const j = await joueur(transport)
      for (let i = 0; i < 20; i++) j.envoyer('µ:sub-stream', { stream: 'tableau-' + i })
      await tick(50)
      assert.equal(appels, 20, 'une garde par abonnement')
      for (let i = 0; i < 20; i++) { j.envoyer('µ:join', { room: 'hall' }); j.envoyer('µ:leave', { room: 'hall' }); await tick(2) }
      await tick(50)
      assert.equal(appels - 20, 0, 'appels de garde pendant 40 trames µ:join/µ:leave')
    } finally {
      await app.stop()
    }
  })

  it('une garde qui lit l’appartenance au salon quitté est repassée, une fois par départ', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    let appels = 0
    const scores = app.stream('scores', { canSubscribe: async (c) => { appels++; return app.room('hall').has(c) } })
    await app.listen()
    try {
      const j = await joueur(transport)
      j.envoyer('µ:join', { room: 'hall' }); await tick(10)
      j.envoyer('µ:sub-stream', { stream: 'scores' }); await tick(20)
      assert.equal(appels, 1)
      j.envoyer('µ:leave', { room: 'hall' }); await tick(20)
      assert.equal(appels, 2, 'repassée au départ du salon qu’elle lit')
      const avant = j.trames.length
      scores.add('pendant', 1); await tick(10)
      assert.deepEqual(j.trames.slice(avant).filter(f => f.t === 'scores'), [], 'refusée : plus aucun delta')
      j.envoyer('µ:join', { room: 'hall' }); await tick(20)
      scores.add('apres', 2); await tick(10)
      assert.deepEqual(j.trames.slice(avant).filter(f => f.t === 'scores').map(f => f.p.op), ['reset', 'add'], 'revenue : état complet puis deltas')
    } finally {
      await app.stop()
    }
  })
})
