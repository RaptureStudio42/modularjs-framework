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
// module change lui-même dans une fonction (cf. nomsChangeants, appelé par le
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
export const LECTURES_CONNUES = false

type Portee = Map<string, 'param' | 'fn' | 'var'>

interface Contexte {
  // 'derive' : expression d'une valeur dérivée, ses lectures `$.x` sont ses dépendances, même dans une fonction
  // imbriquée ; 'script' : valeur d'une variable du `<script>`, une lecture `$.x` dans une fonction y échappe
  mode: 'derive' | 'script'
  // portées d'indice inférieur : locales d'une fonction englobante, hors de l'expression (provenance inconnue)
  borne: number
  dansFonction: boolean
  module: Set<string>
  script: Set<string>
  sures: Set<string>
  // variables du `<script>` qu'une fonction change : par changement, les variables `$` écrites juste après (cf. suivie)
  changeantes: Map<string, Set<string>[]>
  // mode 'derive' : variables `$` que la valeur dérivée lit
  deps?: Set<string>
  // mode 'script' : fonction confiée à une fonction du `<script module>` (cf. porteuse) ; elle reçoit les valeurs du module,
  // ses méthodes et parcours passent
  confie?: boolean
  // receveurs des méthodes ordinaires et itérables de l'expression, à vérifier au calcul (mode 'derive' seulement)
  recepteurs?: Recepteur[]
}

// `methode` null : itérable d'un parcours (`Symbol.iterator`)
export interface Recepteur { noeud: any; methode: string | null }

export interface DeriveCandidat {
  nom: string
  noeud: any
  // temporaires déclarés avec l'expression (`ref` de l'`if` sans parenthèses de Civet)
  locaux?: string[]
  // `µderived $v = expression, $a…` : dépendances nommées, l'expression ne s'analyse pas
  force?: boolean
}

const GLOBAUX = new Set(['undefined', 'NaN', 'Infinity', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Intl', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Error', 'TypeError', 'RangeError', 'Promise', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone', 'console'])
// espaces de noms globaux : toute fonction qu'ils portent est sûre (`Math.max`, `Object.assign`, `JSON.stringify`…)
const ESPACES = new Set(['Math', 'JSON', 'Number', 'String', 'Array', 'Object', 'Date', 'Intl', 'Symbol', 'BigInt', 'Promise', 'console'])
// méthodes des valeurs ordinaires (tableaux, chaînes, nombres, dates, Map/Set, Intl, RegExp) : appelées sur n'importe quelle valeur
const METHODES = new Set([
  'at', 'concat', 'entries', 'every', 'fill', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'toReversed', 'toSorted', 'toSpliced', 'unshift', 'values', 'with',
  'charAt', 'charCodeAt', 'codePointAt', 'endsWith', 'localeCompare', 'match', 'matchAll', 'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'replaceAll', 'search', 'split', 'startsWith', 'substring', 'substr', 'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'trim', 'trimEnd', 'trimStart',
  'toFixed', 'toPrecision', 'toExponential', 'toString', 'toLocaleString', 'valueOf',
  'getTime', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds', 'getTimezoneOffset', 'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'getUTCSeconds', 'toISOString', 'toJSON', 'toDateString', 'toTimeString', 'toLocaleDateString', 'toLocaleTimeString',
  'get', 'has', 'hasOwnProperty', 'format', 'formatToParts', 'test', 'exec',
])
// méthodes qui changent leur receveur (tableau, Map, Set)
const MUTATEURS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear'])
// méthodes du langage qui rangent leurs arguments dans une collection (les autres de METHODES ne font que les lire ou les appeler)
const RANGENT = new Set(['push', 'unshift', 'splice', 'fill', 'concat', 'with'])
// fonctions des espaces globaux qui écrivent dans leur premier argument
const ECRIVAINS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])
// fonctions qui parcourent leur premier argument (`Array.from(x)`…), constructeurs aussi (`new Set(x)`…)
const PARCOURENT = new Map([['Array', new Set(['from'])], ['Object', new Set(['fromEntries', 'groupBy'])], ['Promise', new Set(['all', 'allSettled', 'any', 'race'])]])
const PARCOURENT_NEW = new Set(['Set', 'Map', 'WeakSet', 'WeakMap'])

// clés qui ne portent jamais un nœud (les autres se parcourent toutes)
const CLES_IGNOREES = new Set(['type', 'start', 'end', 'loc', 'range'])

function nomsMotif(p: any, out: string[]): void {
  if (!p) return
  switch (p.type) {
    case 'Identifier':        out.push(p.name); break
    case 'ObjectPattern':     for (const q of p.properties ?? []) nomsMotif(q.type === 'RestElement' ? q.argument : q.value, out); break
    case 'ArrayPattern':      for (const q of p.elements ?? []) nomsMotif(q, out); break
    case 'AssignmentPattern': nomsMotif(p.left, out); break
    case 'RestElement':       nomsMotif(p.argument, out); break
  }
}

