// transport uWebSockets.js (src/mjs-ws/transport-uws.ts) — deux écarts avec le transport `ws` :
// (1) un client lent : uWS abandonne lui-même les trames au-delà de sa propre borne d'attente
//     (`maxBackpressure`, 64 Ko par défaut côté uWS) ; sans réglage ni compte, ces trames disparaissaient
//     en silence et le client n'était jamais expulsé. La borne est désormais `limits.maxBuffered`, et une
//     trame abandonnée (retour 2 de `ws.send`) compte comme rejetée, jusqu'à l'expulsion pour engorgement ;
// (2) l'adresse d'un visiteur IPv4 arrive sous sa forme IPv6 longue (`0000:…:ffff:7f00:0001`) :
//     `meta.address` doit valoir `127.0.0.1`, comme sous `ws`.
import assert from 'node:assert/strict'
import { mjsWs, resolveTransport, DEFAULT_LIMITS } from '../src/mjs-ws/index.js'
import { UwsTransport } from '../src/mjs-ws/transport-uws.js'
import { normalizeRemoteAddress } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const versTampon = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

// faux uWS minimal : la forme consommée par transport-uws.ts, et un bout serveur dont on règle le
// code de retour de send() (1 envoyé, 0 mis en attente, 2 abandonné)
class FauxWs {
  envoyees: string[] = []
  retour   = 1
  ferme    = false
  constructor(private _ud: any, private _behavior: any) {}
  send(m: string | Uint8Array): number {
    if (this.ferme) throw new Error('send() après fermeture')
    if (this.retour !== 2) this.envoyees.push(typeof m === 'string' ? m : '<binaire>')
    return this.retour
  }
  getBufferedAmount(): number { if (this.ferme) throw new Error('getBufferedAmount() après fermeture'); return 0 }
  end(code?: number, raison?: string): void {
    if (this.ferme) return
    this.ferme = true
    queueMicrotask(() => this._behavior.close?.(this, code ?? 1000, versTampon(raison ?? '')))
  }
  getUserData(): any { return this._ud }
  recevoir(t: string, p?: unknown): void { this._behavior.message?.(this, versTampon(JSON.stringify({ t, p })), false) }
}

function fauxUws() {
  let behavior: any = null
  const app: any = {
    ws(_motif: string, b: any) { behavior = b; return app },
    listen(...args: any[]) { const cb = args[args.length - 1]; queueMicrotask(() => cb({ jeton: true })); return app },
  }
  return {
    App() { return app },
    us_listen_socket_close() {},
    behavior(): any { return behavior },
    connecter(adresse = '127.0.0.1'): FauxWs {
      const req = { getHeader: () => '', forEach: () => {} }
      let ud: any = {}
      const res = { upgrade: (u: any) => { ud = u }, getRemoteAddressAsText: () => versTampon(adresse) }
      behavior.upgrade(res, req, {})
      const ws = new FauxWs(ud, behavior)
      behavior.open(ws)
      return ws
    },
  }
}

describe('mjs-ws — uWS : la borne d\'attente vient de limits.maxBuffered', () => {
  it('mjsWs(transport: \'uws\') câble limits.maxBuffered dans maxBackpressure', async () => {
    const uws = fauxUws()
    const t   = resolveTransport('uws', 9999, undefined, { ...DEFAULT_LIMITS, maxBuffered: 4096 }) as UwsTransport
    ;(t as any)._opts.uwsModule = uws
    await t.start()
    try {
      assert.equal(uws.behavior().maxBackpressure, 4096)
    }
    finally { await t.stop() }
  })

  it('transport construit à la main, sans réglage : la même borne par défaut que limits.maxBuffered (1 Mo), pas les 64 Ko de uWS', async () => {
    const uws = fauxUws()
    const t   = new UwsTransport({ uwsModule: uws as any, port: 9999 })
    await t.start()
    try {
      assert.equal(uws.behavior().maxBackpressure, DEFAULT_LIMITS.maxBuffered)
    }
    finally { await t.stop() }
  })
})

