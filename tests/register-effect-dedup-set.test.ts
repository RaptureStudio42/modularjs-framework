// registerEffect — dédup par variable (effectsByVar) : garde de non-régression pour le
// passage Array.includes() → Set (même remède déjà appliqué à mountOnlyEffects), qui devenait
// quadratique sur un composant à beaucoup d'effets pour la même variable. Le contenu et
// l'ORDRE des effets enregistrés doivent rester identiques à l'ancienne implémentation.

import assert from 'node:assert/strict'
import { CompilerState } from '../src/generator/state.js'

describe('registerEffect — dédup par variable, contenu et ordre préservés', () => {
  it('le même code enregistré deux fois pour la même var ne compte qu\'une fois', () => {
    const cs = new CompilerState()
    cs.registerEffect('code_A', ['x'])
    cs.registerEffect('code_A', ['x'])
    assert.deepEqual(cs.effectsByVar.get('x'), ['code_A'])
  })

  it('deux codes différents pour la même var s\'accumulent DANS L\'ORDRE d\'arrivée', () => {
    const cs = new CompilerState()
    cs.registerEffect('code_A', ['x'])
    cs.registerEffect('code_B', ['x'])
    cs.registerEffect('code_A', ['x'])
    assert.deepEqual(cs.effectsByVar.get('x'), ['code_A', 'code_B'])
  })

  it('un même code sur DEUX vars distinctes s\'enregistre séparément pour chacune', () => {
    const cs = new CompilerState()
    cs.registerEffect('code_A', ['x', 'y'])
    assert.deepEqual(cs.effectsByVar.get('x'), ['code_A'])
    assert.deepEqual(cs.effectsByVar.get('y'), ['code_A'])
  })

  it('vars vide → mountOnlyEffects, dédup inchangée', () => {
    const cs = new CompilerState()
    cs.registerEffect('code_A', [])
    cs.registerEffect('code_A', [])
    assert.deepEqual(cs.mountOnlyEffects, ['code_A'])
  })

  it('reset() vide aussi le miroir de dédup — pas de fuite entre deux compilations', () => {
    const cs = new CompilerState()
    cs.registerEffect('code_A', ['x'])
    cs.reset()
    cs.registerEffect('code_A', ['x'])
    assert.deepEqual(cs.effectsByVar.get('x'), ['code_A'])
  })
})
