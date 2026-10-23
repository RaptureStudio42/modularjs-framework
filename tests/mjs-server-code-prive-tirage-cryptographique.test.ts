// matchmaking.ts::generateCode — le code d'une partie privée sert de contrôle d'accès (rejoindre la partie, la regarder) : il est
// tiré par le générateur cryptographique de Node, jamais par Math.random, dont la suite se devine. Même alphabet (sans 0, O, 1, I)
// et même longueur (5) qu'avant
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const FORME = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/

async function creer(transport: MemoryTransport, id: string): Promise<string> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return (await sock.request('µgame:play', { type: 'prive', code: true })).code
}

describe('MJS-Server — code de partie privée tiré par le générateur cryptographique', () => {
  it('Math.random figé ne fige pas le code ; les codes gardent leur alphabet et leur longueur', async () => {
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    app.game('prive', { seats: 2, code: true, state: () => ({}), moves: {} })
    await app.listen()
    const origine = Math.random
    const codes: string[] = []
    try {
      // une seule partie sous Math.random figé : tiré par lui, le 2e code bouclerait sans fin sur le premier
      Math.random = () => 0
      try { codes.push(await creer(transport, 'a')) }
      finally { Math.random = origine }
      codes.push(await creer(transport, 'b'))
      codes.push(await creer(transport, 'c'))
    }
    finally {
      await app.stop()
    }
    assert.notEqual(codes[0], 'AAAAA', 'le code ne vient pas de Math.random')
    for (const code of codes) assert.match(code, FORME)
    assert.equal(new Set(codes).size, 3)
  })
})
