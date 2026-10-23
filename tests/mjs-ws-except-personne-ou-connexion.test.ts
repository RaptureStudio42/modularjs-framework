// `except` d'un envoi à plusieurs — pont universel (`POST /broadcast`, `POST /room/send`) et d'un processus à l'autre :
// une chaîne désigne une personne (l'id de son compte, ou `anon:` suivi de l'id de connexion d'un visiteur sans
// compte), `{ client }` une seule connexion, comme pour `POST /room/kick`. Avant, une chaîne excluait à la fois la
// connexion qui portait cet id et le compte du même nom (un compte peut porter l'id d'une connexion : une appli où l'on
// choisit son pseudo), et l'id d'une connexion exclue par l'application partait aux autres processus, qui en
// excluaient le compte du même nom
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'

const SECRET = 'secret-de-test-pont-except-personne-1234567890'
const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function processus(bus: ReturnType<typeof createMemoryAdapterBus> | null, pont: boolean) {
  const transport = new MemoryTransport()
  let port        = 0
  const app       = mjsWs({
    transport, heartbeat: 0, auth: (hello: any) => hello.auth, welcome: (client) => ({ moi: client.id }),
    ...(bus ? { adapter: new MemoryAdapter({ bus }) } : {}),
    ...(pont ? { bridge: { port: 0, secret: SECRET } } : {}),
    onLog: (_niveau, message, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute|universal bridge listening/.test(message)) port = meta.port },
  })
  // la connexion qui envoie `declenche` est exclue d'un envoi de l'application (l'objet client)
  app.on('declenche', (p: any, client) => {
    if (p?.salon) app.room('salle').send('chat', {}, { except: client })
    else app.broadcast('chat', {}, { except: client })
  })
  await app.listen()
  return { transport, app, port: () => port }
}

// un onglet : `auth` sans `id` = visiteur sans compte ; `id` = son id de connexion, lu dans le welcome
async function onglet(transport: MemoryTransport, auth: unknown, salon: boolean) {
  const ws            = transport.connect({ url: 'memory://except' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth } }))
  await tick(10)
  if (salon) { ws.send(JSON.stringify({ t: 'µ:join', p: { room: 'salle' } })); await tick(10) }
  const id = trames.find(f => f.t === 'µ:welcome')?.p?.moi as string
  assert.ok(typeof id === 'string' && id.length > 0, 'id de connexion lu dans le welcome')
  return { ws, trames, id, recu: () => trames.some(f => f.t === 'chat'), oublie: () => { trames.length = 0 } }
}

