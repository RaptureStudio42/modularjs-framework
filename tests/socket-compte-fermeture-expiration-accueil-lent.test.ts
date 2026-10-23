// sock.account contre un vrai serveur MJS-WS (comptes) : un close() de l'appli gagne toujours sur la reprise du jeton
// gardé ; un jeton qui expire page ouverte fait repartir la connexion en invité (login() reste possible) ; un accueil
// plus lent que le filet de temps n'efface pas un jeton valide — seul un refus du serveur l'efface
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string) => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
const socketSrc = lire('mjs_socket.ts')
const comptesSrc = lire('mjs_accounts.ts')
// filet de temps de l'élévation (5 s, non réglable) réduit en mémoire seulement, pour un test rapide
const comptesRapidesSrc = comptesSrc.replace('MJS_ACCOUNT_ELEVATION_TIMEOUT_MS = 5000;', 'MJS_ACCOUNT_ELEVATION_TIMEOUT_MS = 150;')
assert.notEqual(comptesRapidesSrc, comptesSrc, 'le filet de temps est introuvable dans mjs_accounts.ts')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-du-test-des-comptes-fermeture'

async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) { await tick(10) }
}

function stockage(): any {
  const store: Record<string, string> = {}
  return { store, getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } }
}

function client(transport: MemoryTransport, id: string, local: any, opts: any = {}, comptes = comptesSrc): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', 'localStorage', socketSrc + '\n' + comptes)(µ, FauxWebSocket, local)
  return µ.socket('memory://' + id, opts)
}

async function demarrer(o: { ttl?: number, auth?: any, token?: any } = {}): Promise<{ transport: MemoryTransport, app: any }> {
  const transport = new MemoryTransport()
  const app: any = mjsWs({ transport, heartbeat: 0, auth: o.auth || accountsAuth(SECRET), onLog: () => {}, ...(o.token ? { token: o.token } : {}) } as any)
  app.use(accountsPackage({ secret: SECRET, persist: new MemoryAccountsPersistAdapter(), ...(o.ttl ? { ttl: o.ttl } : {}) } as any))
  await app.listen()
  return { transport, app }
}

// crée le compte zora sur une connexion jetable et rend son jeton
async function jetonDeZora(transport: MemoryTransport): Promise<string> {
  const a = client(transport, 'creation-' + Math.random().toString(36).slice(2, 8), stockage())
  await a.account.create('zora', 'motdepasse123')
  const jeton = a.account.token
  assert.ok(jeton, 'jeton créé')
  a.destroy()
  return jeton
}

describe("sock.account — fermeture par l'appli, jeton expiré page ouverte, accueil lent", function() {
  this.timeout(15000)

  it("un close() de l'appli pendant la reprise du jeton gardé gagne : la connexion reste fermée et le jeton gardé", async () => {
    const { transport, app } = await demarrer()
    const local = stockage()
    local.store['mjs-token'] = await jetonDeZora(transport)
    const b = client(transport, 'fermee-pendant', local)
    void b.account   // reprise du jeton gardé lancée
    b.close()        // l'appli coupe le temps réel (route quittée, mode hors ligne) avant l'accueil
    await tick(300)
    assert.equal(b.state, 'closed', "la connexion fermée par l'appli se rouvre toute seule")
    assert.equal(b._mjs_ws, null)
    assert.ok(local.store['mjs-token'], "le jeton gardé est effacé alors qu'aucun refus n'est venu")
    // fermée avant même la première lecture de sock.account : la reprise ne rouvre rien non plus
    const c = client(transport, 'fermee-avant', local)
    c.close()
    void c.account
    await tick(300)
    assert.equal(c.state, 'closed', "la reprise du jeton rouvre une connexion fermée par l'appli")
    // un connect() de l'appli reprend la main, avec le jeton gardé
    c.connect()
    await attendre(() => c.account.loggedIn)
    assert.equal(c.state, 'open')
    assert.equal(c.account.loggedIn, true)
    assert.equal(c.account.name, 'zora')
    b.destroy(); c.destroy(); await app.stop()
  })

  it('un jeton qui expire page ouverte : la connexion repart en invité et login() aboutit sans recharger', async () => {
    const { transport, app } = await demarrer({ ttl: 1, token: { sweep: 50, slack: 0 } })
    const local = stockage()
    const a = client(transport, 'expire', local, { reconnect: { backoff: [20], jitter: 0 } })
    await a.account.create('zora', 'motdepasse123')
    let refus = 0
    a.on('denied', () => { refus++ })
    // le jeton (1 s) expire : le serveur coupe, la reconnexion avec ce jeton est refusée
    await attendre(() => refus > 0, 4000)
    assert.equal(refus, 1, "le serveur n'a pas refusé le jeton expiré")
    await attendre(() => a.state === 'open', 1000)
    assert.equal(a.state, 'open', "tout le temps réel de la page s'éteint avec le jeton")
    assert.equal(a.account.loggedIn, false)
    assert.ok(a.account.error, "le refus du jeton n'est pas dit")
    assert.equal(local.store['mjs-token'], undefined, 'le jeton refusé reste gardé')
    assert.equal(a.send('note', { x: 1 }), true)
    await a.account.login('zora', 'motdepasse123')
    assert.equal(a.account.loggedIn, true)
    assert.equal(a.state, 'open')
    a.destroy(); await app.stop()
  })

  it("un accueil plus lent que le filet de temps n'efface pas un jeton gardé valide", async () => {
    const base = accountsAuth(SECRET)
    let lent = false
    const auth = async (hello: any, ...reste: any[]) => { if (lent && hello && hello.auth) { await tick(400) } return (base as any)(hello, ...reste) }
    const { transport, app } = await demarrer({ auth })
    const local = stockage()
    local.store['mjs-token'] = await jetonDeZora(transport)
    lent = true
    const b = client(transport, 'lente', local, {}, comptesRapidesSrc)
    const compte = b.account
    await tick(250)   // filet de temps (150 ms ici) dépassé, accueil pas encore arrivé
    assert.ok(local.store['mjs-token'], 'un jeton valide est effacé pour une simple lenteur')
    await attendre(() => compte.loggedIn, 2000)
    assert.equal(compte.loggedIn, true, "la connexion authentifiée n'est jamais reflétée")
    assert.equal(compte.name, 'zora')
    assert.ok(local.store['mjs-token'])
    b.destroy(); await app.stop()
  })
})
