// µ.socket contre un vrai serveur MJS-WS (MemoryTransport) : avec un `auth` asynchrone, aucune trame ne part avant le
// µ:hello (un salon, un flux ou une présence demandés pendant l'attente du jeton partent au welcome) ; une fermeture
// volontaire vide la file hors ligne (le brouillon d'un utilisateur ne part pas sous l'identité du suivant)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function client(transport: MemoryTransport): any {
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', clientSrc)(µ, FauxWebSocket)
  return µ
}

async function demarrer(): Promise<{ transport: MemoryTransport; app: any; recus: any[] }> {
  const transport = new MemoryTransport()
  const app: any = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
  const recus: any[] = []
  app.on('note', (p: any, c: any) => { recus.push({ text: p && p.text, as: c.identity && c.identity.id }) })
  await app.listen()
  return { transport, app, recus }
}

describe('µ.socket — auth asynchrone : rien ne part avant le µ:hello', function() {
  this.timeout(10000)

  it('aucune demande pendant l attente du jeton : la connexion s ouvre (témoin)', async () => {
    const { transport } = await demarrer()
    const µ = client(transport)
    let liberer: any
    const sock = µ.socket('memory://temoin', { auth: () => new Promise(r => { liberer = r }) })
    sock.connect()
    await tick(5)
    liberer({ id: 'u1' })
    await tick(20)
    assert.equal(sock.state, 'open')
  })

  for (const geste of ['room', 'stream', 'presence']) {
    it('sock.' + geste + '() pendant l attente du jeton : la connexion s ouvre au lieu d être refusée', async () => {
      const { transport } = await demarrer()
      const µ = client(transport)
      let liberer: any
      let refus: any = null
      const sock = µ.socket('memory://attente-' + geste, { auth: () => new Promise(r => { liberer = r }) })
      sock.on('denied', (p: any) => { refus = p })
      sock.connect()
      await tick(5)
      assert.equal(sock._mjs_ws && sock._mjs_ws.readyState, 1, 'le fil est ouvert, le jeton se fait attendre')
      if (geste === 'room') sock.room('salon')
      else if (geste === 'stream') sock.stream('scores')
      else sock.presence('salon')
      liberer({ id: 'u1' })
      await tick(30)
      assert.equal(refus, null, 'le serveur a refusé la connexion : ' + JSON.stringify(refus))
      assert.equal(sock.state, 'open')
      assert.equal(sock._mjs_abandoned, false)
    })
  }
})

describe('µ.socket — close() vide la file hors ligne', function() {
  this.timeout(10000)

  it('file hors ligne, close() puis connect() sous une autre identité : rien ne part sous le nouvel utilisateur', async () => {
    const { transport, recus } = await demarrer()
    const µ = client(transport)
    let qui = 'alice'
    const sock = µ.socket('memory://file', { auth: () => ({ id: qui }) })
    sock.connect()
    await tick(20)
    assert.equal(sock.state, 'open')
    sock._mjs_ws.close(1006)
    sock.send('note', { text: 'brouillon privé d alice' })
    sock.close()
    qui = 'bob'
    sock.connect()
    await tick(30)
    assert.equal(sock.state, 'open')
    assert.deepEqual(recus.filter(r => r.text === 'brouillon privé d alice'), [], 'le brouillon d alice est parti sous l identité de bob')
    sock.send('note', { text: 'message de bob' })
    await tick(20)
    assert.deepEqual(recus, [{ text: 'message de bob', as: 'bob' }])
  })
})
