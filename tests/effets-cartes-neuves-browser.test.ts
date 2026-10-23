// *hologram, *flipcard et *peel dans Chromium et Firefox réels : le reflet bouge avec la souris (des
// pixels d'une capture) et dérive tout seul ; la carte montre le verso après le survol, le clic ou
// l'arrivée à l'écran (la face visible se lit par elementFromPoint et par un pixel), les deux faces
// ont la même place, la face cachée ne répond pas ; le coin de page grandit au survol, laisse voir
// le dessous, et le contenu reste cliquable hors du coin. Variable d'environnement MJS_CAPTURES : un
// dossier où poser une capture de chaque état (pour les regarder).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
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

const FACES = '<div class="r"><b>Recto</b></div><div class="v"><b>Verso</b><p>un texte plus long qui rend le verso plus haut que le recto, sur plusieurs lignes de texte pour de bon</p></div>'
const STYLE = `<style>
.holo
  width: 200px
  height: 260px
  margin: 20px
  background: linear-gradient(135deg, #234, #678)
  color: #fff
.fc
  width: 220px
  margin: 20px
.r
  background: #e00000
  padding: 12px
  color: #fff
.v
  background: #0000e0
  padding: 12px
  color: #fff
.peel
  width: 220px
  height: 150px
  margin: 20px
  background: #00a000
  color: #fff
</style>`

const SOURCES: Record<string, string> = {
  'cb-holo-hover.mjs':  `<div class="holo" *hologram(rainbow, on: hover)><b>carte</b></div>\n${STYLE}`,
  'cb-holo-galaxy.mjs': `<div class="holo" *hologram(galaxy, on: hover)><b>carte</b></div>\n${STYLE}`,
  'cb-holo-prism.mjs':  `<div class="holo" *hologram(prism, on: hover, size: 100, angle: 45)><b>carte</b></div>\n${STYLE}`,
  'cb-holo-gold.mjs':   `<div class="holo" *hologram(gold, on: hover, colors: [#400, #fc0, #fff], blend: soft-light, strength: 1)><b>carte</b></div>\n${STYLE}`,
  'cb-holo-toujours.mjs': `<div class="holo" *hologram(foil, speed: 1s)><b>carte</b></div>\n${STYLE}`,
  'cb-flip-survol.mjs': `<div class="fc" *flipcard(duration: 200ms)>${FACES}</div>\n${STYLE}`,
  'cb-flip-clic.mjs':   `<div class="fc" *flipcard(on: click, duration: 200ms)>${FACES}</div>\n${STYLE}`,
  'cb-flip-vue.mjs':    `<div style="height: 1800px"></div><div class="fc" *flipcard(on: view, duration: 200ms)>${FACES}</div>\n${STYLE}`,
  'cb-flip-fixe.mjs':   `<div class="fc" *flipcard(on: none, flipped: true, duration: 200ms)>${FACES}</div>\n${STYLE}`,
  'cb-flip-x.mjs':      `<div class="fc" *flipcard(x, on: click, duration: 200ms, reverse: true)>${FACES}</div>\n${STYLE}`,
  'cb-flip-clavier.mjs': `<button class="av">avant</button><div class="fc" *flipcard(duration: 100ms)><div class="r"><a class="lr" href="#r">recto</a></div><div class="v"><a class="lv" href="#v">verso</a></div></div><button class="ap">après</button>\n${STYLE}`,
  'cb-flip-clavier-clic.mjs': `<button class="av">avant</button><div class="fc" *flipcard(on: click, duration: 100ms)><div class="r"><a class="lr" href="#r">recto</a></div><div class="v"><a class="lv" href="#v">verso</a></div></div><button class="ap">après</button>\n${STYLE}`,
  'cb-peel.mjs':        `<div class="peel" *peel(top-right, size: 30, grow: 90, duration: 200ms)><button class="bt">un bouton</button></div>\n${STYLE}`,
  'cb-peel-bas.mjs':    `<div class="peel" *peel(bottom-left, size: 30, grow: 90, duration: 200ms, under: #ff00ff)>x</div>\n${STYLE}`
}

