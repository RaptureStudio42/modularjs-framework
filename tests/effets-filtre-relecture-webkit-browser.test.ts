// *filter dans WebKit : l'encre de la balise est relue quand elle change sans que la taille change — enfant ajouté
// ou retiré, classe ou variable CSS d'un ancêtre (dans le document comme dans un shadow root), survol d'un ancêtre,
// animation CSS qui court — et seulement alors : une mutation ailleurs ne relit rien. Les gardes de la relecture
// (observateur vidé après un tracé, `style` observé, focus, fin ou annulation d'une transition ou d'une animation
// quand `getAnimations` manque, une relecture au plus par image, balise détachée, balise tournée ou en miroir) ont
// chacune leur test. Par page, trois balises filtrées au plus : WebKit vide les premières rangées au-delà.

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

// les outils de la page, en JavaScript simple : compteurs de lectures et de tracés, montage d'une balise dans le document ou un shadow root
const OUTILS = `
window.__log = []
window.__reads = 0
window.__plans = 0
var __oi = window._mjsFxInk
window._mjsFxInk = function(a, b) { window.__reads++; return __oi(a, b) }
var __op = window._mjsFxPlan
window._mjsFxPlan = function(el, s, box) {
  window.__plans++
  window.__log.push([el.getAttribute('data-k'), box.ink ? box.ink.l + ',' + box.ink.t + ',' + box.ink.r + ',' + box.ink.b : ''])
  return __op(el, s, box)
}
window.__monte = function(kind, css, html, style) {
  var host = document.getElementById('host')
  var root = kind === 'shadow' ? host.attachShadow({ mode: 'open' }) : host
  root.innerHTML = '<style>' + µ._mjs_fxDefs.filter.css + css + '</style>' + html
  window.__root = root
  var els = root.querySelectorAll('.bx')
  window.__stops = []
  for (var i = 0; i < els.length; i++) {
    els[i].setAttribute('mjs-fx', 'filter')
    window.__stops.push(µ._mjs_fxDefs.filter.setup(els[i], { style: style || 'halftone' }))
  }
}
window.__el = function(k) { return window.__root.querySelector('[data-k=' + k + ']') }
window.__now = function(k) {
  var el = window.__el(k)
  var i = __oi(el, el.getBoundingClientRect())
  return i.l + ',' + i.t + ',' + i.r + ',' + i.b
}
window.__last = function(k) {
  for (var i = window.__log.length - 1; i >= 0; i--) if (window.__log[i][0] === k) return window.__log[i][1]
  return '(aucun)'
}
window.__distinct = function(k) {
  var seen = {}
  for (var i = 0; i < window.__log.length; i++) if (window.__log[i][0] === k) seen[window.__log[i][1]] = 1
  return Object.keys(seen).length
}
`

const OMBRE = 'box-shadow: 0 0 30px 10px #000'

const BASE_CSS = '.bx{position:relative;width:150px;height:80px;margin:60px 50px;background:#d33}'
  + '.k{position:absolute;left:10px;top:10px;width:40px;height:40px;background:#36d}'

const SOURCE_COMPOSANT = '<div class="p">\n  <div class="bx b0" *filter(halftone)></div>\n</div>\n'
  + '<style>\n.p\n  padding: 10px\n.bx\n  width: 150px\n  height: 80px\n  margin: 60px 50px\n  background: #d33\n.p.on .bx\n  box-shadow: 0 0 30px 10px #000\n</style>\n'

