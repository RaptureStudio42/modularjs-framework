// pont universel (src/mjs-ws/bridge.ts) — `except` d'un `/broadcast` ou d'un `/room/send` accepte l'id d'un compte :
// toutes ses connexions sont exclues. En multi-processus, seuls ses onglets servis par le processus qui reçoit la
// requête l'étaient ; ceux des autres processus recevaient le message
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-pont-except-1234567890'
const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function processus(bus: ReturnType<typeof createMemoryAdapterBus>, pont: boolean): Promise<{ transport: MemoryTransport; app: MjsWsApp; port: number }> {
  const transport = new MemoryTransport()
  let port        = 0
  const app       = mjsWs({
    transport, heartbeat: 0, adapter: new MemoryAdapter({ bus }), auth: (hello: any) => hello.auth,
    bridge: pont ? { port: 0, secret: SECRET } : undefined,
    onLog: (_niveau, message, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute|universal bridge listening/.test(message)) port = meta.port },
  })
  await app.listen()
  return { transport, app, port }
}

async function onglet(transport: MemoryTransport, id: string): Promise<{ ws: any; trames: any[] }> {
  const ws            = transport.connect({ url: 'memory://except' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id } } }))
  await tick(10)
  return { ws, trames }
}

async function poster(port: number, chemin: string, corps: unknown): Promise<number> {
  const texte = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const sig   = createHmac('sha256', SECRET).update(['in', String(ts), 'POST', chemin, texte, nonce].map(f => f.length +':'+ f).join('')).digest('hex')
  const res   = await fetch('http://127.0.0.1:'+ port + chemin, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': sig }, body: texte })
  await res.text()
  return res.status
}

const recu = (o: { trames: any[] }) => o.trames.some(f => f.t === 'chat')

describe('MJS-WS — pont universel : except par compte sur tous les processus', function () {
  this.timeout(20000)

  for (const voie of ['/broadcast', '/room/send'] as const) {
    it(`${voie} { except: compte } : ses onglets des deux processus sont exclus, les autres reçoivent`, async () => {
      const bus = createMemoryAdapterBus()
      const a   = await processus(bus, true)
      const b   = await processus(bus, false)
      try {
        const ici     = await onglet(a.transport, 'U')
        const ailleurs = await onglet(b.transport, 'U')
        const autre   = await onglet(b.transport, 'V')
        if (voie === '/room/send') for (const o of [ici, ailleurs, autre]) o.ws.send(JSON.stringify({ t: 'µ:join', p: { room: 'salle' } }))
        await tick(30)
        const corps = voie === '/broadcast' ? { type: 'chat', p: {}, except: 'U' } : { room: 'salle', type: 'chat', p: {}, except: 'U' }
        assert.equal(await poster(a.port, voie, corps), 200)
        await tick(50)
        assert.equal(recu(ici), false, 'onglet du compte exclu, processus du pont')
        assert.equal(recu(ailleurs), false, 'onglet du compte exclu, autre processus')
        assert.equal(recu(autre), true, 'autre compte')
      }
      finally {
        await a.app.stop()
        await b.app.stop()
      }
    })
  }
})
