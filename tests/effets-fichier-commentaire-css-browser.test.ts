// Un effet à soi (fichier `*.effects.mjs`) dont une ligne de CSS porte un commentaire `//` en fin de ligne, dans Chromium et Firefox réels :
// l'effet se voit. Le navigateur ne connaît pas `//` ; sans que MJS le retire il jetait la déclaration entière (`box-shadow: … // le halo`),
// sans un mot, et le halo ne s'affichait pas. Le commentaire n'est pas non plus dans le code publié. Un `//` d'un texte, d'un `url(…)` et un
// `/* … */` restent à leur place : l'adresse d'`url(//cdn/fond.png)` est bien celle que la page demande.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// un PNG de 1 × 1 : l'image que sert la fausse adresse
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// chaque commentaire porte un mot que le code publié ne doit pas contenir
const EFFETS = [
  '<effects>',
  '  *halo(color: #0ff, size: 12px) =',
  '    box-shadow: 0 0 $size $color // NOTE-HALO',
  '  *collee(color: #0ff, size: 12px) =',
  '    box-shadow: 0 0 $size $color// NOTE-COLLEE',
  '  *lignes(color: #0ff, size: 12px) =',
  '    // NOTE-LIGNE-ENTIERE box-shadow: none',
  '    box-shadow: 0 0 $size $color',
  '    // NOTE-FIN',
  '  *bloc(color: #0ff, size: 12px) =',
  '    box-shadow: 0 0 $size /* l\'épaisseur */ $color // NOTE-BLOC',
  '  *police(taille: 20px) =',
  '    font-family: "a//b", serif // NOTE-POLICE',
  '    font-size: $taille',
  '  *fond(x: 1) =',
  '    background-image: url(//cdn/fond.png) // NOTE-FOND',
  '    background-size: 10px 10px',
  '  *anime(echelle: 2) =',
  '    @keyframes',
  '      to // NOTE-ETAPE',
  '        transform: scale($echelle) // NOTE-IMAGE',
  '</effects>'
].join('\n')

const COMPOSANT = [
  '<button class="halo" *halo>H</button>',
  '<button class="collee" *collee>C</button>',
  '<button class="lignes" *lignes>L</button>',
  '<button class="bloc" *bloc>B</button>',
  '<p class="police" *police>P</p>',
  '<div class="fond" *fond style="width:40px;height:40px">F</div>',
  '<span class="anime" *anime(on: load)>A</span>'
].join('\n')

for (const nom of ['chromium', 'firefox'] as const) {
describe(`un commentaire dans le CSS d'un effet à soi (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let script  = ''
  let code    = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-fichier-commentaire-css-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app.effects.mjs'), EFFETS + '\n')
    writeFileSync(join(srcDir, 'fcc-page.mjs'), COMPOSANT + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const textes = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => readFileSync(join(outDir, f), 'utf-8'))
    code   = textes.join('\n')
    script = textes.map((t) => stripEsm(t)).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('le code publié ne porte aucun commentaire, et garde le `//` du texte et de l\'adresse', function () {
    if (!present) return this.skip()
    assert.doesNotMatch(code, /NOTE-/)
    assert.match(code, /a\/\/b/)
    assert.match(code, /url\(\/\/cdn\/fond\.png\)/)
    assert.match(code, /l'épaisseur/)
  })

  it('chaque effet se voit : le halo, la police, le fond demandé à son adresse, l\'animation', async function () {
    if (!present) return this.skip()
    const playwright = await import('playwright')
    const browser    = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox'] } : {})
    try {
      const page      = await browser.newPage({ viewport: { width: 500, height: 500 } })
      const erreurs: string[]   = []
      const demandees: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      await page.route('**/*', (route: any) => {
        const url = route.request().url()
        if (url === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-fcc-page></mjs-fcc-page><script>${script}</script></body></html>` })
        demandees.push(url)
        if (url.startsWith('http://cdn/')) return route.fulfill({ contentType: 'image/png', body: PNG })
        return route.fulfill({ status: 404, body: '' })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const r = (document.querySelector('mjs-fcc-page') as any)?._shadow
        return !!r && ['halo', 'collee', 'lignes', 'bloc', 'police', 'fond', 'anime'].every((c) => r.querySelector('.' + c)?.hasAttribute('mjs-fx'))
      }, undefined, { timeout: 30000 })
      // la transition d'un effet à état dure 400 ms : on lit après
      await page.waitForTimeout(900)
      const style = await page.evaluate(() => {
        const r   = (document.querySelector('mjs-fcc-page') as any)._shadow
        const lire = (c: string, p: string) => getComputedStyle(r.querySelector('.' + c)).getPropertyValue(p)
        return {
          halo:    lire('halo', 'box-shadow'),
          collee:  lire('collee', 'box-shadow'),
          lignes:  lire('lignes', 'box-shadow'),
          bloc:    lire('bloc', 'box-shadow'),
          police:  lire('police', 'font-family'),
          taille:  lire('police', 'font-size'),
          fond:    lire('fond', 'background-image'),
          anime:   (() => {
            const feuilles = [...r.adoptedStyleSheets, ...document.adoptedStyleSheets, ...document.styleSheets]
            const regle    = feuilles.flatMap((f: any) => [...f.cssRules]).find((x: any) => x.name === 'mjs-fx-anime')
            return regle ? [...regle.cssRules].map((k: any) => k.keyText + '{' + k.style.cssText + '}').join('') : 'pas de @keyframes'
          })()
        }
      })
      assert.deepEqual(erreurs, [])
      for (const c of ['halo', 'collee', 'lignes', 'bloc'] as const) assert.match(style[c], /rgb\(0, 255, 255\) 0px 0px 12px/, `le halo « ${c} » s'affiche : ${style[c]}`)
      assert.match(style.police, /a\/\/b/, style.police)
      assert.equal(style.taille, '20px')
      assert.match(style.fond, /http:\/\/cdn\/fond\.png/, style.fond)
      assert.ok(demandees.includes('http://cdn/fond.png'), 'la page demande l\'image à son adresse : ' + demandees.join(' | '))
      assert.match(style.anime, /^(?:to|100%)\{transform: scale\(var\(--mjs-anime-echelle, ?2\)\);?\}$/, 'l\'étape garde sa déclaration : ' + style.anime)
      await page.close()
    }
    finally {
      await browser.close()
    }
  })
})
}
