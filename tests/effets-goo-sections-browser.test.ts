// *goo construit EN PRODUCTION (sections filtrées) dans des navigateurs réels, dans la configuration de l'appli de référence (`runtime: 'core'`,
// `js: 'bundle'`) et dans celle par défaut : sans `pointer`, la souris ne pose aucune goutte et le fichier n'en porte pas le code ; avec `pointer`
// (fixe, ou tenu par une variable qui le met à 90 puis à 0), la goutte suit la souris sous la page qui défile, de la couleur du premier enfant ;
// et ce que `*goo` faisait avant (le mode drip, le glisser, le halo nul) marche dans le fichier filtré.
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

const PLATEAU = '\n.plateau\n  width: 700px\n  height: 300px\n  background: #5d002a\n.goutte\n  position: relative\n  width: 700px\n  height: 300px\n  b\n    position: absolute\n    top: 90px\n    width: 120px\n    height: 120px\n    border-radius: 50%\n    background: #0039ff\n  .r1\n    left: 30px\n  .r2\n    left: 290px\n.bas\n  height: 1500px\n'
const COULE   = '\n.coule\n  width: 300px\n  height: 120px\n  background: #c0392b\n'

// chaque appli est construite une fois par configuration : un composant, une balise
const APPLIS: Record<string, string> = {
  defaut:   `<div class="plateau"><div class="goutte" *goo(merge)><b class="r1"></b><b class="r2"></b></div></div><div class="bas"></div>\n<style>${PLATEAU}</style>\n`,
  pointeur: `<div class="plateau"><div class="goutte" *goo(merge, pointer: 90)><b class="r1"></b><b class="r2"></b></div></div><div class="bas"></div>\n<style>${PLATEAU}</style>\n`,
  variable: `<script>\n$p = 0\n</script>\n<div class="plateau"><div class="goutte" *goo(merge, pointer: $p)><b class="r1"></b><b class="r2"></b></div></div><button class="on" @click={$p = 90}>on</button><button class="off" @click={$p = 0}>off</button>\n<style>${PLATEAU}.on\n  position: absolute\n  left: 20px\n  top: 340px\n.off\n  position: absolute\n  left: 140px\n  top: 340px\n</style>\n`,
  goutte:   `<div class="coule" *goo>texte</div>\n<style>${COULE}</style>\n`,
  glisser:  `<div class="plateau"><div class="goutte" *goo(merge, drag: true, halo: 0)><b class="r1"></b><b class="r2"></b></div></div>\n<style>${PLATEAU}</style>\n`
}
const CONFS: Record<string, any> = { coeur: { runtime: 'core' }, complet: {} }

