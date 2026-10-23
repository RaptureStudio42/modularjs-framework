// les outils du cœur des effets (runtime/mjs_fx_tool*.ts) dans un navigateur ancien : sans IntersectionObserver ni ResizeObserver, les
// effets qui s'en servent se posent sans erreur — la balise est tenue pour visible, la taille n'est pas surveillée, le reste marche.
// De vrais effets, construits par le bundler, dans des navigateurs réels, l'API retirée avant tout script de la page.
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté).

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

const PANNEAUX = Array.from({ length: 4 }, (_, i) => `<article class="p">Panneau ${i + 1}</article>`).join('')

// trois scènes : deux balises à *velocity, une pile de quatre panneaux, un cadre à *pointer (`outside` pose un voile, que l'effet fait
// surveiller par mjs_fx_toolwatch.ts pendant le survol)
const SOURCES: Record<string, string> = {
  'ao-velocity.mjs': '<div class="b b1" *velocity>un</div>\n<div class="b b2" *velocity>deux</div>\n<style>\n.b\n  width: 160px\n  height: 100px\n  background: #36c\n</style>\n',
  'ao-pile.mjs':     `<section class="pile" *pile(gap: 64)>${PANNEAUX}</section>\n<style>\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n</style>\n`,
  'ao-pointer.mjs':  '<div class="s" *pointer(lens, outside: true, filter: blur, size: 60)>cadre</div>\n<style>\n.s\n  width: 300px\n  height: 120px\n  background: #223\n</style>\n'
}

describe('les outils du cœur des effets (navigateurs anciens : sans IntersectionObserver ni ResizeObserver)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-outils-anciens-browser')
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
    const code  = (r: number) => files.filter((f) => rang(f) === r).sort((a, b) => a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    script = [code(0), code(1), code(2)].join('\n') + '\nglobalThis.µ = µ;'
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

      beforeEach(function () { if (!present) this.skip() })

      // la page `tag`, l'API `sans` retirée de la fenêtre avant tout script ; `fn` s'y exécute, les erreurs de la page sont vides à la fin
      async function avec<T>(tag: string, sans: string, fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        // le moteur écrit une erreur d'effet dans la console : elle compte aussi (les 404 du banc, non)
        page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) erreurs.push(m.text()) })
        try {
          await page.addInitScript((api: string) => { delete (window as any)[api] }, sans)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          assert.equal(await page.evaluate((api: string) => typeof (window as any)[api], sans), 'undefined', 'le banc : ' + sans + ' est retiré')
          // ce que la page a dit d'elle-même accompagne tout échec : une erreur d'API absente laisse la page sans balise rendue
          const dit = () => ' — erreurs de la page : ' + (erreurs.join(' | ') || 'aucune')
          try {
            await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag, { timeout: 20000 })
          } catch {
            throw new Error('aucune balise habillée par l\'effet' + dit())
          }
          let r: T
          try {
            r = await fn(page)
          } catch (e: any) {
            throw new Error(String(e.message ?? e).split('\n')[0] + dit())
          }
          assert.deepEqual(erreurs, [])
          return r
        } finally {
          await page.close()
        }
      }

      const compte = (page: any, tag: string, sel: string): Promise<number> => page.evaluate(([t, s]: string[]) => (document.querySelector(t) as any)._shadow.querySelectorAll(s).length, [tag, sel])

      it('sans IntersectionObserver, *velocity pose ses deux balises : rendues, habillées, sans erreur', async function () {
        await avec('mjs-ao-velocity', 'IntersectionObserver', async (page) => {
          await page.waitForTimeout(500)
          assert.equal(await compte(page, 'mjs-ao-velocity', '.b'), 2, 'les balises sont rendues')
          assert.equal(await compte(page, 'mjs-ao-velocity', '[mjs-fx]'), 2, 'et habillées par l\'effet')
        })
      })

      it('sans IntersectionObserver, *pile pose ses quatre panneaux : rendus, habillés, sans erreur', async function () {
        await avec('mjs-ao-pile', 'IntersectionObserver', async (page) => {
          await page.waitForTimeout(500)
          assert.equal(await compte(page, 'mjs-ao-pile', '.p'), 4, 'les panneaux sont rendus')
          assert.ok(await compte(page, 'mjs-ao-pile', '[mjs-fx]') >= 1, 'la pile est habillée par l\'effet')
        })
      })

      it('sans ResizeObserver, *pointer ne lève aucune erreur à l\'entrée de la souris et pose son voile', async function () {
        await avec('mjs-ao-pointer', 'ResizeObserver', async (page) => {
          await page.mouse.move(20, 20)
          await page.mouse.move(150, 60, { steps: 6 })
          await page.waitForTimeout(500)
          assert.ok(await compte(page, 'mjs-ao-pointer', '[mjs-fx-layer="pointer"]') >= 1, 'le voile de l\'effet est posé')
        })
      })
    })
  }
})
