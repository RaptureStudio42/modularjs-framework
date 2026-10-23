// Le contrôle d'accessibilité et le contrôle « <form> sans action » découpent une balise ouverte de la même façon :
// les accolades `{…}` d'un attribut sont sautées d'un bloc (chaînes, gabarits, littéraux regex et commentaires
// compris), un `>` ou un guillemet qui s'y trouve ne ferme rien. Le découpage reste linéaire, et une accolade
// jamais refermée n'efface pas les balises qui suivent.

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'

const nb = (html: string) => checkUjsForm(html, 'mod').length

describe('découpage partagé — accolades d\'attribut dans le lint a11y', () => {
  it('une regex avec apostrophe dans deux attributs : l\'<img> entre les deux garde son alerte, ligne 2', () => {
    const alertes = checkA11y('<p c={ /\'/.test(x) }>t</p>\n<img src="x">\n<b c={ /\'/.test(y) }>u</b>', 'M')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 2/)
  })

  it('une chaîne avec apostrophe dans une accolade : l\'<img> suivante garde son alerte', () => {
    const alertes = checkA11y('<p c={ "l\'un" }>t</p>\n<img src="x">\n<b c={ "l\'autre" }>u</b>', 'M')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 2/)
  })

  it('les « < » et « > » d\'une valeur entre guillemets ne sont pas du balisage, les lignes restent justes', () => {
    assert.deepEqual(checkA11y('<span data-x="<input>">?</span>\n', 'v'), [])
    const alertes = checkA11y('<p title="a<b>\nc">x</p>\n<img src="y">\n', 'v')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 3/)
  })

  it('un commentaire HTML dans un lien ne donne pas son nom au lien', () => {
    assert.equal(checkA11y('<a href="#"><!-- texte --></a>\n', 'v').length, 1)
    assert.equal(checkA11y('<button><!-- texte --></button>\n', 'v').length, 1)
  })

  it('un commentaire HTML qui contient un « > » ne donne pas son texte au lien ni au bouton', () => {
    assert.equal(checkA11y('<a href="#"><!-- a > b --></a>\n', 'v').length, 1)
    assert.equal(checkA11y('<button><!-- a > b --></button>\n', 'v').length, 1)
  })

  it('les « <> » d\'une valeur dans un <code> gardent la longueur : la ligne d\'un lien vide plus bas reste juste', () => {
    const alertes = checkA11y('<code><b title="<><><><><><><><><><><><><><>">k</b></code>\n<p>x</p>\n<a href="#"></a>\n', 'v')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 3/)
  })

  it('un commentaire HTML multi-lignes garde les lignes justes', () => {
    const alertes = checkA11y('<!-- a\nb\nc -->\n<img src="y">\n', 'v')
    assert.match(alertes[0], /ligne 4/)
  })
})

describe('découpage partagé — accolades dans le lint <form>', () => {
  it('une « } » dans un commentaire « // » ne ferme pas l\'accolade', () => {
    assert.equal(nb('<form data-x={ a // } >\n } action="/x"></form>'), 0)
  })

  it('une « } » dans un littéral regex ne ferme pas l\'accolade', () => {
    assert.equal(nb('<form data-x={ /}/.test(x) > 1 } action="/x"></form>'), 0)
    assert.equal(nb('<form data-x={ /[}]/.test(x) } action="/x"></form>'), 0)
  })

  it('une apostrophe isolée dans une accolade n\'avale pas les lignes suivantes', () => {
    assert.equal(nb('<form data-x={ it\'s } action="/x">\n</form>\n<p>l\'a</p>\n<form></form>'), 1)
  })

  it('un « ${…} » avec gabarit imbriqué est sauté d\'un bloc', () => {
    assert.equal(nb('<form data-x={ `a${ `}` }>b` } action="/x"></form>'), 0)
    assert.equal(nb('<form data-x={ `a${ \'}\' }>b` } action="/x"></form>'), 0)
  })

  it('@submit.prevent collé à la fermeture d\'une valeur est lu', () => {
    assert.equal(nb('<form title="a"@submit.prevent></form>'), 0)
    assert.equal(nb('<form title="a @submit.prevent"></form>'), 1)
  })

  it('une accolade jamais refermée n\'efface pas les formulaires suivants', () => {
    assert.equal(nb('<form class={ a >\n</form>\n<form>\n</form>'), 2)
    assert.equal(nb('<form data-x={ a\n<form>\n</form>'), 1)
    assert.equal(nb('<form>\n</form>\n<form data-x={ a\n<form>\n</form>'), 2)
  })
})

describe('découpage partagé — coût linéaire', () => {
  it('32 000 « {if i<n} » sans « > » : a11y et <form> rendent en moins de 3 s', () => {
    const texte = '{if i<n}\n'.repeat(32000)
    let t0 = Date.now()
    checkA11y(texte, 'M')
    const a11y = Date.now() - t0
    t0 = Date.now()
    checkUjsForm(texte + '<form>', 'M')
    const form = Date.now() - t0
    assert.ok(a11y < 3000, `a11y : ${a11y} ms`)
    assert.ok(form < 3000, `form : ${form} ms`)
  })

  it('16 000 accolades jamais refermées dans des balises : moins de 3 s', () => {
    const texte = '<form {\n'.repeat(16000)
    const t0 = Date.now()
    checkUjsForm(texte, 'M')
    checkA11y(texte, 'M')
    const ms = Date.now() - t0
    assert.ok(ms < 3000, `${ms} ms`)
  })
})
