// déclarations des variables du script, tranchées par l'arbre de Civet, jamais par un motif sur le texte. Civet compile le
// script sans `autoVar` ni `autoLet` : ModularJS déclare lui-même, avec la portée d'`autoVar` (la fonction entière). Sa passe
// ligne par ligne (applyCivetDialectSugar) déclare la forme courante, `nom = valeur` sur une ligne : `.=` à la place du `=`
// quand l'affectation est une instruction du corps de la fonction, sinon `nom .= undefined` devant la première instruction de
// ce corps. Elle note chaque déclaration qu'elle pose (ligne, noms) ; l'arbre de Civet tranche ensuite ce que le texte ne dit
// pas. Une déclaration de la passe que l'arbre contredit est défaite : un `.=` posé dans un bloc (`do`, `then`), où il
// n'existerait que pour ce bloc, ou après une affectation du même nom plus haut dans la fonction, qu'il lierait avant son
// tour, redevient `=` ; un `nom .= undefined` qu'aucune affectation de sa fonction n'utilise (champ de classe, quelle que
// soit la forme de l'en-tête : `new class`, `f class`, classe rendue par une fonction…, même quand le même nom est affecté
// dans une autre fonction ; variable du corps d'une `function` ou d'une méthode, que la passe ne lit pas comme une fonction
// et déclare dans la portée qui l'entoure) ou qui double une déclaration écrite à côté est retiré. Puis un nom qu'aucune déclaration ne lie là où se
// trouve l'affectation (dans son bloc, sa fonction ou au-dessus :
// paramètre, `catch`, `for`, `:=`, `.=`, `let`, import, nom de fonction ou de classe, variable du `<script module>`) est
// déclaré comme la passe le déclare, à sa première affectation : `o =` suivi de la valeur à la ligne d'après, affectation
// dans une expression (`String(o = 1)`, `if m = re.exec(s)`), nom que la déclaration défaite liait. Civet note elle-même, sur
// chaque affectation, les noms qu'elle lie (champ `names`, celui de son `autoVar`). Un nom lié dans un bloc (variable d'une
// boucle ou d'un `catch`, `if x := …`, motif d'un `switch`, classe ou fonction écrite dans un `if`) n'existe que dans ce
// bloc ; `var` vaut pour toute la fonction. Le script garde ses lignes, rien de ce qu'il déclare lui-même n'est retiré, et
// il n'est relu par Civet que s'il a changé. Une chaîne, un commentaire, un champ de classe, un membre (`o.x =`, `@x =`) ou
// une affectation composée (`+=`, `||=`) ne déclarent rien

import { boundNames, isForbiddenName } from './civet-forbidden-names.js'

type Node = any

interface Scope {
  parent: Scope | null
  // fonction (ou script entier) qui contient la portée : là se pose une déclaration ajoutée
  fn: Scope
  // corps de la fonction, ou du script entier ; `null` pour le bloc d'une instruction
  block: Node
  declares: Set<string>
  // noms que le script déclare lui-même, jamais la passe ligne par ligne
  written: Set<string>
}

interface Modification {
  pos: number
  length: number
  text: string
}

// affectation simple (`=`) sans déclaration, ou `nom .= valeur` posé par la passe ligne par ligne (`rendue` une fois
// défaite) ; `pos` : la position de son signe
interface Assignment {
  node: Node
  scope: Scope
  pos: number
  names: string[]
  pass?: 'inPlace' | 'undone'
}

// `nom .= undefined` posé par la passe ligne par ligne
interface Hoisting {
  node: Node
  scope: Scope
  name: string
}

export interface AddedDeclarations {
  // script relu, aux mêmes lignes
  source: string
  // noms déclarés par `nom .= undefined` : le contrôle des noms de variable ne compte pas cette déclaration
  hoisted: string[]
}

// déclarations posées par la passe ligne par ligne, par ligne du texte (0 pour la première) : `nom = …` devenu `nom .= …`
// (enPlace), `nom .= undefined` ajouté (hisses) ; tête de `µ$x =` réécrite, sa valeur restant à entourer de `µ.state(…)` (etats)
export interface PassDeclarations {
  inPlace: Map<number, string[]>
  hoisted: Map<number, string[]>
  states: Map<number, PassState>
}

