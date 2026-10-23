// `mjs dev` :
// - avec `--output`, `--manifest` ou `--prod`, le prérendu relancé à chaque sauvegarde ignorait
//   ces drapeaux : il recompilait dans le dossier de sortie de mjs.config.json (le VRAI dossier du
//   projet) et en mode développement — le sinistre que `mjs build` avait déjà corrigé chez lui ;
// - le verrou « un seul mjs dev par projet » vivait dans le dossier de lancement : `--root proj`
//   et `--root proj/app` tournaient ensemble sur la même sortie. Il vit à la racine du projet
//   (dossier de mjs.config.json).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { prerenderOnDevRecompile } from '../src/cli/dev-prerender.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

describe('mjs dev — prérendu fidèle aux drapeaux, verrou à la racine du projet', function () {
  this.timeout(60000)

  it('le prérendu de mjs dev reçoit outputDir, manifestPath et env', async () => {
    let recu: any[] = []
    await prerenderOnDevRecompile({ render: { routes: {} } } as any, '/projet', {
      prerenderFn: (async (...a: any[]) => { recu = a; return { outDir: '', generated: [], skipped: [] } }) as any,
      overrides: { outputDir: 'ailleurs', manifestPath: 'ailleurs/bundle.js', env: 'prod' },
    })
    assert.deepEqual(recu[3], { outputDir: 'ailleurs', manifestPath: 'ailleurs/bundle.js', env: 'prod' })
  })

  it('un mjs dev lancé depuis un sous-dossier du projet voit le verrou de la racine', function () {
    const root = mjsTmp('dev-verrou-racine')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'salut.mjs'), '<p>salut</p>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out' }))
    // verrou d'un processus VIVANT (celui du test) à la racine du projet
    writeFileSync(join(root, '.mjs-dev.lock'), String(process.pid))
    const port = String(56000 + Math.floor(Math.random() * 2000))
    const r = spawnSync(tsxBin, [cliPath, 'dev', '--root', join(root, 'app'), '--port', port], { encoding: 'utf-8', timeout: 20000 })
    assert.equal(r.status, 1, 'le second mjs dev doit refuser de démarrer\n' + r.stdout + r.stderr)
    assert.equal(existsSync(join(root, 'app', '.mjs-dev.lock')), false)
  })
})