// `var` et fonctions déclarées dans un corps, sans entrer dans les fonctions imbriquées
function hisser(n: any, m: Portee): void {
  if (!n || typeof n.type !== 'string') return
  if (n.type === 'FunctionDeclaration') { if (n.id) m.set(n.id.name, 'fn'); return }
  if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') return
  if (n.type === 'VariableDeclaration') {
    if (n.kind === 'var') for (const d of n.declarations) { const t: string[] = []; nomsMotif(d.id, t); for (const x of t) m.set(x, 'var') }
    return
  }
  if (/Expression$/.test(n.type) || n.type === 'Identifier' || n.type === 'Literal') return
  for (const k of Object.keys(n)) {
    if (CLES_IGNOREES.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) for (const x of v) hisser(x, m)
    else if (v && typeof v.type === 'string') hisser(v, m)
  }
}

function porteeFonction(fn: any): Portee {
  const m: Portee = new Map()
  for (const p of fn.params) { const t: string[] = []; nomsMotif(p, t); for (const x of t) m.set(x, 'param') }
  if (fn.type === 'FunctionExpression' && fn.id) m.set(fn.id.name, 'fn')
  if (fn.body && fn.body.type === 'BlockStatement') hisser(fn.body, m)
  return m
}

function porteeBloc(stmts: any[]): Portee {
  const m: Portee = new Map()
  for (const s of stmts ?? []) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) { const t: string[] = []; nomsMotif(d.id, t); for (const x of t) m.set(x, 'var') }
    else if (s.type === 'ClassDeclaration' && s.id) m.set(s.id.name, 'var')
    else if (s.type === 'FunctionDeclaration' && s.id) m.set(s.id.name, 'fn')
  }
  return m
}

function porteeDeclaration(d: any): Portee {
  const m: Portee = new Map()
  for (const x of d.declarations) { const t: string[] = []; nomsMotif(x.id, t); for (const n of t) m.set(n, 'var') }
  return m
}

function chercher(nom: string, portees: Portee[]): { i: number; nature: string } | null {
  for (let i = portees.length - 1; i >= 0; i--) {
    const n = portees[i].get(nom)
    if (n) return { i, nature: n }
  }
  return null
}

function nomSur(nom: string, portees: Portee[], c: Contexte, appele: boolean): boolean {
  if (nom === '$' || nom === 'µ' || nom === '_mjsThis' || nom === 'arguments') return false
  const r = chercher(nom, portees)
  if (r) return r.i >= c.borne && (!appele || r.nature === 'fn')
  if (c.module.has(nom)) return true
  if (c.script.has(nom)) return c.sures.has(nom) && suivie(nom, c)
  return GLOBAUX.has(nom)
}

// variable du `<script>` qu'une fonction change : sûre seulement lue par la valeur dérivée elle-même, quand chaque
// changement est suivi, dans le même bloc, de l'écriture d'une variable `$` qu'elle lit — qui la périme
function suivie(nom: string, c: Contexte): boolean {
  const l = c.changeantes.get(nom)
  if (!l) return true
  const d = c.deps
  return c.mode === 'derive' && d !== undefined && l.every((s) => [...s].some((x) => d.has(x)))
}

// receveur ou itérable pris d'une variable sûre du `<script>` ou d'une variable du module (`TABLE.map(f)`, `C.l.get(k)`)
function racineSure(o: any, portees: Portee[], c: Contexte): boolean {
  const r = racine(o)
  return r !== null && !chercher(r, portees) && (c.module.has(r) || (c.script.has(r) && c.sures.has(r) && suivie(r, c)))
}

// l'heure et le hasard : une valeur qui change sans aucune écriture (`Date.now()`, `Date()`, `new Date()` sans argument,
// `Math.random()`, `format()` sans argument d'un `Intl.DateTimeFormat`)
function impur(n: any): boolean {
  const f = n.callee
  if (f.type === 'Identifier') return f.name === 'Date' && (n.type === 'CallExpression' || n.arguments.length === 0)
  if (f.type !== 'MemberExpression' || f.computed || f.property.type !== 'Identifier') return false
  const m = f.property.name
  const o = f.object.type === 'Identifier' ? f.object.name : null
  return (m === 'format' && n.arguments.length === 0) || (o === 'Date' && m === 'now') || (o === 'Math' && m === 'random')
}

