// pont universel (src/mjs-ws/bridge.ts) — limite de débit et secret :
// - le seau général (120 requêtes / 10 s par adresse) comptait aussi les requêtes bien signées : un back légitime qui
//   poussait plus de 12 messages par seconde recevait des 429. Une requête dont la signature est vérifiée rend désormais
//   le jeton qu'elle a pris à l'arrivée (seules les requêtes encore en cours comptent) ; une signature fausse le garde, et
//   compte en plus au seau des échecs, plus strict
// - un secret du pont de 4 caractères passait sans un mot : un secret de moins de 32 caractères passe toujours, avec un
//   avertissement unique (même règle que le secret des jetons)
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECRET = 'secret-de-test-seau-general-1234567890'

async function demarrer(bridge: MjsWsOptions['bridge']): Promise<{ app: MjsWsApp; port: number }> {
  let port  = 0
  const app = mjsWs({
    transport: new MemoryTransport(), heartbeat: 0, bridge,
    onLog: (_niveau, message, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute|universal bridge listening/.test(message)) port = meta.port },
  })
  await app.listen()
  return { app, port }
}

function signer(chemin: string, corps: string, ts: number, nonce: string): string {
  return createHmac('sha256', SECRET).update(['in', String(ts), 'POST', chemin, corps, nonce].map(f => f.length +':'+ f).join('')).digest('hex')
}

async function poster(port: number, signature: 'bonne' | 'fausse' | 'aucune'): Promise<number> {
  const texte = JSON.stringify({ type: 'x' })
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== 'aucune') {
    headers['x-mjs-ws-timestamp'] = String(ts)
    headers['x-mjs-ws-nonce']     = nonce
    headers['x-mjs-ws-signature'] = signature === 'bonne' ? signer('/broadcast', texte, ts, nonce) : '0'.repeat(64)
  }
  const res = await fetch('http://127.0.0.1:'+ port +'/broadcast', { method: 'POST', headers, body: texte })
  await res.text()
  return res.status
}

describe('MJS-WS — pont universel : le seau général ne compte que les requêtes sans signature', function () {
  this.timeout(20000)

  it('un back qui signe pousse bien au-delà de la capacité du seau général sans un seul 429', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET, rateLimit: { perIp: [3, 60000] } })
    try {
      const statuts: number[] = []
      for (let i = 0; i < 10; i++) statuts.push(await poster(port, 'bonne'))
      assert.deepEqual(statuts, Array(10).fill(200))
    }
    finally {
      await app.stop()
    }
  })

  it('sans signature : arrêté par le seau général, qui ne dispense pas une requête signée avant sa vérification', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET, rateLimit: { perIp: [3, 60000], fails: [100, 60000] } })
    try {
      const statuts: number[] = []
      for (let i = 0; i < 5; i++) statuts.push(await poster(port, 'aucune'))
      assert.deepEqual(statuts, [401, 401, 401, 429, 429])
      assert.equal(await poster(port, 'bonne'), 429, 'seau vide pour cette adresse : une signature pas encore vérifiée ne dispense de rien')
    }
    finally {
      await app.stop()
    }
  })

  it('signatures fausses : arrêtées par le seau des échecs, avant toute vérification', async () => {
    const { app, port } = await demarrer({ port: 0, secret: SECRET, rateLimit: { perIp: [100, 60000], fails: [3, 60000] } })
    try {
      const statuts: number[] = []
      for (let i = 0; i < 5; i++) statuts.push(await poster(port, 'fausse'))
      assert.deepEqual(statuts, [401, 401, 401, 429, 429])
    }
    finally {
      await app.stop()
    }
  })

  it('secret de moins de 32 caractères : accepté, un seul avertissement pour le processus ; secret long : aucun', () => {
    const module = pathToFileURL(join(ROOT, 'src/mjs-ws/bridge.ts')).href
    const code   = [
      `const { resolveBridgeOptions } = await import(${JSON.stringify(module)})`,
      'const avertissements = []',
      'console.warn = (...args) => { avertissements.push(args.join(" ")) }',
      'resolveBridgeOptions({ secret: "un-secret-de-pont-bien-plus-long-que-trente-deux-caracteres" }, 8080)',
      'const court = resolveBridgeOptions({ secret: "abcd" }, 8080)',
      'resolveBridgeOptions({ secret: "court-aussi", webhooks: { url: "http://127.0.0.1:9/h", events: ["connect"], secret: "encore-court" } }, 8080)',
      'process.stdout.write(JSON.stringify({ avertissements, secret: court.secret }))',
    ].join('\n')
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 20000 })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout)
    assert.equal(out.secret, 'abcd')
    assert.equal(out.avertissements.length, 1, JSON.stringify(out.avertissements))
    assert.match(out.avertissements[0], /32/)
    assert.doesNotMatch(out.avertissements[0], /abcd/, 'le secret lui-même ne paraît jamais dans le message')
  })
})
