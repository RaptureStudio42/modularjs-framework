// l'avancée au défilement (runtime/mjs_fx_toolscroll.ts, embarquée seulement avec ses utilisateurs) dans de vrais navigateurs, avec de vrais
// effets construits par le bundler : la page d'une balise à *neon seule n'a pas µ._mjs_fxScroll ; la page de chacun des effets qui l'appellent
// (*scrub, *gallery, *goo, *path, *stagger) l'a, l'effet s'y pose sans erreur et reçoit l'avancée de sa balise quand la page défile.
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

// la balise de chaque scène est dans un cadre positionné (le repère de *path) à 1 500 px sous le haut de la page, loin de l'écran au chargement,
// dans une page assez haute pour la centrer
const STYLE = '<style>\n.f\n  position: relative\n  margin: 1500px 0\n  width: 200px\n  height: 120px\n.c\n  position: absolute\n  top: 0\n  left: 0\n  display: block\n  box-sizing: border-box\n  width: 200px\n  height: 120px\n  background: #36c\n</style>\n'
// quatre images de la suite de *scrub : de petits carrés dessinés, en adresses `data:` entre guillemets simples (la virgule de l'adresse)
const image  = (couleur: string) => `'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23${couleur}%22%2F%3E%3C%2Fsvg%3E'`
const SUITE  = ['c00', '0c0', '00c', 'cc0'].map(image).join(', ')

const NEON: Record<string, string> = {
  'ds-neon.mjs': `<div class="f"><p class="c" *neon>bonjour</p></div>\n${STYLE}`
}
const APPELANTS: Record<string, string> = {
  'ds-scrub.mjs':   `<div class="f"><img class="c" alt="" *scrub(images: [${SUITE}], smooth: 0)></div>\n${STYLE}`,
  'ds-gallery.mjs': `<div class="f"><div class="c" *gallery(depth)><i>1</i><i>2</i><i>3</i></div></div>\n${STYLE}`,
  'ds-goo.mjs':     `<div class="f"><div class="c" *goo(merge, pointer: 90)><b></b></div></div>\n${STYLE}`,
  'ds-path.mjs':    `<div class="f"><i class="c" *path(heart, on: scroll)></i></div>\n${STYLE}`,
  'ds-stagger.mjs': `<div class="f"><p class="c" *stagger(fade, unit: word, on: scroll)>un deux trois quatre</p></div>\n${STYLE}`
}

// entre le cœur et le code de la page : chaque suivi demandé à µ._mjs_fxScroll est noté (la balise, les avancées reçues), et passe à l'outil
const ESPION = `;(function() {
  window.__suivi = [];
  var vrai = µ._mjs_fxScroll;
  if (typeof vrai !== 'function') return;
  µ._mjs_fxScroll = function(el, f, zone) {
    var note = { tag: el.tagName, ps: [] };
    window.__suivi.push(note);
    return vrai.call(this, el, function(p) { note.ps.push(p); return f.apply(this, arguments); }, zone);
  };
})();`

