// Un joueur refusé par hooks.onJoin alors qu'il ATTENDAIT en file publique reçoit µgame:end { refused: true, reason: 'join-refused' }
// pour une partie qu'il n'a jamais connue : le serveur l'a défaite en silence avant de l'annoncer, et son id ne dit rien au client.
// Sans rattachement, la poignée de sock.game() restait en 'waiting' avec une position périmée, restait dans la file locale des
// poignées pas encore assises (rejouée à la reconnexion, et prête à prendre le µgame:start suivant de la même connexion à la place
// d'une poignée neuve). La trame porte donc le type de jeu et un drapeau `queue: true` qui dit qu'elle vient de la file ; le client la
// rattache à la poignée la plus ancienne encore en file POUR CE TYPE : statut 'finished', résultat de l'entrée refusée, événement
// 'end', sortie de la file locale. Une fin sans ce drapeau (le refus tardif d'une partie par code, déjà finie) n'est jamais rattachée
// à une poignée en file : elle lui volerait sa place.
// Premier groupe : vrai serveur MJS-Server + vrai client sock.game (mjs_socket.ts + mjs_game.ts concaténés comme le bundler),
// MemoryTransport. Second groupe : faux WebSocket, pour maîtriser l'ordre des trames et ce que le client envoie.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8') + '\n' + readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')
const tick      = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

const REFUSED     = { refused: true, reason: 'join-refused' }
const savedSocket = (globalThis as any).WebSocket

