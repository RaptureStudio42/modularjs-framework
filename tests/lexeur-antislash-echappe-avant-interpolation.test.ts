// Un antislash ÉCHAPPÉ juste avant une interpolation (`C:\\${$y}`, `"C:\\#{$y}"`) était pris pour une
// interpolation échappée : le lexeur ne regardait que le caractère précédent. `$y` restait tel quel, la
// construction passait au vert et le composant plantait au montage (« $y is not defined »).

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { monterHote } from './helpers/coeur-monter.js'

describe('lexeur — antislash échappé juste avant une interpolation', function () {
  this.timeout(60000)

  it('gabarit `C:\\\\${$y}` : $y est réécrit', () => {
    assert.equal(tokenize('x = `C:\\\\${$y}`'), 'x = `C:\\\\${$.y}`')
  })

  it('chaîne "C:\\\\#{$y}" : $y est réécrit', () => {
    assert.equal(tokenize('x = "C:\\\\#{$y}"'), 'x = "C:\\\\#{$.y}"')
  })

  it('interpolation échappée : reste du texte', () => {
    assert.equal(tokenize('x = `C:\\${$y}`'), 'x = `C:\\${$y}`')
    assert.equal(tokenize('x = `C:\\\\\\${$y}`'), 'x = `C:\\\\\\${$y}`')
    assert.equal(tokenize('x = "C:\\#{$y}"'), 'x = "C:\\#{$y}"')
  })

  it('au montage, le chemin s\'affiche avec son antislash', async () => {
    const { hote, erreurs } = await monterHote("<script>\n$y = 'dossier'\n$t = `C:\\\\${$y}`\n</script>\n<p>{$t}</p>", 'antislash-interpolation')
    assert.equal(erreurs.length, 0, erreurs.join(' | '))
    assert.equal(hote._shadow?.querySelector('p')?.textContent, 'C:\\dossier')
  })
})
