// Proxy de décisions, cache court (`cache: { ttl }`) : la mémoire qu'il retient ne dépend pas de la taille des
// hellos. La clé est une empreinte de taille fixe du corps envoyé (hello et cookie) : un champ libre de 60 Ko
// répété sur des connexions successives ne s'accumule plus en mémoire. Une décision réécrite après péremption
// repart en queue : la purge par âge, qui s'arrête à la première entrée encore valable, continue de balayer les
// entrées périmées derrière elle. Le back est un `fetch` remplacé le temps du test, sans réseau.

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import { runInNewContext } from 'node:vm'
import { creerProxyDecision } from '../src/mjs-ws/proxy.js'

const SECRET = 'secret-du-cache-de-decision-assez-long'
const BACK   = 'http://127.0.0.1:9/decide'
const MO     = 1024 * 1024

// un ramasse-miettes complet, sans lancer node avec --expose-gc : le drapeau n'est levé que le temps de prendre la fonction
function collectGarbage(): void {
  v8.setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc')
  v8.setFlagsFromString('--no-expose-gc')
  gc()
}

function heapAfterGc(): number {
  collectGarbage()
  collectGarbage()
  return process.memoryUsage().heapUsed
}

// un back qui refuse tout ; `calls` compte les requêtes qui lui parviennent
async function withFakeBack(body: (calls: () => number) => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch
  let calls       = 0
  globalThis.fetch = (async () => { calls++; return new Response('{"ok":false}', { status: 200, headers: { 'content-type': 'application/json' } }) }) as typeof fetch
  try { await body(() => calls) }
  finally { globalThis.fetch = realFetch }
}

describe('proxy de décisions : mémoire du cache bornée', function () {
  this.timeout(20000)

  it('1000 hellos distincts de 60 Ko retiennent moins de 2 Mo, et le cache sert toujours', async () => {
    await withFakeBack(async (calls) => {
      const decide = creerProxyDecision({ url: BACK, secret: SECRET, cache: { ttl: 60000 } }, 'connect', (json: any) => !!(json && json.ok), () => {})
      await decide({ hello: { protocol: 1, chauffe: true } })
      const before = heapAfterGc()
      const pad    = 'x'.repeat(60000)
      for (let i = 0; i < 1000; i++) await decide({ hello: { protocol: 1, pad: pad + i } })
      const retained = heapAfterGc() - before
      assert.ok(retained < 2 * MO, `${(retained / MO).toFixed(1)} Mo retenus par 1000 entrées`)
      assert.equal(calls(), 1001)
      assert.equal(await decide({ hello: { protocol: 1, pad: pad + 0 } }), false)
      assert.equal(calls(), 1001, 'un hello déjà vu est servi par le cache, sans requête au back')
    })
  })

  it('une décision réécrite après péremption repart en queue : les entrées périmées derrière elle sont purgées', async () => {
    const realNow = Date.now
    let offset    = 0
    Date.now = () => realNow() + offset
    try {
      await withFakeBack(async (calls) => {
        // chaque décision porte un tableau qui lui est propre, ~100 Ko (une chaîne 'x'.repeat() partagerait ses morceaux)
        let n = 0
        const decide = creerProxyDecision({ url: BACK, secret: SECRET, cache: { ttl: 1000 } }, 'connect', () => ({ lest: new Array(12500).fill(n++) }), () => {})
        await decide({ k: 'chauffe' })
        const before = heapAfterGc()
        await decide({ k: 'A' })
        for (let i = 0; i < 200; i++) await decide({ k: 'B' + i })
        offset += 5000
        await decide({ k: 'A' })
        const retained = heapAfterGc() - before
        assert.ok(retained < 2 * MO, `${(retained / MO).toFixed(1)} Mo retenus : les 200 décisions périmées (100 Ko chacune) devaient partir`)
        assert.equal(calls(), 203)
        await decide({ k: 'A' })
        assert.equal(calls(), 203, 'la décision réécrite reste servie par le cache')
      })
    }
    finally { Date.now = realNow }
  })
})
