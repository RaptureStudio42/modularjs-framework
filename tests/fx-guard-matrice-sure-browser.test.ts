// la bulle de *guard quand son champ est déplacé par des transformations que la matrice ne sait pas rendre (perspective,
// 3D, transform-box, ancêtre transformé) : elle reste à la place qu'elle avait au repos, à 0,5 px près, dans Chromium,
// Firefox et WebKit réels. La matrice ne sert que dans le cas sûr ; ailleurs, le champ est mesuré avec ses transformations
// neutralisées le temps d'une lecture. Limite écrite : `offset-path` n'est pas rendu (la bulle se décale).

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

const SRC = `<div class="p"><div class="w"><input class="f" type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 60s, fx: none)></div></div>
<style>
:host
  display: block
.p
  margin: 30px 0 0 40px
.w
  position: relative
  margin: 10.4px 0 0 20.3px
  padding: 7.3px
.f
  margin: 3.3px 0 0 2.7px
  padding: 5px
  width: 120px
</style>
`

type Etat = { champ?: Record<string, string>, w?: Record<string, string>, p?: Record<string, string> }

// les états sûrs (la matrice) et ceux où la matrice se trompe (la mesure neutralisée)
const SURS: Array<[string, Etat]> = [
  ['rotation et échelle 2D', { champ: { transform: 'rotate(20deg) scale(1.2)' } }],
]
const PIEGES: Array<[string, Etat]> = [
  ['perspective() dans la fonction', { champ: { transform: 'perspective(300px) rotateY(30deg)' } }],
  ['perspective sur le parent', { w: { perspective: '400px' }, champ: { transform: 'rotateY(30deg)' } }],
  ['preserve-3d et translateZ', { p: { perspective: '600px' }, w: { 'transform-style': 'preserve-3d' }, champ: { transform: 'translateZ(60px)' } }],
  ['transform-box content-box', { champ: { 'transform-box': 'content-box', transform: 'rotate(25deg)', 'transform-origin': '20% 30%' } }],
  ['transform-box fill-box', { champ: { 'transform-box': 'fill-box', transform: 'rotate(25deg)', 'transform-origin': '20% 30%' } }],
  ['parent transformé et champ transformé', { w: { transform: 'rotate(8deg) scale(1.1)' }, champ: { transform: 'rotate(15deg)' } }],
  ['ancêtre transformé, champ en translate', { p: { transform: 'rotate(6deg)' }, champ: { translate: '9px 4px', rotate: '10deg' } }],
]

describe('*guard — la bulle reste à sa place sous des transformations 3D ou d’un ancêtre (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-guard-matrice-sure-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-gm.mjs'), SRC)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
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
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:1500px"><mjs-fx-gm></mjs-fx-gm><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-gm') as any)?._shadow?.querySelector('input'), null, { timeout: 90000 })
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      })

      after(async () => { await browser?.close() })

      // l'écart de la bulle entre le repos et l'état donné (les ancêtres transformés dès le repos)
      const ecart = async (etat: Etat) => page.evaluate((etat: Etat) => new Promise<any>((fin) => {
        const racine      = (document.querySelector('mjs-fx-gm') as any)._shadow
        const champ       = racine.querySelector('input')
        const cibles: any = { champ, w: racine.querySelector('.w'), p: racine.querySelector('.p') }
        const lire        = () => {
          const b = racine.querySelector('[mjs-fx-guard-tip]').getBoundingClientRect()
          return { top: b.top, left: b.left }
        }
        // les ancêtres sont déjà transformés au repos : seul le champ change entre les deux mesures
        for (const k of ['w', 'p']) for (const [p, v] of Object.entries((etat as any)[k] || {})) cibles[k].style.setProperty(p, v as string)
        champ.value = '99'
        champ.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        setTimeout(() => {
          const repos = lire()
          for (const [p, v] of Object.entries(etat.champ || {})) champ.style.setProperty(p, v as string)
          const x = document.createElement('i')
          cibles.w.appendChild(x)
          x.remove()
          setTimeout(() => {
            const tremble = lire()
            for (const k of ['champ', 'w', 'p']) for (const p of Object.keys((etat as any)[k] || {})) cibles[k].style.removeProperty(p)
            fin({ dx: Math.abs(tremble.left - repos.left), dy: Math.abs(tremble.top - repos.top) })
          }, 80)
        }, 400)
      }), etat)

      for (const [libelle, etat] of [...SURS, ...PIEGES]) {
        it(`${libelle} : la bulle bouge de 0,5 px au plus`, async () => {
          const r = await ecart(etat)
          assert.ok(r.dx <= 0.5 && r.dy <= 0.5, `${libelle} : la bulle a bougé de ${Math.round(r.dx * 100) / 100} px en largeur, ${Math.round(r.dy * 100) / 100} px en hauteur`)
        })
      }

      // limite connue : offset-path déplace le champ sans que la mesure le retrouve
      it('limite : offset-path n’est pas rendu (la bulle se décale)', async function () {
        const r = await ecart({ champ: { 'offset-path': 'path("M 0 0 L 80 60")', 'offset-distance': '100%' } })
        if (r.dx <= 0.5 && r.dy <= 0.5) return this.skip()
        assert.ok(r.dx > 0.5 || r.dy > 0.5)
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
