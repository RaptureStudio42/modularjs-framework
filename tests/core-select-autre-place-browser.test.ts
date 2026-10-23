// <@@select other> dans Chromium et Firefox réels : la place du panneau dans la fenêtre.
// - le bloc de la réponse libre (champ, ✔, indice, compteur) se voit EN ENTIER dans la partie visible du panneau, ouvert à la souris
//   comme au clavier (Fin, Entrée), avec ou sans recherche, vers le bas comme vers le haut, après chaque validation en choix multiple et
//   après un redimensionnement de la fenêtre pendant la saisie ; quand le panneau est plus bas que le bloc, c'est le champ qui se voit d'abord ;
// - le panneau d'une liste other garde sa largeur minimale mais ne sort jamais de la fenêtre : trop à droite, il s'aligne sur le bord droit
//   de la balise, trop à gauche encore, la fenêtre le borne ; il ne crée aucun défilement horizontal ; sans other, rien ne change.
// Toutes les mesures sont des rectangles lus dans la page (aucun test de vitesse).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const NEUF  = ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf'].map((n, i) => `<@@option value="${i + 1}">${n}</@@option>`).join('')
const TROIS = '<@@option value="1">Un</@@option><@@option value="2">Deux</@@option><@@option value="3">Trois</@@option>'

