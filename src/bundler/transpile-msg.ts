// bundler/transpile-msg — le message de transpilation et son EXÉCUTION, en un seul endroit.
//
// Le même travail se fait sur deux chemins : dans un worker_threads (worker.ts, gros projets)
// ou directement dans le processus principal (petits projets — démarrer un pool coûte plus
// cher que le travail lui-même). La projection du TranspileData et l'empreinte `restHash`
// sont subtiles (le rechargement CSS à chaud en dépend) : une seule définition ici, les deux
// chemins l'appellent.

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { transpile } from '../transpiler/index.js'
import type { FontSizeSettings } from '../transpiler/font-size.js'
import { printedTypedLines, type LintToggles } from '../diagnostics.js'
import type { RuleAst } from '../transpiler/var-types.js'
import type { ProjectEffect } from '../effects/catalog.js'
import { collectEffectDefs } from './effects-files.js'
import { t } from '../messages/index.js'
import { Scanner, extractBalanced } from '../parser/index.js'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

// Les alias que ModularJS livre (près de deux cents, ~23 ko) partaient clonés avec CHAQUE fichier envoyé à un thread. Ils sont
// les mêmes partout : chaque thread les résout une fois lui-même, et le message ne porte que l'ordre des noms et les effets
// qui en diffèrent — ceux de l'appli, un alias livré qu'elle remplace, un alias mis en table, une image résolue.

/** les effets de l'appli tels qu'un message les porte */
export interface EffectDefsWire {
  /** tous les noms, dans l'ordre de l'objet d'origine */
  order: string[]
  /** les effets qui diffèrent des alias livrés */
  diff: Record<string, ProjectEffect>
}

// Comparés par leur valeur (et l'ordre de leurs clés, que garde JSON), jamais par les octets de `v8.serialize` : leur forme suit
// la représentation interne de V8 — un même tableau s'écrit dense ou clairsemé selon la façon dont il a été créé et l'histoire du
// processus. Un processus qui avait déjà beaucoup compilé (session `mjs dev`, plusieurs projets construits de suite) voyait des
// alias livrés identiques partir en entier avec chaque fichier.
let shipped: { defs: Record<string, ProjectEffect>, json: Map<string, string> } | null = null
function shippedAliases(): { defs: Record<string, ProjectEffect>, json: Map<string, string> } {
  if (shipped === null) {
    const defs = collectEffectDefs([], () => '')
    shipped = { defs, json: new Map(Object.entries(defs).map(([n, d]) => [n, JSON.stringify(d)])) }
  }
  return shipped
}

// une entrée déjà comparée, sous son nom : le bundler n'en modifie jamais une sur place, il en pose une neuve
const compared = new WeakMap<ProjectEffect, { name: string, same: boolean }>()

/** `defs` pour un message : l'ordre de ses noms, et ce qui diffère des alias livrés */
export function effectDefsToWire(defs: Record<string, ProjectEffect>): EffectDefsWire {
  const order = Object.keys(defs)
  const diff: Record<string, ProjectEffect> = {}
  for (const name of order) {
    const d = defs[name]
    let seen = compared.get(d)
    if (seen === undefined || seen.name !== name) {
      const ref = shippedAliases().json.get(name)
      seen = { name, same: ref !== undefined && ref === JSON.stringify(d) && isDeepStrictEqual(shippedAliases().defs[name], d) }
      compared.set(d, seen)
    }
    if (!seen.same) diff[name] = d
  }
  return { order, diff }
}

/** l'inverse, à la réception : chaque nom, pris dans `diff` ou dans les alias livrés, dans l'ordre d'origine */
export function effectDefsFromWire(wire: EffectDefsWire): Record<string, ProjectEffect> {
  const defs = shippedAliases().defs
  const out: Record<string, ProjectEffect> = {}
  for (const name of wire.order) out[name] = Object.hasOwn(wire.diff, name) ? wire.diff[name] : defs[name]
  return out
}

export interface TranspileMsg {
  type: 'transpile'
  id: number
  content: string
  moduleName: string
  /** déduit par le master du VRAI nom de fichier (isPageFile, bundler/index.ts) :
   *  seul passe-plat, cf. TranspileOpts.isPageModule côté transpile(). */
  isPageModule?: boolean
  /** le nom du fichier tel qu'écrit, cité par les positions des fautes (cf. TranspileOpts.sourceFileName) */
  sourceFileName?: string
  defaultScriptLang?: 'civet' | 'coffee' | 'ts' | 'js'
  templateLang?: 'civet'
  sigil?: 'µ' | 'mjs'
  contextAlias?: boolean
  varPrefix?: string
  maxStateVars?: number
  /** Lint d'accessibilité (`lint.a11y`) — SANS cette transmission, `false` explicite
   *  resterait mort sur le chemin le plus courant : `mjs build` d'un projet
   *  multi-fichiers passe par ce pool de workers */
  a11y?: boolean
  /** Lint « <form> sans action ni méthode » (`lint.ujsForm`) — même remarque qu'`a11y`
   *  ci-dessus : sans cette transmission, `false` explicite resterait mort sur le chemin
   *  le plus courant (le pool de workers, `mjs build` d'un projet multi-fichiers). */
  ujsForm?: boolean
  /** Coupe individuellement les AUTRES types d'avertissement (`lint.<type>`, hors a11y/
   *  maxStateVars/ujsForm ci-dessus) — cf. src/diagnostics.ts. Même remarque de transmission
   *  que ujsForm ci-dessus : sans elle, `false` explicite resterait mort côté worker. */
  lint?: LintToggles
  /** Le terminal accepte-t-il la couleur (résolu par le master, jamais par le worker — cf.
   *  resolveColorsEnabled, src/diagnostics.ts) : SANS cette transmission, les avertissements
   *  a11y/ujsForm/maxStateVars imprimés depuis le worker resteraient toujours sans couleur. */
  colorsEnabled?: boolean
  /** Langue des messages du projet (clé `lang` de mjs.config.json, résolue par le master). Chaque thread de travail
   *  charge son propre exemplaire du catalogue des messages, resté en français : SANS cette transmission, les erreurs
   *  et avertissements d'un projet en anglais sortiraient en français dès que la transpilation passe par le pool
   *  (worker.ts l'applique avant chaque tâche, la langue pouvant changer d'une compilation à l'autre). */
  lang?: 'fr' | 'en'
  baseDir?: string
  sourceDir?: string
  aliasTag?: string
  dirInject?: string
  /**
   * Dict `{ logicalPath → webPath }` des `µasset('...')` pré-résolus par le
   * master avant l'envoi au worker. Le worker n'a pas accès au disque pour
   * résoudre les assets — il lit dans ce dict.
   */
  preResolvedAssets: Record<string, string>
  /** jumeau du dict ci-dessus pour `µimage('x'[, largeurs])` : le TEXTE EXACT
   *  de l'appel → l'objet JSON résolu côté master (il faut le disque pour lire les
   *  dimensions natives et produire les variantes). */
  preResolvedImages?: Record<string, string>
  /** règles nommées des fichiers `*.types.mjs` (cf. TranspileOpts.typeDefs) — lues par le master,
   *  le worker n'a pas le disque */
  typeDefs?: Record<string, RuleAst>
  /** classes globales de l'appli (cf. TranspileOpts.classes) — nom → chemin depuis sourceDir */
  classes?: Record<string, string>
  /** effets des fichiers `*.effects.mjs` (cf. TranspileOpts.effectDefs) */
  effectDefs?: Record<string, ProjectEffect>
  /** les mêmes, sans les alias que ModularJS livre tels quels (cf. effectDefsToWire) : ce que le bundler envoie */
  effectDefsWire?: EffectDefsWire
  /** texte des règles dans le code émis (cf. TranspileOpts.typesText) : `false` en production */
  typesText?: boolean | 'names'
  /** avertissements du développement dans le code émis (cf. TranspileOpts.devWarnings) : `false` en production */
  devWarnings?: boolean
  /** empreintes `restHash` et `hotHash` à rendre (cf. watchHashesOf) : seul le mode veille du bundler les compare d'un tour à l'autre */
  watchHashes?: boolean
  /** construction qui peut rendre côté serveur (cf. TranspileOpts.serverRendered) */
  serverRendered?: boolean
  /** les chargements qui montrent un squelette d'eux-mêmes (cf. TranspileOpts.skeleton) */
  skeleton?: string[]
  /** *guard d'office sur un champ lié typé (cf. TranspileOpts.guard) */
  guard?: boolean | { delay?: number | string }
  /** les stores typés du projet (cf. TranspileOpts.typedStores) */
  typedStores?: string[]
  /** les modèles en fichier des composants (cf. TranspileOpts.models) */
  models?: { dev?: Record<string, string[]>, core?: Record<string, string[]> }
  /** classement des valeurs dérivées (cf. TranspileOpts.derived) */
  derived?: boolean
  /** valeurs calculées précises, option d'appli `derived: "precise"` (cf. TranspileOpts.derivedPrecise) */
  derivedPrecise?: boolean
  /** tous les reffets passent quand un état partagé redessine le composant (cf. TranspileOpts.reffetsAll) */
  reffetsAll?: boolean
  /** pages d'une table de routes, option d'appli `routes.preload` (cf. TranspileOpts.routesPreload) */
  routesPreload?: 'on' | 'idle' | 'off'
  /** objets de l'état, option d'appli `proxy` (cf. TranspileOpts.proxy) */
  proxy?: boolean
  /** taille du texte adaptée à l'écran, option d'appli `responsiveFontSize` (cf. TranspileOpts.responsiveFontSize) */
  responsiveFontSize?: FontSizeSettings
}

