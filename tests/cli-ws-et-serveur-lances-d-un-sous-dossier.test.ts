// `mjs ws` et `mjs serveur` lancés depuis un sous-dossier du projet trouvaient bien `../mjs.config.json`, mais cherchaient `ws.entry`,
// `serveur.entry` et leurs défauts (`ws.js`, `serveur.js`) dans le sous-dossier : « introuvable ». Les chemins de la configuration et
// les défauts se lisent depuis le dossier de mjs.config.json, comme pour `mjs dev` et `mjs build` ; `--entry` reste relatif au
// dossier courant

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const chargeur = pathToFileURL(join(repoRoot, 'node_modules/tsx/dist/loader.mjs')).href

function portAuHasard(): number { return 52000 + Math.floor(Math.random() * 6000) }

// lance la commande dans `dossier` ; rend les lignes affichées dès la bannière (serveur démarré), ou à la sortie du processus
function lancer(dossier: string, args: string[]): Promise<{ demarre: boolean, lignes: string[] }> {
  return new Promise((ok) => {
    const enfant = spawn(process.execPath, ['--import', chargeur, join(repoRoot, 'src/cli.ts'), ...args], { cwd: dossier, env: { ...process.env, NO_COLOR: '1' } })
    const lignes: string[] = []
    let fini = false
    const finir = (demarre: boolean): void => {
      if (fini) return
      fini = true
      clearTimeout(garde)
      enfant.kill('SIGTERM')
      setTimeout(() => enfant.kill('SIGKILL'), 4000).unref()
      ok({ demarre, lignes })
    }
    const garde = setTimeout(() => finir(false), 20000)
    const lire = (b: Buffer): void => {
      for (const l of b.toString('utf-8').split('\n')) if (l.trim()) lignes.push(l)
      if (lignes.some(l => l.includes('Ctrl-C'))) finir(true)
    }
    enfant.stdout.on('data', lire)
    enfant.stderr.on('data', lire)
    enfant.on('close', () => finir(false))
  })
}

describe('mjs ws et mjs serveur lancés depuis un sous-dossier du projet', function () {
  this.timeout(60000)

  it('mjs ws : ws.entry de la configuration trouvé depuis app/', async () => {
    const p = mjsTmp('ws-sous-dossier')
    mkdirSync(join(p, 'server'), { recursive: true })
    mkdirSync(join(p, 'app'), { recursive: true })
    writeFileSync(join(p, 'mjs.config.json'), JSON.stringify({ ws: { entry: 'server/temps-reel.mjs' } }))
    writeFileSync(join(p, 'server/temps-reel.mjs'), 'export default {\n  setup(app) {}\n}\n')
    const r = await lancer(join(p, 'app'), ['ws', '--port', String(portAuHasard())])
    assert.ok(r.demarre, r.lignes.join('\n'))
  })

  it('mjs serveur : défaut serveur.js trouvé depuis app/', async () => {
    const p = mjsTmp('serveur-sous-dossier')
    mkdirSync(join(p, 'app'), { recursive: true })
    writeFileSync(join(p, 'mjs.config.json'), JSON.stringify({}))
    writeFileSync(join(p, 'serveur.js'), 'export default {\n  setup(app) {}\n}\n')
    const r = await lancer(join(p, 'app'), ['serveur', '--port', String(portAuHasard())])
    assert.ok(r.demarre, r.lignes.join('\n'))
  })

  it('--entry reste relatif au dossier courant', async () => {
    const p = mjsTmp('ws-entry-courant')
    mkdirSync(join(p, 'app'), { recursive: true })
    writeFileSync(join(p, 'mjs.config.json'), JSON.stringify({}))
    writeFileSync(join(p, 'app/point.mjs'), 'export default {\n  setup(app) {}\n}\n')
    const r = await lancer(join(p, 'app'), ['ws', '--entry', 'point.mjs', '--port', String(portAuHasard())])
    assert.ok(r.demarre, r.lignes.join('\n'))
  })
})
