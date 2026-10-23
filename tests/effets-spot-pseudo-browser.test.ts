// *spotlight (halo et liseré) dans Chromium et Firefox réels : la lumière est faite de pseudo-éléments (`::after` pour le halo, `::before` pour le
// liseré), jamais d'enfants de la balise. Ce qu'un auteur écrit ne change donc pas de cible : `:last-child`, `:empty`, `li:last-child`, la hauteur
// de la carte au survol, un contenu remplacé par un script (`innerHTML`) ; la lumière suit la souris, est rognée à la balise (arrondis compris), et
// n'agrandit pas la zone défilable de la page près d'un bord.

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

// des cartes dont le style vise leurs enfants (`> :last-child`, `:empty`, `li:last-child`) : la lumière ne doit en changer aucun ; deux zones à fond clair pour lire la lumière à l'écran
const PAGE = '<div class="grille">\n'
  + '  <div class="carte" *spotlight(on: always)><h3>Titre</h3><p>Texte</p><p class="pied">Pied</p></div>\n'
  + '  <div class="vide" *spotlight(on: always)></div>\n'
  + '  <ul class="liste" *spotlight(on: always)><li>un</li><li>deux</li><li>trois</li></ul>\n'
  + '  <div class="survol" *spotlight><p>Texte</p><p class="pied">Pied</p></div>\n'
  + '  <div class="rogne" *spotlight(where: fill, color: #f00, fill: 1, size: 150)></div>\n'
  + '  <div class="coin" *spotlight(where: fill, color: #f00, fill: 1, size: 150)></div>\n'
  + '  <div class="anneau" *spotlight(where: border, color: #f00, size: 200, width: 4)></div>\n'
  + '  <div class="voile" *spotlight(where: veil, color: #000, fill: 1, on: always)></div>\n'
  + '</div>\n'
  + '<style>\n'
  + '.grille\n  display: grid\n  gap: 16px\n  width: 360px\n  padding: 20px\n  background: #fff\n  color: #ddd\n'
  + '.carte, .vide, .liste, .survol\n  position: relative\n  border-radius: 12px\n  background: #223\n  padding: 12px\n  margin: 0\n  list-style: none\n'
  + '.carte p, .survol p\n  margin: 0 0 20px\n'
  + '.carte > :last-child, .survol > :last-child\n  margin-bottom: 0\n  color: #2f9\n'
  + '.vide\n  padding: 0\n'
  + '.vide:empty\n  height: 60px\n  background: #633\n'
  + '.liste li\n  border-bottom: 3px solid #555\n'
  + '.liste li:last-child\n  border-bottom: 0\n'
  + '.liste > :last-child\n  color: #fa0\n'
  + '.rogne, .coin\n  height: 90px\n  background: #fff\n'
  + '.rogne\n  border-radius: 0\n'
  + '.coin\n  border-radius: 40px\n'
  + '.anneau, .voile\n  height: 90px\n  background: #fff\n'
  + '.voile\n  border-radius: 40px\n  margin-bottom: 400px\n'
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

