// Flux détruit (`destroy()`) pendant qu'une garde `canSubscribe` asynchrone décide pour une connexion. Le « oui » arrivé
// après la destruction abonnait quand même la connexion au flux détruit : elle recevait son état complet (ou son rejeu),
// et l'état entier restait en mémoire jusqu'à sa déconnexion. Une garde repassée qui attendait son jeton gardait de même
// son attente, rattachée à l'ancien flux : l'état restait en mémoire, et l'attente finie envoyait encore un état vide.
// La destruction libère tout ce qui concerne le flux ; une réponse arrivée après elle n'est plus appliquée
import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

// ramasse-miettes complet sans lancer node avec --expose-gc : le drapeau n'est levé que le temps de prendre la fonction
v8.setFlagsFromString('--expose-gc')
const gc: () => void = vm.runInNewContext('gc')
v8.setFlagsFromString('--no-expose-gc')

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

const duFlux = (trames: any[], depuis: number): any[] => trames.slice(depuis).filter(f => f.t === 'reserve')

describe('MJS-WS — flux détruit pendant la garde : rien ne reste', function () {
  this.timeout(20000)

  for (const demande of ['µ:sub-stream', 'µ:resync'] as const) {
    it(`${demande} dont la garde répond après destroy() : rien n’est envoyé`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const reserve = app.stream('reserve', { canSubscribe: async () => { await tick(100); return true } })
      reserve.add('avant', 1)
      await app.listen()
      try {
        const a = await abonne(transport, [])
        a.envoyer(demande, demande === 'µ:resync' ? { stream: 'reserve', from: 0 } : { stream: 'reserve' })
        await tick(20)
        const depart = a.trames.length
        reserve.destroy()
        await tick(200)
        assert.deepEqual(duFlux(a.trames, depart).map(f => f.p), [], 'flux détruit : ni état complet ni rejeu')
      } finally {
        await app.stop()
      }
    })
  }

  it('garde repassée qui attend son jeton : destroy() la libère avec l’état du flux, rien n’est envoyé ensuite', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    // le flux et sa valeur ne sont tenus que par le serveur : seule la référence faible reste ici
    const pris: { valeur?: WeakRef<object>; detruire?: () => void } = {}
    ;(() => {
      const valeur  = { charge: new Array(100000).fill(7) }
      const reserve = app.stream('reserve', { canSubscribe: async (c) => { const dedans = app.room('abonnes').has(c); await tick(60); return dedans } })
      reserve.add('valeur', valeur)
      pris.valeur   = new WeakRef(valeur)
      pris.detruire = () => reserve.destroy()
    })()
    await app.listen()
    try {
      const a = await abonne(transport, [])
      // trois demandes lues dans le salon, chacune suivie d'un départ avant la réponse : la garde est repassée, deux fois
      // tout de suite (jetons d'avance), puis la troisième attend son jeton
      for (let i = 0; i < 3; i++) {
        a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
        a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(20)
        a.envoyer('µ:leave', { room: 'abonnes' }); await tick(i < 2 ? 150 : 60)
      }
      const depart = a.trames.length
      pris.detruire!()
      delete pris.detruire
      await tick(1500)
      assert.deepEqual(duFlux(a.trames, depart).map(f => f.p), [], 'flux détruit : rien n’est envoyé')
      gc()
      await tick()
      gc()
      assert.ok(pris.valeur!.deref() === undefined, 'l’état du flux détruit est libéré')   // sans la valeur dans le message d’échec
    } finally {
      await app.stop()
    }
  })
})
