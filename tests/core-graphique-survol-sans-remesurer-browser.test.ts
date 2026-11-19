// module cœur <@@chart> dans Chromium, Firefox et WebKit réels, en développement et en production : survoler un graphique (200 jours, deux
// séries) ne remesure aucune étiquette et ne récrit aucune date — dix colonnes survolées : aucun `measureText`, aucun format de date. Une
// police qui finit de charger après le tracé (servie par le test, en retard) fait oublier les largeurs gardées, comme une police ajoutée déjà chargée (`document.fonts.add`) : le survol suivant mesure de
// nouveau, dans la police arrivée, puis le graphique garde ses nouvelles largeurs

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, lancer, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

// une police du système, servie à la page en @font-face
const POLICE = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

const jours = Array.from({ length: 200 }, (_, i) => ({ x: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), v: (i * 7) % 13, w: (i * 5) % 11 }))
const PAGE  = `<script>
  $jours = JSON.parse(${JSON.stringify(JSON.stringify(jours))})
  $deux  = [{ key: 'v', name: 'V' }, { key: 'w', name: 'W' }]
</script>
<@@chart class="survol" rows={$jours} series={$deux}></@@chart>
<style>
  :host
    display: block
    width: 700px
    font-family: Tardive, sans-serif
</style>
`

// les mesures de texte et les formats de date, comptés depuis le début de la page
const AIDES = `window.__name = function (f) { return f }
window.__g = () => document.querySelector('mjs-sv-page')?._shadow?.querySelector('mjs-core-chart.survol')
window.__c = { mt: 0, fmt: 0 }
{ const p = CanvasRenderingContext2D.prototype, mt = p.measureText; p.measureText = function () { __c.mt++; return mt.apply(this, arguments) }
  const d = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format'); Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get() { __c.fmt++; return d.get.call(this) } }) }`

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-survol-mesures', { 'sv-page.mjs': PAGE }, prod))

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> le survol ne remesure pas (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    await bati(prod)
    browser = await lancer(nom)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  // une page neuve, le graphique tracé ; la police Tardive, demandée quand la page la déclare (cf. `declarer`), servie quand `donner` est
  // appelée
  const ouvrir = async () => {
    const built = await bati(prod)
    const ctx   = await browser.newContext({ viewport: { width: 900, height: 700 } })
    const page  = await ctx.newPage()
    const erreurs: string[] = []
    let donner   = () => {}
    let demandee = false
    const servie = new Promise<void>((ok) => { donner = ok })
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript(AIDES)
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://sv.test/**', async (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-sv-page></mjs-sv-page>${charge}</body></html>` })
      if (chemin === '/tardive.ttf') {
        demandee = true
        await servie
        return route.fulfill({ contentType: 'font/ttf', body: readFileSync(POLICE) })
      }
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://sv.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(window as any).__g?.()?._shadow?.querySelector('.hit'), null, { timeout: 30000 })
    await page.waitForTimeout(300)
    const zone: any = await page.evaluate(`(() => { const r = __g()._shadow.querySelector('.hit').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
    // survole la colonne au point `f` (de 0 à 1) du tracé, puis laisse le graphique se redessiner
    const survoler = async (f: number) => {
      await page.mouse.move(zone.x + zone.w * f, zone.y + zone.h / 2)
      await page.waitForTimeout(60)
    }
    const comptes = () => page.evaluate('Object.assign({}, __c)') as Promise<{ mt: number, fmt: number }>
    // la page déclare la police Tardive, que le texte du graphique demande aussitôt ; rendue quand la demande est partie
    const declarer = async () => {
      await page.evaluate(`document.head.insertAdjacentHTML('beforeend', '<style>@font-face { font-family: Tardive; src: url(/tardive.ttf) format("truetype") }</style>')`)
      for (let i = 0; i < 100 && !demandee; i++) await page.waitForTimeout(100)
      assert.ok(demandee, 'la police est demandée')
    }
    return { ctx, page, erreurs, survoler, comptes, donner, declarer }
  }

  it('dix colonnes survolées : aucune mesure de texte, aucun format de date', async () => {
    const { ctx, page, erreurs, survoler, comptes } = await ouvrir()
    await survoler(0.01)
    await page.waitForTimeout(150)
    const c0 = await comptes()
    for (let k = 1; k <= 10; k++) await survoler(k / 11)
    const c1  = await comptes()
    const tip = await page.evaluate(`__g()._shadow.querySelector('.tip b')?.textContent ?? ''`)
    assert.deepEqual({ mesures: c1.mt - c0.mt, formats: c1.fmt - c0.fmt }, { mesures: 0, formats: 0 }, 'dix colonnes survolées')
    assert.ok(tip !== '', 'la bulle suit le survol')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('une police qui finit de charger après le tracé : le survol suivant mesure de nouveau, puis garde ses largeurs', async function () {
    if (!existsSync(POLICE)) this.skip()
    const { ctx, page, erreurs, survoler, comptes, donner, declarer } = await ouvrir()
    await survoler(0.01)
    await page.waitForTimeout(150)
    await declarer()
    const c0 = await comptes()
    for (let k = 1; k <= 3; k++) await survoler(k / 11)
    const c1 = await comptes()
    assert.equal(c1.mt - c0.mt, 0, 'police en route : les largeurs gardées servent')
    // la police arrive ; la page la tient (`check`) et `ready` est tenu
    donner()
    await page.waitForFunction(() => document.fonts.check('12px Tardive'), null, { timeout: 30000 })
    await page.evaluate('document.fonts.ready.then(() => true)')
    await page.waitForTimeout(150)
    const c2 = await comptes()
    await survoler(5 / 11)
    const c3 = await comptes()
    await survoler(7 / 11)
    const c4 = await comptes()
    assert.ok(c3.mt - c2.mt > 0, `police arrivée : le survol suivant mesure de nouveau (${c3.mt - c2.mt} mesures)`)
    assert.equal(c4.mt - c3.mt, 0, 'puis le graphique garde ses nouvelles largeurs')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('une police ajoutée déjà chargée (`document.fonts.add`, aucun événement de chargement) : le survol suivant mesure de nouveau', async function () {
    if (!existsSync(POLICE)) this.skip()
    const { ctx, page, erreurs, survoler, comptes, donner } = await ouvrir()
    await survoler(0.01)
    await page.waitForTimeout(150)
    // la police se charge hors de la page, puis y est ajoutée : `document.fonts` n'émet ni `loading` ni `loadingdone`
    donner()
    await page.evaluate(`(async () => { const f = new FontFace('Tardive', 'url(/tardive.ttf)'); await f.load(); document.fonts.add(f) })()`)
    await page.waitForTimeout(150)
    const c0 = await comptes()
    await survoler(5 / 11)
    const c1 = await comptes()
    await survoler(7 / 11)
    const c2 = await comptes()
    assert.ok(c1.mt - c0.mt > 0, `police ajoutée : le survol suivant mesure de nouveau (${c1.mt - c0.mt} mesures)`)
    assert.equal(c2.mt - c1.mt, 0, 'puis le graphique garde ses nouvelles largeurs')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
