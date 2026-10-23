// *sprite construit EN PRODUCTION (sections filtrées) dans des navigateurs réels : sans écouteur de `mjs:sprite-end`, une boucle d'une ou
// deux cases par tour ne lance aucun script par tour (rien n'est écouté, rien n'est fabriqué) ; avec l'écouteur, un évènement par tour ;
// et les réglages que la page écrit (cadence, ligne, poses, dernière pose gardée, arrêt) marchent dans le fichier filtré.
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

const PLANCHE = (l: number, h: number) => `data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27${l}%27 height=%27${h}%27%3E%3Crect width=%27${l}%27 height=%27${h}%27 fill=%27%23c33%27/%3E%3C/svg%3E`
const STYLE   = '\n<style>\n.a\n  width: 30px\n  height: 40px\n</style>\n'

// chaque appli est construite une fois : un composant, une balise
const APPLIS: Record<string, string> = {
  muette:  `<div class="a" *sprite('${PLANCHE(60, 40)}', frames: 2, fps: 120)></div>${STYLE}`,
  ecoute:  `<script>\n$n = 0\n</script>\n<div class="a" *sprite('${PLANCHE(60, 40)}', frames: 2, fps: 120) @mjs:sprite-end={$n++}></div><p class="n">{$n}</p>${STYLE}`,
  reglages: `<div class="a" *sprite('${PLANCHE(90, 160)}', columns: 3, rows: 4, row: 2, poses: [1, 2, 1, 0], fps: 5, repeat: 1, hold: true)></div>${STYLE}`,
  lignes:  `<div class="a" *sprite('${PLANCHE(90, 160)}', columns: 3, rows: 4, row: 2)></div>${STYLE}`,
  colonne: `<div class="a" *sprite('${PLANCHE(30, 160)}', columns: 1, rows: 4, row: 2)></div>${STYLE}`,
  liste:   `<div class="a" *sprite('${PLANCHE(90, 40)}', columns: 3, poses: [1, 2, 1, 0])></div>${STYLE}`,
  arret:   `<div class="a" *sprite('${PLANCHE(180, 40)}', frames: 6, start: 4, animate: false)></div>${STYLE}`
}

