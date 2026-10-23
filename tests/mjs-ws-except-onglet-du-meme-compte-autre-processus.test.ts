// core.ts — `except: client` (diffusion générale ou salon) exclut UNE connexion : en multi-processus, l'id du
// compte partait aussi aux autres processus, qui excluaient alors tous les onglets de ce compte — l'onglet du
// même utilisateur servi par un autre processus ne recevait jamais le message (« ne pas renvoyer son propre
// message à l'émetteur »). Seule la connexion visée doit être exclue, partout.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function processus(bus: ReturnType<typeof createMemoryAdapterBus>): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, adapter: new MemoryAdapter({ bus }), auth: (hello: any) => hello.auth, onLog: () => {} })
  await app.listen()
  return { transport, app }
}

async function onglet(transport: MemoryTransport, id: string): Promise<{ ws: any; trames: any[] }> {
  const ws            = transport.connect({ url: 'memory://except' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id } } }))
  await tick(10)
  assert.ok(trames.some(f => f.t === 'µ:welcome'), `l'onglet de ${id} doit être accueilli`)
  return { ws, trames }
}

const recu = (o: { trames: any[] }) => o.trames.some(f => f.t === 'chat')

describe('MJS-WS — except en multi-processus : seule la connexion visée est exclue', () => {
  for (const voie of ['broadcast', 'room.send'] as const) {
    it(`${voie} { except: client } : l'onglet du même compte sur l'autre processus reçoit le message`, async () => {
      const bus = createMemoryAdapterBus()
      const p1  = await processus(bus)
      const p2  = await processus(bus)
      try {
        for (const p of [p1, p2]) p.app.on('msg', (pl: any, client: any) => {
          if (voie === 'broadcast') p.app.broadcast('chat', pl, { except: client })
          else p.app.room('salle').send('chat', pl, { except: client })
        })
        const emetteur = await onglet(p1.transport, 'U')
        const voisin   = await onglet(p1.transport, 'U')
        const ailleurs = await onglet(p2.transport, 'U')
        const autre    = await onglet(p2.transport, 'V')
        if (voie === 'room.send') for (const o of [emetteur, voisin, ailleurs, autre]) o.ws.send(JSON.stringify({ t: 'µ:join', p: { room: 'salle' } }))
        await tick(30)
        emetteur.ws.send(JSON.stringify({ t: 'msg', p: { texte: 'salut' } }))
        await tick(50)
        assert.equal(recu(emetteur), false, 'la connexion exclue ne reçoit rien')
        assert.equal(recu(voisin), true, 'autre onglet du même compte, même processus')
        assert.equal(recu(ailleurs), true, 'onglet du même compte servi par l’autre processus')
        assert.equal(recu(autre), true, 'autre compte, autre processus')
      } finally {
        await p1.app.stop()
        await p2.app.stop()
      }
    })
  }
})
