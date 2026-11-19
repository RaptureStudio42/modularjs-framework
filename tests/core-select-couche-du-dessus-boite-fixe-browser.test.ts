// la liste d'un <@@select> dans une boîte `position: fixed` ou transformée (la fenêtre µ.modal, un panneau fixe de l'appli, une boîte
// déplacée par `transform`) : dans la couche du dessus (`popover`), placée par le script contre son bouton — entière, devant la modale,
// jamais rognée par la boîte qui défile ; elle suit son bouton à chaque image tant qu'elle est ouverte (défilement de la boîte, d'un
// conteneur dans une ombre ou de la page, redimensionnement, bloc ajouté au-dessus, panneau déplacé, animation d'ouverture de la
// modale), au repos une lecture de la place du bouton par image et aucune écriture, plus rien une fois fermée ou détruite ; elle se ferme
// quand son bouton est caché par la boîte qui défile ou sort de l'écran ; droite à gauche, plus large que son bouton, elle s'aligne sur
// son bord droit, comme la liste ancrée ; son côté suit le sens d'écriture du bloc de son bouton, même contraire à celui de la page ; une
// animation que la page pose sur la liste (`::part(panel)`, une ouverture en `scale`) ne la décale pas. Échap suit le chemin de toute touche : les écouteurs que la page pose en capture le reçoivent
// avant la liste, qui le garde ensuite pour elle ; dans la modale, Échap ferme la liste et pas la modale, le piège à Tab tient, un clic
// dans la modale hors de la liste ferme la liste seule, la modale qui se ferme ferme la liste. Une liste détruite ouverte quitte le
// registre des menus ouverts (`µ._mjs_menus`, lu en développement : la production raccourcit son nom). Hors de ces boîtes, rien ne
// change : la liste ancrée par le CSS ; sans ancrage CSS (le test de fonction forcé à faux), celle de la page passe aussi dans la
// couche du dessus, placée par le script, comme celle du panneau fixe. Aucune erreur ni dans la page ni dans la console. Chromium, Firefox et WebKit
// réels, construction de développement et de production ; en production, `µ` n'est pas sur `window` : la scène l'y pose pour le test

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES   = ['dev', 'prod'] as const

const NOMS = ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit']
const HUIT = NOMS.map((t, i) => `<@@option value="${i + 1}">${t}</@@option>`).join('')

// une liste hors de toute boîte, une dans un panneau fixe dont le contenu défile (dans l'ombre de la scène), une dans une boîte déplacée, deux dans des panneaux fixes qui portent leur propre sens d'écriture (`dir`)
const SCENE = `<script>
  window.__mu = µ
</script>

<@@select class="s-page" aria-label="Liste de la page">${HUIT}</@@select>
<@@select class="s-etroit-page" aria-label="Liste étroite de la page">${HUIT}</@@select>
<div class="panneau"><div class="defile"><div class="vide"></div><@@select class="s-panneau" aria-label="Liste du panneau">${HUIT}</@@select><@@select class="s-etroit" aria-label="Liste étroite du panneau">${HUIT}</@@select><div class="long"></div></div></div>
<div class="tourne"><@@select class="s-tourne" aria-label="Liste déplacée">${HUIT}</@@select></div>
<div class="fixe-rtl" dir="rtl"><@@select class="s-rtl" aria-label="Liste d'un bloc écrit de droite à gauche">${HUIT}</@@select></div>
<div class="fixe-ltr" dir="ltr"><@@select class="s-ltr" aria-label="Liste d'un bloc écrit de gauche à droite">${HUIT}</@@select></div>

<style>
  :host
    display: block

  .s-page
    position: absolute
    left: 10px
    top: 10px
    width: 160px

  .s-etroit-page
    position: absolute
    left: 420px
    top: 10px
    width: 40px

  .panneau
    position: fixed
    left: 600px
    top: 20px
    width: 240px
    height: 200px
    background: #eee

    &.descendu
      top: 80px

  .defile
    height: 100%
    overflow: auto

  .vide
    height: 60px

  .long
    height: 600px

  .tourne
    position: absolute
    left: 10px
    top: 300px
    transform: translateX(20px)

  .s-panneau, .s-tourne
    width: 160px

  .s-etroit
    width: 40px

  .fixe-rtl, .fixe-ltr
    position: fixed
    left: 260px
    width: 60px

  .fixe-rtl
    top: 130px

  .fixe-ltr
    top: 210px

  .s-rtl, .s-ltr
    width: 40px
</style>
`

