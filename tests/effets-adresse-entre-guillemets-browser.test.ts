// Une adresse écrite ENTRE GUILLEMETS dans les réglages d'un effet est lue comme un texte, jamais comme un commentaire, même quand elle commence
// par `//` (une adresse sans protocole, `'//cdn/a.png'`) : chaque réglage d'image du catalogue la porte telle quelle jusqu'au navigateur, et la
// page demande bien cette image-là. Chromium et Firefox réels, la requête observée ; une adresse d'un effet réglé d'un fichier `*.effects.mjs`
// aussi. Le côté compilation (tous les réglages d'image du catalogue, le message du refus) est dans effets-adresse-entre-guillemets.test.ts.

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

// un PNG de 1 × 1 : l'image que sert chaque fausse adresse
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// la page s'ouvre sur http://t.test/ : `//cdn/x.png` y devient http://cdn/x.png
const CDN = 'http://cdn/'

// la balise `.x` d'un composant : un survol, puis un clic, à ses coordonnées
async function survol(page: any, nom: string, clic = false) {
  const r = await page.evaluate((n: string) => {
    const b = (document.querySelector('mjs-ia-' + n) as any)._shadow.querySelector('.x').getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, nom)
  await page.mouse.move(r.x, r.y)
  if (clic) await page.mouse.click(r.x, r.y)
}

interface Cas {
  /** le nom du composant (mjs-ia-<nom>) */
  nom: string
  /** la balise, de classe `x` */
  balise: string
  /** les adresses que la page doit demander */
  attendu: Array<string | RegExp>
  /** un geste ou un état pour que l'effet charge ses images */
  agir?: (page: any) => Promise<void>
}

const CAS: Cas[] = [
  { nom: 'gradient', balise: '<h1 class="x" *gradient(image: \'//cdn/gradient.png\')>Titre</h1>', attendu: [CDN + 'gradient.png'] },
  { nom: 'pixels', balise: '<button class="x" *pixels(swap, image: \'//cdn/pixels.png\')>Go</button>', attendu: [CDN + 'pixels.png'], agir: async (page) => { await survol(page, 'pixels', true) } },
  { nom: 'hologram', balise: '<div class="x" *hologram(rays, image: \'//cdn/holo-image.png\', mask: \'//cdn/holo-mask.png\', zoom: spin, back: \'//cdn/holo-back.png\')>carte</div>', attendu: [CDN + 'holo-image.png', CDN + 'holo-mask.png', CDN + 'holo-back.png'] },
  { nom: 'scratch', balise: '<div class="x" *scratch(image: \'//cdn/scratch.png\')>dessous</div>', attendu: [CDN + 'scratch.png'] },
  { nom: 'peel', balise: '<div class="x" *peel(image: \'//cdn/peel.png\')>page</div>', attendu: [CDN + 'peel.png'] },
  { nom: 'blend', balise: '<div class="x" *blend(image: \'//cdn/blend.png\')>fond</div>', attendu: [CDN + 'blend.png'] },
  { nom: 'sprite', balise: '<div class="x" *sprite(image: \'//cdn/sprite.png\', frames: 4, columns: 4, speed: 1s)></div>', attendu: [CDN + 'sprite.png'] },
  { nom: 'behind', balise: '<div class="x" *behind(\'//cdn/behind.png\')>sujet</div>', attendu: [CDN + 'behind.png'] },
  { nom: 'ink', balise: '<div class="x" *ink(on: load, duration: 600ms, image: \'//cdn/ink.png\')>encre</div>', attendu: [CDN + 'ink.png'] },
  { nom: 'scrub-images', balise: '<canvas class="x" *scrub(images: [\'//cdn/s1.png\', \'//cdn/s2.png\'], smooth: 0)></canvas>', attendu: [CDN + 's1.png'] },
  { nom: 'scrub-frames', balise: '<canvas class="x" *scrub(frames: \'//cdn/f-###.png\', count: 3, smooth: 0)></canvas>', attendu: [/^http:\/\/cdn\/f-\d+\.png$/] },
  { nom: 'offline', balise: '<section class="x" *offline(delay: 0s, logo: \'//cdn/offline.png\')>page</section>', attendu: [CDN + 'offline.png'], agir: async (page) => { await page.evaluate(() => { (globalThis as any).µ._mjs_fxOfflineSim = true }) } },
  { nom: 'alias', balise: '<div class="x" *carte-fond>carte</div>', attendu: [CDN + 'alias.png'] }
]

const STYLE = '\n<style>\n.x\n  display: block\n  width: 200px\n  height: 120px\n</style>\n'

for (const nom of ['chromium', 'firefox'] as const) {
describe(`une adresse entre guillemets dans les réglages d'un effet (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let script  = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-adresse-entre-guillemets-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'app.effects.mjs'), '<effects>\n  *carte-fond = *hologram(rays, image: \'//cdn/alias.png\')\n</effects>\n')
    for (const c of CAS) writeFileSync(join(srcDir, 'ia-' + c.nom + '.mjs'), c.balise + '\n' + STYLE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const cas of CAS) {
    it(`${cas.nom} : la page demande l'image écrite entre guillemets`, async function () {
      if (!present) return this.skip()
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox'] } : {})
      try {
        const page = await browser.newPage({ viewport: { width: 600, height: 500 } })
        const demandees: string[] = []
        await page.route('**/*', (route: any) => {
          const url = route.request().url()
          if (url === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-ia-${cas.nom}></mjs-ia-${cas.nom}><script>${script}</script></body></html>` })
          demandees.push(url)
          if (url.startsWith(CDN)) return route.fulfill({ contentType: 'image/png', body: PNG })
          return route.fulfill({ status: 404, body: '' })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((n: string) => !!(document.querySelector('mjs-ia-' + n) as any)?._shadow?.querySelector('.x'), cas.nom, { timeout: 30000 })
        if (cas.agir) await cas.agir(page)
        const vu = () => cas.attendu.every((a) => demandees.some((u) => typeof a === 'string' ? u === a : a.test(u)))
        const fin = Date.now() + 8000
        while (!vu() && Date.now() < fin) await page.waitForTimeout(100)
        assert.ok(vu(), `images demandées : ${demandees.join(' | ') || 'aucune'}`)
        await page.close()
      }
      finally {
        await browser.close()
      }
    })
  }
})
}
