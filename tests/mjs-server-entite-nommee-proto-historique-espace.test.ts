// Une entité dont l'identifiant vaut `__proto__` (un pseudo choisi par le joueur) : l'historique de la compensation de lag
// (createHistory) et la grille spatiale (createSpace) copient les positions dans un objet ordinaire indexé par identifiant.
// L'affectation `copie['__proto__'] = position` y changeait le prototype de la copie au lieu d'y ranger la position : l'entité
// disparaissait de la copie, et ses coordonnées devenaient des propriétés héritées par la copie. Elle y est une clé propre, comme
// les autres.

import assert from 'node:assert/strict'
import { createHistory } from '../src/mjs-server/history.js'
import { createSpace } from '../src/mjs-server/space.js'

describe('serveur de jeu — une entité nommée `__proto__` reste une entité comme une autre', () => {
  it('historique : la position poussée se retrouve au rembobinage, en clé propre, sans prototype changé', () => {
    const histo = createHistory(3)
    histo.pousser(1, 1000, JSON.parse('{"__proto__":{"x":1,"y":2},"a":{"x":3,"y":4}}'))
    const vu = histo.rewind(1000, (positions: any) => ({
      cles:  Object.keys(positions).sort(),
      proto: Object.getPrototypeOf(positions) === Object.prototype,
      pos:   Object.getOwnPropertyDescriptor(positions, '__proto__')?.value,
      x:     positions.x,
    }))
    assert.deepEqual(vu.cles, ['__proto__', 'a'], 'les deux entités sont dans la copie')
    assert.equal(vu.proto, true, 'la copie garde le prototype d\'un objet ordinaire')
    assert.deepEqual(vu.pos, { x: 1, y: 2 }, 'la position de `__proto__` est rangée sous son identifiant')
    assert.equal(vu.x, undefined, 'aucune coordonnée héritée par la copie')
  })

  it('grille spatiale : l\'instantané porte l\'entité en clé propre, sans prototype changé', () => {
    const espace = createSpace(10)
    espace.set('__proto__', 1, 2)
    espace.set('a', 3, 4)
    const copie: any = espace._snapshot()
    assert.deepEqual(Object.keys(copie).sort(), ['__proto__', 'a'], 'les deux entités sont dans l\'instantané')
    assert.equal(Object.getPrototypeOf(copie), Object.prototype, 'l\'instantané garde le prototype d\'un objet ordinaire')
    assert.deepEqual(Object.getOwnPropertyDescriptor(copie, '__proto__')?.value, { x: 1, y: 2 }, 'la position de `__proto__` est rangée sous son identifiant')
    assert.equal(copie.x, undefined, 'aucune coordonnée héritée par l\'instantané')
  })
})
