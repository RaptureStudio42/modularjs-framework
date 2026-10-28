// hooks.onDestroy(game) : MJS-Server prévient l'appli quand une partie disparaît pour de bon — table jamais complète que son dernier
// joueur quitte, partie vide à l'échéance de emptyTtl, partie finie au bout de sa grâce endTtl, annulation (seatTtl, partie privée
// remplacée), appariement de la file défait par un refus de onJoin. Sans lui, l'appli qui comptait ses parties (une borne de salons
// par invité, par exemple) gardait les parties que le cadre fermait seul et devait lire le drapeau interne `_destroyed`. L'arrêt du
// serveur (app.stop()) n'appelle pas onDestroy : la partie sauvegardée revit au redémarrage. Un onDestroy qui lève, ou dont la
// Promise rejette, est journalisé et la destruction va à son terme. Vrai serveur MJS-Server + vrais clients µ.socket (MemoryTransport).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
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

describe('MJS-Server — hooks.onDestroy : la partie disparaît pour de bon', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // jeu à deux places ; `destroyed` reçoit chaque partie passée à onDestroy, `logs` le journal du serveur
  async function server(def: Record<string, any> = {}, onDestroy?: (game: any) => unknown) {
    const destroyed: any[] = []
    const logs: string[] = []
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (level: string, msg: string) => { logs.push(level + ' ' + msg) } })
    app.game('salon', {
      seats: 2, code: true, seatTtl: 60, endTtl: 80,
      state: () => ({ n: 0 }),
      view: (game: any) => ({ n: game.state.n }),
      moves: { fin: (game: any) => { game.end({ gagnant: 'a' }) } },
      ...def,
      hooks: { ...def.hooks, onDestroy: onDestroy ?? ((game: any) => { destroyed.push(game) }) },
    })
    await app.listen()
    const join = async (id: string) => { const sock = makeClient(transport, id); await tick(); return sock }
    return { destroyed, logs, join }
  }

  it('la déclaration accepte hooks.onDestroy, refuse ce qui n\'est pas une fonction et corrige une faute de frappe', () => {
    assert.doesNotThrow(() => resolveGameDef('salon', { seats: 1, state: () => ({}), moves: {}, hooks: { onDestroy: () => {} } }))
    assert.throws(() => resolveGameDef('salon', { seats: 1, state: () => ({}), moves: {}, hooks: { onDestroy: 'non' as any } }), /hooks\.onDestroy doit être une fonction/)
    assert.throws(() => resolveGameDef('salon', { seats: 1, state: () => ({}), moves: {}, hooks: { onDestory: () => {} } as any }), /onDestroy/)
  })

  it('une table jamais complète que son créateur quitte : onDestroy part une fois, avec la partie, qui n\'est plus dans le registre', async () => {
    const { destroyed, join } = await server()
    const a = await join('a')
    const created = await a.request('µgame:play', { type: 'salon', code: true })
    await a.request('µgame:leave', { game: created.game })
    await until(() => destroyed.length === 1, 'onDestroy est appelé')
    assert.equal(destroyed[0].id, created.game)
    assert.equal(destroyed[0].state.n, 0, 'la partie se lit encore dans onDestroy')
    const b = await join('b')
    await assert.rejects(b.request('µgame:play', { type: 'salon', code: created.code }), /code inconnu/)
    await tick(30)
    assert.equal(destroyed.length, 1, 'onDestroy est appelé plus d\'une fois')
  })

  it('une partie finie : onDestroy part au bout de la grâce endTtl, pas avant', async () => {
    const { destroyed, join } = await server()
    const a = await join('a')
    const created = await a.request('µgame:play', { type: 'salon', code: true })
    const b = await join('b')
    await b.request('µgame:play', { type: 'salon', code: created.code })
    await a.request('µgame:move', { game: created.game, move: 'fin' })
    await tick(30)
    assert.equal(destroyed.length, 0, 'onDestroy est parti avant la fin de la grâce')
    await until(() => destroyed.length === 1, 'onDestroy part à la fin de la grâce')
    assert.equal(destroyed[0].id, created.game)
  })

  it('une partie de la file annulée faute de confirmation (seatTtl) : onDestroy part', async () => {
    const { destroyed, join } = await server()
    const a = await join('a')
    const b = await join('b')
    await a.request('µgame:play', { type: 'salon' })   // en file, puis ne confirme jamais sa place
    const repB = await b.request('µgame:play', { type: 'salon' })
    await until(() => destroyed.length === 1, 'onDestroy part à l\'annulation')
    assert.equal(destroyed[0].id, repB.game)
  })

  it('une partie privée en attente remplacée par une nouvelle du même créateur : onDestroy part pour l\'ancienne', async () => {
    const { destroyed, join } = await server()
    const a = await join('a')
    const first = await a.request('µgame:play', { type: 'salon', code: true })
    const second = await a.request('µgame:play', { type: 'salon', code: true })
    await until(() => destroyed.length === 1, 'onDestroy part pour la partie remplacée')
    assert.equal(destroyed[0].id, first.game)
    assert.notEqual(destroyed[0].id, second.game)
  })

  it('un appariement de la file défait par un refus de onJoin : onDestroy part pour la partie que personne n\'a vue', async () => {
    let created = 0
    const { destroyed, join } = await server({ hooks: { onCreate: () => { created++ }, onJoin: (_game: any, player: any) => { if (player.id === 'b') throw new Error('refusé') } } })
    const a = await join('a')
    const b = await join('b')
    await a.request('µgame:play', { type: 'salon' })
    await assert.rejects(b.request('µgame:play', { type: 'salon' }), /refusé/)
    await until(() => destroyed.length === 1, 'onDestroy part pour la partie défaite')
    assert.equal(created, 1, 'onCreate a vu cette partie : onDestroy la referme')
  })

  it('app.stop() n\'appelle pas onDestroy : la partie sauvegardée revit au redémarrage', async () => {
    const { destroyed, join } = await server()
    const a = await join('a')
    await a.request('µgame:play', { type: 'salon', code: true })
    await app!.stop(); app = null
    await tick(30)
    assert.equal(destroyed.length, 0, 'onDestroy est parti à l\'arrêt du serveur')
  })

  it('un onDestroy qui lève : journalisé, la destruction va à son terme et le serveur répond toujours', async () => {
    const { logs, join } = await server({}, () => { throw new Error('boum') })
    const a = await join('a')
    const created = await a.request('µgame:play', { type: 'salon', code: true })
    await a.request('µgame:leave', { game: created.game })
    await until(() => logs.some(l => l.startsWith('error') && l.includes('hooks.onDestroy') && l.includes('boum')), 'l\'erreur est journalisée')
    const b = await join('b')
    await assert.rejects(b.request('µgame:play', { type: 'salon', code: created.code }), /code inconnu/)
    assert.ok((await b.request('µgame:play', { type: 'salon', code: true })).code, 'le serveur crée encore des parties')
  })

  it('un onDestroy dont la Promise rejette : le rejet est journalisé', async () => {
    const { logs, join } = await server({}, async () => { throw new Error('rejet') })
    const a = await join('a')
    const created = await a.request('µgame:play', { type: 'salon', code: true })
    await a.request('µgame:leave', { game: created.game })
    await until(() => logs.some(l => l.startsWith('error') && l.includes('hooks.onDestroy') && l.includes('rejet')), 'le rejet est journalisé')
  })

  it('une partie détruite deux fois n\'appelle onDestroy qu\'une fois', () => {
    let calls = 0
    const def  = resolveGameDef('salon', { seats: 1, state: () => ({}), moves: {}, hooks: { onDestroy: () => { calls++ } } })
    const game = createGame({ send() {} } as any, def, () => {}, 'salon1')
    game._destroy()
    game._destroy()
    assert.equal(calls, 1)
  })
})
