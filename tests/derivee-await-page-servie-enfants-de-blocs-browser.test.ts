// Page servie : une valeur dérivée qui attend (`$fiche = await charger($id)`) dans des composants que la vue servie bâtit dans ses blocs,
// en boucle (`{for}`) et sous condition (`{if}`). Les trois rendus (`ssr:markers`, `ssr` soit `replace`, prérendu par navigateur)
// attendent les réponses et les rangent dans `#__mjs_store` ; au réveil, chaque fiche montre la valeur du serveur sans rappeler la
// fonction, comme une fiche écrite à plat. En développement et en production (un fichier par composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const ENVS = ['dev', 'prod'] as const
// la page servie, et la façon dont le navigateur la reprend (le mode du bloc `render` de son code)
const PAGES: Record<string, string> = { 'markers': 'ssr:markers', 'replace': 'ssr', 'navigateur': 'ssr' }

const SOURCES: Record<string, string> = {
  'aw-fiche.mjs': `<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
</script>
<script>
  charger = (id) ->
    (window.__appels ||= []).push(String(id))
    plusTard({ nom: 'N' + id + (if µ.server then '-serveur' else '-navigateur') }, 20)
  $fiche = await charger($id)
</script>
<i class="nom">{$fiche and $fiche.nom}</i>
`,
  'aw-page.mjs': `<script>
  $ids  = [7, 8]
  $vrai = true
</script>
{for i in $ids}<@aw-fiche id={i}></@aw-fiche>{end}
{if $vrai}<@aw-fiche id={9}></@aw-fiche>{end}
`
}

// posée avant tout script de la page : une fiche par sa classe, à toute profondeur ; son texte ; attend-elle son réveil
const SONDE = `(() => {
  window.__appels = [];
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  const tous = () => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === 'mjs-aw-fiche') out.push(e); if (racine(e)) fouille(racine(e)); }); fouille(document); return out; };
  window.__fiche  = (c) => tous().find((e) => e.classList.contains(c));
  window.__noms   = () => tous().map((f) => { const r = racine(f), i = r && r.querySelector('.nom'); return i ? i.textContent.trim() : '∅'; });
  window.__nom    = (c) => { const f = window.__fiche(c), r = racine(f), i = r && r.querySelector('.nom'); return i ? i.textContent.trim() : '∅'; };
  window.__attend = (c) => { const f = window.__fiche(c); return !!f && f.hasAttribute('mjs-wake'); };
})()`

type Construit = { pages: Record<string, string>; graines: Record<string, any>; fichiers: Record<string, Map<string, Buffer>>; erreurs: Record<string, string[]> }
let construit: Promise<Construit> | null = null

const graineDe = (shared: string) => {
  const b = /id=["']?__mjs_store["']?[^>]*>([\s\S]*?)<\/script>/.exec(shared || '')
  return b ? JSON.parse(b[1]).__mjsAwait ?? null : null
}

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('aw-enfants-de-blocs')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    const graines: Record<string, any>  = {}
    for (const mode of ['markers', 'replace']) {
      const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu-' + mode), bundlerOpts: { runtime: ['hydrate'] } } as any)
      try {
        const r = await renderer.renderToString('mjs-aw-page', { ssrMode: mode, settleMs: 2000 } as any)
        pages[mode]   = r.html + '\n' + (r.hydrateScript || '') + '\n' + (r.sharedScript || '')
        graines[mode] = graineDe(r.sharedScript)
      }
      finally {
        await renderer.close()
      }
    }
    const moteur = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'rendu-navigateur' }, { configDir: root })
    try {
      const r: any = await moteur.renderPage('mjs-aw-page', { ssrMode: 'replace', settleMs: 2000 } as any)
      pages.navigateur   = r.html + '\n' + (r.hydrateScript || '') + '\n' + (r.sharedScript || '')
      graines.navigateur = graineDe(r.sharedScript)
    }
    finally {
      await moteur.close()
    }
    // le code du navigateur, bâti avec le bloc `render` du projet qui rend ses pages dans chaque mode
    const fichiers: Record<string, Map<string, Buffer>> = {}
    const erreurs: Record<string, string[]> = {}
    for (const mode of ['ssr', 'ssr:markers']) for (const env of ENVS) {
      const cle     = mode + ' ' + env
      const dossier = join(root, 'out-' + mode.replace(':', '-') + '-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env, render: { default: mode } } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      erreurs[cle]  = stats.errors.map((e: any) => String(e.message ?? e))
      fichiers[cle] = new Map<string, Buffer>()
      if (!erreurs[cle].length) for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[cle].set(n, readFileSync(join(dossier, n)))
    }
    return { pages, graines, fichiers, erreurs }
  })()
  return construit
}

describe('valeur dérivée qui attend — les trois rendus rangent les valeurs des fiches en boucle et sous condition', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const page of Object.keys(PAGES)) it(`page ${page} : trois valeurs rangées`, async () => {
    const fait = await construire()
    assert.deepEqual(fait.graines[page], { 'mjs-aw-fiche|fiche|[7]': { v: { nom: 'N7-serveur' }, n: 1 }, 'mjs-aw-fiche|fiche|[8]': { v: { nom: 'N8-serveur' }, n: 1 }, 'mjs-aw-fiche|fiche|[9]': { v: { nom: 'N9-serveur' }, n: 1 } })
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`valeur dérivée qui attend — page servie, fiches en boucle et sous condition : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let fait: Construit

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const page of Object.keys(PAGES)) it(`page ${page} : fiches en {for} et sous {if}, la valeur servie reprise sans appel`, async function () {
    if (!present) this.skip()
    const cle = PAGES[page] + ' ' + env
    assert.deepEqual(fait.erreurs[cle], [])
    const fichiers = fait.fichiers[cle]
    const contenu  = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.pages[page]}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const p        = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    p.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    p.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    await p.addInitScript(SONDE)
    await p.route('http://page-servie.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fichiers.get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    try {
      await p.goto('http://page-servie.test/')
      await p.waitForFunction(() => !!customElements.get('mjs-aw-fiche') && !!customElements.get('mjs-aw-page'), null, { timeout: 8000 })
      await p.waitForTimeout(400)
      assert.deepEqual(await p.evaluate(() => [(window as any).__noms(), (window as any).__appels]), [['N7-serveur', 'N8-serveur', 'N9-serveur'], []], 'les fiches de la page servie montrent la valeur du serveur, sans appel')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await p.close()
    }
  })
})
