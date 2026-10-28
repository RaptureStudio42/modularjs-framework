// Pont de MJS WS (src/mjs-ws/bridge.ts) : un secret de signature de moins de 32 caractères passe, avec un avertissement
// pour chaque serveur qui l'emploie. Les serveurs /ws et /mjs-server d'un même processus partagent le module du pont
// (dist/ se construit en une passe, modules communs en morceaux) : un avertissement unique pour tout le processus taisait
// le secret court du second serveur.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('pont MJS WS : un secret court signalé pour chaque serveur', function () {
  this.timeout(30000)

  it('un serveur /ws et un serveur /mjs-server au secret court dans le même processus : un avertissement chacun, aucun pour un secret long', () => {
    const ws     = pathToFileURL(join(ROOT, 'src/mjs-ws/index.ts')).href
    const server = pathToFileURL(join(ROOT, 'src/mjs-server/index.ts')).href
    const code   = [
      `const { mjsWs, MemoryTransport } = await import(${JSON.stringify(ws)})`,
      `const { mjsServer } = await import(${JSON.stringify(server)})`,
      'const warnings = []',
      'console.warn = (...args) => { warnings.push(args.join(" ")) }',
      'mjsWs({ transport: new MemoryTransport(), heartbeat: 0, onLog: () => {}, bridge: { port: 0, secret: "court-ws" } })',
      'mjsServer({ transport: new MemoryTransport(), heartbeat: 0, onLog: () => {}, bridge: { port: 0, secret: "court-serveur" } })',
      'mjsWs({ transport: new MemoryTransport(), heartbeat: 0, onLog: () => {}, bridge: { port: 0, secret: "un-secret-de-pont-bien-plus-long-que-trente-deux-caracteres" } })',
      'process.stdout.write(JSON.stringify(warnings), () => process.exit(0))'
    ].join('\n')
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 20000 })
    assert.equal(run.status, 0, run.stderr)
    const warnings = JSON.parse(run.stdout)
    assert.equal(warnings.length, 2, run.stdout)
    assert.match(warnings[0], /opts\.bridge\.secret .*\b8 caractères/)
    assert.match(warnings[1], /opts\.bridge\.secret .*\b13 caractères/)
  })
})
