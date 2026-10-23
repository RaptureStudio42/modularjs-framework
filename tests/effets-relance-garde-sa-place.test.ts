// deux effets à calque sur la même balise (`<div *border(width: $w) *sparkles>`) : quand l'un repart (un réglage de comportement
// tenu par une variable, ou son décor remis après qu'un script a réécrit la balise), il reprend sa place parmi les effets de la
// balise — son rang dans `mjs-fx`, son calque devant celui de l'effet écrit après lui. Reposé en dernier, son calque passait
// devant l'autre à l'écran (aucun z-index ne les départage).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI    = dirname(fileURLToPath(import.meta.url))
const lire   = (f: string) => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const MOTEUR = lire('mjs_fx.ts')
const DECOR  = lire('mjs_fx_toolkeep.ts')

// le moteur et l'outil du décor dans une fenêtre happy-dom ; deux effets de test, chacun pose son calque à la fin de la balise
function monde() {
  const window: any = new Window({ url: 'http://localhost/' })
  if (typeof window.MessageChannel !== 'function') window.MessageChannel = MessageChannel
  const µ: any = {
    warn: () => {},
    error: () => {},
    _mjs_msg: (_cle: string, vars: Record<string, string> | null, texte: string) => texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? ''))
  }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n${DECOR}\n}`)
  window.__charge(µ)
  const poses: Record<string, number> = { alpha: 0, beta: 0 }
  for (const nom of ['alpha', 'beta']) {
    µ._mjs_fxDefs[nom] = {
      css: '',
      decor: true,
      setup: (el: any) => {
        poses[nom]++
        const calque = window.document.createElement('i')
        calque.setAttribute('mjs-fx-layer', nom)
        el.appendChild(calque)
        return () => { calque.remove() }
      }
    }
  }
  const el = window.document.body.appendChild(window.document.createElement('div'))
  el.textContent = 'texte'
  µ._mjs_fx(null, el, 'alpha', { mode: 1 })
  µ._mjs_fx(null, el, 'beta', {})
  const etat = () => ({ fx: el.getAttribute('mjs-fx'), calques: Array.from(el.children).map((c: any) => c.getAttribute('mjs-fx-layer')) })
  return { window, µ, el, etat, poses }
}

const ORDRE = { fx: 'alpha beta', calques: ['alpha', 'beta'] }

describe('effets — un effet qui repart reprend sa place parmi ceux de la balise', () => {
  it('relancé par un réglage de comportement tenu par une variable : même rang, calque devant celui de l\'effet suivant', () => {
    const { µ, el, etat, poses } = monde()
    assert.deepEqual(etat(), ORDRE, 'la pose suit l\'ordre écrit')
    µ._mjs_fxSet(el, 'alpha', { mode: 2 }, null)
    assert.equal(poses.alpha, 2, 'l\'effet est bien reparti')
    assert.equal(poses.beta, 1, 'l\'autre effet n\'est pas touché')
    assert.deepEqual(etat(), ORDRE)
  })

  it('décor remis après qu\'un script a réécrit la balise : même rang, même place du calque', async () => {
    const { el, etat, poses } = monde()
    // le script retire le calque du premier effet et écrit autre chose dans la même tâche
    el.querySelector('[mjs-fx-layer="alpha"]').remove()
    el.appendChild(el.ownerDocument.createTextNode(' de plus'))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(poses.alpha, 2, 'le décor a été remis')
    assert.equal(poses.beta, 1)
    assert.deepEqual(etat(), ORDRE)
  })

  it('le dernier effet de la balise qui repart reste le dernier, rien d\'autre ne bouge', () => {
    const { µ, el, etat, poses } = monde()
    µ._mjs_fxSet(el, 'beta', { mode: 3 }, null)
    assert.equal(poses.beta, 2)
    assert.deepEqual(etat(), ORDRE)
    assert.equal(el.firstChild.nodeType, 3, 'le texte de la balise reste devant les calques')
  })
})
