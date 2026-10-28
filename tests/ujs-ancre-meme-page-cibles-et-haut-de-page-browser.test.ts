// Preuve navigateur réel (Chromium, Firefox, WebKit) : les liens de la page affichée font ce que fait le navigateur seul.
// - `<a href="#">` et un lien vers la page courante remontent en haut de la page (avant : aucun effet) ;
// - la cible d'une ancre se cherche comme le navigateur (id, `<a name>`, `#top` pour le haut de la page) et aussi dans
//   l'ombre fermée d'un composant, que le navigateur ne voit pas : le clic et Suivant y défilent (avant : rien ne
//   bougeait) — l'arrivée sur la page par une adresse qui porte l'ancre se prouve sur un vrai projet, dont les
//   composants montent après le cœur (ujs-ancre-vrai-projet-arrivee-et-dernier-mot-browser.test.ts) ;
// - le survol d'une ancre de la page ou d'un lien vers elle ne la retélécharge pas (préchargement `hover`) ;
// - sous `scroll-behavior: smooth`, une position rendue (Précédent) et le haut d'une page reçue ne glissent pas.
//
// Page servie : mjs_page_cache + mjs_ajax + mjs_router + mjs_ujs réels ; l'hôte `#hote` porte une ombre fermée
// (rangée sous `_shadow`, comme un composant).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Browser, Page } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME   = join(__dirname, '..', 'src', 'runtime')
const LIB       = ['mjs_page_cache.ts', 'mjs_ajax.ts', 'mjs_router.ts', 'mjs_ujs.ts'].map(f => '(function(µ){\n' + readFileSync(join(RUNTIME, f), 'utf-8') + '\n})(window.µ);').join('\n')
const STUB      = 'window.µ={log(){},warn(){},error(){},_mjs_txt:(k,p,f)=>f,_mjs_msg:(k,p,f)=>f,_mjs_logger:()=>null,config:{},state:(o)=>o||{}}'
const OMBRE     = '<script>(function(){var h=document.getElementById(\'hote\'),r=h.attachShadow({mode:\'closed\'});r.innerHTML=\'<div style="height:600px"></div><h3 id="ombre">ombre</h3>\';h._shadow=r;window.ombre=function(){return Math.round(r.getElementById(\'ombre\').getBoundingClientRect().top+scrollY)}})()</script>'

