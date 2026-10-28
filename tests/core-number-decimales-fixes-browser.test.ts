// <@@number decimals="2"> dans Chromium, Firefox et WebKit réels : une page en français montre « 64,30 », une page en anglais « 64.30 »
// (le séparateur que le navigateur donne à la langue de la page) ; une frappe au clavier réel est arrondie aux deux décimales et remise
// au format de la langue à la sortie du champ ; sans `step`, le pas est d'un centième : la flèche ajoute 0,01 et le formulaire tient la
// valeur pour valide (sous un pas de 1, comme dans un champ nombre natif, « 64,30 » était hors du pas)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'dec-page.mjs': `<script>
  $p = 64.3
</script>
<form class="f" @noUJS>
  <@@number class="prix" name="prix" value=!{$p} decimals="2" min="0"></@@number>
</form>
<p class="vp">{$p}</p>
<button type="button" class="apres">après</button>
`
}

let construit: Promise<string> | null = null

// le build et le script concaténé, une seule fois pour les trois navigateurs
function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('number-decimales-fixes-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@number decimals> : format de la langue de la page, frappe et pas (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  let script  = ''
  const erreurs: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test des décimales fixes sauté`)
      return
    }
    script  = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  // une page neuve par langue : le script du build déclare ses noms au niveau global, une seconde écriture dans la même page les redéclarerait
  const charger = async (lang: string) => {
    erreurs.length = 0
    if (page) await page.close()
    page = await browser.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><mjs-dec-page></mjs-dec-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-dec-page') as any)?._shadow?.querySelector('.prix')?._shadow?.querySelector('input'))
    await page.evaluate(`window.__champ = () => document.querySelector('mjs-dec-page')._shadow.querySelector('.prix')._shadow.querySelector('input'); window.__lu = () => document.querySelector('mjs-dec-page')._shadow.querySelector('.vp').textContent; window.__valide = () => document.querySelector('mjs-dec-page')._shadow.querySelector('.f').checkValidity()`)
  }

  const montre = (): Promise<string> => page.evaluate(`__champ().value`)
  const lu     = (): Promise<string> => page.evaluate(`__lu()`)
  const valide = (): Promise<boolean> => page.evaluate(`__valide()`)

  // frappe au clavier réel dans le champ vidé, puis Tab pour en sortir vers le bouton qui suit (hors de la page, Firefox ne sort pas du champ)
  const frapper = async (texte: string) => {
    await page.evaluate(`(() => { const c = __champ(); c.focus(); c.select() })()`)
    await page.keyboard.type(texte)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(60)
  }

  for (const [lang, sep, tape] of [['fr', ',', '5,5'], ['en', '.', '5.5']] as const) {
    it(`page en ${lang === 'fr' ? 'français' : 'anglais'} : « 64${sep}30 », « ${tape} » tapé devient « 5${sep}50 », la flèche « 5${sep}51 », le formulaire reste valide`, async function () {
      if (!present) { this.skip(); return }
      await charger(lang)
      assert.equal(await montre(), `64${sep}30`)
      assert.equal(await lu(), '64.3', 'la variable liée garde le nombre')
      assert.equal(await valide(), true, 'sans `step`, le pas suit les décimales : 64,30 est dans le pas')
      await frapper(tape)
      assert.equal(await lu(), '5.5')
      assert.equal(await montre(), `5${sep}50`)
      await page.evaluate(`__champ().focus()`)
      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(60)
      assert.equal(await lu(), '5.51', 'la flèche avance d\'un centième')
      assert.equal(await montre(), `5${sep}51`)
      assert.equal(await valide(), true)
    })
  }
})
