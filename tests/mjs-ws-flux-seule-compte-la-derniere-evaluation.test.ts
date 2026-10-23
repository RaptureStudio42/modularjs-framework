// Gardes `canSubscribe` des flux : pour une connexion et un flux, seule compte la réponse de la dernière évaluation
// lancée, quel que soit l'ordre d'arrivée des réponses. Deux demandes d'une même connexion répondues dans l'ordre
// inverse : le « oui » de la plus ancienne, arrivé après le refus de la plus récente, abonnait la connexion (l'état puis
// chaque delta) ; arrivé le premier, il abonnait aussi, et un refus ancien arrivé le premier envoyait un µ:error à une
// connexion que la plus récente accepte. Même règle pour la garde posée après coup et pour la vérification au départ
// dépassées par une demande : leur réponse est ignorée, et la connexion ne reçoit plus rien du flux jusqu'à la dernière
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

// ce que la connexion a reçu depuis l'indice `depuis` : µ:error, et les trames du flux (`reset`, `add:clé`)
const recu = (trames: any[], depuis: number): string[] => trames.slice(depuis)
  .map(f => f.t === 'µ:error' ? 'µ:error' : f.t === 'reserve' ? f.p.op + (f.p.key ? ':' + f.p.key : '') : '')
  .filter(Boolean)

// garde pilotée : chaque appel prend la réponse suivante du plan — un booléen (garde synchrone), ou `null` (garde
// asynchrone, tranchée par le test dans l'ordre de son choix)
async function banc(plan: Array<boolean | null>) {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  const attentes: Array<(ok: boolean) => void> = []
  const reserve = app.stream('reserve', { canSubscribe: () => {
    const r: boolean | null = plan.length > 0 ? plan.shift() as boolean | null : true
    return r === null ? new Promise<boolean>(res => attentes.push(res)) : r
  } })
  await app.listen()
  const c = await connexion(transport)
  return { app, reserve, attentes, ...c }
}

