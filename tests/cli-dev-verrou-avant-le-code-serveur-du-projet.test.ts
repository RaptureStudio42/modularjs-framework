// mjs dev refusé par le verrou (un autre mjs dev tourne sur le projet) : le refus vient AVANT tout code du projet — l'entrée serveur
// `serve.server.mjs` n'est ni chargée ni exécutée
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

after(() => sweepRegistered())

describe('mjs dev — le verrou est contrôlé avant le code serveur du projet', function () {
  this.timeout(60000)

  it('un second mjs dev refusé par le verrou n\'exécute pas serve.server.mjs', function () {
    const root = mjsTmp('dev-verrou-avant-serveur')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'salut.mjs'), '<p>salut</p>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out' }))
    writeFileSync(join(root, 'serve.server.mjs'), "console.log('ENTREE-SERVEUR-EXECUTEE')\n\nexport default {}\n")
    // verrou d'un processus VIVANT (celui du test)
    writeFileSync(join(root, '.mjs-dev.lock'), String(process.pid))
    const port   = String(56000 + Math.floor(Math.random() * 2000))
    const r      = spawnSync(tsxBin, [cliPath, 'dev', '--root', root, '--port', port], { encoding: 'utf-8', timeout: 30000, env: { ...process.env, NO_COLOR: '1' } })
    const sortie = r.stdout + r.stderr
    assert.equal(r.status, 1, sortie)
    assert.match(sortie, /Un autre 'mjs dev' tourne déjà/)
    assert.ok(!sortie.includes('ENTREE-SERVEUR-EXECUTEE'), 'serve.server.mjs exécuté avant le refus du verrou :\n' + sortie)
    assert.ok(!sortie.includes('serve.server.mjs'), 'entrée serveur chargée avant le refus du verrou :\n' + sortie)
  })
})
