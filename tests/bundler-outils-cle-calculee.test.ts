// aucun module d'effet, d'outil ni de transition n'accède à `µ` par une clé calculée : `µ[n]`, `µ['_mjs_' + n]`, `µ[prefixe + 'fxBox']`,
// `µ[['_mjs_', 'fxBox'].join('')]`. Le nom d'un outil se lit dans le texte des modules (bundler/fx-tools.ts, la détection, le témoin, la
// réduction du build) : un nom bâti à l'exécution n'est écrit nulle part, l'outil qu'il désigne ne serait ni vu ni embarqué — « is not a function »
// en production, build vert. Seule une clé écrite telle quelle (une chaîne, un gabarit sans expression) se lit. Un autre nom donné à `µ`
// (`var m = µ; m[k]`) ouvre la même porte par un détour : il est refusé aussi, dans les mêmes modules. Ces modules sont tout le runtime, hors
// le fichier qui construit `µ` (il pose ses propriétés par clé calculée : c'est son travail).

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

// `µ` sous des parenthèses, une assertion de type ou un point d'exclamation : `(µ)`, `(µ as any)`, `<any>µ`, `µ!`
function estMu(n: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n)) return estMu(n.expression)
  return ts.isIdentifier(n) && n.text === 'µ'
}

// les accès à `µ[clé]` dont la clé n'est pas une chaîne écrite telle quelle (`'x'`, `"x"`, `` `x` `` sans expression) : [la ligne, l'accès]
function clesCalculees(nom: string, texte: string): Array<[number, string]> {
  const source = ts.createSourceFile(nom, texte, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const trouvees: Array<[number, string]> = []
  const visite = (n: ts.Node): void => {
    const acces      = ts.isElementAccessExpression(n) && estMu(n.expression) && !ts.isStringLiteralLike(n.argumentExpression)
    const destructure = ts.isVariableDeclaration(n) && n.initializer && estMu(n.initializer) && ts.isObjectBindingPattern(n.name) && n.name.elements.some((e) => e.propertyName && ts.isComputedPropertyName(e.propertyName))
    if (acces || destructure) trouvees.push([source.getLineAndCharacterOfPosition(n.getStart()).line + 1, n.getText(source).slice(0, 70)])
    ts.forEachChild(n, visite)
  }
  visite(source)
  return trouvees
}

// ce qui prête à `µ` un autre nom : `var m = µ`, `m = µ`, un paramètre qui vaut `µ` par défaut, `{ m: µ }` ou `{ µ }` ; [la ligne, l'écriture]
function aliasesDeMu(nom: string, texte: string): Array<[number, string]> {
  const source = ts.createSourceFile(nom, texte, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const trouves: Array<[number, string]> = []
  const visite = (n: ts.Node): void => {
    const alias = (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && estMu(n.initializer))
      || (ts.isParameter(n) && n.initializer && estMu(n.initializer))
      || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && estMu(n.right))
      || (ts.isPropertyAssignment(n) && estMu(n.initializer))
      || (ts.isShorthandPropertyAssignment(n) && n.name.text === 'µ')
    if (alias) trouves.push([source.getLineAndCharacterOfPosition(n.getStart()).line + 1, n.getText(source).slice(0, 70)])
    ts.forEachChild(n, visite)
  }
  visite(source)
  return trouves
}

// le fichier qui construit µ : sa propriété par clé calculée (`µ[c[0]]`), un alias (`mu = µ`)
const CONSTRUCTEURS = ['mjs_init.ts']

// tout le runtime — modules d'effets (`mjs_fx_<nom>.ts`), d'outils (`mjs_fx_tool<nom>.ts`), moteur (`mjs_fx.ts`), transitions (`animations/`), courbes
// (`mjs_easing.ts`)… — sauf celui qui construit µ : un outil peut être appelé de n'importe lequel
function modules(): string[] {
  return readdirSync(RUNTIME, { recursive: true }).map(String).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !CONSTRUCTEURS.includes(f))
}

