// énumération des comptes par account:create : la réponse « pseudo déjà pris » passe par une limite
// par adresse, consultée AVANT de la donner — plus d'oracle d'existence gratuit
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts account:create : « pseudo déjà pris » limité par adresse', function () {
  this.timeout(30000)

  it('seau de création vidé : un pseudo existant répond account-throttled, comme un pseudo libre', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() })
    const c = await connecter(transport)
    for (const name of ['alice', 'zz1', 'zz2']) assert.equal((await requete(c, 'account:create', { name, secret: 'motdepasse1' })).e, undefined, name)
    assert.equal((await requete(c, 'account:create', { name: 'bob', secret: 'motdepasse1' })).p, 'account-throttled')
    for (const name of ['alice', 'ALICE', 'zz1', 'carol']) {
      assert.equal((await requete(c, 'account:create', { name, secret: 'motdepasse1' })).p, 'account-throttled', name)
    }
    await app.stop()
  })

  it('sans rien créer de plus : 10 contrôles de pseudo par minute et par adresse, puis account-throttled pour tout pseudo', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() })
    const c = await connecter(transport)
    assert.equal((await requete(c, 'account:create', { name: 'alice', secret: 'motdepasse1' })).e, undefined)
    const reponses: string[] = []
    for (let i = 0; i < 9; i++) reponses.push((await requete(c, 'account:create', { name: 'alice', secret: 'motdepasse1' })).p)
    assert.deepEqual(reponses, Array(9).fill('account-name-taken'), 'la création réussie et ces 9 réponses épuisent le budget de 10')
    for (const name of ['alice', 'libre1']) {
      assert.equal((await requete(c, 'account:create', { name, secret: 'motdepasse1' })).p, 'account-throttled', name)
    }
    // les refus de format, eux, ne consomment rien et restent dits
    assert.equal((await requete(c, 'account:create', { name: 'ab', secret: 'motdepasse1' })).p, 'account-name-invalid')
    await app.stop()
  })
})
