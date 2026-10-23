// Rideau de transition sur la page d'un lien dont le contenant est `<body>` (réponse HTML sans `X-MJS-Target`) : la
// permutation remplace tout le contenu de `<body>`, le calque du rideau ne doit pas partir avec. Il couvre, la page
// change dessous, il se révèle, puis il s'en va — avec ou sans l'API View Transitions (un rideau est du vrai DOM, il
// joue avant elle).
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

// relève l'état de l'écran à chaque trame : calque du rideau absent (`-`), en couverture (`R`) ou en révélation (`V`),
// puis la page affichée (`A`, `B`, texte de `<body>` hors des `<script>`) ; seuls les changements sont gardés
const SONDE = `(() => {
  window.__etats = []
  const lire = () => {
    const calque = document.getElementById('mjs-vt-curtain')
    const texte = Array.from(document.body ? document.body.children : []).filter((n) => n.tagName !== 'SCRIPT').map((n) => n.textContent).join(' ')
    const ecran = /PAGE B/.test(texte) ? 'B' : /PAGE A/.test(texte) ? 'A' : '?'
    return (!calque ? '-' : /reveal/.test(calque.className) ? 'V' : 'R') + ecran
  }
  const tour = () => {
    const s = lire()
    if (s !== window.__etats[window.__etats.length - 1]) window.__etats.push(s)
    requestAnimationFrame(tour)
  }
  requestAnimationFrame(tour)
})()`
const SANS_API = `delete Document.prototype.startViewTransition; delete document.startViewTransition;`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`rideau de page, contenant <body> (${nom} réel)`, function () {
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
    const root   = mjsTmp('rideau-page-body')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vide.mjs'), '<p>vide</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const page   = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>`
    pages = {
      '/a': page('<p>PAGE A</p><a id="l" href="/b">vers B</a>'),
      // la page reçue n'a pas besoin du code : tout le contenu de son <body> est permuté, un <script> y serait signalé
      '/b': '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><p>PAGE B</p></body></html>'
    }
    const playwright = await import('playwright')
    navigateur = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  // clic sur le lien de la page A sous le rideau `valeur` (µ.viewTransition), réponse sans `X-MJS-Target` ; rend la
  // suite des états de l'écran, ce qui reste du rideau à la fin, les erreurs ; `api` faux : l'API View Transitions est
  // retirée avant le démarrage de la page
  async function jouer(valeur: string, api: boolean) {
    const contexte = await navigateur.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: 'no-preference' })
    const erreurs: string[] = []
    try {
      const page = await contexte.newPage()
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      if (!api) await page.addInitScript(SANS_API)
      await page.addInitScript(SONDE)
      await page.route(`${ORIGINE}/**`, (route: any) => {
        const html = pages[new URL(route.request().url()).pathname]
        if (!html) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'absent' })
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      })
      await page.goto(`${ORIGINE}/a`)
      await page.waitForFunction(() => (window as any).__etats.slice(-1)[0] === '-A', null, { timeout: 10000 })
      const avecApi = await page.evaluate((v: string) => {
        const w: any = window
        w.µ.viewTransition = v
        w.__etats = ['-A']
        return typeof document.startViewTransition === 'function'
      }, valeur)
      assert.equal(avecApi, api, api ? 'l\'API doit être là' : 'l\'API doit être retirée')
      await page.click('#l')
      await page.waitForFunction(() => /B$/.test((window as any).__etats.slice(-1)[0]), null, { timeout: 5000 })
      await page.waitForTimeout(900)
      const r = await page.evaluate(() => ({
        etats:  (window as any).__etats.slice(),
        calque: !!document.getElementById('mjs-vt-curtain'),
        css:    !!document.getElementById('mjs-vt-curtain-css')
      }))
      return { ...r, erreurs }
    }
    finally { await contexte.close() }
  }

  for (const api of [false, true]) {
    it(`iris ${api ? 'avec' : 'sans'} l'API : le calque couvre, la page change dessous, il se révèle puis s'en va`, async function () {
      if (!present) { this.skip(); return }
      if (api) {
        const c = await navigateur.newContext()
        let natif = false
        try { natif = await (await c.newPage()).evaluate(() => typeof document.startViewTransition === 'function') }
        finally { await c.close() }
        if (!natif) { this.skip(); return }
      }
      const r = await jouer('iris', api)
      // la trame où la page vient de changer sous le noir, avant la révélation (`RB`), peut ne pas être relevée
      assert.deepEqual(r.etats.filter((s: string) => s !== 'RB'), ['-A', 'RA', 'VB', '-B'], 'AVANT : [-A, RA, -B], le calque part avec le contenu de <body> à la permutation, la révélation saute — relevé : ' + r.etats.join(' '))
      assert.equal(r.calque, false, 'calque retiré à la fin de la révélation')
      assert.equal(r.css, false, 'feuille du rideau retirée')
      assert.deepEqual(r.erreurs, [])
    })
  }
})
