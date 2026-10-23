// Un projet qui construit dans son dossier des sources (`outputDir` sous `sourceDir`, par mjs.config.json ou par le seul
// drapeau `--output`) peut y garder son manifeste : la règle qui refuse un `manifestPath` dans les sources ne s'applique
// pas. Le manifeste y côtoie alors les fichiers de l'auteur, et `manifestPath` (ou `--manifest`) sur l'un d'eux le
// remplaçait par le manifeste produit, code 0, sans un mot. Un fichier existant n'est désormais remplacé que s'il porte
// la marque des fichiers que la construction produit : sinon code 1, et rien n'est écrit. Un manifeste que le build a
// lui-même écrit se réécrit d'une construction à l'autre. Le contrôle est fait au build, jamais à la lecture de mjs.config.json.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findConfig } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outil    = 'export const outil = 1 // fichier de l auteur\n'
const main     = 'import "./outil.js" // point d entrée de l auteur\n'

// projet type : composant et module de l'auteur sous app/modularjs, son propre point d'entrée sous src/
function projet(config: Record<string, unknown>): string {
  const root = mjsTmp('manifeste-sortie-sources')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<p>carte</p>\n')
  writeFileSync(join(root, 'app', 'modularjs', 'outil.js'), outil)
  writeFileSync(join(root, 'src', 'main.js'), main)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  return root
}

function build(root: string, ...args: string[]): { status: number | null, sortie: string } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, ...args], { cwd: repoRoot, encoding: 'utf-8' })
  return { status: r.status, sortie: `${r.stdout}${r.stderr}` }
}

describe('sortie dans le dossier des sources : manifestPath ne remplace jamais un fichier de l\'auteur', function () {
  this.timeout(180000)

  it('mjs.config.json, sortie sous les sources et manifeste sur un module de l\'auteur : code 1, fichier intact, rien d\'écrit', () => {
    const root = projet({ sourceDir: 'app/modularjs', outputDir: 'app/modularjs/build', manifestPath: 'app/modularjs/outil.js' })
    const { status, sortie } = build(root)
    assert.equal(status, 1, sortie)
    assert.match(sortie, /manifestPath/)
    assert.equal(readFileSync(join(root, 'app', 'modularjs', 'outil.js'), 'utf-8'), outil)
    assert.ok(!existsSync(join(root, 'app', 'modularjs', 'build')), 'dossier de sortie créé')
    assert.ok(!existsSync(join(root, 'app', 'modularjs', '.mjs-outputs.json')), 'registre écrit dans les sources')
  })

  it('drapeaux `--output app/modularjs/build --manifest app/modularjs/outil.js` : code 1, fichier intact, rien d\'écrit', () => {
    const root = projet({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs' })
    const { status, sortie } = build(root, '--output', 'app/modularjs/build', '--manifest', 'app/modularjs/outil.js')
    assert.equal(status, 1, sortie)
    assert.match(sortie, /outil\.js/)
    assert.equal(readFileSync(join(root, 'app', 'modularjs', 'outil.js'), 'utf-8'), outil)
    assert.ok(!existsSync(join(root, 'app', 'modularjs', 'build')), 'dossier de sortie créé')
    assert.deepEqual(readdirSync(join(root, 'app', 'modularjs')).sort(), ['carte.mjs', 'outil.js'])
  })

  it('`sourceDir: "app"`, sortie `app/public`, manifeste sur `app/modularjs/outil.js` : code 1, fichier intact', () => {
    const root = projet({ sourceDir: 'app', outputDir: 'app/public', manifestPath: 'app/modularjs/outil.js' })
    const { status, sortie } = build(root)
    assert.equal(status, 1, sortie)
    assert.equal(readFileSync(join(root, 'app', 'modularjs', 'outil.js'), 'utf-8'), outil)
    assert.ok(!existsSync(join(root, 'app', 'public')), 'dossier de sortie créé')
  })

  it('`sourceDir: "."` et `manifestPath: "src/main.js"`, le point d\'entrée de l\'auteur : code 1, fichier intact', () => {
    const root = projet({ sourceDir: '.', outputDir: 'public/modularjs', manifestPath: 'src/main.js' })
    const { status, sortie } = build(root)
    assert.equal(status, 1, sortie)
    assert.equal(readFileSync(join(root, 'src', 'main.js'), 'utf-8'), main)
    assert.ok(!existsSync(join(root, 'public')), 'dossier de sortie créé')
  })

  it('lecture de mjs.config.json : aucun refus (mjs ws et mjs serveur démarrent) ; la construction refuse en nommant le fichier', () => {
    const root = projet({ sourceDir: 'app/modularjs', outputDir: 'app/modularjs/build', manifestPath: 'app/modularjs/outil.js' })
    assert.doesNotThrow(() => findConfig(root))
    const { status, sortie } = build(root)
    assert.equal(status, 1, sortie)
    assert.match(sortie, /manifestPath/)
    assert.match(sortie, /outil\.js/)
    assert.equal(readFileSync(join(root, 'app', 'modularjs', 'outil.js'), 'utf-8'), outil)
  })

  it('témoin : `sourceDir: "."`, manifeste sous la sortie, deux constructions de suite en code 0', () => {
    const root = projet({ sourceDir: '.', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' })
    const premier = build(root)
    assert.equal(premier.status, 0, premier.sortie)
    assert.ok(existsSync(join(root, 'public', 'modularjs', 'bundle.js')))
    writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<p>carte modifiée</p>\n')
    const second = build(root)
    assert.equal(second.status, 0, second.sortie)
    assert.equal(readFileSync(join(root, 'src', 'main.js'), 'utf-8'), main)
  })

  it('témoin : un manifeste que le build a lui-même écrit dans les sources se réécrit au build suivant', () => {
    const root = projet({ sourceDir: '.', outputDir: 'public/modularjs', manifestPath: 'src/entree.js' })
    const premier = build(root)
    assert.equal(premier.status, 0, premier.sortie)
    const avant = readFileSync(join(root, 'src', 'entree.js'), 'utf-8')
    writeFileSync(join(root, 'app', 'modularjs', 'autre.mjs'), '<p>autre</p>\n')
    const second = build(root)
    assert.equal(second.status, 0, second.sortie)
    assert.notEqual(readFileSync(join(root, 'src', 'entree.js'), 'utf-8'), avant, 'manifeste non réécrit')
    assert.equal(readFileSync(join(root, 'src', 'main.js'), 'utf-8'), main)
  })
})
