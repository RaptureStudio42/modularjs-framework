// ============================================================================
// Valeurs dérivées aux lectures connues — une écriture de `$x` ne périme que les
// valeurs dérivées qui lisent `$x` (directement ou par une autre valeur dérivée) :
// le runtime le lit dans `_mjs_computedDeps`, mais seulement pour celles que le
// compilateur marque ici. Règle nº 1 : jamais une mise à jour manquée. Une valeur
// dérivée dont une lecture de l'état peut échapper à l'analyse garde le
// comportement d'avant (toute écriture la périme, elle se recalcule quand on la lit) :
//   - `this`, `@@x` (`_mjsThis`), méthode du composant, `$` nu ou `$[k]`, rune
//     (`µ.…` hors `µ.store.nom`), fonction ou fermeture du `<script>` qui lit
//     l'état, nom inconnu (import, global hors liste), appel de méthode hors
//     liste, appel d'une valeur de l'état (`$f()`), classe ;
//   - l'heure et le hasard (`Date.now()`, `Date()`, `new Date()` sans argument,
//     `Math.random()`, `format()` sans argument) : une valeur qui change sans écriture ;
//   - une variable du `<script>` qu'une fonction change (réaffectée, `+=`, `++`,
//     propriété écrite, `push`, `set`…, passée à une fonction qui peut la changer,
//     rangée ailleurs), sauf lue par la valeur dérivée elle-même quand chaque
//     changement est suivi, dans le même bloc, de l'écriture d'une variable `$`
//     qu'elle lit (cf. suivie) ;
//   - définie deux fois, ou qui lit une valeur dérivée aux lectures inconnues,
//     ou une variable externe.
// Une méthode d'un nom ordinaire (`map`, `get`, `format`…) peut être celle d'un
// objet de l'utilisateur, qui lit l'état par une fermeture : son receveur est
// vérifié à chaque calcul (`_mjs_rcv`, runtime/mjs_element.ts, enveloppe posée par
// l'analyseur) ; un receveur pris dans une chaîne optionnelle (`$a?.b.get()`), que
// l'enveloppe couperait, rend la valeur dérivée inconnue. Un parcours aussi
// (`[...x]`, `f(...x)`, `for…of`, `[a, b] = x`, `Array.from(x)`, `new Set(x)`,
// `new Map(x)`, `Object.fromEntries(x)`, `Promise.all(x)`…) : l'itérateur d'un
// objet de l'utilisateur peut lire l'état, l'itérable est vérifié au calcul. Dans
// une fonction du `<script>`, rien ne se vérifie : une méthode ou un parcours sur
// autre chose qu'un littéral, une variable sûre ou une variable du module rend la
// fonction non sûre.
// Une fonction du `<script module>` vit hors de l'instance (premier niveau du
// module compilé, sans accès au `$` du composant) : seuls ses arguments comptent,
// tant que le `<script>` ne la réaffecte pas. Une variable du module que le
// `<script>` change (propriété, `push`, `Object.assign`…, cf. collecter) ou que le
// module change lui-même dans une fonction (cf. changingNames, appelé par le
// transpileur) n'est pas sûre. Une variable du `<script>` est une donnée sûre quand
// AUCUNE de ses valeurs ne peut lire l'état (fonction qui lit `$`, `this`, nom
// inconnu…), point fixe sur toutes ses affectations.
// `µderived $v = expression, $a, $b` nomme ses dépendances : l'expression ne
// s'analyse pas, la valeur est connue (périmée par `$a`, `$b` et les variables `$`
// écrites dans l'expression).
// ============================================================================

// en sommeil : l'analyse ne voit pas à coup sûr tout ce qu'une valeur lit en cachette (variable sans `$` changée par une forme
// qu'elle ne suit pas, même objet par deux chemins, fonction du `<script module>` crue pure) ; aucune valeur n'est marquée,
// toute écriture du composant les périme toutes. Le runtime ne porte plus l'index par nom écrit ni `_mjs_rcv` : à rétablir avec
// ce drapeau, sans quoi une valeur marquée dont un receveur est vérifié appellerait `_mjsThis._mjs_rcv` (enveloppe posée par
// analyzer/index.ts), absent du runtime
export const KNOWN_READS = false

export type Scope = Map<string, 'param' | 'fn' | 'var'>

interface Context {
  // 'derived' : expression d'une valeur dérivée, ses lectures `$.x` sont ses dépendances, même dans une fonction
  // imbriquée ; 'script' : valeur d'une variable du `<script>`, une lecture `$.x` dans une fonction y échappe
  mode: 'derived' | 'script'
  // portées d'indice inférieur : locales d'une fonction englobante, hors de l'expression (provenance inconnue)
  bound: number
  inFunction: boolean
  module: Set<string>
  script: Set<string>
  safeVars: Set<string>
  // variables du `<script>` qu'une fonction change : par changement, les variables `$` écrites juste après (cf. suivie)
  changing: Map<string, Set<string>[]>
  // mode 'derived' : variables `$` que la valeur dérivée lit
  deps?: Set<string>
  // mode 'script' : fonction confiée à une fonction du `<script module>` (cf. porteuse) ; elle reçoit les valeurs du module,
  // ses méthodes et parcours passent
  handed?: boolean
  // receveurs des méthodes ordinaires et itérables de l'expression, à vérifier au calcul (mode 'derived' seulement)
  receivers?: Receiver[]
}

