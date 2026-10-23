// MJS-WS — un visiteur sans compte est `anon:` suivi de son id de connexion, partout où le serveur désigne une
// personne (présence, sendUser, kick, pont, discussion) ; un compte garde son `identity.id`. Avant, l'anonyme
// portait son id de connexion nu (`c5`) : un compte nommé `c5` (appli où l'on choisit son pseudo) et cet anonyme
// étaient la même personne pour sendUser, kick, les invitations du hall. Un compte dont l'id commence par
// `anon:` est refusé à la connexion : les deux espaces de noms ne se croisent jamais.
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs, MemoryTransport, chatPackage } from '../src/mjs-ws/index.js'
import { peerIdOf } from '../src/mjs-ws/rooms.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MjsWsApp, MjsWsClient, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-de-test-anonyme-a-part-1234567890'

const lp = (champ: string) => champ.length +':'+ champ

async function pont(port: number, chemin: string, corps: unknown): Promise<{ status: number, json: any }> {
  const texte = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const sig   = createHmac('sha256', SECRET).update(['in', String(ts), 'POST', chemin, texte, nonce].map(lp).join('')).digest('hex')
  const res   = await fetch('http://127.0.0.1:'+ port + chemin, { method: 'POST', headers: { 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': sig, 'content-type': 'application/json' }, body: texte })
  return { status: res.status, json: await res.json() }
}

async function monter(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport, app: MjsWsApp, port: number, journal: string[] }> {
  const transport       = new MemoryTransport()
  const journal: string[] = []
  let port              = 0
  const app             = mjsWs({
    transport, heartbeat: 0,
    auth:   (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {}),
    rooms:  { join: () => true, canSeePresence: () => true },
    bridge: { port: 0, secret: SECRET },
    onLog:  (niveau, message, meta: any) => {
      journal.push(niveau +' '+ message)
      if (meta && typeof meta.port === 'number' && /pont universel en écoute/.test(message)) port = meta.port
    },
    ...opts,
  })
  await app.listen()
  return { transport, app, port, journal }
}

interface Connexion { trames: any[]; envoyer(t: string, p?: unknown, id?: number): void }

async function connecter(transport: MemoryTransport, uid?: string): Promise<Connexion> {
  const ws            = transport.connect({ url: 'memory://anonyme-a-part' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => { trames.push(JSON.parse(ev.data)) }
  await new Promise<void>(r => { ws.onopen = () => r() })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: uid ? { uid } : undefined } }))
  await tick(5)
  return { trames, envoyer: (t, p = {}, id) => ws.send(JSON.stringify(id === undefined ? { t, p } : { t, p, id })) }
}

const recus  = (c: Connexion, t: string) => c.trames.filter(f => f.t === t)
const anonyme = (app: MjsWsApp): MjsWsClient => Array.from(app.clients).find(c => !(c.identity as any)?.id)!

// un anonyme, puis un compte dont l'id vaut EXACTEMENT l'id de connexion de cet anonyme
async function paire(transport: MemoryTransport, app: MjsWsApp): Promise<{ anon: Connexion, compte: Connexion, idConnexion: string }> {
  const anon        = await connecter(transport)
  const idConnexion = anonyme(app).id
  const compte      = await connecter(transport, idConnexion)
  assert.ok(Array.from(app.clients).some(c => (c.identity as any)?.id === idConnexion), 'le compte homonyme est bien connecté')
  return { anon, compte, idConnexion }
}

describe('MJS-WS — un visiteur sans compte n’est jamais confondu avec un compte', () => {
  it('peerIdOf : `anon:` suivi de l’id de connexion pour un anonyme, l’id du compte tel quel sinon', () => {
    assert.equal(peerIdOf({ id: 'c5', identity: undefined } as any), 'anon:c5')
    assert.equal(peerIdOf({ id: 'c6', identity: {} } as any), 'anon:c6')
    assert.equal(peerIdOf({ id: 'c7', identity: { id: 'c5' } } as any), 'c5')
    assert.equal(peerIdOf({ id: 'c8', identity: { id: 42 } } as any), '42')
  })

  it('présence : l’anonyme apparaît en `anon:…`, le compte homonyme sous son id, deux personnes distinctes', async () => {
    const { transport, app } = await monter()
    try {
      const { anon, compte, idConnexion } = await paire(transport, app)
      anon.envoyer('µ:join', { room: 'zone' })
      compte.envoyer('µ:join', { room: 'zone' })
      await tick(5)
      anon.envoyer('µ:sub-presence', { room: 'zone' })
      await tick(5)
      const reset = recus(anon, 'µ:presence').find(f => f.p.op === 'reset')
      assert.ok(reset, 'instantané de présence reçu')
      assert.deepEqual(Object.keys(reset.p.peers).sort(), ['anon:'+ idConnexion, idConnexion].sort(), 'deux personnes')
    } finally {
      await app.stop()
    }
  })

  it('sendUser : `anon:<id>` vise l’anonyme seul, l’id nu vise le compte seul', async () => {
    const { transport, app } = await monter()
    try {
      const { anon, compte, idConnexion } = await paire(transport, app)
      app.sendUser('anon:'+ idConnexion, 'note', { n: 1 })
      await tick(5)
      assert.equal(recus(anon, 'note').length, 1, 'l’anonyme reçoit par anon:')
      assert.equal(recus(compte, 'note').length, 0, 'le compte homonyme ne reçoit rien')
      app.sendUser(idConnexion, 'note', { n: 2 })
      await tick(5)
      assert.equal(recus(compte, 'note').length, 1, 'le compte reçoit par son id')
      assert.equal(recus(anon, 'note').length, 1, 'l’anonyme ne reçoit pas ce qui part au compte')
    } finally {
      await app.stop()
    }
  })

  it('kick par chaîne : l’id nu expulse le compte seul, `anon:<id>` l’anonyme seul', async () => {
    const { transport, app } = await monter()
    try {
      const { anon, compte, idConnexion } = await paire(transport, app)
      anon.envoyer('µ:join', { room: 'zone' })
      compte.envoyer('µ:join', { room: 'zone' })
      await tick(5)
      app.room('zone').kick(idConnexion, 'compte')
      await tick(5)
      assert.equal(recus(compte, 'µ:left').length, 1, 'le compte est expulsé')
      assert.equal(recus(anon, 'µ:left').length, 0, 'l’anonyme reste')
      app.room('zone').kick('anon:'+ idConnexion, 'anonyme')
      await tick(5)
      assert.equal(recus(anon, 'µ:left').length, 1, 'l’anonyme est expulsé par anon:')
      assert.equal(app.room('zone').size, 0)
    } finally {
      await app.stop()
    }
  })

  it('pont : /send {user} et /room/kick {user} suivent la même règle, {client} vise la seule connexion', async () => {
    const { transport, app, port } = await monter()
    try {
      const { anon, compte, idConnexion } = await paire(transport, app)
      const r1 = await pont(port, '/send', { user: idConnexion, type: 'note', p: { n: 1 } })
      const r2 = await pont(port, '/send', { user: 'anon:'+ idConnexion, type: 'note', p: { n: 2 } })
      assert.equal(r1.status, 200)
      assert.equal(r2.status, 200)
      await tick(5)
      assert.deepEqual(recus(compte, 'note').map(f => f.p.n), [1], 'le compte : son envoi seulement')
      assert.deepEqual(recus(anon, 'note').map(f => f.p.n), [2], 'l’anonyme : son envoi seulement')

      anon.envoyer('µ:join', { room: 'zone' })
      compte.envoyer('µ:join', { room: 'zone' })
      await tick(5)
      const k1 = await pont(port, '/room/kick', { room: 'zone', user: idConnexion })
      assert.equal(k1.json.kicked, 1, 'une connexion expulsée')
      await tick(5)
      assert.equal(recus(compte, 'µ:left').length, 1, 'le compte est expulsé')
      assert.equal(recus(anon, 'µ:left').length, 0, 'l’anonyme reste')
      const k2 = await pont(port, '/room/kick', { room: 'zone', client: idConnexion })
      assert.equal(k2.json.kicked, 1, '{client} : la connexion de cet id')
      await tick(5)
      assert.equal(recus(anon, 'µ:left').length, 1, 'l’anonyme est expulsé par son id de connexion')
    } finally {
      await app.stop()
    }
  })

  it('discussion : l’anonyme se voit en `anon:…` (chat:me), le compte sous son id', async () => {
    const { transport, app } = await monter()
    app.use(chatPackage({}))
    try {
      const { anon, compte, idConnexion } = await paire(transport, app)
      anon.envoyer('chat:me', {}, 1)
      compte.envoyer('chat:me', {}, 2)
      await tick(5)
      assert.equal(recus(anon, 'µ:ack').find(f => f.id === 1)?.p.id, 'anon:'+ idConnexion)
      assert.equal(recus(compte, 'µ:ack').find(f => f.id === 2)?.p.id, idConnexion)
    } finally {
      await app.stop()
    }
  })

  it('un compte dont l’id commence par `anon:` est refusé à la connexion, avec un message clair', async () => {
    const { transport, app, journal } = await monter()
    try {
      const imposteur = await connecter(transport, 'anon:c1')
      await tick(5)
      const refus = recus(imposteur, 'µ:denied')
      assert.equal(refus.length, 1, 'connexion refusée')
      assert.match(refus[0].p.message, /anon:/)
      assert.equal(Array.from(app.clients).some(c => (c.identity as any)?.id === 'anon:c1'), false, 'jamais accueilli')
      assert.ok(journal.some(l => l.startsWith('warn') && /anon:/.test(l)), 'le serveur l’écrit au journal')
    } finally {
      await app.stop()
    }
  })
})

describe('MJS-WS — anonyme et compte homonyme, sur plusieurs processus', () => {
  it('sendUser(`anon:<id>`) posé sur A atteint l’anonyme servi par B, jamais le compte homonyme', async () => {
    const bus = createMemoryAdapterBus()
    const a   = await monter({ adapter: new MemoryAdapter({ bus }) })
    const b   = await monter({ adapter: new MemoryAdapter({ bus }) })
    try {
      const { anon, compte, idConnexion } = await paire(b.transport, b.app)
      a.app.sendUser('anon:'+ idConnexion, 'note', { n: 1 })
      await tick(10)
      assert.equal(recus(anon, 'note').length, 1, 'l’anonyme de B reçoit')
      assert.equal(recus(compte, 'note').length, 0, 'le compte homonyme ne reçoit rien')
    } finally {
      await a.app.stop()
      await b.app.stop()
    }
  })

  it('kick d’une connexion passée en objet : rien ne part ailleurs, le compte homonyme servi par B reste', async () => {
    const bus = createMemoryAdapterBus()
    const a   = await monter({ adapter: new MemoryAdapter({ bus }) })
    const b   = await monter({ adapter: new MemoryAdapter({ bus }) })
    try {
      const anon        = await connecter(a.transport)
      const cible       = anonyme(a.app)
      const compte      = await connecter(b.transport, cible.id)
      anon.envoyer('µ:join', { room: 'zone' })
      compte.envoyer('µ:join', { room: 'zone' })
      await tick(10)
      a.app.room('zone').kick(cible, 'objet')
      await tick(10)
      assert.equal(recus(anon, 'µ:left').length, 1, 'la connexion visée est expulsée')
      assert.equal(recus(compte, 'µ:left').length, 0, 'le compte de B qui porte son id reste dans le salon')
    } finally {
      await a.app.stop()
      await b.app.stop()
    }
  })

  it('pont de A : /room/kick {client} expulse la connexion servie par B, {user: anon:…} aussi', async () => {
    const bus = createMemoryAdapterBus()
    const a   = await monter({ adapter: new MemoryAdapter({ bus }) })
    const b   = await monter({ adapter: new MemoryAdapter({ bus }) })
    try {
      const { anon, compte, idConnexion } = await paire(b.transport, b.app)
      anon.envoyer('µ:join', { room: 'zone' })
      compte.envoyer('µ:join', { room: 'zone' })
      await tick(10)
      const r1 = await pont(a.port, '/room/kick', { room: 'zone', client: idConnexion })
      assert.equal(r1.status, 200)
      await tick(10)
      assert.equal(recus(anon, 'µ:left').length, 1, 'la connexion de B est expulsée')
      assert.equal(recus(compte, 'µ:left').length, 0, 'le compte homonyme reste')
      anon.envoyer('µ:join', { room: 'zone' })
      await tick(10)
      await pont(a.port, '/room/kick', { room: 'zone', user: 'anon:'+ idConnexion })
      await tick(10)
      assert.equal(recus(anon, 'µ:left').length, 2, 'l’anonyme, par son id de personne')
      assert.equal(recus(compte, 'µ:left').length, 0, 'le compte homonyme reste encore')
    } finally {
      await a.app.stop()
      await b.app.stop()
    }
  })
})