// tête de `µ$x =` réécrite par la passe : sa cible (`µ_state.x`), son texte d'origine (`avant`), le texte posé (`emis`) et le
// JavaScript à poser après la valeur (`suite` : l'export de `export µ$x =`)
export interface PassState {
  target: string
  before: string
  emitted: string
  after: string
}

export const passDeclarations = (): PassDeclarations => ({ inPlace: new Map(), hoisted: new Map(), states: new Map() })

// lignes ajoutées au texte à partir de la ligne `depuis` (0 pour la première), après que la passe a noté ses déclarations :
// chaque note de cette ligne ou d'en dessous descend d'autant
export function shiftsPass(pass: PassDeclarations, from: number, lines: number): void {
  const shift = <T>(notes: Map<number, T>): void => {
    const shifted = [...notes].map(([line, note]): [number, T] => [line >= from ? line + lines : line, note])
    notes.clear()
    for (const [line, note] of shifted) notes.set(line, note)
  }
  shift(pass.inPlace)
  shift(pass.hoisted)
  shift(pass.states)
}

const FUNCTIONS = new Set(['FunctionExpression', 'ArrowFunction', 'MethodDefinition'])

// nœuds qui déclarent : leurs noms sont lus comme le contrôle des noms de variable les lit (motif, reste, paramètre, motif
// d'un `catch` que Civet change en déclaration)
const DECLARERS = new Set(['Declaration', 'ForDeclaration', 'Parameters', 'CatchParameter', 'ClassExpression', 'EnumDeclaration'])

// instructions dont la tête lie un nom pour elles seules : variable d'une boucle `for`, d'un `catch`
const HEADS = new Set(['ForStatement', 'CatchClause'])

const token = (x: Node): string | undefined => typeof x === 'string' ? x : x?.token

// cible que `.=` déclare telle quelle : un nom, ou un motif objet / tableau fait de noms seulement (jamais un membre)
function purePattern(m: Node): boolean {
  if (m == null || typeof m === 'string' || m.$loc) return true
  if (Array.isArray(m)) return m.every(purePattern)
  if (!m.type) return purePattern(m.children)
  switch (m.type) {
    case 'Identifier':
      return true
    case 'ObjectBindingPattern':
      return purePattern(m.properties)
    case 'ArrayBindingPattern':
      return purePattern(m.elements)
    case 'BindingProperty':
      return (m.value ?? m.identifier) != null && purePattern(m.value ?? m.identifier)
    case 'BindingElement':
    case 'BindingRestElement':
      return m.binding != null && purePattern(m.binding)
  }
  return false
}

// début du premier jeton et fin du dernier jeton réels d'un nœud dans le texte (le `let` que Civet tire d'un `.=` porte la
// position du signe, pas celle du nom : il ne compte pas)
function bounds(n: Node, source: string): [number, number] | null {
  let first: number | null = null
  let last                 = 0
  const stack              = [n]
  while (stack.length) {
    const x = stack.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) stack.push(...x)
    else if (x.$loc) {
      if (typeof x.token !== 'string' || !/\S/.test(x.token) || !source.startsWith(x.token, x.$loc.pos)) continue
      if (first == null || x.$loc.pos < first) first = x.$loc.pos
      last = Math.max(last, x.$loc.pos + x.token.length)
    }
    else if (x.children) stack.push(x.children)
  }
  return first == null ? null : [first, last]
}

// position du `.=` d'une déclaration écrite `nom .= …` (son `let` porte la position du signe), sinon -1
function dotEquals(x: Node, source: string): number {
  const loc = x.decl?.$loc
  if (!loc) return -1
  const i = source.indexOf('.=', loc.pos)
  return i >= 0 && i < loc.pos + Math.max(loc.length, 2) ? i : -1
}

