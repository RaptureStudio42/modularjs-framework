// *parallax(smooth) dans Chromium, Firefox et WebKit réels : l'élan se voit dans de vraies mises en page
// (happy-dom n'en a pas ; la logique image par image est dans effets-parallax-elan.test.ts).
// Trois couches à smooth 1, 0.2 et 0.08 : la collée arrive tout de suite, les autres rattrapent avec retard et
// continuent après l'arrêt du défilement, la plus molle derrière — puis toutes sur la même cible, la boucle
// arrêtée d'elle-même (aucune image d'animation en attente, will-change rendu). La scène est la page ou une boîte
// qui défile (la scène d'une démonstration) : les deux. origin: view : la place de repos d'une couche en élan ne
// dérive pas (même place finale que sans élan). Loin de l'écran, elle et sa cible : posée d'un coup, sans
// boucle ; emportée hors de l'écran par son élan mais visée à l'écran : elle revient en glissant. smooth suivi
// en direct, retrait sans reste, « réduire les animations » sans élan.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  // la page défile : trois couches, de la collée à la plus molle
  'elan-page.mjs': '<div class="haut"></div>\n<div class="a" *parallax(origin: page, smooth: 1)>a</div>\n<div class="b" *parallax(origin: page, smooth: 0.2)>b</div>\n<div class="c" *parallax(origin: page, smooth: 0.08)>c</div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 100px\n.a, .b, .c\n  height: 40px\n.bas\n  height: 4000px\n</style>\n',
  // la scène est une boîte qui défile : la couche suit son défilement, pas celui de la page
  'elan-boite.mjs': '<div class="haut"></div>\n<div class="pan"><div class="cale"></div><div class="couche" *parallax(origin: page, smooth: 0.2)>couche</div><div class="plein"></div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 100px\n.pan\n  height: 300px\n  overflow: auto\n.cale\n  height: 150px\n.couche\n  height: 60px\n.plein\n  height: 1500px\n.bas\n  height: 2000px\n</style>\n',
  // origin: view, avec élan et sans : même place finale
  'elan-vue-sans.mjs': '<div class="haut"></div>\n<div class="couche" *parallax>couche</div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 500px\n.couche\n  height: 60px\n.bas\n  height: 4000px\n</style>\n',
  'elan-vue-avec.mjs': '<div class="haut"></div>\n<div class="couche" *parallax(smooth: 0.2)>couche</div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 500px\n.couche\n  height: 60px\n.bas\n  height: 4000px\n</style>\n',
  // origin: view dans une boîte qui défile
  'elan-vue-boite-sans.mjs': '<div class="pan"><div class="vide"></div><div class="couche" *parallax>couche</div><div class="vide"></div></div>\n<div class="bas"></div>\n<style>\n.pan\n  height: 300px\n  overflow: auto\n.vide\n  height: 400px\n.couche\n  height: 60px\n.bas\n  height: 2000px\n</style>\n',
  'elan-vue-boite-avec.mjs': '<div class="pan"><div class="vide"></div><div class="couche" *parallax(smooth: 0.2)>couche</div><div class="vide"></div></div>\n<div class="bas"></div>\n<style>\n.pan\n  height: 300px\n  overflow: auto\n.vide\n  height: 400px\n.couche\n  height: 60px\n.bas\n  height: 2000px\n</style>\n',
  // une couche que l'élan emporte hors de la boîte (vitesse 1 : elle reste en place à l'écran, la boîte défile de 240 px d'un coup)
  'elan-emportee.mjs': '<div class="haut"></div>\n<div class="pan"><div class="couche" *parallax(origin: page, speed: 1, smooth: 0.08)>couche</div><div class="plein"></div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 100px\n.pan\n  height: 360px\n  overflow: auto\n.couche\n  position: absolute\n  top: 220px\n  width: 200px\n  height: 90px\n.plein\n  height: 1600px\n.bas\n  height: 2000px\n</style>\n',
  // une couche à 1 500 px sous l'écran
  'elan-loin.mjs': '<div class="grand"></div>\n<div class="loin" *parallax(origin: page, smooth: 0.1)>loin</div>\n<div class="bas"></div>\n<style>\n.grand\n  height: 1500px\n.loin\n  height: 40px\n.bas\n  height: 4000px\n</style>\n',
  // une seule couche en élan : aucune autre boucle sur la page
  'elan-seule.mjs': '<div class="haut"></div>\n<div class="couche" *parallax(origin: page, smooth: 0.1)>couche</div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 400px\n.couche\n  height: 40px\n.bas\n  height: 4000px\n</style>\n',
  // de côté
  'elan-axe.mjs': '<div class="haut"></div>\n<div class="couche" *parallax(axis: x, smooth: 0.2)>couche</div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 300px\n.couche\n  height: 60px\n.bas\n  height: 4000px\n</style>\n'
}

