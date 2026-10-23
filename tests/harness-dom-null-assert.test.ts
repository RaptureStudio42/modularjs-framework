// garde du HARNAIS, pas du produit : interdit le retour du motif qui a mis la machine
// à genoux — `assert.equal(<nœud DOM>, null, …)`. Tant qu'une telle assertion passe, elle est
// inoffensive ; le jour où elle échoue — donc le jour où elle attrape enfin une régression — elle
// demande à node:assert de sérialiser tout le graphe happy-dom pour fabriquer son message : 14 Go
// en deux secondes, run tué par le noyau. Le remplaçant est `assertAbsent()`
// (tests/helpers/dom-assert.ts) : même fait vérifié, message court, aucune inspection profonde.
// Pour comparer à undefined ou à un autre nœud : `assert.ok(a === b, 'message')`, le nœud ne va
// alors jamais à assert.
// Ce fichier est la mémoire du dépôt — un nouveau site du motif fait rougir la suite AVANT d'avoir
// eu l'occasion d'exploser. La détection lit les SOURCES (jamais d'exécution) avec l'analyseur de
// TypeScript : un appel étalé sur plusieurs lignes est vu, un commentaire, une chaîne ou un
// littéral regex ne faussent rien, et le code sans point-virgule ne fabrique pas de faux couple avec
// l'assertion suivante. Les deux ORDRES d'arguments sont surveillés — `equal(nœud, null)` comme
// `equal(null, nœud)`, c'est la même bombe.
// Est un nœud : un accès DOM (querySelector, firstChild…) ; une variable locale qui en reçoit un, à sa
// déclaration ou après ; l'appel d'une fonction locale qui en rend un (flèche ou function, par
// return) ; le tout derrière des parenthèses, un cast ou un `!`. Un nœud comparé à null, à undefined
// ou à toute valeur qui n'est pas un littéral (si l'assertion passe, c'est le même nœud) fait un site ;
// un texte, un compte ou un attribut lu sur un nœud n'en fait pas.
// Limite connue : un nœud venu d'un paramètre, d'un champ d'objet ou d'un import n'est pas suivi.
// Les premiers tests prouvent que la garde attrape bien ce qu'elle prétend attraper : une garde
// jamais éprouvée ne garde rien.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const EXEMPT = new Set(['harness-dom-null-assert.test.ts', 'dom-assert.ts'])  //la garde et son remplaçant se citent forcément
const SKIP_DIRS = new Set(['node_modules', 'fixtures', 'snapshots'])

// accès qui RENDENT un nœud DOM — les seuls dangereux (getAttribute rend une chaîne : sans risque)
const ACCESS = /(querySelector|getElementById|getElementsBy|firstChild|lastChild|firstElementChild|lastElementChild|next(?:Element)?Sibling|previous(?:Element)?Sibling|parentNode|parentElement|offsetParent|closest|activeElement|shadowRoot|assignedSlot|elementFromPoint)/
const NOEUD = new RegExp('^'+ ACCESS.source +'\\w*$')  //le nom ENTIER d'un accès : querySelectorAll, getElementsByTagName…
const EGALITES = new Set(['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual'])  //échouent quand les deux côtés diffèrent
const INEGALITES = new Set(['notEqual', 'notStrictEqual', 'notDeepEqual', 'notDeepStrictEqual'])  //échouent quand les deux côtés sont les mêmes
const CONSERVE = new Set(['find', 'findLast', 'filter', 'at', 'item', 'pop', 'shift', 'slice'])  //appelés sur des nœuds, ils rendent des nœuds

type Memo = Map<ts.Node, boolean>  //ce qu'on a déjà décidé d'une variable ou d'une fonction (et garde contre les cycles)

// l'expression sans ses habits : parenthèses, casts (`as T`, `<T>x`, `satisfies T`), `!` final, `await`
function nue(e: ts.Expression): ts.Expression {
  while(ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) e = e.expression
  return e
}

// null, undefined ou `void 0`, sous n'importe quels habits
function estVide(e: ts.Expression): boolean {
  const x = nue(e)
  return x.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(x) || (ts.isIdentifier(x) && x.text === 'undefined')
}

