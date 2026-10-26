// la cadence commune des effets qui se répètent (`every`), dans Chromium réel, construit en production : le réglage écrit sur la balise
// l'emporte ; sinon la variable de thème commune `$$mjs-fx-every`, posée dans un `<theme>` ou un `<style>`, qui vaut pour toute la descendance
// (pour *spotlight, `$$spotlight-every` passe avant elle) ; sinon le défaut de l'effet. La cadence commune ne met en marche aucun effet : l'éclat de
// *spotlight ne s'allume que par `every` écrit sur la balise ou par `$$spotlight-every`. Le premier passage de *shine, *attention et *annotate
// part tout de suite (à la pose, à l'arrivée à l'écran), la première salve de *glitch 2 s après (un tour, s'il est plus court) ; les suivants
// se calent sur une horloge commune : ils
// tombent sur les multiples de leur tour comptés depuis le début de la page, et deux effets de même rythme posés à des moments différents
// passent ensemble (on: always, on: view) ; le survol garde son départ immédiat.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const STYLE = '<style>\n:host\n  display: block\n.p, .p2\n  position: relative\n  width: 200px\n  height: 30px\n  background: #111\n</style>\n'

const COMPOSANTS: Record<string, string> = {
  // $$mjs-fx-every dans le <theme> : elle règle les quatre effets qui se répètent, sans allumer l'éclat de *spotlight ; écrit sur la balise, `every` l'emporte
  'cad-theme': '<theme>\n  $$mjs-fx-every: 600ms\n</theme>\n<button class="s" *shine(on: always)>S</button>\n<button class="s2" *shine(on: always, every: 2s)>S</button>\n<button class="a" *attention(on: always, duration: 100ms)>A</button>\n<h1 class="g" *glitch(burst: 50ms)>G</h1>\n<span class="n" *annotate(on: always, duration: 100ms)>N</span>\n<div class="p" *spotlight(on: always)></div>\n<div class="p2" *spotlight(on: always, every: 2s)></div>\n' + STYLE,
  // posées dans un <style>, pour la descendance : $$spotlight-every passe avant $$mjs-fx-every pour *spotlight
  'cad-spot': '<div class="p" *spotlight(on: always)></div>\n<button class="s" *shine(on: always)>S</button>\n<style>\n:host\n  display: block\n  $$mjs-fx-every: 700ms\n  $$spotlight-every: 900ms\n.p\n  position: relative\n  width: 200px\n  height: 30px\n</style>\n',
  // $$spotlight-every seule, dans le <theme> : elle allume l'éclat de *spotlight, à sa durée
  'cad-seule': '<theme>\n  $$spotlight-every: 800ms\n</theme>\n<div class="p" *spotlight(on: always)></div>\n' + STYLE,
  // sans variable : le défaut de chaque effet
  'cad-defaut': '<button class="s" *shine(on: always)>S</button>\n<button class="a" *attention(on: always, duration: 100ms)>A</button>\n<h1 class="g" *glitch(burst: 50ms)>G</h1>\n<span class="n" *annotate(on: always, duration: 100ms)>N</span>\n<div class="p" *spotlight(on: always)></div>\n' + STYLE,
  // le même tour de 500 ms partout ; posé deux fois, à des moments différents
  'cad-pas': '<button class="s" *shine(on: always, every: 500ms)>S</button>\n<button class="v" *shine(on: view, every: 500ms)>V</button>\n<button class="a" *attention(on: always, duration: 100ms, every: 400ms)>A</button>\n<button class="av" *attention(on: view, duration: 100ms, every: 400ms)>A</button>\n<h1 class="g" *glitch(every: 500ms, burst: 50ms)>G</h1>\n<span class="n" *annotate(on: always, duration: 100ms, every: 400ms)>N</span>\n<div class="p" *spotlight(on: always, every: 500ms)></div>\n<button class="h" *shine(on: hover, every: 500ms)>H</button>\n' + STYLE
}

// ce qui marque un passage : l'attribut qui apparaît sur la balise
const MARQUES: Record<string, string> = { s: 'mjs-fx-play', s2: 'mjs-fx-play', v: 'mjs-fx-play', h: 'mjs-fx-play', a: 'mjs-fx-play', av: 'mjs-fx-play', n: 'mjs-fx-play', g: 'mjs-fx-glitch-burst' }

