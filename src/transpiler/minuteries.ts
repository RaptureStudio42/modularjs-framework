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
import { t } from '../messages/index.js'

const NOMS      = new Set(['setTimeout', 'setInterval'])
const GLOBAUX   = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames'])
const FONCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const BLOCS     = new Set(['BlockStatement', 'StaticBlock', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause'])

// les enfants d'un nœud, dans l'ordre du code
function enfants(n: any, f: (x: any) => void): void {
  for (const cle in n) {
    if (cle === 'type' || cle === 'start' || cle === 'end' || cle === 'loc') continue
    const v = n[cle]
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
function chaineFixe(n: any): string | null {
  if (n?.type === 'Literal') return typeof n.value === 'string' ? n.value : null
  if (n?.type === 'TemplateLiteral') {
    let s: string | null = n.quasis[0]?.value?.cooked ?? null
    for (let i = 0; s !== null && i < n.expressions.length; i++) {
      const morceau = chaineFixe(n.expressions[i])
      const suite   = n.quasis[i + 1]?.value?.cooked
      s             = morceau === null || typeof suite !== 'string' ? null : s + morceau + suite
    }
    return s
  }
  if (n?.type !== 'BinaryExpression' || n.operator !== '+') return null
  const gauche = chaineFixe(n.left)
  if (gauche === null) return null
  const droite = chaineFixe(n.right)
  return droite === null ? null : gauche + droite
}

// le nom lu sur un membre : `x.nom`, `x['nom']`, `x['set' + 'Timeout']`
function nomDuMembre(n: any): string | null {
  if (n.computed) return chaineFixe(n.property)
  return n.property?.type === 'Identifier' ? n.property.name : null
}

// sous `typeof` ou sous `!` (test de présence : `!window.setTimeout`), la lecture ne pose rien
function presenceSeule(parent: any): boolean {
  return parent?.type === 'UnaryExpression' && (parent.operator === 'typeof' || parent.operator === '!')
}

// comparée à `null` ou à `undefined` (existence CoffeeScript `setTimeout?`, `window.setTimeout?`, `x != null`) : rien
// n'est posé
function compareeAuVide(n: any, parent: any): boolean {
  if (parent?.type !== 'BinaryExpression' || !['==', '!=', '===', '!=='].includes(parent.operator)) return false
  const autre = parent.left === n ? parent.right : parent.left
  if (autre.type === 'Literal') return autre.raw === 'null'
  return autre.type === 'Identifier' ? autre.name === 'undefined' : autre.type === 'UnaryExpression' && autre.operator === 'void'
}

// l'identifiant n'est pas la lecture d'une variable : nom de propriété, clé, méthode, étiquette, `typeof`, présence, existence
function pasUneLecture(n: any, parent: any): boolean {
  if (!parent) return false
  if (parent.type === 'MemberExpression') return parent.property === n && !parent.computed
  if (parent.type === 'Property') return parent.key === n && !parent.computed && !parent.shorthand
  if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') return parent.key === n && !parent.computed
  return presenceSeule(parent) || compareeAuVide(n, parent) || parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement'
}

// les noms qu'un motif déclare : `a`, `{ a, b: c }`, `[a, ...b]`, `a = 1`
function nomsDuMotif(p: any, f: (nom: string) => void): void {
  if (!p) return
  if (p.type === 'Identifier') f(p.name)
  else if (p.type === 'ObjectPattern') for (const q of p.properties) nomsDuMotif(q.type === 'RestElement' ? q.argument : q.value, f)
  else if (p.type === 'ArrayPattern') for (const q of p.elements) nomsDuMotif(q, f)
  else if (p.type === 'RestElement') nomsDuMotif(p.argument, f)
  else if (p.type === 'AssignmentPattern') nomsDuMotif(p.left, f)
}

// les noms que déclare chaque portée : `var` et paramètres à la fonction, `let` / `const` / `class` / `function` au
// bloc, `import` au module ; un nom déclaré ne vaut que dans sa portée et dans celles qu'elle contient
function portees(ast: any): Map<any, Set<string>> {
  const noms    = new Map<any, Set<string>>()
  const declare = (portee: any, nom: string): void => {
    const s = noms.get(portee)
    if (s) s.add(nom)
    else noms.set(portee, new Set([nom]))
  }
  const relever = (n: any, fonction: any, bloc: any): void => {
    if (FONCTIONS.has(n.type)) {
      if (n.id && n.type === 'FunctionDeclaration') declare(bloc, n.id.name)
      else if (n.id) declare(n, n.id.name)
      for (const p of n.params) nomsDuMotif(p, nom => declare(n, nom))
      fonction = bloc = n
    }
    else if (BLOCS.has(n.type)) {
      bloc = n
      if (n.type === 'CatchClause') nomsDuMotif(n.param, nom => declare(n, nom))
    }
    else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) nomsDuMotif(d.id, nom => declare(n.kind === 'var' ? fonction : bloc, nom))
    }
    else if (n.type === 'ClassDeclaration' && n.id) declare(bloc, n.id.name)
    // le nom d'une classe nommée (`class µK { m () { return µK } }`) : lié dans son corps, comme celui d'une fonction nommée
    else if (n.type === 'ClassExpression' && n.id) declare(n, n.id.name)
    else if (n.type === 'ImportDeclaration') for (const s of n.specifiers) declare(fonction, s.local.name)
    enfants(n, x => relever(x, fonction, bloc))
  }
  relever(ast, ast, ast)
  return noms
}

/** les noms que déclare la racine de l'AST : variables, fonctions, classes, imports */
export function nomsDeLaRacine(ast: any): string[] {
  return ast ? [...(portees(ast).get(ast) ?? [])] : []
}

/** les minuteries brutes de l'AST, dans l'ordre du code : leur nom et leur position ; `libres` : noms déclarés par le composant hors de cet AST */
export function minuteriesBrutes(ast: any, libres: Iterable<string> = []): { nom: string, debut: number }[] {
  const noms                                   = portees(ast)
  const ouvertes: Set<string>[]                = [new Set(libres)]   // noms du composant, puis portées autour du nœud visité qui déclarent un nom
  const vues: { nom: string, debut: number }[] = []
  const local                                  = (nom: string): boolean => ouvertes.some(s => s.has(nom))
  // l'objet global, non redéclaré : `window`, `globalThis`, `self`, `top`, `parent`, `frames`, leurs chaînes,
  // `document.defaultView`, le `ownerDocument.defaultView` d'un nœud
  const global = (o: any): boolean => {
    if (o?.type === 'ChainExpression') return global(o.expression)
    if (o?.type === 'Identifier') return GLOBAUX.has(o.name) && !local(o.name)
    if (o?.type !== 'MemberExpression') return false
    const nom = nomDuMembre(o)
    if (nom !== 'defaultView') return nom !== null && GLOBAUX.has(nom) && global(o.object)
    const d = o.object?.type === 'ChainExpression' ? o.object.expression : o.object
    if (d?.type === 'Identifier') return d.name === 'document' && !local('document')
    // le document de l'objet global, ou celui d'un nœud (`el.ownerDocument`, `document.body.ownerDocument`)
    return d?.type === 'MemberExpression' && (nomDuMembre(d) === 'ownerDocument' || nomDuMembre(d) === 'document' && global(d.object))
  }
  const visiter = (n: any, parent: any): void => {
    const portee = noms.get(n)
    if (portee) ouvertes.push(portee)
    if (n.type === 'Identifier') {
      if (NOMS.has(n.name) && !pasUneLecture(n, parent) && !local(n.name)) vues.push({ nom: n.name, debut: n.start })
    }
    else if (n.type === 'MemberExpression') {
      const nom = nomDuMembre(n)
      if (nom !== null && NOMS.has(nom) && !presenceSeule(parent) && !compareeAuVide(n, parent) && global(n.object)) vues.push({ nom, debut: n.start })
    }
    // décomposée depuis l'objet global : `{ setTimeout } = window`, `{ setTimeout: st } = window`
    const motif  = n.type === 'VariableDeclarator' ? n.id : n.type === 'AssignmentExpression' || n.type === 'AssignmentPattern' ? n.left : null
    const source = n.type === 'VariableDeclarator' ? n.init : n.right
    if (motif?.type === 'ObjectPattern' && global(source)) {
      for (const p of motif.properties) {
        const nom = p.type !== 'Property' ? null : !p.computed && p.key.type === 'Identifier' ? p.key.name : chaineFixe(p.key)
        if (nom !== null && NOMS.has(nom)) vues.push({ nom, debut: p.key.start })
      }
    }
    enfants(n, x => visiter(x, n))
    if (portee) ouvertes.pop()
  }
  visiter(ast, null)
  // dans l'ordre du code ; une même position ne compte qu'une fois (clé et valeur d'un raccourci `{ setTimeout }`)
  const debuts = new Set<number>()
  return vues.sort((a, b) => a.debut - b.debut).filter(v => !debuts.has(v.debut) && debuts.add(v.debut) !== undefined)
}

/** refuse les minuteries brutes d'un composant, à leur ligne du .mjs : la première porte le message, les autres sont citées */
export function refuserMinuteriesBrutes(ast: any, ligneDe: (offset: number) => number | null, moduleName: string, gestionnaire: boolean, libres: Iterable<string> = []): void {
  if (!ast) return
  const vues = minuteriesBrutes(ast, libres)
  if (vues.length === 0) return
  const lignes = vues.map(v => ligneDe(v.debut))
  const autres = [...new Set(lignes.slice(1).filter((l): l is number => l !== null && l !== lignes[0]))].join(', ')
  throw new Error(t('transpiler.minuterie-brute', { moduleName, nom: vues[0].nom, ligne: lignes[0] ?? '', gestionnaire: gestionnaire ? 'oui' : '', autres }))
}

// un identifiant qui n'est pas la lecture d'une variable : nom de propriété ou de méthode, clé d'objet (la valeur d'un raccourci
// `{ a }`, copie du nom, en est une), nom importé ou exporté sous un autre nom, libellé, `import.meta`
function pasUnNomLu(n: any, parent: any): boolean {
  if (!parent) return false
  if (parent.type === 'MemberExpression') return parent.property === n && !parent.computed
  if (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') return parent.key === n && !parent.computed
  if (parent.type === 'ImportSpecifier') return parent.imported === n && parent.local !== n
  if (parent.type === 'ExportSpecifier') return parent.exported === n && parent.local !== n
  return parent.type === 'ExportAllDeclaration' || parent.type === 'MetaProperty' || parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement'
}

/** les lectures des noms `cherches` qu'aucune portée qui les englobe ne déclare (cf. portees), dans l'ordre du code, chacune avec ses
 *  ancêtres, de la racine au parent : le `µ` d'un .js copié, qui reçoit alors le cœur par un import (bundler, prepareCopiedJs), le
 *  `type: Reward` d'un appel par verbe que rien ne lie à son endroit (var-types.ts, checkAjaxVerbNames) */
export function lecturesLibres(ast: any, cherches: Set<string> | ((nom: string) => boolean)): { nom: string, noeud: any, ancetres: any[] }[] {
  const cherche                                              = typeof cherches === 'function' ? cherches : (nom: string) => (cherches as Set<string>).has(nom)
  const noms                                                 = portees(ast)
  const ouvertes: Set<string>[]                              = []
  const chemin: any[]                                        = []
  const vues: { nom: string, noeud: any, ancetres: any[] }[] = []
  const visiter = (n: any): void => {
    const portee = noms.get(n)
    if (portee) ouvertes.push(portee)
    if (n.type === 'Identifier' && cherche(n.name) && !pasUnNomLu(n, chemin[chemin.length - 1]) && !ouvertes.some(s => s.has(n.name))) vues.push({ nom: n.name, noeud: n, ancetres: [...chemin] })
    chemin.push(n)
    enfants(n, visiter)
    chemin.pop()
    if (portee) ouvertes.pop()
  }
  visiter(ast)
  return vues
}
