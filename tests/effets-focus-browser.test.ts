// *focus dans Chromium et Firefox réels : ce qui se voit. Au survol d'un enfant, les autres prennent le
// flou, l'opacité, le gris et la taille réglés (styles calculés relus APRÈS la transition) et le survolé
// reste net, plus grand avec `grow` ; un trait net devient gris chez les autres (un pixel d'une capture) ;
// la sortie du groupe défait tout et `will-change` repart ; seules filter, opacity et scale sont animées
// (les transitions en cours) et rien ne tourne ensuite, ni minuterie ni image d'animation de plus que
// sans l'effet ; le clavier met au point l'enfant qui a le focus visible, ou qui en contient un ; un
// appareil sans survol ne reste pas collé ; « réduire les animations » change tout de suite ; un enfant
// ajouté plus tard est pris en compte par la seule feuille ; les calques d'autres effets ne sont pas
// touchés ; un réglage tenu par une variable suit sur place ; l'enfant qui grandit passe au-dessus de son
// voisin ; à grow: 1 (le défaut) il n'a NI scale, NI z-index, NI will-change (un descendant en position
// absolue, ancré plus haut, ne saute pas) ; un *focus dans un autre repart de ses défauts pour ce qu'il
// n'écrit pas. Variable d'environnement MJS_CAPTURES : un dossier où poser une capture de chaque état.

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

const LIENS = (n: number) => Array.from({ length: n }, (_, i) => `<a class="c" href="#c${i + 1}">${i + 1}</a>`).join('')
const STYLE = `<style>
.g
  display: grid
  grid-template-columns: repeat(4, 80px)
  gap: 16px
  padding: 20px
.c
  display: block
  height: 60px
  background: #3b82f6
  color: #fff
  text-decoration: none
</style>`
const STYLE_SERRE = `<style>
.g
  display: grid
  grid-template-columns: repeat(4, 80px)
  gap: 4px
  padding: 40px
.c
  display: block
  height: 60px
  background: #3b82f6
  color: #fff
  text-decoration: none
</style>`
// un menu de liens en ligne (ni grille ni flex) : les enfants sont des boîtes en ligne
const STYLE_MENU = `<style>
.g
  padding: 20px
.c
  background: #3b82f6
  color: #fff
  text-decoration: none
  padding: 4px 20px
  margin-right: 24px
</style>`
// un groupe positionné : le badge de la première carte, en position absolue, est ancré sur le groupe
const STYLE_BADGE = `<style>
.g
  position: relative
  display: flex
  gap: 16px
  padding: 20px
.c
  width: 80px
  height: 60px
  background: #3b82f6
  color: #fff
.badge
  position: absolute
  right: 0
  top: 0
  width: 24px
  height: 16px
  background: #10b981
</style>`
// un groupe dans un groupe : l'intérieur est lui-même un enfant de l'extérieur
const STYLE_IMBRIQUE = `<style>
.g
  display: flex
  gap: 8px
  padding: 6px
.c
  width: 100px
  height: 50px
  background: #3b82f6
  color: #fff
.in
  display: flex
  gap: 4px
  background: #f97316
</style>`
// un trait net au milieu de chaque enfant : noir à gauche, blanc à droite
const STYLE_TRAIT = STYLE.replace('background: #3b82f6', 'background: linear-gradient(90deg, #000 50%, #fff 50%)')

