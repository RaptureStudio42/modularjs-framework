// comptes (src/mjs-ws/accounts.ts) — le secret était haché par scrypt aux réglages par défaut de Node (N = 2^14),
// sous la recommandation de l'OWASP, et ces réglages n'étaient pas enregistrés : impossible de les relever sans casser
// les comptes existants. Chaque hachage porte désormais ses réglages ; les comptes neufs ont N relevé ; un compte
// d'avant (hachage hexadécimal nu) se connecte toujours, et son hachage est refait aux réglages actuels à sa première
// connexion réussie
import assert from 'node:assert/strict'
import { randomBytes, scrypt } from 'node:crypto'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

const FORMAT_ACTUEL = /^\$scrypt\$ln=15,r=8,p=3\$[0-9a-f]{128}$/

// hachage tel que l'écrivaient les versions précédentes : réglages de Node, hexadécimal nu
function ancienHachage(secret: string, sel: Buffer): Promise<string> {
  return new Promise((ok, ko) => scrypt(secret, sel, 64, (err, cle) => { if (err) ko(err); else ok(cle.toString('hex')) }))
}

function compte(id: string, name: string, hash: string, sel: Buffer) {
  return { id, name, hash, salt: sel.toString('hex'), roles: [], createdAt: 1, seenAt: 1, meta: {} }
}

describe('MJS-WS — accounts.ts : réglages scrypt enregistrés avec chaque hachage', function () {
  this.timeout(60000)

  it('compte neuf : le hachage porte ses réglages (N = 2^15, r = 8, p = 3) et le compte se connecte', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const { transport, app } = await demarrer({ persist })
    try {
      const r = await requete(await connecter(transport), 'account:create', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, r.p)
      const [enregistre] = await persist.load()
      assert.match(enregistre.hash, FORMAT_ACTUEL)
      const login = await requete(await connecter(transport), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(login.e, undefined, login.p)
      const mauvais = await requete(await connecter(transport), 'account:login', { name: 'alice', secret: 'pas-le-bon' })
      assert.equal(mauvais.p, 'account-denied')
    }
    finally {
      await app.stop()
    }
  })

  it('compte d\'avant (hexadécimal nu) : un mauvais secret ne touche à rien ; le bon entre et refait le hachage, une fois', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const sel     = randomBytes(16)
    const ancien  = await ancienHachage('le-bon-secret', sel)
    persist.save('id-ancien', compte('id-ancien', 'bob', ancien, sel))
    const { transport, app } = await demarrer({ persist })
    try {
      const mauvais = await requete(await connecter(transport), 'account:login', { name: 'bob', secret: 'pas-le-bon' })
      assert.equal(mauvais.p, 'account-denied')
      assert.equal((await persist.load())[0].hash, ancien)
      const bon = await requete(await connecter(transport), 'account:login', { name: 'bob', secret: 'le-bon-secret' })
      assert.equal(bon.e, undefined, bon.p)
      const refait = (await persist.load())[0].hash
      assert.match(refait, FORMAT_ACTUEL)
      const encore = await requete(await connecter(transport), 'account:login', { name: 'bob', secret: 'le-bon-secret' })
      assert.equal(encore.e, undefined, encore.p)
      assert.equal((await persist.load())[0].hash, refait, 'réglages déjà actuels : aucun nouveau hachage')
    }
    finally {
      await app.stop()
    }
  })

  it('réglages enregistrés illisibles ou démesurés : refus ordinaire, jamais une erreur interne', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const sel     = randomBytes(16)
    persist.save('id-demesure', compte('id-demesure', 'carl', '$scrypt$ln=40,r=8,p=1$'+ 'ab'.repeat(64), sel))
    persist.save('id-illisible', compte('id-illisible', 'dora', '$scrypt$ln=quinze$'+ 'ab'.repeat(64), sel))
    const { transport, app } = await demarrer({ persist })
    try {
      for (const name of ['carl', 'dora']) {
        const r = await requete(await connecter(transport), 'account:login', { name, secret: 'le-bon-secret' })
        assert.equal(r.p, 'account-denied', name)
      }
    }
    finally {
      await app.stop()
    }
  })
})
