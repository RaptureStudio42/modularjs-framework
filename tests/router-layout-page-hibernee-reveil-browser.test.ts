// Une page routée qui hiberne dans un layout ne se réveille plus avec les paramètres d'une autre adresse. Parcours :
// `#/meeting/keep/abc123` → `#/mood` (un autre layout) → `#/profile/assistant`. Le premier layout revenait du cache de
// vues avec, dans sa `<@view>`, la page de la réunion : elle se réveillait (`µawake`) avec les paramètres de
// `#/profile/assistant` (`&id` vide, une requête `/app/meetings/undefined`) avant que le routeur du layout ne la
// remplace. Une page qui n'est plus celle de l'adresse quitte maintenant la vue avant que le layout ne revienne dans la
// page : la bonne page y paraît seule, après le `µurlChange` du layout, et le Précédent rend la page de la réunion depuis
// le cache, avec ses paramètres. Même règle un niveau plus bas, pour un layout dans le layout. Quand la page de
// l'adresse est encore celle du layout mais que sa garde (`µurlChange`) renvoie ailleurs, ou qu'une page renvoie ailleurs
// depuis son `µawake`, la page retirée et ses enfants, dont la connexion attendait encore son tour, ne se réveillent pas
// hors du document : ni `µawake`, ni requête `/app/meetings/undefined`. Un layout évincé du cache de vues de la racine
// emporte les pages hibernées dans son propre cache. Chromium, Firefox et WebKit réels, vrai build servi par HTTP ; la
// sortie de la vue elle-même (page hibernée, ou détruite quand le cache du layout l'a évincée) et la destruction du cache
// d'un layout évincé se vérifient aussi sans navigateur, sur happy-dom.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
interface Construction { base: string, chargements: string[], server: Server }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

// un réveil joué hors du document le dit dans le journal
const HORS = "(this.isConnected ? '' : ' hors du document')"
// neuf pages de plus à la racine : avec le second layout, elles poussent le premier hors du cache de vues de la racine
const L    = Array.from({ length: 9 }, (_, i) => i + 1)

// la racine aiguille entre deux layouts ; le premier porte une page à paramètre, une page sans paramètre, une page qu'il
// garde (son `µurlChange` renvoie ailleurs, et renvoie la réunion au profil après une déconnexion) et un layout de plus ;
// chaque page note ses réveils, celle de la réunion charge ses données à chaque arrivée ; la réunion et l'humeur portent
// chacune un composant enfant, qui note ses réveils à part ; la page d'humeur peut renvoyer au profil depuis son `µawake`
const SOURCES: Record<string, string> = {
  'app.page.mjs':               `<routes target="main">\n/meeting/*  bare-layout\n/profile/*  bare-layout\n/club/*  bare-layout\n/mood  mood-layout\n${L.map(n => `/l/${n}  l${n}-page\n`).join('')}</routes>\n<@view main>\n`,
  'bare-layout.page.mjs':       "<routes target=\"bare\">\n/meeting/keep/:id  meeting-keep-page\n/profile/assistant  profile-assistant-page\n/profile/secret  profile-secret-page\n/club/*  club-layout\n</routes>\n<script>\n  µurlChange (path)->\n    µRouter.to('/profile/assistant', { replace: true }) if path === '/profile/secret' && !window.__secretOuvert\n    µRouter.to('/profile/assistant', { replace: true }) if path.startsWith('/meeting') && window.__deconnecte\n</script>\n<@view bare>\n",
  'club-layout.page.mjs':       '<routes target="club">\n/club/:slug  club-page\n/club/:slug/membres  club-members-page\n</routes>\n<@view club>\n',
  'mood-layout.page.mjs':       '<routes target="mood">\n/mood  mood-page\n</routes>\n<@view mood>\n',
  'meeting-keep-page.mjs':      `<script>\n  µawake ->\n    window.__journal.push('reunion:' + &id + ${HORS})\n    window.__requetes.push(fetch('/app/meetings/' + &id))\n  µdestroy -> window.__detruits.push('reunion')\n</script>\n<p>{&id}</p>\n<@meeting-badge></@meeting-badge>\n`,
  'meeting-badge.mjs':          `<script>\n  µawake -> window.__enfants.push('badge:' + &id + ${HORS})\n</script>\n<span>badge</span>\n`,
  'profile-assistant-page.mjs': "<script>\n  µawake -> window.__journal.push('profil')\n  µdestroy -> window.__detruits.push('profil')\n</script>\n<p>profil</p>\n",
  'profile-secret-page.mjs':    `<script>\n  µawake -> window.__journal.push('secret' + ${HORS})\n</script>\n<p>secret</p>\n`,
  'mood-page.mjs':              "<script>\n  µawake ->\n    window.__journal.push('humeur')\n    µRouter.to('/profile/assistant') if window.__rebond\n</script>\n<p>humeur</p>\n<@mood-badge></@mood-badge>\n",
  'mood-badge.mjs':             `<script>\n  µawake -> window.__enfants.push('badge-humeur' + ${HORS})\n</script>\n<span>badge</span>\n`,
  'club-page.mjs':              "<script>\n  µawake -> window.__journal.push('club:' + &slug)\n</script>\n<p>{&slug}</p>\n",
  'club-members-page.mjs':      "<script>\n  µawake -> window.__journal.push('membres:' + &slug)\n</script>\n<p>membres {&slug}</p>\n",
  ...Object.fromEntries(L.map(n => [`l${n}-page.mjs`, `<p>l${n}</p>\n`]))
}

