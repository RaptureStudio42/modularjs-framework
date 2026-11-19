// Page servie : une valeur dérivée qui attend (`$fiche = await charger($id)`) dans un composant écrit dans la branche {success} d'un bloc
// `{await}` du composant servi, ou d'un composant de sa première vue. Le navigateur relit le bloc et bâtit sa branche à sa première
// réponse, après le premier rendu ; la fiche de cette branche montre pourtant la valeur rangée par le serveur sans rappeler la fonction,
// comme une fiche écrite à plat ou dans un `{for}` ; de même pour la branche {error} d'un bloc dont la demande échoue des deux côtés. Une
// fiche que le navigateur bâtit ensuite (un `{if}` levé par un clic, la relecture d'un bloc dont une variable a changé) appelle sa
// fonction, même quand le serveur avait rangé une valeur pour elle. Les trois rendus (`ssr:markers`, `ssr` soit `replace`, prérendu par
// navigateur), en développement et en production (un fichier par composant), dans Chromium, Firefox et WebKit.

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

const ATTENDRE = `<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
</script>`

const SOURCES: Record<string, string> = {
  'aw-fiche.mjs': `${ATTENDRE}
<script>
  charger = (id) ->
    (window.__appels ||= []).push(String(id))
    plusTard({ nom: 'N' + id + (if µ.server then '-serveur' else '-navigateur') }, 20)
  $fiche = await charger($id)
</script>
<i class="nom">{$fiche and $fiche.nom}</i>
`,
  'aw-bloc.mjs': `${ATTENDRE}
<script>
  attendre = -> plusTard(1, 10)
</script>
{await attendre()}<b>attente</b>{success}<@aw-fiche id={$id}></@aw-fiche>{end}
`,
  // `$tard` et `$m` ont leur valeur du clic au serveur seulement : il range une valeur pour les fiches 32 et 33, que le navigateur ne bâtit
  // qu'au clic (la 33 à la relecture de son bloc)
  'aw-page.mjs': `<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
  rater = -> new Promise((tenir, refuser) -> setTimeout((-> refuser(new Error('demande refusée'))), 10))
</script>
<script>
  $tard = (if µ.server then true else false)
  $m    = (if µ.server then 2 else 1)
  attendre = (n) -> plusTard(n, 10)
  plus = ->
    $tard = true
    $m    = 2
</script>
<div class="c">{await attendre(1)}<b>attente</b>{success}<@aw-fiche id={31}></@aw-fiche>{if $tard}<@aw-fiche id={32}></@aw-fiche>{end}{end}</div>
<div class="d"><@aw-bloc id={41}></@aw-bloc></div>
<div class="e">{await rater()}<b>attente</b>{error err}<@aw-fiche id={51}></@aw-fiche>{end}</div>
<div class="f">{await attendre($m)}<b>attente</b>{success}{if $m > 1}<@aw-fiche id={33}></@aw-fiche>{end}{end}</div>
<button class="plus" @click={plus()}>plus</button>
`
}

// posée avant tout script de la page : les fiches, à toute profondeur, et leur texte
const SONDE = `(() => {
  window.__appels = [];
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  const tous = () => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === 'mjs-aw-fiche') out.push(e); if (racine(e)) fouille(racine(e)); }); fouille(document); return out; };
  window.__noms = () => tous().map((f) => { const r = racine(f), i = r && r.querySelector('.nom'); return i ? i.textContent.trim() : '∅'; }).sort();
})()`

type Construit = { pages: Record<string, string>; graines: Record<string, any>; fichiers: Record<string, Map<string, Buffer>>; erreurs: Record<string, string[]> }
let construit: Promise<Construit> | null = null

const graineDe = (shared: string) => {
  const b = /id=["']?__mjs_store["']?[^>]*>([\s\S]*?)<\/script>/.exec(shared || '')
  return b ? JSON.parse(b[1]).__mjsAwait ?? null : null
}

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('aw-enfant-d-un-await')
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

describe('valeur dérivée qui attend — les trois rendus rangent les valeurs des fiches écrites dans un {await}', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const page of Object.keys(PAGES)) it(`page ${page} : cinq valeurs rangées`, async () => {
    const fait = await construire()
    assert.deepEqual(fait.graines[page], { 'mjs-aw-fiche|fiche|[31]': { v: { nom: 'N31-serveur' }, n: 1 }, 'mjs-aw-fiche|fiche|[32]': { v: { nom: 'N32-serveur' }, n: 1 }, 'mjs-aw-fiche|fiche|[33]': { v: { nom: 'N33-serveur' }, n: 1 }, 'mjs-aw-fiche|fiche|[41]': { v: { nom: 'N41-serveur' }, n: 1 }, 'mjs-aw-fiche|fiche|[51]': { v: { nom: 'N51-serveur' }, n: 1 } })
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`valeur dérivée qui attend — page servie, fiche écrite dans un {await} : ${nom}, ${env}`, function () {
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

  for (const page of Object.keys(PAGES)) it(`page ${page} : les fiches des branches {success} et {error} reprennent la valeur servie sans appel, celles bâties au clic appellent`, async function () {
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
      await p.waitForFunction(() => (window as any).__noms().filter((x: string) => x !== '∅').length >= 3, null, { timeout: 8000 })
      await p.waitForTimeout(300)
      assert.deepEqual(await p.evaluate(() => [(window as any).__noms(), (window as any).__appels.slice()]), [['N31-serveur', 'N41-serveur', 'N51-serveur'], []], 'les fiches des branches {success} et {error} montrent la valeur du serveur, sans appel')
      await p.evaluate(() => { const pg: any = document.querySelector('mjs-aw-page'); (pg._shadow || pg.shadowRoot).querySelector('.plus').click() })
      await p.waitForFunction(() => (window as any).__noms().filter((x: string) => x !== '∅').length >= 5, null, { timeout: 8000 })
      await p.waitForTimeout(300)
      assert.deepEqual(await p.evaluate(() => [(window as any).__noms(), (window as any).__appels.slice().sort()]), [['N31-serveur', 'N32-navigateur', 'N33-navigateur', 'N41-serveur', 'N51-serveur'], ['32', '33']], 'les fiches bâties au clic appellent leur fonction, les valeurs rangées pour elles par le serveur restent de côté')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await p.close()
    }
  })
})
