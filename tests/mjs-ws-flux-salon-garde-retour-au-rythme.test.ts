// Flux réservé à un salon ET gardé (`{ room, canSubscribe }`) : au départ du salon, la connexion le quitte tout de suite,
// et à chaque retour la garde était rappelée, sans aucun rythme — une connexion qui sort et rentre sans cesse au débit
// autorisé la faisait appeler une fois par flux et par retour (10 flux, 120 trames : 600 appels). Le retour suit
// désormais le même rythme que les gardes repassées au départ d'un salon qu'elles lisent : deux d'avance puis une par
// seconde, par connexion et par flux. Un flux qui attend son tour n'est jamais perdu : parti de nouveau avant, la
// connexion le retrouve à son retour suivant
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

describe('MJS-WS — flux réservé au salon et gardé : la garde rappelée au retour suit un rythme', function () {
  this.timeout(20000)

  it('10 flux, 120 trames µ:leave / µ:join : appels de garde bornés par le temps, chaque flux rendu au retour', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    let appels = 0
    const flux = Array.from({ length: 10 }, (_, i) => app.stream('table-' + i, { room: 'abonnes', canSubscribe: async () => { appels++; return true } }))
    await app.listen()
    try {
      const a = await abonne(transport)
      for (let i = 0; i < 10; i++) a.envoyer('µ:sub-stream', { stream: 'table-' + i })
      await tick(50)
      assert.equal(appels, 10, 'une garde par abonnement')
      appels = 0
      const debut = Date.now()
      for (let k = 0; k < 60; k++) {
        a.envoyer('µ:leave', { room: 'abonnes' })
        await tick(25)
        a.envoyer('µ:join', { room: 'abonnes' })
        await tick(25)
      }
      const secondes = Math.ceil((Date.now() - debut) / 1000)
      const pendant  = appels
      assert.ok(pendant <= 10 * (2 + secondes), `appels de garde pendant 120 trames en ${secondes} s : ${pendant}`)
      await tick(1200)
      const avant = a.trames.length
      for (const f of flux) f.add('apres', 1)
      await tick(30)
      const rendus = new Set(a.trames.slice(avant).filter(f => String(f.t).startsWith('table-')).map(f => f.t))
      assert.equal(rendus.size, 10, 'revenue dans le salon : chaque flux est rendu')
      assert.deepEqual(a.trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })

  it('retour sans jeton, puis départ avant qu’il revienne : le flux est rendu au retour suivant, une seule fois', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    let appels = 0
    const table = app.stream('table', { room: 'abonnes', canSubscribe: () => { appels++; return true } })
    await app.listen()
    try {
      const a = await abonne(transport)
      a.envoyer('µ:sub-stream', { stream: 'table' })
      await tick(20)
      for (let k = 0; k < 3; k++) {
        a.envoyer('µ:leave', { room: 'abonnes' })
        await tick(10)
        a.envoyer('µ:join', { room: 'abonnes' })
        await tick(10)
      }
      assert.equal(appels, 3, 'l’abonnement, puis deux retours d’avance ; le troisième attend son tour')
      a.envoyer('µ:leave', { room: 'abonnes' })
      await tick(1100)
      table.add('dehors', 1)
      await tick(20)
      const avant = a.trames.length
      assert.equal(appels, 3, 'sortie du salon : son tour venu, la garde n’est pas appelée')
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(30)
      const retour = a.trames.slice(avant).filter(f => f.t === 'table')
      assert.deepEqual(retour.map(f => f.p), [{ op: 'reset', values: { dehors: 1 } }], 'revenue : l’état complet, une seule fois')
      assert.equal(appels, 4, 'une garde pour ce retour')
      assert.deepEqual(a.trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })
})
