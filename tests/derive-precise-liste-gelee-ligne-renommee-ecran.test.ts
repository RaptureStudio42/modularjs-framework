// Liste gelée par l'application (données immuables), une ligne choisie (`$sel = $rows[1]`) puis renommée par le composant
// (`$sel.nom = 'Zoé'`) : une écriture faite par MJS, sur un objet que la liste rend tel quel (élément figé). La liste des
// noms, valeur précise, suit sans `µrefresh`, à la lecture comme à l'écran : « Ana, Zoé / Zoé ». Avec l'enveloppe (le
// défaut) et avec `"proxy": false`, en développement et en production ; happy-dom, puis Chromium, Firefox et WebKit en
// production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
$rows = []
$noms = $rows.map((r) -> r.nom).join(', ')
$sel = {nom: ''}
@charger = (data) -> $rows = Object.freeze(data)
@choisir = (i) -> $sel = $rows[i]
@renommer = (n) -> $sel.nom = n
@lire = -> $noms
</script>
<p class="v">{$noms + ' / ' + $sel.nom}</p>
`

// avertissements du cœur, relevés avant son chargement
const RELEVE = `window.__W = [];
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const el = document.createElement('mjs-gelee')
  document.body.appendChild(el)
  await attendre(() => el._shadow?.querySelector('.v'))
  await pause(100)
  const txt = () => el._shadow.querySelector('.v').textContent
  el.charger([{ nom: 'Ana' }, { nom: 'Bob' }])
  await pause(60)
  el.choisir(1)
  await pause(60)
  const avant = [el.lire(), txt()]
  el.renommer('Zoé')
  await pause(60)
  return { avant, apres: [el.lire(), txt()], avertissements: window.__W.filter((w) => w.includes('a servi son dernier calcul')) }
})()`

async function construire(prod: boolean, proxy: boolean): Promise<string> {
  const root   = mjsTmp('gelee')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gelee.mjs'), SOURCE)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (!proxy) opts.proxy = false
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

function verifier(r: any, ou: string) {
  assert.deepEqual(r.avant, ['Ana, Bob', 'Ana, Bob / Bob'], ou)
  assert.deepEqual(r.apres, ['Ana, Zoé', 'Ana, Zoé / Zoé'], ou)
  assert.deepEqual(r.avertissements, [], ou)
}

const nomMode = (proxy: boolean) => proxy ? 'enveloppe' : '"proxy": false'

describe('valeur précise : liste gelée, ligne choisie puis renommée par le composant, l\'écran suit', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  const prods: Record<string, string> = {}
  for (const proxy of [true, false]) {
    for (const prod of [false, true]) {
      it(`happy-dom, ${nomMode(proxy)}, ${prod ? 'production' : 'développement'}`, async () => {
        const code = await construire(prod, proxy)
        if (prod) prods[nomMode(proxy)] = code
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(RELEVE)
        window.eval(code)
        const r = JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
        await window.happyDOM.close()
        verifier(r, nomMode(proxy))
      })
    }
  }

  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur}, production, avec l'enveloppe et sans`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      try {
        for (const proxy of [true, false]) {
          const code = prods[nomMode(proxy)] ??= await construire(true, proxy)
          const page = await browser.newPage()
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${RELEVE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
          await page.route('http://mjs.test/**', (rt: any) => rt.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
          await page.goto('http://mjs.test/')
          verifier(await page.evaluate(SCENARIO), moteur + ', ' + nomMode(proxy))
          await page.close()
        }
      }
      finally {
        await browser.close()
      }
    })
  }
})
