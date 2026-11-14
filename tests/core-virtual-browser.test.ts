// module cœur <@@virtual> (liste virtuelle) dans Chromium, Firefox et WebKit réels, en développement et en production : sur 100 000 lignes,
// seules les lignes visibles et une marge sont dessinées ; les hauteurs estimées sont remplacées par les vraies sans que les lignes regardées
// bougent à l'écran ; un seul arrêt de tabulation, les flèches, Début, Fin, Page suivante ; une ligne focalisée qui sort de la fenêtre garde le
// focus dans la liste et le reprend en reparaissant ; rôles et places pour les lecteurs d'écran ; `scrollToIndex` ; une liste qui change
// (insertion, retrait, tri) garde la ligne du haut à sa place ; la recherche de la page ne trouve pas une ligne non dessinée (limite écrite
// dans la doc). Rendu serveur : la première fenêtre seule est servie, et la reprise garde les lignes du serveur, sans double rendu.
// Hauteurs de 20 à 220 px pour une estimation de 40 : `scrollToIndex` demandé sur une liste cachée est tenu quand elle paraît, une liste qui
// rétrécit pendant un saut le termine sur son dernier élément, une liste vidée ou retirée de la page tient sa promesse (`null`), et le
// défilement reste corrigé après ; un geste de l'utilisateur pendant un saut (barre tirée, molette, touche de défilement) l'interrompt
// (`null`) et la liste reste où il l'a menée ; depuis la ligne du haut, Page suivante et Page précédente défilent de la hauteur de la liste ;
// la barre tirée au bout montre la dernière ligne, entière ; les hauteurs mesurées des lignes retirées de la liste sont oubliées.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

// une ligne sur sept est plus haute (64px) que l'estimation (40px)
const PAGE = `<script>
  $produits = µraw(Array.from({ length: 100000 }, (_, i) -> ({ id: i, nom: "Produit #{i}" })))
  $debut    = 0
  $fin      = 20
  neufs     = 0

  @inserer  = (k) -> $produits = µraw([...Array.from({ length: k }, -> ({ id: "n#{neufs++}", nom: "Neuf #{neufs}" })), ...$produits])
  @retirer  = (k) -> $produits = µraw($produits.slice(k))
  @inverser = -> $produits = µraw([...$produits].reverse())
</script>

<button class="avant">avant</button>
<@@virtual class="vl" items={$produits} key="id" size="40" start=!{$debut} end=!{$fin} aria-label="Produits">
  {for p in $produits.slice($debut, $fin) by id}
    <div class="ligne" :class{p.id % 7 is 0}="haute" data-id={p.id}>{p.nom}</div>
  {end}
</@@virtual>
<button class="apres">après</button>

<style>
  :host
    display: block
  .vl
    width: 300px
    height: 400px
  .ligne
    box-sizing: border-box
    height: 40px
  .haute
    height: 64px
</style>
`

// hauteurs de 20 à 220 px, une estimation de 40 ; la liste est cachée au départ
const haut = (i: number) => 20 + (i * 37) % 201
const PAGE_VAR = `<script>
  haut    = (i) -> 20 + (i * 37) % 201
  $lignes = µraw(Array.from({ length: 100000 }, (_, i) -> ({ id: i, h: haut(i) })))
  $debut  = 0
  $fin    = 20

  @garder  = (k) -> $lignes = µraw($lignes.slice(0, k))
  @remplir = (k) -> $lignes = µraw(Array.from({ length: k }, (_, i) -> ({ id: i, h: haut(i) })))
  @ecarter = (a, b) -> $lignes = µraw($lignes.filter((p) -> p.id < a or p.id > b))
</script>

<div class="boite" hidden>
  <@@virtual class="vl" items={$lignes} key="id" size="40" start=!{$debut} end=!{$fin} aria-label="Lignes">
    {for p in $lignes.slice($debut, $fin) by id}
      <div class="ligne" data-id={p.id} --h={p.h + 'px'}>{p.id}</div>
    {end}
  </@@virtual>
</div>

<style>
  :host
    display: block
  .vl
    width: 300px
    height: 400px
  .ligne
    box-sizing: border-box
    height: var(--h)
</style>
`

// la même liste estimée à 300 px la ligne : 30 millions de pixels à défiler, au-delà des 2^24 px où Chromium et WebKit rangent la position du
// défilement à 2 px près
const PAGE_GROS = PAGE_VAR.replace('size="40"', 'size="300"')

