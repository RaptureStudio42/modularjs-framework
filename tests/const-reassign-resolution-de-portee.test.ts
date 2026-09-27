// findConstReassignment (src/transpiler/const-reassign.ts) — contrôle UNIQUE de la réaffectation
// d'une constante Civet (`:=` → `const`), par résolution de portée EXACTE sur le JS déjà compilé,
// commun aux deux chemins de compilation (module .civet autonome du bundler, <script> de
// composant du transpiler — chacun testé de bout en bout ailleurs : bundler-auto-declare-
// destructuring.test.ts, transpiler-reaffectation-identifiant-constant.test.ts,
// transpiler-destructuration-puis-reaffectation.test.ts). Ce fichier-ci teste directement la
// fonction, sur des formes JS écrites à la main, pour ISOLER chaque motif de résolution de portée
// (fonctions, blocs, boucles, catch, masquage) sans dépendre d'une syntaxe Civet précise pour
// chacune — utile en particulier pour `for (x of …)` SANS déclaration : Civet lui-même déclare
// TOUJOURS sa propre liaison pour un `for x of liste` (jamais de forme nue observée en pratique,
// cf. sondes), la fonction partagée doit rester correcte sur cette forme si elle apparaît par un
// autre chemin (JS écrit à la main dans un module, sortie d'un autre langage cible).

import assert from 'node:assert/strict'
import { findConstReassignment } from '../src/transpiler/const-reassign.js'

describe('findConstReassignment — cibles d\'affectation refusées (réaffectation d\'un const)', () => {
  it('identifiant simple : const x = 0; x = 10', () => {
    const v = findConstReassignment('const x = 0\nx = 10')
    assert.deepEqual(v, { name: 'x', line: 2 })
  })

  it('déstructuration objet en cible : const {w, h} = f(); w = 10', () => {
    const v = findConstReassignment('const {w, h} = f()\nw = 10')
    assert.deepEqual(v, { name: 'w', line: 2 })
  })

  it('déstructuration tableau en cible : const [a, b] = f(); [a, tmp] = [tmp, a]', () => {
    const v = findConstReassignment('const [a, b] = f()\nlet tmp\n;[a, tmp] = [tmp, a]')
    assert.deepEqual(v, { name: 'a', line: 3 })
  })

  it('affectations composées : +=, ||=, ??=, **=, &&=', () => {
    for (const op of ['+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']) {
      const v = findConstReassignment(`const x = 1\nx ${op} 1`)
      assert.deepEqual(v, { name: 'x', line: 2 }, `opérateur ${op}`)
    }
  })

  it('incrément/décrément : x++, ++x, x--, --x', () => {
    for (const forme of ['x++', '++x', 'x--', '--x']) {
      const v = findConstReassignment(`const x = 1\n${forme}`)
      assert.deepEqual(v, { name: 'x', line: 2 }, forme)
    }
  })

  it('bloc indenté SANS fonction (if/while) : accumulateur sur une constante', () => {
    assert.deepEqual(findConstReassignment('const total = 0\nif (cond) {\n  total += 1\n}'), { name: 'total', line: 3 })
    assert.deepEqual(findConstReassignment('const total = 0\nlet i = 0\nwhile (i < 3) {\n  total += i\n  i++\n}'), { name: 'total', line: 4 })
  })

  it('for (const x of …) : réaffectation de SA PROPRE liaison, dans le corps', () => {
    assert.deepEqual(findConstReassignment('for (const x of [1, 2, 3]) {\n  x = 5\n}'), { name: 'x', line: 2 })
  })

  it('for (x of …) SANS déclaration : réaffecte une constante externe homonyme à chaque tour', () => {
    assert.deepEqual(findConstReassignment('const x = 1\nfor (x of [1, 2, 3]) {\n  console.log(x)\n}'), { name: 'x', line: 2 })
  })

  it('fonction imbriquée SANS homonyme local : réaffectation d\'une constante externe', () => {
    const js = 'const x = 1\nconst inner = function () {\n  x = 6\n  return x\n}'
    assert.deepEqual(findConstReassignment(js), { name: 'x', line: 3 })
  })

  it('fonction fléchée à corps expression : (x = 5) réaffecte une constante externe', () => {
    assert.deepEqual(findConstReassignment('const x = 1\nconst f = () => (x = 5)'), { name: 'x', line: 2 })
  })

  it('try/finally : une constante réaffectée dans le bloc finally', () => {
    const js = 'const done = false\ntry {\n  console.log(1)\n} finally {\n  done = true\n}'
    assert.deepEqual(findConstReassignment(js), { name: 'done', line: 5 })
  })

  it('la portée du for-loop ne fuit jamais vers le code qui SUIT la boucle', () => {
    // `for (const i of …)` a sa PROPRE liaison, éteinte à la fin de la boucle : la constante
    // externe homonyme reste intacte et REFUSE toujours sa réaffectation après coup.
    const js = 'const i = 999\nfor (const i of [1, 2, 3]) { }\ni = 5'
    assert.deepEqual(findConstReassignment(js), { name: 'i', line: 3 })
  })

  it('rend la PREMIÈRE violation dans l\'ordre du texte (pas la dernière trouvée)', () => {
    const js = 'const a = 1\nconst b = 2\na = 10\nb = 20'
    assert.deepEqual(findConstReassignment(js), { name: 'a', line: 3 })
  })
})

