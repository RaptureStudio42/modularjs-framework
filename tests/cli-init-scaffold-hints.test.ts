// Test de régression : `cli/init.ts:103-108`
// affichait des hints de fin de scaffold ERRONÉS :
//   1. `./bin/mjs dev` — n'existe QUE dans le dépôt source de ModularJS ;
//      un projet consommateur invoque le CLI via `npx --no -- mjs` (bin exposé
//      par package.json), jamais un chemin relatif littéral inexistant dans le
//      projet scaffoldé.
//   2. `<script src="/assets/javascripts/bundle_modular.js">` — convention
//      Rails/Sprockets d'une version antérieure, SANS RAPPORT avec le
//      `mjs.config.json` fraîchement scaffoldé juste au-dessus
//      (`outputDir: "public/modularjs"` → servi à `/modularjs/bundle.js`) —
//      un dev qui copie-colle cette ligne obtient un 404 immédiat.
//
// Fix : hints corrigés (`npx --no -- mjs dev`, `/modularjs/bundle.js`).
//
// La commande s'écrit `npx --no -- mjs dev`, dans ce que `mjs init` affiche, dans les fichiers qu'elle écrit et dans le README
// du paquet : `--no` interdit à npx d'installer quoi que ce soit (hors d'un projet où le paquet est installé, `npx mjs dev`
// irait chercher sur npm un paquet nommé « mjs » qui n'est pas ModularJS), `--` laisse à `mjs` les options écrites après lui.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { runInit } from '../src/cli/init.js'
import { Bundler } from '../src/bundler/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// `npx mjs …`, `npx --yes mjs …`, `npx --no mjs …` : tout sauf `npx --no -- mjs …`
const SANS_GARDE = /npx (?!--no -- mjs\b)(?:-\S+ )*mjs\b/

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]))
}

function captureLogs(fn: () => void): string[] {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: any[]) => { lines.push(args.join(' ')) }
  try { fn() } finally { console.log = original }
  return lines
}

describe('cli/init.ts — hints de fin de scaffold cohérents avec le projet généré', function () {
  it("le hint de démarrage utilise 'npx --no -- mjs', pas un chemin ./bin/mjs inexistant dans le projet scaffoldé", function () {
    const root = mjsTmp('init-hints')
    const lines = captureLogs(() => runInit(root))
    const joined = lines.join('\n')

    assert.doesNotMatch(joined, /\.\/bin\/mjs/,
      "AVANT le fix : `./bin/mjs dev` était affiché — ce chemin n'existe QUE dans le dépôt ModularJS lui-même, jamais dans un projet qui installe le package")
    assert.match(joined, /npx --no -- mjs dev/, "le hint doit utiliser l'invocation documentée (README) 'npx --no -- mjs dev'")
    assert.doesNotMatch(joined, SANS_GARDE, 'aucune commande que npx pourrait aller installer, ou dont il prendrait une option')
  })

  it('les fichiers écrits par mjs init et le README du paquet donnent `npx --no -- mjs`, jamais `npx mjs`', function () {
    const root = mjsTmp('init-hints-fichiers')
    captureLogs(() => runInit(root))
    const ecrits = filesUnder(root).map((f) => readFileSync(f, 'utf-8'))
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf-8')
    assert.ok(ecrits.some((texte) => texte.includes('npx --no -- mjs dev')), 'l\'exemple écrit par mjs init dit comment le lancer')
    for (const texte of [...ecrits, readme]) assert.doesNotMatch(texte, SANS_GARDE)
    assert.match(readme, /npx --no -- mjs build[^\n]*\nnpx --no -- mjs dev/)
  })

  it('le hint du <script> pointe vers le VRAI chemin servi, dérivé du mjs.config.json scaffoldé (pas une convention Rails obsolète)', function () {
    const root = mjsTmp('init-hints-url')
    const lines = captureLogs(() => runInit(root))
    const joined = lines.join('\n')

    assert.doesNotMatch(joined, /assets\/javascripts\/bundle_modular\.js/,
      "AVANT le fix : `/assets/javascripts/bundle_modular.js` (convention Rails/Sprockets d'une version antérieure) était affiché, sans rapport avec le scaffold actuel — 404 garanti")

    // Dérive le chemin RÉELLEMENT servi à partir du mjs.config.json que
    // runInit vient d'écrire — pas une valeur recopiée à la main, pour que
    // ce test reste vrai même si le scaffold par défaut change plus tard.
    const config = JSON.parse(readFileSync(join(root, 'mjs.config.json'), 'utf-8'))
    const bundler = new Bundler({ outputDir: join(root, config.outputDir), manifestPath: join(root, config.manifestPath) })
    const expectedUrl = `${bundler.urlPrefix}/bundle.js`

    assert.ok(joined.includes(expectedUrl),
      `le hint doit citer le chemin réel dérivé du scaffold (${expectedUrl}). sortie:\n${joined}`)
  })
})

describe('cli/init.ts — les étapes affichées : l\'installation d\'abord, puis la commande sûre', function () {
  it('« npm install modularjs-framework » précède « npx --no -- mjs dev » : en les suivant, personne ne tombe sur le refus de npx', function () {
    const lignes  = captureLogs(() => runInit(mjsTmp('init-etapes')))
    const debut   = lignes.findIndex((l) => l.startsWith('Pour démarrer'))
    const install = lignes.findIndex((l) => l.trim() === 'npm install modularjs-framework')
    const dev     = lignes.findIndex((l) => l.trim() === 'npx --no -- mjs dev')
    assert.ok(debut >= 0, 'les étapes sont annoncées')
    assert.ok(install > debut, 'l\'installation est la première étape')
    assert.ok(dev > install, 'la commande sûre vient après l\'installation')
  })

  it('docs/32 montre ces étapes telles quelles, et dit ce que veut dire le refus de npx et quoi faire', function () {
    const lignes = captureLogs(() => runInit(mjsTmp('init-etapes')))
    const debut  = lignes.findIndex((l) => l.startsWith('Pour démarrer'))
    const etapes = lignes.slice(debut, lignes.indexOf('', debut)).join('\n')
    const doc    = readFileSync(join(repoRoot, 'docs', '32-cli-et-configuration.md'), 'utf8')
    assert.ok(doc.includes(etapes), 'docs/32 ne montre pas les étapes affichées :\n' + etapes)
    assert.match(doc, /npx canceled due to missing packages/)
    assert.match(doc, /npm install modularjs-framework/)
  })
})
