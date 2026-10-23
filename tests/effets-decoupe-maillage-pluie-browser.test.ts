// *gradient.knockout (l'ancien *knockout), *mesh et *matrix dans un navigateur réel (Chromium, puis Firefox) : le texte découpé
// montre les pixels de l'image dans les lettres et le fond de la page entre elles ; les taches du
// maillage bougent entre deux captures ; la toile de pluie n'est pas vide, change, et ne demande
// plus d'image hors écran (on compte les appels à requestAnimationFrame). Une vraie mise en page et
// une vraie toile sont nécessaires : pas de happy-dom. Les captures sont déposées dans le dossier
// nommé par la variable d'environnement CAPTURES_EFFETS, quand elle existe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

// un PNG uni, 8 × 8
function uni(r: number, g: number, b: number): string {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (x: Buffer) => { let c = 0xffffffff; for (const v of x) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(8, 0); tete.writeUInt32BE(8, 4); tete[8] = 8; tete[9] = 2
  const brut = Buffer.alloc((8 * 3 + 1) * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = y * 25 + 1 + x * 3; brut[o] = r; brut[o + 1] = g; brut[o + 2] = b }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
  return 'data:image/png;base64,' + png.toString('base64')
}

const GROS = 'font: 900 150px sans-serif\n  width: 600px\n  margin: 0\n  line-height: 1.1'
const CASE = 'width: 500px\n  height: 300px\n  color: #fff'
const BOITE = 'width: 400px\n  height: 300px'

const SOURCES: Record<string, string> = {
  'dm-image.mjs':     `<h1 class="b" *gradient.knockout(image: '${uni(0, 255, 0)}', animate: false)>MMM</h1>\n<style>\n.b\n  ${GROS}\n</style>\n`,
  'dm-degrade.mjs':   `<h1 class="b" *gradient.knockout(speed: 2s, colors: [#ff0000, #0000ff])>MMM</h1>\n<style>\n.b\n  ${GROS}\n</style>\n`,
  'dm-cassee.mjs':    `<h1 class="b" *gradient.knockout(image: '/absente.png', animate: false)>MMM</h1>\n<style>\n.b\n  ${GROS}\n</style>\n`,
  'dm-maille.mjs':    `<div class="m" *mesh(neon, speed: 4s)>Maillage</div>\n<style>\n.m\n  ${CASE}\n</style>\n`,
  'dm-maille-s.mjs':  `<div class="m" *mesh(sunset, speed: 4s, mouse: true)>Maillage</div>\n<style>\n.m\n  ${CASE}\n</style>\n`,
  'dm-pluie.mjs':     `<div class="r" *matrix>Pluie</div>\n<style>\n.r\n  ${BOITE}\n  color: #fff\n</style>\n`,
  'dm-pluie-bas.mjs': `<div class="r" *matrix>Pluie</div>\n<style>\n.r\n  ${BOITE}\n  color: #fff\n  margin-top: 4000px\n</style>\n`,
  'dm-pluie-lente.mjs': `<div class="r" *matrix(trail: 0.01, direction: left, size: 12, density: 10)>Pluie</div>\n<style>\n.r\n  ${BOITE}\n  color: #fff\n</style>\n`,
}

describe('*gradient.knockout, *mesh, *matrix (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''
  const dossier = process.env.CAPTURES_EFFETS || ''

  before(async function () {
    const root   = mjsTmp('effets-decoupe-maillage-pluie-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const tri   = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    const lis   = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    // jamais économe (la clé `effects.lite` du manifeste, posée avant les composants) : *mesh est un effet lourd, la mesure de la cadence demanderait
    // ses propres images, et une machine chargée arrêterait les taches
    script = tri.filter((f) => rang(f) < 2).map(lis).join('\n') + '\nµ._fxConf = { lite: "off" };\n' + tri.filter((f) => rang(f) === 2).map(lis).join('\n') + '\nglobalThis.µ = µ;'
    if (dossier) mkdirSync(dossier, { recursive: true })
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
      })

      async function ouvre(browser: any, tag: string, calme = false) {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        if (calme) await page.emulateMedia({ reducedMotion: 'reduce' })
        const avertissements: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'warning') avertissements.push(m.text()) })
        await page.addInitScript(() => {
          const w: any = window
          w.__raf = 0
          const vrai = w.requestAnimationFrame.bind(w)
          w.requestAnimationFrame = (f: any) => { w.__raf++; return vrai(f) }
        })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f00}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.b, .m, .r'), tag)
        return { page, avertissements }
      }

      const rect = (page: any) => page.evaluate(() => {
        const b: any = Array.from(document.body.children).map((c: any) => c._shadow?.querySelector('.b, .m, .r')).find(Boolean)
        b.scrollIntoView({ block: 'start' })
        const r = b.getBoundingClientRect()
        return { x: r.left, y: r.top, width: r.width, height: r.height }
      })
      const foto = async (page: any, nomFichier: string) => {
        const r   = await rect(page)
        const png = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.width, height: r.height } })
        if (dossier) writeFileSync(join(dossier, `${nomFichier}-${nom}.png`), png)
        return png.toString('base64')
      }
      // les pixels d'une capture : vert, rouge, autres ; et l'écart moyen entre deux captures
      const lit = (page: any, a: string, b?: string) => page.evaluate(async ([x, y]: [string, string | undefined]) => {
        const lire = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d') as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          return c.getImageData(0, 0, cv.width, cv.height).data
        }
        const A = await lire(x)
        let vert = 0, rouge = 0, vif = 0
        const couleurs = new Set<number>()
        for (let i = 0; i < A.length; i += 4) {
          if (A[i + 1] > 200 && A[i] < 60 && A[i + 2] < 60) vert++
          else if (A[i] > 200 && A[i + 1] < 60 && A[i + 2] < 60) rouge++
          if (A[i + 1] > A[i] + 60 && A[i + 1] > 100) vif++
          couleurs.add((A[i] >> 4) << 8 | (A[i + 1] >> 4) << 4 | (A[i + 2] >> 4))
        }
        let ecart = 0
        if (y) {
          const B = await lire(y)
          let s = 0
          for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
          ecart = s / (A.length / 4) / 3
        }
        return { vert, rouge, vif, couleurs: couleurs.size, total: A.length / 4, ecart }
      }, [a, b])

      it('*gradient.knockout : l\'image se voit dans les lettres, le fond de la page entre elles', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-image')
          const p = await lit(page, await foto(page, 'decoupe-image'))
          assert.ok(p.vert > 3000, `du vert dans les lettres : ${p.vert}`)
          assert.ok(p.rouge > 3000, `du rouge entre les lettres : ${p.rouge}`)
          assert.ok((p.vert + p.rouge) / p.total > 0.8, `lettres nettes : ${p.vert + p.rouge} / ${p.total}`)
          const texte = await page.evaluate(() => (Array.from(document.body.children).map((c: any) => c._shadow?.querySelector('.b')).find(Boolean) as any).textContent)
          assert.equal(texte, 'MMM', 'le texte n\'est pas réécrit')
        } finally {
          await browser.close()
        }
      })

      it('*gradient.knockout : un dégradé qui défile (le fond change entre deux captures), le texte reste le même', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-degrade')
          const a = await foto(page, 'decoupe-degrade-a')
          await page.waitForTimeout(700)
          const b = await foto(page, 'decoupe-degrade-b')
          const p = await lit(page, a, b)
          assert.ok(p.ecart > 3, `le dégradé a bougé : écart moyen ${p.ecart.toFixed(2)}`)
          assert.ok(p.couleurs > 15, `un vrai dégradé : ${p.couleurs} couleurs`)
        } finally {
          await browser.close()
        }
      })

      it('*gradient.knockout : une image introuvable laisse le dégradé à sa place, avec un avertissement', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page, avertissements } = await ouvre(browser, 'mjs-dm-cassee')
          await page.waitForFunction(() => (Array.from(document.body.children).map((c: any) => c._shadow?.querySelector('.b')).find(Boolean) as any).style.getPropertyValue('--mjs-fx-gradient').startsWith('linear-gradient'))
          const p = await lit(page, await foto(page, 'decoupe-image-cassee'))
          assert.ok(p.couleurs > 20, 'des lettres colorées, pas du texte invisible : ' + p.couleurs)
          assert.equal(avertissements.filter((m) => m.includes('*gradient')).length, 1)
        } finally {
          await browser.close()
        }
      })

      it('*mesh : le fond est coloré, les taches bougent entre deux captures, et la dérive tourne en CSS', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-maille')
          const a = await foto(page, 'mesh-a')
          await page.waitForTimeout(2200)
          const b = await foto(page, 'mesh-b')
          const p = await lit(page, a, b)
          assert.ok(p.couleurs > 40, `un fond coloré : ${p.couleurs} couleurs`)
          assert.ok(p.ecart > 1.5, `les taches ont bougé : écart moyen ${p.ecart.toFixed(2)}`)
          const n = await page.evaluate(() => {
            const m: any = (document.querySelector('mjs-dm-maille') as any)._shadow.querySelector('.m')
            return { anims: m.querySelectorAll('[mjs-fx-layer="mesh"] b').length, vivantes: Array.from(m.querySelectorAll('[mjs-fx-layer="mesh"] b')).reduce((s: number, b: any) => s + b.getAnimations().length, 0), raf: (window as any).__raf }
          })
          assert.equal(n.anims, 5)
          assert.ok(n.vivantes >= 10, `animations vivantes : ${n.vivantes}`)
          await page.waitForTimeout(600)
          assert.equal(await page.evaluate(() => (window as any).__raf), n.raf, 'aucune boucle JavaScript : plus aucune image demandée')
        } finally {
          await browser.close()
        }
      })

      it('*mesh(mouse: true) : les taches s\'écartent de la souris, puis reviennent', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-maille-s')
          const r = await rect(page)
          await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
          await page.mouse.move(r.x + r.width / 2 + 5, r.y + r.height / 2 + 5)
          const pousse = await page.evaluate(() => Array.from((document.querySelector('mjs-dm-maille-s') as any)._shadow.querySelectorAll('[mjs-fx-layer="mesh"] i')).map((i: any) => parseFloat(i.style.getPropertyValue('--mjs-fx-mesh-ox')) || 0))
          assert.ok(pousse.some((x: number) => Math.abs(x) > 5), 'des taches écartées : ' + pousse.join(','))
          await page.mouse.move(r.x + r.width + 100, r.y + r.height + 100)
          const repos = await page.evaluate(() => Array.from((document.querySelector('mjs-dm-maille-s') as any)._shadow.querySelectorAll('[mjs-fx-layer="mesh"] i')).map((i: any) => parseFloat(i.style.getPropertyValue('--mjs-fx-mesh-ox')) || 0))
          assert.ok(repos.every((x: number) => x === 0), 'revenues : ' + repos.join(','))
        } finally {
          await browser.close()
        }
      })

      it('*matrix : la toile n\'est pas vide, la pluie change, la traîne reste nette', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-pluie')
          await page.waitForTimeout(600)
          const a = await foto(page, 'matrix-a')
          await page.waitForTimeout(500)
          const b = await foto(page, 'matrix-b')
          const p = await lit(page, a, b)
          assert.ok(p.vif > 150, `du vert de pluie : ${p.vif}`)
          assert.ok(p.vif < p.total * 0.6, 'pas une toile pleine')
          assert.ok(p.ecart > 0.5, `la pluie change : écart moyen ${p.ecart.toFixed(2)}`)
          const pale = await page.evaluate(() => {
            const c: any = (document.querySelector('mjs-dm-pluie') as any)._shadow.querySelector('canvas')
            return { w: c.width, h: c.height, css: getComputedStyle(c).zIndex }
          })
          assert.ok(pale.w >= 400 && pale.h >= 300, `la toile suit la balise : ${pale.w} × ${pale.h}`)
          assert.equal(pale.css, '-1')
        } finally {
          await browser.close()
        }
      })

      it('*matrix : aucune image demandée hors écran, la boucle repart à l\'écran puis s\'arrête quand on s\'éloigne', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-pluie-bas')
          const raf = () => page.evaluate(() => (window as any).__raf)
          await page.waitForTimeout(700)
          const n1 = await raf()
          await page.waitForTimeout(700)
          const n2 = await raf()
          assert.ok(n2 - n1 <= 1, `hors écran, aucune image demandée : ${n1} puis ${n2}`)
          await page.evaluate(() => (Array.from(document.body.children).map((c: any) => c._shadow?.querySelector('.r')).find(Boolean) as any).scrollIntoView())
          await page.waitForTimeout(600)
          const n3 = await raf()
          assert.ok(n3 - n2 > 10, `à l'écran, la boucle tourne : ${n3 - n2} images`)
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(400)
          const n4 = await raf()
          await page.waitForTimeout(600)
          const n5 = await raf()
          assert.ok(n5 - n4 <= 1, `elle s'arrête hors écran : ${n4} puis ${n5}`)
        } finally {
          await browser.close()
        }
      })

      it('*matrix : « réduire les animations » donne une image fixe, peinte, sans boucle', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-pluie', true)
          await page.waitForTimeout(300)
          const avant = await page.evaluate(() => (window as any).__raf)
          const p = await lit(page, await foto(page, 'matrix-calme'))
          assert.ok(p.vif > 150, `une pluie peinte : ${p.vif}`)
          await page.waitForTimeout(500)
          assert.equal(await page.evaluate(() => (window as any).__raf), avant, 'aucune image demandée de plus')
        } finally {
          await browser.close()
        }
      })

      it('*matrix(trail: 0.01, direction: left) : la traîne longue ne laisse aucun reste figé', async function () {
        if (!present) { this.skip(); return }
        const pw = await import('playwright')
        const browser = await pw[nom].launch()
        try {
          const { page } = await ouvre(browser, 'mjs-dm-pluie-lente')
          await page.waitForTimeout(1500)
          const p = await lit(page, await foto(page, 'matrix-longue'))
          assert.ok(p.vif > 200, `de la pluie : ${p.vif}`)
        } finally {
          await browser.close()
        }
      })
    })
  }
})
