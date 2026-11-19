// setTimeout / setInterval refusés dans un composant — son <script>, les gestionnaires et les accolades du gabarit, lus
// sur l'AST du JavaScript compilé (après Civet). Une minuterie posée à la main survit au composant : sans `clear…` dans
// µdestroy, l'action part en retard, sur un composant disparu. µevery et µafter (runtime/mjs_every.ts) s'arrêtent seuls.
// Refusée : la minuterie GLOBALE, nue (`setTimeout(…)`, passée en valeur comprise), lue sur l'objet global — `window`,
// `globalThis`, `self`, `top`, `parent`, `frames`, leurs chaînes (`window.window`, `self.frames`), `document.defaultView`
// et le `ownerDocument.defaultView` d'un nœud — par un nom écrit en clair ou assemblé de chaînes fixes
// (`window['set' + 'Timeout']`, gabarit littéral de morceaux fixes comme `set${'Timeout'}`), ou décomposée depuis lui (`{ setTimeout } = window`, `{ setTimeout: st } = window`).
// Jamais refusés : la propriété d'un autre objet (`minuteur.setTimeout`), une clé d'objet, une méthode, `typeof setTimeout`,
// le test de présence (`!setTimeout`) et le test d'existence (`setTimeout?` de CoffeeScript, `x != null`) : rien n'est posé ; un nom que le code déclare
// lui-même, DANS SA PORTÉE (le paramètre `setTimeout` d'une fonction ne libère que cette fonction), ou que le composant
// déclare hors de l'AST lu (`libres` : `@import` et <script module>, racine du <script> pour le gabarit et les
// gestionnaires, noms que le gabarit met en portée pour ses accolades) ; chaînes et commentaires ne sont pas dans l'AST. Hors d'atteinte : un nom calculé à l'exécution
// (`window[nom]`), l'objet global passé par une variable (`w = window` puis `w.setTimeout`) ; le code partagé
// (<script module>, modules .civet / .coffee, magasins) n'est pas lu ici.
import { FaultFix } from '../fault-fix.js'
import { t } from '../messages/index.js'

const NAMES     = new Set(['setTimeout', 'setInterval'])
const GLOBALS   = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames'])
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const BLOCKS     = new Set(['BlockStatement', 'StaticBlock', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause'])

// les enfants d'un nœud, dans l'ordre du code
function children(n: any, f: (x: any) => void): void {
  for (const key in n) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    const v = n[key]
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === 'string') f(x)
    }
    else if (v && typeof v === 'object' && typeof v.type === 'string') {
      f(v)
    }
  }
}

// chaîne connue à la lecture du code : littéral, gabarit littéral dont chaque `${…}` est fixe (`set${'Timeout'}`), somme
// de chaînes fixes (`'set' + 'Timeout'`)
function fixedString(n: any): string | null {
  if (n?.type === 'Literal') return typeof n.value === 'string' ? n.value : null
  if (n?.type === 'TemplateLiteral') {
    let s: string | null = n.quasis[0]?.value?.cooked ?? null
    for (let i = 0; s !== null && i < n.expressions.length; i++) {
      const piece = fixedString(n.expressions[i])
      const rest = n.quasis[i + 1]?.value?.cooked
      s           = piece === null || typeof rest !== 'string' ? null : s + piece + rest
    }
    return s
  }
  if (n?.type !== 'BinaryExpression' || n.operator !== '+') return null
  const left = fixedString(n.left)
  if (left === null) return null
  const right = fixedString(n.right)
  return right === null ? null : left + right
}

// le nom lu sur un membre : `x.nom`, `x['nom']`, `x['set' + 'Timeout']`
function memberName(n: any): string | null {
  if (n.computed) return fixedString(n.property)
  return n.property?.type === 'Identifier' ? n.property.name : null
}

// sous `typeof` ou sous `!` (test de présence : `!window.setTimeout`), la lecture ne pose rien
function presenceOnly(parent: any): boolean {
  return parent?.type === 'UnaryExpression' && (parent.operator === 'typeof' || parent.operator === '!')
}

