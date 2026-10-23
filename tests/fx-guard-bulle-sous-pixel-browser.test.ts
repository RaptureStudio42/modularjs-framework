// la bulle de *guard pendant que son champ tremble (une transformation en cours), dans Chromium et Firefox réels : elle reste
// à la place qu'elle avait au repos, au sous-pixel près — dans une page agrandie (`zoom`), avec un champ à position
// fractionnaire, et avec un champ `position: fixed` (sans parent de mise en page : `offsetParent` nul).
// Les rectangles sont lus à l'écran : la bulle bouge de moins de 0,1 px quand le champ se transforme, et se tient
// à 6 px (en pixels de la page, donc 9 sous un zoom de 1,5) sous le champ au repos.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
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

const CHAMP = '<input class="f" type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 60s, fx: none)>'

const COMPOSANTS: Record<string, { zoom: number, droite?: boolean, src: string }> = {
  'fx-gb-simple': { zoom: 1, src: `<div class="w">${CHAMP}</div>\n<style>\n:host\n  display: block\n.w\n  position: relative\n  margin: 10.4px 0 0 20.3px\n  padding: 7.3px\n.f\n  margin: 3.3px 0 0 2.7px\n</style>\n` },
  'fx-gb-zoom':   { zoom: 1.5, src: `<div class="z"><div class="w">${CHAMP}</div></div>\n<style>\n:host\n  display: block\n.z\n  zoom: 1.5\n.w\n  position: relative\n  margin: 10.4px 0 0 20.3px\n  padding: 7.3px\n.f\n  margin: 3.3px 0 0 2.7px\n</style>\n` },
  'fx-gb-droite': { zoom: 1.5, droite: true, src: `<div class="z"><div class="w">${CHAMP.replace('delay: 0', 'delay: 0, place: right')}</div></div>\n<style>\n:host\n  display: block\n.z\n  zoom: 1.5\n.w\n  position: relative\n  height: 60px\n  overflow: auto\n  margin: 10.4px 0 0 20.3px\n  padding: 7.3px\n  border: 3px solid #999\n.f\n  margin: 40.3px 0 0 2.7px\n</style>\n` },
  'fx-gb-fixe':   { zoom: 1, src: `<div class="w">${CHAMP}</div>\n<style>\n:host\n  display: block\n.f\n  position: fixed\n  top: 40.4px\n  left: 30.6px\n</style>\n` },
}

// les transformations que le champ peut porter pendant un tremblement
const TRANSFORMS: Array<[string, string]> = [
  ['translateX(7px)', 'translateX(7px)'],
  ['translate(-6px, 4px) rotate(5deg)', 'translate(-6px, 4px) rotate(5deg)'],
]

describe('*guard — la bulle reste à sa place pendant que le champ tremble (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-guard-bulle-sous-pixel-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, c] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), c.src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let browser: any
      let page: any
      let erreurs: string[]

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page    = await (await browser.newContext({ viewport: { width: 800, height: 700 } })).newPage()
        erreurs = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          const balises = Object.keys(COMPOSANTS).map((c) => `<mjs-${c}></mjs-${c}>`).join('')
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:1500px">${balises}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((tags: string[]) => tags.every((t) => !!(document.querySelector(t) as any)?._shadow?.querySelector('input')), Object.keys(COMPOSANTS).map((c) => 'mjs-' + c), { timeout: 90000 })
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      })

      after(async () => { await browser?.close() })

      for (const [tag, c] of Object.entries(COMPOSANTS)) {
        for (const [libelle, transform] of TRANSFORMS) {
          it(`${tag} : champ sous « ${libelle} », la bulle garde sa place`, async () => {
            const r = await page.evaluate(([tag, transform]: [string, string]) => new Promise<any>((fin) => {
              const racine = (document.querySelector('mjs-' + tag) as any)._shadow
              const champ  = racine.querySelector('input')
              const lire   = () => {
                const b = racine.querySelector('[mjs-fx-guard-tip]').getBoundingClientRect()
                return { top: b.top, left: b.left }
              }
              champ.parentNode.scrollTop = 11.5
              champ.value = '99'
              champ.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
              // l'animation d'entrée de la bulle finie, le champ au repos
              setTimeout(() => {
                const repos = lire()
                const cadre = champ.getBoundingClientRect()
                const bas   = cadre.bottom
                const droite = cadre.right
                champ.style.transform = transform
                // un enfant ajouté puis retiré du parent : la bulle se replace
                const parent = champ.parentNode
                const x = document.createElement('i')
                parent.appendChild(x)
                x.remove()
                setTimeout(() => {
                  const tremble = lire()
                  champ.style.transform = ''
                  fin({ repos, tremble, bas, droite })
                }, 50)
              }, 400)
            }), [tag, transform])
            const d = (a: number, b: number) => Math.round(Math.abs(a - b) * 100) / 100
            assert.ok(d(r.tremble.top, r.repos.top) <= 0.1, `${tag} : la bulle a bougé de ${d(r.tremble.top, r.repos.top)} px en hauteur`)
            assert.ok(d(r.tremble.left, r.repos.left) <= 0.1, `${tag} : la bulle a bougé de ${d(r.tremble.left, r.repos.left)} px en largeur`)
            if (c.droite) assert.ok(d(r.repos.left, r.droite + 8 * c.zoom) <= 0.6, `${tag} : au repos, la bulle est à ${Math.round((r.repos.left - r.droite) * 100) / 100} px à droite du champ (attendu ${8 * c.zoom})`)
            else assert.ok(d(r.repos.top, r.bas + 6 * c.zoom) <= 0.6, `${tag} : au repos, la bulle est à ${Math.round((r.repos.top - r.bas) * 100) / 100} px sous le champ (attendu ${6 * c.zoom})`)
          })
        }
      }

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
