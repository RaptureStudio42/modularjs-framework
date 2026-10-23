// Un flux public dont le nom commence par celui du salon suivi d'une barre (`hall/annonces`, le nom que donne
// `sock.room('hall').stream('annonces')`) continuait d'envoyer ses deltas à la connexion partie du salon : le client du
// framework oublie ce flux en partant et ignorait ces trames. La connexion en est désabonnée au départ ; revenue, elle le
// redemande elle-même et reçoit l'état complet
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — flux public d’un salon (`salon/…`) : plus de deltas après le départ', function () {
  this.timeout(10000)

  it('parti du salon, plus aucun delta ; revenu et redemandé, l’état complet', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const annonces = app.stream('hall/annonces', { public: true })
    await app.listen()
    try {
      const ws = transport.connect({ url: 'ws://visiteur/' })
      const trames: any[] = []
      ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
      const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
      await tick()
      envoyer('µ:hello', { protocol: 1 })
      await tick(10)
      envoyer('µ:join', { room: 'hall' })
      envoyer('µ:sub-stream', { stream: 'hall/annonces' })
      await tick(20)
      envoyer('µ:leave', { room: 'hall' })
      await tick(10)
      const avant = trames.length
      annonces.add('a1', 'bienvenue')
      await tick(10)
      assert.deepEqual(trames.slice(avant).filter(f => f.t === 'hall/annonces'), [], 'parti du salon : aucun delta')
      envoyer('µ:join', { room: 'hall' })
      envoyer('µ:sub-stream', { stream: 'hall/annonces' })
      await tick(20)
      assert.deepEqual(trames.slice(avant).filter(f => f.t === 'hall/annonces').map(f => f.p), [{ op: 'reset', values: { a1: 'bienvenue' } }])
    } finally {
      await app.stop()
    }
  })
})
