// Débit partagé — le seau à jetons (limits.rate/burst) était PROPRE à chaque connexion : un compte
// ouvert dans 10 onglets avait 10 fois le débit. `limits.rateBy` choisit qui partage un même seau :
// 'connection' (défaut, comportement historique), 'account' (toutes les connexions d'un compte ;
// sans compte, celles de son IP ; avant son hello, son seau propre), 'ip' (toutes les connexions d'une IP), 'both' (le seau du compte
// ET celui de l'IP, les deux doivent avoir un jeton). Sans compte ni IP connue : le seau de la
// connexion. Les seaux partagés disparaissent avec la dernière connexion qui s'en sert.
//
// MemoryTransport (aucune IP) pour les comptes ; socket RÉEL en boucle locale pour l'IP.
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { mjsWs, DEFAULT_LIMITS } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function randomPort(): number { return 64000 + Math.floor(Math.random() * 1400) }

// réserve de 3 jetons, recharge négligeable le temps d'un test ; jamais d'expulsion ni de banc ici
const LIMITES = { rate: 0.001, burst: 3, kickAfter: 1000 }

const auth = (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {})

async function startApp(limits: Record<string, unknown>, opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp; recus: () => number }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, limits: { ...LIMITES, ...limits } as any, auth, ban: false, onLog: () => {}, ...opts })
  let n = 0
  app.on('x', () => { n++ })
  await app.listen()
  return { transport, app, recus: () => n }
}

async function connecte(transport: MemoryTransport, uid?: string): Promise<{ ws: any; frames: any[] }> {
  const ws = transport.connect({ url: 'memory://debit' })
  const frames: any[] = []
  ws.onmessage = (ev: any) => frames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, ...(uid ? { auth: { uid } } : {}) } }))
  await tick()
  assert.ok(frames.some(f => f.t === 'µ:welcome'), 'hello accueilli')
  return { ws, frames }
}

async function envoie(c: { ws: any }, n: number): Promise<void> {
  for (let i = 0; i < n; i++) c.ws.send(JSON.stringify({ t: 'x' }))
  await tick()
}

const aEteFreine = (c: { frames: any[] }) => c.frames.some(f => f.t === 'µ:error' && /débit|rate/i.test(String(f.p?.message)))

// ============================================================================================

describe('MJS-WS — débit partagé (limits.rateBy)', () => {
  it('défaut : chaque connexion garde son propre seau (comportement historique)', async () => {
    assert.equal(DEFAULT_LIMITS.rateBy, 'connection')
    const { transport, app, recus } = await startApp({})
    try {
      const a = await connecte(transport, 'u1')
      const b = await connecte(transport, 'u1')
      await envoie(a, 2)
      await envoie(b, 2)
      assert.equal(recus(), 4)
      assert.ok(!aEteFreine(a) && !aEteFreine(b))
    } finally {
      await app.stop()
    }
  })

  it('\'account\' : les onglets d’un même compte partagent un seul seau', async () => {
    const { transport, app, recus } = await startApp({ rateBy: 'account' })
    try {
      const a = await connecte(transport, 'u1')
      const b = await connecte(transport, 'u1')
      await envoie(a, 2)
      await envoie(b, 2)
      assert.equal(recus(), 3, 'le seau du compte (3 jetons) est commun aux deux onglets')
      assert.ok(aEteFreine(b), 'le 2e onglet est freiné')
    } finally {
      await app.stop()
    }
  })

  it('\'account\' : deux comptes différents ne se gênent pas', async () => {
    const { transport, app, recus } = await startApp({ rateBy: 'account' })
    try {
      const a = await connecte(transport, 'u1')
      const b = await connecte(transport, 'u2')
      await envoie(a, 3)
      await envoie(b, 3)
      assert.equal(recus(), 6)
    } finally {
      await app.stop()
    }
  })

  it('\'account\' sans compte ni IP connue : repli sur le seau de la connexion', async () => {
    const { transport, app, recus } = await startApp({ rateBy: 'account' })
    try {
      const a = await connecte(transport)
      const b = await connecte(transport)
      await envoie(a, 2)
      await envoie(b, 2)
      assert.equal(recus(), 4)
    } finally {
      await app.stop()
    }
  })

  it('valeur fausse = erreur claire au démarrage', () => {
    assert.throws(() => mjsWs({ transport: new MemoryTransport(), limits: { rateBy: 'compte' as any } }), /rateBy/)
  })

  it('reprise de session : l’onglet repris retrouve le seau de son compte, entamé', async () => {
    const { transport, app, recus } = await startApp({ rateBy: 'account' }, { resume: true })
    try {
      const a = await connecte(transport, 'u1')
      const session = a.frames.find(f => f.t === 'µ:welcome')?.p?.session
      assert.ok(session)
      await envoie(a, 2)                                         // seau du compte : 3 → 1
      a.ws.close(); await tick(10)                               // coupure : la session est parquée
      const ws = transport.connect({ url: 'memory://debit' })
      const frames: any[] = []
      ws.onmessage = (ev: any) => frames.push(JSON.parse(ev.data))
      await tick()
      ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { uid: 'u1' }, session } }))
      await tick(10)
      assert.equal(frames.find(f => f.t === 'µ:welcome')?.p?.resumed, true, 'session reprise')
      await envoie({ ws }, 2)                                    // 1 → 0, puis refus
      assert.equal(recus(), 3)
      assert.ok(aEteFreine({ frames }))
    } finally {
      await app.stop()
    }
  })

  it('mémoire bornée : un seau partagé disparaît avec la dernière connexion qui s’en sert', async () => {
    const { transport, app } = await startApp({ rateBy: 'account' })
    try {
      const a = await connecte(transport, 'u1')
      const b = await connecte(transport, 'u1')
      await envoie(a, 1)
      assert.equal((app as any)._seauxPartages(), 1)
      a.ws.close(); await tick(10)
      assert.equal((app as any)._seauxPartages(), 1, 'encore un onglet du compte')
      b.ws.close(); await tick(10)
      assert.equal((app as any)._seauxPartages(), 0)
    } finally {
      await app.stop()
    }
  })
})

