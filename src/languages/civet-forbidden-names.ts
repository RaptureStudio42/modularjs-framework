// noms qu'un script ne peut pas déclarer ni affecter, lus dans l'arbre de Civet, jamais dans le texte : Civet note elle-même,
// sur chaque affectation, déclaration (`:=`, `.=`, `let`, import), liste de paramètres et boucle `for`, les noms qu'elle lie
// (champ `names`, celui que sert son `autoVar`), et le contrôle lit le motif lui-même là où ce champ manque ou se tait : motif
// objet ou tableau (reste compris), `undefined` qu'elle lit comme une valeur à comparer mais que le JavaScript produit déclare
// (`undefined :=`, `[a, undefined] =`), déclaration qu'elle tire d'un `catch`, d'un `if x :=` ou d'un motif de `switch`.
// S'y ajoutent les noms de fonction, de classe et d'`enum`, la variable d'un `catch` et la cible d'un `++` / `--`. Une chaîne,
// un commentaire, une expression régulière, une clé, un membre, une valeur par défaut, une valeur comparée, un type ou un champ
// de classe ne lient jamais rien

import { t } from '../messages/index.js'

export type ForbiddenNameKind = 'reserve' | 'strict' | 'value'

export interface ForbiddenName {
  name: string
  kind: ForbiddenNameKind
  line: number
  column: number
}

// mots réservés de JavaScript, ceux du mode strict compris (`await` l'est dans un module)
const RESERVED = ['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']

// `eval` et `arguments` : interdits comme variable en JavaScript strict ; `undefined`, `NaN`, `Infinity` : déclarés dans le
// script, ils masqueraient la valeur de JavaScript dans tout le composant, code produit par ModularJS compris
const NAMES = new Map<string, ForbiddenNameKind>([...RESERVED.map(n => [n, 'reserve'] as [string, ForbiddenNameKind]), ['eval', 'strict'], ['arguments', 'strict'], ['undefined', 'value'], ['NaN', 'value'], ['Infinity', 'value']])

type Node = any

// nom lié, et le nœud où chercher sa position
type Binding = [string, Node]

// noms liés par un motif : identifiant, `undefined` lu comme une valeur à comparer (nœud `PinPattern`), motif objet ou tableau,
// reste ; jamais une clé, une valeur par défaut, un type ni un membre (`o.x =`, `o[x] =`)
function pattern(m: Node, links: Binding[]): void {
  if (m == null || typeof m !== 'object' || m.$loc) return
  if (Array.isArray(m)) {
    for (const x of m) pattern(x, links)
    return
  }
  if (m.type === 'Identifier') {
    if (typeof m.name === 'string') links.push([m.name, m])
    return
  }
  if (m.type === 'PinPattern') {
    if (m.expression?.$loc) links.push([m.expression.token, m.expression])
    return
  }
  // enveloppe sans type : lue dans ses enfants ; celle d'un nom importé (`{ eval as e }`) : le nom lié seul, jamais le nom
  // importé
  if (!m.type) return pattern('source' in m && m.binding ? m.binding : m.children, links)
  // les noms que Civet note sur le motif, puis ceux qu'elle tait
  if (/Binding|Pattern|^Parameter$/.test(m.type)) {
    for (const name of m.names ?? []) if (typeof name === 'string') links.push([name, m])
  }
  switch (m.type) {
    case 'Binding':
      return pattern(m.pattern, links)
    case 'ObjectBindingPattern':
      return pattern(m.properties, links)
    case 'ArrayBindingPattern':
      return pattern(m.elements, links)
    case 'BindingProperty':
      // `{cle: valeur}` lie la valeur ; `{nom}` et `{nom = defaut}`, le nom
      return pattern(m.value ?? m.identifier ?? m.name, links)
    case 'BindingElement':
    case 'BindingRestElement':
    case 'Parameter':
      return pattern(m.binding, links)
  }
}

// enfants d'une déclaration produite par Civet jusqu'à son ` = ` : le mot `const` et le motif, jamais la valeur
function beforeEquals(children: Node): Node[] {
  // liaison par défaut d'un import (`import X from`, que produit la directive `@import default X`) : l'enfant est l'identifiant
  // seul, que Civet note dans `names` ; rien de plus à lire
  if (!Array.isArray(children)) return []
  const end = children.findIndex(e => String(typeof e === 'string' ? e : e?.$loc ? e.token : '').includes('='))
  return end < 0 ? children : children.slice(0, end)
}

