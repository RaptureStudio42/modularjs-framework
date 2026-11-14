// layout évincé du cache de vues de son parent PENDANT qu'il est affiché (deux vues : l'autre fait défiler plus de dix
// pages), puis remplacé : à sa sortie de la page il est détruit, et la page hibernée dans son propre cache part avec lui
// (`µdestroy`, minuteries et abonnements arrêtés) ; tant qu'il reste affiché, il garde ses pages. Le layout n'a pas de
// `µdestroy` à lui. Témoin : un layout seulement hiberné (gardé par le cache) ne détruit rien et revient avec sa page.
// Chromium, Firefox et WebKit réels, vrai build servi par HTTP ; le nettoyage du cache, rejoué à chaque destruction (le
// composant détruit peut revenir dans la page), se vérifie aussi sans navigateur, sur happy-dom

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
interface Construction { base: string, server: Server }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

// onze pages dans la vue `b` du layout extérieur : elles poussent le layout intérieur, affiché dans la vue `a`, hors du
// cache de vues (dix entrées) ; chaque page note son réveil et sa destruction
const N    = Array.from({ length: 11 }, (_, i) => i + 1)
const PAGE = (nom: string) => `<script>\n  µawake -> window.__k.push('${nom}-awake')\n  µdestroy -> window.__k.push('${nom}-destroy')\n</script>\n<p>${nom}</p>\n`
const SOURCES: Record<string, string> = {
  'app.page.mjs':          '<routes target="main">\n/x/*  outer-layout\n/w/*  outer-layout\n</routes>\n<@view main>\n',
  'outer-layout.page.mjs': `<routes target="a">\n/x/*  inner-layout\n/w/*  wa-page\n</routes>\n<routes target="b">\n${N.map(n => `/x/${n}  b${n}-page\n`).join('')}/w/*  wb-page\n</routes>\n<@view a>\n<@view b>\n`,
  'inner-layout.page.mjs': '<routes target="in">\n/x/1  pa-page\n/x/*  pb-page\n</routes>\n<@view in>\n',
  'pa-page.mjs':           PAGE('pa'),
  'pb-page.mjs':           PAGE('pb'),
  'wa-page.mjs':           PAGE('wa'),
  'wb-page.mjs':           PAGE('wb'),
  ...Object.fromEntries(N.map(n => [`b${n}-page.mjs`, PAGE(`b${n}`)]))
}

let construction: Promise<Construction> | null = null

