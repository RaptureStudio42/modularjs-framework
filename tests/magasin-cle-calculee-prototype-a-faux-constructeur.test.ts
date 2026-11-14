// magasin `$$` — écriture par une clé calculée `'__proto__'` dans un élément trouvé dont le prototype porte un faux
// `constructor` (`P.constructor = { prototype: P }`, un objet, pas une fonction) : la clé est refusée avec son
// avertissement, puis l'écriture lève l'erreur de JavaScript sur `undefined`, comme sans MJS. Le contrôle des fonctions
// du navigateur ne lit qu'une fonction : un `constructor` qui n'en est pas une n'y passe jamais (sinon `TypeError:
// Function.prototype.toString requires that 'this' be a Function`, sans avertissement). Avec l'enveloppe et avec
// `"proxy": false`, en développement et en production (construction non minifiée : les noms restent lisibles ; la production retire
// l'avertissement, le refus reste)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
  $$objs = window.__objs
  @cleCalc = (k) -> $$objs.find((x) -> x.id == 1)[k].x = 5
</script>
<p class="etat">{$$objs.length}</p>
`

const PREP = 'var P = {}; P.constructor = { prototype: P }; window.__objs = [Object.assign(Object.create(P), { id: 1 })];'

async function construire(prefixe: string, proxy: boolean, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'faux-ctor.mjs'), SOURCE)
  const base: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(prod ? { env: 'prod', minify: false } : {}) }
  const bundler   = new Bundler(proxy ? base : { ...base, proxy: false })
  const stats     = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('magasin — clé calculée `__proto__` vers un prototype au faux `constructor` : refusée, avertie, jamais une erreur du contrôle des fonctions du navigateur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [prod, proxy] of [[false, true], [false, false], [true, true], [true, false]]) {
    it(`${prod ? 'production' : 'développement'}, ${proxy ? 'avec l\'enveloppe' : '"proxy": false'}`, async () => {
      const code   = await construire(`faux-ctor-${prod ? 'prod' : 'dev'}-${proxy ? 'p' : 'sp'}`, proxy, prod)
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(PREP)
        window.eval(`${code}\nglobalThis.µ = µ;`)
        const avis: string[] = []
        window.µ.warn = (m: string) => avis.push(String(m))
        window.document.body.innerHTML = '<mjs-faux-ctor></mjs-faux-ctor>'
        const comp = window.document.querySelector('mjs-faux-ctor')
        const fin  = Date.now() + 5000
        while (!comp._shadow?.querySelector('.etat')?.textContent && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        let err = ''
        try { comp.cleCalc('__proto__') } catch (e: any) { err = `${e?.name}: ${e?.message}` }
        assert.ok(!/Function\.prototype\.toString/.test(err), `le contrôle des fonctions du navigateur ne lit pas un \`constructor\` qui n'est pas une fonction : ${err}`)
        assert.match(err, /^TypeError: Cannot set properties of undefined/, 'l\'erreur de JavaScript sur la clé refusée, comme sans MJS')
        if (!prod) assert.ok(avis.some((m) => m.includes('« __proto__ »')), `la clé refusée est avertie : ${JSON.stringify(avis)}`)
        let direct = ''
        try { direct = String(window.eval('String(µ._mjs_storeCle(window.__objs[0], "__proto__"))')) } catch (e: any) { direct = `${e?.name}: ${e?.message}` }
        assert.equal(direct, 'undefined', 'µ._mjs_storeCle refuse la clé sans lever')
      }
      finally {
        window.close()
      }
    })
  }
})
