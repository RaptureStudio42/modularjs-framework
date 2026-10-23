// *marquee — les réglages ajoutés (drag, axis, reverse, on: scroll) : écrits, vérifiés et convertis à la compilation, valeurs par défaut du
// catalogue, et les balises qui peuvent porter le défilé des enfants (la balise ne doit pas refuser une liste, une rangée, une section)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { EFFECTS, parseEffect, checkPlacement } from '../src/effects/catalog.js'

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output
const appels   = (js: string) => [...js.matchAll(/µ\._mjs_fx\(this, _mjs_fxn, "([a-z-]+)", (\{[^}]*\})\)/g)].map(m => [m[1], JSON.parse(m[2])])

describe('*marquee — réglages et balises', () => {
  it('les réglages d\'avant gardent leurs valeurs par défaut ; les nouveaux sont éteints', () => {
    const s = EFFECTS.marquee.settings
    assert.equal(EFFECTS.marquee.main, 'speed')
    assert.deepEqual(
      [s.speed.dflt, s.direction.dflt, s.gap.dflt, s.pause.dflt, s.on.dflt],
      ['12s', 'left', 32, false, 'always']
    )
    assert.deepEqual([s.drag.dflt, s.axis.dflt, s.reverse.dflt], [false, 'auto', false])
    assert.match(s.on.rule, /'scroll'/, 'on accepte scroll')
    assert.match(s.on.rule, /'always'.*'hover'.*'view'.*'click'.*'load'/, 'et garde les déclencheurs d\'avant')
  })

  it('drag, axis, reverse et on: scroll s\'écrivent et se convertissent ; le premier réglage s\'écrit sans son nom', async () => {
    const js = await compiler('<div *marquee(drag: true, axis: both, reverse: true, on: scroll, gap: 12)><img src="a.png" alt="a"><img src="b.png" alt="b"></div>')
    assert.deepEqual(appels(js), [['marquee', { drag: true, axis: 'both', reverse: true, on: 'scroll', gap: 12 }]])
    assert.deepEqual(appels(await compiler('<div *marquee(8s, pause: true)>Défile</div>')), [['marquee', { speed: '8s', pause: true }]])
    assert.deepEqual(appels(await compiler('<div *marquee(direction: up, on: scroll, reverse: true)><p>a</p></div>')), [['marquee', { direction: 'up', on: 'scroll', reverse: true }]])
  })

  it('un réglage fixe faux est refusé à la compilation', async () => {
    await assert.rejects(compiler('<div *marquee(axis: diagonal)>x</div>'), /axis/)
    await assert.rejects(compiler('<div *marquee(drag: 3)>x</div>'), /drag/)
    await assert.rejects(compiler('<div *marquee(on: parfois)>x</div>'), /on/)
  })

  it('un réglage tenu par une variable est suivi : drag et reverse', async () => {
    const js = await compiler('<script>\n$main = false\n$sens = false\n</script>\n<div *marquee(drag: $main, reverse: $sens, on: scroll)><img src="a.png" alt="a"></div>')
    assert.match(js, /"drag": \(/)
    assert.match(js, /"reverse": \(/)
    assert.deepEqual(appels(js).length, 0, 'un réglage variable : l\'appel porte ses valeurs dynamiques à part')
  })

  it('le drapeau de texte du catalogue ne refuse pas une balise à enfants : div, ul, section, span, p — il refuse ce qui n\'a pas de contenu', async () => {
    const pose = (balise: string) => checkPlacement('marquee', parseEffect('marquee', 'drag: true'), balise, false)
    for (const balise of ['div', 'ul', 'ol', 'section', 'span', 'p', 'nav', 'figure']) assert.doesNotThrow(() => pose(balise), balise)
    for (const balise of ['img', 'video', 'input', 'svg']) assert.throws(() => pose(balise), /\*marquee/, balise)
    assert.throws(() => pose('mjs-carte'), /\*marquee/, 'un composant porte son propre contenu')
    // et le compilateur le dit pareil, sur de vrais gabarits
    assert.equal(appels(await compiler('<ul *marquee(drag: true)><li>a</li><li>b</li></ul>')).length, 1)
    assert.equal(appels(await compiler('<div *marquee(axis: both)><img src="a.png" alt="a"></div>')).length, 1)
    await assert.rejects(compiler('<img *marquee(drag: true) src="a.png" alt="a">'), /\*marquee travaille le texte de sa balise, et <img>/)
  })
})
