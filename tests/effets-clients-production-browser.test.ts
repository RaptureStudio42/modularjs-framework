// Les effets dont le fichier est filtré par sections (*hologram, les transitions, *liquid, *sprite, *pointer), CONSTRUITS EN PRODUCTION
// dans des navigateurs réels, un build par pose : sans aucun réglage optionnel, puis avec chacun de ses réglages optionnels écrit seul
// (et tenu par une variable). Aucune section manquante qui casserait un réglage écrit : pas une erreur de page ni de console, l'effet
// est posé sur sa balise, et la page fait ce que le réglage demande (survol, défilement) sans rien lever.
// WebGL : Chromium sans la variable DISPLAY, Firefox sous un serveur X virtuel. Un navigateur absent : le test est sauté.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE  = '\n<style>\n.zone\n  width: 300px\n  height: 160px\n  margin: 10px\n.a\n  width: 200px\n  height: 90px\n  margin: 6px\n</style>\n'
const SVG    = (l: number, h: number) => `data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27${l}%27 height=%27${h}%27%3E%3Crect width=%27${l}%27 height=%27${h}%27 fill=%27%23c33%27/%3E%3Ccircle cx=%27${l / 2}%27 cy=%27${h / 2}%27 r=%2730%27 fill=%27%23fc3%27/%3E%3C/svg%3E`
const IMAGE  = SVG(240, 140)
const PLANCHE = SVG(240, 140)

// le préfixe public de la sortie : les images de motif de *hologram ne sont servies qu'à cette adresse exacte
const PREFIXE = '/assets/site'