// où poser `nom .= undefined` : devant la première instruction du corps, après les `import` / `export` du script entier.
// Un bloc `do` en tête ne se laisse pas précéder sur sa ligne (Civet en fait une accolade) : la déclaration se pose alors en
// `var` devant la première instruction du bloc, et vaut pour toute la fonction, comme avec `autoVar`
function hoistPoint(block: Node, source: string): { pos: number; byVar: boolean } | null {
  for (const e of block.expressions ?? []) {
    const instruction = Array.isArray(e) ? e[1] : null
    if (instruction == null || (block.root && /^(?:Import|Export)/.test(instruction.type ?? ''))) continue
    if (instruction.type === 'DoStatement' && instruction.block) {
      const inside = hoistPoint(instruction.block, source)
      if (inside) return { pos: inside.pos, byVar: true }
      continue
    }
    const pos = firstToken(instruction)
    if (pos != null) return { pos, byVar: false }
  }
  return null
}

// position du premier jeton d'une instruction, même quand Civet en change le texte : là commence l'instruction
function firstToken(n: Node): number | null {
  let first: number | null = null
  const stack              = [n]
  while (stack.length) {
    const x = stack.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) stack.push(...x)
    else if (x.$loc) {
      if (typeof x.token === 'string' && /\S/.test(x.token) && (first == null || x.$loc.pos < first)) first = x.$loc.pos
    }
    else if (x.children) stack.push(x.children)
  }
  return first
}

// portée d'une fonction, ou du script entier : elle reçoit elle-même les déclarations ajoutées
function functionScope(parent: Scope | null, block: Node, declares: Iterable<string> = []): Scope {
  const scope = { parent, block, declares: new Set(declares), written: new Set(declares) } as Scope
  scope.fn    = scope
  return scope
}

// portée d'un bloc ou d'une tête d'instruction, dans la fonction de sa parente
const blockScope = (parent: Scope): Scope => ({ parent, fn: parent.fn, block: null, declares: new Set(), written: new Set() })

// fonction sans place où poser une déclaration : corps écrit sur la ligne de la flèche
const noPlace = (fn: Scope): boolean => !fn.block || (fn.block.bare && !fn.block.root)

const declare = (scope: Scope | null, name: string): boolean => {
  for (let p = scope; p; p = p.parent) if (p.declares.has(name)) return true
  return false
}

// portée où le nom est déclaré, vue de `portee`
const resolve = (scope: Scope | null, name: string): Scope | null => {
  for (let p = scope; p; p = p.parent) if (p.declares.has(name)) return p
  return null
}

// déclaration de la passe retirée : le nom n'est plus déclaré là, sauf si le script l'y déclare lui-même
const forgotten = (scope: Scope, name: string): void => {
  if (!scope.written.has(name)) scope.declares.delete(name)
}