/** Résultat renvoyé au master : sortie compilée + projection minimale du TranspileData. */
export interface TranspileMsgResult {
  output: string
  sourceMap?: string
  data: Record<string, any>
}

// les balises du fichier : [début du `<`, fin du `>`] ; un `<` dans une valeur d'attribut (guillemets, accolades) n'en ouvre aucune ;
// le bundler y cherche aussi les directives de transition (transitionSites), avec `expressions` : un `<` dans une expression `{…}` du texte (`{a<b}`) n'en ouvre pas
// non plus, le compilateur (parser/index.ts) lisant chaque `{` du texte jusqu'à son `}` ; une accolade jamais refermée reste du texte
// avec `expressions` aussi, un antislash échappe le caractère qui le suit dans un texte entre guillemets (`label: 'l\'été'`), comme dans l'expression d'une directive
export function tagSpans(content: string, expressions = false): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const scanner = expressions ? new Scanner(content) : null
  let i = 0
  while (i < content.length) {
    if (scanner && content[i] === '{') {
      scanner.pos = i + 1
      try { extractBalanced(scanner, '}'); i = scanner.pos } catch { i++ }
      continue
    }
    if (content[i] !== '<' || !/[A-Za-z@]/.test(content[i + 1] ?? '')) { i++; continue }
    let j      = i + 1
    let quote  = ''
    let braces = 0
    for (; j < content.length; j++) {
      const c = content[j]
      if (quote) { if (expressions && c === '\\') j++; else if (c === quote) quote = ''; continue }
      if (c === '"' || c === '\'') quote = c
      else if (c === '{') braces++
      else if (c === '}' && braces > 0) braces--
      else if (c === '>' && braces === 0) break
    }
    spans.push([i, j])
    i = j + 1
  }
  return spans
}

// les lignes du fichier où s'ouvre une balise qui écrit `*nom` (balise sur plusieurs lignes : celle de son `<`)
function tagLines(content: string, name: string): number[] {
  const written = new RegExp(`(^|[^\\w$-])\\*${name.replace(/\./g, '\\.')}(?![\\w-]|\\.[a-z])`, 'g')
  const found   = new Set<number>()
  const spans   = tagSpans(content)
  for (const m of content.matchAll(written)) {
    const at    = (m.index ?? 0) + m[1].length
    const tag   = spans.find(([start, end]) => at > start && at <= end)
    let start   = tag ? tag[0] : content.lastIndexOf('<', at)
    if (!tag) while (start > 0 && !/[A-Za-z@]/.test(content[start + 1] ?? '')) start = content.lastIndexOf('<', start - 1)
    found.add(content.slice(0, start >= 0 ? start : at).split('\n').length)
  }
  return [...found]
}

/** une faute d'effet (`[ModularJS] *titre : effet inconnu`) cite la ligne de sa balise, juste après le nom de l'effet et ses
 *  réglages (`*titre (ligne 6) : …`, `*nom(inside: true) (ligne 6) dessine…`). Le générateur la porte sur l'erreur (`mjsLine`) :
 *  c'est la ligne du HTML recollé, qu'un partiel inclus ou une macro de balise (`<@head>`, `<@window>`) décale — elle n'est
 *  écrite que si c'est celle d'une balise du fichier qui écrit cet effet. Sinon, repli (le nom suivi de `:`, avec ou sans espace avant,
 *  en français comme en anglais) : l'effet est cherché dans le texte du
 *  fichier, la ligne où il est écrit, ou toutes celles où il l'est quand il s'y trouve plusieurs fois, trois au plus (la faute
 *  est l'une d'elles, jamais une seule devinée ; au-delà, aucune). Un effet cité dans un commentaire HTML n'est pas écrit :
 *  les commentaires sont blanchis avant la recherche, lignes comprises. Un partiel inclus peut écrire le même effet : aucune
 *  ligne alors. Un effet absent du texte du fichier (un partiel inclus) : le message reste tel quel. Le nom est lu comme la balise
 *  l'écrit (parser/index.ts), alias pointé compris et même mal formé (`*filter.Net`, `*filter.net-2`, `*filter.`, `*filter.net.x`) : jamais
 *  un morceau du nom.
 *  Exportée pour ses tests. */
export function withEffectLines(err: any, content: string): any {
  const message = String(err?.message ?? '')
  const head    = /\[ModularJS\] \*([A-Za-z][\w-]*(?:\.[\w.-]*)?)(?:\([^)\n]*\))?/.exec(message)
  if (!head) return err
  const text = content.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, comment => comment.replace(/[^\n]/g, ' '))
  const reported = Number(err?.mjsLine ?? err?.cause?.mjsLine)
  if (reported > 0) {
    if (tagLines(text, head[1]).includes(reported)) {
      const end = head.index + head[0].length
      err.message = message.slice(0, end) + t('bundler.transpile-msg.effect-line', { line: String(reported) }) + message.slice(end)
      return err
    }
    if (/<@include\s/i.test(text)) return err
  }
  const m = /\[ModularJS\] \*([A-Za-z][\w-]*(?:\.[\w.-]*)?)( ?): /.exec(message)
  if (!m) return err
  const lines = tagLines(text, m[1]).sort((a, b) => a - b)
  if (lines.length === 0 || lines.length > 3) return err
  const place = lines.length === 1 ? t('bundler.transpile-msg.effect-line', { line: String(lines[0]) }) : t('bundler.transpile-msg.effect-lines', { lines: lines.join(', ') })
  err.message = message.replace(m[0], `[ModularJS] *${m[1]}${place}${m[2]}: `)
  return err
}

