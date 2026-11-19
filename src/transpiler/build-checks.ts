// transpiler/build-checks — ce qu'un composant relève à sa compilation pour trois contrôles de construction (lint propUnknown,
// routeUnknown, i18nKeyUnknown) : les props et attributs qu'il lit, ceux qu'il vise chez d'autres éléments, les balises des composants
// du projet qu'il écrit, ses clés `µt('…')` écrites en dur, les liens `#/…` de ses éléments `<a>`, ses routes. Un fichier seul ne connaît pas
// les autres : le bundler croise ces relevés une fois le projet compilé (bundler/build-checks.ts). Les relevés sont larges (dans le doute, un
// nom de plus ne fait taire qu'un avertissement, une lecture que l'analyse ne nomme pas les fait tous taire) ; une ligne vient des positions
// du parseur ou du texte même de l'appel, sinon elle manque

import type * as acorn from 'acorn'
import { preprocess } from '../generator/compile.js'
import * as walk from 'acorn-walk'
import { tagReader } from './tag-reader.js'
import { MASK_STRINGS_AND_COMMENTS_RE } from './lint.js'
import type { LinkSeen, ProjectTagSeen } from '../parser/index.js'
import { replaceBlocks } from '../mask.js'

/** une clé `µt('…')` écrite en dur, telle que le compilateur la réécrit (préfixe de section posé, `/` de tête retiré) */
export interface I18nKeySeen {
  /** la clé effective (`panier.resume`) */
  key: string
  /** la même clé relative dans les autres sections du module (`@i18n 'a' 'b'` : `b.resume`) */
  alts?: string[]
  /** le texte entre les guillemets, tel qu'écrit dans le source */
  written: string
}

/** une balise d'un composant du projet que le gabarit écrit (cf. ProjectTagSeen), à sa ligne du fichier (`null` : pas retrouvée) */
export interface ProjectTagCheck {
  name: string
  kind: 'shortcut-dev' | 'literal-dev'
  names: string[]
  spread: boolean
  line: number | null
  models?: string[]
}

export interface BuildChecks {
  /** les noms que le composant lit ou déclare (`$nom`), et les attributs qu'il lit sur sa balise (`getAttribute('nom')`, `[nom]` d'un
   *  sélecteur, `attr(nom)` de son style, ceux que lit le navigateur s'il est associé au formulaire), partiels inclus compris ; `null` :
   *  il lit ses attributs d'une façon que l'analyse ne nomme pas, tout attribut peut lui servir (cf. attributeReads) */
  props: string[] | null
  /** les attributs qu'il vise chez d'autres éléments (`[nom]` et `attr(nom)` de ses feuilles, `getAttribute('nom')` et sélecteurs écrits
   *  dans une chaîne de son code) : comptés lus sur toute balise du projet */
  targets: string[]
  /** les balises des composants du projet que son gabarit écrit */
  tags: ProjectTagCheck[]
  /** clés `µt('…')` écrites en dur, une par clé, et la ligne de la première (`null` : pas retrouvée dans le source) */
  keys: { key: string, alts?: string[], written: string, line: number | null }[]
  /** liens `href="#/…"` des éléments `<a>` lus par le parseur, et leur ligne (`null` : pas retrouvée, venue d'un partiel inclus) */
  links: { href: string, line: number | null }[]
  /** les chemins des blocs `<routes>` et ceux que le script écrit en toutes lettres (cf. scriptRoutes) */
  routes: string[]
  /** les vues que le script donne à `@routes` en toutes lettres (cf. scriptRouteTargets) : la construction refuse une route dont la vue
   *  n'existe nulle part */
  scriptRouteTargets?: string[]
  /** les vues du gabarit, partiels inclus, `{if}` compris (cf. templateViews) ; absentes d'un relevé d'avant : le contrôle se suspend */
  views?: string[]
  /** les blocs `<routes target>` du composant, avec leur ligne */
  routeTargets?: Array<{ name: string, line: number }>
  /** la ligne du premier `@routes` de la source */
  scriptRoutesLine?: number
  /** le composant nomme `routes` autrement que par une table écrite en toutes lettres, ou laisse le composant à un code qui pourrait la
   *  remplir (cf. scriptRoutes, templateNamesRoutes) : la table du projet ne se connaît pas, tout lien peut y mener */
  routesScript: boolean
}

