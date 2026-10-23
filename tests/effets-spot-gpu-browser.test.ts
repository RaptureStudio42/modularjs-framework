// *spotlight et *filter(…, spot) dans Chromium et Firefox réels : la lumière suit la souris en repeignant le moins possible. Ce que la
// souris déplace est un calque (le disque du voile, la lentille de *filter) dont seul le `translate` change, ou le pseudo-élément du halo
// (aussi léger : une animation arrêtée dont on change les images clés) ; la lumière elle-même (dégradé, masque, image de bordure) est
// peinte une fois et ne dépend plus de la souris. Le liseré, lui, relit sa position par deux variables, comme avant. Les invariants ne
// dépendent pas de la vitesse de la machine : la peinture de la lumière (dégradés, masques, ombres du style calculé) ne change pas d'un
// mouvement à l'autre, les seules écritures de style vont aux nœuds qui se déplacent, la lumière est sous la souris, le double de
// `*filter` reste sur la balise ; et, dans Chromium, le nombre de peintures de calques pendant le geste reste bas (marge large).

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

// quatre scènes de 300 × 100 : un halo et son liseré, un voile, un halo avec retard, et une zone nette (dans un cadre positionné)
const PAGE = '<div class="h1" *spotlight(color: #ff8800, size: 120, fill: 0.5)>halo et liseré</div>\n'
  + '<div class="h2" *spotlight(where: veil, size: 100, soft: 60)>voile</div>\n'
  + '<div class="h3" *spotlight(color: #ff8800, size: 120, smooth: 0.3)>halo avec retard</div>\n'
  + '<div class="cadre"><div class="f" *filter(grayscale, spot: 120, soft: 60, smooth: 0.3)>zone nette</div></div>\n'
  + '<style>\n.h1, .h2, .h3, .f\n  width: 300px\n  height: 100px\n  margin: 10px\n  background: linear-gradient(90deg, #468, #c84)\n'
  + '.cadre\n  position: relative\n  margin: 10px\n</style>\n'

// les lectures de mise en page et de style, et à part les relevés d'animations, comptés dans la page dès le départ
const COMPTEUR = `(function() {
  window.__lectures = 0;
  window.__releves = 0;
  var wrap = function(proto, name, compteur) {
    var f = proto[name];
    if (typeof f !== 'function') return;
    proto[name] = function() { window[compteur]++; return f.apply(this, arguments); };
  };
  wrap(Element.prototype, 'getBoundingClientRect', '__lectures');
  wrap(Element.prototype, 'getAnimations', '__releves');
  wrap(window, 'getComputedStyle', '__lectures');
})();`

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

