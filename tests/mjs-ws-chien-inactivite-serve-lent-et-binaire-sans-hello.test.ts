// Chien d'inactivité : un serve() lent ne fait pas expulser pour silence un client qui bat pendant ce temps (ses trames
// en file prouvent qu'il est là), et une connexion sans hello qui n'envoie que des trames binaires est fermée pour
// silence. Les battements se comptent sur une horloge pilotée par le test : seul le minuteur du chien (sa durée, 2,5
// battements, ne vaut aucun autre délai du serveur) passe par elle, tout le reste garde les vrais minuteurs
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsWs, WsTransport } from '../src/mjs-ws/index.js'

const HEARTBEAT = 4321
const WINDOW    = HEARTBEAT * 2.5

interface FakeTimer { due: number; live: boolean; fire: () => void; refresh(): FakeTimer; ref(): FakeTimer; unref(): FakeTimer; hasRef(): boolean }

// horloge pilotée : setTimeout/clearTimeout remplacés le temps d'un essai, pour la seule durée WINDOW
function pilotedClock() {
  const realSet   = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  const timers: FakeTimer[] = []
  let now = 0
  ;(globalThis as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (ms !== WINDOW) return realSet(fn, ms, ...args)
    const timer: FakeTimer = {
      due: now + WINDOW,
      live: true,
      fire: () => fn(...args),
      refresh() { timer.due = now + WINDOW; timer.live = true; return timer },
      ref() { return timer },
      unref() { return timer },
      hasRef() { return true }
    }
    timers.push(timer)
    return timer
  }
  ;(globalThis as any).clearTimeout = (handle: unknown) => {
    const timer = timers.find(x => x === handle)
    if (timer) timer.live = false
    else realClear(handle as any)
  }
  return {
    // avance l'horloge : chaque minuteur échu part une fois
    advance(ms: number) {
      now += ms
      for (const timer of timers) if (timer.live && timer.due <= now) { timer.live = false; timer.fire() }
    },
    restore() { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear }
  }
}

const tick = () => new Promise<void>(r => setTimeout(r, 10))

async function until(cond: () => boolean, tries = 300): Promise<boolean> {
  for (let i = 0; i < tries && !cond(); i++) await tick()
  return cond()
}

async function startServer(opts: Record<string, unknown> = {}) {
  const transport = new WsTransport({ port: 0, host: '127.0.0.1' })
  const app       = mjsWs({ transport, heartbeat: HEARTBEAT, ban: false, onLog: () => {}, ...opts } as any)
  await app.listen()
  return { app, port: (transport as any)._wss.address().port as number }
}

interface Peer { ws: WebSocket; frames: any[]; closed: { code: number } | null }

async function connect(port: number, hello: boolean): Promise<Peer> {
  const ws         = new WebSocket('ws://127.0.0.1:' + port)
  const peer: Peer = { ws, frames: [], closed: null }
  ws.on('message', (d, binary) => { if (!binary) peer.frames.push(JSON.parse(d.toString())) })
  ws.on('close', code => { peer.closed = { code } })
  ws.on('error', () => {})
  await new Promise<void>((ok, ko) => { ws.once('open', () => ok()); ws.once('error', ko) })
  if (hello) {
    ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
    await until(() => peer.frames.some(f => f.t === 'µ:welcome'))
  }
  return peer
}

describe('MJS-WS — chien d\'inactivité : serve() lent, trames binaires sans hello', function () {
  this.timeout(20000)

  it('un client qui bat pendant un serve() lent n\'est pas expulsé pour silence', async () => {
    const clock = pilotedClock()
    try {
      let open: () => void = () => {}
      const gate = new Promise<void>(r => { open = r })
      const { app, port } = await startServer()
      app.serve('slow', async () => { await gate; return 1 })
      const peer        = await connect(port, true)
      const client: any = Array.from(app.clients)[0]
      let arrived       = 0
      const orig        = client.conn.onMessage
      client.conn.onMessage = (d: unknown) => { arrived++; orig?.(d) }
      peer.ws.send(JSON.stringify({ t: 'slow', id: 1, p: {} }))
      await until(() => arrived === 1)
      // six demi-fenêtres : un µ:ping arrive dans chacune, en file derrière le serve() lent
      for (let i = 1; i <= 6; i++) {
        peer.ws.send(JSON.stringify({ t: 'µ:ping', p: { ts: i } }))
        await until(() => arrived === 1 + i)
        clock.advance(WINDOW / 2)
      }
      const kicks = app.stats().guard.kicksSilence
      open()
      await until(() => peer.frames.some(f => f.t === 'µ:ack'))
      const acked = peer.frames.some(f => f.t === 'µ:ack')
      peer.ws.terminate()
      await app.stop()
      assert.equal(kicks, 0, 'expulsions pour silence')
      assert.equal(acked, true, 'réponse du serve() lent')
    }
    finally { clock.restore() }
  })

  it('une connexion sans hello qui n\'envoie que des trames binaires est fermée pour silence', async () => {
    const clock = pilotedClock()
    try {
      const { app, port } = await startServer()
      const peer = await connect(port, false)
      for (let i = 1; i <= 6 && app.stats().guard.kicksSilence === 0; i++) {
        peer.ws.send(Buffer.from([1, 2, 3]))
        await until(() => app.stats().messages.binaryReceived === i)
        clock.advance(WINDOW / 2)
      }
      await until(() => peer.closed !== null)
      const kicks  = app.stats().guard.kicksSilence
      const closed = peer.closed as { code: number } | null
      peer.ws.terminate()
      await app.stop()
      assert.equal(kicks, 1, 'expulsions pour silence')
      assert.equal(closed?.code, 4000)
    }
    finally { clock.restore() }
  })
})
