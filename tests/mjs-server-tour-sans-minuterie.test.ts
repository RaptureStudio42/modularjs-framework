// turns.timeout: null — aucune minuterie de tour : une partie par correspondance, où chacun joue quand il veut, des jours plus tard.
// Sans timeout déclaré, la minuterie de tour vaut 30 000 ms dès que `turns` est déclaré : la doc disait le contraire (« sans
// turns.timeout, aucune minuterie n'est armée ») et aucune valeur ne permettait de s'en passer (tout ce qui n'était pas un nombre fini
// > 0 était refusé). Infinity reste refusé. Une minuterie de tour restaurée d'une sauvegarde écrite quand la définition en armait une
// ne fait plus rien à son échéance. Minuteries et horloge simulées (node:test mock) : aucune vraie attente.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const DAY        = 24 * 3600 * 1000
const WALL_START = 1_760_000_000_000   // une heure murale plausible, en ms depuis 1970

function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

// partie à deux sièges, déclarée avec `turns` ; `expired` compte les appels de hooks.onTurnTimeout
function declare(turns: Record<string, any>): { game: any; def: any; expired: () => number } {
  let expired = 0
  const def  = resolveGameDef('lettres', { seats: 2, state: () => ({}), moves: {}, turns, hooks: { onTurnTimeout: (game: any) => { expired++; game.next() } } })
  const game = createGame({ send() {} } as any, def, () => {}, 'lettres1')
  game._createSeat(fakeClient('p1'))
  game._createSeat(fakeClient('p2'))
  return { game, def, expired: () => expired }
}

const turnTimer = (game: any) => game.serialize().timers.find((t: any) => t.name === 'µturn')

describe('MJS-Server — turns.timeout: null, une partie sans minuterie de tour', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WALL_START }) })
  afterEach(() => { mock.timers.reset(); setMessagesLang('fr') })

  it('la déclaration accepte turns.timeout: null et le résout tel quel', () => {
    const def = resolveGameDef('lettres', { seats: 2, state: () => ({}), moves: {}, turns: { order: 'roundrobin', timeout: null } })
    assert.equal(def.turns!.timeout, null)
  })

  it('sans timeout déclaré, la minuterie de tour vaut 30 000 ms', () => {
    const { game, def, expired } = declare({ order: 'roundrobin' })
    assert.equal(def.turns!.timeout, 30000)
    game.next()
    assert.equal(turnTimer(game).at, WALL_START + 30000)
    mock.timers.tick(30000)
    assert.equal(expired(), 1)
    game._destroy()
  })

  it('timeout: null : game.next() n\'arme aucune minuterie, le tour ne passe jamais tout seul', () => {
    const { game, expired } = declare({ order: 'roundrobin', timeout: null })
    game.next()
    assert.equal(game.turn, 'p1')
    assert.equal(turnTimer(game), undefined, 'une minuterie de tour est armée')
    mock.timers.tick(30 * DAY)
    assert.equal(game.turn, 'p1', 'le tour est passé tout seul')
    assert.equal(expired(), 0, 'hooks.onTurnTimeout a été appelé')
    game.next()
    assert.equal(game.turn, 'p2', 'game.next() fait toujours tourner le tour')
    assert.equal(turnTimer(game), undefined)
    game._destroy()
  })

  it('timeout: null : une minuterie de tour restaurée d\'une sauvegarde ne fait rien à son échéance', () => {
    const before = declare({ order: 'roundrobin', timeout: 60000 })
    before.game.next()
    const snapshot = JSON.parse(JSON.stringify(before.game.serialize()))
    before.game._destroy()
    assert.ok(snapshot.timers.some((t: any) => t.name === 'µturn'), 'la sauvegarde d\'avant porte la minuterie de tour')

    let expired = 0
    // emptyTtl d'une semaine : la grâce de la partie restaurée (aucun siège connecté) n'arrive pas avant l'échéance du tour
    const def  = resolveGameDef('lettres', { seats: 2, emptyTtl: 7 * DAY, state: () => ({}), moves: {}, turns: { order: 'roundrobin', timeout: null }, hooks: { onTurnTimeout: () => { expired++ } } })
    const game = restoreGame({ send() {} } as any, def, () => {}, snapshot)
    mock.timers.tick(DAY)
    assert.equal(expired, 0, 'la minuterie de tour restaurée a appelé hooks.onTurnTimeout')
    assert.equal(game.turn, 'p1', 'la minuterie de tour restaurée a fait passer le tour')
    game._destroy()
  })

  it('Infinity, 0 et un nombre négatif restent refusés ; le message dit que null retire la minuterie', () => {
    for (const valeur of [Infinity, 0, -1, NaN, '30000']) {
      assert.throws(() => resolveGameDef('lettres', { seats: 2, state: () => ({}), moves: {}, turns: { order: 'roundrobin', timeout: valeur as any } }), /turns\.timeout doit être un nombre > 0 \(ms\), ou null/)
    }
    setMessagesLang('en')
    assert.throws(() => resolveGameDef('lettres', { seats: 2, state: () => ({}), moves: {}, turns: { order: 'roundrobin', timeout: Infinity } }), /turns\.timeout must be a number > 0 \(ms\), or null/)
  })
})
