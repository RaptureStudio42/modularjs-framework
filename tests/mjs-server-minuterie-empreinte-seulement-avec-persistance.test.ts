// Le tir d'une minuterie de l'appli ne calcule l'empreinte de la partie (une sérialisation JSON de tout son état, comparée à celle de
// la dernière sauvegarde) que lorsqu'elle peut servir : avec une persistance, en mode événementiel, une seule fois par tir — et une
// fois de plus à la fin de la Promise que rend la minuterie. Sans persistance, ou en mode action (la partie y est comparée à sa
// dernière sauvegarde au moment d'écrire, pas au tir), aucune : sur un état de quelques mégaoctets, chaque tir coûtait deux à quatre
// sérialisations dont le résultat n'était pas lu. Partie construite directement (sans serveur) ; l'empreinte est comptée par un espion.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// partie d'un siège dont la minuterie `veille` lance `fn` ; `persisted` simule la persistance (le moteur pose `_onMutate`) ;
// `prints()` compte les empreintes calculées
function gameWith(tickHz: number, persisted: boolean, fn: (game: any) => unknown) {
  const def   = resolveGameDef('veille', { seats: 1, tick: tickHz, state: () => ({ n: 0 }), moves: {}, timers: { veille: fn } } as any)
  const game  = createGame({ send() {} } as any, def, () => {}, 'g1') as any
  const print = game._savedPrint.bind(game)
  let prints  = 0
  game._savedPrint = () => { prints++; return print() }
  if (persisted) game._onMutate = () => {}
  return { game, prints: () => prints }
}

describe('MJS-Server — l\'empreinte d\'une partie n\'est calculée au tir d\'une minuterie que si elle sert', () => {
  it('sans persistance, mode événementiel : aucune empreinte', async () => {
    const { game, prints } = gameWith(0, false, () => {})
    game._guardApplicativeTimer('veille')
    await tick()
    assert.equal(prints(), 0)
    game._destroy()
  })

  it('mode action, avec persistance : aucune empreinte', async () => {
    const { game, prints } = gameWith(20, true, (g: any) => { g.state.n++ })
    game._guardApplicativeTimer('veille')
    await tick()
    assert.equal(prints(), 0)
    game._destroy()
  })

  it('avec persistance, mode événementiel : une empreinte par tir, une de plus à la fin de la Promise rendue', async () => {
    const sync = gameWith(0, true, () => {})
    sync.game._guardApplicativeTimer('veille')
    await tick()
    assert.equal(sync.prints(), 1, 'tir synchrone')
    sync.game._destroy()

    const async = gameWith(0, true, () => new Promise<void>(resolve => setTimeout(resolve, 10)))
    async.game._guardApplicativeTimer('veille')
    await tick(40)
    assert.equal(async.prints(), 2, 'tir qui rend une Promise')
    async.game._destroy()
  })
})
