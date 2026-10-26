// module cœur <@@chart> : toutes ses couleurs se règlent par des variables de thème propres, `$$chart-<réglage>` — la grille, les axes, les
// textes, le fond, le texte et le bord de la bulle, le trait de chaque statistique, la case vide, la teinte neutre — en plus des six
// teintes. Réglées par les thèmes du document (`light.theme.mjs`, `dark.theme.mjs`), par le <theme> d'un composant, par le <style> d'une
// page, en thème clair et en thème sombre, chacune repeint sa pièce. Sans réglage, chaque pièce garde la couleur d'avant, tirée des
// variables générales du thème (`$$border`, `$$fg-muted`, `$$surface`, `$$fg`) ou de la teinte de la série. Dans Chromium, Firefox et
// WebKit réels, en développement et en production.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const NOMS = ['grid', 'axis', 'text', 'tip-bg', 'tip-fg', 'tip-border', 'stat-mean', 'stat-median', 'stat-q1', 'stat-q3', 'stat-trend', 'empty', 'neutral']
const jeu = (base: number) => Object.fromEntries(NOMS.map((n, i) => [n, `rgb(${base}, ${i + 1}, ${100 + i})`])) as Record<string, string>
const CLAIR = jeu(11)
const SOMBRE = jeu(22)
const BLOC = jeu(33)
const STYLE = jeu(44)
const declarations = (valeurs: Record<string, string>, retrait: string) => NOMS.map((n) => `${retrait}$$chart-${n}: ${valeurs[n]}`).join('\n')

const DONNEES = `<script>
  $lignes = [{ x: '2026-10-01', v: 2 }, { x: '2026-10-02', v: 5 }, { x: '2026-10-03', v: 3 }, { x: '2026-10-04', v: 6 }, { x: '2026-10-05', v: 4 }]
  $une    = [{ key: 'v', name: 'Valeur' }]
  $villes = [{ x: 'Anvers', v: 3, w: 7 }, { x: 'Bâle', v: 0, w: 2 }, { x: 'Cork', v: 10 }]
  $duo    = [{ key: 'v', name: 'Matin', unit: 'min' }, { key: 'w', name: 'Soir', unit: 'min' }]
  $profil = [{ x: 'Force', v: 80 }, { x: 'Souplesse', v: 50 }, { x: 'Endurance', v: 70 }, { x: 'Vitesse', v: 40 }]
</script>
`
// une courbe et ses statistiques (grille, axes, textes, bulle, traits), une carte à deux séries (case vide, teinte neutre de la légende),
// un radar (toile et rayons)
const TROIS = (p: string) => `<@@chart class="${p}-l" rows={$lignes} series={$une} stats="mean median q1 q3 trend"></@@chart>
<@@chart class="${p}-h" rows={$villes} series={$duo} shape="heatmap"></@@chart>
<@@chart class="${p}-r" rows={$profil} series={$une} shape="radar"></@@chart>
`

const SOURCES: Record<string, string> = {
  'light.theme.mjs': `<theme>\n${declarations(CLAIR, '  ')}\n</theme>\n`,
  'dark.theme.mjs': `<theme>\n${declarations(SOMBRE, '  ')}\n</theme>\n`,
  'gt-doc.mjs': DONNEES + TROIS('doc') + '<style>\n  :host\n    display: block\n</style>\n',
  'gt-page.mjs': DONNEES + `<theme>\n${declarations(BLOC, '  ')}\n</theme>\n\n` + TROIS('bloc') + `<div class="regle">\n${TROIS('style')}</div>\n<div class="nu">\n${TROIS('nu')}</div>\n` +
    `<style>\n  :host\n    display: block\n  .regle\n${declarations(STYLE, '    ')}\n  .nu\n${NOMS.map((n) => `    --mjs-chart-${n}: initial`).join('\n')}\n</style>\n`,
}

