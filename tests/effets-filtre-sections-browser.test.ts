// *filter CONSTRUIT EN PRODUCTION dans Chromium, Firefox et WebKit réels, un build par pose : ce que le tri des sections laisse à l'application fait ce que
// le réglage demande. Sans rien de la zone : l'image est filtrée (grise au repos, ou au survol, avec un filtre CSS ou un filtre SVG) et ne pose rien au
// survol. Avec `spot` : la zone sans filtre se pose sous la souris (le rouge de l'image y revient, le gris reste ailleurs), son bord est de 40 px et son
// retard de 0.2 sans autre réglage ; `soft` et `smooth` écrits changent le bord et le retard ; un réglage tenu par une variable se suit sur place (la zone
// naît, se défait, change de bord et de retard). Chaque pose ne contient que le code de ses réglages : une section manquante qui casserait une pose se lit
// ici (une erreur de page, un avertissement, ou un geste sans effet).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ROUGE   = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' shape-rendering='crispEdges'><rect width='300' height='200' fill='#f00'/></svg>`)
const STYLE   = '\n<style>\n:host\n  display: block\n.b\n  width: 300px\n  height: 200px\n  margin: 10px\n.a\n  display: block\n  width: 300px\n  height: 200px\n</style>\n'
const SCRIPT  = '<script>\n$d = 100\n$f = 10\n$m = 1\n</script>\n'
const BOUTONS = '<button class="mince" @click={$f = 90}>bord</button><button class="arret" @click={$d = 0}>arrêt</button><button class="marche" @click={$d = 100}>marche</button><button class="lent" @click={$m = .1}>lent</button>'

// une pose = une page de production ; `verifie` lit la page et rend ce qu'elle a vu
type Pose = { nom: string, source: string, verifie: (ctx: Ctx) => Promise<any> }
type Ctx = { page: any, lit: (js: string) => Promise<any>, boite: () => Promise<{ x: number, y: number, w: number, h: number }>, pixels: (points: Array<[number, number]>) => Promise<number[][]> }

const POSES: Pose[] = []
const poser = (nom: string, balise: string, verifie: Pose['verifie'], pied = '') => POSES.push({ nom, source: SCRIPT + `<div class="b"><img class="a" ${balise} src="${ROUGE}" alt="a"></div>` + pied + STYLE, verifie })

const rouge = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60
const gris  = (p: number[]) => Math.abs(p[0] - p[1]) < 8 && Math.abs(p[1] - p[2]) < 8 && p[0] > 20 && p[0] < 90

const zone     = `window.__racine(TAG).querySelector('[mjs-fx-filter-lens]')`
const copies   = `window.__racine(TAG).querySelectorAll('[mjs-fx-filter-copy]').length`
const filtre   = `getComputedStyle(window.__racine(TAG).querySelector('.a')).filter`
const decalage = `(() => { const z = ${zone}; return z ? getComputedStyle(z).translate.split(' ').map((n) => parseFloat(n) || 0) : null })()`
const largeur  = `parseFloat(getComputedStyle(${zone}).width)`
const bord     = `${zone}.style.getPropertyValue('--mjs-fx-filter-s')`

// la zone a rejoint (à un demi-pixel) le point de la souris, lu dans le repère de l'image
const rejointe = (x: number, y: number) => `(() => { const t = ${decalage}; return !!t && Math.abs(t[0] - ${x}) < 0.5 && Math.abs(t[1] - ${y}) < 0.5 })()`

poser('sans réglage de la zone : l\'image est filtrée et le survol ne pose rien', '*filter(grayscale)', async ({ page, lit, boite, pixels }) => {
  const b = await boite()
  assert.ok(gris((await pixels([[b.x + 150, b.y + 100]]))[0]), 'au repos, du gris')
  assert.match(await lit(filtre), /grayscale\(1\)/)
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForTimeout(400)
  assert.equal(await lit(`!!${zone}`), false, 'aucune lentille')
  assert.equal(await lit(copies), 0, 'aucun double')
  assert.ok(gris((await pixels([[b.x + 100, b.y + 80]]))[0]), 'sous la souris, toujours du gris')
})

