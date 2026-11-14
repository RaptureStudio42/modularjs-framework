// feuilles des composants légers (`mjs-light`) sous CSP : une feuille construite, adoptée par le document ou par l'ombre de l'hôte, au lieu
// d'un `<style>` qu'une politique sans 'unsafe-inline' refuse. `µ._csp` n'est posé que par le manifeste d'une appli `csp: true` : sans ce
// réglage, le cœur ne porte plus cette voie (blocs `<csp>` de mjs_element.ts), en production, en développement, cœur entier compris ; avec
// lui, il la garde. Navigateurs réels (Chromium, Firefox, WebKit), page servie avec un en-tête CSP : l'appli `csp: true` colore ses légers, à la
// racine comme dans une ombre, sans un seul `<style>` ; l'appli sans le réglage colore les siens par `<style>`, même quand `µ._csp` est posé
// à la main (la voie CSP n'y est plus) ; témoin, la même appli sous l'en-tête : ses `<style>` sont refusés, l'en-tête agit bien

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const LEGER = '<script>\n$t = "salut"\n</script>\n<p class="t">{$t}</p>\n<style>\n:host\n  padding: 1px\n.t\n  color: rgb(200, 10, 20)\n</style>\n'
const HOTE  = '<div class="cadre">\n  <@leger mjs-light>\n</div>\n<style>\n.cadre\n  margin: 2px\n</style>\n'
const ROUGE = 'rgb(200, 10, 20)'
const CSP   = 'default-src \'self\'; style-src \'self\''

// la voie CSP des légers, par trois de ses lignes (la table `µ._mjs_lightSheetsByTag` est aussi lue, en développement, par le
// rechargement CSS à chaud, qui se passe d'elle quand elle manque)
const VOIE = ['const adopt = (root) => {', 'lightRoot._mjs_mjsLightSheets ??= new Map();', 'adopt(document);']

const coeur = async (opts: Record<string, unknown>) => {
  const out     = mjsTmp('csp-legers-coeur')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const chemin  = await bundler.bundleRuntime(scanCompiledFeatures((await transpile(LEGER, { moduleName: 'leger' })).output))
  return chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(chemin)), 'utf-8')
}
const valide = (texte: string) => assert.doesNotThrow(() => acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')

describe('cœur : la voie CSP des légers seulement avec csp: true', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('sans csp: true, ni la voie ni ses marques, le <style> des légers reste — production, développement, cœur entier', async () => {
    for (const [cas, opts] of [['production', { env: 'prod' }], ['développement', {}], ['runtime: \'all\'', { env: 'prod', runtime: 'all' }]] as const) {
      const texte = await coeur(opts)
      for (const j of VOIE) assert.ok(!texte.includes(j), `${cas} : « ${j} » est encore là`)
      assert.doesNotMatch(texte, /^[ \t]*\/\/ <\/?csp>$/m, `${cas} : une marque du bloc est restée seule`)
      assert.ok(texte.includes('lightStyleEl.setAttribute(\'data-mjs-light\', tag);'), `${cas} : le <style> des légers manque`)
      valide(texte)
    }
  })

  it('avec csp: true, la voie reste, en production comme en développement', async () => {
    for (const [cas, opts] of [['production', { env: 'prod', csp: true }], ['développement', { csp: true }]] as const) {
      const texte = await coeur(opts)
      for (const j of VOIE) assert.ok(texte.includes(j), `${cas} : « ${j} » manque`)
      assert.doesNotMatch(texte, /^[ \t]*\/\/ <\/?csp>$/m, `${cas} : une marque du bloc est restée`)
      valide(texte)
    }
  })
})

type Appli = { racine: string, page: string }

