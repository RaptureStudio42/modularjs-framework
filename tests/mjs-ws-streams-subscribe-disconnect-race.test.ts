// streams.ts — un client déconnecté PENDANT la garde d'abonnement asynchrone (canSubscribe) ne doit
// JAMAIS être réabonné après coup : même correctif que rooms.ts (hooks.isAlive), cf. son commentaire.
import assert from 'node:assert/strict'
import { createStreamsEngine } from '../src/mjs-ws/streams.js'
import type { MjsWsClient } from '../src/mjs-ws/core.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function fakeClient(id: string): MjsWsClient {
  return { id, identity: undefined, latency: null, meta: {} as any, send() {}, close() {} }
}

describe('MJS-WS — streams.ts, garde async de flux face à une déconnexion pendant l\'attente', () => {
  it('µ:sub-stream : client déconnecté pendant la garde canSubscribe async → jamais réabonné', async () => {
    const sent: any[] = []
    let resolveGate!: (v: boolean) => void
    const gate = new Promise<boolean>(r => { resolveGate = r })
    let alive = true
    const engine = createStreamsEngine((_c, f) => sent.push(f), () => {}, undefined, undefined, undefined, undefined, (_client) => alive)
    engine.stream('s1', { canSubscribe: () => gate })
    const c1 = fakeClient('c1')

    engine.handleSubStream(c1, 's1')   // garde ASYNC en vol
    alive = false                       // simule onDisconnect côté core.ts (client déjà purgé)
    resolveGate(true)                   // la garde finit par répondre « oui »
    await tick(10)

    assert.equal(sent.length, 0, 'aucune trame envoyée au client déconnecté — il n\'a pas été réabonné')
  })

  it('µ:resync : même garde côté resync — déconnecté pendant l\'attente, jamais rejoué', async () => {
    const sent: any[] = []
    let resolveGate!: (v: boolean) => void
    const gate = new Promise<boolean>(r => { resolveGate = r })
    let alive = true
    const engine = createStreamsEngine((_c, f) => sent.push(f), () => {}, undefined, undefined, undefined, undefined, (_client) => alive)
    const h = engine.stream('s1', { canSubscribe: () => gate })
    h.add('k', 'v')
    const c1 = fakeClient('c1')

    engine.handleResync(c1, 's1', 0)
    alive = false
    resolveGate(true)
    await tick(10)

    assert.equal(sent.length, 0, 'aucun rejeu/reset envoyé au client déconnecté')
  })

  it('client toujours vivant à la résolution : abonnement accordé normalement', async () => {
    const sent: any[] = []
    let resolveGate!: (v: boolean) => void
    const gate = new Promise<boolean>(r => { resolveGate = r })
    const engine = createStreamsEngine((_c, f) => sent.push(f), () => {}, undefined, undefined, undefined, undefined, () => true)
    engine.stream('s1', { canSubscribe: () => gate })
    const c1 = fakeClient('c1')

    engine.handleSubStream(c1, 's1')
    resolveGate(true)
    await tick(10)

    assert.ok(sent.length > 0, 'client vivant → abonnement accordé (reset envoyé) comme avant')
  })
})
