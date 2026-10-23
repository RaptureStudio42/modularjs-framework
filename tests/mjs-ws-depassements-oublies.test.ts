// Un dépassement de débit s'oublie après 10 s sans nouveau dépassement : une appli qui déborde un peu,
// de loin en loin, sur une longue session n'est plus expulsée pour la somme de toute sa vie (avant, le
// compte ne redescendait jamais) ; un flot continu l'est toujours, aussi vite.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// ce qu'un essai ouvre (appli, connexion, WebSocket global) est rendu après lui, même quand il échoue : sinon la connexion et
// ses minuteries courent pendant les fichiers suivants, qui ouvriraient en plus leurs connexions sur le transport de ce fichier
const aRendre: Array<() => unknown> = []

function makeClient(transport: MemoryTransport): any {
  const avant = { present: 'WebSocket' in globalThis, valeur: (globalThis as any).WebSocket }
  aRendre.push(() => {
    if (avant.present) (globalThis as any).WebSocket = avant.valeur
    else delete (globalThis as any).WebSocket
  })
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const ouvrir = µ.socket
  µ.socket = (...a: any[]) => { const s = ouvrir(...a); aRendre.push(() => s.destroy()); return s }
  return µ
}

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ...opts })
  aRendre.push(() => app.stop())
  await app.listen()
  return { transport, app }
}

describe('MJS WS — les dépassements de débit s\'oublient', function () {
  this.timeout(20000)
  const vrai = Date.now
  afterEach(async () => {
    Date.now = vrai
    while (aRendre.length) await (aRendre.pop() as () => unknown)()
  })

  it('trois rafales espacées de 20 s, deux trames de trop chacune : pas d\'expulsion', async () => {
    const { transport, app } = await startApp({ limits: { rate: 5, burst: 5, kickAfter: 3 }, onLog: () => {} })
    app.on('x', () => {})
    const µ = makeClient(transport)
    const s = µ.socket('memory://oubli', { reconnect: { enabled: false } })
    s.connect(); await tick()
    let decale = 0
    Date.now = () => vrai() + decale
    for (let tour = 0; tour < 3; tour++) {
      for (let i = 0; i < 7; i++) s.send('x', { i })
      await tick(40)
      decale += 20000
    }
    assert.equal(s.state, 'open')
  })

  it('une rafale continue : expulsé comme avant', async () => {
    const { transport, app } = await startApp({ limits: { rate: 5, burst: 5, kickAfter: 3 }, onLog: () => {} })
    app.on('x', () => {})
    const µ = makeClient(transport)
    const s = µ.socket('memory://flot', { reconnect: { enabled: false } })
    s.connect(); await tick()
    for (let i = 0; i < 30; i++) s.send('x', { i })
    await tick(60)
    assert.equal(s.state, 'closed')
  })
})
