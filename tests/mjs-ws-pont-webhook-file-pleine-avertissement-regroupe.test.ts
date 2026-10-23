// Quand le back des webhooks est en panne, la file (1000) se remplit, puis CHAQUE message client d'un type suivi
// écrivait une ligne d'avertissement (496 lignes pour 1500 messages). Désormais : une ligne au premier webhook
// perdu, puis au plus une par minute avec le compte des perdus depuis, et le reste du compte à l'arrêt.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(pred: () => boolean, ms = 4000): Promise<void> {
  const debut = Date.now()
  while (!pred()) {
    if (Date.now() - debut > ms) throw new Error('attente expirée')
    await tick(5)
  }
}

async function portFerme(): Promise<number> {
  const s = createServer()
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>(r => s.close(() => r()))
  return port
}

describe('MJS-WS — pont : file de webhooks pleine, avertissement regroupé', function () {
  this.timeout(15000)

  it('1500 messages suivis, back en panne : une ligne pendant le flot, une ligne de compte à l\'arrêt (495 de plus)', async () => {
    const port = await portFerme()
    const avertissements: Array<{ message: string; meta?: any }> = []
    const transport = new MemoryTransport()
    const app = mjsWs({
      transport, heartbeat: 0, limits: { rate: 1e6, burst: 1e6 } as any,
      onLog: (level, message, meta) => { if (level === 'warn' && /file de webhooks|webhook queue/.test(message)) avertissements.push({ message, meta }) },
      bridge: { port: 0, secret: 'secret-de-test-webhook-file', rateLimit: false, webhooks: { url: 'http://127.0.0.1:'+ port +'/hook', events: ['message:chat'] } },
    })
    app.on('chat', () => {})
    await app.listen()
    const s: any = transport.connect({})
    const trames: any[] = []
    s.onmessage = (ev: any) => { trames.push(JSON.parse(ev.data)) }
    await tick()
    s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await attendre(() => trames.some(f => f.t === 'µ:welcome'))
    // 4 envois en vol (en pause avant leur retentative), 1000 en file, 496 perdus
    for (let i = 0; i < 1500; i += 100) {
      for (let j = i; j < i + 100; j++) s.send(JSON.stringify({ t: 'chat', p: { i: j } }))
      await tick(5)
    }
    await tick(100)
    assert.equal(avertissements.length, 1, 'avertissements pendant le flot : '+ avertissements.length)
    assert.equal(avertissements[0].meta.event, 'message:chat')
    await app.stop()
    assert.equal(avertissements.length, 2, 'la ligne de compte attendue à l\'arrêt : '+ JSON.stringify(avertissements.map(a => a.message)))
    assert.equal(avertissements[1].meta.perdus, 495)
  })
})
