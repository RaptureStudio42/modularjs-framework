// L'auto-déclaration `.=` (applyCivetDialectSugar, transpiler/index.ts) exigeait un espace
// après le signe égal (`\s+`) : `x=5` (aucun espace) ou `x =5` (espace avant seulement)
// n'étaient PAS reconnus comme une affectation à auto-déclarer, contrairement à `x = 5`. Le nom
// ressortait donc NU (jamais déclaré) et provoquait, plus loin dans le pipeline, un message
// trompeur (« nom jamais déclaré ») qui n'a rien à voir avec l'espace manquant.

import assert from 'node:assert/strict'
import { applyMjsSugarToScript, transpile } from '../src/transpiler/index.ts'

describe('auto-déclaration `.=` : l\'espace autour du `=` est optionnel', () => {
  it('`x=5` (aucun espace) est auto-déclaré, comme `x = 5`', () => {
    assert.equal(applyMjsSugarToScript('x=5', 'civet'), 'x.=5')
  })

  it('`x =5` (espace avant seulement) est auto-déclaré', () => {
    assert.equal(applyMjsSugarToScript('x =5', 'civet'), 'x .=5')
  })

  it('`x = 5` (les deux espaces, témoin) reste auto-déclaré comme avant', () => {
    assert.equal(applyMjsSugarToScript('x = 5', 'civet'), 'x .= 5')
  })

  it('ne capture jamais une comparaison `==`, avec ou sans espace', () => {
    assert.equal(applyMjsSugarToScript('x==5', 'civet'), 'x==5')
    assert.equal(applyMjsSugarToScript('x == 5', 'civet'), 'x == 5')
  })

  it('ne capture jamais une égalité stricte `===`', () => {
    assert.equal(applyMjsSugarToScript('x===5', 'civet'), 'x===5')
    assert.equal(applyMjsSugarToScript('x === 5', 'civet'), 'x === 5')
  })

  it('ne capture jamais `>=`/`<=`/`!=`', () => {
    assert.equal(applyMjsSugarToScript('x>=5', 'civet'), 'x>=5')
    assert.equal(applyMjsSugarToScript('x<=5', 'civet'), 'x<=5')
    assert.equal(applyMjsSugarToScript('x!=5', 'civet'), 'x!=5')
  })

  it('`nom = => expr` (arrow, sucre existant) reste auto-déclaré', () => {
    assert.equal(applyMjsSugarToScript('nom = => 1', 'civet'), 'nom .= => 1')
  })

  it('e2e : `<script>x=5</script>` compile sans le message trompeur « nom jamais déclaré »', async function () {
    this.timeout(8000)
    const src = ['<script>', 'x=5', 'console.log(x)', '</script>', '<p>hi</p>'].join('\n')
    await assert.doesNotReject(() => transpile(src, { moduleName: 'autodeclare-sans-espace' }))
  })
})

// régression (\s+ → \s*, ci-dessus) : une flèche Civet COLLÉE au nom (`nom =>`/`nom=>corps`, sucre
// d'appel « nom => corps » ≡ `nom(() => corps)`, JAMAIS une affectation) voyait son `=` consommé
// comme signe d'affectation puis le `>` restant accepté par le repli `[^=]` (« tout sauf = ») — la
// flèche perdait son second caractère (`.=>`), Civet refusait de parser. Cas réel : un composant du
// site (tuto.page.mjs) qui appelle `queueMicrotask =>` (bloc indenté en callback) ne compilait plus.
describe('auto-déclaration `.=` : une flèche Civet collée au nom n\'est jamais une affectation', () => {
  it('`nom =>` (espace avant la flèche, corps sur les lignes suivantes) reste intact', () => {
    const input = 'queueMicrotask =>\n  foo()'
    assert.equal(applyMjsSugarToScript(input, 'civet'), input)
  })

  it('`nom =>` (nom court, même forme) reste intact', () => {
    const input = 'a =>\n  foo()'
    assert.equal(applyMjsSugarToScript(input, 'civet'), input)
  })

  it('`nom=>corps` (aucun espace du tout) reste intact', () => {
    assert.equal(applyMjsSugarToScript('x=>y', 'civet'), 'x=>y')
  })

  it('témoin — `x >= 1` et `x == 1` restent intacts (déjà couvert, non-régression croisée)', () => {
    assert.equal(applyMjsSugarToScript('x >= 1', 'civet'), 'x >= 1')
    assert.equal(applyMjsSugarToScript('x == 1', 'civet'), 'x == 1')
  })

  it('`nom = => expr` (espace de PART ET D\'AUTRE du signe, témoin) reste auto-déclaré', () => {
    assert.equal(applyMjsSugarToScript('f = => 1', 'civet'), 'f .= => 1')
  })

  it('e2e : un composant qui appelle `queueMicrotask =>` (bloc indenté) compile sans erreur', async function () {
    this.timeout(8000)
    const src = [
      '<script>',
      '@go = ->',
      '  queueMicrotask =>',
      '    console.log(1)',
      '</script>',
      '<button @click={go()}>x</button>',
    ].join('\n')
    await assert.doesNotReject(() => transpile(src, { moduleName: 'autodeclare-fleche-collee' }))
  })
})
