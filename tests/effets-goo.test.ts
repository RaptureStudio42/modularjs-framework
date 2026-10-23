// *goo(merge, pointer) — une variante d'effet existant, la logique dans happy-dom
// (la mise en page n'existe pas : ce qui se voit est dans effets-goo-browser.test.ts).
// une goutte enfant de la balise suit la souris tant qu'elle est dessus, sa boîte lue à l'entrée
// (et après un défilement), la couleur de `color` ou du premier enfant ; avec les défauts, rien ne change.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const lire    = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')
const CODE    = [lire('mjs_fx.ts'), lire('mjs_fx_toolup.ts'), lire('mjs_fx_toolroots.ts'), lire('mjs_fx_toolscroll.ts'), lire('mjs_fx_goo.ts')].join('\n')

const pause = (ms = 15) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// la souris : un mouvement vu de `cible`
const bouge = (w: any, cible: any, x: number, y: number) => cible.dispatchEvent(new w.PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))

// le moteur des effets et les deux définitions dans une fenêtre happy-dom, sans le reste du cœur : l'effet
// se pose par µ._mjs_fx comme dans une page (économes coupés : aucune mesure d'images ne tourne)
function monde(opts: { calme?: boolean } = {}) {
  const window: any = new Window({ url: 'http://localhost/' })
  if (opts.calme) window.eval('globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) })')
  const avertissements: string[] = []
  const µ: any = {
    _fxConf: { lite: 'off' },
    warn: (m: string) => avertissements.push(m),
    _mjs_msg: (_cle: string, vars: Record<string, string> | null, texte: string) => texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? '')),
  }
  window.eval(`globalThis.__charge = function(µ) {\n${CODE}\n}`)
  window.__charge(µ)
  const doc = window.document
  const pose = (name: string, s: Record<string, any>, el?: any, d?: Record<string, any>, sp?: Record<string, any>) => {
    const cible = el ?? doc.body.appendChild(doc.createElement('div'))
    return { el: cible, off: µ._mjs_fx(null, cible, name, s, d, sp) }
  }
  return { window, µ, doc, avertissements, pose }
}
// ------------------------------------------------------------------------------------------------
// *goo(merge, pointer)
// ------------------------------------------------------------------------------------------------
describe('*goo(merge, pointer) — la goutte qui suit la souris', function () {
  this.timeout(30000)
  let window: any
  let doc: any
  let µ: any
  let boite: any
  let lectures = 0
  const natif = { desc: undefined as PropertyDescriptor | undefined, proto: null as any }

  before(() => {
    const m = monde()
    window = m.window
    doc    = m.doc
    µ      = m.µ
    // la boîte d'une balise, comme la mise en page la rendrait : happy-dom ne mesure rien ; le moteur lit la
    // méthode du prototype (jamais celle de l'instance), c'est donc elle qu'on remplace, puis rend
    natif.proto = window.Element.prototype
    natif.desc  = Object.getOwnPropertyDescriptor(natif.proto, 'getBoundingClientRect')
    const lue   = natif.desc!.value
    natif.proto.getBoundingClientRect = function () {
      if (this.__boite) {
        lectures++
        return this.__boite
      }
      return lue.call(this)
    }
  })

  after(() => {
    if (natif.desc) Object.defineProperty(natif.proto, 'getBoundingClientRect', natif.desc)
    window.close()
  })

  beforeEach(() => {
    lectures = 0
    boite    = { left: 100, top: 50, width: 400, height: 300, right: 500, bottom: 350 }
  })

  afterEach(() => { doc.body.innerHTML = '' })

  // une balise de trois formes, la première colorée
  function scene(couleur = 'rgb(0, 57, 255)') {
    const el = doc.body.appendChild(doc.createElement('div'))
    for (let k = 0; k < 3; k++) el.appendChild(doc.createElement('b'))
    el.firstElementChild.style.backgroundColor = couleur
    el.__boite = boite
    return el
  }
  const gouttes = (el: any) => Array.from(el.querySelectorAll('[mjs-fx-goo-drop]')) as any[]
  const entre   = (el: any, x: number, y: number) => el.dispatchEvent(new window.PointerEvent('pointerenter', { clientX: x, clientY: y }))
  const sort    = (el: any) => el.dispatchEvent(new window.PointerEvent('pointerleave', { clientX: 0, clientY: 0 }))

  it('la règle du catalogue : pointer, int 0..600, 0 par défaut, après drag ; les autres réglages sont ceux d\'avant', () => {
    const r = EFFECTS.goo.settings
    assert.deepEqual([r.pointer.rule, r.pointer.dflt], ['int 0..600', 0])
    assert.deepEqual(Object.keys(r), ['mode', 'color', 'strength', 'halo', 'count', 'distance', 'on', 'drag', 'pointer'])
    assert.deepEqual(parseEffect('goo', 'merge, pointer: 90').fixed, { mode: 'merge', pointer: 90 })
    assert.throws(() => parseEffect('goo', 'merge, pointer: 700'), /0\.\.600/)
    assert.throws(() => parseEffect('goo', 'merge, pointer: -1'), /0\.\.600/)
  })

  it('avec les défauts (pointer absent ou 0), la souris ne change rien : ni goutte, ni enfant de plus', () => {
    const el = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge' })
    entre(el, 160, 90)
    bouge(window, el, 170, 95)
    assert.equal(gouttes(el).length, 0)
    assert.equal(el.children.length, 3)
    off()
    const zero = scene()
    const off0 = µ._mjs_fx(null, zero, 'goo', { mode: 'merge', pointer: 0 })
    entre(zero, 160, 90)
    bouge(window, zero, 170, 95)
    assert.equal(gouttes(zero).length, 0)
    assert.equal(lectures, 0, 'aucune lecture de boîte')
    off0()
  })

  it('pointer: 90 : à l\'entrée une goutte naît, dernier enfant de la balise, cachée aux lecteurs d\'écran ; la boîte est lue une fois', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90 })
    assert.equal(el.style.getPropertyValue('--mjs-goo-pointer'), '90px', 'le diamètre est la variable du CSS')
    assert.equal(gouttes(el).length, 0, 'rien tant que la souris n\'est pas là')
    entre(el, 160, 90)
    assert.equal(gouttes(el).length, 1)
    const g = gouttes(el)[0]
    assert.ok(el.lastElementChild === g, 'enfant de la balise, comme les formes : le filtre la soude')
    assert.equal(g.getAttribute('aria-hidden'), 'true')
    assert.equal(g.style.translate, 'calc(60.0px - 50%) calc(40.0px - 50%)', 'centrée sur le pointeur : (160 - 100, 90 - 50)')
    assert.equal(lectures, 1)
    bouge(window, el, 300, 200)
    bouge(window, el, 310, 210)
    assert.equal(g.style.translate, 'calc(210.0px - 50%) calc(160.0px - 50%)')
    assert.equal(gouttes(el).length, 1, 'une seule goutte')
    assert.equal(lectures, 1, 'la boîte lue à l\'entrée, jamais à chaque mouvement')
    off()
  })

  it('un premier mouvement sans entrée (la souris était déjà là à la pose) la fait naître aussi', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90 })
    bouge(window, el, 250, 150)
    assert.equal(gouttes(el).length, 1)
    assert.equal(gouttes(el)[0].style.translate, 'calc(150.0px - 50%) calc(100.0px - 50%)')
    off()
  })

  it('la goutte n\'existe que pendant que la souris est sur la balise : elle part avec elle, une entrée la refait', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90 })
    entre(el, 160, 90)
    assert.equal(gouttes(el).length, 1)
    sort(el)
    assert.equal(gouttes(el).length, 0)
    assert.equal(el.children.length, 3)
    entre(el, 400, 300)
    assert.equal(gouttes(el).length, 1)
    assert.equal(lectures, 2, 'une lecture par entrée')
    off()
  })

  it('la couleur : color, sinon le fond du premier enfant, sinon #f00', () => {
    const a = scene('rgb(10, 20, 30)')
    const offA = µ._mjs_fx(null, a, 'goo', { mode: 'merge', pointer: 60, color: '#0f0' })
    entre(a, 150, 100)
    assert.equal(gouttes(a)[0].style.getPropertyValue('--mjs-fx-goo-pc'), '#0f0')
    const b = scene('rgb(10, 20, 30)')
    const offB = µ._mjs_fx(null, b, 'goo', { mode: 'merge', pointer: 60 })
    entre(b, 150, 100)
    assert.equal(gouttes(b)[0].style.getPropertyValue('--mjs-fx-goo-pc'), window.getComputedStyle(b.firstElementChild).backgroundColor, 'la couleur du premier enfant')
    assert.notEqual(gouttes(b)[0].style.getPropertyValue('--mjs-fx-goo-pc'), '#f00')
    const c = scene('transparent')
    const offC = µ._mjs_fx(null, c, 'goo', { mode: 'merge', pointer: 60 })
    entre(c, 150, 100)
    assert.equal(gouttes(c)[0].style.getPropertyValue('--mjs-fx-goo-pc'), '#f00', 'un premier enfant sans fond : #f00, comme le mode drip')
    offA()
    offB()
    offC()
  })

  // des images d'animation passées (un nombre d'images, pas une durée)
  const images = (n = 2) => new Promise<void>((fini) => {
    const suite = (reste: number) => { if (reste <= 0) fini(); else window.requestAnimationFrame(() => suite(reste - 1)) }
    suite(n)
  })

  it('un défilement ou un redimensionnement pendant le survol : la souris n\'a pas bougé, à l\'image suivante la boîte est relue et la goutte revient dessous', async () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90 })
    entre(el, 160, 90)
    assert.equal(lectures, 1)
    // l'aide de défilement du moteur rend la main une première fois à l'image qui suit sa pose : la boîte est relue
    await images()
    const avant = lectures
    assert.equal(gouttes(el)[0].style.translate, 'calc(60.0px - 50%) calc(40.0px - 50%)')
    // la page a défilé de 40 px : la balise est plus haut, et la souris est restée en (160, 90)
    el.__boite = { ...boite, top: 10, bottom: 310 }
    for (let k = 0; k < 10; k++) window.dispatchEvent(new window.Event('scroll'))
    assert.equal(gouttes(el)[0].style.translate, 'calc(60.0px - 50%) calc(40.0px - 50%)', 'pas avant l\'image suivante')
    await images()
    assert.equal(gouttes(el)[0].style.translate, 'calc(60.0px - 50%) calc(80.0px - 50%)', 'avec la nouvelle boîte : 90 - 10')
    assert.ok(lectures - avant <= 2, `dix événements dans la même image : une relecture par l'aide du moteur et une par la goutte (${lectures - avant})`)
    // un redimensionnement de la fenêtre déplace la balise de même
    el.__boite = { ...boite, top: 30, bottom: 330 }
    window.dispatchEvent(new window.Event('resize'))
    await images()
    assert.equal(gouttes(el)[0].style.translate, 'calc(60.0px - 50%) calc(60.0px - 50%)', 'avec la boîte redimensionnée : 90 - 30')
    // la souris partie, plus rien n'écoute le défilement
    sort(el)
    const apres = lectures
    window.dispatchEvent(new window.Event('scroll'))
    window.dispatchEvent(new window.Event('resize'))
    await images()
    assert.equal(lectures, apres, 'aucune lecture hors du survol')
    off()
  })

  it('une balise réécrite qui emporte la goutte : le mouvement suivant la remet', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90 })
    entre(el, 160, 90)
    gouttes(el)[0].remove()
    assert.equal(gouttes(el).length, 0)
    bouge(window, el, 170, 100)
    assert.equal(gouttes(el).length, 1, 'remise sous la souris')
    assert.equal(gouttes(el)[0].style.translate, 'calc(70.0px - 50%) calc(50.0px - 50%)')
    off()
  })

  it('en drip, pointer ne fait rien', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'drip', pointer: 90 })
    entre(el, 160, 90)
    bouge(window, el, 170, 95)
    assert.equal(gouttes(el).length, 0)
    off()
  })

  it('le retrait défait tout : la goutte, les écouteurs, la variable, le filtre', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90 })
    entre(el, 160, 90)
    assert.equal(gouttes(el).length, 1)
    off()
    assert.equal(gouttes(el).length, 0)
    assert.equal(el.children.length, 3)
    entre(el, 200, 100)
    bouge(window, el, 210, 110)
    assert.equal(gouttes(el).length, 0, 'plus d\'écouteur')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'plus de variable')
    assert.ok(!/filter/.test(el.getAttribute('style') ?? ''), 'plus de filtre')
    window.dispatchEvent(new window.Event('scroll'))
    assert.equal(doc.querySelectorAll('svg[mjs-fx-goo-svg]').length, 0, 'le filtre SVG est retiré')
  })

  it('pointer tenu par une variable : 0 puis 90 donne la goutte, 90 puis 0 la retire ; sa taille est la variable CSS, sans reposer l\'effet', () => {
    const el  = scene()
    const sp  = { pointer: ['i', 0, 600, 'int 0..600'] }
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge' }, { pointer: 0 }, sp)
    bouge(window, el, 160, 90)
    assert.equal(gouttes(el).length, 0, 'pointer 0 : aucune goutte')
    const filtre = el.style.filter
    µ._mjs_fxSet(el, 'goo', { pointer: 90 }, sp)
    assert.equal(el.style.getPropertyValue('--mjs-goo-pointer'), '90px')
    bouge(window, el, 170, 100)
    assert.equal(gouttes(el).length, 1, 'pointer 90 : la goutte naît au mouvement')
    µ._mjs_fxSet(el, 'goo', { pointer: 140 }, sp)
    assert.equal(el.style.getPropertyValue('--mjs-goo-pointer'), '140px', 'sa taille suit')
    assert.equal(gouttes(el).length, 1, 'la même goutte')
    µ._mjs_fxSet(el, 'goo', { pointer: 0 }, sp)
    assert.equal(gouttes(el).length, 0, 'pointer 0 : elle part')
    bouge(window, el, 180, 110)
    assert.equal(gouttes(el).length, 0, 'et plus rien ne l\'appelle')
    assert.equal(el.style.filter, filtre, 'le filtre n\'a pas été reposé')
    assert.ok(el._mjs_fxOff.goo === off || !!el._mjs_fxOff.goo, 'l\'effet n\'a pas été relancé')
    off()
  })

  it('les formes ne sont pas touchées : leur halo, leur position, le drag marchent comme avant', () => {
    const el  = scene()
    const off = µ._mjs_fx(null, el, 'goo', { mode: 'merge', pointer: 90, drag: true, halo: 0 })
    entre(el, 160, 90)
    assert.equal(el.getAttribute('mjs-fx-goo'), 'merge')
    assert.ok(el.hasAttribute('mjs-fx-goo-bare'), 'halo 0 : au contact')
    assert.ok(el.hasAttribute('mjs-fx-goo-drag'))
    off()
    assertAbsent(el.querySelector('[mjs-fx-goo-drop]'), 'plus de goutte')
  })
})

