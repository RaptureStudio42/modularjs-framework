// *path — une balise qui suit un tracé : le tracé tout fait, le sien (attribut `d` d'un <path> SVG),
// celui d'un <path> de la page (`from`), la mise à l'échelle (`viewbox`), chaque réglage lu, les deux
// techniques (offset-path, minuterie), les refus de compilation, le composant, le retrait.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-trace':          '<div class="p"><i class="a" *path></i></div>',
  'fx-trace-propre':   '<div class="p"><i class="a" *path(\'M10 100 C 60 20, 100 20, 145 80 S 230 140, 280 60\')></i></div>',
  'fx-trace-forme':    '<div class="p"><i class="a" *path(heart)></i></div>',
  'fx-trace-regles':   '<div class="p"><i class="a" *path(circle, duration: 6s, delay: 1s, easing: bounce-out, rotate: true, angle: 90, reverse: true, alternate: true, repeat: 3, start: 0.2, end: 0.8, anchor: top-left, on: hover)></i></div>',
  'fx-trace-droit':    '<div class="p"><i class="a" *path(zigzag, rotate: false, easing: ease-in)></i></div>',
  'fx-trace-defile':   '<div class="p"><i class="a" *path(loop, on: scroll, zone: \'80% 20%\')></i></div>',
  'fx-trace-from':     '<div class="p"><svg class="s"><path id="trace" d="M0 0 L 100 0"></path></svg><i class="a" *path(from: \'#trace\')></i></div>',
  'fx-trace-absent':   '<div class="p"><i class="a" *path(from: \'#nulle-part\')></i></div>',
  'fx-trace-illisible': '<div class="p"><i class="a" *path(\'M zzz\')></i></div>',
  'fx-trace-carte':    '<p class="in">carte</p>',
  'fx-trace-hote':     '<div class="p"><@fx-trace-carte class="a" *path(circle)></@fx-trace-carte></div>',
  'fx-trace-retrait':  '<script>\n$on = true\n</script>\n<div class="p">{if $on}<i class="a" *path(spiral, on: load)></i>{end}</div>\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *path', function () {
  this.timeout(60000)
  let window: any
  // les prototypes de happy-dom (celui de `CSS` compris) sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` et fausse les fichiers suivants du même processus — ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-suivre-un-trace')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    garder(Object.getPrototypeOf(window.CSS), ['supports'])
    // `CSS` rend un objet neuf à chaque lecture : la méthode se remplace sur son prototype
    window.eval('globalThis.__sup = function() { return false }; Object.getPrototypeOf(CSS).supports = function(a, b) { return globalThis.__sup(a, b) }')
  })

  after(async () => {
    for (const [cible, nom, d] of anciens) {
      if (d) Object.defineProperty(cible, nom, d)
      else delete cible[nom]
    }
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // le navigateur joué : avec `offset-path` (et les courbes `linear()`), ou sans
  const navigateur = (offset: boolean) => { window.__sup = (a: string) => offset && /offset-path|animation-timing-function/.test(a) }

  const avis: string[] = []
  let garde: any
  beforeEach(() => {
    avis.length = 0
    garde = window.µ.warn
    window.µ.warn = (...a: any[]) => { avis.push(a.join(' ')) }
  })
  afterEach(() => { window.µ.warn = garde })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  const v = (el: any, k: string) => el.style.getPropertyValue('--mjs-fx-path-' + k)
  const map = (...a: any[]) => window.µ._mjs_fxDefs.path.map(...a)

  it('le tracé tout fait : wave par défaut, posé en variable CSS, en repère 0 0 290 160', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-path-mode'), 'offset')
    assert.ok(v(el, 'd').startsWith('path("M'), v(el, 'd'))
    assert.ok(v(el, 'd').includes('C60 20 100 20 145 80 S230 140 280 60'), v(el, 'd'))
    assert.equal(v(el, 'rot'), 'auto 0deg')
    assert.equal(v(el, 'a'), '0%')
  })

  it('les sept tracés tout faits se lisent, et heart se dessine', async () => {
    const formes = window.µ._mjs_fxDefs.path.shapes
    assert.deepEqual(Object.keys(formes).sort(), ['circle', 'heart', 'infinity', 'loop', 'spiral', 'wave', 'zigzag'])
    for (const [nom, d] of Object.entries(formes)) assert.ok(map(d, 1, 1, 0, 0), nom)
    navigateur(true)
    const comp = await monter('mjs-fx-trace-forme')
    assert.ok(v(comp._shadow.querySelector('.a'), 'd').includes('M145 140'))
  })

  it('SON PROPRE tracé : écrit comme l\'attribut d d\'un <path>, repris tel quel (en pixels depuis le coin du parent)', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-propre')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(v(el, 'd'), 'path("M10 100 C60 20 100 20 145 80 S230 140 280 60")')
  })

  it('le lecteur de tracé : commandes relatives et absolues, échelle et déplacement, drapeaux collés, arc', () => {
    assert.equal(map('M0 0 L 100 50 a 10 5 0 0 1 10 0 h 5 v 5 z', 2, 3, 10, 20), 'M10 20 L210 170 A20 15 0 0 1 230 170 H240 V185 Z')
    assert.equal(map('M0 0 a1 1 0 00 2 0', 1, 1, 0, 0), 'M0 0 A1 1 0 0 0 2 0')
    assert.equal(map('m1 1 2 2 l-1 -1', 1, 1, 0, 0), 'M1 1 L3 3 L2 2', 'M suivi de paires : des L ; relatif depuis le point courant')
    assert.equal(map('M0,0 Q2,2 4,0 T8,0', 1, 1, 0, 0), 'M0 0 Q2 2 4 0 T8 0')
    assert.equal(map('M0 0 L 10 0', -1, 1, 0, 0), 'M0 0 L-10 0')
    assert.equal(map('M0 0 A 5 5 0 0 1 10 0', -1, 1, 0, 0), 'M0 0 A5 5 0 0 0 -10 0', 'un miroir inverse le sens de l\'arc')
    for (const mal of ['', 'M zzz', 'L 1 2', 'M 1', 'M 0 0 L 1', 'M 0 0 X 1 2', 'M 0 0 Z 3']) assert.equal(map(mal, 1, 1, 0, 0), null, JSON.stringify(mal))
  })

  it('un tracé illisible : un avertissement qui le cite (au vouvoiement), aucune variable, la balise ne bouge pas', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-illisible')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(v(el, 'd'), '')
    assert.ok(avis.some((m) => /\*path/.test(m) && /M zzz/.test(m) && /illisible/.test(m)), avis.join('|'))
    assert.ok(avis.every((m) => !/\btu\b|\bton\b|\bta\b/.test(m)))
  })

  it('from : le <path> du composant est lu, sans CTM à l\'écran il est pris tel quel ; un sélecteur absent : avertissement', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-from')
    assert.equal(v(comp._shadow.querySelector('.a'), 'd'), 'path("M0 0 L100 0")')
    const c2 = await monter('mjs-fx-trace-absent')
    assert.equal(v(c2._shadow.querySelector('.a'), 'd'), '')
    assert.ok(avis.some((m) => /\*path/.test(m) && /#nulle-part/.test(m)), avis.join('|'))
  })

  it('chaque réglage est lu : durée, délai, courbe, rotation, décalage, sens, aller-retour, répétitions, portion, ancre', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.style.getPropertyValue('--mjs-path-duration'), '6s')
    assert.equal(el.style.getPropertyValue('--mjs-path-delay'), '1s')
    assert.match(v(el, 'ease'), /^linear\(0, /, 'bounce-out : une courbe de µeasing, échantillonnée')
    assert.equal(v(el, 'rot'), 'reverse 90deg', 'reverse : on remonte le tracé')
    assert.equal(v(el, 'rot2'), 'auto 90deg', 'au retour de l\'aller-retour, la balise se retourne')
    assert.equal(v(el, 'from'), '80%')
    assert.equal(v(el, 'to'), '20%')
    assert.equal(v(el, 'a'), '20%', 'au repos : au point start')
    assert.equal(v(el, 'anchor'), '0% 0%')
    assert.equal(v(el, 'times'), '3')
    assert.equal(el.getAttribute('mjs-fx-path-alt'), '')
    assert.equal(v(el, 'go'), 'none', 'on: hover : à l\'arrêt jusqu\'au survol')
  })

  it('rotate: false : la balise ne tourne pas ; un mot CSS passe tel quel', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-droit')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(v(el, 'rot'), '0deg')
    assert.equal(v(el, 'ease'), 'ease-in')
    assert.equal(el.getAttribute('mjs-fx-path-alt'), null)
  })

  it('on: scroll : l\'animation CSS est coupée, l\'avancée suit le défilement', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-defile')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(v(el, 'go'), 'none')
    assert.equal(v(el, 'times'), '')
  })

  it('le CSS : animation pilotée par des variables, aller-retour en deux temps, mesure du départ, mouvement réduit', () => {
    const css = window.µ._mjs_fxDefs.path.css
    assert.match(css, /offset-path:var\(--mjs-fx-path-d,none\)/)
    assert.match(css, /--mjs-path-duration,4s/)
    assert.match(css, /--mjs-path-delay,0s/)
    assert.match(css, /@keyframes mjs-fx-path\{from\{offset-distance:var\(--mjs-fx-path-from,0%\)\}/)
    assert.match(css, /@keyframes mjs-fx-path-back\{/)
    // la mesure pose la balise au point 0 0 par des déclarations !important, sans couper l'animation (qui repartirait du début)
    assert.match(css, /\[mjs-fx-path-cal\]\{offset-distance:0%!important;offset-rotate:0deg!important\}/)
    assert.doesNotMatch(css, /\[mjs-fx-path-cal\]\{[^}]*animation/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none/)
  })

  it('sans offset-path : la minuterie, un <path> caché, aucune variable de tracé', async () => {
    navigateur(false)
    const comp = await monter('mjs-fx-trace')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-path-mode'), 'js')
    assert.equal(v(el, 'd'), '')
    assert.ok(window.document.body.querySelector('svg[mjs-fx-layer="path-trace"] path'), 'le tracé caché')
    window.µ._mjs_fxClear(el)
    assertAbsent(window.document.body.querySelector('svg[mjs-fx-layer="path-trace"]'), 'tracé caché resté')
  })

  it('un composant : l\'effet se pose sur sa balise', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-hote')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-path-mode'), 'offset')
    assert.ok(v(el, 'd').startsWith('path("M30 80'), v(el, 'd'))
  })

  it('repeat: -1, start: 2, end: -1, angle: 999, on: drag, durée illisible, réglage inconnu : refusés à la compilation', async () => {
    await assert.rejects(compiler('<i *path(repeat: -1)></i>'), /\*path : repeat = -1 — permis : int 0\.\.1000/)
    await assert.rejects(compiler('<i *path(start: 2)></i>'), /\*path : start = 2/)
    await assert.rejects(compiler('<i *path(end: -1)></i>'), /\*path : end = -1/)
    await assert.rejects(compiler('<i *path(angle: 999)></i>'), /\*path : angle = 999/)
    await assert.rejects(compiler('<i *path(on: drag)></i>'), /\*path/)
    await assert.rejects(compiler('<i *path(duration: soon)></i>'), /\*path/)
    await assert.rejects(compiler('<i *path(foo: 1)></i>'), /foo/)
    await compiler('<i *path(wave, from: \'#t\', viewbox: \'0 0 290 160\', duration: 2s, delay: 1s, easing: cubic-bezier(.2, .8, .2, 1), rotate: true, angle: 90, reverse: true, alternate: true, repeat: 2, start: 0.1, end: 0.9, anchor: center, on: scroll, zone: \'80% 20%\')></i>')
  })

  it('le retrait de l\'effet défait tout : marques, variables, mesure', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-trace-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(v(el, 'd'))
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.getAttribute('mjs-fx-path-mode'), null)
    assert.equal(el.getAttribute('style') || '', '')
  })
})
