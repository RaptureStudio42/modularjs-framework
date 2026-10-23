// un dossier de sortie qui CONTIENT la racine du projet (`"outputDir": ".."`, ou `--output ..`) faisait servir par `mjs dev` et
// `mjs serve` tout ce dossier parent : les fichiers privés d'une appli voisine rangée à côté (secrets, code serveur) partaient
// tels quels. Cette configuration est refusée au démarrage de `mjs build`, `mjs dev` et `mjs serve`, avant toute compilation,
// avec un message qui nomme le dossier ; la racine du projet elle-même (`"outputDir": "."`) reste permise, ses fichiers privés
// sont déjà gardés par le serveur.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const REFUS    = /contient la racine du projet|contains the project root/

// un dossier parent qui range le projet et une appli voisine aux fichiers privés
function voisinage(prefixe: string, config: Record<string, unknown>): { parent: string, projet: string } {
  const parent = mjsTmp(prefixe)
  const projet = join(parent, 'proj')
  mkdirSync(join(projet, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(projet, 'app', 'modularjs', 'carte.mjs'), '<p>carte</p>\n')
  writeFileSync(join(projet, 'mjs.config.json'), JSON.stringify(config))
  mkdirSync(join(parent, 'autre'), { recursive: true })
  writeFileSync(join(parent, 'autre', 'secrets.json'), '{ "cle": "secrète" }\n')
  return { parent, projet }
}

// un démarrage refusé rend la main aussitôt ; un serveur lancé malgré tout est arrêté par le délai
function lancer(args: string[]): { status: number | null, err: string } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', ...args], { cwd: repoRoot, encoding: 'utf-8', timeout: 25000 })
  return { status: r.status, err: String(r.stderr) + String(r.stdout) }
}

describe('cli.ts — un dossier de sortie qui contient la racine du projet est refusé', function () {
  this.timeout(180000)

  for (const commande of ['build', 'dev', 'serve']) {
    it(`mjs ${commande} avec "outputDir": ".." : refusé avant toute compilation, rien n'est écrit dans le dossier parent`, () => {
      const { parent, projet } = voisinage('sortie-parent-' + commande, { sourceDir: 'app/modularjs', outputDir: '..', manifestPath: '../bundle.js' })
      const { status, err } = lancer([commande, '--root', projet, ...(commande === 'build' ? [] : ['--port', '0'])])
      assert.equal(status, 1, err)
      assert.match(err, REFUS, err)
      assert.ok(err.includes(parent), `le message nomme le dossier de sortie -> ${err}`)
      assert.equal(existsSync(join(parent, 'bundle.js')), false, 'manifeste écrit dans le dossier parent')
    })
  }

  it('--output qui désigne le dossier parent : refusé de même', () => {
    const { parent, projet } = voisinage('sortie-parent-option', { sourceDir: 'app/modularjs' })
    const { status, err } = lancer(['build', '--root', projet, '--output', parent, '--manifest', join(projet, 'bundle.js')])
    assert.equal(status, 1, err)
    assert.match(err, REFUS, err)
  })

  it('"outputDir": "." (la racine du projet elle-même) reste permis', () => {
    const { projet } = voisinage('sortie-racine-meme', { sourceDir: 'app/modularjs', outputDir: '.', manifestPath: 'bundle.js' })
    const { status, err } = lancer(['build', '--root', projet])
    assert.doesNotMatch(err, REFUS, err)
    assert.equal(status, 0, err)
    assert.ok(existsSync(join(projet, 'bundle.js')), 'construction faite')
  })
})
