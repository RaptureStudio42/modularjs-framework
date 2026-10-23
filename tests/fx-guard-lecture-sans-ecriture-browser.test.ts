// *guard mesure son champ sans jamais écrire dans son `style` ni ses attributs, dans Chromium et Firefox réels : une transition CSS de
// l'auteur en cours n'est ni annulée ni relancée, un observateur de mutations de l'auteur ne voit aucun enregistrement `style`, un
// champ sans `style` n'en reçoit pas un vide. La bulle reste juste (au sous-pixel) pour un champ qui porte `translate`, `rotate`,
// `scale`, une origine de transformation, un pourcentage ou une transformation composée.

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

const COMPOSANTS: Record<string, string> = {
  'fx-gl-transition': `<div class="w">${CHAMP}</div>\n<style>\n:host\n  display: block\n.w\n  position: relative\n  margin: 10.4px 0 0 20.3px\n  padding: 7.3px\n.f\n  margin: 3.3px 0 0 2.7px\n  transition: transform 3s linear\n.f.go\n  transform: translateX(120px)\n</style>\n`,
  'fx-gl-simple': `<div class="w">${CHAMP}</div>\n<style>\n:host\n  display: block\n.w\n  position: relative\n  margin: 10.4px 0 0 20.3px\n  padding: 7.3px\n.f\n  margin: 3.3px 0 0 2.7px\n</style>\n`,
}

// ce que le champ peut porter pendant un tremblement : chaque propriété de mouvement, seule et mêlée
const DECLARATIONS = [
  'translate: 7px 4px',
  'translate: 20%',
  'rotate: 12deg',
  'scale: 1.4 0.8',
  'rotate: 20deg; transform-origin: 10% 90%',
  'translate: -5px 3px; rotate: 8deg; scale: 1.2; transform-origin: 0 0',
  'transform: skewX(10deg) translateY(5px)',
  'transform: rotate(15deg); translate: 6px; scale: 0.9; transform-origin: 80% 20%',
]

describe('*guard — mesure du champ sans écriture dans son style (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-guard-lecture-sans-ecriture-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
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

      it('une transition de l\'auteur en cours n\'est ni annulée ni relancée par la bulle', async () => {
        const r = await page.evaluate(() => new Promise<any>((fin) => {
          const racine = (document.querySelector('mjs-fx-gl-transition') as any)._shadow
          const champ  = racine.querySelector('input')
          const annule = [] as string[]
          champ.addEventListener('transitioncancel', () => annule.push('cancel'))
          const styles = [] as any[]
          const mo = new MutationObserver((l) => { for (const m of l) styles.push(m.attributeName) })
          mo.observe(champ, { attributes: true, attributeFilter: ['style'] })
          champ.classList.add('go')
          setTimeout(() => {
            const trans = () => champ.getAnimations().find((a: any) => a.transitionProperty === 'transform')
            const avant = trans()
            if (!avant) return fin({ erreur: 'aucune transition en cours' })
            const t0 = avant.currentTime
            champ.value = '99'
            champ.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
            const x = document.createElement('i')
            champ.parentNode.appendChild(x)
            x.remove()
            setTimeout(() => {
              const apres = trans()
              fin({ t0, t1: apres ? apres.currentTime : null, memeAnimation: apres === avant, annule, styles, style: champ.getAttribute('style'), bulle: !!racine.querySelector('[mjs-fx-guard-tip]') })
            }, 150)
          }, 400)
        }))
        assert.ok(!r.erreur, r.erreur)
        assert.ok(r.bulle, 'la bulle est affichée')
        assert.ok(r.t1 !== null && r.t1 >= r.t0 + 100, `la transition a continué (temps ${r.t0} puis ${r.t1})`)
        assert.ok(r.memeAnimation, 'c\'est la même transition, pas une neuve')
        assert.deepEqual(r.annule, [], 'aucune transition annulée')
        assert.deepEqual(r.styles, [], 'aucun enregistrement `style` pour l\'observateur de l\'auteur')
        assert.equal(r.style, null, 'le champ n\'a pas reçu d\'attribut style')
      })

      for (const decl of DECLARATIONS) {
        it(`champ sous « ${decl} », la bulle garde sa place et le style reste intact`, async () => {
          const r = await page.evaluate((decl: string) => new Promise<any>((fin) => {
            const racine = (document.querySelector('mjs-fx-gl-simple') as any)._shadow
            const champ  = racine.querySelector('input')
            champ.parentNode.scrollTop = 0
            champ.value = '99'
            champ.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
            const lire = () => {
              const b = racine.querySelector('[mjs-fx-guard-tip]').getBoundingClientRect()
              return { top: b.top, left: b.left }
            }
            setTimeout(() => {
              const repos = lire()
              champ.style.cssText = decl
              const avant = champ.getAttribute('style')
              const x = document.createElement('i')
              champ.parentNode.appendChild(x)
              x.remove()
              setTimeout(() => {
                const tremble = lire()
                const apres   = champ.getAttribute('style')
                champ.style.cssText = ''
                champ.removeAttribute('style')
                fin({ repos, tremble, avant, apres })
              }, 50)
            }, 400)
          }), decl)
          const d = (a: number, b: number) => Math.round(Math.abs(a - b) * 100) / 100
          assert.ok(d(r.tremble.top, r.repos.top) <= 0.1, `la bulle a bougé de ${d(r.tremble.top, r.repos.top)} px en hauteur`)
          assert.ok(d(r.tremble.left, r.repos.left) <= 0.1, `la bulle a bougé de ${d(r.tremble.left, r.repos.left)} px en largeur`)
          assert.equal(r.apres, r.avant, 'le style du champ n\'a pas été touché')
        })
      }

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
