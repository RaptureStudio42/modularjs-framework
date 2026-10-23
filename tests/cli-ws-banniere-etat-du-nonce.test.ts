// bannière de `mjs ws` : avec un pont déclaré, elle dit si le nonce anti-rejeu est exigé (défaut) ou coupé
// (`bridge.nonce: false`) — sans cette ligne, rien au lancement ne disait qu'une recette sans en-tête
// x-mjs-ws-nonce serait refusée. Process enfant réel, même patron que tests/cli-ws-host-flag.test.ts.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot  = join(__dirname, '..')
const SECRET    = 'secret-de-test-banniere-nonce-1234567890abcdef'

after(() => sweepRegistered())

function randomPort(): number { return 59000 + Math.floor(Math.random() * 1500) }

// résout dès la ligne 'Ctrl-C pour arrêter', imprimée par printBanner après app.listen()
function lancerMjsWs(args: string[]): Promise<{ lignes: string[]; stop: () => Promise<void> }> {
  return new Promise((resolvePromise, reject) => {
    const enfant = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'ws', ...args], { cwd: repoRoot })
    const lignes: string[] = []
    let pret = false
    const securite = setTimeout(() => { enfant.kill('SIGKILL'); reject(new Error(`démarrage jamais confirmé. lignes:\n${lignes.join('\n')}`)) }, 8000)
    const surSortie = (buf: Buffer) => {
      for (const ligne of buf.toString('utf-8').split('\n')) if (ligne) lignes.push(ligne)
      if (!pret && lignes.some(l => l.includes('Ctrl-C pour arrêter'))) {
        pret = true
        clearTimeout(securite)
        resolvePromise({
          lignes,
          stop: () => new Promise<void>((res) => {
            enfant.once('exit', () => res())
            enfant.kill('SIGTERM')
            setTimeout(() => enfant.kill('SIGKILL'), 4000)
          }),
        })
      }
    }
    enfant.stdout.on('data', surSortie)
    enfant.stderr.on('data', surSortie)
    enfant.on('error', (e) => { clearTimeout(securite); reject(e) })
    enfant.on('exit', (code) => {
      if (pret) return
      clearTimeout(securite)
      reject(new Error(`mjs ws terminé prématurément (code ${code}). lignes:\n${lignes.join('\n')}`))
    })
  })
}

async function banniere(nonce: string): Promise<string[]> {
  const root = mjsTmp('cli-ws-banniere-nonce')
  const port = randomPort()
  writeFileSync(join(root, 'ws.mjs'), `export default {\n  bridge: { port: ${port + 1600}, secret: '${SECRET}'${nonce} },\n  setup(app) {},\n}\n`)
  const { lignes, stop } = await lancerMjsWs(['--root', root, '--entry', 'ws.mjs', '--port', String(port)])
  await stop()
  return lignes
}

describe('cli.ts — la bannière de `mjs ws` dit l\'état du nonce du pont', function () {
  this.timeout(20000)

  it('pont aux réglages par défaut → « nonce anti-rejeu : exigé »', async () => {
    const lignes = await banniere('')
    assert.ok(lignes.some(l => l.includes('nonce anti-rejeu : exigé')), `bannière sans l'état du nonce. lignes:\n${lignes.join('\n')}`)
  })

  it('bridge.nonce: false → « nonce anti-rejeu : coupé »', async () => {
    const lignes = await banniere(', nonce: false')
    assert.ok(lignes.some(l => l.includes('nonce anti-rejeu : coupé')), `bannière sans l'état du nonce coupé. lignes:\n${lignes.join('\n')}`)
    assert.ok(!lignes.some(l => l.includes('nonce anti-rejeu : exigé')), `nonce coupé annoncé exigé. lignes:\n${lignes.join('\n')}`)
  })
})
