// Mode action : l'empreinte d'une partie (une sérialisation JSON de tout son état) n'est calculée qu'au moment d'écrire, une fois par
// sauvegarde tentée. La boucle passe sa marque de sauvegarde au plus une fois toutes les 100 ms, et des marques plus rapprochées que
// le débounce de la persistance repoussent l'écriture (jusqu'à dix débounces) : à 60 Hz, loin d'une empreinte par tick. Des ticks
// plus espacés que le débounce tentent chacun leur sauvegarde, donc une empreinte par tick. Une partie où ne tourne que du code dont
// l'effet ne se voit pas (simulate, slowTick, minuteries de l'appli) est ainsi comparée à sa dernière sauvegarde ; sans ce code, ni
// sans persistance, aucune empreinte : tout ce qui la fait sauvegarder (coup, intention, siège, phase, tour, fin, game.changed())
// s'écrit sans comparaison. Sur un état de quelques mégaoctets, une empreinte coûte de l'ordre de la milliseconde à la dizaine de
// millisecondes : une par tick prenait la moitié du temps d'une boucle à 20 Hz. Partie construite directement (sans serveur) avec le
// vrai moteur de persistance ; l'empreinte est comptée par un espion.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function fakeClient(id: string): any {
  return { id: 'c-' + id, identity: { id }, latency: null, meta: {}, send() {}, close() {} }
}

// partie d'action d'un siège connecté (60 Hz) ; `persisted` : armée par le vrai moteur de persistance (débounce 20 ms) ;
// `prints()` compte les empreintes calculées, `ticks()` les ticks écoulés (simulate), `writes()` les écritures
function running(def: Record<string, any>, persisted: boolean) {
  let ticks  = 0
  let writes = 0
  const own    = def.simulate
  const full   = resolveGameDef('arene', { seats: 1, tick: 60, state: () => ({ n: 0 }), moves: {}, ...def, ...(own ? { simulate: (game: any, dt: number) => { ticks++; own(game, dt) } } : {}) } as any)
  const game   = createGame({ send() {} } as any, full, () => {}, 'g1') as any
  const print  = game._savedPrint.bind(game)
  let prints   = 0
  game._savedPrint = () => { prints++; return print() }
  const engine = persisted ? createPersistEngine(resolvePersistOption({ adapter: { load: async () => [], save: () => { writes++ }, remove: () => {} }, debounce: 20 })!, () => {})! : null
  engine?.armGame(game)
  const client = fakeClient('j1')
  game._createSeat(client)
  return { game, engine, client, prints: () => prints, ticks: () => ticks, writes: () => writes }
}

describe('MJS-Server — mode action : l\'empreinte d\'une partie n\'est calculée qu\'au moment d\'écrire, une fois par sauvegarde tentée', function () {
  this.timeout(8000)

  it('simulate qui ne change rien, avec persistance : une empreinte par sauvegarde tentée, loin d\'une par tick', async () => {
    const { game, engine, prints, ticks, writes } = running({ simulate: () => {} }, true)
    await tick(800)
    game._destroy(true)
    await engine!.stop()
    assert.ok(ticks() > 30, 'sanity : la boucle a tourné (' + ticks() + ' ticks)')
    assert.equal(writes(), 1, 'seule l\'arrivée du joueur s\'écrit')
    assert.ok(prints() * 4 < ticks(), prints() + ' empreintes pour ' + ticks() + ' ticks')
  })

  it('simulate qui ne change rien, sans persistance : aucune empreinte', async () => {
    const { game, prints, ticks } = running({ simulate: () => {} }, false)
    await tick(300)
    game._destroy(true)
    assert.ok(ticks() > 10, 'sanity : la boucle a tourné')
    assert.equal(prints(), 0)
  })

  it('ni simulate, ni slowTick, ni minuterie de l\'appli : aucune empreinte, même avec persistance', async () => {
    const { game, engine, client, prints } = running({ intents: { bouge: (g: any) => { g.state.n++ } } }, true)
    await tick(150)
    game._onMove(client, 'bouge', {})
    await tick(300)
    game._destroy(true)
    await engine!.stop()
    assert.equal((game.state as any).n, 1, 'sanity : l\'intention a tourné')
    assert.equal(prints(), 0)
  })
})
