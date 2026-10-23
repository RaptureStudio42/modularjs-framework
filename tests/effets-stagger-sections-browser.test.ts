// *stagger CONSTRUIT EN PRODUCTION dans Chromium et Firefox réels, un build par pose : ce que le tri des sections laisse à l'application fait ce que
// le réglage demande. Sans rien écrire : les lettres arrivent l'une après l'autre. Avec un réglage : les mots, les lignes (au rang de leur ligne, puis
// au repos), les enfants (marqués puis rendus naturels), le cache des unités, le défilement qui écrit l'avancée sur chaque unité, et les lignes et
// enfants au défilement. Chaque pose ne contient que le code de son réglage : une section manquante qui casserait une pose se lit ici (une erreur
// de page, un avertissement, ou une arrivée qui ne se joue pas).

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

const STYLE = '\n<style>\n:host\n  display: block\ndiv, p\n  box-sizing: border-box\n.a\n  width: 400px\n  font: 24px sans-serif\n  margin: 10px\n.etroit\n  width: 130px\n.bas\n  margin-top: 900px\n.cale\n  height: 2400px\n</style>\n'
const TEXTE = 'un deux trois quatre cinq six sept huit'
const SCRIPT = '<script>\n$n = 0\n</script>\n'

type Ctx = { page: any, lit: (js: string) => Promise<any> }
type Pose = { nom: string, source: string, verifie: (ctx: Ctx) => Promise<any> }

const POSES: Pose[] = []
const poser = (nom: string, balise: string, contenu: string, verifie: Pose['verifie'], classes = '', pied = '') => POSES.push({ nom, source: SCRIPT + `<div class="a ${classes}" ${balise}>${contenu}</div>` + pied + STYLE, verifie })
const A = `window.__racine(TAG).querySelector('.a')`
const compte = (sel: string) => `${A}.querySelectorAll('${sel}').length`
const defile = async (page: any, ys: number[]) => { for (const y of ys) { await page.evaluate(`window.scrollTo(0, ${y})`); await page.waitForTimeout(120) } }

poser('lettres seules : une animation par lettre', '*stagger(on: load)', 'Salut', async ({ page, lit }) => {
  await page.waitForFunction(`${compte('[mjs-fx-letter]')} === 5`, null, { timeout: 8000 })
  assert.equal(await lit(`getComputedStyle(${A}.querySelector('[mjs-fx-letter]')).animationName`), 'mjs-fx-stagger-move')
})

poser('unit: word : une animation par mot', '*stagger(unit: word, on: load)', 'un deux trois', async ({ page, lit }) => {
  await page.waitForFunction(`${compte('[mjs-fx-word]')} === 3`, null, { timeout: 8000 })
  assert.equal(await lit(`${A}.getAttribute('mjs-fx-stagger-unit')`), 'word')
  assert.deepEqual(await lit(`Array.from(${A}.querySelectorAll('[mjs-fx-word]')).map((w) => w.style.getPropertyValue('--mjs-fx-stagger-k'))`), ['0', '1', '2'])
})

poser('unit: line : les mots au rang de leur ligne, puis au repos', '*stagger(unit: line, on: load, duration: 200ms)', TEXTE, async ({ page, lit }) => {
  await page.waitForFunction(`${compte('[mjs-fx-word]')} === 8`, null, { timeout: 8000 })
  const rangs = await lit(`[...new Set(Array.from(${A}.querySelectorAll('[mjs-fx-word]')).map((w) => w.style.getPropertyValue('--mjs-fx-stagger-k')))]`)
  assert.ok(rangs.length >= 2, 'plusieurs lignes : ' + rangs)
  await page.waitForFunction(`${A}.hasAttribute('mjs-fx-stagger-rest')`, null, { timeout: 8000 })
}, 'etroit')

poser('unit: child : les enfants marqués, puis rendus naturels', '*stagger(unit: child, on: load, duration: 200ms)', '<span>un</span><span>deux</span><span>trois</span>', async ({ page, lit }) => {
  assert.equal(await lit(`!!${A}.querySelector('[mjs-fx-layer]')`), false, 'pas de calque de texte')
  await page.waitForFunction(`${compte('[mjs-fx-child]')} === 0`, null, { timeout: 8000 })
})

