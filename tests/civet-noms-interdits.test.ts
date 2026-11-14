// UN NOM QUI NE PEUT PAS ÊTRE UNE VARIABLE EST REFUSÉ À LA CONSTRUCTION, À SA LIGNE.
//
// Le script d'un composant tourne en JavaScript strict : `eval`, `arguments`, `implements`, `package` ou un mot réservé ne
// peuvent pas y être déclarés ni affectés, et `undefined`, `NaN`, `Infinity` déclarés dans le script masqueraient la valeur de
// JavaScript dans tout le composant, code produit par ModularJS compris. Sans ce refus, la construction cassait plus loin, sur le
// JavaScript produit (« [analyzer] parse error: Binding eval in strict mode », ligne du code compilé), ou passait sans rien dire.
//
// La lecture est celle de Civet lui-même : les noms que son arbre lie (affectation, `:=` / `.=`, motif `{a, b} =` / `[a, b] =`
// avec reste et valeur par défaut, paramètre, `for … in` / `of`, `catch`, `if x :=` / `while x :=`,
// motif d'un `switch`, nom de fonction, de classe ou d'`enum`, `++`). `undefined :=` compte aussi : Civet lit ce mot comme une
// valeur à comparer, mais le JavaScript produit le déclare. Le même mot dans une chaîne, un commentaire, une expression
// régulière, une heregex, un nom de propriété, un champ ou une méthode de classe, un `@x` de constructeur (ModularJS le lit
// `this.x`), une valeur par défaut, une valeur comparée par un `switch`, une clé de `<vars>` ou un argument nommé du gabarit
// n'est pas une variable : jamais refusé. Un nom que Civet
// refuse déjà lui-même (`await = 1`, `let = 1`) garde l'erreur de Civet.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'

// le code essayé commence à la ligne 5 du `.mjs`
const PREMIERE  = 5
const composant = (code: string) => `<script>\n  o = {}\n  xs = []\n  g = -> 1\n${code.split('\n').map(l => '  ' + l).join('\n')}\n</script>\n<p>x</p>\n`

