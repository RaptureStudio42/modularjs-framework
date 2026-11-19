// L'API de MJS-WS parle anglais : l'instantané app.stats() (son JSON, sa page /state, son registre), les compteurs
// lus sur un adaptateur, les paquets `{ name, install }` (definePackage, app.use). Les anciens noms français
// n'existent plus : aucun ne reste lisible, et un paquet écrit avec eux ne s'installe pas
import assert from 'node:assert/strict'
import { mjsWs, definePackage, echoPackage, createStatsRegistry, renderStatsPage, toPrometheusText, MemoryAdapter, createMemoryAdapterBus, RedisAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'
import type { MjsWsApp, MjsWsOptions, MjsPackage } from '../src/mjs-ws/index.js'

// les noms français que portait l'instantané : aucun ne doit plus y paraître, à aucune profondeur
const FRENCH = [
  'horodatage', 'memoire', 'connexions', 'garde', 'salons', 'flux', 'pont', 'adaptateur', 'intervallesPing', 'erreurs', 'fluxCompteurs',
  'actives', 'parquees', 'accueillies', 'refusees', 'fermees', 'refuseesPlafond', 'refuseesOrigine', 'refuseesBan',
  'recus', 'envoyes', 'tamponnes', 'rejoues', 'rejetes', 'binaireRecues', 'binaireIgnorees', 'texteRejete',
  'kicksDebit', 'kicksEngorgement', 'kicksChargeUtile', 'expirationsJeton', 'misesAuBanc',
  'nombre', 'membresTotal', 'abonnesPresence', 'deltasEmis', 'resyncsRejeu',
  'requetesParEndpoint', 'webhooksEnvoyes', 'webhooksEchoues', 'webhooksAbandonnes',
  'publies', 'ignoresOrigin', 'reordonnances', 'reconnexions', 'emises', 'reprises', 'expirees', 'debordees', 'avertissements', 'echantillon'
]

function keysDeep(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (value && typeof value === 'object') for (const k of Object.keys(value)) { out.add(k); keysDeep((value as Record<string, unknown>)[k], out) }
  return out
}

async function startApp(opts: MjsWsOptions = {}): Promise<MjsWsApp> {
  const app = mjsWs({ transport: new MemoryTransport(), heartbeat: 0, ...opts })
  await app.listen()
  return app
}

describe('MJS-WS : l\'état du serveur et les paquets portent des noms anglais', () => {
  it('app.stats() : familles et compteurs en anglais, aucun nom français, ni dans l\'objet ni dans son JSON', async () => {
    const app = await startApp()
    try {
      const snap = app.stats() as unknown as Record<string, Record<string, unknown>>
      assert.deepEqual(Object.keys(snap).sort(), ['adapter', 'bridge', 'connections', 'errors', 'guard', 'memory', 'messages', 'pingIntervals', 'processId', 'rooms', 'sessions', 'streams', 'timestamp', 'uptime'])
      assert.deepEqual(Object.keys(snap.connections).sort(), ['active', 'closed', 'parked', 'refused', 'refusedBan', 'refusedCap', 'refusedOrigin', 'welcomed'])
      assert.deepEqual(Object.keys(snap.messages).sort(), ['binaryIgnored', 'binaryReceived', 'buffered', 'dropped', 'received', 'replayed', 'sent', 'textRejected'])
      assert.deepEqual(Object.keys(snap.guard).sort(), ['bans', 'kicksBackpressure', 'kicksPayload', 'kicksRate', 'kicksSilence', 'tokenExpired'])
      assert.deepEqual(Object.keys(snap.rooms).sort(), ['count', 'membersTotal', 'presenceSubscribers'])
      assert.deepEqual(Object.keys(snap.streams).sort(), ['count', 'deltasEmitted', 'resyncsReplay', 'resyncsReset'])
      assert.deepEqual(Object.keys(snap.bridge).sort(), ['http401', 'rateLimited', 'requestsByEndpoint', 'webhooksAbandoned', 'webhooksFailed', 'webhooksSent'])
      assert.deepEqual(Object.keys(snap.adapter).sort(), ['ignoredOrigin', 'published', 'received', 'reconnects', 'reordered'])
      assert.deepEqual(Object.keys(snap.sessions).sort(), ['expired', 'issued', 'overflowed', 'resumed'])
      assert.deepEqual(Object.keys(snap.errors).sort(), ['errors', 'warnings'])
      assert.deepEqual(Object.keys(snap.pingIntervals).sort(), ['p50', 'p95', 'samples'])
      assert.deepEqual(Object.keys(snap.memory), ['rss'])
      assert.equal(typeof snap.timestamp, 'number')
      assert.deepEqual([...keysDeep(JSON.parse(JSON.stringify(snap)))].filter(k => FRENCH.includes(k)), [], 'le JSON servi par GET /stats ne porte que les noms anglais')
      for (const old of ['connexions', 'garde', 'salons', 'flux', 'pont', 'adaptateur', 'intervallesPing', 'erreurs', 'horodatage', 'memoire']) assert.equal(snap[old], undefined, old +' n\'existe plus')
      assert.equal(snap.connections.actives, undefined, 'aucun accesseur pour un ancien nom')
    }
    finally { await app.stop() }
  })

  it('createStatsRegistry() : registre aux noms anglais (streamCounters, pingIntervals), instantané assemblé avec les jauges rooms/streams', () => {
    const registry = createStatsRegistry()
    registry.guard.bans++
    registry.streamCounters.deltasEmitted += 2
    registry.pingIntervals.push(40)
    const snap = registry.snapshot({ rooms: { count: 3, membersTotal: 5, presenceSubscribers: 1 }, streams: { count: 2 } })
    assert.equal(snap.guard.bans, 1)
    assert.deepEqual(snap.rooms, { count: 3, membersTotal: 5, presenceSubscribers: 1 })
    assert.deepEqual(snap.streams, { count: 2, deltasEmitted: 2, resyncsReplay: 0, resyncsReset: 0 })
    assert.equal(snap.pingIntervals.samples, 1)
    const text = toPrometheusText(snap)
    assert.match(text, /^mjs_ws_guard_bans_total 1$/m, 'les noms Prometheus ne changent pas')
    assert.match(text, /^mjs_ws_streams_deltas_total 2$/m)
    assert.match(text, /^mjs_ws_rooms_total 3$/m)
  })

  it('page /state : son script lit les noms anglais du JSON', () => {
    const html = renderStatsPage(createStatsRegistry().snapshot({ rooms: { count: 0, membersTotal: 0, presenceSubscribers: 0 }, streams: { count: 0 } }))
    for (const key of ['connections', 'rooms', 'streams', 'messages', 'guard', 'bridge', 'adapter', 'sessions']) assert.match(html, new RegExp('\\[\'' + key + '\', '), key)
    assert.match(html, /data\.pingIntervals/)
    assert.match(html, /data\.memory/)
    assert.match(html, /data\.timestamp/)
    assert.doesNotMatch(html, /\['(connexions|salons|flux|garde|pont|adaptateur)', |data\.(intervallesPing|memoire|horodatage)/)
  })

  it('compteurs d\'un adaptateur : `reconnects` et `ignoredOrigin` recopiés dans app.stats().adapter (RedisAdapter les porte)', async () => {
    const adapter = new MemoryAdapter({ bus: createMemoryAdapterBus() })
    Object.defineProperty(adapter, 'reconnects', { get: () => 3 })
    Object.defineProperty(adapter, 'ignoredOrigin', { get: () => 7 })
    const app = await startApp({ adapter })
    try {
      const snap = app.stats()
      assert.equal(snap.adapter.reconnects, 3)
      assert.equal(snap.adapter.ignoredOrigin, 7)
    }
    finally { await app.stop() }
    const redis = new RedisAdapter({ url: 'redis://127.0.0.1:6399' }) as unknown as Record<string, unknown>
    assert.equal(redis.reconnects, 0)
    assert.equal(redis.ignoredOrigin, 0)
    assert.equal(redis.reconnexions, undefined)
    assert.equal(redis.ignoresOrigin, undefined)
  })

  it('definePackage rend `{ name, install }`, qu\'app.use installe', async () => {
    const pkg = definePackage('ping-pong', a => { a.serve('ping', () => 'pong') }) as unknown as Record<string, unknown>
    assert.deepEqual(Object.keys(pkg).sort(), ['install', 'name'])
    assert.equal(pkg.name, 'ping-pong')
    assert.equal((echoPackage() as unknown as Record<string, unknown>).name, 'echo')
    const app = await startApp()
    try {
      let installed = 0
      app.use({ name: 'literal', install: () => { installed++ } })
      app.use({ name: 'literal', install: () => { installed++ } })
      assert.equal(installed, 1, 'un second paquet du même `name` est ignoré')
    }
    finally { await app.stop() }
  })

  it('un paquet écrit avec les anciens noms `{ nom, installer }` ne s\'installe plus : app.use le refuse et dit ce qui manque', async () => {
    const logs: string[] = []
    const app = await startApp({ onLog: (level, message) => { if (level === 'error') logs.push(message) } })
    try {
      let ran = false
      const old = { nom: 'ancien', installer: () => { ran = true } } as unknown as MjsPackage
      assert.throws(() => app.use(old), (e: unknown) => e instanceof TypeError && e.message === t('ws.core.package-incomplete', { missingName: true, missingInstall: true }))
      assert.equal(ran, false)
      assert.equal(logs.length, 0, 'refusé avant toute installation : rien n\'a levé, rien au journal')
    }
    finally { await app.stop() }
  })
})
