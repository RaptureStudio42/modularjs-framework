// Partie par code : quand hooks.onJoin du joueur qui entre termine la partie, sa poignée apprend la fin. Le µgame:end partait au
// siège AVANT la réponse de sa requête (sa poignée ne connaissait pas encore la partie et l'ignorait) : elle restait « playing »
// pour toujours, ses coups refusés « partie terminée ». La fin lui est renvoyée, à lui seul, un tour de boucle après sa réponse.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_game.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function client(transport: MemoryTransport, id: string): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', clientSrc)(µ, FauxWebSocket)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
}

async function demarrer(): Promise<{ transport: MemoryTransport; app: any }> {
  const transport = new MemoryTransport()
  const app: any = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
  await app.listen()
  return { transport, app }
}

describe('client de jeu — une fin décidée dans hooks.onJoin d une partie par code parvient à la poignée de l entrant', function() {
  this.timeout(10000)

  it('le 2e joueur entre par code, son onJoin termine la partie : les deux poignées passent « finished »', async () => {
    const { transport, app } = await demarrer()
    app.game('salle', { seats: 2, code: true, state: () => ({}), view: (g: any) => g.state, moves: {}, hooks: { onJoin: (g: any) => { if (g.players.every((x: any) => x)) g.end({ annulee: 'complet' }) } } })
    const hA = client(transport, 'a').game('salle', { code: true })
    await tick(40)
    const hB = client(transport, 'b').game('salle', { code: hA.state.code })
    await tick(80)
    assert.equal(hA.state.status, 'finished')
    assert.equal(hB.state.status, 'finished')
    assert.deepEqual(hB.state.result, { annulee: 'complet' })
    await app.stop()
  })

  it('le créateur : son onJoin termine aussitôt la partie qu il crée, sa poignée passe « finished »', async () => {
    const { transport, app } = await demarrer()
    app.game('eclair', { seats: 2, code: true, state: () => ({}), view: (g: any) => g.state, moves: {}, hooks: { onJoin: (g: any) => { g.end({ ferme: true }) } } })
    const h = client(transport, 'a').game('eclair', { code: true })
    await tick(80)
    assert.equal(h.state.status, 'finished')
    assert.deepEqual(h.state.result, { ferme: true })
    await app.stop()
  })
})
