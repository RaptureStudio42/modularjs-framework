// transport uWebSockets.js (src/mjs-ws/transport-uws.ts) — une trame plus grande que `limits.maxPayload` compte pour la
// mise au banc, comme sous `ws`. uWS coupe la connexion lui-même, sans trame de fermeture : son rappel `close` reçoit
// 1006, le même code qu'une coupure ordinaire, et seul son texte (« Received too big message ») en dit la cause.
// Transmis tel quel, le cœur n'y voyait qu'une coupure réseau : la récidive n'était jamais mise au banc. À l'inverse,
// une coupure ordinaire (réseau perdu, onglet fermé : 1006 « Received TCP FIN before WebSocket close frame », 1001,
// 1000) ne doit mettre personne au banc.
// (a) faux module uWS (aucun paquet requis) : la traduction du rappel `close`, puis la mise au banc ;
// (b) vrai paquet uWebSockets.js s'il est résolu (même résolution que mjs-ws-transport-uws.test.ts), sinon sauté
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { mjsWs } from '../src/mjs-ws/index.js'
import { UwsTransport } from '../src/mjs-ws/transport-uws.js'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const tick       = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const versTampon = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

// textes du rappel `close` de uWebSockets.js v20.52.0, relevés sur le vrai paquet
const TROP_GRANDE = 'Received too big message'
const FIN_TCP     = 'Received TCP FIN before WebSocket close frame'

// attend qu'une condition tienne (2 s au plus) — la fermeture côté serveur suit celle du client de quelques ms
async function attendre(condition: () => boolean, quoi: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) return
    await tick(10)
  }
  assert.fail(`délai dépassé : ${quoi}`)
}

// faux uWS minimal : la forme consommée par transport-uws.ts ; `couper(code, texte)` joue le rappel `close` natif
// comme uWS après une coupure qu'il a vue lui-même
function fauxUws() {
  let comportement: any = null
  const app: any = {
    ws(_motif: string, c: any) { comportement = c; return app },
    listen(...args: any[]) { const cb = args[args.length - 1]; queueMicrotask(() => cb({ jeton: true })); return app },
  }
  return {
    App() { return app },
    us_listen_socket_close() {},
    connecter(adresse = '127.0.0.1') {
      let ud: any = {}
      const req = { getHeader: () => '', forEach: () => {} }
      const res = { upgrade: (u: any) => { ud = u }, getRemoteAddressAsText: () => versTampon(adresse) }
      comportement.upgrade(res, req, {})
      const recues: string[] = []
      let fermee = false
      const ws: any = {
        send(m: string | Uint8Array) { if (typeof m === 'string') recues.push(JSON.parse(m).t); return 1 },
        getBufferedAmount() { return 0 },
        end(code?: number, raison?: string) {
          if (fermee) return
          fermee = true
          queueMicrotask(() => comportement.close(ws, code ?? 1000, versTampon(raison ?? '')))
        },
        getUserData() { return ud },
      }
      comportement.open(ws)
      return {
        recues,
        recevoir(t: string, p?: unknown) { comportement.message(ws, versTampon(JSON.stringify({ t, p })), false) },
        couper(code: number, texte: string) { fermee = true; comportement.close(ws, code, versTampon(texte)) },
      }
    },
  }
}

describe('mjs-ws — uWS : la coupure pour trame trop grande arrive au cœur en 1009, comme sous ws (faux module)', () => {
  it('rappel close natif 1006 « Received too big message » → 1009 ; toute autre fermeture transmise telle quelle', async () => {
    const uws = fauxUws()
    const t   = new UwsTransport({ uwsModule: uws as any, port: 9999 })
    const vus: Array<[number, string]> = []
    t.onConnection((conn) => { conn.onClose = (code, raison) => vus.push([code, raison]) })
    await t.start()
    try {
      uws.connecter().couper(1006, TROP_GRANDE)
      uws.connecter().couper(1006, FIN_TCP)
      uws.connecter().couper(1006, '')
      uws.connecter().couper(1001, '')
      uws.connecter().couper(1000, TROP_GRANDE)
      assert.deepEqual(vus, [[1009, TROP_GRANDE], [1006, FIN_TCP], [1006, ''], [1001, ''], [1000, TROP_GRANDE]])
    }
    finally { await t.stop() }
  })

  it('trois coupures pour trame trop grande → mise au banc, la 4e connexion refusée au hello', async () => {
    const uws = fauxUws()
    const app = mjsWs({ transport: new UwsTransport({ uwsModule: uws as any, port: 9999 }), heartbeat: 0, onLog: () => {} })
    await app.listen()
    try {
      for (let i = 0; i < 3; i++) {
        const c = uws.connecter()
        c.recevoir('µ:hello', { protocol: 1 })
        await tick(5)
        assert.ok(c.recues.includes('µ:welcome'), `connexion ${i + 1} accueillie`)
        c.couper(1006, TROP_GRANDE)
        await tick(5)
      }
      assert.equal(app.stats().garde.misesAuBanc, 1)
      const quatrieme = uws.connecter()
      quatrieme.recevoir('µ:hello', { protocol: 1 })
      await tick(10)
      assert.deepEqual(quatrieme.recues, ['µ:denied'])
    }
    finally { await app.stop() }
  })

  it('coupures ordinaires (1006 fin TCP, 1006 sans texte, 1001, 1000), six de suite → personne au banc, la suivante accueillie', async () => {
    const uws = fauxUws()
    const app = mjsWs({ transport: new UwsTransport({ uwsModule: uws as any, port: 9999 }), heartbeat: 0, onLog: () => {} })
    await app.listen()
    try {
      for (const [code, texte] of [[1006, FIN_TCP], [1006, ''], [1001, ''], [1000, ''], [1006, FIN_TCP], [1006, '']] as Array<[number, string]>) {
        const c = uws.connecter()
        c.recevoir('µ:hello', { protocol: 1 })
        await tick(5)
        c.couper(code, texte)
        await tick(5)
      }
      assert.equal(app.stats().garde.misesAuBanc, 0)
      const suivante = uws.connecter()
      suivante.recevoir('µ:hello', { protocol: 1 })
      await tick(10)
      assert.deepEqual(suivante.recues, ['µ:welcome'])
    }
    finally { await app.stop() }
  })
})

