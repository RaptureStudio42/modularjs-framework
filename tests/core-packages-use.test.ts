// app.use() : un install qui LÈVE ne doit plus poisonner installedPackages
// (src/mjs-ws/core.ts). MÊME technique que tests/mjs-ws-packages.test.ts.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

async function startApp(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ...opts })
  await app.listen()
  return { transport, app }
}

describe('app.use() : un install en échec n\'empoisonne plus le nom', () => {
  it('install qui lève PUIS install corrigé du MÊME nom : le 2e s\'installe bel et bien', async () => {
    const logs: Array<{ level: string; message: string }> = []
    const { app } = await startApp({ onLog: (level, message) => logs.push({ level, message }) })

    let secondRan = false
    assert.throws(
      () => app.use({ name: 'x', install: () => { throw new Error('boom') } }),
      /boom/,
      'l\'erreur du 1er install remonte TOUJOURS à l\'appelant (comportement inchangé)',
    )
    assert.doesNotThrow(
      () => app.use({ name: 'x', install: () => { secondRan = true } }),
      'le nom NE DOIT PLUS être poisonné — un 2e install (même nom, corrigé) doit pouvoir s\'install',
    )
    assert.ok(secondRan, 'le 2e install a bien tourné')

    const errLogs = logs.filter(l => l.level === 'error' && /install/.test(l.message) && /'x'/.test(l.message))
    assert.equal(errLogs.length, 1, 'l\'échec du 1er install est journalisé (catalogue) UNE fois')

    await app.stop()
  })

  it('un 3e app.use() du MÊME nom, une fois installé avec succès, reste ignoré (comportement pré-existant, non régressé)', async () => {
    const { app } = await startApp({ onLog: () => {} })
    let runs = 0
    app.use({ name: 'y', install: () => { runs++ } })
    app.use({ name: 'y', install: () => { runs++ } })
    assert.equal(runs, 1, 'double installation d\'un paquet qui RÉUSSIT reste ignorée, comme avant')
    await app.stop()
  })
})
