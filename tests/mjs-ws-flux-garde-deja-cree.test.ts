// La garde d'un flux (`canSubscribe`, `room`) tient même quand le flux existait déjà : créé par le delta d'un
// autre processus, par POST /stream du pont ou par un premier app.stream() sans garde. Jamais d'instantané à un
// client refusé, sur aucun processus. Un flux public, lui, reste lisible partout comme avant.
import assert from 'node:assert/strict'
import { mjsWs, MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MemoryAdapterBus } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

let n = 0
async function demarrer(bus?: MemoryAdapterBus): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({
    transport, heartbeat: 0, onLog: () => {}, auth: () => ({ id: 'u' + (++n) }),
    ...(bus ? { adapter: new MemoryAdapter({ bus }), antiEntropy: false as const } : {}),
  })
  await app.listen()
  return { transport, app }
}

interface Client { trames: any[]; envoyer: (t: string, p?: unknown) => void; vu: (flux: string) => any[] }

async function client(transport: MemoryTransport): Promise<Client> {
  const ws = transport.connect({ url: 'ws://visiteur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, resub: [], rooms: [] } }))
  await tick()
  return {
    trames,
    envoyer: (t, p) => ws.send(JSON.stringify({ t, p })),
    // ce que le client a reçu du flux, et ses refus
    vu: (flux) => trames.filter(f => f.t === flux || f.t === 'µ:error').map(f => f.t === 'µ:error' ? 'refus' : f.p),
  }
}

async function demander(transport: MemoryTransport, flux: string, salon?: string): Promise<Client> {
  const c = await client(transport)
  if (salon) { c.envoyer('µ:join', { room: salon }); await tick() }
  c.envoyer('µ:sub-stream', { stream: flux })
  await tick(30)
  return c
}

describe('MJS-WS — la garde d\'un flux tient même si le flux existait déjà', () => {
  it('plusieurs processus, canSubscribe : refusé sur A, refusé sur B avant comme après que B déclare le flux', async () => {
    const bus = createMemoryAdapterBus()
    const A = await demarrer(bus), B = await demarrer(bus)
    const garde = (c: any) => c.identity.id === 'joueur-autorise'
    A.app.stream('partie-7', { canSubscribe: garde }).add('main', { cartes: ['As', 'Roi'] })
    await tick(30)

    const surBAvant = await demander(B.transport, 'partie-7')
    assert.deepEqual(surBAvant.vu('partie-7'), ['refus'], 'B n\'a pas encore déclaré le flux : refus, jamais l\'instantané')

    B.app.stream('partie-7', { canSubscribe: garde })
    const surB = await demander(B.transport, 'partie-7')
    assert.deepEqual(surB.vu('partie-7'), ['refus'], 'B a déclaré la même garde : refus')
    const surA = await demander(A.transport, 'partie-7')
    assert.deepEqual(surA.vu('partie-7'), ['refus'], 'témoin : A refuse')
    await A.app.stop(); await B.app.stop()
  })

  it('plusieurs processus, room : sur B, le membre du salon reçoit le flux, le non-membre est refusé', async () => {
    const bus = createMemoryAdapterBus()
    const A = await demarrer(bus), B = await demarrer(bus)
    A.app.stream('partie-8', { room: 'table-8' }).add('main', { cartes: ['Dix'] })
    await tick(30)

    const membre = await demander(B.transport, 'partie-8', 'table-8')
    assert.deepEqual(membre.vu('partie-8'), [{ op: 'reset', values: { main: { cartes: ['Dix'] } } }])
    const intrus = await demander(B.transport, 'partie-8')
    assert.deepEqual(intrus.vu('partie-8'), ['refus'])
    await A.app.stop(); await B.app.stop()
  })

  it('plusieurs processus, flux public : toujours lisible sur B sans déclaration (comme avant)', async () => {
    const bus = createMemoryAdapterBus()
    const A = await demarrer(bus), B = await demarrer(bus)
    A.app.stream('tableau', { public: true }).add('score', 3)
    await tick(30)
    const lecteur = await demander(B.transport, 'tableau')
    assert.deepEqual(lecteur.vu('tableau'), [{ op: 'reset', values: { score: 3 } }])
    await A.app.stop(); await B.app.stop()
  })

  it('un seul processus : la garde déclarée après un premier app.stream() sans garde (ou POST /stream) s\'applique', async () => {
    const { transport, app } = await demarrer()
    app.stream('salle', { public: true }).add('k', 1)
    app.stream('salle', { canSubscribe: () => false })
    const c = await demander(transport, 'salle')
    assert.deepEqual(c.vu('salle'), ['refus'])
    await app.stop()
  })

  it('un seul processus : un abonné déjà inscrit quand la garde arrive repasse la garde, refusé il ne reçoit plus rien', async () => {
    const { transport, app } = await demarrer()
    const salle = app.stream('salle-2', { public: true })
    salle.add('k', 1)
    const c = await demander(transport, 'salle-2')
    assert.deepEqual(c.vu('salle-2'), [{ op: 'reset', values: { k: 1 } }])

    app.stream('salle-2', { canSubscribe: () => false })
    await tick()
    salle.add('secret', 2)
    await tick()
    assert.deepEqual(c.vu('salle-2'), [{ op: 'reset', values: { k: 1 } }, 'refus'], 'refus annoncé, puis plus aucun delta')
    await app.stop()
  })
})
