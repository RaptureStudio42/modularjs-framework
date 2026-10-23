// Garde `canSubscribe` asynchrone qui lit le salon après avoir attendu (base, back) : la connexion quitte le salon, y
// revient, puis le quitte de nouveau avant la réponse de la garde lancée au premier départ. Ce second départ n'était pas
// noté pour la reprise : la garde répondait « non », la connexion était désabonnée, et revenue dans le salon elle ne
// retrouvait jamais le flux, sans le moindre µ:error. Un départ pendant une vérification sans réponse compte aussi pour
// la reprise
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — flux : second départ du salon pendant la garde du premier', function () {
  this.timeout(10000)

  it('revenue après le second départ, la connexion retrouve le flux', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const cartes = app.stream('cartes', { canSubscribe: async (c) => { await tick(40); return app.room('table').has(c) } })
    await app.listen()
    try {
      const ws = transport.connect({ url: 'ws://joueur/' })
      const trames: any[] = []
      ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
      const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
      await tick()
      envoyer('µ:hello', { protocol: 1 })
      await tick(10)
      envoyer('µ:join', { room: 'table' })
      await tick(10)
      envoyer('µ:sub-stream', { stream: 'cartes' })
      await tick(80)
      assert.ok(trames.some(f => f.t === 'cartes' && f.p?.op === 'reset'), 'abonnée : instantané reçu')
      envoyer('µ:leave', { room: 'table' })
      await tick(5)
      envoyer('µ:join', { room: 'table' })
      await tick(5)
      envoyer('µ:leave', { room: 'table' })
      await tick(100)
      envoyer('µ:join', { room: 'table' })
      await tick(1300)
      const avant = trames.length
      cartes.add('as', 1)
      await tick(30)
      const recus = trames.slice(avant).filter(f => f.t === 'cartes').map(f => f.p)
      assert.deepEqual(recus, [{ op: 'add', key: 'as', value: 1 }], 'revenue : le flux reprend')
      assert.deepEqual(trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })
})
