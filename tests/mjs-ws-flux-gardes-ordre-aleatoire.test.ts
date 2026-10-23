// Gardes des flux à l'épreuve de l'ordre : une application complète (salons, flux gardés de sept façons, transport mémoire,
// horloge virtuelle), dix-huit connexions, et des suites d'événements tirés au hasard (graines fixes) — entrées, départs,
// expulsions, demandes, rejeux, réponses des gardes asynchrones dans n'importe quel ordre, deltas, temps qui passe, garde
// posée après coup, destroy() puis redéclaration, coupures suivies d'une reconnexion à l'ordre du client du framework (ses
// salons, puis ses flux). Oracle : le droit réel de la connexion au moment où chaque trame lui arrive, et l'état du client
// du framework (même logique que runtime/mjs_socket.ts) comparé au serveur à la fin. Aucune trame sans droit, pas même le
// temps que la garde réponde au départ d'un salon ; aucune connexion autorisée figée, à l'état faux ou privée de son flux
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

// horloge virtuelle : Date.now, setTimeout, clearTimeout (posée le temps de ces tests, rendue ensuite)
let now = 1_700_000_000_000
const timers = new Map<number, { at: number; fn: () => void }>()
let nextTimer = 1
const vraies = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
function poserHorloge(): void {
  Date.now = () => now
  ;(globalThis as any).setTimeout = (fn: any, ms?: number, ...args: any[]) => {
    const id = nextTimer++
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn: () => fn(...args) })
    return { id, unref() { return this }, ref() { return this }, hasRef() { return false }, [Symbol.toPrimitive]() { return id } }
  }
  ;(globalThis as any).clearTimeout = (h: any) => { if (h == null) return; timers.delete(typeof h === 'object' ? h.id : Number(h)) }
}
function rendreHorloge(): void {
  Date.now = vraies.now
  globalThis.setTimeout = vraies.setTimeout
  globalThis.clearTimeout = vraies.clearTimeout
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)) }
async function advance(ms: number) {
  const target = now + ms
  for (;;) {
    let best = -1, at = Infinity
    for (const [id, t] of timers) if (t.at <= target && t.at < at) { at = t.at; best = id }
    if (best < 0) break
    const t = timers.get(best)!; timers.delete(best)
    if (t.at > now) now = t.at
    t.fn()
    await flush()
  }
  now = target
}

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

type S = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'
const ROOMS = ['R1', 'R2'] as const

interface Bilan { suites: number; trames: number; fuite: number; perte: number; perdu: number; exemples: string[] }