async function bati(): Promise<Construction> {
  const root   = mjsTmp('routeur-layout-evince-affiche')
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
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
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
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

const compte = (k: string[], x: string) => k.filter(y => y === x).length

describe('layout évincé du cache de vues pendant qu\'il est affiché : à sa sortie, les pages de son cache partent avec lui — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      this.timeout(120000)
      let browser: any = null
      let c: Construction

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        if (!construction) construction = bati()
        c       = await construction
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async function () {
        if (browser) await browser.close()
      })

      // ouvre `#/x/1`, suit les adresses, chacune finie au réveil attendu ; rend le journal après chaque étape
      async function parcours(etapes: Array<[string, string]>) {
        const contexte   = await browser.newContext()
        const exceptions = [] as string[]
        try {
          const page = await contexte.newPage()
          page.on('pageerror', (e: any) => exceptions.push(String(e)))
          await page.addInitScript(() => { (window as any).__k = [] })
          await page.goto(c.base + '/app#/x/1')
          await page.waitForFunction(() => (window as any).__k.includes('pa-awake') && (window as any).__k.includes('b1-awake'), null, { timeout: 10000 })
          const journaux = [] as string[][]
          for (const [vers, attendu] of etapes) {
            const avant = await page.evaluate(() => (window as any).__k.length)
            await page.evaluate((h: string) => { location.hash = h }, vers)
            try { await page.waitForFunction(([x, n]: [string, number]) => (window as any).__k.slice(n).includes(x), [attendu, avant] as [string, number], { timeout: 10000 }) }
            catch { assert.fail(`${vers} : « ${attendu} » attendu, journal ${JSON.stringify(await page.evaluate(() => (window as any).__k))}`) }
            await page.waitForTimeout(100)
            journaux.push(await page.evaluate(() => (window as any).__k.slice()))
          }
          return { journaux, exceptions }
        }
        finally { await contexte.close() }
      }

      it('évincé pendant qu\'il est affiché : il garde ses pages tant qu\'il reste dans la page ; remplacé, la page hibernée dans son cache reçoit µdestroy, une fois', async () => {
        const r   = await parcours([...N.slice(1).map(n => [`#/x/${n}`, `b${n}-awake`] as [string, string]), ['#/w/1', 'wa-awake']])
        const fin = r.journaux[r.journaux.length - 1]
        assert.equal(compte(r.journaux[r.journaux.length - 2], 'pa-destroy'), 0, 'encore affiché, le layout évincé garde la page de son cache')
        assert.equal(compte(fin, 'pb-destroy'), 1, 'la page affichée dans le layout parti est détruite une fois')
        assert.equal(compte(fin, 'pa-destroy'), 1, 'AVANT : la page hibernée dans le cache du layout parti n\'est jamais détruite')
        assert.deepEqual(r.exceptions, [])
      })

      it('témoin : un layout gardé par le cache hiberne avec ses pages et revient avec la sienne, rien n\'est détruit', async () => {
        const r   = await parcours([['#/x/2', 'pb-awake'], ['#/w/1', 'wa-awake'], ['#/x/2', 'b2-awake']])
        const fin = r.journaux[r.journaux.length - 1]
        assert.deepEqual(fin.filter(x => x.endsWith('-destroy')), [])
        assert.equal(compte(fin, 'pb-awake'), 2, 'la page du layout revient du cache et se réveille')
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

// le routeur seul sur happy-dom : l'hôte des vues a la file de nettoyage du cycle de vie (vidée, puis jouée, à chaque
// destruction) ; ses pages notent leur destruction
describe('cache de vues d\'un composant détruit : vidé à chaque destruction, retour dans la page compris', function () {
  const ici    = dirname(fileURLToPath(import.meta.url))
  const source = (f: string) => readFileSync(join(ici, '../src/runtime', f), 'utf-8')

  it('les pages gardées dans ses vues sont détruites avec lui ; revenu, il garde son cache, vide, et la destruction suivante le vide de même', () => {
    const win: any = new Window({ url: 'http://localhost/#/a' })
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const µ        = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', `${source('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')}\n${source('mjs_page_cache.ts')}\n${source('mjs_router.ts')}\nreturn µ;`)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet)
      const doc      = win.document
      const hote     = doc.createElement('mjs-lay')
      const vue      = doc.createElement('metamjs-view')
      const morts    = [] as string[]
      const afficher = (page: string) => {
        µ.Router._mjs_injectView(hote, 'v', page, '/' + page)
        const el = vue.firstElementChild
        el._mjs_runDestroyCallbacks = function (this: any) { morts.push(this.tagName.toLowerCase()) }
        return el
      }
      const detruire = () => { const cbs = hote.__cbs || []; hote.__cbs = null; cbs.forEach((f: any) => f()) }

      vue.id              = 'v'
      hote._shadow        = hote
      hote._mjs_onDestroy = (fn: any) => { (hote.__cbs ||= []).push(fn) }
      hote.appendChild(vue)
      afficher('page-a')
      afficher('page-b')
      const cache = µ.Router.cache.get(hote)
      detruire()
      assert.deepEqual(morts.splice(0).sort(), ['mjs-page-a', 'mjs-page-b'], 'AVANT : la page hibernée dans les vues du composant détruit ne l\'est jamais')
      assert.equal(cache.size, 0)
      assert.equal(hote.__cbs.length, 1, 'le nettoyage se réinscrit')
      const b = vue.firstElementChild
      afficher('page-c')
      assert.ok(b._mjs_page_cached !== true, 'la page détruite qui quitte la vue n\'est pas marquée hibernée hors de tout cache')
      afficher('page-d')
      assert.ok(µ.Router.cache.get(hote) === cache, 'revenu, le composant garde son cache')
      detruire()
      assert.deepEqual(morts.sort(), ['mjs-page-c', 'mjs-page-d'])
    }
    finally { win.close?.() }
  })
})
