// store-args — avertit (lint.reactivity, jamais bloquant) quand une fonction importée d'un module que MJS copie
// tel quel (`@import f 'chemin.js'`) ÉCRIT dans le paramètre qui reçoit un magasin `$$x`
//
// pourquoi : le suivi des écritures du magasin est une réécriture à la compilation (path-tracker.ts :
// `$$ui.a = v` devient `µ._mjs_storeDeepSet('ui', ['a'], v)`). elle s'arrête à la frontière d'un appel, et un
// module .js n'est jamais compilé, donc jamais réécrit : la lecture `$$ui` y arrive en `µ.store.ui`, l'objet
// brut, et `ui.coinFx = spec` écrit dedans sans prévenir personne — la valeur change, rien ne se redessine,
// build et tests restent verts. un module .civet ou .coffee n'y change rien quand le magasin lui est passé en
// argument : l'écriture n'y est suivie que si `$$x` est écrit en clair dans le module lui-même
//
// comment : la détection lit le JS déjà compilé (acorn), là où chaque `$$x` est devenu `µ.store.x`, jamais le
// texte du composant. les noms viennent des `@import` (`dir.pendingAutoImports`, forme figée par directives.ts)
// dont la cible n'est pas compilée par le bundler (resolveOneAsset, bundler/index.ts : seuls .civet, .coffee et
// .mjs le sont, le reste est copié tel quel). un argument est candidat quand il est un chemin du magasin
// (`$$x`, `$$x.a.b`, `$$x.items[0]`, étalé ou non)
//
// un candidat n'est dit que si la fonction ÉCRIT dans le paramètre qui le reçoit : le fichier .js est relu sur
// le disque (dossier des sources + chemin de l'`@import`, comme le bundler), analysé avec acorn, la fonction
// exportée sous ce nom retrouvée (`export function f`, `export const f = …`, `export { f }`, `export default`,
// méthode d'un objet exporté pour `fx.raise($$ui)`, constructeur d'une classe pour `new Fx($$ui)`), et son
// paramètre de même rang cherché en écriture directe : affectation d'un membre (`p.x = …`, `p[k] = …`,
// `p.a.b = …`, `+=`, `++`), `delete p.x`, méthode qui modifie sur lui ou sur un de ses membres (`push`, `splice`…
// et, pour une collection, `clear()`, `add(x)`, `delete(x)`, `set(k, v)` : sous cette seule forme, car `env.clear(timer)`
// est l'horloge d'un environnement injecté, pas un vidage), `Object.assign(p, …)`, `Object.defineProperty(p, …)`, y
// compris par un alias simple du paramètre (`const u = p`) ou un paramètre déstructuré (`({ list }) => list.push(…)`)
//
// on ne devine pas : pas d'avertissement quand le fichier ne se lit pas (absent, de plus de 1 Mo, lien symbolique
// dont la cible réelle est hors du dossier des sources), ne s'analyse pas, ne contient pas la
// fonction (ré-export, valeur calculée), quand la fonction passe son paramètre à une AUTRE fonction (l'écriture
// faite plus loin n'est pas suivie), ou quand le nom du paramètre est lié ou réaffecté ailleurs dans la
// fonction (il ne désigne plus forcément le magasin). hors de portée aussi : un magasin rangé dans un objet ou
// un tableau littéral, passé par une variable intermédiaire, une clé du framework (`µlang`, `µtheme`), une
// adresse https:// (module d'autrui, pas du projet)
//
// l'analyse d'un même fichier ne se refait pas pour chaque composant qui l'importe : le fichier analysé et les
// verdicts sont gardés en mémoire par chemin, date de modification et taille

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { posix, join, resolve, sep, extname } from 'node:path'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { t } from '../messages/index.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { isStoreRoot } from './ast-helpers.js'

// les cibles que le bundler compile (resolveOneAsset) : l'écriture sur `$$x` y est suivie, rien à dire
const COMPILED_EXTENSIONS = new Set(['.civet', '.coffee', '.mjs'])

// forme figée par directives.ts : `import { a, b } from "µasset('chemin')"` ou `import a from "µasset('chemin')"`
// (une adresse https:// garde sa forme `from 'https://…'` et n'entre pas ici)
const ASSET_SOURCE_RE = /^µasset\('(.*)'\)$/