// `x .= undefined` que la passe de déclaration de ModularJS a posé elle-même pour un nom qu'elle voit affecté plus bas
function placedByMjs(n: Node, declares: ReadonlySet<string>): boolean {
  const binding = n.bindings?.length === 1 ? n.bindings[0] : null
  const value   = binding?.initializer?.expression
  if (value?.type !== 'Identifier' || value.name !== 'undefined') return false
  const links: Binding[] = []
  pattern(binding, links)
  return links.length > 0 && links.every(([name]) => declares.has(name))
}

// noms liés par un nœud, chacun avec la partie du nœud où chercher sa position
function bindings(n: Node, declares?: ReadonlySet<string>): Binding[] {
  const links: Binding[] = []
  switch (n.type) {
    case 'Declaration':
      // déclaration posée par ModularJS : l'affectation du script est refusée à sa ligne, et un champ de classe ainsi déclaré
      // n'est pas une variable
      if (declares?.size && placedByMjs(n, declares)) return links
      // déclaration que Civet tire d'un motif (`catch`, `if x :=`, `switch`) : sans `bindings`, le motif avant son ` = `
      pattern(n.bindings?.length ? n.bindings : beforeEquals(n.children), links)
      break
    case 'AssignmentExpression':
      pattern(n.lhs, links)
      break
    case 'Parameters':
      pattern(n.parameters, links)
      break
    case 'CatchParameter':
      pattern(n.binding, links)
      break
    case 'FunctionExpression':
    case 'ClassExpression':
    case 'EnumDeclaration':
      if (typeof n.id?.name === 'string') links.push([n.id.name, n.id])
      break
    case 'UpdateExpression':
      if (n.assigned?.type === 'Identifier') links.push([n.assigned.name, n.assigned])
      break
  }
  // noms que Civet note elle-même sur une affectation, une déclaration, une liste de paramètres ou une boucle `for`
  if (['AssignmentExpression', 'Declaration', 'Parameters', 'ForDeclaration'].includes(n.type) && Array.isArray(n.names)) {
    const part = n.lhs ?? n.bindings ?? n.parameters ?? n.binding ?? n
    for (const name of n.names) if (typeof name === 'string') links.push([name, part])
  }
  return links
}

// noms qu'une déclaration, une liste de paramètres, un `catch`, une boucle `for`, une fonction, une classe ou un `enum`
// lient, lus comme ce contrôle les lit
export function boundNames(n: Node): string[] {
  return bindings(n).map(([name]) => name)
}

// nom qu'un script ne peut ni déclarer ni affecter
export function isForbiddenName(name: string): boolean {
  return NAMES.has(name)
}

// position du jeton `nom` dans la partie donnée (son premier jeton à défaut)
function positionOf(part: Node, name: string): number | null {
  let first: number | null = null
  const stack                 = [part]
  while (stack.length) {
    const x = stack.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) stack.push(x[i])
      continue
    }
    if (x.$loc) {
      if (x.token === name) return x.$loc.pos
      first ??= x.$loc.pos
      continue
    }
    if (x.children) stack.push(x.children)
  }
  return first
}

// premier nom interdit que le script déclare ou affecte, d'après l'arbre que Civet a lu ; `null` sinon. `declares` : noms que
// la passe de déclaration de ModularJS déclare elle-même (`x .= undefined`), jamais comptés à cette place
export function forbiddenName(ast: Node, source: string, declares?: ReadonlySet<string>): ForbiddenName | null {
  const stack = [ast]
  while (stack.length) {
    const x = stack.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) stack.push(x[i])
      continue
    }
    // nœud propre à TypeScript : absent du JavaScript produit
    if (x.ts) continue
    const link = x.type ? bindings(x, declares).find(([name]) => NAMES.has(name)) : undefined
    if (link) {
      const [name, part] = link
      const pos          = positionOf(part, name) ?? positionOf(x, name) ?? 0
      const start        = source.lastIndexOf('\n', pos - 1) + 1
      return { name, kind: NAMES.get(name)!, line: source.slice(0, pos).split('\n').length, column: pos - start + 1 }
    }
    if (x.children) stack.push(x.children)
  }
  return null
}

// message `<fichier>:<ligne>:<colonne>` : le transpileur ramène la ligne à celle du `.mjs` ; le nom reste sur l'erreur, pour
// sa colonne dans une directive `@import`
export function forbiddenNameError(n: ForbiddenName, file: string): Error {
  return Object.assign(new Error(t('languages.civet-name-forbidden', { position: `${file}:${n.line}:${n.column}`, name: n.name, kind: n.kind })), { forbiddenName: n.name })
}
