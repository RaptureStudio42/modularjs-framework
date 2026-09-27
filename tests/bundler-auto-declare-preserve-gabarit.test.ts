// Test de régression : `autoDeclareTopLevelBareAssignments` (src/bundler/index.ts) décide
// ligne par ligne, SANS masquer les chaînes/gabarits — une ligne NON INDENTÉE qui ressemble à
// une affectation bare top-level (`total = 0`) mais qui vit en réalité À L'INTÉRIEUR d'un
// template literal multiligne (texte de documentation exporté par un module) recevait quand
// même un `var ` injecté EN PLEIN MILIEU DE LA CHAÎNE — le texte affiché à l'écran sortait
// corrompu (`var total = 0` au lieu de `total = 0`), sans la moindre erreur de build.
//
// Fix : la détection (déclarations ET affectations bare) se décide sur une vue MASQUÉE
// (chaînes/gabarits/commentaires blanchis, même longueur) — seul le texte RÉEL est réécrit,
// jamais l'intérieur d'un gabarit.

import assert from 'node:assert/strict'
import { autoDeclareTopLevelBareAssignments } from '../src/bundler/index.js'
import { getAdapter } from '../src/languages/index.js'

describe('bundler — autoDeclareTopLevelBareAssignments (préserve le texte des gabarits)', function () {
  it('une ligne "total = 0" DANS un template literal multiligne n\'est jamais réécrite', function () {
    const input = [
      'const doc = `',
      'Exemple de code affiché dans la doc :',
      'total = 0',
      '`',
      'console.log(doc)',
    ].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input, 'le contenu du gabarit ne doit JAMAIS être modifié')
    assert.equal(output.includes('var total = 0'), false)
  })

  it('une VRAIE bare top-level continue de recevoir son var, même quand un gabarit voisin contient le même texte', function () {
    const input = [
      'const doc = `',
      'total = 0',
      '`',
      'total = 5',
      'console.log(doc, total)',
    ].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    const lignes = output.split('\n')
    assert.equal(lignes[1], 'total = 0', 'le contenu du gabarit reste intact')
    assert.equal(lignes[3], 'var total = 5', 'la VRAIE bare top-level, hors gabarit, reçoit bien son var')
  })

  it('export helpText = `...total = 0...` compilé par le VRAI adaptateur Civet : le gabarit exporté reste intact', async function () {
    this.timeout(10000)
    const civetSrc = ['export helpText = `', 'Exemple :', 'total = 0', '`'].join('\n')
    const adapter = getAdapter('civet')
    const { code } = await adapter.compileToJs(civetSrc, { fileName: 'aide.civet', bare: true })
    const after = autoDeclareTopLevelBareAssignments(code)
    assert.equal(after.includes('var total = 0'), false, `le texte exporté ne doit pas recevoir de var : ${after}`)
    assert.match(after, /total = 0/, 'le texte original doit survivre tel quel')
  })
})