// les clés du magasin que le framework tient lui-même (`µlang` → `__mjsLang`, `µtheme` → `__mjsTheme`) : des
// chaînes, que le développeur n'a pas écrites en `$$x`
const FRAMEWORK_KEY_RE = /^__mjs[A-Z]/

// les méthodes de tableau qui modifient leur objet, quels que soient leurs arguments
const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])

// les méthodes d'une collection (Map, Set) qui la modifient, avec le nombre d'arguments de leur forme : `clear()`,
// `add(x)`, `delete(x)`, `set(k, v)`. le nom seul ne suffit pas : `env.clear(recount)` est l'horloge d'un environnement
// injecté, pas le vidage d'une collection
const COLLECTION_MUTATORS = new Map([['clear', 0], ['add', 1], ['delete', 1], ['set', 2]])

// au-delà, un module .js n'est pas lu : acorn met des dizaines de secondes à en analyser quelques Mo, et le build n'a
// pas à les payer pour un avertissement. 1 Mo (1 048 576 octets) dépasse de loin un module écrit à la main
const MAX_JS_BYTES = 1024 * 1024

/** la ligne du fichier d'une position du JS analysé ; `null` quand elle n'est pas sûre (jamais inventée) */
export type LineOf = (offset: number, ast: acorn.Node) => number | null

/** un nom importé d'un module copié tel quel : le chemin écrit dans l'`@import` et l'export visé (`default` ou le nom lui-même) */
export interface RawImport {
  path: string
  exportName: string
}

/** noms rendus par les `@import` dont la cible est copiée telle quelle */
export function rawJsImports(clauses: string[]): Map<string, RawImport> {
  const out = new Map<string, RawImport>()
  for (const clause of clauses) {
    let ast: any
    try {
      ast = acorn.parse(clause, { ecmaVersion: 'latest', sourceType: 'module' })
    }
    catch {
      continue
    }
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration') continue
      const path = ASSET_SOURCE_RE.exec(String(node.source.value))?.[1]
      if (path === undefined || COMPILED_EXTENSIONS.has(posix.extname(path))) continue
      for (const spec of node.specifiers) {
        // `$nom` : une variable réactive importée (`@import $x '…'`), jamais une fonction
        if (spec.local.name.startsWith('$')) continue
        const exportName = spec.type === 'ImportDefaultSpecifier' ? 'default' : String(spec.imported.name ?? spec.imported.value)
        out.set(spec.local.name, { path, exportName })
      }
    }
  }
  return out
}

// les noms liés par un motif (paramètre, déclaration, catch, cible d'une déstructuration) ; `withRest` : compter
// aussi les éléments `...x`, qui sont des copies (un tableau ou un objet neuf) et non le magasin lui-même
function patternNames(pattern: any, out: string[], withRest: boolean): void {
  switch (pattern?.type) {
    case 'Identifier':
      out.push(pattern.name)
      break
    case 'ObjectPattern':
      for (const p of pattern.properties) {
        if (p.type !== 'RestElement') patternNames(p.value, out, withRest)
        else if (withRest) patternNames(p.argument, out, withRest)
      }
      break
    case 'ArrayPattern':
      for (const el of pattern.elements) if (el) patternNames(el, out, withRest)
      break
    case 'AssignmentPattern':
      patternNames(pattern.left, out, withRest)
      break
    case 'RestElement':
      if (withRest) patternNames(pattern.argument, out, withRest)
      break
  }
}

interface Bindings {
  /** combien de fois chaque nom est lié (variable, paramètre, fonction, classe, catch) */
  bound: Map<string, number>
  /** combien de fois chaque nom est réaffecté (`x = …`, `x++`, déstructuration, `for (x of …)`) */
  assigned: Map<string, number>
  /** les déclarations avec valeur initiale, pour retrouver les alias */
  declarators: Array<{ id: any, init: any }>
}

