// *sprite dans Chromium, Firefox et WebKit réels : chaque pose de la planche tombe à sa place (la couleur du centre de
// la balise, case par case — une planche à plusieurs lignes dont la dernière est incomplète comprise), le
// sens inverse et l'aller-retour, le survol et le clic, l'image qui ne part qu'à l'approche de l'écran,
// la pause hors écran et onglet caché, « réduire les animations », la taille d'une pose pour une balise
// sans taille, un composant, les réglages qui suivent sans reposer l'effet, le retrait, et rien qui
// tourne au repos (ni minuterie ni requestAnimationFrame), le bord de la balise à quatre densités d'écran (jamais
// un trait de la pose voisine), les feuilles d'images clés rendues avec leur dernier usager, will-change retiré à
// la fin d'un tour, l'image absente. Variable d'environnement MJS_CAPTURES : un
// dossier où poser une capture de chaque état (pour les regarder).

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

type Pixel = { r: number, g: number, b: number }

// la couleur de la pose k : unie, loin de toutes les autres
const couleur = (k: number): Pixel => ({ r: (30 + 61 * k) % 256, g: (((220 - 47 * k) % 256) + 256) % 256, b: (80 + 83 * k) % 256 })

// une planche dessinée : `frames` cases unies de cw × ch, `columns` par ligne (les cases d'une ligne incomplète restent vides)
function feuille(frames: number, columns: number, cw = 40, ch = 30): string {
  const lignes = Math.ceil(frames / columns)
  let g = ''
  for (let k = 0; k < frames; k++) {
    const c = couleur(k)
    g += `<rect x="${(k % columns) * cw}" y="${Math.floor(k / columns) * ch}" width="${cw}" height="${ch}" fill="rgb(${c.r},${c.g},${c.b})"/>`
  }
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cw}" height="${lignes * ch}">${g}</svg>`)
}

const IMG   = feuille(10, 4)
const IMG12 = feuille(12, 3)
const STYLE = '<style>\n.a\n  width: 40px\n  height: 30px\n</style>'
const VARS  = `<script>\n$img = '${IMG}'\n</script>\n`
const scene = (fx: string, extra = '', style = STYLE) => `${VARS}<div class="a" *sprite(image: $img, ${fx})></div>${extra}\n${style}`

