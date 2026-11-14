// UNE AFFECTATION DONT LA VALEUR COMMENCE À LA LIGNE SUIVANTE DÉCLARE SON NOM COMME LA FORME SUR UNE LIGNE.
//
// `o =` suivi de la valeur, plus indentée, à la ligne d'après (objet sur plusieurs lignes, appel long) n'était pas déclaré :
// la construction refusait le composant (« nom jamais déclaré ») ou l'exécution cassait (« o is not defined »). Le nom est lu
// dans l'arbre de Civet, qui note sur chaque affectation les noms qu'elle lie, jamais dans le texte : une chaîne sur plusieurs
// lignes, un commentaire, un champ de classe ne déclarent rien. Un nom déjà déclaré là où se trouve l'affectation (dans son
// bloc, sa fonction ou au-dessus : paramètre, `catch`, variable du `<script module>`) n'est pas redéclaré ; un nom lié dans un
// bloc (`for x in`, `catch e`, `if x := …`, motif d'un `switch`) ne l'est plus après ce bloc, comme le lit Civet. Une
// affectation dans une expression (`String(o = 1)`) déclare son nom, comme Civet seul avec `autoVar` ou `autoLet`. Une
// déclaration écrite à la main (`x .= undefined`) n'est jamais retirée, et un champ de classe n'est jamais déclaré comme variable.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { compileServerFile } from '../src/cli/server-entry.js'

const enLigne = (js: string) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')

// valeur rendue par `f()` d'un fichier serveur, ou le message de l'erreur
let dossier = ''
let numero  = 0
const valeurDe = async (src: string): Promise<string> => {
  try {
    const fichier = join(dossier, `essai-${numero++}.server.mjs`)
    writeFileSync(fichier, src)
    const r   = await compileServerFile(fichier, dossier)
    const mod = await import((r.startsWith('file:') ? r : enLigne(r)) + '#' + numero)
    return JSON.stringify(await mod.f())
  }
  catch (e: any) {
    return 'erreur : ' + String(e?.message ?? e).split('\n')[0]
  }
}

