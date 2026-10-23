// *loader(vortex) dans Chromium, Firefox et WebKit réels : le mouvement se mesure sur de vraies animations CSS.
// Vingt points, une animation de mouvement chacun (mêmes images clés, un vingtième de cycle d'écart, jamais de JavaScript
// par image) ; un point mis à chaque quart de son cycle fait un tour complet autour du centre du dessin en se
// rapprochant (orbite de 150 à 25 sur 400 px), rapetisse, passe de flou et transparent à net et opaque, puis
// s'efface. Le flou ne s'anime pas : le point porte deux disques (flou fixe, net) dont les opacités se croisent, leur
// somme vaut 1 ; size, speed et color changent le dessin ; « réduire les animations » le fige sans le cacher ;
// retiré, il ne laisse aucune animation.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

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

const SOURCES: Record<string, string> = {
  'vx-defaut.mjs':  '<div class="scene"><span class="v" *loader(vortex)></span></div>\n<style>\n.scene\n  padding: 60px\n</style>\n',
  'vx-regle.mjs':   '<div class="scene"><span class="v" *loader(vortex, size: 240, speed: 8s, color: #ff5fa2)></span></div>\n<style>\n.scene\n  padding: 60px\n</style>\n',
  'vx-retrait.mjs': '<script>\n$on = true\n</script>\n{if $on}<div class="scene"><span class="v" *loader(vortex)></span></div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n'
}

// ce que la page compte : les images d'animation en attente, les minuteries vivantes, les écritures de propriétés CSS
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__iv = new Set()
  const si = w.setInterval.bind(w)
  const ci = w.clearInterval.bind(w)
  w.setInterval = (f: any, d: number, ...a: any[]) => { const h = si(f, d, ...a); w.__iv.add(h); return h }
  w.clearInterval = (h: number) => { w.__iv.delete(h); return ci(h) }
  w.__ecritures = 0
  const sp = w.CSSStyleDeclaration.prototype.setProperty
  w.CSSStyleDeclaration.prototype.setProperty = function (k: string, ...a: any[]) { w.__ecritures++; return sp.call(this, k, ...a) }
}

const POINTS = '[mjs-fx-loader-style="vortex"] [mjs-fx-p="dot"]'