// chaque pièce et la variable qui la règle ; `defaut` : ce qu'elle lisait avant les variables propres (sans réglage, rien ne change)
const BORD = 'var(--mjs-border, color-mix(in srgb, currentColor 32%, transparent))'
const TEINTE = 'var(--mjs-chart-1, #3b82f6)'
const PIECES: { cle: string, nom: string, graphique: 'l' | 'h' | 'r', sel: string, prop: string, defaut: string }[] = [
  { cle: 'grille', nom: 'grid', graphique: 'l', sel: 'line.grid', prop: 'stroke', defaut: BORD },
  { cle: 'toile', nom: 'grid', graphique: 'r', sel: 'polygon.mesh', prop: 'stroke', defaut: BORD },
  { cle: 'axes', nom: 'axis', graphique: 'l', sel: '.plot', prop: 'border-left-color', defaut: BORD },
  { cle: 'rayons', nom: 'axis', graphique: 'r', sel: 'line.spoke', prop: 'stroke', defaut: BORD },
  { cle: 'graduation', nom: 'text', graphique: 'l', sel: 'text.ylabel', prop: 'fill', defaut: 'var(--mjs-fg-muted, currentColor)' },
  { cle: 'légende', nom: 'text', graphique: 'h', sel: '.ramp', prop: 'color', defaut: 'var(--mjs-fg-muted, currentColor)' },
  { cle: 'fond de bulle', nom: 'tip-bg', graphique: 'l', sel: '.tip', prop: 'background-color', defaut: 'var(--mjs-surface, Canvas)' },
  { cle: 'texte de bulle', nom: 'tip-fg', graphique: 'l', sel: '.tip', prop: 'color', defaut: 'var(--mjs-fg, CanvasText)' },
  { cle: 'bord de bulle', nom: 'tip-border', graphique: 'l', sel: '.tip', prop: 'border-top-color', defaut: 'var(--mjs-border, color-mix(in srgb, currentColor 22%, transparent))' },
  { cle: 'moyenne', nom: 'stat-mean', graphique: 'l', sel: 'svg.draw path.stat-mean', prop: 'stroke', defaut: TEINTE },
  { cle: 'médiane', nom: 'stat-median', graphique: 'l', sel: 'svg.draw path.stat-median', prop: 'stroke', defaut: TEINTE },
  { cle: 'premier quartile', nom: 'stat-q1', graphique: 'l', sel: 'svg.draw path.stat-q1', prop: 'stroke', defaut: TEINTE },
  { cle: 'troisième quartile', nom: 'stat-q3', graphique: 'l', sel: 'svg.draw path.stat-q3', prop: 'stroke', defaut: TEINTE },
  { cle: 'tendance', nom: 'stat-trend', graphique: 'l', sel: 'svg.draw path.stat-trend', prop: 'stroke', defaut: TEINTE },
  { cle: 'point suivant', nom: 'stat-trend', graphique: 'l', sel: '.plot circle.ghost', prop: 'stroke', defaut: TEINTE },
  { cle: 'case vide', nom: 'empty', graphique: 'h', sel: 'rect.cell.level-0', prop: 'fill', defaut: 'color-mix(in srgb, currentColor 12%, transparent)' },
  { cle: 'teinte neutre', nom: 'neutral', graphique: 'h', sel: '.ramp .swatch.tone-0', prop: 'background-color', defaut: 'currentColor' },
]

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-couleurs', SOURCES, prod))

