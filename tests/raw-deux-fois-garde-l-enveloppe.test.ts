// `µraw($vus)` rend la vraie collection d'une `WeakMap` de l'état sans la marquer : `$vus` garde son enveloppe, et ses écritures
// redessinent. `µraw` d'une valeur déjà brute la rend telle quelle : `µraw(µraw($vus))` ne marque pas non plus la collection, l'écran
// suit encore `$vus.set(…)`, en développement comme en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(composants: Record<string, string>, prod: boolean): Promise<string> {
  const root   = mjsTmp('raw-deux-fois')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function jouer(code: string, scenario: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  const r = JSON.parse(JSON.stringify(await window.eval(scenario)))
  await window.happyDOM.close()
  return r
}

const VUS = `<script>
k = {}
wm = new WeakMap([[k, 'a']])
$vus = wm
@une = -> String(µraw($vus) is wm)
@deux = -> String(µraw(µraw($vus)) is wm)
@w = (x) -> $vus.set(k, x)
</script>
<p class="v">{$vus.get(k)}</p>
`
const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.body.appendChild(document.createElement('mjs-co-vus'))
  await attendre(() => el._shadow && el._shadow.querySelector('.v'))
  await pause(60)
  const ecran = () => el._shadow.querySelector('.v').textContent
  const R = [ecran(), el.une()]
  el.w('z')
  await pause(60)
  R.push(ecran(), el.deux())
  el.w('y')
  await pause(60)
  R.push(ecran())
  return R
})()`

describe('µraw d\'une valeur déjà brute la rend telle quelle : `µraw(µraw($vus))` garde l\'enveloppe de `$vus`', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    it((prod ? 'production' : 'développement') + ' : l\'écran suit `$vus.set(…)` après `µraw(µraw($vus))`', async () => {
      const code = await construire({ 'co-vus': VUS }, prod)
      assert.deepEqual(await jouer(code, SCENARIO), ['a', 'true', 'z', 'true', 'y'])
    })
  }
})
