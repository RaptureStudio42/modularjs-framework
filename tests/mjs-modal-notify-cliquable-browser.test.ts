// µ.modal.notify(message, { href, onClick }) dans Chromium, Firefox et WebKit réels : ce que happy-dom ne sait pas montrer.
// - le clavier : Tab donne le focus au toast (anneau visible), Entrée suit le lien, Entrée ET Espace déclenchent le bouton ;
// - les états au survol, à l'appui et au focus visible, réglables par les variables de thème ;
// - la zone cliquable : tout le toast, barre de vie comprise, sauf la croix qui reste à part et ferme seule ;
// - la mise en page : un toast cliquable occupe exactement la place d'un toast ordinaire ;
// - la navigation réelle : le lien est suivi bien que le toast soit retiré dans le même clic ;
// - une feuille d'appli à règles de balise (`button`, `a` et leurs états) ne masque pas le message ni ne défait la couverture ;
// - le double clic : le toast qui prend la place de celui qu'un clic vient de fermer ignore le second clic, pas le clavier.
// Le runtime est chargé tel quel dans la page (init, cache de pages, modale), comme le font les tests voisins.
// La page est servie sous une adresse http factice (aucun réseau) : un lien de chemin y navigue pour de vrai.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const lire   = (f: string) => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const SCRIPT = `${stripEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\nglobalThis.µ = µ;`

