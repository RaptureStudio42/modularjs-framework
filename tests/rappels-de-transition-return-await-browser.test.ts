// Chromium, Firefox et WebKit, construction de développement et de production avec le réglage `proxy: false` : un rappel de transition
// qui sort tôt (`return unless $v`) écrit encore l'état après ce `return`, et la page le montre ; un rappel qui attend (`await`) écrit
// après son attente. Moteur absent de la machine : ses tests se sautent

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const RAPPELS = `<script>
$v = false
$x = 'attente'
$a = 'attente'
</script>
<button class="montrer" @click={$v = true}>montrer</button>
{if $v}
  <p class="anim" :transition=*fade(duration: 60ms) @introstart={await Promise.resolve(); $a = 'attendu'} @introend={
    return unless $v
    $x = 'intro'
  }>x</p>
{end}
<p class="x">{$x}</p>
<p class="a">{$a}</p>
`

const MODES = [['développement', { env: 'dev', js: 'split' }], ['production, proxy: false', { env: 'prod', js: 'bundle', proxy: false }]] as const

async function construire(mode: string, opts: Record<string, unknown>): Promise<Map<string, Buffer>> {
  const root = mjsTmp(`rappels-return-await-${mode}`)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'rappels.mjs'), RAPPELS)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

describe('rappels de transition : écriture après un `return`, rappel qui attend (trois moteurs)', function () {
  this.timeout(180000)
  const constructions = new Map<string, Map<string, Buffer>>()

  before(async () => {
    for (const [mode, opts] of MODES) constructions.set(mode, await construire(mode.replace(/\W+/g, '-'), opts))
  })
  after(() => terminateSharedWorkerPool())

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    describe(moteur, function () {
      let browser: any

      before(async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) return this.skip()
        browser = await playwright[moteur].launch()
      })
      after(async () => {
        if (browser) await browser.close()
      })

      for (const [mode] of MODES) {
        it(`${mode} : le rappel écrit après \`return unless $v\` et après \`await\``, async () => {
          const fichiers = constructions.get(mode)!
          const page     = await browser.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e?.message ?? e)))
          await page.route('http://rappels.test/**', async (route: any) => {
            const url = new URL(route.request().url())
            if (!url.pathname.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><mjs-rappels></mjs-rappels><script type="module" src="/out/bundle.js"></script></body>' })
            const corps = fichiers.get(url.pathname.slice(5))
            return corps ? route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps }) : route.fulfill({ status: 404, body: '' })
          })
          await page.goto('http://rappels.test/page')
          const ombre = (sel: string) => `(() => { const e = document.querySelector('mjs-rappels'); const r = e && (e._shadow || e.shadowRoot || e); return r ? r.querySelector('${sel}') : null })()`
          await page.waitForFunction(`!!${ombre('.montrer')}`, null, { timeout: 30000 })
          await page.evaluate(`${ombre('.montrer')}.click()`)
          await page.waitForFunction(`${ombre('.x')}.textContent === 'intro' && ${ombre('.a')}.textContent === 'attendu'`, null, { timeout: 10000 }).catch(() => {})
          const x = await page.evaluate(`${ombre('.x')}.textContent`)
          const a = await page.evaluate(`${ombre('.a')}.textContent`)
          await page.close()
          assert.deepEqual(erreurs, [])
          assert.equal(x, 'intro', 'l\'écriture qui suit `return unless $v` dans `@introend`')
          assert.equal(a, 'attendu', 'l\'écriture qui suit `await` dans `@introstart`')
        })
      }
    })
  }
})
