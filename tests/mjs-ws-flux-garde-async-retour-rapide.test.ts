// Garde `canSubscribe` ASYNCHRONE (base, back, proxy HTTP) repassée quand la connexion quitte un salon : la connexion
// quitte la table et y revient aussitôt (démontage puis remontage d'un composant, changement de page). La garde lancée au
// départ répondait « non » après le retour : la connexion, de nouveau membre, était désabonnée en silence, sans µ:error,
// et ne recevait plus rien jusqu'à sa reconnexion. La réponse d'une garde lancée au départ ne s'applique plus si la
// connexion est revenue dans le salon entre-temps
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — flux : garde canSubscribe asynchrone, départ du salon puis retour aussitôt', function () {
  this.timeout(10000)

  for (const forme of ['synchrone', 'asynchrone', 'asynchrone lente'] as const) {
    it(`garde ${forme} : revenue dans le salon, la connexion reçoit le delta suivant, sans µ:error`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const membre = (c: any) => app.room('partie-42').has(c)
      const garde = forme === 'synchrone' ? membre
        : forme === 'asynchrone' ? async (c: any) => membre(c)
        : async (c: any) => { const m = membre(c); await tick(15); return m }   // lit l'appartenance, puis vérifie en base
      const partie = app.stream('partie-42', { canSubscribe: garde })
      await app.listen()
      try {
        const ws = transport.connect({ url: 'ws://joueur/' })
        const trames: any[] = []
        ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
        const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
        await tick()
        envoyer('µ:hello', { protocol: 1 })
        await tick(10)
        envoyer('µ:join', { room: 'partie-42' })
        await tick(10)
        envoyer('µ:sub-stream', { stream: 'partie-42' })
        await tick(30)
        assert.ok(trames.some(f => f.t === 'partie-42' && f.p?.op === 'reset'), 'abonnée : instantané reçu')
        envoyer('µ:leave', { room: 'partie-42' })
        envoyer('µ:join', { room: 'partie-42' })
        await tick(60)
        assert.equal(app.room('partie-42').size, 1, 'membre après le retour')
        const avant = trames.length
        partie.add('coup-1', { joueur: 'B' })
        await tick(30)
        assert.deepEqual(trames.slice(avant).filter(f => f.t === 'partie-42').map(f => f.p), [{ op: 'add', key: 'coup-1', value: { joueur: 'B' } }], 'le delta suivant arrive')
        assert.deepEqual(trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
      } finally {
        await app.stop()
      }
    })
  }
})
