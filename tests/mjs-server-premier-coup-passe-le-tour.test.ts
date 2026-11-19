// Tour par tour 'roundrobin' : le premier coup d'une partie, joué avant tout tour établi, donne la main au siège qui suit celui qui vient
// de jouer — que le coup appelle game.next() tout de suite ou après un await. Le siège 0 qui ouvrait la partie gardait la main et
// rejouait aussitôt. Une partie dont le tour est déjà établi garde son ordre. Vrai serveur sur 127.0.0.1, vrais clients WebSocket

import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsServer } from '../src/mjs-server/index.js'

const port = () => 40000 + Math.floor(Math.random() * 3000)
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Client { req: (t: string, p?: unknown) => Promise<any>, close: () => Promise<void> }

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
    close: () => new Promise<void>(r => { ws.on('close', () => r()); ws.close() })
  }
}

// une partie de la file publique, `noms` assis dans l'ordre (siège 0, 1…) ; `jouer` passe la main ; rend de quoi jouer et lire le tour
async function partie(noms: string[], jouer: (game: any, player: any) => unknown, hooks?: Record<string, unknown>) {
  const p   = port()
  const app = mjsServer({ host: '127.0.0.1', port: p, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
  app.game('tour', { seats: noms.length, state: () => ({ coups: [] as string[] }), turns: { order: 'roundrobin', timeout: null }, moves: { jouer }, ...(hooks ? { hooks } : {}) } as any)
  await app.listen()
  const clis: Record<string, Client> = {}
  let game = ''
  for (const nom of noms) {
    clis[nom] = await client(p, nom)
    const r = await clis[nom].req('µgame:play', { type: 'tour' })
    if (r.p?.game) game = r.p.game
  }
  return {
    coup: async (nom: string) => (await clis[nom].req('µgame:move', { game, move: 'jouer' })).e ? 'refusé' : 'accepté',
    tour: async () => (await clis[noms[0]].req('µgame:resync', { game })).p.turn,
    fin: async () => { for (const c of Object.values(clis)) await c.close(); await app.stop() }
  }
}

describe('MJS-Server — tour par tour : le joueur qui ouvre la partie passe la main', function () {
  this.timeout(20000)

  it('le coup appelle game.next() tout de suite : alice ouvre, la main passe à bob, alice ne rejoue pas aussitôt', async () => {
    const g = await partie(['alice', 'bob'], (game, player) => { game.state.coups.push(player.id); game.next() })
    try {
      assert.equal(await g.coup('alice'), 'accepté')
      assert.equal(await g.tour(), 'bob')
      assert.equal(await g.coup('alice'), 'refusé')
      assert.equal(await g.coup('bob'), 'accepté')
      assert.equal(await g.tour(), 'alice')
    }
    finally { await g.fin() }
  })

  it('le coup appelle game.next() après un await : même ordre', async () => {
    const g = await partie(['alice', 'bob'], async (game, player) => { await wait(10); game.state.coups.push(player.id); game.next() })
    try {
      assert.equal(await g.coup('alice'), 'accepté')
      assert.equal(await g.tour(), 'bob')
      assert.equal(await g.coup('alice'), 'refusé')
      assert.equal(await g.coup('bob'), 'accepté')
      assert.equal(await g.tour(), 'alice')
    }
    finally { await g.fin() }
  })

  it('trois joueurs : bob (siège 1) ouvre, la main passe à carl, puis à alice', async () => {
    const g = await partie(['alice', 'bob', 'carl'], game => game.next())
    try {
      assert.equal(await g.coup('bob'), 'accepté')
      assert.equal(await g.tour(), 'carl')
      assert.equal(await g.coup('bob'), 'refusé')
      assert.equal(await g.coup('carl'), 'accepté')
      assert.equal(await g.tour(), 'alice')
    }
    finally { await g.fin() }
  })

  it('contraste : un tour déjà établi (onJoin donne la main au premier siège) garde son ordre', async () => {
    const g = await partie(['alice', 'bob'], game => game.next(), { onJoin: (game: any) => { if (game.players.every((j: any) => j)) game.next() } })
    try {
      assert.equal(await g.tour(), 'alice')
      assert.equal(await g.coup('bob'), 'refusé')
      assert.equal(await g.coup('alice'), 'accepté')
      assert.equal(await g.tour(), 'bob')
    }
    finally { await g.fin() }
  })
})