describe('*filter dans WebKit : la relecture de l\'encre', function () {
  this.timeout(600000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-filtre-relecture-webkit-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-rel-page.mjs'), SOURCE_COMPOSANT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  // une page vide avec le moteur du framework et les outils ; `sansAnimations` retire getAnimations (le chemin des événements), `sansTaille` retire ResizeObserver (la seule relecture est alors celle de l'image)
  async function ouvre(nom: 'chromium' | 'firefox' | 'webkit', fn: (page: any) => Promise<void>, opts: { sansAnimations?: boolean, sansTaille?: boolean, dpr?: number } = {}): Promise<void> {
    const lanceur = (await import('playwright'))[nom]
    const browser = await lanceur.launch()
    try {
      const ctx  = await browser.newContext({ viewport: { width: 700, height: 500 }, deviceScaleFactor: opts.dpr || 1 })
      const page = await ctx.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      await page.setContent('<!doctype html><html><body style="margin:0"><div id="host"></div></body></html>')
      await page.addScriptTag({ content: script })
      if (opts.sansAnimations) await page.evaluate('delete Element.prototype.getAnimations')
      if (opts.sansTaille) await page.evaluate('delete window.ResizeObserver')
      await page.addScriptTag({ content: OUTILS })
      await fn(page)
      assert.deepEqual(erreurs, [], erreurs.join('\n'))
      await ctx.close()
    } finally {
      await browser.close()
    }
  }

  const monte = (page: any, kind: string, regles: string, html: string, style = 'halftone') => page.evaluate(([k, c, h, st]: string[]) => (globalThis as any).__monte(k, c, h, st), [kind, regles, html, style])
  const now   = (page: any, k: string): Promise<string> => page.evaluate((x: string) => (globalThis as any).__now(x), k)
  const last  = (page: any, k: string): Promise<string> => page.evaluate((x: string) => (globalThis as any).__last(x), k)
  const reads = (page: any): Promise<number> => page.evaluate('window.__reads')
  const plans = (page: any): Promise<number> => page.evaluate('window.__plans')
  const run   = (page: any, js: string) => page.evaluate(js)
  const pause = (page: any, ms = 400) => page.waitForTimeout(ms)

  // l'encre relue est celle d'aujourd'hui et elle a changé depuis `avant`
  async function suit(page: any, k: string, avant: string, quoi: string): Promise<string> {
    const a = await now(page, k)
    assert.ok(a !== avant, `${quoi} : l'encre n'a pas changé (${a}), le test ne mesure rien`)
    assert.equal(await last(page, k), a, `${quoi} : le dernier tracé (${await last(page, k)}) n'a pas l'encre d'aujourd'hui (${a})`)
    return a
  }

  describe('webkit', function () {
    let present = false
    before(async function () { present = await navigateurPresent('webkit') })

    it('un enfant ajouté puis retiré change l\'encre : elle est relue', async function () {
      if (!present) { this.skip(); return }
      await ouvre('webkit', async (page) => {
        await monte(page, 'document', BASE_CSS, '<div class="bx" data-k="a"></div>')
        await pause(page, 200)
        const zero = await now(page, 'a')
        await run(page, `window.__el('a').insertAdjacentHTML('beforeend', '<div class="k" style="left:-40px;top:-30px"></div>')`)
        await pause(page)
        const avec = await suit(page, 'a', zero, 'enfant ajouté')
        await run(page, `window.__el('a').firstChild.remove()`)
        await pause(page)
        assert.equal(await now(page, 'a'), zero)
        assert.equal(await last(page, 'a'), zero, `enfant retiré : le dernier tracé (${await last(page, 'a')}) garde l'encre de l'enfant (${avec})`)
      })
    })

    for (const kind of ['document', 'shadow']) {
      it(`une classe posée sur un ancêtre change l'encre (${kind}) : elle est relue`, async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, kind, BASE_CSS + `.p.on .bx{${OMBRE}}`, '<div class="p" id="p"><div class="bx" data-k="a"></div></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `window.__root.querySelector('#p').classList.add('on')`)
          await pause(page)
          await suit(page, 'a', zero, 'classe sur un ancêtre')
        })
      })

      it(`une variable CSS posée sur body change l'encre (${kind}) : elle est relue`, async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, kind, BASE_CSS + '.bx{box-shadow:0 0 var(--sh,0px) 5px #000}', '<div class="bx" data-k="a"></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `document.body.style.setProperty('--sh', '20px')`)
          await pause(page)
          const a = await suit(page, 'a', zero, 'variable sur body')
          await run(page, `document.getElementById('host').style.setProperty('--sh', '40px')`)
          await pause(page)
          await suit(page, 'a', a, 'variable sur l\'hôte')
        })
      })

      it(`le survol d'un ancêtre sans transition change l'encre (${kind}) : elle est relue`, async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, kind, BASE_CSS + `.p{padding:10px}.p:hover .bx{${OMBRE}}`, '<div class="p" id="p"><div class="bx" data-k="a"></div></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          const r = await page.evaluate(`(function(){ var q = window.__root.querySelector('#p').getBoundingClientRect(); return { x: q.left, y: q.top } })()`)
          await page.mouse.move(600, 400)
          await page.mouse.move(r.x + 4, r.y + 4)
          await pause(page)
          const a = await suit(page, 'a', zero, 'survol de l\'ancêtre')
          await page.mouse.move(600, 400)
          await pause(page)
          assert.equal(await now(page, 'a'), zero)
          assert.equal(await last(page, 'a'), zero, `fin du survol : le dernier tracé (${await last(page, 'a')}) garde l'encre du survol (${a})`)
        })
      })
    }

    it('la balise d\'un composant est relue quand une classe change sur son ancêtre', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright')).webkit
      const browser = await lanceur.launch()
      try {
        const page = await (await browser.newContext({ viewport: { width: 700, height: 500 } })).newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-fx-rel-page></mjs-fx-rel-page><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-rel-page') as any)?._shadow?.querySelector('.b0'))
        await page.waitForTimeout(500)
        const lire = () => page.evaluate(`(function(){ var el = document.querySelector('mjs-fx-rel-page')._shadow.querySelector('.b0'); var i = window._mjsFxInk(el, el.getBoundingClientRect()); return i.l + ',' + i.t + ',' + i.r + ',' + i.b })()`)
        const zero = await lire()
        await page.evaluate(`window.__plans = 0; var o = window._mjsFxPlan; window._mjsFxPlan = function(el, s, box) { window.__plans++; window.__ink = box.ink ? box.ink.l + ',' + box.ink.t + ',' + box.ink.r + ',' + box.ink.b : ''; return o(el, s, box) }`)
        await page.evaluate(`document.querySelector('mjs-fx-rel-page')._shadow.querySelector('.p').classList.add('on')`)
        await page.waitForTimeout(500)
        const apres = await lire()
        assert.ok(apres !== zero, 'la classe n\'a pas changé l\'encre')
        assert.equal(await page.evaluate('window.__ink'), apres, 'le filtre du composant n\'a pas été refait avec l\'encre d\'aujourd\'hui')
      } finally {
        await browser.close()
      }
    })

    it('une mutation ailleurs ne relit aucune balise ; celle d\'un ancêtre les relit', async function () {
      if (!present) { this.skip(); return }
      await ouvre('webkit', async (page) => {
        const autres = Array.from({ length: 300 }, (_, i) => `<i class="n${i}"></i>`).join('')
        await monte(page, 'document', BASE_CSS + '.p.on{padding:1px}', `<div class="p" id="p"><div class="bx" data-k="a"></div><div class="bx" data-k="b"></div><div class="bx" data-k="c"></div></div><div id="autre">${autres}</div>`)
        await pause(page, 300)
        const avant = await reads(page)
        await run(page, `var n = window.__root.querySelectorAll('#autre i'); for (var i = 0; i < n.length; i++) { n[i].className = 'x' + i; n[i].style.color = 'red' } document.getElementById('autre').className = 'z'`)
        await pause(page)
        assert.equal(await reads(page) - avant, 0, 'des mutations sans balise filtrée concernée ont relu l\'encre')
        await run(page, `window.__root.querySelector('#p').classList.add('on')`)
        await pause(page)
        assert.ok(await reads(page) - avant >= 3, 'la mutation d\'un ancêtre n\'a pas relu les trois balises')
      })
    })

    it('une animation infinie sur un enfant : l\'encre est relue à chaque image', async function () {
      if (!present) { this.skip(); return }
      await ouvre('webkit', async (page) => {
        await monte(page, 'document', BASE_CSS + '.kan{animation:mv 1s linear infinite}@keyframes mv{from{left:10px}to{left:-50px}}', '<div class="bx" data-k="a"><div class="k kan"></div></div>')
        await pause(page, 1500)
        const n = await page.evaluate(`window.__distinct('a')`)
        assert.ok(n >= 6, `l'animation n'a produit que ${n} encres distinctes en 1,5 s`)
      })
    })

    it('une animation finie qui garde sa dernière image : l\'encre finale est relue, puis la relecture s\'arrête', async function () {
      if (!present) { this.skip(); return }
      await ouvre('webkit', async (page) => {
        await monte(page, 'document', BASE_CSS + '.kan{animation:mv 400ms linear 1 forwards}@keyframes mv{from{left:10px}to{left:-50px}}', '<div class="bx" data-k="a"></div>')
        await pause(page, 200)
        await run(page, `window.__el('a').insertAdjacentHTML('beforeend', '<div class="k kan"></div>')`)
        await pause(page, 1000)
        assert.equal(await last(page, 'a'), await now(page, 'a'))
        const avant = await reads(page)
        await pause(page, 400)
        assert.equal(await reads(page) - avant, 0, 'la relecture continue après la fin de l\'animation')
      })
    })

    it('une transition finie sur un enfant : l\'encre finale est relue', async function () {
      if (!present) { this.skip(); return }
      await ouvre('webkit', async (page) => {
        await monte(page, 'document', BASE_CSS + '.bx{transition:box-shadow 300ms}.bx.on{' + OMBRE + '}', '<div class="bx" data-k="a"></div>')
        await pause(page, 200)
        const zero = await now(page, 'a')
        await run(page, `window.__el('a').classList.add('on')`)
        await pause(page, 900)
        await suit(page, 'a', zero, 'transition finie')
      })
    })

    describe('gardes de la relecture', function () {
      it('l\'observateur vidé après un tracé : le style écrit par un tracé n\'en relit pas un autre', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          // une variable de l'effet change la valeur de `filter` écrite par le tracé : ce style n'est pas un changement de l'auteur
          await monte(page, 'document', BASE_CSS, '<div class="bx" data-k="a"></div>', 'newsprint')
          await pause(page, 300)
          const r0 = await reads(page)
          const p0 = await plans(page)
          await run(page, `window.__stops[0].set('amount', .5)`)
          await pause(page, 600)
          assert.equal(await plans(page) - p0, 1, 'un seul tracé attendu')
          assert.equal(await reads(page) - r0, 1, 'le style écrit par le tracé a lancé une relecture de plus')
        })
      })

      it('le style de la balise et celui de ses enfants sont observés', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS, '<div class="bx" data-k="a"></div><div class="bx" data-k="b"><div class="k" id="kb"></div></div>')
          await pause(page, 200)
          const za = await now(page, 'a')
          await run(page, `window.__el('a').style.boxShadow = '0 0 30px 10px #000'`)
          await pause(page)
          await suit(page, 'a', za, 'style de la balise')
          const zb = await now(page, 'b')
          await run(page, `var k = window.__root.querySelector('#kb'); k.style.left = '-40px'; k.style.top = '-30px'`)
          await pause(page)
          await suit(page, 'b', zb, 'style d\'un enfant')
        })
      })

      it('le focus qui change le style relit l\'encre, à l\'entrée comme à la sortie', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS + '.bx:focus{outline:none;' + OMBRE + '}', '<div class="bx" data-k="a" tabindex="0"></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `window.__el('a').focus()`)
          await pause(page)
          await suit(page, 'a', zero, 'focus')
          await run(page, `window.__el('a').blur()`)
          await pause(page)
          assert.equal(await now(page, 'a'), zero)
          assert.equal(await last(page, 'a'), zero, `focus perdu : le dernier tracé (${await last(page, 'a')}) garde l'encre du focus`)
        })
      })

      // sans getAnimations, seuls les événements disent qu'une transition ou une animation est finie ou annulée
      it('sans getAnimations, la fin d\'une transition relit l\'encre', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS + '.bx{transition:box-shadow 300ms linear}.bx.on{' + OMBRE + '}', '<div class="bx" data-k="a"></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `window.__el('a').classList.add('on')`)
          await pause(page, 900)
          await suit(page, 'a', zero, 'fin de transition')
        }, { sansAnimations: true })
      })

      it('sans getAnimations, l\'annulation d\'une transition relit l\'encre', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS + '.bx{transition:box-shadow 5s linear}.bx.on{' + OMBRE + '}', '<div class="bx" data-k="a"></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `window.__el('a').classList.add('on')`)
          await pause(page, 150)
          // la règle change sans toucher un attribut : seul l'événement le dit
          await run(page, `window.__root.querySelector('style').sheet.insertRule('.bx{transition:none !important}', 0)`)
          await pause(page, 600)
          await suit(page, 'a', zero, 'transition annulée')
        }, { sansAnimations: true })
      })

      it('sans getAnimations, la fin d\'une animation relit l\'encre', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS + '.bx.on{animation:g 300ms linear forwards}@keyframes g{from{box-shadow:0 0 0 0 #000}to{box-shadow:0 0 40px 10px #000}}', '<div class="bx" data-k="a"></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `window.__el('a').classList.add('on')`)
          await pause(page, 900)
          await suit(page, 'a', zero, 'fin d\'animation')
        }, { sansAnimations: true })
      })

      it('sans getAnimations, l\'annulation d\'une animation relit l\'encre', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS + '.bx.on{animation:h 5s linear forwards}@keyframes h{from{box-shadow:0 0 40px 10px #000}to{box-shadow:0 0 0 0 #000}}', '<div class="bx" data-k="a"></div>')
          await pause(page, 200)
          const zero = await now(page, 'a')
          await run(page, `window.__el('a').classList.add('on')`)
          await pause(page, 150)
          const milieu = await now(page, 'a')
          assert.ok(milieu !== zero, 'l\'animation n\'a pas commencé')
          await run(page, `window.__root.querySelector('style').sheet.insertRule('.bx{animation:none !important}', 0)`)
          await pause(page, 600)
          assert.equal(await now(page, 'a'), zero)
          assert.equal(await last(page, 'a'), zero, `animation annulée : le dernier tracé (${await last(page, 'a')}) garde l'encre de l'animation`)
        }, { sansAnimations: true })
      })

      it('une relecture au plus par image', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS, '<div class="bx" data-k="a"></div>')
          await pause(page, 300)
          const avant = await reads(page)
          // quatre changements de classe, chacun dans sa microtâche, dans la même image : le style revient à l'état de départ
          await page.evaluate(`(async function(){ for (var i = 0; i < 4; i++) { window.__el('a').classList.toggle('x'); await Promise.resolve() } })()`)
          await pause(page)
          assert.equal(await reads(page) - avant, 1, 'quatre changements dans une image ont relu l\'encre plus d\'une fois')
        })
      })

      it('une balise détachée avant l\'image n\'est pas relue ni refaite', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS, '<div class="bx" data-k="a"></div>')
          await pause(page, 300)
          const r0 = await reads(page)
          const p0 = await plans(page)
          await run(page, `var e = window.__el('a'); e.classList.add('x'); e.remove()`)
          await pause(page)
          assert.equal(await reads(page) - r0, 0, 'une balise détachée a été relue')
          assert.equal(await plans(page) - p0, 0, 'une balise détachée a été refaite')
        }, { sansTaille: true })
      })

      it('une balise tournée ou en miroir ne compte pas ses enfants (limite)', async function () {
        if (!present) { this.skip(); return }
        await ouvre('webkit', async (page) => {
          await monte(page, 'document', BASE_CSS + '.rot{transform:rotate(10deg)}.mir{transform:scaleX(-1)}.sc{transform:scale(1.1)}', '<div class="bx rot" data-k="a"><div class="k" style="left:-40px;top:-30px"></div></div><div class="bx mir" data-k="b"><div class="k" style="left:-40px;top:-30px"></div></div><div class="bx sc" data-k="c"><div class="k" style="left:-40px;top:-30px"></div></div>')
          await pause(page, 300)
          assert.equal(await now(page, 'a'), '0,0,0,0', 'balise tournée')
          assert.equal(await now(page, 'b'), '0,0,0,0', 'balise en miroir')
          assert.equal(await now(page, 'c'), '40,30,0,0', 'balise mise à l\'échelle : ses enfants comptent')
        })
      })
    })
  })

  for (const nom of ['chromium', 'firefox'] as const) {
    it(`${nom} : rien n'est observé, aucun tracé de plus`, async function () {
      if (!(await navigateurPresent(nom))) { this.skip(); return }
      await ouvre(nom, async (page) => {
        await monte(page, 'document', BASE_CSS + `.p.on .bx{${OMBRE}}`, '<div class="p" id="p"><div class="bx" data-k="a"></div></div>')
        await pause(page, 300)
        const p0 = await plans(page)
        const r0 = await reads(page)
        await run(page, `window.__root.querySelector('#p').classList.add('on')`)
        await pause(page)
        assert.equal(await plans(page) - p0, 0)
        assert.equal(await reads(page) - r0, 0)
      })
    })
  }
})
