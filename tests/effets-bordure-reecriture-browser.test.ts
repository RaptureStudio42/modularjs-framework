// *border dans Chromium, Firefox et WebKit, en développement et en production : un script qui réécrit le contenu de la balise
// (`textContent`, `innerHTML`, `replaceChildren`) emporte les enfants de la balise, et avec eux le calque que l'effet y a posé. Le calque
// revient sur le nouveau contenu : celui du dégradé posé avec *spotlight (le liseré et son halo y dessinent), la dentelle de `wave`, le trait
// de `run`. Le liseré se voit autant qu'avant (pixels colorés autour de la balise, comparés à *border posé seul). Un script qui réécrit la
// balise à chaque retour du calque ne fige pas la page : le calque cesse de revenir dans la même tâche, et revient à l'écriture suivante. Un
// script qui réécrit la balise plus de 20 fois dans une même tâche (des écritures séparées par des microtâches) ne la prive pas du calque :
// il revient à la tâche suivante

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS, fermer } from './helpers/sortable-navigateur.js'

const PAGE = `<div class="cadre">
  <div class="tuile seul" *border(gradient)>seul</div>
  <div class="tuile ens" *border(gradient) *spotlight>ensemble</div>
  <div class="tuile ens-t" *border(gradient) *spotlight>texte</div>
  <div class="tuile ens-h" *border(gradient) *spotlight>html</div>
  <div class="tuile ens-r" *border(gradient) *spotlight>enfants</div>
  <div class="tuile onde" *border(wave)>onde</div>
  <div class="tuile trait" *border(run)>trait</div>
  <div class="tuile boucle" *border(gradient) *spotlight>boucle</div>
</div>
<style>
  :host
    display: block
  .cadre
    display: flex
    flex-wrap: wrap
    gap: 70px
    padding: 50px
    background: #111
    color: #888
  .tuile
    width: 120px
    height: 60px
    background: #222
</style>
`

const TUILES = ['seul', 'ens', 'ens-t', 'ens-h', 'ens-r', 'onde', 'trait', 'boucle']
const AIDES = `
window.__B = (c) => document.querySelector('mjs-bdr-page')._shadow.querySelector('.' + c);
window.__calques = () => ${JSON.stringify(TUILES)}.map((c) => [...__B(c).children].filter((e) => e.hasAttribute('mjs-fx-layer')).map((e) => e.getAttribute('mjs-fx-layer')).join(','));
window.__px = async (b64, rects) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const out = {}; for (const k of Object.keys(rects)) { const r = rects[k]; const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)); const w = Math.min(img.width - x, Math.round(r.w)), h = Math.min(img.height - y, Math.round(r.h)); const d = g.getImageData(x, y, w, h).data; let col = 0; for (let i = 0; i < d.length; i += 4) { if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 50) col++ } out[k] = col } return out };
`