const SOURCES: Record<string, string> = {
  'sp-grille.mjs':   scene('frames: 10, columns: 4, speed: 1s'),
  'sp-inverse.mjs':  scene('frames: 10, columns: 4, speed: 1s, direction: reverse'),
  'sp-alterne.mjs':  scene('frames: 10, columns: 4, speed: 1s, direction: alternate'),
  'sp-survol.mjs':   scene('frames: 10, columns: 4, speed: 1s, on: hover, start: 6', '<p class="loin">ailleurs</p>'),
  'sp-clic.mjs':     scene('frames: 10, columns: 4, speed: 300ms, on: click, repeat: 1, start: 2', '<p class="loin">ailleurs</p>'),
  'sp-pixel.mjs':    scene('frames: 10, columns: 4, pixel: true'),
  'sp-loin.mjs':     `${VARS}<div class="espace"></div><div class="a" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></div>\n<style>\n.espace\n  height: 3000px\n.a\n  width: 40px\n  height: 30px\n</style>`,
  'sp-taille.mjs':   `${VARS}<div class="s1" *sprite(image: $img, frames: 10, columns: 4)></div><div class="s2" *sprite(image: $img, frames: 10, columns: 4)></div><div class="s3" *sprite(image: $img, frames: 10, columns: 4)></div><span class="s4" *sprite(image: $img, frames: 10, columns: 4)></span><div class="s5" *sprite(image: $img, frames: 10, columns: 4)></div>\n<style>\n.s2\n  width: 80px\n.s3\n  width: 100px\n  height: 100px\n.s5\n  height: 60px\n</style>`,
  'sp-variantes.mjs': `<script>\n$img = { src: '/a-1200.svg', srcset: '/a-200.svg 200w, /a-400.svg 400w, /a-1200.svg 1200w' }\n</script>\n<div class="a" *sprite(image: $img, frames: 10, columns: 4)></div>\n<style>\n.a\n  width: 100px\n  height: 30px\n</style>`,
  'sp-boite.mjs':    '<div class="dedans">x</div>',
  'sp-hote.mjs':     `${VARS}<@sp-boite class="h" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></@sp-boite>\n<style>\n.h\n  display: block\n  width: 40px\n  height: 30px\n</style>`,
  'sp-vars.mjs':     `<script>\n$img = '${IMG}'\n$v = '1s'\n$d = 'normal'\n$n = 0\n</script>\n<div class="a" *sprite(image: $img, frames: 10, columns: 4, speed: $v, direction: $d, repeat: $n)></div>\n<button class="bv" @click={$v = '2s'}>v</button><button class="bd" @click={$d = 'reverse'}>d</button><button class="bn" @click={$n = 3}>n</button>\n${STYLE}`,
  'sp-retrait.mjs':  `<script>\n$on = true\n$img = '${IMG}'\n</script>\n{if $on}<div class="a" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></div><span class="b" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></span>{end}\n<button class="t" @click={$on = !$on}>t</button>\n${STYLE}`,
  'sp-feuilles.mjs': `<script>\n$on = true\n$fr = 10\n$co = 4\n$img = '${IMG}'\n</script>\n{if $on}<div class="a" *sprite(image: $img, frames: $fr, columns: $co)></div><div class="b" *sprite(image: $img, frames: 10, columns: 4)></div>{end}\n<button class="t" @click={$on = !$on}>t</button><button class="bf" @click={$fr = 6}>f</button><button class="bc" @click={$co = 5}>c</button>\n<style>\n.a, .b\n  width: 40px\n  height: 30px\n</style>`,
  'sp-densite.mjs':  `${VARS}<div class="a" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></div><div class="b" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></div><div class="c" *sprite(image: $img, frames: 10, columns: 4, speed: 1s)></div>\n<style>\n.a, .b, .c\n  position: absolute\n  top: 8px\n  background: #f0f\n.a\n  left: 8px\n  width: 40px\n  height: 30px\n.b\n  left: 60px\n  width: 33.3px\n  height: 24.9px\n.c\n  left: 108px\n  width: 12.5px\n  height: 9.5px\n</style>`,
  'sp-fini.mjs':     scene('frames: 10, columns: 4, speed: 10s, repeat: 1, on: load'),
  'sp-poses.mjs':    `<script>\n$img = '${IMG12}'\n</script>\n<div class="a" *sprite(image: $img, columns: 3, rows: 4, row: 2, poses: [1, 2, 1, 0], fps: 4)></div>\n${STYLE}`,
  'sp-cap.mjs':      `<script>\n$img = '${IMG12}'\n$dir = 0\n</script>\n<div class="a" *sprite(image: $img, columns: 3, rows: 4, row: $dir, poses: [0, 1, 2], fps: 3)></div>\n<button class="b0" @click={$dir = 3}>d</button>\n${STYLE}`,
  'sp-arret.mjs':    `<script>\n$img = '${IMG12}'\n$en = true\n</script>\n<div class="a" *sprite(image: $img, frames: 12, columns: 3, start: 4, speed: 1s, animate: $en)></div>\n<button class="bo" @click={$en = !$en}>o</button>\n${STYLE}`,
  'sp-garde.mjs':    `<script>\n$img = '${IMG12}'\n$fin = 0\n</script>\n<div class="a" *sprite(image: $img, frames: 12, columns: 3, speed: 200ms, repeat: 1, on: load, hold: true) @mjs:sprite-end={$fin++}></div><div class="b" *sprite(image: $img, frames: 12, columns: 3, speed: 200ms, repeat: 1, on: load)></div><p class="n">{$fin}</p>\n<style>\n.a, .b\n  width: 40px\n  height: 30px\n</style>`,
  'sp-tours.mjs':    `<script>\n$img = '${IMG12}'\n$fin = 0\n</script>\n<div class="a" *sprite(image: $img, frames: 12, columns: 3, speed: 150ms, repeat: 3) @mjs:sprite-end={$fin++}></div><p class="n">{$fin}</p>\n${STYLE}`,
  'sp-absente.mjs':  `<div class="a" *sprite(image: '/absente.png', frames: 4, speed: 1s)></div>\n${STYLE}`
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*sprite (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de *sprite sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      // les couleurs des poses se distinguent à coup sûr
      for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
        const a = couleur(i), b = couleur(j)
        assert.ok(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) > 60, `poses ${i} et ${j} trop proches`)
      }
      const root   = mjsTmp('effets-sprite-browser-' + nom)
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
    })

    after(async () => { await terminateSharedWorkerPool() })

    const LIGNE = '[mjs-fx-layer="sprite"]'

    // ouvre la page d'un composant ; `attend` : le calque est posé (faux : l'image attend l'approche de l'écran ;
    // un sélecteur : la balise d'un composant, dont le calque est dans le shadow)
    async function ouvre(browser: any, tag: string, attend: boolean | string = true, densite = 0) {
      // une densité d'écran : celle de Chromium est la vraie (lancé avec la densité de son écran), celle de Firefox et de WebKit est posée par la page
      const page = densite && nom === 'chromium' ? await browser.newPage({ viewport: null }) : await browser.newPage({ viewport: { width: 400, height: 500 }, ...(densite ? { deviceScaleFactor: densite } : {}) })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      await page.route('http://t.test/**', (route: any) => {
        // les variantes d'une image à plusieurs tailles : une image vide suffit, la page ne doit pas voir d'erreur de chargement
        if (route.request().url().endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="30"/>' })
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, l, h]: string[]) => {
        const sh = (document.querySelector(t) as any)?._shadow
        if (!sh) return false
        const e = h ? sh.querySelector(h) : null
        return h ? !!e && !!e._shadow && !!e._shadow.querySelector(l) : !!sh.querySelector(l)
      }, [tag, attend === false ? '.a' : LIGNE, typeof attend === 'string' ? attend : ''])
      await page.waitForTimeout(300)
      return { page, erreurs }
    }

    // la balise `sel` du composant : sa boîte dans la page
    const boite = (page: any, tag: string, sel = '.a') => page.evaluate(([t, s]: string[]) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector(s).getBoundingClientRect()
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
    }, [tag, sel])

    // le calque : ce que le navigateur en calcule
    const calcule = (page: any, tag: string, sel = '.a') => page.evaluate(([t, s, l]: string[]) => {
      const host  = (document.querySelector(t) as any)._shadow.querySelector(s)
      const inner = host._shadow || host
      const layer = inner.querySelector(l)
      if (!layer) return null
      const cs = getComputedStyle(layer)
      const hs = getComputedStyle(host)
      const r  = layer.getBoundingClientRect()
      return { nom: cs.animationName, etat: cs.animationPlayState, duree: cs.animationDuration, sens: cs.animationDirection, tours: cs.animationIterationCount, courbe: cs.animationTimingFunction, will: cs.willChange, events: cs.pointerEvents, rendu: cs.imageRendering, aria: layer.getAttribute('aria-hidden'), w: r.width, h: r.height, anims: layer.getAnimations().length, rogne: hs.overflowX, display: hs.display }
    }, [tag, sel, LIGNE])

    // fige l'animation du calque à `ms` ms de son cycle
    const fige = (page: any, tag: string, ms: number, sel = '.a') => page.evaluate(([t, s, l, m]: [string, string, string, number]) => {
      const host  = (document.querySelector(t) as any)._shadow.querySelector(s)
      const layer = (host._shadow || host).querySelector(l)
      const a     = layer.getAnimations()[0]
      a.pause()
      a.currentTime = m
    }, [tag, sel, LIGNE, ms])

    // la couleur d'un pixel de la page (par une capture de 3 × 3 autour du point)
    async function pixel(page: any, x: number, y: number): Promise<Pixel> {
      const png = await page.screenshot({ clip: { x: x - 1, y: y - 1, width: 3, height: 3 } })
      return page.evaluate(async (b64: string) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const d = c.getImageData(1, 1, 1, 1).data
        return { r: d[0], g: d[1], b: d[2] }
      }, png.toString('base64'))
    }

    const proche = (p: Pixel, q: Pixel) => Math.abs(p.r - q.r) <= 3 && Math.abs(p.g - q.g) <= 3 && Math.abs(p.b - q.b) <= 3
    // la pose vue au centre de la balise
    async function pose(page: any, tag: string, sel = '.a'): Promise<number> {
      const r = await boite(page, tag, sel)
      const p = await pixel(page, r.x + r.w / 2, r.y + r.h / 2)
      for (let k = 0; k < 12; k++) if (proche(p, couleur(k))) return k
      return -1
    }

    const capture = async (page: any, nomFichier: string) => {
      const dir = process.env.MJS_CAPTURES
      if (dir) await page.screenshot({ path: join(dir, `sprite-${nom}-${nomFichier}.png`), clip: { x: 0, y: 0, width: 200, height: 120 } })
    }

    async function avec(tag: string, corps: (page: any, erreurs: string[]) => Promise<void>, attend: boolean | string = true, densite = 0) {
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch(nom === 'chromium' && densite ? { args: [`--force-device-scale-factor=${densite}`, '--window-size=400,300'] } : {})
      try {
        const { page, erreurs } = await ouvre(browser, tag, attend, densite)
        await corps(page, erreurs)
        assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement en console')
        await page.close()
      } finally {
        await browser.close()
      }
    }

    it('chaque pose tombe à sa place : dix poses sur quatre colonnes (dernière ligne de deux), calque 160 × 90 sous une balise de 40 × 30 qui rogne', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-grille', async (page) => {
        const c = await calcule(page, 'mjs-sp-grille')
        assert.equal(c.nom, 'mjs-fx-sprite-10-4')
        assert.equal(c.etat, 'running')
        assert.equal(c.anims, 1, 'une seule animation couvre toute la planche')
        assert.equal(c.duree, '1s')
        assert.equal(c.tours, 'infinite')
        assert.match(c.courbe, /^(steps\(1|step-end)/, 'chaque pose tenue d\'un bond')
        assert.equal(c.will, 'translate', 'will-change pendant le mouvement')
        assert.equal(c.events, 'none', 'le calque ne capte pas la souris')
        assert.equal(c.aria, 'true')
        assert.deepEqual([c.w, c.h], [160, 90], 'la planche entière : quatre poses de large, trois de haut')
        assert.ok(c.rogne === 'clip' || c.rogne === 'hidden', 'la balise rogne : ' + c.rogne)
        for (let k = 0; k < 10; k++) {
          await fige(page, 'mjs-sp-grille', (k + 0.5) * 100)
          assert.equal(await pose(page, 'mjs-sp-grille'), k, `à ${(k + 0.5) * 100} ms : la pose ${k}`)
        }
        await capture(page, 'grille')
      })
    })

    it('direction: reverse — de la dernière pose à la première, dès l\'instant zéro ; alternate — l\'aller, puis le retour', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-inverse', async (page) => {
        for (const [ms, k] of [[0, 9], [50, 9], [150, 8], [950, 0]]) {
          await fige(page, 'mjs-sp-inverse', ms)
          assert.equal(await pose(page, 'mjs-sp-inverse'), k, `reverse à ${ms} ms : la pose ${k}`)
        }
      })
      await avec('mjs-sp-alterne', async (page) => {
        for (const [ms, k] of [[50, 0], [950, 9], [1050, 9], [1450, 5], [1950, 0]]) {
          await fige(page, 'mjs-sp-alterne', ms)
          assert.equal(await pose(page, 'mjs-sp-alterne'), k, `alternate à ${ms} ms : la pose ${k}`)
        }
      })
    })

    it('on: hover — au repos la pose start, sans animation ni will-change ; le survol lance les poses ; la sortie rend la pose start', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-survol', async (page) => {
        const r = await boite(page, 'mjs-sp-survol')
        let c = await calcule(page, 'mjs-sp-survol')
        assert.equal(c.nom, 'none')
        assert.equal(c.anims, 0)
        assert.equal(c.will, 'auto')
        assert.equal(await pose(page, 'mjs-sp-survol'), 6, 'au repos : start: 6')
        await page.mouse.move(r.x + 20, r.y + 15)
        await page.waitForTimeout(100)
        c = await calcule(page, 'mjs-sp-survol')
        assert.equal(c.nom, 'mjs-fx-sprite-10-4')
        assert.equal(c.anims, 1)
        assert.equal(c.will, 'translate')
        await fige(page, 'mjs-sp-survol', 250)
        assert.equal(await pose(page, 'mjs-sp-survol'), 2, 'au survol : les poses défilent depuis la première')
        await page.mouse.move(300, 300)
        await page.waitForTimeout(100)
        c = await calcule(page, 'mjs-sp-survol')
        assert.equal(c.nom, 'none')
        assert.equal(c.will, 'auto')
        assert.equal(await pose(page, 'mjs-sp-survol'), 6, 'à la sortie : la pose start')
      })
    })

    it('on: click, repeat: 1 — un tour par clic, puis la pose start ; un nouveau clic rejoue', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-clic', async (page) => {
        const r = await boite(page, 'mjs-sp-clic')
        assert.equal((await calcule(page, 'mjs-sp-clic')).anims, 0)
        assert.equal(await pose(page, 'mjs-sp-clic'), 2, 'au repos : start: 2')
        await page.mouse.click(r.x + 20, r.y + 15)
        await page.waitForTimeout(40)
        assert.equal((await calcule(page, 'mjs-sp-clic')).anims, 1, 'le clic lance le tour')
        await fige(page, 'mjs-sp-clic', 150)
        assert.equal(await pose(page, 'mjs-sp-clic'), 5, 'à mi-tour : la pose 5')
        await page.evaluate(([t, l]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector('.a').querySelector(l)).getAnimations()[0].finish() }, ['mjs-sp-clic', LIGNE])
        await page.waitForTimeout(80)
        assert.equal((await calcule(page, 'mjs-sp-clic')).anims, 0, 'un tour : fini')
        assert.equal(await pose(page, 'mjs-sp-clic'), 2, 'le tour fini revient à la pose start')
        await page.mouse.click(r.x + 20, r.y + 15)
        await page.waitForTimeout(40)
        assert.equal((await calcule(page, 'mjs-sp-clic')).anims, 1, 'un second clic rejoue le tour')
      })
    })

    it('l\'image ne part qu\'à l\'approche de l\'écran ; hors écran l\'animation est en pause (will-change retiré), à l\'écran elle repart', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-loin', async (page) => {
        assert.equal(await calcule(page, 'mjs-sp-loin'), null, 'loin de l\'écran : ni calque ni image')
        assert.ok(await page.evaluate(() => ((document.querySelector('mjs-sp-loin') as any)._shadow.querySelector('.a').getAttribute('mjs-fx') || '').includes('sprite')), 'la marque est là')
        await page.evaluate(() => scrollTo(0, 2900))
        await page.waitForFunction(() => !!(document.querySelector('mjs-sp-loin') as any)._shadow.querySelector('[mjs-fx-layer="sprite"]'))
        await page.waitForTimeout(200)
        let c = await calcule(page, 'mjs-sp-loin')
        assert.equal(c.anims, 1)
        assert.equal(c.etat, 'running')
        await page.evaluate(() => scrollTo(0, 0))
        await page.waitForFunction(() => getComputedStyle((document.querySelector('mjs-sp-loin') as any)._shadow.querySelector('[mjs-fx-layer="sprite"]')).animationPlayState === 'paused')
        c = await calcule(page, 'mjs-sp-loin')
        assert.equal(c.will, 'auto', 'hors écran : plus de will-change')
        await page.evaluate(() => scrollTo(0, 2900))
        await page.waitForFunction(() => getComputedStyle((document.querySelector('mjs-sp-loin') as any)._shadow.querySelector('[mjs-fx-layer="sprite"]')).animationPlayState === 'running')
        c = await calcule(page, 'mjs-sp-loin')
        assert.equal(c.will, 'translate')
      }, false)
    })

    it('onglet caché : en pause ; de retour : en marche', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-grille', async (page) => {
        assert.equal((await calcule(page, 'mjs-sp-grille')).etat, 'running')
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
        let c = await calcule(page, 'mjs-sp-grille')
        assert.equal(c.etat, 'paused')
        assert.equal(c.will, 'auto')
        await page.evaluate(() => { delete (document as any).hidden; document.dispatchEvent(new Event('visibilitychange')) })
        c = await calcule(page, 'mjs-sp-grille')
        assert.equal(c.etat, 'running')
        assert.equal(c.will, 'translate')
      })
    })

    it('« réduire les animations » : la pose start, figée ; sans cette demande, l\'animation repart d\'elle-même', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-grille', async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.waitForTimeout(100)
        const c = await calcule(page, 'mjs-sp-grille')
        assert.equal(c.nom, 'none')
        assert.equal(c.anims, 0)
        assert.equal(c.will, 'auto')
        assert.equal(await pose(page, 'mjs-sp-grille'), 0, 'figée sur la pose start')
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.waitForTimeout(100)
        assert.equal((await calcule(page, 'mjs-sp-grille')).anims, 1)
      })
    })

    it('une balise sans taille prend celle d\'une pose (40 × 30), la taille de l\'auteur l\'emporte et le rapport d\'une pose est gardé', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-taille', async (page) => {
        await page.waitForFunction(() => (document.querySelector('mjs-sp-taille') as any)._shadow.querySelector('.s1').hasAttribute('mjs-fx-sprite-sized'))
        const t = async (s: string) => { const r = await boite(page, 'mjs-sp-taille', s); return [r.w, r.h] }
        assert.deepEqual(await t('.s1'), [40, 30], 'sans taille : celle d\'une pose')
        assert.deepEqual(await t('.s2'), [80, 60], 'largeur donnée : la hauteur suit le rapport d\'une pose')
        assert.deepEqual(await t('.s3'), [100, 100], 'largeur et hauteur données : rien ne bouge')
        assert.deepEqual(await t('.s5'), [80, 60], 'hauteur seule : la largeur suit le rapport d\'une pose, la pose n\'est pas étirée')
        assert.deepEqual(await t('.s4'), [40, 30], 'une balise en ligne devient en bloc en ligne et prend aussi la taille d\'une pose')
        assert.equal((await page.evaluate(() => getComputedStyle((document.querySelector('mjs-sp-taille') as any)._shadow.querySelector('.s4')).display)), 'inline-block')
      })
    })

    it('pixel: true — rendu net, sans lissage', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-pixel', async (page) => {
        assert.equal((await calcule(page, 'mjs-sp-pixel')).rendu, 'pixelated')
      })
      await avec('mjs-sp-grille', async (page) => {
        assert.notEqual((await calcule(page, 'mjs-sp-grille')).rendu, 'pixelated')
      })
    })

    it('une image à plusieurs tailles : la variante se choisit sur la largeur de la planche entière (quatre poses de 100 px = 400 px), pas d\'une pose', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-variantes', async (page) => {
        const choisie = await page.evaluate(([t, l]: string[]) => ((document.querySelector(t) as any)._shadow.querySelector('.a').querySelector(l)).style.getPropertyValue('--mjs-fx-sprite-img'), ['mjs-sp-variantes', LIGNE])
        assert.equal(choisie, 'url("/a-400.svg")')
      })
    })

    it('posé sur un composant : le calque et les images clés sont dans son shadow, les poses tombent à leur place', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-hote', async (page) => {
        const c = await calcule(page, 'mjs-sp-hote', '.h')
        assert.equal(c.anims, 1)
        assert.equal(c.nom, 'mjs-fx-sprite-10-4')
        assert.ok(c.rogne === 'clip' || c.rogne === 'hidden')
        for (const k of [0, 3, 7, 9]) {
          await fige(page, 'mjs-sp-hote', (k + 0.5) * 100, '.h')
          assert.equal(await pose(page, 'mjs-sp-hote', '.h'), k, `composant : la pose ${k}`)
        }
      }, '.h')
    })

    it('speed, direction et repeat suivent sans reposer l\'effet : même calque, même animation', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-vars', async (page) => {
        await page.evaluate(([t, l]: string[]) => {
          const layer = (document.querySelector(t) as any)._shadow.querySelector('.a').querySelector(l)
          ;(window as any).__calque = layer
          ;(window as any).__anim   = layer.getAnimations()[0]
        }, ['mjs-sp-vars', LIGNE])
        const clic = (b: string) => page.evaluate(([t, s]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement).click() }, ['mjs-sp-vars', b])
        let c = await calcule(page, 'mjs-sp-vars')
        assert.deepEqual([c.duree, c.sens, c.tours], ['1s', 'normal', 'infinite'])
        await clic('.bv')
        await clic('.bd')
        await clic('.bn')
        await page.waitForTimeout(100)
        c = await calcule(page, 'mjs-sp-vars')
        assert.deepEqual([c.duree, c.sens, c.tours], ['2s', 'reverse', '3'])
        const memes = await page.evaluate(([t, l]: string[]) => {
          const layer = (document.querySelector(t) as any)._shadow.querySelector('.a').querySelector(l)
          return { calque: layer === (window as any).__calque, anim: layer.getAnimations()[0] === (window as any).__anim }
        }, ['mjs-sp-vars', LIGNE])
        assert.deepEqual(memes, { calque: true, anim: true }, 'rien n\'a été reposé')
      })
    })

    it('le retrait ({if} refermé) enlève le calque, les marques, les variables et l\'animation, et rend la position, l\'affichage et la taille d\'origine', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-retrait', async (page) => {
        assert.equal((await calcule(page, 'mjs-sp-retrait')).anims, 1)
        // les deux balises, gardées en main : elles sortent de la page au retrait, leur état se lit encore
        await page.waitForFunction(() => { const sh = (document.querySelector('mjs-sp-retrait') as any)._shadow; return sh.querySelector('.a').hasAttribute('mjs-fx-sprite-sized') && sh.querySelector('.b').hasAttribute('mjs-fx-sprite-sized') })
        const avant = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-sp-retrait') as any)._shadow
          const a = sh.querySelector('.a'), b = sh.querySelector('.b')
          ;(window as any).__a = a
          ;(window as any).__b = b
          return { positionA: a.style.position, affichageB: b.style.display, tailleA: a.style.getPropertyValue('--mjs-fx-sprite-w'), rapportA: a.style.getPropertyValue('--mjs-fx-sprite-ratio'), tailleB: b.style.getPropertyValue('--mjs-fx-sprite-w') }
        })
        assert.equal(avant.positionA, 'relative', 'le calque a besoin d\'un parent positionné : la balise l\'est le temps de l\'effet')
        assert.equal(avant.affichageB, 'inline-block', 'une balise en ligne devient en bloc en ligne le temps de l\'effet')
        assert.notEqual(avant.tailleA, '', 'la taille d\'une pose est posée')
        assert.notEqual(avant.rapportA, '')
        assert.notEqual(avant.tailleB, '')
        await page.evaluate(() => { ((document.querySelector('mjs-sp-retrait') as any)._shadow.querySelector('.t') as HTMLElement).click() })
        await page.waitForFunction(() => !(document.querySelector('mjs-sp-retrait') as any)._shadow.querySelector('.a'))
        await page.waitForTimeout(100)
        assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'plus aucune animation dans la page')
        const apres = await page.evaluate(() => {
          const a = (window as any).__a, b = (window as any).__b
          return { a: a.getAttributeNames().filter((n: string) => n.startsWith('mjs-fx')), b: b.getAttributeNames().filter((n: string) => n.startsWith('mjs-fx')), styleA: a.getAttribute('style'), styleB: b.getAttribute('style') }
        })
        assert.deepEqual(apres.a, [], 'aucune marque sur la balise retirée : ' + apres.a)
        assert.deepEqual(apres.b, [], 'aucune marque sur la balise en ligne retirée : ' + apres.b)
        assert.ok(!apres.styleA, 'ni position, ni variable de taille sur la balise : ' + apres.styleA)
        assert.ok(!apres.styleB, 'ni affichage, ni variable de taille sur la balise en ligne : ' + apres.styleB)
        await page.evaluate(() => { ((document.querySelector('mjs-sp-retrait') as any)._shadow.querySelector('.t') as HTMLElement).click() })
        await page.waitForFunction(() => !!(document.querySelector('mjs-sp-retrait') as any)._shadow.querySelector('[mjs-fx-layer="sprite"]'))
        assert.equal((await calcule(page, 'mjs-sp-retrait')).anims, 1, 'reposé à la réouverture')
      })
    })

    it('rien ne tourne au repos : pendant que la planche défile, aucune minuterie ni requestAnimationFrame du script', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-grille', async (page) => {
        await page.evaluate(() => {
          const w = window as any
          w.__appels = { raf: 0, intervalle: 0, delai: 0 }
          const raf = w.requestAnimationFrame.bind(w)
          const si  = w.setInterval.bind(w)
          const st  = w.setTimeout.bind(w)
          w.requestAnimationFrame = (f: any) => { w.__appels.raf++; return raf(f) }
          w.setInterval           = (f: any, ...r: any[]) => { w.__appels.intervalle++; return si(f, ...r) }
          w.setTimeout            = (f: any, ...r: any[]) => { w.__appels.delai++; return st(f, ...r) }
        })
        assert.equal((await calcule(page, 'mjs-sp-grille')).anims, 1, 'la planche défile')
        await page.waitForTimeout(1500)
        assert.deepEqual(await page.evaluate(() => (window as any).__appels), { raf: 0, intervalle: 0, delai: 0 })
      })
    })

    // les images clés adoptées par la racine d'un composant : leurs noms
    const feuilles = (page: any, tag: string) => page.evaluate((t: string) => {
      const sh = (document.querySelector(t) as any)._shadow
      return sh.adoptedStyleSheets.flatMap((f: any) => Array.from(f.cssRules)).filter((r: any) => (r.name || '').startsWith('mjs-fx-sprite-')).map((r: any) => r.name).sort()
    }, tag)

    // attend (jusqu'à deux secondes) que la racine porte exactement ces feuilles d'images clés
    async function attendFeuilles(page: any, tag: string, attendu: string[], pourquoi: string) {
      let vues: string[] = []
      for (let i = 0; i < 40; i++) {
        vues = await feuilles(page, tag)
        if (JSON.stringify(vues) === JSON.stringify(attendu)) break
        await page.waitForTimeout(50)
      }
      assert.deepEqual(vues, attendu, pourquoi)
    }

    it('les feuilles d\'images clés quittent la racine avec leur dernier usager : changement de frames ou de columns, retrait', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-feuilles', async (page) => {
        const clic = (b: string) => page.evaluate(([t, s]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement).click() }, ['mjs-sp-feuilles', b])
        await attendFeuilles(page, 'mjs-sp-feuilles', ['mjs-fx-sprite-10-4'], 'deux balises de même planche : une seule feuille')
        await clic('.bf')
        await attendFeuilles(page, 'mjs-sp-feuilles', ['mjs-fx-sprite-10-4', 'mjs-fx-sprite-6-4'], 'frames 6 : la feuille de la planche de dix poses reste, la seconde balise s\'en sert encore')
        await clic('.bc')
        await attendFeuilles(page, 'mjs-sp-feuilles', ['mjs-fx-sprite-10-4', 'mjs-fx-sprite-6-5'], 'columns 5 : plus personne n\'utilise (6, 4), sa feuille est retirée')
        await clic('.t')
        await attendFeuilles(page, 'mjs-sp-feuilles', [], 'les deux balises retirées : plus aucune feuille d\'images clés')
        await clic('.t')
        await attendFeuilles(page, 'mjs-sp-feuilles', ['mjs-fx-sprite-10-4', 'mjs-fx-sprite-6-5'], 'réouverture : chaque planche retrouve sa feuille')
      })
    })

    // les pixels de l'intérieur d'une balise (pixels entiers de l'écran) qui ne sont ni la pose k, ni un mélange de la
    // pose, du fond de la balise (magenta) et du fond de la page (blanc) : ce qui reste est la trace d'une pose voisine
    async function etrangers(page: any, tag: string, sels: string[], k: number, densite: number): Promise<Record<string, number>> {
      const boites: Record<string, any> = {}
      for (const sel of sels) boites[sel] = await boite(page, tag, sel)
      const png = await page.screenshot()
      return page.evaluate(async ([b64, k, boites, d]: [string, number, Record<string, any>, number]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const data = c.getImageData(0, 0, img.width, img.height).data
        const couleur = (q: number) => [(30 + 61 * q) % 256, (((220 - 47 * q) % 256) + 256) % 256, (80 + 83 * q) % 256]
        const pose = couleur(k), fond = [255, 0, 255], page = [255, 255, 255]
        const proche = (p: number[], q: number[], t: number) => Math.abs(p[0] - q[0]) <= t && Math.abs(p[1] - q[1]) <= t && Math.abs(p[2] - q[2]) <= t
        const melange = (p: number[]) => {
          for (let a = 0; a <= 1.0001; a += 0.02) for (let b = 0; a + b <= 1.0001; b += 0.02) {
            const m = [0, 1, 2].map((i) => a * pose[i] + b * fond[i] + (1 - a - b) * page[i])
            if (proche(p, m, 9)) return true
          }
          return false
        }
        const out: Record<string, number> = {}
        for (const sel of Object.keys(boites)) {
          const r = boites[sel]
          const x0 = Math.ceil(r.x * d), y0 = Math.ceil(r.y * d), x1 = Math.floor((r.x + r.w) * d), y1 = Math.floor((r.y + r.h) * d)
          let autres = 0
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * img.width + x) * 4
            const p = [data[i], data[i + 1], data[i + 2]]
            if (proche(p, pose, 4) || proche(p, fond, 4)) continue
            if (!melange(p)) autres++
          }
          out[sel] = autres
        }
        return out
      }, [png.toString('base64'), k, boites, densite])
    }

    // la géométrie de l'effet, sans passer par le moteur de dessin : la pose k montrée commence sur un pixel entier de l'écran (le bord gauche et le bord haut de la
    // balise) et chaque pose du calque fait un nombre entier de pixels de l'écran, à 1/64 de pixel près (la précision de la mise en page de WebKit). Le calque est lu
    // une fois la pose figée : sa boîte (translate compris) et celle de la balise. Rend, par case, l'écart au pixel entier le plus grand en pixels de l'écran.
    async function ecartsAuPixel(page: any, tag: string, sels: string[], k: number, densite: number): Promise<Record<string, number>> {
      return page.evaluate(([t, ss, k, d, l]: [string, string[], number, number, string]) => {
        const out: Record<string, number> = {}
        const entier = (v: number) => Math.abs(v - Math.round(v))
        for (const sel of ss) {
          const el = (document.querySelector(t) as any)._shadow.querySelector(sel)
          const rb = el.getBoundingClientRect()
          const rl = el.querySelector(l).getBoundingClientRect()
          const pw = rl.width / 4
          const ph = rl.height / 3
          out[sel] = Math.max(entier(rb.left * d), entier(rb.top * d), entier(pw * d), entier(ph * d), Math.abs((rl.left + (k % 4) * pw - rb.left) * d), Math.abs((rl.top + Math.floor(k / 4) * ph - rb.top) * d))
        }
        return out
      }, [tag, sels, k, densite, LIGNE])
    }

    // Chromium est lancé avec la densité d'un vrai écran (--force-device-scale-factor) : la densité que Playwright
    // émule (deviceScaleFactor) pose les boîtes au pixel CSS entier avant de les agrandir, ce que ne fait aucun écran ;
    // Firefox et WebKit reçoivent leur densité de la page. Les balises sont posées sur des pixels entiers de l'écran à chaque densité.
    for (const densite of [1, 1.25, 1.5, 2]) {
      it(`densité d'écran ${densite} : au bord de la balise, jamais un trait de la pose voisine (tailles entières et décimales)`, async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-sp-densite', async (page) => {
          assert.equal(await page.evaluate(() => devicePixelRatio), densite, 'la page voit la densité demandée')
          const cases = ['.a', '.b', '.c']
          const poseTout = async (k: number) => {
            for (const sel of cases) await fige(page, 'mjs-sp-densite', (k + 0.5) * 100, sel)
            await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin))))
            await page.waitForTimeout(30)
          }
          // la planche se décode au premier relevé : on attend de la voir à l'écran (machine chargée comprise)
          await poseTout(0)
          for (let i = 0; i < 100 && await pose(page, 'mjs-sp-densite', '.a') !== 0; i++) await page.waitForTimeout(50)
          assert.equal(await pose(page, 'mjs-sp-densite', '.a'), 0, 'la planche est décodée et montre la pose 0')
          const fautes: string[] = []
          // WebKit peint un fond SVG avec une coupure de moins d'un pixel entre deux poses (jusqu'à un tiers de la pose voisine sur la dernière ligne ou colonne de
          // la balise : la même planche dans une <img> n'en a pas, et le calque tombe pourtant sur des pixels entiers) : le comptage de pixels ne peut pas dire si
          // la ligne est celle de l'effet ou celle du moteur, on mesure donc la géométrie du calque (0,03 pixel de l'écran au plus : 1/64 de pixel CSS de WebKit, agrandi)
          const geometrie = nom === 'webkit'
          if (geometrie) console.log(`  ℹ️  ${nom} : fond SVG peint avec une coupure de moins d'un pixel entre deux poses, la géométrie du calque est mesurée à la place du comptage de pixels`)
          for (let k = 0; k < 10; k++) {
            await poseTout(k)
            if (geometrie) {
              const e = await ecartsAuPixel(page, 'mjs-sp-densite', cases, k, densite)
              for (const sel of cases) if (e[sel] > 0.03) fautes.push(`${sel} pose ${k} : ${e[sel].toFixed(3)} pixel de l'écran d'écart`)
              continue
            }
            const n = await etrangers(page, 'mjs-sp-densite', cases, k, densite)
            for (const sel of cases) if (n[sel] > 0) fautes.push(`${sel} pose ${k} : ${n[sel]} pixels`)
          }
          assert.deepEqual(fautes, [], geometrie ? 'une pose qui ne tombe pas sur un pixel entier de l\'écran : ' + fautes.join(' ; ') : 'des pixels de la pose voisine au bord : ' + fautes.join(' ; '))
        }, true, densite)
      })
    }

    it('un tour fini (repeat) : le calque n\'est plus promu — will-change retiré à la fin du dernier tour, remis au tour suivant', async function () {
      if (!present) { this.skip(); return }
      const fin = (page: any, tag: string) => page.evaluate(([t, l]: string[]) => { ((document.querySelector(t) as any)._shadow.querySelector('.a').querySelector(l)).getAnimations()[0].finish() }, [tag, LIGNE])
      const attendWill = (page: any, tag: string, valeur: string) => page.waitForFunction(([t, l, v]: string[]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector('.a').querySelector(l)).willChange === v, [tag, LIGNE, valeur])
      await avec('mjs-sp-clic', async (page) => {
        const r = await boite(page, 'mjs-sp-clic')
        assert.equal((await calcule(page, 'mjs-sp-clic')).will, 'auto', 'au repos')
        await page.mouse.click(r.x + 20, r.y + 15)
        await attendWill(page, 'mjs-sp-clic', 'translate')
        await fin(page, 'mjs-sp-clic')
        await attendWill(page, 'mjs-sp-clic', 'auto')
        await page.mouse.click(r.x + 20, r.y + 15)
        await attendWill(page, 'mjs-sp-clic', 'translate')
        await fin(page, 'mjs-sp-clic')
        await attendWill(page, 'mjs-sp-clic', 'auto')
      })
      await avec('mjs-sp-fini', async (page) => {
        assert.equal((await calcule(page, 'mjs-sp-fini')).will, 'translate', 'on: load : le tour tourne')
        await fin(page, 'mjs-sp-fini')
        await attendWill(page, 'mjs-sp-fini', 'auto')
        assert.equal((await calcule(page, 'mjs-sp-fini')).anims, 0, 'le tour est fini')
      })
    })

    it('poses [1, 2, 1, 0] sur la ligne 2 d\'une planche de 3 × 4, à 4 poses par seconde : chaque entrée à sa place, un tour d\'une seconde', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-poses', async (page) => {
        const c = await calcule(page, 'mjs-sp-poses')
        assert.equal(c.duree, '1s', 'quatre entrées à quatre par seconde')
        assert.deepEqual([c.w, c.h], [120, 120], 'la planche entière : trois poses de large, quatre lignes')
        assert.equal(c.anims, 1)
        for (const [ms, k] of [[125, 7], [375, 8], [625, 7], [875, 6]]) {
          await fige(page, 'mjs-sp-poses', ms)
          assert.equal(await pose(page, 'mjs-sp-poses'), k, `à ${ms} ms : la case ${k}`)
        }
      })
    })

    it('row tenu par une variable : la ligne change sans reposer le calque, l\'animation continue', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-cap', async (page) => {
        await fige(page, 'mjs-sp-cap', 500)
        assert.equal(await pose(page, 'mjs-sp-cap'), 1, 'ligne 0, deuxième entrée')
        await page.evaluate(() => { (document.querySelector('mjs-sp-cap') as any)._shadow.querySelector('[mjs-fx-layer="sprite"]')._marque = 1 })
        await page.evaluate(() => { ((document.querySelector('mjs-sp-cap') as any)._shadow.querySelector('.b0') as HTMLElement).click() })
        await page.waitForTimeout(150)
        await fige(page, 'mjs-sp-cap', 500)
        assert.equal(await pose(page, 'mjs-sp-cap'), 10, 'ligne 3, deuxième entrée')
        await fige(page, 'mjs-sp-cap', 100)
        assert.equal(await pose(page, 'mjs-sp-cap'), 9, 'ligne 3, première entrée')
        assert.equal(await page.evaluate(() => (document.querySelector('mjs-sp-cap') as any)._shadow.querySelector('[mjs-fx-layer="sprite"]')._marque), 1, 'le même calque')
      })
    })

    it('animate : faux, la planche revient à la pose start et ne défile plus ; vrai, elle repart', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-arret', async (page) => {
        const clic = () => page.evaluate(() => { ((document.querySelector('mjs-sp-arret') as any)._shadow.querySelector('.bo') as HTMLElement).click() })
        assert.equal((await calcule(page, 'mjs-sp-arret')).anims, 1, 'il joue')
        await fige(page, 'mjs-sp-arret', 50)
        assert.equal(await pose(page, 'mjs-sp-arret'), 0)
        await clic()
        await page.waitForTimeout(150)
        const c = await calcule(page, 'mjs-sp-arret')
        assert.equal(c.anims, 0, 'plus d\'animation')
        assert.equal(c.will, 'auto')
        assert.equal(await pose(page, 'mjs-sp-arret'), 4, 'la pose start')
        await clic()
        await page.waitForTimeout(150)
        assert.equal((await calcule(page, 'mjs-sp-arret')).anims, 1, 'il repart')
      })
    })

    it('hold : la dernière pose reste à la fin d\'un tour, sans hold la balise revient au départ ; un événement mjs:sprite-end annonce le tour fini', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-garde', async (page) => {
        await page.waitForFunction(() => (document.querySelector('mjs-sp-garde') as any)._shadow.querySelector('.n').textContent === '1')
        assert.equal((await calcule(page, 'mjs-sp-garde')).anims, 1, 'hold : l\'animation finie garde sa dernière image')
        assert.equal(await pose(page, 'mjs-sp-garde', '.a'), 11, 'hold : la dernière pose')
        assert.equal(await pose(page, 'mjs-sp-garde', '.b'), 0, 'sans hold : retour à la pose de départ')
      })
    })

    it('repeat: 3 — un événement mjs:sprite-end par tour fini, trois au total', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-sp-tours', async (page) => {
        await page.waitForFunction(() => (document.querySelector('mjs-sp-tours') as any)._shadow.querySelector('.n').textContent === '3')
        await page.waitForTimeout(400)
        assert.equal(await page.evaluate(() => (document.querySelector('mjs-sp-tours') as any)._shadow.querySelector('.n').textContent), '3', 'pas de quatrième')
      })
    })

    it('image absente : aucune animation, un avertissement', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-sp-absente')
        for (let i = 0; i < 100 && !erreurs.some((e) => e.includes('*sprite')); i++) await page.waitForTimeout(50)
        const c = await calcule(page, 'mjs-sp-absente')
        assert.equal(c.anims, 0, 'sans image, rien ne défile')
        assert.equal(c.will, 'auto', 'ni promotion de calque')
        // le navigateur dit lui-même son 404 ; il reste l\'avertissement de l\'effet, qui nomme l\'image
        const propres = erreurs.filter((e) => !/404|Failed to load|NS_ERROR/i.test(e))
        assert.equal(propres.length, 1, 'un seul avertissement : ' + propres.join(' | '))
        assert.match(propres[0], /\*sprite/)
        assert.ok(propres[0].includes('/absente.png'), 'il nomme l\'image : ' + propres[0])
        await page.close()
      } finally {
        await browser.close()
      }
    })
  })
}