// une suite de `longueur` événements ; `ou` ajoute le flux H, gardé par « R1 OU R2 »
async function suite(seed: number, longueur: number, ou: boolean, bilan: Bilan) {
  const STREAMS: S[] = ou ? ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  timers.clear()
  const byHeader = new Map<string, any>()
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 1e9, burst: 1e9, kickAfter: 1e9 }, rooms: { meta: (c: any) => { const k = byHeader.get(c.meta?.headers?.['x-cv']); if (k) k.server = c; return {} } } })
  const log: string[] = []
  interface Conn { key: string; ws: any; server: any; alive: boolean; rooms: Set<string>; perm: Record<string, boolean>; single: S | null
    st: Map<string, { lastSeq: number; seqKnown?: boolean; resyncing: boolean; store: Map<string, unknown>; intent: boolean; probe: number }>; gen: number; reprend: boolean }
  const conns: Conn[] = []
  let tightened = false
  const destroyed = new Set<S>()
  const handles = new Map<S, any>()
  const pending: Array<{ conn: Conn; s: S; resolve: (v: boolean | null) => void; compute: () => boolean; done: boolean }> = []
  let current: { type: string; conn: Conn | null } = { type: '', conn: null }
  const has = (room: string, client: any) => app.room(room).has(client)
  const connOf = (client: any): Conn => byHeader.get(client.meta?.headers?.['x-cv'])!
  function asyncGuard(s: S, client: any, compute: () => boolean): Promise<boolean> {
    const conn = connOf(client)
    const rec = { conn, s, resolve: null as any, compute, done: false }
    log.push(`appel ${conn.key} ${s} (${current.type})`)
    return new Promise<boolean>((res, rej) => { rec.resolve = (v: boolean | null) => { rec.done = true; if (v === null) rej(new Error('garde')); else res(v) }; pending.push(rec) })
  }
  const opts: Record<S, any> = {
    A: { canSubscribe: (c: any) => { const v = has('R1', c) || connOf(c).perm.A; return asyncGuard('A', c, () => v) } },
    B: { canSubscribe: (c: any) => { const v = connOf(c).perm.B; return asyncGuard('B', c, () => v) } },
    C: { canSubscribe: (c: any) => has('R1', c) && has('R2', c) },
    D: { room: 'R2', canSubscribe: (c: any) => { const v = connOf(c).perm.D; return asyncGuard('D', c, () => v) } },
    E: { canSubscribe: (c: any) => asyncGuard('E', c, () => has('R2', c) || connOf(c).perm.E) },
    F: { public: true },
    G: { room: 'R1' },
    H: { canSubscribe: (c: any) => { const v = has('R1', c) || has('R2', c); return asyncGuard('H', c, () => v) } },
  }
  const tightF = { canSubscribe: (c: any) => { const v = has('R1', c) || connOf(c).perm.F; return asyncGuard('F', c, () => v) } }
  function right(conn: Conn, s: S): boolean {
    const inR = (x: string) => conn.rooms.has(x)
    switch (s) {
      case 'A': return inR('R1') || conn.perm.A
      case 'B': return conn.perm.B
      case 'C': return inR('R1') && inR('R2')
      case 'D': return inR('R2') && conn.perm.D
      case 'E': return inR('R2') || conn.perm.E
      case 'F': return !tightened || inR('R1') || conn.perm.F
      case 'G': return inR('R1')
      case 'H': return inR('R1') || inR('R2')
    }
  }
  for (const s of STREAMS) handles.set(s, app.stream(s, opts[s]))
  await app.listen()
  const send = (conn: Conn, t: string, p: unknown) => { if (conn.alive) conn.ws.send(JSON.stringify({ t, p })) }
  const stOf = (conn: Conn, s: string) => { let x = conn.st.get(s); if (!x) { x = { lastSeq: 0, resyncing: false, store: new Map(), intent: false, probe: 0 }; conn.st.set(s, x) } return x }
  // client du framework (runtime/mjs_socket.ts) : seq strictement croissant, trou (dès 0 après un reset numéroté) → un seul µ:resync, reset accepté partout
  function onFrame(conn: Conn, f: any) {
    // un refus : le client le sait, et redemandera s'il le veut
    if (f.t === 'µ:error') { if (f.p?.code) return; if (conn.single) { const x = conn.st.get(conn.single); if (x) x.intent = false } log.push(`${conn.key} µ:error`); return }
    // reconnexion : à l'accueil, le client du framework rentre dans ses salons, puis redemande ses flux (rejeu depuis le
    // dernier numéro vu, ou état complet)
    if (f.t === 'µ:welcome') {
      if (!conn.reprend) return
      conn.reprend = false
      for (const room of conn.rooms) send(conn, 'µ:join', { room })
      for (const [t, y] of conn.st) { if (y.lastSeq) { y.resyncing = true; send(conn, 'µ:resync', { stream: t, from: y.lastSeq }) } else send(conn, 'µ:sub-stream', { stream: t }) }
      return
    }
    if (!STREAMS.includes(f.t) || !f.p || typeof f.p.op !== 'string') return
    const s = f.t as S
    if (destroyed.has(s) && f.p.op === 'reset' && f.seq === 0 && Object.keys(f.p.values ?? {}).length === 0) return   // repli d'un flux inconnu
    bilan.trames++
    if (!right(conn, s)) { bilan.fuite++; if (bilan.exemples.length < 8) bilan.exemples.push(`graine ${seed} : ${conn.key} reçoit ${s} ${f.p.op} seq ${f.seq} sans droit — ${log.slice(-10).join(' ; ')}`) }
    log.push(`${conn.key} ← ${s} ${f.p.op} seq ${f.seq}`)
    const x = conn.st.get(s)
    if (!x) return
    if (f.p.key === 'probe') x.probe++
    const p = f.p, seq = f.seq
    if (p.op === 'reset') { x.resyncing = false; x.lastSeq = seq != null ? seq : 0; x.seqKnown = seq != null; x.store = new Map(Object.entries(p.values ?? {})); return }
    if (seq != null) {
      if (x.lastSeq && seq <= x.lastSeq) return
      if ((x.lastSeq || x.seqKnown) && seq > x.lastSeq + 1) { if (!x.resyncing) { x.resyncing = true; send(conn, 'µ:resync', { stream: s, from: x.lastSeq }) } return }
      x.resyncing = false; x.lastSeq = seq
    }
    if (p.op === 'add') x.store.set(p.key, p.value)
    else if (p.op === 'update') x.store.set(p.key, { ...(x.store.get(p.key) as any ?? {}), ...p.patch })
    else if (p.op === 'remove') x.store.delete(p.key)
  }
  // `avant` : la connexion coupée que celle-ci remplace — mêmes salons et mêmes flux, redemandés à l'accueil
  async function connect(slot: number, single: S | null, perm: Record<string, boolean>, gen: number, avant?: Conn) {
    const key = 'c' + slot + '#' + gen
    const ws = transport.connect({ url: 'ws://cv/', headers: { 'x-cv': key } })
    const conn: Conn = { key, ws, server: null, alive: true, rooms: new Set(avant?.rooms), perm, single, st: avant?.st ?? new Map(), gen, reprend: !!avant }
    byHeader.set(key, conn)
    ws.onmessage = (ev: any) => onFrame(conn, JSON.parse(ev.data))
    ws.onclose = () => { conn.alive = false }
    await flush()
    ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await flush()
    conns[slot] = conn
  }
  let slot = 0
  for (const s of STREAMS) for (const ok of [true, false]) await connect(slot++, s, { [s]: ok }, 0)
  const multiples = slot
  for (let k = 0; k < 2; k++) { const perm: Record<string, boolean> = {}; for (const s of STREAMS) perm[s] = r() < 0.5; await connect(slot++, null, perm, 0) }
  let val = 0
  async function act(type: string, conn: Conn | null, fn: () => void) { current = { type, conn }; fn(); await flush(); current = { type: '', conn: null } }
  for (const c of conns) {
    for (const room of ROOMS) if (r() < 0.6) { c.rooms.add(room); log.push(`${c.key} join ${room}`); await act('join', c, () => send(c, 'µ:join', { room })) }
    for (const t of (c.single ? [c.single] : STREAMS)) { stOf(c, t).intent = true; await act('sub', c, () => send(c, 'µ:sub-stream', { stream: t })) }
  }
  for (const p of pending.filter(p => !p.done)) if (r() < 0.7) { p.resolve(p.compute()); await flush() }
  const chauds = [pick(conns), pick(conns), conns[multiples + Math.floor(r() * 2)]]
  for (let i = 0; i < longueur; i++) {
    const x = r()
    const conn = r() < 0.8 ? pick(chauds) : pick(conns)
    const s: S = conn.single ?? pick(STREAMS)
    if (x < 0.12) { const room = pick(ROOMS); if (!conn.alive || conn.rooms.has(room)) continue; log.push(`${conn.key} join ${room}`); conn.rooms.add(room); await act('join', conn, () => send(conn, 'µ:join', { room })) }
    else if (x < 0.24) { const room = pick(ROOMS); if (!conn.alive || !conn.rooms.has(room)) continue; log.push(`${conn.key} leave ${room}`); conn.rooms.delete(room); await act('leave', conn, () => send(conn, 'µ:leave', { room })) }
    else if (x < 0.26) { const room = pick(ROOMS); if (!conn.alive || !conn.rooms.has(room) || !conn.server) continue; log.push(`${conn.key} kick ${room}`); conn.rooms.delete(room); await act('leave', conn, () => app.room(room).kick(conn.server)) }
    else if (x < 0.36) { if (!conn.alive) continue; stOf(conn, s).intent = !destroyed.has(s); log.push(`${conn.key} sub ${s}`); await act('sub', conn, () => send(conn, 'µ:sub-stream', { stream: s })) }
    else if (x < 0.41) { if (!conn.alive) continue; const y = stOf(conn, s); y.intent = !destroyed.has(s); log.push(`${conn.key} resync ${s} ${y.lastSeq}`); await act('resync', conn, () => send(conn, 'µ:resync', { stream: s, from: y.lastSeq })) }
    else if (x < 0.66) { const open = pending.filter(p => !p.done); if (!open.length) continue; const p = pick(open); const v = r() < 0.05 ? null : p.compute(); if (v === null) { const y = p.conn.st.get(p.s); if (y) y.intent = false } log.push(`réponse ${p.conn.key} ${p.s}=${v}`); await act('answer', null, () => p.resolve(v)) }
    else if (x < 0.80) { const t = pick(STREAMS); if (destroyed.has(t)) continue; log.push(`delta ${t}`); await act('produce', null, () => handles.get(t).add('k' + (val % 4), val++)) }
    else if (x < 0.86) { const ms = pick([50, 300, 700, 1000, 1500]); log.push(`+${ms}ms`); await advance(ms) }
    else if (x < 0.88) { const t = pick(STREAMS); if (destroyed.has(t)) { log.push(`redéclare ${t}`); destroyed.delete(t); handles.set(t, app.stream(t, t === 'F' && tightened ? tightF : opts[t])) } else { log.push(`destroy ${t}`); destroyed.add(t); for (const c of conns) { const y = c.st.get(t); if (y) y.intent = false } handles.get(t).destroy() } await flush() }
    else if (x < 0.89) { if (tightened) continue; tightened = true; log.push('garde posée sur F'); await act('tighten', null, () => { app.stream('F', tightF) }) }
    else if (x < 0.91) { log.push(`${conn.key} coupe`); const idx = conns.indexOf(conn); conn.ws.close(); conn.alive = false; await flush(); await connect(idx, conn.single, conn.perm, conn.gen + 1, conn); const nc = conns[idx]; for (let j = 0; j < chauds.length; j++) if (chauds[j] === conn) chauds[j] = nc }
    else { const t = pick(STREAMS); if (destroyed.has(t)) continue; log.push(`update ${t}`); await act('produce', null, () => handles.get(t).update('k' + (val % 4), { v: val++ })) }
  }
  // repos : toutes les gardes répondent, le temps passe ; puis deux sondes par flux
  async function repos() { for (let i = 0; i < 30; i++) { const open = pending.filter(p => !p.done); if (!open.length && timers.size === 0) break; for (const p of open) { p.resolve(p.compute()); await flush() } await advance(2500) } }
  await repos()
  for (const t of STREAMS) if (!destroyed.has(t)) { handles.get(t).add('probe', 1); await flush() }
  await repos()
  for (const c of conns) for (const [, y] of c.st) y.probe = 0
  for (const t of STREAMS) if (!destroyed.has(t)) { handles.get(t).add('probe', 2); await flush() }
  for (const c of conns) {
    if (!c.alive) continue
    for (const [s, y] of c.st) {
      if (destroyed.has(s as S)) continue
      const snap = handles.get(s as S).snapshot()
      const same = y.store.size === Object.keys(snap).length && Object.entries(snap).every(([k, v]) => JSON.stringify(y.store.get(k)) === JSON.stringify(v))
      if (y.probe > 0 && (!same || y.resyncing)) { bilan.perte++; if (bilan.exemples.length < 8) bilan.exemples.push(`graine ${seed} : ${c.key} ${s} figé ou à l'état faux (resyncing ${y.resyncing}) — ${log.slice(-10).join(' ; ')}`) }
      if (c.single === s && y.intent && right(c, s as S) && y.probe === 0) { bilan.perdu++; if (bilan.exemples.length < 8) bilan.exemples.push(`graine ${seed} : ${c.key} ${s} demandé, autorisé, rien reçu — ${log.slice(-10).join(' ; ')}`) }
    }
  }
  bilan.suites++
  { const arret = app.stop().catch(() => {}); await advance(50); await arret }
  timers.clear()
}