// ce motif de déclaration (`n`, `{ n }`, `[n]`) lie-t-il ce nom ?
function lie(motif: ts.BindingName, nom: string): boolean {
  if(ts.isIdentifier(motif)) return motif.text === nom
  return motif.elements.some((e) => !ts.isOmittedExpression(e) && lie(e.name, nom))
}

// la déclaration que l'identifiant désigne : la plus proche en remontant les portées (paramètre, variable, fonction)
function declaration(id: ts.Identifier): ts.Node | undefined {
  for(let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if(ts.isFunctionLike(n)) {
      const param = n.parameters.find((p) => lie(p.name, id.text))
      if(param) return param
    }
    if(!ts.isBlock(n) && !ts.isSourceFile(n) && !ts.isCaseClause(n) && !ts.isDefaultClause(n)) continue
    for(const s of n.statements) {
      if(ts.isFunctionDeclaration(s) && s.name?.text === id.text) return s
      const d = ts.isVariableStatement(s) ? s.declarationList.declarations.find((v) => lie(v.name, id.text)) : undefined
      if(d) return d
    }
  }
  return undefined
}

// ce qu'un `let` ou un `var` reçoit après sa déclaration (`n = …`), dans sa portée
function affectations(d: ts.VariableDeclaration): ts.Expression[] {
  const liste = d.parent
  if(!ts.isVariableDeclarationList(liste) || (liste.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(liste.parent) || !ts.isIdentifier(d.name)) return []
  const out: ts.Expression[] = []
  const visite = (n: ts.Node) => {
    if(ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === (d.name as ts.Identifier).text) out.push(n.right)
    ts.forEachChild(n, visite)
  }
  visite(liste.parent.parent)
  return out
}

// la variable désignée par l'identifiant reçoit-elle un nœud ?
function variable(id: ts.Identifier, memo: Memo): boolean {
  const d = declaration(id)
  if(!d || !ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name)) return false
  if(memo.has(d)) return memo.get(d)
  memo.set(d, false)
  const oui = (d.initializer ? [d.initializer] : []).concat(affectations(d)).some((v) => noeud(v, memo))
  memo.set(d, oui)
  return oui
}

// la fonction rend-elle un nœud ? corps-expression, ou un `return` à elle (les fonctions imbriquées ne comptent pas)
function rend(f: ts.FunctionLikeDeclaration, memo: Memo): boolean {
  if(memo.has(f)) return memo.get(f)
  memo.set(f, false)
  let oui = false
  const visite = (n: ts.Node) => {
    if(oui || (n !== f && ts.isFunctionLike(n))) return
    if(ts.isReturnStatement(n)) oui = !!n.expression && noeud(n.expression, memo)
    else ts.forEachChild(n, visite)
  }
  if(f.body && !ts.isBlock(f.body)) oui = noeud(f.body, memo)
  else if(f.body) visite(f.body)
  memo.set(f, oui)
  return oui
}

// l'appel rend-il un nœud ? un accès (`el.querySelector(…)`), un tri de nœuds (`nœuds.find(…)`,
// `Array.from(nœuds)`) ou une fonction locale qui en rend un
function appel(e: ts.CallExpression, memo: Memo): boolean {
  const f = nue(e.expression)
  if(ts.isPropertyAccessExpression(f)) {
    if(NOEUD.test(f.name.text)) return true
    if(CONSERVE.has(f.name.text)) return noeud(f.expression, memo)
    return f.name.text === 'from' && ts.isIdentifier(f.expression) && f.expression.text === 'Array' && e.arguments.some((a) => noeud(a, memo))
  }
  if(ts.isArrowFunction(f) || ts.isFunctionExpression(f)) return rend(f, memo)
  const d = ts.isIdentifier(f) ? declaration(f) : undefined
  if(!d) return false
  if(ts.isFunctionDeclaration(d)) return rend(d, memo)
  const init = ts.isVariableDeclaration(d) && d.initializer ? nue(d.initializer) : undefined
  return !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && rend(init, memo)
}

