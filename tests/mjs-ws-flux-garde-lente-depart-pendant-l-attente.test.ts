// Garde `canSubscribe` asynchrone et lente (base, back) qui lit l'appartenance au salon AVANT d'attendre : la connexion
// demande le flux, puis quitte le salon pendant l'attente. Le « oui », lu avant le départ, installait quand même
// l'abonnement : sortie du salon, la connexion recevait l'état complet puis chaque delta. Seule l'option `room` était
// relue à la réponse, jamais les salons lus par la garde. Un départ d'un salon que la garde a déjà lu rend désormais ce
// « oui » caduc : la garde est repassée, et la connexion sortie ne reçoit rien du flux (un µ:error, comme tout refus)
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function abonne(transport: MemoryTransport, salons: string[]): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  for (const room of salons) envoyer('µ:join', { room })
  await tick(10)
  return { trames, envoyer }
}

// garde lente : l'appartenance est lue tout de suite, la réponse vient 100 ms plus tard
async function scenario(demande: 'µ:sub-stream' | 'µ:resync', quitte: string): Promise<{ recu: any[]; erreurs: any[]; appels: number }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  let appels = 0
  const reserve = app.stream('reserve', { canSubscribe: async (c) => { appels++; const dedans = app.room('abonnes').has(c); await tick(100); return dedans } })
  await app.listen()
  try {
    reserve.add('avant', 1)
    const a = await abonne(transport, ['abonnes', 'autre'])
    a.envoyer(demande, demande === 'µ:resync' ? { stream: 'reserve', from: 0 } : { stream: 'reserve' })
    await tick(20)
    a.envoyer('µ:leave', { room: quitte })
    await tick(400)
    reserve.add('apres', 2)
    await tick(30)
    return { recu: a.trames.filter(f => f.t === 'reserve'), erreurs: a.trames.filter(f => f.t === 'µ:error'), appels }
  } finally {
    await app.stop()
  }
}

describe('MJS-WS — flux : garde lente, départ d’un salon qu’elle a lu pendant son attente', function () {
  this.timeout(10000)

  it('µ:sub-stream : ni état complet ni delta pour la connexion sortie, un µ:error', async () => {
    const { recu, erreurs } = await scenario('µ:sub-stream', 'abonnes')
    assert.deepEqual(recu, [], 'sortie du salon pendant la garde : rien du flux')
    assert.equal(erreurs.length, 1, 'un refus annoncé, jamais un silence')
  })

  it('µ:resync : ni rejeu ni delta pour la connexion sortie, un µ:error', async () => {
    const { recu, erreurs } = await scenario('µ:resync', 'abonnes')
    assert.deepEqual(recu, [], 'sortie du salon pendant la garde : rien du flux')
    assert.equal(erreurs.length, 1, 'un refus annoncé, jamais un silence')
  })

  it('départ d’un salon que la garde n’a pas lu : son « oui » tient, une seule garde', async () => {
    const { recu, erreurs, appels } = await scenario('µ:sub-stream', 'autre')
    assert.deepEqual(recu.map(f => f.p), [{ op: 'reset', values: { avant: 1 } }, { op: 'add', key: 'apres', value: 2 }], 'l’état complet puis le delta')
    assert.deepEqual(erreurs, [], 'aucun µ:error')
    assert.equal(appels, 1, 'la garde n’est pas repassée')
  })
})