const AIDES = `
window.__vl = () => { try { return document.querySelector(window.__tag || 'mjs-vl-page')._shadow.querySelector('mjs-core-virtual') } catch { return null } }
window.__vp = () => __vl()._shadow.querySelector('.viewport')
window.__lignes = () => [...__vl().children].filter((l) => l.classList.contains('ligne'))
window.__etat = () => {
  const h = __vl(), r = h.getBoundingClientRect(), ls = __lignes()
  return { ids: ls.map((l) => l.dataset.id), tops: ls.map((l) => l.getBoundingClientRect().top - r.top), bas: ls.map((l) => l.getBoundingClientRect().bottom - r.top), scrollTop: __vp().scrollTop, scrollHeight: __vp().scrollHeight, vh: __vp().clientHeight }
}
window.__ligne = (id) => { const h = __vl(), l = __lignes().find((x) => x.dataset.id === String(id)); return l ? { haut: l.getBoundingClientRect().top - h.getBoundingClientRect().top, bas: l.getBoundingClientRect().bottom - h.getBoundingClientRect().top, place: l.getAttribute('aria-posinset'), taille: l.getAttribute('aria-setsize') } : null }
window.__images = (n) => new Promise((ok) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : ok()); f() })
window.__actif = () => { const a = document.querySelector(window.__tag || 'mjs-vl-page')._shadow.activeElement; return a ? (a.dataset?.id ?? a.className) : (document.activeElement?.tagName ?? null) }
window.__page = () => document.querySelector(window.__tag || 'mjs-vl-page')
`

const builds: Record<string, Promise<{ root: string, script: string }>> = {}
const construireUneFois = (prod: boolean) => (builds[String(prod)] ??= construire('virtual', { 'vl-page.mjs': PAGE, 'vl-var.mjs': PAGE_VAR, 'vl-gros.mjs': PAGE_GROS }, prod))

// les lignes suivent le défilement à l'image qui suit : on laisse passer quelques images (WebKit sans tête en fait attendre certaines)
const repos = async (page: any) => {
  await page.evaluate('__images(3)')
  await page.waitForTimeout(60)
  await page.evaluate('__images(2)')
}

async function ouvrir(ctx: any, built: { root: string, script: string }, prod: boolean, tag = 'mjs-vl-page'): Promise<{ page: any, erreurs: string[] }> {
  const page = await ctx.newPage()
  page.setDefaultTimeout(10000)
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e)))
  await page.addInitScript(`window.__name = function (f) { return f }; window.__tag = '${tag}';` + AIDES)
  const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
  await page.route('http://vl.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><${tag}></${tag}>${charge}</body></html>` })
    const fichier = join(built.root, normalize(chemin))
    if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://vl.test/', { waitUntil: 'load' })
  try {
    await page.waitForFunction(() => { const h = (window as any).__vl(); return !!h?._shadow?.querySelector('slot') && h.children.length > 0 }, null, { timeout: 20000 })
  } catch {
    throw new Error('la page ne démarre pas : ' + (erreurs.join(' | ') || 'aucune erreur de page'))
  }
  await repos(page)
  return { page, erreurs }
}

