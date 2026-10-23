// endTtl : la grâce d'une partie FINIE (.end()) avant sa destruction, distincte de emptyTtl (la vie d'une partie vide non finie)
// avant, .end() armait la destruction avec emptyTtl : impossible de garder une partie vide 14 jours (pour qu'un joueur revienne)
// ET de libérer vite une partie finie (10 minutes pour voir le résultat) ; sans endTtl, la grâce reste emptyTtl
// une partie finie ne tire plus aucune minuterie de jeu (tour, fenêtre de confirmation des sièges de la file) : seule la
// grâce reste armée, la partie n'est jamais « annulée » ni son tour rejoué, même restaurée depuis une sauvegarde qui les garde
// minuteries et horloge simulées (node:test mock) : aucune vraie attente
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const MINUTE      = 60 * 1000
const DAY         = 24 * 60 * MINUTE
const MAX_TIMEOUT = 2_147_483_647   // plafond d'un setTimeout Node (2^31-1 ms)
const LONG        = 3_000_000_000   // 34,7 jours : au-dessus du plafond
const WALL_START  = 1_760_000_000_000   // une heure murale plausible, en ms depuis 1970

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

// appli factice qui note ce qu'elle envoie (destinataire, type, charge) : de quoi compter les trames d'une partie
function recordingApp(): any {
  const sent: Array<{ client: any; type: string; p: any }> = []
  return { send(client: any, type: string, p: any) { sent.push({ client, type, p }) }, sent }
}

// partie à un siège par défaut, déclarée avec les options de `raw` ; destroyed() dit si le serveur l'a retirée de son registre
function declare(raw: Record<string, any> = {}): { game: any; def: any; app: any; destroyed: () => boolean } {
  let destroyed = false
  const app = recordingApp()
  const def = resolveGameDef('fin', { seats: 1, state: () => ({}), moves: {}, ...raw })
  return { game: createGame(app, def, () => { destroyed = true }, 'fin1'), def, app, destroyed: () => destroyed }
}

// fait avancer l'horloge simulée par pas : une minuterie réarmée par son propre appel ne repart qu'au tick suivant
function advance(total: number, step: number): void {
  for (let elapsed = 0; elapsed < total; elapsed += step) mock.timers.tick(step)
}