let construction: Promise<Construction> | null = null

async function bati(): Promise<Construction> {
  const root   = mjsTmp('routeur-layout-page-hibernee')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), code)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const chargements = [] as string[]
  const server      = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin.startsWith('/app/meetings/')) {
      chargements.push(chemin)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    if (chemin === '/app') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>')
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, chargements, server }
}

// le journal des réveils, les requêtes parties, et ce qui est affiché : la chaîne des composants routés de vue en vue,
// le texte et la marque de la page du bout, et si ses composants enfants sont tous définis (le code d'un enfant peut
// arriver après le texte de sa page ; une étape attend qu'il soit là, et réveillé)
const SONDE = () => {
  const w = window as any
  w.__journal  = []
  w.__enfants  = []
  w.__detruits = []
  w.__requetes = []
  w.__bout     = () => {
    const vue    = (h: any) => (h && h._shadow ? h._shadow.querySelector('metamjs-view') : null)
    const chaine = [] as string[]
    let hote     = document.querySelector('mjs-app') as any
    while (vue(hote) && vue(hote).firstElementChild) {
      hote = vue(hote).firstElementChild
      chaine.push(hote.tagName.toLowerCase())
    }
    return { el: chaine.length > 0 ? hote : null, chaine: chaine.join(' > ') }
  }
  w.__affiche = () => {
    const b = w.__bout()
    return { chaine: b.chaine, texte: b.el && b.el._shadow ? b.el._shadow.textContent.trim() : '', marque: b.el ? b.el.__marque || '' : '', pret: !(b.el && b.el._shadow && b.el._shadow.querySelector(':not(:defined)')) }
  }
}