describe('mjs-ws — uWS : une trame abandonnée par uWS compte comme rejetée', () => {
  it('trames abandonnées (retour 2) → comptées rejetées, puis expulsion pour engorgement, comme sous ws', async () => {
    const uws = fauxUws()
    let cible: any = null
    const app = mjsWs({ transport: new UwsTransport({ uwsModule: uws as any, port: 9999 }), heartbeat: 0, onLog: () => {}, welcome: (c) => { cible = c; return {} } })
    await app.listen()
    try {
      const ws = uws.connecter()
      ws.recevoir('µ:hello', { protocol: 1 })
      await tick(10)
      assert.ok(cible, 'µ:welcome envoyé')
      ws.retour = 2   // le client ne lit plus : uWS abandonne tout ce qui suit
      for (let i = 0; i < 60; i++) app.send(cible, 'bloc', { i })
      await tick(10)
      const st = app.stats()
      assert.ok(st.messages.rejetes >= 51, `trames abandonnées comptées rejetées (obtenu ${st.messages.rejetes})`)
      assert.equal(st.garde.kicksEngorgement, 1, 'expulsion pour engorgement')
      assert.equal(ws.ferme, true, 'connexion fermée')
    }
    finally { await app.stop() }
  })

  it('trames mises en attente (retour 0) → envoyées, jamais rejetées', async () => {
    const uws = fauxUws()
    let cible: any = null
    const app = mjsWs({ transport: new UwsTransport({ uwsModule: uws as any, port: 9999 }), heartbeat: 0, onLog: () => {}, welcome: (c) => { cible = c; return {} } })
    await app.listen()
    try {
      const ws = uws.connecter()
      ws.recevoir('µ:hello', { protocol: 1 })
      await tick(10)
      ws.retour = 0
      for (let i = 0; i < 60; i++) app.send(cible, 'bloc', { i })
      await tick(10)
      const st = app.stats()
      assert.equal(st.messages.rejetes, 0)
      assert.equal(st.garde.kicksEngorgement, 0)
      assert.equal(ws.ferme, false)
    }
    finally { await app.stop() }
  })

  it('diffusion (fan-out) : même compte des trames abandonnées', async () => {
    const uws = fauxUws()
    const app = mjsWs({ transport: new UwsTransport({ uwsModule: uws as any, port: 9999 }), heartbeat: 0, onLog: () => {} })
    await app.listen()
    try {
      const ws = uws.connecter()
      ws.recevoir('µ:hello', { protocol: 1 })
      await tick(10)
      ws.retour = 2
      for (let i = 0; i < 60; i++) app.broadcast('bloc', { i })
      await tick(10)
      const st = app.stats()
      assert.ok(st.messages.rejetes >= 51, `obtenu ${st.messages.rejetes}`)
      assert.equal(st.garde.kicksEngorgement, 1)
    }
    finally { await app.stop() }
  })
})

describe('mjs-ws — uWS : l\'adresse du visiteur sous la forme du système', () => {
  it('IPv4 en forme IPv6 longue → meta.address = 127.0.0.1 (comme sous ws)', async () => {
    const uws = fauxUws()
    const vues: unknown[] = []
    const app = mjsWs({ transport: new UwsTransport({ uwsModule: uws as any, port: 9999 }), heartbeat: 0, onLog: () => {}, auth: (_h, meta) => { vues.push(meta.address); return {} } })
    await app.listen()
    try {
      uws.connecter('0000:0000:0000:0000:0000:ffff:7f00:0001').recevoir('µ:hello', { protocol: 1 })
      uws.connecter('2001:0db8:0000:0000:0000:0000:0000:0001').recevoir('µ:hello', { protocol: 1 })
      await tick(10)
      assert.deepEqual(vues, ['127.0.0.1', '2001:db8::1'])
    }
    finally { await app.stop() }
  })

  it('normalizeRemoteAddress : forme du système, le reste inchangé', () => {
    assert.equal(normalizeRemoteAddress('0:0:0:0:0:ffff:7f00:1'), '127.0.0.1')
    assert.equal(normalizeRemoteAddress('::FFFF:10.0.0.1'), '10.0.0.1')
    assert.equal(normalizeRemoteAddress('::ffff:10.0.0.1'), '10.0.0.1')
    assert.equal(normalizeRemoteAddress('2001:DB8:0:0:0:0:0:1'), '2001:db8::1')
    assert.equal(normalizeRemoteAddress('::1'), '::1')
    assert.equal(normalizeRemoteAddress('127.0.0.1'), '127.0.0.1')
    assert.equal(normalizeRemoteAddress(undefined), undefined)
    assert.equal(normalizeRemoteAddress('pas une adresse'), 'pas une adresse')
  })
})
