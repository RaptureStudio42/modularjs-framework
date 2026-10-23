// oracle de temps sur account:login : un secret qui n'est pas une chaîne est refusé tout de suite,
// avant de chercher le compte — même réponse et aucun hachage, que le pseudo existe ou non
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete, compterScrypt } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts account:login : secret qui n’est pas une chaîne', function () {
  this.timeout(30000)

  it('même refus et aucun hachage, compte existant ou non', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter(), bruteForce: { capacity: 1000 } })
    const c = await connecter(transport)
    await requete(c, 'account:create', { name: 'alice', secret: 'motdepasse1' })
    await compterScrypt(async appels => {
      for (const charge of [{ secret: 1 }, { secret: null }, { secret: true }, { secret: ['motdepasse1'] }, { secret: { s: 'motdepasse1' } }, {}]) {
        for (const name of ['alice', 'personne']) {
          const avant = appels()
          const r = await requete(c, 'account:login', { name, ...charge })
          assert.equal(r.p, 'account-denied', `${name} ${JSON.stringify(charge)}`)
          assert.equal(appels() - avant, 0, `${name} ${JSON.stringify(charge)} : aucun hachage attendu`)
        }
      }
      // un secret chaîne, lui, est bien vérifié : un hachage, compte existant ou non
      for (const name of ['alice', 'personne']) {
        const avant = appels()
        assert.equal((await requete(c, 'account:login', { name, secret: 'mauvais-secret' })).p, 'account-denied')
        assert.equal(appels() - avant, 1, name)
      }
    })
    await app.stop()
  })
})
