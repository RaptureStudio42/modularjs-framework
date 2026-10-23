// production — noms courts des propriétés internes `_mjs_*` (esbuild `mangleProps`, cache partagé
// `<outputDir>/.mangle-cache.json`) contre les noms que le NAVIGATEUR porte déjà sur ses objets : `x` et
// `y` d'une image (en lecture seule), `id` et `dir` d'une balise, `at` et `map` d'un tableau. Une
// propriété interne se pose sur des nœuds (`node._mjs_outro`, la sortie d'une balise) : raccourcie en `x`,
// elle écrit dans `HTMLImageElement.x`, et le code du cœur est en mode strict — « Cannot set property x
// of #<HTMLImageElement> which has only a getter », le composant ne se construit plus. Le raccourcisseur
// choisit ses noms sans rien savoir du navigateur : lequel tombe sur quelle propriété dépend du nombre de
// propriétés internes du projet, une propriété de plus décale tout.
//
// Montage dans un Chromium réel (une image n'a de `x` en lecture seule que là). Chromium absent : le
// montage est sauté, les assertions sur le cache écrit restent.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { PLATFORM_NAMES, RESERVED_NAME_MAX_LENGTH } from '../src/bundler/minify.js'

type Cache = Record<string, string | false>

interface Projet { root: string; srcDir: string; outDir: string }

// noms courts que tout navigateur porte sur un nœud, un événement ou une collection
const TEMOINS = ['x', 'y', 'r', 'id', 'as', 'ch', 'cx', 'cy', 'at', 'dir', 'src', 'alt', 'rel', 'top', 'key', 'map', 'pop', 'get', 'set']

const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function projet(prefix: string): Projet {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  return { root, srcDir, outDir }
}

async function construire(p: Projet): Promise<void> {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'split' })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
}

function lireCache(p: Projet): Cache {
  return JSON.parse(readFileSync(join(p.outDir, '.mangle-cache.json'), 'utf-8'))
}

// propriétés internes dont le nom court est un des noms donnés
function collisions(cache: Cache, noms: string[]): string[] {
  return Object.entries(cache).filter(([, court]) => typeof court === 'string' && noms.includes(court)).map(([prop, court]) => `${prop} → ${court}`).sort()
}

