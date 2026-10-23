// Ce que ce test garantit : la sauvegarde différée de MJS-Server a un plafond, dans les deux sens où
// elle pouvait s'accumuler sans limite.
//  1. Dans le temps : le débounce se réarme à chaque mutation. Une partie qui mute sans pause plus
//     longue que le débounce (partie d'action : la boucle de tick signale une mutation toutes les
//     100 ms, sous les 150 ms du débounce par défaut) n'était JAMAIS sauvée tant qu'elle tournait —
//     tout ce qu'elle avait joué s'accumulait hors du stockage. Désormais, une partie qui reste sale
//     est sauvée au plus tard dix débounces après sa première mutation non sauvée.
//  2. En vol : les adaptateurs fournis rendaient `void` depuis save()/remove(), si bien que le moteur
//     ne savait jamais qu'une écriture était encore en cours. Avec un stockage lent, chaque débounce
//     expiré lançait une écriture de plus pour la même partie, chacune portant un instantané complet,
//     sans aucune borne ; deux écritures pouvaient aussi finir dans le désordre. Désormais save() et
//     remove() rendent la promesse de l'écriture : au plus une écriture en vol par partie, les
//     mutations suivantes se regroupent en une seule, qui part avec le dernier état.
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer, type Socket } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveGameDef, createGame, resolvePersistOption, createPersistEngine,
  FilePersistAdapter, BridgePersistAdapter, RedisPersistAdapter, SqlPersistAdapter,
} from '../src/mjs-server/index.js'
import { mjsTmp } from './helpers/tmp.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-'+ identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('MJS-Server — sauvegarde différée : plafond dans le temps', function () {
  this.timeout(15000)

  it('partie qui mute sans répit (toutes les 10 ms, débounce 100 ms) : sauvée avant la fin de la rafale, au plus tard dix débounces après la 1re mutation', async () => {
    const sauvees: Array<{ at: number; n: number }> = []
    const adapter = { load: async () => [], save: (_id: string, data: any) => { sauvees.push({ at: Date.now(), n: data.n }) }, remove: () => {} }
    const engine  = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, () => {})!
    const game: any = { id: 'g-rafale', n: 0, serialize() { return { n: this.n } }, _onMutate: null }
    engine.armGame(game)

    const debut = Date.now()
    while (Date.now() - debut < 1600) { game.n++; game._onMutate(game); await tick(10) }
    const pendant = sauvees.length
    await engine.stop()

    assert.ok(pendant >= 1, `aucune sauvegarde pendant 1,6 s de mutations continues (${game.n} mutations) : le débounce se réarme sans fin`)
    assert.ok(sauvees[0].at - debut <= 1000 + 300, `1re sauvegarde ${sauvees[0].at - debut} ms après la 1re mutation : au-delà de dix débounces`)
    assert.equal(sauvees[sauvees.length - 1].n, game.n, 'stop() livre toujours le dernier état')
  })

  it('partie d\'action (tick 30 Hz, réglages par défaut) : sauvée pendant qu\'elle tourne, pas seulement quand elle s\'arrête', async () => {
    let saves = 0
    const adapter = { load: async () => [], save: () => { saves++ }, remove: () => {} }
    const engine  = createPersistEngine(resolvePersistOption(adapter)!, () => {})!
    const def = resolveGameDef('course', {
      seats: 1, tick: 30, moves: {},
      state: () => ({ x: 0 }),
      simulate: (game: any) => { game.state.x++ },
    })
    const game = createGame(fakeApp(), def, () => {}, 'g-course')
    engine.armGame(game)
    game._createSeat(fakeClient('j1'))
    await tick(2400)
    const pendant = saves
    game._destroy()
    await engine.stop()
    assert.ok((game.state as any).x > 20, 'sanity : la boucle de tick a bien tourné')
    assert.ok(pendant >= 1, `aucune sauvegarde en 2,4 s de partie d'action (x = ${(game.state as any).x}) : jamais sauvée tant qu'elle tourne`)
  })

  it('une mutation isolée part toujours au bout du débounce, ni avant ni en rafale (comportement inchangé)', async () => {
    const instants: number[] = []
    const adapter = { load: async () => [], save: () => { instants.push(Date.now()) }, remove: () => {} }
    const engine  = createPersistEngine(resolvePersistOption({ adapter, debounce: 80 })!, () => {})!
    const game: any = { id: 'g-calme', serialize: () => ({}), _onMutate: null }
    engine.armGame(game)
    const t0 = Date.now()
    game._onMutate(game)
    await tick(40)
    assert.equal(instants.length, 0, 'rien avant la fin du débounce')
    await tick(200)
    assert.equal(instants.length, 1, 'une seule sauvegarde')
    assert.ok(instants[0] - t0 >= 75, `partie ${instants[0] - t0} ms après la mutation, avant la fin du débounce`)
    await engine.stop()
  })
})

