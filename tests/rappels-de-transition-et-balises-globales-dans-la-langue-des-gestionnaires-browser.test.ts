// Chromium, construction de développement et de production (avec et sans le réglage `proxy: false`) : un rappel de transition écrit
// en Civet (`t := …`, `if` en fin de ligne, plusieurs lignes) tourne à la fin de l'intro et la page le montre ; un composant au script
// JavaScript reçoit les événements de `<@window>` et `<@document>`, ses gestionnaires écrits dans la langue des gestionnaires.
// Chromium absent de la machine : le test se saute

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const RAPPEL = `<script>
$v = false
$fin = 'attente'
$debut = 0
</script>
<button class="montrer" @click={$v = true}>montrer</button>
{if $v}
  <p class="anim" :transition=*fade(duration: 60ms) @introstart={d := 2; $debut = d if $v} @introend={
    t := $debut + 1
    $fin = "intro #{t}" if $v
  }>x</p>
{end}
<p class="fin">{$fin}</p>
`

const FENETRE = `<script lang="js">
$n = 0;
$k = '';
</script>
<@window @resize={$n++} />
<@document @keydown={k := e.key; $k = k} />
<p class="n">{$n}</p>
<p class="k">{$k}</p>
`

async function construire(mode: string, opts: Record<string, unknown>): Promise<Map<string, Buffer>> {
  const root = mjsTmp(`rappels-globales-${mode}`)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'rappel.mjs'), RAPPEL)
  writeFileSync(join(src, 'fenetre.mjs'), FENETRE)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

describe('rappels de transition en Civet et <@window> d\'un script JavaScript : Chromium', function () {
  this.timeout(120000)
  let browser: any

  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) return this.skip()
    browser = await playwright.chromium.launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [mode, opts] of [['développement', { env: 'dev', js: 'split' }], ['production', { env: 'prod', js: 'bundle' }], ['production, proxy: false', { env: 'prod', js: 'bundle', proxy: false }]] as const) {
    it(`${mode} : le rappel en Civet tourne, <@window> et <@document> écoutent`, async () => {
      const fichiers = await construire(mode.replace(/\W+/g, '-'), opts)
      const page     = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e?.message ?? e)))
      await page.route('http://rappels.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><mjs-rappel></mjs-rappel><mjs-fenetre></mjs-fenetre><script type="module" src="/out/bundle.js"></script></body>' })
        const corps = fichiers.get(url.pathname.slice(5))
        return corps ? route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps }) : route.fulfill({ status: 404, body: '' })
      })
      await page.goto('http://rappels.test/page')
      const ombre = (nom: string, sel: string) => `(() => { const e = document.querySelector('mjs-${nom}'); const r = e && (e._shadow || e.shadowRoot || e); return r ? r.querySelector('${sel}') : null })()`
      await page.waitForFunction(`!!${ombre('rappel', '.montrer')} && !!${ombre('fenetre', '.n')}`, null, { timeout: 30000 })
      await page.evaluate(`${ombre('rappel', '.montrer')}.click()`)
      await page.waitForFunction(`${ombre('rappel', '.fin')}.textContent === 'intro 3'`, null, { timeout: 10000 }).catch(() => {})
      const fin = await page.evaluate(`${ombre('rappel', '.fin')}.textContent`)
      await page.evaluate('window.dispatchEvent(new Event(\'resize\')); window.dispatchEvent(new Event(\'resize\')); document.dispatchEvent(new KeyboardEvent(\'keydown\', { key: \'q\' }))')
      await page.waitForFunction(`${ombre('fenetre', '.n')}.textContent === '2' && ${ombre('fenetre', '.k')}.textContent === 'q'`, null, { timeout: 5000 }).catch(() => {})
      const n = await page.evaluate(`${ombre('fenetre', '.n')}.textContent`)
      const k = await page.evaluate(`${ombre('fenetre', '.k')}.textContent`)
      await page.close()
      assert.deepEqual(erreurs, [])
      assert.equal(fin, 'intro 3', 'le rappel `@introend` écrit en Civet a tourné')
      assert.equal(n, '2', '<@window @resize> d\'un script JavaScript')
      assert.equal(k, 'q', '<@document @keydown> d\'un script JavaScript')
    })
  }
})