// le contenu de la modale : un champ avant la liste (le piège à Tab), la place qui fait défiler le corps de la boîte (300 px de haut)
const DANS = `<input class="avant" aria-label="Avant"><div class="haut"></div><mjs-core-select class="s-mod" aria-label="Liste de la modale" search>${NOMS.map((t, i) => `<mjs-core-option value="${i + 1}">${t}</mjs-core-option>`).join('')}</mjs-core-select><div class="bas"></div>`

// Échap noté par des écouteurs posés avant tout, en capture et en bulle, sur la fenêtre et le document ; les lectures de la place
// d'un élément (`__cible`) comptées
const OUTILS = `
window.__recu = []
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') __recu.push('win-capture') }, true)
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') __recu.push('win-bulle') })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') __recu.push('doc-capture') }, true)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') __recu.push('doc-bulle') })
window.__lus = 0
window.__cible = null;
(() => { const lit = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { if (this === window.__cible) window.__lus++; return lit.call(this) } })()
window.__compter = async (el, n) => { window.__cible = el; window.__lus = 0; let i = 0; await new Promise((f) => { const go = () => { if (++i >= n) f(); else requestAnimationFrame(go) }; requestAnimationFrame(go) }); window.__cible = null; return window.__lus }
window.__o = (el) => el._shadow || el.shadowRoot
window.__h = () => __o(document.querySelector('mjs-scene'))
window.__q = (sel) => __h().querySelector(sel)
window.__mod = () => document.querySelector('.mjs-modal-box .s-mod')
window.__c = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width } }
window.__actif = () => { let a = document.activeElement; while (a && __o(a) && __o(a) !== a && __o(a).activeElement) a = __o(a).activeElement; return a }
window.__nom = (a) => !a ? 'null' : a === document.body ? 'body' : (typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\\s+/)[0] : a.nodeName.toLowerCase())
window.__fond = () => document.querySelector('.mjs-modal-backdrop')
window.__boite = () => document.querySelector('.mjs-modal-box')
window.__images = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))
window.__liste = (s) => { const o = __o(s), p = o.querySelector('.select-panel'), b = o.querySelector('.select-btn'); return p ? { p: __c(p), b: __c(b), dessus: p.matches(':popover-open'), position: getComputedStyle(p).position, haut: p.classList.contains('up'), ancree: p.classList.contains('anchored'), ouvert: b.getAttribute('aria-expanded') } : { ferme: true, ouvert: b.getAttribute('aria-expanded') } }
window.__dansBoite = () => { let a = __actif(); while (a && a.getRootNode() !== document) a = a.getRootNode().host; return !!a && !!__boite() && __boite().contains(a) }
window.__menus = () => window.__mu && window.__mu._mjs_menus ? window.__mu._mjs_menus.size : 0
`

// sans ancrage : le test de fonction répond non, le moteur garde ses règles
const SANS_ANCRAGE = `(() => { const s = CSS.supports.bind(CSS); CSS.supports = function (a, b) { return /anchor|position-area|position-try/.test(String(a) + ' ' + String(b)) ? false : (arguments.length > 1 ? s(a, b) : s(a)) } })()`

// contre son bouton : 4 px dessous (dessus avec `up`), bord gauche
const contre = (l: any, gap = 4, tol = 1.5) => !!l.p && (l.haut ? Math.abs(l.p.b - (l.b.t - gap)) : Math.abs(l.p.t - (l.b.b + gap))) <= tol && Math.abs(l.p.l - l.b.l) <= tol

const construits = new Map<string, Promise<string>>()