// `methode` null : itérable d'un parcours (`Symbol.iterator`)
export interface Receiver { node: any; method: string | null }

export interface DerivedCandidate {
  name: string
  node: any
  // temporaires déclarés avec l'expression (`ref` de l'`if` sans parenthèses de Civet)
  locals?: string[]
  // `µderived $v = expression, $a…` : dépendances nommées, l'expression ne s'analyse pas
  force?: boolean
  // `µderived` : les noms des dépendances (`$a` → `a`), absents quand l'une n'est pas une variable `$` du composant
  named?: string[]
}

export const GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Intl', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Error', 'TypeError', 'RangeError', 'Promise', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone', 'console'])
// espaces de noms globaux : toute fonction qu'ils portent est sûre (`Math.max`, `Object.assign`, `JSON.stringify`…)
export const SPACES = new Set(['Math', 'JSON', 'Number', 'String', 'Array', 'Object', 'Date', 'Intl', 'Symbol', 'BigInt', 'Promise', 'console'])
// méthodes des valeurs ordinaires (tableaux, chaînes, nombres, dates, Map/Set, Intl, RegExp) : appelées sur n'importe quelle valeur
export const METHODS = new Set([
  'at', 'concat', 'entries', 'every', 'fill', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'toReversed', 'toSorted', 'toSpliced', 'unshift', 'values', 'with',
  'charAt', 'charCodeAt', 'codePointAt', 'endsWith', 'localeCompare', 'match', 'matchAll', 'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'replaceAll', 'search', 'split', 'startsWith', 'substring', 'substr', 'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'trim', 'trimEnd', 'trimStart',
  'toFixed', 'toPrecision', 'toExponential', 'toString', 'toLocaleString', 'valueOf',
  'getTime', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds', 'getTimezoneOffset', 'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'getUTCSeconds', 'toISOString', 'toJSON', 'toDateString', 'toTimeString', 'toLocaleDateString', 'toLocaleTimeString',
  'get', 'has', 'hasOwnProperty', 'format', 'formatToParts', 'test', 'exec',
])
// méthodes qui changent leur receveur (tableau, Map, Set)
export const MUTATEURS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear'])
// méthodes du langage qui rangent leurs arguments dans une collection (les autres de METHODES ne font que les lire ou les appeler)
const STORERS = new Set(['push', 'unshift', 'splice', 'fill', 'concat', 'with'])
// fonctions des espaces globaux qui écrivent dans leur premier argument
const WRITERS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])
// fonctions qui parcourent leur premier argument (`Array.from(x)`…), constructeurs aussi (`new Set(x)`…)
const WALKERS = new Map([['Array', new Set(['from'])], ['Object', new Set(['fromEntries', 'groupBy'])], ['Promise', new Set(['all', 'allSettled', 'any', 'race'])]])
const WALKERS_NEW = new Set(['Set', 'Map', 'WeakSet', 'WeakMap'])

// clés qui ne portent jamais un nœud (les autres se parcourent toutes)
const IGNORED_KEYS = new Set(['type', 'start', 'end', 'loc', 'range'])

export function patternNames(p: any, out: string[]): void {
  if (!p) return
  switch (p.type) {
    case 'Identifier':        out.push(p.name); break
    case 'ObjectPattern':     for (const q of p.properties ?? []) patternNames(q.type === 'RestElement' ? q.argument : q.value, out); break
    case 'ArrayPattern':      for (const q of p.elements ?? []) patternNames(q, out); break
    case 'AssignmentPattern': patternNames(p.left, out); break
    case 'RestElement':       patternNames(p.argument, out); break
  }
}

// `var` et fonctions déclarées dans un corps, sans entrer dans les fonctions imbriquées
function hoist(n: any, m: Scope): void {
  if (!n || typeof n.type !== 'string') return
  if (n.type === 'FunctionDeclaration') { if (n.id) m.set(n.id.name, 'fn'); return }
  if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') return
  if (n.type === 'VariableDeclaration') {
    if (n.kind === 'var') for (const d of n.declarations) { const t: string[] = []; patternNames(d.id, t); for (const x of t) m.set(x, 'var') }
    return
  }
  if (/Expression$/.test(n.type) || n.type === 'Identifier' || n.type === 'Literal') return
  for (const k of Object.keys(n)) {
    if (IGNORED_KEYS.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) for (const x of v) hoist(x, m)
    else if (v && typeof v.type === 'string') hoist(v, m)
  }
}

export function functionScope(fn: any): Scope {
  const m: Scope = new Map()
  for (const p of fn.params) { const t: string[] = []; patternNames(p, t); for (const x of t) m.set(x, 'param') }
  if (fn.type === 'FunctionExpression' && fn.id) m.set(fn.id.name, 'fn')
  if (fn.body && fn.body.type === 'BlockStatement') hoist(fn.body, m)
  return m
}

