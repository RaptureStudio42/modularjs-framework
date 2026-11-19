// bundler/class-files — les fichiers `Nom.class.mjs` : les classes globales de l'appli.
//
// Un fichier de classe n'est pas un composant : il porte du code Civet seul (une `class Nom`, ses constantes, son état et ses
// méthodes), lu partout en `µNom` (ou `µ.Nom`) sans import. La portée de la classe vaut pour tout son corps : un membre (`NOM = …` au
// premier retrait) s'y lit et s'y écrit par son nom, sans `@`, et un `@` y est refusé à la construction. La construction relève, dans
// chaque source, les classes qu'elle cite et pose en tête de son code un import statique de chacune, par le canal des `@import` : la
// classe part avec ceux qui la citent, évaluée avant eux (lecture synchrone), jamais au démarrage. Sa sortie s'enregistre sur `µ` ;
// une seconde sortie, `node/Nom.js`, se charge sous Node sans le cœur

import { basename, relative } from 'node:path'
import { parse } from 'acorn'
import { full } from 'acorn-walk'

import { t } from '../messages/index.js'
import { freeReads } from '../transpiler/timers.js'

/** les noms à majuscule que le framework pose sur `µ` : une classe de l'appli ne les prend pas */
export const FRAMEWORK_CLASS_NAMES = ['Autoloader', 'CSS', 'Element', 'LRUCache', 'Router', 'Store', 'Ticker', 'TypeError']

export function isClassFile(filePath: string): boolean {
  return basename(filePath, '.mjs').endsWith('.class')
}

/** un `.mjs` qui est une unité de composant : une classe globale est un module autonome */
// un module MJS : `outil.civet.mjs`, `outil.coffee.mjs` ou `outil.js.mjs`, compilé par MJS dans sa langue — un `.civet`, un `.coffee`
// ou un `.js` ordinaire est une bibliothèque, compilée par son seul langage ou copiée telle quelle
export const MJS_MODULE_EXTS = ['.civet.mjs', '.coffee.mjs', '.js.mjs'] as const
export const isModuleFile    = (filePath: string): boolean => MJS_MODULE_EXTS.some(e => filePath.endsWith(e))
// un module MJS n'est pas un composant non plus
export const isComponentFile = (filePath: string): boolean => filePath.endsWith('.mjs') && !isClassFile(filePath) && !isModuleFile(filePath)

export const classNameOf = (filePath: string): string => basename(filePath, '.class.mjs')

/** l'import qu'une source reçoit pour une classe qu'elle cite : la forme d'un `@import` sans nom, résolue avec eux */
export const classImport = (path: string): string => `import "µasset('${path}')"`

/** les classes qu'une source cite (`µNom`, `µ.Nom`), sans celle qu'elle déclare elle-même (`class Nom` en tête de ligne) */
export function classesCitedBy(src: string, classes: Record<string, string>): string[] {
  if (Object.keys(classes).length === 0) return []
  const itself = /^class[ \t]+([A-Z][A-Za-z0-9_]*)/m.exec(src)?.[1]
  const seen   = new Set<string>()
  for (const m of src.matchAll(/µ\.?([A-Z][A-Za-z0-9_]*)/g)) {
    if (m[1] !== itself && Object.prototype.hasOwnProperty.call(classes, m[1])) seen.add(m[1])
  }
  return [...seen].sort()
}

/** les classes du projet : nom → chemin depuis sourceDir ; un nom refusé, un nom en double, un fichier mal formé ou des classes
 *  qui se citent en boucle lèvent, avec le fichier */
export function collectClasses(files: string[], sourceDir: string, read: (file: string) => string): Record<string, string> {
  const classes: Record<string, string> = {}
  const sources: Record<string, string> = {}
  for (const f of [...files].sort()) {
    const name = classNameOf(f)
    const file = relative(sourceDir, f)
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) throw new Error(t('bundler.class-name-invalid', { file: file, name: name }))
    if (FRAMEWORK_CLASS_NAMES.includes(name)) throw new Error(t('bundler.class-name-framework', { file: file, name: name }))
    if (Object.prototype.hasOwnProperty.call(classes, name)) throw new Error(t('bundler.class-name-duplicate', { name: name, file1: classes[name], file2: file }))
    const src   = read(f)
    const block = /^[ \t]*<(script|style|template|vars|types|routes|theme|effects)\b/m.exec(src)
    if (block) throw new Error(t('bundler.class-block', { file: file, block: `<${block[1]}>` }))
    if (!new RegExp(`^class[ \\t]+${name}\\b`, 'm').test(src)) throw new Error(t('bundler.class-no-class', { file: file, name: name }))
    classes[name] = file
    sources[name] = src
  }
  // une boucle de citations (A lit B, B lit A) : deux modules qui s'attendent l'un l'autre à la construction
  const done = new Set<string>()
  const visit = (name: string, path: string[]): void => {
    if (path.includes(name)) throw new Error(t('bundler.class-loop', { chain: [...path.slice(path.indexOf(name)), name].map(n => `µ${n}`).join(' → ') }))
    if (done.has(name)) return
    for (const cited of classesCitedBy(sources[name], classes)) visit(cited, [...path, name])
    done.add(name)
  }
  for (const name of Object.keys(classes)) visit(name, [])
  return classes
}

