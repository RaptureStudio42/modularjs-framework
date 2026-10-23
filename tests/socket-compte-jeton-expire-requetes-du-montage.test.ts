// sock.account contre un vrai serveur MJS-WS, au rechargement avec un jeton gardé EXPIRÉ (le retour ordinaire d'un
// visiteur) : la page repart en invité. Ce qu'elle a demandé pendant l'essai du jeton ne part jamais sous l'identité
// invitée, mais rien ne se perd sans un mot : une requête qui attendait l'ouverture est rejetée avec la raison du refus
// (`denied`), pas « connexion fermée », et la file hors ligne vidée est signalée. Une création ou une connexion de compte
// lancée pendant ce temps part sur la connexion invitée et aboutit. Avec un jeton VALIDE, une requête déjà partie quand
// l'élévation reconnecte n'est jamais rejetée comme non servie : son résultat est dit inconnu (`unknown`)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_chat.ts', 'mjs_lobby.ts', 'mjs_accounts.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-du-test-des-jetons-expires'

async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) { await tick(10) }
}

function stockage(): any {
  const store: Record<string, string> = {}
  return { store, getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } }
}

function client(transport: MemoryTransport, id: string, local: any, avertis: string[] = []): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: (m: any) => { avertis.push(String(m)) }, log: () => {}, _mjs_txt: (_k: any, v: any, d: string) => d.replace(/\{(\w+)\}/g, (_t: string, n: string) => String(v && v[n])), _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', 'localStorage', clientSrc)(µ, FauxWebSocket, local)
  return µ.socket('memory://' + id)
}

// le serveur : comptes (ttl en secondes, absent = jetons sans échéance), une requête `donnees` qui dit sous quelle identité
// elle est servie (`lent` : servie en 150 ms), et une trame `note` dont chaque réception est notée
async function demarrer(ttl?: number): Promise<{ transport: MemoryTransport; recus: any[]; servies: () => number }> {
  const transport = new MemoryTransport()
  const app: any = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} } as any)
  app.use(accountsPackage({ secret: SECRET, persist: new MemoryAccountsPersistAdapter(), ...(ttl ? { ttl } : {}) } as any))
  const recus: any[] = []
  let servies = 0
  const qui = (c: any) => (c.identity && c.identity.name) || 'invité'
  app.serve('donnees', async (_p: any, c: any) => ({ qui: qui(c) }))
  app.serve('lent', async (_p: any, c: any) => { await tick(150); servies++; return { qui: qui(c) } })
  app.on('note', (p: any, c: any) => { recus.push({ texte: p && p.texte, par: qui(c) }) })
  await app.listen()
  return { transport, recus, servies: () => servies }
}

// un compte créé, son jeton gardé, puis attendu jusqu'à son échéance (ttl d'une seconde)
async function jetonMort(transport: MemoryTransport, nom: string): Promise<string> {
  const a = client(transport, 'creation-' + nom, stockage())
  await a.account.create(nom, 'motdepasse123')
  const jeton = a.account.token
  a.destroy()
  const exp = JSON.parse(Buffer.from(jeton.split('.')[1], 'base64url').toString()).exp
  await attendre(() => Date.now() >= exp * 1000 + 30, 3000)
  return jeton
}

const issue = (p: Promise<any>): { r: any } => {
  const o: any = { r: 'en attente' }
  p.then((v: any) => { o.r = { ok: v } }, (e: any) => { o.r = { rejet: e } })
  return o
}

