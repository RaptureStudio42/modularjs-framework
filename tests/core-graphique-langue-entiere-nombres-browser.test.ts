// <@@chart> dans Chromium, Firefox et WebKit réels : les nombres du graphique (le tableau lu par les lecteurs d'écran) s'écrivent dans la
// langue entière de la page, région comprise, comme le navigateur les écrit pour elle : `de-CH` et `es-MX` au point, `en-ZA` comme son format,
// alors que l'allemand et l'espagnol écrivent la virgule
// une langue que le navigateur refuse (`<html lang="en-">`, puis µlang « zh-CN-Hans », « en-US  »…) se lit par son premier sous-tag,
// dans le graphique comme dans le champ nombre, sans erreur, et le graphique suit encore la langue d'après

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'langue-graphique.mjs': `<script>
  $lignes = [{ x: 'Anvers', v: 1.5 }]
</script>
<@@chart class="g" rows={$lignes} series={[{ key: 'v' }]} shape="bar"></@@chart>
`,
  'langue-mal-ecrite.mjs': `<script>
  $lignes = [{ x: 'Anvers', v: 1.5 }]
  $n = 1.5
</script>
<@@chart class="g" rows={$lignes} series={[{ key: 'v' }]} shape="bar"></@@chart>
<@@number class="n" value=!{$n} step="0.1"></@@number>
<button class="b0" @click={µlang = 'zh-CN-Hans'}>0</button>
<button class="b1" @click={µlang = 'en-US '}>1</button>
<button class="b2" @click={µlang = 'en-GB-oed'}>2</button>
<button class="b3" @click={µlang = 'es-ES_tradnl'}>3</button>
<button class="b4" @click={µlang = 'de-CH'}>4</button>
<button class="b5" @click={µlang = '1'}>5</button>
`
}

// après `<html lang="en-">` : la langue posée par chaque bouton, et ce qu'écrivent le graphique puis le champ (`*` : le séparateur de la
// langue du navigateur, quand même le premier sous-tag est refusé)
const MAL_ECRITES: [string, string, string][] = [
  ['zh-CN-Hans', '1.5', '1.5'],
  ['en-US ', '1.5', '1.5'],
  ['en-GB-oed', '1.5', '1.5'],
  ['es-ES_tradnl', '1,5', '1,5'],
  ['de-CH', '1.5', '1.5'],
  ['1', '1*5', '1,5']
]

let construit: Promise<string> | null = null

// le build et le script concaténé, une seule fois pour les trois navigateurs
function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('graphique-langue-entiere-browser')
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@chart> : les nombres dans la langue entière de la page, région comprise (${nom} réel)`, function () {
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
      console.log(`  ℹ️  ${nom} non installé, test de la langue du graphique sauté`)
      return
    }
    script  = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // une page neuve par langue : le script du build déclare ses noms au niveau global, une seconde écriture dans la même page les redéclarerait
  for (const lang of ['de', 'de-CH', 'es-MX', 'en-ZA']) {
    it(`page en ${lang} : le tableau écrit 1,5 avec le séparateur que le navigateur écrit pour cette langue`, async function () {
      if (!present) { this.skip(); return }
      erreurs.length = 0
      if (page) await page.close()
      page = await browser.newPage()
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      await page.setContent(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><mjs-langue-graphique></mjs-langue-graphique><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-langue-graphique') as any)?._shadow?.querySelector('.g')?._shadow?.querySelector('.sr td'))
      const sep    = await page.evaluate(`new Intl.NumberFormat(document.documentElement.lang).formatToParts(1.5).find((p) => p.type === 'decimal').value`)
      const ecrit  = await page.evaluate(`document.querySelector('mjs-langue-graphique')._shadow.querySelector('.g')._shadow.querySelector('.sr td').textContent.trim()`)
      assert.equal(ecrit, `1${sep}5`)
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    })
  }

  it('page en « en- », puis µlang mal écrite : le graphique et le champ lisent le premier sous-tag, sans erreur, et suivent la langue d\'après', async function () {
    if (!present) { this.skip(); return }
    erreurs.length = 0
    if (page) await page.close()
    page = await browser.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push('pageerror ' + String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console ' + m.text().slice(0, 200)) })
    await page.setContent(`<!doctype html><html lang="en-"><head><meta charset="utf-8"></head><body><mjs-langue-mal-ecrite></mjs-langue-mal-ecrite><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-langue-mal-ecrite') as any)?._shadow?.querySelector('.n')?._shadow?.querySelector('input'))
    const lire = `(() => { const h = document.querySelector('mjs-langue-mal-ecrite')._shadow; return [h.querySelector('.g')?._shadow?.querySelector('.sr td')?.textContent?.trim() ?? 'graphique vide', h.querySelector('.n')?._shadow?.querySelector('input')?.value ?? 'champ vide'] })()`
    const navigateur = await page.evaluate(`new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === 'decimal').value`)
    const voulu: Record<string, string[]> = { 'en-': ['1.5', '1.5'] }
    const lu: Record<string, string[]> = {}
    await page.waitForFunction(`${lire}.join() === '1.5,1.5'`, null, { timeout: 3000 }).catch(() => null)
    lu['en-'] = await page.evaluate(lire)
    for (const [i, [lang, g, c]] of MAL_ECRITES.entries()) {
      voulu[lang] = [g.replace('*', navigateur), c]
      await page.evaluate(`document.querySelector('mjs-langue-mal-ecrite')._shadow.querySelector('.b${i}').click()`)
      await page.waitForFunction(`${lire}.join() === ${JSON.stringify(voulu[lang].join())}`, null, { timeout: 3000 }).catch(() => null)
      lu[lang] = await page.evaluate(lire)
    }
    assert.deepEqual(lu, voulu, 'graphique puis champ, par langue')
    assert.deepEqual(erreurs, [], 'aucune erreur')
  })
})