// texte de chaque pose d'un crochet de vie dans le script compilé (`_mjs_hook('mount', …)`, µdestroy, µawake…), parenthèses équilibrées
// hors chaînes et commentaires : une lecture qui se tromperait sur un cas tordu rend toujours le même texte pour le même script
export function lifecycleHookTexts(js: string): string[] {
  const out: string[] = []
  const pattern = '_mjs_hook('
  let i = js.indexOf(pattern)
  while (i >= 0) {
    let j     = i + pattern.length
    let depth = 1
    while (j < js.length && depth > 0) {
      const ch = js[j]
      if (ch === '\'' || ch === '"' || ch === '`') {
        j++
        while (j < js.length && js[j] !== ch) j += js[j] === '\\' ? 2 : 1
      }
      else if (ch === '/' && js[j + 1] === '/') {
        j = js.indexOf('\n', j)
        if (j < 0) j = js.length
        continue
      }
      else if (ch === '/' && js[j + 1] === '*') {
        j = js.indexOf('*/', j + 2)
        j = j < 0 ? js.length : j + 1
      }
      else if (ch === '(') depth++
      else if (ch === ')') depth--
      j++
    }
    out.push(js.slice(i, j))
    i = js.indexOf(pattern, j)
  }
  return out
}

/** Empreinte de ce qui, changé, interdit le rechargement à chaud d'un composant sous `mjs dev` (la page est rechargée en entier) :
 *  ses crochets de vie, les règles de ses variables et de ses magasins, ses slots, son association au formulaire, les autres noms de ses
 *  variables (réglage `proxy: false`, lus à la construction de l'instance). Le reste (gabarit,
 *  gestionnaires, style, variables ajoutées ou retirées) se recharge à chaud, ses instances gardent leur état. */
export function hotNatureHash(data: any): string {
  const template = [data.createFnBody ?? '', ...(data.structUpdates ?? []), ...(data.transUpdates ?? [])].join('\n')
  const nature   = [lifecycleHookTexts(data.jsInitBase ?? ''), data.typesDecl ?? '', data.typesLine ?? '', data.storeTypes ?? {}, data.storeDeclareLine ?? '', !!data.hasDynamicSlots, template.match(/<slot\b[^>]*>/g) ?? [], !!data.moduleFormAssociated, ...(data.aliasLine ? [data.aliasLine] : [])]
  return createHash('sha256').update(JSON.stringify(nature)).digest('hex').slice(0, 16)
}

/** Empreintes que le mode veille compare d'un tour à l'autre (cf. TranspileMsg.watchHashes) : `restHash`, tout le TranspileData sauf le
 *  style de base et les tailles du texte qui le suivent (leur changement seul garde le rechargement du CSS à chaud), et `hotHash` (cf.
 *  hotNatureHash). Hors veille personne ne les lit : elles ne sont pas calculées. */
function watchHashesOf(data: any): { restHash: string, hotHash: string } {
  const { baseCss: _bc, fontSizes: _fs, ...restData } = data
  return { restHash: createHash('sha256').update(JSON.stringify(restData)).digest('hex').slice(0, 16), hotHash: hotNatureHash(data) }
}

const hotIsFn   = (n: any): boolean => !!n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')
const hotCallee = (n: any, object: string, prop: string): boolean => n?.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.object.type === 'Identifier' && n.callee.object.name === object && n.callee.property.name === prop
const hotStr    = (n: any): n is { value: string } => n?.type === 'Literal' && typeof n.value === 'string'

// l'instance elle-même : `this`, `_mjsThis`, ou `(this ?? _mjsThis)` qu'écrit le compilateur dans une fonction de rappel
const hotInstance = (n: any): boolean => n?.type === 'ThisExpression' || (n?.type === 'Identifier' && n.name === '_mjsThis') || (n?.type === 'LogicalExpression' && n.operator === '??' && n.left.type === 'ThisExpression' && n.right.name === '_mjsThis')
// l'écouteur d'un `<@window>` ou d'un `<@document>` tenu hors du calcul en cours (`this._gl_0 = µ._mjs_sigFree(this._gl_0)`,
// transpiler/macros.ts) : posé par le compilateur sur la fonction qu'il vient d'écrire, une fonction comme elle
const hotFree = (n: any, field: string): boolean => hotCallee(n, 'µ', '_mjs_sigFree') && n.arguments.length === 1 && n.arguments[0].type === 'MemberExpression' && !n.arguments[0].computed && hotInstance(n.arguments[0].object) && n.arguments[0].property.name === field

// valeurs du langage, lues sans rien appeler (tant qu'aucun nom du module ne les redéfinit) ; opérateurs de la grammaire de l'échange
const hotLiterals  = new Set(['undefined', 'NaN', 'Infinity'])
const hotOperators = new Set(['+', '-', '*', '/', '%', '**', '==', '!=', '===', '!==', '<', '<=', '>', '>=', '&', '|', '^', '<<', '>>', '>>>'])
const hotUnaires   = new Set(['-', '+', '!', '~', 'typeof', 'void'])

// premier résultat non nul de `f` sur une liste
function hotFirst<T>(list: T[], f: (x: T) => string | null): string | null {
  for (const x of list) {
    const r = f(x)
    if (r) return r
  }
  return null
}

// lecture d'une variable `$` du composant (`$.nom`), ou de sa longueur (`$.nom.length`, `$.nom?.length`)
function hotStateRead(n: any, length = true): boolean {
  if (n?.type === 'ChainExpression') return hotStateRead(n.expression, length)
  if (n?.type !== 'MemberExpression' || n.computed || n.property.type !== 'Identifier') return false
  if (n.object.type === 'Identifier' && n.object.name === '$') return true
  return length && n.property.name === 'length' && hotStateRead(n.object, false)
}

// lecture du magasin de MJS (`$$x`, `µlang` → `µ.store.x`, `µ.store.__mjsLang`) ou d'un de ses champs (`µ.store.x.y`, `µ.store.x?.y`) :
// permise dans une dérivée seulement, que la page garde sans la recalculer tant que les clés lues n'ont pas été écrites (mjs_hotswap.ts) ;
// jamais `µ?.store` ni `µ.store?.x`, dont la page ne relève pas la clé (elle lit `µ.store.x` dans le texte de la dérivée)
function hotStoreRead(n: any): boolean {
  if (n?.type === 'ChainExpression') return hotStoreRead(n.expression)
  if (n?.type !== 'MemberExpression' || n.computed || n.property.type !== 'Identifier') return false
  const o = n.object
  if (o.type === 'MemberExpression' && !o.computed && o.object.type === 'Identifier' && o.object.name === 'µ' && o.property.name === 'store') return !n.optional && !o.optional
  return hotStoreRead(o)
}

// traduction (`µt(…)` → `µ.t(…)`) : la clé, et les valeurs à insérer, rien d'autre (ni mode, ni étalement, ni `µ?.t`, dont la page ne
// compterait pas la langue : elle cherche `µ.t(` dans le texte de la dérivée)
const hotTranslation = (n: any): boolean => hotCallee(n, 'µ', 't') && !n.optional && !n.callee.optional && n.arguments.length >= 1 && n.arguments.length <= 2 && n.arguments.every((a: any) => a.type !== 'SpreadElement')