// script où chaque nom qu'une affectation lie sans déclaration est déclaré, et où chaque déclaration de la passe ligne par
// ligne que l'arbre contredit est défaite ; `null` quand il n'y a rien à changer. `connus` : noms déclarés hors du script
// (variables du `<script module>` pour le `<script>`), jamais redéclarés ; `passe` : déclarations posées par cette passe
export function missingDeclarations(ast: Node, source: string, known: readonly string[] = [], pass?: PassDeclarations): AddedDeclarations | null {
  const root                      = functionScope(null, null, known)
  const assignments: Assignment[] = []
  const passHoists: Hoisting[]     = []
  const seen                      = new Set<Node>()
  const stack: [Node, Scope][]    = [[ast, root]]
  // ligne (0 pour la première) d'une position du texte
  const lineEnds: number[] = []
  if (pass) for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) lineEnds.push(i)
  const lineOf = (pos: number): number => {
    let low = 0
    let top = lineEnds.length
    while (low < top) {
      const middle = (low + top) >> 1
      if (lineEnds[middle] < pos) low = middle + 1
      else top = middle
    }
    return low
  }
  // déclaration `nom .= …` que la passe ligne par ligne a notée à sa ligne
  const placedByPass = (x: Node, names: string[]): 'inPlace' | 'hoisted' | null => {
    const pos = pass && names.length ? dotEquals(x, source) : -1
    if (pos < 0) return null
    const line = lineOf(pos)
    if (names.every(name => pass!.inPlace.get(line)?.includes(name))) return 'inPlace'
    if (names.length === 1 && pass!.hoisted.get(line)?.includes(names[0])) return 'hoisted'
    return null
  }
  // première lecture : les noms que chaque portée déclare, où qu'ils soient dans son bloc, et les affectations dans l'ordre
  while (stack.length) {
    const [x, scope] = stack.pop()!
    if (x == null || typeof x !== 'object' || x.$loc || seen.has(x)) continue
    seen.add(x)
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) stack.push([x[i], scope])
      continue
    }
    // nœud propre à TypeScript : absent du JavaScript produit
    if (x.ts) continue
    let rest = scope
    if (x.type === 'BlockStatement') {
      if (x.root && !scope.block) scope.block = x
      // bloc d'une instruction (`if`, boucle, `try`, classe…) : ce qu'il déclare n'existe que dans ce bloc
      else if (x !== scope.block) rest = blockScope(scope)
    }
    else if (HEADS.has(x.type)) rest = blockScope(scope)
    else if (FUNCTIONS.has(x.type)) {
      // ses paramètres sont lus dans ses enfants, dans sa propre portée
      rest = functionScope(scope, x.block)
      if (typeof x.id?.name === 'string') {
        for (const p of [scope, rest]) {
          p.declares.add(x.id.name)
          p.written.add(x.id.name)
        }
      }
    }
    else if (DECLARERS.has(x.type)) {
      // `var` vaut pour toute la fonction ; toute autre déclaration, pour son bloc
      const target = x.type === 'Declaration' && /^var\b/.test(token(x.decl) ?? '') ? scope.fn : scope
      // un nom lu deux fois (motif et champ `names`) compte une fois
      const names = [...new Set(boundNames(x))]
      const kind  = x.type === 'Declaration' ? placedByPass(x, names) : null
      for (const name of names) target.declares.add(name)
      if (kind === 'inPlace') assignments.push({ node: x, scope: target, pos: dotEquals(x, source), names, pass: 'inPlace' })
      else if (kind === 'hoisted') passHoists.push({ node: x, scope: target, name: names[0] })
      else for (const name of names) target.written.add(name)
    }
    else if (x.type === 'AssignmentExpression') {
      const { lhs, names } = x
      // affectation simple seulement (`=`) : une affectation composée ne déclare rien, comme sur une ligne
      if (Array.isArray(lhs) && lhs.length && Array.isArray(names) && lhs.every(e => Array.isArray(e) && token(e[3]) === '=')) {
        const pos = lhs[0][3]?.$loc?.pos ?? bounds(lhs[0], source)?.[0] ?? -1
        assignments.push({ node: x, scope, pos, names: [...new Set<string>(names.filter((name: unknown) => typeof name === 'string'))] })
      }
    }
    if (x.children) stack.push([x.children, rest])
  }
  const modifications: Modification[] = []
  // `.=` de la passe que l'arbre contredit : posé dans un bloc (`do`, `then`), ou après une affectation du même nom plus haut
  // dans la fonction qu'il lierait avant son tour (« Cannot access … before initialization ») ; il redevient `=`, et son nom
  // se déclare plus bas, à sa première affectation
  for (const a of assignments) {
    if (a.pass !== 'inPlace') continue
    const fn          = a.scope.fn
    const instruction = a.scope === fn && (fn.block?.expressions ?? []).some((e: Node) => Array.isArray(e) && e[1] === a.node)
    const preempted   = assignments.some(b => !b.pass && b.pos < a.pos && b.scope.fn === fn && b.names.some(name => a.names.includes(name) && resolve(b.scope, name) === a.scope))
    if (instruction && !preempted) continue
    modifications.push({ pos: a.pos, length: 1, text: ' ' })
    for (const name of a.names) forgotten(a.scope, name)
    a.pass = 'undone'
  }
  // `nom .= undefined` de la passe : retiré quand une déclaration écrite à côté le double, ou quand aucune affectation ne s'en
  // sert : champ de classe, que la passe prend pour une variable, même quand le même nom est affecté dans une autre fonction ;
  // variable du corps d'une `function` ou d'une méthode, que la passe ne lit pas comme une fonction et déclare dans la portée
  // qui l'entoure. Le nom y devient une variable de la fonction qui l'affecte, déclarée à sa première affectation, comme avec
  // `autoVar` ; le `; ` qui le séparait de la suite part avec lui. S'en servent : une affectation de sa fonction qui le lie ;
  // une affectation d'une autre fonction qui le lie quand cette fonction n'a pas de place où déclarer le nom (corps sur la
  // ligne de la flèche) ou que ce nom est interdit
  for (const h of passHoists) {
    const serves = (a: Assignment): boolean => a.pass !== 'inPlace' && a.names.includes(h.name) && resolve(a.scope, h.name) === h.scope && (a.scope.fn === h.scope.fn || noPlace(a.scope.fn) || isForbiddenName(h.name))
    const useful = !h.scope.written.has(h.name) && assignments.some(serves)
    const b      = useful ? null : bounds(h.node, source)
    if (!b) continue
    const end = b[1] + (/^ *; */.exec(source.slice(b[1]))?.[0].length ?? 0)
    modifications.push({ pos: b[0], length: end - b[0], text: '' })
    forgotten(h.scope, h.name)
  }
  // seconde lecture : chaque nom neuf est déclaré une fois, dans la fonction qui contient sa première affectation
  const hoisted = new Map<number, { names: string[]; byVar: boolean }>()
  for (const a of assignments) {
    if (a.pass === 'inPlace') continue
    const { node, scope } = a
    // un nom interdit (`eval`, mot réservé…) reste au contrôle des noms, qui le refuse à sa ligne
    const fresh = a.names.filter(name => !isForbiddenName(name) && !declare(scope, name))
    const fn    = scope.fn
    const block = fn.block
    if (!fresh.length || !block) continue
    // corps écrit sur la ligne de la flèche : la déclaration se pose devant sa première instruction, sur la même ligne, quand ce corps en
    // compte plusieurs (`=> rang = $l.indexOf(2); $l.splice(rang, 1)`) — Civet l'entoure alors d'accolades, la déclaration n'en change
    // pas la forme ; un corps d'une seule instruction aussi (`=> x = 5` : entouré à son tour, il rend la même valeur), sauf quand la valeur affectée est une instruction
    // (`=> x = if a then 'b' else 'c'`, `switch`, `for`, `try`) : cette forme reste refusée, avec son conseil
    if (noPlace(fn)) {
      const only  = (block.expressions ?? []).length < 2
      const point = !only || node.expression?.type !== 'StatementExpression' ? hoistPoint(block, source) : null
      if (point == null) continue
      hoisted.set(point.pos, { names: [...(hoisted.get(point.pos)?.names ?? []), ...fresh], byVar: point.byVar })
      for (const name of fresh) fn.declares.add(name)
      continue
    }
    const lhs         = a.pass ? null : node.lhs
    const sign        = lhs?.[0][3]
    const instruction = (block.expressions ?? []).some((e: Node) => Array.isArray(e) && e[1] === node)
    if (lhs?.length === 1 && sign?.$loc && source.startsWith('=', sign.$loc.pos) && fresh.length === a.names.length && instruction && purePattern(lhs[0][1])) {
      modifications.push({ pos: sign.$loc.pos, length: 1, text: '.=' })
    }
    else {
      const point = hoistPoint(block, source)
      if (point == null) continue
      hoisted.set(point.pos, { names: [...(hoisted.get(point.pos)?.names ?? []), ...fresh], byVar: point.byVar })
    }
    for (const name of fresh) fn.declares.add(name)
  }
  for (const [pos, { names, byVar }] of hoisted) modifications.push({ pos, length: 0, text: names.map(name => byVar ? `var ${name}; ` : `${name} .= undefined; `).join('') })
  if (!modifications.length) return null
  // de la fin vers le début ; à la même position, ce qui est retiré avant ce qui est posé
  let text = source
  for (const m of modifications.sort((a, b) => b.pos - a.pos || b.length - a.length)) text = text.slice(0, m.pos) + m.text + text.slice(m.pos + m.length)
  return { source: text, hoisted: [...hoisted.values()].flatMap(h => h.names) }
}

