// Dans un <script>, un accès de propriété `obj.$x` / `evt.$el` devenait `obj.$.x` (TypeError à
// l'exécution), alors que la même expression dans le gabarit reste une propriété. Précédé de deux
// points ou plus (`[1..$n]`, `[...$items]`), `$n` reste la variable d'état.

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { monterHote } from './helpers/coeur-monter.js'

describe('lexeur — `obj.$x` dans un <script> reste une propriété', function () {
  this.timeout(60000)

  it('accès de propriété laissé tel quel', () => {
    assert.equal(tokenize('y = obj.$x + evt.$el'), 'y = obj.$x + evt.$el')
    assert.equal(tokenize('y = obj?.$x'), 'y = obj?.$x')
  })

  it('décomposition et plage : toujours la variable d\'état', () => {
    assert.equal(tokenize('y = [...$items]'), 'y = [...$.items]')
    assert.equal(tokenize('y = [1..$n]'), 'y = [1..$.n]')
    assert.equal(tokenize('y = $x'), 'y = $.x')
  })

  it('au montage, la propriété est lue sur l\'objet', async () => {
    const { hote, erreurs } = await monterHote("<script>\nobj = {}\nobj['$x'] = 5\n$v = obj.$x + 1\n</script>\n<p>{$v}</p>", 'propriete-dollar')
    assert.equal(erreurs.length, 0, erreurs.join(' | '))
    assert.equal(hote._shadow?.querySelector('p')?.textContent, '6')
  })
})