// --- (b) vrai paquet uWebSockets.js, s'il est résolu ---

// point d'entrée du paquet tel que l'import du transport le trouve (même dossier de départ), null s'il manque
function resolveUwsEntry(): string | null {
  try { return createRequire(join(__dirname, '../src/mjs-ws/transport-uws.ts')).resolve('uWebSockets.js') }
  catch { return null }
}
const UWS_RESOLVED   = resolveUwsEntry()
const UWS_DIR        = process.env.MJS_UWS_PATH ?? (UWS_RESOLVED ? dirname(UWS_RESOLVED) : join(__dirname, '../node_modules/uWebSockets.js'))
const REAL_UWS_ENTRY = join(UWS_DIR, 'ESM_wrapper.mjs')

// une vraie connexion : hello, puis `geste` à l'accueil ; rend le code de fermeture vu du client et si elle a été accueillie
async function connexion(port: number, geste: (ws: any) => void): Promise<{ code: number, accueillie: boolean }> {
  const { default: WebSocket } = await import('ws')
  return new Promise((res) => {
    const ws: any = new WebSocket(`ws://127.0.0.1:${port}/`, { perMessageDeflate: false })
    let accueillie = false
    ws.on('message', (d: any) => { if (JSON.parse(String(d)).t === 'µ:welcome') { accueillie = true; geste(ws) } })
    ws.once('open', () => ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } })))
    ws.once('close', (code: number) => res({ code, accueillie }))
    ws.on('error', () => {})
  })
}

describe('mjs-ws — uWS : trame trop grande et mise au banc (vrai paquet uWebSockets.js, si présent)', function () {
  this.timeout(15000)

  // serveur sur un port éphémère, borne de trame à 1000 octets
  async function serveur(realModule: any): Promise<{ app: any, port: number }> {
    const transport = new UwsTransport({ uwsModule: realModule, port: 0, host: '127.0.0.1', maxPayload: 1000 })
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { maxPayload: 1000 } })
    await app.listen()
    return { app, port: realModule.us_socket_local_port((transport as any)._listenToken) }
  }

  it('trames trop grandes, trois fois (texte, binaire, message fragmenté) → mise au banc, la 4e connexion refusée (4001)', async function () {
    if (!existsSync(REAL_UWS_ENTRY)) {
      console.log(`    (uWebSockets.js introuvable (${REAL_UWS_ENTRY}) — SAUTÉ, attendu hors de cette machine)`)
      this.skip()
      return
    }
    const { app, port } = await serveur(await import(pathToFileURL(REAL_UWS_ENTRY).href))
    try {
      const gestes: Array<(ws: any) => void> = [
        (ws) => ws.send('x'.repeat(1500)),
        (ws) => ws.send(Buffer.alloc(1500), { binary: true }),
        (ws) => { ws.send('x'.repeat(600), { fin: false }); ws.send('x'.repeat(600), { fin: false }); ws.send('x'.repeat(600), { fin: true }) },
      ]
      for (const [i, geste] of gestes.entries()) {
        const r = await connexion(port, geste)
        assert.equal(r.accueillie, true, `connexion ${i + 1} accueillie`)
        await attendre(() => app.stats().connexions.fermees >= i + 1, `fermeture ${i + 1} vue du serveur`)
      }
      assert.equal(app.stats().garde.misesAuBanc, 1)
      assert.deepEqual(await connexion(port, (ws) => ws.close(1000)), { code: 4001, accueillie: false })
    }
    finally { await app.stop() }
  })

  it('coupures ordinaires de suite (socket détruite, fin TCP, onglet fermé 1001, fermeture 1000) → personne au banc, la suivante accueillie', async function () {
    if (!existsSync(REAL_UWS_ENTRY)) {
      console.log(`    (uWebSockets.js introuvable (${REAL_UWS_ENTRY}) — SAUTÉ, attendu hors de cette machine)`)
      this.skip()
      return
    }
    const { app, port } = await serveur(await import(pathToFileURL(REAL_UWS_ENTRY).href))
    try {
      const gestes: Array<(ws: any) => void> = [
        (ws) => ws.terminate(),
        (ws) => ws._socket.end(),
        (ws) => ws.close(1001),
        (ws) => ws.close(1000),
        (ws) => ws.terminate(),
        (ws) => ws._socket.end(),
      ]
      for (const [i, geste] of gestes.entries()) {
        await connexion(port, geste)
        await attendre(() => app.stats().connexions.fermees >= i + 1, `fermeture ${i + 1} vue du serveur`)
      }
      assert.equal(app.stats().garde.misesAuBanc, 0)
      assert.deepEqual(await connexion(port, (ws) => ws.close(1000)), { code: 1000, accueillie: true })
    }
    finally { await app.stop() }
  })
})
