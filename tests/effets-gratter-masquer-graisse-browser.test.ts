// *scratch, *spoiler et *weight dans Chromium et Firefox réels : une vraie toile, une vraie mise en
// page, une vraie police. Un trait de souris gratte la carte (des pixels de la toile deviennent
// transparents), le seuil lance `mjs:scratch` une seule fois, même quand l'image de couverture vient
// d'une autre origine sans autorisation (la toile est alors illisible, le seuil se mesure quand même) ;
// un clic révèle le texte caché, `again` le recache, Entrée aussi ; la lettre sous la souris est plus
// grasse que la plus lointaine, par la police variable. Avec MJS_CAPTURES=<dossier>, une capture PNG
// de chaque effet y est écrite.

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

// un PNG rouge de 8 × 8
function rouge(): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(8, 0); tete.writeUInt32BE(8, 4); tete[8] = 8; tete[9] = 2
  const brut = Buffer.alloc((8 * 3 + 1) * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) brut[y * 25 + 1 + x * 3] = 255
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
}

const SOURCES: Record<string, string> = {
  'gmp-gratte.mjs':     '<div class="s" *scratch(#888888, brush: 40, threshold: 0.5, duration: 200ms)><b>SOUS</b></div>\n<style>\n.s\n  width: 300px\n  height: 150px\n  background: #00ff00\n</style>\n',
  'gmp-gratte-img.mjs': '<div class="s" *scratch(image: \'http://autre.test/couverture.png\', brush: 40, threshold: 0.5, duration: 200ms)><b>SOUS</b></div>\n<style>\n.s\n  width: 300px\n  height: 150px\n  background: #00ff00\n</style>\n',
  'gmp-gratte-mot.mjs': '<div class="s" *scratch(#336699, text: \'Grattez\', ink: #ffffff, shape: square, brush: 30, threshold: 0.5, duration: 200ms)><b>SOUS</b></div>\n<style>\n.s\n  width: 300px\n  height: 150px\n  background: #00ff00\n</style>\n',
  'gmp-masque.mjs':     '<p class="p">Le code est <span class="x" *spoiler(again: true, duration: 100ms)>4-8-15-16</span>, et la fin <span class="y" *spoiler(blur, duration: 100ms)>du film</span>, <span class="z" *spoiler(bar, duration: 100ms)>le héros</span> et <span class="w" *spoiler(pixels, duration: 100ms)>le butin</span>.</p>\n<style>\n.p\n  font: 24px sans-serif\n  width: 560px\n  margin: 20px\n</style>\n',
  'gmp-gratte-mauvaise.mjs': '<script>\n$tout = [\'pas-une-couleur\', \'nope\']\n$mixte = [\'pas-une-couleur\', \'#ff0000\', \'#0000ff\']\n$deux = [\'pas-une-couleur\', \'nope\', \'#0000ff\']\n</script>\n<div class="s" *scratch(#888888, colors: $tout, brush: 40)><b>SOUS</b></div>\n<div class="t" *scratch(#888888, colors: $mixte, brush: 40)><b>SOUS</b></div>\n<div class="u" *scratch(#888888, colors: $deux, brush: 40)><b>SOUS</b></div>\n<style>\ndiv\n  width: 300px\n  height: 60px\n  background: #00ff00\n</style>\n',
  'gmp-masque-lignes.mjs': '<p class="p1">Au début du texte, <span class="x" *spoiler(duration: 100ms)>un long secret qui court sur plusieurs lignes du paragraphe sans jamais tenir sur une seule</span> puis la fin.</p>\n<p class="p2">Au début du texte, <span class="x2">un long secret qui court sur plusieurs lignes du paragraphe sans jamais tenir sur une seule</span> puis la fin.</p>\n<button class="av">avant</button>\n<p class="p3">Voir <span class="l" *spoiler(duration: 100ms)>le <a class="a" href="#haut">lien secret</a> ici</span>.</p>\n<style>\np\n  font: 20px/24px sans-serif\n  width: 220px\n  margin: 10px\n</style>\n',
  'gmp-masque-barre.mjs': '<script>\n$t = \'un long secret qui court sur plusieurs lignes du paragraphe sans jamais tenir sur une seule\'\n</script>\n<p class="p1">Au début, <span class="x" *spoiler(bar, duration: 100ms)>{$t}</span> puis la fin.</p>\n<button class="b" @click={$t = \'court\'}>b</button>\n<button class="v" @click={$t = \'\'}>v</button>\n<style>\n.p1\n  font: 24px sans-serif\n  width: 400px\n  height: 200px\n  margin: 20px\n</style>\n',
  'gmp-graisse.mjs':    '<h1 class="g" *weight(160, idle: false, duration: 80ms)>Ondulation</h1>\n<style>\n.g\n  font: 56px Variable, sans-serif\n  margin: 20px\n</style>\n',
  'gmp-graisse-crans.mjs': '<h1 class="g" *weight(160, idle: false, duration: 80ms)>Ondulation</h1>\n<style>\n.g\n  font: 56px sans-serif\n  margin: 20px\n</style>\n',
  'gmp-graisse-etire.mjs': '<h1 class="g" *weight(160, idle: false, duration: 80ms, fallback: stretch)>Ondulation</h1>\n<style>\n.g\n  font: 56px sans-serif\n  margin: 20px\n</style>\n',
  'gmp-graisse-ondule.mjs': '<h1 class="g" *weight(160, speed: 1s, duration: 40ms)>Ondulation</h1>\n<style>\n.g\n  font: 56px Variable, sans-serif\n  margin: 20px\n</style>\n'
}

