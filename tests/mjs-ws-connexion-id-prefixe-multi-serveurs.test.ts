// core.ts — les identifiants de connexion (c1, c2…) se répétaient d'un serveur à l'autre : en mode
// multi-serveurs (pont OU adaptateur présent), l'id doit être préfixé par un identifiant d'instance
// aléatoire pour rester unique cluster-wide ; en serveur unique, le format historique ne change pas.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter } from '../src/mjs-ws/adapter.js'
import type { MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function firstClientId(opts: MjsWsOptions): Promise<string> {
  const transport = new MemoryTransport()
  let capturedId = ''
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, welcome: (c) => { capturedId = c.id; return {} }, ...opts })
  await app.listen()
  const ws = transport.connect({ url: 'memory://id-probe' })
  await new Promise<void>(r => { ws.onopen = () => r() })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await tick(20)
  await app.stop()
  return capturedId
}

describe('MJS-WS — core.ts, identifiant de connexion préfixé en mode multi-serveurs', () => {
  it('serveur unique (ni pont ni adaptateur) : format historique INCHANGÉ ("c<n>")', async () => {
    const id = await firstClientId({})
    assert.match(id, /^c\d+$/, 'aucun préfixe — zéro octet de différence pour le déploiement le plus courant')
  })

  it('adaptateur présent : id préfixé par un identifiant d\'instance — deux instances, deux préfixes distincts', async () => {
    const idA = await firstClientId({ adapter: new MemoryAdapter() })
    const idB = await firstClientId({ adapter: new MemoryAdapter() })
    const mA = idA.match(/^(.+)\.c\d+$/)
    const mB = idB.match(/^(.+)\.c\d+$/)
    assert.ok(mA, `id préfixé attendu ("<instance>.c<n>"), reçu ${idA}`)
    assert.ok(mB, `id préfixé attendu ("<instance>.c<n>"), reçu ${idB}`)
    assert.notEqual(mA![1], mB![1], 'préfixes distincts — deux instances ne peuvent plus collisionner sur le même id nu')
  })

  it('pont universel SEUL (sans adaptateur) : id AUSSI préfixé — même défense, deux instances indépendantes', async () => {
    const idA = await firstClientId({ bridge: { port: 0, secret: 'secret-test-multiserveur-1234567890' } })
    const idB = await firstClientId({ bridge: { port: 0, secret: 'secret-test-multiserveur-1234567890' } })
    const mA = idA.match(/^(.+)\.c\d+$/)
    const mB = idB.match(/^(.+)\.c\d+$/)
    assert.ok(mA, `id préfixé attendu, reçu ${idA}`)
    assert.ok(mB, `id préfixé attendu, reçu ${idB}`)
    assert.notEqual(mA![1], mB![1], 'préfixes distincts')
  })
})
