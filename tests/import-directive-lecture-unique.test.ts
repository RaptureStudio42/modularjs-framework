// La directive `@import` n'a qu'une lecture, dans transpiler/directives.ts : le compilateur et ses contrôles, le suivi des
// dépendances, les modules et les entrées serveur y passent tous. Une ligne `@import …` écrite dans le texte d'un élément
// s'affiche telle quelle, quelle que soit sa forme (`$x` et `§§x` compris), et une directive lisible y est signalée par un
// avertissement ; dans un module, un commentaire ou une chaîne reste du texte. Formes refusées faute de lecture sûre :
// `default` suivi de deux noms, accolades vides, nom en `$` dans une entrée serveur

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool, extractImportMatches } from '../src/bundler/index.js'
import { compileServerFile } from '../src/cli/server-entry.js'
import { mjsTmp } from './helpers/tmp.js'

const RACINE = fileURLToPath(new URL('..', import.meta.url))

function project(name: string, files: Record<string, string>) {
  const root   = mjsTmp(name)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'utils'), { recursive: true })
  mkdirSync(outDir, { recursive: true })
  for (const [path, text] of Object.entries(files)) writeFileSync(join(srcDir, path), text)
  return new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
}

const errorsOf   = (stats: { errors: { message: string }[] }) => stats.errors.map(e => e.message).join('\n')
const warningsOf = (stats: { warnings: unknown[] }) => stats.warnings.map(w => String((w as { message?: string }).message ?? w))

// fichiers .ts d'un dossier, à toute profondeur
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : []
  })
}

// motifs `@import` du code de src/ qui ne lisent pas la directive, chacun avec sa raison ; tout autre motif hors de la
// lecture partagée (transpiler/directives.ts) et des textes des messages fait échouer le test
const AUTRES_MOTIFS: [string, string, string][] = [
  ['src/runtime/mjs_modal.ts', '|@import|', 'règle CSS @import refusée dans un style venu du contenu'],
  ['src/runtime/mjs_fx.ts', '|@import|', "règle CSS @import refusée dans une valeur d'effet"],
  ['src/server/sorties-rendu.ts', 'css.replace(/@import', 'règle CSS @import retirée du texte prérendu'],
  ['src/transpiler/index.ts', '.test(css)', 'règle CSS @import restée dans la feuille compilée'],
  ['src/transpiler/build-checks.ts', '(?:@import|µimport|mjsimport)', "repérage prudent d'une adresse importée : force la voie sûre, ne lit aucune directive"],
  ['src/reader/disguise.ts', "'@import': ", "lettre réservée du lecteur d'arbre (outils) : une ligne de script déguisée, jamais importée"],
  ['src/reader/disguise.ts', "LETTRES_RESERVEES['@import']", 'idem'],
  ['src/reader/disguise.ts', '@(import|i18n|persist|preload)', 'idem'],
  ['src/reader/code.ts', "LETTRES_RESERVEES['@import']", 'idem'],
  ['src/cli/server-entry.ts', '(@(?:import|css|', "refus des lignes de directive restées APRÈS la lecture partagée : la ligne est citée"],
  ['src/cli/server-entry.ts', "=== '@import'", 'idem'],
  ['src/cli/server-entry.ts', '@(import|css|routes', "refus de toute directive dans une entrée brute, un fichier ordinaire"],
  ['src/cli/server-entry.ts', '@(?:import|css|routes|i18n|display|lang)/gm', "ligne de directive du masque fait main seul, reprise quand l'arbre lit son arobase comme du code : refusée comme sans lui"],
  ['src/bundler/class-files.ts', "src.replace(/^[ \\t]*@import\\b", "lignes `@import` d'un fichier de classe blanchies, même longueur, avant sa lecture par l'arbre de Civet : la directive se lit ailleurs, par la lecture partagée"]
]

