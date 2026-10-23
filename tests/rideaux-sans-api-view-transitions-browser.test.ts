// Rideaux de transition (`iris`, `swipe`, `bars`, `blocks`) sur un navigateur sans l'API View Transitions : ce sont de
// vrais éléments DOM, ils jouent partout — le calque couvre, la page change dessous, puis il s'en va. Les préréglages
// qui reposent sur l'API (`slide`, `cube`, fondu natif…) gardent leur repli : permutation directe, silencieuse.
// « Réduire les animations » arrête tout, comme avant. Deux chemins : la permutation des vues du routeur (`<@view>`)
// et la permutation de page d'un lien (navigation UJS, contenant désigné par `X-MJS-Target`).
// Navigateur sans l'API simulé en retirant `document.startViewTransition` avant le démarrage de la page.
// Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ORIGINE = 'http://mjs.test'

// relève l'état de l'écran à chaque trame : `R` calque de rideau présent (`-` sinon), puis la page ou la vue
// affichée (`A`, `B`) : texte de la page hors des `<script>` (le code compilé des vues porte leur texte), balise de la
// vue montée dans `<@view>` ; seuls les changements sont gardés. Note aussi chaque pose de `html[data-mjs-vt]`
const SONDE = `(() => {
  window.__etats = []
  window.__attr = []
  const lire = () => {
    const shell = document.querySelector('mjs-shell')
    const vue = shell && shell._shadow ? shell._shadow.querySelector('metamjs-view') : null
    const texte = Array.from(document.body ? document.body.children : []).filter((n) => n.tagName !== 'SCRIPT').map((n) => n.textContent).join(' ') + ' ' + (vue && vue.firstElementChild ? vue.firstElementChild.tagName : '')
    const ecran = /PAGE B|MJS-VUE-B/.test(texte) ? 'B' : /PAGE A|MJS-VUE-A/.test(texte) ? 'A' : '?'
    return (document.getElementById('mjs-vt-curtain') ? 'R' : '-') + ecran
  }
  const tour = () => {
    const s = lire()
    if (s !== window.__etats[window.__etats.length - 1]) window.__etats.push(s)
    requestAnimationFrame(tour)
  }
  requestAnimationFrame(tour)
  new MutationObserver((ms) => { for (const m of ms) window.__attr.push(String(m.target.getAttribute('data-mjs-vt'))) }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-mjs-vt'] })
})()`
const SANS_API = `delete Document.prototype.startViewTransition; delete document.startViewTransition;`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`rideaux de transition sans l'API View Transitions (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let navigateur: any
  let pages: Record<string, string> = {}

  before(async () => {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log('  ℹ️  ' + nom + ' non installé, test sauté. Activer : `npx playwright install ' + nom + '`')
      return
    }
    const root   = mjsTmp('rideaux-sans-api')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'shell.page.mjs'), '<routes target="app-view">\n/a  vue-a\n/b  vue-b\n</routes>\n<@view app-view>\n')
    writeFileSync(join(srcDir, 'vue-a.mjs'), '<p class="va">VUE A</p>\n')
    writeFileSync(join(srcDir, 'vue-b.mjs'), '<p class="vb">VUE B</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const page   = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>`
    pages = {
      '/vues': page('<mjs-shell></mjs-shell>'),
      '/a':    page('<div id="contenu"><p>PAGE A</p><a id="l" href="/b">vers B</a></div>'),
      '/b':    page('<div id="contenu"><p>PAGE B</p></div>')
    }
    const playwright = await import('playwright')
    navigateur = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  // joue une navigation sous `valeur` (µ.viewTransition) et rend la suite des états de l'écran ; `chemin` 'vues' =
  // permutation des vues du routeur, 'page' = clic sur un lien vers une autre page
  async function jouer(chemin: 'vues' | 'page', valeur: string | boolean, opts: { api?: boolean, reduire?: boolean } = {}) {
    const contexte = await navigateur.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: opts.reduire ? 'reduce' : 'no-preference' })
    const erreurs: string[] = []
    try {
      const page = await contexte.newPage()
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && /ransition/.test(m.text())) erreurs.push(m.text()) })
      if (!opts.api) await page.addInitScript(SANS_API)
      await page.addInitScript(SONDE)
      await page.route(`${ORIGINE}/**`, (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        const html   = pages[chemin]
        if (!html) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'absent' })
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: chemin === '/b' ? { 'X-MJS-Target': '#contenu' } : {}, body: html })
      })
      await page.goto(chemin === 'vues' ? `${ORIGINE}/vues#/a` : `${ORIGINE}/a`)
      await page.waitForFunction(() => (window as any).__etats.slice(-1)[0] === '-A', null, { timeout: 10000 })
      const api = await page.evaluate((v: string | boolean) => {
        const w: any = window
        w.µ.viewTransition = v
        w.__etats = ['-A']
        w.__attr = []
        return typeof document.startViewTransition === 'function'
      }, valeur)
      assert.equal(api, !!opts.api, opts.api ? 'l\'API doit être là' : 'l\'API doit être retirée')
      if (chemin === 'vues') await page.evaluate(() => { (window as any).µ.Router.navigate('#/b') })
      else await page.click('#l')
      await page.waitForFunction(() => (window as any).__etats.slice(-1)[0] === '-B', null, { timeout: 5000 })
      await page.waitForTimeout(300)
      const r = await page.evaluate(() => ({ etats: (window as any).__etats.slice(), attr: (window as any).__attr.slice() }))
      return { ...r, erreurs }
    }
    finally { await contexte.close() }
  }

  for (const chemin of ['vues', 'page'] as const) {
    const ou = chemin === 'vues' ? 'vues du routeur' : 'page d\'un lien'
    for (const rideau of ['iris', 'bars={ dir: left }']) {
      it(`${ou}, ${rideau} sans l'API : le calque couvre, la page change dessous, puis il s'en va`, async function () {
        if (!present) { this.skip(); return }
        const r = await jouer(chemin, rideau)
        assert.deepEqual(r.etats, ['-A', 'RA', 'RB', '-B'], 'couvre (RA), permute sous le noir (RB), révèle et se retire (-B)')
        assert.deepEqual(r.attr, [], 'un rideau ne pose jamais html[data-mjs-vt]')
        assert.deepEqual(r.erreurs, [])
      })
    }

    it(`${ou}, iris sans l'API et « réduire les animations » : rien ne joue, permutation directe`, async function () {
      if (!present) { this.skip(); return }
      const r = await jouer(chemin, 'iris', { reduire: true })
      assert.deepEqual(r.etats, ['-A', '-B'])
      assert.deepEqual(r.erreurs, [])
    })

    it(`${ou}, préréglage natif (slide) sans l'API : permutation directe, silencieuse`, async function () {
      if (!present) { this.skip(); return }
      const r = await jouer(chemin, 'slide')
      assert.deepEqual(r.etats, ['-A', '-B'])
      assert.deepEqual(r.attr, [], 'aucun html[data-mjs-vt] sans l\'API')
      assert.deepEqual(r.erreurs, [], 'ni erreur ni avertissement')
    })

    it(`${ou}, fondu natif (true) sans l'API : permutation directe, silencieuse`, async function () {
      if (!present) { this.skip(); return }
      const r = await jouer(chemin, true)
      assert.deepEqual(r.etats, ['-A', '-B'])
      assert.deepEqual(r.attr, [])
      assert.deepEqual(r.erreurs, [])
    })
  }

  it('avec l\'API, iris sur les vues du routeur : le rideau joue toujours', async function () {
    if (!present) { this.skip(); return }
    const api = await (async () => {
      const c = await navigateur.newContext()
      try { const p = await c.newPage(); return await p.evaluate(() => typeof document.startViewTransition === 'function') }
      finally { await c.close() }
    })()
    if (!api) { this.skip(); return }
    const r = await jouer('vues', 'iris', { api: true })
    assert.deepEqual(r.etats, ['-A', 'RA', 'RB', '-B'])
    assert.deepEqual(r.erreurs, [])
  })
})
