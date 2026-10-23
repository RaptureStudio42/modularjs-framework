// sock.account contre un vrai serveur MJS-WS (comptes, chat, hall) : au rechargement avec un jeton gardé, un salon de
// chat et un hall ouverts avant le premier accès à sock.account reçoivent leur identité ; un jeton gardé invalide est
// effacé et la page continue en invité au lieu de perdre tout le temps réel
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter, chatPackage, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_chat.ts', 'mjs_lobby.ts', 'mjs_accounts.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-du-test-des-comptes'

function stockage(): any {
  const store: Record<string, string> = {}
  return { store, getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } }
}

function client(transport: MemoryTransport, id: string, local: any): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', 'localStorage', clientSrc)(µ, FauxWebSocket, local)
  return µ.socket('memory://' + id)
}

async function demarrer(): Promise<{ transport: MemoryTransport }> {
  const transport = new MemoryTransport()
  const app: any = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} } as any)
  app.use(accountsPackage({ secret: SECRET, persist: new MemoryAccountsPersistAdapter() } as any))
  app.use(chatPackage({}))
  app.use(lobbyPackage({} as any))
  await app.listen()
  return { transport }
}

describe('sock.account — jeton gardé au rechargement', function() {
  this.timeout(10000)

  it('chat et hall ouverts avant le premier accès à sock.account : ils reçoivent me et members', async () => {
    const { transport } = await demarrer()
    const local = stockage()
    const a = client(transport, 'creation', local)
    await a.account.create('zora', 'motdepasse123')
    const jeton = a.account.token
    assert.ok(jeton, 'jeton créé')
    a.destroy()
    local.store['mjs-token'] = jeton
    const b = client(transport, 'rechargee', local)
    const salon = b.chat('general')
    const hall = b.lobby()
    const compte = b.account
    await tick(400)
    assert.equal(b.state, 'open')
    assert.equal(compte.loggedIn, true)
    assert.equal(compte.name, 'zora')
    assert.ok(salon.me, 'salon.me reste null')
    assert.equal(salon.me.name, 'zora')
    assert.ok(hall.me, 'le hall n est jamais entré')
    assert.ok(hall.members.length >= 1, 'le hall n a aucun membre')
  })

  it('jeton gardé invalide : il est effacé et la connexion revient en invité', async () => {
    const { transport } = await demarrer()
    const local = stockage()
    local.store['mjs-token'] = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6Inpvcm9AIn0.signature-fausse'
    const b = client(transport, 'perime', local)
    const compte = b.account
    await tick(600)
    assert.equal(local.store['mjs-token'], undefined, 'le jeton invalide reste gardé')
    assert.equal(compte.loggedIn, false)
    assert.ok(compte.error, 'le refus du jeton est dit')
    assert.equal(b.state, 'open', 'plus aucune connexion temps réel, même en invité')
    assert.equal(b.send('note', { x: 1 }), true)
  })
})
