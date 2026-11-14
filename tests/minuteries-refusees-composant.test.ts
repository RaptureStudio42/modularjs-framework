// setTimeout et setInterval refusés dans un composant (son <script>, les gestionnaires du gabarit), écrits nus ou par
// `window.`, `globalThis.`, `self.` : une minuterie posée à la main survit au composant. Le message nomme la ligne et
// dit quoi écrire. Restent libres le code partagé (<script module>, module .civet, magasin) et les mots qui ne sont pas
// un appel de la minuterie globale (chaîne, commentaire, propriété d'un autre objet). µevery et µafter s'écrivent dans
// un gestionnaire ; dans une interpolation {…}, recalculée à chaque rendu, ils restent refusés.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const composant = (...lignes: string[]) => lignes.join('\n')
const refuse    = async (source: string, motifs: RegExp[]) => {
  let message = ''
  try {
    await transpile(source, { moduleName: 'essai' })
  }
  catch (e: any) {
    message = String(e?.message ?? e)
  }
  assert.ok(message !== '', 'la construction doit refuser :\n' + source)
  for (const motif of motifs) assert.match(message, motif)
}
const accepte = async (source: string) => {
  await transpile(source, { moduleName: 'essai' })
}

describe('setTimeout et setInterval refusés dans un composant', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it('setTimeout dans le <script> : refusé à sa ligne, avec µafter, always: true et await µafter', async function () {
    await refuse(composant('<p>{$x}</p>', '<script>', '$x = 0', 'setTimeout (-> $x = 1), 100', '</script>'), [/essai\.mjs/, /ligne 4\b/, /« setTimeout »/, /µafter 1000, ->/, /always: true/, /await µafter 300/, /µdestroy/])
  })

  it('setInterval dans le <script> : refusé, avec µevery', async function () {
    await refuse(composant('<p>{$x}</p>', '<script>', '$x = 0', 'µmount ->', '  setInterval (-> $x++), 1000', '</script>'), [/ligne 5\b/, /« setInterval »/, /µevery 1000, immediate: false, ->/])
  })

  it('écrits window.setTimeout, globalThis.setInterval, self.setTimeout, window[\'setTimeout\'] : refusés', async function () {
    for (const appel of ['window.setTimeout (-> $x = 1), 10', 'globalThis.setInterval (-> $x = 1), 10', 'self.setTimeout (-> $x = 1), 10', 'window[\'setTimeout\'] (-> $x = 1), 10']) {
      await refuse(composant('<p>{$x}</p>', '<script>', '$x = 0', 'f = ->', '  ' + appel, '</script>'), [/ligne 5\b/, /refusé dans un composant/])
    }
  })

  it('l\'attente await new Promise … setTimeout : refusée, await µafter proposé', async function () {
    await refuse(composant('<p>{$x}</p>', '<script>', '$x = 0', 'f = async ->', '  await new Promise (r) -> setTimeout r, 300', '  $x = 1', '</script>'), [/ligne 5\b/, /await µafter 300/])
  })

  it('dans un gestionnaire du gabarit : refusé, à la ligne de la balise', async function () {
    await refuse(composant('<p>{$x}</p>', '<button @click={-> setTimeout (-> $x = 1), 100}>x</button>', '<script>', '$x = 0', '</script>'), [/ligne 2\b/, /gestionnaire/, /« setTimeout »/])
  })

  it('aucun faux refus : chaîne, commentaire, propriété d\'un autre objet, clé, clearTimeout, <script module>', async function () {
    await accepte(composant(
      '<p>{$x}</p>',
      '<button @click={-> minuteur.setTimeout(-> $x = 2)}>x</button>',
      '<script module>',
      'partage = setTimeout (-> null), 10',
      '</script>',
      '<script>',
      '$x = 0',
      't = \'setTimeout(f, 1) et setInterval\'',
      '# setTimeout(f, 1)',
      'minuteur = { setTimeout: (f) -> f(), setInterval: 1 }',
      'minuteur.setTimeout -> $x = 1',
      'clearTimeout(null)',
      '</script>'
    ))
  })

  it('µevery et µafter s\'écrivent dans un gestionnaire ; dans une interpolation, refusés', async function () {
    await accepte(composant('<p>{$x}</p>', '<button @click={-> µevery 1000, -> $x++}>a</button>', '<button @click={-> µafter 1000, -> $x = 0}>b</button>', '<script>', '$x = 0', '</script>'))
    await refuse(composant('<p>{µafter 1000, -> 1}</p>', '<script>', '$x = 0', '</script>'), [/µafter|µevery/, /interpolation/])
  })

  it('libres dans un module .civet, un magasin, et dans les modules du cœur employés par l\'appli', async function () {
    const root   = mjsTmp('minuteries-libres')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    const ecrire = (chemin: string, texte: string) => {
      mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
      writeFileSync(join(srcDir, chemin), texte)
    }
    ecrire('utils/minuteur.civet.mjs', 'export pause = (ms) -> new Promise (r) -> setTimeout r, ms\nexport repete = (f) -> setInterval f, 1000\n')
    ecrire('stores/compte.mjs', 'export compteStore = new µStore(n: 0)\nsetInterval (-> compteStore.data.n++), 1000\n')
    ecrire('page.mjs', composant(
      '@import pause \'utils/minuteur.civet.mjs\'',
      '@import compteStore \'stores/compte.mjs\'',
      '<p>{$x}</p>',
      '<@@clock></@@clock>',
      '<script>',
      '$x = 0',
      'µmount ->',
      '  await pause 10',
      '  $x = compteStore.data.n',
      '</script>'
    ))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })
})

