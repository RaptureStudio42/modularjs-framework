// module cœur <@@chart>, dans Chromium, Firefox et WebKit réels, en développement et en production. Une série écrite `axis: 'right'`
// prend sa propre échelle : ses graduations se posent à droite du tracé, dans une gouttière qui les garde entières, l'axe de droite se
// dessine, et les points allumés de la bulle se posent chacun sur son échelle. `bridge` relie le trait par-dessus une case vide. Deux
// variables de thème : `$$chart-grid-opacity` règle l'opacité de la grille (0,5 sans réglage), `$$chart-tip-title` la couleur du titre de
// la bulle (sans réglage, celle du texte de la bulle)

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'gx-page.mjs': `<script>
  $trou  = [{ x: 'a', v: 1 }, { x: 'b' }, { x: 'c', v: 3 }, { x: 'd', v: 2 }]
  $une   = [{ key: 'v', name: 'Valeur' }]
  $meteo = [{ x: '2026-10-01', t: 100, p: 3 }, { x: '2026-10-02', t: 150, p: 2 }, { x: '2026-10-03', t: 200, p: 1 }]
  $deux  = [{ key: 't', name: 'Poids', unit: 'kg' }, { key: 'p', name: 'Pluie', unit: 'mm', axis: 'right' }]
</script>
<@@chart class="deux" rows={$meteo} series={$deux}></@@chart>
<@@chart class="coupe" rows={$trou} series={$une}></@@chart>
<@@chart class="relie" rows={$trou} series={$une} bridge></@@chart>
<div class="reglee">
  <@@chart class="regle" rows={$trou} series={$une}></@@chart>
</div>

<style>
  :host
    display: block
  .reglee
    $$chart-grid-opacity: .2
    $$chart-tip-title: rgb(1, 2, 3)
</style>
`,
}

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-deux-echelles', SOURCES, prod))

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> deux échelles, bridge, opacité de la grille et titre de la bulle (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('graduations de droite entières dans leur gouttière, points de la bulle sur leur échelle, trait relié, variables de thème', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 1400 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://k.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif;background:#fff;color:#222"><mjs-gx-page></mjs-gx-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://k.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const c = (document.querySelector('mjs-gx-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === 4 && [...c].every((x: any) => x._shadow?.querySelector('.chart text.ylabel')) })
    await page.waitForTimeout(300)
    const graphique = (c: string) => `(document.querySelector('mjs-gx-page'))._shadow.querySelector('mjs-core-chart.${c}')._shadow`

    const vu = await page.evaluate((g: string[]) => {
      const [deux, coupe, relie, regle] = g.map((s) => eval(s))
      const boite = (n: any) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }
      return {
        plot: boite(deux.querySelector('.plot')),
        frame: boite(deux.querySelector('.frame')),
        hote: boite(deux.host),
        droite: [...deux.querySelectorAll('text.ylabel.right')].map((t: any) => Object.assign(boite(t), { text: t.textContent })),
        gauche: [...deux.querySelectorAll('text.ylabel:not(.right)')].map((t: any) => Object.assign(boite(t), { text: t.textContent })),
        bord: getComputedStyle(deux.querySelector('.plot')).borderRightWidth,
        bordSeul: getComputedStyle(coupe.querySelector('.plot')).borderRightWidth,
        relie: relie.querySelector('path.line').getTotalLength(),
        coupe: coupe.querySelector('path.line').getTotalLength(),
        grille: getComputedStyle(coupe.querySelector('line.grid')).strokeOpacity,
        grilleReglee: getComputedStyle(regle.querySelector('line.grid')).strokeOpacity,
      }
    }, ['deux', 'coupe', 'relie', 'regle'].map(graphique))

    assert.ok(vu.droite.length >= 3, `graduations de droite : ${JSON.stringify(vu.droite)}`)
    assert.match(vu.droite[vu.droite.length - 1].text, /^3 mm$/)
    assert.match(vu.gauche[vu.gauche.length - 1].text, /^200 kg$/)
    for (const t of vu.droite) {
      assert.ok(t.l >= vu.plot.r + 4, `« ${t.text} » à droite du tracé : ${t.l} / ${vu.plot.r}`)
      assert.ok(t.r <= vu.frame.r + 0.5 && t.r <= vu.hote.r + 0.5, `« ${t.text} » entière dans le graphique : ${t.r} / ${vu.frame.r}`)
    }
    for (const t of vu.gauche) assert.ok(t.r <= vu.plot.l && t.l >= vu.hote.l - 0.5, `« ${t.text} » dans la gouttière de gauche`)
    assert.equal(vu.bord, '1px', 'l\'axe de droite se dessine')
    assert.equal(vu.bordSeul, '0px', 'sans série à droite, pas d\'axe de droite')
    assert.ok(vu.relie > vu.coupe + 300, `le trait relié passe par-dessus la case vide : ${vu.relie} contre ${vu.coupe}`)
    assert.equal(Number(vu.grille), 0.5, 'sans réglage, la grille garde son opacité')
    assert.equal(Number(vu.grilleReglee), 0.2, '$$chart-grid-opacity règle la grille')

    // la bulle de la première colonne : le poids (100) en bas de son échelle, la pluie (3) en haut de la sienne
    const survoler = async (c: string) => {
      const p = await page.evaluate((s: string) => { const n = eval(s).querySelector('.hit'); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + 3, y: r.top + r.height / 2 } }, graphique(c))
      await page.mouse.move(p.x, p.y)
      await page.waitForFunction((s: string) => !!eval(s).querySelector('.tip b'), graphique(c))
      await page.waitForTimeout(150)
    }
    await survoler('deux')
    const marques = await page.evaluate((s: string) => { const g = eval(s); const plot = g.querySelector('.plot').getBoundingClientRect(); return { haut: plot.top, bas: plot.bottom, y: [...g.querySelectorAll('circle.mark')].map((m: any) => { const r = m.getBoundingClientRect(); return r.top + r.height / 2 }) } }, graphique('deux'))
    assert.equal(marques.y.length, 2)
    assert.ok(Math.abs(marques.y[0] - marques.bas) < 2, `le poids en bas : ${JSON.stringify(marques)}`)
    assert.ok(Math.abs(marques.y[1] - marques.haut) < 2, `la pluie en haut de son échelle : ${JSON.stringify(marques)}`)

    await survoler('coupe')
    const nu = await page.evaluate((s: string) => { const g = eval(s); return { titre: getComputedStyle(g.querySelector('.tip b')).color, bulle: getComputedStyle(g.querySelector('.tip')).color } }, graphique('coupe'))
    assert.equal(nu.titre, nu.bulle, 'sans réglage, le titre garde la couleur du texte de la bulle')
    await survoler('regle')
    const regle = await page.evaluate((s: string) => getComputedStyle(eval(s).querySelector('.tip b')).color, graphique('regle'))
    assert.equal(regle, 'rgb(1, 2, 3)', '$$chart-tip-title colore le titre de la bulle')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