after(async () => { await terminateSharedWorkerPool() })

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@virtual> : 100 000 lignes (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let ctx: any = null
  let built: { root: string, script: string }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built = await construireUneFois(prod)
    browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, reducedMotion: 'reduce' })
  })

  after(async () => { await Promise.race([browser?.close(), new Promise((ok) => setTimeout(ok, 10000))]) })

  beforeEach(function () { if (!present) this.skip() })

  const essai = async (fn: (page: any) => Promise<void>) => {
    const { page, erreurs } = await ouvrir(ctx, built, prod)
    // une page figée (WebKit) ne retient pas la suite : la fermeture est bornée, l'échec du test reste lisible
    try {
      await fn(page)
    } finally {
      await Promise.race([page.close(), new Promise((ok) => setTimeout(ok, 5000))])
    }
    assert.deepEqual(erreurs, [], 'aucune erreur de page')
  }

  it('dessine les lignes visibles et une marge ; au milieu, bout à bout ; en remontant, les vraies hauteurs ne font pas sauter les lignes ; rôles et places', () => essai(async (page) => {
    let e = await page.evaluate('__etat()')
    assert.equal(e.ids[0], '0')
    assert.ok(e.ids.length >= 10 && e.ids.length <= 24, `lignes dessinées au départ : ${e.ids.length}`)
    assert.ok(e.scrollHeight > 3990000 && e.scrollHeight < 4100000, `hauteur à défiler : ${e.scrollHeight}`)
    await page.evaluate('__vp().scrollTop = 2000000')
    await repos(page)
    e = await page.evaluate('__etat()')
    const ids = e.ids.map(Number)
    assert.ok(ids.length <= 24, `lignes dessinées au milieu : ${ids.length}`)
    assert.ok(Math.abs(ids[0] - 50000) < 3000, `première ligne dessinée au milieu : ${ids[0]}`)
    for (let k = 1; k < ids.length; k++) {
      assert.equal(ids[k], ids[k - 1] + 1, `lignes qui se suivent : ${e.ids.join(',')}`)
      assert.ok(Math.abs(e.tops[k] - e.bas[k - 1]) < 0.6, `bout à bout : ${e.tops.join(',')}`)
    }
    assert.ok(e.tops[0] <= 0.5 && e.bas[e.bas.length - 1] >= e.vh - 0.5, `la zone visible est couverte : ${e.tops[0]} … ${e.bas[e.bas.length - 1]}`)
    for (let pas = 0; pas < 12; pas++) {
      const avant = await page.evaluate(`(() => { const h = __vl(), r = h.getBoundingClientRect(), l = __lignes().find((x) => x.getBoundingClientRect().top - r.top >= 150); return { id: l.dataset.id, haut: l.getBoundingClientRect().top - r.top } })()`)
      await page.evaluate('__vp().scrollTop -= 120')
      await repos(page)
      const apres = await page.evaluate(`__ligne('${avant.id}')`)
      assert.ok(apres && Math.abs(apres.haut - (avant.haut + 120)) < 1, `pas ${pas} : la ligne ${avant.id} passe de ${avant.haut} à ${apres?.haut} (attendu ${avant.haut + 120})`)
    }
    const a = await page.evaluate(`({ role: __vl().getAttribute('role'), nom: __vl().getAttribute('aria-label'), lignes: __lignes().map((l) => [l.dataset.id, l.getAttribute('role'), l.getAttribute('aria-setsize'), l.getAttribute('aria-posinset')]) })`)
    assert.equal(a.role, 'list')
    assert.equal(a.nom, 'Produits')
    for (const [id, role, taille, place] of a.lignes) assert.deepEqual([role, taille, place], ['listitem', '100000', String(Number(id) + 1)], `ligne ${id}`)
    const trouve = await page.evaluate(`typeof window.find === 'function' ? (getSelection().removeAllRanges(), window.find('Produit 77777')) : false`)
    assert.equal(trouve, false, 'une ligne non dessinée n\'est pas trouvée par la recherche de la page (limite écrite dans la doc)')
  }))

  it('clavier : un seul arrêt de tabulation, flèches, Début, Fin, Page suivante ; une ligne focalisée sortie de la fenêtre garde le focus dans la liste', () => essai(async (page) => {
    const actif = () => page.evaluate('__actif()')
    await page.evaluate(`__page()._shadow.querySelector('.avant').focus()`)
    await page.keyboard.press('Tab')
    assert.equal(await actif(), '0', 'Tab entre par la première ligne')
    for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowDown')
    await repos(page)
    assert.equal(await actif(), '3')
    await page.keyboard.press('End')
    await repos(page)
    assert.equal(await actif(), '99999', 'Fin mène à la dernière ligne, dessinée pour l\'occasion')
    const fin = await page.evaluate(`__ligne(99999).bas - __vp().clientHeight`)
    assert.ok(Math.abs(fin) < 1.5, `la dernière ligne est en bas de la liste : ${fin}`)
    await page.keyboard.press('Home')
    await repos(page)
    assert.equal(await actif(), '0')
    await page.keyboard.press('PageDown')
    await repos(page)
    const pd = Number(await actif())
    assert.ok(pd >= 8 && pd <= 10, `Page suivante avance d'une hauteur de liste : ${pd}`)
    await page.keyboard.press('Tab')
    assert.equal(await actif(), 'apres', 'Tab sort de la liste d\'un coup')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await actif(), String(pd), 'Maj+Tab revient sur la dernière ligne visitée')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await repos(page)
    const ici = await actif()
    await page.evaluate('__vp().scrollTop = 1000000')
    await repos(page)
    assert.equal(await page.evaluate(`__ligne('${ici}')`), null, 'la ligne focalisée n\'est plus dessinée')
    assert.equal(await actif(), 'vl', 'le focus est sur la liste, pas perdu sur la page')
    await page.keyboard.press('ArrowDown')
    await repos(page)
    assert.equal(await actif(), String(Number(ici) + 1), 'la flèche reprend à la ligne qui avait le focus')
    await page.evaluate('__vp().scrollTop = 1000000')
    await repos(page)
    assert.equal(await actif(), 'vl')
    await page.evaluate('__vp().scrollTop = 0')
    await repos(page)
    assert.equal(await actif(), String(Number(ici) + 1), 'revenue dans la fenêtre, la ligne reprend le focus')
  }))

  it('scrollToIndex place la ligne demandée ; une liste qui change (insertion, retrait, tri) garde la ligne du haut à sa place', () => essai(async (page) => {
    const aller = (i: number, align: string) => page.evaluate(`__vl().scrollToIndex(${i}, '${align}').then((l) => l && l.dataset.id)`)
    assert.equal(await aller(54321, 'start'), '54321')
    assert.ok(Math.abs((await page.evaluate('__ligne(54321)')).haut) < 1, 'en haut de la liste')
    assert.equal(await aller(70000, 'center'), '70000')
    const c = await page.evaluate('__ligne(70000)')
    assert.ok(Math.abs((c.haut + c.bas) / 2 - 200) < 1, `au milieu de la liste : ${c.haut} … ${c.bas}`)
    assert.equal(await aller(80000, 'end'), '80000')
    assert.ok(Math.abs((await page.evaluate('__ligne(80000)')).bas - 400) < 1, 'en bas de la liste')
    const y = await page.evaluate('__vp().scrollTop')
    assert.equal(await aller(79998, 'auto'), '79998')
    assert.equal(await page.evaluate('__vp().scrollTop'), y, 'une ligne déjà visible ne fait pas défiler')
    await aller(5000, 'start')
    await repos(page)
    await page.evaluate('__page().inserer(10)')
    await repos(page)
    let h = await page.evaluate('__ligne(5000)')
    assert.ok(h && Math.abs(h.haut) < 1, `insertion au-dessus : la ligne reste en haut (${h?.haut})`)
    assert.deepEqual([h.place, h.taille], ['5011', '100010'])
    await page.evaluate('__page().retirer(30)')
    await repos(page)
    h = await page.evaluate('__ligne(5000)')
    assert.ok(h && Math.abs(h.haut) < 1, `retrait au-dessus : la ligne reste en haut (${h?.haut})`)
    assert.deepEqual([h.place, h.taille], ['4981', '99980'])
    await page.evaluate('__page().inverser()')
    await repos(page)
    h = await page.evaluate('__ligne(5000)')
    assert.ok(h && Math.abs(h.haut) < 1, `tri : la ligne reste en haut (${h?.haut})`)
    assert.equal(h.place, '95000')
    await page.evaluate('__vp().scrollTop = 0')
    await repos(page)
    await page.evaluate('__page().inserer(1)')
    await repos(page)
    const e = await page.evaluate('__etat()')
    assert.ok(e.ids[0].startsWith('n') && e.scrollTop === 0, `tout en haut, la ligne insérée paraît en tête : ${e.ids[0]} / ${e.scrollTop}`)
  }))
})

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@virtual> : sauts, pages et bout de liste, hauteurs de 20 à 220 px (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let ctx: any = null
  let built: { root: string, script: string }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built = await construireUneFois(prod)
    browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, reducedMotion: 'reduce' })
  })

  after(async () => { await Promise.race([browser?.close(), new Promise((ok) => setTimeout(ok, 10000))]) })

  beforeEach(function () { if (!present) this.skip() })

  const essai = async (fn: (page: any) => Promise<void>, tag = 'mjs-vl-var') => {
    const { page, erreurs } = await ouvrir(ctx, built, prod, tag)
    try {
      await fn(page)
    } finally {
      await Promise.race([page.close(), new Promise((ok) => setTimeout(ok, 5000))])
    }
    assert.deepEqual(erreurs, [], 'aucune erreur de page')
  }

  const montrer = async (page: any) => {
    await page.evaluate(`__page()._shadow.querySelector('.boite').hidden = false`)
    await repos(page)
  }

  // l'état d'une promesse de `scrollToIndex` : `attente`, l'identifiant de la ligne rendue, ou `null`
  const suivre = (page: any, appel: string) => page.evaluate(`(() => { window.__p = 'attente'; (${appel}).then((l) => { window.__p = l ? l.dataset.id : 'null' }) })()`)
  const tenue = async (page: any) => {
    await page.waitForFunction(() => (window as any).__p !== 'attente', null, { timeout: 4000 }).catch(() => {})
    return page.evaluate('window.__p')
  }

  // en remontant par pas de 150 px, la ligne regardée descend d'autant : des lignes mesurées au-dessus d'elle ne la font pas sauter
  const stable = async (page: any, quoi: string) => {
    await page.evaluate('__vp().scrollTop = 3000000')
    await repos(page)
    for (let pas = 0; pas < 5; pas++) {
      const avant = await page.evaluate(`(() => { const h = __vl(), r = h.getBoundingClientRect(), l = __lignes().find((x) => x.getBoundingClientRect().top - r.top >= 150); return { id: l.dataset.id, haut: l.getBoundingClientRect().top - r.top } })()`)
      await page.evaluate('__vp().scrollTop -= 150')
      await repos(page)
      const apres = await page.evaluate(`__ligne('${avant.id}')`)
      assert.ok(apres && Math.abs(apres.haut - (avant.haut + 150)) < 1, `${quoi}, pas ${pas} : la ligne ${avant.id} passe de ${avant.haut} à ${apres?.haut} (attendu ${avant.haut + 150})`)
    }
  }

  it('scrollToIndex demandé sur une liste cachée attend qu\'elle paraisse, puis est tenu ; ensuite, le défilement reste corrigé', () => essai(async (page) => {
    await suivre(page, `__vl().scrollToIndex(500, 'start')`)
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate('window.__p'), 'attente', 'cachée, la liste attend de paraître')
    await montrer(page)
    assert.equal(await tenue(page), '500', 'montrée, la promesse est tenue avec la ligne 500')
    const l = await page.evaluate('__ligne(500)')
    assert.ok(l && Math.abs(l.haut) < 1, `la ligne 500 est en haut de la liste : ${l?.haut}`)
    await stable(page, 'après le saut tenu')
  }))

  it('une liste qui rétrécit pendant un saut le termine sur son dernier élément ; vidée, la promesse donne null ; le défilement reste corrigé', () => essai(async (page) => {
    await montrer(page)
    await suivre(page, `(() => { const p = __vl().scrollToIndex(90000, 'start'); __page().garder(10); return p })()`)
    assert.equal(await tenue(page), '9', 'le saut finit sur la dernière ligne qui reste')
    const l = await page.evaluate('__ligne(9)')
    assert.ok(l && l.haut >= -0.5 && l.bas <= 400.5, `la ligne 9 est visible, entière : ${l?.haut} … ${l?.bas}`)
    await page.evaluate('__page().remplir(100000)')
    await repos(page)
    await stable(page, 'après la liste réduite puis remplie')
    await suivre(page, `(() => { const p = __vl().scrollToIndex(50000, 'start'); __page().garder(0); return p })()`)
    assert.equal(await tenue(page), 'null', 'vidée, la promesse donne null')
  }))

  it('une liste retirée de la page pendant un saut tient sa promesse : null', () => essai(async (page) => {
    await suivre(page, `__vl().scrollToIndex(500, 'start')`)
    await page.evaluate('__page().remove()')
    assert.equal(await tenue(page), 'null')
  }))

  // place du haut de la zone visible dans la liste, comptée sur les vraies hauteurs des lignes (l'estimation du module n'y entre pas), et
  // première ligne visible ; `__avant` garde l'état du saut au moment du geste : un saut déjà tenu donne sa ligne, sinon `null`
  const VUE = `window.__A = (() => { const a = new Float64Array(100001); for (let i = 0; i < 100000; i++) a[i + 1] = a[i] + 20 + (i * 37) % 201; return a })()
window.__vue = () => { const v = __vp().getBoundingClientRect().top, l = __lignes().find((x) => x.getBoundingClientRect().bottom > v + 0.5); return l ? { id: Number(l.dataset.id), place: __A[Number(l.dataset.id)] + v - l.getBoundingClientRect().top } : null }`
  const attendue = (avant: string, ligne: string) => (avant === ligne ? ligne : 'null')

  it('la barre tirée pendant un saut l\'interrompt : la promesse donne null, la liste reste où la barre l\'a menée ; sans geste, le saut est exact', () => essai(async (page) => {
    await montrer(page)
    await page.evaluate(VUE)
    // dans la même tâche que l'appel, une image après, trois images après
    for (const [quand, geste] of [['même tâche', '__geste()'], ['une image après', 'requestAnimationFrame(__geste)'], ['trois images après', '__images(2).then(() => requestAnimationFrame(__geste))']]) {
      await page.evaluate('__vp().scrollTop = 0')
      await repos(page)
      await page.evaluate(`window.__avant = 'aucun geste'; window.__geste = () => { window.__avant = window.__p; __vp().scrollTop = 10000 }`)
      await suivre(page, `(() => { const p = __vl().scrollToIndex(60000, 'start'); ${geste}; return p })()`)
      const p = await tenue(page)
      await repos(page)
      const r = await page.evaluate('({ avant: window.__avant, vue: __vue() })')
      assert.equal(p, attendue(r.avant, '60000'), `${quand} : saut ${r.avant} au moment du geste`)
      assert.ok(r.vue && r.vue.id > 150 && r.vue.id < 350, `${quand} : la liste reste vers 10 000 px, où la barre l'a menée (première ligne visible : ${r.vue?.id})`)
    }
    // cinq images de suite, 200 px chacune, dès la deuxième image du saut : l'utilisateur garde ses 1 000 px
    await page.evaluate('__vp().scrollTop = 0')
    await repos(page)
    await page.evaluate(`window.__gestes = 0; window.__geste = () => { if (!window.__gestes) { window.__avant = window.__p; window.__depart = __vue() } __vp().scrollTop += 200; if (++window.__gestes < 5) requestAnimationFrame(__geste) }`)
    await suivre(page, `(() => { const p = __vl().scrollToIndex(20000, 'start'); requestAnimationFrame(() => requestAnimationFrame(__geste)); return p })()`)
    await page.waitForFunction(() => (window as any).__gestes === 5)
    const q = await tenue(page)
    await repos(page)
    const s = await page.evaluate('({ avant: window.__avant, depart: window.__depart, vue: __vue() })')
    assert.equal(q, attendue(s.avant, '20000'), `défilement continu : saut ${s.avant} au premier geste`)
    assert.ok(s.depart && s.vue && Math.abs(s.vue.place - s.depart.place - 1000) < 1.5, `défilement continu : l'utilisateur garde ses 1 000 px (de ${s.depart?.place} à ${s.vue?.place})`)
    // sans geste, la ligne visée est en haut, au pixel
    await suivre(page, `__vl().scrollToIndex(60000, 'start')`)
    assert.equal(await tenue(page), '60000', 'sans geste, la promesse donne la ligne')
    const l = await page.evaluate('__ligne(60000)')
    assert.ok(l && Math.abs(l.haut) < 1, `sans geste, la ligne 60000 est en haut de la liste : ${l?.haut}`)
  }))

  it('la molette ou une touche de défilement pendant un saut l\'interrompt : la promesse donne null, la liste reste où l\'utilisateur l\'a menée', () => essai(async (page) => {
    await montrer(page)
    await page.evaluate(VUE)
    await page.evaluate(`for (const t of ['wheel', 'keydown']) __vl().addEventListener(t, () => { if (window.__avant === undefined) { window.__avant = window.__p; window.__auGeste = __vue() } }, { passive: true })`)
    // cinq crans de 300 px (Firefox borne un cran à la hauteur de la zone qui défile)
    await page.mouse.move(150, 200)
    await page.evaluate('window.__avant = undefined')
    await suivre(page, `__vl().scrollToIndex(20000, 'start')`)
    for (let k = 0; k < 5; k++) await page.mouse.wheel(0, 300)
    const p = await tenue(page)
    await repos(page)
    await repos(page)
    const r = await page.evaluate('({ avant: window.__avant, geste: window.__auGeste, vue: __vue() })')
    assert.equal(p, attendue(r.avant, '20000'), `molette : saut ${r.avant} au moment du geste`)
    assert.ok(r.geste && r.vue && r.vue.place - r.geste.place > 0, `molette : la liste ne remonte pas vers la ligne visée, elle reste plus bas qu'au premier cran (de ${r.geste?.place} à ${r.vue?.place})`)
    // la touche Fin sur la zone qui défile, aucune ligne n'ayant le focus : le navigateur la mène au bout
    await page.evaluate('__vp().scrollTop = 0')
    await repos(page)
    await page.evaluate('__vp().focus(); window.__avant = undefined')
    await suivre(page, `__vl().scrollToIndex(20000, 'start')`)
    await page.keyboard.press('End')
    const q = await tenue(page)
    await repos(page)
    await repos(page)
    const s = await page.evaluate('({ avant: window.__avant, geste: window.__auGeste, vue: __vue() })')
    assert.equal(q, attendue(s.avant, '20000'), `touche Fin : saut ${s.avant} au moment du geste`)
    assert.ok(s.geste && s.vue && s.vue.place - s.geste.place > 600, `touche Fin : la liste reste où la touche l'a menée, plus bas qu'au geste (de ${s.geste?.place} à ${s.vue?.place}, ligne ${s.vue?.id})`)
  }))

  it('Page suivante et Page précédente depuis la ligne du haut : la liste défile de sa hauteur, le focus passe à la première ligne qui commence une hauteur de liste plus bas ou plus haut', () => essai(async (page) => {
    await montrer(page)
    await page.evaluate('__lignes()[0].focus()')
    const debuts = [0]
    for (let k = 0; k < 40; k++) debuts.push(debuts[k] + haut(k))
    const viser = (i: number, d: number) => { let j = 0; while (debuts[j] < debuts[i] + d) j++; return d > 0 ? Math.max(i + 1, j) : Math.min(i - 1, j) }
    let i = 0
    let y = 0
    for (const [touche, d] of [['PageDown', 400], ['PageDown', 400], ['PageUp', -400]] as const) {
      await page.keyboard.press(touche)
      await repos(page)
      const j = viser(i, d)
      y += d
      const r = await page.evaluate(`({ actif: __actif(), st: __vp().scrollTop, l: __ligne(${j}) })`)
      assert.equal(r.actif, String(j), `${touche} depuis la ligne ${i} : le focus passe à la ligne ${j} (défilement ${r.st})`)
      assert.ok(Math.abs(r.st - y) < 1, `${touche} : la liste défile de 400 px, jusqu'à ${y} (elle est à ${r.st})`)
      assert.ok(r.l && r.l.haut >= -0.5 && r.l.bas <= 400.5, `la ligne ${j} est visible, entière : ${r.l?.haut} … ${r.l?.bas}`)
      i = j
    }
  }))

  it('la barre tirée au bout montre la dernière ligne, entière, en bas de la liste', () => essai(async (page) => {
    await montrer(page)
    for (let k = 0; k < 2; k++) {
      await page.evaluate('__vp().scrollTop = 1e9')
      await repos(page)
      await repos(page)
      const e = await page.evaluate('__etat()')
      const fin = await page.evaluate('__ligne(99999)')
      assert.equal(e.ids[e.ids.length - 1], '99999', `tirage ${k} : la dernière ligne dessinée est ${e.ids[e.ids.length - 1]}`)
      assert.ok(fin && Math.abs(fin.bas - e.vh) < 1, `tirage ${k} : la dernière ligne est en bas, entière : ${fin?.haut} … ${fin?.bas} pour ${e.vh}`)
    }
  }))

  // l'écart que Chromium et WebKit laissent sur une position de 30 millions de pixels n'est pas un geste, et les positions lues n'y sont
  // justes qu'à 2 px près ; Firefox plafonne la hauteur d'un élément vers 17,9 millions de pixels (limite écrite dans la doc) : la liste
  // n'y défile plus
  it('une très grande liste (30 millions de pixels estimés) : scrollToIndex près du bout donne la ligne, en haut ; un défilement de 10 px fait par la page pendant le saut l\'interrompt encore', function () {
    if (nom === 'firefox') this.skip()
    return essai(async (page) => {
      await montrer(page)
      await suivre(page, `__vl().scrollToIndex(99995, 'start')`)
      assert.equal(await tenue(page), '99995', 'sans geste, la promesse donne la ligne')
      const l = await page.evaluate('__ligne(99995)')
      assert.ok(l && Math.abs(l.haut) <= 2, `sans geste, la ligne 99995 est en haut de la liste : ${l?.haut}`)
      await suivre(page, `(() => { const p = __vl().scrollToIndex(99990, 'start'); __vp().scrollTop -= 10; return p })()`)
      assert.equal(await tenue(page), 'null', 'un défilement de 10 px fait par la page pendant le saut l\'interrompt')
    }, 'mjs-vl-gros')
  })

  it('les hauteurs mesurées des lignes retirées de la liste sont oubliées : revenues, elles sont mesurées à nouveau', () => essai(async (page) => {
    await montrer(page)
    await page.evaluate('__vp().scrollTop = 2000000')
    await repos(page)
    const vus = await page.evaluate('__lignes().map((l) => Number(l.dataset.id))')
    assert.ok(vus.every((id: number) => id > 49000 && id < 51000), `lignes dessinées au milieu : ${vus.join(',')}`)
    await page.evaluate('__page().ecarter(49000, 51000)')
    await repos(page)
    await page.evaluate('__vp().scrollTop = 0')
    await repos(page)
    await page.evaluate('__page().remplir(100000)')
    await repos(page)
    const h1 = await page.evaluate('__vp().scrollHeight')
    await page.evaluate('__vp().scrollTop = 2000000')
    await repos(page)
    const h2 = await page.evaluate('__vp().scrollHeight')
    const revus = await page.evaluate('__lignes().map((l) => Number(l.dataset.id))')
    const oublie = revus.reduce((s: number, id: number) => s + haut(id) - 40, 0)
    assert.ok(h2 - h1 > oublie / 2, `revenues, les lignes ${revus.join(',')} sont mesurées à nouveau : la hauteur à défiler grandit de ${h2 - h1} px (environ ${oublie} attendus)`)
  }))
})