// ------------------------------------------------------------------------------------------------
// de vrais composants compilés
// ------------------------------------------------------------------------------------------------
const COMPOSANTS: Record<string, string> = {
  'tg-retrait':  "<script>\n$on = true\n</script>\n{if $on}\n<div class=\"g\" *goo(merge, pointer: 80)><b></b><b></b></div>\n{end}\n<button class=\"t\" @click={$on = false}>t</button>",
  'tg-goutte':   "<script>\n$p = 60\n</script>\n<div class=\"m\" *goo(merge, pointer: $p, color: #f0f)><b></b><b></b><b></b></div>\n<button class=\"p0\" @click={$p = 0}>0</button>\n<button class=\"p120\" @click={$p = 120}>120</button>"
}

describe('*goo(pointer) — de vrais composants compilés', function () {
  this.timeout(90000)
  let window: any
  const avertissements: string[] = []

  before(async () => {
    const root   = mjsTmp('effets-goo')
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
    const warn = window.µ.warn
    window.µ.warn = (m: string, ...r: any[]) => { avertissements.push(String(m)); return warn?.call(window.µ, m, ...r) }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  afterEach(() => { window.document.body.innerHTML = '' })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause(40)
    return comp
  }

  it('le retrait ({if} refermé) : aucune goutte, aucune marque ni variable', async () => {
    const comp = await monter('mjs-tg-retrait', '.g')
    const g = comp._shadow.querySelector('.g')
    bouge(window, g, 20, 20)
    assert.equal(g.querySelectorAll('[mjs-fx-goo-drop]').length, 1)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.g'))
    await pause(60)
    assert.deepEqual(g.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [], 'aucune marque')
    assert.ok(!/--mjs-/.test(g.getAttribute('style') ?? ''), 'aucune variable')
    assert.equal(g._mjs_fxOff ?? null, null)
    assert.equal(g.querySelectorAll('[mjs-fx-goo-drop]').length, 0, 'la goutte est partie')
  })


  it('*goo(merge, pointer: $p, color) : la goutte de la couleur écrite ; 0 la retire, 120 la reprend plus grosse', async () => {
    const comp = await monter('mjs-tg-goutte', '.m')
    const m    = comp._shadow.querySelector('.m')
    bouge(window, m, 5, 5)
    assert.equal(m.querySelectorAll('[mjs-fx-goo-drop]').length, 1)
    assert.equal(m.querySelector('[mjs-fx-goo-drop]').style.getPropertyValue('--mjs-fx-goo-pc'), '#f0f')
    assert.equal(m.style.getPropertyValue('--mjs-goo-pointer'), '60px')
    comp._shadow.querySelector('.p0').click()
    await attendre(() => m.style.getPropertyValue('--mjs-goo-pointer') === '0px')
    assert.equal(m.querySelectorAll('[mjs-fx-goo-drop]').length, 0)
    comp._shadow.querySelector('.p120').click()
    await attendre(() => m.style.getPropertyValue('--mjs-goo-pointer') === '120px')
    bouge(window, m, 9, 9)
    assert.equal(m.querySelectorAll('[mjs-fx-goo-drop]').length, 1)
  })
})
