// Une garde `canSubscribe` qui lit l'appartenance au salon (le patron de la doc : `app.room('abonnes').has(c)`) était
// repassée à chaque départ de ce salon : une connexion qui en sort et y rentre au débit autorisé faisait appeler la garde
// une fois par flux suivi et par départ (20 flux, 120 trames en 3 s : 1 200 appels). Elle n'est plus repassée qu'une
// fois en vol par connexion et par flux, au plus une fois par seconde (deux d'avance) ; en attendant, une connexion sortie
// du salon ne reçoit rien du flux, et revenue elle le retrouve si la garde l'accepte
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function abonne(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  envoyer('µ:join', { room: 'abonnes' })
  await tick(10)
  return { trames, envoyer }
}

describe('MJS-WS — flux : garde qui lit le salon, repassée au plus une fois par seconde', function () {
  this.timeout(20000)

  it('20 flux, 120 trames µ:leave / µ:join en 3 s : pas plus d’appels de garde que de trames, chaque flux repris au retour', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    let appels = 0
    const flux = Array.from({ length: 20 }, (_, i) => app.stream('reserve-' + i, { canSubscribe: async (c) => { appels++; return app.room('abonnes').has(c) } }))
    await app.listen()
    try {
      const a = await abonne(transport)
      for (let i = 0; i < 20; i++) a.envoyer('µ:sub-stream', { stream: 'reserve-' + i })
      await tick(50)
      assert.equal(appels, 20, 'une garde par abonnement')
      appels = 0
      for (let k = 0; k < 60; k++) {
        a.envoyer('µ:leave', { room: 'abonnes' })
        await tick(25)
        a.envoyer('µ:join', { room: 'abonnes' })
        await tick(25)
      }
      const pendant = appels
      assert.ok(pendant <= 120, `appels de garde pendant 120 trames : ${pendant}`)
      await tick(1200)
      const avant = a.trames.length
      for (const f of flux) f.add('apres', 1)
      await tick(30)
      const repris = new Set(a.trames.slice(avant).filter(f => String(f.t).startsWith('reserve-')).map(f => f.t))
      assert.equal(repris.size, 20, 'revenue dans le salon : chaque flux reprend')
    } finally {
      await app.stop()
    }
  })

  it('sortie du salon pendant l’attente de la garde : aucun delta, ni pendant ni après ; au retour l’état complet', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const reserve = app.stream('reserve', { canSubscribe: async (c) => app.room('abonnes').has(c) })
    await app.listen()
    try {
      const a = await abonne(transport)
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(20)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      const avant = a.trames.length
      reserve.add('pendant', 1)
      await tick(1200)
      reserve.add('apres', 2)
      await tick(20)
      assert.deepEqual(a.trames.slice(avant).filter(f => f.t === 'reserve'), [], 'hors du salon : rien du flux')
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(1300)
      const retour = a.trames.slice(avant).filter(f => f.t === 'reserve')
      assert.deepEqual(retour.map(f => f.p), [{ op: 'reset', values: { pendant: 1, apres: 2 } }], 'revenue : l’état complet')
      assert.deepEqual(a.trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })
})
