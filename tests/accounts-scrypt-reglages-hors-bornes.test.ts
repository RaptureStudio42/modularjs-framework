// comptes (src/mjs-ws/accounts.ts) — la garde des réglages scrypt enregistrés avec un hachage ne bornait que la mémoire :
// `ln=20,r=1,p=16` passait la garde mais scrypt la refusait, et la connexion renvoyait au client le message d'OpenSSL ;
// `ln=17,r=8,p=16` passait aussi, et chaque essai sur ce compte coûtait une vingtaine de connexions normales. Chaque réglage
// est borné (N ≤ 2^16, r ≤ 8, p ≤ 4, et N < 2^(16·r) comme l'exige scrypt), le coût total aussi (deux connexions aux réglages
// actuels au plus) ; hors bornes, ou refusé par scrypt, c'est un refus ordinaire
import assert from 'node:assert/strict'
import { randomBytes, scrypt } from 'node:crypto'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

function compte(id: string, name: string, hash: string, sel: Buffer) {
  return { id, name, hash, salt: sel.toString('hex'), roles: [], createdAt: 1, seenAt: 1, meta: {} }
}

function hacher(secret: string, sel: Buffer, ln: number, r: number, p: number): Promise<string> {
  return new Promise((ok, ko) => scrypt(secret, sel, 64, { N: 2 ** ln, r, p, maxmem: 256 * 2 ** ln * r }, (err, cle) => { if (err) ko(err); else ok(cle.toString('hex')) }))
}

describe('MJS-WS — accounts.ts : réglages scrypt enregistrés hors bornes', function () {
  this.timeout(60000)

  it('réglages que scrypt refuse ou démesurés : refus ordinaire, au prix d\'une connexion normale', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const sel     = randomBytes(16)
    persist.save('id-refuse', compte('id-refuse', 'refuse', '$scrypt$ln=20,r=1,p=16$'+ 'ab'.repeat(64), sel))
    persist.save('id-lourd', compte('id-lourd', 'lourd', '$scrypt$ln=17,r=8,p=16$'+ 'ab'.repeat(64), sel))
    persist.save('id-paralleles', compte('id-paralleles', 'paralleles', '$scrypt$ln=15,r=8,p=16$'+ 'ab'.repeat(64), sel))
    const { transport, app } = await demarrer({ persist })
    try {
      const creation = await requete(await connecter(transport), 'account:create', { name: 'normal', secret: 'le-bon-secret' })
      assert.equal(creation.e, undefined, creation.p)
      const duree = async (name: string): Promise<number> => {
        const t0 = performance.now()
        const r  = await requete(await connecter(transport), 'account:login', { name, secret: 'pas-le-bon' })
        assert.equal(r.p, 'account-denied', name +' : '+ JSON.stringify(r.p))
        return performance.now() - t0
      }
      const normale = await duree('normal')
      for (const name of ['refuse', 'lourd', 'paralleles']) {
        const ms = await duree(name)
        assert.ok(ms < normale * 4 + 1000, name +' : '+ Math.round(ms) +' ms contre '+ Math.round(normale) +' ms pour un compte à jour')
      }
    }
    finally {
      await app.stop()
    }
  })

  it('réglages dans les bornes, autres que ceux du framework : le bon secret entre, et le hachage est refait', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const sel     = randomBytes(16)
    persist.save('id-autre', compte('id-autre', 'eve', '$scrypt$ln=12,r=8,p=2$'+ await hacher('le-bon-secret', sel, 12, 8, 2), sel))
    const { transport, app } = await demarrer({ persist })
    try {
      const mauvais = await requete(await connecter(transport), 'account:login', { name: 'eve', secret: 'pas-le-bon' })
      assert.equal(mauvais.p, 'account-denied')
      const bon = await requete(await connecter(transport), 'account:login', { name: 'eve', secret: 'le-bon-secret' })
      assert.equal(bon.e, undefined, bon.p)
      assert.match((await persist.load())[0].hash, /^\$scrypt\$ln=15,r=8,p=3\$[0-9a-f]{128}$/)
    }
    finally {
      await app.stop()
    }
  })
})