// l'expression est-elle un nœud DOM (ou des nœuds) ? lue sur la fin de la chaîne : `el.querySelector('x')`
// est un nœud, `el.querySelector('x').textContent` est un texte
function noeud(e0: ts.Expression, memo: Memo): boolean {
  const e = nue(e0)
  if(ts.isIdentifier(e)) return variable(e, memo)
  if(ts.isPropertyAccessExpression(e)) return NOEUD.test(e.name.text)
  if(ts.isElementAccessExpression(e)) return noeud(e.expression, memo)
  if(ts.isConditionalExpression(e)) return noeud(e.whenTrue, memo) || noeud(e.whenFalse, memo)
  if(ts.isArrayLiteralExpression(e)) return e.elements.some((x) => noeud(ts.isSpreadElement(x) ? x.expression : x, memo))
  if(ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind
    return (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.QuestionQuestionToken) && (noeud(e.left, memo) || noeud(e.right, memo))
  }
  return ts.isCallExpression(e) && appel(e, memo)
}

// une valeur qui ne peut jamais être un nœud : chaîne, nombre, booléen, regex
function litteral(e: ts.Expression): boolean {
  const x = nue(e)
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isTemplateExpression(x) || ts.isNumericLiteral(x) || ts.isBigIntLiteral(x) || ts.isRegularExpressionLiteral(x) || x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || (ts.isPrefixUnaryExpression(x) && ts.isNumericLiteral(x.operand))
}

// l'appel est-il une assertion qui, en échouant, fabriquerait son message avec un nœud vivant ?
function estSite(c: ts.CallExpression, sf: ts.SourceFile, memo: Memo): boolean {
  const f = c.expression
  if(!ts.isPropertyAccessExpression(f) || !/[Aa]ssert/.test(f.expression.getText(sf))) return false
  const negatif = INEGALITES.has(f.name.text)
  if(!negatif && !EGALITES.has(f.name.text)) return false
  const [a, b] = c.arguments
  if(!a || !b) return false
  // un nœud contre autre chose qu'un littéral (null, undefined, un autre nœud, une valeur inconnue) : si l'assertion passe,
  // c'est que l'autre côté est le même nœud ; notEqual contre null ou undefined échoue sur eux : sans danger
  const contre = (x: ts.Expression, y: ts.Expression) => noeud(x, memo) && !litteral(y) && (!negatif || !estVide(y))
  if(contre(a, b) || contre(b, a)) return true
  // contre null, un accès DOM n'importe où dans l'argument suffit (prudence héritée)
  const nul = (x: ts.Expression) => nue(x).kind === ts.SyntaxKind.NullKeyword
  return !negatif && ((nul(b) && ACCESS.test(a.getText(sf))) || (nul(a) && ACCESS.test(b.getText(sf))))
}

// numéros de ligne des sites du motif dans une source
export function scan(src: string): number[] {
  const sf = ts.createSourceFile('source.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const memo: Memo = new Map()
  const out: number[] = []
  const visite = (n: ts.Node) => {
    if(ts.isCallExpression(n) && estSite(n, sf, memo)) out.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1)
    ts.forEachChild(n, visite)
  }
  visite(sf)
  return out
}