export function blockScope(stmts: any[]): Scope {
  const m: Scope = new Map()
  for (const s of stmts ?? []) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) { const t: string[] = []; patternNames(d.id, t); for (const x of t) m.set(x, 'var') }
    else if (s.type === 'ClassDeclaration' && s.id) m.set(s.id.name, 'var')
    else if (s.type === 'FunctionDeclaration' && s.id) m.set(s.id.name, 'fn')
  }
  return m
}

export function declarationScope(d: any): Scope {
  const m: Scope = new Map()
  for (const x of d.declarations) { const t: string[] = []; patternNames(x.id, t); for (const n of t) m.set(n, 'var') }
  return m
}

export function find(name: string, scopes: Scope[]): { i: number; nature: string } | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const n = scopes[i].get(name)
    if (n) return { i, nature: n }
  }
  return null
}

function safeName(name: string, scopes: Scope[], c: Context, called: boolean): boolean {
  if (name === '$' || name === 'µ' || name === '_mjsThis' || name === 'arguments') return false
  const r = find(name, scopes)
  if (r) return r.i >= c.bound && (!called || r.nature === 'fn')
  if (c.module.has(name)) return true
  if (c.script.has(name)) return c.safeVars.has(name) && tracked(name, c)
  return GLOBALS.has(name)
}

// variable du `<script>` qu'une fonction change : sûre seulement lue par la valeur dérivée elle-même, quand chaque
// changement est suivi, dans le même bloc, de l'écriture d'une variable `$` qu'elle lit — qui la périme
function tracked(name: string, c: Context): boolean {
  const l = c.changing.get(name)
  if (!l) return true
  const d = c.deps
  return c.mode === 'derived' && d !== undefined && l.every((s) => [...s].some((x) => d.has(x)))
}

// receveur ou itérable pris d'une variable sûre du `<script>` ou d'une variable du module (`TABLE.map(f)`, `C.l.get(k)`)
function safeRoot(o: any, scopes: Scope[], c: Context): boolean {
  const r = root(o)
  return r !== null && !find(r, scopes) && (c.module.has(r) || (c.script.has(r) && c.safeVars.has(r) && tracked(r, c)))
}

// l'heure et le hasard : une valeur qui change sans aucune écriture (`Date.now()`, `Date()`, `new Date()` sans argument,
// `Math.random()`, `format()` sans argument d'un `Intl.DateTimeFormat`)
function impure(n: any): boolean {
  const f = n.callee
  if (f.type === 'Identifier') return f.name === 'Date' && (n.type === 'CallExpression' || n.arguments.length === 0)
  if (f.type !== 'MemberExpression' || f.computed || f.property.type !== 'Identifier') return false
  const m = f.property.name
  const o = f.object.type === 'Identifier' ? f.object.name : null
  return (m === 'format' && n.arguments.length === 0) || (o === 'Date' && m === 'now') || (o === 'Math' && m === 'random')
}

// appel qui parcourt son premier argument (cf. PARCOURENT)
function walksItsArgument(n: any): boolean {
  const f = n.callee
  if (f.type === 'Identifier') return n.type === 'NewExpression' && WALKERS_NEW.has(f.name)
  return f.type === 'MemberExpression' && !f.computed && f.object.type === 'Identifier' && f.property.type === 'Identifier' && WALKERS.get(f.object.name)?.has(f.property.name) === true
}

// parcours de `x` (étalement, `for…of`, déstructuration, `Array.from(x)`…) : un littéral se lit tel quel ; dans une valeur
// dérivée, l'itérable est vérifié au calcul (l'itérateur d'un objet de l'utilisateur peut lire l'état) ; dans une fonction
// du `<script>`, sûr sur une variable sûre ou du module seulement
function walkNode(x: any, scopes: Scope[], c: Context, parent: any): boolean {
  if (!x) return true
  if (!safe(x, scopes, c, parent)) return false
  if (x.type === 'ArrayExpression' || x.type === 'TemplateLiteral' || (x.type === 'Literal' && typeof x.value === 'string')) return true
  if (c.receivers) {
    c.receivers.push({ node: x, method: null })
    return true
  }
  return c.handed === true || safeRoot(x, scopes, c)
}

// `µ.store` lu comme objet d'un accès nommé (`µ.store.nom`) : la clé du magasin, suivie par le chemin des magasins
export function isStore(n: any): boolean {
  return n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'µ' && n.property.type === 'Identifier' && n.property.name === 'store'
}

// un maillon optionnel dans le receveur (`$a?.b` de `$a?.b.get()`) : l'envelopper couperait le court-circuit de la chaîne
function optionalLink(n: any): boolean {
  while (n.type === 'MemberExpression' || n.type === 'CallExpression') {
    if (n.optional) return true
    n = n.type === 'MemberExpression' ? n.object : n.callee
  }
  return false
}

