// *annotate et *grid dans Chromium, Firefox et WebKit réels, sous un parent qui réduit ce qu'il contient
// (transform: scale(.5)) : une vraie mise en page est nécessaire (happy-dom ne mesure rien).
// *annotate : le tracé est dessiné dans les pixels de mise en page du calque, que le parent réduise ou
// non — le trait couvre tout le mot, pour chaque style (souligné, encadré, entouré, barré, rayé,
// crochets), sur un mot en ligne coupé en plusieurs lignes et sur un composant annoté, et il est le même
// que sans réduction.
// *grid(hex) : l'alvéole allumée est celle sous le pointeur, aussi bien près d'un coin qu'au milieu.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (sinon son test est sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { deuxImages } from './helpers/images-navigateur.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLES = ['underline', 'box', 'circle', 'strike', 'cross', 'bracket']

// un mot par style, chacun dans son paragraphe ; puis un mot qui passe à la ligne (le paragraphe est étroit),
// puis un composant annoté (le calque vit alors dans le composant)
const mot = (style: string) => `<p class="${style}">Un <span class="m" *annotate(style: ${style}, on: load, duration: 0s)>mot important</span> ici</p>`
const SOURCES: Record<string, string> = {
  'reduit-trait.mjs':   STYLES.map(mot).join('\n') + '\n<p class="lignes">Un <span class="m" *annotate(on: load, duration: 0s)>mot important qui passe à la ligne</span> ici</p>\n<p class="composant">Un <@reduit-mot class="m" *annotate(style: box, on: load, duration: 0s)></@reduit-mot> ici</p>\n<style>\np\n  margin: 24px 20px\n  font: 20px sans-serif\n.lignes\n  width: 160px\n</style>\n',
  'reduit-mot.mjs':     '<span class="in">mot important</span>\n',
  'reduit-grille.mjs':  '<div class="g" *grid(style: hex, size: 40)></div>\n<style>\n.g\n  width: 400px\n  height: 300px\n  margin: 20px\n</style>\n'
}

// le même composant deux fois : tel quel (0), puis dans un parent qui le réduit de moitié (1)
const PAGE = (tag: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}.deux{display:flex;align-items:flex-start}.ref{width:420px}.moitie{width:420px;transform:scale(.5);transform-origin:0 0}</style></head><body><div class="deux"><div class="ref"><${tag}></${tag}></div><div class="moitie"><${tag}></${tag}></div></div>`

type Rect = [number, number, number, number]
type Trait = { mot: Rect, lignes: Rect[], trait: Rect, boite: Rect[] }

// ce que la page montre d'un mot annoté : sa boîte à l'écran, celles de ses lignes, la boîte à l'écran de
// tous ses traits, et la boîte de chaque trait dans son propre repère (les pixels de mise en page du calque)
const MESURE_TRAIT = ([tag, i, cls]: [string, number, string]) => {
  const comp: any = document.querySelectorAll(tag)[i]
  const m: any    = comp._shadow.querySelector('.' + cls + ' .m')
  const r         = m.getBoundingClientRect()
  const chemins   = Array.from((m._shadow || m).querySelectorAll('svg[mjs-fx-layer="annotate"] path')) as any[]
  const ecran     = chemins.map((p) => p.getBoundingClientRect())
  return {
    mot:    [r.left, r.top, r.right, r.bottom],
    lignes: (Array.from(m.getClientRects()) as any[]).map((q) => [q.left, q.top, q.right, q.bottom]),
    trait:  [Math.min(...ecran.map((q) => q.left)), Math.min(...ecran.map((q) => q.top)), Math.max(...ecran.map((q) => q.right)), Math.max(...ecran.map((q) => q.bottom))],
    boite:  chemins.map((p) => { const b = p.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height] })
  }
}

const arrondi = (n: number) => Math.round(n * 10) / 10
const vu      = (t: Trait) => JSON.stringify({ mot: t.mot.map(arrondi), trait: t.trait.map(arrondi), boite: t.boite.map((b) => b.map(arrondi)) })

// le trait couvre le mot de gauche à droite (à l'écran), à 10 % de sa largeur près
function couvre(t: Trait, quoi: string) {
  const largeur = t.mot[2] - t.mot[0]
  assert.ok(t.boite.length > 0, `${quoi} : un trait est dessiné`)
  assert.ok(t.trait[0] <= t.mot[0] + largeur * 0.1, `${quoi} : le trait commence au début du mot — ${vu(t)}`)
  assert.ok(t.trait[2] >= t.mot[2] - largeur * 0.1, `${quoi} : le trait va jusqu'à la fin du mot — ${vu(t)}`)
}

