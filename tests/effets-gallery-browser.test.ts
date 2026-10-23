// *gallery dans Chromium et Firefox réels (une vraie mise en page est nécessaire : happy-dom ne mesure rien) : la perspective et le
// sens du glisser vus des styles calculés, le glisser (lent : il pose la galerie sur le panneau le plus proche ; vif :
// l'élan la porte plus loin), un clic sans déplacement qui reste un clic et le clic qui suit un vrai glisser retenu, la
// molette qui ne prend que le sens du glisser (le vertical avec Maj), le clavier, le panneau qui reçoit le clic (celui du
// premier plan), le défilement de la page (une galerie collante dans une section haute), la souris de gauche à droite, une
// galerie `always` qui se repose hors écran, `will-change` seulement pendant le mouvement, rien qui tourne au repos, et
// le retrait qui rend aux panneaux leur mise en page d'origine, à la case près.

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

// huit liens de 470 × 310 : une unité de panneau du coverflow vaut alors 100 px (un panneau = 490 px de glisser)
const LIENS = Array.from({ length: 8 }, (_, i) => `<a class="p" href="#p${i}" @click.prevent={$clics = $clics + 1}>${i}</a>`).join('\n  ')
const PLAIN = Array.from({ length: 8 }, (_, i) => `<a class="p" href="#p${i}">${i}</a>`).join('\n  ')
const STYLE = '\n.g, .r\n  height: 600px\n  width: 1000px\n  background: #123\n  overflow: hidden\n.p\n  display: block\n  width: 470px\n  height: 310px\n  background: #39c\n  color: #fff\n  font: 40px/310px sans-serif\n  text-align: center\n.r .p\n  background: #c93\n'

const SOURCES: Record<string, string> = {
  // le glisser : un panneau de tête qui compte ses clics et dit son index
  'gal-drag.mjs': `<script>\n$n = 3\n$clics = 0\n</script>\n<div class="g" *gallery(coverflow, on: drag, index: 3) @change={(e) -> $n = e.detail.index}>\n  ${LIENS}\n</div>\n<b class="n">{$n}</b> <i class="c">{$clics}</i>\n<style>${STYLE}</style>\n`,
  // sans `snap` : la galerie reste où la main (ou la molette) la laisse
  'gal-nosnap.mjs': `<script>\n$n = 3\n</script>\n<div class="g" *gallery(coverflow, on: drag, index: 3, snap: false) @change={(e) -> $n = e.detail.index}>\n  ${PLAIN}\n</div>\n<b class="n">{$n}</b>\n<style>${STYLE}</style>\n`,
  // la même balise sans effet, à côté : la mise en page d'origine, pour comparer au retrait
  'gal-ref.mjs':  `<div class="g" *gallery(coverflow, on: drag, index: 3)>\n  ${PLAIN}\n</div>\n<div class="r">\n  ${PLAIN}\n</div>\n<style>${STYLE}</style>\n`,
  // le défilement : une galerie collante dans une section de 400 écrans, lissage coupé pour lire la place tout de suite
  'gal-scroll.mjs': `<script>\n$n = 0\n</script>\n<div class="long">\n  <div class="coll" *gallery(coverflow, smooth: 1) @change={(e) -> $n = e.detail.index}>\n    ${PLAIN}\n  </div>\n</div>\n<b class="n">{$n}</b>\n<style>\n.long\n  height: 400vh\n.coll\n  position: sticky\n  top: 0\n  height: 100vh\n  overflow: hidden\n.p\n  display: block\n  width: 470px\n  height: 310px\n  background: #39c\n.n\n  position: fixed\n  right: 0\n  top: 0\n</style>\n`,
  // la souris de gauche à droite
  'gal-pointer.mjs': `<script>\n$n = 0\n</script>\n<div class="g" *gallery(strip, on: pointer, smooth: 1) @change={(e) -> $n = e.detail.index}>\n  ${PLAIN}\n</div>\n<b class="n">{$n}</b>\n<style>${STYLE}</style>\n`,
  // le défilement, loin sous l'écran : l'écoute ne commence qu'à l'approche
  'gal-loin.mjs': `<script>\n$n = 0\n</script>\n<div class="espace"></div>\n<div class="g" *gallery(coverflow, smooth: 1) @change={(e) -> $n = e.detail.index}>\n  ${PLAIN}\n</div>\n<b class="n">{$n}</b>\n<style>${STYLE}.espace\n  height: 4000px\n.n\n  position: fixed\n  right: 0\n  top: 0\n</style>\n`,
  // la bande d'écran (`zone`) : la balise va de son premier à son dernier panneau pendant que son haut monte du milieu au haut de l'écran
  'gal-zone.mjs': `<script>\n$n = 0\n</script>\n<div class="espace"></div>\n<div class="g" *gallery(coverflow, zone: center top, smooth: 1) @change={(e) -> $n = e.detail.index}>\n  ${PLAIN}\n</div>\n<div class="espace"></div>\n<b class="n">{$n}</b>\n<style>${STYLE}.espace\n  height: 2000px\n.n\n  position: fixed\n  right: 0\n  top: 0\n</style>\n`,
  // les réglages tenus par des variables, changés par des boutons : ceux que l'effet suit sur place, ceux qui le relancent
  'gal-vars.mjs': `<script>\n$style = 'coverflow'\n$on = 'drag'\n$gap = 1\n$loop = false\n$index = 3\n$tilt = 0\n$n = 3\n</script>\n<div class="g" *gallery(style: $style, on: $on, gap: $gap, loop: $loop, index: $index, tilt: $tilt, smooth: 1) @change={(e) -> $n = e.detail.index}>\n  ${PLAIN}\n</div>\n<button class="b-arc" @click={$style = 'arc'}>arc</button>\n<button class="b-gap" @click={$gap = 2}>gap</button>\n<button class="b-ptr" @click={$on = 'pointer'}>pointer</button>\n<button class="b-idx" @click={$index = 5}>5</button>\n<button class="b-tilt" @click={$tilt = 8}>tilt</button>\n<b class="n">{$n}</b>\n<style>${STYLE}</style>\n`,
  // l'inclinaison de la scène vers la souris, dans une page qui défile
  'gal-tilt.mjs': `<div class="g" *gallery(coverflow, on: drag, index: 3, tilt: 10, smooth: 1)>\n  ${PLAIN}\n</div>\n<div class="espace"></div>\n<style>${STYLE}.espace\n  height: 3000px\n</style>\n`,
  // tout seul avec rien à animer : une balise sans panneau, une avec un seul, toutes deux à l'écran
  'gal-un.mjs': `<script>\n$n = 0\n</script>\n<div class="g0" *gallery(coverflow, on: always, speed: 200ms)></div>\n<div class="g1" *gallery(coverflow, on: always, speed: 200ms) @change={(e) -> $n = e.detail.index}>\n  <a class="p">0</a>\n</div>\n<b class="n">{$n}</b>\n<style>\n.g0, .g1\n  height: 150px\n  width: 1000px\n  background: #123\n  overflow: hidden\n.p\n  display: block\n  width: 200px\n  height: 100px\n  background: #39c\n</style>\n`,
  // tout seul, loin sous l'écran : la boucle se repose tant qu'on ne la voit pas
  'gal-always.mjs': `<script>\n$n = 0\n</script>\n<div class="espace"></div>\n<div class="g" *gallery(coverflow, on: always, speed: 200ms, smooth: 1) @change={(e) -> $n = e.detail.index}>\n  ${PLAIN}\n</div>\n<b class="n">{$n}</b>\n<style>${STYLE}.espace\n  height: 3000px\n.n\n  position: fixed\n  right: 0\n  top: 0\n</style>\n`
}

