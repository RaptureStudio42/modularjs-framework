// une chaîne `"…"` ou `'…'` d'un script Civet ou CoffeeScript écrite sur plusieurs lignes : le retrait des commentaires la lit ligne par
// ligne, un `#` (ou un `//`) y ouvre un commentaire et le reste de sa ligne quitte la chaîne, sans erreur ; cette lecture reste la même ;
// la construction le dit par un avertissement `[lint.multilineString]`, à la place du signe (`fichier.mjs:ligne:colonne`), dans un
// composant, un partiel et un module `.civet.mjs` (où le `#` devient `//`) ; `"lint": { "multilineString": false }` le coupe,
// `"error"` en fait une erreur de build ; un signe n'est dit qu'une fois ; le message nomme les guillemets à tripler et le code du
// signe ; `mjs dev` le redit à chaque recompilation du fichier ; un partiel est nommé par son chemin depuis le dossier du composant ;
// quand le commentaire emporte le guillemet fermant, l'erreur de lecture porte la place relevée

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { extractSections, retirerCommentaires } from '../src/transpiler/sections.js'
import { applyCivetDialectSugar } from '../src/transpiler/sugar.js'
import { findConfig } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const COFFEE   = ' lang="coffee"'
const SIMPLE   = '\''
const script = (corps: string, lang = ''): string => `<script${lang}>\n${corps}\n</script>\n<p>{$s}</p>\n`
const places = (corps: string, lang = '') => extractSections(script(corps, lang)).lostInStrings
const place  = (line: number, column: number, openLine: number, sign = '#', quote = '"') => ({ line, column, openLine, sign, quote })

const BUILD_FINI = /✅ \d+ fichiers? en \d+ms/g
const portLibre  = (): Promise<number> => new Promise((ok, ko) => {
  const s = createServer()
  s.once('error', ko)
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address() as AddressInfo
    s.close(() => ok(port))
  })
})

// le corps du script commence à la ligne 2 du fichier ; chaque forme : ce que la construction relève
const ENTAMEES: Array<[string, string, string, ReturnType<typeof place>[]]> = [
  ['ligne `# …` dans une chaîne "…"', '$s = "un\n# deux\ntrois"', '', [place(3, 1, 2)]],
  ['ligne `# …` dans une chaîne \'…\'', '$s = \'un\n# deux\ntrois\'', '', [place(3, 1, 2, '#', SIMPLE)]],
  ['`#` en cours de ligne', '$s = "un\ndeux # pas-c\ntrois"', '', [place(3, 6, 2)]],
  ['`#` sur la ligne du guillemet ouvrant', '$s = "un # pas-c\ntrois"', '', [place(2, 10, 2)]],
  ['`//` d\'une adresse', '$s = "voir\nhttp://x.fr // pas-c\nfin"', '', [place(3, 6, 2, '//')]],
  ['bloc `###`', '$s = "un\n### deux ###\ntrois"', '', [place(3, 1, 2, '###')]],
  ['interpolation `#{…}`', '$a = 1\n$s = "un #{$a} deux\ntrois"', '', [place(3, 10, 3)]],
  ['guillemet fermant suivi d\'une autre chaîne', '$s = String("un\n# deux\ntrois", "x")', '', [place(3, 1, 2)]],
  ['guillemet fermant parti avec le commentaire', '$s = "un\ndeux # trois"\n$t = 1', '', [place(3, 6, 2)]],
  ['barre de division avant le guillemet ouvrant', '$a = 4\n$s = $a / 2 + "un\n# deux\ntrois"', '', [place(4, 1, 3)]],
  ['deux lignes `# …` dans la même chaîne : dit une fois, à la première', '$s = "un\n# deux\n# trois\nquatre"', '', [place(3, 1, 2)]],
  ['deux chaînes : dit pour chacune', '$s = "un\n# deux\ntrois"\n$u = \'a\n# b\nc\'', '', [place(3, 1, 2), place(6, 1, 5, '#', SIMPLE)]],
  ['seconde chaîne ouverte sur la ligne qui ferme la première', '$s = "un\ndeux" + "trois\n# quatre\ncinq"', '', [place(4, 1, 3)]],
  ['CoffeeScript, "…"', '$s = "un\n# deux\ntrois"', COFFEE, [place(3, 1, 2)]],
  ['CoffeeScript, \'…\'', '$s = \'un\n# deux\ntrois\'', COFFEE, [place(3, 1, 2, '#', SIMPLE)]],
  ['CoffeeScript, `#` collé à un mot', '$s = "un\n#deux\ntrois"', COFFEE, [place(3, 1, 2)]],
  ['guillemet resté seul dans une chaîne \'…\' refermée devant d\'autres chaînes, puis une chaîne entamée', '$a = String(\'il dit "oui\net repart\', "", \'z\')\n$s = "un\n# deux\ntrois"', '', [place(5, 1, 4)]],
  ['la même, CoffeeScript', '$a = String(\'il dit "oui\net repart\', "", \'z\')\n$s = "un\n# deux\ntrois"', COFFEE, [place(5, 1, 4)]],
  ['barre de suite dans une chaîne \'…\' ouverte sur la ligne qui ferme la première', '$s = \'un\ndeux\' + \'trois \\\n# quatre \\\ncinq\'', '', [place(4, 1, 3, '#', SIMPLE)]],
  ['la même, son guillemet fermant parti avec un `//`', '$s = [\'un\ndeux\' + \'trois \\\nvoir http://x.fr/a\']', '', [place(4, 11, 3, '//', SIMPLE)]],
  ['apostrophe ouverte dans le texte d\'une chaîne "…" : le signe est dit une fois', '$s = "il dit \'oui\n# deux\net \'non\' aussi"', '', [place(3, 1, 2)]],
  ['la même, apostrophe en tête de ligne : dit pour la chaîne ouverte la première', '$s = "il dit\n\'oui\n# deux\net \'non\' aussi"', '', [place(4, 1, 2)]]
]

