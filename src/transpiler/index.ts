// transpiler/index — orchestrateur du cycle .mjs → JS bundlé.
// Port de la V1 Ruby, transpiler.rb (parse_and_analyze + inject_template).
//
// Pipeline :
//   1. Lit le fichier source .mjs
//   2. Extrait directives racines (@css, @display, @persist, @import)
//   3. Sépare sections : <script module>, <script>, <style>, HTML
//   4. Préprocesse HTML (transmutation auto-fermée, @noajax, etc.)
//   5. Compile script via language adapter → JS standard
//   6. Tokenize ($ sugar) → JS final
//   7. Analyzer AST → state, computed, modifiedCode (auto-derive `_mjs_c`)
//   8. Generator HTML : surgical_html + updates + events + inlines
//   9. Inject template avec toutes les substitutions
//
// Pas de daemon Node externe : tout en process. Pas de minification pour l'instant.
// Pas de CSS Sass intégré pour l'instant — `style.raw` passé brut au template.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

import { compileVars, checkRessorts, type RuleAst } from './var-types.js'
import { MU_HOOKS, MU_LAYOUT_OUT, MU_UNIVERSAL_BODY, MU_INSPECT_ARG_BODY, MU_INSPECT_ARG_OUT, rewriteMuImportAst, ouvreUneRegex, scanRegexLiteral, finExpression } from '../sigils.js'
import { parseVtValue } from '../bundler/config.js'
import { extractDirectives, buildPersistCode } from './directives.js'
import { extractSections, findScriptMatches, findStyleMatches } from './sections.js'
import { jsTemplate, autoloaderLine } from './template.js'
import { compileCss } from './css.js'
import { rewriteStyleVars, wrapThemeBlock, type ThemeVar } from './style-vars.js'
import { processIncludes, processGlobalMacros, newIncludeAccumulator } from './macros.js'
import { lintSplitRune, maskNonCode } from './split-rune.js'
import { analyserConstReassign, findConstReassignment } from './const-reassign.js'
import { tokenize, scanDoubleQuoteAt, scanTemplateAt, convertCoffeeInterpolations } from '../lexer/index.js'
import { compile as compileHtml } from '../generator/index.js'
import type { EventRoute } from '../generator/state.js'
import type { TagRef } from '../parser/index.js'
import { Scanner, extractBalanced, expandLayoutBlocks } from '../parser/index.js'
import { generateCreateFnBody } from '../generator/paths.js'
import { fermerComposantsAutoFermes } from '../generator/compile.js'
import { reecritOuRejetteRuneChemin } from '../generator/utils.js'
import { Analyzer, collectStoreReads } from '../analyzer/index.js'
import { getAdapter, type SupportedLang } from '../languages/index.js'
import { transformReactiveWritesMapped } from '../generator/transform-reactive.js'
import { applyPathTrackingMapped } from '../generator/path-tracker.js'
import { annotateEffectDepsMapped } from '../generator/effect-deps.js'
import { rebindDetachedThisMapped } from '../generator/this-rebinding.js'
import { batchLoopWritesMapped } from '../generator/loop-batch.js'
import { pseudoClashWarnings } from '../effects/pseudo-clash.js'
import { lintReservedSymbolNames } from '../generator/reserved-symbols.js'
import { storeArgsToRawJsLint, inlineHandlerLines } from '../generator/store-args.js'
import { state as generatorState, withState } from '../generator/state.js'
import { setProjectEffects, withProjectEffects, sockAbsent, type ProjectEffect } from '../effects/catalog.js'
import { resolveEffectImages } from './effect-images.js'
import { checkA11y } from './a11y.js'
import { checkUjsForm } from './ujs-form.js'
import { warnUnreachableCode } from './unreachable.js'
import { nomsChangeants } from '../analyzer/derived-reads.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { t, type MsgKey } from '../messages/index.js'
import { maskHtmlComments as masqueCommentairesHtml, readHtmlComment } from '../mask.js'
import { decode, encode } from '@jridgewell/sourcemap-codec'
import { chainSourceMaps, shiftGeneratedPosition, finalizeSourceMap } from './source-map-chain.js'

// ----------------------------------------------------------------------------
// shiftSourceMapLines — décale une carte v3 (JSON stringifié) d'un
// nombre CONSTANT de lignes source, pour retomber sur la vraie ligne du `.mjs`
// (offset = ligne de début du bloc `<script>`/`<script module>`, `sections.ts`).
// `decode`/`encode` travaillent en entiers ABSOLUS (la lib redélimite les deltas
// VLQ elle-même) : ajouter l'offset au champ `sourceLine` de chaque segment suffit.
// ----------------------------------------------------------------------------
export function shiftSourceMapLines(mapJson: string, lineOffset: number, sansPlace = 0): string {
  if (lineOffset === 0 && sansPlace === 0) return mapJson
  const raw = JSON.parse(mapJson)
  const decoded = decode(raw.mappings ?? '')
  // `sansPlace` : premières lignes du texte compilé ajoutées par le compilateur, sans ligne d'origine
  const shifted = decoded.map(line => line.map(seg => seg.length >= 4
    ? (seg[2] < sansPlace ? [seg[0]] : [seg[0], seg[1], seg[2] + lineOffset, seg[3], ...seg.slice(4)]) as typeof seg
    : seg))
  raw.mappings = encode(shifted)
  return JSON.stringify(raw)
}

// remapAdapterErrorLine — un adaptateur de langage qui échoue (Civet confirmé,
// message `<fileName>:<ligne>:<col> …`) rend une position relative au texte COMPILÉ, jamais à la
// ligne 1 du `.mjs` réel — même décalage `startLine - 1` QUE shiftSourceMapLines ci-dessus (succès),
// appliqué ICI au MESSAGE d'erreur. Motif reconnu SEULEMENT : un adaptateur qui ne porte aucune
// position dans son message (ex. Coffee) laisse le message intact.
function remapAdapterErrorLine(err: unknown, fileName: string, startLine: number): Error {
  const original = err instanceof Error ? err : new Error(String(err))
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`${escaped}:(\\d+):(\\d+)`).exec(original.message)
  if (!m) return original
  const realLine = Number(m[1]) + (startLine - 1)
  const message = original.message.replace(m[0], `${fileName}:${realLine}:${m[2]}`)
  return new Error(message, { cause: original })
}

// parseScriptAst — parse PARTAGÉ par detectRouterAware/detectRoutesReassignment/
// detectDuplicateHook ci-dessous (`sourceType: 'script'` accepte top-level `this`, return, etc. —
// adapté au body de classe/fonction qu'est jsInitBase) : PERF, mesuré — les 3 détections tournaient
// chacune leur PROPRE acorn.parse() sur EXACTEMENT le même texte dans le cas courant (aucun bloc
// <routes>, jsInitBase inchangé entre les trois appels, cf. leurs appelants plus bas) — jusqu'à 55 %
// du temps des 3 détections gagnés en microbenchmark (petit script) en ne parsant qu'une fois. `null`
// → parse déjà tenté et a échoué (repli regex direct, aucune re-tentative) ; `undefined` (le
// paramètre `preAst` de chaque fonction, pas ici) → la fonction parse elle-même.
function parseScriptAst(js: string): acorn.Node | null {
  try {
    return acorn.parse(js, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
    })
  } catch {
    return null
  }
}

// ============================================================================
// detectRouterAware : walk AST (insensible aux strings, commentaires, template
// literals) sur `jsInitBase` (script compilé en JS) qui cherche soit :
//   - `this.routes = {...}` (déclarer @routes = vouloir router, même sans
//     hook µurlChange : sinon les <@view> ne s'injectent jamais) ;
//   - `this._mjs_hook('urlChange', fn)`, forme compilée de la rune
//     `µurlChange (path, params) -> …` (cf. lexer §3.8c-pré) — SEULE voie qui
//     pose réellement `_mjs_hooks.urlChange`, consultée par mjs_router.ts
//     (initComponent/navigate).
// La forme V1 (`@onUrlChange = ->` / `this.onUrlChange = ...`, propriété nue
// jamais lue par le routeur) est délibérément absente de cette détection —
// cf. lintOnUrlChangeLegacy pour l'avertissement compile-time qui oriente un
// dev l'écrivant encore vers la rune.
//
// Si le parse échoue (rare — code post-Coffee bien formé), fallback regex.
// `preAst` (optionnel, cf. parseScriptAst) : AST déjà parsé à réutiliser — `undefined` → parse ici,
// `null` → parse déjà tenté et échoué en amont (repli regex direct, mêmes sémantiques qu'avant).
// ============================================================================
function detectRouterAware(jsInitBase: string, preAst?: acorn.Node | null): boolean {
  const ast = preAst !== undefined ? preAst : parseScriptAst(jsInitBase)
  if (!ast) {
    return /\bthis\.routes\b/.test(jsInitBase) || /\b(?:this|_mjsThis)\._mjs_hook\(\s*['"]urlChange['"]/.test(jsInitBase)
  }
  let found = false
  walk.simple(ast, {
    MemberExpression(node: any) {
      // `this.routes = {...}` — accès pointé OU calculé (`this['routes']`), même
      // JS valide, contournait sinon la détection ET la garde `.page.mjs` (voir aussi
      // detectRoutesReassignment plus bas, même piège) :
      // `this[\`routes\`]` (backtick SANS expression, TemplateLiteral et non Literal en AST)
      // contournait encore les deux — même chaîne figée, juste un autre nœud.
      if (
        node.object?.type === 'ThisExpression' &&
        (node.property?.type === 'Identifier' && node.property.name === 'routes' || node.computed === true && node.property?.type === 'Literal' && node.property.value === 'routes' || node.computed === true && node.property?.type === 'TemplateLiteral' && node.property.expressions.length === 0 && node.property.quasis[0]?.value?.cooked === 'routes')
      ) {
        found = true
      }
    },
    CallExpression(node: any) {
      // `_mjsThis._mjs_hook('urlChange', fn)` (la rune `µurlChange`), ou `this._mjs_hook(…)`.
      if (
        node.callee?.type === 'MemberExpression' &&
        (node.callee.object?.type === 'ThisExpression' || node.callee.object?.type === 'Identifier' && node.callee.object.name === '_mjsThis') &&
        node.callee.property?.type === 'Identifier' &&
        node.callee.property.name === '_mjs_hook' &&
        node.arguments?.[0]?.type === 'Literal' &&
        node.arguments[0].value === 'urlChange'
      ) {
        found = true
      }
    },
  })
  return found
}

// ============================================================================
// detectRoutesReassignment : walk AST — vrai si le <script> (compilé, jsInitBase
// AVANT injection du bloc <routes>) RÉASSIGNE `this.routes` (`@routes = …`) —
// une AssignmentExpression dont le membre gauche EST `this.routes` (pas
// `this.routes['x'] = …`/`this.routes.x = …`, mutation légitime de la table posée
// par le bloc <routes>). Même parse acorn (parseScriptAst), même repli regex que
// detectRouterAware. `preAst` : mêmes sémantiques que detectRouterAware ci-dessus.
// ============================================================================
function detectRoutesReassignment(jsInitBase: string, preAst?: acorn.Node | null): boolean {
  const ast = preAst !== undefined ? preAst : parseScriptAst(jsInitBase)
  if (!ast) {
    return /\bthis\.routes\s*=[^=]/.test(jsInitBase)
  }
  let found = false
  walk.simple(ast, {
    AssignmentExpression(node: any) {
      const left = node.left
      // accès pointé OU calculé (`this['routes'] = …`) — même piège que
      // detectRouterAware plus haut. `this[\`routes\`] = …` (backtick sans expression),
      // même correctif que ci-dessus.
      if (
        left?.type === 'MemberExpression' &&
        left.object?.type === 'ThisExpression' &&
        (left.property?.type === 'Identifier' && left.property.name === 'routes' || left.computed === true && left.property?.type === 'Literal' && left.property.value === 'routes' || left.computed === true && left.property?.type === 'TemplateLiteral' && left.property.expressions.length === 0 && left.property.quasis[0]?.value?.cooked === 'routes')
      ) {
        found = true
      }
    },
  })
  return found
}

// ============================================================================
// detectDuplicateHook : compte les émissions `_mjs_hook('<nom>', …)` par nom de
// hook (liste réelle des hooks : MU_HOOKS, sigils.ts) dans le script déjà compilé — rend le PREMIER
// nom vu deux fois, ou null. Motif littéral émis par le compilateur lui-même (pas les runes source
// `µmount`/`µawake`/… : à ce stade, jsInitBase est du JS post-tokenize).
// L'ancien scan TEXTUEL (regex sur jsInitBase, ci-dessus)
// comptait AUSSI une simple CHAÎNE contenant `_mjs_hook('mount', 1)` (ex. message de démo/debug
// dans le <script>) : faux positif, build légitime refusé. Compte désormais par AST — walk.full
// sur les CallExpression dont le callee est `_mjs_hook` (Identifier) ou `<x>._mjs_hook`
// (MemberExpression, propriété `_mjs_hook` — forme réellement émise : `this._mjs_hook('mount', fn)`,
// cf. detectRouterAware plus haut) avec un 1er argument Literal chaîne parmi MU_HOOKS. Mêmes
// `sourceType`/`allowReturnOutsideFunction` que detectRouterAware/detectRoutesReassignment
// ci-dessus (parseScriptAst), sur le MÊME jsInitBase (repli regex identique à l'ancien
// comportement si le parse échoue, rare — jamais de silence total). `preAst` : mêmes
// sémantiques que detectRouterAware ci-dessus.
// Hors compte : les poses ENCHAÎNÉES de <@window>/<@document>/<@body>/<@html>/<@head>
// (processGlobalMacros, macros.ts) — `((_mjs_prevAwake = @_mjs_hooks?.awake) => @_mjs_hook 'awake', …)()`,
// ajoutées APRÈS le <script> : elles reprennent le µawake/µsleep du composant et le rappellent,
// rien n'est écrasé. Les compter refusait tout composant qui écrivait µawake à côté d'un
// <@window>, alors qu'il n'y avait qu'un seul µawake.
// ============================================================================
// nom du paramètre qui garde le hook précédent dans une pose enchaînée (macros.ts)
const chainParamName = (hook: string): string => `_mjs_prev${hook[0].toUpperCase()}${hook.slice(1)}`

function detectDuplicateHook(jsInitBase: string, preAst?: acorn.Node | null): string | null {
  const countFromText = (): string | null => {
    const counts = new Map<string, number>()
    for (const m of jsInitBase.matchAll(new RegExp(`_mjs_hook\\(\\s*'(${MU_HOOKS})'`, 'g'))) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
    for (const [name, n] of counts) {
      const chained = jsInitBase.split(`(${chainParamName(name)} = `).length - 1
      if (n - chained > 1) return name
    }
    return null
  }
  const ast = preAst !== undefined ? preAst : parseScriptAst(jsInitBase)
  if (!ast) {
    return countFromText()
  }
  const hookNames = new Set(MU_HOOKS.split('|'))
  const counts = new Map<string, number>()
  // une pose dans une fonction dont un paramètre s'appelle `_mjs_prev<Hook>` est enchaînée
  const isChained = (hook: string, ancestors: any[]): boolean => ancestors.some((a: any) =>
    (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
    && (a.params ?? []).some((p: any) => (p.type === 'AssignmentPattern' ? p.left : p)?.name === chainParamName(hook)))
  walk.fullAncestor(ast, (node: any, _st: unknown, ancestors: any[]) => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    const isHookCallee = callee?.type === 'Identifier' && callee.name === '_mjs_hook'
      || callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier' && callee.property.name === '_mjs_hook'
    if (!isHookCallee) return
    const arg0 = node.arguments?.[0]
    if (arg0?.type !== 'Literal' || typeof arg0.value !== 'string' || !hookNames.has(arg0.value)) return
    if (isChained(arg0.value, ancestors)) return
    counts.set(arg0.value, (counts.get(arg0.value) ?? 0) + 1)
  })
  for (const [name, n] of counts) if (n > 1) return name
  return null
}

export interface TranspileOpts {
  /** Si non précisé, déduit du fichier source. */
  moduleName?: string
  /** règles nommées des fichiers `*.types.mjs` du projet (bundler, compileTypesFiles) : un nom cité
   *  dans le `<vars>` du composant est remplacé par sa définition, au build. */
  typeDefs?: Record<string, RuleAst>
  /** effets des fichiers `*.effects.mjs` du projet (bundler, compileEffectsFiles) : un effet réglé
   *  se résout à la compilation, un effet CSS part avec le composant qui le pose. */
  effectDefs?: Record<string, ProjectEffect>
  /** texte de chaque règle dans le code émis, pour les messages de développement — `false` en
   *  production (défaut `true`). */
  typesText?: boolean
  /** avertissements du développement dans le code émis : une attache (`@attach`) qui rend autre chose qu'une fonction, une prop
   *  à sens unique que l'enfant écrit lui-même (mjs_debug.ts les dit) — `true` en développement seulement (défaut `false`) :
   *  le code de production n'en porte rien. */
  devWarnings?: boolean
  /** les chargements qui montrent un squelette d'eux-mêmes (`effects.skeleton` de mjs.config.json ;
   *  défaut `['await']`) — ici, `await` : un {await} sans branche d'attente */
  skeleton?: string[]
  /** *guard d'office sur un champ lié à une variable typée (`effects.guard` de mjs.config.json ;
   *  défaut `true`, `false` : gardé sans effet ni bulle ; `{ delay }` : la pause, lue au runtime) */
  guard?: boolean | { delay?: number | string }
  /** les stores typés dans le `<vars>` d'un composant du projet (bundler) : un champ lié à l'un d'eux
   *  reçoit *guard d'office, même quand la règle est posée par un autre composant */
  typedStores?: string[]
  /** les modèles en fichier des composants (`carte.compacte.mjs`), cf. ParseDiag.models */
  models?: { dev?: Record<string, string[]>, core?: Record<string, string[]> }
  /** Langage par défaut pour <script> sans `lang=`. */
  defaultScriptLang?: SupportedLang
  /**
   * Grammaire des handlers inline (`@click={…}`) ET, à terme, des
   * interpolations `{…}` du template.
   * Défaut `'civet'` (appliqué ICI, dans `transpile()`, pas dans
   * `mjs.config.json`) ; `'js'` = repli comportement historique (handlers
   * compilés en CoffeeScript brut, comme avant).
   * Handlers inline : CONSOMMÉ (cf. "11. JS init" plus bas + `state.templateLang`
   * côté generator/attributes/index.ts, seul point de divergence d'émission).
   * Interpolations `{…}` du template : ENCORE INUTILISÉ.
   */
  templateLang?: 'civet' | 'js'
  /** Vars `$xxx` externes (ex: importées) à exclure du store local. */
  externalVars?: string[]
  /** Répertoire d'injection (chemin de sortie pour `_mjs_dir`). */
  dirInject?: string
  /** Répertoire du fichier source — utilisé pour résoudre `<@include partial>`. */
  baseDir?: string
  /**
   * Racine du tree source (`mjs.config.json` `sourceDir`). Permet à
   * `<@include name>` de fallback sur `<sourceDir>/shared/_<name>.mjs` si
   * le partial n'existe pas localement.
   */
  sourceDir?: string
  /**
   * Résout UN asset logique en chemin web. Si fourni, transpile remplacera
   * `µasset('foo')` / `µ.asset('foo')` par le path résolu AVANT compilation
   * langage — Coffee/Civet/TS ne voient jamais l'appel, juste un literal.
   */
  resolveAsset?: (logicalPath: string) => Promise<string>
  /** `µimage('x'[, largeurs])` déjà résolu côté master : le TEXTE EXACT de
   *  l'appel → l'objet JSON. Le worker n'a pas le disque, et il faut lire l'en-tête du
   *  fichier pour ses dimensions natives. Substitué APRÈS l'inlining des `<@include>`,
   *  au même endroit que `µasset` — un `µimage` qui ne vit que dans un partial est donc
   *  traité comme les autres. */
  preResolvedImages?: Record<string, string>
  /**
   * Tag custom-element alias additionnel à enregistrer (ex: `mjs-snippets-card`
   * en plus du tag principal `mjs-tuto-snippets-card`). Permet aux components
   * d'être référencés sans le préfixe parent dir.
   */
  aliasTag?: string
  /**
   * Sigil d'API tapé par le dev : `'µ'` (défaut) ou `'mjs'` (fallback ASCII
   * clavier non-AZERTY). En `'mjs'`, `mjs.X`/`mjs$X`/`mjs$$X` sont normalisés en
   * `µ.X`/`µ$X`/`µ$$X` avant tout le reste. Le séparateur (`.`/`$`) est
   * obligatoire — pas de forme courte collée.
   */
  sigil?: 'µ' | 'mjs'
  /**
   * Alias ASCII pour les sigils contexte/partagé (clavier sans `§`). Opt-in,
   * `false` par défaut. Quand `true` : `__context.X` → `§X` (contexte) et
   * `__shared.X` → `§§X` (partagé global), normalisés AVANT tout le reste.
   * `§`/`§§` restent les formes canoniques. (Le store, lui, s'écrit déjà en
   * ASCII : `$$X`/`µ$$X` — pas besoin d'alias mot.)
   */
  contextAlias?: boolean
  /**
   * Lint « trop de variables d'état » : au-delà de N `$x` distinctes dans UN
   * composant, un AVERTISSEMENT de compilation (jamais bloquant) oriente vers
   * le découpage en sous-composants. `0` désactive. Défaut : 40.
   */
  maxStateVars?: number
  /**
   * Lint d'accessibilité (a11y) — sept contrôles ciblés (image sans alt, iframe
   * sans title, tabindex positif, @click non interactif, bouton/lien sans nom
   * accessible, champ de saisie sans étiquette), cf. transpiler/a11y.ts. Simple
   * AVERTISSEMENT de compilation, jamais bloquant. Défaut : `true` (activé) ;
   * `false` désactive tout le contrôle (`lint.a11y` dans `mjs.config.json`).
   */
  a11y?: boolean
  /**
   * Lint « <form> sans action ni méthode » (ujsForm) — le pont UJS (cf.
   * src/runtime/mjs_ujs.ts, µ._mjs_ujsShadowAttach) intercepte TOUT <form>, même
   * sans rien à envoyer ; avertit quand ni action, ni @method/mjs-method, ni
   * @noUJS ne sont posés, cf. transpiler/ujs-form.ts. Simple AVERTISSEMENT de
   * compilation, jamais bloquant. Défaut : `true` (activé) ; `false` désactive
   * tout le contrôle (`lint.ujsForm` dans `mjs.config.json`).
   */
  ujsForm?: boolean
  /**
   * Coupe individuellement les DEUX autres types d'avertissement que ce fichier émet — `include`
   * (`<@include>` sans baseDir) et `routes` (`@routes` qui réassigne un bloc `<routes>`) —
   * cf. src/diagnostics.ts pour la table complète des types et leur gravité. `a11y`/
   * `maxStateVars`/`ujsForm` ci-dessus restent gérés par leur PROPRE champ, jamais par ce bag.
   */
  lint?: LintToggles
  /**
   * Le terminal accepte-t-il la couleur, calculé UNE FOIS par le thread principal
   * (`resolveColorsEnabled`, src/diagnostics.ts) puis transmis ici : un thread de travail
   * n'est jamais un terminal, il ne redétermine jamais ça lui-même. Défaut `false` — un
   * appelant isolé de `transpile()` (test, outillage) n'a pas besoin de couleur.
   */
  colorsEnabled?: boolean
  /**
   * Préfixe des variables de thème : `$$brand` (dans un `<style>` ou un `<theme>`)
   * compile en `var(--<varPrefix>-brand)`. Défaut `'mjs'`, réglable dans
   * `mjs.config.json`. UN SEUL préfixe pour tout le monde — jamais de préfixe
   * dérivé du nom du module (ce qui est déclaré
   * cascade dans toute la descendance et reste surchargeable, comme en CSS).
   */
  varPrefix?: string
  /**
   * `true`/`false` = le fichier compilé se nomme
   * (ou pas) `<nom>.page.mjs`, déduit par le BUNDLER du VRAI nom de fichier (jamais
   * reconstruit ici : `TranspileOpts` n'a pas de champ nom de fichier, cf. `moduleName`
   * déjà amputé de `.mjs`/`.page`). `false` ACTIVE la garde : un module qui porte un
   * bloc `<routes>`, la directive `@routes` ou une balise `<@view>` devient un refus de
   * compilation. `undefined` (transpile()/transpileFile() appelés directement — tests,
   * outillage) laisse la garde INACTIVE : aucune régression pour un appelant qui ignore
   * cette option.
   */
  isPageModule?: boolean
}

// ----------------------------------------------------------------------------
// normalizeContextAlias — réécrit les alias ASCII contexte/partagé en `§`/`§§`.
// `__shared.foo` → `§§foo`, `__context.foo` → `§foo` (get ET set, car les deux
// commencent par `§foo`). Reconnu en accès propriété, précédé d'une frontière
// de mot (`foo__context` n'est jamais touché). Opt-in (off par défaut).
// ----------------------------------------------------------------------------
export function normalizeContextAlias(src: string, enabled?: boolean): string {
  if (!src || !enabled) return src
  return src
    .replace(/(?<![\w$])__shared\.([a-zA-Z_]\w*)/g, '§§$1')
    .replace(/(?<![\w$])__context\.([a-zA-Z_]\w*)/g, '§$1')
}

// ----------------------------------------------------------------------------
// normalizeSigilAlias — réécrit l'alias ASCII du sigil (`mjs`) en `µ`.
//
// Reconnu UNIQUEMENT suivi d'un séparateur de sigil (`.`, `$`) et précédé
// d'une frontière de mot : `mjs.effect` → `µ.effect`, `mjs$count` → `µ$count`,
// `mjs$$store` → `µ$$store`. Jamais collé à une lettre, donc `mjsonp`/`formjs`
// etc. ne sont JAMAIS touchés. `µ` reste le sigil canonique interne.
// ----------------------------------------------------------------------------
const SIGIL_ALIASES: Record<string, RegExp> = {
  mjs: /(?<![\w$])mjs(?=[.$])/g,
}
export function normalizeSigilAlias(src: string, sigil?: string): string {
  if (!src || !sigil || sigil === 'µ') return src
  const re = SIGIL_ALIASES[sigil]
  return re ? src.replace(re, 'µ') : src
}

// L'alias s'écrit pour `µ` dans le CODE seul, jamais dans ce qui s'affiche ou se lit tel quel : avant, `mjs.dev`
// devenait `µ.dev` dans le texte, les liens, `<pre>`, les chaînes du script, et `.mjs.actif` devenait `.µ.actif`
// dans la feuille de style (règle perdue).

// le code (script, expression `{…}`, ligne `@import`) : alias hors chaînes, commentaires et regex, l'intérieur des
// interpolations compris (vue maskNonCode, même longueur)
export function sigilAliasCode(src: string, sigil: string, lang = 'civet'): string {
  const re = SIGIL_ALIASES[sigil]
  if (!re || !src.includes(sigil)) return src
  const vue = maskNonCode(src, lang)
  return src.replace(re, (m: string, pos: number) => vue.startsWith(m, pos) ? 'µ' : m)
}

// un appel d'asset ou d'image écrit en clair dans un attribut (`<img src="mjs.asset('x.png')">`) : la résolution des
// assets le cherche dans tout le HTML, il garde l'alias
const ALIAS_APPEL_EN_CLAIR_RE = /(?<![\w$])mjs(?=\.(?:asset|image)\s*\()/g

// le HTML et les directives : alias dans les expressions `{…}` et les lignes `@import` ; le texte, les attributs,
// `<pre>`, les commentaires HTML restent tels qu'écrits
function sigilAliasHtml(html: string, sigil: string): string {
  if (!SIGIL_ALIASES[sigil] || !html.includes(sigil)) return html
  let out   = ''
  let texte = ''
  const vider = () => { if (texte) { out += texte.replace(ALIAS_APPEL_EN_CLAIR_RE, 'µ'); texte = '' } }
  const n = html.length
  // accolades sans fin rendues par finExpression : relire depuis l'une d'elles ne se refermerait pas davantage (même mémoire que
  // scanTagClose : un gabarit aux accolades non refermées coûtait un temps quadratique)
  const sansFin = new Set<number>()
  let i = 0
  while (i < n) {
    if ((i === 0 || html[i - 1] === '\n') && /^[ \t]*@import\b/.test(html.slice(i, i + 40))) {
      vider()
      const nl  = html.indexOf('\n', i)
      const fin = nl < 0 ? n : nl + 1
      out += sigilAliasCode(html.slice(i, fin), sigil)
      i = fin
      continue
    }
    if (html.startsWith('<!--', i)) {
      const commentaire = readHtmlComment(html, i)
      if (commentaire !== null) {
        vider()
        out += html.slice(i, commentaire.end)
        i = commentaire.end
        continue
      }
    }
    if (html[i] === '{' && !sansFin.has(i)) {
      const fin = finExpression(html, i, sansFin)
      if (fin > 0) {
        vider()
        out += sigilAliasCode(html.slice(i, fin), sigil)
        i = fin
        continue
      }
    }
    texte += html[i]
    i++
  }
  vider()
  return out
}

// la source entière : chaque <script> par sigilAliasCode, le HTML et les directives par sigilAliasHtml ; <style> et
// <theme> (`.mjs.actif` y est un sélecteur) et <vars> (une règle n'a pas de rune : `'mjs.fr'` ne devient pas
// `'µ.fr'`) tels qu'écrits. Sections trouvées comme extractSections et extractDirectives les trouvent
function sigilAliasOutsideVars(src: string, sigil?: string, langParDefaut = 'civet'): string {
  if (!src || !sigil || sigil === 'µ' || !SIGIL_ALIASES[sigil] || !src.includes(sigil)) return src
  const zones: Array<{ debut: number; fin: number; lang: string | null }> = []
  const { moduleScripts, scripts } = findScriptMatches(src)
  for (const m of [...moduleScripts, ...scripts]) {
    const idx   = m.indices!
    const corps = idx[idx.length - 1]
    const attrs = src.slice(idx[0][0], corps[0])
    zones.push({ debut: corps[0], fin: corps[1], lang: /lang[ \t]*=[ \t]*['"]([^'"]+)['"]/.exec(attrs)?.[1] ?? langParDefaut })
  }
  const styles = findStyleMatches(src, [...moduleScripts, ...scripts])
  for (const m of styles.matches) zones.push({ debut: m.indices![0][0], fin: m.indices![0][1], lang: null })
  for (const m of styles.maskedView.matchAll(/^[ \t]*<theme\b[^>]*>[\s\S]*?<\/theme>/gmd)) zones.push({ debut: m.indices![0][0], fin: m.indices![0][1], lang: null })
  for (const m of src.matchAll(/^[ \t]*<vars\b[^>]*>[\s\S]*?<\/vars>/gmd)) zones.push({ debut: m.indices![0][0], fin: m.indices![0][1], lang: null })
  zones.sort((a, b) => a.debut - b.debut)
  let out  = ''
  let last = 0
  for (const z of zones) {
    if (z.debut < last) continue
    out += sigilAliasHtml(src.slice(last, z.debut), sigil)
    out += z.lang === null ? src.slice(z.debut, z.fin) : sigilAliasCode(src.slice(z.debut, z.fin), sigil, z.lang)
    last = z.fin
  }
  return out + sigilAliasHtml(src.slice(last), sigil)
}

export interface TranspileData {
  /** carte de source v3 (JSON stringifié) du `<script>` composant, déjà
   * décalée sur la vraie ligne du `.mjs`. `undefined` si le compilateur du langage choisi
   * n'en produit pas, ou si la section est vide. Couvre seulement la compilation langage
   * — pas les 5 passes de génération qui suivent. */
  scriptSourceMap?: string
  /** Idem pour `<script module>`. */
  moduleSourceMap?: string
  moduleName: string
  className: string
  tagName: string
  /** Registre de présence des state vars (`_mjs_var_bits = { x: 1, y: 1 }`).
   * V2 : ce n'est plus un bitmask mais juste un dict de présence — conservé
   * pour rétrocompat avec les stores universels qui font `_mjs_var_bits[k] !== undefined`. */
  varBitsStr: string
  /** Closure transitive des deps des computeds (`_mjs_computedDeps = { "c": ["a","b"] }`).
   * Entrées non vides seulement — consommée par µ.effect (mjs_runes.ts) pour étendre
   * staticVars aux RACINES d'un computed chaîné. */
  computedDepsStr: string
  passiveEvents: string[]
  /** HTML final compilé (avec marqueurs mjs) — observable de débogage/test.
   *  (Le walk legacy extractPaths qui produisait l'ancienne variante a été
   *  retiré ; ce champ expose désormais directement le HTML à marqueurs.) */
  surgicalHtml: string
  /** Paths positionnels sérialisés (V2 legacy, conservé pour tests).
   * Format JS littéral : `{ "id": ["t"|"h"|"e", ...indices], ... }`. */
  /** Body JS de la fonction `__create_X()`. Construit le DOM impérativement
   * et retourne `{ fragment, refs }` où `refs` = pointeurs directs aux nodes. */
  createFnBody: string
  // Valeur : id numérique simple, [id, flags] (modificateurs .once/.propagate…),
  // ou LISTE de [id, flags] quand plusieurs handlers partagent le couple
  // (événement, nœud) — liaison two-way + directive `@événement`.
  events: Record<string, Record<string, EventRoute>>
  structUpdates: string[]
  transUpdates: string[]
  /** Code source des effets indexés par varName : `{ var: '[() => { ... }, ...]' }`.
   * Sera émis comme `_mjsThis._mjs_effectsByVar = { ... }`. */
  effectsByVarStr: string
  /** Liste de tous les effects en un seul tableau JS : `[() => {...}, ...]`.
   * Sera émis comme `_mjsThis._mjs_effectsAll = [...]` et exécuté au mount initial. */
  effectsAllStr: string
  /** liaisons two-way vers un composant enfant (root), rejouées
   * SYNCHRONEMENT dans `init()` juste après `_mjs_effectsAll`, avant tout
   * connectedCallback — cf. state.initialPropBinds. Code brut joint (chaque
   * entrée est déjà un bloc `{ ... }` complet). */
  initialPropBindsStr: string
  /** Vars qui pilotent les blocs structurels. Émise comme un object
   * `{ "var1": 1, "var2": 1, ... }` pour lookup O(1) côté runtime.
   * Si vide ET pas de struct → `_mjs_renderStruct` n'est jamais ré-appelé hors mount. */
  structVarsStr: string
  /** Statisation $$ — ligne `_mjsThis._mjs_storeKeys = [...]` (clés NUES du
   * store universel mentionnées par ce composant, + '*' si structurel) ;
   * chaîne VIDE si le composant ne touche pas au store (pas de subscription). */
  storeKeysLine: string
  /** Statisation $$ — ligne module-level `µ._storeDeclare([...])`, exécutée
   * UNE fois au chargement (pas par instance) ; chaîne VIDE si aucune clé $$. */
  storeDeclareLine: string
  /** types — lignes module-level collées après `storeDeclareLine` : la table des règles des
   *  variables et props (`const _mjs_T_<Classe> = {…};`) et celle des stores
   *  (`µ._mjs_storeTypes({…});`) ; chaîne VIDE sans bloc `<vars>` (sortie inchangée). */
  typesDecl: string
  /** types — ligne d'instance collée après `stateMethodClashLine` : `this._mjs_types = …;`,
   *  posée avant le script (la valeur de départ passe la règle) ; chaîne VIDE sinon. */
  typesLine: string
  /** types — texte canonique de la règle de chaque store déclaré dans le `<vars>` : le build
   *  refuse deux règles différentes pour le même store. */
  storeTypes: Record<string, string>
  /** types — le `<vars>` cite une règle nommée : le composant dépend des fichiers `*.types.mjs`. */
  usesNamedTypes: boolean
  /** le composant pose un effet de l'appli : il dépend des fichiers `*.effects.mjs`. */
  usesProjectEffects: boolean
  /** collision état/méthode homonymes : ligne d'instance collée en fin
   * de `this._mjs_var_bits = […];` (jamais de retour à la ligne avant), qui liste
   * les noms `$x`/`@x` homonymes pour que le runtime épargne la MÉTHODE au
   * salvage pré-upgrade (mjs_element.ts) ; chaîne VIDE si aucune collision. */
  stateMethodClashLine: string
  /** i18n — ligne d'instance `_mjsThis._mjs_i18n = [section, mode];` (émise
   *  seulement si @i18n OU le JS final contient `µ.t(`) ; chaîne VIDE sinon
   *  (zéro coût pour les modules sans i18n). Un module à plusieurs sections
   *  (`@i18n 'a' 'b'`) y ajoute un 3e élément, la liste des sections en plus. */
  i18nLine: string
  jsModule: string
  jsInitBase: string
  baseCss: string
  /** variables de thème DÉCLARÉES par les blocs `<theme>` du composant (registre du build). */
  themeVars: ThemeVar[]
  /** variables de thème LUES (`$$x`) dans le `<style>` et les `<theme>` — sert à repérer une faute de frappe. */
  varsRead: string[]
  /** Noms des variantes déclarées (`<theme name="gold">`) — active `theme="gold"` sur l'instance. */
  themeVariants: string[]
  /** CSS de chaque déclinaison (`<style name="bandeau">`), par nom — écrit en fichier frère par le build. */
  layoutCss: Record<string, string>
  /** le composant lit µlayout : sa prop `layout` choisit aussi le style nommé (cf. mjs_element.ts, `_set`) */
  layoutRune?: boolean
  sharedCssNames: string[]
  moduleDisplay: string
  modulePreload: string | null
  /** `@formAssociated` (cf. directives.ts) : la ligne du socle du formulaire avant l'enregistrement de la balise. */
  moduleFormAssociated?: boolean
  moduleViewTransition: string | null
  moduleViewTransitionPriority: number
  hasDynamicSlots: boolean
  /** Animations détectées dans `@transition.X / @in.X / @out.X`. */
  usedAnimations: string[]
  /** `true` si le composant déclare AU MOINS un `@transition/@in/@out/@attach/@this=!/@flip`.
   * Si `false`, `_mjs_destroyNodeAndChildren` bypass le walk DFS (gain replace1k / clear1k). */
  hasDestroyHooks: boolean
  /** `true` si le composant déclare AU MOINS un `@flip` → pose `static
   * _mjs_hasFlip = true`, qui ACTIVE le wrapper FLIP de `_mjs_reconcileList`.
   * Sans ce flag, `@flip` était inerte (bug : `_has_flip` jamais posé). */
  hasFlip: boolean
  /** Chemins absolus des partials inlinés via `<@include …>`. Le bundler s'en
   * sert pour reverse-mapper "partial → parents" et déclencher la recompile
   * des parents quand le partial change. */
  includedPartials: string[]
  /** diagnostics de `processIncludes`
   * (partial introuvable, <@include> circulaire) : avant, uniquement un
   * `console.error` DANS LE WORKER, jamais remonté dans `stats.errors` du
   * bundler (build vert malgré un composant réellement incomplet). Le
   * bundler pousse chaque entrée dans `stats.errors`. */
  macroErrors: string[]
  /** Références `<@nom>`/`<mjs-nom>`/`<mjs-core-nom>` (notation
   * unique, `<@mjs-nom>` est une erreur de migration) collectées par le
   * parseur (resolveTagName, parser/index.ts) ; le bundler les résout par
   * file APRÈS le manifeste complet (post-passe de compile()) — jamais
   * résolues ici, un seul fichier ne connaît pas les autres. */
  tagRefs: TagRef[]
  /** un composant/partial
   * avec un 2e `<script>` (hors `module`) ou un 2e `<style>` voyait ce
   * contenu SILENCIEUSEMENT jeté (`extractSections` ne gardait que le
   * PREMIER de chaque, sans le moindre signal) — perte de code identique au
   * motif dominant (build vert malgré un composant incomplet). */
  sectionWarnings: string[]
  /** Tag alias additionnel (ex `mjs-snippets-card` pour file `tuto-snippets-card.mjs`). */
  aliasTag?: string
  /** Dépendances DIRECTES de balises du gabarit (cf. collectDirectComponentDeps,
   * generator/compile.ts) — noms bruts, pas encore résolus contre le manifeste. */
  componentDeps: string[]
}

// ----------------------------------------------------------------------------
// replaceMagicAssets — remplace `µasset('X')` / `µ.asset('X')` par un string
// literal du path web résolu, AVANT compilation langage. Le compilateur ne
// voit donc qu'un literal, pas un appel de fonction inconnu.
// `lang` fourni (<script>/<script module>) : ne résout la forme NUE (sans guillemet collé) que si
// elle tombe sur du texte encore VISIBLE sur la vue masquée (maskNonCode, MÊME longueur) — un
// `µasset(...)` simplement CITÉ dans une chaîne/un commentaire (exemple de log affiché) est, lui,
// blanchi avec le reste de sa chaîne englobante, donc jamais retrouvé. La forme AUTO-QUOTÉE
// (guillemet collé des deux côtés, `"µasset('x')"`) reste résolue SANS cette garde — c'est la
// forme émise par le compilateur lui-même pour `@import` (spécificateur ES, forcément une chaîne),
// une vraie chaîne de bout en bout, jamais autrement retrouvable sur la vue masquée (le guillemet
// adjacent, lui aussi, y est blanchi). `lang` absent (HTML) : un exemple de doc `<pre>/<code>`
// montrant `µasset('...')` en TEXTE n'est pas un vrai appel — masqué en BLOC (maskDocBlocks,
// stash+restore, même outil que preprocessHtml), le reste du HTML (attribut direct compris, ex.
// `<img src="µasset('x.png')">`) continue de tourner normalement.
// ----------------------------------------------------------------------------
const ASSET_CALL_RE = /(['"]?)(?:µasset|µ\.asset)\(['"](.+?)['"]\)\1/g

async function applyAssetReplacements(
  text: string,
  matches: RegExpMatchArray[],
  resolveAsset: (path: string) => Promise<string>
): Promise<string> {
  if (matches.length === 0) return text
  const replacements = await Promise.all(matches.map(async (m) => {
    const [full, quote, logicalPath] = m
    const webPath = await resolveAsset(logicalPath)
    const to = quote ? `${quote}${webPath}${quote}` : `'${webPath}'`
    return { from: full, to }
  }))
  let out = text
  // chaque appel retenu remplacé À SA PLACE, du dernier au premier (les positions d'avant restent justes) : un
  // `.replace(texte)` visait la PREMIÈRE occurrence du texte — le même appel cité plus haut dans un commentaire ou une
  // chaîne recevait l'adresse, l'appel réel restait non résolu. `to` est inséré tel quel (un `$` du chemin ne compte pas)
  for (let k = matches.length - 1; k >= 0; k--) {
    const at = matches[k].index!
    out = out.slice(0, at) + replacements[k].to + out.slice(at + replacements[k].from.length)
  }
  return out
}

// les feuilles de style du composant : même remplacement que le HTML, sans le masquage des blocs de doc (`<pre>` et `<code>` n'existent pas
// en CSS) et avec les alias ASCII (`mjs.asset`), que l'alias de sigil ne réécrit pas dans un style — en SASS le `.` préfixe une classe
const STYLE_ASSET_CALL_RE = /(['"]?)(?:µasset|µ\.asset|mjsasset|mjs\.asset)\(['"](.+?)['"]\)\1/g

async function replaceStyleAssets(text: string, resolveAsset: (path: string) => Promise<string>): Promise<string> {
  return applyAssetReplacements(text, [...text.matchAll(STYLE_ASSET_CALL_RE)], resolveAsset)
}

async function replaceMagicAssets(
  text: string,
  resolveAsset: (path: string) => Promise<string>,
  lang?: string
): Promise<string> {
  if (lang === undefined) {
    const { masked, restore } = maskDocBlocks(text)
    return restore(await applyAssetReplacements(masked, [...masked.matchAll(ASSET_CALL_RE)], resolveAsset))
  }

  // Forme AUTO-QUOTÉE (guillemet COLLÉ des deux côtés, `"µasset('x')"`, `group1` non vide) :
  // TOUJOURS résolue, sans garde — c'est la forme émise par le compilateur lui-même pour
  // `@import` (spécificateur ES obligatoirement une chaîne, cf. dir.pendingAutoImports plus
  // bas) : une vraie chaîne de A à Z, indiscernable d'un exemple de doc SAUF par cette adjacence
  // stricte, et de toute façon jamais retrouvable sur la vue masquée (maskNonCode blanchit le
  // guillemet adjacent tout autant que le reste d'une chaîne). Forme NUE (`group1` vide) : ne
  // résoudre que si sa position tombe sur du texte encore VISIBLE sur la vue masquée — sinon
  // c'est une simple mention à l'intérieur d'une AUTRE chaîne/un commentaire.
  const masked = maskNonCode(text, lang)
  const matches: RegExpMatchArray[] = []
  for (const m of text.matchAll(ASSET_CALL_RE)) {
    if (m[1] || masked.slice(m.index!, m.index! + m[0].length).trim() !== '') matches.push(m)
  }
  return applyAssetReplacements(text, matches, resolveAsset)
}

// ----------------------------------------------------------------------------
// replaceMagicImages — remplace `µimage('X'[, 480, 960])` par le littéral OBJET
// résolu au build (`{"src":"…","srcset":"…","width":1920,"height":800}`). Le
// compilateur ne voit donc qu'un objet, jamais un appel de fonction inconnu.
// Indexé par le TEXTE EXACT de l'appel : deux appels au même fichier avec des
// largeurs différentes sont deux entrées distinctes.
// ----------------------------------------------------------------------------
function replaceMagicImages(text: string, images?: Record<string, string>): string {
  if (!images) return text
  let out = text
  for (const [appel, json] of Object.entries(images)) out = out.split(appel).join(json)
  return out
}

// ----------------------------------------------------------------------------
// applyMjsSugarToScript — préprocessing du script avant compilation langage.
// Reproduit les transformations CoffeeScript de transpiler.rb (µ. routing,
// runes µ$, µ.inspect). Appliquées sur la source brute (Coffee/Civet/TS/JS).
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// lintSingletonConsume — un singleton importé (`@import µ$$X`) se consomme
// UNIQUEMENT en `µ$$X`. Toute lecture `$X` / `$$X` / `§§X` dans le code SOURCE du
// dev est une faute → erreur de compilation explicite (`§§X` est le piège de
// migration nº1 : un vieux fichier à moitié migré doit CLAQUER, pas retomber
// en silence sur le contexte d'ancêtres — `§§X` désigne TOUJOURS ce contexte,
// plus jamais un singleton). Fait sur le SOURCE BRUT (et non dans les passes
// de transfo) car `$X` est AUSSI la forme compilée légitime du singleton (le
// routage `µ$$X`→`$X`, l'`import { $X }`) — l'y détecter donnerait des faux
// positifs (double-passe analyzer `cleanJs∘tokenize`).
// `@import §§X` (ancienne écriture) est lui-même flaggé EN PREMIER, avant
// toute autre vérification — un singleton s'importe désormais en `µ$$X`,
// jamais en `§§X` (réservé au contexte d'ancêtres).
// ----------------------------------------------------------------------------
// le masquage ne couvrait
// QUE le HTML (`<pre>`/`<code>`/`<!-- -->`) : une CHAÎNE littérale (message
// d'erreur/log qui mentionne "$X" en exemple) ou un COMMENTAIRE de script
// (`// …`, `# …`, `/* … */`, `### … ###` Coffee) qui documente la migration
// (« ancien : $user, nouveau : µ$$user ») étaient scannés comme du VRAI code —
// une simple explication en commentaire ou un message de log faisait échouer
// la compilation d'un projet par ailleurs correct. Fix : même technique de
// masquage « par alternation » que compile.ts — les motifs de chaînes/
// commentaires sont posés EN PREMIER dans l'alternation, l'un d'eux consomme
// tout le bloc (chaîne entière ou commentaire jusqu'à sa fin) avant que le nom
// du singleton ne puisse y être testé. `###…###` AVANT le `#…` générique
// (sinon le `#` générique, essayé en premier dans l'ordre naturel du texte,
// ne consommerait qu'UNE ligne du bloc Coffee multi-ligne). Remplacement par
// des espaces (pas une suppression) : préserve les positions et évite de
// recoller accidentellement deux fragments en un nouveau motif involontaire.
const MASK_STRINGS_AND_COMMENTS_RE =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|###[\s\S]*?###|\/\/[^\n]*|#[^\n]*/g

// Retourne les noms importés (`singletonImports`) — réutilisés par la
// pré-passe 0-bis de `transpile()` juste en dessous (µ$$X → $X), pour ne pas
// rescanner deux fois les mêmes lignes `@import`.
export function lintSingletonConsume(source: string): Set<string> {
  // « @import §§NOM » (ancienne écriture) : un singleton s'importe désormais
  // en `µ$$NOM` — erreur de migration immédiate, AVANT toute réécriture (la
  // pré-passe 0-bis n'a pas encore tourné). Masque `<pre>`/`<code>` d'abord :
  // un tuto qui AFFICHE `@import §§X` comme exemple ne doit pas throw.
  const docless = source
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '')
  for (const line of docless.match(/^[ \t]*@import\b[^\n]*$/gm) ?? []) {
    const bad = line.match(/§§([a-zA-Z0-9_]+)/)
    if (bad) {
      throw new Error(t('transpiler.import-singleton-ancienne-forme', { nom: bad[1] }))
    }
  }

  const singletonImports = new Set<string>()
  source.replace(/^[ \t]*@import\b[^\n]*$/gm, (line: string) => {
    for (const mm of line.matchAll(/µ\$\$([a-zA-Z0-9_]+)/g)) singletonImports.add(mm[1])
    return line
  })
  if (singletonImports.size === 0) return singletonImports
  // Masque ce qui n'est PAS une consommation réelle : lignes @import (l'import
  // lui-même), blocs de doc `<pre>`/`<code>`, commentaires HTML, chaînes
  // littérales et commentaires de script (cf. plus haut).
  const scan = source
    .replace(/^[ \t]*@import\b[^\n]*$/gm, '')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '')
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '')
    .replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => ' '.repeat(m.length))
  for (const name of singletonImports) {
    // Interdits : `$NOM` (bare), `$$NOM` (store global) — jamais `µ$$NOM`
    // (désormais la forme CORRECTE, exclue via le lookbehind `(?<!µ)`) — et
    // `§§NOM` (piège de migration nº1, cf. header).
    const re = new RegExp(
      `(?<!µ)(?<![\\w§$])\\$\\$${name}(?![\\w])` +
      `|(?<![\\w§$])\\$${name}(?![\\w])` +
      `|(?<![\\w.§])§§${name}(?![\\w])`
    )
    if (re.test(scan)) {
      throw new Error(t('transpiler.singleton-mauvaise-consommation', { nom: name }))
    }
  }
  return singletonImports
}

// ----------------------------------------------------------------------------
// lintImportDollarName — un NOM importé ne porte jamais `$` seul : un singleton s'importe et
// se consomme UNIQUEMENT par `µ$$X` (docs/14-stores.md
// § « Un seul symbole, un seul rôle »), jamais `@import $X`. DOIT tourner ICI, AVANT la pré-passe
// 0-bis (µ$$X → $X, juste en dessous) : sur le source déjà aplati par 0-bis, un `$counter` issu de
// `µ$$counter` serait indiscernable d'un `$counter` tapé à la main (la garde
// avait alors été revertée faute de cette place — remise ici). Blocs de doc (`<pre>`/`<code>`/
// commentaires HTML) masqués via maskDocBlocks : un tuto qui AFFICHE `@import $x` en exemple ne
// doit jamais throw.
// ----------------------------------------------------------------------------
export function lintImportDollarName(source: string): void {
  const { masked } = maskDocBlocks(source)
  const bad = masked.match(/^[ \t]*@import\s+(?:default\s+)?[^'"]*?(?<![µ$])(\$[a-zA-Z_]\w*)/m)
  if (!bad) return
  const nom = bad[1]
  throw new Error(t('transpiler.import-nom-dollar', { nom, base: nom.slice(1) }))
}

// ----------------------------------------------------------------------------
// lintEffectTopLevel — µeffect/µinspect (formes pointées µ.effect/µ.inspect
// comprises) ne sont valides qu'au TOP-LEVEL du <script> d'un composant :
// l'enregistrement runtime exige `µ.activeComponent` (mjs_runes.ts), posé
// pendant l'init (jsInit) et les batchs de render — un appel depuis un
// handler/@méthode/setTimeout arrive HORS de ces fenêtres → `µ.warn` + effet
// IGNORÉ en silence. Pire dans un hook : `µmount` est invoqué tantôt dans le
// batch microtask (activeComponent posé, mjs_element.ts ~1931), tantôt dans le
// fast-path sync (PAS posé, ~1812) — l'effet s'enregistre ou se perd selon
// le CHEMIN de rendu. On tranche à la COMPILATION, sur le SOURCE (Civet/Coffee,
// indentation significative), tout juste extrait par extractSections (donc
// post-dedent) et AVANT les appends générés (persist/macros/includes émettent
// leurs propres µeffect, légitimes, jamais scannés ici) :
//   - occurrence dans une enveloppe (méthode, hook, cb, objet), quel que soit son retrait, sauf sous des blocs de
//     contrôle (`if`, `for`, `try`…) tous ouverts depuis le premier niveau (effetImbrique) ;
//   - occurrence précédée sur SA ligne de `->` / `=>` / `do` → callback inline
//     même en colonne 0 (`setTimeout -> µeffect ->`).
// Le <script module>, lui, s'exécute à l'IMPORT du fichier généré (jsModule
// émis AVANT la classe, cf. injectTemplate) : JAMAIS de composant actif →
// TOUTE occurrence y est invalide, top-level compris. Chaînes et commentaires
// neutralisés par MASK_STRINGS_AND_COMMENTS_RE, remplacement espace-à-espace
// qui PRÉSERVE les `\n` (numéro de ligne exact dans le message) — même limite
// assumée que lintSingletonConsume sur les heredocs `"""…"""`.
const EFFECT_RUNE_RE   = /(?<![\w$.])(µ\.?(?:effect|inspect))(?![\w$])/g
const NESTED_BEFORE_RE = /->|=>|(?<![\w$])do(?![\w$])/
// ligne qui ouvre un bloc de contrôle (condition, boucle, essai), `}` d'un bloc js précédent toléré en tête
const BLOC_DE_CONTROLE_RE = /^[ \t]*(?:\}[ \t]*)?(?:if|else|unless|for|while|until|loop|switch|when|case|default|try|catch|finally)(?![\w$])/

// le corps d'un `if` ou d'un `for` de premier niveau s'exécute à l'initialisation, comme le premier niveau lui-même : un
// µeffect y fonctionne. Toute autre enveloppe (fonction, méthode, hook, rappel, objet, expression sur plusieurs lignes) garde
// le refus. Le jugement suit la structure du script (structureDuScript) et non le texte d'une ligne : une accolade se juge sur
// l'instruction qu'elle ouvre, une regex n'ouvre ni ne ferme rien, et le corps d'une fonction est refusé quel que soit le retrait
const FONCTION_RE         = /(?<![\w$])function(?![\w$])/
const ouvreUneFonction    = (texte: string): boolean => NESTED_BEFORE_RE.test(texte) || FONCTION_RE.test(texte)
const ouvreBlocDeControle = (texte: string): boolean => BLOC_DE_CONTROLE_RE.test(texte) && !ouvreUneFonction(texte)

// masque de MASK_STRINGS_AND_COMMENTS_RE, sauf un `#` qui suit un point (`this.#n`) : champ privé du JavaScript, jamais un
// commentaire CoffeeScript — masqué jusqu'à la fin de la ligne, il emportait l'accolade qui le suit (`get n() { return this.#n }`).
// Une chaîne sur plusieurs lignes (`"""…"""`, `'''…'''`) se lit d'un bloc, et un gabarit jusqu'à l'accent grave de son niveau
// (`${…}` imbriqués compris, scanTemplateAt du lexeur) : une accolade écrite dedans n'ouvre ni ne ferme rien
const MASQUE_EFFET_RE = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`|\/\*[\s\S]*?\*\/|###[\s\S]*?###|\/\/[^\n]*|(?<!\.)#[^\n]*/g
// gabarit lu comme avant (jusqu'à l'accent grave suivant) quand ses `${…}` ne se referment pas
const GABARIT_SIMPLE_RE = /`(?:[^`\\]|\\.)*`/y

function masqueEffet(src: string): string {
  let out = ''
  let pos = 0
  MASQUE_EFFET_RE.lastIndex = 0
  for (let m = MASQUE_EFFET_RE.exec(src); m !== null; m = MASQUE_EFFET_RE.exec(src)) {
    let fin = m.index + m[0].length
    if (m[0] === '`') {
      fin = scanTemplateAt(src, m.index)
      if (fin === -1) {
        GABARIT_SIMPLE_RE.lastIndex = m.index
        fin = GABARIT_SIMPLE_RE.exec(src) ? GABARIT_SIMPLE_RE.lastIndex : -1
      }
      // accent grave jamais refermé : du texte
      if (fin === -1) continue
    }
    out += src.slice(pos, m.index) + src.slice(m.index, fin).replace(/[^\n]/g, ' ')
    pos = fin
    MASQUE_EFFET_RE.lastIndex = fin
  }
  return out + src.slice(pos)
}

interface Accolade { ouvre: number, ferme: number, controle: boolean }
interface StructureDuScript { texte: string, accolades: Accolade[], suites: boolean[] }

// script masqué de ses chaînes et commentaires, lu caractère par caractère : ses regex sont masquées à leur tour (même lecture
// que finExpression, `/\{/`, `/[{]/` ou `/}/` n'ouvrent ni ne ferment rien) et chaque accolade est jugée sur l'instruction
// qu'elle ouvre, lue depuis son début — dernier `;`, `{` ou `}`, ou fin de ligne hors parenthèse —, condition sur plusieurs
// lignes comprise (`if (a &&` puis `    b) {`). Rend le texte sans ses regex, les accolades et, par ligne, si elle continue une
// parenthèse ouverte plus haut
function structureDuScript(masque: string): StructureDuScript {
  let texte = masque
  const accolades: Accolade[] = []
  const pile: { accolade: Accolade, parens: number, debut: number, precedente: string }[] = []
  const suites = [false]
  let parens     = 0    // parenthèses et crochets ouverts depuis l'accolade englobante
  let debut      = 0    // début de l'instruction en cours
  let precedente = ''   // instruction de la ligne d'avant : celle d'une accolade seule sur sa ligne
  for (let p = 0; p < texte.length; p++) {
    const c = texte[p]
    if (c === '/' && ouvreUneRegex(texte.slice(0, p))) {
      const fin = scanRegexLiteral(texte, p)
      if (fin !== -1) {
        texte = texte.slice(0, p) + ' '.repeat(fin - p) + texte.slice(fin)
        p = fin - 1
        continue
      }
    }
    if (c === '(' || c === '[') parens++
    else if ((c === ')' || c === ']') && parens > 0) parens--
    else if (c === '{') {
      const accolade = { ouvre: p, ferme: -1, controle: ouvreBlocDeControle(texte.slice(debut, p).trim() || precedente) }
      accolades.push(accolade)
      pile.push({ accolade, parens, debut, precedente })
      parens     = 0
      debut      = p + 1
      precedente = ''
    }
    else if (c === '}') {
      const ouverte = pile.pop()
      if (ouverte) {
        ouverte.accolade.ferme = p
        parens = ouverte.parens
      }
      // accolade prise dans une parenthèse (objet en argument, rappel) : l'instruction qui l'englobe continue
      if (ouverte && ouverte.parens > 0) {
        debut      = ouverte.debut
        precedente = ouverte.precedente
      }
      else {
        debut      = p + 1
        precedente = ''
      }
    }
    else if (c === ';' && parens === 0) {
      debut      = p + 1
      precedente = ''
    }
    else if (c === '\n') {
      suites.push(parens > 0)
      if (parens === 0) {
        const instruction = texte.slice(debut, p).trim()
        if (instruction) precedente = instruction
        debut = p + 1
      }
    }
  }
  return { texte, accolades, suites }
}

// imbriqué si une accolade encore ouverte à la `position` de l'occurrence n'ouvre pas un bloc de contrôle, ou, pour une ligne
// indentée, si une ligne qui l'englobe (moins indentée, en remontant jusqu'au premier niveau) n'en ouvre pas un — retraits de
// Civet et de CoffeeScript. Une ligne qui continue une parenthèse ouverte plus haut appartient à l'instruction de sa première
// ligne, jugée à sa place ; une fonction ouverte dans cette suite garde le refus
function effetImbrique(lines: string[], li: number, position: number, structure: StructureDuScript): boolean {
  if (structure.accolades.some(a => !a.controle && a.ouvre < position && (a.ferme === -1 || a.ferme > position))) return true
  let retrait = /^[ \t]*/.exec(lines[li])![0].length
  for (let k = li - 1; k >= 0 && retrait > 0; k--) {
    const ligne = lines[k]
    if (ligne.trim() === '') continue
    const r = /^[ \t]*/.exec(ligne)![0].length
    if (r >= retrait) continue
    if (structure.suites[k]) {
      if (ouvreUneFonction(ligne)) return true
      continue
    }
    if (!ouvreBlocDeControle(ligne)) return true
    retrait = r
  }
  return retrait > 0
}

// `firstLine` : ligne du fichier où commence `scriptSource` (le refus dans <script module> cite la ligne du `.mjs`)
export function lintEffectTopLevel(scriptSource: string, isModule = false, firstLine = 1): void {
  if (!scriptSource) return
  const masked = masqueEffet(scriptSource)
  if (!masked.includes('effect') && !masked.includes('inspect')) return
  const structure = structureDuScript(masked)
  const lines     = structure.texte.split('\n')
  let debutLigne  = 0
  for (let li = 0; li < lines.length; debutLigne += lines[li].length + 1, li++) {
    const line = lines[li]
    if (!line.includes('effect') && !line.includes('inspect')) continue
    EFFECT_RUNE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = EFFECT_RUNE_RE.exec(line)) !== null) {
      const rune = m[1]
      if (isModule) {
        throw new Error(t('transpiler.rune-effect-dans-module', { rune, ligne: li + firstLine }))
      }
      if (effetImbrique(lines, li, debutLigne + m.index, structure) || NESTED_BEFORE_RE.test(line.slice(0, m.index))) {
        throw new Error(t('transpiler.rune-effect-imbriquee', { rune, ligne: li + firstLine }))
      }
    }
  }
}

// ----------------------------------------------------------------------------
  // lintEmitInModule — µemit/µ.emit interdit dans <script module> :
// this-rebinding.ts/template.ts) N'EXISTE PAS dans le module — code partagé
// exécuté à l'import, SANS instance de composant, donc sans aucun élément à
// qui faire émettre l'événement. Contrairement à lintEffectTopLevel, PAS de
// restriction « top-level seulement » : µemit reste légitime imbriqué dans un
// <script> normal (méthode, handler, objet utilisateur…) — c'est le
// <script module> ENTIER qui est refusé, toute profondeur confondue. Même
// masquage chaînes/commentaires que lintEffectTopLevel, même regex que la
// réécriture réelle (transformCodeOnly plus haut) : ce que la réécriture
// toucherait, ce lint le voit aussi — aucun écart entre détection et effet.
// ----------------------------------------------------------------------------
const EMIT_RUNE_RE = /µ\.?\s*emit\b/g

export function lintEmitInModule(moduleSource: string, firstLine = 1): void {
  if (!moduleSource) return
  const masked = moduleSource.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => m.replace(/[^\n]/g, ' '))
  const lines = masked.split('\n')
  for (let li = 0; li < lines.length; li++) {
    if (!lines[li].includes('emit')) continue
    EMIT_RUNE_RE.lastIndex = 0
    const m = EMIT_RUNE_RE.exec(lines[li])
    if (m) throw new Error(t('transpiler.rune-emit-dans-module', { rune: m[0], ligne: li + firstLine }))
  }
}

// lintSplitRune (split-rune.ts) — rune séparée de son symbole par un espace ou un retour à la ligne : réexportée
// ici avec les règles sœurs ; rangée à part pour être lue aussi par macros.ts (script des partiels) sans cycle
export { lintSplitRune }

// ----------------------------------------------------------------------------
// lintOnUrlChangeLegacy — AVERTIT si le SOURCE du dev pose `@onUrlChange = ` /
// `this.onUrlChange = ` : c'est l'ancien slot V1 direct — mjs_router.ts, lui,
// n'appelle plus QUE `_mjs_hooks.urlChange`, posé par la rune
// `µurlChange (path, params) -> …` (cf. lexer §3.8c-pré). `@onUrlChange = ->`
// reste du Coffee/Civet banal (`@` = `this.`) : ça COMPILE sans erreur, mais le
// hook n'est alors JAMAIS invoqué par le routeur — panne SILENCIEUSE (aucune
// exception, juste une navigation qui n'atteint jamais le composant). Simple
// AVERTISSEMENT, pas une erreur : `onUrlChange` reste un nom de propriété légal
// pour tout autre usage (collision jugée assez improbable pour ne mériter qu'un
// signal). Même masquage chaînes/commentaires que lintEffectTopLevel (scan sur
// le source AVANT compilation, cf. MASK_STRINGS_AND_COMMENTS_RE).
// ----------------------------------------------------------------------------
const ON_URL_CHANGE_LEGACY_RE = /(?<![\w$])(?:@|this\.)onUrlChange\b\s*=(?!=)/

export function lintOnUrlChangeLegacy(scriptSource: string, moduleName: string, lint?: LintToggles, colorsEnabled = false, firstLine?: number): void {
  if (!scriptSource) return
  const masked = scriptSource.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => m.replace(/[^\n]/g, ' '))
  const found = ON_URL_CHANGE_LEGACY_RE.exec(masked)
  if (found) {
    // la ligne du .mjs quand on connaît celle où commence le script
    const ligne = firstLine === undefined ? '' : firstLine + (masked.slice(0, found.index).match(/\n/g)?.length ?? 0)
    const line = typedLine('legacy', t('transpiler.on-url-change-legacy', { moduleName, ligne }), lint)
    if (line !== null) printDiagnostic(line, colorsEnabled)
  }
}

// ----------------------------------------------------------------------------
// lintUndeclaredTopLevelAssignment — "bonus mémoire" : Civet (contrairement à Coffee) n'auto-déclare
// JAMAIS un nom via une simple assignation `nom = expr` — SEUL `nom := expr`
// déclare une NOUVELLE variable. **Vérifié empiriquement** (compilateur Civet
// direct) : `nom = -> ...` ET `nom = => ...` (les DEUX formes de fonction, pas
// spécifique à `=>` contrairement à ce que suggérait la mémoire d'origine)
// SANS `:=` compilent TOUS LES DEUX en une assignation NUE `nom = function(){}`,
// sans aucun `var`/`let`/`const` — au runtime, le module ES généré (TOUJOURS en
// mode strict) lève `ReferenceError: nom is not defined` dès l'exécution de
// cette ligne (pas juste un "module silencieusement inerte" : un CRASH garanti
// à l'init du composant). Les vars `$xxx` réactives échappent totalement à ce
// piège (compilées en `$.xxx`, un MemberExpression, jamais une assignation nue
// sur un Identifier) — seuls les noms LOCAUX PURS (fonctions/vars normales)
// sont concernés.
//
// Fix : détection SEULE (pas de réécriture automatique — décider entre "1ère
// déclaration, ajouter :=" et "ré-assignation d'un nom déclaré ailleurs dans
// une portée qu'on n'a pas vue" demanderait une analyse de scope complète,
// hors de portée d'un simple lint ; mieux vaut un signal explicite et sûr
// qu'une réécriture qui pourrait masquer un autre bug ou introduire un
// shadowing involontaire). Ne s'applique qu'à Civet (Coffee auto-déclare tout,
// aucun risque). Conservateur par construction : un nom déclaré N'IMPORTE OÙ
// dans le script (n'importe quelle portée) n'est PAS flaggé, pour zéro faux
// positif — au prix de rater d'éventuels vrais bugs de shadowing profond
// (compromis délibéré, cf. philosophie déjà établie de path-tracker.ts : mieux
// vaut sous-détecter que produire un faux positif qui casse un build correct).
// Parse acorn (sourceType module) mutualisé par les deux lints — `null` si le
// JS est vide ou ne parse pas (sortie langage exotique). PERF : permet de
// PARTAGER l'AST entre lintUndeclaredTopLevelAssignment et lintNoRawImport (2
// parse du même texte par section, ×2 avec le module → jusqu'à 4/composant).
// `locations` : positions de ligne dans l'AST, celles que lit le contrôle des constantes (findConstReassignment) quand il
// reçoit cet AST au lieu de relire le texte
export function parseModuleAst(js: string, locations = false): acorn.Node | null {
  if (!js) return null
  try {
    return acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', locations })
  } catch {
    return null
  }
}

// `preAst` (optionnel) : AST déjà parsé à réutiliser. `undefined` → la fonction
// parse elle-même (appel autonome/tests) ; `null` → parse déjà tenté et échoué
// en amont → no-op silencieux (mêmes sémantiques que l'ancien `catch { return }`).
export function lintUndeclaredTopLevelAssignment(js: string, lang: string, externalVars: string[] = [], preAst?: acorn.Node | null): void {
  if (lang !== 'civet' || !js) return

  const ast: acorn.Node | null = preAst !== undefined ? preAst : parseModuleAst(js)
  if (!ast) return

  // Passe 1 — collecte TOUS les noms déclarés n'importe où (var/let/const,
  // function, paramètres) : un nom déclaré QUELQUE PART n'est jamais suspect.
  const declared = new Set<string>()
  const collectPatternNames = (pat: any) => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier': declared.add(pat.name); break
      case 'ObjectPattern': for (const p of pat.properties ?? []) collectPatternNames(p.value ?? p.argument); break
      case 'ArrayPattern': for (const el of pat.elements ?? []) collectPatternNames(el); break
      case 'AssignmentPattern': collectPatternNames(pat.left); break
      case 'RestElement': collectPatternNames(pat.argument); break
    }
  }
  walk.full(ast, (node: any) => {
    switch (node.type) {
      case 'VariableDeclarator': collectPatternNames(node.id); break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) declared.add(node.id.name)
        for (const p of node.params ?? []) collectPatternNames(p)
        break
      case 'ClassDeclaration':
        if (node.id) declared.add(node.id.name)
        break
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
        if (node.local) declared.add(node.local.name)
        break
      case 'CatchClause': collectPatternNames(node.param); break
    }
  })
  for (const v of externalVars) declared.add(v.replace(/^\$+/, ''))

  // Passe 2 — assignations NUES au niveau PROGRAMME (jamais dans une fonction/
  // bloc : une assignation locale dans une fonction est un tout autre sujet,
  // hors de portée de ce lint qui cible spécifiquement le "module mort" au
  // top-level de <script>).
  for (const stmt of (ast as any).body) {
    if (stmt.type !== 'ExpressionStatement') continue
    const expr = stmt.expression
    if (!expr || expr.type !== 'AssignmentExpression' || expr.operator !== '=') continue
    if (expr.left.type !== 'Identifier') continue
    const name = expr.left.name
    if (declared.has(name)) continue
    throw new Error(t('transpiler.nom-jamais-declare', { nom: name }))
  }
}

// ----------------------------------------------------------------------------
// lintElementPropertyAtConstruction — le `<script>` tourne pendant la CONSTRUCTION de la balise du
// composant : `@title = …` à son premier niveau n'y pose pas une donnée mais la propriété `title`
// de la balise elle-même (HTMLElement). Deux familles, mesurées dans Chromium :
//   - lecture seule (`@children`, `@dataset`, `@offsetWidth`…) : l'écriture lève (module strict),
//     le composant tombe au montage, quel que soit son chemin de création — refusé au build ;
//     `Reflect.set` n'est pas de ceux-là : il rend `false` sans lever, jamais refusé pour cela ;
//   - reflet ou contenu (`@title`, `@id`, `@hidden`, `@part`, `@ariaLabel`, `@textContent`…) :
//     l'écriture pose un attribut ou un enfant sur la balise. Créée par `document.createElement`
//     (le routeur pour une page, `<@element>`, la relance d'un `<@failed>`), la balise est alors
//     refusée par le navigateur (« The result must not have attributes ») ; tirée d'un gabarit ou
//     de la page, elle vit, l'attribut en plus ; au rendu serveur, rien ne casse. Selon la valeur
//     même (`@hidden = false` ne pose rien) : averti, jamais refusé.
// Plus loin (µmount, méthode, écouteur) : libre.
// Une MÉTHODE de la balise que ModularJS appelle lui-même (`@setAttribute = …`, cf.
// ELEMENT_FRAMEWORK_METHODS) : refusée où que `this` soit la balise, pas seulement à la construction.
// ----------------------------------------------------------------------------
// propriétés en lecture seule de la balise : les écrire lève
const ELEMENT_READONLY_PROPS = new Set([
  'attributes', 'children', 'childNodes', 'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild',
  'previousSibling', 'nextSibling', 'previousElementSibling', 'nextElementSibling', 'parentNode', 'parentElement',
  'childElementCount', 'nodeName', 'nodeType', 'tagName', 'localName', 'namespaceURI', 'prefix', 'ownerDocument',
  'isConnected', 'baseURI', 'shadowRoot', 'assignedSlot', 'dataset', 'attributeStyleMap', 'isContentEditable',
  'clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft',
  'offsetParent', 'scrollWidth', 'scrollHeight',
])
// propriétés de la balise qui, écrites, posent un attribut (reflet) ou des enfants
const ELEMENT_REFLECTED_PROPS = new Set([
  'id', 'className', 'classList', 'slot', 'part', 'style', 'title', 'lang', 'translate', 'dir', 'hidden', 'inert',
  'accessKey', 'draggable', 'spellcheck', 'autocapitalize', 'autocorrect', 'autofocus', 'contentEditable',
  'enterKeyHint', 'inputMode', 'popover', 'tabIndex', 'writingSuggestions', 'role',
  'innerHTML', 'outerHTML', 'textContent', 'innerText', 'outerText',
])
// méthodes de la balise que ModularJS appelle lui-même sur une balise de composant, APRÈS son
// <script> — noms techniques, que personne ne prend pour une méthode à soi : masquées, c'est la
// fonction de l'auteur qui part à leur place et le composant cesse de marcher (runtime/) :
//   - attributs : setAttribute, getAttribute, removeAttribute au montage de chaque composant
//     (mjs_element.ts, connectedCallback), hasAttribute (slots indexés, @flip, @title) ;
//   - événements : dispatchEvent (µemit, liaisons), add/removeEventListener (µon d'un composant
//     léger, effets, transitions) ;
//   - contenu : appendChild, insertBefore, removeChild, replaceChild, replaceChildren (blocs du
//     contenu que la page lui confie, <@element>, <@failed>, zone de navigation), querySelector
//     (<@view> du routeur), querySelectorAll (retrait), getRootNode (événements délégués) ;
//   - mesure et animation : getBoundingClientRect, getClientRects, getAnimations (transitions,
//     @flip, effets), setPointerCapture (*goo), cloneNode (@viewTransition, couche de lévitation).
// Les noms naturels que le cadre appelle aussi (remove, contains, replaceWith, matches, closest,
// focus, click, animate) restent libres : un auteur les prend pour ses propres méthodes, c'est au
// cadre de ne pas dépendre d'eux. attachShadow et getAttributeNames ne servent qu'au constructeur,
// avant le <script> : libres aussi.
const ELEMENT_FRAMEWORK_METHODS = new Set([
  'setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'getRootNode',
  'getBoundingClientRect', 'getClientRects', 'getAnimations', 'setPointerCapture', 'cloneNode',
])

// où `this` désigne le composant : le premier niveau du <script>, une flèche, une méthode posée sur lui
// (`@f = ->`), ou une fonction sans propriétaire (le rappel de `µmount ->`, `f = ->`) que le compilateur lit
// comme le composant (cf. generator/this-rebinding.ts). Une méthode de classe ou d'objet, un champ de
// classe : `this` y est autre chose. Une fonction que le <script> construit avec `new` ou rebranche (`f.call(obj)`)
// pose aussi ses propriétés ailleurs que sur le composant. `ancestors` : ceux du nœud, lui-même en dernier
function thisIsComponent(ancestors: any[], foreign: ForeignThis): boolean {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const a = ancestors[i]
    if (a.type === 'PropertyDefinition' || a.type === 'StaticBlock') return false
    if (a.type !== 'FunctionExpression' && a.type !== 'FunctionDeclaration') continue
    const parent = ancestors[i - 1]
    if (parent?.type === 'MethodDefinition' || parent?.type === 'Property') return false
    if (parent?.type === 'AssignmentExpression' && parent.right === a && parent.left?.type === 'MemberExpression') {
      const owner  = parent.left.object
      const direct = owner?.type === 'ThisExpression'
      if (!direct && !(owner?.type === 'Identifier' && owner.name === '_mjsThis')) return false
      if (!parent.left.computed && foreign.members.has(parent.left.property?.name)) return false
      if (direct) continue
      return true
    }
    const names = [a.id?.name, parent?.type === 'VariableDeclarator' && parent.init === a ? parent.id?.name : undefined, parent?.type === 'AssignmentExpression' && parent.right === a ? parent.left?.name : undefined]
    return !names.some(n => n !== undefined && foreign.names.has(n))
  }
  return true
}

// les fonctions que le <script> ne laisse pas être le composant : celles qu'il construit avec `new` (`new Fake 1`,
// `new @Emitter`) ou appelle avec un autre `this` (`f.call(obj)`, `.apply`, `.bind`) ; `call(@)` garde le composant.
// Lues par leur nom, sans portée : un homonyme construit ailleurs la dispense aussi — un contrôle peut manquer une
// écriture, jamais refuser à tort
interface ForeignThis { names: Set<string>, members: Set<string> }

function collectForeignThis(ast: acorn.Node): ForeignThis {
  const names   = new Set<string>()
  const members = new Set<string>()
  const retain  = (target: any): void => {
    if (target?.type === 'Identifier') names.add(target.name)
    else if (target?.type === 'MemberExpression' && !target.computed && target.property?.type === 'Identifier' && (target.object?.type === 'ThisExpression' || (target.object?.type === 'Identifier' && target.object.name === '_mjsThis'))) members.add(target.property.name)
  }
  walk.simple(ast, {
    NewExpression(node: any) { retain(node.callee) },
    CallExpression(node: any) {
      const c = node.callee
      if (c?.type !== 'MemberExpression' || c.computed || !['call', 'apply', 'bind'].includes(c.property?.name)) return
      const first = node.arguments[0]
      if (first?.type === 'ThisExpression' || (first?.type === 'Identifier' && first.name === '_mjsThis')) return
      retain(c.object)
    },
  })
  return { names, members }
}

// ce que le <script> dit de `this` : les fonctions qui ne sont pas le composant, et les alias du composant
// (`self = @`, `self := @`) — `self.nom = …` écrit sur lui. Un alias suit sa portée, à la fonction près : un
// nom lié dans une fonction (variable, paramètre, fonction, classe) lui appartient ; l'alias n'en est un que si
// toutes ses écritures de cette portée sont `= this` — réaffecté à autre chose (`self = {}`, une variable de
// boucle, un paramètre), il cesse d'en être un
interface ThisInfo { foreign: ForeignThis, isAlias: (name: string, ancestors: any[]) => boolean }

const FUNCTION_NODES = new Set(['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'])

// les noms que lie un motif (paramètre, déclaration, déstructuration)
function patternNames(pat: any, out: string[] = []): string[] {
  switch (pat?.type) {
    case 'Identifier':        out.push(pat.name); break
    case 'ObjectPattern':     for (const p of pat.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out); break
    case 'ArrayPattern':      for (const el of pat.elements) patternNames(el, out); break
    case 'AssignmentPattern': patternNames(pat.left, out); break
    case 'RestElement':       patternNames(pat.argument, out); break
  }
  return out
}

function analyzeThis(ast: acorn.Node): ThisInfo {
  const foreign = collectForeignThis(ast)
  const bound   = new Map<any, Set<string>>()
  const defs    = new Map<any, Set<string>>()
  const others  = new Map<any, Set<string>>()
  const add     = (table: Map<any, Set<string>>, scope: any, names: string[]): void => {
    if (!table.has(scope)) table.set(scope, new Set())
    for (const n of names) table.get(scope)!.add(n)
  }
  // la fonction englobante (ou la racine) d'un nœud : `ancestors`, lui-même en dernier
  const scopeOfNode = (ancestors: any[]): any => {
    for (let i = ancestors.length - 1; i > 0; i--) if (FUNCTION_NODES.has(ancestors[i].type)) return ancestors[i]
    return ancestors[0]
  }
  // la portée où `name` est lié, vu d'un nœud : la fonction la plus proche qui le lie, sinon la racine
  const scopeOfName = (name: string, ancestors: any[]): any => {
    for (let i = ancestors.length - 1; i > 0; i--) if (FUNCTION_NODES.has(ancestors[i].type) && bound.get(ancestors[i])?.has(name)) return ancestors[i]
    return ancestors[0]
  }
  walk.ancestor(ast, {
    VariableDeclarator(node: any, _st: unknown, ancestors: any[]) { add(bound, scopeOfNode(ancestors), patternNames(node.id)) },
    FunctionDeclaration(node: any, _st: unknown, ancestors: any[]) {
      add(bound, scopeOfNode(ancestors.slice(0, -1)), patternNames(node.id))
      add(bound, node, node.params.flatMap((p: any) => patternNames(p)))
    },
    FunctionExpression(node: any) { add(bound, node, node.params.flatMap((p: any) => patternNames(p))) },
    ArrowFunctionExpression(node: any) { add(bound, node, node.params.flatMap((p: any) => patternNames(p))) },
    ClassDeclaration(node: any, _st: unknown, ancestors: any[]) { add(bound, scopeOfNode(ancestors.slice(0, -1)), patternNames(node.id)) },
    CatchClause(node: any, _st: unknown, ancestors: any[]) { add(bound, scopeOfNode(ancestors), patternNames(node.param)) },
  })
  // les noms liés qui ne sont pas un alias : paramètres, fonctions, classes, imports, variables de boucle et toute écriture d'autre chose
  const other = (name: string, ancestors: any[]): void => add(others, scopeOfName(name, ancestors), [name])
  const write = (target: any, ancestors: any[], alias: boolean): void => {
    for (const name of patternNames(target)) {
      if (alias && target.type === 'Identifier') add(defs, scopeOfName(name, ancestors), [name])
      else other(name, ancestors)
    }
  }
  walk.ancestor(ast, {
    VariableDeclarator(node: any, _st: unknown, ancestors: any[]) {
      const head = ancestors.at(-3)
      if (node.init) write(node.id, ancestors, node.init.type === 'ThisExpression' && thisIsComponent(ancestors, foreign))
      else if ((head?.type === 'ForInStatement' || head?.type === 'ForOfStatement') && head.left === ancestors.at(-2)) write(node.id, ancestors, false)
    },
    AssignmentExpression(node: any, _st: unknown, ancestors: any[]) { write(node.left, ancestors, node.operator === '=' && node.right?.type === 'ThisExpression' && thisIsComponent(ancestors, foreign)) },
    UpdateExpression(node: any, _st: unknown, ancestors: any[]) { write(node.argument, ancestors, false) },
    ForInStatement(node: any, _st: unknown, ancestors: any[]) { if (node.left.type !== 'VariableDeclaration') write(node.left, ancestors, false) },
    ForOfStatement(node: any, _st: unknown, ancestors: any[]) { if (node.left.type !== 'VariableDeclaration') write(node.left, ancestors, false) },
    FunctionDeclaration(node: any, _st: unknown, ancestors: any[]) {
      if (node.id) other(node.id.name, ancestors.slice(0, -1))
      for (const name of node.params.flatMap((p: any) => patternNames(p))) add(others, node, [name])
    },
    FunctionExpression(node: any) { for (const name of node.params.flatMap((p: any) => patternNames(p))) add(others, node, [name]) },
    ArrowFunctionExpression(node: any) { for (const name of node.params.flatMap((p: any) => patternNames(p))) add(others, node, [name]) },
    ClassDeclaration(node: any, _st: unknown, ancestors: any[]) { if (node.id) other(node.id.name, ancestors.slice(0, -1)) },
    CatchClause(node: any, _st: unknown, ancestors: any[]) { for (const name of patternNames(node.param)) other(name, ancestors) },
    ImportSpecifier(node: any, _st: unknown, ancestors: any[]) { other(node.local.name, ancestors) },
    ImportDefaultSpecifier(node: any, _st: unknown, ancestors: any[]) { other(node.local.name, ancestors) },
    ImportNamespaceSpecifier(node: any, _st: unknown, ancestors: any[]) { other(node.local.name, ancestors) },
  })
  const isAlias = (name: string, ancestors: any[]): boolean => {
    const scope = scopeOfName(name, ancestors)
    return defs.get(scope)?.has(name) === true && !others.get(scope)?.has(name)
  }
  return { foreign, isAlias }
}

// `obj` désigne-t-il le composant : `this` (partout, ou seulement là où il vaut le composant), `_mjsThis`
// (forme compilée de `@@`), un alias de `this`
function isComponentRef(obj: any, ancestors: any[], info: ThisInfo, everywhere = false): boolean {
  if (obj?.type === 'ThisExpression') return everywhere || thisIsComponent(ancestors, info.foreign)
  return obj?.type === 'Identifier' && (obj.name === '_mjsThis' || info.isAlias(obj.name, ancestors))
}

// les accès `obj.nom` que écrit une cible d'affectation : elle-même, ou ceux d'un motif de déstructuration
// (`[@a, { k: @b }, ...@c] = …`)
function memberTargets(target: any): any[] {
  if (!target) return []
  switch (target.type) {
    case 'MemberExpression':  return [target]
    case 'ArrayPattern':      return target.elements.flatMap((el: any) => memberTargets(el))
    case 'ObjectPattern':     return target.properties.flatMap((p: any) => memberTargets(p.type === 'RestElement' ? p.argument : p.value))
    case 'AssignmentPattern': return memberTargets(target.left)
    case 'RestElement':       return memberTargets(target.argument)
  }
  return []
}

// le texte d'une clé écrite en dur : `'nom'`, `"nom"`, un gabarit sans expression ; null sinon
function literalKey(k: any): string | null {
  if (k?.type === 'Literal' && typeof k.value === 'string') return k.value
  if (k?.type === 'TemplateLiteral' && k.expressions.length === 0 && k.quasis.length === 1) return k.quasis[0].value.cooked
  return null
}

// le nom qu'écrit un accès `obj.nom`, `obj['nom']` ; null quand il ne se lit pas (clé calculée à l'exécution)
function memberName(m: any): string | null {
  if (!m.computed) return m.property?.type === 'Identifier' ? m.property.name : null
  return literalKey(m.property)
}

// `Object.assign(obj, { nom: … })`, `Object.defineProperty(obj, 'nom', …)`, `Object.defineProperties`,
// `Reflect.set` : l'objet visé et les noms posés dessus ; `open` quand un nom ne se lit pas (un spread, un
// objet construit ailleurs, une clé calculée) ; `definition` quand l'appel redéfinit la propriété sans l'écrire
// (`defineProperty`, `defineProperties`) : rien ne lève, rien n'est posé sur la balise ; `withoutThrow` pour
// `Reflect.set`, qui écrit mais rend `false` sur une propriété en lecture seule au lieu de lever
function callWrites(call: any): { target: any, names: string[], open: boolean, definition: boolean, withoutThrow: boolean } | null {
  const c = call.callee
  if (c?.type !== 'MemberExpression' || c.computed || c.object?.type !== 'Identifier' || c.property?.type !== 'Identifier') return null
  const args: any[] = call.arguments
  if (args.length === 0) return null
  const names: string[] = []
  let open = false
  const listKeys = (o: any): void => {
    if (o?.type !== 'ObjectExpression') { open = true; return }
    for (const p of o.properties) {
      const name = p.type !== 'Property' ? null : !p.computed && p.key?.type === 'Identifier' ? p.key.name : literalKey(p.key)
      if (name === null) open = true
      else names.push(name)
    }
  }
  const addKey = (k: any): void => {
    const name = literalKey(k)
    if (name === null) open = true
    else names.push(name)
  }
  switch (`${c.object.name}.${c.property.name}`) {
    case 'Object.assign':           for (const a of args.slice(1)) listKeys(a); break
    case 'Object.defineProperties': listKeys(args[1]); break
    case 'Object.defineProperty':
    case 'Reflect.defineProperty':
    case 'Reflect.set':             addKey(args[1]); break
    default:                        return null
  }
  return { target: args[0], names, open, definition: c.property.name.startsWith('define'), withoutThrow: c.property.name === 'set' && c.object.name === 'Reflect' }
}

// les noms que le <script> pose sur l'instance (`@sock = …`), où que ce soit : en tête, ou dans une
// fonction (une connexion ouverte une fois l'utilisateur connecté) — `this.nom` ou `_mjsThis.nom`, par une
// affectation, une déstructuration (`[@sock] = …`), `Object.assign @, { sock }`, un alias (`self = @`).
// Une écriture dont le nom ne se lit pas au build (`@[nom] = …`, `Object.assign @, reglages`) pourrait poser
// n'importe lequel : `sock` est alors compté, plutôt qu'une fausse erreur
function collectInstanceProps(ast: acorn.Node | null): string[] {
  const names = new Set<string>()
  if (!ast) return []
  const info = analyzeThis(ast)
  let open = false
  const written = (target: any, ancestors: any[]): void => {
    for (const m of memberTargets(target)) {
      if (!isComponentRef(m.object, ancestors, info, true)) continue
      const name = memberName(m)
      if (name === null) open = true
      else names.add(name)
    }
  }
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    ForInStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    ForOfStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    CallExpression(node: any, _st: unknown, ancestors: any[]) {
      const w = callWrites(node)
      if (!w || !isComponentRef(w.target, ancestors, info, true)) return
      for (const name of w.names) names.add(name)
      if (w.open) open = true
    },
  })
  if (open) names.add('sock')
  return [...names]
}

// les noms que le code d'un gestionnaire du HTML pose sur le composant (`@sock = …`, `[@sock] = …`,
// `{ k: @sock } = …`), lus sur le texte : ce code n'est compilé qu'après le HTML, qui a besoin de ces noms
function collectHandlerInstanceProps(code: string, lang: string): string[] {
  const names = new Set<string>()
  const stripped = maskNonCode(code, lang)
  for (const m of stripped.matchAll(/(?<![\w$.@])@@?([A-Za-z_]\w*)/g)) {
    const start = m.index!
    const end   = start + m[0].length
    if (/^\s*(?:\*\*|\?\?|\|\||&&|<<|>>>?|[-+*/%&|^?])?[:.]?=(?![=>])/.test(stripped.slice(end))) { names.add(m[1]); continue }
    // dans un motif de déstructuration : le groupe `[…]` ou `{…}` qui l'entoure est suivi d'un `=`
    const opening = Math.max(stripped.lastIndexOf('[', start), stripped.lastIndexOf('{', start))
    if (opening === -1) continue
    const closing = stripped.indexOf(stripped[opening] === '[' ? ']' : '}', end)
    if (closing !== -1 && !/[\]}]/.test(stripped.slice(opening + 1, start)) && /^\s*=(?![=>])/.test(stripped.slice(closing + 1))) names.add(m[1])
  }
  return [...names]
}

// Les écritures lues : `@nom = …`, `@['nom'] = …`, une déstructuration (`[@nom] = …`), `Object.assign @, { nom }`,
// `Object.defineProperty(@, 'nom', …)`, `Reflect.set`, par `@` ou par un alias (`self = @`) ; ce qui ne se
// voit pas au build reste libre : une clé calculée à l'exécution (`@[nom] = …`), un objet construit ailleurs
// (`Object.assign @, reglages`), le composant passé à une fonction. `lineOf(position du JS)` : la ligne du .mjs
function lintElementPropertyAtConstruction(ast: acorn.Node | null, moduleName: string | undefined, lint?: LintToggles, colorsEnabled = false, lineOf?: (offset: number) => number | null): void {
  if (!ast) return
  const info    = analyzeThis(ast)
  const avertis = new Set<string>()
  // un nom écrit sur `obj` ; `ancestors` : ceux de l'écriture, `at` : sa position dans le JS compilé ;
  // `definition` : redéfini sans être écrit (defineProperty) — les méthodes du cadre y sont masquées comme
  // ailleurs, mais ni la lecture seule ni le reflet ne s'y appliquent ; `withoutThrow` : écrit par `Reflect.set`,
  // qui rend `false` sur une propriété en lecture seule au lieu de lever — le reflet, lui, s'écrit bel et bien
  const check = (obj: any, nom: string | null, ancestors: any[], at: number, definition = false, withoutThrow = false): void => {
    if (nom === null || !isComponentRef(obj, ancestors, info)) return
    if (ELEMENT_FRAMEWORK_METHODS.has(nom)) throw new Error(t('transpiler.methode-balise-masquee', { moduleName: moduleName ?? '?', nom }))
    if (definition) return
    // propriété : hors de toute fonction (flèche comprise), jouée pendant la construction
    if (ancestors.some((a: any) => a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration' || a.type === 'ArrowFunctionExpression')) return
    if (ELEMENT_READONLY_PROPS.has(nom) && !withoutThrow) throw new Error(t('transpiler.propriete-balise-lecture-seule', { moduleName: moduleName ?? '?', nom }))
    if ((ELEMENT_REFLECTED_PROPS.has(nom) || /^aria[A-Z]/.test(nom)) && !avertis.has(nom)) {
      avertis.add(nom)
      const line = typedLine('naming', t('transpiler.propriete-balise-construction', { moduleName: moduleName ?? '?', nom, ligne: lineOf?.(at) ?? '' }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    }
  }
  const written = (target: any, ancestors: any[]): void => {
    for (const m of memberTargets(target)) check(m.object, memberName(m), ancestors, m.start)
  }
  walk.ancestor(ast, {
    AssignmentExpression(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    UpdateExpression(node: any, _st: unknown, ancestors: any[]) { written(node.argument, ancestors) },
    ForInStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    ForOfStatement(node: any, _st: unknown, ancestors: any[]) { written(node.left, ancestors) },
    CallExpression(node: any, _st: unknown, ancestors: any[]) {
      const w = callWrites(node)
      if (w) for (const nom of w.names) check(w.target, nom, ancestors, node.start, w.definition, w.withoutThrow)
    },
  })
}

// la ligne du .mjs d'une position du JS compilé du <script>, lue dans la carte de source du compilateur (déjà
// décalée à la ligne du bloc) ; null sans carte ou sans repère : jamais une ligne inventée
export function sourceLineOf(js: string, mapJson: string | undefined, offset: number): number | null {
  if (!mapJson) return null
  const segments = decode(JSON.parse(mapJson).mappings ?? '')[js.slice(0, offset).split('\n').length - 1] ?? []
  const col      = offset - (offset > 0 ? js.lastIndexOf('\n', offset - 1) + 1 : 0)
  const marks    = segments.filter(s => s.length >= 4)
  const mark     = [...marks].reverse().find(s => s[0] <= col) ?? marks[0]
  return mark ? (mark[2] as number) + 1 : null
}

// ----------------------------------------------------------------------------
// lintNoRawImport — demande utilisateur :
// SEULE la directive `@import nom 'chemin'` (racine du fichier, résolue par
// le bundler → graphe de dépendances/watch) est un import MJS valide. Un
// `import … from …` ES classique écrit DANS un <script>/<script module> est
// syntaxiquement accepté par Civet/TS/JS (passe tel quel) et fonctionne même
// souvent (esbuild le résout ensuite comme un import Node/ESM normal) — mais
// échappe TOTALEMENT au graphe `partialDependents`/watch du bundler : deux
// mécanismes d'import parallèles et incohérents dans le même projet,
// silencieusement. Fix : erreur de compilation explicite dès qu'un import ES
// natif (statique OU dynamique) est détecté dans le JS déjà compilé d'un
// script/module — AST (acorn), jamais une regex sur le source Civet/Coffee
// brut (évite tout faux positif sur un commentaire/chaîne qui mentionne le
// mot "import"). Universel (pas de garde par langage comme
// lintUndeclaredTopLevelAssignment) : la règle porte sur la CONVENTION MJS
// elle-même, pas sur une particularité de compilation Civet — s'applique
// identiquement en js/ts/coffee/civet, tous compilés vers le même JS final
// à ce stade du pipeline. `@import` lui-même n'est jamais vu tel quel ici :
// c'est une directive RACINE, extraite du markup AVANT que script.raw/
// moduleSection.raw ne soient même isolés (cf. directives.ts) — MAIS sa
// RÉSOLUTION (`dir.pendingAutoImports`) est un VRAI `import ... from ...`
// préinjecté en tête de `moduleSection.raw` (seul endroit légal pour un
// import ES réel — cf. transpiler/index.ts "3. Auto-imports"), donc présent
// tel quel dans `moduleJs` : `allowedLeadingImports` exempte ces N premières
// `ImportDeclaration` (position de tête garantie par construction, jamais
// réordonnées par Civet/TS qui ne font que passthrough sur du JS déjà
// valide) — tout import AU-DELÀ de ce compte reste banni.
// `import()` dynamique — ASSOUPLI : la version précédente
// bannissait tout appel, littéral OU calculé. Doctrine affinée : seul un
// chemin LITTÉRAL (`node.source` de type `Literal`, ou `TemplateLiteral` SANS
// expression — équivalent à une chaîne figée) reste banni — le graphe de
// dépendances DOIT le voir passer par `@import`/`µimport` (cf. sigils.ts,
// rewriteMuImport) pour bénéficier du hash/watch. Un argument CALCULÉ
// (`Identifier`, `MemberExpression`, `CallExpression`, template AVEC
// expression…) est de toute façon INVISIBLE à ce graphe, quel que soit le
// verdict — l'interdire n'apportait donc aucune garantie, seulement une porte
// fermée sur le SEUL cas légitime restant : une URL connue exclusivement à
// l'exécution (jamais un chemin de fichier du projet, qui lui doit toujours
// passer par `@import`/`µimport`).
// ----------------------------------------------------------------------------
// clés catalogue substituables (entry serveur : cli.entry-*)
export function lintNoRawImport(js: string, sectionLabel: string, allowedLeadingImports = 0, preAst?: acorn.Node | null, keys?: { static?: MsgKey, dynamic?: MsgKey, reexport?: MsgKey }): void {
  if (!js) return
  // Early-out : sans `import` NI `from` dans le texte, aucun import ES
  // (statique/dynamique) ni ré-export `… from` n'est possible → inutile de
  // parser (cas ultra-majoritaire). Seulement en appel AUTONOME (preAst absent) ;
  // quand l'AST est partagé il est déjà disponible, on le réutilise.
  if (preAst === undefined && !js.includes('import') && !js.includes('from')) return
  const ast: acorn.Node | null = preAst !== undefined ? preAst : parseModuleAst(js)
  if (!ast) return
  let seenImports = 0
  for (const stmt of (ast as any).body) {
    // `export … from '…'` et `export * from '…'` résolvent un
    // spécificateur de module EXACTEMENT comme un import (échappent au graphe
    // partialDependents/watch) : bannis pareillement. Aucune exemption : la
    // directive `@import` ne génère JAMAIS de ré-export, seulement des imports.
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') {
      if (stmt.source) {
        throw new Error(t(keys?.reexport ?? 'transpiler.reexport-es-interdit', { section: sectionLabel, source: stmt.source?.value ?? '?' }))
      }
      continue
    }
    if (stmt.type !== 'ImportDeclaration') continue
    seenImports++
    if (seenImports <= allowedLeadingImports) continue
    throw new Error(t(keys?.static ?? 'transpiler.import-es-classique-interdit', { section: sectionLabel, source: stmt.source?.value ?? '?' }))
  }
  walk.full(ast, (node: any) => {
    if (node.type !== 'ImportExpression') return
    // seule la forme STATIQUE reste interdite : `Literal` (`import('x')`)
    // ou `TemplateLiteral` SANS expression (`` import(`x.js`) ``, équivalent à
    // une chaîne figée). Tout le reste (Identifier, MemberExpression,
    // CallExpression, template AVEC expression…) est un argument CALCULÉ,
    // invisible au graphe de dépendances de toute façon — cf. commentaire de
    // doctrine ci-dessus.
    const spec = node.source
    const isStatic = spec?.type === 'Literal' || (spec?.type === 'TemplateLiteral' && spec.expressions.length === 0)
    if (!isStatic) return
    throw new Error(t(keys?.dynamic ?? 'transpiler.import-dynamique-interdit', { section: sectionLabel }))
  })
}

// ----------------------------------------------------------------------------
// collectTopLevelDeclarations — les noms déclarés au NIVEAU RACINE d'un module compilé,
// séparés par nature : `binding` (let/var/function/class, réaffectables) ou `const`.
// Source d'autorité pour savoir ce qu'un handler inline voit par closure — l'AST du JS
// ÉMIS, jamais le texte source (un `nom = …` dans un commentaire ou une chaîne n'y est pas).
// ----------------------------------------------------------------------------
function collectTopLevelDeclarations(ast: acorn.Node | null, nature: 'binding' | 'const'): string[] {
  if (!ast) return []
  const out: string[] = []
  const push = (pat: any): void => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier':          out.push(pat.name); break
      case 'ObjectPattern':       for (const p of pat.properties ?? []) push(p.value ?? p.argument); break
      case 'ArrayPattern':        for (const el of pat.elements ?? []) push(el); break
      case 'AssignmentPattern':   push(pat.left); break
      case 'RestElement':         push(pat.argument); break
    }
  }
  for (const rawNode of ((ast as any).body ?? []) as any[]) {
    // `export let x = …`/`export const x = …`/
    //    `export function f(){}` : la déclaration réelle vit dans `node.declaration`,
    //    ignorée jusqu'ici → un module qui EXPORTE une var la perdait de la collecte
    //    (moduleVars comme moduleTopVars) → un handler `@click={x = 3}` déclarait un
    //    `x` LOCAL homonyme au lieu d'écrire la var exportée du module — écriture
    //    perdue en silence.
    const node = rawNode.type === 'ExportNamedDeclaration' && rawNode.declaration ? rawNode.declaration : rawNode
    if (node.type === 'VariableDeclaration') {
      if ((node.kind === 'const') !== (nature === 'const')) continue
      for (const d of node.declarations ?? []) push(d.id)
    }
    else if (nature === 'binding' && (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
      out.push(node.id.name)
    }
  }
  return out
}

// noms qu'un `import` pose au premier niveau d'une section compilée (`import { fmt } from …`,
// `import * as u from …`, `import d from …`) — visibles des gestionnaires par closure
function collectImportNames(ast: acorn.Node | null): string[] {
  const out: string[] = []
  for (const node of ((ast as any)?.body ?? []) as any[]) {
    if (node.type !== 'ImportDeclaration') continue
    for (const s of node.specifiers ?? []) if (s.local?.name) out.push(s.local.name)
  }
  return out
}

// ----------------------------------------------------------------------------
// dropRedundantVarDeclarations — retire d'un JS produit par Coffee les `var X;` SANS valeur
// dont le nom vit déjà dans le corps de fonction où ce code sera inséré. Contrepartie du
// `predeclared` de Civet pour le chemin Coffee (`templateLang: "js"`), qui auto-déclare
// nativement et n'a aucune option pour dire « ce nom existe déjà » : on le laisse compiler,
// puis on enlève la déclaration de trop. Sans ça, `@click={n = 'b'}` posait un `var n;` local
// et l'écriture partait dans une copie jetée à la sortie du handler, en silence.
// Chirurgical par construction : on ne touche QU'À un déclarateur sans initialiseur (Coffee
// hisse toujours ses `var` nus en tête de fonction, jamais avec une valeur) ; une déclaration
// vidée de tous les siens disparaît, les autres gardent les leurs. Réécriture de la FIN vers
// le DÉBUT pour que les offsets restent valides.
// ----------------------------------------------------------------------------
function dropRedundantVarDeclarations(js: string, connus: string[]): string {
  if (connus.length === 0 || !js.includes('var ')) return js
  const known = new Set(connus)
  const ast = parseModuleAst(js)
  if (!ast) return js
  const edits: { start: number; end: number; texte: string }[] = []
  walk.full(ast, (node: any) => {
    if (node.type !== 'VariableDeclaration' || node.kind !== 'var') return
    const gardes = (node.declarations ?? []).filter((d: any) => !(d.init === null && d.id?.type === 'Identifier' && known.has(d.id.name)))
    if (gardes.length === (node.declarations ?? []).length) return
    edits.push({ start: node.start, end: node.end, texte: gardes.length === 0 ? '' : `var ${gardes.map((d: any) => js.slice(d.start, d.end)).join(', ')};` })
  })
  let out = js
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.texte + out.slice(e.end)
  return out
}

// ----------------------------------------------------------------------------
// controlerGestionnairesInline — refuse le lot de gestionnaires inline qui ne peut pas être émis
// tel quel. Deux refus, dans cet ordre :
//   — un gestionnaire qui réaffecte une CONSTANTE visible par closure (`compteur := 0` en Civet,
//     donc `const compteur` en JS), du `<script>` comme du `<script module>` : ces noms sont
//     prédéclarés comme les autres — sans quoi l'écriture partirait dans un `let` local,
//     silencieusement perdue — mais leur réaffectation lèverait « Assignment to constant
//     variable » au premier clic. Autant le dire au build, en nommant l'opérateur à changer ;
//   — un gestionnaire qui réaffecte un nom que le GABARIT lui met en portée (variable ou index
//     d'un `{for}`, `{const}`, valeur `{success}`/`{error}`, `locauxDuGabarit`) : le gestionnaire
//     n'en a qu'une copie, recréée en tête de son code — l'écriture serait perdue sans un mot ;
//   — un lot dont le JavaScript compilé ne s'analyse pas : émis d'un bloc, il ferait refuser le
//     fichier ENTIER au chargement (SyntaxError, page morte) alors que le build était vert.
// Contrôle sur le JavaScript COMPILÉ, par résolution de portée : la recherche du nom dans le texte
// brut refusait à tort un gestionnaire qui déclarait sa propre liaison homonyme (`let compteur` ou
// un paramètre), laissait passer la constante du `<script module>`, absente de sa liste, et
// ratait une cible déstructurée (`[compteur] = …`).
// ----------------------------------------------------------------------------
// défaut de Civet : une flèche `=>` à corps en ligne qui affecte un if/unless/switch/try sort sa variable temporaire derrière la
// flèche, sans accolades (`() =>let ref;if (a) ref = …`), un for ou un while y devient `return for (…)` — signature lue sur la
// ligne de JavaScript produite qui ne s'analyse pas (gestionnaires inline, `<script>`)
const FLECHE_EN_LIGNE_CIVET_RE = /=>\s*let ref\d*;|\breturn (?:for|while) \(/

function controlerGestionnairesInline(js: string, consts: string[], moduleName: string | undefined, locauxDuGabarit: Iterable<string> = []): void {
  const { violation, analysable, erreur } = analyserConstReassign(js, consts, locauxDuGabarit)
  if (violation?.gabarit) throw new Error(t('transpiler.handler-local-gabarit-reaffecte', { moduleName: moduleName ?? '?', nom: violation.name }))
  if (violation) throw new Error(t('transpiler.handler-const-reaffectee', { moduleName: moduleName ?? '?', nom: violation.name }))
  if (!analysable) {
    const vars = { moduleName: moduleName ?? '?', ligne: erreur?.ligne ?? 0, extrait: erreur?.extrait ?? '' }
    // défaut de Civet (FLECHE_EN_LIGNE_CIVET_RE) — la flèche fine d'un gestionnaire est une `=>`. Message de cette forme, avec
    // les deux écritures qui passent
    if (FLECHE_EN_LIGNE_CIVET_RE.test(js.split('\n')[vars.ligne - 1] ?? '')) throw new Error(t('transpiler.handler-fleche-en-ligne', vars))
    throw new Error(t('transpiler.handler-js-invalide', vars))
  }
}

// ----------------------------------------------------------------------------
// lintHandlerSelfRefDeclaration — refuse un handler qui SE LIT lui-même dans sa
// propre déclaration. Tourne sur le batch inline APRÈS l'auto-déclaration (Pass 4) :
// une ligne `nom .= … nom …` veut dire que `nom` n'existe NULLE PART (ni dans le
// `<script>`, ni dans le `<script module>`, ni posé par le template) — le `let` posé
// ici est donc local au handler, et son initialiseur lit une variable encore dans sa
// zone morte : « Cannot access 'nom' before initialization » AU PREMIER CLIC, jamais
// à la compilation. C'est la signature du `$` oublié (`µtoggle(mode, …)` au lieu de
// `µtoggle($mode, …)`). Une locale de travail ordinaire (`tmp .= 3`) ne se relit pas
// elle-même : zéro faux positif par construction.
// ----------------------------------------------------------------------------
function lintHandlerSelfRefDeclaration(src: string, moduleName: string | undefined): void {
  if (!src.includes('.=')) return
  const { masked } = maskStringsAndComments(src)
  for (const ligne of masked.split('\n')) {
    const m = ligne.match(/^\s*([a-zA-Z_]\w*)\s*\.=\s*(.+)$/)
    if (!m) continue
    const [, nom, reste] = m
    // seul l'INITIALISEUR compte : le générateur colle les instructions d'un handler sur
    // une ligne (`tmp .= 3;console.log(tmp)`) — une locale de travail relue PLUS LOIN est
    // parfaitement saine, c'est se relire DANS sa propre valeur qui condamne.
    // Et seule la part ÉVALUÉE TOUT DE SUITE compte : dans `fact .= (n) => … fact(n - 1)`
    // la relecture vit dans un CORPS DE FONCTION, jouée à l'appel, bien après la fin de
    // l'affectation — un helper récursif local est parfaitement valide (faux positif déjà rencontré). On s'arrête donc au premier
    // marqueur de fonction rencontré.
    const rhs = reste.split(';')[0].split(/=>|->|\bfunction\b/)[0]
    // le nom doit apparaître à DROITE en identifiant entier, jamais en propriété (`x.nom`)
    if (!new RegExp(`(?<![\\w.$])${nom}(?![\\w$])`).test(rhs)) continue
    throw new Error(t('transpiler.handler-var-jamais-declaree', { moduleName: moduleName ?? '?', nom }))
  }
}

// ----------------------------------------------------------------------------
// lintHandlerBareMethod — avertit (lint.events, jamais bloquant) d'un gestionnaire (`@click=valider`,
// `@click={valider}`, `@click={valider(1)}`) qui cite NU le nom d'une méthode du composant
// (`@valider = ->`, posée sur l'instance, jamais une variable) alors que ni le `<script>`, ni le
// `<script module>`, ni un import, ni le gestionnaire lui-même ne déclare ce nom : au clic,
// « valider is not defined » en console, rien à l'écran, et le build ne disait rien. Lit le JS
// compilé des gestionnaires : seuls les identifiants en position d'EXPRESSION comptent (jamais une
// propriété `o.valider`, une clé `{ valider: 1 }` ni une déclaration). Un homonyme déclaré dans un
// gestionnaire le masque (faux négatif possible, jamais de fausse alerte). `alreadySaid` : un
// avertissement par nom et par composant, quel que soit le nombre de gestionnaires qui le citent.
// ----------------------------------------------------------------------------
// les fonctions de la fenêtre que le navigateur offre sous leur nom nu : une méthode du composant qui porte
// ce nom ne les masque pas dans un gestionnaire, qui appelle alors la fonction du navigateur
const WINDOW_FUNCTIONS = new Set([
  'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'stop', 'focus', 'blur', 'find', 'scroll', 'scrollTo', 'scrollBy',
  'moveTo', 'moveBy', 'resizeTo', 'resizeBy', 'fetch', 'postMessage', 'atob', 'btoa', 'getSelection', 'getComputedStyle', 'matchMedia',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
])

function lintHandlerBareMethod(inlinesJs: string, methodNames: Set<string>, declared: Set<string>, moduleName: string | undefined, alreadySaid: Set<string>, lint?: LintToggles, colorsEnabled = false, lineOf?: (nom: string) => number | ''): void {
  const cite   = (n: string): boolean => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(inlinesJs)
  const cibles = new Set([...methodNames].filter(n => !declared.has(n) && cite(n)))
  if (cibles.size === 0) return
  let ast: acorn.Node
  try {
    ast = acorn.parse(inlinesJs, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return
  }
  const locaux = new Set<string>()
  const noter = (pat: any): void => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier':        locaux.add(pat.name); break
      case 'ObjectPattern':     for (const p of pat.properties ?? []) noter(p.type === 'RestElement' ? p.argument : p.value); break
      case 'ArrayPattern':      for (const el of pat.elements ?? []) noter(el); break
      case 'AssignmentPattern': noter(pat.left); break
      case 'RestElement':       noter(pat.argument); break
    }
  }
  walk.full(ast, (node: any) => {
    if (node.type === 'VariableDeclarator') noter(node.id)
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      noter(node.id)
      for (const p of node.params ?? []) noter(p)
    }
    else if (node.type === 'CatchClause') noter(node.param)
    else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') noter(node.id)
  })
  // `Identifier` de acorn-walk : les seuls identifiants en position d'expression (une propriété
  // non calculée, une clé, un motif de déclaration passent par d'autres visiteurs)
  walk.simple(ast, {
    Identifier(node: any) {
      if (!cibles.has(node.name) || locaux.has(node.name) || alreadySaid.has(node.name)) return
      alreadySaid.add(node.name)
      const line = typedLine('events', t('transpiler.handler-methode-nue', { moduleName: moduleName ?? '?', nom: node.name, ligne: lineOf?.(node.name) ?? '', fenetre: WINDOW_FUNCTIONS.has(node.name) }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    },
  })
}

// ----------------------------------------------------------------------------
// maskDocBlocks — soustrait les blocs de DOCUMENTATION (`<pre>`, `<code>`,
// commentaires HTML) avant une passe de réécriture de sigils sur le SOURCE BRUT,
// puis les restaure à l'identique. Objectif : le code d'AFFICHAGE des tutos/doc
// (qui montre LITTÉRALEMENT `µ$$X`, `§§X`…) ne doit jamais être transformé comme
// du code exécuté. Le lexer masque déjà pre/code pour ses propres sigils ; ce
// helper étend la même garantie à la passe transpiler amont `µ$$` (0-bis), qui
// opère sur le source complet, template compris.
function maskDocBlocks(src: string): { masked: string; restore: (s: string) => string } {
  const blocks: string[] = []
  const stash = (m: string): string => `\x00MJSDOC${blocks.push(m) - 1}\x00`
  const masked = src
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, stash)
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, stash)
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, stash)
  const restore = (s: string): string =>
    s.replace(/\x00MJSDOC(\d+)\x00/g, (_m, i) => blocks[Number(i)])
  return { masked, restore }
}

// ----------------------------------------------------------------------------
// maskStringsAndComments — variante RÉVERSIBLE (stash + restore, même forme que
// maskDocBlocks) de MASK_STRINGS_AND_COMMENTS_RE : gèle les chaînes littérales
// et commentaires JS/Coffee/Civet le temps d'une passe de réécriture de sigils
// sur le CODE SEUL, puis les restaure À L'IDENTIQUE. `lintSingletonConsume`
// (plus haut) applique la MÊME regex mais en lecture seule (un `scan` jetable,
// jamais réinjecté) — ici le texte doit survivre pour la suite du pipeline,
// d'où stash+restore plutôt que blanchiment espace-à-espace.
// La pré-passe 0-bis de
// `transpile()` (µ$$X→$X) et son miroir `applyMjsSugarToScript` ne masquaient
// QUE `maskDocBlocks` (pre/code/commentaires HTML) : une chaîne JS qui MENTIONNE
// `µ$$X` en exemple (« le singleton s'appelle µ$$count ») était réécrite en
// silence (texte affiché corrompu), un COMMENTAIRE JS qui la mentionne faisait
// throw à tort (`singleton-sans-import`) faute d'usage réel. Même remède que
// (lintSingletonConsume) : masquer AVANT la réécriture, restaurer après.
// ----------------------------------------------------------------------------
function maskStringsAndComments(src: string): { masked: string; restore: (s: string) => string } {
  const blocks: string[] = []
  const stash = (m: string): string => `\x00MJSSTR${blocks.push(m) - 1}\x00`
  const masked = src.replace(MASK_STRINGS_AND_COMMENTS_RE, stash)
  const restore = (s: string): string =>
    s.replace(/\x00MJSSTR(\d+)\x00/g, (_m, i) => blocks[Number(i)])
  return { masked, restore }
}

// ----------------------------------------------------------------------------
// maskStaticHtmlText —
// gèle le texte HTML STATIQUE d'un template (hors `<script>…</script>`, hors
// lignes `@import` — réécrites par CETTE MÊME passe 0-bis, cf. transpile()
// plus bas —, hors sites `{…}` d'interpolation) avant la réécriture µ$$X→$X.
// PARITÉ avec le mécanisme historique : le générateur n'exécute JAMAIS aucun
// sigil sur le texte statique d'un nœud (`case 'text': return node.content`,
// generator/compile.ts — vérifié sur pièce, témoin compilé avec §§X en texte
// nu : survit littéralement) — seul un site `{…}` extrait passe par
// cleanJsExpr/tokenize. Un `µ$$X` écrit en toutes lettres dans un paragraphe
// de doc/tuto (hors <code>, déjà couvert par maskDocBlocks) ne doit donc NI
// throw NI être réécrit : seul un usage RÉEL (`<script>`, `{…}`) est concerné.
// Comptage d'accolades conscient des chaînes imbriquées (même garde que
// interpolateSigils, lexer/index.ts) : `{foo('}')}` reste UNE seule expression
// LIVE, jamais coupée au faux `}` de la chaîne. Détection `<script>`/`@import`
// volontairement simple (non-greedy, même rigueur que maskDocBlocks pour
// <pre>/<code>) : un `</script>` littéral DANS une chaîne du script est un
// piège déjà connu et traité ailleurs, plus rigoureusement (extractSections,
// vue masquée + `m.indices`) — hors périmètre de cette passe amont.
// ----------------------------------------------------------------------------
function maskStaticHtmlText(src: string): { masked: string; restore: (s: string) => string } {
  const blocks: string[] = []
  const stash = (s: string): string => `\x00MJSHTML${blocks.push(s) - 1}\x00`
  let out = ''
  let buf = ''
  const flush = () => { if (buf) { out += stash(buf); buf = '' } }
  const n = src.length
  let i = 0
  while (i < n) {
    // ligne `@import` : directive de compilateur (pas du texte affiché), la
    // MÊME réécriture 0-bis y opère (gère `default µ$$x`/listes `a, µ$$b`) → LIVE.
    if ((i === 0 || src[i - 1] === '\n') && /^[ \t]*@import\b/.test(src.slice(i, i + 20))) {
      flush()
      const nl = src.indexOf('\n', i)
      const end = nl === -1 ? n : nl + 1
      out += src.slice(i, end)
      i = end
      continue
    }
    // `<script …>…</script>` (module ou non) : CODE, jamais du texte affiché → LIVE.
    if (src[i] === '<' && /^<script\b/.test(src.slice(i, i + 8))) {
      flush()
      const closeAt = src.indexOf('</script>', i)
      const end = closeAt === -1 ? n : closeAt + '</script>'.length
      out += src.slice(i, end)
      i = end
      continue
    }
    // `{…}` d'interpolation : site RÉEL de template → LIVE (fin lue par finExpression : chaînes, commentaires
    // et regex compris, cf. header) ; jamais refermée, tout le reste
    if (src[i] === '{') {
      flush()
      const fin = finExpression(src, i)
      const j = fin < 0 ? n : fin
      out += src.slice(i, j)
      i = j
      continue
    }
    buf += src[i]
    i += 1
  }
  flush()
  const restore = (s: string): string =>
    s.replace(/\x00MJSHTML(\d+)\x00/g, (_m, idx) => blocks[Number(idx)])
  return { masked: out, restore }
}

// ----------------------------------------------------------------------------
// sucre universel µfoo → µ.foo, MOINS les runes réservées au lexer (cf.
// sigils.ts, MU_SCRIPT_RUNES) ; bâtie UNE fois hors de la fonction. Corps PARTAGÉ
// avec cleanJs (generator/utils.ts, RE_MU_UNIVERSAL_G) — même texte, une seule
// source (sigils.ts) : c'est l'absence de ce partage qui laissait les runes
// minuscules hors liste blanche (µraw/µsnap/µplay/µinspect) littérales
// dans une expression HTML.
const MU_UNIVERSAL_RE = new RegExp(MU_UNIVERSAL_BODY, 'g')

// ----------------------------------------------------------------------------
// transformCodeOnly — hissée au niveau module (ex-closure locale
// d'applyMjsSugarToScript) : réutilisée à la fois par applyCivetDialectSugar
// (Pass 2/2b ci-dessous) et par les réécritures µ sensibles aux chaînes
// d'applyMjsSugarToScript (plus bas) — SOURCE UNIQUE, jamais deux copies.
// ─── Helper : applique une transformation uniquement sur le CODE ──────────
// Scan caractère par caractère en mémorisant si on est dans une string ou
// un commentaire — les transforms ne touchent jamais ces zones. Évite la
// corruption silencieuse des regex globales (ex: `for x in arr` dans une
// string littérale, `#{x}` dans un commentaire, etc.).
function transformCodeOnly(input: string, transform: (codeChunk: string) => string): string {
  const chunks: string[] = []
  let buf = ''
  let i = 0
  const n = input.length
  const flush = () => { if (buf) { chunks.push(transform(buf)); buf = '' } }
  while (i < n) {
    // Comments : préservés tels quels (transforms `#`→`//` et `###`→`/* */`
    //            ont déjà tourné via passes lang-aware ci-dessus).
    if (input[i] === '/' && input[i + 1] === '/') {
      flush()
      const end = input.indexOf('\n', i)
      const stop = end < 0 ? n : end
      chunks.push(input.slice(i, stop))
      i = stop
      continue
    }
    if (input[i] === '/' && input[i + 1] === '*') {
      flush()
      const end = input.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      chunks.push(input.slice(i, stop))
      i = stop
      continue
    }
    if (input[i] === '#' && input[i + 1] !== undefined && !/[a-zA-Z_!]/.test(input[i + 1])) {
      // Coffee line comment (Coffee target uniquement — le mode non-Coffee
      // a déjà converti `#` → `//` plus haut).
      flush()
      const end = input.indexOf('\n', i)
      const stop = end < 0 ? n : end
      chunks.push(input.slice(i, stop))
      i = stop
      continue
    }
    // littéral regex `/…/` : zone inerte, même branche que generator/utils.ts::mapCodeSegments
    // (quatrième scanner « code-only » du compilateur, même règle) — sans ce
    // garde-fou, `re = /µTotal/` ressortait réécrit `re = /µ.Total/` (MU_UNIVERSAL_RE mordait
    // DANS le littéral). `scanRegexLiteral` rend -1 si aucun `/` fermant avant la fin de ligne :
    // ce `/` retombe alors dans le code ordinaire (division), traité plus bas comme avant.
    if (input[i] === '/' && ouvreUneRegex(input.slice(0, i))) {
      const fin = scanRegexLiteral(input, i)
      if (fin !== -1) {
        flush()
        chunks.push(input.slice(i, fin))
        i = fin
        continue
      }
    }
    // Strings : `"..."`, `'...'`, `` `...` `` (template). Respect des escapes.
    const ch = input[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      flush()
      const quote = ch
      // `let`, pas `const` : réassigné plus bas à CHAQUE interpolation d'un
      // template literal (bug réel) —
      // avec un `const start` figé sur l'ouverture du template, la 2e
      // interpolation d'un même literal (`` `${a},${b}` ``) rejouait
      // `input.slice(start, i + 2)` depuis l'ouverture ORIGINALE au lieu de
      // la position courante, dupliquant tout le préfixe déjà flush dans
      // `chunks` (`` `${a},${b}` `` → `` `${a},`${a},${b}` ``, Civet
      // rejetait ensuite le `)` de trop en aval — « Failed to parse »
      // trompeur, loin du vrai point de faute). Fix : `start` suit la tête
      // de lecture (`start = i` juste après avoir flush le texte brut
      // post-interpolation, cf. plus bas) — la 1ère interpolation reste
      // inchangée (start = ouverture du literal, comme avant).
      let start = i
      i += 1
      while (i < n) {
        if (input[i] === '\\') { i += 2; continue }
        if (input[i] === quote) { i += 1; break }
        // Template literal `${...}` : recurse dans l'expression (qui est du code)
        if (quote === '`' && input[i] === '$' && input[i + 1] === '{') {
          // Capture le segment `...${` brut, puis recurse sur l'expression, dont la fin est lue par
          // finExpression : une accolade dans une chaîne ou une regex de l'expression (`${ $a ? '{' : '' }`)
          // ne compte pas. Jamais refermée : le reste est transformé tel quel, sans `}` ajoutée en fin de script
          chunks.push(input.slice(start, i + 2))
          const fin = finExpression(input, i + 1)
          const exprStart = i + 2
          if (fin < 0) {
            chunks.push(transform(input.slice(exprStart)))
            i = n
            start = n
            break
          }
          chunks.push(transform(input.slice(exprStart, fin - 1)))
          chunks.push('}')
          i = fin
          // Continue dans la string template
          const restStart = i
          while (i < n && input[i] !== '`') {
            if (input[i] === '\\') { i += 2; continue }
            if (input[i] === '$' && input[i + 1] === '{') break
            i += 1
          }
          chunks.push(input.slice(restStart, i))
          // Tout ce qui précède `i` est déjà dans `chunks` (texte brut tout
          // juste poussé ci-dessus) : une éventuelle 2e interpolation doit
          // repartir d'ici, pas de l'ouverture du template (cf. commentaire
          // de tête sur `let start`).
          start = i
          if (input[i] === '`') { chunks.push('`'); i += 1; break }
          continue
        }
        i += 1
      }
      if (i > start && !(quote === '`' && chunks[chunks.length - 1] === '`')) {
        chunks.push(input.slice(start, i))
      }
      continue
    }
    buf += ch
    i += 1
  }
  flush()
  return chunks.join('')
}

// ----------------------------------------------------------------------------
// scanPatternHead / rewriteIndexTargets — motif de destructuration à INDEX
// CALCULÉ : la Pass 4
// ci-dessous (auto-déclaration scope-aware) ratait TOUT motif portant un crochet
// INTERNE — `[arr[0], tmp] = …`, `[$$liste[k], tmp] = …`, `[[a, b], c] = …`,
// `{a: {b}} = o` — l'ancienne regex `[^={}[\]]*` refusait le moindre `[`/`]` à
// l'intérieur du motif et ne matchait RIEN : `tmp`/`a`/`b`/`c` n'étaient JAMAIS
// déclarés → `ReferenceError` au premier clic, alors que le build restait VERT
// (mesuré : zéro erreur de compilation, panne muette à l'exécution seulement).
// scanPatternHead remplace la regex par un parcours équilibré (`[`/`{`/`(` …
// `]`/`}`/`)`, chaînes `'…'`/`"…"`/`` `…` `` sautées, échappements `\` compris) :
// exclut volontairement toute valeur par défaut dans le motif (`[a = 1, b]`, `=`
// nu hors chaîne détecté) — même périmètre minimal qu'avant. rewriteIndexTargets
// distingue ensuite, DANS le motif retenu, un MOTIF IMBRIQUÉ (`[[a, b], c]` — `[`
// précédé de `[`/`{`/`,`/`:`/début/blanc, reste en place) d'un ACCÈS MEMBRE indexé
// (`arr[0]`, `$$liste[k]`, `µ.store.x[k]`, `@items[i]` — `[` précédé d'un
// caractère d'identifiant/`)`/`]`) : ce dernier est réécrit en `.__` (pseudo-
// segment pointé) pour retomber sur dottedRe/memberRe plus bas (racine = cible
// MEMBRE, jamais une variable à déclarer) ; le nom lu DANS l'index (`k`, `i`)
// disparaît avec le crochet — une LECTURE, jamais une cible.
// ----------------------------------------------------------------------------
function skipQuotedSpan(str: string, i: number): number {
  const quote = str[i]
  let j = i + 1
  while (j < str.length && str[j] !== quote) { if (str[j] === '\\') j++; j++ }
  return j < str.length ? j + 1 : str.length
}

// skipCommentSpan — rend l'index JUSTE APRÈS un commentaire `//`/`/* … */` démarrant en `i`, ou -1
// si `i` n'ouvre aucun commentaire : un `/* … */`
// (mono-ligne OU multi-lignes, issu d'un `###…###` Coffee converti par la Pass 1) glissait dans les
// 4 scanners ci-dessous comme un LITTÉRAL REGEX (`ouvreUneRegex` vrai après une virgule,
// `scanRegexLiteral` refermé sur le `/` de `*/`) — la pièce de paramètre qui suivait, non séparée
// par une virgule, sortait GARBAGE et se faisait jeter en silence par `extractParamNames`. Posé
// AVANT le test `ouvreUneRegex` dans chaque scanner (même ordre que `sansCommentaires` plus bas et
// `transformCodeOnly` plus haut : `//`/`/*` toujours testés avant un littéral regex).
function skipCommentSpan(str: string, i: number): number {
  if (str[i] === '/' && str[i + 1] === '/') {
    const e = str.indexOf('\n', i)
    return e === -1 ? str.length : e
  }
  if (str[i] === '/' && str[i + 1] === '*') {
    const e = str.indexOf('*/', i + 2)
    return e === -1 ? str.length : e + 2
  }
  return -1
}

function balancedSpan(str: string, start: number): number {
  let depth = 0
  let i = start
  while (i < str.length) {
    const ch = str[i]
    // Littéral regex `/…/` : un `(`/`[` ÉCHAPPÉ ou en
    // classe À L'INTÉRIEUR faussait `depth` (`f = (re = /\(/) ->` ne refermait jamais son groupe,
    // span PERDU, `re` jamais enregistré) ; heuristique partagée `ouvreUneRegex`/`scanRegexLiteral`
    // (sigils.ts), même garde que transformCodeOnly plus haut
    // Commentaire `//`/`/* … */` sauté AVANT ce test : sinon un bloc
    // `/* … */` se faisait avaler comme un littéral regex (cf. bandeau skipCommentSpan ci-dessus)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    if (ch === '/' && ouvreUneRegex(str.slice(0, i))) {
      const fin = scanRegexLiteral(str, i)
      if (fin !== -1) { i = fin; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; i++; continue }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; i++; if (depth === 0) return i; continue }
    i++
  }
  return -1
}

function hasBareEquals(str: string): boolean {
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '=') return true
    i++
  }
  return false
}

function scanPatternHead(line: string): { lead: string; pattern: string; sp: string; rest2: string } | null {
  const leadLen  = line.length - line.trimStart().length
  const lead     = line.slice(0, leadLen)
  if (line[leadLen] !== '[' && line[leadLen] !== '{') return null
  const end = balancedSpan(line, leadLen)
  if (end === -1) return null
  const pattern = line.slice(leadLen, end)
  if (hasBareEquals(pattern)) return null
  // `\s*` après le `=` (pas `\s+`) : un motif COLLÉ au signe (`[a,b]=x`) est une
  // affectation tout aussi valide qu'espacée (`[a, b] = x`) — exiger un espace
  // rejetait la forme collée avec un message trompeur (sans rapport avec l'espace).
  // `[^=>]` (pas `[^=]`) dans le repli : sans l'exclusion du `>`, un `=` DÉJÀ consommé comme
  // signe d'affectation suivi d'un `>` COLLÉ (`[a,b]=>expr`, flèche Civet, AUCUNE affectation
  // réelle — sucre d'appel « pattern => corps ») retombait dans ce repli (`>` accepté comme
  // « n'importe quel caractère sauf = ») : la flèche perdait son second caractère (`.=>`),
  // Civet refusait de parser. `=>` reste capturable EXPLICITEMENT via l'alternative de gauche
  // (cf. `nom = => expr`, plus bas) quand un ESPACE sépare vraiment le signe de la flèche.
  const rest = line.slice(end).match(/^(\s*)=(\s*(?:=>|[^=>]).*)$/)
  if (!rest) return null
  return { lead, pattern, sp: rest[1], rest2: rest[2] }
}

function rewriteIndexTargets(str: string): string {
  let result       = ''
  let lastNonBlank = ''
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipQuotedSpan(str, i)
      result       += str.slice(i, end)
      lastNonBlank  = str[end - 1] ?? ch
      i = end
      continue
    }
    if (ch === '[' && /[\w$)\]]/.test(lastNonBlank)) {
      const end = balancedSpan(str, i)
      if (end === -1) { result += ch; lastNonBlank = ch; i++; continue }
      result       += '.__'
      lastNonBlank  = '_'
      i = end
      continue
    }
    result += ch
    if (!/\s/.test(ch)) lastNonBlank = ch
    i++
  }
  return result
}

// Une racine APPEL (`globalGetPair()[0]`,
// `f()[0]`) n'est ni pointée ni membre : le `(` collé casse `dottedRe`/`memberRe` (leur tête
// `[a-zA-Z_µ][\w$]*` ne franchit jamais une parenthèse) → extraite comme nom neuf, déclarée ou
// promue à tort (`let [globalGetPair()[0], t] = …` — Civet refuse, « Failed to parse »). Un
// identifiant COLLÉ à `(` (`arr [0]` reste un accès Coffee, jamais un appel : `\s*` volontairement
// absent) voit son groupe de parenthèses équilibré réécrit en `.__` — la racine retombe sous
// dottedRe (cible MEMBRE). Tourne AVANT rewriteIndexTargets, qui traite l'éventuel `[index]` restant.
function rewriteCallRoots(str: string): string {
  let result = ''
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipQuotedSpan(str, i)
      result += str.slice(i, end)
      i = end
      continue
    }
    const head = /^[a-zA-Z_$][\w$]*/.exec(str.slice(i))
    if (head && str[i + head[0].length] === '(') {
      const end = balancedSpan(str, i + head[0].length)
      if (end !== -1) { result += head[0] + '.__'; i = end; continue }
    }
    result += ch
    i++
  }
  return result
}

// extractDestructuredNames — noms SIMPLES liés par un motif de déstructuration DÉJÀ déclaré
// (`{w, h} := f()` / `[a, b] := t` / clé renommée `{x: w}` / défaut `{w = 1}` / reste `{...r}` /
// clé chaîne `{'a-b': w}`) : mêmes règles que la promotion d'un motif NU plus bas dans la Pass 4
// (bandeau détaillé sur memberRe/dottedRe/rewriteIndexTargets/rewriteCallRoots juste avant son
// utilisation) — clés, `...`, accès indexé et toute cible MEMBRE (sigil $/$$/§/§§/@, chemin
// pointé) exclus. Sert à ENREGISTRER (jamais réécrire) les noms qu'un `:=`/`.=` vient de lier,
// pour qu'une réaffectation PLUS BAS (`w = 10`) les voie déjà déclarés au lieu de les repromouvoir
// en `.=` — sinon Civet émet `const {w,h} = f()` PUIS `let w = 10` dans le MÊME scope :
// « Identifier 'w' has already been declared ».
function extractDestructuredNames(pattern: string, reserved: Set<string>): string[] {
  const keyless  = rewriteIndexTargets(rewriteCallRoots(pattern.replace(/\[[^\[\]]*\]\s*:/g, '').replace(/[a-zA-Z_]\w*\s*:/g, '').replace(/\.\.\./g, ' ')))
  const memberRe = /(?<![\w$§@])(\$\$?|§§?|@)\.?([a-zA-Z_]\w*)/g
  const dottedRe = /(?<![\w$§@.])[a-zA-Z_µ][\w$]*(?:\s*\.\s*[a-zA-Z_]\w*)+/g
  return [...keyless.replace(dottedRe, '').replace(memberRe, '').matchAll(/(?<![\w$§@.])[a-zA-Z_]\w*/g)]
    .map(mm => mm[0]).filter(nm => !reserved.has(nm))
}

// Helpers PARAMÈTRES de fonction : la Pass 4
// n'enregistrait JAMAIS les paramètres d'une fonction (`(tmp) ->`) dans le scope qu'elle ouvre —
// trou PRÉEXISTANT (`f = (tmp) ->\n  tmp = 5` cassait déjà sur HEAD, même message), juste
// rendu visible par ce correctif sur un motif de déstructuration. Réutilisent le parcours équilibré de
// balancedSpan/skipQuotedSpan (chaînes sautées, valeurs par défaut et motifs déstructurés compris).
function outermostParenSpans(str: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '(') {
      const end = balancedSpan(str, i)
      if (end === -1) { i++; continue }
      spans.push({ start: i, end })
      i = end
      continue
    }
    i++
  }
  return spans
}

function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    // Commentaire sauté AVANT le test regex (cf. skipCommentSpan)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    // Même garde que balancedSpan : virgule DANS un littéral regex
    // (`/a,b,c/`) n'est jamais un séparateur de paramètres
    if (ch === '/' && ouvreUneRegex(str.slice(0, i))) {
      const fin = scanRegexLiteral(str, i)
      if (fin !== -1) { i = fin; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; i++; continue }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; i++; continue }
    if (ch === ',' && depth === 0) { parts.push(str.slice(start, i)); i++; start = i; continue }
    i++
  }
  parts.push(str.slice(start))
  return parts
}

function firstTopLevelEquals(str: string): number {
  let depth = 0
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    // Commentaire sauté AVANT le test regex (cf. skipCommentSpan)
    const cs = skipCommentSpan(str, i)
    if (cs !== -1) { i = cs; continue }
    // Même garde : `=` DANS un littéral regex n'est jamais le séparateur
    // nom/valeur par défaut
    if (ch === '/' && ouvreUneRegex(str.slice(0, i))) {
      const fin = scanRegexLiteral(str, i)
      if (fin !== -1) { i = fin; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(str, i); continue }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; i++; continue }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; i++; continue }
    if (ch === '=' && depth === 0) return i
    i++
  }
  return -1
}

// Noms de variables à enregistrer depuis une liste de paramètres (`tmp` / `a, b = 1, {c, d},
// ...rest`…) : valeur par défaut retirée (premier `=` de premier niveau), `...` retiré, morceau
// `@prop` ignoré (propriété this, PAS une variable — `(@x) ->` n'enregistre jamais `x`), morceau
// déstructuré (`{…}`/`[…]`) → tous ses identifiants hors clé (`clé:`) et hors mot réservé.
function extractParamNames(paramsSrc: string, reserved: Set<string>): string[] {
  const names: string[] = []
  for (const raw of splitTopLevelCommas(paramsSrc)) {
    const piece = raw.trim()
    if (piece === '' || piece.startsWith('@')) continue
    const eqIdx = firstTopLevelEquals(piece)
    const core  = (eqIdx === -1 ? piece : piece.slice(0, eqIdx)).replace(/\.\.\./g, '').trim()
    if (core === '') continue
    if (core[0] === '{' || core[0] === '[') {
      const inner = core.slice(1, -1).replace(/[a-zA-Z_]\w*\s*:/g, '')
      for (const mm of inner.matchAll(/[a-zA-Z_]\w*/g)) { if (!reserved.has(mm[0])) names.push(mm[0]) }
    } else if (/^[a-zA-Z_]\w*$/.test(core) && !reserved.has(core)) {
      names.push(core)
    }
  }
  return names
}

// La Pass 4 plus bas n'enregistrait les PARAMÈTRES d'une fonction
// que si son groupe `(…)` tenait sur l'UNIQUE ligne finissant par `->`/`=>` : une liste étalée sur
// PLUSIEURS lignes (`f = (\n  a,\n  b = 1\n) ->`) ne laisse voir devant la flèche que le `)` de
// fermeture, seul — `outermostParenSpans(')')` ne rend aucun span, `a`/`b` jamais enregistrés, puis
// réassignés dans le corps comme des variables NEUVES (Civet refuse : « Identifier 'a' has already
// been declared »), et la valeur par défaut (`b = 1`, ligne de continuation) se fait hisser en
// `.= undefined` fantôme comme une affectation de branche. `parenDeltaHorsChaines` (delta `(`/`)`
// hors chaînes/regex/commentaire, même garde que balancedSpan) repère ces listes AVANT la boucle
// principale (cf. pré-passe `multiLineParams` plus bas) : continuation rendue inerte, fermeture
// mémorisée avec l'indentation de la ligne D'OUVERTURE, jamais celle de la fermeture.
// Un COMMENTAIRE sur une ligne de continuation
// d'une liste multi-lignes (`f = (\n  a,\n  // commentaire\n  b\n) ->`) faisait échouer la jonction
// plus bas : `joined` recollait les lignes BRUTES, commentaire compris, et `//` s'y faisait prendre
// pour un littéral regex VIDE par `balancedSpan`/`outermostParenSpans` (`ouvreUneRegex` vrai après
// une virgule) — le texte du commentaire ensuite scanné comme du CODE (apostrophe française →
// chaîne jamais refermée jusqu'à la fin de `joined`, ou parenthèse isolée → compte dépareillé).
// `sansCommentaireFinal` retire ce commentaire de fin de ligne (scanner UNIQUE, réutilisé par
// `parenDeltaHorsChaines` ci-dessous ET par la pré-passe `multiLineParams` plus bas).
// `sansCommentaireFinal` ne connaissait que `//` :
// un commentaire de BLOC `/* … */` (mono-ligne OU multi-lignes, issu d'un `###…###` Coffee converti
// par la Pass 1) sur cette même ligne de continuation subissait EXACTEMENT le même sort qu'un `//`
// non traité — avalé comme un littéral regex par `scanRegexLiteral` (refermé sur le `/` de `*/`),
// pièce garbage jetée en silence par `extractParamNames`. `sansCommentaireFinal` devient
// `sansCommentaires` (MULTI-LIGNES, retire aussi `/* … */`, remplacé par un espace pour ne jamais
// recoller deux jetons) — mêmes deux appelants, et réutilisée par les 4 scanners (balancedSpan,
// splitTopLevelCommas, firstTopLevelEquals, parenDeltaHorsChaines) via le helper partagé
// `skipCommentSpan` posé plus haut à côté de `skipQuotedSpan`.
function sansCommentaires(src: string): string {
  let out = ''
  let i   = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') { const e = skipQuotedSpan(src, i); out += src.slice(i, e); i = e; continue }
    if (ch === '/' && src[i + 1] === '/') { i = skipCommentSpan(src, i); continue }
    if (ch === '/' && src[i + 1] === '*') { i = skipCommentSpan(src, i); out += ' '; continue }
    if (ch === '/' && ouvreUneRegex(src.slice(0, i))) {
      const fin = scanRegexLiteral(src, i)
      if (fin !== -1) { out += src.slice(i, fin); i = fin; continue }
    }
    out += ch
    i++
  }
  return out
}

// blanchirCommentaires — variante de sansCommentaires qui CONSERVE la longueur et les indices de
// ligne/colonne : `sansCommentaires` ci-dessus
// SUPPRIME un `//` (rien émis) et REMPLACE un `/* … */` par UN SEUL espace (peu importe sa taille)
// — la position des caractères qui suivent GLISSE, illisible pour une passe qui doit ensuite
// RÉÉCRIRE la ligne D'ORIGINE à un index précis. Ici, chaque caractère de commentaire devient UN
// ESPACE (les `\n` internes à un bloc multi-lignes restent des `\n`, jamais blanchis) : même
// parcours que `sansCommentaires` (chaînes via `skipQuotedSpan`, regex via `ouvreUneRegex`/
// `scanRegexLiteral`, `//`/`/* … */` reconnus par `skipCommentSpan`), mais
// `blanchirCommentaires(s).length === s.length` et le découpage par `\n` tombe sur le MÊME nombre
// de lignes — la Pass 4 plus bas DÉTECTE sur le texte blanchi et RÉÉCRIT sur la ligne brute, index
// par index. `sansCommentaires` reste inchangée pour ses appelants existants (parenDeltaHorsChaines,
// région jointe de `multiLineParams`) : deux besoins différents, deux fonctions.
function blanchirCommentaires(src: string): string {
  let out = ''
  let i   = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') { const e = skipQuotedSpan(src, i); out += src.slice(i, e); i = e; continue }
    if (ch === '/') {
      const cs = skipCommentSpan(src, i)
      if (cs !== -1) { for (let k = i; k < cs; k++) out += src[k] === '\n' ? '\n' : ' '; i = cs; continue }
      if (ouvreUneRegex(src.slice(0, i))) {
        const fin = scanRegexLiteral(src, i)
        if (fin !== -1) { out += src.slice(i, fin); i = fin; continue }
      }
    }
    out += ch
    i++
  }
  return out
}

function parenDeltaHorsChaines(line: string): number {
  const code = sansCommentaires(line)
  let delta  = 0
  let i      = 0
  while (i < code.length) {
    const ch = code[i]
    // Commentaire sauté AVANT le test regex (cf. skipCommentSpan) : sans
    // objet ici la plupart du temps (`code` déjà nettoyé ci-dessus), même garde que les 3 autres
    // scanners par cohérence — un appelant qui passerait un jour du texte NON nettoyé reste protégé
    const cs = skipCommentSpan(code, i)
    if (cs !== -1) { i = cs; continue }
    if (ch === '/' && ouvreUneRegex(code.slice(0, i))) {
      const fin = scanRegexLiteral(code, i)
      if (fin !== -1) { i = fin; continue }
    }
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuotedSpan(code, i); continue }
    if (ch === '(') delta++
    else if (ch === ')') delta--
    i++
  }
  return delta
}

// ----------------------------------------------------------------------------
// applyCivetDialectSugar — sous-ensemble d'applyMjsSugarToScript : UNIQUEMENT les
// passes de dialecte Coffee/Civet des composants (commentaires `#`, `for…in`→`for…of`,
// `isnt`, interpolation `"#{}"`, auto-déclaration scope-aware des assignations nues) —
// AUCUNE transformation de symbole MJS ($x/@x/§/µ-runes, store µ$X, routage
// µ.emit→@_mjs_emit…), qui exigent un composant réactif (this, µ.state, template)
// absent d'un fichier serveur. Extraite pour réutilisation par `mjs ws` (compilation
// des `*.server.mjs`, cf. cli/server-entry.ts compileServerFile) SANS dupliquer cette logique :
// SOURCE UNIQUE — applyMjsSugarToScript l'appelle ci-dessous pour son propre usage
// composant (comportement 100% inchangé, cf. tests existants sur applyMjsSugarToScript).
// ----------------------------------------------------------------------------
// `firstLine` : la ligne du fichier où tombe la première ligne de `src` (la balise <script>), pour citer une faute à sa ligne réelle
export function applyCivetDialectSugar(src: string, lang?: string, predeclared?: string[], firstLine = 1): string {
  let out = src

  // ─── Pass 1 : conversion `#` Coffee comment → `//` JS comment ─────────────
  // Sauf cible Coffee ou champ privé `#identifier`. Civet/TS/JS parsent `# foo`
  // comme `this.length(foo)` — erreur runtime garantie. Cette pass DOIT
  // précéder transformCodeOnly puisque celui-ci s'appuie sur `//` JS comments.
  //
  // Scan caractère-par-caractère (PAS une regex `^...#` limitée au début de
  // ligne) : un commentaire `#` INLINE après du code (`$x = 'ds'  # note`)
  // était sinon laissé tel quel → Civet le compilait en JS valide mais FAUX
  // (`'ds'(this.length(note))`) sans aucune erreur. On convertit donc `#` et
  // `###` en commentaires JS partout, en préservant chaînes, heredocs
  // (`"""`/`'''`), template literals, `//`/`/* */` déjà présents, et les champs
  // privés `#identifier` (et `#!`).
  if (lang !== 'coffee') {
    let conv = ''
    let ci = 0
    const cn = out.length
    while (ci < cn) {
      const c = out[ci], c1 = out[ci + 1], c2 = out[ci + 2]
      // `### ... ###` (début de ligne OU inline) → `/* ... */` ; un `*/` du contenu (motif de chemin
      // `src/**/*.json`) devient `*\/`, sinon il refermait le commentaire au milieu
      if (c === '#' && c1 === '#' && c2 === '#') {
        const end = out.indexOf('###', ci + 3)
        conv += '/*' + out.slice(ci + 3, end < 0 ? cn : end).replace(/\*\//g, '*\\/') + '*/'
        ci = end < 0 ? cn : end + 3
        continue
      }
      // heredocs `"""..."""` / `'''...'''` → inchangés (un `#` dedans est du texte)
      if ((c === '"' && c1 === '"' && c2 === '"') || (c === "'" && c1 === "'" && c2 === "'")) {
        const q3 = c + c + c
        const end = out.indexOf(q3, ci + 3)
        const stop = end < 0 ? cn : end + 3
        conv += out.slice(ci, stop)
        ci = stop
        continue
      }
      // template literal `` `...` `` → MULTI-LIGNES, inchangé : un `#`
      // dans un backtick multi-ligne est du TEXTE (ou une interpolation `${…}`),
      // jamais un commentaire. Le borner au `\n` (comme les mono-lignes) faisait
      // scanner les lignes SUIVANTES comme du code et y convertir `#`→`//`,
      // corrompant silencieusement le contenu utilisateur.
      if (c === '`') {
        conv += c
        ci++
        while (ci < cn) {
          if (out[ci] === '\\') { conv += out.slice(ci, ci + 2); ci += 2; continue }
          conv += out[ci]
          if (out[ci] === '`') { ci++; break }
          ci++
        }
        continue
      }
      // chaîne `"…"` lue au niveau (lecteur du lexeur) : une interpolation `#{…}` y porte ses propres guillemets — le `#{`
      // d'une chaîne écrite DANS l'interpolation n'est pas un commentaire (il sortait en `//{…}`)
      if (c === '"') {
        const e = scanDoubleQuoteAt(out, ci)
        if (e > 0) { conv += out.slice(ci, e); ci = e; continue }
      }
      // chaînes mono-ligne `"..."` `'...'` → inchangées (escapes, bornées à la ligne)
      if (c === '"' || c === "'") {
        conv += c
        ci++
        while (ci < cn) {
          if (out[ci] === '\\') { conv += out.slice(ci, ci + 2); ci += 2; continue }
          if (out[ci] === '\n') break
          conv += out[ci]
          if (out[ci] === c) { ci++; break }
          ci++
        }
        continue
      }
      // `//` ligne et `/* */` bloc déjà-JS → inchangés
      if (c === '/' && c1 === '/') { const e = out.indexOf('\n', ci); const s = e < 0 ? cn : e; conv += out.slice(ci, s); ci = s; continue }
      if (c === '/' && c1 === '*') { const e = out.indexOf('*/', ci + 2); const s = e < 0 ? cn : e + 2; conv += out.slice(ci, s); ci = s; continue }
      // littéral regex `/…/` : zone inerte, même garde que transformCodeOnly plus bas —
      // sans ce garde-fou, `re = /#\d/` voyait son `#` (suivi
      // d'un `\`, non alphanumérique) converti par la branche `#` juste en dessous : `re = ///\d/`,
      // échec de compilation bruyant mais FAUX (`/#\d/` est un regex légitime). Contexte gauche lu sur
      // la source `out` : relire `conv`, en construction, l'aplatissait à chaque `/` (coût quadratique).
      // Les deux ne diffèrent que par la marque des commentaires déjà convertis (`#` ou `//`, `###` ou
      // `/* */`), ni signe ni mot-clé : ouvreUneRegex rend la même réponse.
      if (c === '/' && ouvreUneRegex(out.slice(0, ci))) {
        const fin = scanRegexLiteral(out, ci)
        if (fin !== -1) { conv += out.slice(ci, fin); ci = fin; continue }
      }
      // `#` commentaire (sauf champ privé `#id` / `#!`) → `//` jusqu'à la fin de ligne
      if (c === '#' && !(c1 !== undefined && /[a-zA-Z_!]/.test(c1))) {
        const e = out.indexOf('\n', ci); const s = e < 0 ? cn : e
        conv += '//' + out.slice(ci + 1, s)
        ci = s
        continue
      }
      conv += c
      ci++
    }
    out = conv
  }

  // un <script lang="js"> ou lang="ts" est du JavaScript ou du TypeScript ordinaire : les passes 2 à 4 (dialecte
  // façon Coffee du Civet) n'y ont pas cours — un paramètre réaffecté y recevait `a .= undefined` (construction
  // refusée sur du code que l'auteur n'a pas écrit), une chaîne `"prix #{n}"` y devenait un gabarit qui évaluait `n`
  if (lang === 'js' || lang === 'ts') return out

  // ─── Pass 2 : `for X in Y` (Coffee values) → `for X of Y` (Civet/JS values).
  // Uniquement sur le CODE (transformCodeOnly évite les strings/comments). SKIP Coffee : `for x in` y parcourt déjà les
  // valeurs, et `for x of` les CLÉS d'un objet — la boucle recevait « 0 », « 1 »… au lieu des éléments.
  if (lang !== 'coffee') {
    out = transformCodeOnly(out, (code) =>
      code.replace(
        /\bfor(\s+[a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)?\s+)in(\s+)/g,
        'for$1of$2'
      )
    )
  }

  // ─── Pass 2b : `isnt` (Coffee) → `is not` (que Civet transforme en `!==`).
  // Civet ne connaît PAS `isnt` : il parse `a isnt b` comme l'appel
  // `a(isnt(b))` → `ReferenceError: isnt is not defined` au runtime.
  // DOIT tourner AVANT la Pass 3 (interpolation) : à ce stade les `"#{…}"` sont
  // encore des strings double-quote que transformCodeOnly saute proprement —
  // après Pass 3 ce sont des template literals que transformCodeOnly corromprait
  // en les re-sérialisant. SKIP Coffee : `isnt` natif, et `is not` y = `=== !`.
  //
  // Garde-fou AVANT le remplacement : `isnt` est aussi un identifiant JS valide
  // (nom de variable) — le replace texte aveugle mangerait `$isnt = 5` en
  // `$is not = 5` (ParseError Civet cryptique, « Found: "not" », loin de la
  // vraie faute). Sur les MÊMES segments code-only (même appel
  // transformCodeOnly) : `$isnt` en lecture, ou toute AFFECTATION à `isnt` nu
  // → erreur MJS explicite. L'usage OPÉRATEUR (`a isnt b`) n'est jamais capté
  // (jamais précédé d'un `$`, jamais suivi d'un opérateur d'affectation).
  if (lang !== 'coffee') {
    out = transformCodeOnly(out, (code) => {
      if (/\$isnt\b/.test(code) || /(^|[\n;({,])\s*isnt\s*(=(?!=)|\+=|-=|\*=|\/=|\|\|=|&&=|\?\?=|\+\+|--)/.test(code)) {
        throw new Error(t('transpiler.isnt-identifiant-reserve'))
      }
      return code.replace(/\bisnt\b/g, 'is not')
    })
  }

  // ─── Pass 3 : interpolation Coffee `"...#{X}..."` → template `\`...${X}...\``
  // Spécifique aux double-quote strings (cohérent avec Coffee qui n'interpole
  // pas les single-quotes).
  // SKIP Coffee : il interpole `#{}` NATIVEMENT — convertir ici produisait des
  // backticks que Coffee insère VERBATIM comme du JS embarqué → sortie invalide
  // (tout composant coffee migré V1 utilisant l'interpolation était cassé).
  // Scan séquentiel CONTEXTE-AWARE : les `"…"` à l'intérieur de single-quotes,
  // commentaires, template literals ou heredocs `'''` restent intacts — avant,
  // une regex globale corrompait `'voir "#{x}"'` et transformait `"""…#{x}…"""`
  // en triple-backtick (SyntaxError Civet) : la cause racine du « Failed to
  // parse » historique sur les interpolations.
  // conversion partagée avec les expressions du gabarit : convertCoffeeInterpolations (lexer/index.ts)
  if (lang !== 'coffee') {
    out = convertCoffeeInterpolations(out)
  }

  // ─── Pass 4 : auto-déclaration scope-aware (mimique Coffee `var`-hoist) ───
  // SKIP pour Coffee (auto-déclare nativement et rejette `.=`).
  if (lang !== 'coffee') {
    const RESERVED = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'unless', 'when', 'then', 'try', 'catch', 'finally', 'throw',
      'new', 'class', 'extends', 'this', 'super', 'true', 'false', 'null',
      'undefined', 'typeof', 'instanceof', 'in', 'of', 'and', 'or', 'not', 'is',
      'isnt', 'function', 'let', 'const', 'var', 'export', 'import', 'from',
      'await', 'async', 'yield', 'delete', 'void',
    ])
    const lines = out.split('\n')
    // `lignesCode` (blanchirCommentaires, cf. son
    // bandeau plus haut) BLANCHIT les commentaires de tout `out` EN UNE SEULE PASSE (bloc multi-lignes
    // compris) avant que la Pass 4 ne détecte quoi que ce soit dessus : `inertLines`, la pré-passe
    // `multiLineParams` et la boucle principale plus bas lisent TOUTES `lignesCode[li]`, jamais
    // `lines[li]` directement, sauf pour la RÉÉCRITURE finale qui vise la ligne D'ORIGINE (mêmes
    // indices, grâce au blanchiment qui préserve la longueur). Invariant vérifié une fois ici : une
    // divergence signale un bug du blanchiment, jamais une entrée utilisateur.
    const lignesCode = blanchirCommentaires(out).split('\n')
    if (lignesCode.length !== lines.length) throw new Error('[transpiler] blanchirCommentaires a changé le nombre de lignes — invariant Pass 4 rompu')
    // Lignes dont le DÉBUT tombe dans une CHAÎNE multi-ligne (template literal
    // ou heredoc) : INERTES pour cette passe — sinon un `foo = bar` à
    // l'intérieur d'une chaîne était réécrit `foo .= bar` (contenu corrompu en
    // silence) et ses `->`/`then` faussaient la pile de scopes.
    // Un bloc `/* … */` (issu d'un `###…###` Coffee,
    // converti par la Pass 1 plus haut) n'était JAMAIS suivi ici : une affectation À L'INTÉRIEUR
    // d'un tel commentaire (`###\n[arr[0], tmp] = x\n###`) était hissée comme du code réel — un
    // commentaire n'est jamais du code.
    // Le remède ci-dessus (`wasBlank`) marquait
    // inerte TOUTE ligne où un bloc `/* … */` OUVRE en tête, qu'il se REFERME ou non sur cette même
    // ligne : un commentaire MONO-ligne en tête (`/* c */ x = 1`) tombait dans le même sac qu'un
    // commentaire étalé sur plusieurs lignes — `x` jamais auto-déclaré, `ReferenceError` au montage.
    // Pire, une liste de paramètres multi-lignes refermée par un commentaire qui se clôt SUR la ligne
    // `) ->` (`b /* x\n  y */) ->`) rendait CETTE ligne de fermeture inerte : son `)` n'était jamais
    // compté par la pré-passe `multiLineParams` plus bas, `depth` ne retombait jamais à 0, la liste
    // entière disparaissait — `a`/`b` hissés en `.= undefined` fantômes. Un commentaire n'est plus une
    // raison de rendre une ligne inerte : c'est `lignesCode` (blanchi à espaces, cf. plus haut) qui
    // absorbe désormais les commentaires pour la DÉTECTION ; seule une vraie CHAÎNE multi-lignes
    // (`` ` ``/`"""`/`'''`) encore ouverte à la fin de la ligne précédente reste inerte ici. Le mode
    // `/*` reste SUIVI dans cette IIFE (pour ne pas confondre un guillemet DANS un commentaire avec
    // l'ouverture d'une chaîne) mais ne marque plus jamais de ligne inerte lui-même. La passe finale
    // sur les lignes `//` pures a disparu : une telle ligne, une fois blanchie, est VIDE
    // (`codeLine.trim() === ''`), écartée par la boucle principale AVANT même de consulter
    // `inertLines` — même résultat, un test en moins.
    const inertLines = (() => {
      const inert = new Set<number>()
      let line = 0
      let i = 0
      const n = out.length
      let mode: '`' | '"""' | "'''" | '/*' | null = null
      while (i < n) {
        const ch = out[i]
        if (ch === '\n') { line++; if (mode && mode !== '/*') inert.add(line); i++; continue }
        if (mode) {
          if (mode === '`' && ch === '\\') { i += 2; continue }
          if (mode === '`' && ch === '`') { mode = null; i++; continue }
          if (mode === '"""' && out.startsWith('"""', i)) { mode = null; i += 3; continue }
          if (mode === "'''" && out.startsWith("'''", i)) { mode = null; i += 3; continue }
          if (mode === '/*' && out.startsWith('*/', i)) { mode = null; i += 2; continue }
          i++; continue
        }
        if (ch === '#' || (ch === '/' && out[i + 1] === '/')) { const e = out.indexOf('\n', i); i = e === -1 ? n : e; continue }
        if (out.startsWith('"""', i)) { mode = '"""'; i += 3; continue }
        if (out.startsWith("'''", i)) { mode = "'''"; i += 3; continue }
        if (ch === '`') { mode = '`'; i++; continue }
        if (ch === '/' && out[i + 1] === '*') { mode = '/*'; i += 2; continue }
        if (ch === '"' || ch === "'") {
          let j = i + 1
          while (j < n && out[j] !== ch && out[j] !== '\n') { if (out[j] === '\\') j++; j++ }
          i = (j < n && out[j] === ch) ? j + 1 : j
          continue
        }
        i++
      }
      return inert
    })()
    // pré-passe liste de paramètres MULTI-LIGNES (cf. bandeau
    // `parenDeltaHorsChaines` plus haut) : une région ouverte par un delta `(`/`)` positif et refermée
    // par une ligne `)…->`/`)…=>` devient une entrée de `multiLineParams` (clé = ligne de FERMETURE,
    // valeur = paramètres joints + indentation de la ligne D'OUVERTURE) ; ses lignes de continuation
    // rejoignent `inertLines`. Une région refermée SANS flèche (appel multi-lignes `foo(\n  a\n)`) ne
    // marque rien — comportement inchangé.
    const multiLineParams = new Map<number, { params: string; openIndent: number }>()
    {
      let openLine = -1
      let depth    = 0
      for (let li = 0; li < lines.length; li++) {
        if (inertLines.has(li)) continue
        // `lignesCode[li]` (blanchi, cf. bandeau `lignesCode` plus haut)
        // remplace `lines[li]` : un commentaire qui ferme EN COURS de ligne (`y */) ->`) laissait
        // passer un `/` isolé que l'heuristique regex de `parenDeltaHorsChaines` pouvait à tort
        // apparier plus loin sur la ligne, avalant le `)` réel — le blanchiment retire le risque à la
        // source (plus aucun caractère de commentaire ne subsiste pour l'heuristique).
        const delta = parenDeltaHorsChaines(lignesCode[li])
        if (depth === 0) {
          if (delta > 0) { openLine = li; depth = delta }
          continue
        }
        depth += delta
        if (depth < 0) { depth = 0; openLine = -1; continue }
        if (depth === 0) {
          const trimmedEnd = lignesCode[li].replace(/\s+$/, '')
          if (trimmedEnd.endsWith('->') || trimmedEnd.endsWith('=>')) {
            const beforeArrow = trimmedEnd.slice(0, -2).replace(/\s+$/, '')
            if (beforeArrow.endsWith(')')) {
              // `sansCommentaires` (remplace `sansCommentaireFinal`) tourne
              // sur la région JOINTE en UN seul passage (MULTI-LIGNES) : un `/* … */` qui s'étale sur
              // plusieurs lignes de continuation (`###…###` Coffee) n'était sinon jamais reconnu par un
              // nettoyage LIGNE PAR LIGNE (chaque ligne isolée n'y voyait qu'un `/*` jamais refermé, ou
              // un `*/` jamais ouvert).
              const regionSrc = sansCommentaires(lines.slice(openLine, li + 1).join('\n')).split('\n').filter((l) => l.trim() !== '')
              const joinedRaw = regionSrc.join('\n').replace(/\s+$/, '')
              const joined    = joinedRaw.slice(0, -2).replace(/\s+$/, '')
              const spans     = outermostParenSpans(joined)
              const span      = spans[spans.length - 1]
              if (span && span.end === joined.length) {
                const params     = joined.slice(span.start + 1, span.end - 1)
                const openIndent = lines[openLine].length - lines[openLine].trimStart().length
                multiLineParams.set(li, { params, openIndent })
                for (let mi = openLine + 1; mi < li; mi++) inertLines.add(mi)
              }
            }
          }
          openLine = -1
          depth    = 0
        }
      }
    }
    // Seed le scope racine avec les vars déjà déclarées ailleurs (ex: les vars
    // top-level du `<script module>` partagé). Sinon une réassignation comme
    // `current = audio` dans le `<script>` composant est promue à tort en `.=`
    // (let block-scopé) → shadow + TDZ « Cannot access 'current' before
    // initialization » (cas vécu : tuto audio-player, `current` module-scope).
    // piège des branches — un `.=` posé DANS une branche if/else (au lieu du sommet de
    // la portée) déclare un `let` scopé au bloc : la branche sœur retombe sur
    // une var inexistante → ReferenceError. `bodyIndent`/`insertAt` mémorisent
    // où commence le CORPS de chaque portée (racine comprise) : une affectation
    // plus profonde que ce corps est HISSÉE (`pendingHoists`) plutôt que
    // déclarée sur place — if/else/for/switch/when ne poussent pas de portée
    // (cf. plus bas), donc « plus profond que le corps » ⇔ « dans une branche ».
    // `constDeclared` (sous-ensemble de `declared`) : les noms liés par `:=` (constante Civet),
    // jamais ceux liés par `.=` (mutable) — sert plus bas à refuser À LA COMPILATION la
    // réaffectation nue d'un nom const, plutôt que de laisser Civet produire un « TypeError:
    // Assignment to constant variable » seulement à l'exécution. Racine vide : un nom prédéclaré
    // (vars du `<script module>` partagé, d'un handler) n'est jamais connu comme const ICI —
    // le contrôle des gestionnaires (plus haut dans ce fichier) couvre déjà ce cas, sur sa
    // propre liste : les constantes du `<script>` et celles du `<script module>`.
    const scopes: { indent: number; declared: Set<string>; constDeclared: Set<string>; bodyIndent: number | null; insertAt: number | null }[] = [{ indent: -1, declared: new Set(predeclared ?? []), constDeclared: new Set(), bodyIndent: null, insertAt: null }]
    const pendingHoists: { insertAt: number; indent: number; name: string }[] = []
    // Refus IMMÉDIAT d'une constante réaffectée (avec la ligne de la source) seulement quand c'est
    // SÛR : au niveau du corps de la portée, sur une ligne qui n'ouvre à elle seule ni fonction ni
    // bloc. Plus profond (branche, `catch e`, corps d'une méthode `nom(x)` ou d'une `function`, que
    // cette passe ne sait pas reconnaître comme portées) ou à côté d'une fonction écrite en ligne,
    // un homonyme local est possible : le contrôle fait APRÈS compilation sur le JavaScript
    // (const-reassign.ts, portées exactes) tranche alors, sans faux refus.
    let niveauSur = false
    const constanteSure = (nom: string): boolean => niveauSur && scopes[scopes.length - 1].constDeclared.has(nom)
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      // `codeLine` (blanchi, hissé ici EN TÊTE de boucle) sert à TOUTE
      // détection ci-dessous (vide, motif d'affectation, tête de destructuration, variante en ligne
      // if/unless/else, déclarations explicites, fin de bloc `->`/`=>`/`then`/`do`) ; `line` (brute)
      // ne sert plus qu'à la RÉÉCRITURE finale, par découpe à un index calculé sur `codeLine` — les
      // deux chaînes ont la MÊME longueur, le même index tombe donc au même endroit dans les deux.
      const codeLine = lignesCode[li]
      if (codeLine.trim() === '') continue
      if (inertLines.has(li)) continue
      // un commentaire de bloc peut précéder le code SUR la même ligne (`/* c */ x = 1`) : son
      // indentation UTILE est celle du code, pas celle du premier caractère brut de la ligne —
      // `codeLine` blanchi (le commentaire y devient du blanc) donne directement la bonne valeur.
      const indent = codeLine.length - codeLine.trimStart().length
      // Pop les scopes dont l'indent est >= au courant
      while (scopes.length > 1 && scopes[scopes.length - 1].indent >= indent) {
        scopes.pop()
      }
      // 1re ligne du corps de la portée courante (racine comprise) → fige le
      // point de hissage (bodyIndent/insertAt) une fois pour toute la portée
      const topScope = scopes[scopes.length - 1]
      if (topScope.bodyIndent === null) {
        topScope.bodyIndent = indent
        topScope.insertAt = li
      }
      niveauSur = indent <= topScope.bodyIndent && !/->|=>|\b(?:function|class|catch)\b|\)\s*\{/.test(codeLine)
      // affectation COMPOSÉE ou incrément/décrément (`w += 1`, `w++`, `--w`) : jamais reconnue
      // par le motif d'affectation SIMPLE plus bas (son `=` n'y est jamais collé directement au
      // nom) — une réaffectation quand même, soumise à la MÊME garde de constance, restreinte à
      // CETTE portée (pas une ancêtre, cf. bandeau plus bas). Lookbehind qui exclut un `.`/`$`
      // immédiatement avant le nom : une PROPRIÉTÉ (`w.x += 1`) ou un état réactif (`$w += 1`,
      // mécanisme distinct) n'est jamais concerné.
      const compoundRe = /(?<![\w.$])([a-zA-Z_]\w*)\s*(?:\+\+|--|(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])=)|(?:\+\+|--)\s*([a-zA-Z_]\w*)(?![\w$])/g
      let cm: RegExpExecArray | null
      while ((cm = compoundRe.exec(codeLine)) !== null) {
        const nomCompose = cm[1] ?? cm[2]
        if (RESERVED.has(nomCompose)) continue
        if (constanteSure(nomCompose)) {
          throw new Error(t('transpiler.civet-reaffectation-constante', { nom: nomCompose, ligne: li + firstLine }))
        }
      }
      // "bonus mémoire" — `[^=]`
      // juste après le `\s+` visait à exclure un faux positif du style
      // `nom = = 5` (double `=` espacé) — mais `[^=]` exclut AUSSI le premier
      // caractère d'un `=>` (fat arrow) légitime : `nom = => expr` n'était
      // JAMAIS promu en déclaration `.=`, contrairement à `nom = -> expr` qui
      // fonctionnait très bien (aucun rapport avec `=>` spécifiquement dans le
      // reste de la passe — seul CE garde-fou le bloquait). **Vérifié
      // empiriquement** sur le compilateur Civet réel : sans `.=`, `nom = ...`
      // (les DEUX formes) compile en une assignation NUE `nom = function(){}`
      // sans aucun `var`/`let`/`const` → le module ES généré (toujours strict)
      // lève `ReferenceError: nom is not defined` dès l'exécution — un module
      // qui plante à l'init, pas juste "silencieusement inerte". Fix :
      // `(?:=>|[^=])` — autorise explicitement `=>` en plus de tout caractère
      // qui n'est pas `=`, en gardant l'exclusion originale d'un `=` nu.
      // `\s*` (pas `\s+`) avant ce groupe : `x=5`/`x =5` (collé au signe, espacé
      // avant seulement) sont des affectations tout aussi valides que `x = 5` —
      // exiger un espace les laissait NUES, avec un message trompeur en aval
      // (« nom jamais déclaré », qui ne dit jamais que l'espace en est la cause).
      // Toujours sans capturer `==`/`===`/`>=`/`<=`/`!=` : la position DEVANT ce
      // groupe exige déjà un `=` littéral juste après `(\s*)`, donc `>=`/`<=`/`!=`
      // ne matchent jamais ici (le caractère avant le `=` n'est pas un blanc), et
      // `[^=]` exclut toujours un second `=` nu juste après (`==`/`===`).
      // `[^=>]` (pas `[^=]`) : sans l'exclusion du `>`, une flèche Civet COLLÉE au nom
      // (`queueMicrotask =>`/`x=>y`, sucre d'appel « nom => corps », AUCUNE affectation) voyait
      // son `=` déjà consommé comme signe d'affectation, puis le `>` restant accepté par ce repli
      // (« n'importe quel caractère sauf = ») — la flèche perdait son second caractère (`.=>`),
      // Civet refusait de parser (cas réel : `queueMicrotask =>` suivi d'un bloc indenté).
      // `=>` reste capturable EXPLICITEMENT via l'alternative de gauche quand un ESPACE sépare
      // vraiment le signe d'affectation de la flèche (`nom = => expr`, cf. plus haut).
      const m = codeLine.match(/^(\s*)([a-zA-Z_]\w*)(\s*)=(\s*(?:=>|[^=>]).*)$/)
      if (m) {
        const [, lead, name, sp, rest2] = m
        if (!RESERVED.has(name) && !line.includes(':=') && !line.includes('.=')) {
          const alreadyDeclared = scopes.some(s => s.declared.has(name))
          if (!alreadyDeclared) {
            topScope.declared.add(name)
            // plus profond que le corps de la portée → dans une branche : hisser.
            // sinon, si `rest2` est un `if`/`unless` POSTFIX (pas préfixe : un
            // if-EXPRESSION `x = if a then 1 else 2` garde le `.=` en place,
            // comportement historique inchangé) → même hissage, le `.=` sous
            // postfix produirait le même let-scopé-au-bloc que le piège des branches.
            const startsIfUnless  = /^\s*(?:if|unless)\b/.test(rest2)
            const postfixIfUnless = !startsIfUnless && /\s(?:if|unless)\s/.test(rest2)
            if (indent > topScope.bodyIndent || postfixIfUnless) {
              pendingHoists.push({ insertAt: topScope.insertAt, indent: topScope.bodyIndent, name })
            } else {
              // réécriture par DÉCOUPE de `line` (brute), jamais par
              // concaténation de `lead`/`name`/`sp` (issus de `codeLine`, blanchi) : un commentaire en
              // tête (`/* c */ x = 1`) serait sinon remplacé par du blanc dans la sortie. `posEq` est
              // l'index du `=` dans `codeLine` — le MÊME index tombe sur le `=` de `line` (longueurs
              // identiques, cf. bandeau `blanchirCommentaires`).
              const posEq = lead.length + name.length + sp.length
              lines[li] = line.slice(0, posEq) + '.=' + line.slice(posEq + 1)
            }
          } else if (constanteSure(name)) {
            // `name` lié par `:=` (constante) DANS CETTE MÊME portée (pas une ancêtre — même
            // politique que le bundler, « au même niveau » : une fonction imbriquée qui REÇOIT
            // juste une variable externe n'est pas suivie, seul le niveau qui a posé le `:=`
            // l'est). Civet compile `:=` en `const` : réaffecter planterait PROPREMENT mais
            // SEULEMENT à l'exécution (« Assignment to constant variable »), le build restant
            // vert. Refus À LA COMPILATION, message qui nomme l'identifiant, la ligne fautive et
            // la solution.
            throw new Error(t('transpiler.civet-reaffectation-constante', { nom: name, ligne: li + firstLine }))
          }
        }
      } else {
        // Destructuring : `{ a, b } = expr` / `[ a, b ] = expr` → déclaration
        // `.=` (Civet : `.=` → `let { a, b } = expr`). Sans ça Civet émet une
        // réassignation `({a,b} = expr)` à des vars non déclarées → ReferenceError
        // (`left is not defined`). Cas vécu : seek slider audio-player, bind-this.
        // Même fix `=>` que ci-dessus (cohérence, cf. commentaire détaillé).
        // L'ancienne regex `[^={}[\]]*` refusait tout crochet INTERNE au motif :
        // `[arr[0], tmp] = …`, `[$$liste[k], tmp] = …`, `[[a, b], c] = …`, `{a: {b}} = o` ne matchaient
        // PAS DU TOUT → `tmp`/`a`/`b`/`c` jamais déclarés → `ReferenceError` au premier clic, build VERT
        // (mesuré : zéro erreur de compilation). scanPatternHead (parcours équilibré, chaînes sautées,
        // cf. son bandeau plus haut) remplace la regex.
        const dm = scanPatternHead(codeLine)
        if (dm && !line.includes(':=') && !line.includes('.=')) {
          const { lead, pattern, sp } = dm
          // une cible MEMBRE du motif (`$a` état, `$$a` store, `§a`/`§§a` contexte, `@a` this) n'est pas une
          // variable : jamais à déclarer. `[$a, $b] = [$b, $a]` était promu `.=` → Civet émettait `let [$.a, $.b] = …`, JS
          // invalide, « [analyzer] parse error: Unexpected token » sans autre indice. Une `clé:` d'un motif objet n'est pas
          // une cible non plus (`{a: $a} = o`). Le `.` est OPTIONNEL après le sigil : un handler `@click={…}` arrive ici
          // déjà réécrit en pointillé (`$.a`) par une passe antérieure au `<script>` — sondé par exécution, sans ce `.?`
          // le nom après le point (`a`) retombait « bare » et se refaisait promouvoir en `.=` (même bogue, côté handler).
          // En handler, le STORE ($$) ne réécrit PAS en pointillé sigil comme $/§/@ mais
          // directement en `µ.store.x` (`µ` hors de portée de memberRe, jamais capturé) : `store`/`x`, précédés d'un `.`,
          // passaient pour des noms nus et se faisaient promouvoir → `let [µ.store.a, µ.store.b] = […]`, JS invalide,
          // écouteur posé mais cassé au premier clic (muet au build). Tout chemin pointé (`µ.store.a`, `this.a` — sortie
          // de `@a`, `_mjsThis.a` — sortie de `@@a`, `obj.k` déjà déclaré) est une cible MEMBRE, jamais une variable :
          // dottedRe retire le chemin ENTIER (racine comprise) avant l'extraction des noms ; le lookbehind `.` de la
          // regex `names` couvre en plus tout segment qui lui aurait échappé.
          // Un accès INDEXÉ dans le motif (`arr[0]`, `$$liste[k]`, `µ.store.x[k]`, `@items[i]`) n'est
          // ni une clé ni une variable à déclarer : un ACCÈS MEMBRE sur la racine, à un index calculé. rewriteIndexTargets
          // réécrit `racine[index]` en `racine.__` AVANT l'extraction des noms : la racine retombe sous dottedRe/memberRe
          // (cible MEMBRE), le nom lu DANS l'index (`k`, `i`) disparaît avec le crochet — une lecture, jamais une cible.
          // Un `[` précédé de `[`/`{`/`,`/`:`/début/blanc reste un motif IMBRIQUÉ, inchangé (`[[a, b], c]`, `{a: {b}}`).
          // Un REST sur une cible MEMBRE (`...arr[0]`) : les trois points COLLÉS devant
          // `arr` défont le lookbehind `(?<![\w$§@.])` de dottedRe/memberRe (le dernier `.` de `...` vaut comme si `arr`
          // était déjà pointé) → `arr` invisible de dottedRe ET de `names` (jamais déclaré NI reconnu membre) — motif
          // promu `.=` en entier, Civet refuse (`let [first, ...arr[0]] = a` invalide). `...`→blanc AVANT rewriteIndexTargets
          // (et rewriteCallRoots, décrit plus haut) rend la racine à dottedRe ; un `rest` SANS membre
          // (`[a, ...rest] = x`) redevient un nom neuf ordinaire, hissé comme les autres.
          const keyless    = rewriteIndexTargets(rewriteCallRoots(pattern.replace(/\[[^\[\]]*\]\s*:/g, '').replace(/[a-zA-Z_]\w*\s*:/g, '').replace(/\.\.\./g, ' ')))
          const memberRe   = /(?<![\w$§@])(\$\$?|§§?|@)\.?([a-zA-Z_]\w*)/g
          const dottedRe   = /(?<![\w$§@.])[a-zA-Z_µ][\w$]*(?:\s*\.\s*[a-zA-Z_]\w*)+/g
          const idents     = [...keyless.matchAll(memberRe)]
          const dotted     = [...keyless.matchAll(dottedRe)]
          const names      = [...keyless.replace(dottedRe, '').replace(memberRe, '').matchAll(/(?<![\w$§@.])[a-zA-Z_]\w*/g)].map(mm => mm[0]).filter(nm => !RESERVED.has(nm))
          const hasMember  = idents.length > 0 || dotted.length > 0
          // Ne promouvoir en `.=` (déclaration `let {…}=…`) QUE si AUCUNE cible n'est déjà déclarée. Sinon `[a, b] = [b, a]`
          // (swap, toutes déjà déclarées) reste nu (inchangé). Un motif MIXTE (une partie déjà déclarée, une
          // partie neuve — `[x, tmp] = [tmp, x]` avec `x` connu et `tmp` neuf) laissait `tmp` non déclaré (même bogue,
          // `ReferenceError` au clic) : on ne regarde plus « au moins une cible connue » mais CHAQUE nom individuellement —
          // seuls les noms neufs sont déclarés et, au besoin, hissés ; les noms déjà connus ne sont plus jamais retouchés.
          const undeclared = names.filter(nm => !scopes.some(s => s.declared.has(nm)))
          // chaque nom du motif déjà connu DANS CETTE MÊME portée (donc absent d'`undeclared`,
          // et sans passer par un ancêtre — même politique « au même niveau » que la cible
          // simple ci-dessus) est une RÉAFFECTATION : `{w, h} := f()` puis `{w, x} = g()` lié par
          // `:=` refuse de compiler plutôt que de planter au chargement.
          for (const nm of names) {
            if (undeclared.includes(nm)) continue
            if (constanteSure(nm)) {
              throw new Error(t('transpiler.civet-reaffectation-constante', { nom: nm, ligne: li + firstLine }))
            }
          }
          if (undeclared.length > 0) {
            for (const nm of undeclared) topScope.declared.add(nm)
            // branche plus profonde que le corps OU motif mixte membre + variable OU motif mixte déclaré/neuf
            // (`[$a, tmp] = …` / `[x, tmp] = […]` avec `x` connu) : hissage individuel par nom, l'affectation reste nue —
            // sinon `.=` sur le motif ENTIER re-déclarerait un nom déjà connu (« Identifier 'x' has already been declared »)
            if (indent > topScope.bodyIndent || hasMember || undeclared.length < names.length) {
              for (const nm of undeclared) pendingHoists.push({ insertAt: topScope.insertAt, indent: topScope.bodyIndent, name: nm })
            } else {
              // même remède que l'affectation simple plus haut : découpe de
              // `line` (brute) à un index calculé sur `codeLine`, jamais de reconstruction depuis
              // `lead`/`pattern`/`sp` (blanchis) qui effacerait un commentaire niché dans le motif.
              const posEq = lead.length + pattern.length + sp.length
              lines[li] = line.slice(0, posEq) + '.=' + line.slice(posEq + 1)
            }
          }
        } else if (/^\s*(?:if|unless|else|for|while|switch|when)\b/.test(codeLine) && !line.includes(':=') && !line.includes('.=')) {
          // variante EN LIGNE — `if a then x = 1` / `… else y = 2` sur une
          // seule ligne : le nom après `then`/`else` est une affectation de
          // branche comme les autres, même remède (hissage). Cette branche ne
          // RÉÉCRIT jamais `line` (seul `pendingHoists` reçoit le nom, cf. plus
          // bas) : tester/scanner sur `codeLine`
          // suffit, aucun index à reporter sur la ligne brute.
          const inlineRe = /(?:\bthen\b|\belse\b)\s+([a-zA-Z_]\w*)\s*=(?!=)/g
          let im: RegExpExecArray | null
          while ((im = inlineRe.exec(codeLine)) !== null) {
            const nm = im[1]
            if (RESERVED.has(nm)) continue
            if (!scopes.some(s => s.declared.has(nm))) {
              topScope.declared.add(nm)
              pendingHoists.push({ insertAt: topScope.insertAt, indent: topScope.bodyIndent, name: nm })
            } else if (constanteSure(nm)) {
              // même garde que l'affectation simple, restreinte à CETTE portée : `if a then x = 1`
              // reste une réaffectation, même écrite en ligne après `then`/`else`
              throw new Error(t('transpiler.civet-reaffectation-constante', { nom: nm, ligne: li + firstLine }))
            }
          }
        }
      }
      // Enregistre AUSSI les déclarations explicites Civet `IDENT .= expr`
      // et `IDENT := expr` dans le scope courant, sinon une réassignation
      // bare (`IDENT = expr`) dans un scope enfant croit que la var n'est
      // pas déclarée et se promeut à tort en `.=`, créant un shadow qui
      // casse la closure (régression `tuto#etat-brut`).
      const declMatch = codeLine.match(/^(\s*)([a-zA-Z_]\w*)\s*([.:])=/)
      if (declMatch && !RESERVED.has(declMatch[2])) {
        const scopeDecl = scopes[scopes.length - 1]
        scopeDecl.declared.add(declMatch[2])
        // `:=` lie une CONSTANTE (Civet → `const`), `.=` une mutable (`let`) — mémorisé pour
        // refuser plus haut la réaffectation nue d'un nom const (cf. bandeau `constDeclared`)
        if (declMatch[3] === ':') scopeDecl.constDeclared.add(declMatch[2])
        else scopeDecl.constDeclared.delete(declMatch[2])
      }
      // Même chose pour un motif de déstructuration DÉJÀ déclaré (`{w, h} := f()`,
      // `[a, b] := t`, clé renommée, défaut, reste `...`, clé chaîne — cf. bandeau
      // extractDestructuredNames plus haut) : invisible à declMatch ci-dessus (qui n'admet
      // qu'un IDENT nu juste après l'indentation). Sans cet enregistrement, `w`/`a`/`r` du
      // motif restent absents du scope — la même régression que declMatch corrige pour un
      // IDENT simple. Le motif peut s'ouvrir sur SA PROPRE ligne et ne se refermer que plus
      // bas (mise en forme multi-lignes, ex. `{\n  w,\n  h\n} := f()`) : balancedSpan sur la
      // seule `codeLine` ne referme alors jamais rien (fin hors de cette chaîne), le motif
      // entier échappait à l'enregistrement — même bogue que declMatch, non détecté par lui
      // (aucun IDENT nu en tête). On étend la recherche du point d'équilibre aux lignes
      // BLANCHIES suivantes, comme la pré-passe `multiLineParams` plus haut pour une liste de
      // paramètres ; le cas mono-ligne (immédiatement équilibré) n'entre jamais dans la boucle.
      if (codeLine[indent] === '[' || codeLine[indent] === '{') {
        let motif  = codeLine.slice(indent)
        let patEnd = balancedSpan(motif, 0)
        for (let lj = li + 1; patEnd === -1 && lj < lignesCode.length; lj++) {
          motif  += '\n' + lignesCode[lj]
          patEnd  = balancedSpan(motif, 0)
        }
        const opMatch = patEnd !== -1 ? motif.slice(patEnd).match(/^\s*([.:])=/) : null
        if (opMatch) {
          const scopeDecl = scopes[scopes.length - 1]
          // même distinction que declMatch ci-dessus pour un IDENT nu : `:=` lie une constante,
          // même déstructurée — `w`/`h` de `{w, h} := f()` refusent une réaffectation nue plus bas
          const estConst = opMatch[1] === ':'
          for (const nm of extractDestructuredNames(motif.slice(0, patEnd), RESERVED)) {
            scopeDecl.declared.add(nm)
            if (estConst) scopeDecl.constDeclared.add(nm)
            else scopeDecl.constDeclared.delete(nm)
          }
        }
      }
      // Déclarations EXPLICITES `let/const/var IDENT[, {…}, […]]` : sans
      // ça, un `let x` PUIS un `x = 5` plus bas voyait `x` comme non déclaré et
      // le promouvait en `.=` → `let x` + `let x = 5` = « Identifier 'x' has
      // already been declared ». On n'extrait que les cibles AVANT le `=`
      // (`[^=\n]*`) pour ne pas polluer le scope avec les identifiants de la rhs.
      const kwDecl = codeLine.match(/^\s*(?:let|const|var)\b([^=\n]*)/)
      if (kwDecl) {
        for (const nm of kwDecl[1].match(/[a-zA-Z_]\w*/g) ?? []) {
          if (!RESERVED.has(nm)) scopes[scopes.length - 1].declared.add(nm)
        }
      }
      // Nouveau bloc (line finit par `->`/`=>`/`then`/`do`) → push scope enfant
      // `codeLine` (commentaire retiré, cf.
      // `sansCommentaires` plus haut) remplace `line` pour CE test ET pour `trimmedEnd`/`beforeArrow`
      // juste en dessous : un `//`/`/* … */` en QUEUE de ligne (`f = (a) -> // note`) faisait échouer
      // `/(?:->|=>|then|do)\s*$/` sur la ligne BRUTE (elle ne finit plus littéralement par `->`) →
      // aucune portée poussée, `a` traité comme une affectation de la portée racine et HISSÉ à tort
      // (`a .= undefined` fantôme) ; un `/* c */` ENTRE les paramètres (`f = (a, /* c */ b) ->`)
      // faussait de même `beforeArrow` plus bas. Les deux tests portent désormais sur la MÊME chaîne
      // nettoyée (la comparaison de longueur `params.end === beforeArrow.length` reste cohérente).
      // `codeLine` n'est plus recalculé ici : c'est
      // désormais la MÊME variable hissée en tête de boucle (`lignesCode[li]`, blanchie — cf. son
      // bandeau plus haut), qui couvre en plus les blocs `/* … */` MULTI-LIGNES (`sansCommentaires`
      // ne reconnaissait qu'un commentaire ouvert ET refermé sur cette ligne isolée, jamais un bloc
      // ouvert sur une ligne précédente).
      if (/(?:->|=>|then|do)\s*$/.test(codeLine)) {
        // liste de paramètres MULTI-LIGNES (cf. bandeau
        // `parenDeltaHorsChaines` plus haut) : la portée poussée hérite de l'indentation de la
        // ligne D'OUVERTURE (`multi.openIndent`), jamais de celle de la ligne de fermeture `) ->` —
        // sinon une fermeture indentée au niveau du corps ferait sauter la portée dès sa 1re ligne.
        const multi = multiLineParams.get(li)
        const child = { indent: multi ? multi.openIndent : indent, declared: new Set<string>(), constDeclared: new Set<string>(), bodyIndent: null as number | null, insertAt: null as number | null }
        scopes.push(child)
        if (multi) {
          for (const nm of extractParamNames(multi.params, RESERVED)) child.declared.add(nm)
        } else {
          // PARAMÈTRES de fonction enregistrés dans le scope qu'elle
          // ouvre (cf. bandeau extractParamNames plus haut) : seuls `->`/`=>` ouvrent une liste de
          // paramètres (`then`/`do` jamais). Le groupe `(…)` équilibré collé IMMÉDIATEMENT devant la
          // flèche (blancs tolérés entre `)` et la flèche) est cette liste ; sans parenthèses = aucun
          // paramètre (`k = ->` inchangé).
          const trimmedEnd = codeLine.replace(/\s+$/, '')
          if (trimmedEnd.endsWith('->') || trimmedEnd.endsWith('=>')) {
            const beforeArrow = trimmedEnd.slice(0, -2).replace(/\s+$/, '')
            if (beforeArrow.endsWith(')')) {
              const spans  = outermostParenSpans(beforeArrow)
              const params = spans[spans.length - 1]
              if (params && params.end === beforeArrow.length) {
                for (const nm of extractParamNames(beforeArrow.slice(params.start + 1, params.end - 1), RESERVED)) {
                  child.declared.add(nm)
                }
              }
            }
          }
        }
      }
    }
    // hissage (piège des branches) — dédoublonne (insertAt, nom), regroupe par point
    // d'insertion puis splice en DÉCROISSANT (une insertion plus haute ne
    // décale jamais un insertAt plus bas encore en attente) ; les noms d'un
    // même groupe sont insérés ENSEMBLE pour garder leur ordre d'origine
    // Les déclarations se posent sur une ligne existante, pour que les lignes du script restent celles du fichier (positions
    // des erreurs, carte de source) : la ligne vide juste au-dessus, sinon devant la ligne elle-même (`y .= undefined; if …`).
    // Une ligne qu'une passe suivante lit depuis son début (`µ$x = …`, `export`, `import`, `µdebug`, symbole) reçoit encore
    // ses déclarations sur une ligne à elles.
    if (pendingHoists.length) {
      const seen = new Set<string>()
      const byInsertAt = new Map<number, { indent: number; name: string }[]>()
      for (const h of pendingHoists) {
        const key = `${h.insertAt}\0${h.name}`
        if (seen.has(key)) continue
        seen.add(key)
        const group = byInsertAt.get(h.insertAt) ?? []
        group.push({ indent: h.indent, name: h.name })
        byInsertAt.set(h.insertAt, group)
      }
      for (const at of [...byInsertAt.keys()].sort((a, b) => b - a)) {
        const group  = byInsertAt.get(at)
        const decls  = group.map(h => `${h.name} .= undefined`)
        const indent = ' '.repeat(group[0].indent)
        const tete   = lines[at].trimStart()
        if (at > 0 && lines[at - 1].trim() === '' && !inertLines.has(at - 1)) {
          lines[at - 1] = indent + decls.join('; ')
        }
        else if (/^[a-zA-Z_]/.test(tete) && !/^(?:import|export)\b/.test(tete)) {
          const marge = lines[at].length - tete.length
          lines[at] = lines[at].slice(0, marge) + decls.join('; ') + '; ' + tete
        }
        else {
          lines.splice(at, 0, ...decls.map(d => indent + d))
        }
      }
    }
    out = lines.join('\n')
  }

  return out
}

// µconsole (ou `µ.console`) → ouvre le panneau d'inspection. Appel GARDÉ : le panneau n'existe
// qu'en développement (absent des builds de production), la rune n'y fait alors rien. Réécrite sur
// le texte ENTIER, chaînes et commentaires masqués : un argument en chaîne (`µconsole '.panier'`)
// serait sinon séparé du nom par transformCodeOnly. Trois formes :
//   µconsole          → sur CE composant (`_mjsThis` ; hors composant, `<script module>`, sans
//                       sélection plutôt qu'une ReferenceError)
//   µconsole(arg)     → l'argument tel quel : sélecteur, élément, valeur à inspecter, true/false
//   µconsole arg      → forme Civet sans parenthèses : UN argument, chaîne ou chemin (`$$panier.x`)
// Forme de sortie valable dans tous les dialectes (ni ternaire, absent de Coffee, ni `?.`)
const MOTS_APRES_UNE_RUNE = new Set(['if', 'unless', 'and', 'or', 'then', 'else', 'when', 'for', 'while', 'until', 'not', 'is', 'isnt', 'in', 'of', 'instanceof'])

// la position `at` de la vue masquée (commentaires blanchis) finit-elle l'instruction ? blancs, puis
// fin du texte ou de la ligne, `;`, une fermante, ou un mot de la langue (`µconsole $x if debug`)
function statementEnd(src: string, blanked: string, at: number): boolean {
  let k = at
  while (k < blanked.length && (blanked[k] === ' ' || blanked[k] === '\t')) {
    // un blanc de la vue qui n'en est pas un dans le texte : un second texte (il continue l'instruction,
    // `µconsole 'a' 'b'`) ou un commentaire (il la finit)
    if (src[k] !== ' ' && src[k] !== '\t') return src[k] !== "'" && src[k] !== '"' && src[k] !== '`'
    k++
  }
  if (k >= blanked.length || '\n\r;)]}'.includes(blanked[k])) return true
  const word = /^[A-Za-z_]\w*/.exec(blanked.slice(k, k + 12))
  return !!word && MOTS_APRES_UNE_RUNE.has(word[0])
}

function consoleSansParentheses(src: string, at: number): Error {
  const debut = src.lastIndexOf('\n', at - 1) + 1
  const fin   = src.indexOf('\n', at)
  return new Error(t('transpiler.console-parentheses', { ecrit: src.slice(debut, fin === -1 ? src.length : fin).trim() }))
}

function reecritRuneConsole(src: string, lang?: string): string {
  const vue = maskNonCode(src, lang ?? 'civet')
  const re  = /(?<![\w$.])µ\.?console(?![\w$])/g
  let sortie = '', dernier = 0, m: RegExpExecArray | null
  while ((m = re.exec(vue))) {
    const apresNom = m.index + m[0].length
    let i = apresNom
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
    const c = src[i]
    let fin = apresNom, arg: string | null = null
    if (vue[i] === '(') {
      // parenthèse fermante du même niveau, cherchée sur la vue masquée (une parenthèse dans une
      // chaîne ne compte pas) ; jamais refermée : rien réécrit, le compilateur le dira
      let prof = 0, j = i
      for (; j < vue.length; j++) {
        if (vue[j] === '(') prof++
        else if (vue[j] === ')' && --prof === 0) break
      }
      if (j >= vue.length) continue
      arg = src.slice(i + 1, j).trim()
      fin = j + 1
    }
    else if (c === '.' || c === '[') continue   // `µ.console.log(…)` : pas la rune
    else if ((c === "'" || c === '"') && i > apresNom) {
      // un texte à triples guillemets se refermerait au premier guillemet
      if (src.startsWith(c.repeat(3), i)) throw consoleSansParentheses(src, m.index)
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++ }
      arg = src.slice(i, j + 1)
      fin = j + 1
    }
    else if (i > apresNom && /[$A-Za-z_]/.test(c ?? '')) {
      const jeton = /^[$\w.]+/.exec(src.slice(i))![0]
      if (!MOTS_APRES_UNE_RUNE.has(jeton)) { arg = jeton; fin = i + jeton.length }
    }
    // sans parenthèses, l'argument (ou la rune seule) finit l'instruction : `µconsole foo(1)`,
    // `µconsole @el`, `µconsole $x, 'label'` seraient mal découpés — les parenthèses sont demandées
    if (vue[i] !== '(' && !statementEnd(src, vue, fin)) throw consoleSansParentheses(src, m.index)
    sortie += src.slice(dernier, m.index) + (arg ? `(µ.console && µ.console(${arg}))` : "(µ.console && µ.console((typeof _mjsThis != 'undefined' && _mjsThis) || null))")
    dernier = fin
  }
  return sortie + src.slice(dernier)
}

export function applyMjsSugarToScript(src: string, lang?: string, predeclared?: string[], sectionLabel = '<script>', firstLine = 1): string {
  // Sigil store CANONIQUE `µ$$X` / `$$X` : on DOUBLE le `$` de la variable
  // réactive (`µ$X`/`$X`). Même mécanisme runtime que `µ$` (universal state
  // partagé via `µ.state`), sigil distinct pour signaler la sémantique « store ».
  //   1. `export µ$$X = expr` → `export µ$X = expr` (route vers la déclaration
  //      universelle qui crée le proxy + l'export `$X`). Doit tourner AVANT la
  //      passe « Runes µ$ » (qui traite `export µ$X`).
  //   2. Toute autre occurrence `µ$$X` → `$X` (lecture du proxy exporté) SI `X`
  //      a été déclaré via `export µ$$X` PLUS HAUT dans ce MÊME source ;
  //      sinon erreur `singleton-sans-import`. Ce chemin (module autonome,
  //      `_compileScriptModuleInner` via bundler/index.ts) ne passe PAS par la
  //      pré-passe 0-bis de `transpile()` (qui connaît les `@import`) — un
  //      module ne peut de toute façon PAS importer de singleton (interdit,
  //      cf. bundler/index.ts) : la SEULE source légitime d'un `µ$$X` ici est
  //      donc sa propre déclaration `export µ$$X`, recollectée ICI pour
  //      recréer la même garantie qu'en 0-bis (ferme le même trou « µ$$Inconnu
  //      glisse en $Inconnu en silence »).
  // Le `$$X` NU (sans µ, en template/script) est géré dans le lexer (≡ `$X`).
  // MIROIR du fix 0-bis
  // de `transpile()` : ce chemin (module autonome `.module.civet`, PAS de HTML,
  // que du script) ne masquait RIEN — une chaîne/un commentaire qui mentionne
  // `µ$$X` en exemple était réécrit en silence ou faisait throw à tort. Même
  // remède, sans le volet HTML (absent ici) : masquer chaînes/commentaires
  // (maskStringsAndComments), réécrire, restaurer.
  const { masked: maskedForExports, restore: restoreExports } = maskStringsAndComments(src)
  const singletonExports = new Set<string>()
  maskedForExports.replace(/^[ \t]*export[ \t]+µ\$\$([a-zA-Z0-9_]+)[ \t]*=/gm, (_m: string, nom: string) => {
    singletonExports.add(nom)
    return _m
  })
  let maskedOut = maskedForExports.replace(
    /^([ \t]*)export[ \t]+µ\$\$([a-zA-Z0-9_]+)([ \t]*=)/gm,
    '$1export µ$$$2$3'
  )
  maskedOut = maskedOut.replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, nom: string) => {
    if (singletonExports.has(nom)) return '$' + nom
    throw new Error(t('transpiler.singleton-sans-import', { nom }))
  })
  let out = restoreExports(maskedOut)

  // dialecte Coffee/Civet des composants (commentaires #, for…in→of, isnt,
  // interpolation "#{}", auto-déclaration scope-aware) — cf. applyCivetDialectSugar
  // ci-dessus, SOURCE UNIQUE partagée avec `mjs ws` (fichiers *.server.mjs).
  out = applyCivetDialectSugar(out, lang, predeclared, firstLine)

  // ─── Runes µ$ ASSIGNEMENT (statement-level) — chaînes/commentaires masqués D'ABORD ───
  // Ces deux regex line-anchored réécrivent une LIGNE COMPLÈTE `µ$X = expr` (ou
  // `export µ$X = …`) dont la rhs peut CONTENIR une chaîne : transformCodeOnly
  // isolerait cette chaîne dans un chunk distinct (rhs tronquée), d'où l'application sur le texte
  // entier plutôt que via transformCodeOnly. Mais SANS masquage, une ligne `µ$x = 5` simplement
  // CITÉE dans une chaîne (gabarit multi-ligne affiché en exemple de doc) est une ligne comme une
  // autre pour un motif `^…$` : elle était réécrite en code réel, build vert, texte affiché
  // corrompu. Même remède que la passe sœur µ$$X plus haut (maskStringsAndComments) : une chaîne,
  // MÊME multi-ligne, s'efface en UN placeholder compact avant les deux regex — restauré à
  // l'identique en sortie, y compris quand il finit dans le rhs du code généré (`µ$X = 'texte'`).
  const { masked: maskedForDollar, restore: restoreDollar } = maskStringsAndComments(out)
  // commentaire de ligne en fin d'expression (`µ$n = 0  # compteur`) : laissé après la réécriture, sinon restauré dans
  // `µ.state(…)` il avale la `)` et le reste de la ligne
  const sansCommentaireFinal = (rhs: string): [string, string] => {
    const m = /^(.*?\S)([ \t]+\x00MJSSTR\d+\x00)$/.exec(rhs)
    if (!m || !/^(?:\/\/|#(?!##))/.test(restoreDollar(m[2].trimStart()))) return [rhs, '']
    return [m[1], m[2]]
  }
  //   `export µ$X = expr` → `µ_state.X ?= µ.state(expr); export $X = µ_state.X` (sur la même ligne : les lignes du script
  //   restent celles du fichier)
  let maskedDollarOut = maskedForDollar.replace(
    /^([ \t]*)export[ \t]+µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*(.+?)[ \t]*$/gm,
    (_m, indent, name, rhs) => {
      const [expr, commentaire] = sansCommentaireFinal(rhs)
      return `${indent}µ_state.${name} ?= µ.state(${expr}); export $${name} = µ_state.${name}${commentaire}`
    }
  )
  //   `µ$X = expr` (sans export) → `µ_state.X ?= µ.state(expr)`
  maskedDollarOut = maskedDollarOut.replace(
    /^([ \t]*)µ\$([a-zA-Z0-9_]+)[ \t]*=[ \t]*(.+?)[ \t]*$/gm,
    (_m, indent, name, rhs) => {
      const [expr, commentaire] = sansCommentaireFinal(rhs)
      return `${indent}µ_state.${name} ?= µ.state(${expr})${commentaire}`
    }
  )
  out = restoreDollar(maskedDollarOut)

  // ─── Réécritures µ SENSIBLES aux chaînes/commentaires ─────────────
  // µfoo→µ.foo, routage API (µ.on/emit/…), runes µ$ en LECTURE, µdebug,
  // inspect/proxy s'appliquaient jusqu'ici en `.replace` GLOBAL → une
  // chaîne ou un commentaire contenant `µs`, `µ.on`, `µ$x`… était réécrit
  // (corruption silencieuse d'un texte affiché/logué : `'durée 12 µs'` →
  // `'durée 12 µ.s'`). On les passe toutes dans transformCodeOnly (mêmes chunks
  // code-only que les passes 2/2b) : strings/commentaires sautés. À ce stade
  // les commentaires sont déjà en `//`/`/* */` (Pass 1, hors Coffee — que
  // transformCodeOnly sait quand même sauter via son handler `#`). Les runes en
  // ASSIGNEMENT ont déjà tourné ci-dessus (rhs préservée).
  // `µinspect($x.chemin)` d'abord, sur le texte ENTIER : une clé en chaîne (`$x['cle']`) coupait
  // l'appel en morceaux dans transformCodeOnly, qui ne le reconnaissait plus — même réécriture
  // (et même refus d'un chemin invalide) que dans le gabarit, chaînes et commentaires masqués
  // (µminmax, retiré en V3, y est refusé avec la marche à suivre — d'où le second test)
  if (out.includes('inspect') || out.includes('minmax')) out = reecritOuRejetteRuneChemin(out)
  // la rune seule (`µconsole`, `µ.console`) : un `console.log` ordinaire ne coûte pas un masquage du script
  if (/µ\.?console/.test(out)) out = reecritRuneConsole(out, lang)
  out = transformCodeOnly(out, (code) => {
    let c = code
    // µproxy $.path → µ._mjs_makeDeepProxy(_mjsThis, ['path'])
    // Escape hatch manuel pour les cas où le compile-time path
    // tracker ne peut pas détecter l'escape (eval, new Function, dynamic etc.)
    // AVANT le sucre µfoo → µ.foo ci-dessous : passé après, il en faisait `µ.proxy(…)`, absent du runtime (TypeError à
    // l'appel, pour chaque forme)
    c = c.replace(
      /(?<!µ\.)µproxy\s+\$\.([a-zA-Z_$][\w$.]*)/g,
      (_m, path) => {
        const parts = path.split('.').map((p: string) => `'${p}'`).join(', ')
        return `µ._mjs_makeDeepProxy(_mjsThis, [${parts}])`
      }
    )
    // Variante : `µproxy $X`, `µproxy $X.a.b` (chemin entier, comme `µproxy $.X.a.b`) ; une variable du magasin (`$$x`)
    // n'en est pas une
    c = c.replace(
      /(?<!µ\.)µproxy\s+\$([a-zA-Z_][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)/g,
      (_m, path) => {
        const parts = path.split('.').map((p: string) => `'${p}'`).join(', ')
        return `µ._mjs_makeDeepProxy(_mjsThis, [${parts}])`
      }
    )
    // µfoo → µ.foo (sucre universel) — SAUF les runes à compilation LEXER
    // (µread/µwrite → _state brut, hooks µmount & co → _mjs_hook, liste unique
    // sigils.ts) : les pointer ici (`µ.read`, `µ.mount`) les rendait invisibles
    // au lexer qui tourne APRÈS, et indéfinies au runtime (TypeError µ.mount is
    // not a function — découvert à la migration des hooks en runes ;
    // µread/µwrite en <script> étaient cassés pareil depuis leur naissance,
    // seuls les tests unitaires du lexer — hors pipeline — passaient)
    c = c.replace(MU_UNIVERSAL_RE, 'µ.$1')


    // µ.inspect($x) → µ.inspect('x') — corps PARTAGÉ avec cleanJs (sigils.ts,
    // MU_INSPECT_ARG_BODY), même texte des deux côtés.
    c = c.replace(new RegExp(MU_INSPECT_ARG_BODY, 'g'), MU_INSPECT_ARG_OUT)

    // µdebug $x → point d'arrêt RÉACTIF (équivalent de {@debug} de Svelte). Sucre
    // pur : se réécrit en effet qui log la valeur + `debugger;` À CHAQUE changement
    // de $x. Réutilise le même effet que les macros (<@element>/<@head>) → même
    // tracking de dépendances ($x lu dans le corps → re-run au changement).
    // NB : `µdebug` est DÉJÀ devenu `µ.debug` via le sucre universel µfoo→µ.foo
    // (ci-dessus) ; on matche donc `µ.debug` et on génère directement
    // `µ.effect`/`µ.log` (déjà pointés, comme le `µeffect` des macros post-sucre).
    //   µdebug $count   →   µ.effect => µ.log('[µdebug] count =', $count); debugger
    // Sur la même ligne (Civet et CoffeeScript mettent les deux instructions dans le corps de l'effet) : les lignes
    // du script restent celles du fichier.
    // Chemin `\$[\w$.]+` (pas seulement `$ident` simple) : `µdebug $obj.a`
    // devenait `µ.debug($.obj.a)` → TypeError à l'init (`µ.debug` est un booléen).
    c = c.replace(
      /^([ \t]*)µ\.debug[ \t]+\$([a-zA-Z_$][\w$.]*)[ \t]*$/gm,
      (_m, indent, name) => `${indent}µ.effect => µ.log('[µdebug] ${name} =', $${name}); debugger`
    )

    // Routage API instance vers méthodes privées (CoffeeScript : @ = this).
    // En Coffee on garde @_mjs_*. Le langage adapter compilera @ → this.
    //
    // µemit fait EXCEPTION à `@_mjs_*` : `@_mjs_emit` compile en
    // `this._mjs_emit`, et `this` n'est PAS fiable partout (objet utilisateur
    // imbriqué — `helper = { go: -> µemit 'x' }` — appelé `helper.go()` : `this`
    // y vaut `helper`, pas le composant ; rebindDetachedThis laisse SCIEMMENT ce
    // cas, cf. this-rebinding.ts, c'est une méthode réelle d'un objet).
    // `_mjsThis` (capturé en clôture à la construction, cf. template.ts) désigne
    // TOUJOURS le composant, quel que soit le site d'appel — direct en dur, pas
    // via `@`. `<script module>` (aucun `_mjsThis` en scope) refuse µemit à la
    // compilation, cf. lintEmitInModule plus bas — pas de repli runtime ici.
    c = c.replace(/µ\.?\s*emit\b/g, '_mjsThis._mjs_emit')
    // µon, µsetContext / µ.getContext : le composant dont le script les porte (`_mjsThis`), comme `§` — `@` valait l'état
    // dans une fonction rangée dans l'état (`$go = -> µsetContext 'x', 1`, appelée `$go()`). Un module n'a pas de
    // composant : `@` y reste
    const recepteur = sectionLabel === '<script module>' ? '@' : '_mjsThis.'
    c = c.replace(/µ\.?\s*on\b/g, recepteur + '_mjs_on')
    c = c.replace(/µ\.?\s*setContext\b/g, recepteur + '_mjs_setContext')
    c = c.replace(/µ\.\s*getContext\b/g, recepteur + '_mjs_getContext')

    // `µ$X` (lecture) → `µ_state.X`
    c = c.replace(/µ\$([a-zA-Z0-9_]+)/g, 'µ_state.$1')
    return c
  })


  // Si µ_state utilisé, prefix la DÉCLARATION de `µ_state` au top après imports.
  // LANG-AWARE : en Coffee l'assignation nue auto-déclare (`var µ_state`),
  // mais en Civet (défaut) / TS / JS une assignation NUE sort non déclarée →
  // `ReferenceError: µ_state is not defined` au runtime (module ES strict) ET
  // rejet par lintUndeclaredTopLevelAssignment (message trompeur : le dev n'a
  // jamais écrit `µ_state`). On émet donc `.=` (Civet let) ou `let` (js/ts).
  // Garde anti-doublon élargie à `=`/`:=`/`.=`. (`\b` ne marche pas sur `µ`,
  // U+00B5 pas word-char en JS regex.)
  if (out.includes('µ_state') && !/^\s*µ_state\s*[:.]?=\s*µ\.state/m.test(out)) {
    const lines = out.split('\n')
    let insertAt = 0
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\b/.test(lines[i])) insertAt = i + 1
      else if (lines[i].trim() !== '') break
    }
    const decl = lang === 'coffee'              ? 'µ_state = µ.state({})'
               : (lang === 'js' || lang === 'ts') ? 'let µ_state = µ.state({})'
               :                                    'µ_state .= µ.state({})'
    // sur une ligne existante (les lignes du script restent celles du fichier) : la ligne vide où elle irait, sinon devant
    // la ligne elle-même (un nom, ou un `µ_state.x ?= …` déjà réécrit) ; une autre (symbole, `import`, `export`…) en reçoit
    // une à elle
    const tete = insertAt < lines.length ? lines[insertAt].trimStart() : ''
    if (insertAt < lines.length && tete === '') lines[insertAt] = decl
    else if (/^(?:[a-zA-Z_]|µ_state\.)/.test(tete) && !/^(?:import|export)\b/.test(tete)) lines[insertAt] = decl + '; ' + lines[insertAt]
    else lines.splice(insertAt, 0, decl)
    out = lines.join('\n')
  }

  // µimport('chemin.js') / mjsimport('chemin.js') — PLUS réécrit ICI depuis
  // `import` reste dans MU_SCRIPT_RUNES
  // (sigils.ts) juste au-dessus, donc `µimport(...)` traverse cette fonction
  // et Civet/Coffee tel quel (simple appel de fonction — bonus assumé : la
  // forme Coffee SANS parenthèses `µimport 'x.js'` devient valide, le
  // compilateur Coffee pose les parenthèses lui-même). La réécriture se fait
  // désormais en AVAL, en AST, sur le JS déjà COMPILÉ (rewriteMuImportAst,
  // sigils.ts) — cf. ses appelants (jsInitBase / moduleJs plus bas dans ce
  // fichier, et bundler/index.ts pour les modules .civet/.coffee autonomes).

  return out
}

// ----------------------------------------------------------------------------
// escapeVtAttrValue — échappe une valeur VERBATIM `@viewTransition` (nom, ou
// `nom={ options }`) avant de la poser dans un attribut HTML statique
// (`data-mjs-vt="…"`). `"` (délimiteur de l'attribut) ET `{`/`}` (sinon le
// pipeline générique d'attributs statiques la prendrait pour une INTERPOLATION
// JS, cf. generator/attributes/index.ts `rawVal.includes('{')`) sont réécrits
// en entités HTML — décodées automatiquement par le navigateur à
// `getAttribute()`, donc invisibles au runtime (µ._mjs_vtParse reçoit le texte réel).
// ----------------------------------------------------------------------------
function escapeVtAttrValue(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}

// ----------------------------------------------------------------------------
// extractBraceBody — depuis l'index JUSTE APRÈS un `{` ouvrant déjà consommé (ex. après le
// marqueur littéral `@confirm={`), renvoie le corps jusqu'à l'accolade fermante APPARIÉE + l'index
// de celle-ci (`end: -1` si jamais refermée). DÉLÈGUE à `extractBalanced` (src/parser/index.ts) —
// le scanner du PARSER, déjà exact sur les chaînes `'…'`/`"…"` (échappement respecté), les gabarits
// `` `…` `` (`${…}` imbriqués compris), les commentaires `//`/`/* */` ET les littéraux regex.
// Remplace un scanner maison (ex-`skipTemplate`, RETIRÉ) qui ne connaissait PAS les regex : un `/`
// qui FERME une regex, immédiatement suivi d'un `*` (ex. `/a*/*$n`), était pris pour l'ouverture
// d'un `/* … */` — plus aucun `*/` ne le refermait, tout le reste du fichier avalé (`end: -1`), le
// marqueur `@title=`/`@confirm=` restait intact et retombait sur le pipeline générique d'attributs :
// `@title`/`@confirm` interprétés comme un ÉCOUTEUR d'événement DOM (confirmé par
// exécution : `mjs-title` absent de `_mjs_cloneTpl`, `_mjs_bindEvents({"title":{"e1":0}})` câblé à la
// place). Un guillemet DANS une regex (`/'/`) avait le même effet (pris pour l'ouverture d'une
// vraie chaîne, jamais refermée). Deux scanners pour la même grammaire = dérive garantie (cf.
// sigils.ts, en tête de fichier) — source UNIQUE désormais. Contrat INCHANGÉ : `end: -1` si jamais
// refermé (le parser HTML en amont le dira, comme avant).
// ----------------------------------------------------------------------------
function extractBraceBody(str: string, start: number): { body: string; end: number } {
  const scanner = new Scanner(str)
  scanner.pos    = start
  try {
    const body = extractBalanced(scanner, '}')
    return { body, end: scanner.pos - 1 }                      // pos est juste APRÈS le `}` apparié
  }
  catch {
    return { body: str.slice(start), end: -1 }                 // jamais refermé : contrat inchangé, le parser HTML en amont le dira
  }
}

// ----------------------------------------------------------------------------
// scanQuoted — depuis un guillemet ouvrant `'`/`"` (str[i]), avance jusqu'au guillemet fermant
// APPARIÉ en respectant l'échappement `\\` (saute le caractère suivant, même patron
// qu'extractBraceBody ci-dessus) et rend le contenu DÉS-ÉCHAPPÉ (`\'` → `'`, `\"` → `"`, `\\` → `\`,
// le reste littéral) plus l'index du guillemet fermant (`content`/`end`), ou `null` si jamais
// refermée. Cœur du correctif : les mini-parseurs @confirm/@title
// (`[^']*`/`(?:(?!\1)[\s\S])*`) s'arrêtaient à la 1re apostrophe MÊME ÉCHAPPÉE — exactement le style
// imposé au projet (apostrophe française `\'`) — corrompant l'attribut (forme chaîne) ou
// rejetant à tort la forme objet.
// ----------------------------------------------------------------------------
function scanQuoted(str: string, i: number): { content: string; end: number } | null {
  const quote = str[i]
  let content = ''
  let j = i + 1
  while (j < str.length) {
    const ch = str[j]
    if (ch === '\\') {
      const next = str[j + 1]
      content += (next === "'" || next === '"' || next === '\\') ? next : ch + (next ?? '')
      j += 2
      continue
    }
    if (ch === quote) return { content, end: j }
    content += ch
    j++
  }
  return null
}

// scanTranslatedCall — depuis `str[i]`, reconnaît un appel `µt(…)` COMPLET (parenthèses appariées,
// chaînes/gabarits/regex respectés, via extractBalanced) qui termine la valeur d'une clé : suivi de la
// fin du texte ou d'une virgule, rien d'autre (`µt('a') + 'b'` refusé). Rend l'expression telle
// qu'écrite (`µt(…)`, réécrite ensuite par le pipeline comme dans un gabarit) et l'index juste après
// la parenthèse fermante, ou `null` : une variable, une concaténation, un autre appel restent refusés.
function scanTranslatedCall(str: string, i: number): { expr: string; end: number } | null {
  if (!str.startsWith('µt(', i)) return null
  const scanner = new Scanner(str)
  scanner.pos = i + 3
  try {
    const body = extractBalanced(scanner, ')')
    const end  = scanner.pos
    if (!/^\s*(?:,|$)/.test(str.slice(end))) return null
    return { expr: `µt(${body})`, end }
  }
  catch {
    return null
  }
}

// clampRaw — borne un extrait de source à une longueur d'affichage raisonnable pour un message
// d'erreur (une chaîne @confirm/@title non refermée traînerait sinon TOUT le reste du fichier).
function clampRaw(s: string): string {
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

// replaceBraceDirective — scanne `html` pour chaque occurrence LITTÉRALE de `marker` (ex.
// `@confirm={`) précédée d'une frontière `\B` (même garde que l'ancien `/\B@confirm=\{.../` : un
// `@` collé à un identifiant, `foo@confirm=`, reste du texte brut), extrait le corps via
// extractBraceBody puis délègue au callback `build` (peut throw — se propage, comme un callback de
// `.replace()`). Remplace un `.replace(/…\{([^{}]*)\}/g, …)` là où le corps peut légitimement
// porter des accolades dans une chaîne.
function replaceBraceDirective(html: string, marker: string, build: (raw: string) => string): string {
  if (!html.includes(marker)) return html
  let out = ''
  let i = 0
  while (i < html.length) {
    const idx = html.indexOf(marker, i)
    if (idx === -1) { out += html.slice(i); break }
    const before = html[idx - 1]
    if (before !== undefined && /\w/.test(before)) {
      // \B — pas une frontière de mot : @ collé à un identifiant = texte littéral, pas une directive
      out += html.slice(i, idx + 1)
      i = idx + 1
      continue
    }
    out += html.slice(i, idx)
    const { body, end } = extractBraceBody(html, idx + marker.length)
    if (end === -1) { out += html.slice(idx, idx + marker.length); i = idx + marker.length; continue }
    out += build(body)
    i = end + 1
  }
  return out
}

// scanTagClose — depuis une position DÉJÀ DANS une
// balise ouvrante (juste après le nom ou un attribut), avance jusqu'au `>` qui la referme
// VRAIMENT — un `"`/`'` rencontré en chemin ouvre une valeur d'attribut, masque tout `>` qu'elle
// contient jusqu'à son guillemet fermant. Rend -1 si la balise ne se referme jamais. Primitive
// PARTAGÉE : preprocessHtml (masquage des commentaires — un `<!--` DANS une balise n'ouvre jamais
// de commentaire, cf. maskHtmlComments plus bas) et replaceQuotedDirective juste en dessous
// (« même balise » entre deux occurrences d'un marqueur, au lieu du `.includes('>')` trompé par un
// `>` littéral dans la valeur d'un AUTRE attribut).
// Accolades sans fin de `sansFinTexte` (rendues par finExpression) : une balise suivante qui retombe sur l'une d'elles
// sait d'avance qu'elle ne se referme pas, sans relire tout le reste du texte (un gabarit en cours de frappe, aux
// accolades non refermées, coûtait un temps quadratique)
let sansFinTexte = ''
let sansFin      = new Set<number>()

function scanTagClose(html: string, from: number): number {
  if (html !== sansFinTexte) {
    sansFinTexte = html
    sansFin      = new Set()
  }
  let quote: string | null = null
  for (let i = from; i < html.length; i++) {
    const ch = html[i]
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    // une expression `{…}` (valeur d'attribut, raccourci) se lit d'un bloc (finExpression) : un guillemet ou un `>` qu'elle
    // contient (`{$s.replace(/"/g, '').length > 0}`) n'ouvre pas de valeur et ne ferme pas la balise ; jamais refermée, lecture d'avant
    if (ch === '{' && !sansFin.has(i)) {
      const fin = finExpression(html, i, sansFin)
      if (fin > 0) { i = fin - 1; continue }
    }
    if (ch === '>') return i
  }
  return -1
}

// tagNameBefore — nom de la balise ouvrante la plus proche AVANT `pos` (remonte
// jusqu'au dernier `<`) — sert SEULEMENT à NOMMER la balise dans un message d'erreur de directive
// dupliquée, pas une vraie résolution DOM.
function tagNameBefore(html: string, pos: number): string {
  const lt = html.lastIndexOf('<', pos)
  const m = lt === -1 ? null : /^<\/?([a-zA-Z][a-zA-Z0-9_-]*)/.exec(html.slice(lt))
  return m ? m[1] : '?'
}

// replaceQuotedDirective — même rôle que replaceBraceDirective juste au-dessus, mais pour un
// marqueur SANS accolade (ex. `@confirm=`) immédiatement suivi d'un guillemet `'`/`"` — sinon (ex.
// `@confirm={`, une autre forme) `marker` est laissé INTACT, traité ailleurs. Extraction de la
// valeur via scanQuoted (respecte `\\`, dé-échappe `\'`/`\"`/`\\`) puis délégation au callback
// `build` (peut throw). `onUnterminated` REND l'erreur si le guillemet ne se referme jamais — sinon
// la valeur happerait tout le reste du document (plus de silence possible sur ce cas).
// Deux occurrences DE CE MÊME marqueur sans un `>` entre les deux (donc sur la MÊME
// balise ouvrante) → erreur : seule la 1ʳᵉ survivrait au DOM (attribut HTML dupliqué), la 2ᵉ,
// écrite par le dev, serait silencieusement ignorée.
function replaceQuotedDirective(html: string, marker: string, build: (value: string) => string, onUnterminated: (raw: string) => never): string {
  if (!html.includes(marker)) return html
  let out = ''
  let i = 0
  let lastEnd = -1 // fin du DERNIER remplacement réussi de CE marqueur
  while (i < html.length) {
    const idx = html.indexOf(marker, i)
    if (idx === -1) { out += html.slice(i); break }
    const before = html[idx - 1]
    if (before !== undefined && /\w/.test(before)) {
      // \B — pas une frontière de mot : @ collé à un identifiant = texte littéral, pas une directive
      out += html.slice(i, idx + 1)
      i = idx + 1
      continue
    }
    const qi = idx + marker.length
    if (html[qi] !== "'" && html[qi] !== '"') {
      // pas un guillemet juste après le marqueur (ex. @confirm={) : pas cette forme, on laisse passer
      out += html.slice(i, qi)
      i = qi
      continue
    }
    const scanned = scanQuoted(html, qi)
    if (!scanned) onUnterminated(clampRaw(html.slice(qi)))
    // « même balise » déterminé par scanTagClose (guillemets
    // respectés), pas par `.slice(lastEnd, idx).includes('>')` : un AUTRE attribut de la même balise
    // dont la VALEUR contient `>` (ex. `data-x=">"`) trompait l'ancien test, laissant passer deux
    // occurrences du marqueur sans erreur. `tagClose === -1` (balise jamais refermée) ou APRÈS `idx`
    // ⇒ toujours la même balise ouvrante.
    const tagClose = lastEnd === -1 ? -1 : scanTagClose(html, lastEnd)
    if (lastEnd !== -1 && (tagClose === -1 || tagClose > idx)) {
      throw new Error(t('transpiler.directive-dupliquee', { directive: marker.replace(/=$/, ''), balise: tagNameBefore(html, idx) }))
    }
    out += html.slice(i, idx)
    out += build(scanned.content)
    lastEnd = scanned.end + 1
    i = scanned.end + 1
  }
  return out
}

// replaceDoubleBraceDirective — variante de replaceBraceDirective pour la forme `marker{{expr}}`
// DEUX accolades ouvrantes ACCOLÉES (`{{`, sans espace) après
// `marker` (ex. `@title=`) déclenchent cette forme ; un simple `{` (ou `{ {` espacé, cf. bandeau
// plus bas) laisse tout INTACT, traité ailleurs (forme simple). Le corps est cherché par
// extractBraceBody EN CONSOMMANT LES DEUX accolades ouvrantes avant l'appel : sa notion de
// « balance 0 » (calibrée sur UNE seule accolade déjà ouverte) tombe alors sur la PREMIÈRE des
// deux fermantes attendues — la SECONDE est vérifiée juste après, immédiatement adjacente
// (symétrique de l'ouvrante) ; son absence, comme un corps jamais refermé du tout (`end: -1`),
// lève `catalogKey` — jamais un silence, jamais un corps tronqué.
//
// une TROISIÈME accolade ACCOLÉE
// (`{{{`, voire davantage) compilait SANS ERREUR : `extractBraceBody`, appelée juste après les
// deux premières, voit la troisième comme un `{` NESTÉ dans le corps (balance rééquilibrée par
// la PREMIÈRE des N fermantes plutôt que la dernière) — le surplus glisse tel quel dans le corps,
// devient un OBJET LITTÉRAL (`{{ expr }}` → corps `{ expr }`) au lieu de l'expression attendue.
// Au runtime, ce n'est jamais visible à la compilation : `String({…})` affiche "[object Object]"
// dans la bulle. `{{{` n'est ni la forme texte (une accolade) ni la forme HTML (deux exactement)
// — refusé ICI, avant tout appel à extractBraceBody, dès que la 3e accolade est vue : la MÊME
// garde attrape aussi `{{{{` (quatre) et plus, un seul caractère à regarder suffit.
function replaceDoubleBraceDirective(html: string, marker: string, attrName: string, catalogKey: MsgKey, tripleCatalogKey: MsgKey): string {
  const open = marker + '{{'
  if (!html.includes(open)) return html
  let out = ''
  let i = 0
  while (i < html.length) {
    const idx = html.indexOf(open, i)
    if (idx === -1) { out += html.slice(i); break }
    const before = html[idx - 1]
    if (before !== undefined && /\w/.test(before)) {
      // \B — pas une frontière de mot : @ collé à un identifiant = texte littéral, pas une directive
      out += html.slice(i, idx + 1)
      i = idx + 1
      continue
    }
    out += html.slice(i, idx)
    if (html[idx + open.length] === '{') throw new Error(t(tripleCatalogKey, { extrait: clampRaw(html.slice(idx, idx + 20)) }))
    const { body, end } = extractBraceBody(html, idx + open.length)
    if (end === -1 || html[end + 1] !== '}') throw new Error(t(catalogKey, { raw: clampRaw(body) }))
    out += `${attrName}={${body}}`
    i = end + 2
  }
  return out
}

// ----------------------------------------------------------------------------
// preprocessHtml — transformations HTML pré-parser (port partiel transpiler.rb)
// ----------------------------------------------------------------------------
// maskHtmlComments — remplace la regex
// `/<!--[\s\S]*?-->/g` (ci-dessous, preprocessHtml) par un scanner qui ne reconnaît `<!--` comme
// départ de commentaire QUE HORS BALISE. L'ancienne regex démarrait un commentaire DANS une valeur
// d'attribut (ex. `<div title="<!--">`) et avalait tout jusqu'au PROCHAIN `-->` réel, une directive
// légitime comprise (`<a @confirm="A">` perdue, miscompilée). Ici, DANS une balise (`<nom …>`), on
// saute directement à son vrai `>` (scanTagClose, guillemets respectés) sans jamais y chercher de
// commentaire. Un commentaire jamais refermé n'est PAS masqué (même sort que l'ancienne regex, qui
// ne matchait pas non plus sans `-->`) — le texte continue d'être scanné normalement ensuite.
function maskHtmlComments(html: string, mask: (m: string) => string): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const comment = readHtmlComment(html, i)
      if (comment === null) { out += html.slice(i, i + 4); i += 4; continue }
      out += mask(html.slice(i, comment.end))
      i = comment.end
      continue
    }
    if (html[i] === '<' && /[a-zA-Z/]/.test(html[i + 1] ?? '')) {
      const close = scanTagClose(html, i + 1)
      const end = close === -1 ? html.length : close + 1
      out += html.slice(i, end)
      i = end
      continue
    }
    out += html[i]
    i++
  }
  return out
}

// maskAttrQuotes — même principe que maskHtmlComments juste au-dessus (scanTagClose, guillemets
// respectés) : neutralise le CONTENU des valeurs d'attribut de chaque VRAIE balise (délimiteurs
// gardés, longueur inchangée). Sert à la vérification d'isométrie mjs-* juste en dessous — sans
// ça, un texte `</mjs-carte>` posé DANS un attribut (`title="voir </mjs-carte> pour plus"`)
// comptait comme une VRAIE fermeture au même titre qu'un `</mjs-carte>` réel : un composant
// pourtant équilibré se faisait rejeter (message mensonger, « Fermetures » gonflées).
function maskAttrQuotes(html: string): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    if (html[i] === '<' && /[a-zA-Z/]/.test(html[i + 1] ?? '')) {
      const close = scanTagClose(html, i + 1)
      const end = close === -1 ? html.length : close + 1
      out += html.slice(i, end).replace(/"[^"]*"|'[^']*'/g, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[0])
      i = end
      continue
    }
    out += html[i]
    i++
  }
  return out
}

// maskInterpolations — empile chaque bloc `{…}` d'interpolation de TEXTE (jamais une balise
// entière, cf. le branchement scanTagClose ci-dessous) dans codeMasks, AVANT les réécritures de
// directives plus bas : un exemple de doc affiché EN TOUTES LETTRES dans une chaîne de texte —
// `{'…@preload="hover"…'}` — n'est pas un VRAI attribut du balisage. Sans ce masquage, les regex
// `\B@xxx=…` plus bas le réécrivaient quand même (texte affiché corrompu) ou le REFUSAIENT à tort
// (`{'…@callback={foo}…'}`, forme montrée en contre-exemple). Une VRAIE balise est copiée
// VERBATIM (jamais masquée ICI) : la valeur d'une directive à accolades (`@confirm={ text: … }`,
// `@viewTransition.cube={ dir: left }`) est elle-même un `{…}`, mais À L'INTÉRIEUR d'une balise —
// la masquer aurait caché la directive à la regex censée la traiter, pas seulement la prose.
// Fin de l'interpolation lue par finExpression (même aide que maskStaticHtmlText plus haut) : un `}`
// littéral dans une chaîne (`{'a}'}`) ne la referme jamais trop tôt, un guillemet dans une regex
// (`{ $t.replace(/"/g, '') }`) n'ouvre pas une chaîne qui masquerait tout le reste du HTML.
function maskInterpolations(html: string, mask: (m: string) => string): string {
  let out = ''
  let i = 0
  const n = html.length
  while (i < n) {
    // `@` en plus de `[a-zA-Z/]` (contrairement à maskHtmlComments/maskAttrQuotes plus haut) :
    // une balise-macro <@view .../<@include …> porte elle aussi des directives à accolades
    // (`<@view main @viewTransition.cube={ dir: left }>`) — l'exclure aurait masqué CETTE
    // accolade-là comme du texte, cachant la directive à la regex censée la traiter.
    if (html[i] === '<' && /[a-zA-Z/@]/.test(html[i + 1] ?? '')) {
      const close = scanTagClose(html, i + 1)
      const end = close === -1 ? n : close + 1
      out += html.slice(i, end)
      i = end
      continue
    }
    if (html[i] === '{') {
      const fin = finExpression(html, i)
      const j = fin < 0 ? n : fin
      out += mask(html.slice(i, j))
      i = j
      continue
    }
    out += html[i]
    i++
  }
  return out
}

function preprocessHtml(html: string, moduleName: string): string {
  let out = html

  // Auto-fermeture mjs-* : <mjs-foo /> → <mjs-foo></mjs-foo> (un `>` entre guillemets ou dans une expression ne coupe pas la balise)
  out = fermerComposantsAutoFermes(out)

  // Vérification d'isométrie (open vs close) — comptée sur une vue où les valeurs d'attribut
  // (maskAttrQuotes) ET les interpolations de TEXTE (maskInterpolations, définie plus bas) sont
  // neutralisées : un texte `</mjs-carte>` DANS un attribut OU cité dans une interpolation
  // (`{'exemple : </mjs-carte> en trop'}`, prose affichée) n'est jamais une vraie fermeture. Une
  // VRAIE balise reste copiée verbatim par maskInterpolations (jamais masquée) : un vrai
  // déséquilibre continue d'être détecté.
  const isoView = maskInterpolations(maskAttrQuotes(out), (m) => m.replace(/[^\n]/g, ' '))
  const tags = new Set<string>()
  isoView.replace(/<(mjs-[a-zA-Z0-9_-]+)[^>]*>/g, (_m, t) => { tags.add(t); return _m })
  for (const tag of tags) {
    const openRe = new RegExp(`<${tag}(?:\\s+[^>]*?)?>`, 'g')
    const closeRe = new RegExp(`</${tag}>`, 'g')
    const opens = (isoView.match(openRe) ?? []).length
    const closes = (isoView.match(closeRe) ?? []).length
    if (opens !== closes) {
      throw new Error(t('transpiler.desequilibre-structurel', { moduleName, tag, opens, closes }))
    }
  }

  // Directives d'attribut (`@noUJS`, `@preload`) → attributs HTML. On MASQUE
  // d'abord les blocs <pre>/<code> ET les commentaires HTML <!-- --> : un tuto/doc
  // qui AFFICHE `@preload="on"` dans un exemple de code, ou une forme refusée dans un commentaire
  // purement documentaire, ne doit pas faire échouer la compilation du reste.
  // On masque AUSSI les expressions `{…}` (texte ou attribut) : les directives ci-dessous ne
  // sont réécrites QUE dans du vrai balisage, jamais dans une chaîne de code (maskInterpolations,
  // même raison que <pre>/<code>/commentaires juste au-dessus).
  const codeMasks: string[] = []
  out = out
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (m) => (codeMasks.push(m), `\x00CM${codeMasks.length - 1}\x00`))
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, (m) => (codeMasks.push(m), `\x00CM${codeMasks.length - 1}\x00`))
  out = maskHtmlComments(out, (m) => (codeMasks.push(m), `\x00CM${codeMasks.length - 1}\x00`))
  out = maskInterpolations(out, (m) => (codeMasks.push(m), `\x00CM${codeMasks.length - 1}\x00`))

  // @noUJS="valeur" → REFUSÉ, même politique que @permanent juste plus bas : la
  // directive est NUE par nature (elle désactive l'interception pour la balise entière, rien à
  // préciser) — une valeur qui traîne serait un bogue muet (attribut mjs-no-ujs='valeur' posé au
  // lieu du marqueur nu attendu). GARDE testée AVANT la forme nue, même piège de capture que
  // @permanent (sinon `="valeur"` traînerait tel quel après mjs-no-ujs).
  out = out.replace(/\B@no-?ujs=("[^"]*"|'[^']*'|[^\s/>]*)/gi, (_m, valeur) => {
    throw new Error(t('transpiler.no-ujs-valeur-refusee', { valeur }))
  })
  // @noUJS → mjs-no-ujs (casse insensible, tiret optionnel : @noUJS/@noUjs/@noujs/@no-ujs)
  out = out.replace(/\B@no-?ujs\b/gi, 'mjs-no-ujs')

  // @permanent → mjs-permanent, forme NUE seulement, casse
  // insensible (même politique que @no-ujs juste au-dessus). Le runtime (µ._mjs_navTransplantPermanents,
  // mjs_ujs.ts, LECTURE SEULE ici) apparie un élément permanent entre deux navigations PAR SON
  // `id` — jamais par une valeur portée par la directive elle-même : `@permanent="nom"` n'aurait
  // donc RIEN à faire de ce nom, un silence qui laisserait croire à tort à une clé d'appariement.
  // Plutôt qu'ignorer la valeur en silence, ERREUR explicite qui renvoie vers `id` — GARDE testée
  // AVANT la forme nue (sinon `/\B@permanent\b/` matcherait le `@permanent` de `@permanent="nom"`
  // en laissant `="nom"` traîner tel quel dans le HTML, même piège que @callback/@flash plus bas).
  out = out.replace(/\B@permanent=("[^"]*"|'[^']*'|[^\s/>]*)/gi, (_m, valeur) => {
    throw new Error(t('transpiler.permanent-valeur-refusee', { valeur }))
  })
  out = out.replace(/\B@permanent\b/gi, 'mjs-permanent')

  // @preload="on" (sur un <a>, niveau 3) → attribut data-mjs-preload lu au runtime.
  // Valeurs : on|hover|off (guillemets simples/doubles ou nus) ; `eager` refusé
  out = out.replace(/\B@preload=(["']?)eager\1/g, () => {
    throw new Error(t('transpiler.preload-eager-renomme', { ou: 'attribut @preload d\'un lien' }))
  })
  out = out.replace(/\B@preload=(["']?)(on|hover|off)\1/g, 'data-mjs-preload="$2"')

  // @method="delete" (sur un <a>, UJS) → attribut mjs-method lu au runtime.
  // Verbe LIBRE (pas un vocabulaire fixe comme @preload) : la validation
  // (delete/post/put/patch, verbe inconnu → warning + navigation normale) est
  // DÉLIBÉRÉMENT côté runtime (mjs_ujs.ts) — le compilateur convertit tel quel.
  out = out.replace(/\B@method=(["']?)([a-zA-Z]+)\1/g, 'mjs-method="$2"')

  // @confirm="Vraiment supprimer ?" (sur <a>/<form>/<button>) → attribut
  // mjs-confirm lu au runtime (window.confirm avant toute interception). Message LIBRE : échappé
  // via escapeVtAttrValue (quotes ET accolades — une accolade LITTÉRALE dans le message ferait
  // sinon prendre l'attribut pour une interpolation JS par le pipeline générique d'attributs, même
  // piège que mjs-title/data-mjs-vt, cf. son bandeau plus haut) — même traitement que la forme
  // chaîne de @title juste plus bas. Extraction par replaceQuotedDirective/scanQuoted —
  // PAS une regex `(?:(?!\1)[\s\S])*` : une apostrophe française échappée (`\'`) dans
  // le message coupait l'attribut au milieu (HTML corrompu, silencieux) avant ce correctif ; une
  // chaîne jamais refermée est maintenant une ERREUR de compile explicite, plus un pass-through muet.
  out = replaceQuotedDirective(out, '@confirm=', (msg) => `mjs-confirm="${escapeVtAttrValue(msg)}"`, (raw) => {
    throw new Error(t('transpiler.confirm-objet-invalide', { raw }))
  })

  // @confirm={ text: '…', ok: '…', cancel: '…' } (forme OBJET) → MÊME attribut mjs-confirm,
  // mais en JSON STRICT (le runtime distingue à la lecture selon que la valeur commence par '{', cf.
  // µ.confirm, mjs_ujs.ts). Littéral STATIQUE SEULEMENT : clés PARMI text/ok/cancel, valeurs chaîne
  // entre guillemets simples OU doubles séparées par des virgules — aucune expression/variable pour
  // CES clés (mini-grammaire fermée, pas du JS évalué, même esprit que parseVtValue). `escapeVtAttrValue`
  // (définie juste au-dessus, PAS spécifique à @viewTransition malgré son nom) : le JSON produit
  // commence PAR `{` — sans échapper aussi les accolades (pas seulement les guillemets), le pipeline
  // générique d'attributs le prendrait pour une INTERPOLATION JS (même piège que data-mjs-vt, cf.
  // son bandeau). La forme chaîne juste au-dessus reste INCHANGÉE. Extraction du corps par
  // extractBraceBody/replaceBraceDirective (ci-dessus) — PAS un simple `[^{}]*` : une accolade
  // LITTÉRALE dans une valeur (`text: 'a{b'`) doit rester DANS la chaîne, pas fermer prématurément
  // l'extraction. Valeur de chaque clé lue via scanQuoted — PAS
  // `(?:'([^']*)'|"([^"]*)")` : une apostrophe échappée (`\'`) dans la valeur arrêtait la
  // capture en plein milieu, rejetant à tort tout l'objet en confirm-objet-invalide.
  //
  // @confirm={maVar}/{a || b}/{f()} (forme EXPRESSION) — MÊME
  // disambiguation que @title={...} juste plus bas (`/^[a-zA-Z_$][\w$]*\s*:/`) : un hash d'options
  // porte toujours au moins une `clé:` en tête ; tout le reste PASSE-PLAT en mjs-confirm={expr},
  // rendu RÉACTIF par le pipeline générique d'attributs (aucune intervention nécessaire ici, même
  // mécanisme que `title={$expr}` natif) — le runtime (µ._mjs_ujsOnClick/OnSubmit, mjs_ujs.ts, LECTURE
  // SEULE ici) relit `getAttribute('mjs-confirm')` à CHAQUE clic : la valeur suit donc la variable
  // d'un clic à l'autre, jamais figée à celle du montage.
  out = replaceBraceDirective(out, '@confirm={', (raw) => {
    const trimmed = raw.trim()
    if (!/^[a-zA-Z_$][\w$]*\s*:/.test(trimmed)) return `mjs-confirm={${raw}}`
    const obj: Record<string, string> = {}
    const parts: string[] = []
    let translated = false
    let rest = trimmed
    while (rest.length > 0) {
      const keyM = rest.match(/^(text|ok|cancel)\s*:\s*/)
      const vi = keyM ? keyM[0].length : -1
      const call = keyM ? scanTranslatedCall(rest, vi) : null
      const scanned = keyM && !call && (rest[vi] === "'" || rest[vi] === '"') ? scanQuoted(rest, vi) : null
      if (!keyM || (!scanned && !call)) throw new Error(t('transpiler.confirm-objet-invalide', { raw }))
      if (call) {
        translated = true
        parts.push(`${keyM[1]}: ${call.expr}`)
        rest = rest.slice(call.end).replace(/^\s*,?\s*/, '')
        continue
      }
      obj[keyM[1]] = scanned!.content
      parts.push(`${keyM[1]}: ${JSON.stringify(scanned!.content)}`)
      rest = rest.slice(scanned!.end + 1).replace(/^\s*,?\s*/, '')
    }
    // au moins un µt(…) : attribut dynamique qui fabrique le même JSON, refait à chaque changement de langue
    if (translated) return `mjs-confirm={JSON.stringify({ ${parts.join(', ')} })}`
    return `mjs-confirm="${escapeVtAttrValue(JSON.stringify(obj))}"`
  })

  // @callback="nomMethode" (sur <a>/<form>/<button>) → attribut mjs-callback lu au runtime
  // (mjs_ujs.ts, µ._mjs_navRunCallback — SUCCÈS de navigation seulement). GARDE anti-piège : la forme
  // accolades @callback={…} est une ERREUR de compile explicite — sans elle, le repli générique du
  // pipeline d'attributs en ferait un écouteur DOM fantôme sur un événement 'callback' inexistant.
  // Nom validé ICI (identifiant simple [A-Za-z_$][\w$]*) : même message d'erreur pour les deux pièges.
  out = out.replace(/\B@callback=(\{[^}]*\}?)/g, (_m, raw) => {
    throw new Error(t('transpiler.callback-nom-attendu', { valeur: raw }))
  })
  out = out.replace(/\B@callback=(["'])([^"']*)\1/g, (_m, _q, nom) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(nom)) {
      throw new Error(t('transpiler.callback-nom-attendu', { valeur: `"${nom}"` }))
    }
    return `mjs-callback="${nom}"`
  })

  // @flash="popup"/"console"/"silent" (sur <a>/<form>/<button>) → attribut mjs-flash lu au
  // runtime (mjs_ujs.ts, µ._mjs_navFlashPolicy — politique par élément du veilleur flash/error).
  // Vocabulaire FERMÉ (contrairement à @method, verbe libre) : SEULES ces 3 valeurs. GARDE anti-piège
  // (même patron que @callback juste au-dessus) : la forme accolades @flash={…} ET toute valeur hors
  // énumération sont des ERREURS de compile explicites — sans elles, le repli générique du pipeline
  // d'attributs en ferait un écouteur DOM fantôme sur un événement 'flash' inexistant.
  out = out.replace(/\B@flash=(\{[^}]*\}?)/g, (_m, raw) => {
    throw new Error(t('transpiler.flash-valeur-invalide', { valeur: raw }))
  })
  out = out.replace(/\B@flash=(["'])([^"']*)\1/g, (_m, _q, val) => {
    if (val !== 'popup' && val !== 'console' && val !== 'silent') {
      throw new Error(t('transpiler.flash-valeur-invalide', { valeur: `"${val}"` }))
    }
    return `mjs-flash="${val}"`
  })

  // @title="texte" (sur N'IMPORTE QUELLE balise) → attribut mjs-title lu au runtime
  // (mjs_title.ts, module CŒUR). Comme @confirm : échappé via escapeVtAttrValue (quotes ET
  // accolades — sinon le pipeline générique d'attributs prendrait une accolade littérale du texte
  // pour une interpolation JS, même piège que data-mjs-vt/mjs-confirm objet, cf. bandeau plus haut).
  // Extraction par replaceQuotedDirective/scanQuoted, même correctif et même
  // raison que la forme chaîne de @confirm plus haut (apostrophe échappée `\'`).
  out = replaceQuotedDirective(out, '@title=', (msg) => `mjs-title="${escapeVtAttrValue(msg)}"`, (raw) => {
    throw new Error(t('transpiler.title-objet-invalide', { raw }))
  })

  // @title={{ expr }} — FORME HTML : DEUX accolades ouvrantes
  // ACCOLÉES juste après `@title=` (SANS espace) → HTML brut, corps = EXPRESSION (jamais un objet
  // d'options, contrairement à la forme simple juste plus bas) — même convention que `{{expr}}`
  // en interpolation de texte (HTML brut) vs `{expr}` (échappé), cf. docs/07-bindings.md. Attribut
  // DISTINCT `mjs-title-html` (jamais `mjs-title`) → passe-plat réactif par le pipeline générique
  // d'attributs, même mécanisme que `mjs-title={expr}` juste plus bas. Un objet littéral en tête
  // reste écrivable dans la forme SIMPLE en glissant un ESPACE entre les deux accolades
  // (`@title={ { text: '…' } }`, cas rare) : cette forme-ci ne matche PAS ici
  // (replaceDoubleBraceDirective exige les deux accolades ACCOLÉES), elle retombe intacte sur
  // replaceBraceDirective juste après. SÉCURITÉ : porte ouverte volontaire, comme `{{expr}}` en
  // interpolation — aucune désinfection ici, ne l'alimente jamais avec une saisie non maîtrisée
  // (cf. mjs_title.ts, volet runtime).
  out = replaceDoubleBraceDirective(out, '@title=', 'mjs-title-html', 'transpiler.title-html-non-ferme', 'transpiler.title-html-triple-accolade')

  // @title={...} — DEUX formes distinguées par leur CONTENU (rien à voir avec @confirm, qui n'a
  // pas de forme expression) :
  //   - objet littéral STATIQUE (une clé RECONNUE en tête, ex. `text: '…'`) → validé strictement
  //     (text obligatoire, delay/dur nombres, side top/bottom, transition fade/slide — clé
  //     inconnue ou valeur non littérale REJETÉES) puis émis en DEUX attributs : mjs-title="<text>"
  //     (texte, relu à chaque apparition côté runtime) + mjs-title-conf="<JSON>" (le reste des
  //     clés, SEULEMENT si au moins une est fournie).
  //   - expression généraliste (pas de `clé:` en tête) → PASSE-PLAT en mjs-title={expr} tel quel :
  //     le pipeline générique d'attributs (parser/generator) le reconnaît tout seul comme
  //     dynamique et le rend RÉACTIF, aucune intervention nécessaire ici (même mécanisme générique
  //     que `title={$expr}` natif, cf. tests/parser.test.ts).
  // Extraction du corps par extractBraceBody/replaceBraceDirective (ci-dessus, même raison que
  // @confirm={...} un peu plus haut) — PAS un simple `[^{}]*`. Valeur de chaque clé CHAÎNE lue via
  // scanQuoted — PAS `(?:'([^']*)'|"([^"]*)")` : une apostrophe/un guillemet
  // échappés (`\'`/`\"`) dans la valeur arrêtait la capture en plein milieu, rejetant à tort
  // tout l'objet en title-objet-invalide (delay/dur restent la seule forme NOMBRE, inchangée).
  out = replaceBraceDirective(out, '@title={', (raw) => {
    const trimmed = raw.trim()
    if (!/^[a-zA-Z_$][\w$]*\s*:/.test(trimmed)) return `mjs-title={${raw}}`
    const conf: Record<string, string | number> = {}
    let text: string | undefined
    let textCall: string | undefined
    let rest = trimmed
    while (rest.length > 0) {
      const keyM = rest.match(/^(text|delay|side|dur|transition)\s*:\s*/)
      if (!keyM) throw new Error(t('transpiler.title-objet-invalide', { raw }))
      const key = keyM[1]
      const vi = keyM[0].length
      // text: µt(…) : seul appel accepté, et seulement pour cette clé (les réglages restent littéraux)
      const call = key === 'text' ? scanTranslatedCall(rest, vi) : null
      if (call) {
        textCall = call.expr
        rest = rest.slice(call.end).replace(/^\s*,?\s*/, '')
        continue
      }
      let str: string | undefined
      let num: string | undefined
      if (rest[vi] === "'" || rest[vi] === '"') {
        const scanned = scanQuoted(rest, vi)
        if (!scanned) throw new Error(t('transpiler.title-objet-invalide', { raw }))
        str = scanned.content
        rest = rest.slice(scanned.end + 1).replace(/^\s*,?\s*/, '')
      } else {
        const numM = rest.slice(vi).match(/^-?\d+(?:\.\d+)?/)
        if (!numM) throw new Error(t('transpiler.title-objet-invalide', { raw }))
        num = numM[0]
        rest = rest.slice(vi + numM[0].length).replace(/^\s*,?\s*/, '')
      }
      if (key === 'text') {
        if (str === undefined) throw new Error(t('transpiler.title-objet-invalide', { raw }))
        text = str
      } else if (key === 'delay' || key === 'dur') {
        if (num === undefined) throw new Error(t('transpiler.title-objet-invalide', { raw }))
        conf[key] = Number(num)
      } else {
        if (str === undefined) throw new Error(t('transpiler.title-objet-invalide', { raw }))
        if (key === 'side' && str !== 'top' && str !== 'bottom') throw new Error(t('transpiler.title-objet-invalide', { raw }))
        if (key === 'transition' && str !== 'fade' && str !== 'slide') throw new Error(t('transpiler.title-objet-invalide', { raw }))
        conf[key] = str
      }
    }
    if (text === undefined && textCall === undefined) throw new Error(t('transpiler.title-objet-invalide', { raw }))
    let attrs = textCall !== undefined ? `mjs-title={${textCall}}` : `mjs-title="${escapeVtAttrValue(text!)}"`
    if (Object.keys(conf).length > 0) attrs += ` mjs-title-conf="${escapeVtAttrValue(JSON.stringify(conf))}"`
    return attrs
  })

  // Syntaxe OBJET @viewTransition.<nom>={ direction, duration, priority }
  // (alias @vt RETIRÉ ici — reste capturé à la racine du fichier pour le
  // message, directives.ts, et sur <a @pageTransition="…">, mécanisme UJS
  // distinct plus bas), calquée sur @transition.fly={ y: 200, duration: 2000 } — mini-
  // grammaire TEXTE (parseVtValue, bundler/config.ts), PAS du JS évalué (clés
  // LONGUES ou COURTES — dir/dur/p —, mixables). Sur <@view …> (niveau 3) →
  // attribut data-mjs-vt (chaîne VERBATIM `<nom>` ou `<nom>={...}`, relue au
  // runtime par µ._mjs_vtParse), +data-mjs-vt-p si l'option `priority:`/`p:` est
  // présente (canal séparé EXISTANT, résolution runtime
  // _mjs_vtWinner/_mjs_vtResolveWithPriority INCHANGÉE).
  // Formes rejetées (erreurs de migration) : on/off explicites, le suffixe
  // `:direction` dans le nom, l'ancienne forme VALEUR STATIQUE
  // @viewTransition="nom" (guillemets ou non). La forme NUE — SEULE, sans nom
  // — n'a plus d'effet propre sur une <@view> : elle n'existe plus qu'à la racine d'un module
  // (directives.ts, forme 'on' inchangée là-bas).
  out = out.replace(
    /(<@view\b[^>]*?)[ \t]+@(viewTransition)(\.[a-zA-Z][a-zA-Z0-9:_-]*(?:[ \t]*=[ \t]*\{[^}]*\})?|=(?:"[^"]*"|'[^']*'|[^\s>]*))?(?=[\s/>])/g,
    (_m, pre, directive, rest) => {
      const label = `@${directive}`
      if (rest === undefined) {
        throw new Error(t('transpiler.viewtransition-nu-sur-view', { label }))
      }

      if (rest[0] === '.') {
        const dm = rest.match(/^\.([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?$/)
        if (!dm) {
          throw new Error(t('transpiler.viewtransition-forme-invalide-sur-view', { label, rest }))
        }
        const nameAndDir: string = dm[1]
        const optsRaw: string | undefined = dm[2]
        const base = nameAndDir.split(':')[0]
        if (base === 'off') throw new Error(t('transpiler.vt-off-nexiste-pas', { label }))
        if (base === 'on') throw new Error(t('transpiler.vt-on-implicite', { label }))
        // Le suffixe `:direction` n'existe plus, la SEULE façon
        // d'orienter est la clé d'option (`${label}.cube={ dir: left }`).
        if (nameAndDir.includes(':')) {
          throw new Error(t('transpiler.vt-direction-plus-dans-nom', { label, example: `${label}.cube={ dir: left }` }))
        }
        const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
        const parsed = parseVtValue(verbatim)
        // Cast explicite : strictNullChecks:false (tsconfig du projet) désactive le
        // narrowing natif des unions discriminées — cf. le même commentaire dans config.ts.
        if (!parsed.ok) throw new Error(t('transpiler.viewtransition-erreur-parsing-sur-view', { label, nameAndDir, erreur: (parsed as { ok: false; error: string }).error }))
        // PAS de contrôle de la base — cf. le commentaire jumeau dans sections.ts : la parité avec
        // `<style @viewTransition…>` tient, mais sur la TOLÉRANCE, pas sur le refus.
        const okParsed = parsed as { ok: true; value: { priority: number | null } }
        // Entités HTML sur `{`/`}` (PAS de littéral `{` dans l'attribut généré) :
        // le pipeline générique d'attributs traite TOUTE valeur statique contenant
        // un `{` littéral comme une INTERPOLATION JS (rawVal.includes('{') →
        // interpolation(env), generator/attributes/index.ts) — `turn:right={
        // priority: 3 }` finirait évalué comme un objet JS (`[object Object]`),
        // et `duration: 600ms` casserait carrément la compilation (`600ms` n'est
        // pas un token JS valide). Décodées automatiquement par le navigateur à
        // `getAttribute()` (entités HTML standard) — µ._mjs_vtParse reçoit le VRAI texte.
        let attrs = ` data-mjs-vt="${escapeVtAttrValue(verbatim)}"`
        if (okParsed.value.priority != null) attrs += ` data-mjs-vt-p="${okParsed.value.priority}"`
        return pre + attrs
      }

      // Ancienne forme `=...` (guillemets ou non) — détecte on/off d'abord.
      const em = (rest as string).match(/^=(?:"([^"]*)"|'([^']*)'|([^\s>]*))$/)
      const val = (em ? (em[1] ?? em[2] ?? em[3]) : '') ?? ''
      const nameOnly = val.trim().split(/\s+/)[0] || ''
      if (nameOnly === 'off') throw new Error(t('transpiler.vt-off-nexiste-pas', { label }))
      if (nameOnly === 'on') throw new Error(t('transpiler.vt-on-implicite', { label }))
      throw new Error(t('transpiler.viewtransition-ancienne-forme-view', { label, val, nameOnly }))
    },
  )

  // @vt sur <a> N'EXISTE PLUS : renommé @pageTransition, seule orthographe du
  // mécanisme (nom long à part entière, pas un alias) — erreur d'orientation
  // AVANT le remplacement ci-dessous, sur le modèle de
  // transpiler.viewtransition-racine-interdite.
  out = out.replace(/\B@vt=(["']?)([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)\1/g, (_m, q: string, val: string) => {
    throw new Error(t('transpiler.vt-renomme-pagetransition', { ligne: `@vt=${q}${val}${q}`, remplacement: `@pageTransition=${q}${val}${q}` }))
  })

  // @pageTransition="nom|on|off|nom={ direction: …, duration: … }" (sur un <a>, transition de
  // PAGE niveau UJS — même famille que @method/@confirm ci-dessus) → attribut mjs-vt lu au
  // runtime (mjs_ujs.ts, µ._mjs_vtResolvePage). DISTINCT de @viewTransition (niveau <@view>/composant,
  // juste au-dessus) : une page n'a pas de "vue routée". Mécanisme SÉPARÉ — @pageTransition="off"/
  // "on" restent des mots réservés PROPRES à ce mécanisme (µ._mjs_vtResolvePage les lit
  // explicitement), DISTINCT du refus on/off des 4 autres positions (vt-off-nexiste-pas/
  // vt-on-implicite, qui NE s'appliquent PAS ici). L'attribut HTML produit (mjs-vt) NE CHANGE
  // PAS : contrat interne au compilateur/runtime, seule la syntaxe auteur s'élargit.
  //
  // La syntaxe OBJET `nom={ direction: …, duration: … }` (MÊME mini-grammaire que
  // <@view>/<style> ci-dessus, parseVtValue) s'ajoute au nom simple déjà accepté ; le suffixe
  // `:direction` dans le nom devient une erreur, MÊME clé de message que les 4 autres positions
  // (vt-direction-plus-dans-nom) mais un EXEMPLE PROPRE : un
  // lien n'a pas de forme à point (`@pageTransition.cube={...}` n'existe pas), sa vraie forme est
  // une CHAÎNE (`@pageTransition="cube={ dir: left }"`) — reprendre l'exemple à point des 4 autres
  // positions était trompeur. `priority`/`p` REFUSÉ : la cascade d'un lien
  // n'a que 2 niveaux (lien > config, µ._mjs_vtResolvePage) — aucun arbitrage départ/arrivée à
  // départager ici (_mjs_vtWinner/_mjs_vtResolveWithPriority sont réservés au routeur, mjs_router.ts) :
  // l'option serait syntaxiquement acceptée par µ._mjs_vtParse au runtime mais resterait MORTE
  // (jamais lue par _mjs_vtWrapSwap/_mjs_vtApplyPreset/_mjs_vtCurtainRun) — plutôt qu'un piège silencieux,
  // une erreur de build explicite.
  out = out.replace(
    /\B@pageTransition=(?:"([^"]*)"|'([^']*)'|([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?))(?=[\s/>])/g,
    (_m, dq, sq, bare) => {
      const label = '@pageTransition'
      const val   = dq ?? sq ?? bare ?? ''
      if (val === 'on' || val === 'off') return `mjs-vt="${val}"`
      const fm = val.match(/^([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?$/)
      if (!fm) throw new Error(t('transpiler.pagetransition-forme-invalide', { label, val }))
      const nameAndDir: string = fm[1]
      const optsRaw: string | undefined = fm[2]
      if (nameAndDir.includes(':')) throw new Error(t('transpiler.vt-direction-plus-dans-nom', { label, example: `${label}="cube={ dir: left }"` }))
      const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
      const parsed = parseVtValue(verbatim)
      // cast explicite : strictNullChecks:false (tsconfig du projet) désactive le narrowing natif
      // des unions discriminées — même piège que les autres call-sites, cf. leurs commentaires.
      if (!parsed.ok) throw new Error(t('transpiler.pagetransition-erreur-parsing', { label, valeur: verbatim, erreur: (parsed as { ok: false; error: string }).error }))
      const okParsed = parsed as { ok: true; value: { priority: number | null } }
      if (okParsed.value.priority != null) throw new Error(t('transpiler.pagetransition-priority-sans-effet', { label, valeur: verbatim }))
      return `mjs-vt="${escapeVtAttrValue(verbatim)}"`
    },
  )

  // @viewTransition sur une balise ORDINAIRE (pas <@view>, déjà consommé
  // ci-dessus) — grammaire EXHAUSTIVE, 3 formes seulement :
  //   - @viewTransition.<nomMorph> (point, SANS valeur — nomMorph PAS limité à
  //     la bibliothèque de préréglages) → nom de morph STATIQUE, raccourci
  //     compilé vers @style.view-transition-name="<nomMorph>".
  //   - @viewTransition.<nomMorph>={...} (point + options) → ERREUR : les
  //     options (direction/duration/priority) n'ont de sens qu'aux niveaux de
  //     NAVIGATION (config/module/<@view>), pas sur un simple nom de morph.
  //   - @viewTransition="nom" / ='nom' / =nom (ancienne forme VALEUR STATIQUE,
  //     SANS accolade) → ERREUR de migration.
  // L'étiquette CALCULÉE (@viewTransition={expr}) et l'étiquette CONDITIONNELLE
  // (@viewTransition{cond}="nom") sont REFUSÉES : @style.view-transition-name
  // couvre déjà ces deux cas nativement (attribut de style natif), sans
  // grammaire dédiée à entretenir en double.
  out = out.replace(
    /\B@viewTransition\{([^}]*)\}[ \t]*=(?:"([^"]*)"|'([^']*)'|([^\s/>]*))/g,
    (_m, cond, dq, sq, bare) => {
      const val = dq ?? sq ?? bare ?? ''
      throw new Error(t('transpiler.viewtransition-etiquette-conditionnelle-interdite', { cond, val }))
    },
  )
  out = out.replace(
    /\B@viewTransition[ \t]*=[ \t]*\{([^}]*)\}/g,
    (_m, expr) => {
      throw new Error(t('transpiler.viewtransition-etiquette-calculee-interdite', { expr }))
    },
  )
  out = out.replace(
    /\B@viewTransition\.([a-zA-Z][a-zA-Z0-9:_-]*)([ \t]*=[ \t]*\{[^}]*\})?(?=[\s/>])/g,
    (_m, morphName, opts) => {
      if (opts) {
        throw new Error(t('transpiler.viewtransition-morph-options-interdites', { morphName }))
      }
      // ⚠ FAMILLE « GARDE MUETTE » — le `:` est capturé EXPRÈS pour pouvoir être
      // refusé. La classe de caractères l'excluait : la regex entière échouait sur
      // `@viewTransition.cube:left`, l'attribut n'était donc ni traduit ni signalé — le même
      // silence qu'on vient de fermer sur `<style>` et `<@view>`. Un nom de morph devient un
      // `view-transition-name` CSS, un custom-ident où le `:` n'a pas cours : le navigateur
      // jetterait la déclaration sans un mot. Même message qu'aux deux niveaux de navigation.
      if (morphName.includes(':')) {
        throw new Error(t('transpiler.vt-direction-plus-dans-nom', { label: '@viewTransition', example: '@viewTransition.cube={ dir: left }' }))
      }
      return `@style.view-transition-name="${morphName}"`
    },
  )
  out = out.replace(
    /\B@viewTransition[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s>]*))(?=[\s/>])/g,
    (_m, dq, sq, bare) => {
      const val = dq ?? sq ?? bare ?? ''
      throw new Error(t('transpiler.viewtransition-ancienne-forme', { val }))
    },
  )

  // Restaure les blocs de code masqués.
  out = out.replace(/\x00CM(\d+)\x00/g, (_, i) => codeMasks[+i])

  return out
}

// ----------------------------------------------------------------------------
// classifyUpdates — sépare struct / transition / content (V2).
//
// V2 — les updates "content" (text/attr/bindings) sont gérés via le dispatch
// direct par `effectsByVar` côté template. Ils ne vont plus dans le render
// monolithique. Seuls struct + trans alimentent `_mjs_renderStruct`.
// ----------------------------------------------------------------------------
function classifyUpdates(updates: string[]): {
  struct: string[]
  trans: string[]
  content: string[]
} {
  const struct: string[] = []
  const trans: string[] = []
  const content: string[] = []
  for (const u of updates) {
    // `_mjs_td` = code généré par `@attach` : on l'inclut dans struct pour qu'il soit
    // repassé à chaque re-rendu d'un bloc parent (`{if}`/`{key}`/`{for}`) — un nœud
    // recréé (nouveau ref) reçoit son attache ; une balise déjà attachée sur la même
    // connexion (`_mjs_att`) est sautée, cf. bindingAttach (generator/attributes).
    // `µ._mjs_fx(` (effet `*nom`) : même besoin, même rangement ; le moteur ignore une
    // seconde pose sur le même nœud
    if (/_mjs_updIf|_mjs_updFor|_mjs_updAwait|_mjs_updKey|_updElement|_mjs_td|µ\._mjs_fx\(/.test(u)) struct.push(u)
    else if (/_mjs_intro|_mjs_outro/.test(u)) trans.push(u)
    else content.push(u)
  }
  return { struct, trans, content }
}

// ----------------------------------------------------------------------------
// i18n — réécriture COMPILE-TIME des clés `µ.t(...)` (sucre `µt` déjà pointé
// par le lexer/generator à ce stade, cf. sigils.ts MU_SHORT_GLOBALS). Deux
// directives (directives.ts) pilotent la réécriture :
//   - @i18n 'section'         → préfixe les clés RELATIVES ('clé' → 'section.clé')
//   - @i18nPlaceholder <mode> → ajoute <mode> en 3e argument LITTÉRAL
// Un chemin ABSOLU (1er caractère `/`) n'est JAMAIS préfixé, section ou pas.
// 1er argument GABARIT (backtick, clé CALCULÉE) : jamais préfixé par la
// section (chemin absolu de fait) mais un `/` de tête est RETIRÉ, comme pour un littéral.
// 1er argument VARIABLE (identifiant, concat…) : appel laissé intact — seule une clé écrite EN
// DUR ou un gabarit peuvent être réécrits ici. Dans tous les cas, les arguments SUIVANTS (vars,
// etc.) sont rescannés RÉCURSIVEMENT par cette même fonction : un `µ.t(...)` niché y est
// préfixé/dépouillé/doté de son mode exactement comme un appel racine.
// ----------------------------------------------------------------------------

// Reconnaît un littéral '...'/"..." SIMPLE (pas de guillemet non échappé au
// milieu, donc pas de concat `'a' + 'b'`) — renvoie le quote utilisé + le
// contenu BRUT (guillemets exclus, échappements laissés tels quels).
function parseStringLiteralArg(raw: string): { quote: string; content: string } | null {
  const s = raw.trim()
  if (s.length < 2) return null
  const quote = s[0]
  if ((quote !== '"' && quote !== "'") || s[s.length - 1] !== quote) return null
  let i = 1
  while (i < s.length - 1) {
    if (s[i] === '\\') { i += 2; continue }
    if (s[i] === quote) return null
    i++
  }
  return { quote, content: s.slice(1, -1) }
}

// avance au-delà d'un gabarit (backtick) COMPLET à partir de `s[i] === '\`'`,
// interpolation(s) `${…}` comprises — y compris un backtick RÉ-imbriqué dans une interpolation
// (`${`inner`}`), à n'importe quelle profondeur (appel récursif sur lui-même). Guillemets
// simples/doubles internes à l'interpolation sautés (avec échappements) ; une virgule ou une
// parenthèse n'y a aucun effet particulier. Rend l'index JUSTE APRÈS le backtick fermant.
// Jamais refermé (gabarit invalide) : rend `-1`, NON PLUS `s.length` — les
// deux cas (« fermé au tout dernier caractère » et « jamais refermé ») étaient confondus sous la
// même valeur, `parseTemplateLiteralArg('\`/x')` rendait à tort `{ content: '/' }` au lieu de `null`.
// L'appel récursif interne (backtick ré-imbriqué jamais refermé) retombe sur `s.length` pour
// continuer à consommer jusqu'à la fin (comportement inchangé) ; pareil chez les appelants
// (parseTemplateLiteralArg → null automatiquement, `-1` n'égalant jamais `s.length` ;
// splitTopLevelArgs et maskTemplateLiterals → adaptés pour retomber sur `.length`).
export function skipTemplateLiteral(s: string, i: number): number {
  i++
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue }
    if (s[i] === '`') return i + 1
    if (s[i] === '$' && s[i + 1] === '{') {
      i += 2
      let depth = 1
      while (i < s.length && depth > 0) {
        const c = s[i]
        if (c === '"' || c === "'") {
          const quote = c
          i++
          while (i < s.length && s[i] !== quote) { if (s[i] === '\\') i++; i++ }
          i++
          continue
        }
        if (c === '`') {
          const end = skipTemplateLiteral(s, i)
          i = end === -1 ? s.length : end
          continue
        }
        if (c === '{') depth++
        else if (c === '}') depth--
        i++
      }
      continue
    }
    i++
  }
  return -1
}

// reconnaît un gabarit (backtick) en 1er argument d'un µ.t(...) : clé
// CALCULÉE ('`section.${x}`'), jamais préfixée par la section (chemin absolu de fait) mais un
// `/` de tête doit pouvoir être détecté puis retiré par l'appelant. Délègue
// à skipTemplateLiteral (au lieu d'un simple scan « 1er backtick non échappé ») : une
// interpolation `${…}` qui contient elle-même un gabarit (backtick imbriqué) est désormais
// reconnue comme gabarit ENTIER, pas invalidée au 1er backtick rencontré.
// Jamais refermé : skipTemplateLiteral rend `-1`, jamais égal à `s.length`
// (avant, `s.length` valait pour les deux cas, un gabarit non refermé était pris pour un gabarit
// ENTIER, `parseTemplateLiteralArg('\`/x')` rendait `{ content: '/' }` au lieu de `null`).
export function parseTemplateLiteralArg(raw: string): { content: string } | null {
  const s = raw.trim()
  if (s.length < 2) return null
  if (s[0] !== '`') return null
  const end = skipTemplateLiteral(s, 0)
  if (end !== s.length) return null
  return { content: s.slice(1, -1) }
}

// Découpe les arguments de plus haut niveau d'un appel (respecte chaînes et
// parenthèses/accolades/crochets imbriqués — même patron que les walkers
// d'interpolation du generator, cf. generator/utils.ts mapCodeSegments).
// Branche backtick à part, déléguée à skipTemplateLiteral : un gabarit
// dont l'interpolation contient elle-même un backtick (`${`inner`}`) est avalé ENTIER, ne
// coupe plus faussement les arguments suivants (l'ancien scan « jusqu'au prochain backtick »
// s'arrêtait au backtick imbriqué).
function splitTopLevelArgs(raw: string): string[] {
  const args: string[] = []
  let depth = 0
  let cur = ''
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '`') {
      // `-1` (jamais refermé) : consomme jusqu'à la fin, comme avant.
      const end = skipTemplateLiteral(raw, i)
      const j = end === -1 ? raw.length : end
      cur += raw.slice(i, j)
      i = j
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      cur += ch
      while (j < raw.length && raw[j] !== quote) {
        if (raw[j] === '\\') { cur += raw[j] + (raw[j + 1] ?? ''); j += 2; continue }
        cur += raw[j]; j++
      }
      if (j < raw.length) { cur += raw[j]; j++ }
      i = j
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { args.push(cur); cur = ''; i++; continue }
    cur += ch
    i++
  }
  if (cur.trim() !== '' || args.length > 0) args.push(cur)
  return args
}

// variante de MASK_STRINGS_AND_COMMENTS_RE SANS le gabarit (backtick) :
// celui-ci avale un gabarit ENTIER, `${…}` compris (cf. commentaire d'applyI18nPrefixing plus
// bas) — les guillemets/commentaires seuls n'ont pas ce défaut, un gabarit se masque À PART
// (maskTemplateLiterals, juste en dessous).
// Commentaires JS seulement (`//`, `/* */`), jamais `#`/`###` : ce masque ne lit que du JS DÉJÀ
// compilé, où `#` n'ouvre aucun commentaire. Pris pour un commentaire, le `#` d'un lien
// (`"#/x/#{n}"`, devenu un gabarit) masquait la fin de sa ligne — et les `µ.t(` qui la suivaient
// n'étaient plus préfixés par la section (libellés vides à l'écran)
const MASK_QUOTES_AND_COMMENTS_RE =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g

// Masque UNIQUEMENT le texte figé d'un gabarit (backtick) — une interpolation `${…}` est du JS
// VIVANT (jamais un `µ.t('clé')` simplement mentionné en dur) : elle reste lisible, jamais
// masquée. Profondeur de `{}` suivie ; guillemets internes à l'interpolation sautés SANS se
// laisser tromper par un `}` de leur contenu. Un caractère masqué = un caractère en sortie
// (position dans `code` original préservée, cf. l'appelant). Appelée APRÈS
// MASK_QUOTES_AND_COMMENTS_RE : un backtick encore présent à ce stade ne peut plus être QUE
// un vrai délimiteur de gabarit (les guillemets qui l'auraient rendu ambigu sont déjà masqués).
// Un backtick RÉ-imbriqué dans l'interpolation (`${`inner`}`) est sauté
// via skipTemplateLiteral (même aide que parseTemplateLiteralArg/splitTopLevelArgs), pas
// laissé au comptage naïf de `{`/`}` (le texte figé du gabarit imbriqué pourrait contenir
// lui-même une accolade non appariée).
function maskTemplateLiterals(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    if (code[i] !== '`') { out += code[i]; i++; continue }
    out += '`'
    i++
    while (i < code.length && code[i] !== '`') {
      if (code[i] === '\\') { out += code.slice(i, i + 2).replace(/[^\n]/g, 'x'); i += 2; continue }
      if (code[i] === '$' && code[i + 1] === '{') {
        const start = i
        let depth = 1
        i += 2
        while (i < code.length && depth > 0) {
          const c = code[i]
          if (c === '"' || c === "'") {
            const quote = c
            i++
            while (i < code.length && code[i] !== quote) { if (code[i] === '\\') i++; i++ }
            i++
            continue
          }
          if (c === '`') {
            // `-1` (jamais refermé) : consomme jusqu'à la fin, comme avant.
            const end = skipTemplateLiteral(code, i)
            i = end === -1 ? code.length : end
            continue
          }
          if (c === '{') depth++
          else if (c === '}') depth--
          i++
        }
        out += code.slice(start, i)   // interpolation : JS vivant, jamais masqué
        continue
      }
      out += code[i] === '\n' ? '\n' : 'x'
      i++
    }
    if (i < code.length) { out += '`'; i++ }
  }
  return out
}

// Scan caractère par caractère de `µ.t(`, balance-aware (chaînes + parenthèses
// imbriquées) — trouve la parenthèse fermante RÉELLE de chaque appel, jamais
// un `)` interne à un objet `vars` ou une chaîne.
function applyI18nPrefixing(code: string, section: string | null, mode: string | null, more: readonly string[] = []): string {
  if (!code.includes('µ.t(')) return code
  const marker = 'µ.t('
  // le marqueur était cherché par `indexOf` sur
  //    `code` BRUT : une chaîne JS qui MENTIONNE `µ.t('clé')` (texte d'aide, log) était prise
  //    pour un vrai appel et voyait sa « clé » préfixée par la section, à l'intérieur même de
  //    la chaîne. Copie masquée longueur-identique (même régime que lintEffectTopLevel) —
  //    chaînes/commentaires réduits à des `x` qui PRÉSERVENT les `\n` — utilisée UNIQUEMENT
  //    pour TROUVER l'index d'un `µ.t(` réel (un marqueur à l'intérieur d'une chaîne masquée
  //    n'y est plus littéralement présent) ; le scan des parenthèses/arguments qui suit reste
  //    sur `code` ORIGINAL, inchangé — l'argument du VRAI appel est lui-même une chaîne, donc
  //    masqué dans la copie, mais jamais dans `code`.
  // MASK_STRINGS_AND_COMMENTS_RE avale un gabarit (backtick) ENTIER,
  //    `${…}` compris : un `µ.t(...)` niché dans l'interpolation d'un gabarit (ex. le texte
  //    STATIQUE d'une branche {await}, compilé en `createTextNode(\`${µ.t('clé')}\`)`, jamais
  //    en `_mjs_updText(...)` comme {if}/{for}/{key}) disparaissait donc du masque — jamais trouvé,
  //    jamais réécrit, la clé restait NUE. Masque désormais en 2 temps : guillemets/commentaires
  //    d'abord (MASK_QUOTES_AND_COMMENTS_RE, identique à l'ancien masque MOINS le gabarit), puis
  //    gabarits à part (maskTemplateLiterals, ci-dessous) — texte figé masqué, `${…}` (JS vivant)
  //    laissé LISIBLE, seul moyen d'y retrouver un vrai `µ.t(`.
  const masked = maskTemplateLiterals(code.replace(MASK_QUOTES_AND_COMMENTS_RE, (m: string) => m.replace(/[^\n]/g, 'x')))
  let out = ''
  let i = 0
  while (i < code.length) {
    const idx = masked.indexOf(marker, i)
    if (idx === -1) { out += code.slice(i); break }
    out += code.slice(i, idx)
    let depth = 1
    let j = idx + marker.length
    while (j < code.length && depth > 0) {
      const ch = code[j]
      if (ch === '"' || ch === "'") {
        const quote = ch
        j++
        while (j < code.length && code[j] !== quote) { if (code[j] === '\\') j++; j++ }
        j++
        continue
      }
      if (ch === '`') {
        // délègue à skipTemplateLiteral : l'ancien scan « jusqu'au prochain
        // backtick » sortait au milieu du gabarit sur un backtick LITTÉRAL interne à une chaîne
        // de l'interpolation (ex. `µt(\`/x.${ "a\`b" }\`, { n: 1 })`) — parenthèse fermante
        // surnuméraire ensuite, code généré invalide. Jamais refermé (-1, cas déjà intercepté en
        // amont par la garde CHAÎNE NON FERMÉE) : consomme jusqu'à la fin, comme les autres usages.
        const end = skipTemplateLiteral(code, j)
        j = end === -1 ? code.length : end
        continue
      }
      if (ch === '(') depth++
      else if (ch === ')') { depth--; if (depth === 0) break }
      j++
    }
    const argsRaw = code.slice(idx + marker.length, j)
    const args = splitTopLevelArgs(argsRaw)
    const lit = parseStringLiteralArg(args[0] ?? '')
    if (!lit) {
      // clé CALCULÉE (gabarit) : jamais préfixée, mais un `/` de tête est
      // retiré comme pour un littéral. Clé VARIABLE (ni littéral ni gabarit) : 1er argument
      // laissé tel quel. Dans les deux cas, les arguments suivants sont rescannés (µ.t niché).
      const tpl = parseTemplateLiteralArg(args[0] ?? '')
      const first = (tpl && tpl.content.startsWith('/')) ? '`' + tpl.content.slice(1) + '`' : (args[0] ?? '').trim()
      const rest  = args.slice(1).map(a => applyI18nPrefixing(a.trim(), section, mode, more))
      out += marker + [first, ...rest].join(', ') + ')'
    }
    else {
      const isAbsolute = lit.content.startsWith('/')
      const key = isAbsolute ? lit.content.slice(1) : (section ? `${section}.${lit.content}` : lit.content)
      const rest = args.slice(1).map(a => applyI18nPrefixing(a.trim(), section, mode, more))
      let newArgs = [`${lit.quote}${key}${lit.quote}`]
      if (mode) {
        newArgs.push(rest[0] ?? 'undefined')
        newArgs.push(`'${mode}'`)
      }
      else {
        newArgs = newArgs.concat(rest)
      }
      // sections en plus du module : la clé relative se cherche aussi chez elles, dans l'ordre écrit (4e argument de µ.t)
      if (section && !isAbsolute && more.length > 0) {
        newArgs = newArgs.slice(0, 3)
        while (newArgs.length < 3) newArgs.push('undefined')
        newArgs.push(`[${more.map(s => `${lit.quote}${s}.${lit.content}${lit.quote}`).join(', ')}]`)
      }
      out += marker + newArgs.join(', ') + ')'
    }
    i = j + 1
  }
  return out
}

// ----------------------------------------------------------------------------
// buildClassName — Mjs + module.split('-').capitalize.join
// ----------------------------------------------------------------------------
function buildClassName(moduleName: string): string {
  const cleaned = moduleName.replace(/[^a-zA-Z0-9]/g, '-')
  const parts = cleaned.split('-').filter(s => s.length > 0)
  return 'Mjs' + parts.map(p => p[0].toUpperCase() + p.slice(1)).join('')
}

// ----------------------------------------------------------------------------
// cssTrapWarnings — pièges Shadow DOM dans le CSS COMPILÉ d'un composant.
// Le CSS compilé part en `adoptedStyleSheets` du SHADOW ROOT au runtime (cf.
// runtime/mjs_element.ts) : une feuille CONSTRUITE (`new CSSStyleSheet()` +
// `replaceSync`). Un `@font-face` là-dedans n'enregistre JAMAIS la police
// (limite navigateur, aucune erreur ni au build ni au runtime) ; un `@import`
// y est carrément IGNORÉ (interdit dans les feuilles construites). Piège
// 100% silencieux sans ce scan. Warnings NON-FATALS (le build continue) —
// l'idiome correct : <@head><style>@font-face { … src: url(µasset('…')) }
// </style></@head> (injecté dans document.head, hors Shadow DOM).
// ----------------------------------------------------------------------------
export function cssTrapWarnings(css: string, lint?: LintToggles): string[] {
  const warnings: string[] = []
  if (/@font-face\b/.test(css)) {
    const w = typedLine('cssTrap', t('transpiler.css-trap-fontface'), lint)
    if (w !== null) warnings.push(w)
  }
  // Les @import SASS sont résolus À LA COMPILATION (jamais présents dans le
  // CSS compilé) — un @import qui survit ici est forcément du CSS pur
  // explicite, aucun faux positif possible.
  if (/@import\b/.test(css)) {
    const w = typedLine('cssTrap', t('transpiler.css-trap-import'), lint)
    if (w !== null) warnings.push(w)
  }
  return warnings
}

// ----------------------------------------------------------------------------
// serializeComputedDeps — closure transitive des computeds pour `_mjs_computedDeps`.
// Entrées non vides seulement — un computed
// sans dépendance n'apporte rien à µ.effect côté runtime.
// ----------------------------------------------------------------------------
function serializeComputedDeps(analyzer: Analyzer | null | undefined): string {
  if (!analyzer) return '{}'
  const parts: string[] = []
  for (const [k, deps] of Object.entries(analyzer.computedDeps)) {
    if (deps.length > 0) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(deps)}`)
  }
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}'
}

// les valeurs des attributs des balises, hors accolades : `<p title="$layout">`, `class='a $x'`, `title=$layout`
// lisent une variable sans accolades ; le texte entre les balises, lui, n'en lit aucune. La fin d'une balise
// se lit comme ailleurs : guillemets reconnus, accolades comptées
function attributeValues(html: string): string {
  const values: string[] = []
  const re = /<[A-Za-z@][^\s>\/]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let i = m.index + m[0].length
    let depth = 0
    let quote = ''
    let from = -1
    for (; i < html.length; i++) {
      const c = html[i]
      if (quote) {
        if (c === quote) { values.push(html.slice(from, i)); quote = '' }
      }
      else if (depth > 0) {
        if (c === '{') depth++
        else if (c === '}') depth--
      }
      else if (c === '{') depth++
      else if (c === '>') break
      else if (c === '=') {
        let j = i + 1
        while (j < html.length && /\s/.test(html[j])) j++
        if (html[j] === '"' || html[j] === "'") { quote = html[j]; from = j + 1; i = j }
        else if (html[j] !== '{') {
          const raw = /^[^\s>"'{]+/.exec(html.slice(j))
          if (raw) { values.push(raw[0]); i = j + raw[0].length - 1 }
        }
      }
    }
    re.lastIndex = i
  }
  return values.join('\n')
}

// le code du HTML d'un composant : le contenu de ses accolades (interpolations, blocs, valeurs
// d'attributs, gestionnaires), sans le texte autour — `<p>La rune µlayout…</p>` ne lit rien. Une
// accolade jamais refermée n'est pas lue (le parseur la signale plus loin, à sa ligne) : la lecture
// reprend juste après elle
function templateCode(html: string): string {
  const accolades = lireAccolades(html)
  const parts: string[] = []
  let at = html.indexOf('{')
  while (at !== -1) {
    const lue  = accolades.get(at)
    let next = at + 1
    if (lue) {
      parts.push(lue.corps)
      next = lue.fin
    }
    // sinon accolade seule : rien à lire, cf. plus haut
    at = html.indexOf('{', next)
  }
  return parts.join('\n')
}

// chaque accolade du HTML lue par extractBalanced : son contenu et la position qui suit sa fermante, `null` si elle ne se referme
// jamais. Une accolade jamais refermée lit jusqu'à la fin du texte, et la lecture reprend juste après elle : lues dans l'ordre, n
// accolades ouvertes coûtaient n lectures jusqu'à la fin (quadratique, des secondes pour quelques milliers de lignes). Lues de la
// dernière à la première, une lecture qui compte une accolade déjà connue pour ne jamais se refermer s'arrête là : elle ne se
// refermera pas non plus — même lecture du texte qui suit, à une condition : aucune `)` sans sa `(` après l'accolade, la seule
// différence possible venant du regard en arrière d'ouvreUneRegex sur une parenthèse (sigils.ts, apresCondition). Tant qu'aucune
// accolade ne reste ouverte (tout gabarit qui se construit), la lecture dans l'ordre suffit et coûte moins
function lireAccolades(html: string): Map<number, { corps: string, fin: number } | null> {
  const dansLOrdre = new Map<number, { corps: string, fin: number } | null>()
  const lecteur    = new Scanner(html)
  for (let at = html.indexOf('{'); at !== -1; at = html.indexOf('{', lecteur.pos)) {
    lecteur.pos = at + 1
    try {
      dansLOrdre.set(at, { corps: extractBalanced(lecteur, '}'), fin: lecteur.pos })
    }
    catch {
      return lireAccoladesALEnvers(html)
    }
  }
  return dansLOrdre
}

function lireAccoladesALEnvers(html: string): Map<number, { corps: string, fin: number } | null> {
  const lues    = new Map<number, { corps: string, fin: number } | null>()
  const echecs  = new Set<number>()
  const scanner = new Scanner(html)
  // plus petit solde `(` moins `)` atteint à partir de chaque position, et solde juste avant elle
  const solde = new Int32Array(html.length + 1)
  for (let i = 0; i < html.length; i++) solde[i + 1] = solde[i] + (html[i] === '(' ? 1 : html[i] === ')' ? -1 : 0)
  const minimum = new Int32Array(html.length + 1)
  minimum[html.length] = solde[html.length]
  for (let i = html.length - 1; i >= 0; i--) minimum[i] = Math.min(solde[i], minimum[i + 1])
  for (let at = html.lastIndexOf('{'); at !== -1; at = at === 0 ? -1 : html.lastIndexOf('{', at - 1)) {
    scanner.pos = at + 1
    try {
      const corps = extractBalanced(scanner, '}', false, echecs)
      lues.set(at, { corps, fin: scanner.pos })
    }
    catch {
      lues.set(at, null)
      if (minimum[at + 1] >= solde[at + 1]) echecs.add(at)
    }
  }
  return lues
}

// le même HTML, les chaînes et commentaires du code des accolades blanchis (même longueur, lignes gardées) : un nom
// écrit dans un texte (`@log('alert')`) n'est pas une citation de ce nom. Une accolade jamais refermée est laissée telle quelle
function blankBraceStrings(html: string, lang: string): string {
  const accolades = lireAccolades(html)
  let out         = ''
  let from        = 0
  let at          = html.indexOf('{')
  while (at !== -1) {
    const lue  = accolades.get(at)
    let next = at + 1
    if (lue) {
      out += html.slice(from, at + 1) + maskNonCode(html.slice(at + 1, lue.fin - 1), lang)
      from = lue.fin - 1
      next = lue.fin
    }
    // sinon accolade seule : rien à blanchir
    at = html.indexOf('{', next)
  }
  return out + html.slice(from)
}

// les noms de modèles que le script compare à µlayout, lus sur l'AST du JS compilé (µlayout y est
// devenu `$.layout || 'default'`, quel que soit le langage) : `=== 'x'` (et `==`, `!==`, `!=`),
// `switch µlayout` et ses `case`, `['x', 'y'].includes(µlayout)` (ou `.indexOf`) — un commentaire
// ou une chaîne qui les cite ne compte pas
function layoutNamesInScript(ast: acorn.Node | null): string[] {
  const names: string[] = []
  if (!ast) return names
  const isLayout = (n: any): boolean => n?.type === 'LogicalExpression' && n.operator === '||' && n.left?.type === 'MemberExpression' && !n.left.computed && n.left.object?.type === 'Identifier' && n.left.object.name === '$' && n.left.property?.name === 'layout' && n.right?.type === 'Literal' && n.right.value === 'default'
  const text     = (n: any): string | null => n?.type === 'Literal' && typeof n.value === 'string' ? n.value : null
  const add      = (n: any): void => { const s = text(n); if (s !== null) names.push(s) }
  walk.simple(ast, {
    BinaryExpression(n: any) {
      if (!['===', '==', '!==', '!='].includes(n.operator)) return
      if (isLayout(n.left)) add(n.right)
      else if (isLayout(n.right)) add(n.left)
    },
    SwitchStatement(n: any) {
      if (isLayout(n.discriminant)) for (const c of n.cases) add(c.test)
    },
    CallExpression(n: any) {
      const callee = n.callee
      if (callee?.type === 'MemberExpression' && !callee.computed && ['includes', 'indexOf'].includes(callee.property?.name) && callee.object?.type === 'ArrayExpression' && isLayout(n.arguments[0])) for (const e of callee.object.elements) add(e)
    },
  })
  return names
}

// wrapModuleError — préfixe `err.message` du nom du module (build
// multi-fichiers : savoir LEQUEL des composants a échoué), SAUF s'il y figure déjà (~25 erreurs de
// preprocessHtml le portent déjà via `moduleName` en interpolation, cf. desequilibre-structurel ;
// ne jamais préfixer deux fois) ou si `moduleName` est inconnu (`transpile()`/`transpileFile()`
// appelés sans l'option — message inchangé, aucune régression pour un appelant qui l'ignore).
// `cause` conserve l'erreur/la stack d'origine (même idiome que mjs-ws/transport-ws.ts).
// L'ancien `!message.includes(moduleName)` sautait le
// préfixe dès qu'une LETTRE de moduleName se retrouvait par hasard dans le message (ex.
// moduleName='a', présent dans n'importe quel mot français) : faux négatif, jamais préfixé.
// Restreint à une mention DÉJÀ QUOTÉE (`'` immédiatement suivi de moduleName) — motif qui couvre
// À LA FOIS le préfixe que CETTE fonction pose elle-même (`'${moduleName}' : …`, relu si
// transpile() puis transpileFile() l'appellent tous les deux) ET les messages qui citent déjà le
// fichier entre quotes sans repasser par ici (ex. transpiler.page-marqueur-manquant :
// `'${moduleName}.mjs' utilise…`) — sans exiger de guillemet fermant immédiat, absent de cette
// 2e forme.
function wrapModuleError(err: unknown, moduleName: string | undefined): never {
  const original = err instanceof Error ? err : new Error(String(err))
  if (moduleName && !original.message.includes(`'${moduleName}`)) {
    throw new Error(t('transpiler.erreur-dans-module', { moduleName, message: original.message }), { cause: original })
  }
  throw original
}

// ----------------------------------------------------------------------------
// transpileImpl — transpilation complète depuis content brut .mjs (corps réel, jamais appelé
// directement hors de ce fichier — cf. `transpile()` plus bas, l'enveloppe publique qui préfixe
// les erreurs du nom de module).
// ----------------------------------------------------------------------------
async function transpileImpl(
  source: string,
  opts: TranspileOpts = {}
): Promise<{ data: TranspileData; output: string; sourceMap?: string }> {
  const moduleName = opts.moduleName ?? 'inline'
  // calculé UNE fois, en tête — transmis tel quel aux adapters de langage et aux modules
  // profonds (analyzer/parser/generator) qui tournent dans CE même appel, jamais recalculé.
  const colorsEnabled = opts.colorsEnabled ?? false
  // dirInject : préfixe URL public des assets. Le bundler passe explicitement
  // `${urlPrefix}/`. Pour usage standalone (sans bundler), default à `/modularjs/`.
  const dirInject = opts.dirInject ?? '/modularjs/'
  // templateLang : grammaire des handlers inline (`@click={…}`). Défaut 'civet' appliqué ICI, point
  // UNIQUE (mjs.config.json ne pose aucun défaut lui-même) : le batch
  // `_mjs_inline` (cf. "11. JS init" plus bas) compile désormais en Civet par
  // défaut, 'js' repliant sur le Coffee historique inchangé. Les interpolations
  // `{…}` du template restent, elles, non consommées ici.
  const templateLang = opts.templateLang ?? 'civet'

  // fins de ligne normalisées à
  //    l'entrée, AVANT tout le reste : le sucre mono-ligne (`k = (a, b) ->`) ne s'appliquait
  //    plus du tout sur un fichier CRLF, et toute la suite du pipeline est bâtie sur
  //    des regex `^`/`$`/`\n` (moduleVars, extractSections, lints…) qui tiennent pour acquis
  //    UNE fin de ligne LF. CR seul (vieux Mac) traité pareil. La sortie est en LF pour tous.
  //    La marque BOM d'un fichier UTF-8 retirée au même endroit : laissée en tête, elle cachait la directive de la
  //    première ligne (`@i18n 'sec'` ignoré en silence)
  source = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

  // -1. Alias ASCII sigil/contexte — DOIT tourner AVANT le lint singleton et
  //    extractDirectives : sinon `@import mjs$$X` (sigil ASCII) ou
  //    `@import __shared.X` (alias contexte) ne sont jamais reconnus, leur
  //    forme canonique (`µ$$X`/`§§X`) n'existant pas encore à ce stade. Un
  //    `@import __shared.X` devient ainsi `@import §§X`, qui claque en erreur
  //    de migration juste en dessous — VOULU : l'alias ASCII du singleton
  //    importé est `mjs$$`, `__shared` reste réservé au contexte. Idempotent :
  //    les mêmes passes retournent plus bas (script.raw/moduleSection.raw/html)
  //    pour couvrir aussi le texte injecté ENSUITE par <@include>/macros (pas
  //    encore inliné ici).
  source = sigilAliasOutsideVars(source, opts.sigil, opts.defaultScriptLang ?? 'civet')
  source = normalizeContextAlias(source, opts.contextAlias)

  // 0. Lint singleton : `@import µ$$X` est la SEULE forme d'import — toute
  //    ancienne écriture `@import §§X` → erreur de migration ; toute
  //    consommation `$X`/`$$X`/`§§X` (au lieu de `µ$$X`) dans le source du dev
  //    → erreur claire. Retourne les noms importés (`singletonImports`),
  //    réutilisés juste en dessous par la pré-passe 0-bis (µ$$X → $X).
  const singletonImports = lintSingletonConsume(source)

  // 0-avant-bis. Lint @import $X (dollar simple, sans µ$) — un nom importé ne porte jamais `$`
  //    seul, un singleton s'importe et se consomme UNIQUEMENT par `µ$$X` (docs/14-stores.md).
  //    ICI, AVANT la pré-passe 0-bis juste en dessous (µ$$X → $X) : sur le source ENCORE
  //    ORIGINAL, un `µ$$counter` reste distinguable d'un `$counter` tapé à la main.
  lintImportDollarName(source)

  // 0-bis. Sigil store `µ$$X` : alias lexical de `µ$X` (déclaration) / `$X` (lecture).
  //    Appliqué AVANT toute autre passe pour que les bindings template
  //    `{µ$$count.value}` et le script soient tous reconnus.
  //    - `export µ$$X = expr` → `export µ$X = expr` (route vers le sucre store
  //      universel existant qui crée le proxy via `µ.state(expr)`).
  //    - Toute autre occurrence `µ$$X` (lignes `@import` comprises, gère
  //      `default µ$$x`/listes `a, µ$$b` — même passe, un nom importé y est
  //      TOUJOURS dans `singletonImports` par construction) : SI `X` a été
  //      importé (`singletonImports`, cf. ci-dessus) → `$X` (câblage
  //      identique à l'ancien `§§` importé, retombe sur le pipeline @import
  //      existant, regex directives.ts, ajout à externalReactives) ; SINON →
  //      erreur `singleton-sans-import` (ferme le trou « µ$$Inconnu glisse en
  //      $Inconnu en silence » : avant, la réécriture était inconditionnelle).
  //
  //    NB : dans `String.replace`, `$$` est échappé en `$` littéral, `$N` est
  //    la capture group. Pour produire `$<capture>` on écrit `$$$N`.
  //    Les blocs de doc (`<pre>`/`<code>`/commentaires) sont masqués : un tuto
  //    qui AFFICHE `µ$$X` ne doit pas être réécrit comme du code exécuté.
  //    `maskDocBlocks`
  //    seul ne couvrait NI les chaînes/commentaires JS du <script> (une chaîne/
  //    un commentaire qui MENTIONNE `µ$$X` en exemple était réécrit en silence
  //    ou faisait throw `singleton-sans-import` à tort, faute d'usage réel) NI
  //    le texte HTML statique hors `{…}` (même throw intempestif — PARITÉ avec
  //    l'ancien mécanisme §§ : le générateur n'exécute jamais de sigil sur le
  //    texte d'un nœud, `case 'text'` de generator/compile.ts, vérifié sur
  //    pièce). Composition de 3 masques réversibles, du plus large au plus
  //    fin : blocs de doc → texte HTML statique (hors <script>/@import/{…}) →
  //    chaînes/commentaires JS (partout, y compris dans un `{…}` live) ; la
  //    réécriture n'opère plus que sur ce qui reste EXPOSÉ ; restauration dans
  //    l'ordre inverse, texte masqué RENDU À L'IDENTIQUE (µ$$X littéral compris).
  {
    const { masked: sansDoc, restore: restoreDoc } = maskDocBlocks(source)
    const { masked: sansHtmlStatique, restore: restoreHtmlStatique } = maskStaticHtmlText(sansDoc)
    const { masked: sansChainesEtCommentaires, restore: restoreChainesEtCommentaires } = maskStringsAndComments(sansHtmlStatique)
    const reecrit = sansChainesEtCommentaires
      .replace(/^([ \t]*)export[ \t]+µ\$\$([a-zA-Z0-9_]+)([ \t]*=)/gm, '$1export µ$$$2$3')
      .replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, nom: string) => {
        if (singletonImports.has(nom)) return '$' + nom
        throw new Error(t('transpiler.singleton-sans-import', { nom }))
      })
    source = restoreDoc(restoreHtmlStatique(restoreChainesEtCommentaires(reecrit)))
  }

  // 1. Directives + nettoyage
  const dir = extractDirectives(source)
  const content = dir.cleaned

  // 2. Sections
  const sections = extractSections(content, {
    defaultScriptLang: opts.defaultScriptLang ?? 'civet',
  })
  const { module: moduleSection, script, style, layouts, routes: routesSections } = sections
  let html = sections.html
  // le script tel qu'écrit, avant ce qui s'y ajoute (partiels, persistance) : ses lignes sont celles du fichier
  const writtenScript = script.raw

  // 2-quater. Types et valeurs permises — un <types> n'a pas sa place dans un composant (fichier
  //    *.types.mjs) ; le <vars> est lu tout de suite, ses fautes sortent avant tout le reste, et
  //    ses règles sont émises plus bas, avec la classe (data.typesDecl/typesLine)
  if (sections.types.length > 0) throw new Error(t('transpiler.types-dans-composant', { ligne: sections.types[0].startLine }))
  if (sections.effects.length > 0) throw new Error(t('transpiler.effets-dans-composant', { ligne: sections.effects[0].startLine }))
  // un composant sans HTML (script ou style seuls, un commentaire) ne rend rien
  if (html.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '').trim() === '') {
    const vide = typedLine('emptyComponent', t('transpiler.composant-sans-html', { moduleName }), opts.lint)
    if (vide !== null) sections.warnings.push(vide)
  }
  // `@formAssociated` écrit plus d'une fois : la directive n'a qu'un sens, la compilation passe et un avertissement le dit
  if (dir.moduleFormAssociatedTwice) sections.warnings.push(t('transpiler.form-associated-plusieurs-fois', { moduleName }))
  const varRules = compileVars(sections.vars, opts.typeDefs ?? {}, opts.typesText !== false)
  checkRessorts(varRules, [
    { text: moduleSection.raw, startLine: moduleSection.startLine, code: true },
    { text: script.raw, startLine: script.startLine, code: true },
    { text: html, startLine: sections.htmlStartLine, code: false },
  ])

  // 2-bis. Lint µeffect/µinspect hors top-level — sur le SOURCE du dev tout
  //    juste extrait (post-dedent, AVANT les appends persist/macros/includes
  //    qui génèrent leurs propres µeffect, légitimes). Copie normalisée
  //    `mjs.effect`→`µ.effect` pour le SCAN seulement (l'alias sigil n'est
  //    appliqué au vrai source qu'à l'étape 4-bis).
  lintEffectTopLevel(normalizeSigilAlias(script.raw, opts.sigil), false, script.startLine)
  lintEffectTopLevel(normalizeSigilAlias(moduleSection.raw, opts.sigil), true, moduleSection.startLine)

  // 2-bis-bis. Lint µemit dans <script module> : aucune
  //    instance de composant dans le module, `_mjsThis` n'y existe pas. Même
  //    copie normalisée que ci-dessus, <script> composant hors périmètre
  //    (µemit y reste légitime à toute profondeur, cf. lintEmitInModule).
  lintEmitInModule(normalizeSigilAlias(moduleSection.raw, opts.sigil), moduleSection.startLine)

  // 2-bis-ter. Rune séparée de son symbole (`µ` puis `.setContext(…)` à la ligne suivante) : refusée sur le
  //    source brut du dev, alias `mjs` reconnu par la règle elle-même, numéro recalé sur la ligne du `.mjs`.
  //    Le script des partiels est vu par processIncludes (étape 4a), les modules importés par le bundler.
  lintSplitRune(script.raw, '<script>', { sigil: opts.sigil, firstLine: script.startLine, lang: script.lang })
  lintSplitRune(moduleSection.raw, '<script module>', { sigil: opts.sigil, firstLine: moduleSection.startLine, lang: moduleSection.lang })

  // 2-ter. Garde-fou V1 `@onUrlChange = ` — AVERTISSEMENT (jamais bloquant),
  //    scanné sur le <script> composant seul (le hook de route n'a de sens que
  //    sur une INSTANCE ; <script module> n'a pas de `this` de composant).
  lintOnUrlChangeLegacy(script.raw, moduleName, opts.lint, colorsEnabled, script.startLine)

  // 3. Auto-imports : injectés en haut du module
  if (dir.pendingAutoImports.length > 0) {
    moduleSection.raw = dir.pendingAutoImports.join('\n') + '\n' + moduleSection.raw
  }

  // 4. Persistance : append au script user
  const persistCode = buildPersistCode(moduleName, dir.persistLocalVars, dir.persistSessionVars)
  if (persistCode) script.raw = script.raw + persistCode

  // 4a. <@include partial> + <@window/document/body/head> — EN PREMIER,
  //     avant alias/µasset : le contenu d'un partial inclus doit lui aussi
  //     passer par l'alias sigil et la résolution µasset, sinon un
  //     `µasset(...)` DANS le partial reste littéral (régression vécue : logo
  //     de _header.mjs jamais résolu → 404, figé en `&#39;` après le passage
  //     par le générateur HTML).
  const includeAcc = newIncludeAccumulator()
  // les blocs `{? nom}` du composant, développés AVANT d'y verser les partiels : une faute y est citée à
  // sa ligne du fichier, pas décalée de la hauteur des partiels (ceux des partiels, plus bas)
  html = expandLayoutBlocks(html, sections.htmlStartLine)
  // le HTML du composant lui-même, avant les partiels : ses lignes sont celles du fichier
  const hostHtml = html
  html = processIncludes(html, opts.baseDir, includeAcc, opts.sourceDir, { sigil: opts.sigil, scriptLang: script.lang, moduleLang: moduleSection.lang }, opts.lint)
  // Append partial scripts/styles/modules au parent
  if (includeAcc.script.length > 0) script.raw += '\n' + includeAcc.script.join('\n')
  if (includeAcc.module.length > 0) moduleSection.raw += '\n' + includeAcc.module.join('\n')
  // neutralise tout octet NUL PRÉ-EXISTANT du style hôte AVANT d'apposer les marqueurs
  // \x00MJSSTYLE des partiels (macros.ts fait pareil côté partiel) : un NUL n'est jamais un
  // caractère UTILE en CSS/SASS (la tokenisation CSS remplace U+0000 par U+FFFD) — par
  // construction, les seuls NUL du texte fusionné sont donc NOS marqueurs (cf. transpiler/css.ts)
  if (style.raw.includes('\x00')) style.raw = style.raw.replace(/\x00/g, '')
  if (includeAcc.css.length > 0) style.raw += '\n' + includeAcc.css.join('\n')

  // 4b. Sigil ASCII (fallback clavier non-AZERTY) : `mjs.X` → `µ.X` etc.,
  //     APRÈS les includes (leur contenu en bénéficie aussi), AVANT
  //     résolution µasset/sucre µ/lexer. `µ` reste canonique. Dans le code seul : chaînes, commentaires,
  //     texte et attributs du HTML gardent `mjs.` tel qu'écrit (sigilAliasCode, sigilAliasHtml).
  if (opts.sigil && opts.sigil !== 'µ') {
    script.raw        = sigilAliasCode(script.raw, opts.sigil, script.lang)
    moduleSection.raw = sigilAliasCode(moduleSection.raw, opts.sigil, moduleSection.lang)
    html              = sigilAliasHtml(html, opts.sigil)
    // PAS `style.raw` : en SASS le `.` préfixe une CLASSE ; aliaser
    // `mjs`→`µ` y transformerait un sélecteur `.mjs.active` en `.µ.active`
    // (mort). Le style DYNAMIQUE passe par `--var={}`/@style dans le template,
    // jamais par une API `mjs.*` dans la feuille — rien à aliaser côté <style>.
  }
  // 4c. Alias ASCII contexte/partagé (`__context.X`/`__shared.X`), opt-in.
  if (opts.contextAlias) {
    script.raw        = normalizeContextAlias(script.raw, true)
    moduleSection.raw = normalizeContextAlias(moduleSection.raw, true)
    html              = normalizeContextAlias(html, true)
  }

  // 4d. Résolution µasset() APRÈS les includes (leurs `µasset(...)` en
  //     dépendent désormais aussi) et AVANT compilation langage. Coffee/
  //     Civet/TS verront juste un string literal, pas un appel inconnu.
  if (opts.resolveAsset) {
    script.raw         = await replaceMagicAssets(script.raw, opts.resolveAsset, script.lang)
    moduleSection.raw  = await replaceMagicAssets(moduleSection.raw, opts.resolveAsset, moduleSection.lang)
    // un chemin local écrit en clair dans un réglage d'image d'un effet (`*behind('photo.jpg')`) devient l'appel
    // `µimage('photo.jpg')` que le bundler a résolu (preResolveAssets), remplacé ci-dessous comme les autres ; `µasset('photo.jpg')`
    // pour un réglage dont l'effet ne lit que l'adresse : avant le remplacement des µasset, qui le résout
    if (opts.preResolvedImages) html = resolveEffectImages(html)
    html               = await replaceMagicAssets(html, opts.resolveAsset)
    // les feuilles du composant (`<style>` et ses déclinaisons nommées) : leur texte est du CSS, du SCSS ou du SASS que la compilation des
    // styles, plus bas, change en chaîne de CSS — l'appel `µasset('x.woff2')` n'y serait plus retrouvé par personne. Remplacé ici, dans la
    // source, par l'adresse que le bundler a résolue (celle des dossiers de assetDirs comprise) ; un fichier introuvable reste le repère
    // d'asset manquant, que le bundler refuse
    style.raw          = await replaceStyleAssets(style.raw, opts.resolveAsset)
    for (const ly of layouts) ly.raw = await replaceStyleAssets(ly.raw, opts.resolveAsset)
    script.raw         = replaceMagicImages(script.raw, opts.preResolvedImages)
    moduleSection.raw  = replaceMagicImages(moduleSection.raw, opts.preResolvedImages)
    html               = replaceMagicImages(html, opts.preResolvedImages)
  }

  // `{? timer}` → `{if (µlayout is 'timer')}` des partiels inclus : avant tout ce qui lit le HTML
  // (µlayout, modèles connus) ; ceux du composant sont déjà développés (cf. processIncludes)
  html = expandLayoutBlocks(html, sections.htmlStartLine)
  const macros = processGlobalMacros(html, { firstLine: sections.htmlStartLine, sigil: opts.sigil, sourceHtml: hostHtml })
  html = macros.html
  if (macros.setup) script.raw += macros.setup
  if (macros.teardown) script.raw += macros.teardown

  // 5. Préprocesse HTML
  const hasDynamicSlots = html.includes('<@slot')
  html = preprocessHtml(html, moduleName)

  // 6. External vars (combinées : opts + @import)
  const externalVars = Array.from(new Set([
    ...(opts.externalVars ?? []),
    ...Array.from(dir.externalReactives),
  ]))

  // 7. Pipeline pré-compilation : sucre µ + tokenize ($xxx → $.xxx).
  //    L'ordre est critique : le lexer doit tourner AVANT la compilation langage,
  //    sinon Coffee transforme `$count = 0` en `var $count = 0;` qui devient
  //    `var $.count = 0;` après tokenize — JS invalide. Le lexer opère sur
  //    du texte, peu importe le langage source.
  const scriptAdapter = getAdapter(script.lang)
  const moduleAdapter = getAdapter(moduleSection.lang)

  // <script module> compilé ICI, AVANT le
  //    <script> composant : `modulePrep`/`moduleCompiled` ne dépendent QUE de
  //    `moduleSection.raw`, jamais de `scriptPrep`. Nécessaire pour lire `moduleVars`
  //    sur l'AST du JS RÉELLEMENT ÉMIS plutôt que sur un scan textuel ligne à ligne :
  //    l'ancien scan voyait un `nom = …` en colonne 0 DANS un bloc `###…###`/`/* */`/
  //    chaîne multi-lignes comme une vraie var module, empêchant l'auto-déclaration de
  //    l'homonyme dans le <script> (ReferenceError au montage, prouvé par le test rouge).
  const modulePrep = moduleSection.raw
    ? tokenize(applyMjsSugarToScript(moduleSection.raw, moduleSection.lang, undefined, '<script module>', moduleSection.startLine - dir.pendingAutoImports.length), { externalVars, moduleMode: true, fileName: `${moduleName}.module`, firstLine: moduleSection.startLine - dir.pendingAutoImports.length })
    : ''
  // même remap qu'au <script> composant (cf.
  // scriptCompiled plus bas) : une erreur Civet DANS <script module> citait une position relative
  // au texte COMPILÉ (`modulePrep`), jamais à la ligne réelle du `.mjs` — remapAdapterErrorLine
  // n'enveloppait alors QUE `scriptAdapter.compileToJs`. Décalage `moduleSection.startLine`, le
  // même que `shiftSourceMapLines(moduleCompiled.map, moduleSection.startLine - 1)` plus bas
  // (succès) applique déjà à la carte de source de ce bloc.
  let moduleCompiled: { code: string, map?: string }
  if (modulePrep) {
    try {
      moduleCompiled = await moduleAdapter.compileToJs(modulePrep, { fileName: `${moduleName}.module`, lint: opts.lint, colorsEnabled })
    }
    catch (e) {
      throw remapAdapterErrorLine(e, `${moduleName}.module`, moduleSection.startLine - dir.pendingAutoImports.length)
    }
  }
  else {
    moduleCompiled = { code: '' }
  }
  let moduleJs = moduleCompiled.code
  // une seule analyse du JS compilé, partagée par les contrôles qui suivent (constantes, symboles réservés, déclarations…)
  const moduleAst = parseModuleAst(moduleJs, true)
  // défaut de Civet sur une flèche en ligne (FLECHE_EN_LIGNE_CIVET_RE, `f = => x = if a then 'b' else 'c'`) : le JavaScript
  // du bloc ne s'analyse pas, la page mourait au chargement — même refus que pour le <script> (cf. plus bas)
  if (moduleJs && !moduleAst) {
    let position: RegExpExecArray | null = null
    try { acorn.parse(moduleJs, { ecmaVersion: 'latest', sourceType: 'module' }) }
    catch (e: any) { position = /\((\d+):\d+\)$/.exec(String(e?.message ?? '')) }
    const produite = position ? moduleJs.split('\n')[Number(position[1]) - 1] ?? '' : ''
    if (FLECHE_EN_LIGNE_CIVET_RE.test(produite)) throw new Error(t('transpiler.script-fleche-en-ligne', { moduleName, ligne: Number(position![1]), extrait: produite.trim().slice(0, 160), section: '<script module>' }))
  }
  // même contrôle des constantes `:=` que pour le `<script>` (cf. plus bas), sur le JS du bloc
  // `<script module>` juste compilé : une constante réaffectée dans le bloc lui-même
  const moduleConstReassign = findConstReassignment(moduleJs, [], moduleAst)
  if (moduleConstReassign) {
    throw new Error(t('transpiler.civet-reaffectation-constante', { nom: moduleConstReassign.name, ligne: moduleConstReassign.line, code: true }))
  }
  // Vars top-level du `<script module>` partagé : le `<script>` composant peut les
  // lire/réassigner sans qu'elles soient re-déclarées localement (sinon TDZ). Repli
  // textuel (ancien comportement) SEULEMENT si l'AST ne parse pas (sortie langage
  // exotique) — l'AST reste la source d'autorité, cf. collectTopLevelDeclarations.
  const moduleVars = moduleAst
    ? [...collectTopLevelDeclarations(moduleAst, 'binding'), ...collectTopLevelDeclarations(moduleAst, 'const')]
    : (() => {
        const out: string[] = []
        if (moduleSection.raw) {
          for (const rawLine of moduleSection.raw.split('\n')) {
            // Indentation zéro UNIQUEMENT : une assignation locale DANS une fonction
            // du module (indentée) n'est pas une var module — la collecter empêchait
            // l'auto-déclaration d'une homonyme dans le <script> composant
            // (assignation nue → ReferenceError au runtime).
            if (/^\s/.test(rawLine)) continue
            const m = rawLine.match(/^(?:export\s+)?([a-zA-Z_]\w*)\s*(?:[:.]=|\?=|=(?!=))/)
            if (m) out.push(m[1])
          }
        }
        return out
      })()
  const scriptPrep = script.raw
    ? tokenize(applyMjsSugarToScript(script.raw, script.lang, moduleVars, '<script>', script.startLine), { externalVars, fileName: `${moduleName}.script`, firstLine: script.startLine })
    : ''

  // 8. Compile via language adapter → JS standard
  // carte de source du compilateur, décalée de l'offset de ligne du bloc
  //    `<script>`/`<script module>` dans le `.mjs` (sections.ts, `startLine`). Décalage
  //    CONSTANT (dedent conserve le nombre de lignes) : shiftSourceMapLines() suffit, pas
  //    besoin d'un composeur générique. Ne couvre QUE cette passe.
  // En cas d'ÉCHEC (pas seulement de succès), la position `<fichier>:<ligne>:<col>`
  // que l'adaptateur (Civet) rend est relative au texte COMPILÉ (`scriptPrep`, dédenté), dont la
  // ligne 1 tombe sur `script.startLine` du `.mjs` réel — jamais sur sa propre ligne 1. Même
  // décalage QUE `shiftSourceMapLines` juste en dessous (succès), appliqué ICI au MESSAGE
  // (remapAdapterErrorLine, plus haut) avant de relancer.
  let scriptCompiled: { code: string, map?: string }
  if (scriptPrep) {
    try {
      scriptCompiled = await scriptAdapter.compileToJs(scriptPrep, { fileName: `${moduleName}.script`, lint: opts.lint, colorsEnabled })
    }
    catch (e) {
      throw remapAdapterErrorLine(e, `${moduleName}.script`, script.startLine)
    }
  }
  else {
    scriptCompiled = { code: '' }
  }
  const scriptJs = scriptCompiled.code
  // réaffectation d'un identifiant lié par `:=` (const) : contrôle par résolution de portée
  // EXACTE sur le JS que Civet vient de produire, juste avant toute réécriture propre à
  // ModularJS ($x/µ/path-tracking/this-rebinding — jamais vues ici, donc jamais de faux positif
  // sur du code généré par le framework). applyMjsSugarToScript (plus haut, sur la source Civet)
  // a déjà refusé ce qu'il peut voir À LA MÊME PORTÉE avec la ligne SOURCE réelle — gardé tel
  // quel, meilleur numéro de ligne pour ce qu'il couvre. Ce contrôle-ci ferme ce qui lui échappe
  // (bloc indenté, fonction imbriquée sans homonyme local) : la ligne citée est alors celle du
  // JS compilé, jamais de la source Civet — dit explicitement dans le message (`code: true`).
  // Les constantes du `<script module>` sont visibles du `<script>` (qui s'exécute dans leur
  // portée) : les réaffecter depuis le `<script>` plante de même, sauf homonyme local.
  // 7-bis/7-ter. Lints AST. PERF : chaque section est analysée UNE fois (parseModuleAst, avec les positions de ligne)
  // et l'AST partagé par tous les contrôles : constantes, symboles réservés, déclarations, imports, analyseur
  const scriptAst = parseModuleAst(scriptJs, true)
  const constReassign = findConstReassignment(scriptJs, collectTopLevelDeclarations(moduleAst, 'const'), scriptAst)
  if (constReassign) {
    throw new Error(t('transpiler.civet-reaffectation-constante', { nom: constReassign.name, ligne: constReassign.line, code: true }))
  }
  // garde symboles réservés, cf. generator/reserved-symbols.ts
  lintReservedSymbolNames(moduleJs, moduleName, '<script module>', moduleAst)
  const scriptSourceMap  = scriptCompiled.map  ? shiftSourceMapLines(scriptCompiled.map, script.startLine - 1) : undefined
  // les lignes d'import ajoutées devant le bloc (`@import`) n'ont pas de place dans le fichier : leurs segments perdent leur position
  const moduleSourceMap  = moduleCompiled.map  ? shiftSourceMapLines(moduleCompiled.map, moduleSection.startLine - 1 - dir.pendingAutoImports.length, dir.pendingAutoImports.length) : undefined


  // Noms top-level du `<script>` et du `<script module>`, lus sur l'AST du JS COMPILÉ et
  // JAMAIS sur le texte source : ce sont exactement les identifiants qui existeront dans le
  // corps de fonction portant aussi `this._mjs_inline = [...]`, donc ceux qu'un handler voit
  // par closure. Une collecte textuelle (ligne à ligne, indentation zéro) ramassait un
  // `docVar = …` posé DANS un commentaire `###…###` ou une chaîne multi-ligne : le nom
  // n'existait nulle part dans le JS émis, et le handler qui l'écrivait partait en
  // « ReferenceError » au premier clic. Les `const` sont collectés À PART, du `<script>` comme du
  // `<script module>` : les prédéclarer aussi évite l'écriture silencieusement perdue, mais leur
  // réaffectation depuis un handler est refusée au build (contrôle du JavaScript compilé des
  // gestionnaires) plutôt que laissée exploser en « Assignment to constant ».
  const scriptVars   = collectTopLevelDeclarations(scriptAst, 'binding')
  const scriptConsts = collectTopLevelDeclarations(scriptAst, 'const')
  const moduleConsts = collectTopLevelDeclarations(moduleAst, 'const')
  const moduleTopVars = [...collectTopLevelDeclarations(moduleAst, 'binding'), ...collectTopLevelDeclarations(moduleAst, 'const')]

  // cf. lintImportDollarName et lintUndeclaredTopLevelAssignment.
  // On seed AUSSI `moduleVars` : une réassignation top-level d'une var
  // du <script module> dans le <script> composant (`current = audio`, motif
  // « compteur d'instances » hérité de Svelte module-context) est LÉGITIME et ne
  // doit pas être flaggée « nom jamais déclaré » (la var vit dans le module).
  // garde symboles réservés AVANT ce lint : sinon `$ = 3` est d'abord signalé
  // « nom jamais déclaré », message qui conseille `$ := …` — lequel échoue à son tour sur la garde
  lintReservedSymbolNames(scriptJs, moduleName, '<script>', scriptAst)
  lintUndeclaredTopLevelAssignment(scriptJs, script.lang, [...externalVars, ...moduleVars], scriptAst)
  lintUndeclaredTopLevelAssignment(moduleJs, moduleSection.lang, externalVars, moduleAst)
  // `@title = …` en tête du <script> : la balise du composant, pas une donnée (cf. la fonction)
  // la ligne du .mjs d'une position du JS compilé : citée seulement quand la carte de source dit vrai — le sucre
  // n'a pas ajouté de ligne au script (déclaration de `µ$x`, variable hissée en tête) et la position est dans le
  // script écrit, pas dans ce qu'on lui a versé après (partiels, persistance, macros)
  const scriptKeepsLines = scriptPrep.split('\n').length === script.raw.split('\n').length
  const lastWrittenLine  = script.startLine - 1 + writtenScript.split('\n').length
  const scriptLineOf     = (offset: number): number | null => {
    const line = scriptKeepsLines ? sourceLineOf(scriptJs, scriptSourceMap, offset) : null
    return line !== null && line <= lastWrittenLine ? line : null
  }
  lintElementPropertyAtConstruction(scriptAst, moduleName, opts.lint, colorsEnabled, scriptLineOf)
  // code qui suit un `return`, un `throw`, un `break` ou un `continue` dans le même bloc (cf. unreachable.ts) :
  // le <script> et le <script module>, chacun à sa ligne du .mjs — imports ajoutés devant le bloc exclus
  warnUnreachableCode(scriptAst, scriptLineOf, `${moduleName}.mjs`, opts.lint, colorsEnabled)
  const moduleKeepsLines = modulePrep.split('\n').length === moduleSection.raw.split('\n').length
  const lastModuleLine   = moduleSection.startLine - 1 + moduleSection.raw.split('\n').length - dir.pendingAutoImports.length
  warnUnreachableCode(moduleAst, offset => {
    const line = moduleKeepsLines ? sourceLineOf(moduleCompiled.code, moduleSourceMap, offset) : null
    return line !== null && line <= lastModuleLine ? line : null
  }, `${moduleName}.mjs`, opts.lint, colorsEnabled)
  // une fonction d'un module .js copié tel quel qui écrit dans le magasin `$$x` reçu en argument (cf. generator/store-args.ts) :
  // le <script> et le <script module> ici, les gestionnaires et les expressions du HTML plus bas
  const scanStoreArgs = storeArgsToRawJsLint(dir.pendingAutoImports, moduleName, opts.lint, colorsEnabled, opts.sourceDir)
  scanStoreArgs(scriptJs, scriptLineOf)
  scanStoreArgs(moduleJs)
  // un effet en direct de <@document> sans connexion écrite la prend dans `@sock` : le script, ou un
  // gestionnaire du HTML, doit le poser
  const htmlWithoutComments = masqueCommentairesHtml(html)
  const codeHtml = templateCode(htmlWithoutComments)
  const instanceProps = [...new Set([...collectInstanceProps(scriptAst), ...collectHandlerInstanceProps(codeHtml, templateLang)])]
  if (macros.docSock.length > 0 && !instanceProps.includes('sock')) throw new Error(sockAbsent(macros.docSock[0]))

  // Lint import ES classique interdit — cf. lintNoRawImport.
  // moduleJs peut légitimement commencer par dir.pendingAutoImports.length
  // imports RÉELS (résolution @import, cf. "3. Auto-imports" plus haut).
  lintNoRawImport(scriptJs, '<script>', 0, scriptAst)
  lintNoRawImport(moduleJs, '<script module>', dir.pendingAutoImports.length, moduleAst)

  // voie AST (post-Civet) : ferme le trou du gabarit (µimport niché
  // dans une interpolation ${…}/#{…}) pour le <script module> — remplace
  // l'ancienne réécriture par scanner (rewriteMuImport, retirée
  // d'applyMjsSugarToScript ci-dessus). `jsInitBase` (le <script> composant)
  // reçoit la même passe plus bas, une fois ses propres transformations
  // terminées (cf. section 11).
  moduleJs = rewriteMuImportAst(moduleJs, '<script module>')

  // 9. Analyzer (script du composant) — créé même sans script, pour que les
  // composants qui ne déclarent rien dans `<script>` mais lisent `$x` /
  // `$foo` directement depuis le template (props auto-déclarées) soient
  // tout de même analysés et leurs `_mjs_var_bits` correctement remplis.
  let analyzer: Analyzer
  try {
    // variables du `<script module>` que le module change lui-même : jamais une donnée sûre pour une valeur dérivée (sans
    // lecture du module, aucune ne l'est)
    const changeants = moduleAst ? nomsChangeants(moduleAst, moduleVars) : null
    analyzer = new Analyzer(scriptJs ?? '', externalVars, opts.lint, colorsEnabled, scriptAst, changeants ? moduleVars.filter((v) => !changeants.has(v)) : [])
  }
  catch (e: any) {
    // défaut de Civet sur une flèche en ligne (FLECHE_EN_LIGNE_CIVET_RE, `f = => x = if a then 'b' else 'c'`) : le JavaScript produit
    // ne s'analyse pas et acorn parle d'autre chose (« The keyword 'let' is reserved », « Unexpected token »). Signature lue sur la
    // ligne qu'acorn désigne (`(ligne:colonne)` en fin de message) : message de cette forme, avec les deux écritures qui passent
    const position = /\((\d+):\d+\)$/.exec(String(e?.message ?? ''))
    const produite = position ? (scriptJs ?? '').split('\n')[Number(position[1]) - 1] ?? '' : ''
    if (FLECHE_EN_LIGNE_CIVET_RE.test(produite)) {
      throw new Error(t('transpiler.script-fleche-en-ligne', { moduleName, ligne: Number(position![1]), extrait: produite.trim().slice(0, 160) }))
    }
    // Piste ciblée (bug Civet amont) : un objet 100 % spread en position
    // `else` d'un if/then/else inline (`x = if $c then {...$a} else {...$b}`)
    // compile en JS invalide (`else {ref = ...b}`) — l'erreur atterrit ICI,
    // très en aval de la vraie faute, avec un message acorn brut et cryptique
    // (« [analyzer] parse error: … », cf. analyzer/index.ts). Hint ajouté
    // SEULEMENT si le motif est présent dans la source Civet du <script> —
    // jamais de faux positif sur une autre cause de parse error.
    const spreadElseHint = /else\s*\{\s*\.\.\./.test(script.raw)
      ? t('transpiler.hint-spread-else-civet')
      : ''
    // même piste, second motif PROUVÉ hors MJS : une flèche FINE `->`
    // dont le corps-objet contient un spread (`(x) -> { ...x, k: v }`) compile
    // en JS invalide côté Civet (`return ...x,({k: v})`) — la flèche grasse
    // `=>` ou des parenthèses explicites `-> ({ ... })` contournent. Même
    // garde : hint apposé SEULEMENT si le motif est dans la source, jamais de
    // faux positif sur une autre cause de parse error. Les deux hints se
    // cumulent si les deux motifs sont présents.
    const spreadFatArrowHint = /->\s*\{[^{}]*\.\.\./s.test(script.raw)
      ? t('transpiler.hint-spread-fleche-fine-civet')
      : ''
    throw new Error(`${e.message}${spreadElseHint}${spreadFatArrowHint}`)
  }
  analyzer.autoDeclareFromTemplate(html)

  // µlayout — le modèle choisi : la prop `layout`, déclarée ici même si seul le script la lit ; un
  // composant qui a sa propre variable `$layout` ne peut pas s'en servir (les deux se confondraient).
  // Lu dans le code seulement : le script tel que le lexer l'a réécrit (son compilateur, TypeScript
  // par exemple, reformate ensuite la réécriture), et le code entre accolades du HTML ; chaînes et
  // commentaires ne comptent pas pour l'homonymie. Le raccourci d'un attribut (`title="$layout"`, hors
  // accolades) lit la variable aussi ; le texte entre les balises n'en lit aucune
  const muLayout = scriptPrep.includes(MU_LAYOUT_OUT) || /(?<![\w.µ])µlayout(?![\w])/.test(codeHtml)
  const SAME_NAME_RE = /(?<![\w.$])\$layout(?![\w])/
  if (muLayout && SAME_NAME_RE.test(maskNonCode(script.raw, script.lang) + '\n' + maskNonCode(codeHtml, templateLang) + '\n' + attributeValues(htmlWithoutComments))) {
    // la ligne de la variable quand elle est dans le script écrit ; ailleurs (partiel inclus, HTML aux
    // blocs développés), sa position ne se relie plus au fichier
    const ecrite = SAME_NAME_RE.exec(maskNonCode(writtenScript, script.lang))
    throw new Error(t('transpiler.mu-layout-homonyme', { moduleName, ligne: ecrite ? script.startLine + (writtenScript.slice(0, ecrite.index).match(/\n/g)?.length ?? 0) : '' }))
  }
  if (muLayout) analyzer.autoDeclareFromTemplate('{$layout}')

  // collision état/méthode homonymes.
  // `$x` (état) et `@x` (méthode) occupent la MÊME propriété de l'instance.
  // Détection ICI (pas dans analyze()) : autoDeclareFromTemplate tourne APRÈS
  // analyze(), un état déclaré SEULEMENT par le template (jamais écrit dans
  // <script>) n'existait pas encore au moment où analyze() aurait pu le voir
  // — analyzer.stateVars, lui, est DÉFINITIF (post auto-déclaration) ici.
  //
  // cause réelle isolée : PAS cette collision en soi, mais
  // le salvage pré-upgrade de connectedCallback (mjs_element.ts) qui verse la
  // méthode homonyme dans l'état puis la supprime. Le runtime épargne
  // désormais les clés fonction listées ci-dessous : on ne refuse plus la
  // compilation, on transmet juste la liste triée au gabarit.
  const etatMethodeCollisions = analyzer.stateVars.filter(v => analyzer.methodNames.has(v)).sort()
  const stateMethodClashLine = etatMethodeCollisions.length === 0
    ? ''
    : `\n    this._mjs_state_methods = ${JSON.stringify(Object.fromEntries(etatMethodeCollisions.map(n => [n, 1])))};`

  // Lint « trop de variables d'état » — un composant qui
  // déclare des dizaines de `$x` est un écran-monolithe à découper (étalonnage
  // réel : modules sains 5-20 vars, monolithe pathologique vu à 182). Simple
  // AVERTISSEMENT, jamais bloquant : rien d'incorrect à l'exécution, c'est un
  // signal d'architecture. `stateVars` = l'ensemble DÉFINITIF post-analyse +
  // auto-déclaration template (état + dérivés, hors vars importées). Seuil
  // `lint.maxStateVars` (mjs.config.json), 0 = désactivé, défaut 40.
  const maxStateVars = opts.maxStateVars ?? 40
  if (maxStateVars > 0 && analyzer.stateVars.length > maxStateVars) {
    printDiagnostic(typedLine('maxStateVars', t('transpiler.trop-de-variables-etat', { moduleName, n: analyzer.stateVars.length, seuil: maxStateVars }))!, colorsEnabled)
  }

  // Lint « accessibilité » (a11y) — sept contrôles ciblés (image
  // sans alt, iframe sans title, tabindex positif, @click non interactif,
  // bouton/lien sans nom accessible, champ de saisie sans étiquette), cf.
  // transpiler/a11y.ts. Simple AVERTISSEMENT, jamais bloquant, même famille que
  // maxStateVars ci-dessus. Activé par DÉFAUT — `lint.a11y: false` coupe tout.
  // Étiquette `[lint.a11y]` posée ICI (une fois par ligne, pas par composant) : remplace
  // l'ancien rappel « pour couper ce contrôle » répété à chaque composant.
  if (opts.a11y ?? true) {
    for (const msg of checkA11y(html, moduleName, sections.htmlStartLine)) printDiagnostic(typedLine('a11y', msg)!, colorsEnabled)
  }

  // Lint « <form> sans action ni méthode » (ujsForm —
  // le contrat « UJS intercepte TOUT <form> » reste entier, mais avec un
  // avertissement), cf. transpiler/ujs-form.ts. Même famille que le lint a11y
  // ci-dessus : simple AVERTISSEMENT, jamais bloquant. Activé par DÉFAUT —
  // `lint.ujsForm: false` coupe tout.
  if (opts.ujsForm ?? true) {
    for (const msg of checkUjsForm(html, moduleName, sections.htmlStartLine)) printDiagnostic(typedLine('ujsForm', msg)!, colorsEnabled)
  }

  // 10. Generator HTML — V2 retourne aussi `effectsByVar` (Map varName → codes).
  // `structVars` permet au runtime de skip `_mjs_renderStruct` quand
  // une mutation ne touche pas un bloc structurel.
  const [surgicalHtmlWithMarkers, updates, events, inlines, effectsByVar, structVars, mountOnlyEffects, passiveEvents, tagRefs, templateLocals, initialPropBinds, componentDeps, inlineLocals, propVars] = compileHtml(html, {
    analyzer,
    externalVars,
    templateLang,
    moduleName,
    lint: opts.lint,
    colorsEnabled,
    autoSkeleton: !opts.skeleton || opts.skeleton.includes('await'),
    models: opts.models,
    guarded: [...varRules.names.map(n => '$' + n), ...new Set([...varRules.storeNames, ...(opts.typedStores ?? [])].map(n => '$$' + n))],
    guardSilent: opts.guard === false,
    instanceProps,
    firstLine: sections.htmlStartLine,
    devWarnings: opts.devWarnings === true,
  })

  // `<@view name>` réellement transformé en `<metamjs-view id="name">` par le
  // generator (generator/compile.ts, preprocess()) : lire le résultat plutôt que re-greper
  // `html` évite de dupliquer/désynchroniser le motif reconnu (attributs css/data-mjs-vt/
  // data-mjs-vt-p) — la balise SURVIT telle quelle dans le HTML chirurgical, c'est elle que
  // le routeur cherche par querySelector au runtime (cf. mjs_router.ts). Réutilisé par la
  // garde .page.mjs, plus bas après detectRouterAware.
  const hasView = surgicalHtmlWithMarkers.includes('<metamjs-view')

  // On génère __create_X(): {fragment, refs} qui construit le DOM
  // impérativement. Le walk legacy extractPaths/serializePaths (debug,
  // consommé NULLE PART en aval — vérifié) a été retiré du chemin de prod :
  // un parcours HTML complet redondant par fichier, qui hébergeait en plus
  // une boucle infinie sur un `<` littéral en texte.
  // `compactPaths` : le DOM racine du composant est construit UNE fois par instance — ses accès
  // aux nœuds s'écrivent `µ._p(_f,2,0)` et ses marqueurs `µ._tm(…)` (runtime mjs_dom.ts) dès que
  // c'est plus court. Les gabarits de ligne d'un `{for}`, eux, gardent leurs chaînes directes
  // (cf. compileFor, generator/compile.ts).
  const createFnBody = generateCreateFnBody(surgicalHtmlWithMarkers, { compactPaths: true })
  const { struct, trans, content: _contentUp } = classifyUpdates(updates)

  // Build des chaînes pour le template V2.
  //
  // Stratégie : on émet d'abord un tableau `const _e = [() => {...}, ...]`
  // contenant TOUS les codes d'effects uniques. Puis `_mjs_effectsByVar` et
  // `_mjs_effectsAll` référencent ces fonctions par index — zéro duplication de
  // code source. L'array `_e` est émis en tête de JS_INIT (vu par closure).
  const allEffectCodes: string[] = []
  const codeToFnIdx = new Map<string, number>()
  const ensureCode = (code: string): number => {
    let idx = codeToFnIdx.get(code)
    if (idx === undefined) {
      idx = allEffectCodes.length
      codeToFnIdx.set(code, idx)
      allEffectCodes.push(code)
    }
    return idx
  }

  const effectsByVarObjParts: string[] = []
  for (const [varName, codes] of effectsByVar) {
    const indices = codes.map(c => ensureCode(c))
    const arr = indices.map(i => `_mjs_eff[${i}]`).join(', ')
    effectsByVarObjParts.push(`"${varName}": [${arr}]`)
  }
  // Effects sans var réactive (`{name}` non-réactif, ex: const locale `:=`) :
  // doivent tourner UNE FOIS au mount initial via _mjs_effectsAll, sans alias dans
  // _mjs_effectsByVar (jamais re-fired).
  const mountOnlyIndices: number[] = []
  for (const code of mountOnlyEffects ?? []) {
    mountOnlyIndices.push(ensureCode(code))
  }

  // Émet l'index des vars qui pilotent _mjs_renderStruct. Object lookup
  // est O(1). Si la struct est vide, on émet `null` pour signaler au runtime
  // de skip totalement _mjs_renderStruct (pas d'allocation).
  // Une var qui pose une prop sur un composant enfant y figure aussi, avec la valeur 2 : aucun bloc à redessiner (tout lecteur
  // compare à 1), mais la file des boucles la laisse passer à chaque écriture (`_mjs_invalidate`, mjs_element.ts) — la prop est de
  // l'état de l'enfant, une méthode de l'enfant appelée dans la boucle lit la valeur du tour. Sans bloc ni prop d'enfant : `null`
  const structEntries = struct.length === 0 ? [] : [...structVars].map(v => `"${v}":1`)
  for (const v of propVars) if (struct.length === 0 || !structVars.has(v)) structEntries.push(`"${v}":2`)
  const structVarsStr = structEntries.length === 0 ? 'null' : `{${structEntries.join(',')}}`

  // `µ._storeDeclare([...])` module-level (créé les accesseurs manquants,
  // idempotent) : TOUTES les clés $$ mentionnées par le module, lectures ET
  // écritures — un scan textuel du JS déjà compilé (post toutes réécritures
  // $$/deep-set/µread-µwrite) est plus robuste qu'un traçage site-par-site :
  // couvre uniformément lectures (`µ.store.x`), écritures top-level (idem,
  // accesseur), écritures profondes (`µ._mjs_storeDeepSet/'Call/'Delete('x', …)`),
  // suppressions (`µ._mjs_storeDelete('x')`) et accès bruts (`µ._mjs_storeRaw.x`).
  // Fait à l'assemblage FINAL (jsInitWithEffects + tous les codes d'effects +
  // struct/trans) donc après TOUTES les passes de réécriture du pipeline.

  // Wrappe chaque code d'effect en `() => { code }`. Le tableau est exposé
  // sous le nom `_mjs_eff` (déclaré en tête du JS_INIT).
  const effectsArrayDecl = `const _mjs_eff = [${allEffectCodes.map(c => `() => { ${c} }`).join(', ')}];`
  const effectsAllStr = `_mjs_eff`
  const effectsByVarStr = `{${effectsByVarObjParts.join(', ')}}`

  // 11. JS init : modifiedCode du script + inlines
  //     On supprime le Proxy en transformant les écritures `$.x = y`
  //     en `µ._set(this, 'x', y)` (et computed wrappers en _mjs_setComputed).
  // Chaque passe rend AUSSI sa carte (cf. generator/pass-map.ts) : elles
  // sont accumulées dans l'ordre d'application, puis recomposées avec la carte du
  // compilateur de langage juste avant l'assemblage (source-map-chain.ts).
  const passMaps: (string | undefined)[] = []
  const _p1 = transformReactiveWritesMapped(analyzer?.modifiedCode ?? scriptJs)
  passMaps.push(_p1.map)
  let jsInitBase = _p1.code
  // Path-tracking compile-time pour mutations profondes.
  // Doit s'appliquer APRÈS transformReactiveWrites (qui gère les top-level
  // $.x = y) — applyPathTracking ne traite que les depth >= 2.
  const _p2 = applyPathTrackingMapped(jsInitBase)
  passMaps.push(_p2.map)
  jsInitBase = _p2.code
  // précalcule les deps de chaque
  // µ.effect(callback) en AST, AVANT minification (cf. effect-deps.ts pour le
  // pourquoi : le scan runtime fn.toString() de mjs_runes.ts est cassé dès que
  // `$` est renommé par le minifieur). Doit s'appliquer APRÈS les 2 passes
  // ci-dessus (les $.x déjà réécrites en _mjs_deepSet/_mjs_deepCall ne doivent pas
  // être vues comme des lectures — même portée que l'ancien scan).
  // `analyzer.methodReads` : un `µeffect` qui APPELLE une méthode
  // (`this.fmt()`) hérite des lectures de CETTE méthode dans ses deps
  // précalculées, cf. effect-deps.ts. `analyzer.computedDeps` : un dérivé fondé sur une clé du store que
  // l'effet écrit y cède la place à ses racines (même fichier).
  const _p3 = annotateEffectDepsMapped(jsInitBase, analyzer.methodReads, analyzer.computedDeps)
  passMaps.push(_p3.map)
  jsInitBase = _p3.code
  // Correctif automatique `this` perdu (cf. this-rebinding.ts) — une flèche
  // fine (`->`) top-level NUE (pas une vraie méthode `@nom = -> ...`, pas une
  // `=>`) qui touche `this.x` (`@x`) ou `this._mjs_getRCtx`/`_mjs_setRCtx`/
  // `_mjs_getContext` (§/§§) et se fait appeler sans receveur (gabarit, alias,
  // imbrication) plantait silencieusement. Généralise `@@x` (déjà sûr,
  // `_mjsThis` capturé inconditionnellement dans init()) à TOUT accès `this.`
  // détecté à risque via l'AST — plus besoin que le dev le sache. Ordre : sans
  // importance vis-à-vis des 3 passes ci-dessus (nœuds ciblés disjoints des
  // `$.x`/`µ.effect(...)` qu'elles traitent), mais doit rester APRÈS elles pour
  // ne jamais réanalyser un JS qu'elles auraient encore à modifier.
  const _p4 = rebindDetachedThisMapped(jsInitBase)
  passMaps.push(_p4.map)
  jsInitBase = _p4.code
  // rendus d'une boucle regroupés (cf. loop-batch.ts) : une boucle qui écrit l'état ne redessine qu'à sa sortie. APRÈS
  // les quatre passes ci-dessus : elle reconnaît les écritures aux appels qu'elles ont posés
  const _p5 = batchLoopWritesMapped(jsInitBase)
  passMaps.push(_p5.map)
  jsInitBase = _p5.code
  // Ancre de la zone cartographiée : le texte du `<script>` DANS SON ÉTAT
  // de sortie des 4 passes. Tout ce qui s'y ajoute ensuite (tableau d'effets en tête,
  // gestionnaires inline en queue) est hors carte — on retrouve donc la position finale
  // en cherchant CETTE ancre dans le fichier produit, pas `jsInitBase` qui aura grossi.
  const mappedScriptAnchor = jsInitBase

  // Hook dupliqué — `_mjs_hook('mount', fn)` posé deux fois pour le MÊME nom de
  // hook (`µmount ->` écrit deux fois dans le <script>, idem µawake/µsleep/µdestroy/µfailed/
  // µurlChange) : au runtime, `_mjs_hooks[name] = fn` est un slot UNIQUE (mjs_element.ts,
  // `_mjs_hook`) — le second écrase le premier, SANS la moindre erreur ni avertissement. Détecté
  // ICI, sur le script déjà compilé (jsInitBase), AVANT tout ajout de bloc <routes>/router-aware
  // (qui n'émettent jamais `_mjs_hook`, sans incidence sur le compte).
  //
  // PERF (mesuré) : `sharedInitAst` parse jsInitBase UNE fois, réutilisé par detectDuplicateHook
  // ET detectRoutesReassignment juste en dessous — les deux lisent EXACTEMENT le même texte (rien
  // ne le modifie entre les deux appels). Pas réutilisable pour detectRouterAware, plus bas : si un
  // bloc <routes> existe, jsInitBase est PRÉFIXÉ avant cet appel-là (`this.routes = {...}` posé en
  // tête) — cet AST-ci serait alors périmé pour lui (repassé `undefined`, il re-parse).
  const sharedInitAst = parseScriptAst(jsInitBase)
  const dupHook = detectDuplicateHook(jsInitBase, sharedInitAst)
  if (dupHook) throw new Error(t('transpiler.hook-duplique', { moduleName, hook: dupHook }))

  // Bloc(s) <routes target="…"> — table de routes FIXES, POSÉE en tête du JS d'init,
  // AVANT tout code issu du <script> : `detectRouterAware` (plus bas) doit voir
  // `this.routes` posé pour marquer le composant router-aware, et le script doit
  // pouvoir COMPLÉTER la table déjà posée (`@routes['cible']['/x'] = 'composant'`).
  // Si le script RÉASSIGNE `this.routes` (`@routes = …`), son assignation passe APRÈS celle du
  // bloc et remplace donc la table posée. Ce n'est PAS une erreur —
  // écraser tout ou partie de la table déclarative reste le droit du développeur. On le SIGNALE
  // (avertissement de compilation, non fatal), parce que l'écrasement est silencieux sinon.
  // Vérifié sur `jsInitBase` AVANT l'injection (sinon l'injection elle-même se
  // détecterait comme une réassignation).
  // Calculé ICI, inconditionnellement (avant, seulement si un bloc <routes> existait
  // déjà) : c'est la SEULE lecture de « le <script> du dev écrit-il @routes = … » qui ne soit
  // jamais polluée par l'injection du bloc juste en dessous (elle-même une affectation
  // `this.routes`, qui ferait sinon passer TOUT bloc <routes> pour une directive @routes).
  // Réutilisé par la garde .page.mjs, plus bas après detectRouterAware.
  const hasRoutesDirective = detectRoutesReassignment(jsInitBase, sharedInitAst)
  if (routesSections.length > 0) {
    if (hasRoutesDirective) {
      const routesWarning = typedLine('routes', t('transpiler.routes-script-reassigne'), opts.lint)
      if (routesWarning !== null) sections.warnings.push(routesWarning)
    }
    const routesObjParts = routesSections.map(rs => {
      const entriesStr = rs.entries.map(([path, comp]) => `${JSON.stringify(path)}: ${JSON.stringify(comp)}`).join(', ')
      return `${JSON.stringify(rs.target)}: {${entriesStr}}`
    })
    jsInitBase = `this.routes = {${routesObjParts.join(', ')}};\n${jsInitBase}`
  }

  // Statisation $$ — clés du store universel LUES par ce composant : union des
  // clés préfixées '$$x'/'$$*' qui ont atterri dans `effectsByVar` (templates),
  // `structVars` (if/for/key/await/attributs) ET désormais le <script> lui-même
  // (collectStoreReads, analyzer/index.ts : scan
  // LECTURE-SEULE dédié). Un `µeffect -> $$rt...` jamais mentionné
  // par le gabarit n'émettait AUCUNE ligne `_mjs_storeKeys` : `_mjs_storeSubscribe`
  // n'était jamais posé, `_mjs_storeNotifyKey` ne trouvait personne, l'effet ne
  // repartait JAMAIS sur écriture de la clé — panne muette totale. Dépréfixées
  // ('$$x'→'x', '$$*'→'*'). C'est exactement l'ensemble « ce composant doit se
  // réabonner à ces clés store » — un composant qui n'ÉCRIT que dans le store
  // (jamais ne LIT) n'a besoin d'aucune subscription (rien à invalider chez lui).
  //
  // Placé ICI (déplacé du calcul initial de structVarsStr plus haut) : le scan
  // du <script> exige `jsInitBase` dans son état FINAL de <script> — APRÈS
  // transformReactiveWrites/applyPathTracking/annotateEffectDeps/
  // rebindDetachedThis (les 4 passes juste au-dessus), AVANT que le router-aware
  // append et les handlers inline (assemblés à part, plus bas) n'y ajoutent du
  // code hors du périmètre visé ici (« les $$x lus dans le <script> »).
  const storeKeysSet = new Set<string>()
  for (const k of effectsByVar.keys()) if (k.startsWith('$$')) storeKeysSet.add(k.slice(2))
  for (const k of structVars) if (k.startsWith('$$')) storeKeysSet.add(k.slice(2))
  for (const k of collectStoreReads(jsInitBase)) storeKeysSet.add(k)
  const storeKeysLine = storeKeysSet.size === 0
    ? ''
    : `_mjsThis._mjs_storeKeys = ${JSON.stringify([...storeKeysSet])};`

  // Détection router-aware : si le script pose la rune `µurlChange (path, params) ->`
  // (compilée en `this._mjs_hook('urlChange', fn)`) et/ou déclare `@routes`, le
  // composant doit être enregistré dans µ.Router pour recevoir les notifications
  // de path. Marqué via this._mjs_is_router_aware.
  //
  // Analyse AST sur le JS post-compile (jsInitBase) plutôt que regex sur le
  // source Coffee/Civet : insensible aux strings, commentaires, template
  // literals. Cf. detectRouterAware pour le détail des deux motifs cherchés.
  // `sharedInitAst` réutilisable SEULEMENT si aucun bloc <routes> n'a préfixé jsInitBase
  // juste au-dessus (sinon perimé, cf. son bandeau) : `undefined` dans ce cas → re-parse.
  if (detectRouterAware(jsInitBase, routesSections.length > 0 ? undefined : sharedInitAst)) {
    jsInitBase += '\nthis._mjs_is_router_aware = true;'
    // Préchargement des composants de route (compile-time). Les composants montés
    // par le routeur sont des VALEURS du map `@routes` (ex. '/': 'home-page'), pas
    // des balises <mjs-…> dans le markup → l'autoloader, qui observe le shadow du
    // composant, peut les rater quand le routeur les monte dans l'outlet <@view>
    // (shadow imbriqué). On connaît déjà leurs noms ici : on émet leur chargement
    // pour qu'ils soient définis à temps (pas de détection runtime nécessaire).
    const _ri = jsInitBase.indexOf('this.routes')
    if (_ri >= 0) {
      const _open = jsInitBase.indexOf('{', _ri)
      if (_open >= 0) {
        let _depth = 0, _end = _open
        for (let _k = _open; _k < jsInitBase.length; _k++) {
          if (jsInitBase[_k] === '{') _depth++
          else if (jsInitBase[_k] === '}') { _depth--; if (_depth === 0) { _end = _k; break } }
        }
        const _comps = new Set<string>()
        for (const _m of jsInitBase.slice(_open, _end + 1).matchAll(/:\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
          _comps.add(_m[1])
        }
        for (const _c of _comps) jsInitBase += `\nµ.Autoloader?.load?.('mjs-${_c}');`
      }
    }
  }

  // Un module qui déclare l'une des trois formes de
  // routage (bloc <routes>, directive @routes, balise <@view>) doit porter le marqueur
  // `.page.mjs` (cf. bundler/index.ts, isPageFile/pageAwareBaseName) : hors d'un tel fichier,
  // ces trois formes sont un refus de compilation. Placé ICI, après detectRouterAware ET après
  // la transformation <@view> (compileHtml plus haut) : les trois détections sont connues.
  // Priorité d'affichage si plusieurs formes coexistent (message singulier, cf. spec) : bloc,
  // puis directive, puis vue — ordre naturel du pipeline. `µurlChange` SEUL (sans aucune des
  // trois formes) N'EST PAS une forme visée par la règle : un composant peut y réagir (fil
  // d'Ariane, titre, analytics) sans être lui-même un module de page. `opts.isPageModule` vient
  // du bundler, déduit du VRAI nom de fichier (jamais reconstruit ici, cf. TranspileOpts) —
  // `undefined` (transpile()/transpileFile() appelés directement, tests, outillage) laisse la
  // garde INACTIVE : aucune régression pour un appelant qui ignore cette option.
  if (opts.isPageModule === false) {
    const forme = routesSections.length > 0 ? t('transpiler.page-forme-bloc-routes')
      : hasRoutesDirective ? t('transpiler.page-forme-directive-routes')
      : hasView ? t('transpiler.page-forme-vue')
      : null
    // `moduleName` vient de
    // `pageAwareBaseName` (bundler/index.ts), qui ne retire le marqueur QUE s'il est écrit en
    // minuscules (comme `.theme`, sensible à la casse). Un fichier `x.PAGE.mjs` garde donc
    // `.PAGE` intact dans `moduleName` : une suggestion qui se contentait d'ajouter `.page.mjs`
    // au bout produisait un remède absurde (`x.PAGE.page.mjs`, la casse fautive PLUS un second
    // marqueur). On retire ici tout suffixe `.page` résiduel, n'importe quelle casse, un ou
    // plusieurs à la suite — copie fidèle de `canonicalPageBaseName` (bundler/index.ts) : même
    // règle, dupliquée à dessein (bundler/index.ts importe déjà ce module pour `transpile()`, un
    // import en sens inverse bouclerait le cycle pour trois lignes pures).
    let cleaned = moduleName
    while (/\.page$/i.test(cleaned)) cleaned = cleaned.replace(/\.page$/i, '')
    const suggestion = `${cleaned}.page.mjs`
    if (forme) throw new Error(t('transpiler.page-marqueur-manquant', { moduleName, suggestion, forme }))
  }

  // méthode du composant citée nue par un gestionnaire (cf. lintHandlerBareMethod) : ce que les
  // gestionnaires voient par closure — noms du `<script>`, du `<script module>` et leurs imports.
  // Ceux de <@window>/<@document>/<@body>/<@html> vivent dans le <script> compilé (`this._gl_x =
  // (e, _mjs_el) => …`, macros.ts) : même contrôle, gestionnaire par gestionnaire
  const visibleNames = analyzer.methodNames.size > 0
    ? new Set([...moduleTopVars, ...scriptVars, ...scriptConsts, ...collectImportNames(scriptAst), ...collectImportNames(moduleAst)])
    : null
  const bareMethodsSaid = new Set<string>()
  // la ligne du .mjs du premier gestionnaire du HTML du composant qui cite `nom` (`@click=nom`,
  // `@click={ …nom… }`) ; '' quand on ne le retrouve pas : le HTML d'un partiel inclus n'a pas ses lignes ici
  const htmlForLines = blankBraceStrings(masqueCommentairesHtml(hostHtml), templateLang)
  const handlerLine = (nom: string): number | '' => {
    const id = nom.replace(/\$/g, '\\$')
    const m  = new RegExp(`@[\\w.:-]+\\s*=\\s*(?:\\{[^}]*(?<![\\w$.@])${id}(?![\\w$])|${id}(?![\\w$]))`).exec(htmlForLines)
    return m ? sections.htmlStartLine + (htmlForLines.slice(0, m.index).match(/\n/g)?.length ?? 0) : ''
  }
  if (visibleNames) {
    for (const stmt of ((scriptAst as any)?.body ?? []) as any[]) {
      const affect = stmt.type === 'ExpressionStatement' ? stmt.expression : null
      const cible  = affect?.type === 'AssignmentExpression' ? affect.left : null
      if (cible?.type !== 'MemberExpression' || cible.object?.type !== 'ThisExpression' || !/^_gl_/.test(cible.property?.name ?? '')) continue
      if (affect.right?.type === 'ArrowFunctionExpression') lintHandlerBareMethod(scriptJs.slice(affect.right.start, affect.right.end), analyzer.methodNames, visibleNames, moduleName, bareMethodsSaid, opts.lint, colorsEnabled, handlerLine)
    }
  }

  if (inlines.length > 0) {
    // Grammaire des handlers inline (`@click={…}`). Le generator émet un squelette Coffee-like PARTAGÉ par les deux
    // chemins (postfix if, if/then/else, and/or/not/is…) ; seul l'existentiel
    // `?`/`??` diverge, déjà tranché à l'émission via `state.templateLang`
    // (cf. attributes/index.ts). 'civet' (défaut) → compilation Civet ci-dessous.
    // 'js' → repli historique, compilation Coffee brute, INCHANGÉE.
    //
    // Pas de `_mjsThis = @` ici : le template outer définit déjà
    // `const _mjsThis = this` accessible par closure. Une déclaration ici
    // créerait un `var _mjsThis` qui shadow le const outer (hoisted),
    // rendant undefined tous les µ._set(_mjsThis, ...) plus haut.
    const chunksInline = inlines.map(c => {
      const code = c.toString().trim()
      if (!code) return '  (e, _mjs_el) -> null'
      return code.split('\n').map(l => `  ${l}`).join('\n')
    })
    const inlinesSrc = '@_mjs_inline = [\n' + chunksInline.join('\n') + '\n]\n'

    // les noms du `<script module>` et du `<script>` que le batch peut voir par closure, et les
    // constantes de ces deux scripts — retirés des listes PAR GESTIONNAIRE, à hauteur des seuls
    // noms que le gabarit met VRAIMENT en portée de ce gestionnaire (variable et index d'un
    // `{for}` englobant, argument de branche `{await}`, `{const}` du bloc courant, cf.
    // `inlineLocals`). Ceux-là DOIVENT rester locaux : le squelette de reconstruction les
    // réassigne en tête de handler, et le `{const}` comme l'argument de branche n'existent pas
    // du tout dans son corps. Le retrait était GLOBAL au composant : un gestionnaire situé
    // AILLEURS subissait le même sort, Civet y déclarait une copie locale (`let number = 5`) et
    // l'écriture était silencieusement perdue — sans un mot, ni au build ni au clic. Même fuite
    // pour le contrôle de constance : un nom de gabarit sortait de la liste contrôlée, une `:=`
    // homonyme n'était plus refusée.
    const basePredeclared = [...moduleTopVars, ...scriptVars, ...scriptConsts]
    const baseConsts = [...scriptConsts, ...moduleConsts]
    // les groupes se bâtissent sur les listes EFFECTIVES, pas sur les noms de gabarit : deux
    // gestionnaires qui ne divergent pas (aucun homonyme du `<script>`) ne compilent qu'une
    // fois — un composant sans collision garde donc UN groupe, et une sortie identique
    // `gabarit` : union des noms du gabarit en portée des gestionnaires du groupe — leur copie,
    // recréée en tête de gestionnaire, ne se réaffecte pas (cf. controlerGestionnairesInline)
    const groupes = new Map<string, { predeclared: string[]; consts: string[]; indices: number[]; gabarit: Set<string> }>()
    for (let i = 0; i < inlines.length; i++) {
      // filet : un gestionnaire sans locaux enregistrés retombe sur l'union globale
      // (l'ancien filtre), jamais sur « aucun local » — cela prédéclarerait la variable d'un
      // `{for}` et lui ferait écrire la var du `<script>` au lieu de l'item reconstruit
      const locaux = new Set(i < inlineLocals.length ? inlineLocals[i] : templateLocals)
      const predeclared = basePredeclared.filter(nom => !locaux.has(nom))
      const consts = baseConsts.filter(nom => !locaux.has(nom))
      const cle = JSON.stringify([predeclared, consts])
      let groupe = groupes.get(cle)
      if (!groupe) {
        groupe = { predeclared, consts, indices: [], gabarit: new Set() }
        groupes.set(cle, groupe)
      }
      groupe.indices.push(i)
      for (const nom of locaux) groupe.gabarit.add(nom)
    }
    const listeGroupes = Array.from(groupes.values())

    /** source d'un groupe — un seul groupe : le batch d'origine, inchangé. Plusieurs groupes
     * (un nom du gabarit recouvre un nom du `<script>`, donc des listes divergentes) : une
     * compilation par groupe et une écriture par INDEX dans `_mjs_inline` — l'index reste la
     * clé d'événement du tableau global, l'ordre de `inlines` est conservé. */
    const sourceGroupe = (groupe: { predeclared: string[]; consts: string[]; indices: number[] }, premier: boolean): string => {
      if (listeGroupes.length === 1) return inlinesSrc
      const reset = premier ? 'this._mjs_inline = []\n' : ''
      return reset + groupe.indices.map(i => {
        const lignes = chunksInline[i].split('\n')
        // corps dé-indenté de 2 : la ligne d'affectation porte la flèche, le corps reste
        // strictement plus indenté qu'elle (Civet/Coffee lisent l'indentation)
        const corps = lignes.slice(1).map(l => l.slice(2)).join('\n')
        return `this._mjs_inline[${i}] = ${lignes[0].trim()}\n${corps}\n`
      }).join('')
    }

    const sorties: string[] = []
    for (let k = 0; k < listeGroupes.length; k++) {
      const groupe = listeGroupes[k]
      const inlinesSrcGroupe = sourceGroupe(groupe, k === 0)
      let inlinesJsGroupe: string
      if (templateLang === 'js') {
        const coffeeAdapter = getAdapter('coffee')
        const inlinesProcessed = tokenize(applyMjsSugarToScript(inlinesSrcGroupe, 'coffee', undefined, '<script> (handlers)'), { externalVars })
        inlinesJsGroupe = (await coffeeAdapter.compileToJs(inlinesProcessed, {
          fileName: `${moduleName}.inlines`, lint: opts.lint, colorsEnabled,
        })).code
        // Coffee auto-déclare NATIVEMENT : il n'a pas de `predeclared`, et pose un `var n;` en
        // tête de chaque handler qui écrit un nom qu'il ne connaît pas — même écriture perdue,
        // même zone morte que sur le chemin Civet. On retire donc APRÈS COUP, sur l'AST du JS
        // qu'il vient de produire, les `var` sans valeur portant un nom qui vit déjà dans le
        // corps de fonction du composant. Même résultat que le `predeclared` de Civet, par
        // l'autre bout.
        inlinesJsGroupe = dropRedundantVarDeclarations(inlinesJsGroupe, groupe.predeclared)
        controlerGestionnairesInline(inlinesJsGroupe, groupe.consts, moduleName, groupe.gabarit)
      }
      else {
        // `applyMjsSugarToScript(…, 'civet')` sait déjà déclarer les vars nues
        // (`nom = expr` → `nom .= expr`, Pass 4 plus haut) pour une cible
        // non-Coffee, exactement comme pour un `<script>` civet classique — le
        // squelette du generator (assignations brutes `__idx_0 = …`, `item = …`)
        // n'a donc rien de spécifique à faire pour se déclarer proprement ici.
        const civetAdapter = getAdapter('civet')
        const inlinesProcessed = tokenize(applyMjsSugarToScript(inlinesSrcGroupe, 'civet', groupe.predeclared, '<script> (handlers)'), { externalVars })
        lintHandlerSelfRefDeclaration(inlinesProcessed, moduleName)
        try {
          inlinesJsGroupe = (await civetAdapter.compileToJs(inlinesProcessed, {
            fileName: `${moduleName}.inlines`, lint: opts.lint, colorsEnabled,
          })).code
        }
        catch (err: any) {
          // Erreur orientante : le civet ParseError expose `.line` (1-indexé,
          // relatif à `inlinesProcessed` — exactement le texte qu'on vient de lui
          // soumettre, donc AUCUNE conversion d'offset nécessaire) — best-effort
          // seulement (le parser peut caler plus loin que la vraie faute quand il
          // tente de récupérer). On ajoute un indice ciblé quand un ternaire
          // COLLÉ (`a?b:c`, hors chaînes) traîne dans le batch : signature du
          // piège le plus fréquent (Coffee l'acceptait — silencieusement FAUX,
          // cf. tests — Civet le rejette).
          const civetMsg = err?.message ?? String(err)
          const lineNo = typeof err?.line === 'number' ? err.line : null
          const faultyLine = lineNo != null ? inlinesProcessed.split('\n')[lineNo - 1] : null
          const lineHint = faultyLine != null
            ? t('transpiler.hint-ligne-civet', { ligne: lineNo, ligneFautive: faultyLine.trim() })
            : ''
          // Filler NON-blanc (pas des espaces) : les branches d'un ternaire collé
          // sont typiquement des chaînes (`a?'x':'y'`) — un masquage espace-à-espace
          // ferait disparaître le caractère juste après le `?` (le guillemet),
          // rendant le motif `\?[^\s?.:]` aveugle à sa propre cible.
          const codeOnly = inlinesProcessed.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
          const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly)
            ? t('generator.hint-ternaire-colle')
            : ''
          throw new Error(t('transpiler.handler-inline-echec-civet', { moduleName, lineHint, civetMsg, gluedTernaryHint }))
        }
        controlerGestionnairesInline(inlinesJsGroupe, groupe.consts, moduleName, groupe.gabarit)
      }
      sorties.push(inlinesJsGroupe)
    }
    // un seul groupe : le texte du batch d'origine, tel quel ; plusieurs : les blocs compilés
    // à part, recollés dans l'ordre des index (cf. sourceGroupe)
    const inlinesJs = sorties.join('\n')
    // même pipeline que le <script>, rebindDetachedThis COMPRISE — ferme
    // l'écart : la passe n'était câblée que sur jsInitBase, jamais sur les
    // handlers inline (assemblés à part ici) — une `function(){…}` explicite
    // dans un `@click={…}`, appelée détachée ou passée en callback anonyme, y
    // perdait son `this` pareillement (TypeError avalée par le dispatch
    // d'event DOM → clic silencieusement sans effet)
    // (les cartes de ces passes-ci ne sont pas chaînées : le bloc est APPENDÉ après la
    //  zone cartographiée du <script>, il n'a pas de source .mjs propre à pointer)
    // garde symboles réservés, cf. generator/reserved-symbols.ts
    lintReservedSymbolNames(inlinesJs, moduleName, '<script> (handlers)')
    // méthode du composant citée nue par un gestionnaire inline (cf. visibleNames plus haut)
    if (visibleNames) lintHandlerBareMethod(inlinesJs, analyzer.methodNames, visibleNames, moduleName, bareMethodsSaid, opts.lint, colorsEnabled, handlerLine)
    scanStoreArgs(inlinesJs, inlineHandlerLines(generatorState.inlineLines))
    // code mort dans un gestionnaire (cf. unreachable.ts) : à la ligne de la balise qui le porte — pas de
    // lecture du JavaScript quand `lint.unreachable` est coupé
    const inlinesAst = opts.lint?.unreachable === false ? null : parseModuleAst(inlinesJs)
    const handlerAt  = inlineHandlerLines(generatorState.inlineLines)
    warnUnreachableCode(inlinesAst, offset => handlerAt(offset, inlinesAst!), `${moduleName}.mjs`, opts.lint, colorsEnabled)
    jsInitBase += '\n' + batchLoopWritesMapped(rebindDetachedThisMapped(annotateEffectDepsMapped(applyPathTrackingMapped(transformReactiveWritesMapped(inlinesJs).code).code, analyzer.methodReads, analyzer.computedDeps).code).code).code
  }

  // voie AST (post-Civet) : ferme le trou du gabarit (µimport niché
  // dans une interpolation ${…}/#{…}, y compris un template IMBRIQUÉ — un
  // simple CallExpression pour acorn, quelle que soit la profondeur) pour le
  // <script> composant — remplace l'ancienne réécriture par scanner
  // (rewriteMuImport, retirée d'applyMjsSugarToScript). APRÈS la DERNIÈRE
  // mutation de `jsInitBase` (rebind des handlers inline juste au-dessus,
  // router-aware plus haut) — AVANT jsInitWithEffects/jsInitI18n, qui le
  // dérivent tous deux.
  jsInitBase = rewriteMuImportAst(jsInitBase, '<script>')

  // 12. Métadonnées class / tag.
  //
  // V2 — plus de `parentClass` Int/BigInt : `µ.Element` est la base unique
  // (plus de bitmask, plus de limite 31 vars). Le runtime utilise
  // `_mjs_effectsByVar[k]` directement, sans dépendre du nombre de state vars.
  const className = buildClassName(moduleName)
  const tagName = `mjs-${moduleName.toLowerCase()}`

  // Auto-déclaration des refs DOM `@this=!{nom}` à variable NUE (cf.
  // `state.refVars`) : on hisse `let nom;` tout en tête de `init` (avant
  // `_mjs_eff` et le script) pour celles que le script ne déclare pas déjà.
  // Sans ça, le binding `nom = node` + la lecture `nom.x` dans le script
  // référencent une variable jamais déclarée → ReferenceError. Dédup : on ne
  // déclare pas si une `let/var/const nom` existe déjà dans le JS du script.
  // Le nom n'a pas à suivre IMMÉDIATEMENT `let/var/const` : Coffee émet
  // ses déclarations GROUPÉES et triées alpha (`var a, zcanvas;`) ; exiger
  // `\s+nom` juste après le mot-clé ratait `zcanvas` (2ᵉ du groupe) → `let
  // zcanvas;` hoisté au-dessus d'un `var a, zcanvas;` = « already declared » au
  // chargement. On tolère donc une LISTE `[^;=\n]*` entre le mot-clé et le nom,
  // MAIS bornée à `=`/`;`/`\n` : ça reste côté GAUCHE de l'affectation — un
  // `let context = canvas.getContext()` (canvas à DROITE du `=`) ne fait donc
  // toujours pas un faux positif (le `[^;=]` s'arrête au `=`).
  const refDecls = Array.from(generatorState.refVars)
    .filter(name => !new RegExp(`\\b(?:let|var|const)\\b[^;=\\n]*\\b${name}\\b`).test(jsInitBase))
    .map(name => `let ${name};`)
  const refDeclsStr = refDecls.length ? refDecls.join(' ') + '\n' : ''

  // Injecte la déclaration `const _mjs_eff = [...]` en tête du jsInitBase.
  // Toutes les arrow functions y vivent ; `_mjs_effectsByVar` et `_mjs_effectsAll`
  // référencent les indices.
  const jsInitWithEffects = `${refDeclsStr}${effectsArrayDecl}\n${jsInitBase}`

  // Statisation $$ — `µ._storeDeclare([...])` module-level : scan du JS FINAL
  // (post toutes les réécritures $$/deep-set/µread-µwrite) pour TOUTES les
  // clés $$ que ce module mentionne, lecture ET écriture — y compris les
  // écritures pures (jamais captées par effectsByVar/structVars, qui ne
  // trackent que les LECTURES réactives). '*' si le module énumère le store
  // BRUT quelque part (Object.keys(µ.store), for…in, spread) — même clé que
  // '$$*' côté effectsByVar/structVars, mais `_storeDeclare` n'a rien à en
  // faire hors registre de présence (l'accesseur '*' n'existe pas, ignoré
  // silencieusement côté runtime — cf. doute signalé au rapport).
  const storeDeclareScan = `${jsInitWithEffects}\n${allEffectCodes.join('\n')}\n${struct.join('\n')}\n${trans.join('\n')}`
  scanStoreArgs([...allEffectCodes, ...struct, ...trans])
  const storeDeclareKeys = new Set<string>()
  for (const m of storeDeclareScan.matchAll(/µ\.store\.([a-zA-Z_$][\w$]*)/g)) storeDeclareKeys.add(m[1])
  for (const m of storeDeclareScan.matchAll(/µ\._mjs_storeRaw\.([a-zA-Z_$][\w$]*)/g)) storeDeclareKeys.add(m[1])
  for (const m of storeDeclareScan.matchAll(/µ\._store(?:Set|Delete|DeepSet|DeepCall|DeepDelete)\(\s*'([^']*)'/g)) storeDeclareKeys.add(m[1])
  const storeDeclareLine = storeDeclareKeys.size === 0
    ? ''
    : `µ._storeDeclare(${JSON.stringify([...storeDeclareKeys])});`

  // i18n — réécriture compile-time des clés `µ.t(...)` (cf. applyI18nPrefixing
  // plus haut) : mêmes zones que storeDeclareScan ci-dessus (script+handlers+
  // effets, blocs structurels, transitions), cette fois RÉÉCRITES et non plus
  // seulement scannées. `_mjs_i18n` émis si le module a @i18n OU appelle µ.t(
  // (post-réécriture — la présence du marqueur survit toujours à la réécriture).
  const i18nSection = dir.moduleI18nSection
  const i18nMore = dir.moduleI18nExtraSections
  const i18nMode = dir.moduleI18nPlaceholder
  const i18nFx   = dir.moduleI18nPlaceholderFx
  const jsInitI18n = applyI18nPrefixing(jsInitWithEffects, i18nSection, i18nMode, i18nMore)
  const structI18n = struct.map(u => applyI18nPrefixing(u, i18nSection, i18nMode, i18nMore))
  const transI18n = trans.map(u => applyI18nPrefixing(u, i18nSection, i18nMode, i18nMore))
  // même réécriture i18n que struct/trans ci-dessus (une liaison
  // two-way vers un enfant peut très bien vivre sous @i18n, cf. le repro).
  const initialPropBindsI18n = initialPropBinds.map(u => applyI18nPrefixing(u, i18nSection, i18nMode, i18nMore))
  const hasI18nCalls = jsInitI18n.includes('µ.t(') ||
    structI18n.some(u => u.includes('µ.t(')) ||
    transI18n.some(u => u.includes('µ.t('))
  // la ligne d'instance : [section, mode, sections en plus, réglages de l'effet d'attente] — un élément n'est écrit que si un autre le suit
  const i18nInstance: unknown[] = [i18nSection, i18nMode]
  if (i18nMore.length > 0 || i18nFx) i18nInstance.push(i18nMore.length > 0 ? i18nMore : null)
  if (i18nFx) i18nInstance.push(i18nFx)
  const i18nLine = (i18nSection !== null || hasI18nCalls)
    ? `_mjsThis._mjs_i18n = ${JSON.stringify(i18nInstance)};`
    : ''

  // Piège Shadow DOM (@font-face/@import silencieusement inertes en
  // adoptedStyleSheets, cf. cssTrapWarnings) : scanné sur le CSS déjà
  // COMPILÉ (pas le SASS source) pour ne jamais se faire piéger par un
  // @import SASS (résolu ici même, jamais présent dans le résultat).
  // THÈMES + passe `$$` — un `$$brand` devient `var(--<varPrefix>-brand)`
  // partout dans un contexte de style, et chaque bloc `<theme>` devient un paquet de
  // custom properties posé sur l'hôte. Deux points non négociables :
  //   · la passe tourne AVANT dart-sass (`$$x` ne parse pas en SASS) ;
  //   · le sélecteur est DOUBLE — `:where(:host, mjs-x)` matche dans le shadow (`:host`)
  //     ET dans le document en mode `mjs-light` (le tag), la liste indulgente de
  //     `:where()` ignorant l'item invalide de chaque côté (vérifié sur FF + Chromium).
  // Déclarer une variable de thème dans le bloc de base FIGE cette variable pour le composant et
  // toute sa descendance : une déclaration posée sur l'élément bat toujours une valeur héritée.
  const varPrefix = opts.varPrefix ?? 'mjs'
  const themeVars: ThemeVar[] = []
  const varsRead: string[] = []
  // `$x` ADOSSÉ à `$$x` — un `$$x` du <theme> de BASE expose aussi son
  // nom au SASS : si un <style> lit `$x` sans l'avoir déclaré lui-même, on lui pose la valeur en
  // préambule. C'est ce qui manquait aux trois pièges muets (`@each`, `@if`, fonctions
  // de couleur) : ce que le build doit parcourir ou comparer redevient une donnée du build.
  //   · valeur figée à la DÉCLARATION du bloc de base — une surcharge d'exécution (thème nommé,
  //     `&.chaud`, thème de document) ne la change pas ; ça reste `$$x` pour ce qui doit vivre ;
  //   · seul le bloc SANS nom nourrit le préambule (une variante ne vaut que quand elle est active) ;
  //   · une variable déclarée dans le <style> lui-même garde TOUJOURS la main, on ne la double pas ;
  //   · rien d'émis quand le nom n'est pas lu — pas de variable SASS fabriquée pour rien.
  const themeLiterals = new Map<string, string>()
  let themeCss = ''
  for (const th of sections.themes) {
    const sel = th.name === ''
      ? `:where(:host, ${tagName})`
      : `:where(:host([theme='${th.name}']), ${tagName}[theme='${th.name}'])`
    const rw = rewriteStyleVars(th.raw, { prefix: varPrefix })
    for (const d of rw.declared) themeVars.push({ name: d.name, variant: th.name, line: d.line, doc: d.doc })
    // rootDecl et NON declared : une déclaration posée sous un sélecteur du <theme> (`&.chaud`)
    // est une surcharge CONDITIONNELLE — la figer au build donnerait la couleur de la variante à
    // tout le monde, en silence (défaut connu)
    if (th.name === '') for (const d of rw.rootDecl) if (d.value !== '') themeLiterals.set(d.name, d.value)
    for (const r of rw.read) if (!varsRead.includes(r)) varsRead.push(r)
    themeCss += compileCss(wrapThemeBlock(sel, rw.code, th.lang), th.lang)   // un bloc = un lang, jamais mélangés
  }
  // syntaxe unifiée : `$$x: valeur` en tête de ligne SURCHARGE ici aussi (émis en `--mjs-x`),
  // le préfixe n'est plus à écrire à la main — les déclarations d'un <style> partent au
  // registre par le scan du CSS compilé (bundler, scanDeclaredVars), pas par cette liste
  const styleRw = rewriteStyleVars(style.raw, { prefix: varPrefix })
  if (styleRw.rootDecl.length > 0) throw new Error(t('transpiler.variable-racine-sans-selecteur', { nom: styleRw.rootDecl[0].name, ligne: styleRw.rootDecl[0].line, bloc: '<style>' }))
  for (const r of styleRw.read) if (!varsRead.includes(r)) varsRead.push(r)
  // préambule SASS des `$x` adossés (cf. themeLiterals plus haut) : une ligne par nom, en tête du
  // bloc — SASS exige la déclaration AVANT l'usage, et la syntaxe indentée refuse deux instructions
  // sur une ligne. Le CSS pur n'a pas de variables de build : rien n'y est injecté
  // `@use`/`@forward`/`@charset` doivent rester en TÊTE de feuille (dart-sass : « @use rules must be
  // written before any other rules ») : le préambule se glisse APRÈS eux, jamais devant
  const apresEnTete = (code: string): number => {
    const lignes = code.split('\n')
    let coupe = 0
    for (let n = 0; n < lignes.length; n++) {
      const l = lignes[n].trim()
      if (l === '' || l.startsWith('//') || l.startsWith('/*')) continue
      if (/^@(use|forward|charset)\b/.test(l)) { coupe = n + 1; continue }
      break
    }
    return coupe
  }
  const withSassPreamble = (rw: { code: string, sassRead: string[], sassDeclared: string[] }, lang: 'css' | 'sass' | 'scss'): string => {
    if (lang === 'css') return rw.code
    const noms = rw.sassRead.filter(n => themeLiterals.has(n) && !rw.sassDeclared.includes(n))
    if (noms.length === 0) return rw.code
    const preambule = noms.map(n => `$${n}: ${themeLiterals.get(n)}${lang === 'scss' ? ';' : ''}`)
    const lignes = rw.code.split('\n')
    lignes.splice(apresEnTete(rw.code), 0, ...preambule)
    return lignes.join('\n')
  }
  const baseCss = themeCss + compileCss(withSassPreamble(styleRw, style.lang), style.lang)

  // DÉCLINAISONS (`<style name="bandeau">`) — compilées comme le style de base, mais SORTIES
  // du composant : le build les écrit dans un fichier frère que le runtime ne va chercher que
  // si un `layout="bandeau"` apparaît. C'est là que le chargement à la demande a du sens — une
  // déclinaison de forme pèse des kilo-octets de règles, là où une déclinaison de couleurs
  // tient dans quelques variables de thème embarquées.
  const layoutCss: Record<string, string> = {}
  for (const ly of layouts) {
    const rw = rewriteStyleVars(ly.raw, { prefix: varPrefix })
    if (rw.rootDecl.length > 0) throw new Error(t('transpiler.variable-racine-sans-selecteur', { nom: rw.rootDecl[0].name, ligne: rw.rootDecl[0].line, bloc: `<style name="${ly.name}">` }))
    for (const r of rw.read) if (!varsRead.includes(r)) varsRead.push(r)
    layoutCss[ly.name] = compileCss(withSassPreamble(rw, ly.lang), ly.lang)
  }
  // les modèles du HTML seul : chaque nom comparé à µlayout (`µlayout is 'timer'`, `'timer' == µlayout`,
  // `switch µlayout` et ses `when`, `['mini', 'micro'].includes(µlayout)`) — connus comme un style nommé,
  // mais sans style à charger (valeur vide : ni fichier ni requête). Le script est lu sur son AST, le
  // HTML sur le code de ses accolades
  if (muLayout) {
    const found = layoutNamesInScript(scriptAst)
    const cmp   = `(?:===?|!==?|\\bisnt\\b|\\bis\\s+not\\b|\\bis\\b)`
    const re    = new RegExp(`µlayout\\s*${cmp}\\s*(['"])([A-Za-z][\\w-]*)\\1|(['"])([A-Za-z][\\w-]*)\\3\\s*${cmp}\\s*µlayout|\\[([^\\[\\]]*)\\]\\s*\\.\\s*(?:includes|indexOf)\\s*\\(\\s*µlayout\\s*\\)`, 'g')
    let mc: RegExpExecArray | null
    while ((mc = re.exec(codeHtml)) !== null) {
      if (mc[5] === undefined) found.push(mc[2] ?? mc[4])
      else for (const m of mc[5].matchAll(/(['"])([A-Za-z][\w-]*)\1/g)) found.push(m[2])
    }
    for (const nom of found) {
      if (/^[A-Za-z][\w-]*$/.test(nom) && nom !== 'default' && !(nom in layoutCss)) layoutCss[nom] = ''
    }
  }
  const cssWarnings = cssTrapWarnings(baseCss, opts.lint)

  const data: TranspileData = {
    scriptSourceMap,
    moduleSourceMap,
    moduleName,
    className,
    tagName,
    varBitsStr: analyzer?.toJsDict() ?? '{}',
    computedDepsStr: serializeComputedDeps(analyzer),
    createFnBody: createFnBody.body,
    events,
    passiveEvents,
    surgicalHtml: surgicalHtmlWithMarkers,
    structUpdates: structI18n,
    transUpdates: transI18n,
    effectsByVarStr,
    effectsAllStr,
    initialPropBindsStr: initialPropBindsI18n.join('\n'),
    structVarsStr,
    storeKeysLine,
    storeDeclareLine,
    typesDecl: (varRules.vars.length > 0 ? `\nconst _mjs_T_${className} = {${varRules.vars.join(',')}};` : '') + (varRules.stores.length > 0 ? `\nµ._mjs_storeTypes({${varRules.stores.join(',')}});` : ''),
    typesLine: varRules.vars.length > 0 ? `\n    this._mjs_types = _mjs_T_${className};` : '',
    storeTypes: varRules.storeTypes,
    usesNamedTypes: varRules.usesNamedTypes,
    usesProjectEffects: generatorState.usesProjectEffects || macros.usesProjectEffects,
    stateMethodClashLine,
    i18nLine,
    jsModule: moduleJs,
    jsInitBase: jsInitI18n,
    baseCss,
    themeVars,
    varsRead,
    themeVariants: sections.themes.map(th => th.name).filter(n => n !== ''),
    layoutCss,
    layoutRune: muLayout,
    sharedCssNames: sections.style.sharedCssNames,
    moduleDisplay: sections.style.moduleDisplay,
    modulePreload: dir.modulePreload,
    moduleFormAssociated: dir.moduleFormAssociated,
    moduleViewTransition: sections.style.moduleViewTransition,
    moduleViewTransitionPriority: sections.style.moduleViewTransitionPriority,
    hasDynamicSlots,
    usedAnimations: Array.from(generatorState.usedAnimations),
    hasDestroyHooks: generatorState.hasDestroyHooks,
    hasFlip: generatorState.hasFlip,
    includedPartials: Array.from(includeAcc.resolved),
    macroErrors: [...includeAcc.errors, ...macros.errors],
    tagRefs,
    sectionWarnings: [...sections.warnings, ...includeAcc.warnings, ...cssWarnings, ...macros.warnings, ...pseudoClashWarnings(html, opts.lint)],
    aliasTag: opts.aliasTag,
    componentDeps,
  }

  const output = injectTemplate(data, dirInject)

  // Carte de source du fichier produit. Trois recollages successifs :
  //   1. `chainSourceMaps` compose la carte du compilateur de langage (déjà décalée
  //      sur la ligne du bloc `<script>` dans le `.mjs`) avec celles des 4 passes ;
  //   2. `shiftGeneratedPosition` la déplace là où `jsInitBase` a réellement atterri
  //      dans le squelette de classe — position LUE dans le texte produit, jamais
  //      recalculée à la main (le squelette peut changer sans casser la carte) ;
  //   3. `finalizeSourceMap` nomme la source et y embarque le `.mjs` d'origine (jamais
  //      servi au navigateur : sans son contenu embarqué, la carte serait inutilisable).
  // Hors périmètre assumé : le `<script module>` (code de MODULE, hors de la classe) et
  // les gestionnaires inline, appendés après la zone cartographiée.
  let sourceMap: string | undefined
  const chained = chainSourceMaps(scriptSourceMap, passMaps)
  if (chained && mappedScriptAnchor.length > 8) {
    let idx = output.indexOf(mappedScriptAnchor)
    // sous @i18n ou avec µimport, le script est encore réécrit après la prise de l'ancre (clés préfixées, appel µimport) :
    // l'ancre passe par les mêmes réécritures (ses lignes ne bougent pas, la carte reste juste à la ligne) ; une ancre
    // toujours introuvable laisse le composant sans carte, comme avant
    if (idx < 0) {
      try {
        idx = output.indexOf(applyI18nPrefixing(rewriteMuImportAst(mappedScriptAnchor, '<script>'), i18nSection, i18nMode, i18nMore))
      }
      catch {
        idx = -1
      }
    }
    if (idx >= 0) {
      const before  = output.slice(0, idx)
      const genLine = before.split('\n').length - 1
      const genCol  = idx - (before.lastIndexOf('\n') + 1)
      sourceMap = finalizeSourceMap(shiftGeneratedPosition(chained, genLine, genCol), `${moduleName}.mjs`, `${moduleName}.js`, content)
    }
  }

  return { data, output, sourceMap }
}

// ----------------------------------------------------------------------------
// transpile — enveloppe publique de transpileImpl : toute erreur du pipeline est
// préfixée du nom du module avant de remonter, cf. wrapModuleError plus haut.
// ----------------------------------------------------------------------------
export async function transpile(
  source: string,
  opts: TranspileOpts = {}
): Promise<{ data: TranspileData; output: string; sourceMap?: string }> {
  // les effets de l'appli, lus par le catalogue pendant cette compilation
  setProjectEffects(opts.effectDefs)
  // un état du générateur et des effets de l'appli propres à cet appel : deux compilations lancées en même temps
  // (Promise.all, serveur qui compile à la demande) ne se prennent ni transitions, ni références, ni effets
  return withState(() => withProjectEffects(opts.effectDefs ?? {}, async () => {
    try {
      return await transpileImpl(source, opts)
    }
    catch (err) {
      wrapModuleError(err, opts.moduleName)
    }
  }))
}

// ----------------------------------------------------------------------------
// transpileFile — variante qui lit depuis un path. `moduleName` calculé AVANT le try :
// sert aussi à préfixer une erreur de LECTURE du fichier (readFileSync), qui ne passe jamais par
// transpile()/wrapModuleError puisqu'elle survient avant tout appel à transpile().
// ----------------------------------------------------------------------------
export async function transpileFile(
  filePath: string,
  opts: Omit<TranspileOpts, 'moduleName' | 'baseDir'> = {}
): Promise<{ data: TranspileData; output: string; sourceMap?: string }> {
  const moduleName = basename(filePath, '.mjs')
  try {
    const { dirname } = await import('node:path')
    const content = readFileSync(filePath, 'utf-8')
    return await transpile(content, { ...opts, moduleName, baseDir: dirname(filePath) })
  }
  catch (err) {
    wrapModuleError(err, moduleName)
  }
}

// ----------------------------------------------------------------------------
// injectTemplate — slot le template avec les substitutions
// ----------------------------------------------------------------------------
export function injectTemplate(data: TranspileData, dirInject: string): string {
  // échappement pour insertion dans un littéral JS simple OU double-guillemet :
  // `data.moduleName`/`data.tagName` dérivent du nom de fichier (jamais garantis « propres » — un
  // dépôt partagé, un upload, une génération dynamique de composant les contrôlent potentiellement),
  // et atterrissent tels quels dans PLUSIEURS littéraux du squelette (jsInit ci-dessous
  // et [[TAG_NAME]] plus bas) sans quoi un `'`/`"` casse la chaîne et exécute la suite comme du JS
  // réel. `\`` et `${` NE sont PAS couverts (jamais utilisé dans un template literal, cf. escapeTpl
  // pour ce cas) — seulement les guillemets simple/double, l'antislash, et les retours à la ligne
  // (LF/CR + U+2028/U+2029, invalides dans un littéral avant ES2019).
  const escapeJsString = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

  // dossier et nom posés AVANT le code du composant : un `layout` écrit dans son script les lit aussitôt
  let jsInit = `µ.activeComponent = this;\n    this._mjs_dir = '${escapeJsString(dirInject)}';\n    this._mjs_modName = '${escapeJsString(data.moduleName)}';\n    ${data.jsInitBase}`
  if (data.sharedCssNames.length > 0) {
    jsInit += `\n    this._mjs_sharedCss = ${JSON.stringify(data.sharedCssNames)};`
  }
  // Déclinaisons déclarées : sert au runtime à refuser un `layout="typo"` SANS aller sur le
  // réseau, et à nommer les noms connus dans le message. Émis seulement s'il y en a — un
  // composant sans déclinaison garde le comportement d'avant (tentative de chargement d'un
  // fichier CSS déposé à la main, encore possible).
  // La VALEUR est l'empreinte du CSS de la déclinaison : le fichier écrit par le build porte
  // un nom stable (`<module>.<nom>.css`, seul nom que le runtime sait construire), donc c'est
  // `?v=<empreinte>` qui casse le cache du navigateur quand la déclinaison change.
  const layoutNames = Object.keys(data.layoutCss)
  if (layoutNames.length > 0) {
    const stamps: Record<string, string> = {}
    for (const n of layoutNames) stamps[n] = data.layoutCss[n] ? createHash('md5').update(data.layoutCss[n]).digest('hex').slice(0, 8) : ''
    jsInit += `\n    this._mjs_layouts = ${JSON.stringify(stamps)};`
  }
  if (data.layoutRune) jsInit += `\n    this._mjs_lay = 1;`
  jsInit += `\n    µ.activeComponent = null;`

  let eventsCode = ''
  if (Object.keys(data.events).length > 0) {
    // 2ᵉ argument optionnel : liste des types d'events à enregistrer en
    // listener `passive` (touch/wheel sans preventDefault → scroll fluide).
    const passiveArg = data.passiveEvents && data.passiveEvents.length > 0
      ? `, ${JSON.stringify(data.passiveEvents)}`
      : ''
    eventsCode = `this._mjs_bindEvents(${JSON.stringify(data.events)}${passiveArg});`
  }

  // Optim #7 — Pré-calcul du Set des ids "avec listener" pour `_mjs_registerRefs`.
  // Tous les ids référencés par AU MOINS un event → on les met dans le Set
  // statique de la classe. Les autres (binding pur sans event) sont skippés.
  const __evtIdsSet = new Set<string>()
  for (const evt of Object.keys(data.events)) {
    for (const id of Object.keys(data.events[evt])) __evtIdsSet.add(id)
  }
  const evtIdsCode = __evtIdsSet.size > 0
    ? `new Set(${JSON.stringify([...__evtIdsSet])})`
    : 'null'

  // :host{display:X} prefix (cf. V1)
  const displayPrefix = `:host{display:${data.moduleDisplay}}`
  const scopedCss = displayPrefix + (data.baseCss ?? '')

  // Échappement template literal : \, `, ${
  const escapeTpl = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

  // Substitution en UNE passe via table de correspondance. Deux pièges évités :
  // 1) la forme FONCTION neutralise les motifs `$$`/`$&`/`$'`/`` $` `` de
  //    String.replace — avant, un simple `'prix en $'` dans le code utilisateur
  //    coupait la chaîne générée et y recopiait un pan du squelette ;
  // 2) la passe UNIQUE garantit qu'un token littéral (`"[[HAS_FLIP]]"`) présent
  //    dans le code utilisateur déjà inséré n'est jamais re-substitué (les
  //    valeurs de remplacement ne sont pas re-scannées).
  const slots: Record<string, string> = {
    '[[CLASS]]': data.className,
    '[[TAG_NAME]]': escapeJsString(data.tagName),
    '[[VAR_BITS]]': data.varBitsStr,
    '[[COMPUTED_DEPS]]': data.computedDepsStr,
    '[[BASE_CSS]]': escapeTpl(scopedCss),
    '[[CREATE_FN_BODY]]': data.createFnBody,
    '[[EVENTS]]': eventsCode,
    '[[EVT_IDS]]': evtIdsCode,
    '[[UPDATES_STRUCTURE]]': data.structUpdates.join('\n            '),
    '[[UPDATES_TRANSITIONS]]': data.transUpdates.join('\n            '),
    '[[EFFECTS_BY_VAR]]': data.effectsByVarStr,
    '[[EFFECTS_ALL]]': data.effectsAllStr,
    '[[INITIAL_PROP_BINDS]]': data.initialPropBindsStr,
    '[[STRUCT_VARS]]': data.structVarsStr,
    '[[STORE_KEYS_LINE]]': data.storeKeysLine,
    '[[STORE_DECLARE_LINE]]': data.storeDeclareLine,
    '[[TYPES_DECL]]': data.typesDecl ?? '',
    '[[TYPES_LINE]]': data.typesLine ?? '',
    '[[STATE_METHOD_CLASH_LINE]]': data.stateMethodClashLine,
    '[[I18N_LINE]]': data.i18nLine,
    '[[JS_INIT]]': jsInit,
    '[[PRELOAD]]': data.modulePreload ? JSON.stringify(data.modulePreload) : 'undefined',
    '[[VIEWTRANSITION]]': data.moduleViewTransition ? JSON.stringify(data.moduleViewTransition) : 'undefined',
    '[[VIEWTRANSITION_PRIORITY]]': String(data.moduleViewTransitionPriority ?? 1),
    // slots indexés : drapeau + appel émis SEULEMENT si le composant écrit `<@slot` — sans lui,
    // `_mjs_injectSlots` (mjs_slots.ts) ne faisait rien, et c'est cet appel littéral que la détection
    // du cœur cherche (bundler/features.ts, clé `slots`)
    '[[AUTOLOADER_LINE]]': '',
    '[[DYNAMIC_SLOTS_LINE]]': data.hasDynamicSlots ? '\n\n    this._mjs_has_dynamic_slots = true;\n    this._mjs_injectSlots();' : '',
    '[[NO_DESTROY_HOOKS]]': data.hasDestroyHooks ? 'false' : 'true',
    '[[HAS_FLIP]]': data.hasFlip ? 'true' : 'false',
    // `@formAssociated` : la classe passe par le socle du formulaire (mjs_form_associated.ts) AVANT son enregistrement — le navigateur lit
    // `formAssociated` et les rappels du formulaire au moment de `customElements.define`. C'est cet appel littéral que la détection du cœur
    // cherche (bundler/features.ts, clé `form_associated`) ; sans la directive, rien n'est écrit et le fichier n'entre pas au cœur
    '[[FORM_ASSOCIATED_LINE]]': data.moduleFormAssociated ? `µ._mjs_formClass(${data.className});\n` : '',
  }
  // guetteur de balises `mjs-*` : seulement si le code émis peut en faire apparaître (cf. autoloaderLine)
  slots['[[AUTOLOADER_LINE]]'] = autoloaderLine(
    ['[[CREATE_FN_BODY]]', '[[EVENTS]]', '[[UPDATES_STRUCTURE]]', '[[UPDATES_TRANSITIONS]]', '[[EFFECTS_BY_VAR]]', '[[EFFECTS_ALL]]', '[[INITIAL_PROP_BINDS]]', '[[JS_INIT]]'].map((k) => slots[k]).concat(data.jsModule ?? ''),
    data.hasDynamicSlots || data.hasDestroyHooks
  )

  // Tokens TOUS ancrés `[[…]]` (le `TAG_NAME` nu, non ancré, aurait été
  // remplacé PARTOUT dans le squelette : fragile à l'évolution du template).
  // Chiffres admis dans le nom (`[[I18N_LINE]]`) — AUCUN autre token existant n'en contient, extension sans risque.
  let final = jsTemplate.replace(/\[\[[A-Z0-9_]+\]\]/g, (tok) => slots[tok] ?? tok)

  // export default + URL.import.meta
  final = final.replace(
    new RegExp(`class\\s+${data.className}`),
    `export default class ${data.className}`
  )

  let result = `import { µ } from µ.asset('mjs_core.js');\n\n`
  if (data.jsModule) result += data.jsModule + '\n\n'
  result += final

  // Tag alias : sub-class anonymous, un constructeur ne pouvant être enregistré que sous une seule balise (customElements.define).
  // Ex pour file `tuto-snippets-card.mjs` : enregistre aussi `mjs-snippets-card`
  // pour que le user puisse écrire `<mjs-snippets-card>` dans son template.
  // `data.aliasTag` atterrit tel quel dans DEUX littéraux JS
  // double-guillemet ci-dessous, même piège que [[TAG_NAME]] plus haut :
  // même `escapeJsString`, jamais dupliquée (closure déjà en scope de cette fonction).
  // L'enregistrement lui-même vit dans une brique du cœur (`µ._al`, runtime mjs_alias.ts, jointe aux
  // seuls projets qui écrivent un alias — c'est CET appel que la détection cherche, cf.
  // bundler/features.ts, clé `alias`) :
  // le test est le même pour tous les composants, il était recopié dans chacun — 189 octets par
  // fichier, 657 fois sur le site de doc. Ce que ce fichier-ci porte encore : ses trois
  // arguments. `µ` est le nom sous lequel le module importe le cœur (ligne `import { µ }`
  // ci-dessus) — le symbole configuré (`sigil: 'mjs'`) est réécrit en `µ` bien avant, et un
  // raccourcisseur qui renomme l'import renomme aussi cet appel (même liaison de module).
  // L'alias n'est enregistré QUE si le manifeste porte sa clé (le tag sans le préfixe `mjs-`,
  // cf. mjs_autoloader.ts). Deux composants qui se disputent le même alias l'EMPOISONNENT au
  // build (bundler/index.ts, claimShortName) : la clé quitte le manifeste, mais la balise
  // restait enregistrée par le premier module chargé — absente du manifeste, elle passait au
  // runtime pour un composant tiers, et les props posées dessus devenaient des propriétés
  // propres qui masquent les méthodes du prototype en production. Manifeste absent (harnais,
  // rendu serveur) : rien à consulter, on enregistre comme avant.
  if (data.aliasTag && data.aliasTag !== data.tagName) {
    const aliasTagSafe = escapeJsString(data.aliasTag)
    const aliasKeySafe = escapeJsString(data.aliasTag.replace(/^mjs-/, ''))
    result += `\nµ._al("${aliasTagSafe}", "${aliasKeySafe}", ${data.className});\n`
  }

  return result
}
