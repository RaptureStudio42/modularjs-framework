// *spotlight dans Chromium et Firefox réels : ce qui doit rester, ce qui doit disparaître. Les modes d'avant (halo,
// liseré) relisent la boîte à chaque mouvement de la souris (une carte qui bouge au survol garde la lumière sous
// la souris) et gardent leurs trois écouteurs d'avant, sans défilement ni redimensionnement ; le calque du voile d'un
// survol naît à l'entrée de la souris et part après son effacement ; le retrait pendant le survol défait écouteurs et
// observateur ; `*spotlight(veil)` (le mode sans son nom, lu comme une couleur) avertit une fois.

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

// cinq scènes de 300 × 80 : deux cartes à halo et liseré qui montent de 12 px au survol (sans retard, avec retard), un voile de survol,
// un voile écrit sans son nom, et en dernier un voile toujours allumé qu'on peut retirer ({if}) : rien ne glisse alors sous la souris
const PAGE = '<script>\n$on = true\n</script>\n'
  + '<div class="h1" *spotlight(color: #f00, width: 3)>un</div>\n'
  + '<div class="h2" *spotlight(color: #f00, width: 3, smooth: 0.5)>deux</div>\n'
  + '<div class="v2" *spotlight(where: veil, color: #000, fill: 1, size: 60, soft: 0)>quatre</div>\n'
  + '<div class="v3" *spotlight(veil)>cinq</div>\n'
  + '{if $on}<div class="v1" *spotlight(where: veil, color: #000, fill: 1, size: 60, soft: 0, on: always, smooth: 0.5)>trois</div>{end}\n'
  + '<button class="t" @click={$on = !$on}>t</button>\n'
  + '<style>\n.h1, .h2, .v1, .v2, .v3\n  width: 300px\n  height: 80px\n  margin: 20px 10px\n  background: #fff\n'
  + '.h1, .h2\n  transition: transform .2s\n'
  + '.h1:hover, .h2:hover\n  transform: translateY(-12px)\n</style>\n'