// ce que la page compte : les images d'animation en attente
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  w.__rafN = 0
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.__dans = 0
  w.requestAnimationFrame = (f: any) => { w.__rafN++; const h = ra((t: number) => { w.__raf.delete(h); w.__dans++; try { return f(t) } finally { w.__dans-- } }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__roues = []
  // les écouteurs `scroll` de la fenêtre encore posés : l'effet n'en garde aucun tant que sa balise est loin de l'écran
  w.__defil = 0
  const aj = w.addEventListener.bind(w)
  const re = w.removeEventListener.bind(w)
  w.addEventListener = (t: string, f: any, o?: any) => { if (t === 'scroll') w.__defil++; return aj(t, f, o) }
  w.removeEventListener = (t: string, f: any, o?: any) => { if (t === 'scroll') w.__defil--; return re(t, f, o) }
  document.addEventListener('wheel', (e) => { w.__roues.push(e.defaultPrevented) }, { passive: true })
  // les lectures de mise en page faites DANS une image d'animation (derrière l'écriture d'un effet, chacune force un recalcul de style) et les
  // styles calculés demandés, comptés tant que `__mesure` est vrai
  w.__mesure = false
  w.__lect = 0
  w.__calc = 0
  w.__zi = 0
  const lecture = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: any) { if (w.__dans && w.__mesure) w.__lect++; return lecture.call(this) }
  const calcule = w.getComputedStyle.bind(w)
  w.getComputedStyle = (...a: any[]) => { if (w.__mesure) w.__calc++; return (calcule as any)(...a) }
}