describe('*spotlight et *filter(…, spot) : la lumière suit la souris sans rien repeindre', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire('fx-spot-gpu', PAGE)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de la lumière sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la scène, ouverte ; le compte des peintures de calques (Chromium seul) est tenu par la session de débogage
      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 400, height: 960 } })
        await ctx.addInitScript(COMPTEUR)
        const page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-gpu></mjs-fx-spot-gpu><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-gpu') as any)?._shadow?.querySelector('.f'))
        await page.waitForTimeout(600)
        let cdp: any = null
        const etat = { peintures: 0 }
        if (nom === 'chromium') {
          cdp = await ctx.newCDPSession(page)
          await cdp.send('LayerTree.enable')
          cdp.on('LayerTree.layerPainted', () => { etat.peintures++ })
        }
        return { ctx, page, etat }
      }

      // un balayage de 24 mouvements dans la scène `sel` : ce que la lumière peint, ce qui s'écrit, où elle est, ce qui se lit
      async function balayer(page: any, etat: { peintures: number }, sel: string, type: 'spot' | 'halo' | 'filtre') {
        const r = await page.evaluate((s: string) => {
          const b = (document.querySelector('mjs-fx-spot-gpu') as any)._shadow.querySelector(s).getBoundingClientRect()
          return { l: b.left, t: b.top }
        }, sel)
        await page.mouse.move(r.l + 40, r.t + 30)
        await page.waitForTimeout(500)
        await page.evaluate(({ s, type }: any) => {
          const w = window as any
          w.__ecrits = []
          w.__signatures = []
          w.__sel = s
          w.__type = type
          w.__racine = (document.querySelector('mjs-fx-spot-gpu') as any)._shadow
          new MutationObserver((l) => { for (const m of l) w.__ecrits.push(m.target) }).observe(w.__racine, { attributes: true, subtree: true, attributeFilter: ['style'] })
          // ce qui définit la peinture de la lumière dans le style calculé : dégradés, masques, ombres, sur la balise (et ses pseudo-éléments), les calques et leur contenu
          w.__signer = function() {
            const hote  = w.__racine.querySelector(w.__sel) as any
            // le halo : sa lumière est l'image de bordure de son pseudo-élément (sa place et son rognage, eux, suivent la souris)
            if (type === 'halo') {
              const a = getComputedStyle(hote, '::after')
              w.__signatures.push([a.borderImageSource, a.width, a.height, a.display].join('|'))
              return
            }
            const noeuds: any[] = type === 'spot'
              ? [hote, ...hote.querySelectorAll('*')]
              : [...hote.parentNode.querySelectorAll('[mjs-fx-filter-lens], [mjs-fx-filter-lens] *, [mjs-fx-filter-copy]')]
            const pseudos = type === 'spot' ? [['::before', hote], ['::after', hote]] : []
            const lire = (c: CSSStyleDeclaration) => [c.backgroundImage, c.maskImage, (c as any).webkitMaskImage, c.boxShadow, c.clipPath].join('|')
            const sig = noeuds.map((n) => lire(getComputedStyle(n))).concat(pseudos.map(([p, n]: any) => lire(getComputedStyle(n, p))))
            w.__signatures.push(sig.join('||'))
          }
          // la sonde ne se compte pas elle-même : ses lectures sont rendues
          const lire = w.__signer
          w.__signer = function() {
            const n = w.__lectures
            lire()
            w.__lectures = n
          }
          w.__lectures = 0
          // le style de la balise avant le geste : ce qui change ensuite est ce que le geste écrit
          w.__lireStyle = (a: string | null) => Object.fromEntries((a || '').split(';').map((d: string) => d.split(/:(.*)/s)).filter((x: string[]) => x[0].trim()).map((x: string[]) => [x[0].trim(), (x[1] || '').trim()]))
          w.__style0 = w.__lireStyle((w.__racine.querySelector(s) as any).getAttribute('style'))
        }, { s: sel, type })
        etat.peintures = 0
        const debut = Date.now()
        await page.evaluate(() => { (window as any).__releves = 0 })
        for (let i = 0; i < 24; i++) {
          await page.mouse.move(r.l + 40 + i * 9, r.t + 30 + (i % 7) * 8)
          await page.waitForTimeout(40)
          await page.evaluate(() => (window as any).__signer())
        }
        await page.evaluate(() => { const w = window as any; w.__apres = w.__lectures })
        await page.waitForTimeout(900)
        const fin = { x: r.l + 40 + 23 * 9, y: r.t + 30 + (23 % 7) * 8 }
        const bilan = await page.evaluate(({ type }: any) => {
          const w = window as any
          const lectures = w.__lectures
          const hote = w.__racine.querySelector(w.__sel) as any
          // les écritures de style permises : le disque d'un calque (spotlight), la lentille et son ancrage (filter)
          const permis = (n: any) => type === 'halo'
            ? n === hote
            : type === 'spot'
              ? !!(n.parentElement && n.parentElement.hasAttribute('mjs-fx-layer'))
              : n.hasAttribute('mjs-fx-filter-lens') || !!(n.parentElement && n.parentElement.hasAttribute('mjs-fx-filter-lens'))
          const interdits = w.__ecrits.filter((n: any) => !permis(n)).map((n: any) => n.localName + '.' + (n.className || ''))
          const centre = (n: any) => { const b = n.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] }
          // le halo : le point du pseudo-élément, dans le repère de l'intérieur de la balise ; le liseré : ses deux variables, à part
          const halo = () => {
            const r = hote.getBoundingClientRect()
            const t = getComputedStyle(hote, '::after').translate.split(' ').map(parseFloat)
            return [r.left + hote.clientLeft + t[0], r.top + hote.clientTop + t[1]]
          }
          const lampes = type === 'halo'
            ? [halo()]
            : type === 'spot'
              ? [...hote.querySelectorAll(':scope > [mjs-fx-layer] > span')].map(centre)
              : [...hote.parentNode.querySelectorAll('[mjs-fx-filter-lens]')].map(centre)
          const copie = type === 'filtre' ? hote.parentNode.querySelector('[mjs-fx-filter-copy]') : null
          const boites = copie ? [hote, copie].map((n: any) => { const b = n.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] }) : null
          // les seules écritures du geste sur la balise d'un halo : les deux variables du liseré (le reste du style est posé une fois, à la pose)
          const apres = w.__lireStyle(hote.getAttribute('style'))
          const ecrites = type === 'halo' ? Object.keys(apres).filter((n) => apres[n] !== w.__style0[n]).sort() : []
          return { distinctes: new Set(w.__signatures).size, interdits, lampes, boites, lectures, boucle: lectures - w.__apres, ecrites, releves: w.__releves }
        }, { type })
        return { ...bilan, fin, peintures: etat.peintures, duree: Date.now() - debut }
      }

      const sans = async (page: any, ctx: any) => { await page.close(); await ctx.close() }

      for (const [titre, sel, type] of [
        ['le halo et son liseré (le halo : images clés de son pseudo-élément ; le liseré : deux variables)', '.h1', 'halo'],
        ['le voile (un disque percé, son ombre portée autour)', '.h2', 'spot'],
        ['le halo avec retard (une boucle de lissage)', '.h3', 'halo'],
        ['la zone nette de *filter (une lentille et son ancrage)', '.f', 'filtre']
      ] as const) {
        it(titre + ' : la peinture ne dépend pas de la souris, seuls les calques écrivent, la lumière est sous la souris', async function () {
          if (!present) return this.skip()
          const { ctx, page, etat } = await ouvrir()
          try {
            const b = await balayer(page, etat, sel, type)
            assert.equal(b.distinctes, 1, 'dégradés, masques et ombres : un seul état pendant tout le geste (' + b.distinctes + ' différents)')
            assert.deepEqual(b.interdits, [], 'aucune écriture de style hors des nœuds qui se déplacent')
            if (type === 'halo') assert.deepEqual(b.ecrites, ['--mjs-fx-spot-x', '--mjs-fx-spot-y'], 'sur la balise, les deux variables du liseré et rien d\'autre')
            assert.ok(b.lampes.length >= 1, 'la lumière est un calque que la souris déplace (' + b.lampes.length + ')')
            for (const [x, y] of b.lampes) {
              assert.ok(Math.abs(x - b.fin.x) < 1.5 && Math.abs(y - b.fin.y) < 1.5, `la lumière est sous la souris : (${x}, ${y}) pour (${b.fin.x}, ${b.fin.y})`)
            }
            if (b.boites) {
              const [e, c] = b.boites
              assert.ok(e.every((v: number, i: number) => Math.abs(v - c[i]) < 0.6), 'le double reste exactement sur la balise : ' + JSON.stringify(b.boites))
            }
            if (nom === 'chromium') assert.ok(b.peintures <= 4, 'pendant le geste, les calques ne sont (presque) pas repeints : ' + b.peintures + ' peintures en 24 mouvements')
          }
          finally {
            await sans(page, ctx)
          }
        })
      }

      it('le voile et la zone nette ne lisent rien pendant le geste (ni boîte, ni style, ni animations), le halo avec retard rien dans sa boucle de lissage', async function () {
        if (!present) return this.skip()
        const { ctx, page, etat } = await ouvrir()
        try {
          const v = await balayer(page, etat, '.h2', 'spot')
          assert.equal(v.lectures, 0, 'le voile : ' + v.lectures + ' lectures')
          const h = await balayer(page, etat, '.h3', 'halo')
          assert.equal(h.boucle, 0, 'le halo avec retard : ' + h.boucle + ' lectures dans la boucle de lissage, après le dernier mouvement')
          assert.ok(h.lectures > 0, 'et sa boîte est relue à chaque mouvement, comme avant (' + h.lectures + ' lectures en 24 mouvements)')
          const f = await balayer(page, etat, '.f', 'filtre')
          assert.equal(f.lectures, 0, 'la zone nette : ' + f.lectures + ' lectures de boîte ou de style')
          // les animations ne sont relevées qu'à un mouvement de la souris (pour trouver un mouvement lancé par le script de l'auteur), au plus tous les 50 ms, jamais à chaque image
          assert.ok(f.releves <= f.duree / 45 + 3, `la zone nette : ${f.releves} relevés d'animations en ${f.duree} ms (au plus un toutes les 45 ms)`)
        }
        finally {
          await sans(page, ctx)
        }
      })
    })
  }
})
