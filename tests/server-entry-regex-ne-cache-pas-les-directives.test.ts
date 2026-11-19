// Test — fichiers serveur (`*.server.mjs` en Civet ou en CoffeeScript, `.civet` et `.coffee` bruts) : une regex est lue
// comme une regex. Le guillemet, le `###` ou l'accent grave qu'elle porte ne cache pas la suite du fichier au contrôle des
// directives (une directive écrite plus bas est refusée, jamais compilée en appel de méthode), et une ligne d'une regex
// étendue `///…///` qui cite `@css` n'est pas une directive. Ce qui était juste le reste : une directive citée dans un
// heredoc d'une classe CoffeeScript n'est pas refusée, un fichier que Civet ne lit pas garde l'erreur de Civet, et un
// commentaire que Civet efface avec un type (interface, type littéral) ou un bloc `###` jamais refermé reste un
// commentaire. Un fichier qui commence par une marque d'ordre des octets ou qui importe par `@import default` est lu
// comme les autres ; le refus cite `fichier:ligne`, fins de ligne `\r` seules ou mêlées comprises. Une ligne `####`, une
// bannière de dièses ou un `####` en fin de ligne n'ouvre aucun bloc, comme pour la compilation, dans le dialecte
// (`*.server.mjs`, `*.civet.mjs`) comme en CoffeeScript et en Civet brut : elle ne couvre que sa ligne, et une directive
// écrite dessous est refusée, à sa ligne ; seul un `###` suivi d'autre chose qu'un `#` ouvre un bloc, refermé au `###`
// suivant. Une expression trop longue pour la lecture par l'arbre ne fait pas échouer la compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { compileServerFile, compileRawCivetFile } from '../src/cli/server-entry.js'
import { mjsTmp } from './helpers/tmp.js'

const tmpDirs: string[] = []
function freshRoot(prefix: string): string {
  const root = mjsTmp(prefix)
  tmpDirs.push(root)
  mkdirSync(join(root, 'node_modules'))   //cache SOUS node_modules, jamais os.tmpdir() (serverCacheDir)
  return root
}
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

const REFUS_SERVEUR = /n'a pas de sens|makes no sense/
const REFUS_BRUT    = /n'existe pas|doesn't exist/
const ERREUR_CIVET  = /erreur de compilation|compilation error/
const BOM           = String.fromCharCode(0xfeff)

// les quatre sortes de fichiers serveur : nom, compilation, directive écrite plus bas, refus attendu, fin du fichier
const SORTES = [
  { nom: 'app.server.mjs', compiler: compileServerFile, directive: '@css \'a.css\'', cite: /@css/, refus: REFUS_SERVEUR, fin: 'export default { setup: (app) -> f(\'x\') }' },
  { nom: 'app.server.coffee.mjs', compiler: compileServerFile, directive: '@css \'a.css\'', cite: /@css/, refus: REFUS_SERVEUR, fin: 'export default { setup: (app) -> f(\'x\') }' },
  { nom: 'brut.civet', compiler: (p: string, root: string) => compileRawCivetFile(p, root), directive: '@import a \'./a\'', cite: /@import/, refus: REFUS_BRUT, fin: 'export default f' },
  { nom: 'brut.coffee', compiler: (p: string, root: string) => compileRawCivetFile(p, root), directive: '@css \'a.css\'', cite: /@css/, refus: REFUS_BRUT, fin: 'export default f' },
]

// une regex qui porte un guillemet, un `###` ou un accent grave
const REGEX = [
  { nom: 'un guillemet', code: 'f = (s) -> s.replace /"/g, \'-\'' },
  { nom: 'un ###', code: 'f = (s) -> s.replace /###/g, \'-\'' },
  { nom: 'un accent grave', code: 'f = (s) -> s.replace /`/g, \'-\'' },
]

// une regex étendue dont une ligne cite `@css`
const HEREGEX = ['re = ///', '  a', '@css b', '///', 'f = (s) -> re.test(s)'].join('\n')

async function compiler(sorte: typeof SORTES[number], source: string): Promise<string> {
  const root = freshRoot('regex-directive')
  const path = join(root, sorte.nom)
  writeFileSync(path, source)
  return sorte.compiler(path, root)
}

