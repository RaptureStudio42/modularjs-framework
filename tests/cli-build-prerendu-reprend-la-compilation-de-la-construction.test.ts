// `mjs build` d'un projet qui prérend ses pages : le prérendu rend sur la compilation que la construction vient d'écrire dans le vrai
// dossier de sortie, sans recompiler le projet — une seule compilation, en développement comme en production, les pages écrites et leur
// démarrage juste (chaque fichier que l'en-tête de démarrage cite est dans le dossier de sortie, le fichier de page en production). En
// `js: 'bundle'`, le moteur de rendu compile à part, dans son dossier de travail (il relit le cœur et chaque composant fichier par
// fichier) : deux compilations, et le fichier unique du build reste le fichier unique.
// La vraie commande (`bin/mjs`, qui charge dist/cli.js) dans un sous-processus ; un module chargé avant elle (`--import`) note chaque
// appel de `Bundler.prototype.compile`

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { assertDistFrais } from './helpers/dist-frais.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MJS      = join(repoRoot, 'bin', 'mjs')

const SOURCES: Record<string, string> = {
  'accueil.mjs': '<script>\n$titre = \'Accueil\'\n</script>\n<h1 class="t">{$titre}</h1>\n<mjs-carte></mjs-carte>\n',
  'apropos.mjs': '<script>\n$n = 2\n</script>\n<p class="a">à propos {$n}</p>\n<mjs-carte></mjs-carte>\n',
  'carte.mjs':   '<div class="c">\n  <p>carte</p>\n</div>\n',
}

// deux routes prérendues par happy-dom ; `startup: 'bundle'` (refusé avec `js: 'bundle'`) : en production, le fichier de page de la route
function projet(prefix: string, js: 'split' | 'bundle'): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  for (const [name, code] of Object.entries(SOURCES)) writeFileSync(join(root, 'app', 'modularjs', name), code)
  const apropos = js === 'split' ? { component: 'mjs-apropos', startup: 'bundle' } : { component: 'mjs-apropos' }
  const config  = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs', js, render: { engine: { prerender: 'happy-dom' }, routes: { '/': { component: 'mjs-accueil' }, '/apropos': apropos } } }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return root
}

// module chargé avant la commande : chaque appel de `Bundler.prototype.compile` dans le processus de la commande ajoute une ligne à `file`
// (le Bundler de dist/index.js est celui de dist/cli.js, même morceau ; les fils de travail ne compilent pas de projet)
function counter(file: string): string {
  const source = [
    'import { appendFileSync } from \'node:fs\'',
    'import { isMainThread } from \'node:worker_threads\'',
    'if (isMainThread) {',
    `  const { Bundler } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'dist', 'index.js')).href)})`,
    '  const compile = Bundler.prototype.compile',
    `  Bundler.prototype.compile = function (...args) { appendFileSync(${JSON.stringify(file)}, 'compile\\n'); return compile.apply(this, args) }`,
    '}',
  ].join('\n')
  return 'data:text/javascript,' + encodeURIComponent(source)
}

function build(root: string, args: string[]): { status: number; out: string; compiles: number } {
  const file = join(root, 'compilations.txt')
  const run  = spawnSync(process.execPath, ['--import', counter(file), MJS, 'build', '--root', root, ...args], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  const out  = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  return { status: run.status ?? -1, out, compiles: existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean).length : 0 }
}

// les fichiers que l'en-tête de démarrage d'une page cite, chacun présent dans le dossier de sortie
function startupFiles(root: string, page: string): string[] {
  const html   = readFileSync(join(root, 'public', 'mjs_pages', page), 'utf-8')
  const header = /<!-- mjs:demarrage -->([\s\S]*?)<!-- \/mjs:demarrage -->/.exec(html)
  assert.ok(header, `en-tête de démarrage attendu dans ${page} :\n${html.slice(0, 400)}`)
  const files = [...header[1].matchAll(/href="\/modularjs\/([^"]+)"/g)].map(m => m[1])
  assert.ok(files.length > 0, `${page} précharge au moins un fichier :\n${header[1]}`)
  for (const f of files) assert.ok(existsSync(join(root, 'public', 'modularjs', f)), `${page} précharge ${f}, absent du dossier de sortie`)
  return files
}

function assertPages(root: string): void {
  const accueil = readFileSync(join(root, 'public', 'mjs_pages', 'index.html'), 'utf-8')
  const apropos = readFileSync(join(root, 'public', 'mjs_pages', 'apropos.html'), 'utf-8')
  assert.match(accueil, /<mjs-accueil mjs-ssr>/, 'la racine prérendue, marquée pour la reprise')
  assert.match(accueil, /Accueil/, '{$titre} résolu au serveur')
  assert.match(accueil, /carte/, 'le composant enfant rendu')
  assert.match(apropos, /<mjs-apropos mjs-ssr>/, 'la seconde page prérendue')
  assert.match(apropos, /à propos 2/, '{$n} résolu au serveur')
}

describe('mjs build — le prérendu reprend la compilation de la construction', function () {
  this.timeout(180_000)

  before(() => {
    assert.ok(existsSync(join(repoRoot, 'dist', 'cli.js')), 'bin/mjs charge dist/cli.js : lancez `npm run build:self` avant ce test')
    assertDistFrais(repoRoot)
  })

  for (const prod of [false, true]) {
    it(`${prod ? 'production' : 'développement'} : une seule compilation, les pages écrites, leur démarrage juste`, () => {
      const root = projet(prod ? 'reprise-prerendu-prod' : 'reprise-prerendu-dev', 'split')
      const run  = build(root, prod ? ['--prod'] : [])
      assert.equal(run.status, 0, run.out)
      assert.equal(run.compiles, 1, `le prérendu rend sur la compilation de la construction, sans recompiler le projet :\n${run.out}`)
      assertPages(root)
      const home = startupFiles(root, 'index.html')
      assert.ok(home.some(f => /^accueil-[0-9a-z]{5}\.js$/.test(f)), `la page d'accueil précharge son composant : ${home.join(', ')}`)
      const about = startupFiles(root, 'apropos.html')
      if (prod) {
        assert.deepEqual(about.map(f => f.replace(/-[0-9a-z]{5}\.js$/, '-<empreinte>.js')), ['mjs_page-apropos-<empreinte>.js'], 'en production, le fichier de page de la route')
        assert.match(run.out, /✓ apropos → mjs_page-apropos-[0-9a-z]{5}\.js \(2 composants assemblés\)/, run.out)
      }
    })
  }

  it('`js: \'bundle\'` : le moteur de rendu compile à part, le fichier unique reste celui de la construction', () => {
    const root = projet('reprise-prerendu-bundle', 'bundle')
    const run  = build(root, [])
    assert.equal(run.status, 0, run.out)
    assert.equal(run.compiles, 2, `la construction, puis le moteur de rendu dans son dossier de travail :\n${run.out}`)
    assertPages(root)
    const js = readdirSync(join(root, 'public', 'modularjs')).filter(f => f.endsWith('.js'))
    assert.deepEqual(js, ['bundle.js'], `le fichier unique, aucune unité semée à côté : ${js.join(', ')}`)
    assert.doesNotMatch(readFileSync(join(root, 'public', 'modularjs', 'bundle.js'), 'utf-8'), /mjs_core-[0-9a-z]{5}\.js/, 'bundle.js reste le fichier unique, jamais un manifeste éclaté')
  })
})