// la page dans un contexte neuf, prête quand les huit tuiles ont leur effet ; `fn` s'exécute, puis aucune erreur de page ne doit rester
async function ouvrir(browser: any, built: { root: string, script: string }, prod: boolean, fn: (page: any) => Promise<void>): Promise<void> {
  const ctx  = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 300)))
  await page.addInitScript('window.__name = function (f) { return f };' + AIDES)
  const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
  await page.route('http://b.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-bdr-page></mjs-bdr-page>${charge}</body></html>` })
    const fichier = join(built.root, normalize(chemin))
    if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  try {
    await page.goto('http://b.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const S = (document.querySelector('mjs-bdr-page') as any)?._shadow; return !!S && S.querySelectorAll('[mjs-fx~="border"]').length === 8 }, null, { timeout: 15000 }).catch(() => { throw new Error('la page ne démarre pas : ' + (erreurs.join(' | ') || 'aucune erreur de page')) })
    await page.waitForTimeout(250)
    await fn(page)
    assert.deepEqual(erreurs, [], 'aucune erreur de page')
  }
  finally {
    await ctx.close()
  }
}

const MODES = (process.env.MJS_BORDURE_MODES ?? 'dev,prod').split(',')

for (const nom of NAVIGATEURS) for (const prod of MODES.map((m) => m === 'prod')) describe(`*border : le calque revient après une réécriture du contenu (${nom}, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await construire('bordure-reecriture', { 'bdr-page.mjs': PAGE }, prod)
    browser = await (await import('playwright'))[nom].launch()
  })
  after(async () => { await browser?.close(); await fermer() })
  beforeEach(function () { if (!present) this.skip() })

  it('textContent, innerHTML, replaceChildren : le calque du dégradé (avec *spotlight), la dentelle et le trait reviennent, le liseré se voit', async () => {
    await ouvrir(browser, built, prod, async (page) => {
      const anneaux = async (): Promise<Record<string, number>> => {
        const R: any = await page.evaluate(`(() => { const cad = __B('seul').parentNode.getBoundingClientRect(); const o = { clip: { x: cad.x, y: cad.y, width: cad.width, height: cad.height } }; for (const c of ['seul', 'ens', 'ens-t', 'ens-h', 'ens-r']) { const q = __B(c).getBoundingClientRect(); o[c] = { x: q.x - cad.x, y: q.y - cad.y, w: q.width, h: q.height } } return o })()`)
        const b64 = (await page.screenshot({ clip: R.clip })).toString('base64')
        const zones: any = {}
        for (const c of ['seul', 'ens', 'ens-t', 'ens-h', 'ens-r']) { const q = R[c]; zones[c + ':ext'] = { x: q.x - 24, y: q.y - 24, w: q.w + 48, h: q.h + 48 }; zones[c + ':int'] = { x: q.x + 8, y: q.y + 8, w: q.w - 16, h: q.h - 16 } }
        const px: any = await page.evaluate(([b, z]: any) => (window as any).__px(b, z), [b64, zones])
        return Object.fromEntries(['seul', 'ens', 'ens-t', 'ens-h', 'ens-r'].map((c) => [c, px[c + ':ext'] - px[c + ':int']]))
      }
      await page.mouse.move(2, 2)
      const attendus = ['', 'border-gradient', 'border-gradient', 'border-gradient', 'border-gradient', 'border', 'border-run', 'border-gradient']
      assert.deepEqual(await page.evaluate('__calques()'), attendus, 'les calques au départ')
      await page.evaluate(`(() => { __B('ens-t').textContent = 'nouveau'; __B('ens-h').innerHTML = '<b>gras</b> et le reste'; __B('ens-r').replaceChildren(document.createTextNode('neuf'), document.createElement('i')); __B('onde').textContent = 'autre'; __B('trait').innerHTML = 'autre' })()`)
      await page.waitForTimeout(300)
      assert.deepEqual(await page.evaluate('__calques()'), attendus, 'les calques après la réécriture')
      assert.deepEqual(await page.evaluate(`['ens-t', 'ens-h', 'ens-r', 'onde', 'trait'].map((c) => __B(c).textContent)`), ['nouveau', 'gras et le reste', 'neuf', 'autre', 'autre'], 'le nouveau contenu reste tel que le script l\'a écrit')
      const a = await anneaux()
      for (const c of ['ens', 'ens-t', 'ens-h', 'ens-r']) assert.ok(a.seul > 200 && a[c] > 0.6 * a.seul, `${c} : le liseré se voit comme celui de *border seul (${JSON.stringify(a)})`)
      // un script qui réécrit la balise tant qu'elle a plus d'un enfant : le calque cesse de revenir dans la même tâche, la page répond
      await page.evaluate(`(() => { const b = __B('boucle'); window.__tours = 0; new MutationObserver(() => { window.__tours++; if (b.childNodes.length !== 1) b.textContent = 'boucle ' + window.__tours }).observe(b, { childList: true }); b.textContent = 'départ' })()`)
      await page.waitForTimeout(200)
      const tours: any = await page.evaluate('window.__tours')
      assert.ok(tours > 0 && tours < 100, `la réécriture en boucle s'arrête (${tours} tours)`)
      await page.evaluate(`__B('boucle').textContent = 'plus tard'`)
      await page.waitForTimeout(200)
      assert.ok(await page.evaluate('window.__tours') > tours, 'l\'écriture suivante est vue')
    })
  })

  it('30 réécritures séparées par des microtâches dans une même tâche : le calque du dégradé, la dentelle et le trait reviennent à la tâche suivante', async () => {
    await ouvrir(browser, built, prod, async (page) => {
      const attendus = ['', 'border-gradient', 'border-gradient', 'border-gradient', 'border-gradient', 'border', 'border-run', 'border-gradient']
      assert.deepEqual(await page.evaluate('__calques()'), attendus, 'les calques au départ')
      await page.evaluate(`(async () => { for (const c of ['ens', 'onde', 'trait']) for (let i = 0; i < 30; i++) { __B(c).textContent = c + ' ' + i; await null } })()`)
      await page.waitForFunction(`JSON.stringify(__calques()) === ${JSON.stringify(JSON.stringify(attendus))}`, null, { timeout: 3000 }).catch(() => {})
      assert.deepEqual(await page.evaluate('__calques()'), attendus, 'les calques après les 30 réécritures')
      assert.deepEqual(await page.evaluate(`['ens', 'onde', 'trait'].map((c) => __B(c).textContent)`), ['ens 29', 'onde 29', 'trait 29'], 'le contenu reste celui que le script a écrit')
    })
  })
})