describe('MJS-WS — débit partagé par IP (socket réel, 127.0.0.1)', function () {
  this.timeout(10000)

  async function reelle(port: number, uid?: string): Promise<{ ws: WebSocket; frames: any[] }> {
    const ws     = new WebSocket(`ws://127.0.0.1:${port}/`)
    const frames: any[] = []
    ws.on('message', (d: Buffer) => frames.push(JSON.parse(String(d))))
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
    ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, ...(uid ? { auth: { uid } } : {}) } }))
    await tick(50)
    return { ws, frames }
  }

  async function envoieReel(c: { ws: WebSocket }, n: number): Promise<void> {
    for (let i = 0; i < n; i++) c.ws.send(JSON.stringify({ t: 'x' }))
    await tick(50)
  }

  async function demarre(limits: Record<string, unknown>): Promise<{ app: MjsWsApp; port: number; recus: () => number }> {
    const port = randomPort()
    const app  = mjsWs({ transport: 'ws', port, host: '127.0.0.1', limits: { ...LIMITES, burst: 4, ...limits } as any, auth, ban: false, onLog: () => {} })
    let n = 0
    app.on('x', () => { n++ })
    await app.listen()
    return { app, port, recus: () => n }
  }

  it('\'ip\' : toutes les connexions d’une IP partagent un seau (hello compris)', async () => {
    const { app, port, recus } = await demarre({ rateBy: 'ip' })
    try {
      const a = await reelle(port)            // 1 jeton
      await envoieReel(a, 1)                  // 2
      const b = await reelle(port)            // 3
      await envoieReel(b, 2)                  // 4, puis refus
      assert.equal(recus(), 2)
      assert.ok(aEteFreine(b))
      a.ws.close(); b.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('\'account\' : des comptes différents derrière la même IP ne se gênent jamais, hello compris', async () => {
    const { app, port, recus } = await demarre({ rateBy: 'account', burst: 2 })
    try {
      const a = await reelle(port, 'u1')
      const b = await reelle(port, 'u2')
      const c = await reelle(port, 'u3')
      for (const x of [a, b, c]) assert.ok(x.frames.some(f => f.t === 'µ:welcome'), 'chaque hello est accueilli, aucun seau d’IP commun')
      await envoieReel(a, 1); await envoieReel(b, 1); await envoieReel(c, 1)
      assert.equal(recus(), 3)
      a.ws.close(); b.ws.close(); c.ws.close()
    } finally {
      await app.stop()
    }
  })

  it('\'both\' : deux comptes derrière la même IP partagent aussi le seau de l’IP', async () => {
    const { app, port, recus } = await demarre({ rateBy: 'both' })
    try {
      const a = await reelle(port, 'u1')      // IP : 1
      await envoieReel(a, 1)                  // compte u1 : 1, IP : 2
      const b = await reelle(port, 'u2')      // IP : 3
      await envoieReel(b, 2)                  // compte u2 : 1, IP : 4, puis refus par l'IP
      assert.equal(recus(), 2)
      assert.ok(aEteFreine(b))
      a.ws.close(); b.ws.close()
    } finally {
      await app.stop()
    }
  })
})
