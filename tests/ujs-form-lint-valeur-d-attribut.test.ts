// Le contrôle « <form> sans action ni méthode » reconnaît un `@submit.prevent` par sa DIRECTIVE, jamais par
// du texte rencontré dans la valeur d'un autre attribut : `<form title="astuce @submit.prevent ici">` n'est
// pas un formulaire dont l'envoi est retenu, l'avertissement reste dû. Défaut garanti absent : la recherche
// lisait toute la balise, valeurs de ses attributs comprises, et se taisait à tort.
// Gardes : une vraie directive (nue, avec valeur, parmi d'autres modificateurs, après un attribut qui porte
// le même texte) continue de taire le contrôle ; `@submit.emit.prevent` (événement nommé « prevent ») ne
// retient pas l'envoi.

import assert from 'node:assert/strict'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'

describe('checkUjsForm — @submit.prevent reconnu par sa directive, pas par une valeur d\'attribut', () => {
  it('« @submit.prevent » dans un title entre guillemets doubles : avertit', () => {
    assert.equal(checkUjsForm('<form title="astuce @submit.prevent ici"></form>', 'mod').length, 1)
  })

  it('« @submit.prevent » dans un title entre guillemets simples : avertit', () => {
    assert.equal(checkUjsForm('<form title=\'astuce @submit.prevent ici\'></form>', 'mod').length, 1)
  })

  it('« @submit.prevent » dans la valeur d\'un autre attribut (aria-label, data-*) : avertit', () => {
    assert.equal(checkUjsForm('<form aria-label="envoi @submit.prevent" class="f"></form>', 'mod').length, 1)
    assert.equal(checkUjsForm('<form data-aide="écrire @submit.prevent.stop sur le formulaire"></form>', 'mod').length, 1)
  })

  it('« @submit.prevent » dans une chaîne de l\'expression d\'une directive : avertit', () => {
    assert.equal(checkUjsForm('<form @click={noter(\'@submit.prevent\')}></form>', 'mod').length, 1)
  })

  it('la vraie directive, nue : silence', () => {
    assert.deepEqual(checkUjsForm('<form @submit.prevent></form>', 'mod'), [])
  })

  it('la vraie directive, avec sa valeur : silence', () => {
    assert.deepEqual(checkUjsForm('<form @submit.prevent={verifier()}></form>', 'mod'), [])
    assert.deepEqual(checkUjsForm('<form @submit.prevent="verifier()"></form>', 'mod'), [])
  })

  it('la vraie directive parmi d\'autres modificateurs, ou après un attribut qui porte le même texte : silence', () => {
    assert.deepEqual(checkUjsForm('<form @submit.stop.prevent={f()}></form>', 'mod'), [])
    assert.deepEqual(checkUjsForm('<form title="@submit.prevent" @submit.prevent={f()}></form>', 'mod'), [])
  })

  it('« @submit.emit.prevent » émet un événement nommé « prevent » : ne retient pas l\'envoi, avertit', () => {
    assert.equal(checkUjsForm('<form @submit.emit.prevent></form>', 'mod').length, 1)
  })
})