async function until(condition: () => boolean, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

const restaurer = (): void => { (globalThis as any).WebSocket = savedSocket }

// --- vrai serveur + vrais clients ---------------------------------------------------------------

type Mode = 'synchrone' | 'par promesse'
const MODES: Mode[] = ['synchrone', 'par promesse']

// le crochet d'un auteur qui refuse l'identité « intrus » tant que `etat.actif` : par un throw, ou par une Promise rejetée au bout de 15 ms
function refuser(mode: Mode, etat: { actif: boolean }): (game: any, player: any) => unknown {
  if (mode === 'synchrone') return (game, player) => { if (etat.actif && player.id === 'intrus') throw new Error('refusé : identité exclue') }
  return (game, player) => etat.actif && player.id === 'intrus' ? new Promise((_, rejet) => setTimeout(() => rejet(new Error('boum-admission')), 15)) : undefined
}

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

// les fins de partie qu'une connexion reçoit, telles que le serveur les envoie (indépendamment de la poignée)
function fins(sock: any): any[] {
  const vues: any[] = []
  sock.on('µgame:end', (p: any) => vues.push(p))
  return vues
}

for (const mode of MODES) {
  describe('sock.game — le refusé qui attendait en file, refus ' + mode + ' (chaîne réelle)', function () {
    this.timeout(15000)
    let app: MjsServerApp | null = null
    afterEach(async () => { if (app) await app.stop(); app = null })
    after(restaurer)

    // jeux `duo` (file publique) et `salle` (parties par code), deux sièges chacun, même crochet onJoin
    async function serve(etat: { actif: boolean }): Promise<MemoryTransport> {
      const transport = new MemoryTransport()
      app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
      await app.listen()
      const common = {
        seats: 2,
        code: true,
        seatTtl: 5000,
        emptyTtl: 5000,
        state: () => ({ coups: 0 }),
        moves: { jouer: (game: any) => { game.state.coups++ } },
        view: (game: any) => ({ coups: game.state.coups }),
        hooks: { onJoin: refuser(mode, etat) },
      }
      app.game('duo', common)
      app.game('salle', common)
      return transport
    }

    it('sa poignée finit en « entrée refusée » : statut, résultat, événement, position périmée retirée ; celle d\'Alice reste en file', async () => {
      await sansChute(async () => {
        const transport = await serve({ actif: true })
        const sockI = makeClient(transport, 'intrus')
        const sockA = makeClient(transport, 'alice')
        await tick()
        const intrus = sockI.game('duo')
        await until(() => intrus.state.queue === 1, 'le refusé est en file')
        const evenements: any[] = []
        intrus.on('end', (p: any) => evenements.push(p))
        const alice = sockA.game('duo')
        await until(() => intrus.state.status === 'finished', 'la poignée du refusé se termine')
        assert.deepEqual(intrus.state.result, REFUSED)
        assert.equal(intrus.state.queue, null, 'la position périmée est restée')
        assert.equal(intrus.state.gameId, null, 'le refusé n\'a jamais eu de partie')
        assert.equal(intrus.state.seat, null)
        assert.equal(intrus.state.error, null, 'une fin n\'est pas une erreur')
        assert.equal(evenements.length, 1, 'l\'événement end est parti ' + evenements.length + ' fois')
        assert.deepEqual(evenements[0].result, REFUSED)
        assert.equal(typeof evenements[0].game, 'string')
        await until(() => alice.state.queue === 1, 'Alice, remise en tête de la file, connaît sa position')
        assert.equal(alice.state.status, 'waiting')
        assert.equal(alice.state.result, null)
      })
    })

    it('témoin : le refusé qui complète le groupe a l\'erreur de sa requête (statut error), sans fin de partie ; celle d\'Alice reste en file', async () => {
      await sansChute(async () => {
        const transport = await serve({ actif: true })
        const sockA = makeClient(transport, 'alice')
        const sockI = makeClient(transport, 'intrus')
        await tick()
        const vues  = fins(sockI)
        const alice = sockA.game('duo')
        await until(() => alice.state.queue === 1, 'Alice est en file')
        const intrus = sockI.game('duo')
        await until(() => intrus.state.status === 'error', 'la poignée du refusé reçoit l\'erreur de sa requête')
        assert.equal(typeof intrus.state.error, 'string')
        assert.equal(intrus.state.result, null)
        await tick(80)
        assert.equal(vues.length, 0, 'le refusé a reçu en plus une fin de partie')
        assert.equal(intrus.state.status, 'error')
        assert.equal(alice.state.status, 'waiting')
        assert.equal(alice.state.queue, 1)
      })
    })

    it('retenter après un refus : le µgame:start suivant de la connexion va à la poignée neuve, jamais à l\'ancienne', async () => {
      await sansChute(async () => {
        const etat      = { actif: true }
        const transport = await serve(etat)
        const sockI = makeClient(transport, 'intrus')
        const sockA = makeClient(transport, 'alice')
        const sockB = makeClient(transport, 'bob')
        const sockC = makeClient(transport, 'carol')
        await tick()
        const vues     = fins(sockI)
        const premiere = sockI.game('duo')
        await until(() => premiere.state.queue === 1, 'le refusé est en file')
        sockA.game('duo')
        await until(() => vues.length === 1, 'le refusé reçoit sa fin')
        etat.actif = false
        const bob = sockB.game('duo')
        await until(() => bob.state.status === 'playing', 'Alice et Bob jouent : la file est vide')
        const seconde = sockI.game('duo')
        await until(() => seconde.state.queue === 1, 'le refusé retente et attend')
        const carol = sockC.game('duo')
        await until(() => carol.state.status === 'playing', 'Carol complète le groupe du refusé')
        await until(() => seconde.state.status === 'playing', 'la poignée neuve du refusé reçoit le µgame:start')
        assert.equal(seconde.state.seat, 0)
        assert.equal(seconde.state.gameId, carol.state.gameId)
        assert.equal(premiere.state.status, 'finished', 'l\'ancienne poignée a repris du service')
        assert.deepEqual(premiere.state.result, REFUSED)
        assert.equal(premiere.state.gameId, null)
        assert.equal(premiere.state.seat, null)
      })
    })

    it('la poignée finie n\'est plus rejouée à la reconnexion (µgame:play) : seule une poignée encore en file l\'est', async () => {
      await sansChute(async () => {
        const transport = await serve({ actif: true })
        const sockI = makeClient(transport, 'intrus')
        const sockA = makeClient(transport, 'alice')
        await tick()
        const vues   = fins(sockI)
        const intrus = sockI.game('duo')
        await until(() => intrus.state.queue === 1, 'le refusé est en file')
        const alice = sockA.game('duo')
        await until(() => vues.length === 1 && alice.state.queue === 1, 'le refusé reçoit sa fin, Alice est remise en file')
        const envois = (sock: any): string[] => {
          const partis: string[] = []
          const request = sock.request.bind(sock)
          sock.request  = (type: string, payload: unknown, opts: unknown) => { partis.push(type); return request(type, payload, opts) }
          sock._mjs_dispatch('welcome', { t: 'welcome', p: {} })
          return partis
        }
        assert.deepEqual(envois(sockA), ['µgame:play'], 'témoin : la poignée d\'Alice, encore en file, est rejouée')
        assert.deepEqual(envois(sockI), [], 'la poignée refusée est rejouée à la reconnexion')
      })
    })

    it('une partie par code déjà assise sur la même connexion n\'est pas touchée par le refus d\'une entrée en file', async () => {
      await sansChute(async () => {
        const etat      = { actif: false }
        const transport = await serve(etat)
        const sockI = makeClient(transport, 'intrus')
        const sockA = makeClient(transport, 'alice')
        await tick()
        const vues  = fins(sockI)
        const salon = sockI.game('salle', { code: true })
        await until(() => salon.state.status === 'playing', 'le refusé crée une partie par code')
        etat.actif = true
        const file = sockI.game('duo')
        await until(() => file.state.queue === 1, 'le refusé est aussi en file')
        sockA.game('duo')
        await until(() => vues.length === 1, 'le refusé reçoit sa fin')
        await until(() => file.state.status === 'finished', 'la poignée de la file se termine')
        assert.deepEqual(file.state.result, REFUSED)
        assert.equal(salon.state.status, 'playing', 'la partie par code a été terminée par le refus de la file')
        assert.equal(salon.state.result, null)
        assert.equal(await salon.move('jouer').then(() => 'accepté', () => 'refusé'), 'accepté', 'la partie par code ne répond plus')
      })
    })
  })
}

describe('sock.game — le refus tardif d\'une partie par code déjà finie ne prend pas la poignée de la file (chaîne réelle)', function () {
  this.timeout(15000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })
  after(restaurer)

  it('la partie par code finit pour de bon, la poignée de la file attend ; le onJoin de la partie rejette 120 ms plus tard : la poignée de la file ne bouge pas', async () => {
    await sansChute(async () => {
      const transport = new MemoryTransport()
      app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
      await app.listen()
      app.game('salle', {
        seats: 1,
        code: true,
        seatTtl: 5000,
        emptyTtl: 5000,
        state: () => ({}),
        view: () => ({}),
        moves: { fin: (game: any) => game.end({ gagne: true }) },
        hooks: { onJoin: () => new Promise((_, rejet) => setTimeout(() => rejet(new Error('tardif')), 120)) },
      })
      app.game('duo', { seats: 2, seatTtl: 5000, emptyTtl: 5000, state: () => ({}), view: () => ({}), moves: {} })
      const sock = makeClient(transport, 'joueur')
      await tick()
      const vues  = fins(sock)
      const salon = sock.game('salle', { code: true })
      await until(() => salon.state.status === 'playing', 'le joueur est assis dans la partie par code')
      await salon.move('fin')
      await until(() => salon.state.status === 'finished', 'la partie par code finit pour de bon')
      const file = sock.game('duo')
      await until(() => file.state.queue === 1, 'le joueur attend en file')
      await until(() => vues.some(p => p.result && p.result.refused === true), 'le refus tardif de la partie par code arrive', 2000)
      await tick(40)
      assert.equal(file.state.status, 'waiting', 'le refus tardif d\'une autre partie a fini la poignée de la file')
      assert.equal(file.state.queue, 1)
      assert.equal(file.state.result, null)
      assert.deepEqual(salon.state.result, { gagne: true }, 'la partie par code a perdu son issue réelle')
    })
  })
})