// une appli : `csp` = production `csp: true` (CSS en fichiers, JavaScript en fichiers) ; sinon production en un seul fichier, ou développement
// (tout le JavaScript dans la page, `µ._csp` posé à la main juste après le cœur)
async function construire(nom: string, sorte: 'csp' | 'sans' | 'sans-dev-force'): Promise<Appli> {
  const root   = mjsTmp('csp-legers-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'leger.mjs'), LEGER)
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const dev     = sorte === 'sans-dev-force'
  const opts    = dev ? {} : sorte === 'csp' ? { env: 'prod', csp: true, css: 'split', urlPrefix: '/out' } : { env: 'prod', js: 'bundle', urlPrefix: '/out' }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const corps = '<mjs-leger mjs-light></mjs-leger><mjs-hote></mjs-hote>'
  if (!dev) return { racine: root, page: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}<script type="module" src="/out/bundle.js"></script></body></html>` }
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')) + (rang(f) === 0 ? '\nglobalThis.µ = µ;\nµ._csp = true;\n' : '')).join('\n')
  return { racine: root, page: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>` }
}

const applis = new Map<string, Promise<Appli>>()
const appli  = (sorte: 'csp' | 'sans' | 'sans-dev-force') => {
  if (!applis.has(sorte)) applis.set(sorte, construire(sorte, sorte))
  return applis.get(sorte) as Promise<Appli>
}

// la page servie (avec l'en-tête CSP ou sans), puis ce qu'elle montre : couleur des deux légers, `<style>` posés, feuilles adoptées qui les portent
async function voir(browser: any, a: Appli, enTete: boolean) {
  const ctx  = await browser.newContext()
  const page = await ctx.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
  try {
    await page.route('http://csp.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', headers: enTete ? { 'content-security-policy': CSP } : {}, body: a.page })
      const fichier = join(a.racine, normalize(chemin))
      if (!chemin.startsWith('/out/') || !existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
      const type = chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : chemin.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/json'
      return route.fulfill({ contentType: type, body: readFileSync(fichier) })
    })
    await page.goto('http://csp.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => {
      const h: any = document.querySelector('mjs-hote')
      return !!document.querySelector('mjs-leger .t') && !!h && !!h._shadow && !!h._shadow.querySelector('mjs-leger .t')
    }, null, { timeout: 10000 })
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const h: any  = document.querySelector('mjs-hote')
      const texte   = (s: any) => Array.from(s.cssRules).map((x: any) => x.cssText).join(' ')
      const portent = (l: any[]) => l.filter((s: any) => texte(s).indexOf('rgb(200, 10, 20)') !== -1).length
      return {
        racine:   getComputedStyle(document.querySelector('mjs-leger .t')!).color,
        ombre:    getComputedStyle(h._shadow.querySelector('mjs-leger .t')).color,
        styles:   document.querySelectorAll('style[data-mjs-light="mjs-leger"]').length + h._shadow.querySelectorAll('style[data-mjs-light="mjs-leger"]').length,
        adoptees: portent(document.adoptedStyleSheets) + portent(h._shadow.adoptedStyleSheets),
      }
    })
    return { ...r, erreurs }
  } finally {
    await ctx.close()
  }
}

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`légers sous CSP, voie gardée par csp: true seulement (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test des légers sous CSP sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('appli csp: true servie sous l\'en-tête : les deux légers colorés par une feuille adoptée, aucun <style>', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await voir(browser, await appli('csp'), true), { racine: ROUGE, ombre: ROUGE, styles: 0, adoptees: 2, erreurs: [] })
  })

  it('appli sans csp: true : ses légers colorés par <style>, même avec µ._csp posé à la main (la voie CSP n\'y est plus)', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await voir(browser, await appli('sans'), false), { racine: ROUGE, ombre: ROUGE, styles: 2, adoptees: 0, erreurs: [] })
    assert.deepEqual(await voir(browser, await appli('sans-dev-force'), false), { racine: ROUGE, ombre: ROUGE, styles: 2, adoptees: 0, erreurs: [] })
  })

  it('témoin : la même appli sans csp: true, servie sous l\'en-tête, voit ses <style> refusés', async function () {
    if (!present) { this.skip(); return }
    const r = await voir(browser, await appli('sans'), true)
    assert.ok(r.racine !== ROUGE && r.ombre !== ROUGE, `l'en-tête CSP n'a rien refusé : ${JSON.stringify(r)}`)
  })
})