// rendu serveur (mode `markers`) puis reprise dans le navigateur
let serveur: Promise<{ html: string, hydrateScript: string, bundle: string }> | null = null
function rendreServeur() {
  serveur ??= (async () => {
    const root   = mjsTmp('virtual-ssr')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vl-page.mjs'), PAGE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const { html, hydrateScript } = await renderer.renderToString('mjs-vl-page', { ssrMode: 'markers' } as any)
    await renderer.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => `{\n${stripEsm(readFileSync(join(outDir, f), 'utf-8'))}\n}`).join('\n')
    return { html, hydrateScript, bundle: stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres }
  })()
  return serveur
}

describe('<@@virtual> : rendu serveur', function () {
  this.timeout(120000)

  it('le serveur rend la première fenêtre seule (les lignes 0 à 19), sans la liste entière, et la hauteur à défiler', async () => {
    const { html } = await rendreServeur()
    const ids = [...html.matchAll(/data-id="(\d+)"/g)].map((m) => m[1])
    assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => String(i)))
    assert.ok(html.length < 100000, `la page servie ne porte pas les 100 000 éléments : ${html.length} octets`)
  })

  for (const nom of NAVIGATEURS) it(`reprise sans double rendu : les lignes du serveur restent les mêmes nœuds (${nom} réel)`, async function () {
    if (!(await navigateurPresent(nom))) this.skip()
    const { html, hydrateScript, bundle } = await rendreServeur()
    const browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    try {
      const page = await (await browser.newContext({ viewport: { width: 800, height: 700 } })).newPage()
      const erreurs: string[] = []
      const avis: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'error') avis.push(m.text().slice(0, 400)) })
      await page.addInitScript('window.__name = function (f) { return f };' + AIDES)
      const marque = `<script>(() => { const h = document.querySelector(window.__tag || 'mjs-vl-page').shadowRoot.querySelector('mjs-core-virtual'); window.__servies = [...h.children].filter((l) => l.classList.contains('ligne')); window.__hauteurServie = h.shadowRoot.querySelector('.viewport').scrollHeight })()</script>`
      await page.route('http://vl-ssr.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0">${html}\n${hydrateScript}\n${marque}\n<script>${bundle}</script></body></html>` }))
      await page.goto('http://vl-ssr.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => { const h = (window as any).__vl(); return !!h?._shadow?.querySelector('slot') && h.hasAttribute('role') }, null, { timeout: 20000 })
      await repos(page)
      const r = await page.evaluate(`({ servies: __servies.length, hauteur: __hauteurServie, ids: __lignes().map((l) => l.dataset.id), refaites: __lignes().filter((l) => Number(l.dataset.id) < 20 && !__servies.includes(l)).map((l) => l.dataset.id) })`)
      assert.equal(r.servies, 20, 'vingt lignes servies')
      assert.ok(r.hauteur > 3990000, `la hauteur à défiler est servie avec la page : ${r.hauteur}`)
      assert.equal(new Set(r.ids).size, r.ids.length, `aucune ligne en double : ${r.ids.join(',')}`)
      assert.equal(r.ids[0], '0')
      assert.deepEqual(r.refaites, [], 'les lignes servies encore dans la fenêtre sont reprises, pas refaites / console : ' + (avis.join(' | ') || 'rien'))
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    } finally {
      await browser.close()
    }
  })
})