function safeCall(callee: any, scopes: Scope[], c: Context, fresh = false): boolean {
  if (callee.type === 'Identifier') return safeName(callee.name, scopes, c, true)
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    const o = callee.object
    if (o.type === 'Identifier') {
      if (o.name === '$') return false
      if (!find(o.name, scopes) && !c.script.has(o.name) && (c.module.has(o.name) || SPACES.has(o.name))) return true
    }
    if (isStore(o)) return false
    if (!METHODS.has(callee.property.name) || !safe(o, scopes, c, callee)) return false
    // méthode ordinaire : un littéral (tableau, chaîne, expression régulière) est un objet du langage ; tout autre receveur
    // est vérifié au calcul, sauf sous `new` ou dans une chaîne optionnelle, où l'enveloppe changerait le sens de l'appel
    if (o.type === 'Literal' || o.type === 'TemplateLiteral' || o.type === 'ArrayExpression') return true
    if (fresh || optionalLink(o)) return false
    if (c.receivers) {
      c.receivers.push({ node: o, method: callee.property.name })
      return true
    }
    // fonction du `<script>` : le receveur ne se vérifie pas
    return c.handed === true || safeRoot(o, scopes, c)
  }
  if (callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') return safe(callee, scopes, c, null)
  return false
}

function safeTarget(t: any, scopes: Scope[], c: Context): boolean {
  if (t.type === 'Identifier') {
    const r = find(t.name, scopes)
    if (r) return r.i >= c.bound
    return c.script.has(t.name) && c.safeVars.has(t.name) && tracked(t.name, c)
  }
  if (t.type === 'MemberExpression') return safe(t, scopes, c, null)
  return false
}

// `tete` : motif d'une déclaration, d'une affectation ou d'un paramètre, dont la source se vérifie ailleurs ; un motif de
// tableau plus bas (`{ a: [x] }`, `[[x]]`) parcourt une valeur qu'aucune enveloppe n'atteint
function safePattern(p: any, scopes: Scope[], c: Context, head = true): boolean {
  if (!p) return true
  switch (p.type) {
    case 'Identifier':        return true
    case 'AssignmentPattern': return safePattern(p.left, scopes, c, head) && safe(p.right, scopes, c, p)
    case 'RestElement':       return safePattern(p.argument, scopes, c, false)
    case 'ArrayPattern':      return (head || c.handed === true) && p.elements.every((q: any) => safePattern(q, scopes, c, false))
    case 'ObjectPattern':     return p.properties.every((q: any) => q.type === 'RestElement' ? safePattern(q.argument, scopes, c, false) : (!q.computed || safe(q.key, scopes, c, q)) && safePattern(q.value, scopes, c, false))
    default:                  return false
  }
}

function all(list: any[], scopes: Scope[], c: Context, parent: any): boolean {
  for (const x of list) if (x && !safe(x, scopes, c, parent)) return false
  return true
}

function safe(n: any, scopes: Scope[], c: Context, parent: any): boolean {
  if (!n || typeof n.type !== 'string') return true
  switch (n.type) {
    case 'ThisExpression': case 'Super': case 'MetaProperty': case 'ImportExpression': case 'ClassExpression': case 'ClassDeclaration': case 'WithStatement':
      return false
    case 'Literal': case 'TemplateElement': case 'EmptyStatement': case 'DebuggerStatement': case 'BreakStatement': case 'ContinueStatement':
      return true
    case 'Identifier':
      return safeName(n.name, scopes, c, false)
    case 'MemberExpression': {
      const o = n.object
      if (o.type === 'Identifier' && o.name === '$') return !n.computed && !(c.mode === 'script' && c.inFunction)
      if (o.type === 'Identifier' && o.name === 'µ') return isStore(n) && parent != null && parent.type === 'MemberExpression' && parent.object === n && !parent.computed && !(c.mode === 'script' && c.inFunction)
      return safe(o, scopes, c, n) && (!n.computed || safe(n.property, scopes, c, n))
    }
    case 'CallExpression': case 'NewExpression': {
      if (impure(n) || !safeCall(n.callee, scopes, c, n.type === 'NewExpression')) return false
      if (!walksItsArgument(n) || n.arguments.length === 0) return all(n.arguments, scopes, c, n)
      const a = n.arguments[0]
      return a.type !== 'SpreadElement' && walkNode(a, scopes, c, n) && all(n.arguments.slice(1), scopes, c, n)
    }
    case 'SpreadElement':
      return parent && parent.type === 'ObjectExpression' ? safe(n.argument, scopes, c, n) : walkNode(n.argument, scopes, c, n)
    case 'YieldExpression':
      return n.delegate ? walkNode(n.argument, scopes, c, n) : safe(n.argument, scopes, c, n)
    case 'TaggedTemplateExpression':
      return safeCall(n.tag, scopes, c) && safe(n.quasi, scopes, c, n)
    case 'ChainExpression':
      return safe(n.expression, scopes, c, n)
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': {
      const pp = [...scopes, functionScope(n)]
      const c2 = c.inFunction ? c : { ...c, inFunction: true }
      return n.params.every((p: any) => safePattern(p, pp, c2)) && safe(n.body, pp, c2, n)
    }
    case 'BlockStatement': case 'StaticBlock':
      return all(n.body, [...scopes, blockScope(n.body)], c, n)
    case 'SwitchStatement':
      return safe(n.discriminant, scopes, c, n) && all(n.cases, [...scopes, blockScope(n.cases.flatMap((k: any) => k.consequent))], c, n)
    case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
      const init = n.type === 'ForStatement' ? n.init : n.left
      const pp = init && init.type === 'VariableDeclaration' && init.kind !== 'var' ? [...scopes, declarationScope(init)] : scopes
      if (n.type !== 'ForStatement' && init && init.type !== 'VariableDeclaration' && !safeTarget(init, pp, c)) return false
      // `for await` : l'itérateur asynchrone ne se vérifie pas
      if (n.type === 'ForOfStatement' && n.await) return false
      return (n.type !== 'ForStatement' || safe(n.init, pp, c, n)) && (n.type === 'ForStatement' || init.type !== 'VariableDeclaration' || safe(init, pp, c, n)) && safe(n.test, pp, c, n) && safe(n.update, pp, c, n) && (n.type === 'ForOfStatement' ? walkNode(n.right, pp, c, n) : safe(n.right, pp, c, n)) && safe(n.body, pp, c, n)
    }
    case 'CatchClause': {
      const m: Scope = new Map()
      const t: string[] = []
      patternNames(n.param, t)
      for (const x of t) m.set(x, 'var')
      return safe(n.body, [...scopes, m], c, n)
    }
    case 'VariableDeclarator':
      return safePattern(n.id, scopes, c) && (n.id.type === 'ArrayPattern' ? walkNode(n.init, scopes, c, n) : safe(n.init, scopes, c, n))
    case 'AssignmentExpression':
      return safeTarget(n.left, scopes, c) && safe(n.right, scopes, c, n)
    case 'UpdateExpression':
      return safeTarget(n.argument, scopes, c)
    case 'Property':
      return (!n.computed || safe(n.key, scopes, c, n)) && safe(n.value, scopes, c, n)
    case 'LabeledStatement':
      return safe(n.body, scopes, c, n)
  }
  for (const k of Object.keys(n)) {
    if (IGNORED_KEYS.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) { if (!all(v, scopes, c, n)) return false }
    else if (v && typeof v.type === 'string' && !safe(v, scopes, c, n)) return false
  }
  return true
}