describe('*goo — des applis construites en production dans des navigateurs réels', function () {
  this.timeout(900000)
  const scripts: Record<string, Record<string, string>> = { coeur: {}, complet: {} }

  before(async () => {
    for (const [conf, options] of Object.entries(CONFS)) {
      for (const [appli, source] of Object.entries(APPLIS)) {
        // la configuration par défaut n'est construite que pour les deux applis qui disent si la goutte est là ou non
        if (conf === 'complet' && !['defaut', 'pointeur'].includes(appli)) continue
        const root   = mjsTmp('goo-sections-navigateur-' + conf + '-' + appli)
        const srcDir = join(root, 'src')
        const outDir = join(root, 'out')
        mkdirSync(srcDir, { recursive: true })
        writeFileSync(join(srcDir, 'tgs-' + appli + '.mjs'), source)
        // un seul fichier (le manifeste) : les noms réduits des morceaux ne se heurtent pas
        const manifeste = join(outDir, 'bundle.js')
        const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod', ...options } as any)
        const stats     = await bundler.compile()
        await bundler.close()
        assert.deepEqual(stats.errors.map((e: any) => e.message), [])
        scripts[conf][appli] = stripEsm(readFileSync(manifeste, 'utf-8'))
      }
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
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

      // la page d'une appli, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite ; aucune erreur de la page ni de la console n'est permise
      async function avec<T>(conf: string, appli: string, fn: (page: any) => Promise<T>): Promise<T> {
        const page    = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()) })
        const tag = 'mjs-tgs-' + appli
        try {
          await page.addInitScript(() => {
            const w: any = window
            w.__racine = (t: string) => {
              const el: any = document.querySelector(t)
              if (!el) return null
              if (el.shadowRoot) return el.shadowRoot
              for (const k of Object.getOwnPropertyNames(el)) if (el[k] && el[k].nodeType === 11) return el[k]
              return el
            }
          })
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${scripts[conf][appli]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(window as any).__racine(t)?.querySelector('[mjs-fx~="goo"]'), tag, { timeout: 20000 })
          const r = await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement dans la console ni dans la page')
          return r
        }
        finally {
          await page.context().close()
        }
      }

      // la goutte du pointeur, telle que la page la montre
      const goutte = (page: any, appli: string) => page.evaluate((t: string) => {
        const s = (window as any).__racine(t)
        const d = s.querySelector('[mjs-fx-goo-drop]')
        const b = d && d.getBoundingClientRect()
        return { n: s.querySelectorAll('[mjs-fx-goo-drop]').length, enfants: s.querySelector('.goutte').children.length, cx: b && b.left + b.width / 2, cy: b && b.top + b.height / 2, w: b && b.width, pe: d && getComputedStyle(d).pointerEvents, fond: d && getComputedStyle(d).backgroundColor }
      }, 'mjs-tgs-' + appli)

      // des images d'animation passées (un nombre d'images, pas une durée) : ce qui attendait la prochaine image a eu son tour
      const images = (page: any, n = 2) => page.evaluate((k: number) => new Promise<void>((fini) => {
        const suite = (reste: number) => { if (reste <= 0) fini(); else requestAnimationFrame(() => suite(reste - 1)) }
        suite(k)
      }), n)

      // un geste : on part de (x0, y0), puis on avance par pas jusqu'à (x1, y1)
      async function glisse(page: any, x0: number, y0: number, x1: number, y1: number, pas = 6) {
        await page.mouse.move(x0, y0)
        await page.mouse.move(x1, y1, { steps: pas })
      }

      for (const conf of Object.keys(CONFS)) {
        describe(conf === 'coeur' ? 'runtime: core, js: bundle (l\'appli de référence)' : 'configuration par défaut', function () {
          it('sans `pointer`, la souris ne pose aucune goutte ; le filtre est sur la balise', async () => {
            await avec(conf, 'defaut', async (page) => {
              await glisse(page, 900, 700, 200, 150)
              await page.waitForTimeout(80)
              const g = await goutte(page, 'defaut')
              assert.equal(g.n, 0, 'aucune goutte')
              assert.equal(g.enfants, 2, 'les deux formes, rien de plus')
              const filtre = await page.evaluate((t: string) => getComputedStyle((window as any).__racine(t).querySelector('.goutte')).filter, 'mjs-tgs-defaut')
              assert.ok(/url\(/.test(filtre), 'le filtre qui soude les formes est posé : ' + filtre)
            })
          })

          it('avec `pointer: 90` : la goutte suit la souris, centrée dessus, de 90 px, de la couleur du premier enfant, sans rien capter ; elle part avec la souris', async () => {
            await avec(conf, 'pointeur', async (page) => {
              assert.equal((await goutte(page, 'pointeur')).n, 0, 'rien avant la souris')
              await glisse(page, 900, 700, 200, 150)
              await page.waitForTimeout(60)
              const a = await goutte(page, 'pointeur')
              assert.equal(a.n, 1)
              assert.equal(a.enfants, 3, 'deux formes et la goutte')
              assert.ok(Math.abs(a.cx - 200) <= 1.5 && Math.abs(a.cy - 150) <= 1.5, `sous la souris : (${a.cx}, ${a.cy})`)
              assert.ok(Math.abs(a.w - 90) < 0.5, 'pointer: 90 : ' + a.w)
              assert.equal(a.pe, 'none', 'aucun clic capté')
              assert.equal(a.fond, 'rgb(0, 57, 255)', 'la couleur du premier enfant')
              await page.mouse.move(420, 220, { steps: 5 })
              await page.waitForTimeout(40)
              const b = await goutte(page, 'pointeur')
              assert.ok(Math.abs(b.cx - 420) <= 1.5 && Math.abs(b.cy - 220) <= 1.5, `elle suit : (${b.cx}, ${b.cy})`)
              await page.mouse.move(420, 700, { steps: 5 })
              await page.waitForTimeout(40)
              assert.equal((await goutte(page, 'pointeur')).n, 0, 'la souris est partie, la goutte aussi')
            })
          })

          it('avec `pointer: 90`, la page défile à la molette, la souris posée : la goutte reste sous la souris', async () => {
            await avec(conf, 'pointeur', async (page) => {
              await glisse(page, 900, 700, 350, 150)
              assert.equal((await goutte(page, 'pointeur')).n, 1)
              for (let cran = 1; cran <= 3; cran++) {
                await page.mouse.wheel(0, 20)
                await page.waitForFunction((y: number) => window.scrollY >= y, 20 * cran)
                await images(page)
                const g = await goutte(page, 'pointeur')
                assert.equal(g.n, 1, `cran ${cran} : la goutte est toujours là`)
                assert.ok(Math.abs(g.cx - 350) <= 1.5 && Math.abs(g.cy - 150) <= 1.5, `cran ${cran} : la goutte est en (${g.cx}, ${g.cy}), la souris en (350, 150)`)
              }
            })
          })
        })
      }

      it('`pointer` tenu par une variable (runtime: core) : 0, aucune goutte ; mis à 90, elle naît ; remis à 0 souris posée, elle part', async () => {
        await avec('coeur', 'variable', async (page) => {
          await glisse(page, 900, 700, 200, 150)
          await page.waitForTimeout(60)
          assert.equal((await goutte(page, 'variable')).n, 0, 'pointer vaut 0 : aucune goutte')
          const clic = async (classe: string) => {
            const r = await page.evaluate((a: [string, string]) => { const b = (window as any).__racine(a[0]).querySelector(a[1]).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }, ['mjs-tgs-variable', classe])
            await page.mouse.click(r.x, r.y)
          }
          await clic('.on')
          await glisse(page, 200, 400, 300, 160)
          await page.waitForTimeout(80)
          const a = await goutte(page, 'variable')
          assert.equal(a.n, 1, 'pointer vaut 90 : la goutte naît')
          assert.ok(Math.abs(a.w - 90) < 0.5, 'sa taille suit la variable : ' + a.w)
          // la souris reste sur la balise : la variable revient à 0 par un geste ailleurs (le bouton « off » est hors de la balise), la goutte part avec la souris
          await clic('.off')
          await page.waitForTimeout(80)
          await glisse(page, 200, 400, 300, 160)
          await page.waitForTimeout(80)
          assert.equal((await goutte(page, 'variable')).n, 0, 'pointer remis à 0 : plus de goutte, même sous la souris')
        })
      })

      it('le mode drip (`*goo` seul) : le calque, le filtre et les gouttes qui coulent ; rien de la goutte du pointeur', async () => {
        await avec('coeur', 'goutte', async (page) => {
          await page.waitForFunction(() => { const s = (window as any).__racine('mjs-tgs-goutte'); return s.querySelectorAll('[mjs-fx-layer="goo"] i').length > 0 }, null, { timeout: 8000 })
          const vu = await page.evaluate((t: string) => {
            const s = (window as any).__racine(t)
            const c = s.querySelector('[mjs-fx-layer="goo"]')
            return { filtre: getComputedStyle(c).filter, marque: s.querySelector('.coule').getAttribute('mjs-fx-goo'), pointeur: s.querySelectorAll('[mjs-fx-goo-drop]').length }
          }, 'mjs-tgs-goutte')
          assert.ok(/url\(/.test(vu.filtre), 'le filtre est sur le calque : ' + vu.filtre)
          assert.equal(vu.marque, 'drip')
          assert.equal(vu.pointeur, 0)
        })
      })

      it('`drag` et `halo: 0` (avant la goutte du pointeur) marchent dans le fichier filtré : la forme se déplace à la souris, le halo est ôté', async () => {
        await avec('coeur', 'glisser', async (page) => {
          const bare = await page.evaluate((t: string) => (window as any).__racine(t).querySelector('.goutte').hasAttribute('mjs-fx-goo-bare'), 'mjs-tgs-glisser')
          assert.equal(bare, true, 'halo: 0 : la balise porte la marque « sans halo »')
          // le rond .r1 : de 30 à 150 en x, de 90 à 210 en y dans le plateau
          await page.mouse.move(90, 150)
          await page.mouse.down()
          await page.mouse.move(150, 190, { steps: 6 })
          await page.mouse.up()
          const t = await page.evaluate((s: string) => (window as any).__racine(s).querySelector('.r1').style.translate, 'mjs-tgs-glisser')
          assert.ok(/^6\dpx 4\dpx$|^60px 40px$/.test(t.replace(/\s+/g, ' ')), 'le rond a suivi la souris de (60, 40) : ' + t)
        })
      })
    })
  }
})