describe('page hibernée dans un layout : réveillée seulement avec ses propres paramètres — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`layout rendu par le cache de vues — ${nom}`, function () {
      this.timeout(120000)
      let browser: any = null
      let c: Construction

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        if (!construction) construction = bati()
        c = await construction
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async function () {
        if (browser) await browser.close()
      })

      // ouvre `adresse`, joue les étapes (une route `#/…` à suivre, ou `'precedent'`, après le geste `avant` s'il y en a
      // un), chacune finie quand la vue montre la chaîne et le texte attendus ; la première page affichée reçoit une
      // marque ; rend les journaux des réveils (pages, enfants) et des destructions, les requêtes reçues par le serveur,
      // la marque de la page finale et les exceptions
      async function parcours(adresse: string, premiere: [string, string], etapes: Array<[string, string, string, string?]>) {
        const contexte   = await browser.newContext()
        const exceptions = [] as string[]
        c.chargements.splice(0)
        try {
          const page = await contexte.newPage()
          page.on('pageerror', (e: any) => exceptions.push(String(e)))
          await page.addInitScript(SONDE)
          const voir = async (chaine: string, texte: string) => {
            try { await page.waitForFunction(([ch, tx]: string[]) => { const a = (window as any).__affiche(); return a.chaine === ch && a.texte === tx && a.pret }, [chaine, texte], { timeout: 10000 }) }
            catch { assert.fail(`attendu « ${chaine} » (${texte}), affiché ${JSON.stringify(await page.evaluate(() => (window as any).__affiche()))}`) }
          }
          await page.goto(c.base + '/app' + adresse)
          await voir(premiere[0], premiere[1])
          await page.evaluate(() => { (window as any).__bout().el.__marque = 'premiere' })
          for (const [vers, chaine, texte, avant] of etapes) {
            if (avant) await page.evaluate(avant)
            if (vers === 'precedent') await page.evaluate(() => history.back())
            else await page.evaluate((h: string) => { location.hash = h }, vers)
            await voir(chaine, texte)
            await page.waitForTimeout(100)
          }
          await page.evaluate(() => Promise.all((window as any).__requetes))
          const r = await page.evaluate(() => ({ journal: (window as any).__journal as string[], enfants: (window as any).__enfants as string[], detruits: (window as any).__detruits as string[], marque: (window as any).__affiche().marque as string }))
          return { ...r, chargements: c.chargements.slice(), exceptions }
        }
        finally { await contexte.close() }
      }

      it('réunion, autre layout, puis page sœur : la réunion ne se réveille pas avec les paramètres de l\'adresse nouvelle ; le Précédent la rend avec les siens, depuis le cache', async () => {
        const r = await parcours('#/meeting/keep/abc123', ['mjs-bare-layout > mjs-meeting-keep-page', 'abc123'], [
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['#/profile/assistant', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil'],
          ['precedent', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['precedent', 'mjs-bare-layout > mjs-meeting-keep-page', 'abc123']
        ])
        assert.deepEqual(r.journal, ['reunion:abc123', 'humeur', 'profil', 'humeur', 'reunion:abc123'], 'AVANT : « reunion:undefined » avant « profil », puis « profil » réveillé au retour de la réunion')
        assert.deepEqual(r.chargements, ['/app/meetings/abc123', '/app/meetings/abc123'], 'AVANT : une requête /app/meetings/undefined')
        assert.equal(r.marque, 'premiere', 'la page de la réunion revient du cache, la même instance')
        assert.deepEqual(r.exceptions, [])
      })

      it('passage direct dans le même layout : un réveil par page affichée', async () => {
        const r = await parcours('#/meeting/keep/abc123', ['mjs-bare-layout > mjs-meeting-keep-page', 'abc123'], [
          ['#/profile/assistant', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil'],
          ['precedent', 'mjs-bare-layout > mjs-meeting-keep-page', 'abc123']
        ])
        assert.deepEqual(r.journal, ['reunion:abc123', 'profil', 'reunion:abc123'])
        assert.deepEqual(r.chargements, ['/app/meetings/abc123', '/app/meetings/abc123'])
        assert.equal(r.marque, 'premiere')
        assert.deepEqual(r.exceptions, [])
      })

      it('même page, autre réunion, à travers l\'autre layout : la page du cache se réveille une fois, avec la réunion de l\'adresse', async () => {
        const r = await parcours('#/meeting/keep/abc123', ['mjs-bare-layout > mjs-meeting-keep-page', 'abc123'], [
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['#/meeting/keep/xyz789', 'mjs-bare-layout > mjs-meeting-keep-page', 'xyz789']
        ])
        assert.deepEqual(r.journal, ['reunion:abc123', 'humeur', 'reunion:xyz789'])
        assert.deepEqual(r.chargements, ['/app/meetings/abc123', '/app/meetings/xyz789'])
        assert.equal(r.marque, 'premiere')
        assert.deepEqual(r.exceptions, [])
      })

      it('layout rendu par le cache sous une adresse que son `µurlChange` refuse : rien ne se réveille dans sa vue avant la garde, ni la page quittée ni la page gardée', async () => {
        const r = await parcours('#/meeting/keep/abc123', ['mjs-bare-layout > mjs-meeting-keep-page', 'abc123'], [
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['#/profile/secret', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil']
        ])
        assert.deepEqual(r.journal, ['reunion:abc123', 'humeur', 'profil'], 'AVANT : « reunion:undefined » avant la garde')
        assert.deepEqual(r.chargements, ['/app/meetings/abc123'])
        assert.deepEqual(r.exceptions, [])
      })

      it('layout dans le layout : la page du layout imbriqué ne se réveille pas non plus sous une adresse qui n\'est plus la sienne', async () => {
        const r = await parcours('#/club/rouge', ['mjs-bare-layout > mjs-club-layout > mjs-club-page', 'rouge'], [
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['#/club/rouge/membres', 'mjs-bare-layout > mjs-club-layout > mjs-club-members-page', 'membres rouge'],
          ['precedent', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['precedent', 'mjs-bare-layout > mjs-club-layout > mjs-club-page', 'rouge']
        ])
        assert.deepEqual(r.journal, ['club:rouge', 'humeur', 'membres:rouge', 'humeur', 'club:rouge'], 'AVANT : « club:rouge » réveillé sous #/club/rouge/membres, « membres:rouge » au retour')
        assert.equal(r.marque, 'premiere')
        assert.deepEqual(r.exceptions, [])
      })

      it('garde du layout rendu par le cache sous l\'adresse de sa page (déconnexion) : la réunion gardée ne se réveille pas hors du document, ni son enfant ; elle revient ensuite une fois, avec ses paramètres', async () => {
        const r = await parcours('#/meeting/keep/abc123', ['mjs-bare-layout > mjs-meeting-keep-page', 'abc123'], [
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['#/meeting/keep/abc123', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil', 'window.__deconnecte = true'],
          ['#/meeting/keep/abc123', 'mjs-bare-layout > mjs-meeting-keep-page', 'abc123', 'window.__deconnecte = false']
        ])
        assert.deepEqual(r.journal, ['reunion:abc123', 'humeur', 'profil', 'reunion:abc123'], 'AVANT : « reunion:undefined » hors du document, avant « profil »')
        assert.deepEqual(r.enfants, ['badge:abc123', 'badge-humeur', 'badge:abc123'], 'AVANT : l\'enfant de la réunion réveillé hors du document')
        assert.deepEqual(r.chargements, ['/app/meetings/abc123', '/app/meetings/abc123'], 'AVANT : une requête /app/meetings/undefined')
        assert.equal(r.marque, 'premiere', 'la réunion revient du cache, la même instance')
        assert.deepEqual(r.exceptions, [])
      })

      it('garde du layout rendu par le cache sous l\'adresse de sa page sans paramètre : la page refusée ne se réveille pas hors du document', async () => {
        const r = await parcours('#/profile/assistant', ['mjs-bare-layout > mjs-profile-assistant-page', 'profil'], [
          ['#/profile/secret', 'mjs-bare-layout > mjs-profile-secret-page', 'secret', 'window.__secretOuvert = true'],
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ['#/profile/secret', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil', 'window.__secretOuvert = false']
        ])
        assert.deepEqual(r.journal, ['profil', 'secret', 'humeur', 'profil'], 'AVANT : « secret » réveillé hors du document, avant « profil »')
        assert.equal(r.marque, 'premiere', 'le profil revient du cache, la même instance')
        assert.deepEqual(r.exceptions, [])
      })

      it('page rendue par le cache qui renvoie ailleurs depuis son `µawake` : son enfant, dont la connexion attendait encore, ne se réveille pas hors du document', async () => {
        const r = await parcours('#/mood', ['mjs-mood-layout > mjs-mood-page', 'humeur'], [
          ['#/profile/assistant', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil'],
          ['#/mood', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil', 'window.__rebond = true'],
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur', 'window.__rebond = false']
        ])
        assert.deepEqual(r.journal, ['humeur', 'profil', 'humeur', 'profil', 'humeur'])
        assert.deepEqual(r.enfants, ['badge-humeur', 'badge-humeur'], 'AVANT : « badge-humeur hors du document » au renvoi')
        assert.equal(r.marque, 'premiere')
        assert.deepEqual(r.exceptions, [])
      })

      it('layout évincé du cache de vues de la racine : la page hibernée dans son propre cache est détruite avec lui', async () => {
        const r = await parcours('#/meeting/keep/abc123', ['mjs-bare-layout > mjs-meeting-keep-page', 'abc123'], [
          ['#/profile/assistant', 'mjs-bare-layout > mjs-profile-assistant-page', 'profil'],
          ['#/mood', 'mjs-mood-layout > mjs-mood-page', 'humeur'],
          ...L.map(n => [`#/l/${n}`, `mjs-l${n}-page`, `l${n}`] as [string, string, string])
        ])
        assert.deepEqual(r.detruits.slice().sort(), ['profil', 'reunion'], 'AVANT : la réunion, hibernée dans le cache du layout évincé, n\'est jamais détruite')
        assert.deepEqual(r.exceptions, [])
      })
    })
  }

  after(async function () {
    if (construction) {
      const k = await construction
      k.server.closeAllConnections()
      await new Promise(resolve => k.server.close(() => resolve(null)))
      construction = null
    }
    await terminateSharedWorkerPool()
  })
})

// le routeur seul sur happy-dom : la racine rend sous `/b` le layout qu'elle garde, dont la vue porte encore la page de
// `/a/:id` ; elle en sort avant le retour du layout — hibernée si le cache du layout la garde, détruite s'il l'a évincée
// pendant qu'elle était affichée (elle ne reviendrait plus, et rien d'autre ne la détruirait)
describe('layout rendu par le cache de vues : la page qui n\'est plus celle de l\'adresse sort de sa vue avant son retour', function () {
  const ici    = dirname(fileURLToPath(import.meta.url))
  const source = (f: string) => readFileSync(join(ici, '../src/runtime', f), 'utf-8')

  function scene(gardee: boolean) {
    const win: any = new Window({ url: 'http://localhost/#/b' })
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const µ      = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', `${source('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')}\n${source('mjs_page_cache.ts')}\n${source('mjs_router.ts')}\nreturn µ;`)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet)
      const doc    = win.document
      const zone   = (hote: any, id: string) => { const v = doc.createElement('metamjs-view'); v.id = id; hote.appendChild(v); return v }
      const racine = doc.createElement('div')
      const layout = doc.createElement('mjs-lay')
      const page   = doc.createElement('mjs-page-a')
      const morts  = { n: 0 }

      racine._shadow = racine
      layout._shadow = layout
      layout.routes  = { v: { '/a/:id': 'page-a', '/b': 'page-b' } }

      page._mjs_route_key           = 'v-page-a'
      page._mjs_runDestroyCallbacks = () => { morts.n++ }

      const vueRacine   = zone(racine, 'main')
      const cacheLayout = new µ.LRUCache(10)
      const cacheRacine = new µ.LRUCache(10)
      zone(layout, 'v').appendChild(page)
      if (gardee) cacheLayout.set('v-page-a', page)
      cacheRacine.set('main-lay', layout)
      µ.Router.cache.set(layout, cacheLayout)
      µ.Router.cache.set(racine, cacheRacine)
      µ.Router._mjs_injectView(racine, 'main', 'lay', '/b')
      return { revenu: vueRacine.firstElementChild === layout, sortie: !page.parentNode, hibernee: page._mjs_page_cached === true, morts: morts.n }
    }
    finally { win.close?.() }
  }

  it('gardée par le cache du layout : elle hiberne, sans destruction', () => {
    const r = scene(true)
    assert.ok(r.revenu, 'le layout revient du cache')
    assert.ok(r.sortie, 'AVANT : la page de /a/:id reste dans la vue du layout rendu sous /b')
    assert.equal(r.hibernee, true)
    assert.equal(r.morts, 0)
  })

  it('évincée du cache du layout pendant qu\'elle était affichée : elle est détruite à sa sortie', () => {
    const r = scene(false)
    assert.ok(r.revenu, 'le layout revient du cache')
    assert.ok(r.sortie, 'AVANT : la page de /a/:id reste dans la vue du layout rendu sous /b')
    assert.equal(r.hibernee, false)
    assert.equal(r.morts, 1)
  })
})

// le cache de pages seul sur happy-dom : un layout évincé d'un cache de vues emporte les pages hibernées dans son propre
// cache, qui ne sont pas dans son DOM ; un layout encore dans la page (évincé pendant qu'il est affiché) garde les siennes
describe('layout évincé d\'un cache de vues : les pages hibernées dans son propre cache partent avec lui', function () {
  const ici    = dirname(fileURLToPath(import.meta.url))
  const source = (f: string) => readFileSync(join(ici, '../src/runtime', f), 'utf-8')

  function eviction(dansLaPage: boolean) {
    const win: any = new Window({ url: 'http://localhost/#/' })
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const µ        = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', `${source('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')}\n${source('mjs_page_cache.ts')}\n${source('mjs_router.ts')}\nreturn µ;`)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet)
      const doc      = win.document
      const morts    = [] as string[]
      const mortel   = (tag: string) => { const el = doc.createElement(tag); el._mjs_runDestroyCallbacks = function (this: any) { if (!this.__mort) { this.__mort = true; morts.push(tag) } }; return el }
      const layout   = mortel('mjs-lay')
      const affichee = mortel('mjs-page-b')
      const gardee   = mortel('mjs-page-a')
      const vue      = doc.createElement('metamjs-view')
      const cache    = new µ.LRUCache(10)

      gardee._mjs_page_cached = true
      cache.onEvict           = (_k: string, el: any) => µ._mjs_destroyEvictedTree(el)
      layout.appendChild(vue).appendChild(affichee)
      gardee.appendChild(mortel('mjs-badge'))
      cache.set('v-page-a', gardee)
      cache.set('v-page-b', affichee)
      µ.Router.cache.set(layout, cache)
      if (dansLaPage) doc.body.appendChild(layout)
      µ._mjs_destroyEvictedTree(layout)
      return { morts: morts.sort(), garde: cache.has('v-page-a') }
    }
    finally { win.close?.() }
  }

  it('layout abandonné : sa page affichée et la page hibernée dans son cache sont détruites, enfant compris', () => {
    const r = eviction(false)
    assert.deepEqual(r.morts, ['mjs-badge', 'mjs-lay', 'mjs-page-a', 'mjs-page-b'], 'AVANT : la page hibernée dans le cache du layout, et son enfant, ne sont jamais détruits')
    assert.equal(r.garde, false)
  })

  it('layout encore dans la page : rien n\'est détruit, son cache garde ses pages', () => {
    const r = eviction(true)
    assert.deepEqual(r.morts, [])
    assert.equal(r.garde, true)
  })
})
