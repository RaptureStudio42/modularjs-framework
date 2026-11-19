// Reprise de session : une session parquée rend sa place de connexion, si bien qu'une adresse en parquait autant
// qu'elle ouvrait de connexions pendant la grâce, chacune avec son tampon. Les sessions parquées se comptent par
// adresse, sous limits.maxConnectionsPerIp ; au-delà, la coupure de trop n'est pas parquée. Une session reprise rend
// sa place. Vrai serveur `ws` sur 127.0.0.1 : on compte des sessions et des trames gardées
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsWs, WsTransport } from '../src/mjs-ws/index.js'

const tick = () => new Promise<void>(r => setTimeout(r, 10))

async function until(cond: () => boolean, tries = 300): Promise<boolean> {
  for (let i = 0; i < tries && !cond(); i++) await tick()
  return cond()
}

async function startServer(opts: Record<string, unknown> = {}) {
  const transport = new WsTransport({ port: 0, host: '127.0.0.1' })
  const app       = mjsWs({ transport, heartbeat: 0, ban: false, resume: true, onLog: () => {}, auth: (h: any) => ({ id: String(h.user) }), ...opts } as any)
  await app.listen()
  return { app, port: (transport as any)._wss.address().port as number }
}

interface Peer { ws: WebSocket; frames: any[] }

async function connect(port: number, hello: Record<string, unknown>): Promise<Peer> {
  const ws         = new WebSocket('ws://127.0.0.1:' + port)
  const peer: Peer = { ws, frames: [] }
  ws.on('message', d => peer.frames.push(JSON.parse(d.toString())))
  ws.on('error', () => {})
  await new Promise<void>((ok, ko) => { ws.once('open', () => ok()); ws.once('error', ko) })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, ...hello } }))
  await until(() => peer.frames.some(f => f.t === 'µ:welcome'))
  return peer
}

const welcomeOf = (peer: Peer) => peer.frames.find(f => f.t === 'µ:welcome')?.p

describe('MJS-WS — reprise de session : sessions parquées bornées par adresse', function () {
  this.timeout(20000)

  it('au-delà de limits.maxConnectionsPerIp, une coupure de plus n\'est pas parquée', async () => {
    const { app, port } = await startServer({ limits: { maxConnectionsPerIp: 3 } })
    for (let i = 0; i < 8; i++) {
      const peer = await connect(port, { user: 'u' + i })
      peer.ws.terminate()
      await until(() => app.stats().connections.active === 0)
    }
    const parked = app.stats().connections.parked
    for (let i = 0; i < 10; i++) app.broadcast('annonce', { i })
    const buffered = app.stats().messages.buffered
    await app.stop()
    assert.equal(parked, 3, 'sessions parquées pour une adresse')
    assert.equal(buffered, 30, 'trames gardées pour ces sessions')
  })

  it('une session reprise rend sa place : cinq reprises de suite, puis le plafond se remplit encore', async () => {
    const { app, port } = await startServer({ limits: { maxConnectionsPerIp: 2 } })
    let peer    = await connect(port, { user: 'u1' })
    let resumed = 0
    for (let i = 0; i < 5; i++) {
      const session = welcomeOf(peer).session
      peer.ws.terminate()
      await until(() => app.stats().connections.parked === 1)
      peer = await connect(port, { user: 'u1', session })
      if (welcomeOf(peer)?.resumed === true) resumed++
      await until(() => app.stats().connections.parked === 0)
    }
    peer.ws.terminate()
    await until(() => app.stats().connections.active === 0)
    for (const user of ['u2', 'u3', 'u4']) {
      const other = await connect(port, { user })
      other.ws.terminate()
      await until(() => app.stats().connections.active === 0)
    }
    const parked = app.stats().connections.parked
    await app.stop()
    assert.equal(resumed, 5, 'reprises réussies')
    assert.equal(parked, 2, 'sessions parquées après les reprises')
  })
})
