// <@@select> dans Chromium, Firefox et WebKit, construit en production, dans une boîte étroite (120 px) :
// - sans largeur écrite sur la balise, le select tient dans sa boîte : le bouton n'en dépasse pas, l'étiquette trop longue y est coupée par
//   des points de suspension, et la page d'un téléphone (360 px) ne défile pas de côté ; le panneau ouvert s'élargit pour ses étiquettes,
//   dans la fenêtre ;
// - un panneau élargi dans une fenêtre large (800 px), puis refermé, ne compte plus dans la largeur de la page : la fenêtre réduite
//   ensuite à 360 px ne défile pas de côté (WebKit gardait le débordement du panneau refermé : 408 px de défilement)

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS, fermer } from './helpers/sortable-navigateur.js'

const LONGUE = 'Une autre étiquette vraiment très longue, plus longue que la fenêtre d\'un téléphone de trois cent soixante pixels'

const PAGE = `<script>
  $v = 'b'
  $w = 'a'
  $x = 'a'
</script>
<div class="gauche">
  <div class="etroit e0">
    <@@select class="s0" value=!{$v}>
      <@@option value="a">A</@@option>
      <@@option value="b">${LONGUE}</@@option>
    </@@select>
  </div>
</div>
<div class="gauche">
  <div class="etroit e2">
    <@@select class="s2" value=!{$w}>
      <@@option value="a">B</@@option>
      <@@option value="b">${LONGUE}</@@option>
    </@@select>
  </div>
</div>
<div class="droite">
  <div class="etroit e1">
    <@@select class="s1" value=!{$x}>
      <@@option value="a">C</@@option>
      <@@option value="b">Une étiquette assez longue pour élargir le panneau</@@option>
    </@@select>
  </div>
</div>
<style>
  :host
    display: block
  .gauche
    display: flex
    padding: 8px 4px
  .droite
    display: flex
    justify-content: flex-end
    padding: 8px 4px
  .etroit
    width: 120px
  .s2
    width: 120px
</style>
`

// trois listes de largeur écrite sur la balise : au bord droit, au bord gauche (dans une ligne flex), et dans un bloc de largeur fixe ; les
// panneaux des deux dernières s'élargissent à 800 px
const PAGE2 = `<script>
  $v = 'a'
  $w = 'a'
  $x = 'a'
</script>
<div class="droite">
  <div class="etroit e1">
    <@@select class="s1" value=!{$v}>
      <@@option value="a">A</@@option>
      <@@option value="b">Une étiquette assez longue pour élargir le panneau</@@option>
    </@@select>
  </div>
</div>
<div class="gauche">
  <div class="etroit e2">
    <@@select class="s2" value=!{$w}>
      <@@option value="a">B</@@option>
      <@@option value="b">${LONGUE}</@@option>
    </@@select>
  </div>
</div>
<div class="bloc">
  <div class="etroit e3">
    <@@select class="s3" value=!{$x}>
      <@@option value="a">D</@@option>
      <@@option value="b">${LONGUE}</@@option>
    </@@select>
  </div>
</div>
<style>
  :host
    display: block
  .bloc
    width: 300px
    padding: 8px 4px
  .droite
    display: flex
    justify-content: flex-end
    padding: 8px 4px
  .gauche
    display: flex
    padding: 8px 4px
  .etroit
    width: 120px
  .s1, .s2, .s3
    width: 120px
</style>
`

let TAG = 'mjs-sel-page'
const S      = (c: string) => `document.querySelector('${TAG}')._shadow.querySelector('.${c}')`
const ETAT   = (c: string, boite: string) => `(() => { const S = ${S(c)}._shadow; const b = S.querySelector('.select-btn').getBoundingClientRect(); const x = ${S(boite)}.getBoundingClientRect(); const p = S.querySelector('.select-panel'); const q = p && p.getClientRects().length ? p.getBoundingClientRect() : null; const l = S.querySelector('.select-label'); const de = document.documentElement; return { btn: [Math.round(b.left), Math.round(b.right)], boite: [Math.round(x.left), Math.round(x.right)], panel: q ? [Math.round(q.left), Math.round(q.right)] : null, coupe: l.scrollWidth > l.clientWidth && getComputedStyle(l).textOverflow === 'ellipsis', cw: de.clientWidth, sw: de.scrollWidth } })()`
const CLIC   = (c: string) => `${S(c)}._shadow.querySelector('.select-btn').click()`
const DEFILE = `(() => { window.scrollTo(1000, 0); const de = document.documentElement; return { cw: de.clientWidth, sw: de.scrollWidth, sx: Math.round(window.scrollX) } })()`