async function servir(p: Projet, body: string): Promise<{ url: string; server: Server }> {
  const html   = `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}<script type="module" src="/out/bundle.js"></script></body></html>`
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if(chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(p.root, normalize(chemin))
    if(!fichier.startsWith(p.outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
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

async function navigateur(nom: 'chromium' | 'firefox' | 'webkit'): Promise<any> {
  try {
    const playwright = await import('playwright')
    if(!existsSync(playwright[nom].executablePath())) return null
    return await playwright[nom].launch()
  }
  catch {
    return null
  }
}

describe('production — noms courts des propriétés internes et noms que le navigateur porte déjà', function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    this.timeout(30000)
    browser = await navigateur('chromium')
    if(!browser) console.log('  ℹ️  Chromium non installé : montage sauté, assertions de construction gardées. Activer : `npx playwright install chromium`')
  })

  after(async () => {
    if(browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('un projet construit sans cache : aucune propriété interne ne prend un nom du navigateur, et ces noms sont réservés dans le cache écrit', async function () {
    const p = projet('mangle-navigateur')
    writeFileSync(join(p.srcDir, 'vue.mjs'), `<script>\n$vu = true\n</script>\n{if $vu}\n  <img src="${IMAGE}" alt="" @out=*fade>\n{end}\n`)
    await construire(p)
    const cache = lireCache(p)
    assert.deepEqual(collisions(cache, PLATFORM_NAMES), [], 'aucune propriété interne ne doit prendre un nom que le navigateur porte')
    assert.deepEqual(PLATFORM_NAMES.filter(nom => cache[nom] !== false), [], 'chaque nom du navigateur doit être réservé dans le cache écrit')
  })

  it('cache hérité d\'une construction plus ancienne (_mjs_outro → x) : l\'image qui porte une sortie s\'affiche, puis sort, sans erreur', async function () {
    const p = projet('mangle-navigateur-herite')
    mkdirSync(p.outDir, { recursive: true })
    writeFileSync(join(p.outDir, '.mangle-cache.json'), JSON.stringify({ _mjs_outro: 'x' }))
    writeFileSync(join(p.srcDir, 'vue.mjs'), `<script>\n$vu = true\n</script>\n<button @click={$vu = false}>cacher</button>\n{if $vu}\n  <img src="${IMAGE}" alt="" @out=*fade(duration: 40ms)>\n{end}\n`)
    await construire(p)
    const cache = lireCache(p)
    assert.deepEqual(collisions(cache, ['x']), [], 'la correspondance héritée doit être retirée du cache')
    assert.equal(cache.x, false, 'x doit être réservé dans le cache écrit')
    if(!browser) return
    const { url, server }   = await servir(p, '<mjs-vue></mjs-vue>')
    const page              = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if(m.type() === 'error') erreurs.push(m.text()) })
    try {
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForFunction(() => { const el = document.querySelector('mjs-vue') as any; return !!(el && el._shadow && el._shadow.querySelector('button')) }, null, { timeout: 10000 }).catch(() => {})
      const avant = await page.evaluate(() => { const s = (document.querySelector('mjs-vue') as any)._shadow; return s ? s.querySelectorAll('img').length : -1 })
      assert.equal(avant, 1, `l'image doit être affichée au départ — erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
      await page.evaluate(() => (document.querySelector('mjs-vue') as any)._shadow.querySelector('button').click())
      await page.waitForFunction(() => (document.querySelector('mjs-vue') as any)._shadow.querySelectorAll('img').length === 0, null, { timeout: 5000 }).catch(() => {})
      const apres = await page.evaluate(() => (document.querySelector('mjs-vue') as any)._shadow.querySelectorAll('img').length)
      assert.equal(apres, 0, `l'image doit être sortie — erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    }
    finally {
      await page.close()
      await new Promise(resolve => server.close(() => resolve(null)))
    }
  })
})

describe('relevé des noms courts que le navigateur porte déjà', function () {
  this.timeout(120000)

  it('la liste est sans doublon, ne dépasse pas la longueur des noms du raccourcisseur, et porte les noms des nœuds, des événements et des collections', function () {
    assert.equal(new Set(PLATFORM_NAMES).size, PLATFORM_NAMES.length, 'aucun doublon')
    assert.deepEqual(PLATFORM_NAMES.filter(n => n.length > RESERVED_NAME_MAX_LENGTH || !/^[A-Za-z_$][\w$]*$/.test(n)), [], 'des noms que le raccourcisseur peut produire, seulement')
    assert.deepEqual(TEMOINS.filter(n => !PLATFORM_NAMES.includes(n)), [], 'les témoins sont dans la liste')
  })

  // le relevé refait dans le navigateur : les noms d'au plus `max` caractères portés par le prototype de chaque
  // classe globale (et ses ancêtres), et en propre par window, document, navigator, une balise SVG, un événement,
  // le style d'une balise
  const releve = (max: number): string[] => {
    const noms    = new Set<string>()
    const vus     = new Set<any>()
    const ajouter = (n: any) => { if(typeof n === 'string' && n.length <= max && /^[A-Za-z_$][\w$]*$/.test(n)) noms.add(n) }
    const monter  = (objet: any) => {
      for(let o = objet; o && !vus.has(o); o = Object.getPrototypeOf(o)) {
        vus.add(o)
        for(const n of Object.getOwnPropertyNames(o)) ajouter(n)
      }
    }
    for(const g of Object.getOwnPropertyNames(window)) {
      ajouter(g)
      let v: any
      try { v = (window as any)[g] } catch { continue }
      if(typeof v === 'function' && v.prototype) monter(v.prototype)
    }
    vus.clear()
    for(const o of [document, navigator, document.createElementNS('http://www.w3.org/2000/svg', 'svg'), new Event('x'), document.createElement('div').style]) monter(o)
    return [...noms].sort()
  }

  for(const nom of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${nom} — chaque nom court que le navigateur porte est dans la liste`, async function () {
      const browser = await navigateur(nom)
      if(!browser) return this.skip()
      try {
        const page = await browser.newPage()
        await page.goto('about:blank')
        const noms = await page.evaluate(releve, RESERVED_NAME_MAX_LENGTH)
        assert.ok(noms.length > 50, `le relevé doit rendre des noms : ${noms.length}`)
        assert.deepEqual(noms.filter((n: string) => !PLATFORM_NAMES.includes(n)), [], 'noms du navigateur absents de la liste')
      }
      finally {
        await browser.close()
      }
    })
  }
})
