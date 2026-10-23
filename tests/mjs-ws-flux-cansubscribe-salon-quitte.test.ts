// La garde `canSubscribe` d'un flux est repassée quand la connexion quitte un salon : la forme
// `canSubscribe: (client) => app.room('partie-42').has(client)` protège désormais comme l'option `room`. Avant, elle
// n'était lue qu'à l'abonnement : un joueur expulsé de la table recevait encore tous les deltas de la partie.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsStreamOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Joueur { trames: any[]; envoyer: (t: string, p?: unknown) => void; flux: (nom: string) => any[] }

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  await app.listen()
  return { transport, app }
}

async function joueur(transport: MemoryTransport, salon: string, nom: string): Promise<Joueur> {
  const ws = transport.connect({ url: 'ws://joueur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p?: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1, resub: [], rooms: [] })
  await tick()
  envoyer('µ:join', { room: salon })
  await tick()
  envoyer('µ:sub-stream', { stream: nom })
  await tick(20)
  return { trames, envoyer, flux: (f) => trames.filter(t => t.t === f).map(t => t.p) }
}

describe('MJS-WS — garde canSubscribe repassée au départ d\'un salon', function () {
  this.timeout(10000)

  for (const forme of ['room', 'canSubscribe'] as const) {
    it(`forme ${forme} : expulsé du salon, plus aucun delta`, async () => {
      const { transport, app } = await demarrer()
      const garde: MjsWsStreamOptions = forme === 'room' ? { room: 'partie-42' } : { canSubscribe: (client) => app.room('partie-42').has(client) }
      const partie = app.stream('partie-42', garde)
      const j = await joueur(transport, 'partie-42', 'partie-42')
      assert.equal(j.flux('partie-42').length, 1, 'abonné : instantané reçu')
      app.room('partie-42').kick(Array.from(app.room('partie-42').clients)[0], 'triche')
      await tick()

      partie.add('main-secrete', { cartes: ['As', 'Roi'] })
      await tick()
      assert.deepEqual(j.flux('partie-42').slice(1), [], 'aucun delta après l\'expulsion')
      await app.stop()
    })
  }

  it('revenu dans le salon : la garde accepte de nouveau, il retrouve le flux (état complet puis deltas)', async () => {
    const { transport, app } = await demarrer()
    const partie = app.stream('partie-43', { canSubscribe: (client) => app.room('table-43').has(client) })
    const j = await joueur(transport, 'table-43', 'partie-43')
    j.envoyer('µ:leave', { room: 'table-43' })
    await tick()
    partie.add('pendant', 1)
    await tick()
    j.envoyer('µ:join', { room: 'table-43' })
    await tick(20)
    partie.add('apres', 2)
    await tick()
    assert.deepEqual(j.flux('partie-43').slice(1), [{ op: 'reset', values: { pendant: 1 } }, { op: 'add', key: 'apres', value: 2 }])
    await app.stop()
  })

  it('une garde que le départ ne change pas : le flux continue sans interruption ni nouvel instantané', async () => {
    const { transport, app } = await demarrer()
    const annonces = app.stream('annonces', { canSubscribe: () => true })
    const j = await joueur(transport, 'salle-a', 'annonces')
    j.envoyer('µ:leave', { room: 'salle-a' })
    await tick()
    annonces.add('a1', 'bienvenue')
    await tick()
    assert.deepEqual(j.flux('annonces').slice(1), [{ op: 'add', key: 'a1', value: 'bienvenue' }])
    await app.stop()
  })
})
