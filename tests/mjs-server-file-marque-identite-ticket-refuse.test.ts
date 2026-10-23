// File publique : le refus d'un ticket (hooks.onJoin rejeté pendant l'appariement) retire ses marques de file — la marque de connexion
// (queuedType) et celle de l'identité (queuedIdentities) — mais seulement celles que CE ticket détient encore. Une connexion fermée
// pendant l'attente a déjà rendu les siennes ; si le même joueur s'est reconnecté et attend en file avec la même identité, la marque
// d'identité appartient à sa nouvelle connexion : le refus de l'ancienne ne doit pas la lui retirer, sinon un second µgame:play de la
// connexion vivante n'est plus idempotent et un groupe peut contenir deux fois le même joueur. Même règle pour un ticket refusé dont la
// connexion est entre-temps passée dans la file d'un autre type de jeu : sa marque de connexion y reste.
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
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const pause     = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

interface Joueur { id: string; sock: any; seen: Array<{ type: string; p: any }> }

function makeClient(transport: MemoryTransport, id: string): Joueur {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  const seen: Array<{ type: string; p: any }> = []
  for (const type of ['µgame:start', 'µgame:end']) sock.on(type, (p: any) => seen.push({ type, p }))
  return { id, sock, seen }
}

const play   = (joueur: Joueur, type: string): Promise<any> => joueur.sock.request('µgame:play', { type })
const coupe  = (joueur: Joueur): void => { joueur.sock.close() }
const starts = (joueur: Joueur): any[] => joueur.seen.filter(e => e.type === 'µgame:start').map(e => e.p)

describe('MJS-Server — file publique : les marques d\'un ticket refusé ne sont retirées que si ce ticket les détient', function () {
  this.timeout(20000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // trio et duo : le PREMIER onJoin de l'identité « intrus » rejette au bout de `attente` ms (les suivants l'acceptent)
  async function serve(attente: number): Promise<MemoryTransport> {
    const transport = new MemoryTransport()
    let refus       = 0
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    await app.listen()
    const common = {
      seatTtl: 5000,
      emptyTtl: 5000,
      state: () => ({ n: 0 }),
      moves: {},
      view: () => ({}),
      hooks: { onJoin: (game: any, player: any) => player.id === 'intrus' && ++refus === 1 ? new Promise((_, rejeter) => setTimeout(() => rejeter(new Error('boum')), attente)) : undefined },
    }
    app.game('trio', { seats: 3, ...common })
    app.game('duo', { seats: 2, ...common })
    return transport
  }

  it('un ticket refusé dont la connexion est fermée ne retire pas la marque de sa nouvelle connexion : le 2e µgame:play reste idempotent', async () => {
    await sansChute(async () => {
      const transport = await serve(100)
      const intrus    = makeClient(transport, 'intrus')
      const bob       = makeClient(transport, 'bob')
      const carol     = makeClient(transport, 'carol')
      const zoe       = makeClient(transport, 'zoe')
      await pause()
      await play(intrus, 'trio')
      await play(bob, 'trio')
      const pendante = play(carol, 'trio').catch(e => 'ERR ' + e)
      await pause(20)
      coupe(intrus)
      coupe(bob)
      await pause(10)
      const intrus2 = makeClient(transport, 'intrus')
      await pause()
      assert.deepEqual(await play(intrus2, 'trio'), { queue: 1 }, 'la nouvelle connexion de l\'intrus attend en file')
      await pendante
      await pause(150)
      const encore = await play(intrus2, 'trio')
      assert.deepEqual(encore, { queue: 2 }, 'le second µgame:play n\'est plus idempotent : ' + JSON.stringify(encore))
      const derniere = await play(zoe, 'trio')
      assert.equal(derniere.seat, 2, 'le groupe attendu est carol, intrus (nouvelle connexion), zoe : ' + JSON.stringify(derniere))
      await pause(30)
      assert.equal(starts(carol)[0]?.seat, 0)
      assert.equal(starts(intrus2)[0]?.seat, 1)
      assert.equal(starts(intrus2).length, 1)
    })
  })

  it('un ticket refusé dont la connexion est passée dans la file d\'un autre type garde sa marque de connexion : sa fermeture le retire de cette file', async () => {
    await sansChute(async () => {
      const transport = await serve(80)
      const intrus    = makeClient(transport, 'intrus')
      const yann      = makeClient(transport, 'yann')
      const alice     = makeClient(transport, 'alice')
      const bob       = makeClient(transport, 'bob')
      await pause()
      await play(intrus, 'duo')
      const pendante = play(yann, 'duo').catch(e => 'ERR ' + e)
      await pause(20)
      assert.deepEqual(await play(intrus, 'trio'), { queue: 1 }, 'l\'intrus passe dans la file du trio pendant l\'attente du duo')
      await pendante
      await pause(120)
      coupe(intrus)
      await pause(30)
      const premiere = await play(alice, 'trio')
      assert.deepEqual(premiere, { queue: 1 }, 'le ticket de la connexion fermée est resté dans la file du trio : ' + JSON.stringify(premiere))
      assert.deepEqual(await play(bob, 'trio'), { queue: 2 })
    })
  })
})
