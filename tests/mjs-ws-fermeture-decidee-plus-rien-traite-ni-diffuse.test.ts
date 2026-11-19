// Fermeture décidée par le serveur (client.close(), expulsion pour débit) : un client qui ne répond pas à la trame de
// fermeture garde sa connexion physique jusqu'au délai du transport, mais plus rien de lui n'est traité et il quitte la
// diffusion dès la décision ; une raison de plus de 123 octets ferme quand même, coupée entre deux caractères.
// Vrai serveur `ws` sur 127.0.0.1 : on compte des trames arrivées, traitées, envoyées, jamais du temps
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsWs, WsTransport } from '../src/mjs-ws/index.js'

const tick = () => new Promise<void>(r => setTimeout(r, 10))

// attente bornée d'une condition comptée (trames arrivées, fermeture vue)
async function until(cond: () => boolean, tries = 300): Promise<boolean> {
  for (let i = 0; i < tries && !cond(); i++) await tick()
  return cond()
}

async function startServer(opts: Record<string, unknown> = {}) {
  const transport = new WsTransport({ port: 0, host: '127.0.0.1' })
  const app       = mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {}, ...opts } as any)
  await app.listen()
  return { app, port: (transport as any)._wss.address().port as number }
}

interface Peer { ws: WebSocket; frames: any[]; closed: { code: number; reason: string } | null }

async function connect(port: number): Promise<Peer> {
  const ws         = new WebSocket('ws://127.0.0.1:' + port)
  const peer: Peer = { ws, frames: [], closed: null }
  ws.on('message', d => peer.frames.push(JSON.parse(d.toString())))
  ws.on('close', (code, reason) => { peer.closed = { code, reason: reason.toString('utf8') } })
  ws.on('error', () => {})
  await new Promise<void>((ok, ko) => { ws.once('open', () => ok()); ws.once('error', ko) })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await until(() => peer.frames.some(f => f.t === 'µ:welcome'))
  return peer
}

// pair hostile : ne répond jamais à la trame de fermeture du serveur
const ignoreCloseFrame = (peer: Peer) => { (peer.ws as any)._receiver.removeAllListeners('conclude') }

// trames ARRIVÉES côté serveur sur la connexion de ce client, avant tout traitement
function countArrivals(client: any): () => number {
  let n      = 0
  const orig = client.conn.onMessage
  client.conn.onMessage = (d: unknown) => { n++; orig?.(d) }
  return () => n
}

// envois du serveur vers ce client, comptés à la sortie (même ceux que le transport jette ensuite)
function countSends(client: any): () => number {
  let n      = 0
  const orig = client.conn.send.bind(client.conn)
  client.conn.send = (d: unknown) => { n++; orig(d) }
  return () => n
}

const chat = (peer: Peer, n: number) => { for (let i = 0; i < n; i++) peer.ws.send(JSON.stringify({ t: 'chat', p: { i } })) }

describe('MJS-WS — fermeture décidée : plus rien de traité, plus rien de diffusé', function () {
  this.timeout(20000)

  it('après client.close(), un client qui ignore la fermeture n\'est plus servi ni diffusé, et quitte app.clients', async () => {
    const { app, port } = await startServer()
    let handled = 0
    app.on('chat', () => { handled++ })
    const peer         = await connect(port)
    ignoreCloseFrame(peer)
    const client: any  = Array.from(app.clients)[0]
    const arrived      = countArrivals(client)
    client.close('au revoir')
    await until(() => peer.frames.some(f => f.t === 'µ:bye'))
    const sends = countSends(client)
    chat(peer, 20)
    await until(() => arrived() === 20)
    app.broadcast('annonce', { x: 1 })
    const sent   = sends()
    const listed = Array.from(app.clients).length
    peer.ws.terminate()
    await app.stop()
    assert.equal(arrived(), 20)
    assert.equal(handled, 0, 'messages traités après client.close()')
    assert.equal(sent, 0, 'diffusions envoyées après client.close()')
    assert.equal(listed, 0, 'connexion encore dans app.clients')
  })

  it('après une expulsion pour débit, ni les messages déjà en file ni les suivants ne sont traités', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>(r => { open = r })
    const { app, port } = await startServer({ limits: { maxQueued: 3 } })
    let handled = 0
    app.serve('slow', async () => { await gate; return 1 })
    app.on('chat', () => { handled++ })
    const peer        = await connect(port)
    ignoreCloseFrame(peer)
    const client: any = Array.from(app.clients)[0]
    const arrived     = countArrivals(client)
    peer.ws.send(JSON.stringify({ t: 'slow', id: 1, p: {} }))
    chat(peer, 6)
    await until(() => arrived() === 7)
    const kicks = app.stats().guard.kicksRate
    open()
    chat(peer, 5)
    await until(() => arrived() === 12 && client.queuedMessages === 0)
    peer.ws.terminate()
    await app.stop()
    assert.equal(kicks, 1)
    assert.equal(handled, 0, 'messages traités après l\'expulsion')
  })

  it('une raison de plus de 123 octets ferme quand même la connexion, coupée entre deux caractères', async () => {
    const { app, port } = await startServer()
    let handled = 0
    app.on('chat', () => { handled++ })
    const peer        = await connect(port)
    const client: any = Array.from(app.clients)[0]
    const reason      = 'x'.repeat(120) + '😀' + ' : déconnecté par un modérateur, propos déplacés répétés malgré deux avertissements'
    client.close(reason)
    await until(() => peer.closed !== null)
    const closed = peer.closed as { code: number; reason: string } | null
    if (!closed) chat(peer, 5)
    await until(() => handled > 0, 20)
    peer.ws.terminate()
    await app.stop()
    assert.ok(closed, 'connexion toujours ouverte')
    assert.equal(closed.code, 1000)
    assert.equal(closed.reason, 'x'.repeat(120), 'raison coupée au milieu d\'un caractère, ou mal bornée')
    assert.equal(handled, 0)
  })
})
