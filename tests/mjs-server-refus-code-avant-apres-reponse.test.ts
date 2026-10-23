// Un hooks.onJoin qui rend une Promise rejetée refuse le joueur d'une partie par code. Le moment où le rejet est connu décide de la
// forme du refus :
//   - connu AVANT la réponse à sa demande (le crochet rejette sans rien attendre du dehors : async qui lève, Promise.reject, quelques
//     microtâches) : c'est un refus synchrone. La demande échoue avec « votre entrée dans la partie a été refusée », le siège est défait
//     sans trace (ni roster, ni départ, ni µgame:start aux autres joueurs), et aucune fin de partie n'est envoyée au refusé ;
//   - connu APRÈS la réponse (le crochet attend une minuterie, une base de données) : la réponse part d'abord, la fin « entrée refusée »
//     (µgame:end { refused: true, reason: 'join-refused' }) la suit. Jamais avant elle : le client ne connaît pas encore la partie, il
//     ignorerait la fin et croirait la poignée assise alors que le siège est libéré.
// Vrai serveur MJS-Server + vrai client sock.game (mjs_socket.ts + mjs_game.ts concaténés comme le bundler), MemoryTransport. Les
// trames sont relevées sur le fil, dans l'ordre où le client les reçoit.
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

const REFUSED = { refused: true, reason: 'join-refused' }
const MESSAGE = 'votre entrée dans la partie a été refusée'

async function until(condition: () => boolean, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

interface Joueur { id: string; sock: any; fil: string[] }

// un joueur : sa connexion µ.socket et la suite des trames utiles reçues sur le fil (hors accueil et battement) ; une réponse de
// requête s'écrit `ack` (réussie) ou `ack!` (en erreur), une poussée par son type
function makeClient(transport: MemoryTransport, id: string): Joueur {
  const fil: string[] = []
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) {
    const ws: any = transport.connect({ url, protocols })
    let handler: any = null
    Object.defineProperty(ws, 'onmessage', {
      configurable: true,
      get() { return handler },
      set(fn: any) {
        handler = fn ? (ev: any) => {
          const trame = JSON.parse(String(ev.data))
          if (trame.t === 'µ:ack') fil.push(trame.e ? 'ack!' : 'ack')
          else if (!/^µ:(welcome|ping|pong)/.test(trame.t)) fil.push(trame.t)
          fn(ev)
        } : fn
      },
    })
    return ws
  }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return { id, sock, fil }
}

// les rejets que le crochet rend SANS rien attendre du dehors : connus avant que la réponse de la demande ne parte
const IMMEDIATS: Array<[string, () => unknown]> = [
  ['async qui lève', async () => { throw new Error('banni') }],
  ['Promise.reject', () => Promise.reject(new Error('banni'))],
  ['thenable non natif', () => ({ then(_ok: unknown, ko: (err: unknown) => void) { ko(new Error('banni')) } })],
  ['après quelques microtâches', async () => { await null; await Promise.resolve(); await null; throw new Error('banni') }],
]

// le crochet d'un auteur qui refuse l'identité « intrus » par la Promise que rend `rejet`
const refuseIntrus = (rejet: () => unknown) => (game: any, player: any): unknown => player.id === 'intrus' ? rejet() : undefined

// un rejet décidé après `attente` ms
const rejetApres = (attente: number) => (): Promise<never> => new Promise((_, rejeter) => setTimeout(() => rejeter(new Error('banni')), attente))

