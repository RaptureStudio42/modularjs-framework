// Gardes `canSubscribe` des flux : une seule règle pour toutes leurs réponses. Une réponse dont les lectures ont été
// périmées par un départ avant son arrivée ne compte pas : la garde est repassée au même rythme, et rien du flux ne part
// en attendant ; seule compte la réponse de l'évaluation la plus récente. Chaque chemin qui applique une réponse est pris
// ici dans le cas qui lui échappait : la garde repassée au retour, dont le « oui » levait la retenue d'une connexion
// repartie (elle recevait ensuite chaque delta, sans fin, sans µ:error) ; le départ pendant une vérification en vol
// (deltas envoyés le temps de sa réponse, puis de la suivante) ; le départ glissé entre la réponse et son application
// (il ne comptait pas) ; la demande repassée pendant une vérification différée (jamais répondue), et le retour pendant
// son attente (garde rappelée hors cadence) ; la réponse dépassée d'une garde resserrée (un « non » ancien écartait
// l'abonnement repris depuis)
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

// trames du flux reçues depuis l'indice `depuis`
const duFlux   = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'reserve')
const erreurs  = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'µ:error')

describe('MJS-WS — flux : une seule règle pour les réponses des gardes', function () {
  this.timeout(20000)

  it('garde repassée au retour, nouveau départ sans jeton : son « oui » périmé ne lève pas la retenue, plus rien du flux', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    const reserve = app.stream('reserve', { canSubscribe: async (c) => { const dedans = app.room('abonnes').has(c); await tick(100); return dedans } })
    await app.listen()
    try {
      const a = await abonne(transport, ['abonnes'])
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(150)
      // deux départs, chacun suivi d'un retour avant le « non » de sa vérification : les deux jetons d'avance sont pris
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(20); a.envoyer('µ:join', { room: 'abonnes' }); await tick(230)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(20); a.envoyer('µ:join', { room: 'abonnes' }); await tick(110)
      // la garde repassée au retour est en vol : départ sans jeton, la connexion est retenue
      const depart = a.trames.length
      a.envoyer('µ:leave', { room: 'abonnes' })
      await tick(30); reserve.add('pendant', 1)
      await tick(150); reserve.add('apres-la-reponse', 2)
      await tick(900); reserve.add('apres-la-verification', 3)
      await tick(30)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p), [], 'sortie du salon : rien du flux')
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(1300)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), ['reset'], 'revenue : l’état complet')
    } finally {
      await app.stop()
    }
  })

  it('départ pendant une vérification en vol qui a déjà lu le salon : rien du flux, ni le temps de sa réponse ni celui de la suivante', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const reserve = app.stream('reserve', { canSubscribe: async (c) => { await tick(100); const dedans = app.room('abonnes').has(c); await tick(100); return dedans } })
    await app.listen()
    try {
      const a = await abonne(transport, ['abonnes'])
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(250)
      // départ : la vérification lit le salon 100 ms plus tard, la connexion y est revenue entre-temps
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(40); a.envoyer('µ:join', { room: 'abonnes' }); await tick(100)
      const depart = a.trames.length
      a.envoyer('µ:leave', { room: 'abonnes' })
      await tick(20); reserve.add('pendant-la-reponse', 1)
      await tick(100); reserve.add('pendant-la-suivante', 2)
      await tick(300); reserve.add('apres', 3)
      await tick(30)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p), [], 'sortie du salon : rien du flux')
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(1300)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), ['reset'], 'revenue : l’état complet')
    } finally {
      await app.stop()
    }
  })

  it('départ glissé entre la réponse de la garde et son application : il compte, la connexion sortie ne reçoit rien', async () => {
    for (let sauts = 0; sauts <= 6; sauts++) {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      // la première réponse est tenue en main ; les suivantes (garde repassée, vérification au départ) viennent seules
      const tenue: { rendre?: () => void } = {}
      const reserve = app.stream('reserve', { canSubscribe: (c) => {
        const dedans = app.room('abonnes').has(c)
        if (tenue.rendre) return Promise.resolve(dedans)
        return new Promise<boolean>(r => { tenue.rendre = () => r(dedans) })
      } })
      await app.listen()
      try {
        const a = await abonne(transport, ['abonnes'])
        a.envoyer('µ:sub-stream', { stream: 'reserve' })
        await tick(20)
        const client = Array.from(app.clients)[0]
        tenue.rendre!()
        let attente: Promise<void> = Promise.resolve()
        for (let i = 0; i < sauts; i++) attente = attente.then(() => {})
        attente.then(() => app.room('abonnes').kick(client))
        await tick(50)
        const avant = a.trames.length
        reserve.add('apres', 1)
        await tick(30)
        assert.deepEqual(duFlux(a.trames, avant), [], `départ ${sauts} tour(s) après la réponse : rien du flux`)
      } finally {
        await app.stop()
      }
    }
  })

  it('µ:resync dont la réponse est périmée pendant une vérification différée : la demande est repassée et reçoit sa réponse', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    const reserve = app.stream('reserve', { canSubscribe: async (c) => { const dedans = app.room('abonnes').has(c); await tick(100); return dedans } })
    await app.listen()
    try {
      reserve.add('avant', 1)
      const a = await abonne(transport, ['abonnes'])
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(150)
      // deux allers-retours : les deux jetons d'avance sont pris
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(20); a.envoyer('µ:join', { room: 'abonnes' }); await tick(230)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(20); a.envoyer('µ:join', { room: 'abonnes' }); await tick(230)
      // la demande lit le salon, puis la connexion part avant la réponse : la vérification de ce départ est différée
      const depart = a.trames.length
      a.envoyer('µ:resync', { stream: 'reserve', from: 0 })
      await tick(20)
      a.envoyer('µ:leave', { room: 'abonnes' })
      await tick(30); reserve.add('pendant', 2)
      await tick(1500); reserve.add('apres', 3)
      await tick(30)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p), [], 'sortie du salon : rien du flux')
      assert.equal(erreurs(a.trames, depart).length, 1, 'la demande reçoit sa réponse : un refus annoncé')
    } finally {
      await app.stop()
    }
  })

  it('retour pendant qu’une demande repassée attend son jeton : la garde n’est pas rappelée hors cadence, la demande tranche seule', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    let appels = 0
    const reserve = app.stream('reserve', { canSubscribe: async (c) => { appels++; const dedans = app.room('abonnes').has(c); await tick(100); return dedans } })
    await app.listen()
    try {
      reserve.add('avant', 1)
      const a = await abonne(transport, ['abonnes'])
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(150)
      // deux allers-retours : les deux jetons d'avance sont pris, le suivant revient une seconde après le premier départ
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(20); a.envoyer('µ:join', { room: 'abonnes' }); await tick(230)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(20); a.envoyer('µ:join', { room: 'abonnes' }); await tick(230)
      // demande périmée par un départ : repassée, elle attend son jeton, la connexion hors du flux en attendant
      const depart = a.trames.length
      a.envoyer('µ:resync', { stream: 'reserve', from: 0 })
      await tick(20)
      a.envoyer('µ:leave', { room: 'abonnes' })
      await tick(130)
      // retour avant le jeton : le flux perdu au départ n'est pas redemandé à côté de la demande en attente
      const avant = appels
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(150)
      assert.equal(appels, avant, 'aucune garde avant le retour du jeton')
      await tick(1000)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p), [{ op: 'add', key: 'avant', value: 1 }], 'la demande reçoit son rejeu, une seule fois')
      assert.deepEqual(erreurs(a.trames, depart), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })

  it('garde resserrée : sa réponse, dépassée par un abonnement repris depuis, ne l’écarte pas', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const reserve = app.stream('reserve')
    await app.listen()
    try {
      const a = await abonne(transport, [])
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(20)
      // garde posée après coup : la première réponse (connexion hors du salon) vient lentement, les suivantes vite
      let appels = 0
      app.stream('reserve', { canSubscribe: async (c) => { const dedans = app.room('abonnes').has(c); await tick(appels++ === 0 ? 200 : 10); return dedans } })
      await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' })
      await tick(10)
      const depart = a.trames.length
      a.envoyer('µ:sub-stream', { stream: 'reserve' })
      await tick(300)
      reserve.add('apres', 1)
      await tick(30)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), ['reset', 'add'], 'l’état complet repris, puis le delta')
      assert.deepEqual(erreurs(a.trames, depart), [], 'aucun µ:error')
    } finally {
      await app.stop()
    }
  })
})
