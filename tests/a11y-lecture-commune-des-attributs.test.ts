// Le contrôle d'accessibilité ne compte que les vrais attributs d'une balise : le nom d'un attribut écrit dans la VALEUR d'un autre
// (`placeholder="x aria-label y"`, `data-note="tabindex='3'"`) n'en est pas un. Sans ça, ce texte faisait taire une alerte due (champ sans
// étiquette, image sans alt, iframe sans title, bouton ou lien sans nom, @click sans rôle) ou en levait une fausse (tabindex positif, @click
// sur une balise qui n'en a pas). Toutes les règles lisent les attributs de la même façon : leurs noms hors des valeurs entre guillemets, et
// leurs valeurs comme le navigateur (sans guillemets, des blancs autour de `=`) ; tabindex se lit comme un entier (« -2 », « -01 », « +3 »).

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'

const alertes = (src: string) => checkA11y(src + '\n', 'valeurs')

describe('lint.a11y — le nom d\'un attribut écrit dans la valeur d\'un autre n\'est pas un attribut', () => {
  it('un champ dont une valeur cite aria-label, aria-labelledby, title ou id : l\'alerte « sans étiquette » reste', () => {
    for (const src of ['<input name="a" placeholder="x aria-label y">', '<input name="a" placeholder="x aria-labelledby=y">', '<input name="a" placeholder="titre title=x">', '<input name="a" placeholder="votre id ici">', '<textarea placeholder="a aria-label b"></textarea>']) {
      const a = alertes(src)
      assert.equal(a.length, 1, src)
      assert.match(a[0], /<(input|textarea)>/, src)
    }
  })

  it('une image ou une iframe dont une valeur cite alt ou title : l\'alerte reste', () => {
    const img = alertes('<img src="a.png" data-note="photo alt manquant">')
    assert.equal(img.length, 1)
    assert.match(img[0], /<img>/)
    const cadre = alertes('<iframe src="/x" data-note="title absent"></iframe>')
    assert.equal(cadre.length, 1)
    assert.match(cadre[0], /<iframe>/)
  })

  it('un bouton ou un lien vides dont une valeur cite aria-label ou title : l\'alerte reste', () => {
    const bouton = alertes('<button data-note="x aria-label y"></button>')
    assert.equal(bouton.length, 1)
    assert.match(bouton[0], /<button>/)
    const lien = alertes('<a href="/x" data-note="sans title ici"></a>')
    assert.equal(lien.length, 1)
    assert.match(lien[0], /<a>/)
  })

  it('@click sur une balise non interactive dont une valeur cite role, tabindex ou @keydown : l\'alerte reste', () => {
    for (const src of ['<div @click={x} data-note="x role y tabindex z">x</div>', '<div @click={x} role="presentation" title="appuyez @keydown ici">x</div>']) {
      const a = alertes(src)
      assert.equal(a.length, 1, src)
      assert.match(a[0], /@click/, src)
    }
  })

  it('@click ou tabindex="3" écrits dans une valeur : aucune fausse alerte', () => {
    assert.deepEqual(alertes('<div title="cliquez @click ici">x</div>'), [])
    assert.deepEqual(alertes('<span data-note="tabindex=\'3\'">x</span>'), [])
    assert.deepEqual(alertes('<p title=\'tabindex="2"\'>x</p>'), [])
  })

  it('un vrai tabindex positif garde son alerte, à la ligne de l\'attribut', () => {
    const a = alertes('<p>a</p>\n<span data-note="x"\n  tabindex="2">b</span>')
    assert.equal(a.length, 1)
    assert.match(a[0], /tabindex="2"/)
    assert.match(a[0], /(ligne|line) 3\b/)
  })

  it('une <label> dont une valeur cite for="id" n\'étiquette pas le champ : l\'alerte reste', () => {
    const a = alertes('<label title="for=\'nom\'">Nom</label>\n<input id="nom">')
    assert.equal(a.length, 1)
    assert.match(a[0], /<input>/)
    assert.deepEqual(alertes('<label for="nom">Nom</label>\n<input id="nom">'), [], 'un vrai for étiquette le champ')
  })

  it('un <@@field label> nu dont une valeur cite label= : le champ n\'est pas nommé, l\'alerte reste', () => {
    const a = alertes('<@@field label data-note="x label= y"><input name="a"></@@field>')
    assert.equal(a.length, 1)
    assert.match(a[0], /<input>/)
  })

  it('un champ caché aux lecteurs d\'écran et hors du parcours au clavier, écrit sans guillemets, avec des blancs autour de « = » ou un tabindex négatif quelconque : pas d\'alerte', () => {
    for (const src of ['<input name="a" aria-hidden=true tabindex=-1>', '<input name="a" aria-hidden="true" tabindex="-2">', '<input name="a" aria-hidden="true" tabindex="-01">', '<input name="a" aria-hidden = "true" tabindex = "-1">', '<textarea aria-hidden=\'true\' tabindex=\' -1px\'></textarea>']) {
      assert.deepEqual(alertes(src), [], src)
    }
  })

  it('tabindex nul, positif ou illisible : le champ reste atteignable, l\'alerte « sans étiquette » reste', () => {
    for (const src of ['<input name="a" aria-hidden="true" tabindex="0">', '<input name="a" aria-hidden="true" tabindex="+1">', '<input name="a" aria-hidden="true" tabindex="x">', '<input name="a" aria-hidden="true" tabindex="--1">']) {
      const a = alertes(src)
      assert.ok(a.some(m => /<input>/.test(m)), src)
    }
  })

  it('un tabindex positif écrit sans guillemets, avec des blancs autour de « = » ou en « +3 » garde son alerte', () => {
    for (const [src, valeur] of [['<span tabindex=3>x</span>', '3'], ['<span tabindex = "2">x</span>', '2'], ['<span tabindex="+3">x</span>', '+3']]) {
      const a = alertes(src)
      assert.equal(a.length, 1, src)
      assert.ok(a[0].includes('tabindex="' + valeur + '"'), src)
    }
    assert.deepEqual(alertes('<span tabindex={n}>x</span>'), [], 'une valeur dynamique est inconnue au build')
  })
})
