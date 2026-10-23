// Taille d'un message reçu : les transports que mjsWs() construit lui-même ('ws' par défaut, 'uws') reçoivent `limits.maxPayload`
// et coupent déjà, pendant la réception, toute trame plus grande (`ws` ferme en 1009 ; uWebSockets.js coupe sans trame de fermeture,
// et le client voit 1006). Le cœur remesurait ensuite chaque message texte (Buffer.byteLength, proportionnel à sa longueur : 29 ns
// pour 100 caractères, 6,5 µs pour 60 Ko), un doublon. Il ne le mesure plus que pour un transport passé en instance (MemoryTransport,
// transport maison, `new WsTransport(…)` construit sans cette borne) : là, son contrôle est le seul.
//
// Socket réel, port choisi par le noyau (`port: 0`, même patron que tests/mjs-ws-transport-ws.test.ts).

import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsWs } from '../src/mjs-ws/index.js'
import { WsTransport } from '../src/mjs-ws/transport-ws.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

// compte les mesures de taille d'un message précis (la sonde) : celles du cœur à la réception
const vraiByteLength = Buffer.byteLength
let sonde   = ''
let mesures = 0
function espionner(): void {
  ;(Buffer as any).byteLength = (s: any, e?: any) => { if (s === sonde) mesures++; return vraiByteLength(s, e) }
}
function relacher(): void {
  ;(Buffer as any).byteLength = vraiByteLength
}

// le transport démarré : celui que mjsWs() a construit, capturé à son démarrage pour lire son port
async function demarrer(opts: MjsWsOptions): Promise<{ app: MjsWsApp, port: number }> {
  const vraiStart = WsTransport.prototype.start
  const vus: WsTransport[] = []
  WsTransport.prototype.start = function (this: WsTransport) { vus.push(this); return vraiStart.call(this) }
  const app = mjsWs({ host: '127.0.0.1', port: 0, heartbeat: 0, onLog: () => {}, ...opts })
  try { await app.listen() }
  finally { WsTransport.prototype.start = vraiStart }
  assert.equal(vus.length, 1, 'le transport ws a démarré')
  return { app, port: (vus[0] as any)._wss.address().port }
}

function connecter(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

// le bonjour (la sonde), puis la bienvenue du serveur : le cœur a traité le message
function bonjour(ws: WebSocket): Promise<void> {
  sonde = JSON.stringify({ t: 'µ:hello', p: { protocol: 1, sonde: 'taille-' + Math.random() } })
  return new Promise((resolve, reject) => {
    ws.on('message', (data: any) => { if (JSON.parse(String(data)).t === 'µ:welcome') resolve() })
    ws.once('close', (code: number) => reject(new Error('fermé avant la bienvenue : ' + code)))
    ws.send(sonde)
    // le client a mesuré sa trame en l'envoyant (bibliothèque `ws`, tout de suite) : seules comptent les mesures du serveur, après
    mesures = 0
  })
}

const fermeture = (ws: WebSocket): Promise<number> => new Promise(resolve => ws.once('close', (code: number) => resolve(code)))

describe('mjs-ws — la taille d\'un message reçu est contrôlée une seule fois', function () {
  this.timeout(20000)

  it('transport construit par mjsWs() (\'ws\') : le cœur ne remesure pas un message reçu ; une trame trop grande reste coupée en 1009', async () => {
    const { app, port } = await demarrer({ limits: { maxPayload: 1000 } })
    const ws = await connecter(port)
    espionner()
    try {
      await bonjour(ws)
      assert.equal(mesures, 0, 'la bibliothèque `ws` a déjà borné la trame à limits.maxPayload')
      const code = fermeture(ws)
      ws.send('x'.repeat(1500))
      assert.equal(await code, 1009, 'la trame au-delà de limits.maxPayload est coupée par le transport')
    }
    finally {
      relacher()
      ws.terminate()
      await app.stop()
    }
  })

  it('transport passé en instance (new WsTransport sans maxPayload) : le cœur garde son contrôle — mesure, puis fermeture 1009', async () => {
    const transport = new WsTransport({ host: '127.0.0.1', port: 0 })
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { maxPayload: 1000 } })
    await app.listen()
    const ws = await connecter((transport as any)._wss.address().port)
    espionner()
    try {
      await bonjour(ws)
      assert.equal(mesures, 1, 'le cœur mesure le message : ce transport-ci borne à 64 Ko, pas à limits.maxPayload')
      const code = fermeture(ws)
      ws.send('x'.repeat(1500))
      assert.equal(await code, 1009, 'la trame au-delà de limits.maxPayload est coupée par le cœur')
      assert.equal(app.stats().garde.kicksChargeUtile, 1, 'coupée par la garde du cœur')
    }
    finally {
      relacher()
      ws.terminate()
      await app.stop()
    }
  })
})