// la page `chemin` : ses ancres, un lien vers elle-même et un lien vers une autre page (`?p=2`)
function corps(chemin: string, autre: boolean): string {
  return '<nav style="position:fixed;top:0;left:0;background:#fff"><a id="la" href="#a">a</a> <a id="lb" href="#b">b</a> <a id="lhaut" href="#">haut</a> <a id="lpage" href="' + chemin + '">page</a> <a id="ltop" href="#top">top</a> <a id="lnom" href="#nom">nom</a> <a id="lombre" href="#ombre">ombre</a> <a id="lautre" href="' + chemin + '?p=2">autre</a></nav>'
    + (autre ? '<p id="p2">autre page</p>' : '')
    + '<div style="height:1500px"></div><h2 id="a">A</h2><div style="height:1500px"></div><h2 id="b">B</h2><div style="height:1500px"></div><a name="nom">nom</a><div style="height:1500px"></div><div id="hote"></div><div style="height:3000px"></div>'
}

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`mjs_ujs navigateur réel (${nom}) — liens de la page affichée : haut de page, cible d'ancre, préchargement, défilement doux`, function () {
    this.timeout(60000)
    let browser: Browser | null = null
    let server: Server | null  = null
    let origin  = ''
    let present = false
    const demandes: string[] = []

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) return this.skip()
      browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      server  = createServer((req, res) => {
        const url    = new URL(req.url || '/', 'http://x')
        if (url.pathname === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(LIB); return }
        demandes.push(url.pathname + url.search)
        const chemin = url.pathname
        let reglage  = ''
        if (chemin === '/entrees' || chemin === '/doux') reglage = ';µ._anchorHistory=true'
        if (chemin === '/survol') reglage = ';µ.preload={page:\'hover\'}'
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html' + (chemin === '/doux' ? ' style="scroll-behavior:smooth"' : '') + '><head><meta charset="utf-8"></head><body style="margin:0">' + corps(chemin, url.search === '?p=2') + OMBRE + '<script>' + STUB + reglage + '</script><script src="/lib.js"></script></body></html>')
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
      origin = 'http://127.0.0.1:' + (server!.address() as any).port
    })

    after(async () => {
      if (browser) await browser.close()
      if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    })

    async function ouvrir(chemin: string) {
      const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
      const erreurs: string[] = []
      page.on('pageerror', e => erreurs.push(e.message))
      await page.goto(origin + chemin)
      await page.waitForFunction(() => history.scrollRestoration === 'manual')
      return { page, erreurs }
    }

    async function y(page: Page, attente = 300) {
      await page.waitForTimeout(attente)
      return page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
    }

    function va(page: Page, haut: number) {
      return page.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), haut)
    }

    function haut(page: Page, sel: string) {
      return page.evaluate((s) => Math.round(document.querySelector(s)!.getBoundingClientRect().top + scrollY), sel)
    }

    it('`<a href="#">` et un lien vers la page affichée remontent en haut, sans entrée d\'historique', async function () {
      if (!present) return this.skip()
      const { page, erreurs } = await ouvrir('/page')
      const longueur = await page.evaluate(() => history.length)
      await va(page, 1000)
      await page.click('#lhaut')
      assert.equal(await y(page), 0, 'AVANT : `<a href="#">` laissait la page à 1000')
      await va(page, 1000)
      await page.click('#lpage')
      assert.equal(await y(page), 0, 'AVANT : le lien vers la page affichée laissait la page à 1000')
      assert.equal(await page.evaluate(() => history.length), longueur)
      assert.deepEqual(erreurs, [])
      await page.close()
    })

    it('ancre dont la cible est dans l\'ombre fermée d\'un composant : le clic y défile', async function () {
      if (!present) return this.skip()
      const { page, erreurs } = await ouvrir('/page')
      await page.click('#lombre')
      assert.equal(await y(page), await page.evaluate(() => (window as any).ombre()), 'AVANT : le navigateur ne voit pas la cible, la page restait en haut')
      assert.equal(new URL(page.url()).hash, '#ombre')
      assert.deepEqual(erreurs, [])
      await page.close()
    })

    it('avec µ._anchorHistory, Suivant vers `#top`, vers `<a name>` et vers une cible en ombre y défile', async function () {
      if (!present) return this.skip()
      const { page, erreurs } = await ouvrir('/entrees')
      const vus: string[]    = []
      const voulus: string[] = []
      for (const [lien, cible] of [['#ltop', 'haut'], ['#lnom', 'a[name="nom"]'], ['#lombre', 'ombre']]) {
        await page.click('#lb'); await y(page)
        await page.click(lien); await y(page)
        await page.evaluate(() => history.back()); await y(page)
        await page.evaluate(() => history.forward())
        vus.push(lien + ' y=' + await y(page, 400))
        voulus.push(lien + ' y=' + (cible === 'haut' ? 0 : cible === 'ombre' ? await page.evaluate(() => (window as any).ombre()) : await haut(page, cible)))
      }
      assert.deepEqual(vus, voulus, 'AVANT : Suivant laissait la page à la position de #b')
      assert.deepEqual(erreurs, [])
      await page.close()
    })

    it('préchargement au survol : une ancre de la page et un lien vers elle ne la retéléchargent pas (un lien vers une autre page, si)', async function () {
      if (!present) return this.skip()
      const { page, erreurs } = await ouvrir('/survol')
      const avant = demandes.length
      await page.hover('#la'); await page.hover('#lhaut'); await page.hover('#lpage')
      await page.waitForTimeout(400)
      assert.deepEqual(demandes.slice(avant), [], 'AVANT : chaque survol redemandait la page affichée au serveur')
      await page.hover('#lautre')
      await page.waitForTimeout(400)
      assert.deepEqual(demandes.slice(avant), ['/survol?p=2'], 'témoin : le préchargement au survol est bien actif sur cette page')
      assert.deepEqual(erreurs, [])
      await page.close()
    })

    it('sous `scroll-behavior: smooth`, la position rendue au Précédent et le haut d\'une page reçue ne glissent pas', async function () {
      if (!present) return this.skip()
      const { page, erreurs } = await ouvrir('/doux')
      await page.click('#la'); await y(page, 1500)
      const quittee = await haut(page, '#a') + 600
      await va(page, quittee)
      await page.click('#lb'); await y(page, 1500)
      const rendue = await page.evaluate(() => new Promise<number>(ok => { addEventListener('popstate', () => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY)))), { once: true }); history.back() }))
      assert.equal(rendue, quittee, 'AVANT : la restauration glissait depuis #b')
      await va(page, 2000)
      await page.click('#lautre')
      await page.waitForFunction(() => !!document.getElementById('p2'), null, { polling: 'raf' })
      assert.equal(await page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY)))))), 0, 'AVANT : le haut de la page reçue glissait')
      assert.deepEqual(erreurs, [])
      await page.close()
    })
  })
}