// nom, valeur à la ligne suivante, même code sur une ligne, valeur attendue
const CAS: [string, string, string, string][] = [
  ['dans une fonction', 'export f = ->\n  o =\n    v: 1\n  o.v\n', 'export f = ->\n  o = {v: 1}\n  o.v\n', '1'],
  ['au premier niveau', 'o =\n  v: 2\nexport f = -> o.v\n', 'o = {v: 2}\nexport f = -> o.v\n', '2'],
  ['motif objet', 'export f = ->\n  {a, b} =\n    a: 1\n    b: 2\n  a + b\n', 'export f = ->\n  {a, b} = {a: 1, b: 2}\n  a + b\n', '3'],
  ['motif tableau', 'export f = ->\n  [a, b] =\n    [1, 2]\n  a + b\n', 'export f = ->\n  [a, b] = [1, 2]\n  a + b\n', '3'],
  ['deux branches', 'export f = (x) ->\n  if x\n    o =\n      v: 1\n  else\n    o =\n      v: 2\n  o.v\n', 'export f = (x) ->\n  if x\n    o = {v: 1}\n  else\n    o = {v: 2}\n  o.v\n', '2'],
  ['variable du dessus', 'export f = ->\n  o = {v: 0}\n  g = ->\n    o =\n      v: 5\n  g()\n  o.v\n', 'export f = ->\n  o = {v: 0}\n  g = ->\n    o = {v: 5}\n  g()\n  o.v\n', '5'],
  ['paramètre', 'export f = (o) ->\n  o =\n    v: 3\n  o.v\n', 'export f = (o) ->\n  o = {v: 3}\n  o.v\n', '3'],
  ['variable du catch', 'export f = ->\n  try\n    throw 1\n  catch e\n    e =\n      v: 4\n    e.v\n', 'export f = ->\n  try\n    throw 1\n  catch e\n    e = {v: 4}\n    e.v\n', '4'],
  ['motif dont un nom existe', 'export f = ->\n  a = 1\n  [a, b] =\n    [2, 3]\n  a + b\n', 'export f = ->\n  a = 1\n  [a, b] = [2, 3]\n  a + b\n', '5'],
  ['motif avec un membre', 'export f = ->\n  o = {}\n  [o.x, b] =\n    [1, 2]\n  o.x + b\n', 'export f = ->\n  o = {}\n  [o.x, b] = [1, 2]\n  o.x + b\n', '3'],
  ['affectation enchaînée', 'export f = ->\n  a = b =\n    v: 7\n  a.v + b.v\n', 'export f = ->\n  a = b = {v: 7}\n  a.v + b.v\n', '14'],
  // un nom lié dans un bloc n'existe plus après ce bloc : l'affectation qui suit le déclare
  ['après la variable d\'une boucle', 'export f = ->\n  for x in [1, 2]\n    null\n  x =\n    v: 3\n  x.v\n', 'export f = ->\n  for x in [1, 2]\n    null\n  x = {v: 3}\n  x.v\n', '3'],
  ['après la variable d\'un catch', 'export f = ->\n  try\n    throw 1\n  catch e\n    null\n  e =\n    v: 4\n  e.v\n', 'export f = ->\n  try\n    throw 1\n  catch e\n    null\n  e = {v: 4}\n  e.v\n', '4'],
  ['après un if qui déclare', 'export f = ->\n  if x := 1\n    null\n  x =\n    v: 3\n  x.v\n', 'export f = ->\n  if x := 1\n    null\n  x = {v: 3}\n  x.v\n', '3'],
  ['après un while qui déclare', 'export f = ->\n  while x := null\n    null\n  x =\n    v: 3\n  x.v\n', 'export f = ->\n  while x := null\n    null\n  x = {v: 3}\n  x.v\n', '3'],
  ['après le motif d\'un switch', 'export f = (o = {}) ->\n  switch o\n    {x}\n      null\n  x =\n    v: 3\n  x.v\n', 'export f = (o = {}) ->\n  switch o\n    {x}\n      null\n  x = {v: 3}\n  x.v\n', '3'],
  ['après une classe déclarée dans un bloc', 'export f = ->\n  if true\n    class x\n  x =\n    v: 3\n  x.v\n', 'export f = ->\n  if true\n    class x\n  x = {v: 3}\n  x.v\n', '3'],
  ['après une fonction déclarée dans un bloc', 'export f = ->\n  if true\n    function x() { 1 }\n  x =\n    v: 3\n  x.v\n', 'export f = ->\n  if true\n    function x() { 1 }\n  x = {v: 3}\n  x.v\n', '3'],
  ['au premier niveau, après une boucle', 'for x in [1, 2]\n  null\nx =\n  v: 3\nexport f = -> x.v\n', 'for x in [1, 2]\n  null\nx = {v: 3}\nexport f = -> x.v\n', '3'],
  ['au premier niveau, après un catch', 'try\n  throw 1\ncatch e\n  null\ne =\n  v: 4\nexport f = -> e.v\n', 'try\n  throw 1\ncatch e\n  null\ne = {v: 4}\nexport f = -> e.v\n', '4'],
]

// déclaration écrite à la main, valeur attendue : jamais retirée, même quand ModularJS pose ailleurs une déclaration du même nom
const BRANCHES = 'h = (a) ->\n  if a\n    x = 1\n  else\n    x = 2\n  x\n'
const ECRITES: [string, string, string][] = [
  ['à côté d\'une variable du même nom déclarée par ModularJS', BRANCHES + 'g = ->\n  x .= undefined\n  x ?? "vide"\nexport f = -> g()\n', '"vide"'],
  ['à côté d\'un champ de classe du même nom', 'class A\n  x = 1\ng = ->\n  x .= undefined\n  x ?? "vide"\nexport f = -> g()\n', '"vide"'],
  ['au premier niveau, après un champ de classe du même nom', 'class A\n  x = 1\nx .= undefined\nexport f = -> x ?? "vide"\n', '"vide"'],
  ['lue par une fonction intérieure', BRANCHES + 'g = ->\n  x .= undefined\n  lire = -> x\n  lire()\nexport f = -> String(g())\n', '"undefined"'],
]

