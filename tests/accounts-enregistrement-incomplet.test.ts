// un enregistrement de compte incomplet ({} ou champ manquant) ne bloque plus account:create pour
// toujours : il est écarté avec un avertissement au journal et les autres comptes restent chargés ;
// le pseudo d'un enregistrement abîmé qui le porte encore reste réservé — personne ne le reprend
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FileAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import type { MjsWsAccountRecord, MjsWsAccountsPersistAdapter } from '../src/mjs-ws/accounts.js'
import { mjsTmp } from './helpers/tmp.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

describe('MJS-WS — accounts.ts : enregistrement de compte incomplet au chargement', function () {
  this.timeout(30000)

  it('dossier de comptes : un `{}` à côté d’un compte valide — création possible, compte valide intact, un avertissement', async () => {
    const dir = mjsTmp('comptes-incomplet')
    const d1 = await demarrer({ persist: new FileAccountsPersistAdapter({ dir, onLog: () => {} }) })
    const c1 = await connecter(d1.transport)
    assert.equal((await requete(c1, 'account:create', { name: 'alice', secret: 'motdepasse1' })).e, undefined)
    await d1.app.stop()
    writeFileSync(join(dir, 'vieux.json'), '{}')

    const d2 = await demarrer({ persist: new FileAccountsPersistAdapter({ dir, onLog: () => {} }) })
    const c2 = await connecter(d2.transport)
    const bob = await requete(c2, 'account:create', { name: 'bob', secret: 'motdepasse2' })
    assert.equal(bob.e, undefined, `création refusée : ${bob.p}`)
    // le compte valide reste protégé : son pseudo est pris, son secret le connecte
    assert.equal((await requete(c2, 'account:create', { name: 'alice', secret: 'autresecret' })).p, 'account-name-taken')
    assert.equal((await requete(c2, 'account:login', { name: 'alice', secret: 'motdepasse1' })).e, undefined)
    assert.equal(d2.journal.filter(l => l.niveau === 'warn').length, 1, 'un avertissement pour l’enregistrement écarté')
    await d2.app.stop()
  })

  it('adaptateur maison : enregistrements abîmés écartés, pseudo encore lisible réservé, comptes chargés une seule fois', async () => {
    const salt = randomBytes(16)
    const sain: MjsWsAccountRecord = { id: 'id-zora', name: 'zora', hash: scryptSync('motdepasse1', salt, 64).toString('hex'), salt: salt.toString('hex'), roles: [], createdAt: 0, seenAt: 0, meta: {} }
    const lignes: unknown[] = [null, 42, [], {}, { id: 'id-carol', name: 'Carol' }, sain]
    let chargements = 0
    const persist: MjsWsAccountsPersistAdapter = {
      async load() { chargements++; return lignes as MjsWsAccountRecord[] },
      save() {},
      remove() {},
    }
    const { transport, app, journal } = await demarrer({ persist })
    const c = await connecter(transport)
    assert.equal((await requete(c, 'account:create', { name: 'dave', secret: 'motdepasse2' })).e, undefined, 'création possible malgré les enregistrements abîmés')
    assert.equal((await requete(c, 'account:login', { name: 'zora', secret: 'motdepasse1' })).e, undefined, 'le compte sain se connecte')
    // l'enregistrement abîmé qui porte encore un pseudo le garde : ni création ni connexion sous ce nom
    assert.equal((await requete(c, 'account:create', { name: 'carol', secret: 'motdepasse3' })).p, 'account-name-taken')
    assert.equal((await requete(c, 'account:login', { name: 'carol', secret: 'motdepasse3' })).p, 'account-denied')
    assert.equal(chargements, 1, 'les comptes ne sont plus relus à chaque trame')
    assert.equal(journal.filter(l => l.niveau === 'warn').length, 5, 'un avertissement par enregistrement écarté')
    await app.stop()
  })
})