/** la lecture d'un fichier de classe : sa source, chaque champ de `class Nom` devenu `static`, et les noms de ses membres */
export type ClassLayout = { source: string, members: string[] }

// un nœud de l'arbre de Civet : une feuille porte son jeton et sa position (`$loc`), un nœud ses enfants dans l'ordre du texte
const sheet = (x: any): boolean => x?.$loc && typeof x.token === 'string'

// la première feuille non vide d'un nœud, dans l'ordre du texte
function firstLeaf(x: any): any {
  if (x == null || typeof x !== 'object') return null
  if (Array.isArray(x)) {
    for (const y of x) {
      const f = firstLeaf(y)
      if (f) return f
    }
    return null
  }
  if (sheet(x)) return x.token.trim() ? x : null
  return firstLeaf(x.children)
}

// les nœuds d'un arbre de Civet, dans l'ordre du texte ; `visite` rend `false` pour ne pas descendre sous un nœud
function walkCivet(x: any, visit: (n: any) => boolean | void): void {
  if (x == null || typeof x !== 'object') return
  if (Array.isArray(x)) {
    for (const y of x) walkCivet(y, visit)
    return
  }
  if (visit(x) === false || sheet(x)) return
  walkCivet(x.children, visit)
}

const CIVET_FUNCTION = /Function|Method|Arrow/

/** la lecture d'un fichier de classe par l'arbre de Civet : commentaires `#` et `###`, chaînes, interpolations `#{…}` et expressions
 *  régulières (entre parenthèses ou non) lus comme Civet les lit, jamais par un masque du texte. Un `@` du code est refusé (fichier,
 *  ligne, bonne écriture), une seconde classe aussi ; chaque champ du corps de `class Nom` (`NOM = …`, `NOM: Type = …`) devient
 *  `static` et compte parmi ses membres. Les lignes `@import` (directives) sont blanchies, même longueur, avant la lecture */
export async function classLayout(src: string, name: string, file: string): Promise<ClassLayout> {
  const civet = await import('@danielx/civet')
  const text  = src.replace(/^[ \t]*@import\b.*$/gm, l => ' '.repeat(l.length))
  const ast   = (civet.compile as any)(text, { js: true, ast: true, sync: true, filename: file, parseOptions: { coffeeComment: true, coffeeInterpolation: true } })
  const line  = (pos: number): number => text.slice(0, pos).split('\n').length
  // un `@` du code (`@x`, `@`, `@@x`, lus `this` par Civet) : le texte d'une chaîne qui commence par `@` garde son jeton tel quel
  let at = -1
  walkCivet(ast, n => {
    if (sheet(n) && text[n.$loc.pos] === '@' && !n.token.startsWith('@') && (at < 0 || n.$loc.pos < at)) at = n.$loc.pos
  })
  if (at >= 0) {
    const member = /^@([A-Za-z_$][\w$]*)[ \t]*=(?!=)/.exec(text.slice(at))
    const m      = /^(@@?)([A-Za-z_$][\w$]*)?/.exec(text.slice(at))!
    throw new Error(t('bundler.class-at-sign', { file: file, line: line(at), written: member ? `@${member[1]} = …` : m[0], correct: member ? `${member[1]} = …` : m[2] ?? name }))
  }
  // les classes du premier niveau du fichier : la sienne seule
  const classes: any[] = []
  walkCivet(ast, n => {
    if (n.type === 'ClassExpression') classes.push(n)
    return n.type !== 'ClassExpression' && !CIVET_FUNCTION.test(n.type ?? '')
  })
  const other = classes.find(c => c.name !== name)
  if (other) throw new Error(t('bundler.class-second', { file: file, line: line(firstLeaf(other)?.$loc.pos ?? 0), other: other.name ?? '…', name: name }))
  const cls = classes.find(c => c.name === name)
  if (!cls) throw new Error(t('bundler.class-no-class', { file: file, name: name }))
  // ses champs, au premier niveau de son corps (ni ceux d'une méthode, ni ceux d'une classe qu'elle contient)
  const fields: any[] = []
  walkCivet(cls.body, n => {
    if (n.type === 'FieldDefinition') fields.push(n)
    return n.type !== 'FieldDefinition' && n.type !== 'ClassExpression' && !CIVET_FUNCTION.test(n.type ?? '')
  })
  let source = src
  for (const c of [...fields].reverse()) {
    const f = firstLeaf(c)
    if (f && f.token !== 'static') source = source.slice(0, f.$loc.pos) + 'static ' + source.slice(f.$loc.pos)
  }
  return { source, members: fields.map(c => c.id?.name).filter((n): n is string => typeof n === 'string') }
}