for (const nom of ['chromium', 'firefox'] as const) {
describe(`*gallery dans ${nom} réel — glisser, clic, molette, clavier, défilement, souris, repos, retrait`, function () {
  this.timeout(240000)
  let script = ''
  let browser: any = null
  let present = false

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-gallery-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await (nom === 'chromium' ? playwright.chromium.launch({ args: ['--no-sandbox'] }) : playwright.firefox.launch())
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
  async function avec<T>(tag: string, fn: (page: any) => Promise<T>, viewport = { width: 1000, height: 800 }): Promise<T> {
    const page = await browser.newPage({ viewport })
    try {
      await page.addInitScript(COMPTEURS)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx~="gallery"]'), tag)
      await page.waitForTimeout(150)
      return await fn(page)
    }
    finally {
      await page.close()
    }
  }

  // le texte de `.n` (l'index que `change` a écrit) et de `.c` (les clics comptés)
  const lu = (page: any, tag: string, cls: string): Promise<string> => page.evaluate(([t, c]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector(c)?.textContent.trim(), [tag, cls])
  const attend = async (page: any, tag: string, cls: string, attendu: string, ms = 3000) => {
    const fin = Date.now() + ms
    let v = await lu(page, tag, cls)
    while (v !== attendu && Date.now() < fin) {
      await page.waitForTimeout(50)
      v = await lu(page, tag, cls)
    }
    return v
  }
  const centre = (page: any, tag: string, sel = '.g') => page.evaluate(([t, s]: [string, string]) => {
    const r = (document.querySelector(t) as any)._shadow.querySelector(s).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, w: r.width, t: r.top, h: r.height }
  }, [tag, sel])
  const raf = (page: any) => page.evaluate(() => (window as any).__raf.size)
  const transform = (page: any, tag: string, i: number, sel = '.g') => page.evaluate(([t, n, s]: [string, number, string]) => ((document.querySelector(t) as any)._shadow.querySelector(s).children[n] as HTMLElement).style.transform.replace(/\s+/g, ''), [tag, i, sel])
  // le panneau `i` posé pile devant : sondé jusqu'à ce que le ressort ait fini (une machine chargée l'allonge), rend la dernière valeur lue
  const posee = async (page: any, tag: string, i: number, ms = 8000) => {
    const fin = Date.now() + ms
    let v = await transform(page, tag, i)
    while (v !== 'translate3d(0px,0px,0px)' && Date.now() < fin) {
      await page.waitForTimeout(100)
      v = await transform(page, tag, i)
    }
    return v
  }

  // un glisser fabriqué dans la page, sans prise du pointeur réelle (le pointeur 9 n'existe pas), l'horloge des événements posée à la main ;
  // puis, dans la même tâche : 'clics' = deux clics partis du panneau 3 lui-même, 'retrait' = l'effet retiré puis un clic du panneau
  const apresGlisser = (page: any, tag: string, suite: 'clics' | 'retrait') => page.evaluate(([t, s]: [string, string]) => {
    const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
    const r = g.getBoundingClientRect()
    const t0 = performance.now()
    const ev = (type: string, dx: number, i: number, buttons = 1) => {
      const e = new PointerEvent(type, { pointerId: 9, pointerType: 'mouse', button: 0, buttons, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2, bubbles: true })
      Object.defineProperty(e, 'timeStamp', { value: t0 + 5 * i })
      g.dispatchEvent(e)
    }
    ev('pointerdown', 0, 0)
    for (let i = 1; i <= 6; i++) ev('pointermove', -10 * i, i)
    ev('pointerup', -60, 7, 0)
    if (s === 'retrait') g._mjs_fxOff.gallery()
    const lien = g.children[3]
    lien.click()
    if (s === 'clics') lien.click()
  }, [tag, suite])

  // un glisser de `dx` px depuis le milieu de la balise (ou depuis `de`, sa fraction de largeur) ; `pause` avant de lâcher : la main s'arrête, l'élan est nul
  async function glisse(page: any, tag: string, dx: number, pause = 0, de = .5) {
    const c = await centre(page, tag)
    const x = c.l + c.w * de
    await page.mouse.move(x, c.y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(x + dx * i / 12, c.y)
    if (pause) await page.waitForTimeout(pause)
    await page.mouse.up()
  }

  it('la balise : perspective, glisser horizontal sans bloquer le défilement vertical, clavier ; le premier plan reçoit le clic', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const s = await page.evaluate(() => {
        const g = (document.querySelector('mjs-gal-drag') as any)._shadow.querySelector('.g')
        const cs = getComputedStyle(g)
        const c  = g.getBoundingClientRect()
        const p  = g.getBoundingClientRect()
        const dessus = (document.querySelector('mjs-gal-drag') as any)._shadow.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
        // les boîtes des trois panneaux visibles : le premier plan est centré, ses voisins de part et d'autre
        const boite = (i: number) => { const r = g.children[i].getBoundingClientRect(); return (r.left + r.right) / 2 - (p.left + p.right) / 2 }
        return { persp: cs.perspective, touch: cs.touchAction, pos: cs.position, tab: g.getAttribute('tabindex'), role: g.getAttribute('aria-roledescription'), curseur: cs.cursor, dessus: dessus && dessus.textContent, gauche: boite(2), milieu: boite(3), droite: boite(4), caches: Array.from(g.children).map((k: any) => getComputedStyle(k).visibility) }
      })
      assert.equal(s.persp, '1200px')
      assert.equal(s.touch, 'pan-y', 'le glisser horizontal est à l\'effet, le vertical reste à la page')
      assert.equal(s.pos, 'relative', 'les panneaux sont posés en absolu dans une balise positionnée')
      assert.equal(s.tab, '0')
      assert.equal(s.role, 'carousel')
      assert.equal(s.curseur, 'grab')
      assert.equal(s.dessus, '3', 'au centre, le clic tombe sur le panneau de tête')
      assert.ok(Math.abs(s.milieu) < 1, `panneau de tête centré (${s.milieu})`)
      assert.ok(s.gauche < -380 && s.droite > 380 && Math.abs(s.gauche + s.droite) < 2, `voisins de part et d'autre, à égale distance (${s.gauche} / ${s.droite})`)
      assert.deepEqual(s.caches, ['hidden', 'hidden', 'visible', 'visible', 'visible', 'hidden', 'hidden', 'hidden'], 'seuls les trois panneaux proches se voient')
    })
  })

  it('glisser lent : la galerie se pose sur le panneau le plus proche, `change` le dit ; un glisser trop court revient', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      await glisse(page, 'mjs-gal-drag', -300, 150)
      assert.equal(await attend(page, 'mjs-gal-drag', '.n', '4'), '4', '300 px de glisser (0,6 panneau) : le panneau 4')
      await page.waitForTimeout(1500)
      assert.equal(await transform(page, 'mjs-gal-drag', 4), 'translate3d(0px,0px,0px)', 'posé pile devant')
      await glisse(page, 'mjs-gal-drag', -150, 150)
      await page.waitForTimeout(1500)
      assert.equal(await lu(page, 'mjs-gal-drag', '.n'), '4', '150 px (0,3 panneau) : il revient sur le panneau 4')
      assert.equal(await transform(page, 'mjs-gal-drag', 4), 'translate3d(0px,0px,0px)')
      // 980 px, du bord gauche au bord droit de la fenêtre : un glisser qui sortirait de la fenêtre ne livre plus à Firefox que des mouvements sans bouton
      await glisse(page, 'mjs-gal-drag', 980, 150, .01)
      assert.equal(await attend(page, 'mjs-gal-drag', '.n', '2'), '2', 'vers la droite, le panneau d\'avant : 4 − 2')
    })
  })

  it('glisser : un appui relâché hors de la balise est fini ; revenir sans bouton, ou entrer bouton enfoncé depuis dehors, ne déplace rien', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const tag = 'mjs-gal-drag'
      const c = await centre(page, tag)
      const bas = c.t + c.h
      const immobile = async (quoi: string) => {
        await page.waitForTimeout(400)
        assert.equal(await lu(page, tag, '.n'), '3', quoi)
        assert.equal(await transform(page, tag, 3), 'translate3d(0px,0px,0px)', quoi)
        assert.equal(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.g').hasAttribute('mjs-fx-gallery-drag'), tag), false, quoi)
      }
      // appui à 2 px du bord bas, relâché 10 px plus bas : la prise du pointeur ne vient qu'après 5 px de glisser, la balise ne voit ni la sortie ni le relâchement
      await page.mouse.move(c.x, bas - 2)
      await page.mouse.down()
      await page.mouse.move(c.x, bas + 10)
      await page.mouse.up()
      // un autre appui, dehors, qui entre sur la balise bouton enfoncé : ce n'est pas un glisser de la galerie
      await page.mouse.move(c.x, bas + 40)
      await page.mouse.down()
      await page.mouse.move(c.x, bas - 60, { steps: 3 })
      await page.mouse.move(c.x - 300, bas - 60, { steps: 6 })
      await page.mouse.up()
      await immobile('un glisser parti de dehors n\'emporte pas la galerie')
      // le même appui au bord, relâché dehors, puis retour sur la balise bouton relâché
      await page.mouse.move(c.x, bas - 2)
      await page.mouse.down()
      await page.mouse.move(c.x, bas + 10)
      await page.mouse.up()
      await page.mouse.move(c.x, bas - 60)
      await page.mouse.move(c.x - 300, bas - 60, { steps: 6 })
      await immobile('revenue sans bouton, la galerie ne suit pas la souris')
      await glisse(page, tag, -300, 150)
      assert.equal(await attend(page, tag, '.n', '4'), '4', 'un glisser ordinaire marche encore')
    })
  })

  it('glisser : un mouvement de souris sans bouton met fin à l\'appui, même si le relâchement n\'est jamais arrivé', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const tag = 'mjs-gal-drag'
      // sortie de la fenêtre, perte du focus : le navigateur ne dit pas toujours le relâchement, il dit que la souris bouge sans bouton
      await page.evaluate((t: string) => {
        const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
        const r = g.getBoundingClientRect()
        const ev = (type: string, dx: number, buttons: number) => g.dispatchEvent(new PointerEvent(type, { pointerId: 8, pointerType: 'mouse', button: 0, buttons, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2, bubbles: true }))
        ev('pointerdown', 0, 1)
        ev('pointermove', -2, 0)
        ev('pointermove', -200, 0)
        ev('pointermove', -300, 1)
      }, tag)
      await page.waitForTimeout(400)
      assert.equal(await lu(page, tag, '.n'), '3', 'sans bouton, plus d\'appui : la galerie reste au panneau 3')
      assert.equal(await transform(page, tag, 3), 'translate3d(0px,0px,0px)')
      assert.equal(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.g').hasAttribute('mjs-fx-gallery-drag'), tag), false)
    })
  })

  it('glisser vif : l\'élan emporte la galerie jusqu\'au dernier panneau sans le dépasser, puis s\'éteint', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      // une salve de six mouvements, un toutes les 5 ms de l'horloge des événements (posée à la main : Firefox ne la lit qu'à la milliseconde,
      // la salve tiendrait dans la même et la vitesse serait nulle) : la vitesse ne dépend pas de la charge de la machine
      await page.evaluate(() => {
        const g = (document.querySelector('mjs-gal-drag') as any)._shadow.querySelector('.g')
        const r = g.getBoundingClientRect()
        const t0 = performance.now()
        const ev = (type: string, dx: number, i: number, buttons = 1) => {
          const e = new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', button: 0, buttons, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2, bubbles: true })
          Object.defineProperty(e, 'timeStamp', { value: t0 + 5 * i })
          g.dispatchEvent(e)
        }
        ev('pointerdown', 0, 0)
        for (let i = 1; i <= 6; i++) ev('pointermove', -40 * i, i)
        ev('pointerup', -240, 7, 0)
      })
      assert.equal(await attend(page, 'mjs-gal-drag', '.n', '7', 4000), '7', 'un coup de main de 240 px (0,5 panneau) a porté la galerie jusqu\'au dernier panneau')
      await page.waitForTimeout(1500)
      assert.equal(await lu(page, 'mjs-gal-drag', '.n'), '7', 'et pas plus loin')
      assert.equal(await transform(page, 'mjs-gal-drag', 7), 'translate3d(0px,0px,0px)', 'posé pile sur le dernier')
      assert.equal(await raf(page), 0, 'l\'élan s\'est éteint : plus de boucle')
    })
  })

  it('un clic sans déplacement reste un clic ; le clic qui suit un vrai glisser est retenu, puis les clics reviennent', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const c = await centre(page, 'mjs-gal-drag')
      await page.mouse.click(c.x, c.y)
      assert.equal(await lu(page, 'mjs-gal-drag', '.c'), '1', 'un clic sans déplacement atteint le lien')
      assert.equal(await page.evaluate(() => (document.querySelector('mjs-gal-drag') as any)._shadow.querySelector('.g').hasAttribute('mjs-fx-gallery-drag')), false)
      // quelques pixels de tremblement, moins de 5 : encore un clic
      await page.mouse.move(c.x, c.y)
      await page.mouse.down()
      await page.mouse.move(c.x + 3, c.y + 2)
      await page.mouse.up()
      assert.equal(await lu(page, 'mjs-gal-drag', '.c'), '2', 'moins de 5 px de tremblement : toujours un clic')
      await glisse(page, 'mjs-gal-drag', -120, 150)
      await page.waitForTimeout(700)
      assert.equal(await lu(page, 'mjs-gal-drag', '.c'), '2', 'après un glisser, le clic qui suit n\'atteint pas le lien')
      const d = await centre(page, 'mjs-gal-drag')
      await page.mouse.click(d.x, d.y)
      assert.equal(await lu(page, 'mjs-gal-drag', '.c'), '3', 'le clic d\'après est de nouveau un clic')
    })
  })

  it('molette : seulement dans le sens du glisser (le vertical avec Maj) ; le vertical sans Maj reste à la page', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const c = await centre(page, 'mjs-gal-drag')
      await page.mouse.move(c.x, c.y)
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(60)
      await page.mouse.wheel(400, 0)
      await page.waitForTimeout(60)
      await page.keyboard.down('Shift')
      await page.mouse.wheel(0, 120)
      await page.keyboard.up('Shift')
      await page.waitForTimeout(400)
      const roues: boolean[] = await page.evaluate(() => (window as any).__roues)
      assert.equal(roues[0], false, 'la molette verticale n\'est pas retenue')
      assert.equal(roues[1], true, 'la molette horizontale est retenue')
      assert.equal(roues[2], true, 'la molette verticale avec Maj est retenue')
      const n = parseInt(await lu(page, 'mjs-gal-drag', '.n'))
      assert.ok(n > 3, `la molette horizontale a fait avancer la galerie (panneau ${n})`)
    })
  })

  it('molette avec `snap` : un cran avance d\'un panneau, un geste de plusieurs crans d\'autant, le sens inverse défait, un petit geste en vaut un', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const tag = 'mjs-gal-drag'
      const c = await centre(page, tag)
      // des événements de molette fabriqués dans la même tâche : un seul geste, quelle que soit la charge de la machine
      const crans = (...dx: number[]) => page.evaluate(([t, liste]: [string, number[]]) => {
        const g = (document.querySelector(t) as any)._shadow.querySelector('.g')
        for (const d of liste) g.dispatchEvent(new WheelEvent('wheel', { deltaX: d, deltaY: 0, deltaMode: 0, bubbles: true, cancelable: true }))
      }, [tag, dx])
      await page.mouse.move(c.x, c.y)
      await page.waitForTimeout(150)
      await page.mouse.wheel(100, 0)
      assert.equal(await attend(page, tag, '.n', '4'), '4', 'un cran horizontal : le panneau 4')
      assert.equal(await posee(page, tag, 4), 'translate3d(0px,0px,0px)', 'posé pile devant')
      await page.keyboard.down('Shift')
      await page.mouse.wheel(0, 100)
      await page.keyboard.up('Shift')
      assert.equal(await attend(page, tag, '.n', '5'), '5', 'un cran vertical avec Maj : le panneau 5')
      await page.waitForTimeout(400)
      await page.mouse.wheel(-100, 0)
      assert.equal(await attend(page, tag, '.n', '4'), '4', 'un cran en sens inverse : le panneau 4')
      await page.waitForTimeout(400)
      await crans(100, 100)
      assert.equal(await attend(page, tag, '.n', '6'), '6', 'deux crans dans le même geste : deux panneaux')
      assert.equal(await posee(page, tag, 6), 'translate3d(0px,0px,0px)', 'posé pile devant')
      assert.equal(await raf(page), 0, 'le mouvement fini, plus de boucle')
      await page.waitForTimeout(400)
      await crans(100, -100)
      assert.equal(await posee(page, tag, 6), 'translate3d(0px,0px,0px)', 'un cran puis le cran inverse dans le même geste : le sens inverse défait le premier')
      assert.equal(await lu(page, tag, '.n'), '6')
      // un petit geste (un doigt sur un pavé tactile) avance aussi d'un panneau, chaque geste du sien
      await page.waitForTimeout(400)
      await crans(-40)
      assert.equal(await attend(page, tag, '.n', '5'), '5', 'un petit geste : un panneau')
      await page.waitForTimeout(400)
      await crans(-40)
      assert.equal(await attend(page, tag, '.n', '4'), '4', 'un second petit geste, à part : un autre panneau')
      assert.equal(await posee(page, tag, 4), 'translate3d(0px,0px,0px)', 'posé pile devant')
      assert.equal(await raf(page), 0, 'le mouvement fini, plus de boucle')
    })
  })

  it('sans `snap` : la molette et le glisser laissent la galerie entre deux panneaux, où ils l\'ont menée', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-nosnap', async (page) => {
      const tag = 'mjs-gal-nosnap'
      const x = async (i: number) => parseFloat((await transform(page, tag, i)).replace('translate3d(', ''))
      const c = await centre(page, tag)
      await page.mouse.move(c.x, c.y)
      await page.waitForTimeout(150)
      // un cran de molette : un quart de panneau (100 px × 0,0025), la galerie reste au panneau 3 et ne se pose pas
      await page.mouse.wheel(100, 0)
      await page.waitForTimeout(1500)
      assert.equal(await lu(page, tag, '.n'), '3', 'un cran sans snap : le panneau 3 reste de tête')
      assert.ok(Math.abs(await x(3) + 122.5) < 3, `le panneau 3 est à un quart de panneau à gauche (${await x(3)} px), pas posé`)
      // un glisser lent de 300 px (0,61 panneau) : elle s'arrête là où la main s'est arrêtée
      await glisse(page, tag, -300, 150)
      assert.equal(await attend(page, tag, '.n', '4'), '4', 'à 3,86 : le panneau 4 est de tête')
      await page.waitForTimeout(1500)
      assert.ok(Math.abs(await x(4) - 67.6) < 3, `le panneau 4 est resté à 0,14 panneau à droite (${await x(4)} px), la galerie ne s\'est pas posée`)
    })
  })

  it('après un glisser, le clic qui part d\'un panneau (sans prise du pointeur sur lui) est retenu, une seule fois', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      await apresGlisser(page, 'mjs-gal-drag', 'clics')
      assert.equal(await lu(page, 'mjs-gal-drag', '.c'), '1', 'deux clics partis du panneau juste après le glisser : le premier est retenu, le second atteint le lien')
    })
  })

  it('le retrait ne laisse rien derrière lui : le clic retenu après un glisser est rendu, la molette est rendue à la page', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      const tag = 'mjs-gal-drag'
      // le glisser fini, l'effet retiré dans la même tâche : le clic retenu (50 ms) ne doit plus l'être
      await apresGlisser(page, tag, 'retrait')
      assert.equal(await lu(page, tag, '.c'), '1', 'effet retiré : le clic atteint le lien')
      const c = await centre(page, tag)
      await page.mouse.move(c.x, c.y)
      await page.mouse.wheel(400, 0)
      await page.waitForTimeout(200)
      assert.deepEqual(await page.evaluate(() => (window as any).__roues), [false], 'effet retiré : la molette horizontale n\'est plus retenue')
    })
  })

  it('clavier : flèches droite et gauche, après le focus de la balise', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-drag', async (page) => {
      await page.evaluate(() => (document.querySelector('mjs-gal-drag') as any)._shadow.querySelector('.g').focus())
      await page.keyboard.press('ArrowRight')
      assert.equal(await attend(page, 'mjs-gal-drag', '.n', '4'), '4')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      assert.equal(await attend(page, 'mjs-gal-drag', '.n', '2'), '2')
      await page.waitForTimeout(1500)
      assert.equal(await raf(page), 0, 'rien ne tourne une fois la galerie posée')
      const wc = await page.evaluate(() => getComputedStyle((document.querySelector('mjs-gal-drag') as any)._shadow.querySelector('.g').children[2]).willChange)
      assert.equal(wc, 'auto', 'will-change n\'est posé que pendant le mouvement')
    })
  })

  it('défilement : la galerie collante suit la traversée de sa section ; rien ne tourne au repos', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-scroll', async (page) => {
      assert.equal(await lu(page, 'mjs-gal-scroll', '.n'), '0')
      // la section fait 3 200 px, la balise 800 : la traversée dure 2 400 px
      await page.evaluate(() => window.scrollTo(0, 1680))
      assert.equal(await attend(page, 'mjs-gal-scroll', '.n', '5'), '5', 'aux 70 % de la traversée : le panneau 5 (4,9 arrondi)')
      await page.evaluate(() => window.scrollTo(0, 2400))
      assert.equal(await attend(page, 'mjs-gal-scroll', '.n', '7'), '7', 'à la fin : le dernier panneau')
      await page.evaluate(() => window.scrollTo(0, 240))
      assert.equal(await attend(page, 'mjs-gal-scroll', '.n', '1'), '1', 'à 10 % : le panneau 1 (0,7 arrondi)')
      await page.waitForTimeout(500)
      assert.equal(await raf(page), 0, 'le défilement arrêté, plus de boucle')
    })
  })

  it('défilement : les lectures de mise en page précèdent les écritures (aucune dans une image d\'animation), le conteneur est cherché une fois par geste, le z-index n\'est écrit que quand l\'ordre change', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-scroll', async (page) => {
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const w = window as any
        // l'horloge de la page avance de 16 ms par image d'animation : un geste continu se compte en images, pas en millisecondes d'une machine chargée
        let t = Date.now() + 10000
        let vue = -1
        Date.now = () => t
        const ra = w.requestAnimationFrame
        w.requestAnimationFrame = (f: any) => ra.call(w, (x: number) => { if (x !== vue) { vue = x; t += 16 } return f(x) })
        w.__lect = 0
        w.__calc = 0
        w.__zi = 0
        // les `z-index` écrits sur les panneaux (le texte de leur attribut style change de z-index), sans dépendre des accesseurs du navigateur
        const zi = (s: string | null) => /z-index:\s*([^;]+)/.exec(s || '')?.[1]
        new MutationObserver((rs) => { for (const r of rs) if (w.__mesure && zi(r.oldValue) !== zi((r.target as any).getAttribute('style'))) w.__zi++ })
          .observe((document.querySelector('mjs-gal-scroll') as any)._shadow, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true })
        w.__mesure = true
      })
      // trente pas de 20 px, deux images d'animation entre chacun : un geste continu (jamais 100 ms sans défiler)
      for (let i = 1; i <= 30; i++) {
        await page.evaluate((y: number) => { window.scrollTo(0, y); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) }, 20 * i)
      }
      const m = await page.evaluate(() => { const w = window as any; w.__mesure = false; return { lect: w.__lect, calc: w.__calc, zi: w.__zi } })
      assert.equal(m.lect, 0, 'les lectures de mise en page se font dans l\'événement de défilement, avant que les images d\'animation n\'écrivent : ' + m.lect + ' dans une image d\'animation')
      assert.ok(m.calc <= 8, 'le conteneur et la balise collante sont cherchés au début du geste, pas à chaque image : ' + m.calc + ' styles calculés en 30 pas')
      assert.ok(m.zi <= 60, 'le z-index n\'est écrit que quand l\'ordre des panneaux change : ' + m.zi + ' écritures en 30 pas')
      // à 600 px de la traversée de 2 400 : la place 1,75 (smooth: 1) — le panneau 2 devant le 1, devant le 3
      const z = await page.evaluate(() => [1, 2, 3].map((i) => Number(getComputedStyle((document.querySelector('mjs-gal-scroll') as any)._shadow.querySelector('.coll').children[i]).zIndex)))
      assert.ok(z[1] > z[0] && z[0] > z[2], 'l\'ordre de superposition suit la distance à la place 1,75 : ' + z.join(' '))
      assert.equal(await lu(page, 'mjs-gal-scroll', '.n'), '2')
    })
  })

  it('défilement : l\'écoute de la fenêtre ne dure que près de l\'écran, et la balise est à sa place quand on arrive', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-loin', async (page) => {
      const loin = await page.evaluate(() => (window as any).__defil)
      await page.evaluate(() => window.scrollTo(0, 3300))
      await page.waitForTimeout(400)
      const pres = await page.evaluate(() => (window as any).__defil)
      assert.ok(pres > loin, `à l'approche, l'écoute commence (${loin} → ${pres})`)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(400)
      assert.equal(await page.evaluate(() => (window as any).__defil), loin, 'éloignée, elle s\'arrête : autant d\'écouteurs qu\'avant')
      assert.equal(await raf(page), 0, 'et aucune boucle')
    })
  })

  it('défilement avec `zone` : le panneau suit la place de la balise dans la bande d\'écran donnée', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-zone', async (page) => {
      // le haut de la balise à `haut` px du haut de l'écran (800 px) : la bande « center top » vaut (400 − haut) / 400 (sans bande, ce serait (800 − haut) / 700)
      const place = (haut: number) => page.evaluate((h: number) => {
        const g = (document.querySelector('mjs-gal-zone') as any)._shadow.querySelector('.g')
        window.scrollTo(0, window.scrollY + g.getBoundingClientRect().top - h)
      }, haut)
      await place(320)
      assert.equal(await attend(page, 'mjs-gal-zone', '.n', '1'), '1', 'à 20 % de la bande : 1,4 panneau, le panneau 1 (sans la bande donnée : le panneau 5)')
      await place(80)
      assert.equal(await attend(page, 'mjs-gal-zone', '.n', '6'), '6', 'à 80 % de la bande : 5,6 panneaux, le panneau 6 (sans la bande donnée : le dernier)')
      await page.waitForTimeout(400)
      assert.equal(await raf(page), 0)
    })
  })

  it('réglages tenus par des variables : style, gap et index se suivent sur place, tilt et on relancent l\'effet', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-vars', async (page) => {
      const tag = 'mjs-gal-vars'
      const clic = (cls: string) => page.evaluate(([t, c]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector(c).click(), [tag, cls])
      // l'effet posé : sa fonction de retrait, gardée pour savoir s'il a été reposé
      const garde = () => page.evaluate((t: string) => { const g = (document.querySelector(t) as any)._shadow.querySelector('.g'); (window as any).__off0 = g._mjs_fxOff.gallery }, tag)
      const memeEffet = () => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.g')._mjs_fxOff.gallery === (window as any).__off0, tag)
      await garde()
      assert.equal(await transform(page, tag, 4), 'translate3d(490px,0px,-130px)rotateY(-40.11deg)rotateZ(4.58deg)')
      await clic('.b-gap')
      await page.waitForTimeout(200)
      assert.equal((await transform(page, tag, 4)).split(',')[0], 'translate3d(980px', 'gap 2 : le voisin deux fois plus loin')
      assert.ok(await memeEffet(), 'gap se suit sur place')
      await clic('.b-arc')
      await page.waitForTimeout(200)
      assert.ok((await transform(page, tag, 3)).includes('rotateX(6.88deg)'), 'style arc : le panneau de tête est un peu relevé')
      assert.ok(await memeEffet(), 'style se suit sur place')
      await clic('.b-idx')
      assert.equal(await attend(page, tag, '.n', '5'), '5', 'index 5 : la galerie va au panneau 5')
      assert.ok(await memeEffet(), 'index se suit sur place')
      await clic('.b-tilt')
      await page.waitForTimeout(200)
      assert.ok(!(await memeEffet()), 'tilt de 0 à 8 : l\'effet est reposé (la souris est écoutée)')
      const c = await centre(page, tag)
      await page.mouse.move(c.x - 200, c.y - 100)
      await page.mouse.move(c.x + 300, c.y + 120)
      await page.waitForTimeout(500)
      assert.ok((await transform(page, tag, 5)).startsWith('rotateX('), 'la scène penche vers la souris')
      await garde()
      await clic('.b-ptr')
      await page.waitForTimeout(200)
      assert.ok(!(await memeEffet()), 'on : l\'effet est reposé')
      assert.equal(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.g').getAttribute('mjs-fx-gallery-on'), tag), 'pointer')
    })
  })

  it('tilt : la boîte de la balise est relue quand la page défile sous une souris qui reste dessus ; le suivi du défilement ne dure que le temps de la souris', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-tilt', async (page) => {
      const tag = 'mjs-gal-tilt'
      const c = await centre(page, tag)
      // l'inclinaison autour de l'axe horizontal, lue sur le panneau de tête (0 quand la scène est à plat)
      const penche = async () => {
        const m = /^rotateX\(([-\d.]+)deg\)/.exec(await transform(page, tag, 3))
        return m ? parseFloat(m[1]) : 0
      }
      const defil = () => page.evaluate(() => (window as any).__defil)
      const base = await defil()
      // la souris à 100 px sous le haut de la balise (haute de 600 px) : 1/6 de sa hauteur, la scène penche de (1/2 − 1/6) × 2 × 10 = 6,67°
      const y = c.t + 100
      await page.mouse.move(c.x - 50, y)
      await page.mouse.move(c.x, y, { steps: 3 })
      await page.waitForTimeout(300)
      const avant = await penche()
      assert.ok(Math.abs(avant - 6.67) < .2, `souris à un sixième de la hauteur : ${avant}° au lieu de 6,67°`)
      assert.ok(await defil() > base, 'la souris est sur la balise : la page est écoutée')
      // la page défile de 200 px sous la souris immobile, puis la souris bouge d'un pixel : elle est maintenant à 301/600 de la balise, à peu près au milieu
      await page.evaluate(() => window.scrollBy(0, 200))
      await page.waitForTimeout(400)
      await page.mouse.move(c.x + 1, y + 1)
      await page.waitForTimeout(300)
      const apres = await penche()
      assert.ok(Math.abs(apres) < .5, `après le défilement, la souris est au milieu de la balise : ${apres}° au lieu de 0° (la boîte d'avant le défilement donnerait ${avant}°)`)
      // la souris quitte la balise : plus d'écoute de la page
      await page.mouse.move(c.x, 700)
      await page.waitForTimeout(300)
      assert.equal(await defil(), base, 'la souris est partie : plus d\'écouteur de défilement')
      // elle revient, puis l'effet est retiré : plus rien non plus
      await page.mouse.move(c.x, y)
      await page.mouse.move(c.x + 1, y + 1)
      await page.waitForTimeout(300)
      assert.ok(await defil() > base, 'revenue sur la balise : la page est de nouveau écoutée')
      await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.g')._mjs_fxOff.gallery(), tag)
      assert.equal(await defil(), base, 'effet retiré : plus d\'écouteur de défilement')
    })
  })

  it('pointer : la place de la souris, de gauche à droite', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-pointer', async (page) => {
      const c = await centre(page, 'mjs-gal-pointer')
      await page.mouse.move(c.l + c.w * .9, c.y)
      assert.equal(await attend(page, 'mjs-gal-pointer', '.n', '6'), '6')
      await page.mouse.move(c.l + c.w * .1, c.y)
      assert.equal(await attend(page, 'mjs-gal-pointer', '.n', '1'), '1')
      await page.waitForTimeout(300)
      assert.equal(await raf(page), 0)
    })
  })

  it('always : la galerie loin sous l\'écran se repose, avance quand on la voit, se repose quand on la quitte', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-always', async (page) => {
      // `always` démarre à la pose et ne s'arrête qu'au premier mot de l'observateur d'intersection (µ._mjs_fxRun) : sur une machine chargée, ce mot
      // vient après quelques images de marche. On attend que la boucle se repose, puis on mesure : hors écran, elle n'avance plus
      const fin = Date.now() + 8000
      while (await raf(page) !== 0 && Date.now() < fin) await page.waitForTimeout(100)
      await page.waitForTimeout(300)
      const n0 = await lu(page, 'mjs-gal-always', '.n')
      await page.waitForTimeout(700)
      assert.equal(await lu(page, 'mjs-gal-always', '.n'), n0, 'hors écran, elle n\'avance pas')
      assert.equal(await raf(page), 0, 'hors écran, aucune boucle')
      await page.evaluate(() => window.scrollTo(0, 2900))
      await page.waitForTimeout(900)
      const n = parseInt(await lu(page, 'mjs-gal-always', '.n'))
      assert.ok(n >= 2, `à l'écran, elle avance toute seule (panneau ${n})`)
      assert.ok(await raf(page) > 0, 'à l\'écran, elle a sa boucle')
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(500)
      assert.equal(await raf(page), 0, 'quittée, la boucle se repose')
    })
  })

  it('always : une galerie sans panneau ou avec un seul n\'a rien à animer et ne tourne pas ; un panneau ajouté la met en route', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-un', async (page) => {
      const tag = 'mjs-gal-un'
      // les images d'animation demandées pendant `ms`
      const images = (ms: number) => page.evaluate((m: number) => new Promise<number>((ok) => { const a = (window as any).__rafN; setTimeout(() => ok((window as any).__rafN - a), m) }), ms)
      await page.waitForTimeout(500)
      const n = await images(1500)
      assert.ok(n <= 3, `rien à animer : ${n} images demandées en 1,5 s (une soixantaine par seconde quand la boucle tourne)`)
      assert.equal(await raf(page), 0, 'aucune image en attente')
      // un second panneau : la galerie qui n'avait qu'un panneau se met en route
      await page.evaluate((t: string) => {
        const g = (document.querySelector(t) as any)._shadow.querySelector('.g1')
        const a = document.createElement('a')
        a.className = 'p'
        a.textContent = '1'
        g.appendChild(a)
      }, tag)
      assert.equal(await attend(page, tag, '.n', '1', 4000), '1', 'avec deux panneaux, elle avance toute seule')
    })
  })

  it('le retrait rend aux panneaux leur mise en page d\'origine, à la case près', async function () {
    if (!present) return this.skip()
    await avec('mjs-gal-ref', async (page) => {
      const avant = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-gal-ref') as any)._shadow
        const g = sh.querySelector('.g')
        const dessous = Array.from(g.children).map((k: any) => k.style.transform)
        // l'effet retiré, comme le ferait un bloc {if} refermé
        const off = g._mjs_fxOff.gallery
        off()
        return { dessous, restes: g.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), style: g.getAttribute('style') }
      })
      assert.ok(avant.dessous.some((t: string) => t.includes('translate3d')), 'les panneaux étaient placés par l\'effet')
      assert.deepEqual(avant.restes, [])
      assert.ok(!avant.style, 'plus de style en ligne sur la balise (ni variable, ni position)')
      const rects = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-gal-ref') as any)._shadow
        const boites = (sel: string) => {
          const g = sh.querySelector(sel)
          const o = g.getBoundingClientRect()
          return Array.from(g.children).map((k: any) => { const r = k.getBoundingClientRect(); return [Math.round(r.left - o.left), Math.round(r.top - o.top), Math.round(r.width), Math.round(r.height), k.getAttribute('style'), getComputedStyle(k).position, getComputedStyle(k).visibility] })
        }
        return { g: boites('.g'), r: boites('.r') }
      })
      assert.deepEqual(rects.g, rects.r, 'chaque panneau retrouve sa place, sa taille, son style et sa position d\'origine')
      assert.ok(rects.g.every((b: any) => b[4] === null && b[5] === 'static' && b[6] === 'visible'))
    })
  })
})
}
