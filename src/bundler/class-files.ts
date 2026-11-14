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
import { lecturesLibres } from '../transpiler/minuteries.js'

/** les noms à majuscule que le framework pose sur `µ` : une classe de l'appli ne les prend pas */
export const FRAMEWORK_CLASS_NAMES = ['Autoloader', 'CSS', 'Element', 'LRUCache', 'Router', 'Store', 'Ticker']

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
export const classImport = (chemin: string): string => `import "µasset('${chemin}')"`

/** les classes qu'une source cite (`µNom`, `µ.Nom`), sans celle qu'elle déclare elle-même (`class Nom` en tête de ligne) */
export function classesCitedBy(src: string, classes: Record<string, string>): string[] {
  if (Object.keys(classes).length === 0) return []
  const soi  = /^class[ \t]+([A-Z][A-Za-z0-9_]*)/m.exec(src)?.[1]
  const vues = new Set<string>()
  for (const m of src.matchAll(/µ\.?([A-Z][A-Za-z0-9_]*)/g)) {
    if (m[1] !== soi && Object.prototype.hasOwnProperty.call(classes, m[1])) vues.add(m[1])
  }
  return [...vues].sort()
}

/** les classes du projet : nom → chemin depuis sourceDir ; un nom refusé, un nom en double, un fichier mal formé ou des classes
 *  qui se citent en boucle lèvent, avec le fichier */
export function collectClasses(files: string[], sourceDir: string, read: (file: string) => string): Record<string, string> {
  const classes: Record<string, string> = {}
  const sources: Record<string, string> = {}
  for (const f of [...files].sort()) {
    const nom     = classNameOf(f)
    const fichier = relative(sourceDir, f)
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(nom)) throw new Error(t('bundler.classe-nom-invalide', { fichier, nom }))
    if (FRAMEWORK_CLASS_NAMES.includes(nom)) throw new Error(t('bundler.classe-nom-framework', { fichier, nom }))
    if (Object.prototype.hasOwnProperty.call(classes, nom)) throw new Error(t('bundler.classe-nom-double', { nom, fichier1: classes[nom], fichier2: fichier }))
    const src  = read(f)
    const bloc = /^[ \t]*<(script|style|template|vars|types|routes|theme|effects)\b/m.exec(src)
    if (bloc) throw new Error(t('bundler.classe-bloc', { fichier, bloc: `<${bloc[1]}>` }))
    if (!new RegExp(`^class[ \\t]+${nom}\\b`, 'm').test(src)) throw new Error(t('bundler.classe-sans-classe', { fichier, nom }))
    classes[nom] = fichier
    sources[nom] = src
  }
  // une boucle de citations (A lit B, B lit A) : deux modules qui s'attendent l'un l'autre à la construction
  const faits = new Set<string>()
  const visiter = (nom: string, chemin: string[]): void => {
    if (chemin.includes(nom)) throw new Error(t('bundler.classe-boucle', { chaine: [...chemin.slice(chemin.indexOf(nom)), nom].map(n => `µ${n}`).join(' → ') }))
    if (faits.has(nom)) return
    for (const cite of classesCitedBy(sources[nom], classes)) visiter(cite, [...chemin, nom])
    faits.add(nom)
  }
  for (const nom of Object.keys(classes)) visiter(nom, [])
  return classes
}

/** la lecture d'un fichier de classe : sa source, chaque champ de `class Nom` devenu `static`, et les noms de ses membres */
export type ClassLayout = { source: string, membres: string[] }

// un nœud de l'arbre de Civet : une feuille porte son jeton et sa position (`$loc`), un nœud ses enfants dans l'ordre du texte
const feuille = (x: any): boolean => x?.$loc && typeof x.token === 'string'

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
  if (feuille(x)) return x.token.trim() ? x : null
  return firstLeaf(x.children)
}

// les nœuds d'un arbre de Civet, dans l'ordre du texte ; `visite` rend `false` pour ne pas descendre sous un nœud
function walkCivet(x: any, visite: (n: any) => boolean | void): void {
  if (x == null || typeof x !== 'object') return
  if (Array.isArray(x)) {
    for (const y of x) walkCivet(y, visite)
    return
  }
  if (visite(x) === false || feuille(x)) return
  walkCivet(x.children, visite)
}

const FONCTION_CIVET = /Function|Method|Arrow/

