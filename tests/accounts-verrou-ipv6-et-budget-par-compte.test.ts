// anti-force-brute des comptes (account:login) : une adresse IPv6 compte pour tout son préfixe /56 (un /64 n'y suffit pas,
// cf. accounts-verrou-ipv6-par-56-et-48.test.ts) — un seul abonné dispose de milliards d'adresses dans son /64 et en
// changeait pour multiplier ses essais (52 secrets essayés par
// minute contre un compte) et verrouiller le titulaire. Le budget d'échecs d'un compte revient à 5 par minute, toutes
// adresses confondues : au-delà, une adresse qui a déjà raté ce compte est arrêtée, et une adresse qui n'a encore rien
// raté n'a plus qu'un essai — le titulaire entre donc toujours depuis une adresse propre
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete, TransportAvecAdresse } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts account:login : adresses d’un même /64 regroupées en IPv6, budget de 5 échecs par compte', function () {
  this.timeout(60000)

  it('12 adresses d’un même /64 × 5 essais : 5 secrets essayés au plus ; le titulaire entre depuis son adresse et depuis un autre /48', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() }, new TransportAvecAdresse())
    try {
      const titulaire = await connecter(transport, '203.0.113.5')
      assert.equal(typeof (await requete(titulaire, 'account:create', { name: 'alice', secret: 'le-bon-secret' })).p.token, 'string')
      const reponses: Record<string, number> = {}
      for (let k = 1; k <= 12; k++) {
        const a  = await connecter(transport, '2001:db8:aa:bb::' + k.toString(16))
        const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => requete(a, 'account:login', { name: 'alice', secret: 'mauvais-' + k + '-' + i })))
        for (const r of rs) reponses[r.p] = (reponses[r.p] ?? 0) + 1
      }
      console.log('      12 adresses du /64 × 5 essais :', JSON.stringify(reponses))
      assert.ok((reponses['account-denied'] ?? 0) <= 5, 'secrets réellement essayés depuis un seul /64 : ' + JSON.stringify(reponses))
      const r = await requete(await connecter(transport, '203.0.113.5'), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, `titulaire refusé depuis son adresse : ${r.p}`)
      const r2 = await requete(await connecter(transport, '2001:db8:ab::5'), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r2.e, undefined, `titulaire refusé depuis un autre /48 : ${r2.p}`)
      const r3 = await requete(await connecter(transport, '2001:db8:aa:bb:ffff::1'), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r3.p, 'account-throttled', 'le préfixe de l’attaquant reste arrêté, même avec le bon secret')
    } finally {
      await app.stop()
    }
  })

  it('budget du compte dépensé (5 échecs, deux adresses) : l’adresse qui a déjà raté est arrêtée, une adresse neuve n’a plus qu’un essai, le titulaire entre', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() }, new TransportAvecAdresse())
    try {
      const titulaire = await connecter(transport, '10.0.0.1')
      await requete(titulaire, 'account:create', { name: 'alice', secret: 'motdepasse1' })
      await requete(titulaire, 'account:create', { name: 'bruno', secret: 'motdepasse2' })
      const a = await connecter(transport, '10.1.0.1')
      const b = await connecter(transport, '10.1.0.2')
      for (let i = 0; i < 3; i++) assert.equal((await requete(a, 'account:login', { name: 'alice', secret: 'faux-a' + i })).p, 'account-denied')
      for (let i = 0; i < 2; i++) assert.equal((await requete(b, 'account:login', { name: 'alice', secret: 'faux-b' + i })).p, 'account-denied')
      assert.equal((await requete(a, 'account:login', { name: 'alice', secret: 'faux-a3' })).p, 'account-throttled', 'budget du compte dépensé : l’adresse qui a déjà raté ce compte est arrêtée')
      assert.equal((await requete(a, 'account:login', { name: 'bruno', secret: 'faux-bruno' })).p, 'account-denied', 'un autre compte reste ouvert à cette adresse (budget par adresse non épuisé)')
      const c = await connecter(transport, '10.1.0.3')
      assert.equal((await requete(c, 'account:login', { name: 'alice', secret: 'faux-c0' })).p, 'account-denied', 'une adresse neuve : un essai')
      assert.equal((await requete(c, 'account:login', { name: 'alice', secret: 'faux-c1' })).p, 'account-throttled', 'puis arrêtée sur ce compte')
      const r = await requete(await connecter(transport, '10.0.0.9'), 'account:login', { name: 'alice', secret: 'motdepasse1' })
      assert.equal(r.e, undefined, `titulaire refusé depuis une adresse propre : ${r.p}`)
    } finally {
      await app.stop()
    }
  })

  it('une adresse neuve, pendant que le compte est sous pression, n’a qu’un essai même en rafale', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() }, new TransportAvecAdresse())
    try {
      const titulaire = await connecter(transport, '10.0.0.1')
      await requete(titulaire, 'account:create', { name: 'alice', secret: 'motdepasse1' })
      const a = await connecter(transport, '10.2.0.1')
      for (let i = 0; i < 5; i++) assert.equal((await requete(a, 'account:login', { name: 'alice', secret: 'faux' + i })).p, 'account-denied')
      const c  = await connecter(transport, '10.2.0.2')
      const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => requete(c, 'account:login', { name: 'alice', secret: 'rafale' + i })))
      const refus = rs.map(r => r.p)
      assert.equal(refus.filter(p => p === 'account-denied').length, 1, 'un seul secret essayé : ' + JSON.stringify(refus))
      assert.equal(refus.filter(p => p === 'account-throttled').length, 4)
    } finally {
      await app.stop()
    }
  })
})