// signe d'une affectation de l'arbre : `=`, ou `??=` pour le `?=` du texte, que Civet change
const sign = (op: Node): string | undefined => token(op) ?? (Array.isArray(op?.children) ? token(op.children[0]) : undefined)

// `valeur` entourée de l'appel `appel` (`µ.state(…)`, `µ._mjs_univVal(…)`) là où elle se trouve dans `liste` (à toute profondeur de tableaux) ; faux si elle n'y est pas
function wraps(list: Node[], value: Node, call: string): boolean {
  const i = value == null ? -1 : list.indexOf(value)
  if (i >= 0) list[i] = [call, value, ')']
  return i >= 0 || list.some(e => Array.isArray(e) && wraps(e, value, call))
}

// valeur de `µ$x =` dont la passe ligne par ligne n'a réécrit que la tête (`µ_state.x ?= `, notée à sa ligne) : la valeur, telle
// que Civet la lit (sur la ligne, écrite dessous en retrait, liste ou objet sur plusieurs lignes, suite en `.` au retrait de la
// tête…), est entourée de `µ._mjs_univVal(…)`, celle d'un magasin (`export µ$x =`) de `µ.state(…)`, dans l'arbre même, juste avant la génération du JavaScript, jamais sur le texte ; l'export
// de `export µ$x =` suit la valeur (`; export var $x = µ_state.x`, relu par le getter de `µ_state`, comme sur une ligne). Une tête notée que l'arbre ne lit pas comme cette affectation (texte d'une chaîne `"""` qui cite `µ$x =`)
// reprend son texte d'origine et quitte les notes : rend le script ainsi repris, à relire par Civet, sinon `null`
export function wrapsStates(ast: Node, source: string, pass?: PassDeclarations): string | null {
  if (!pass?.states.size) return null
  const starts = [0]
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1)
  const wrapped = new Set<number>()
  const seen    = new Set<Node>()
  const stack   = [ast]
  while (stack.length) {
    const x = stack.pop()
    if (x == null || typeof x !== 'object' || x.$loc || seen.has(x)) continue
    seen.add(x)
    if (Array.isArray(x)) {
      stack.push(...x)
      continue
    }
    if (x.type === 'AssignmentExpression' && x.lhs?.length === 1 && sign(x.lhs[0][3]) === '??=' && Array.isArray(x.children)) {
      const b  = bounds(x.lhs[0][1], source)
      let line = 0
      while (b && line + 1 < starts.length && starts[line + 1] <= b[0]) line++
      const note = b ? pass.states.get(line) : undefined
      if (note && !wrapped.has(line) && source.slice(b![0], b![1]) === note.target) {
        // la valeur elle-même, là où elle se trouve parmi les enfants ; à défaut, tout ce qui suit la cible et son signe. Celle d'un
        // magasin (`export µ$x =`) devient un état (`µ.state`) ; celle d'un `µ$x =` passe par `µ._mjs_univVal`, qui laisse un nombre
        // être un nombre (mjs_state.ts)
        const call = note.after ? 'µ.state(' : 'µ._mjs_univVal('
        if (!wraps(x.children, x.expression, call)) {
          const [target, ...value] = x.children
          x.children               = [target, call, value, ')']
        }
        if (note.after) x.children.push(note.after)
        wrapped.add(line)
      }
    }
    if (x.children) stack.push(x.children)
  }
  let text = source
  // de la dernière ligne vers la première : les positions d'au-dessus ne bougent pas
  for (const [line, note] of [...pass.states].sort((a, b) => b[0] - a[0])) {
    if (wrapped.has(line)) continue
    pass.states.delete(line)
    const indent     = /[ \t]*/y
    indent.lastIndex = starts[line] ?? source.length
    indent.exec(source)
    if (starts[line] != null && source.startsWith(note.emitted, indent.lastIndex)) text = text.slice(0, indent.lastIndex) + note.before + text.slice(indent.lastIndex + note.emitted.length)
  }
  return text === source ? null : text
}