// les listes du haut et du bas sont dans des conteneurs fixes (leur place ne dépend ni du flux ni du défilement de la page) ; celles de la
// largeur sont posées dans le document : seul le débordement d'un élément du document fait défiler la page, un élément fixe n'en fait pas
const PAGE = `<div class="haut a"><@@select class="h-simple" name="h1" other>${NEUF}</@@select></div>
<div class="haut b"><@@select class="h-recherche" name="h2" search other>${NEUF}</@@select></div>
<div class="haut c"><@@select class="h-multiple" name="h3[]" multiple other>${NEUF}</@@select></div>
<div class="bas a"><@@select class="b-simple" name="b1" other>${NEUF}</@@select></div>
<div class="bas b"><@@select class="b-recherche" name="b2" search other>${NEUF}</@@select></div>
<div class="bas c"><@@select class="b-multiple" name="b3[]" multiple other>${NEUF}</@@select></div>
<div class="bord coin"><@@select class="s-coin" name="c1" other>${TROIS}</@@select></div>
<div class="bord coin-sans"><@@select class="s-coin-sans" name="c2">${TROIS}</@@select></div>
<div class="bord milieu"><@@select class="s-milieu" name="c3" other>${TROIS}</@@select></div>
<div class="bord gauche"><@@select class="s-gauche" name="c4" other>${TROIS}</@@select></div>
<div class="bord suit"><@@select class="s-suit" name="c5" other>${TROIS}</@@select></div>

<style>
  .haut, .bas
    position: fixed
    width: 240px
  .haut
    top: 20px
  .bas
    bottom: 20px
  .a
    left: 20px
  .b
    left: 300px
  .c
    left: 580px
  .bord
    position: absolute
    top: 300px
  .coin
    right: 10px
  .coin-sans
    right: 10px
    top: 400px
  .milieu
    left: 130px
    top: 400px
  .gauche
    left: 10px
    top: 500px
  .suit
    left: 60%
    top: 500px
</style>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte, libellés), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-autre-place')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return compile
}

const LISTES = ['h-simple', 'h-recherche', 'h-multiple', 'b-simple', 'b-recherche', 'b-multiple']

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select other> — la place du panneau (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any

  const coque    = (c: string) => `__q('.${c}')._shadow`
  const lire     = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 30000 })
  const champ    = (c: string) => `${coque(c)}.querySelector('.select-other-input')`
  const panneau  = (c: string) => `${coque(c)}.querySelector('.select-panel')`
  const lignes   = (c: string) => `${coque(c)}.querySelectorAll('.select-option').length`

  // le centre d'un élément de l'ombre d'une liste, amené dans la partie visible de son panneau (le défilement du panneau seul)
  async function centre(c: string, css: string) {
    return page.evaluate(`(() => { const e = ${coque(c)}.querySelector('${css}'); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  }

  async function cliquer(c: string, css: string) {
    const p = await centre(c, css)
    await page.mouse.click(p.x, p.y)
  }

  async function champSouris(c: string) {
    await cliquer(c, '.select-btn')
    await attendre(panneau(c))
    await cliquer(c, '.select-other')
    await attendre(`${champ(c)} && ${coque(c)}.activeElement === ${champ(c)}`)
    await page.waitForTimeout(150)
  }

  async function champClavier(c: string) {
    await page.evaluate(`${coque(c)}.querySelector('.select-btn').focus()`)
    await page.keyboard.press('ArrowDown')
    await attendre(panneau(c))
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await attendre(`${champ(c)} && ${coque(c)}.activeElement === ${champ(c)}`)
    await page.waitForTimeout(150)
  }

  // ce qui se voit du bloc : dans la partie visible du panneau (sous le champ de recherche collant) ET dans la fenêtre
  const mesure = (c: string) => lire(`(() => {
    const sh = ${coque(c)}, pan = sh.querySelector('.select-panel'), pr = pan.getBoundingClientRect()
    const collant = sh.querySelector('.select-search')
    const haut = pr.top + pan.clientTop + (collant ? collant.offsetHeight : 0), bas = pr.top + pan.clientTop + pan.clientHeight
    const vu = (s) => { const r = sh.querySelector(s).getBoundingClientRect(); return r.top >= haut - 0.5 && r.bottom <= bas + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5 }
    return { bloc: vu('.select-other-edit'), champ: vu('.select-other-input'), ok: vu('.select-other-ok'), indice: vu('.select-other-hint'), compteur: vu('.select-other-count'),
      champHaut: sh.querySelector('.select-other-input').getBoundingClientRect().top - haut, vers: pan.classList.contains('up') ? 'haut' : 'bas', panneau: [Math.round(pr.top), Math.round(pr.bottom)], fenetre: innerHeight }
  })()`)

  const toutVu = (m: any, ou: string) => assert.deepEqual({ bloc: m.bloc, champ: m.champ, ok: m.ok, indice: m.indice, compteur: m.compteur }, { bloc: true, champ: true, ok: true, indice: true, compteur: true }, `${ou} : ${JSON.stringify(m)}`)

  // le rectangle du panneau et de la balise, et l'état de défilement horizontal de la page
  const lieu = (c: string) => lire(`(() => {
    const p = ${panneau(c)}.getBoundingClientRect(), b = ${coque(c)}.querySelector('.select-btn').getBoundingClientRect(), d = document.documentElement
    return { gauche: p.left, droite: p.right, largeur: p.width, bGauche: b.left, bDroite: b.right, bLargeur: b.width, fenetre: d.clientWidth, defile: d.scrollWidth > d.clientWidth }
  })()`)

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const code = await script()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.s-suit')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  })

  // un test qui échoue en cours de route ne laisse ni un panneau ouvert ni une fenêtre redimensionnée derrière lui
  afterEach(async () => {
    if (!present) return
    await page.setViewportSize({ width: 900, height: 700 })
    await page.mouse.click(2, 2)
    await page.evaluate(`[...document.querySelector('mjs-hote')._shadow.querySelectorAll('mjs-core-select')].forEach((s) => { const b = s._shadow.querySelector('.select-btn'); if (b.getAttribute('aria-expanded') === 'true') b.click() })`)
    await page.waitForTimeout(100)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const c of LISTES) it(`${c} : ouvert à la souris, le bloc du champ se voit en entier dans le panneau`, async function () {
    if (!present) { this.skip(); return }
    await champSouris(c)
    const m = await mesure(c)
    assert.equal(m.vers, c.startsWith('b-') ? 'haut' : 'bas', 'le panneau s\'ouvre du côté attendu')
    toutVu(m, c)
  })

  for (const c of LISTES) it(`${c} : ouvert au clavier (Fin, Entrée), de même`, async function () {
    if (!present) { this.skip(); return }
    await champClavier(c)
    toutVu(await mesure(c), c)
  })

  for (const c of ['h-multiple', 'b-multiple']) it(`${c} : après CHAQUE validation la liste s'allonge et le bloc reste visible en entier`, async function () {
    if (!present) { this.skip(); return }
    await champSouris(c)
    let n = 9
    for (const texte of ['kiwi', 'mangue', 'litchi', 'papaye']) {
      await page.keyboard.type(texte)
      await page.keyboard.press('Enter')
      n++
      await attendre(`${lignes(c)} === ${n}`)
      await page.waitForTimeout(100)
      toutVu(await mesure(c), `${c} après « ${texte} »`)
    }
  })

  it('après un redimensionnement de la fenêtre pendant la saisie, le bloc reste visible ; plus bas que lui, le panneau montre le champ d\'abord', async function () {
    if (!present) { this.skip(); return }
    await champSouris('h-simple')
    await page.keyboard.type('abc')
    toutVu(await mesure('h-simple'), 'avant')
    await page.setViewportSize({ width: 900, height: 300 })
    await page.waitForTimeout(300)
    toutVu(await mesure('h-simple'), 'fenêtre de 300 px')
    await page.setViewportSize({ width: 900, height: 140 })
    await page.waitForTimeout(300)
    const petit = await mesure('h-simple')
    assert.equal(petit.champ, true, `le panneau est plus bas que le bloc : le champ se voit d'abord ${JSON.stringify(petit)}`)
    await page.setViewportSize({ width: 900, height: 700 })
    await page.waitForTimeout(300)
    toutVu(await mesure('h-simple'), 'fenêtre rendue')
    assert.equal(await lire(`${champ('h-simple')}.value`), 'abc', 'la saisie est intacte')
  })

  it('avec une recherche, le champ de recherche collant ne masque pas le champ quand le panneau est plus bas que le bloc', async function () {
    if (!present) { this.skip(); return }
    await champSouris('h-recherche')
    await page.setViewportSize({ width: 900, height: 170 })
    await page.waitForTimeout(300)
    const m = await mesure('h-recherche')
    assert.equal(m.champ, true, JSON.stringify(m))
    assert.ok(m.champHaut >= -0.5, `le champ commence sous le champ de recherche : ${m.champHaut}`)
  })

  it('la page ne défile pas pour montrer le champ', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`document.body.style.minHeight = '3000px'; window.scrollTo(0, 150)`)
    await champSouris('h-simple')
    const defil = await lire(`[window.scrollX, window.scrollY]`)
    await page.evaluate(`document.body.style.minHeight = ''; window.scrollTo(0, 0)`)
    assert.deepEqual(defil, [0, 150])
  })

  describe('la largeur : fenêtre de 360 px', () => {
    beforeEach(async () => { if (present) await page.setViewportSize({ width: 360, height: 740 }) })

    it('balise étroite au bord droit : le panneau garde sa largeur minimale, s\'aligne sur le bord droit de la balise et ne sort pas de la fenêtre', async function () {
      if (!present) { this.skip(); return }
      await cliquer('s-coin', '.select-btn')
      await attendre(panneau('s-coin'))
      const l = await lieu('s-coin')
      assert.ok(l.bGauche + 256 > l.fenetre, `la balise est assez à droite pour que le panneau déborde sans correction : ${JSON.stringify(l)}`)
      assert.ok(l.largeur >= 255, `la largeur minimale reste : ${l.largeur} px`)
      assert.ok(Math.abs(l.droite - l.bDroite) < 1.5, `aligné sur le bord droit de la balise : ${JSON.stringify(l)}`)
      assert.ok(l.gauche >= -0.5 && l.droite <= l.fenetre + 0.5, `dans la fenêtre : ${JSON.stringify(l)}`)
      assert.equal(l.defile, false, 'aucun défilement horizontal de la page')
    })

    it('balise au milieu : alignée à droite il dépasserait à gauche, la fenêtre le borne', async function () {
      if (!present) { this.skip(); return }
      await cliquer('s-milieu', '.select-btn')
      await attendre(panneau('s-milieu'))
      const l = await lieu('s-milieu')
      assert.ok(l.bGauche + 256 > l.fenetre && l.bDroite - 256 < 0, `ni la position naturelle ni l'alignement à droite ne tiennent : ${JSON.stringify(l)}`)
      assert.ok(l.largeur >= 255, `la largeur minimale reste : ${l.largeur} px`)
      assert.ok(l.gauche >= -0.5 && l.droite <= l.fenetre + 0.5, `borné par la fenêtre : ${JSON.stringify(l)}`)
      assert.equal(l.defile, false, 'aucun défilement horizontal de la page')
    })

    it('balise à gauche : le panneau reste à sa place, sur le bord gauche de la balise', async function () {
      if (!present) { this.skip(); return }
      await cliquer('s-gauche', '.select-btn')
      await attendre(panneau('s-gauche'))
      const l = await lieu('s-gauche')
      assert.ok(Math.abs(l.gauche - l.bGauche) < 1.5, `bord gauche de la balise : ${JSON.stringify(l)}`)
      assert.ok(l.largeur >= 255 && l.droite <= l.fenetre, JSON.stringify(l))
    })

    it('sans other, rien ne change : le panneau a la largeur de la balise et son bord gauche', async function () {
      if (!present) { this.skip(); return }
      await cliquer('s-coin-sans', '.select-btn')
      await attendre(panneau('s-coin-sans'))
      const l = await lieu('s-coin-sans')
      assert.ok(Math.abs(l.largeur - l.bLargeur) < 1.5, `largeur de la balise : ${JSON.stringify(l)}`)
      assert.ok(Math.abs(l.gauche - l.bGauche) < 1.5, `bord gauche de la balise : ${JSON.stringify(l)}`)
    })

    it('la fenêtre se rétrécit pendant que le panneau est ouvert : il se replace', async function () {
      if (!present) { this.skip(); return }
      await page.setViewportSize({ width: 1000, height: 740 })
      await page.waitForTimeout(200)
      await cliquer('s-suit', '.select-btn')
      await attendre(panneau('s-suit'))
      const large = await lieu('s-suit')
      assert.ok(Math.abs(large.gauche - large.bGauche) < 1.5, `assez de place : le panneau suit le bord gauche ${JSON.stringify(large)}`)
      await page.setViewportSize({ width: 500, height: 740 })
      await page.waitForTimeout(300)
      const etroit = await lieu('s-suit')
      assert.ok(etroit.bGauche + 256 > etroit.fenetre, JSON.stringify(etroit))
      assert.ok(Math.abs(etroit.droite - etroit.bDroite) < 1.5, `replacé sur le bord droit de la balise : ${JSON.stringify(etroit)}`)
      assert.ok(etroit.gauche >= -0.5 && etroit.droite <= etroit.fenetre + 0.5, JSON.stringify(etroit))
    })
  })
})
