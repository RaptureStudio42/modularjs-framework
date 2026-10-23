// *spotlight (halo) dans Chromium et Firefox réels : la vie de l'animation du pseudo-élément. Le navigateur la perd quand la balise (ou un
// ancêtre) est cachée par `display: none` puis montrée de nouveau, sans le dire : la souris restée dessus doit retrouver sa lumière au premier
// mouvement. Et le retrait de l'effet en plein survol défait l'animation : rien ne reste sur le pseudo-élément, que le prochain effet posé
// sur la balise trouverait déplacé et rogné.

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

// une carte sombre dans un cadre (qu'on peut cacher), un halo rouge ; et une zone vide où le test pose des balises à lui
const PAGE = '<div class="cadre"><div class="c" *spotlight(where: fill, color: #f00, fill: 1, size: 120)></div></div>\n'
  + '<div class="zone"></div>\n'
  + '<style>\n.cadre, .zone\n  padding: 20px\n  background: #fff\n'
  + '.c, .e\n  position: relative\n  width: 300px\n  height: 120px\n  border-radius: 16px\n  background: #223\n  color: #fff\n'
  + '</style>\n'

async function construire(nom: string, source: string): Promise<string> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

describe('*spotlight : la vie de l\'animation du halo (balise cachée puis montrée, retrait en plein survol)', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire('fx-spot-halo-vie', PAGE)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de la vie du halo sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 420, height: 500 } })
        const page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-halo-vie></mjs-fx-spot-halo-vie><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-halo-vie') as any)?._shadow?.querySelector('.c'))
        await page.waitForTimeout(600)
        return { ctx, page }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const b = (document.querySelector('mjs-fx-spot-halo-vie') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, sel)

      // le halo de la balise : ses animations de pseudo-élément, sa place et son rognage, sa taille (un point : 0)
      const halo = (page: any, sel: string) => page.evaluate((s: string) => {
        const e = (document.querySelector('mjs-fx-spot-halo-vie') as any)._shadow.querySelector(s)
        const a = getComputedStyle(e, '::after')
        return { animations: e.getAnimations({ subtree: true }).filter((x: any) => x.effect.pseudoElement === '::after' && !(x instanceof CSSTransition)).length, translate: a.translate, clip: a.clipPath, largeur: a.width, interieur: e.clientWidth + 'px' }
      }, sel)

      const montrer = (page: any, sel: string, vu: boolean) => page.evaluate(([s, v]: [string, boolean]) => {
        (document.querySelector('mjs-fx-spot-halo-vie') as any)._shadow.querySelector(s).style.display = v ? '' : 'none'
      }, [sel, vu])

      async function pixels(page: any, points: Array<[number, number]>) {
        const shot = (await page.screenshot()).toString('base64')
        return page.evaluate(async ({ data, pts }: any) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + data
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d') as CanvasRenderingContext2D
          g.drawImage(img, 0, 0)
          return pts.map(([x, y]: number[]) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
        }, { data: shot, pts: points })
      }

      const sans = async (page: any, ctx: any) => { await page.close(); await ctx.close() }

      for (const [titre, cible, bouge] of [
        ['la balise est cachée (display: none) puis montrée, la souris immobile', '.c', false],
        ['la souris bouge pendant que la balise est cachée', '.c', true],
        ['un ancêtre est caché puis montré, la souris immobile', '.cadre', false]
      ] as const) {
        it(titre + ' : au premier mouvement de la souris, le halo est de nouveau sous elle, rogné à la balise', async function () {
          if (!present) return this.skip()
          const { ctx, page } = await ouvrir()
          try {
            const b = await boite(page, '.c')
            await page.mouse.move(b.x + 100, b.y + 60, { steps: 4 })
            await page.waitForTimeout(500)
            const avant = await halo(page, '.c')
            assert.equal(avant.animations, 1, 'au survol : une animation sur le pseudo-élément ' + JSON.stringify(avant))
            await montrer(page, cible, false)
            await page.waitForTimeout(400)
            if (bouge) {
              await page.mouse.move(b.x + 104, b.y + 64, { steps: 2 })
              await page.waitForTimeout(250)
            }
            await montrer(page, cible, true)
            await page.waitForTimeout(400)
            // un seul mouvement de la souris
            await page.mouse.move(b.x + 108, b.y + 62)
            await page.waitForTimeout(500)
            const apres = await halo(page, '.c')
            assert.equal(apres.animations, 1, 'une animation sur le pseudo-élément : ' + JSON.stringify(apres))
            const [x, y] = apres.translate.split(' ').map(parseFloat)
            assert.ok(Math.abs(x - 108) < 1.5 && Math.abs(y - 62) < 1.5, 'le halo est sous la souris : ' + apres.translate)
            assert.notEqual(apres.clip, 'none', 'et rogné à la balise : ' + apres.clip)
            assert.equal(apres.largeur, '0px', 'c\'est un point, non la balise entière')
            // à l'écran : rouge sous la souris, et le coin de la carte, loin de la lumière, garde sa couleur sombre (un halo resté au coin le rougirait)
            const [sous, coin] = await pixels(page, [[b.x + 108, b.y + 62], [b.x + 6, b.y + 6]])
            assert.ok(sous[0] > 150 && sous[1] < 120, 'sous la souris, la lumière est rouge : ' + sous)
            assert.ok(coin[0] < 90, 'le coin de la carte reste sombre : ' + coin)
            await page.mouse.move(3, 480, { steps: 4 })
            await page.waitForTimeout(900)
            const repos = await halo(page, '.c')
            assert.deepEqual([repos.translate, repos.animations], ['none', 0], 'la souris partie : le halo d\'avant, sans animation')
          }
          finally {
            await sans(page, ctx)
          }
        })
      }

      it('le retrait de l\'effet en plein survol défait l\'animation : rien ne reste sur le pseudo-élément, le prochain effet posé sur la balise le trouve intact', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const reglages = { color: '#f00', where: 'fill', size: 120, fill: 1, width: 2, soft: 120, smooth: 1, on: 'hover' }
          await page.evaluate((r: any) => {
            const w = window as any
            const e = document.createElement('div')
            e.className = 'e'
            e.setAttribute('mjs-fx', 'spotlight')
            ;(document.querySelector('mjs-fx-spot-halo-vie') as any)._shadow.querySelector('.zone').appendChild(e)
            w.__e = e
            w.__off = w.µ._mjs_fxDefs.spotlight.setup(e, r)
          }, reglages)
          const b = await boite(page, '.e')
          await page.mouse.move(b.x + 100, b.y + 60, { steps: 4 })
          await page.waitForTimeout(500)
          const pendant = await page.evaluate(() => {
            const w = window as any
            w.__a = w.__e.getAnimations({ subtree: true }).filter((x: any) => x.effect.pseudoElement === '::after' && !(x instanceof CSSTransition))
            return { n: w.__a.length, translate: getComputedStyle(w.__e, '::after').translate }
          })
          assert.equal(pendant.n, 1, 'au survol : une animation de halo ' + JSON.stringify(pendant))
          assert.notEqual(pendant.translate, 'none')
          await page.evaluate(() => (window as any).__off())
          await page.waitForTimeout(150)
          const retire = await page.evaluate(() => {
            const w = window as any
            const a = getComputedStyle(w.__e, '::after')
            return { etats: w.__a.map((x: any) => x.playState), n: w.__e.getAnimations({ subtree: true }).filter((x: any) => x.effect.pseudoElement === '::after' && !(x instanceof CSSTransition)).length, translate: a.translate, clip: a.clipPath, promu: a.willChange, live: w.__e.hasAttribute('mjs-fx-live') }
          })
          assert.deepEqual(retire.etats, ['idle'], 'l\'animation du halo est défaite (annulée), non seulement oubliée')
          assert.deepEqual([retire.n, retire.translate, retire.clip, retire.promu, retire.live], [0, 'none', 'none', 'auto', false], 'plus rien sur le pseudo-élément après le retrait')
          // la souris bouge encore sur la balise : plus rien n'écoute
          await page.mouse.move(b.x + 120, b.y + 50, { steps: 3 })
          await page.waitForTimeout(300)
          assert.equal((await halo(page, '.e')).animations, 0, 'après le retrait, la souris ne ranime rien')
          // le prochain effet posé sur la balise : son halo est celui du repos, toute la balise, ni déplacé ni rogné
          await page.evaluate((r: any) => { const w = window as any; w.__off2 = w.µ._mjs_fxDefs.spotlight.setup(w.__e, r) }, { ...reglages, on: 'always' })
          await page.waitForTimeout(500)
          const suivant = await halo(page, '.e')
          assert.deepEqual([suivant.translate, suivant.clip, suivant.largeur], ['none', 'none', suivant.interieur], 'le halo suivant couvre la balise : ' + JSON.stringify(suivant))
          await page.evaluate(() => (window as any).__off2())
        }
        finally {
          await sans(page, ctx)
        }
      })
    })
  }
})
