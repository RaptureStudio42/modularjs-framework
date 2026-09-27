// sock.account — élévation : un µ:denied EXPLICITE qui arrive APRÈS que le filet timeout (5 s,
// réduit ici pour le test) ait déjà réglé la promesse d'élévation doit quand même restaurer
// opts.auth à sa valeur d'origine — sinon toute reconnexion ultérieure retenterait indéfiniment un
// jeton que le serveur a pourtant explicitement refusé.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcSocket = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
let srcAccounts = readFileSync(join(__dirname, '../src/runtime/mjs_accounts.ts'), 'utf8')
// timeout d'élévation (5000ms, non configurable) réduit ICI EN MÉMOIRE SEULEMENT (substitution sur
// la chaîne lue, jamais réécrite sur disque) pour garder le test rapide — même patron que
// accounts-elevate-late-welcome.test.ts.
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

describe("sock.account — élévation : refus tardif (après le filet timeout)", () => {
  it("un µ:denied qui arrive APRÈS le timeout restaure quand même opts.auth à sa valeur d'origine", async function() {
    this.timeout(5000)
    MockWS.instances = []
    const µ = makeMu()
    const originalAuth = () => ({ mode: 'invite' })
    const s = µ.socket('wss://accdeny1', { heartbeat: 0, auth: originalAuth, reconnect: { enabled: false } })
    const compte = s.account

    const p = compte.login('zora', 'motdepasse123')
    const wsLogin = last()
    wsLogin._mjs_open()
    wsLogin._srv({ t: 'µ:welcome', p: {} })
    const loginReq = wsLogin.sent.find((m: any) => m.t === 'account:login')
    wsLogin._srv({ t: 'µ:ack', id: loginReq.id, p: { token: 'bad.tok.en' } })
    await new Promise((r) => setTimeout(r, 0))

    const wsElevate = last()
    assert.notEqual(wsElevate, wsLogin, 'la reconnexion contrôlée ouvre une autre socket pour le hello élevé')
    assert.notEqual((s as any).opts.auth, originalAuth, "opts.auth pointe sur le jeton en cours d'élévation")

    // rien ne se passe sur wsElevate : le timeout (30ms réduit) expire avant tout denied
    let rejection: any = null
    try { await p } catch (e) { rejection = e }
    assert.ok(rejection, 'le timeout rejette la promesse')

    // le denied EXPLICITE arrive ENSUITE, après que le filet timeout ait déjà réglé la promesse
    wsElevate._srv({ t: 'µ:denied', p: { message: 'jeton invalide (tardif)' } })
    await new Promise((r) => setTimeout(r, 0))

    assert.equal((s as any).opts.auth, originalAuth, "un refus tardif restaure l'identité précédente")

    // une reconnexion explicite ultérieure ne doit pas retenter le jeton refusé
    const nBefore = MockWS.instances.length
    s.connect()
    assert.equal(MockWS.instances.length, nBefore + 1)
    const wsAfter = last()
    wsAfter._mjs_open()
    assert.equal(wsAfter.sent[0].t, 'µ:hello')
    assert.deepEqual(wsAfter.sent[0].p.auth, originalAuth(), "le hello rejoué utilise l'identité restaurée, pas le jeton refusé")
    s.destroy()
  })
})
