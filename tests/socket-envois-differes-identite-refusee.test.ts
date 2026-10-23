// µ.socket — un envoi différé (`debounce`, `coalesce`) encore en attente quand la connexion finit pour l'identité qui l'a
// écrit (refus du serveur, adieu du serveur, session exclusive perdue) est annulé comme par close() : il ne part jamais
// sous une autre identité (la connexion invitée qui suit un jeton refusé, ou un connect() sous un autre compte), et
// l'avertissement du refus le compte avec la file hors ligne. Refus et adieu contre un vrai serveur MJS-WS ; la fermeture
// 4003/4004 sans trame d'adieu (trame perdue en route), qu'un serveur n'envoie jamais seule, sur un faux WebSocket
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string) => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
const clientSrc = ['mjs_socket.ts', 'mjs_chat.ts', 'mjs_lobby.ts', 'mjs_accounts.ts'].map(lire).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-du-test-des-envois-differes'

async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) { await tick(10) }
}

function stockage(): any {
  const store: Record<string, string> = {}
  return { store, getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v) }, removeItem: (k: string) => { delete store[k] } }
}

function runtime(WS: any, local: any, avertis: string[] = []): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: (m: any) => { avertis.push(String(m)) }, log: () => {}, _mjs_txt: (_k: any, v: any, d: string) => d.replace(/\{(\w+)\}/g, (_t: string, n: string) => String(v && v[n])), _mjs_msg: (_k: any, _v: any, d: string) => d }
  new Function('µ', 'WebSocket', 'localStorage', clientSrc)(µ, WS, local)
  return µ
}

const versServeur = (transport: MemoryTransport) => function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }

class FauxWS {
  static tous: FauxWS[] = []
  readyState = 0; sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor() { FauxWS.tous.push(this) }
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() { this.readyState = 3 }
}

describe('µ.socket — envois différés en attente quand l identité qui les a écrits est refusée ou remplacée', function() {
  this.timeout(15000)

  it('jeton gardé expiré : un debounce et un coalesce écrits pendant l essai du jeton ne partent pas sous l identité invitée, l avertissement les compte', async () => {
    const transport = new MemoryTransport()
    const app: any = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} } as any)
    app.use(accountsPackage({ secret: SECRET, persist: new MemoryAccountsPersistAdapter(), ttl: 1 } as any))
    const recus: any[] = []
    app.on('note', (p: any, c: any) => { recus.push({ texte: p && p.texte, par: (c.identity && c.identity.name) || 'invité' }) })
    await app.listen()
    const a = runtime(versServeur(transport), stockage()).socket('memory://creation')
    await a.account.create('zora', 'motdepasse123')
    const jeton = a.account.token
    a.destroy()
    const exp = JSON.parse(Buffer.from(jeton.split('.')[1], 'base64url').toString()).exp
    await attendre(() => Date.now() >= exp * 1000 + 30)
    const local = stockage()
    local.store['mjs-token'] = jeton
    const avertis: string[] = []
    const b = runtime(versServeur(transport), local, avertis).socket('memory://rechargee')
    const compte = b.account
    b.send('note', { texte: 'différé' }, { debounce: 200 })
    b.send('note', { texte: 'regroupé' }, { coalesce: 200 })
    await attendre(() => b.state === 'open')
    await tick(400)
    assert.equal(b.state, 'open', 'la page ne repart pas en invité')
    assert.equal(compte.loggedIn, false)
    assert.deepEqual(recus, [], 'un envoi différé écrit pendant l essai du jeton est parti sous l identité invitée')
    assert.ok(avertis.some(m => /\(2 en attente\)/.test(m)), 'l avertissement ne compte pas les envois différés : ' + JSON.stringify(avertis))
    b.destroy(); await app.stop()
  })

  it('adieu du serveur (onglet remplacé, session exclusive) puis connect() sous un autre compte : le brouillon différé ne part pas sous lui', async () => {
    const transport = new MemoryTransport()
    const app: any = mjsWs({ transport, heartbeat: 0, sessionExclusive: true, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    const recus: any[] = []
    app.on('note', (p: any, c: any) => { recus.push({ texte: p && p.texte, par: c.identity && c.identity.id }) })
    await app.listen()
    let qui = 'alice'
    const s1 = runtime(versServeur(transport), stockage()).socket('memory://onglet1', { auth: () => ({ id: qui }) })
    s1.connect()
    await attendre(() => s1.state === 'open')
    s1.send('note', { texte: "brouillon d'alice" }, { debounce: 300 })
    const s2 = runtime(versServeur(transport), stockage()).socket('memory://onglet2', { auth: () => ({ id: 'alice' }) })
    s2.connect()
    await attendre(() => s1.state === 'closed')
    assert.equal(s1.state, 'closed', 'le premier onglet n a pas été remplacé')
    qui = 'bob'
    s1.connect()
    await attendre(() => s1.state === 'open')
    await tick(500)
    assert.deepEqual(recus.filter(r => r.texte === "brouillon d'alice"), [], "le brouillon différé d'alice est parti sous l'identité de bob")
    s1.destroy(); s2.destroy(); await app.stop()
  })

  it('fermeture 4003 ou 4004 sans trame d adieu : les envois différés en attente ne rejoignent pas la file', async () => {
    const µ = runtime(FauxWS, stockage())
    for (const fin of [4003, 4004]) {
      const s = µ.socket('wss://differe-' + fin, { heartbeat: 0 })
      s.connect()
      const ws = FauxWS.tous[FauxWS.tous.length - 1]
      ws.readyState = 1; ws.onopen({})   // µ:hello parti
      ws.onmessage({ data: JSON.stringify({ t: 'µ:welcome', p: {} }) })
      s.send('note', { texte: 'différé' }, { debounce: 30 })
      s.send('note', { texte: 'regroupé' }, { coalesce: 30 })
      ws.readyState = 3; ws.onclose({ code: fin })
      await tick(80)
      assert.equal(s.state, 'closed')
      assert.equal(s._mjs_queue.length, 0, 'un envoi différé rejoint la file après la fin ' + fin)
      s.destroy()
    }
  })
})