describe('affectation dont la valeur commence à la ligne suivante', () => {
  before(() => { dossier = mkdtempSync(join(tmpdir(), 'mjs-valeur-dessous-')) })
  after(() => { rmSync(dossier, { recursive: true, force: true }) })

  for (const [nom, deuxLignes, uneLigne, attendu] of CAS) {
    it(`${nom} : même résultat que sur une ligne`, async () => {
      assert.equal(await valeurDe(uneLigne), attendu, 'forme sur une ligne')
      assert.equal(await valeurDe(deuxLignes), attendu, 'valeur à la ligne suivante')
    })
  }

  // `var` vaut pour toute la fonction, même écrit dans un bloc : jamais redéclaré après ce bloc
  it('ne redéclare pas une variable `var` écrite dans un bloc', async () => {
    assert.equal(await valeurDe('export f = ->\n  if true\n    var x = 1\n  x =\n    v: 3\n  x.v\n'), '3')
  })

  for (const [nom, src, attendu] of ECRITES) {
    it(`garde la déclaration écrite à la main ${nom}`, async () => {
      assert.equal(await valeurDe(src), attendu)
    })
  }

  it('garde la déclaration écrite à la main dans le <script> d\'un composant', async () => {
    const { output } = await transpile("<script>\n  class Carte\n    name = 'x'\n  vide = ->\n    name .= undefined\n    name ?? 'sans nom'\n</script>\n<p>[{vide()}]</p>\n", { moduleName: 'essai' })
    assert.equal(output.match(/\blet name = undefined\b/g)?.length, 1, output)
    assert.match(output, /function\(\) \{\s*let name = undefined/, output)
  })

  it('garde la déclaration écrite à la main dans le <script module>', async () => {
    const { output } = await transpile("<script module>\nh = (a) ->\n  if a\n    x = 1\n  else\n    x = 2\n  x\ng = ->\n  x .= undefined\n  x ?? 'vide'\n</script>\n<script>\ny = g()\n</script>\n<p>{y}</p>\n", { moduleName: 'essai' })
    assert.equal(output.match(/\blet x = undefined\b/g)?.length, 2, output)
  })

  // Civet seul (`"civet autoVar"`, `"civet autoLet"`) déclare aussi le nom affecté dans une expression
  it('déclare le nom affecté dans une expression, comme Civet', async () => {
    assert.equal(await valeurDe('export f = ->\n  String(o = 1)\n  o\n'), '1')
    assert.equal(await valeurDe('export f = (s = "ab") ->\n  if m = /a(b)/.exec(s)\n    m[1]\n'), '"b"')
    assert.equal(await valeurDe('String(o = 1)\nexport f = -> o\n'), '1')
  })

  it('ne touche ni une chaîne sur plusieurs lignes ni un champ de classe', async () => {
    assert.equal(await valeurDe("export f = ->\n  s = 'x\n  b =\n    y'\n  s\n"), JSON.stringify('x\n  b =\n    y'))
    assert.equal(await valeurDe('class A\n  console =\n    niveau: 1\nexport f = -> [typeof console.log, new A().console.niveau]\n'), JSON.stringify(['function', 1]))
  })

  // le champ de classe sur une ligne : la passe de déclaration de ModularJS le voyait comme une variable
  it('ne déclare pas un champ de classe comme variable', async () => {
    assert.equal(await valeurDe('class A\n  NaN = 1\n  console = 2\nexport f = -> [Number.isNaN(NaN), typeof console.log, new A().NaN]\n'), JSON.stringify([true, 'function', 1]))
    assert.equal(await valeurDe('export f = ->\n  class A\n    eval = 1\n    x = NaN\n  [new A().eval, Number.isNaN(new A().x)]\n'), JSON.stringify([1, true]))
  })

  it('ne déclare pas un champ de classe dans le <script> d\'un composant', async () => {
    const { output } = await transpile('<script>\n  class A\n    x = NaN\n    m = -> 1\n  f = -> Number.isNaN(new A().x)\n</script>\n<p>{f()}</p>\n', { moduleName: 'essai' })
    assert.doesNotMatch(output, /\blet (?:x|m)\b/, output)
  })

  it('déclare au premier niveau du <script> d\'un composant', async () => {
    const { output } = await transpile('<script>\no =\n  v: 1\n</script>\n<div>{o.v}</div>\n', { moduleName: 'essai' })
    assert.match(output, /\blet o =/)
  })

  it('déclare dans une fonction du <script> d\'un composant', async () => {
    const { output } = await transpile('<script>\nlire = ->\n  o =\n    v: 1\n  o.v\n</script>\n<div>{lire()}</div>\n', { moduleName: 'essai' })
    assert.match(output, /\blet o =/)
  })

  it('déclare au premier niveau du <script module>', async () => {
    const { output } = await transpile('<script module>\no =\n  v: 1\n</script>\n<script>\nlire = -> o.v\n</script>\n<div>{lire()}</div>\n', { moduleName: 'essai' })
    assert.match(output, /\blet o =/)
  })

  it('ne redéclare pas dans le <script> une variable du <script module>', async () => {
    const { output } = await transpile('<script module>\no .= null\n</script>\n<script>\nmettre = ->\n  o =\n    v: 1\n</script>\n<div>{mettre()}</div>\n', { moduleName: 'essai' })
    assert.equal(output.match(/\blet o\b/g)?.length, 1, output)
  })
})