describe('findConstReassignment — jamais de faux positif (masquage, propriété, portée disjointe)', () => {
  it('aucun const dans le texte : sortie rapide, jamais de parse', () => {
    assert.equal(findConstReassignment('let x = 0\nx = 10'), null)
  })

  it('identifiant lié par let (`.=` Civet) : réaffectation légitime', () => {
    assert.equal(findConstReassignment('let x = 0\nx = 10'), null)
  })

  it('affectation de PROPRIÉTÉ sur un objet lié par const : jamais une réaffectation de l\'identifiant', () => {
    assert.equal(findConstReassignment('const o = {a: 1}\no.a = 5'), null)
  })

  it('paramètre de fonction homonyme d\'un const externe (function et fléchée)', () => {
    assert.equal(findConstReassignment('const x = 1\nfunction f(x) {\n  x = 5\n  return x\n}'), null)
    assert.equal(findConstReassignment('const x = 1\nconst f = (x) => { x = 5; return x }'), null)
  })

  it('homonyme déclaré par une fonction imbriquée (let local) : le const externe n\'est jamais concerné', () => {
    const js = 'const x = 1\nconst inner = function () {\n  let x = 5\n  x = 6\n  return x\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('bloc if/for : un `let` local shadow le const externe homonyme', () => {
    assert.equal(findConstReassignment('const x = 1\nif (cond) {\n  let x = 2\n  x = 3\n}'), null)
  })

  it('`var` hissé dans une fonction shadow le const externe homonyme', () => {
    const js = 'const x = 1\nfunction outer() {\n  var x = 5\n  x = 6\n  return x\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('déclaration de fonction imbriquée (function) homonyme d\'un const externe : jamais confondue', () => {
    const js = 'const helper = 1\nfunction outer() {\n  function helper() { return 1 }\n  return helper()\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('classe : une déclaration de classe reste réaffectable (liaison mutable, pas const)', () => {
    assert.equal(findConstReassignment('class Foo {}\nFoo = 5'), null)
  })

  it('catch (e) homonyme d\'un const externe : liaison propre au bloc catch, mutable', () => {
    assert.equal(findConstReassignment('const e = 1\ntry {\n  throw new Error()\n} catch (e) {\n  e = 5\n}'), null)
  })

  it('switch : tous les `case` partagent une seule portée (pas de crash), un `let` de case reste mutable', () => {
    const js = 'const mode = 1\nswitch (mode) {\n  case 1:\n    let picked = 1\n    break\n  case 2:\n    picked = 2\n    break\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('valeur par défaut d\'un paramètre : une affectation dans le défaut ne concerne pas un const homonyme externe', () => {
    const js = 'let seen = 0\nfunction f(a = (seen = 1)) {\n  return a\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('for (const x of …) sans réaffectation dans le corps : lecture seule, jamais signalé', () => {
    assert.equal(findConstReassignment('for (const x of [1, 2, 3]) {\n  console.log(x)\n}'), null)
  })

  it('bloc statique de classe : son propre `let` homonyme n\'est pas la constante du dehors', () => {
    const js = 'const x = 1\nclass C {\n  static {\n    let x = 2\n    x = 3\n  }\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('bloc statique de classe : réaffecter la constante du dehors reste signalé', () => {
    const js = 'const x = 1\nclass C {\n  static {\n    x = 3\n  }\n}'
    assert.deepEqual(findConstReassignment(js), { name: 'x', line: 4 })
  })

  // un bloc statique a sa PROPRE portée de `var` (comme une fonction) : Node exécute ce code sans
  // erreur, le `var x` du bloc masque la constante du dehors
  it('bloc statique de classe : son propre `var` homonyme n\'est pas la constante du dehors', () => {
    const js = 'const x = 1\nclass C {\n  static {\n    var x = 2\n    x = 3\n  }\n}'
    assert.equal(findConstReassignment(js), null)
  })

  it('bloc statique de classe : son `var` ne fuit pas dehors, réaffecter la constante après la classe reste signalé', () => {
    const js = 'const x = 1\nclass C {\n  static {\n    var x = 2\n  }\n}\nx = 3'
    assert.deepEqual(findConstReassignment(js), { name: 'x', line: 7 })
  })

  it('JS qui ne parse pas : rend null plutôt que de lever (déjà une erreur ailleurs)', () => {
    assert.equal(findConstReassignment('const x = ) invalide('), null)
  })
})
