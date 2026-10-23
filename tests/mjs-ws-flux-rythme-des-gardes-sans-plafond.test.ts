// Rythme des gardes rappelées au départ d'un salon et au retour (deux d'avance puis une par seconde, par connexion et par
// flux) : pour les flux quittés, il était tenu dans un registre plafonné à 16 par connexion. Au-delà (20 flux gardés d'un
// même salon quittés ensemble), les plus anciens perdaient leur rythme et rappelaient leur garde à chaque retour ; et un
// flux sorti du registre pendant qu'il attendait son tour n'était plus reporté : repartie avant, la connexion ne le
// retrouvait plus jamais. Le registre n'a plus de plafond : il garde ce qui sert encore (seau entamé, flux qui attend son
// tour) et oublie le reste, sa taille suit les flux que la connexion a réellement suivis
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

describe('MJS-WS — flux gardés : le rythme des gardes tient quel que soit le nombre de flux, aucun flux perdu', function () {
  this.timeout(30000)

  for (const nombre of [20, 40]) {
    it(`${nombre} flux réservés au salon et gardés, 120 trames µ:leave / µ:join : appels bornés par le temps, chaque flux rendu au retour`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
      let appels = 0
      const flux = Array.from({ length: nombre }, (_, i) => app.stream('table-' + i, { room: 'abonnes', canSubscribe: async () => { appels++; return true } }))
      await app.listen()
      try {
        const a = await abonne(transport, ['abonnes'])
        for (let i = 0; i < nombre; i++) a.envoyer('µ:sub-stream', { stream: 'table-' + i })
        await tick(50)
        assert.equal(appels, nombre, 'une garde par abonnement')
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
        assert.ok(pendant <= nombre * (2 + secondes), `appels de garde pendant 120 trames en ${secondes} s : ${pendant}`)
        await tick(1200)
        const avant = a.trames.length
        for (const f of flux) f.add('apres', 1)
        await tick(50)
        const rendus = new Set(a.trames.slice(avant).filter(f => String(f.t).startsWith('table-')).map(f => f.t))
        assert.equal(rendus.size, nombre, 'revenue dans le salon : chaque flux est rendu')
        assert.deepEqual(a.trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
      } finally {
        await app.stop()
      }
    })
  }

  it('flux qui attend son tour, 17 flux d’un autre salon quittés entre-temps, départ avant son tour : rendu au retour suivant', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    let appels = 0
    const table = app.stream('table', { room: 'abonnes', canSubscribe: () => { appels++; return true } })
    for (let i = 0; i < 17; i++) app.stream('voisin-' + i, { room: 'voisins', canSubscribe: () => true })
    await app.listen()
    try {
      const a = await abonne(transport, ['abonnes', 'voisins'])
      a.envoyer('µ:sub-stream', { stream: 'table' })
      for (let i = 0; i < 17; i++) a.envoyer('µ:sub-stream', { stream: 'voisin-' + i })
      await tick(30)
      for (let k = 0; k < 3; k++) {
        a.envoyer('µ:leave', { room: 'abonnes' })
        await tick(10)
        a.envoyer('µ:join', { room: 'abonnes' })
        await tick(10)
      }
      assert.equal(appels, 3, 'l’abonnement, puis deux retours d’avance ; le troisième attend son tour')
      // les 17 flux voisins quittés deux fois : leurs seaux entamés rejoignent ceux des flux quittés
      a.envoyer('µ:leave', { room: 'voisins' })
      await tick(10)
      a.envoyer('µ:join', { room: 'voisins' })
      await tick(10)
      a.envoyer('µ:leave', { room: 'voisins' })
      await tick(10)
      a.envoyer('µ:leave', { room: 'abonnes' })
      await tick(1100)
      table.add('dehors', 1)
      await tick(20)
      const avant = a.trames.length
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(1100)
      const retour = a.trames.slice(avant).filter(f => f.t === 'table')
      assert.deepEqual(retour.map(f => f.p), [{ op: 'reset', values: { dehors: 1 } }], 'revenue : l’état complet, une seule fois')
      assert.equal(appels, 4, 'une garde pour ce retour')
      assert.deepEqual(a.trames.filter(f => f.t === 'µ:error'), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })
})