/** la lecture d'un fichier de classe par l'arbre de Civet : commentaires `#` et `###`, chaînes, interpolations `#{…}` et expressions
 *  régulières (entre parenthèses ou non) lus comme Civet les lit, jamais par un masque du texte. Un `@` du code est refusé (fichier,
 *  ligne, bonne écriture), une seconde classe aussi ; chaque champ du corps de `class Nom` (`NOM = …`, `NOM: Type = …`) devient
 *  `static` et compte parmi ses membres. Les lignes `@import` (directives) sont blanchies, même longueur, avant la lecture */
export async function classLayout(src: string, nom: string, fichier: string): Promise<ClassLayout> {
  const civet = await import('@danielx/civet')
  const texte = src.replace(/^[ \t]*@import\b.*$/gm, l => ' '.repeat(l.length))
  const ast   = (civet.compile as any)(texte, { js: true, ast: true, sync: true, filename: fichier, parseOptions: { coffeeComment: true, coffeeInterpolation: true } })
  const ligne = (pos: number): number => texte.slice(0, pos).split('\n').length
  // un `@` du code (`@x`, `@`, `@@x`, lus `this` par Civet) : le texte d'une chaîne qui commence par `@` garde son jeton tel quel
  let at = -1
  walkCivet(ast, n => {
    if (feuille(n) && texte[n.$loc.pos] === '@' && !n.token.startsWith('@') && (at < 0 || n.$loc.pos < at)) at = n.$loc.pos
  })
  if (at >= 0) {
    const membre = /^@([A-Za-z_$][\w$]*)[ \t]*=(?!=)/.exec(texte.slice(at))
    const m      = /^(@@?)([A-Za-z_$][\w$]*)?/.exec(texte.slice(at))!
    throw new Error(t('bundler.classe-arobase', { fichier, ligne: ligne(at), ecrit: membre ? `@${membre[1]} = …` : m[0], juste: membre ? `${membre[1]} = …` : m[2] ?? nom }))
  }
  // les classes du premier niveau du fichier : la sienne seule
  const classes: any[] = []
  walkCivet(ast, n => {
    if (n.type === 'ClassExpression') classes.push(n)
    return n.type !== 'ClassExpression' && !FONCTION_CIVET.test(n.type ?? '')
  })
  const autre = classes.find(c => c.name !== nom)
  if (autre) throw new Error(t('bundler.classe-seconde', { fichier, ligne: ligne(firstLeaf(autre)?.$loc.pos ?? 0), autre: autre.name ?? '…', nom }))
  const classe = classes.find(c => c.name === nom)
  if (!classe) throw new Error(t('bundler.classe-sans-classe', { fichier, nom }))
  // ses champs, au premier niveau de son corps (ni ceux d'une méthode, ni ceux d'une classe qu'elle contient)
  const champs: any[] = []
  walkCivet(classe.body, n => {
    if (n.type === 'FieldDefinition') champs.push(n)
    return n.type !== 'FieldDefinition' && n.type !== 'ClassExpression' && !FONCTION_CIVET.test(n.type ?? '')
  })
  let source = src
  for (const c of [...champs].reverse()) {
    const f = firstLeaf(c)
    if (f && f.token !== 'static') source = source.slice(0, f.$loc.pos) + 'static ' + source.slice(f.$loc.pos)
  }
  return { source, membres: champs.map(c => c.id?.name).filter((n): n is string => typeof n === 'string') }
}

// la première liaison nommée `nom` sous un nœud du code compilé : paramètre, variable, boucle, `catch`, fonction ou classe nommée
function bindingNamed(racine: any, nom: string): any {
  const vues: any[] = []
  const motif = (p: any): void => {
    if (!p) return
    if (p.type === 'Identifier' && p.name === nom) vues.push(p)
    else if (p.type === 'ObjectPattern') for (const q of p.properties) motif(q.type === 'RestElement' ? q.argument : q.value)
    else if (p.type === 'ArrayPattern') for (const q of p.elements) motif(q)
    else if (p.type === 'RestElement') motif(p.argument)
    else if (p.type === 'AssignmentPattern') motif(p.left)
  }
  full(racine, (n: any) => {
    if (/Function/.test(n.type)) {
      motif(n.id)
      for (const p of n.params) motif(p)
    }
    else if (n.type === 'VariableDeclarator') motif(n.id)
    else if (n.type === 'CatchClause') motif(n.param)
    else if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') motif(n.id)
  })
  return vues.sort((a, b) => a.start - b.start)[0] ?? null
}

