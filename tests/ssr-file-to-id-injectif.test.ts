// fileToId (renderToString.ts) donnait le même identifiant interne à deux fichiers compilés
// distincts : le remplacement caractère par caractère encode chaque séparateur en `_<code>_`
// (`-` → `_45_`), mais un underscore LITTÉRAL du nom d'origine traverse tel quel (il fait déjà
// partie de `\w`) — un fichier `a-b.js` et un fichier `a_45_b.js` produisaient tous les deux
// `_mjsF_a_45_b` : dans les maps par-id du SSR (codeById/idToFile), le second écrase le premier,
// le mauvais code s'exécute pour l'un des deux composants.
import assert from 'node:assert/strict'
import { fileToId } from '../src/server/renderToString.js'

describe('fileToId — encodage injectif (jamais deux fichiers différents vers le même identifiant)', function () {
  it('a-b.js et a_45_b.js ne collisionnent plus', function () {
    const idA = fileToId('a-b.js')
    const idB = fileToId('a_45_b.js')
    assert.notEqual(idA, idB, `collision : a-b.js -> ${idA} , a_45_b.js -> ${idB}`)
  })

  it('un underscore littéral simple reste distinct de son absence', function () {
    assert.notEqual(fileToId('a_b.js'), fileToId('ab.js'))
  })

  it('deux underscores littéraux consécutifs restent distincts de deux séparateurs différents', function () {
    assert.notEqual(fileToId('a__b.js'), fileToId('a-.-b.js'))
  })

  it('un nom sans séparateur ni underscore reste inchangé (pas de régression du cas courant)', function () {
    assert.equal(fileToId('helper.js'), '_mjsF_helper')
  })
})