poser('les réglages de la V3 : un filtre CSS au survol, rien de la zone', '*filter(sepia, amount: .5, brightness: 1.2, on: hover, duration: 10ms)', async ({ page, lit, boite }) => {
  const b = await boite()
  assert.equal(await lit(filtre), 'none', 'au repos, pas de filtre')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`/sepia\\(/.test(${filtre})`, null, { timeout: 8000 })
  assert.equal(await lit(`!!${zone}`), false, 'aucune lentille')
})

poser('un style en filtre SVG (duotone) : le filtre est posé dans la racine, rien de la zone', '*filter(style: duotone, colors: [\'#000000\', \'#ffffff\'])', async ({ page, lit, boite }) => {
  assert.equal(await lit(`window.__racine(TAG).querySelectorAll('svg filter').length`), 1, 'un filtre SVG')
  assert.match(await lit(filtre), /url\(/)
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForTimeout(300)
  assert.equal(await lit(`!!${zone}`), false, 'aucune lentille')
})

poser('spot seul : la couleur revient sous la souris, le bord est de 40 px et la zone rejoint la souris', '*filter(grayscale, spot: 100)', async ({ page, lit, boite, pixels }) => {
  const b = await boite()
  assert.ok(gris((await pixels([[b.x + 100, b.y + 80]]))[0]), 'au repos, du gris')
  assert.equal(await lit(copies), 0, 'le double n\'existe pas au repos')
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(rejointe(100, 80), null, { timeout: 8000 })
  assert.equal(await lit(copies), 1, 'un seul double pendant le survol')
  assert.equal(await lit(largeur), 180, 'la lentille fait 100 px + 2 × 40 px : le bord de 40 px vient de la feuille')
  assert.equal(await lit(bord), '', 'le bord n\'est pas écrit sur la lentille sans `soft`')
  await page.waitForTimeout(400)
  const [dedans, juste, loin] = await pixels([[b.x + 100, b.y + 80], [b.x + 100 + 40, b.y + 80], [b.x + 100 + 110, b.y + 80]])
  assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
  assert.ok(rouge(juste), `à 40 px (rayon : 50), encore rouge : ${juste}`)
  assert.ok(gris(loin), `à 110 px, du gris : ${loin}`)
  await page.mouse.move(b.x + 150, b.y + 190, { steps: 3 })
  await page.mouse.move(2, 2, { steps: 3 })
  await page.waitForFunction(`!${zone}`, null, { timeout: 8000 })
  assert.equal(await lit(copies), 0, 'le double repart après la sortie')
})

poser('spot et soft : le bord écrit est celui de la lentille', '*filter(grayscale, spot: 100, soft: 0)', async ({ page, lit, boite, pixels }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(rejointe(100, 80), null, { timeout: 8000 })
  assert.equal(await lit(bord), '0px')
  assert.equal(await lit(largeur), 100, 'sans bord, la lentille fait 100 px')
  await page.waitForTimeout(400)
  const [dedans, dehors] = await pixels([[b.x + 100 + 45, b.y + 80], [b.x + 100 + 60, b.y + 80]])
  assert.ok(rouge(dedans), `à 45 px (rayon : 50), rouge : ${dedans}`)
  assert.ok(gris(dehors), `à 60 px, du gris, le bord est franc : ${dehors}`)
})

poser('spot et smooth : la zone traîne derrière la souris puis la rejoint', '*filter(grayscale, spot: 100, smooth: .15)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 40, b.y + 40, { steps: 2 })
  await page.waitForFunction(rejointe(40, 40), null, { timeout: 8000 })
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  const tot = await lit(decalage)
  assert.ok(tot[0] < 240 - 20, `juste après le saut, la zone est en retard : ${tot}`)
  await page.waitForFunction(rejointe(240, 40), null, { timeout: 8000 })
})

poser('spot et smooth: 1 : la zone colle à la souris', '*filter(grayscale, spot: 100, smooth: 1)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 40, b.y + 40, { steps: 2 })
  await page.mouse.move(b.x + 240, b.y + 40, { steps: 1 })
  const t = await lit(decalage)
  assert.ok(Math.abs(t[0] - 240) < 0.5, `la zone est sur la souris : ${t}`)
})

