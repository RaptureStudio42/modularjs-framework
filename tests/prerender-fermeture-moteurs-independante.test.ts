// prerenderPages créait le moteur happy-dom PUIS le moteur navigateur, hors de tout try/finally :
// si le second échouait à se construire, le premier (déjà construit) n'était jamais fermé — et
// dans le try/finally qui ferme les deux en fin de passe, `if (a) await a.close(); if (b) await
// b.close();` laissait une erreur de fermeture du premier empêcher la fermeture du second.
// closeQuietly() factorise une fermeture INDÉPENDANTE et BEST-EFFORT, réutilisée aux deux points.
import assert from 'node:assert/strict'
import { closeQuietly } from '../src/server/prerender.js'

describe('closeQuietly — fermeture indépendante et best-effort de plusieurs ressources', function () {
  it('un close() qui échoue n\'empêche pas la fermeture du suivant', async function () {
    let secondClosed = false
    const first = { close: async () => { throw new Error('boum') } }
    const second = { close: async () => { secondClosed = true } }
    await closeQuietly(first, second)
    assert.equal(secondClosed, true, 'le second doit être fermé même si le premier a levé')
  })

  it('une ressource absente (null) est simplement ignorée', async function () {
    let closed = false
    await closeQuietly(null, { close: async () => { closed = true } })
    assert.equal(closed, true)
  })

  it('l\'ordre est respecté quand tout se passe bien', async function () {
    const order: string[] = []
    await closeQuietly(
      { close: async () => { order.push('a') } },
      { close: async () => { order.push('b') } },
    )
    assert.deepEqual(order, ['a', 'b'])
  })

  it('ne lève jamais, même si TOUTES les fermetures échouent', async function () {
    await assert.doesNotReject(closeQuietly(
      { close: async () => { throw new Error('a') } },
      { close: async () => { throw new Error('b') } },
    ))
  })
})
