// core.ts — client.send() (l'objet MjsWsClient passé aux handlers) doit respecter le MÊME mode
// binaire strict que app.send() : un type sans schéma déclaré en codec 'binary' est un refus (throw),
// jamais une fuite JSON qui contournerait la garde.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsClient, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ...opts })
  await app.listen()
  return { transport, app }
}

describe('MJS-WS — core.ts, client.send() respecte le codec binaire strict comme app.send()', () => {
  it('codec:binary, type sans schéma : app.send() ET client.send() lèvent tous les deux', async () => {
    let serverClient: MjsWsClient | null = null
    const { transport, app } = await startApp({ codec: 'binary', welcome: (c) => { serverClient = c; return {} } })
    const ws = transport.connect({ url: 'memory://b12' })
    await new Promise<void>(r => { ws.onopen = () => r() })
    ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await tick()
    assert.ok(serverClient, 'welcome() a bien capturé le client serveur')

    assert.throws(() => app.send(serverClient!, 'chat:sansschema', { x: 1 }), 'app.send refuse un type sans schéma en codec strict')
    assert.throws(() => serverClient!.send('chat:sansschema', { x: 1 }), 'client.send doit refuser EXACTEMENT comme app.send — même client, même type, même codec')

    ws.close(); await app.stop()
  })

  it('codec:auto (défaut) : client.send() reste inchangé — aucun refus pour un type sans schéma', async () => {
    let serverClient: MjsWsClient | null = null
    const { transport, app } = await startApp({ welcome: (c) => { serverClient = c; return {} } })
    const ws = transport.connect({ url: 'memory://b12-auto' })
    await new Promise<void>(r => { ws.onopen = () => r() })
    ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await tick()

    assert.doesNotThrow(() => serverClient!.send('chat:sansschema', { x: 1 }), 'codec auto — comportement historique inchangé')
    ws.close(); await app.stop()
  })
})
