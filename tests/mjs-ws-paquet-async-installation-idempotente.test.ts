// core.ts — app.use() sur un paquet dont installer() est asynchrone doit rester idempotent MÊME
// pendant la fenêtre d'installation (deux app.use(pkg) rapprochés, avant résolution) : un état
// « installation en cours » empêche un second installer() de démarrer en double.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import type { MjsPackage } from '../src/mjs-ws/packages.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ...opts })
  await app.listen()
  return { transport, app }
}

describe('MJS-WS — core.ts, app.use() d\'un paquet à installer() asynchrone', () => {
  it('deux app.use(pkg) immédiats (sans await entre) : installer() ne tourne qu\'une fois', async () => {
    let installCount = 0
    let resolveInstall!: () => void
    const gate = new Promise<void>(r => { resolveInstall = r })
    const pkg: MjsPackage = { nom: 'demo-async', installer: (async () => { installCount++; await gate }) as any }
    const { app } = await startApp({ onLog: () => {} })

    app.use(pkg)
    app.use(pkg)   // AUCUN await entre les deux — la fenêtre d'installation est encore ouverte
    assert.equal(installCount, 1, 'installer() a tourné UNE SEULE fois — la 2e installation, en vol, est ignorée')

    resolveInstall()
    await tick(10)

    app.use(pkg)   // APRÈS résolution — déjà installé, ignoré normalement (comportement historique)
    assert.equal(installCount, 1, 'toujours une seule installation, y compris après coup')

    await app.stop()
  })
})
