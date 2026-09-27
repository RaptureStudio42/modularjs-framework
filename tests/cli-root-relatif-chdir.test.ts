// `mjs ws --root <relatif>` / `mjs serveur --root <relatif>` : cli.ts fait chdir(args.root) puis
// repasse args.root TEL QUEL (chaîne relative brute, jamais ré-ancrée) à runWsCommand/
// runServeurCommand — resolveEntryPath('child', ...) part alors du cwd DÉJÀ déplacé et cherche
// <root>/child/child/…, un chemin qui n'existe jamais. Sous-processus RÉEL (cli.ts exécute
// `run(process.argv)` à son chargement) sur un projet fixture, jamais dans le dépôt.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

function randomPort(): number { return 58000 + Math.floor(Math.random() * 2000) }

const WS_ENTRY_SKELETON = `pong = -> 'pong'

export default
  setup: (app) ->
    app.serve 'ping', pong
`

const SERVEUR_ENTRY_SKELETON = `export default
  setup: (app) ->
    app.game 'morpion',
      seats: 2
      state: (partie) -> { grille: Array(9).fill(null) }
      moves:
        jouer: (partie, joueur, p) ->
          partie.state.grille[p.i] = joueur.id
          partie.next()
`

/** Lance `mjs ws`/`mjs serveur --root <root>` avec le process CLI démarré depuis `cwd` (`--root`
 *  est résolu relativement à CE cwd, avant le chdir de cli.ts) et attend soit la bannière de
 *  démarrage, soit la sortie du process. Toujours refermé proprement. */
async function lanceEtAttends(commande: 'ws' | 'serveur', cwd: string, root: string, port: number): Promise<{ sortie: string; demarre: boolean }> {
  const enfant = spawn(tsxBin, [cliPath, commande, '--root', root, '--port', String(port)], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let sortie = ''
  enfant.stdout.on('data', (d: Buffer) => { sortie += d.toString() })
  enfant.stderr.on('data', (d: Buffer) => { sortie += d.toString() })
  const fini = new Promise<void>(resolve => enfant.on('exit', () => resolve()))
  const pret = commande === 'ws' ? /MJS-WS — entry/ : /MJS-Server — entry/
  const debut = Date.now()
  while (Date.now() - debut < 15000 && !pret.test(sortie) && enfant.exitCode === null) await new Promise(r => setTimeout(r, 100))
  const demarre = pret.test(sortie)
  if (demarre) {
    enfant.kill('SIGINT')
    await Promise.race([fini, new Promise<void>(r => setTimeout(r, 5000))])
    if (enfant.exitCode === null) { enfant.kill('SIGKILL'); await fini }
  } else {
    await Promise.race([fini, new Promise<void>(r => setTimeout(r, 2000))])
    if (enfant.exitCode === null) { enfant.kill('SIGKILL'); await fini }
  }
  return { sortie, demarre }
}

describe("cli.ts — '--root' relatif : mjs ws / mjs serveur ne doublent pas le dossier après chdir", function () {
  this.timeout(30000)

  it('mjs ws --root <relatif> démarre : entry trouvée à la racine du dossier ciblé, jamais <root>/<root>', async () => {
    // le process CLI démarre depuis `parent` ; `--root app` doit désigner `parent/app`, PAS
    // `parent/app/app` (le nom du sous-dossier est délibérément identique à l'argument --root,
    // pour que le doublement soit visible s'il a lieu).
    const parent = mjsTmp('root-relatif-ws')
    const cible = join(parent, 'app')
    mkdirSync(cible, { recursive: true })
    writeFileSync(join(cible, 'ws.server.mjs'), WS_ENTRY_SKELETON)
    const { sortie, demarre } = await lanceEtAttends('ws', parent, 'app', randomPort())
    assert.ok(demarre, `mjs ws --root app (cwd=${parent}) doit démarrer (bannière MJS-WS). Sortie :\n${sortie}`)
    assert.doesNotMatch(sortie, /introuvable/, `BUG confirmé si l'entry est cherchée deux dossiers plus bas (app/app). Sortie :\n${sortie}`)
  })

  it('mjs serveur --root <relatif> démarre : même correctif (chdir unique, root ré-ancré une fois)', async () => {
    const parent = mjsTmp('root-relatif-serveur')
    const cible = join(parent, 'app')
    mkdirSync(cible, { recursive: true })
    writeFileSync(join(cible, 'serveur.server.mjs'), SERVEUR_ENTRY_SKELETON)
    const { sortie, demarre } = await lanceEtAttends('serveur', parent, 'app', randomPort())
    assert.ok(demarre, `mjs serveur --root app (cwd=${parent}) doit démarrer (bannière MJS-Server). Sortie :\n${sortie}`)
    assert.doesNotMatch(sortie, /introuvable/, `BUG confirmé si l'entry est cherchée deux dossiers plus bas (app/app). Sortie :\n${sortie}`)
  })

  it('non-régression : mjs ws --root <ABSOLU> continue de démarrer normalement', async () => {
    const parent = mjsTmp('root-absolu-ws')
    writeFileSync(join(parent, 'ws.server.mjs'), WS_ENTRY_SKELETON)
    const { sortie, demarre } = await lanceEtAttends('ws', repoRoot, parent, randomPort())
    assert.ok(demarre, `mjs ws --root <absolu> doit toujours démarrer. Sortie :\n${sortie}`)
  })
})