// la première liaison nommée `nom` sous un nœud du code compilé : paramètre, variable, boucle, `catch`, fonction ou classe nommée
function bindingNamed(root: any, name: string): any {
  const seen: any[] = []
  const pattern = (p: any): void => {
    if (!p) return
    if (p.type === 'Identifier' && p.name === name) seen.push(p)
    else if (p.type === 'ObjectPattern') for (const q of p.properties) pattern(q.type === 'RestElement' ? q.argument : q.value)
    else if (p.type === 'ArrayPattern') for (const q of p.elements) pattern(q)
    else if (p.type === 'RestElement') pattern(p.argument)
    else if (p.type === 'AssignmentPattern') pattern(p.left)
  }
  full(root, (n: any) => {
    if (/Function/.test(n.type)) {
      pattern(n.id)
      for (const p of n.params) pattern(p)
    }
    else if (n.type === 'VariableDeclarator') pattern(n.id)
    else if (n.type === 'CatchClause') pattern(n.param)
    else if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') pattern(n.id)
  })
  return seen.sort((a, b) => a.start - b.start)[0] ?? null
}

/** dans le corps de la classe compilée, chaque nom libre qui désigne un de ses membres statiques se lit sur la classe (`NOM` →
 *  `Nom.NOM`, raccourci `{ NOM }` → `{ NOM: Nom.NOM }`) : un paramètre ou une variable du même nom le cache, comme toute portée ;
 *  une clé, une propriété, une chaîne ou le texte d'un gabarit ne sont pas des noms. Une méthode détachée (`liste.map(µNom.m)`)
 *  garde ainsi sa classe, et le minifieur garde les noms publics (des propriétés). Refus, à la ligne du fichier (`i` : la
 *  ligne d'une position du code compilé) : `delete NOM` d'un membre, une liaison nommée comme la classe dans son corps (elle y
 *  cacherait la classe) ; des membres lus dans le fichier (`membres`, cf. classLayout) qui ne sont pas exactement les champs
 *  statiques de la classe compilée arrêtent la construction, jamais un membre perdu en silence */
export function classScope(js: string, name: string, members: string[], file: string, lineOf: (offset: number) => number | null): string {
  let ast: any
  try {
    ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch (e: any) {
    // `delete NOM` : le mode strict des modules refuse de retirer un nom ; le membre se retire sur la classe
    const removed = /^Deleting local variable in strict mode/.test(e?.message ?? '') ? /^delete\s+([A-Za-z_$][\w$]*)/.exec(js.slice(e.pos)) : null
    if (removed && members.includes(removed[1])) throw new Error(t('bundler.class-delete', { file: file, line: lineOf(e.pos) ?? '?', member: removed[1], name: name }))
    throw e
  }
  const cls     = ast.body.find((n: any) => n.type === 'ClassDeclaration' && n.id?.name === name)
  const statics = cls ? cls.body.body.filter((d: any) => d.static && !d.computed && d.key?.type === 'Identifier') : []
  const fields  = statics.filter((d: any) => d.type === 'PropertyDefinition').map((d: any) => d.key.name)
  const lost    = members.filter(m => !fields.includes(m))
  const extra   = fields.filter((m: string) => !members.includes(m))
  if (lost.length || extra.length) throw new Error(t('bundler.class-members', { file: file, lost: lost.join(', ') || '—', extra: extra.join(', ') || '—' }))
  if (!cls || statics.length === 0) return js
  const bound = bindingNamed(cls.body, name)
  if (bound) throw new Error(t('bundler.class-name-bound', { file: file, line: lineOf(bound.start) ?? '?', name: name }))
  let output = js
  for (const { name: member, node, ancestors } of freeReads(cls.body, new Set<string>(statics.map((d: any) => d.key.name))).sort((a, b) => b.node.start - a.node.start)) {
    const parent    = ancestors[ancestors.length - 1]
    const grand     = ancestors[ancestors.length - 2]
    const shorthand = (parent?.type === 'Property' && parent.shorthand) || (parent?.type === 'AssignmentPattern' && parent.left === node && grand?.type === 'Property' && grand.shorthand)
    output          = output.slice(0, node.start) + (shorthand ? `${member}: ` : '') + `${name}.${member}` + output.slice(node.end)
  }
  return output
}

/** la sortie pour Node d'une classe : son code compilé, `µ` pris sur `globalThis` (créé au besoin, partagé par les classes
 *  chargées), l'import d'une autre classe réécrit vers sa sortie voisine (`./Nom.js`) */
export function nodeClassSource(js: string, classes: Record<string, string>): string {
  const byPath = new Map(Object.entries(classes).map(([name, path]) => [path, name]))
  const body   = js.replace(/import\s*(["'])µasset\('([^']+)'\)\1;?/g, (whole: string, _q: string, path: string) => byPath.has(path) ? `import './${byPath.get(path)}.js'` : whole)
  return `const µ = globalThis.µ ??= {}\n${body}`
}