// rien n'est pris dans une chaîne : rien n'est dit
const INTACTES: Array<[string, string, string]> = [
  ['chaîne d\'une ligne à `#`', '$s = "a # b" # c-fin', ''],
  ['chaîne à trois guillemets', '$s = """\n  un\n  # deux\n"""', ''],
  ['chaîne de plusieurs lignes sans `#`, commentaires après elle', '$s = "un\ndeux\ntrois" # c-fin\n# c-ligne "x\n$t = \'a\'', ''],
  ['Civet, `#` collé à un mot : un symbole, gardé', '$s = "un\n#deux\ntrois"', ''],
  ['guillemet fermant suivi d\'une autre chaîne, puis commentaires, puis une autre chaîne de deux lignes', '$a = "un\ndeux" + " "\n# commentaire\n$n = 1 # autre commentaire\n$b = "trois\nquatre"', ''],
  ['regex à guillemets en tête de ligne après une valeur', '@cite = (s) ->\n  s = String(s)\n  /["\']/.test s\n# commentaire\n$couleur = \'#000\'\n$titre = "Bonjour #{$couleur}"\n$s = 1', ''],
  ['regex à apostrophe en tête de ligne, CoffeeScript', 'f = (s) ->\n  console.log(s)\n  /\'/.test s\n# commentaire\n$couleur = \'#000\'\n$s = 1', COFFEE],
  ['regex à guillemet dans une liste', '$motifs = [\n  /\'/g\n  /"/g\n]\n# commentaire\n$couleur = \'#000\'\n$s = "a # b"', ''],
  ['regex à guillemet valeur d\'un objet', '$regles =\n  simple: /\'/\n  double: /"/\n# commentaire\n$couleur = \'#000\'\n$s = "#111"', ''],
  ['apostrophe collée à un mot', 'x = l\'un\n# c-ligne\ny = \'z # pas-c\'', ''],
  ['JavaScript', 'const s = "un\n// c-ligne\nconst t = "deux"', ' lang="js"'],
  ['commentaire à guillemet après une chaîne \'…\' de deux lignes qui porte un guillemet, refermée devant d\'autres chaînes', '$a = String(\'il dit "oui\net repart\', "", \'z\')\n# commentaire "à revoir\n$s = $a', ''],
  ['barre de suite dans une chaîne \'…\' : passée d\'un bloc, son `#` reste du texte', '$s = \'trois \\\n# quatre \\\ncinq\'', '']
]

