// account:login : un bon secret n'est plus refusé quand l'écriture de la date de dernière connexion
// échoue — l'échec part au journal du serveur, jamais son message (chemin compris) au client
import assert from 'node:assert/strict'
import { MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import type { MjsWsAccountRecord } from '../src/mjs-ws/accounts.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

const CHEMIN = '/srv/app/comptes/8a218d97a60922bc.1a2b.tmp.json'

class DisquePlein extends MemoryAccountsPersistAdapter {
  panne: 'aucune' | 'leve' | 'rejette' = 'aucune'

  save(id: string, account: MjsWsAccountRecord): any {
    if (this.panne === 'leve') throw new Error(`ENOSPC: no space left on device, open '${CHEMIN}'`)
    if (this.panne === 'rejette') return Promise.reject(new Error(`ENOSPC: no space left on device, open '${CHEMIN}'`))
    super.save(id, account)
  }
}

describe('MJS-WS — accounts.ts account:login : échec d’écriture de la date de dernière connexion', function () {
  this.timeout(30000)

  for (const panne of ['leve', 'rejette'] as const) {
    it(`save() qui ${panne === 'leve' ? 'lève' : 'rend une promesse rejetée'} : connexion acceptée, avertissement au journal, aucun chemin au client`, async () => {
      const persist = new DisquePlein()
      const { transport, app, journal } = await demarrer({ persist })
      const c = await connecter(transport)
      assert.equal((await requete(c, 'account:create', { name: 'alice', secret: 'motdepasse1' })).e, undefined)
      persist.panne = panne
      const r = await requete(c, 'account:login', { name: 'alice', secret: 'motdepasse1' })
      assert.equal(r.e, undefined, `bon secret refusé : ${JSON.stringify(r.p)}`)
      assert.equal(typeof r.p.token, 'string')
      assert.ok(!c.brut.some(trame => trame.includes(CHEMIN) || trame.includes('ENOSPC')), 'le message de l’adaptateur a filé au client')
      const avertissements = journal.filter(l => l.niveau === 'warn' && JSON.stringify(l.meta ?? null).includes('ENOSPC'))
      assert.equal(avertissements.length, 1, 'un avertissement au journal du serveur')
      await app.stop()
    })
  }
})
