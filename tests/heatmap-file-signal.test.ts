// heatmap-file-signal — les points de la carte de chaleur (`heatmapPackage({ file })`, src/mjs-ws/heatmap.ts)
// écrits quand le process s'arrête sans `app.stop()` : `systemctl stop` envoie SIGTERM, qui termine Node
// sans passer par le hook 'exit', et une fin normale (process.exit) ne passe pas par `app.stop()`. La
// fixture (tests/fixtures/heatmap-file-child.mts) rejoue les deux dans un VRAI process enfant, jamais
// dans celui des tests.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE   = join(__dirname, 'fixtures/heatmap-file-child.mts')

after(() => sweepRegistered())

// `--import tsx` : UN SEUL process node, celui qui s'arrête est celui que `spawn()` rend
function lancer(file: string, mode: string): Promise<{ code: number | null, signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const enfant   = spawn(process.execPath, ['--import', 'tsx', FIXTURE, file, mode], { cwd: join(__dirname, '..'), stdio: 'ignore' })
    const securite = setTimeout(() => enfant.kill('SIGKILL'), 8000)
    enfant.on('error', (e) => { clearTimeout(securite); reject(e) })
    enfant.on('exit', (code, signal) => { clearTimeout(securite); resolve({ code, signal }) })
  })
}

describe('carte de chaleur — le fichier écrit quand le process s\'arrête (src/mjs-ws/heatmap.ts)', function () {
  this.timeout(10000)

  it('systemctl stop (SIGTERM) : les points sont dans le fichier, et le process part bien sur le signal', async () => {
    const file = join(mjsTmp('heatmap-sigterm'), 'heatmap.json')
    const { code, signal } = await lancer(file, 'sigterm')
    assert.ok(signal === 'SIGTERM' || code === 143, `terminaison par SIGTERM attendue — code=${code} signal=${signal}`)
    assert.ok(existsSync(file), 'fichier absent : les points seraient perdus à chaque redémarrage')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages[0].url, 'https://site.fr/')
  })

  it('fin normale (process.exit) : pareil', async () => {
    const file = join(mjsTmp('heatmap-exit'), 'heatmap.json')
    const { code } = await lancer(file, 'exit')
    assert.equal(code, 0)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages[0].zones[0].pts[0][0], 0.5)
  })
})