// le registre des écouteurs vivants et des observateurs de taille, posé avant la page : les méthodes natives que les effets
// appellent sont alors les siennes (les effets les cherchent sur le prototype à chaque appel)
const REGISTRE = `(function() {
  var live = [];
  var ro = new Set();
  var add = EventTarget.prototype.addEventListener;
  var rem = EventTarget.prototype.removeEventListener;
  var cap = function(o) { return typeof o === 'boolean' ? o : !!(o && o.capture); };
  EventTarget.prototype.addEventListener = function(type, fn, o) {
    var c = cap(o);
    var self = this;
    var dup = live.some(function(e) { return e.t === self && e.type === type && e.fn === fn && e.capture === c; });
    if (!dup) live.push({ t: this, type: type, fn: fn, capture: c, passive: !!(o && typeof o === 'object' && o.passive) });
    // un écouteur posé avec un signal se retire quand le signal est interrompu, sans appel à removeEventListener
    if (o && typeof o === 'object' && o.signal) o.signal.addEventListener('abort', function() {
      live = live.filter(function(e) { return !(e.t === self && e.type === type && e.fn === fn && e.capture === c); });
    });
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function(type, fn, o) {
    var c = cap(o);
    var self = this;
    live = live.filter(function(e) { return !(e.t === self && e.type === type && e.fn === fn && e.capture === c); });
    return rem.call(this, type, fn, o);
  };
  var RO = window.ResizeObserver;
  if (RO) {
    window.ResizeObserver = class extends RO {
      observe(t, o) { (this._t = this._t || new Set()).add(t); ro.add(this); return super.observe(t, o); }
      unobserve(t) { if (this._t) { this._t.delete(t); if (!this._t.size) ro.delete(this); } return super.unobserve(t); }
      disconnect() { if (this._t) this._t.clear(); ro.delete(this); return super.disconnect(); }
    };
  }
  var nom = function(t) {
    if (t === window) return 'window';
    if (t === document) return 'document';
    if (typeof ShadowRoot === 'function' && t instanceof ShadowRoot) return 'shadow';
    return t && t.localName ? t.localName + (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '') : '?';
  };
  window.__vivants = function(types) {
    return live.filter(function(e) { return types.indexOf(e.type) >= 0; }).map(function(e) { return { cible: nom(e.t), type: e.type, capture: e.capture, passive: e.passive }; });
  };
  window.__observateurs = function() { return ro.size; };
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

describe('*spotlight : les modes d\'avant intacts, le calque du survol, le retrait, le mode sans son nom', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire('fx-spot-corr', PAGE)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de *spotlight sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 400, height: 960 } })
        await ctx.addInitScript(REGISTRE)
        const page = await ctx.newPage()
        const erreurs: string[] = []
        const avertissements: string[] = []
        page.on('console', (m: any) => {
          if (m.type() === 'error') erreurs.push(m.text())
          if (m.type() === 'warning') avertissements.push(m.text())
        })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-corr></mjs-fx-spot-corr><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-corr') as any)?._shadow?.querySelector('.v3'))
        await page.waitForTimeout(300)
        return { ctx, page, erreurs, avertissements }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const r = (document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }, sel)

      const vivants = (page: any, types: string[]) => page.evaluate((t: string[]) => (window as any).__vivants(t), types)

      for (const [sel, titre] of [['.h1', 'sans retard (smooth: 1)'], ['.h2', 'avec retard (smooth: 0.5)']] as const) {
        it(`le halo d'avant ${titre} : la carte qui monte au survol garde la lumière sous la souris`, async function () {
          if (!present) { this.skip(); return }
          const { ctx, page, erreurs } = await ouvrir()
          try {
            const a = await boite(page, sel)
            await page.mouse.move(a.x + 100, a.y + 40, { steps: 3 })
            // la carte a fini de monter quand sa boîte a gagné 12 px
            await page.waitForFunction(([s, y]: [string, number]) => Math.abs((document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector(s).getBoundingClientRect().top - y) < 0.1, [sel, a.y - 12], { timeout: 10000 })
            await page.mouse.move(a.x + 140, a.y + 30, { steps: 2 })
            // la lumière rattrape la souris (le retard) : on attend qu'elle y soit, sans compter le temps ; elle est lue dans la boîte d'aujourd'hui de la carte
            // (la carte a monté de 12 px) : le liseré par ses deux variables, le halo par le `translate` de son pseudo-élément
            const attendu = [a.x + 140, a.y + 30]
            const centres = (q: string) => {
              const e = (document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector(q)
              const r = e.getBoundingClientRect()
              const h = getComputedStyle(e, '::after').translate.split(' ').map(parseFloat)
              return { liseré: [r.left + e.clientLeft + parseFloat(e.style.getPropertyValue('--mjs-fx-spot-x')), r.top + e.clientTop + parseFloat(e.style.getPropertyValue('--mjs-fx-spot-y'))], halo: [r.left + e.clientLeft + h[0], r.top + e.clientTop + h[1]] }
            }
            await page.waitForFunction(([q, x, y, f]: [string, number, number, string]) => {
              const c = (new Function('return ' + f))()(q)
              return [c.liseré, c.halo].every((p: number[]) => Math.abs(p[0] - x) < 0.6 && Math.abs(p[1] - y) < 0.6)
            }, [sel, attendu[0], attendu[1], centres.toString()], { timeout: 4000 }).catch(() => {})
            const lu = await page.evaluate(([q, f]: [string, string]) => (new Function('return ' + f))()(q), [sel, centres.toString()])
            for (const [quoi, p] of [['le liseré', lu.liseré], ['le halo', lu.halo]] as const) {
              assert.ok(Math.abs(p[0] - attendu[0]) < 0.6 && Math.abs(p[1] - attendu[1]) < 0.6, `${quoi} est sous la souris, mesuré dans la boîte d'aujourd'hui de la carte (12 px plus haut) : ${p} au lieu de ${attendu}`)
            }
            assert.deepEqual(erreurs, [])
          }
          finally {
            await ctx.close()
          }
        })
      }

      it('le halo d\'avant garde ses trois écouteurs d\'avant, non passifs ; ni défilement ni redimensionnement posés au survol', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const repos = await vivants(page, ['scroll', 'resize'])
          const a     = await boite(page, '.h1')
          await page.mouse.move(a.x + 100, a.y + 40, { steps: 3 })
          await page.mouse.move(a.x + 120, a.y + 40, { steps: 2 })
          assert.deepEqual(await vivants(page, ['scroll', 'resize']), repos, 'rien de plus qu\'au repos : le halo relit la boîte à chaque mouvement, il n\'a rien à surveiller')
          const siens = (await vivants(page, ['pointerenter', 'pointermove', 'pointerleave'])).filter((e: any) => e.cible === 'div.h1')
          assert.deepEqual(siens.map((e: any) => e.type).sort(), ['pointerenter', 'pointerleave', 'pointermove'])
          assert.ok(siens.every((e: any) => e.passive === false && e.capture === false), 'écouteurs d\'avant : sans options')
          // le voile, lui, surveille le défilement et la taille pendant le survol seulement, avec des écouteurs passifs
          const v = await boite(page, '.v2')
          await page.mouse.move(v.x + 100, v.y + 40, { steps: 3 })
          const pendant = await vivants(page, ['scroll', 'resize'])
          assert.ok(pendant.some((e: any) => e.type === 'resize' && e.cible === 'window' && e.passive), 'redimensionnement surveillé pendant le survol du voile')
          assert.ok(pendant.some((e: any) => e.type === 'scroll' && e.capture && e.passive), 'défilement surveillé pendant le survol du voile')
          await page.mouse.move(395, 955, { steps: 2 })
          assert.deepEqual(await vivants(page, ['scroll', 'resize']), repos, 'et plus rien après la sortie')
          const voile = (await vivants(page, ['pointerenter', 'pointermove', 'pointerleave'])).filter((e: any) => e.cible === 'div.v2')
          assert.ok(voile.length === 3 && voile.every((e: any) => e.passive), 'les écouteurs du voile sont passifs')
        }
        finally {
          await ctx.close()
        }
      })

      it('on: hover : aucun calque au repos ; il naît à l\'entrée de la souris, se montre, puis part après son effacement', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const lire = () => page.evaluate(() => {
            const el = (document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.v2')
            const l  = el.querySelector('[mjs-fx-layer="spotlight"]')
            return { enfants: el.children.length, calque: !!l, op: l ? getComputedStyle(l).opacity : null, vis: l ? getComputedStyle(l).visibility : null, wc: l ? l.getAttribute('mjs-fx-live') : null }
          })
          assert.deepEqual(await lire(), { enfants: 0, calque: false, op: null, vis: null, wc: null }, 'au repos, rien dans la balise')
          const a = await boite(page, '.v2')
          await page.mouse.move(a.x + 100, a.y + 40, { steps: 2 })
          await page.waitForFunction(() => {
            const l = (document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.v2 [mjs-fx-layer="spotlight"]')
            return !!l && getComputedStyle(l).opacity === '1'
          }, null, { timeout: 10000 })
          assert.deepEqual(await lire(), { enfants: 1, calque: true, op: '1', vis: 'visible', wc: '' })
          await page.mouse.move(395, 955, { steps: 2 })
          await page.waitForFunction(() => !(document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.v2 [mjs-fx-layer="spotlight"]'), null, { timeout: 10000 })
          assert.deepEqual(await lire(), { enfants: 0, calque: false, op: null, vis: null, wc: null }, 'parti après son effacement')
          // une seconde visite le refait
          await page.mouse.move(a.x + 60, a.y + 20, { steps: 2 })
          await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.v2 [mjs-fx-layer="spotlight"]'), null, { timeout: 10000 })
          await page.mouse.move(395, 955, { steps: 2 })
        }
        finally {
          await ctx.close()
        }
      })

      it('on: hover : le calque neuf se montre en fondu (une transition d\'opacité part dès l\'entrée)', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          // l'entrée est jouée dans la page, d'un trait : le fondu se lit dans la même tâche, avant qu'il ait pu finir
          const r = await page.evaluate(() => {
            const el = (document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.v2')
            const b  = el.getBoundingClientRect()
            el.dispatchEvent(new PointerEvent('pointerenter', { clientX: b.left + 100, clientY: b.top + 40 }))
            const l = el.querySelector('[mjs-fx-layer="spotlight"]')
            return { calque: !!l, fondu: !!l && l.getAnimations().some((a: any) => a.transitionProperty === 'opacity') }
          })
          assert.deepEqual(r, { calque: true, fondu: true })
        }
        finally {
          await ctx.close()
        }
      })

      it('le retrait pendant le survol (voile toujours allumé) défait les écouteurs de défilement et de taille, et l\'observateur', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const repos = await vivants(page, ['scroll', 'resize'])
          const obs0  = await page.evaluate(() => (window as any).__observateurs())
          assert.equal(obs0, 1, 'au repos, le voile toujours allumé observe sa taille (l\'étendue de son ombre la suit)')
          const a     = await boite(page, '.v1')
          await page.mouse.move(a.x + 100, a.y + 40, { steps: 3 })
          await page.mouse.move(a.x + 140, a.y + 30, { steps: 2 })
          assert.ok((await vivants(page, ['scroll', 'resize'])).length > repos.length, 'pendant le survol, le voile surveille')
          assert.ok((await page.evaluate(() => (window as any).__observateurs())) > obs0, 'et observe la taille de la balise')
          await page.evaluate(() => (document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.t').click())
          await page.waitForFunction(() => !(document.querySelector('mjs-fx-spot-corr') as any)._shadow.querySelector('.v1'), null, { timeout: 10000 })
          await page.waitForFunction(() => (window as any).__vivants(['scroll', 'resize']).length === 0, null, { timeout: 5000 }).catch(() => {})
          assert.deepEqual(await vivants(page, ['scroll', 'resize']), repos, 'le retrait pendant le survol défait tout')
          assert.equal(await page.evaluate(() => (window as any).__observateurs()), 0, 'l\'observateur est déconnecté')
        }
        finally {
          await ctx.close()
        }
      })

      it('*spotlight(veil) : un avertissement, une fois, qui dit d\'écrire where: veil ; les couleurs ne disent rien', async function () {
        if (!present) { this.skip(); return }
        const { ctx, avertissements } = await ouvrir()
        try {
          const siens = avertissements.filter((m) => /spotlight/.test(m))
          assert.equal(siens.length, 1, `un seul avertissement : ${siens.join(' | ')}`)
          assert.match(siens[0], /veil/)
          assert.match(siens[0], /where: veil/)
        }
        finally {
          await ctx.close()
        }
      })
    })
  }
})
