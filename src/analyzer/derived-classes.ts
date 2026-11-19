// ============================================================================
// Classement des valeurs dérivées : « précise » ou « horloge » (lu par `mjs check --derived`).
//
// PRÉCISE : le compilateur prouve ce qu'elle lit (cf. preciseDerived plus bas : variables `$` du composant, littéraux,
// opérateurs, champs lus, appels de la liste courte) ; au runtime, elle suit ses sources, sauf quand elle repasse à l'horloge (docs/03-reactivite.md).
// HORLOGE : tout le reste ; elle garde la règle de toujours (refaite à sa lecture après toute écriture du composant).
// Chaque valeur à l'horloge donne sa raison — une lecture qui échappe à l'analyse des lectures ci-dessous, ou à défaut la
// première forme hors de la liste courte :
//   import      fonction ou valeur importée (`@import`)
//   variable    variable ordinaire changée ailleurs : par une fonction, une valeur dérivée, un gestionnaire du
//               gabarit, `@this=!{nom}` ; ou locale d'une fonction qui entoure la valeur lue
//   globale     nom hors du composant et hors de la liste du langage (`window`, `document`, `localStorage`…)
//   instance    propriété ou méthode du composant (`@x`, `@@x`, `this`)
//   heure       `Date.now()`, `Date()`, `new Date()` sans argument, `performance.now()`, `format()` sans argument
//   hasard      `Math.random()`
//   methode     méthode hors de la liste du langage sur une valeur dont on ne connaît pas l'objet
//   fonction    fonction non suivie : rangée dans l'état (`$f()`), locale ou paramètre appelé, appel calculé
//   rune        rune du framework (`µ.…`, hors `µ.store.nom`)
//   contexte    contexte non réactif (`§x`)
//   cle         clé calculée (`$[k]`, `$$[k]`)
//   etat        l'état entier (`$` nu, `$$` nu)
//   alias       variable du `<script>` qui garde une valeur de l'état lue au premier niveau
//   attente     `await` : ce qui se lit après l'attente échappe au calcul
//   derivee     autre valeur dérivée à l'horloge
//   double      valeur dérivée définie plusieurs fois
//   inconnue    forme non suivie (classe, `arguments`, `import.meta`, motif inconnu…)
//   liste       forme hors de la liste courte des valeurs précises (fonction ou constante du `<script>`, magasin, contexte,
//               méthode hors de la liste, `µderived`…)
//   garde       variable `$` qui reçoit un objet que le script garde (`$x = nom`, `nom` hors des paramètres de la fonction
//               qui écrit) : le script peut le changer sans que MJS le voie
//   simple      calcul plus court que sa vérification (lectures, `.length`, opérateurs, `Math.*`, conversions) : la refaire
//               coûte moins que vérifier ses sources
// `par` : la fonction ou la variable du composant par laquelle passe la lecture.
// Calculé seulement sur demande (`TranspileOpts.derived`) ; le code produit en dépend par `preciseDerived` et `doubtfulVariables`, que lit l'analyseur (analyzer/index.ts).
// ============================================================================

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { collect, functionScope, blockScope, declarationScope, find, patternNames, root, isStore, GLOBALS, SPACES, METHODS, MUTATEURS, type Scope, type Assignment, type Change, type DerivedCandidate } from './derived-reads.js'

export type ReasonCode = 'import' | 'variable' | 'global' | 'instance' | 'time' | 'random' | 'method' | 'function' | 'rune' | 'context' | 'key' | 'state' | 'alias' | 'await' | 'derived' | 'double' | 'unknown' | 'list' | 'guard' | 'simple'

export interface ClockReason { code: ReasonCode; name?: string; by?: string }

export interface ClassifiedDerived {
  /** nom sans `$` */
  name: string
  class: 'precise' | 'clock'
  /** vide pour une valeur précise */
  reasons: ClockReason[]
}

export interface ClassificationInput {
  /** AST du JS compilé du `<script>` (null : aucun) */
  script: any
  /** AST du JS compilé du `<script module>`, imports de `@import` compris (null : aucun) */
  module: any
  candidates: DerivedCandidate[]
  moduleVars: string[]
  /** variables externes, avec leur `$` (`µ$$x` importé : `$x`) */
  externalVars: string[]
  /** noms posés par les imports du `<script module>` */
  imports: string[]
  /** JS compilé des gestionnaires du gabarit (vide : aucun) */
  handlers: string
  /** variables nues de `@this=!{nom}` */
  refs: string[]
  /** le composant écrit l'état sans MJS (cf. RAW_WRITE) : aucune valeur précise */
  raw?: boolean
  /** méthodes du composant (`@m = ->`, écrites une seule fois, au premier niveau) suivies comme les fonctions du
   *  `<script>` ; sans lui, une valeur qui en appelle une est à l'horloge (propriété du composant) */
  trackMethods?: boolean
}

interface Ctx {
  // 'derived' : l'expression ; 'script' : valeur d'une variable du `<script>` ; 'module' : du `<script module>`
  mode: 'derived' | 'script' | 'module'
  // portées d'indice inférieur : locales d'une fonction qui entoure la valeur lue (provenance inconnue)
  bound: number
  inFunction: boolean
  reasons: ClockReason[]
  script: Map<string, ClockReason[]>
  module: Map<string, ClockReason[]>
  imports: Set<string>
  external: Set<string>
  // noms que le gabarit change sans que le `<script>` les déclare (`@this=!{nom}` auto-déclaré…)
  template: Set<string>
}

const KEYS = new Set(['type', 'start', 'end', 'loc', 'range'])

function record(c: Ctx, r: ClockReason): void {
  c.reasons.push(r)
}

// raisons d'une variable du composant, lue par la valeur : la lecture passe par elle
function resume(c: Ctx, list: ClockReason[], by: string): void {
  for (const r of list) c.reasons.push(r.code === 'variable' && r.name === by ? r : { ...r, by: by })
}

