// Une valeur dérivée qui attend (`$fiche = await charger($id)`) dans une vraie page servie, reprise par le navigateur des deux façons
// (`ssr:markers` : la vue reprend les nœuds du serveur ; `ssr`, soit `replace` : elle les remplace) et dans la page du prérendu par
// navigateur (moteur navigateur, `replace`). Les trois rendus attendent la réponse et la rangent dans `#__mjs_store`. Au réveil : deux
// composants servis de même clé montrent la valeur du serveur sans appeler ; un composant servi qui attend son réveil à l'intention
// (`:wake=interaction`) la prend aussi quand il se réveille ; un composant que le navigateur crée ensuite (un `{if}` qui s'ouvre) appelle
// la fonction et montre sa propre réponse. En développement et en production (un fichier par composant), dans Chromium, Firefox et WebKit.

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
  $plus = false
</script>
<@aw-fiche class="a" id={7}></@aw-fiche>
<@aw-fiche class="b" id={7}></@aw-fiche>
<@aw-fiche class="c" id={8} :wake=interaction></@aw-fiche>
<button class="plus" @click={$plus = true}>plus</button>
{if $plus}
  <@aw-fiche class="d" id={7}></@aw-fiche>
{end}
`
}

// posée avant tout script de la page : une fiche par sa classe, à toute profondeur ; son texte ; attend-elle son réveil
const SONDE = `(() => {
  window.__appels = [];
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  const tous = () => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === 'mjs-aw-fiche') out.push(e); if (racine(e)) fouille(racine(e)); }); fouille(document); return out; };
  window.__fiche  = (c) => tous().find((e) => e.classList.contains(c));
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
    const root   = mjsTmp('aw-page-servie')
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

describe('valeur dérivée qui attend — les trois rendus rangent les valeurs arrivées', function () {
  this.timeout(180000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const page of Object.keys(PAGES)) it(`page ${page} : chaque valeur une fois, avec le nombre de composants servis qui la lisent`, async () => {
    const fait = await construire()
    assert.match(fait.pages[page], /N7-serveur/, 'le rendu attend la réponse')
    assert.deepEqual(fait.graines[page], { 'mjs-aw-fiche|fiche|[7]': { v: { nom: 'N7-serveur' }, n: 2 }, 'mjs-aw-fiche|fiche|[8]': { v: { nom: 'N8-serveur' }, n: 1 } })
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`valeur dérivée qui attend, page servie reprise : ${nom}, ${env}`, function () {
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

  for (const page of Object.keys(PAGES)) it(`page ${page} : la valeur servie reprise sans appel, réveil à l'intention compris ; un composant créé ensuite appelle`, async function () {
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
      assert.deepEqual(await p.evaluate(() => [(window as any).__nom('a'), (window as any).__nom('b'), (window as any).__nom('c')]), ['N7-serveur', 'N7-serveur', 'N8-serveur'])
      assert.equal(await p.evaluate(() => (window as any).__attend('c')), true, 'la fiche c attend son réveil')
      assert.deepEqual(await p.evaluate(() => (window as any).__appels), [], 'aucun appel au réveil de la page servie')
      await p.hover('mjs-aw-fiche.c')
      await p.waitForFunction(() => !(window as any).__attend('c'), null, { timeout: 8000 })
      await p.waitForTimeout(300)
      assert.equal(await p.evaluate(() => (window as any).__nom('c')), 'N8-serveur', 'réveillée tard, la fiche c prend la valeur servie')
      assert.deepEqual(await p.evaluate(() => (window as any).__appels), [], 'la fiche réveillée tard n\'appelle pas')
      await p.click('button.plus')
      await p.waitForFunction(() => (window as any).__nom('d') === 'N7-navigateur', null, { timeout: 8000 })
      assert.deepEqual(await p.evaluate(() => (window as any).__appels), ['7'], 'la fiche créée ensuite par le navigateur appelle')
      assert.deepEqual(await p.evaluate(() => [(window as any).__nom('a'), (window as any).__nom('b')]), ['N7-serveur', 'N7-serveur'])
      assert.deepEqual(erreurs, [])
    }
    finally {
      await p.close()
    }
  })
})
