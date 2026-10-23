// Les traces que le routeur écrit dans la console du navigateur (enregistrement, navigation, injection
// des vues, permutation sous transition) suivent la langue de la page, comme les autres messages du
// framework : le texte vient de la table `err` (clés `router…`), jamais d'une phrase en dur.
//
// Page en anglais : les traces sortent en anglais. Page en français, ou sans langue : le texte est celui
// que le routeur écrivait en dur, au caractère près. En production, au niveau de console par défaut
// ('warn'), aucune trace n'est écrite et aucun fichier de messages n'est demandé ; au niveau 'log', le
// texte des traces vient du manifeste : chaque trace sort une seule fois, dans l'ordre, en texte complet
// dans la langue de la page, sans qu'aucun fichier de messages soit demandé.
//
// Méthode : le cœur (mjs_init.ts), le cache de pages (mjs_page_cache.ts) et le routeur sont chargés dans
// une même fonction, dans une fenêtre happy-dom ; les méthodes du routeur sont appelées pour de vrai. En
// production, la table des libellés est celle que le manifeste d'un vrai build de production pose.

import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const lire        = (nom: string) => readFileSync(join(RUNTIME_DIR, nom), 'utf-8')
const SOURCE      = `${lire('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_router.ts')}\nreturn µ;`

// ce que le scénario ci-dessous écrit, dans l'ordre, par langue
const FR = [
  '🚦 [Router] Enregistrement de : <mjs-app>',
  '🚦 [Router] Init <mjs-app> avec le Hash Path : \'/a\'',
  '   ↳ 🔍 [Router] Analyse des @routes pour <mjs-app>...',
  '      🎯 Match ! [/a] -> Module [page-a] injecté dans <@view main>',
  '      🏗️ [Router] Création DOM : <mjs-page-a>',
  '🚦 [Router] Navigation locale vers : \'/b\'',
  '   ↳ 🔍 [Router] Analyse des @routes pour <mjs-app>...',
  '      🎯 Match ! [/b] -> Module [page-b] injecté dans <@view main>',
  '      🏗️ [Router] Création DOM : <mjs-page-b>',
  '🚦 [Router] Navigation locale vers : \'/a\'',
  '   ↳ 🔍 [Router] Analyse des @routes pour <mjs-app>...',
  '      🎯 Match ! [/a] -> Module [page-a] injecté dans <@view main>',
  '      ⚡ [Router] Restauration depuis le cache : <mjs-page-a>',
  '🚦 [Router] Navigation locale vers : \'/zzz\'',
  '   ↳ 🔍 [Router] Analyse des @routes pour <mjs-app>...',
  '      🚫 [Router] Aucune route pour <@view main> — vue vidée.',
  '      🚫 Aucun composant à injecter pour le path \'/zzz\'.',
  '   ↳ ⚠️ [Router] Aucun objet @routes trouvé dans <mjs-vide>',
  '🚦 [Router] Navigation locale vers : \'/b\'',
  '🎬 [Router] Permutation de vues sous RIDEAU (cube, priorité 3)',
  '🚦 [Router] Navigation locale vers : \'/a\'',
  '🎬 [Router] Permutation de vues sous View Transition (zoom, priorité 3)',
  '   ↳ 🔍 [Router] Analyse des @routes pour <mjs-app>...',
  '      🎯 Match ! [/a] -> Module [page-a] injecté dans <@view main>',
  '      ⚡ [Router] Restauration depuis le cache : <mjs-page-a>',
  '🚦 [Router] Navigation locale vers : \'/b\'',
  '🎬 [Router] Permutation de vues sous View Transition (natif, priorité 2)',
  '   ↳ 🔍 [Router] Analyse des @routes pour <mjs-app>...',
  '      🎯 Match ! [/b] -> Module [page-b] injecté dans <@view main>',
  '      ⚡ [Router] Restauration depuis le cache : <mjs-page-b>',
]

