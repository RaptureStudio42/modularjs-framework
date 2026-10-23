// File publique, un joueur refusé par hooks.onJoin : la partie n'est annoncée (« la partie commence ») qu'une fois TOUS les joueurs
// appariés assis et passés par onJoin (une Promise rendue est attendue). Un refus — throw ou Promise rejetée — défait l'appariement
// sans bruit : la partie est annulée, les autres joueurs retournent en tête de la file, dans leur ordre, et y attendent un autre
// adversaire sans rien recevoir (ni µgame:start, ni fin de partie, ni roster, ni état). Le refusé reçoit µgame:end
// { refused: true, reason: 'join-refused' } ; s'il est le dernier arrivé, dont la requête µgame:play est encore en cours, il reçoit
// à la place l'erreur de sa requête (celle de onJoin, ou « entrée refusée » quand le refus vient d'une Promise).
// Chaîne réelle : mjsServer + clients µ.socket sur MemoryTransport, vraie horloge, durées courtes.
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
const pause     = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

const REFUSED = { refused: true, reason: 'join-refused' }
const PUSHES  = ['µgame:start', 'µgame:state', 'µgame:seat', 'µgame:event', 'µgame:end', 'µgame:left']

type Mode = 'synchrone' | 'par promesse'
const MODES: Mode[] = ['synchrone', 'par promesse']

interface Frame { type: string; p: any }
interface Joueur { id: string; sock: any; seen: Frame[] }

async function until(condition: () => boolean, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await pause(5)
  }
}

// une Promise que le test résout ou rejette quand il le décide
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// un joueur : sa connexion µ.socket et tout ce qu'elle reçoit de la partie, dans l'ordre
function makeClient(transport: MemoryTransport, id: string): Joueur {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  const seen: Frame[] = []
  for (const type of PUSHES) sock.on(type, (p: any) => seen.push({ type, p }))
  return { id, sock, seen }
}

const play  = (joueur: Joueur, type: string): Promise<any> => joueur.sock.request('µgame:play', { type })
const types = (joueur: Joueur): string[] => joueur.seen.map(e => e.type)

// message du refus, ou null si la requête a réussi
async function refusal(request: Promise<unknown>): Promise<string | null> {
  try { await request; return null } catch (e) { return String(e) }
}

const silence = (joueur: Joueur, qui: string): void => assert.deepEqual(types(joueur), [], qui + ' a reçu des trames alors que sa partie n\'a jamais commencé : ' + types(joueur).join(', '))

// le crochet d'un auteur qui refuse les identités « intrus… » : par un throw, ou par une Promise rejetée au bout de 15 ms
function refuser(mode: Mode): (game: any, player: any) => unknown {
  if (mode === 'synchrone') return (game, player) => { if (player.id.startsWith('intrus')) throw new Error('refusé : identité exclue') }
  return (game, player) => player.id.startsWith('intrus') ? new Promise((_, rejet) => setTimeout(() => rejet(new Error('boum-admission')), 15)) : undefined
}

const MESSAGE_REFUS: Record<Mode, RegExp> = { 'synchrone': /refusé : identité exclue/, 'par promesse': /entrée dans la partie a été refusée/ }

