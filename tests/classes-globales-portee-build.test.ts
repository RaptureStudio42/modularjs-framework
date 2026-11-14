// Classes globales `Nom.class.mjs` — la portée de la classe vaut pour tout son corps : un membre s'y lit et s'y écrit par son nom,
// sans `@` ; la sortie Node le montre (constantes, membre initialisé par un autre, méthode détachée, état écrit dedans et dehors,
// paramètre qui cache le membre, clé, propriété, chaîne et texte de gabarit laissés tels quels) ; le code produit en développement
// lit le membre sur la classe ; un `@` dans une classe arrête la construction, avec le fichier, la ligne et la bonne écriture

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { classScope } from '../src/bundler/class-files.js'
import { SOURCES, SEQUENCE, ATTENDU } from './helpers/classes-globales-portee.js'

async function construire(etiquette: string, fichiers: Record<string, string>, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp(`classes-portee-${etiquette}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), contenu)
  const b     = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const stats = await b.compile()
  await b.close()
  const classe = () => {
    const f = readdirSync(outDir).find(n => n.startsWith('App.class-') && n.endsWith('.js'))
    return f ? readFileSync(join(outDir, f), 'utf-8') : '(aucune sortie App.class-…)'
  }
  return { outDir, erreurs: stats.errors.map((e: any) => e.message).join('\n'), classe }
}

// une classe seule, construite, puis lue sous Node par les expressions données (`App` = la classe)
async function sousNode(etiquette: string, classe: string, expressions: string[]): Promise<unknown[]> {
  const p = await construire(etiquette, { 'App.class.mjs': classe, 'p-home.mjs': '<p>{µApp.NAME}</p>\n' })
  assert.equal(p.erreurs, '', etiquette)
  const code = `const { default: App } = await import(${JSON.stringify(join(p.outDir, 'node', 'App.js'))}); console.log(JSON.stringify([${expressions.join(', ')}]))`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf-8' }).trim())
}

describe('classes globales `Nom.class.mjs` — la portée de la classe, sans `@`', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sous Node : membres lus et écrits par leur nom dans le corps, lus et écrits dehors comme avant', async () => {
    const p = await construire('node', SOURCES)
    assert.equal(p.erreurs, '')
    // la rune µraw demande le cœur : le test pose lui-même sur globalThis.µ ce qu'elle lit
    const code = `globalThis.µ = { raw: (o) => o }; await import(${JSON.stringify(join(p.outDir, 'node', 'App.js'))}); const µ = globalThis.µ; console.log(JSON.stringify([${SEQUENCE.join(', ')}]))`
    const vu   = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf-8' }).trim())
    SEQUENCE.forEach((e, i) => assert.deepEqual(vu[i], ATTENDU[i], e))
  })

  it('le code produit en développement lit chaque membre sur la classe, jamais sur `this`', async () => {
    const p = await construire('dev', SOURCES)
    assert.equal(p.erreurs, '')
    const classe = p.classe()
    assert.match(classe, /static fullName\s*=\s*function\(\)\s*\{\s*return App\.NAME \+ ' — ' \+ App\.SLOGAN/)
    assert.match(classe, /static FULL\s*=\s*App\.NAME \+ ' ' \+ App\.SLOGAN/)
    assert.match(classe, /NAME: App\.NAME/, 'la propriété raccourcie { NAME } vaut le membre')
    assert.match(classe, /\{\s*NAME: 1\s*\}/, 'une clé d’objet reste une clé')
    assert.match(classe, /o\.NAME, x\.NAME/, 'une propriété reste une propriété')
    assert.doesNotMatch(classe, /this\./)
  })

  it('développement minifié et production : la classe se construit, ses noms publics gardés', async () => {
    for (const [etiquette, opts] of [['min', { minify: true }], ['prod', { env: 'prod', js: 'split', urlPrefix: '/out' }]] as Array<[string, Record<string, unknown>]>) {
      const p = await construire(etiquette, SOURCES, opts)
      assert.equal(p.erreurs, '', etiquette)
      const classe = p.classe()
      for (const nom of ['NAME', 'FULL', 'count', 'fullName', 'reset']) assert.match(classe, new RegExp(`static ${nom}=`), `${etiquette} : ${nom}`)
      assert.doesNotMatch(classe, /this\./, etiquette)
    }
  })

  it('lecture sûre du fichier : une expression régulière sans parenthèses (`@`, guillemet) ne trompe ni le refus ni les membres', async () => {
    const classe = ['class App', "  NAME = 'x'", '  t    = (s) -> s.split /@/', '  r    = (s) -> s.replace /@/g, "a"', '  ok   = (s) -> Boolean s.match /^[^@]+@[^@]+$/', '  q    = (s) -> s.split /"/', "  esc  = (s) -> s.replace /\"/g, '&quot;'", "  sq   = (s) -> s.split /'/", "  LAST = 'y'", '  get  = -> NAME + LAST', '  tag  = -> "@x #{NAME}"'].join('\n') + '\n'
    const vu     = await sousNode('regex', classe, ["App.t('a@b')", "App.r('a@b')", "App.ok('a@b')", "App.ok('ab')", "App.q('a\"b')", "App.esc('a\"b')", "App.sq(\"a'b\")", 'App.NAME', 'App.LAST', 'App.get()', 'App.tag()'])
    assert.deepEqual(vu, [['a', 'b'], 'aab', true, false, ['a', 'b'], 'a&quot;b', ['a', 'b'], 'x', 'y', 'xy', '@x x'])
  })

  it('membre typé : `NOM: Type = …` est un membre, lu et écrit par son nom, `static` écrit ou non', async () => {
    const classe = ['class App', "  NAME = 'x'", '  count: number = 1', '  static S: number = 2', '  inc  = -> count += 1', '  setS = ->', '    S = 5', '    S'].join('\n') + '\n'
    const vu     = await sousNode('type', classe, ['App.count', 'App.inc()', 'App.count', 'App.S', 'App.setS()', 'App.S'])
    assert.deepEqual(vu, [1, 2, 2, 2, 5, 5])
  })

  it('filet : des membres lus avant la compilation qui manquent à la classe compilée arrêtent la construction', () => {
    assert.throws(() => classScope('class App {\n  static NAME = 1\n}\n', 'App', ['NAME', 'LOST'], 'App.class.mjs', () => null), /App\.class\.mjs.*LOST/)
  })

  it('même constructeur : une classe refusée puis corrigée se reconstruit, une ligne `@import` ne compte pas', async () => {
    const root   = mjsTmp('classes-portee-reprise')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    const juste = "@import { double } 'outil.civet.mjs'\nclass App\n  NAME = 'x'\n  twice = (n) -> double(n)\n"
    writeFileSync(join(srcDir, 'outil.civet.mjs'), 'export double = (n) -> n * 2\n')
    writeFileSync(join(srcDir, 'p-home.mjs'), '<p>{µApp.NAME}</p>\n')
    writeFileSync(join(srcDir, 'App.class.mjs'), juste)
    const b  = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const vu = async () => (await b.compile()).errors.map((e: any) => e.message).join('\n')
    try {
      assert.equal(await vu(), '', 'juste au départ')
      writeFileSync(join(srcDir, 'App.class.mjs'), juste.replace('double(n)', 'double(@n)'))
      assert.match(await vu(), /App\.class\.mjs, ligne 4 : « @n »/, 'refusée')
      writeFileSync(join(srcDir, 'App.class.mjs'), juste)
      assert.equal(await vu(), '', 'corrigée')
    }
    finally {
      await b.close()
    }
  })

  it('un `@` dans une classe arrête la construction : le fichier, la ligne et la bonne écriture', async () => {
    const cas: Array<[string, string, RegExp]> = [
      ['membre', "class App\n  @NAME = 'x'\n", /App\.class\.mjs, ligne 2 : « @NAME = … ».*Écrivez « NAME = … »/],
      ['lecture', "class App\n  NAME = 'x'\n  get  = -> @NAME\n", /App\.class\.mjs, ligne 3 : « @NAME ».*Écrivez « NAME »/],
      ['double', "class App\n  NAME = 'x'\n  get  = -> @@NAME\n", /App\.class\.mjs, ligne 3 : « @@NAME ».*Écrivez « NAME »/],
      ['seul', "class App\n  NAME = 'x'\n  self = -> @\n", /App\.class\.mjs, ligne 3 : « @ ».*Écrivez « App »/],
      ['nom-lie-variable', "class App\n  count = 1\n  m = ->\n    App = { count: 'faux' }\n    count\n", /App\.class\.mjs, ligne 4 : « App » est lié/],
      ['nom-lie-parametre', 'class App\n  count = 1\n  m = (App) -> count\n', /App\.class\.mjs, ligne 3 : « App » est lié/],
      ['nom-lie-boucle', 'class App\n  count = 1\n  m = ->\n    for App of [0]\n      count\n', /App\.class\.mjs, ligne 4 : « App » est lié/],
      ['seconde-classe', 'class App\n  get = ->\n    tmp = 5\n    tmp\nclass Helper\n  tmp = 0\n', /App\.class\.mjs, ligne 5 : « class Helper »/],
      ['delete', 'class App\n  count = 1\n  drop = -> delete count\n', /App\.class\.mjs, ligne 3 : « delete count ».*Écrivez « delete µApp\.count »/],
    ]
    for (const [etiquette, classe, attendu] of cas) {
      const p = await construire(`refus-${etiquette}`, { 'App.class.mjs': classe, 'p-home.mjs': '<p>{µApp.NAME}</p>\n' })
      assert.match(p.erreurs, attendu, etiquette)
    }
  })
})