function readName(name: string, scopes: Scope[], c: Ctx, called: boolean): void {
  if (name === '$') return record(c, { code: 'state', name: '$' })
  if (name === 'µ') return record(c, { code: 'rune', name: 'µ' })
  if (name === '_mjsThis') return record(c, { code: 'instance', name: '@@' })
  if (name === 'arguments') return record(c, { code: 'unknown', name: 'arguments' })
  const r = find(name, scopes)
  if (r) {
    if (r.i < c.bound) return record(c, { code: 'variable', name: name })
    if (called && r.nature !== 'fn') record(c, { code: 'function', name: name + '()' })
    return
  }
  if (c.script.has(name)) return resume(c, c.script.get(name)!, name)
  if (c.template.has(name)) return record(c, { code: 'variable', name: name })
  if (c.module.has(name)) return resume(c, c.module.get(name)!, name)
  // `µ$$x` importé : un magasin, donc une source
  if (c.external.has(name)) return
  if (c.imports.has(name)) return record(c, { code: 'import', name: name })
  if (GLOBALS.has(name)) return
  record(c, { code: 'global', name: name })
}

// l'heure et le hasard : une valeur qui change sans aucune écriture
function clockOrRandom(n: any): ClockReason | null {
  const f = n.callee
  if (f.type === 'Identifier') return f.name === 'Date' && (n.type === 'CallExpression' || n.arguments.length === 0) ? { code: 'time', name: n.type === 'NewExpression' ? 'new Date()' : 'Date()' } : null
  if (f.type !== 'MemberExpression' || f.computed || f.property.type !== 'Identifier') return null
  const m = f.property.name
  const o = f.object.type === 'Identifier' ? f.object.name : null
  if (o === 'Date' && m === 'now') return { code: 'time', name: 'Date.now()' }
  if (o === 'performance' && m === 'now') return { code: 'time', name: 'performance.now()' }
  if (o === 'Math' && m === 'random') return { code: 'random', name: 'Math.random()' }
  if ((m === 'format' || m === 'formatToParts') && n.arguments.length === 0) return { code: 'time', name: m + '()' }
  return null
}

// `§x` : la clé lue, quand elle est écrite en toutes lettres
function contextKey(call: any): string {
  const a = call.arguments[0]
  return a && a.type === 'Literal' && typeof a.value === 'string' ? a.value : '…'
}

function visitCall(f: any, scopes: Scope[], c: Ctx, call: any): void {
  if (f.type === 'Identifier') return readName(f.name, scopes, c, true)
  // fonction appelée sur place : son corps tourne au moment de l'appel
  if (f.type === 'FunctionExpression' || f.type === 'ArrowFunctionExpression') return walkFunction(f, scopes, c, false)
  if (f.type !== 'MemberExpression') {
    record(c, { code: 'function', name: '…()' })
    return traverse(f, scopes, c, call)
  }
  const o = f.object
  if (f.computed || f.property.type !== 'Identifier') {
    record(c, { code: 'function', name: '[…]()' })
    traverse(o, scopes, c, f)
    return traverse(f.property, scopes, c, f)
  }
  const m = f.property.name
  if (o.type === 'Identifier') {
    if (o.name === '$') return record(c, { code: 'function', name: '$' + m + '()' })
    if (o.name === '_mjsThis') {
      // `§§x` : contexte réactif, une source
      if (m === '_mjs_getRCtx') return
      if (m === '_mjs_getContext') return record(c, { code: 'context', name: '§' + contextKey(call) })
      if (c.script.has('@' + m)) return resume(c, c.script.get('@' + m)!, '@@' + m)
      return record(c, { code: 'instance', name: '@@' + m + '()' })
    }
    if (o.name === 'µ') return record(c, { code: 'rune', name: 'µ.' + m })
    // `Math.max`, `JSON.stringify`, `Object.keys`… (`Math.random` : cf. clockOrRandom)
    if (SPACES.has(o.name) && !find(o.name, scopes) && !c.script.has(o.name) && !c.module.has(o.name) && !c.imports.has(o.name)) return
  }
  if (o.type === 'ThisExpression') return c.script.has('@' + m) ? resume(c, c.script.get('@' + m)!, '@' + m) : record(c, { code: 'instance', name: '@' + m + '()' })
  if (isStore(o)) return record(c, { code: 'function', name: '$$' + m + '()' })
  const before = c.reasons.length
  traverse(o, scopes, c, f)
  // receveur déjà à l'horloge : la méthode n'ajoute rien
  if (c.reasons.length > before) return
  if (o.type === 'Literal' || o.type === 'TemplateLiteral' || o.type === 'ArrayExpression' || o.type === 'ObjectExpression') return
  if (METHODS.has(m) || MUTATEURS.has(m)) return
  // receveur pris d'une constante du `<script>` ou du module, ou d'un espace du langage (`Math.max.apply`) : ses
  // méthodes sont des valeurs qu'on a lues
  const r = root(o)
  if (r !== null && !find(r, scopes) && (c.script.has(r) || c.module.has(r) || (SPACES.has(r) && !c.imports.has(r)))) return
  record(c, { code: 'method', name: '.' + m + '()' })
}

// `deferred` : fonction définie ici, appelée plus tard (rappel, fonction rangée) ; faux : appelée sur place
function walkFunction(n: any, scopes: Scope[], c: Ctx, deferred = true): void {
  const pp = [...scopes, functionScope(n)]
  const c2 = deferred && !c.inFunction ? { ...c, inFunction: true } : c
  for (const p of n.params) pattern(p, pp, c2)
  traverse(n.body, pp, c2, n)
}