// les styles de carte de *hologram, lus dans le fichier de l'effet (les appels `style('a b c', …)` de la feuille) : aucun n'est oublié
const STYLES_SIMPLES = ['rainbow', 'foil', 'galaxy', 'prism', 'gold']
const FICHIER_HOLOGRAM = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_hologram.ts'), 'utf-8')
const STYLES_CARTE = [...new Set([...FICHIER_HOLOGRAM.matchAll(/(?<![\w$.])style\('([a-z0-9 -]+)'/g)].flatMap((m) => m[1].split(' ')))]

interface Pose { effet: string, nom: string, source: string, jeton?: string }

// une pose = un composant, un build, une page. `jeton` : ce que `mjs-fx` doit porter sur la balise (rien pour une transition)
const POSES: Pose[] = []
const poser = (effet: string, nom: string, source: string, jeton?: string) => POSES.push({ effet, nom: effet + ' : ' + nom, source: source + STYLE, jeton })

for (const style of ['', ...STYLES_SIMPLES, ...STYLES_CARTE]) poser('hologram', style ? `(${style})` : 'sans style', `<div class="a" *hologram${style ? `(${style})` : ''}>x</div>`, 'hologram')
poser('hologram', 'style tenu par une variable', '<script>\n$s = \'curtain\'\n</script>\n<div class="a" *hologram(style: $s)>x</div>', 'hologram')

const TRANSITIONS: Array<[string, string]> = [
  ['*fade', 'défaut'], ['*fly', 'défaut'], ['*iris', 'défaut'], ['*blocks', 'défaut'], ['*pixelate', 'défaut'], ['*typewriter', 'défaut'], ['*scale', 'défaut'],
  ['*fade(on: hover)', 'on: hover'], ['*fade(on: scroll)', 'on: scroll'], ['*fade(on: hover, of: \'.zone\')', 'of'], ['*fade(once: false)', 'once: false'],
  ['*typewriter(on: hover)', 'typewriter au survol'], ['*fly(rotate: 45)', 'fly rotate'], ['*iris(start: .5)', 'iris start'], ['*iris(angle: 45)', 'iris angle'],
  ['*iris(origin: pointer, on: hover)', 'iris origin pointer'], ['*blocks(order: random)', 'blocks order'], ['*blocks(seed: 7)', 'blocks seed'],
  ['*pixelate(size: 12)', 'pixelate size'], ['*pixelate(steps: 4)', 'pixelate steps']
]
for (const [pose, nom] of TRANSITIONS) poser('transition', `${pose} (${nom})`, `<div class="zone"><p class="a" ${pose}>texte</p></div>`)
poser('transition', 'on: tenu par une variable', '<script>\n$o = \'hover\'\n</script>\n<div class="zone"><p class="a" *fade(on: $o)>texte</p></div>')
poser('transition', 'tous les réglages visuels ensemble', '<div class="zone"><p class="a" *iris(start: .2, angle: 30, origin: pointer, shape: box, once: false)>texte</p></div>')
poser('transition', 'le survol avec tous ses réglages', '<div class="zone"><p class="a" *iris(on: hover, of: \'.zone\', start: .2, angle: 30, origin: pointer)>texte</p></div>')

for (const reglage of ['', 'cells: 12', 'radius: 90', 'ghost: #f00', 'cells: 8, radius: 60, ghost: #0f0, strength: 60']) {
  poser('liquid', reglage ? `(${reglage})` : 'lisse', `<img class="a" src="${IMAGE}" alt="" *liquid${reglage ? `(${reglage})` : ''}>`, 'liquid')
}
poser('liquid', 'cells tenu par une variable', `<script>\n$c = 6\n</script>\n<img class="a" src="${IMAGE}" alt="" *liquid(cells: $c)>`, 'liquid')

for (const reglage of ['', 'fps: 12', 'poses: [0, 1, 2]', 'rows: 2, columns: 2', 'rows: 2, columns: 2, row: 1', 'animate: false', 'hold: true, repeat: 1', 'fps: 10, poses: [1, 0], hold: true, repeat: 2, animate: true']) {
  poser('sprite', reglage ? `(${reglage})` : 'défaut', `<div class="a" *sprite('${PLANCHE}', frames: 4${reglage ? ', ' + reglage : ''})></div>`, 'sprite')
}
poser('sprite', 'écouteur de fin de tour', `<script>\n$n = 0\n</script>\n<div class="a" *sprite('${PLANCHE}', frames: 2, fps: 60, repeat: 2) @mjs:sprite-end={$n++}></div><p class="n">{$n}</p>`, 'sprite')
poser('sprite', 'poses tenues par une variable', `<script>\n$p = [0, 1]\n</script>\n<div class="a" *sprite('${PLANCHE}', frames: 4, poses: $p)></div>`, 'sprite')

for (const pose of ['*pointer(lens)', '*pointer(disc)', '*pointer(ring, size: 60)', '*pointer(lens, soft: 40)', '*pointer(lens, soft: 0)', '*pointer(lens, outside: true, soft: 40)', '*pointer(disc, soft: 20)']) {
  poser('pointer', pose, `<div class="zone"><div class="a" ${pose}>x</div></div>`, 'pointer')
}
poser('pointer', 'soft tenu par une variable', '<script>\n$s = 30\n</script>\n<div class="zone"><div class="a" *pointer(lens, soft: $s)>x</div></div>', 'pointer')

describe('effets à sections — chaque pose construite en production, avec puis sans ses réglages optionnels', function () {
  this.timeout(1800000)
  const scripts: Record<string, string> = {}
  const sorties: Record<string, string> = {}

  before(async () => {
    POSES.forEach((pose, i) => { (pose as any).balise = 'mjs-t-' + i })
    for (const [i, pose] of POSES.entries()) {
      const root   = mjsTmp('clients-production-' + i)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 't-' + i + '.mjs'), pose.source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod', urlPrefix: PREFIXE } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], pose.nom)
      assert.equal(readFileSync(manifeste, 'utf-8').includes('// @@'), false, pose.nom + ' : aucune marque ne sort')
      scripts[pose.nom] = stripEsm(readFileSync(manifeste, 'utf-8'))
      sorties[pose.nom] = outDir
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { await browser?.close() })

      POSES.forEach((pose, i) => {
        it(pose.nom, async () => {
          const tag     = 'mjs-t-' + i
          const page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          await page.addInitScript(() => {
            (window as any).__racine = (tag: string) => {
              const el: any = document.querySelector(tag)
              if (!el) return null
              if (el.shadowRoot) return el.shadowRoot
              for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
              return el
            }
          })
          await page.route('http://t.test/**', (route: any) => {
            // les images de motif de *hologram que la construction a copiées dans la sortie, servies à leur adresse publique exacte (préfixe compris) : sans lui, 404
            const chemin  = new URL(route.request().url()).pathname
            const fichier = chemin.startsWith(PREFIXE + '/') ? chemin.slice(PREFIXE.length + 1) : ''
            const image   = /^mjs_hologram_[a-z-]+-[0-9a-z]{5}\.(png|webp|jpg)$/.exec(fichier)
            if (image) return route.fulfill({ contentType: 'image/' + (image[1] === 'jpg' ? 'jpeg' : image[1]), body: readFileSync(join(sorties[pose.nom], fichier)) })
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><${tag}></${tag}><script>${scripts[pose.nom]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(window as any).__racine(t)?.querySelector('.a'), tag, { timeout: 20000 })
          // la page vit : la souris entre sur la balise, y bouge, puis sort ; la page défile jusqu'en bas et revient
          const c = await page.evaluate((t: string) => {
            const r = (window as any).__racine(t).querySelector('.a').getBoundingClientRect()
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          }, tag)
          await page.mouse.move(c.x, c.y)
          await page.mouse.move(c.x + 20, c.y + 8, { steps: 4 })
          await page.waitForTimeout(450)
          await page.mouse.move(790, 590)
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
          await page.waitForTimeout(250)
          await page.evaluate('window.scrollTo(0, 0)')
          await page.waitForTimeout(250)
          if (pose.jeton) {
            const fx = await page.evaluate((t: string) => (window as any).__racine(t).querySelector('.a').getAttribute('mjs-fx') ?? '', tag)
            assert.ok(fx.split(' ').includes(pose.jeton), `la balise porte l'effet ${pose.jeton} (mjs-fx="${fx}")`)
          }
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      })
    })
  }
})
