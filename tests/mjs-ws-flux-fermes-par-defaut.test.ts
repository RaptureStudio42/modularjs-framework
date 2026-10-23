// Un flux est fermé par défaut : déclaré sans accès (ni `public`, ni `room`, ni `canSubscribe`), il n'est servi à
// personne — chaque demande reçoit un µ:error. app.stream(nom, { public: true }) l'ouvre à tous, même déclaré après
// une première poignée sans option. Pendant le développement, un avertissement le dit à la déclaration, avec la ligne
// à écrire. Entre plusieurs processus, l'ouverture voyage avec les deltas : un flux ouvert ailleurs est servi sans
// déclaration ici, un flux fermé ailleurs ne l'est pas. Avant, tout flux sans garde était servi à tout client.
import assert from 'node:assert/strict'
import { mjsWs, MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MemoryAdapterBus } from '../src/mjs-ws/index.js'
import { t } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Process { transport: MemoryTransport; app: MjsWsApp; avertissements: string[] }

async function demarrer(bus?: MemoryAdapterBus): Promise<Process> {
  const transport = new MemoryTransport()
  const avertissements: string[] = []
  const app = mjsWs({
    transport, heartbeat: 0, auth: () => ({ id: 'u' }),
    onLog: (level, message) => { if (level === 'warn') avertissements.push(message) },
    ...(bus ? { adapter: new MemoryAdapter({ bus }), antiEntropy: false as const } : {}),
  })
  await app.listen()
  return { transport, app, avertissements }
}

// ce qu'un client reçoit après un µ:sub-stream : les valeurs du flux, ou 'refus'
async function vu(transport: MemoryTransport, flux: string): Promise<unknown[]> {
  const ws: any = transport.connect({ url: 'ws://visiteur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: flux } }))
  await tick(30)
  return trames.filter(f => f.t === flux || f.t === 'µ:error').map(f => f.t === 'µ:error' ? f.p.message : f.p.values)
}

const REFUS = () => t('ws.streams.acces-flux-refuse')

describe('MJS-WS — un flux est fermé par défaut, le programmeur l\'ouvre', function () {
  this.timeout(10000)

  it('déclaré sans accès : servi à personne, chaque demande reçoit un µ:error', async () => {
    const P = await demarrer()
    P.app.stream('scores').add('zora', 12)
    assert.deepEqual(await vu(P.transport, 'scores'), [REFUS()])
    P.app.stream('scores', { journal: 50 })
    assert.deepEqual(await vu(P.transport, 'scores'), [REFUS()], '`journal` n\'ouvre rien')
    await P.app.stop()
  })

  it('{ public: true } l\'ouvre à tous, même déclaré après une première poignée sans option', async () => {
    const P = await demarrer()
    P.app.stream('scores', { public: true }).add('zora', 12)
    assert.deepEqual(await vu(P.transport, 'scores'), [{ zora: 12 }])
    P.app.stream('tableau').add('theo', 3)
    P.app.stream('tableau', { public: true })
    assert.deepEqual(await vu(P.transport, 'tableau'), [{ theo: 3 }], 'l\'ouverture arrive après la poignée')
    await P.app.stop()
  })

  it('une garde reste maîtresse : { public: true, room } est réservé aux membres du salon', async () => {
    const P = await demarrer()
    P.app.stream('partie-9', { public: true, room: 'partie-9' }).add('main', ['As'])
    assert.deepEqual(await vu(P.transport, 'partie-9'), [REFUS()])
    await P.app.stop()
  })

  it('pendant le développement, la déclaration d\'un flux fermé avertit une fois, avec la ligne à écrire', async () => {
    const P = await demarrer()
    P.app.stream('ferme')
    P.app.stream('ferme')
    P.app.stream('ouvert', { public: true })
    P.app.stream('salon', { room: 'partie' })
    P.app.stream('garde', { canSubscribe: () => true })
    P.app.stream('tard')
    P.app.stream('tard', { public: true })
    await tick()
    const ligne = t('ws.streams.flux-ferme-a-la-declaration', { name: 'ferme' })
    assert.ok(ligne.includes("app.stream('ferme', { public: true })"), ligne)
    assert.deepEqual(P.avertissements.filter(l => l.includes('public: true')), [ligne], JSON.stringify(P.avertissements))
    await P.app.stop()
  })

  it('en production (NODE_ENV=production), pas d\'avertissement à la déclaration', async () => {
    const avant = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const P = await demarrer()
      P.app.stream('ferme')
      await tick()
      assert.deepEqual(P.avertissements.filter(l => l.includes('public: true')), [], JSON.stringify(P.avertissements))
      await P.app.stop()
    }
    finally {
      if (avant === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = avant
    }
  })

  it('plusieurs processus : ouvert sur A, servi sur B sans déclaration ; fermé sur A, refusé sur B', async () => {
    const bus = createMemoryAdapterBus()
    const A = await demarrer(bus), B = await demarrer(bus)
    A.app.stream('scores', { public: true }).add('zora', 12)
    A.app.stream('secret').add('cle', 42)
    await tick(30)
    assert.deepEqual(await vu(B.transport, 'scores'), [{ zora: 12 }], 'l\'ouverture voyage avec les deltas')
    assert.deepEqual(await vu(B.transport, 'secret'), [REFUS()], 'un flux fermé l\'est partout')
    await A.app.stop(); await B.app.stop()
  })
})
