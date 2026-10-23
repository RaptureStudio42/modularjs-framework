// µ.socket — la file hors ligne appartient à l'identité qui l'a remplie : un refus du serveur (µ:denied), un adieu
// (µ:bye) ou une session exclusive perdue (fermeture 4003, 4004) la vident ; rien d'elle ne part sous une autre
// identité au connect() suivant
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) { await tick(10) }
}

function runtime(WS: any): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  new Function('µ', 'WebSocket', socketSrc)(µ, WS)
  return µ
}

class FauxWS {
  static tous: FauxWS[] = []
  readyState = 0; sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor() { FauxWS.tous.push(this) }
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() { this.readyState = 3 }
}

describe('µ.socket — file hors ligne et identité refusée', function() {
  this.timeout(10000)

  it("reconnexion refusée (µ:denied) puis connect() sous une autre identité : le brouillon de la première ne part pas", async () => {
    const transport = new MemoryTransport()
    let refuserAlice = false
    const app: any = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => (refuserAlice && hello.auth && hello.auth.id === 'alice') ? false : hello.auth, onLog: () => {} } as any)
    const recus: any[] = []
    app.on('note', (p: any, c: any) => { recus.push({ texte: p && p.texte, par: c.identity && c.identity.id }) })
    await app.listen()
    const WS = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    let qui = 'alice'
    const sock = runtime(WS).socket('memory://file-refusee', { auth: () => ({ id: qui }), reconnect: { backoff: [20], jitter: 0 } })
    sock.connect()
    await attendre(() => sock.state === 'open')
    sock._mjs_ws.close(1006)   // coupure : le message suivant attend en file
    sock.send('note', { texte: "brouillon privé d'alice" })
    assert.equal(sock._mjs_queue.length, 1)
    refuserAlice = true        // la session d'alice est révoquée pendant la coupure
    await attendre(() => sock.state === 'closed')
    assert.equal(sock.state, 'closed', "la reconnexion d'alice n'a pas été refusée")
    assert.equal(sock._mjs_queue.length, 0, "la file d'alice survit au refus")
    qui = 'bob'                // bob se connecte sur le même onglet
    sock.connect()
    await attendre(() => sock.state === 'open')
    sock.send('note', { texte: 'message de bob' })
    await attendre(() => recus.length > 0)
    await tick(50)
    assert.deepEqual(recus, [{ texte: 'message de bob', par: 'bob' }], "le brouillon d'alice est parti sous l'identité de bob")
    sock.destroy(); await app.stop()
  })

  it('adieu du serveur (µ:bye) ou session exclusive perdue (fermeture 4003, 4004) : la file est vidée', () => {
    const µ = runtime(FauxWS)
    for (const fin of ['bye', 4003, 4004]) {
      const s = µ.socket('wss://file-' + fin, { heartbeat: 0 })
      s.connect()
      const ws = FauxWS.tous[FauxWS.tous.length - 1]
      ws.readyState = 1; ws.onopen({})   // µ:hello parti, accueil pas encore venu
      s.send('note', { texte: 'en file' })
      assert.equal(s._mjs_queue.length, 1)
      if (fin === 'bye') { ws.onmessage({ data: JSON.stringify({ t: 'µ:bye', p: { reason: 'maintenance' } }) }) }
      else { ws.readyState = 3; ws.onclose({ code: fin }) }
      assert.equal(s.state, 'closed')
      assert.equal(s._mjs_queue.length, 0, 'la file survit à la fin ' + fin)
      s.destroy()
    }
  })
})