// appel qui parcourt son premier argument (cf. PARCOURENT)
function parcourtSonArgument(n: any): boolean {
  const f = n.callee
  if (f.type === 'Identifier') return n.type === 'NewExpression' && PARCOURENT_NEW.has(f.name)
  return f.type === 'MemberExpression' && !f.computed && f.object.type === 'Identifier' && f.property.type === 'Identifier' && PARCOURENT.get(f.object.name)?.has(f.property.name) === true
}

// parcours de `x` (étalement, `for…of`, déstructuration, `Array.from(x)`…) : un littéral se lit tel quel ; dans une valeur
// dérivée, l'itérable est vérifié au calcul (l'itérateur d'un objet de l'utilisateur peut lire l'état) ; dans une fonction
// du `<script>`, sûr sur une variable sûre ou du module seulement
function parcours(x: any, portees: Portee[], c: Contexte, parent: any): boolean {
  if (!x) return true
  if (!sur(x, portees, c, parent)) return false
  if (x.type === 'ArrayExpression' || x.type === 'TemplateLiteral' || (x.type === 'Literal' && typeof x.value === 'string')) return true
  if (c.recepteurs) {
    c.recepteurs.push({ noeud: x, methode: null })
    return true
  }
  return c.confie === true || racineSure(x, portees, c)
}

// `µ.store` lu comme objet d'un accès nommé (`µ.store.nom`) : la clé du magasin, suivie par le chemin des magasins
function estMagasin(n: any): boolean {
  return n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'µ' && n.property.type === 'Identifier' && n.property.name === 'store'
}

// un maillon optionnel dans le receveur (`$a?.b` de `$a?.b.get()`) : l'envelopper couperait le court-circuit de la chaîne
function maillonOptionnel(n: any): boolean {
  while (n.type === 'MemberExpression' || n.type === 'CallExpression') {
    if (n.optional) return true
    n = n.type === 'MemberExpression' ? n.object : n.callee
  }
  return false
}

function appelSur(callee: any, portees: Portee[], c: Contexte, nouveau = false): boolean {
  if (callee.type === 'Identifier') return nomSur(callee.name, portees, c, true)
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    const o = callee.object
    if (o.type === 'Identifier') {
      if (o.name === '$') return false
      if (!chercher(o.name, portees) && !c.script.has(o.name) && (c.module.has(o.name) || ESPACES.has(o.name))) return true
    }
    if (estMagasin(o)) return false
    if (!METHODES.has(callee.property.name) || !sur(o, portees, c, callee)) return false
    // méthode ordinaire : un littéral (tableau, chaîne, expression régulière) est un objet du langage ; tout autre receveur
    // est vérifié au calcul, sauf sous `new` ou dans une chaîne optionnelle, où l'enveloppe changerait le sens de l'appel
    if (o.type === 'Literal' || o.type === 'TemplateLiteral' || o.type === 'ArrayExpression') return true
    if (nouveau || maillonOptionnel(o)) return false
    if (c.recepteurs) {
      c.recepteurs.push({ noeud: o, methode: callee.property.name })
      return true
    }
    // fonction du `<script>` : le receveur ne se vérifie pas
    return c.confie === true || racineSure(o, portees, c)
  }
  if (callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') return sur(callee, portees, c, null)
  return false
}

function cibleSure(t: any, portees: Portee[], c: Contexte): boolean {
  if (t.type === 'Identifier') {
    const r = chercher(t.name, portees)
    if (r) return r.i >= c.borne
    return c.script.has(t.name) && c.sures.has(t.name) && suivie(t.name, c)
  }
  if (t.type === 'MemberExpression') return sur(t, portees, c, null)
  return false
}

// `tete` : motif d'une déclaration, d'une affectation ou d'un paramètre, dont la source se vérifie ailleurs ; un motif de
// tableau plus bas (`{ a: [x] }`, `[[x]]`) parcourt une valeur qu'aucune enveloppe n'atteint
function motifSur(p: any, portees: Portee[], c: Contexte, tete = true): boolean {
  if (!p) return true
  switch (p.type) {
    case 'Identifier':        return true
    case 'AssignmentPattern': return motifSur(p.left, portees, c, tete) && sur(p.right, portees, c, p)
    case 'RestElement':       return motifSur(p.argument, portees, c, false)
    case 'ArrayPattern':      return (tete || c.confie === true) && p.elements.every((q: any) => motifSur(q, portees, c, false))
    case 'ObjectPattern':     return p.properties.every((q: any) => q.type === 'RestElement' ? motifSur(q.argument, portees, c, false) : (!q.computed || sur(q.key, portees, c, q)) && motifSur(q.value, portees, c, false))
    default:                  return false
  }
}

function tous(liste: any[], portees: Portee[], c: Contexte, parent: any): boolean {
  for (const x of liste) if (x && !sur(x, portees, c, parent)) return false
  return true
}