describe('effets — la cadence commune des effets qui se répètent, dans un vrai navigateur', function () {
  this.timeout(300000)
  let browser: any = null
  let page: any    = null
  const erreurs: string[] = []

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('cadence-commune')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const manifeste = join(outDir, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
    const stats     = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const script = stripEsm(readFileSync(manifeste, 'utf-8'))
    browser = await (await import('playwright')).chromium.launch()
    page    = await (await browser.newContext({ viewport: { width: 400, height: 2400 } })).newPage()
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-cad-pas id="p1"></mjs-cad-pas><mjs-cad-theme></mjs-cad-theme><mjs-cad-spot></mjs-cad-spot><mjs-cad-seule></mjs-cad-seule><mjs-cad-defaut></mjs-cad-defaut><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(`['mjs-cad-theme', 'mjs-cad-spot', 'mjs-cad-seule', 'mjs-cad-defaut', '#p1'].every((t) => document.querySelector(t)?._shadow?.querySelector('.p')?.hasAttribute('mjs-fx-spot-on'))`, null, { timeout: 60000, polling: 50 })
    // les passages vus : [qui, quand], l'horloge de la page
    await page.evaluate(`(() => {
      window.__vus = []
      window.__suivre = (hote, cle) => {
        const marques = ${JSON.stringify(MARQUES)}
        for (const [classe, attr] of Object.entries(marques)) {
          const e = hote._shadow.querySelector('.' + classe)
          if (!e) continue
          new MutationObserver((l) => {
            const t = performance.now()
            for (const m of l) if (m.oldValue === null && e.hasAttribute(attr)) window.__vus.push([cle + '.' + classe, t])
          }).observe(e, { attributes: true, attributeFilter: [attr], attributeOldValue: true })
        }
      }
      window.__t0 = performance.now()
      window.__suivre(document.querySelector('#p1'), 'p1')
      window.__suivre(document.querySelector('mjs-cad-theme'), 'theme')
      window.__suivre(document.querySelector('mjs-cad-spot'), 'spot')
      window.__suivre(document.querySelector('mjs-cad-defaut'), 'defaut')
    })()`)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  // les instants des passages d'une balise, et leur écart au multiple le plus proche de `tour` ; le premier passage part hors de l'horloge (vu,
  // ou passé avant que la balise soit suivie) : tout de suite pour *shine, *attention et *annotate, 2 s après (un tour au plus) pour *glitch
  const instants = (vus: [string, number][], cle: string) => vus.filter(([c]) => c === cle).map(([, t]) => t)
  const ecart    = (t: number, tour: number) => Math.min(t % tour, tour - (t % tour))
  const cale     = (vus: [string, number][], cle: string, tour: number, min: number) => {
    const tous = instants(vus, cle)
    const ts   = tous.length > 0 && ecart(tous[0], tour) > 60 ? tous.slice(1) : tous
    assert.ok(ts.length >= min, `${cle} : au moins ${min} passages attendus, vus ${ts.length}`)
    const loin = ts.map((t) => Math.round(ecart(t, tour))).filter((d) => d > 60)
    assert.deepEqual(loin, [], `${cle} : chaque passage tombe sur un multiple de ${tour} ms compté depuis le début de la page (écarts : ${ts.map((t) => Math.round(t % tour)).join(', ')})`)
  }
  const eclat = (hote: string, classe: string) => page.evaluate(`(() => { const s = getComputedStyle(document.querySelector('${hote}')._shadow.querySelector('.${classe}'), '::after'); return { nom: s.animationName, duree: s.animationDuration } })()`)

  it('posé une seconde fois, à un autre moment : les passages après le premier tombent sur l\'horloge commune, ensemble (always, view), le survol part tout de suite', async () => {
    // le second, posé au milieu d'un tour de 500 ms
    await page.evaluate(`new Promise((ok) => { const go = () => { const r = performance.now() % 500; if (r > 220 && r < 260) { const p = document.createElement('mjs-cad-pas'); p.id = 'p2'; document.querySelector('#p1').after(p); ok() } else setTimeout(go, 4) }; go() })`)
    await page.waitForFunction(`document.querySelector('#p2')?._shadow?.querySelector('.p')?.hasAttribute('mjs-fx-spot-on')`, null, { timeout: 20000, polling: 5 })
    await page.evaluate(`window.__suivre(document.querySelector('#p2'), 'p2')`)
    await page.waitForTimeout(2600)
    // le survol, au milieu d'un tour : le premier passage part à l'entrée de la souris
    const entree = await page.evaluate(`new Promise((ok) => { const go = () => { const r = performance.now() % 500; if (r > 220 && r < 260) { const t = performance.now(); document.querySelector('#p1')._shadow.querySelector('.h').dispatchEvent(new PointerEvent('pointerenter')); ok(t) } else setTimeout(go, 4) }; go() })`)
    await page.waitForTimeout(100)
    const vus: [string, number][] = await page.evaluate('window.__vus')
    for (const p of ['p1', 'p2']) {
      for (const c of ['s', 'v', 'a', 'av', 'g', 'n']) cale(vus, p + '.' + c, 500, 3)
    }
    const h = instants(vus, 'p1.h')
    assert.ok(h.length >= 1 && h[0] - entree < 50, `le survol : un passage dès l'entrée de la souris (vu ${h.map((t) => Math.round(t - entree)).join(', ')} ms après)`)
    // l'éclat de *spotlight : ses tours partent des multiples de sa durée, sur les deux
    const debuts: number[] = await page.evaluate(`['#p1', '#p2'].map((id) => { const a = document.querySelector(id)._shadow.querySelector('.p').getAnimations({ subtree: true }).find((x) => x.animationName === 'mjs-fx-spot-flash'); return a ? a.startTime % 500 : -1 })`)
    for (const d of debuts) assert.ok(d >= 0 && ecart(d, 500) < 20, `l'éclat de *spotlight se cale sur l'horloge commune (début de ses tours modulo 500 : ${debuts.map((x) => Math.round(x)).join(', ')})`)
    assert.deepEqual(erreurs, [])
  })

  it('$$mjs-fx-every posée dans un <theme> règle les quatre effets qui se répètent, sans allumer l\'éclat de *spotlight ; `every` écrit sur la balise l\'emporte', async () => {
    const vus: [string, number][] = await page.evaluate('window.__vus')
    cale(vus, 'theme.s', 600, 3)
    cale(vus, 'theme.g', 600, 3)
    // *attention et *annotate : le tour est l'appel (100 ms) et la pause `every`
    cale(vus, 'theme.a', 700, 3)
    cale(vus, 'theme.n', 700, 3)
    assert.ok(instants(vus, 'theme.s2').length <= 2, `every: 2s écrit : au plus deux passages, vus ${instants(vus, 'theme.s2').length}`)
    assert.equal((await eclat('mjs-cad-theme', 'p')).nom, 'none', '*spotlight sans every : $$mjs-fx-every n\'allume pas l\'éclat')
    assert.deepEqual(await eclat('mjs-cad-theme', 'p2'), { nom: 'mjs-fx-spot-flash', duree: '2s' }, '*spotlight(every: 2s) : la balise l\'emporte')
  })

  it('posées dans un <style> : $$mjs-fx-every vaut pour la descendance, $$spotlight-every passe avant elle pour *spotlight', async () => {
    const vus: [string, number][] = await page.evaluate('window.__vus')
    cale(vus, 'spot.s', 700, 3)
    assert.deepEqual(await eclat('mjs-cad-spot', 'p'), { nom: 'mjs-fx-spot-flash', duree: '0.9s' })
  })

  it('$$spotlight-every seule, dans un <theme> : elle allume l\'éclat de *spotlight, à sa durée', async () => {
    assert.deepEqual(await eclat('mjs-cad-seule', 'p'), { nom: 'mjs-fx-spot-flash', duree: '0.8s' })
  })

  it('sans variable : le défaut de chaque effet reste (3 s, 5 s, et *spotlight sans éclat)', async () => {
    const vus: [string, number][] = await page.evaluate('window.__vus')
    const t0: number = await page.evaluate('window.__t0')
    // une fenêtre de 2,5 s : au plus un passage pour un tour de 3 s ou plus
    for (const c of ['s', 'a', 'g', 'n']) {
      const n = instants(vus, 'defaut.' + c).filter((t) => t - t0 < 2500).length
      assert.ok(n <= 1, `defaut.${c} : au plus un passage en 2,5 s, vus ${n}`)
    }
    assert.equal((await eclat('mjs-cad-defaut', 'p')).nom, 'none', '*spotlight sans every ni variable : aucun éclat')
    assert.deepEqual(erreurs, [])
  })
})
