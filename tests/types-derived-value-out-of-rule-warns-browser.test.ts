// Types — une variable dérivée réglée dans le <vars> qui sort de sa règle, au navigateur réel (mode strict) : en développement, la
// console l'avertit au premier calcul, pour une valeur à l'horloge (`$total = $a * 2`) comme pour une valeur précise (`$many`, une
// méthode de liste) et pour un objet sous `bool`, sans toucher la valeur affichée ; revenue dans sa règle puis ressortie, de nouveau.
// En production (un seul fichier, minifié), aucun avertissement, la même valeur. Le mode de développement est celui que pose le
// manifeste de la construction. Le détail des cas : types-derived-value-out-of-rule-warns-in-development.test.ts
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCE = `<vars>
  $total  int 0..100
  $flag   bool
  $many   int 0..1
</vars>

<script>
  $a     = 80
  $obj   = { x: 1 }
  $list  = [1, 2]
  $total = $a * 2
  $flag  = $obj
  $many  = $list.filter((x) -> x > 0).length
</script>

<p id="t">{$total}</p>
<p id="f">{JSON.stringify($flag)}</p>
<p id="m">{$many}</p>
<button id="in" @click={$a = 30}>in</button>
<button id="out" @click={$a = 90}>out</button>
`

// le build de développement en fichiers séparés, collés en un script, suivi du mode que pose son manifeste
async function compileDevelopment(): Promise<string> {
  const root   = mjsTmp('derived-rule-browser-dev')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'main.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const mode = readFileSync(join(root, 'bundle.js'), 'utf-8').match(/µ\._typesMode = [^;]+;/)
  assert.ok(mode, 'the development manifest sets the types mode')
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
  return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\n' + mode[0]
}

// le build de production en un seul fichier, minifié, cœur réduit à ce que l'appli lit
async function compileProduction(): Promise<string> {
  const root = mjsTmp('derived-rule-browser-prod')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.mjs'), SOURCE)
  const out     = join(root, 'dist')
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/dist', forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(out, 'bundle.js'), 'utf-8')
}

const said = (warnings: string[], k: string) => warnings.filter((w) => w.includes(`La variable dérivée « $${k} » du composant <mjs-main> sort de sa règle`))

describe('a derived variable that leaves its rule, in a real browser', function () {
  this.timeout(120000)
  const scripts: Record<string, { script: string, module: boolean }> = {}

  before(async () => {
    scripts.development = { script: await compileDevelopment(), module: false }
    scripts.production  = { script: await compileProduction(), module: true }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of MOTEURS) {
    for (const mode of ['development', 'production']) {
      it(`${nom}, ${mode}: the value stays the one of the calculation; ${mode === 'development' ? 'the console says it, once while outside, again after a return' : 'no warning'}`, async function () {
        if (!await moteurPresent(nom)) this.skip()
        const playwright: any = await import('playwright')
        const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        try {
          const page = await browser.newPage()
          const erreurs: string[] = []
          const warnings: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'warn') warnings.push(m.text()) })
          const { script, module } = scripts[mode]
          const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-main></mjs-main><script${module ? ' type="module" src="/dist/bundle.js">' : '>' + script}</script></body></html>`
          await page.route('http://mjs.test/**', (route: any) => {
            const url = route.request().url()
            if (url.endsWith('/dist/bundle.js')) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: script })
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
          })
          await page.goto('http://mjs.test/')
          const lire = (id: string) => page.evaluate((id: string) => {
            const hote = document.querySelector('mjs-main') as any
            const racine = hote && (hote._shadow || hote.shadowRoot || hote)
            const p = racine && racine.querySelector('#' + id)
            return p ? p.textContent : null
          }, id)
          const cliquer = (id: string) => page.evaluate((id: string) => {
            const hote = document.querySelector('mjs-main') as any
            const racine = hote && (hote._shadow || hote.shadowRoot || hote)
            racine.querySelector('#' + id).click()
          }, id)
          await page.waitForFunction(() => {
            const hote = document.querySelector('mjs-main') as any
            const racine = hote && (hote._shadow || hote.shadowRoot || hote)
            const p = racine && racine.querySelector('#m')
            return !!(p && p.textContent)
          }, null, { timeout: 15000 })
          assert.equal(await lire('t'), '160')
          assert.equal(await lire('f'), '{"x":1}')
          assert.equal(await lire('m'), '2')
          await cliquer('in')
          await page.waitForFunction(() => (((h: any) => h && (h._shadow || h.shadowRoot || h))(document.querySelector('mjs-main')))?.querySelector('#t')?.textContent === '60', null, { timeout: 5000 })
          await cliquer('out')
          await page.waitForFunction(() => (((h: any) => h && (h._shadow || h.shadowRoot || h))(document.querySelector('mjs-main')))?.querySelector('#t')?.textContent === '180', null, { timeout: 5000 })
          assert.deepEqual(erreurs, [])
          if (mode === 'development') {
            assert.equal(said(warnings, 'total').length, 2, warnings.join('\n'))
            assert.ok(said(warnings, 'total')[0].includes('$total vaut 160 — permis : int 0..100'), said(warnings, 'total')[0])
            assert.ok(said(warnings, 'total')[1].includes('$total vaut 180'), said(warnings, 'total')[1])
            assert.equal(said(warnings, 'flag').length, 1, warnings.join('\n'))
            assert.equal(said(warnings, 'many').length, 1, warnings.join('\n'))
          }
          else assert.deepEqual(warnings.filter((w) => w.includes('sort de sa règle') || w.includes('is outside its rule')), [])
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
