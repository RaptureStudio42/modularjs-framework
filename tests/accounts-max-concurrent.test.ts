// accounts.ts::account:create — le contrôle opts.maxAccounts ne comptait que byName.size, jamais
// les créations EN COURS (pendingNames) : deux account:create concurrents de pseudos DIFFÉRENTS
// passaient tous les deux le contrôle synchrone avant que l'un ou l'autre n'ait écrit dans byName
// (await scrypt derrière) — maxAccounts:1 laissait donc passer 2 comptes. Le contrôle compte
// désormais aussi les réservations en cours.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import type { MjsWsAccountsOptions } from '../src/mjs-ws/accounts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}
function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  return makeMu()
}
function connectAnonyme(transport: MemoryTransport, url: string): any {
  const s = makeClient(transport).socket(url, { auth: () => undefined, reconnect: { enabled: false } })
  s.connect()
  return s
}

const SECRET = 'secret-test-max-concurrent'

async function startApp(opts: Partial<MjsWsAccountsOptions> = {}, wsOpts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp; persist: MemoryAccountsPersistAdapter }> {
  const transport = new MemoryTransport()
  const persist = new MemoryAccountsPersistAdapter()
  const app = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {}, ...wsOpts })
  app.use(accountsPackage({ secret: SECRET, persist, ...opts } as MjsWsAccountsOptions))
  await app.listen()
  return { transport, app, persist }
}

describe('MJS-WS — accounts.ts : maxAccounts respecté même en création concurrente', () => {
  it('a. maxAccounts:1, deux pseudos DIFFÉRENTS créés en même temps → UNE SEULE réussit', async () => {
    const { transport, app, persist } = await startApp({ maxAccounts: 1 })
    const s1 = connectAnonyme(transport, 'memory://maxb03a')
    const s2 = connectAnonyme(transport, 'memory://maxb03b')
    await tick()

    // AUCUN await entre les deux requêtes — même technique que accounts-race-create.test.ts
    const p1 = s1.request('account:create', { name: 'nomun', secret: 'motdepasse123' }).then((r: any) => ({ ok: true, r })).catch((e: any) => ({ ok: false, e }))
    const p2 = s2.request('account:create', { name: 'nomdeux', secret: 'motdepasse456' }).then((r: any) => ({ ok: true, r })).catch((e: any) => ({ ok: false, e }))
    const [r1, r2] = await Promise.all([p1, p2])

    const succes = [r1, r2].filter((r: any) => r.ok)
    const echecs = [r1, r2].filter((r: any) => !r.ok)
    assert.equal(succes.length, 1, 'UNE SEULE des deux créations concurrentes doit réussir (maxAccounts:1)')
    assert.equal(echecs.length, 1, 'la SECONDE doit être refusée')
    assert.equal((echecs[0] as any).e, 'account-limit-reached', 'refusée par le plafond, pas une autre cause')

    const rows = await persist.load()
    assert.equal(rows.length, 1, 'UN SEUL compte persisté — jamais deux, même en concurrence')

    s1.destroy(); s2.destroy(); await app.stop()
  })

  it('b. maxAccounts:2, deux créations concurrentes de pseudos différents → les DEUX réussissent (pas plus strict que nécessaire)', async () => {
    const { transport, app, persist } = await startApp({ maxAccounts: 2 })
    const s1 = connectAnonyme(transport, 'memory://maxb03c')
    const s2 = connectAnonyme(transport, 'memory://maxb03d')
    await tick()

    const p1 = s1.request('account:create', { name: 'alpha', secret: 'motdepasse123' })
    const p2 = s2.request('account:create', { name: 'beta', secret: 'motdepasse456' })
    const [r1, r2] = await Promise.all([p1, p2]) as any[]
    assert.equal(r1.ok, true)
    assert.equal(r2.ok, true)

    const rows = await persist.load()
    assert.equal(rows.length, 2, 'les deux comptes légitimes sont bien créés, le plafond n\'est pas plus strict que sa valeur')

    s1.destroy(); s2.destroy(); await app.stop()
  })
})