// méthodes de liste admises dans une dérivée, qui ne modifient pas leur liste (la page vérifie avant l'échange que chacune reste celle
// du langage, cf. _mjsHotMethods, mjs_hotswap.ts) : nombre d'arguments, `rappel` (1 : un rappel simple en premier argument, 2 : facultatif,
// cf. hotCallback), `liste` quand elle rend une liste neuve (receveur d'une autre méthode, `.length` lisible). Ni `concat`, `flat`,
// `flatMap`, qui lisent la forme de leurs arguments ou de leurs éléments, ni une méthode qui modifie (`sort`, `reverse`, `splice`, `push`…)
const hotMethods = new Map<string, { min: number, max: number, callback?: 1 | 2, list?: true }>([
  ['filter', { min: 1, max: 1, callback: 1, list: true }],
  ['map', { min: 1, max: 1, callback: 1, list: true }],
  ['toSorted', { min: 0, max: 1, callback: 2, list: true }],
  ['slice', { min: 0, max: 2, list: true }],
  ['toReversed', { min: 0, max: 0, list: true }],
  ['toSpliced', { min: 0, max: 20, list: true }],
  ['with', { min: 2, max: 2, list: true }],
  ['find', { min: 1, max: 1, callback: 1 }],
  ['findIndex', { min: 1, max: 1, callback: 1 }],
  ['findLast', { min: 1, max: 1, callback: 1 }],
  ['findLastIndex', { min: 1, max: 1, callback: 1 }],
  ['some', { min: 1, max: 1, callback: 1 }],
  ['every', { min: 1, max: 1, callback: 1 }],
  ['reduce', { min: 1, max: 2, callback: 1 }],
  ['reduceRight', { min: 1, max: 2, callback: 1 }],
  ['includes', { min: 1, max: 2 }],
  ['indexOf', { min: 1, max: 2 }],
  ['lastIndexOf', { min: 1, max: 2 }],
  ['at', { min: 1, max: 1 }],
  ['join', { min: 0, max: 1 }],
])

// ce qu'une dérivée admet en plus d'une valeur de départ : `params`, les paramètres des rappels qui l'entourent ; `lists(nom)`, vrai
// quand la variable `$` lue peut recevoir une méthode de liste (variable que la page vérifie, ou dérivée qui rend une liste)
interface HotDerived { params: Set<string>, lists: (name: string) => boolean }

// méthode de liste appelée (`x.filter(…)`, `x?.filter(…)`), ou undefined
function hotMethod(n: any) {
  const c = n?.type === 'CallExpression' && !n.optional ? n.callee : null
  return c?.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' ? hotMethods.get(c.property.name) : undefined
}

// receveur d'une méthode de liste : une variable `$` du composant ou une clé du magasin, que la page vérifie avant l'échange, une liste
// écrite, une dérivée qui rend une liste, une méthode qui rend une liste neuve, ou un choix entre elles (`$$listes or []`) ; jamais un
// élément (`find`, `at`), ni ce que lit un rappel
function hotList(n: any, ctx: HotDerived): boolean {
  switch (n?.type) {
    case 'ChainExpression': return hotList(n.expression, ctx)
    case 'ArrayExpression': return true
    case 'LogicalExpression': return hotList(n.left, ctx) && hotList(n.right, ctx)
    case 'ConditionalExpression': return hotList(n.consequent, ctx) && hotList(n.alternate, ctx)
    case 'CallExpression': return hotMethod(n)?.list === true
    case 'MemberExpression':
      if (!n.computed && n.object.type === 'Identifier' && n.object.name === '$' && n.property.type === 'Identifier') return ctx.lists(n.property.name)
      return hotStoreRead(n)
  }
  return false
}

// rappel simple d'une méthode de liste : `(x) -> expr` (écrit `function(x) { return expr }`) ou `(x) => expr`, dont le corps est une
// seule expression de la grammaire ; ses paramètres, des noms simples, y sont lus avec leurs champs ; ni bloc, ni affectation, ni appel
// hors de la grammaire
function hotCallback(fn: any, locals: Set<string>, ctx: HotDerived): string | null {
  if (!hotIsFn(fn) || fn.async || fn.generator || fn.id || fn.params.length > 4) return 'rappel : forme'
  const b    = fn.body
  const body = b.type !== 'BlockStatement' ? b : (b.body.length === 1 && b.body[0].type === 'ReturnStatement' ? b.body[0].argument : null)
  if (!body) return 'rappel : corps en bloc'
  const params = new Set(ctx.params)
  for (const p of fn.params) {
    if (p.type !== 'Identifier' || ['$', 'µ', '_mjsThis', 'arguments'].includes(p.name) || hotLiterals.has(p.name) || locals.has(p.name)) return 'rappel : paramètre'
    params.add(p.name)
  }
  const r = hotOutsideGrammar(body, locals, { ...ctx, params })
  return r ? `rappel : ${r}` : null
}

// appel dans une dérivée : une traduction, ou une méthode de liste sur une liste (cf. hotList), ses rappels simples, ses autres
// arguments dans la grammaire
function hotDerivedCall(n: any, locals: Set<string>, ctx: HotDerived): string | null {
  if (hotTranslation(n)) return hotFirst(n.arguments, (x: any) => hotOutsideGrammar(x, locals, ctx))
  const m = hotMethod(n), a = n.arguments
  if (!m || a.length < m.min || a.length > m.max || a.some((x: any) => x.type === 'SpreadElement')) return 'call'
  if (!hotList(n.callee.object, ctx)) return 'méthode de liste : receveur'
  const r = hotOutsideGrammar(n.callee.object, locals, ctx)
  if (r) return r
  for (let i = 0; i < a.length; i++) {
    const e = i === 0 && m.callback ? hotCallback(a[i], locals, ctx) : hotOutsideGrammar(a[i], locals, ctx)
    if (e) return e
  }
  return null
}

// champ lu dans une dérivée, hors de la grammaire des valeurs de départ : appel chaîné (`$.liste?.filter(…)`), `.length` d'une liste
// neuve, champ d'un paramètre de rappel (`x.actif`, `x?.tags`, `x[0]`) ; undefined : la règle commune s'applique
function hotDerivedField(n: any, locals: Set<string>, ctx: HotDerived): string | null | undefined {
  const e = n.type === 'ChainExpression' ? n.expression : n
  if (e.type === 'CallExpression') return hotOutsideGrammar(e, locals, ctx)
  if (e.type !== 'MemberExpression') return undefined
  if (!e.computed && e.property.name === 'length' && hotMethod(e.object.type === 'ChainExpression' ? e.object.expression : e.object)?.list) return hotOutsideGrammar(e.object, locals, ctx)
  let o = e
  while (o.type === 'MemberExpression' && (!o.computed || (o.property.type === 'Literal' && ['string', 'number'].includes(typeof o.property.value)))) o = o.object
  return o.type === 'Identifier' && ctx.params.has(o.name) ? null : undefined
}

