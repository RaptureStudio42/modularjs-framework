// Les outils partagés des effets, en PRODUCTION dans Chromium, Firefox et WebKit réels : *stagger, *goo, *marquee et *filter n'embarquent plus un
// outil que le réglage qui le demande (`on: scroll`, `pointer`, `smooth`). Pour chacun, une appli qui écrit ce réglage et une qui ne l'écrit pas,
// construites en production (le réglage par défaut du bundler, puis `runtime: 'core'` : la configuration de l'appli de référence, où le cœur
// n'a rien en trop). Chaque appli se pose et fait ce que ses réglages demandent, sans erreur de page ni de console : un outil absent donnerait
// « is not a function » à la pose de l'effet ou au premier geste. Les sondes détaillées de chaque réglage sont dans les tests de sections des effets.
// Une pose (`*marquee(on: scroll)`) est aussi construite en `js: 'split'`, le défaut du bundler : le cœur d'un côté, le fichier de l'effet écrit à
// part de l'autre, tous deux servis par le réseau ; les outils sont dans le cœur et l'effet qui les appelle dans son fichier.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
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

const ROUGE = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200'><rect width='300' height='200' fill='#f00'/></svg>`)
const STYLE = '\n<style>\n:host\n  display: block\ndiv, p, img\n  box-sizing: border-box\n.a\n  display: block\n  width: 400px\n  font: 24px sans-serif\n  margin: 10px\n.logo\n  width: 100px\n  height: 40px\n.plateau\n  width: 700px\n  height: 300px\n  background: #5d002a\n.goutte\n  position: relative\n  width: 700px\n  height: 300px\n  b\n    position: absolute\n    top: 90px\n    width: 120px\n    height: 120px\n    border-radius: 50%\n    background: #0039ff\n  .r1\n    left: 150px\n  .r2\n    left: 230px\n.bas\n  margin-top: 900px\n.cale\n  height: 2400px\n</style>\n'
const LOGOS = '<div class="logo">A</div><div class="logo">B</div><div class="logo">C</div>'
const GOUTTE = (balise: string) => `<div class="plateau"><div class="goutte" ${balise}><b class="r1"></b><b class="r2"></b></div></div><div class="cale"></div>`

type Ctx = { page: any, lit: (js: string) => Promise<any>, attend: (js: string) => Promise<void> }
type Pose = { nom: string, source: string, verifie: (ctx: Ctx) => Promise<any>, decoupe: boolean }

