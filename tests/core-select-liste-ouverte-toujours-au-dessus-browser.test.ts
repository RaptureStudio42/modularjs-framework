// la liste ouverte d'un <@@select> toujours au premier plan, dans Chromium, Firefox et WebKit réels, construction de développement et de
// production, avec et sans l'ancrage CSS (sans : le test de fonction forcé à faux avant le chargement du module, comme un navigateur qui a
// la couche du dessus mais pas l'ancrage) :
// - dans un bloc qui isole son empilement (`position: relative; isolation: isolate`) suivi d'une rangée de boutons en `position: relative`,
//   le point au centre de chaque option est bien l'option (`elementFromPoint`) : la rangée ne passe pas devant la liste ;
// - dans un conteneur qui défile de côté (`overflow-x: auto`), toutes les options se voient : le conteneur ne rogne pas la liste ;
// - la page défile, liste ouverte : la liste suit son bouton et reste devant la rangée ;
// - comme avant : la liste s'ouvre au clavier, Entrée choisit et laisse le focus au bouton, un clic dehors la ferme, la flèche se retourne
//   liste ouverte ; écrite de droite à gauche, plus large que son bouton, elle s'aligne sur son bord droit ; au bas de la fenêtre, elle
//   s'ouvre vers le haut ; celle d'une réponse libre (`other`) garde sa largeur minimale sans prendre toute la fenêtre

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, fermer, NAVIGATEURS } from './helpers/sortable-navigateur.js'

const TAG = 'mjs-dessus-page'

const option  = (t: string, i: number) => `<@@option value="${i + 1}">${t}</@@option>`
const CINQ    = ['Pomme', 'Poire', 'Prune', 'Pêche', 'Cerise'].map(option).join('')
const LONGUES = ['Abricot du Roussillon', 'Mirabelle de Lorraine', 'Reine-claude dorée'].map(option).join('')
const LISTES  = ['s-isole', 's-defile', 's-autre', 's-rtl', 's-bas']

const PAGE = `<div class="colonnes">
  <div>
    <div class="isole">
      <@@select class="s-isole" aria-label="Liste du bloc isolé">${CINQ}</@@select>
    </div>
    <div class="rangee"><button type="button" class="b">Un</button><button type="button" class="b">Deux</button></div>
  </div>
  <div>
    <div class="defile">
      <@@select class="s-defile" aria-label="Liste du conteneur qui défile">${CINQ}</@@select>
    </div>
    <@@select class="s-autre" other aria-label="Liste à réponse libre">${CINQ}</@@select>
  </div>
  <div dir="rtl">
    <@@select class="s-rtl" aria-label="Liste écrite de droite à gauche">${LONGUES}</@@select>
  </div>
</div>
<div class="bas">
  <@@select class="s-bas" aria-label="Liste du bas de la fenêtre">${CINQ}</@@select>
</div>
<div class="loin"></div>
<style>
  :host
    display: block

  .colonnes
    display: grid
    grid-template-columns: 300px 300px 300px
    gap: 40px
    padding: 80px 8px 8px

  .isole
    position: relative
    isolation: isolate

  .rangee
    display: grid
    grid-template-columns: 1fr 1fr

  .b
    position: relative
    height: 320px

  .defile
    overflow-x: auto

  .s-isole, .s-defile, .s-autre, .s-bas
    width: 200px

  .s-rtl
    width: 60px

  .bas
    position: absolute
    left: 8px
    top: 520px

  .loin
    height: 2000px
</style>
`

// les lectures de la page : la liste et son bouton ; pour chaque option, le centre tombe-t-il sur un bouton de la rangée (`__sur`), et le point
// en son centre est-il l'option, lu dans l'ombre de la page (la balise de la liste, pas un bouton devant elle) et dans celle de la liste (`__vues`)
const OUTILS = `
window.__name = function (f) { return f }
window.__o = (el) => el._shadow || el.shadowRoot
window.__p = () => __o(document.querySelector('${TAG}'))
window.__s = (c) => __o(__p().querySelector('.' + c))
window.__c = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width } }
window.__images = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))
window.__liste = (c) => { const o = __s(c), p = o.querySelector('.select-panel'), b = o.querySelector('.select-btn'); return p ? { p: __c(p), b: __c(b), dessus: p.matches(':popover-open'), ancree: p.classList.contains('anchored'), haut: p.classList.contains('up') } : { ferme: true, b: __c(b) } }
window.__sur = (c) => { const bs = [...__p().querySelectorAll('.b')].map(__c); return [...__s(c).querySelectorAll('.select-option')].map((op) => { const k = __c(op); return bs.some((b) => k.x > b.l + 1 && k.x < b.r - 1 && k.y > b.t + 1 && k.y < b.b - 1) }) }
window.__vues = (c) => { const h = __p().querySelector('.' + c), o = __o(h); return [...o.querySelectorAll('.select-option')].map((op) => { const k = __c(op), e = o.elementFromPoint(k.x, k.y); return __p().elementFromPoint(k.x, k.y) === h && !!e && op.contains(e) }) }
`

