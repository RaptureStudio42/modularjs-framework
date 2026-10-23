// la garde de cadence des effets économes (mjs_fx_toolgauge.ts) : son verdict rendu (l'appareil peine : économe pour le reste de la
// visite ; ou vingt fenêtres fluides d'affilée : plus de mesure), elle ne sert plus à rien — ses trois écouteurs de geste (pointeur,
// molette, défilement) et son observateur des images longues partent avec lui, au lieu de rester appelés pour rien à chaque geste
// jusqu'à la fin de la visite. Les images d'animation sont menées à la main : aucune mesure ne dépend de la machine.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI    = dirname(fileURLToPath(import.meta.url))
const lire   = (f: string) => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const MOTEUR = lire('mjs_fx.ts')
const GARDE  = lire('mjs_fx_toolgauge.ts')
const GESTES = ['pointermove', 'wheel', 'scroll']

function monde() {
  const window: any = new Window({ url: 'http://localhost/' })
  const file: Array<(t: number) => void> = []
  let temps = 0
  window.requestAnimationFrame = (f: (t: number) => void) => { file.push(f); return file.length }
  window.cancelAnimationFrame  = () => {}
  // les écouteurs de geste posés sur la fenêtre, et ceux retirés
  const poses: Array<{ type: string, f: any, capture: boolean }> = []
  const retires: Array<{ type: string, f: any, capture: boolean }> = []
  const capture = (o: any) => o === true || !!(o && o.capture)
  const ajoute  = window.addEventListener.bind(window)
  const retire  = window.removeEventListener.bind(window)
  window.addEventListener    = (type: string, f: any, o: any) => { if (GESTES.includes(type)) poses.push({ type, f, capture: capture(o) }); return ajoute(type, f, o) }
  window.removeEventListener = (type: string, f: any, o: any) => { if (GESTES.includes(type)) retires.push({ type, f, capture: capture(o) }); return retire(type, f, o) }
  // un navigateur qui signale les images longues
  const observateurs: any[] = []
  window.PerformanceObserver = class {
    static supportedEntryTypes = ['long-animation-frame']
    coupe = 0
    constructor(public cb: any) { observateurs.push(this) }
    observe() {}
    disconnect() { this.coupe++ }
  }
  const µ: any = {
    _fxConf: {},
    warn: () => {},
    _mjs_msg: (_cle: string, vars: Record<string, string> | null, texte: string) => texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? ''))
  }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n${GARDE}\n}`)
  window.__charge(µ)
  µ._mjs_fxDefs.lourd = { heavy: true, setup: () => () => {} }
  µ._mjs_fx(null, window.document.body.appendChild(window.document.createElement('div')), 'lourd', {})
  const image = (dt: number) => {
    temps += dt
    for (const f of file.splice(0)) f(temps)
  }
  const geste = () => { window.dispatchEvent(new window.Event('pointermove')) }
  // chaque écouteur posé a-t-il été retiré (même fonction, même phase) ?
  const tousRetires = () => poses.length === GESTES.length && poses.every((p) => retires.some((r) => r.type === p.type && r.f === p.f && r.capture === p.capture))
  return { µ, image, geste, poses, retires, observateurs, tousRetires, attendues: () => file.length }
}

describe('la garde de cadence — son verdict rendu, ses écouteurs partent', () => {
  it('un appareil qui peine (économe) : les trois écouteurs de geste et l\'observateur des images longues sont retirés', () => {
    const m = monde()
    assert.equal(m.poses.length, 3, 'les trois écouteurs de geste sont posés à la pose du premier effet lourd')
    assert.equal(m.observateurs.length, 1)
    // la salve de la pose, sur un appareil lent : deux fenêtres à 40 ms l'image
    for (let i = 0; i < 151; i++) m.image(40)
    assert.equal(m.µ._mjs_fxLite, true, 'le verdict : économe')
    assert.ok(m.tousRetires(), 'écouteurs retirés : ' + JSON.stringify(m.retires.map((r) => r.type)))
    assert.equal(m.observateurs[0].coupe, 1, 'l\'observateur des images longues est débranché')
    m.geste()
    assert.equal(m.attendues(), 0, 'un geste ne demande plus aucune image')
  })

  it('vingt fenêtres fluides d\'affilée : la mesure s\'arrête pour de bon, ses écouteurs aussi', () => {
    const m = monde()
    for (let i = 0; i < 151; i++) m.image(16.7)
    assert.equal(m.retires.length, 0, 'deux fenêtres fluides : la garde écoute encore')
    for (let i = 0; i < 1300 && !m.tousRetires(); i++) {
      m.geste()
      m.image(16.7)
    }
    assert.equal(m.µ._mjs_fxLite, false, 'un appareil qui suit n\'est pas économe')
    assert.ok(m.tousRetires(), 'écouteurs retirés après vingt fenêtres fluides')
    assert.equal(m.observateurs[0].coupe, 1)
  })

  it('tant que le verdict n\'est pas rendu, rien n\'est retiré', () => {
    const m = monde()
    // une fenêtre lente puis une fluide : rien n'est jugé
    for (let i = 0; i < 91; i++) m.image(40)
    for (let i = 0; i < 60; i++) m.image(16.7)
    assert.equal(m.µ._mjs_fxLite, false)
    assert.equal(m.retires.length, 0)
    assert.equal(m.observateurs[0].coupe, 0)
  })
})