// une construction par mode, partagée par les trois moteurs : le dossier de sortie, servi sous /out
function construire(mode: string): Promise<string> {
  if (!construits.has(mode)) {
    construits.set(mode, (async () => {
      const root   = mjsTmp('select-couche-dessus-' + mode)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'scene.mjs'), SCENE)
      // le test appelle µ.modal depuis son propre code, hors des sources compilées : 'all' rend le cœur complet
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', runtime: 'all', env: mode } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    })())
  }
  return construits.get(mode)!
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' }

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script><style>html,body{margin:0}.petite{max-height:300px}.haut{height:40px}.bas{height:600px}.loin{height:3000px}.ajout{height:60px}mjs-core-select.anime::part(panel){animation:grandit .4s linear}@keyframes grandit{from{transform:scale(.8)}to{transform:none}}mjs-core-select.fondu::part(panel){animation:fondu .4s linear}@keyframes fondu{from{opacity:0}to{opacity:1}}</style></head><body><mjs-scene></mjs-scene><div class="loin"></div></body></html>`

for (const nom of MOTEURS) for (const mode of MODES) describe(`<@@select> dans une boîte fixe ou transformée : la couche du dessus, placée par le script (${nom} réel, construction ${mode})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let sortie = ''
  let page: any
  let erreurs: string[] = []

  const lire = (corps: string) => page.evaluate(`(async () => { ${corps} })()`)
  const pret = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 10000 })

  // la page servie, la scène montée (un script avant tout autre si `avant`)
  async function charger(avant = '') {
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    await page.addInitScript(OUTILS)
    if (avant) await page.addInitScript(avant)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.route('http://couche.test/**', (route: any) => {
      const chemin = new URL(route.request().url()).pathname
      if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE })
      const fichier = join(sortie, chemin.slice(5))
      if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ status: 200, contentType: TYPES[extname(fichier)] ?? 'application/octet-stream', body: readFileSync(fichier) })
    })
    await page.goto('http://couche.test/')
    await page.waitForFunction(`(() => { const h = document.querySelector('mjs-scene'); const r = h && __o(h); const s = r && r.querySelector('.s-tourne'); return !!window.__mu && !!customElements.get('mjs-core-select') && !!s && !!__o(s) && !!__o(s).querySelector('.select-btn') })()`, null, { timeout: 15000 })
    await page.waitForTimeout(150)
    await page.evaluate(`window.µ = window.µ || window.__mu`)
  }

  // la liste ouverte par un vrai clic sur son bouton (`s` : l'expression qui rend la balise)
  async function ouvrir(s: string) {
    const b = await lire(`return __c(__o(${s}).querySelector('.select-btn'))`)
    await page.mouse.click(b.x, b.y)
    await pret(`!!__o(${s}).querySelector('.select-panel')`)
    await lire(`await __images()`)
  }

  // la liste ouverte au clavier : son bouton pris, la flèche basse
  async function ouvrirClavier(s: string) {
    await lire(`__o(${s}).querySelector('.select-btn').focus(); await __images()`)
    await page.keyboard.press('ArrowDown')
    await pret(`!!__o(${s}).querySelector('.select-panel')`)
    await lire(`await __images()`)
  }

  // la modale ouverte (son contenu : `html`), son fondu fini, la liste de son corps montée
  async function poser(html = DANS) {
    await lire(`window.__r = undefined; µ.modal.fire({ title: 'Choix', html: ${JSON.stringify(html)}, showCancelButton: true, customClass: { box: 'petite' } }).then((r) => { window.__r = r }); await __images()`)
    await page.waitForTimeout(250)
    await pret(`!!__mod() && !!__o(__mod()) && !!__o(__mod()).querySelector('.select-btn')`)
  }

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    sortie  = await construire(mode)
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  beforeEach(async function () {
    if (!present) { this.skip(); return }
    erreurs = []
    await charger()
  })

  afterEach(async function () {
    if (!present || !page) return
    await page.close()
    page = null
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('dans une µ.modal dont le corps défile : la liste s\'affiche entière, devant la modale, contre son bouton ; elle suit le défilement du corps et le redimensionnement ; son bouton caché par la boîte, elle se ferme', async function () {
    await poser()
    await ouvrir('__mod()')
    const l = await lire(`return __liste(__mod())`)
    assert.ok(l.dessus && l.position === 'fixed' && contre(l), `couche du dessus, contre son bouton : ${JSON.stringify(l)}`)
    const k = await lire(`return __c(__boite())`)
    assert.ok(l.p.b > k.b + 40, `sanity : le bas de la liste dépasse la boîte : ${JSON.stringify({ l, k })}`)
    const vu = await lire(`const p = __o(__mod()).querySelector('.select-panel'), y = (${k.b} + ${l.p.b}) / 2, e = __o(__mod()).elementFromPoint(${l.p.l} + 12, y); return !!e && p.contains(e)`)
    assert.equal(vu, true, 'le bas de la liste, hors de la boîte, se voit : rien ne la rogne ni ne la couvre')
    await lire(`__boite().scrollTop = 30; await __images()`)
    const d = await lire(`return __liste(__mod())`)
    assert.ok(contre(d) && Math.abs(d.b.t - (l.b.t - 30)) <= 1.5, `le corps défilé : la liste suit son bouton : ${JSON.stringify(d)}`)
    await page.setViewportSize({ width: 900, height: 640 })
    await lire(`await __images()`)
    const r = await lire(`return __liste(__mod())`)
    assert.ok(contre(r) && Math.abs(r.b.l - d.b.l) > 20, `la fenêtre redimensionnée : la liste suit son bouton : ${JSON.stringify(r)}`)
    await lire(`__boite().scrollTop = 260; await __images(); await __images()`)
    const f = await lire(`return { liste: __liste(__mod()), b: __c(__o(__mod()).querySelector('.select-btn')), k: __c(__boite()), ouverte: !!__fond() && window.__r === undefined }`)
    assert.ok(f.b.b <= f.k.t + 28, `sanity : le bouton est caché par la boîte : ${JSON.stringify(f)}`)
    assert.ok(f.liste.ferme && f.liste.ouvert === 'false' && f.ouverte, `la liste fermée, la modale ouverte : ${JSON.stringify(f)}`)
  })

  it('dans la modale : Échap ferme la liste et pas la modale, le focus revient au bouton ; un second Échap ferme la modale', async function () {
    await poser()
    await ouvrir('__mod()')
    await pret(`__nom(__actif()) === '.select-search'`)
    await lire(`__recu.length = 0`)
    await page.keyboard.press('Escape')
    await lire(`await __images()`)
    const r = await lire(`return { liste: __liste(__mod()).ferme === true, ouverte: !!__fond() && window.__r === undefined, focus: __nom(__actif()), recu: __recu.join(',') }`)
    assert.deepEqual(r, { liste: true, ouverte: true, focus: '.select-btn', recu: 'win-capture,doc-capture' }, 'les écouteurs en capture de la page l\'ont reçu, avant la modale')
    await page.keyboard.press('Escape')
    await pret(`!!window.__r && !__fond()`)
    assert.equal(await lire(`return window.__r.dismiss`), 'esc')
  })

  it('dans la modale, liste ouverte : le piège à Tab tient (Tab et Maj+Tab), la liste se ferme au premier Tab', async function () {
    await poser()
    await ouvrir('__mod()')
    await pret(`__nom(__actif()) === '.select-search'`)
    const pas: any[] = []
    for (const touche of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Tab', 'Tab', 'ArrowDown', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(touche)
      await lire(`await __images()`)
      pas.push(await lire(`return { focus: __nom(__actif()), dedans: __dansBoite(), liste: !__liste(__mod()).ferme }`))
    }
    assert.ok(pas.every((p) => p.dedans), `le focus reste dans la boîte : ${JSON.stringify(pas)}`)
    assert.equal(pas[0].liste, false, `le premier Tab ferme la liste : ${JSON.stringify(pas)}`)
    assert.equal(pas[6].liste, true, `la flèche rouvre la liste : ${JSON.stringify(pas)}`)
    assert.equal(await lire(`return !!__fond() && window.__r === undefined`), true, 'la modale reste ouverte')
  })

  it('dans la modale : un clic hors de la liste ferme la liste seule ; la modale qui se ferme ferme la liste, qui quitte le registre des menus ouverts', async function () {
    const depart = await lire(`return __menus()`)
    await poser()
    await ouvrir('__mod()')
    if (mode === 'dev') assert.equal(await lire(`return __menus()`), depart + 1, 'la liste ouverte inscrite au registre')
    const t = await lire(`return __c(document.querySelector('.mjs-modal-title'))`)
    await page.mouse.click(t.x, t.y)
    await lire(`await __images()`)
    assert.deepEqual(await lire(`return { liste: __liste(__mod()).ferme === true, ouverte: !!__fond() && window.__r === undefined }`), { liste: true, ouverte: true })
    await ouvrir('__mod()')
    await lire(`window.__p = __o(__mod()).querySelector('.select-panel'); µ.modal.close(); await __images()`)
    await pret(`!!window.__r && !__fond()`)
    const r = await lire(`return { relie: __p.isConnected, dessus: __p.matches(':popover-open'), menus: __menus() }`)
    assert.deepEqual(r, { relie: false, dessus: false, menus: depart }, 'la liste partie avec la modale, hors du registre')
  })

  it('Échap, liste ouverte hors de la modale (ancrée, ou dans un panneau fixe) : les écouteurs que la page pose en capture le reçoivent avant la liste, qui se ferme, rend le focus au bouton et le garde pour elle', async function () {
    for (const s of ['.s-page', '.s-panneau']) {
      await ouvrirClavier(`__q('${s}')`)
      await lire(`__recu.length = 0`)
      await page.keyboard.press('Escape')
      await lire(`await __images()`)
      const r = await lire(`return { recu: __recu.join(','), ferme: __liste(__q('${s}')).ferme === true, focus: __nom(__actif()) }`)
      assert.deepEqual(r, { recu: 'win-capture,doc-capture', ferme: true, focus: '.select-btn' }, s)
    }
  })

  it('dans la modale, un bloc ajouté au-dessus de la liste ouverte : elle suit son bouton', async function () {
    await poser()
    await ouvrirClavier('__mod()')
    const l = await lire(`return __liste(__mod())`)
    await lire(`const d = document.createElement('div'); d.className = 'ajout'; __mod().before(d); await __images()`)
    const d = await lire(`return __liste(__mod())`)
    assert.ok(contre(l) && Math.abs(d.b.t - (l.b.t + 60)) <= 1.5, `sanity : le bouton descendu de 60 px : ${JSON.stringify({ l, d })}`)
    assert.ok(d.dessus && contre(d), `la liste contre son bouton : ${JSON.stringify(d)}`)
  })

  it('le panneau fixe déplacé par l\'appli, liste ouverte : elle suit son bouton', async function () {
    await ouvrirClavier(`__q('.s-panneau')`)
    const l = await lire(`return __liste(__q('.s-panneau'))`)
    await lire(`__q('.panneau').classList.add('descendu'); await __images()`)
    const d = await lire(`return __liste(__q('.s-panneau'))`)
    assert.ok(contre(l) && Math.abs(d.b.t - (l.b.t + 60)) <= 1.5, `sanity : le bouton descendu de 60 px : ${JSON.stringify({ l, d })}`)
    assert.ok(d.dessus && contre(d), `la liste contre son bouton : ${JSON.stringify(d)}`)
  })

  it('un clic sur le bouton pendant l\'animation d\'ouverture de la modale : la liste, ouverte pendant que la boîte grandit, finit contre son bouton, sans erreur', async function () {
    const b = await lire(`window.__r = undefined; µ.modal.fire({ title: 'Choix', html: ${JSON.stringify(DANS)}, showCancelButton: true }).then((x) => { window.__r = x }); const b = await new Promise((f) => { const go = () => { const m = __mod(), o = m && __o(m), b = o && o.querySelector('.select-btn'); if (b) f(b); else requestAnimationFrame(go) }; go() }); return { ...__c(b), anim: __boite().getAnimations().length }`)
    await page.mouse.click(b.x, b.y)
    await pret(`!!__o(__mod()).querySelector('.select-panel')`)
    await page.waitForTimeout(400)
    await lire(`await __images()`)
    const l = await lire(`return __liste(__mod())`)
    assert.ok(b.anim > 0, `sanity : la boîte s'animait au clic : ${JSON.stringify(b)}`)
    assert.ok(l.dessus && contre(l), `la liste contre son bouton, l'animation finie : ${JSON.stringify(l)}`)
  })

  it('droite à gauche : la liste plus large que son bouton, dans un panneau fixe, s\'aligne sur son bord droit, comme la liste ancrée de la page', async function () {
    await lire(`document.documentElement.dir = 'rtl'; await __images()`)
    await ouvrirClavier(`__q('.s-etroit-page')`)
    const a = await lire(`return __liste(__q('.s-etroit-page'))`)
    await page.keyboard.press('Escape')
    await ouvrirClavier(`__q('.s-etroit')`)
    const p = await lire(`return __liste(__q('.s-etroit'))`)
    assert.ok(a.p.w > a.b.w + 10 && Math.abs(a.p.r - a.b.r) <= 1.5, `sanity : la liste ancrée, plus large, sur le bord droit de son bouton : ${JSON.stringify(a)}`)
    assert.ok(p.dessus && p.position === 'fixed' && p.p.w > p.b.w + 10 && Math.abs(p.p.r - p.b.r) <= 1.5, `celle du panneau fixe aussi : ${JSON.stringify(p)}`)
  })

  it('sens d\'écriture mixte : la liste d\'un panneau fixe écrit de droite à gauche, dans une page écrite de gauche à droite, s\'aligne sur le bord droit de son bouton ; écrit de gauche à droite dans une page de droite à gauche, sur son bord gauche', async function () {
    await ouvrirClavier(`__q('.s-rtl')`)
    const r = await lire(`return __liste(__q('.s-rtl'))`)
    await page.keyboard.press('Escape')
    await lire(`document.documentElement.dir = 'rtl'; await __images()`)
    await ouvrirClavier(`__q('.s-ltr')`)
    const l = await lire(`return __liste(__q('.s-ltr'))`)
    assert.ok(r.dessus && r.position === 'fixed' && !r.haut && r.p.w > r.b.w + 10 && Math.abs(r.p.r - r.b.r) <= 1.5 && Math.abs(r.p.t - (r.b.b + 4)) <= 1.5, `bloc de droite à gauche : sous son bouton, sur son bord droit : ${JSON.stringify(r)}`)
    assert.ok(l.dessus && l.position === 'fixed' && !l.haut && l.p.w > l.b.w + 10 && contre(l), `bloc de gauche à droite : sous son bouton, sur son bord gauche : ${JSON.stringify(l)}`)
  })

  it('une animation que la page pose sur la liste (`::part(panel)`), une ouverture qui grandit (`scale` de 0,8 à 1) : dans la modale, la liste finit contre son bouton ; une animation d\'opacité seule non plus ne la décale pas', async function () {
    for (const [classe, nom] of [['anime', 'grandit'], ['fondu', 'fondu']]) {
      if (classe === 'fondu') { await page.close(); await charger() }
      await poser(DANS.replace('class="s-mod"', `class="s-mod ${classe}"`))
      await ouvrirClavier('__mod()')
      const noms = await lire(`return __o(__mod()).querySelector('.select-panel').getAnimations().map((a) => a.animationName).join(' ')`)
      await page.waitForTimeout(600)
      const l = await lire(`await __images(); return __liste(__mod())`)
      assert.ok(noms.includes(nom), `sanity : l'animation ${nom} de la page tournait à l'ouverture : ${noms}`)
      assert.ok(l.dessus && contre(l), `${nom} : la liste contre son bouton, l'animation finie : ${JSON.stringify(l)}`)
    }
  })

  it('placée par le script, page au repos : une lecture de la place du bouton par image, aucune écriture ; fermée, puis détruite ouverte, plus aucune lecture', async function () {
    await ouvrirClavier(`__q('.s-panneau')`)
    await lire(`await __images()`)
    const r = await lire(`
      const o = __o(__q('.s-panneau')), b = o.querySelector('.select-btn'), p = o.querySelector('.select-panel')
      let ecrits = 0
      const garde = new MutationObserver((l) => { ecrits += l.length })
      garde.observe(p, { attributes: true, subtree: true, childList: true })
      const lus = await __compter(b, 30)
      ecrits += garde.takeRecords().length
      garde.disconnect()
      return { lus, ecrits }`)
    assert.ok(Math.abs(r.lus - 30) <= 1 && r.ecrits === 0, `30 images au repos : ${JSON.stringify(r)}`)
    await page.keyboard.press('Escape')
    const fermee = await lire(`return await __compter(__o(__q('.s-panneau')).querySelector('.select-btn'), 10)`)
    await ouvrirClavier(`__q('.s-panneau')`)
    const detruite = await lire(`const b = __o(__q('.s-panneau')).querySelector('.select-btn'); __q('.s-panneau').remove(); await __images(); return await __compter(b, 10)`)
    assert.deepEqual({ fermee, detruite }, { fermee: 0, detruite: 0 }, 'plus aucune lecture')
  })

  it('une liste détruite ouverte quitte le registre des menus ouverts', async function () {
    const depart = await lire(`return __menus()`)
    await ouvrir(`__q('.s-page')`)
    if (mode === 'dev') assert.equal(await lire(`return __menus()`), depart + 1, 'la liste ouverte inscrite au registre')
    await lire(`__q('.s-page').remove(); await __images(); await __images()`)
    assert.equal(await lire(`return __menus()`), depart, 'la liste détruite hors du registre')
  })

  it('un panneau fixe de l\'appli dont le contenu défile dans une ombre : la liste dans la couche du dessus, contre son bouton ; elle suit le défilement du panneau, et se ferme quand le panneau cache son bouton', async function () {
    await ouvrir(`__q('.s-panneau')`)
    const l = await lire(`return __liste(__q('.s-panneau'))`)
    assert.ok(l.dessus && l.position === 'fixed' && contre(l), `couche du dessus, contre son bouton : ${JSON.stringify(l)}`)
    const vu = await lire(`const p = __o(__q('.s-panneau')).querySelector('.select-panel'), k = __c(__q('.panneau')), q = __c(p), e = __o(__q('.s-panneau')).elementFromPoint(q.l + 12, (k.b + q.b) / 2); return q.b > k.b + 20 && !!e && p.contains(e)`)
    assert.equal(vu, true, 'le bas de la liste, hors du panneau, se voit')
    await lire(`__q('.defile').scrollTop = 30; await __images()`)
    const d = await lire(`return __liste(__q('.s-panneau'))`)
    assert.ok(contre(d) && Math.abs(d.b.t - (l.b.t - 30)) <= 1.5, `le panneau défilé : la liste suit son bouton : ${JSON.stringify(d)}`)
    await lire(`__q('.defile').scrollTop = 200; await __images(); await __images()`)
    assert.equal(await lire(`return __liste(__q('.s-panneau')).ferme === true`), true, 'le bouton caché par le panneau : la liste fermée')
  })

  it('une boîte déplacée par `transform` : la liste dans la couche du dessus, contre son bouton ; elle suit le défilement de la page, et se ferme quand son bouton sort de l\'écran', async function () {
    await ouvrir(`__q('.s-tourne')`)
    const l = await lire(`return __liste(__q('.s-tourne'))`)
    assert.ok(l.dessus && l.position === 'fixed' && contre(l), `couche du dessus, contre son bouton : ${JSON.stringify(l)}`)
    await lire(`window.scrollTo(0, 50); await __images()`)
    const d = await lire(`return __liste(__q('.s-tourne'))`)
    assert.ok(contre(d) && Math.abs(d.b.t - (l.b.t - 50)) <= 1.5, `la page défilée : la liste suit son bouton : ${JSON.stringify(d)}`)
    await lire(`window.scrollTo(0, 500); await __images(); await __images()`)
    assert.equal(await lire(`return __liste(__q('.s-tourne')).ferme === true`), true, 'le bouton sorti de l\'écran : la liste fermée')
  })

  it('hors de ces boîtes, rien ne change : la liste de la page ancrée par le CSS, contre son bouton ; sous un zoom de la page, la liste du panneau fixe reste contre son bouton', async function () {
    await ouvrir(`__q('.s-page')`)
    const l = await lire(`return __liste(__q('.s-page'))`)
    assert.ok(l.dessus && l.ancree && contre(l), `ancrée, contre son bouton : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    await lire(`document.documentElement.style.zoom = '1.25'; await __images()`)
    await ouvrir(`__q('.s-panneau')`)
    const z = await lire(`return __liste(__q('.s-panneau'))`)
    assert.ok(z.dessus && contre(z, 5, 2), `sous le zoom, contre son bouton (4 px × 1,25) : ${JSON.stringify(z)}`)
  })

  it('sans ancrage CSS : la liste de la page, comme celle du panneau fixe, dans la couche du dessus, placée par le script contre son bouton', async function () {
    await page.close()
    await charger(SANS_ANCRAGE)
    await ouvrir(`__q('.s-page')`)
    const l = await lire(`return __liste(__q('.s-page'))`)
    assert.ok(l.dessus && !l.ancree && l.position === 'fixed' && contre(l), `couche du dessus, placée par le script : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    await ouvrir(`__q('.s-panneau')`)
    const p = await lire(`return __liste(__q('.s-panneau'))`)
    assert.ok(p.dessus && !p.ancree && p.position === 'fixed' && contre(p), `couche du dessus, placée par le script : ${JSON.stringify(p)}`)
  })
})