const SOURCES: Record<string, string> = {
  'fo-defaut.mjs':   `<div class="g" *focus>${LIENS(4)}</div>\n${STYLE}`,
  'fo-sans.mjs':     `<div class="g">${LIENS(4)}</div>\n${STYLE}`,
  'fo-blur.mjs':     `<div class="g" *focus(20)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-opacite.mjs':  `<div class="g" *focus(blur: 0, opacity: 0.4)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-gris.mjs':     `<div class="g" *focus(grayscale: 1)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-echelle.mjs':  `<div class="g" *focus(scale: 0.9)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-grandit.mjs':  `<div class="g" *focus(grow: 1.2)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-duree.mjs':    `<div class="g" *focus(duration: 120ms, easing: linear)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-tout.mjs':     `<div class="g" *focus(10, opacity: 0.5, grayscale: 0.5, scale: 0.95, grow: 1.1)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-menu.mjs':     `<nav class="g" *focus(blur: 0, opacity: 0.4)>${LIENS(4)}</nav>\n${STYLE_MENU}`,
  'fo-pixels.mjs':   `<div class="g" *focus>${LIENS(4)}</div>\n${STYLE_TRAIT}`,
  'fo-serre.mjs':    `<div class="g" *focus(grow: 1.6)>${LIENS(4)}</div>\n${STYLE_SERRE}`,
  'fo-calque.mjs':   `<div class="g" *focus *grid(lines)>${LIENS(4)}</div>\n${STYLE}`,
  'fo-clavier.mjs':  `<button class="av">avant</button><div class="g" *focus><a class="c" href="#1">1</a><div class="c k"><a class="in" href="#2">2</a></div><a class="c" href="#3">3</a><a class="c" href="#4">4</a></div><button class="ap">après</button>\n${STYLE}`,
  'fo-liste.mjs':    `<script>\n$items = [1, 2, 3]\n</script>\n<div class="g" *focus>{for i in $items by i}<a class="c" href="#l">{i}</a>{end}</div>\n<button class="plus" @click={$items = [...$items, $items.length + 1]}>+</button>\n<button class="moins" @click={$items.pop()}>-</button>\n${STYLE}`,
  'fo-variable.mjs': `<script>\n$flou = 4\n$niveau = 1\n</script>\n<div class="g" *focus($flou, opacity: $niveau)>${LIENS(4)}</div>\n<button class="v1" @click={$flou = 20}>1</button>\n<button class="v2" @click={$niveau = 0.3}>2</button>\n${STYLE}`,
  'fo-badge.mjs':    `<div class="g" *focus><div class="c"><div class="badge"></div>1</div><div class="c">2</div><div class="c">3</div></div>\n${STYLE_BADGE}`,
  'fo-croit.mjs':    `<script>\n$croit = 1\n</script>\n<div class="g" *focus(grow: $croit)>${LIENS(4)}</div>\n<button class="plus" @click={$croit = 1.3}>+</button>\n<button class="moins" @click={$croit = 1}>-</button>\n${STYLE}`,
  'fo-imbrique.mjs': `<div class="g ext" *focus(blur: 2, opacity: 0.5, grayscale: 1, scale: 0.9, duration: 200ms, easing: linear)><div class="c d1">a</div><div class="in" *focus><div class="c e1">e1</div><div class="c e2">e2</div></div><div class="c d3">c</div></div>\n${STYLE_IMBRIQUE}`,
  'fo-imbrique-ecrit.mjs': `<div class="g ext" *focus(blur: 2, opacity: 0.5)><div class="c d1">a</div><div class="in" *focus(blur: 20)><div class="c e1">e1</div><div class="c e2">e2</div></div><div class="c d3">c</div></div>\n${STYLE_IMBRIQUE}`
}
// le même groupe au clavier, avec un enfant qui grandit
SOURCES['fo-clavier-grow.mjs'] = SOURCES['fo-clavier.mjs'].replace('*focus>', '*focus(grow: 1.2)>')

type Etat = { filter: string, opacity: string, scale: string, will: string, z: string, tp: string, td: string, tf: string }
// la durée ou la courbe de chaque propriété animée (la transition d'un enfant en porte une par propriété)
const une = (v: string) => [...new Set(v.split(', '))].join(', ')

const flou    = (e: Etat) => { const m = /blur\(([\d.]+)px\)/.exec(e.filter); return m ? parseFloat(m[1]) : 0 }
const gris    = (e: Etat) => { const m = /grayscale\(([\d.]+)\)/.exec(e.filter); return m ? parseFloat(m[1]) : 0 }
const echelle = (e: Etat) => e.scale === 'none' ? 1 : parseFloat(e.scale)
const net     = (e: Etat) => e.filter === 'none'

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*focus (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de *focus sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-focus-browser-' + nom)
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
      const { chromium, firefox } = await import('playwright')
      browser = await (nom === 'chromium' ? chromium : firefox).launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    // une page du composant `tag`, avec le décompte des minuteries et des images d'animation demandées
    async function ouvre(tag: string, options: any = {}) {
      const page = await browser.newPage({ viewport: { width: 500, height: 300 }, ...options })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      await page.addInitScript(() => {
        const w: any = window
        w.__n = { raf: 0, interval: 0, timeout: 0 }
        const raf = w.requestAnimationFrame.bind(w)
        const itv = w.setInterval.bind(w)
        const tmo = w.setTimeout.bind(w)
        w.requestAnimationFrame = (f: any) => { w.__n.raf++; return raf(f) }
        w.setInterval = (...a: any[]) => { w.__n.interval++; return itv(...a) }
        w.setTimeout = (...a: any[]) => { w.__n.timeout++; return tmo(...a) }
      })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.g'), tag)
      await page.waitForTimeout(300)
      await page.mouse.move(490, 290)
      return { page, erreurs }
    }

    // l'état de chaque enfant de .g : ce que le navigateur calcule, transition comprise
    const lire = (page: any, tag: string): Promise<Etat[]> => page.evaluate((t: string) => {
      const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
      return Array.from(g.children).map((n: any) => {
        const c = getComputedStyle(n)
        return { filter: c.filter, opacity: c.opacity, scale: c.scale, will: c.willChange, z: c.zIndex, tp: c.transitionProperty, td: c.transitionDuration, tf: c.transitionTimingFunction }
      })
    }, tag)

    // l'état d'éléments choisis du composant (un groupe dans un groupe), par leurs sélecteurs
    const lireSel = (page: any, tag: string, sels: string[]): Promise<Etat[]> => page.evaluate(([t, l]: [string, string[]]) => {
      const racine = (document.querySelector(t) as any)._shadow
      return l.map((sel: string) => {
        const c = getComputedStyle(racine.querySelector(sel))
        return { filter: c.filter, opacity: c.opacity, scale: c.scale, will: c.willChange, z: c.zIndex, tp: c.transitionProperty, td: c.transitionDuration, tf: c.transitionTimingFunction }
      })
    }, [tag, sels])

    // relit des éléments choisis jusqu'à ce que la condition tienne (au plus 4 s)
    async function jusqueSel(page: any, tag: string, sels: string[], ok: (r: Etat[]) => boolean, ms = 4000): Promise<Etat[]> {
      const fin = Date.now() + ms
      let r = await lireSel(page, tag, sels)
      while (!ok(r) && Date.now() < fin) {
        await page.waitForTimeout(60)
        r = await lireSel(page, tag, sels)
      }
      return r
    }

    const centreSel = (page: any, tag: string, sel: string) => page.evaluate(([t, s]: [string, string]) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector(s).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, [tag, sel])

    // relit jusqu'à ce que la condition tienne (au plus 4 s) : un navigateur chargé n'est pas un faux rouge
    async function jusque(page: any, tag: string, ok: (r: Etat[]) => boolean, ms = 4000): Promise<Etat[]> {
      const fin = Date.now() + ms
      let r = await lire(page, tag)
      while (!ok(r) && Date.now() < fin) {
        await page.waitForTimeout(60)
        r = await lire(page, tag)
      }
      return r
    }

    const centre = (page: any, tag: string, i: number) => page.evaluate(([t, k]: [string, number]) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector('.g').children[k].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom }
    }, [tag, i])

    // les transitions en cours dans le composant : la propriété animée de chacune
    const animees = (page: any, tag: string): Promise<string[]> => page.evaluate((t: string) => {
      const racine = (document.querySelector(t) as any)._shadow
      const tout: string[] = []
      for (const n of Array.from(racine.querySelectorAll('*')) as any[]) for (const a of n.getAnimations()) tout.push(a.transitionProperty ?? ('animation:' + a.animationName))
      return tout
    }, tag)

    const clic = (page: any, tag: string, sel: string) => page.evaluate(([t, s]: string[]) => (document.querySelector(t) as any)._shadow.querySelector(s).click(), [tag, sel])

    const capture = async (page: any, nomFichier: string) => {
      const dir = process.env.MJS_CAPTURES
      if (dir) await page.screenshot({ path: join(dir, `${nom}-${nomFichier}.png`) })
    }

    // la composante rouge d'un pixel de la page (une capture de 3 × 3 autour du point)
    async function rouge(page: any, x: number, y: number): Promise<number> {
      const png = await page.screenshot({ clip: { x: Math.round(x) - 1, y: Math.round(y) - 1, width: 3, height: 3 } })
      return page.evaluate(async (b64: string) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width
        cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        return c.getImageData(1, 1, 1, 1).data[0]
      }, png.toString('base64'))
    }

    it('au repos : les enfants n\'ont que leur transition (rien de posé), et aucune animation ne tourne', async function () {
      if (!browser) { this.skip(); return }
      const { page, erreurs } = await ouvre('mjs-fo-defaut')
      try {
        const lignes = await lire(page, 'mjs-fo-defaut')
        assert.equal(lignes.length, 4)
        for (const e of lignes) {
          assert.equal(e.filter, 'none')
          assert.equal(e.opacity, '1')
          assert.equal(e.scale, 'none')
          assert.equal(e.will, 'auto', 'will-change jamais posé au repos')
          assert.equal(e.z, 'auto')
          assert.equal(e.tp, 'filter, opacity, scale')
          assert.equal(une(e.td), '0.5s')
          assert.equal(une(e.tf), 'ease')
        }
        assert.deepEqual(await animees(page, 'mjs-fo-defaut'), [])
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('survol d\'un enfant : les autres se floutent (8 px) et sont promus, lui reste net ; la sortie du groupe défait tout', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-defaut'
      const { page, erreurs } = await ouvre(tag)
      try {
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        const sous = await jusque(page, tag, (r) => flou(r[0]) === 8 && flou(r[2]) === 8 && flou(r[3]) === 8)
        assert.deepEqual(sous.map(flou), [8, 0, 8, 8])
        assert.equal(sous[1].filter, 'none', 'le survolé reste net')
        // à grow: 1 le survolé ne reçoit ni scale ni z-index ni will-change : un filter, un scale ou un will-change: filter
        // en ferait le bloc conteneur de ses descendants en position absolue ou fixe
        assert.equal(sous[1].scale, 'none', 'le survolé n\'a pas de scale calculé à grow: 1')
        assert.deepEqual(sous.map((e) => e.z), ['auto', 'auto', 'auto', 'auto'], 'ni z-index à grow: 1')
        assert.equal(sous[1].will, 'auto', 'ni will-change')
        for (const i of [0, 2, 3]) assert.match(sous[i].will, /filter/, 'les autres enfants sont promus pendant le survol du parent')
        await capture(page, 'survol')
        await page.mouse.move(490, 290)
        const apres = await jusque(page, tag, (r) => r.every((e) => net(e) && e.will === 'auto' && e.z === 'auto'))
        for (const e of apres) {
          assert.equal(e.filter, 'none')
          assert.equal(e.opacity, '1')
          assert.equal(e.scale === 'none' || e.scale === '1', true)
          assert.equal(e.will, 'auto', 'will-change repart avec le survol')
        }
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('et cela se voit : un trait net devient gris chez les autres enfants, pas chez le survolé', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-pixels'
      const { page, erreurs } = await ouvre(tag)
      try {
        const b1 = await centre(page, tag, 1)
        const b2 = await centre(page, tag, 2)
        // à 3 px à gauche du trait : noir sans flou ; flou de 8 px : le blanc d'en face déborde
        const net1  = () => rouge(page, b1.x - 3, b1.y)
        const flou2 = () => rouge(page, b2.x - 3, b2.y)
        assert.ok(await flou2() < 15, 'au repos le trait est net')
        await page.mouse.move(b1.x, b1.y)
        await page.waitForTimeout(900)
        const autre = await flou2()
        assert.ok(autre > 40, `un autre enfant est flou : ${autre}`)
        assert.ok(await net1() < 15, 'le survolé reste net')
        await page.mouse.move(490, 290)
        await page.waitForTimeout(900)
        assert.ok(await flou2() < 15, 'la sortie du groupe rend le trait net')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('un menu de liens en ligne (<nav> et <a>, sans grille) : les autres liens s\'estompent, sans flou, et cela se voit', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-menu'
      const { page, erreurs } = await ouvre(tag)
      try {
        const a = await centre(page, tag, 0)
        const b = await centre(page, tag, 2)
        // le rouge d'un fond bleu (59) tend vers le blanc de la page quand le lien s'estompe
        assert.ok(await rouge(page, b.gauche + 4, b.y) < 80, 'au repos le fond est bleu')
        await page.mouse.move(a.x, a.y)
        await page.waitForTimeout(900)
        const r = await lire(page, tag)
        assert.deepEqual(r.map((e) => e.opacity), ['1', '0.4', '0.4', '0.4'])
        assert.deepEqual(r.map(flou), [0, 0, 0, 0])
        assert.ok(await rouge(page, b.gauche + 4, b.y) > 140, 'un autre lien est pâli')
        assert.ok(await rouge(page, a.gauche + 4, a.y) < 80, 'le lien visé garde son fond')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    // un réglage par source : ce qu'il change chez les autres, chez le survolé, dans la transition
    const REGLAGES: Array<[string, string, (r: Etat[]) => void]> = [
      ['fo-blur', 'blur (sans nom : le réglage principal) — 20 px', (r) => {
        assert.deepEqual(r.map(flou), [20, 0, 20, 20])
      }],
      ['fo-opacite', 'opacity avec blur: 0 — les autres s\'estompent, sans flou', (r) => {
        assert.deepEqual(r.map((e) => e.opacity), ['0.4', '1', '0.4', '0.4'])
        assert.deepEqual(r.map(flou), [0, 0, 0, 0])
      }],
      ['fo-gris', 'grayscale — les autres passent en noir et blanc', (r) => {
        assert.deepEqual(r.map(gris), [1, 0, 1, 1])
      }],
      ['fo-echelle', 'scale — les autres reculent, le survolé garde sa taille', (r) => {
        assert.deepEqual(r.map(echelle), [0.9, 1, 0.9, 0.9])
      }],
      ['fo-grandit', 'grow — le survolé grossit (et passe au-dessus), les autres gardent la leur', (r) => {
        assert.deepEqual(r.map(echelle), [1, 1.2, 1, 1])
        assert.deepEqual(r.map((e) => e.z), ['auto', '1', 'auto', 'auto'])
      }],
      ['fo-duree', 'duration et easing — lus par la transition de chaque enfant', (r) => {
        for (const e of r) {
          assert.equal(une(e.td), '0.12s')
          assert.equal(une(e.tf), 'linear')
        }
      }]
    ]
    for (const [source, quoi, verifie] of REGLAGES) {
      it(`réglage ${quoi}`, async function () {
        if (!browser) { this.skip(); return }
        const tag = 'mjs-' + source
        const { page, erreurs } = await ouvre(tag)
        try {
          const c = await centre(page, tag, 1)
          await page.mouse.move(c.x, c.y)
          await page.waitForTimeout(900)
          verifie(await lire(page, tag))
          assert.deepEqual(erreurs, [])
        } finally {
          await page.close()
        }
      })
    }

    it('duration change vraiment le rythme : 120 ms, tout est joué à 400 ms ; 500 ms (défaut), à mi-course à 150 ms', async function () {
      if (!browser) { this.skip(); return }
      const court = await ouvre('mjs-fo-duree')
      const long  = await ouvre('mjs-fo-defaut')
      try {
        const c1 = await centre(court.page, 'mjs-fo-duree', 1)
        await court.page.mouse.move(c1.x, c1.y)
        await court.page.waitForTimeout(400)
        assert.equal(flou((await lire(court.page, 'mjs-fo-duree'))[0]), 8, 'transition de 120 ms finie')
        const c2 = await centre(long.page, 'mjs-fo-defaut', 1)
        await long.page.mouse.move(c2.x, c2.y)
        // une mi-course : lue à plusieurs reprises, le flou passe par une valeur strictement entre 0 et 8
        let milieu = false
        const fin = Date.now() + 480
        while (Date.now() < fin && !milieu) {
          const v = flou((await lire(long.page, 'mjs-fo-defaut'))[0])
          milieu = v > 0 && v < 8
        }
        assert.ok(milieu, 'avec 500 ms, le flou passe par une valeur intermédiaire')
        assert.deepEqual(court.erreurs, [])
        assert.deepEqual(long.erreurs, [])
      } finally {
        await court.page.close()
        await long.page.close()
      }
    })

    it('seules filter, opacity et scale sont animées, et plus rien ne tourne une fois la transition finie', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-tout'
      const { page, erreurs } = await ouvre(tag)
      try {
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        await page.waitForTimeout(120)
        const enCours = await animees(page, tag)
        assert.ok(enCours.length > 0, 'des transitions tournent pendant le survol')
        assert.deepEqual([...new Set(enCours)].sort(), ['filter', 'opacity', 'scale'], `propriétés animées : ${enCours.join(', ')}`)
        await page.waitForTimeout(900)
        assert.deepEqual(await animees(page, tag), [], 'rien ne tourne une fois la mise au point faite')
        await page.mouse.move(490, 290)
        await page.waitForTimeout(900)
        assert.deepEqual(await animees(page, tag), [], 'ni après la sortie')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('rien ne tourne au repos : l\'effet n\'ajoute ni minuterie, ni boucle d\'images, ni intervalle', async function () {
      if (!browser) { this.skip(); return }
      const compte = async (tag: string) => {
        const { page } = await ouvre(tag)
        try {
          await page.evaluate(() => { const n = (window as any).__n; n.raf = 0; n.interval = 0; n.timeout = 0 })
          const c = await centre(page, tag, 1)
          await page.mouse.move(c.x, c.y)
          await page.waitForTimeout(900)
          await page.mouse.move(490, 290)
          await page.waitForTimeout(900)
          return await page.evaluate(() => (window as any).__n)
        } finally {
          await page.close()
        }
      }
      const avec = await compte('mjs-fo-defaut')
      const sans = await compte('mjs-fo-sans')
      assert.equal(avec.interval, 0, 'aucun intervalle')
      assert.ok(avec.raf <= sans.raf, `images d'animation demandées : ${avec.raf} avec l'effet, ${sans.raf} sans`)
      assert.ok(avec.timeout <= sans.timeout, `minuteries : ${avec.timeout} avec l'effet, ${sans.timeout} sans`)
    })

    it('dans l\'espace entre deux enfants, le groupe reste mis au point : les autres restent flous, aucun va-et-vient', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-defaut'
      const { page, erreurs } = await ouvre(tag)
      try {
        const a = await centre(page, tag, 1)
        const b = await centre(page, tag, 2)
        await page.mouse.move(a.x, a.y)
        await jusque(page, tag, (r) => flou(r[2]) === 8)
        // le milieu de l'écart entre les deux enfants
        await page.mouse.move((a.droite + b.gauche) / 2, a.y, { steps: 6 })
        const aussitot = await lire(page, tag)
        assert.equal(flou(aussitot[2]), 8, 'le voisin ne se défait pas en traversant l\'écart')
        const apres = await jusque(page, tag, (r) => r.every((e) => flou(e) === 8))
        assert.deepEqual(apres.map(flou), [8, 8, 8, 8], 'dans l\'écart, aucun enfant n\'est net')
        assert.deepEqual(apres.map((e) => e.z), ['auto', 'auto', 'auto', 'auto'])
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('clavier : l\'enfant qui a le focus visible est mis au point sans survol, celui qui en contient un aussi, la sortie du groupe défait', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-clavier'
      const { page, erreurs } = await ouvre(tag)
      try {
        assert.ok(net((await lire(page, tag))[0]), 'sans focus ni survol : rien')
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        // le premier lien a le focus visible : lui net, les autres flous
        const un = await jusque(page, tag, (r) => flou(r[1]) === 8)
        assert.deepEqual(un.map(flou), [0, 8, 8, 8])
        assert.equal(un[0].z, 'auto', 'à grow: 1, ni z-index')
        assert.equal(un[0].scale, 'none', 'ni scale')
        assert.equal(un[0].will, 'auto', 'ni will-change')
        assert.match(un[1].will, /filter/)
        await capture(page, 'clavier')
        // le focus entre dans le deuxième enfant (il CONTIENT le lien) : c'est lui, maintenant
        await page.keyboard.press('Tab')
        const deux = await jusque(page, tag, (r) => flou(r[0]) === 8 && net(r[1]))
        assert.deepEqual(deux.map(flou), [8, 0, 8, 8])
        // le focus quitte le groupe : tout redevient net
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        const dehors = await jusque(page, tag, (r) => r.every((e) => net(e) && e.will === 'auto'))
        assert.ok(dehors.every((e) => net(e) && e.will === 'auto'), 'sorti du groupe, plus rien')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('pointeur sur un enfant et focus clavier sur un autre : les deux sont mis au point, les autres restent flous', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-clavier'
      const { page, erreurs } = await ouvre(tag)
      try {
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await jusque(page, tag, (r) => flou(r[1]) === 8)
        const c = await centre(page, tag, 3)
        await page.mouse.move(c.x, c.y)
        const deux = await jusque(page, tag, (r) => net(r[3]) && flou(r[1]) === 8 && flou(r[2]) === 8)
        assert.deepEqual(deux.map(flou), [0, 8, 8, 0], 'le premier lien (clavier) et le dernier (survol) sont nets')
        assert.deepEqual(deux.map((e) => e.z), ['auto', 'auto', 'auto', 'auto'], 'à grow: 1, aucun des deux n\'a de z-index')
        assert.deepEqual([deux[0].scale, deux[3].scale], ['none', 'none'])
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('écran tactile (aucun survol possible) : le survol ne colle pas, le focus clavier agit encore', async function () {
      if (nom !== 'chromium' || !browser) { this.skip(); return }
      const tag = 'mjs-fo-clavier'
      // un écran tactile pour Chromium : plus de survol (hover: none), pointeur grossier
      const { page, erreurs } = await ouvre(tag, { hasTouch: true })
      try {
        assert.ok(await page.evaluate(() => matchMedia('(hover: none)').matches), 'l\'émulation tactile est en place')
        const c = await centre(page, tag, 2)
        await page.mouse.move(c.x, c.y)
        await page.waitForTimeout(900)
        const sous = await lire(page, tag)
        assert.ok(sous.every(net), 'un appui ne laisse pas le groupe flou')
        assert.ok(sous.every((e) => e.will === 'auto'))
        await page.mouse.move(490, 290)
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        const clavier = await jusque(page, tag, (r) => flou(r[1]) === 8)
        assert.deepEqual(clavier.map(flou), [0, 8, 8, 8], 'le focus visible met au point, même sans survol possible')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('« réduire les animations » : le changement est immédiat, sans transition ni will-change', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-defaut'
      const { page, erreurs } = await ouvre(tag, { reducedMotion: 'reduce' })
      try {
        assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'le réglage système est en place')
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        await page.waitForTimeout(150)
        const r = await lire(page, tag)
        assert.deepEqual(r.map(flou), [8, 0, 8, 8], 'déjà flou 150 ms après : aucune transition')
        for (const e of r) {
          assert.equal(e.tp, 'none')
          assert.equal(e.will, 'auto')
        }
        assert.deepEqual(await animees(page, tag), [])
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('un enfant ajouté ou retiré plus tard ({for}) : la feuille décide, sans rien reposer', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-liste'
      const { page, erreurs } = await ouvre(tag)
      try {
        assert.equal((await lire(page, tag)).length, 3)
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        await jusque(page, tag, (r) => flou(r[0]) === 8)
        await clic(page, tag, '.plus')
        const quatre = await jusque(page, tag, (r) => r.length === 4 && flou(r[3]) === 8)
        assert.deepEqual(quatre.map(flou), [8, 0, 8, 8], 'le nouvel enfant est flou tout de suite, le survolé reste net')
        assert.equal(quatre[3].tp, 'filter, opacity, scale', 'il a la transition aussi')
        await clic(page, tag, '.moins')
        await clic(page, tag, '.moins')
        const deux = await jusque(page, tag, (r) => r.length === 2)
        assert.deepEqual(deux.map(flou), [8, 0], 'un enfant retiré : le reste ne bouge pas')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('les calques posés par un autre effet (mjs-fx-layer) ne sont pas des enfants : ni flou, ni transition, ni promotion', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-calque'
      const { page, erreurs } = await ouvre(tag)
      try {
        const calque = () => page.evaluate((t: string) => {
          const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
          const l = g.querySelector(':scope > [mjs-fx-layer]')
          if (!l) return null
          const c = getComputedStyle(l)
          return { filter: c.filter, opacity: c.opacity, scale: c.scale, will: c.willChange, tp: c.transitionProperty }
        }, tag)
        const repos = await calque()
        assert.ok(repos, 'le calque de *grid est bien un enfant direct de la balise')
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        await jusque(page, tag, (r) => flou(r[0]) === 8)
        const survol = await calque()
        assert.deepEqual(survol, repos, 'le calque est tel qu\'au repos')
        assert.notEqual(survol?.tp, 'filter, opacity, scale')
        assert.notEqual(survol?.will, 'filter, opacity')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('un réglage tenu par une variable suit sur place (le flou, l\'opacité), sans reposer l\'effet', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-variable'
      const { page, erreurs } = await ouvre(tag)
      try {
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        await page.waitForTimeout(900)
        let r = await lire(page, tag)
        assert.deepEqual(r.map(flou), [4, 0, 4, 4])
        assert.deepEqual(r.map((e) => e.opacity), ['1', '1', '1', '1'])
        await page.evaluate((t: string) => {
          const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
          ;(window as any).__off = g._mjs_fxOff.focus
        }, tag)
        await clic(page, tag, '.v1')
        await clic(page, tag, '.v2')
        await page.waitForTimeout(900)
        r = await lire(page, tag)
        assert.deepEqual(r.map(flou), [20, 0, 20, 20], 'le flou a suivi sa variable, pointeur toujours dessus')
        assert.deepEqual(r.map((e) => e.opacity), ['0.3', '1', '0.3', '0.3'])
        const memeEffet = await page.evaluate((t: string) => {
          const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
          return g._mjs_fxOff.focus === (window as any).__off
        }, tag)
        assert.equal(memeEffet, true, 'le même effet : rien n\'a été reposé')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('grow : l\'enfant qui grandit passe au-dessus de son voisin (c\'est lui que le pointeur touche dans le débord)', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-serre'
      const { page, erreurs } = await ouvre(tag)
      try {
        const a = await centre(page, tag, 1)
        await page.mouse.move(a.x, a.y)
        await page.waitForTimeout(900)
        const r = await lire(page, tag)
        assert.equal(echelle(r[1]), 1.6)
        // un point à 10 px du bord droit du survolé : dans la boîte du voisin à plat, dans celle du survolé grossi
        const touche = await page.evaluate(([t, x, y]: [string, number, number]) => {
          const racine = (document.querySelector(t) as any)._shadow
          const g = racine.querySelector('.g')
          return Array.from(g.children).indexOf(racine.elementFromPoint(x, y))
        }, [tag, a.droite + 10, a.y])
        assert.equal(touche, 1, 'le survolé, plus grand, recouvre son voisin')
        await capture(page, 'grandit')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('à grow: 1 (le défaut), le survolé n\'est pas le bloc conteneur de ses descendants en position absolue : le badge ne saute pas', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-badge'
      const { page, erreurs } = await ouvre(tag)
      try {
        const badge = () => page.evaluate((t: string) => {
          const r = (document.querySelector(t) as any)._shadow.querySelector('.badge').getBoundingClientRect()
          return [Math.round(r.left), Math.round(r.top)]
        }, tag)
        const repos = await badge()
        const c = await centre(page, tag, 0)
        await page.mouse.move(c.x, c.y)
        const sous = await jusque(page, tag, (r) => flou(r[1]) === 8 && flou(r[2]) === 8)
        await page.waitForTimeout(900)
        assert.deepEqual(await badge(), repos, 'le badge reste ancré sur le groupe pendant que son enfant est mis au point')
        assert.equal(sous[0].scale, 'none', 'le survolé n\'a pas de scale calculé')
        assert.equal(sous[0].z, 'auto')
        assert.equal(sous[0].will, 'auto')
        await capture(page, 'badge')
        await page.mouse.move(490, 290)
        await page.waitForTimeout(900)
        assert.deepEqual(await badge(), repos, 'et à la sortie du groupe')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('grow tenu par une variable : la mise à l\'échelle et le z-index suivent sur place, sans reposer l\'effet ; revenu à 1, le survolé n\'a plus de scale', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-croit'
      const { page, erreurs } = await ouvre(tag)
      try {
        const c = await centre(page, tag, 1)
        await page.mouse.move(c.x, c.y)
        let r = await jusque(page, tag, (e) => flou(e[0]) === 8)
        assert.equal(r[1].scale, 'none', 'grow: 1 — pas de scale')
        assert.equal(r[1].z, 'auto')
        await page.evaluate((t: string) => {
          const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
          ;(window as any).__off = g._mjs_fxOff.focus
        }, tag)
        await clic(page, tag, '.plus')
        r = await jusque(page, tag, (e) => echelle(e[1]) === 1.3)
        assert.deepEqual(r.map(echelle), [1, 1.3, 1, 1], 'grow passé à 1.3 : le survolé grossit, pointeur toujours dessus')
        assert.equal(r[1].z, '1')
        await clic(page, tag, '.moins')
        r = await jusque(page, tag, (e) => e[1].scale === 'none')
        assert.equal(r[1].scale, 'none', 'revenu à 1 : plus de scale')
        assert.equal(r[1].z, 'auto')
        const memeEffet = await page.evaluate((t: string) => {
          const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
          return g._mjs_fxOff.focus === (window as any).__off
        }, tag)
        assert.equal(memeEffet, true, 'le même effet : rien n\'a été reposé')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('au clavier avec grow ≠ 1 : l\'enfant qui a le focus visible grandit et passe au-dessus', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-clavier-grow'
      const { page, erreurs } = await ouvre(tag)
      try {
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        const un = await jusque(page, tag, (r) => flou(r[1]) === 8)
        assert.deepEqual(un.map(flou), [0, 8, 8, 8])
        assert.equal(echelle(un[0]), 1.2)
        assert.deepEqual(un.map((e) => e.z), ['1', 'auto', 'auto', 'auto'])
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('un *focus dans un autre : l\'intérieur repart de ses défauts pour ce qu\'il n\'écrit pas, et garde l\'allure de l\'extérieur quand il en est un enfant', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-imbrique'
      const { page, erreurs } = await ouvre(tag)
      try {
        const sels = ['.d1', '.d3', '.in', '.e1', '.e2']
        const e1 = await centreSel(page, tag, '.e1')
        await page.mouse.move(e1.x, e1.y)
        // les transitions finies : l'extérieur (200 ms) et l'intérieur (500 ms)
        const [d1, d3, dedans, un, deux] = await jusqueSel(page, tag, sels, (r) => r[0].filter === 'blur(2px) grayscale(1)' && r[0].opacity === '0.5' && echelle(r[0]) === 0.9 && r[4].filter === 'blur(8px) grayscale(0)')
        // l'extérieur : ses réglages écrits, sur ses autres enfants
        for (const e of [d1, d3]) {
          assert.equal(e.filter, 'blur(2px) grayscale(1)')
          assert.equal(e.opacity, '0.5')
          assert.equal(echelle(e), 0.9)
          assert.equal(une(e.td), '0.2s')
          assert.equal(une(e.tf), 'linear')
        }
        assert.equal(dedans.filter, 'none', 'le groupe intérieur est l\'enfant mis au point de l\'extérieur')
        // l'intérieur : n'écrit rien, repart des défauts du catalogue
        assert.equal(un.filter, 'none', 'e1 est mis au point')
        assert.equal(deux.filter, 'blur(8px) grayscale(0)', 'e2 : le flou et le gris par défaut, pas ceux de l\'extérieur')
        assert.equal(deux.opacity, '1')
        assert.equal(echelle(deux), 1)
        assert.equal(une(deux.td), '0.5s', 'la durée par défaut')
        assert.equal(une(deux.tf), 'ease', 'la courbe par défaut')
        // un réglage posé sur la balise intérieure ensuite (comme le fait une variable) l'emporte, retiré il repart du défaut :
        // relu jusqu'à la fin de la transition (au plus 4 s)
        const attend = async (filtre: string) => {
          const fin = Date.now() + 4000
          let f = (await lireSel(page, tag, ['.e2']))[0].filter
          while (f !== filtre && Date.now() < fin) {
            await page.waitForTimeout(60)
            f = (await lireSel(page, tag, ['.e2']))[0].filter
          }
          return f
        }
        await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.in').style.setProperty('--mjs-focus-blur', '20px'), tag)
        assert.equal(await attend('blur(20px) grayscale(0)'), 'blur(20px) grayscale(0)', 'écrit sur la balise : il l\'emporte, le reste reste aux défauts')
        await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.in').style.removeProperty('--mjs-focus-blur'), tag)
        assert.equal(await attend('blur(8px) grayscale(0)'), 'blur(8px) grayscale(0)', 'retiré : le défaut revient')
        // le pointeur sur un autre enfant de l'extérieur : le groupe intérieur est flou comme ses voisins, avec les réglages de l'extérieur
        const a = await centreSel(page, tag, '.d1')
        await page.mouse.move(a.x, a.y)
        const [voisin, interieur] = await jusqueSel(page, tag, ['.d3', '.in'], (r) => r[1].filter === 'blur(2px) grayscale(1)' && r[1].opacity === '0.5' && echelle(r[1]) === 0.9 && r[0].filter === r[1].filter)
        assert.equal(interieur.filter, voisin.filter, 'le groupe intérieur a l\'allure de son voisin')
        assert.equal(interieur.filter, 'blur(2px) grayscale(1)')
        assert.equal(interieur.opacity, '0.5')
        assert.equal(echelle(interieur), 0.9)
        assert.equal(une(interieur.td), '0.2s')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('un *focus dans un autre qui écrit un réglage : le sien l\'emporte, les autres repartent des défauts', async function () {
      if (!browser) { this.skip(); return }
      const tag = 'mjs-fo-imbrique-ecrit'
      const { page, erreurs } = await ouvre(tag)
      try {
        const e1 = await centreSel(page, tag, '.e1')
        await page.mouse.move(e1.x, e1.y)
        const [d1, deux] = await jusqueSel(page, tag, ['.d1', '.e2'], (r) => r[0].filter === 'blur(2px) grayscale(0)' && r[0].opacity === '0.5' && r[1].filter === 'blur(20px) grayscale(0)')
        assert.equal(d1.filter, 'blur(2px) grayscale(0)')
        assert.equal(d1.opacity, '0.5')
        assert.equal(deux.filter, 'blur(20px) grayscale(0)', 'le flou écrit sur l\'intérieur')
        assert.equal(deux.opacity, '1', 'l\'opacité de l\'extérieur n\'est pas héritée')
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })
  })
}