function sur(n: any, portees: Portee[], c: Contexte, parent: any): boolean {
  if (!n || typeof n.type !== 'string') return true
  switch (n.type) {
    case 'ThisExpression': case 'Super': case 'MetaProperty': case 'ImportExpression': case 'ClassExpression': case 'ClassDeclaration': case 'WithStatement':
      return false
    case 'Literal': case 'TemplateElement': case 'EmptyStatement': case 'DebuggerStatement': case 'BreakStatement': case 'ContinueStatement':
      return true
    case 'Identifier':
      return nomSur(n.name, portees, c, false)
    case 'MemberExpression': {
      const o = n.object
      if (o.type === 'Identifier' && o.name === '$') return !n.computed && !(c.mode === 'script' && c.dansFonction)
      if (o.type === 'Identifier' && o.name === 'µ') return estMagasin(n) && parent != null && parent.type === 'MemberExpression' && parent.object === n && !parent.computed && !(c.mode === 'script' && c.dansFonction)
      return sur(o, portees, c, n) && (!n.computed || sur(n.property, portees, c, n))
    }
    case 'CallExpression': case 'NewExpression': {
      if (impur(n) || !appelSur(n.callee, portees, c, n.type === 'NewExpression')) return false
      if (!parcourtSonArgument(n) || n.arguments.length === 0) return tous(n.arguments, portees, c, n)
      const a = n.arguments[0]
      return a.type !== 'SpreadElement' && parcours(a, portees, c, n) && tous(n.arguments.slice(1), portees, c, n)
    }
    case 'SpreadElement':
      return parent && parent.type === 'ObjectExpression' ? sur(n.argument, portees, c, n) : parcours(n.argument, portees, c, n)
    case 'YieldExpression':
      return n.delegate ? parcours(n.argument, portees, c, n) : sur(n.argument, portees, c, n)
    case 'TaggedTemplateExpression':
      return appelSur(n.tag, portees, c) && sur(n.quasi, portees, c, n)
    case 'ChainExpression':
      return sur(n.expression, portees, c, n)
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': {
      const pp = [...portees, porteeFonction(n)]
      const c2 = c.dansFonction ? c : { ...c, dansFonction: true }
      return n.params.every((p: any) => motifSur(p, pp, c2)) && sur(n.body, pp, c2, n)
    }
    case 'BlockStatement': case 'StaticBlock':
      return tous(n.body, [...portees, porteeBloc(n.body)], c, n)
    case 'SwitchStatement':
      return sur(n.discriminant, portees, c, n) && tous(n.cases, [...portees, porteeBloc(n.cases.flatMap((k: any) => k.consequent))], c, n)
    case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
      const init = n.type === 'ForStatement' ? n.init : n.left
      const pp = init && init.type === 'VariableDeclaration' && init.kind !== 'var' ? [...portees, porteeDeclaration(init)] : portees
      if (n.type !== 'ForStatement' && init && init.type !== 'VariableDeclaration' && !cibleSure(init, pp, c)) return false
      // `for await` : l'itérateur asynchrone ne se vérifie pas
      if (n.type === 'ForOfStatement' && n.await) return false
      return (n.type !== 'ForStatement' || sur(n.init, pp, c, n)) && (n.type === 'ForStatement' || init.type !== 'VariableDeclaration' || sur(init, pp, c, n)) && sur(n.test, pp, c, n) && sur(n.update, pp, c, n) && (n.type === 'ForOfStatement' ? parcours(n.right, pp, c, n) : sur(n.right, pp, c, n)) && sur(n.body, pp, c, n)
    }
    case 'CatchClause': {
      const m: Portee = new Map()
      const t: string[] = []
      nomsMotif(n.param, t)
      for (const x of t) m.set(x, 'var')
      return sur(n.body, [...portees, m], c, n)
    }
    case 'VariableDeclarator':
      return motifSur(n.id, portees, c) && (n.id.type === 'ArrayPattern' ? parcours(n.init, portees, c, n) : sur(n.init, portees, c, n))
    case 'AssignmentExpression':
      return cibleSure(n.left, portees, c) && sur(n.right, portees, c, n)
    case 'UpdateExpression':
      return cibleSure(n.argument, portees, c)
    case 'Property':
      return (!n.computed || sur(n.key, portees, c, n)) && sur(n.value, portees, c, n)
    case 'LabeledStatement':
      return sur(n.body, portees, c, n)
  }
  for (const k of Object.keys(n)) {
    if (CLES_IGNOREES.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) { if (!tous(v, portees, c, n)) return false }
    else if (v && typeof v.type === 'string' && !sur(v, portees, c, n)) return false
  }
  return true
}

