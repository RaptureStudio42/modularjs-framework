// module cœur <@@chart> : un fuseau (`timezone`) venu d'une variable qui porte le nom d'un champ que tout objet hérite (« constructor »,
// « toString », « valueOf », « __proto__ ») est une zone inconnue comme les autres : le graphique est tracé et ses heures restent telles
// qu'écrites, dans Chromium, Firefox et WebKit réels (développement et production) comme au rendu serveur, où la page est servie

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { construire, navigateurPresent, lancer, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const NOMS = ['constructor', 'toString', 'valueOf', '__proto__']

// une page dont chaque graphique reçoit son fuseau d'une variable ; deux instants écrits à -07:00 : tels qu'écrits, 8 h 15 et 9 h 45 (à
// Paris, 17 h 15 et 18 h 45)
const pageDe = (noms: string[]) => `<script>
  $instants = [{ id: 'a', x: '2026-10-19T08:15:00-07:00', v: 2 }, { id: 'b', x: '2026-10-19T09:45:00-07:00', v: 5 }]
  $une      = [{ key: 'v', name: 'Valeur' }]
${noms.map((n, i) => `  $z${i}       = '${n}'`).join('\n')}
</script>
${noms.map((_, i) => `<@@chart class="z${i}" rows={$instants} series={$une} axis="datetime" timezone={$z${i}}></@@chart>`).join('\n')}
<style>
  :host
    display: block
    width: 700px
</style>
`
const ECRITES = ['19 08:15', '19 09:45']
const attendu = (quoi: object) => Object.fromEntries(NOMS.map((n) => [n, quoi]))

// le jour et l'heure d'un texte (« 19 oct. 2026, 08:15 » → « 19 08:15 »), quelle que soit la façon d'écrire du moteur
const heure = (s: string) => {
  const j = /(?:^|\D)(\d{1,2})(?=\D|$)/.exec(s)
  const h = /(\d{2}):(\d{2})/.exec(s)
  return [j ? j[1] : '?', h ? h[1] + ':' + h[2] : ''].filter(Boolean).join(' ')
}

// ce que chaque graphique écrit : son tracé, les lignes de son tableau des valeurs
const LECTURE = `(() => { const h = document.querySelector('mjs-zp-page')._shadow; const out = []; for (const c of ['z0', 'z1', 'z2', 'z3']) { const s = h.querySelector('mjs-core-chart.' + c)?._shadow; out.push(s ? { chart: !!s.querySelector('.chart'), lignes: [...s.querySelectorAll('tbody th')].map((t) => t.textContent), traces: s.querySelectorAll('path.line').length } : null) } return out })()`

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-fuseau-champ-d-objet', { 'zp-page.mjs': pageDe(NOMS) }, prod))

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> un fuseau nommé comme un champ d'objet (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  it('« constructor », « toString », « valueOf », « __proto__ » : le graphique est tracé, ses heures telles qu\'écrites', async () => {
    const built = await bati(prod)
    const ctx   = await browser.newContext({ viewport: { width: 900, height: 900 } })
    const page  = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://zp.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-zp-page></mjs-zp-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://zp.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const h = (document.querySelector('mjs-zp-page') as any)?._shadow; const c = h?.querySelectorAll('mjs-core-chart'); return !!c && c.length === 4 && [...c].every((x: any) => !!x._shadow) }, null, { timeout: 30000 })
    await page.waitForTimeout(400)
    const lu: any[] = await page.evaluate(LECTURE)
    const vu = Object.fromEntries(NOMS.map((n, i) => [n, { chart: lu[i]?.chart, lignes: lu[i]?.lignes.map(heure), traces: lu[i]?.traces }]))
    assert.deepEqual(vu, attendu({ chart: true, lignes: ECRITES, traces: 1 }))
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})

describe('<@@chart> un fuseau nommé comme un champ d\'objet, au rendu serveur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque page est servie, son graphique tracé aux heures telles qu\'écrites', async () => {
    // une page par nom : un rendu en échec n'emporte pas les autres
    const root = mjsTmp('graphique-fuseau-champ-d-objet-serveur')
    const tags = ['za', 'zb', 'zc', 'zd']
    mkdirSync(join(root, 'src'), { recursive: true })
    NOMS.forEach((n, i) => writeFileSync(join(root, 'src', tags[i] + '-page.mjs'), pageDe([n])))
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    // `Object.fromEntries` : une clé « __proto__ » posée par `vu[n] = …` changerait le prototype de l'objet au lieu d'être une clé
    const vu: Array<[string, any]> = []
    try {
      for (const [i, n] of NOMS.entries()) {
        try {
          const { html } = await renderer.renderToString(`mjs-${tags[i]}-page`, { ssrMode: 'markers' } as any)
          const heures = [...html.matchAll(/>([^<>]*\d{2}:\d{2}[^<>]*)</g)].map((m) => heure(m[1]))
          vu.push([n, { servi: html.includes('class="chart'), heures: [...new Set(heures)].sort() }])
        }
        catch (e) {
          vu.push([n, { servi: false, erreur: String(e).slice(0, 120) }])
        }
      }
    }
    finally {
      await renderer.close()
    }
    assert.deepEqual(Object.fromEntries(vu), attendu({ servi: true, heures: ECRITES }))
  })
})
