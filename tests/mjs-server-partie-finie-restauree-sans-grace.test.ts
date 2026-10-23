// Une partie FINIE restaurée depuis une sauvegarde sans sa minuterie de grâce (`µempty` absente : sauvegarde écrite pendant l'arrêt,
// ou par une version antérieure) n'armait aucune minuterie : jamais détruite, jamais retirée du stockage, à chaque redémarrage.
// La restauration arme désormais sa grâce de fin (def.endTtl) quand la sauvegarde n'en porte pas.
import assert from 'node:assert/strict'
import { resolveGameDef, restoreGame } from '../src/mjs-server/index.js'

const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

function sauvegarde(timers: any[]): any {
  return { id: 'game9', type: 'fini', code: null, state: {}, phase: null, turn: null, seq: 1, journal: [], seats: [{ seat: 0, id: 'a', connected: false }], timers, ended: true, result: {} }
}

describe('restauration d\'une partie finie', () => {
  it('sans µempty dans la sauvegarde : la grâce de fin est armée et la partie est détruite à son terme', async () => {
    const def = resolveGameDef('fini', { seats: 1, endTtl: 30, emptyTtl: 60000, state: () => ({}), moves: {} })
    let detruite = false
    const game = restoreGame({ send() {} } as any, def, () => { detruite = true }, sauvegarde([]))
    assert.deepEqual(Array.from(game._timers.keys()), ['µempty'])
    const debut = Date.now()
    while (!detruite && Date.now() - debut < 2000) await tick(10)
    assert.equal(detruite, true, 'partie finie jamais détruite')
  })

  it('avec µempty dans la sauvegarde : son échéance sauvée est gardée (non-régression)', () => {
    const def  = resolveGameDef('fini', { seats: 1, endTtl: 30, state: () => ({}), moves: {} })
    const at   = Date.now() + 50000
    const game = restoreGame({ send() {} } as any, def, () => {}, sauvegarde([{ name: 'µempty', at }]))
    assert.deepEqual(Array.from(game._timers.keys()), ['µempty'])
    assert.ok(Math.abs(game._timers.get('µempty')!.at - at) <= 5, 'échéance sauvée perdue')
    game._destroy()
  })
})