// sans ancrage : le test de fonction répond non, le moteur garde ses règles
const SANS_ANCRAGE = `(() => { const s = CSS.supports.bind(CSS); CSS.supports = function (a, b) { return /anchor|position-area|position-try/.test(String(a) + ' ' + String(b)) ? false : (arguments.length > 1 ? s(a, b) : s(a)) } })()`

// contre son bouton : 4 px dessous (dessus avec `up`), bord gauche
const contre = (l: any, tol = 1.5) => !!l.p && (l.haut ? Math.abs(l.p.b - (l.b.t - 4)) : Math.abs(l.p.t - (l.b.b + 4))) <= tol && Math.abs(l.p.l - l.b.l) <= tol

// une construction par mode, partagée par les trois moteurs
const construits = new Map<boolean, Promise<{ root: string, script: string }>>()
const construit  = (prod: boolean) => { if (!construits.has(prod)) construits.set(prod, construire('select-dessus', { 'dessus-page.mjs': PAGE }, prod)); return construits.get(prod)! }

const lire = (page: any, corps: string) => page.evaluate(`(async () => { ${corps} })()`)

async function charger(browser: any, built: { root: string, script: string }, prod: boolean, ancrage: boolean): Promise<{ ctx: any, page: any, erreurs: string[] }> {
  const ctx  = await browser.newContext({ viewport: { width: 1000, height: 600 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
  page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
  await page.addInitScript(OUTILS)
  if (!ancrage) await page.addInitScript(SANS_ANCRAGE)
  const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
  await page.route('http://dessus.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><${TAG}></${TAG}>${charge}</body></html>` })
    const fichier = join(built.root, normalize(chemin))
    if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://dessus.test/', { waitUntil: 'load' })
  await page.waitForFunction(`${JSON.stringify(LISTES)}.every((c) => document.querySelector('${TAG}')?._shadow?.querySelector('.' + c)?._shadow?.querySelector('.select-btn'))`, null, { timeout: 15000 })
  await lire(page, 'await __images()')
  return { ctx, page, erreurs }
}

// la liste ouverte par un vrai clic sur son bouton
async function ouvrir(page: any, c: string) {
  const b = await lire(page, `return __liste('${c}').b`)
  await page.mouse.click(b.x, b.y)
  await page.waitForFunction(`!!__s('${c}').querySelector('.select-panel')`)
  await lire(page, 'await __images()')
}

// refermée par un second clic sur son bouton
async function refermer(page: any, c: string) {
  const b = await lire(page, `return __liste('${c}').b`)
  await page.mouse.click(b.x, b.y)
  await page.waitForFunction(`!__s('${c}').querySelector('.select-panel')`)
}

for (const nom of NAVIGATEURS) for (const prod of [false, true]) for (const ancrage of [true, false]) describe(`<@@select> : la liste ouverte au premier plan (${nom}, ${prod ? 'production' : 'développement'}, ${ancrage ? 'avec' : 'sans'} l'ancrage CSS)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built   = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await construit(prod)
    browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  it('dans un bloc qui isole son empilement, suivi d\'une rangée de boutons : la liste passe devant la rangée, le point au centre de chaque option est l\'option', async () => {
    const { ctx, page, erreurs } = await charger(browser, built, prod, ancrage)
    await ouvrir(page, 's-isole')
    const l = await lire(page, `return __liste('s-isole')`)
    const r = await lire(page, `return __c(__p().querySelector('.rangee'))`)
    assert.ok(!!l.p && l.p.b > r.t + 40, `sanity : la liste ouverte descend sur la rangée : ${JSON.stringify({ l, r })}`)
    assert.equal(l.ancree, ancrage, `sanity : ${ancrage ? 'ancrée par le navigateur' : 'sans ancrage CSS'} : ${JSON.stringify(l)}`)
    assert.deepEqual(await lire(page, `return __sur('s-isole')`), [true, true, true, true, true], 'sanity : le centre de chaque option tombe sur un bouton de la rangée')
    assert.deepEqual(await lire(page, `return __vues('s-isole')`), [true, true, true, true, true], 'chaque option se voit sous son point, devant la rangée')
    assert.ok(l.dessus && contre(l), `dans la couche du dessus, contre son bouton : ${JSON.stringify(l)}`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('dans un conteneur qui défile de côté (`overflow-x: auto`) : toutes les options se voient, le conteneur ne rogne pas la liste', async () => {
    const { ctx, page, erreurs } = await charger(browser, built, prod, ancrage)
    await ouvrir(page, 's-defile')
    const l = await lire(page, `return __liste('s-defile')`)
    const k = await lire(page, `return __c(__p().querySelector('.defile'))`)
    assert.ok(!!l.p && l.p.b > k.b + 40, `sanity : la liste ouverte dépasse le bas du conteneur : ${JSON.stringify({ l, k })}`)
    assert.deepEqual(await lire(page, `return __vues('s-defile')`), [true, true, true, true, true], 'toutes les options se voient')
    assert.ok(l.dessus && contre(l), `dans la couche du dessus, contre son bouton : ${JSON.stringify(l)}`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('la page défile, liste ouverte : la liste suit son bouton et reste devant la rangée', async () => {
    const { ctx, page, erreurs } = await charger(browser, built, prod, ancrage)
    await ouvrir(page, 's-isole')
    const l = await lire(page, `return __liste('s-isole')`)
    await lire(page, 'window.scrollTo(0, 40); await __images()')
    const d = await lire(page, `return __liste('s-isole')`)
    assert.ok(Math.abs(d.b.t - (l.b.t - 40)) <= 1.5, `sanity : la page a défilé de 40 px : ${JSON.stringify({ l, d })}`)
    assert.deepEqual(await lire(page, `return __sur('s-isole')`), [true, true, true, true, true], 'sanity : le centre de chaque option tombe encore sur un bouton de la rangée')
    assert.ok(!d.ferme && contre(d), `la liste suit son bouton : ${JSON.stringify(d)}`)
    assert.deepEqual(await lire(page, `return __vues('s-isole')`), [true, true, true, true, true], 'la page défilée, chaque option se voit encore sous son point')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('comme avant : clavier et focus, clic dehors, flèche retournée, droite à gauche, vers le haut au bas de la fenêtre, largeur d\'une liste à réponse libre', async () => {
    const { ctx, page, erreurs } = await charger(browser, built, prod, ancrage)
    const etat = `const o = __s('s-isole'), b = o.querySelector('.select-btn'); return { ouverte: !!o.querySelector('.select-panel'), focus: o.activeElement === b, actif: o.querySelector('.select-option.active')?.textContent.trim() ?? null, choix: o.querySelector('.select-label').textContent.trim(), fleche: getComputedStyle(b, '::after').transform.startsWith('matrix(-1,') }`
    await lire(page, `__s('s-isole').querySelector('.select-btn').focus(); await __images()`)
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(`!!__s('s-isole').querySelector('.select-panel')`)
    await lire(page, 'await __images()')
    assert.deepEqual(await lire(page, etat), { ouverte: true, focus: true, actif: 'Pomme', choix: 'Choisir…', fleche: true }, 'la flèche basse ouvre la liste sur sa première option, le focus reste au bouton, la flèche se retourne')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await lire(page, 'await __images()')
    assert.deepEqual(await lire(page, etat), { ouverte: false, focus: true, actif: null, choix: 'Poire', fleche: false }, 'Entrée choisit l\'option active, ferme la liste et laisse le focus au bouton')
    await ouvrir(page, 's-isole')
    await page.mouse.click(700, 560)
    await lire(page, 'await __images()')
    assert.equal(await lire(page, `return __liste('s-isole').ferme === true`), true, 'un clic dehors ferme la liste')
    await ouvrir(page, 's-rtl')
    const r = await lire(page, `return __liste('s-rtl')`)
    // ancrée, la liste d'un bloc écrit dans l'autre sens que la page : Firefox la pose au bord gauche de la fenêtre (le navigateur la place, pas le module)
    if (ancrage === false || nom !== 'firefox') assert.ok(!r.haut && r.p.w > r.b.w + 10 && Math.abs(r.p.r - r.b.r) <= 1.5 && Math.abs(r.p.t - (r.b.b + 4)) <= 1.5, `droite à gauche : sous son bouton, sur son bord droit : ${JSON.stringify(r)}`)
    await refermer(page, 's-rtl')
    await ouvrir(page, 's-bas')
    const h = await lire(page, `return __liste('s-bas')`)
    assert.ok(h.haut && contre(h), `au bas de la fenêtre : au-dessus de son bouton : ${JSON.stringify(h)}`)
    await refermer(page, 's-bas')
    await ouvrir(page, 's-autre')
    const a = await lire(page, `return __liste('s-autre')`)
    assert.ok(contre(a), `réponse libre : contre son bouton : ${JSON.stringify(a)}`)
    // ancrée, la liste d'une réponse libre s'étire jusqu'au bord de la fenêtre (la case de `position-area` fait ses 100 %), défaut du module à part ; placée par le script, elle garde la largeur qu'elle a dans la balise
    if (!ancrage) assert.ok(a.p.w >= 255 && a.p.w < 600, `réponse libre : sa largeur minimale (16rem), pas toute la fenêtre : ${JSON.stringify(a)}`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