poser('clip : chaque lettre derrière son cache', '*stagger(clip: true, on: load, duration: 300ms)', 'Salut', async ({ page }) => {
  await page.waitForFunction(`${compte('[mjs-fx-cut]')} === 5`, null, { timeout: 8000 })
})

poser('on: scroll : l\'avancée est écrite sur chaque lettre', '*stagger(on: scroll)', 'Salut tout le monde', async ({ page, lit }) => {
  for (const y of [500, 650, 800, 950, 1100]) {
    await defile(page, [y])
    if (await lit(`${A}.querySelector('[mjs-fx-letter]').style.getPropertyValue('--mjs-fx-stagger-p') !== ''`)) return
  }
  assert.fail('aucune lettre n\'a reçu l\'avancée')
}, 'bas', '<div class="cale"></div>')

poser('unit: line et on: scroll : au repos quand l\'avancée est au bout', '*stagger(unit: line, on: scroll)', TEXTE, async ({ page }) => {
  await defile(page, [600, 800, 1000, 1400, 2000])
  await page.waitForFunction(`${A}.hasAttribute('mjs-fx-stagger-rest')`, null, { timeout: 8000 })
  await defile(page, [900, 600])
  await page.waitForFunction(`!${A}.hasAttribute('mjs-fx-stagger-rest')`, null, { timeout: 8000 })
}, 'etroit bas', '<div class="cale"></div>')

poser('unit: child et on: scroll : les enfants redeviennent naturels au bout', '*stagger(unit: child, on: scroll)', '<span>un</span><span>deux</span><span>trois</span>', async ({ page }) => {
  await defile(page, [600, 800, 1000, 1400, 2000])
  await page.waitForFunction(`${compte('[mjs-fx-child]')} === 0`, null, { timeout: 8000 })
  await defile(page, [900, 600])
  await page.waitForFunction(`${compte('[mjs-fx-child]')} === 3`, null, { timeout: 8000 })
}, 'bas', '<div class="cale"></div>')

poser('unit: line et clip : les caches posés puis retirés au repos', '*stagger(unit: line, clip: true, on: load, duration: 200ms)', TEXTE, async ({ page }) => {
  await page.waitForFunction(`${compte('[mjs-fx-cut]')} >= 1`, null, { timeout: 8000 })
  await page.waitForFunction(`${compte('[mjs-fx-cut]')} === 0 && ${A}.hasAttribute('mjs-fx-stagger-rest')`, null, { timeout: 8000 })
}, 'etroit')

poser('unit: child et clip : les enfants glissent derrière leur découpe', '*stagger(unit: child, clip: true, on: load, duration: 200ms)', '<span>un</span><span>deux</span>', async ({ page }) => {
  await page.waitForFunction(`${compte('[mjs-fx-child]')} === 0`, null, { timeout: 8000 })
})

poser('tous les réglages ensemble', '*stagger(unit: line, clip: true, on: scroll, step: 20ms, easing: ease)', TEXTE, async ({ page }) => {
  await defile(page, [600, 1000, 1600, 700])
}, 'etroit bas', '<div class="cale"></div>')

describe('*stagger en production — chaque pose construite avec le seul code de ses réglages', function () {
  this.timeout(1800000)
  const scripts: string[] = []

  before(async () => {
    for (const [i, pose] of POSES.entries()) {
      const root   = mjsTmp('stagger-prod-' + i)
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

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox'>) {
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
          const page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
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
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><${tag}></${tag}><script>${scripts[i]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`!!window.__racine('${tag}')?.querySelector('.a')`, null, { timeout: 20000 })
          await page.waitForTimeout(300)
          // TAG est remplacé par la balise du composant dans chaque expression lue dans la page
          const lit = (js: string) => page.evaluate(js.replace(/TAG/g, `'${tag}'`))
          const evaluate = page.evaluate.bind(page)
          page.evaluate = (js: any, ...args: any[]) => evaluate(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          const waitForFunction = page.waitForFunction.bind(page)
          page.waitForFunction = (js: any, ...args: any[]) => waitForFunction(typeof js === 'string' ? js.replace(/TAG/g, `'${tag}'`) : js, ...args)
          try {
            await pose.verifie({ page, lit })
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
