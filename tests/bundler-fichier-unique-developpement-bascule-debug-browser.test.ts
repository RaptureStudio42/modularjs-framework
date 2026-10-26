// En développement, le fichier unique (`"js": "bundle"`) garde la bascule `µ.debug = true` de la console, minifié ou non
//
// L'assemblage du fichier unique passe par esbuild avec `define: { 'µ.debug': 'false' }`, en développement comme en
// production. Un `define` ne remplace que les lectures d'un `µ` libre : dans le fichier assemblé, `µ` est la variable
// locale du cœur, et chaque module (unités, réglages, entrée) l'importe. Le remplacement ne touche donc rien, et la
// bascule tapée dans la console agit comme avec des fichiers séparés : le niveau de la console cède (`µ.log` reparle),
// et une lecture de `µ.debug` dans le code de l'appli voit la valeur tapée. Ce test le garde : un module qui lirait un
// `µ` libre aurait sa lecture remplacée par `false`, et la bascule resterait sans effet sur lui.
//
// Navigateur réel (Chromium) : la même appli construite en développement, au niveau muet, en fichiers séparés et en
// fichier unique, minifiée et lisible. Le fichier unique doit se conduire comme les fichiers séparés.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' }

// `lire` est le code de l'appli : il lit `µ.debug` et écrit par `µ.log`
const SONDE = [
  '<script>',
  '$compte = 0',
  "$vu = 'rien'",
  'µmount ->',
  '  $compte = 1',
  '  µ.log "sonde : µ.log de l appli au montage"',
  'lire = ->',
  '  $vu = String(µ.debug)',
  '  µ.log "sonde : µ.log de l appli au clic"',
  '</script>',
  '<p>compte {$compte}</p>',
  '<button class="lire" @click={lire}>lire</button>',
  '<p>vu {$vu}</p>',
].join('\n')

// niveau muet en développement : seul `µ.debug = true` peut rendre la parole à `µ.log`
const MUET = { dev: 'silent', prod: 'log' }

const VARIANTES: Record<string, Record<string, unknown>> = {
  'fichiers':          { logLevel: MUET },
  'fichiers-minifies': { minify: true, logLevel: MUET },
  'unique':            { js: 'bundle', logLevel: MUET },
  'unique-minifie':    { js: 'bundle', minify: true, logLevel: MUET },
}

// le texte de la page, racines fantômes des composants comprises (`_shadow`), lu dans le navigateur
const TEXTE = `(() => { let t = ''; const p = (n) => { const r = n._shadow || n.shadowRoot; if (r && r !== n) p(r); for (const c of n.childNodes) { if (c.nodeType === 3) t += c.textContent; else p(c) } }; p(document.body); return t })()`

// le clic sur le bouton de la sonde, cherché dans les mêmes racines
const CLIC = `(() => { const p = (n) => { const r = n._shadow || n.shadowRoot; if (r && r !== n) { const b = p(r); if (b) return b } for (const c of n.children) { if (c.matches('button.lire')) return c; const b = p(c); if (b) return b } return null }; const b = p(document.body); if (b) b.click(); return !!b })()`

// les bandeaux `// === mjs_xxx.ts ===` de la concaténation ne survivent pas à la minification, ni les espaces de `µ.Element = class Element`
// (sans le nom de `µ` : l'assemblage le renomme quand un module lit un `µ` libre)
const estMinifie = (code: string) => !code.includes('// === mjs_element.ts ===') && !/\.Element = class /.test(code)

// la conduite attendue, celle des fichiers séparés : muet avant la bascule, bavard après, et l'appli lit la valeur tapée
const ATTENDU = { montage: false, clicAvant: false, vuAvant: 'false', console: true, clicApres: true, vuApres: 'true' }