// valeur primitive écrite telle quelle (nombre, chaîne sans interpolation, booléen, null, `-1`, undefined) : seule valeur d'une constante
function hotPrimitive(n: any): boolean {
  if (n?.type === 'Literal') return !n.regex
  if (n?.type === 'TemplateLiteral') return n.expressions.length === 0
  if (n?.type === 'UnaryExpression') return (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number'
  return n?.type === 'Identifier' && hotLiterals.has(n.name)
}

// donnée écrite telle quelle : valeur primitive, ou tableau et objet (sans accesseur, méthode, clé calculée ni étalement) qui n'en
// contiennent pas d'autre — la table des routes que le compilateur pose sur l'instance
function hotData(n: any): boolean {
  if (n?.type === 'ArrayExpression') return n.elements.every((e: any) => e !== null && e.type !== 'SpreadElement' && hotData(e))
  if (n?.type === 'ObjectExpression') return n.properties.every((q: any) => q.type === 'Property' && q.kind === 'init' && !q.method && !q.computed && (q.key.type === 'Identifier' ? q.key.name : q.key.value) !== '__proto__' && hotData(q.value))
  return hotPrimitive(n)
}

/** Ce qui fait sortir une expression de la grammaire de l'échange à chaud (null : elle y tient). Seuls permis : littéraux, lectures de
 *  `$` du composant et leur `.length`, opérateurs arithmétiques, logiques et de comparaison, ternaire, tableaux et objets faits de ces
 *  éléments. Aucun appel écrit, aucun champ d'autre chose qu'une `$`, aucun nom (constante, variable ordinaire, fonction), aucun
 *  étalement, aucun accesseur. Une `$` qui tient un objet peut encore cacher un appel (`valueOf`, `toString`, trappe d'un Proxy) : la
 *  page ne rejoue donc ni les valeurs de départ des variables gardées ni les dérivées inchangées (mjs_hotswap.ts). `locaux` : variables
 *  d'une dérivée écrite en bloc ; `derived` : une dérivée admet en plus la lecture du magasin, la traduction et les méthodes de liste
 *  (cf. hotStoreRead, hotTranslation, hotDerivedCall), qu'une valeur de départ, rejouée à chaque échange même pour une variable
 *  gardée, n'admet pas (`µt` peut demander une section de traduction). */
function hotOutsideGrammar(n: any, locals: Set<string>, derived: false | HotDerived = false): string | null {
  const sub = (...xs: any[]): string | null => hotFirst(xs, (x: any) => hotOutsideGrammar(x, locals, derived))
  switch (n?.type) {
    case undefined: return null
    case 'Literal': return n.regex ? 'expression régulière' : null
    case 'Identifier': return locals.has(n.name) || hotLiterals.has(n.name) || (derived && derived.params.has(n.name)) ? null : 'nom lu (constante, variable ordinaire ou fonction)'
    case 'MemberExpression': case 'ChainExpression': {
      const r = derived ? hotDerivedField(n, locals, derived) : undefined
      if (r !== undefined) return r
      return hotStateRead(n) || (derived && hotStoreRead(n)) ? null : 'champ lu'
    }
    case 'TemplateLiteral': return n.expressions.every((x: any) => hotStateRead(x)) ? null : 'chaîne gabarit'
    case 'UnaryExpression': return hotUnaires.has(n.operator) ? sub(n.argument) : `opérateur ${n.operator}`
    case 'BinaryExpression': return hotOperators.has(n.operator) ? sub(n.left, n.right) : `opérateur ${n.operator}`
    case 'LogicalExpression': return sub(n.left, n.right)
    case 'ConditionalExpression': return sub(n.test, n.consequent, n.alternate)
    case 'ArrayExpression': return n.elements.some((e: any) => e?.type === 'SpreadElement') ? 'étalement' : sub(...n.elements)
    case 'ObjectExpression': return hotFirst(n.properties, (q: any) => {
      if (q.type === 'SpreadElement') return 'étalement'
      if (q.kind !== 'init' || q.method || q.computed) return 'accesseur, méthode ou clé calculée'
      return (q.key.type === 'Identifier' ? q.key.name : q.key.value) === '__proto__' ? 'prototype posé' : sub(q.value)
    })
    case 'CallExpression': return derived ? hotDerivedCall(n, locals, derived) : 'call'
    case 'NewExpression': case 'TaggedTemplateExpression': case 'ImportExpression': return 'call'
    case 'FunctionExpression': case 'ArrowFunctionExpression': return 'function'
  }
  return `forme ${n.type}`
}

// une valeur de départ ne lit une `$` que telle quelle (la valeur entière, un élément de tableau, une valeur d'objet, l'opérande de `??`,
// `&&`, `||`, `!`, `typeof`, `===`, `!==` ou d'un ternaire : `$n = $depart`, `$depart ?= 0`), jamais une dérivée du script : rejouée sur
// l'état gardé, elle n'appelle alors rien (aucun `valueOf`, aucune trappe de Proxy, aucun calcul de dérivée) ; vrai : elle calcule sur
// une `$` (opérateur qui convertit, `.length`, chaîne gabarit) ou lit une dérivée
function hotReadsState(n: any, derivedNames: Set<string>): boolean {
  const sub = (...xs: any[]): boolean => xs.some((x) => hotReadsState(x, derivedNames))
  if (!n) return false
  if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === '$' && n.property.type === 'Identifier') return derivedNames.has(n.property.name)
  if (n.type === 'ArrayExpression') return sub(...n.elements)
  if (n.type === 'ObjectExpression') return sub(...n.properties.map((q: any) => q.value))
  if (n.type === 'LogicalExpression' || (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '!=='))) return sub(n.left, n.right)
  if (n.type === 'ConditionalExpression') return sub(n.test, n.consequent, n.alternate)
  if (n.type === 'UnaryExpression' && (n.operator === '!' || n.operator === 'typeof' || n.operator === 'void')) return sub(n.argument)
  let read = false
  walk.full(n, (x: any) => { if (x.type === 'MemberExpression' && x.object.type === 'Identifier' && x.object.name === '$') read = true })
  return read
}

// corps d'une dérivée : une expression de la grammaire, ou le bloc que le compilateur écrit pour un `if … then … else` (variables du
// bloc, `if`, affectations de ces variables, `return`)
function hotDerivedOutside(fn: any, ctx: HotDerived): string | null {
  if (fn.type !== 'ArrowFunctionExpression' || fn.params.length > 0 || fn.async || fn.generator) return 'dérivée : forme'
  const locals = new Set<string>()
  if (fn.body.type === 'BlockStatement') for (const st of fn.body.body) if (st.type === 'VariableDeclaration') for (const d of st.declarations) if (d.id.type === 'Identifier' && d.id.name !== '$') locals.add(d.id.name)
  const instr = (st: any): string | null => {
    switch (st.type) {
      case 'EmptyStatement': return null
      case 'BlockStatement': return hotFirst(st.body, instr)
      case 'ReturnStatement': return hotOutsideGrammar(st.argument, locals, ctx)
      case 'IfStatement': return hotOutsideGrammar(st.test, locals, ctx) ?? instr(st.consequent) ?? (st.alternate ? instr(st.alternate) : null)
      case 'VariableDeclaration': return hotFirst(st.declarations, (d: any) => d.id.type === 'Identifier' && locals.has(d.id.name) ? hotOutsideGrammar(d.init, locals, ctx) : 'shape')
      case 'ExpressionStatement': {
        const e = st.expression
        return e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'Identifier' && locals.has(e.left.name) ? hotOutsideGrammar(e.right, locals, ctx) : 'instruction'
      }
    }
    return 'instruction'
  }
  const r = fn.body.type === 'BlockStatement' ? hotFirst(fn.body.body, instr) : hotOutsideGrammar(fn.body, locals, ctx)
  return r ? `dérivée : ${r}` : null
}

/** Ce que le rechargement à chaud de `mjs dev` doit savoir du script d'un composant (cf. mjs_hotswap.ts) : redessiner une instance
 *  rejoue son script sur l'état gardé, ce qui n'est permis qu'à un script de la liste blanche — premier tri, tout le reste recharge la
 *  page ; le dernier mot revient à la page (garde des champs de l'instance, plantage pendant l'échange). `pure` : chaque instruction hors
 *  des fonctions est une valeur de départ `$` (qui ne lit une `$` que telle quelle) ou une dérivée dont l'expression tient dans la grammaire minuscule
 *  de hotOutsideGrammar (lecture du magasin et traduction comprises), une fonction, une constante dont la valeur est un littéral primitif, un crochet de
 *  vie (rejoué : le départ appelle l'ancien µdestroy, le retour le nouveau µmount), une minuterie de `µevery`, le code de `@persist`,
 *  ou ce que le compilateur pose pour le gabarit (effets, gestionnaires, écouteurs de `<@window>`, chargement des composants nommés) ;
 *  et chaque fonction, constante ou fonction posée sur l'instance n'est écrite qu'une fois dans tout le module (gestionnaires du gabarit
 *  compris). Une variable ordinaire au haut du script (référence `@this` comprise), une constante qui n'est pas un littéral, un reffet
 *  (`µeffect`), un appel : rechargement. `inits` : texte de la valeur de départ de chaque variable (`ƒ` devant une dérivée, `#` devant
 *  le nom d'une constante) ; une valeur de départ ou une constante qui change recharge la page, une dérivée qui change se recalcule.
 *  `reason` : ce qui a fait refuser l'échange, pour le décompte. */