function scanBindings(root: acorn.Node): Bindings {
  const bound       = new Map<string, number>()
  const assigned    = new Map<string, number>()
  const declarators: Bindings['declarators'] = []
  const count       = (into: Map<string, number>, names: string[]): void => {
    for (const name of names) into.set(name, (into.get(name) ?? 0) + 1)
  }
  walk.full(root, (node: any) => {
    const names: string[] = []
    switch (node.type) {
      case 'VariableDeclarator':
        patternNames(node.id, names, true)
        count(bound, names)
        if (node.init) declarators.push({ id: node.id, init: node.init })
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) names.push(node.id.name)
        for (const p of node.params ?? []) patternNames(p, names, true)
        count(bound, names)
        break
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) count(bound, [node.id.name])
        break
      case 'CatchClause':
        patternNames(node.param, names, true)
        count(bound, names)
        break
      case 'AssignmentExpression':
        patternNames(node.left, names, true)
        count(assigned, names)
        break
      case 'UpdateExpression':
        if (node.argument.type === 'Identifier') count(assigned, [node.argument.name])
        break
      case 'ForOfStatement':
      case 'ForInStatement':
        if (node.left.type !== 'VariableDeclaration') {
          patternNames(node.left, names, true)
          count(assigned, names)
        }
        break
    }
  })
  return { bound, assigned, declarators }
}

// tous les noms liés dans le code (variable, paramètre, fonction, classe, catch) : un appel dont le nom est
// aussi lié ailleurs peut viser cette autre définition — faux négatif possible, jamais de fausse alerte
function boundNames(ast: acorn.Node): Set<string> {
  return new Set(scanBindings(ast).bound.keys())
}

// l'argument est un chemin du magasin (`µ.store.ui`, `µ.store.ui.a.b`, `µ.store.ui.items[0]`, `µ.store.ui?.a`) :
// rend son écriture d'origine (`$$ui.a.b`), sinon null. une clé racine calculée (`µ.store[k]`) n'est pas suivie,
// ni une clé du framework
function storePathOf(arg: any, code: string): string | null {
  const top = unchain(arg)
  for (let cur = top; cur?.type === 'MemberExpression'; cur = cur.object) {
    if (!isStoreRoot(cur.object)) continue
    const key = cur.computed
      ? (cur.property.type === 'Literal' && typeof cur.property.value === 'string' ? cur.property.value : null)
      : cur.property.name
    return key === null || FRAMEWORK_KEY_RE.test(key) ? null : '$$' + key + code.slice(cur.end, top.end)
  }
  return null
}

// `a?.b.c` est enveloppé dans un nœud ChainExpression : on lit ce qu'il contient
function unchain(node: any): any {
  return node?.type === 'ChainExpression' ? node.expression : node
}

// le nom d'un membre quand il est écrit en toutes lettres (`a.b`, `a['b']`), sinon null
function memberName(member: any): string | null {
  if (!member.computed) return member.property.type === 'Identifier' ? member.property.name : null
  return member.property.type === 'Literal' && typeof member.property.value === 'string' ? member.property.value : null
}

// l'appel `a.b.c(…)` : le nom importé qui le porte (`a`) et le chemin dans l'objet (`['b', 'c']`) ;
// null quand un maillon est calculé (`a[k](…)`)
function calleeTarget(callee: any): { root: string, members: string[] } | null {
  const members: string[] = []
  let cur = unchain(callee)
  while (cur?.type === 'MemberExpression') {
    const name = memberName(cur)
    if (name === null) return null
    members.unshift(name)
    cur = cur.object
  }
  return cur?.type === 'Identifier' ? { root: cur.name, members } : null
}

// ---------------------------------------------------------------------------------------------------------------
// le module .js : lu, analysé, gardé
// ---------------------------------------------------------------------------------------------------------------

interface JsModule {
  code: string
  ast: any
  /** verdict par fonction et rangs de paramètres : la ligne de la première écriture, null si aucune */
  verdicts: Map<string, number | null>
}

// chemin → module analysé (null : illisible ou invalide, gardé aussi), valable tant que la date et la taille
// du fichier ne changent pas
const jsModules = new Map<string, { mtimeMs: number, size: number, mod: JsModule | null }>()

function loadJsModule(file: string): JsModule | null {
  let stat
  try {
    stat = statSync(file)
  }
  catch {
    return null
  }
  if (!stat.isFile() || stat.size > MAX_JS_BYTES) return null
  const kept = jsModules.get(file)
  if (kept !== undefined && kept.mtimeMs === stat.mtimeMs && kept.size === stat.size) return kept.mod
  let mod: JsModule | null = null
  try {
    const code = readFileSync(file, 'utf-8')
    mod = { code, ast: acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }), verdicts: new Map() }
  }
  catch {
    mod = null
  }
  jsModules.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, mod })
  return mod
}

