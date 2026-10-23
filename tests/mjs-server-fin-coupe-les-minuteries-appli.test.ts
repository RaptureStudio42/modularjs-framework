// la fin d'une partie (.end()) coupe TOUTES les minuteries de l'appli (game.timer()), comme elle coupe déjà celles du tour et de la
// fenêtre de confirmation des sièges : une minuterie armée avant la fin ne tire plus, une minuterie armée après (depuis hooks.onEnd,
// ou par un appel direct) ne part pas non plus ; seule la grâce de destruction (endTtl) reste armée
// minuteries et horloge simulées (node:test mock) : aucune vraie attente
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'

const MINUTE     = 60 * 1000
const WALL_START = 1_760_000_000_000   // une heure murale plausible, en ms depuis 1970

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

// appli factice qui note ce qu'elle envoie : de quoi compter les trames d'une partie
function recordingApp(): any {
  const sent: Array<{ client: any; type: string; p: any }> = []
  return { send(client: any, type: string, p: any) { sent.push({ client, type, p }) }, sent }
}

// partie à deux sièges déclarée avec les options de `raw` ; destroyed() dit si le serveur l'a retirée de son registre
function declare(raw: Record<string, any> = {}): { game: any; def: any; app: any; destroyed: () => boolean } {
  let destroyed = false
  const app = recordingApp()
  const def = resolveGameDef('fin', { seats: 2, endTtl: 10 * MINUTE, state: () => ({}), moves: {}, ...raw })
  return { game: createGame(app, def, () => { destroyed = true }, 'fin1'), def, app, destroyed: () => destroyed }
}

// fait avancer l'horloge simulée par pas : une minuterie réarmée par son propre appel ne repart qu'au tick suivant
function advance(total: number, step: number): void {
  for (let elapsed = 0; elapsed < total; elapsed += step) mock.timers.tick(step)
}

const names = (game: any): string[] => game.serialize().timers.map((m: any) => m.name)

