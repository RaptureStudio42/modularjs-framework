// un composant que son propre `µawake` retire de la page : sa déconnexion, jouée pendant `µawake`, a tout défait ; la connexion ne
// reprend pas ensuite ses inscriptions (magasin global, carnet, routeur). Il restait abonné au magasin hors de la page, et deux fois
// après son retour (deux abonnements pour un composant)
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const SOURCE = `<script>
  µawake ->
    if window.__retirer
      window.__retirer = false
      this.remove()
</script>

<p class="vu">{$$compte}</p>
`

// les abonnements au magasin qui tiennent ce composant
const abonnements = (window: any, hote: any): number => {
  let n = 0
  window.µ._mjs_storeSubs.forEach((subs: Set<any>) => { if (subs.has(hote)) n++ })
  return n
}

describe('µawake qui retire son composant : aucune inscription après la déconnexion', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('hors de la page, le composant n\'est plus abonné au magasin ; revenu, il l\'est une fois', async () => {
    const { window, hote, erreurs } = await monterHote(SOURCE, 'eveil-retire')
    assert.equal(abonnements(window, hote), 1, 'monté : un abonnement')
    hote.remove()
    await pause(30)
    assert.equal(abonnements(window, hote), 0, 'retiré : aucun abonnement')
    window.__retirer = true
    window.document.body.appendChild(hote)
    await pause(60)
    assert.equal(hote.isConnected, false, 'retiré par son µawake')
    assert.equal(abonnements(window, hote), 0, 'retiré par son µawake : aucun abonnement')
    window.document.body.appendChild(hote)
    await pause(60)
    assert.equal(hote.isConnected, true)
    assert.equal(abonnements(window, hote), 1, 'revenu : un abonnement')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