interface Affectation { valeur: any; portees: Portee[] }

// racine nommée d'un accès (`C.a.b` → `C`), null sinon
function racine(n: any): string | null {
  while (n && n.type === 'MemberExpression') n = n.object
  return n && n.type === 'Identifier' ? n.name : null
}

// variable `$` écrite par `t` (`$.y`, `$.y.z`), null sinon
function etatEcrit(t: any): string | null {
  while (t && t.type === 'MemberExpression') {
    if (t.object.type === 'Identifier' && t.object.name === '$') return t.computed ? null : t.property.name
    t = t.object
  }
  return null
}

// variables `$` écrites par les instructions qui suivent la `i`-ième de `liste` : affectations seules, jusqu'à la première
// autre instruction (un `return` d'une affectation compris, l'écriture implicite de Civet et de CoffeeScript)
function ecritesApres(liste: any[], i: number): Set<string> {
  const s = new Set<string>()
  for (let j = i + 1; j < liste.length; j++) {
    const t = liste[j]
    const e = t.type === 'ExpressionStatement' ? t.expression : t.type === 'ReturnStatement' ? t.argument : null
    if (!e) break
    let toutes = true
    for (const x of e.type === 'SequenceExpression' ? e.expressions : [e]) {
      const nom = x.type === 'AssignmentExpression' ? etatEcrit(x.left) : x.type === 'UpdateExpression' ? etatEcrit(x.argument) : null
      if (nom) s.add(nom)
      else toutes = false
    }
    if (!toutes || t.type === 'ReturnStatement') break
  }
  return s
}

// noms des valeurs que `v` désigne (`x`, `x.a`, `c ? x : y`, `x || y`) : une affectation les range ailleurs, un appel les reçoit
function designes(v: any, out: string[]): string[] {
  if (!v) return out
  if (v.type === 'SpreadElement' || v.type === 'ChainExpression') return designes(v.type === 'SpreadElement' ? v.argument : v.expression, out)
  if (v.type === 'ConditionalExpression') return designes(v.alternate, designes(v.consequent, out))
  if (v.type === 'LogicalExpression') return designes(v.right, designes(v.left, out))
  if (v.type === 'SequenceExpression') return designes(v.expressions[v.expressions.length - 1], out)
  const r = racine(v)
  if (r) out.push(r)
  return out
}

interface Instruction { liste: any[]; i: number }

// un changement d'une variable : variables `$` écrites juste après (cf. ecritesApres) ; `haut` : au premier niveau ; `passe` :
// passée à un appel ou rangée ailleurs (sans effet sur une fonction)
interface Changement { suivis: Set<string>; haut: boolean; passe: boolean }

