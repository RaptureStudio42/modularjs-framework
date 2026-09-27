// sock.account — logout() appelé PENDANT qu'une élévation est encore en vol (avant son propre
// welcome) rend cette élévation caduque : le welcome tardif de CETTE élévation ne doit pas
// ressusciter loggedIn/le jeton — une opération plus récente (ici logout()) prime toujours sur une
// réponse d'élévation plus ancienne.
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

describe("sock.account — logout() pendant une élévation en vol", () => {
  it("le welcome tardif de l'élévation en cours ne ressuscite pas le compte après logout()", async () => {
    MockWS.instances = []
    const µ = makeMu()
    const s = µ.socket('wss://logoutrace1', { heartbeat: 0, reconnect: { enabled: false } })
    const compte = s.account

    const pLogin = compte.login('A', 'pw')
    const wsLogin = last()
    wsLogin._mjs_open()
    wsLogin._srv({ t: 'µ:welcome', p: {} })
    const reqLogin = wsLogin.sent.find((m: any) => m.t === 'account:login')
    wsLogin._srv({ t: 'µ:ack', id: reqLogin.id, p: { token: 'TOKEN_A' } })
    await new Promise((r) => setTimeout(r, 0))
    const wsElevate = last()
    assert.notEqual(wsElevate, wsLogin, 'la reconnexion contrôlée ouvre une autre socket pour le hello élevé')

    // AVANT que wsElevate reçoive son welcome (élévation encore en vol), l'utilisateur se déconnecte
    compte.logout()
    assert.equal(compte.loggedIn, false, "logout() reflète l'intention locale immédiatement")

    // le welcome de l'élévation (déclenchée par login(A), toujours en vol) arrive ENSUITE
    wsElevate._mjs_open()
    wsElevate._srv({ t: 'µ:welcome', p: {} })
    await new Promise((r) => setTimeout(r, 0))

    assert.equal(compte.loggedIn, false, 'le welcome tardif ne doit pas ressusciter le compte')
    assert.equal(compte.token, null, 'le jeton abandonné par logout() ne doit pas revenir')
    pLogin.catch(() => {})   // dangling — élévation abandonnée par logout(), plus personne ne l'attend
    s.destroy()
  })
})