async function poster(port: number, chemin: string, corps: unknown): Promise<number> {
  const texte = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')
  const sig   = createHmac('sha256', SECRET).update(['in', String(ts), 'POST', chemin, texte, nonce].map(f => f.length +':'+ f).join('')).digest('hex')
  const res   = await fetch('http://127.0.0.1:'+ port + chemin, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': sig }, body: texte })
  await res.text()
  return res.status
}

describe('MJS-WS — except : une chaîne désigne une personne, { client } une seule connexion', function () {
  this.timeout(20000)

  for (const voie of ['/broadcast', '/room/send'] as const) {
    const salon = voie === '/room/send'
    const corps = (except: unknown) => salon ? { room: 'salle', type: 'chat', p: {}, except } : { type: 'chat', p: {}, except }

    it(`${voie} : une chaîne exclut le compte de ce nom, jamais la connexion qui porte cet id`, async () => {
      const a = await processus(null, true)
      try {
        const visiteur = await onglet(a.transport, { pseudo: 'visiteur' }, salon)
        const homonyme = await onglet(a.transport, { id: visiteur.id }, salon)   // pseudo choisi : l'id de connexion du visiteur
        const autre    = await onglet(a.transport, { id: 'V' }, salon)
        assert.equal(await poster(a.port(), voie, corps(visiteur.id)), 200)
        await tick(30)
        assert.equal(homonyme.recu(), false, 'le compte de ce nom est exclu')
        assert.equal(visiteur.recu(), true, 'la connexion qui porte cet id reçoit')
        assert.equal(autre.recu(), true, 'un autre compte reçoit')
      }
      finally { await a.app.stop() }
    })

    it(`${voie} : { client } exclut cette seule connexion, jamais le compte du même nom`, async () => {
      const a = await processus(null, true)
      try {
        const visiteur = await onglet(a.transport, { pseudo: 'visiteur' }, salon)
        const homonyme = await onglet(a.transport, { id: visiteur.id }, salon)
        const autre    = await onglet(a.transport, { id: 'V' }, salon)
        assert.equal(await poster(a.port(), voie, corps({ client: visiteur.id })), 200)
        await tick(30)
        assert.equal(visiteur.recu(), false, 'la connexion désignée est exclue')
        assert.equal(homonyme.recu(), true, 'le compte qui porte son id reçoit')
        assert.equal(autre.recu(), true, 'un autre compte reçoit')
      }
      finally { await a.app.stop() }
    })

    it(`${voie} : un tableau mêle personnes et connexions — « anon: » suivi de l'id de connexion désigne le visiteur sans compte`, async () => {
      const a = await processus(null, true)
      try {
        const visiteur = await onglet(a.transport, { pseudo: 'visiteur' }, salon)
        const homonyme = await onglet(a.transport, { id: visiteur.id }, salon)
        const v1       = await onglet(a.transport, { id: 'V' }, salon)
        const v2       = await onglet(a.transport, { id: 'V' }, salon)
        const temoin   = await onglet(a.transport, { id: 'W' }, salon)
        assert.equal(await poster(a.port(), voie, corps(['anon:' + visiteur.id, { client: v1.id }])), 200)
        await tick(30)
        assert.equal(visiteur.recu(), false, 'le visiteur sans compte désigné par anon:')
        assert.equal(v1.recu(), false, 'la connexion désignée')
        assert.equal(v2.recu(), true, 'l\'autre onglet du même compte reçoit')
        assert.equal(homonyme.recu(), true, 'le compte qui porte l\'id de connexion du visiteur reçoit')
        assert.equal(temoin.recu(), true)
      }
      finally { await a.app.stop() }
    })

    it(`${voie} : un except mal formé est refusé (400), rien ne part`, async () => {
      const a = await processus(null, true)
      try {
        const temoin = await onglet(a.transport, { id: 'W' }, salon)
        for (const except of [{ user: 'V' }, { client: 'c1', user: 'V' }, { client: 7 }, [{}], 5, [null], [{ client: 'c1' }, 3]]) {
          assert.equal(await poster(a.port(), voie, corps(except)), 400, JSON.stringify(except))
        }
        await tick(30)
        assert.equal(temoin.recu(), false)
      }
      finally { await a.app.stop() }
    })

    it(`${voie} d'un processus à l'autre : { client } exclut la connexion servie ailleurs, une chaîne le compte de ce nom`, async () => {
      const bus = createMemoryAdapterBus()
      const a   = await processus(bus, true)
      const b   = await processus(bus, false)
      try {
        const visiteur = await onglet(b.transport, { pseudo: 'visiteur' }, salon)
        const homonyme = await onglet(b.transport, { id: visiteur.id }, salon)
        await tick(30)
        assert.equal(await poster(a.port(), voie, corps({ client: visiteur.id })), 200)
        await tick(50)
        assert.equal(visiteur.recu(), false, 'la connexion désignée, servie par l\'autre processus, est exclue')
        assert.equal(homonyme.recu(), true, 'le compte du même nom reçoit')
        visiteur.oublie()
        homonyme.oublie()
        assert.equal(await poster(a.port(), voie, corps(visiteur.id)), 200)
        await tick(50)
        assert.equal(homonyme.recu(), false, 'la chaîne désigne le compte de ce nom')
        assert.equal(visiteur.recu(), true, 'jamais la connexion qui porte cet id')
      }
      finally {
        await a.app.stop()
        await b.app.stop()
      }
    })
  }

  for (const voie of ['broadcast', 'room().send'] as const) {
    it(`app.${voie} { except: client } d'un processus à l'autre : seule cette connexion est exclue, jamais un compte qui porte son id`, async () => {
      const salon = voie !== 'broadcast'
      const bus   = createMemoryAdapterBus()
      const a     = await processus(bus, false)
      const b     = await processus(bus, false)
      try {
        const emetteur = await onglet(a.transport, { pseudo: 'emetteur' }, salon)
        const homonyme = await onglet(b.transport, { id: emetteur.id }, salon)
        const autre    = await onglet(b.transport, { id: 'V' }, salon)
        await tick(30)
        emetteur.ws.send(JSON.stringify({ t: 'declenche', p: { salon } }))
        await tick(50)
        assert.equal(emetteur.recu(), false, 'la connexion exclue')
        assert.equal(homonyme.recu(), true, 'le compte qui porte son id, servi par l\'autre processus, reçoit')
        assert.equal(autre.recu(), true)
      }
      finally {
        await a.app.stop()
        await b.app.stop()
      }
    })
  }
})