describe('lint.multilineString — une chaîne écrite sur plusieurs lignes entamée par un commentaire', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la lecture reste la même, témoin branché ou non : le commentaire part, à longueur égale il est blanchi', () => {
    assert.equal(retirerCommentaires(script('$s = "un\n# deux\ntrois"'), 'civet', 'sass'), script('$s = "un\n\ntrois"'))
    assert.equal(retirerCommentaires(script('$s = "un\ndeux # pas-c\ntrois"'), 'civet', 'sass'), script('$s = "un\ndeux \ntrois"'))
    assert.equal(retirerCommentaires(script('$s = "un\ndeux # trois"\n$t = 1'), 'civet', 'sass'), script('$s = "un\ndeux \n$t = 1'))
    assert.equal(retirerCommentaires(script('$s = \'un\n# deux\ntrois\'', COFFEE), 'civet', 'sass'), script('$s = \'un\n\ntrois\'', COFFEE))
    assert.equal(retirerCommentaires(script('$a = "un\ndeux" + " "\n# commentaire\n$n = 1 # autre commentaire\n$b = "trois\nquatre"'), 'civet', 'sass'), script('$a = "un\ndeux" + " "\n\n$n = 1 \n$b = "trois\nquatre"'))
    assert.equal(retirerCommentaires(script('$s = "un\n# deux\ntrois" # c-fin'), 'civet', 'sass', true), script('$s = "un\n      \ntrois"        '))
    for (const [, corps, lang] of [...ENTAMEES, ...INTACTES]) {
      for (const egale of [false, true]) assert.equal(retirerCommentaires(script(corps, lang), 'civet', 'sass', egale, []), retirerCommentaires(script(corps, lang), 'civet', 'sass', egale), corps)
    }
  })

  for (const [nom, corps, lang, attendu] of ENTAMEES) {
    it(`relevée à la place du signe — ${nom}`, () => {
      assert.deepEqual(places(corps, lang), attendu)
    })
  }

  for (const [nom, corps, lang] of INTACTES) {
    it(`rien n'est dit — ${nom}`, () => {
      assert.deepEqual(places(corps, lang), [])
    })
  }

  it('composant : un avertissement étiqueté, à fichier:ligne:colonne, qui dit quoi écrire ; `false` le coupe', async () => {
    const lignes = async (lint?: Record<string, unknown>) => ((await transpile(script('$s = "un\n# deux\ntrois"'), { moduleName: 'fiche', lint: lint as any })).data.sectionWarnings as string[]).filter(w => w.includes('multilineString'))
    const w      = await lignes()
    assert.equal(w.length, 1, w.join('\n'))
    assert.ok(w[0].endsWith('[lint.multilineString]'), w[0])
    assert.ok(w[0].includes('fiche.mjs:3:1 : ce « # » est écrit dans une chaîne qui court sur plusieurs lignes (guillemet ouvrant ligne 2)'), w[0])
    assert.match(w[0], /ce commentaire quitte votre texte, sans erreur\. Écrivez cette chaîne entre trois guillemets \(""" … """\), ou coupez-la en chaînes d'une ligne ajoutées l'une à l'autre .*, ou écrivez ce « # » par son code \(\\x23\)\./)
    assert.deepEqual(await lignes({ multilineString: false }), [])
  })

  it('le message nomme les guillemets à tripler — ceux de la chaîne — et le code du signe ; ces écritures gardent le texte', async () => {
    const dit    = async (corps: string) => ((await transpile(script(corps), { moduleName: 'fiche' })).data.sectionWarnings as string[]).filter(w => w.includes('multilineString'))
    const simple = await dit('$s = \'un\n# deux\ntrois\'')
    assert.equal(simple.length, 1, simple.join('\n'))
    assert.ok(simple[0].includes('Écrivez cette chaîne entre trois apostrophes (\'\'\' … \'\'\'), ou coupez-la'), simple[0])
    assert.ok(!simple[0].includes('"""'), simple[0])
    const barres = await dit('$s = "voir\nhttp://x.fr // pas-c\nfin"')
    assert.ok(barres[0].includes('ou écrivez sa première barre par son code (\\x2F).'), barres[0])
    const bloc   = await dit('$s = "un\n### deux ###\ntrois"')
    assert.ok(bloc[0].includes('ou écrivez ses « # » par leur code (\\x23).'), bloc[0])
    for (const corps of ['$s = \'\'\'\n  un\n  # deux\n\'\'\'', '$s = \'un\n\\x23 deux\ntrois\'', '$s = "voir\nhttp:\\x2F/x.fr deux\nfin"', '$s = "un\n\\x23\\x23\\x23 deux \\x23\\x23\\x23\ntrois"']) {
      const r = await transpile(script(corps), { moduleName: 'fiche' })
      assert.deepEqual((r.data.sectionWarnings as string[]).filter(w => w.includes('multilineString')), [], corps)
      assert.match(r.output, /deux/, corps)
    }
  })

  it('composant averti dont une autre erreur arrête la compilation : son erreur, mot pour mot, sans la phrase de l\'avertissement', async () => {
    const src = script('$s = "un\n# deux\ntrois"\nx := 1\nx = 2\n$t = x')
    await assert.rejects(transpile(src, { moduleName: 'fiche' }), (e: Error) => {
      assert.equal(e.message, '\'fiche\' : [ModularJS] réaffectation de « x » (ligne 6) refusée — déclaré avec « := » (constante) : utilisez « .= » pour pouvoir le réaffecter.')
      return true
    })
  })

  it('commentaire qui emporte le guillemet fermant : l\'erreur de lecture, mot pour mot, à la dernière ligne du script', async () => {
    const src = script('$s = "un\ndeux # trois"\n$t = 1')
    await assert.rejects(transpile(src, { moduleName: 'fiche' }), (e: Error) => {
      assert.equal(e.message, '\'fiche\' : fiche.mjs:5:1 Failed to parse\nExpected:\n\tDoubleQuote "\\\\\\""\nFound: EOF\n')
      return true
    })
  })

  it('l\'autre erreur corrigée : l\'avertissement de la chaîne est dit à sa place', async () => {
    const r = await transpile(script('$s = "un\n# deux\ntrois"\nx .= 1\nx = 2\n$t = x'), { moduleName: 'fiche' })
    const w = (r.data.sectionWarnings as string[]).filter(l => l.includes('multilineString'))
    assert.equal(w.length, 1, w.join('\n'))
    assert.ok(w[0].includes('fiche.mjs:3:1 : ce « # » est écrit dans une chaîne qui court sur plusieurs lignes (guillemet ouvrant ligne 2)'), w[0])
  })

  it('module : le balayeur des `#` rend le même texte, et relève la chaîne à sa ligne du fichier', () => {
    const src  = 'export texte := "un\n# deux\ntrois" # c-fin\nexport simple := \'a # b\'\n'
    const lost = [] as unknown[]
    const out  = applyCivetDialectSugar(src, 'civet', undefined, 5, undefined, undefined, 'balayeur', lost as any)
    assert.equal(out, applyCivetDialectSugar(src, 'civet', undefined, 5))
    assert.ok(out.includes('"un\n// deux\ntrois"'), out)
    assert.deepEqual(lost, [place(6, 1, 5)])
  })

  it('module : les mêmes formes, chaque signe relevé une fois', () => {
    const releve = (src: string): unknown[] => {
      const lost = [] as unknown[]
      applyCivetDialectSugar(src, 'civet', undefined, 1, undefined, undefined, 'balayeur', lost as any)
      return lost
    }
    assert.deepEqual(releve('a := String(\'il dit "oui\net repart\', "", \'z\')\ns := "un\n# deux\ntrois"\n'), [place(4, 1, 3)])
    assert.deepEqual(releve('s := "il dit\n\'oui\n# deux\net \'non\' aussi"\n'), [place(3, 1, 1)])
    assert.deepEqual(releve('a := String(\'il dit "oui\net repart\', "", \'z\')\n# commentaire "à revoir\ns := a\n'), [])
  })

  it('au build : composant et module importé avertis chacun à sa place ; "error" en fait deux erreurs', async () => {
    const compile = async (lint?: Record<string, unknown>) => {
      const root   = mjsTmp('lint-chaine')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'textes.civet.mjs'), 'export texte := "un\n# deux\ntrois"\n')
      writeFileSync(join(srcDir, 'fiche.mjs'), '<script>\n@import { texte } \'textes.civet.mjs\'\n$s = "un\n# deux\ntrois"\n</script>\n<p>{$s} {texte}</p>\n')
      const b      = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), lint: lint as any })
      const stats  = await b.compile()
      await b.close()
      return { errors: stats.errors.map((e: any) => String(e.message ?? e)), warnings: stats.warnings.map(String).filter((w: string) => w.includes('multilineString')) }
    }
    const defaut = await compile()
    assert.deepEqual(defaut.errors, [])
    assert.equal(defaut.warnings.length, 2, defaut.warnings.join('\n'))
    assert.ok(defaut.warnings.some(w => /fiche\.mjs : [\s\S]*fiche\.mjs:4:1 : [\s\S]*ce commentaire quitte votre texte[\s\S]*\[lint\.multilineString\]$/.test(w)), defaut.warnings.join('\n'))
    assert.ok(defaut.warnings.some(w => /textes\.civet\.mjs : [\s\S]*textes\.civet\.mjs:2:1 : [\s\S]*il devient « \/\/ » dans votre texte[\s\S]*\[lint\.multilineString\]$/.test(w)), defaut.warnings.join('\n'))
    const coupe  = await compile({ multilineString: false })
    assert.deepEqual([coupe.errors, coupe.warnings], [[], []])
    const erreur = await compile({ multilineString: 'error' })
    assert.deepEqual(erreur.warnings, [])
    assert.equal(erreur.errors.filter(e => e.includes('multilineString')).length, 2, erreur.errors.join('\n'))
  })

  it('outil de compilation d\'un seul fichier (celui de `mjs mcp`) : le même avertissement', async () => {
    const root     = mjsTmp('lint-chaine-seul')
    const b        = new Bundler({ sourceDir: root, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const warnings = [] as string[]
    await b.compileSingle(script('$s = "un\n# deux\ntrois"'), { fileName: 'fiche.mjs', warnings })
    await b.close()
    assert.deepEqual(warnings.filter(w => w.includes('multilineString')).map(w => w.includes('fiche.mjs:3:1')), [true], warnings.join('\n'))
  })

  it('mjs check --json : chaque avertissement en objet, avec son type, son fichier, sa ligne, sa colonne et ce qu\'il faut écrire', () => {
    const root = mjsTmp('lint-chaine-json')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'textes.civet.mjs'), 'export texte := "un\n# deux\ntrois"\n')
    writeFileSync(join(root, 'app', 'modularjs', 'fiche.mjs'), '<script>\n@import { texte } \'textes.civet.mjs\'\n$s = "un\n# deux\ntrois"\n</script>\n<p>{$s} {texte}</p>\n')
    const r    = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    const dits = (JSON.parse(r.stdout).warnings as Array<Record<string, unknown>>).filter(d => d.type === 'multilineString')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(dits.map(d => [d.severity, d.file, d.line, d.column]).sort(), [['warning', 'app/modularjs/fiche.mjs', 4, 1], ['warning', 'app/modularjs/textes.civet.mjs', 2, 1]], r.stdout)
    for (const d of dits) assert.match(String(d.fix), /^Écrivez cette chaîne entre trois guillemets/)
  })

  it('partiel rangé hors du dossier du composant : nommé par son chemin depuis ce dossier, `mjs check --json` rend son vrai fichier', () => {
    const root = mjsTmp('lint-chaine-partiel')
    const dir  = join(root, 'app', 'modularjs')
    for (const d of ['sous', 'shared', 'pages']) mkdirSync(join(dir, d), { recursive: true })
    writeFileSync(join(dir, 'sous', '_bloc.mjs'), '<script>\n$bloc = "un\n# deux\ntrois"\n</script>\n<b>{$bloc}</b>\n')
    writeFileSync(join(dir, 'shared', '_pied.mjs'), '<script>\n$pied = 1\n$texte = "un\n# deux\ntrois"\n</script>\n<i>{$texte}{$pied}</i>\n')
    writeFileSync(join(dir, 'fiche.mjs'), '<@include sous/bloc>\n<p>fiche</p>\n')
    writeFileSync(join(dir, 'pages', 'accueil.mjs'), '<@include pied>\n<p>accueil</p>\n')
    const json  = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    const dits  = (JSON.parse(json.stdout).warnings as Array<Record<string, unknown>>).filter(d => d.type === 'multilineString')
    assert.deepEqual(dits.map(d => [d.file, d.line, d.column]).sort(), [['app/modularjs/shared/_pied.mjs', 4, 1], ['app/modularjs/sous/_bloc.mjs', 3, 1]], json.stdout)
    const texte = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    const ecrit = texte.stdout + texte.stderr
    assert.ok(ecrit.includes(' sous/_bloc.mjs:3:1 : ce « # »'), ecrit)
    assert.ok(ecrit.includes(' ../shared/_pied.mjs:4:1 : ce « # »'), ecrit)
  })

  it('mjs dev : un défaut écrit pendant que le serveur tourne est dit à la recompilation de son fichier, une fois, et pas à celle d\'un autre', async () => {
    const root = mjsTmp('lint-chaine-dev')
    const dir  = join(root, 'app', 'modularjs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'fiche.mjs'), '<script>\n$s = "un"\n</script>\n<p>{$s}</p>\n')
    writeFileSync(join(dir, 'autre.mjs'), '<script>\n$a = 1\n</script>\n<i>{$a}</i>\n')
    const proc = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'dev', '--root', root, '--port', String(await portLibre())], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    proc.stdout!.on('data', (d) => { sortie += String(d) })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    // ce que le terminal a reçu depuis `de`, le `n`-ième build fini et ses avertissements écrits
    const tour = async (n: number, de: number): Promise<string> => {
      const fin = Date.now() + 60000
      while ((sortie.match(BUILD_FINI) ?? []).length < n) {
        if (Date.now() > fin) throw new Error(`build ${n} jamais fini\n${sortie}`)
        await new Promise(r => setTimeout(r, 100))
      }
      await new Promise(r => setTimeout(r, 1500))
      return sortie.slice(de)
    }
    const dits = (texte: string): number => (texte.match(/\[lint\.multilineString\]/g) ?? []).length
    try {
      assert.equal(dits(await tour(1, 0)), 0, sortie)
      let de = sortie.length
      writeFileSync(join(dir, 'fiche.mjs'), '<script>\n$s = "un\n# deux\ntrois"\n</script>\n<p>{$s}</p>\n')
      const ecrit = await tour(2, de)
      assert.equal(dits(ecrit), 1, ecrit)
      assert.ok(ecrit.includes('fiche.mjs:3:1 : ce « # » est écrit dans une chaîne'), ecrit)
      de = sortie.length
      writeFileSync(join(dir, 'autre.mjs'), '<script>\n$a = 2\n</script>\n<i>{$a}</i>\n')
      assert.equal(dits(await tour(3, de)), 0, sortie.slice(de))
      de = sortie.length
      writeFileSync(join(dir, 'fiche.mjs'), '<script>\n$s = "un\n# deux\ntrois"\n$u = 2\n</script>\n<p>{$s}{$u}</p>\n')
      assert.equal(dits(await tour(4, de)), 1, sortie.slice(de))
    }
    finally {
      proc.kill('SIGKILL')
    }
  })

  it('mjs.config.json : true, false ou "error", message clair sinon', () => {
    const ok   = mjsTmp('lint-chaine-cfg')
    writeFileSync(join(ok, 'mjs.config.json'), JSON.stringify({ lint: { multilineString: 'error' } }))
    assert.equal(findConfig(ok)!.config.lint!.multilineString, 'error')
    const faux = mjsTmp('lint-chaine-cfg')
    writeFileSync(join(faux, 'mjs.config.json'), JSON.stringify({ lint: { multilineString: 'warn' } }))
    assert.throws(() => findConfig(faux), /lint\.multilineString doit valoir true, false ou "error"/)
  })
})