describe('l\'avancée au défilement, outil du cœur (navigateurs réels, effets construits par le bundler)', function () {
  this.timeout(240000)
  const scripts: Record<string, string> = {}

  async function construire(nom: string, sources: Record<string, string>): Promise<string> {
    const root   = mjsTmp('effets-outil-defilement-browser-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [fichier, source] of Object.entries(sources)) writeFileSync(join(srcDir, fichier), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = (r: number) => files.filter((f) => rang(f) === r).sort((a, b) => a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return [code(0), code(1), ESPION, code(2)].join('\n') + '\nglobalThis.µ = µ;'
  }

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    scripts.neon      = await construire('neon', NEON)
    scripts.appelants = await construire('appelants', APPELANTS)
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('le code construit : la page à *neon seul ne définit pas µ._mjs_fxScroll, celle des cinq effets le définit une fois', function () {
    if (!scripts.neon) this.skip()
    assert.ok(!/_mjs_fxScroll/.test(scripts.neon.replace(ESPION, '')), '*neon seul embarque le code du défilement')
    assert.equal(scripts.appelants.replace(ESPION, '').match(/µ\._mjs_fxScroll = /g)?.length, 1)
  })

  it('le code construit : la page des cinq effets embarque, une fois chacun, les outils du cœur que l\'avancée appelle (parents, racines) ; celle de *neon seul, aucun', function () {
    if (!scripts.neon) this.skip()
    for (const nom of ['_mjs_fxParent', '_mjs_fxWithin', '_mjs_fxRoots']) {
      assert.equal(scripts.appelants.match(new RegExp('µ\\.' + nom + ' = ', 'g'))?.length, 1, nom)
      assert.ok(!scripts.neon.includes(nom), '*neon seul embarque ' + nom)
    }
  })

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

      // la page de `tag` (le script `quel` de la liste ci-dessus) ; `fn` s'y exécute, les erreurs de la page sont vides à la fin
      async function avec<T>(quel: string, tag: string, fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        // le moteur écrit une erreur d'effet dans la console : elle compte aussi (les 404 du banc, non)
        page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) erreurs.push(m.text()) })
        try {
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${scripts[quel]}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          // ce que la page a dit d'elle-même accompagne tout échec : un effet qui appelle une fonction absente laisse la balise sans habillage
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

      const suivi = (page: any): Promise<{ tag: string, ps: number[] }[]> => page.evaluate(() => (window as any).__suivi)

      it('*neon seul : l\'effet se pose sans erreur, et la page n\'a pas µ._mjs_fxScroll', async function () {
        await avec('neon', 'mjs-ds-neon', async (page) => {
          assert.equal(await page.evaluate(() => typeof (window as any).µ._mjs_fxScroll), 'undefined')
          assert.equal(await page.evaluate(() => typeof (window as any).µ._mjs_fxZone), 'function', 'la bande de la zone reste au moteur')
          assert.equal(await page.evaluate(() => typeof (window as any).µ._mjs_fxAdvance), 'function', 'l\'avancée reste au moteur')
        })
      })

      // la balise arrive au milieu de l'écran : son avancée vaut 1 ; avant, loin de l'écran, elle n'avait pas atteint 1
      for (const effet of ['scrub', 'gallery', 'path', 'stagger']) {
        it('*' + effet + ' : la page a l\'outil, l\'effet se pose sans erreur et reçoit l\'avancée de sa balise quand la page défile', async function () {
          const tag = 'mjs-ds-' + effet
          await avec('appelants', tag, async (page) => {
            assert.equal(await page.evaluate(() => typeof (window as any).µ._mjs_fxScroll), 'function')
            await page.waitForTimeout(300)
            assert.ok((await suivi(page)).every((n) => !n.ps.includes(1)), 'avant le geste, l\'avancée ne vaut pas encore 1')
            await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.c').scrollIntoView({ block: 'center' }), tag)
            await page.waitForFunction(() => (window as any).__suivi.some((n: any) => n.ps.includes(1)), null, { timeout: 15000 })
            assert.equal((await suivi(page)).filter((n) => n.ps.includes(1)).length > 0, true)
          })
        })
      }

      it('*goo : la goutte qui suit la souris pose le suivi du défilement par l\'outil, sans erreur', async function () {
        await avec('appelants', 'mjs-ds-goo', async (page) => {
          assert.equal(await page.evaluate(() => typeof (window as any).µ._mjs_fxScroll), 'function')
          await page.evaluate(() => (document.querySelector('mjs-ds-goo') as any)._shadow.querySelector('.c').scrollIntoView({ block: 'center' }))
          await page.waitForTimeout(300)
          await page.mouse.move(30, 260)
          await page.mouse.move(170, 340, { steps: 8 })
          await page.waitForFunction(() => (window as any).__suivi.length > 0, null, { timeout: 15000 })
          assert.ok((await suivi(page)).length >= 1)
        })
      })
    })
  }
})
