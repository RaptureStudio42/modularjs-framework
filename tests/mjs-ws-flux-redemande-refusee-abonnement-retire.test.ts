// Gardes `canSubscribe` des flux : une connexion déjà abonnée qui redemande le flux (µ:sub-stream, µ:resync) et que la
// garde refuse recevait son µ:error mais restait abonnée — chaque delta suivant lui parvenait, et une vérification au
// départ encore en vol lui rejouait ensuite ce qu'elle avait manqué. Un refus frais retire l'abonnement : le µ:error, puis
// plus rien du flux, ni delta ni rejeu ; le refus d'une demande dépassée par un accord plus récent, lui, est ignoré
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
const duFlux  = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'reserve')
const erreurs = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'µ:error')

const DEMANDES: Array<{ nom: string; trame: [string, unknown] }> = [
  { nom: 'µ:sub-stream', trame: ['µ:sub-stream', { stream: 'reserve' }] },
  { nom: 'µ:resync',     trame: ['µ:resync', { stream: 'reserve', from: 0 }] },
]

const GARDES: Array<{ nom: string; garde: (refuser: () => boolean) => () => boolean | Promise<boolean> }> = [
  { nom: 'synchrone',  garde: (refuser) => () => !refuser() },
  { nom: 'asynchrone', garde: (refuser) => async () => { await tick(20); return !refuser() } },
]

describe('MJS-WS — flux : redemande refusée d’une connexion abonnée', function () {
  this.timeout(20000)

  for (const garde of GARDES) for (const demande of DEMANDES) {
    it(`garde ${garde.nom}, ${demande.nom} refusé : le µ:error, puis plus aucun delta`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      let refuser = false
      const reserve = app.stream('reserve', { canSubscribe: garde.garde(() => refuser) })
      await app.listen()
      try {
        const a = await abonne(transport, [])
        a.envoyer('µ:sub-stream', { stream: 'reserve' })
        await tick(50)
        reserve.add('avant', 1)
        await tick(10)
        assert.deepEqual(duFlux(a.trames, 0).map(f => f.p.op), ['reset', 'add'], 'abonnée : l’état complet, puis le delta')
        // accès retiré : la redemande est refusée
        refuser = true
        const depart = a.trames.length
        a.envoyer(...demande.trame)
        await tick(50)
        reserve.add('apres', 2)
        await tick(20)
        assert.equal(erreurs(a.trames, depart).length, 1, 'le refus est annoncé')
        assert.deepEqual(duFlux(a.trames, depart), [], 'plus rien du flux après le refus')
      } finally {
        await app.stop()
      }
    })
  }

  it('refus d’une demande arrivé après l’accord d’une demande plus récente : dépassé, il est ignoré, l’abonnement tient', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const appels: Array<(ok: boolean) => void> = []
    const reserve = app.stream('reserve', { canSubscribe: () => new Promise<boolean>(r => appels.push(r)) })
    await app.listen()
    try {
      const a = await abonne(transport, [])
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      const depart = a.trames.length
      // la plus récente accepte d'abord, la plus ancienne refuse ensuite
      appels[1](true); await tick(10)
      appels[0](false); await tick(10)
      reserve.add('apres', 1)
      await tick(20)
      assert.deepEqual(erreurs(a.trames, depart), [], 'aucun µ:error')
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p.op), ['reset', 'add'], 'l’état complet, puis le delta')
    } finally {
      await app.stop()
    }
  })

  for (const demande of DEMANDES) {
    it(`${demande.nom} refusé pendant une vérification au départ : rien n’est rejoué quand elle accepte`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      // chaque réponse de la garde est rendue à la main : la redemande refusée, la vérification au départ acceptée
      const appels: Array<(ok: boolean) => void> = []
      const reserve = app.stream('reserve', { canSubscribe: (c) => {
        app.room('abonnes').has(c)
        return new Promise<boolean>(r => appels.push(r))
      } })
      const rendre = async (i: number, ok: boolean) => { appels[i]?.(ok); await tick(10) }
      await app.listen()
      try {
        const a = await abonne(transport, ['abonnes'])
        a.envoyer('µ:sub-stream', { stream: 'reserve' })
        await tick(10)
        await rendre(0, true)
        reserve.add('avant', 1)
        await tick(10)
        // départ : la vérification est en vol ; un second départ pendant elle retient la connexion
        a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
        a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
        a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
        reserve.add('pendant', 2)
        await tick(10)
        const depart = a.trames.length
        a.envoyer(...demande.trame)
        await tick(10)
        await rendre(2, false)
        // la vérification au départ accepte, puis celle qui la suit
        await rendre(1, true)
        await rendre(3, true)
        reserve.add('apres', 3)
        await tick(20)
        assert.equal(erreurs(a.trames, depart).length, 1, 'le refus est annoncé')
        assert.deepEqual(duFlux(a.trames, depart), [], 'ni rejeu ni delta après le refus')
      } finally {
        await app.stop()
      }
    })
  }
})
