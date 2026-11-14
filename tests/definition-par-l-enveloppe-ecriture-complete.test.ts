// `Object.defineProperty` par l'enveloppe d'une variable suivie (`Object.defineProperty($sel, 'n', …)`, `$sel` passé à une
// fonction) est une écriture complète, comme `$sel.n = 5` : la valeur, les valeurs dérivées qui la lisent et l'écran suivent
// aussitôt, sans autre écriture du composant — une donnée, un élément de liste, un accesseur ; avec la précision (défaut) et à
// l'horloge (`derived: "clock"`), en développement et en production ; happy-dom, Chromium, Firefox et WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
$sel = { n: 1, l: [1, 2] }
$double = $sel.n * 2
$noms = $sel.l.map((x) -> x * $sel.n).join(',')
@donnee = -> Object.defineProperty($sel, 'n', {value: 5, writable: true, enumerable: true, configurable: true})
@element = -> Object.defineProperty($sel.l, 0, {value: 7, writable: true, enumerable: true, configurable: true})
@accesseur = -> Object.defineProperty($sel, 'n', {get: (-> window.__acc), enumerable: true, configurable: true})
</script>
<p class="n">{$sel.n}</p>
<p class="d">{$double}</p>
<p class="m">{$noms}</p>
`
// la valeur lue sur l'état, puis l'écran, après chaque définition
const SCENARIO = `(async () => {
  const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms))
  const el = document.createElement('mjs-def-env')
  document.body.appendChild(el)
  const fin = Date.now() + 4000
  while (!el._shadow?.querySelector('.m') && Date.now() < fin) await pause(10)
  await pause()
  const releve = () => [el._state.sel.n, el._state.double, el._state.noms].join(' ') + ' | écran ' + ['n', 'd', 'm'].map((c) => el._shadow.querySelector('.' + c).textContent).join(' ')
  const R = { depart: releve() }
  el.donnee(); await pause()
  R.donnee = releve()
  el.element(); await pause()
  R.element = releve()
  window.__acc = 3
  el.accesseur(); await pause()
  R.accesseur = releve()
  return R
})()`
const ATTENDU = {
  depart: '1 2 1,2 | écran 1 2 1,2',
  donnee: '5 10 5,10 | écran 5 10 5,10',
  element: '5 10 35,10 | écran 5 10 35,10',
  accesseur: '3 6 21,6 | écran 3 6 21,6',
}

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('definition-enveloppe')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'def-env.mjs'), SOURCE)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: precise ? 'precise' : 'clock' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('Object.defineProperty par l\'enveloppe d\'une variable suivie : une écriture complète, valeur et écran à jour', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const precise of [true, false]) {
    for (const prod of [false, true]) {
      describe((precise ? 'précision (défaut)' : 'horloge') + ', ' + (prod ? 'production' : 'développement'), function () {
        let code: string
        before(async () => { code = await construire(prod, precise) })
        it('happy-dom : donnée, élément de liste et accesseur définis par la variable', async () => {
          const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
          window.eval(code)
          const r = JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
          await window.happyDOM.close()
          assert.deepEqual(r, ATTENDU)
        })
        if (!prod) return
        for (const moteur of ['chromium', 'firefox', 'webkit']) {
          it(`${moteur} : donnée, élément de liste et accesseur définis par la variable`, async function () {
            const playwright: any = await import('playwright')
            if (!existsSync(playwright[moteur].executablePath())) return this.skip()
            const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
            try {
              const page = await browser.newPage()
              const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
              await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
              await page.goto('http://mjs.test/')
              assert.deepEqual(await page.evaluate(SCENARIO), ATTENDU)
            }
            finally {
              await browser.close()
            }
          })
        }
      })
    }
  }
})