// affectations des variables du `<script>` (premier niveau) : chaque valeur avec les portées qui l'entourent. Une
// affectation dans une fonction à une variable locale de cette fonction ne compte pas ; une valeur illisible (motif,
// classe, boucle `for … of`, `catch`, import) rend la variable inconnue. `membres` : valeurs rangées DANS une variable
// (`x.p = v`, `Object.assign(x, v)`, `x.push(v)`), qui comptent comme les siennes. `changes` : par variable du premier
// niveau, ses changements — réaffectée, `+=`, `++`, propriété écrite ou effacée, méthode qui la change (`push`, `set`…),
// passée à une fonction qui peut la changer (hors fonction du `<script module>`, `appeles`, et fonction globale qui ne
// fait que lire), rangée ailleurs (`y = x`, `{ k: x }`, `[x]`) ; dans une fonction ou dans l'expression d'une valeur
// dérivée (`derives`), recalculée à toute heure, sinon au premier niveau (`haut`, qui tourne une fois, avant toute
// lecture). `confies` : arguments nommés ou fonctions passés à un appel dont le nom est `appele` (une fonction du
// `<script module>` qui garderait une fermeture de l'instance), ou rangés dans la variable `appele`
function collecter(ast: any, appeles: Set<string>, derives: Set<any>): { table: Map<string, Affectation[]>; membres: Map<string, Affectation[]>; inconnues: Set<string>; changes: Map<string, Changement[]>; confies: { appele: string; arg: any; portees: Portee[] }[] } {
  const table = new Map<string, Affectation[]>()
  const membres = new Map<string, Affectation[]>()
  const inconnues = new Set<string>()
  const changes = new Map<string, Changement[]>()
  const confies: { appele: string; arg: any; portees: Portee[] }[] = []
  const noter = (nom: string, valeur: any, portees: Portee[]) => {
    let l = table.get(nom)
    if (!l) table.set(nom, l = [])
    l.push({ valeur, portees })
  }
  const inconnu = (motif: any) => { const t: string[] = []; nomsMotif(motif, t); for (const x of t) { inconnues.add(x); if (!table.has(x)) table.set(x, []) } }
  const change = (nom: string | null, portees: Portee[], enFonction: boolean, ins: Instruction | null, passe = false) => {
    if (!nom || nom === '$' || nom === 'µ' || nom === '_mjsThis' || chercher(nom, portees)) return
    let l = changes.get(nom)
    if (!l) changes.set(nom, l = [])
    l.push({ suivis: ins ? ecritesApres(ins.liste, ins.i) : new Set(), haut: !enFonction, passe })
  }
  // `valeurs` rangées dans la variable qui porte `cible` (`x.p = v` : `x`)
  const range = (cible: any, valeurs: any[], portees: Portee[]) => {
    const r = racine(cible)
    if (!r || chercher(r, portees)) return
    let l = membres.get(r)
    if (!l) membres.set(r, l = [])
    for (const v of valeurs) {
      if (!v) continue
      l.push({ valeur: v.type === 'SpreadElement' ? v.argument : v, portees })
      confies.push({ appele: r, arg: v, portees })
    }
  }
  const ranges = (v: any, portees: Portee[], enFonction: boolean, ins: Instruction | null) => { for (const x of designes(v, [])) change(x, portees, enFonction, ins, true) }
  const visiter = (n: any, portees: Portee[], enFonction: boolean, ins: Instruction | null): void => {
    if (!n || typeof n.type !== 'string') return
    // expression d'une valeur dérivée : recalculée à toute heure, comme une fonction ; rien ne la suit
    if (derives.has(n)) { enFonction = true; ins = null }
    switch (n.type) {
      case 'ImportDeclaration':
        for (const s of n.specifiers ?? []) inconnu(s.local)
        return
      case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': {
        if (n.type === 'FunctionDeclaration' && n.id && !chercher(n.id.name, portees)) noter(n.id.name, n, portees)
        const pp = [...portees, porteeFonction(n)]
        for (const p of n.params) visiter(p, pp, true, null)
        visiter(n.body, pp, true, null)
        return
      }
      case 'ClassDeclaration':
        if (n.id && !chercher(n.id.name, portees)) inconnu(n.id)
        break
      case 'BlockStatement':
        if (enFonction) {
          const pp = [...portees, porteeBloc(n.body)]
          n.body.forEach((s: any, i: number) => visiter(s, pp, true, s.type === 'ExpressionStatement' ? { liste: n.body, i } : null))
          return
        }
        break
      case 'CatchClause': {
        if (!enFonction) inconnu(n.param)
        const m: Portee = new Map()
        const t: string[] = []
        nomsMotif(n.param, t)
        for (const x of t) m.set(x, 'var')
        visiter(n.body, enFonction ? [...portees, m] : portees, enFonction, null)
        return
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const init = n.type === 'ForStatement' ? n.init : n.left
        const pp = enFonction && init && init.type === 'VariableDeclaration' && init.kind !== 'var' ? [...portees, porteeDeclaration(init)] : portees
        if (n.type !== 'ForStatement' && init) {
          const t: string[] = []
          nomsMotif(init.type === 'VariableDeclaration' ? init.declarations[0].id : init, t)
          for (const x of t) if (!chercher(x, pp)) { inconnues.add(x); if (!table.has(x)) table.set(x, []) }
        }
        for (const k of ['init', 'test', 'update', 'right', 'body']) visiter(n[k], pp, enFonction, null)
        if (n.type !== 'ForStatement' && init && init.type === 'VariableDeclaration') for (const d of init.declarations) visiter(d.init, pp, enFonction, null)
        return
      }
      case 'VariableDeclarator':
        if (n.id.type === 'Identifier') { if (!chercher(n.id.name, portees)) noter(n.id.name, n.init, portees) }
        else { const t: string[] = []; nomsMotif(n.id, t); for (const x of t) if (!chercher(x, portees)) { inconnues.add(x); if (!table.has(x)) table.set(x, []) } }
        ranges(n.init, portees, enFonction, ins)
        break
      case 'AssignmentExpression':
        if (n.left.type === 'Identifier') {
          if (!chercher(n.left.name, portees)) noter(n.left.name, n.right, portees)
          change(n.left.name, portees, enFonction, ins)
        }
        else if (n.left.type === 'MemberExpression') {
          change(racine(n.left), portees, enFonction, ins)
          range(n.left, [n.right], portees)
        }
        else { const t: string[] = []; nomsMotif(n.left, t); for (const x of t) if (!chercher(x, portees)) { inconnues.add(x); if (!table.has(x)) table.set(x, []) } }
        if (n.operator === '=' || n.operator === '||=' || n.operator === '&&=' || n.operator === '??=') ranges(n.right, portees, enFonction, ins)
        break
      case 'UpdateExpression':
        change(racine(n.argument), portees, enFonction, ins)
        break
      case 'UnaryExpression':
        if (n.operator === 'delete') change(racine(n.argument), portees, enFonction, ins)
        break
      case 'ObjectExpression':
        for (const q of n.properties) if (q.type === 'Property') ranges(q.value, portees, enFonction, ins)
        break
      case 'ArrayExpression':
        for (const q of n.elements) if (q && q.type !== 'SpreadElement') ranges(q, portees, enFonction, ins)
        break
      case 'CallExpression': case 'NewExpression': {
        const f = n.callee
        const r = racine(f)
        if (r && !chercher(r, portees)) for (const a of n.arguments) confies.push({ appele: r, arg: a, portees })
        if (f.type === 'MemberExpression' && !f.computed && f.property.type === 'Identifier' && MUTATEURS.has(f.property.name)) {
          change(racine(f.object), portees, enFonction, ins)
          range(f.object, n.arguments, portees)
        }
        // arguments qu'un appel peut changer ou ranger : pas ceux d'une fonction du `<script module>`, d'une fonction globale qui
        // lit, ni d'une méthode du langage qui ne fait que les lire ou les appeler (`map(f)`, `get(k)`, `includes(x)`)
        const libre = r !== null && !chercher(r, portees)
        const espace = libre && f.type === 'MemberExpression' && !f.computed && f.object.type === 'Identifier' && ESPACES.has(f.object.name)
        const lecture = f.type === 'MemberExpression' && !f.computed && f.property.type === 'Identifier' && METHODES.has(f.property.name) && !RANGENT.has(f.property.name)
        if (espace && ECRIVAINS.has(f.property.name)) {
          ranges(n.arguments[0], portees, enFonction, ins)
          if (n.arguments[0]) range(n.arguments[0], n.arguments.slice(1), portees)
        }
        else if (!espace && !lecture && !(libre && (appeles.has(r) || (f.type === 'Identifier' && GLOBAUX.has(r))))) for (const a of n.arguments) ranges(a, portees, enFonction, ins)
        break
      }
    }
    const liste = n.type === 'Program' ? n.body : n.type === 'SwitchCase' ? n.consequent : null
    const suite = n.type === 'ExpressionStatement' || /Expression$|^(SpreadElement|Property|TemplateLiteral)$/.test(n.type) ? ins : null
    for (const k of Object.keys(n)) {
      if (CLES_IGNOREES.has(k)) continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach((x: any, i: number) => visiter(x, portees, enFonction, v === liste ? (x && x.type === 'ExpressionStatement' ? { liste: v, i } : null) : suite))
      else if (v && typeof v.type === 'string') visiter(v, portees, enFonction, suite)
    }
  }
  visiter(ast, [], false, null)
  return { table, membres, inconnues, changes, confies }
}

