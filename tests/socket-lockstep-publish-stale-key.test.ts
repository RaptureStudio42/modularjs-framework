// µ.lockstep (mjs_lockstep.ts) — une clé racine disparue de l'état simulé (`appliquer` qui la
// `delete`) doit disparaître de la vue publique republiée, pas y rester fantôme. Même stratégie que
// mjs_game.ts::_syncGameStore et mjs_optimistic.ts (delete des clés qui ne sont plus dans l'état
// avant de recopier les clés courantes).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/runtime/mjs_lockstep.ts', import.meta.url), 'utf8')

function makeMu(): any {
  const µ: any = { state: (init: any) => ({ ...init }), random: (_seed: number) => ({ next: () => 0 }), error: () => {}, warn: () => {} }
  new Function('µ', src)(µ)
  return µ
}

function fakeGame(): any {
  const handlers: Record<string, Function[]> = {}
  return {
    _mjs_gameId: 'g1',
    _mjs_handlers: handlers,
    on(evt: string, fn: Function) {
      (handlers[evt] || (handlers[evt] = [])).push(fn)
      return () => { const hs = handlers[evt]; const i = hs.indexOf(fn); if (i >= 0) hs.splice(i, 1) }
    },
    emit(evt: string, frame: any) { (handlers[evt] || []).slice().forEach((fn) => fn(frame)) },
  }
}

describe('µ.lockstep — republication de la vue (_mjlockstepPublish)', () => {
  it("une clé racine disparue de l'état (delete côté appliquer) disparaît aussi de la vue publique", () => {
    const µ = makeMu()
    const game = fakeGame()
    const vue = µ.lockstep(game, {
      state0: () => ({}),
      apply: (etat: any, ordre: any) => {
        if (ordre.type === 'set-winner') { etat.winner = ordre.id }
        if (ordre.type === 'clear-winner') { delete etat.winner }
      },
      every: 0,
    })
    game.emit('start', { seed: 1, journal: [] })
    game.emit('orders', { tick: 1, orders: [{ type: 'set-winner', id: 'u1' }] })
    assert.equal(vue.winner, 'u1')

    game.emit('orders', { tick: 2, orders: [{ type: 'clear-winner' }] })
    assert.equal('winner' in vue, false, "la clé 'winner' a disparu de l'état, elle ne doit pas rester fantôme dans la vue")
  })

  it("une clé encore présente dans l'état n'est jamais retirée à tort (témoin)", () => {
    const µ = makeMu()
    const game = fakeGame()
    const vue = µ.lockstep(game, {
      state0: () => ({ score: 0 }),
      apply: (etat: any, ordre: any) => { if (ordre.type === 'score') { etat.score += ordre.n } },
      every: 0,
    })
    game.emit('start', { seed: 1, journal: [] })
    game.emit('orders', { tick: 1, orders: [{ type: 'score', n: 3 }] })
    assert.equal(vue.score, 3, 'une clé toujours présente dans l’état reste dans la vue, avec sa valeur à jour')
  })
})
