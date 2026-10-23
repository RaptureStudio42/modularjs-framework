// suites de *particles(aura), *marquee et *pixels dans Chromium et Firefox réels, là où une mise en page est nécessaire :
//   - *particles(aura) : hors de l'écran, ou dans un onglet caché, aucune étincelle ne naît ; elles reprennent au retour ;
//   - *marquee(on: hover | view | click) : au repos, une seule copie du texte se voit — la seconde n'apparaît que pendant le défilement,
//     et dans un parent en `visibility: hidden` aucune copie ne ressort ;
//   - *pixels sous « réduire les animations » : aucune transition ni animation, quels que soient le mode et le déclencheur — le jeu est à son état final dès l'activation.

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

const SOURCES: Record<string, string> = {
  // trois auras : à l'écran en permanence (100 à 200 px), au survol (300 à 400 px), et posée loin sous l'écran (1 900 à 2 000 px, dans une page haute de 3 500 px)
  'vs-aura.mjs': [
    '<div class="aura" *particles(aura)></div>',
    '<div class="survol" *particles(aura, on: hover)></div>',
    '<div class="cale"></div>',
    '<div class="loin" *particles(aura)></div>',
    '<div class="fin"></div>',
    '<style>',
    'div',
    '  width: 200px',
    '  height: 100px',
    '.aura',
    '  margin: 100px 0 0 150px',
    '.survol',
    '  margin: 100px 0 0 150px',
    '.cale',
    '  height: 1500px',
    '.loin',
    '  margin-left: 150px',
    '.fin',
    '  height: 1500px',
    '</style>',
    ''
  ].join('\n'),
  // des défilés au repos : au survol, au clic, dans la vue (posé à 1 710 px, hors de l'écran), et un défilé sans arrêt
  'vs-defile.mjs': [
    '<div class="repos" *marquee(on: hover, speed: 4s)>Salut</div>',
    '<div class="clic" *marquee(on: click, speed: 1s)>Salut</div>',
    '<div class="haut" *marquee(on: hover, direction: up, speed: 4s)>Salut</div>',
    '<div class="toujours" *marquee(speed: 4s)>Salut</div>',
    '<div class="voile"><div class="sous" *marquee(on: hover, speed: 4s)>Salut</div><div class="sousmarche" *marquee(speed: 4s)>Salut</div></div>',
    '<div class="cale"></div>',
    '<div class="vue" *marquee(on: view, speed: 4s)>Salut</div>',
    '<div class="fin"></div>',
    '<style>',
    'div',
    '  width: 600px',
    '  height: 30px',
    '.haut',
    '  height: 120px',
    '.voile',
    '  height: 60px',
    '  visibility: hidden',
    '.cale',
    '  height: 1500px',
    '.fin',
    '  height: 1500px',
    '</style>',
    ''
  ].join('\n'),
  // un effet de carreaux par mode (`view`) et un au survol, tous sous la ligne de flottaison (700 à 1 180 px) : leurs carreaux sont posés, au repos, avant l'entrée à l'écran
  'vs-carreaux.mjs': [
    '<div class="cale"></div>',
    '<div class="f" *pixels(fill, on: view, duration: 3s, stagger: 1s)>F</div>',
    '<div class="x" *pixels(explode, on: view, duration: 3s, stagger: 1s)>X</div>',
    '<div class="b" *pixels(strip, on: view, duration: 3s, stagger: 1s)>B</div>',
    '<div class="w" *pixels(swap, on: view, duration: 3s, stagger: 1s)>W</div>',
    '<div class="m" *pixels(mosaic, on: view, duration: 3s, stagger: 1s)>M</div>',
    '<div class="h" *pixels(fill, on: hover, duration: 3s, stagger: 1s)>H</div>',
    '<div class="fin"></div>',
    '<style>',
    'div',
    '  width: 300px',
    '  height: 80px',
    '.cale',
    '  height: 700px',
    '.fin',
    '  height: 1000px',
    '</style>',
    ''
  ].join('\n')
}