describe('développement, fichier unique — la bascule µ.debug de la console (navigateur réel)', function () {
  this.timeout(240000)

  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''
  let dist   = ''

  before(async () => {
    const root   = mjsTmp('fichier-unique-bascule-debug')
    const srcDir = join(root, 'src')
    dist = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sonde-bascule.mjs'), SONDE + '\n')
    for (const [nom, options] of Object.entries(VARIANTES)) {
      const sortie  = join(dist, nom)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(sortie, 'assets'), manifestPath: join(sortie, 'assets', 'bundle.js'), urlPrefix: `/${nom}/assets`, ...options } as any)
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
      writeFileSync(join(sortie, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="assets/bundle.js"></script></head><body><mjs-sonde-bascule></mjs-sonde-bascule></body></html>`)
    }
    server = createServer((req, res) => {
      const url     = (req.url ?? '').split('?')[0]
      const fichier = join(dist, url.endsWith('/') ? url + 'index.html' : url)
      if (!fichier.startsWith(dist) || !existsSync(fichier)) { res.writeHead(404); res.end('introuvable'); return }
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    origin  = 'http://127.0.0.1:' + (server!.address() as any).port
    browser = await chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise((resolve) => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  // la forme du build : un fichier unique (aucun mjs_core-*.js à côté) ou des fichiers séparés, et le fichier qui porte le cœur
  function forme(nom: string): { unique: boolean, coeur: string } {
    const assets  = join(dist, nom, 'assets')
    const fichier = readdirSync(assets).find((f) => /^mjs_core-.*\.js$/.test(f))
    return { unique: fichier === undefined, coeur: readFileSync(join(assets, fichier ?? 'bundle.js'), 'utf-8') }
  }

  // la valeur affichée par la sonde après un clic : celle attendue dès qu'elle s'affiche, sinon celle qui reste à l'écran
  async function cliquer(page: Page, attendu: string): Promise<string> {
    assert.ok(await page.evaluate(CLIC), 'le bouton de la sonde est introuvable')
    try { await page.waitForFunction(`${TEXTE}.includes(${JSON.stringify('vu ' + attendu)})`, undefined, { timeout: 5000 }) }
    catch { /* la valeur restée à l'écran est rendue ci-dessous */ }
    return /vu (\S+)/.exec(await page.evaluate(TEXTE))?.[1] ?? ''
  }

  // la visite : le composant monté et un clic, puis `µ.debug = true` et un `µ.log` tapés dans la console, puis un clic
  async function visite(nom: string): Promise<{ observe: typeof ATTENDU, erreurs: string[], logs: string[] }> {
    const page = await browser!.newPage()
    const logs: string[]    = []
    const erreurs: string[] = []
    page.on('console', (m) => { logs.push(m.text()) })
    page.on('pageerror', (e) => { erreurs.push(String(e)) })
    await page.goto(`${origin}/${nom}/`)
    try { await page.waitForFunction(`${TEXTE}.includes('compte 1')`, undefined, { timeout: 15000 }) }
    catch { throw new Error(`${nom} : le composant ne s'affiche pas — erreurs : ${erreurs.join(' | ')} — console : ${logs.join(' | ')}`) }
    const vuAvant = await cliquer(page, 'false')
    const bascule = logs.length
    assert.ok(await page.evaluate(() => typeof (window as any).µ === 'object'), `${nom} : window.µ est exposé en développement`)
    await page.evaluate(() => { const µ = (window as any).µ; µ.debug = true; µ.log('sonde : µ.log de la console') })
    const vuApres = await cliquer(page, 'true')
    await page.close()
    const avant   = (texte: string) => logs.slice(0, bascule).some((l) => l.includes(texte))
    const apres   = (texte: string) => logs.slice(bascule).some((l) => l.includes(texte))
    const observe = { montage: avant('au montage'), clicAvant: avant('au clic'), vuAvant, console: apres('de la console'), clicApres: apres('au clic'), vuApres }
    return { observe, erreurs, logs }
  }

  for (const [separes, unique, minifie] of [['fichiers', 'unique', false], ['fichiers-minifies', 'unique-minifie', true]] as const) {
    it(`${unique} : µ.debug = true tapé dans la console agit comme avec des fichiers séparés`, async () => {
      assert.deepEqual([forme(separes).unique, forme(unique).unique], [false, true], 'une variante en fichiers séparés, l\'autre en fichier unique')
      assert.equal(estMinifie(forme(separes).coeur), minifie)
      assert.equal(estMinifie(forme(unique).coeur), minifie)
      const temoin = await visite(separes)
      assert.deepEqual(temoin.erreurs, [])
      assert.deepEqual(temoin.observe, ATTENDU, `témoin en fichiers séparés — console : ${temoin.logs.join(' | ')}`)
      const vise = await visite(unique)
      assert.deepEqual(vise.erreurs, [])
      assert.deepEqual(vise.observe, temoin.observe, `le fichier unique se conduit autrement que les fichiers séparés — console : ${vise.logs.join(' | ')}`)
    })
  }
})
