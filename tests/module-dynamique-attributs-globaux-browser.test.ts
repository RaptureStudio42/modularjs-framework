// Ce que ce test garantit, dans les vrais navigateurs (Chromium, Firefox, WebKit ; un moteur absent est sauté), construction de
// développement et de production (fichiers séparés, composant chargé À LA DEMANDE : un `<@module>` ne nomme pas son composant à la
// compilation, sa balise existe donc avant sa définition) : les attributs globaux calculés `title`, `hidden`, `lang` et `slot` se posent
// sur la balise du composant monté, comme sur un composant écrit en dur.
// - `hidden={…}` cache vraiment le composant, une valeur fausse le montre de nouveau ;
// - la valeur suit sa variable, `null` retire l'attribut, la valeur fixe (`titre="Démo"`) reste ;
// - un composant chargé ensuite qui déclare `$title` le garde pour lui : sa balise n'a pas de bulle, il reçoit la valeur en prop ;
// - sa balise, montée avant sa définition avec quatre attributs globaux, n'attend sa définition qu'une fois (`customElements.whenDefined`).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const CARTE_A = '<script>\n  $titre = \'\'\n</script>\n<p class="c">A:{$titre}</p>\n'
const CARTE_B = '<script>\n  $title = \'\'\n</script>\n<p class="c">B:{$title}</p>\n'

// chaque attente d'une définition (`customElements.whenDefined`), comptée par balise dans `window.__attentes`, posée avant le framework
const ATTENTES = '{ const w = customElements.whenDefined.bind(customElements); window.__attentes = {}; customElements.whenDefined = (n) => { window.__attentes[n] = (window.__attentes[n] || 0) + 1; return w(n) } }'

const HOTE = `<script>
  $comp  = 'tuto-carte-a'
  $t     = 'T'
  $cache = false
  µmount ->
    window.__poser = (t, c) ->
      $t     = t
      $cache = c
    window.__choisir = (c) ->
      $comp = c
</script>
<@module $comp titre="Démo" title={$t} hidden={$cache} lang={$t} slot={$t}></@module>
`

async function construire(env: 'dev' | 'prod'): Promise<{ root: string; outDir: string }> {
  const root   = mjsTmp(`moddyn-glob-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  writeFileSync(join(srcDir, 'tuto-carte-a.mjs'), CARTE_A)
  writeFileSync(join(srcDir, 'tuto-carte-b.mjs'), CARTE_B)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'split' })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { root, outDir }
}

async function servir(root: string, outDir: string): Promise<{ url: string; server: Server }> {
  const html   = '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

// la balise montée dans l'ombre de <mjs-hote> : son nom, ses attributs triés, son texte et si elle est cachée — des chaînes seulement
const LIRE = `(() => {
  const el = document.querySelector('mjs-hote')._shadow.firstElementChild
  const p  = el._shadow && el._shadow.querySelector('.c')
  return { tag: el.localName, attributs: [...el.attributes].map((a) => a.name + '=' + a.value).sort(), texte: p ? p.textContent : '(rien)', cache: getComputedStyle(el).display === 'none' }
})()`

const PRETE = (tag: string, texte: string) => `(() => { const el = document.querySelector('mjs-hote')?._shadow?.firstElementChild; const p = el && el._shadow && el._shadow.querySelector('.c'); return !!el && el.localName === '${tag}' && !!p && p.textContent === '${texte}' })()`

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const

describe('<@module> — attributs globaux calculés sur la balise d\'un composant chargé à la demande (vrais navigateurs)', function () {
  this.timeout(240000)
  const builds: Record<string, { root: string; outDir: string }> = {}

  before(async () => {
    for (const env of ['dev', 'prod'] as const) builds[env] = await construire(env)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of MOTEURS) {
    describe(moteur, () => {
      let browser: any = null

      before(async function () {
        this.timeout(60000)
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) return this.skip()
        browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => { if (browser) await browser.close() })

      for (const env of ['dev', 'prod'] as const) {
        it(`${env} : hidden cache le composant, title, lang et slot sont sur sa balise, suivent leur variable et partent avec null`, async () => {
          const { url, server } = await servir(builds[env].root, builds[env].outDir)
          const page             = await browser.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: Error) => erreurs.push(e.message))
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          try {
            await page.addInitScript(ATTENTES)
            await page.goto(url, { waitUntil: 'load' })
            await page.waitForFunction(PRETE('mjs-tuto-carte-a', 'A:Démo'), null, { timeout: 15000 })
            await page.waitForTimeout(100)
            assert.deepEqual(await page.evaluate(LIRE), { tag: 'mjs-tuto-carte-a', attributs: ['lang=T', 'slot=T', 'title=T', 'titre=Démo'], texte: 'A:Démo', cache: false }, 'au montage')

            await page.evaluate(`window.__poser('U', true)`)
            await page.waitForTimeout(100)
            assert.deepEqual(await page.evaluate(LIRE), { tag: 'mjs-tuto-carte-a', attributs: ['hidden=', 'lang=U', 'slot=U', 'title=U', 'titre=Démo'], texte: 'A:Démo', cache: true }, 'hidden={true} cache le composant')

            await page.evaluate(`window.__poser(null, false)`)
            await page.waitForTimeout(100)
            assert.deepEqual(await page.evaluate(LIRE), { tag: 'mjs-tuto-carte-a', attributs: ['titre=Démo'], texte: 'A:Démo', cache: false }, 'null et false retirent les attributs')

            assert.equal(await page.evaluate(`!!customElements.get('mjs-tuto-carte-b')`), false, 'garde muette : le second composant n\'est pas encore chargé')
            await page.evaluate(`window.__poser('V', true)`)
            await page.evaluate(`window.__choisir('tuto-carte-b')`)
            await page.waitForFunction(PRETE('mjs-tuto-carte-b', 'B:V'), null, { timeout: 15000 })
            await page.waitForTimeout(100)
            assert.deepEqual(await page.evaluate(LIRE), { tag: 'mjs-tuto-carte-b', attributs: ['hidden=', 'lang=V', 'slot=V', 'titre=Démo'], texte: 'B:V', cache: true }, 'le composant qui déclare `$title` garde la valeur pour lui')
            assert.equal(await page.evaluate("window.__attentes['mjs-tuto-carte-b'] || 0"), 1, 'une seule attente de la définition pour les quatre attributs globaux de la balise')

            await page.evaluate(`window.__poser('W', false)`)
            await page.waitForTimeout(100)
            assert.deepEqual(await page.evaluate(LIRE), { tag: 'mjs-tuto-carte-b', attributs: ['lang=W', 'slot=W', 'titre=Démo'], texte: 'B:W', cache: false })
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
            await new Promise(resolve => server.close(() => resolve(null)))
          }
        })
      }
    })
  }
})