poser('spot, soft et smooth tenus par des variables : la zone naît, change de bord et de retard, se défait', '*filter(grayscale, spot: $d, soft: $f, smooth: $m)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(rejointe(100, 80), null, { timeout: 8000 })
  assert.equal(await lit(bord), '10px')
  await page.evaluate(`window.__racine(TAG).querySelector('.mince').click()`)
  await page.waitForFunction(`${bord} === '90px'`, null, { timeout: 8000 })
  await page.evaluate(`window.__racine(TAG).querySelector('.lent').click()`)
  await page.mouse.move(b.x + 250, b.y + 80, { steps: 1 })
  const tot = await lit(decalage)
  assert.ok(tot[0] < 250 - 20, `le retard a changé sur place : ${tot}`)
  await page.waitForFunction(rejointe(250, 80), null, { timeout: 8000 })
  await page.evaluate(`window.__racine(TAG).querySelector('.arret').click()`)
  await page.waitForFunction(`!${zone}`, null, { timeout: 8000 })
  await page.mouse.move(b.x + 120, b.y + 100, { steps: 2 })
  await page.waitForTimeout(300)
  assert.equal(await lit(`!!${zone}`), false, 'spot à 0 : plus de zone')
  await page.evaluate(`window.__racine(TAG).querySelector('.marche').click()`)
  await page.mouse.move(b.x + 100, b.y + 100, { steps: 2 })
  await page.waitForFunction(`!!${zone}`, null, { timeout: 8000 })
  assert.equal(await lit(bord), '90px', 'la nouvelle zone a le bord changé')
}, BOUTONS)

poser('tous les réglages ensemble : le filtre au survol et la zone', '*filter(sepia, on: hover, duration: 10ms, spot: 120, soft: 30, smooth: .3)', async ({ page, lit, boite }) => {
  const b = await boite()
  await page.mouse.move(b.x + 100, b.y + 80, { steps: 3 })
  await page.waitForFunction(`/sepia\\(/.test(${filtre}) && ${rejointe(100, 80)}`, null, { timeout: 8000 })
  assert.equal(await lit(bord), '30px')
  assert.equal(await lit(largeur), 180, '120 px + 2 × 30 px')
})

describe('*filter en production — chaque pose construite avec le seul code de ses réglages', function () {
  this.timeout(1800000)
  const scripts: string[] = []

  before(async () => {
    for (const [i, pose] of POSES.entries()) {
      const root   = mjsTmp('filtre-prod-' + i)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 't-' + i + '.mjs'), pose.source)
      // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], pose.nom)
      scripts.push(stripEsm(readFileSync(manifeste, 'utf-8')))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      POSES.forEach((pose, i) => {
        it(pose.nom, async () => {
          const tag     = 'mjs-t-' + i
          const page    = await (await browser.newContext({ viewport: { width: 340, height: 300 } })).newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          await page.addInitScript(`window.__racine = (tag) => {
            const el = document.querySelector(tag)
            if (!el) return null
            if (el.shadowRoot) return el.shadowRoot
            for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
            return el
          }`)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${scripts[i]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a')`, null, { timeout: 20000 })
          await page.waitForTimeout(400)
          // TAG est remplacé par la balise du composant dans chaque expression lue dans la page
          const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
          const evaluate = page.evaluate.bind(page)
          page.evaluate = (js: any, ...args: any[]) => evaluate(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const waitForFunction = page.waitForFunction.bind(page)
          page.waitForFunction = (js: any, ...args: any[]) => waitForFunction(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const boite = () => lit(`(() => { const r = window.__racine(TAG).querySelector('.a').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
          const pixels = async (points: Array<[number, number]>): Promise<number[][]> => {
            const shot = await page.screenshot()
            return evaluate(`(async ([b64, pts]) => {
              const img = new Image()
              img.src = 'data:image/png;base64,' + b64
              await img.decode()
              const cv = document.createElement('canvas')
              cv.width = img.width
              cv.height = img.height
              const c = cv.getContext('2d', { willReadFrequently: true })
              c.drawImage(img, 0, 0)
              return pts.map(([x, y]) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
            })(${JSON.stringify([shot.toString('base64'), points])})`)
          }
          try {
            await pose.verifie({ page, lit, boite, pixels })
            assert.deepEqual(erreurs, [])
          }
          finally {
            await page.close()
          }
        })
      })
    })
  }
})
