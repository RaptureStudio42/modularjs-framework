// Partie par code déjà finie (grâce endTtl) : une poignée qui y prend place après la fin l'apprend aussi quand elle passe par une
// 2e demande de la même connexion déjà assise (composant remonté) ou quand elle vient regarder en spectateur. Ces deux chemins
// répondaient sans renvoyer la fin : la poignée restait « playing » pour toujours, ses coups refusés « partie terminée ». La fin lui
// est renvoyée, à elle seule, un tour de boucle après sa réponse.
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

async function partieFinie(): Promise<{ app: any; transport: MemoryTransport; code: string; sb: any; hB: any }> {
  const transport = new MemoryTransport()
  const app: any = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
  await app.listen()
  app.game('salle', { seats: 2, code: true, endTtl: 60000, state: () => ({}), view: (g: any) => g.state, spectatorView: (g: any) => g.state, moves: { fin: (g: any) => { g.end({ gagnant: 'a' }) } } })
  const hA = client(transport, 'a').game('salle', { code: true })
  await tick(40)
  const sb = client(transport, 'b')
  const hB = sb.game('salle', { code: hA.state.code })
  await tick(40)
  await hA.move('fin')
  await tick(40)
  return { app, transport, code: hA.state.code, sb, hB }
}

describe('client de jeu — la fin d une partie par code parvient aux poignées qui y prennent place après coup', function() {
  this.timeout(10000)

  it('2e poignée ouverte par la même connexion, déjà assise : elle passe « finished » avec le résultat', async () => {
    const { app, code, sb, hB } = await partieFinie()
    assert.equal(hB.state.status, 'finished')
    const hB2 = sb.game('salle', { code })
    await tick(80)
    assert.equal(hB2.state.status, 'finished')
    assert.deepEqual(hB2.state.result, { gagnant: 'a' })
    await app.stop()
  })

  it('spectateur arrivé après la fin : il passe « finished » avec le résultat', async () => {
    const { app, transport, code } = await partieFinie()
    const hS = client(transport, 's').game('salle', { code, spectator: true })
    await tick(80)
    assert.equal(hS.state.status, 'finished')
    assert.deepEqual(hS.state.result, { gagnant: 'a' })
    await app.stop()
  })
})
