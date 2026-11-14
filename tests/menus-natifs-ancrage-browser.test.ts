// la bulle `@title`, le menu des formes de <@@chart> et la liste de <@@select> se placent par l'ancrage CSS dans la couche du dessus
// (popover) : la liste n'est plus rognée par un ancêtre qui coupe (`overflow: hidden`, une fenêtre qui défile) ; les trois restent
// contre leur élément après le défilement d'un conteneur et de la page, contre un bord (retournés), sous un zoom de la page, dans une
// ombre ; Échap, Tab, le retour du focus, le clic ailleurs et les attributs des lecteurs d'écran ne changent pas. Sans ancrage (le test
// de fonction forcé à faux), le placement par le script d'avant : mêmes places, la liste dans le flux de sa balise, sauf dans la fenêtre
// modale fixe, où le script la place dans la couche du dessus.
// Page rendue par le serveur puis reprise (les boutons servis sont ceux qu'on clique). Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES   = ['natif', 'repli'] as const

const TRENTE = Array.from({ length: 30 }, (_, i) => `<@@option value="${i + 1}">Choix ${i + 1}</@@option>`).join('')
const CINQ   = Array.from({ length: 5 }, (_, i) => `<@@option value="${i + 1}">Choix ${i + 1}</@@option>`).join('')

