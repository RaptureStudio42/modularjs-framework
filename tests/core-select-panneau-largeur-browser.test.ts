// <@@select> dans Chromium, Firefox et WebKit réels : la largeur du panneau ouvert.
// - jamais moins large que la balise ; une balise plus étroite que ses libellés : le panneau s'élargit pour eux, un long libellé se lit
//   en entier (aucune coupure), y compris dans une longue liste qui défile ;
// - il part du bord gauche de la balise s'il tient dans la fenêtre, sinon son bord droit suit celui de la balise ; un libellé plus long
//   que la fenêtre : le panneau s'arrête à la fenêtre, sans défilement horizontal de la page ;
// - avec une recherche, sa largeur reste la même pendant qu'on filtre.
// Toutes les mesures sont des rectangles lus dans la page (aucun test de vitesse).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const LONG    = 'Une réponse dont le libellé est bien plus long que le bouton'
const OPTIONS = `<@@option value="1">Oui</@@option><@@option value="2">${LONG}</@@option><@@option value="3">Non</@@option>`
const VINGT   = Array.from({ length: 20 }, (_, i) => `<@@option value="${i + 1}">${i === 12 ? LONG : 'Choix ' + (i + 1)}</@@option>`).join('')
const ENORME  = 'Un libellé démesuré '.repeat(12).trim()

