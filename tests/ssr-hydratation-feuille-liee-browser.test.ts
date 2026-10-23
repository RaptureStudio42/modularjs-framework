// Page rendue par le serveur avec une feuille de thème LIÉE (`<link rel="stylesheet">` en tête de chaque racine d'ombre, dès que la
// répéter en ligne coûterait plus de 8 Ko), reprise dans un navigateur réel : les trois reprises (markers, positional, diff) gardent
// les nœuds du serveur, comme sur une page de quelques racines où la feuille reste en ligne. Une page de 24 cases à cocher est la
// forme où le seuil est franchi. Le mode `replace` reconstruit la vue : il sert de témoin (aucun nœud repris, une seule vue).
// Chromium et Firefox réels, développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const MODES = ['markers', 'positional', 'diff', 'replace'] as const
const ENVS  = ['dev', 'prod'] as const

const cases = (n: number) => Array.from({ length: n }, (_, i) => `    <@@checkbox class="c${i + 1}" name="c${i + 1}">case ${i + 1}</@@checkbox>`).join('\n')
const hote  = (n: number) => `<script>
  $n = 3
</script>

<p class="n">{$n}</p>
<form class="f" method="get" action="/envoi" @noUJS>
${cases(n)}
  <button type="submit" class="go">envoyer</button>
</form>
<p class="fin">fin</p>
`

type Rendus    = Record<string, { grand: { html: string; hydrateScript: string }; petit: { html: string; hydrateScript: string } }>
type Construit = { rendus: Rendus; fichiers: Record<string, Map<string, Buffer>>; feuilles: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// deux pages (24 cases : la feuille est liée ; 3 cases : elle reste en ligne), rendues dans chaque mode, et les deux builds
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('feuille-liee')
    const srcDir = join(root, 'src')
    const rendu  = join(root, 'rendu')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fl-grand.mjs'), hote(24))
    writeFileSync(join(srcDir, 'fl-petit.mjs'), hote(3))
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: rendu, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: Rendus = {}
    for (const mode of MODES) {
      const grand = await renderer.renderToString('mjs-fl-grand', { ssrMode: mode } as any)
      const petit = await renderer.renderToString('mjs-fl-petit', { ssrMode: mode } as any)
      rendus[mode] = { grand: { html: grand.html, hydrateScript: grand.hydrateScript }, petit: { html: petit.html, hydrateScript: petit.hydrateScript } }
    }
    await renderer.close()
    const feuilles = new Map<string, Buffer>()
    for (const n of readdirSync(rendu)) if (/^mjs_ssr_style_.*\.css$/.test(n)) feuilles.set(n, readFileSync(join(rendu, n)))
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { rendus, fichiers, feuilles }
  })()
  return construit
}

// avant le bundle : chaque élément écrit par le serveur (dans toutes les racines d'ombre) porte un tampon
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }) })()</script>`

for (const nom of ['chromium', 'firefox'] as const) for (const env of ENVS) describe(`feuille de thème liée et reprise de la page : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let fichiers = new Map<string, Buffer>()
  let feuilles = new Map<string, Buffer>()
  let rendus: Rendus = {}
  const erreurs: string[] = []

  // la page rendue dans ce mode (grande ou petite), le bundle chargé après elle, puis l'attente de l'hydratation de toutes les cases
  async function charger(mode: string, taille: 'grand' | 'petit', cases: number) {
    const r = rendus[mode][taille]
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${r.html}\n${r.hydrateScript}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    erreurs.length = 0
    await page.goto('http://liee.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-fl-${taille}')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-checkbox')) : []
      return m.length === ${cases} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
    })()`, { timeout: 60000 })
    await page.waitForTimeout(300)
  }

  const reprise = (taille: string, sel: string): Promise<boolean> => page.evaluate(`(() => { const e = document.querySelector('mjs-fl-${taille}')._shadow.querySelector('${sel}'); return !!e && e.__srv === true })()`)

  before(async function () {
    this.timeout(180000)
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire()
      fichiers = fait.fichiers[env]
      feuilles = fait.feuilles
      rendus   = fait.rendus
      browser  = await playwright[nom].launch()
      page     = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      await page.route('http://liee.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        const css = feuilles.get(basename(url.pathname))
        if (css) { await route.fulfill({ status: 200, contentType: 'text/css', body: css }); return }
        if (url.pathname.startsWith('/out/')) {
          const corps = fichiers.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('le rendu de 24 cases lie la feuille de thème (un <link> par racine), celui de 3 cases la garde en ligne', function () {
    if (!present) { this.skip(); return }
    const lies = (rendus.markers.grand.html.match(/<link rel="stylesheet" href="[^"]*mjs_ssr_style_partagee-[^"]*\.css">/g) ?? []).length
    assert.ok(lies >= 25, `une feuille liée par racine d'ombre (24 cases et la page) : ${lies}`)
    assert.ok(feuilles.size > 0, 'le fichier de la feuille est écrit dans le dossier de sortie')
    assert.equal((rendus.markers.petit.html.match(/<link rel="stylesheet"/g) ?? []).length, 0, 'sur 3 cases la feuille reste en ligne')
    assert.match(rendus.markers.petit.html, /<style>/, 'sur 3 cases la feuille est un <style>')
  })

  for (const taille of ['petit', 'grand'] as const) for (const mode of MODES) it(`${taille === 'grand' ? '24' : '3'} cases, hydratation « ${mode} » : ${mode === 'replace' ? 'la vue est reconstruite (témoin)' : 'le formulaire et les cases du serveur sont repris, une seule vue'}`, async function () {
    if (!present) { this.skip(); return }
    const n = taille === 'grand' ? 24 : 3
    await charger(mode, taille, n)
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    assert.equal(await page.evaluate(`document.querySelector('mjs-fl-${taille}')._shadow.querySelectorAll('form').length`), 1, 'un seul formulaire, jamais doublé')
    assert.equal(await page.evaluate(`document.querySelector('mjs-fl-${taille}')._shadow.querySelectorAll('mjs-core-checkbox').length`), n, 'une case par case écrite')
    const attendu = mode !== 'replace'
    for (const sel of ['form', '.n', '.go', '.fin', 'mjs-core-checkbox.c1', `mjs-core-checkbox.c${n}`]) {
      assert.equal(await reprise(taille, sel), attendu, `${sel} ${attendu ? 'est le nœud du serveur' : 'a été reconstruit'}`)
    }
    // la page vit : une vraie case cochée au clic est envoyée par le formulaire
    await page.evaluate(`document.querySelector('mjs-fl-${taille}')._shadow.querySelector('mjs-core-checkbox.c2')._shadow.querySelector('.box').click()`)
    await page.waitForTimeout(100)
    assert.deepEqual(await page.evaluate(`Array.from(new FormData(document.querySelector('mjs-fl-${taille}')._shadow.querySelector('form'))).map((p) => p[0] + '=' + p[1])`), ['c2=on'], 'le formulaire envoie la case cochée')
    assert.deepEqual(erreurs, [], 'aucune erreur après le clic')
  })
})