async function ouvrir(browser: any, built: { root: string }, viewport: { width: number, height: number }, tag = 'mjs-sel-page', listes = ['s0', 's1', 's2']): Promise<{ ctx: any, page: any, erreurs: string[] }> {
  TAG = tag
  const ctx  = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
  await page.addInitScript('window.__name = function (f) { return f };')
  await page.route('http://s.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><${tag}></${tag}><script type="module" src="/out/bundle.js"></script></body></html>` })
    const fichier = join(built.root, normalize(chemin))
    if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://s.test/', { waitUntil: 'load' })
  await page.waitForFunction(`(() => ${JSON.stringify(listes)}.every((c) => document.querySelector('${tag}')?._shadow?.querySelector('.' + c)?._shadow?.querySelector('.select-btn')))()`, null, { timeout: 15000 })
  await page.waitForTimeout(250)
  return { ctx, page, erreurs }
}

for (const nom of NAVIGATEURS) describe(`<@@select> dans une boîte de 120 px (${nom}, production)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await construire('select-boite-etroite', { 'sel-page.mjs': PAGE, 'sel-bords.mjs': PAGE2 }, true)
    browser = await (await import('playwright'))[nom].launch()
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  it('360 px : le select sans largeur écrite tient dans sa boîte, son étiquette coupée ; ouvert, le panneau est dans la fenêtre ; aucun défilement de côté', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, { width: 360, height: 640 })
    const e: any = await page.evaluate(ETAT('s0', 'e0'))
    assert.ok(e.btn[0] >= e.boite[0] && e.btn[1] <= e.boite[1], `le bouton tient dans sa boîte (${JSON.stringify(e)})`)
    assert.ok(e.coupe, `l'étiquette trop longue est coupée par des points de suspension (${JSON.stringify(e)})`)
    assert.ok(e.sw <= e.cw, `la page ne défile pas de côté (${JSON.stringify(e)})`)
    for (const [c, boite] of [['s0', 'e0'], ['s1', 'e1']]) {
      await page.evaluate(CLIC(c))
      await page.waitForTimeout(300)
      const o: any = await page.evaluate(ETAT(c, boite))
      assert.ok(o.panel && o.panel[0] >= 0 && o.panel[1] <= o.cw && o.panel[1] - o.panel[0] >= o.btn[1] - o.btn[0] - 1 && o.sw <= o.cw, `${c} ouvert : le panneau est dans la fenêtre, au moins la largeur du bouton (${JSON.stringify(o)})`)
      await page.evaluate(CLIC(c))
      await page.waitForTimeout(200)
      const f: any = await page.evaluate(ETAT(c, boite))
      assert.ok(f.panel === null && f.sw <= f.cw, `${c} refermé : aucun défilement de côté (${JSON.stringify(f)})`)
    }
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('800 px puis 360 px : les panneaux élargis puis refermés ne comptent plus dans la largeur de la page', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, { width: 800, height: 600 })
    for (const [c, boite] of [['s2', 'e2'], ['s0', 'e0']]) {
      await page.evaluate(CLIC(c))
      await page.waitForTimeout(300)
      const o: any = await page.evaluate(ETAT(c, boite))
      assert.ok(o.panel && o.panel[1] > 400, `${c} ouvert à 800 px : le panneau s'élargit pour ses étiquettes (${JSON.stringify(o)})`)
      await page.evaluate(CLIC(c))
      await page.waitForTimeout(200)
    }
    await page.setViewportSize({ width: 360, height: 640 })
    await page.waitForTimeout(400)
    const d: any = await page.evaluate(DEFILE)
    assert.ok(d.sw <= d.cw && d.sx === 0, `la fenêtre réduite à 360 px ne défile pas de côté (${JSON.stringify(d)})`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  for (const [c, boite, lieu] of [['s2', 'e2', 'une ligne flex'], ['s3', 'e3', 'un bloc de largeur fixe']]) it(`largeur écrite sur la balise, dans ${lieu} : un panneau élargi à 800 px puis refermé, la fenêtre réduite à 360 px ne défile pas de côté`, async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, built, { width: 800, height: 600 }, 'mjs-sel-bords', ['s1', 's2', 's3'])
    await page.evaluate(CLIC(c))
    await page.waitForTimeout(300)
    const o: any = await page.evaluate(ETAT(c, boite))
    assert.ok(o.panel && o.panel[1] > 700, `${c} ouvert à 800 px : le panneau s'élargit jusqu'au bord de la fenêtre (${JSON.stringify(o)})`)
    await page.evaluate(CLIC(c))
    await page.waitForTimeout(200)
    await page.setViewportSize({ width: 360, height: 640 })
    await page.waitForTimeout(400)
    const d: any = await page.evaluate(DEFILE)
    assert.ok(d.sw <= d.cw && d.sx === 0, `la fenêtre réduite à 360 px ne défile pas de côté (${JSON.stringify(d)})`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