const ORIGINE = 'http://mjs.test'
const PAGE    = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>page</title></head><body></body></html>'

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`µ.modal.notify cliquable — clavier, états, zone et mise en page (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  // exécute du code dans la page puis attend la fin de l'animation d'entrée des toasts (la barre de vie, elle, dure des secondes)
  const poser = (code: string): Promise<any> => page.evaluate(`(async () => {
    ${code}
    await Promise.all(document.getAnimations().filter((a) => a.animationName === 'mjs-toast-entree').map((a) => a.finished.catch(() => 0)))
  })()`)

  // famille d'états lus sur l'élément d'action (couverture)
  const etat = (): Promise<any> => page.evaluate(`(() => {
    const a = document.querySelector('.mjs-toast-action')
    const cs = getComputedStyle(a)
    return { fond: cs.backgroundColor, curseur: cs.cursor, contour: cs.outlineStyle, epaisseur: cs.outlineWidth, couleur: cs.outlineColor }
  })()`)

  const focus = (): Promise<any> => page.evaluate(`(() => {
    const a = document.activeElement
    return { tag: a.tagName, classe: a.className, visible: a.matches(':focus-visible') }
  })()`)

  const nombre = (): Promise<number> => page.evaluate(`document.querySelectorAll('.mjs-toast').length`)
  const hash   = (): Promise<string> => page.evaluate(`location.hash`)
  const alpha  = (couleur: string): number => {
    // 'rgba(0, 0, 0, 0)' · 'rgb(1, 2, 3)' · 'color(srgb 1 1 1 / 0.1)' · 'transparent'
    if (couleur === 'transparent') return 0
    const m = couleur.match(/\/\s*([\d.]+)\s*\)/) || couleur.match(/^rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\)/)
    return m ? Number(m[1]) : 1
  }
  const proche = (a: number, b: number, msg: string, ecart = 1) => assert.ok(Math.abs(a - b) <= ecart, `${msg} : ${a} contre ${b}`)

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route(`${ORIGINE}/**`, (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }))
  })

  after(async () => {
    if (browser) await browser.close()
  })

  // page neuve : aucun toast, aucun focus, aucune adresse héritée du test précédent
  const reinit = async (): Promise<void> => {
    erreurs.length = 0
    await page.goto(`${ORIGINE}/`)
    await page.addScriptTag({ content: SCRIPT })
    await page.addStyleTag({ content: ':root{--mjs-toast-entree-duree:.01s}' })
  }

  // à chaque test
  beforeEach(async function () {
    if (!present) return
    await reinit()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  it('lien : Tab donne le focus au toast (anneau visible), Entrée suit le lien et ferme le toast', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Nouveau badge', { type: 'success', href: '#/badges', duration: 0 })`)
    assert.equal(await page.getByRole('link', { name: 'Succès Nouveau badge' }).count(), 1, 'un lien nommé par le titre et le message')
    await page.keyboard.press('Tab')
    assert.deepEqual(await focus(), { tag: 'A', classe: 'mjs-toast-action', visible: true })
    const e = await etat()
    assert.deepEqual([e.contour, e.epaisseur], ['solid', '2px'], 'anneau de focus visible')
    await page.keyboard.press('Enter')
    await page.waitForFunction(`location.hash === '#/badges'`)
    assert.equal(await nombre(), 0, 'toast fermé')
  })

  it('lien : un chemin est réellement suivi, bien que le toast soit retiré dans le même clic', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('Suite', { href: '/suite', duration: 0 })`)
    await page.keyboard.press('Tab')
    await Promise.all([page.waitForURL(`${ORIGINE}/suite`), page.keyboard.press('Enter')])
    assert.equal(page.url(), `${ORIGINE}/suite`)
  })

  it('bouton : Tab, puis Entrée, puis Espace appellent fn avec l\'événement et ferment le toast', async function () {
    if (!present) { this.skip(); return }
    await poser(`window.__n = []; µ.modal.notify('Annuler', { onClick: (e) => __n.push('Entrée:' + e.type), duration: 0 })`)
    assert.equal(await page.getByRole('button', { name: 'Info Annuler' }).count(), 1, 'un bouton nommé par le titre et le message')
    await page.keyboard.press('Tab')
    assert.deepEqual(await focus(), { tag: 'BUTTON', classe: 'mjs-toast-action', visible: true })
    await page.keyboard.press('Enter')
    assert.deepEqual(await page.evaluate(`__n`), ['Entrée:click'])
    assert.equal(await nombre(), 0, 'toast fermé après fn')
    await poser(`µ.modal.notify('Annuler', { onClick: (e) => __n.push('Espace:' + e.type), duration: 0 })`)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    assert.deepEqual(await page.evaluate(`__n`), ['Entrée:click', 'Espace:click'])
    assert.equal(await nombre(), 0)
  })

  it('toast ordinaire : seule la croix prend le focus au clavier', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('x', { duration: 0 })`)
    await page.keyboard.press('Tab')
    assert.equal((await focus()).classe, 'mjs-toast-close')
  })

  it('toute la surface du toast déclenche l\'action — icône, texte, marge, bord bas, près de la croix, bandeau de la barre de vie', async function () {
    if (!present) { this.skip(); return }
    const points: Record<string, string> = {
      icone:   `(r) => [r.icone.x + r.icone.width / 2, r.icone.y + r.icone.height / 2]`,
      texte:   `(r) => [r.texte.x + r.texte.width / 2, r.texte.y + r.texte.height / 2]`,
      marge:   `(r) => [r.toast.x + 3, r.toast.y + 8]`,
      bordBas: `(r) => [r.toast.x + r.toast.width / 2, r.toast.y + r.toast.height - 3]`,
      presCroix: `(r) => [r.croix.x - 10, r.croix.y + r.croix.height / 2]`,
      barre:   `(r) => [r.toast.x + r.toast.width / 2, r.toast.y + 1]`
    }
    let premier = true
    for (const [nomPoint, f] of Object.entries(points)) {
      // chaque toast paraît à la place du précédent, sous le point du clic qui l'a fermé : le délai du double clic doit être passé
      if (!premier) await page.waitForTimeout(410)
      premier = false
      await poser(`window.__n = 0; window.__h = µ.modal.notify('Zone', { onClick: () => { __n++ }, duration: 30000 })`)
      const [x, y] = await page.evaluate(`(() => {
        const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
        const r = { toast: box('.mjs-toast'), icone: box('.mjs-toast-icon'), texte: box('.mjs-toast-message'), croix: box('.mjs-toast-close') }
        return (${f})(r)
      })()`)
      const cible = await page.evaluate(`document.elementFromPoint(${x}, ${y}).className`)
      assert.equal(cible, 'mjs-toast-action', `${nomPoint} : l'élément sous le pointeur est la couverture (trouvé : ${cible})`)
      await page.mouse.click(x, y)
      assert.equal(await page.evaluate(`__n`), 1, `${nomPoint} : fn appelée`)
      assert.equal(await nombre(), 0, `${nomPoint} : toast fermé`)
    }
  })

  it('la croix reste à part : au-dessus de la couverture, elle ferme sans suivre le lien ni appeler fn', async function () {
    if (!present) { this.skip(); return }
    await poser(`window.__n = 0; µ.modal.notify('Lien', { href: '#/badges', duration: 0 }); µ.modal.notify('Bouton', { onClick: () => { __n++ }, duration: 0 })`)
    assert.equal(await page.evaluate(`(() => { const c = document.querySelector('.mjs-toast-close').getBoundingClientRect(); return document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2).className })()`), 'mjs-toast-close', 'la croix est au-dessus de la couverture')
    await page.locator('.mjs-toast-close').first().click()
    await page.locator('.mjs-toast-close').first().click()
    assert.equal(await nombre(), 0, 'les deux toasts sont fermés')
    assert.equal(await hash(), '', 'le lien n\'a pas été suivi')
    assert.equal(await page.evaluate(`__n`), 0, 'fn n\'a pas été appelée')
  })

  it('la croix au clavier : Tab, Tab puis Entrée ferment sans déclencher l\'action', async function () {
    if (!present) { this.skip(); return }
    await poser(`window.__n = 0; µ.modal.notify('Bouton', { onClick: () => { __n++ }, duration: 0 })`)
    await page.keyboard.press('Tab')
    assert.equal((await focus()).classe, 'mjs-toast-action')
    await page.keyboard.press('Tab')
    assert.equal((await focus()).classe, 'mjs-toast-close')
    await page.keyboard.press('Enter')
    assert.equal(await nombre(), 0)
    assert.equal(await page.evaluate(`__n`), 0)
  })

  it('états : au repos transparent, au survol un voile, à l\'appui un autre, réglables par --mjs-toast-hover-bg et --mjs-toast-active-bg', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('x', { onClick: () => {}, duration: 0 })`)
    const repos = await etat()
    assert.equal(alpha(repos.fond), 0, `fond transparent au repos (trouvé : ${repos.fond})`)
    assert.equal(repos.curseur, 'pointer')
    await page.hover('.mjs-toast-action')
    const survol = await etat()
    assert.ok(alpha(survol.fond) > 0, `un voile au survol (trouvé : ${survol.fond})`)
    await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-hover-bg', 'rgb(255, 0, 0)')`)
    assert.equal((await etat()).fond, 'rgb(255, 0, 0)', 'le thème règle le survol')
    await page.mouse.down()
    const appui = await etat()
    assert.ok(alpha(appui.fond) > 0, `un voile à l'appui (trouvé : ${appui.fond})`)
    assert.notEqual(appui.fond, 'rgb(255, 0, 0)', 'l\'appui a son propre état')
    await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-active-bg', 'rgb(0, 0, 255)')`)
    assert.equal((await etat()).fond, 'rgb(0, 0, 255)', 'le thème règle l\'appui')
    await page.mouse.up()
  })

  it('focus visible : anneau de la couleur du texte du toast, réglable par --mjs-toast-focus', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('x', { href: '#/badges', duration: 0 })`)
    await page.keyboard.press('Tab')
    assert.equal((await etat()).couleur, 'rgb(255, 255, 255)', 'blanc par défaut, comme le texte du toast')
    await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-focus', 'rgb(0, 255, 0)')`)
    assert.equal((await etat()).couleur, 'rgb(0, 255, 0)')
    await page.evaluate(`document.documentElement.style.removeProperty('--mjs-toast-focus'); document.documentElement.style.setProperty('--mjs-toast-fg', 'rgb(10, 20, 30)')`)
    assert.equal((await etat()).couleur, 'rgb(10, 20, 30)', 'sans --mjs-toast-focus, l\'anneau suit --mjs-toast-fg')
  })

  it('mise en page : un toast cliquable occupe exactement la place d\'un toast ordinaire, la couverture épouse le toast', async function () {
    if (!present) { this.skip(); return }
    const mesurer = (opts: string): Promise<any> => page.evaluate(`(async () => {
      const h = µ.modal.notify('Un message assez long pour passer sur plus d\\'une ligne dans la largeur du toast, afin de mesurer une hauteur vraie', Object.assign({ duration: 0 }, ${opts}))
      await Promise.all(document.getAnimations().filter((a) => a.animationName === 'mjs-toast-entree').map((a) => a.finished.catch(() => 0)))
      const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }
      const res = { toast: box('.mjs-toast'), icone: box('.mjs-toast-icon'), contenu: box('.mjs-toast-content'), croix: box('.mjs-toast-close'), couverture: box('.mjs-toast-action') }
      h.close()
      return res
    })()`)
    const ordinaire = await mesurer('{}')
    const lien      = await mesurer(`{ href: '#/x' }`)
    const bouton    = await mesurer(`{ onClick: () => {} }`)
    assert.equal(ordinaire.couverture, null)
    for (const [qui, m] of [['lien', lien], ['bouton', bouton]] as const) {
      for (const partie of ['toast', 'icone', 'contenu', 'croix']) {
        for (let i = 0; i < 4; i++) proche(m[partie][i], ordinaire[partie][i], `${qui} : ${partie}[${i}]`, 0.5)
      }
      for (let i = 0; i < 4; i++) proche(m.couverture[i], m.toast[i], `${qui} : la couverture épouse le toast [${i}]`, 1)
    }
  })

  it('fn qui lève : le toast se ferme quand même et l\'erreur remonte à la page', async function () {
    if (!present) { this.skip(); return }
    await poser(`µ.modal.notify('x', { onClick: () => { throw new Error('boum-cliquable') }, duration: 0 })`)
    await page.click('.mjs-toast-action')
    await page.waitForFunction(`document.querySelectorAll('.mjs-toast').length === 0`)
    await page.waitForTimeout(100)
    assert.ok(erreurs.some((m) => m.includes('boum-cliquable')), `erreur de page attendue : ${JSON.stringify(erreurs)}`)
    erreurs.length = 0
  })

  it('href et onClick ensemble : fn d\'abord, puis le lien — preventDefault() retient le lien', async function () {
    if (!present) { this.skip(); return }
    await poser(`window.__o = []; µ.modal.notify('Les deux', { href: '#/les-deux', duration: 0, onClick: () => { __o.push(location.hash) } })`)
    await page.click('.mjs-toast-action')
    await page.waitForFunction(`location.hash === '#/les-deux'`)
    assert.deepEqual(await page.evaluate(`__o`), [''], 'fn est passée avant le lien')
    assert.equal(await nombre(), 0)
    await page.waitForTimeout(410) // le second toast paraît sous le clic précédent : le délai du double clic doit être passé
    await poser(`µ.modal.notify('Retenu', { href: '#/retenu', duration: 0, onClick: (e) => { e.preventDefault() } })`)
    await page.click('.mjs-toast-action')
    await page.waitForFunction(`document.querySelectorAll('.mjs-toast').length === 0`)
    assert.equal(await hash(), '#/les-deux', 'le lien retenu n\'a pas été suivi')
  })

  // feuille d'appli ordinaire : des règles de balise et leurs états, comme en posent les feuilles « sans classe » et les remises à zéro
  const CSS_APPLI = `button{position:relative;margin:4px;padding:8px 16px;border:1px solid #888;border-radius:6px;background:#e0e0e0;color:#111;font:16px sans-serif;min-height:40px;appearance:auto}
    button:hover,button:active{background:#d0d0d0;border-color:#444}
    :is(button,[type=button]):is(:hover,:active,:focus){background:#c0c0ff}
    button:focus,a:focus,a:focus-visible,button:focus-visible{outline:none;outline-offset:6px}
    a{position:relative;margin:4px;padding:8px 16px;border:1px solid #00e;background:#eef;color:#00e;text-decoration:underline;font:16px serif}
    a:hover{background:yellow}`

  it('feuille d\'appli à règles de balise : la couverture reste transparente, nue et à sa place, le message reste visible', async function () {
    if (!present) { this.skip(); return }
    await page.addStyleTag({ content: CSS_APPLI })
    await page.mouse.move(2, 2)
    // le message d'un toast ordinaire sert de référence : la couverture ne doit rien changer à ce qui est peint
    const cliche = async (opts: string): Promise<any> => {
      await poser(`window.__h = µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      const r = await page.evaluate(`(() => { const r = document.querySelector('.mjs-toast-content').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      const png = await page.screenshot({ clip: r })
      const mesure = await page.evaluate(`(() => {
        const a = document.querySelector('.mjs-toast-action')
        if (!a) return null
        const cs = getComputedStyle(a), r = a.getBoundingClientRect(), tr = document.querySelector('.mjs-toast').getBoundingClientRect()
        return {
          tag: a.tagName, fond: cs.backgroundColor, image: cs.backgroundImage, position: cs.position, apparence: cs.appearance,
          bordure: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(' '),
          remplissage: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
          marge: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' '),
          ecart: [r.x - tr.x, r.y - tr.y, r.width - tr.width, r.height - tr.height].map((v) => Math.round(v))
        }
      })()`)
      await page.evaluate(`__h.close()`)
      return { png, mesure }
    }
    const ordinaire = await cliche('{}')
    assert.equal(ordinaire.mesure, null, 'le toast de référence n\'a pas de couverture')
    for (const [nom, opts] of [['bouton', `{ onClick: () => {} }`], ['lien', `{ href: '#/x' }`]] as const) {
      const { png, mesure } = await cliche(opts)
      assert.equal(alpha(mesure.fond), 0, `${nom} : fond transparent au repos (trouvé : ${mesure.fond})`)
      assert.equal(mesure.image, 'none', `${nom} : aucune image de fond`)
      assert.equal(mesure.position, 'absolute', `${nom} : position`)
      assert.equal(mesure.apparence, 'none', `${nom} : apparence`)
      assert.equal(mesure.bordure, '0px 0px 0px 0px', `${nom} : aucune bordure`)
      assert.equal(mesure.remplissage, '0px 0px 0px 0px', `${nom} : aucun remplissage`)
      assert.equal(mesure.marge, '0px 0px 0px 0px', `${nom} : aucune marge`)
      assert.deepEqual(mesure.ecart, [0, 0, 0, 0], `${nom} : la couverture épouse le toast`)
      assert.ok(png.equals(ordinaire.png), `${nom} : le message est peint comme celui d'un toast ordinaire`)
    }
  })

  for (const [nom, opts] of [['bouton', `{ onClick: () => {} }`], ['lien', `{ href: '#/x' }`]] as const) {
    it(`feuille d'appli à règles de balise (${nom}) : le voile de survol et d'appui reste un voile et garde ses variables de thème`, async function () {
      if (!present) { this.skip(); return }
      await page.addStyleTag({ content: CSS_APPLI })
      await page.mouse.move(2, 2)
      await poser(`µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      const repos = await etat()
      assert.equal(alpha(repos.fond), 0, `transparent au repos (trouvé : ${repos.fond})`)
      await page.hover('.mjs-toast-action')
      const survol = await etat()
      assert.ok(alpha(survol.fond) > 0 && alpha(survol.fond) < 0.5, `un voile léger au survol, jamais l'aplat de l'appli (trouvé : ${survol.fond})`)
      await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-hover-bg', 'rgb(255, 0, 0)')`)
      assert.equal((await etat()).fond, 'rgb(255, 0, 0)', '--mjs-toast-hover-bg règle le survol')
      await page.mouse.down()
      const appui = await etat()
      assert.ok(alpha(appui.fond) > 0 && alpha(appui.fond) < 0.5, `un voile léger à l'appui (trouvé : ${appui.fond})`)
      await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-active-bg', 'rgb(0, 0, 255)')`)
      assert.equal((await etat()).fond, 'rgb(0, 0, 255)', '--mjs-toast-active-bg règle l\'appui')
      await page.mouse.up()
    })

    it(`feuille d'appli à règles de balise (${nom}) : l'anneau de focus résiste à outline:none et garde sa variable de thème`, async function () {
      if (!present) { this.skip(); return }
      await page.addStyleTag({ content: CSS_APPLI })
      await page.mouse.move(2, 2)
      await poser(`µ.modal.notify('Un message à lire', Object.assign({ duration: 0 }, ${opts}))`)
      await page.keyboard.press('Tab')
      const anneau = await page.evaluate(`(() => { const cs = getComputedStyle(document.activeElement); return { classe: document.activeElement.className, style: cs.outlineStyle, epaisseur: cs.outlineWidth, decalage: cs.outlineOffset, couleur: cs.outlineColor, fond: cs.backgroundColor } })()`)
      assert.equal(anneau.classe, 'mjs-toast-action')
      assert.deepEqual([anneau.style, anneau.epaisseur, anneau.decalage], ['solid', '2px', '-4px'], 'anneau de 2 px tracé à l\'intérieur, malgré outline:none et outline-offset de l\'appli')
      assert.equal(anneau.couleur, 'rgb(255, 255, 255)', 'couleur de l\'anneau')
      assert.equal(alpha(anneau.fond), 0, `au focus, le fond reste transparent (trouvé : ${anneau.fond})`)
      await page.evaluate(`document.documentElement.style.setProperty('--mjs-toast-focus', 'rgb(0, 255, 0)')`)
      assert.equal((await etat()).couleur, 'rgb(0, 255, 0)', '--mjs-toast-focus règle l\'anneau')
    })
  }

  // le point du message du premier toast : c'est là que se fait le (double) clic
  const pointDuPremier = (): Promise<number[]> => page.evaluate(`(() => { const r = document.querySelector('.mjs-toast-message').getBoundingClientRect(); return [r.x + 5, r.y + 5] })()`)

  // pose les toasts (`preparer`) puis joue un geste de deux clics qui doivent tomber dans le délai du double clic (400 ms) : sur une
  // machine chargée, Playwright peut les espacer davantage, et le garde ne s'applique alors plus — le test ne prouverait rien. Le geste
  // est donc rejoué sur une page neuve jusqu'à ce que les deux clics, lus sur l'horloge des événements, soient à moins de 250 ms
  const dansLeDelai = async (preparer: string, geste: () => Promise<void>): Promise<void> => {
    let clics: number[] = []
    for (let essai = 1; essai <= 8; essai++) {
      if (essai > 1) await reinit()
      await poser(preparer)
      await page.evaluate(`window.__clics = []; document.addEventListener('click', (e) => { __clics.push(e.timeStamp) }, true)`)
      await geste()
      clics = await page.evaluate(`__clics`)
      if (clics.length >= 2 && clics[clics.length - 1] - clics[0] < 250) return
    }
    assert.fail(`les deux clics ne tiennent jamais dans le délai du double clic en 8 essais (instants : ${JSON.stringify(clics)})`)
  }

  it('double clic sur deux toasts à bouton empilés : seule la fonction du premier part, le second reste affiché, puis se déclenche une fois le délai passé', async function () {
    if (!present) { this.skip(); return }
    await dansLeDelai(`window.__n = []; µ.modal.notify('premier', { onClick: () => { __n.push('premier') }, duration: 0 }); µ.modal.notify('second', { onClick: () => { __n.push('second') }, duration: 0 })`, async () => {
      const [x, y] = await pointDuPremier()
      await page.mouse.dblclick(x, y)
    })
    assert.deepEqual(await page.evaluate(`__n`), ['premier'], 'seul le premier toast est déclenché')
    assert.equal(await nombre(), 1, 'le second toast reste affiché, à la place du premier')
    assert.equal(await page.evaluate(`document.querySelector('.mjs-toast-message').textContent`), 'second')
    await page.waitForTimeout(450)
    const [x, y] = await pointDuPremier()
    await page.mouse.click(x, y)
    assert.deepEqual(await page.evaluate(`__n`), ['premier', 'second'], 'le délai passé, le même clic déclenche le second')
    assert.equal(await nombre(), 0)
  })

  it('double clic sur deux toasts à lien empilés : seul le premier lien est suivi, le second reste affiché', async function () {
    if (!present) { this.skip(); return }
    await dansLeDelai(`µ.modal.notify('premier', { href: '#/premier', duration: 0 }); µ.modal.notify('second', { href: '#/second', duration: 0 })`, async () => {
      const [x, y] = await pointDuPremier()
      await page.mouse.dblclick(x, y)
    })
    assert.equal(await hash(), '#/premier', 'le lien du second toast n\'est pas suivi')
    assert.equal(await nombre(), 1)
  })

  it('double clic sur un lien suivi d\'un bouton : le bouton qui prend la place n\'est pas déclenché non plus', async function () {
    if (!present) { this.skip(); return }
    await dansLeDelai(`window.__n = []; µ.modal.notify('premier', { href: '#/premier', duration: 0 }); µ.modal.notify('second', { onClick: () => { __n.push('second') }, duration: 0 })`, async () => {
      const [x, y] = await pointDuPremier()
      await page.mouse.dblclick(x, y)
    })
    assert.equal(await hash(), '#/premier')
    assert.deepEqual(await page.evaluate(`__n`), [])
    assert.equal(await nombre(), 1)
  })

  it('le clavier n\'est pas concerné : au clavier, dans le délai du clic qui vient de fermer un toast, le toast suivant se déclenche', async function () {
    if (!present) { this.skip(); return }
    await dansLeDelai(`window.__n = []; µ.modal.notify('premier', { onClick: () => { __n.push('premier') }, duration: 0 }); µ.modal.notify('second', { onClick: () => { __n.push('second') }, duration: 0 })`, async () => {
      const [x, y] = await pointDuPremier()
      await page.mouse.click(x, y)
      await page.focus('.mjs-toast-action')
      await page.keyboard.press('Enter')
    })
    assert.deepEqual(await page.evaluate(`__n`), ['premier', 'second'], 'Entrée sur le second toast, dans le délai du clic qui a fermé le premier')
    assert.equal(await nombre(), 0)
  })

  it('un toast qui n\'est pas à la place du premier clic se déclenche aussitôt : le garde ne retient pas tous les clics du délai', async function () {
    if (!present) { this.skip(); return }
    await dansLeDelai(`window.__n = []; for (const nom of ['premier', 'second', 'troisieme']) µ.modal.notify(nom, { onClick: () => { __n.push(nom) }, duration: 0 })`, async () => {
      const [x, y] = await pointDuPremier()
      await page.mouse.click(x, y)
      // le troisième a remonté d'un cran : il n'est pas à la place du premier clic
      const [x3, y3] = await page.evaluate(`(() => { const r = document.querySelectorAll('.mjs-toast-message')[1].getBoundingClientRect(); return [r.x + 5, r.y + 5] })()`) as number[]
      await page.mouse.click(x3, y3)
    })
    assert.deepEqual(await page.evaluate(`__n`), ['premier', 'troisieme'])
    assert.equal(await nombre(), 1)
  })
})
