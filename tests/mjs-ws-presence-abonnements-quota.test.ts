// rooms.ts — les abonnements de présence (µ:sub-presence) doivent être plafonnés PAR CLIENT, comme
// les adhésions de salon (maxRoomsPerClient) : sans quoi un même client peut s'abonner à la présence
// d'un nombre illimité de salons à noms arbitraires, jamais rejoints — fuite mémoire.
import assert from 'node:assert/strict'
import { createRoomsEngine } from '../src/mjs-ws/rooms.js'
import type { MjsWsClient } from '../src/mjs-ws/core.js'

function fakeClient(id: string): MjsWsClient {
  return { id, identity: undefined, latency: null, meta: {} as any, send() {}, close() {} }
}

describe('MJS-WS — rooms.ts, plafond d\'abonnements de présence par client', () => {
  it('défaut = maxRoomsPerClient : au-delà, µ:sub-presence est refusé (µ:error), la connexion reste ouverte', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({ maxRoomsPerClient: 1 } as any, (c, f) => sent.push({ c, f }), () => {})
    const c1 = fakeClient('c1')

    await engine.handleSubPresence(c1, 'salon-1')
    await engine.handleSubPresence(c1, 'salon-2')   // au-delà du plafond (1) → refusé

    const errs = sent.filter(x => x.f?.t === 'µ:error')
    assert.equal(errs.length, 1, 'le 2e abonnement est refusé — même plafond que maxRoomsPerClient par défaut')
    const stats = engine.statsSnapshot()
    assert.equal(stats.abonnesPresence, 1, 'un seul abonnement de présence effectif, pas 100')
  })

  it('ré-abonnement au MÊME salon : jamais compté deux fois, jamais refusé', async () => {
    const engine = createRoomsEngine({ maxRoomsPerClient: 1 } as any, () => {}, () => {})
    const c1 = fakeClient('c1')
    await engine.handleSubPresence(c1, 'salon-1')
    await engine.handleSubPresence(c1, 'salon-1')   // même salon — idempotent
    const stats = engine.statsSnapshot()
    assert.equal(stats.abonnesPresence, 1)
  })

  it('option dédiée maxPresencePerClient : plafond INDÉPENDANT de maxRoomsPerClient quand fourni', async () => {
    const engine = createRoomsEngine({ maxRoomsPerClient: 1, maxPresencePerClient: 3 } as any, () => {}, () => {})
    const c1 = fakeClient('c1')
    await engine.handleSubPresence(c1, 's1')
    await engine.handleSubPresence(c1, 's2')
    await engine.handleSubPresence(c1, 's3')
    assert.equal(engine.statsSnapshot().abonnesPresence, 3, 'les 3 premiers passent — plafond dédié, pas celui des salons (1)')
    await engine.handleSubPresence(c1, 's4')
    assert.equal(engine.statsSnapshot().abonnesPresence, 3, 'le 4e est refusé')
  })

  it('maxPresencePerClient: null EXPLICITE → illimité, même si maxRoomsPerClient est borné', async () => {
    const engine = createRoomsEngine({ maxRoomsPerClient: 1, maxPresencePerClient: null } as any, () => {}, () => {})
    const c1 = fakeClient('c1')
    for (let i = 0; i < 20; i++) await engine.handleSubPresence(c1, 'salon-' + i)
    assert.equal(engine.statsSnapshot().abonnesPresence, 20, 'illimité explicite — aucun refus')
  })

  it('présence GLOBALE (room absent) : jamais concernée par ce plafond', async () => {
    const engine = createRoomsEngine({ maxRoomsPerClient: 0 } as any, () => {}, () => {})
    const c1 = fakeClient('c1')
    await engine.handleSubPresence(c1, undefined)
    assert.equal(engine.statsSnapshot().abonnesPresence, 1, 'présence globale jamais bloquée par le plafond de salons')
  })

  it('maxPresencePerClient: 0 refuse dès le TOUT PREMIER abonnement de salon, comme le plafond frère', async () => {
    const sent: any[] = []
    const engine = createRoomsEngine({ maxPresencePerClient: 0 } as any, (c, f) => sent.push({ c, f }), () => {})
    const c1 = fakeClient('c1')
    await engine.handleSubPresence(c1, 'salon-1')
    const errs = sent.filter(x => x.f?.t === 'µ:error')
    assert.equal(errs.length, 1, '0 doit refuser même quand aucun abonnement n\'existe encore (dejaSuivis undefined)')
    assert.equal(engine.statsSnapshot().abonnesPresence, 0)
  })
})
