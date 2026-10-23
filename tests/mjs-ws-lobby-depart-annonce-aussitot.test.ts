// Hall (lobby) : le départ d'un membre n'était vu qu'au balayage, une fois toutes les 50 actions `lobby:*` : dans un
// hall calme, un membre parti restait affiché chez les autres (et son annonce de table restait visible) longtemps après
// son départ. Le départ est désormais branché sur la sortie du salon du hall (µ:leave, expulsion, déconnexion) : les
// autres reçoivent `lobby:left` aussitôt. Un membre qui garde un autre onglet dans le hall n'est pas annoncé parti
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}
function connect(transport: MemoryTransport, url: string, identity: unknown): any {
  const s = makeClient(transport).socket(url, { auth: () => identity, reconnect: { enabled: false } })
  s.connect()
  return s
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

describe('MJS-WS — lobby : un départ du hall est annoncé aussitôt', function () {
  this.timeout(10000)

  it('un membre quitte le salon du hall : lobby:left chez les autres sans attendre le balayage, son annonce retirée', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    app.use(lobbyPackage({ onLog: () => {} }))
    await app.listen()
    try {
      const sZ = connect(transport, 'ws://z/', zora)
      const sT = connect(transport, 'ws://t/', theo)
      // une seule poignée par salon et par connexion : c'est elle qui part (une seconde poignée partagerait le salon)
      sZ.room('lobby:hall')
      const salleT = sT.room('lobby:hall')
      await tick(30)
      await sZ.request('lobby:enter', {})
      await sT.request('lobby:enter', {})
      sT.send('lobby:advertise', { title: 'Partie rapide' })
      await tick(30)
      const partis: any[] = []
      const retraits: any[] = []
      sZ.on('lobby:left', (p: any) => partis.push(p))
      sZ.on('lobby:withdrawn', (p: any) => retraits.push(p))
      salleT.leave()
      await tick(40)
      assert.deepEqual(partis, [{ hall: 'hall', id: '2' }], 'départ annoncé aussitôt')
      assert.equal(retraits.length, 1, 'son annonce retirée')
    } finally {
      await app.stop()
    }
  })

  it('deux onglets du même membre : le départ d’un seul n’est pas annoncé', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    app.use(lobbyPackage({ onLog: () => {} }))
    await app.listen()
    try {
      const sZ = connect(transport, 'ws://z/', zora)
      const sT1 = connect(transport, 'ws://t1/', theo)
      const sT2 = connect(transport, 'ws://t2/', theo)
      sZ.room('lobby:hall')
      const salleT1 = sT1.room('lobby:hall')
      const salleT2 = sT2.room('lobby:hall')
      await tick(30)
      await sZ.request('lobby:enter', {})
      await sT1.request('lobby:enter', {})
      await sT2.request('lobby:enter', {})
      await tick(20)
      const partis: any[] = []
      sZ.on('lobby:left', (p: any) => partis.push(p))
      salleT1.leave()
      await tick(40)
      assert.deepEqual(partis, [], 'un onglet reste dans le hall')
      salleT2.leave()
      await tick(40)
      assert.deepEqual(partis, [{ hall: 'hall', id: '2' }], 'dernier onglet parti : annoncé')
    } finally {
      await app.stop()
    }
  })
})