describe('MJS-WS — flux : seule compte la réponse de la dernière évaluation lancée', function () {
  this.timeout(20000)

  for (const garde of ['asynchrone', 'synchrone'] as const) {
    it(`garde ${garde} pour la demande récente : le « oui » d’une demande ancienne arrivé après son refus — rien du flux`, async () => {
      const b = await banc([null, garde === 'asynchrone' ? null : false])
      try {
        b.reserve.add('avant', 1)
        const depart = b.trames.length
        b.envoyer('µ:resync', { stream: 'reserve', from: 0 }); await tick(10)
        b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
        if (garde === 'asynchrone') { b.attentes[1](false); await tick(10) }
        b.attentes[0](true); await tick(10)
        b.reserve.add('apres', 2); await tick(20)
        assert.deepEqual(recu(b.trames, depart), ['µ:error'], 'le refus récent seul : ni état, ni rejeu, ni delta')
      } finally {
        await b.app.stop()
      }
    })

    it(`garde ${garde} pour la demande récente : le refus d’une demande ancienne arrivé après son accord — abonnée, sans µ:error`, async () => {
      const b = await banc([null, garde === 'asynchrone' ? null : true])
      try {
        b.reserve.add('avant', 1)
        const depart = b.trames.length
        b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
        b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
        if (garde === 'asynchrone') { b.attentes[1](true); await tick(10) }
        b.attentes[0](false); await tick(10)
        b.reserve.add('apres', 2); await tick(20)
        assert.deepEqual(recu(b.trames, depart), ['reset', 'add:apres'])
      } finally {
        await b.app.stop()
      }
    })
  }

  it('« oui » de la demande ancienne arrivé le premier : rien du flux tant que la récente attend, puis son refus seul', async () => {
    const b = await banc([null, null])
    try {
      b.reserve.add('avant', 1)
      const depart = b.trames.length
      b.envoyer('µ:resync', { stream: 'reserve', from: 0 }); await tick(10)
      b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      b.attentes[0](true); await tick(10)
      b.reserve.add('pendant', 2); await tick(20)
      assert.deepEqual(recu(b.trames, depart), [], 'la demande récente attend : rien')
      b.attentes[1](false); await tick(10)
      b.reserve.add('apres', 3); await tick(20)
      assert.deepEqual(recu(b.trames, depart), ['µ:error'])
    } finally {
      await b.app.stop()
    }
  })

  it('refus de la demande ancienne arrivé le premier : ni µ:error ni retrait, la récente accepte', async () => {
    const b = await banc([null, null])
    try {
      const depart = b.trames.length
      b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      b.attentes[0](false); await tick(10)
      assert.deepEqual(recu(b.trames, depart), [], 'la demande récente attend : rien')
      b.attentes[1](true); await tick(10)
      b.reserve.add('apres', 1); await tick(20)
      assert.deepEqual(recu(b.trames, depart), ['reset', 'add:apres'])
    } finally {
      await b.app.stop()
    }
  })

  it('garde posée après coup dépassée par une demande : son refus ignoré, plus rien du flux jusqu’à la demande, qui accepte', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const reserve = app.stream('reserve', { public: true })
    await app.listen()
    try {
      const a = await connexion(transport)
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      const depart = a.trames.length
      const attentes: Array<(ok: boolean) => void> = []
      app.stream('reserve', { canSubscribe: () => new Promise<boolean>(res => attentes.push(res)) })
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      attentes[0](false); await tick(10)
      reserve.add('pendant', 1); await tick(20)
      assert.deepEqual(recu(a.trames, depart), [], 'la demande attend : ni µ:error ni delta')
      attentes[1](true); await tick(10)
      reserve.add('apres', 2); await tick(20)
      assert.deepEqual(recu(a.trames, depart), ['reset', 'add:apres'])
      const etat = a.trames.slice(depart).find(f => f.t === 'reserve')
      assert.deepEqual(Object.keys(etat.p.values), ['pendant'], 'l’état complet rend ce qui a été retenu')
    } finally {
      await app.stop()
    }
  })

  it('vérification au départ dépassée par une redemande : plus rien du flux dès la redemande, ni après le refus ignoré', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const attentes: Array<() => void> = []
    const reserve = app.stream('reserve', { canSubscribe: (c) => {
      const dedans = app.room('abonnes').has(c)
      return new Promise<boolean>(res => attentes.push(() => res(dedans)))
    } })
    await app.listen()
    try {
      const a = await connexion(transport)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      attentes[0](); await tick(10)
      assert.deepEqual(recu(a.trames, 0), ['reset'], 'abonnée')
      const depart = a.trames.length
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      assert.equal(attentes.length, 2, 'la garde est repassée au départ')
      a.envoyer('µ:resync', { stream: 'reserve', from: 0 }); await tick(10)
      reserve.add('pendant', 1); await tick(20)
      attentes[1](); await tick(10)
      reserve.add('entre', 2); await tick(20)
      attentes[2](); await tick(10)
      reserve.add('apres', 3); await tick(20)
      assert.deepEqual(recu(a.trames, depart), ['µ:error'], 'le refus de la redemande seul')
    } finally {
      await app.stop()
    }
  })

  it('redemande en attente, sortie puis retour dans le salon : toujours rien du flux avant sa réponse, puis le rejeu', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const attentes: Array<() => void> = []
    const reserve = app.stream('reserve', { canSubscribe: (c) => {
      const dedans = app.room('abonnes').has(c)
      return new Promise<boolean>(res => attentes.push(() => res(dedans)))
    } })
    await app.listen()
    try {
      const a = await connexion(transport)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      attentes[0](); await tick(10)
      const depart = a.trames.length
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:resync', { stream: 'reserve', from: 0 }); await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:leave', { room: 'abonnes' }); await tick(10)
      a.envoyer('µ:join', { room: 'abonnes' }); await tick(10)
      reserve.add('dedans', 1); await tick(20)
      assert.deepEqual(recu(a.trames, depart), [], 'revenue dans le salon, la redemande attend encore : rien')
      attentes[1](); await tick(10)
      attentes[2](); await tick(10)
      for (let i = 3; i < attentes.length; i++) { attentes[i](); await tick(10) }
      await tick(20)
      assert.deepEqual(recu(a.trames, depart), ['add:dedans'], 'la garde repassée accepte : le rejeu de ce qui a été retenu')
    } finally {
      await app.stop()
    }
  })
})
