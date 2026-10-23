// Ce que ce test garantit : l'instantané qu'une partie remet à la persistance (serialize(), écrit
// par save() à chaque mutation) ne porte PAS la charge `p` de chaque coup joué. Le journal des coups
// garde sa trace (qui a joué quoi, quand) mais la charge, elle, est déjà reflétée dans `state` —
// la recopier dans le journal sauvé faisait grossir chaque sauvegarde avec le détail de chaque coup
// (jusqu'à 200 charges, sans borne de taille : un coup de dessin de 10 Ko pesait 10 Ko de plus dans
// CHAQUE sauvegarde suivante). En mémoire non plus, le journal ne garde pas la charge : rien ne la
// relisait, et une partie retenait jusqu'à 200 charges de 64 Ko.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, restoreGame, encodeSnapshot } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-'+ identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

function lourdDef(): any {
  return resolveGameDef('lourd', {
    seats: 2,
    state: () => ({ traits: 0 }),
    moves: { dessin: (game: any) => { game.state.traits++ } },
    limits: { moves: null },
  })
}

describe('MJS-Server — la sauvegarde ne porte pas la charge des coups', () => {
  it('50 coups de 10 Ko chacun : le journal sauvé garde les 50 traces, sans aucune charge — instantané léger', () => {
    const game  = createGame(fakeApp(), lourdDef(), () => {}, 'g-lourd')
    const c1    = fakeClient('j1')
    const trait = { points: 'x'.repeat(10000) }
    game._createSeat(c1); game._createSeat(fakeClient('j2'))
    for (let i = 0; i < 50; i++) game._onMove(c1, 'dessin', trait)

    const texte = encodeSnapshot(game.serialize())
    const snap  = JSON.parse(texte)
    assert.equal(snap.state.traits, 50, 'sanity : les 50 coups sont bien appliqués')
    assert.equal(snap.journal.length, 50, 'la trace de chaque coup reste dans le journal sauvé')
    assert.deepEqual(Object.keys(snap.journal[0]).sort(), ['at', 'move', 'player'], 'une entrée sauvée : qui, quoi, quand — pas la charge')
    assert.equal(snap.journal[49].move, 'dessin')
    assert.equal(snap.journal[49].player, 'j1')
    assert.ok(texte.length < 10000, `instantané de ${texte.length} caractères : la charge des coups y est encore recopiée`)
    game._destroy()
  })

  it('en mémoire non plus, le journal de la partie vivante ne garde pas la charge des coups', () => {
    const game  = createGame(fakeApp(), lourdDef(), () => {}, 'g-vivant')
    const c1    = fakeClient('j1')
    const trait = { points: 'abc' }
    game._createSeat(c1); game._createSeat(fakeClient('j2'))
    game._onMove(c1, 'dessin', trait)
    game.serialize()
    assert.equal(game.journal[0].move, 'dessin')
    assert.equal('p' in game.journal[0], false, 'la charge du coup n est pas gardée dans le journal vivant')
    game._destroy()
  })

  it('aller-retour : une partie restaurée depuis ce journal allégé reprend, et ses nouveaux coups se journalisent', () => {
    const def   = lourdDef()
    const game  = createGame(fakeApp(), def, () => {}, 'g-retour')
    const c1    = fakeClient('j1')
    game._createSeat(c1); game._createSeat(fakeClient('j2'))
    for (let i = 0; i < 3; i++) game._onMove(c1, 'dessin', { points: 'y'.repeat(500) })
    const snap = JSON.parse(encodeSnapshot(game.serialize()))
    game._destroy()

    const restauree = restoreGame(fakeApp(), def, () => {}, snap)
    assert.equal(restauree.journal.length, 3)
    assert.equal((restauree.state as any).traits, 3)
    const c1bis = fakeClient('j1')
    assert.ok(restauree._reattachSeat(c1bis), 'reconnexion du joueur j1 sur son siège restauré')
    restauree._onMove(c1bis, 'dessin', { points: 'z' })
    assert.equal(restauree.journal.length, 4, 'le coup joué après restauration rejoint le journal')
    assert.ok(!('p' in JSON.parse(encodeSnapshot(restauree.serialize())).journal[3]), 'et sa charge ne part pas non plus dans la sauvegarde')
    restauree._destroy()
  })
})
