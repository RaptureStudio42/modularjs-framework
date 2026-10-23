// Garde `canSubscribe` posée après coup sur un flux déjà suivi (seconde déclaration `app.stream(nom, { canSubscribe })`) :
// les connexions déjà abonnées la repassent. Asynchrone et lente (base, back), elle lit l'appartenance au salon AVANT
// d'attendre ; la connexion quitte ce salon pendant l'attente. Le « oui », lu avant le départ, gardait l'abonnement :
// sortie du salon, la connexion recevait encore chaque delta. Comme à un abonnement demandé, ce « oui » ne compte plus :
// la garde est repassée, au même rythme, et la connexion sortie ne reçoit plus rien du flux (un µ:error, comme tout refus)
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

// flux public suivi, puis garde lente posée : l'appartenance est lue tout de suite, la réponse vient 100 ms plus tard
async function scenario(quitte: string, revient = false): Promise<{ recu: any[]; erreurs: any[]; appels: number }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  let appels = 0
  const reserve = app.stream('reserve', { public: true })
  await app.listen()
  try {
    reserve.add('avant', 1)
    const a = await abonne(transport, ['abonnes', 'autre'])
    a.envoyer('µ:sub-stream', { stream: 'reserve' })
    await tick(20)
    app.stream('reserve', { canSubscribe: async (c) => { appels++; const dedans = app.room('abonnes').has(c); await tick(100); return dedans } })
    await tick(20)
    const depart = a.trames.length
    a.envoyer('µ:leave', { room: quitte })
    if (revient) {
      await tick(20)
      a.envoyer('µ:join', { room: quitte })
    }
    await tick(400)
    reserve.add('apres', 2)
    await tick(30)
    const apres = a.trames.slice(depart)
    return { recu: apres.filter(f => f.t === 'reserve'), erreurs: apres.filter(f => f.t === 'µ:error'), appels }
  } finally {
    await app.stop()
  }
}

describe('MJS-WS — flux : garde posée après coup, départ d’un salon qu’elle a lu pendant son attente', function () {
  this.timeout(10000)

  it('sortie du salon : plus aucun delta pour la connexion, un µ:error', async () => {
    const { recu, erreurs, appels } = await scenario('abonnes')
    assert.deepEqual(recu, [], 'sortie du salon pendant la garde : plus rien du flux')
    assert.equal(erreurs.length, 1, 'un refus annoncé, jamais un silence')
    assert.equal(appels, 2, 'la garde est repassée une fois')
  })

  it('revenue dans le salon avant la réponse : la garde repassée l’accepte, état complet puis deltas', async () => {
    const { recu, erreurs, appels } = await scenario('abonnes', true)
    assert.deepEqual(recu.map(f => f.p), [{ op: 'reset', values: { avant: 1 } }, { op: 'add', key: 'apres', value: 2 }], 'l’état complet puis le delta')
    assert.deepEqual(erreurs, [], 'aucun µ:error')
    assert.equal(appels, 2, 'la garde est repassée une fois')
  })

  it('départ d’un salon que la garde n’a pas lu : son « oui » tient, une seule garde', async () => {
    const { recu, erreurs, appels } = await scenario('autre')
    assert.deepEqual(recu.map(f => f.p), [{ op: 'add', key: 'apres', value: 2 }], 'le delta, sans nouvel état complet')
    assert.deepEqual(erreurs, [], 'aucun µ:error')
    assert.equal(appels, 1, 'la garde n’est pas repassée')
  })
})
