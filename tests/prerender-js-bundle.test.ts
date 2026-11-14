// `js: 'bundle'` × bloc `render` — le rendu serveur RECOMPILE le projet pour monter ses
// composants, et ce mode d'émission lui est INTERDIT (il relit le cœur et chaque composant fichier
// par fichier) : sa recompilation force `js: 'split'`. Écrite dans le VRAI dossier de sortie, elle
// remplaçait donc le fichier unique du build par un manifeste éclaté et semait ses unités à côté.
// Contrat : le rendu serveur compile CHEZ LUI quand le projet émet un fichier unique — le dossier
// de sortie et le manifeste du build restent intacts, et les URLs d'assets du HTML rendu restent
// celles du VRAI build (`urlPrefix`), jamais celles de son dossier de travail.
//
// Test via un VRAI SOUS-PROCESSUS (cli.ts exécute `run(process.argv)` à son top-level, l'importer
// serait dangereux), sur un projet FIXTURE minimal en dossier temporaire.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// 1×1 PNG transparent — asset local RÉEL pour `µasset` (le build refuse un chemin absent)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// le bloc `render` est toujours là, avec ou sans page à prérendre : une construction qui rend côté serveur garde ce que ce rendu relit d'un
// composant, une construction sans `render` ne l'emporte pas — le témoin prend donc la même décision que le projet, seul le prérendu les sépare
function fixtureProject(prefix: string, pages: boolean): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'logo.png'), PNG_1PX)
  writeFileSync(join(root, 'src', 'app-home.mjs'), [
    '<style>',
    ':host',
    '  display: block',
    '  color: crimson',
    '</style>',
    '<script>',
    '$titre = \'Accueil\'',
    '$logo  = µasset(\'logo.png\')',
    '</script>',
    '',
    '<h1 class="t">{$titre}</h1>',
    '<img class="logo" src={$logo} alt="logo">',
  ].join('\n') + '\n')
  const config: Record<string, unknown> = { sourceDir: 'src', outputDir: 'dist', manifestPath: 'dist/bundle.js', urlPrefix: '/dist', js: 'bundle', runtime: 'core', render: { default: 'prerender', engine: { prerender: 'happy-dom' }, routes: pages ? { '/': { component: 'mjs-app-home' } } : {} } }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return root
}

function build(root: string): void {
  const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, '--prod'], { cwd: repoRoot, encoding: 'utf-8' })
  assert.equal(result.status, 0, `build en échec :\n${result.stderr}\n${result.stdout}`)
}

describe('`js: \'bundle\'` × prérendu — le rendu serveur ne touche pas au build', function () {
  this.timeout(120000)

  it('le fichier unique et le dossier de sortie survivent au prérendu (mêmes octets qu\'un build du même projet sans page à prérendre)', () => {
    const temoin = fixtureProject('bundle-prerender-temoin', false)
    const projet = fixtureProject('bundle-prerender', true)
    build(temoin)
    build(projet)
    assert.ok(!existsSync(join(temoin, 'mjs_pages')), 'le témoin ne prérend aucune page')

    const attendu = readFileSync(join(temoin, 'dist', 'bundle.js'))
    const obtenu  = readFileSync(join(projet, 'dist', 'bundle.js'))
    assert.equal(obtenu.length, attendu.length, `bundle.js doit rester le fichier unique du build (témoin ${attendu.length} o, obtenu ${obtenu.length} o)`)
    assert.ok(obtenu.equals(attendu), 'bundle.js doit être BYTE-identique à celui d\'un build sans page à prérendre')

    // le prérendu n'ajoute aucun .js : ceux du témoin, soit le fichier unique et, en production, le chargeur des messages de la console
    // (`mjs_msg-<empreinte>.js`, téléchargé au premier message seulement)
    const jsDe    = (racine: string): string[] => readdirSync(join(racine, 'dist')).filter(f => f.endsWith('.js')).sort()
    const jsFiles = jsDe(projet)
    assert.deepEqual(jsFiles, jsDe(temoin), `le prérendu n'ajoute aucun .js au build, trouvé : ${jsFiles.join(', ')}`)
    assert.deepEqual(jsFiles.map(f => f.replace(/^mjs_msg-[0-9a-z]{5}\.js$/, 'mjs_msg-<empreinte>.js')), ['bundle.js', 'mjs_msg-<empreinte>.js'], `le fichier unique et le chargeur des messages, rien d'autre dans dist, trouvé : ${jsFiles.join(', ')}`)
  })

  it('le fragment prérendu ne cite aucun module virtuel `mjs:unit/` (rien à précharger : tout est dans le fichier unique)', () => {
    const projet = fixtureProject('bundle-prerender-unites', true)
    build(projet)
    const fragment = readFileSync(join(projet, 'mjs_pages', 'index.html'), 'utf-8')
    assert.ok(!fragment.includes('mjs:unit/'), `aucun 'mjs:unit/' attendu dans le fragment, obtenu :\n${fragment}`)
    assert.match(fragment, /<mjs-app-home[^>]*>/, 'le fragment doit bien porter la racine prérendue')
    assert.match(fragment, /Accueil/, 'le binding {$titre} doit être résolu au serveur')
  })

  it('les URLs d\'assets du HTML rendu restent celles du VRAI build (`urlPrefix`), jamais du dossier de travail du rendu', () => {
    const projet = fixtureProject('bundle-prerender-assets', true)
    build(projet)
    const fragment = readFileSync(join(projet, 'mjs_pages', 'index.html'), 'utf-8')
    const src = /src="([^"]*logo[^"]*)"/.exec(fragment)
    assert.ok(src, `l'image de µasset doit apparaître dans le fragment, obtenu :\n${fragment}`)
    assert.match(src![1], /^\/dist\/logo-[a-f0-9]{8}\.png$/, `URL d'asset attendue sous le préfixe public du projet, obtenue : ${src![1]}`)
    assert.ok(statSync(join(projet, 'dist', src![1].slice('/dist/'.length))).isFile(), 'le fichier visé par cette URL doit exister dans le dossier de sortie du build')
  })
})
