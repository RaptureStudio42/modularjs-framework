// Mode action : une partie n'est sauvegardée que si elle a changé depuis sa dernière sauvegarde. La boucle de tick marquait la
// partie à sauvegarder toutes les 100 ms, qu'elle ait changé ou non : une partie d'action où rien ne bougeait (joueur immobile,
// salle d'attente, pause) faisait écrire votre stockage en continu. Désormais un coup, une intention, un siège, la phase, le tour,
// la fin ou game.changed() font sauvegarder la partie ; le code que la boucle appelle sans savoir ce qu'il change (simulate,
// slowTick) et les minuteries de l'appli ne la font sauvegarder que si elle diffère de sa dernière sauvegarde réussie.
// Vrai serveur MJS-Server + vrai client µ.socket (MemoryTransport) + adaptateur de sauvegarde espion ; les durées sont courtes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

describe('MJS-Server — mode action : une partie n\'est sauvegardée que si elle a changé', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // partie d'action d'un siège (tick 20 Hz) ; `saves` : copie de chaque sauvegarde écrite, `fail(n)` : la sauvegarde qui porte
  // state.n === n échoue une fois, `game()` : la partie vivante
  async function solo(def: Record<string, any>) {
    const saves: any[] = []
    const failing = new Set<number>()
    const spy = {
      load:   async () => [],
      save:   (_id: string, data: any) => {
        const copy = JSON.parse(JSON.stringify(data))
        if (failing.delete(copy.state.n)) throw new Error('stockage indisponible')
        saves.push(copy)
      },
      remove: () => {},
    }
    const transport = new MemoryTransport()
    let live: any = null
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: spy, debounce: 20 }, onLog: () => {} })
    app.game('arene', { seats: 1, code: true, tick: 20, emptyTtl: 60000, state: () => ({ n: 0 }), moves: {}, hooks: { onCreate: (game: any) => { live = game } }, ...def })
    await app.listen()
    const host    = makeClient(transport, 'hote'); await tick()
    const created = await host.request('µgame:play', { type: 'arene', code: true })
    await until(() => saves.length > 0, 'l\'arrivée du joueur est sauvegardée')
    await tick(150)
    return { host, created, saves, fail: (n: number) => { failing.add(n) }, game: () => live }
  }

  it('boucle en marche, rien ne change : aucune sauvegarde après celle de l\'arrivée du joueur', async () => {
    const { saves, game } = await solo({ intents: { bouge: () => {} } })
    const before = saves.length
    await tick(600)
    assert.ok(game()._tickHandle !== null, 'sanity : la boucle tourne')
    assert.equal(saves.length, before, (saves.length - before) + ' sauvegardes d\'une partie qui n\'a pas changé')
  })

  it('simulate qui ne change rien : aucune sauvegarde', async () => {
    let calls = 0
    const { saves } = await solo({ simulate: () => { calls++ } })
    const before = saves.length
    await tick(600)
    assert.ok(calls > 8, 'sanity : simulate tourne à chaque tick')
    assert.equal(saves.length, before, (saves.length - before) + ' sauvegardes d\'une partie que simulate ne change pas')
  })

  it('slowTick qui ne change rien : aucune sauvegarde', async () => {
    let calls = 0
    const { saves } = await solo({ slowTick: { hz: 10, fn: () => { calls++ } } })
    const before = saves.length
    await tick(600)
    assert.ok(calls > 3, 'sanity : slowTick tourne')
    assert.equal(saves.length, before, (saves.length - before) + ' sauvegardes d\'une partie que slowTick ne change pas')
  })

  it('veille de l\'appli réarmée sous le même nom, boucle en marche : aucune sauvegarde à ses échéances', async () => {
    let watches = 0
    const { host, created, saves } = await solo({
      moves: { arme: (game: any) => { game.timer('veille', 40) } },
      timers: { veille: (game: any) => { watches++; game.timer('veille', 40) } },
    })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => saves.some(save => save.timers.some((timer: any) => timer.name === 'veille')), 'le coup qui arme la veille est sauvegardé')
    await tick(60)
    const before = saves.length
    await until(() => watches >= 8, 'la veille part huit fois')
    await tick(60)
    assert.equal(saves.length, before, (saves.length - before) + ' sauvegardes aux échéances de la veille')
  })

  it('simulate qui change l\'état : sauvegardée tant qu\'elle change, la dernière sauvegarde porte le dernier état, puis plus rien', async () => {
    const { saves } = await solo({ simulate: (game: any) => { if (game.state.n < 5) game.state.n++ } })
    await until(() => saves.some(save => save.state.n === 5), 'le dernier état est sauvegardé')
    await tick(100)
    const before = saves.length
    await tick(500)
    assert.equal(saves[saves.length - 1].state.n, 5)
    assert.equal(saves.length, before, (saves.length - before) + ' sauvegardes après le dernier changement')
  })

  it('une intention reçue fait sauvegarder la partie, même sans changer l\'état : son numéro de séquence (antiReplay) part avec elle', async () => {
    const { host, created, saves } = await solo({ antiReplay: true, intents: { bouge: () => {} } })
    await host.request('µgame:move', { game: created.game, move: 'bouge', p: { _s: 7 } })
    await until(() => saves.some(save => save.seats[0]?.lastAntiReplaySeq === 7), 'la séquence de l\'intention est sauvegardée')
  })

  it('un coup classique fait sauvegarder la partie, comme en mode événementiel', async () => {
    const { host, created, saves } = await solo({ moves: { salue: () => {} } })
    const before = saves.length
    await host.request('µgame:move', { game: created.game, move: 'salue' })
    await until(() => saves.length > before, 'le coup est sauvegardé')
    assert.equal(saves[saves.length - 1].journal.at(-1).move, 'salue')
  })

  it('écriture échouée : la suivante a lieu même si la partie n\'a plus changé depuis', async () => {
    const { host, created, saves, fail } = await solo({ simulate: () => {}, moves: { pose: (game: any) => { game.state.n = 1 } } })
    fail(1)
    await host.request('µgame:move', { game: created.game, move: 'pose' })
    await until(() => saves.some(save => save.state.n === 1), 'l\'état que portait l\'écriture échouée finit par être écrit')
  })
})
