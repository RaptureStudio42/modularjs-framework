// Relevé des briques du cœur (src/bundler/features.ts) et contrat du cœur (src/bundler/core-contract.ts) pour
// les quatre fonctions publiques que le cœur n'embarque que sur usage : `µ.Store`, `µ.every`, `µ.interpolate`,
// `µ.Ticker`.
//
// Le défaut : le relevé blanchissait les chaînes avec une expression régulière qui prenait l'apostrophe d'un
// littéral regex (`s.replace(/'/g, '')`, très courant) pour l'ouverture d'une chaîne, refermée à la prochaine
// apostrophe du fichier, retours à la ligne traversés : tout le code entre les deux disparaissait du relevé.
// Le cœur partait sans `µ.Store`, le build restait vert, et la page cassait au navigateur
// (« µ.Store is not a constructor »). Le contrat du cœur, lui, ne surveillait que les noms internes `_mjs_*` :
// aucun filet pour ces quatre fonctions.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { collectCoreCalls, missingCoreSymbols } from '../src/bundler/core-contract.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const BRIQUES = ['store', 'every', 'interpolate', 'ticker']

async function releve(src: string, moduleName: string): Promise<string[]> {
  const { output, data } = await transpile(src, { moduleName })
  const used = scanCompiledFeatures(output, data)
  return BRIQUES.filter(k => used.has(k))
}

// les quatre fonctions, écrites APRÈS une expression régulière qui contient le délimiteur d'une chaîne
function composant(regex: string): string {
  return [
    '<script>',
    `net = (s) -> s.replace(${regex}, '')`,
    'st = new µ.Store({ n: 1 })',
    'µ.every 1000, -> 1',
    't = new µ.Ticker()',
    '$p = µinterpolate(0, 400)',
    "label = 'ok'",
    '</script>',
    '<p>{$p}</p>',
  ].join('\n')
}

async function construire(cfgExtra: Record<string, unknown>, fichiers: Record<string, string>, preparer?: (bundler: Bundler) => void): Promise<{ outDir: string; errors: Error[] }> {
  const root   = mjsTmp('briques-regex')
  const srcDir = join(root, 'app/modularjs')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), contenu)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'bundle.js', ...cfgExtra }))
  const found = findConfig(root)
  assert.ok(found, 'mjs.config.json doit être trouvé')
  const bundler = new Bundler(resolveBundlerOpts(found!.config, found!.configDir) as never)
  preparer?.(bundler)
  const stats = await bundler.compile()
  return { outDir: join(root, 'out'), errors: stats.errors }
}

function coeur(outDir: string): string {
  const f = readdirSync(outDir).find((n) => /^mjs_core-/.test(n))
  assert.ok(f, 'mjs_core-*.js doit exister')
  return readFileSync(join(outDir, f!), 'utf-8')
}

