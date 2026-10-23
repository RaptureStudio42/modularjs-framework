// Après app.stop(), la minuterie de retentative d'un webhook en échec (2 s puis 10 s) et la requête HTTP encore
// en vol restaient actives : le processus ne pouvait pas sortir avant leur fin. Désormais l'arrêt coupe les deux.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick     = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const timeouts = (): number => (process as any).getActiveResourcesInfo().filter((nom: string) => nom === 'Timeout').length

async function attendre(pred: () => boolean, ms = 4000): Promise<void> {
  const debut = Date.now()
  while (!pred()) {
    if (Date.now() - debut > ms) throw new Error('attente expirée')
    await tick(5)
  }
}

// port libre, plus personne n'y écoute : chaque essai de webhook échoue tout de suite (connexion refusée)
async function portFerme(): Promise<number> {
  const s = createServer()
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>(r => s.close(() => r()))
  return port
}

async function connecter(transport: MemoryTransport): Promise<void> {
  const s: any = transport.connect({})
  const trames: any[] = []
  s.onmessage = (ev: any) => { trames.push(JSON.parse(ev.data)) }
  await tick()
  s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: 'x' } }))
  await attendre(() => trames.some(f => f.t === 'µ:welcome'))
}

describe('MJS-WS — pont : app.stop() coupe les retentatives et les envois de webhooks', function () {
  this.timeout(10000)

  it('back injoignable : la pause avant la retentative ne survit pas à app.stop()', async () => {
    const port = await portFerme()
    const avant = timeouts()
    const transport = new MemoryTransport()
    const app = mjsWs({
      transport, heartbeat: 0, auth: () => ({ id: 'u1' }), onLog: () => {},
      bridge: { port: 0, secret: 'secret-de-test-webhook-arret', rateLimit: false, webhooks: { url: 'http://127.0.0.1:'+ port +'/hook', events: ['connect'] } },
    })
    await app.listen()
    await connecter(transport)
    await attendre(() => app.stats().pont.webhooksEchoues >= 1)
    await app.stop()
    assert.equal(timeouts(), avant, 'une minuterie du pont est restée vivante après app.stop()')
  })

  it('back qui ne répond jamais : la requête en vol est interrompue par app.stop()', async () => {
    let ferme = false
    let recu = false
    const back: Server = createServer(() => { recu = true })   // ne répond jamais
    back.on('connection', (sock: Socket) => { sock.on('close', () => { ferme = true }) })
    await new Promise<void>(r => back.listen(0, '127.0.0.1', () => r()))
    const port = (back.address() as AddressInfo).port
    const transport = new MemoryTransport()
    const app = mjsWs({
      transport, heartbeat: 0, auth: () => ({ id: 'u1' }), onLog: () => {},
      bridge: { port: 0, secret: 'secret-de-test-webhook-arret', rateLimit: false, webhooks: { url: 'http://127.0.0.1:'+ port +'/hook', events: ['connect'], timeoutMs: 30000 } },
    })
    await app.listen()
    try {
      await connecter(transport)
      await attendre(() => recu)
      await app.stop()
      await attendre(() => ferme, 1000).catch(() => {})
      assert.equal(ferme, true, 'la requête du webhook est restée ouverte après app.stop()')
    } finally {
      back.closeAllConnections()
      await new Promise<void>(r => back.close(() => r()))
    }
  })
})