const EN = [
  '🚦 [Router] Registering: <mjs-app>',
  '🚦 [Router] Init <mjs-app> with the Hash Path: \'/a\'',
  '   ↳ 🔍 [Router] Analyzing @routes for <mjs-app>...',
  '      🎯 Match! [/a] -> Module [page-a] injected into <@view main>',
  '      🏗️ [Router] DOM creation: <mjs-page-a>',
  '🚦 [Router] Local navigation to: \'/b\'',
  '   ↳ 🔍 [Router] Analyzing @routes for <mjs-app>...',
  '      🎯 Match! [/b] -> Module [page-b] injected into <@view main>',
  '      🏗️ [Router] DOM creation: <mjs-page-b>',
  '🚦 [Router] Local navigation to: \'/a\'',
  '   ↳ 🔍 [Router] Analyzing @routes for <mjs-app>...',
  '      🎯 Match! [/a] -> Module [page-a] injected into <@view main>',
  '      ⚡ [Router] Restored from cache: <mjs-page-a>',
  '🚦 [Router] Local navigation to: \'/zzz\'',
  '   ↳ 🔍 [Router] Analyzing @routes for <mjs-app>...',
  '      🚫 [Router] No route for <@view main> — view cleared.',
  '      🚫 No component to inject for path \'/zzz\'.',
  '   ↳ ⚠️ [Router] No @routes object found in <mjs-vide>',
  '🚦 [Router] Local navigation to: \'/b\'',
  '🎬 [Router] View swap under CURTAIN (cube, priority 3)',
  '🚦 [Router] Local navigation to: \'/a\'',
  '🎬 [Router] View swap under View Transition (zoom, priority 3)',
  '   ↳ 🔍 [Router] Analyzing @routes for <mjs-app>...',
  '      🎯 Match! [/a] -> Module [page-a] injected into <@view main>',
  '      ⚡ [Router] Restored from cache: <mjs-page-a>',
  '🚦 [Router] Local navigation to: \'/b\'',
  '🎬 [Router] View swap under View Transition (native, priority 2)',
  '   ↳ 🔍 [Router] Analyzing @routes for <mjs-app>...',
  '      🎯 Match! [/b] -> Module [page-b] injected into <@view main>',
  '      ⚡ [Router] Restored from cache: <mjs-page-b>',
]

interface Page {
  µ: any
  journal: string[]
  demandes: string[]
  parcourir(): void
}

// une page : le cœur et le routeur dans une fenêtre, la langue de la page, la console et le réseau simulés
function page(lang: string, opts: { prod?: boolean, niveau?: string, table?: any } = {}): Page {
  const win: any = new Window({ url: 'http://localhost/#/a' })
  if (lang) win.document.documentElement.setAttribute('lang', lang)
  const journal: string[]  = []
  const demandes: string[] = []
  const consoleSimulee     = { log: (...a: any[]) => { journal.push(a.map(String).join(' ')) }, warn() {}, error() {} }
  const fetchSimule        = (url: string) => {
    demandes.push(url)
    const fichier = url.includes('/en') ? 'en' : 'fr'
    return Promise.resolve({ ok: true, json: () => Promise.resolve((RUNTIME_LABELS as any)[fichier].err) })
  }
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', 'CustomEvent', SOURCE)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, fetchSimule, consoleSimulee, win.CustomEvent,
  )
  µ._runtimeLabelsLang = 'fr'
  // une copie par page : l'arrivée d'un fichier de messages écrit dans la table (`err` de la langue), les pages ne la partagent pas
  µ._runtimeLabels     = opts.table ? structuredClone(opts.table) : RUNTIME_LABELS
  if (opts.prod) µ._msgUrls = { fr: '/fr.json', en: '/en.json' }
  if (opts.niveau) µ._logLevel = opts.niveau
  µ.config = { routeNotFound: 'warn' }

  // un composant routé : deux pages sur la vue « main », et un composant sans table @routes
  const doc: any = win.document
  const comp: any = doc.createElement('mjs-app')
  const vue: any = doc.createElement('metamjs-view')
  vue.id       = 'main'
  comp._shadow = comp
  comp.routes  = { main: { '/a': 'page-a', '/b': 'page-b' } }
  comp.appendChild(vue)
  doc.body.appendChild(comp)

  // les traces des deux permutations sous transition : une API de transition simulée, et le vainqueur de la cascade imposé
  const Router: any = µ.Router
  const permuter = (vainqueur: any, rideau: boolean) => {
    Router._mjs_vtResolveNavigation = () => vainqueur
    µ._mjs_vtCurtainRun = rideau ? () => true : undefined
  }
  doc.startViewTransition = (rappel: () => void) => { rappel(); return { finished: Promise.resolve(), ready: Promise.resolve() } }

  return {
    µ, journal, demandes,
    parcourir() {
      Router.register(comp)
      Router.navigate('#/b', true)
      Router.navigate('#/a', true)
      Router.navigate('#/zzz', true)
      Router._mjs_injectViewsForComponent({ tagName: 'MJS-VIDE' }, '/a')
      permuter({ value: 'cube', priority: 3 }, true)
      Router.navigate('#/b', true)
      permuter({ value: 'zoom', priority: 3 }, false)
      Router.navigate('#/a', true)
      permuter({ value: true, priority: 2 }, false)
      Router.navigate('#/b', true)
    },
  }
}