// variables du `<script module>` que le module change lui-même dans une fonction (cf. collecter ; son premier niveau tourne
// une fois, au chargement) : une valeur dérivée qui les lit ne sait pas quand elles changent ; le transpileur les retire des
// variables du module qu'il passe à l'analyseur
export function nomsChangeants(ast: any, noms: string[]): Set<string> {
  const out = new Set<string>()
  if (!LECTURES_CONNUES) return out
  for (const [nom, l] of collecter(ast, new Set(noms), new Set()).changes) if (l.some((x) => !x.haut)) out.add(nom)
  return out
}

// une valeur qui peut porter une lecture de l'état hors de l'analyse : fonction qui lit l'état (ou une locale de la
// fonction qui l'entoure), `this`, `$` nu, nom d'une variable non sûre ; une locale de la fonction appelante passe
function porteuse(a: any, portees: Portee[], c: Contexte): boolean {
  if (a.type === 'SpreadElement') a = a.argument
  if (a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') return !sur(a, portees, c, null)
  // objet ou tableau écrit sur place (`Object.assign(outils, { lire: -> $d })`) : ses valeurs
  if (a.type === 'ObjectExpression') return a.properties.some((q: any) => porteuse(q.type === 'SpreadElement' ? q : q.value, portees, c))
  if (a.type === 'ArrayExpression') return a.elements.some((q: any) => q && porteuse(q, portees, c))
  if (a.type === 'ThisExpression') return true
  // une variable du `<script>` porte une lecture par sa valeur (une fonction qui lit l'état), pas parce qu'elle change
  if (a.type === 'Identifier') return !chercher(a.name, portees) && (c.script.has(a.name) ? !c.sures.has(a.name) : !nomSur(a.name, [], c, false))
  return false
}

// noms des valeurs dérivées aux lectures connues : celles que le runtime ne périme que sur l'écriture d'une variable
// de leur fermeture (`_mjs_computedDeps`). `recepteurs` (rempli s'il est donné) : par valeur connue, les receveurs de
// ses méthodes ordinaires, que l'analyseur enveloppe pour les vérifier au calcul
export function derivesAuxLecturesConnues(ast: any, candidats: DeriveCandidat[], dependances: Record<string, string[]>, moduleVars: string[], externalVars: string[], recepteurs?: Map<string, Recepteur[]>): Set<string> {
  if (!LECTURES_CONNUES) return new Set()
  const { table, membres, inconnues, changes, confies } = collecter(ast, new Set(moduleVars), new Set(candidats.map((k) => k.noeud)))
  const script = new Set(table.keys())
  const duModule = new Set(moduleVars.filter((v) => !script.has(v)))
  // variable du module que le `<script>` change (propriété, `push`, `Object.assign`…) : plus une donnée du module seul
  const module = new Set([...duModule].filter((v) => !changes.has(v)))
  const sures = new Set<string>()
  // variables du `<script>` qu'une fonction ou une valeur dérivée change (le premier niveau tourne avant toute lecture) ; une
  // fonction passée en rappel (`$l.map(f)`, `appliquer(f)`) ne change pas
  const fonction = (v: string) => {
    const l = table.get(v)!.filter((a) => a.valeur != null)
    return l.length > 0 && l.every((a) => /Function/.test(a.valeur.type))
  }
  const changeantes = new Map<string, Set<string>[]>()
  for (const [v, l] of changes) {
    if (!script.has(v)) continue
    const f = l.filter((x) => !x.haut && !(x.passe && fonction(v)))
    if (f.length > 0) changeantes.set(v, f.map((x) => x.suivis))
  }
  const ctxScript = (a: Affectation): Contexte => ({ mode: 'script', borne: a.portees.length, dansFonction: false, module, script, sures, changeantes })
  const ctxConfie = (a: { portees: Portee[] }): Contexte => ({ mode: 'script', borne: a.portees.length, dansFonction: false, module, script, sures, changeantes, confie: true })
  const pointFixe = () => {
    sures.clear()
    for (const v of script) if (!inconnues.has(v)) sures.add(v)
    let encore = true
    while (encore) {
      encore = false
      for (const v of [...sures]) {
        // ses valeurs, et une fermeture qui lit l'état rangée dedans (`x.p = -> $a`, `Object.assign(x, …)`, `x.push(f)`)
        if (table.get(v)!.some((a) => a.valeur != null && !sur(a.valeur, a.portees, ctxScript(a), null)) || (membres.get(v) ?? []).some((a) => porteuse(a.valeur, a.portees, ctxConfie(a)))) {
          sures.delete(v)
          encore = true
        }
      }
    }
  }
  pointFixe()
  // une fonction ou une fermeture de l'instance confiée à une fonction du `<script module>`, ou rangée dans un objet du
  // module : le module a pu la garder, et la rappeler depuis une autre de ses fonctions — plus aucune ne compte comme sûre
  if (confies.some((k) => duModule.has(k.appele) && porteuse(k.arg, k.portees, ctxConfie(k)))) {
    module.clear()
    pointFixe()
  }
  let change = true
  const definitions = new Map<string, number>()
  for (const k of candidats) definitions.set(k.nom, (definitions.get(k.nom) ?? 0) + 1)
  const externes = new Set(externalVars.map((v) => v.replace(/^\$+/, '')))
  const connues = new Set<string>()
  const recus = new Map<string, Recepteur[]>()
  for (const k of candidats) {
    if (definitions.get(k.nom) !== 1 || !dependances[k.nom] || externes.has(k.nom)) continue
    const locaux: Portee[] = k.locaux ? [new Map(k.locaux.map((x) => [x, 'var'] as [string, 'var'])) as Portee] : []
    const liste: Recepteur[] = []
    if (k.force || sur(k.noeud, locaux, { mode: 'derive', borne: 0, dansFonction: false, module, script, sures, changeantes, deps: new Set(dependances[k.nom]), recepteurs: liste }, null)) {
      connues.add(k.nom)
      recus.set(k.nom, liste)
    }
  }
  // une valeur dérivée qui en lit une autre aux lectures inconnues (ou une variable externe) l'est aussi
  while (change) {
    change = false
    for (const nom of [...connues]) {
      if (dependances[nom].some((d) => externes.has(d) || (d in dependances && !connues.has(d)))) {
        connues.delete(nom)
        change = true
      }
    }
  }
  if (recepteurs) for (const nom of connues) if (recus.get(nom)!.length > 0) recepteurs.set(nom, recus.get(nom)!)
  return connues
}