// --- faux WebSocket : l'ordre des trames est celui du test ---------------------------------------

class FauxWS {
  static instances: FauxWS[] = []
  url: string; readyState = 0; sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; FauxWS.instances.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  serveur(trame: any) { this.onmessage && this.onmessage({ data: JSON.stringify(trame) }) }
}

describe('sock.game — la fin « entrée refusée » d\'une partie inconnue (faux WebSocket)', function () {
  this.timeout(8000)
  let erreurs: unknown[][] = []
  after(restaurer)

  // un client neuf : les erreurs que le client attrape pour ses crochets d'appli sont gardées, aucune ne doit passer en silence
  function client(): any {
    erreurs = []
    const µ: any = { state: (i: any) => ({ ...i }), error: (...args: unknown[]) => erreurs.push(args), warn: () => {}, log: () => {} }
    ;(globalThis as any).WebSocket = FauxWS
    new Function('µ', clientSrc)(µ)
    return µ.socket('wss://faux-' + FauxWS.instances.length, { reconnect: { enabled: false }, heartbeat: 0 })
  }

  // ouverture puis accueil : les requêtes mises en attente par sock.game() partent alors
  function accueillir(): FauxWS {
    const ws = FauxWS.instances[FauxWS.instances.length - 1]
    ws.ouvrir()
    ws.serveur({ t: 'µ:welcome', p: {} })
    return ws
  }

  // la requête µgame:play de la file publique (sans code), ou celle du code donné
  const requete = (ws: FauxWS, code?: string | boolean): any => ws.sent.find((m: any) => m.t === 'µgame:play' && m.p.code === code)
  const enFile  = (ws: FauxWS, code: string | boolean | undefined, position: number): void => ws.serveur({ t: 'µ:ack', id: requete(ws, code).id, p: { queue: position } })
  const assise  = (ws: FauxWS, code: string | boolean | undefined, game: string, seat: number): void => ws.serveur({ t: 'µ:ack', id: requete(ws, code).id, p: { game: game, seat: seat, phase: null, turn: null, seq: 1, code: 'ABCDE', view: {} } })
  const refus   = (game: string, type = 'duo') => ({ t: 'µgame:end', p: { game: game, type: type, queue: true, result: REFUSED } })

  beforeEach(() => { FauxWS.instances = [] })

  it('la fin arrive dans la même tâche que l\'ack de file (l\'ack d\'abord) : la poignée finit, l\'ack tardif ne la remet pas en file', async () => {
    const sock = client()
    const h    = sock.game('duo')
    const ws   = accueillir()
    enFile(ws, undefined, 1)
    ws.serveur(refus('game7'))
    await tick()
    assert.equal(h.state.status, 'finished', 'l\'ack tardif a remis la poignée refusée en file')
    assert.equal(h.state.queue, null)
    assert.deepEqual(h.state.result, REFUSED)
    assert.deepEqual(erreurs, [])
  })

  it('la fin arrive avant toute réponse à la requête : la poignée finit aussi', async () => {
    const sock = client()
    const h    = sock.game('duo')
    const ws   = accueillir()
    ws.serveur(refus('game7'))
    assert.equal(h.state.status, 'finished')
    assert.deepEqual(h.state.result, REFUSED)
    await tick()
    assert.equal(h.state.status, 'finished')
  })

  it('une fin ordinaire d\'une partie inconnue (ni entrée refusée) est ignorée : la poignée en file ne bouge pas', async () => {
    const sock = client()
    const h    = sock.game('duo')
    const ws   = accueillir()
    enFile(ws, undefined, 2)
    await tick()
    ws.serveur({ t: 'µgame:end', p: { game: 'game7', result: { gagnant: 'x' } } })
    ws.serveur({ t: 'µgame:end', p: { game: 'game7', result: { cancelled: true, reason: 'seat-expired' } } })
    ws.serveur({ t: 'µgame:end', p: { game: 'game7', result: { refused: false } } })
    ws.serveur({ t: 'µgame:end', p: { game: 'game7', result: 'refused' } })
    ws.serveur({ t: 'µgame:end', p: { game: 'game7', result: null } })
    ws.serveur({ t: 'µgame:end', p: { game: 'game7' } })
    await tick()
    assert.equal(h.state.status, 'waiting')
    assert.equal(h.state.queue, 2)
    assert.equal(h.state.result, null)
    assert.deepEqual(erreurs, [])
  })

  it('sans poignée en file, la fin est ignorée sans erreur', async () => {
    const sock = client()
    const h    = sock.game('duo')
    const ws   = accueillir()
    enFile(ws, undefined, 1)
    await tick()
    h.leave()
    ws.serveur(refus('game7'))
    await tick()
    assert.equal(h.state.status, 'left')
    assert.equal(h.state.result, null)
    assert.deepEqual(erreurs, [])
  })

  it('la fin d\'une partie connue garde son chemin : seule cette poignée finit, celle qui attend en file ne bouge pas', async () => {
    const sock  = client()
    const salon = sock.game('duo', { code: true })
    const file  = sock.game('duo')
    const ws    = accueillir()
    assise(ws, true, 'game3', 0)
    enFile(ws, undefined, 1)
    await tick()
    assert.equal(salon.state.status, 'playing')
    ws.serveur(refus('game3'))
    await tick()
    assert.equal(salon.state.status, 'finished')
    assert.deepEqual(salon.state.result, REFUSED)
    assert.equal(salon.state.gameId, 'game3', 'la partie connue garde son id')
    assert.equal(file.state.status, 'waiting', 'la fin d\'une partie connue a pris la poignée en file')
    assert.equal(file.state.queue, 1)
    assert.equal(file.state.result, null)
  })

  it('une poignée par code qui attend sa réponse n\'est jamais prise pour un ticket de file : la fin va à la poignée de la file, même plus récente', async () => {
    const sock  = client()
    const salon = sock.game('duo', { code: 'ABCDE' })
    const file  = sock.game('duo')
    const ws    = accueillir()
    enFile(ws, undefined, 1)
    await tick()
    ws.serveur(refus('game7'))
    await tick()
    assert.equal(file.state.status, 'finished')
    assert.deepEqual(file.state.result, REFUSED)
    assert.equal(salon.state.status, 'waiting', 'la poignée par code a été prise pour un ticket de file')
    assert.equal(salon.state.result, null)
    assise(ws, 'ABCDE', 'game3', 1)
    await tick()
    assert.equal(salon.state.status, 'playing', 'la réponse de la partie par code n\'est plus prise en compte')
    assert.equal(salon.state.seat, 1)
  })

  it('deux poignées en file sur la même connexion : la fin va à celle du type que la trame nomme, même si l\'autre est plus ancienne', async () => {
    const sock     = client()
    const premiere = sock.game('duo')
    const seconde  = sock.game('trio')
    const ws       = accueillir()
    ws.serveur({ t: 'µ:ack', id: ws.sent.find((m: any) => m.t === 'µgame:play' && m.p.type === 'duo').id, p: { queue: 1 } })
    ws.serveur({ t: 'µ:ack', id: ws.sent.find((m: any) => m.t === 'µgame:play' && m.p.type === 'trio').id, p: { queue: 1 } })
    await tick()
    ws.serveur(refus('game7', 'trio'))
    await tick()
    assert.equal(seconde.state.status, 'finished')
    assert.deepEqual(seconde.state.result, REFUSED)
    assert.equal(premiere.state.status, 'waiting', 'la poignée du duo, plus ancienne, a pris le refus du trio')
    assert.equal(premiere.state.queue, 1)
    assert.equal(premiere.state.result, null)
    ws.serveur(refus('game8', 'duo'))
    await tick()
    assert.equal(premiere.state.status, 'finished')
    assert.deepEqual(premiere.state.result, REFUSED)
  })

  it('une fin de la file pour un type qu\'aucune poignée en file n\'attend est ignorée : les autres poignées ne bougent pas', async () => {
    const sock = client()
    const h    = sock.game('duo')
    const ws   = accueillir()
    enFile(ws, undefined, 1)
    await tick()
    ws.serveur(refus('game7', 'trio'))
    ws.serveur({ t: 'µgame:end', p: { game: 'game8', queue: true, result: REFUSED } })
    await tick()
    assert.equal(h.state.status, 'waiting')
    assert.equal(h.state.queue, 1)
    assert.equal(h.state.result, null)
    assert.deepEqual(erreurs, [])
  })

  it('une fin « entrée refusée » sans le drapeau de la file (refus tardif d\'une partie par code déjà finie) ne prend pas la poignée en file', async () => {
    const sock  = client()
    const salon = sock.game('duo', { code: true })
    const file  = sock.game('duo')
    const ws    = accueillir()
    assise(ws, true, 'game3', 0)
    enFile(ws, undefined, 1)
    await tick()
    ws.serveur({ t: 'µgame:end', p: { game: 'game3', result: { gagne: true } } })
    await tick()
    assert.equal(salon.state.status, 'finished')
    ws.serveur({ t: 'µgame:end', p: { game: 'game3', result: REFUSED } })
    ws.serveur({ t: 'µgame:end', p: { game: 'game3', type: 'duo', result: REFUSED } })
    await tick()
    assert.equal(file.state.status, 'waiting', 'le refus d\'une partie par code a pris la poignée de la file')
    assert.equal(file.state.queue, 1)
    assert.equal(file.state.result, null)
    assert.deepEqual(salon.state.result, { gagne: true }, 'la partie par code a perdu son issue réelle')
    assert.deepEqual(erreurs, [])
  })

  it('le µgame:start qui suit va à la poignée restée en file, plus à celle de la fin refusée', async () => {
    const sock     = client()
    const premiere = sock.game('duo')
    const ws       = accueillir()
    enFile(ws, undefined, 1)
    await tick()
    ws.serveur(refus('game7'))
    const seconde = sock.game('duo')
    ws.serveur({ t: 'µ:ack', id: ws.sent.filter((m: any) => m.t === 'µgame:play')[1].id, p: { queue: 1 } })
    await tick()
    ws.serveur({ t: 'µgame:start', p: { game: 'game8', seat: 0, phase: null, turn: null, seq: 1, code: null, view: {} } })
    assert.equal(seconde.state.status, 'playing')
    assert.equal(seconde.state.gameId, 'game8')
    assert.equal(premiere.state.status, 'finished')
    assert.equal(premiere.state.gameId, null)
    assert.deepEqual(erreurs, [])
  })
})
