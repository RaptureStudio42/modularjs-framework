// Importer un fichier .coffee ou .js comme un module .civet, depuis un composant et depuis un module : `@import 'chemin'`
// (pour son seul effet), `@import { a b } 'chemin'` (noms entre accolades) et `@import a b 'chemin'`. Le .coffee est
// compilé au passage, le .js copié tel quel ; l'édition du fichier importé recompile l'importeur en développement ; une
// faute est citée à la ligne du fichier importé ; un fichier importé pour son effet ne s'exécute qu'une fois. Une seule
// lecture des directives, partagée par le compilateur, le suivi des dépendances et les entrées serveur ; le rendu serveur
// charge le .js importé ; CoffeeScript reste pris en charge, sans avertissement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Bundler, terminateSharedWorkerPool, extractImportMatches } from '../src/bundler/index.js'
import { extractDirectives } from '../src/transpiler/directives.js'
import { compileServerFile } from '../src/cli/server-entry.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const NUMBER_COFFEE = [
  'globalThis.numberLoads = (globalThis.numberLoads ? 0) + 1',
  'Number::toRoman = -> toRoman(this.valueOf())',
  '',
  'export toRoman = (n) ->',
  "  out = ''",
  "  for [v, s] in [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]",
  '    while n >= v',
  '      out += s',
  '      n -= v',
  '  out',
  ''
].join('\n')

// sources : utils/Number.coffee, vendor/chart.js et les fichiers du cas ; sortie en module ES (package.json), servie
// depuis son propre dossier pour que le module compilé s'importe tel quel dans Node
function project(name: string, files: Record<string, string>) {
  const root   = mjsTmp(name)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'utils'), { recursive: true })
  mkdirSync(join(srcDir, 'vendor'), { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'package.json'), '{"type":"module"}')
  writeFileSync(join(srcDir, 'utils', 'Number.coffee.mjs'), NUMBER_COFFEE)
  writeFileSync(join(srcDir, 'vendor', 'chart.js'), "export function chart(x) { return 'chart:' + x }\n")
  for (const [path, text] of Object.entries(files)) writeFileSync(join(srcDir, path), text)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: outDir })
  return { srcDir, outDir, bundler }
}

const errorsOf = (stats: { errors: { message: string }[] }) => stats.errors.map(e => e.message).join('\n')
const hashedName = (outDir: string, stem: string) => readdirSync(outDir).find(n => n.startsWith(stem + '-') && n.endsWith('.js')) ?? ''

