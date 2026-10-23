// *liquid par carreaux, sous la souris (cells, radius, ghost) : la logique, avec un faux WebGL — la toile ne se
// pose qu'à l'entrée de la souris et part avec la force, les uniformes suivent les réglages et la souris, chaque image recouvre toute la toile (le tampon de dessin n'est pas conservé), rien ne tourne au repos (avec ou sans radius : rest ne vaut que pour l'effet lisse), les replis
// (balise qui n'est pas une image, image d'une autre origine, pas de WebGL, image refusée par la texture, plafond de
// programmes atteint) rendent la déformation lisse d'avant, le retrait ne laisse rien (ni toile, ni écouteur).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { EFFECTS } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const IMG = 'src="a.png" alt="a"'
const COMPOSANTS: Record<string, string> = {
  'fx-carreaux':          `<img class="a" *liquid(60, cells: 64, radius: 220) ${IMG}>`,
  'fx-carreaux-defaut':   `<img class="a" *liquid(60) ${IMG}>`,
  'fx-carreaux-fixe':     `<img class="a" *liquid(60, cells: 32, radius: 150, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-zone':     `<img class="a" *liquid(60, cells: 16, radius: 20, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-fantome':  `<img class="a" *liquid(40, cells: 48, radius: 260, ghost: #f00, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-lisse':    `<img class="a" *liquid(30, radius: 200, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-toujours': `<img class="a" *liquid(30, radius: 200, animate: false, duration: 0ms, on: always) ${IMG}>`,
  'fx-carreaux-entier':   `<img class="a" *liquid(60, cells: 32, rest: 0.5, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-div':      '<div class="a" *liquid(60, cells: 64, radius: 220)>x</div>',
  'fx-carreaux-autre':    '<img class="a" *liquid(60, cells: 64, radius: 220) src="http://autre.test/a.png" alt="a">',
  'fx-carreaux-divs':     '<div class="a" *liquid(60, cells: 64, radius: 220)>x</div>\n<div class="a" *liquid(60, cells: 32)>y</div>',
  'fx-carreaux-autres':   '<img class="a" *liquid(60, cells: 64, radius: 220) src="http://autre.test/a.png" alt="a">\n<img class="a" *liquid(60, cells: 32, radius: 100) src="http://autre.test/b.png" alt="b">',
  'fx-carreaux-lisses':   `<img class="a" *liquid(30) ${IMG}>\n<div class="a" *liquid(30)>x</div>`,
  'fx-carreaux-res':      `<img class="a" *liquid(60, cells: 32, radius: 150, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-res1':     `<img class="a" *liquid(60, cells: 32, radius: 150, resolution: 1, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-res4':     `<img class="a" *liquid(60, cells: 32, radius: 150, resolution: 4, animate: false, duration: 0ms) ${IMG}>`,
  'fx-carreaux-cors':     '<img class="a" *liquid(60, cells: 64, radius: 220) crossorigin="anonymous" src="http://autre.test/a.png" alt="a">',
  'fx-carreaux-plafond':  Array.from({ length: 10 }, () => `<img class="a" *liquid(60, cells: 16, animate: false, duration: 0ms, on: always) ${IMG}>`).join('\n'),
  'fx-carreaux-retrait':  `<script>\n$on = true\n</script>\n{if $on}<img class="a" *liquid(60, cells: 64, radius: 220) ${IMG}>{end}\n<button class="t" @click={$on = !$on}>t</button>`
}

// happy-dom partage les prototypes DOM entre toutes ses fenêtres : ce que ces tests y posent (boîtes, image chargée, faux WebGL, suivi des
// écouteurs) est rendu à la fin de chaque test, pour ne rien laisser aux fichiers qui tournent après
const PROTOS: Array<[string, string[]]> = [['Element', ['getBoundingClientRect', 'addEventListener', 'removeEventListener']], ['HTMLImageElement', ['complete', 'naturalWidth', 'naturalHeight']], ['HTMLCanvasElement', ['getContext']]]
const ORIGINES: Array<[any, string, PropertyDescriptor | undefined]> = (() => {
  const w: any = new Window({ url: 'http://localhost/' })
  const liste: Array<[any, string, PropertyDescriptor | undefined]> = []
  for (const [classe, noms] of PROTOS) for (const nom of noms) liste.push([w[classe].prototype, nom, Object.getOwnPropertyDescriptor(w[classe].prototype, nom)])
  w.close?.()
  return liste
})()
const rendre = () => {
  for (const [proto, nom, d] of ORIGINES) {
    if (d) Object.defineProperty(proto, nom, d)
    else delete proto[nom]
  }
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

// ce que le faux WebGL a vu : contextes, textures, images peintes, uniformes, zone repeinte
type Journal = { contextes: number, textures: number, draws: number, perdus: number, u: Record<string, any>, scissor: number[], attrs: any, refuse: boolean, sans: boolean }

function fauxGL(j: Journal) {
  const base: any = {
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, bindAttribLocation() {}, linkProgram() {}, getProgramParameter: () => true, useProgram() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, enable() {},
    createTexture: () => ({}), activeTexture() {}, bindTexture() {}, texParameteri() {}, pixelStorei() {},
    getUniformLocation: (_p: any, nom: string) => ({ nom }),
    uniform1i() {},
    uniform1f(l: any, v: number) { j.u[l.nom] = v },
    uniform2f(l: any, a: number, b: number) { j.u[l.nom] = [a, b] },
    uniform4f(l: any, a: number, b: number, c: number, d: number) { j.u[l.nom] = [a, b, c, d] },
    viewport() {},
    scissor(...a: number[]) { j.scissor = a },
    // seule une image de la page (6 arguments) peut être refusée ; le hasard (9 arguments, des octets) passe toujours
    texImage2D(...a: any[]) {
      j.textures++
      if (j.refuse && a.length === 6) throw new Error('SecurityError')
    },
    drawArrays() { j.draws++ },
    getExtension: (n: string) => n === 'WEBGL_lose_context' ? { loseContext() { j.perdus++ } } : null
  }
  return new Proxy(base, { get: (t, k: any) => k in t ? t[k] : typeof k === 'string' && /^[A-Z][A-Z0-9_]*$/.test(k) ? 1 : undefined })
}

// une toile 2D de pacotille : une couleur lue, une image « dessinée »
function faux2D() {
  const c: any = { imageSmoothingQuality: '', drawImage() {}, clearRect() {}, fillRect() {}, _c: '#000000' }
  Object.defineProperty(c, 'fillStyle', {
    get() { return this._c },
    set(v: string) {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
      if (m) this._c = '#' + (m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1]).toLowerCase()
    }
  })
  c.getImageData = () => ({ data: [parseInt(c._c.slice(1, 3), 16), parseInt(c._c.slice(3, 5), 16), parseInt(c._c.slice(5, 7), 16), 255] })
  return c
}

describe('effets — *liquid par carreaux, sous la souris', function () {
  this.timeout(60000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('effets-liquide-carreaux')
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
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  afterEach(rendre)

  after(async () => {
    rendre()
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // une fenêtre neuve (l'état du module d'effet est à elle) : image de 200 × 100 à (40, 30), WebGL fautif ou non
  function fenetre(opts: { sans?: boolean, calme?: boolean } = {}) {
    const window: any = new Window({ url: 'http://localhost/' })
    const j: Journal = { contextes: 0, textures: 0, draws: 0, perdus: 0, u: {}, scissor: [], attrs: null, refuse: false, sans: !!opts.sans }
    // les écouteurs vivants par cible et par type, les minuteries demandées (délai, fonction), les avertissements de la console
    const vivants = new Map<any, Map<string, Set<any>>>()
    const suivre = (cible: any) => {
      const add = cible.addEventListener
      const rem = cible.removeEventListener
      cible.addEventListener = function (this: any, type: string, f: any, o?: any) {
        if (!vivants.has(this)) vivants.set(this, new Map())
        const par = vivants.get(this)!
        if (!par.has(type)) par.set(type, new Set())
        par.get(type)!.add(f)
        return add.call(this, type, f, o)
      }
      cible.removeEventListener = function (this: any, type: string, f: any, o?: any) {
        vivants.get(this)?.get(type)?.delete(f)
        return rem.call(this, type, f, o)
      }
    }
    suivre(window.document)
    suivre(window.Element.prototype)
    const ecoute = (cible: any, type: string) => vivants.get(cible)?.get(type)?.size ?? 0
    const minuteries: Array<[number, any]> = []
    const st = window.setTimeout.bind(window)
    window.setTimeout = (f: any, ms?: number, ...a: any[]) => { minuteries.push([ms ?? 0, f]); return st(f, ms, ...a) }
    const avis: string[] = []
    Object.defineProperty(window, 'console', { value: { ...console, warn: (...a: any[]) => { avis.push(a.join(' ')) } }, configurable: true })
    const GC = window.HTMLCanvasElement.prototype
    GC.getContext = function (this: any, kind: string, attrs?: any) {
      if (kind === '2d') return this._2d || (this._2d = faux2D())
      if (kind !== 'webgl') return null
      if (j.sans) return null
      if (!this._gl) {
        j.contextes++
        j.attrs = attrs
        this._gl = fauxGL(j)
      }
      return this._gl
    }
    window.Element.prototype.getBoundingClientRect = function (this: any) {
      const img = this.localName === 'img'
      return img ? { left: 40, top: 30, right: 240, bottom: 130, width: 200, height: 100, x: 40, y: 30 } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
    }
    Object.defineProperty(window.HTMLImageElement.prototype, 'complete', { configurable: true, get() { return window.__prete !== false } })
    Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get() { return 200 } })
    Object.defineProperty(window.HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get() { return 100 } })
    if (opts.calme) window.matchMedia = (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.__j = j
    fenetres.push(window)
    return { window, j, ecoute, minuteries, avis }
  }

  async function monter(window: any, tag: string, sel = '.a') {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp
  }

  const toile = (comp: any) => comp._shadow.querySelector('canvas[mjs-fx-layer="liquid"]')
  const lisse = (comp: any) => comp._shadow.querySelector('svg[mjs-fx-liquid-svg]')
  const marques = (el: any) => el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-liquid'))
  const evt = (window: any, type: string, x?: number, y?: number) => {
    const e = new window.Event(type)
    if (x !== undefined) {
      Object.defineProperty(e, 'offsetX', { value: x })
      Object.defineProperty(e, 'offsetY', { value: y })
    }
    return e
  }
  const entre = (window: any, el: any, x = 100, y = 50) => el.dispatchEvent(evt(window, 'pointerenter', x, y))

  it('le catalogue : cells (int 0..200, 0), radius (int 0..2000, 0), ghost (couleur) ; les trois refus de compilation', async () => {
    const s = EFFECTS.liquid.settings
    assert.deepEqual([s.cells.rule, s.cells.dflt, s.radius.rule, s.radius.dflt, s.ghost.rule, s.ghost.dflt], ['int 0..200', 0, 'int 0..2000', 0, 'color', undefined])
    await assert.rejects(compiler('<img *liquid(cells: 300)>'), /\*liquid : cells = 300 — permis : int 0\.\.200/)
    await assert.rejects(compiler('<img *liquid(radius: 3000)>'), /\*liquid : radius = 3000 — permis : int 0\.\.2000/)
    await assert.rejects(compiler('<img *liquid(cells: -1)>'), /\*liquid : cells/)
    assert.deepEqual([s.resolution.rule, s.resolution.dflt], ['float 0.5..4', 1.5])
    await assert.rejects(compiler('<img *liquid(cells: 8, resolution: 5)>'), /\*liquid : resolution = 5 — permis : float 0\.5\.\.4/)
    await assert.rejects(compiler('<img *liquid(cells: 8, resolution: 0.1)>'), /\*liquid : resolution/)
    await compiler('<img *liquid(60, cells: 200, radius: 2000, ghost: #f00)>')
    await compiler('<img *liquid(60, cells: 64, ghost: rgba(255, 0, 0, .5))>')
  })

  it('sans les nouveaux réglages : le filtre SVG d\'avant, jamais de WebGL', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-defaut')
    assert.ok(lisse(comp), 'le filtre SVG')
    assertAbsent(toile(comp), 'aucune toile')
    assert.equal(j.contextes, 0)
    assert.ok(comp._shadow.querySelector('.a').hasAttribute('mjs-fx-liquid-on'))
  })

  it('au repos : rien — ni toile, ni filtre, ni contexte WebGL, ni marque sur l\'image', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    assertAbsent(toile(comp), 'toile au repos')
    assertAbsent(lisse(comp), 'filtre au repos')
    assert.equal(j.contextes, 0)
    assert.equal(j.draws, 0)
    assert.deepEqual(marques(el), [])
  })

  it('à l\'entrée de la souris : la toile se pose à côté de l\'image, à la taille de sa boîte, l\'image passe à opacité 0 (marque) ; les uniformes disent les réglages', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp) && j.draws > 2)
    const cv = toile(comp)
    assert.ok(cv, 'la toile')
    assert.ok(el.nextSibling === cv, 'à côté de l\'image, dans le même parent')
    assert.equal(cv.getAttribute('aria-hidden'), 'true')
    assert.equal(cv.style.getPropertyValue('--mjs-fx-liquid-w'), '200px')
    assert.equal(cv.style.getPropertyValue('--mjs-fx-liquid-h'), '100px')
    // la toile tombe sur la boîte de l'image : (40, 30) moins l'origine du bloc (0, 0) ici
    assert.equal(cv.style.getPropertyValue('--mjs-fx-liquid-x'), '40px')
    assert.equal(cv.style.getPropertyValue('--mjs-fx-liquid-y'), '30px')
    assert.equal(cv.width, 200)
    assert.equal(cv.height, 100)
    assert.ok(el.hasAttribute('mjs-fx-liquid-view'), 'image cachée par la marque (opacité 0 dans la feuille)')
    assert.equal(j.contextes, 1)
    assert.equal(j.textures, 2, 'le hasard et l\'image, une fois chacun')
    assert.equal(j.u.uCells, 64)
    assert.equal(j.u.uRadius, 220)
    assert.deepEqual(j.u.uSize, [200, 100])
    assert.deepEqual(j.u.uGhost, [0, 0, 0, 0])
    assert.equal(j.u.uOct, 2)
    assert.ok(Math.abs(j.u.uFreq - 0.015) < 1e-9)
    assert.deepEqual(j.u.uMouse, [100, 50])
    assertAbsent(lisse(comp), 'pas de filtre SVG en même temps')
    await attendre(() => j.u.uAmp > 40)
    assert.ok(j.u.uAmp > 40 && j.u.uAmp <= 60, `ampleur : ${j.u.uAmp}`)
  })

  it('la souris qui bouge : le point suit (offsetX, offsetY) ; elle sort : la force s\'éteint, la toile part, l\'image reprend ses marques', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp))
    el.dispatchEvent(evt(window, 'pointermove', 30, 20))
    await attendre(() => j.u.uMouse[0] === 30)
    assert.deepEqual(j.u.uMouse, [30, 20])
    el.dispatchEvent(evt(window, 'pointerleave'))
    await attendre(() => !toile(comp), 4000)
    assertAbsent(toile(comp), 'toile restée')
    assert.deepEqual(marques(el), [], 'marques restées')
    // plus rien ne tourne
    const n = j.draws
    await pause(120)
    assert.equal(j.draws, n, 'des images ont encore été peintes après l\'extinction')
  })

  it('animate: false, souris immobile : aucune image peinte ; un mouvement de la souris : une image', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-fixe')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp) && j.u.uAmp === 60)
    await pause(60)
    const n = j.draws
    await pause(150)
    assert.equal(j.draws, n, 'la boucle tourne alors que rien ne bouge')
    el.dispatchEvent(evt(window, 'pointermove', 70, 40))
    await attendre(() => j.draws > n)
    await pause(60)
    const m = j.draws
    assert.ok(m > n && m <= n + 2, `images : ${n} → ${m}`)
    await pause(100)
    assert.equal(j.draws, m)
  })

  it('animate (le défaut) : tant que la force est là, les vagues bougent — l\'allure vient de l\'horloge, seule', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp))
    const a = j.u.uPhase
    await pause(120)
    assert.notEqual(j.u.uPhase, a, 'la phase ne bouge pas')
  })

  it('le tampon de dessin n\'est pas conservé, donc chaque image recouvre toute la toile : un seul dessin par image, aucun ciseau, même quand la souris bouge', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-zone')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp) && j.u.uAmp === 60)
    assert.notEqual(j.attrs?.preserveDrawingBuffer, true, 'le contexte ne conserve pas son tampon de dessin (le navigateur le recopierait à chaque image)')
    // la souris se déplace : un dessin de plus par image, le programme reçoit le nouveau point, rien n'est rogné
    const avant = j.draws
    el.dispatchEvent(evt(window, 'pointermove', 100, 50))
    await attendre(() => j.draws > avant)
    el.dispatchEvent(evt(window, 'pointermove', 120, 50))
    await attendre(() => j.draws > avant + 1)
    assert.deepEqual(j.u.uMouse, [120, 50], 'la souris dans l\'uniforme')
    assert.deepEqual(j.scissor, [], 'aucun ciseau : une zone partielle laisserait le reste de la toile vide')
  })

  it('ghost : la couleur part dans l\'uniforme ; sans lui, une force nulle', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-fantome')
    entre(window, comp._shadow.querySelector('.a'), 100, 50)
    await attendre(() => !!toile(comp))
    assert.deepEqual(j.u.uGhost, [1, 0, 0, 1])
    assert.equal(j.u.uCells, 48)
    assert.equal(j.u.uRadius, 260)
  })

  it('radius seul : une onde lisse (uCells à 0) sous la souris', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-lisse')
    entre(window, comp._shadow.querySelector('.a'), 100, 50)
    await attendre(() => !!toile(comp))
    assert.equal(j.u.uCells, 0)
    assert.equal(j.u.uRadius, 200)
  })

  it('cells sans radius : rien au repos (rest ne vaut que pour l\'effet lisse) ; à l\'entrée de la souris, toute l\'image est la zone, de toute la force', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-entier')
    const el   = comp._shadow.querySelector('.a')
    await pause(80)
    assertAbsent(toile(comp), 'toile au repos : la force de repos ne compte pas sur cette voie')
    assert.equal(j.contextes, 0)
    assert.equal(j.draws, 0)
    assert.deepEqual(marques(el), [])
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp) && j.u.uAmp === 60)
    assert.equal(j.u.uAmp, 60, 'toute la force (strength), pas la moitié que donnerait rest')
    assert.equal(j.u.uRadius, 0)
    const n = j.draws
    await pause(100)
    assert.equal(j.draws, n, 'animate: false, souris immobile : plus aucune image')
    el.dispatchEvent(evt(window, 'pointerleave'))
    await attendre(() => !toile(comp))
    assertAbsent(toile(comp), 'toile restée après la sortie')
    assert.equal(j.draws, n, 'des images peintes à l\'extinction')
  })

  it('on: always avec radius : rien tant que la souris n\'est pas sur l\'image', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-toujours')
    const el   = comp._shadow.querySelector('.a')
    await pause(80)
    assertAbsent(toile(comp), 'toile sans souris')
    assert.equal(j.contextes, 0)
    entre(window, el, 60, 40)
    await attendre(() => !!toile(comp))
    assert.ok(toile(comp))
  })

  it('repli : une balise qui n\'est pas une image garde le filtre SVG d\'avant', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-div')
    assert.ok(lisse(comp), 'le filtre SVG')
    assert.equal(j.contextes, 0)
    assertAbsent(toile(comp), 'toile sur une balise')
  })

  it('repli : une image d\'une autre origine, sans crossorigin, garde le filtre SVG d\'avant, sans ouvrir WebGL ; avec crossorigin, elle a la toile', async () => {
    const a = fenetre()
    const compA = await monter(a.window, 'mjs-fx-carreaux-autre')
    assert.ok(lisse(compA), 'le filtre SVG')
    assert.equal(a.j.contextes, 0)
    entre(a.window, compA._shadow.querySelector('.a'))
    await pause(60)
    assertAbsent(toile(compA), 'toile sur une image illisible')
    const b = fenetre()
    const compB = await monter(b.window, 'mjs-fx-carreaux-cors')
    assertAbsent(lisse(compB), 'pas de filtre SVG')
    entre(b.window, compB._shadow.querySelector('.a'))
    await attendre(() => !!toile(compB))
    assert.ok(toile(compB), 'la toile')
  })

  it('repli : pas de WebGL dans le navigateur — à la première entrée, le filtre SVG d\'avant prend la place et garde l\'état actif ; l\'image suivante part directement lisse', async () => {
    const { window, j } = fenetre({ sans: true })
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    assertAbsent(lisse(comp), 'rien avant l\'entrée')
    entre(window, el)
    await attendre(() => !!lisse(comp))
    assert.ok(lisse(comp), 'le filtre SVG d\'avant')
    assertAbsent(toile(comp), 'pas de toile')
    // l'état actif est passé à l'effet lisse : la force monte au-delà du repos (4,8 px)
    await attendre(() => el.hasAttribute('mjs-fx-liquid-on'))
    await attendre(() => parseFloat(lisse(comp).querySelector('feDisplacementMap').getAttribute('scale')) > 50)
    assert.deepEqual(marques(el).filter((m: string) => m === 'mjs-fx-liquid-view'), [])
    const comp2 = await monter(window, 'mjs-fx-carreaux-lisse')
    assert.ok(lisse(comp2), 'la seconde image part directement lisse (WebGL déjà reconnu absent)')
    assert.equal(j.contextes, 0)
  })

  it('repli : la texture refuse l\'image (autre origine non annoncée) — la toile repart, l\'image redevient visible, le filtre SVG prend la place', async () => {
    const { window, j } = fenetre()
    j.refuse = true
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el)
    await attendre(() => !!lisse(comp))
    assert.ok(lisse(comp), 'le filtre SVG d\'avant')
    assertAbsent(toile(comp), 'toile restée')
    assert.ok(!el.hasAttribute('mjs-fx-liquid-view'), 'image restée cachée')
  })

  it('une image pas encore chargée : rien ne se pose avant son chargement ; chargée, la souris la déforme', async () => {
    const { window, j } = fenetre()
    window.__prete = false
    const comp = await monter(window, 'mjs-fx-carreaux')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el)
    await pause(80)
    assertAbsent(toile(comp), 'toile avant le chargement')
    assert.equal(j.contextes, 0)
    window.__prete = true
    el.dispatchEvent(new window.Event('load'))
    await attendre(() => !!toile(comp))
    assert.ok(toile(comp), 'la toile après le chargement')
  })

  it('off.set suit les réglages sans reposer l\'effet ; ce qui ne laisserait plus rien de la déformation par carreaux le repose', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-fixe')
    const el   = comp._shadow.querySelector('.a')
    const hot  = (k: string, v: any) => el._mjs_fxOff.liquid._hot(k, v)
    entre(window, el, 100, 50)
    await attendre(() => !!toile(comp) && j.u.uAmp === 60)
    assert.equal(hot('radius', 90), undefined)
    el.dispatchEvent(evt(window, 'pointermove', 90, 50))
    await attendre(() => j.u.uRadius === 90)
    assert.equal(j.u.uRadius, 90)
    assert.equal(hot('cells', 10), undefined)
    assert.equal(hot('ghost', '#00f'), undefined)
    el.dispatchEvent(evt(window, 'pointermove', 91, 50))
    await attendre(() => j.u.uCells === 10)
    assert.equal(j.u.uCells, 10)
    assert.deepEqual(j.u.uGhost, [0, 0, 1, 1])
    assert.equal(hot('strength', 20), undefined)
    await attendre(() => j.u.uAmp === 20)
    assert.equal(j.u.uAmp, 20)
    assert.equal(hot('frequency', 0.1), undefined)
    el.dispatchEvent(evt(window, 'pointermove', 92, 50))
    await attendre(() => Math.abs(j.u.uFreq - 0.1) < 1e-9)
    assert.equal(hot('ghost', undefined), undefined, 'la couleur retirée : le fantôme part, la déformation reste')
    assert.equal(hot('octaves', 3), false, 'les couches de vagues reposent l\'effet')
    assert.equal(hot('on', 'always'), false, 'le déclencheur repose l\'effet')
    assert.equal(hot('cells', 0), undefined, 'radius 90 reste : une onde lisse sous la souris')
    assert.equal(hot('radius', 0), false, 'ni carreaux, ni zone, ni fantôme : l\'effet lisse repose')
  })

  it('le retrait ({if} refermé) pendant la déformation : ni toile, ni marque, ni filtre ; la toile est rendue', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-retrait')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el)
    await attendre(() => !!toile(comp))
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(toile(comp), 'toile restée')
    assertAbsent(lisse(comp), 'filtre resté')
    assert.deepEqual(marques(el), [], 'marques restées')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    const n = j.draws
    await pause(100)
    assert.equal(j.draws, n, 'des images ont été peintes après le retrait')
  })

  it('un programme au repos est repris à l\'entrée suivante, sans recompiler (un seul contexte pour deux passages)', async () => {
    const { window, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-fixe')
    const el   = comp._shadow.querySelector('.a')
    for (let i = 0; i < 2; i++) {
      entre(window, el)
      await attendre(() => !!toile(comp))
      el.dispatchEvent(evt(window, 'pointerleave'))
      await attendre(() => !toile(comp))
    }
    assert.equal(j.contextes, 1)
  })

  it('« réduire les animations » : avec ou sans radius, rien ne se déforme — ni toile, ni contexte, ni image', async () => {
    const { window, j } = fenetre({ calme: true })
    const comp = await monter(window, 'mjs-fx-carreaux')
    entre(window, comp._shadow.querySelector('.a'))
    await pause(100)
    assertAbsent(toile(comp), 'toile sous « réduire les animations »')
    const e = await monter(window, 'mjs-fx-carreaux-entier')
    entre(window, e._shadow.querySelector('.a'))
    await pause(100)
    assertAbsent(toile(e), 'toile sans radius sous « réduire les animations »')
    assert.equal(j.contextes, 0)
    assert.equal(j.draws, 0)
  })

  it('le retrait ({if} refermé) rend les écouteurs : ceux de la souris et du chargement sur l\'image, celui de la visibilité de l\'onglet sur le document', async () => {
    const { window, ecoute } = fenetre()
    const avant = ecoute(window.document, 'visibilitychange')
    const comp  = await monter(window, 'mjs-fx-carreaux-retrait')
    const el    = comp._shadow.querySelector('.a')
    const types = ['pointerenter', 'pointermove', 'pointerleave', 'load']
    assert.equal(ecoute(window.document, 'visibilitychange'), avant + 1, 'la visibilité de l\'onglet est suivie')
    for (const t of types) assert.ok(ecoute(el, t) > 0, `${t} n'est pas écouté`)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(ecoute(window.document, 'visibilitychange'), avant, 'l\'écouteur de la visibilité est resté sur le document')
    for (const t of types) assert.equal(ecoute(el, t), 0, `l'écouteur ${t} est resté sur l'image retirée`)
  })

  it('on: always avec radius : la souris qui sort éteint la déformation (le déclencheur reste actif, mais la zone suit la souris)', async () => {
    const { window } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-toujours')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el, 60, 40)
    await attendre(() => !!toile(comp))
    assert.ok(toile(comp), 'la toile sous la souris')
    el.dispatchEvent(evt(window, 'pointerleave'))
    await attendre(() => !toile(comp), 4000)
    assertAbsent(toile(comp), 'la souris est sortie : la toile reste')
    assert.deepEqual(marques(el), [], 'marques restées')
  })

  it('le plafond de programmes : dix images actives ensemble (on: always) — huit programmes, les deux autres prennent l\'effet lisse d\'avant, un seul avertissement, aucune image nue', async () => {
    const { window, j, avis } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-plafond')
    await attendre(() => comp._shadow.querySelectorAll('svg[mjs-fx-liquid-svg]').length >= 2)
    await pause(80)
    const toiles = comp._shadow.querySelectorAll('canvas[mjs-fx-layer="liquid"]').length
    const lisses = comp._shadow.querySelectorAll('svg[mjs-fx-liquid-svg]').length
    assert.deepEqual([toiles, lisses, j.contextes], [8, 2, 8], 'huit toiles, deux filtres lisses, huit contextes')
    const nues = [...comp._shadow.querySelectorAll('.a')].filter((i: any) => !i.hasAttribute('mjs-fx-liquid-view') && !i.hasAttribute('mjs-fx-liquid-on'))
    assert.equal(nues.length, 0, 'une image reste nue : ni sous une toile, ni sous le filtre')
    const dits = avis.filter((a) => /\*liquid/.test(a))
    assert.equal(dits.length, 1, `un seul avertissement : ${JSON.stringify(dits)}`)
  })

  it('repli, balise qui n\'est pas une image : un seul avertissement par page (pas un par balise), qui dit la cause et le remède', async () => {
    const { window, avis } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-divs')
    await pause(60)
    assert.equal(comp._shadow.querySelectorAll('svg[mjs-fx-liquid-svg]').length, 2, 'les deux balises ont le filtre lisse')
    const dits = avis.filter((a) => /\*liquid/.test(a))
    assert.equal(dits.length, 1, `un seul avertissement pour deux balises : ${JSON.stringify(dits)}`)
    assert.match(dits[0], /<img>/, 'la cause : une balise qui n\'est pas une <img>')
    assert.match(dits[0], /lisse/, 'ce qui arrive : la déformation lisse')
    assert.match(dits[0], /posez/, 'le remède, au vouvoiement')
    await monter(window, 'mjs-fx-carreaux-divs')
    await pause(60)
    assert.equal(avis.filter((a) => /\*liquid/.test(a)).length, 1, 'ni une seconde fois : une fois par page')
  })

  it('repli, image d\'un autre site sans crossorigin : un seul avertissement par page pour deux images, qui dit la cause et le remède', async () => {
    const { window, avis, j } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-autres')
    await pause(60)
    entre(window, comp._shadow.querySelector('.a'))
    await pause(60)
    assert.equal(j.contextes, 0, 'WebGL n\'est pas ouvert')
    const dits = avis.filter((a) => /\*liquid/.test(a))
    assert.equal(dits.length, 1, `un seul avertissement pour deux images : ${JSON.stringify(dits)}`)
    assert.match(dits[0], /crossorigin/, 'le remède nomme l\'attribut')
    assert.match(dits[0], /autre site/, 'la cause : une image d\'un autre site')
    assert.match(dits[0], /ajoutez/, 'au vouvoiement')
  })

  it('repli, la texture refuse l\'image : l\'avertissement de l\'autre site paraît une fois', async () => {
    const { window, j, avis } = fenetre()
    j.refuse = true
    const comp = await monter(window, 'mjs-fx-carreaux')
    entre(window, comp._shadow.querySelector('.a'))
    await attendre(() => !!lisse(comp))
    const dits = avis.filter((a) => /\*liquid/.test(a))
    assert.equal(dits.length, 1, JSON.stringify(dits))
    assert.match(dits[0], /crossorigin/)
  })

  it('repli, navigateur sans WebGL : un seul avertissement par page, qui dit la cause et le remède, même avec deux images', async () => {
    const { window, avis } = fenetre({ sans: true })
    const comp = await monter(window, 'mjs-fx-carreaux')
    entre(window, comp._shadow.querySelector('.a'))
    await attendre(() => !!lisse(comp))
    await monter(window, 'mjs-fx-carreaux-lisse')
    await pause(60)
    const dits = avis.filter((a) => /\*liquid/.test(a))
    assert.equal(dits.length, 1, `un seul avertissement : ${JSON.stringify(dits)}`)
    assert.match(dits[0], /WebGL/, 'la cause')
    assert.match(dits[0], /activez/, 'le remède, au vouvoiement')
  })

  it('aucun avertissement quand rien ne manque : l\'effet lisse choisi (sans cells, radius ni ghost) et la déformation par carreaux qui marche se taisent', async () => {
    const a = fenetre()
    await monter(a.window, 'mjs-fx-carreaux-lisses')
    await pause(60)
    assert.deepEqual(a.avis.filter((x) => /\*liquid/.test(x)), [], 'lisse voulu, y compris sur une balise')
    const b = fenetre()
    const comp = await monter(b.window, 'mjs-fx-carreaux')
    entre(b.window, comp._shadow.querySelector('.a'))
    await attendre(() => !!toile(comp))
    await pause(60)
    assert.deepEqual(b.avis.filter((x) => /\*liquid/.test(x)), [], 'la toile marche')
  })

  it('resolution : la toile ne dépasse pas resolution fois la taille CSS (1,5 par défaut) sur un écran très fin, ni la densité de l\'écran', async () => {
    const taille = async (tag: string, dpr: number) => {
      const { window } = fenetre()
      window.devicePixelRatio = dpr
      const comp = await monter(window, tag)
      entre(window, comp._shadow.querySelector('.a'))
      await attendre(() => !!toile(comp))
      const cv = toile(comp)
      return [cv.width, cv.height]
    }
    assert.deepEqual(await taille('mjs-fx-carreaux-res', 2), [300, 150], 'défaut : 1,5 × (200 × 100)')
    assert.deepEqual(await taille('mjs-fx-carreaux-res', 1), [200, 100], 'densité 1 : la densité de l\'écran borne aussi')
    assert.deepEqual(await taille('mjs-fx-carreaux-res1', 2), [200, 100], 'resolution: 1')
    assert.deepEqual(await taille('mjs-fx-carreaux-res4', 2), [400, 200], 'resolution: 4 : plafonnée par la densité de l\'écran (2)')
    assert.deepEqual(await taille('mjs-fx-carreaux-res4', 3), [600, 300], 'densité 3, resolution: 4')
  })

  it('resolution : off.set la change en cours de déformation, la toile est reposée à la nouvelle taille', async () => {
    const { window, j } = fenetre()
    window.devicePixelRatio = 2
    const comp = await monter(window, 'mjs-fx-carreaux-res')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el)
    await attendre(() => !!toile(comp) && j.draws > 0)
    assert.equal(toile(comp).width, 300)
    assert.equal(el._mjs_fxOff.liquid._hot('resolution', 1), undefined, 'la toile est reposée sur place')
    await attendre(() => toile(comp)?.width === 200)
    assert.equal(toile(comp).width, 200)
    assert.equal(toile(comp).height, 100)
  })

  it('un programme libéré ne garde qu\'un pixel de toile, même si elle a grandi pendant qu\'il attendait en réserve', async () => {
    const { window, j, minuteries } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-fixe')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el)
    await attendre(() => !!toile(comp))
    const cv = toile(comp)
    assert.ok(cv.width > 1 && cv.height > 1, `pendant la déformation, la toile a la taille de l'image (${cv.width} × ${cv.height})`)
    const avant = minuteries.length
    el.dispatchEvent(evt(window, 'pointerleave'))
    await attendre(() => !toile(comp))
    assert.deepEqual([cv.width, cv.height], [1, 1], 'en réserve, la toile ne garde qu\'un pixel')
    // la toile qui attend en réserve est agrandie (par quiconque) ; la libération la ramène à un pixel
    cv.width  = 160
    cv.height = 90
    const reserve = minuteries.slice(avant).filter(([ms]) => ms >= 1000)
    assert.ok(reserve.length > 0, 'la réserve arme une minuterie')
    reserve[reserve.length - 1][1]()
    assert.equal(j.perdus, 1, 'le programme est libéré')
    assert.deepEqual([cv.width, cv.height], [1, 1], 'libéré, il ne retient plus la mémoire graphique de sa toile')
  })

  it('un programme rendu à la réserve est libéré après un moment sans emploi (quelques secondes), et le suivant en compile un neuf', async () => {
    const { window, j, minuteries } = fenetre()
    const comp = await monter(window, 'mjs-fx-carreaux-fixe')
    const el   = comp._shadow.querySelector('.a')
    entre(window, el)
    await attendre(() => !!toile(comp))
    const avant = minuteries.length
    el.dispatchEvent(evt(window, 'pointerleave'))
    await attendre(() => !toile(comp))
    const reserve = minuteries.slice(avant).filter(([ms]) => ms >= 1000)
    assert.ok(reserve.length > 0, 'la réserve arme une minuterie')
    const [ms, liberer] = reserve[reserve.length - 1]
    assert.ok(ms >= 2000 && ms <= 20000, `délai de la réserve : ${ms} ms`)
    assert.equal(j.perdus, 0, 'le programme est gardé en réserve')
    liberer()
    assert.equal(j.perdus, 1, 'libéré quand la minuterie sonne')
    entre(window, el)
    await attendre(() => !!toile(comp))
    assert.equal(j.contextes, 2, 'le suivant compile un programme neuf')
  })
})
