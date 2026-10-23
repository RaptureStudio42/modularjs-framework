// la garde de cadence des effets économes (mjs_fx_toolgauge.ts) : une page qui n'a que des pauses (250 ms et plus entre deux images, moins de
// quatre images par seconde) n'est pas jugée, et sa salve s'arrête à la 150e pause. Dans Chromium, les images de la mesure elles-mêmes sont
// longues sur une telle page : chacune était signalée par le navigateur (`long-animation-frame`), et chaque signal relançait une salve de
// 150 pauses — la page restait sous mesure pour toujours, au repos compris. Passé ces 150 pauses, le signal ne relance plus rien ; un geste,
// lui, arme encore la mesure. Les images d'animation sont menées à la main : aucune mesure ne dépend de la machine.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI    = dirname(fileURLToPath(import.meta.url))
const lire   = (f: string) => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const MOTEUR = lire('mjs_fx.ts')
const GARDE  = lire('mjs_fx_toolgauge.ts')

function monde() {
  const window: any = new Window({ url: 'http://localhost/' })
  const file: Array<(t: number) => void> = []
  let temps    = 0
  let demandes = 0
  window.requestAnimationFrame = (f: (t: number) => void) => { demandes++; file.push(f); return file.length }
  window.cancelAnimationFrame  = () => {}
  // un navigateur qui signale les images longues ; débranché, l'observateur ne rappelle plus jamais
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
  // une image de dt ms, que le navigateur signale longue (au-delà de 50 ms) tant que son observateur est branché
  const image = (dt: number) => {
    temps += dt
    for (const f of file.splice(0)) f(temps)
    const o = observateurs[0]
    if (dt >= 50 && o && !o.coupe) o.cb({ getEntries: () => [{ duration: dt }] })
  }
  const geste = () => { window.dispatchEvent(new window.Event('pointermove')) }
  return { µ, image, geste, observateurs, attendues: () => file.length, demandes: () => demandes }
}

describe('la garde de cadence — une page faite de pauses, ses images longues ne la relancent plus', () => {
  it('300 ms par image, chacune signalée longue : la salve s\'arrête à la 150e pause, puis plus aucune image, la page n\'est pas jugée', () => {
    const m = monde()
    for (let i = 0; i < 1000; i++) m.image(300)
    assert.equal(m.demandes(), 151, 'la première image, puis 150 pauses : la borne, même avec le signal des images longues')
    assert.equal(m.attendues(), 0, 'au repos, aucune image demandée')
    assert.equal(m.µ._mjs_fxLite, false, 'la page n\'est pas jugée')
  })

  it('un geste arme encore la mesure après les 150 pauses', () => {
    const m = monde()
    for (let i = 0; i < 400; i++) m.image(300)
    assert.equal(m.attendues(), 0)
    m.geste()
    assert.equal(m.attendues(), 1, 'le geste demande une image')
  })

  it('une page lente qui n\'a pas épuisé ses pauses reste suivie par le signal des images longues', () => {
    const m = monde()
    for (let i = 0; i < 20; i++) m.image(300)
    for (let i = 0; i < 400 && !m.µ._mjs_fxLite; i++) m.image(60)
    assert.equal(m.µ._mjs_fxLite, true, '60 ms par image : économe')
  })
})
