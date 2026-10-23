// *travel, ce qui ne demande pas de mise en page : l'écriture au catalogue (réglages, bornes, destination exigée),
// les aides de l'effet (les sélecteurs de `to` coupés aux bonnes virgules, la rotation à plat composée avec celle autour
// de l'axe vertical, les courbes), la recherche de la destination (le shadow root d'abord, puis la page), et la pose
// d'une balise qui n'a pas de boîte (happy-dom ne mesure rien) : elle attend sans rien écrire, se suit, se retire.
// Ce qui se voit — les places, la taille, le défilement — est dans effets-travel-browser.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'
import { assertAbsent } from './helpers/dom-assert.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const MOTEUR  = readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8')
const FICHIER = readFileSync(join(RUNTIME, 'mjs_fx_travel.ts'), 'utf-8')
const OUTILS  = ['mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts'].map((f) => readFileSync(join(RUNTIME, f), 'utf-8')).join('\n')

// une fenêtre où vivent le moteur des effets et celui-là, avec ses aides à portée de main
function fenetre(): any {
  const w = new Window({ url: 'http://localhost/' }) as any
  w.eval('var µ = {};\n' + MOTEUR + '\n' + OUTILS + '\n' + FICHIER + '\nglobalThis.µ = µ;\nglobalThis.__aides = { split: _mjsFxTravelSplit, rotate: _mjsFxTravelRotate, ease: _mjsFxTravelEase, find: _mjsFxTravelFind, shift: _mjsFxTravelShift };')
  w.µ.warn = (m: string) => { (w.__avis ??= []).push(m) }
  return w
}

describe('*travel — écriture au catalogue', () => {
  it('la destination est le réglage principal et elle est exigée', () => {
    assert.equal(EFFECTS.travel.main, 'to')
    assert.equal(EFFECTS.travel.need, 'to')
    assert.equal(EFFECTS.travel.family, 'scroll')
    assert.equal(parseEffect('travel', "'#fiche .emplacement'").fixed.to, '#fiche .emplacement')
    assert.throws(() => parseEffect('travel', 'rotate: 90'), /to/)
  })

  it('plusieurs destinations dans une seule valeur, tous les réglages à leurs bornes', () => {
    const r = parseEffect('travel', "'#a, #b, #c', rotate: -360, spin: 3600, arc: 2000, size: false, zone: '80% 30%', easing: elastic-out, smooth: 0, fade: true")
    assert.deepEqual(r.fixed, { to: '#a, #b, #c', rotate: -360, spin: 3600, arc: 2000, size: false, zone: '80% 30%', easing: 'elastic-out', smooth: 0, fade: true })
    assert.deepEqual(r.dynamic, {})
  })

  it('une valeur hors de sa règle est refusée à la compilation', () => {
    for (const faux of ['rotate: 3601', 'spin: -3601', 'arc: 2001', 'arc: -2001', 'smooth: 1.5', 'smooth: -0.1', "size: 'oui'", 'zone: 50%', 'easing: lent', 'fade: 2']) {
      assert.throws(() => parseEffect('travel', "'.d', " + faux), undefined, faux)
    }
  })

  it('un réglage tenu par une variable : suivi, avec sa règle', () => {
    const r = parseEffect('travel', 'to: $cible, rotate: $tour, smooth: $lissage')
    assert.deepEqual(r.dynamic, { to: '$cible', rotate: '$tour', smooth: '$lissage' })
    assert.equal(r.spec.rotate[0], 'i')
    assert.equal(r.spec.smooth[0], 'f')
    assert.equal(r.spec.to[0], 'p')
  })

  it('les valeurs par défaut du catalogue sont celles de l\'effet', () => {
    const s = EFFECTS.travel.settings
    assert.deepEqual([s.rotate.dflt, s.spin.dflt, s.arc.dflt, s.size.dflt, s.easing.dflt, s.smooth.dflt, s.fade.dflt], [0, 0, 0, true, 'ease-in-out', 0.12, false])
    assert.equal(s.to.dflt, undefined)
    assert.equal(s.zone.dflt, undefined)
  })
})

