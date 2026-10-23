// Une déconnexion ne parcourt que les salons suivis et les flux suivis par CETTE connexion (index connexion →
// salons, connexion → flux), jamais tous ceux du serveur. Avant, chaque déconnexion balayait les 20 000 salons
// suivis en présence et les 20 000 flux : une coupure de masse figeait la boucle d'événements.
// Mesure par rapport : le même nombre de déconnexions, avec 40 fois plus de salons / flux tenus par d'AUTRES
// connexions, ne doit pas coûter beaucoup plus cher.
import assert from 'node:assert/strict'
import { createRoomsEngine } from '../src/mjs-ws/rooms.js'
import { createStreamsEngine } from '../src/mjs-ws/streams.js'
import type { MjsWsClient } from '../src/mjs-ws/core.js'

const N = 1000
const fauxClient = (i: number): MjsWsClient => ({ id: 'c' + i, identity: { id: 'u' + i } } as unknown as MjsWsClient)

async function dureePresence(total: number): Promise<number> {
  const rooms = createRoomsEngine({ maxRoomsPerClient: null, maxPresencePerClient: null }, () => {}, () => {})
  const clients: MjsWsClient[] = []
  for (let i = 0; i < total; i++) { const c = fauxClient(i); clients.push(c); rooms.onWelcome(c); rooms.room('salon-' + i, { presence: 'public' }); await rooms.handleSubPresence(c, 'salon-' + i) }
  const t0 = performance.now()
  for (let i = 0; i < N; i++) rooms.onDisconnect(clients[i])
  const duree = performance.now() - t0
  assert.equal(rooms.statsSnapshot().abonnesPresence, total - N, 'les abonnés partis sont bien retirés, les autres restent')
  return duree
}

function dureeFlux(total: number): number {
  const streams = createStreamsEngine(() => {}, () => {})
  const clients: MjsWsClient[] = []
  for (let i = 0; i < total; i++) { const c = fauxClient(i); clients.push(c); streams.stream('flux-' + i, { public: true }); streams.handleSubStream(c, 'flux-' + i) }
  const t0 = performance.now()
  for (let i = 0; i < N; i++) streams.onDisconnect(clients[i])
  return performance.now() - t0
}

describe('MJS-WS — une déconnexion ne parcourt que ce que la connexion suivait', () => {
  it('présence de salon : 40 fois plus de salons suivis ailleurs ne ralentit pas les déconnexions', async () => {
    const petit = await dureePresence(N)
    const grand = await dureePresence(40 * N)
    assert.ok(grand < 10 * petit + 50, `${N} déconnexions : ${grand.toFixed(1)} ms avec ${40 * N} salons suivis, ${petit.toFixed(1)} ms avec ${N}`)
  })

  it('flux : 40 fois plus de flux sur le serveur ne ralentit pas les déconnexions', () => {
    const petit = dureeFlux(N)
    const grand = dureeFlux(40 * N)
    assert.ok(grand < 10 * petit + 50, `${N} déconnexions : ${grand.toFixed(1)} ms avec ${40 * N} flux, ${petit.toFixed(1)} ms avec ${N}`)
  })

  it('flux : la connexion partie ne reçoit plus rien, les autres abonnés si', () => {
    const recus: string[] = []
    const streams = createStreamsEngine((c) => { recus.push(c.id) }, () => {})
    const a = fauxClient(1), b = fauxClient(2)
    const flux = streams.stream('commun', { public: true })
    streams.handleSubStream(a, 'commun')
    streams.handleSubStream(b, 'commun')
    streams.onDisconnect(a)
    recus.length = 0
    flux.add('k', 1)
    assert.deepEqual(recus, ['c2'])
  })
})
