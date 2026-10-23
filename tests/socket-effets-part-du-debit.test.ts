// Les trames des effets en direct — volatiles et regroupées (`coalesce`) : curseurs, défilement de
// *follow — partagent la connexion de l'appli, dont le serveur borne le débit (40 trames/s par défaut)
// et expulse qui dépasse. Elles ont donc leur part, pas plus : 4 par seconde à elles toutes par
// défaut (`"effects": { "rate": 4 }` de mjs.config.json, `µ._fxConf` au manifeste) ; le reste est pour
// l'appli. Une trame retenue n'est pas perdue : la dernière valeur part dès qu'il y a de la place.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, fxConf?: any): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _fxConf: fxConf }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ...opts })
  await app.listen()
  return { transport, app }
}

describe('µ.socket — la part du débit des effets en direct', function () {
  this.timeout(20000)

  // trois flux regroupés de 20 trames/s chacun pendant 2 s : ce qui arrive pendant, puis la dernière valeur de chacun
  async function troisFlux(fxConf?: any): Promise<number> {
    const { transport, app } = await startApp({ onLog: () => {} })
    const recu: Record<string, number[]> = { a: [], b: [], c: [] }
    for (const k of ['a', 'b', 'c']) app.on('fx:' + k, (p: any) => { recu[k].push(p.v) })
    const µ = makeClient(transport, fxConf)
    const s = µ.socket('memory://part', { reconnect: { enabled: false } })
    s.connect(); await tick()
    assert.equal(s.state, 'open')
    const t0 = Date.now()
    let v = 0
    while (Date.now() - t0 < 2000) {
      v++
      for (const k of ['a', 'b', 'c']) s.send('fx:' + k, { v }, { coalesce: 50, volatile: true })
      await tick(5)
    }
    const pendant = recu.a.length + recu.b.length + recu.c.length
    await tick(1200)
    for (const k of ['a', 'b', 'c']) assert.equal(recu[k][recu[k].length - 1], v, `la dernière valeur de ${k}`)
    assert.equal(s.state, 'open')
    s.destroy(); await app.stop()
    return pendant
  }

  it('trois flux regroupés de 20 trames/s chacun : 4 par seconde au plus à eux trois, par défaut, et la dernière valeur de chacun arrive', async () => {
    const pendant = await troisFlux()
    // 4 d'avance + 4 par seconde : 12 en 2 s ; sans part, 3 × 20/s = 120
    assert.ok(pendant <= 14, `${pendant} trames en 2 s`)
  })

  it('"effects": { "rate": 10 } : la part se règle — 10 par seconde', async () => {
    const pendant = await troisFlux({ rate: 10 })
    // 10 d'avance + 10 par seconde : 30 en 2 s
    assert.ok(pendant > 14 && pendant <= 32, `${pendant} trames en 2 s`)
  })

  it('la clé rate de mjs.config.json : un entier de 1 à 1000', () => {
    const projet = (etiquette: string, effects: unknown) => {
      const root = mjsTmp('part-du-debit-config-' + etiquette)
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', effects }))
      return root
    }
    const cfg = findConfig(projet('dix', { rate: 10 }))!
    assert.deepEqual(resolveBundlerOpts(cfg.config, cfg.configDir).effects, { rate: 10 })
    for (const [etiquette, rate] of [['zero', 0], ['virgule', 2.5], ['mot', 'vite'], ['trop', 1001]] as Array<[string, unknown]>) {
      assert.throws(() => findConfig(projet(etiquette, { rate })), /"effects\.rate"/, etiquette)
    }
  })

  it('les trames de l\'appli (ni volatiles ni regroupées) ne sont pas retenues', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    const recu: number[] = []
    app.on('appli', (p: any) => { recu.push(p.i) })
    const µ = makeClient(transport)
    const s = µ.socket('memory://appli', { reconnect: { enabled: false } })
    s.connect(); await tick()
    for (let i = 0; i < 30; i++) s.send('appli', { i })
    await tick(100)
    assert.equal(recu.length, 30)
    s.destroy(); await app.stop()
  })
})
