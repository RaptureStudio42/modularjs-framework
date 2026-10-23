// Le serveur pousse le roster µgame:seat AVANT la réponse du joueur qui entre (il le diffuse pendant le traitement de sa
// requête, la réponse ne part qu'ensuite) : la poignée n'est alors pas encore assise et la trame d'une partie qu'elle ne
// connaît pas encore était jetée — celui qui arrivait ne voyait jamais l'autre joueur (`state.seats` restait `null`).
// Le client garde maintenant le dernier roster reçu pour une partie en attente de réponse et l'applique à l'assise. Vrai
// serveur MJS-Server + vrai client sock.game (mjs_socket.ts + mjs_game.ts concaténés comme le bundler), MemoryTransport.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const gameSrc   = readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')
const clientSrc = socketSrc + '\n' + gameSrc
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

// attend qu'une condition soit vraie (sondage court), sinon échoue avec le libellé
async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

const BOTH_PRESENT = [{ seat: 0, connected: true }, { seat: 1, connected: true }]

describe('sock.game — le joueur qui entre connaît le roster', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  async function start() {
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth })
    await app.listen()
    app.game('duo', {
      seats: 2,
      code: true,
      seatTtl: 5000,
      emptyTtl: 5000,
      state: () => ({ n: 0 }),
      moves: { jouer: (game: any) => { game.state.n++ } },
      view: (game: any) => ({ n: game.state.n }),
    })
    return transport
  }

  it('partie par code : l\'invité sait que l\'hôte est là dès qu\'il est assis', async () => {
    const transport = await start()
    const sockHost = makeClient(transport, 'hote'); const sockGuest = makeClient(transport, 'invite'); await tick()
    const host = sockHost.game('duo', { code: true })
    await until(() => host.state.status === 'playing', 'l\'hôte est assis')
    const guest = sockGuest.game('duo', { code: host.state.code })
    await until(() => guest.state.status === 'playing', 'l\'invité est assis')
    assert.deepEqual(guest.state.seats, BOTH_PRESENT, 'l\'invité ne connaît pas le roster : ' + JSON.stringify(guest.state.seats))
    assert.deepEqual(host.state.seats, BOTH_PRESENT)
  })

  it('file publique : les deux joueurs connaissent le roster après l\'appariement', async () => {
    const transport = await start()
    const sockA = makeClient(transport, 'a'); const sockB = makeClient(transport, 'b'); await tick()
    const a = sockA.game('duo')
    await tick(20)
    const b = sockB.game('duo')
    await until(() => a.state.status === 'playing' && b.state.status === 'playing', 'les deux joueurs sont assis')
    assert.deepEqual(a.state.seats, BOTH_PRESENT, 'le 1er joueur ne connaît pas le roster : ' + JSON.stringify(a.state.seats))
    assert.deepEqual(b.state.seats, BOTH_PRESENT, 'le 2e joueur ne connaît pas le roster : ' + JSON.stringify(b.state.seats))
  })

  it('un roster poussé après l\'assise remplace celui reçu avant la réponse', async () => {
    const transport = await start()
    const sockHost = makeClient(transport, 'hote'); const sockGuest = makeClient(transport, 'invite'); await tick()
    const host = sockHost.game('duo', { code: true })
    await until(() => host.state.status === 'playing', 'l\'hôte est assis')
    const guest = sockGuest.game('duo', { code: host.state.code })
    await until(() => guest.state.status === 'playing', 'l\'invité est assis')
    host.leave()
    await until(() => guest.state.seats && guest.state.seats[0] === null, 'le roster de l\'invité suit le départ de l\'hôte')
    assert.deepEqual(guest.state.seats, [null, { seat: 1, connected: true }])
  })

  it('deux parties rejointes en même temps par le même socket : chaque poignée connaît son roster', async () => {
    const transport = await start()
    const sockH1 = makeClient(transport, 'hote1'); const sockH2 = makeClient(transport, 'hote2'); const sockG = makeClient(transport, 'invite'); await tick()
    const host1 = sockH1.game('duo', { code: true })
    const host2 = sockH2.game('duo', { code: true })
    await until(() => host1.state.status === 'playing' && host2.state.status === 'playing', 'les deux hôtes sont assis')
    // les deux poignées de l'invité attendent leur réponse en même temps
    const guest1 = sockG.game('duo', { code: host1.state.code })
    const guest2 = sockG.game('duo', { code: host2.state.code })
    await until(() => guest1.state.status === 'playing' && guest2.state.status === 'playing', 'l\'invité est assis dans les deux parties')
    assert.deepEqual(guest1.state.seats, BOTH_PRESENT, 'roster de la 1re partie : ' + JSON.stringify(guest1.state.seats))
    assert.deepEqual(guest2.state.seats, BOTH_PRESENT, 'roster de la 2e partie : ' + JSON.stringify(guest2.state.seats))
  })

  it('une poignée assise ne prend pas le roster d\'une autre partie', async () => {
    const transport = await start()
    const sockH1 = makeClient(transport, 'hote1'); const sockH2 = makeClient(transport, 'hote2'); const sockG = makeClient(transport, 'invite'); await tick()
    const host1 = sockH1.game('duo', { code: true })
    const host2 = sockH2.game('duo', { code: true })
    await until(() => host1.state.status === 'playing' && host2.state.status === 'playing', 'les deux hôtes sont assis')
    const guest = sockG.game('duo', { code: host2.state.code })
    await until(() => guest.state.status === 'playing', 'l\'invité est assis')
    assert.deepEqual(guest.state.seats, BOTH_PRESENT)
    assert.deepEqual(host1.state.seats, [{ seat: 0, connected: true }, null], 'la 1re partie n\'a reçu personne')
  })
})
