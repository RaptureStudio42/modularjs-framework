// la liste de <@@select>, la bulle `@title` et le menu des formes de <@@chart> aux bords de l'ancrage CSS. Sous un ancêtre déplacé par
// une transformation (`transform`, la propriété `translate`, `scale`), ils restent contre leur élément, la liste à la largeur de son
// bouton (Firefox pose une ancre transformée comme si la transformation n'existait pas : le script les place alors) ; une transformation
// identité garde l'ancrage. L'élément caché par le conteneur qui défile ferme la liste, le menu et la bulle ancrés (Firefox et WebKit
// les laissaient flotter hors du conteneur). Un navigateur qui connaît `anchor-name` sans `position-area` (Chrome 125 à 128) prend le
// placement par le script, la liste dans la couche du dessus. Sans ancrage (le test de fonction forcé à faux), le placement par le
// script : mêmes places, la liste dans la couche du dessus, dans la fenêtre, fermée quand le conteneur qui défile cache son bouton.
// Page rendue par le serveur puis reprise. Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES   = ['natif', 'repli'] as const

const CINQ = Array.from({ length: 5 }, (_, i) => `<@@option value="${i + 1}">Choix ${i + 1}</@@option>`).join('')

// trois boîtes transformées (translate, scale, propriété translate), une transformation identité, deux conteneurs qui défilent
const HOTE = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }, { id: 'c', x: '2026-09-05', poids: 71 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>

<div class="tr"><@@select class="s-tr" aria-label="Translate">${CINQ}</@@select><button class="t-tr" type="button" :title="Bulle translate">T</button><@@chart class="c-tr" rows={$rows} series={$series} toolbar="shapes"></@@chart></div>
<div class="sc"><@@select class="s-sc" aria-label="Scale">${CINQ}</@@select><button class="t-sc" type="button" :title="Bulle scale">S</button></div>
<div class="ti"><@@select class="s-ti" aria-label="Propriété translate">${CINQ}</@@select><button class="t-ti" type="button" :title="Bulle de la propriété translate">P</button></div>
<div class="id"><@@select class="s-id" aria-label="Identité">${CINQ}</@@select></div>
<div class="dv"><div class="vide"></div><@@select class="s-dv" aria-label="Défile">${CINQ}</@@select><button class="t-dv" type="button" :title="Bulle du conteneur">D</button><div class="long"></div></div>
<div class="dg"><div class="vide"></div><@@chart class="c-dg" rows={$rows} series={$series} toolbar="shapes"></@@chart><div class="long"></div></div>

<style>
  :host
    display: block

  .tr, .sc, .ti, .id, .dv, .dg
    position: absolute

  .tr
    left: 20px
    top: 20px
    width: 600px
    height: 300px
    transform: translate(150px, 60px)

  .sc
    left: 20px
    top: 470px
    width: 300px
    height: 60px
    transform: scale(0.75)
    transform-origin: 0 0

  .ti
    left: 300px
    top: 440px
    width: 300px
    height: 60px
    translate: 100px 30px

  .id
    left: 20px
    top: 560px
    width: 300px
    height: 60px
    transform: translate(0)

  .dv
    left: 800px
    top: 300px
    width: 180px
    height: 120px
    overflow: auto

  .dg
    left: 20px
    top: 640px
    width: 560px
    height: 140px
    overflow: auto

  .vide
    height: 20px

  .long
    height: 900px

  .s-tr, .s-sc, .s-ti, .s-id, .s-dv
    width: 160px
</style>
`

type Construit = { html: string, hydrateScript: string, bundle: string, feuilles: Map<string, string> }
let construit: Promise<Construit> | null = null

// la page servie (ombres déclaratives, repères de reprise) et le script qui la reprend, une fois pour les trois moteurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('menus-natifs-bords')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'menus-bords-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendu    = await renderer.renderToString('mjs-menus-bords-ssr', { ssrMode: 'markers' } as any)
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
// Chrome 125 à 128 : `anchor-name` connu, `position-area` inconnu (son nom d'alors : `inset-area`)
const SANS_AIRE = `(() => { const s = CSS.supports.bind(CSS); CSS.supports = function (a, b) { return /position-area/.test(String(a) + ' ' + String(b)) ? false : (arguments.length > 1 ? s(a, b) : s(a)) } })()`

const OUTILS = `
window.__name = (f) => f
window.__h = () => document.querySelector('mjs-menus-bords-ssr').shadowRoot
window.__o = (sel) => window.__h().querySelector(sel).shadowRoot
window.__r = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
window.__bulle = () => [...window.__h().querySelectorAll('.mjs-title')].find((b) => b.classList.contains('mjs-title-visible')) || null
`

// contre leur élément : la liste et le menu à 4 px sous leur bouton (au-dessus avec `up`), bord gauche ; la bulle à 8 px, centrée
const contreListe = (l: any) => (l.haut ? Math.abs(l.p.b - (l.b.t - 4)) : Math.abs(l.p.t - (l.b.b + 4))) <= 1.5 && Math.abs(l.p.l - l.b.l) <= 1.5
const contreMenu  = (m: any) => (m.haut ? Math.abs(m.m.b - (m.k.t - 4)) : Math.abs(m.m.t - (m.k.b + 4))) <= 1.5 && Math.abs(m.m.l - m.k.l) <= 1.5
const contreBulle = (x: any) => (x.cote === 'bottom' ? Math.abs(x.q.t - (x.e.b + 8)) : Math.abs(x.q.b - (x.e.t - 8))) <= 1.5 && Math.abs((x.q.l + x.q.r) / 2 - (x.e.l + x.e.r) / 2) <= 1.5

// la liste entière dans la fenêtre de la page (1000 × 800)
const dansLaFenetre = (l: any) => l.p.l >= 0 && l.p.t >= 0 && l.p.r <= 1000 && l.p.b <= 800

for (const nom of MOTEURS) for (const mode of MODES) describe(`menus natifs aux bords de l'ancrage (${nom} réel, ${mode === 'natif' ? 'ancrage CSS' : 'sans ancrage'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  const natif = mode === 'natif'

  const lire     = (corps: string) => page.evaluate(`(async () => { ${corps} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 10000 })
  const images   = () => lire(`await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))`)
  // après un défilement : les observateurs ont parlé (une image), la page s'est redessinée
  const repos    = async () => { await images(); await page.waitForTimeout(120); await images() }

  // une page neuve, servie puis reprise, avec le test de fonction donné
  async function charger(fait: Construit, faux: string | null) {
    const p = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    await p.addInitScript(OUTILS)
    if (faux) await p.addInitScript(faux)
    p.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    p.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0">${fait.html}\n<div style="height:1600px"></div>\n${fait.hydrateScript}\n<script>${fait.bundle}</script></body></html>`
    await p.route('http://bords.test/**', (route: any) => {
      const f = new URL(route.request().url()).pathname.split('/').pop()!
      if (fait.feuilles.has(f)) return route.fulfill({ contentType: 'text/css', body: fait.feuilles.get(f) })
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: contenu })
    })
    await p.goto('http://bords.test/', { waitUntil: 'load' })
    await p.waitForFunction(`(() => { const h = document.querySelector('mjs-menus-bords-ssr'); return !!customElements.get('mjs-core-select') && !!customElements.get('mjs-core-chart') && !!h && !!h.shadowRoot && ['.c-tr', '.c-dg'].every((c) => !!h.shadowRoot.querySelector(c).shadowRoot.querySelector('button.pick')) })()`, null, { timeout: 10000 })
    await p.waitForTimeout(300)
    await p.evaluate(`µ.config.title = { delay: 30 }`)
    return p
  }

  // la liste ouverte par un vrai clic sur son bouton
  async function ouvrirListe(cls: string) {
    const c = await lire(`const r = __r(__o('.${cls}').querySelector('.select-btn')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.click(c.x, c.y)
    await attendre(`!!__o('.${cls}').querySelector('.select-panel')`)
    await images()
  }
  const liste = (cls: string) => lire(`const o = __o('.${cls}'), p = o.querySelector('.select-panel'), b = o.querySelector('.select-btn')
    return { p: __r(p), b: __r(b), dessus: p.matches(':popover-open'), ancree: p.classList.contains('anchored'), position: getComputedStyle(p).position, haut: p.classList.contains('up') }`)

  // le menu des formes ouvert par un vrai clic : le menu, la boîte de son bouton (`.picker`)
  async function ouvrirMenu(cls: string) {
    const c = await lire(`const r = __r(__o('.${cls}').querySelector('button.pick')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.click(c.x, c.y)
    await attendre(`(() => { const m = __o('.${cls}').querySelector('.menu'); return !!m && !m.classList.contains('wait') })()`)
    await images()
  }
  const menu = (cls: string) => lire(`const o = __o('.${cls}'), m = o.querySelector('.menu'); return { m: __r(m), k: __r(o.querySelector('.picker')), dessus: m.matches(':popover-open'), ancre: m.classList.contains('anchored'), haut: m.classList.contains('up') }`)

  // la bulle visible d'un bouton survolé, et la boîte du bouton
  async function survoler(cls: string) {
    const c = await lire(`const r = __r(__h().querySelector('.${cls}')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.move(c.x, c.y)
    await attendre(`!!__bulle()`)
    await images()
    return lire(`const b = __bulle(), e = __h().querySelector('.${cls}'); return { q: __r(b), e: __r(e), ancree: b.classList.contains('mjs-title-anchored'), cote: b.getAttribute('data-mjs-title-side') }`)
  }

  async function fermerTout() {
    await page.keyboard.press('Escape')
    await page.mouse.move(990, 790)
    await page.mouse.click(990, 790)
    await lire(`window.scrollTo(0, 0); for (const s of ['.dv', '.dg']) __h().querySelector(s).scrollTop = 0; if (document.activeElement && document.activeElement.blur) document.activeElement.blur()`)
    await attendre(`![...__h().querySelectorAll('mjs-core-select')].some((s) => s.shadowRoot.querySelector('.select-panel')) && ['.c-tr', '.c-dg'].every((c) => !__o(c).querySelector('.menu')) && !__bulle()`)
  }

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const fait = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await charger(fait, natif ? null : SANS_ANCRAGE)
  })

  afterEach(async function () {
    if (present && page) await fermerTout()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('sous un ancêtre `transform: translate()` : la liste, la bulle et le menu des formes contre leur élément', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-tr')
    const l = await liste('s-tr')
    assert.ok(contreListe(l), `liste contre son bouton : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    const t = await survoler('t-tr')
    assert.ok(contreBulle(t), `bulle contre son élément, centrée : ${JSON.stringify(t)}`)
    await page.mouse.move(990, 790)
    await ouvrirMenu('c-tr')
    const m = await menu('c-tr')
    assert.ok(contreMenu(m) && m.dessus, `menu contre son bouton, dans la couche du dessus : ${JSON.stringify(m)}`)
  })

  it('sous un ancêtre `scale(.75)` : la liste contre son bouton et à sa largeur, la bulle centrée', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-sc')
    const l = await liste('s-sc')
    assert.ok(contreListe(l) && Math.abs(l.p.w - l.b.w) <= 2, `liste contre son bouton, à sa largeur : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    const t = await survoler('t-sc')
    assert.ok(contreBulle(t), `bulle contre son élément, centrée : ${JSON.stringify(t)}`)
  })

  it('sous un ancêtre à la propriété `translate` : la liste et la bulle contre leur élément', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-ti')
    const l = await liste('s-ti')
    assert.ok(contreListe(l), `liste contre son bouton : ${JSON.stringify(l)}`)
    await page.keyboard.press('Escape')
    const t = await survoler('t-ti')
    assert.ok(contreBulle(t), `bulle contre son élément, centrée : ${JSON.stringify(t)}`)
  })

  it(natif ? 'une transformation identité (`translate(0)`) garde l\'ancrage : la liste dans la couche du dessus' : 'une transformation identité : la liste dans la couche du dessus, placée par le script, contre son bouton', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-id')
    const l = await liste('s-id')
    assert.ok(contreListe(l), `liste contre son bouton : ${JSON.stringify(l)}`)
    if (natif) assert.ok(l.dessus && l.ancree, `ancrée, dans la couche du dessus : ${JSON.stringify(l)}`)
    else assert.ok(l.dessus && !l.ancree && l.position === 'fixed' && dansLaFenetre(l), `couche du dessus, placée par le script, dans la fenêtre : ${JSON.stringify(l)}`)
  })

  it(natif ? 'le bouton caché par le conteneur qui défile : la liste ancrée se ferme' : 'le bouton caché par le conteneur qui défile : la liste placée par le script se ferme', async function () {
    if (!present) { this.skip(); return }
    await ouvrirListe('s-dv')
    await lire(`__h().querySelector('.dv').scrollTop = 140`)
    await repos()
    const r = await lire(`const o = __o('.s-dv'), p = o.querySelector('.select-panel'), b = __r(o.querySelector('.select-btn')), d = __r(__h().querySelector('.dv'))
      let vu = false
      if (p) { const q = __r(p), e = q.w ? o.elementFromPoint(q.l + 10, q.t + Math.min(q.h / 2, 30)) : null; vu = !!e && p.contains(e) }
      return { ferme: !p, vu, cache: b.b <= d.t && b.t >= 0, ouvert: o.querySelector('.select-btn').getAttribute('aria-expanded'), b, d }`)
    assert.ok(r.cache, `le bouton est caché par le conteneur, dans la fenêtre : ${JSON.stringify(r)}`)
    assert.ok(!r.vu, `aucun panneau visible hors du conteneur : ${JSON.stringify(r)}`)
    assert.ok(r.ferme && r.ouvert === 'false', `la liste est fermée : ${JSON.stringify(r)}`)
  })

  if (natif) it('le bouton caché par le conteneur qui défile : le menu des formes ancré se ferme, le focus revient au bouton sans rien faire défiler', async function () {
    if (!present) { this.skip(); return }
    await ouvrirMenu('c-dg')
    const m = await menu('c-dg')
    assert.ok(contreMenu(m) && m.dessus && m.ancre, `menu ancré contre son bouton : ${JSON.stringify(m)}`)
    await lire(`__h().querySelector('.dg').scrollTop = 60`)
    await repos()
    const r = await lire(`const o = __o('.c-dg'), k = __r(o.querySelector('.picker')), d = __r(__h().querySelector('.dg')); return { ferme: !o.querySelector('.menu'), cache: k.b <= d.t && k.t >= 0, focus: o.activeElement === o.querySelector('button.pick'), defile: __h().querySelector('.dg').scrollTop, k, d }`)
    assert.ok(r.cache, `le bouton est caché par le conteneur, dans la fenêtre : ${JSON.stringify(r)}`)
    assert.ok(r.ferme && r.focus && r.defile === 60, `le menu est fermé, le focus sur le bouton, le conteneur à sa place : ${JSON.stringify(r)}`)
  })

  if (natif) it('l\'élément caché par le conteneur qui défile : la bulle ancrée se ferme', async function () {
    if (!present) { this.skip(); return }
    await lire(`__h().querySelector('.t-dv').focus()`)
    await attendre(`!!__bulle()`)
    await images()
    assert.ok(await lire(`return __bulle().classList.contains('mjs-title-anchored')`), 'la bulle est ancrée')
    await lire(`__h().querySelector('.dv').scrollTop = 140`)
    await repos()
    const r = await lire(`const e = __r(__h().querySelector('.t-dv')), d = __r(__h().querySelector('.dv')); return { ferme: !__bulle(), cache: e.b <= d.t && e.t >= 0, e, d }`)
    assert.ok(r.cache, `l'élément est caché par le conteneur, dans la fenêtre : ${JSON.stringify(r)}`)
    assert.ok(r.ferme, `la bulle est fermée : ${JSON.stringify(r)}`)
  })

  if (natif) it('un navigateur qui connaît `anchor-name` sans `position-area` (Chrome 125 à 128) : la liste, la bulle et le menu placés par le script', async function () {
    if (!present) { this.skip(); return }
    const premiere = page
    page = await charger(await construire(), SANS_AIRE)
    try {
      await ouvrirListe('s-dv')
      const l = await liste('s-dv')
      assert.ok(contreListe(l) && !l.ancree && l.dessus && l.position === 'fixed' && dansLaFenetre(l), `liste dans la couche du dessus, placée par le script, contre son bouton, dans la fenêtre : ${JSON.stringify(l)}`)
      await page.keyboard.press('Escape')
      const t = await survoler('t-dv')
      assert.ok(contreBulle(t) && !t.ancree, `bulle placée par le script, contre son élément : ${JSON.stringify(t)}`)
      await page.mouse.move(990, 790)
      await ouvrirMenu('c-dg')
      const m = await menu('c-dg')
      assert.ok(contreMenu(m) && !m.ancre && m.dessus, `menu placé par le script, dans la couche du dessus : ${JSON.stringify(m)}`)
    }
    finally {
      await page.close()
      page = premiere
    }
  })

  it('aucune erreur dans la page', function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [])
  })
})
