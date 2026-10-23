// µ.socket + sock.chat contre un vrai serveur MJS-WS : un refus ordinaire (message de chat vide) juste après l'entrée dans
// un salon ne fait plus oublier ce salon ; seul le refus d'entrée, qui nomme le salon, le fait oublier
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, chatPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_chat.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function client(transport: MemoryTransport): any {
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', clientSrc)(µ, FauxWebSocket)
  return µ
}

async function demarrer(rooms?: any): Promise<{ transport: MemoryTransport }> {
  const transport = new MemoryTransport()
  const app: any = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, ...(rooms ? { rooms } : {}) } as any)
  app.use(chatPackage({}))
  await app.listen()
  return { transport }
}

describe('µ.socket — refus ordinaire après une entrée de salon', function() {
  this.timeout(10000)

  it('message de chat vide juste après l entrée : le salon reste tenu et revient après une coupure', async () => {
    const { transport } = await demarrer()
    const sz = client(transport).socket('memory://z', { auth: () => ({ id: 'z', name: 'Zora' }) })
    const salon = sz.chat('general')
    await tick(30)
    salon.send('')
    await tick(20)
    assert.ok(sz.lastError, 'le serveur a bien refusé le message vide')
    assert.deepEqual(Object.keys(sz._mjs_rooms), ['chat:general'], 'le refus du message a fait oublier le salon')
    sz._mjs_ws.close(1006)
    await tick(1200)
    assert.equal(sz.state, 'open')
    const st = client(transport).socket('memory://t', { auth: () => ({ id: 't', name: 'Theo' }) })
    const salonT = st.chat('general')
    await tick(30)
    salonT.send('coucou zora')
    await tick(30)
    assert.ok(salon.messages.some((m: any) => m.text === 'coucou zora'), 'Zora ne reçoit plus le salon general')
  })

  it('entrée refusée par la garde du serveur : ce salon seul est oublié', async () => {
    const { transport } = await demarrer({ join: (room: string) => room !== 'vip' })
    const sock = client(transport).socket('memory://garde', { auth: () => ({ id: 'g' }) })
    sock.room('libre')
    sock.room('vip')
    await tick(40)
    assert.equal(sock.state, 'open')
    assert.equal(sock.lastError && sock.lastError.room, 'vip')
    assert.deepEqual(Object.keys(sock._mjs_rooms), ['libre'])
  })
})