describe('harnais — aucune assertion ne compare un nœud DOM à null', function () {
  it('la garde attrape le motif, et lui seul', () => {
    assert.deepEqual(scan("assert.equal(el.querySelector('style'), null, 'aucun <style>')"), [1], 'le motif nu doit être vu')
    assert.deepEqual(scan("nodeAssert.equal(win.document.getElementById('x'), null)\n"), [1], 'sans message, et sous un autre nom, aussi')
    assert.deepEqual(scan("assert.equal(null, el.querySelector('style'), 'msg')"), [1], 'arguments INVERSÉS : la même bombe')
    assert.deepEqual(scan("const a = 1\nassert.equal(\n  box.closest('form'),\n  null\n)"), [2], 'un appel étalé sur plusieurs lignes doit être vu')
    assert.deepEqual(scan("assert.equal(\n  // n'oublie pas le cas limite, dit-il\n  box.nextElementSibling,\n  null\n)"), [1], 'un commentaire français au milieu de l\'appel ne doit rien fausser')
    assert.deepEqual(scan("assert.equal(/* on n'y touche pas, jamais */ box.assignedSlot, null)"), [1], 'commentaire de bloc idem')
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), null, String(/l'ancre/))"), [1], 'un littéral regex dans le message ne doit rien fausser')
    assert.deepEqual(scan("assert.equal(box.querySelectorAll('b').length / 2, null)"), [1], 'une division ne doit pas être prise pour une regex')
    assert.deepEqual(scan("assert.equal(el.querySelectorAll('style').length, 0)"), [], 'compter les nœuds est le bon idiome')
    assert.deepEqual(scan("assert.notEqual(el.querySelector('style'), null)"), [], 'notEqual n\'échoue que sur null : sans danger')
    assert.deepEqual(scan("assertAbsent(el.querySelector('style'), 'aucun <style>')"), [], 'le remplaçant ne doit pas être signalé')
    assert.deepEqual(scan("assert.equal(el.getAttribute('data-x'), null)"), [], 'un attribut est une chaîne, jamais un graphe')
    assert.deepEqual(scan("assert.equal(box.querySelector('b').textContent, 'oui')\nassert.equal(retour, null)"), [], 'sans point-virgule, deux assertions voisines ne forment pas un faux couple')
  })

  it('la garde suit une variable locale qui reçoit un nœud', () => {
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.equal(n, null)"), [2], 'une variable locale, comparée à null')
    assert.deepEqual(scan("let n: any\nn = el.closest('form')\nassert.equal(n, null, 'absent')"), [3], 'une variable qui reçoit son nœud après sa déclaration')
    assert.deepEqual(scan("const l = Array.from(el.querySelectorAll('.l') as ArrayLike<any>).find((b: any) => b.id === 'x')\nassert.equal(l, undefined)"), [2], 'le résultat d\'un find sur des nœuds')
    assert.deepEqual(scan("const a = el.firstChild\nconst b = a\nassert.equal(null, b)"), [3], 'une variable copiée d\'une autre, null en premier')
  })

  it('la garde suit une enveloppe de fonction qui rend un nœud', () => {
    assert.deepEqual(scan("const barre = (d) => d.body.querySelector('.x')\nassert.equal(barre(win.document), null)"), [2], 'une flèche à corps-expression')
    assert.deepEqual(scan("function box(d: any): any {\n  return d.querySelector('.b')\n}\nassert.equal(box(document), null, 'fermée')"), [4], 'une fonction déclarée qui rend son nœud')
    assert.deepEqual(scan("const dans = (a: string, b: string) => {\n  const h = hote.querySelector(a)\n  return h?.querySelector(b)\n}\nassert.equal(dans('.a', '.h'), null)"), [5], 'un corps de fonction qui rend le nœud par return')
    assert.deepEqual(scan("const barre = (d) => d.body.querySelector('.x')\nconst entete = (w) => barre(w.document)\nassert.equal(entete(win), null)"), [3], 'une enveloppe d\'enveloppe')
  })

  it('la garde voit à travers un cast, des parenthèses et un commentaire', () => {
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), null as any)"), [1], 'null avec un cast')
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), (null))"), [1], 'null entre parenthèses')
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), null /* absent */)"), [1], 'un commentaire de bloc après null')
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), null // absent\n)"), [1], 'un commentaire de ligne après null')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.equal(n as any, null)"), [2], 'une variable derrière un cast')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.equal(<any>n, null)"), [2], 'une variable derrière un cast à chevrons')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.equal(n!, null)"), [2], 'une variable derrière le point d\'exclamation')
    assert.deepEqual(scan("const barre = (d) => d.querySelector('x')\nassert.equal((barre(doc) as any), null)"), [2], 'une enveloppe derrière un cast entre parenthèses')
  })

  it('la garde attrape un nœud comparé à undefined, à un autre nœud ou à une valeur inconnue', () => {
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), undefined)"), [1], 'un nœud contre undefined')
    assert.deepEqual(scan("assert.equal(undefined, el.querySelector('x'))"), [1], 'undefined en premier')
    assert.deepEqual(scan("const calque = el.querySelector('x')\nassert.equal(v.querySelector('x'), calque, 'la même')"), [2], 'un accès contre une variable nœud')
    assert.deepEqual(scan("const a = el.querySelector('a')\nconst b = el.querySelector('b')\nassert.strictEqual(a, b)"), [3], 'deux variables nœud')
    assert.deepEqual(scan("assert.equal(a.querySelector('x'), b.querySelector('x'))"), [1], 'deux accès directs')
    assert.deepEqual(scan("assert.notEqual(a.querySelector('x'), b.querySelector('x'))"), [1], 'notEqual échoue quand les deux nœuds sont le même : son message les décrit')
    assert.deepEqual(scan("assert.equal(el.querySelector('x'), calque, 'meme')"), [1], 'un accès contre une valeur dont on ne sait rien : seul un littéral ne peut pas être un nœud')
    assert.deepEqual(scan("assert.equal(document.activeElement, trigger)"), [1], 'le focus contre une valeur inconnue')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.strictEqual(autre, n)"), [2], 'une valeur inconnue contre une variable nœud')
    assert.deepEqual(scan("assert.deepEqual(Array.from(el.querySelectorAll('x')), [])"), [1], 'des nœuds contre un tableau')
    assert.deepEqual(scan("assert.notEqual(document.activeElement, trigger)"), [1], 'notEqual contre une valeur inconnue : le même nœud le fait échouer')
  })

  it('la garde ne signale pas ce qui n\'est pas un nœud', () => {
    assert.deepEqual(scan("const t = el.querySelector('x').textContent\nassert.equal(t, undefined)"), [], 'le texte d\'un nœud est une chaîne')
    assert.deepEqual(scan("const n = el.querySelectorAll('x').length\nassert.equal(n, undefined)"), [], 'un compte de nœuds est un nombre')
    assert.deepEqual(scan("const texte = (d) => d.querySelector('x').textContent\nassert.equal(texte(doc), null)"), [], 'une enveloppe qui rend un texte')
    assert.deepEqual(scan("assert.equal(a.querySelector('x').textContent, b.querySelector('y').textContent)"), [], 'deux textes')
    assert.deepEqual(scan("assert.equal(a.querySelectorAll('x').length, b.querySelectorAll('x').length)"), [], 'deux comptes')
    assert.deepEqual(scan("assert.equal(el.querySelector('x').textContent, attendu)"), [], 'un texte lu sur un nœud, contre une valeur inconnue')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.equal(n, 5)"), [], 'un littéral ne peut jamais être un nœud')
    assert.deepEqual(scan("assert.notEqual(document.activeElement, null)"), [], 'notEqual contre null échoue sur null : sans danger')
    assert.deepEqual(scan("assert.notEqual(el.querySelector('x'), undefined)"), [], 'notEqual contre undefined échoue sur undefined : sans danger')
    assert.deepEqual(scan("assert.equal(el.querySelector('x').dataset.k, undefined)"), [], 'une propriété lue sur un nœud, contre undefined : pas un nœud')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassert.ok(n === null)"), [], 'une comparaison booléenne : le nœud ne va jamais à assert')
    assert.deepEqual(scan("const n = el.querySelector('x')\nassertAbsent(n)"), [], 'le remplaçant')
    assert.deepEqual(scan("it('a', () => { const n = el.querySelector('x') })\nit('b', () => {\n  const n = 5\n  assert.equal(n, undefined)\n})"), [], 'un même nom, dans une autre portée, ne désigne pas le nœud')
    assert.deepEqual(scan("const n = el.querySelector('x')\nfunction f(n: number) { assert.equal(n, undefined) }"), [], 'un paramètre masque la variable du dehors')
  })

  it('aucun site du motif ne subsiste dans la suite', function () {
    this.timeout(60000)  //l'analyseur lit toute la suite : sur une machine chargée, les 2 s de mocha ne suffisent pas
    const coupables: string[] = []
    for(const file of sourceFiles(TESTS_DIR)) {
      const relatif = relative(TESTS_DIR, file)
      for(const ligne of scan(readFileSync(file, 'utf-8'))) coupables.push(relatif +':'+ ligne)
    }
    assert.ok(coupables.length === 0, coupables.length +' assertion(s) comparent un nœud DOM à null, à undefined ou à un autre nœud — remplace par assertAbsent() de ./helpers/dom-assert.js (nœud absent), ou par assert.ok(a === b, \'message\') (undefined, autre nœud) : une seule d\'entre elles, en échouant, suffit à faire tomber la machine :\n  '+ coupables.join('\n  '))
  })
})

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for(const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if(entry.isDirectory()) { if(!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(full)) }
    else if(/\.m?ts$/.test(entry.name) && !EXEMPT.has(entry.name)) out.push(full)
  }
  return out
}