// aucune exemption par un réglage : « rawTimers » et « coreModulesDir » ne sont pas des clés de mjs.config.json (refusées comme
// inconnues), et un composant rangé dans un dossier de l'appli nommé comme le catalogue du framework reste refusé
describe('minuteries : aucune échappatoire par la configuration de l\'appli', function () {
  this.timeout(120000)

  const racine    = join(dirname(fileURLToPath(import.meta.url)), '..')
  const construit = (reglages: Record<string, unknown>) => {
    const root = mjsTmp('minuteries-config')
    mkdirSync(join(root, 'src', 'core-modules'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', ...reglages }))
    writeFileSync(join(root, 'src', 'core-modules', 'montre.mjs'), composant('<script>', '$n = 0', 'setTimeout((-> $n++), 1000)', '</script>', '<p>{$n}</p>'))
    const r = spawnSync(join(racine, 'node_modules', '.bin', 'tsx'), [join(racine, 'src', 'cli.ts'), 'build', '--root', root], { cwd: racine, encoding: 'utf-8', timeout: 100000 })
    return String(r.stdout) + String(r.stderr)
  }

  it('« rawTimers » et « coreModulesDir » dans mjs.config.json : clés inconnues, la construction s\'arrête', () => {
    for (const cle of ['rawTimers', 'coreModulesDir']) {
      const sortie = construit({ [cle]: cle === 'rawTimers' ? true : 'src' })
      assert.match(sortie, new RegExp(`clé inconnue '${cle}'`), sortie)
    }
  })

  it('composant de l\'appli rangé sous core-modules/ : sa minuterie à la main reste refusée', () => {
    const sortie = construit({})
    assert.match(sortie, /« setTimeout » est refusé/, sortie)
  })
})

// ni par une option du paquet : un script de construction maison qui passe « rawTimers » à transpile voit toujours la
// minuterie refusée
describe('minuteries : aucune échappatoire par un script de construction maison', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  const montre = composant('<script>', '$n = 0', 'setTimeout((-> $n++), 1000)', '</script>', '<p>{$n}</p>')

  it('transpile(code, { rawTimers: true }) par l\'entrée du paquet : refusé', async function () {
    const paquet: any = await import('../src/index.js')
    let message = ''
    try {
      await paquet.transpile(montre, { moduleName: 'montre', rawTimers: true })
    }
    catch (e: any) {
      message = String(e?.message ?? e)
    }
    assert.match(message, /setTimeout/, 'la minuterie à la main reste refusée')
  })

})

// les modules du cœur n'ont aucune exemption : chacun, compilé comme un composant, n'écrit aucune minuterie à la main, et sa
// copie dans les sources d'une appli (module éjecté) se construit comme tout composant de l'appli
describe('minuteries : les modules du cœur se construisent sans exemption', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  const catalogue = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core-modules')

  it('chaque module du catalogue, compilé comme un composant : aucune minuterie refusée', async () => {
    const modules = readdirSync(catalogue).filter(f => f.endsWith('.mjs'))
    assert.ok(modules.length > 10, 'le catalogue est là')
    const refuses: string[] = []
    for (const f of modules) {
      try {
        await transpile(readFileSync(join(catalogue, f), 'utf-8'), { moduleName: 'core-' + f.replace(/\.mjs$/, ''), defaultScriptLang: 'civet', templateLang: 'civet' })
      }
      catch (e: any) {
        if (/est refusé/.test(String(e?.message ?? e))) refuses.push(f + ' : ' + String(e.message).split('\n')[0])
      }
    }
    assert.deepEqual(refuses, [])
  })

  it('<@@sortable> copié dans les sources d\'une appli (module éjecté) : la construction passe', async () => {
    const root   = mjsTmp('minuteries-module-ejecte')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sortable.mjs'), readFileSync(join(catalogue, 'sortable.mjs'), 'utf-8'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), defaultScriptLang: 'civet', templateLang: 'civet' })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })
})
