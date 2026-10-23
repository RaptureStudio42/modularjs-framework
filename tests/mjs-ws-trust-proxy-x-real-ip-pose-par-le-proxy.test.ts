// Option `trustProxy` : un proxy de confiance qui ne pose que X-Real-IP (le réglage nginx le plus courant,
// `proxy_set_header X-Real-IP $remote_addr`, sans la ligne X-Forwarded-For) laisse passer tel quel le
// X-Forwarded-For que le visiteur écrit lui-même. Un X-Forwarded-For forgé ne doit jamais lui donner l'adresse de
// son choix (contourner le plafond par adresse ou la mise au banc, faire bannir quelqu'un d'autre) : il contredit
// X-Real-IP, et la connexion porte alors l'adresse du proxy ; sans lui, X-Real-IP désigne le visiteur. X-Real-IP
// qui désigne lui-même un proxy de confiance (CDN devant nginx) renvoie à X-Forwarded-For. Le cas inverse, un proxy
// qui ne pose que X-Forwarded-For : tests/mjs-ws-trust-proxy-en-tetes-qui-se-contredisent.test.ts.

import assert from 'node:assert/strict'
import { connect, createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import WebSocket from 'ws'
import { mjsWs } from '../src/mjs-ws/index.js'
import type { MjsWsApp, MjsWsRemoteInfo } from '../src/mjs-ws/index.js'
import { WsTransport } from '../src/mjs-ws/transport-ws.js'
import { resolveTrustProxy, visitorAddress } from '../src/mjs-ws/trust-proxy.js'

type Headers = Record<string, string | string[] | undefined>

const via = (trust: unknown, peer: string | undefined, headers: Headers): string | undefined => visitorAddress(peer, headers, resolveTrustProxy(trust))

describe('trustProxy : un proxy de confiance qui ne pose que X-Real-IP', () => {
  it('un X-Forwarded-For écrit par le visiteur, passé tel quel par le proxy, contredit X-Real-IP : jamais l\'adresse forgée, l\'adresse du proxy', () => {
    for (const forged of ['198.51.100.77', '10.0.0.1', '127.0.0.1', '198.51.100.77, 10.9.9.9']) {
      assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '203.0.113.10', 'x-forwarded-for': forged }), '127.0.0.1', `X-Forwarded-For ${forged}`)
    }
    assert.equal(via(['10.0.0.0/8'], '10.0.0.5', { 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.77' }), '10.0.0.5')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '203.0.113.10' }), '203.0.113.10', 'sans X-Forwarded-For : X-Real-IP désigne le visiteur')
  })

  it('nginx complet (les deux en-têtes posés) : le visiteur, comme avant', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.77, 203.0.113.10' }), '203.0.113.10')
  })

  it('CDN devant nginx : X-Real-IP vaut l\'adresse du CDN, de confiance, et l\'on remonte X-Forwarded-For', () => {
    const list = ['127.0.0.1', '192.0.2.0/24']
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': '192.0.2.5', 'x-forwarded-for': '203.0.113.10, 192.0.2.5' }), '203.0.113.10')
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': '192.0.2.5', 'x-forwarded-for': '198.51.100.77, 203.0.113.10, 192.0.2.5' }), '203.0.113.10', 'l\'entrée écrite par le visiteur reste à gauche, ignorée')
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': '192.0.2.5' }), '127.0.0.1', 'sans X-Forwarded-For : X-Real-IP nomme un proxy, l\'adresse du pair')
  })

  it('X-Real-IP illisible : X-Forwarded-For, comme avant ; ni l\'un ni l\'autre lisible : le pair', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': 'garbage', 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': 'garbage', 'x-forwarded-for': 'garbage' }), '127.0.0.1')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '203.0.113.7:4711' }), '127.0.0.1')
  })

  it('un pair qui n\'est pas de confiance : X-Real-IP reste ignoré', () => {
    assert.equal(via(['10.0.0.0/8'], '203.0.113.9', { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.5' }), '203.0.113.9')
  })
})

// ============================================================================================
// la chaîne réelle : un vrai serveur (transport `ws`) derrière un faux proxy qui ne pose que X-Real-IP
// ============================================================================================

// le faux proxy : remplace X-Real-IP par l'adresse qu'il voit pour son client, laisse passer le reste tel quel (nginx)
function launchRealIpProxy(target: number, visitor: string): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((incoming) => {
    const outgoing = connect(target, '127.0.0.1')
    sockets.add(incoming)
    sockets.add(outgoing)
    let buffered = Buffer.alloc(0)
    let relayed  = false
    incoming.on('data', (chunk) => {
      if (relayed) { outgoing.write(chunk); return }
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf('\r\n\r\n')
      if (end < 0) return
      relayed = true
      const [requestLine, ...lines] = buffered.subarray(0, end).toString('latin1').split('\r\n')
      const head = [requestLine, ...lines.filter(line => !/^x-real-ip:/i.test(line)), 'X-Real-IP: ' + visitor].join('\r\n')
      outgoing.write(Buffer.concat([Buffer.from(head + '\r\n\r\n', 'latin1'), buffered.subarray(end + 4)]))
    })
    outgoing.on('data', (chunk) => incoming.write(chunk))
    incoming.on('close', () => { outgoing.destroy(); sockets.delete(incoming) })
    outgoing.on('close', () => { incoming.destroy(); sockets.delete(outgoing) })
    incoming.on('error', () => {})
    outgoing.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port:  (server.address() as AddressInfo).port,
      close: () => new Promise<void>((done) => { for (const socket of sockets) socket.destroy(); server.close(() => done()) }),
    }))
  })
}

