// flux réservé à un salon (`{ room }`) et nommé hors du salon : la connexion qui quitte le salon en est désabonnée, et
// le serveur le lui rend quand elle revient. Ce retour tient à la fonction que rend le départ (streams.ts) et que le cœur
// doit transmettre au moteur des salons : si ce retour se perd, la connexion revenue ne reçoit plus rien du flux
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — flux réservé au salon : rendu au retour dans le salon', function () {
  this.timeout(10000)

  it('départ : plus rien ; retour sans redemander le flux : état complet puis deltas', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const tableau   = app.stream('tableau', { room: 'salle' })
    tableau.add('a', 1)
    await app.listen()
    try {
      const ws            = transport.connect({})
      const trames: any[] = []
      ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
      const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
      await tick()
      envoyer('µ:hello', { protocol: 1 }); await tick(20)
      envoyer('µ:join', { room: 'salle' }); await tick(20)
      envoyer('µ:sub-stream', { stream: 'tableau' }); await tick(20)
      tableau.add('b', 2); await tick(20)
      assert.ok(trames.some(f => f.t === 'tableau'), 'abonné dans le salon')

      envoyer('µ:leave', { room: 'salle' }); await tick(20)
      let n0 = trames.length
      tableau.add('c', 3); await tick(20)
      assert.deepEqual(trames.slice(n0).filter(f => f.t === 'tableau'), [], 'hors du salon : rien')

      n0 = trames.length
      envoyer('µ:join', { room: 'salle' }); await tick(30)
      tableau.add('d', 4); await tick(20)
      const rendues = trames.slice(n0).filter(f => f.t === 'tableau')
      assert.ok(rendues.length >= 2, 'retour : le flux est rendu sans le redemander — ' + JSON.stringify(rendues))
      assert.equal(rendues[0].p.op, 'reset', 'état complet d’abord')
      assert.ok('c' in rendues[0].p.values, 'état complet, ce qui a changé pendant l’absence compris')
      ws.close()
    }
    finally {
      await app.stop()
    }
  })
})