describe('import d\'un fichier .coffee ou .js comme un module .civet', function () {
  this.timeout(60000)

  after(async () => {
    delete (Number.prototype as any).toRoman
    delete (globalThis as any).numberLoads
    await terminateSharedWorkerPool()
  })

  it("composant — `@import 'utils/Number.coffee.mjs'` charge le fichier pour son effet, la directive ne fuit pas dans le gabarit", async function () {
    const { srcDir, outDir, bundler } = project('import-effet-composant', { 'page.mjs': "@import 'utils/Number.coffee.mjs'\n\n<p class=\"r\">{(14).toRoman()}</p>\n" })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    const page   = readFileSync(bundler.manifest['page'], 'utf-8')
    const number = hashedName(outDir, 'Number')
    assert.ok(number !== '' && page.includes(number), `le composant importe ${number || 'Number-*.js'} :\n${page.slice(0, 400)}`)
    assert.ok(!page.includes('Number.coffee.mjs'), `la directive ne reste pas dans le gabarit :\n${page.slice(0, 400)}`)
    await bundler.close()
    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-page' })
    assert.match(res.html, />XIV</)
  })

  it("composant — `@import { toRoman } 'utils/Number.coffee.mjs'` et `@import { chart } 'vendor/chart.js'` : les noms entre accolades valent les noms nus", async function () {
    const { srcDir, outDir, bundler } = project('import-accolades-composant', { 'page.mjs': "@import { toRoman } 'utils/Number.coffee.mjs'\n@import { chart } 'vendor/chart.js'\n\n<p class=\"r\">{toRoman(14)} {chart(3)}</p>\n" })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    const page = readFileSync(bundler.manifest['page'], 'utf-8')
    for (const [name, stem] of [['toRoman', 'Number'], ['chart', 'chart']]) {
      const file = hashedName(outDir, stem)
      assert.ok(file !== '' && new RegExp(`import\\s*\\{\\s*${name}\\b[^}]*\\}\\s*from\\s*"[^"]*${file}"`).test(page), `${name} importé de ${file || stem + '-*.js'} :\n${page.slice(0, 400)}`)
    }
    assert.ok(!page.includes('Number.coffee.mjs') && !page.includes('chart.js'), `aucune directive dans le gabarit :\n${page.slice(0, 400)}`)
    await bundler.close()
    // rendu serveur : le .js copié tel quel se charge comme le .coffee compilé
    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-page' })
    assert.match(res.html, />XIV chart:3</)
  })

  it('module — un .civet importe un .coffee (effet seul et noms), un .js entre accolades et un .coffee qui en importe un autre : exécution réelle, le fichier d\'effet ne s\'exécute qu\'une fois', async function () {
    const { bundler } = project('import-module', {
      'utils/Other.coffee.mjs': "@import toRoman 'utils/Number.coffee.mjs'\n\nexport shout = (n) -> toRoman(n) + '!'\n",
      'app.civet.mjs':          "@import 'utils/Number.coffee.mjs'\n@import { toRoman } 'utils/Number.coffee.mjs'\n@import { chart } 'vendor/chart.js'\n@import shout 'utils/Other.coffee.mjs'\n\nexport run = -> [(14).toRoman(), toRoman(4), chart(3), shout(9)].join(' ')\n"
    })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    ;(globalThis as any).numberLoads = 0
    const mod: any = await import(pathToFileURL(bundler.manifest['app']).href)
    assert.equal(mod.run(), 'XIV IV chart:3 IX!')
    assert.equal((globalThis as any).numberLoads, 1, 'Number.coffee.mjs importé trois fois, exécuté une fois')
    await bundler.close()
  })

  it("développement — éditer le .coffee importé pour son effet ou le .js importé entre accolades recompile le composant, qui cite la nouvelle empreinte", async function () {
    const { srcDir, outDir, bundler } = project('import-suivi', { 'page.mjs': "@import 'utils/Number.coffee.mjs'\n@import { chart } 'vendor/chart.js'\n\n<p>{(14).toRoman()} {chart(1)}</p>\n" })
    const stats1 = await bundler.compile()
    assert.equal(stats1.errors.length, 0, errorsOf(stats1))
    const [number1, chart1] = [hashedName(outDir, 'Number'), hashedName(outDir, 'chart')]
    writeFileSync(join(srcDir, 'utils', 'Number.coffee.mjs'), NUMBER_COFFEE + 'export version = 2\n')
    writeFileSync(join(srcDir, 'vendor', 'chart.js'), "export function chart(x) { return 'graphique:' + x }\n")
    const stats2 = await bundler.compile()
    assert.equal(stats2.errors.length, 0, errorsOf(stats2))
    const page    = readFileSync(bundler.manifest['page'], 'utf-8')
    const imports = page.match(/(?:Number|chart)-[0-9a-z]+\.js/g) ?? []
    assert.ok(imports.length === 2 && !imports.includes(number1) && !imports.includes(chart1), `nouvelles empreintes attendues (avant : ${number1}, ${chart1}) ; citées : ${imports.join(', ')}`)
    for (const name of imports) assert.ok(readdirSync(outDir).includes(basename(name)), `${name} existe dans la sortie`)
    await bundler.close()
  })

  it("une faute du .coffee ou du .js importé est citée à sa ligne du fichier importé", async function () {
    const coffee = project('import-faute-coffee', { 'utils/Bad.coffee.mjs': "a = 1\nb = 2\nc = 'trois\n", 'page.mjs': "@import { c } 'utils/Bad.coffee.mjs'\n\n<p>{c}</p>\n" })
    const stats1 = await coffee.bundler.compile()
    assert.match(errorsOf(stats1), /Bad\.coffee\.mjs:3:/)
    await coffee.bundler.close()
    const js = project('import-faute-js', { 'vendor/bad.js': 'export const a = 1\nexport const = 2\n', 'page.mjs': "@import { a } 'vendor/bad.js'\n\n<p>{a}</p>\n" })
    const stats2 = await js.bundler.compile()
    const message = errorsOf(stats2)
    assert.ok(message.includes('bad.js') && /\b2\b/.test(message), message)
    await js.bundler.close()
  })

  it('une virgule entre deux noms reste refusée entre accolades, comme sans accolades', async function () {
    const { bundler } = project('import-accolades-virgule', { 'page.mjs': "@import { toRoman, chart } 'utils/Number.coffee.mjs'\n\n<p>{toRoman(1)}</p>\n" })
    const stats = await bundler.compile()
    assert.match(errorsOf(stats), /@import \{ toRoman, chart \} 'utils\/Number\.coffee\.mjs' : virgule interdite.*\(@import \{ nomA nomB \} 'utils\/Number\.coffee\.mjs'\)/)
    await bundler.close()
  })

  it("une seule lecture pour le compilateur et le suivi des dépendances : le texte d'un élément du gabarit, un <style>, un commentaire ou une chaîne de <script> n'en contiennent aucune, ancienne forme comprise", function () {
    const formes = ["@import 'theme.css'", '@import "theme.css"', "@import { a } 'utils/x.civet.mjs'", "@import nom 'utils/x.civet.mjs'", "@import default Nom 'utils/x.civet.mjs'"]
    const lues: string[] = []
    for (const forme of formes) {
      const page        = `@import toRoman 'utils/Number.coffee.mjs'\n\n<doc-code>\n${forme}\n</doc-code>\n<div class="a">\n  <p>\n    ${forme}\n  </p>\n</div>\n<!--\n${forme}\n-->\n<style>\n${forme}\n</style>\n<script>\nexemple = """\n${forme}\n"""\n</script>\n<p>{toRoman(4)}</p>\n`
      const compilateur = extractDirectives(page).pendingAutoImports
      const suivi       = extractImportMatches(page).map(m => m[1])
      if (compilateur.length !== 1 || suivi.join() !== 'utils/Number.coffee.mjs') lues.push(`${forme} — compilateur : ${compilateur.join(' ; ')} — suivi : ${suivi.join(' ; ')}`)
    }
    assert.deepEqual(lues, [])
  })

  it("composant — une ligne `@import` dans le texte d'un élément s'affiche telle quelle, sa cible n'est pas cherchée", async function () {
    const { bundler } = project('import-texte-gabarit', { 'page.mjs': "<doc-code>\n@import 'theme.css'\n</doc-code>\n<p>\n@import nom \"absent.civet.mjs\"\n</p>\n" })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, errorsOf(stats))
    const page = readFileSync(bundler.manifest['page'], 'utf-8')
    assert.ok(page.includes('theme.css') && page.includes('absent.civet.mjs'), page.slice(0, 600))
    await bundler.close()
  })

  it('une directive écrite sur plusieurs lignes est refusée, dans un composant comme dans un module, par un message qui donne la ligne à écrire', async function () {
    const { bundler } = project('import-plusieurs-lignes', {
      'utils/Ab.coffee.mjs': "export a = 'A'\nexport b = 'B'\n",
      'page.mjs':        "@import {\n  a\n  b\n} 'utils/Ab.coffee.mjs'\n\n<p>{a}{b}</p>\n",
      'mod.civet.mjs':       "@import\n  'utils/Number.coffee.mjs'\n\nexport f = -> 1\n"
    })
    const message = errorsOf(await bundler.compile())
    assert.match(message, /une seule ligne — écrivez @import \{ a b \} 'utils\/Ab\.coffee\.mjs'/)
    assert.match(message, /une seule ligne — écrivez @import 'utils\/Number\.coffee\.mjs'/)
    assert.ok(!message.includes('introuvable'), message)
    await bundler.close()
  })

  it("`@import default { a } 'chemin'` est refusé : un export par défaut se nomme sans accolades", async function () {
    const { bundler } = project('import-default-accolades', { 'utils/Ab.coffee.mjs': "export a = 'A'\n", 'page.mjs': "@import default { a } 'utils/Ab.coffee.mjs'\n\n<p>{a}</p>\n" })
    assert.match(errorsOf(await bundler.compile()), /se nomme sans accolades — écrivez @import default a 'utils\/Ab\.coffee\.mjs'/)
    await bundler.close()
  })

  it('entrée serveur — mêmes formes que dans un composant ; un module .civet qui les emploie et un .coffee importé se chargent, le .coffee compilé', async function () {
    const d = mjsTmp('import-entree-serveur')
    mkdirSync(join(d, 'node_modules'))
    mkdirSync(join(d, 'utils'))
    writeFileSync(join(d, 'package.json'), '{"type":"module"}')
    writeFileSync(join(d, 'utils', 'Number.coffee.mjs'), NUMBER_COFFEE)
    writeFileSync(join(d, 'utils', 'chart.js'), "export function chart(x) { return 'chart:' + x }\n")
    writeFileSync(join(d, 'utils', 'neuf.civet.mjs'), "@import { toRoman } 'utils/Number.coffee.mjs'\n\nexport quatre := -> toRoman(4)\n")
    writeFileSync(join(d, 'entree.server.mjs'), "@import 'utils/Number.coffee.mjs'\n@import { chart } 'utils/chart.js'\n@import quatre 'utils/neuf.civet.mjs'\n@import toRoman 'utils/Number.coffee.mjs'\n\nexport default\n  run: -> [(14).toRoman(), chart(3), quatre(), toRoman(9)].join(' ')\n")
    ;(globalThis as any).numberLoads = 0
    const mod = await import(await compileServerFile(join(d, 'entree.server.mjs'), d))
    assert.equal(mod.default.run(), 'XIV chart:3 IV IX')
    assert.equal((globalThis as any).numberLoads, 1, "Number.coffee.mjs importé deux fois par l'entrée et une fois par neuf.civet.mjs, exécuté une fois")
    writeFileSync(join(d, 'faux.server.mjs'), '@import chart\n\nexport default {}\n')
    await assert.rejects(compileServerFile(join(d, 'faux.server.mjs'), d), (e: Error) => e.message.includes('« @import chart »') && !e.message.includes('seule @import est admise'))
  })

  it("CoffeeScript reste pris en charge : ni un fichier .coffee importé ni le script d'un composant écrit en Coffee n'avertissent", async function () {
    const warned: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warned.push(String(args[0])) }
    try {
      const { bundler } = project('import-coffee-sans-avertissement', { 'utils/Muet.coffee.mjs': 'export muet = -> 1\n', 'page.mjs': "@import muet 'utils/Muet.coffee.mjs'\n\n<script lang=\"coffee\">\n$n = 1\n</script>\n<p>{muet()} {$n}</p>\n" })
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, errorsOf(stats))
      await bundler.close()
    }
    finally {
      console.warn = origWarn
    }
    assert.ok(!warned.some(w => w.includes('CoffeeScript')), `aucun avertissement attendu : ${JSON.stringify(warned)}`)
  })
})