describe('MJS-Server — la fin de partie coupe les minuteries nommées de l\'appli', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WALL_START }) })
  afterEach(() => { mock.timers.reset() })

  it('une minuterie nommée armée avant la fin ne tire pas : ni à son échéance, ni plus tard', () => {
    let appels = 0
    const { game } = declare({ timers: { rappel: () => { appels++ } } })
    game._createSeat(fakeClient('a'))
    game.timer('rappel', 1000)
    game.end({ gagnant: 'a' })
    advance(5000, 500)
    assert.equal(appels, 0, 'la minuterie nommée a tiré après la fin')
  })

  it('la partie finie ne garde que sa grâce de destruction : la sauvegarde ne porte aucune minuterie nommée', () => {
    const { game } = declare({ timers: { rappel: () => {}, autre: () => {} } })
    game._createSeat(fakeClient('a'))
    game.timer('rappel', 1000)
    game.timer('autre', 60_000)
    assert.deepEqual(names(game).sort(), ['autre', 'rappel'], 'avant la fin, les deux minuteries nommées sont armées')
    game.end({ gagnant: 'a' })
    assert.deepEqual(names(game), ['µempty'], 'la partie finie garde une minuterie de l\'appli en plus de sa grâce')
  })

  it('un rappel récurrent (une minuterie qui se réarme elle-même) s\'arrête à la fin : plus d\'appel, plus de diffusion, plus de sauvegarde', async () => {
    let appels = 0
    let saves  = 0
    const { game, app } = declare({ timers: { rappel: (g: any) => { appels++; g.timer('rappel', 1000) } } })
    game._onMutate = () => { saves++ }
    game._createSeat(fakeClient('a'))
    game.timer('rappel', 1000)
    advance(3000, 1000)
    await Promise.resolve()
    assert.equal(appels, 3, 'témoin : avant la fin, le rappel tire à chaque seconde')
    game.end({ gagnant: 'a' })
    await Promise.resolve()   // la diffusion groupée du dernier rappel part avant la fin
    const trames      = app.sent.filter((m: any) => m.type === 'µgame:state').length
    const sauvegardes = saves
    advance(10_000, 1000)
    await Promise.resolve()
    assert.equal(appels, 3, 'le rappel a continué de tirer après la fin')
    assert.equal(app.sent.filter((m: any) => m.type === 'µgame:state').length, trames, 'l\'état a été rediffusé après la fin')
    assert.equal(saves, sauvegardes, 'la partie finie a été sauvegardée à chaque rappel')
  })

  it('toutes les minuteries nommées sont coupées, pas seulement la première ni la plus proche', () => {
    const tires: string[] = []
    const { game } = declare({ timers: { proche: () => { tires.push('proche') }, milieu: () => { tires.push('milieu') }, loin: () => { tires.push('loin') } } })
    game._createSeat(fakeClient('a'))
    game.timer('proche', 100)
    game.timer('milieu', 5000)
    game.timer('loin', 5 * MINUTE)
    game.end({ gagnant: 'a' })
    advance(6 * MINUTE, 10_000)
    assert.deepEqual(tires, [], 'des minuteries nommées ont tiré après la fin : ' + tires.join(', '))
  })

  it('une minuterie armée depuis hooks.onEnd ne part pas : la fin est déjà posée quand le crochet tourne', () => {
    let appels = 0
    const { game } = declare({ timers: { solde: () => { appels++ } }, hooks: { onEnd: (g: any) => { g.timer('solde', 500) } } })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    assert.deepEqual(names(game), ['µempty'], 'le crochet de fin a armé une minuterie de l\'appli')
    advance(5000, 500)
    assert.equal(appels, 0, 'la minuterie armée par onEnd a tiré')
  })

  it('un hooks.onEnd qui arme une minuterie puis lève : la grâce est armée quand même, la minuterie ne part pas', () => {
    let appels = 0
    const { game, destroyed } = declare({ timers: { solde: () => { appels++ } }, hooks: { onEnd: (g: any) => { g.timer('solde', 500); throw new Error('crochet cassé') } } })
    game._createSeat(fakeClient('a'))
    assert.throws(() => game.end({ gagnant: 'a' }), /crochet cassé/)
    assert.deepEqual(names(game), ['µempty'])
    advance(5000, 500)
    assert.equal(appels, 0, 'la minuterie armée par onEnd a tiré')
    mock.timers.tick(10 * MINUTE)
    assert.equal(destroyed(), true, 'la grâce n\'a pas été armée')
  })

  it('un appel direct à .timer() après la fin n\'arme rien et ne lève pas', () => {
    let appels = 0
    const { game } = declare({ timers: { rappel: () => { appels++ } } })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    assert.doesNotThrow(() => game.timer('rappel', 100), 'armer une minuterie après la fin a levé')
    assert.deepEqual(names(game), ['µempty'])
    advance(5000, 500)
    assert.equal(appels, 0, 'la minuterie armée après la fin a tiré')
  })

  it('un nom réservé reste refusé après la fin, comme avant', () => {
    const { game } = declare()
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    for (const nom of ['µturn', 'µmatch', 'µempty']) assert.throws(() => game.timer(nom, 100), /nom réservé/, `${nom} aurait dû rester refusé`)
  })

  it('une fin posée par une minuterie coupe les autres minuteries nommées en attente', () => {
    const tires: string[] = []
    const { game } = declare({ timers: {
      conclure: (g: any) => { tires.push('conclure'); g.end({ gagnant: 'a' }) },
      autre:    () => { tires.push('autre') },
    } })
    game._createSeat(fakeClient('a'))
    game.timer('conclure', 1000)
    game.timer('autre', 3000)
    advance(10_000, 500)
    assert.deepEqual(tires, ['conclure'], 'la minuterie encore en attente a tiré après la fin')
    assert.deepEqual(names(game), ['µempty'])
  })

  it('la grâce reste armée et va jusqu\'au bout : la partie finie est détruite à endTtl, ni avant, ni jamais', () => {
    const { game, destroyed } = declare({ timers: { rappel: () => {} } })
    game._createSeat(fakeClient('a'))
    game.timer('rappel', 1000)
    game.end({ gagnant: 'a' })
    mock.timers.tick(10 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite après endTtl')
  })

  it('une sauvegarde de partie finie qui garde une minuterie nommée (écrite avant ce comportement) ne la fait pas tirer une fois restaurée', () => {
    let appels = 0
    const { game, def } = declare({ timers: { rappel: () => { appels++ } } })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    game._destroy()
    snapshot.timers.push({ name: 'rappel', at: WALL_START + 1000 })
    let restoredDestroyed = false
    const restored = restoreGame(fakeApp(), def, () => { restoredDestroyed = true }, snapshot)
    assert.deepEqual(names(restored), ['µempty'], 'la partie finie restaurée a réarmé la minuterie nommée de sa sauvegarde')
    advance(5000, 500)
    assert.equal(appels, 0, 'la minuterie nommée a tiré sur une partie finie restaurée')
    mock.timers.tick(10 * MINUTE)
    assert.equal(restoredDestroyed, true, 'la partie finie restaurée n\'a pas été détruite à l\'échéance restante de endTtl')
  })

  it('témoin : une partie non finie garde ses minuteries nommées, y compris restaurée', () => {
    let appels = 0
    const { game, def } = declare({ timers: { rappel: () => { appels++ } } })
    game._createSeat(fakeClient('a'))
    game.timer('rappel', 1000)
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    mock.timers.tick(1000)
    assert.equal(appels, 1, 'la minuterie nommée n\'a pas tiré dans une partie en cours')
    game._destroy()
    const restored = restoreGame(fakeApp(), def, () => {}, snapshot)
    assert.ok(names(restored).includes('rappel'), 'la partie en cours restaurée a perdu sa minuterie nommée')
    mock.timers.tick(1000)
    assert.equal(appels, 2, 'la minuterie nommée restaurée n\'a pas tiré')
    restored._destroy()
  })
})