describe('*loader(vortex) (navigateurs réels) — vingt points qui font un tour en se rapprochant du centre', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-loader-vortex-browser')
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

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, options: { calme?: boolean } = {}): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: options.calme ? 'reduce' : 'no-preference' })
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx-layer="loader"]'), tag)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      // les animations des vingt points : le nom, la durée, le délai, la boucle, la courbe
      const animations = (page: any, tag: string) => page.evaluate(([t, sel]: [string, string]) => [...(document.querySelector(t) as any)._shadow.querySelectorAll(sel)].map((p: any) => {
        const a  = p.getAnimations()
        const tm = a[0].effect.getTiming()
        return { n: a.length, nom: a[0].animationName, duree: tm.duration, delai: tm.delay, infinie: tm.iterations === Infinity, courbe: tm.easing, etat: a[0].playState }
      }), [tag, POINTS])

      // le premier point, arrêté à un quart de son cycle : son centre autour du centre du dessin, son aspect
      const parcours = (page: any, tag: string, avancees: number[]) => page.evaluate(([t, sel, l]: [string, string, number[]]) => {
        const sh = (document.querySelector(t) as any)._shadow
        const c  = sh.querySelector('[mjs-fx-layer="loader"]').getBoundingClientRect()
        const cx = c.left + c.width / 2
        const cy = c.top + c.height / 2
        const p  = sh.querySelector(sel)
        const as = p.getAnimations({ subtree: true })
        // le délai de ce point n'est pas ce qu'on mesure : l'avancée dans son cycle se choisit directement
        for (const a of as) {
          a.effect.updateTiming({ delay: 0 })
          a.pause()
        }
        return l.map((u) => {
          for (const a of as) a.currentTime = u * a.effect.getTiming().duration
          const r  = p.getBoundingClientRect()
          const dx = r.left + r.width / 2 - cx
          const dy = r.top + r.height / 2 - cy
          const cs = getComputedStyle(p)
          const mou = getComputedStyle(p, '::before')
          const net = getComputedStyle(p, '::after')
          return { u, rayon: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, opacite: parseFloat(cs.opacity), flou: mou.filter, doux: parseFloat(mou.opacity), net: parseFloat(net.opacity), flouNet: net.filter, melange: net.mixBlendMode, couleur: net.backgroundColor }
        })
      }, [tag, POINTS, avancees])

      // l'écart entre deux angles, dans [0, 180]
      const ecart = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

      it('vingt points, un mouvement CSS chacun : mêmes images clés (transform, opacity), 4 s de cycle, un vingtième de cycle d\'écart', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          const a = await animations(page, tag)
          assert.equal(a.length, 20)
          // chaque point : son mouvement, et ses deux disques qui se croisent en opacité (flou fixe, net), rien d'autre
          const d = await page.evaluate(([t, sel]: [string, string]) => [...(document.querySelector(t) as any)._shadow.querySelectorAll(sel)].map((p: any) => p.getAnimations({ subtree: true }).map((x: any) => x.animationName + ':' + Object.keys(x.effect.getKeyframes()[0]).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)).sort().join('+')).sort().join(' ')), [tag, POINTS])
          assert.equal(d.length, 20)
          for (const x of d) assert.equal(x, 'mjs-fx-loader-vortex-sharp:opacity mjs-fx-loader-vortex-soft:opacity mjs-fx-loader-vortex:opacity+transform', 'trois animations par point, aucune ne porte filter')
          a.forEach((x: any, i: number) => {
            assert.equal(x.n, 1, `point ${i + 1} : une animation`)
            assert.equal(x.nom, 'mjs-fx-loader-vortex')
            assert.equal(x.duree, 4000, 'cycle de 4 s')
            assert.ok(Math.abs(x.delai + 200 * (i + 1)) < 0.001, `point ${i + 1} : ${i + 1} cinquièmes de seconde d'avance (${x.delai} ms)`)
            assert.ok(x.infinie, 'en boucle')
            assert.equal(x.courbe, 'linear')
          })
          const k = await page.evaluate(([t, sel]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector(sel).getAnimations()[0].effect.getKeyframes().map((f: any) => ({ offset: f.offset, transform: f.transform ?? null, opacity: f.opacity ?? null, filter: f.filter ?? null, autres: Object.keys(f).filter((n) => !['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity'].includes(n)) })), [tag, POINTS])
          assert.equal(k.length, 3)
          assert.deepEqual(k.map((f: any) => f.offset), [0, 0.5, 1])
          assert.deepEqual(k.flatMap((f: any) => f.autres), [], 'rien d\'autre que transform et opacity (filter compris) : aucune propriété de mise en page ni de peinture par image')
          assert.match(k[0].transform, /rotate\(0deg\) scale\(3\)/)
          assert.match(k[2].transform, /rotate\(360deg\) scale\(0?\.5\)/)
          assert.deepEqual(k.map((f: any) => f.opacity), ['0', '1', '0'])
        })
      })

      it('les trois animations de chaque point partent ensemble : le disque flou et le disque net ont le cycle et le retard du point, un vingtième de cycle de plus à chaque point', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          const d = await page.evaluate(([t, sel]: [string, string]) => [...(document.querySelector(t) as any)._shadow.querySelectorAll(sel)].map((p: any) => p.getAnimations({ subtree: true }).map((x: any) => ({ cible: x.effect.pseudoElement || 'point', delai: x.effect.getTiming().delay, duree: x.effect.getTiming().duration }))), [tag, POINTS])
          assert.equal(d.length, 20)
          d.forEach((trois: any[], i: number) => {
            assert.deepEqual(trois.map((a) => a.cible).sort(), ['::after', '::before', 'point'], `point ${i + 1} : le point et ses deux disques`)
            for (const a of trois) {
              assert.equal(a.duree, 4000, `point ${i + 1}, ${a.cible} : cycle de 4 s`)
              assert.ok(Math.abs(a.delai + 200 * (i + 1)) < 0.001, `point ${i + 1}, ${a.cible} : ${i + 1} cinquièmes de seconde d'avance (${a.delai} ms)`)
            }
          })
        })
      })

      it('chaque point est isolé : le disque net, qui s\'additionne (plus-lighter), ne s\'additionne qu\'au disque flou de son point, jamais au fond de la page', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          const isoles = await page.evaluate(([t, sel]: [string, string]) => [...(document.querySelector(t) as any)._shadow.querySelectorAll(sel)].every((p: any) => getComputedStyle(p).isolation === 'isolate'), [tag, POINTS])
          assert.equal(isoles, true, 'les vingt points sont isolés')
          // à mi-cycle le disque net est seul et opaque : sur le fond blanc de la page, le centre du point garde la couleur du tourbillon (un turquoise),
          // il ne devient pas blanc en s'additionnant au fond
          const centre = await page.evaluate(([t, sel]: [string, string]) => {
            const p = (document.querySelector(t) as any)._shadow.querySelector(sel)
            for (const a of p.getAnimations({ subtree: true })) {
              a.effect.updateTiming({ delay: 0 })
              a.pause()
              a.currentTime = 0.5 * a.effect.getTiming().duration
            }
            const r = p.getBoundingClientRect()
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          }, [tag, POINTS])
          const octets = await page.screenshot({ clip: { x: centre.x, y: centre.y, width: 1, height: 1 } })
          const px = await page.evaluate(async (s: string) => {
            const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
            const c = new OffscreenCanvas(1, 1)
            const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D
            g.drawImage(bmp, 0, 0)
            return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3)
          }, octets.toString('base64'))
          assert.ok(px[1] > px[0] + 50, 'le point garde la couleur du tourbillon, non le blanc du fond additionné (' + px.join(',') + ')')
        })
      })

      it('un point fait un tour complet autour du centre du dessin en se rapprochant : orbite de 150 à 25 (sur 400 px), un quart de tour par quart de cycle', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          const m = await parcours(page, tag, [0, 0.25, 0.5, 0.75, 0.999])
          // le dessin de 400 px est réduit à 96 px : 0.24 ; l'orbite de 50 px est grossie de 3 à 0.5 en ligne droite
          const echelle = 96 / 400
          for (const x of m) {
            const attendu = 50 * (3 - 2.5 * x.u) * echelle
            assert.ok(Math.abs(x.rayon - attendu) < 0.8, `avancée ${x.u} : rayon ${x.rayon.toFixed(2)} px, attendu ${attendu.toFixed(2)}`)
            assert.ok(ecart(x.angle, (x.u * 360) % 360) < 2.5, `avancée ${x.u} : angle ${x.angle.toFixed(1)}°, attendu ${(x.u * 360) % 360}°`)
          }
          assert.ok(m[0].rayon > m[1].rayon && m[1].rayon > m[2].rayon && m[2].rayon > m[3].rayon && m[3].rayon > m[4].rayon, 'l\'orbite se resserre sans cesse')
          // un tour complet : le point revient à son angle de départ, près du centre
          assert.ok(ecart(m[4].angle, 0) < 2.5, `un tour entier (${m[4].angle.toFixed(1)}°)`)
        })
      })

      it('il naît transparent et flou, devient net et opaque à mi-course, puis s\'efface : le flou fixe et le net se croisent, leur somme vaut 1', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          const m = await parcours(page, tag, [0, 0.125, 0.25, 0.375, 0.5, 0.75, 0.999])
          assert.ok(m[0].opacite < 0.01, `né transparent (${m[0].opacite})`)
          assert.ok(m[0].doux > 0.99 && m[0].net < 0.01, `au départ le disque flou seul (${m[0].doux} / ${m[0].net})`)
          assert.match(m[0].flou, /blur\(3px\)/, 'le flou du départ, fixe')
          assert.ok(m[0].flouNet === 'none' && m[0].melange === 'plus-lighter', `le disque net : aucun filtre, additionné (${m[0].flouNet}, ${m[0].melange})`)
          assert.ok(m[2].opacite > 0.45 && m[2].opacite < 0.55, `moitié opaque au quart (${m[2].opacite})`)
          for (const x of m.slice(0, 5)) assert.ok(Math.abs(x.doux + x.net - 1) < 0.02, `avancée ${x.u} : flou ${x.doux} + net ${x.net} = 1`)
          assert.ok(Math.abs(m[2].doux - 0.5) < 0.03 && Math.abs(m[2].net - 0.5) < 0.03, `au quart : moitié flou, moitié net (${m[2].doux} / ${m[2].net})`)
          assert.ok(m[1].doux > m[2].doux && m[2].doux > m[3].doux, 'le flou se résorbe')
          assert.equal(m[4].opacite, 1, 'opaque à mi-course')
          assert.ok(m[4].doux < 0.01 && m[4].net > 0.99, `net à mi-course (${m[4].doux} / ${m[4].net})`)
          assert.ok(m[5].opacite > 0.45 && m[5].opacite < 0.55 && m[5].net > 0.99, `il s'efface, net (${m[5].opacite})`)
          assert.ok(m[6].opacite < 0.01, `effacé à l'arrivée (${m[6].opacite})`)
          assert.equal(m[4].couleur, 'rgb(37, 226, 188)', 'la couleur du style')
        })
      })

      it('size, speed et color : 240 px, cycle de 8 s (un vingtième : 0,4 s), rose ; l\'orbite suit la taille', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-regle'
        await avec(tag, async (page) => {
          const a = await animations(page, tag)
          assert.equal(a.length, 20)
          a.forEach((x: any, i: number) => {
            assert.equal(x.duree, 8000)
            assert.ok(Math.abs(x.delai + 400 * (i + 1)) < 0.001, `point ${i + 1} : ${x.delai} ms`)
          })
          const m = await parcours(page, tag, [0, 0.5])
          assert.ok(Math.abs(m[0].rayon - 150 * 0.6) < 1.5, `orbite de départ ${m[0].rayon.toFixed(1)} px (240 px : 150 × 0.6)`)
          assert.ok(Math.abs(m[1].rayon - 87.5 * 0.6) < 1.5, `à mi-course ${m[1].rayon.toFixed(1)} px`)
          assert.equal(m[1].couleur, 'rgb(255, 95, 162)')
        })
      })

      it('les animations tournent vraiment (leur temps avance) sans une image de JavaScript, sans minuterie, sans écriture de style', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          assert.ok((await animations(page, tag)).every((x: any) => x.etat === 'running'))
          const temps = () => page.evaluate(([t, sel]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector(sel).getAnimations()[0].currentTime, [tag, POINTS])
          const avant  = await temps()
          const ecrit  = await page.evaluate(() => (window as any).__ecritures)
          await page.waitForTimeout(400)
          const apres  = await temps()
          assert.ok(apres - avant > 200, `l'animation avance (${avant} → ${apres} ms)`)
          assert.deepEqual(await page.evaluate(() => ({ raf: (window as any).__raf.size, minuteries: (window as any).__iv.size, ecrit: (window as any).__ecritures })), { raf: 0, minuteries: 0, ecrit }, 'ni image, ni minuterie, ni écriture de style pendant ce temps')
        })
      })

      it('« réduire les animations » : tout est figé, rien n\'est caché — la file reste lisible', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-defaut'
        await avec(tag, async (page) => {
          assert.ok((await animations(page, tag)).every((x: any) => x.etat === 'paused'), 'les vingt animations sont en pause')
          const vus = await page.evaluate(([t, sel]: [string, string]) => [...(document.querySelector(t) as any)._shadow.querySelectorAll(sel)].map((p: any) => parseFloat(getComputedStyle(p).opacity)), [tag, POINTS])
          assert.ok(vus.filter((o: number) => o > 0.5).length >= 5, `des points se voient (${vus.map((o: number) => o.toFixed(1)).join(' ')})`)
          assert.ok(new Set(vus.map((o: number) => o.toFixed(2))).size > 10, 'chacun figé à sa place dans la file, pas tous au même état')
        }, { calme: true })
      })

      it('retiré ({if} refermé) : plus de dessin, plus une animation de vortex', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-vx-retrait'
        await avec(tag, async (page) => {
          const compte = () => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.getAnimations().filter((a: any) => a.animationName === 'mjs-fx-loader-vortex').length, tag)
          assert.equal(await compte(), 20)
          await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').click(), tag)
          await page.waitForFunction((t: string) => !(document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer]'), tag)
          assert.equal(await compte(), 0)
        })
      })
    })
  }
})