// le fichier d'un `@import`, sous le dossier des sources comme le fait le bundler (resolveOneAsset) ; null hors de
// ce dossier ou quand ce n'est pas un .js. c'est le chemin RÉEL qui compte : un lien posé dans le dossier des sources
// qui mène à un fichier d'ailleurs n'est pas lu, comme un chemin `..` (le bundler le refuse aussi). on rend ce chemin
// réel, jamais celui du lien ; null aussi quand il ne se résout pas (fichier absent, lien cassé)
function jsFileOf(sourceDir: string | undefined, path: string): string | null {
  if (!sourceDir || extname(path).toLowerCase() !== '.js') return null
  const root = resolve(sourceDir)
  const file = resolve(join(sourceDir, path))
  if (!file.startsWith(root + sep)) return null
  try {
    const real = realpathSync(file)
    return real.startsWith(realpathSync(root) + sep) ? real : null
  }
  catch {
    return null
  }
}

// la valeur déclarée au premier niveau du module sous ce nom (fonction, classe, constante), exportée ou non
function topLevelValue(program: any, name: string): any {
  for (const node of program.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (!decl) continue
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === name) return decl
    if (decl.type === 'VariableDeclaration') {
      for (const v of decl.declarations) if (v.id.type === 'Identifier' && v.id.name === name) return v.init ?? null
    }
  }
  return null
}

// ce que le module exporte sous ce nom (`default` compris) ; null quand on ne sait pas le lire (ré-export depuis
// un autre fichier, `export *`)
function exportedValue(program: any, name: string): any {
  for (const node of program.body) {
    if (node.type === 'ExportDefaultDeclaration' && name === 'default') {
      return node.declaration.type === 'Identifier' ? topLevelValue(program, node.declaration.name) : node.declaration
    }
    if (node.type !== 'ExportNamedDeclaration' || node.source) continue
    const decl = node.declaration
    if (decl) {
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === name) return decl
      if (decl.type === 'VariableDeclaration') {
        for (const v of decl.declarations) if (v.id.type === 'Identifier' && v.id.name === name) return v.init ?? null
      }
      continue
    }
    for (const spec of node.specifiers) {
      if (String(spec.exported.name ?? spec.exported.value) === name) return topLevelValue(program, spec.local.name)
    }
  }
  return null
}

// la fonction que `node` désigne, en descendant le chemin de membres d'un objet (`fx.ui.raise`) : une fonction,
// une flèche, une méthode, ou le constructeur d'une classe ; null quand on ne sait pas la lire
function functionAt(program: any, node: any, members: string[], depth = 0): any {
  if (!node || depth > 8) return null
  if (node.type === 'Identifier') return functionAt(program, topLevelValue(program, node.name), members, depth + 1)
  if (members.length > 0) {
    if (node.type !== 'ObjectExpression') return null
    for (const prop of node.properties) {
      if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init') continue
      const key = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value)
      if (key === members[0]) return functionAt(program, prop.value, members.slice(1), depth + 1)
    }
    return null
  }
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return node
    case 'ClassDeclaration':
    case 'ClassExpression':
      return node.body.body.find((m: any) => m.type === 'MethodDefinition' && m.kind === 'constructor')?.value ?? null
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// l'écriture dans un paramètre
// ---------------------------------------------------------------------------------------------------------------

// l'expression désigne le paramètre ou un de ses membres (`p`, `p.a`, `p.a[0].b`, `p?.a`) ; un appel au milieu
// (`p.list.slice()`) rompt la chaîne : son résultat est une valeur neuve
function isTrackedRef(expr: any, tracked: Set<string>): boolean {
  const top = unchain(expr)
  if (top?.type === 'Identifier') return tracked.has(top.name)
  return top?.type === 'MemberExpression' && isTrackedRef(top.object, tracked)
}

