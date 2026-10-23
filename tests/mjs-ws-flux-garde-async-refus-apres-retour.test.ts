// Garde `canSubscribe` ASYNCHRONE repassée quand la connexion quitte un salon : sa réponse « non » arrivait alors que la
// connexion était déjà revenue dans ce salon, et elle était jetée sans que la garde soit repassée — la connexion gardait le
// flux. Une garde qui refuse pour une autre raison (un deuxième salon quitté, un accès révoqué par un modérateur qui expulse
// puis voit revenir) était ainsi contournée. Une réponse jetée parce que la connexion est revenue relance la garde :
// l'abonnement ne tient que sur un « oui » de la vérification la plus récente
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

const CAS = [
  'aller-retour dans la partie, puis départ de l’équipe',
  'garde qui lit les salons avant d’attendre',
  'accès révoqué, expulsé puis revenu aussitôt',
] as const

async function essai(cas: typeof CAS[number]): Promise<{ delta: boolean; erreurs: number }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  const revoques = new Set<string>()
  const moderation = cas === CAS[2]
  // vérifie en base (40 ms), puis lit l'appartenance — ou lit d'abord, puis vérifie
  const garde = moderation ? async (c: any) => { await tick(40); return !revoques.has(c.id) && app.room('salon').has(c) }
    : cas === CAS[1] ? async (c: any) => { const ok = app.room('partie-42').has(c) && app.room('equipe-rouge').has(c); await tick(40); return ok }
    : async (c: any) => { await tick(40); return app.room('partie-42').has(c) && app.room('equipe-rouge').has(c) }
  const flux = app.stream('tactique', { canSubscribe: garde })
  await app.listen()
  try {
    const ws = transport.connect({ url: 'ws://joueur/' })
    const trames: any[] = []
    ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
    const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
    await tick()
    envoyer('µ:hello', { protocol: 1 })
    await tick(10)
    for (const salon of moderation ? ['salon'] : ['partie-42', 'equipe-rouge']) envoyer('µ:join', { room: salon })
    await tick(20)
    envoyer('µ:sub-stream', { stream: 'tactique' })
    await tick(80)
    assert.ok(trames.some(f => f.t === 'tactique' && f.p?.op === 'reset'), 'abonnée : instantané reçu')
    const client = Array.from(app.clients)[0] as any
    if (moderation) {
      revoques.add(client.id)
      app.room('salon').kick(client, 'modération')
      await tick(5)
      envoyer('µ:join', { room: 'salon' })
    }
    else {
      envoyer('µ:leave', { room: 'partie-42' })
      envoyer('µ:join', { room: 'partie-42' })
      envoyer('µ:leave', { room: 'equipe-rouge' })
    }
    await tick(200)
    assert.equal(await garde(client), false, 'la garde refuse maintenant cette connexion')
    const avant = trames.length
    flux.add('plan', { cible: 'nord' })
    await tick(30)
    return { delta: trames.slice(avant).some(f => f.t === 'tactique'), erreurs: trames.filter(f => f.t === 'µ:error').length }
  }
  finally {
    await app.stop()
  }
}

describe('MJS-WS — flux : garde asynchrone, réponse « non » arrivée après le retour dans le salon', function () {
  this.timeout(10000)

  for (const cas of CAS) {
    it(`${cas} : la garde est repassée, la connexion ne reçoit plus le flux et le sait`, async () => {
      const { delta, erreurs } = await essai(cas)
      assert.equal(delta, false, 'delta du flux reçu après le refus')
      assert.equal(erreurs, 1, 'un µ:error pour le refus')
    })
  }
})