// ce que la page compte : les images d'animation en attente, les minuteries vivantes, les écritures de
// propriétés CSS par nom
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__iv = new Set()
  const si = w.setInterval.bind(w)
  const ci = w.clearInterval.bind(w)
  w.setInterval = (f: any, d: number, ...a: any[]) => { const h = si(f, d, ...a); w.__iv.add(h); return h }
  w.clearInterval = (h: number) => { w.__iv.delete(h); return ci(h) }
  w.__ecritures = {}
  const sp = w.CSSStyleDeclaration.prototype.setProperty
  w.CSSStyleDeclaration.prototype.setProperty = function (k: string, ...a: any[]) { w.__ecritures[k] = (w.__ecritures[k] || 0) + 1; return sp.call(this, k, ...a) }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*parallax(smooth) (navigateurs réels) — l\'élan : retard, rattrapage, arrêt', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-parallax-elan')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, options: { calme?: boolean } = {}): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: options.calme ? 'reduce' : 'no-preference' })
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      const lire = (page: any, tag: string, sel: string, v = '--mjs-fx-parallax-y'): Promise<number> => page.evaluate(([t, c, k]: [string, string, string]) => parseFloat(((document.querySelector(t) as any)._shadow.querySelector(c) as any).style.getPropertyValue(k)), [tag, sel, v])
      // plusieurs couches lues d'un seul geste : un même instant
      const toutes = (page: any, tag: string, sels: string[]): Promise<number[]> => page.evaluate(([t, l]: [string, string[]]) => l.map((c) => parseFloat(((document.querySelector(t) as any)._shadow.querySelector(c) as any).style.getPropertyValue('--mjs-fx-parallax-y'))), [tag, sels])
      const brut = (page: any, tag: string, sel: string, v = '--mjs-fx-parallax-y'): Promise<string> => page.evaluate(([t, c, k]: [string, string, string]) => ((document.querySelector(t) as any)._shadow.querySelector(c) as any).style.getPropertyValue(k), [tag, sel, v])
      const images = (page: any, n: number) => page.evaluate((k: number) => new Promise<void>((r) => { const f = (i: number) => i <= 0 ? r() : requestAnimationFrame(() => f(i - 1)); f(k) }), n)
      const enAttente = (page: any): Promise<number> => page.evaluate(() => (window as any).__raf.size)
      const ecritures = (page: any): Promise<number> => page.evaluate(() => (window as any).__ecritures['--mjs-fx-parallax-y'] || 0)
      const willChange = (page: any, tag: string, sel: string): Promise<string> => page.evaluate(([t, c]: [string, string]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector(c)).willChange, [tag, sel])

      // attend que la boucle se repose : trois relevés de suite sans image en attente ; faux si elle tourne encore au délai
      async function repos(page: any, ms = 8000): Promise<boolean> {
        const fin = Date.now() + ms
        let calme = 0
        while (Date.now() < fin) {
          calme = (await enAttente(page)) === 0 ? calme + 1 : 0
          if (calme >= 3) return true
          await attendre(40)
        }
        return false
      }

      it('la page défile : la couche collée arrive tout de suite, les deux autres la rattrapent avec retard — la plus molle derrière — puis toutes arrivent', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-page'
        await avec(tag, async (page) => {
          assert.equal(await brut(page, tag, '.b'), '0.0px', 'posées sans décalage')
          await page.evaluate(() => window.scrollTo(0, 200))
          await images(page, 2)
          const [a, b, c] = await toutes(page, tag, ['.a', '.b', '.c'])
          assert.equal(a, 100, 'smooth 1 : la moitié du défilement, tout de suite')
          assert.ok(b > 0 && b < 100, `smooth 0.2 : en route (${b} px)`)
          assert.ok(c > 0 && c < b, `smooth 0.08 : encore derrière (${c} px, la 0.2 en est à ${b} px)`)
          // le défilement est fini : sans aucun geste, les retardataires avancent encore
          const b2 = await lire(page, tag, '.b')
          await images(page, 3)
          const b3 = await lire(page, tag, '.b')
          assert.ok(b3 > b2 || b3 === 100, `la couche continue après l'arrêt du défilement (${b2} → ${b3} px)`)
          assert.ok(await repos(page), 'la boucle s\'arrête d\'elle-même')
          for (const sel of ['.a', '.b', '.c']) assert.equal(await brut(page, tag, sel), '100.0px', `${sel} : sur sa cible`)
        })
      })

      it('au repos : plus d\'image en attente, plus de minuterie, plus d\'écriture, will-change rendu ; pendant le mouvement : will-change: translate', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-page'
        await avec(tag, async (page) => {
          assert.equal(await willChange(page, tag, '.b'), 'auto', 'avant tout mouvement')
          await page.evaluate(() => window.scrollTo(0, 200))
          await images(page, 2)
          assert.equal(await willChange(page, tag, '.b'), 'translate', 'pendant le rattrapage, la balise a son calque')
          assert.ok(await repos(page))
          await page.waitForTimeout(100)
          const avant = await ecritures(page)
          await page.waitForTimeout(400)
          assert.equal(await ecritures(page), avant, 'aucune écriture au repos')
          assert.deepEqual(await page.evaluate(() => ({ raf: (window as any).__raf.size, minuteries: (window as any).__iv.size })), { raf: 0, minuteries: 0 })
          assert.equal(await willChange(page, tag, '.b'), 'auto', 'rendu au repos')
        })
      })

      it('une boîte qui défile pour scène : la couche rattrape le défilement de la boîte (100 px → 50), pas celui de la page', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-boite'
        const boite = (page: any, y: number) => page.evaluate(([t, v]: [string, number]) => { (document.querySelector(t) as any)._shadow.querySelector('.pan').scrollTop = v }, [tag, y])
        await avec(tag, async (page) => {
          await page.evaluate(() => window.scrollTo(0, 50))
          await images(page, 3)
          assert.ok(await repos(page))
          assert.equal(await brut(page, tag, '.couche'), '0.0px', 'la page défile, la boîte non : rien ne bouge')
          await boite(page, 100)
          await images(page, 2)
          const milieu = await lire(page, tag, '.couche')
          assert.ok(milieu > 0 && milieu < 50, `en route vers 50 px (${milieu} px)`)
          assert.ok(await repos(page))
          assert.equal(await brut(page, tag, '.couche'), '50.0px')
          await boite(page, 50)
          await images(page, 2)
          const descend = await lire(page, tag, '.couche')
          assert.ok(descend < 50 && descend > 25, `redescend en douceur (${descend} px)`)
          assert.ok(await repos(page))
          assert.equal(await brut(page, tag, '.couche'), '25.0px')
        })
      })

      it('origin: view : la place de repos ne dérive pas sous l\'élan — même place finale qu\'une couche sans élan, dans la page comme dans une boîte', async function () {
        if (!present) { this.skip(); return }
        const finale = async (tag: string, geste: (page: any) => Promise<unknown>) => avec(tag, async (page) => {
          await geste(page)
          await images(page, 2)
          assert.ok(await repos(page), `${tag} : la boucle s'arrête`)
          await page.waitForTimeout(100)
          return lire(page, tag, '.couche')
        })
        const defilePage = (y: number) => (page: any) => page.evaluate((v: number) => window.scrollTo(0, v), y)
        const defileBoite = (y: number, tag: string) => (page: any) => page.evaluate(([t, v]: [string, number]) => { (document.querySelector(t) as any)._shadow.querySelector('.pan').scrollTop = v }, [tag, y])
        const sans  = await finale('mjs-elan-vue-sans', defilePage(700))
        const avec2 = await finale('mjs-elan-vue-avec', defilePage(700))
        assert.ok(Math.abs(sans) > 20, `le défilement déplace bien la couche (${sans} px)`)
        assert.ok(Math.abs(avec2 - sans) <= 0.2, `page : ${avec2} px avec élan, ${sans} px sans`)
        const sansB = await finale('mjs-elan-vue-boite-sans', defileBoite(350, 'mjs-elan-vue-boite-sans'))
        const avecB = await finale('mjs-elan-vue-boite-avec', defileBoite(350, 'mjs-elan-vue-boite-avec'))
        assert.ok(Math.abs(sansB) > 20, `la boîte déplace bien la couche (${sansB} px)`)
        assert.ok(Math.abs(avecB - sansB) <= 0.2, `boîte : ${avecB} px avec élan, ${sansB} px sans`)
      })

      it('hors de l\'écran, elle et sa cible : posée d\'un coup, sans boucle ; dès que sa cible est à l\'écran, elle y glisse', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-loin'
        await avec(tag, async (page) => {
          // origin: page, vitesse 0.5 : la couche (posée à 1 500 px) ne monte qu'à moitié du défilement ; à 100 px
          // défilés elle est à 1 450 px de l'écran, sa cible à 1 500 : loin d'être visible
          await page.evaluate(() => window.scrollTo(0, 100))
          await images(page, 2)
          assert.equal(await brut(page, tag, '.loin'), '50.0px', 'posée sur sa cible dès la première image')
          assert.equal(await enAttente(page), 0, 'aucune boucle pour une couche qu\'on ne voit pas')
          // la page descend jusqu'à elle : sa cible est à l'écran (à 2 000 px défilés, 500 px sous le haut) alors qu'elle
          // est encore au-dessus ; elle y glisse au lieu d'y sauter
          await page.evaluate(() => window.scrollTo(0, 2000))
          await images(page, 2)
          const v = await lire(page, tag, '.loin')
          assert.ok(v > 50 && v < 1000, `en route vers 1 000 px (${v} px)`)
          assert.equal(await enAttente(page), 1, 'la boucle tourne')
          assert.ok(await repos(page))
          assert.equal(await brut(page, tag, '.loin'), '1000.0px')
        })
      })

      it('emportée hors de la boîte par son élan, visée dans la boîte : elle revient en glissant (jamais un saut), puis la boucle s\'arrête', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-emportee'
        await avec(tag, async (page) => {
          await page.evaluate((t: string) => { (document.querySelector(t) as any)._shadow.querySelector('.pan').scrollTop = 240 }, tag)
          const vus: number[] = []
          for (let k = 0; k < 4; k++) {
            await images(page, 1)
            vus.push(await lire(page, tag, '.couche'))
          }
          assert.ok(vus.every((v, i) => v > 0 && v < 240 && (i === 0 || v > vus[i - 1])), `elle glisse sans sauter : ${vus.join(' → ')} px`)
          assert.ok(await repos(page))
          assert.equal(await brut(page, tag, '.couche'), '240.0px')
        })
      })

      it('axis: x : l\'élan agit sur la variable de côté, l\'autre n\'est jamais écrite', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-axe'
        await avec(tag, async (page) => {
          await page.evaluate(() => window.scrollTo(0, 400))
          await images(page, 2)
          const milieu = await lire(page, tag, '.couche', '--mjs-fx-parallax-x')
          assert.ok(Math.abs(milieu) > 0, `la variable de côté a bougé (${milieu} px)`)
          assert.ok(await repos(page))
          const fin = await lire(page, tag, '.couche', '--mjs-fx-parallax-x')
          assert.ok(Math.abs(fin) > Math.abs(milieu), `et continue vers sa cible (${milieu} → ${fin} px)`)
          assert.equal(await brut(page, tag, '.couche', '--mjs-fx-parallax-y'), '', 'rien sur l\'autre axe')
        })
      })

      it('smooth suivi en direct : 1 pose la couche d\'un coup et arrête la boucle, sans reposer l\'effet ; 0.2 rend l\'élan', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-seule'
        await avec(tag, async (page) => {
          const poser = (v: number) => page.evaluate(([t, s]: [string, number]) => (window as any).µ._mjs_fxSet((document.querySelector(t) as any)._shadow.querySelector('.couche'), 'parallax', { smooth: s }), [tag, v])
          const meme  = () => page.evaluate((t: string) => (window as any).__off === (document.querySelector(t) as any)._shadow.querySelector('.couche')._mjs_fxOff.parallax, tag)
          await page.evaluate((t: string) => { (window as any).__off = (document.querySelector(t) as any)._shadow.querySelector('.couche')._mjs_fxOff.parallax }, tag)
          await page.evaluate(() => window.scrollTo(0, 200))
          await images(page, 2)
          assert.ok(await lire(page, tag, '.couche') < 100)
          assert.equal(await enAttente(page), 1, 'la boucle tourne')
          await poser(1)
          assert.equal(await brut(page, tag, '.couche'), '100.0px', 'd\'un coup sur la cible')
          assert.equal(await enAttente(page), 0, 'boucle arrêtée')
          assert.ok(await meme(), 'même effet : pas reposé')
          await poser(0.2)
          await page.evaluate(() => window.scrollTo(0, 400))
          await images(page, 2)
          const v = await lire(page, tag, '.couche')
          assert.ok(v > 100 && v < 200, `l'élan est revenu (${v} px)`)
          assert.ok(await meme(), 'toujours le même effet')
        })
      })

      it('retiré en plein rattrapage : ni variable, ni will-change, ni image en attente, et le défilement n\'écrit plus rien', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-page'
        await avec(tag, async (page) => {
          await page.evaluate(() => window.scrollTo(0, 200))
          await images(page, 2)
          assert.ok(await enAttente(page) > 0)
          await page.evaluate((t: string) => (window as any).µ._mjs_fxClear((document.querySelector(t) as any)._shadow.querySelector('.c')), tag)
          assert.equal(await brut(page, tag, '.c'), '', 'variable rendue')
          assert.equal(await willChange(page, tag, '.c'), 'auto')
          const avant = await ecritures(page)
          await page.evaluate(() => window.scrollTo(0, 300))
          await images(page, 4)
          assert.equal(await brut(page, tag, '.c'), '', 'le défilement n\'écrit plus rien sur la couche retirée')
          assert.ok(await ecritures(page) > avant, 'les deux autres, elles, ont suivi')
        })
      })

      it('« réduire les animations » : pas d\'élan, la couche arrive d\'un coup et rien ne tourne', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-elan-page'
        await avec(tag, async (page) => {
          await page.evaluate(() => window.scrollTo(0, 200))
          await images(page, 2)
          assert.equal(await brut(page, tag, '.b'), '100.0px', 'smooth 0.2 ignoré')
          assert.equal(await brut(page, tag, '.c'), '100.0px', 'smooth 0.08 ignoré')
          assert.equal(await enAttente(page), 0)
        }, { calme: true })
      })
    })
  }
})
