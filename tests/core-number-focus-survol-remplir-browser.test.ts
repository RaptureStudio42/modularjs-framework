// <@@number> dans Chromium, Firefox et WebKit réels : l'anneau du focus se règle par `--mjs-number-focus`, le fond de « − » et « + »
// au survol et à l'appui par `--mjs-number-step-hover` ; sans elles, l'anneau bleu pâle et le voile gris de toujours. Et le champ
// remplit son conteneur avec ce qui existe déjà : `--mjs-number-width: 100%` et une balise qui prend la largeur (`display: block`,
// ou `flex: 1` dans une rangée flex), `big` compris ; sans rien, 160px

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'fs-page.mjs': `<script>
  $a = 5
  $b = 5
</script>
<div class="defaut">
  <@@number class="n" value=!{$a} min="0" max="10"></@@number>
</div>
<div class="theme">
  <@@number class="n" value=!{$b} min="0" max="10"></@@number>
</div>
<div class="boite">
  <@@number class="plein" value="1"></@@number>
  <@@number class="plein-big" value="1" big></@@number>
  <@@number class="nu" value="1"></@@number>
</div>
<div class="rangee">
  <span class="etiquette">Quantité</span>
  <@@number class="souple" value="1"></@@number>
</div>
<style>
  .theme
    --mjs-number-focus: rgb(255, 0, 0)
    --mjs-number-step-hover: rgb(0, 128, 0)

  .boite
    width: 400px

  .plein, .plein-big
    display: block
    --mjs-number-width: 100%

  .rangee
    display: flex
    width: 400px

  .etiquette
    flex: none
    width: 100px

  .souple
    flex: 1
    --mjs-number-width: 100%
</style>
`
}

let construit: Promise<string> | null = null

// le build et le script concaténé, une seule fois pour les trois navigateurs
function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('number-focus-survol-remplir')
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@number> : anneau du focus, survol des boutons, champ qui remplit son conteneur (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test du focus et du survol sauté`)
      return
    }
    const script = await construire()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-fs-page></mjs-fs-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fs-page') as any)?._shadow?.querySelector('.souple')?._shadow?.querySelector('input'))
    // la pièce `piece` du module `sel` de la page
    await page.evaluate(`window.__piece = (sel, piece) => document.querySelector('mjs-fs-page')._shadow.querySelector(sel)._shadow.querySelector(piece)`)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  // les transitions (bordure, ombre, fond) durent quelques dixièmes de seconde : la valeur attendue est guettée, la dernière lue est rendue
  const guetter = async (code: string, attendu: (v: string) => boolean): Promise<string> => {
    let vu = ''
    for (let i = 0; i < 40; i++) {
      vu = await page.evaluate(code)
      if (attendu(vu)) break
      await page.waitForTimeout(50)
    }
    return vu
  }

  it('anneau du focus : bleu pâle de 3px par défaut, la couleur de `--mjs-number-focus` quand elle est posée', async function () {
    if (!present) { this.skip(); return }
    const anneau = (zone: string) => `getComputedStyle(__piece('.${zone} .n', '.field')).boxShadow`
    await page.evaluate(`__piece('.defaut .n', 'input').focus()`)
    const defaut = await guetter(anneau('defaut'), (v) => v.includes('rgba(59, 130, 246, 0.35)') && v.endsWith(' 3px'))
    assert.ok(defaut.includes('rgba(59, 130, 246, 0.35)') && defaut.endsWith(' 3px'), `anneau par défaut inchangé (trouvé : ${defaut})`)
    await page.evaluate(`__piece('.theme .n', 'input').focus()`)
    const theme = await guetter(anneau('theme'), (v) => v.includes('rgb(255, 0, 0)') && v.endsWith(' 3px'))
    assert.ok(theme.includes('rgb(255, 0, 0)') && theme.endsWith(' 3px'), `anneau réglé par --mjs-number-focus (trouvé : ${theme})`)
    await page.evaluate(`document.activeElement?.blur?.(); __piece('.theme .n', 'input').blur()`)
  })

  it('survol et appui de « + » : le voile gris par défaut, la couleur de `--mjs-number-step-hover` quand elle est posée', async function () {
    if (!present) { this.skip(); return }
    const fond = (zone: string) => `getComputedStyle(__piece('.${zone} .n', '.step.more')).backgroundColor`
    const survoler = async (zone: string) => {
      const [x, y] = await page.evaluate(`(() => { const r = __piece('.${zone} .n', '.step.more').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
      await page.mouse.move(x, y)
    }
    await page.mouse.move(2, 2)
    const repos = await guetter(fond('theme'), (v) => v === 'rgba(0, 0, 0, 0)')
    assert.equal(repos, 'rgba(0, 0, 0, 0)', 'au repos, le fond de toujours (transparent)')
    await survoler('defaut')
    assert.equal(await guetter(fond('defaut'), (v) => v === 'rgba(127, 127, 127, 0.32)'), 'rgba(127, 127, 127, 0.32)', 'voile gris par défaut au survol')
    await survoler('theme')
    assert.equal(await guetter(fond('theme'), (v) => v === 'rgb(0, 128, 0)'), 'rgb(0, 128, 0)', '--mjs-number-step-hover au survol')
    await page.mouse.down()
    assert.equal(await guetter(fond('theme'), (v) => v === 'rgb(0, 128, 0)'), 'rgb(0, 128, 0)', '--mjs-number-step-hover à l\'appui')
    await page.mouse.up()
    await page.mouse.move(2, 2)
  })

  it('remplir son conteneur : `--mjs-number-width: 100%` et `display: block` (ou `flex: 1` dans une rangée), `big` compris ; sans rien, 160px', async function () {
    if (!present) { this.skip(); return }
    const largeur = (sel: string): Promise<number> => page.evaluate(`Math.round(__piece('${sel}', '.field').getBoundingClientRect().width)`)
    assert.equal(await largeur('.plein'), 400, 'display: block')
    assert.equal(await largeur('.plein-big'), 400, 'display: block, avec big')
    assert.equal(await largeur('.souple'), 300, 'flex: 1 dans une rangée de 400px, à côté d\'une étiquette de 100px')
    assert.equal(await largeur('.nu'), 160, 'sans rien : la largeur par défaut')
  })
})