const erreurDe = async (source: string): Promise<string | null> => {
  try {
    await transpile(source, { moduleName: 'essai' })
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
  return null
}

// code, nom refusé, ligne du nom dans le code essayé (0 = première), colonne du nom dans le script (sans sa marge ; le message cite celle du fichier, deux de plus) quand elle
// est vérifiée
const REFUSES: [string, string, number, number?][] = [
  ['undefined = 1', 'undefined', 0],
  ['NaN := 1', 'NaN', 0],
  ['Infinity .= 2', 'Infinity', 0],
  ['eval = 1', 'eval', 0],
  ['arguments = 1', 'arguments', 0],
  ['implements = 1', 'implements', 0],
  ['package = 1', 'package', 0],
  ['f = (eval) -> 1', 'eval', 0],
  ['f = ({NaN}) -> 1', 'NaN', 0],
  ['f = ([Infinity]) -> 1', 'Infinity', 0],
  ['f = (a, ...package) -> a', 'package', 0],
  ['{implements, a: {b}} = o', 'implements', 0],
  ['{a: {undefined}} = o', 'undefined', 0],
  ['[v, ...Infinity] = xs', 'Infinity', 0],
  ['for NaN in xs\n  g()', 'NaN', 0],
  ['for own k, eval in o\n  g()', 'eval', 0],
  ['function eval()\n  1', 'eval', 0],
  ['class Infinity\n  m: -> 1', 'Infinity', 0],
  ['f = ->\n  g()\n  arguments = 2', 'arguments', 2],
  ['undefined++', 'undefined', 0],
  ['x = "#{NaN = 1}"', 'NaN', 0],
  ['{await} = o', 'await', 0],
  ['{let} = o', 'let', 0],
  ['{yield} = o', 'yield', 0],
  ['h = ->\n  try\n    g()\n  catch eval\n    g()', 'eval', 3],
  // `undefined` dans un motif : Civet le lit comme une valeur à comparer, le JavaScript produit le lie
  ['valeurParDefaut = -> 0\nundefined := valeurParDefaut()', 'undefined', 1, 1],
  ['[undefined] = xs', 'undefined', 0],
  ['[a, undefined] = xs', 'undefined', 0, 5],
  ['[undefined] := xs', 'undefined', 0],
  ['{a: undefined} = o', 'undefined', 0],
  ['[...undefined] = xs', 'undefined', 0],
  ['x = do\n  undefined := g()\n  undefined', 'undefined', 1],
  ['x = try\n  undefined := g()\n  undefined', 'undefined', 1],
  ['x = if g()\n  NaN := 1\n  NaN', 'NaN', 1],
  // motif d'un `catch`, d'un `if` / `while` qui déclare, d'un `switch`
  ['h = ->\n  try\n    g()\n  catch {arguments}\n    g()', 'arguments', 3],
  ['h = ->\n  try\n    g()\n  catch {NaN}\n    g()', 'NaN', 3, 10],
  ['try\n  g()\ncatch [Infinity]\n  g()', 'Infinity', 2],
  ['if NaN := g()\n  g()', 'NaN', 0, 4],
  ['while NaN := g()\n  break', 'NaN', 0],
  ['switch o\n  {NaN}\n    g()', 'NaN', 1, 4],
  ['switch xs\n  [NaN, ...rest]\n    g()', 'NaN', 1],
  // méthode, `enum`
  ['enum NaN\n  A', 'NaN', 0, 6],
  ['class A\n  m()\n    NaN := 1', 'NaN', 2],
  // affectation dans une branche, que la passe de déclaration déclare aussi plus haut : refusée à sa propre ligne
  ['if g()\n  NaN = 1', 'NaN', 1, 3],
]

// le mot ailleurs qu'à une place de variable
const ACCEPTES: string[] = [
  "s = 'undefined = 1'",
  's = "eval = 1 ; let = 2 ; await = 3"',
  "s = \"première\nl'idée\nNaN =\n  suite\"",
  "a = '''\n  l'x\n  undefined = 1\n'''",
  '# undefined = 1',
  '// NaN = 1',
  '###\n  eval = 1\n###',
  "r = 'a\"b'.split /\"/",
  "s = 'u'.split /undefined = 1/",
  'r = ///\n  undefined = 1\n///',
  'o.await = 1',
  'o.undefined = 2',
  'o.let = 3',
  'p = { let: 1, await: 2, undefined: 3, eval: 4, NaN: 5, static: 6 }',
  '{undefined: v} = o',
  '{a = NaN} = o',
  'f = (a = undefined, b = Infinity) -> [a, b]',
  'x = undefined',
  'y = NaN + Infinity',
  'h = ->\n  await g()',
  'k = (v) -> if v is undefined then 0 else v',
  'class A\n  eval: -> 1\n  static NaN = 1',
  'q = o?.eval?()',
  // champ de classe : une propriété, même quand la passe de déclaration de ModularJS le déclare aussi comme variable
  'class A\n  NaN = 1',
  'class A\n  static NaN = 1',
  'class A\n  x = 1\n  NaN = 2',
  'class A\n  undefined = 2',
  'class A\n  NaN: number = 1',
  // `@x` d'un constructeur : ModularJS le lit `this.x`, Civet nomme alors le paramètre lui-même
  'class B\n  constructor(@NaN)\n    g()',
  // valeur comparée par un `switch` ou un `while x :=`, sujet d'un `switch` qui décompose
  'switch xs\n  [undefined, b]\n    g()',
  'switch o\n  {a: undefined}\n    g()',
  'switch o\n  when undefined\n    g()',
  'while undefined := g()\n  break',
  'f = ->\n  switch arguments\n    [a, b]\n      g()',
  // clé, membre, méthode, valeur, type
  'p = { eval: 1, arguments: 2 }',
  'q = o.arguments',
  'o.arguments = 1',
  'class A\n  eval()\n    1',
  'class A\n  get undefined()\n    1',
  'class A\n  static eval()\n    1',
  'o2 = { eval() { return 1 } }',
  's = "arguments = #{1}"',
  's = `undefined = ${1}`',
  '/* NaN = 1 */\nx = 1',
  'x = "#{undefined}"',
  "x = µt('undefined')",
  'x = {undefined}',
  'f = -> arguments.length',
  'f = -> g(...arguments)',
  "y = eval('1')",
  'o[NaN] = 1',
  '@eval = 1',
  'x ?= undefined',
  '{eval: e} = o',
  '[a = Infinity] = xs',
  'f = ({a = undefined}) -> a',
  'for x of xs when x is NaN\n  g()',
  'let n: number | undefined = 1',
  'f = (a: undefined | number) -> a',
  'type NaN = number',
  'x = o?.arguments?.length',
  'o4 = {...o, eval: 1}',
  'class A\n  constructor()\n    @eval = 1',
  '{undefined: v2 = NaN} = o',
  'f = (a = eval) -> a',
  'x = typeof undefined',
  'o.NaN++',
  'o.eval += 1',
  "x = 'a' if undefined?",
  'g eval: 1, NaN: 2',
]

// le mot à une place qui n'est pas une variable, dans une forme que la construction refuse pour une autre raison : ce refus-là
// ne vise pas le nom
const NON_REFUSES: string[] = [
  'class A\n  @NaN = 1',
  'o3 =\n  eval: -> 1\n  NaN: 2',
  'ys = xs.filter &.eval',
]

describe('Civet — nom interdit pour une variable, refusé à la construction', () => {
  for (const [code, nom, ligne, colonne] of REFUSES) {
    it(`refuse « ${nom} » dans ${JSON.stringify(code)}, à sa ligne`, async () => {
      const message = await erreurDe(composant(code))
      assert.ok(message !== null, 'la construction aurait dû être refusée')
      assert.match(message!, new RegExp(`« ${nom} » ne peut pas être le nom d'une variable`), message!)
      assert.match(message!, new RegExp(`essai\\.mjs:${PREMIERE + ligne}:${colonne === undefined ? '\\d+' : colonne + 2}\\b`), message!)
    })
  }

  for (const code of ACCEPTES) {
    it(`accepte ${JSON.stringify(code)}`, async () => {
      assert.equal(await erreurDe(composant(code)), null)
    })
  }

  for (const code of NON_REFUSES) {
    it(`ne refuse pas le nom dans ${JSON.stringify(code)}`, async () => {
      const message = await erreurDe(composant(code))
      assert.ok(!/ne peut pas être le nom d'une variable/.test(message ?? ''), message ?? '')
    })
  }

  // Civet refuse déjà lui-même : son erreur reste, à la même ligne
  for (const code of ['await = 1', 'let = 1', 'static := 1', '{static} = o', '{public} = o']) {
    it(`laisse à Civet son propre refus de ${JSON.stringify(code)}`, async () => {
      const message = await erreurDe(composant(code))
      assert.ok(message !== null, 'la construction aurait dû être refusée')
      assert.match(message!, new RegExp(`essai\\.mjs:${PREMIERE}:\\d+ Failed to parse`), message!)
    })
  }

  it('accepte le mot en clé de <vars> et en argument nommé du gabarit', async () => {
    const source = '<vars>\n  $undefined  int 0..10\n</vars>\n<script>\n  $undefined = 1\n  g = (opts) -> opts\n</script>\n<p>{$undefined} {g(let: 1, await: 2, eval: 3).let}</p>\n'
    assert.equal(await erreurDe(source), null)
  })

  it('refuse aussi dans le <script module>, à sa ligne', async () => {
    const message = await erreurDe('<script module>\n  a = 1\n  NaN = 2\n</script>\n<script>\n  x = a\n</script>\n<p>{x}</p>\n')
    assert.ok(message !== null, 'la construction aurait dû être refusée')
    assert.match(message!, /« NaN » ne peut pas être le nom d'une variable/, message!)
    assert.match(message!, /essai\.mjs:3:\d+/, message!)
  })

  // la directive `@import default X` devient `import X from …` : Civet y range l'identifiant seul, sans liste
  it("accepte l'import par défaut d'un composant (@import default)", async () => {
    assert.equal(await erreurDe("@import default Carte 'shared/carte.mjs'\n<script>\n  x = Carte\n</script>\n<p>{x}</p>\n"), null)
  })

  it("refuse un nom interdit dans l'import par défaut d'un composant (@import default)", async () => {
    const message = await erreurDe("@import default NaN 'shared/carte.mjs'\n<script>\n  x = 1\n</script>\n<p>{x}</p>\n")
    assert.ok(message !== null, 'la construction aurait dû être refusée')
    assert.match(message!, /« NaN » ne peut pas être le nom d'une variable/, message!)
  })

  it('accepte un champ de classe dans le <script module>', async () => {
    assert.equal(await erreurDe('<script module>\n  class A\n    NaN = 1\n</script>\n<script>\n  x = 1\n</script>\n<p>{x}</p>\n'), null)
  })

  // un champ de classe est une propriété : la passe de déclaration de ModularJS ne le déclare pas comme variable du script
  it('ne déclare pas un champ de classe comme variable du script', async () => {
    const { output } = await transpile(composant('class A\n  NaN = 1\n  console = 2\nx = NaN'), { moduleName: 'essai' })
    assert.doesNotMatch(output, /\blet (?:NaN|console)\b/, output)
    assert.equal(await erreurDe(composant('class A\n  eval = 1')), null)
  })

  it('cite la ligne et la colonne de la directive @import dans le fichier', async () => {
    const cas: [string, string][] = [
      ["<!--\n  note\n-->\n@import NaN 'lib/a.civet.mjs'\n<script>\n  x = 1\n</script>\n<p>{x}</p>\n", ':4:9'],
      ["@import default undefined 'x.mjs'\n<script>\n  x = 1\n</script>\n<p>{x}</p>\n", ':1:17'],
      ["<script>\n  x = 1\n  @import eval 'node:fs'\n</script>\n<p>{x}</p>\n", ':3:11'],
    ]
    for (const [source, position] of cas) {
      const message = await erreurDe(source)
      assert.ok(message !== null, 'la construction aurait dû être refusée')
      assert.ok(message!.includes(`essai.mjs${position}`), message!)
    }
  })

  // l'import du <script module> est lu par Civet : le contrôle le voit, et ne regarde que le nom qu'il lie
  it("refuse le nom lié par un import renommé, jamais le nom importé", async () => {
    const module = (ligne: string) => `<script module>\n  ${ligne}\n</script>\n<script>\n  x = 1\n</script>\n<p>{x}</p>\n`
    const lie    = await erreurDe(module("import { e as eval } from 'x'"))
    assert.ok(lie !== null && /« eval » ne peut pas être le nom d'une variable/.test(lie), lie ?? 'accepté')
    assert.match(lie!, /essai\.mjs:2:/, lie!)
    for (const importe of ['eval', 'default', 'NaN']) {
      const message = await erreurDe(module(`import { ${importe} as e } from 'x'`))
      assert.doesNotMatch(message ?? '', /ne peut pas être le nom d'une variable/, message ?? '')
    }
  })

  it('dit le mot et la ligne en anglais aussi', async () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      const message = await erreurDe(composant('eval = 1'))
      assert.ok(message !== null, 'la construction aurait dû être refusée')
      assert.match(message!, /"eval" cannot be the name of a variable/, message!)
      assert.match(message!, new RegExp(`essai\\.mjs:${PREMIERE}:\\d+`), message!)
    }
    finally {
      setMessagesLang(avant)
    }
  })
})
