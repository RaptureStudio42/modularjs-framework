// Page rendue par le serveur puis reprise dans un navigateur réel, en `markers` : les sous-composants (enfant, petit-enfant,
// module du cœur) sont repris comme leur parent, avec les nœuds du serveur, et non rebâtis. La page vient du moteur happy-dom du
// serveur (`renderToString`) comme du moteur navigateur du prérendu : les deux étiquettent chaque composant de l'arbre rendu.
// Avant le bundle, chaque élément écrit par le serveur (dans toutes les racines d'ombre, sous-composants compris) porte un
// tampon ; après la reprise, ils sont tous encore là, puis chaque écriture de l'état se retrouve à chaque niveau.
// En développement et en production (vrai build, un morceau par module), dans Chromium et Firefox.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const ENVS      = ['dev', 'prod'] as const
const VARIANTES = ['markers', 'markers (moteur navigateur)'] as const

const PETIT = `<script>
  $v = ''
</script>

<i class="pe">{$v}</i>
`

const ENFANT = `<script>
  $x = ''
</script>

<p class="e">{$x}</p>
<@im-petit v={$x}></@im-petit>
`

const PARENT = `<script>
  $n = 1
  @pose = (v) -> $n = v
</script>

<p class="t">Total {$n}</p>
<div class="liste"><@im-enfant x={$n}></@im-enfant><@im-enfant x="b"></@im-enfant></div>
<form class="f" @noUJS><@@checkbox class="cb" name="cb">case</@@checkbox></form>
<p class="fin">fin</p>
`

// le résumé du DOM à chaque niveau : le texte du parent, de chaque enfant et de son petit-enfant, le module du cœur
const VUE = `(() => { const r = document.querySelector('mjs-im-parent')._shadow; return 't=' + r.querySelector('.t').textContent + ' e=' + Array.from(r.querySelectorAll('mjs-im-enfant')).map((c) => c._shadow.querySelector('.e').textContent + '/' + c._shadow.querySelector('mjs-im-petit')._shadow.querySelector('.pe').textContent).join(',') + ' cb=' + r.querySelectorAll('mjs-core-checkbox').length + ' fin=' + r.querySelectorAll('.fin').length })()`

// les éléments tamponnés par le serveur encore présents, sur tous les niveaux d'ombre : tous, ou le compte
const REPRIS = `(() => { let n = 0, t = 0; (function parcourir(r) { r.querySelectorAll('*').forEach(function (e) { t++; if (e.__srv) n++; const s = e._shadow || e.shadowRoot; if (s) parcourir(s) }) })(document.querySelector('mjs-im-parent')._shadow); return n === t && t >= 20 ? 'tous' : n + '/' + t })()`

type Rendus    = Record<string, { html: string; hydrateScript: string }>
type Construit = { rendus: Rendus; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// les rendus du serveur des deux moteurs et les deux builds, une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('imbriques-hydratation')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'im-petit.mjs'), PETIT)
    writeFileSync(join(srcDir, 'im-enfant.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'im-parent.mjs'), PARENT)
    const rendus: Rendus = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const r = await renderer.renderToString('mjs-im-parent', { ssrMode: 'markers' } as any)
    rendus['markers'] = { html: r.html, hydrateScript: r.hydrateScript }
    await renderer.close()
    const playwright = await import('playwright')
    if (existsSync(playwright.chromium.executablePath())) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
      try {
        const p = await nav.renderPage('mjs-im-parent', { ssrMode: 'markers' } as any)
        rendus['markers (moteur navigateur)'] = { html: p.html, hydrateScript: p.hydrateScript }
      } finally {
        await nav.close()
      }
    }
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
      assert.ok(fichiers[env].has('bundle.js'), `le build ${env} écrit son manifeste`)
    }
    return { rendus, fichiers }
  })()
  return construit
}

// avant le bundle : chaque élément écrit par le serveur (dans toutes les racines d'ombre) porte un tampon, pour voir plus tard s'il a été repris
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }) })()</script>`

for (const nom of ['chromium', 'firefox'] as const) for (const env of ENVS) for (const variante of VARIANTES) describe(`sous-composants repris : ${nom}, ${env}, hydratation « ${variante} »`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // la valeur attendue : le navigateur la rejoint dans un délai court, sinon c'est un échec
  async function voir(js: string, attendu: string, quand: string) {
    let vu = ''
    for (let i = 0; i < 80; i++) {
      try { vu = await page.evaluate(js) } catch (e: any) { vu = 'lecture impossible : ' + String(e.message).slice(0, 120) }
      if (vu === attendu) return
      await dormir(25)
    }
    assert.equal(vu, attendu, quand)
  }

  before(async function () {
    this.timeout(180000)
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire()
      if (!fait.rendus[variante]) { present = false; return }
      const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.rendus[variante].html}\n${fait.rendus[variante].hydrateScript}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script></body></html>`
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      await page.route('http://imbriques.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fait.fichiers[env].get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await page.goto('http://imbriques.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => { const h = document.querySelector('mjs-im-parent'); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild })()`, { timeout: 60000 })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('chaque élément écrit par le serveur, sous-composants compris, est repris tel quel (rien de rebâti)', async function () {
    if (!present) { this.skip(); return }
    await voir(VUE, 't=Total 1 e=1/1,b/b cb=1 fin=1', 'la vue de départ')
    await voir(REPRIS, 'tous', 'les nœuds du serveur, à chaque niveau')
  })

  it('chaque écriture de l\'état se retrouve à chaque niveau', async function () {
    if (!present) { this.skip(); return }
    await voir(VUE, 't=Total 1 e=1/1,b/b cb=1 fin=1', 'la vue de départ')
    await page.evaluate(`document.querySelector('mjs-im-parent').pose(5)`)
    await voir(VUE, 't=Total 5 e=5/5,b/b cb=1 fin=1', 'après « 5 »')
    await page.evaluate(`document.querySelector('mjs-im-parent').pose(12)`)
    await voir(VUE, 't=Total 12 e=12/12,b/b cb=1 fin=1', 'après « 12 »')
  })

  it('aucune erreur dans la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
  })
})
