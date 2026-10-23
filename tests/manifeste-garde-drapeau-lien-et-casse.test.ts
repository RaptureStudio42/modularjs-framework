// `manifestPath` ne désigne jamais un fichier source de l'application, quel que soit le chemin pour y arriver. Le drapeau
// `--manifest` passe par la même garde que mjs.config.json : `mjs build --manifest app/modularjs/manifest.civet`
// construisait en vert (code 0) puis remplaçait le manifeste externe de l'auteur par le manifeste produit. Les chemins se
// comparent sur le disque : un lien symbolique vers le dossier des sources y mène comme le chemin direct, et un disque
// insensible à la casse (macOS, Windows) lit `App/Modularjs` comme `app/modularjs`.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findConfig } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const civet    = '# mon code a moi\n'
const outil    = 'export const outil = 1 // fichier de l auteur\n'

// projet type : sources sous app/modularjs (manifeste externe et module de l'auteur), un lien `lien` vers ce dossier
function projet(config: Record<string, unknown>): string {
  const root = mjsTmp('manifeste-garde')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<p>carte</p>\n')
  writeFileSync(join(root, 'app', 'modularjs', 'manifest.civet'), civet)
  writeFileSync(join(root, 'app', 'modularjs', 'outil.js'), outil)
  symlinkSync('app/modularjs', join(root, 'lien'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  return root
}

function build(root: string, ...args: string[]): { status: number | null, sortie: string } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, ...args], { cwd: repoRoot, encoding: 'utf-8' })
  return { status: r.status, sortie: `${r.stdout}${r.stderr}` }
}

// plateforme simulée le temps d'un appel (la casse ne se teste pas autrement sur un disque Linux)
function sur<T>(plateforme: string, fn: () => T): T {
  const avant = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...avant, value: plateforme })
  try {
    return fn()
  }
  finally {
    Object.defineProperty(process, 'platform', avant)
  }
}

const config = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs' }

describe('manifestPath : jamais un fichier source, ni par le drapeau, ni par un lien, ni par la casse', function () {
  this.timeout(120000)

  it('`--manifest app/modularjs/manifest.civet` : code 1, le manifeste externe de l\'auteur reste intact', () => {
    const root = projet(config)
    const { status, sortie } = build(root, '--manifest', 'app/modularjs/manifest.civet')
    assert.equal(status, 1, sortie)
    assert.match(sortie, /manifest/)
    assert.equal(readFileSync(join(root, 'app', 'modularjs', 'manifest.civet'), 'utf-8'), civet)
  })

  it('`--manifest lien/outil.js`, un lien vers le dossier des sources : code 1, le fichier de l\'auteur reste intact', () => {
    const root = projet(config)
    const { status, sortie } = build(root, '--manifest', 'lien/outil.js')
    assert.equal(status, 1, sortie)
    assert.equal(readFileSync(join(root, 'app', 'modularjs', 'outil.js'), 'utf-8'), outil)
  })

  it('témoin : `--manifest` à côté des fichiers produits construit normalement', () => {
    const root = projet(config)
    const { status, sortie } = build(root, '--manifest', 'public/modularjs/entree.js')
    assert.equal(status, 0, sortie)
    assert.ok(existsSync(join(root, 'public', 'modularjs', 'entree.js')))
  })

  it('mjs.config.json : `manifestPath` par un lien vers le dossier des sources, refusé à la lecture', () => {
    assert.throws(() => findConfig(projet({ ...config, manifestPath: 'lien/outil.js' })), /manifestPath.*sourceDir/)
  })

  it('disque insensible à la casse (macOS, Windows) : `App/Modularjs/outil.js` désigne le dossier des sources, refusé', () => {
    const root = projet({ ...config, manifestPath: 'App/Modularjs/outil.js' })
    sur('darwin', () => assert.throws(() => findConfig(root), /manifestPath.*sourceDir/))
    sur('win32', () => assert.throws(() => findConfig(root), /manifestPath.*sourceDir/))
    // disque sensible à la casse : un autre dossier, accepté
    sur('linux', () => assert.doesNotThrow(() => findConfig(root)))
  })
})
