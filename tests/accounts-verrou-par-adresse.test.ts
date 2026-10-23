// verrouillage ciblé d'un compte : les échecs envoyés depuis une adresse ne bloquent plus le
// titulaire qui se connecte depuis une autre adresse sans échec récent ; le budget du compte dépensé,
// une adresse neuve n'a plus qu'un essai, et seul un plafond par pseudo, toutes adresses confondues et
// dix fois plus haut, arrête une attaque répartie
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete, TransportAvecAdresse } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts account:login : verrou compté par adresse, plafond par pseudo', function () {
  this.timeout(30000)

  it('6 mauvais secrets depuis une adresse : le titulaire, bon secret depuis une autre adresse, entre', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() }, new TransportAvecAdresse())
    const titulaire = await connecter(transport, '10.0.0.1')
    await requete(titulaire, 'account:create', { name: 'alice', secret: 'motdepasse1' })
    const attaquant = await connecter(transport, '10.6.6.6')
    const essais: string[] = []
    for (let i = 0; i < 6; i++) essais.push((await requete(attaquant, 'account:login', { name: 'alice', secret: 'mauvais' + i })).p)
    assert.deepEqual(essais, [...Array(5).fill('account-denied'), 'account-throttled'], 'l’adresse de l’attaquant est arrêtée')
    const ailleurs = await connecter(transport, '10.0.0.3')
    const r = await requete(ailleurs, 'account:login', { name: 'alice', secret: 'motdepasse1' })
    assert.equal(r.e, undefined, `titulaire refusé : ${r.p}`)
    assert.equal(typeof r.p.token, 'string')
    assert.equal((await requete(attaquant, 'account:login', { name: 'alice', secret: 'motdepasse1' })).p, 'account-throttled', 'l’attaquant reste arrêté, même avec le bon secret')
    await app.stop()
  })

  it('attaque répartie : budget du compte dépensé, chaque adresse neuve n’a plus qu’un essai ; le titulaire entre sous le plafond (dix fois la capacité), puis il est arrêté lui aussi', async () => {
    // fenêtre d'une heure : le budget ne se recharge pas pendant le test
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter(), bruteForce: { capacity: 2, windowMs: 3600000 } }, new TransportAvecAdresse())
    const titulaire = await connecter(transport, '10.0.0.1')
    await requete(titulaire, 'account:create', { name: 'alice', secret: 'motdepasse1' })
    let n = 0
    const premiere = await connecter(transport, '10.9.0.1')
    for (let i = 0; i < 2; i++) assert.equal((await requete(premiere, 'account:login', { name: 'alice', secret: 'faux' + n++ })).p, 'account-denied', 'dans le budget du compte')
    const echouer = async (adresse: string) => {
      const c = await connecter(transport, adresse)
      assert.equal((await requete(c, 'account:login', { name: 'alice', secret: 'faux' + n++ })).p, 'account-denied', adresse + ' : un essai')
      assert.equal((await requete(c, 'account:login', { name: 'alice', secret: 'faux' + n++ })).p, 'account-throttled', adresse + ' : puis arrêtée')
    }
    for (let k = 2; k <= 18; k++) await echouer('10.9.0.' + k)
    const r = await requete(await connecter(transport, '10.0.0.2'), 'account:login', { name: 'alice', secret: 'motdepasse1' })
    assert.equal(r.e, undefined, `19 échecs sous le plafond de 20, titulaire refusé : ${r.p}`)
    await echouer('10.9.0.19')
    const r2 = await requete(await connecter(transport, '10.0.0.3'), 'account:login', { name: 'alice', secret: 'motdepasse1' })
    assert.equal(r2.p, 'account-throttled', '20 échecs : plafond par pseudo atteint, arrêté quelle que soit l’adresse')
    await app.stop()
  })
})