describe('*travel — les aides de l\'effet', () => {
  let w: any
  before(() => { w = fenetre() })
  after(() => w.close())

  it('les sélecteurs de `to` sont coupés aux virgules de premier niveau', () => {
    // des tableaux de la fenêtre : comparés en JSON
    const coupe = (v: any) => JSON.stringify(w.__aides.split(v))
    assert.equal(coupe('#a, #b,#c'), JSON.stringify(['#a', '#b', '#c']))
    assert.equal(coupe('.x'), JSON.stringify(['.x']))
    assert.equal(coupe('a:is(.x, .y), [data-k="e,f"], b'), JSON.stringify(['a:is(.x, .y)', '[data-k="e,f"]', 'b']))
    assert.equal(coupe("[data-k='a,b'] .c, .d"), JSON.stringify(["[data-k='a,b'] .c", '.d']))
    assert.equal(coupe(' , ,#a,, '), JSON.stringify(['#a']), 'les parties vides tombent')
    assert.equal(coupe(''), '[]')
    assert.equal(coupe(undefined), '[]')
    assert.equal(coupe('.a\\,b, .c'), JSON.stringify(['.a\\,b', '.c']), 'une virgule échappée reste dans son sélecteur')
  })

  // la matrice d'une rotation donnée par son axe et son angle, comme CSS la lit
  const matrice = (texte: string): number[][] => {
    const m = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)deg$/.exec(texte)!
    const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const a = Number(m[4]) * Math.PI / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const t = 1 - c
    return [[c + t * x * x, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, c + t * y * y, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, c + t * z * z]]
  }
  const produit = (p: number[][], q: number[][]) => p.map((l) => [0, 1, 2].map((j) => l[0] * q[0][j] + l[1] * q[1][j] + l[2] * q[2][j]))
  const rz = (d: number) => { const a = d * Math.PI / 180; return [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]] }
  const ry = (d: number) => { const a = d * Math.PI / 180; return [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]] }

  it('la rotation à plat seule est un angle ; aucune rotation : rien', () => {
    const { rotate } = w.__aides
    assert.equal(rotate(45, 0), '45.00deg')
    assert.equal(rotate(-90.123, 0), '-90.12deg')
    assert.equal(rotate(0, 0), '')
    assert.equal(rotate(0, 360), '', 'un tour entier autour de l\'axe vertical ne tourne plus')
    assert.equal(rotate(3600, 360), '', 'dix tours à plat et un tour retourné : la balise est revenue')
  })

  it('à plat et autour de l\'axe vertical : une seule propriété rotate, l\'équivalent de `rotate() rotateY()`', () => {
    const { rotate } = w.__aides
    for (const [a, b] of [[0, 90], [20, 35], [90, 90], [400, -200], [-720, 90], [180, 180], [33, 720 + 30], [-10, -170]]) {
      const lue = matrice(rotate(a, b))
      const att = produit(rz(a), ry(b))
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(lue[i][j] - att[i][j]) < 1e-3, `rotate(${a}) rotateY(${b}) : case ${i}${j} ${lue[i][j].toFixed(4)} ≠ ${att[i][j].toFixed(4)}`)
    }
  })

  it('les courbes : un mot, un cubic-bezier, une courbe de µeasing en kebab ; une inconnue reste droite', () => {
    const { ease } = w.__aides
    assert.equal(ease('linear')(0.3), 0.3)
    assert.ok(Math.abs(ease('ease-in-out')(0.5) - 0.5) < 1e-3)
    assert.ok(ease('ease-in')(0.5) < 0.35)
    assert.ok(ease('ease-out')(0.5) > 0.65)
    assert.equal(ease('cubic-bezier(0, 0, 1, 1)')(0.3), 0.3)
    const depasse = ease('cubic-bezier(.34, 1.56, .64, 1)')
    assert.ok(Math.max(...[0.5, 0.6, 0.7, 0.8].map(depasse)) > 1.05, 'une courbe à 1,56 dépasse 1')
    assert.deepEqual([depasse(0), depasse(1)], [0, 1], 'les bornes sont exactes')
    assert.equal(ease('inconnue')(0.3), 0.3)
    assert.equal(ease(undefined)(0.3), 0.3)
    assert.equal(ease('constructor')(0.3), 0.3, 'un nom hérité d\'Object ne passe pas pour un mot CSS')
    w.µ.easing = { backOut: (t: number) => t * 2 }
    assert.equal(ease('back-out')(0.25), 0.5, 'µ.easing.backOut')
  })

  it('la destination est cherchée dans le shadow root de la balise, puis dans la page', () => {
    const { find } = w.__aides
    const doc = w.document
    doc.body.innerHTML = '<div id="page"><i class="d dans-page"></i><i class="seul-page"></i></div><section id="hote"></section>'
    const hote   = doc.querySelector('#hote')
    const racine = hote.attachShadow({ mode: 'open' })
    racine.innerHTML = '<b class="t"></b><i class="d dans-racine"></i>'
    const t = racine.querySelector('.t')
    assert.ok(find(t, '.d').classList.contains('dans-racine'), 'le shadow root passe avant la page')
    assert.ok(find(t, '.seul-page').classList.contains('seul-page'), 'sinon la page')
    assert.equal(find(t, '.nulle-part'), null)
    assert.equal(find(t, ':::'), false, 'un sélecteur illisible ne casse rien, et se distingue d\'un sélecteur sans résultat (null)')
    assert.equal(find(t, '.t'), null, 'la balise n\'est pas sa propre destination')
    const page = doc.querySelector('#page')
    assert.equal(find(page, '#page'), null)
    assert.equal(find(doc.querySelector('#hote'), '.seul-page').className, 'seul-page', 'une balise de la page cherche dans la page')
  })

  it('la destination est cherchée de racine en racine, du composant de la balise jusqu\'à la page : la plus proche l\'emporte', () => {
    const { find } = w.__aides
    const doc = w.document
    doc.body.innerHTML = '<i class="d dans-page"></i><i class="seul-page"></i><section id="parent"></section>'
    const parent = doc.querySelector('#parent').attachShadow({ mode: 'open' })
    parent.innerHTML = '<i class="d dans-parent"></i><i class="seul-parent"></i><article id="enfant"></article>'
    const enfant = parent.querySelector('#enfant').attachShadow({ mode: 'open' })
    enfant.innerHTML = '<b class="t"></b><i class="d dans-enfant"></i>'
    const t = enfant.querySelector('.t')
    assert.ok(find(t, '.d').classList.contains('dans-enfant'), 'la racine de la balise passe en premier')
    assert.ok(find(t, '.seul-parent').classList.contains('seul-parent'), 'la racine du composant parent, que la balise n\'a pas dans la sienne')
    assert.ok(find(t, '.seul-page').classList.contains('seul-page'), 'puis la page')
    enfant.querySelector('.dans-enfant').remove()
    assert.ok(find(t, '.d').classList.contains('dans-parent'), 'sans la sienne, celle du parent passe avant la page')
    parent.querySelector('.dans-parent').remove()
    assert.ok(find(t, '.d').classList.contains('dans-page'), 'sans les deux, la page')
    assert.equal(find(t, '.nulle-part'), null)
  })

  it('le décalage que le transform de l\'auteur donne au centre de la balise est la translation de sa matrice ; aucune sinon', () => {
    const { shift } = w.__aides
    const doc = w.document
    const avec = (transform: string) => {
      doc.body.innerHTML = `<div style="transform: ${transform}"></div>`
      return shift(doc.body.firstElementChild)
    }
    assert.deepEqual(JSON.parse(JSON.stringify(avec('matrix(1, 0, 0, 1, 60, -20)'))), { x: 60, y: -20 })
    assert.deepEqual(JSON.parse(JSON.stringify(avec('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -50, 12.5, 0, 1)'))), { x: -50, y: 12.5 })
    assert.equal(avec('none'), null)
    assert.equal(avec('matrix(0.866, 0.5, -0.5, 0.866, 0, 0)'), null, 'une rotation seule ne déplace pas le centre')
  })
})

