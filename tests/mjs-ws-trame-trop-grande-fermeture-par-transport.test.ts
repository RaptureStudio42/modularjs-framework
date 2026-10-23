// Une trame plus grande que `limits.maxPayload`, avec les transports que mjsWs() construit lui-même : la bibliothèque la coupe
// pendant la réception, jamais remise au cœur. Ce que voit le client dépend du transport : `ws` envoie une trame de fermeture 1009 ;
// uWebSockets.js coupe la connexion sans trame de fermeture, et le client voit 1006 — trame simple, fragmentée, multioctet ou
// binaire. Une trame de exactement `limits.maxPayload` octets passe. C'est ce que dit docs/23-mjs-ws.md (§3, §3.1, §12).
//
// uWebSockets.js n'est pas une dépendance du framework : son cas joue contre le vrai paquet s'il est résolu (même recherche que
// tests/mjs-ws-transport-uws.test.ts), sinon il est sauté, et rapporté.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { mjsWs } from '../src/mjs-ws/index.js'
import { UwsTransport } from '../src/mjs-ws/transport-uws.js'
import { WsTransport } from '../src/mjs-ws/transport-ws.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function uwsResolu(): boolean {
  try { createRequire(join(__dirname, '../src/mjs-ws/transport-uws.ts')).resolve('uWebSockets.js'); return true }
  catch { return false }
}

// le transport démarré : celui que mjsWs() a construit, capturé à son démarrage pour lire son port
async function demarrer(genre: 'ws' | 'uws'): Promise<{ app: MjsWsApp, port: number }> {
  const T: any     = genre === 'uws' ? UwsTransport : WsTransport
  const vraiStart  = T.prototype.start
  const vus: any[] = []
  T.prototype.start = function (this: any) { vus.push(this); return vraiStart.call(this) }
  const app = mjsWs({ transport: genre, host: '127.0.0.1', port: 0, heartbeat: 0, onLog: () => {}, limits: { maxPayload: 1000 } })
  try { await app.listen() }
  finally { T.prototype.start = vraiStart }
  assert.equal(vus.length, 1, 'le transport ' + genre + ' a démarré')
  const t = vus[0]
  return { app, port: genre === 'uws' ? t._uws.us_socket_local_port(t._listenToken) : t._wss.address().port }
}

function ouvrir(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { perMessageDeflate: false })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function bonjour(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('message', (d: any) => { if (JSON.parse(String(d)).t === 'µ:welcome') resolve() })
    ws.once('close', (code: number) => reject(new Error('fermé avant la bienvenue : ' + code)))
    ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  })
}

// envoie, puis rend le code de fermeture vu par le client, ou 'ouverte' après 600 ms sans fermeture
function envoyer(ws: WebSocket, f: (ws: WebSocket) => void): Promise<number | 'ouverte'> {
  return new Promise((resolve) => {
    const delai = setTimeout(() => resolve('ouverte'), 600)
    ws.once('close', (code: number) => { clearTimeout(delai); resolve(code) })
    f(ws)
  })
}

const CAS: [string, (ws: WebSocket) => void][] = [
  ['une trame de 1001 octets', ws => ws.send('x'.repeat(1001))],
  ['501 « é » (1002 octets)', ws => ws.send('é'.repeat(501))],
  ['un message fragmenté (3 × 500 octets)', ws => { ws.send('x'.repeat(500), { fin: false }); ws.send('x'.repeat(500), { fin: false }); ws.send('x'.repeat(500), { fin: true }) }],
  ['une trame binaire de 1500 octets', ws => ws.send(Buffer.alloc(1500, 1), { binary: true })],
]

for (const [genre, code] of [['ws', 1009], ['uws', 1006]] as const) {
  describe(`mjs-ws — trame plus grande que limits.maxPayload, transport '${genre}' : le client voit ${code}`, function () {
    this.timeout(30000)

    before(function () {
      if (genre === 'uws' && !uwsResolu()) {
        console.log('  ℹ️  uWebSockets.js introuvable : cas \'uws\' sauté.')
        this.skip()
      }
    })

    it('une trame de exactement limits.maxPayload octets passe', async () => {
      const { app, port } = await demarrer(genre)
      const ws = await ouvrir(port)
      try {
        await bonjour(ws)
        assert.equal(await envoyer(ws, w => w.send('x'.repeat(1000))), 'ouverte')
      } finally {
        ws.terminate()
        await app.stop()
      }
    })

    for (const [nom, f] of CAS) {
      it(nom + ` : connexion fermée, ${code} côté client`, async () => {
        const { app, port } = await demarrer(genre)
        const ws = await ouvrir(port)
        try {
          await bonjour(ws)
          assert.equal(await envoyer(ws, f), code)
        } finally {
          ws.terminate()
          await app.stop()
        }
      })
    }
  })
}
