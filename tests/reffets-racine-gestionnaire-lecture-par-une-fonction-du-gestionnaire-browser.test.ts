// Une racine µeffect.root écrite dans un gestionnaire du gabarit suit une variable lue par une fonction écrite dans ce gestionnaire, hors
// de la racine (`lire = (-> $y); µeffect.root -> µeffect -> …`), ou par une fonction d'un {const} du gabarit, comme la même racine ouverte
// par une méthode du <script> suit la fonction écrite dans la méthode, et comme celle d'un gestionnaire de <@window>. Trois moteurs,
// production et développement, gabarit Civet (avec et sans l'enveloppe)
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// compte un passage et garde la valeur lue
const VU = 'vu = (k, v) ->\n  window.__n[k] = (window.__n[k] or 0) + 1\n  window.__v[k] = v\n'
const GM = `<script>
${VU}$x = 0
$y = 0
$l = [1]
@ouvrir = ->
  lire = -> $y
  µeffect.root -> µeffect -> vu('methode', [$x, lire()].join())
@ecrireY = (v) -> $y = v
</script>
<button class="hors" @click={lire = (-> $y); µeffect.root -> µeffect -> vu('gestionnaire', [$x, lire()].join())}>f</button>
<@window @sondefen={lire = (-> $y); µeffect.root -> µeffect -> vu('fenetre', [$x, lire()].join())}></@window>
{for n in $l}{const lireC = CONST}<button class="c" @click={µeffect.root -> µeffect -> vu('const du gabarit', [$x, lireC()].join())}>c</button>{end}
<p>{$x}</p>
`
const CAS: [string, boolean, boolean][] = [
  ['gabarit Civet', false, false],
  ['gabarit Civet, "proxy": false', false, true],
]
const construits = new Map<string, Promise<Buffer | string>>()
const construire = (env: string, js: boolean, withoutProxy: boolean): Promise<Buffer | string> => {
  const cle = `${env}-${js ? 'js' : 'civet'}-${withoutProxy ? 'sans' : 'avec'}`
  if (!construits.has(cle)) construits.set(cle, (async () => {
    const root   = mjsTmp('reffets-racine-fonction-du-gestionnaire-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'gm.mjs'), GM.replace('CONST', js ? '() => $y' : '-> $y'))
    const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: env === 'prod' }
    if (withoutProxy) opts.proxy = false
    const bundler = new Bundler(opts)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) return 'ERREURS ' + stats.errors.map((e: any) => String(e.message).slice(0, 300)).join(' | ')
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(cle)!
}
after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`µeffect.root d'un gestionnaire : lecture par une fonction du gestionnaire ou du gabarit (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })
  const jouer = async (bundle: Buffer, noms: string[], corps: string): Promise<{ vus: any, erreurs: string[] }> => {
    const page    = await browser.newPage()
    const erreurs: string[] = []
    try {
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (chemin === '/out/bundle.js') { await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${noms.map((n) => `<mjs-${n}></mjs-${n}>`).join('')}<script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>` })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      const vus = await page.evaluate(`(async () => {
        const el  = (n) => document.querySelector('mjs-' + n)
        const sh  = (n) => el(n)._shadow || el(n)
        const t   = () => new Promise((r) => setTimeout(r, 0))
        const fin = Date.now() + 6000
        while (!${JSON.stringify(noms)}.every((n) => el(n) && sh(n).querySelector('p')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const R = []
        const pas = async (nom, geste) => {
          for (const k in window.__n) window.__n[k] = 0
          geste()
          await t()
          await t()
          await new Promise((r) => setTimeout(r, 30))
          const vu = {}
          for (const k in window.__n) if (window.__n[k] !== 0) vu[k] = window.__n[k]
          R.push([nom, vu])
        }
        ${corps}
        return R
      })()`)
      return { vus, erreurs }
    }
    finally {
      await page.close()
    }
  }
  for (const [nom, js, withoutProxy] of CAS) for (const env of ['prod', 'dev']) it(`${nom}, ${env}`, async () => {
    const b = await construire(env, js, withoutProxy)
    if (typeof b === 'string') { console.log('    construction : ' + b); assert.fail(b) }
    const corps = `
      await pas('ouverture', () => { el('gm').ouvrir(); sh('gm').querySelector('button.hors').click(); sh('gm').querySelector('button.c').click(); window.dispatchEvent(new Event('sondefen')) })
      await pas('écriture de $y', () => el('gm').ecrireY(5))
    `
    const tous = { 'const du gabarit': 1, fenetre: 1, gestionnaire: 1, methode: 1 }
    const { vus, erreurs } = await jouer(b as Buffer, ['gm'], corps)
    assert.deepEqual(vus, [['ouverture', tous], ['écriture de $y', tous]])
    assert.deepEqual(erreurs, [])
  })
})
