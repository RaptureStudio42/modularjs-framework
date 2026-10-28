// aide commune des attentes (tests/helpers/attendre.ts) : une porte attend un état, rend la valeur lue dès qu'il
// arrive, et au délai lève une erreur qui dit l'état attendu, la dernière valeur lue et la dernière levée de la
// lecture ; l'égalité attendue échoue comme une assertion directe ; une étape d'un `before` est nommée dans son échec

import assert from 'node:assert/strict'
import { attendre, attendreEgal, etape } from './helpers/attendre.js'

describe('aide des attentes — attendre un état, jamais une durée', function () {
  it('rend la valeur lue dès que la condition est vraie, sans attendre le délai', async () => {
    let n = 0
    const minuterie = setInterval(() => n++, 5)
    try {
      const debut = Date.now()
      const vu    = await attendre(() => n >= 3 && n, { message: 'trois tours', delai: 5000 })
      assert.ok(vu >= 3, `valeur rendue : ${vu}`)
      assert.ok(Date.now() - debut < 4000, 'rendue avant le délai')
    }
    finally {
      clearInterval(minuterie)
    }
  })

  it('accepte une lecture asynchrone (une page de navigateur) et une lecture qui lève tant que l\'état n\'est pas là', async () => {
    let essais = 0
    const vu   = await attendre(async () => {
      essais++
      if (essais < 3) throw new Error('pas encore monté')
      return 'monté'
    }, 'le montage')
    assert.equal(vu, 'monté')
    assert.equal(essais, 3)
  })

  it('au délai : l\'erreur dit l\'état attendu, le délai, la dernière valeur lue', async () => {
    await assert.rejects(attendre(() => 0, { message: 'les trois lignes', delai: 60 }), (e: any) => {
      assert.match(e.message, /les trois lignes/)
      assert.match(e.message, /60 ms/)
      assert.match(e.message, /dernière valeur lue : 0/)
      return true
    })
  })

  it('au délai : un message donné en fonction est relu au délai, avec l\'état du moment', async () => {
    let lectures = 0
    await assert.rejects(attendre(() => { lectures++; return false }, { message: () => `lectures faites : ${lectures}`, delai: 60 }), (e: any) => {
      assert.match(e.message, new RegExp(`lectures faites : ${lectures}`))
      assert.ok(lectures > 1, `relue au délai, pas à l'appel (lectures : ${lectures})`)
      return true
    })
  })

  it('au délai : la dernière levée de la lecture est citée', async () => {
    await assert.rejects(attendre(() => { throw new Error('ombre absente') }, { message: 'le composant', delai: 60 }), (e: any) => {
      assert.match(e.message, /le composant/)
      assert.match(e.message, /ombre absente/)
      return true
    })
  })

  it('attendreEgal : passe dès l\'égalité profonde, échoue au délai comme assert.deepEqual (différence affichée)', async () => {
    const recus: string[] = []
    setTimeout(() => recus.push('a'), 10)
    setTimeout(() => recus.push('al'), 30)
    await attendreEgal(() => recus.slice(), ['a', 'al'], 'les deux saisies')
    await assert.rejects(attendreEgal(() => recus.slice(), ['a'], 'une seule saisie', 60), (e: any) => {
      assert.equal(e.code, 'ERR_ASSERTION')
      assert.match(e.message, /une seule saisie/)
      assert.deepEqual(e.actual, ['a', 'al'])
      assert.deepEqual(e.expected, ['a'])
      return true
    })
  })

  it('etape : rend le résultat du travail ; au délai, l\'erreur nomme l\'étape qui n\'a pas fini', async () => {
    assert.equal(await etape('compilation', async () => 42, 1000), 42)
    await assert.rejects(etape('démarrage du serveur', new Promise(() => {}), 60), (e: any) => {
      assert.match(e.message, /démarrage du serveur/)
      assert.match(e.message, /60 ms/)
      return true
    })
  })
})
