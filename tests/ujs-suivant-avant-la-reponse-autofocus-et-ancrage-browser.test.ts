// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler) : position d'une page
// retrouvée par Suivant avant l'arrivée de la page demandée par Précédent, focus et suivi d'une page qui porte un champ
// `autofocus`, ancrage de défilement et attribut `style` de `<html>` rendus après le suivi.
// - F5 sur une page reçue par un lien, défilement, Précédent vers une page lente que la navigation redemande au
//   serveur, puis Suivant avant sa réponse : la page, restée affichée, garde la position laissée (avant : elle
//   repartait à la position de l'entrée rangée au départ du rechargement, le haut de la page) ; le même aller-retour
//   mené à son terme rend aussi la position laissée ;
// - lien vers l'ancre peinte tard d'une page qui porte un champ `autofocus` : l'ancre est atteinte (avant, sous
//   WebKit : le navigateur posait lui-même le focus sur le champ après celui de la navigation, ce focus arrêtait le
//   suivi), et le focus de la navigation va au champ, même hors du premier élément reçu (avant : au premier élément) ;
//   un focus qui se pose sur ce champ pendant le suivi, ou sur celui de l'ombre fermée d'un composant, ne l'arrête pas,
//   celui d'un `<dialog>` ouvert pendant le suivi l'arrête toujours ;
// - l'ancrage de défilement que l'application pose sur `<html>` pendant le suivi reste après lui (avant : remplacé par
//   la valeur d'avant le suivi), et `<html>` ne garde pas d'attribut `style` vide quand il n'en avait pas.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// `tard` peint son ancre `#tardo` 600 ms après son montage, sous 1 500 px de contenu ; `champ` porte un champ
// `autofocus` dans son ombre
const SOURCES: Record<string, string> = {
  'tard.mjs':  '<script>\n  $montre = false\n  µmount =>\n    setTimeout (=> $montre = true), 600\n</script>\n\n<div class="h"></div>\n{if $montre}\n  <h2 id="tardo">Tard</h2>\n{end}\n<div class="h"></div>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
  'champ.mjs': '<input id="champ-ombre" aria-label="Champ" autofocus>\n\n<style>\n  :host\n    display: block\n</style>\n',
}

const NAV = (prefixe: string) => '<nav id="nav" style="position:fixed;top:0;right:0;background:#fff;z-index:9;font-size:10px"><a id="llent" href="' + prefixe + '/lent">lent</a> <a id="lp2" href="' + prefixe + '/p2">p2</a> <a id="lp3af" href="' + prefixe + '/p3af#tardo">p3af</a> <a id="lp3sh" href="' + prefixe + '/p3sh#tardo">p3sh</a></nav>'
const PAGES: Record<string, (prefixe: string) => string> = {
  '/p1':   (prefixe) => NAV(prefixe) + '<p id="nom-p1">p1</p><div style="height:3000px"></div>',
  '/lent': (prefixe) => NAV(prefixe) + '<p id="nom-lent">lent</p><div style="height:3000px"></div>',
  '/p2':   (prefixe) => NAV(prefixe) + '<p id="nom-p2">p2</p><div style="height:6000px"></div>',
  '/p3af': (prefixe) => NAV(prefixe) + '<p id="nom-p3af">p3af</p><input id="champ" autofocus><mjs-tard></mjs-tard><div style="height:3000px"></div>',
  '/p3sh': (prefixe) => NAV(prefixe) + '<p id="nom-p3sh">p3sh</p><mjs-champ></mjs-champ><mjs-tard></mjs-tard><div style="height:3000px"></div>',
  '/oa':   () => '<p id="nom-oa">oa</p><mjs-tard></mjs-tard><div style="height:3000px"></div>',
}
// la page lente répond après le Suivant du test
const LENT = 1200
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// haut d'un élément par son id, cherché aussi dans l'ombre des composants ; -1 quand il n'existe pas
function hautProfond(page: Page, id: string): Promise<number> {
  return page.evaluate((i) => {
    const trouve = (n: any, d: number): any => {
      if (!n || d > 60) return undefined
      if (n.id === i) return n
      for (const k of Array.from(n.children || []) as any[]) { const r = trouve(k, d + 1); if (r) return r }
      const s = n._shadow || n.shadowRoot
      if (s) for (const k of Array.from(s.children) as any[]) { const r = trouve(k, d + 1); if (r) return r }
      return undefined
    }
    const e = trouve(document.documentElement, 0)
    return e ? Math.round(e.getBoundingClientRect().top + scrollY) : -1
  }, id)
}

