// le lint d'accessibilité ne coupe plus une balise au `>` d'une flèche (`->`, `=>`) ou d'une comparaison écrite
// dans une accolade d'attribut : fausses alertes (image « sans alt », div « non interactive ») et alerte manquée
// (bouton sans nom dont le gestionnaire est une flèche)

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'
import { t } from '../src/messages/index.js'

describe('lint a11y — `>` dans une accolade d\'attribut', () => {
  it('<img src={$n > 0 ? …} alt="photo"> : aucune alerte', () => {
    assert.deepEqual(checkA11y('<img src={$n > 0 ? "a.png" : "b.png"} alt="photo">', 'carte'), [])
  })

  it('<div @click={-> $n++} role="button" tabindex="0"> : aucune alerte', () => {
    assert.deepEqual(checkA11y('<div @click={-> $n++} role="button" tabindex="0">x</div>', 'carte'), [])
  })

  it('<button @click={-> $n++}> qui ne contient qu\'une icône : bouton sans nom signalé', () => {
    assert.deepEqual(checkA11y('<button @click={-> $n++}><svg></svg></button>', 'carte'), [t('transpiler.a11y-bouton-nom-manquant', { moduleName: 'carte', ligne: 1 })])
  })

  it('témoin : une flèche sur un <button> qui a un aria-label', () => {
    assert.deepEqual(checkA11y('<button @click={=> $n++} aria-label="Fermer"><svg></svg></button>', 'carte'), [])
  })
})