/** dans le corps de la classe compilée, chaque nom libre qui désigne un de ses membres statiques se lit sur la classe (`NOM` →
 *  `Nom.NOM`, raccourci `{ NOM }` → `{ NOM: Nom.NOM }`) : un paramètre ou une variable du même nom le cache, comme toute portée ;
 *  une clé, une propriété, une chaîne ou le texte d'un gabarit ne sont pas des noms. Une méthode détachée (`liste.map(µNom.m)`)
 *  garde ainsi sa classe, et le minifieur garde les noms publics (des propriétés). Refus, à la ligne du fichier (`ligneDe` : la
 *  ligne d'une position du code compilé) : `delete NOM` d'un membre, une liaison nommée comme la classe dans son corps (elle y
 *  cacherait la classe) ; des membres lus dans le fichier (`membres`, cf. classLayout) qui ne sont pas exactement les champs
 *  statiques de la classe compilée arrêtent la construction, jamais un membre perdu en silence */
export function classScope(js: string, nom: string, membres: string[], fichier: string, ligneDe: (offset: number) => number | null): string {
  let ast: any
  try {
    ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch (e: any) {
    // `delete NOM` : le mode strict des modules refuse de retirer un nom ; le membre se retire sur la classe
    const retire = /^Deleting local variable in strict mode/.test(e?.message ?? '') ? /^delete\s+([A-Za-z_$][\w$]*)/.exec(js.slice(e.pos)) : null
    if (retire && membres.includes(retire[1])) throw new Error(t('bundler.classe-delete', { fichier, ligne: ligneDe(e.pos) ?? '?', membre: retire[1], nom }))
    throw e
  }
  const classe    = ast.body.find((n: any) => n.type === 'ClassDeclaration' && n.id?.name === nom)
  const statiques = classe ? classe.body.body.filter((d: any) => d.static && !d.computed && d.key?.type === 'Identifier') : []
  const champs    = statiques.filter((d: any) => d.type === 'PropertyDefinition').map((d: any) => d.key.name)
  const perdus    = membres.filter(m => !champs.includes(m))
  const enTrop    = champs.filter((m: string) => !membres.includes(m))
  if (perdus.length || enTrop.length) throw new Error(t('bundler.classe-membres', { fichier, perdus: perdus.join(', ') || '—', enTrop: enTrop.join(', ') || '—' }))
  if (!classe || statiques.length === 0) return js
  const lie = bindingNamed(classe.body, nom)
  if (lie) throw new Error(t('bundler.classe-nom-lie', { fichier, ligne: ligneDe(lie.start) ?? '?', nom }))
  let sortie = js
  for (const { nom: membre, noeud, ancetres } of lecturesLibres(classe.body, new Set<string>(statiques.map((d: any) => d.key.name))).sort((a, b) => b.noeud.start - a.noeud.start)) {
    const parent    = ancetres[ancetres.length - 1]
    const grand     = ancetres[ancetres.length - 2]
    const raccourci = (parent?.type === 'Property' && parent.shorthand) || (parent?.type === 'AssignmentPattern' && parent.left === noeud && grand?.type === 'Property' && grand.shorthand)
    sortie          = sortie.slice(0, noeud.start) + (raccourci ? `${membre}: ` : '') + `${nom}.${membre}` + sortie.slice(noeud.end)
  }
  return sortie
}

/** la sortie pour Node d'une classe : son code compilé, `µ` pris sur `globalThis` (créé au besoin, partagé par les classes
 *  chargées), l'import d'une autre classe réécrit vers sa sortie voisine (`./Nom.js`) */
export function nodeClassSource(js: string, classes: Record<string, string>): string {
  const parChemin = new Map(Object.entries(classes).map(([nom, chemin]) => [chemin, nom]))
  const corps     = js.replace(/import\s*(["'])µasset\('([^']+)'\)\1;?/g, (tout: string, _q: string, chemin: string) => parChemin.has(chemin) ? `import './${parChemin.get(chemin)}.js'` : tout)
  return `const µ = globalThis.µ ??= {}\n${corps}`
}
