// sock.account — élévation par reconnexion (mjs_accounts.ts) : un welcome TARDIF (arrivé après
// l'expiration du filet timeout de _accountElevate, via le backoff que mjs_socket.ts programme lui-
// même) doit quand même remettre compte.state en accord avec la connexion réelle. Un refus EXPLICITE
// (fermeture rapide, même mécanique que µ:denied) doit à l'inverse restaurer l'auth d'origine, pour
// qu'une reconnexion future ne retente pas une identité refusée.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const srcSocket   = readFileSync(new URL('../src/runtime/mjs_socket.ts', import.meta.url), 'utf8')
let srcAccounts    = readFileSync(new URL('../src/runtime/mjs_accounts.ts', import.meta.url), 'utf8')
// timeout d'élévation (5000ms, non configurable) réduit ICI EN MÉMOIRE SEULEMENT (substitution sur
// la chaîne lue, jamais réécrite sur disque) pour garder le test rapide.
const before = srcAccounts
srcAccounts = srcAccounts.replace('MJS_ACCOUNT_ELEVATION_TIMEOUT_MS = 5000;', 'MJS_ACCOUNT_ELEVATION_TIMEOUT_MS = 30;')
assert.notEqual(srcAccounts, before, 'la substitution du timeout doit avoir trouvé sa cible dans le fichier réel')

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

describe("sock.account — élévation : welcome tardif et refus explicite", () => {
  it('un welcome tardif (backoff déjà en vol après le timeout) synchronise quand même compte.state', async function() {
    this.timeout(5000)
    MockWS.instances = []
    const µ = makeMu()
    const s = µ.socket('wss://acclate1', { heartbeat: 0, reconnect: { backoff: [200], jitter: 0 } })
    const compte = s.account

    const p = compte.create('zora', 'motdepasse123')
    const wsCreate = last()
    wsCreate._mjs_open()
    wsCreate._srv({ t: 'µ:welcome', p: {} })
    const createReq = wsCreate.sent.find((m: any) => m.t === 'account:create')
    assert.ok(createReq, 'account:create doit être parti après le welcome')
    wsCreate._srv({ t: 'µ:ack', id: createReq.id, p: { token: 'aaa.bbb.ccc' } })
    await new Promise((r) => setTimeout(r, 0))

    const wsElevate1 = last()
    assert.notEqual(wsElevate1, wsCreate, 'la reconnexion contrôlée ouvre une autre socket pour le hello élevé')
    wsElevate1._mjs_drop()   // 1er essai élevé échoue avant tout welcome (aléa réseau)
    assert.equal(s.state, 'reconnecting')

    let rejection: any = null
    try { await p } catch (e) { rejection = e }
    assert.ok(rejection, 'create() rejette (timeout élévation, réduit à 30ms pour ce test)')
    assert.equal(compte.loggedIn, false, 'rejet correctement reflété entre-temps : pas connecté')

    // le backoff programmé PAR mjs_socket.ts lui-même finit par aboutir (réseau rétabli) — opts.auth
    // reste posé sur le jeton élevé (aucun refus EXPLICITE ici, juste un aléa réseau)
    await new Promise((r) => setTimeout(r, 260))
    const wsElevate2 = last()
    assert.notEqual(wsElevate2, wsElevate1, 'le backoff a rouvert une nouvelle socket')
    wsElevate2._mjs_open()
    wsElevate2._srv({ t: 'µ:welcome', p: {} })
    assert.equal(s.state, 'open')

    assert.equal(compte.loggedIn, true, "le welcome tardif doit remettre l'état en accord avec la connexion réelle")
    assert.equal(compte.token, 'aaa.bbb.ccc')
  })

  it('un refus explicite (fermeture rapide, type µ:denied) restaure opts.auth à sa valeur précédente', async () => {
    MockWS.instances = []
    const µ = makeMu()
    const originalAuth = () => ({ mode: 'invite' })
    const s = µ.socket('wss://acclate2', { heartbeat: 0, auth: originalAuth, reconnect: { enabled: false } })
    const compte = s.account

    const p = compte.login('zora', 'motdepasse123')
    const wsLogin = last()
    wsLogin._mjs_open()
    wsLogin._srv({ t: 'µ:welcome', p: {} })
    const loginReq = wsLogin.sent.find((m: any) => m.t === 'account:login')
    assert.ok(loginReq)
    wsLogin._srv({ t: 'µ:ack', id: loginReq.id, p: { token: 'xxx.yyy.zzz' } })
    await new Promise((r) => setTimeout(r, 0))

    const wsElevate = last()
    assert.notEqual(wsElevate, wsLogin)
    assert.notEqual((s as any).opts.auth, originalAuth, "opts.auth pointe désormais sur le jeton en cours d'élévation")
    wsElevate._srv({ t: 'µ:denied', p: { message: 'jeton invalide' } })   // refus EXPLICITE

    let rejection: any = null
    try { await p } catch (e) { rejection = e }
    assert.ok(rejection, "l'élévation doit rejeter sur un refus explicite")
    assert.equal((s as any).opts.auth, originalAuth, "opts.auth doit être restauré à sa valeur d'origine après un refus explicite")
  })
})
