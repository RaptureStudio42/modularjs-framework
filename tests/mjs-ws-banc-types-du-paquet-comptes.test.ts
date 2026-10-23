// visiteur sans compte accueilli au banc : seules les trames du paquet comptes lui restent ouvertes. Leur liste était
// recopiée à la main dans le cœur ; elle vient maintenant du paquet lui-même, et ce test garde l'accord entre les deux
import assert from 'node:assert/strict'
import * as comptes from '../src/mjs-ws/accounts.js'

describe('MJS-WS — banc : les types ouverts viennent du paquet comptes', () => {
  it('la liste du paquet = les types `account:` qu’il sert, ni plus ni moins', () => {
    const ACCOUNTS_TYPES = (comptes as Record<string, unknown>).ACCOUNTS_TYPES as readonly string[]
    const servis: string[] = []
    const app: any = new Proxy({}, { get: (_cible, cle) => (cle === 'serve' || cle === 'on') ? (type: string) => { servis.push(type) } : () => {} })
    comptes.accountsPackage({ secret: 'secret-de-test-types-du-banc-assez-long', onLog: () => {} }).installer(app)
    assert.ok(Array.isArray(ACCOUNTS_TYPES) && ACCOUNTS_TYPES.length > 0, 'liste exportée par le paquet')
    assert.deepEqual([...ACCOUNTS_TYPES].sort(), servis.filter(t => t.startsWith('account:')).sort())
    assert.deepEqual([...ACCOUNTS_TYPES].sort(), ['account:create', 'account:login', 'account:logout'], 'même liste qu’avant')
  })
})
