// noms qu'un script ne peut pas déclarer ni affecter, lus dans l'arbre de Civet, jamais dans le texte : Civet note elle-même,
// sur chaque affectation, déclaration (`:=`, `.=`, `let`, import), liste de paramètres et boucle `for`, les noms qu'elle lie
// (champ `names`, celui que sert son `autoVar`), et le contrôle lit le motif lui-même là où ce champ manque ou se tait : motif
// objet ou tableau (reste compris), `undefined` qu'elle lit comme une valeur à comparer mais que le JavaScript produit déclare
// (`undefined :=`, `[a, undefined] =`), déclaration qu'elle tire d'un `catch`, d'un `if x :=` ou d'un motif de `switch`.
// S'y ajoutent les noms de fonction, de classe et d'`enum`, la variable d'un `catch` et la cible d'un `++` / `--`. Une chaîne,
// un commentaire, une expression régulière, une clé, un membre, une valeur par défaut, une valeur comparée, un type ou un champ
// de classe ne lient jamais rien

import { t } from '../messages/index.js'

export type SorteNomInterdit = 'reserve' | 'strict' | 'valeur'

export interface NomInterdit {
  nom: string
  sorte: SorteNomInterdit
  ligne: number
  colonne: number
}

// mots réservés de JavaScript, ceux du mode strict compris (`await` l'est dans un module)
const RESERVES = ['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']

// `eval` et `arguments` : interdits comme variable en JavaScript strict ; `undefined`, `NaN`, `Infinity` : déclarés dans le
// script, ils masqueraient la valeur de JavaScript dans tout le composant, code produit par ModularJS compris
const NOMS = new Map<string, SorteNomInterdit>([...RESERVES.map(n => [n, 'reserve'] as [string, SorteNomInterdit]), ['eval', 'strict'], ['arguments', 'strict'], ['undefined', 'valeur'], ['NaN', 'valeur'], ['Infinity', 'valeur']])

type Noeud = any

// nom lié, et le nœud où chercher sa position
type Lien = [string, Noeud]

// noms liés par un motif : identifiant, `undefined` lu comme une valeur à comparer (nœud `PinPattern`), motif objet ou tableau,
// reste ; jamais une clé, une valeur par défaut, un type ni un membre (`o.x =`, `o[x] =`)
function motif(m: Noeud, liens: Lien[]): void {
  if (m == null || typeof m !== 'object' || m.$loc) return
  if (Array.isArray(m)) {
    for (const x of m) motif(x, liens)
    return
  }
  if (m.type === 'Identifier') {
    if (typeof m.name === 'string') liens.push([m.name, m])
    return
  }
  if (m.type === 'PinPattern') {
    if (m.expression?.$loc) liens.push([m.expression.token, m.expression])
    return
  }
  // enveloppe sans type : lue dans ses enfants ; celle d'un nom importé (`{ eval as e }`) : le nom lié seul, jamais le nom
  // importé
  if (!m.type) return motif('source' in m && m.binding ? m.binding : m.children, liens)
  // les noms que Civet note sur le motif, puis ceux qu'elle tait
  if (/Binding|Pattern|^Parameter$/.test(m.type)) {
    for (const nom of m.names ?? []) if (typeof nom === 'string') liens.push([nom, m])
  }
  switch (m.type) {
    case 'Binding':
      return motif(m.pattern, liens)
    case 'ObjectBindingPattern':
      return motif(m.properties, liens)
    case 'ArrayBindingPattern':
      return motif(m.elements, liens)
    case 'BindingProperty':
      // `{cle: valeur}` lie la valeur ; `{nom}` et `{nom = defaut}`, le nom
      return motif(m.value ?? m.identifier ?? m.name, liens)
    case 'BindingElement':
    case 'BindingRestElement':
    case 'Parameter':
      return motif(m.binding, liens)
  }
}

// enfants d'une déclaration produite par Civet jusqu'à son ` = ` : le mot `const` et le motif, jamais la valeur
function avantEgal(enfants: Noeud): Noeud[] {
  // liaison par défaut d'un import (`import X from`, que produit la directive `@import default X`) : l'enfant est l'identifiant
  // seul, que Civet note dans `names` ; rien de plus à lire
  if (!Array.isArray(enfants)) return []
  const fin = enfants.findIndex(e => String(typeof e === 'string' ? e : e?.$loc ? e.token : '').includes('='))
  return fin < 0 ? enfants : enfants.slice(0, fin)
}

