// `µsnap` passé comme valeur (`$liste.map(µsnap)`) et `µraw` appelé par `?.` (`µraw?($liste)`) emmènent leur module au cœur, en
// développement comme en production (vraie construction, rendue dans happy-dom), comme un appel direct
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CAS: Array<[string, string, string]> = [
  ['snap-valeur', "'copies: ' + $liste.map(µsnap).length", 'copies: 2'],
  ['raw-optionnel', "'brut: ' + µraw?($liste).length", 'brut: 2'],
]
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod', minify: false }]]
const source = (expr: string) => `<script>
  $liste = [{ a: 1 }, { a: 2 }]
  @appeler = ->
    try
      ${expr}
    catch e
      'erreur: ' + e.message
</script>
<p class="etat">{$liste.length}</p>
`

async function essai(nom: string, expr: string, opts: any): Promise<string> {
  const root   = mjsTmp(`runes-rares-${nom}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${nom}.mjs`), source(expr))
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const code  = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  try {
    window.eval(code)
    window.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
    const comp = window.document.querySelector(`mjs-${nom}`)
    const fin  = Date.now() + 5000
    while (!comp._shadow?.querySelector('.etat')?.textContent && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    assert.ok(comp._shadow?.querySelector('.etat'), 'le composant doit se monter')
    return String(comp.appeler())
  }
  finally {
    window.close()
  }
}

describe('µsnap pris comme valeur, µraw appelé par ?. : leur module entre au cœur', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [nom, expr, attendu] of CAS) {
    for (const [reglage, opts] of REGLAGES) it(`${nom}, ${reglage}`, async () => {
      assert.equal(await essai(nom, expr, opts), attendu)
    })
  }
})
