// Une partie détruite n'arme plus aucune minuterie. Un hooks.onJoin asynchrone d'un groupe de la file défait avant son annonce peut
// rendre la main APRÈS la destruction de la partie et appeler game.timer() : la minuterie partait quand même, tirait sur une partie
// détruite, et une minuterie longue survivait à app.stop() (un processus qui ne s'arrête plus). Les minuteries du framework
// (µempty, µturn, µmatch) obéissent à la même règle. Instance de partie directe, puis chaîne réelle (mjsServer + clients µ.socket).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))
const timeouts  = (): number => (process as any).getActiveResourcesInfo().filter((name: string) => name === 'Timeout').length

// partie directe à 2 sièges, une minuterie nommée `rappel` ; `appels` compte ses tirs
function directGame(extra: Record<string, any> = {}) {
  const appels: string[] = []
  const def = resolveGameDef('detruite', {
    seats: 2,
    emptyTtl: 5000,
    state: () => ({}),
    view: () => ({}),
    moves: {},
    timers: { rappel: () => { appels.push('rappel') }, 'rappel-long': () => { appels.push('rappel-long') } },
    ...extra,
  }, () => {})
  const game = createGame({ send() {} } as any, def, () => {}, 'detruite1')
  return { game, appels }
}

describe('MJS-Server — aucune minuterie sur une partie détruite (instance de partie)', function () {
  this.timeout(8000)

  it('témoin : sur une partie vivante, game.timer() arme la minuterie et elle tire', async () => {
    await sansChute(async () => {
      const { game, appels } = directGame()
      try {
        game.timer('rappel', 10)
        assert.equal(game._timers.has('rappel'), true)
        await tick(60)
        assert.deepEqual(appels, ['rappel'])
      } finally { game._destroy() }
    })
  })

  it('game.timer() sur une partie détruite n\'arme rien : aucun tir, aucun Timeout vivant', async () => {
    await sansChute(async () => {
      const { game, appels } = directGame()
      game._destroy()
      const avant = timeouts()
      game.timer('rappel', 10)
      game.timer('rappel-long', 300000)
      assert.equal(game._timers.size, 0, 'minuteries armées : ' + Array.from(game._timers.keys()).join(', '))
      assert.equal(timeouts(), avant, 'un Timeout est resté vivant')
      await tick(60)
      assert.deepEqual(appels, [])
    })
  })

  it('les minuteries du framework (µempty, µturn, µmatch) ne sont pas armées non plus sur une partie détruite', async () => {
    await sansChute(async () => {
      const { game } = directGame({ turns: { timeout: 50 } })
      game._destroy()
      const avant = timeouts()
      for (const name of ['µempty', 'µturn', 'µmatch']) game._armByName(name, 10)
      game._checkEmpty()
      assert.equal(game._timers.size, 0, 'minuteries armées : ' + Array.from(game._timers.keys()).join(', '))
      assert.equal(timeouts(), avant, 'un Timeout est resté vivant')
      await tick(60)
    })
  })

  it('une partie finie garde sa règle : le framework y arme sa grâce, l\'appli n\'y arme rien', async () => {
    await sansChute(async () => {
      const { game, appels } = directGame()
      try {
        game.end({})
        game.timer('rappel', 10)
        assert.deepEqual(Array.from(game._timers.keys()), ['µempty'])
        await tick(40)
        assert.deepEqual(appels, [])
      } finally { game._destroy() }
    })
  })
})

// --- chaîne réelle : un onJoin async rend la main après la destruction du groupe ----------------

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

// Alice attend en file, l'intrus complète le groupe et est refusé par un throw : le groupe est défait et sa partie détruite. L'onJoin
// d'Alice, lui, attend 40 ms puis arme `rappel` dans `ms` ms (si `tardive`). Rend le nombre de Timeout vivants juste après app.stop()
// et les états `_destroyed` vus par `rappel`
async function scenario(ms: number, tardive: boolean): Promise<{ apresStop: number; vus: boolean[] }> {
  const vus: boolean[] = []
  const transport      = new MemoryTransport()
  const app            = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
  await app.listen()
  app.game('duo', {
    seats: 2,
    seatTtl: 5000,
    emptyTtl: 5000,
    state: () => ({}),
    moves: {},
    view: () => ({}),
    timers: { rappel: (game: any) => { vus.push(game._destroyed) } },
    hooks: {
      onJoin: (game: any, player: any) => {
        if (player.id === 'intrus') throw new Error('non')
        return (async () => { await tick(40); if (tardive) game.timer('rappel', ms) })()
      },
    },
  })
  const alice  = makeClient(transport, 'alice')
  const intrus = makeClient(transport, 'intrus')
  await tick()
  await alice.request('µgame:play', { type: 'duo' })
  await intrus.request('µgame:play', { type: 'duo' }).catch(() => {})
  await tick(120)
  await app.stop()
  await tick(10)
  const apresStop = timeouts()
  await tick(ms > 1000 ? 10 : 150)
  return { apresStop, vus }
}

describe('MJS-Server — un onJoin async qui arme une minuterie après la destruction du groupe (chaîne réelle)', function () {
  this.timeout(30000)

  it('une minuterie courte armée après la destruction ne tire jamais sur la partie détruite', async () => {
    await sansChute(async () => {
      const court = await scenario(30, true)
      assert.deepEqual(court.vus, [], 'la minuterie a tiré sur une partie détruite : ' + JSON.stringify(court.vus))
    })
  })

  it('une minuterie de 5 minutes armée après la destruction ne survit pas à app.stop()', async () => {
    await sansChute(async () => {
      const temoin = await scenario(300000, false)
      const longue = await scenario(300000, true)
      assert.equal(longue.apresStop, temoin.apresStop, 'une minuterie armée sur la partie détruite a survécu à app.stop()')
    })
  })
})
