// *filter selon le moteur : WebKit (Safari, et tous les navigateurs d'iOS) lit en coordonnées de page les
// x/y des sous-régions de primitives et la position des lumières ; pixelate, tiltshift, halftone et le
// vignettage y ont leur propre construction, choisie d'après le fabricant du navigateur (navigator.vendor),
// que l'agent d'utilisateur d'une émulation ne change pas. Les autres moteurs gardent exactement le
// filtre d'avant, lumière du vignettage en px comprise. Les pixels vrais sont vus dans
// effets-filtre-atelier-browser.test.ts et effets-filtre-moteurs-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE = [
  '<img class="pi" src="x.png" alt="" *filter(pixelate)>',
  '<img class="ti" src="x.png" alt="" *filter(tiltshift)>',
  '<img class="ha" src="x.png" alt="" *filter(halftone)>',
  '<img class="ne" src="x.png" alt="" *filter(newsprint)>',
  '<img class="vi" src="x.png" alt="" *filter(vignette)>',
  '<img class="po" src="x.png" alt="" *filter(polaroid)>',
  '<img class="sc" src="x.png" alt="" *filter(scanlines)>'
].join('\n')

// [User-Agent, fabricant du navigateur, WebKit ?] : tout navigateur d'iOS tourne sur WebKit et se dit d'Apple ; Chrome,
// Edge, Opera et Android non ; l'agent d'une émulation (Chromium en iPhone) change l'agent, jamais le fabricant
const APPLE                                              = 'Apple Computer, Inc.'
const GOOGLE                                             = 'Google Inc.'
const SAFARI_MAC                                         = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const SAFARI_IPHONE                                      = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const CHROME_LINUX                                       = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const MOTEURS: Record<string, [string, string, boolean]> = {
  'Safari macOS':   [SAFARI_MAC, APPLE, true],
  'Safari iOS':     [SAFARI_IPHONE, APPLE, true],
  'Chrome iOS':     ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1', APPLE, true],
  'Firefox iOS':    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15', APPLE, true],
  'Edge iOS':       ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/123.0.2420.97 Mobile/15E148 Safari/605.1.15', APPLE, true],
  'Safari qui se donne l\'agent de Chrome': [CHROME_LINUX, APPLE, true],
  'Chrome':         [CHROME_LINUX, GOOGLE, false],
  'Edge':           ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0', GOOGLE, false],
  'Opera':          ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0', GOOGLE, false],
  'Chrome Android': ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', GOOGLE, false],
  'Chromium en émulation d\'iPhone (l\'agent de Safari)': [SAFARI_IPHONE, GOOGLE, false],
  'Firefox': ['Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0', '', false],
  'Firefox qui se donne l\'agent de Safari': [SAFARI_MAC, '', false]
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets — *filter : la construction propre à WebKit ne sert qu\'à WebKit', function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []
  const restitutions: Array<() => void> = []

  before(async () => {
    const root   = mjsTmp('effets-filtre-webkit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-wk-page.mjs'), PAGE + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  afterEach(() => { while (restitutions.length) restitutions.pop()!() })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // la page montée dans une fenêtre qui se présente avec ce User-Agent et ce fabricant ; `mesure` : la mise en page
  // que happy-dom n'a pas (taille arrondie, rectangle que rendrait le navigateur, pixels de l'appareil par pixel CSS)
  async function monter(userAgent: string, fabricant: string, mesure?: { w: number, h: number, rw: number, rh: number, dpr: number }) {
    const window: any = new Window({ url: 'http://localhost/', settings: { navigator: { userAgent } } })
    Object.defineProperty(window.navigator, 'vendor', { value: fabricant, configurable: true })
    if (mesure) {
      // le prototype est partagé entre les fenêtres de happy-dom : ce qu'on y pose est rendu après chaque test, sinon les autres fichiers de test mesurent faux
      const proto = window.HTMLElement.prototype
      // le cadre mesure par le prototype d'Element (jamais par un champ de la balise) : le rectangle se pose là
      const protoElement = window.Element.prototype
      const avant = [['offsetWidth', proto], ['offsetHeight', proto], ['getBoundingClientRect', protoElement]].map(([k, p]: any) => [k, p, Object.getOwnPropertyDescriptor(p, k)] as const)
      restitutions.push(() => { for (const [k, p, d] of avant) { if (d) Object.defineProperty(p, k, d); else delete p[k] } })
      Object.defineProperty(proto, 'offsetWidth', { get: () => mesure.w, configurable: true })
      Object.defineProperty(proto, 'offsetHeight', { get: () => mesure.h, configurable: true })
      Object.defineProperty(protoElement, 'getBoundingClientRect', { value: () => ({ x: 0, y: 0, left: 0, top: 0, width: mesure.rw, height: mesure.rh, right: mesure.rw, bottom: mesure.rh }), configurable: true, writable: true })
      window.devicePixelRatio = mesure.dpr
    }
    fenetres.push(window)
    window.eval(code)
    window.document.body.innerHTML = '<mjs-fx-wk-page></mjs-fx-wk-page>'
    const comp = window.document.querySelector('mjs-fx-wk-page')
    await attendre(() => !!comp._shadow?.querySelector('.sc'))
    await pause()
    return comp
  }

  // happy-dom range les noms de balise SVG en minuscules : on cherche sans tenir compte de la casse
  const balises = (f: any, nom: string) => [...f.querySelectorAll('*')].filter((n: any) => n.localName.toLowerCase() === nom.toLowerCase())
  const filtreDe = (comp: any, classe: string) => {
    const el = comp._shadow.querySelector('.' + classe)
    const id = /url\(#([\w-]+)\)/.exec(el.style.getPropertyValue('--mjs-fx-filter-value'))?.[1]
    return comp._shadow.querySelector(`filter#${id}`)
  }
  const unites = (f: any) => f.getAttribute('primitiveUnits')

  for (const [nom, [userAgent, fabricant, webkit]] of Object.entries(MOTEURS)) {
    it(`${nom} : ${webkit ? 'le filtre de WebKit' : 'le filtre d\'avant, inchangé'}`, async () => {
      const comp = await monter(userAgent, fabricant)
      const pi = filtreDe(comp, 'pi')
      const ti = filtreDe(comp, 'ti')
      const ha = filtreDe(comp, 'ha')
      const ne = filtreDe(comp, 'ne')
      const vi = filtreDe(comp, 'vi')
      const po = filtreDe(comp, 'po')
      const sc = filtreDe(comp, 'sc')
      // le pavé d'un pixel : ni x ni y chez WebKit (feOffset le pose au centre), x et y chez les autres
      const pf = balises(pi, 'feFlood')[0]
      assert.equal(balises(pi, 'feOffset').length, webkit ? 1 : 0, 'pixelate : feOffset')
      assert.equal(pf.getAttribute('x'), webkit ? null : '4', 'pixelate : x du pixel')
      assert.equal(pf.getAttribute('y'), webkit ? null : '4', 'pixelate : y du pixel')
      if (webkit) assert.deepEqual([balises(pi, 'feOffset')[0].getAttribute('dx'), balises(pi, 'feOffset')[0].getAttribute('dy')], ['4', '4'], 'pixelate : le pixel est posé au centre du pavé de 8')
      // la bande nette : un feOffset chez WebKit, un y de sous-région chez les autres
      assert.equal(balises(ti, 'feOffset').length, webkit ? 1 : 0, 'tiltshift : feOffset')
      assert.equal(balises(ti, 'feFlood')[0].getAttribute('y') === null, webkit, 'tiltshift : y de la bande')
      // la trame : en fractions de la boîte chez WebKit (le pavé, la lumière), en px chez les autres
      for (const [classe, f, taille] of [['halftone', ha, 10], ['newsprint', ne, 7]] as const) {
        const flood = balises(f, 'feFlood')[0]
        const lumiere = balises(f, 'fePointLight')[0]
        assert.equal(unites(f), webkit ? 'objectBoundingBox' : 'userSpaceOnUse', `${classe} : primitiveUnits`)
        assert.equal(+flood.getAttribute('width') < 1, webkit, `${classe} : pavé en fractions de la boîte`)
        if (!webkit) assert.deepEqual([flood.getAttribute('width'), flood.getAttribute('height'), lumiere.getAttribute('x'), lumiere.getAttribute('y')], [String(taille), String(taille), String(taille / 2), String(taille / 2)], `${classe} : pavé et lumière en px`)
        // x et y à 0 hors WebKit (sans eux, la sous-région prend la région du filtre, négative quand quelque chose déborde), absents chez WebKit
        const origine = webkit ? null : '0'
        const eclairage = balises(f, 'feDiffuseLighting')[0]
        assert.equal(flood.getAttribute('x'), origine, `${classe} : x du pavé`)
        assert.equal(flood.getAttribute('y'), origine, `${classe} : y du pavé`)
        assert.equal(eclairage.getAttribute('x'), origine, `${classe} : x de l'éclairage`)
        assert.equal(eclairage.getAttribute('y'), origine, `${classe} : y de l'éclairage`)
      }
      // le vignettage (et les ambiances qui en portent un) : la lumière en fractions de la boîte chez WebKit, en px
      // au centre de la balise chez les autres (la boîte compte 100 × 100 sans mise en page : la lumière à 50, sa hauteur à 21,213)
      for (const [classe, f] of [['vignette', vi], ['polaroid', po]] as const) {
        assert.equal(unites(f), webkit ? 'objectBoundingBox' : 'userSpaceOnUse', `${classe} : primitiveUnits`)
        const l = balises(f, 'fePointLight')[0]
        assert.deepEqual([l.getAttribute('x'), l.getAttribute('y'), l.getAttribute('z')], webkit ? ['0.5', '0.5', '0.21213'] : ['50', '50', '21.213'], `${classe} : la lumière au centre`)
      }
      // ce qui se donne en px (pixelate, tiltshift, lignes) : primitiveUnits posé en toutes lettres, jamais retiré
      // (WebKit ne relit pas un attribut retiré : une balise qui change de style en direct y disparaissait)
      for (const [classe, f] of [['pixelate', pi], ['tiltshift', ti], ['scanlines', sc]] as const) assert.equal(unites(f), 'userSpaceOnUse', `${classe} : primitiveUnits`)
      // les lignes : x et y à 0 hors WebKit, absents chez WebKit
      assert.equal(balises(sc, 'feFlood')[0].getAttribute('x'), webkit ? null : '0', 'scanlines : x du trait')
      assert.equal(balises(sc, 'feFlood')[0].getAttribute('y'), webkit ? null : '0', 'scanlines : y du trait')
    })
  }

  // le pavé de la trame de WebKit, en fractions de la boîte : (s - 0,9 / dpr) px sur la taille sans arrondi quand la boîte n'est
  // pas transformée, sinon sur la taille arrondie ; la lumière au centre du pavé. Les autres moteurs gardent le pavé en px
  const arrondi = (v: number) => Math.round(v * 1e8) / 1e8
  const pave = (comp: any, classe: string) => {
    const f = filtreDe(comp, classe)
    const flood = balises(f, 'feFlood')[0]
    const lumiere = balises(f, 'fePointLight')[0]
    return { w: flood.getAttribute('width'), h: flood.getAttribute('height'), lx: lumiere.getAttribute('x'), ly: lumiere.getAttribute('y') }
  }

  it('WebKit : le pavé de la trame se règle sur la taille sans arrondi de la boîte et sur les pixels de l\'appareil', async () => {
    const comp = await monter(SAFARI_IPHONE, APPLE, { w: 150, h: 100, rw: 150.3, rh: 100.3, dpr: 2 })
    assert.deepEqual(pave(comp, 'ha'), { w: String(arrondi(9.55 / 150.3)), h: String(arrondi(9.55 / 100.3)), lx: String(arrondi(5 / 150.3)), ly: String(arrondi(5 / 100.3)) }, 'halftone : pavé de 10 - 0,45 px, lumière au centre')
    assert.deepEqual(pave(comp, 'ne'), { w: String(arrondi(6.55 / 150.3)), h: String(arrondi(6.55 / 100.3)), lx: String(arrondi(3.5 / 150.3)), ly: String(arrondi(3.5 / 100.3)) }, 'newsprint : pavé de 7 - 0,45 px, lumière au centre')
  })

  it('WebKit : sur une boîte transformée (le rectangle n\'est plus la taille de mise en page), le pavé se règle sur la taille arrondie', async () => {
    const comp = await monter(SAFARI_IPHONE, APPLE, { w: 150, h: 100, rw: 225, rh: 150, dpr: 1 })
    assert.deepEqual(pave(comp, 'ha'), { w: String(arrondi(9.1 / 150)), h: String(arrondi(9.1 / 100)), lx: String(arrondi(5 / 150)), ly: String(arrondi(5 / 100)) }, 'halftone : pavé de 10 - 0,9 px sur 150 × 100')
  })

  it('un moteur qui n\'est pas WebKit : le pavé reste de 10 px, quelles que soient la taille et la densité de pixels', async () => {
    const comp = await monter(SAFARI_IPHONE, GOOGLE, { w: 150, h: 100, rw: 150.3, rh: 100.3, dpr: 2 })
    assert.deepEqual(pave(comp, 'ha'), { w: '10', h: '10', lx: '5', ly: '5' }, 'halftone : pavé et lumière en px')
  })
})
