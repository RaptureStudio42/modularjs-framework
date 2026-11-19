// Tour par tour 'roundrobin', premier game.next() d'une partie sans tour établi :
// - après un changement de phase (game.to), la main revient au premier siège : celui qui s'est dit prêt en dernier ne choisit pas qui
//   commence ;
// - un rechargement (arrêt, puis serveur neuf sur la même sauvegarde) ne change pas la main : le joueur qui vient de jouer ne rejoue pas ;
// - une sauvegarde écrite par la 4.0.0 (sans le dernier joueur noté) se recharge sans erreur, et la main passe au siège qui suit le dernier
//   coup de son journal.
// Vrai serveur sur 127.0.0.1, vrais clients WebSocket, MemoryPersistAdapter pour la sauvegarde

import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsServer, MemoryPersistAdapter } from '../src/mjs-server/index.js'

const port = () => 49000 + Math.floor(Math.random() * 3000)
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

const serveur = (p: number, extra: Record<string, unknown> = {}) => mjsServer({ host: '127.0.0.1', port: p, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, ...extra } as any)

// une partie de la file publique, `noms` assis dans l'ordre (siège 0, 1…)
async function table(noms: string[], def: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const p   = port()
  const app = serveur(p, extra)
  app.game('tour', { seats: noms.length, state: () => ({ coups: [] as string[] }), turns: { order: 'roundrobin', timeout: null }, ...def } as any)
  await app.listen()
  const clis: Record<string, Client> = {}
  let game = ''
  for (const nom of noms) {
    clis[nom] = await client(p, nom)
    const r = await clis[nom].req('µgame:play', { type: 'tour' })
    if (r.p?.game) game = r.p.game
  }
  return {
    game,
    coup: async (nom: string, move = 'jouer') => (await clis[nom].req('µgame:move', { game, move })).e ? 'refusé' : 'accepté',
    tour: async () => (await clis[noms[0]].req('µgame:resync', { game })).p.turn,
    fin: async () => { for (const c of Object.values(clis)) await c.close(); await app.stop() }
  }
}

// phase d'attente : chacun se dit prêt, le dernier prêt ouvre la phase de jeu et lance le premier tour
const attente = (n: number) => ({
  state: () => ({ prets: [] as string[] }),
  phases: { attente: ['pret'], jeu: ['jouer'] },
  hooks: { onCreate: (g: any) => g.to('attente') },
  moves: { pret: (g: any, pl: any) => { g.state.prets.push(pl.id); if (g.state.prets.length === n) { g.to('jeu'); g.next() } }, jouer: (g: any) => g.next() }
})

// le coup arme une minuterie qui passe la main
const minuterie = { moves: { jouer: (g: any, pl: any) => { g.state.coups.push(pl.id); g.timer('passe', 300) } }, timers: { passe: (g: any) => g.next() } }

// écrite par la 4.0.0 publiée (serveur réel) : alice a joué, la minuterie qui passe la main n'a pas encore tiré
const SAUVEGARDE_400 = JSON.parse('{"id":"game1794721828391","type":"tour","code":null,"state":{"coups":["alice"]},"phase":null,"turn":null,"seq":2,"journal":[{"move":"jouer","player":"alice","at":1794721828410}],"seats":[{"seat":0,"id":"alice","connected":true},{"seat":1,"id":"bob","connected":true}],"timers":[{"name":"passe","at":1794721888410}],"ended":false,"started":true,"unconfirmedSeats":null}')