export interface Assignment { value: any; scopes: Scope[] }

// racine nommée d'un accès (`C.a.b` → `C`), null sinon
export function root(n: any): string | null {
  while (n && n.type === 'MemberExpression') n = n.object
  return n && n.type === 'Identifier' ? n.name : null
}

// variable `$` écrite par `t` (`$.y`, `$.y.z`), null sinon
function writtenState(t: any): string | null {
  while (t && t.type === 'MemberExpression') {
    if (t.object.type === 'Identifier' && t.object.name === '$') return t.computed ? null : t.property.name
    t = t.object
  }
  return null
}

// variables `$` écrites par les instructions qui suivent la `i`-ième de `liste` : affectations seules, jusqu'à la première
// autre instruction (un `return` d'une affectation compris, l'écriture implicite de Civet et de CoffeeScript)
function writtenAfter(list: any[], i: number): Set<string> {
  const s = new Set<string>()
  for (let j = i + 1; j < list.length; j++) {
    const t = list[j]
    const e = t.type === 'ExpressionStatement' ? t.expression : t.type === 'ReturnStatement' ? t.argument : null
    if (!e) break
    let all = true
    for (const x of e.type === 'SequenceExpression' ? e.expressions : [e]) {
      const name = x.type === 'AssignmentExpression' ? writtenState(x.left) : x.type === 'UpdateExpression' ? writtenState(x.argument) : null
      if (name) s.add(name)
      else all = false
    }
    if (!all || t.type === 'ReturnStatement') break
  }
  return s
}

// noms des valeurs que `v` désigne (`x`, `x.a`, `c ? x : y`, `x || y`) : une affectation les range ailleurs, un appel les reçoit
function designatedNames(v: any, out: string[]): string[] {
  if (!v) return out
  if (v.type === 'SpreadElement' || v.type === 'ChainExpression') return designatedNames(v.type === 'SpreadElement' ? v.argument : v.expression, out)
  if (v.type === 'ConditionalExpression') return designatedNames(v.alternate, designatedNames(v.consequent, out))
  if (v.type === 'LogicalExpression') return designatedNames(v.right, designatedNames(v.left, out))
  if (v.type === 'SequenceExpression') return designatedNames(v.expressions[v.expressions.length - 1], out)
  const r = root(v)
  if (r) out.push(r)
  return out
}

interface Instruction { list: any[]; i: number }

// un changement d'une variable : variables `$` écrites juste après (cf. writtenAfter) ; `haut` : au premier niveau ; `passe` :
// passée à un appel ou rangée ailleurs (sans effet sur une fonction)
export interface Change { tracked: Set<string>; top: boolean; pass: boolean }

