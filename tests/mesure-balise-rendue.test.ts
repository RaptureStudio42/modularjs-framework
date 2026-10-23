// L'aide `mesurer` (tests/helpers/mesure-balise.ts) donne à une balise la boîte qu'un test veut, par le prototype des éléments de
// happy-dom : toutes les fenêtres, tous les tests et tous les fichiers d'un même processus mocha se partagent ce prototype. La boîte
// d'un test ne lui survit donc pas (le prototype est rendu tel qu'il était à la fin de chaque test), et une fenêtre qui sert à
// plusieurs tests reçoit la boîte de chacun.

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { mesurer } from './helpers/mesure-balise.js'

// la méthode d'origine des éléments, relevée au chargement du fichier, avant qu'aucun test n'ait posé de boîte
const ORIGINALE = new Window({ url: 'http://localhost/' }).Element.prototype.getBoundingClientRect
const BOITE     = () => ({ left: 5, top: 6, right: 105, bottom: 56, width: 100, height: 50, x: 5, y: 6 })
const FUITE     = 'la boîte posée par le test précédent fuit dans les autres tests et les autres fichiers'

describe('mesurer — la boîte posée sur une balise ne survit pas au test', function () {
  // une seule fenêtre pour tout le groupe, comme les bancs des fichiers d'effets
  let window: any
  before(() => { window = new Window({ url: 'http://localhost/' }) })
  after(() => { window.close?.() })
  const balise = () => window.document.body.appendChild(window.document.createElement('div'))

  it('une balise mesurée rend sa boîte ; une autre garde la mesure de happy-dom', () => {
    const a = balise()
    const b = balise()
    mesurer(window, a, BOITE)
    assert.deepEqual([a.getBoundingClientRect().left, a.getBoundingClientRect().height], [5, 50])
    assert.equal(b.getBoundingClientRect().left, 0)
    assert.ok(window.Element.prototype.getBoundingClientRect !== ORIGINALE, 'pendant le test, la méthode des éléments est celle de la mesure')
  })

  it('le test suivant retrouve la méthode d\'origine des éléments', () => {
    assert.ok(window.Element.prototype.getBoundingClientRect === ORIGINALE, FUITE)
  })

  it('la même fenêtre sert un nouveau test : la boîte posée à celui-ci est bien lue', () => {
    const a = balise()
    mesurer(window, a, () => ({ ...BOITE(), width: 321 }))
    assert.equal(a.getBoundingClientRect().width, 321)
  })

  it('deux fenêtres dans un même test : chacune lit sa boîte', () => {
    const autre: any = new Window({ url: 'http://localhost/' })
    const a = balise()
    const b = autre.document.body.appendChild(autre.document.createElement('div'))
    mesurer(window, a, () => ({ ...BOITE(), top: 11 }))
    mesurer(autre, b, () => ({ ...BOITE(), top: 22 }))
    assert.deepEqual([a.getBoundingClientRect().top, b.getBoundingClientRect().top], [11, 22])
    autre.close?.()
  })

  it('le test d\'après trouve encore la méthode d\'origine', () => {
    assert.ok(window.Element.prototype.getBoundingClientRect === ORIGINALE, FUITE)
  })
})