describe('MJS-Server — premier tour : changement de phase et rechargement', function () {
  this.timeout(20000)

  it('phase d\'attente : bob se dit prêt, puis alice ; la phase de jeu s\'ouvre et alice (siège 0) a la main', async () => {
    const g = await table(['alice', 'bob'], attente(2))
    try {
      assert.equal(await g.coup('bob', 'pret'), 'accepté')
      assert.equal(await g.coup('alice', 'pret'), 'accepté')
      assert.equal(await g.tour(), 'alice')
      assert.equal(await g.coup('bob'), 'refusé')
      assert.equal(await g.coup('alice'), 'accepté')
      assert.equal(await g.tour(), 'bob')
    }
    finally { await g.fin() }
  })

  it('trois joueurs prêts dans le désordre (carl, alice, bob) : la main va au siège 0', async () => {
    const g = await table(['alice', 'bob', 'carl'], attente(3))
    try {
      for (const nom of ['carl', 'alice', 'bob']) assert.equal(await g.coup(nom, 'pret'), 'accepté')
      assert.equal(await g.tour(), 'alice')
    }
    finally { await g.fin() }
  })

  it('une minuterie passe la main après le premier coup : bob l\'a, avec ou sans rechargement avant qu\'elle tire', async () => {
    const t1 = await table(['alice', 'bob'], minuterie)
    let sans = ''
    try {
      await t1.coup('alice')
      await wait(450)
      sans = await t1.tour()
    }
    finally { await t1.fin() }
    const store = new MemoryPersistAdapter()
    const t2    = await table(['alice', 'bob'], minuterie, { persist: { adapter: store, debounce: 20 } })
    await t2.coup('alice')
    await wait(60)
    await t2.fin()
    const p   = port()
    const app = serveur(p, { persist: { adapter: store, debounce: 20 } })
    app.game('tour', { seats: 2, state: () => ({ coups: [] as string[] }), turns: { order: 'roundrobin', timeout: null }, ...minuterie } as any)
    await app.listen()
    const a = await client(p, 'alice')
    const b = await client(p, 'bob')
    try {
      await wait(450)
      assert.equal(sans, 'bob')
      assert.equal((await a.req('µgame:resync', { game: t2.game })).p.turn, 'bob', 'le rechargement ne change pas la main')
      assert.equal((await a.req('µgame:move', { game: t2.game, move: 'jouer' })).e, true, 'alice ne rejoue pas')
    }
    finally {
      await a.close()
      await b.close()
      await app.stop()
    }
  })

  it('une sauvegarde de la 4.0.0 se recharge sans erreur ; sa minuterie tire, la main passe à bob, alice ne rejoue pas', async () => {
    const store = new MemoryPersistAdapter()
    store.save(SAUVEGARDE_400.id, { ...SAUVEGARDE_400, timers: [{ name: 'passe', at: Date.now() + 200 }] } as any)
    const p   = port()
    const app = serveur(p, { persist: { adapter: store, debounce: 20 } })
    app.game('tour', { seats: 2, state: () => ({ coups: [] as string[] }), turns: { order: 'roundrobin', timeout: null }, ...minuterie } as any)
    await app.listen()
    const a = await client(p, 'alice')
    const b = await client(p, 'bob')
    try {
      const avant = await a.req('µgame:resync', { game: SAUVEGARDE_400.id })
      assert.equal(avant.e, undefined, 'la partie sauvegardée par la 4.0.0 est rechargée : ' + JSON.stringify(avant.p))
      assert.equal(avant.p.turn, null)
      await wait(350)
      assert.equal((await a.req('µgame:resync', { game: SAUVEGARDE_400.id })).p.turn, 'bob')
      assert.equal((await a.req('µgame:move', { game: SAUVEGARDE_400.id, move: 'jouer' })).e, true, 'alice ne rejoue pas')
      await b.req('µgame:resync', { game: SAUVEGARDE_400.id })
      const coup = await b.req('µgame:move', { game: SAUVEGARDE_400.id, move: 'jouer' })
      assert.equal(coup.e, undefined, 'bob, revenu à son siège, joue : ' + JSON.stringify(coup.p))
    }
    finally {
      await a.close()
      await b.close()
      await app.stop()
    }
  })

  it('rester dans la même phase ne change rien : `to(\'jeu\')` déjà en `jeu`, puis `next()` — alice ouvre, la main passe à bob', async () => {
    const g = await table(['alice', 'bob'], { phases: { jeu: ['jouer'] }, hooks: { onCreate: (x: any) => x.to('jeu') }, moves: { jouer: (x: any) => { x.to('jeu'); x.next() } } })
    try {
      assert.equal(await g.coup('alice'), 'accepté')
      assert.equal(await g.tour(), 'bob')
      assert.equal(await g.coup('alice'), 'refusé')
    }
    finally { await g.fin() }
  })

  it('une sauvegarde de la 4.0.0 faite juste après `to(\'jeu\')` (bob puis alice prêts, minuterie en attente) : rechargée, la main va à alice, comme sans rechargement', async () => {
    // écrite par la 4.0.0 publiée (serveur réel) : le dernier coup du journal (`pret`) est de la phase d'avant
    const SAUVEGARDE_400_PHASE = JSON.parse('{"id":"game1794723365363","type":"tour","code":null,"state":{"prets":["bob","alice"]},"phase":"jeu","turn":null,"seq":3,"journal":[{"move":"pret","player":"bob","at":1794723365395},{"move":"pret","player":"alice","at":1794723365396}],"seats":[{"seat":0,"id":"alice","connected":true},{"seat":1,"id":"bob","connected":true}],"timers":[{"name":"go","at":1794723425396}],"ended":false,"started":true,"unconfirmedSeats":null}')
    const def = { state: () => ({ prets: [] as string[] }), phases: { attente: ['pret'], jeu: ['jouer'] }, hooks: { onCreate: (x: any) => x.to('attente') }, moves: { pret: (x: any, pl: any) => { x.state.prets.push(pl.id); if (x.state.prets.length === 2) { x.to('jeu'); x.timer('go', 200) } }, jouer: (x: any) => x.next() }, timers: { go: (x: any) => x.next() } }
    const t1  = await table(['alice', 'bob'], def)
    let sans  = ''
    try {
      await t1.coup('bob', 'pret')
      await t1.coup('alice', 'pret')
      await wait(350)
      sans = await t1.tour()
    }
    finally { await t1.fin() }
    const store = new MemoryPersistAdapter()
    store.save(SAUVEGARDE_400_PHASE.id, { ...SAUVEGARDE_400_PHASE, timers: [{ name: 'go', at: Date.now() + 200 }] })
    const p   = port()
    const app = serveur(p, { persist: { adapter: store, debounce: 20 } })
    app.game('tour', { seats: 2, turns: { order: 'roundrobin', timeout: null }, ...def } as any)
    await app.listen()
    const a = await client(p, 'alice')
    try {
      assert.equal((await a.req('µgame:resync', { game: SAUVEGARDE_400_PHASE.id })).e, undefined, 'la sauvegarde de la 4.0.0 est rechargée')
      await wait(350)
      assert.equal(sans, 'alice')
      assert.equal((await a.req('µgame:resync', { game: SAUVEGARDE_400_PHASE.id })).p.turn, 'alice', 'la main est la même qu\'avant le rechargement')
    }
    finally {
      await a.close()
      await app.stop()
    }
  })
})
