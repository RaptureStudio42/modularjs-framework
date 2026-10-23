// salon de chat et hall contre un vrai serveur MJS-WS (comptes, chat, hall) : leur identité (me) est redemandée à
// chaque accueil — elle suit l'élévation d'un compte (login(), jeton gardé lu après coup) et n'est jamais perdue
// quand sock.account est lu pendant que la demande est en route
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter, chatPackage, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_chat.ts', 'mjs_lobby.ts', 'mjs_accounts.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-du-test-identite-du-salon'

async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) { await tick(10) }
}

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

async function demarrer(): Promise<{ transport: MemoryTransport, app: any }> {
  const transport = new MemoryTransport()
  const app: any = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} } as any)
  app.use(accountsPackage({ secret: SECRET, persist: new MemoryAccountsPersistAdapter() } as any))
  app.use(chatPackage({}))
  app.use(lobbyPackage({} as any))
  await app.listen()
  return { transport, app }
}

// crée le compte zora sur une connexion jetable (déconnectée ensuite) et rend son jeton
async function jetonDeZora(transport: MemoryTransport): Promise<string> {
  const a = client(transport, 'creation-' + Math.random().toString(36).slice(2, 8), stockage())
  await a.account.create('zora', 'motdepasse123')
  const jeton = a.account.token
  assert.ok(jeton, 'jeton créé')
  await a.account.logout()
  a.destroy()
  return jeton
}

describe("sock.chat / sock.lobby — l'identité est redemandée à chaque accueil", function() {
  this.timeout(10000)

  it("sock.account lu à l'accueil invité, chat:me et lobby:enter en route : salon et hall reçoivent l'identité du compte", async () => {
    const { transport, app } = await demarrer()
    const local = stockage()
    local.store['mjs-token'] = await jetonDeZora(transport)
    const b = client(transport, 'rechargee', local)
    const salon = b.chat('general')
    const hall = b.lobby()
    let lu = false
    // un composant monté juste après l'ouverture (route paresseuse, menu de compte) lit sock.account
    b.on('welcome', () => { if (!lu) { lu = true; void b.account } })
    await attendre(() => !!(salon.me && salon.me.name === 'zora' && hall.me && hall.me.name === 'zora'))
    assert.equal(b.state, 'open')
    assert.equal(b.account.loggedIn, true)
    assert.ok(salon.me, 'salon.me reste null')
    assert.equal(salon.me.name, 'zora')
    assert.ok(hall.me, "le hall n'est jamais entré")
    assert.equal(hall.me.name, 'zora')
    assert.ok(hall.members.length >= 1, "le hall n'a aucun membre")
    b.destroy(); await app.stop()
  })

  it('salon et hall ouverts en invité, puis login() : leur identité suit le compte', async () => {
    const { transport, app } = await demarrer()
    await jetonDeZora(transport)
    const b = client(transport, 'invite-puis-login', stockage())
    const salon = b.chat('general')
    const hall = b.lobby()
    await attendre(() => !!(salon.me && hall.me))
    assert.ok(salon.me, 'précondition : identité invitée du salon reçue')
    assert.notEqual(salon.me.name, 'zora')
    await b.account.login('zora', 'motdepasse123')
    await attendre(() => !!(salon.me && salon.me.name === 'zora' && hall.me && hall.me.name === 'zora'))
    assert.equal(b.account.loggedIn, true)
    assert.equal(salon.me.name, 'zora', "salon.me garde l'identité invitée après login()")
    assert.equal(hall.me.name, 'zora')
    b.destroy(); await app.stop()
  })
})
