// Un flux réservé à un salon (`app.stream(nom, { room })`) n'envoie plus rien à une connexion qui a quitté ce
// salon : partie d'elle-même (µ:leave) ou expulsée (app.room().kick). Le désabonnement se fait au départ du salon,
// et chaque envoi contrôle encore l'appartenance. Sans ça, un joueur expulsé par l'anti-triche gardait la vue sur
// toute la partie. Revenue dans le salon, la connexion retrouve le flux : l'état complet, puis les deltas.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  let n = 0
  const app = mjsWs({ transport, heartbeat: 0, auth: () => ({ id: 'joueur-' + (++n) }), onLog: () => {} })
  await app.listen()
  return { transport, app }
}

interface Client { trames: any[]; envoyer: (t: string, p?: unknown) => void; deltas: (flux: string) => any[]; instantanes: (flux: string) => any[] }

async function client(transport: MemoryTransport): Promise<Client> {
  const ws = transport.connect({ url: 'ws://joueur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, resub: [], rooms: [] } }))
  await tick()
  return {
    trames,
    envoyer: (t, p) => ws.send(JSON.stringify({ t, p })),
    deltas: (flux) => trames.filter(f => f.t === flux && f.p?.op !== 'reset'),
    instantanes: (flux) => trames.filter(f => f.t === flux && f.p?.op === 'reset'),
  }
}

// rejoint le salon puis s'abonne au flux : l'instantané doit arriver
async function joueurAbonne(transport: MemoryTransport, salon: string, flux: string): Promise<Client> {
  const c = await client(transport)
  c.envoyer('µ:join', { room: salon })
  await tick()
  c.envoyer('µ:sub-stream', { stream: flux })
  await tick(20)
  assert.equal(c.instantanes(flux).length, 1, 'abonné : instantané reçu')
  return c
}

describe('MJS-WS — flux réservé à un salon : plus rien après le départ du salon', () => {
  it('expulsé du salon (app.room().kick) : plus aucun delta, le joueur resté les reçoit toujours', async () => {
    const { transport, app } = await demarrer()
    const partie   = app.stream('partie-42', { room: 'table-42' })
    const tricheur = await joueurAbonne(transport, 'table-42', 'partie-42')
    const honnete  = await joueurAbonne(transport, 'table-42', 'partie-42')
    const cible    = Array.from(app.room('table-42').clients)[0]
    app.room('table-42').kick(cible, 'triche')
    await tick()
    assert.equal(tricheur.trames.filter(f => f.t === 'µ:left').length, 1, 'le tricheur a bien été expulsé')

    partie.add('main-secrete', { cartes: ['As', 'Roi'] })
    await tick()
    assert.deepEqual(tricheur.deltas('partie-42'), [], 'aucun delta après l\'expulsion')
    assert.equal(honnete.deltas('partie-42').length, 1, 'le joueur resté dans le salon reçoit le delta')
    await app.stop()
  })

  it('parti du salon (µ:leave) : plus aucun delta', async () => {
    const { transport, app } = await demarrer()
    const partie = app.stream('partie-7', { room: 'table-7' })
    const joueur = await joueurAbonne(transport, 'table-7', 'partie-7')
    joueur.envoyer('µ:leave', { room: 'table-7' })
    await tick()
    assert.equal(app.room('table-7').size, 0)

    partie.add('carte', { valeur: 'Dame' })
    await tick()
    assert.deepEqual(joueur.deltas('partie-7'), [])
    await app.stop()
  })

  it('expulsé puis revenu dans le salon : rien pendant l\'absence, puis l\'état complet et les deltas sans rien redemander', async () => {
    const { transport, app } = await demarrer()
    const partie   = app.stream('partie-9', { room: 'table-9' })
    const tricheur = await joueurAbonne(transport, 'table-9', 'partie-9')
    app.room('table-9').kick(Array.from(app.room('table-9').clients)[0], 'triche')
    await tick()
    partie.add('main-secrete', { cartes: ['As'] })
    await tick()
    assert.deepEqual(tricheur.deltas('partie-9'), [], 'rien pendant l\'absence')

    tricheur.envoyer('µ:join', { room: 'table-9' })
    await tick()
    assert.equal(app.room('table-9').size, 1, 'de retour dans le salon')
    assert.equal(tricheur.instantanes('partie-9').length, 2, 'l\'état complet au retour')
    partie.add('main-2', { cartes: ['Roi'] })
    await tick()
    assert.equal(tricheur.deltas('partie-9').length, 1, 'puis les deltas')
    await app.stop()
  })

  it('garde canSubscribe lente : parti du salon pendant la garde → ni instantané ni delta', async () => {
    const { transport, app } = await demarrer()
    let laisser: (ok: boolean) => void = () => {}
    const partie = app.stream('partie-lente', { room: 'table-lente', canSubscribe: () => new Promise<boolean>(r => { laisser = r }) })
    partie.add('main', { cartes: ['Valet'] })
    const joueur = await client(transport)
    joueur.envoyer('µ:join', { room: 'table-lente' })
    await tick()
    joueur.envoyer('µ:sub-stream', { stream: 'partie-lente' })
    await tick()
    joueur.envoyer('µ:leave', { room: 'table-lente' })
    await tick()
    laisser(true)
    await tick(20)
    assert.deepEqual(joueur.instantanes('partie-lente'), [], 'aucun instantané pour qui n\'est plus membre')

    partie.add('main-2', { cartes: ['Roi'] })
    await tick()
    assert.deepEqual(joueur.deltas('partie-lente'), [])
    await app.stop()
  })
})
