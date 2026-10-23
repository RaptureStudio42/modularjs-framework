// *gallery — deux réglages tenus par une variable, changés en direct (happy-dom, tailles posées à la main) :
//   - le style d'une galerie circulaire (la sphère) devient un style borné : la galerie revient dans ses bornes, le dernier panneau au
//     premier plan, au lieu de rester posée au-delà de lui (rien au premier plan jusqu'au prochain geste) ;
//   - `index` d'une galerie en boucle passe du dernier panneau au premier : elle avance d'un cran, par le chemin court, comme le
//     clavier, au lieu de repartir à reculons à travers tous les panneaux.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const MOTEUR  = ['mjs_fx.ts', 'mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts', 'mjs_fx_toolscroll.ts'].map((f) => readFileSync(join(RUNTIME, f), 'utf-8')).join('\n')
const EFFET   = readFileSync(join(RUNTIME, 'mjs_fx_gallery.ts'), 'utf-8')

const attendre = (ms = 50) => new Promise((r) => setTimeout(r, ms))
const RENDUS: Array<() => void> = []

// huit images de 470 × 310 dans une balise de 1000 × 600
function monter(reglages: Record<string, any>) {
  const window: any = new Window({ url: 'http://localhost/' })
  window.IntersectionObserver = undefined
  window.eval(`var µ = {};\n${MOTEUR}\n${EFFET}\nglobalThis.µ = µ;`)
  const doc = window.document
  const el  = doc.createElement('div')
  for (let i = 0; i < 8; i++) {
    const c = doc.createElement('img')
    Object.defineProperty(c, 'offsetWidth', { value: 470 })
    Object.defineProperty(c, 'offsetHeight', { value: 310 })
    el.appendChild(c)
  }
  Object.defineProperty(el, 'clientWidth', { value: 1000 })
  Object.defineProperty(el, 'clientHeight', { value: 600 })
  const proto = window.Element.prototype
  const avant = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
  const natif = proto.getBoundingClientRect
  proto.getBoundingClientRect = function () { return this === el ? { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 } : natif.call(this) }
  RENDUS.push(() => { if (avant) Object.defineProperty(proto, 'getBoundingClientRect', avant); else delete proto.getBoundingClientRect })
  doc.body.appendChild(el)
  const changes: number[] = []
  el.addEventListener('change', (e: any) => changes.push(e.detail.index))
  window.µ._mjs_fx({}, el, 'gallery', reglages)
  return { window, el, changes, µ: window.µ }
}

// la place horizontale d'un panneau (sa transformation), NaN s'il n'en a pas
const x = (c: any) => {
  const m = /translate3d\((-?[\d.]+)px/.exec(c.style.transform)
  return m ? +m[1] : NaN
}

describe('*gallery — style et index changés en direct', function () {
  this.timeout(20000)
  afterEach(() => { while (RENDUS.length) RENDUS.pop()!() })

  it('une sphère tournée au-delà du dernier panneau, passée en coverflow : la galerie revient dans ses bornes, le dernier panneau au premier plan', async () => {
    const { window, el, µ } = monter({ style: 'sphere', on: 'pointer', smooth: 1 })
    el.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 960, clientY: 300 }))
    await attendre(100)
    µ._mjs_fxSet(el, 'gallery', { style: 'coverflow' })
    await attendre(300)
    const kids = [...el.children]
    const visibles = kids.map((c: any, i: number) => c.hasAttribute('mjs-fx-gallery-hidden') ? null : [i, x(c)]).filter(Boolean)
    const sept = visibles.find((v: any) => v[0] === 7)
    assert.ok(sept, 'le dernier panneau est visible : ' + JSON.stringify(visibles))
    assert.equal(sept![1], 0, 'le dernier panneau est au centre, au premier plan : ' + JSON.stringify(visibles))
    window.close()
  })

  it('en boucle, `index` passe du dernier panneau (7) au premier (0) : un seul cran en avant, un seul `change`', async () => {
    const { window, el, µ, changes } = monter({ style: 'coverflow', on: 'drag', loop: true, index: 7, smooth: 0.5 })
    µ._mjs_fxSet(el, 'gallery', { index: 0 })
    await attendre(600)
    assert.deepEqual(changes, [0], 'la galerie va droit au premier panneau, sans repasser par les autres')
    const kids = [...el.children]
    assert.equal(x(kids[0]), 0, 'le premier panneau est au centre')
    window.close()
  })

  it('en boucle, `index` du premier panneau (0) au dernier (7) : un cran en arrière ; sans boucle, la galerie traverse les panneaux comme avant', async () => {
    const boucle = monter({ style: 'coverflow', on: 'drag', loop: true, index: 0, smooth: 0.5 })
    boucle.µ._mjs_fxSet(boucle.el, 'gallery', { index: 7 })
    await attendre(600)
    assert.deepEqual(boucle.changes, [7])
    boucle.window.close()
    while (RENDUS.length) RENDUS.pop()!()
    const borne = monter({ style: 'coverflow', on: 'drag', index: 7, smooth: 0.5 })
    borne.µ._mjs_fxSet(borne.el, 'gallery', { index: 0 })
    await attendre(600)
    assert.equal(borne.changes[borne.changes.length - 1], 0, 'la galerie bornée arrive au premier panneau')
    assert.ok(borne.changes.length > 1, 'sans boucle, elle passe par les panneaux d\'entre les deux : ' + JSON.stringify(borne.changes))
    borne.window.close()
  })
})
