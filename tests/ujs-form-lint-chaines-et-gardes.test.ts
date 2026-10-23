// Le contrôle « <form> sans action ni méthode » suit les chaînes JavaScript à l'intérieur d'une accolade `{…}` :
// une `}` ou une `{` écrite dans une chaîne ('…', "…", gabarit `…` avec ses `${…}`) ne ferme ni n'ouvre rien. Sans ça,
// la balise n'était jamais refermée et tous les <form> suivants étaient ignorés (avertissement perdu).
// Gardes : une balise qui en contient une autre en valeur n'en ouvre pas de nouvelle ; une balise jamais refermée
// est ignorée (et les suivantes avec elle) ; la ligne citée tient compte de la première ligne du HTML.

import assert from 'node:assert/strict'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'

const nb = (html: string) => checkUjsForm(html, 'mod').length

describe('checkUjsForm — chaînes JavaScript dans une accolade', () => {
  it('« } » dans une chaîne : la balise est refermée au bon endroit', () => {
    assert.equal(nb('<form data-x={ \'}\' }>\n<input>\n</form>'), 1)
    assert.equal(nb('<form data-x={ \'}\' }>\n</form>\n<form>\n</form>'), 2)
    assert.equal(nb('<form data-x={ \'}\' } action="/x">\n</form>\n<form>\n</form>'), 1)
  })

  it('« { » dans une chaîne : pas d\'accolade de plus', () => {
    assert.equal(nb('<form data-x={ \'{\' }>\n</form>\n<form>\n</form>'), 2)
  })

  it('« } » dans une chaîne entre guillemets doubles', () => {
    assert.equal(nb('<form data-x={ "}" } action="/x">\n</form>\n<form>\n</form>'), 1)
    assert.equal(nb('<form data-x={ "{" }>\n</form>\n<form>\n</form>'), 2)
  })

  it('« } » dans une chaîne d\'une directive : l\'envoi retenu est lu, le formulaire suivant est vu', () => {
    assert.equal(nb('<form @submit.prevent={ a(\'}\') } >\n</form>\n<form>\n</form>'), 1)
  })

  it('gabarit avec « } » et « ${…} » imbriqué', () => {
    assert.equal(nb('<form data-x={ `}` } action="/x">\n</form>\n<form>\n</form>'), 1)
    assert.equal(nb('<form data-x={ `a${ \'}\' }b` } action="/x">\n</form>\n<form>\n</form>'), 1)
    assert.equal(nb('<form data-x={ `a${ { b: 1 }.b }}` }>\n</form>\n<form>\n</form>'), 2)
  })

  it('gabarit : un « > » après la « } » de la chaîne ne ferme pas la balise', () => {
    assert.equal(nb('<form data-x={ `}>` } action="/x"></form>'), 0)
    assert.equal(nb('<form data-x={ `a${ \'}\' }>b` } action="/x"></form>'), 0)
    assert.equal(nb('<form data-x={ `a${ `}` }>b` } action="/x"></form>'), 0)
    assert.equal(nb('<form data-x={ `}>` }></form>'), 1)
  })

  it('antislash dans une chaîne : le guillemet échappé ne ferme pas la chaîne', () => {
    assert.equal(nb('<form data-x={ \'\\\'}\' } action="/x">\n</form>\n<form>\n</form>'), 1)
  })
})

describe('checkUjsForm — gardes', () => {
  it('une balise <form> écrite dans une valeur n\'est pas un second formulaire', () => {
    assert.equal(nb('<form title="<form>" action="/x"></form>'), 0)
    assert.equal(nb('<form title="<form>"></form>'), 1)
  })

  it('une accolade jamais refermée est lue comme du texte : la balise finit au « > » suivant, les formulaires d\'après comptent', () => {
    assert.equal(nb('<form data-x={ a\n<form>\n</form>'), 1)
    assert.equal(nb('<form>\n</form>\n<form data-x={ a\n<form>\n</form>'), 2)
  })

  it('la ligne citée part de la première ligne donnée', () => {
    const lignes = (html: string, depart: number) => checkUjsForm(html, 'mod', depart).map(m => Number((m.match(/:(\d+) /) ?? [])[1]))
    assert.deepEqual(lignes('<p></p>\n<form></form>', 1), [2])
    assert.deepEqual(lignes('<p></p>\n<form></form>', 5), [6])
  })
})