// comparée à `null` ou à `undefined` (existence CoffeeScript `setTimeout?`, `window.setTimeout?`, `x != null`) : rien
// n'est posé
function comparedToEmpty(n: any, parent: any): boolean {
  if (parent?.type !== 'BinaryExpression' || !['==', '!=', '===', '!=='].includes(parent.operator)) return false
  const other = parent.left === n ? parent.right : parent.left
  if (other.type === 'Literal') return other.raw === 'null'
  return other.type === 'Identifier' ? other.name === 'undefined' : other.type === 'UnaryExpression' && other.operator === 'void'
}

// l'identifiant n'est pas la lecture d'une variable : nom de propriété, clé, méthode, étiquette, `typeof`, présence, existence
function notRead(n: any, parent: any): boolean {
  if (!parent) return false
  if (parent.type === 'MemberExpression') return parent.property === n && !parent.computed
  if (parent.type === 'Property') return parent.key === n && !parent.computed && !parent.shorthand
  if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') return parent.key === n && !parent.computed
  return presenceOnly(parent) || comparedToEmpty(n, parent) || parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement'
}

// les noms qu'un motif déclare : `a`, `{ a, b: c }`, `[a, ...b]`, `a = 1` (`id` : le nœud du nom)
function namesInPattern(p: any, f: (name: string, id: any) => void): void {
  if (!p) return
  if (p.type === 'Identifier') f(p.name, p)
  else if (p.type === 'ObjectPattern') for (const q of p.properties) namesInPattern(q.type === 'RestElement' ? q.argument : q.value, f)
  else if (p.type === 'ArrayPattern') for (const q of p.elements) namesInPattern(q, f)
  else if (p.type === 'RestElement') namesInPattern(p.argument, f)
  else if (p.type === 'AssignmentPattern') namesInPattern(p.left, f)
}

// les noms que déclare chaque portée : `var` et paramètres à la fonction, `let` / `const` / `class` / `function` au
// bloc, `import` au module ; un nom déclaré ne vaut que dans sa portée et dans celles qu'elle contient
function scopes(ast: any): Map<any, Set<string>> {
  const names   = new Map<any, Set<string>>()
  const declare = (scope: any, name: string): void => {
    const s = names.get(scope)
    if (s) s.add(name)
    else names.set(scope, new Set([name]))
  }
  const collect = (n: any, fn: any, block: any): void => {
    if (FUNCTIONS.has(n.type)) {
      if (n.id && n.type === 'FunctionDeclaration') declare(block, n.id.name)
      else if (n.id) declare(n, n.id.name)
      for (const p of n.params) namesInPattern(p, name => declare(n, name))
      fn = block = n
    }
    else if (BLOCKS.has(n.type)) {
      block = n
      if (n.type === 'CatchClause') namesInPattern(n.param, name => declare(n, name))
    }
    else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) namesInPattern(d.id, name => declare(n.kind === 'var' ? fn : block, name))
    }
    else if (n.type === 'ClassDeclaration' && n.id) declare(block, n.id.name)
    // le nom d'une classe nommée (`class µK { m () { return µK } }`) : lié dans son corps, comme celui d'une fonction nommée
    else if (n.type === 'ClassExpression' && n.id) declare(n, n.id.name)
    else if (n.type === 'ImportDeclaration') for (const s of n.specifiers) declare(fn, s.local.name)
    children(n, x => collect(x, fn, block))
  }
  collect(ast, ast, ast)
  return names
}

/** les noms que déclare la racine de l'AST : variables, fonctions, classes, imports */
export function rootNames(ast: any): string[] {
  return ast ? [...(scopes(ast).get(ast) ?? [])] : []
}