async function pose(page: Page, attente = 300): Promise<number> {
  await page.waitForTimeout(attente)
  return page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

function va(page: Page, y: number) {
  return page.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

describe('mjs_ujs navigateur réel, vrai projet — Suivant avant la réponse, page à autofocus, ancrage rendu après le suivi', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('suivant-autofocus')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    // les pages viennent du serveur, aucune source ne se sert de la navigation : ses modules sont nommés
    for (const [variante, options] of [['dev', {}], ['prod', { env: 'prod' }]] as const) {
      const sortie  = join(dist, variante)
      const bundler = new Bundler({ sourceDir: src, outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), urlPrefix: (variante === 'prod' ? '/prod' : '') + '/modularjs', runtime: ['ujs', 'router', 'ajax'], ...options } as any)
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
    }
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`${nom}`, function () {
      let browser: Browser | null = null
      let server: Server | null  = null
      let origin  = ''
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) return this.skip()
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        server  = createServer((req, res) => {
          const url     = new URL(req.url || '/', 'http://x')
          const prefixe = url.pathname.startsWith('/prod/') ? '/prod' : ''
          const chemin  = url.pathname.slice(prefixe.length)
          const corps   = PAGES[chemin]
          // `no-store` : ni cache HTTP ni cache arrière-avant
          if (corps) {
            const envoi = () => {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
              res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="' + prefixe + '/modularjs/bundle.js"></script></head><body style="margin:0">' + corps(prefixe) + '</body></html>')
            }
            if (chemin === '/lent') setTimeout(envoi, LENT)
            else envoi()
            return
          }
          const m       = /^(\/prod)?\/modularjs\/(.+)$/.exec(url.pathname)
          const fichier = m ? join(dist, m[1] ? 'prod' : 'dev', normalize(decodeURIComponent(m[2])).replace(/^(\.\.[/\\])+/, '')) : ''
          if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end('introuvable'); return }
          res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          res.end(readFileSync(fichier))
        })
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
        origin = 'http://127.0.0.1:' + (server!.address() as any).port
      })

      after(async () => {
        if (browser) await browser.close()
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      })

      // la navigation chargée (elle coupe le défilement natif des entrées)
      function prete(page: Page) {
        return page.waitForFunction(() => history.scrollRestoration === 'manual', null, { timeout: 15000 })
      }

      // la page montée par la navigation (`mjs:load` du chargement) : la position qu'elle rend à l'entrée est posée
      function montee(page: Page) {
        return page.waitForFunction(() => (window as any).__monte === true, null, { timeout: 15000 })
      }

      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.addInitScript(() => {
          const w = window as any
          w.__focus = []
          document.addEventListener('mjs:load', (e: any) => { if (e.detail && e.detail.initial) w.__monte = true })
          addEventListener('focusin', (e: any) => { w.__focus.push(e.target.id || e.target.localName) }, true)
        })
        await page.goto(origin + chemin)
        await prete(page)
        return { page, erreurs }
      }

      // rechargement par la page (`location.reload()`, une entrée inchangée) : Playwright recharge Firefox par une
      // entrée neuve
      async function recharger(page: Page) {
        await Promise.all([page.waitForEvent('load'), page.evaluate(() => location.reload())])
        await prete(page)
        await montee(page)
      }

      // /p1 → /lent → /p2 par des liens, F5 sur /p2, défilement à 2 000, Précédent vers /lent redemandée au serveur
      async function versLentApresF5(page: Page, prefixe: string) {
        await page.click('#llent')
        await page.waitForSelector('#nom-lent', { state: 'attached', timeout: 15000 })
        await page.click('#lp2')
        await page.waitForSelector('#nom-p2', { state: 'attached', timeout: 15000 })
        await pose(page)
        await recharger(page)
        await pose(page)
        await va(page, 2000)
        assert.equal(await pose(page, 100), 2000, 'défilement du test à 2 000 avant Précédent')
        await page.evaluate(() => history.back())
        await page.waitForFunction((c) => location.pathname === c, prefixe + '/lent', { timeout: 4000 })
      }

      for (const prefixe of ['', '/prod']) {
        it(`F5, défilement, Précédent vers une page lente redemandée au serveur, puis Suivant avant sa réponse : la page restée affichée garde la position laissée (${prefixe ? 'production' : 'développement'})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await versLentApresF5(page, prefixe)
          await page.waitForTimeout(300)
          const avant = await page.evaluate(() => [!!document.getElementById('nom-p2'), !!document.getElementById('nom-lent')])
          assert.deepEqual(avant, [true, false], 'la page lente n\'est pas encore arrivée au Suivant')
          await page.evaluate(() => history.forward())
          await page.waitForFunction((c) => location.pathname === c, prefixe + '/p2', { timeout: 4000 })
          // au-delà de la réponse de la page lente, abandonnée par le Suivant
          const y = await pose(page, LENT + 600)
          const vu = await page.evaluate(() => [location.pathname, !!document.getElementById('nom-p2'), !!document.getElementById('nom-lent')])
          assert.deepEqual([vu, y], [[prefixe + '/p2', true, false], 2000], 'AVANT : la page repartait en haut, à la position de l\'entrée rangée au départ du rechargement')
          assert.deepEqual(erreurs, [])
          await page.close()
        })

        it(`le même aller-retour mené à son terme (page lente arrivée, puis Suivant) rend la position laissée (${prefixe ? 'production' : 'développement'})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await versLentApresF5(page, prefixe)
          await page.waitForSelector('#nom-lent', { state: 'attached', timeout: 15000 })
          await pose(page)
          await page.evaluate(() => history.forward())
          await page.waitForSelector('#nom-p2', { state: 'attached', timeout: 15000 })
          const y = await pose(page, 800)
          assert.deepEqual([await page.evaluate(() => location.pathname), y], [prefixe + '/p2', 2000])
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('lien vers l\'ancre peinte tard d\'une page qui porte un champ autofocus : l\'ancre est atteinte', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        await page.click('#lp3af')
        await page.waitForSelector('#nom-p3af', { state: 'attached', timeout: 15000 })
        await page.waitForFunction(() => document.documentElement.scrollHeight > 5000, null, { timeout: 15000 })
        await page.waitForTimeout(900)
        const y     = await pose(page, 300)
        const cible = await hautProfond(page, 'tardo')
        assert.ok(cible > 1000, 'ancre peinte : ' + cible)
        assert.deepEqual([await page.evaluate(() => location.pathname + location.hash), y], ['/p3af#tardo', cible], 'AVANT, sous WebKit : le focus que le navigateur pose sur le champ arrêtait le suivi, la page restait en haut')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('le focus que la navigation pose après l\'échange va au champ autofocus du contenu reçu, même hors de son premier élément', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        await page.evaluate(() => { (window as any).__focus.length = 0 })
        await page.click('#lp3af')
        await page.waitForSelector('#nom-p3af', { state: 'attached', timeout: 15000 })
        await pose(page, 200)
        // le focus du lien cliqué (selon le moteur) mis à part
        const vus = (await page.evaluate(() => (window as any).__focus as string[])).filter(f => f !== 'lp3af')
        assert.deepEqual([vus, await page.evaluate(() => document.activeElement && document.activeElement.id)], [['champ'], 'champ'], 'AVANT : le focus allait au premier élément reçu (<nav>)')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // le focus que WebKit pose lui-même sur le champ, après celui de la navigation, rejoué par la page dans les trois
      // moteurs (50 ms après l'arrivée de la page, l'ancre se peint à 600 ms) : le navigateur et un script ne se
      // distinguent pas, un focus qui se pose sur un champ `autofocus` de la page ne compte pas
      it('un focus qui se pose sur le champ autofocus de la page pendant le suivi ne l\'arrête pas : l\'ancre est atteinte', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        await page.evaluate(() => {
          document.addEventListener('mjs:load', () => setTimeout(() => {
            const a     = document.activeElement as HTMLElement | null
            const champ = document.getElementById('champ') as HTMLInputElement
            if (a && a.blur) a.blur()
            champ.focus({ preventScroll: true })
          }, 50), { once: true })
        })
        await page.click('#lp3af')
        await page.waitForSelector('#nom-p3af', { state: 'attached', timeout: 15000 })
        await page.waitForFunction(() => document.documentElement.scrollHeight > 5000, null, { timeout: 15000 })
        await page.waitForTimeout(900)
        const y     = await pose(page, 300)
        const cible = await hautProfond(page, 'tardo')
        assert.ok(cible > 1000, 'ancre peinte : ' + cible)
        assert.deepEqual([await page.evaluate(() => document.activeElement && document.activeElement.id), y], ['champ', cible], 'AVANT : ce focus arrêtait le suivi, la page restait en haut')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // le même focus posé sur le champ `autofocus` de l'ombre fermée d'un composant, défini à l'arrivée de la page : la
      // cible de l'événement est l'hôte du composant
      it('un focus qui se pose sur le champ autofocus d\'un composant de la page pendant le suivi ne l\'arrête pas : l\'ancre est atteinte', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        await page.evaluate(() => {
          const essai = () => {
            const hote  = document.querySelector('mjs-champ') as any
            const champ = hote && hote._shadow && hote._shadow.getElementById && hote._shadow.getElementById('champ-ombre')
            let a       = document.activeElement as any
            if (!champ) return setTimeout(essai, 10)
            while (a && a._shadow && a._shadow.activeElement) a = a._shadow.activeElement
            if (a && a.blur) a.blur()
            champ.focus({ preventScroll: true })
          }
          document.addEventListener('mjs:load', () => setTimeout(essai, 50), { once: true })
        })
        await page.click('#lp3sh')
        await page.waitForSelector('#nom-p3sh', { state: 'attached', timeout: 15000 })
        await page.waitForFunction(() => document.documentElement.scrollHeight > 5000, null, { timeout: 15000 })
        await page.waitForTimeout(900)
        const y     = await pose(page, 300)
        const cible = await hautProfond(page, 'tardo')
        const actif = await page.evaluate(() => { const h = document.activeElement as any; return [h && h.localName, h && h._shadow && h._shadow.activeElement && h._shadow.activeElement.id] })
        assert.ok(cible > 1000, 'ancre peinte : ' + cible)
        assert.deepEqual([actif, y], [['mjs-champ', 'champ-ombre'], cible], 'AVANT : ce focus arrêtait le suivi, la page restait en haut')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // choix gardé : l'ouverture d'un `<dialog>` pendant le suivi l'arrête, même quand son focus va à son champ
      // `autofocus`
      it('un dialogue ouvert pendant le suivi l\'arrête, même quand son champ autofocus reçoit le focus', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/oa#tardo')
        await page.waitForFunction(() => document.documentElement.style.getPropertyPriority('overflow-anchor') === 'important', null, { timeout: 15000 })
        const vu = await page.evaluate(() => {
          document.body.insertAdjacentHTML('beforeend', '<dialog id="dlg"><input id="dlg-champ" autofocus></dialog>')
          ;(document.getElementById('dlg') as HTMLDialogElement).showModal()
          return [document.activeElement && document.activeElement.id, document.documentElement.style.getPropertyPriority('overflow-anchor')]
        })
        assert.deepEqual(vu, ['dlg-champ', ''], 'le focus du dialogue arrête le suivi : l\'ancrage du navigateur est rendu')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      // le suivi de l'ancre de l'adresse, arrêté par une touche
      async function suiviPuisTouche(page: Page, pendant: () => Promise<unknown>) {
        await page.waitForFunction(() => document.documentElement.style.getPropertyPriority('overflow-anchor') === 'important', null, { timeout: 15000 })
        await pendant()
        await page.keyboard.press('Shift')
        await pose(page, 100)
      }

      it('l\'ancrage de défilement que l\'application pose sur <html> pendant le suivi reste après lui', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/oa#tardo')
        await suiviPuisTouche(page, () => page.evaluate(() => { document.documentElement.style.overflowAnchor = 'none' }))
        const reste = await page.evaluate(() => [document.documentElement.style.getPropertyValue('overflow-anchor'), document.documentElement.style.getPropertyPriority('overflow-anchor')])
        assert.deepEqual(reste, ['none', ''], 'AVANT : la valeur d\'avant le suivi (aucune) remplaçait celle de l\'application')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('<html> sans attribut style avant le suivi n\'en garde aucun après lui', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/oa#tardo')
        await suiviPuisTouche(page, async () => assert.equal(await page.evaluate(() => document.documentElement.getAttribute('style')), 'overflow-anchor: none !important;', 'suivi en cours'))
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('style')), false, 'AVANT : <html style=""> restait dans la page')
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    })
  }
})