describe('modules d\'effets et d\'outils — aucun accès à µ par une clé calculée', () => {
  it('le détecteur voit toute clé calculée, quelle que soit l\'écriture, et laisse passer une clé écrite telle quelle', () => {
    const calculees = [
      'µ[n]', 'µ[\'_mjs_\' + n]', 'µ[\'_mjs\' + \'_fxBox\']', 'µ[prefixe + \'fxBox\']', 'µ[[\'_mjs_\', \'fxBox\'].join(\'\')]', 'µ[`_mjs_fx${n}`]',
      'µ[nom()]', 'var { [k]: f } = µ;', '(µ)[n]', '(µ as any)[n]', 'µ![n]', '<any>µ[n]', 'µ?.[n]', 'µ[0]', 'µ[a ? \'x\' : \'y\']', 'var f = µ[n]; f(el);', 'µ[k](el);'
    ]
    for (const code of calculees) assert.equal(clesCalculees('t.ts', code).length, 1, code)
    const ecrites = ['µ[\'_mjs_fxBox\'](el);', 'µ["_mjs_fxBox"](el);', 'µ[`_mjs_fxBox`](el);', 'µ._mjs_fxBox(el);', 'var { _mjs_fxBox } = µ;', 'liste[n];', 'µ.instances[n];', 'autre[\'µ\'][n];', '// µ[n]\nvar x = 1;', 'var s = \'µ[n]\';']
    for (const code of ecrites) assert.deepEqual(clesCalculees('t.ts', code), [], code)
    // la ligne et l'accès sont rendus
    assert.deepEqual(clesCalculees('t.ts', 'var a = 1;\nvar b = µ[prefixe + k];\n'), [[2, 'µ[prefixe + k]']])
  })

  it('le détecteur d\'alias voit tout autre nom donné à µ, et laisse passer un µ qui n\'est que lu', () => {
    const aliases = [
      'var _m = µ; _m[k](el);', 'const m = µ;', 'let m; m = µ;', 'function f(m = µ) { return m[k]; }', 'var m = (µ as any);', 'var m = µ!;', 'var m = <any>µ;',
      'var o = { m: µ };', 'var o = { µ };', 'var m = ((µ));'
    ]
    for (const code of aliases) assert.equal(aliasesDeMu('t.ts', code).length, 1, code)
    const lus = ['µ._mjs_fxBox(el);', 'var f = µ._mjs_fxBox;', 'var { _mjs_fxBox } = µ;', 'f(µ);', 'if (µ.instances) x = 1;', 'var s = \'var m = µ\';', '// var m = µ\nvar x = 1;', 'var m = autre;']
    for (const code of lus) assert.deepEqual(aliasesDeMu('t.ts', code), [], code)
    assert.deepEqual(aliasesDeMu('t.ts', 'var a = 1;\nvar _m = µ;\n'), [[2, '_m = µ']])
  })

  it('aucun module du dépôt n\'en écrit une : la liste est vide', function () {
    this.timeout(120000)
    const lus = modules()
    // la garde ne doit pas dormir : le banc a bien lu les modules d'effets, d'outils et de transitions
    assert.ok(lus.length > 100, 'modules lus : ' + lus.length)
    assert.ok(lus.some((f) => /^mjs_fx_tool/.test(f)) && lus.some((f) => /^mjs_fx_tilt\.ts$/.test(f)) && lus.some((f) => f.startsWith('animations')) && lus.includes('mjs_easing.ts'), 'outils, effets, transitions et courbes lus')
    const fautes: string[] = []
    for (const f of lus) {
      const texte = readFileSync(join(RUNTIME, f), 'utf-8')
      for (const [ligne, acces] of clesCalculees(f, texte)) fautes.push(f + ':' + ligne + ' `' + acces + '` bâtit à l\'exécution le nom qu\'il lit sur µ : l\'outil ne serait pas reconnu')
      for (const [ligne, ecrit] of aliasesDeMu(f, texte)) fautes.push(f + ':' + ligne + ' `' + ecrit + '` donne un autre nom à µ : une clé calculée sur ce nom échapperait à la détection des outils')
    }
    assert.deepEqual(fautes, [])
  })

  it('le fichier qui construit µ a encore une raison d\'être excepté', () => {
    for (const f of CONSTRUCTEURS) {
      const texte = readFileSync(join(RUNTIME, f), 'utf-8')
      assert.ok(clesCalculees(f, texte).length + aliasesDeMu(f, texte).length > 0, f + ' n\'a plus ni clé calculée ni alias de µ : il ne doit plus être excepté')
    }
  })
})
