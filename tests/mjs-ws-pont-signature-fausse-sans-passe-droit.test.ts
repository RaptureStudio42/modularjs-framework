// pont universel (src/mjs-ws/bridge.ts) — limite de débit d'une requête qui porte un en-tête de signature :
// - il suffisait d'un en-tête x-mjs-ws-signature quelconque (jamais vérifié à ce stade) pour échapper au seau général : une
//   rafale à signature fausse faisait lire tous ses corps et calculer tous ses HMAC avant le premier échec compté. Une
//   requête n'est dispensée du seau général qu'une fois sa signature vérifiée
// - un corps trop gros (413) ou illisible (400) sous une signature ne comptait jamais parmi les échecs : ces requêtes
//   n'étaient plus jamais limitées, et chacune faisait drainer tout son corps au serveur
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const SECRET = 'secret-de-test-signature-fausse-1234567890'
const GROS   = 'x'.repeat(1024 * 1024 + 10)

async function demarrer(bridge: MjsWsOptions['bridge']): Promise<{ app: MjsWsApp; port: number }> {
  let port  = 0
  const app = mjsWs({
    transport: new MemoryTransport(), heartbeat: 0, bridge,
    onLog: (_niveau, message, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute|universal bridge listening/.test(message)) port = meta.port },
  })
  await app.listen()
  return { app, port }
}

async function poster(port: number, corps: string): Promise<number> {
  // nonce bien formé : le refus porte sur la signature, pas sur un nonce absent
  const headers = { 'content-type': 'application/json', 'x-mjs-ws-timestamp': String(Math.floor(Date.now() / 1000)), 'x-mjs-ws-nonce': randomBytes(16).toString('hex'), 'x-mjs-ws-signature': '0'.repeat(64) }
  const res     = await fetch('http://127.0.0.1:'+ port +'/broadcast', { method: 'POST', headers, body: corps })
  await res.text()
  return res.status
}

const compter = (statuts: number[]): Record<string, number> => statuts.reduce((m: Record<string, number>, s) => { m[s] = (m[s] ?? 0) + 1; return m }, {})

describe('MJS-WS — pont universel : une signature fausse ne dispense de rien', function () {
  this.timeout(30000)

  it('signatures fausses en série : comptées par le seau général tant que la signature n\'est pas vérifiée', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET, rateLimit: { perIp: [3, 60000], fails: [100, 60000] } })
    try {
      const statuts: number[] = []
      for (let i = 0; i < 6; i++) statuts.push(await poster(port, '{"type":"x"}'))
      assert.deepEqual(statuts, [401, 401, 401, 429, 429, 429])
    }
    finally {
      await app.stop()
    }
  })

  it('rafale simultanée à signature fausse : au-delà de la capacité du seau général, 429 sans lire le corps', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET, rateLimit: { perIp: [3, 60000], fails: [100, 60000] } })
    try {
      const statuts = await Promise.all(Array.from({ length: 30 }, () => poster(port, '{"type":"x"}')))
      assert.deepEqual(compter(statuts), { 401: 3, 429: 27 })
    }
    finally {
      await app.stop()
    }
  })

  it('corps trop gros sous une signature fausse : compté parmi les échecs, puis 429', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET, rateLimit: { perIp: [100, 60000], fails: [3, 60000] } })
    try {
      const statuts: number[] = []
      for (let i = 0; i < 6; i++) statuts.push(await poster(port, GROS))
      assert.deepEqual(statuts, [413, 413, 413, 429, 429, 429])
    }
    finally {
      await app.stop()
    }
  })
})
