// Les noms de salon reçus d'un client (µ:join, µ:sub-presence) sont bornés à 200 caractères, la borne que les
// curseurs, le suivi d'écran et les réactions appliquent déjà : au-delà, refus clair et rien n'est retenu. Avant,
// un visiteur anonyme gardait en mémoire des dizaines de noms de 60 Ko par connexion (≈ 440 Mo par adresse).
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })   // défauts : sans auth, sans garde de salon
  await app.listen()
  return { transport, app }
}

async function client(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p?: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://anonyme/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, resub: [], rooms: [] } }))
  await tick()
  return { trames, envoyer: (t, p) => ws.send(JSON.stringify({ t, p })) }
}

const refus = (trames: any[]): string[] => trames.filter(f => f.t === 'µ:error').map(f => f.p.message)

describe('MJS-WS — noms de salon bornés à 200 caractères', () => {
  it('µ:join avec un nom de 201 caractères : refusé clairement, aucun salon créé', async () => {
    const { transport, app } = await demarrer()
    const c = await client(transport)
    c.envoyer('µ:join', { room: 's'.repeat(201) })
    await tick()
    assert.equal(app.stats().salons.nombre, 0)
    assert.equal(refus(c.trames).length, 1)
    assert.match(refus(c.trames)[0], /200/)
    await app.stop()
  })

  it('µ:join avec un nom de 200 caractères : accepté comme avant', async () => {
    const { transport, app } = await demarrer()
    const c = await client(transport)
    c.envoyer('µ:join', { room: 's'.repeat(200) })
    await tick()
    assert.equal(app.stats().salons.nombre, 1)
    assert.deepEqual(refus(c.trames), [])
    await app.stop()
  })

  it('µ:sub-presence avec un nom de 201 caractères : refusé, aucun abonnement retenu ; 200 accepté', async () => {
    const { transport, app } = await demarrer()
    app.room('p'.repeat(200), { presence: 'public' })   // présence ouverte : le nom seul décide
    const c = await client(transport)
    c.envoyer('µ:sub-presence', { room: 'p'.repeat(201) })
    await tick()
    assert.equal(app.stats().salons.abonnesPresence, 0)
    assert.equal(refus(c.trames).length, 1)
    assert.equal(c.trames.filter(f => f.t === 'µ:presence').length, 0, 'aucun instantané de présence')

    c.envoyer('µ:sub-presence', { room: 'p'.repeat(200) })
    await tick()
    assert.equal(app.stats().salons.abonnesPresence, 1)
    await app.stop()
  })
})
