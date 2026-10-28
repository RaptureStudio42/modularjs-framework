// Preuve navigateur réel (Chromium, Firefox, WebKit) : la navigation suit elle-même une ancre de la page
// (`<a href="#section">`), comme le navigateur — défilement jusqu'à la cible, `:target` —, et le défilement natif coupé
// pour toute la page (`history.scrollRestoration = 'manual'`, posé pour les échanges de page) ne rejoue plus une position
// périmée : un second clic sur une ancre déjà quittée défile jusqu'à elle, et non plus jusqu'à la position qu'elle avait
// quand l'utilisateur l'avait quittée.
// Par défaut, la page est une vraie page : ses ancres n'ajoutent aucune entrée à l'historique, Précédent ramène à la
// page d'avant. Avec le réglage `µ._anchorHistory`, chaque ancre est une entrée : Précédent et Suivant vont d'ancre en
// ancre et rendent la position de chaque entrée, comme le navigateur seul.
//
// Page servie : mjs_page_cache + mjs_router + mjs_ujs réels ; la même page sans eux sert de témoin. Le réglage passe aussi
// par la configuration : un vrai bundle construit avec `"anchorHistory": true` dans mjs.config.json, sans clé `runtime`
// (les liens sont ceux d'une page servie hors construction : le réglage de navigation garde la navigation au cœur).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME   = join(__dirname, '..', 'src', 'runtime')
const LIB       = ['mjs_page_cache.ts', 'mjs_router.ts', 'mjs_ujs.ts'].map(f => '(function(µ){\n' + readFileSync(join(RUNTIME, f), 'utf-8') + '\n})(window.µ);').join('\n')
const STUB      = 'window.µ={log(){},warn(){},error(){},_mjs_txt:(k,p,f)=>f,_mjs_msg:(k,p,f)=>f,_mjs_logger:()=>null,config:{},state:(o)=>o||{}}'
// le bundle d'un projet dont mjs.config.json écrit `"anchorHistory": true` (construit une fois)
let bundle: Promise<string> | null = null
function bundleAvecLeReglage(): Promise<string> {
  bundle ??= (async () => {
    const racine = mjsTmp('ancres-config')
    mkdirSync(join(racine, 'src'), { recursive: true })
    writeFileSync(join(racine, 'src', 'page-app.mjs'), '<p>page</p>')
    writeFileSync(join(racine, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', js: 'bundle', anchorHistory: true }))
    const trouve = findConfig(racine)!
    const stats  = await new Bundler(resolveBundlerOpts(trouve.config, trouve.configDir)).compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await terminateSharedWorkerPool()
    return readFileSync(join(racine, 'out', 'bundle.js'), 'utf-8')
  })()
  return bundle
}
const CORPS     = '<nav style="position:fixed;top:0;left:0"><a id="la" href="#a">a</a> <a id="lb" href="#b">b</a></nav><div style="height:1500px"></div><h2 id="a">A</h2><div style="height:1500px"></div><h2 id="b">B</h2><div style="height:3000px"></div>'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`mjs_ujs navigateur réel (${nom}) — ancres d'une même page : la cible au clic, la position au Précédent`, function () {
    this.timeout(60000)
    let browser: Browser | null = null
    let server: Server | null  = null
    let origin  = ''
    let present = false

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) return this.skip()
      const construit = await bundleAvecLeReglage()
      browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      server  = createServer((req, res) => {
        const url = req.url || ''
        if (url === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(LIB); return }
        if (url === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(construit); return }
        let corps = '<p>avant</p>'
        if (url.startsWith('/natif')) corps = CORPS
        else if (url.startsWith('/mjs-config')) corps = CORPS + '<script type="module" src="/bundle.js"></script>'
        else if (url.startsWith('/mjs-entrees')) corps = CORPS + '<script>' + STUB + ';µ._anchorHistory=true</script><script src="/lib.js"></script>'
        else if (url.startsWith('/mjs')) corps = CORPS + '<script>' + STUB + '</script><script src="/lib.js"></script>'
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' + corps + '</body></html>')
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
      origin = 'http://127.0.0.1:' + (server!.address() as any).port
    })

    after(async () => {
      if (browser) await browser.close()
      if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    })

    async function pose(page: Page) {
      await page.waitForTimeout(300)
      return page.evaluate(() => new Promise<string>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(location.hash + ' y=' + Math.round(scrollY))))))
    }

    function haut(page: Page, id: string) {
      return page.evaluate((i) => '#' + i + ' y=' + Math.round(document.getElementById(i)!.getBoundingClientRect().top + scrollY), id)
    }

    async function ouvrir(chemin: string) {
      const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
      const erreurs: string[] = []
      page.on('pageerror', e => erreurs.push(e.message))
      await page.goto(origin + '/avant')
      await page.goto(origin + chemin)
      await page.evaluate(() => new Promise(ok => { scrollTo(0, 400); requestAnimationFrame(() => requestAnimationFrame(ok)) }))
      return { page, erreurs }
    }

    async function parcours(chemin: string) {
      const { page, erreurs } = await ouvrir(chemin)
      const vus: string[] = []
      await page.click('#la'); vus.push('clic #a → ' + await pose(page))
      await page.evaluate(() => new Promise(ok => { scrollBy(0, 600); requestAnimationFrame(() => requestAnimationFrame(ok)) }))
      await page.click('#lb'); vus.push('clic #b → ' + await pose(page))
      await page.click('#la'); vus.push('de nouveau #a → ' + await pose(page))
      await page.evaluate(() => history.back()); vus.push('Précédent → ' + await pose(page))
      await page.evaluate(() => history.back()); vus.push('Précédent → ' + await pose(page))
      await page.evaluate(() => history.back()); vus.push('Précédent → ' + await pose(page))
      await page.evaluate(() => history.forward()); vus.push('Suivant → ' + await pose(page))
      await page.evaluate(() => history.forward()); vus.push('Suivant → ' + await pose(page))
      await page.close()
      return { vus, erreurs }
    }

    it('avec µ._anchorHistory : #a, #b, de nouveau #a, trois Précédent, deux Suivant — mêmes positions que le navigateur seul', async function () {
      if (!present) return this.skip()
      const natif = await parcours('/natif')
      const mjs   = await parcours('/mjs-entrees')
      assert.deepEqual(mjs.erreurs, [])
      assert.deepEqual(mjs.vus, natif.vus, 'AVANT : le second clic sur #a rendait la position que #a avait quand l\'utilisateur l\'avait quittée, pas #a')
    })

    it('par la configuration (`"anchorHistory": true`, vrai bundle) : mêmes positions que le navigateur seul', async function () {
      if (!present) return this.skip()
      const natif = await parcours('/natif')
      const mjs   = await parcours('/mjs-config')
      assert.deepEqual(mjs.erreurs, [])
      assert.deepEqual(mjs.vus, natif.vus, 'AVANT : la clé était refusée (clé inconnue), le réglage ne passait que par `µ._anchorHistory` posé à la main')
    })

    it('par défaut : chaque ancre défile jusqu\'à sa cible (second clic compris), `:target` suit, aucune entrée d\'historique, Précédent ramène à la page d\'avant', async function () {
      if (!present) return this.skip()
      const { page, erreurs } = await ouvrir('/mjs')
      const longueur = await page.evaluate(() => history.length)
      const vus: string[]    = []
      const voulus: string[] = []
      await page.click('#la'); vus.push(await pose(page)); voulus.push(await haut(page, 'a'))
      await page.evaluate(() => new Promise(ok => { scrollBy(0, 600); requestAnimationFrame(() => requestAnimationFrame(ok)) }))
      await page.click('#lb'); vus.push(await pose(page)); voulus.push(await haut(page, 'b'))
      await page.click('#la'); vus.push(await pose(page)); voulus.push(await haut(page, 'a'))
      assert.deepEqual(vus, voulus, 'AVANT : le second clic sur #a rendait la position que #a avait quand l\'utilisateur l\'avait quittée')
      assert.equal(await page.evaluate(() => document.querySelector(':target') && document.querySelector(':target')!.id), 'a', '`:target` suit l\'ancre, comme le navigateur')
      assert.equal(await page.evaluate(() => history.length), longueur, 'AVANT : une entrée d\'historique par ancre')
      await page.goBack({ waitUntil: 'load' }).catch(() => null)
      await page.waitForTimeout(300)
      assert.equal(new URL(page.url()).pathname, '/avant', 'AVANT : Précédent revenait d\'ancre en ancre sur la même page')
      assert.deepEqual(erreurs, [])
      await page.close()
    })
  })
}
