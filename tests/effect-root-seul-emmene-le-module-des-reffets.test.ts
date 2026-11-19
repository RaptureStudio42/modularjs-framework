// `µeffect.root` dans une appli qui n'écrit aucun `µeffect` : le module des reffets entre au cœur avec sa racine, en développement comme
// en production (vraie construction, rendue dans happy-dom) ; la racine rend sa main d'arrêt
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
  $n = 1
  @appeler = ->
    try
      fin = µeffect.root -> 1
      'racine: ' + typeof fin
    catch e
      'erreur: ' + e.message
</script>
<p class="etat">{$n}</p>
`
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod', minify: false }]]

async function essai(opts: any): Promise<string> {
  const root   = mjsTmp('racine-seule')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'racine-seule.mjs'), SOURCE)
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
    window.document.body.innerHTML = '<mjs-racine-seule></mjs-racine-seule>'
    const comp = window.document.querySelector('mjs-racine-seule')
    const fin  = Date.now() + 5000
    while (!comp._shadow?.querySelector('.etat')?.textContent && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    assert.ok(comp._shadow?.querySelector('.etat'), 'le composant doit se monter')
    return String(comp.appeler())
  }
  finally {
    window.close()
  }
}

describe('µeffect.root sans aucun µeffect : le module des reffets entre au cœur', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [nom, opts] of REGLAGES) it(nom, async () => {
    assert.equal(await essai(opts), 'racine: function')
  })
})