// une carte qui coupe, deux conteneurs qui défilent, une fenêtre modale (fixe, au-dessus de tout, qui coupe), une liste en bas de la fenêtre
const HOTE = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }, { id: 'c', x: '2026-09-05', poids: 71 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>

<div class="coupe"><@@select class="s-coupe" aria-label="Coupée">${TRENTE}</@@select></div>
<div class="defile"><div class="vide"></div><@@select class="s-defile" aria-label="Défile">${CINQ}</@@select><button class="t-defile" type="button" :title="Bulle du conteneur">T</button><div class="long"></div></div>
<button class="t-haut" type="button" :title="Trop près du haut, en dessous">H</button>
<button class="t-milieu" type="button" :title="Au milieu, au-dessus">M</button>
<div class="defile-graphique"><div class="vide"></div><@@chart class="c" rows={$rows} series={$series} toolbar="shapes"></@@chart><div class="long"></div></div>
<div class="modale"><div class="vide"></div><@@select class="s-modale" aria-label="Modale">${TRENTE}</@@select><button class="t-modale" type="button" :title="Bulle sur la modale">X</button></div>
<div class="bas"><@@select class="s-bas" aria-label="Bas">${CINQ}</@@select></div>
<div class="fin"></div>

<style>
  :host
    display: block

  .coupe, .defile, .defile-graphique, .bas, .fin, .t-haut, .t-milieu
    position: absolute

  .coupe
    left: 40px
    top: 60px
    width: 220px
    height: 50px
    overflow: hidden

  .defile
    left: 320px
    top: 60px
    width: 300px
    height: 200px
    overflow: auto

  .vide
    height: 60px

  .long
    height: 900px

  .t-haut
    left: 700px
    top: 4px

  .t-milieu
    left: 700px
    top: 300px

  .defile-graphique
    left: 40px
    top: 290px
    width: 560px
    height: 300px
    overflow: auto

  .modale
    position: fixed
    left: 640px
    top: 420px
    width: 320px
    height: 200px
    z-index: 100000
    overflow: auto
    background: #fff
    border: 1px solid #999

  .bas
    left: 40px
    top: 740px

  .fin
    top: 2400px
    height: 1px

  .s-coupe, .s-defile, .s-modale, .s-bas
    width: 160px
</style>
`

type Construit = { html: string, hydrateScript: string, bundle: string, feuilles: Map<string, string> }
let construit: Promise<Construit> | null = null

// la page servie (ombres déclaratives, repères de reprise) et le script qui la reprend, une fois pour les trois moteurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('menus-natifs-ancrage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'menus-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendu    = await renderer.renderToString('mjs-menus-ssr', { ssrMode: 'markers' } as any)
    await renderer.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const feuilles = new Map(readdirSync(outDir).filter((f) => f.endsWith('.css')).map((f) => [f, readFileSync(join(outDir, f), 'utf-8')] as [string, string]))
    return { feuilles, html: rendu.html, hydrateScript: rendu.hydrateScript, bundle: stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres + '\n' + libellesDuManifeste(join(outDir, 'bundle.js')) }
  })()
  return construit
}

// sans ancrage : le test de fonction répond non, le moteur garde ses règles
const SANS_ANCRAGE = `(() => { const s = CSS.supports.bind(CSS); CSS.supports = function (a, b) { return /anchor|position-area|position-try/.test(String(a) + ' ' + String(b)) ? false : (arguments.length > 1 ? s(a, b) : s(a)) } })()`

const OUTILS = `
window.__name = (f) => f
window.__h = () => document.querySelector('mjs-menus-ssr').shadowRoot
window.__o = (sel) => window.__h().querySelector(sel).shadowRoot
window.__r = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
window.__aire = (el) => getComputedStyle(el).getPropertyValue('position-area') || 'none'
window.__bulle = () => [...window.__h().querySelectorAll('.mjs-title')].find((b) => b.classList.contains('mjs-title-visible')) || null
`

for (const nom of MOTEURS) for (const mode of MODES) describe(`menus natifs : bulle, menu des formes, liste (${nom} réel, ${mode === 'natif' ? 'ancrage CSS' : 'sans ancrage'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  const natif = mode === 'natif'

  const lire     = (corps: string) => page.evaluate(`(async () => { ${corps} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 10000 })
  const images   = () => lire(`await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))`)

  // la liste ouverte par un vrai clic sur son bouton : le panneau, le bouton, le cadre qui la contient (s'il y en a un)
  async function ouvrirListe(cls: string) {
    const c = await lire(`const r = __r(__o('.${cls}').querySelector('.select-btn')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.click(c.x, c.y)
    await attendre(`!!__o('.${cls}').querySelector('.select-panel')`)
    await images()
  }
  const liste = (cls: string) => lire(`const o = __o('.${cls}'), p = o.querySelector('.select-panel'), b = o.querySelector('.select-btn')
    return { p: __r(p), b: __r(b), dessus: p.matches(':popover-open'), aire: __aire(p), position: getComputedStyle(p).position, haut: p.classList.contains('up') }`)
  // un point du panneau hors de son cadre, et l'élément qui s'y montre : le panneau, ou ce qui le cache
  const visibleHors = (cls: string, cadre: string) => lire(`const o = __o('.${cls}'), p = o.querySelector('.select-panel'), q = __r(p), k = __r(__h().querySelector('${cadre}'))
    const y = q.t < k.t ? q.t + 6 : q.b - 6
    const vu = o.elementFromPoint(q.l + 12, y)
    return { dehors: y < k.t || y > k.b, vu: !!vu && p.contains(vu), q, k }`)
  async function fermerTout() {
    await page.keyboard.press('Escape')
    await page.mouse.move(990, 790)
    await page.mouse.click(990, 790)
    await lire(`document.documentElement.style.zoom = ''; window.scrollTo(0, 0); for (const s of ['.defile', '.defile-graphique']) __h().querySelector(s).scrollTop = 0; if (document.activeElement && document.activeElement.blur) document.activeElement.blur()`)
    await attendre(`![...__h().querySelectorAll('mjs-core-select')].some((s) => s.shadowRoot.querySelector('.select-panel')) && !__o('.c').querySelector('.menu') && !__bulle()`)
  }

  // le menu des formes ouvert par un vrai clic : le menu, la boîte de son bouton (`.picker`) et le bouton
  async function ouvrirMenu() {
    const c = await lire(`const r = __r(__o('.c').querySelector('button.pick')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.click(c.x, c.y)
    await attendre(`(() => { const m = __o('.c').querySelector('.menu'); return !!m && !m.classList.contains('wait') })()`)
    await images()
  }
  const menu = () => lire(`const o = __o('.c'), m = o.querySelector('.menu'); return { m: __r(m), k: __r(o.querySelector('.picker')), dessus: m.matches(':popover-open'), aire: __aire(m), haut: m.classList.contains('up') }`)

  // la bulle visible d'un bouton survolé, et la boîte du bouton
  async function survoler(cls: string) {
    const c = await lire(`const r = __r(__h().querySelector('.${cls}')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.move(c.x, c.y)
    await attendre(`!!__bulle()`)
    await images()
    return lire(`const b = __bulle(), e = __h().querySelector('.${cls}'); return { q: __r(b), e: __r(e), dessus: b.matches(':popover-open'), aire: __aire(b), cote: b.getAttribute('data-mjs-title-side'), role: b.getAttribute('role'), id: b.id, decrit: e.getAttribute('aria-describedby') }`)
  }
  const centree = (m: any) => Math.abs((m.q.l + m.q.r) / 2 - (m.e.l + m.e.r) / 2) <= 1.5

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const fait = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    await page.addInitScript(OUTILS)
    if (!natif) await page.addInitScript(SANS_ANCRAGE)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    // avant tout script : les boutons servis, pour vérifier que la reprise les garde
    const avant = `<script>(() => { const h = document.querySelector('mjs-menus-ssr').shadowRoot; window.__avant = { liste: h.querySelector('.s-coupe').shadowRoot.querySelector('.select-btn'), pick: h.querySelector('.c').shadowRoot.querySelector('button.pick'), bulle: h.querySelector('.t-milieu') } })()</script>`
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0">${fait.html}\n<div style="height:2600px"></div>\n${avant}\n${fait.hydrateScript}\n<script>${fait.bundle}</script></body></html>`
    // la page, et la feuille du thème qu'elle cite
    await page.route('http://menus.test/**', (route: any) => {
      const f = new URL(route.request().url()).pathname.split('/').pop()!
      if (fait.feuilles.has(f)) return route.fulfill({ contentType: 'text/css', body: fait.feuilles.get(f) })
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: contenu })
    })
    await page.goto('http://menus.test/', { waitUntil: 'load' })
    await attendre(`(() => { const h = document.querySelector('mjs-menus-ssr'); return !!customElements.get('mjs-core-select') && !!customElements.get('mjs-core-chart') && !!h && !!h.shadowRoot && !!h.shadowRoot.querySelector('.c').shadowRoot.querySelector('button.pick') })()`)
    await page.waitForTimeout(300)
    await lire(`µ.config.title = { delay: 30 }`)
  })

  afterEach(async function () {
    if (present && page) await fermerTout()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('page servie puis reprise : la liste et la bulle gardent les boutons servis, le menu des formes a le sien', async function () {
    if (!present) { this.skip(); return }
    const garde = await lire(`const h = __h(); return { liste: __avant.liste === __o('.s-coupe').querySelector('.select-btn'), pick: !!__avant.pick && !!__o('.c').querySelector('button.pick'), bulle: __avant.bulle === h.querySelector('.t-milieu') }`)
    assert.deepEqual(garde, { liste: true, pick: true, bulle: true })
  })

  it(natif ? 'la liste dans une carte qui coupe : couche du dessus, ancrée, rien de rogné' : 'la liste dans une carte qui coupe : dans le flux de sa balise, contre son bouton', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-coupe')
    const l = await liste('s-coupe')
    assert.ok(Math.abs(l.p.t - (l.b.b + 4)) <= 1.5 && Math.abs(l.p.l - l.b.l) <= 1.5, `4 px sous son bouton, bord gauche : ${JSON.stringify(l)}`)
    if (natif) {
      assert.ok(l.dessus && l.aire !== 'none', `couche du dessus, placée par l'ancrage : ${JSON.stringify(l)}`)
      const v = await visibleHors('s-coupe', '.coupe')
      assert.ok(v.dehors && v.vu, `le bas du panneau, hors de la carte, se voit : ${JSON.stringify(v)}`)
    }
    else assert.ok(!l.dessus && l.aire === 'none' && l.position === 'absolute', `le placement d'avant : ${JSON.stringify(l)}`)
  })

  // WebKit décale une ancre posée dans une boîte fixe de la longueur du défilement de la page : la liste et la bulle y sont placées par le script, dans la couche du dessus
  it('dans une fenêtre modale fixe, la page défilée : la liste et la bulle, dans la couche du dessus, placées par le script, s\'ouvrent contre leur bouton', async function () {
    if (!present) { this.skip(); return }
    await lire(`window.scrollTo(0, 120)`)
    await images()
    await ouvrirListe('s-modale')
    const l = await liste('s-modale')
    const contre = l.haut ? Math.abs(l.p.b - (l.b.t - 4)) <= 1.5 : Math.abs(l.p.t - (l.b.b + 4)) <= 1.5
    assert.ok(contre && Math.abs(l.p.l - l.b.l) <= 1.5 && l.dessus && l.aire === 'none' && l.position === 'fixed', `contre son bouton, dans la couche du dessus, placée par le script : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    const x = await survoler('t-modale')
    assert.ok(x.dessus && x.aire === 'none' && x.cote === 'top' && Math.abs(x.q.b - (x.e.t - 8)) <= 1.5 && centree(x), `au-dessus de tout, contre son bouton : ${JSON.stringify(x)}`)
  })

  it('la liste suit son bouton au défilement du conteneur puis de la page ; en bas de la fenêtre, elle s\'ouvre au-dessus', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-defile')
    await lire(`__h().querySelector('.defile').scrollTop = 30`)
    await images()
    await lire(`window.scrollBy(0, 40)`)
    await images()
    const l = await liste('s-defile')
    assert.ok(Math.abs(l.p.t - (l.b.b + 4)) <= 1.5 && Math.abs(l.p.l - l.b.l) <= 1.5, `contre son bouton après les deux défilements : ${JSON.stringify(l)}`)
    await fermerTout()
    await ouvrirListe('s-bas')
    const b = await liste('s-bas')
    assert.ok(b.haut && Math.abs(b.p.b - (b.b.t - 4)) <= 1.5 && Math.abs(b.p.l - b.b.l) <= 1.5, `au-dessus de son bouton : ${JSON.stringify(b)}`)
  })

  it('sous un zoom de la page : la liste, le menu et la bulle restent contre leur élément', async function () {
    if (!present) { this.skip(); return }
    await lire(`document.documentElement.style.zoom = '1.25'`)
    await images()
    await ouvrirListe('s-coupe')
    const l = await liste('s-coupe')
    assert.ok(Math.abs(l.p.t - (l.b.b + 5)) <= 2 && Math.abs(l.p.l - l.b.l) <= 2, `liste contre son bouton (4 px × 1,25) : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    await ouvrirMenu()
    const m = await menu()
    assert.ok((m.haut ? Math.abs(m.m.b - (m.k.t - 5)) <= 2 : Math.abs(m.m.t - (m.k.b + 5)) <= 2) && Math.abs(m.m.l - m.k.l) <= 2, `menu contre son bouton : ${JSON.stringify(m)}`)
    await page.keyboard.press('Escape')
    const t = await survoler('t-milieu')
    assert.ok(t.cote === 'top' && Math.abs(t.q.b - (t.e.t - 10)) <= 2 && centree(t), `bulle 8 px × 1,25 au-dessus, centrée : ${JSON.stringify(t)}`)
  })

  it('liste au clavier et à la souris : Échap rend le focus au bouton, Tab ferme, un clic ailleurs ferme ; rôles et attributs', async function () {
    if (!present) { this.skip(); return }
    const o = `__o('.s-defile')`
    await lire(`${o}.querySelector('.select-btn').focus()`)
    await page.keyboard.press('ArrowDown')
    await attendre(`!!${o}.querySelector('.select-panel')`)
    const aria = await lire(`const o = ${o}, b = o.querySelector('.select-btn'), c = o.getElementById(b.getAttribute('aria-controls')); return { role: b.getAttribute('role'), ouvert: b.getAttribute('aria-expanded'), liste: !!c && c.getAttribute('role'), dans: !!c && o.querySelector('.select-panel').contains(c) }`)
    assert.deepEqual(aria, { role: 'combobox', ouvert: 'true', liste: 'listbox', dans: true })
    await page.keyboard.press('Escape')
    await attendre(`!${o}.querySelector('.select-panel')`)
    assert.deepEqual(await lire(`const o = ${o}; return { focus: o.activeElement === o.querySelector('.select-btn'), ouvert: o.querySelector('.select-btn').getAttribute('aria-expanded') }`), { focus: true, ouvert: 'false' })
    await page.keyboard.press('ArrowDown')
    await attendre(`!!${o}.querySelector('.select-panel')`)
    await page.keyboard.press('Tab')
    await attendre(`!${o}.querySelector('.select-panel')`)
    await ouvrirListe('s-defile')
    await page.mouse.click(990, 790)
    await attendre(`!${o}.querySelector('.select-panel')`)
  })

  it('le menu des formes suit son bouton au défilement du conteneur puis de la page ; en bas de la fenêtre, il s\'ouvre au-dessus', async function () {
    if (!present) { this.skip(); return }
    await ouvrirMenu()
    const m0 = await menu()
    assert.ok(Math.abs(m0.m.t - (m0.k.b + 4)) <= 1.5 && Math.abs(m0.m.l - m0.k.l) <= 1.5, `sous son bouton : ${JSON.stringify(m0)}`)
    assert.ok(m0.dessus && (natif ? m0.aire !== 'none' : m0.aire === 'none'), `couche du dessus, ${natif ? 'placé par l\'ancrage' : 'placé par le script'} : ${JSON.stringify(m0)}`)
    await lire(`__h().querySelector('.defile-graphique').scrollTop = 20`)
    await images()
    // le défilement d'un conteneur de l'ombre ne remonte pas jusqu'à la fenêtre : seul l'ancrage le suit
    if (natif) {
      const c = await menu()
      assert.ok(Math.abs(c.m.t - (c.k.b + 4)) <= 1.5 && Math.abs(c.m.l - c.k.l) <= 1.5, `contre son bouton après le défilement du conteneur : ${JSON.stringify(c)}`)
    }
    await lire(`window.scrollBy(0, 30)`)
    await images()
    const m = await menu()
    assert.ok(Math.abs(m.m.t - (m.k.b + 4)) <= 1.5 && Math.abs(m.m.l - m.k.l) <= 1.5, `contre son bouton après les deux défilements : ${JSON.stringify(m)}`)
    await fermerTout()
    await page.setViewportSize({ width: 1000, height: 420 })
    try {
      await ouvrirMenu()
      const h = await menu()
      assert.ok(h.haut && Math.abs(h.m.b - (h.k.t - 4)) <= 1.5, `au-dessus de son bouton : ${JSON.stringify(h)}`)
    }
    finally {
      await page.setViewportSize({ width: 1000, height: 800 })
    }
  })

  it('menu des formes au clavier et à la souris : Échap rend le focus au bouton, Tab ferme, un clic ailleurs ferme ; rôles et attributs', async function () {
    if (!present) { this.skip(); return }
    const o = `__o('.c')`
    await lire(`${o}.querySelector('button.pick').focus()`)
    await page.keyboard.press('Enter')
    await attendre(`!!${o}.querySelector('.menu')`)
    const aria = await lire(`const o = ${o}, b = o.querySelector('button.pick'), m = o.querySelector('.menu'); return { popup: b.getAttribute('aria-haspopup'), ouvert: b.getAttribute('aria-expanded'), role: m.getAttribute('role'), items: [...m.querySelectorAll('[role="menuitemradio"]')].length > 3, focus: m.contains(o.activeElement) }`)
    assert.deepEqual(aria, { popup: 'menu', ouvert: 'true', role: 'menu', items: true, focus: true })
    await page.keyboard.press('Escape')
    await attendre(`!${o}.querySelector('.menu')`)
    assert.deepEqual(await lire(`const o = ${o}; return { focus: o.activeElement === o.querySelector('button.pick'), ouvert: o.querySelector('button.pick').getAttribute('aria-expanded') }`), { focus: true, ouvert: 'false' })
    await page.keyboard.press('Enter')
    await attendre(`!!${o}.querySelector('.menu')`)
    await page.keyboard.press('Tab')
    await attendre(`!${o}.querySelector('.menu')`)
    await ouvrirMenu()
    await page.mouse.click(990, 790)
    await attendre(`!${o}.querySelector('.menu')`)
  })

  it('la bulle : au-dessus et centrée, en dessous près du haut, au-dessus de la modale ; rôle, aria-describedby, Échap', async function () {
    if (!present) { this.skip(); return }
    const m = await survoler('t-milieu')
    assert.ok(m.cote === 'top' && Math.abs(m.q.b - (m.e.t - 8)) <= 1.5 && centree(m), `8 px au-dessus, centrée : ${JSON.stringify(m)}`)
    assert.ok(m.dessus && (natif ? m.aire !== 'none' : m.aire === 'none'), `couche du dessus, ${natif ? 'placée par l\'ancrage' : 'placée par le script'} : ${JSON.stringify(m)}`)
    assert.ok(m.role === 'tooltip' && String(m.decrit).split(' ').includes(m.id), `rôle et description : ${JSON.stringify(m)}`)
    const h = await survoler('t-haut')
    assert.ok(h.cote === 'bottom' && Math.abs(h.q.t - (h.e.b + 8)) <= 1.5 && centree(h), `8 px en dessous, centrée : ${JSON.stringify(h)}`)
    const x = await survoler('t-modale')
    assert.ok(x.dessus && x.cote === 'top' && Math.abs(x.q.b - (x.e.t - 8)) <= 1.5, `au-dessus de la modale, contre son bouton : ${JSON.stringify(x)}`)
    await page.mouse.move(990, 790)
    await lire(`__h().querySelector('.t-milieu').focus()`)
    await attendre(`!!__bulle()`)
    await page.keyboard.press('Escape')
    await attendre(`!__bulle()`)
    assert.ok(await lire(`return __h().querySelector('.t-milieu').getAttribute('aria-describedby') === null`), 'la description part avec la bulle')
  })

  it(natif ? 'la bulle suit son élément au défilement d\'un conteneur, se ferme au défilement de la page ; rouverte, elle est contre lui' : 'la bulle se ferme au défilement de la page ; rouverte, elle est contre son élément', async function () {
    if (!present) { this.skip(); return }
    // ouverte au focus (un pointeur immobile sort de l'élément qui défile, et la bulle se ferme alors comme à toute sortie)
    await lire(`__h().querySelector('.t-defile').focus()`)
    await attendre(`!!__bulle()`)
    await lire(`__h().querySelector('.defile').scrollTop = 25`)
    await images()
    // le défilement d'un conteneur de l'ombre ne remonte pas jusqu'à la fenêtre : la bulle reste ouverte, seul l'ancrage la garde contre son élément
    if (natif) {
      const c = await lire(`const b = __bulle(), e = __h().querySelector('.t-defile'); return b && { q: __r(b), e: __r(e) }`)
      assert.ok(c && Math.abs(c.q.b - (c.e.t - 8)) <= 1.5 && Math.abs((c.q.l + c.q.r) / 2 - (c.e.l + c.e.r) / 2) <= 1.5, `ouverte, contre son élément : ${JSON.stringify(c)}`)
    }
    await lire(`__h().querySelector('.t-defile').blur()`)
    await attendre(`!__bulle()`)
    const a = await survoler('t-defile')
    assert.ok(Math.abs(a.q.b - (a.e.t - 8)) <= 1.5 && centree(a), `rouverte après le défilement du conteneur, contre son élément : ${JSON.stringify(a)}`)
    await lire(`window.scrollBy(0, 30)`)
    await attendre(`!__bulle()`)
    await page.mouse.move(990, 790)
    const b = await survoler('t-defile')
    assert.ok(Math.abs(b.q.b - (b.e.t - 8)) <= 1.5 && centree(b), `rouverte après le défilement de la page, contre son élément : ${JSON.stringify(b)}`)
  })

  it('aucune erreur dans la page', function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [])
  })
})