// affectations des variables du `<script>` (premier niveau) : chaque valeur avec les portées qui l'entourent. Une
// affectation dans une fonction à une variable locale de cette fonction ne compte pas ; une valeur illisible (motif,
// classe, boucle `for … of`, `catch`, import) rend la variable inconnue. `membres` : valeurs rangées DANS une variable
// (`x.p = v`, `Object.assign(x, v)`, `x.push(v)`), qui comptent comme les siennes. `changes` : par variable du premier
// niveau, ses changements — réaffectée, `+=`, `++`, propriété écrite ou effacée, méthode qui la change (`push`, `set`…),
// passée à une fonction qui peut la changer (hors fonction du `<script module>`, `called`, et fonction globale qui ne
// fait que lire), rangée ailleurs (`y = x`, `{ k: x }`, `[x]`) ; dans une fonction ou dans l'expression d'une valeur
// dérivée (`derives`), recalculée à toute heure, sinon au premier niveau (`haut`, qui tourne une fois, avant toute
// lecture). `handed` : arguments nommés ou fonctions passés à un appel dont le nom est `appele` (une fonction du
// `<script module>` qui garderait une fermeture de l'instance), ou rangés dans la variable `appele`
export function collect(ast: any, called: Set<string>, derives: Set<any>): { table: Map<string, Assignment[]>; members: Map<string, Assignment[]>; unknowns: Set<string>; changes: Map<string, Change[]>; handed: { called: string; arg: any; scopes: Scope[] }[] } {
  const table = new Map<string, Assignment[]>()
  const members = new Map<string, Assignment[]>()
  const unknowns = new Set<string>()
  const changes = new Map<string, Change[]>()
  const handed: { called: string; arg: any; scopes: Scope[] }[] = []
  const record = (name: string, value: any, scopes: Scope[]) => {
    let l = table.get(name)
    if (!l) table.set(name, l = [])
    l.push({ value, scopes })
  }
  const unknown = (pattern: any) => { const t: string[] = []; patternNames(pattern, t); for (const x of t) { unknowns.add(x); if (!table.has(x)) table.set(x, []) } }
  const change = (name: string | null, scopes: Scope[], inFunction: boolean, ins: Instruction | null, pass = false) => {
    if (!name || name === '$' || name === 'µ' || name === '_mjsThis' || find(name, scopes)) return
    let l = changes.get(name)
    if (!l) changes.set(name, l = [])
    l.push({ tracked: ins ? writtenAfter(ins.list, ins.i) : new Set(), top: !inFunction, pass })
  }
  // `valeurs` rangées dans la variable qui porte `cible` (`x.p = v` : `x`)
  const range = (target: any, values: any[], scopes: Scope[]) => {
    const r = root(target)
    if (!r || find(r, scopes)) return
    let l = members.get(r)
    if (!l) members.set(r, l = [])
    for (const v of values) {
      if (!v) continue
      l.push({ value: v.type === 'SpreadElement' ? v.argument : v, scopes })
      handed.push({ called: r, arg: v, scopes })
    }
  }
  const ranges = (v: any, scopes: Scope[], inFunction: boolean, ins: Instruction | null) => { for (const x of designatedNames(v, [])) change(x, scopes, inFunction, ins, true) }
  const visit = (n: any, scopes: Scope[], inFunction: boolean, ins: Instruction | null): void => {
    if (!n || typeof n.type !== 'string') return
    // expression d'une valeur dérivée : recalculée à toute heure, comme une fonction ; rien ne la suit
    if (derives.has(n)) { inFunction = true; ins = null }
    switch (n.type) {
      case 'ImportDeclaration':
        for (const s of n.specifiers ?? []) unknown(s.local)
        return
      case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': {
        if (n.type === 'FunctionDeclaration' && n.id && !find(n.id.name, scopes)) record(n.id.name, n, scopes)
        const pp = [...scopes, functionScope(n)]
        for (const p of n.params) visit(p, pp, true, null)
        visit(n.body, pp, true, null)
        return
      }
      case 'ClassDeclaration':
        if (n.id && !find(n.id.name, scopes)) unknown(n.id)
        break
      case 'BlockStatement':
        if (inFunction) {
          const pp = [...scopes, blockScope(n.body)]
          n.body.forEach((s: any, i: number) => visit(s, pp, true, s.type === 'ExpressionStatement' ? { list: n.body, i } : null))
          return
        }
        break
      case 'CatchClause': {
        if (!inFunction) unknown(n.param)
        const m: Scope = new Map()
        const t: string[] = []
        patternNames(n.param, t)
        for (const x of t) m.set(x, 'var')
        visit(n.body, inFunction ? [...scopes, m] : scopes, inFunction, null)
        return
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const init = n.type === 'ForStatement' ? n.init : n.left
        const pp = inFunction && init && init.type === 'VariableDeclaration' && init.kind !== 'var' ? [...scopes, declarationScope(init)] : scopes
        if (n.type !== 'ForStatement' && init) {
          const t: string[] = []
          patternNames(init.type === 'VariableDeclaration' ? init.declarations[0].id : init, t)
          for (const x of t) if (!find(x, pp)) { unknowns.add(x); if (!table.has(x)) table.set(x, []) }
        }
        for (const k of ['init', 'test', 'update', 'right', 'body']) visit(n[k], pp, inFunction, null)
        if (n.type !== 'ForStatement' && init && init.type === 'VariableDeclaration') for (const d of init.declarations) visit(d.init, pp, inFunction, null)
        return
      }
      case 'VariableDeclarator':
        if (n.id.type === 'Identifier') { if (!find(n.id.name, scopes)) record(n.id.name, n.init, scopes) }
        else { const t: string[] = []; patternNames(n.id, t); for (const x of t) if (!find(x, scopes)) { unknowns.add(x); if (!table.has(x)) table.set(x, []) } }
        ranges(n.init, scopes, inFunction, ins)
        break
      case 'AssignmentExpression':
        if (n.left.type === 'Identifier') {
          if (!find(n.left.name, scopes)) record(n.left.name, n.right, scopes)
          change(n.left.name, scopes, inFunction, ins)
        }
        else if (n.left.type === 'MemberExpression') {
          change(root(n.left), scopes, inFunction, ins)
          range(n.left, [n.right], scopes)
        }
        else { const t: string[] = []; patternNames(n.left, t); for (const x of t) if (!find(x, scopes)) { unknowns.add(x); if (!table.has(x)) table.set(x, []) } }
        if (n.operator === '=' || n.operator === '||=' || n.operator === '&&=' || n.operator === '??=') ranges(n.right, scopes, inFunction, ins)
        break
      case 'UpdateExpression':
        change(root(n.argument), scopes, inFunction, ins)
        break
      case 'UnaryExpression':
        if (n.operator === 'delete') change(root(n.argument), scopes, inFunction, ins)
        break
      case 'ObjectExpression':
        for (const q of n.properties) if (q.type === 'Property') ranges(q.value, scopes, inFunction, ins)
        break
      case 'ArrayExpression':
        for (const q of n.elements) if (q && q.type !== 'SpreadElement') ranges(q, scopes, inFunction, ins)
        break
      case 'CallExpression': case 'NewExpression': {
        const f = n.callee
        const r = root(f)
        if (r && !find(r, scopes)) for (const a of n.arguments) handed.push({ called: r, arg: a, scopes })
        if (f.type === 'MemberExpression' && !f.computed && f.property.type === 'Identifier' && MUTATEURS.has(f.property.name)) {
          change(root(f.object), scopes, inFunction, ins)
          range(f.object, n.arguments, scopes)
        }
        // arguments qu'un appel peut changer ou ranger : pas ceux d'une fonction du `<script module>`, d'une fonction globale qui
        // lit, ni d'une méthode du langage qui ne fait que les lire ou les appeler (`map(f)`, `get(k)`, `includes(x)`)
        const free = r !== null && !find(r, scopes)
        const onNamespace = free && f.type === 'MemberExpression' && !f.computed && f.object.type === 'Identifier' && SPACES.has(f.object.name)
        const read = f.type === 'MemberExpression' && !f.computed && f.property.type === 'Identifier' && METHODS.has(f.property.name) && !STORERS.has(f.property.name)
        if (onNamespace && WRITERS.has(f.property.name)) {
          ranges(n.arguments[0], scopes, inFunction, ins)
          if (n.arguments[0]) range(n.arguments[0], n.arguments.slice(1), scopes)
        }
        else if (!onNamespace && !read && !(free && (called.has(r) || (f.type === 'Identifier' && GLOBALS.has(r))))) for (const a of n.arguments) ranges(a, scopes, inFunction, ins)
        break
      }
    }
    const list = n.type === 'Program' ? n.body : n.type === 'SwitchCase' ? n.consequent : null
    const rest = n.type === 'ExpressionStatement' || /Expression$|^(SpreadElement|Property|TemplateLiteral)$/.test(n.type) ? ins : null
    for (const k of Object.keys(n)) {
      if (IGNORED_KEYS.has(k)) continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach((x: any, i: number) => visit(x, scopes, inFunction, v === list ? (x && x.type === 'ExpressionStatement' ? { list: v, i } : null) : rest))
      else if (v && typeof v.type === 'string') visit(v, scopes, inFunction, rest)
    }
  }
  visit(ast, [], false, null)
  return { table, members, unknowns, changes, handed }
}

