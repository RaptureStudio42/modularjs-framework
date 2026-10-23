// Dossier de sortie égal au dossier des sources dans un projet traduit par sections : le build le refuse (les fragments
// iraient dans le dossier même des traductions de l'auteur). Le refus tombait APRÈS l'écriture des sorties : le cœur,
// les composants, le manifeste externe et le registre `.mjs-outputs.json` restaient déposés parmi les sources, et plus
// jamais retirés une fois `outputDir` corrigé (ce registre n'est plus relu). Le refus arrive désormais avant toute
// écriture : le dossier des sources est le même, fichier pour fichier, avant et après la construction refusée.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const auteur   = '{\n  "titre": "Bonjour"\n}\n'

// sources : un composant traduit, un module et le manifeste externe de l'auteur, une traduction par sections
function sources(app: string): void {
  mkdirSync(join(app, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(app, 'carte.mjs'), "<p>{µt('admin.titre')}</p>\n")
  writeFileSync(join(app, 'outil.js'), 'export const outil = 1\n')
  writeFileSync(join(app, 'manifest.civet'), '# mon code a moi\n')
  writeFileSync(join(app, 'i18n', 'fr', 'admin.json'), auteur)
}

// tous les fichiers sous `dossier`, chemins relatifs triés
function liste(dossier: string): string[] {
  return (readdirSync(dossier, { recursive: true }) as string[]).map(String).sort()
}

describe('sortie égale aux sources dans un projet traduit : le refus arrive avant toute écriture', function () {
  this.timeout(180000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const keep of [false, true]) {
    it(`${keep ? 'développement' : 'build'} : aucun fichier ajouté aux sources, l'erreur demande un dossier de sortie distinct`, async () => {
      const app = mjsTmp(`i18n-sur-place-rien-${keep}`)
      sources(app)
      const avant = liste(app)
      const b = new Bundler({ sourceDir: app, outputDir: app, manifestPath: join(app, 'bundle.js'), i18n: { default: 'fr' }, keepFailedComponents: keep })
      const s = await b.compile()
      await b.close()
      assert.deepEqual(liste(app), avant, 'fichiers écrits dans les sources par le build refusé')
      assert.equal(s.errors.length, 1, s.errors.map(e => e.message).join('\n') || 'aucune erreur')
      assert.match(s.errors[0].message, /outputDir/)
    })
  }

  it('CLI, `build --output app/modularjs --manifest app/modularjs/bundle.js` : code 1, aucun fichier ajouté aux sources', () => {
    const root = mjsTmp('i18n-sur-place-rien-cli')
    const app  = join(root, 'app', 'modularjs')
    sources(app)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', i18n: { default: 'fr' } }))
    const avant = liste(app)
    const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, '--output', 'app/modularjs', '--manifest', 'app/modularjs/bundle.js'], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`)
    assert.deepEqual(liste(app), avant, 'fichiers écrits dans les sources par le build refusé')
    assert.equal(readFileSync(join(app, 'i18n', 'fr', 'admin.json'), 'utf-8'), auteur)
  })
})
