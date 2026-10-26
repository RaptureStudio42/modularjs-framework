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
import { printedTypedLines, type LintToggles } from '../diagnostics.js'
import type { RuleAst } from '../transpiler/var-types.js'
import type { ProjectEffect } from '../effects/catalog.js'
import { collectEffectDefs } from './effects-files.js'
import { t } from '../messages/index.js'
import { Scanner, extractBalanced } from '../parser/index.js'

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
let livres: { defs: Record<string, ProjectEffect>, json: Map<string, string> } | null = null
function aliasLivres(): { defs: Record<string, ProjectEffect>, json: Map<string, string> } {
  if (livres === null) {
    const defs = collectEffectDefs([], () => '')
    livres = { defs, json: new Map(Object.entries(defs).map(([n, d]) => [n, JSON.stringify(d)])) }
  }
  return livres
}

// une entrée déjà comparée, sous son nom : le bundler n'en modifie jamais une sur place, il en pose une neuve
const comparees = new WeakMap<ProjectEffect, { nom: string, pareille: boolean }>()

/** `defs` pour un message : l'ordre de ses noms, et ce qui diffère des alias livrés */
export function effectDefsToWire(defs: Record<string, ProjectEffect>): EffectDefsWire {
  const order = Object.keys(defs)
  const diff: Record<string, ProjectEffect> = {}
  for (const nom of order) {
    const d = defs[nom]
    let vu = comparees.get(d)
    if (vu === undefined || vu.nom !== nom) {
      const ref = aliasLivres().json.get(nom)
      vu = { nom, pareille: ref !== undefined && ref === JSON.stringify(d) && isDeepStrictEqual(aliasLivres().defs[nom], d) }
      comparees.set(d, vu)
    }
    if (!vu.pareille) diff[nom] = d
  }
  return { order, diff }
}

/** l'inverse, à la réception : chaque nom, pris dans `diff` ou dans les alias livrés, dans l'ordre d'origine */
export function effectDefsFromWire(wire: EffectDefsWire): Record<string, ProjectEffect> {
  const defs = aliasLivres().defs
  const out: Record<string, ProjectEffect> = {}
  for (const nom of wire.order) out[nom] = Object.hasOwn(wire.diff, nom) ? wire.diff[nom] : defs[nom]
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
  defaultScriptLang?: 'civet' | 'coffee' | 'ts' | 'js'
  templateLang?: 'civet' | 'js'
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
  /** effets des fichiers `*.effects.mjs` (cf. TranspileOpts.effectDefs) */
  effectDefs?: Record<string, ProjectEffect>
  /** les mêmes, sans les alias que ModularJS livre tels quels (cf. effectDefsToWire) : ce que le bundler envoie */
  effectDefsWire?: EffectDefsWire
  /** texte des règles dans le code émis (cf. TranspileOpts.typesText) : `false` en production */
  typesText?: boolean
  /** avertissements du développement dans le code émis (cf. TranspileOpts.devWarnings) : `false` en production */
  devWarnings?: boolean
  /** les chargements qui montrent un squelette d'eux-mêmes (cf. TranspileOpts.skeleton) */
  skeleton?: string[]
  /** *guard d'office sur un champ lié typé (cf. TranspileOpts.guard) */
  guard?: boolean | { delay?: number | string }
  /** les stores typés du projet (cf. TranspileOpts.typedStores) */
  typedStores?: string[]
  /** les modèles en fichier des composants (cf. TranspileOpts.models) */
  models?: { dev?: Record<string, string[]>, core?: Record<string, string[]> }
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
      if (quote) { if (c === quote) quote = ''; continue }
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
      err.message = message.slice(0, end) + t('bundler.transpile-msg.effet-ligne', { ligne: String(reported) }) + message.slice(end)
      return err
    }
    if (/<@include\s/i.test(text)) return err
  }
  const m = /\[ModularJS\] \*([A-Za-z][\w-]*(?:\.[\w.-]*)?)( ?): /.exec(message)
  if (!m) return err
  const lines = tagLines(text, m[1]).sort((a, b) => a - b)
  if (lines.length === 0 || lines.length > 3) return err
  const place = lines.length === 1 ? t('bundler.transpile-msg.effet-ligne', { ligne: String(lines[0]) }) : t('bundler.transpile-msg.effet-lignes', { lignes: lines.join(', ') })
  err.message = message.replace(m[0], `[ModularJS] *${m[1]}${place}${m[2]}: `)
  return err
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
    effectDefs: msg.effectDefsWire ? effectDefsFromWire(msg.effectDefsWire) : msg.effectDefs,
    typesText: msg.typesText,
    devWarnings: msg.devWarnings,
    skeleton: msg.skeleton,
    guard: msg.guard,
    typedStores: msg.typedStores,
    models: msg.models,
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
  // déterministe, l'objet est un littéral construit par transpile()). Seuls
  // transitent en plus les petits champs utiles au payload css-only :
  // tagName/aliasTag (clés), baseCss + moduleDisplay (CSS scopé).
  const { baseCss: _bc, ...restData } = result.data
  const restHash = createHash('sha256').update(JSON.stringify(restData)).digest('hex').slice(0, 16)
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
      themeVars:       result.data.themeVars,
      varsRead:        result.data.varsRead,
      themeVariants:   result.data.themeVariants,
      storeTypes:      result.data.storeTypes,
      usesNamedTypes:  result.data.usesNamedTypes,
      // sans lui, un composant qui pose un effet de l'appli ne dépendrait jamais des fichiers
      // *.effects.mjs : un effet modifié en `mjs dev` ne le recompilerait pas
      usesProjectEffects: result.data.usesProjectEffects,
      restHash,
    },
  }
}