describe('*spotlight : le halo et le liseré sont des pseudo-éléments, la structure de la balise ne change pas', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire('fx-spot-pseudo', PAGE)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test des pseudo-éléments sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la scène, ouverte dans une fenêtre aussi large que la grille (400 px) : la lumière près du bord droit pousserait la zone défilable de la page
      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 400, height: 900 } })
        const page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-pseudo></mjs-fx-spot-pseudo><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-pseudo') as any)?._shadow?.querySelector('.coin'))
        await page.waitForTimeout(600)
        return { ctx, page }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const b = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, sel)

      // la capture d'une région, relue pixel par pixel dans la page (le canevas d'une image décodée) : [r, g, b] aux points demandés
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

      it('aucun enfant de plus : :last-child, :empty et li:last-child visent les mêmes nœuds qu\'en l\'absence de l\'effet, en toujours allumé', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const r = await page.evaluate(() => {
            const S = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow
            const cs = (s: string, p: string) => getComputedStyle(S.querySelector(s))[p as any]
            return {
              carte: { enfants: S.querySelector('.carte').childElementCount, dernier: S.querySelector('.carte').lastElementChild.className, marge: cs('.carte .pied', 'marginBottom'), couleur: cs('.carte .pied', 'color') },
              vide: { enfants: S.querySelector('.vide').childElementCount, vide: S.querySelector('.vide').matches(':empty'), hauteur: Math.round(S.querySelector('.vide').getBoundingClientRect().height) },
              liste: { enfants: S.querySelector('.liste').childElementCount, bordure: cs('.liste li:nth-child(3)', 'borderBottomWidth'), premier: cs('.liste li:nth-child(1)', 'borderBottomWidth'), couleur: cs('.liste li:nth-child(3)', 'color') }
            }
          })
          assert.deepEqual(r.carte, { enfants: 3, dernier: 'pied', marge: '0px', couleur: 'rgb(34, 255, 153)' })
          assert.deepEqual(r.vide, { enfants: 0, vide: true, hauteur: 60 })
          assert.deepEqual(r.liste, { enfants: 3, bordure: '0px', premier: '3px', couleur: 'rgb(255, 170, 0)' })
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('au survol, la hauteur de la carte et la cible de :last-child ne bougent pas (le saut de mise en page est écarté)', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const lire = () => page.evaluate(() => {
            const e = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector('.survol')
            return { h: e.getBoundingClientRect().height, enfants: e.childElementCount, marge: getComputedStyle(e.querySelector('.pied')).marginBottom }
          })
          const avant = await lire()
          const b = await boite(page, '.survol')
          await page.mouse.move(b.x + 40, b.y + 20, { steps: 4 })
          await page.waitForTimeout(700)
          const pendant = await lire()
          await page.mouse.move(3, 3, { steps: 4 })
          await page.waitForTimeout(900)
          const apres = await lire()
          assert.deepEqual(pendant, avant, 'pendant le survol : même hauteur, mêmes enfants, même marge')
          assert.deepEqual(apres, avant, 'après la sortie : de même')
          assert.equal(avant.enfants, 2)
          assert.equal(avant.marge, '0px')
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('le contenu remplacé par un script (innerHTML) garde le halo et le liseré allumés, et la lumière suit encore la souris', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          await page.evaluate(() => { (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector('.carte').innerHTML = '<p>remplacé</p>' })
          await page.waitForTimeout(500)
          const b = await boite(page, '.carte')
          await page.mouse.move(b.x + 120, b.y + 30, { steps: 5 })
          await page.waitForTimeout(500)
          const r = await page.evaluate(() => {
            const e = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector('.carte')
            const apres = getComputedStyle(e, '::after')
            return { halo: apres.opacity, lisere: getComputedStyle(e, '::before').opacity, place: apres.translate, enfants: e.childElementCount }
          })
          assert.equal(r.halo, '1', 'le halo est là')
          assert.equal(r.lisere, '1', 'le liseré est là')
          assert.equal(r.enfants, 1, 'seul le contenu de l\'auteur')
          const [x, y] = r.place.split(' ').map(parseFloat)
          assert.ok(Math.abs(x - 120) < 1.5 && Math.abs(y - 30) < 1.5, 'la lumière est sous la souris : ' + r.place)
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('le halo est sous la souris, le liseré aussi (variables d\'avant sur la balise)', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boite(page, '.carte')
          await page.mouse.move(b.x + 100, b.y + 40, { steps: 6 })
          await page.waitForTimeout(500)
          const r = await page.evaluate(() => {
            const e = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector('.carte')
            return { place: getComputedStyle(e, '::after').translate, vx: e.style.getPropertyValue('--mjs-fx-spot-x'), vy: e.style.getPropertyValue('--mjs-fx-spot-y') }
          })
          const [x, y] = r.place.split(' ').map(parseFloat)
          assert.ok(Math.abs(x - 100) < 1.5 && Math.abs(y - 40) < 1.5, 'halo : ' + r.place)
          assert.ok(Math.abs(parseFloat(r.vx) - 100) < 1.5 && Math.abs(parseFloat(r.vy) - 40) < 1.5, 'liseré : ' + r.vx + ' ' + r.vy)
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('la lumière ne rend pas la page plus large près du bord droit de la fenêtre', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boite(page, '.rogne')
          await page.mouse.move(b.x + b.w - 2, b.y + b.h - 2, { steps: 6 })
          await page.waitForTimeout(500)
          const r = await page.evaluate(() => ({ vue: document.documentElement.clientWidth, zone: document.documentElement.scrollWidth }))
          assert.equal(r.zone, r.vue, 'aucune barre horizontale en plus')
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('la lumière est rognée à la balise : rien hors de son cadre, rien dans le coin que l\'arrondi enlève', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const a = await boite(page, '.rogne')
          await page.mouse.move(a.x + 6, a.y + 6, { steps: 6 })
          await page.waitForTimeout(700)
          const [dehors, dedans] = await pixels(page, [[a.x - 3, a.y + 6], [a.x + 6, a.y + 6]])
          assert.ok(Math.min(...dehors) >= 250, 'hors du cadre, le fond de la page reste blanc : ' + dehors)
          assert.ok(dedans[0] > 200 && dedans[1] < 120, 'dans le cadre, sous la souris, la lumière est rouge : ' + dedans)
          await page.mouse.move(3, 3, { steps: 4 })
          const c = await boite(page, '.coin')
          await page.mouse.move(c.x + 20, c.y + 20, { steps: 6 })
          await page.waitForTimeout(700)
          const [coin, arc] = await pixels(page, [[c.x + 2, c.y + 2], [c.x + 40, c.y + 40]])
          assert.ok(Math.min(...coin) >= 250, 'dans le coin que l\'arrondi de 40 px enlève, le fond reste blanc : ' + coin)
          assert.ok(arc[0] > 200 && arc[1] < 200, 'plus loin, sous l\'arrondi, la lumière est rouge : ' + arc)
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('une balise cachée puis montrée de nouveau (display: none) garde son halo : celui d\'avant au repos (toute la balise), un point sous la souris au survol, et de nouveau celui d\'avant après', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const cacher = (sel: string, vu: boolean) => page.evaluate(([s, v]: [string, boolean]) => { (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector(s).style.display = v ? '' : 'none' }, [sel, vu])
          const place = (sel: string) => page.evaluate((s: string) => {
            const e = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector(s)
            const a = getComputedStyle(e, '::after')
            return { translate: a.translate, largeur: a.width, interieur: e.clientWidth + 'px' }
          }, sel)
          const r0 = await place('.carte')
          assert.deepEqual([r0.translate, r0.largeur], ['none', r0.interieur], 'toujours allumé, au repos : le halo d\'avant, toute la balise, sans animation')
          await cacher('.carte', false)
          await page.waitForTimeout(300)
          await cacher('.carte', true)
          await page.waitForTimeout(700)
          const r1 = await place('.carte')
          assert.deepEqual([r1.translate, r1.largeur], ['none', r1.interieur], 'cachée puis montrée : le même halo')
          const k = await boite(page, '.carte')
          await page.mouse.move(k.x + 80, k.y + 30, { steps: 5 })
          await page.waitForTimeout(500)
          const rh = await place('.carte')
          const [hx, hy] = rh.translate.split(' ').map(parseFloat)
          assert.ok(rh.largeur === '0px' && Math.abs(hx - 80) < 1.5 && Math.abs(hy - 30) < 1.5, 'au survol : un point sous la souris : ' + JSON.stringify(rh))
          await page.mouse.move(3, 3, { steps: 4 })
          await page.waitForTimeout(900)
          const r3 = await place('.carte')
          assert.deepEqual([r3.translate, r3.largeur], ['none', r3.interieur], 'après la sortie : le halo d\'avant revient, l\'animation est défaite')
          // au survol : caché, montré, puis la souris entre : la lumière est sous elle
          await cacher('.coin', false)
          await page.waitForTimeout(300)
          await cacher('.coin', true)
          await page.waitForTimeout(300)
          const c = await boite(page, '.coin')
          await page.mouse.move(c.x + 60, c.y + 40, { steps: 5 })
          await page.waitForTimeout(500)
          const r2 = await place('.coin')
          const [x, y] = r2.translate.split(' ').map(parseFloat)
          assert.ok(Math.abs(x - 60) < 1.5 && Math.abs(y - 40) < 1.5, 'au survol suivant, le halo est sous la souris : ' + r2.translate)
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('le liseré ne s\'allume que sur le bord (masque en anneau) ; le voile suit l\'arrondi de la balise ; rien n\'est promu hors survol', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const promu = () => page.evaluate(() => {
            const S = (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow
            const disque = S.querySelector('.voile [mjs-fx-layer] > span')
            return { halo: getComputedStyle(S.querySelector('.rogne'), '::after').willChange, disque: getComputedStyle(disque).willChange }
          })
          assert.deepEqual(await promu(), { halo: 'auto', disque: 'auto' }, 'au repos, rien n\'est promu')
          const etats = await page.evaluate(() => (document.querySelector('mjs-fx-spot-pseudo') as any)._shadow.querySelector('.carte').getAnimations({ subtree: true }).filter((a: any) => a.effect.pseudoElement === '::after').map((a: any) => a.playState))
          assert.deepEqual(etats, [], 'le halo toujours allumé, au repos : aucune animation, aucun calque (le texte garde son antialiasing d\'avant)')
          const a = await boite(page, '.anneau')
          await page.mouse.move(a.x + 150, a.y + 40, { steps: 6 })
          await page.waitForTimeout(700)
          const [bord, milieu] = await pixels(page, [[a.x + 150, a.y + 1], [a.x + 150, a.y + 40]])
          assert.ok(bord[0] > 200 && bord[1] < 160, 'sur le bord, au-dessus de la souris, le liseré est rouge : ' + bord)
          assert.ok(Math.min(...milieu) >= 250, 'à l\'intérieur, sous la souris, le masque en anneau laisse le fond blanc : ' + milieu)
          const v = await boite(page, '.voile')
          await page.mouse.move(v.x + 150, v.y + 40, { steps: 6 })
          await page.waitForTimeout(700)
          const [coin, sombre] = await pixels(page, [[v.x + 2, v.y + 2], [v.x + 350, v.y + 45]])
          assert.ok(Math.min(...coin) >= 250, 'le coin que l\'arrondi de 40 px enlève n\'est pas voilé : ' + coin)
          assert.ok(Math.max(...sombre) < 40, 'dans la balise, hors de la lumière, le voile est noir : ' + sombre)
          assert.deepEqual(await promu(), { halo: 'auto', disque: 'transform' }, 'pendant le survol du voile, son disque seul est promu')
        }
        finally {
          await sans(page, ctx)
        }
      })
    })
  }
})
