// Des applis construites EN PRODUCTION (code réduit, sections filtrées) dans des navigateurs réels : ce que les pages écrivent marche —
// le survol (cachée au repos, elle entre avec la souris et ressort), le défilement, un *typewriter qui s'écrit au survol, les
// réglages neufs d'*fly, d'*iris —, et ce que fait une transition sans rien écrire marche sans aucune section. *liquid : la
// déformation lisse sans section, par carreaux (WebGL : Chromium sans la variable DISPLAY, Firefox sous un serveur X virtuel) quand `cells` est écrit.
// Firefox n'est là que s'il est installé (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE  = '\n<style>\n.zone\n  width: 300px\n  height: 120px\n  margin: 10px\n.espace\n  height: 1600px\n.a, .b, .c, .d, .e\n  width: 200px\n  height: 60px\n  margin: 6px\n</style>\n'
const IMAGE  = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'140\'%3E%3Crect width=\'240\' height=\'140\' fill=\'%23c33\'/%3E%3Ccircle cx=\'120\' cy=\'70\' r=\'50\' fill=\'%23fc3\'/%3E%3C/svg%3E'

// les composants de chaque appli, construite une fois : `defauts` n'écrit aucun réglage de section ; `ecrits` les écrit tous (le survol, le
// défilement, un texte machine au survol, les réglages neufs d'*fly et d'*iris, *liquid lisse et par carreaux)
const APPLIS: Record<string, Record<string, string>> = {
  defauts: {
    't-defauts': `<div class="a" *fade>fondu</div><div class="b" *iris>iris</div><div class="c" *blocks>blocs</div><div class="d" *fly>vol</div><div class="e" *pixelate>mosaïque</div>${STYLE}`
  },
  ecrits: {
    't-survol':   `<div class="zone"><p class="cible" *fade(on: hover, duration: 200ms)>texte</p></div>${STYLE}`,
    't-machine':  `<div class="zone"><p class="mach" *typewriter(on: hover, speed: 400)>bonjour tout le monde</p></div>${STYLE}`,
    't-defile':   `<div class="espace"></div><p class="cible" *fade(on: scroll)>texte</p><div class="espace"></div>${STYLE}`,
    't-reglages': `<p class="a" *fly(rotate: 90, on: load, duration: 4s)>a</p><p class="b" *fly(on: load, duration: 4s)>b</p><p class="c" *iris(start: .5, on: load, duration: 4s)>c</p><p class="d" *iris(on: load, duration: 4s)>d</p><p class="e" *iris(shape: box, angle: 45, on: load, duration: 4s)>e</p>${STYLE}`,
    't-lisse':    `<img class="a" src="${IMAGE}" alt="" *liquid>${STYLE}`,
    't-carreaux': `<img class="a" src="${IMAGE}" alt="" *liquid(cells: 12)>${STYLE}`
  }
}