describe('relevé des briques du cœur — une expression régulière à apostrophe ne cache plus le code qui la suit', function () {
  this.timeout(60000)
  after(() => { terminateSharedWorkerPool() })

  it('témoin : sans expression régulière, les quatre fonctions sont relevées', async () => {
    assert.deepEqual(await releve(composant("'x'"), 'brique0'), BRIQUES)
  })

  it('après `/\'/g` : les quatre fonctions sont relevées', async () => {
    assert.deepEqual(await releve(composant("/'/g"), 'brique1'), BRIQUES)
  })

  it('après `/"/g` et une classe `/[\'"]/g` : les quatre fonctions sont relevées', async () => {
    assert.deepEqual(await releve(composant('/"/g'), 'brique2'), BRIQUES)
    assert.deepEqual(await releve(composant('/[\'"]/g'), 'brique3'), BRIQUES)
  })

  it('une mention en chaîne, en gabarit ou en commentaire ne compte toujours pas ; un usage dans `${…}` compte', () => {
    const prose = [
      "const doc = 'µ.Store et µ.every(1000)'",
      'const aide = "µ.Ticker, µ.interpolate"',
      'const gabarit = `le µ.Store ${doc} et µ.every(5)`',
      '// µ.Store dans un commentaire',
      '/* µ.Ticker dans un bloc */',
    ].join('\n')
    const used = scanCompiledFeatures(prose)
    assert.deepEqual(BRIQUES.filter(k => used.has(k)), [], 'la prose ne doit rien embarquer')
    const dansGabarit = scanCompiledFeatures('const s = `état : ${new µ.Store({ n: 1 }).n}`')
    assert.ok(dansGabarit.has('store'), 'un µ.Store écrit dans une expression `${…}` est un vrai usage')
  })

  // le masque s'applique que le texte se lise comme un programme ou seulement en jetons (sortie de transpile()
  // lue hors du bundler, repère d'import compris) : une mention en chaîne reste muette dans les deux cas
  it('programme valide ou jetons seuls : l\'usage après la regex compte, la mention en chaîne non', () => {
    const corps = "const net = (s) => s.replace(/'/g, '')\nconst st = new µ.Store({ n: 1 })\nconst doc = 'µ.Ticker'\n"
    for (const texte of [corps, "import { µ } from µ.asset('mjs_core.js');\n" + corps]) {
      const used = scanCompiledFeatures(texte)
      assert.deepEqual(BRIQUES.filter(k => used.has(k)), ['store'], texte.split('\n')[0])
      assert.deepEqual([...collectCoreCalls(texte)].filter(n => n.startsWith('µ.')), ['µ.Store'], texte.split('\n')[0])
    }
  })

  it('un vrai build embarque µ.Store au cœur malgré l\'expression régulière', async () => {
    const { outDir, errors } = await construire({}, { 'compteur.mjs': composant("/'/g") })
    assert.deepEqual(errors.map(e => e.message), [], 'un build sain ne doit rien signaler')
    const texte = coeur(outDir)
    assert.ok(texte.includes('µ.Store = class Store'), 'µ.Store doit être défini dans le cœur')
    assert.ok(/µ\.every\s*=\s*function/.test(texte), 'µ.every doit être défini dans le cœur')
    assert.ok(/µ\.interpolate\s*=\s*function/.test(texte), 'µ.interpolate doit être défini dans le cœur')
    assert.ok(/µ\.Ticker\s*=\s*\{/.test(texte), 'µ.Ticker doit être défini dans le cœur')
  })
})

describe('contrat du cœur — les quatre fonctions publiques', function () {
  this.timeout(60000)
  after(() => { terminateSharedWorkerPool() })

  it('une unité réclame les fonctions qu\'elle écrit dans son code, jamais celles qu\'elle cite', () => {
    const appels = collectCoreCalls([
      "const net = (s) => s.replace(/'/g, '')",
      'const st = new µ.Store({ n: 1 })',
      'µ.every(1000, () => 1)',
      'µ.Ticker.add(tache)',
      'const p = µ.interpolate(0, 400)',
    ].join('\n'))
    assert.deepEqual([...appels].sort(), ['µ.Store', 'µ.Ticker', 'µ.every', 'µ.interpolate'])
    const prose = collectCoreCalls([
      "const doc = 'µ.Store et µ.every(1000)'",
      'const gabarit = `le µ.Ticker ${doc} et µ.interpolate(1)`',
      '// µ.Store dans un commentaire',
    ].join('\n'))
    assert.deepEqual([...prose], [], 'une mention en prose ne réclame rien au cœur')
  })

  it('µ.every n\'est réclamé que sur un appel, comme le relevé', () => {
    assert.deepEqual([...collectCoreCalls('if (typeof µ.every === "function") x = 1')], [])
    assert.deepEqual([...collectCoreCalls('µ.every (1000, f)')], ['µ.every'])
  })

  it('le cœur doit DÉFINIR la fonction : une simple mention ne suffit pas', () => {
    // mjs_spring.ts et mjs_smooth.ts appellent `µ.Ticker.add(…)` sans le définir
    assert.deepEqual(missingCoreSymbols('µ.Ticker.add(this)', ['µ.Ticker']), ['µ.Ticker'])
    assert.deepEqual(missingCoreSymbols('// µ.Store = class Store\nvar x = 1', ['µ.Store']), ['µ.Store'])
    assert.deepEqual(missingCoreSymbols('if (µ.every == null) x()', ['µ.every']), ['µ.every'])
    assert.deepEqual(missingCoreSymbols('µ.Ticker = {\n  add: function(t) {}\n}', ['µ.Ticker']), [])
    assert.deepEqual(missingCoreSymbols('µ.Store = class Store {}\nµ.every = function() {}', ['µ.Store', 'µ.every', '_mjs_x']), ['_mjs_x'])
  })

  // le relevé voit toutes les écritures connues des quatre fonctions, et le réglage `runtime` ne retire pas une brique
  // qu'un composant utilise : aucun projet ne fait plus partir, à lui seul, un cœur qui en manque. Le manque est donc
  // fabriqué là où le constructeur confronte le cœur assemblé aux appels des composants, juste avant de l'écrire
  // (missingCoreSymbolsMemo, méthode de l'instance remplacée le temps du test) : l'affectation `µ.every = …` y est
  // retirée du texte, le code livré n'est pas touché. Tout le reste est réel : composant compilé, appels relevés,
  // contrôle, message, cœur jamais écrit
  it('un vrai build dont le cœur manque d\'une fonction écrite par un composant REFUSE de finir', async () => {
    const DEFINITION = /(?<![\w$.])µ\.every(?=\s*=(?!=))/g
    let retraits     = 0
    const priver     = (bundler: Bundler): void => {
      const verifier = (bundler as unknown as { missingCoreSymbolsMemo(texte: string, appels: Iterable<string>): string[] }).missingCoreSymbolsMemo.bind(bundler)
      Object.assign(bundler, { missingCoreSymbolsMemo: (texte: string, appels: Iterable<string>): string[] => {
        retraits += (texte.match(DEFINITION) ?? []).length
        return verifier(texte.replace(DEFINITION, 'µ.sansEvery'), appels)
      } })
    }
    const { outDir, errors } = await construire({}, { 'minuteur.mjs': '<script lang="js">\nµ.every(1000, () => 1)\n</script>\n<p>x</p>\n' }, priver)
    assert.ok(retraits > 0, 'la définition de µ.every doit avoir été retirée du cœur avant le contrôle')
    assert.equal(errors.length, 1, `une seule erreur attendue : ${errors.map(e => e.message).join(' | ')}`)
    assert.match(errors[0].message, /µ\.every/, 'le message doit nommer la fonction manquante')
    assert.equal(readdirSync(outDir).some((n) => /^mjs_core-/.test(n)), false, 'aucun mjs_core-*.js ne doit être écrit')
  })
})
