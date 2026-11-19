// Page servie : une valeur dérivée qui attend (`$fiche = await charger($id)`) dans des fiches que le navigateur bâtit dans le rendu qui suit
// la réponse d'un bloc `{await}` lu par le premier rendu. Les fiches de la branche de ce bloc reprennent la valeur rangée par le serveur
// sans rappeler la fonction ; une fiche qu'un clic bâtit hors de cette branche, dans ce même rendu (le clic donne la réponse du bloc, puis
// écrit la variable de la fiche ; ou l'inverse), appelle sa fonction, même quand le serveur avait rangé une valeur pour elle, comme celle d'un clic qui précède la
// réponse d'une tâche. Voisins : un `{for}` dans la branche d'un `{await}`, un `{await}` dans un `{if}`, deux `{await}` d'un même composant de la
// première vue (une branche {success}, une branche {error}, réponses à deux moments) ; un `{await}` dans un `{for}` est refusé à la construction. Les trois rendus (`ssr:markers`, `ssr` soit `replace`, prérendu par
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
  rater = -> new Promise((tenir, refuser) -> setTimeout((-> refuser(new Error('demande refusée'))), 10))
  tenirPlusTard = (n) -> setTimeout((-> window.__tenir[n](n)), 0)
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
  'aw-deux.mjs': `${ATTENDRE}
<script>
  attendre = -> plusTard(1, 40)
</script>
{await attendre()}<b>attente</b>{success}<@aw-fiche id={91}></@aw-fiche>{end}{await rater()}<b>attente</b>{error err}<@aw-fiche id={92}></@aw-fiche>{end}
`,
  // `$ouvert`, `$ouvert2` et `$ouvert3` ont leur valeur du clic au serveur seulement : il range une valeur pour les fiches 81, 83 et 85, que
  // le navigateur ne bâtit qu'au clic ; `auClic` répond au serveur, et au clic seulement dans le navigateur
  'aw-page.mjs': `${ATTENDRE}
<script>
  $ids     = [1, 2]
  $vrai    = true
  $ouvert  = (if µ.server then true else false)
  $ouvert2 = (if µ.server then true else false)
  $ouvert3 = (if µ.server then true else false)
  attendre = (n) -> plusTard(n, 10)
  auClic   = (n) -> (if µ.server then plusTard(n, 10) else new Promise((tenir) -> (window.__tenir ||= {})[n] = tenir))
  clic = ->
    $ouvert = true
    window.__tenir[3](3)
  clic3 = ->
    window.__tenir[5](5)
    $ouvert3 = true
  clic2 = ->
    $ouvert2 = true
    tenirPlusTard(4)
</script>
<div class="g">{await attendre(6)}<b>attente</b>{success}{for i in $ids}<@aw-fiche id={60 + i}></@aw-fiche>{end}{end}</div>
<div class="h">{if $vrai}{await attendre(7)}<b>attente</b>{success}<@aw-fiche id={71}></@aw-fiche>{end}{end}</div>
<div class="j"><@aw-deux></@aw-deux></div>
<div class="k">{await auClic(3)}<b>attente</b>{success}<@aw-fiche id={82}></@aw-fiche>{end}{if $ouvert}<@aw-fiche id={81}></@aw-fiche>{end}</div>
<div class="n">{await auClic(5)}<b>attente</b>{success}<@aw-fiche id={86}></@aw-fiche>{end}{if $ouvert3}<@aw-fiche id={85}></@aw-fiche>{end}</div>
<div class="m">{await auClic(4)}<b>attente</b>{success}<@aw-fiche id={84}></@aw-fiche>{end}{if $ouvert2}<@aw-fiche id={83}></@aw-fiche>{end}</div>
<button class="un" @click={clic()}>un</button>
<button class="deux" @click={clic2()}>deux</button>
<button class="trois" @click={clic3()}>trois</button>
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
    const root   = mjsTmp('aw-clic-de-la-reponse')
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

const SERVIES = [61, 62, 71, 81, 82, 83, 84, 85, 86, 91, 92]

describe('valeur dérivée qui attend — les trois rendus rangent les valeurs des fiches des blocs voisins, celles bâties au clic comprises', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const page of Object.keys(PAGES)) it(`page ${page} : onze valeurs rangées`, async () => {
    const fait = await construire()
    assert.deepEqual(fait.graines[page], Object.fromEntries(SERVIES.map((id) => ['mjs-aw-fiche|fiche|[' + id + ']', { v: { nom: 'N' + id + '-serveur' }, n: 1 }])))
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`valeur dérivée qui attend — page servie, clic dans le rendu de la réponse d'un {await} : ${nom}, ${env}`, function () {
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

  for (const page of Object.keys(PAGES)) it(`page ${page} : les fiches des branches reprennent la valeur servie, celles qu'un clic bâtit hors d'elles appellent, même dans le rendu de la réponse`, async function () {
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
    const lire    = () => p.evaluate(() => [(window as any).__noms(), (window as any).__appels.slice().sort()])
    const cliquer = (bouton: string) => p.evaluate((b: string) => { const pg: any = document.querySelector('mjs-aw-page'); (pg._shadow || pg.shadowRoot).querySelector(b).click() }, bouton)
    const voir    = (n: number) => p.waitForFunction((k: number) => (window as any).__noms().filter((x: string) => x !== '∅').length >= k, n, { timeout: 8000 })
    try {
      await p.goto('http://page-servie.test/')
      await p.waitForFunction(() => !!customElements.get('mjs-aw-fiche') && !!customElements.get('mjs-aw-page') && !!customElements.get('mjs-aw-deux'), null, { timeout: 8000 })
      await voir(5)
      await p.waitForTimeout(300)
      assert.deepEqual(await lire(), [['N61-serveur', 'N62-serveur', 'N71-serveur', 'N91-serveur', 'N92-serveur'], []], 'les fiches d\'un {for} dans une branche, d\'un {await} dans un {if} et des deux {await} d\'un composant montrent la valeur du serveur, sans appel')
      await cliquer('.un')
      await voir(7)
      await p.waitForTimeout(300)
      assert.deepEqual(await lire(), [['N61-serveur', 'N62-serveur', 'N71-serveur', 'N81-navigateur', 'N82-serveur', 'N91-serveur', 'N92-serveur'], ['81']], 'le clic écrit puis donne la réponse : la fiche de la branche reprend la valeur du serveur, celle que le clic bâtit hors d\'elle appelle')
      await cliquer('.trois')
      await voir(9)
      await p.waitForTimeout(300)
      assert.deepEqual(await lire(), [['N61-serveur', 'N62-serveur', 'N71-serveur', 'N81-navigateur', 'N82-serveur', 'N85-navigateur', 'N86-serveur', 'N91-serveur', 'N92-serveur'], ['81', '85']], 'le clic donne la réponse puis écrit, un seul rendu : la fiche de la branche reprend la valeur du serveur, celle que le clic bâtit hors d\'elle appelle')
      await cliquer('.deux')
      await voir(11)
      await p.waitForTimeout(300)
      assert.deepEqual(await lire(), [['N61-serveur', 'N62-serveur', 'N71-serveur', 'N81-navigateur', 'N82-serveur', 'N83-navigateur', 'N84-serveur', 'N85-navigateur', 'N86-serveur', 'N91-serveur', 'N92-serveur'], ['81', '83', '85']], 'un clic qui précède la réponse d\'une tâche : sa fiche appelle, celle de la branche reprend la valeur du serveur')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await p.close()
    }
  })
})
