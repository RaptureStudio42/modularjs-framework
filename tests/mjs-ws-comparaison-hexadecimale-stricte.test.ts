// Comparaison à temps constant en hexadécimal (signatures, hachages) : le décodage s'arrêtait au premier caractère
// illisible, si bien qu'une signature valide suivie de « zz », ou d'un caractère de trop, passait pour égale. Une entrée
// n'est plus comparée que si elle est tout entière de l'hexadécimal, en nombre pair de caractères
import assert from 'node:assert/strict'
import { safeEqual } from '../src/mjs-ws/package-helpers.js'

describe('MJS-WS — comparaison en hexadécimal : seule une entrée bien formée est comparée', function () {
  const sig = 'a3'.repeat(32)

  it('une signature suivie de caractères illisibles ou d’un caractère impair n’est pas égale', () => {
    assert.equal(safeEqual(sig, sig + 'zz', 'hex'), false)
    assert.equal(safeEqual(sig + 'zz', sig, 'hex'), false)
    assert.equal(safeEqual(sig, sig + 'Z', 'hex'), false)
    assert.equal(safeEqual(sig + 'a', sig + 'a', 'hex'), false, 'longueur impaire')
    assert.equal(safeEqual('zz', 'yy', 'hex'), false)
    assert.equal(safeEqual(sig + ' ', sig + ' ', 'hex'), false)
  })

  it('témoins : égales, différentes, majuscules, préfixe, vides', () => {
    assert.equal(safeEqual(sig, sig, 'hex'), true)
    assert.equal(safeEqual(sig, sig.toUpperCase(), 'hex'), true, 'la casse ne change pas les octets')
    assert.equal(safeEqual(sig, 'a4'.repeat(32), 'hex'), false)
    assert.equal(safeEqual(sig, sig.slice(0, 62), 'hex'), false)
    assert.equal(safeEqual('', '', 'hex'), false)
    assert.equal(safeEqual('jeton-1', 'jeton-1'), true, 'en texte, inchangé')
  })
})
