// mjsWs() — les réglages numériques (`limits.*`, `heartbeat`, `token`, `resume`, `antiEntropy`) sont
// vérifiés À LA CONSTRUCTION, comme `ban` et `limits.rateBy` : NaN (variable d'environnement absente
// passée à Number()), négatif ou mauvais type lèvent tout de suite, en clair ; `undefined` vaut le
// défaut. Avant, `rate: NaN` ou `rate: undefined` coupaient le seau à jetons en silence, `maxPayload:
// NaN` supprimait toute borne de taille (le transport `ws` lit NaN comme 0 = illimité), `heartbeat: NaN`
// coupait le chien d'inactivité.
import assert from 'node:assert/strict'
import { mjsWs, MemoryTransport, resolveResumeOptions, resolveAntiEntropyOption, DEFAULT_RESUME } from '../src/mjs-ws/index.js'
import type { MjsWsOptions } from '../src/mjs-ws/index.js'
import { getMessagesLang, setMessagesLang } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const monter = (opts: Record<string, unknown>) => mjsWs({ transport: new MemoryTransport(), onLog: () => {}, ...opts } as MjsWsOptions)

describe('mjsWs() — réglages numériques vérifiés à la construction', () => {
  const refus: Array<[string, Record<string, unknown>, RegExp]> = [
    ['limits.rate NaN', { limits: { rate: NaN } }, /limits\.rate invalide : NaN/],
    ['limits.rate négatif', { limits: { rate: -1 } }, /limits\.rate invalide : -1/],
    ['limits.rate en chaîne', { limits: { rate: '40' } }, /limits\.rate invalide : "40"/],
    ['limits.burst NaN', { limits: { burst: NaN } }, /limits\.burst invalide/],
    ['limits.kickAfter négatif', { limits: { kickAfter: -1 } }, /limits\.kickAfter invalide/],
    ['limits.maxPayload NaN', { limits: { maxPayload: NaN } }, /limits\.maxPayload invalide : NaN/],
    ['limits.maxPayload 0 (illimité pour le transport ws)', { limits: { maxPayload: 0 } }, /limits\.maxPayload invalide : 0/],
    ['limits.maxPayload non entier', { limits: { maxPayload: 10.5 } }, /limits\.maxPayload invalide/],
    ['limits.maxBuffered NaN', { limits: { maxBuffered: NaN } }, /limits\.maxBuffered invalide/],
    ['limits.maxConnections NaN', { limits: { maxConnections: NaN } }, /limits\.maxConnections invalide/],
    ['limits.maxConnectionsPerIp négatif', { limits: { maxConnectionsPerIp: -5 } }, /limits\.maxConnectionsPerIp invalide/],
    ['limits.maxRoomsPerClient en chaîne', { limits: { maxRoomsPerClient: 'x' } }, /limits\.maxRoomsPerClient invalide/],
    ['limits.maxPresencePerClient NaN', { limits: { maxPresencePerClient: NaN } }, /limits\.maxPresencePerClient invalide/],
    ['limits.maxQueued infini', { limits: { maxQueued: Infinity } }, /limits\.maxQueued invalide : Infinity/],
    ['limits.rate null (pas un plafond)', { limits: { rate: null } }, /limits\.rate invalide : null/],
    ['limits en nombre', { limits: 5 }, /limits invalide : 5/],
    ['limits en tableau', { limits: [] }, /limits invalide/],
    ['heartbeat NaN', { heartbeat: NaN }, /heartbeat invalide : NaN/],
    ['heartbeat négatif', { heartbeat: -1 }, /heartbeat invalide/],
    ['heartbeat en chaîne', { heartbeat: '15000' }, /heartbeat invalide/],
    ['token.sweep NaN', { token: { sweep: NaN } }, /token\.sweep invalide/],
    ['token.sweep 0', { token: { sweep: 0 } }, /token\.sweep invalide/],
    ['token.slack négatif', { token: { slack: -1 } }, /token\.slack invalide/],
    ['token en chaîne', { token: 'x' }, /token invalide/],
    ['resume.grace NaN', { resume: { grace: NaN } }, /resume\.grace invalide/],
    ['resume.maxBuffered NaN', { resume: { maxBuffered: NaN } }, /resume\.maxBuffered invalide/],
    ['resume.maxBytes négatif', { resume: { maxBytes: -1 } }, /resume\.maxBytes invalide/],
    ['resume en chaîne', { resume: 'oui' }, /resume invalide/],
    ['antiEntropy NaN', { antiEntropy: NaN }, /antiEntropy invalide : NaN/],
    ['antiEntropy 0', { antiEntropy: 0 }, /antiEntropy invalide/],
    ['antiEntropy true', { antiEntropy: true }, /antiEntropy invalide/],
  ]
  for (const [nom, opts, motif] of refus) {
    it(`${nom} → erreur claire`, () => {
      assert.throws(() => monter(opts), motif)
    })
  }

  it('anti-entropie déclarée dans opts.adapter : même contrôle', () => {
    assert.throws(() => resolveAntiEntropyOption(undefined, { redis: 'redis://127.0.0.1:6379', antiEntropy: NaN }), /adapter\.antiEntropy invalide : NaN/)
    assert.equal(resolveAntiEntropyOption(undefined, { redis: 'redis://127.0.0.1:6379', antiEntropy: false }), false)
    assert.equal(resolveAntiEntropyOption(undefined, { redis: 'redis://127.0.0.1:6379', antiEntropy: 5000 }), 5000)
  })

  it('les valeurs limites qui ont un sens restent acceptées', () => {
    assert.doesNotThrow(() => monter({
      heartbeat: 0,
      limits: { rate: 0, burst: 1, kickAfter: 0, maxConnections: null, maxConnectionsPerIp: null, maxRoomsPerClient: 0, maxPresencePerClient: null, maxQueued: null },
      token: { sweep: 1, slack: 0 },
      antiEntropy: false,
    }))
    assert.doesNotThrow(() => monter({ limits: { rate: 0.001, maxPayload: 1, maxBuffered: 1 }, resume: { grace: 0, maxBuffered: 0, maxBytes: 0 } }))
    assert.doesNotThrow(() => monter({ resume: true, limits: null, token: null, heartbeat: null }))
  })

  it('undefined vaut le défaut : resolveResumeOptions', () => {
    assert.deepEqual(resolveResumeOptions({ grace: undefined, maxBuffered: 20 }), { ...DEFAULT_RESUME, maxBuffered: 20 })
  })

  it('limits.rate: undefined → le seau par défaut joue toujours (rafale de 200 trames : pas toutes traitées)', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: undefined, burst: undefined } })
    let traitees    = 0
    app.on('bruit', () => { traitees++ })
    await app.listen()
    try {
      const ws = transport.connect({ url: 'memory://rafale' })
      await new Promise<void>(r => { ws.onopen = () => r() })
      ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      await tick(10)
      for (let i = 0; i < 200; i++) ws.send(JSON.stringify({ t: 'bruit', p: { i } }))
      await tick(30)
      assert.ok(traitees < 200, `le débit par défaut doit jouer (traitées : ${traitees} / 200)`)
    }
    finally { await app.stop() }
  })

  it('limits.maxPayload: undefined → la borne par défaut (64 Ko) joue toujours', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { maxPayload: undefined } })
    await app.listen()
    try {
      const ws = transport.connect({ url: 'memory://charge' })
      let fermeture: number | null = null
      ws.onclose = (ev: any) => { fermeture = ev.code }
      await new Promise<void>(r => { ws.onopen = () => r() })
      ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      await tick(10)
      ws.send(JSON.stringify({ t: 'gros', p: 'x'.repeat(200 * 1024) }))
      await tick(20)
      assert.equal(fermeture, 1009, 'trame de 200 Ko refusée')
    }
    finally { await app.stop() }
  })

  it('le message existe aussi en anglais', () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try { assert.throws(() => monter({ limits: { rate: NaN } }), /invalid limits\.rate: NaN — expected: a finite number ≥ 0/) }
    finally { setMessagesLang(avant) }
  })
})