/** les minuteries brutes de l'AST, dans l'ordre du code : leur nom et leur position ; `libres` : noms déclarés par le composant hors de cet AST */
export function rawTimers(ast: any, free: Iterable<string> = []): { name: string, start: number }[] {
  const names                                   = scopes(ast)
  const open: Set<string>[]                     = [new Set(free)]   // noms du composant, puis portées autour du nœud visité qui déclarent un nom
  const seen: { name: string, start: number }[] = []
  const local                                   = (name: string): boolean => open.some(s => s.has(name))
  // l'objet global, non redéclaré : `window`, `globalThis`, `self`, `top`, `parent`, `frames`, leurs chaînes,
  // `document.defaultView`, le `ownerDocument.defaultView` d'un nœud
  const global = (o: any): boolean => {
    if (o?.type === 'ChainExpression') return global(o.expression)
    if (o?.type === 'Identifier') return GLOBALS.has(o.name) && !local(o.name)
    if (o?.type !== 'MemberExpression') return false
    const name = memberName(o)
    if (name !== 'defaultView') return name !== null && GLOBALS.has(name) && global(o.object)
    const d = o.object?.type === 'ChainExpression' ? o.object.expression : o.object
    if (d?.type === 'Identifier') return d.name === 'document' && !local('document')
    // le document de l'objet global, ou celui d'un nœud (`el.ownerDocument`, `document.body.ownerDocument`)
    return d?.type === 'MemberExpression' && (memberName(d) === 'ownerDocument' || memberName(d) === 'document' && global(d.object))
  }
  const visit = (n: any, parent: any): void => {
    const scope = names.get(n)
    if (scope) open.push(scope)
    if (n.type === 'Identifier') {
      if (NAMES.has(n.name) && !notRead(n, parent) && !local(n.name)) seen.push({ name: n.name, start: n.start })
    }
    else if (n.type === 'MemberExpression') {
      const name = memberName(n)
      if (name !== null && NAMES.has(name) && !presenceOnly(parent) && !comparedToEmpty(n, parent) && global(n.object)) seen.push({ name, start: n.start })
    }
    // décomposée depuis l'objet global : `{ setTimeout } = window`, `{ setTimeout: st } = window`
    const pattern  = n.type === 'VariableDeclarator' ? n.id : n.type === 'AssignmentExpression' || n.type === 'AssignmentPattern' ? n.left : null
    const source = n.type === 'VariableDeclarator' ? n.init : n.right
    if (pattern?.type === 'ObjectPattern' && global(source)) {
      for (const p of pattern.properties) {
        const name = p.type !== 'Property' ? null : !p.computed && p.key.type === 'Identifier' ? p.key.name : fixedString(p.key)
        if (name !== null && NAMES.has(name)) seen.push({ name, start: p.key.start })
      }
    }
    children(n, x => visit(x, n))
    if (scope) open.pop()
  }
  visit(ast, null)
  // dans l'ordre du code ; une même position ne compte qu'une fois (clé et valeur d'un raccourci `{ setTimeout }`)
  const starts = new Set<number>()
  return seen.sort((a, b) => a.start - b.start).filter(v => !starts.has(v.start) && starts.add(v.start) !== undefined)
}

/** refuse les minuteries brutes d'un composant, à leur ligne du .mjs : la première porte le message, les autres sont citées */
export function rejectRawTimers(ast: any, lineOf: (offset: number) => number | null, moduleName: string, handler: boolean, free: Iterable<string> = []): void {
  if (!ast) return
  const seen = rawTimers(ast, free)
  if (seen.length === 0) return
  const lines = seen.map(v => lineOf(v.start))
  const others = [...new Set(lines.slice(1).filter((l): l is number => l !== null && l !== lines[0]))].join(', ')
  // `mjs check` rend le nom inerte (`_etTimeout`, même longueur) le temps de relire la suite du fichier (cf. FaultFix)
  throw FaultFix.attach(new Error(t('transpiler.timer-raw', { moduleName, name: seen[0].name, line: lines[0] ?? '', handler: handler ? 'yes' : '', others: others })), seen[0].name, '_' + seen[0].name.slice(1), lines[0])
}