// avant les scripts de la page : la balise d'une classe dans le composant monté, et le compte des étincelles nées
// (un `i` posé dans un calque d'aura), au total et par balise — la classe de la balise qui suit son calque ; `?` : un calque détaché
const OUTILS = [
  'window.__hote = (c) => document.body.firstElementChild._shadow.querySelector("." + c);',
  'window.__etincelles = { total: 0 };',
  '(() => {',
  '  const pose = Node.prototype.appendChild;',
  '  Node.prototype.appendChild = function(n) {',
  '    if (n && n.localName === "i" && this.getAttribute && this.getAttribute("mjs-fx-particles-mode") === "aura") {',
  '      const k = this.nextElementSibling ? this.nextElementSibling.className : "?";',
  '      window.__etincelles[k] = (window.__etincelles[k] || 0) + 1;',
  '      window.__etincelles.total++;',
  '    }',
  '    return pose.call(this, n);',
  '  };',
  '})();'
].join('\n')

describe('*particles(aura), *marquee, *pixels : suites (navigateurs réels)', function () {
  this.timeout(240000)
  let scripts = ''
  let construit = false

  before(async function () {
    const root   = mjsTmp('effets-particules-defile-carreaux-suites-browser')
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
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    const lis   = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    // la mesure des effets économes ne doit pas décider à la place du test : jamais d'économe, posé avant les composants
    scripts   = ordre.filter((f) => rang(f) < 2).map(lis).join('\n') + '\nµ._fxConf = { lite: "off" };\n' + ordre.filter((f) => rang(f) === 2).map(lis).join('\n') + '\nglobalThis.µ = µ;'
    construit = true
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la page d'un composant, servie à une vraie adresse ; `reduit` : « réduire les animations » demandé par le système
      async function ouvre(tag: string, classe: string, reduit = false) {
        assert.ok(construit, 'la construction a échoué')
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })
        await page.addInitScript(OUTILS)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${scripts}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
        return page
      }

      async function essai(tag: string, classe: string, reduit: boolean, fn: (page: any) => Promise<void>) {
        const page = await ouvre(tag, classe, reduit)
        try {
          await fn(page)
        } finally {
          await page.close()
        }
      }

      // ───── *particles(aura) ─────

      // les étincelles nées dans la balise `c` depuis la pose
      const nees = (page: any, c: string) => page.evaluate((k: string) => (window as any).__etincelles[k] || 0, c)

      // les étincelles nées pendant `ms` millisecondes
      const naissances = async (page: any, c: string, ms: number) => {
        const avant = await nees(page, c)
        await page.waitForTimeout(ms)
        return (await nees(page, c)) - avant
      }

      // les trois calques d'aura sont posés
      const auras = (page: any) => page.waitForFunction(() => (document.body.firstElementChild as any)._shadow.querySelectorAll('[mjs-fx-particles-mode="aura"]').length === 3)

      // l'onglet se cache (ou reparaît) : `document.hidden` change, puis `visibilitychange`
      const cache = (page: any, oui: boolean) => page.evaluate((hidden: boolean) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
        document.dispatchEvent(new Event('visibilitychange'))
      }, oui)

      it('*particles(aura) à l\'écran : des étincelles naissent (témoin)', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-aura', 'aura', false, async (page) => {
          await auras(page)
          const n = await naissances(page, 'aura', 800)
          assert.ok(n >= 3, `à l'écran, des étincelles naissent : ${n} en 800 ms`)
        })
      })

      it('*particles(aura) poussée hors de l\'écran par le défilement : plus aucune étincelle ne naît, elles reprennent au retour', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-aura', 'aura', false, async (page) => {
          await auras(page)
          const vue = await naissances(page, 'aura', 700)
          assert.ok(vue >= 3, `à l'écran, des étincelles naissent : ${vue} en 700 ms`)
          await page.evaluate(() => window.scrollTo(0, 2500))
          await page.waitForTimeout(700)
          const hors = await naissances(page, 'aura', 700)
          assert.equal(hors, 0, `hors de l'écran, aucune étincelle ne naît : ${hors} en 700 ms`)
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(500)
          const retour = await naissances(page, 'aura', 700)
          assert.ok(retour >= 3, `de retour à l'écran, elles reprennent : ${retour} en 700 ms`)
        })
      })

      it('*particles(aura) posée hors de l\'écran : aucune étincelle depuis la pose ; amenée à l\'écran, elle démarre', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-aura', 'aura', false, async (page) => {
          await auras(page)
          await page.waitForTimeout(900)
          const posee = await nees(page, 'loin')
          assert.equal(posee, 0, `posée loin sous l'écran, aucune étincelle depuis la pose : ${posee}`)
          await page.evaluate(() => window.scrollTo(0, 1700))
          await page.waitForTimeout(500)
          const vue = await naissances(page, 'loin', 700)
          assert.ok(vue >= 3, `amenée à l'écran, elle démarre : ${vue} en 700 ms`)
        })
      })

      it('*particles(aura) dans un onglet caché : plus aucune étincelle ne naît, elles reprennent quand l\'onglet reparaît', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-aura', 'aura', false, async (page) => {
          await auras(page)
          const vue = await naissances(page, 'aura', 700)
          assert.ok(vue >= 3, `onglet visible, des étincelles naissent : ${vue} en 700 ms`)
          await cache(page, true)
          await page.waitForTimeout(300)
          const cachee = await naissances(page, 'aura', 700)
          assert.equal(cachee, 0, `onglet caché, aucune étincelle ne naît : ${cachee} en 700 ms`)
          await cache(page, false)
          const retour = await naissances(page, 'aura', 700)
          assert.ok(retour >= 3, `l'onglet reparaît, elles reprennent : ${retour} en 700 ms`)
        })
      })

      it('*particles(aura, on: hover) : rien au repos, des étincelles au survol, plus rien quand le pointeur part (témoin)', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-aura', 'aura', false, async (page) => {
          await auras(page)
          await page.mouse.move(700, 500)
          const repos = await naissances(page, 'survol', 600)
          assert.equal(repos, 0, `au repos, aucune étincelle : ${repos} en 600 ms`)
          await page.mouse.move(250, 350)
          const survol = await naissances(page, 'survol', 800)
          assert.ok(survol >= 3, `au survol, des étincelles naissent : ${survol} en 800 ms`)
          await page.mouse.move(700, 500)
          await page.waitForTimeout(300)
          const parti = await naissances(page, 'survol', 600)
          assert.equal(parti, 0, `le pointeur parti, plus aucune étincelle : ${parti} en 600 ms`)
        })
      })

      it('*particles(aura) retirée : ni un retour d\'onglet ni un retour à l\'écran ne fait renaître d\'étincelle', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-aura', 'aura', false, async (page) => {
          await auras(page)
          await naissances(page, 'aura', 400)
          await page.evaluate(() => { (window as any).__hote('aura')._mjs_fxOff.particles() })
          await page.waitForTimeout(200)
          const avant = await page.evaluate(() => JSON.stringify((window as any).__etincelles))
          await cache(page, true)
          await cache(page, false)
          await page.evaluate(() => window.scrollTo(0, 2500))
          await page.waitForTimeout(500)
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(700)
          const apres = await page.evaluate(() => (window as any).__etincelles)
          assert.equal(apres.aura, JSON.parse(avant).aura, `la balise retirée ne fait plus naître d'étincelle : ${avant} puis ${JSON.stringify(apres)}`)
          assert.equal(apres['?'] || 0, 0, `aucune étincelle posée dans un calque détaché : ${JSON.stringify(apres)}`)
        })
      })

      // ───── *marquee au repos ─────

      // pour chaque copie du texte de la balise `c` : se voit-elle (rendue, visible, opaque, dans la balise) ?
      const vues = (page: any, c: string) => page.evaluate((k: string) => {
        const h: any = (window as any).__hote(k)
        const box = h.getBoundingClientRect()
        return (Array.from(h.querySelectorAll('[mjs-fx-marquee-track] > span')) as any[]).map((s) => {
          const cs = getComputedStyle(s)
          const r  = s.getBoundingClientRect()
          return s.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility === 'visible' && parseFloat(cs.opacity) > 0 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom
        })
      }, c)

      // les défilés sont posés
      const defiles = (page: any) => page.waitForFunction(() => ['repos', 'clic', 'haut', 'toujours', 'sous', 'sousmarche', 'vue'].every((c) => !!(window as any).__hote(c).querySelector('[mjs-fx-marquee-track]')))

      // la place du texte de la première copie dans la balise `c` (début, fin), la taille de la balise et sa place à l'écran
      const zone = (page: any, c: string) => page.evaluate((k: string) => {
        const h: any = (window as any).__hote(k)
        const box = h.getBoundingClientRect()
        const r = document.createRange()
        r.selectNodeContents(h.querySelector('[mjs-fx-marquee-track] > span'))
        const t = r.getBoundingClientRect()
        return { de: t.left - box.left, a: t.right - box.left, largeur: box.width, hauteur: box.height, x: box.left, y: box.top }
      }, c)

      // les pixels sombres peints dans la balise `c`, entre les abscisses `de` et `a` (relatives à la balise) : une vraie capture d'écran
      const encre = async (page: any, c: string, de: number, a: number) => {
        const z = await zone(page, c)
        const png: Buffer = await page.screenshot({ clip: { x: Math.floor(z.x + de), y: Math.floor(z.y), width: Math.ceil(a - de), height: Math.ceil(z.hauteur) } })
        return page.evaluate(async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width  = img.width
          cv.height = img.height
          const ctx = cv.getContext('2d') as CanvasRenderingContext2D
          ctx.drawImage(img, 0, 0)
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data
          let n = 0
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 300) n++
          return n
        }, png.toString('base64'))
      }

      it('*marquee(on: hover) au repos : une seule copie se voit — la seconde n\'apparaît qu\'au survol, et repart avec le pointeur', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-defile', 'repos', false, async (page) => {
          await defiles(page)
          await page.mouse.move(700, 500)
          await page.waitForTimeout(200)
          const repos = await vues(page, 'repos')
          assert.deepEqual(repos, [true, false], `au repos, une seule copie se voit : ${JSON.stringify(repos)}`)
          const z = await zone(page, 'repos')
          const premiere = await encre(page, 'repos', z.de - 2, z.a + 2)
          const seconde  = await encre(page, 'repos', z.a + 6, z.largeur)
          assert.ok(premiere > 20, `la première copie est peinte : ${premiere} pixels sombres`)
          assert.equal(seconde, 0, `rien n'est peint à droite de la première copie : ${seconde} pixels sombres`)
          await page.mouse.move(300, 15)
          await page.waitForTimeout(250)
          const survol = await vues(page, 'repos')
          assert.deepEqual(survol, [true, true], `au survol, le défilé a ses deux copies : ${JSON.stringify(survol)}`)
          const peinte = await encre(page, 'repos', z.a + 6, z.largeur)
          assert.ok(peinte > 20, `au survol, la seconde copie se peint : ${peinte} pixels sombres`)
          await page.mouse.move(700, 500)
          await page.waitForTimeout(250)
          const parti = await vues(page, 'repos')
          assert.deepEqual(parti, [true, false], `le pointeur parti, une seule copie : ${JSON.stringify(parti)}`)
        })
      })

      it('*marquee(on: hover, direction: up) au repos : une seule copie se voit — la seconde n\'apparaît qu\'au survol', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-defile', 'repos', false, async (page) => {
          await defiles(page)
          await page.mouse.move(700, 500)
          await page.waitForTimeout(200)
          const repos = await vues(page, 'haut')
          assert.deepEqual(repos, [true, false], `au repos, une seule copie se voit : ${JSON.stringify(repos)}`)
          await page.mouse.move(300, 120)
          await page.waitForTimeout(250)
          const survol = await vues(page, 'haut')
          assert.deepEqual(survol, [true, true], `au survol, le défilé a ses deux copies : ${JSON.stringify(survol)}`)
        })
      })

      it('*marquee(on: click) au repos : une seule copie se voit ; pendant le tour du clic, les deux ; le tour fini, une seule', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-defile', 'repos', false, async (page) => {
          await defiles(page)
          await page.mouse.move(700, 500)
          await page.waitForTimeout(200)
          const repos = await vues(page, 'clic')
          assert.deepEqual(repos, [true, false], `au repos, une seule copie se voit : ${JSON.stringify(repos)}`)
          await page.mouse.click(300, 45)
          await page.waitForTimeout(250)
          const tour = await vues(page, 'clic')
          assert.deepEqual(tour, [true, true], `pendant le tour, le défilé a ses deux copies : ${JSON.stringify(tour)}`)
          await page.waitForTimeout(1500)
          const fini = await vues(page, 'clic')
          assert.deepEqual(fini, [true, false], `le tour fini, une seule copie : ${JSON.stringify(fini)}`)
        })
      })

      it('*marquee(on: view) : hors de l\'écran une seule copie se voit ; dans la vue, les deux ; repartie, une seule', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-defile', 'repos', false, async (page) => {
          await defiles(page)
          await page.waitForTimeout(300)
          const hors = await vues(page, 'vue')
          assert.deepEqual(hors, [true, false], `hors de l'écran, au repos : une seule copie se voit : ${JSON.stringify(hors)}`)
          await page.evaluate(() => window.scrollTo(0, 1500))
          await page.waitForTimeout(500)
          const dedans = await vues(page, 'vue')
          assert.deepEqual(dedans, [true, true], `dans la vue, le défilé a ses deux copies : ${JSON.stringify(dedans)}`)
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(500)
          const parti = await vues(page, 'vue')
          assert.deepEqual(parti, [true, false], `repartie, une seule copie : ${JSON.stringify(parti)}`)
        })
      })

      it('*marquee sans déclencheur (always) : les deux copies se voient dès la pose (témoin)', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-defile', 'repos', false, async (page) => {
          await defiles(page)
          await page.waitForTimeout(300)
          const r = await vues(page, 'toujours')
          assert.deepEqual(r, [true, true], `le défilé a ses deux copies : ${JSON.stringify(r)}`)
        })
      })

      it('*marquee dans un parent en visibility: hidden : aucune copie ne se voit, au repos comme en défilant (la visibilité du parent est respectée)', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-defile', 'repos', false, async (page) => {
          await defiles(page)
          await page.waitForTimeout(300)
          const repos = await vues(page, 'sous')
          assert.deepEqual(repos, [false, false], `au repos, rien ne se voit dans un parent caché : ${JSON.stringify(repos)}`)
          const marche = await vues(page, 'sousmarche')
          assert.deepEqual(marche, [false, false], `en défilant, rien ne se voit dans un parent caché : ${JSON.stringify(marche)}`)
        })
      })

      // ───── *pixels sous « réduire les animations » ─────

      // à l'instant où l'état actif est posé : les carreaux de la balise `c` (mode `m`), leurs transitions et animations en cours, et si le jeu est à son état final
      // (null tant que l'état actif n'est pas posé) ; calculé dans la même tâche que la détection, rien n'a le temps de finir
      const instantane = async (page: any, c: string, m: string) => {
        const poignee = await page.waitForFunction(([k, mode]: string[]) => {
          const h: any = (window as any).__hote(k)
          const couche = h.querySelector('[mjs-fx-layer="pixels"]')
          if (!couche || !(h.getAttribute('mjs-fx-on') || '').split(' ').includes('pixels')) return null
          const tuiles = Array.from(couche.querySelectorAll('i, b')) as any[]
          if (tuiles.length === 0) return null
          const anims: any[] = couche.getAnimations({ subtree: true })
          const op = (t: any) => parseFloat(getComputedStyle(t).opacity)
          const nu = (t: any) => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(t).transform)
          const i  = tuiles.filter((t) => t.localName === 'i')
          const b  = tuiles.filter((t) => t.localName === 'b')
          const a  = i.filter((t) => t.getAttribute('mjs-fx-p') === 'a')
          const s  = i.filter((t) => t.getAttribute('mjs-fx-p') === 'b')
          const final = mode === 'fill' ? i.every((t) => op(t) > 0.99)
            : mode === 'explode' ? i.every((t) => op(t) < 0.01 && nu(t))
            : mode === 'strip' ? b.length > 0 && b.every((t) => op(t) > 0.99) && i.every(nu)
            : mode === 'swap' ? a.length > 0 && a.every((t) => op(t) < 0.01) && s.every((t) => op(t) > 0.99)
            : i.every(nu)
          return {
            total: tuiles.length,
            transitions: anims.filter((x) => x.transitionProperty !== void 0).length,
            animations: anims.filter((x) => x.animationName !== void 0).length,
            final
          }
        }, [c, m], { timeout: 20000 })
        return poignee.jsonValue()
      }

      // les carreaux de chaque balise sont posés, au repos (l'état actif n'est pas encore là) ; la page défile jusqu'à elles
      const posees = async (page: any) => {
        await page.waitForFunction(() => ['f', 'x', 'b', 'w', 'm', 'h'].every((c) => (window as any).__hote(c).querySelectorAll('[mjs-fx-layer="pixels"] i').length > 20))
        const actifs = await page.evaluate(() => ['f', 'x', 'b', 'w', 'm', 'h'].filter((c) => ((window as any).__hote(c).getAttribute('mjs-fx-on') || '').includes('pixels')))
        assert.deepEqual(actifs, [], 'avant d\'arriver à l\'écran, les carreaux sont au repos')
      }

      for (const [mode, classe] of [['fill', 'f'], ['explode', 'x'], ['strip', 'b'], ['swap', 'w'], ['mosaic', 'm']]) {
        it(`*pixels(${mode}, on: view) sous « réduire les animations » : aucune transition ni animation, le jeu est à son état final dès l'activation`, async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-vs-carreaux', 'f', true, async (page) => {
            await posees(page)
            await page.evaluate(() => window.scrollTo(0, 700))
            const r = await instantane(page, classe, mode)
            assert.ok(r.total > 20, `des carreaux : ${JSON.stringify(r)}`)
            assert.deepEqual({ transitions: r.transitions, animations: r.animations }, { transitions: 0, animations: 0 }, `rien ne se joue : ${JSON.stringify(r)}`)
            assert.ok(r.final, `le jeu est déjà à son état final : ${JSON.stringify(r)}`)
          })
        })

        it(`*pixels(${mode}, on: view) sans « réduire les animations » : le jeu se joue (témoin)`, async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-vs-carreaux', 'f', false, async (page) => {
            await posees(page)
            await page.evaluate(() => window.scrollTo(0, 700))
            const r = await instantane(page, classe, mode)
            if (mode === 'mosaic') assert.ok(r.animations > r.total / 2, `les carreaux tournent : ${JSON.stringify(r)}`)
            else {
              assert.ok(r.transitions > r.total / 2, `le jeu se joue : ${JSON.stringify(r)}`)
              assert.ok(!r.final, `il n'est pas déjà à son état final : ${JSON.stringify(r)}`)
            }
          })
        })
      }

      it('*pixels(fill, on: hover) sous « réduire les animations » : au survol, aucune transition, les carreaux sont pleins d\'emblée', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vs-carreaux', 'f', true, async (page) => {
          await posees(page)
          await page.evaluate(() => window.scrollTo(0, 700))
          await page.waitForTimeout(300)
          const place = await page.evaluate(() => { const b = (window as any).__hote('h').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
          await page.mouse.move(place.x, place.y)
          const r = await instantane(page, 'h', 'fill')
          assert.deepEqual({ transitions: r.transitions, animations: r.animations }, { transitions: 0, animations: 0 }, `rien ne se joue : ${JSON.stringify(r)}`)
          assert.ok(r.final, `les carreaux sont pleins d'emblée : ${JSON.stringify(r)}`)
        })
      })
    })
  }
})