type Pixel = { r: number, g: number, b: number }

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*hologram, *flipcard, *peel (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test des cartes sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-cartes-neuves-browser-' + nom)
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

    async function ouvre(browser: any, tag: string, classe: string) {
      const page = await browser.newPage({ viewport: { width: 400, height: 500 } })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
      await page.waitForTimeout(400)
      return { page, erreurs }
    }

    const boite = (page: any, tag: string, classe: string) => page.evaluate(([t, c]: string[]) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector('.' + c).getBoundingClientRect()
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
    }, [tag, classe])

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

    // la part de pixels qui diffèrent nettement entre deux captures de même taille
    async function difference(page: any, a: Buffer, b: Buffer): Promise<number> {
      return page.evaluate(async ([x, y]: string[]) => {
        const lit = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d') as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          return c.getImageData(0, 0, cv.width, cv.height).data
        }
        const p = await lit(x), q = await lit(y)
        let n = 0
        for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++
        return n / (p.length / 4)
      }, [a.toString('base64'), b.toString('base64')])
    }

    // la face visible au centre de la carte : « r » (recto), « v » (verso)
    const face = (page: any, tag: string, x: number, y: number) => page.evaluate(([t, px, py]: [string, number, number]) => {
      const sh = (document.querySelector(t) as any)._shadow
      const e  = sh.elementFromPoint(px, py)
      return e ? (e.closest('.r') ? 'r' : e.closest('.v') ? 'v' : e.className || e.localName) : null
    }, [tag, x, y])

    const capture = async (page: any, nomFichier: string, clip?: any) => {
      const dir = process.env.MJS_CAPTURES
      if (dir) await page.screenshot({ path: join(dir, `${nom}-${nomFichier}.png`), clip })
    }

    const rouge = (p: Pixel) => p.r > 180 && p.g < 60 && p.b < 60
    const bleu  = (p: Pixel) => p.b > 180 && p.r < 60 && p.g < 60

    it('*hologram : le reflet bouge avec la souris (des pixels), et n\'est visible qu\'au survol avec on: hover', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-cb-holo-hover', 'holo')
        const r    = await boite(page, 'mjs-cb-holo-hover', 'holo')
        const clip = { x: r.x, y: r.y, width: r.w, height: r.h }
        await page.mouse.move(2, 2)
        await page.waitForTimeout(400)
        const repos = await page.screenshot({ clip })
        await page.mouse.move(r.x + 30, r.y + 30)
        await page.waitForTimeout(500)
        const haut = await page.screenshot({ clip })
        await capture(page, 'hologramme-haut', clip)
        await page.mouse.move(r.x + r.w - 30, r.y + r.h - 30, { steps: 5 })
        await page.waitForTimeout(500)
        const bas = await page.screenshot({ clip })
        await capture(page, 'hologramme-bas', clip)
        assert.ok(await difference(page, repos, haut) > 0.15, 'au survol, le reflet apparaît')
        assert.ok(await difference(page, haut, bas) > 0.05, 'le reflet suit la souris')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(500)
        const apres = await page.screenshot({ clip })
        assert.ok(await difference(page, repos, apres) < 0.01, 'la sortie éteint le reflet')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('*hologram : galaxy, prism et gold se dessinent aussi (le survol change la carte), palette et fusion comprises', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        for (const style of ['galaxy', 'prism', 'gold']) {
          const tag = 'mjs-cb-holo-' + style
          const { page, erreurs } = await ouvre(browser, tag, 'holo')
          const r    = await boite(page, tag, 'holo')
          const clip = { x: r.x, y: r.y, width: r.w, height: r.h }
          await page.mouse.move(2, 2)
          await page.waitForTimeout(400)
          const repos = await page.screenshot({ clip })
          await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
          await page.waitForTimeout(500)
          const haut = await page.screenshot({ clip })
          await capture(page, 'hologramme-' + style, clip)
          assert.ok(await difference(page, repos, haut) > 0.1, style + ' : le reflet apparaît au survol')
          assert.deepEqual(erreurs, [], style)
          await page.close()
        }
      } finally {
        await browser.close()
      }
    })

    it('*hologram : sans souris, le reflet dérive tout seul (on: always)', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page } = await ouvre(browser, 'mjs-cb-holo-toujours', 'holo')
        const r    = await boite(page, 'mjs-cb-holo-toujours', 'holo')
        const clip = { x: r.x, y: r.y, width: r.w, height: r.h }
        await page.mouse.move(2, 2)
        // trois images à quelque 300 ms d'écart : une machine chargée peut retomber sur la même phase d'un tour
        const a = await page.screenshot({ clip })
        await capture(page, 'hologramme-derive', clip)
        await page.waitForTimeout(300)
        const b = await page.screenshot({ clip })
        await page.waitForTimeout(300)
        const c = await page.screenshot({ clip })
        const ecart = Math.max(await difference(page, a, b), await difference(page, b, c), await difference(page, a, c))
        assert.ok(ecart > 0.02, 'le reflet a bougé tout seul : ' + ecart)
      } finally {
        await browser.close()
      }
    })

    it('*flipcard (hover) : le recto d\'abord, le verso après le survol, le recto de nouveau à la sortie ; mêmes dimensions', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page } = await ouvre(browser, 'mjs-cb-flip-survol', 'fc')
        const r  = await boite(page, 'mjs-cb-flip-survol', 'fc')
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        const tailles = await page.evaluate(() => {
          const e: any = (document.querySelector('mjs-cb-flip-survol') as any)._shadow.querySelector('.fc')
          const a = e.querySelector('.r').getBoundingClientRect()
          const b = e.querySelector('.v').getBoundingClientRect()
          return { r: [a.width, a.height], v: [b.width, b.height] }
        })
        assert.deepEqual(tailles.r, tailles.v, 'les deux faces prennent la même place')
        assert.ok(tailles.r[1] > 100, 'la plus grande des deux : ' + tailles.r[1])
        await page.mouse.move(2, 2)
        assert.equal(await face(page, 'mjs-cb-flip-survol', cx, cy), 'r')
        assert.ok(rouge(await pixel(page, cx, r.y + r.h - 6)), 'recto rouge')
        await capture(page, 'carte-recto', { x: r.x, y: r.y, width: r.w, height: r.h })
        await page.mouse.move(cx, cy)
        await page.waitForTimeout(600)
        assert.equal(await face(page, 'mjs-cb-flip-survol', cx, cy), 'v', 'le verso est ce qu\'on touche')
        assert.ok(bleu(await pixel(page, cx, r.y + r.h - 6)), 'verso bleu')
        await capture(page, 'carte-verso', { x: r.x, y: r.y, width: r.w, height: r.h })
        const inertes = await page.evaluate(() => {
          const e: any = (document.querySelector('mjs-cb-flip-survol') as any)._shadow.querySelector('.fc')
          return [e.querySelector('.r').hasAttribute('inert'), e.querySelector('.v').hasAttribute('inert')]
        })
        assert.deepEqual(inertes, [true, false], 'le recto caché est inerte')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(600)
        assert.equal(await face(page, 'mjs-cb-flip-survol', cx, cy), 'r')
      } finally {
        await browser.close()
      }
    })

    it('*flipcard (à mi-retournement) : la carte est de chant, ni recto ni verso ne couvrent toute la largeur', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page } = await ouvre(browser, 'mjs-cb-flip-clic', 'fc')
        const r = await boite(page, 'mjs-cb-flip-clic', 'fc')
        await page.evaluate(() => {
          const e: any = (document.querySelector('mjs-cb-flip-clic') as any)._shadow.querySelector('.fc')
          e.style.setProperty('--mjs-flipcard-duration', '4s')
        })
        await page.mouse.click(r.x + 10, r.y + 10)
        await page.waitForTimeout(1200)
        await capture(page, 'carte-en-route', { x: r.x - 20, y: r.y - 20, width: r.w + 40, height: r.h + 40 })
        const largeur = await page.evaluate(() => {
          const e: any = (document.querySelector('mjs-cb-flip-clic') as any)._shadow.querySelector('.fc')
          const f = e.querySelector('.r'), b = e.querySelector('.v')
          const m = (n: any) => new DOMMatrix(getComputedStyle(n).transform)
          return { avant: m(f).m11, arriere: m(b).m11 }
        })
        assert.ok(Math.abs(largeur.avant) < 0.95 && largeur.avant > -0.95, 'le recto tourne : ' + largeur.avant)
        assert.ok(Math.abs(largeur.arriere) < 0.95, 'le verso tourne : ' + largeur.arriere)
      } finally {
        await browser.close()
      }
    })

    it('*flipcard (click) : chaque clic retourne ; (x, reverse) aussi ; (none, flipped) montre le verso d\'emblée', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        for (const tag of ['mjs-cb-flip-clic', 'mjs-cb-flip-x']) {
          const { page } = await ouvre(browser, tag, 'fc')
          const r  = await boite(page, tag, 'fc')
          const cx = r.x + r.w / 2
          const cy = r.y + r.h / 2
          await page.mouse.move(2, 2)
          assert.equal(await face(page, tag, cx, cy), 'r', tag + ' : recto au départ')
          await page.mouse.click(cx, cy)
          await page.waitForTimeout(500)
          assert.equal(await face(page, tag, cx, cy), 'v', tag + ' : verso après un clic')
          assert.ok(bleu(await pixel(page, cx, r.y + r.h - 6)), tag + ' : verso bleu')
          await page.mouse.click(cx, cy)
          await page.waitForTimeout(500)
          assert.equal(await face(page, tag, cx, cy), 'r', tag + ' : recto après deux clics')
          assert.ok(rouge(await pixel(page, cx, r.y + r.h - 6)), tag + ' : recto rouge')
          await page.close()
        }
        const { page } = await ouvre(browser, 'mjs-cb-flip-fixe', 'fc')
        const r  = await boite(page, 'mjs-cb-flip-fixe', 'fc')
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        assert.equal(await face(page, 'mjs-cb-flip-fixe', cx, cy), 'v', 'flipped: true : verso d\'emblée')
        await page.mouse.move(cx, cy)
        await page.mouse.click(cx, cy)
        await page.waitForTimeout(500)
        assert.equal(await face(page, 'mjs-cb-flip-fixe', cx, cy), 'v', 'ni survol ni clic n\'y changent rien')
      } finally {
        await browser.close()
      }
    })

    // le clavier : où est le focus (classe de l'élément actif du composant, `commande` pour celle de la carte) et l'état de la carte (1 : verso)
    const clavier = (page: any, tag: string) => page.evaluate((t: string) => {
      const sh: any = (document.querySelector(t) as any)._shadow
      const a = sh.activeElement
      return { actif: a ? (a.hasAttribute('mjs-fx-flipcard-turn') ? 'commande' : a.className) : '', t: sh.querySelector('.fc').style.getPropertyValue('--mjs-fx-flipcard-t'), commande: !!sh.querySelector('.fc > [mjs-fx-flipcard-turn]') }
    }, tag)

    it('*flipcard (hover) au clavier : Tab atteint la commande de la carte, elle se retourne ; le verso est atteignable et retient la carte ; Entrée bascule, Échap remet ; la souris ne la laisse pas retournée', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const tag = 'mjs-cb-flip-clavier'
        const { page } = await ouvre(browser, tag, 'fc')
        const av = await clavier(page, tag)
        assert.equal(av.commande, true, 'la carte a sa commande, que Tab atteint')
        assert.equal(av.t, '0')
        await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.av').focus(), tag)
        await page.keyboard.press('Tab')
        let e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['commande', '1'], 'Tab : la commande de la carte a le focus, la carte montre le verso')
        await page.keyboard.press('Tab')
        e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['lv', '1'], 'Tab : le lien du verso est atteint, la carte reste retournée')
        await page.waitForTimeout(250)
        e = await clavier(page, tag)
        assert.equal(e.t, '1', 'le focus est dans le verso : la carte ne revient pas')
        await page.keyboard.press('Tab')
        e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['ap', '0'], 'le focus sort : la carte revient au recto')
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Shift+Tab')
        e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['commande', '1'], 'Maj+Tab : de retour sur la commande de la carte, verso')
        await page.keyboard.press('Enter')
        e = await clavier(page, tag)
        assert.equal(e.t, '0', 'Entrée bascule : recto')
        await page.keyboard.press(' ')
        e = await clavier(page, tag)
        assert.equal(e.t, '1', 'Espace bascule : verso')
        await page.keyboard.press('Escape')
        e = await clavier(page, tag)
        assert.equal(e.t, '0', 'Échap remet le recto')
        // Échap depuis le lien du verso : la carte revient et le focus retourne à sa commande
        await page.keyboard.press('Enter')
        await page.keyboard.press('Tab')
        e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['lv', '1'], 'dans le verso')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
        e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['commande', '0'], 'Échap depuis le verso : recto, focus sur la commande de la carte')
        // le recto reste utilisable à la souris : cliquer son lien ne retourne pas la carte
        const r  = await boite(page, tag, 'fc')
        await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        e = await clavier(page, tag)
        assert.equal(e.t, '0', 'un clic de souris puis la sortie du pointeur : la carte est revenue')
        await page.close()
      } finally {
        await browser.close()
      }
    })

    it('*flipcard (click) au clavier : Tab atteint la commande de la carte (sans la retourner), Entrée et Espace la retournent', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const tag = 'mjs-cb-flip-clavier-clic'
        const { page } = await ouvre(browser, tag, 'fc')
        assert.equal((await clavier(page, tag)).commande, true)
        await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.av').focus(), tag)
        await page.keyboard.press('Tab')
        let e = await clavier(page, tag)
        assert.deepEqual([e.actif, e.t], ['commande', '0'], 'Tab : la commande de la carte a le focus, toujours au recto')
        await page.keyboard.press('Enter')
        e = await clavier(page, tag)
        assert.equal(e.t, '1', 'Entrée retourne')
        await page.keyboard.press(' ')
        e = await clavier(page, tag)
        assert.equal(e.t, '0', 'Espace remet')
        await page.close()
      } finally {
        await browser.close()
      }
    })

    it('*flipcard (view) : la carte se retourne quand elle arrive à l\'écran', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page } = await ouvre(browser, 'mjs-cb-flip-vue', 'fc')
        const r = await boite(page, 'mjs-cb-flip-vue', 'fc')
        const montre = () => page.evaluate(() => {
          const e: any = (document.querySelector('mjs-cb-flip-vue') as any)._shadow.querySelector('.fc')
          return e.style.getPropertyValue('--mjs-fx-flipcard-t')
        })
        assert.equal(await montre(), '0', 'hors de l\'écran : le recto')
        await page.evaluate((y: number) => scrollTo(0, y - 100), r.y)
        await page.waitForTimeout(800)
        assert.equal(await montre(), '1', 'à l\'écran : retournée')
        // la page ne défile pas plus loin que sa fin : la carte est relue là où elle est
        const vue = await page.evaluate(() => {
          const q = (document.querySelector('mjs-cb-flip-vue') as any)._shadow.querySelector('.fc').getBoundingClientRect()
          return { x: q.left + q.width / 2, y: q.top + q.height / 2 }
        })
        assert.equal(await face(page, 'mjs-cb-flip-vue', vue.x, vue.y), 'v')
      } finally {
        await browser.close()
      }
    })

    it('*peel : le coin grandit au survol, laisse voir le dessous ; le contenu reste cliquable, même sous le coin', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page } = await ouvre(browser, 'mjs-cb-peel', 'peel')
        const r = await boite(page, 'mjs-cb-peel', 'peel')
        const droite = r.x + r.w
        const clip   = { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20 }
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        await capture(page, 'coin-repos', clip)
        const sombre = (p: Pixel) => p.r < 50 && p.g < 60 && p.b < 80
        const clair  = (p: Pixel) => p.r > 190 && p.g > 190 && p.b > 190
        const vert   = (p: Pixel) => p.g > 120 && p.r < 40 && p.b < 40
        // au repos (30 px) : le dessous dans le coin, le dos de la page à côté, le fond vert plus loin
        assert.ok(sombre(await pixel(page, droite - 5, r.y + 5)), 'repos : le dessous au sommet du coin')
        assert.ok(clair(await pixel(page, droite - 20, r.y + 20)), 'repos : le dos de la page')
        assert.ok(vert(await pixel(page, droite - 50, r.y + 10)), 'repos : le fond, là où le coin n\'est pas encore')
        await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
        await page.waitForTimeout(600)
        await capture(page, 'coin-souleve', clip)
        assert.ok(sombre(await pixel(page, droite - 50, r.y + 10)), 'actif (90 px) : le dessous gagne du terrain')
        assert.ok(clair(await pixel(page, droite - 60, r.y + 60)), 'actif : le dos de la page grandit')
        // le calque ne capte rien : au coin, on touche le contenu de la balise
        const touche = await page.evaluate(([x, y]: number[]) => {
          const e = (document.querySelector('mjs-cb-peel') as any)._shadow.elementFromPoint(x, y)
          return e ? (e.closest('[mjs-fx-layer]') ? 'calque' : e.className || e.localName) : null
        }, [droite - 5, r.y + 5])
        assert.equal(touche, 'peel', 'le point du coin touche la balise, jamais le calque')
        // le bouton, hors du coin, répond
        await page.evaluate(() => {
          const b: any = (document.querySelector('mjs-cb-peel') as any)._shadow.querySelector('.bt')
          b.addEventListener('click', () => { b.dataset.clic = 'oui' })
        })
        const bt = await page.evaluate(() => {
          const b: any = (document.querySelector('mjs-cb-peel') as any)._shadow.querySelector('.bt')
          const q = b.getBoundingClientRect()
          return { x: q.left + q.width / 2, y: q.top + q.height / 2 }
        })
        await page.mouse.click(bt.x, bt.y)
        assert.equal(await page.evaluate(() => (document.querySelector('mjs-cb-peel') as any)._shadow.querySelector('.bt').dataset.clic), 'oui')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(600)
        assert.ok(vert(await pixel(page, droite - 50, r.y + 10)), 'la sortie repose le coin')
      } finally {
        await browser.close()
      }
    })

    it('*peel (bottom-left, under) : le dessous prend sa couleur dans le coin bas gauche', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const { page } = await ouvre(browser, 'mjs-cb-peel-bas', 'peel')
        const r = await boite(page, 'mjs-cb-peel-bas', 'peel')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        const p = await pixel(page, r.x + 5, r.y + r.h - 5)
        assert.ok(p.r > 200 && p.b > 200 && p.g < 60, `le dessous magenta : ${JSON.stringify(p)}`)
        await capture(page, 'coin-bas', { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20 })
      } finally {
        await browser.close()
      }
    })
  })
}