function pattern(p: any, scopes: Scope[], c: Ctx): void {
  if (!p) return
  switch (p.type) {
    case 'Identifier':        return
    case 'AssignmentPattern': pattern(p.left, scopes, c); return traverse(p.right, scopes, c, p)
    case 'RestElement':       return pattern(p.argument, scopes, c)
    case 'ArrayPattern':      for (const q of p.elements) pattern(q, scopes, c); return
    case 'ObjectPattern':
      for (const q of p.properties) {
        if (q.type === 'RestElement') pattern(q.argument, scopes, c)
        else {
          if (q.computed) traverse(q.key, scopes, c, q)
          pattern(q.value, scopes, c)
        }
      }
      return
    case 'MemberExpression':  return traverse(p, scopes, c, null)
    default:                  return record(c, { code: 'unknown', name: p.type })
  }
}

// cible d'une écriture faite par la valeur lue elle-même
function target(t: any, scopes: Scope[], c: Ctx): void {
  if (t.type !== 'Identifier') return pattern(t, scopes, c)
  const r = find(t.name, scopes)
  if (r) {
    if (r.i < c.bound) record(c, { code: 'variable', name: t.name })
    return
  }
  // variable du composant écrite ici : `collect` l'a déjà comptée comme changée
  if (c.script.has(t.name)) return resume(c, c.script.get(t.name)!, t.name)
  if (c.module.has(t.name)) return resume(c, c.module.get(t.name)!, t.name)
  record(c, { code: 'global', name: t.name })
}

function traverse(n: any, scopes: Scope[], c: Ctx, parent: any): void {
  if (!n || typeof n.type !== 'string') return
  switch (n.type) {
    case 'Literal': case 'TemplateElement': case 'EmptyStatement': case 'DebuggerStatement': case 'BreakStatement': case 'ContinueStatement':
      return
    case 'Identifier':
      return readName(n.name, scopes, c, false)
    case 'ThisExpression':
      return record(c, { code: 'instance', name: '@' })
    case 'Super': case 'ClassExpression': case 'ClassDeclaration': case 'WithStatement':
      return record(c, { code: 'unknown', name: n.type === 'Super' ? 'super' : n.type === 'WithStatement' ? 'with' : 'class' })
    case 'MetaProperty':
      return record(c, { code: 'unknown', name: `${n.meta.name}.${n.property.name}` })
    case 'ImportExpression':
      record(c, { code: 'import', name: 'import()' })
      return traverse(n.source, scopes, c, n)
    case 'AwaitExpression':
      record(c, { code: 'await', name: 'await' })
      return traverse(n.argument, scopes, c, n)
    case 'MemberExpression': {
      const o = n.object
      if (o.type === 'Identifier' && o.name === '$') {
        if (n.computed) {
          record(c, { code: 'key', name: '$[…]' })
          return traverse(n.property, scopes, c, n)
        }
        // lue une fois, au premier niveau : la variable garde la valeur (un objet de l'état, par alias)
        if (c.mode === 'script' && !c.inFunction) record(c, { code: 'alias', name: '$' + n.property.name })
        else if (c.mode === 'module') record(c, { code: 'state', name: '$' })
        return
      }
      if (o.type === 'Identifier' && o.name === 'µ') {
        const named = parent != null && parent.type === 'MemberExpression' && parent.object === n
        if (isStore(n)) {
          if (!named) return record(c, { code: 'state', name: '$$' })
          if (parent.computed) return record(c, { code: 'key', name: '$$[…]' })
          if (c.mode !== 'derived' && !c.inFunction) record(c, { code: 'alias', name: '$$' + parent.property.name })
          return
        }
        // `µread $$x` : le magasin lu sans s'abonner
        if (!n.computed && (n.property.name === '_mjs_storeRaw' || n.property.name === '_stateRaw') && named && !parent.computed) return
        record(c, { code: 'rune', name: 'µ.' + (n.computed ? '[…]' : n.property.name) })
        if (n.computed) traverse(n.property, scopes, c, n)
        return
      }
      if (o.type === 'ThisExpression' || (o.type === 'Identifier' && o.name === '_mjsThis')) {
        // `µread $x` (`_mjsThis._state.x`) : lu sans s'abonner
        if (o.type === 'Identifier' && !n.computed && n.property.name === '_state' && parent != null && parent.type === 'MemberExpression' && parent.object === n && !parent.computed) return
        record(c, { code: 'instance', name: (o.type === 'ThisExpression' ? '@' : '@@') + (n.computed ? '[…]' : n.property.name) })
        if (n.computed) traverse(n.property, scopes, c, n)
        return
      }
      traverse(o, scopes, c, n)
      if (n.computed) traverse(n.property, scopes, c, n)
      return
    }
    case 'CallExpression': case 'NewExpression': {
      const h = clockOrRandom(n)
      if (h) record(c, h)
      else visitCall(n.callee, scopes, c, n)
      for (const a of n.arguments) traverse(a, scopes, c, n)
      return
    }
    case 'TaggedTemplateExpression':
      visitCall(n.tag, scopes, c, n)
      return traverse(n.quasi, scopes, c, n)
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration':
      return walkFunction(n, scopes, c)
    case 'BlockStatement': case 'StaticBlock': {
      const pp = [...scopes, blockScope(n.body)]
      for (const s of n.body) traverse(s, pp, c, n)
      return
    }
    case 'SwitchStatement': {
      traverse(n.discriminant, scopes, c, n)
      const pp = [...scopes, blockScope(n.cases.flatMap((k: any) => k.consequent))]
      for (const k of n.cases) traverse(k, pp, c, n)
      return
    }
    case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
      if (n.type === 'ForOfStatement' && n.await) record(c, { code: 'await', name: 'for await' })
      const init = n.type === 'ForStatement' ? n.init : n.left
      const pp   = init && init.type === 'VariableDeclaration' && init.kind !== 'var' ? [...scopes, declarationScope(init)] : scopes
      if (n.type !== 'ForStatement' && init && init.type !== 'VariableDeclaration') target(init, pp, c)
      else traverse(init, pp, c, n)
      for (const k of ['test', 'update', 'right', 'body']) traverse(n[k], pp, c, n)
      return
    }
    case 'CatchClause': {
      const m: Scope = new Map()
      const t: string[] = []
      patternNames(n.param, t)
      for (const x of t) m.set(x, 'var')
      return traverse(n.body, [...scopes, m], c, n)
    }
    case 'VariableDeclarator':
      pattern(n.id, scopes, c)
      return traverse(n.init, scopes, c, n)
    case 'AssignmentExpression':
      target(n.left, scopes, c)
      return traverse(n.right, scopes, c, n)
    case 'UpdateExpression':
      return target(n.argument, scopes, c)
    case 'Property':
      if (n.computed) traverse(n.key, scopes, c, n)
      return traverse(n.value, scopes, c, n)
    case 'LabeledStatement':
      return traverse(n.body, scopes, c, n)
  }
  for (const k of Object.keys(n)) {
    if (KEYS.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) { for (const x of v) traverse(x, scopes, c, n) }
    else if (v && typeof v.type === 'string') traverse(v, scopes, c, n)
  }
}