describe('*sprite — des applis construites en production dans des navigateurs réels', function () {
  this.timeout(900000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [appli, source] of Object.entries(APPLIS)) {
      const root   = mjsTmp('sprite-sections-navigateur-' + appli)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 't-' + appli + '.mjs'), source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod', runtime: ['easing'] } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      scripts[appli] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

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

      // la page d'une appli ; compte, dès le chargement, les évènements de fin de tour vus au document et les écouteurs d'itération posés
      async function ouvrir(appli: string): Promise<{ page: any, erreurs: string[] }> {
        const page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
        const erreurs: string[] = []
        await page.addInitScript(() => {
          const w: any = window
          w.__fins = 0
          w.__iterations = 0
          document.addEventListener('mjs:sprite-end', () => { w.__fins++ }, true)
          const poser = EventTarget.prototype.addEventListener
          EventTarget.prototype.addEventListener = function (this: any, type: string, ...reste: any[]) {
            if (type === 'animationiteration') w.__iterations++
            return (poser as any).call(this, type, ...reste)
          } as any
          w.__racine = (tag: string) => {
            const el: any = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }
        })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><mjs-t-${appli}></mjs-t-${appli}><script>${scripts[appli]}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        try {
          await page.waitForFunction((tag: string) => !!(window as any).__racine(tag)?.querySelector('[mjs-fx-layer="sprite"]'), 'mjs-t-' + appli, { timeout: 20000 })
        }
        catch (e) {
          throw new Error('la page ne s\'est pas montée : ' + erreurs.join(' | ') + ' :: ' + await page.evaluate((tag: string) => { const r = (window as any).__racine(tag); return r ? (r.innerHTML || r.outerHTML) : 'pas de racine' }, 'mjs-t-' + appli))
        }
        return { page, erreurs }
      }
      const calque = (appli: string) => `(__racine('mjs-t-${appli}').querySelector('[mjs-fx-layer="sprite"]'))`

      it('sans écouteur de mjs:sprite-end : une boucle de deux cases à 120 par seconde ne traite aucun évènement en une seconde — rien n\'est écouté, rien n\'est fabriqué', async () => {
        const { page, erreurs } = await ouvrir('muette')
        const anims = await page.evaluate(`${calque('muette')}.getAnimations().length`)
        assert.equal(anims, 1, 'la planche tourne')
        const avant = await page.evaluate(() => (window as any).__iterations)
        await page.waitForTimeout(1000)
        const apres = await page.evaluate(() => ({ fins: (window as any).__fins, iterations: (window as any).__iterations }))
        assert.equal(apres.fins, 0, 'aucun évènement de fin de tour')
        assert.equal(apres.iterations, 0, 'aucun écouteur d\'itération posé')
        assert.equal(avant, 0)
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('avec @mjs:sprite-end : un évènement par tour, le compteur de la page le suit', async () => {
        const { page, erreurs } = await ouvrir('ecoute')
        await page.waitForTimeout(1000)
        const apres = await page.evaluate(() => ({ fins: (window as any).__fins, iterations: (window as any).__iterations, texte: (window as any).__racine('mjs-t-ecoute').querySelector('.n').textContent }))
        assert.ok(apres.fins >= 10, 'au moins dix tours en une seconde (soixante en théorie) : ' + apres.fins)
        assert.ok(apres.iterations >= 1, 'l\'écouteur d\'itération est là')
        assert.ok(Number(apres.texte) >= 10, 'la page compte : ' + apres.texte)
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('les réglages écrits marchent dans le fichier filtré : cadence (0,8 s), ligne (haut décalé de deux poses), poses, dernière pose gardée', async () => {
        const { page, erreurs } = await ouvrir('reglages')
        const etat = await page.evaluate(`(() => { const l = ${calque('reglages')}; const cs = getComputedStyle(l); return { duree: cs.animationDuration, haut: cs.top, remplissage: cs.animationFillMode, nom: cs.animationName } })()`)
        assert.equal(etat.duree, '0.8s', 'quatre entrées à cinq par seconde')
        assert.equal(etat.haut, '-80px', 'ligne 2 : deux poses de quarante pixels')
        assert.equal(etat.remplissage, 'forwards', 'la dernière pose gardée')
        assert.match(etat.nom, /^mjs-fx-sprite-p1_2_1_0-3-4$/)
        await page.waitForFunction(`${calque('reglages')}.getAnimations().length === 0 || ${calque('reglages')}.getAnimations()[0].playState === 'finished'`, null, { timeout: 8000 })
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('une planche à lignes avec row, sans poses (seul) : la ligne montrée, l\'ordre de lecture des trois cases de la ligne', async () => {
        const { page, erreurs } = await ouvrir('lignes')
        const etat = await page.evaluate(`(() => { const l = ${calque('lignes')}; const cs = getComputedStyle(l); return { haut: cs.top, ligne: l.style.getPropertyValue('--mjs-fx-sprite-row'), nom: cs.animationName, hauteur: cs.height } })()`)
        assert.equal(etat.haut, '-80px', 'ligne 2 : deux poses de quarante pixels')
        assert.equal(etat.ligne, '2', 'la ligne est posée au montage')
        assert.equal(etat.nom, 'mjs-fx-sprite-3-3', 'sans poses, les trois cases de la ligne dans l\'ordre de lecture')
        assert.equal(etat.hauteur, '160px', 'le calque porte les quatre lignes')
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('une planche à lignes d\'une seule colonne (aucune animation, donc aucun arrondi au pixel) : la règle de la ligne suffit à la montrer', async () => {
        const { page, erreurs } = await ouvrir('colonne')
        const etat = await page.evaluate(`(() => { const l = ${calque('colonne')}; const cs = getComputedStyle(l); return { haut: cs.top, snap: l.hasAttribute('mjs-fx-sprite-snap'), anims: l.getAnimations().length } })()`)
        assert.equal(etat.snap, false, 'une seule pose : pas d\'arrondi au pixel')
        assert.equal(etat.anims, 0)
        assert.equal(etat.haut, '-80px', 'ligne 2 : deux poses de quarante pixels')
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('poses sans rows (seul) : la liste jouée sur une seule ligne, aucune ligne décalée', async () => {
        const { page, erreurs } = await ouvrir('liste')
        const etat = await page.evaluate(`(() => { const l = ${calque('liste')}; const cs = getComputedStyle(l); return { haut: cs.top, ligne: l.style.getPropertyValue('--mjs-fx-sprite-row'), nom: cs.animationName, hauteur: cs.height } })()`)
        assert.equal(etat.nom, 'mjs-fx-sprite-p1_2_1_0-3-1', 'la liste de poses sur trois colonnes, une ligne')
        assert.equal(etat.haut, '0px', 'aucune ligne décalée')
        assert.equal(etat.ligne, '', 'aucune ligne posée')
        assert.equal(etat.hauteur, '40px')
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })

      it('animate: false au montage, dans le fichier filtré : aucune animation, la pose start', async () => {
        const { page, erreurs } = await ouvrir('arret')
        const etat = await page.evaluate(`(() => { const l = ${calque('arret')}; return { anims: l.getAnimations().length, translate: getComputedStyle(l).translate, wc: getComputedStyle(l).willChange } })()`)
        assert.equal(etat.anims, 0)
        assert.match(etat.translate, /^-?[0-9.]+px 0px$|^-?[0-9.]+% 0%$/)
        assert.equal(etat.wc, 'auto')
        assert.deepEqual(erreurs, [])
        await page.context().close()
      })
    })
  }
})
