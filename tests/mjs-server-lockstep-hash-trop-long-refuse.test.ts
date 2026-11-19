// Mode lockstep : un `µgame:hash` dont le hash dépasse 64 caractères est refusé — jamais retenu, dit une fois par joueur dans le journal du
// serveur. Le hash d'un état tient en 8 caractères (FNV-1a) : sans borne, un joueur faisait garder au serveur des hash de 60 000 caractères,
// un par tick de la fenêtre. Un hash de 64 caractères reste compté ; la longueur se compte en caractères (un emoji en vaut un, pas deux
// unités UTF-16), pour la borne comme pour le message. Vrai serveur sur 127.0.0.1, vrais clients WebSocket

import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsServer } from '../src/mjs-server/index.js'

const port = () => 43000 + Math.floor(Math.random() * 3000)
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Client { req: (t: string, p?: unknown) => Promise<any>, send: (t: string, p?: unknown) => void, close: () => Promise<void> }

async function client(p: number, id: string): Promise<Client> {
  const ws    = new WebSocket(`ws://127.0.0.1:${p}/`)
  const acks  = new Map<number, (m: any) => void>()
  const ready = new Promise<void>(r => ws.on('message', (raw: any) => {
    const m = JSON.parse(String(raw))
    if (m.t === 'µ:welcome') r()
    if (m.t === 'µ:ack' && acks.has(m.id)) { acks.get(m.id)!(m); acks.delete(m.id) }
  }))
  let n = 0
  await new Promise<void>((r, j) => { ws.on('open', () => r()); ws.on('error', j) })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id } } }))
  await ready
  return {
    req: (t, pl) => new Promise(r => { const i = ++n; acks.set(i, r); ws.send(JSON.stringify({ t, id: i, p: pl })) }),
    send: (t, pl) => ws.send(JSON.stringify({ t, p: pl })),
    close: () => new Promise<void>(r => { ws.on('close', () => r()); ws.close() })
  }
}

describe('MJS-Server — lockstep : un hash trop long est refusé', function () {
  this.timeout(20000)

  it('dix hash de 60 000 caractères puis un de 65 : aucun retenu, un seul avertissement ; 64 caractères ou 33 emoji comptent ; 65 emoji sont dits « 65 caractères »', async () => {
    const p    = port()
    const logs: string[] = []
    const app  = mjsServer({ host: '127.0.0.1', port: p, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (...a: unknown[]) => { logs.push(a.map(String).join(' ')) } } as any)
    let partie: any = null
    app.game('str', { mode: 'lockstep', seats: 2, tick: 20, moves: {}, hooks: { onCreate: (g: any) => { partie = g } } } as any)
    await app.listen()
    const a = await client(p, 'alice')
    const b = await client(p, 'bob')
    try {
      await a.req('µgame:play', { type: 'str' })
      const game = (await b.req('µgame:play', { type: 'str' })).p.game
      await wait(120)
      const tc = partie.seq
      for (let i = 0; i < 10; i++) b.send('µgame:hash', { game, tick: tc - i, h: 'h'.repeat(60000) + i })
      b.send('µgame:hash', { game, tick: tc - 10, h: 'h'.repeat(65) })
      await wait(150)
      const longs = partie._lockstep._hashSize()
      const avis  = logs.filter(l => /µgame:hash/.test(l) && /64/.test(l))
      b.send('µgame:hash', { game, tick: tc - 11, h: 'h'.repeat(64) })
      b.send('µgame:hash', { game, tick: tc - 12, h: '😀'.repeat(33) })
      a.send('µgame:hash', { game, tick: tc - 13, h: '😀'.repeat(65) })
      await wait(100)
      assert.equal(longs, 0, 'aucun hash trop long retenu')
      assert.equal(avis.length, 1, logs.join('\n'))
      assert.match(avis[0], /bob/)
      assert.equal(partie._lockstep._hashSize(), 2, 'le hash de 64 caractères et celui de 33 emoji sont retenus')
      const alice = logs.filter(l => /µgame:hash/.test(l) && /alice/.test(l))
      assert.equal(alice.length, 1, logs.join('\n'))
      assert.match(alice[0], /65 caractères, 64 au plus/)
    }
    finally {
      await a.close()
      await b.close()
      await app.stop()
    }
  })
})
