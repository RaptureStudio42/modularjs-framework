// FileAccountsPersistAdapter::save() rendait `void` — un échec d'écriture RÉEL (dossier
// impossible à créer, ENOTDIR) était avalé par _ecrireAtomique (log + unlink du tmp, sans relancer) :
// account-persist-failed (cf. docs/27-accounts.md §9) ne pouvait donc jamais se déclencher avec cet
// adaptateur, contrairement à ce que la doc annonce. save() rend maintenant la promesse d'écriture
// et la fait rejeter sur échec.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, FileAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'
import { mjsTmp } from './helpers/tmp.js'

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

const SECRET = 'secret-test-file-persist-echec'

// dossier de stockage IMPOSSIBLE à créer : le parent est un FICHIER, pas un dossier → mkdir
// recursive rend ENOTDIR (panne disque réaliste : point de montage disparu, permissions, etc.)
function dossierImpossible(prefix: string): string {
  const base = mjsTmp(prefix)
  const blocker = join(base, 'ceci-est-un-fichier')
  writeFileSync(blocker, 'x')
  return join(blocker, 'sous-dossier-impossible')
}

describe('MJS-WS — accounts.ts : FileAccountsPersistAdapter propage un échec d\'écriture réel', () => {
  it("a. save() rend une promesse qui REJETTE quand l'écriture atomique échoue (ENOTDIR)", async () => {
    const dir = dossierImpossible('b02-direct')
    const logs: Array<{ level: string; message: string }> = []
    const adapter = new FileAccountsPersistAdapter({ dir, onLog: (level, message) => logs.push({ level, message }) })

    const ret = adapter.save('acc1', { id: 'acc1', name: 'x', hash: 'h', salt: 's', roles: [], createdAt: 0, seenAt: 0, meta: {} })
    assert.equal(typeof (ret as any)?.then, 'function', 'save() rend désormais une PROMESSE (plus un void strict)')
    await assert.rejects(ret, 'la promesse rendue par save() reflète bien l\'échec réel de l\'écriture')
    assert.ok(logs.some(l => /échou/i.test(l.message)), 'échec toujours journalisé : '+ JSON.stringify(logs))

    await adapter.flush()   // ne lève jamais — flush() reste un filet best-effort, cf. son contrat
  })

  it("b. account:create avec CET adaptateur → refusé par account-persist-failed, rien de créé", async () => {
    // dossier VALIDE au départ (load() doit réussir, isolé du refus testé ailleurs quand le
    // chargement échoue — cf. accounts-load-echec.test.ts) — cassé SEULEMENT ensuite, entre les
    // deux créations, pour que seule l'ÉCRITURE échoue (le chargement, lui, est déjà en cache)
    const dir = mjsTmp('b02-integ')
    const adapter = new FileAccountsPersistAdapter({ dir, onLog: () => {} })
    const transport = new MemoryTransport()
    const app: MjsWsApp = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} })
    app.use(accountsPackage({ secret: SECRET, persist: adapter, onLog: () => {} }))
    await app.listen()

    const s1 = connectAnonyme(transport, 'memory://fileb02a')
    await tick()
    const premiere = await s1.request('account:create', { name: 'aya', secret: 'motdepasse000' }) as any
    assert.equal(premiere.ok, true, 'la 1re création réussit — dossier encore valide, chargement mis en cache')

    rmSync(dir, { recursive: true, force: true })
    writeFileSync(dir, 'x')   // le dossier devient un FICHIER — toute écriture dedans échoue désormais (ENOTDIR)

    const s2 = connectAnonyme(transport, 'memory://fileb02b')
    await tick()
    await assert.rejects(
      s2.request('account:create', { name: 'ivo', secret: 'motdepasse123' }),
      (e: any) => e === 'account-persist-failed',
      'un échec d\'écriture RÉEL de FileAccountsPersistAdapter doit désormais atteindre accounts.ts',
    )

    s1.destroy(); s2.destroy(); await app.stop()
  })
})