// la couleur calculée de chaque pièce des graphiques `p-l`, `p-h`, `p-r` de l'hôte `hote`, et celle de son ancienne lecture, prise par
// une sonde posée au même endroit (même couleur du texte, mêmes variables héritées)
const lire = (page: any, hote: string, p: string) => page.evaluate(([hote, p, pieces]: any) => {
  const h = (document.querySelector(hote) as any)._shadow
  const out: Record<string, { vu: string | null, avant: string | null }> = {}
  for (const x of pieces) {
    const piece = h.querySelector(`mjs-core-chart.${p}-${x.graphique}`)._shadow.querySelector(x.sel)
    if (!piece) { out[x.cle] = { vu: null, avant: null }; continue }
    let lieu = piece.parentNode
    while (lieu && lieu.namespaceURI !== 'http://www.w3.org/1999/xhtml') lieu = lieu.parentNode
    const sonde = document.createElement('span')
    sonde.style.color = x.defaut
    lieu.appendChild(sonde)
    out[x.cle] = { vu: getComputedStyle(piece).getPropertyValue(x.prop), avant: getComputedStyle(sonde).color }
    sonde.remove()
  }
  return out
}, [hote, p, PIECES])

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> couleurs réglables (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }
  let themes = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
    // en développement, la page charge les fichiers sans le manifeste : sa ligne des thèmes du document se rejoue après le cœur
    if (!prod) themes = readFileSync(join(built.root, 'bundle.js'), 'utf-8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('µ._themeCss')).join('\n')
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  for (const sombre of [false, true]) it(`thème ${sombre ? 'sombre' : 'clair'} : chaque variable repeint sa pièce, depuis un thème du document, un <theme> de composant, un <style> de page ; sans réglage, rien ne change`, async () => {
    assert.ok(prod || themes !== '', 'le manifeste pose les thèmes du document')
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}\n${themes}</script>`
    const fond   = sombre ? 'background:#232936;color:#e8eaed' : 'background:#ffffff;color:#222222'
    await page.route('http://k.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"${sombre ? ' data-mjs-theme="dark"' : ''}><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif;${fond}"><mjs-gt-doc></mjs-gt-doc><mjs-gt-page></mjs-gt-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://k.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => ['mjs-gt-doc', 'mjs-gt-page'].every((t) => { const c = (document.querySelector(t) as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length > 0 && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }), null, { timeout: 15000 })
    await page.waitForTimeout(250)
    const vus: Record<string, Record<string, { vu: string | null, avant: string | null }>> = {}
    for (const [hote, p] of [['mjs-gt-doc', 'doc'], ['mjs-gt-page', 'bloc'], ['mjs-gt-page', 'style'], ['mjs-gt-page', 'nu']]) {
      // la bulle s'ouvre au survol de la courbe
      const c = await page.evaluate(([hote, p]: any) => { const n = (document.querySelector(hote) as any)._shadow.querySelector(`mjs-core-chart.${p}-l`)._shadow.querySelector('.hit'); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, [hote, p])
      await page.mouse.move(c.x, c.y)
      await page.waitForTimeout(150)
      vus[p] = await lire(page, hote, p)
    }
    const attendus: Record<string, Record<string, string>> = { doc: sombre ? SOMBRE : CLAIR, bloc: BLOC, style: STYLE }
    const fautes: string[] = []
    for (const p of ['doc', 'bloc', 'style']) for (const x of PIECES) if (vus[p][x.cle].vu !== attendus[p][x.nom]) fautes.push(`${p} · ${x.cle} ($$chart-${x.nom}) : ${vus[p][x.cle].vu} au lieu de ${attendus[p][x.nom]}`)
    for (const x of PIECES) if (vus.nu[x.cle].vu === null || vus.nu[x.cle].vu !== vus.nu[x.cle].avant) fautes.push(`sans réglage · ${x.cle} : ${vus.nu[x.cle].vu} au lieu de ${vus.nu[x.cle].avant}`)
    assert.deepEqual(fautes, [])
    assert.equal(vus.nu['grille'].vu, sombre ? 'rgb(58, 65, 80)' : 'rgb(208, 208, 208)', 'sans réglage, la grille suit la bordure du thème')
    assert.equal(vus.nu['fond de bulle'].vu, sombre ? 'rgb(35, 41, 54)' : 'rgb(255, 255, 255)', 'sans réglage, la bulle suit la surface du thème')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
