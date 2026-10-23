// anti-force-brute des comptes (account:login) : une adresse IPv6 comptait pour son /64. Un seul attaquant qui dispose
// d'un /56 (délégation résidentielle courante : 256 préfixes /64 ; un /48 s'obtient gratuitement par tunnel) remplissait
// le plafond dur du compte : la victime, bon secret, depuis sa propre adresse, était refusée, et l'attaquant essayait 52
// secrets par minute. Une IPv6 compte désormais pour son /56 dans le budget par adresse, et pour son /48 dans l'essai
// qu'une source neuve garde sur un compte dont le budget est dépensé : un /48 entier n'essaie pas plus de 6 secrets par
// minute, et la victime entre toujours
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete, TransportAvecAdresse } from './helpers/comptes-brut.js'

async function attaque(transport: any, adresses: string[]): Promise<Record<string, number>> {
  const reponses: Record<string, number> = {}
  for (const [k, adresse] of adresses.entries()) {
    const a  = await connecter(transport, adresse)
    const rs = await Promise.all(Array.from({ length: k === 0 ? 5 : 1 }, (_, i) => requete(a, 'account:login', { name: 'alice', secret: 'mauvais-' + k + '-' + i })))
    for (const r of rs) reponses[r.p] = (reponses[r.p] ?? 0) + 1
  }
  return reponses
}

describe('MJS-WS — accounts.ts account:login : IPv6 regroupée par /56 (budget par adresse) et /48 (essai d’une source neuve)', function () {
  this.timeout(60000)

  it('60 préfixes /64 d’un même /56 : 5 secrets essayés au plus, la victime entre depuis son adresse', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() }, new TransportAvecAdresse())
    try {
      await requete(await connecter(transport, '203.0.113.5'), 'account:create', { name: 'alice', secret: 'le-bon-secret' })
      const reponses = await attaque(transport, Array.from({ length: 60 }, (_, k) => '2001:db8:aa:bb' + k.toString(16).padStart(2, '0') + '::1'))
      console.log('      60 /64 d’un /56 :', JSON.stringify(reponses))
      assert.ok((reponses['account-denied'] ?? 0) <= 5, 'secrets essayés depuis un /56 : ' + JSON.stringify(reponses))
      const r = await requete(await connecter(transport, '203.0.113.5'), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, `victime refusée : ${r.p}`)
    } finally {
      await app.stop()
    }
  })

  it('60 préfixes /56 d’un même /48 : 6 secrets essayés au plus, la victime entre depuis son adresse et depuis un autre /48', async () => {
    const { transport, app } = await demarrer({ persist: new MemoryAccountsPersistAdapter() }, new TransportAvecAdresse())
    try {
      await requete(await connecter(transport, '203.0.113.5'), 'account:create', { name: 'alice', secret: 'le-bon-secret' })
      const reponses = await attaque(transport, Array.from({ length: 60 }, (_, k) => '2001:db8:aa:' + k.toString(16).padStart(2, '0') + '00::1'))
      console.log('      60 /56 d’un /48 :', JSON.stringify(reponses))
      assert.ok((reponses['account-denied'] ?? 0) <= 6, 'secrets essayés depuis un /48 : ' + JSON.stringify(reponses))
      const r = await requete(await connecter(transport, '203.0.113.5'), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, `victime refusée depuis son adresse : ${r.p}`)
      const r2 = await requete(await connecter(transport, '2001:db8:ab::5'), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r2.e, undefined, `victime refusée depuis un autre /48 : ${r2.p}`)
    } finally {
      await app.stop()
    }
  })
})
