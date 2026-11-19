// une barre oblique qui suit un `++` ou un `--` posé APRÈS son opérande (un nom, une parenthèse ou un crochet fermants) divise : ce qui la
// suit sur sa ligne, jusqu'à une autre barre, reste du code pour chaque lecture qui met de côté ce qui n'en est pas — le relevé des appels
// d'une unité (garde du contrat du cœur), la garde des accès à un nom interne par une chaîne, le relevé des outils qu'un effet appelle et
// le retrait des textes de secours des messages. Posé AVANT son opérande (`++/a/.lastIndex`), il laisse la barre ouvrir une expression
// régulière, dont le motif reste hors du code. Une barre qui suit un nom fini par une lettre accentuée (`unité / 2`) divise aussi

import assert from 'node:assert/strict'
import { collectCoreCalls } from '../src/bundler/core-contract.js'
import { blankNonCode, stripMsgFallbacks, assertNoStringIndexedMjsAccess } from '../src/bundler/minify.js'
import { fxToolsCalled } from '../src/bundler/fx-tools.js'

// [ce qui précède la barre, comment le dire]
const POSTFIXES: Array<[string, string]> = [
  ['compte++', 'un `++` après un nom'],
  ['compte--', 'un `--` après un nom'],
  ['compte ++', 'un `++` séparé de son nom par une espace'],
  ['this.n++', 'un `++` après un champ'],
  ['notes[i]++', 'un `++` après un crochet fermant'],
  ['(a.b)--', 'un `--` après une parenthèse fermante'],
]

describe('lecture du code : la barre oblique après un `++` ou un `--`', () => {
  for (const [avant, dit] of POSTFIXES) {
    it(`${dit} : la barre divise, l'appel écrit ensuite sur la ligne est relevé`, () => {
      const ligne = `const m = ${avant} / 2; µ._mjs_deepCall(_mjsThis, ['liste'], 'push', [m]); µ._set(_mjsThis, 'total', m / 4);`
      assert.deepEqual([...collectCoreCalls(ligne)].sort(), ['_mjs_deepCall', '_set'])
    })
  }

  it('une barre qui suit un nom fini par une lettre accentuée divise : l\'appel écrit ensuite sur la ligne est relevé', () => {
    const ligne = 'const part = unité / 2; µ._mjs_deepCall(_mjsThis, [\'parts\'], \'push\', [part]); µ._set(_mjsThis, \'total\', part / 4);'
    assert.deepEqual([...collectCoreCalls(ligne)].sort(), ['_mjs_deepCall', '_set'])
  })

  it('un `++` après un nom fini par une lettre accentuée : la barre divise', () => {
    const ligne = 'const part = unité++ / 2; µ._mjs_deepCall(_mjsThis, [\'parts\'], \'push\', [part]); µ._set(_mjsThis, \'total\', part / 4);'
    assert.deepEqual([...collectCoreCalls(ligne)].sort(), ['_mjs_deepCall', '_set'])
  })

  it('une ligne sans chaîne ni commentaire reste entière, quel que soit le nombre de ses divisions', () => {
    const ligne = 'const m = compte++ / 2; const q = notes[i]-- / m; µ._mjs_rawWrite(_mjsThis).n = q / 4;'
    assert.equal(blankNonCode(ligne), ligne)
  })

  it('un `++` ou un `--` posé avant son opérande : la barre ouvre une expression régulière, son apostrophe n\'ouvre aucune chaîne', () => {
    for (const signe of ['++', '--']) {
      const ligne = `const n = ${signe}/'/.lastIndex; µ._mjs_deepCall(_mjsThis, ['liste'], 'push', [n]); const fin = 'texte';`
      assert.deepEqual([...collectCoreCalls(ligne)], ['_mjs_deepCall'], signe)
    }
  })

  it('après un mot-clé (`return ++/…/`), le `++` précède son opérande : la barre ouvre une expression régulière', () => {
    const ligne = 'const f = () => { return ++/\'/.lastIndex; }; µ._mjs_deepCall(_mjsThis, [\'liste\'], \'push\', [1]); const fin = \'texte\';'
    assert.deepEqual([...collectCoreCalls(ligne)], ['_mjs_deepCall'])
  })

  it('après un retour à la ligne, le `++` précède son opérande : la barre ouvre une expression régulière', () => {
    const lignes = 'let a = b\n++/\'/.lastIndex; µ._mjs_deepCall(_mjsThis, [\'liste\'], \'push\', [1]); const fin = \'texte\';'
    assert.deepEqual([...collectCoreCalls(lignes)], ['_mjs_deepCall'])
  })

  it('la garde des accès à un nom interne par une chaîne voit celui qui suit un `++` et une division', () => {
    const ligne = 'const m = compte++ / 2; cible[\'_mjs_secret\'] = m; const q = m / 4;'
    assert.throws(() => assertNoStringIndexedMjsAccess(ligne, 'essai.js'), /_mjs_secret/)
  })

  it('le relevé des outils d\'un effet voit l\'outil appelé après un `++` et une division', () => {
    const ligne = 'const pas = tour++ / 2; µ._mjs_fxEvery(el, pas); const suite = pas / 4;'
    assert.ok(fxToolsCalled(ligne).has('fx_toolbeat'), 'outils relevés : ' + ([...fxToolsCalled(ligne)].join(', ') || 'aucun'))
  })

  it('le texte de secours d\'un message écrit après un `++` et une division est retiré, comme sans eux', () => {
    const sans = 'const m = compte / 2; µ._mjs_msg(\'cle\', {}, \'texte de secours\'); const q = m / 4;'
    const avec = 'const m = compte++ / 2; µ._mjs_msg(\'cle\', {}, \'texte de secours\'); const q = m / 4;'
    assert.equal(stripMsgFallbacks(sans), 'const m = compte / 2; µ._mjs_msg(\'cle\', {}); const q = m / 4;', 'garde muette : le texte de secours part d\'une ligne sans `++`')
    assert.equal(stripMsgFallbacks(avec), 'const m = compte++ / 2; µ._mjs_msg(\'cle\', {}); const q = m / 4;')
  })
})
