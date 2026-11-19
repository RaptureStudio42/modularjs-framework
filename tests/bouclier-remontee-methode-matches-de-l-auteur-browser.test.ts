// Un composant qui déclare `@matches` (les profils compatibles d'un site de rencontres) ou `@closest` (le lieu le plus proche) garde ces
// noms pour lui, jusque dans la sortie du bouclier : la remontée qui cherche un ancêtre encore caché demande « mon parent est-il un
// formulaire ? », puis le premier ancêtre qui n'en est pas un, au moteur par les méthodes de la balise elle-même, jamais par celles de l'auteur.
//
// Pourquoi ce test existe : dans un composant, `this` est sa balise, et `@matches = …` masque la méthode du même nom. Une remontée qui
// écrivait `n.matches('form>*')` appelait la méthode de l'auteur avec ce sélecteur, à chaque composant affiché sous elle : son effet
// partait (compteur, requête), et une méthode qui attend un profil levait — le composant gardait `mjs-loading` et restait invisible,
// avec tout ce qu'il contient. De même pour `closest`, demandé à l'enfant direct d'un `<form>` : un `@closest` qui rend un nom de ville
// envoyait la remontée sur ce texte, et le composant restait invisible.
//
// Ce que le test garde, pour trois composants posés dans une balise ordinaire (`@matches` qui rend une liste, `@matches` qui lit son
// argument, `@matches` et `@closest` ensemble) et pour le dernier posé dans un `<form>` : aucune méthode de l'auteur n'est appelée,
// chaque composant et sa carte se voient, sans erreur. Construction de développement et de production, en fichiers séparés (`split`) et en un seul (`bundle`) ; Chromium, Firefox et
// WebKit réels.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const CORPS = '\n<p class="t">texte</p>\n<div><@carte></@carte></div>\n'

const SOURCES: Record<string, string> = {
  'rencontres.mjs': ['<script>', '@matches = ->', '  window.__appels.push(\'rencontres.matches\')', '  [\'un profil\']', '</script>'].join('\n') + CORPS,
  'filtre.mjs': ['<script>', '@matches = (profil) ->', '  window.__appels.push(\'filtre.matches\')', '  profil.gouts.includes(\'jazz\')', '</script>'].join('\n') + CORPS,
  'lieux.mjs': ['<script>', '@matches = (lieu) ->', '  window.__appels.push(\'lieux.matches\')', '  [\'Lyon\']', '@closest = (lieu) ->', '  window.__appels.push(\'lieux.closest\')', '  \'Paris\'', '</script>'].join('\n') + CORPS,
  'carte.mjs': '<p class="t">carte</p>\n'
}

const CAS: Record<string, string> = {
  '@matches qui rend une liste, dans un <main>': '<main><mjs-rencontres></mjs-rencontres></main>',
  '@matches qui lit son argument, dans une <section>': '<section><mjs-filtre></mjs-filtre></section>',
  '@matches et @closest, dans un <div>': '<div><mjs-lieux></mjs-lieux></div>',
  '@matches et @closest, enfant direct d\'un <form>': '<form><mjs-lieux></mjs-lieux></form>'
}

const PAGES: Record<string, string> = {}
const NOMS = Object.keys(CAS)
NOMS.forEach((k, i) => { PAGES['/p' + i] = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script>window.__appels = []</script><script type="module" src="/out/bundle.js"></script></head><body>${CAS[k]}</body></html>` })

// le composant et sa carte sont sortis du bouclier et se voient
const VU = `(() => {
  const h = document.querySelector('mjs-rencontres,mjs-filtre,mjs-lieux')
  const o = h && h._shadow
  const t = o && o.querySelector('.t')
  const c = o && o.querySelector('mjs-carte')
  const u = c && c._shadow && c._shadow.querySelector('.t')
  return !!t && !!u && !h.hasAttribute('mjs-loading') && !c.hasAttribute('mjs-loading') && getComputedStyle(t).visibility === 'visible' && getComputedStyle(u).visibility === 'visible'
})()`

type Variante = { env: 'dev' | 'prod', js: 'split' | 'bundle' }
const VARIANTES: Variante[] = [{ env: 'dev', js: 'split' }, { env: 'dev', js: 'bundle' }, { env: 'prod', js: 'split' }, { env: 'prod', js: 'bundle' }]
const serveurs: Server[] = []
const bases = new Map<string, Promise<string>>()

const nomVariante = (v: Variante) => `${v.env === 'dev' ? 'développement' : 'production'}, ${v.js}`

// une construction et son service par variante, partagés par les trois moteurs
function servir(v: Variante): Promise<string> {
  const cle = v.env + '-' + v.js
  if (!bases.has(cle)) bases.set(cle, (async () => {
    const root   = mjsTmp('bouclier-matches-auteur-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: v.js, env: v.env } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (PAGES[chemin]) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PAGES[chemin])
        return
      }
      const fichier = join(outDir, normalize(chemin.replace(/^\/out\//, '/')))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : (extname(fichier) === '.css' ? 'text/css' : 'application/json') })
      res.end(readFileSync(fichier))
    })
    serveurs.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    return `http://127.0.0.1:${(server.address() as any).port}`
  })())
  return bases.get(cle)!
}

after(async () => {
  for (const s of serveurs) s.close()
  await terminateSharedWorkerPool()
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`bouclier : la remontée n'appelle jamais la méthode @matches d'un composant (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (present) browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => { await browser?.close() })

  for (const v of VARIANTES) it(`${nomVariante(v)} : aucune méthode de l'auteur appelée, composant et carte visibles`, async function () {
    if (!present) { this.skip(); return }
    const base = await servir(v)
    const rate: string[] = []
    for (let i = 0; i < NOMS.length; i++) {
      const erreurs: string[] = []
      const page = await browser.newPage()
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 120)))
      await page.goto(base + '/p' + i, { waitUntil: 'load', timeout: 20000 })
      const vu     = await page.waitForFunction(VU, null, { timeout: 5000 }).then(() => true, () => false)
      const appels = await page.evaluate('window.__appels')
      await page.close()
      if (!vu) rate.push(`${NOMS[i]} : le composant ou sa carte reste caché`)
      if (appels.length) rate.push(`${NOMS[i]} : ModularJS a appelé ${appels.length} fois la méthode de l'auteur (${[...new Set(appels)].join(', ')})`)
      if (erreurs.length) rate.push(`${NOMS[i]} : ${erreurs.join(' | ')}`)
    }
    assert.deepEqual(rate, [])
  })
})