const attendre = () => new Promise((r) => setTimeout(r, 30))

// la table des libellés que le manifeste d'un vrai build de production, d'une appli routée, pose au niveau de console demandé
async function tableDuManifeste(logLevel: string): Promise<any> {
  const root   = mjsTmp('traces-langue')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'app.page.mjs'), '<script>\n  @routes =\n    \'main\':\n      \'/\': \'home-page\'\n</script>\n\n<@view main>\n')
  writeFileSync(join(srcDir, 'home-page.mjs'), '<h1>Accueil</h1>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', logLevel } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const ligne = readFileSync(join(outDir, 'bundle.js'), 'utf-8').split('\n').map((l) => l.trim()).find((l) => l.startsWith('µ._runtimeLabels ='))
  assert.ok(ligne, 'le manifeste pose la table des libellés')
  return JSON.parse(ligne!.slice('µ._runtimeLabels ='.length).trim().replace(/;$/, ''))
}

describe('routeur — traces µ.log dans la langue de la page', () => {
  it('page en anglais : chaque trace sort en anglais', () => {
    const p = page('en')
    p.parcourir()
    assert.deepEqual(p.journal, EN)
  })

  for (const lang of ['fr', '']) {
    it(`page ${lang ? 'en français' : 'sans langue'} : chaque trace est le texte d'origine, au caractère près`, () => {
      const p = page(lang)
      p.parcourir()
      assert.deepEqual(p.journal, FR)
    })
  }
})

describe('routeur — traces µ.log en production', function () {
  this.timeout(120000)

  const tables: Record<string, any> = {}
  before(async () => {
    tables.warn = await tableDuManifeste('warn')
    tables.log  = await tableDuManifeste('log')
  })
  after(async () => { await terminateSharedWorkerPool() })

  it('niveau par défaut (warn) : aucune trace écrite, aucun fichier de messages demandé', async () => {
    const p = page('en', { prod: true, niveau: 'warn', table: tables.warn })
    p.parcourir()
    await attendre()
    assert.deepEqual(p.journal, [])
    assert.deepEqual(p.demandes, [])
  })

  it('niveau log, page en anglais : chaque trace sort une seule fois, dans l\'ordre, en anglais, sans demander de fichier', async () => {
    const p = page('en', { prod: true, niveau: 'log', table: tables.log })
    p.parcourir()
    await attendre()
    assert.deepEqual(p.journal, EN)
    assert.deepEqual(p.demandes, [])
  })

  it('niveau log, page en français : le texte français sort tout de suite, au caractère près, dans l\'ordre', async () => {
    const p = page('fr', { prod: true, niveau: 'log', table: tables.log })
    p.parcourir()
    await attendre()
    assert.deepEqual(p.journal, FR)
    assert.deepEqual(p.demandes, [])
  })

  it('niveau log, langue inconnue du framework (de) : le texte de la langue du projet, comme en développement', async () => {
    const p = page('de', { prod: true, niveau: 'log', table: tables.log })
    p.parcourir()
    await attendre()
    assert.deepEqual(p.journal, FR)
  })
})
