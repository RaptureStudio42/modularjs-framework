// sock.account — un µ:denied qui vise le jeton COURANT (reconnexion automatique après une
// élévation déjà réussie, jeton révoqué entre-temps) doit remettre compte.state à l'état non
// connecté, pas seulement restaurer opts.auth — sinon le store réactif affiche encore un compte
// connecté avec un jeton que le serveur vient d'explicitement refuser. Un µ:denied qui ne vise
// PAS le jeton courant (connexion jamais élevée) ne doit rien changer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcSocket   = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const srcAccounts = readFileSync(join(__dirname, '../src/runtime/mjs_accounts.ts'), 'utf8')

class MockWS {
  static instances: MockWS[] = []
  url: string; readyState = 0; sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; MockWS.instances.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  _mjs_open() { this.readyState = 1; this.onopen && this.onopen({}) }
  _srv(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  _mjs_drop(code = 1006) { this.readyState = 3; this.onclose && this.onclose({ code }) }
}
function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  ;(globalThis as any).WebSocket = MockWS
  new Function('µ', srcSocket + '\n' + srcAccounts)(µ)
  return µ
}
const last = () => MockWS.instances[MockWS.instances.length - 1]

describe("sock.account — refus explicite visant le jeton courant après une reconnexion automatique", () => {
  it("élévation réussie puis coupure réseau puis refus explicite de la reconnexion auto : compte.state revient à non connecté", async () => {
    MockWS.instances = []
    const µ = makeMu()
    const s = µ.socket('wss://denyacc1', { heartbeat: 0, reconnect: { enabled: true, retries: 3, backoff: [5] } })
    const compte = s.account

    const pLogin = compte.login('zora', 'pw')
    const wsLogin = last(); wsLogin._mjs_open(); wsLogin._srv({ t: 'µ:welcome', p: {} })
    const reqLogin = wsLogin.sent.find((m: any) => m.t === 'account:login')
    wsLogin._srv({ t: 'µ:ack', id: reqLogin.id, p: { token: 'TOKEN_A' } })
    await new Promise((r) => setTimeout(r, 0))
    const wsElevate = last(); wsElevate._mjs_open(); wsElevate._srv({ t: 'µ:welcome', p: {} })
    await new Promise((r) => setTimeout(r, 0))
    await pLogin
    assert.equal(compte.loggedIn, true, 'précondition : élévation réussie')
    assert.equal(compte.token, 'TOKEN_A', 'précondition : jeton posé')

    // coupure réseau involontaire (aucun close()/nouvelle élévation appelée par l'appli) : le
    // socket programme SEUL une reconnexion (backoff) en réutilisant opts.auth (jeton élevé)
    wsElevate._mjs_drop(1006)
    await new Promise((r) => setTimeout(r, 30))
    const wsReconnect = last()
    assert.notEqual(wsReconnect, wsElevate, 'la reconnexion automatique a bien été tentée')
    wsReconnect._mjs_open()

    // le serveur refuse EXPLICITEMENT cette reconnexion (jeton révoqué entre-temps)
    wsReconnect._srv({ t: 'µ:denied', p: { message: 'jeton révoqué' } })
    await new Promise((r) => setTimeout(r, 0))

    assert.equal(compte.loggedIn, false, "le compte ne doit plus se dire connecté après ce refus explicite")
    assert.equal(compte.token, null, "le jeton refusé ne doit plus être exposé")
    assert.equal(compte.name, null)
    assert.deepEqual(compte.roles, [])
    assert.equal(compte.error, 'jeton révoqué', "l'application reçoit la raison du refus, comme à la reprise au démarrage")
    s.destroy()
  })

  it("un µ:denied sur une connexion jamais élevée laisse compte.state intact et n'écrase pas l'auth de l'appli", async () => {
    MockWS.instances = []
    const µ = makeMu()
    const originalAuth = () => ({ mode: 'invite' })
    const s = µ.socket('wss://denyacc2', { heartbeat: 0, auth: originalAuth, reconnect: { enabled: false } })
    const compte = s.account   // wiring + connexion anonyme paresseuse, AUCUNE élévation appelée

    const ws1 = last(); ws1._mjs_open()
    ws1._srv({ t: 'µ:denied', p: { message: 'anonyme refusé' } })   // refus qui ne concerne aucun jeton élevé
    await new Promise((r) => setTimeout(r, 0))

    assert.equal(compte.loggedIn, false)
    assert.equal(compte.token, null)
    assert.equal((s as any).opts.auth, originalAuth, "un refus qui ne concerne pas une élévation ne touche pas opts.auth")
  })
})
