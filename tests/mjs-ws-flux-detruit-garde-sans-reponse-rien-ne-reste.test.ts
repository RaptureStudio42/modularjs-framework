// Flux détruit (`destroy()`) pendant une garde `canSubscribe` dont la promesse ne se règle jamais (appel au back
// abandonné, que personne ne tient) : le moteur gardait la demande et l'évaluation en attente, et avec elles l'état
// complet du flux détruit, tant que la connexion vivait. La destruction les libère aussi
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

describe('MJS-WS — flux détruit pendant une garde qui ne répond jamais : rien ne reste', function () {
  this.timeout(20000)

  for (const demande of ['µ:sub-stream', 'µ:resync'] as const) {
    it(`${demande} en attente : destroy() libère l’état du flux, connexion vivante`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      await app.listen()
      // le flux et sa valeur ne sont tenus que par le serveur : seule la référence faible reste ici
      const pris: { valeur?: WeakRef<object>; detruire?: () => void } = {}
      ;(() => {
        const valeur = { charge: new Array(100000).fill(7) }
        const partie = app.stream('partie', { canSubscribe: () => new Promise<boolean>(() => {}) })   // appel au back abandonné
        partie.add('plateau', valeur)
        pris.valeur   = new WeakRef(valeur)
        pris.detruire = () => partie.destroy()
      })()
      try {
        const ws = transport.connect({ url: 'ws://joueur/' })
        ws.onmessage = () => {}
        await tick()
        ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
        await tick(10)
        ws.send(JSON.stringify({ t: demande, p: demande === 'µ:resync' ? { stream: 'partie', from: 0 } : { stream: 'partie' } }))
        await tick(10)
        pris.detruire!()
        delete pris.detruire
        await tick(10)
        gc()
        await tick()
        gc()
        assert.ok(pris.valeur!.deref() === undefined, 'l’état du flux détruit est libéré')   // sans la valeur dans le message d’échec
      } finally {
        await app.stop()
      }
    })
  }
})
