// Garde qui exige d'être HORS d'un salon (spectateurs seulement : dans « tribune » et pas dans « joueurs »). La connexion
// abonnée qui entrait dans « joueurs » gardait le flux : la garde n'était repassée qu'au départ d'un salon, jamais à
// l'entrée dans un salon qu'elle avait lu en son absence. L'entrée la repasse désormais, au même rythme qu'un départ, et
// rien du flux ne part vers la connexion jusqu'à sa réponse : refusée, elle reçoit un µ:error ; acceptée, ce qu'elle a manqué
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function connexion(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://spectateur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  return { trames, envoyer }
}

const recu = (trames: any[], depuis: number): string[] => trames.slice(depuis).filter(f => f.t === 'mains' || f.t === 'µ:error').map(f => f.t === 'µ:error' ? 'µ:error' : f.p.op + (f.p.key ? ':' + f.p.key : ''))

describe('MJS-WS — garde repassée à l’entrée dans un salon lu en l’absence de la connexion', function () {
  this.timeout(10000)

  it('garde synchrone : la connexion qui entre dans « joueurs » perd le flux, et le sait', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    let appels = 0
    const mains = app.stream('mains', { canSubscribe: (c) => { appels++; return app.room('tribune').has(c) && !app.room('joueurs').has(c) } })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:join', { room: 'tribune' }); await tick(10)
      c.envoyer('µ:sub-stream', { stream: 'mains' }); await tick(10)
      mains.add('avant', 1); await tick(10)
      assert.deepEqual(recu(c.trames, 0), ['reset', 'add:avant'])
      const d = c.trames.length
      c.envoyer('µ:join', { room: 'joueurs' }); await tick(10)
      mains.add('main-adverse', 2); await tick(10)
      assert.deepEqual(recu(c.trames, d), ['µ:error'], 'plus rien du flux, et le refus est annoncé')
      assert.equal(appels, 2, 'la garde est repassée à l’entrée')
    } finally {
      await app.stop()
    }
  })

  for (const reponse of [false, true]) {
    it(`garde asynchrone : rien ne part jusqu’à sa réponse, puis ${reponse ? 'ce qui a été retenu' : 'le µ:error seul'}`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const attentes: Array<(ok: boolean) => void> = []
      let appels = 0
      // la première évaluation suit le droit ; la réponse de la garde repassée à l'entrée est tenue par le test
      const mains = app.stream('mains', { canSubscribe: (c) => {
        appels++
        const ok = app.room('tribune').has(c) && !app.room('joueurs').has(c)
        return appels === 1 ? Promise.resolve(ok) : new Promise<boolean>(r => attentes.push(r))
      } })
      await app.listen()
      try {
        const c = await connexion(transport)
        c.envoyer('µ:join', { room: 'tribune' }); await tick(10)
        c.envoyer('µ:sub-stream', { stream: 'mains' }); await tick(10)
        assert.deepEqual(recu(c.trames, 0), ['reset'])
        const d = c.trames.length
        c.envoyer('µ:join', { room: 'joueurs' }); await tick(10)
        mains.add('pendant', 1); await tick(10)
        assert.deepEqual(recu(c.trames, d), [], 'retenue jusqu’à la réponse')
        assert.equal(attentes.length, 1, 'la garde est repassée à l’entrée')
        attentes[0](reponse); await tick(10)
        mains.add('apres', 2); await tick(10)
        assert.deepEqual(recu(c.trames, d), reponse ? ['add:pendant', 'add:apres'] : ['µ:error'])
      } finally {
        await app.stop()
      }
    })
  }
})
