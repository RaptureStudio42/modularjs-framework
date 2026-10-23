// Gardes `canSubscribe` asynchrones des flux : une demande (µ:sub-stream, µ:resync, garde posée après coup) dont la garde
// a lu un salon pendant que la connexion en était sortie, et dont le refus arrive alors qu'elle y est revenue (une entrée
// rapide), recevait un µ:error à tort. Ce refus ne compte pas : la garde est repassée, au même rythme (un appel de plus),
// et seule sa nouvelle réponse tranche. Un refus dont les lectures n'ont pas changé reste un refus
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function connexion(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  return { trames, envoyer }
}

// trames du flux reçues depuis l'indice `depuis`
const duFlux  = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'reserve')
const erreurs = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'µ:error')

// garde lente qui lit le salon : chaque réponse est rendue à la main, dans l'ordre voulu par le cas — elle vaut
// l'appartenance lue, sauf `refuser` (une autre raison de refuser)
function gardeTenue(app: any, refuser = false) {
  const appels: Array<() => void> = []
  const garde = (c: unknown) => {
    const dedans = app.room('abonnes').has(c)
    return new Promise<boolean>(r => appels.push(() => r(dedans && !refuser)))
  }
  const rendre = async (i: number) => { appels[i]?.(); await tick(10) }
  return { appels, garde, rendre }
}

const DEMANDES: Array<{ nom: string; trame: [string, unknown] }> = [
  { nom: 'µ:sub-stream', trame: ['µ:sub-stream', { stream: 'reserve' }] },
  { nom: 'µ:resync',     trame: ['µ:resync', { stream: 'reserve', from: 0 }] },
]

describe('MJS-WS — flux : refus lu hors du salon, arrivé après le retour', function () {
  this.timeout(20000)

  for (const demande of DEMANDES) {
    it(`${demande.nom} lu hors du salon, retour avant le refus : la garde est repassée, l’accès accordé sans µ:error`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const g = gardeTenue(app)
      const reserve = app.stream('reserve', { canSubscribe: g.garde })
      await app.listen()
      try {
        reserve.add('avant', 1)
        const a = await connexion(transport)
        a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
        a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
        // la demande lit le salon dehors, la connexion y revient avant la réponse
        const depart = a.trames.length
        a.envoyer(...demande.trame); await tick(10)
        a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
        await g.rendre(0)
        await g.rendre(1)
        assert.equal(g.appels.length, 2, 'un appel de plus, un seul')
        reserve.add('apres', 2)
        await tick(20)
        assert.deepEqual(erreurs(a.trames, depart), [], 'aucun µ:error')
        const attendu = demande.nom === 'µ:resync' ? ['add', 'add'] : ['reset', 'add']
        assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), attendu, 'l’accès accordé, puis les deltas')
      } finally {
        await app.stop()
      }
    })
  }

  it('connexion abonnée, redemande lue hors du salon, retour avant le refus : aucun µ:error, l’abonnement repris', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const g = gardeTenue(app)
    const reserve = app.stream('reserve', { canSubscribe: g.garde })
    await app.listen()
    try {
      reserve.add('avant', 1)
      const a = await connexion(transport)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      await g.rendre(0)
      // départ (vérification en vol), redemande lue dehors, retour avant les deux réponses
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      const depart = a.trames.length
      a.envoyer('µ:resync', { stream: 'reserve', from: 0 }); await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      await g.rendre(2)
      await g.rendre(1)
      for (let i = 3; i < g.appels.length; i++) await g.rendre(i)
      reserve.add('apres', 2)
      await tick(20)
      assert.deepEqual(erreurs(a.trames, depart), [], 'aucun µ:error')
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), ['add', 'add'], 'le rejeu demandé, puis le delta')
    } finally {
      await app.stop()
    }
  })

  it('garde posée après coup, lue hors du salon, retour avant le refus : l’abonné garde le flux, sans µ:error', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const reserve = app.stream('reserve', { public: true })
    await app.listen()
    try {
      const a = await connexion(transport)
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      const g = gardeTenue(app)
      const depart = a.trames.length
      app.stream('reserve', { canSubscribe: g.garde }); await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      await g.rendre(0)
      await g.rendre(1)
      assert.equal(g.appels.length, 2, 'un appel de plus, un seul')
      reserve.add('apres', 1)
      await tick(20)
      assert.deepEqual(erreurs(a.trames, depart), [], 'aucun µ:error')
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), ['reset', 'add'], 'l’état complet, puis le delta')
    } finally {
      await app.stop()
    }
  })

  it('témoin : refus lu hors du salon, la connexion toujours dehors à son arrivée — le refus compte', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const g = gardeTenue(app)
    const reserve = app.stream('reserve', { canSubscribe: g.garde })
    await app.listen()
    try {
      const a = await connexion(transport)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      const depart = a.trames.length
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      await g.rendre(0)
      await tick(50)
      reserve.add('apres', 1)
      await tick(20)
      assert.equal(g.appels.length, 1, 'garde appelée une seule fois')
      assert.equal(erreurs(a.trames, depart).length, 1, 'le refus est annoncé')
      assert.deepEqual(duFlux(a.trames, depart), [], 'rien du flux')
    } finally {
      await app.stop()
    }
  })

  it('témoin : refus lu dans le salon, la connexion sortie puis revenue avant son arrivée — le refus compte', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const g = gardeTenue(app, true)
    const reserve = app.stream('reserve', { canSubscribe: g.garde })
    await app.listen()
    try {
      const a = await connexion(transport)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      const depart = a.trames.length
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      await g.rendre(0)
      await tick(50)
      reserve.add('apres', 1)
      await tick(20)
      assert.equal(g.appels.length, 1, 'garde appelée une seule fois')
      assert.equal(erreurs(a.trames, depart).length, 1, 'le refus est annoncé')
      assert.deepEqual(duFlux(a.trames, depart), [], 'rien du flux')
    } finally {
      await app.stop()
    }
  })
})