const CAPTURES = process.env.MJS_CAPTURES
// une police variable (axes wght et wdth) du système, servie à la page en @font-face : la seule façon
// d'avoir un axe de graisse dans les deux navigateurs (une police système n'en montre que ses crans)
const POLICE = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf'

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*scratch, *spoiler, *weight (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let labels  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-gratter-masquer-graisse-' + nom)
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
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      // les libellés du runtime (celui de la balise cachée par *spoiler) viennent du manifeste, pour les pages en français d'ouvre()
      const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
      labels = libelles ? ' µ._runtimeLabels = ' + libelles[1] + ';' : ''
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function ouvre(browser: any, tag: string, sel: string) {
      const page = await browser.newPage({ viewport: { width: 640, height: 320 } })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() === 'http://t.test/variable.ttf') return route.fulfill({ contentType: 'font/ttf', body: readFileSync(POLICE) })
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>@font-face{font-family:Variable;src:url(/variable.ttf);font-weight:100 900}html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}${labels}</script></body></html>` })
      })
      // une image d'une AUTRE origine, sans aucun en-tête CORS : la toile qui la porte devient illisible
      await page.route('http://autre.test/**', (route: any) => route.fulfill({ contentType: 'image/png', body: rouge() }))
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, s]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector(s), [tag, sel])
      await page.waitForTimeout(300)
      return page
    }

    const capture = async (page: any, fichier: string) => { if (CAPTURES) await page.screenshot({ path: join(CAPTURES, `${nom}-${fichier}.png`) }) }

    // la toile de la carte : sa boîte, et la part de ses pixels devenus transparents (`null` : illisible)
    const lit = (page: any, tag: string) => page.evaluate((t: string) => {
      const s: any = (document.querySelector(t) as any)._shadow
      const cv     = s.querySelector('canvas[mjs-fx-layer="scratch"]')
      const r      = cv.getBoundingClientRect()
      let part: number | null = null
      try {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        let n = 0
        for (let i = 3; i < d.length; i += 4) if (d[i] < 40) n++
        part = n / (d.length / 4)
      } catch { part = null }
      return { x: r.left, y: r.top, w: r.width, h: r.height, part, fini: cv.hasAttribute('mjs-fx-scratch-done'), opacite: getComputedStyle(cv).opacity }
    }, tag)

    // un trait de souris de gauche à droite, à la hauteur `dy` de la carte
    async function trait(page: any, boite: any, dy: number) {
      await page.mouse.move(boite.x + 5, boite.y + dy)
      await page.mouse.down()
      await page.mouse.move(boite.x + boite.w - 5, boite.y + dy, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(60)
    }

    // le centre d'une balise du composant (son shadow root n'est pas ouvert aux sélecteurs de Playwright)
    async function clique(page: any, sel: string) {
      const c = await page.evaluate((q: string) => {
        const r = (document.querySelector('mjs-gmp-masque') as any)._shadow.querySelector(q).getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, sel)
      await page.mouse.click(c.x, c.y)
    }

    async function ecoute(page: any, tag: string, evenement: string) {
      await page.evaluate(([t, e]: string[]) => {
        const w: any = window
        w.__vus = 0
        w.__detail = null
        ;(document.querySelector(t) as any)._shadow.addEventListener(e, (ev: any) => { w.__vus++; w.__detail = ev.detail })
      }, [tag, evenement])
    }

    it('*scratch : un trait de souris gratte (des pixels deviennent transparents), le seuil lance mjs:scratch une seule fois, la couche s\'efface', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-gratte', 'canvas[mjs-fx-layer="scratch"]')
        const avant = await lit(page, 'mjs-gmp-gratte')
        assert.equal(avant.part, 0, 'toile entière au départ')
        await capture(page, 'gratte-1-entiere')
        await ecoute(page, 'mjs-gmp-gratte', 'mjs:scratch')
        await trait(page, avant, 30)
        const un = await lit(page, 'mjs-gmp-gratte')
        assert.ok(un.part! > 0.15 && un.part! < 0.5, `un trait : ${un.part}`)
        assert.equal(await page.evaluate(() => (window as any).__vus), 0, 'sous le seuil : pas d\'événement')
        await capture(page, 'gratte-2-un-trait')
        await trait(page, avant, 60)
        await trait(page, avant, 90)
        await trait(page, avant, 120)
        await page.waitForFunction(() => (window as any).__vus > 0)
        await trait(page, avant, 75)
        await trait(page, avant, 45)
        await page.waitForTimeout(500)
        assert.equal(await page.evaluate(() => (window as any).__vus), 1, 'une seule fois')
        const detail = await page.evaluate(() => (window as any).__detail)
        assert.ok(detail.part >= 0.5 && detail.part <= 1, `detail.part : ${detail.part}`)
        const fin = await lit(page, 'mjs-gmp-gratte')
        assert.equal(fin.fini, true)
        assert.equal(fin.opacite, '0', 'la couche s\'est effacée en fondu')
        await capture(page, 'gratte-3-decouverte')
      } finally {
        await browser.close()
      }
    })

    it('*scratch(image d\'une autre origine) : la toile est illisible, le seuil se mesure quand même', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-gratte-img', 'canvas[mjs-fx-scratch-done], canvas[mjs-fx-layer="scratch"]')
        await page.waitForTimeout(400)
        const avant = await lit(page, 'mjs-gmp-gratte-img')
        assert.equal(avant.part, null, 'toile marquée par l\'image : illisible')
        await capture(page, 'gratte-image-1')
        await ecoute(page, 'mjs-gmp-gratte-img', 'mjs:scratch')
        for (const dy of [20, 55, 90, 125, 75]) await trait(page, avant, dy)
        await page.waitForFunction(() => (window as any).__vus > 0)
        await page.waitForTimeout(400)
        assert.equal(await page.evaluate(() => (window as any).__vus), 1)
        assert.equal((await lit(page, 'mjs-gmp-gratte-img')).fini, true)
      } finally {
        await browser.close()
      }
    })

    it('*scratch(text, shape: square) : le mot est écrit sur la couche, le pinceau carré gratte', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-gratte-mot', 'canvas[mjs-fx-layer="scratch"]')
        const avant = await lit(page, 'mjs-gmp-gratte-mot')
        // des pixels blancs (l'encre du mot) sur la couche bleue
        const blancs = await page.evaluate(() => {
          const cv: any = (document.querySelector('mjs-gmp-gratte-mot') as any)._shadow.querySelector('canvas')
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
          let n = 0
          for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++
          return n
        })
        assert.ok(blancs > 50, `l'encre du mot : ${blancs} pixels blancs`)
        await capture(page, 'gratte-mot-1')
        await trait(page, avant, 75)
        const un = await lit(page, 'mjs-gmp-gratte-mot')
        assert.ok(un.part! > 0.15, `un trait carré : ${un.part}`)
        await capture(page, 'gratte-mot-2')
      } finally {
        await browser.close()
      }
    })

    it('*scratch(colors: $v) avec des valeurs qui ne sont pas des couleurs : la pose continue, repli sur color, avertissement au vouvoiement', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-gratte-mauvaise', 'canvas[mjs-fx-layer="scratch"]')
        const lecture = () => page.evaluate(() => {
          const sh = (document.querySelector('mjs-gmp-gratte-mauvaise') as any)._shadow
          const px = (q: string, fx: number) => {
            const cv = sh.querySelector(q + ' canvas[mjs-fx-layer="scratch"]')
            if (!cv) return null
            const d = cv.getContext('2d').getImageData(Math.round(cv.width * fx), Math.round(cv.height / 2), 1, 1).data
            return [d[0], d[1], d[2], d[3]]
          }
          return { s: px('.s', 0.5), tg: px('.t', 0.02), td: px('.t', 0.98) }
        })
        const v = await lecture()
        assert.ok(v.s, 'la toile de la couche toute fausse est posée')
        assert.deepEqual(v.s, [136, 136, 136, 255], 'repli sur color')
        assert.ok(v.tg && v.tg[0] > 200 && v.tg[2] < 60, `dégradé mixte, bord gauche rouge : ${JSON.stringify(v.tg)}`)
        assert.ok(v.td && v.td[2] > 200 && v.td[0] < 60, `dégradé mixte, bord droit bleu : ${JSON.stringify(v.td)}`)
      } finally {
        await browser.close()
      }
    })

    it('*scratch(colors illisibles) : un avertissement au vouvoiement dans la console, aucune exception', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await browser.newPage({ viewport: { width: 640, height: 320 } })
        const avertis: string[] = []
        const erreurs: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'warning') avertis.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-gmp-gratte-mauvaise></mjs-gmp-gratte-mauvaise><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-gmp-gratte-mauvaise') as any)?._shadow?.querySelector('canvas[mjs-fx-layer="scratch"]'))
        await page.waitForTimeout(200)
        assert.deepEqual(erreurs, [], 'aucune exception non attrapée')
        const dits = avertis.filter((t) => t.includes('*scratch'))
        assert.ok(dits.length >= 1, `un avertissement : ${JSON.stringify(avertis)}`)
        assert.match(dits[0], /vous|votre|Vérifiez|Donnez|Corrigez|Utilisez/i, 'au vouvoiement')
        // accordé au nombre : aucune couleur gardée, une seule écartée, deux écartées
        const un = (re: RegExp) => assert.equal(dits.filter((t) => re.test(t)).length, 1, `${re} : ${JSON.stringify(dits)}`)
        un(/ces couleurs ne sont pas lisibles \(pas-une-couleur, nope\), la couche prend la couleur de color/)
        un(/cette couleur n'est pas lisible \(pas-une-couleur\), elle est ignorée/)
        un(/ces couleurs ne sont pas lisibles \(pas-une-couleur, nope\), elles sont ignorées/)
      } finally {
        await browser.close()
      }
    })

    // la hauteur d'un paragraphe, et pour la balise `.x` ses rectangles de ligne et la part de toile couverte sous chacun
    const lignes = (page: any) => page.evaluate(() => {
      const sh: any = (document.querySelector('mjs-gmp-masque-lignes') as any)._shadow
      const hauteur = (q: string) => sh.querySelector(q).getBoundingClientRect().height
      const x  = sh.querySelector('.x')
      const cv = sh.querySelector('.x canvas[mjs-fx-layer="spoiler"]')
      const rects = Array.from(x.getClientRects()).map((r: any) => ({ x: r.left, y: r.top, w: r.width, h: r.height }))
      let couvert: number[] = []
      let dehors = 0
      let boite: any = null
      if (cv) {
        const b = cv.getBoundingClientRect()
        boite = { x: b.left, y: b.top, w: b.width, h: b.height }
        const sx = cv.width / b.width
        const sy = cv.height / b.height
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        const alpha = (px: number, py: number) => d[(py * cv.width + px) * 4 + 3]
        couvert = rects.map((r: any) => {
          let n = 0
          let t = 0
          for (let py = Math.floor((r.y - b.top) * sy); py < Math.ceil((r.y + r.h - b.top) * sy); py++) {
            for (let px = Math.floor((r.x - b.left) * sx); px < Math.ceil((r.x + r.w - b.left) * sx); px++) {
              if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) continue
              t++
              if (alpha(px, py) > 20) n++
            }
          }
          return t ? n / t : 0
        })
        // du dessin hors de tout rectangle de ligne : un grain n'a rien à faire là
        let hors = 0
        for (let py = 0; py < cv.height; py++) {
          for (let px = 0; px < cv.width; px++) {
            if (alpha(px, py) <= 20) continue
            const cx = b.left + px / sx
            const cy = b.top + py / sy
            if (!rects.some((r: any) => cx >= r.x - 2 && cx <= r.x + r.w + 2 && cy >= r.y - 2 && cy <= r.y + r.h + 2)) hors++
          }
        }
        dehors = hors
      }
      return { avec: hauteur('.p1'), sans: hauteur('.p2'), display: getComputedStyle(x).display, rects, couvert, dehors, boite, canvas: !!cv }
    })

    it('*spoiler sur un <span> qui court sur plusieurs lignes : la balise garde son display, la hauteur du paragraphe ne change pas, chaque ligne est couverte, rien en dehors', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-masque-lignes', '.x canvas')
        const v = await lignes(page)
        assert.equal(v.display, 'inline', 'le display de la balise est gardé')
        assert.equal(v.avec, v.sans, `hauteur du paragraphe avec l'effet (${v.avec}) = sans (${v.sans})`)
        assert.ok(v.rects.length >= 3, `le texte court sur ${v.rects.length} lignes`)
        assert.ok(v.canvas, 'un calque est posé')
        v.couvert.forEach((c: number, i: number) => assert.ok(c > 0.15, `la ligne ${i} est couverte de grains : ${c}`))
        assert.equal(v.dehors, 0, 'aucun grain hors des lignes du texte')
        // la mise en page change : le calque suit
        await page.setViewportSize({ width: 640, height: 320 })
        await page.evaluate(() => { ((document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.querySelector('.p1') as any).style.width = '150px' })
        await page.waitForTimeout(400)
        const w = await lignes(page)
        assert.ok(w.rects.length > v.rects.length, 'plus de lignes dans un paragraphe plus étroit')
        w.couvert.forEach((c: number, i: number) => assert.ok(c > 0.15, `après resserrement, la ligne ${i} est couverte : ${c}`))
        assert.equal(w.dehors, 0, 'après resserrement, aucun grain hors des lignes')
        // la révélation : la mise en page reste, le calque est transparent
        await page.evaluate(() => { ((document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.querySelector('.p1') as any).style.width = '' })
        const c = await page.evaluate(() => { const r = ((document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.querySelector('.x') as any).getClientRects()[1]; return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
        await page.mouse.click(c.x, c.y)
        await page.waitForTimeout(300)
        const apres = await page.evaluate(() => {
          const sh: any = (document.querySelector('mjs-gmp-masque-lignes') as any)._shadow
          return { h1: sh.querySelector('.p1').getBoundingClientRect().height, h2: sh.querySelector('.p2').getBoundingClientRect().height, display: getComputedStyle(sh.querySelector('.x')).display, inline: sh.querySelector('.x').style.display, opacite: getComputedStyle(sh.querySelector('.x canvas')).opacity }
        })
        assert.equal(apres.h1, apres.h2, 'après la révélation, la hauteur est la même qu\'un paragraphe sans effet')
        assert.equal(apres.display, 'inline')
        assert.equal(apres.inline, '')
        assert.equal(apres.opacite, '0')
      } finally {
        await browser.close()
      }
    })

    it('*spoiler(bar) sur un <span> en ligne : le calque suit une police arrivée tard et un texte réécrit, même quand le paragraphe garde sa taille', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-masque-barre', '.x canvas')
        // la boîte des lignes du texte et celle du calque
        const boites = () => page.evaluate(() => {
          const sh: any = (document.querySelector('mjs-gmp-masque-barre') as any)._shadow
          const rs = (Array.from(sh.querySelector('.x').getClientRects()) as any[]).filter((r) => r.width > 0 && r.height > 0)
          const b  = sh.querySelector('.x canvas[mjs-fx-layer="spoiler"]').getBoundingClientRect()
          return {
            lignes: rs.length,
            texte:  [Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)), Math.max(...rs.map((r) => r.right)), Math.max(...rs.map((r) => r.bottom))].map(Math.round),
            calque: [b.left, b.top, b.right, b.bottom].map(Math.round)
          }
        })
        const suit = (v: any) => v.texte.every((n: number, i: number) => Math.abs(n - v.calque[i]) <= 2)
        const v = await boites()
        assert.ok(v.lignes >= 2, `le texte court sur ${v.lignes} lignes`)
        assert.ok(suit(v), 'au départ, le calque couvre les lignes : ' + JSON.stringify(v))
        // une police qui n'arrive qu'après la pose : les lignes changent, le paragraphe garde sa taille
        await page.evaluate(async () => {
          ((document.querySelector('mjs-gmp-masque-barre') as any)._shadow.querySelector('.p1') as any).style.fontFamily = 'Variable'
          await document.fonts.load('24px Variable')
          await document.fonts.ready
        })
        await page.waitForTimeout(400)
        const f = await boites()
        assert.notDeepEqual(f.texte, v.texte, 'la police a changé les lignes')
        assert.ok(suit(f), 'le calque suit la police arrivée tard : ' + JSON.stringify(f))
        // le texte réécrit par une variable
        await page.evaluate(() => ((document.querySelector('mjs-gmp-masque-barre') as any)._shadow.querySelector('.b') as any).click())
        await page.waitForTimeout(400)
        const w = await boites()
        assert.equal(w.lignes, 1, 'le texte réécrit tient sur une ligne')
        assert.ok(suit(w), 'le calque suit le texte réécrit : ' + JSON.stringify(w))
        // le texte vidé : plus de ligne, plus de barre (l'ancienne boîte ne reste pas peinte)
        await page.evaluate(() => ((document.querySelector('mjs-gmp-masque-barre') as any)._shadow.querySelector('.v') as any).click())
        await page.waitForTimeout(400)
        const vide = await page.evaluate(() => {
          const b = ((document.querySelector('mjs-gmp-masque-barre') as any)._shadow.querySelector('.x canvas[mjs-fx-layer="spoiler"]') as any).getBoundingClientRect()
          return { w: b.width, h: b.height }
        })
        assert.ok(vide.w < 1 || vide.h < 1, 'le texte vidé : le calque n\'a plus de surface — ' + JSON.stringify(vide))
      } finally {
        await browser.close()
      }
    })

    it('*spoiler : un lien dans le texte caché n\'est pas atteignable à la tabulation, il l\'est de nouveau une fois révélé', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-masque-lignes', '.l canvas')
        const actif = () => page.evaluate(() => { const a: any = (document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.activeElement; return a ? a.className : '' })
        const lien  = () => page.evaluate(() => { const a: any = (document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.querySelector('.a'); return { tab: a.getAttribute('tabindex'), inert: a.hasAttribute('inert') } })
        await page.evaluate(() => (document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.querySelector('.av').focus())
        await page.keyboard.press('Tab')
        assert.equal(await actif(), 'l', 'Tab arrive sur le texte caché')
        await page.keyboard.press('Tab')
        assert.notEqual(await actif(), 'a', 'Tab ne tombe pas sur le lien caché')
        const cache = await lien()
        assert.ok(cache.tab === '-1' || cache.inert, `le lien est mis hors de la tabulation : ${JSON.stringify(cache)}`)
        await page.evaluate(() => (document.querySelector('mjs-gmp-masque-lignes') as any)._shadow.querySelector('.l').focus())
        await page.keyboard.press('Enter')
        await page.waitForTimeout(250)
        const revele = await lien()
        assert.deepEqual(revele, { tab: null, inert: false }, 'le lien est rendu comme il était')
      } finally {
        await browser.close()
      }
    })

    it('*spoiler : texte transparent et non sélectionnable ; un clic révèle, again recache, Entrée révèle', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-masque', '.x')
        const etat = (sel: string) => page.evaluate((s: string) => {
          const el: any = (document.querySelector('mjs-gmp-masque') as any)._shadow.querySelector(s)
          const cs = getComputedStyle(el)
          return { cache: el.hasAttribute('mjs-fx-spoiler-hidden'), couleur: cs.color, selection: cs.userSelect || (cs as any).webkitUserSelect, role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex'), label: el.getAttribute('aria-label') }
        }, sel)
        const cache = await etat('.x')
        assert.equal(cache.cache, true)
        assert.equal(cache.couleur, 'rgba(0, 0, 0, 0)', 'texte transparent')
        assert.equal(cache.selection, 'none', 'non sélectionnable')
        assert.equal(cache.role, 'button')
        assert.equal(cache.tabindex, '0')
        assert.equal(cache.label, 'Texte masqué, activer pour l\'afficher')
        // des grains sont dessinés sur le texte caché
        const grains = await page.evaluate(() => {
          const cv: any = (document.querySelector('mjs-gmp-masque') as any)._shadow.querySelector('.x canvas')
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
          let n = 0
          for (let i = 3; i < d.length; i += 4) if (d[i] > 100) n++
          return n / (d.length / 4)
        })
        assert.ok(grains > 0.2, `part de la toile couverte de grains : ${grains}`)
        await capture(page, 'masque-1-cache')
        await ecoute(page, 'mjs-gmp-masque', 'mjs:reveal')
        await clique(page, '.x')
        await page.waitForTimeout(200)
        const revele = await etat('.x')
        assert.equal(revele.cache, false)
        assert.notEqual(revele.couleur, 'rgba(0, 0, 0, 0)', 'le texte est revenu')
        assert.equal(revele.role, null)
        assert.equal(await page.evaluate(() => (window as any).__vus), 1, 'mjs:reveal remonte jusqu\'au shadow')
        await capture(page, 'masque-2-revele')
        await clique(page, '.x')
        await page.waitForTimeout(200)
        assert.equal((await etat('.x')).cache, true, 'again : un second clic recache')
        // le clavier : Tab arrive sur le texte caché, Entrée le révèle
        await page.evaluate(() => (document.querySelector('mjs-gmp-masque') as any)._shadow.querySelector('.x').focus())
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
        assert.equal((await etat('.x')).cache, false, 'Entrée révèle')
        // les trois autres styles : cachés eux aussi
        for (const s of ['.y', '.z', '.w']) {
          const e = await etat(s)
          assert.equal(e.cache, true, s)
          assert.equal(e.selection, 'none', s)
        }
        await capture(page, 'masque-3-styles')
      } finally {
        await browser.close()
      }
    })

    // les lettres du titre : mode choisi, largeurs, hauteurs, ce qui est écrit sur chacune, centre de la première
    const lettres = (page: any, tag: string) => page.evaluate((t: string) => {
      const g: any = (document.querySelector(t) as any)._shadow.querySelector('.g')
      const ls = Array.from(g.querySelectorAll('[mjs-fx-letter]')) as any[]
      const r  = ls.map((l) => l.getBoundingClientRect())
      return { mode: g.getAttribute('mjs-fx-weight-mode'), largeurs: r.map((b) => b.width), hauteurs: r.map((b) => b.height), x0: r[0].left + r[0].width / 2, y0: r[0].top + r[0].height / 2, styles: ls.map((l) => l.style.fontVariationSettings || l.style.fontWeight || l.style.transform), n: ls.length }
    }, tag)

    it('*weight : police variable reconnue à la mesure ; la lettre sous la souris est plus grasse (plus large) que la plus lointaine, au repos tout revient', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-graisse', '.g')
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(300)
        const repos = await lettres(page, 'mjs-gmp-graisse')
        assert.equal(repos.mode, 'variable', 'la police variable est reconnue à la mesure, même arrivée après la pose')
        await capture(page, 'graisse-1-repos')
        await page.mouse.move(repos.x0, repos.y0)
        await page.waitForTimeout(500)
        const sous = await lettres(page, 'mjs-gmp-graisse')
        assert.ok(sous.largeurs[0] > repos.largeurs[0] + 0.4, `la première lettre s'élargit : ${repos.largeurs[0]} → ${sous.largeurs[0]}`)
        assert.ok(Math.abs(sous.largeurs[sous.n - 1] - repos.largeurs[repos.n - 1]) < 0.6, 'la plus lointaine ne bouge pas')
        const poids = (v: string) => parseInt((/(\d+)$/.exec(v) ?? ['', '0'])[1], 10)
        assert.ok(poids(sous.styles[0]) > poids(sous.styles[sous.n - 1]), `graisses : ${sous.styles[0]} contre ${sous.styles[sous.n - 1]}`)
        await capture(page, 'graisse-2-souris')
        await page.mouse.move(620, 310)
        await page.waitForTimeout(500)
        const fin = await lettres(page, 'mjs-gmp-graisse')
        assert.ok(Math.abs(fin.largeurs[0] - repos.largeurs[0]) < 0.6, 'la lettre revient à sa graisse de repos')
      } finally {
        await browser.close()
      }
    })

    it('*weight sans police variable : des graisses par crans (auto), la lettre sous la souris prend la graisse 900 ; fallback: stretch étire la lettre', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-graisse-crans', '.g')
        const repos = await lettres(page, 'mjs-gmp-graisse-crans')
        assert.equal(repos.mode, 'steps', 'auto : les graisses de la police, par crans')
        await page.mouse.move(repos.x0, repos.y0)
        await page.waitForTimeout(500)
        const sous = await lettres(page, 'mjs-gmp-graisse-crans')
        assert.equal(sous.styles[0], '900')
        assert.equal(sous.styles[sous.n - 1], '300')
        await capture(page, 'graisse-3-crans')
        const page2 = await ouvre(browser, 'mjs-gmp-graisse-etire', '.g')
        const plat = await lettres(page2, 'mjs-gmp-graisse-etire')
        assert.equal(plat.mode, 'stretch')
        await page2.mouse.move(plat.x0, plat.y0)
        await page2.waitForTimeout(500)
        const haut = await lettres(page2, 'mjs-gmp-graisse-etire')
        assert.ok(haut.hauteurs[0] > plat.hauteurs[0] * 1.2, `la lettre s'étire : ${plat.hauteurs[0]} → ${haut.hauteurs[0]}`)
        await capture(page2, 'graisse-4-etirement')
      } finally {
        await browser.close()
      }
    })

    it('*weight(idle) : sans souris, la vague parcourt le mot toute seule', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await ouvre(browser, 'mjs-gmp-graisse-ondule', '.g')
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(400)
        const a = await lettres(page, 'mjs-gmp-graisse-ondule')
        await page.waitForTimeout(500)
        const b = await lettres(page, 'mjs-gmp-graisse-ondule')
        assert.equal(a.mode, 'variable')
        const gras = (l: any) => l.styles.map((v: string) => parseInt((/(\d+)$/.exec(v) ?? ['', '0'])[1], 10))
        assert.ok(Math.max(...gras(a)) > Math.min(...gras(a)), `la vague épaissit certaines lettres : ${a.styles.join(' | ')}`)
        assert.notDeepEqual(a.styles, b.styles, 'la vague avance')
      } finally {
        await browser.close()
      }
    })
  })
}
