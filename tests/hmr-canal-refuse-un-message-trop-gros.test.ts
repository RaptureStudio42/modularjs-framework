// canal de rechargement de mjs dev (/__mjs_hmr) : une page n'y envoie que la réponse d'un échange à chaud (« hot-result », 32 octets
// au plus) ; un message de plus de 4 096 octets ferme la connexion (code 1009) au lieu de grossir la mémoire du serveur
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { HMRServer } from '../src/server/hmr.js'

describe('canal de rechargement — un message reçu de plus de 4 096 octets est refusé', function () {
  let http: Server
  let hmr: HMRServer
  let port = 0

  beforeEach(async function () {
    http = createServer()
    hmr  = new HMRServer(http, { listenHost: '127.0.0.1' })
    await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()))
    port = (http.address() as AddressInfo).port
  })

  afterEach(async function () {
    await new Promise<void>((ok) => hmr.wss.close(() => ok()))
    await new Promise<void>((ok) => http.close(() => ok()))
  })

  // connexion admise (page locale), rendue après le message « connected » du serveur
  const ouvrir = () => new Promise<WebSocket>((ok, ko) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`, { origin: 'http://localhost:5173' })
    ws.once('message', () => ok(ws))
    ws.once('error', ko)
  })

  it('un message de 5 000 octets ferme la connexion, code 1009', async function () {
    const ws   = await ouvrir()
    const code = await new Promise<number>((ok) => {
      ws.once('close', (c) => ok(c))
      ws.send(Buffer.alloc(5000, 97))
      setTimeout(() => ok(-1), 1500)
    })
    if (ws.readyState === WebSocket.OPEN) ws.close()
    assert.equal(code, 1009, 'connexion restée ouverte après un message de 5 000 octets')
  })

  it('la réponse d\'un échange à chaud passe toujours, à sa plus grande taille', async function () {
    const recus: boolean[] = []
    hmr.onHotResult = (ok) => { recus.push(ok) }
    const ws = await ouvrir()
    const message = JSON.stringify({ type: 'hot-result', ok: false })
    ws.send(message)
    ws.send(JSON.stringify({ type: 'hot-result', ok: true }))
    for (let i = 0; i < 40 && recus.length < 2; i++) await new Promise((ok) => setTimeout(ok, 25))
    ws.close()
    assert.equal(message.length, 32)
    assert.deepEqual(recus, [false, true])
  })
})