// le tracé est le même pixel de mise en page par pixel de mise en page, que le parent réduise ou non
function memeTrace(ref: Trait, reduit: Trait, quoi: string) {
  assert.equal(reduit.boite.length, ref.boite.length, `${quoi} : autant de traits sous réduction que sans — ${vu(reduit)} / ${vu(ref)}`)
  ref.boite.forEach((b, k) => b.forEach((v, j) => {
    assert.ok(Math.abs(v - reduit.boite[k][j]) <= 1, `${quoi} : le trait ${k} est le même sous réduction (coordonnée ${j} : ${arrondi(reduit.boite[k][j])} au lieu de ${arrondi(v)}) — ${vu(reduit)} / ${vu(ref)}`)
  }))
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*annotate et *grid(hex) (navigateurs réels) — sous un parent réduit (transform: scale(.5))', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-annotation-grille-reduits')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
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

      // la page des deux instances du composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, pret: string, fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        try {
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: PAGE(tag) + `<script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(([t, sel]: string[]) => {
            const comps = Array.from(document.querySelectorAll(t)) as any[]
            return comps.length === 2 && comps.every((c) => !!c._shadow?.querySelector(sel))
          }, [tag, pret])
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      // ----- *annotate -----

      async function traits(page: any, cls: string): Promise<[Trait, Trait]> {
        // le tracé est redessiné à l'image qui suit un changement de taille ou de police : WebKit sous charge peut rester des secondes sans en dessiner, et le trait lu est alors celui de la première pose (une dizaine de pixels)
        await deuxImages(page)
        const ref    = await page.evaluate(MESURE_TRAIT, ['mjs-reduit-trait', 0, cls])
        const reduit = await page.evaluate(MESURE_TRAIT, ['mjs-reduit-trait', 1, cls])
        return [ref, reduit]
      }

      for (const style of STYLES) {
        it(`*annotate(${style}) sous un parent réduit : le trait couvre tout le mot, comme sans réduction`, async function () {
          if (!present) { this.skip(); return }
          const [ref, reduit] = await avec('mjs-reduit-trait', '.lignes .m svg path', async (page) => {
            await attendre(300)
            return traits(page, style)
          })
          couvre(ref, `${style} sans réduction`)
          couvre(reduit, `${style} sous réduction`)
          memeTrace(ref, reduit, style)
        })
      }

      it('*annotate sur un mot en ligne coupé en plusieurs lignes, sous un parent réduit : chaque ligne est tracée, comme sans réduction', async function () {
        if (!present) { this.skip(); return }
        const [ref, reduit] = await avec('mjs-reduit-trait', '.lignes .m svg path', async (page) => {
          await attendre(300)
          return traits(page, 'lignes')
        })
        assert.ok(ref.lignes.length >= 2, `le mot passe bien à la ligne : ${JSON.stringify(ref.lignes)}`)
        couvre(ref, 'mot sur plusieurs lignes, sans réduction')
        couvre(reduit, 'mot sur plusieurs lignes, sous réduction')
        memeTrace(ref, reduit, 'mot sur plusieurs lignes')
      })

      it('*annotate sur un composant, sous un parent réduit : le trait couvre le composant, comme sans réduction', async function () {
        if (!present) { this.skip(); return }
        const [ref, reduit] = await avec('mjs-reduit-trait', '.lignes .m svg path', async (page) => {
          await page.waitForFunction(() => Array.from(document.querySelectorAll('mjs-reduit-trait')).every((c: any) => !!c._shadow.querySelector('.composant .m')?._shadow?.querySelector('svg path')))
          await attendre(300)
          return traits(page, 'composant')
        })
        couvre(ref, 'composant sans réduction')
        couvre(reduit, 'composant sous réduction')
        memeTrace(ref, reduit, 'composant')
      })

      // ----- *grid(hex) -----

      // le pointeur en (fx, fy) du calque de l'instance i (fractions de sa taille à l'écran), venu de loin ;
      // rend l'écart entre le pointeur et le centre de l'alvéole allumée, en largeurs d'alvéole à l'écran
      async function ecart(page: any, i: number, fx: number, fy: number): Promise<{ ecart: number, allumee: boolean }> {
        const cible = await page.evaluate(([t, k, ax, ay]: [string, number, number, number]) => {
          const l = ((document.querySelectorAll(t)[k] as any)._shadow.querySelector('.g [mjs-fx-layer="grid"]') as any).getBoundingClientRect()
          return { x: l.left + l.width * ax, y: l.top + l.height * ay }
        }, ['mjs-reduit-grille', i, fx, fy])
        await page.mouse.move(990, 790)
        await page.mouse.move(cible.x, cible.y)
        // l'alvéole s'allume à l'image suivante : on l'attend (sous charge, un peu plus longtemps)
        await page.waitForFunction(([t, k]: [string, number]) => !!((document.querySelectorAll(t)[k] as any)._shadow.querySelector('.g [mjs-fx-layer="grid"]') as any).querySelector('i[mjs-fx-on]'), ['mjs-reduit-grille', i], { timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(100)
        const c = await page.evaluate(([t, k]: [string, number]) => {
          const on = ((document.querySelectorAll(t)[k] as any)._shadow.querySelector('.g [mjs-fx-layer="grid"]') as any).querySelector('i[mjs-fx-on]')
          if (!on) return null
          const r = on.getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }
        }, ['mjs-reduit-grille', i])
        if (!c) return { ecart: Infinity, allumee: false }
        return { ecart: Math.hypot(c.x - cible.x, c.y - cible.y) / c.w, allumee: true }
      }

      const POINTS: [number, number, string][] = [[0.5, 0.5, 'au milieu'], [0.2, 0.2, 'près du coin haut gauche'], [0.85, 0.8, 'près du coin bas droit']]

      for (const [fx, fy, ou] of POINTS) {
        it(`*grid(hex) sous un parent réduit : l'alvéole allumée est sous le pointeur, ${ou}`, async function () {
          if (!present) { this.skip(); return }
          const [ref, reduit] = await avec('mjs-reduit-grille', '.g [mjs-fx-layer="grid"] i', async (page) => {
            await attendre(300)
            const a = await ecart(page, 0, fx, fy)
            const b = await ecart(page, 1, fx, fy)
            return [a, b]
          })
          // la plus proche des alvéoles est à 0,6 largeur d'alvéole au plus du pointeur (le recouvrement du réseau)
          assert.ok(ref.allumee, 'sans réduction : une alvéole s\'allume')
          assert.ok(ref.ecart <= 0.8, `sans réduction : l'alvéole allumée est sous le pointeur (à ${ref.ecart.toFixed(2)} largeur d'alvéole)`)
          assert.ok(reduit.allumee, 'sous réduction : une alvéole s\'allume')
          assert.ok(reduit.ecart <= 0.8, `sous réduction : l'alvéole allumée est sous le pointeur (à ${reduit.ecart.toFixed(2)} largeur d'alvéole)`)
        })
      }
    })
  }
})