function dedoublonner(list: ClockReason[]): ClockReason[] {
  const seen = new Set<string>()
  const out: ClockReason[] = []
  for (const r of list) {
    const key = `${r.code}\u0000${r.name ?? ''}\u0000${r.by ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

// changements comptés : hors du premier niveau (`topLevel` : lui aussi), sauf une fonction passée en rappel
// (`setTimeout(f)`, `$l.map(f)`)
function changed(l: Change[] | undefined, values: Assignment[] | undefined, topLevel = false): boolean {
  if (!l) return false
  const fn         = (values ?? []).filter((a) => a.value != null)
  const isFunction = fn.length > 0 && fn.every((a) => /Function/.test(a.value.type))
  return l.some((x) => (topLevel || !x.top) && !(x.pass && isFunction))
}

// raisons de chaque variable d'un programme (`<script>` ou `<script module>`) : point fixe sur ses valeurs, celles
// qu'on lui affecte et celles qu'on range dedans ; une variable changée ou inconnue garde sa raison telle quelle
function fixedPoint(names: string[], col: ReturnType<typeof collect>, fixes: Map<string, ClockReason[]>, mode: 'script' | 'module', base: Omit<Ctx, 'mode' | 'bound' | 'inFunction' | 'reasons'>, states: Map<string, ClockReason[]>): void {
  for (const v of names) states.set(v, fixes.get(v) ?? [])
  let again = true
  while (again) {
    again = false
    for (const v of names) {
      if (fixes.has(v)) continue
      const reasons: ClockReason[] = []
      for (const a of [...(col.table.get(v) ?? []), ...(col.members.get(v) ?? [])]) {
        if (a.value == null) continue
        traverse(a.value, a.scopes, { ...base, mode, bound: a.scopes.length, inFunction: false, reasons: reasons }, null)
      }
      const d = dedoublonner(reasons)
      if (d.length !== states.get(v)!.length) {
        states.set(v, d)
        again = true
      }
    }
  }
}

// variables `$` qu'un nœud lit (`$.x`), et variables du composant qu'il cite
function reads(n: any, state: Set<string>, cited: Set<string>, known: Set<string>): void {
  if (!n || typeof n.type !== 'string') return
  if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === '$' && n.property.type === 'Identifier') state.add(n.property.name)
  else if (n.type === 'MemberExpression' && !n.computed && (n.object.type === 'ThisExpression' || (n.object.type === 'Identifier' && n.object.name === '_mjsThis')) && known.has('@' + n.property.name)) cited.add('@' + n.property.name)
  else if (n.type === 'Identifier' && known.has(n.name)) cited.add(n.name)
  for (const k of Object.keys(n)) {
    if (KEYS.has(k)) continue
    const v = n[k]
    if (Array.isArray(v)) { for (const x of v) reads(x, state, cited, known) }
    else if (v && typeof v.type === 'string') reads(v, state, cited, known)
  }
}

// méthodes du composant que la valeur peut suivre : `this.m = fonction` (ou `_mjsThis.m`), écrite une seule fois, au
// premier niveau du `<script>` ; rangées sous `@m`, avec les variables
function trackedMethods(ast: any): Map<string, Assignment[]> {
  const written = new Map<string, number>()
  const out     = new Map<string, Assignment[]>()
  const visit = (n: any, top: boolean): void => {
    if (!n || typeof n.type !== 'string') return
    const l = n.type === 'AssignmentExpression' ? n.left : null
    if (l && l.type === 'MemberExpression' && !l.computed && l.property.type === 'Identifier' && (l.object.type === 'ThisExpression' || (l.object.type === 'Identifier' && l.object.name === '_mjsThis'))) {
      const m = l.property.name
      written.set(m, (written.get(m) ?? 0) + 1)
      if (top && n.operator === '=' && /Function/.test(n.right.type)) out.set('@' + m, [{ value: n.right, scopes: [] }])
    }
    const inside = top && !/Function/.test(n.type)
    for (const k of Object.keys(n)) {
      if (KEYS.has(k)) continue
      const v = n[k]
      if (Array.isArray(v)) { for (const x of v) visit(x, inside) }
      else if (v && typeof v.type === 'string') visit(v, inside)
    }
  }
  visit(ast, true)
  for (const [m, count] of written) if (count > 1) out.delete('@' + m)
  return out
}

function analyzeHandlers(js: string): ReturnType<typeof collect> | null {
  if (!js.trim()) return null
  try {
    return collect(acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' }), new Set(), new Set())
  }
  catch {
    return null
  }
}

export function classifyDerived(e: ClassificationInput): ClassifiedDerived[] {
  const imports   = new Set(e.imports)
  const external  = new Set(e.externalVars)
  const refs      = new Set(e.refs)
  const nodes     = new Set(e.candidates.map((k) => k.node))
  const empty     = { table: new Map(), members: new Map(), unknowns: new Set<string>(), changes: new Map(), handed: [] } as ReturnType<typeof collect>
  const colScript = e.script ? collect(e.script, new Set(), nodes) : empty
  const colModule = e.module ? collect(e.module, new Set(), new Set()) : empty
  // gestionnaires illisibles : on ne sait pas ce qu'ils changent, toute variable compte comme changée
  const templateCol     = analyzeHandlers(e.handlers)
  const unknownTemplate = templateCol === null && e.handlers.trim() !== ''
  const byTemplate      = (v: string, values: Assignment[] | undefined): boolean => refs.has(v) || unknownTemplate || changed(templateCol?.changes.get(v), values)

  // méthodes suivies : rangées avec les variables du `<script>`, sous `@m`
  const methods     = e.trackMethods && e.script ? trackedMethods(e.script) : new Map<string, Assignment[]>()
  const tableScript = new Map([...colScript.table, ...methods])
  const scriptNames = [...tableScript.keys()]
  const scriptSet   = new Set(scriptNames)
  const moduleNames = e.moduleVars.filter((v) => !scriptSet.has(v))
  const template    = new Set([...refs, ...(templateCol ? templateCol.changes.keys() : [])].filter((v) => !scriptSet.has(v) && !moduleNames.includes(v)))

  const moduleStates = new Map<string, ClockReason[]>()
  const scriptStates = new Map<string, ClockReason[]>()
  const base         = { script: scriptStates, module: moduleStates, imports, external, template }

  // le `<script module>` : ses variables, changées par ses fonctions, par le `<script>` (même au premier niveau : chaque
  // instance le rejoue) ou par le gabarit
  const moduleFixed = new Map<string, ClockReason[]>()
  for (const v of moduleNames) {
    const values = colModule.table.get(v)
    if (changed(colModule.changes.get(v), values) || changed(colScript.changes.get(v), values, true) || byTemplate(v, values)) moduleFixed.set(v, [{ code: 'variable', name: v }])
    else if (colModule.unknowns.has(v)) moduleFixed.set(v, [{ code: 'unknown', name: v }])
  }
  fixedPoint(moduleNames, colModule, moduleFixed, 'module', { ...base, script: new Map() }, moduleStates)

  const scriptFixed = new Map<string, ClockReason[]>()
  for (const v of scriptNames) {
    const values = colScript.table.get(v)
    if (changed(colScript.changes.get(v), values) || byTemplate(v, values)) scriptFixed.set(v, [{ code: 'variable', name: v }])
    else if (colScript.unknowns.has(v)) scriptFixed.set(v, [{ code: 'unknown', name: v }])
  }
  fixedPoint(scriptNames, { ...colScript, table: tableScript }, scriptFixed, 'script', base, scriptStates)

  // les valeurs dérivées, dans l'ordre où elles sont écrites (une définie deux fois : une seule entrée)
  const definitions = new Map<string, number>()
  for (const k of e.candidates) definitions.set(k.name, (definitions.get(k.name) ?? 0) + 1)
  const reasons         = new Map<string, ClockReason[]>()
  const read            = new Map<string, Set<string>>()
  const component       = new Set([...scriptNames, ...moduleNames])
  const citedByVariable = new Map<string, { state: Set<string>; cited: Set<string> }>()
  for (const v of component) {
    const state = new Set<string>()
    const cited = new Set<string>()
    for (const a of [...(tableScript.get(v) ?? []), ...(colScript.members.get(v) ?? []), ...(colModule.table.get(v) ?? []), ...(colModule.members.get(v) ?? [])]) reads(a.value, state, cited, component)
    citedByVariable.set(v, { state, cited })
  }
  for (const k of e.candidates) {
    const l = reasons.get(k.name) ?? []
    reasons.set(k.name, l)
    if (definitions.get(k.name)! > 1 && l.length === 0) l.push({ code: 'double', name: '$' + k.name })
    const locals: Scope[] = k.locals ? [new Map(k.locals.map((x) => [x, 'var'] as [string, 'var']))] : []
    traverse(k.node, locals, { ...base, mode: 'derived', bound: 0, inFunction: false, reasons: l }, null)
    // variables `$` lues, en toutes lettres ou par une fonction du composant qu'elle cite
    const state = read.get(k.name) ?? new Set<string>()
    read.set(k.name, state)
    const cited = new Set<string>()
    reads(k.node, state, cited, component)
    const toVisit = [...cited]
    for (let i = 0; i < toVisit.length; i++) {
      const x = citedByVariable.get(toVisit[i])
      if (!x) continue
      for (const s of x.state) state.add(s)
      for (const y of x.cited) if (!cited.has(y)) { cited.add(y); toVisit.push(y) }
    }
  }
  // une valeur dérivée qui en lit une autre à l'horloge l'est aussi, la raison notée même quand elle en a déjà une
  const clocks = new Set([...reasons].filter(([, l]) => l.length > 0).map(([name]) => name))
  let again   = true
  while (again) {
    again = false
    for (const [name, l] of reasons) {
      for (const x of read.get(name)!) {
        if (x === name || !clocks.has(x) || l.some((r) => r.code === 'derived' && r.name === '$' + x)) continue
        l.push({ code: 'derived', name: '$' + x })
        if (!clocks.has(name)) {
          clocks.add(name)
          again = true
        }
      }
    }
  }
  // la classe : celle du runtime (preciseDerived) ; ses raisons, celles de l'analyse des lectures ou la forme refusée
  const precision = preciseDerived(e.candidates, e.externalVars, doubtfulVariables(e.script, e.raw === true))
  return [...reasons].map(([name, l]) => {
    if (precision.sources.has(name)) return { name: name, class: 'precise', reasons: [] }
    const d = dedoublonner(l)
    return { name: name, class: 'clock', reasons: d.length > 0 ? d : [precision.reject.get(name) ?? { code: precision.simpleNames.has(name) ? 'simple' : 'list', name: '$' + name }] }
  })
}

// ============================================================================
// Valeurs dérivées PRÉCISES — celles qui suivent leurs sources au runtime, sauf quand elles repassent à l'horloge. Le compilateur
// PROUVE ce qu'elles lisent : leur expression n'est faite que de variables `$` du composant (les autres valeurs précises
// comprises), de littéraux, d'opérateurs, de champs lus sur ces valeurs et d'appels de la liste courte ci-dessous ; une
// fonction écrite sur place n'y entre qu'en argument d'une méthode de liste, faite des mêmes briques, ses paramètres en
// plus. Ses sources : les variables `$` qu'elle lit, celles des valeurs précises qu'elle lit comprises, et les noms des
// champs qu'elle lit ailleurs (`.nom`). Toute autre forme
// (fonction ou constante du `<script>`, magasin, contexte, rune, `this`, `new`, écriture, `in`…) laisse la valeur à la
// règle de toujours : refaite à sa lecture après toute écriture du composant. Dans le doute à l'exécution, le runtime la
// repasse à cette règle (mjs_element.ts)
// ============================================================================

// méthodes de liste et de chaîne de la liste courte (aucune ne change son receveur)
const PURE_METHODS = new Set(['filter', 'map', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'concat', 'at', 'flat', 'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'substring', 'charAt', 'split', 'toFixed'])
// celles qui reçoivent une fonction écrite sur place
const PURE_CALLBACKS = new Set(['filter', 'map', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap'])
const PURE_FUNCTIONS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'])
const PURE_MATH = new Set(['abs', 'ceil', 'floor', 'round', 'trunc', 'sign', 'min', 'max', 'pow', 'sqrt'])
const PURE_NAMES = new Set(['undefined', 'NaN', 'Infinity'])
// champs qui mènent aux objets partagés du langage
const PURE_FORBIDDEN = new Set(['constructor', 'prototype', '__proto__'])

export interface Precision {
  /** valeurs précises : nom sans `$` → ses sources (variables `$`, sans `$`) */
  sources: Map<string, string[]>
  /** valeurs à l'horloge : la première forme hors de la liste courte */
  reject: Map<string, ClockReason>
  /** valeurs prouvées mais laissées à l'horloge : leur calcul coûte moins que leur vérification (cf. couteuse) */
  simpleNames: Set<string>
}

// calcul qui coûte plus que la vérification de ses sources : un appel de méthode (liste, chaîne), un appel sur une liste
// étalée, une liste ou un objet bâti (la précision garde aussi son identité) ; lectures, `.length`, opérateurs, `Math.*` et
// conversions (`String`, `Number`…) non — refaits à chaque lecture après une écriture, ils coûtent moins que leur vérification
function isCostly(n: any): boolean {
  let found = false
  walk.full(n, (x: any) => {
    if (found) return
    if (x.type === 'ArrayExpression' || x.type === 'ObjectExpression') found = true
    else if (x.type === 'CallExpression') found = (x.callee.type === 'MemberExpression' && !(x.callee.object.type === 'Identifier' && x.callee.object.name === 'Math')) || x.arguments.some((a: any) => a.type === 'SpreadElement')
  })
  return found
}

// la forme refusée, en quelques mots, pour `mjs check --derived`
function describe(n: any): string {
  if (n.type === 'Identifier') return n.name === '_mjsThis' ? '@@' : n.name
  if (n.type === 'ThisExpression') return '@'
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && describe(n.callee) === '§§') return '§§' + (n.arguments[0]?.type === 'Literal' ? n.arguments[0].value : '…')
  if (n.type === 'CallExpression' || n.type === 'NewExpression') return (n.type === 'NewExpression' ? 'new ' : '') + describe(n.callee) + '()'
  if (n.type === 'MemberExpression') {
    if (isStore(n.object) && !n.computed) return '$$' + n.property.name
    const o = n.object
    if (o.type === 'MemberExpression' && !o.computed && o.object.type === 'Identifier' && o.object.name === '_mjsThis' && o.property.name === '_state' && !n.computed) return 'µread $' + n.property.name
    if (o.type === 'Identifier' && o.name === '_mjsThis' && !n.computed && n.property.name === '_mjs_getRCtx') return '§§'
    if (o.type === 'Identifier' && o.name === 'µ') return 'µ.' + (n.computed ? '…' : n.property.name)
    return n.computed ? describe(n.object) + '[…]' : '.' + n.property.name
  }
  return n.type
}

// variables `$` lues par l'expression `n` (ajoutées à `read`), ou la forme refusée ; `locaux` : paramètres des fonctions
// écrites sur place qui l'entourent
function prove(n: any, locals: Set<string>, read: Set<string>): any {
  if (!n) return null
  switch (n.type) {
    case 'Literal': return null
    case 'Identifier': return locals.has(n.name) || PURE_NAMES.has(n.name) ? null : n
    case 'TemplateLiteral': {
      for (const x of n.expressions) { const r = prove(x, locals, read); if (r) return r }
      return null
    }
    case 'ChainExpression': case 'ParenthesizedExpression': return prove(n.expression, locals, read)
    case 'UnaryExpression': return n.operator === 'delete' ? n : prove(n.argument, locals, read)
    case 'BinaryExpression':
      if (n.operator === 'in' || n.operator === 'instanceof') return n
      return prove(n.left, locals, read) || prove(n.right, locals, read)
    case 'LogicalExpression': return prove(n.left, locals, read) || prove(n.right, locals, read)
    case 'ConditionalExpression': return prove(n.test, locals, read) || prove(n.consequent, locals, read) || prove(n.alternate, locals, read)
    case 'SpreadElement': return prove(n.argument, locals, read)
    case 'ArrayExpression': {
      for (const x of n.elements) { const r = x && prove(x, locals, read); if (r) return r }
      return null
    }
    case 'ObjectExpression': {
      for (const p of n.properties) {
        if (p.type === 'SpreadElement') { const r = prove(p.argument, locals, read); if (r) return r; continue }
        if (p.kind !== 'init' || p.method) return p
        const r = (p.computed && prove(p.key, locals, read)) || prove(p.value, locals, read)
        if (r) return r
      }
      return null
    }
    case 'MemberExpression': {
      const o = n.object
      if (o.type === 'Identifier' && o.name === '$') {
        if (n.computed || n.property.type !== 'Identifier') return n
        read.add(n.property.name)
        return null
      }
      if (n.property.type === 'PrivateIdentifier' || (!n.computed && PURE_FORBIDDEN.has(n.property.name))) return n
      // champ lu sur autre chose que l'état : son nom, que le runtime cherche sur les prototypes du langage (une donnée que
      // l'application y aurait posée), noté `.nom` parmi les sources
      if (!n.computed && n.property.name !== 'length') read.add('.' + n.property.name)
      // magasin, `µread $x`, rune, composant : nommés par la lecture entière
      if ((o.type === 'Identifier' && (o.name === 'µ' || o.name === '_mjsThis')) || (o.type === 'MemberExpression' && (isStore(o) || (o.object.type === 'Identifier' && o.object.name === '_mjsThis')))) return n
      return prove(o, locals, read) || (n.computed ? prove(n.property, locals, read) : null)
    }
    case 'CallExpression': {
      if (n.optional) return n
      const f = n.callee
      let callbacks = false
      if (f.type === 'Identifier') {
        if (!PURE_FUNCTIONS.has(f.name) || locals.has(f.name)) return n
      }
      else if (f.type === 'MemberExpression' && !f.computed && f.property.type === 'Identifier') {
        if (f.object.type === 'Identifier' && f.object.name === 'Math' && !locals.has('Math')) {
          if (!PURE_MATH.has(f.property.name)) return n
        }
        else {
          if (!PURE_METHODS.has(f.property.name)) return n
          const r = prove(f.object, locals, read)
          if (r) return r
          callbacks = PURE_CALLBACKS.has(f.property.name)
        }
      }
      else return n
      for (const a of n.arguments) {
        if (callbacks && (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')) {
          const r = callback(a, locals, read)
          if (r) return r
          continue
        }
        const r = prove(a, locals, read)
        if (r) return r
      }
      return null
    }
  }
  return n
}

// fonction écrite sur place, argument d'une méthode de liste : paramètres simples, un seul retour
function callback(f: any, locals: Set<string>, read: Set<string>): any {
  if (f.async || f.generator || !f.params.every((p: any) => p.type === 'Identifier')) return f
  let body = f.body
  if (body.type === 'BlockStatement') {
    if (body.body.length !== 1 || body.body[0].type !== 'ReturnStatement' || !body.body[0].argument) return f
    body = body.body[0].argument
  }
  return prove(body, new Set([...locals, ...f.params.map((p: any) => p.name)]), read)
}

// écriture de l'état qui contourne MJS, lue dans le texte du composant (`<script>` et gabarit) : `_state`, `µread($x) += 1`,
// `µread($x)++`, le composant passé à une fonction (`ecrire @, 7`, `f(this)`) qui peut écrire son `_state`
export const RAW_WRITE = /_state\b|µread\s*\(?\s*\$[\w$]+\s*\)?\s*(?:\+\+|--|(?:[-+*\/%&|^]|\*\*|<<|>>>?|\?\?|\|\||&&)?=(?!=))|(?:\+\+|--)\s*µread|(?:^|[(,\s])(?:@|this)\s*(?:,|\)|$)/m

// variables `$` que le compilateur ne peut pas prouver (null : toutes, le composant écrit l'état sans MJS) : `$x = nom`, où
// `nom` n'est pas un paramètre de la fonction qui écrit — le script garde l'objet brut, qu'il peut changer sans que MJS le
// voie
export function doubtfulVariables(script: any, raw: boolean): Set<string> | null {
  if (raw) return null
  const out = new Set<string>()
  if (!script) return out
  walk.ancestor(script, {
    AssignmentExpression(n: any, _st: any, anc: any[]) {
      const l = n.left
      if (n.operator !== '=' || l.type !== 'MemberExpression' || l.computed || l.object.type !== 'Identifier' || l.object.name !== '$' || n.right.type !== 'Identifier') return
      const f = [...anc].reverse().find((a: any) => /Function/.test(a.type))
      if (!f || !f.params.some((p: any) => p.type === 'Identifier' && p.name === n.right.name)) out.add(l.property.name)
    },
  })
  return out
}

// valeurs précises d'un composant et leurs sources (celles des valeurs précises qu'elles lisent comprises, et leurs noms :
// une valeur dérivée réécrite devient une variable) ; `externes` : variables externes, avec leur `$`, et `douteuses` (cf.
// doubtfulVariables) — une valeur qui en lit une reste à l'horloge
export function preciseDerived(candidates: DerivedCandidate[], external: string[] = [], doubtful: Set<string> | null = new Set()): Precision {
  const definitions = new Map<string, number>()
  for (const k of candidates) definitions.set(k.name, (definitions.get(k.name) ?? 0) + 1)
  const outer  = new Set(external.map((v) => v.replace(/^\$+/, '')))
  const read   = new Map<string, Set<string>>()
  const reject = new Map<string, ClockReason>()
  for (const k of candidates) {
    if (reject.has(k.name) || read.has(k.name)) continue
    if (definitions.get(k.name)! > 1) { reject.set(k.name, { code: 'double', name: '$' + k.name }); continue }
    if (doubtful === null) { reject.set(k.name, { code: 'list', name: '_state' }); continue }
    if (k.force || (k.locals && k.locals.length > 0)) { reject.set(k.name, { code: 'list', name: k.force ? 'µderived' : 'if' }); continue }
    const l = new Set<string>()
    const r = prove(k.node, new Set(), l)
    if (r) { reject.set(k.name, { code: 'list', name: describe(r) }); continue }
    const ext = [...l].find((x) => outer.has(x) || doubtful.has(x))
    if (ext !== undefined) { reject.set(k.name, { code: doubtful.has(ext) ? 'guard' : 'list', name: '$' + ext }); continue }
    read.set(k.name, l)
  }
  // une valeur qui en lit une autre à l'horloge y reste aussi ; ses sources : aplaties, cycle refusé
  const sources = new Map<string, string[]>()
  const flatten = (name: string, stack: Set<string>): string[] | null => {
    if (sources.has(name)) return sources.get(name)!
    if (reject.has(name) || stack.has(name)) return null
    stack.add(name)
    const out = new Set<string>()
    for (const x of read.get(name)!) {
      out.add(x)
      if (!definitions.has(x)) continue
      const s = flatten(x, stack)
      if (s === null) {
        if (!reject.has(name)) reject.set(name, { code: 'derived', name: '$' + x })
        stack.delete(name)
        return null
      }
      for (const y of s) out.add(y)
    }
    stack.delete(name)
    const list = [...out].sort()
    sources.set(name, list)
    return list
  }
  for (const name of read.keys()) flatten(name, new Set())
  for (const name of [...sources.keys()]) if (reject.has(name)) sources.delete(name)
  // suivies : les valeurs au calcul coûteux (cf. couteuse) et les valeurs qu'elles lisent ; les autres, prouvées, restent à
  // l'horloge (`simpleNames`) — la refaire coûte moins que vérifier ses sources
  const tracked = new Set<string>()
  const track = (name: string) => {
    if (tracked.has(name) || !sources.has(name)) return
    tracked.add(name)
    for (const x of read.get(name)!) if (definitions.has(x)) track(x)
  }
  for (const k of candidates) if (sources.has(k.name) && isCostly(k.node)) track(k.name)
  const simpleNames = new Set<string>()
  for (const name of [...sources.keys()]) {
    if (tracked.has(name)) continue
    sources.delete(name)
    simpleNames.add(name)
  }
  return { sources, reject, simpleNames }
}

// cible d'une écriture : `$.x` (affectation, `+=`, `++`, motif de déstructuration, tête de `for…of`) ou `µwrite $x`
// (`µ._mjs_rawWrite(_mjsThis).x`) ; `noms` : les valeurs dérivées cherchées
function chosenTarget(t: any, names: Set<string>, out: Set<string>): void {
  if (!t) return
  switch (t.type) {
    case 'MemberExpression': {
      const o      = t.object
      const dollar = o.type === 'Identifier' && o.name === '$'
      const raw    = o.type === 'CallExpression' && o.callee.type === 'MemberExpression' && !o.callee.computed && o.callee.property.type === 'Identifier' && o.callee.property.name === '_mjs_rawWrite'
      if (!t.computed && t.property.type === 'Identifier' && names.has(t.property.name) && (dollar || raw)) out.add(t.property.name)
      return
    }
    case 'ArrayPattern': for (const x of t.elements) chosenTarget(x, names, out); return
    case 'ObjectPattern': for (const p of t.properties) chosenTarget(p.type === 'RestElement' ? p.argument : p.value, names, out); return
    case 'AssignmentPattern': chosenTarget(t.left, names, out); return
    case 'RestElement': chosenTarget(t.argument, names, out); return
  }
}

// valeurs dérivées que le code écrit : dans une fonction du `<script>` (son premier niveau les définit), partout dans les
// gestionnaires du gabarit (`everywhere`)
function writtenChoices(ast: any, names: Set<string>, out: Set<string>, everywhere: boolean): void {
  const visit = (n: any, inside: boolean): void => {
    if (!n || typeof n.type !== 'string') return
    if (inside) {
      if (n.type === 'AssignmentExpression') chosenTarget(n.left, names, out)
      else if (n.type === 'UpdateExpression') chosenTarget(n.argument, names, out)
      else if ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && n.left.type !== 'VariableDeclaration') chosenTarget(n.left, names, out)
    }
    const d = inside || /Function/.test(n.type)
    for (const k of Object.keys(n)) {
      if (KEYS.has(k)) continue
      const v = n[k]
      if (Array.isArray(v)) { for (const x of v) visit(x, d) }
      else if (v && typeof v.type === 'string') visit(v, d)
    }
  }
  visit(ast, everywhere)
}

// dépendances nommées des `µderived $x = expr, $a` que le composant écrit (dans une fonction du `<script>` ou un gestionnaire
// du gabarit) : texte d'une `Map` nom → dépendances, lue par le runtime à l'écriture (`_mjs_computedSrc`,
// runtime/mjs_element.ts). Null sans `µderived` écrite : le code produit ne change pas
export function chosenDerived(script: any, candidates: DerivedCandidate[], handlers: string): string | null {
  const named = new Map<string, string[]>()
  for (const k of candidates) if (k.named) named.set(k.name, k.named)
  if (named.size === 0) return null
  const names = new Set(named.keys())
  const out   = new Set<string>()
  if (script) writtenChoices(script, names, out, false)
  if (handlers.trim()) {
    try {
      writtenChoices(acorn.parse(handlers, { ecmaVersion: 'latest', sourceType: 'module' }), names, out, true)
    }
    catch {
      // gestionnaires illisibles : leurs écritures ne sont pas vues, la valeur écrite par eux seuls devient une variable ordinaire
    }
  }
  const table = [...out].map((name) => [name, named.get(name)!.filter((s) => s !== name)] as const).filter(([, s]) => s.length > 0)
  return table.length > 0 ? `new Map(${JSON.stringify(table)})` : null
}