describe('MJS-Server — file publique : un joueur refusé par onJoin défait l\'appariement sans bruit (chaîne réelle)', function () {
  this.timeout(15000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un jeu `duo` (2 sièges) et un jeu `trio` (3 sièges), onJoin du mode demandé ; `extra` complète ou remplace leur déclaration
  async function serve(hook: (game: any, player: any) => unknown, extra: Record<string, any> = {}): Promise<MemoryTransport> {
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    await app.listen()
    const common = {
      seatTtl: 5000,
      emptyTtl: 5000,
      state: () => ({ coups: 0 }),
      moves: { jouer: (game: any) => { game.state.coups++ } },
      view: (game: any, player: any) => ({ coups: game.state.coups, vous: player ? player.id : null }),
      hooks: { onJoin: hook },
      ...extra,
    }
    app.game('duo', { seats: 2, ...common })
    app.game('trio', { seats: 3, ...common })
    return transport
  }

  // après l'échec de l'appariement, un nouveau joueur arrive et complète la file : la partie commence avec ceux qui attendaient
  // en tête, dans leur ordre ; chacun reçoit son µgame:start (sauf le dernier arrivé, qui a sa réponse) et ils jouent ensemble
  async function jouerEnsuite(type: string, attendants: Joueur[], dernier: Joueur): Promise<void> {
    const assise = await play(dernier, type)
    assert.equal(assise.seat, attendants.length, 'le dernier arrivé n\'a pas le dernier siège')
    for (let i = 0; i < attendants.length; i++) {
      const joueur = attendants[i]
      await until(() => types(joueur).includes('µgame:start'), joueur.id + ' reçoit µgame:start')
      const departs = joueur.seen.filter(e => e.type === 'µgame:start')
      assert.equal(departs.length, 1, joueur.id + ' a reçu ' + departs.length + ' µgame:start')
      assert.equal(departs[0].p.seat, i, joueur.id + ' n\'a pas gardé son rang dans la file')
      assert.equal(departs[0].p.game, assise.game)
    }
    await dernier.sock.request('µgame:move', { game: assise.game, move: 'jouer' })
    for (const joueur of attendants) await until(() => joueur.seen.some(e => e.type === 'µgame:state' && e.p.view?.coups === 1), joueur.id + ' voit le coup de ' + dernier.id)
  }

  for (const mode of MODES) {
    describe('refus ' + mode, () => {
      it('deux joueurs, le refusé complète le groupe : il a l\'erreur de sa requête, Alice reste en file sans rien recevoir et joue ensuite contre le suivant', async () => {
        await sansChute(async () => {
          // la partie du groupe défait, relevée à sa création
          const creees: string[] = []
          const hook      = refuser(mode)
          const transport = await serve(hook, { hooks: { onJoin: hook, onCreate: (game: any) => { creees.push(game.id) } } })
          const alice  = makeClient(transport, 'alice')
          const intrus = makeClient(transport, 'intrus')
          const carol  = makeClient(transport, 'carol')
          await pause()
          assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
          assert.match(String(await refusal(play(intrus, 'duo'))), MESSAGE_REFUS[mode])
          await pause(80)
          silence(alice, 'Alice')
          silence(intrus, 'le refusé, qui a déjà l\'erreur de sa requête,')
          assert.equal(creees.length, 1)
          assert.match(String(await refusal(alice.sock.request('µgame:resync', { game: creees[0] }))), /introuvable/, 'la partie défaite existe encore')
          await jouerEnsuite('duo', [alice], carol)
        })
      })

      it('deux joueurs, le refusé attendait en file : il reçoit µgame:end { refused }, Alice reste en tête sans rien recevoir et joue ensuite contre le suivant', async () => {
        await sansChute(async () => {
          const transport = await serve(refuser(mode))
          const intrus = makeClient(transport, 'intrus')
          const alice  = makeClient(transport, 'alice')
          const carol  = makeClient(transport, 'carol')
          await pause()
          assert.deepEqual(await play(intrus, 'duo'), { queue: 1 })
          assert.deepEqual(await play(alice, 'duo'), { queue: 1 }, 'Alice, qui complétait le groupe, n\'est pas remise en file')
          await until(() => types(intrus).includes('µgame:end'), 'le refusé reçoit sa fin')
          await pause(80)
          assert.deepEqual(types(intrus), ['µgame:end'], 'le refusé a reçu autre chose que sa seule fin : ' + types(intrus).join(', '))
          assert.deepEqual(intrus.seen[0].p.result, REFUSED)
          assert.equal(typeof intrus.seen[0].p.game, 'string')
          assert.equal(intrus.seen[0].p.type, 'duo', 'la fin du refusé de la file doit nommer le type de jeu')
          assert.equal(intrus.seen[0].p.queue, true, 'la fin du refusé de la file doit dire qu\'elle vient de la file')
          silence(alice, 'Alice')
          assert.match(String(await refusal(intrus.sock.request('µgame:resync', { game: intrus.seen[0].p.game }))), /introuvable/, 'la partie défaite existe encore')
          await jouerEnsuite('duo', [alice], carol)
        })
      })

      it('le refusé qui retente plusieurs fois ne change rien pour Alice : toujours seule en file, toujours muette, et la partie suivante est la sienne', async () => {
        await sansChute(async () => {
          const transport = await serve(refuser(mode))
          const alice  = makeClient(transport, 'alice')
          const intrus = makeClient(transport, 'intrus')
          const carol  = makeClient(transport, 'carol')
          await pause()
          assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
          for (let i = 0; i < 3; i++) {
            assert.match(String(await refusal(play(intrus, 'duo'))), MESSAGE_REFUS[mode], 'la tentative ' + (i + 1) + ' du refusé n\'est pas refusée')
            await pause(40)
          }
          silence(alice, 'Alice')
          await jouerEnsuite('duo', [alice], carol)
        })
      })

      it('trois joueurs, le refusé est au milieu : Alice et Bob reviennent en tête dans leur ordre, sans rien recevoir', async () => {
        await sansChute(async () => {
          const transport = await serve(refuser(mode))
          const alice  = makeClient(transport, 'alice')
          const intrus = makeClient(transport, 'intrus')
          const bob    = makeClient(transport, 'bob')
          const carol  = makeClient(transport, 'carol')
          await pause()
          assert.deepEqual(await play(alice, 'trio'), { queue: 1 })
          assert.deepEqual(await play(intrus, 'trio'), { queue: 2 })
          assert.deepEqual(await play(bob, 'trio'), { queue: 2 }, 'Bob, qui complétait le groupe, n\'est pas remis en file derrière Alice')
          await until(() => types(intrus).includes('µgame:end'), 'le refusé reçoit sa fin')
          await pause(80)
          assert.deepEqual(types(intrus), ['µgame:end'])
          assert.deepEqual(intrus.seen[0].p.result, REFUSED)
          silence(alice, 'Alice')
          silence(bob, 'Bob')
          await jouerEnsuite('trio', [alice, bob], carol)
        })
      })

      it('trois joueurs, le refusé est le dernier arrivé : il a l\'erreur de sa requête, Alice et Bob gardent leur place sans rien recevoir', async () => {
        await sansChute(async () => {
          const transport = await serve(refuser(mode))
          const alice  = makeClient(transport, 'alice')
          const bob    = makeClient(transport, 'bob')
          const intrus = makeClient(transport, 'intrus')
          const carol  = makeClient(transport, 'carol')
          await pause()
          assert.deepEqual(await play(alice, 'trio'), { queue: 1 })
          assert.deepEqual(await play(bob, 'trio'), { queue: 2 })
          assert.match(String(await refusal(play(intrus, 'trio'))), MESSAGE_REFUS[mode])
          await pause(80)
          silence(alice, 'Alice')
          silence(bob, 'Bob')
          silence(intrus, 'le refusé, qui a déjà l\'erreur de sa requête,')
          await jouerEnsuite('trio', [alice, bob], carol)
        })
      })

      it('trois joueurs, le refusé est le premier : Alice et Bob, derrière lui, passent en tête dans leur ordre', async () => {
        await sansChute(async () => {
          const transport = await serve(refuser(mode))
          const intrus = makeClient(transport, 'intrus')
          const alice  = makeClient(transport, 'alice')
          const bob    = makeClient(transport, 'bob')
          const carol  = makeClient(transport, 'carol')
          await pause()
          assert.deepEqual(await play(intrus, 'trio'), { queue: 1 })
          assert.deepEqual(await play(alice, 'trio'), { queue: 2 })
          assert.deepEqual(await play(bob, 'trio'), { queue: 2 })
          await until(() => types(intrus).includes('µgame:end'), 'le refusé reçoit sa fin')
          await pause(80)
          assert.deepEqual(types(intrus), ['µgame:end'])
          assert.deepEqual(intrus.seen[0].p.result, REFUSED)
          silence(alice, 'Alice')
          silence(bob, 'Bob')
          await jouerEnsuite('trio', [alice, bob], carol)
        })
      })
    })
  }

  describe('refus par promesse : l\'appariement attend tous les onJoin', () => {
    it('sans refus, « la partie commence » n\'est annoncée qu\'une fois tous les onJoin passés : Alice ne reçoit rien et Bob n\'a pas sa réponse tant qu\'ils durent', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = await serve((game: any, player: any) => player.id === 'bob' ? porte.promise : undefined)
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        let reponse: any = null
        const requete = play(bob, 'duo').then(r => { reponse = r })
        await pause(60)
        assert.equal(reponse, null, 'Bob a eu sa réponse avant la fin de son onJoin')
        silence(alice, 'Alice')
        silence(bob, 'Bob')
        porte.resolve()
        await requete
        assert.equal(reponse.seat, 1)
        await until(() => types(alice).includes('µgame:start'), 'Alice reçoit µgame:start une fois les onJoin passés')
        assert.equal(alice.seen.filter(e => e.type === 'µgame:start').length, 1)
        assert.equal(alice.seen.find(e => e.type === 'µgame:start')!.p.seat, 0)
      })
    })

    it('en mode action, la boucle de tick ne démarre qu\'à l\'annonce : pendant l\'attente des onJoin, Alice ne reçoit aucun état', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = new MemoryTransport()
        app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
        await app.listen()
        app.game('monde', {
          seats: 2,
          tick: 20,
          seatTtl: 5000,
          emptyTtl: 5000,
          state: () => ({ n: 0 }),
          moves: {},
          intents: { rien: () => {} },
          simulate: (game: any) => { game.state.n++ },
          view: (game: any) => ({ n: game.state.n }),
          hooks: { onJoin: (game: any, player: any) => player.id === 'bob' ? porte.promise : undefined },
        })
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        await pause()
        assert.deepEqual(await play(alice, 'monde'), { queue: 1 })
        const requete = play(bob, 'monde')
        await pause(250)   // cinq ticks à 20 Hz s'ils tournaient déjà
        silence(alice, 'Alice')
        porte.resolve()
        await requete
        await until(() => alice.seen.filter(e => e.type === 'µgame:state').length >= 2, 'la boucle de tick tourne une fois la partie annoncée')
        assert.equal(alice.seen[0].type, 'µgame:seat', 'le roster ouvre l\'annonce')
        assert.equal(alice.seen.filter(e => e.type === 'µgame:start').length, 1)
      })
    })

    it('un arrivant pendant l\'attente est mis en file derrière, puis apparié avec Alice quand le refus de Bob la remet en tête', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = await serve((game: any, player: any) => player.id === 'bob' ? porte.promise : undefined)
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        const carol = makeClient(transport, 'carol')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        const requeteBob = refusal(play(bob, 'duo'))
        await pause(40)
        assert.deepEqual(await play(carol, 'duo'), { queue: 1 }, 'Carol, arrivée pendant l\'attente du groupe d\'Alice, n\'est pas en file')
        silence(alice, 'Alice')
        porte.reject(new Error('boum-admission'))
        assert.match(String(await requeteBob), MESSAGE_REFUS['par promesse'])
        await until(() => types(alice).includes('µgame:start') && types(carol).includes('µgame:start'), 'Alice et Carol reçoivent µgame:start')
        const departA = alice.seen.filter(e => e.type === 'µgame:start')
        const departC = carol.seen.filter(e => e.type === 'µgame:start')
        assert.equal(departA.length, 1)
        assert.equal(departC.length, 1)
        assert.equal(departA[0].p.seat, 0, 'Alice, remise en tête, n\'a pas le premier siège')
        assert.equal(departC[0].p.seat, 1)
        assert.equal(departA[0].p.game, departC[0].p.game)
        silence(bob, 'Bob')
      })
    })

    it('Alice qui rejoue pendant l\'attente garde un seul ticket : remise en file, elle n\'est pas appariée avec elle-même', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = await serve((game: any, player: any) => player.id === 'bob' ? porte.promise : undefined)
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        const carol = makeClient(transport, 'carol')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        const requeteBob = refusal(play(bob, 'duo'))
        await pause(40)
        const rejeu = await play(alice, 'duo')
        assert.equal(typeof rejeu.queue, 'number', 'Alice, déjà en file, a eu un siège en rejouant')
        porte.reject(new Error('boum-admission'))
        assert.match(String(await requeteBob), MESSAGE_REFUS['par promesse'])
        await pause(60)
        silence(alice, 'Alice')
        await jouerEnsuite('duo', [alice], carol)
      })
    })

    it('une connexion fermée pendant l\'attente n\'est ni assise ni remise en file : Bob attend seul et joue contre le suivant', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = await serve((game: any, player: any) => player.id === 'bob' ? porte.promise : undefined)
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        const carol = makeClient(transport, 'carol')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        const requeteBob = play(bob, 'duo')
        await pause(40)
        alice.sock.close()
        await pause(40)
        porte.resolve()
        assert.deepEqual(await requeteBob, { queue: 1 }, 'Bob n\'est pas remis en file seul')
        await pause(40)
        silence(bob, 'Bob')
        await jouerEnsuite('duo', [bob], carol)
      })
    })

    it('le dernier arrivé dont la connexion se ferme pendant l\'attente n\'est ni assis ni remis en file : Alice attend seule et joue contre le suivant', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = await serve((game: any, player: any) => player.id === 'bob' ? porte.promise : undefined)
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        const carol = makeClient(transport, 'carol')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        play(bob, 'duo').catch(() => {})   // la requête de Bob ne reçoit jamais de réponse : sa connexion est fermée avant
        await pause(40)
        bob.sock.close()
        await pause(40)
        porte.resolve()
        await pause(60)
        silence(alice, 'Alice')
        await jouerEnsuite('duo', [alice], carol)
      })
    })

    it('l\'arrêt du serveur pendant l\'attente d\'un onJoin détruit la partie muette : la fin de l\'attente ne remonte aucune erreur', async () => {
      await sansChute(async () => {
        const porte = deferred()
        const transport = await serve((game: any, player: any) => player.id === 'bob' ? porte.promise : undefined)
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        play(bob, 'duo').catch(() => {})
        await pause(40)
        await app!.stop()
        app = null
        porte.resolve()
        await pause(60)
        silence(alice, 'Alice')
      })
    })

    it('deux refusés dans le même groupe reçoivent chacun leur fin, le dernier arrivé garde sa place', async () => {
      await sansChute(async () => {
        const transport = await serve(refuser('par promesse'))
        const intrus1 = makeClient(transport, 'intrus1')
        const intrus2 = makeClient(transport, 'intrus2')
        const alice   = makeClient(transport, 'alice')
        const bob     = makeClient(transport, 'bob')
        const carol   = makeClient(transport, 'carol')
        await pause()
        assert.deepEqual(await play(intrus1, 'trio'), { queue: 1 })
        assert.deepEqual(await play(intrus2, 'trio'), { queue: 2 })
        assert.deepEqual(await play(alice, 'trio'), { queue: 1 })
        await until(() => types(intrus1).includes('µgame:end') && types(intrus2).includes('µgame:end'), 'les deux refusés reçoivent leur fin')
        await pause(60)
        for (const refuse of [intrus1, intrus2]) {
          assert.deepEqual(types(refuse), ['µgame:end'], refuse.id + ' a reçu autre chose que sa seule fin')
          assert.deepEqual(refuse.seen[0].p.result, REFUSED)
        }
        silence(alice, 'Alice')
        assert.deepEqual(await play(bob, 'trio'), { queue: 2 })
        await jouerEnsuite('trio', [alice, bob], carol)
      })
    })
  })

  describe('hooks.onCreate qui lève en file publique', () => {
    it('deux joueurs : la requête qui complétait le groupe a l\'erreur, Alice garde sa place sans rien recevoir et joue ensuite contre le suivant', async () => {
      await sansChute(async () => {
        let essais = 0
        const transport = await serve(() => {}, { hooks: { onCreate: () => { if (essais++ === 0) throw new Error('boum-creation') } } })
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        const carol = makeClient(transport, 'carol')
        await pause()
        assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
        assert.match(String(await refusal(play(bob, 'duo'))), /boum-creation/)
        await pause(60)
        silence(alice, 'Alice')
        silence(bob, 'Bob')
        await jouerEnsuite('duo', [alice], carol)
      })
    })

    it('trois joueurs : Alice et Bob gardent leur place dans leur ordre', async () => {
      await sansChute(async () => {
        let essais = 0
        const transport = await serve(() => {}, { hooks: { onCreate: () => { if (essais++ === 0) throw new Error('boum-creation') } } })
        const alice = makeClient(transport, 'alice')
        const bob   = makeClient(transport, 'bob')
        const carol = makeClient(transport, 'carol')
        const dave  = makeClient(transport, 'dave')
        await pause()
        assert.deepEqual(await play(alice, 'trio'), { queue: 1 })
        assert.deepEqual(await play(bob, 'trio'), { queue: 2 })
        assert.match(String(await refusal(play(carol, 'trio'))), /boum-creation/)
        await pause(60)
        silence(alice, 'Alice')
        silence(bob, 'Bob')
        await jouerEnsuite('trio', [alice, bob], dave)
      })
    })
  })

  describe('témoin : sans refus', () => {
    it('Alice reçoit µgame:start et Bob sa réponse, comme avant', async () => {
      const transport = await serve(() => {})
      const alice = makeClient(transport, 'alice')
      const bob   = makeClient(transport, 'bob')
      await pause()
      assert.deepEqual(await play(alice, 'duo'), { queue: 1 })
      await jouerEnsuite('duo', [alice], bob)
      assert.ok(types(alice).includes('µgame:seat'), 'Alice n\'a pas reçu le roster')
      assert.ok(types(alice).includes('µgame:state'), 'Alice n\'a pas reçu l\'état')
    })
  })
})