describe('cli/server-entry — une regex ne cache pas la suite d\'un fichier serveur au contrôle des directives', function () {
  this.timeout(20000)

  for (const sorte of SORTES) {
    for (const regex of REGEX) {
      it(`${sorte.nom} : une regex qui porte ${regex.nom}, puis une directive plus bas → refusée`, async () => {
        const source = [regex.code, sorte.directive, sorte.fin, ''].join('\n')
        await assert.rejects(compiler(sorte, source), (err: Error) => {
          assert.match(err.message, sorte.refus)
          assert.match(err.message, sorte.cite)
          return true
        })
      })
    }

    it(`${sorte.nom} : une ligne d'une regex étendue \`///…///\` qui cite @css n'est pas une directive`, async () => {
      const url = await compiler(sorte, [HEREGEX, sorte.fin, ''].join('\n'))
      assert.match(url, /^file:\/\//)
    })

    it(`${sorte.nom} : une regex étendue qui cite @css, puis une directive plus bas → refusée pour celle-ci`, async () => {
      const directive = sorte.cite.source === '@css' ? '@lang fr' : sorte.directive
      const source    = [HEREGEX, directive, sorte.fin, ''].join('\n')
      await assert.rejects(compiler(sorte, source), (err: Error) => {
        assert.match(err.message, sorte.refus)
        assert.match(err.message, sorte.cite.source === '@css' ? /@lang/ : sorte.cite)
        return true
      })
    })
  }

  it('app.server.mjs écrit en \\r\\n : la regex à guillemet ne cache pas la directive plus bas', async () => {
    const source = [REGEX[0].code, '@css \'a.css\'', SORTES[0].fin, ''].join('\r\n')
    await assert.rejects(compiler(SORTES[0], source), REFUS_SERVEUR)
  })

  it('app.server.mjs écrit en \\r\\n : une directive citée dans un bloc `###` ou une chaîne sur deux lignes n\'est pas refusée', async () => {
    const source = ['###', '@css \'a.css\'', '###', 'd = \'', '@lang fr\'', 'f = (s) -> d + s', SORTES[0].fin, ''].join('\r\n')
    const url    = await compiler(SORTES[0], source)
    assert.match(url, /^file:\/\//)
  })

  it('une classe CoffeeScript dont un heredoc cite @css compile comme avant (.server.coffee.mjs et .coffee brut)', async () => {
    const classe = ['class Aide', '  texte: -> \'\'\'', '@css \'a.css\'', '\'\'\'', 'f = (s) -> new Aide().texte() + s'].join('\n')
    assert.match(await compiler(SORTES[1], [classe, SORTES[1].fin, ''].join('\n')), /^file:\/\//)
    assert.match(await compiler(SORTES[3], [classe, SORTES[3].fin, ''].join('\n')), /^file:\/\//)
  })

  it('un fichier que Civet ne lit pas (`#l\'eau`) garde l\'erreur de Civet, jamais un refus de la directive citée dans un heredoc', async () => {
    const heredoc = ['#l\'eau est froide', 'h = \'\'\'', '@css \'a.css\'', '\'\'\'', 'f = (s) -> h + s'].join('\n')
    await assert.rejects(compiler(SORTES[0], [heredoc, SORTES[0].fin, ''].join('\n')), (err: Error) => {
      assert.match(err.message, ERREUR_CIVET)
      assert.doesNotMatch(err.message, REFUS_SERVEUR)
      return true
    })
    const brut = heredoc.replace('@css \'a.css\'', '@import a \'./a\'')
    await assert.rejects(compiler(SORTES[2], [brut, SORTES[2].fin, ''].join('\n')), (err: Error) => {
      assert.match(err.message, ERREUR_CIVET)
      assert.doesNotMatch(err.message, REFUS_BRUT)
      return true
    })
  })

  it('app.server.mjs : un bloc ### dans une interface cite @css → compilé, jamais refusé', async () => {
    const source = ['interface Opts', '  ###', '@css \'a.css\'', '  ###', '  nom: string', 'export default { setup: (app) -> 1 }', ''].join('\n')
    assert.match(await compiler(SORTES[0], source), /^file:\/\//)
  })

  it('app.server.mjs : un bloc /** */ dans un type littéral cite @css → compilé, jamais refusé', async () => {
    const source = ['x: {', '  /**', '@css \'a.css\'', '  */', '  a: number', '} := { a: 1 }', 'export default { setup: (app) -> x }', ''].join('\n')
    assert.match(await compiler(SORTES[0], source), /^file:\/\//)
  })

  it('brut.civet : un bloc ### dans une interface cite @import → compilé, jamais refusé', async () => {
    const source = ['interface Opts', '  ###', '@import a \'./a\'', '  ###', '  nom: string', 'export default 1', ''].join('\n')
    assert.match(await compiler(SORTES[2], source), /^file:\/\//)
  })

  it('app.server.mjs : un bloc ### jamais refermé couvre la fin du fichier, la directive citée dedans n\'est pas refusée', async () => {
    const source = ['f := -> 1', '###', '@css \'a.css\'', 'export default f', ''].join('\n')
    assert.match(await compiler(SORTES[0], source), /^file:\/\//)
  })

  for (const sorte of SORTES.slice(0, 2)) {
    it(`${sorte.nom} commençant par une marque d'ordre des octets : la directive sous la regex est refusée`, async () => {
      const source = BOM + [REGEX[0].code, sorte.directive, sorte.fin, ''].join('\n')
      await assert.rejects(compiler(sorte, source), REFUS_SERVEUR)
    })

    it(`${sorte.nom} avec @import default : la directive sous la regex est refusée`, async () => {
      const source = ['@import default chemin \'node:path\'', REGEX[0].code, sorte.directive, 'export default { setup: (app) -> f(chemin.sep) }', ''].join('\n')
      await assert.rejects(compiler(sorte, source), REFUS_SERVEUR)
    })
  }

  it('le refus cite fichier:ligne, une ligne @import retirée comprise (.server.mjs, @import illisible, .civet brut, bibliothèque .coffee)', async () => {
    const entree = ['@import chemin \'node:path\'', REGEX[0].code, '@css \'a.css\'', SORTES[0].fin, ''].join('\n')
    await assert.rejects(compiler(SORTES[0], entree), /app\.server\.mjs:3'/)
    await assert.rejects(compiler(SORTES[0], [REGEX[0].code, '@import nom', SORTES[0].fin, ''].join('\n')), /app\.server\.mjs:2'/)
    await assert.rejects(compiler(SORTES[2], [REGEX[0].code, '', SORTES[2].directive, SORTES[2].fin, ''].join('\n')), /brut\.civet:3'/)
    const root = freshRoot('regex-directive')
    writeFileSync(join(root, 'lib.coffee'), [REGEX[0].code, '', '@css \'a.css\'', 'export default f', ''].join('\n'))
    writeFileSync(join(root, 'app.server.mjs'), ['@import l \'./lib.coffee\'', 'export default { setup: (app) -> l(\'x\') }', ''].join('\n'))
    // une bibliothèque : le refus de la construction, qui nomme chaque directive à sa ligne
    await assert.rejects(compileServerFile(join(root, 'app.server.mjs'), root), /\] lib\.coffee : [\s\S]*- ligne 3 : la directive « @css 'a\.css' »/)
  })

  // refus d'une directive de fichier serveur, cité à sa ligne
  const refusee = (nom: string, ligne: number) => (err: Error) => {
    assert.match(err.message, REFUS_SERVEUR)
    assert.match(err.message, new RegExp(`${nom.replace(/\./g, '\\.')}:${ligne}'`))
    return true
  }

  it('app.server.mjs : une directive entre deux lignes `####` est refusée, à sa ligne', async () => {
    await assert.rejects(compiler(SORTES[0], ['####', '@css \'a.css\'', '####', 'export default { setup: (app) -> 2 }', ''].join('\n')), refusee('app.server.mjs', 2))
  })

  it('app.server.mjs : une directive entre deux bannières de dix `#` est refusée, à sa ligne', async () => {
    await assert.rejects(compiler(SORTES[0], ['##########', '@lang fr', '##########', 'export default { setup: (app) -> 3 }', ''].join('\n')), refusee('app.server.mjs', 2))
  })

  it('a.civet.mjs : une directive sous `#### titre` est refusée, à sa ligne, même quand un `###` la suit', async () => {
    await assert.rejects(compiler({ ...SORTES[0], nom: 'a.civet.mjs' }, ['#### Ancien réglage', '@css \'a.css\'', '###', 'export default { setup: (app) -> 4 }', ''].join('\n')), refusee('a.civet.mjs', 2))
  })

  it('app.server.mjs : `####` en fin de ligne ou seul sur sa ligne ne commente que sa ligne → la directive dessous est refusée, à sa ligne', async () => {
    await assert.rejects(compiler(SORTES[0], ['x := 1 #### note', '@css \'a.css\'', SORTES[0].fin, ''].join('\n')), refusee('app.server.mjs', 2))
    await assert.rejects(compiler(SORTES[0], ['####', '@css \'a.css\'', SORTES[0].fin, ''].join('\n')), refusee('app.server.mjs', 2))
  })

  it('app.server.mjs : `###### @css` est un commentaire d\'une ligne → compilé, chargé ; une directive après la fin d\'un bloc `###` est refusée, à sa ligne', async () => {
    const url = await compiler(SORTES[0], ['###### @css \'a.css\'', 'export default { setup: (app) -> 5 }', ''].join('\n'))
    assert.equal((await import(url)).default.setup(), 5)
    await assert.rejects(compiler(SORTES[0], [REGEX[0].code, '#### titre', '###', 'texte du bloc', '###', '@css \'a.css\'', SORTES[0].fin, ''].join('\n')), refusee('app.server.mjs', 6))
  })

  it('app.server.coffee.mjs, brut.civet et brut.coffee : `####` ne couvre que sa ligne, la directive qui suit est refusée', async () => {
    for (const sorte of SORTES.slice(1)) {
      await assert.rejects(compiler(sorte, ['####', sorte.directive, '####', sorte.fin, ''].join('\n')), (err: Error) => {
        assert.match(err.message, sorte.refus)
        assert.match(err.message, new RegExp(`${sorte.nom.replace(/\./g, '\\.')}:2'`))
        return true
      })
    }
  })

  it('app.server.mjs écrit en \\r seuls : le refus cite la ligne 3', async () => {
    const source = ['x := 1', REGEX[0].code, '@css \'a.css\'', SORTES[0].fin, ''].join('\r')
    await assert.rejects(compiler(SORTES[0], source), /app\.server\.mjs:3'/)
  })

  it('brut.civet écrit en \\r\\n puis \\r : le refus cite la ligne 4', async () => {
    await assert.rejects(compiler(SORTES[2], 'x := 1\r\ny := 2\r\nz := 3\r@css \'a.css\'\r\nexport default x\r\n'), /brut\.civet:4'/)
  })

  it('une chaîne de 5 000 membres, trop profonde pour la lecture par l\'arbre : app.server.coffee.mjs compilé, chargé ; app.server.mjs cite le fichier en cas d\'échec', async () => {
    const chaine = 'a' + '.b'.repeat(5000)
    const url    = await compiler(SORTES[1], ['f = (a) -> ' + chaine, 'export default { setup: (app) -> 1 }', ''].join('\n'))
    assert.equal((await import(url)).default.setup(), 1)
    // Civet lui-même peut ne pas lire une chaîne si longue : son erreur cite le fichier, jamais une erreur de pile brute
    try {
      await compiler(SORTES[0], ['f := (a) -> ' + chaine, 'export default { setup: (app) -> 1 }', ''].join('\n'))
    }
    catch (err) {
      assert.ok(!(err instanceof RangeError), String(err))
      assert.match((err as Error).message, /app\.server\.mjs/)
    }
  })

  // un `.civet` brut est compilé par Civet nu : `#` y est du code (`this.length`), seul un bloc `###` refermé est un commentaire
  it('brut.civet : `###### @css \'a.css\'` ou douze dièses puis la directive sur la ligne → refusée, à sa ligne', async () => {
    for (const dieses of ['######', '############']) {
      await assert.rejects(compiler(SORTES[2], `${dieses} @css 'a.css'\nexport default 1\n`), (err: Error) => {
        assert.match(err.message, REFUS_BRUT)
        assert.match(err.message, /brut\.civet:1'/)
        return true
      })
    }
  })

  it('brut.civet écrit en \\r seuls : `######` ou `#### titre ###` au-dessus de la directive → refusée, ligne 2', async () => {
    for (const ligne of ['######', '#### titre ###']) {
      await assert.rejects(compiler(SORTES[2], `${ligne}\r@css 'a.css'\rexport default 1\r`), (err: Error) => {
        assert.match(err.message, REFUS_BRUT)
        assert.match(err.message, /brut\.civet:2'/)
        return true
      })
    }
  })

  it('brut.civet : `### a ### @css \'a.css\'`, du code pour Civet nu, → refusée, à sa ligne', async () => {
    await assert.rejects(compiler(SORTES[2], '### a ### @css \'a.css\'\nexport default 1\n'), (err: Error) => {
      assert.match(err.message, REFUS_BRUT)
      assert.match(err.message, /brut\.civet:1'/)
      return true
    })
  })

  it('bibliothèque .civet importée par une entrée : `###### @css \'a.css\'` → refusée, à sa ligne', async () => {
    const root = freshRoot('regex-directive')
    writeFileSync(join(root, 'lib.civet'), '###### @css \'a.css\'\nexport default 1\n')
    writeFileSync(join(root, 'app.server.mjs'), '@import l \'./lib.civet\'\nexport default { setup: (app) -> l }\n')
    await assert.rejects(compileServerFile(join(root, 'app.server.mjs'), root), /\] lib\.civet : [\s\S]*- ligne 1 : la directive « @css »/)
  })

  it('écrit en \\r seuls : un commentaire qui porte un guillemet s\'arrête à sa fin de ligne, la directive dessous est refusée (.server.mjs, .civet.mjs, .civet brut)', async () => {
    for (const sorte of [SORTES[0], { ...SORTES[0], nom: 'a.civet.mjs' }]) {
      for (const commentaire of ['# note "', '// note "']) {
        await assert.rejects(compiler(sorte, [`${REGEX[0].code} ${commentaire}`, '@css \'a.css\'', sorte.fin, ''].join('\r')), new RegExp(`${sorte.nom.replace(/\./g, '\\.')}:2'`))
      }
    }
    await assert.rejects(compiler(SORTES[2], [`${REGEX[0].code} // note "`, '@css \'a.css\'', SORTES[2].fin, ''].join('\r')), /brut\.civet:2'/)
  })

  it('app.server.mjs et a.civet.mjs : une chaîne `"…#{…"` qui passe à la ligne, sous une regex à guillemet → la directive reste refusée', async () => {
    const source = [REGEX[0].code, 's = "a #{ "', '@css \'a.css\'', '" }"', SORTES[0].fin, ''].join('\n')
    for (const nom of ['app.server.mjs', 'a.civet.mjs']) await assert.rejects(compiler({ ...SORTES[0], nom }, source), new RegExp(`${nom.replace(/\./g, '\\.')}:3'`))
  })

  it('app.server.coffee.mjs commençant par une marque d\'ordre des octets : une directive sur la première ligne est refusée', async () => {
    await assert.rejects(compiler(SORTES[1], BOM + ['@css \'a.css\'', SORTES[1].fin, ''].join('\n')), (err: Error) => {
      assert.match(err.message, REFUS_SERVEUR)
      assert.match(err.message, /app\.server\.coffee\.mjs:1'/)
      return true
    })
  })

  // la marque d'ordre des octets retirée avant toute lecture : un @import juste sur la première ligne est lu comme sans elle
  for (const nom of ['app.server.mjs', 'a.civet.mjs', 'app.server.coffee.mjs']) {
    it(`${nom} commençant par une marque d'ordre des octets : un @import juste sur la première ligne est lu, le fichier se compile`, async () => {
      for (const directive of ['@import chemin \'node:path\'', '@import default chemin \'node:path\'']) {
        assert.match(await compiler({ ...SORTES[0], nom }, BOM + [directive, 'export default { setup: (app) -> chemin.sep }', ''].join('\n')), /^file:\/\//)
      }
    })

    it(`${nom} commençant par une marque d'ordre des octets, @import juste sur la première ligne : la directive sous la regex est refusée à sa ligne, l'@import n'est pas dit illisible`, async () => {
      const source = BOM + ['@import default chemin \'node:path\'', REGEX[0].code, '@css \'a.css\'', 'export default { setup: (app) -> f(chemin.sep) }', ''].join('\n')
      await assert.rejects(compiler({ ...SORTES[0], nom }, source), (err: Error) => {
        assert.match(err.message, REFUS_SERVEUR)
        assert.match(err.message, new RegExp(`${nom.replace(/\./g, '\\.')}:3'`))
        return true
      })
    })
  }
})