// un serveur réel sur un port donné par le système ; `seen` reçoit l'adresse retenue à chaque hello
async function launch(): Promise<{ app: MjsWsApp; port: number; seen: Array<string | undefined> }> {
  const seen: Array<string | undefined> = []
  const baseStart                        = WsTransport.prototype.start
  let port                               = 0
  WsTransport.prototype.start = async function(this: WsTransport) {
    await baseStart.call(this)
    port = (this as unknown as { _wss: { address(): AddressInfo } })._wss.address().port
  }
  const app = mjsWs({ port: 0, host: '127.0.0.1', heartbeat: 0, trustProxy: 'loopback', auth: (_hello: unknown, meta: MjsWsRemoteInfo) => { seen.push(meta.address); return {} }, onLog: () => {} })
  try { await app.listen() }
  finally { WsTransport.prototype.start = baseStart }
  return { app, port, seen }
}

// une visite : ouverture, hello, attente du verdict (µ:welcome ou fermeture), puis fermeture
function visit(port: number, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers })
    ws.once('error', reject)
    ws.once('open', () => ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } })))
    ws.on('message', (data) => { if (JSON.parse(data.toString()).t === 'µ:welcome') { ws.terminate(); resolve() } })
    ws.once('close', () => resolve())
  })
}

describe('trustProxy : serveur réel derrière un proxy qui ne pose que X-Real-IP', function () {
  this.timeout(20000)

  it('le visiteur 203.0.113.10 garde son adresse sans X-Forwarded-For ; un X-Forwarded-For forgé ne lui donne jamais l\'adresse forgée', async () => {
    const run   = await launch()
    const proxy = await launchRealIpProxy(run.port, '203.0.113.10')
    try {
      await visit(proxy.port, {})
      await visit(proxy.port, { 'X-Forwarded-For': '198.51.100.77' })
      await visit(proxy.port, { 'X-Forwarded-For': '10.0.0.1' })
      assert.deepEqual(run.seen, ['203.0.113.10', '127.0.0.1', '127.0.0.1'])
    }
    finally {
      await proxy.close()
      await run.app.stop()
    }
  })
})
