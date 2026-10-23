// force brute en parallèle sur account:login : le budget d'échecs se réserve AVANT la vérification
// asynchrone du secret — des essais lancés ensemble ne passent plus tous le contrôle avant que le
// premier échec ne soit compté (au plus cinq vérifiés, le bon secret en trentième position refusé)
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter, FailureBucket } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete, compterScrypt } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts account:login : essais simultanés et budget d’échecs', function () {
  this.timeout(30000)

  it('30 secrets essayés ensemble depuis une adresse (5 échecs/min) : au plus 5 vérifiés, le bon en 30e position refusé', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() })
    const v = await connecter(transport)
    assert.equal((await requete(v, 'account:create', { name: 'alice', secret: 'soleil-29' })).e, undefined)
    const clients = await Promise.all(Array.from({ length: 30 }, () => connecter(transport)))
    await compterScrypt(async appels => {
      const reponses = await Promise.all(clients.map((c, i) => requete(c, 'account:login', { name: 'alice', secret: 'soleil-' + i })))
      const bilan: Record<string, number> = {}
      for (const r of reponses) {
        const cle = r.e ? String(r.p) : 'jeton'
        bilan[cle] = (bilan[cle] ?? 0) + 1
      }
      assert.equal(reponses[29].p, 'account-throttled', `le bon secret, 30e, ne doit pas passer — bilan ${JSON.stringify(bilan)}`)
      assert.equal(bilan.jeton ?? 0, 0, 'aucun jeton émis')
      assert.ok((bilan['account-denied'] ?? 0) <= 5, `au plus 5 refus après vérification — bilan ${JSON.stringify(bilan)}`)
      assert.ok(appels() <= 5, `au plus 5 hachages, ${appels()} faits`)
    })
    // budget épuisé par les échecs vérifiés : le bon secret, juste après, reste arrêté
    assert.equal((await requete(clients[0], 'account:login', { name: 'alice', secret: 'soleil-29' })).p, 'account-throttled')
    await app.stop()
  })

  it('une connexion réussie rend sa place : 10 connexions réussies d’affilée depuis une adresse passent toutes', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() })
    const c = await connecter(transport)
    await requete(c, 'account:create', { name: 'alice', secret: 'motdepasse1' })
    for (let i = 0; i < 10; i++) {
      const r = await requete(c, 'account:login', { name: 'alice', secret: 'motdepasse1' })
      assert.equal(r.e, undefined, `connexion ${i + 1} refusée : ${r.p}`)
    }
    await app.stop()
  })

  it('FailureBucket : places en vol bornées par le solde, rendues à la réussite, comptées à l’échec', () => {
    const seau = new FailureBucket(2, 3600000)
    const now  = 1000
    assert.equal(seau.reserve('a', now), true)
    assert.equal(seau.reserve('a', now), true)
    assert.equal(seau.reserve('a', now), false, 'deux places en vol pour un budget de 2 : la troisième attend')
    assert.equal(seau.isBlocked('a', now), false, 'refus dû aux essais en vol : aucun verrou')
    seau.release('a', false, now)
    assert.equal(seau.reserve('a', now), true, 'une réussite rend sa place')
    seau.release('a', true, now)
    seau.release('a', true, now)
    assert.equal(seau.reserve('a', now), false, 'deux échecs comptés : budget épuisé')
    assert.equal(seau.isBlocked('a', now), true, 'budget dépensé par des échecs : verrou')
    assert.equal(seau.reserve('b', now), true, 'clé voisine intacte')
  })
})
