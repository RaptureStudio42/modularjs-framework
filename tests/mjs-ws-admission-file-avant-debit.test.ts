// core.ts — les trames entrantes doivent être admises (plafond + débit) à la RÉCEPTION, pas
// seulement à la consommation par la FIFO : une étape lente en tête (auth() async) ne doit jamais
// laisser un flot de trames s'empiler sans borne avant que le débit n'ait la moindre chance de jouer.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ...opts })
  await app.listen()
  return { transport, app }
}

async function rawConnect(transport: MemoryTransport, url: string): Promise<any> {
  const ws = transport.connect({ url })
  await new Promise<void>(r => { ws.onopen = () => r() })
  return ws
}

describe('MJS-WS — core.ts, admission des trames À LA RÉCEPTION (pas seulement à la consommation)', () => {
  it('200 trames envoyées pendant un hello (auth async) en vol : le débit joue tout de suite, pas après coup', async () => {
    let resolveAuth!: (v: unknown) => void
    const authGate = new Promise(r => { resolveAuth = r })
    const { transport, app } = await startApp({
      onLog: () => {},   // kick INTENTIONNEL
      auth: async () => { await authGate; return { id: 1 } },
      limits: { rate: 0, burst: 2, kickAfter: 3, maxPayload: 65536, maxBuffered: 1048576, maxConnections: null, maxConnectionsPerIp: null, maxRoomsPerClient: null },
    })
    const s = await rawConnect(transport, 'memory://admission')
    s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))   // reste en vol — auth() ne résout jamais tout seul
    await tick(10)

    for (let i = 0; i < 200; i++) s.send(JSON.stringify({ t: 'bruit', p: { i } }))
    await tick(30)

    // le débit (burst:2, rate:0) a DÉJÀ dû jouer — kick avant même que l'auth ne résolve, pas 200
    // trames retenues en silence en attendant
    const mid = app.stats()
    assert.ok(mid.garde.kicksDebit > 0, 'le débit a agi À LA RÉCEPTION, avant même la résolution de auth()')

    resolveAuth({})
    await tick(30)
    s.close(); await app.stop()
  })

  it('plafond de file : un flot qui reste SOUS le seau à jetons (rate>0) mais dépasse le plafond de file est quand même borné', async () => {
    let resolveAuth!: (v: unknown) => void
    const authGate = new Promise(r => { resolveAuth = r })
    const { transport, app } = await startApp({
      onLog: () => {},   // kick INTENTIONNEL
      auth: async () => { await authGate; return { id: 1 } },
      // rate/burst TRÈS généreux — le seau à jetons seul ne kickerait jamais sur ce volume, mais le
      // plafond de file, lui, doit borner la mémoire quand même
      limits: { rate: 100000, burst: 100000, kickAfter: 1000000, maxPayload: 65536, maxBuffered: 1048576, maxConnections: null, maxConnectionsPerIp: null, maxRoomsPerClient: null },
    })
    const s = await rawConnect(transport, 'memory://admission-file')
    s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await tick(10)

    for (let i = 0; i < 5000; i++) s.send(JSON.stringify({ t: 'bruit', p: { i } }))
    await tick(30)

    const mid = app.stats()
    // aucune trame « bruit » n'a pu être routée (auth toujours en vol) — mais le serveur n'a PAS
    // gardé les 5000 en attente indéfiniment : le plafond de file a fini par kicker
    assert.ok(mid.garde.kicksDebit > 0, 'plafond de file atteint malgré un débit qui, seul, aurait tout laissé passer')

    resolveAuth({})
    await tick(30)
    s.close(); await app.stop()
  })

  // plafond de file réglable (`limits.maxQueued`, défaut 200) : relevé, un flot plus long passe ;
  // abaissé, la coupure vient plus tôt ; `null` = illimité (opt-in explicite, comme les autres plafonds)
  async function flotDerriereAuthBloquee(maxQueued: number | null | undefined, nombre: number): Promise<number> {
    let resolveAuth!: (v: unknown) => void
    const authGate = new Promise(r => { resolveAuth = r })
    const limits: any = { rate: 100000, burst: 100000, kickAfter: 1000000, maxPayload: 65536, maxBuffered: 1048576, maxConnections: null, maxConnectionsPerIp: null, maxRoomsPerClient: null }
    if (maxQueued !== undefined) limits.maxQueued = maxQueued
    const { transport, app } = await startApp({ onLog: () => {}, auth: async () => { await authGate; return { id: 1 } }, limits })
    const s = await rawConnect(transport, 'memory://admission-reglable')
    s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await tick(10)
    for (let i = 0; i < nombre; i++) s.send(JSON.stringify({ t: 'bruit', p: { i } }))
    await tick(30)
    const kicks = app.stats().garde.kicksDebit
    resolveAuth({})
    await tick(30)
    s.close(); await app.stop()
    return kicks
  }

  it('limits.maxQueued relevé à 10 000 : 5 000 trames en attente passent sans coupure', async () => {
    assert.equal(await flotDerriereAuthBloquee(10000, 5000), 0)
  })

  it('limits.maxQueued abaissé à 50 : 100 trames en attente coupent la connexion', async () => {
    assert.ok(await flotDerriereAuthBloquee(50, 100) > 0)
  })

  it('limits.maxQueued: null = illimité ; absent = 200 par défaut', async () => {
    assert.equal(await flotDerriereAuthBloquee(null, 5000), 0)
    assert.ok(await flotDerriereAuthBloquee(undefined, 300) > 0, 'défaut 200 : 300 trames en attente coupent')
    assert.equal(await flotDerriereAuthBloquee(undefined, 150), 0, 'défaut 200 : 150 trames passent')
  })
})
