// account:login — un compte persisté dont le nom sort du format des pseudos (adaptateur maison qui reprend la base d'un
// autre système : nom avec un point, un accent, plus de 24 caractères) ne pouvait plus se connecter, même avec le bon
// secret : la clé des budgets d'essais, commune à tout nom hors format, servait aussi à chercher le compte. La recherche
// se fait sur le nom tel quel ; seule la clé des budgets reste bornée
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import type { MjsWsAccountsPersistAdapter } from '../src/mjs-ws/accounts.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts account:login : compte persisté au nom hors du format des pseudos', function () {
  this.timeout(30000)

  it('« jean.dupont », « Élodie », un nom de plus de 24 caractères : connexion avec le bon secret, refus avec un mauvais', async () => {
    // un enregistrement réel (sel et hachage du secret), créé par le paquet lui-même
    const source  = new MemoryAccountsPersistAdapter()
    const premier = await demarrer({ persist: source })
    let enregistrement: any
    try {
      const c = await connecter(premier.transport)
      assert.equal(typeof (await requete(c, 'account:create', { name: 'jeandupont', secret: 'le-bon-secret' })).p.token, 'string')
      ;[enregistrement] = await source.load()
    } finally {
      await premier.app.stop()
    }
    for (const nom of ['jean.dupont', 'Élodie', 'un-nom-de-plus-de-vingt-quatre', 'jeandupont']) {
      const persist = { load: async () => [{ ...enregistrement, name: nom }], save: async () => {}, remove: async () => {} } as unknown as MjsWsAccountsPersistAdapter
      const { transport, app } = await demarrer({ persist })
      try {
        const bon = await requete(await connecter(transport), 'account:login', { name: nom, secret: 'le-bon-secret' })
        assert.equal(bon.e, undefined, `« ${nom} », bon secret : ${bon.p}`)
        assert.equal(typeof bon.p.token, 'string')
        const mauvais = await requete(await connecter(transport), 'account:login', { name: nom, secret: 'un-mauvais-secret' })
        assert.equal(mauvais.p, 'account-denied', `« ${nom} », mauvais secret`)
      } finally {
        await app.stop()
      }
    }
  })
})