// un identifiant qui n'est pas la lecture d'une variable : nom de propriété ou de méthode, clé d'objet (la valeur d'un raccourci
// `{ a }`, copie du nom, en est une), nom importé ou exporté sous un autre nom, libellé, `import.meta`
function notReadName(n: any, parent: any): boolean {
  if (!parent) return false
  if (parent.type === 'MemberExpression') return parent.property === n && !parent.computed
  if (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') return parent.key === n && !parent.computed
  if (parent.type === 'ImportSpecifier') return parent.imported === n && parent.local !== n
  if (parent.type === 'ExportSpecifier') return parent.exported === n && parent.local !== n
  return parent.type === 'ExportAllDeclaration' || parent.type === 'MetaProperty' || parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement'
}

/** les lectures des noms `searched` qu'aucune portée qui les englobe ne déclare (cf. portees), dans l'ordre du code, chacune avec ses
 *  ancêtres, de la racine au parent : le `µ` d'un .js copié, qui reçoit alors le cœur par un import (bundler, prepareCopiedJs), le
 *  `type: Reward` d'un appel par verbe que rien ne lie à son endroit (var-types.ts, checkAjaxVerbNames) */
export function freeReads(ast: any, searched: Set<string> | ((name: string) => boolean)): { name: string, node: any, ancestors: any[] }[] {
  const search                                                = typeof searched === 'function' ? searched : (name: string) => (searched as Set<string>).has(name)
  const names                                                 = scopes(ast)
  const open: Set<string>[]                                   = []
  const path: any[]                                           = []
  const seen: { name: string, node: any, ancestors: any[] }[] = []
  const visit                                               = (n: any): void => {
    const scope = names.get(n)
    if (scope) open.push(scope)
    if (n.type === 'Identifier' && search(n.name) && !notReadName(n, path[path.length - 1]) && !open.some(s => s.has(n.name))) seen.push({ name: n.name, node: n, ancestors: [...path] })
    path.push(n)
    children(n, visit)
    path.pop()
    if (scope) open.pop()
  }
  visit(ast)
  return seen
}

/** les affectations à un nom qu'aucune portée qui les englobe ne déclare (cf. portees : ni variable, ni paramètre, ni `catch`, ni
 *  import, ni fonction ou classe) et que `connu` ne dit pas global : `x = …`, `x += …`, `x++`, la décomposition (`[a, b] = …`), la
 *  variable d'une boucle sans déclaration (`for (x of …)`) ; un membre (`a.b = …`, `globalThis.x = …`) n'en est pas une. Une par nom
 *  et par fonction, la première dans l'ordre du code ; aucune dans une fonction qu'englobe une fonction qui affecte déjà ce nom : la
 *  déclaration posée là-haut la couvre (cf. libraryAssignmentMotifs) */
export function freeAssignments(ast: any, known: (name: string) => boolean): { name: string, node: any }[] {
  const names                                                 = scopes(ast)
  const open: Set<string>[]                                   = []
  const functions: any[]                                      = []
  const seen: { name: string, node: any, functions: any[] }[] = []
  const target                                                = (p: any): void => namesInPattern(p, (name, id) => {
    if (!known(name) && !open.some(s => s.has(name))) seen.push({ name, node: id, functions: [...functions] })
  })
  const visit = (n: any): void => {
    const scope = names.get(n)
    const fn    = n === ast || FUNCTIONS.has(n.type)
    if (scope) open.push(scope)
    if (fn) functions.push(n)
    if (n.type === 'AssignmentExpression') target(n.left)
    else if (n.type === 'UpdateExpression') target(n.argument)
    else if ((n.type === 'ForInStatement' || n.type === 'ForOfStatement') && n.left.type !== 'VariableDeclaration') target(n.left)
    children(n, visit)
    if (fn) functions.pop()
    if (scope) open.pop()
  }
  visit(ast)
  // la même fonction plus tôt, ou une fonction qui l'englobe : déjà nommé
  const covered = (v: typeof seen[number], w: typeof seen[number]): boolean => w.functions.length <= v.functions.length && w.functions[w.functions.length - 1] === v.functions[w.functions.length - 1]
  return seen.filter((v, i) => !seen.some((w, j) => j !== i && w.name === v.name && covered(v, w) && (w.functions.length < v.functions.length || j < i))).map(({ name, node }) => ({ name, node }))
}
