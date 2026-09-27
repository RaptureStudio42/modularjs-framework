// game.ts::restoreGame — un instantané de forme invalide est refusé avec une erreur claire, sans
// construire de partie à moitié restaurée ; une restauration normale réarme la garde emptyTtl pour
// des sièges déconnectés (cas normal juste après un redémarrage), et restaure _started ainsi que
// la fenêtre de confirmation (_unconfirmedSeats).
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('restoreGame — validation de forme + réarmement complet', () => {
  it('journal absent (forme invalide) → erreur claire, aucune partie construite', () => {
    const def = resolveGameDef('rv1', { seats: 1, state: () => ({}), moves: {} })
    const casse: any = { id: 'rv1g', type: 'rv1', code: null, state: {}, phase: null, turn: null, seq: 0, seats: [], timers: [] }
    assert.throws(() => restoreGame(fakeApp(), def, () => {}, casse), /journal/i)
  })

  it('siège de forme invalide (id manquant) → erreur claire', () => {
    const def = resolveGameDef('rv2', { seats: 1, state: () => ({}), moves: {} })
    const casse: any = { id: 'rv2g', type: 'rv2', code: null, state: {}, phase: null, turn: null, seq: 0, journal: [], seats: [{ seat: 0 }], timers: [] }
    assert.throws(() => restoreGame(fakeApp(), def, () => {}, casse), /seats/i)
  })

  it('minuterie de forme invalide (at manquant) → erreur claire', () => {
    const def = resolveGameDef('rv2b', { seats: 1, state: () => ({}), moves: {} })
    const casse: any = { id: 'rv2bg', type: 'rv2b', code: null, state: {}, phase: null, turn: null, seq: 0, journal: [], seats: [], timers: [{ name: 'x' }] }
    assert.throws(() => restoreGame(fakeApp(), def, () => {}, casse), /timers/i)
  })

  it('id vide → erreur claire (jamais une TypeError cryptique plus bas)', () => {
    const def = resolveGameDef('rv2c', { seats: 1, state: () => ({}), moves: {} })
    const casse: any = { id: '', type: 'rv2c', code: null, state: {}, phase: null, turn: null, seq: 0, journal: [], seats: [], timers: [] }
    assert.throws(() => restoreGame(fakeApp(), def, () => {}, casse), /id/i)
  })

  it('une partie restaurée SANS aucun siège connecté (cas normal juste après un redémarrage) réarme elle-même la garde emptyTtl', () => {
    const def = resolveGameDef('rv3', { seats: 1, state: () => ({ n: 0 }), moves: {} })
    const game = createGame(fakeApp(), def, () => {}, 'rv3g')
    const client = fakeClient('p1')
    game._createSeat(client)
    const snap = game.serialize()
    const json = JSON.parse(JSON.stringify(snap))
    assert.equal(json.timers.some((t: any) => t.name === 'µempty'), false, 'sanity : encore connectée au moment du serialize, µempty pas armée')
    game._destroy()

    const restored = restoreGame(fakeApp(), def, () => {}, json)
    assert.equal(restored._timers.has('µempty'), true, 'sans ce réarmement, une partie restaurée sans personne de connecté resterait en mémoire indéfiniment')
    restored._destroy()
  })

  it('une partie restaurée déjà EN GRÂCE (µempty sauvegardée) conserve son délai RESTANT, pas un TTL complet neuf', () => {
    const def = resolveGameDef('rv3b', { seats: 1, state: () => ({}), moves: {}, emptyTtl: 60000 })
    const game = createGame(fakeApp(), def, () => {}, 'rv3bg')
    game._armByName('µempty', 5000)   // simule une grâce déjà bien entamée AVANT la sauvegarde
    const snap = game.serialize()
    const json = JSON.parse(JSON.stringify(snap))
    const savedAt = json.timers.find((t: any) => t.name === 'µempty').at
    game._destroy()

    const restored = restoreGame(fakeApp(), def, () => {}, json)
    const restoredAt = restored._timers.get('µempty')!.at
    assert.ok(restoredAt <= savedAt + 50, 'le délai RESTANT sauvegardé doit gagner, pas un TTL complet de 60000ms réarmé par erreur')
    restored._destroy()
  })

  it('_started et la fenêtre de confirmation (_unconfirmedSeats) sont restaurés — une échéance après restauration annule encore la partie', () => {
    const def = resolveGameDef('rv4', { seats: 2, state: () => ({}), moves: {} })
    const game = createGame(fakeApp(), def, () => {}, 'rv4g')
    game._started = true
    game._armConfirmWindow(['p1'], 5000)
    const snap = game.serialize()
    const json = JSON.parse(JSON.stringify(snap))
    assert.equal(json.started, true)
    assert.deepEqual(json.unconfirmedSeats, ['p1'])
    game._destroy()

    let detruite = false
    const restored = restoreGame(fakeApp(), def, () => { detruite = true }, json)
    assert.equal(restored._started, true)
    assert.deepEqual(restored._unconfirmedSeats, new Set(['p1']))

    restored._onMatchExpired()   // simule l’échéance de µmatch sans attendre le vrai délai
    assert.equal(detruite, true, 'sans _unconfirmedSeats restauré, cette échéance aurait été un no-op silencieux')
  })

  it('une restauration normale (aller-retour serialize/restoreGame déjà couvert ailleurs) reste acceptée par la validation (non-régression)', () => {
    const def = resolveGameDef('rv5', { seats: 1, state: () => ({ n: 0 }), moves: { inc: (g: any) => { g.state.n++ } } })
    const game = createGame(fakeApp(), def, () => {}, 'rv5g')
    const client = fakeClient('p1')
    game._createSeat(client)
    game._onMove(client, 'inc', {})
    const json = JSON.parse(JSON.stringify(game.serialize()))
    game._destroy()
    assert.doesNotThrow(() => restoreGame(fakeApp(), def, () => {}, json))
  })
})