// les listes sont posées dans le document (seul le débordement d'un élément du document fait défiler la page), toutes dans une fenêtre de 360 px
const PAGE = `<div class="lieu gauche"><@@select class="l-gauche" name="g">${OPTIONS}</@@select></div>
<div class="lieu droite"><@@select class="l-droite" name="d">${OPTIONS}</@@select></div>
<div class="lieu court"><@@select class="l-court" name="c"><@@option value="1">Oui</@@option><@@option value="2">Non</@@option></@@select></div>
<div class="lieu vingt"><@@select class="l-vingt" name="v">${VINGT}</@@select></div>
<div class="lieu recherche"><@@select class="l-recherche" name="r" search>${OPTIONS}</@@select></div>
<div class="lieu enorme"><@@select class="l-enorme" name="e"><@@option value="1">Oui</@@option><@@option value="2">${ENORME}</@@option></@@select></div>

<style>
  .lieu
    position: absolute
  .gauche
    left: 20px
    top: 20px
  .droite
    right: 10px
    top: 20px
  .court
    left: 20px
    top: 380px
  .vingt
    left: 180px
    top: 80px
  .recherche
    left: 20px
    top: 440px
  .enorme
    left: 20px
    top: 500px
  .l-gauche, .l-droite, .l-vingt, .l-recherche, .l-enorme
    width: 140px
  .l-court
    width: 300px
</style>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte, libellés), compilé une fois pour les trois navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-panneau-largeur')
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> — la largeur du panneau (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any

  const coque    = (c: string) => `__q('.${c}')._shadow`
  const lire     = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 30000 })
  const panneau  = (c: string) => `${coque(c)}.querySelector('.select-panel')`

  // le rectangle du panneau et de la balise, le libellé le plus coupé du panneau, et l'état de défilement horizontal de la page
  const lieu = (c: string) => lire(`(() => {
    const sh = ${coque(c)}, p = sh.querySelector('.select-panel').getBoundingClientRect(), b = sh.querySelector('.select-btn').getBoundingClientRect(), d = document.documentElement
    const coupe = Math.max(0, ...[...sh.querySelectorAll('.select-option-label')].map((l) => l.scrollWidth - l.clientWidth))
    return { gauche: p.left, droite: p.right, largeur: p.width, bGauche: b.left, bDroite: b.right, bLargeur: b.width, coupe, fenetre: d.clientWidth, defile: d.scrollWidth > d.clientWidth }
  })()`)

  async function ouvrir(c: string) {
    await page.evaluate(`${coque(c)}.querySelector('.select-btn').scrollIntoView({ block: 'nearest' })`)
    const r = await lire(`(() => { const r = ${coque(c)}.querySelector('.select-btn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await page.mouse.click(r.x, r.y)
    await attendre(panneau(c))
    await page.waitForTimeout(100)
  }

  // une page neuve, à cette largeur de fenêtre
  async function charger(largeur: number) {
    const p = await browser.newPage({ viewport: { width: largeur, height: 700 } })
    await p.addInitScript('window.__name = (f) => f')
    await p.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${await script()}</script></body></html>`, { waitUntil: 'load' })
    await p.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.l-enorme')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await p.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await p.waitForTimeout(500)
    return p
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    browser = await playwright[nom].launch()
    page    = await charger(900)
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

  it('balise étroite : le panneau s\'élargit pour le long libellé, qui se lit en entier, depuis le bord gauche de la balise', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('l-gauche')
    const l = await lieu('l-gauche')
    assert.ok(l.bLargeur < 150, `la balise garde sa largeur : ${JSON.stringify(l)}`)
    assert.ok(l.largeur > l.bLargeur + 50, `plus large que la balise : ${JSON.stringify(l)}`)
    assert.equal(l.coupe, 0, `aucun libellé coupé : ${JSON.stringify(l)}`)
    assert.ok(Math.abs(l.gauche - l.bGauche) < 1.5, `bord gauche de la balise : ${JSON.stringify(l)}`)
    assert.ok(l.droite <= l.fenetre + 0.5 && l.defile === false, `dans la fenêtre, sans défilement : ${JSON.stringify(l)}`)
  })

  it('balise étroite au bord droit : le bord droit du panneau suit celui de la balise, rien ne déborde', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('l-droite')
    const l = await lieu('l-droite')
    assert.ok(l.largeur > l.bLargeur + 50 && l.coupe === 0, `élargi, libellé entier : ${JSON.stringify(l)}`)
    assert.ok(Math.abs(l.droite - l.bDroite) < 1.5, `bord droit de la balise : ${JSON.stringify(l)}`)
    assert.ok(l.gauche >= -0.5 && l.droite <= l.fenetre + 0.5 && l.defile === false, `dans la fenêtre, sans défilement : ${JSON.stringify(l)}`)
  })

  it('libellés courts : le panneau a la largeur de la balise et son bord gauche', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('l-court')
    const l = await lieu('l-court')
    assert.ok(Math.abs(l.largeur - l.bLargeur) < 1.5, `largeur de la balise : ${JSON.stringify(l)}`)
    assert.ok(Math.abs(l.gauche - l.bGauche) < 1.5, `bord gauche de la balise : ${JSON.stringify(l)}`)
  })

  it('une longue liste qui défile : le long libellé se lit en entier', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('l-vingt')
    const l = await lieu('l-vingt')
    assert.ok(await lire(`${panneau('l-vingt')}.scrollHeight > ${panneau('l-vingt')}.clientHeight`), 'le panneau défile')
    assert.ok(l.largeur > l.bLargeur + 50 && l.coupe === 0, `élargi, libellé entier : ${JSON.stringify(l)}`)
  })

  it('avec une recherche : la même largeur pendant qu\'on filtre', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('l-recherche')
    const avant = await lieu('l-recherche')
    assert.ok(avant.largeur > avant.bLargeur + 50 && avant.coupe === 0, `élargi, libellé entier : ${JSON.stringify(avant)}`)
    await page.keyboard.type('Oui')
    await attendre(`${coque('l-recherche')}.querySelectorAll('.select-option').length === 1`)
    await page.waitForTimeout(100)
    const apres = await lieu('l-recherche')
    assert.ok(Math.abs(apres.largeur - avant.largeur) < 1.5 && Math.abs(apres.gauche - avant.gauche) < 1.5, `même largeur, même place : ${JSON.stringify({ avant, apres })}`)
  })

  // une page neuve : WebKit garde le débordement d'un panneau déjà refermé quand la fenêtre se rétrécit ensuite sous son ancien bord droit
  it('fenêtre de 360 px, libellé plus long qu\'elle : le panneau s\'arrête à la fenêtre, sans défilement horizontal', async function () {
    if (!present) { this.skip(); return }
    const large = page
    page = await charger(360)
    try {
      await ouvrir('l-enorme')
      const l = await lieu('l-enorme')
      assert.ok(l.largeur > l.bLargeur + 50, `élargi : ${JSON.stringify(l)}`)
      assert.ok(l.gauche >= -0.5 && l.droite <= l.fenetre + 0.5, `dans la fenêtre : ${JSON.stringify(l)}`)
      assert.equal(l.defile, false, `aucun défilement horizontal : ${JSON.stringify(l)}`)
    }
    finally {
      await page.close()
      page = large
    }
  })
})