describe('MJS-Server — sauvegarde différée : plafond en vol', function () {
  this.timeout(15000)

  it('stockage SQL lent (120 ms par écriture) : jamais deux écritures de la même partie en même temps, la dernière porte le dernier état', async () => {
    let enVol    = 0
    let maxEnVol = 0
    const ecrits: number[] = []
    const query = async (sql: string, params: unknown[]) => {
      if (!sql.startsWith('INSERT')) return []
      enVol++
      maxEnVol = Math.max(maxEnVol, enVol)
      await tick(120)
      ecrits.push(JSON.parse(params[1] as string).n)
      enVol--
      return []
    }
    const adapter = new SqlPersistAdapter({ query, onLog: () => {} })
    const engine  = createPersistEngine(resolvePersistOption({ adapter, debounce: 5 })!, () => {})!
    const game: any = { id: 'g-lent', n: 0, serialize() { return { n: this.n } }, _onMutate: null }
    engine.armGame(game)

    for (let i = 1; i <= 20; i++) { game.n = i; game._onMutate(game); await tick(20) }
    await engine.stop()

    assert.equal(maxEnVol, 1, `${maxEnVol} écritures de la même partie en vol en même temps : rien ne borne ce qui attend d'être écrit`)
    assert.ok(ecrits.length < 20, `${ecrits.length} écritures pour 20 mutations : les états intermédiaires devaient se regrouper pendant l'écriture en cours`)
    assert.equal(ecrits[ecrits.length - 1], 20, 'la dernière écriture porte le dernier état')
  })

  it('fichier : save() et remove() rendent la promesse de l\'écriture, résolue une fois le disque à jour', async () => {
    const dir     = mjsTmp('persist-file-promesse')
    const adapter = new FilePersistAdapter({ dir, onLog: () => {} })
    const enCours = adapter.save('g1', { id: 'g1', state: { n: 1 } } as any) as unknown
    assert.equal(typeof (enCours as any)?.then, 'function', 'save() doit rendre la promesse de son écriture')
    await enCours
    assert.equal(JSON.parse(readFileSync(join(dir, 'g1.json'), 'utf8')).state.n, 1, 'fichier écrit quand la promesse se résout')
    await (adapter.remove('g1') as unknown)
    assert.equal(existsSync(join(dir, 'g1.json')), false, 'fichier retiré quand la promesse de remove() se résout')
  })

  it('pont HTTP : save() rend la promesse de la requête, résolue une fois le back servi', async () => {
    const recus: any[] = []
    const server = createHttpServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => { setTimeout(() => { recus.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))); res.writeHead(200); res.end('ok') }, 50) })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port    = (server.address() as any).port
    const adapter = new BridgePersistAdapter({ url: `http://127.0.0.1:${port}/persist`, secret: 's', onLog: () => {} })
    const enCours = adapter.save('g2', { id: 'g2', state: { n: 2 } } as any) as unknown
    assert.equal(typeof (enCours as any)?.then, 'function', 'save() doit rendre la promesse de sa requête')
    await enCours
    assert.equal(recus.length, 1, 'le back a reçu la sauvegarde quand la promesse se résout')
    assert.equal(recus[0].data.state.n, 2)
    await adapter.flush()
    await new Promise<void>(r => server.close(() => r()))
  })

  it('Redis : save() rend la promesse de la commande, résolue une fois HSET acquitté', async () => {
    let hset = false
    const server = createNetServer((socket: Socket) => {
      socket.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').indexOf('HSET') !== -1) setTimeout(() => { hset = true; socket.write(':1\r\n') }, 50)
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port    = (server.address() as any).port
    const adapter = new RedisPersistAdapter({ host: '127.0.0.1', port, onLog: () => {} })
    const enCours = adapter.save('g3', { id: 'g3' } as any) as unknown
    assert.equal(typeof (enCours as any)?.then, 'function', 'save() doit rendre la promesse de sa commande')
    await enCours
    assert.equal(hset, true, 'HSET acquitté quand la promesse se résout')
    await adapter.flush()
    await new Promise<void>(r => server.close(() => r()))
  })
})