describe('directive @import : une seule lecture', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('src/ ne cherche `@import` que dans la lecture partagée ; les autres motifs, nommés, ne lisent aucune directive', function () {
    const trouves: string[] = []
    const vus               = new Set<string>()
    for (const fichier of sources(join(RACINE, 'src'))) {
      const chemin = relative(RACINE, fichier)
      if (chemin === join('src', 'transpiler', 'directives.ts') || chemin.startsWith(join('src', 'messages') + '/')) continue
      readFileSync(fichier, 'utf-8').split('\n').forEach((ligne, i) => {
        const code = ligne.trim()
        if (/^(?:\/\/|\/\*|\*)/.test(code) || !/@\(?(?:\?:)?import\b/.test(code)) return
        const motif = AUTRES_MOTIFS.find(([f, fragment]) => f === chemin && code.includes(fragment))
        if (motif) vus.add(motif[0] + motif[1])
        else trouves.push(`${chemin}:${i + 1} ${code.slice(0, 120)}`)
      })
    }
    assert.deepEqual(trouves, [])
    assert.deepEqual(AUTRES_MOTIFS.filter(([f, fragment]) => !vus.has(f + fragment)).map(m => m[0] + ' ' + m[1]), [], 'motif nommé introuvable : liste à tenir à jour')
  })

  it("composant — `@import $x '…'` et `@import §§x '…'` écrits dans le texte d'un élément s'affichent tels quels, sans refus", async function () {
    const bundler = project('import-texte-dollar', { 'page.mjs': "<p class=\"t\">\n@import $compteur 'absent-a.civet.mjs'\n</p>\n<p class=\"u\">\n@import §§compteur 'absent-b.civet.mjs'\n</p>\n" })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    const page = readFileSync(bundler.manifest['page'], 'utf-8')
    assert.ok(page.includes('absent-a.civet.mjs') && page.includes('absent-b.civet.mjs'), page.slice(0, 600))
    await bundler.close()
  })

  it("module — une ligne `@import` dans un commentaire `###` ou une chaîne `\"\"\"` d'un module .civet ou .coffee reste du texte", async function () {
    const civet  = "###\n@import a 'absent-1.civet.mjs'\n###\nexport texte := \"\"\"\n@import b 'absent-2.civet.mjs'\n\"\"\"\n"
    const coffee = "###\n@import c 'absent-3.civet.mjs'\n###\nexport texte2 = \"\"\"\n@import d 'absent-4.civet.mjs'\n\"\"\"\n"
    assert.deepEqual(extractImportMatches(civet, 'civet'), [])
    assert.deepEqual(extractImportMatches(coffee, 'coffee'), [])
    const bundler = project('import-module-commentaire', { 'utils/m.civet.mjs': civet, 'utils/n.coffee.mjs': coffee, 'page.mjs': "@import texte 'utils/m.civet.mjs'\n@import texte2 'utils/n.coffee.mjs'\n\n<p class=\"t\">{texte}{texte2}</p>\n" })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    await bundler.close()
  })

  it("composant — une directive lisible écrite dans le texte d'un élément s'affiche et avertit, à sa ligne du fichier ; jamais dans <pre>, <code> ni <doc-code>", async function () {
    const page    = "<div class=\"a\">\n@import { chart } 'vendor/chart.js'\n</div>\n<pre>\n@import a 'x.civet.mjs'\n</pre>\n<code>\n@import b 'x.civet.mjs'\n</code>\n<doc-code>\n<span>\n@import c 'x.civet.mjs'\n</span>\n</doc-code>\n"
    const bundler = project('import-texte-avertit', { 'page.mjs': page })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    const avertis = warningsOf(stats).filter(w => w.includes('@import'))
    assert.equal(avertis.length, 1, avertis.join('\n'))
    assert.match(avertis[0], /ligne 2 : ligne @import dans le texte d'un élément : affichée telle quelle ; pour importer, placez-la à la racine du fichier ou dans le <script>/)
    assert.ok(readFileSync(bundler.manifest['page'], 'utf-8').includes('vendor/chart.js'))
    await bundler.close()
  })

  it('formes sans lecture sûre refusées : `@import default a b`, `@import {}`, et `@import $x` dans une entrée serveur comme dans un composant', async function () {
    const bundler = project('import-formes-refusees', {
      'utils/Ab.civet.mjs': "export b := 'B'\nexport default b\n",
      'page.mjs':       "@import default a b 'utils/Ab.civet.mjs'\n\n<p class=\"t\">{a}</p>\n",
      'vide.mjs':       "@import {} 'utils/Ab.civet.mjs'\n\n<p class=\"t\">x</p>\n"
    })
    const message = errorsOf(await bundler.compile())
    assert.match(message, /@import default a b 'utils\/Ab\.civet\.mjs' : un export par défaut se nomme d'un seul nom — écrivez @import default a 'utils\/Ab\.civet\.mjs'/)
    assert.match(message, /@import \{\} 'utils\/Ab\.civet\.mjs' : accolades vides/)
    await bundler.close()
    const d = mjsTmp('import-entree-dollar')
    mkdirSync(join(d, 'node_modules'))
    writeFileSync(join(d, 'package.json'), '{"type":"module"}')
    writeFileSync(join(d, 'lib.civet.mjs'), 'export x := 1\n')
    writeFileSync(join(d, 'entree.server.mjs'), "@import $x 'lib.civet.mjs'\n\nexport default\n  run: -> 1\n")
    await assert.rejects(compileServerFile(join(d, 'entree.server.mjs'), d), /un nom importé ne porte jamais « \$ »/)
  })
})