describe('sections d\'un fichier d\'effet — des applis construites en production dans des navigateurs réels', function () {
  this.timeout(900000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [appli, composants] of Object.entries(APPLIS)) {
      const root   = mjsTmp('sections-navigateur-' + appli)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, src] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), src)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas (des morceaux collés bout à bout ne se retrouvent plus)
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      scripts[appli] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  // NAVIGATEUR=firefox : un seul navigateur ; sinon Chromium puis Firefox s'il est installé
  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox'>) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { await browser?.close() })

      // la page d'une appli, ses erreurs de page relevées ; rend la page et la liste des erreurs
      async function ouvrir(appli: string, hauteur = 700): Promise<{ page: any, erreurs: string[] }> {
        const page    = await (await browser.newContext({ viewport: { width: 800, height: hauteur } })).newPage()
        const erreurs: string[] = []
        // la racine d'un composant : son ombre (ouverte, ou tenue par une propriété que le code réduit a renommée), sinon lui-même
        await page.addInitScript(() => {
          (window as any).__racine = (tag: string) => {
            const el: any = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }
        })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        const balises = Object.keys(APPLIS[appli]).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>${balises}<script>${scripts[appli]}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => !!(window as any).__racine(t)?.firstElementChild), Object.keys(APPLIS[appli]).map((c) => 'mjs-' + c), { timeout: 20000 })
        return { page, erreurs }
      }
      // un élément d'un composant, par le chemin des ombres
      const trouver = (tag: string, sel: string) => `(__racine('${tag}').querySelector('${sel}'))`
      const attendre = (page: any, expr: string, arg?: unknown) => page.waitForFunction(expr, arg, { timeout: 15000, polling: 50 })
      const etat = (page: any, tag: string, sel: string): Promise<{ visibility: string, opacity: string, texte: string, repos: boolean, anims: number }> => page.evaluate(([tag, sel]: [string, string]) => {
        const el: any = (window as any).__racine(tag).querySelector(sel)
        const cs = getComputedStyle(el)
        return { visibility: cs.visibility, opacity: cs.opacity, texte: el.textContent, repos: el.getAttribute('mjs-fx-hover') === 'rest', anims: el.getAnimations().length }
      }, [tag, sel])
      const centre = (page: any, tag: string, sel: string): Promise<{ x: number, y: number }> => page.evaluate(([tag, sel]: [string, string]) => {
        const el = (window as any).__racine(tag).querySelector(sel)
        // les composants sont empilés dans la page : celui-ci peut être sous la fenêtre, et une souris hors fenêtre ne survole rien
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, [tag, sel])

      it('sans rien écrire : *fade, *iris, *blocks, *fly et *pixelate arrivent à leur état final, sans une seule section', async () => {
        const { page, erreurs } = await ouvrir('defauts')
        for (const sel of ['.a', '.b', '.c', '.d', '.e']) {
          await attendre(page, `(() => { const e = ${trouver('mjs-t-defauts', sel)}; const cs = getComputedStyle(e); return cs.visibility === 'visible' && cs.opacity === '1' && e.getAnimations().length === 0 })()`)
        }
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('on: hover — cachée au repos (sa place gardée), elle entre quand la souris arrive sur son parent et ressort quand elle le quitte', async () => {
        const { page, erreurs } = await ouvrir('ecrits')
        await attendre(page, `${trouver('mjs-t-survol', '.cible')}.getAttribute('mjs-fx-hover') === 'rest'`)
        assert.equal((await etat(page, 'mjs-t-survol', '.cible')).visibility, 'hidden')
        const c = await centre(page, 'mjs-t-survol', '.zone')
        await page.mouse.move(c.x, c.y)
        await attendre(page, `(() => { const e = ${trouver('mjs-t-survol', '.cible')}; const cs = getComputedStyle(e); return !e.hasAttribute('mjs-fx-hover') && cs.visibility === 'visible' && cs.opacity === '1' && e.getAnimations().length === 0 })()`)
        await page.mouse.move(790, 690)
        await attendre(page, `${trouver('mjs-t-survol', '.cible')}.getAttribute('mjs-fx-hover') === 'rest'`)
        assert.equal((await etat(page, 'mjs-t-survol', '.cible')).visibility, 'hidden')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*typewriter(on: hover) — son texte s\'écrit quand la souris arrive, et il était absent au repos', async () => {
        const { page, erreurs } = await ouvrir('ecrits')
        await attendre(page, `${trouver('mjs-t-machine', '.mach')}.textContent.length < 21`)
        const c = await centre(page, 'mjs-t-machine', '.zone')
        await page.mouse.move(c.x, c.y)
        await attendre(page, `${trouver('mjs-t-machine', '.mach')}.textContent === 'bonjour tout le monde'`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('on: scroll — la balise suit le défilement : transparente en haut de la page, entière quand elle arrive au milieu de l\'écran', async () => {
        const { page, erreurs } = await ouvrir('ecrits')
        await attendre(page, `getComputedStyle(${trouver('mjs-t-defile', '.cible')}).opacity === '0'`)
        await page.evaluate(`${trouver('mjs-t-defile', '.cible')}.scrollIntoView({ block: 'center' })`)
        // la fin du défilement est le milieu de l'écran, à un pixel ou deux près selon le navigateur (Firefox : 0,9986)
        await attendre(page, `Number(getComputedStyle(${trouver('mjs-t-defile', '.cible')}).opacity) > 0.98`)
        await page.evaluate('window.scrollTo(0, 0)')
        await attendre(page, `getComputedStyle(${trouver('mjs-t-defile', '.cible')}).opacity === '0'`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('les réglages neufs sont lus : *fly(rotate) tourne, *iris(start) et *iris(angle) changent la fenêtre de départ', async () => {
        const { page, erreurs } = await ouvrir('ecrits')
        const images = (sel: string): Promise<string> => page.evaluate(([tag, sel]: [string, string]) => {
          const a = (window as any).__racine(tag).querySelector(sel).getAnimations()
          return JSON.stringify(a.flatMap((x: any) => x.effect.getKeyframes()).map((k: any) => [k.transform, k.clipPath, k.rotate]))
        }, ['mjs-t-reglages', sel])
        await attendre(page, `${trouver('mjs-t-reglages', '.a')}.getAnimations().length > 0 && ${trouver('mjs-t-reglages', '.e')}.getAnimations().length > 0`)
        assert.match(await images('.a'), /rotate\(/, 'rotate: 90 tourne')
        assert.doesNotMatch(await images('.b'), /rotate\(/, 'sans rotate, rien ne tourne')
        const [depart, defaut, penchee] = [await images('.c'), await images('.d'), await images('.e')]
        assert.ok(/circle|ellipse|polygon|inset/.test(defaut), 'l\'iris par défaut découpe : ' + defaut.slice(0, 120))
        assert.notEqual(depart, defaut, 'start: .5 ouvre la fenêtre dès le départ')
        assert.notEqual(penchee, defaut, 'box penché de 45° n\'est pas le rond du défaut')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*liquid sans carreaux : la déformation lisse monte au survol (le filtre SVG déplace plus fort), sans toile WebGL', async () => {
        const { page, erreurs } = await ouvrir('ecrits')
        const c = await centre(page, 'mjs-t-lisse', '.a')
        // la force du filtre : au repos 40 × 0,12 (le réglage `rest`), au survol 40 en entier
        const force = (): Promise<number> => page.evaluate(() => Number((window as any).__racine('mjs-t-lisse').querySelector('feDisplacementMap')?.getAttribute('scale') ?? -1))
        await attendre(page, `Number(${trouver('mjs-t-lisse', 'feDisplacementMap')}?.getAttribute('scale')) > 0`)
        assert.ok(await force() < 10, 'au repos, la déformation est faible : ' + await force())
        await page.mouse.move(c.x, c.y)
        await attendre(page, `Number(${trouver('mjs-t-lisse', 'feDisplacementMap')}.getAttribute('scale')) > 30`)
        assert.equal(await page.evaluate(() => (window as any).__racine('mjs-t-lisse').querySelectorAll('[mjs-fx-layer="liquid"]').length), 0)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('*liquid(cells: 12) : la toile WebGL se pose sur l\'image au survol, et se retire quand la force est revenue à zéro', async function () {
        const { page, erreurs } = await ouvrir('ecrits')
        const c = await centre(page, 'mjs-t-carreaux', '.a')
        await page.mouse.move(c.x, c.y)
        await attendre(page, `!!__racine('mjs-t-carreaux').querySelector('[mjs-fx-layer="liquid"]')`)
        await page.mouse.move(790, 690)
        await attendre(page, `!__racine('mjs-t-carreaux').querySelector('[mjs-fx-layer="liquid"]')`)
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    })
  }
})