describe('MJS-Server — endTtl, la grâce après la fin d\'une partie', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WALL_START }) })
  afterEach(() => { mock.timers.reset(); setMessagesLang('fr') })

  it('la déclaration accepte endTtl : tout nombre fini > 0, plus court ou plus long que emptyTtl', () => {
    for (const valeur of [0.5, 1, 10 * MINUTE, 14 * DAY, LONG, Number.MAX_SAFE_INTEGER]) {
      assert.doesNotThrow(() => resolveGameDef('fin', { seats: 1, state: () => ({}), moves: {}, endTtl: valeur }), `endTtl : ${valeur} aurait dû être accepté`)
    }
    assert.doesNotThrow(() => resolveGameDef('fin', { seats: 1, state: () => ({}), moves: {}, emptyTtl: 14 * DAY, endTtl: 10 * MINUTE }))
  })

  it('la partie finie est détruite après endTtl, pas après emptyTtl : partie vide gardée 14 jours, partie finie libérée 10 minutes après la fin', () => {
    const { game, destroyed } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    mock.timers.tick(10 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite après endTtl')
  })

  it('la partie vide, non finie, est toujours détruite après emptyTtl : endTtl n\'y change rien', () => {
    const { game, destroyed } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE })
    const hote = fakeClient('hote')
    game._createSeat(hote)
    game._started = true       // partie commencée : emptyTtl attend le retour de ses joueurs (une table jamais complète est fermée aussitôt)
    game._onDisconnect(hote)   // plus aucun siège connecté : la grâce de la partie vide démarre
    mock.timers.tick(10 * MINUTE)
    assert.equal(destroyed(), false, 'la partie vide a été détruite après endTtl')
    mock.timers.tick(14 * DAY - 10 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie vide a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie vide n\'a pas été détruite après emptyTtl')
  })

  it('une partie vide que l\'appli termine ensuite (une minuterie appelle .end()) passe de emptyTtl à endTtl', () => {
    const { game, destroyed } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE, timers: { delai: (g: any) => { g.end({ gagnant: null }) } } })
    const hote = fakeClient('hote')
    game._createSeat(hote)
    game._started = true       // partie commencée, cf. plus haut
    game._onDisconnect(hote)   // la partie est vide : sa destruction est armée à emptyTtl
    game.timer('delai', 2 * DAY)
    mock.timers.tick(2 * DAY)   // la minuterie de l'appli termine la partie vide
    mock.timers.tick(10 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie est restée sur la grâce de la partie vide')
  })

  it('endTtl plus long que emptyTtl : la partie vide part à emptyTtl, la partie finie à endTtl', () => {
    const vide = declare({ emptyTtl: MINUTE, endTtl: 10 * MINUTE })
    const hote = fakeClient('hote')
    vide.game._createSeat(hote)
    vide.game._started = true   // partie commencée, cf. plus haut
    vide.game._onDisconnect(hote)
    const finie = declare({ emptyTtl: MINUTE, endTtl: 10 * MINUTE })
    finie.game._createSeat(fakeClient('a'))
    finie.game.end({ gagnant: 'a' })
    mock.timers.tick(MINUTE)
    assert.equal(vide.destroyed(), true, 'la partie vide n\'a pas été détruite après emptyTtl')
    assert.equal(finie.destroyed(), false, 'la partie finie a été détruite après emptyTtl')
    mock.timers.tick(9 * MINUTE - 1)
    assert.equal(finie.destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(finie.destroyed(), true, 'la partie finie n\'a pas été détruite après endTtl')
  })

  it('sans endTtl, la partie finie est détruite après emptyTtl, comme avant', () => {
    const { game, destroyed } = declare({ emptyTtl: 5000 })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    mock.timers.tick(4999)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite après emptyTtl')
  })

  it('sans endTtl ni emptyTtl, la partie finie est détruite après le défaut de 60 s, comme avant', () => {
    const { game, destroyed } = declare()
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    mock.timers.tick(59_999)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite après 60 s')
  })

  it('une partie finie qui se vide puis se remplit garde son compte à rebours de endTtl : ni annulé, ni réarmé à emptyTtl', () => {
    const { game, destroyed } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE })
    const hote = fakeClient('hote')
    game._createSeat(hote)
    game.end({ gagnant: 'hote' })
    mock.timers.tick(2 * MINUTE)
    game._onDisconnect(hote)   // plus aucun siège connecté : emptyTtl ne s'applique pas à une partie finie
    mock.timers.tick(2 * MINUTE)
    game._resync(hote)   // le siège revient : la destruction n'est pas annulée
    mock.timers.tick(6 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie a survécu à son compte à rebours de endTtl')
  })

  it('un second .end() ne repousse pas l\'échéance de endTtl', () => {
    const { game, destroyed } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    mock.timers.tick(4 * MINUTE)
    game.end({ gagnant: 'b' })
    mock.timers.tick(6 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'le second .end() a repoussé l\'échéance de endTtl')
  })

  it('une partie finie sauvegardée puis restaurée est détruite à l\'échéance restante de endTtl', () => {
    const { game, def } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    mock.timers.tick(3 * MINUTE)
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    game._destroy()   // le serveur s'arrête
    let restoredDestroyed = false
    const restored = restoreGame(fakeApp(), def, () => { restoredDestroyed = true }, snapshot)
    assert.equal(restored._ended, true, 'la partie restaurée doit se savoir terminée')
    mock.timers.tick(7 * MINUTE - 1)
    assert.equal(restoredDestroyed, false, 'la partie restaurée a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(restoredDestroyed, true, 'la partie restaurée n\'a pas été détruite à l\'échéance restante de endTtl')
  })

  it('hooks.onEnd qui lève : la destruction après endTtl est armée quand même', () => {
    const { game, destroyed } = declare({ emptyTtl: 14 * DAY, endTtl: 10 * MINUTE, hooks: { onEnd: () => { throw new Error('crochet cassé') } } })
    game._createSeat(fakeClient('a'))
    assert.throws(() => game.end({ gagnant: 'a' }), /crochet cassé/)
    mock.timers.tick(10 * MINUTE - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite après endTtl')
  })

  it('une durée au-delà de 2^31-1 ms est attendue par tranches : la partie finie est détruite à l\'échéance, ni aussitôt ni avant', () => {
    const { game, destroyed } = declare({ endTtl: LONG })
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    mock.timers.tick(1000)
    assert.equal(destroyed(), false, 'la partie finie a été détruite aussitôt')
    mock.timers.tick(MAX_TIMEOUT)
    assert.equal(destroyed(), false, 'la partie finie a été détruite à la fin de la première tranche')
    mock.timers.tick(LONG - 1000 - MAX_TIMEOUT - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite à l\'échéance')
  })

  it('endTtl refuse les mêmes valeurs que emptyTtl : Infinity, NaN, zéro, négatif, non nombre', () => {
    const refusees: Array<[string, unknown]> = [['Infinity', Infinity], ['-Infinity', -Infinity], ['NaN', NaN], ['zéro', 0], ['un négatif', -1], ['une chaîne', '600000'], ['null', null], ['un booléen', true], ['un tableau', []], ['un objet', {}]]
    for (const [nom, valeur] of refusees) {
      assert.throws(() => declare({ emptyTtl: valeur }), /emptyTtl doit être un nombre > 0/, `emptyTtl : ${nom} aurait dû être refusé`)
      assert.throws(() => declare({ endTtl: valeur }), /endTtl doit être un nombre > 0/, `endTtl : ${nom} aurait dû être refusé`)
    }
  })

  it('le refus de endTtl nomme endTtl, en français comme en anglais', () => {
    assert.throws(() => declare({ endTtl: -1 }), /\.endTtl doit être un nombre > 0 \(ms\), reçu : -1/)
    setMessagesLang('en')
    assert.throws(() => declare({ endTtl: -1 }), /\.endTtl must be a number > 0 \(ms\), received: -1/)
  })

  it('une partie de la file finie avant que tous les sièges aient confirmé n\'est pas annulée à l\'échéance de seatTtl : un seul µgame:end, et la grâce de endTtl va jusqu\'au bout', () => {
    const { game, app, destroyed } = declare({ seats: 2, seatTtl: 10_000, endTtl: 10 * MINUTE })
    const a = fakeClient('a')
    const b = fakeClient('b')
    game._createSeat(a)
    game._createSeat(b)
    game._armConfirmWindow(['a'], game.def.seatTtl)   // b a complété la file, a n'a encore rien confirmé
    game.end({ gagnant: 'b' })
    assert.deepEqual(game.serialize().timers.map((m: any) => m.name), ['µempty'], 'la partie finie garde une minuterie de jeu en plus de sa grâce')
    mock.timers.tick(10_000)
    assert.equal(destroyed(), false, 'la partie finie a été annulée à l\'échéance de seatTtl')
    mock.timers.tick(10 * MINUTE - 10_000 - 1)
    assert.equal(destroyed(), false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie finie n\'a pas été détruite après endTtl')
    const fins = app.sent.filter((m: any) => m.client === b && m.type === 'µgame:end').map((m: any) => m.p.result)
    assert.deepEqual(fins, [{ gagnant: 'b' }], 'le siège a reçu une annulation en plus de la fin')
  })

  it('une sauvegarde de partie finie qui garde une fenêtre de confirmation et une minuterie de tour (écrites par une ancienne version) ne les fait pas tirer une fois restaurée', () => {
    let rappels = 0
    const { game, def } = declare({ seats: 2, seatTtl: 10_000, endTtl: 10 * MINUTE, turns: { order: 'roundrobin', timeout: 1000 }, hooks: { onTurnTimeout: (g: any) => { rappels++; g.next() } } })
    game._createSeat(fakeClient('a'))
    game._createSeat(fakeClient('b'))
    game.end({ gagnant: 'b' })
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    game._destroy()
    snapshot.unconfirmedSeats = ['a']
    snapshot.timers.push({ name: 'µmatch', at: WALL_START + 10_000 }, { name: 'µturn', at: WALL_START + 1000 })
    let restoredDestroyed = false
    restoreGame(fakeApp(), def, () => { restoredDestroyed = true }, snapshot)
    advance(10_000, 1000)
    assert.equal(rappels, 0, 'le tour a tourné sur une partie finie restaurée')
    assert.equal(restoredDestroyed, false, 'la partie finie restaurée a été annulée à l\'échéance de la fenêtre de confirmation')
    mock.timers.tick(10 * MINUTE - 10_000)
    assert.equal(restoredDestroyed, true, 'la partie finie restaurée n\'a pas été détruite à l\'échéance restante de endTtl')
  })

  it('après .end(), la minuterie de tour ne tire plus : onTurnTimeout n\'est pas rappelé, l\'état n\'est ni rediffusé ni sauvegardé pendant la grâce', async () => {
    let rappels = 0
    let saves   = 0
    const { game, app, destroyed } = declare({ seats: 2, endTtl: 10 * MINUTE, turns: { order: 'roundrobin', timeout: 1000 }, hooks: { onTurnTimeout: (g: any) => { rappels++; g.next() } } })
    game._onMutate = () => { saves++ }
    game._createSeat(fakeClient('a'))
    game._createSeat(fakeClient('b'))
    game.next()   // le tour est établi : sa minuterie est armée
    await Promise.resolve()   // la diffusion groupée des mutations précédentes part avant la fin
    game.end({ gagnant: 'a' })
    assert.deepEqual(game.serialize().timers.map((m: any) => m.name), ['µempty'], 'la partie finie garde une minuterie de jeu en plus de sa grâce')
    const trames      = app.sent.filter((m: any) => m.type === 'µgame:state').length
    const sauvegardes = saves
    advance(5000, 1000)
    await Promise.resolve()
    assert.equal(rappels, 0, 'onTurnTimeout a été rappelé après la fin')
    assert.equal(app.sent.filter((m: any) => m.type === 'µgame:state').length, trames, 'l\'état a été rediffusé après la fin')
    assert.equal(saves, sauvegardes, 'la partie finie a été sauvegardée à chaque échéance du tour')
    assert.equal(destroyed(), false, 'la partie finie a été détruite avant la fin de sa grâce')
  })

  it('sans crochet onTurnTimeout, le tour ne passe plus tout seul après .end()', () => {
    let passages = 0
    const { game } = declare({ seats: 2, endTtl: 10 * MINUTE, turns: { order: (g: any) => { passages++; return g.players[passages % 2] }, timeout: 1000 } })
    game._createSeat(fakeClient('a'))
    game._createSeat(fakeClient('b'))
    game.next()   // premier passage : le tour est établi
    game.end({ gagnant: 'a' })
    const tour = game.turn
    advance(5000, 1000)
    assert.equal(passages, 1, 'le tour a passé tout seul après la fin')
    assert.equal(game.turn, tour, 'le tour a changé de main après la fin')
  })

  it('un .next() appelé après .end() n\'arme pas de minuterie de tour', () => {
    let rappels = 0
    const { game } = declare({ seats: 2, endTtl: 10 * MINUTE, turns: { order: 'roundrobin', timeout: 1000 }, hooks: { onTurnTimeout: () => { rappels++ } } })
    game._createSeat(fakeClient('a'))
    game._createSeat(fakeClient('b'))
    game.end({ gagnant: 'a' })
    game.next()   // un coup qui finit la partie puis passe la main, ou un onEnd qui passe la main
    assert.deepEqual(game.serialize().timers.map((m: any) => m.name), ['µempty'], 'la partie finie a armé une minuterie de tour')
    advance(5000, 1000)
    assert.equal(rappels, 0, 'onTurnTimeout a été rappelé après la fin')
  })

  it('une définition résolue construite à la main sans endTtl : la partie finie retombe sur la grâce emptyTtl, et son échéance sauvegardée reste un nombre', () => {
    const { def } = declare({ emptyTtl: 5 * MINUTE })
    const { endTtl: _absent, ...sansEndTtl } = def   // une définition écrite avant l'option endTtl
    let destroyed = false
    const game: any = createGame(fakeApp(), sansEndTtl as any, () => { destroyed = true }, 'main1')
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    assert.deepEqual(snapshot.timers, [{ name: 'µempty', at: WALL_START + 5 * MINUTE }], 'la sauvegarde ne porte pas l\'échéance de emptyTtl')
    mock.timers.tick(5 * MINUTE - 1)
    assert.equal(destroyed, false, 'la partie finie a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed, true, 'la partie finie n\'a pas été détruite après emptyTtl')
  })

  it('sans endTtl ni emptyTtl non plus, l\'échéance sauvegardée de la partie finie reste un nombre : la sauvegarde se restaure', () => {
    const { def } = declare()
    const { endTtl: _fin, emptyTtl: _vide, ...sansDurees } = def
    const game: any = createGame(fakeApp(), sansDurees as any, () => {}, 'main2')
    game._createSeat(fakeClient('a'))
    game.end({ gagnant: 'a' })
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    assert.ok(snapshot.timers.length > 0, 'la partie finie ne porte aucune minuterie')
    for (const { name, at } of snapshot.timers) assert.equal(typeof at, 'number', `l'échéance de ${name} n'est plus un nombre une fois sauvegardée`)
    assert.doesNotThrow(() => { restoreGame(fakeApp(), def, () => {}, snapshot)._destroy() })
  })
})
