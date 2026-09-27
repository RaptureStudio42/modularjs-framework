// space.ts::query — un rayon ou des coordonnées non finis ne doivent JAMAIS bloquer le process
// (boucle sans fin, `-Infinity + 1 === -Infinity`) : résultat vide + avertissement unique ; un
// rayon fini mais démesuré reste répondu, mais borné (nombre de cellules parcourues plafonné).
import assert from 'node:assert/strict'
import { createSpace } from '../src/mjs-server/space.js'

describe('space — requête invalide n’entre jamais en boucle sans fin', () => {
  it('rayon Infinity → tableau vide immédiatement, avertissement UNE seule fois par instance', () => {
    const avertissements: string[] = []
    const space = createSpace(10, msg => avertissements.push(msg))
    space.set('e1', 0, 0)

    const resultat = space.query(0, 0, Infinity)
    assert.deepEqual(resultat, [])
    assert.equal(avertissements.length, 1)

    space.query(0, 0, Infinity)
    space.query(NaN, 0, 5)
    assert.equal(avertissements.length, 1, 'avertissement émis AU PLUS UNE FOIS par instance, jamais par requête')
  })

  it('rayon négatif → tableau vide également (jamais un throw)', () => {
    const space = createSpace(10)
    assert.deepEqual(space.query(0, 0, -5), [])
  })

  it('sans onWarn fourni, une requête invalide reste silencieuse mais toujours vide (jamais un throw)', () => {
    const space = createSpace(10)
    assert.deepEqual(space.query(0, 0, -Infinity), [])
  })

  it('rayon fini mais démesuré reste borné — répond en un temps raisonnable, reste correct près du centre', () => {
    const space = createSpace(1)
    space.set('e1', 0, 0)
    const debut = Date.now()
    const resultat = space.query(0, 0, 1e15)
    assert.ok(Date.now() - debut < 2000, 'répond en un temps raisonnable — aucun blocage même avec un rayon énorme')
    assert.deepEqual(resultat, ['e1'], 'reste correct pour une entité réellement présente près du centre')
  })

  it('une requête VALIDE (rayon fini normal) continue de fonctionner normalement (non-régression)', () => {
    const space = createSpace(10)
    space.set('e1', 5, 5)
    space.set('e2', 500, 500)
    assert.deepEqual(space.query(0, 0, 20), ['e1'])
  })
})
