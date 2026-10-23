// Garde qui lit l'utilisateur (son rôle) : un µ:refresh accepté qui changeait l'identité (même utilisateur, rôle retiré)
// laissait la connexion abonnée sans repasser la garde — elle recevait la suite du flux sans droit. Après un refresh qui
// change l'identité, la garde des flux que la connexion suit est repassée, au même rythme qu'au départ d'un salon, et rien
// du flux ne part jusqu'à sa réponse : refusée, la connexion reçoit un µ:error ; acceptée, ce qu'elle a manqué. Un
// refresh qui ne change rien (jeton renouvelé, même identité) ne la rappelle pas
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function connexion(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p: unknown, id?: string) => void }> {
  const ws = transport.connect({ url: 'ws://staff/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown, id?: string) => ws.send(JSON.stringify(id ? { t, p, id } : { t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1, role: 'admin', equipe: 'bleue' })
  await tick(10)
  return { trames, envoyer }
}

const recu = (trames: any[], depuis: number): string[] => trames.slice(depuis).filter(f => f.t === 'coulisses' || f.t === 'µ:error').map(f => f.t === 'µ:error' ? 'µ:error' : f.p.op + (f.p.key ? ':' + f.p.key : ''))
const auth = (p: any) => ({ id: 'u1', role: p?.role ?? 'visiteur', equipe: p?.equipe ?? null })

describe('MJS-WS — garde de flux repassée après un µ:refresh qui change l’identité', function () {
  this.timeout(10000)

  it('garde synchrone : rôle retiré, la connexion perd le flux et le sait ; un refresh identique ne rappelle pas la garde', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, auth })
    let appels = 0
    const coulisses = app.stream('coulisses', { canSubscribe: (c: any) => { appels++; return c.identity?.role === 'admin' && app.room('staff').has(c) } })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:join', { room: 'staff' }); await tick(10)
      c.envoyer('µ:sub-stream', { stream: 'coulisses' }); await tick(10)
      c.envoyer('µ:refresh', { role: 'admin', equipe: 'bleue' }, 'r1'); await tick(20)   // jeton renouvelé, même identité
      coulisses.add('avant', 1); await tick(10)
      assert.deepEqual(recu(c.trames, 0), ['reset', 'add:avant'])
      assert.equal(appels, 1, 'un refresh qui ne change rien ne rappelle pas la garde')
      const d = c.trames.length
      c.envoyer('µ:refresh', { role: 'visiteur', equipe: 'bleue' }, 'r2'); await tick(20)   // rôle retiré, même utilisateur
      coulisses.add('plan-secret', 2); await tick(10)
      assert.deepEqual(recu(c.trames, d), ['µ:error'], 'plus rien du flux, et le refus est annoncé')
      assert.equal(appels, 2, 'la garde est repassée après le refresh')
    } finally {
      await app.stop()
    }
  })

  it('garde asynchrone : rien ne part jusqu’à sa réponse, puis ce qui a été retenu', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, auth })
    const attentes: Array<(ok: boolean) => void> = []
    let appels = 0
    const coulisses = app.stream('coulisses', { canSubscribe: (c: any) => {
      appels++
      const ok = c.identity?.role === 'admin'
      return appels === 1 ? Promise.resolve(ok) : new Promise<boolean>(r => attentes.push(r))
    } })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:sub-stream', { stream: 'coulisses' }); await tick(10)
      assert.deepEqual(recu(c.trames, 0), ['reset'])
      const d = c.trames.length
      c.envoyer('µ:refresh', { role: 'admin', equipe: 'rouge' }, 'r1'); await tick(20)   // autre équipe : identité changée
      coulisses.add('pendant', 1); await tick(10)
      assert.equal(attentes.length, 1, 'la garde est repassée après le refresh')
      assert.deepEqual(recu(c.trames, d), [], 'retenue jusqu’à la réponse')
      attentes[0](true); await tick(10)
      coulisses.add('apres', 2); await tick(10)
      assert.deepEqual(recu(c.trames, d), ['add:pendant', 'add:apres'])
    } finally {
      await app.stop()
    }
  })
})
