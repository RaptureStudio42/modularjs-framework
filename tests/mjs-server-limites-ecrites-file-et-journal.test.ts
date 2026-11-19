// Les limites écrites au chapitre du serveur de jeu, jouées en vrai (serveur sur 127.0.0.1, vrais clients WebSocket) :
// - un compte n'a qu'un ticket par file, tenu par la connexion qui a lancé la recherche : elle se ferme, le ticket part — relancer la
//   recherche depuis un autre onglet l'apparie ;
// - un compte assis à une table privée qui demande la file du même type est rassis à sa table : quitter la table, puis demander la file,
//   le met en file ;
// - en lockstep, un joueur seul peut remplir le journal : la partie se termine pour tous ('journal-full')

import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsServer } from '../src/mjs-server/index.js'

const port = () => 46000 + Math.floor(Math.random() * 3000)
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Client { req: (t: string, p?: unknown) => Promise<any>, frames: any[], close: () => Promise<void> }

async function client(p: number, id: string): Promise<Client> {
  const ws     = new WebSocket(`ws://127.0.0.1:${p}/`)
  const acks   = new Map<number, (m: any) => void>()
  const frames: any[] = []
  const ready  = new Promise<void>(r => ws.on('message', (raw: any) => {
    const m = JSON.parse(String(raw))
    if (m.t === 'µ:welcome') r()
    if (m.t === 'µ:ack' && acks.has(m.id)) { acks.get(m.id)!(m); acks.delete(m.id); return }
    frames.push(m)
  }))
  let n = 0
  await new Promise<void>((r, j) => { ws.on('open', () => r()); ws.on('error', j) })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id } } }))
  await ready
  return {
    frames,
    req: (t, pl) => new Promise(r => { const i = ++n; acks.set(i, r); ws.send(JSON.stringify({ t, id: i, p: pl })) }),
    close: () => new Promise<void>(r => { ws.on('close', () => r()); ws.close() })
  }
}

const serveur = (p: number) => mjsServer({ host: '127.0.0.1', port: p, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)

describe('MJS-Server — les limites écrites de la file publique et du journal lockstep', function () {
  this.timeout(30000)

  it('la connexion qui a lancé la recherche se ferme : le ticket part ; la recherche relancée depuis l\'autre onglet trouve un adversaire', async () => {
    const p   = port()
    const app = serveur(p)
    let crees = 0
    app.game('duo', { seats: 2, state: () => ({}), moves: {}, view: () => ({}), hooks: { onCreate: () => { crees++ } } } as any)
    await app.listen()
    const a1 = await client(p, 'alice')
    const a2 = await client(p, 'alice')
    const b  = await client(p, 'bob')
    try {
      assert.deepEqual((await a1.req('µgame:play', { type: 'duo' })).p, { queue: 1 })
      assert.deepEqual((await a2.req('µgame:play', { type: 'duo' })).p, { queue: 1 }, 'le second onglet retrouve le même ticket')
      await a1.close()
      await wait(50)
      assert.deepEqual((await b.req('µgame:play', { type: 'duo' })).p, { queue: 1 }, 'le ticket d\'alice est parti avec sa connexion')
      assert.equal(crees, 0)
      const relance = await a2.req('µgame:play', { type: 'duo' })
      assert.equal(typeof relance.p.game, 'string', 'la recherche relancée apparie alice et bob')
      assert.equal(crees, 1)
    }
    finally {
      await a2.close()
      await b.close()
      await app.stop()
    }
  })

  it('un compte assis à sa table privée qui demande la file y est rassis ; sa table quittée, il entre dans la file', async () => {
    const p   = port()
    const app = serveur(p)
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {}, view: () => ({}) } as any)
    await app.listen()
    const c1 = await client(p, 'carl')
    const c2 = await client(p, 'carl')
    try {
      const prive = (await c1.req('µgame:play', { type: 'duo', code: true })).p
      const file  = (await c2.req('µgame:play', { type: 'duo' })).p
      assert.equal(file.game, prive.game, 'rassis à sa table privée')
      assert.equal('queue' in file, false, 'pas en file')
      const quitte = await c2.req('µgame:leave', { game: prive.game })
      assert.equal(quitte.e, undefined, JSON.stringify(quitte.p))
      assert.deepEqual((await c2.req('µgame:play', { type: 'duo' })).p, { queue: 1 }, 'sa table quittée, il est en file')
    }
    finally {
      await c1.close()
      await c2.close()
      await app.stop()
    }
  })

  it('lockstep : bob seul remplit le journal par ses ordres, la partie se termine pour alice aussi', async () => {
    const p   = port()
    const app = serveur(p)
    let fin: any = null
    app.game('str', { mode: 'lockstep', seats: 2, tick: 20, moves: {}, lockstepJournal: { maxBytes: 20000 }, hooks: { onEnd: (_g: any, r: any) => { fin = r } } } as any)
    await app.listen()
    const a = await client(p, 'alice')
    const b = await client(p, 'bob')
    try {
      await a.req('µgame:play', { type: 'str' })
      const game = (await b.req('µgame:play', { type: 'str' })).p.game
      let ordres = 0
      while (!fin && ordres < 400) {
        const r = await b.req('µgame:move', { game, move: 'o', p: { d: 'z'.repeat(1900) } })
        ordres++
        if (r.e) await wait(40)
      }
      await wait(80)
      assert.deepEqual(fin, { ended: true, reason: 'journal-full' })
      assert.deepEqual(a.frames.filter(f => f.t === 'µgame:end').map(f => f.p.result), [{ ended: true, reason: 'journal-full' }])
    }
    finally {
      await a.close()
      await b.close()
      await app.stop()
    }
  })
})
