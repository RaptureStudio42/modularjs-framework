// le bouclier (`mjs-loading`, runtime/mjs_init.ts) ne montre une balise que lorsque plus aucun de ses ancêtres n'est caché : il remonte
// l'arbre aplati (le parent, le slot qui reçoit la balise, l'hôte d'une ombre). Un élément nommé de la page recouvre la propriété du même
// nom de `document` (`<form name="host">`, `<img name="parentNode">`, un `<object id="host">`), un champ celle de son formulaire : une
// remontée qui les lisait tournait sans fin, et la page gelait au premier composant. Treize pages, chacune avec un composant quelconque :
// - la page répond, le composant est rendu et visible, sans erreur
// - une quatorzième page compte les lectures faites sur `document` des propriétés qu'un élément nommé peut recouvrir : aucune
// construction de développement et de production, en fichiers séparés (`split`) et en un seul (`bundle`) ; Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const COMPOSANT = '<p class="t">texte</p>\n'
const C         = '<mjs-nn></mjs-nn>'

const CAS: Record<string, string> = {
  'témoin': C,
  'form name=host': '<form name="host"></form>' + C,
  'img name=host': '<img name="host" alt="">' + C,
  'iframe name=host': '<iframe name="host"></iframe>' + C,
  'object id=host': '<object id="host"></object>' + C,
  'embed name=host': '<embed name="host">' + C,
  'img name=parentNode': '<img name="parentNode" alt="">' + C,
  'img name=_shadow': '<img name="_shadow" alt="">' + C,
  'form name=shadowRoot': '<form name="shadowRoot"></form>' + C,
  'div id=host (window)': '<div id="host"></div>' + C,
  'form > input name=parentNode': '<form><input name="parentNode">' + C + '</form>',
  'form > input name=closest': '<form><input name="closest">' + C + '</form>',
  'form > input name=nodeType': '<form><input name="nodeType">' + C + '</form>',
}

// posé avant le cœur sur la page témoin : chaque propriété qu'un élément nommé peut recouvrir sur `document` et que la remontée lisait
// devient un accesseur propre qui compte ses lectures et rend la vraie valeur. `nodeType` n'est pas compté : la recherche des feuilles
// d'une vue le lit sur la racine de la balise, le document, où une valeur recouverte (un élément, jamais 11) l'arrête de même
const COMPTER = `(() => {
  window.__lu = {}
  for (const k of ['parentNode', 'host', '_shadow', 'shadowRoot']) {
    let P = Object.getPrototypeOf(document), d
    while (P && !(d = Object.getOwnPropertyDescriptor(P, k))) P = Object.getPrototypeOf(P)
    Object.defineProperty(document, k, { configurable: true, get() { __lu[k] = (__lu[k] || 0) + 1; return d ? (d.get ? d.get.call(this) : d.value) : undefined } })
  }
})()`

const VU = `(() => {
  const h = document.querySelector('mjs-nn')
  const o = h && (h.shadowRoot || h._shadow)
  const t = o && o.querySelector('.t')
  return !!t && !h.hasAttribute('mjs-loading') && getComputedStyle(t).visibility === 'visible'
})()`

const PAGES: Record<string, string> = {}
const NOMS = Object.keys(CAS)
NOMS.forEach((k, i) => { PAGES['/p' + i] = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${CAS[k]}</body></html>` })
PAGES['/compte'] = PAGES['/p0']

type Variante = { env: 'dev' | 'prod', js: 'split' | 'bundle' }
const VARIANTES: Variante[] = [{ env: 'dev', js: 'split' }, { env: 'dev', js: 'bundle' }, { env: 'prod', js: 'split' }, { env: 'prod', js: 'bundle' }]
const serveurs: Server[] = []
const bases = new Map<string, Promise<string>>()

const nomVariante = (v: Variante) => `${v.env === 'dev' ? 'développement' : 'production'}, ${v.js}`

// une construction et son service par variante, partagés par les trois moteurs
function servir(v: Variante): Promise<string> {
  const cle = v.env + '-' + v.js
  if (!bases.has(cle)) bases.set(cle, (async () => {
    const root   = mjsTmp('bouclier-nommes-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'nn.mjs'), COMPOSANT)
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

// une page gelée ne répond plus, et l'attente de Playwright qui la sonde ne rend pas toujours la main à sa propre échéance : chaque
// attente a sa borne
const borne = <T>(p: Promise<T>, ms: number, repli: T): Promise<T> => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(repli), ms))])

// la page répond et montre le composant (`true`), ou la raison de son échec
async function visite(browser: any, url: string, avant?: string): Promise<{ page: any, vu: any, erreurs: string[] }> {
  const erreurs: string[] = []
  const page = await borne(browser.newPage(), 10000, null)
  if (!page) return { page, vu: 'aucune page ouverte en 10 s', erreurs }
  page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 160)))
  if (avant) await page.addInitScript(avant)
  const vu = await borne(page.goto(url, { waitUntil: 'commit', timeout: 10000 }).then(() => page.waitForFunction(VU, null, { timeout: 4000 })).then(() => true, (e: any) => String(e.message).split('\n')[0].slice(0, 80)), 6000, 'page gelée')
  return { page, vu, erreurs }
}

after(async () => {
  for (const s of serveurs) s.close()
  await terminateSharedWorkerPool()
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`bouclier : un élément nommé de la page ne fait jamais tourner sa remontée sans fin (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let lancer: () => Promise<any>

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    lancer  = () => playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    browser = await lancer()
  })

  // une page gelée garde son processus, qui tourne et grossit : le navigateur est fermé avec eux, puis relancé
  async function relancer() {
    await borne(browser.close(), 10000, undefined)
    browser = await lancer()
  }

  after(async () => {
    if (browser) await borne(browser.close(), 10000, undefined)
  })

  for (const v of VARIANTES) it(`${nomVariante(v)} : les treize pages répondent, le composant y est rendu et visible ; rien n'est lu sur document`, async function () {
    if (!present) { this.skip(); return }
    const base     = await servir(v)
    const fautes: string[] = []
    for (let i = 0; i < NOMS.length; i++) {
      const { page, vu, erreurs } = await visite(browser, base + '/p' + i)
      if (vu !== true) fautes.push(`${NOMS[i]} : page gelée, ou composant ni rendu ni visible (${vu})`)
      if (erreurs.length) fautes.push(`${NOMS[i]} : ${erreurs.join(' | ')}`)
      if (vu !== true) await relancer()
      else await borne(page.close(), 3000, undefined)
    }
    const { page, vu } = await visite(browser, base + '/compte', COMPTER)
    const lu = vu === true ? await borne(page.evaluate('window.__lu'), 3000, 'page gelée') : `page gelée, ou composant ni rendu ni visible (${vu})`
    if (vu !== true) await relancer()
    else await borne(page.close(), 3000, undefined)
    if (JSON.stringify(lu) !== '{}') fautes.push(`page témoin, lectures faites sur document : ${JSON.stringify(lu)}`)
    assert.deepEqual(fautes, [], `${nom}, ${nomVariante(v)} :\n${fautes.join('\n')}`)
  })
})