// variables du `<script module>` que le module change lui-même dans une fonction (cf. collecter ; son premier niveau tourne
// une fois, au chargement) : une valeur dérivée qui les lit ne sait pas quand elles changent ; le transpileur les retire des
// variables du module qu'il passe à l'analyseur
export function changingNames(ast: any, names: string[]): Set<string> {
  const out = new Set<string>()
  if (!KNOWN_READS) return out
  for (const [name, l] of collect(ast, new Set(names), new Set()).changes) if (l.some((x) => !x.top)) out.add(name)
  return out
}

// une valeur qui peut porter une lecture de l'état hors de l'analyse : fonction qui lit l'état (ou une locale de la
// fonction qui l'entoure), `this`, `$` nu, nom d'une variable non sûre ; une locale de la fonction appelante passe
function carrier(a: any, scopes: Scope[], c: Context): boolean {
  if (a.type === 'SpreadElement') a = a.argument
  if (a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') return !safe(a, scopes, c, null)
  // objet ou tableau écrit sur place (`Object.assign(outils, { lire: -> $d })`) : ses valeurs
  if (a.type === 'ObjectExpression') return a.properties.some((q: any) => carrier(q.type === 'SpreadElement' ? q : q.value, scopes, c))
  if (a.type === 'ArrayExpression') return a.elements.some((q: any) => q && carrier(q, scopes, c))
  if (a.type === 'ThisExpression') return true
  // une variable du `<script>` porte une lecture par sa valeur (une fonction qui lit l'état), pas parce qu'elle change
  if (a.type === 'Identifier') return !find(a.name, scopes) && (c.script.has(a.name) ? !c.safeVars.has(a.name) : !safeName(a.name, [], c, false))
  return false
}

// noms des valeurs dérivées aux lectures connues : celles que le runtime ne périme que sur l'écriture d'une variable
// de leur fermeture (`_mjs_computedDeps`). `receivers` (rempli s'il est donné) : par valeur connue, les receveurs de
// ses méthodes ordinaires, que l'analyseur enveloppe pour les vérifier au calcul
export function derivedToKnownReads(ast: any, candidates: DerivedCandidate[], dependencies: Record<string, string[]>, moduleVars: string[], externalVars: string[], receivers?: Map<string, Receiver[]>): Set<string> {
  if (!KNOWN_READS) return new Set()
  const { table, members, unknowns, changes, handed } = collect(ast, new Set(moduleVars), new Set(candidates.map((k) => k.node)))
  const script = new Set(table.keys())
  const moduleOnly = new Set(moduleVars.filter((v) => !script.has(v)))
  // variable du module que le `<script>` change (propriété, `push`, `Object.assign`…) : plus une donnée du module seul
  const module = new Set([...moduleOnly].filter((v) => !changes.has(v)))
  const safeVars = new Set<string>()
  // variables du `<script>` qu'une fonction ou une valeur dérivée change (le premier niveau tourne avant toute lecture) ; une
  // fonction passée en rappel (`$l.map(f)`, `appliquer(f)`) ne change pas
  const fn = (v: string) => {
    const l = table.get(v)!.filter((a) => a.value != null)
    return l.length > 0 && l.every((a) => /Function/.test(a.value.type))
  }
  const changing = new Map<string, Set<string>[]>()
  for (const [v, l] of changes) {
    if (!script.has(v)) continue
    const f = l.filter((x) => !x.top && !(x.pass && fn(v)))
    if (f.length > 0) changing.set(v, f.map((x) => x.tracked))
  }
  const ctxScript  = (a: Assignment): Context => ({ mode: 'script', bound: a.scopes.length, inFunction: false, module, script, safeVars, changing })
  const handedCtx  = (a: { scopes: Scope[] }): Context => ({ mode: 'script', bound: a.scopes.length, inFunction: false, module, script, safeVars, changing, handed: true })
  const fixedPoint = () => {
    safeVars.clear()
    for (const v of script) if (!unknowns.has(v)) safeVars.add(v)
    let again = true
    while (again) {
      again = false
      for (const v of [...safeVars]) {
        // ses valeurs, et une fermeture qui lit l'état rangée dedans (`x.p = -> $a`, `Object.assign(x, …)`, `x.push(f)`)
        if (table.get(v)!.some((a) => a.value != null && !safe(a.value, a.scopes, ctxScript(a), null)) || (members.get(v) ?? []).some((a) => carrier(a.value, a.scopes, handedCtx(a)))) {
          safeVars.delete(v)
          again = true
        }
      }
    }
  }
  fixedPoint()
  // une fonction ou une fermeture de l'instance confiée à une fonction du `<script module>`, ou rangée dans un objet du
  // module : le module a pu la garder, et la rappeler depuis une autre de ses fonctions — plus aucune ne compte comme sûre
  if (handed.some((k) => moduleOnly.has(k.called) && carrier(k.arg, k.scopes, handedCtx(k)))) {
    module.clear()
    fixedPoint()
  }
  let change = true
  const definitions = new Map<string, number>()
  for (const k of candidates) definitions.set(k.name, (definitions.get(k.name) ?? 0) + 1)
  const external = new Set(externalVars.map((v) => v.replace(/^\$+/, '')))
  const known = new Set<string>()
  const received = new Map<string, Receiver[]>()
  for (const k of candidates) {
    if (definitions.get(k.name) !== 1 || !dependencies[k.name] || external.has(k.name)) continue
    const locals: Scope[] = k.locals ? [new Map(k.locals.map((x) => [x, 'var'] as [string, 'var'])) as Scope] : []
    const list: Receiver[] = []
    if (k.force || safe(k.node, locals, { mode: 'derived', bound: 0, inFunction: false, module, script, safeVars, changing, deps: new Set(dependencies[k.name]), receivers: list }, null)) {
      known.add(k.name)
      received.set(k.name, list)
    }
  }
  // une valeur dérivée qui en lit une autre aux lectures inconnues (ou une variable externe) l'est aussi
  while (change) {
    change = false
    for (const name of [...known]) {
      if (dependencies[name].some((d) => external.has(d) || (d in dependencies && !known.has(d)))) {
        known.delete(name)
        change = true
      }
    }
  }
  if (receivers) for (const name of known) if (received.get(name)!.length > 0) receivers.set(name, received.get(name)!)
  return known
}