// lecture notée pour le graphe des signaux (`µ._mjs_sigCur && µ._mjs_sigRead(_mjsThis, 'x')`, generator/transform-reactive.ts,
// recordReads) : le calcul d'une valeur précise en porte une devant chaque `$.x` qu'il lit, et une en tête pour les lectures de ses rappels ;
// la forme `µ._mjs_sigCur != null && …` d'une sortie plus ancienne est reconnue de même
function hotNote(n: any): boolean {
  const g = n?.type === 'LogicalExpression' && n.operator === '&&' ? n.left : null
  const c = g?.type === 'BinaryExpression' && g.operator === '!=' ? g.left : g
  return c?.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'µ' && c.property.name === '_mjs_sigCur'
}
// l'arbre du script sans ses lectures notées : `(note, $.x)` redevient `$.x`, le corps `(notes, corps)` d'une flèche redevient `corps`, la
// ligne de tête `notes;` d'un bloc disparaît — le tri de l'échange à chaud juge la dérivée telle que le compilateur l'a écrite, sans elles
function hotWithoutNotes(n: any): any {
  if (n === null || typeof n !== 'object' || typeof n.type !== 'string') return n
  if (n.type === 'SequenceExpression' && n.expressions.length === 2 && hotNote(n.expressions[0])) return hotWithoutNotes(n.expressions[1])
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (Array.isArray(v)) n[k] = v.filter((x: any) => !(x?.type === 'ExpressionStatement' && hotNote(x.expression))).map(hotWithoutNotes)
    else if (v !== null && typeof v === 'object' && typeof v.type === 'string') n[k] = hotWithoutNotes(v)
  }
  return n
}
export function hotScriptFacts(js: string, output: string): { pure: boolean, inits: Record<string, string>, reason?: string } {
  const inits: Record<string, string> = {}
  const impure                        = (reason: string) => ({ pure: false, inits, reason })
  let ast: any, outputAst: any
  try {
    ast = hotWithoutNotes(acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }))
    // les adresses des fichiers (`from µ.asset('mjs_core.js')`) sont posées par le bundler : une chaîne en tient lieu
    outputAst = acorn.parse(output.replace(/µ\.asset\((['"])[^'"\n]*\1\)/g, '\'\''), { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return impure('script ou module illisible')
  }
  // `eval` peut réécrire n'importe quelle variable du script
  if (/\beval\b/.test(output)) return impure('eval')
  // la traduction et le magasin admis dans une dérivée sont ceux du cœur : un module qui les remplace sort de la liste
  if (/µ\s*\.\s*(?:t|store)\s*=(?!=)/.test(output)) return impure('µ.t ou µ.store réécrit')
  // écritures de chaque nom dans tout le module (script, gestionnaires du gabarit, rappels) : une variable, ou `this.nom` pour un champ
  // de l'instance ; un champ écrit (`nom.x = …`, `delete nom.x`) compte pour sa variable
  const writes = new Map<string, number>()
  const target   = (n: any): string | null => {
    while (n?.type === 'MemberExpression' || n?.type === 'ChainExpression') {
      if (n.type === 'MemberExpression' && !n.computed && hotInstance(n.object)) return 'this.' + n.property.name
      n = n.type === 'ChainExpression' ? n.expression : n.object
    }
    return n?.type === 'Identifier' ? n.name : null
  }
  const pattern = (p: any): void => {
    if (p?.type === 'ArrayPattern') p.elements.forEach(pattern)
    else if (p?.type === 'ObjectPattern') for (const q of p.properties) pattern(q.type === 'RestElement' ? q.argument : q.value)
    else if (p?.type === 'AssignmentPattern') pattern(p.left)
    else if (p?.type === 'RestElement') pattern(p.argument)
    else {
      const name = target(p)
      if (name !== null) writes.set(name, (writes.get(name) ?? 0) + 1)
    }
  }
  const loop = (n: any) => pattern(n.left.type === 'VariableDeclaration' ? n.left.declarations[0].id : n.left)
  walk.simple(outputAst, {
    AssignmentExpression(n: any) { pattern(n.left) },
    UpdateExpression(n: any) { pattern(n.argument) },
    UnaryExpression(n: any) { if (n.operator === 'delete') pattern(n.argument) },
    VariableDeclarator(n: any) { if (n.init) pattern(n.id) },
    ForInStatement: loop,
    ForOfStatement: loop,
    FunctionDeclaration(n: any) { if (n.id) pattern(n.id) },
    ClassDeclaration(n: any) { if (n.id) pattern(n.id) },
  })
  // dérivées du script, qu'une valeur de départ ne lit pas (cf. hotReadsState)
  const derivedNames = new Set([...js.matchAll(/µ\._mjs_setComputed\(_mjsThis, '([^']+)'/g)].map((m) => m[1]))
  // receveurs d'une méthode de liste (cf. hotList) : toute variable `$` que le script ne dérive pas, et les dérivées dont le corps, une
  // expression, rend une liste ; une dérivée qui se lit elle-même n'en rend pas
  const body = new Map<string, any>()
  walk.simple(ast, { CallExpression(n: any) {
    const a = n.arguments
    if (hotCallee(n, 'µ', '_mjs_setComputed') && hotStr(a[1]) && a[2]?.type === 'ArrowFunctionExpression' && a[2].body.type !== 'BlockStatement') body.set(a[1].value, a[2].body)
  } })
  const rendersList     = new Map<string, boolean>()
  const ctx: HotDerived = { params: new Set(), lists: (name: string): boolean => {
    if (!derivedNames.has(name)) return true
    if (!rendersList.has(name)) {
      rendersList.set(name, false)
      rendersList.set(name, body.has(name) && hotList(body.get(name), ctx))
    }
    return rendersList.get(name)!
  } }
  // noms posés au haut du script, avec leur valeur (null : déclarés sans valeur)
  const defined = new Map<string, any>()
  const src     = (n: any): string => js.slice(n.start, n.end)
  let lq        = false
  // pose d'un crochet de vie (`_mjsThis._mjs_hook('mount', fn)`, ou `this._mjs_hook` dans une chaîne) : rejoué à chaque échange
  const isHookCall = (e: any, hook?: string): boolean => {
    if (e?.type !== 'CallExpression' || e.callee.type !== 'MemberExpression' || e.callee.property.name !== '_mjs_hook' || !hotInstance(e.callee.object)) return false
    const a = e.arguments
    return hotStr(a[0]) && hotIsFn(a[1]) && a.length === 2 && (hook === undefined || a[0].value === hook)
  }
  const instruction = (st: any): string | null => {
    // appel enveloppé par le compilateur (`µ._mjs_lq++; try { … } finally { --µ._mjs_lq || µ._mjs_lqF() }`) : seul compte ce qu'il enveloppe
    if (lq) {
      lq = false
      return st.type === 'TryStatement' && !st.handler && !!st.finalizer && /^\{\s*--µ\._mjs_lq\s*\|\|\s*µ\._mjs_lqF\(\)\s*;?\s*\}$/.test(src(st.finalizer)) ? hotFirst(st.block.body, instruction) : 'instruction : enveloppe'
    }
    if (st.type === 'ExpressionStatement' && st.expression.type === 'UpdateExpression' && st.expression.operator === '++' && src(st.expression.argument) === 'µ._mjs_lq') {
      lq = true
      return null
    }
    if (st.type === 'EmptyStatement') return null
    if (st.type === 'FunctionDeclaration') {
      defined.set(st.id.name, st)
      return null
    }
    if (st.type === 'VariableDeclaration') return hotFirst(st.declarations, (d: any) => {
      if (d.id.type !== 'Identifier') return 'variable ordinaire'
      // effets du gabarit, posés par le compilateur : des fonctions jouées au rendu
      if (d.id.name === '_mjs_eff') return d.init?.type === 'ArrayExpression' && d.init.elements.every(hotIsFn) ? null : 'variable ordinaire'
      defined.set(d.id.name, d.init ?? defined.get(d.id.name) ?? null)
      return null
    })
    // code de @persist : relecture du stockage, sans rien ouvrir
    if (st.type === 'TryStatement') return /^try \{\s*const _mjs_p_stored_(\w+) = (?:localStorage|sessionStorage)\.getItem\(_mjs_p_key_\1\)/.test(src(st)) ? null : 'instruction : try'
    if (st.type !== 'ExpressionStatement') return `instruction : ${st.type}`
    const e = st.expression, a = e.arguments ?? []
    // chargement d'un composant que le gabarit nomme, posé par le compilateur : un module déjà chargé ne l'est pas deux fois
    if (e.type === 'ChainExpression') {
      const x = e.expression, m = x.callee
      // pages d'une table de routes préchargées au repos (`µ._mjs_routesIdle?.([…])`, transpiler/index.ts) : téléchargées, jamais
      // exécutées ; rejoué, l'appel range les mêmes noms dans sa file, une page définie ou en vol est sautée (mjs_router.ts)
      if (hotCallee(x, 'µ', '_mjs_routesIdle')) return x.arguments.length === 1 && x.arguments[0].type === 'ArrayExpression' && x.arguments[0].elements.every(hotStr) ? null : 'call'
      return x.type === 'CallExpression' && m?.type === 'MemberExpression' && m.property.name === 'load' && m.object.type === 'MemberExpression' && m.object.object.name === 'µ' && m.object.property.name === 'Autoloader' && x.arguments.length === 1 && hotStr(x.arguments[0]) ? null : 'call'
    }
    if (hotCallee(e, 'µ', '_set')) {
      if (a.length !== 3 || a[0]?.name !== '_mjsThis' || !hotStr(a[1])) return 'valeur de départ : forme'
      const r = hotOutsideGrammar(a[2], new Set())
      if (r) return `valeur de départ : ${r}`
      // l'état gardé passe tel quel : une valeur de départ rejouée qui calcule sur une `$` repasserait par elle (`valueOf`, trappe d'un Proxy)
      if (hotReadsState(a[2], derivedNames)) return 'valeur de départ : calcul sur une $'
      inits[a[1].value] = '=' + src(a[2])
      return null
    }
    if (hotCallee(e, 'µ', '_mjs_setComputed')) {
      // quatrième argument : les sources d'une valeur précise, posées par le compilateur
      if ((a.length !== 3 && !(a.length === 4 && a[3].type === 'ArrayExpression' && a[3].elements.every(hotStr))) || a[0]?.name !== '_mjsThis' || !hotStr(a[1]) || !hotIsFn(a[2])) return 'dérivée : forme'
      // valeur qui attend (`$x = await …`, transpiler/await-derived.ts) : rejouée, elle garde la valeur affichée et refait sa demande une
      // fois (runtime/mjs_await_derived.ts) ; son expression appelle la fonction qu'elle veut, elle n'a pas à tenir dans la grammaire
      if (a[2].type === 'ArrowFunctionExpression' && a[2].async && !a[2].generator) {
        inits[a[1].value] = 'ƒ' + src(a[2])
        return null
      }
      const r = hotDerivedOutside(a[2], ctx)
      if (r) return r
      inits[a[1].value] = 'ƒ' + src(a[2])
      return null
    }
    // écriture de @persist : un reffet posé par le compilateur, qui ne fait qu'écrire le stockage ; tout autre reffet recharge. Sa lecture
    // de la variable peut être notée pour le graphe des signaux (`$[(µ._mjs_sigCur && µ._mjs_sigRead(_mjsThis, 'x'), 'x')]`,
    // generator/effect-deps.ts, noteComponentReads ; la forme `µ._mjs_sigCur != null && …` d'une sortie plus ancienne de même)
    if (hotCallee(e, 'µ', 'effect')) return /^µ\.effect\(\(\) => \{\s*const _mjs_p_json_(\w+) = JSON\.stringify\(\$(?:\.\1|\[\(µ\._mjs_sigCur(?: != null)? && µ\._mjs_sigRead\(_mjsThis, '\1'\), '\1'\)\])\)\s*try \{\s*(?:localStorage|sessionStorage)\.setItem\(_mjs_p_key_\1, _mjs_p_json_\1\)\s*\}\s*catch \(_e\) \{\s*null\s*\}\s*return\s*\}, \["\1"\]\)$/.test(src(e)) ? null : 'reffet (µeffect)'
    // minuterie de `µevery` / `µafter` : posée au montage, rendue au départ de l'instance (mjs_every.ts), son rappel ne joue
    // pas à l'échange ; le composant que le compilateur passe en tête (`_mjsThis`, sigils.ts) n'en change pas la forme
    if (hotCallee(e, 'µ', 'every') || hotCallee(e, 'µ', 'after')) {
      const b = a[0]?.type === 'Identifier' && a[0].name === '_mjsThis' ? a.slice(1) : a
      return b.length >= 2 && b.length <= 3 && hotIsFn(b[b.length - 1]) && !hotFirst(b.slice(0, -1), (x: any) => hotOutsideGrammar(x, new Set())) ? null : 'minuterie µevery : forme'
    }
    // chaîne posée par le compilateur (`<@window>`, `<@document>`… : `((_mjs_prevAwake = this._mjs_hooks?.awake) => this._mjs_hook('awake',
    // …))()`, de même `_mjs_prevSleep` et les autres crochets) : un crochet de plus, qui rappelle le précédent
    if (e.type === 'CallExpression' && a.length === 0 && e.callee.type === 'ArrowFunctionExpression' && e.callee.params.length === 1 && e.callee.params[0].type === 'AssignmentPattern') {
      const name    = /^_mjs_prev([A-Z]\w*)$/.exec(e.callee.params[0].left.name ?? '')
      const hook    = name ? name[1][0].toLowerCase() + name[1].slice(1) : ''
      const b       = e.callee.body
      const setExpr = b.type === 'BlockStatement' ? (b.body.length === 1 && b.body[0].type === 'ReturnStatement' ? b.body[0].argument : null) : b
      return !!name && src(e.callee.params[0].right).replace(/^(?:this|_mjsThis)\._mjs_hooks\?\./, '') === hook && isHookCall(setExpr, hook) ? null : 'call'
    }
    if (isHookCall(e)) return null
    if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'Identifier') {
      defined.set(e.left.name, e.right)
      return null
    }
    // champ de l'instance : écouteurs de `<@window>` et gestionnaires du gabarit posés par le compilateur, ou fonction du composant
    // (`@fmt = (x) -> …`) écrite une seule fois
    if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression' && !e.left.computed && hotInstance(e.left.object)) {
      const field = e.left.property.name
      if (/^_gl_\d+$/.test(field)) return hotIsFn(e.right) || hotFree(e.right, field) ? null : 'champ de l\'instance'
      if (field === '_mjs_inline') return e.right.type === 'ArrayExpression' && e.right.elements.every(hotIsFn) ? null : 'champ de l\'instance'
      // table des routes et drapeau du routeur, posés par le compilateur (`<routes>`) : des données écrites une fois, comparées d'une
      // version à l'autre comme une constante
      if ((field === 'routes' || field === '_mjs_is_router_aware') && hotData(e.right) && writes.get('this.' + field) === 1) {
        inits['#this.' + field] = src(e.right)
        return null
      }
      if (!hotIsFn(e.right)) return 'champ de l\'instance : valeur'
      return writes.get('this.' + field) === 1 ? null : 'champ de l\'instance : fonction réécrite'
    }
    return e.type === 'CallExpression' ? 'call' : `instruction : ${e.type}`
  }
  const reject = hotFirst(ast.body, instruction) ?? (lq ? 'instruction : enveloppe' : null)
  if (reject) return impure(reject)
  for (const name of hotLiterals) if (writes.has(name) || defined.has(name)) return impure('nom du langage redéfini')
  // noms du haut du script : une fonction ou une constante à valeur primitive, écrite une seule fois dans tout le module (sa définition) ;
  // un nom écrit ailleurs (gestionnaire, crochet, gabarit, référence `@this`) est une variable ordinaire, rejouer le script la remettrait
  // à son départ
  for (const [name, value] of defined) {
    const n = writes.get(name) ?? 0
    if (n === 0 && value === null) continue
    if (n !== 1 || value === null) return impure('variable ordinaire')
    if (value.type === 'FunctionDeclaration' || hotIsFn(value)) continue
    if (!hotPrimitive(value)) return impure('constante qui n\'est pas un littéral')
    inits['#' + name] = src(value)
  }
  return { pure: true, inits }
}

/** Exécute UN message de transpilation. Identique des deux côtés (worker ou processus
 *  principal) : c'est la seule définition de la projection et de `restHash`. */
export async function transpileFromMsg(msg: TranspileMsg): Promise<TranspileMsgResult> {
  const preResolved = msg.preResolvedAssets ?? {}
  // lignes étiquetées que CETTE transpilation imprime (compte propre au thread qui l'exécute) —
  // rendu au bundler, qui décide avec la CLI de la ligne d'aide de fin de bilan
  const printedBefore = printedTypedLines()
  const result = await transpile(msg.content, {
    moduleName: msg.moduleName,
    isPageModule: msg.isPageModule,
    sourceFileName: msg.sourceFileName,
    defaultScriptLang: msg.defaultScriptLang,
    templateLang: msg.templateLang,
    sigil: msg.sigil,
    contextAlias: msg.contextAlias,
    varPrefix: msg.varPrefix,
    maxStateVars: msg.maxStateVars,
    a11y: msg.a11y,
    ujsForm: msg.ujsForm,
    lint: msg.lint,
    colorsEnabled: msg.colorsEnabled,
    baseDir: msg.baseDir,
    sourceDir: msg.sourceDir,
    aliasTag: msg.aliasTag,
    dirInject: msg.dirInject,
    preResolvedImages: msg.preResolvedImages,
    typeDefs: msg.typeDefs,
    classes: msg.classes,
    effectDefs: msg.effectDefsWire ? effectDefsFromWire(msg.effectDefsWire) : msg.effectDefs,
    typesText: msg.typesText,
    devWarnings: msg.devWarnings,
    serverRendered: msg.serverRendered,
    skeleton: msg.skeleton,
    guard: msg.guard,
    typedStores: msg.typedStores,
    models: msg.models,
    derived: msg.derived,
    derivedPrecise: msg.derivedPrecise,
    reffetsAll: msg.reffetsAll,
    routesPreload: msg.routesPreload,
    proxy: msg.proxy,
    responsiveFontSize: msg.responsiveFontSize,
    // la construction voit tous les fichiers : elle juge en fin de tour une transition écrite avec un réglage sans nom (cf. Bundler.compile, étape 11)
    deferUnnamedSettings: true,
    // resolveAsset : lit dans le dict pré-rempli. Pour les `µasset(expr)`
    // dynamiques non pré-résolus, retourne MISSING_MJS_ASSET — le master
    // fera `resolveMagicAssets` en post-process pour les rattraper.
    resolveAsset: async (logicalPath: string) => {
      return preResolved[logicalPath] ?? `/MISSING_MJS_ASSET:${logicalPath}`
    },
  }).catch((e: unknown) => { throw withEffectLines(e, msg.content) })
  // worker_threads sérialise via structuredClone : strings, arrays, plain
  // objects, Set, Map, Date, RegExp passent. Pas de classes ni fonctions.
  //
  // PERF — on NE renvoyait PAS que l'utile :
  // `result.data` est le TranspileData COMPLET (surgicalHtml, createFnBody,
  // effets… potentiellement gros) structuredClone'é en entier à chaque
  // fichier, alors que le master ne lit QUE quelques champs (cf.
  // TranspileDataLike). On projette ces champs → clone minimal.
  //
  // rechargement CSS à chaud — le diff « css-only » du master a
  // besoin de savoir si TOUT hors-baseCss est identique au compile précédent,
  // SANS ré-expédier les gros champs : on les résume ici en une EMPREINTE
  // (`restHash`, SHA-256 du TranspileData privé de baseCss — ordre de clés
  // déterministe, l'objet est un littéral construit par transpile()), en mode
  // veille seulement (cf. watchHashesOf). Seuls
  // transitent en plus les petits champs utiles au payload css-only :
  // tagName/aliasTag (clés), baseCss + moduleDisplay (CSS scopé).
  return {
    output: result.output,
    // carte de source du composant (chaîne complète .mjs → fichier
    // produit, cf. transpiler/source-map-chain.ts). Chaîne JSON, donc clonable
    // telle quelle par structuredClone ; absente si le langage n'en produit pas.
    sourceMap: result.sourceMap,
    data: {
      usedAnimations:  result.data.usedAnimations,
      sharedCssNames:  result.data.sharedCssNames,
      includedPartials: result.data.includedPartials,
      macroErrors:     result.data.macroErrors,
      sectionWarnings: result.data.sectionWarnings,
      lintPrinted:     printedTypedLines() - printedBefore,
      tagRefs:         result.data.tagRefs,
      componentDeps:   result.data.componentDeps,
      tagName:         result.data.tagName,
      aliasTag:        result.data.aliasTag,
      baseCss:         result.data.baseCss,
      moduleDisplay:   result.data.moduleDisplay,
      layoutCss:       result.data.layoutCss,
      fontSizes:       result.data.fontSizes,
      themeVars:       result.data.themeVars,
      varsRead:        result.data.varsRead,
      checks:          result.data.checks,
      themeVariants:   result.data.themeVariants,
      storeTypes:      result.data.storeTypes,
      usesNamedTypes:  result.data.usesNamedTypes,
      // transitions écrites avec un réglage sans nom : la construction juge leur nom en fin de tour
      unnamedSettingAnimations: result.data.unnamedSettingAnimations,
      // sans lui, un composant qui pose un effet de l'appli ne dépendrait jamais des fichiers
      // *.effects.mjs : un effet modifié en `mjs dev` ne le recompilerait pas
      usesProjectEffects: result.data.usesProjectEffects,
      // seulement quand le classement est demandé (cf. TranspileOpts.derived)
      ...(result.data.derivedClasses ? { derivedClasses: result.data.derivedClasses } : {}),
      // CSS seul et rechargement à chaud des composants (cf. watchHashesOf) : comparés au compile précédent par le bundler en mode watch,
      // calculés quand il les demande, jamais pour une construction
      ...(msg.watchHashes ? watchHashesOf(result.data) : {}),
      // ce que le script fait hors de ses fonctions et ses valeurs de départ (cf. hotScriptFacts) : développement seulement
      ...(msg.devWarnings ? { hotScript: hotScriptFacts(result.data.jsInitBase ?? '', result.output) } : {}),
    },
  }
}