const POSES: Pose[] = []
const poser = (nom: string, html: string, verifie: Pose['verifie'], decoupe = false) => POSES.push({ nom, source: html + STYLE, verifie, decoupe })
const A = `window.__racine(TAG).querySelector('.a')`
const defile = async (page: any, ys: number[]) => { for (const y of ys) { await page.evaluate(`window.scrollTo(0, ${y})`); await page.waitForTimeout(120) } }
const centre = (lit: Ctx['lit']) => lit(`(() => { const r = ${A}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)

// ---- *stagger : le défilement et la variable enregistrée ne viennent qu'avec `on: scroll`

poser('*stagger sans `on: scroll` : les lettres arrivent', `<div class="a" *stagger(on: load)>Salut</div>`, async ({ lit, attend }) => {
  await attend(`${A}.querySelectorAll('[mjs-fx-letter]').length === 5`)
  assert.equal(await lit(`getComputedStyle(${A}.querySelector('[mjs-fx-letter]')).animationName`), 'mjs-fx-stagger-move')
})

poser('*stagger(on: scroll) : la page qui défile écrit l\'avancée sur les lettres', `<div class="a bas" *stagger(on: scroll)>Salut tout le monde</div><div class="cale"></div>`, async ({ page, lit }) => {
  for (const y of [500, 650, 800, 950, 1100]) {
    await defile(page, [y])
    if (await lit(`${A}.querySelector('[mjs-fx-letter]').style.getPropertyValue('--mjs-fx-stagger-p') !== ''`)) return
  }
  assert.fail('aucune lettre n\'a reçu l\'avancée')
})

// ---- *goo : le défilement ne vient qu'avec `pointer`

poser('*goo sans `pointer` : le filtre soude les formes, la souris ne pose aucune goutte', GOUTTE('*goo(merge)'), async ({ page, lit }) => {
  await page.mouse.move(900, 700)
  await page.mouse.move(200, 150, { steps: 6 })
  await page.waitForTimeout(80)
  assert.equal(await lit(`window.__racine(TAG).querySelectorAll('[mjs-fx-goo-drop]').length`), 0)
  assert.match(await lit(`getComputedStyle(window.__racine(TAG).querySelector('.goutte')).filter`), /url\(/)
})

poser('*goo(pointer: 90) : la goutte suit la souris, même quand la page défile', GOUTTE('*goo(merge, pointer: 90)'), async ({ page, lit, attend }) => {
  await page.mouse.move(900, 700)
  await page.mouse.move(350, 150, { steps: 6 })
  await attend(`window.__racine(TAG).querySelectorAll('[mjs-fx-goo-drop]').length === 1`)
  await defile(page, [120])
  await page.mouse.move(360, 160, { steps: 3 })
  assert.equal(await lit(`window.__racine(TAG).querySelectorAll('[mjs-fx-goo-drop]').length`), 1, 'toujours une goutte après le défilement')
})

// ---- *marquee : les parents et les racines ne viennent qu'avec `on: scroll`

poser('*marquee sans `on: scroll` : la piste des enfants tourne', `<div class="a" *marquee(speed: 4s, gap: 10)>${LOGOS}</div><div class="cale"></div>`, async ({ lit, attend }) => {
  await attend(`!!${A}.querySelector('[mjs-fx-marquee-run]')`)
  assert.equal(await lit(`getComputedStyle(${A}.querySelector('[mjs-fx-marquee-run]')).animationName`), 'mjs-fx-marquee-run')
})

poser('*marquee(on: scroll) : la page qui défile entraîne la piste', `<div class="a" *marquee(on: scroll, speed: 10s, gap: 10)>${LOGOS}</div><div class="cale"></div>`, async ({ page, attend }) => {
  await attend(`!${A}.hasAttribute('mjs-fx-marquee-away')`)
  await page.evaluate('window.scrollTo(0, 300)')
  await attend(`getComputedStyle(${A}.querySelector('[mjs-fx-marquee-run]')).translate !== '0px'`)
}, true)

// ---- *filter : le retard ne vient qu'avec `smooth` ; le <svg> des styles en filtre SVG

poser('*filter(spot) sans `smooth` : la zone sans filtre suit la souris', `<img class="a" src="${ROUGE}" alt="" *filter(grayscale, spot: 100)>`, async ({ page, lit, attend }) => {
  const c = await centre(lit)
  await page.mouse.move(c.x, c.y, { steps: 3 })
  await attend(`!!window.__racine(TAG).querySelector('[mjs-fx-filter-lens]')`)
})

poser('*filter(spot, smooth) : la zone traîne derrière la souris puis la rejoint', `<img class="a" src="${ROUGE}" alt="" *filter(grayscale, spot: 100, smooth: .15)>`, async ({ page, lit, attend }) => {
  const c = await centre(lit)
  await page.mouse.move(c.x - 100, c.y - 40, { steps: 2 })
  await attend(`!!window.__racine(TAG).querySelector('[mjs-fx-filter-lens]')`)
  await page.mouse.move(c.x + 100, c.y - 40, { steps: 1 })
  await page.waitForTimeout(300)
  assert.ok(await lit(`!!window.__racine(TAG).querySelector('[mjs-fx-filter-lens]')`), 'la zone est toujours là')
})

poser('*filter(style: duotone) : le <svg> du filtre est posé dans la racine', `<img class="a" src="${ROUGE}" alt="" *filter(style: duotone, colors: ['#000000', '#ffffff'])>`, async ({ lit }) => {
  assert.equal(await lit(`window.__racine(TAG).querySelectorAll('svg filter').length`), 1)
  assert.match(await lit(`getComputedStyle(${A}).filter`), /url\(/)
})

const CONFS: Record<string, Record<string, unknown>> = { defaut: {}, coeur: { runtime: 'core' }, decoupe: { js: 'split' } }

describe('les outils des effets en production — dans des navigateurs réels', function () {
  this.timeout(1800000)
  const scripts: Record<string, Record<number, string>> = { defaut: {}, coeur: {}, decoupe: {} }
  // les dossiers de sortie des constructions découpées, servis tels quels sous /out/
  const dossiers: Record<number, string> = {}

  before(async () => {
    for (const [conf, options] of Object.entries(CONFS)) {
      for (const [i, pose] of POSES.entries()) {
        if (conf === 'decoupe' && !pose.decoupe) continue
        const root   = mjsTmp('outils-filtres-' + conf + '-' + i)
        const srcDir = join(root, 'src')
        const outDir = join(root, 'out')
        mkdirSync(srcDir, { recursive: true })
        writeFileSync(join(srcDir, 'o-' + i + '.mjs'), pose.source)
        // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
        const manifeste = join(outDir, 'bundle.js')
        const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod', ...(conf === 'decoupe' ? { urlPrefix: '/out' } : {}), ...options } as any)
        const stats     = await bundler.compile()
        await bundler.close()
        assert.deepEqual(stats.errors.map((e: any) => e.message), [], conf + ' : ' + pose.nom)
        if (conf === 'decoupe') dossiers[i] = outDir
        else scripts[conf][i] = stripEsm(readFileSync(manifeste, 'utf-8'))
      }
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

      for (const conf of Object.keys(CONFS)) {
        describe(conf === 'coeur' ? 'runtime: core (l\'appli de référence)' : conf === 'decoupe' ? 'js: split (le défaut du bundler : le cœur et le fichier de chaque effet)' : 'réglage par défaut', function () {
          POSES.forEach((pose, i) => {
            if (conf === 'decoupe' && !pose.decoupe) return
            it(pose.nom, async () => {
              const tag     = 'mjs-o-' + i
              const page    = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage()
              const erreurs: string[] = []
              page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
              page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()) })
              try {
                await page.addInitScript(`window.__racine = (tag) => {
                  const el = document.querySelector(tag)
                  if (!el) return null
                  if (el.shadowRoot) return el.shadowRoot
                  for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
                  return el
                }`)
                await page.route('http://t.test/**', (route: any) => {
                  const chemin = new URL(route.request().url()).pathname
                  if (conf === 'decoupe' && chemin.startsWith('/out/')) {
                    const fichier = join(dossiers[i], basename(chemin))
                    if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
                    return route.fulfill({ contentType: fichier.endsWith('.json') ? 'application/json' : 'text/javascript', body: readFileSync(fichier) })
                  }
                  if (chemin !== '/') return route.fulfill({ status: 404, body: '' })
                  const script = conf === 'decoupe' ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${scripts[conf][i]}</script>`
                  return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}>${script}</body></html>` })
                })
                await page.goto('http://t.test/', { waitUntil: 'load' })
                // TAG est remplacé par la balise du composant dans chaque expression lue dans la page
                const lit    = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
                const attend = (js: string) => page.waitForFunction(js.replace(/TAG/g, `'${tag}'`), null, { timeout: 8000 })
                await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a, .goutte')`, null, { timeout: 20000 })
                await page.waitForTimeout(300)
                await pose.verifie({ page, lit, attend })
                assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement dans la console ni dans la page')
              }
              finally {
                await page.context().close()
              }
            })
          })
        })
      }
    })
  }
})
