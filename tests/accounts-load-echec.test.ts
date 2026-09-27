// accounts.ts::assurerCharge() — un load() qui échoue au 1er accès NE DOIT PLUS laisser
// account:create se poursuivre sur un index vide (byName) : la création doit être refusée par un
// code stable, RIEN écrit (aucun save() appelé), tant qu'un chargement n'a pas réussi. account:login,
// lui, garde son comportement historique (compte introuvable → 'account-denied', MÊME message que
// l'anti-énumération, cf. docs/27-accounts.md §6) — ce fichier vérifie donc les DEUX endpoints, pas
// seulement celui qui change.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'
import type { MjsWsAccountsOptions, MjsWsAccountsPersistAdapter } from '../src/mjs-ws/accounts.js'

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

const SECRET = 'secret-test-load-echec'

async function startApp(persist: MjsWsAccountsPersistAdapter, opts: Partial<MjsWsAccountsOptions> = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} })
  app.use(accountsPackage({ secret: SECRET, persist, ...opts } as MjsWsAccountsOptions))
  await app.listen()
  return { transport, app }
}

describe('MJS-WS — accounts.ts : account:create refuse tant que persist.load() n\'a pas réussi', () => {
  it('a. load() en échec → account:create rejette account-load-failed, AUCUN save() appelé', async () => {
    let loadCalls = 0
    let saveCalls = 0
    const persist: MjsWsAccountsPersistAdapter = {
      async load() { loadCalls++; throw new Error('panne disque simulée') },
      save() { saveCalls++ },
      remove() {},
    }
    const { transport, app } = await startApp(persist)
    const s = connectAnonyme(transport, 'memory://loadb01a')
    await tick()

    await assert.rejects(
      s.request('account:create', { name: 'zora', secret: 'motdepasse123' }),
      (e: any) => e === 'account-load-failed',
      'account:create doit être refusé par un code stable quand le chargement initial a échoué',
    )
    assert.equal(loadCalls, 1, 'load() appelé une fois')
    assert.equal(saveCalls, 0, 'AUCUNE tentative de sauvegarde — rien ne doit être créé sur un index non chargé')

    s.destroy(); await app.stop()
  })

  it('b. une fois le chargement réparé, un appel ultérieur retente et la création réussit', async () => {
    let loadCalls = 0
    const persist: MjsWsAccountsPersistAdapter = {
      async load() {
        loadCalls++
        if (loadCalls === 1) throw new Error('panne disque transitoire simulée')
        return []
      },
      save() {}, remove() {},
    }
    const { transport, app } = await startApp(persist)
    const s1 = connectAnonyme(transport, 'memory://loadb01b1')
    await tick()
    await assert.rejects(s1.request('account:create', { name: 'zora', secret: 'motdepasse123' }), (e: any) => e === 'account-load-failed')
    assert.equal(loadCalls, 1)

    const s2 = connectAnonyme(transport, 'memory://loadb01b2')
    await tick()
    const creation = await s2.request('account:create', { name: 'zora', secret: 'motdepasse123' }) as any
    assert.equal(creation.ok, true, 'la création réussit une fois le chargement retenté avec succès')
    assert.equal(loadCalls, 2, 'load() retenté au 2e appel (pas de nouvelle tentative avant, cf. accounts-persist-retry.test.ts)')

    s1.destroy(); s2.destroy(); await app.stop()
  })

  it("c. account:login garde son comportement historique (compte introuvable → 'account-denied', jamais account-load-failed)", async () => {
    let loadCalls = 0
    const persist: MjsWsAccountsPersistAdapter = {
      async load() { loadCalls++; throw new Error('panne disque simulée') },
      save() {}, remove() {},
    }
    const { transport, app } = await startApp(persist)
    const s = connectAnonyme(transport, 'memory://loadb01c')
    await tick()

    await assert.rejects(
      s.request('account:login', { name: 'zora', secret: 'motdepasse123' }),
      (e: any) => e === 'account-denied',
      'login sur un chargement en échec reste indiscernable d\'un pseudo inexistant (anti-énumération)',
    )
    assert.equal(loadCalls, 1)

    s.destroy(); await app.stop()
  })
})