// les lectures d'attributs que l'analyse ne nomme pas : un nom calculé (`getAttribute(nom)`, un espace de noms), la liste des attributs
// (`attributes` sous toute forme, `getAttributeNames`, les rappels d'un élément personnalisé), un module chargé par une adresse calculée
// (`import(url)`) ou écrite (`@import x 'https://…'`) ; dans un composant seulement, l'état lu par un nom calculé (`$[nom]`) ou passé en
// entier (`Object.keys($)`, `{...$}`, `f($)` — un `$` entre deux séparateurs, jamais l'ancre d'une expression régulière, `…)$/`)
const FREE_RE       = /\b(?:get|has)Attribute\w*\b(?!\s*(?:\?\.?)?\s*\(?\s*['"])|AttributeNS\b|attributes\b|\battributeChangedCallback\b|(?<![\w$.µ])import\s*\(|(?:@import|µimport|mjsimport)\b[^\n]*?['"]https?:/i
const FREE_STATE_RE = /(?<![\w$\\])\$\s*\[|(?<=^|[\s(,=[{:.])\$(?=$|[\s),;\]}])/m
const PROP_RE       = /(?<![\w$])\$([A-Za-z_]\w*)/g
const ATTR_CALL_RE  = /\b(?:get|has|toggle|remove)Attribute\w*\s*(?:\?\.?)?\s*\(?\s*(['"])([^'"\n]+)\1/g
const SELECTOR_RE   = /\[\s*([A-Za-z_][\w-]*)\s*(?:[~|^$*]?=|\])/g
const CSS_ATTR_RE   = /\battr\(\s*([A-Za-z_][\w-]*)/g
const STRING_RE     = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
// un élément associé au formulaire : le navigateur lit `form`, `name`, `disabled` et `readonly`, le socle du formulaire `required`
const FORM_RE       = /\bformAssociated\b|\battachInternals\b|\bElementInternals\b|\binternals\b/
const FORM_ATTRS    = ['form', 'name', 'disabled', 'readonly', 'required']

/** ce qu'un texte (script, gabarit, style d'un composant, ou module importé) lit des attributs : `libre` quand une lecture ne se nomme pas
 *  (cf. FREE_RE, et FREE_STATE_RE pour un `composant` : un module n'a pas son état), les noms lus (props `$nom`, attributs lus par leur nom,
 *  sélecteurs, `attr()`, ceux d'un champ de formulaire), et ceux qu'il vise chez d'autres éléments (attributs lus par leur nom, sélecteurs
 *  écrits dans une chaîne) */
export function attributeReads(text: string, component = false): { free: boolean, names: string[], targets: string[] } {
  const names   = new Set<string>()
  const targets = new Set<string>()
  for (const m of text.matchAll(PROP_RE)) names.add(m[1])
  for (const m of text.matchAll(ATTR_CALL_RE)) {
    names.add(m[2])
    targets.add(m[2])
  }
  for (const m of text.matchAll(SELECTOR_RE)) names.add(m[1])
  for (const m of text.matchAll(CSS_ATTR_RE)) names.add(m[1])
  for (const s of text.matchAll(STRING_RE)) for (const m of s[2].matchAll(SELECTOR_RE)) targets.add(m[1])
  if (FORM_RE.test(text)) for (const n of FORM_ATTRS) names.add(n)
  return { free: FREE_RE.test(text) || (component && FREE_STATE_RE.test(text)), names: [...names], targets: [...targets] }
}

/** les attributs qu'une feuille de style vise : sélecteurs `[nom]`, `[nom=…]`, et `attr(nom)` */
export function styleTargets(css: string): string[] {
  return [...css.matchAll(SELECTOR_RE), ...css.matchAll(CSS_ATTR_RE)].map((m) => m[1])
}

/** la ligne du fichier de chaque balise du projet : celle que le parseur a lue quand le HTML compilé est celui du composant ; sinon (partiel
 *  inclus, bloc retiré, texte récrit avant la compilation) retrouvée par son texte dans le HTML du composant, au même rang. Un texte qui n'y
 *  paraît pas autant de fois que dans le texte lu (écrit aussi par un partiel, ou récrit) ne se départage pas : `null`, jamais une ligne inventée */
export function projectTagLines(tags: ProjectTagSeen[], sameHtml: boolean, hostHtml: string, firstLine: number): ProjectTagCheck[] {
  const lines = fileLines(tags, sameHtml, hostHtml, firstLine)
  return tags.map((g, i) => ({ name: g.name, kind: g.kind, names: g.names, spread: g.spread, line: lines[i], ...(g.models ? { models: g.models } : {}) }))
}

// la ligne du fichier de ce que le parseur a relevé (balise du projet, lien) : la sienne quand le HTML compilé est celui du composant ;
// sinon celle de son texte dans le HTML du composant, au même rang, quand ce texte y paraît autant de fois que dans le texte lu ; `null`
// sinon, jamais une ligne inventée
function fileLines(seen: { line: number, text: string, rank: number, total: number }[], sameHtml: boolean, hostHtml: string, firstLine: number): (number | null)[] {
  const positions = new Map<string, number[]>()
  return seen.map((g) => {
    if (sameHtml) return g.line
    let p = positions.get(g.text)
    if (!p) {
      p = []
      for (let i = hostHtml.indexOf(g.text); i !== -1; i = hostHtml.indexOf(g.text, i + 1)) p.push(i)
      positions.set(g.text, p)
    }
    return p.length === g.total && g.rank >= 0 ? firstLine + (hostHtml.slice(0, p[g.rank]).match(/\n/g)?.length ?? 0) : null
  })
}

const blank = (m: string): string => m.replace(/[^\n]/g, ' ')

// un appel de la traduction tel que l'auteur l'écrit, jusqu'à sa clé : `µt('…'`, `µt '…'`, `µ.t('…'` et les formes optionnelles `µt?.('…'`,
// `µt?('…'`, `µ.t?.('…'`, `µ?.t('…'`, `µ?.t?.('…'` ; un `µ` précédé d'un caractère de nom est l'objet d'une appli
const CALL_IN_SOURCE = '(?<![\\p{ID_Continue}$])µ(?:\\??\\.)?t(?:\\?\\.?)?\\s*\\(?\\s*'
const BEFORE_KEY     = new RegExp(`${CALL_IN_SOURCE}$`, 'u')

// le code d'un texte où chercher un appel `µt('…')` : commentaires et chaînes blanchis à longueur égale (`\n` gardés), sauf la chaîne qui
// suit un `µt` (la clé) — un `µt('…')` cité dans un commentaire ou dans une chaîne n'est pas un appel
function callsCode(code: string): string {
  return code.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string, offset: number) => /^['"]/.test(m) && BEFORE_KEY.test(code.slice(Math.max(0, offset - 16), offset)) ? m : blank(m))
}

// le code d'un gabarit, à longueur égale : ses accolades seules, lues par callsCode ; ses commentaires, ses textes et ses attributs écrits
// en dur blanchis
function templateCode(html: string): string {
  const text   = replaceBlocks(html, ['<!--'], blank)
  const reader = tagReader(text)
  let out      = ''
  let pos      = 0
  for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', pos)) {
    const end = reader.braceEnd(i + 1)
    if (end === -1) break
    out += blank(text.slice(pos, i + 1)) + callsCode(text.slice(i + 1, end))
    pos  = end
  }
  return out + blank(text.slice(pos))
}

// la ligne (du fichier) du premier appel `µt('<written>'` dans un code lu par callsCode qui commence à la ligne `debut`, `null` sans appel
function firstCall(code: string, start: number, written: string): number | null {
  const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m       = new RegExp(`${CALL_IN_SOURCE}(['"])${escaped}\\1`, 'u').exec(code)
  return m ? start + (code.slice(0, m.index).match(/\n/g)?.length ?? 0) : null
}

// la clé écrite en toutes lettres d'une propriété ou d'un accès (`a`, `'a'`, `['a']`, `[`a`]` sans interpolation), `null` si elle se calcule
function literalKey(node: any, computed: boolean): string | null {
  if (!computed && node?.type === 'Identifier') return node.name
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? null
  return null
}

// les chemins d'une table écrite en toutes lettres (`{ '/a': 'x', … }`), `null` si un chemin se calcule ou s'étale
function pathsOf(table: any): string[] | null {
  if (table?.type !== 'ObjectExpression') return null
  const out = [] as string[]
  for (const p of table.properties) {
    const key = p.type === 'Property' ? literalKey(p.key, p.computed) : null
    if (key === null) return null
    out.push(key)
  }
  return out
}

// `routes` nommé dans un texte (identifiant, propriété, clé, chaîne)
const ROUTES_RE = /\broutes\b/

// les chaînes et commentaires d'un module JavaScript ou TypeScript, où `#` ne commente pas (champ privé)
const JS_STRINGS_COMMENTS_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g

/** un module nomme-t-il `routes` hors de ses commentaires ? Une chaîne compte (elle peut nommer la table) ; `js` : un module JavaScript ou
 *  TypeScript, où `#` ne commente pas */
export function nameRoutes(code: string, js = false): boolean {
  return ROUTES_RE.test(code.replace(js ? JS_STRINGS_COMMENTS_RE : MASK_STRINGS_AND_COMMENTS_RE, (x: string) => /^['"`]/.test(x) ? x : ' '))
}

// une valeur qui est, ou peut être, le composant : `this`, un nom qui lui a été donné (`self = this`, le `_mjsThis` du sucre `@@`),
// `this ?? _mjsThis`, `a || this`, `c ? this : x`, `(x, this)`, `y = this`
function isComponent(n: any, alias: ReadonlySet<string>): boolean {
  switch (n?.type) {
    case 'ThisExpression':        return true
    case 'Identifier':            return alias.has(n.name)
    case 'LogicalExpression':     return (n.operator !== '&&' && isComponent(n.left, alias)) || isComponent(n.right, alias)
    case 'ConditionalExpression': return isComponent(n.consequent, alias) || isComponent(n.alternate, alias)
    case 'SequenceExpression':    return isComponent(n.expressions.at(-1), alias)
    case 'AssignmentExpression':  return isComponent(n.right, alias)
  }
  return false
}

// `n` passe sa valeur à `p` (un opérande retenu, une branche, la dernière d'une suite) : c'est `p` qu'on regarde
function carries(p: any, n: any): boolean {
  return (p.type === 'LogicalExpression' && (p.right === n || (p.operator !== '&&' && p.left === n))) || (p.type === 'ConditionalExpression' && p.test !== n) || (p.type === 'SequenceExpression' && p.expressions.at(-1) === n)
}

// un identifiant qui nomme (déclaration, clé, propriété lue par son nom, paramètre, étiquette), pas une valeur
function isName(n: any, p: any): boolean {
  if (!p) return true
  if ((p.type === 'MemberExpression' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && (p.property ?? p.key) === n && !p.computed) return true
  if (p.type === 'Property' && p.key === n && p.value !== n && !p.computed) return true
  if ((p.type === 'VariableDeclarator' && p.id === n) || (p.type === 'AssignmentExpression' && p.left === n)) return true
  if (/Function/.test(p.type) && (p.id === n || p.params.includes(n))) return true
  return /^(?:LabeledStatement|BreakStatement|ContinueStatement|CatchClause)$/.test(p.type) || /^(?:Import|Export)/.test(p.type)
}

// une cible qui reçoit le composant sans en tirer sa table : un nom, des propriétés nommées en toutes lettres (sans `...reste`)
function safePattern(m: any): boolean {
  return m?.type === 'Identifier' || (m?.type === 'ObjectPattern' && m.properties.every((q: any) => q.type === 'Property' && literalKey(q.key, q.computed) !== null))
}

// la racine d'un accès (`µ.a.b`, `µ?.a` → `µ`)
function root(n: any): any {
  while (n?.type === 'MemberExpression' || n?.type === 'ChainExpression') n = n.type === 'MemberExpression' ? n.object : n.expression
  return n
}

// ce qu'un script peut faire du composant sans pouvoir toucher à sa table : y lire ou y écrire une propriété nommée en toutes lettres, le
// donner à un autre nom (lu de la même façon), en tirer des propriétés nommées, le comparer, le tester, le donner au cœur de MJS (`µ._set(@,
// …)`, écrit par le compilateur pour `$x = …` : le cœur lit la table, jamais ne l'écrit)
function safeContext(n: any, p: any): boolean {
  switch (p?.type) {
    case 'MemberExpression':     return p.object === n && (!p.computed || literalKey(p.property, true) !== null)
    case 'CallExpression':       return p.callee !== n && root(p.callee)?.type === 'Identifier' && root(p.callee).name === 'µ'
    case 'VariableDeclarator':   return p.init === n && safePattern(p.id)
    case 'AssignmentExpression': return p.right === n && p.operator === '=' && safePattern(p.left)
    case 'BinaryExpression':
    case 'TemplateLiteral':
    case 'ExpressionStatement':  return true
    case 'UnaryExpression':      return p.operator !== 'delete'
    case 'LogicalExpression':    return p.operator === '&&' && p.left === n
    case 'IfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ConditionalExpression': return p.test === n
    case 'SwitchStatement':      return p.discriminant === n
  }
  return false
}

/** les vues d'un gabarit tel que le compilateur le lit — partiels inclus, `{if}` et `{else}` compris : les `<@view nom>` que preprocess
 *  change en `<metamjs-view id="nom">`, hors commentaires HTML lus comme le navigateur (`<!-->` est vide) ; le script n'en fait pas partie,
 *  ni une chaîne qu'il écrit */
export function templateViews(html: string): string[] {
  return [...new Set([...replaceBlocks(preprocess(html), ['<!--'], () => '').matchAll(/<metamjs-view id="([\w-]+)"/g)].map(m => m[1]))]
}

/** les vues (cibles) que le script donne à `@routes` en toutes lettres : les clés d'un `@routes = …` littéral, la vue de
 *  `@routes['vue'] = …` et de `@routes['vue'][chemin] = …`, même quand le chemin ou le composant se calculent ; une vue au nom
 *  calculé (`@routes[nom]`) ne se lit pas, ni une table entière calculée (`@routes = f()`). Sans arbre : aucune */
export function scriptRouteTargets(ast: acorn.Node | null): string[] {
  const targets = new Set<string>()
  if (!ast) return []
  const isRoutes = (n: any) => n?.type === 'MemberExpression' && (n.object?.type === 'ThisExpression' || (n.object?.type === 'Identifier' && n.object.name === '_mjsThis')) && literalKey(n.property, n.computed) === 'routes'
  // un nom de vue (`<@view nom>` : lettres, chiffres, `_`, `-`) ; une table à un seul niveau (`@routes = '/': 'x'`) n'en nomme aucune
  const adds    = (k: string | null) => { if (k !== null && /^[\w-]+$/.test(k)) targets.add(k) }
  walk.full(ast, (a: any) => {
    if (a.type !== 'AssignmentExpression' || a.operator !== '=') return
    const g = a.left
    if (isRoutes(g) && a.right?.type === 'ObjectExpression') {
      for (const v of a.right.properties) if (v.type === 'Property' && v.value?.type === 'ObjectExpression') adds(literalKey(v.key, v.computed))
    }
    else if (g?.type === 'MemberExpression' && isRoutes(g.object)) adds(literalKey(g.property, g.computed))
    else if (g?.type === 'MemberExpression' && g.object?.type === 'MemberExpression' && isRoutes(g.object.object)) adds(literalKey(g.object.property, g.object.computed))
  })
  return [...targets]
}

/** les chemins que le script donne à `@routes` en toutes lettres — `@routes = 'vue': '/a': 'x'`, `@routes['vue'] = '/a': 'x'`,
 *  `@routes['vue']['/a'] = 'x'`, sur `this` lui-même ; `null` dès que le script nomme `routes` autrement (lue, passée, étalée, tirée de
 *  `@` par déstructuration, par un autre nom de `@` comme `@@routes` ou `self.routes`, citée dans une chaîne, une clé ou une variable), ou
 *  laisse le composant à un code qui pourrait la remplir sans la nommer (`@` passé à une fonction, rangé dans une table ou une propriété,
 *  `Object.assign @, …`, `@[nom]`, `eval`) : la table se calcule et peut prendre tout lien ; `[]` sans `@routes`. Sans arbre (script
 *  qu'acorn ne lit pas), toute mention de `routes`, et tout `this` qui ne lit pas une propriété nommée, comptent pour une table calculée */
export function scriptRoutes(js: string, ast: acorn.Node | null): string[] | null {
  if (!ast) return ROUTES_RE.test(js) || /\b(?:eval|Function)\b|\b(?:this|_mjsThis)\b(?!\s*\??\.\s*[A-Za-z_$])/.test(js) ? null : []
  // les noms donnés au composant, de proche en proche
  const alias = new Set<string>(['_mjsThis'])
  for (let size = -1; size !== alias.size;) {
    size = alias.size
    walk.full(ast, (n: any) => {
      if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && isComponent(n.init, alias)) alias.add(n.id.name)
      else if (n.type === 'AssignmentExpression' && n.left?.type === 'Identifier' && isComponent(n.right, alias)) alias.add(n.left.name)
    })
  }
  // les tables écrites en toutes lettres sur `this` : leurs chemins, et les nœuds qui y nomment `routes`, une vue ou un chemin
  const isRoutes   = (n: any) => n?.type === 'MemberExpression' && n.object?.type === 'ThisExpression' && literalKey(n.property, n.computed) === 'routes'
  const recognized = new Set<any>()
  const mark       = (key: any) => {
    recognized.add(key)
    if (key?.type === 'TemplateLiteral') for (const q of key.quasis) recognized.add(q)
  }
  const paths = [] as string[]
  const table = (object: any): boolean => {
    const c = pathsOf(object)
    if (c === null) return false
    for (const p of object.properties) mark(p.key)
    paths.push(...c)
    return true
  }
  walk.full(ast, (a: any) => {
    if (a.type !== 'AssignmentExpression' || a.operator !== '=') return
    const g = a.left
    if (isRoutes(g) && a.right?.type === 'ObjectExpression' && a.right.properties.every((v: any) => v.type === 'Property' && literalKey(v.key, v.computed) !== null && pathsOf(v.value) !== null)) {
      mark(g.property)
      for (const v of a.right.properties) {
        mark(v.key)
        table(v.value)
      }
    }
    else if (g?.type === 'MemberExpression' && isRoutes(g.object) && literalKey(g.property, g.computed) !== null) {
      if (table(a.right)) {
        mark(g.object.property)
        mark(g.property)
      }
    }
    else if (g?.type === 'MemberExpression' && g.object?.type === 'MemberExpression' && isRoutes(g.object.object) && literalKey(g.object.property, g.object.computed) !== null && literalKey(g.property, g.computed) !== null) {
      mark(g.object.object.property)
      mark(g.object.property)
      mark(g.property)
      paths.push(literalKey(g.property, g.computed)!)
    }
  })
  // tout le reste : `routes` nommé, ou le composant laissé hors d'une propriété nommée en toutes lettres
  let computed = false
  walk.fullAncestor(ast, (n: any, _walkState: unknown, ancestors: any[]) => {
    if (computed || recognized.has(n)) return
    const p = ancestors.at(-2)
    // le marcheur ne passe ni par le nom d'une propriété lue par son nom (`x.routes`) ni par une clé écrite (`{ routes: … }`) : lus ici
    if (n.type === 'MemberExpression' && !n.computed && n.property?.name === 'routes' && !recognized.has(n.property)) computed = true
    else if (/^(?:Property|MethodDefinition|PropertyDefinition)$/.test(n.type) && !n.computed && ROUTES_RE.test(literalKey(n.key, false) ?? '') && !recognized.has(n.key)) computed = true
    else if (n.type === 'Identifier' && (n.name === 'routes' || n.name === 'eval' || n.name === 'Function')) computed = true
    else if (n.type === 'Literal' && typeof n.value === 'string' && ROUTES_RE.test(n.value)) computed = true
    else if (n.type === 'TemplateElement' && ROUTES_RE.test(n.value?.raw ?? '')) computed = true
    else if (isComponent(n, alias) && !(n.type === 'Identifier' && isName(n, p)) && !(p && carries(p, n)) && !safeContext(n, p)) computed = true
  })
  return computed ? null : paths
}

// le code d'un gabarit qui laisse le composant hors d'une propriété nommée en toutes lettres : `{@}`, `{f(this)}`, `{@[nom]}`, `{@@}`,
// `{_mjsThis}`, `eval`
const FREE_COMPONENT_RE = /(?<![\w$.@])@(?![\w$@])|@@(?![\w$])|(?<![\w$.])(?:this|_mjsThis)\b(?!\s*\??\.\s*[A-Za-z_$])|\b(?:eval|Function)\b/

// FREE_COMPONENT_RE cherché dans toute la suite du gabarit, à partir d'une position (lastIndex)
const FREE_COMPONENT_REST_RE = new RegExp(FREE_COMPONENT_RE.source, 'g')

/** le gabarit (partiels compris, hors commentaires) nomme-t-il `routes` — dans un texte, un attribut ou son code —, ou son code (ses
 *  accolades, lues par braceCode sans le texte de leurs chaînes ni leurs commentaires : `{'@'}` écrit un texte, les `${…}` d'un gabarit
 *  littéral et les `#{…}` d'une chaîne entre guillemets doubles restent du code, une expression régulière n'ouvre ni chaîne ni commentaire)
 *  laisse-t-il le composant hors d'une propriété nommée en toutes lettres ? Alors la table du projet ne se connaît pas. Dans le doute (une
 *  forme que le compilateur peut lire autrement que braceEnd, cf. braceCode), toute la suite du gabarit est lue comme du code, chaînes et
 *  commentaires compris — la fin de l'accolade elle-même n'est pas sûre —, d'une seule lecture : sa réponse vaut aussi pour les accolades
 *  suivantes, dont le code blanchi n'a pas d'arobase que la suite n'ait */
export function templateNamesRoutes(html: string): boolean {
  const text = replaceBlocks(html, ['<!--'], blank)
  if (ROUTES_RE.test(text)) return true
  const reader = tagReader(text)
  for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
    const { end, code } = reader.braceCode(i + 1)
    if (code === null) {
      FREE_COMPONENT_REST_RE.lastIndex = i + 1
      return FREE_COMPONENT_REST_RE.test(text)
    }
    if (FREE_COMPONENT_RE.test(code)) return true
    i = end
  }
  return false
}

/** le relevé d'un composant (cf. BuildChecks) */
export function collectBuildChecks(input: {
  /** le fichier tel qu'écrit */
  source: string
  /** ce que ses partiels inclus y ajoutent : leurs scripts et leurs modules (leur gabarit est dans `html`) */
  texts: string[]
  html: string
  hostHtml: string
  htmlStartLine: number
  /** son `<script>` tel qu'écrit (sans les partiels), et la ligne du fichier où il commence */
  script: { code: string, line: number }
  /** le code de ses modules (`<script module>`, partiels compris) */
  moduleCode: string
  styles: string[]
  stateVars: readonly string[]
  tags: ProjectTagSeen[]
  links: LinkSeen[]
  keys: I18nKeySeen[]
  routes: string[]
  /** les chemins de scriptRoutes, `null` : la table se calcule */
  scriptRoutes: string[] | null
  /** les vues que le script donne à `@routes` en toutes lettres (cf. scriptRouteTargets) */
  scriptRouteTargets?: string[]
  /** les vues du gabarit (cf. templateViews) */
  views?: string[]
  /** les blocs `<routes target>`, avec leur ligne */
  routeTargets?: Array<{ name: string, line: number }>
}): BuildChecks {
  const source   = input.source
  const read     = attributeReads([source, input.html, ...input.texts, ...input.styles].join('\n'), true)
  const props    = read.free ? null : [...new Set([...input.stateVars, ...read.names])].sort()
  const targets  = [...new Set([...read.targets, ...input.styles.flatMap(styleTargets)])].sort()
  const sameHtml = input.html === input.hostHtml
  const tags     = projectTagLines(input.tags, sameHtml, input.hostHtml, input.htmlStartLine)

  // une clé à la ligne de son premier appel dans le composant lui-même (son script, le code de son gabarit) ; venue d'un partiel, sans ligne
  const keys = [] as BuildChecks['keys']
  if (input.keys.length > 0) {
    const seen     = new Set<string>()
    const script   = callsCode(input.script.code)
    const template = templateCode(input.hostHtml)
    for (const k of input.keys) {
      const key = k.key + '\u0000' + (k.alts ?? []).join('\u0000')
      if (seen.has(key)) continue
      seen.add(key)
      const lines = [firstCall(script, input.script.line, k.written), firstCall(template, input.htmlStartLine, k.written)].filter((l): l is number => l !== null)
      keys.push({ key: k.key, ...(k.alts && k.alts.length > 0 ? { alts: k.alts } : {}), written: k.written, line: lines.length > 0 ? Math.min(...lines) : null })
    }
  }
  // les liens des éléments `<a>` lus par le parseur, à leur ligne du fichier quand elle se retrouve
  const lines        = fileLines(input.links, sameHtml, input.hostHtml, input.htmlStartLine)
  const links        = input.links.map((l, i) => ({ href: l.href, line: lines[i] }))
  const routesScript = input.scriptRoutes === null || templateNamesRoutes(input.html) || ROUTES_RE.test(input.moduleCode)
  return { props, targets, tags, keys, links, routes: [...input.routes, ...(input.scriptRoutes ?? [])], routesScript, scriptRouteTargets: input.scriptRouteTargets ?? [], views: input.views, routeTargets: input.routeTargets ?? [], scriptRoutesLine: input.source.slice(0, Math.max(0, input.source.search(/@routes\b/))).split('\n').length }
}
