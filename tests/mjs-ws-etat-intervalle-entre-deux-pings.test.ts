// état du serveur (src/mjs-ws/stats.ts, stats-page.ts, GET /metrics) — la mesure tirée des µ:ping est
// l'INTERVALLE entre deux pings reçus d'une même connexion (≈ la période du battement client), pas un
// aller-retour : le serveur ne peut pas mesurer l'aller-retour seul (le client ne répond pas à un ping
// du serveur). La métrique et ses libellés le disent : `intervallesPing` dans app.stats() et /stats,
// `mjs_ws_ping_interval_*` dans /metrics, « Intervalle entre deux pings (ms) » sur la page /state.
import assert from 'node:assert/strict'
import { mjsWs, MemoryTransport, toPrometheusText, renderStatsPage } from '../src/mjs-ws/index.js'
import { getMessagesLang, setMessagesLang } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function pingsEspaces(ecartMs: number, nombre: number) {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  await app.listen()
  const ws = transport.connect({ url: 'memory://pings' })
  await new Promise<void>(r => { ws.onopen = () => r() })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await tick(10)
  for (let i = 0; i < nombre; i++) {
    ws.send(JSON.stringify({ t: 'µ:ping', p: { ts: Date.now() } }))
    await tick(ecartMs)
  }
  const snap = app.stats()
  await app.stop()
  return snap
}

describe('mjs-ws — état : intervalle entre deux pings (pas une latence)', () => {
  it('app.stats() expose intervallesPing, plus de famille « latences »', async () => {
    const snap: any = await pingsEspaces(150, 4)
    assert.equal('latences' in snap, false, 'la famille « latences » prétendait mesurer un aller-retour')
    assert.ok(snap.intervallesPing, 'famille intervallesPing présente')
    assert.equal(snap.intervallesPing.echantillon, 3, '4 pings → 3 intervalles')
    assert.ok(snap.intervallesPing.p50 >= 120, `l'intervalle mesuré suit l'écart entre pings (p50 = ${snap.intervallesPing.p50} ms)`)
  })

  it('GET /metrics : mjs_ws_ping_interval_p50_ms / p95 / samples', async () => {
    const snap  = await pingsEspaces(60, 3)
    const texte = toPrometheusText(snap)
    assert.match(texte, /^mjs_ws_ping_interval_p50_ms \d+$/m)
    assert.match(texte, /^mjs_ws_ping_interval_p95_ms \d+$/m)
    assert.match(texte, /^mjs_ws_ping_interval_samples 2$/m)
    assert.doesNotMatch(texte, /mjs_ws_ping_p50_ms|mjs_ws_ping_p95_ms|mjs_ws_ping_samples/)
  })

  it('page /state : le libellé dit « intervalle entre deux pings », en français et en anglais, et lit intervallesPing', async () => {
    const snap  = await pingsEspaces(30, 2)
    const avant = getMessagesLang()
    try {
      setMessagesLang('fr')
      const fr = renderStatsPage(snap)
      assert.ok(fr.includes('Intervalle entre deux pings (ms)'), 'libellé français')
      assert.ok(!fr.includes('Latences ping'), 'plus de « latences ping »')
      assert.ok(fr.includes('data.intervallesPing'), 'la page lit la famille renommée')
      setMessagesLang('en')
      const en = renderStatsPage(snap)
      assert.ok(en.includes('Interval between two pings (ms)'), 'libellé anglais')
      assert.ok(!en.includes('Ping latency'), 'plus de « ping latency »')
    }
    finally { setMessagesLang(avant) }
  })
})