async function banc(graines: number[], longueur: number, ou: boolean): Promise<Bilan> {
  const bilan: Bilan = { suites: 0, trames: 0, fuite: 0, perte: 0, perdu: 0, exemples: [] }
  for (const g of graines) await suite(g, longueur, ou, bilan)
  return bilan
}

const plage = (de: number, n: number) => Array.from({ length: n }, (_, i) => de + i)

describe('MJS-WS — gardes des flux : suites d’événements dans un ordre aléatoire, contre le droit réel', function () {
  this.timeout(60000)
  before(poserHorloge)
  after(rendreHorloge)

  it('gardes synchrone, asynchrones, salon, posée après coup : aucune trame sans droit, aucun client figé ni privé de son flux', async () => {
    const b = await banc([...plage(1, 200), 345, 1555, 1871, 2318, 3076, 3268, 3450], 100, false)
    assert.ok(b.trames > 10000, `le banc a tourné (${b.trames} trames)`)
    assert.deepEqual({ fuite: b.fuite, perte: b.perte, perdu: b.perdu }, { fuite: 0, perte: 0, perdu: 0 }, b.exemples.join('\n'))
  })

  it('garde « l’un OU l’autre salon » en plus : de même', async () => {
    const b = await banc([...plage(1, 200), 185, 463, 2709, ...plage(20001, 30)], 100, true)
    assert.ok(b.trames > 10000, `le banc a tourné (${b.trames} trames)`)
    assert.deepEqual({ fuite: b.fuite, perte: b.perte, perdu: b.perdu }, { fuite: 0, perte: 0, perdu: 0 }, b.exemples.join('\n'))
  })
})
