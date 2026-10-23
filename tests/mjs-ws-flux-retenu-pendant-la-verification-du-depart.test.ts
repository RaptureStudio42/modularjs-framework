// Départ d'un salon lu par une garde asynchrone : les deltas passaient le temps que la garde décide (la vérification du
// départ), si bien qu'une connexion refusée au bout du compte recevait encore le flux en attendant la réponse. La connexion
// est désormais retenue jusqu'à la réponse : un « oui » lui rend ce qu'elle a manqué, un « non » la désabonne sans
// qu'elle ait rien reçu entre-temps
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

const recu = (trames: any[], depuis: number): string[] => trames.slice(depuis).filter(f => f.t === 'tableau' || f.t === 'µ:error').map(f => f.t === 'µ:error' ? 'µ:error' : f.p.op + (f.p.key ? ':' + f.p.key : ''))

describe('MJS-WS — départ d’un salon lu par la garde : retenue jusqu’à la réponse de la vérification', function () {
  this.timeout(10000)

  for (const reponse of [true, false]) {
    it(`garde asynchrone qui répond ${reponse ? '« oui »' : '« non »'} : rien ne part avant sa réponse`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const attentes: Array<(ok: boolean) => void> = []
      let appels = 0
      // la première évaluation suit le droit ; la réponse de la vérification du départ est tenue par le test
      const tableau = app.stream('tableau', { canSubscribe: (c) => {
        appels++
        const ok = app.room('salle').has(c)
        return appels === 1 ? Promise.resolve(ok) : new Promise<boolean>(r => attentes.push(r))
      } })
      await app.listen()
      try {
        const c = await connexion(transport)
        c.envoyer('µ:join', { room: 'salle' }); await tick(10)
        c.envoyer('µ:sub-stream', { stream: 'tableau' }); await tick(10)
        tableau.add('avant', 1); await tick(10)
        assert.deepEqual(recu(c.trames, 0), ['reset', 'add:avant'])
        const d = c.trames.length
        c.envoyer('µ:leave', { room: 'salle' }); await tick(10)
        tableau.add('pendant', 2); await tick(10)
        assert.equal(attentes.length, 1, 'la garde est repassée au départ')
        assert.deepEqual(recu(c.trames, d), [], 'retenue le temps de la vérification')
        attentes[0](reponse); await tick(10)
        tableau.add('apres', 3); await tick(10)
        assert.deepEqual(recu(c.trames, d), reponse ? ['add:pendant', 'add:apres'] : [], reponse ? 'ce qui a été retenu, puis la suite' : 'désabonnée en silence, rien reçu')
      } finally {
        await app.stop()
      }
    })
  }
})
