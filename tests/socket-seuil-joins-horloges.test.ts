// µ.socket — aucune fenêtre de temps pour attribuer un refus de salon : le serveur nomme le salon qu'il refuse
// (`µ:error { code: 'join-denied', room }`) et le client ne retire que lui, que le refus arrive 3 s ou 10 s après le
// join sur l'horloge que le client lit (celle de `_mjs_now`, que le test avance).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

// un join refusé 40 ms après avoir été envoyé : l'erreur du serveur arrive à son tour
async function essai(avance: number): Promise<boolean> {
  const transport = new MemoryTransport()
  const app       = mjsWs({
    transport, heartbeat: 0, auth: (hello: any) => hello.auth ?? { id: 'anon' }, onLog: () => {},
    rooms: { join: (room: string) => room.startsWith('lent:') ? new Promise<boolean>((fin) => setTimeout(() => fin(false), 40)) : true },
  } as any)
  await app.listen()
  const µ = makeClient(transport)
  const s = µ.socket('memory://seuil-' + avance, { reconnect: { enabled: false } })
  s.connect()
  await tick(10)
  s.room('lent:a')
  // l'erreur arrive `avance` ms après le join, sur l'horloge du client
  const reel = s._mjs_now.bind(s)
  s._mjs_now = () => reel() + avance
  await tick(150)
  const garde = !!s._mjs_rooms['lent:a']
  s.destroy()
  await app.stop()
  return garde
}

describe('µ.socket — refus de salon, quel que soit le délai', () => {
  it('un refus 3 s après le join : le salon nommé est retiré', async () => {
    assert.equal(await essai(3000), false)
  })

  it('un refus 10 s après le join : le salon nommé est retiré aussi', async () => {
    assert.equal(await essai(10_000), false)
  })
})