describe('MJS-Server — partie par code : un onJoin async qui rejette', function () {
  this.timeout(15000)
  let app: MjsServerApp | null = null
  let journal: string[]        = []
  afterEach(async () => { if (app) await app.stop(); app = null })

  async function serve(onJoin: (game: any, player: any) => unknown): Promise<MemoryTransport> {
    const transport = new MemoryTransport()
    journal         = []
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (level: string, message: unknown, meta: any) => { if (level === 'error') journal.push(String(message) + (meta && meta.err instanceof Error ? ' ' + meta.err.message : '')) } })
    await app.listen()
    app.game('salle', {
      seats: 2,
      code: true,
      seatTtl: 5000,
      emptyTtl: 5000,
      state: () => ({ coups: 0 }),
      moves: { jouer: (game: any) => { game.state.coups++ } },
      view: (game: any) => ({ coups: game.state.coups }),
      hooks: { onJoin: onJoin },
    })
    return transport
  }

  // l'hôte crée une partie par code et attend d'être assis ; ses trames de création sont passées, `avant` marque le fil à ce moment
  async function hote(transport: MemoryTransport): Promise<{ host: Joueur; code: string; avant: () => number }> {
    const host = makeClient(transport, 'hote')
    await tick()
    const poignee = host.sock.game('salle', { code: true })
    await until(() => poignee.state.status === 'playing', 'l\'hôte est assis')
    await tick(30)
    const taille = host.fil.length
    return { host, code: poignee.state.code as string, avant: () => taille }
  }

  for (const [nom, rejet] of IMMEDIATS) {
    describe('rejet connu avant la réponse — ' + nom, () => {
      it('créateur : la demande échoue avec le message de refus, la poignée passe en erreur, aucune trame de la partie ni fin', async () => {
        await sansChute(async () => {
          const transport = await serve(refuseIntrus(rejet))
          const intrus    = makeClient(transport, 'intrus')
          await tick()
          const poignee = intrus.sock.game('salle', { code: true })
          await until(() => poignee.state.status === 'error', 'la poignée du refusé passe en erreur')
          assert.equal(poignee.state.error, MESSAGE)
          assert.equal(poignee.state.result, null, 'une fin de partie a été rattachée à la poignée')
          assert.equal(poignee.state.gameId, null)
          assert.equal(poignee.state.seat, null)
          await tick(60)
          assert.equal(poignee.state.status, 'error', 'la poignée a changé de statut après son erreur')
          assert.deepEqual(intrus.fil, ['ack!'], 'le refusé a reçu autre chose que l\'erreur de sa demande')
          assert.equal(journal.filter(m => m.includes('hooks.onJoin') && m.includes('banni')).length, 1, 'le rejet n\'est pas journalisé une fois : ' + JSON.stringify(journal))
        })
      })

      it('invité : la demande échoue, l\'hôte ne voit rien (ni roster, ni départ, ni démarrage), le siège reste libre pour un invité légitime', async () => {
        await sansChute(async () => {
          const transport = await serve(refuseIntrus(rejet))
          const { host, code, avant } = await hote(transport)
          const intrus = makeClient(transport, 'intrus')
          const ami    = makeClient(transport, 'ami')
          await tick()
          const refuse = intrus.sock.game('salle', { code })
          await until(() => refuse.state.status === 'error', 'la poignée du refusé passe en erreur')
          assert.equal(refuse.state.error, MESSAGE)
          await tick(60)
          assert.deepEqual(intrus.fil, ['ack!'], 'le refusé a reçu autre chose que l\'erreur de sa demande')
          assert.deepEqual(host.fil.slice(avant()), [], 'l\'hôte a reçu des trames du joueur refusé')
          const invite = ami.sock.game('salle', { code })
          await until(() => invite.state.status === 'playing', 'l\'invité légitime est assis')
          assert.equal(invite.state.seat, 1, 'le siège du refusé n\'est pas libre')
          await until(() => host.fil.slice(avant()).includes('µgame:start'), 'l\'hôte est prévenu que la partie est complète')
        })
      })

      it('même fil qu\'un refus synchrone (throw) : pour le refusé comme pour l\'hôte', async () => {
        await sansChute(async () => {
          const filsDe = async (crochet: (game: any, player: any) => unknown): Promise<{ intrus: string[]; hote: string[] }> => {
            const transport = await serve(crochet)
            const { host, code, avant } = await hote(transport)
            const intrus = makeClient(transport, 'intrus')
            await tick()
            const poignee = intrus.sock.game('salle', { code })
            await until(() => poignee.state.status === 'error', 'la poignée du refusé passe en erreur')
            await tick(60)
            const fils = { intrus: intrus.fil.slice(), hote: host.fil.slice(avant()) }
            await app!.stop()
            app = null
            return fils
          }
          const synchrone = await filsDe((game, player) => { if (player.id === 'intrus') throw new Error('banni') })
          const promesse  = await filsDe(refuseIntrus(rejet))
          assert.deepEqual(promesse, synchrone)
        })
      })
    })
  }

  describe('deux onglets de la même identité', () => {
    it('le second onglet se rattache au siège encore en attente et a sa réponse : le rejet le refuse alors pour tous, après coup, et l\'hôte voit le départ', async () => {
      await sansChute(async () => {
        const transport = await serve(refuseIntrus(IMMEDIATS[0][1]))
        const { host, code, avant } = await hote(transport)
        const onglet1 = makeClient(transport, 'intrus')
        const onglet2 = makeClient(transport, 'intrus')
        await tick()
        const poignee1 = onglet1.sock.game('salle', { code })   // les deux demandes sont traitées dans la même tâche : la seconde
        const poignee2 = onglet2.sock.game('salle', { code })   // arrive avant que le rejet de la première ne soit rendu
        await until(() => poignee1.state.status === 'error' && poignee2.state.status === 'finished', 'les deux onglets sont refusés')
        assert.equal(poignee1.state.error, MESSAGE)
        assert.deepEqual(poignee2.state.result, REFUSED)
        assert.ok(onglet2.fil.indexOf('ack') >= 0 && onglet2.fil.indexOf('µgame:end') > onglet2.fil.indexOf('ack'), 'le second onglet doit avoir sa réponse avant sa fin : ' + onglet2.fil.join(' | '))
        await until(() => host.fil.slice(avant()).includes('µgame:left'), 'l\'hôte est prévenu du départ du refusé')
        const ami = makeClient(transport, 'ami')
        await tick()
        const invite = ami.sock.game('salle', { code })
        await until(() => invite.state.status === 'playing', 'le siège du refusé est libre')
        assert.equal(invite.state.seat, 1)
      })
    })
  })

  for (const attente of [15, 40]) {
    describe('rejet connu après la réponse (' + attente + ' ms)', () => {
      it('créateur : la réponse de siège part, puis la fin « entrée refusée » — jamais avant la réponse', async () => {
        await sansChute(async () => {
          const transport = await serve(refuseIntrus(rejetApres(attente)))
          const intrus    = makeClient(transport, 'intrus')
          await tick()
          const poignee = intrus.sock.game('salle', { code: true })
          await until(() => poignee.state.status === 'finished', 'la poignée du refusé se termine')
          assert.deepEqual(poignee.state.result, REFUSED)
          assert.equal(poignee.state.seat, 0, 'la poignée a bien été assise par la réponse')
          assert.equal(typeof poignee.state.gameId, 'string')
          const reponse = intrus.fil.indexOf('ack')
          const fin     = intrus.fil.indexOf('µgame:end')
          assert.ok(reponse >= 0 && fin > reponse, 'la fin est partie avant la réponse : ' + intrus.fil.join(' | '))
          assert.equal(intrus.fil.filter(t => t === 'µgame:end').length, 1)
          assert.equal(intrus.fil[intrus.fil.length - 1], 'µgame:end', 'une trame suit la fin : ' + intrus.fil.join(' | '))
        })
      })

      it('invité : l\'hôte voit le départ puis le roster à jour, le refusé reçoit seul sa fin, après sa réponse', async () => {
        await sansChute(async () => {
          const transport = await serve(refuseIntrus(rejetApres(attente)))
          const { host, code, avant } = await hote(transport)
          const intrus = makeClient(transport, 'intrus')
          await tick()
          const refuse = intrus.sock.game('salle', { code })
          await until(() => refuse.state.status === 'finished', 'la poignée du refusé se termine')
          assert.deepEqual(refuse.state.result, REFUSED)
          const reponse = intrus.fil.indexOf('ack')
          assert.ok(reponse >= 0 && intrus.fil.indexOf('µgame:end') > reponse, 'la fin est partie avant la réponse : ' + intrus.fil.join(' | '))
          await until(() => host.fil.slice(avant()).includes('µgame:left'), 'l\'hôte est prévenu du départ du refusé')
          const vuHote = host.fil.slice(avant())
          assert.equal(vuHote.includes('µgame:end'), false, 'l\'hôte a reçu la fin du refusé')
          assert.equal(vuHote[vuHote.indexOf('µgame:left') + 1], 'µgame:seat')
        })
      })
    })
  }

  describe('rejet à la frontière entre les deux', () => {
    const MOMENTS: Array<[string, (rejeter: () => void) => void]> = [
      ['process.nextTick', rejeter => { process.nextTick(rejeter) }],
      ['queueMicrotask', rejeter => queueMicrotask(rejeter)],
      ['setImmediate', rejeter => { setImmediate(rejeter) }],
      ['setTimeout 0', rejeter => { setTimeout(rejeter, 0) }],
      ['setTimeout 1', rejeter => { setTimeout(rejeter, 1) }],
      ['setTimeout 3', rejeter => { setTimeout(rejeter, 3) }],
      ['setTimeout 8', rejeter => { setTimeout(rejeter, 8) }],
    ]
    for (const [nom, declencher] of MOMENTS) {
      it('rejet par ' + nom + ' : soit la demande échoue sans fin de partie, soit la réponse part avant la fin', async () => {
        await sansChute(async () => {
          const rejet     = (): Promise<never> => new Promise((_, rejeter) => declencher(() => rejeter(new Error('banni'))))
          const transport = await serve(refuseIntrus(rejet))
          const intrus    = makeClient(transport, 'intrus')
          await tick()
          const poignee = intrus.sock.game('salle', { code: true })
          await tick(120)
          if (poignee.state.status === 'error') {
            assert.deepEqual(intrus.fil, ['ack!'])
            return
          }
          assert.equal(poignee.state.status, 'finished', 'le refus est resté sans effet : ' + intrus.fil.join(' | '))
          const reponse = intrus.fil.indexOf('ack')
          assert.ok(reponse >= 0 && intrus.fil.indexOf('µgame:end') > reponse, 'la fin est partie avant la réponse : ' + intrus.fil.join(' | '))
        })
      })
    }
  })

  describe('témoins', () => {
    it('une Promise qui ne se règle jamais ne retient pas la demande : la poignée est assise, personne n\'est refusé', async () => {
      await sansChute(async () => {
        const transport = await serve(() => new Promise(() => {}))
        const joueur    = makeClient(transport, 'intrus')
        await tick()
        const poignee = joueur.sock.game('salle', { code: true })
        await until(() => poignee.state.status === 'playing', 'la poignée est assise')
        await tick(60)
        assert.equal(poignee.state.status, 'playing')
        assert.equal(joueur.fil.includes('µgame:end'), false)
        assert.equal(await poignee.move('jouer').then(() => 'accepté', () => 'refusé'), 'accepté')
      })
    })

    it('une Promise déjà résolue ne refuse personne : le roster part une fois, avant la réponse, et l\'hôte voit l\'arrivée', async () => {
      await sansChute(async () => {
        const transport = await serve(() => Promise.resolve())
        const { host, code, avant } = await hote(transport)
        const invite = makeClient(transport, 'ami')
        await tick()
        const poignee = invite.sock.game('salle', { code })
        await until(() => poignee.state.status === 'playing', 'l\'invité est assis')
        await tick(60)
        assert.equal(poignee.state.seat, 1)
        assert.equal(invite.fil.filter(t => t === 'µgame:seat').length, 1, 'le roster est parti plusieurs fois : ' + invite.fil.join(' | '))
        assert.ok(invite.fil.indexOf('µgame:seat') < invite.fil.indexOf('ack'), 'le roster doit précéder la réponse : ' + invite.fil.join(' | '))
        assert.equal(invite.fil.includes('µgame:end'), false)
        await until(() => host.fil.slice(avant()).includes('µgame:start'), 'l\'hôte est prévenu que la partie est complète')
      })
    })

    it('l\'arrêt du serveur pendant le tour de boucle de la demande : elle échoue (partie introuvable) et rien n\'atteint le processus', async () => {
      await sansChute(async () => {
        let arret: Promise<void> | null = null
        const transport = await serve(() => {
          setImmediate(() => { arret = app!.stop() })   // posé avant celui de la demande : le serveur s'arrête pendant son attente
          return new Promise(() => {})
        })
        const joueur = makeClient(transport, 'intrus')
        await tick()
        joueur.sock.game('salle', { code: true })
        await until(() => arret !== null, 'le serveur s\'arrête')
        await arret
        app = null
        await tick(60)
        assert.ok(journal.some(m => /introuvable/.test(m)), 'la demande n\'a pas échoué sur la partie détruite : ' + JSON.stringify(journal))
      })
    })

    it('un crochet sans Promise (rien à attendre) garde la réponse synchrone : le roster, puis la réponse, sans fin', async () => {
      await sansChute(async () => {
        const transport = await serve(() => undefined)
        const joueur    = makeClient(transport, 'intrus')
        await tick()
        const poignee = joueur.sock.game('salle', { code: true })
        await until(() => poignee.state.status === 'playing', 'la poignée est assise')
        await tick(30)
        assert.ok(joueur.fil.indexOf('µgame:seat') < joueur.fil.indexOf('ack'))
        assert.equal(joueur.fil.includes('µgame:end'), false)
      })
    })
  })
})