// l'appel de méthode modifie-t-il son objet ? une méthode de tableau, quels que soient ses arguments ; clear, add,
// delete et set seulement sous la forme d'une collection. un argument étalé cache le nombre d'arguments : on ne devine pas
function isMutatingCall(method: string, args: any[]): boolean {
  if (ARRAY_MUTATORS.has(method)) return true
  const arity = COLLECTION_MUTATORS.get(method)
  return arity !== undefined && args.length === arity && !args.some((a: any) => a.type === 'SpreadElement')
}

// ce nœud écrit-il dans un membre d'une valeur suivie ?
function isWriteToTracked(node: any, tracked: Set<string>): boolean {
  switch (node.type) {
    case 'AssignmentExpression':
      return node.left.type === 'MemberExpression' && isTrackedRef(node.left.object, tracked)
    case 'UpdateExpression':
      return node.argument.type === 'MemberExpression' && isTrackedRef(node.argument.object, tracked)
    case 'UnaryExpression': {
      const arg = unchain(node.argument)
      return node.operator === 'delete' && arg.type === 'MemberExpression' && isTrackedRef(arg.object, tracked)
    }
    case 'CallExpression': {
      const callee = unchain(node.callee)
      if (callee.type !== 'MemberExpression') return false
      const method = memberName(callee)
      if (method !== null && isMutatingCall(method, node.arguments) && isTrackedRef(callee.object, tracked)) return true
      const isObject = callee.object.type === 'Identifier' && callee.object.name === 'Object'
      return isObject && (method === 'assign' || method === 'defineProperty') && isTrackedRef(node.arguments[0], tracked)
    }
  }
  return false
}

// la position de la première écriture que la fonction fait dans l'un de ses paramètres de rang `from` à `to`
// (le magasin est passé à l'un d'eux), null s'il n'y en a pas
function firstWriteOffset(fn: any, from: number, to: number): number | null {
  // les paramètres du rang visé ; un `...reste` est une copie, jamais le magasin lui-même
  const tracked = new Set<string>()
  fn.params.forEach((param: any, i: number) => {
    if (i < from || i > to) return
    const names: string[] = []
    patternNames(param, names, false)
    for (const name of names) tracked.add(name)
  })
  if (tracked.size === 0) return null

  // un nom lié ou réaffecté ailleurs dans la fonction (rappel qui reprend le nom, copie `p = { ...p }`) ne désigne
  // plus forcément le magasin : on ne le suit pas, quitte à manquer une écriture plutôt qu'en inventer une
  const { bound, assigned, declarators } = scanBindings(fn.body)
  for (const name of [...tracked]) if (bound.has(name) || assigned.has(name)) tracked.delete(name)

  // les alias simples, jusqu'à ce qu'il n'y en ait plus de nouveau : `const u = p`, `const list = p.list`,
  // `const { list } = p` ; un nom lié deux fois, ou réaffecté, n'est pas un alias sûr
  let changed = true
  while (changed) {
    changed = false
    for (const { id, init } of declarators) {
      if (!isTrackedRef(init, tracked)) continue
      const names: string[] = []
      patternNames(id, names, false)
      for (const name of names) {
        if (tracked.has(name) || bound.get(name) !== 1 || assigned.has(name)) continue
        tracked.add(name)
        changed = true
      }
    }
  }

  let first = Infinity
  walk.full(fn.body, (node: any) => {
    if (node.start < first && isWriteToTracked(node, tracked)) first = node.start
  })
  return first === Infinity ? null : first
}

// la ligne du .js où la fonction écrit dans le paramètre qui reçoit le magasin, null quand elle n'y écrit pas ou
// qu'on ne sait pas le dire
function writeLineInJs(file: string, imported: RawImport, members: string[], from: number, to: number): number | null {
  const mod = loadJsModule(file)
  if (mod === null) return null
  const key = `${imported.exportName}\0${members.join('.')}\0${from}\0${to}`
  if (mod.verdicts.has(key)) return mod.verdicts.get(key)!
  let line: number | null = null
  try {
    const fn     = functionAt(mod.ast, exportedValue(mod.ast, imported.exportName), members)
    const offset = fn === null ? null : firstWriteOffset(fn, from, to)
    if (offset !== null) line = mod.code.slice(0, offset).split('\n').length
  }
  catch {
    line = null
  }
  mod.verdicts.set(key, line)
  return line
}