describe('*travel — posée sur une balise sans boîte (happy-dom ne mesure rien)', () => {
  it('elle attend sans rien écrire, suit ses réglages sans lever d\'erreur, se retire sans reste', () => {
    const w = fenetre()
    try {
      const doc = w.document
      doc.body.innerHTML = '<div class="t" style="opacity: .9"></div><div class="d"></div>'
      const el  = doc.querySelector('.t')
      const avant = el.getAttribute('style')
      const off = w.µ._mjs_fxDefs.travel.setup(el, { to: '.d', rotate: 90 })
      assert.equal(typeof off, 'function')
      assert.equal(typeof off.set, 'function')
      assert.equal(el.getAttribute('style'), avant, 'rien d\'écrit : la balise n\'a pas de place')
      for (const [k, v] of [['to', '.autre'], ['rotate', undefined], ['spin', 60], ['arc', 20], ['size', false], ['zone', '80% 20%'], ['easing', 'ease-out'], ['smooth', 0], ['fade', true], ['to', undefined]] as Array<[string, any]>) {
        assert.doesNotThrow(() => off.set(k, v), k)
      }
      assert.equal(el.getAttribute('style'), avant, 'rien d\'écrit après les réglages')
      assertAbsent(doc.querySelector('.d').getAttribute('style'), 'fade : une destination qu\'on ne voit pas n\'est pas touchée')
      off()
      off()
      assert.equal(el.getAttribute('style'), avant, 'rien de resté au retrait')
      assert.equal(w.__avis, undefined, 'aucun avertissement : la balise n\'est pas encore mise en page')
    }
    finally {
      w.close()
    }
  })

  it('sans destination écrite (variable vide) : elle ne fait rien, sans erreur', () => {
    const w = fenetre()
    try {
      w.document.body.innerHTML = '<div class="t"></div>'
      const el  = w.document.querySelector('.t')
      const off = w.µ._mjs_fxDefs.travel.setup(el, {})
      off.set('to', '.d')
      off()
      assert.equal(el.getAttribute('style'), null)
    }
    finally {
      w.close()
    }
  })
})
