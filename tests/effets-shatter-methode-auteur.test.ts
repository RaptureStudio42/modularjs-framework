// *shatter pose son calque de tuiles juste avant la balise, dans son parent : par la méthode du prototype (`µ._mjs_dom.insertBefore`),
// jamais par celle qu'un composant parent aurait écrite sous ce nom (`@insertBefore` masque celle de sa balise). Sans µ._mjs_dom
// (l'animation chargée seule, sans le moteur des effets), le calque se pose quand même.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI     = dirname(fileURLToPath(import.meta.url))
const MOTEUR  = readFileSync(join(ICI, '../src/runtime/mjs_fx.ts'), 'utf-8')
const SHATTER = readFileSync(join(ICI, '../src/runtime/animations/shatter.ts'), 'utf-8')

// une image de 40 × 40 dans un parent dont `insertBefore` est « écrite par l'auteur » (un champ qui masque le prototype) : chaque
// appel est compté, puis confié à la méthode du DOM
function banc(avecMoteur: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const µ: any = { easing: { resolve: () => (k: number) => k, linear: (k: number) => k }, warn: () => {}, error: () => {}, _mjs_msg: (_c: string, _v: unknown, t: string) => t }
  if (avecMoteur) {
    window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n}`)
    window.__charge(µ)
  }
  else assert.equal(µ._mjs_dom, undefined)
  window.eval(`globalThis.__shatter = function(µ) { var f = ${SHATTER}\nreturn f; }`)
  const document = window.document
  const appels: string[] = []
  const parent: any = document.body.appendChild(document.createElement('div'))
  parent.insertBefore = function (...args: any[]) { appels.push('insertBefore'); return window.Node.prototype.insertBefore.apply(this, args) }
  const img: any = parent.appendChild(document.createElement('img'))
  img.src = 'http://localhost/photo.png'
  Object.defineProperty(img, 'offsetWidth', { value: 40 })
  Object.defineProperty(img, 'offsetHeight', { value: 40 })
  const cfg = window.__shatter(µ)({ size: 20 }).intro(img)
  return { parent, img, cfg, appels }
}

describe('*shatter — le calque de tuiles se pose sans méthode de l\'auteur', () => {
  it('en plein jeu, le calque est posé avant la balise par la méthode du DOM, pas par celle du parent', () => {
    const { parent, img, cfg, appels } = banc(true)
    assert.equal(typeof cfg.tick, 'function', 'une image : les tuiles, pas le fondu')
    cfg.tick(0.5)
    assert.deepEqual(appels, [], 'la méthode « de l\'auteur » n\'est pas appelée')
    assert.equal(img.previousSibling?.getAttribute('aria-hidden'), 'true', 'le calque est juste avant la balise')
    assert.equal(img.previousSibling.children.length, 4, 'quatre tuiles de 20 px')
    assert.equal(img.style.visibility, 'hidden')
    cfg.tick(1)
    assert.equal(parent.children.length, 1, 'fin du jeu : le calque est parti')
    assert.equal(img.style.visibility, '')
  })

  it('sans µ._mjs_dom (l\'animation chargée seule), le calque se pose quand même', () => {
    const { img, cfg } = banc(false)
    cfg.tick(0.5)
    assert.equal(img.previousSibling?.getAttribute('aria-hidden'), 'true')
    cfg.cleanup()
    assert.equal(img.style.visibility, '')
  })
})
