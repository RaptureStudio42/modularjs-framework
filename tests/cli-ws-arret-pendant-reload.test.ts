// `mjs ws` : arrêter le serveur (Ctrl-C, `handle.stop()`) PENDANT qu'un rechargement à chaud est
// EN VOL (import lent d'une nouvelle version de l'entry) laissait ce rechargement continuer en
// tâche de fond, SANS jamais être attendu ni interrompu par l'arrêt — le nouveau serveur pouvait
// finir de démarrer et de s'enregistrer sur le transport (`app.listen()`) APRÈS que `stop()` se
// soit déjà résolu, comme si le process restait « vivant » un instant de plus qu'annoncé.
//
// Sonde par MemoryTransport (jamais un vrai port) : `_started` (interne, cf. transport.ts) est
// TRUE tant qu'un serveur mjsWs() a `listen()` dessus sans avoir `stop()`é depuis — un
// `transport.connect()` après `handle.stop()` doit donc TOUJOURS échouer.

import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runWsCommand } from '../src/cli/ws.js'
import { runServeurCommand } from '../src/cli/server.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

const tmpDirs: string[] = []
function freshDir(prefix: string): string {
  const d = mjsTmp(prefix)
  tmpDirs.push(d)
  return d
}
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

function patchConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const orig = { log: console.log, warn: console.warn, error: console.error }
  console.log   = (...a: any[]) => { lines.push(a.join(' ')) }
  console.warn  = (...a: any[]) => { lines.push(a.join(' ')) }
  console.error = (...a: any[]) => { lines.push(a.join(' ')) }
  return { lines, restore: () => { console.log = orig.log; console.warn = orig.warn; console.error = orig.error } }
}

const tick = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe("cli/ws — arrêter le serveur PENDANT un rechargement à chaud EN VOL", function () {
  this.timeout(20000)

  it("handle.stop() pendant l'import (lent) d'une v2 : la v2 ne prend JAMAIS le contrôle du transport après coup", async () => {
    const root = freshDir('ws-stop-during-reload')
    const entryPath = join(root, 'ws.mjs')
    writeFileSync(entryPath, `export default {\n  setup(app) {\n    app.serve('version', () => 'v1')\n  },\n}\n`)
    const transport = new MemoryTransport()
    const boot = patchConsole()
    const handle = await runWsCommand({ root, entry: 'ws.mjs' }, undefined, { transport })   // watch actif
    boot.restore()

    // v2 : import délibérément LENT (top-level await 300ms) — laisse une fenêtre où reload() est
    // encore bloqué dans l'IMPORT (donc n'a pas encore touché currentApp) quand on arrête.
    writeFileSync(entryPath, `await new Promise(r => setTimeout(r, 300))\nexport default {\n  setup(app) {\n    app.serve('version', () => 'v2')\n  },\n}\n`)
    await tick(220)   // 150ms debounce + marge : le reload doit avoir démarré son import (encore en vol)

    const cap = patchConsole()
    await handle.stop()
    // Laisse le temps à un rechargement en vol (SANS le fix) de finir malgré l'arrêt : import
    // restant (~80ms) + contrat + stop()/listen() de la v2 — marge large.
    await tick(600)
    cap.restore()

    assert.ok(!cap.lines.some(l => l.includes('♻️') && l.includes('redémarré')), `BUG confirmé si le serveur se dit "redémarré" APRÈS l'arrêt demandé. lignes :\n${cap.lines.join('\n')}`)
    // BUG confirmé si cette connexion RÉUSSIT : la v2 (créée par le reload en vol) se serait
    // enregistrée sur le transport (`_started=true`) après que handle.stop() se soit déjà résolu.
    assert.throws(() => transport.connect(), /avant start/i, "BUG confirmé si le transport accepte encore une connexion après l'arrêt demandé (un serveur a redémarré après coup)")
  })
})

describe("cli/server — arrêter le serveur PENDANT un rechargement à chaud EN VOL (même correctif)", function () {
  this.timeout(20000)

  it("handle.stop() pendant l'import (lent) d'une v2 : la v2 ne prend JAMAIS le contrôle du transport après coup", async () => {
    const root = freshDir('serveur-stop-during-reload')
    const entryPath = join(root, 'serveur.mjs')
    writeFileSync(entryPath, `export default {\n  setup(app) {\n    app.serve('version', () => 'v1')\n  },\n}\n`)
    const transport = new MemoryTransport()
    const boot = patchConsole()
    const handle = await runServeurCommand({ root, entry: 'serveur.mjs' }, undefined, { transport: transport as any })
    boot.restore()

    writeFileSync(entryPath, `await new Promise(r => setTimeout(r, 300))\nexport default {\n  setup(app) {\n    app.serve('version', () => 'v2')\n  },\n}\n`)
    await tick(220)

    const cap = patchConsole()
    await handle.stop()
    await tick(600)
    cap.restore()

    assert.ok(!cap.lines.some(l => l.includes('♻️') && l.includes('redémarré')), `BUG confirmé si le serveur se dit "redémarré" APRÈS l'arrêt demandé. lignes :\n${cap.lines.join('\n')}`)
    assert.throws(() => transport.connect(), /avant start/i, "BUG confirmé si le transport accepte encore une connexion après l'arrêt demandé (un serveur a redémarré après coup)")
  })
})
