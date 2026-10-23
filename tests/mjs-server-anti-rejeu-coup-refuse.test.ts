// Anti-rejeu (def.antiReplay) et cadence (limits.moveIntervalMs) : le numéro de séquence et l'heure d'un coup s'enregistraient avant
// les autres refus (débit limits.moves, nom de coup inconnu, cadence). Un coup refusé pour débit consommait donc son numéro : sa
// reprise légitime était rejetée comme « rejeu », comptée comme suspecte et remontée à onSuspicion (que l'appli peut utiliser pour
// bannir). Numéro et heure ne s'enregistrent plus qu'une fois le coup accepté.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

function essai(fn: () => unknown): string | null {
  try { fn(); return null } catch (err: any) { return err.message }
}

function partie(extra: any, evenements: any[]): { game: any; A: any } {
  const def  = resolveGameDef('rejeu', { seats: 1, state: () => ({ n: 0 }), moves: { inc: (g: any) => { g.state.n++ } }, antiReplay: true, onSuspicion: (e: any) => evenements.push(e), ...extra })
  const game = createGame({ send() {} } as any, def, () => {}, 'g1')
  const A    = fakeClient('A')
  game._createSeat(A)
  return { game, A }
}

describe('anti-rejeu — un coup refusé ne consomme pas son numéro', () => {
  it('refus pour débit : la reprise du même numéro passe, rien de suspect', async () => {
    const evenements: any[] = []
    const { game, A } = partie({ limits: { moves: [1, 200] } }, evenements)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 1 })), null)
    assert.match(String(essai(() => game._onMove(A, 'inc', { _s: 2 }))), /trop de coups|too many/)
    await tick(300)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 2 })), null)
    assert.deepEqual(evenements, [])
    assert.equal(game.state.n, 2)
    game._destroy()
  })

  it('refus pour nom de coup inconnu : la reprise du même numéro passe', () => {
    const evenements: any[] = []
    const { game, A } = partie({}, evenements)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 1 })), null)
    assert.notEqual(essai(() => game._onMove(A, 'icn', { _s: 2 })), null)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 2 })), null)
    assert.deepEqual(evenements, [])
    game._destroy()
  })

  it('refus pour cadence : la reprise du même numéro passe une fois la cadence respectée', async () => {
    const evenements: any[] = []
    const { game, A } = partie({ limits: { moveIntervalMs: 150 } }, evenements)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 1 })), null)
    assert.notEqual(essai(() => game._onMove(A, 'inc', { _s: 2 })), null)
    await tick(200)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 2 })), null)
    assert.deepEqual(evenements.map(e => e.reason), ['rate'])
    game._destroy()
  })

  it('un vrai rejeu reste refusé (non-régression)', () => {
    const evenements: any[] = []
    const { game, A } = partie({}, evenements)
    assert.equal(essai(() => game._onMove(A, 'inc', { _s: 1 })), null)
    assert.match(String(essai(() => game._onMove(A, 'inc', { _s: 1 }))), /rejeu|replay/)
    assert.deepEqual(evenements.map(e => e.reason), ['rejeu'])
    game._destroy()
  })
})
