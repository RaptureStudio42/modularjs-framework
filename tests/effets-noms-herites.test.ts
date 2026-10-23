// Un nom d'effet ou de réglage qui est aussi une propriété de tout objet JS (`*constructor`,
// `*neon(toString: 1)`) : refusé comme n'importe quel nom inconnu — avant, le catalogue le trouvait
// (la propriété héritée) et l'effet passait, ou l'erreur disait « écrit deux fois ».

import assert from 'node:assert/strict'
import { parseEffect, effectSpec } from '../src/effects/catalog.js'
import { t } from '../src/messages/index.js'

describe('effets — un nom hérité n\'est pas un nom du catalogue', () => {
  it('*constructor, *toString : effet inconnu', () => {
    for (const nom of ['constructor', 'toString', 'hasOwnProperty']) {
      assert.equal(effectSpec(nom), undefined, nom)
      assert.throws(() => parseEffect(nom, ''), (e: any) => e.message.startsWith(t('effets.inconnu', { nom, liste: '' }).split('—')[0]), nom)
    }
  })

  it('*neon(constructor: 1), *neon(valueOf: 2) : réglage inconnu', () => {
    for (const cle of ['constructor', 'valueOf', 'toString']) {
      assert.throws(() => parseEffect('neon', `${cle}: 1`), (e: any) => e.message.includes(cle) && !/deux fois|twice/.test(e.message), cle)
    }
  })
})