/**
 * le lint d'un composant : `scan(code, lineOf?)` lit le JS compilé d'une zone (le `<script>`, le `<script module>`,
 * les gestionnaires du HTML, les expressions du HTML) et dit une ligne par magasin qu'un appel donne à une fonction
 * importée d'un module .js qui écrit dans le paramètre qui le reçoit. `scan` ne fait rien (zéro lecture du code)
 * sans import de ce genre, sans dossier des sources, ou avec `lint.reactivity: false`. un appel dit deux fois (même
 * texte, même ligne : le build range parfois une expression du HTML sous plusieurs formes) n'est dit qu'une fois
 */
export function storeArgsToRawJsLint(clauses: string[], moduleName: string | undefined, lint?: LintToggles, colorsEnabled = false, sourceDir?: string): (code: string | string[], lineOf?: LineOf) => void {
  const imports = lint?.reactivity === false || !sourceDir ? new Map<string, RawImport>() : rawJsImports(clauses)
  if (imports.size === 0) return () => {}
  const said = new Set<string>()

  const scanOne = (code: string, lineOf?: LineOf): void => {
    if (!code.includes('µ.store') || ![...imports.keys()].some(name => code.includes(name))) return
    let ast: acorn.Node
    try {
      ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
    }
    catch {
      return
    }
    const locals = boundNames(ast)
    const visit  = (node: any): void => {
      const target = calleeTarget(node.callee)
      if (target === null || !imports.has(target.root) || locals.has(target.root)) return
      const imported = imports.get(target.root)!
      const args     = node.arguments ?? []
      const spread   = args.findIndex((a: any) => a.type === 'SpreadElement')
      args.forEach((raw: any, j: number) => {
        const store = storePathOf(raw.type === 'SpreadElement' ? raw.argument : raw, code)
        if (store === null) return
        // le chemin réel du fichier ne se résout (quelques appels au disque) que pour un appel qui donne un magasin
        const file = jsFileOf(sourceDir, imported.path)
        if (file === null) return
        // à partir d'un argument étalé, le rang du paramètre qui reçoit chaque valeur n'est plus connu : tous le peuvent
        const open   = spread !== -1 && spread <= j
        const jsLine = writeLineInJs(file, imported, target.members, open ? spread : j, open ? Infinity : j)
        if (jsLine === null) return
        const fn   = code.slice(node.callee.start, node.callee.end).replace(/\s+/g, ' ')
        const line = lineOf?.(node.start, ast) ?? ''
        const key  = `${fn}\0${store}\0${line}`
        if (said.has(key)) return
        said.add(key)
        const text = typedLine('reactivity', t('generator.magasin-vers-module-js', { moduleName: moduleName ?? '?', ligne: line, fonction: fn, fichier: imported.path, magasin: store, ligneJs: jsLine }), lint)
        if (text !== null) printDiagnostic(text, colorsEnabled)
      })
    }
    walk.simple(ast, { CallExpression: visit, NewExpression: visit })
  }

  return (code, lineOf) => {
    for (const piece of Array.isArray(code) ? code : [code]) scanOne(piece, lineOf)
  }
}

/**
 * les lignes du fichier des gestionnaires du HTML : le JS compilé des gestionnaires est un tableau `this._mjs_inline`
 * (ou, quand le HTML compile par groupes, `this._mjs_inline[3] = …`) dont l'index est celui de `lines`, la ligne de la
 * balise qui porte chaque gestionnaire (generator/state.ts, `inlineLines`)
 */
export function inlineHandlerLines(lines: Array<number | undefined>): LineOf {
  return (offset, ast) => {
    for (const stmt of (ast as any).body ?? []) {
      if (offset < stmt.start || offset >= stmt.end || stmt.type !== 'ExpressionStatement') continue
      const assign = stmt.expression
      if (assign?.type !== 'AssignmentExpression') continue
      const left  = assign.left
      const index = left.type === 'MemberExpression' && left.computed && left.property.type === 'Literal'
        ? left.property.value
        : (assign.right?.elements ?? []).findIndex((el: any) => el && offset >= el.start && offset < el.end)
      return typeof index === 'number' ? (lines[index] ?? null) : null
    }
    return null
  }
}