// `x .= undefined` que la passe de déclaration de ModularJS a posé elle-même pour un nom qu'elle voit affecté plus bas
function poseeParMjs(n: Noeud, declares: ReadonlySet<string>): boolean {
  const liaison = n.bindings?.length === 1 ? n.bindings[0] : null
  const valeur  = liaison?.initializer?.expression
  if (valeur?.type !== 'Identifier' || valeur.name !== 'undefined') return false
  const liens: Lien[] = []
  motif(liaison, liens)
  return liens.length > 0 && liens.every(([nom]) => declares.has(nom))
}

// noms liés par un nœud, chacun avec la partie du nœud où chercher sa position
function liaisons(n: Noeud, declares?: ReadonlySet<string>): Lien[] {
  const liens: Lien[] = []
  switch (n.type) {
    case 'Declaration':
      // déclaration posée par ModularJS : l'affectation du script est refusée à sa ligne, et un champ de classe ainsi déclaré
      // n'est pas une variable
      if (declares?.size && poseeParMjs(n, declares)) return liens
      // déclaration que Civet tire d'un motif (`catch`, `if x :=`, `switch`) : sans `bindings`, le motif avant son ` = `
      motif(n.bindings?.length ? n.bindings : avantEgal(n.children), liens)
      break
    case 'AssignmentExpression':
      motif(n.lhs, liens)
      break
    case 'Parameters':
      motif(n.parameters, liens)
      break
    case 'CatchParameter':
      motif(n.binding, liens)
      break
    case 'FunctionExpression':
    case 'ClassExpression':
    case 'EnumDeclaration':
      if (typeof n.id?.name === 'string') liens.push([n.id.name, n.id])
      break
    case 'UpdateExpression':
      if (n.assigned?.type === 'Identifier') liens.push([n.assigned.name, n.assigned])
      break
  }
  // noms que Civet note elle-même sur une affectation, une déclaration, une liste de paramètres ou une boucle `for`
  if (['AssignmentExpression', 'Declaration', 'Parameters', 'ForDeclaration'].includes(n.type) && Array.isArray(n.names)) {
    const partie = n.lhs ?? n.bindings ?? n.parameters ?? n.binding ?? n
    for (const nom of n.names) if (typeof nom === 'string') liens.push([nom, partie])
  }
  return liens
}

// noms qu'une déclaration, une liste de paramètres, un `catch`, une boucle `for`, une fonction, une classe ou un `enum`
// lient, lus comme ce contrôle les lit
export function nomsLies(n: Noeud): string[] {
  return liaisons(n).map(([nom]) => nom)
}

// nom qu'un script ne peut ni déclarer ni affecter
export function estNomInterdit(nom: string): boolean {
  return NOMS.has(nom)
}

// position du jeton `nom` dans la partie donnée (son premier jeton à défaut)
function positionDe(partie: Noeud, nom: string): number | null {
  let premier: number | null = null
  const pile                 = [partie]
  while (pile.length) {
    const x = pile.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) pile.push(x[i])
      continue
    }
    if (x.$loc) {
      if (x.token === nom) return x.$loc.pos
      premier ??= x.$loc.pos
      continue
    }
    if (x.children) pile.push(x.children)
  }
  return premier
}

// premier nom interdit que le script déclare ou affecte, d'après l'arbre que Civet a lu ; `null` sinon. `declares` : noms que
// la passe de déclaration de ModularJS déclare elle-même (`x .= undefined`), jamais comptés à cette place
export function nomInterdit(ast: Noeud, source: string, declares?: ReadonlySet<string>): NomInterdit | null {
  const pile = [ast]
  while (pile.length) {
    const x = pile.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) pile.push(x[i])
      continue
    }
    // nœud propre à TypeScript : absent du JavaScript produit
    if (x.ts) continue
    const lien = x.type ? liaisons(x, declares).find(([nom]) => NOMS.has(nom)) : undefined
    if (lien) {
      const [nom, partie] = lien
      const pos           = positionDe(partie, nom) ?? positionDe(x, nom) ?? 0
      const debut         = source.lastIndexOf('\n', pos - 1) + 1
      return { nom, sorte: NOMS.get(nom)!, ligne: source.slice(0, pos).split('\n').length, colonne: pos - debut + 1 }
    }
    if (x.children) pile.push(x.children)
  }
  return null
}

// message `<fichier>:<ligne>:<colonne>` : le transpileur ramène la ligne à celle du `.mjs` ; le nom reste sur l'erreur, pour
// sa colonne dans une directive `@import`
export function erreurNomInterdit(n: NomInterdit, fichier: string): Error {
  return Object.assign(new Error(t('languages.civet-nom-interdit', { position: `${fichier}:${n.ligne}:${n.colonne}`, nom: n.nom, sorte: n.sorte })), { nomInterdit: n.nom })
}