describe('sock.account — jeton gardé expiré : ce que la page demande pendant son essai', function() {
  this.timeout(15000)

  it('requête qui attend l ouverture et envoi en file au montage : rejet « denied » dit, rien ne part en invité, file vidée signalée', async () => {
    const { transport, recus } = await demarrer(1)
    const local = stockage()
    local.store['mjs-token'] = await jetonMort(transport, 'zora')
    const avertis: string[] = []
    const b = client(transport, 'rechargee', local, avertis)
    const compte = b.account
    const req = issue(b.request('donnees', {}, { waitForOpen: true }))
    b.send('note', { texte: 'écrit au montage' })
    await attendre(() => b.state === 'open' && req.r !== 'en attente')
    await tick(50)
    assert.equal(b.state, 'open', 'la page ne repart pas en invité')
    assert.equal(compte.loggedIn, false)
    assert.equal(compte.error, 'authentification refusée')
    assert.notEqual(req.r, 'en attente', 'la requête n est jamais réglée')
    assert.ok(req.r.rejet, 'la requête est partie sous l identité invitée : ' + JSON.stringify(req.r))
    assert.equal(req.r.rejet.code, 'denied', 'rejet sans la raison du refus : ' + JSON.stringify(req.r.rejet))
    assert.equal(req.r.rejet.message, 'authentification refusée')
    assert.deepEqual(recus, [], 'un message écrit pendant l essai du jeton est parti sous l identité invitée')
    assert.ok(avertis.some(m => /file hors ligne vidée \(1 en attente\)/.test(m)), 'la file vidée n est pas signalée : ' + JSON.stringify(avertis))
    // le temps réel continue en invité
    assert.deepEqual(await b.request('donnees', {}, { waitForOpen: true }), { qui: 'invité' })
    b.destroy()
  })

  it('create() lancé pendant l essai du jeton : il part sur la connexion invitée et aboutit', async () => {
    const { transport } = await demarrer(1)
    const local = stockage()
    local.store['mjs-token'] = await jetonMort(transport, 'zora')
    const b = client(transport, 'creer-pendant', local)
    const compte = b.account
    const cree = issue(compte.create('bob', 'motdepasse456'))
    await attendre(() => cree.r !== 'en attente', 4000)
    assert.ok(!cree.r.rejet, 'create() échoue : ' + JSON.stringify(cree.r) + ' — account.error=' + JSON.stringify(compte.error))
    assert.equal(compte.loggedIn, true)
    assert.equal(compte.name, 'bob')
    assert.equal(compte.error, null)
    assert.deepEqual(await b.request('donnees', {}, { waitForOpen: true }), { qui: 'bob' })
    b.destroy()
  })

  it('login() lancé pendant l essai du jeton : il part sur la connexion invitée et aboutit', async () => {
    const { transport } = await demarrer(1)
    const carl = client(transport, 'compte-carl', stockage())
    await carl.account.create('carl', 'motdepasse789')
    carl.destroy()
    const local = stockage()
    local.store['mjs-token'] = await jetonMort(transport, 'zora')
    const b = client(transport, 'connecter-pendant', local)
    const compte = b.account
    const entre = issue(compte.login('carl', 'motdepasse789'))
    await attendre(() => entre.r !== 'en attente', 4000)
    assert.ok(!entre.r.rejet, 'login() échoue : ' + JSON.stringify(entre.r) + ' — account.error=' + JSON.stringify(compte.error))
    assert.equal(compte.loggedIn, true)
    assert.equal(compte.name, 'carl')
    b.destroy()
  })

  it('jeton valide, requête déjà partie quand sock.account est lu : jamais rejetée comme non servie', async () => {
    const { transport, servies } = await demarrer()
    const a = client(transport, 'creation-valide', stockage())
    await a.account.create('zora', 'motdepasse123')
    const jeton = a.account.token
    a.destroy()
    const local = stockage()
    local.store['mjs-token'] = jeton
    const b = client(transport, 'valide', local)
    let req: any = null
    b.on('welcome', () => {
      if (req) { return }
      req = issue(b.request('lent', {}, { waitForOpen: true }))
      setTimeout(() => { void b.account }, 20)   // menu de compte monté un peu plus tard
    })
    b.connect()
    await attendre(() => !!req && req.r !== 'en attente' && servies() === 1 && b.account.loggedIn, 3000)
    assert.equal(servies(), 1, 'le serveur n a pas servi la requête')
    assert.equal(b.account.loggedIn, true)
    assert.ok(req && req.r.rejet, 'réglée autrement : ' + JSON.stringify(req && req.r))
    assert.equal(req.r.rejet.code, 'unknown', 'une requête servie est rejetée comme non servie : ' + JSON.stringify(req.r.rejet))
    b.destroy()
  })
})
