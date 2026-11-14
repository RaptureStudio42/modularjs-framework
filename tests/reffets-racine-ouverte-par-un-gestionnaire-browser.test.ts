// En production, trois moteurs. Une racine `µeffect.root` ouverte par un gestionnaire du gabarit qui rend sa fonction d'arrêt (racine
// écrite directement dans le gestionnaire, affectée, ou rendue par une méthode appelée : `{@ouvrir()}`) reste ouverte : le routeur des
// événements n'appelle pas une fonction d'arrêt née pendant le passage du gestionnaire, comme celle de `µon` ou de `µafter`. Rangée puis
// rendue par un clic suivant (`@click={arret}`), elle arrête la racine. Les formes qui ne rendent rien (flèche, `void`, méthode citée)
// marchent comme avant
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// chaque racine compte les passages de son reffet, qui lit le magasin
const COMPOSANT = `<script>
vu = (k, v) ->
  window.__n[k] = (window.__n[k] or 0) + 1
  window.__v[k] = v
salon = new µStore(v: 0)
arretRange = null
@ouvrir = -> @arret = µeffect.root -> µeffect -> vu('appel', salon.data.v)
@ouvrirCitee = -> @arretCitee = µeffect.root -> µeffect -> vu('citee', salon.data.v)
@ecrire = (v) -> salon.data.v = v
</script>
<button class="directe" @click={µeffect.root -> µeffect -> vu('directe', salon.data.v)}>a</button>
<button class="affectee" @click={arretRange = µeffect.root -> µeffect -> vu('affectee', salon.data.v)}>b</button>
<button class="appel" @click={@ouvrir()}>c</button>
<button class="citee" @click=@ouvrirCitee>d</button>
<button class="fleche" @click={-> @arretFleche = µeffect.root -> µeffect -> vu('fleche', salon.data.v)}>e</button>
<button class="vide" @click={void (@arretVide = µeffect.root -> µeffect -> vu('vide', salon.data.v))}>f</button>
<button class="arreter" @click={arretRange}>g</button>
<p>{salon.data.v}</p>
`

const SCENARIO = `
  const clic = (k) => (el('rg')._shadow || el('rg')).querySelector('button.' + k).click()
  await pas('clics d\\'ouverture', () => { for (const k of ['directe', 'affectee', 'appel', 'citee', 'fleche', 'vide']) clic(k) })
  await pas('écriture du magasin', () => el('rg').ecrire(1))
  R.push(['valeurs lues', Object.keys(window.__v).sort().map((k) => k + '=' + window.__v[k]).join(' ')])
  await pas('arrêt rendu par un clic suivant, puis écriture', () => { clic('arreter'); el('rg').ecrire(2) })
  await pas('arrêts appelés, puis écriture', () => { for (const k of ['arret', 'arretCitee', 'arretFleche', 'arretVide']) el('rg')[k](); el('rg').ecrire(3) })
`
const TOUS = { directe: 1, affectee: 1, appel: 1, citee: 1, fleche: 1, vide: 1 }
const ATTENDU = [
  ['clics d\'ouverture', TOUS],
  ['écriture du magasin', TOUS],
  ['valeurs lues', 'affectee=1 appel=1 citee=1 directe=1 fleche=1 vide=1'],
  ['arrêt rendu par un clic suivant, puis écriture', { directe: 1, appel: 1, citee: 1, fleche: 1, vide: 1 }],
  ['arrêts appelés, puis écriture', { directe: 1 }],
]

let construit: Promise<Buffer> | null = null
const construire = (): Promise<Buffer> => construit ??= (async () => {
  const root   = mjsTmp('reffets-racine-gestionnaire')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'rg.mjs'), COMPOSANT)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: true } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'))
})()

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`µeffect.root ouverte par un gestionnaire du gabarit (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })
  it('la racine reste ouverte jusqu\'à son arrêt, passages comptés pas à pas', async () => {
    const bundle  = await construire()
    const page    = await browser.newPage()
    const erreurs: string[] = []
    try {
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (chemin === '/out/bundle.js') { await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-rg></mjs-rg><script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>' })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      const vus = await page.evaluate(`(async () => {
        const el  = (n) => document.querySelector('mjs-' + n)
        const t   = () => new Promise((r) => setTimeout(r, 0))
        const fin = Date.now() + 6000
        while (!(el('rg') && (el('rg')._shadow || el('rg')).querySelector('p')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const R = []
        const pas = async (nom, geste) => {
          for (const k in window.__n) window.__n[k] = 0
          geste()
          await t()
          await t()
          const vu = {}
          for (const k in window.__n) if (window.__n[k] !== 0) vu[k] = window.__n[k]
          R.push([nom, vu])
        }
        ${SCENARIO}
        return R
      })()`)
      assert.deepEqual(vus, ATTENDU)
      assert.deepEqual(erreurs, [])
    }
    finally {
      await page.close()
    }
  })
})
