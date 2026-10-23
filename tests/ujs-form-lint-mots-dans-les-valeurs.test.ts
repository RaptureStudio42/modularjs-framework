// Le contrôle « <form> sans action ni méthode » ne lit pas les mots d'une valeur entre guillemets : un
// `title="… action …"`, `title="voir @method ici"` ou `title="mettre @noUJS ici"` n'est ni une action, ni une
// méthode, ni un refus d'UJS — le formulaire reste signalé. Les vraies directives, elles, comptent toujours,
// que l'attribut qui les porte ait une valeur ou non.

import assert from 'node:assert/strict'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'

const messages = (html: string): string[] => checkUjsForm(html, 'carte')

describe('<form> sans action ni méthode : les valeurs entre guillemets ne comptent pas', () => {
  const leurres: Array<[string, string]> = [
    ['title="… action …"',                  '<form title="voir action ici"></form>'],
    ['title="… action=…"',                  '<form title="voir action=x ici"></form>'],
    ['title entre guillemets simples',      '<form title=\'une action ici\'></form>'],
    ['title="voir @method ici"',            '<form title="voir @method ici"></form>'],
    ['title="mettre @noUJS ici"',           '<form title="mettre @noUJS ici"></form>'],
    ['title="mettre @no-ujs ici"',          '<form title="mettre @no-ujs ici"></form>'],
    ['title="forme compilée mjs-no-ujs"',   '<form title="la forme compilée mjs-no-ujs ici"></form>'],
    ['title="forme compilée mjs-method"',   '<form title="la forme compilée mjs-method ici"></form>'],
    ['data-aide="action=\'/x\'"',           '<form data-aide="écrire action=\'/x\' ici"></form>'],
    ['un leurre et un autre attribut',      '<form class="a" title="ajoutez @method ici" id="f"></form>'],
    ['un leurre sur plusieurs lignes',      '<form\n  title="voir\n  @noUJS ici"\n  class="a"></form>']
  ]
  for (const [nom, html] of leurres) {
    it(`${nom} : le formulaire reste signalé`, () => {
      assert.equal(messages(html).length, 1, html)
    })
  }

  const vraies: Array<[string, string]> = [
    ['action="/envoi"',                    '<form action="/envoi"></form>'],
    ['action entre guillemets simples',    '<form action=\'/envoi\'></form>'],
    ['action = "/envoi" (espaces)',        '<form action = "/envoi"></form>'],
    ['action={url} (dynamique)',           '<form action={url}></form>'],
    ['action="{url}" (valeur mêlée)',      '<form action="{url}"></form>'],
    ['@action nu',                         '<form @action></form>'],
    ['@method="post"',                     '<form @method="post"></form>'],
    ['@method nu',                         '<form @method></form>'],
    ['mjs-method="post" (forme compilée)', '<form mjs-method="post"></form>'],
    ['@noUJS',                             '<form @noUJS></form>'],
    ['@no-ujs',                            '<form @no-ujs></form>'],
    ['mjs-no-ujs (forme compilée)',        '<form mjs-no-ujs></form>'],
    ['@submit.prevent={…}',                '<form @submit.prevent={envoyer()}></form>']
  ]
  for (const [nom, html] of vraies) {
    it(`${nom} : rien à signaler`, () => {
      assert.deepEqual(messages(html), [], html)
    })
  }

  it('un leurre à côté de la vraie directive : la vraie directive compte', () => {
    assert.deepEqual(messages('<form title="voir action ici" action="/envoi"></form>'), [])
    assert.deepEqual(messages('<form title="voir @method ici" @method="post"></form>'), [])
    assert.deepEqual(messages('<form title="mettre @noUJS ici" @noUJS></form>'), [])
    assert.deepEqual(messages('<form title="a" @no-ujs title2="@method"></form>'), [])
  })

  it('action="" reste une action absente, avec ou sans espaces autour du =', () => {
    assert.equal(messages('<form action=""></form>').length, 1)
    assert.equal(messages('<form action = \'\'></form>').length, 1)
    assert.equal(messages('<form title="x" action=""></form>').length, 1)
  })

  it('le message cite la ligne du formulaire', () => {
    const [m] = messages('<p>a</p>\n<form title="voir @method ici"></form>\n')
    assert.match(m, /2/)
  })
})
