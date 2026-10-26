// module cœur <@@chart> : la barre d'outils écrit les props elles-mêmes, comme <@@select> écrit `value`. Un attribut écrit en dur
// (`shape="line"`, `stats="mean"`) ne donne aucun avertissement de développement ; une liaison à deux sens (`shape=!{$s}`, `stats=!{$x}`)
// non plus, et le parent suit le choix ; rien en production. Dans Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $lignes = [{ x: '2026-10-01', v: 2 }, { x: '2026-10-02', v: 4 }, { x: '2026-10-03', v: 3 }]
  $series = [{ key: 'v', name: 'Valeur' }]
  $forme  = 'line'
  $stats  = ''
</script>

<@@chart class="c1" rows={$lignes} series={$series} toolbar="shapes stats" shape="line" stats="mean"></@@chart>
<@@chart class="c2" rows={$lignes} series={$series} toolbar="shapes stats" shape=!{$forme} stats=!{$stats}></@@chart>
<p class="echo">{$forme}|{$stats}</p>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'gl-page.mjs': PAGE }

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-barre-liaisons', SOURCES, prod))

const q = (v: string) => JSON.stringify(v)
const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gl-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)

async function cliquer(page: any, c: string, s: string, texte = '') {
  const p = await lire(page, `const n = [...g(${q(c)}).querySelectorAll(${q(s)})].find((x) => !${q(texte)} || x.textContent.trim() === ${q(texte)}); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`)
  assert.ok(p, `${c} : ${s} ${texte} absent`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(150)
}

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> barre d'outils : attribut en dur et liaison à deux sens (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  it('attribut en dur : aucun avertissement ; !{…} : aucun avertissement, le parent suit', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const sortie: string[] = []
    const plantages: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') sortie.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://l.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><mjs-gl-page></mjs-gl-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://l.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const c = (document.querySelector('mjs-gl-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === 2 && [...c].every((x: any) => x._shadow?.querySelector('.tools')) }, null, { timeout: 15000 }).catch(() => { throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur'} / console : ${sortie.join(' | ')}`) })
    for (const c of ['c1', 'c2']) {
      await cliquer(page, c, 'button.pick')
      await cliquer(page, c, '[role="menuitemradio"]', 'Barres')
      await cliquer(page, c, '[aria-label="Statistiques"] label', 'Médiane')
    }
    await page.waitForTimeout(200)
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'bar|median', 'à deux sens, le parent suit la forme et les statistiques')
    assert.equal(await lire(page, `return g('c1').querySelectorAll('rect.bar').length`), 3, 'en dur, le choix vaut dans le graphique')
    assert.equal(await lire(page, `return g('c1').querySelectorAll('svg.draw path.stat').length`), 2, 'la moyenne écrite, la médiane cochée')
    assert.deepEqual(sortie, [], 'aucun avertissement, aucune erreur')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
