// magasin global : réécrire `NaN` sur une clé qui vaut déjà `NaN` ne change rien, aucun avis ne part (comme pour toute autre valeur
// inchangée) ; `NaN !== NaN` faisait prévenir les lecteurs, et redessiner, à chaque écriture
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

describe('magasin global : NaN réécrit, aucun avis', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('trois écritures de NaN : un seul avis, celui de la première', async () => {
    const { window, erreurs } = await monterHote('<p class="vu">{$$n}</p>\n', 'magasin-nan')
    const µ: any  = window.µ
    const avis    = [] as string[]
    const notifie = µ._mjs_storeNotifyKey
    µ._mjs_storeNotifyKey = function(this: any, ...a: any[]) { avis.push(a[0]); return notifie.apply(this, a) }
    µ.store.n = NaN
    µ.store.n = NaN
    µ.store.n = NaN
    await pause(30)
    µ._mjs_storeNotifyKey = notifie
    assert.deepEqual(avis.filter((k) => k === 'n'), ['n'])
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
