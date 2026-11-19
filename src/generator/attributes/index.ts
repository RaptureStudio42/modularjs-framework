// attributes — port consolidé de la V1 Ruby, compiler_html/attributes/*.rb
//
// V2 — dispatch direct :
//   - Chaque binding émet UN code d'update sans condition `if (dirty & ...)`.
//   - Le code est aussi enregistré dans `state.effectsByVar` via `registerEffect`
//     pour chaque var dont il dépend (closure transitive via analyzer).
//   - Au root, le code va dans `ctx.updates` (utilisé pour le mount initial
//     via `_mjs_effectsAll`) + dans `effectsByVar[var]` pour chaque var.
//   - Dans une `{for}`, le code est dans la closure de l'updateFn de la loop
//     — la loop est elle-même structurelle (always-run) donc pas besoin
//     d'indexer dans effectsByVar.
//
// Noms émis : tout ce que le code généré déclare à côté du code de l'auteur (variable, constante, paramètre de fonction)
// porte le préfixe `_mjs` — l'auteur lit ses variables de script, ses noms de ligne et de valeur dans ce même code, et ne
// l'écrit jamais. Restent en clair `e` et `el` (gestionnaire d'événement) et `_node` et `el` (`@attach`), que le contrat donne à
// l'auteur ; dans un `@attach`, `el` n'est posé que pour l'expression qui le lit sans que l'auteur le déclare.
// tests/generateur-noms-locaux-reserves.test.ts relève les noms déclarés et refuse tout autre.

import { MJS_BOOLEAN_PROPS, written, shownName, oldWordOf, wordForm } from '../../parser/mjs-words.js'
import * as acorn from 'acorn'
import { state, getEffectVars, registerEffect } from '../state.js'
import { typedLine, printDiagnostic } from '../../diagnostics.js'
import { MU_T_OR_LANG_RE } from '../../sigils.js'
import { cleanJs, cleanTemplateExpr, cleanJsHandler, conditionJs, rejectTemplateTimer, pendingInStrings, decodeHtmlEntities, freeIdentifiers, parseMixedString, blockArrowBody, readsMuPending, safeAttrFlag as safeAttrFlagByName, getCivetCompile, callbackTimer, alignsOnFirstLine, awaitsAtTopLevel } from '../utils.js'
import { applyMjsSugarToScript } from '../../transpiler/sugar.js'
import { analyzeConstReassign } from '../../transpiler/const-reassign.js'
import { tokenize, maskInertSameLength } from '../../lexer/index.js'
import { transformReactiveWrites } from '../transform-reactive.js'
import { applyPathTrackingMapped } from '../path-tracker.js'
import type { Node, Attr } from '../../parser/index.js'
import { transitionDirective } from '../../parser/index.js'
import type { EntryScope, LoopInfo } from '../compile.js'
import { t } from '../../messages/index.js'
import { suggestKey } from '../../bundler/config.js'
import { maskNonCode } from '../../mask.js'
import { BROWSER_FUNCTIONS, BROWSER_FUNCTIONS_REFUSING_EVENT, HANDLER_REFERENCE_RE } from '../../handler-reference.js'
import { adjustAttr, SVG_NS, MATH_NS } from '../paths.js'

export interface AttrCtx {
  compiler: typeof state
  node: Node
  attr: Attr
  attrName: string | null | undefined
  rawVal: string
  ctx: { type: string; updates: string[]; loops: any[]; locals?: Set<string>; scope?: EntryScope[]; svgNs?: string | null; foreign?: boolean; inBlock?: boolean; branch?: { id: string; state: string }; birth?: string[] }
  id: string | null
  lid: string | null
  attrStr: string  // mutable via retour de la fonction
}

export interface AttrResult {
  id?: string | null
  attrStr?: string
}

/** Émet un gestionnaire inline en gardant trace des noms que le GABARIT lui met en
 * portée (variable/index des `{for}` englobants, argument de branche `{await}`,
 * `{const}` du bloc courant). Ces noms doivent rester locaux au handler — mais pour CE
 * handler seulement : le transpileur ne les retire de la liste prédéclarée que là, un
 * gestionnaire situé ailleurs garde la variable du `<script>` qu'il écrit vraiment. */
function pushInline(env: AttrCtx, code: string, fault: Error | null = null): void {
  state.inlines.push(code)
  state.inlineFaults.push(fault)
  state.inlineLocals.push(env.ctx.locals ? Array.from(env.ctx.locals).sort() : [])
  state.inlineLines.push(env.node.line)
  state.inlineSources.push(String(env.attr.expr ?? env.attr.val ?? ''))
  // gestionnaire que le compilateur écrit à une liaison : le champ et sa variable tels qu'écrits, la ligne de la balise
  if (code.startsWith('(_mjs_e, _mjs_el)')) state.boundFields.push({ field: String(env.attr.name ?? env.attrName ?? ''), written: String(env.attr.expr ?? env.attr.val ?? '').replace(/^\s*!?\{\s*|\s*\}\s*$/g, '').trim(), line: env.node.line })
}

/** Ce que les aides de portée lisent d'un site de liaison : la portée du gabarit (`ctx`) et, pour la grammaire Civet, les noms du script (`compiler`) ; un texte de
 * branche, que `walk` (compile.ts) compile sans `AttrCtx`, les passe seuls */
type ScopeEnv = Pick<AttrCtx, 'ctx' | 'compiler'>

/** Les entrées de la portée qu'un code doit recréer, une case par entrée : chaque `{for}` toujours (son
 * itérable est lu aussi) ; un `{const}` ou la valeur de la branche `{await}` seulement si `code` lit son nom,
 * ou si l'une des entrées recréées après lui le lit (itérable d'une boucle, expression d'un autre `{const}`).
 * `µpending` (`_mjs_pnd`) se lit sous ses deux noms : compilé dans `code`, écrit tel quel dans le code d'un `{const}` du gabarit (jamais
 * dans une chaîne, cf. litMuPending). */
function scopeRead(scope: EntryScope[], code: string): boolean[] {
  const read         = (text: string, name: string): boolean => new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(text)
  const retainedMask = scope.map(() => false)
  let toRead         = code
  let raws           = ''
  for (let i = scope.length - 1; i >= 0; i--) {
    const e = scope[i]
    if (e.kind === 'for') {
      retainedMask[i] = true
      toRead         += '\n' + e.loop.iterable
    }
    else if (read(toRead, e.name) || (e.kind === 'await' && e.field === 'pending' && readsMuPending(raws))) {
      retainedMask[i] = true
      if (e.kind === 'const') {
        toRead += '\n' + e.raw
        raws   += '\n' + e.raw
      }
    }
  }
  return retainedMask
}

/** Ce que lit le squelette après l'entrée `i` de la portée : `code`, l'itérable de chaque boucle intérieure et l'expression de
 * chaque `{const}` recréé après elle — une variable de ligne lue à travers un `{const}` de la ligne (`{const lab = v[0]}`), ou un
 * `{const}` qui en lit un autre, compte comme lue. */
function textReadAfter(scope: EntryScope[], retainedMask: boolean[], i: number, code: string): string {
  let text = code
  for (let k = i + 1; k < scope.length; k++) {
    const e = scope[k]
    if (!retainedMask[k]) continue
    if (e.kind === 'for') text += '\n' + e.loop.iterable
    else if (e.kind === 'const') text += '\n' + e.raw
  }
  return text
}

// ligne ordinaire de la boucle la plus intérieure : l'élément que la ligne affiche (`_mjs_it` de son entrée, tenu à jour par la
// réconciliation) quand la collection n'a plus le même à la position de la ligne — la ligne part ou bouge pendant ce rendu, et le
// navigateur envoie `blur`/`focusout` au champ qui avait le focus pendant son retrait : sans cela, le gestionnaire recevait l'élément
// de même rang dans la nouvelle collection. L'entrée tenue par une ligne reprise avant sa passe (`_mjs_it` vaut l'entrée) ne compte pas.
// Une seule affectation de l'élément : le contrôle des noms du gabarit refuse qu'un gestionnaire le réaffecte (cf. lint.ts)
function inline(d: number, item: string): string {
  const read  = `_mjs_ra_${d}[_mjs_ri_${d}]`
  const entry = `_mjs_ent_${d}`
  return `  ${entry} = el._mjs_ev?._mjs_ent\n` +
    `  ${item} = if ${entry} and ${entry}._mjs_it isnt ${entry} and µ._mjs_toRaw(${read}) isnt µ._mjs_toRaw(${entry}._mjs_it) then ${entry}._mjs_it else ${read}\n`
}

// ligne ordinaire d'une boucle EXTÉRIEURE, ou de la plus intérieure quand la balise est dans un bloc de la ligne (`{if}`…, dont la table
// ne mène pas à l'entrée de la ligne) : l'élément de cette ligne, posé sur la balise avec son indice à chaque mise à jour
// (`_mjs_it_N`, cf. compile.ts), quand la collection n'a plus le même à sa position — la ligne part
// ou bouge pendant ce rendu ; sans lui, le gestionnaire recevait l'élément de même rang, ou rien quand la nouvelle collection est plus
// courte, et la boucle intérieure se relisait dans cet élément
function outerInline(d: number, item: string): string {
  const read = `_mjs_ra_${d}[_mjs_ri_${d}]`
  const it   = `el._mjs_it_${d}`
  return `  ${item} = if ${it} isnt undefined and µ._mjs_toRaw(${read}) isnt µ._mjs_toRaw(${it}) then ${it} else ${read}\n`
}

/** Squelette qui recrée, en tête d'un gestionnaire ou d'une liaison, les noms que le gabarit met
 * en portée ICI, dans l'ordre du gabarit (cf. EntryScope, compile.ts) : chaque `{for}` par la
 * ligne propre au site (`loopLine`, inchangée), puis chaque `{const}` et la valeur de la
 * branche `{success}`/`{error}` — ceux-là seulement s'ils sont lus, par `code` ou par une entrée
 * recréée après eux (itérable d'une boucle, expression d'un autre `{const}`). Sans eux, un
 * `{const}` ou la valeur chargée levait « … is not defined » au clic, et une boucle sur cette
 * valeur aussi. Chacun passe par un temporaire (`_mjs_cst_N`, `_mjs_aw_N`), comme les boucles par
 * `_mjs_ra_N`/`_mjs_ri_N` : le contrôle des constantes reconnaît ainsi le squelette et refuse toute
 * AUTRE écriture de ces noms, qui ne toucherait qu'une copie locale (cf. const-reassign.ts). Ces
 * temporaires sont des affectations, pas des déclarations : leur préfixe réservé `_mjs_` garantit
 * qu'aucune variable du `<script>` ne porte leur nom, sans quoi le gestionnaire l'écraserait. */
function scopeSkeleton(env: ScopeEnv, code: string, loopLine: (l: any, readAfter: string) => string, grammar: 'civet' | 'js' = 'civet'): string {
  const scope: EntryScope[] = env.ctx.scope ?? env.ctx.loops.map((loop: any) => ({ kind: 'for' as const, loop }))
  const retainedMask = scopeRead(scope, code)
  let output = ''
  for (let i = 0; i < scope.length; i++) {
    const e = scope[i]
    if (!retainedMask[i]) continue
    if (e.kind === 'for') {
      output += loopLine(e.loop, textReadAfter(scope, retainedMask, i, code))
      continue
    }
    const temp   = e.kind === 'const' ? `_mjs_cst_${i}` : `_mjs_aw_${i}`
    // un `{const}` recalculé dans un gestionnaire lit `µpending` comme dans la branche, interpolation d'une chaîne double comprise
    const value = e.kind === 'const'
      ? (grammar === 'js' ? e.js : cleanJs(pendingInStrings(e.raw), env.compiler.externalVars, false, env.compiler.moduleName))
      : `_mjsThis._mjs_awaitStates?.get('${e.id}')?.${e.field}`
    output += grammar === 'js' ? `const ${temp} = ${value}; let ${e.name} = ${temp}; ` : `  ${temp} = ${value}\n  ${e.name} = ${temp}\n`
  }
  return output
}

/** Squelette d'une boucle pour la réécriture DOM→modèle d'une liaison deux sens (cf.
 * scopeSkeleton). Optim #8 — lit la prop JS `_mjs_idx_N` si présente, sinon l'attribut. L'élément
 * se relit dans la collection elle-même : sa position pour un tableau, sa clé pour un objet (la boucle
 * d'un objet range sa clé comme index ; ses valeurs en tableau ne s'y liraient pas), sa position dans
 * la liste de ses éléments pour un Set ou une Map (une paire `[clé, valeur]`, comme la ligne l'affiche).
 * Harmonisation Civet — seul point de divergence Coffee/Civet du squelette : l'existentiel
 * binaire Coffee `a ? b` (sans `:`) n'existe pas en Civet (« Failed to parse ») ; Civet exprime le
 * même repli via `??`, que CoffeeScript ne connaît PAS (« unexpected ? »). */
function loopBindingLine(l: any): string {
  const d = l.depth
  return `  _mjs_ri_${d} = _mjs_el._mjs_idx_${d} ?? _mjs_el.getAttribute('data-mjs-idx-${d}')\n` +
    `  _mjs_ra_${d} = ${l.iterable}\n` +
    `  _mjs_ra_${d} = Array.from(_mjs_ra_${d}) if _mjs_ra_${d} instanceof Map or _mjs_ra_${d} instanceof Set\n` +
    `  ${l.item} = _mjs_ra_${d}[_mjs_ri_${d}]\n` +
    `  ${l.index} = _mjs_ri_${d}\n`
}

/** Les variables réactives que lisent les `{const}` qu'un code oblige à recréer (cf. scopeRead) : l'effet qui
 * les recrée doit suivre ces variables, sinon un `{const}` lu par la condition ou la valeur ne bouge plus
 * quand elles changent. */
function constVars(env: ScopeEnv, code: string): string[] {
  const scope        = env.ctx.scope ?? []
  const retainedMask = scopeRead(scope, code)
  const vars         = new Set<string>()
  // la valeur d'un `{await … keep}` et son `µpending` changent sous la branche affichée : leur nom (`cle`) se suit comme une variable
  scope.forEach((e, i) => {
    if (!retainedMask[i]) return
    if (e.kind === 'const') for (const v of getEffectVars(e.raw)) vars.add(v)
    else if (e.kind === 'await' && e.key) vars.add(e.key)
  })
  return [...vars]
}

// réglage `proxy: false` : tête de l'itérable d'une boucle `{for}` dont un gestionnaire écrit l'élément (`$.l.filter(f)` → `$`, `l` ;
// `rangee.cells` → `rangee`), y compris sous une copie qui garde les objets (`Object.values($.m)`, `Object.entries`, `Array.from`,
// `[...$.l]`) — la variable de l'état que nomme l'avertissement
const LOOP_HEAD = /^(?:(?:Object\.(?:values|entries)|Array\.from)\(\s*|\[\s*\.\.\.\s*)?([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/

/** Les valeurs d'un `{await … keep}` que lit `code` (cf. EntryScope.cle) : une liste `{for}` de la branche les relit dans l'état du bloc
 * avant de se refaire — sa fonction garde sinon celles de la construction de la branche. */
export function keptValues(env: ScopeEnv, code: string): Array<EntryScope & { kind: 'await' }> {
  const scope        = env.ctx.scope ?? []
  const retainedMask = scopeRead(scope, code)
  return scope.filter((e, i): e is EntryScope & { kind: 'await' } => retainedMask[i] && e.kind === 'await' && !!e.key)
}

/** Effet posé à la RACINE pour une liaison située dans une branche `{await}` (hors de la fonction
 * de la branche) : la valeur `{success}`/`{error}` et les `{const}` de la branche y sont recréés,
 * sans quoi son premier passage levait « … is not defined » et le composant entier tombait ; et
 * seulement quand cette branche est celle qui est affichée (cf. currentBranch).
 * Aucune boucle ici : un `{for}` a son propre chemin, et un `{await}` n'est jamais dans un `{for}`. */
function rootBindingEffect(env: ScopeEnv, id: string, expr: string, updateLogic: string): string {
  const shown = currentBranch(env)
  return `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node${shown ? ` && ${shown}` : ''}) { ${scopeSkeleton(env, expr, () => '', 'js')}${updateLogic} } }`
}

/** Un attribut ou une prop posé dans une branche `{await}` suit ses variables : la pose se fait à la construction de la branche (par l'appelant), cet effet de la racine la
 * rejoue quand une variable lue change (cf. rootBindingEffect). Les variables qu'un `{const}` lu par l'expression lit comptent comme les siennes, l'effet recrée ce
 * `{const}`. Un texte traduit (`µt`) ou la langue lue (`µlang`) suit la langue, comme un texte de la branche (cf. branchText) : l'effet est rejoué à chaque rendu
 * complet (bascule de langue, arrivée d'un dictionnaire) ; sans variable réactive ni texte traduit la pose suffit, rien ne peut changer ce qu'elle a écrit. */
function trackInBranch(env: AttrCtx, id: string, code: string, updateLogic: string, vars: string[], prop = false): void {
  const effectVars = [...new Set([...vars, ...constVars(env, code)])]
  if (prop) notePropVars(effectVars)
  if (effectVars.length > 0 || MU_T_OR_LANG_RE.test(code)) registerEffect(rootBindingEffect(env, id, code, updateLogic), effectVars)
}

/** Vars qui posent une prop sur un composant enfant (cf. state.propVars) : la prop est de l'état de l'enfant, une boucle qui écrit ces vars
 * la lui livre à chaque écriture, sans attendre la sortie de la boucle comme un texte */
function notePropVars(vars: string[]): void {
  for (const v of vars) state.propVars.add(v)
}

/** Ce qui dit que la branche qui porte la liaison est bien celle que le bloc `{await}` affiche (`_mjs_awaitLastRender`, que le runtime passe à la branche affichée avant de la
 * créer et retire quand la promesse disparaît) : l'attente, `{success}` et `{error}`, nommées ou non (`ctx.branche`, posé par compileAwait). Une branche qui n'est plus affichée
 * (promesse remplacée, rejetée ou retirée) laisse ses nœuds connus du composant : l'effet qui y écrirait changerait une balise retirée de la page, relirait la valeur de la
 * branche qui n'existe plus (`null`) et ferait tomber le composant entier, rappellerait la fabrique d'une attache sans que personne la défasse, écrirait dans un nœud texte
 * retiré de la page, ou insérerait les lignes d'une liste `{for}` entre deux repères retirés. */
export function currentBranch(env: ScopeEnv): string {
  const b = env.ctx.branch
  return b ? `_mjsThis._mjs_awaitLastRender?.get('${b.id}') === '${b.state}'` : ''
}

/** Le texte `{expr}` (ou `{{expr}}`, `brut`) d'une branche `{await}` qui lit une variable réactive, ou un `{const}` qui en lit une, ou qui est un texte traduit (il suit la
 * langue) : son nœud `lid` est repéré par l'appelant (un marqueur, ou le conteneur du HTML brut), écrit une première fois à la construction de la branche (`pose`, dans
 * la fonction de la branche, où la valeur de la branche et les `{const}` sont déjà là) puis tenu à jour par un effet de la racine (`effet`), qui recrée cette valeur et ces
 * `{const}` (cf. scopeSkeleton) et ne tourne que si la branche est celle qui est affichée (cf. currentBranch). Rend null quand rien ne peut changer le texte : il
 * reste alors calculé une fois, dans le gabarit de la branche. */
// écriture d'un HTML brut sur la balise `n` : celui d'un module du cœur (nom `core-…`, préfixe interdit aux fichiers du projet) est fait par
// le framework (icônes de `<@@toolbar>`, surface normalisée de `<@@editor>`) et passe par la politique Trusted Types `mjs` ; partout
// ailleurs c'est du HTML d'auteur, écrit tel quel par `µ._mjs_rawHtml` (politique de la page, ou refus qui dit quoi faire)
export function writeRawHtml(n: string, v: string, moduleName: string | undefined): string {
  return moduleName?.startsWith('core-') ? `${n}.innerHTML = µ._mjs_th(${v})` : `µ._mjs_rawHtml(${n}, ${v})`
}

export function branchText(env: ScopeEnv, lid: string, jsVar: string, vars: string[], raw: boolean): { sets: string; effect: string; vars: string[] } | null {
  const tracked = [...new Set([...vars, ...constVars(env, jsVar)])]
  if (tracked.length === 0 && !MU_T_OR_LANG_RE.test(jsVar)) return null
  // le HTML brut ne se réécrit que s'il a changé (`_mjs_h`, comme les lignes d'un `{for}`), le texte de même ; `null` et `undefined` n'écrivent rien dans un texte, comme
  // `_mjs_updText` à la racine (le HTML brut écrit « null », là aussi comme à la racine)
  const write = raw
    ? `const _mjs_ts = String(${jsVar}); if (_mjs_node._mjs_h !== _mjs_ts) { ${writeRawHtml('_mjs_node', '_mjs_ts', env.compiler.moduleName)}; _mjs_node._mjs_h = _mjs_ts; }`
    : `const _mjs_ts = \`\${(${jsVar}) ?? ''}\`; if (_mjs_node.data !== _mjs_ts) _mjs_node.data = _mjs_ts;`
  const guard = currentBranch(env)
  return {
    sets:  `{ const _mjs_node = __nodes['${lid}']; if(_mjs_node) { ${write} } }`,
    effect: `{ const _mjs_node = this._mjs_nodes.${lid}; if(_mjs_node${guard ? ` && ${guard}` : ''}) { ${scopeSkeleton(env, jsVar, () => '', 'js')}${write} } }`,
    vars:  tracked
  }
}

/** Un `{if}` ou un `{key}` posé dans une branche `{await}` suit ses variables : sa condition (ou sa clé) est rejouée par un effet de la racine, qui reconstruit le contenu du
 * bloc entre ses ancres quand le choix change. `choix` est le code de la condition (ou de la clé), `tout` tout le code que l'effet rejoue (le choix, les fabriques du contenu, ses
 * mises à jour) : la valeur de la branche et les `{const}` que `tout` lit sont recréés en tête de l'effet (`prelude`, cf. scopeSkeleton), mais seuls les `{const}` que lit le
 * choix lui font suivre leurs variables (le contenu suit les siennes par ses propres effets). Rend null quand le choix ne lit aucune variable (la valeur de la branche seule, des
 * constantes) : il reste fait une fois, à la construction de la branche. */
export function followedByBlock(env: ScopeEnv, choice: string, all: string, vars: string[]): { prelude: string; guard: string; vars: string[] } | null {
  const tracked = [...new Set([...vars, ...constVars(env, choice)])]
  if (tracked.length === 0) return null
  return { prelude: scopeSkeleton(env, all, () => '', 'js'), guard: currentBranch(env), vars: tracked }
}

/** Helper : enregistre un code d'update au root (effectsByVar + ctx.updates),
 * ou simplement dans ctx.updates pour les contextes for/await/etc. */
function pushUpdate(env: AttrCtx, code: string, vars: string[]): void {
  if (env.ctx.type === 'root') {
    registerEffect(code, vars)
    // prop d'un composant de la racine, hors bloc : rejouée avant que l'enfant n'entre dans la page (cf. state.kidBinds)
    if (!env.ctx.inBlock && code.includes('._mjs_pend(')) state.kidBinds.push(code)
  }
  env.ctx.updates.push(code)
}

/** sentinelle jumelle de `CONST_DECL_PREFIX` (compile.ts) :
 * marque une entrée de `ctx.updates` (émise par `bindingStandard`, ctx.type
 * ni 'root' ni 'for') qui doit courir APRÈS `branchUpdates`+`postUpdates` de
 * la branche englobante ({await}/{if}/{key} non-root) — même besoin que
 * `postUpdates` (paths.ts) pour un `<select value>`, mais pour du code émis
 * ICI, jamais vu par le parseur HTML de paths.ts. Consommée par
 * `splitDeferredUpdates` (compile.ts) aux 3 points d'assemblage non-root. */
export const SELECT_VALUE_DEFER_PREFIX = '/*@mjs-select-post*/'

/** Pose les index de loop en PROPS JS (`_mjs_idx_D`) via l'updateFn de
 * la ligne, SANS attribut DOM. Remplace l'attrPart `data-mjs-idx-D='${idx}'`
 * interpolé dans le template (qui forçait un setAttribute par row dans la
 * factory et empêchait le cloneNode pur). L'updateFn tourne à la création
 * (tplFn / pass 2) et à chaque réordonnancement — la prop est donc
 * toujours posée avant qu'un event utilisateur puisse être dispatché, et les
 * reconstructs la lisent en priorité (le fallback getAttribute reste pour
 * compat). Même convention d'index que compile.ts : la loop courante
 * expose `l.index`, les englobantes leur variable interne.
 * @returns true si la pose a été enregistrée (lid présent) — l'appelant peut
 * alors omettre l'attrPart ; false → conserver l'attrPart (sécurité). */
function pushIdxPropUpdates(env: AttrCtx): boolean {
  if (!env.lid || !env.ctx.loops || env.ctx.loops.length === 0) return false
  const currentDepth = env.ctx.loops[env.ctx.loops.length - 1].depth
  for (const l of env.ctx.loops) {
    const idxVar = l.depth === currentDepth ? l.index : l.internalIndex
    const idxUpd = `{ const _mjs_nIdx = __nodes['${env.lid}']; if(_mjs_nIdx && _mjs_nIdx._mjs_idx_${l.depth} !== ${idxVar}) { _mjs_nIdx._mjs_idx_${l.depth} = ${idxVar}; } }`
    if (!env.ctx.updates.includes(idxUpd)) env.ctx.updates.push(idxUpd)
  }
  return true
}

/** L'attribut d'un élément SVG ou MathML tel que l'analyseur HTML du navigateur le pose dans le gabarit : `viewbox` devient `viewBox`,
 * `definitionurl` `definitionURL`, `xlink:href` passe dans l'espace de noms de XLink (cf. adjustAttr, paths.ts). La mise à jour d'un
 * attribut calculé le cherche par son nom exact, casse comprise : sous le nom écrit elle ne trouvait pas celui du gabarit et en créait un
 * second, que le dessin ignore. Le nom rendu est celui que le gabarit déclare et que la mise à jour cherche ; `ns` dit si l'analyseur
 * pose l'attribut dans un espace de noms (à déclarer dans le gabarit, sans quoi `setAttribute` le crée sans espace de noms).
 * L'élément est SVG (ou MathML) quand c'est `<svg>` (ou `<math>`) lui-même, ou quand le contexte le dit (`svgNs` : posé en entrant dans
 * l'une de ces balises, relayé dans les blocs, retiré sous un `<foreignObject>`) ; un élément HTML garde le nom écrit. */
function adjustedAttr(env: AttrCtx, attrName: string): { name: string, ns: string | null, toggles?: string } {
  const tag = (env.node.name ?? '').toLowerCase()
  const adj = adjustAttr(tag === 'svg' ? SVG_NS : tag === 'math' ? MATH_NS : env.ctx.svgNs ?? null, attrName)
  // la classe calculée d'une balise qui a des bascules `@class{…}` porte leurs jetons jusqu'à son écriture (cf. writeEnd)
  const toggles = adj.name === 'class' ? toggleTokens(env.node) : ''
  return toggles ? { ...adj, toggles } : adj
}

/** `, 1` pour un nom sans risque (cf. safeAttrFlag, generator/utils.ts) ; rien pour une prop booléenne, que le runtime écrit par sa propriété, jamais par le filtre */
function safeAttrFlag(name: string): string {
  return MJS_BOOLEAN_PROPS.includes(name) ? '' : safeAttrFlagByName(name)
}

/** Le nœud que `µ._mjs_updAttrNode` reçoit pour un attribut étranger (`xlink:href`, `xml:lang`…) d'un élément SVG : un jumeau du nœud qui garde la lecture, le retrait et le
 * filtre de sécurité de la mise à jour (c'est elle qui l'appelle) et ne change que la CRÉATION, posée dans l'espace de noms `ns`. Sans lui la mise à jour retire l'attribut
 * quand la valeur devient `null`, `undefined` ou `false`, puis le recrée par `setAttribute`, qui le pose SANS espace de noms : un `<use xlink:href>` n'est plus lu (adresse
 * vide, boîte 0 x 0, l'icône disparaît pour de bon), un `xml:lang` ne donne plus sa langue. La recherche et le retrait se font par le nom qualifié, comme avant : le rendu
 * serveur (happy-dom) laisse `xml:lang` et `xml:space` sans espace de noms, une recherche par espace de noms ne les y trouverait pas et en créerait un second.
 * `noeud` est un identifiant déjà lié, qui peut valoir `undefined` (la mise à jour ne fait alors rien). */
function foreignNode(node: string, ns: string): string {
  const k = '_mjs_k'
  const v = '_mjs_v'
  return `${node} && { tagName: ${node}.tagName, getAttribute: (${k}) => ${node}.getAttribute(${k}), setAttribute: (${k}, ${v}) => ${node}.hasAttribute(${k}) ? ${node}.setAttribute(${k}, ${v}) : ${node}.setAttributeNS('${ns}', ${k}, ${v}), removeAttribute: (${k}) => ${node}.removeAttribute(${k}) }`
}

// jetons des bascules `@class{…}` d'une balise, chacun une fois (vide sans bascule)
const toggleTokens = (node: AttrCtx['node']): string => [...new Set((node.attrs ?? []).filter((a) => /^@class\{.+\}$/.test(a.name ?? '')).flatMap((a) => (a.val ?? '').toString().trim().split(/\s+/).filter(Boolean)))].join(' ')

// dernier argument de l'écriture d'un attribut calculé : `, 1` pour un nom sans risque (cf. safeAttrFlag) ; pour la classe calculée d'une balise à
// bascules, leurs jetons — la première écriture de la classe garde ceux que les bascules ont déjà posés (cf. µ._mjs_updAttrNode)
const writeEnd = (adj: { name: string, toggles?: string }): string => adj.toggles ? `, ${JSON.stringify(adj.toggles)}` : safeAttrFlag(adj.name)

/** L'appel qui écrit la valeur d'un attribut calculé sur le nœud `noeud` (cf. adjustedAttr pour `adj`) : `µ._mjs_updAttrNode` tel quel, sauf pour un attribut étranger, dont le
 * jumeau (cf. foreignNode) est lié à un nom avant l'appel : le nom de l'attribut reste le deuxième argument de la mise à jour. Sans point-virgule final. */
function writeAttr(node: string, adj: { name: string, ns: string | null, toggles?: string }, value: string): string {
  if (!adj.ns) return `µ._mjs_updAttrNode(${node}, '${adj.name}', ${value}${writeEnd(adj)})`
  return `{ const _mjs_j = ${foreignNode(node, adj.ns)}; µ._mjs_updAttrNode(_mjs_j, '${adj.name}', ${value}${safeAttrFlag(adj.name)}) }`
}

/** La même écriture à la racine du composant, où le nœud se lit par son identifiant : `this._mjs_updAttr('a1', …)` ; un attribut étranger prend le nœud de `${ptr}._mjs_nodes`. */
function writeRootAttr(ptr: string, id: string, adj: { name: string, ns: string | null, toggles?: string }, value: string): string {
  if (!adj.ns) return `${ptr}._mjs_updAttr('${id}', '${adj.name}', ${value}${writeEnd(adj)});`
  return `{ const _mjs_node = ${ptr}._mjs_nodes.${id}; ${writeAttr('_mjs_node', adj, value)}; }`
}

// ============================================================================
// Static : juste injection littérale dans la balise
// ============================================================================
function staticAttr(env: AttrCtx): AttrResult {
  return {
    // apostrophe → `&#39;` (décodée
    // au parse HTML, valeur restituée) : ce HTML part dans `µ._mjs_cloneTpl`/innerHTML,
    // `title='l'heure'` fermait sinon le quote après `l` (attributs parasites
    // `heure`/`du`/…). On n'échappe PAS `&` : les entités auteur (`&quot;`,
    // `&nbsp;`) doivent survivre.
    attrStr: env.attrStr + ` ${env.attrName}='${env.rawVal.replace(/'/g, '&#39;')}'`,
    id: env.id,
  }
}

// ============================================================================
// Boolean : `<input disabled>` ou `<details open>`
// ============================================================================
// attribut nu sur balise composant = true : `parseProp` lit 'true' ;
// `title=""` reste '' (chemin static) ; HTML servi par un back : écrire `disabled="true"`
const BARE_ATTR_KEEP_NATIVE = new Set(['popover', 'translate'])

// `data-*` et `aria-*` écrits sur un composant se posent sur SA balise :
// fixes, liés ou nus, comme sur une balise native
const COMPONENT_DOM_ATTR = /^(?:data|aria)-/i

// la prop qu'un attribut à tiret pose sur un composant du framework (balise `mjs-…`) porte le nom que la forme en dur obtient : le composant relit
// l'attribut `search-placeholder` sous `searchPlaceholder` (`syncProps`, mjs_element.ts : nom mis en minuscules par l'analyseur HTML, chaque `-x` devient `X`).
// Les formes calculées (`{…}`, `!{…}`, `{...p}`) rangeaient la valeur sous le nom écrit, une clé que personne ne lit. `data-*`, `aria-*` et `mjs-*` ne sont pas
// des props : ils gardent leur nom, comme sur une balise ordinaire ou tierce
const NOT_A_PROP = /^(?:data|aria|mjs)-/i

// les attributs globaux que le navigateur lit sur la balise d'un composant (son `id`, que visent `<@@toolbar for>`, `<label for>` et `aria-labelledby` ;
// sa classe, sa bulle, son rôle, sa langue, son sens d'écriture, son emplacement, son ordre de tabulation, `hidden`) : écrits en valeur calculée,
// ils s'y posent comme leur forme fixe (cf. componentLogic ; la même liste, au runtime, pour le composant que monte `<@module>` :
// µ._mjs_modGlob, mjs_dynamic.ts)
const COMPONENT_GLOBAL_ATTR = /^(?:id|class|title|role|hidden|tabindex|lang|dir|slot)$/i

/** Le code qui livre la valeur calculée `jsVar` d'un attribut à la balise d'un composant `mjs-…` (`_mjs_node`) : toujours sa prop (`_set`, ou le
 * registre d'attente avant sa mise à niveau, cf. µ._mjs_pend) ; `data-*` et `aria-*` se posent en plus sur la balise, un attribut global
 * (COMPONENT_GLOBAL_ATTR) aussi, sauf quand le composant déclare lui-même une prop de ce nom (`_mjs_var_bits`) : il la garde pour lui, sans
 * attribut (`<@@chart hidden={['a']}>` ne cache pas le graphique). Le nom se compare sans la casse, comme un attribut HTML : `tabIndex={…}`
 * va à une prop `$tabindex`, `tabindex={…}` à une prop `$tabIndex`, qui reçoit alors la valeur sous son nom. Une balise pas encore mise à
 * niveau (ligne de {for}, branche, module chargé plus tard) ne dit pas ses props : l'attribut attend que la balise soit définie, et c'est la
 * dernière valeur écrite qui se pose — l'aide commune du cœur µ._mjs_attrGlob (mjs_element.ts), qui range cette valeur dans une table du
 * cœur, jamais sur la balise, et ne lit les props déclarées que sur un composant du projet. `received` : en développement, les drapeaux de la livraison notée (cf. shippingFlags), la
 * valeur calculée une fois et notée avant de partir ; `null` en production, où rien n'est noté. `toggles` : les jetons des bascules `@class{…}`
 * de la balise, que la première écriture de sa classe garde (cf. writeEnd) */
function componentLogic(attrName: string, prop: string, pendProp: string, jsVar: string, received: string | null, toggles = ''): string {
  if (COMPONENT_DOM_ATTR.test(attrName)) return `const __mjsV = ${jsVar}; if (_mjs_node._set) { _mjs_node._set('${attrName}', __mjsV); } else { µ._mjs_pend(_mjs_node, '${attrName}', __mjsV); } µ._mjs_updAttrNode(_mjs_node, '${attrName}', __mjsV${safeAttrFlag(attrName)});`
  const note = received === null ? '' : `µ._mjs_oneWay?.(_mjs_node, '${prop}', this, __mjsV${received}); `
  if (!COMPONENT_GLOBAL_ATTR.test(attrName)) {
    if (received === null) return `if (_mjs_node._set) { _mjs_node._set('${prop}', ${jsVar}); } else { µ._mjs_pend(_mjs_node, ${pendProp}, ${jsVar}); }`
    return `const __mjsV = ${jsVar}; ${note}if (_mjs_node._set) { _mjs_node._set('${prop}', __mjsV); } else { µ._mjs_pend(_mjs_node, ${pendProp}, __mjsV); }`
  }
  const name = attrName.toLowerCase()
  const end  = writeEnd({ name: name, toggles: name === 'class' ? toggles : '' })
  return `const __mjsV = ${jsVar}; ${note}if (_mjs_node._set) { _mjs_node._set('${prop}', __mjsV); } else { µ._mjs_pend(_mjs_node, ${pendProp}, __mjsV); } µ._mjs_attrGlob(_mjs_node, '${name}', __mjsV, '${prop}'${end});`
}

function propName(name: string): string {
  if (!name.includes('-') || NOT_A_PROP.test(name)) return name
  return name.toLowerCase().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}

const isComponent = (node: Node): boolean => (node.name ?? '').startsWith('mjs-')

/** `value` d'une balise de composant écrit en valeur mêlée (`<@@option value="0{x.n}">` dans un {for}, `value="0{$a}"`, `VALUE="…"` en majuscules,
 * le même attribut en HTML) : `µ._mjs_updAttrNode` en fait la propriété `.value` d'un champ natif. Un composant qui déclare `$value` (les modules du
 * cœur `<@@option>`, `<@@radio>`, `<@@checkbox>`, `<@@select>`, un composant du projet), sans accesseur `value` propre sur sa classe, ne lit pas
 * cette propriété une fois mis à niveau et dans la page (l'option gardait sa première valeur, ou n'en avait aucune) : il la reçoit aussi en prop, comme
 * `value={…}`, après la propriété écrite comme toujours (un `µeffect` qui lit `$value` et `this.value` les voit d'accord). Hors de la page (ligne de {for} pas encore insérée : sa connexion relirait le témoin `value=''` du gabarit par-dessus la prop) et
 * avant la mise à niveau (module chargé plus tard), la propriété reste, reprise par le composant à sa connexion ; un composant à accesseur propre,
 * un composant sans `$value` et une balise tierce gardent l'écriture de toujours. Tout autre attribut garde la sienne (attribut posé, lu par
 * `[nom]`, `:host([nom])` et `getAttribute`) */
function writeValue(env: AttrCtx, node: string, adj: ReturnType<typeof adjustedAttr>, value: string): string {
  if (adj.name.toLowerCase() !== 'value' || adj.ns || !isComponent(env.node)) return writeAttr(node, adj, value)
  return `{ const __mjsV = ${value}; ${writeAttr(node, adj, '__mjsV')}; if (${node}?.isConnected && 'value' in (${node}._mjs_var_bits || {}) && !('value' in Object.getPrototypeOf(${node}))) ${node}._set('value', __mjsV) }`
}

/** La même écriture à la racine du composant (cf. writeRootAttr) */
function writeRootValue(env: AttrCtx, ptr: string, id: string, adj: ReturnType<typeof adjustedAttr>, value: string): string {
  if (adj.name.toLowerCase() !== 'value' || adj.ns || !isComponent(env.node)) return writeRootAttr(ptr, id, adj, value)
  return `{ const _mjs_node = ${ptr}._mjs_nodes.${id}; ${writeValue(env, '_mjs_node', adj, value)}; }`
}

// ancienne écriture d'une transition (`@in.fly={…}`) : le nom d'une animation après la directive
const OLD_TRANSITION = /^@(transition|in|out)\.([A-Za-z_]\w*)/

// directives écrites en `@…` que le répartiteur (dispatchAttribute) traite, selon le nom et la valeur brute : un `@…`
// qu'aucune ne prend est un gestionnaire d'événement (son repli, `eventListener`), les événements des transitions
// (`@introstart`…) compris. La seule liste : le répartiteur la suit, la règle de l'avertissement « écrit sa prop » la relit
const DIRECTIVES: Record<string, (name: string, val: string) => boolean> = {
  group:     (name, val) => /^@group(\.[a-z]+)?$/.test(name) && /^!\{(.+)\}$/.test(val),
  content:    (name, val) => (name === '@html' || name === '@text') && /^!\{(.+)\}$/.test(val),
  thisOne:       (name, val) => name === '@this' && /^!?\{(.+)\}$/.test(val),
  style:      (name) => name.startsWith('@style.'),
  cls:     (name) => name.startsWith('@class{'),
  flip:       (name) => name === '@flip',
  attach:    (name) => name === '@attach' || name.startsWith('@attach.'),
  children:    (name) => name === '@childtransition',
  lightDom:    (name) => name === '@lightDom',
  offscreen:  (name) => name === '@offscreen',
  wake:     (name) => name === '@wake',
  place:      (name) => name === SIZE_DIRECTIVE,
  oldSyntax:   (name) => { const v = OLD_TRANSITION.exec(name); return !!v && v[2] !== 'global' && v[2] !== 'shared' },
  transition: (name) => /^@(?:transition|in|out)(?:\.(?:global|shared))*$/.test(name),
  emission:   (name) => name.startsWith('@emit.'),
  boolean:    (name) => MJS_BOOLEAN_PROPS.includes(name.slice(1)),
}

// une balise qui porte un gestionnaire d'événement qui exécute du code (`@change={…}`, `@ferme={…}`, `@introstart={…}`) donne au parent un canal
// pour suivre ce que l'enfant écrit : en développement, sa prop à sens unique écrite par l'enfant n'est pas dite (mjs_debug.ts), l'objet venu
// de la prop qu'il modifie l'est toujours. Une directive (cf. DIRECTIVES) n'en est pas un, ni une valeur à deux sens (`!{…}`), ni un `@…` écrit
// sans valeur (forme nue, qui appelle la fonction ou la méthode du même nom) : la règle ne compte que le code écrit. `val` : la valeur brute
// qu'il reçoit, `code` celle que le gestionnaire exécuterait
const carriesListener = (node: Node): boolean => (node.attrs ?? []).some((a) => {
  const name = a.name ?? ''
  const val  = (a.val ?? '').toString()
  const code = a.type === 'dynamic' ? a.expr : val === 'true' ? '' : val
  return name.startsWith('@') && !!code && !val.startsWith('!') && !Object.values(DIRECTIVES).some((d) => d(name, val))
})

// développement : les drapeaux de la livraison d'une prop à un composant, que le code émis note avec le composant qui la livre (`this`) et sa
// valeur, avant qu'elle ne parte (µ._mjs_oneWay, mjs_debug.ts) — 1 : la balise porte un gestionnaire d'événement, le parent suit par
// l'événement ce que l'enfant écrit dans sa prop, seule la modification de l'objet venu d'elle reste dite
function shippingFlags(env: AttrCtx): string {
  return carriesListener(env.node) ? ', 1' : ''
}

// un `@…` que le répartiteur donne à eventListener : son code passe par le lot des gestionnaires (transpiler/index.ts), Coffee en grammaire
// js, Civet sinon — ni une directive, ni une valeur à deux sens (`!{…}`), ni l'événement d'une transition (`@introstart`…, rappel écrit en JS)
export function handlerCode(a: Attr): boolean {
  const name = a.name ?? ''
  const val  = (a.val ?? '').toString()
  return name.startsWith('@') && !val.startsWith('!') && !/^@(?:introstart|introend|outrostart|outroend)$/.test(name) && !Object.values(DIRECTIVES).some((d) => d(name, val))
}

// la même règle pour une clé connue à l'exécution seulement (donnée étalée `{...p}`)
const SPREAD_KEY = "_mjs_k.indexOf('-') < 0 || /^(?:data|aria|mjs)-/i.test(_mjs_k) ? _mjs_k : _mjs_k.toLowerCase().replace(/-([a-z])/g, (_mjs_m) => _mjs_m[1].toUpperCase())"

// balise `mjs-…` pas encore mise à niveau, liaison à deux sens : la prop prend le nom de la forme en dur (registre des props en attente d'un composant du projet,
// propriété propre reprise à sa mise à niveau), sauf pour une balise que le manifeste dit tierce — elle reçoit l'attribut brut, que son auteur lit tel quel
// (le test de µ._mjs_pend, mjs_init.ts)
const FOREIGN_TAG = '(µ.paths && !Object.prototype.hasOwnProperty.call(µ.paths, _mjs_node.localName.slice(4)))'

function booleanAttr(env: AttrCtx): AttrResult {
  const attrName = env.attrName ?? ''
  const bare     = !(env.node.name ?? '').includes('-') || BARE_ATTR_KEEP_NATIVE.has(attrName) || attrName.startsWith('mjs-') || COMPONENT_DOM_ATTR.test(attrName)
  return {
    attrStr: env.attrStr + (bare ? ` ${attrName}` : ` ${attrName}='true'`),
    id: env.id,
  }
}

// ============================================================================
// Spread : <mjs-info {...$pkg} />
// ============================================================================
function spread(env: AttrCtx): AttrResult {
  const expr = env.attr.expr ?? ''
  const vars = getEffectVars(expr)
  // Site EXPR (spread {...$expr}).
  const jsVar = cleanTemplateExpr(expr, env.compiler.externalVars, env.compiler.moduleName)
  const id = env.id ?? `s${++state.counter}`

  const isWc = (env.node.name ?? '').includes('-')

  // enfant pas encore mis à niveau : `µ._mjs_pend` retient la clé HORS de l'instance (cf.
  // mjs_init.ts). Une clé venue de la donnée étalée — jamais écrite dans le code, donc jamais
  // réservée au raccourcissement — pouvait tomber sur le nom court d'une méthode du prototype
  // et la masquer sur l'élément : le composant crevait à sa mise à niveau
  // un composant `mjs-…` reçoit la clé étalée sous le nom de prop de la forme en dur (cf. propName), une balise tierce sous le nom de la donnée
  const keyDecl     = isComponent(env.node) ? `const _mjs_p = ${SPREAD_KEY}; ` : ''
  const setKey      = isComponent(env.node) ? '_mjs_p' : '_mjs_k'
  const pendKey     = isComponent(env.node) ? `${FOREIGN_TAG} ? _mjs_k : _mjs_p` : '_mjs_k'
  // développement : chaque clé livrée à un composant est une prop à sens unique, que l'enfant ne devrait ni écrire lui-même ni modifier
  // (mjs_debug.ts le dit) ; notée avec le composant qui la livre et sa valeur, avant qu'elle ne parte (cf. shippingFlags)
  const received       = state.devWarnings && isComponent(env.node) ? `µ._mjs_oneWay?.(_mjs_node, _mjs_p, this, _mjs_v${shippingFlags(env)}); ` : ''
  // un attribut écrit sur la balise (fixe, nu, calculé ou mêlé) gagne sur la même clé d'un étalement, dans les deux ordres d'écriture : l'étalement
  // ne le touche jamais (nom comparé sans la casse, comme un attribut HTML ; sur un composant, aussi sous le nom de prop que la forme en dur obtient,
  // cf. propName). La classe fait l'union : la classe étalée s'ajoute à la classe écrite et n'en retire jamais un jeton (µ._mjs_spCls, µ._mjs_spWc, mjs_element.ts)
  // un `value` écrit en dur sur <textarea> ou <select> n'est pas lu par le navigateur (le champ ne l'affiche pas) : il ne garde pas la clé
  const noEffect  = (a: Attr) => (a.name ?? '').toLowerCase() === 'value' && a.type === 'static' && /^(?:textarea|select)$/i.test(env.node.name ?? '')
  const written   = (env.node.attrs ?? []).filter((a) => a.type !== 'spread' && !noEffect(a) && /^[a-zA-Z_][\w:.-]*$/.test(a.name ?? ''))
  const hardcoded = written.find((a) => (a.name ?? '').toLowerCase() === 'class' && a.type === 'static' && !/\{|(?<![\w]|(?<!\.)\.)\$[a-zA-Z_]/.test(a.val ?? ''))
  const cls       = JSON.stringify(hardcoded ? decodeHtmlEntities(hardcoded.val ?? '') : '')
  // repère d'un `<@module $comp>` (le `div` qui porte `mjs-comp`, cf. propModule) : la donnée étalée y suit les règles de `<@module>`, chaque
  // clé est un attribut de la balise, sauf `class`, qui passe par l'aide de la classe (µ._mjs_spCls) : elle s'ajoute à la classe écrite, comme
  // sur une balise ordinaire qui en a une. La classe et les autres clés vont au composant vivant (`_mjs_c`) : la ligne d'un `{for}` garde en
  // main le repère (cf. µ._updModule)
  const onModule = !isWc && (env.node.attrs ?? []).some((a) => a.name === 'mjs-comp')
  const names    = new Set<string>(onModule ? ['class'] : [])
  for (const a of written) {
    const name = (a.name ?? '').toLowerCase()
    if (isWc && name === 'class') continue
    names.add(name)
    if (isComponent(env.node)) names.add(propName(a.name ?? '').toLowerCase())
  }
  const guard       = names.size ? `const _mjs_e = /^(?:${[...names].map((n) => n.replace(/\./g, '\\.')).join('|')})$/i; ` : ''
  const updateLogic = `${keyDecl}${guard ? `if (_mjs_e.test(${setKey})) continue; ` : ''}${received}if (_mjs_node._set) { _mjs_node._set(${setKey}, _mjs_v); } else { µ._mjs_pend(_mjs_node, ${pendKey}, _mjs_v); }`
  // balise native : chaque clé s'écrit comme un attribut calculé (`µ._mjs_updAttrNode` : retrait sur false, null et undefined, filtre des
  // adresses). Chaque étalement de la balise garde les clés et les valeurs qu'il pose (`_mjs_spk`, par son rang parmi les attributs) : une clé
  // posée par plusieurs étalements prend la valeur du dernier qui la pose, comme à la première pose, même quand un étalement plus haut change ;
  // une clé qu'aucun étalement ne pose plus (objet qui la perd, devenu vide ou nul) quitte la balise. `noeud` : l'expression qui donne le nœud,
  // ou null quand `_mjs_node` est déjà lié (effet de la racine d'une branche `{await}`)
  const rank    = Math.max(0, (env.node.attrs ?? []).indexOf(env.attr))
  const toggles = toggleTokens(env.node)
  const onClass = toggles ? `, _mjs_a === 'class' && ${JSON.stringify(toggles)}` : ''
  // balise d'un composant (toute balise à tiret) : chaque clé est une prop ; la classe et les attributs que le navigateur lit sur la balise se
  // posent en plus sur la balise, comme écrits en clair, par une aide du cœur commune à tous les étalements (µ._mjs_spWc, mjs_element.ts),
  // qui reçoit le rang de l'étalement, la classe écrite en dur s'il y en a une, et les noms écrits sur la balise, qu'elle ne touche pas
  const onWc    = guard ? `, ${cls}, _mjs_e` : hardcoded ? `, ${cls}` : ''
  const target  = onModule ? '_mjs_c' : '_mjs_node'
  const live    = onModule ? '_mjs_c = _mjs_node._mjs_modLive || _mjs_node, ' : ''
  const toClass = !isWc && names.has('class') ? ` µ._mjs_spCls(${target}, ${rank}, _mjs_spd, ${cls});` : ''
  const setKeys = guard
    ? "if(_mjs_spd) for (const _mjs_k in _mjs_spd) { const _mjs_a = _mjs_k.replace(/_/g, '-'); if (!_mjs_e.test(_mjs_a)) _mjs_seen[_mjs_a] = _mjs_spd[_mjs_k]; } "
    : "if(_mjs_spd) for (const _mjs_k in _mjs_spd) _mjs_seen[_mjs_k.replace(/_/g, '-')] = _mjs_spd[_mjs_k]; "
  const applySpread = (node: string | null, value: string): string => {
    const bind = node ? `const _mjs_node = ${node}; ` : ''
    return isWc
      ? `{ const _mjs_spd = ${value}; ${bind}if(_mjs_node) { ${guard}if(_mjs_spd) for (const _mjs_k in _mjs_spd) { const _mjs_v = _mjs_spd[_mjs_k]; ${updateLogic} } µ._mjs_spWc(_mjs_node, ${rank}, _mjs_spd${onWc}); } }`
      : `{ const _mjs_spd = ${value}; ${bind}if(_mjs_node) { ${guard}` +
        `const ${live}_mjs_pk = (${target}._mjs_spk ??= {}), _mjs_av = _mjs_pk[${rank}], _mjs_seen = _mjs_pk[${rank}] = {__proto__: null}; ${setKeys}` +
        `for (let _mjs_i = 0; _mjs_i < 2; _mjs_i++) for (const _mjs_a in (_mjs_i ? _mjs_av : _mjs_seen)) if (!_mjs_i || !(_mjs_a in _mjs_seen)) { ` +
        `let _mjs_t; for (const _mjs_r in _mjs_pk) if (_mjs_a in _mjs_pk[_mjs_r]) _mjs_t = _mjs_pk[_mjs_r]; ` +
        `if (_mjs_t) µ._mjs_updAttrNode(${target}, _mjs_a, _mjs_t[_mjs_a]${onClass}); else ${target}.removeAttribute(_mjs_a); }${toClass} } }`
  }

  // `for..in` (zéro alloc) au lieu de `Object.entries().forEach()`
  // (alloue un tableau d'entries + une closure à CHAQUE update — par mutation au
  // root, par row × réconciliation en {for}).
  if (env.ctx.type === 'root') {
    // `_mjs_spd` (préfixe réservé) et non `o` : sinon `<div {...o}>` (item de
    // boucle ou var nommé `o`) émettrait `const o = o` → ReferenceError TDZ au
    // mount.
    pushUpdate(env, applySpread(`this._mjs_nodes.${id}`, jsVar), vars)
    if (isWc) notePropVars(vars)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(applySpread(`__nodes['${env.lid}']`, jsVar))
    // var externe partagée lue par la row (`{...$pkg}`) : sans
    // `structVars`, `_mjs_renderStruct` est sauté → spread figé à vie sur mutation.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await} ; un {if}/{key} imbriqué
    // DEDANS hérite ce ctx.type, transparent pour lui) : AUCUNE branche
    // n'existait ici — `{...$pkg}` sur un composant DANS un `{success}` ne
    // produisait STRICTEMENT rien (0 occurrence de `_mjs_spd` dans le JS
    // émis). Même remède que bindingStandard : (a) pose INITIALE via
    // `__nodes[id]` — ce code tourne DANS la createFn de la branche, AVANT
    // que `_mjs_updAwait` (mjs_element.ts) ne fusionne les refs dans
    // `this._mjs_nodes` (encore vide à cet instant). (b) réactivité
    // ULTÉRIEURE via `registerEffect` + `this._mjs_nodes[id]` (`_mjs_updAwait`
    // idempotent, ne rejoue jamais son contenu tout seul).
    env.ctx.updates.push(applySpread(`__nodes['${id}']`, jsVar))
    // effet posé à la racine (cf. rootBindingEffect) : valeur `{await}` et `{const}` de la branche recréés avant d'être lus — sans eux,
    // « … is not defined » dès le premier passage — et seulement quand cette branche est celle qui est affichée : avant l'arrivée de la
    // promesse (ou après son remplacement, son rejet, son retrait) la valeur est `null`, et `{...v.attrs}` la lisait quand même ;
    // un `{const}` lu par l'étalement est recréé par l'effet : l'effet suit donc aussi les variables que ce `{const}` lit
    const spreadLogic = applySpread(null, jsVar)
    const effectVars  = [...new Set([...vars, ...constVars(env, jsVar)])]
    if (isWc) notePropVars(effectVars)
    registerEffect(rootBindingEffect(env, id, jsVar, spreadLogic), effectVars)
  }

  return { id }
}

// ============================================================================
// Dynamic : attr={$expr}
// ============================================================================
function dynamic(env: AttrCtx): AttrResult {
  const vars = getEffectVars(env.attr.expr ?? '')
  // Site EXPR (valeur d'attribut attr={$expr}).
  const jsVar = cleanTemplateExpr(env.attr.expr ?? '', env.compiler.externalVars, env.compiler.moduleName)
  const id = env.id ?? `a${++state.counter}`
  const attrName = env.attrName ?? ''
  const isWc = (env.node.name ?? '').includes('-')
  // la prop d'un composant `mjs-…` porte le nom que la forme en dur obtient (cf. propName) ; `data-*` et `aria-*` gardent le nom écrit
  const prop = isComponent(env.node) ? propName(attrName) : attrName
  // en attente : une balise que le manifeste dit tierce reçoit le nom écrit, que son auteur lit tel quel
  const pendProp = prop === attrName ? `'${attrName}'` : `${FOREIGN_TAG} ? '${attrName}' : '${prop}'`
  // développement : la prop est livrée à sens unique, l'écriture que l'enfant en ferait lui-même et la modification de l'objet venu d'elle
  // seront dites (mjs_debug.ts) ; notée avec le composant qui la livre et sa valeur, avant qu'elle ne parte (cf. shippingFlags,
  // componentLogic) ; rien en production
  const received = state.devWarnings && isComponent(env.node) ? shippingFlags(env) : null
  // nom (et espace de noms) que le gabarit déclare et que la mise à jour retrouve (cf. adjustedAttr) ; un composant garde le nom écrit, qui est celui d'une prop
  const adj  = isWc ? { name: attrName, ns: null } : adjustedAttr(env, attrName)
  const name = adj.name

  let attrStr = env.attrStr

  // un attribut booléen calculé ne s'écrit pas dans le gabarit (de la ligne, d'un bloc {if} ou {key} de la racine) : `selected=''` y vaudrait « choisi » jusqu'à la mise à jour,
  // et le navigateur ne retient qu'une option choisie par liste — l'option qui arrive ainsi prend le choix des autres, puis la mise à jour la déchoisit et la liste retombe sur sa première
  // option (de même une case radio qui prend le groupe, un `autofocus` qui prend le focus, un `autoplay` qui démarre). La mise à jour qui suit pose la valeur ; la constante `true`
  // (attribut nu, `checked={true}`) n'en a pas, son gabarit la porte. La racine elle-même se construit d'un seul tenant, avant sa mise à jour, sans choix déjà fait à emporter : elle garde son témoin
  const noMarker = attrName !== 'value' && MJS_BOOLEAN_PROPS.includes(attrName) && env.attr.expr?.trim() !== 'true'

  if (env.ctx.type === 'root') {
    let code: string
    if (isWc) {
      // la valeur reste aussi une prop de l'état du composant ; data-*, aria-* et les attributs globaux se posent en plus sur sa balise (cf. componentLogic)
      const updateLogic = componentLogic(attrName, prop, pendProp, jsVar, received, toggleTokens(env.node))
      code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    } else {
      code = writeRootAttr('this', id, adj, jsVar)
    }
    pushUpdate(env, code, vars)
    if (isWc) notePropVars(vars)
    if (!isWc && !(noMarker && env.ctx.inBlock)) attrStr += ` ${name}=''`
  } else if (env.ctx.type === 'for') {
    if (isWc) {
      // la valeur reste aussi une prop de l'état du composant ; data-*, aria-* et les attributs globaux se posent en plus sur sa balise (cf. componentLogic)
      const updateLogic = componentLogic(attrName, prop, pendProp, jsVar, received, toggleTokens(env.node))
      env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogic} } }`)
    } else {
      // Filtered dispatch pour les attributs dynamiques génériques
      // tels que `data-active={item.id === $sel}` ou `aria-selected={...}`,
      // ainsi que les ternaires `data-X={cond ? 'a' : 'b'}`. Même schéma que
      // `@class{cond}` mais avec setAttribute / removeAttribute (ou la valeur).
      const lastLoop = env.ctx.loops && env.ctx.loops.length > 0
        ? env.ctx.loops[env.ctx.loops.length - 1]
        : null
      const filt = lastLoop
        ? detectFilteredValueExpr(env.attr.expr ?? '', lastLoop.item, env.compiler.externalVars ?? [])
        : null
      if (filt) {
        // même fix que bindingClass : `env.lid`
        // distingue 2 nœuds d'une même row partageant (var, attrName).
        const safeAttr = attrName.replace(/[^a-zA-Z0-9_$]/g, '_')
        const filterKey = `${filt.externVar}__attr_${safeAttr}__${env.lid}`
        // le mémo d'un filtrage par clé vit dans `_mjs_filt` (propriété POINTÉE, donc
        // raccourcie en prod) : la clé n'est plus qu'un texte d'index, jamais un nom
        const idxName = filterKey
        // Bool simple : true → setAttribute('name','true') ou removeAttribute si
        // sémantique standard "présent/absent" (data-X / aria-X préfèrent la
        // string explicite, donc on garde set 'true'/'false' pour le caller).
        // Ternaire (valeur) : SÉCURITÉ (XSS) — l'ancien
        // `setAttribute(String(value))` NU contournait `µ._mjs_safeAttr` : un
        // `href={item.id === $sel ? item.url : '#'}` avec `item.url =
        // "javascript:…"` passait tel quel. On route par `µ._mjs_updAttrNode` (comme
        // la branche dynamique NON filtrée, ~:221) → filtre javascript:/data:html
        // ET aligne la sémantique false/null → removeAttribute.
        // un booléen se pose et se retire comme toute valeur calculée hors du filtre (`µ._mjs_updAttrNode`) : un attribut booléen (`selected`,
        // `checked`, `disabled`…) par sa propriété, `false` retire un `data-*`, un `aria-*` (et `draggable`, `spellcheck`…) s'écrit « false ». Écrit en texte,
        // `"false"` laissait l'attribut PRÉSENT : un attribut booléen restait actif, un sélecteur `[data-on]` trouvait toutes les lignes
        const setMatchAttr = filt.isBoolean
          ? `${writeAttr('_mjs_node', adj, 'true')};`
          : `${writeAttr('_mjs_node', adj, filt.matchValue)};`
        // vide sur les autres lignes : l'attribut est retiré, sauf `value` et les attributs booléens (`checked`, `selected`…), que le champ garde en
        // propriété une fois écrits (retirer l'attribut laissait son texte ou sa coche à l'ancienne ligne choisie) : écrits vides, comme hors du filtre.
        // La classe d'une balise à bascules `@class{…}` ou à étalement n'est jamais retirée d'un bloc : leurs jetons y sont aussi, l'écriture vide de
        // la classe les garde
        const sharedClass    = name === 'class' && (!!adj.toggles || (env.node.attrs ?? []).some((a) => a.type === 'spread'))
        const setUnmatchAttr = filt.isBoolean
          ? `${writeAttr('_mjs_node', adj, 'false')};`
          : (attrName !== 'value' && !sharedClass && !MJS_BOOLEAN_PROPS.includes(attrName) && (filt.unmatchValue.trim() === "''" || filt.unmatchValue.trim() === '""')
              ? `_mjs_node.removeAttribute('${name}');`
              : `${writeAttr('_mjs_node', adj, filt.unmatchValue)};`)
        const condExpr = `${filt.itemAccess ? `${lastLoop!.item}.${filt.itemAccess}` : lastLoop!.item} === _mjsThis._state.${filt.externVar}`
        const filteredLogic = `if (!!(${condExpr})) { ${setMatchAttr} } else { ${setUnmatchAttr} }`
        const keyExpr = filt.itemAccess
          ? `${lastLoop!.item}.${filt.itemAccess}`
          : `${lastLoop!.item}`
        // propriété de clé par fn (même schéma que @class filtré) : l'entrée de la clé est reposée
        // quand elle est inédite ou détenue par une autre ligne. Deux rattrapages, émis seulement
        // là où le défaut est possible (ailleurs le code est celui d'avant, à l'octet) :
        // - la fonction est refaite à CHAQUE passe de la ligne quand la valeur écrite lit la ligne
        //   (autre champ, index, `{const}`, boucle parente) : elle ferme sur la passe qui l'a faite,
        //   et une ligne gardée par sa clé reçoit de nouveaux objets (liste rechargée)
        // - la ligne lâche l'entrée de son ancienne clé quand le champ filtré n'est pas la clé du
        //   `by` (champ modifié, ligne positionnelle d'une liste sans clé)
        // le gain du dispatch est intact : le choix qui bouge appelle toujours 2 fonctions
        const redo   = valueReadsLine([filt.matchValue, filt.unmatchValue], lastLoop!.item, filt.itemAccess, env.ctx)
        const drop   = !filterOnKey(lastLoop, filt.itemAccess)
        const multi  = severalLines(drop, env.ctx.loops)
        const create = `const __f = (_mjs_match) => { let _mjs_node = _mjs_n${env.lid}; if (_mjs_match) { ${setMatchAttr} } else { ${setUnmatchAttr} } }; `
        const fields = filterFields(lastLoop!, idxName)
        filteredBinding(env, filt.externVar, idxName, fields, keyExpr, filteredLogic, setFilteredFunction(create, fields, redo, drop, multi), multi, filterCall, filt.tracked)
        if (!noMarker) attrStr += ` ${name}=''`
        return { id, attrStr }
      }
      // `disabled={item.locked}` avec
      // `locked=false` écrivait `disabled="false"` (setAttribute+String
      // inconditionnels) au lieu de RETIRER l'attribut (présence seule =
      // désactivé en HTML) ; `null`/`undefined` devenaient les chaînes
      // littérales `"null"`/`"undefined"`. `µ._mjs_updAttrNode` (voir
      // runtime/mjs_element.ts) reproduit EXACTEMENT la sémantique du root
      // (props booléennes dédiées, retrait sur false/null/undefined, filtre
      // XSS) — root et `{for}` partagent maintenant le même code.
      // Exception : une expression CONSTANTE `true` (le parseur réécrit ainsi
      // un attribut booléen HTML5 nu — `<input checked>` — en `dynamic`, cf.
      // parser/index.ts ; un `checked={true}` explicite tombe dans le même
      // cas) n'a RIEN de réactif à suivre. La `{for}` est "always-run" (voir
      // en-tête du fichier) : cette ligne rejouerait alors `checked = true`
      // à CHAQUE réconciliation de la boucle, y compris quand seule une
      // AUTRE ligne change — écrasant une case décochée par l'utilisateur
      // sur CETTE ligne (et, pour un radio, décochant par ricochet un radio
      // homonyme situé hors de la boucle). `attrStr` pose déjà la valeur
      // initiale dans le gabarit cloné de chaque ligne (`${attrName}=''`,
      // juste plus bas) : une constante `true` n'a donc besoin d'AUCUN
      // updateFn, exactement comme un attribut HTML statique.
      if (env.attr.expr?.trim() !== 'true') {
        env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${writeAttr(`_mjs_n${env.lid}`, adj, jsVar)}; } }`)
      }
    }
    // WC (`<mjs-x foo=!{$shared}>`) et attribut dynamique NON
    // filtré (`data-active={$mode}`) : var externe partagée → `structVars` sinon
    // `_mjs_renderStruct` sauté → DOM figé à vie sur mutation. Les chemins FILTRÉS
    // (au-dessus) ont leur effect dédié → ils sont déjà `return`és et exclus.
    for (const v of vars) state.structVars.add(v)
    if (!isWc && !noMarker) attrStr += ` ${name}=''`
  } else {
    if (isWc) {
      // même chemin que la branche `for` ci-dessus :
      // sans ça, une prop dynamique de composant (`<mjs-card item={d}>`) en
      // branche `{await}` ne posait RIEN — `item` disparaissait en silence.
      // la valeur reste aussi une prop de l'état du composant ; data-*, aria-* et les attributs globaux se posent en plus sur sa balise (cf. componentLogic)
      const updateLogic = componentLogic(attrName, prop, pendProp, jsVar, received, toggleTokens(env.node))
      env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`)
      // la prop suit ses variables : effet de la racine, comme à la racine (la pose ci-dessus la vaut à la construction de la branche)
      trackInBranch(env, id, jsVar, updateLogic, vars, true)
    } else {
      attrStr += ` ${attrName}='\${${jsVar}}'`
      // l'attribut aussi : la valeur posée à la construction est réécrite par `µ._mjs_updAttrNode` (filtre des adresses, nom et espace de noms du gabarit) quand une variable lue change
      trackInBranch(env, id, jsVar, `${writeAttr('_mjs_node', adj, jsVar)};`, vars)
    }
  }

  return { id, attrStr }
}

// segmente `val` en alternance texte/expression, chaque `{...}` repéré par un scan
// ÉQUILIBRÉ (accolades + guillemets, même mécanique que `parseMixedString` juste à côté) —
// remplace le découpage naïf par regex (`/\{([^}]+)\}/g`) qui refermait sur le PREMIER `}`
// rencontré : un objet littéral imbriqué (`{clic({a:1})}`) ou un `}` LITTÉRAL dans une chaîne
// de l'expression (`{clic({a:'}'})}`) tronquait l'expression avant sa vraie fin — échec de
// compilation sur du code utilisateur pourtant valide. Un `{` jamais refermé reste inerte
// (texte tel quel), même tolérance que le reste du compilateur sur un bloc non fermé.
function splitBraceSegments(val: string): { text: string; expr: string | null }[] {
  const segments: { text: string; expr: string | null }[] = []
  const n = val.length
  let i = 0
  let textStart = 0
  while (i < n) {
    if (val[i] !== '{') { i++; continue }
    const start = i
    i++
    let expr = ''
    let balance = 1
    let inString = false
    let stringChar: string | null = null
    while (i < n && !(balance === 0 && !inString)) {
      const ch = val[i]
      if (inString && ch === '\\') { expr += ch + (val[i + 1] ?? ''); i += 2; continue }
      if (ch === '"' || ch === "'" || ch === '`') {
        if (!inString) { inString = true; stringChar = ch }
        else if (stringChar === ch) inString = false
      }
      if (!inString) {
        if (ch === '{') balance++
        if (ch === '}') balance--
      }
      if (balance > 0 || inString) expr += ch
      i++
    }
    if (balance !== 0) break  // jamais refermé : le reste (dès `{`) reste texte tel quel
    // le quantifieur d'une expression régulière, écrit juste après un caractère (`pattern="[0-9]{5}"`, `\d{2,4}`, `a{3,}`), est du texte :
    // jamais une expression à afficher ; en tête de valeur, des chiffres seuls sont une expression (`tabindex="{0}"` vaut 0)
    if (start > 0 && /^\s*\d+\s*(?:,\s*\d*\s*)?$/.test(expr)) continue
    // des accolades vides (`pattern="[^{}]+"`, `title="{}"`) sont du texte : aucune expression à afficher
    if (expr.trim() === '') continue
    segments.push({ text: val.slice(textStart, start), expr })
    textStart = i
  }
  segments.push({ text: val.slice(textStart), expr: null })
  return segments
}

// reconstruit un gabarit JS (`\`...\``) depuis des `segments` déjà scannés en équilibré
// (`splitBraceSegments`) — remplace un appel à `parseMixedString` (utils.ts) qui n'a AUCUNE
// garde sur un `{` jamais refermé : sa boucle sort simplement quand `i>=n` puis émet quand
// même `${cleanTemplateExpr(...)}` sur ce qui reste, un texte pourtant censé demeurer littéral
// (comme le fait déjà le chemin clone juste plus bas, via ces mêmes `segments`) — plantait le
// composant au montage (ReferenceError), sans la moindre erreur de compilation.
function buildTemplateFromSegments(
  segments: { text: string; expr: string | null }[],
  externalVars: string[],
  moduleName: string | undefined
): string {
  let tpl = ''
  for (const s of segments) {
    // texte fixe : entités décodées comme le ferait le navigateur (cf. parseMixedString), un `${` du décodage reste du texte
    tpl += decodeHtmlEntities(s.text).replace(/[\\`]|\$(?=\{)/g, (c) => '\\' + c)
    if (s.expr !== null) tpl += `\${${cleanTemplateExpr(s.expr, externalVars, moduleName)}}`
  }
  return `\`${tpl}\``
}

// ============================================================================
// Interpolation : attr="prefix-{$expr}-suffix"
// ============================================================================
function interpolation(env: AttrCtx): AttrResult {
  const val = env.attr.val ?? ''
  const segments = splitBraceSegments(val)
  const expressions = segments.filter(s => s.expr !== null).map(s => s.expr!)

  const varSet = new Set<string>()
  for (const e of expressions) {
    for (const v of getEffectVars(e)) varSet.add(v)
  }
  const vars = Array.from(varSet)

  // Site EXPR (interpolation attr="pre-{$e}-post") — gabarit reconstruit depuis `segments`
  // (cf. `buildTemplateFromSegments`), PAS `parseMixedString` (utils.ts, sans garde sur une
  // accolade non fermée). Cas PUR (`{expr}` seul, rien autour) gardé en expression BRUTE,
  // jamais en gabarit : un attribut booléen (`disabled={$flag}`) doit rester un vrai booléen
  // pour `_mjs_updAttrNode`/`_mjs_updAttr`, pas la chaîne "true"/"false".
  const isPureExpr = expressions.length === 1 && segments.every(s => s.text === '')
  const jsTemplateStr = isPureExpr
    ? cleanTemplateExpr(expressions[0], env.compiler.externalVars, env.compiler.moduleName)
    : buildTemplateFromSegments(segments, env.compiler.externalVars, env.compiler.moduleName)

  const id = env.id ?? `a${++state.counter}`
  const attrName = env.attrName ?? ''
  // nom (et espace de noms) que le gabarit déclare et que la mise à jour retrouve (cf. adjustedAttr)
  const adj = adjustedAttr(env, attrName)
  const name = adj.name
  let attrStr = env.attrStr

  if (env.ctx.type === 'root') {
    const code = writeRootValue(env, 'this', id, adj, jsTemplateStr)
    pushUpdate(env, code, vars)
    attrStr += ` ${name}=''`
  } else if (env.ctx.type === 'for') {
    // SÉCURITÉ (XSS) — `href="{item.url}"` (interpolation QUOTÉE
    // dans un {for}, données d'item souvent distantes) émettait un `setAttribute`
    // BRUT contournant `µ._mjs_safeAttr` : `item.url = "javascript:…"` passait tel quel
    // (incohérent avec `href={item.url}` NON quoté, déjà filtré). On route par
    // `µ._mjs_updAttrNode` (comme root via `_mjs_updAttr`) → filtre javascript:/data:html.
    // La valeur vient d'un template literal (toujours string) → jamais false/null,
    // donc pas de removeAttribute intempestif ; `_mjs_safeAttr` re-diffe en interne.
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${writeValue(env, `_mjs_n${env.lid}`, adj, jsTemplateStr)}; } }`)
    // var externe interpolée dans la row (`title="v : {$prefix}"`) :
    // sans `structVars`, `_mjs_renderStruct` sauté → attribut figé à vie sur mutation.
    for (const v of vars) state.structVars.add(v)
    attrStr += ` ${name}=''`
  } else {
    // chemin CLONE/innerHTML (ctx ni root ni for) : le navigateur
    // DÉCODE les entités. On échappe l'apostrophe du TEXTE STATIQUE (qui fermerait
    // le quote) SANS toucher aux `${expr}` (JS injecté, dont les string literals
    // contiennent des apostrophes légitimes qu'un escape global corromprait).
    let jsValClone = ''
    // Site EXPR (interpolation, chemin clone/innerHTML) — mêmes `segments` que ci-dessus
    // (scan équilibré), plus le remplacement naïf par regex qui tronquait sur un `}`
    // littéral DANS la chaîne de l'expression.
    for (const s of segments) {
      jsValClone += s.text.replace(/'/g, '&#39;')
      if (s.expr !== null) jsValClone += `\${${cleanTemplateExpr(s.expr, env.compiler.externalVars, env.compiler.moduleName)}}`
    }
    attrStr += ` ${attrName}='${jsValClone}'`
    // la chaîne suit les variables qu'elle lit (cf. dynamic, branche {await}) ; le nœud est celui de `mjs-id`, posé par l'appelant
    trackInBranch(env, id, jsTemplateStr, `${writeValue(env, '_mjs_node', adj, jsTemplateStr)};`, vars)
  }

  return { id, attrStr }
}

// ============================================================================
// Bindings complexes (à porter)
// ============================================================================

import { dedent } from '../state.js'
import { EFFECTS, parseEffect, checkPlacement, checkLife, nearestEffect, effectSpec, projectEffect, nestedEffects, defaultSock, removedEffectError, type ParsedEffect } from '../../effects/catalog.js'

// ============================================================================
// ENREGISTREMENT DES ROUTES D'ÉVÉNEMENTS — point de passage UNIQUE
// ============================================================================
// BOGUE HISTORIQUE. Les quatre familles qui
// posent une route (directive `@événement`, liaison standard, liaison média,
// liaison de contenu) faisaient toutes `state.events[evt][id] = idx` — une
// ÉCRITURE. Or le couple (événement, nœud) est le MÊME pour une liaison
// `value=!{$x}` et une directive `@input={…}` posées sur le même élément :
// la seconde écrasait la première EN SILENCE, et le perdant dépendait de
// l'ordre des attributs dans le gabarit (`<input value=!{$x} @input={f()}>` →
// liaison morte ; directives écrites d'abord → handler de l'app mort). Même
// piège entre deux liaisons qui partagent un événement (`volume=!{}` et
// `muted=!{}` écoutent tous deux `volumechange`).
//
// Ici on EMPILE au lieu d'écraser : à la 2ᵉ route du couple, la valeur est
// promue en LISTE et le runtime (`_mjs_bindEvents`) les exécute TOUTES. Ordre
// garanti : liaisons d'abord, directives ensuite — la directive voit donc la
// variable déjà à jour. Le cas sans collision garde la forme courte (`idx`),
// donc aucune inflation du bundle sur la route ordinaire.
//
// Les drapeaux d'une route (`flags`) : 1, l'événement continue sa remontée ; 2, une seule fois ; 4, la liaison d'un champ (`value=!{…}`,
// `checked=!{…}`, `:group=!{…}`), que le cœur d'une appli rendue par le serveur appelle seule, sans événement, pour donner à sa variable ce
// qui a été tapé dans la page du serveur avant le démarrage (`<server-input>`, runtime/mjs_element.ts), posé seulement dans une
// construction qui peut rendre côté serveur (option `serverRendered`) ; le routeur ne lit que 1 et 2
function registerEventRoute(evt: string, id: string, idx: number, flags: number, kind: 'binding' | 'directive'): void {
  state.events ??= {}
  state.events[evt] ??= {}
  const map  = state.events[evt]
  const prev = map[id]
  const key  = `${evt} ${id}`

  if(prev === undefined) {
    map[id] = flags === 0 ? idx : [idx, flags]
    if(kind === 'binding') state.eventBindCount[key] = 1
    return
  }

  let list: [number, number][]
  if(typeof prev === 'number')    list = [[prev, 0]]
  else if(Array.isArray(prev[0])) list = prev as [number, number][]
  else                            list = [prev as [number, number]]

  if(kind === 'binding') {
    const at = state.eventBindCount[key] ?? 0
    list.splice(at, 0, [idx, flags])          // les liaisons restent groupées en tête
    state.eventBindCount[key] = at + 1
  }
  else list.push([idx, flags])

  map[id] = list
}

// ============================================================================
// EventListener — port de attributes/event_listener.rb
// @click, @input, @change, @keydown, etc.
// Modificateurs : .prevent / .stop / .self / .once / .propagate
// Sucre d'émission sur le geste : @click.emit.NOM (charge utile via ={expr})
// ============================================================================
/** Suffixes `.mot` reconnus après le nom de l'événement. `emit` n'y est PAS :
 * ce n'est pas un modificateur de dispatch mais l'ouverture du sucre
 * d'émission, qui consomme le segment SUIVANT (le nom émis) — cette liste ne
 * sert qu'à la garde anti-faute-de-frappe juste en dessous. */
const EVENT_MODIFIERS = ['prevent', 'stop', 'self', 'once', 'propagate']

/** Nom émissible : identifiant, tirets et deux-points admis (`row-selected`,
 * `mjs:done`) ; JAMAIS de point (c'est le séparateur de segments) ni
 * d'apostrophe (le nom est injecté dans une chaîne simple-quote). */
const EMIT_NAME_RE = /^[A-Za-z_][\w:-]*$/

function eventListener(env: AttrCtx): AttrResult {
  const id = env.id ?? `e${++state.counter}`
  const attrName = env.attrName ?? ''
  const parts = attrName.slice(1).split('.')
  const evt = parts.shift()!

  // `@click.emit.NOM` — « au geste, émets ». Le
  // handler ne fait QUE `µemit 'NOM', <charge>` ; la charge utile vient de
  // `={expr}` (absente → `null` côté runtime). `emit.NOM` CLÔT le nom
  // d'attribut : les modificateurs de dispatch se posent AVANT
  // (`@click.stop.emit.save`), pour que le nom émis se lise toujours en
  // dernier. En aval, RIEN de spécifique : le corps synthétisé emprunte le
  // chemin commun des handlers inline (reconstruction `{for}`, cleanJs, puis
  // sucre `µemit` → `_mjsThis._mjs_emit` dans applyMjsSugarToScript).
  let emitName: string | null = null
  const emitAt = parts.indexOf('emit')
  if (emitAt >= 0) {
    emitName = parts[emitAt + 1] ?? ''
    if (emitAt !== parts.length - 2 || !EMIT_NAME_RE.test(emitName)) {
      throw new Error(t('generator.event-emit-shape', { attrName, evt }))
    }
    parts.splice(emitAt, 2)
  }

  // GARDE MODIFICATEUR INCONNU — la liste des
  // suffixes était consultée par INCLUSION (`parts.includes('stop')`) : un
  // `@click.stopp`, `@click.prevnet`, `@click.emit` compilait en VERT et ne
  // faisait rien, sans un mot. Même famille qu'un `@emit.` mal formé, qui lève
  // déjà : on refuse à la compilation, avec la suggestion quand la faute est à
  // distance ≤2 d'un modificateur réel.
  for (const mod of parts) {
    if (EVENT_MODIFIERS.includes(mod)) continue
    const suggestion = suggestKey(mod, [...EVENT_MODIFIERS, 'emit'])
    const hint = suggestion && suggestion !== mod ? t('generator.hint-modifier-suggestion', { suggestion }) : ''
    throw new Error(t('generator.event-modifier-unknown', { attrName, mod, hint }))
  }

  let modCoffee = ''
  if (parts.includes('prevent')) modCoffee += '  e.preventDefault()\n'
  // `.stop` : stopPropagation() suffit en MJS (un seul handler par nœud/event
  // + un seul routeur → pas de listeners voisins à couper, donc pas besoin de
  // stopImmediatePropagation). Il pose `e.cancelBubble` que le routeur lit
  // pour arrêter sa remontée.
  if (parts.includes('stop'))    modCoffee += '  e.stopPropagation()\n'
  if (parts.includes('self'))    modCoffee += '  return if e.target != el\n'

  // `dedent()` AVANT `.trim()`, jamais l'inverse — un corps multi-lignes (`@click={\n  a\n  b\n}`)
  // dont on tronquerait le `\n` de tête par un `.trim()` NU perd le retrait commun : la 1re
  // ligne retombe seule à la colonne 0 (le `\n` qui portait SON indentation part avec), les
  // suivantes gardent la leur — Civet/Coffee (sensible à l'indentation) lit alors une ligne
  // sœur comme un ARGUMENT de la précédente (`a\nb` à 0/2 devient `a(b)`). `dedent()` sur le
  // corps BRUT calcule le retrait commun sur TOUTES les lignes avant qu'aucun trim ne les
  // déséquilibre ; le `.trim()` final ne retire plus que les lignes vides de tête/fin.
  let rawContent: string
  // le gestionnaire tel qu'écrit dans le fichier, retrait compris : la place d'une vraie faute de syntaxe y est retrouvée (cleanJs)
  let written: string | undefined
  // forme nue sans fonction du même nom (cf. plus bas)
  let bare = false
  if (emitName !== null) {
    // La valeur d'attribut est la CHARGE UTILE — une expression, comme partout
    // ailleurs dans le framework ; le nom, lui, est porté par l'attribut.
    const payload = env.attr.expr != null
      ? dedent(env.attr.expr.toString()).trim()
      : (env.attr.val != null && env.attr.val !== '')
        ? dedent(env.attr.val.toString().replace(/^\{/, '').replace(/\}$/, '')).trim()
        : ''
    rawContent = payload ? `µemit '${emitName}', ${payload}` : `µemit '${emitName}'`
  } else if (env.attr.expr != null) {
    written    = env.attr.expr.toString()
    rawContent = dedent(alignsOnFirstLine(written)).trim()
  } else if (env.attr.val != null && env.attr.val !== '') {
    written    = env.attr.val.toString().replace(/^\{/, '').replace(/\}$/, '')
    rawContent = dedent(alignsOnFirstLine(written)).trim()
  } else {
    // forme ABRÉGÉE refusée sur un nom d'événement
    // À DEUX-POINTS (`<div @mjs:done>`) : elle synthétise ici un appel à la
    // méthode HOMONYME (`mjs:done(e, el)`), que Civet compile SANS BRONCHER en
    // bare-hash (`{mjs: done(e, el)}`) — un objet jeté à la poubelle, un appel
    // vers une fonction globale `done` qui n'existe pas, et pas la moindre
    // erreur. Même famille que le piège Civet des accolades : ça ne plante pas,
    // ça ment. La forme explicite `@mjs:done={…}`, elle, a toujours été
    // correcte sur ce chemin (table d'événements `{"mjs:done": …}` intacte) —
    // c'est le chemin des macros globales qui la ratait, cf. macros.ts.
    if (evt.includes(':')) throw new Error(t('generator.event-colon-shorthand', { evt }))
    rawContent = `${evt}(e, el)`
    // forme nue : la fonction du même nom que fournit le <script>, le <script module>, un import ou le gabarit, sinon la méthode
    // `@evt` du composant, appelée comme `@click=@evt`, avec l'événement puis l'élément ; relevée pour le refus quand le composant
    // n'a pas non plus la méthode (checkHandlerReferences, transpiler/lint.ts). Sans la liste des noms du composant (compilation
    // partielle), la fonction reste appelée
    bare = state.handlerScope !== null && !state.handlerScope.has(evt) && env.ctx.locals?.has(evt) !== true && env.compiler.externalVars?.includes(evt) !== true
    if (bare) rawContent = `@${evt}(e, el)`
  }

  // référence faite d'un nom seul, avec ou sans accolades (`@click=nom`, `@click={nom}`, `@click=@nom`) : le transpileur refuse un nom qui
  // n'existe pas (cf. checkHandlerReferences, transpiler/lint.ts) ; un nom que le gabarit met ici en portée (variable et indice d'un `{for}`,
  // valeur d'un `{await}`, `{const}`) ou que le transpileur connaît déjà n'est pas relevé. Une fonction du navigateur que ni le <script> ni
  // un import ne fournit (`@click=alert`) est appelée ici, sans la balise pour `this` : rendue au runtime, elle serait appelée avec la balise
  // pour `this` et lèverait « Illegal invocation ». Celles qui lèvent quand elles reçoivent l'événement sont relevées, pour être refusées
  const valued    = emitName === null && (env.attr.expr != null || (env.attr.val != null && env.attr.val !== ''))
  const reference = valued ? HANDLER_REFERENCE_RE.exec(rawContent) : null
  const template  = reference !== null && env.ctx.locals?.has(reference[2]) === true
  const local     = reference !== null && reference[1] === '' && (template || env.compiler.externalVars?.includes(reference[2]))
  if (reference && reference[1] === '' && !local && state.handlerScope && !state.handlerScope.has(reference[2]) && BROWSER_FUNCTIONS.has(reference[2]) && !BROWSER_FUNCTIONS_REFUSING_EVENT.has(reference[2])) {
    rawContent = `${reference[2]}(e, el)`
  }
  // relevée une fois (la pré-passe du générateur parcourt le gabarit avant la vraie passe, cf. compile) ; un nom du gabarit écrit
  // avec `@` (`{for f in $fs}…@click=@f`) garde sa portée, pour que le message propose `@click=f`
  else if (reference && !local && !state.isPrePass) {
    state.handlerRefs.push({ name: reference[2], method: reference[1] === '@', attr: attrName.startsWith('@') ? attrName : `@${attrName}`, braces: env.attr.expr != null || String(env.attr.val ?? '').trimStart().startsWith('{'), line: env.attr.line ?? env.node.line, ...(template ? { scope: [reference[2]] } : {}) })
  }

  // forme nue appelée comme une méthode : relevée une fois, comme `@click=@nom`
  if (bare && !state.isPrePass) state.handlerRefs.push({ name: evt, method: true, bare: true, attr: attrName.startsWith('@') ? attrName : `@${attrName}`, braces: false, line: env.attr.line ?? env.node.line })

  // en Civet, les accolades derrière une flèche sont un bloc, jamais un objet (cf. blockArrowBody)
  // le texte écrit, seulement s'il est celui que l'on compile : un code que la construction fabrique (un nom seul devenu appel) garde
  // les refus qui le suivent
  // une vraie faute de syntaxe du texte écrit : gardée avec le gestionnaire (pushInline), le transpileur la dit après les refus qui la
  // précèdent (nom seul)
  let writtenFault: Error | null = null
  let codeJs: string
  try {
    codeJs = cleanJsHandler(rawContent, env.compiler.externalVars, env.compiler.moduleName, written !== undefined && dedent(alignsOnFirstLine(written)).trim() === rawContent ? written : undefined, env.attr.line ?? env.node.line, env.compiler.scriptLang)
  }
  catch (err: any) {
    if (typeof err?.renderedText !== 'string') throw err
    codeJs       = err.renderedText
    writtenFault = err
  }
  const cleanedJs = blockArrowBody(codeJs)
  const idx = state.inlines.length

  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre ; `racines` : variable de l'état dont
  // chaque élément de boucle est une partie (`$.l`, ou celle de la boucle qui l'entoure, `row.cells`)
  const roots = new Map<string, string>()
  // boucle la plus intérieure en portée : celle dont la ligne porte la balise du gestionnaire, et dont l'entrée y est notée (`_mjs_ev`)
  const scopeLoops        = (env.ctx.scope ?? env.ctx.loops.map((loop: any) => ({ kind: 'for' as const, loop }))).filter((e: any) => e.kind === 'for')
  const inner             = scopeLoops.length ? (scopeLoops[scopeLoops.length - 1] as any).loop : null
  const reconstructCoffee = scopeSkeleton(env, cleanedJs, (l, readAfter) => {
    const d = l.depth
    const item = l.item
    const idxVar = l.index
    const iterable = l.iterable
    // Optim #8 — Lit la prop JS `_mjs_idx_N` (posée par compile.ts) au lieu
    // de `getAttribute('data-mjs-idx-N')`. Évite la traversée du DOM attrs.
    // Fallback `?` au cas où la prop n'est pas encore posée (cloneNode initial).
    // Harmonisation Civet — seul point de divergence Coffee/Civet du
    // squelette : l'existentiel binaire Coffee `a ? b` (sans `:`) n'existe
    // pas en Civet (« Failed to parse ») ; Civet exprime le même repli
    // via `??`, que CoffeeScript ne connaît PAS (« unexpected ? »).
    // L'élément se relit dans la collection : position d'un tableau, clé d'un objet, position parmi les éléments d'un Set ou d'une Map (cf.
    // loopBindingLine) — cette conversion seulement quand l'élément est lu : par le gestionnaire, par l'itérable d'une boucle
    // intérieure ou par un `{const}` recréé après la boucle (textReadAfter)
    // ligne pure d'un `{for}` de racine (cf. LoopInfo.byEntry) : l'élément et l'indice se lisent sur l'entrée de la ligne, que la
    // réconciliation tient à jour même quand elle saute la ligne (`_mjs_it`, `_mjs_ix`) ; la balise y mène par `_mjs_ev` (posé par le
    // gabarit de la ligne). Le temporaire garde le nom du squelette, que le contrôle des constantes reconnaît (cf. const-reassign.ts)
    const read = new RegExp(`(?<![\\w$.])${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(readAfter)
    // élément ÉCRIT par le gestionnaire (cf. elementWritten) d'une liste nommée par un chemin (`$.l`, `$.o.items`, `row.cells`) : la liste
    // relue sous `_mjs_rl_N` donne à l'écriture son chemin compilé, l'indice compris, vérifié par identité (cf. path-tracker.ts)
    const isReread = read && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(iterable.trim()) && elementWritten(item, readAfter) ? `  _mjs_rl_${d} = ${iterable}\n` : ''
    // réglage `proxy: false` : élément ÉCRIT d'une liste calculée (`$.l.filter(f)`), sans chemin ni indice dans la liste de l'état —
    // l'écriture n'est pas vue, le transpileur avertit (cf. GeneratorState.loopNotice)
    const head = LOOP_HEAD.exec(iterable.trim())
    const root = head ? (head[1] === '$' ? head[2] : roots.get(head[1])) : undefined
    if (root) roots.set(item, root)
    // réglage `proxy: false` : liste calculée qui garde les objets d'une liste nommée par un chemin (cf. viewPath) — la liste relue sous
    // `_mjs_rl_N`, l'élément retrouvé dans elle par son identité sous `_mjs_rj_N` : l'écriture a son chemin compilé, vérifié par la même
    // garde (cf. path-tracker.ts) ; une autre liste calculée avertit, comme un gestionnaire qui attend (`await`) : l'indice retrouvé avant
    // l'attente ne suit pas la liste changée pendant elle
    const view   = state.withoutProxy && !isReread && read && elementWritten(item, readAfter) && !/(?<![\w$.])(?:await|yield)(?![\w$])/.test(readAfter) ? viewPath(iterable.trim()) : null
    const reread = view ? `  _mjs_rl_${d} = ${view}\n  _mjs_rj_${d} = Array.prototype.indexOf.call(_mjs_rl_${d}, ${item})\n` : isReread
    if (state.withoutProxy && root && !reread && read && elementWritten(item, readAfter)) state.loopNotice.push({ inline: idx, name: item, root: '$' + root })
    if (l.byEntry) {
      // itérable lu dans le magasin et élément lu : l'élément se relit dans l'itérable, à l'indice de l'entrée, comme hors d'une ligne
      // pure — une écriture par lui (`t.fait = v`, `t.n++`, `t.tags.push(x)`) passe ainsi par l'aide du magasin, sous la règle du
      // champ, et prévient la clé (cf. path-tracker.ts)
      if (read && /µ\.store\b/.test(iterable)) {
        return `  _mjs_ri_${d} = el._mjs_ev._mjs_ent._mjs_ix\n` +
          `  _mjs_ra_${d} = ${iterable}\n` +
          `  _mjs_ra_${d} = Array.from(_mjs_ra_${d}) if _mjs_ra_${d} instanceof Map or _mjs_ra_${d} instanceof Set\n` +
          `  ${item} = _mjs_ra_${d}[_mjs_ri_${d}]\n` +
          `  ${idxVar} = _mjs_ri_${d}\n`
      }
      return `  _mjs_ra_${d} = el._mjs_ev._mjs_ent\n` +
        `  ${item} = _mjs_ra_${d}._mjs_it\n` +
        `  ${idxVar} = _mjs_ra_${d}._mjs_ix\n` + reread
    }
    return `  _mjs_ri_${d} = el._mjs_idx_${d} ?? el.getAttribute('data-mjs-idx-${d}')\n` +
      `  _mjs_ra_${d} = ${iterable}\n` +
      (read ? `  _mjs_ra_${d} = Array.from(_mjs_ra_${d}) if _mjs_ra_${d} instanceof Map or _mjs_ra_${d} instanceof Set\n` : '') +
      `  _mjs_ri_${d} = +_mjs_ri_${d} if Array.isArray(_mjs_ra_${d})\n` +
      (read && l === inner && !env.ctx.inBlock ? inline(d, item) : read && /^[A-Za-z_$][\w$]*$/.test(item) ? outerInline(d, item) : `  ${item} = _mjs_ra_${d}[_mjs_ri_${d}]\n`) +
      `  ${idxVar} = _mjs_ri_${d}\n` + reread
  })

  const userCode = dedent(cleanedJs).split('\n').map(l => `  ${l}`).join('\n')
  pushInline(env, `(e, el) =>\n${modCoffee}${reconstructCoffee}${userCode}`, writtenFault)

  // Auto-passive : pour touchstart/touchmove/wheel, le listener délégué est
  // enregistré `passive` par défaut (scroll fluide). On note ici si un handler
  // de ce type appelle preventDefault (modifier `.prevent` OU appel direct
  // dans le corps) — auquel cas le runtime bascule ce type en non-passif.
  if (PASSIVE_EVENTS.has(evt) &&
      (parts.includes('prevent') || /\bpreventDefault\b/.test(rawContent))) {
    state.eventsWithPrevent.add(evt)
  }

  // Mode délégation : UN seul listener au niveau du composant, routage par
  // remontée `parentNode` (cf. runtime `_mjs_bindEvents`). Par défaut le routeur
  // s'arrête au premier NŒUD porteur (le plus proche).
  //
  // Valeur de route : cf. `registerEventRoute` ci-dessus — `idx` pour un
  // handler simple, `[idx, flags]` avec modificateur de routage (bit 0
  // `.propagate`, bit 1 `.once`), liste si le couple porte déjà une liaison.
  // Aucun listener natif séparé : un seul listener, ça marche aussi pour les
  // events non-bubbling.
  let flags = 0
  if (parts.includes('propagate')) flags |= 1
  if (parts.includes('once'))      flags |= 2
  registerEventRoute(evt, id, idx, flags, 'directive')

  return { id }
}

/** Événements pour lesquels le listener délégué peut être `passive` (scroll
 * fluide). Voir `eventsWithPrevent` dans CompilerState. */
const PASSIVE_EVENTS = new Set(['touchstart', 'touchmove', 'wheel'])

// ============================================================================
// BindingStandard — port de attributes/binding_standard.rb
// Two-way binding via !{$var} : value=!{$x}, checked=!{$ok}, foo=!{$bar}
// Cast suffixes : .number, .int, .float, .string, .bool
// ============================================================================
// Cast de type porté par le NOM de l'attribut (`value.number=!{$n}`) — mêmes
// suffixes sur une balise native et sur un composant, et surtout même SENS
// d'application : uniquement à la remontée (DOM ou enfant → modèle). Le sens
// descendant ne convertit jamais, la valeur vient du modèle et est déjà typée.
const CAST_RE = /\.(number|int|float|string|bool|boolean)$/

function splitCast(attr: string): { base: string; cast?: string } {
  const m = attr.match(CAST_RE)
  return m ? { base: attr.slice(0, -m[0].length), cast: m[1] } : { base: attr }
}

// grammaire du corps des inlines = celle du template (Civet, repli Coffee) :
// `is`/`or` sont valides dans les deux
function castExprFor(cast: string | undefined, raw: string): string {
  switch (cast) {
    case 'number': return `Number(${raw})`
    case 'int':    return `parseInt(${raw}, 10)`
    case 'float':  return `parseFloat(${raw})`
    case 'string': return `String(${raw})`
    case 'bool': case 'boolean':
      return `(${raw} is true or ${raw} is 'true' or ${raw} is '1' or ${raw} is 1)`
    default: return raw
  }
}

/** Un <input> qui peut tenir un nombre : son `type` est écrit « number », ou donné par une variable. Lui seul a un
 * état de saisie invalide (« - », « 1. » : `validity.badInput`) et un nombre à lire dans un champ vidé. */
function numberFieldPossible(node: Node): boolean {
  if ((node.name ?? '').toLowerCase() !== 'input') return false
  const type = node.attrs.find(a => a.name === 'type')
  if (!type) return false
  if (type.type === 'dynamic') return true
  return /^\s*number\s*$|[{$]/i.test(type.val ?? '')
}

function bindingStandard(env: AttrCtx): AttrResult {
  const m = env.rawVal.match(/^!\{(.+)\}$/)
  if (!m) throw new Error(`[binding_standard] expected !{...} pattern, got "${env.rawVal}"`)
  const varExpr = m[1]
  const jsVar = cleanJs(varExpr, env.compiler.externalVars, false, env.compiler.moduleName)

  const vars = getEffectVars(varExpr)

  const id = env.id ?? `b${++state.counter}`
  // `env.attrName` peut
  // arriver ICI encore préfixé `@` (`<details @open=!{$x}>` : la règle
  // générale « !{…} → binding_standard », plus haut dans le dispatch, route
  // ICI n'importe quel attribut two-way bien formé SANS jamais retirer un
  // éventuel `@` — le `@` n'est JAMAIS une partie réelle d'un nom d'attribut
  // HTML, seulement la convention MJS. Sans ce retrait, le code généré
  // ciblait littéralement l'attribut `"@open"` (`node.setAttribute('@open',
  // …)`) au lieu du VRAI attribut `"open"` — le `<details>` ne s'ouvrait/
  // fermait JAMAIS réellement en fonction de la variable liée.
  const rawAttr = (env.attrName ?? '').replace(/^@/, '')
  const { base: baseAttr, cast } = splitCast(rawAttr)

  // champ nombre qu'on vide (« 5 », Retour arrière) : le champ vide se lit 0, que la liaison réécrirait dans le champ à la place
  // de la frappe — « 0 » empêchait de l'effacer pour taper un autre nombre. Tant que le champ a le focus et reste vide, ce 0 du
  // modèle n'y est pas réécrit ; une autre valeur, ou le champ qui n'a plus le focus, le remplace comme avant
  const emptiableNumber = baseAttr === 'value' && (env.node.name ?? '').toLowerCase() === 'input' && (cast === 'number' || (!cast && numberFieldPossible(env.node)))
  const emptyInProgress = emptiableNumber ? ` && !(_mjs_node.value === '' && _mjs_bv === 0 && _mjs_node.getRootNode().activeElement === _mjs_node)` : ''

  // <select> lié à une variable typée, celle du garde d'office (le parseur marque sa liaison) : sans types, le code d'une liste reste
  // le même
  const typed = baseAttr === 'value' && (env.node.name ?? '').toLowerCase() === 'select' && ((env.node as { attrs?: Array<{ name?: string, typed?: boolean }> }).attrs ?? []).some(a => a.name === 'value' && a.typed === true)

  let updateLogic: string
  if (baseAttr === 'value' && (env.node.name ?? '').toLowerCase() === 'select') {
    // <select> : l'aide du runtime choisit les options (un tableau pour `multiple`) et réapplique la valeur quand elles
    // changent (options chargées ensuite) ; variable vide (`null`) : rien de choisi. Variable typée : µ._mjs_tsel (mjs_types.ts),
    // où un nombre sans option de son texte exact choisit celle qui l'écrit autrement (`01`), dans une liste simple ou à choix multiples
    updateLogic = `${typed ? 'µ._mjs_tsel' : 'µ._mjs_selVal'}(_mjs_node, ${jsVar} == null ? '' : ${jsVar});`
  } else if (baseAttr === 'value') {
    updateLogic = `if (_mjs_node.type === 'select-multiple') { ` +
      `const _mjs_arr = Array.isArray(${jsVar}) ? ${jsVar}.map(String) : []; ` +
      `Array.from(_mjs_node.options).forEach(_mjs_opt => _mjs_opt.selected = _mjs_arr.includes(_mjs_opt.value)); ` +
      // variable vide (jamais écrite, `null`) : champ vide — `node.value = undefined` écrirait la
      // chaîne « undefined » dans le champ
      `} else { const _mjs_bv = ${jsVar} == null ? '' : ${jsVar}; if (_mjs_node.value !== _mjs_bv${emptyInProgress}) { _mjs_node.value = _mjs_bv; } }`
  } else if (baseAttr === 'checked') {
    updateLogic = `if (_mjs_node.checked !== !!${jsVar}) { _mjs_node.checked = !!${jsVar}; }`
  } else if (MJS_BOOLEAN_PROPS.includes(baseAttr)) {
    // même piège
    // que le défaut historique « booléens jamais retirés » (cf.
    // `_mjs_updAttrNode`) : `setAttribute('open', false)` écrit la CHAÎNE
    // "false", que le navigateur traite comme PRÉSENTE = toujours ouvert.
    // Seule la PROPRIÉTÉ DOM native (`node.open = false`) retire vraiment
    // l'attribut. `checked`/`value` avaient déjà leur cas dédié ci-dessus ;
    // généralisé ici à TOUS les autres booléens connus (`open`, `disabled`,
    // `selected`, `hidden`, `multiple`, `required`, `readonly`, etc.).
    // la réflexion IDL native (`node.open = false` →
    // attribut retiré tout seul) n'existe QUE sur les tags qui portent
    // nativement cette propriété (`<details>` pour `open`, `<button>`/
    // `<input>` pour `disabled`…) : sur un `<div>`/composant custom,
    // l'assignation crée une simple propriété expando, l'attribut reste posé.
    // `_mjs_idl` se capture AVANT l'assignation (qui créerait sinon elle-même
    // la propriété expando et fausserait le test) ; retrait/pose explicites
    // en secours, sans effet sur un tag qui a déjà la réflexion native. Testé
    // sur le PROTOTYPE (`Object.getPrototypeOf(node)`), pas sur `node` lui-même :
    // cet `updateLogic` retourne à CHAQUE effet (mount ET chaque mutation) — sur
    // l'instance, la toute 1ère assignation crée déjà l'expando, `baseAttr in node`
    // vaudrait alors TOUJOURS vrai dès le 2e passage, sur `<div>` comme sur
    // `<button>` (faux négatif qui bloque définitivement le `setAttribute` de
    // secours). Le prototype (`HTMLButtonElement.prototype`/`HTMLDivElement.prototype`)
    // ne reçoit jamais d'expando d'instance : le test reste stable dans le temps.
    updateLogic = `const _mjs_idl = '${baseAttr}' in Object.getPrototypeOf(_mjs_node); if (_mjs_node.${baseAttr} !== !!${jsVar}) { _mjs_node.${baseAttr} = !!${jsVar}; } if (!(${jsVar})) { _mjs_node.removeAttribute('${baseAttr}'); } else if (!_mjs_idl) { _mjs_node.setAttribute('${baseAttr}', ''); }`
  } else {
    // même écriture que la liaison à sens unique : filtre des adresses (`javascript:`…), retrait sur false, null et undefined
    updateLogic = `µ._mjs_updAttrNode(_mjs_node, '${baseAttr}', ${jsVar}${safeAttrFlag(baseAttr)});`
  }

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogic} } }`)
    // #5 — un two-way binding dans un {for} vit dans la closure de l'updateFn
    // de ligne, qui ne re-tourne QUE si la loop se reconcilie. Sans ça, muter
    // une var EXTERNE du binding (ex. `@group=!{$choix}` partagé par les
    // lignes, idiome Svelte 6-5) ne met jamais à jour le widget (sens
    // modèle→DOM perdu). On marque ces vars comme structurelles → leur mutation
    // rejoue _mjs_updFor (reconcile), qui ré-applique l'updateFn. `vars` ne
    // contient que les state vars EXTERNES (la variable d'itération n'en est
    // pas une, ni les `item.field`) → select1k (filtered @class) préservé.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await} ; un
    // {if}/{key} imbriqué DEDANS hérite ce ctx.type, transparent pour lui) :
    // seule l'écoute DOM→modèle était câblée plus bas,
    // la lecture modèle→DOM n'était JAMAIS émise — `<input value=!{$v}>` y
    // restait vide, `<select value=!{$v}>` figé sur la 1re option. Même trou
    // que le cas dynamic()/`$var` nu, remède en 2 volets :
    //  (a) pose INITIALE dans `__nodes` — ce code tourne DANS la createFn de
    //      la branche, AVANT que `_mjs_updIf` (mjs_element.ts) ne fusionne les
    //      refs dans `this._mjs_nodes` (encore vide à cet instant).
    //  (b) réactivité ULTÉRIEURE — `_mjs_updAwait` est idempotent (skip si
    //      promesse ET statut inchangés) : `_mjs_renderStruct` ne rejoue donc
    //      JAMAIS le contenu d'une branche déjà réglée. Sans ce volet, `$v`
    //      muté après coup (hors nouveau règlement de la promesse) resterait
    //      sans effet. Même mécanisme que root (`registerEffect` +
    //      `this._mjs_nodes`) — sûr : (a) a toujours fini de tourner avant que
    //      quiconque puisse muter `$v`.
    const initCode = `{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`
    // <select> : la pose doit attendre les <option> d'un {for} imbriqué —
    // même besoin que `postUpdates` (paths.ts), mais pour du code émis
    // ICI, jamais vu par son parseur HTML. Sentinelle consommée par
    // `splitDeferredUpdates` (compile.ts) : réordonnée après
    // `branchUpdates`+`postUpdates`, jamais dupliquée.
    const isSelectValue = baseAttr === 'value' && (env.node.name ?? '').toLowerCase() === 'select'
    env.ctx.updates.push(isSelectValue ? SELECT_VALUE_DEFER_PREFIX + initCode : initCode)
    const reactiveCode = rootBindingEffect(env, id, jsVar, updateLogic)
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    registerEffect(reactiveCode, [...new Set([...vars, ...constVars(env, jsVar)])])
  }

  // `open`
  // (`<details>`) ne déclenche NI 'input' NI 'change' quand l'utilisateur
  // clique sur `<summary>` pour ouvrir/fermer — l'événement natif s'appelle
  // 'toggle'. Sans ce cas, le sens DOM→modèle du two-way (`@open=!{$x}`)
  // n'écoutait tout simplement JAMAIS le bon événement — un clic utilisateur
  // ouvrait bien le `<details>` (natif, indépendant de MJS) mais `$x` ne se
  // mettait jamais à jour en retour (moitié du two-way silencieusement morte).
  const evtType = baseAttr === 'checked' ? 'change' : baseAttr === 'open' ? 'toggle' : 'input'

  const castExpr = (raw: string): string => castExprFor(cast, raw)

  let valExtractor: string
  if (baseAttr === 'value') {
    const autoNum = cast ? 'false' : "['number', 'range'].includes(_mjs_el.type)"
    // liste à choix multiples liée à une variable (`$x`, `$$x`) de règle de liste qui accepte null (`string[] | null`) : aucun choix
    // vaut null, comme le champ de liste vide d'un formulaire jugé par µrules (µ._mjs_tlist, mjs_types.ts) ; liste simple : son option
    // vide vaut null quand la règle refuse le texte vide mais accepte null (`int 1..12 | null`, µ._mjs_tnul) ; variable typée seulement,
    // celle du garde d'office (le parseur marque sa liaison) : sans types, le code d'une liste reste le même
    const bare    = typed ? varExpr.trim().match(/^(\$\$?)([A-Za-z_]\w*)$/) : null
    const rule    = bare ? (bare[1] === '$$' ? `µ._mjs_storeRules?.${bare[2]}` : `_mjsThis._mjs_types?.${bare[2]}`) : ''
    const choices = 'Array.from(_mjs_el.selectedOptions).map((_mjs_opt) => _mjs_opt.value)'
    const multi   = rule ? `(if _mjs_el.selectedOptions.length == 0 and µ._mjs_tlist and µ._mjs_tlist(${rule}) > 1 then null else ${choices})` : choices
    const one     = rule ? `(if _mjs_el.value == '' and µ._mjs_tnul and µ._mjs_tnul(${rule}) then null else ${castExpr('_mjs_el.value')})` : castExpr('_mjs_el.value')
    valExtractor = `if _mjs_el.type == 'select-multiple' then ${multi} else (if ${autoNum} then Number(_mjs_el.value) else ${one})`
  } else if (baseAttr === 'checked') {
    valExtractor = '_mjs_el.checked'
  } else if (MJS_BOOLEAN_PROPS.includes(baseAttr)) {
    // même
    // raisonnement que `checked` : `_mjs_el.getAttribute('open')` renvoie `''`
    // (chaîne, PAS un booléen) quand présent — `$x` se serait retrouvé à `''`
    // au lieu de `true` après un toggle, une valeur "vraie" mais TYPÉE
    // différemment de ce que le modèle attend (incohérence silencieuse).
    // La PROPRIÉTÉ DOM (`_mjs_el.open`) renvoie un booléen natif propre.
    valExtractor = `_mjs_el.${baseAttr}`
  } else {
    valExtractor = castExpr(`_mjs_el.getAttribute('${baseAttr}')`)
  }

  let attrStr = env.attrStr
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    // props posées par l'updateFn (toutes les loops, plus seulement la
    // première) ; l'attrPart interpolé n'est conservé que sans lid (jamais en
    // pratique pour un binding two-way).
    const propPosed = pushIdxPropUpdates(env)
    for (let i = 0; i < env.ctx.loops.length; i++) {
      const l = env.ctx.loops[i]
      const d = l.depth
      if (!propPosed) {
        const attrPart = ` data-mjs-idx-${d}='\${${l.index}}'`
        if (!attrStr.includes(attrPart)) attrStr += attrPart
      }
    }
  }
  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre
  const reconstructCoffee = scopeSkeleton(env, jsVar, loopBindingLine)

  const idx = state.inlines.length
  let inlineBody = `  return if _mjs_el and _mjs_el != _mjs_e.target\n`
  // champ nombre au pas incomplet (« 1. », « - », « 1e ») : le navigateur ne rend pas de valeur (`value` vaut '',
  // `badInput` est vrai) — la convertir (0, NaN) puis la réécrire dans le champ effaçait la frappe, le pas est ignoré
  // la variable (nom simple `$n`) retient le champ refusé : une écriture du code à valeur identique, qui ne déclenche aucun
  // effet, le remplace alors (`_set`, mjs_element.ts), sauf s'il a le focus
  const plainVar = baseAttr === 'value' && numberFieldPossible(env.node) ? varExpr.trim().match(/^\$(\w+)$/) : null
  if (plainVar) inlineBody += `  return µ._mjs_refuse(_mjsThis, '${plainVar[1]}', _mjs_el) if _mjs_el.type == 'number' and _mjs_el.validity?.badInput\n`
  else if (baseAttr === 'value') inlineBody += `  return if _mjs_el.type == 'number' and _mjs_el.validity?.badInput\n`
  inlineBody += reconstructCoffee
  // lu en nombre (`.number`, `.int`, `.float`) : un texte qui n'en est pas un (« . », « - », « abc ») ne donne pas NaN, ni au
  // modèle ni, par la réécriture du champ, à l'écran — la frappe reste telle quelle
  if (baseAttr === 'value' && (cast === 'number' || cast === 'int' || cast === 'float')) {
    inlineBody += `  _mjs_val = ${valExtractor}\n  return if Number.isNaN(_mjs_val)\n  ${jsVar} = _mjs_val\n`
  }
  else inlineBody += `  ${jsVar} = ${valExtractor}\n`
  pushInline(env, `(_mjs_e, _mjs_el) =>\n${inlineBody}`)

  registerEventRoute(evtType, id, idx, state.serverRendered && (baseAttr === 'value' || baseAttr === 'checked') ? 4 : 0, 'binding')

  attrStr += ` ${baseAttr}=''`
  return { id, attrStr }
}
// ============================================================================
// BindingDimensions — port de attributes/binding_dimensions.rb
// clientWidth/Height etc. avec ResizeObserver
// ============================================================================
function bindingDimensions(env: AttrCtx): AttrResult {
  const attrName = env.attrName ?? ''
  const m = env.rawVal.match(/^!\{(.+)\}$/)
  if (!m) return { id: env.id }
  const varExpr = m[1]
  const jsVar = cleanJs(varExpr, env.compiler.externalVars, false, env.compiler.moduleName)
  const id = env.id ?? `d${++state.counter}`

  let attrStr = env.attrStr
  let reconstructJs = ''
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    const propPosed = pushIdxPropUpdates(env)
    // un nom déjà déclaré par une boucle englobante (l'`index` par défaut de deux boucles imbriquées) est réaffecté, jamais redéclaré :
    // un second `let index` dans le même bloc empêchait le composant de se construire
    const declares = new Set<string>()
    const set      = (name: string, value: string): string => {
      const decl = declares.has(name) ? '' : 'let '
      declares.add(name)
      return `${decl}${name} = ${value}; `
    }
    for (const l of env.ctx.loops) {
      const d = l.depth
      if (!propPosed) {
        const attrPart = ` data-mjs-idx-${d}='\${${l.index}}'`
        if (!attrStr.includes(attrPart)) attrStr += attrPart
      }
      // Optim #8 — Read direct via prop JS, fallback getAttribute. L'élément se relit dans la collection : position d'un tableau, clé d'un objet
      reconstructJs += `const _mjs_ri_${d} = _mjs_t._mjs_idx_${d} != null ? _mjs_t._mjs_idx_${d} : _mjs_t.getAttribute('data-mjs-idx-${d}'); `
      reconstructJs += `let _mjs_ra_${d} = ${l.iterable}; if (_mjs_ra_${d} instanceof Map || _mjs_ra_${d} instanceof Set) _mjs_ra_${d} = Array.from(_mjs_ra_${d}); `
      reconstructJs += set(l.item, `_mjs_ra_${d}[_mjs_ri_${d}]`)
      reconstructJs += set(l.index, `_mjs_ri_${d}`)
    }
  }

  // Plus de Proxy → une assignation brute `$.x = v` met à jour _state
  // mais NE réinvalide PAS (les effets texte ne se relancent pas). L'écriture
  // state→ doit passer par `µ._set(ref, 'x', v)` qui appelle `_mjs_invalidate('x')`.
  // Cas `for` : PAS de `item.field` (l'item est déjà un Proxy vivant posé par
  // `_mjs_wrapDeep` — une assignation brute dessus notifie tout seul, comportement
  // inchangé, aucune régression). MAIS un `$.simpleVar` TOP-LEVEL/PARTAGÉ lié
  // depuis un `{for}` (ex. `{for item in $items}<div clientWidth=!{$sharedWidth}>`,
  // un widget partagé entre toutes les lignes) restait INERTE — **vérifié
  // empiriquement** (`_state.sharedWidth` mutait bien à 222, mais AUCUN texte
  // interpolé `{$sharedWidth}` ne se re-rendait) : `_state` est un objet
  // ORDINAIRE (pas de Proxy racine), l'assignation brute la mute sans
  // jamais passer par `_mjs_invalidate`. Fix : `_mjsThis` (capturé par closure
  // depuis `init()`, cf. template.ts — RÉFÉRENCE STABLE au composant, déjà
  // utilisée ailleurs dans ce fichier en contexte `for`, ex. lignes ~167/180 —
  // sans dépendre du `this` de la closure ResizeObserver) route vers `µ._set`
  // dès que la cible est un `$.simpleVar`, peu importe root ou for.
  const simpleVar = /^\$\.([A-Za-z_$][\w$]*)$/.exec(jsVar)
  const buildSetup = (thisRef: string | null): string => {
    const writeBack = thisRef && simpleVar
      ? `µ._set(${thisRef}, '${simpleVar[1]}', _mjs_t.${attrName});`
      : `${jsVar} = _mjs_t.${attrName};`
    return `_mjs_node._mjs_ro_${attrName} ??= false; ` +
      `if (!_mjs_node._mjs_ro_${attrName}) { ` +
      `_mjs_node._mjs_ro_${attrName} = true; ` +
      `const _mjs_ro = new ResizeObserver((_mjs_entries) => { ` +
      `for (let _mjs_entry of _mjs_entries) { ` +
      `const _mjs_t = _mjs_entry.target; ` +
      `${reconstructJs}` +
      `if (${jsVar} !== _mjs_t.${attrName}) { ${writeBack} } ` +
      `} ` +
      `}); ` +
      `_mjs_ro.observe(_mjs_node); ` +
      `const _mjs_t = _mjs_node; ${reconstructJs} ` +
      `if (${jsVar} !== _mjs_t.${attrName}) { ${writeBack} } ` +
      `}`
  }

  if (env.ctx.type === 'root') {
    // Setup-only : pas de var dépendance, mais doit s'exécuter au mount.
    // On l'enregistre sans vars → seul `_mjs_effectsAll` au mount initial le tire.
    pushUpdate(env, `{ const _mjs_node = this._mjs_nodes.${id}; if (_mjs_node) { ${buildSetup('this')} } }`, [])
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ const _mjs_node = __nodes['${env.lid}']; if (_mjs_node) { ${buildSetup(simpleVar ? '_mjsThis' : null)} } }`)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await}) : le ResizeObserver
    // n'était jamais installé pour un `clientWidth=!{...}` DANS cette
    // branche. Setup-only comme au root (pas de dépendance réactive à
    // réenregistrer : l'observer, une fois posé, persiste tant que le nœud
    // vit) — on rejoue le même code une fois, DANS la createFn de la
    // branche (avant que `_mjs_updAwait` ne fusionne les refs dans
    // `this._mjs_nodes` : `this` reste valide ici, l'arrow function de la
    // branche le capture depuis son appel `.call(this, …)`).
    env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if (_mjs_node) { ${buildSetup('this')} } }`)
  }
  return { id, attrStr }
}

// ============================================================================
// BindingMedia — port de attributes/binding_media.rb
// currentTime, duration, paused, volume, muted, playbackRate
// ============================================================================
function bindingMedia(env: AttrCtx): AttrResult {
  const attrName = env.attrName ?? ''
  const m = env.rawVal.match(/^!\{(.+)\}$/)
  if (!m) return { id: env.id }
  const varExpr = m[1]
  const jsVar = cleanJs(varExpr, env.compiler.externalVars, false, env.compiler.moduleName)

  const vars = getEffectVars(varExpr)

  const id = env.id ?? `m${++state.counter}`

  const mapping: Record<string, [string, string[]]> = {
    currentTime:  ['currentTime',  ['timeupdate']],
    duration:     ['duration',     ['durationchange']],
    paused:       ['paused',       ['play', 'pause']],
    volume:       ['volume',       ['volumechange']],
    muted:        ['muted',        ['volumechange']],
    playbackRate: ['playbackRate', ['ratechange']],
  }
  const [prop, evts] = mapping[attrName] ?? ['', []]

  let updateLogic: string
  if (prop === 'currentTime') {
    updateLogic = `if (Math.abs(_mjs_node.currentTime - ${jsVar}) > 0.05) _mjs_node.currentTime = ${jsVar};`
  } else if (prop === 'paused') {
    updateLogic = `if (_mjs_node.paused !== !!${jsVar}) { ` +
      `if (${jsVar}) { _mjs_node.pause(); } ` +
      `else { const _mjs_p = _mjs_node.play(); if(_mjs_p && _mjs_p.catch) _mjs_p.catch(() => {}); } }`
  } else {
    updateLogic = `if (_mjs_node.${prop} !== ${jsVar}) _mjs_node.${prop} = ${jsVar};`
  }

  if (prop !== 'duration') {
    if (env.ctx.type === 'root') {
      const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
      pushUpdate(env, code, vars)
    } else if (env.ctx.type === 'for') {
      env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogic} } }`)
      // média two-way lié à une var externe en row
      // (`paused=!{$playing}`) : sans `structVars`, figé à vie sur mutation.
      for (const v of vars) state.structVars.add(v)
    } else {
      // ctx.type ni 'root' ni 'for' (branche {await}) : `currentTime=!{$t}`
      // (et les autres liaisons média sauf `duration`) ne pilotaient jamais
      // le `<audio>`/`<video>` dans cette branche — seul l'event DOM→modèle
      // (plus bas) était câblé. Même remède que bindingStandard : pose
      // initiale via `__nodes[id]`, réactivité ultérieure via
      // `registerEffect` + `this._mjs_nodes[id]`.
      const initCode = `{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`
      env.ctx.updates.push(initCode)
      const reactiveCode = rootBindingEffect(env, id, jsVar, updateLogic)
      // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
      registerEffect(reactiveCode, [...new Set([...vars, ...constVars(env, jsVar)])])
    }
  }

  let attrStr = env.attrStr
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    const propPosed = pushIdxPropUpdates(env)
    for (const l of env.ctx.loops) {
      const d = l.depth
      if (!propPosed) {
        const attrPart = ` data-mjs-idx-${d}='\${${l.index}}'`
        if (!attrStr.includes(attrPart)) attrStr += attrPart
      }
    }
  }
  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre
  const reconstructCoffee = scopeSkeleton(env, jsVar, loopBindingLine)

  const idx = state.inlines.length
  let inlineBody = `  return if _mjs_el and _mjs_el != _mjs_e.target\n`
  inlineBody += reconstructCoffee
  inlineBody += `  ${jsVar} = _mjs_el.${prop}\n`
  pushInline(env, `(_mjs_e, _mjs_el) =>\n${inlineBody}`)

  for (const evt of evts) registerEventRoute(evt, id, idx, 0, 'binding')

  return { id, attrStr }
}

// ============================================================================
// BindingContent — port de attributes/binding_contenteditable.rb
// @html=!{$x} → innerHTML, @text=!{$x} → textContent
// ============================================================================
function bindingContent(env: AttrCtx): AttrResult {
  const id = env.id ?? `c${++state.counter}`
  const m = env.rawVal.match(/^!\{(.+)\}$/)
  if (!m) return { id }
  const varName = m[1]
  const jsVar = cleanJs(varName, env.compiler.externalVars, false, env.compiler.moduleName)
  const prop = env.attrName === '@html' ? 'innerHTML' : 'textContent'

  // SEUL binding two-way sans `reconstructCoffee` :
  // dans un `{for item in $notes}<div contenteditable @text=!{item.txt}>`,
  // l'inline émis était `item.txt = _mjs_el.textContent` — mais l'inline est un
  // handler NU `(_mjs_e, _mjs_el) => {...}`, sans AUCUN accès à `item` dans son propre
  // scope (TypeError « item is not defined », ou pire : écrase un `item`
  // top-level homonyme du script si un tel nom existe). Fix : même
  // reconstruction que `bindingStandard`/`bindingGroup` (ré-hydrate
  // `item`/`index` depuis `data-mjs-idx-N` avant d'écrire).
  let attrStr = env.attrStr
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    const propPosed = pushIdxPropUpdates(env)
    for (const l of env.ctx.loops) {
      const d = l.depth
      if (!propPosed) {
        const attrPart = ` data-mjs-idx-${d}='\${${l.index}}'`
        if (!attrStr.includes(attrPart)) attrStr += attrPart
      }
    }
  }
  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre
  const reconstructCoffee = scopeSkeleton(env, varName, loopBindingLine)

  // `@html` : le HTML que montre la balise est aussi la valeur de référence de la liaison (`_mjs_html`, cf. l'écriture plus bas) ;
  // posé AVANT le modèle, pour qu'un passage de l'effet qui suit la frappe trouve la valeur déjà vue et n'écrive rien
  const idx = state.inlines.length
  let inlineBody = `  return if _mjs_el and _mjs_el != _mjs_e.target\n`
  inlineBody += reconstructCoffee
  if (prop === 'innerHTML') inlineBody += `  _mjs_el._mjs_html = _mjs_el.innerHTML\n`
  inlineBody += `  ${varName} = _mjs_el.${prop}\n`
  pushInline(env, `(_mjs_e, _mjs_el) =>\n${inlineBody}`)

  registerEventRoute('input', id, idx, 0, 'binding')

  const vars = getEffectVars(varName)
  const needsAlias = varName.includes('@@') || varName.includes('$store') ||
                     varName.includes('$$') || varName.includes('$__')
  const ptr = needsAlias ? '_mjsThis' : 'this'

  // l'écriture sur la balise `n` (qui existe) : `textContent` se relit à l'identique, la comparaison suffit ; `innerHTML` ne se relit pas
  // à l'identique quand la chaîne n'est pas sous forme normalisée (`<img src=x>`, balise non fermée, attribut sans guillemets) et la
  // comparaison réécrivait le contenu à chaque passage de l'effet (code `onerror` rejoué, image rechargée, nœuds refaits, curseur renvoyé
  // au début) : on n'écrit que si la VALEUR a changé depuis la dernière vue, gardée sur la balise (`_mjs_html`)
  const body  = (n: string): string => prop === 'innerHTML'
    ? `const _mjs_h = String(${jsVar}); if (${n}._mjs_html !== _mjs_h) { ${n}._mjs_html = _mjs_h; if (${n}.innerHTML !== _mjs_h) ${writeRawHtml(n, '_mjs_h', env.compiler.moduleName)}; }`
    : `if (${n}.textContent !== String(${jsVar})) ${n}.textContent = String(${jsVar});`
  const write = (n: string): string => prop === 'innerHTML'
    ? `if (${n}) { ${body(n)} }`
    : `if (${n} && ${n}.textContent !== String(${jsVar})) ${n}.textContent = String(${jsVar});`

  if (env.ctx.type === 'root') {
    const code = `{ ` +
      `const _mjs_node = ${ptr}._mjs_nodes['${id}']; ` +
      `${write('_mjs_node')} ` +
      `}`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ ` +
      `const _mjs_node = __nodes['${env.lid}']; ` +
      `${write('_mjs_node')} ` +
      `}`)
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche
    // {await} ; un {if}/{key} imbriqué DEDANS hérite ce ctx.type, transparent
    // pour lui) : `env.lid` n'existe QUE si `ctx.loops.length > 0` (compile.ts
    // ~l.292-295) — utilisé tel quel ici, le code généré contenait
    // `__nodes['null']` littéral, jamais le bon nœud (`textContent`/`innerHTML`
    // vide au montage). Même remède que bindingStandard : (a) pose INITIALE
    // via `__nodes[id]` (le `mjs-id` du nœud, posé par `compileTag`
    // indépendamment de `{for}`) — tourne dans la createFn de la branche, AVANT
    // que `_mjs_updIf` (mjs_element.ts) ne fusionne les refs dans `this._mjs_nodes`.
    // (b) réactivité ULTÉRIEURE via `registerEffect` + `this._mjs_nodes[id]` (même
    // `ptr` que la pose root ci-dessus, pour les var `@@`/`$store`/`$$`/`$__`)
    // — `_mjs_updAwait` étant idempotent, `$t`/`$h` muté après coup resterait sans
    // effet sans ce volet.
    const initCode = `{ ` +
      `const _mjs_node = __nodes['${id}']; ` +
      `${write('_mjs_node')} ` +
      `}`
    env.ctx.updates.push(initCode)
    // effet posé à la racine : valeur `{await}` et `{const}` de la branche recréés s'ils sont lus (cf. rootBindingEffect),
    // et seulement quand cette branche est celle qui est affichée (cf. currentBranch), qu'elle lise la valeur de la branche ou non :
    // promesse remplacée ou rejetée, la valeur lue vaut `null` et `v.titre` ferait tomber le composant, et le nœud retiré de la page
    // continuerait de recevoir le texte ou le HTML (un `<img onerror>` écrit dans un nœud détaché s'exécute quand même)
    const prelude      = scopeSkeleton(env, jsVar, () => '', 'js')
    const shown        = currentBranch(env)
    const reactiveCode = prelude || shown
      ? `{ const _mjs_node = ${ptr}._mjs_nodes['${id}']; if (_mjs_node${shown ? ` && ${shown}` : ''}) { ${prelude}${body('_mjs_node')} } }`
      : `{ ` +
        `const _mjs_node = ${ptr}._mjs_nodes['${id}']; ` +
        `${write('_mjs_node')} ` +
        `}`
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    registerEffect(reactiveCode, [...new Set([...vars, ...constVars(env, jsVar)])])
  }
  return { id, attrStr }
}

// ============================================================================
// BindingGroup — port de attributes/binding_group.rb
// @group=!{$choice} pour radios/checkboxes, avec cast suffix optionnel
// ============================================================================
function bindingGroup(env: AttrCtx): AttrResult {
  const m = env.rawVal.match(/^!\{(.+)\}$/)
  if (!m) return { id: env.id }
  const varExpr = m[1]
  const jsVar = cleanJs(varExpr, env.compiler.externalVars, false, env.compiler.moduleName)

  const vars = getEffectVars(varExpr)

  const rawAttr = env.attrName ?? ''
  const cast = rawAttr.match(/\.(number|int|float|string|bool|boolean)$/)?.[1]

  const pureVarName = varExpr.replace(/^\$/, '').replace(/[^a-zA-Z0-9_]/g, '-')
  const id = env.id ?? `g${++state.counter}`
  // le groupe natif porte le numéro de l'exemplaire du composant (`_mjs_gid`, donné au premier passage) : sans lui, deux exemplaires posés dans
  // le même arbre (`@lightDom`), ou deux composants qui lient la même variable, formaient un seul groupe — un clic dans l'un décochait l'autre
  // sans que son état bouge. Un `name` écrit par l'auteur reste le sien, sauf dans un {for} dont le groupe dépend de la ligne, quand aucune de ses
  // expressions ne lit la ligne du groupe (cf. plus bas)
  const nameAttr   = (env.node.attrs ?? []).find((a) => a.name === 'name')
  const authorName = !!nameAttr
  // les expressions du `name` de l'auteur, entre accolades (`r-{q.id}` → `q.id`) ou calculé (`name={…}`) ; jamais son texte fixe
  const nameExprs = !nameAttr ? [] : nameAttr.type === 'dynamic' ? [String(nameAttr.expr ?? '')] : splitBraceSegments(String(nameAttr.val ?? '')).filter((s) => s.expr !== null).map((s) => s.expr as string)
  const groupName = (suffix: string): string => authorName ? '' :
    `{ const _mjs_gn = \`mjs-grp-${pureVarName}-\${_mjsThis._mjs_gid ??= (µ._mjs_gseq = (µ._mjs_gseq || 0) + 1)}${suffix}\`; if (_mjs_node.name !== _mjs_gn) _mjs_node.name = _mjs_gn; } `

  const updateLogic = `if (_mjs_node.type === 'radio') { ` +
    `_mjs_node.checked = (_mjs_node.value === String(${jsVar})); ` +
    `} else if (_mjs_node.type === 'checkbox') { ` +
    `_mjs_node.checked = (Array.isArray(${jsVar}) && ${jsVar}.map(String).includes(_mjs_node.value)); ` +
    `}`

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${groupName('')}${updateLogic} } }`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    // le `name='mjs-grp-...'` posé plus bas
    // (attrStr) est STATIQUE : dérivé du seul TEXTE de l'expression
    // (`pureVarName`), donc IDENTIQUE sur toutes les rows du template partagé
    // (cloné par instance). Deux `<input type="radio" @group=!{row.rep}>`
    // dans deux rows différentes recevaient le MÊME `name` → l'exclusivité
    // radio NATIVE jouait ENTRE rows (cocher la question 2 décochait
    // visuellement la question 1).
    //
    // MAIS ce suffixe INCONDITIONNEL cassait l'idiome
    // canonique `{for opt in $menu}<input type="radio" @group=!{$choice}>` (une
    // option par row, UN groupe partagé) : `name` différent par row → navigation
    // flèches morte (groupes de 1), Tab s'arrête sur chaque radio, soumission par
    // `name` cassée. On ne suffixe donc QUE si l'expression liée DÉPEND de la
    // boucle (item/index libre dans `varExpr` → groupes distincts VOULUS) ; une
    // var externe partagée garde le `name` statique. En imbriqué : TOUS les index
    // concaténés (sinon collisions entre itérations du parent, l'ancien code ne
    // prenait que le DERNIER).
    const loopsGrp = env.ctx.loops ?? []
    const dependsOnLoop = loopsGrp.some((l) => {
      const names = [l.item, l.index].filter(Boolean) as string[]
      return names.some((nm) => new RegExp(`(?<![\\w.$])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(varExpr))
    })
    // l'index de chaque boucle : celui qu'elle nomme pour la plus intérieure, celui que la ligne a posé sur le nœud (`_mjs_idx_N`) pour les autres —
    // deux boucles imbriquées nomment toutes deux `index`, celle du dedans cachait celle du dehors : deux lignes extérieures prenaient le même nom
    const uniqueSuffix = dependsOnLoop ? loopsGrp.map((l, i) => i === loopsGrp.length - 1 ? `-\${${l.index}}` : `-\${_mjs_node._mjs_idx_${l.depth}}`).join('') : ''
    // le `name` de l'auteur reste le sien quand une de ses expressions lit chaque variable de ligne que lit le groupe (`reponse[{q.id}]` pour
    // `:group=!{q.rep}`) : il distingue les lignes comme le groupe, le formulaire l'envoie. Fixe, ou sans expression qui lise ces variables
    // (`q-{$suf}`, dont le `q-` est du texte ; `r-{g.id}` d'une boucle intérieure), il vaut le même texte sur des lignes de groupes différents :
    // remplacé par un nom propre à chaque ligne, les lignes ne se décochent pas entre elles
    const reads            = (nm: string, text: string): boolean => new RegExp(`(?<![\\w.$])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(text)
    const groupReads     = loopsGrp.flatMap((l) => [l.item, l.index].filter(Boolean) as string[]).filter((nm) => reads(nm, varExpr))
    const lineName       = groupReads.length > 0 && groupReads.every((nm) => nameExprs.some((e) => reads(nm, e)))
    const updateLogicFor = authorName
      ? (uniqueSuffix && !lineName ? `_mjs_node.name = \`mjs-grp-${pureVarName}${uniqueSuffix}\`; ${updateLogic}` : updateLogic)
      : `${groupName(uniqueSuffix)}${updateLogic}`
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogicFor} } }`)
    // #5 — cf. bindingStandard : un @group two-way dans un {for} (radios /
    // checkboxes partageant une var, idiome Svelte 6-5/6-6) doit re-rendre le
    // widget quand la var mute. On marque ses vars externes comme structurelles.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche
    // {await} ; un {if}/{key} imbriqué DEDANS hérite ce ctx.type, transparent
    // pour lui) : AUCUNE branche n'existait ici — le sens modèle→DOM était
    // totalement absent (`node.checked = …` jamais émis, `ra.checked=false`
    // malgré `$choix='b'`), radio ET checkbox groupée (tableau). Même remède
    // que bindingStandard (cf. bindingContent, juste au-dessus) :
    // (a) pose INITIALE via `__nodes[id]` dans la createFn de la branche,
    // AVANT que `_mjs_updIf` (mjs_element.ts) ne fusionne les refs dans
    // `this._mjs_nodes`. (b) réactivité ULTÉRIEURE via `registerEffect` +
    // `this._mjs_nodes[id]` (`_mjs_updAwait` idempotent, ne rejoue jamais son contenu
    // tout seul). Pas de suffixe `name` dynamique ici (réservé au `{for}`,
    // ci-dessus) : une branche {await} ne clone pas de rows.
    const initCode = `{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${groupName('')}${updateLogic} } }`
    env.ctx.updates.push(initCode)
    const reactiveCode = rootBindingEffect(env, id, jsVar, updateLogic)
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    registerEffect(reactiveCode, [...new Set([...vars, ...constVars(env, jsVar)])])
  }

  let attrStr = env.attrStr
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    const propPosed = pushIdxPropUpdates(env)
    for (const l of env.ctx.loops) {
      const d = l.depth
      if (!propPosed) {
        const attrPart = ` data-mjs-idx-${d}='\${${l.index}}'`
        if (!attrStr.includes(attrPart)) attrStr += attrPart
      }
    }
  }
  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre
  const reconstructCoffee = scopeSkeleton(env, jsVar, loopBindingLine)

  // temporaires `_mjs_gv`/`_mjs_ga` (préfixe réservé) : un `v`/`arr` nu écrasait la variable de boucle ou la valeur `{await}`
  // homonyme de l'utilisateur, relue juste après dans l'expression liée ; un `__grp_v` écrasait la variable du `<script>` du même nom
  const idx = state.inlines.length
  let inlineBody = `  return if _mjs_el and _mjs_el != _mjs_e.target\n`
  inlineBody += reconstructCoffee
  inlineBody += `  _mjs_gv = _mjs_el.value\n`
  switch (cast) {
    case 'number': inlineBody += `  _mjs_gv = Number(_mjs_gv)\n`; break
    case 'int':    inlineBody += `  _mjs_gv = parseInt(_mjs_gv, 10)\n`; break
    case 'float':  inlineBody += `  _mjs_gv = parseFloat(_mjs_gv)\n`; break
    case 'string': inlineBody += `  _mjs_gv = String(_mjs_gv)\n`; break
    case 'bool':
    case 'boolean': inlineBody += `  _mjs_gv = (_mjs_gv is true or _mjs_gv is 'true' or _mjs_gv is '1' or _mjs_gv is 1)\n`; break
  }
  inlineBody += `  if _mjs_el.type == 'radio'\n`
  inlineBody += `    ${jsVar} = _mjs_gv\n`
  inlineBody += `  else if _mjs_el.type == 'checkbox'\n`
  inlineBody += `    _mjs_ga = if Array.isArray(${jsVar}) then [...${jsVar}] else []\n`
  inlineBody += `    if _mjs_el.checked\n`
  inlineBody += `      _mjs_ga.push(_mjs_gv) if not _mjs_ga.includes(_mjs_gv)\n`
  inlineBody += `    else\n`
  inlineBody += `      _mjs_ga = _mjs_ga.filter((_mjs_i) => String(_mjs_i) != String(_mjs_gv))\n`
  inlineBody += `    ${jsVar} = _mjs_ga\n`

  pushInline(env, `(_mjs_e, _mjs_el) =>\n${inlineBody}`)

  registerEventRoute('change', id, idx, state.serverRendered ? 4 : 0, 'binding')

  // le `name` de l'auteur est déjà dans la balise : un second attribut, écrit avant le sien, lui prendrait la place
  if (!authorName) attrStr += ` name='mjs-grp-${pureVarName}'`
  return { id, attrStr }
}

// ============================================================================
// BindingThis — port de attributes/binding_this.rb
// @this=!{ref} → assigne le DOM node à la variable (`@this={ref}`, sans `!`, est refusé par dispatchAttribute)
// ============================================================================
function bindingThis(env: AttrCtx): AttrResult {
  const m = env.rawVal.match(/^!?\{(.+)\}$/)
  if (!m) return { id: env.id }
  const varExpr = m[1]
  // Point d'attention (perf) — une référence DOM `@this` devrait être une variable
  // SANS `$` : dans MJS `$` = RÉACTIF. Donc `@this=!{$ref}` rend la ref réactive et
  // chaque écriture de sous-propriété (`$ref.style.x = v`) passe par `µ._mjs_deepSet`
  // (notify + invalidate) au lieu d'une écriture brute directe. Sur un hot-path
  // (HUD, jeu, boucle), le surcoût est massif. On AVERTIT à la compilation et on
  // pointe la doc — la solution est juste d'enlever le `$` (`@this=!{ref}`).
  const _refSugar = varExpr.trim().match(/^\$\.?([A-Za-z_$][\w$]*)$/)
  if (_refSugar) {
    const _plain = _refSugar[1]
    const line = typedLine('reactivity', t('generator.this-ref-reactive', { varExpr: varExpr.trim(), plain: _plain }), state.lint)
    if (line !== null) printDiagnostic(line, state.colorsEnabled)
  }
  const jsVar = cleanJs(varExpr, env.compiler.externalVars, false, env.compiler.moduleName)
  const id = env.id ?? `t${++state.counter}`

  // Auto-déclaration : `@this=!{canvas}` avec une variable NUE (sans `$`, donc
  // non réactive). Le binding émet `canvas = node` et le script lit `canvas`,
  // mais rien ne DÉCLARE `canvas` → ReferenceError en module strict. On collecte
  // l'identifiant nu top-level pour que le transpiler hisse un `let canvas` en
  // tête de `init` (dédupliqué si le script le déclare déjà). On exclut le `for`
  // (scope par-itération distinct) et les chemins (`obj.x`, `$x`).
  if (env.ctx.type === 'root' && /^[A-Za-z_][\w$]*$/.test(varExpr.trim())) {
    state.refVars.add(varExpr.trim())
  }

  // `@this=!` installe un teardown `_mjs_ref_td` → destroy walker requis.
  state.hasDestroyHooks = true
  const updateLogicRaw = `
    if (${jsVar} !== _mjs_node) {
      ${jsVar} = _mjs_node;
      if (!_mjs_node._mjs_ref_td) {
        _mjs_node._mjs_ref_td = () => { if (${jsVar} === _mjs_node) ${jsVar} = null; };
        _mjs_node._mjs_ref_td._mjs_ref = true;
        this._mjs_attachments = this._mjs_attachments || new Set();
        this._mjs_attachments.add(_mjs_node._mjs_ref_td);
      }
    }
  `
  const cleanLogic = dedent(updateLogicRaw).replace(/\n/g, ' ')

  if (env.ctx.type === 'root') {
    // Setup-only : pas de var dépendance, exécuté au mount initial.
    pushUpdate(env, `{ const _mjs_node = this._mjs_nodes.${id}; if (_mjs_node) { ${cleanLogic} } }`, [])
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if (_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${cleanLogic} } }`)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await}) : `@this=!{ref}` ne
    // posait jamais la référence DOM dans cette branche. Setup-only comme au
    // root (l'assignation est idempotente, pas de dépendance réactive à
    // réenregistrer) — on rejoue le même code une fois, DANS la createFn de
    // la branche (`this` y reste valide, capturé depuis `.call(this, …)`).
    env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if (_mjs_node) { ${cleanLogic} } }`)
  }
  return { id }
}

// ============================================================================
// BindingComponent — port de attributes/binding_component.rb
// <mjs-foo bar=!{$x}> two-way binding via mjs-bind:bar event
// ============================================================================
function bindingComponent(env: AttrCtx): AttrResult {
  // le cast était ignoré EN SILENCE ici : `attrName` gardait son suffixe,
  // la prop posée sur l'enfant s'appelait littéralement « value.number » (qu'il
  // ne connaît pas) et l'event écouté « mjs-bind:value.number » n'était jamais
  // émis (l'enfant émet sur le nom de sa clé d'état) — liaison morte des DEUX
  // côtés. On dépouille le nom, et on convertit à la remontée seulement.
  const { base: attrName, cast } = splitCast(env.attrName ?? '')
  const m = env.rawVal.match(/^!\{(.+)\}$/)
  if (!m) return { id: env.id }
  const varExpr = m[1]
  const jsVar = cleanJs(varExpr, env.compiler.externalVars, false, env.compiler.moduleName)
  // la prop de l'enfant porte le nom que la forme en dur obtient (cf. propName) : son état, `_mjs_binds` et l'événement `mjs-bind:` le portent aussi ; l'attribut
  // du rendu serveur garde le nom écrit, que l'enfant relit camélisé à l'hydratation. Enfant pas encore mis à niveau : la clé dépend de la balise
  const prop    = propName(attrName)
  const pendKey = prop === attrName ? `'${attrName}'` : `${FOREIGN_TAG} ? '${attrName}' : '${prop}'`

  const vars = getEffectVars(varExpr)

  const id = env.id ?? `c${++state.counter}`

  let attrStr = env.attrStr
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    const propPosed = pushIdxPropUpdates(env)
    for (const l of env.ctx.loops) {
      const d = l.depth
      if (!propPosed) {
        const attrPart = ` data-mjs-idx-${d}='\${${l.index}}'`
        if (!attrStr.includes(attrPart)) attrStr += attrPart
      }
    }
  }
  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre
  const reconstructCoffee = scopeSkeleton(env, jsVar, loopBindingLine)

  // <@@select> liée à une variable de règle (le parseur pose `typed` sur la balise) : sa règle, lue comme celle d'une liste native ;
  // la liaison lui montre la valeur de la variable comme une liste native la montre (µ._mjs_tshow, mjs_types_select.ts : null sur son
  // option vide, à choix multiples chaque option une fois, dans leur ordre) ; liée à une variable libre, ou sans types, la liste garde
  // le même code
  const typedSel = attrName === 'value' && (env.node.name ?? '').toLowerCase() === 'mjs-core-select' && ((env.node as { attrs?: Array<{ name?: string }> }).attrs ?? []).some(a => a.name === 'typed')
  const bare     = typedSel ? varExpr.trim().match(/^(\$\$?)([A-Za-z_]\w*)$/) : null
  const rule     = bare ? (bare[1] === '$$' ? `µ._mjs_storeRules?.${bare[2]}` : `_mjsThis._mjs_types?.${bare[2]}`) : ''
  // réglage `proxy: false` : un objet se repose même tel quel — un frère lié au même objet (`items=!{$rows}` deux fois) l'a peut-être
  // écrit en profondeur, `_set` en juge par l'époque de l'objet (mjs_element.ts), muet si rien n'a changé ; avec l'enveloppe, la
  // variable tient la sienne, un objet changé n'est jamais le même
  const deferred  = rule ? `µ._mjs_tshow(_mjs_node, ${jsVar})` : state.withoutProxy ? `(_mjs_node._state['${prop}'] !== ${jsVar} || typeof ${jsVar} === 'object')` : `_mjs_node._state['${prop}'] !== ${jsVar}`

  // développement : la liaison notée avec le composant qui la pose et sa variable liée (`items=!{$items[i]}` : `items` ; rien pour le
  // magasin), avant que la valeur ne parte : ce que l'enfant modifie par elle, il le modifie pour ce composant (mjs_debug.ts)
  const root        = /^\s*\$(?!\$)([A-Za-z_]\w*)/.exec(varExpr)?.[1] ?? ''
  const binding     = state.devWarnings && isComponent(env.node) ? `µ._mjs_twoWay?.(_mjs_node, '${prop}', this, '${root}'); ` : ''
  const updateLogic = `(_mjs_node._mjs_binds ??= new Set()).add('${prop}'); ${binding}` +
    `if (_mjs_node._set) { ` +
    `  if (_mjs_node._state && ${deferred}) _mjs_node._set('${prop}', ${jsVar}); ` +
    // `_set` pose la valeur en JS PUR (aucune trace HTML) : côté client
    // sans effet (le composant vit déjà en mémoire), mais côté SERVEUR
    // (`µ._isServer`) la valeur ne serait alors JAMAIS sérialisée dans le HTML
    // prérendu, donc jamais rejouée à l'hydratation (composant enfant reconstruit
    // à froid, prop two-way perdue, cf. mjs-core-color qui exige `value`).
    `  if (µ._isServer) { const __ssrVal = typeof ${jsVar} === 'object' ? JSON.stringify(${jsVar}) : String(${jsVar}); if (_mjs_node.getAttribute('${attrName}') !== __ssrVal) _mjs_node.setAttribute('${attrName}', __ssrVal); } ` +
    `} else { ` +
    // enfant pas encore mis à niveau (fichier chargé après le parent, ligne de `{for}` clonée dans un gabarit inerte) : la valeur part
    // dans le registre `µ._mjs_pend`, TYPÉE — 7 reste un nombre, une date une date. Par un attribut, l'enfant la relirait en chaîne à sa
    // mise à niveau et la chaîne remonterait dans la variable du parent. Une balise `mjs-` qui n'est pas un composant du projet (hors du
    // manifeste) reçoit, elle, l'attribut (`1`) : texte, ou JSON pour un objet
    // <@@select> liée à une variable de règle : null y part en texte vide, son option vide, comme la liaison la montre (µ._mjs_tshow)
    `  µ._mjs_pend(_mjs_node, ${pendKey}, ${rule ? `(${jsVar} ?? '')` : jsVar}, 1); ` +
    `}`

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    pushUpdate(env, code, vars)
    notePropVars(vars)
    // rejoué SYNCHRONEMENT dans `init()` (state.initialPropBinds,
    // cf. sa déclaration) : même code, idempotent (garde `!==` déjà dedans).
    state.initialPropBinds.push(code)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(`const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogic} }`)
    // prop de composant liée à une var externe en row
    // (`<mjs-x foo={$shared}>`) : sans `structVars`, figée à vie sur mutation.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await}) : `value=!{$x}` vers un
    // composant ne posait JAMAIS la prop enfant dans cette branche — seul le
    // sens enfant→parent (event `mjs-bind:x`, plus bas) était câblé. Même
    // remède que bindingStandard : (a) pose INITIALE via `__nodes[id]` dans
    // la createFn de la branche, AVANT que `_mjs_updAwait` (mjs_element.ts)
    // ne fusionne les refs dans `this._mjs_nodes`. (b) réactivité ULTÉRIEURE
    // via `registerEffect` + `this._mjs_nodes[id]` (`_mjs_updAwait`
    // idempotent, ne rejoue jamais son contenu tout seul). Pas
    // d'`initialPropBinds` ici : ce volet ne concerne QUE les props du ROOT
    // rejouées synchrone dans `init()` (SSR) — un composant qui n'existe pas
    // encore avant que la branche ne se règle n'a rien à y rejouer.
    const initCode = `{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`
    env.ctx.updates.push(initCode)
    const reactiveCode = rootBindingEffect(env, id, jsVar, updateLogic)
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    const effectVars = [...new Set([...vars, ...constVars(env, jsVar)])]
    notePropVars(effectVars)
    registerEffect(reactiveCode, effectVars)
  }

  const idx = state.inlines.length
  let inlineBody = `  return if _mjs_el and _mjs_el != _mjs_e.target\n`
  inlineBody += reconstructCoffee
  // Convention MJS : l'event `mjs-bind:X` porte la valeur dans `_mjs_e.data`
  // (cf. `_mjs_notifyMutation` runtime, `_bindEv.data = ...`). PAS `e.detail`.
  // comparaison sans conversion : de vide à 0 (ou de 0 à vide), la valeur remonte
  if (rule) {
    // <@@select> liée à une variable de règle : son choix se juge comme celui d'une liste native, par les fonctions de son garde
    // (µ._mjs_tpick, mjs_types_select.ts) — accepté, ramené à la borne, ou refusé, la liste revenant alors sur le dernier texte accepté ;
    // l'aide rend ce que la variable reçoit (µ._mjs_TNO : rien). Pas pour tout composant : un champ texte serait ramené en pleine frappe
    inlineBody += `  _mjs_read = µ._mjs_tpick(_mjs_e.target, ${rule}, ${cast ? castExprFor(cast, '_mjs_e.data') : '_mjs_e.data'}, ${jsVar})\n`
    inlineBody += `  ${jsVar} = _mjs_read unless _mjs_read is µ._mjs_TNO or Object.is(${jsVar}, _mjs_read)\n`
  } else if (cast) {
    inlineBody += `  _mjs_cast = ${castExprFor(cast, '_mjs_e.data')}\n`
    inlineBody += `  ${jsVar} = _mjs_cast unless Object.is(${jsVar}, _mjs_cast)\n`
  } else {
    // variable du composant, avec l'option `derived: "precise"` (sans elle, l'affectation ordinaire) : l'écho n'est pas écrit par son code, `µ._set` ne porte pas le drapeau du code du composant (0, mjs_init.ts) — le
    // même objet revenu sans changement vu par MJS reste muet (mjs_element.ts) ; la garde des props du développement le voit (mjs_debug.ts)
    // le nom : un identifiant JavaScript, accents compris (`$année`), la règle d'acorn que suit la transformation des écritures (transform-reactive.ts)
    const echoName = state.derivedPrecise ? /^\$\.([\p{ID_Start}_$][\p{ID_Continue}$‌‍]*)$/u.exec(jsVar) : null
    // réglage `proxy: false` : la variable tient l'objet même que l'enfant a écrit en profondeur (`$items[0].nom = v`), qui revient tel
    // quel — `µ._set` juge par l'époque de l'objet si c'est un écho ou un champ changé (mjs_element.ts) ; avec l'enveloppe, la variable
    // tient la sienne, l'objet revenu n'est jamais le même
    const guard = state.withoutProxy ? '' : ` unless Object.is(${jsVar}, _mjs_e.data)`
    inlineBody += echoName ? `  µ._set(_mjsThis, '${echoName[1]}', _mjs_e.data, 0)${guard}\n` : `  ${jsVar} = _mjs_e.data${guard}\n`
  }
  pushInline(env, `(_mjs_e, _mjs_el) =>\n${inlineBody}`)

  registerEventRoute(`mjs-bind:${prop}`, id, idx, 0, 'binding')

  return { id, attrStr }
}

// ============================================================================
// <@module $comp …props…> — le repère `<div mjs-mod mjs-comp={…}>` que rend le transpiler
// ============================================================================
// L'expression du composant et les attributs DYNAMIQUES (`ids={$trouvees}`, `titre={f.nom}`,
// `class={…}`) sont évalués ICI, dans la portée du nœud — racine, ligne de `{for}`, branche — et non
// dans un effet posé au niveau du composant, qui ne voyait ni la variable de la boucle ni un `{if}`
// ouvert plus tard. Ils partent en deux objets vers `µ._updModule` : les props, posées comme sur un
// composant écrit en dur (valeur typée, jamais une chaîne d'attribut), et les attributs de la balise
// (`class`, `style`, `id`, `data-*`, `aria-*`). Les valeurs fixes (`titre="Démo"`) restent des
// attributs recopiés au remplacement. Le nœud passé est celui du gabarit : `µ._updModule` suit seul
// ses remplacements successifs.
function propModule(node: Node, attr: Attr): boolean {
  if (!node.attrs.some((a) => a.name === 'mjs-comp')) return false
  const n = attr.name ?? ''
  return attr.type === 'dynamic' && n !== '' && !/^[@*]/.test(n) && !/^mjs-/i.test(n)
}

function bindingModule(env: AttrCtx): AttrResult {
  const expr    = (e: string) => cleanTemplateExpr(e, env.compiler.externalVars, env.compiler.moduleName)
  const dyn     = env.node.attrs.filter((a) => propModule(env.node, a))
  const natives = dyn.filter((a) => /^(?:class|style|id|data-.*|aria-.*)$/i.test(a.name ?? ''))
  const props   = dyn.filter((a) => !natives.includes(a))
  const varsOf  = (l: Attr[]) => [...new Set(l.flatMap((a) => getEffectVars(a.expr ?? '')))]
  const vars    = [...new Set([...getEffectVars(env.attr.expr ?? ''), ...varsOf(dyn)])]
  const id      = env.id ?? `a${++state.counter}`
  const accept  = env.node.attrs.find((a) => a.name === 'mjs-accept')
  const list    = accept ? `[${String(accept.val ?? '').split(/\s+/).filter(Boolean).map((n) => `'${n}'`).join(', ')}]` : 'null'
  const object  = (l: Attr[]) => `{ ${l.map((a) => `${JSON.stringify(propName(a.name ?? ''))}: (${expr(a.expr ?? '')})`).join(', ')} }`
  const call    = (node: string, propsCode: string, refs = '') => `µ._updModule(this, null, (${expr(env.attr.expr ?? '')}), ${list}, ${propsCode}, ${node}, ${object(natives)}${refs});`

  if (env.ctx.type === 'for') {
    // une ligne rejoue tout à chaque passage, comme un composant écrit en dur dans une ligne ; `__nodes`
    // (les refs de la ligne) permet de resynchroniser la liste quand le composant remplace le repère
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${call(`_mjs_n${env.lid}`, object(props), ', __nodes')} } }`)
    for (const v of vars) state.structVars.add(v)
    return { id }
  }

  // racine ou branche `{await}` : le composant (et les attributs de la balise) suivent l'expression du
  // composant ; les props sont posées à la création, puis chacune par son propre effet, sur ses seules
  // variables — comme un composant écrit en dur : changer `$t` ne repose pas `ids` ni `opts`
  const varsMain  = [...new Set([...getEffectVars(env.attr.expr ?? ''), ...varsOf(natives)])]
  const propsCode = `() => (${object(props)})`
  if (env.ctx.type === 'root') {
    pushUpdate(env, `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${call('_mjs_node', propsCode)} } }`, varsMain)
    for (const p of props) {
      const pv = getEffectVars(p.expr ?? '')
      if (pv.length > 0) pushUpdate(env, `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { µ._mjs_modSet(_mjs_node, ${JSON.stringify(propName(p.name ?? ''))}, (${expr(p.expr ?? '')})); } }`, pv)
    }
    return { id }
  }

  // branche {await} : pose initiale dans la fonction de la branche (refs locales), puis effets de
  // racine qui recréent les noms de la branche (même schéma que `bindingComponent`) — et seulement
  // branche AFFICHÉE : promesse rejouée ou rejetée, la valeur `{success}`/`{error}` vaut `null`, et la
  // relire planterait l'hôte
  env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${call('_mjs_node', propsCode)} } }`)
  const shown = currentBranch(env)
  const guard = (body: string) => shown ? `if (${shown}) { ${body} }` : body
  const names = (l: string[]) => l.map((e) => expr(e)).join(', ')
  // les variables que lit un `{const}` recréé par un effet comptent aussi : `{const c = $obj}` puis `x={c.x}` suit `$obj` ; l'effet
  // du composant et des attributs de la balise suit celles que lisent l'expression du composant et les attributs natifs, chaque
  // prop suit celles que lit sa propre expression
  const varsConst = (l: string[]) => constVars(env, names(l))
  registerEffect(guard(`{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${scopeSkeleton(env, names([env.attr.expr ?? '', ...dyn.map((a) => a.expr ?? '')]), () => '', 'js')}${call('_mjs_node', propsCode)} } }`), [...new Set([...varsMain, ...varsConst([env.attr.expr ?? '', ...natives.map((a) => a.expr ?? '')])])])
  for (const p of props) {
    const pv = [...new Set([...getEffectVars(p.expr ?? ''), ...varsConst([p.expr ?? ''])])]
    if (pv.length === 0) continue
    registerEffect(guard(`{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${scopeSkeleton(env, names([p.expr ?? '']), () => '', 'js')}µ._mjs_modSet(_mjs_node, ${JSON.stringify(propName(p.name ?? ''))}, (${expr(p.expr ?? '')})); } }`), pv)
  }
  return { id }
}

// ============================================================================
// BindingTransition — port de attributes/binding_transition.rb
// @transition.X / @in.X / @out.X / @introstart / @introend / @outrostart / @outroend
// La fonction est appelée pour chaque attr lié, mais ne doit produire le code
// qu'une seule fois par node (cf. transitionsProcessed Set).
// ============================================================================
// aplatit `s` en une seule ligne SANS altérer le code utilisateur qu'elle embarque : un
// `.replace(/\s+/g, ' ')` naïf touchait aussi bien les espaces INTERNES d'une chaîne
// littérale (`'a   b'` → `'a b'`) qu'un commentaire `//` (dont le saut de ligne terminal,
// aplati, laisse le commentaire avaler tout ce qui suit — sortie refusée par acorn). Scan
// conscient chaînes (`'`/`"`/`` ` ``, échappement inclus) et commentaires (`//`, `/* */`) :
// copiés VERBATIM, seul le reste (le gabarit statique) est compacté.
function flattenPreservingLiterals(s: string): string {
  let out = ''
  let i = 0
  const n = s.length
  while (i < n) {
    const ch = s[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i
      i++
      while (i < n && s[i] !== ch) { i += s[i] === '\\' ? 2 : 1 }
      i = Math.min(i + 1, n)
      out += s.slice(start, i)
      continue
    }
    if (ch === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i)
      const stop = end === -1 ? n : end + 1
      out += s.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += s.slice(i, stop)
      i = stop
      continue
    }
    if (/\s/.test(ch)) {
      while (i < n && /\s/.test(s[i])) i++
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

// un réglage nommé (`duration: 200ms`) ; tout autre réglage est sans nom (`down`)
const NAMED_SETTING_RE = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/

// des réglages qui en comptent un sans nom (`duration: 200ms, down`) : ce que customOpts passe à `unnamed`, et les seules directives que la
// construction cite pour une transition créée par µanim.create (cf. Bundler.transitionSites)
export function hasUnnamedSetting(raw: string): boolean {
  return splitTop(raw).some(item => item !== '' && !NAMED_SETTING_RE.test(item))
}

// les réglages d'une transition créée par `µanim.create` : nommés, une valeur fixe (une durée
// devient des ms, `12` un nombre, `right` ou `'texte'` une chaîne, `[a, b]` une liste) ou une
// variable (`$x`, `item.id`) lue à la pose ; un réglage sans nom est passé à `unnamed` : la construction
// juge le nom en fin de tour (inconnu, ou créé par µanim.create, qui n'a pas de réglage principal) ; hors construction, `unnamed` le refuse
function customOpts(name: string, raw: string, scope: string[], expr: (v: string) => string, unnamed: () => void): string {
  const parts: string[] = []
  const lit = (v: string): string => {
    if (/^\$\$?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(v) || (/^([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*$/.test(v) && scope.includes(v.split('.')[0]))) return `(${expr(v)})`
    let m = /^(\d*\.?\d+)(ms|s)$/.exec(v)
    if (m) return String(Number(m[1]) * (m[2] === 's' ? 1000 : 1))
    if (/^-?\d*\.?\d+$/.test(v)) return String(Number(v))
    if (v === 'true' || v === 'false') return v
    // un texte entier, sans guillemet libre au milieu (`'a' + 'b'` est un calcul) ; `\'` y reste une apostrophe
    m = /^(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1$/.exec(v)
    if (m) return JSON.stringify(m[2].replace(/\\(['"\\])/g, '$1'))
    if (/^\[[\s\S]*\]$/.test(v)) return '[' + splitTop(v.slice(1, -1)).map(lit).join(', ') + ']'
    if (/^[\w#%.\-]+$/.test(v)) return JSON.stringify(v)
    throw new Error(t('transitions.custom-value', { name, setting: '', value: v }))
  }
  for (const item of splitTop(raw)) {
    if (item === '') continue
    const m = NAMED_SETTING_RE.exec(item)
    if (!m) { unnamed(); continue }
    try {
      parts.push(`${JSON.stringify(m[1])}: ${lit(m[2].trim())}`)
    }
    catch {
      throw new Error(t('transitions.custom-value', { name, setting: m[1], value: m[2].trim() }))
    }
  }
  return '{' + parts.join(', ') + '}'
}

// découpe aux virgules de premier niveau (hors parenthèses, crochets, guillemets)
function splitTop(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  let escaped = false
  for (const ch of raw) {
    if (quote) {
      cur += ch
      // `\'` ne referme pas le texte
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

function bindingTransition(env: AttrCtx): AttrResult {
  const id = env.id ?? `t${++state.counter}`
  const trackingKey = `${id}::${env.lid ?? ''}`
  if (state.transitionsProcessed.has(trackingKey)) {
    return { id }
  }
  state.transitionsProcessed.add(trackingKey)

  const attrs = env.node.attrs ?? []
  // `@transition=*fly(…)`, `@in.global=*fade`… : la directive, ses modificateurs, l'effet
  const directive = (d: string) => attrs.find((a: any) => a.name === d || (a.name ?? '').startsWith(d + '.'))
  const tAttr   = directive('@transition')
  const inAttr  = directive('@in')
  const outAttr = directive('@out')
  if (!tAttr && !inAttr && !outAttr) return { id }

  const modifiers: string[] = []
  for (const a of [tAttr, inAttr, outAttr]) {
    if (!a) continue
    const parts = (a.name ?? '').split('.')
    modifiers.push(...parts.slice(1))
  }
  const isGlobal = modifiers.includes('global')
  const isShared = modifiers.includes('shared')

  // `@transition/@in/@out` installent `_mjs_intro/_mjs_outro/_mjs_global`.
  state.hasDestroyHooks = true
  const cbs: Record<string, any> = {
    introstart: attrs.find((a: any) => a.name === '@introstart'),
    introend:   attrs.find((a: any) => a.name === '@introend'),
    outrostart: attrs.find((a: any) => a.name === '@outrostart'),
    outroend:   attrs.find((a: any) => a.name === '@outroend'),
  }

  // Les callbacks contiennent du code utilisateur (`$.x = ...`) — il faut le
  // faire passer par le même pipeline que le script init pour que les
  // assignations déclenchent `µ._set(_mjsThis, …)` et l'invalidation qui va
  // avec. Sans ça, `$.status = 'intro started'` écrit sur `_state` mais
  // n'invalide rien → le binding `{$status}` ne re-render pas. Écrit dans la langue des gestionnaires, compilé comme eux (cf. callbackBody)
  const cbAssignments = Object.entries(cbs)
    .filter(([_, a]) => a)
    .map(([key, a]) => {
      // Pas de bare-ref ici : les handlers inline sont compilés PENDANT le walk du
      // template, donc `effectsByVar` est encore partiel → on ne peut pas prouver
      // qu'une ref n'est pas bindée. On laisse `µ._mjs_deepSet` (réactif, correct) ;
      // le hot-path (refresh dans le script principal) est optimisé en ligne 966.
      // la fonction entière, pas son corps nu : un `return` de premier niveau s'y lit, les écritures qui le suivent préviennent l'état
      const tracked = applyPathTrackingMapped(transformReactiveWrites(callbackFunction(a, env)), { withoutProxy: state.withoutProxy })
      const body    = tracked.code
      // réglage `proxy: false` : ce que le rappel écrit sans que le compilateur le voie, à la ligne de la balise — une partie de l'état
      // (cf. AvisInvisible), ou l'élément d'une boucle `{for}` qui l'entoure (la variable du rendu, sans indice relu)
      if (state.withoutProxy && !state.isPrePass) {
        const line = a.line ?? env.node.line
        for (const v of tracked.notice ?? []) state.callbackNotice.push({ line, shape: v.shape, name: v.name, root: v.root })
        const roots = new Map<string, string>()
        for (const l of env.ctx.loops ?? []) {
          const head = LOOP_HEAD.exec(String(l.iterable ?? '').trim())
          const root = head ? (head[1] === '$' ? head[2] : roots.get(head[1])) : undefined
          if (!root) continue
          roots.set(l.item, root)
          if (writesFreeElement(l.item, body)) state.callbackNotice.push({ line, shape: 1, name: l.item, root: '$' + root })
        }
      }
      // `\n` explicite avant l'accolade fermante de la fonction (cf. callbackFunction) : `callbackBody` a déjà
      // consommé le saut de ligne d'origine (`.trim()`) — sans un VRAI `\n`, un corps
      // se terminant par un commentaire `//` (Civet/Coffee) avalerait la fermeture du
      // callback. `flattenPreservingLiterals` (plus bas) préserve ensuite ce saut de ligne
      // PRÉCISÉMENT parce qu'il termine potentiellement un tel commentaire.
      return `_mjs_node._mjs_cb_${key} = ${body};`
    })
    .join(' ')

  // l'effet de la directive → l'expression qui rend sa paire { intro, outro } : une transition du
  // catalogue (µ._mjs_fxAnim), un effet qui se joue une fois (µ._mjs_fxLife), ou une transition
  // créée par `µanim.create` (µ._mjs_fxAnimCustom) — un nom proche d'un effet connu est une faute
  const formatAnim = (a: any): string => {
    if (!a) return 'null'
    const dir = (a.name ?? '').split('.')[0].slice(1)
    const m = /^\*([A-Za-z][\w-]*(?:\.[\w.-]*)?)\(([\s\S]*)\)$/.exec(String(a.val ?? ''))
    // `@in="*fly"` : l'effet est là, entre guillemets (sans eux, le parseur lui aurait posé ses parenthèses) ;
    // `@in.global="*fly"` propose `@in.global=*fly`, le modificateur reste
    if (!m && /^\*[A-Za-z][\w-]*(?:\.[a-z][a-z0-9_]*)?$/.test(String(a.val ?? ''))) throw new Error(t('transitions.quotes', { directive: shownName(transitionDirective(a.name ?? '@' + dir)), effect: String(a.val) }))
    if (!m) throw new Error(t('transitions.expects-effect', { directive: written(dir) }))
    const name  = m[1]
    const raw   = m[2]
    const scope = env.ctx.locals ? Array.from(env.ctx.locals) : []
    const expr  = (v: string) => cleanTemplateExpr(v, env.compiler.externalVars, env.compiler.moduleName)
    if (!effectSpec(name)) {
      const near = nearestEffect(name)
      // une faute de frappe sur un effet connu (`fdae`), ou un alias que cet effet n'a pas (`fade.inconnu`) : l'erreur donne le
      // bon nom ; sinon, une transition créée par µanim.create (vérifiée en fin de build)
      // un effet retiré ou fondu dans un autre (`*knockout` → `*gradient.knockout`) : le message de l'effet posé directement
      if (near.distance <= 1 || (name.includes('.') && EFFECTS[name.split('.')[0]]) || removedEffectError(name)) parseEffect(name, raw, scope)
      state.usedAnimations.add(name)
      // un réglage sans nom : la construction, qui voit tous les fichiers, juge le nom en fin de tour ; transpile() appelé seul le refuse
      const unnamed = () => {
        if (!state.deferUnnamedSettings) throw new Error(t('transitions.custom-positional', { name }))
        state.unnamedSettingAnimations.add(name)
      }
      return `µ._mjs_fxAnimCustom(${JSON.stringify(name)}, ${customOpts(name, raw, scope, expr, unnamed)}\n)`
    }
    const settings = parseEffect(name, raw, scope)
    // un effet de l'appli : réglé, c'est l'effet de la bibliothèque qui se pose ; CSS, sa définition part avec
    const real = settings.base ?? name
    effectKids(real, settings, env.node)
    if (projectEffect(name)) state.usesProjectEffects = true
    // le nom écrit, pour que les messages nomment l'alias (`@in=*filter.frosted_glass`), pas l'effet qu'il règle ; les réglages écrits
    // à la pose, pour distinguer un déclencheur que l'auteur a écrit de celui que l'alias porte
    checkLife(name, settings, dir, raw)
    const dynKeys = Object.keys(settings.dynamic)
    const dyn  = dynKeys.length === 0 ? 'null' : '{' + dynKeys.map(k => `${JSON.stringify(k)}: (${expr(settings.dynamic[k])})`).join(', ') + '}'
    const spec = dynKeys.length === 0 ? 'null' : JSON.stringify(settings.spec)
    const fx   = effectSpec(real)!
    if (fx.transition || fx.custom) {
      if (fx.transition) state.usedAnimations.add(real)
      return `(${customDef(name, settings, true)}µ._mjs_fxAnim(_mjsThis, _mjs_node, ${JSON.stringify(real)}, ${fixedCode(name, settings)}, ${dyn}, ${spec}\n))`
    }
    return `((_mjs_fxn, _mjs_d) => µ._mjs_fxLife(_mjsThis, _mjs_fxn, ${JSON.stringify(real)}, ${fixedCode(name, settings)}, _mjs_d, ${spec}\n))(_mjs_node, ${dyn})`
  }

  let setupCode = ''
  if (tAttr) {
    setupCode = `
      const _mjs_cfgT = ${formatAnim(tAttr)};
      if (_mjs_cfgT) {
        if (_mjs_cfgT.intro) _mjs_node._mjs_intro = _mjs_cfgT.intro;
        if (_mjs_cfgT.outro) _mjs_node._mjs_outro = _mjs_cfgT.outro;
      }
    `
  }
  // `@in` / `@out` à côté de `@transition` : chacun reprend son sens
  if (inAttr) {
    setupCode += `
      const _mjs_cfgIn = ${formatAnim(inAttr)};
      if (_mjs_cfgIn && _mjs_cfgIn.intro) _mjs_node._mjs_intro = _mjs_cfgIn.intro;
    `
  }
  if (outAttr) {
    setupCode += `
      const _mjs_cfgOut = ${formatAnim(outAttr)};
      if (_mjs_cfgOut && _mjs_cfgOut.outro) _mjs_node._mjs_outro = _mjs_cfgOut.outro;
    `
  }

  const nodeLookup = env.ctx.type !== 'root' && env.lid
    ? `__nodes['${env.lid}']`
    : `this._mjs_nodes.${id}`

  const initialCheck = isGlobal ? 'true' : '!_mjsThis._mjs_initial_render'
  const globalLine   = isGlobal ? '_mjs_node._mjs_global = true;' : ''
  const sharedLine   = isShared ? `_mjs_node._mjs_anim_mode = 'shared';` : ''

  // Pipeline intro : on doit attendre que le node soit dans le DOM ET ait un
  // layout calculé avant de capturer ses dims pour les animations samplées
  // (`slide`/`fly`/`scale`/...). Sans ça, `getComputedStyle` renvoie des
  // strings vides et `offsetHeight = 0` → kf[end] tout à zéro → animation
  // invisible. Cas vécu : item fresh ajouté via `{for}` reconcile, encore
  // dans un fragment détaché au moment où l'update tire.
  //
  // Anti-flash : on applique kf[0] de l'anim SYNC sur le node via WAAPI
  // (`animate([kf[0]], { fill: 'forwards', duration: 0 })`) AVANT le rAF de
  // _mjs_whenLayouted. Comme ça le node reste à l'état initial (opacity:0,
  // height:0, ...) jusqu'à ce que _mjs_playTransition démarre la vraie anim qui
  // overrideras les styles. Cette anim "zero-duration" est cancellée juste
  // avant la vraie pour ne pas interférer avec la capture (getComputedStyle
  // ignore les styles posés par WAAPI une fois cancellée).
  //
  const jsCode = `
    {
      const _mjs_node = ${nodeLookup};
      if (_mjs_node && !_mjs_node._mjs_transition_init) {
        _mjs_node._mjs_transition_init = true;
        ${globalLine}
        ${sharedLine}
        ${setupCode}
        ${cbAssignments}
        if (_mjs_node._mjs_intro && (${initialCheck})) {
          try {
            _mjs_node._mjs_cb_introstart?.();
            µ._mjs_whenLayouted(_mjs_node, () => {
              µ._mjs_playTransition(_mjs_node, _mjs_node._mjs_intro, 'in')
                .then(() => _mjs_node._mjs_cb_introend?.())
                .catch(_mjs_err => console.warn(${JSON.stringify(t('generator.error-intro'))}, _mjs_err));
            });
          } catch(_mjs_err) { console.error(${JSON.stringify(t('generator.failed-intro'))}, _mjs_err); }
        }
      }
    }
  `.trim()
  const flatJsCode = flattenPreservingLiterals(jsCode)

  env.ctx.updates.push(flatJsCode)
  return { id }
}

// ============================================================================
// BindingClass — port de attributes/binding_class.rb
// @class{$cond}="cssClass" → toggle CSS class selon condition
//
// **Filtered Dispatch** :
//   Quand `cond` est de la forme `$X CMP item.Y` (ou symétrique) où `$X` est
//   une state var externe à la loop courante et `item.Y` est une propriété
//   du loopItem, on génère un index inverse `_mjs_filt[<X>].idx: Map<item.Y, fn>`.
//   À l'invalidation de `$X`, le runtime lookup directement les 1-2 fns
//   concernées (old/new) au lieu de re-render N rows. Gain massif sur le
//   bench officiel `select1k` (1000 → 2 effects).
// ============================================================================

// Tente de matcher le pattern `$X === item.Y` ou `item.Y === $X`.
// Retourne { externVar, itemAccess } si match, sinon null.
// CMP supportés : ===, ==, !==, !=, <, <=, >, >=.
export function detectFilteredPattern(
  conditionExpr: string,
  loopItem: string,
  externalVars: string[]
): { externVar: string; itemAccess: string; op: string; rev: boolean } | null {
  if (!loopItem) return null
  // Normalise les idiomes Coffee/Civet (`is` → `===`, `isnt` → `!==`,
  // `$x` → `$.x`, `and`/`or`/`not` → `&&`/`||`/`!`) avant de chercher l'op :
  // le motif est cherché dans le code que la condition émet (conditionJs).
  // Sans ça, `@class{$selected is item}` n'est jamais reconnu comme filtered
  // → fallback non-filtered → l'effect global n'est pas registered →
  // le binding ne re-tire jamais sur mutation de `$selected`.
  const trimmed = conditionJs(conditionExpr, externalVars, state.moduleName)
  if (trimmed === null) return null
  // IMPORTANT : seulement les ops d'ÉGALITÉ (`===` / `==`) sont éligibles au
  // filtered dispatch — l'index inverse `Map<value, fn>` lookup une clé exacte.
  //   - `!==` / `!=` : la condition est vraie pour 999/1000 rows → 999 doivent
  //     être touchés, pas seulement 2. Non éligible.
  //   - `<` / `<=` / `>` / `>=` : couvre une PLAGE de valeurs → indexation par
  //     valeur unique inopérante. Non éligible.
  // On reste donc strict sur `===` et `==`.
  const opPatterns = ['===', '==']
  // Rejet précoce des expressions composées (&&, ||, ?, ternaire, etc.) :
  // si on splite sur `===`, le right peut contenir `$selected && $other`,
  // ce qui passerait l'extractExternVar à null → on retournerait null.
  // Mais autant rejeter en amont pour clarté + perf.
  // Tokens qui indiquent une expression complexe non-éligible :
  //   - `&&`, `||` : compose logique
  //   - `?`, `:` (en dehors d'un objet/array literal) : ternaire
  //   - `!` au début : négation (ex: `!(row.x === $y)`)
  //   - `(` : parens (souvent appel ou groupe) → ambigu, on bypass
  // On accepte uniquement : `<bareSide> OP <bareSide>` ou variants espace.
  if (/[&|?]/.test(trimmed)) return null
  if (/\bnot\b|\band\b|\bor\b/.test(trimmed)) return null  // Coffee logical kw
  if (trimmed.startsWith('!') || trimmed.startsWith('(')) return null
  for (const op of opPatterns) {
    const idx = trimmed.indexOf(op)
    if (idx < 0) continue
    const left = trimmed.slice(0, idx).trim()
    const right = trimmed.slice(idx + op.length).trim()
    if (!left || !right) continue
    // Pas d'op résiduel dans les deux côtés (anti-pattern composé).
    if (/[<>=!]/.test(left) || /[<>=!]/.test(right)) continue
    // Test : `$X` ou `$.X` vs `item.Y`. La var externe peut être `$selected`
    // (forme source) ou `$.selected` (forme post-tokenize).
    const matchExternVar = (s: string): string | null => {
      // `$selected` direct (state var locale)
      let m = s.match(/^\$([a-zA-Z_$][\w$]*)$/)
      if (m) {
        // Skip si c'est une externalVar déclarée
        if (externalVars.includes(`$${m[1]}`)) return null
        return m[1]
      }
      // `$.selected` (forme tokenisée)
      m = s.match(/^\$\.([a-zA-Z_$][\w$]*)$/)
      if (m) return m[1]
      return null
    }
    const matchItemAccess = (s: string): string | null => {
      // `item.field` : clé = primitive `item.field`
      const re = new RegExp(`^${loopItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([a-zA-Z_$][\\w$]*)$`)
      const m = s.match(re)
      if (m) return m[1]
      // `item` seul : clé = la référence d'item lui-même (Map stocke des refs).
      // Cas rare mais réaliste : `<a @class{$activeTab === tab}=…>` où `tab` est
      // un objet/string complet. Le sigil "" indique "pas de field" → l'index
      // utilise `${loopItem}` direct comme clé.
      if (s === loopItem) return ''
      return null
    }
    // Cas 1 : extern OP item
    const extL = matchExternVar(left)
    const itemR = matchItemAccess(right)
    if (extL && itemR !== null) {
      return { externVar: extL, itemAccess: itemR, op, rev: false }
    }
    // Cas 2 : item OP extern
    const itemL = matchItemAccess(left)
    const extR = matchExternVar(right)
    if (itemL !== null && extR) {
      return { externVar: extR, itemAccess: itemL, op, rev: true }
    }
  }
  return null
}

// Détecte les expressions filtered-éligibles pour les bindings
// @style.X / @data-X / @aria-X / etc. Deux formes acceptées :
//
//   1) Bool direct : `item.id === $selected`
//      → matchValue / unmatchValue = 'true' / 'false' (utilisable comme bool
//        pour setAttribute, mais aussi mappable à des strings côté caller).
//
//   2) Ternaire : `item.id === $selected ? 'red' : 'black'`
//      → matchValue / unmatchValue = `'red'` / `'black'` (expressions JS brutes).
//
// Le caller décide ensuite comment appliquer ces valeurs (style.X, attr, etc.).
// `null` sinon (fallback : générer le binding normal).
export function detectFilteredValueExpr(
  expr: string,
  loopItem: string,
  externalVars: string[]
): {
  externVar: string
  itemAccess: string
  matchValue: string
  unmatchValue: string
  isBoolean: boolean
  tracked: string[]
} | null {
  if (!expr) return null
  // Idem `detectFilteredPattern` : normalise les idiomes Coffee/Civet pour
  // que `is`/`isnt`/`and`/`or`/`not` ne bloquent pas la détection filtered.
  const trimmed = conditionJs(expr, externalVars, state.moduleName)
  if (trimmed === null) return null

  // Cas ternaire : on splitte sur le `?` top-level. Attention aux `?` imbriqués
  // (ex : `a ? b : c ? d : e`). On rejette tout ternaire chained pour rester
  // simple — `a ? b : c` strict, sinon fallback.
  // Détecter le `?` top-level : on ne supporte pas les parens/sous-expressions
  // complexes. La cond doit être un pattern filtered détecté.
  const qIdx = trimmed.indexOf('?')
  if (qIdx > 0) {
    const before = trimmed.slice(0, qIdx)
    const after = trimmed.slice(qIdx + 1)
    // Le `:` top-level dans `after` sépare trueVal et falseVal.
    // On ignore les `:` dans des strings (heuristique simple : compte les quotes).
    let depth = 0
    let inStr: string | null = null
    let colonIdx = -1
    for (let i = 0; i < after.length; i++) {
      const c = after[i]
      if (inStr) {
        if (c === inStr && after[i - 1] !== '\\') inStr = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === ':' && depth === 0) { colonIdx = i; break }
      else if (c === '?' && depth === 0) {
        // Ternaire chained → skip (trop complexe pour filtered).
        return null
      }
    }
    if (colonIdx < 0) return null
    const trueVal = after.slice(0, colonIdx).trim()
    const falseVal = after.slice(colonIdx + 1).trim()
    if (!trueVal || !falseVal) return null
    // la valeur suit AUSSI ce que lit sa branche. Branche de la ligne choisie qui lit l'état (`$t`) : la liaison reste filtrée, son effet suit
    // aussi ces variables et récrit la seule ligne choisie (`suivies`) ; branche des autres lignes qui lit quoi que ce soit, ou lecture d'un
    // magasin, d'un contexte, du composant : toutes les lignes en dépendent, la liaison ordinaire les suit
    if (/[$µ§]|\bthis\b|_mjsThis/.test(falseVal) || /[µ§]|\bthis\b|_mjsThis/.test(trueVal)) return null
    // La cond doit matcher un filtered pattern.
    const filt = detectFilteredPattern(before, loopItem, externalVars)
    if (!filt) return null
    return {
      externVar: filt.externVar,
      itemAccess: filt.itemAccess,
      matchValue: trueVal,
      unmatchValue: falseVal,
      isBoolean: false,
      tracked: trueVal.includes('$') ? getEffectVars(expr) : [],
    }
  }

  // Pas de ternaire : essayer un bool direct (l'expression EST le pattern).
  const filt = detectFilteredPattern(trimmed, loopItem, externalVars)
  if (filt) {
    return {
      externVar: filt.externVar,
      itemAccess: filt.itemAccess,
      matchValue: 'true',
      unmatchValue: 'false',
      isBoolean: true,
      tracked: [],
    }
  }
  return null
}

// le champ filtré est-il la clé du `by` de la boucle ? Une ligne gardée par sa clé garde alors la même valeur filtrée : son entrée d'index ne change jamais de clé, rien à lâcher.
// Sans `by`, sur un autre champ ou sur l'élément lui-même, le champ peut changer sur une ligne gardée
function filterOnKey(loop: { key?: string | null } | null, itemAccess: string): boolean {
  return !!loop && loop.key != null && itemAccess === loop.key
}

// plusieurs lignes peuvent porter la valeur filtrée dès que le champ n'est pas la clé du `by` d'une boucle seule (`lacher`) : une valeur répétée, une clé reprise dans un autre groupe d'une
// boucle imbriquée. L'index garde alors la fonction de chaque ligne (cf. setFilteredFunction) ; la boucle seule filtrée sur sa clé garde le code d'avant, à l'octet
function severalLines(drop: boolean, scopeLoops: unknown[]): boolean {
  return drop || scopeLoops.length > 1
}

// la valeur écrite par une liaison filtrée (attribut, style) lit-elle la ligne ? Un nom de la portée de la ligne — élément, index, `{const}`, boucle parente — rend périmée la fonction
// gardée dans l'index : elle a fermé sur la passe qui l'a faite. Ne la rendent pas périmée : un texte ou un nombre, le champ filtré lui-même (même valeur tant que la clé ne change pas,
// et une clé qui change fait refaire la fonction), une variable d'état (`$.x`, relue à l'appel). Dans le doute (gabarit de texte, portée inconnue, élément filtré lu) : oui
function valueReadsLine(values: string[], item: string, itemAccess: string, ctx: AttrCtx['ctx']): boolean {
  if (!ctx.scope) return true
  const names = new Set<string>(ctx.locals ?? [])
  for (const l of ctx.loops) {
    if (l.item) names.add(l.item)
    if (l.index) names.add(l.index)
  }
  for (const p of ctx.scope) {
    if (p.kind === 'for') {
      if (p.loop.item) names.add(p.loop.item)
      if (p.loop.index) names.add(p.loop.index)
    }
    else names.add(p.name)
  }
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const field  = itemAccess ? new RegExp(`(?<![\\w$.])${escape(item)}\\.${escape(itemAccess)}(?![\\w$.\\[(])`, 'g') : null
  for (const value of values) {
    if (value.includes('`')) return true
    let text = value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '0')
    if (field) text = text.replace(field, '0')
    text = text.replace(/\b\d[\w.]*/g, '0').replace(/\.\.\./g, ' ')
    for (const m of text.matchAll(/(?<![\w$µ.])[A-Za-z_$µ][\w$µ]*/g)) if (names.has(m[0])) return true
  }
  return false
}

// où la ligne range, pour une liaison filtrée par valeur, sa clé dans l'index (`key`) et sa fonction ou son nœud (`fn`) : la première liaison
// filtrée du gabarit de la ligne, en champs directs sur la ligne (`_mjs_fk`, `_mjs_ff` : aucun objet par ligne) ; une suivante, rare, dans
// les deux objets de la ligne, sous le nom de son index (`_mjs_filterKeys`, `_mjs_filterFns`, que `fns` déclare). La purge du runtime lit
// les deux (mjs_for.ts, `_mjs_filtPurgeEntry`)
type FilterFields = { fn: string, key: string, fns: string }
function filterFields(loop: LoopInfo, idxName: string): FilterFields {
  loop.filterFields ??= idxName
  if (loop.filterFields === idxName) return { fn: '__nodes._mjs_ff', key: '__nodes._mjs_fk', fns: '' }
  return { fn: `__fns['${idxName}']`, key: `(__nodes._mjs_filterKeys ??= {})['${idxName}']`, fns: 'const __fns = (__nodes._mjs_filterFns ??= {}); ' }
}

// pose, dans l'index d'une liaison filtrée par valeur (attribut, style), la fonction de la ligne, rangée selon `champs`. `redo` : la fonction est refaite à CHAQUE passe de la ligne (sinon
// seulement si la clé est inédite ou détenue par une autre ligne) ; `lacher` : la ligne lâche l'entrée de son ancienne clé, tant qu'elle est la sienne
function setFilteredFunction(create: string, fields: FilterFields, redo: boolean, drop: boolean, multi = false): string {
  const read = `const __f0 = ${fields.fn}; `
  // `multi` : plusieurs lignes peuvent porter la même valeur (cf. dynamic) ; l'index garde alors la fonction de chacune, un Set quand une clé en porte plusieurs
  // (µ._mjs_filtPut). La ligne retire la sienne, sous la clé où elle est posée, avant d'en poser une neuve : le garde reste celui d'avant, une clé à Set la fait refaire à chaque passe
  if (multi) {
    const key         = drop ? `const _mjs_pk = ${fields.key}; ` : ''
    const remove      = `if (__f0 !== void 0) µ._mjs_filtDrop(__idx, ${drop ? '_mjs_pk' : '__k'}, __f0); `
    const assignedSet = `µ._mjs_filtPut(__fe, __k, __f); ${fields.fn} = __f; `
    if (redo) return `${read}${key}${remove}${create}${assignedSet}`
    return `${read}if (__f0 === void 0 || __idx.get(__k) !== __f0) { ${key}${remove}${create}${assignedSet}} `
  }
  const drops = drop ? `const _mjs_pk = ${fields.key}; if (__f0 !== void 0 && _mjs_pk !== __k && __idx.get(_mjs_pk) === __f0) __idx.delete(_mjs_pk); ` : ''
  const sets  = `__idx.set(__k, __f); ${fields.fn} = __f; `
  if (redo) return `${drop ? read : ''}${drops}${create}${sets}`
  return `${read}if (__f0 === void 0 || __idx.get(__k) !== __f0) { ${drops}${create}${sets}} `
}

// liaison filtrée par valeur d'une ligne de `{for}` (attribut, `@class`, `@style`), commune aux trois : la passe de la
// ligne (`logique`) la pose et range sa fonction ou son nœud (`pose`) dans l'index de sa valeur ; l'effet de la racine
// ne touche que les deux lignes qui changent quand la variable bouge, l'ancienne valeur s'éteint, la nouvelle s'allume.
// `bascule(valeur, on)` : l'effet sur l'entrée d'une valeur quand une seule ligne la porte ; avec `multi`, plusieurs
// lignes peuvent la porter et µ._mjs_filtCall les appelle toutes. Le texte émis est le même pour les trois liaisons
// l'index naît avec la première ligne qui s'y range : son nom rejoint alors, une fois, la liste des index du composant (`_mjs_filtIdxKeys`, lue
// par les purges de la réconciliation), jamais à chaque ligne. `champs` : où la ligne range sa clé et sa fonction (cf. filterFields)
// `suivies` : les variables d'état que lit la valeur de la ligne choisie ; l'effet les suit aussi, et quand l'une change sans que la variable
// comparée change, il récrit la seule ligne choisie
function filteredBinding(env: AttrCtx, externVar: string, idxName: string, fields: FilterFields, keyExpr: string, logic: string, sets: string, multi: boolean, toggle: (value: string, on: string) => string, tracked: string[] = []): void {
  env.ctx.updates.push(
    `{ const _mjs_n${env.lid} = __nodes['${env.lid}']; ` +
    `if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${logic} ` +
    `const __k = ${keyExpr}; ` +
    `const __fe = ((_mjsThis._mjs_filt ??= {})['${idxName}'] ??= { idx: null, prev: void 0 }); ` +
    `const __idx = __fe.idx ?? ((_mjsThis._mjs_filtIdxKeys ??= new Set()).add('${idxName}'), __fe.idx = new Map()); ` +
    fields.fns +
    sets +
    `${fields.key} = __k; ` +
    `} }`
  )
  const filtEffectCode =
    `{ ` +
    `const __fe = ((this._mjs_filt ??= {})['${idxName}'] ??= { idx: null, prev: void 0 }); ` +
    `const _mjs_prev = __fe.prev; ` +
    `const _mjs_curr = this._state.${externVar}; ` +
    `if (_mjs_prev !== _mjs_curr) { ` +
    `const _mjs_idx = __fe.idx; ` +
    `if (_mjs_idx) { ` +
    (multi
      ? `if (_mjs_prev !== void 0) µ._mjs_filtCall(_mjs_idx.get(_mjs_prev), false); ` +
        `if (_mjs_curr !== void 0) µ._mjs_filtCall(_mjs_idx.get(_mjs_curr), true); `
      : `if (_mjs_prev !== void 0) { ${toggle('_mjs_prev', 'false')} } ` +
        `if (_mjs_curr !== void 0) { ${toggle('_mjs_curr', 'true')} } `) +
    `} ` +
    `__fe.prev = _mjs_curr; } ` +
    (tracked.length > 0 ? `else if (_mjs_curr !== void 0 && __fe.idx) { const _mjs_idx = __fe.idx; ${multi ? 'µ._mjs_filtCall(_mjs_idx.get(_mjs_curr), true);' : toggle('_mjs_curr', 'true')} } ` : '') +
    `}`
  // Expansion transitive : si la variable est un dérivé, l'effet s'abonne aussi à ses dépendances statiques (sinon une
  // dépendance qui mute laisse le dérivé périmé et l'effet endormi) — getEffectVars passe par analyzer.resolveSnippetDeps.
  // Hors garde de branche : le souvenir `prev` suit la variable même quand un {if} cache la liste, sinon la ligne
  // éteinte au retour n'est pas la bonne (cf. CompilerState.registerEffect)
  const filtVars = getEffectVars(`$${externVar}`)
  const deps     = filtVars.length > 0 ? filtVars : [externVar]
  registerEffect(filtEffectCode, tracked.length > 0 ? [...new Set([...deps, ...tracked])] : deps, { unguarded: true })
}

// effet sur la ligne seule d'une valeur, pour l'attribut et le style : sa fonction, appelée allumée ou éteinte
const filterCall = (value: string, on: string): string => `const _mjs_f = _mjs_idx.get(${value}); if (_mjs_f) _mjs_f(${on});`

function bindingClass(env: AttrCtx): AttrResult {
  // `(.+)` gourmand (le nom d'attribut se termine au
  // DERNIER `}`), pas `[^}]+` qui tronquait la condition au 1er `}` :
  // `@class{$a && f({x:1})}` était coupé à `$a && f({x:1`. Aligné sur
  // bindingStyle{cond}.
  const m = (env.attrName ?? '').match(/@class\{(.+)\}/)
  if (!m) return { id: env.id }
  // plusieurs bascules de la balise portent la même classe (`@class{$a}="on" @class{$b}="on big"`) : la classe est présente si l'une au
  // moins des bascules qui la contiennent est vraie. Elle n'a qu'une garde (`_mjs_cl_<classes>`, partagée sinon, et la classe dépendait de
  // l'ordre des écritures) : chaque classe est posée par la première bascule qui la porte, avec les conditions de toutes celles qui la
  // portent ; les classes d'une bascule qui ont les mêmes porteuses restent ensemble
  const tokens    = (v: string | undefined): string[] => (v ?? '').trim().split(/\s+/).filter(Boolean)
  const condition = (a: { name?: string }): string => (a.name ?? '').match(/@class\{(.+)\}/)![1]
  const toggles   = (env.node.attrs ?? []).filter((a) => /^@class\{.+\}$/.test(a.name ?? ''))
  const mine      = tokens(env.rawVal)
  const groups    = new Map<string, string[]>(mine.length === 0 ? [[m[1], []]] : [])
  for (const c of mine) {
    const porteuses = toggles.includes(env.attr) ? toggles.filter((a) => a === env.attr || tokens(a.val).includes(c)) : [env.attr]
    if (porteuses[0] !== env.attr) continue
    const cond = porteuses.length > 1 ? porteuses.map((a) => `(${condition(a)})`).join(' || ') : m[1]
    groups.set(cond, [...(groups.get(cond) ?? []), c])
  }
  // toutes ses classes ensemble (le cas courant) : la chaîne écrite, garde et code d'avant à l'octet
  let id = env.id
  for (const [cond, classes] of groups) id = classToggle(env, id, classes.length === mine.length ? env.rawVal : classes.join(' '), cond)
  return { id }
}

// aucune des classes `tokens` sur la balise à sa fabrication : ni étalement, ni `class` calculé ou interpolé, ni l'une d'elles dans son `class`
// écrit (une bascule `@class{…}` voisine a sa propre garde)
function missingClasses(attrs: { type: string, name?: string, val?: string }[], tokens: string[]): boolean {
  return attrs.every((a) => {
    const an = (a.name ?? '').toLowerCase()
    if (a.type === 'spread') return false
    if (/^[@:]class\{/.test(an) || !an.includes('class')) return true
    return an === 'class' && a.type === 'static' && !/[{}]/.test(a.val ?? '') && !(a.val ?? '').trim().split(/\s+/).some((c) => tokens.includes(c))
  })
}

// une bascule de `className` (une ou plusieurs classes) sur la condition `conditionExpr` ; rend l'id du nœud, créé au besoin
function classToggle(env: AttrCtx, nodeId: string | undefined, className: string, conditionExpr: string): string {
  // Site EXPR (condition @class{cond}, même nature qu'un {if}).
  const jsVar = cleanTemplateExpr(conditionExpr, env.compiler.externalVars, env.compiler.moduleName)

  const vars = getEffectVars(conditionExpr)
  const id = nodeId ?? `c${++state.counter}`
  // Toggle GARDÉ : ne touche le DOM que si la condition a CHANGÉ pour ce nœud.
  // L'updateFn d'un {for} est ré-exécutée sur TOUTES les lignes à chaque
  // réconciliation → l'ancien `toggle()` inconditionnel faisait 1000 appels
  // DOM no-op par update (profiler : poste de style-recalc sur create/update).
  // L'état est porté par le nœud (`_mjs_cl_<classe>`), partagé entre l'updateFn
  // et la closure du filtered-dispatch — cohérent car les deux écrivent la
  // même classe sur le même nœud.
  // un nom de garde par texte de classes : `-` devient `_`, tout autre signe (dont `_` et `$`) son code entre deux `$` — `is-on` et `is_on` ne partagent plus leur garde
  const safeCls = className.replace(/[^a-zA-Z0-9]/g, (c) => c === '-' ? '_' : '$' + c.charCodeAt(0).toString(36) + '$')
  const guardProp = `_mjs_node._mjs_cl_${safeCls}`
  // `@class{cond}="foo bar"` (multi-classes) : un token
  // avec espace fait jeter `classList.toggle` (InvalidCharacterError). On émet un
  // toggle par classe (tokens connus au compile). La garde reste sur `safeCls`
  // (valeur combinée) — cohérente entre updateFn et effet filtré.
  const clsTokens = className.trim().split(/\s+/).filter(Boolean)
  // le nom entre apostrophes, son apostrophe et sa barre oblique inverse échappées (`content-['x']`, classes à crochets) : sans
  // cela le code produit n'était plus du JavaScript, et la construction de toute l'appli s'arrêtait
  const clsToggle = (nodeVar: string, boolExpr: string): string =>
    clsTokens.map((c) => `${nodeVar}.classList.toggle('${c.replace(/[\\']/g, '\\$&')}', ${boolExpr});`).join(' ')
  const updateLogic = `{ const _mjs_tv = !!(${jsVar}); if (${guardProp} !== _mjs_tv) { ${clsToggle('_mjs_node', '_mjs_tv')} ${guardProp} = _mjs_tv; } }`

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    // classes absentes de la balise du gabarit de la ligne (hors bloc) : leur garde naît à faux avec la ligne que fabrique le gabarit (tplFn de
    // compile.ts, `birth`), une condition fausse ne bascule alors rien. Une ligne écrite par le serveur garde une garde indéfinie (sa
    // première passe écrit la classe, qui part si le serveur l'avait posée)
    if (!env.ctx.inBlock && missingClasses(env.node.attrs ?? [], clsTokens)) env.ctx.birth?.push(`__nodes['${env.lid}']._mjs_cl_${safeCls} = false;`)
    // Tentative de détection du pattern filtered (gain massif sur select1k).
    // On regarde le scope LOCAL : loopItem = dernier item de la chaîne ctx.loops.
    const lastLoop = env.ctx.loops && env.ctx.loops.length > 0
      ? env.ctx.loops[env.ctx.loops.length - 1]
      : null
    const filt = lastLoop
      ? detectFilteredPattern(conditionExpr, lastLoop.item, env.compiler.externalVars ?? [])
      : null

    if (filt) {
      // Code complet (DOM toggle) toujours posé pour data updates (l'updateFn
      // est appelée à chaque mutation de `data`, donc on garde la correction
      // au mount + à chaque insertion). En plus, on enregistre dans l'index
      // inverse pour que `_mjs_invalidate(externVar)` route en O(1) sur 2 rows.
      //
      // L'effect dans `_mjs_effectsByVar.<externVar>` est ajouté plus bas, hors
      // du contexte loop, et utilise un lookup direct via `_mjs_filt[<X>].idx`.
      // ATTENTION : si la même var pilote plusieurs classes ou loops, on doit
      // dispatcher tous les filtres ; ici on enregistre par (externVar, classe).
      // Normalise le className : les `-`, `:`, espaces et autres chars sont remplacés
      // par `_`. La clé n'est plus un nom de propriété (elle indexe `_mjs_filt`), mais
      // la normalisation reste : elle garde des clés lisibles et comparables.
      // `filterKey` (donc le nom de la Map
      // `_mjs_filt[<filterKey>].idx` PARTAGÉE à l'échelle du COMPOSANT) ne dépendait
      // QUE de (var externe, nom de classe) — PAS du nœud. Deux éléments
      // DIFFÉRENTS d'une même row utilisant le même couple (ex. 2 `<td>`
      // voisins avec `@class{item.id === $sel}="hot"`) partageaient donc la
      // MÊME Map, clée par l'item de la row : `__idx.set(__k, n${lid})` du
      // second nœud écrasait l'entrée du premier → seul le DERNIER nœud
      // enregistré réagissait au changement de sélection. `env.lid` (id
      // unique par OCCURRENCE dans le template, déjà utilisé partout dans ce
      // bloc pour `n${env.lid}`) distingue maintenant chaque occurrence.
      const safeClassName = className.replace(/[^a-zA-Z0-9_$]/g, '_')
      const filterKey = `${filt.externVar}__${safeClassName}__${env.lid}`
      // `itemAccess === ''` signale pattern `item` direct (sans `.field`),
      // donc la clé est l'item lui-même (référence/primitive). Map supporte
      // les refs comme clé.
      const keyExpr = filt.itemAccess
        ? `${lastLoop!.item}.${filt.itemAccess}`
        : `${lastLoop!.item}`
      // Anti-leak : on tracke (a) le nom de l'index dans
      // `_mjs_filtIdxKeys` (Set côté instance, rempli à la naissance de l'index) pour énumérer les Maps actives au
      // destroy, et (b) la clé de la ligne (champs directs `_mjs_fk`/`_mjs_ff`, cf. filterFields) pour
      // savoir quelle entrée purger. Le runtime _mjs_reconcileList lit ces deux
      // infos au moment du `cache.delete(oldKey)`.
      // le mémo d'un filtrage par clé vit dans `_mjs_filt` (propriété POINTÉE, donc
      // raccourcie en prod) : la clé n'est plus qu'un texte d'index, jamais un nom
      const idxName = filterKey
      // Optim #1 — On évite de re-créer la closure à chaque updateFn appel.
      // La closure dépend uniquement de `n${env.lid}` (stable par row) et
      // `updateLogic` (statique), donc on ne la pose qu'une fois par (row,
      // key). Si __k change pour un item donné (rare : mutation d'id), on
      // re-créera proprement à ce moment-là.
      // Perf création : on stocke le NŒUD lui-même dans l'index, PAS une
      // closure. Sur le pattern @class filtré (toggle binaire d'UNE classe), la
      // closure `() => toggle` était allouée par ligne (10 000 sur create10k →
      // gros poste GC au profil). Le nœud est sa propre identité : l'effet
      // filtré (plus bas) fait le toggle directement, et la purge runtime
      // compare `idx.get(k) === <nœud>` exactement comme avant (le nœud joue le
      // rôle de l'ancienne fn dans _mjs_filterFns).
      //
      // Propriété de clé : on (re)pose si la clé est inédite OU
      // détenue par une AUTRE row (vol de clé create-avant-destroy). La purge ne
      // delete que si l'entrée est encore la nôtre. Update répété → skip.
      // plusieurs lignes peuvent porter la valeur (cf. severalLines) : l'index garde alors la
      // fonction de chaque ligne (un Set quand une clé en porte plusieurs), non son nœud, et une
      // ligne qui change de clé (champ filtré modifié, ligne positionnelle d'une liste sans clé)
      // lâche son ancienne entrée (cf. setFilteredFunction). La boucle seule filtrée sur sa clé
      // garde l'index de nœuds d'avant, à l'octet
      const drop   = !filterOnKey(lastLoop, filt.itemAccess)
      const multi  = severalLines(drop, env.ctx.loops)
      const create = `const __f = (_mjs_match) => { ${clsToggle(`_mjs_n${env.lid}`, '_mjs_match')} _mjs_n${env.lid}._mjs_cl_${safeCls} = _mjs_match; }; `
      const fields = filterFields(lastLoop!, idxName)
      const sets   = multi
        ? setFilteredFunction(create, fields, false, drop, true)
        : `if (${fields.fn} === void 0 || __idx.get(__k) !== _mjs_n${env.lid}) { __idx.set(__k, _mjs_n${env.lid}); ${fields.fn} = _mjs_n${env.lid}; } `
      // l'index stocke le NŒUD de la ligne (sans `multi`) : l'effet de la racine bascule la classe directement, sans
      // appel de fonction, et tient à jour la garde `_mjs_cl_${safeCls}` que relit la passe de la ligne
      filteredBinding(env, filt.externVar, idxName, fields, keyExpr, updateLogic, sets, multi, (value, on) => `const _mjs_nd = _mjs_idx.get(${value}); if (_mjs_nd) { ${clsToggle('_mjs_nd', on)} _mjs_nd._mjs_cl_${safeCls} = ${on}; }`)
      return id
    }

    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogic} } }`)
    // condition NON filtrable lisant une var externe
    // (`@class{$cond}="on"`) : sans `structVars`, `_mjs_renderStruct` sauté → classe
    // figée à vie. Le chemin filtré (au-dessus) a son effect dédié → déjà `return`é.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await} ; un {if}/{key} imbriqué dedans en hérite) : la classe
    // n'était posée nulle part, ni dans l'attente ni dans {success} ni dans {error}
    // même schéma que bindingStandard : pose initiale dans la createFn de la branche (`__nodes[id]`, les refs
    // ne sont fusionnées dans `this._mjs_nodes` qu'après), puis suivi par un effet de la racine car
    // `_mjs_updAwait` ne rejoue pas le contenu d'une branche déjà réglée ; sans variable réactive dans la
    // condition, la pose initiale suffit. Un `{const}` lu par la condition est recréé par l'effet : l'effet
    // suit donc aussi les variables que ce `{const}` lit
    env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`)
    const effectVars = [...new Set([...vars, ...constVars(env, jsVar)])]
    if (effectVars.length > 0) registerEffect(rootBindingEffect(env, id, jsVar, updateLogic), effectVars)
  }
  return id
}

// ============================================================================
// BindingStyle — port de attributes/binding_style.rb
// @style.color="{$theme}" ou @style.bg{$active}="red"
// ============================================================================
function bindingStyle(env: AttrCtx): AttrResult {
  const isConditional = (env.attrName ?? '').includes('{')

  let cssProp: string
  let conditionExpr: string
  let rawVal: string
  let jsCond: string

  if (isConditional) {
    const m = (env.attrName ?? '').match(/@style\.([a-zA-Z0-9\-]+)\{(.+)\}/)
    if (!m) return { id: env.id }
    cssProp = m[1]
    conditionExpr = m[2]
    rawVal = env.rawVal.toString()
    // Site EXPR (condition @style.X{cond}, même nature qu'un {if}).
    jsCond = cleanTemplateExpr(conditionExpr, env.compiler.externalVars, env.compiler.moduleName)
  } else {
    cssProp = (env.attrName ?? '').replace(/^@style\./, '')
    conditionExpr = env.attr.type === 'dynamic' ? (env.attr.expr ?? '') : env.rawVal
    rawVal = env.attr.type === 'dynamic' ? `{${env.attr.expr}}` : env.rawVal
    jsCond = 'true'
  }

  const varSet = new Set<string>()
  if (isConditional) {
    for (const v of getEffectVars(conditionExpr)) varSet.add(v)
  }

  let jsVal: string
  // expression PLEINE (`rawVal` vaut EXACTEMENT `{expr}`,
  // rien avant/après) : gardée à part en JS BRUT, non encore coercée en chaîne. Un
  // mélange texte+expression (`"pre-{$e}-post"`) n'entre PAS dans ce cas — `fullExprRaw`
  // reste `null`, `jsVal` (gabarit) reste le seul chemin, inchangé.
  let fullExprRaw: string | null = null
  if (rawVal.includes('{')) {
    // deps via `getEffectVars(rawVal)` (blocs équilibrés
    // + tentative expression entière), PAS la regex naïve `/\{([^}]+)\}/` qui
    // tronquait au 1er `}` : `@style.width="{f({k: $w})}px"` perdait `$w` de ses
    // deps → style figé au mount, jamais réactif.
    // `isRawText: true` — `rawVal` reste du texte d'attribut (mélange statique/`{expr}`,
    // ex. `"pre-{$e}-post"`), pas une expression de code : masquer comme du Civet blanchirait
    // à tort une apostrophe de prose ordinaire (« l'exemple ») jusqu'à la fin de la valeur.
    for (const v of getEffectVars(rawVal, true)) varSet.add(v)
    const fullMatch = rawVal.match(/^\{([\s\S]+)\}$/)
    if (fullMatch) fullExprRaw = cleanTemplateExpr(fullMatch[1], env.compiler.externalVars, env.compiler.moduleName)
    // Site EXPR (interpolation @style.X="pre-{$e}-post") — scan ÉQUILIBRÉ
    // (`buildTemplateFromSegments`/`splitBraceSegments`, cf. `interpolation()` ci-dessus),
    // PAS la regex naïve `/\{([^}]+)\}/` qui refermait sur le PREMIER `}` : un objet littéral
    // imbriqué (`{f({k: $w})}`) tronquait l'expression avant sa vraie fin → échec de
    // compilation sur du CSS pourtant valide.
    jsVal = buildTemplateFromSegments(splitBraceSegments(rawVal), env.compiler.externalVars, env.compiler.moduleName)
  } else {
    // `JSON.stringify` (gère quotes ET backslashes),
    // PAS `'${rawVal}'` : `@style.grid-template-areas="'hd' 'main'"` produisait
    // `const _mjs_v = ''hd' 'main'';` (littéral JS invalide → SyntaxError au parse
    // du module → TOUTE la réactivité du composant morte).
    jsVal = JSON.stringify(rawVal)
  }

  const vars = Array.from(varSet)
  const id = env.id ?? `s${++state.counter}`

  // `_mjs_node`/`_mjs_v` (pas `node`/`v` nus) : `jsVal`/`jsCond` embarquent une
  // expression UTILISATEUR (ex. `@style.color={node}` où `node` est une
  // variable de SCRIPT top-level, PAS un item de {for} — donc invisible à
  // `RESERVED_TEMPLATE_NAMES`/`rejectReservedName`, qui ne garde que les noms
  // d'item/index/const/success/error). Avec l'ancien nom `node` : la lecture
  // de la variable user retombait sur CE `const node` (l'élément DOM lui-même)
  // → `${node}` interpolait `[object HTMLElement]` (valeur CSS invalide,
  // silencieusement rejetée par le navigateur → `style.color` restait vide).
  // Bug confirmé empiriquement (tests/reserved-names-collision.test.ts).
  // branche expression pleine seulement
  // (`fullExprRaw`) : `_mjs_v` reste la valeur BRUTE (pas de gabarit) tant que
  // null/undefined/'' n'ont pas été écartés — un gabarit \`${null}\` coercerait
  // AVANT le test, en la CHAÎNE "null" (non vide, le test passait à côté). Une
  // fois la valeur confirmée posable, un suffixe `!important` (casse/espaces
  // libres) est détaché de la chaîne et posé en 3e argument de `setProperty` —
  // à 2 arguments, la CSSOM rejette la valeur ENTIÈRE, en silence.
  const styleSetter = (rawExpr: string): string =>
    `const _mjs_v = (${rawExpr}); ` +
    `if (_mjs_v == null || _mjs_v === '') { _mjs_node.style.removeProperty('${cssProp}'); } else { ` +
    `const _mjs_s = String(_mjs_v); const _mjs_t = _mjs_s.trimEnd(); ` +
    `if (_mjs_t.toLowerCase().endsWith('!important')) { _mjs_node.style.setProperty('${cssProp}', _mjs_t.slice(0, _mjs_t.length - '!important'.length).trim(), 'important'); } ` +
    `else { _mjs_node.style.setProperty('${cssProp}', _mjs_s); } }`
  // la forme CONDITIONNELLE `@style.prop{cond}="valeur"` (syntaxe standard, cf.
  // docs/09-directives-dom.md:126, docs/17-router.md:384) court-circuitait les deux branches ci-dessus : elle
  // posait `${jsVal}` en 2e argument brut de `setProperty`, un gabarit déjà coercé en
  // chaîne (null/undefined → "null"/"undefined") et jamais passé par la détection
  // `!important`. Même `styleSetter` que la branche pleine, sur `fullExprRaw` quand la
  // valeur est une expression PLEINE (`{expr}`, test null/vide sur la valeur BRUTE avant
  // coercion) sinon sur `jsVal` (texte/mélange, déjà calculé ci-dessus) — condition
  // fausse : `removeProperty`, inchangé.
  const updateLogic = isConditional
    ? `if (!!(${jsCond})) { ${styleSetter(fullExprRaw !== null ? fullExprRaw : jsVal)} } else { _mjs_node.style.removeProperty('${cssProp}'); }`
    : fullExprRaw !== null
      ? styleSetter(fullExprRaw)
      // texte mêlé (`"{$c} !important"`) : la valeur n'est connue qu'à l'exécution ; valeur fixe suivie de `!important` : détachée ici
      : rawVal.includes('{')
        ? styleSetter(jsVal)
        : /!important\s*$/i.test(rawVal)
          ? `_mjs_node.style.setProperty('${cssProp}', ${JSON.stringify(rawVal.replace(/\s*!important\s*$/i, '').trim())}, 'important');`
          : `const _mjs_v = ${jsVal}; if (_mjs_v == null || _mjs_v === '') { _mjs_node.style.removeProperty('${cssProp}'); } else { _mjs_node.style.setProperty('${cssProp}', _mjs_v); }`

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    // Filtered dispatch pour `@style.X={cond ? a : b}` ou
    // `@style.X={item.id === $selected ? 'red' : ''}`. On reconnaît le
    // ternaire dont la cond est un pattern `item.X === $extern`. Au mute
    // de $extern, on lookup les 2 fns (old/new) au lieu de re-render N rows.
    // Limité au cas non-conditional `={...}` (pas `@style.X{cond}=...`),
    // pour rester simple — le cas `{cond}` n'est pas pris en charge.
    if (!isConditional && env.attr.type === 'dynamic') {
      const lastLoop = env.ctx.loops && env.ctx.loops.length > 0
        ? env.ctx.loops[env.ctx.loops.length - 1]
        : null
      const filt = lastLoop
        ? detectFilteredValueExpr(env.attr.expr ?? '', lastLoop.item, env.compiler.externalVars ?? [])
        : null
      if (filt) {
        // même fix que bindingClass : `env.lid`
        // distingue 2 nœuds d'une même row partageant (var, propriété CSS).
        const safeProp = cssProp.replace(/[^a-zA-Z0-9_$]/g, '_')
        const filterKey = `${filt.externVar}__style_${safeProp}__${env.lid}`
        // le mémo d'un filtrage par clé vit dans `_mjs_filt` (propriété POINTÉE, donc
        // raccourcie en prod) : la clé n'est plus qu'un texte d'index, jamais un nom
        const idxName = filterKey
        // matchValue/unmatchValue sont des expressions JS brutes (ex : `'red'`,
        // `row.label`, `true`, ...) — passées telles quelles au generator.
        // Le caller a déjà passé cleanJs si nécessaire ; ici l'expression
        // ternaire est dans `env.attr.expr` brut, donc on extrait sans
        // re-clean (les vars utilisateur déjà sigilées sont conservées).
        // même règle que hors boucle (styleSetter) : `null`, `undefined` et `''` retirent la propriété, `!important` est détaché. Une valeur
        // écrite en clair se décide ici (le code d'avant, à l'octet, pour un texte sans `!important`) ; une expression, à l'exécution
        const writeStyle = (value: string): string => {
          const v = value.trim()
          if (v === 'null' || v === 'undefined' || v === "''" || v === '""') return `_mjs_node.style.removeProperty('${cssProp}');`
          const text = /^'([^'\\]*)'$|^"([^"\\]*)"$/.exec(v)
          if (!text) return styleSetter(v)
          const raw = text[1] ?? text[2]
          if (/!important\s*$/i.test(raw)) return `_mjs_node.style.setProperty('${cssProp}', ${JSON.stringify(raw.replace(/\s*!important\s*$/i, '').trim())}, 'important');`
          return `_mjs_node.style.setProperty('${cssProp}', String(${v}));`
        }
        const setMatch      = writeStyle(filt.matchValue)
        const setUnmatch    = writeStyle(filt.unmatchValue)
        const filteredLogic = `if (!!(${filt.itemAccess ? `${lastLoop!.item}.${filt.itemAccess}` : lastLoop!.item} === _mjsThis._state.${filt.externVar})) { ${setMatch} } else { ${setUnmatch} }`
        const keyExpr       = filt.itemAccess
          ? `${lastLoop!.item}.${filt.itemAccess}`
          : `${lastLoop!.item}`
        // propriété de clé par fn (même schéma que @class et l'attribut filtrés) : (re)pose si la
        // clé est inédite ou détenue par une AUTRE ligne. L'ancien `if (!__idx.has(__k))` gardait la
        // fonction de la PREMIÈRE ligne à jamais : une liste reconstruite (un {if} qui la cache puis
        // la réaffiche) laissait l'index pointer sur les nœuds retirés — le choix suivant ne
        // touchait plus rien d'affiché, l'ancien restait allumé. Mêmes rattrapages que l'attribut
        // filtré, émis seulement là où le défaut est possible : fonction refaite à chaque passe si la
        // valeur lit la ligne, ancienne clé lâchée si le champ filtré n'est pas la clé du `by`
        const redo   = valueReadsLine([filt.matchValue, filt.unmatchValue], lastLoop!.item, filt.itemAccess, env.ctx)
        const drop   = !filterOnKey(lastLoop, filt.itemAccess)
        const multi  = severalLines(drop, env.ctx.loops)
        const create = `const __f = (_mjs_match) => { let _mjs_node = _mjs_n${env.lid}; if (_mjs_match) { ${setMatch} } else { ${setUnmatch} } }; `
        const fields = filterFields(lastLoop!, idxName)
        filteredBinding(env, filt.externVar, idxName, fields, keyExpr, filteredLogic, setFilteredFunction(create, fields, redo, drop, multi), multi, filterCall, filt.tracked)
        return { id }
      }
    }
    // `_mjs_node` (pas `node`) : doit matcher le nom utilisé par `updateLogic`
    // ci-dessus (même risque de collision qu'au root — voir son commentaire).
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${updateLogic} } }`)
    // `@style.color={$theme}` (non filtré) lisant une var externe :
    // sans `structVars`, `_mjs_renderStruct` sauté → style figé à vie sur mutation.
    // Le chemin filtré (ternaire) a son effect dédié → déjà `return`é plus haut.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await} ; un {if}/{key} imbriqué dedans en hérite) : le style, `--var={…}`
    // compris, n'était posé nulle part ; même schéma que bindingClass (pose initiale dans `__nodes[id]`, puis
    // effet de la racine quand une variable réactive est lue ; les variables qu'un `{const}` lu par la condition
    // ou la valeur lit comptent aussi, l'effet recrée ce `{const}`)
    env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`)
    const readCode   = `${jsCond} ${fullExprRaw ?? jsVal}`
    const effectVars = [...new Set([...vars, ...constVars(env, readCode)])]
    if (effectVars.length > 0) registerEffect(rootBindingEffect(env, id, readCode, updateLogic), effectVars)
  }
  return { id }
}

// ============================================================================
// BindingEffect — *neon(#0ff) : un effet de la bibliothèque, posé sur l'élément par le moteur
// (runtime/mjs_fx.ts) au montage, retiré à sa destruction. Réglages vérifiés et convertis ICI
// (effects/catalog.ts) : une valeur fixe arrive déjà propre. Le moteur ignore une seconde pose
// du même effet sur le même nœud (re-rendu d'un bloc parent) : rien ne repart de zéro tant que
// le nœud vit. Un réglage tenu par une variable (`*neon($couleur)`) est lu à la pose, puis suivi
// par une mise à jour réactive (`µ._mjs_fxSet`), avec sa règle.
// ============================================================================
// les réglages fixes d'un effet, tels que le moteur les reçoit : écrits en clair, ou, pour un alias que l'appli utilise
// plusieurs fois (ProjectEffect.table, donné par le bundler), un renvoi à la table du cœur avec ce que l'usage
// change seulement — l'alias n'est jamais recopié. Un réglage de l'alias que l'usage tient par une variable sort de
// la table : l'usage reste alors écrit en clair
function fixedCode(written: string, settings: ParsedEffect): string {
  const proj = projectEffect(written)
  if (proj?.table === undefined || !proj.fixed) return JSON.stringify(settings.fixed)
  const change: Record<string, unknown> = {}
  for (const k of Object.keys(proj.fixed)) {
    if (!(k in settings.fixed)) return JSON.stringify(settings.fixed)
  }
  for (const [k, v] of Object.entries(settings.fixed)) {
    if (!(k in proj.fixed) || JSON.stringify(v) !== JSON.stringify(proj.fixed[k])) change[k] = v
  }
  return Object.keys(change).length === 0 ? `µ._mjs_alias(${proj.table})` : `µ._mjs_alias(${proj.table}, ${JSON.stringify(change)})`
}

// la définition d'un effet CSS de l'appli, posée avant l'effet (µ._mjs_fxCustom ne la construit
// qu'une fois) ; rien pour un autre effet ; `expression` : suivie d'une virgule, pour précéder une
// expression (`(définition, effet)`), sinon d'un point-virgule
function customDef(name: string, settings: ParsedEffect, expression = false): string {
  const c = settings.custom
  if (!c || settings.base) return ''
  return `µ._mjs_fxCustom(${JSON.stringify(name)}, ${JSON.stringify({ params: c.params ?? [], decls: c.decls ?? [], keyframes: c.keyframes ?? [] })})${expression ? ', ' : '; '}`
}

// les effets donnés en réglage (`*delta(fx: *fly(up))`) : une transition embarque son animation ; un
// effet CSS de l'appli, sa définition, posée avant l'effet qui le joue
function nestedDefs(settings: ParsedEffect): string {
  let out = ''
  // un effet de l'appli, réglé ou CSS : le composant dépend de son fichier (`mjs dev` le recompile)
  if (settings.uses) state.usesProjectEffects = true
  for (const n of nestedEffects(settings.fixed)) {
    if (effectSpec(n)?.transition) state.usedAnimations.add(n)
    const p = projectEffect(n)
    if (p && !p.base) {
      out += `µ._mjs_fxCustom(${JSON.stringify(n)}, ${JSON.stringify({ params: p.params ?? [], decls: p.decls ?? [], keyframes: p.keyframes ?? [] })}); `
    }
  }
  return out
}

// un effet donné par défaut à un réglage (`*guard` tremble avec *shake) : posé dans les réglages
// fixes, il part dans le cœur comme s'il avait été écrit
function pullDefaults(name: string, settings: ParsedEffect): void {
  for (const [k, st] of Object.entries(effectSpec(name)?.settings ?? {})) {
    if (!st.pull || k in settings.fixed || k in settings.dynamic || typeof st.dflt !== 'string') continue
    settings.fixed[k] = parseEffect(name, `${k}: ${st.dflt}`).fixed[k]
  }
}

// la variable qu'un effet lit dans sa balise, `_bind` (`$x`, `$$x`) : pour *gauge, celle de son
// nombre (`{$volume}`) ou de `value` — sa plage est dans le <vars> ; pour *guard, celle que le champ
// écrit (`value=!{$age}`) — sa règle
const BARE_VAR = /^\$\$?[A-Za-z_]\w*$/
function effectBind(name: string, settings: ParsedEffect, node: { children: Array<{ type: string, expr: string | null }>, attrs: Array<{ name?: string, val?: string }> }): void {
  if (name === 'gauge') {
    const dyn  = settings.dynamic.value
    const expr = node.children.find(c => c.type === 'expr' && BARE_VAR.test((c.expr ?? '').trim()))?.expr?.trim()
    const v    = dyn ?? expr
    if (v && BARE_VAR.test(v)) settings.fixed._bind = v
  }
  if (name === 'guard') {
    const a = node.attrs.find(x => (x.name === 'value' || x.name === 'checked') && /^!(?:\.\w+)?\{\s*\$\$?[A-Za-z_]\w*\s*\}$/.test(x.val ?? ''))
    if (a) settings.fixed._bind = /(\$\$?[A-Za-z_]\w*)/.exec(a.val!)![1]
  }
}

// le texte d'une balise tel que le moteur le lit (`textContent.trim() !== ''` sur le texte DÉCODÉ par le navigateur) : le gabarit écrit `&nbsp;`, le moteur
// lit U+00A0, un blanc. Une référence ne compte comme du texte que si on la lit à coup sûr (un nombre qui donne un caractère visible, un nom de cette
// liste, tous des caractères visibles) ; les autres (un blanc écrit en entité, un nom inconnu, un nom sans `;`, un nombre hors plage) ne comptent pour
// rien, et la balise dont les éléments sont ainsi séparés demande le mode : dans le doute, il part
const SOLID_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'copy', 'reg', 'trade', 'bull', 'middot', 'hellip', 'mdash', 'ndash', 'laquo', 'raquo', 'lsquo', 'rsquo', 'ldquo', 'rdquo', 'deg', 'euro', 'pound', 'cent', 'times', 'plusmn', 'sect', 'para', 'hearts', 'star', 'starf', 'check', 'rarr', 'larr', 'ast', 'vert', 'sol', 'lrm', 'rlm', 'zwj', 'zwnj', 'shy'])
const visibleCode    = (code: number): boolean => code >= 0x20 && code <= 0x10FFFF && !(code >= 0x7F && code <= 0x9F) && !(code >= 0xD800 && code <= 0xDFFF) && String.fromCodePoint(code).trim() !== ''
// ce que l'analyseur HTML du navigateur ne garde pas comme du texte : toute construction `<!…>`, `<?…>`, `</…>` (un commentaire, ou rien : il la ferme au premier `>`, dans
// `<![CDATA[a>b]]>` il reste `b]]>`) et U+0000 (ignoré). Les constructions sont ôtées avant U+0000 : un U+0000 entre `<` et `!` les sépare, c'est du texte. Une construction ouverte
// sans `>` dans le nœud avale la suite du gabarit (une fermante, les frères) : ce que le navigateur verra n'est plus lisible, `null`
const CONSTRUCTION = /<[!?\/][^>]*>/g
const OPEN_MARKUP  = /<[!?\/]/
function keptText(raw: string): string | null {
  const closed = raw.replace(CONSTRUCTION, '')
  if (OPEN_MARKUP.test(closed)) return null
  return closed.replace(/\u0000/g, '')
}
function solidText(raw: string): boolean {
  const kept = keptText(raw)
  if (kept === null) return false
  const read = (ref: string, hex?: string, dec?: string, named?: string): string => {
    if (named) return ref.endsWith(';') && SOLID_ENTITIES.has(named) ? 'x' : ''
    return visibleCode(parseInt((hex ?? dec)!, hex ? 16 : 10)) ? 'x' : ''
  }
  return kept.replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));?/g, read).trim() !== ''
}
// un nœud de texte dont une construction reste ouverte, n'importe où sous la balise : le navigateur en avale la suite (la fermante d'un frère, d'autres frères), l'arbre
// que le compilateur lit n'est plus celui du moteur
const textLost = (nodes: Node[]): boolean => nodes.some(c => c.type === 'text' ? keptText(c.content ?? '') === null : textLost(c.children) || c.branches.some(b => textLost(b.children)))

// le HTML brut : `{{ x }}` (le parseur le marque) et toute interpolation dont l'expression commence par `{` (`{ {x} }`) : le générateur (compile.ts) et `effectKids` le lisent par ce seul prédicat
export const isRawExpr = (node: Node): boolean => node._is_raw === true || (node.expr ?? '').startsWith('{')

// *marquee : le défilé des balises (la piste des enfants de mjs_fx_marquee.ts) n'est envoyé qu'aux applis dont une pose le demande. Une pose
// le demande par `unit: child` ; le build lit les poses, jamais le gabarit, alors le compilateur l'écrit lui-même quand il voit que la balise
// peut recevoir des balises. Du texte (fixe, interpolé, avec ou sans balises en ligne) ne le demande pas, ni une balise vide qu'un script
// remplira (le gabarit ne le dit pas : l'auteur écrit `unit: child`). Le moteur prend la piste quand TOUS les nœuds de la balise sont des
// éléments : un texte fixe parmi eux garde le calque du texte. Mais une construction qui peut écrire des balises (`{for}`, `<slot>`, un
// composant, du HTML inséré tel quel) les demande toujours : dans le doute, le mode part. `drag`, `axis: both` et `on: scroll` écrits en clair
// demandent déjà la piste, le build les lit : rien à ajouter
function effectKids(name: string, settings: ParsedEffect, node: Node): void {
  if (name !== 'marquee' || 'unit' in settings.dynamic) return
  const f = settings.fixed
  // `unit: auto` écrit en clair est le défaut : la pose ne le porte pas (à l'exécution, `auto` ne reste que pour une variable, dont le build garde le mode)
  if (f.unit === 'auto') delete f.unit
  if (f.unit !== undefined) return
  if (f.drag === true || f.axis === 'both' || f.on === 'scroll') return
  let plain = false
  // `@html=!{…}` remplit la balise de HTML depuis le gabarit, sans passer par ses enfants : jamais lu ici, dans le doute le mode part
  let risky = node.attrs.some((a) => /^@html(?:[.{]|$)/.test(a.name ?? ''))
  const scan = (nodes: Node[]): void => {
    for (const c of nodes) {
      if (c.type === 'tag') {
        const tag = (c.name ?? '').toLowerCase()
        if (tag === 'slot' || tag.includes('-')) risky = true
        else plain = true
      }
      else if (c.type === 'expr') risky ||= isRawExpr(c)
      else if (c.type === 'for') risky = true
      else {
        scan(c.children)
        for (const b of c.branches) scan(b.children)
      }
    }
  }
  scan(node.children)
  const text = node.children.some(c => c.type === 'text' && solidText(c.content ?? ''))
  if (risky || textLost(node.children) || (plain && !text)) f.unit = 'child'
}

/** La faute d'un effet porte la ligne de sa balise (`mjsLine`, celle du HTML recollé) : le bundler l'écrit dans le message,
 * juste après le nom de l'effet, une fois contrôlée contre le fichier (transpile-msg.ts). Le message lui-même ne change pas : les
 * fautes qu'un appel direct à `transpile()` rend gardent leur forme. */
function locateFault(err: unknown, line: number | undefined): unknown {
  if (err instanceof Error && line) (err as Error & { mjsLine?: number }).mjsLine = line
  return err
}

function bindingEffect(env: AttrCtx): AttrResult {
  const written = (env.attrName ?? '').slice(1)
  let settings: ParsedEffect
  let name: string
  // toute faute de cet effet (nom inconnu, réglage faux, mauvaise balise, connexion absente) porte la ligne de sa balise
  try {
    settings = parseEffect(written, env.rawVal, env.ctx.locals ? Array.from(env.ctx.locals) : [])
    // un effet de l'appli : réglé, c'est l'effet de la bibliothèque qui se pose ; CSS, sa définition part avec
    name     = settings.base ?? written
    // un garde muet ne joue aucun effet de refus : *shake ne part pas au cœur
    if (name === 'guard' && settings.fixed.silent === true && !('fx' in settings.fixed) && !('fx' in settings.dynamic)) settings.fixed.fx = 'none'
    pullDefaults(name, settings)
    defaultSock(name, written, settings, state.instanceProps.has('sock'))
    effectBind(name, settings, env.node as any)
    effectKids(name, settings, env.node)
    if (projectEffect(written)) state.usesProjectEffects = true
    checkPlacement(name, settings, env.node.name ?? '', !!(env.ctx.svgNs || env.ctx.foreign), written)
  }
  catch (err) {
    throw locateFault(err, env.node.line)
  }
  // une transition posée directement joue son animation (runtime/animations/<nom>.ts)
  if (effectSpec(name)!.transition) state.usedAnimations.add(name)
  const before = customDef(written, settings) + nestedDefs(settings)
  const id     = env.id ?? `a${++state.counter}`
  // retrait de l'effet à la destruction du nœud ou du composant → chemin de destruction complet
  state.hasDestroyHooks = true
  const nodeRef         = env.ctx.type === 'root' ? `this._mjs_nodes.${id}` : env.ctx.type === 'for' ? `__nodes['${env.lid}']` : `__nodes['${id}']`
  const dynKeys         = Object.keys(settings.dynamic)
  const fixed           = fixedCode(written, settings)
  if (dynKeys.length === 0) {
    env.ctx.updates.push(`{ const _mjs_fxn = ${nodeRef}; if(_mjs_fxn) { ${before}µ._mjs_fx(this, _mjs_fxn, ${JSON.stringify(name)}, ${fixed}); } }`)
    return { id }
  }
  const dyn  = '{' + dynKeys.map(k => `${JSON.stringify(k)}: (${cleanTemplateExpr(settings.dynamic[k], env.compiler.externalVars, env.compiler.moduleName)})`).join(', ') + '}'
  const spec = JSON.stringify(settings.spec)
  const vars = [...new Set(dynKeys.flatMap(k => getEffectVars(settings.dynamic[k])))]
  env.ctx.updates.push(`{ const _mjs_fxn = ${nodeRef}; if(_mjs_fxn) { ${before}µ._mjs_fx(this, _mjs_fxn, ${JSON.stringify(name)}, ${fixed}, ${dyn}, ${spec}); } }`)
  const follow = `{ const _mjs_fxn = ${nodeRef}; if(_mjs_fxn) { µ._mjs_fxSet(_mjs_fxn, ${JSON.stringify(name)}, ${dyn}, ${spec}); } }`
  if (env.ctx.type === 'root') pushUpdate(env, follow, vars)
  else {
    env.ctx.updates.push(follow)
    // variable externe lue dans un bloc : le rendu structurel repasse quand elle change
    for (const v of vars) state.structVars.add(v)
  }
  return { id }
}

/** Vrai si `code` lit un nom que le gabarit met en portée ici (variable ou index d'un `{for}`,
 * `{const}`, valeur d'une branche `{await}`) ; une variable de boucle déstructurée compte pour
 * chacun de ses noms. */
function readsScope(env: AttrCtx, code: string): boolean {
  for (const local of env.ctx.locals ?? []) {
    for (const name of local.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(code)) return true
    }
  }
  return false
}

// le `<script>` de l'auteur déclare-t-il `el` à sa racine (variable, fonction, classe, import) ? Lu sur le JS que l'analyseur garde du script, jamais sur le
// `<script module>` ni sur un `@import` (le générateur ne les reçoit pas). Mémorisé par analyseur, il y en a un par compilation
const SCRIPT_DECLARE_EL = new WeakMap<object, boolean>()

function scriptDeclareEl(): boolean {
  const analyzer = state.analyzer
  const code     = analyzer?.modifiedCode
  if (typeof code !== 'string' || !code.includes('el')) return false
  const known = SCRIPT_DECLARE_EL.get(analyzer)
  if (known !== undefined) return known
  let declared = false
  try {
    const imported = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body.some((s: any) => s.type === 'ImportDeclaration' && s.specifiers.some((sp: any) => sp.local.name === 'el'))
    // une lecture de `el` ajoutée au bout du script reste libre tant que rien ne le déclare à sa racine (`var` des blocs compris)
    const free = freeIdentifiers(`${code}\n;el;`)
    declared   = imported || (free !== null && !free.has('el'))
  }
  catch {
    // script illisible : une autre passe le dira, `el` reste alors celui du framework
  }
  SCRIPT_DECLARE_EL.set(analyzer, declared)
  return declared
}

// `@offscreen` : hors de l'écran, la balise n'est ni mise en page ni peinte (`content-visibility: auto`) ; sa place réservée, `auto` devant
// (le navigateur retient la taille vue), compte pour une ligne pas encore vue. Un attribut fixe sur la balise, et une règle par taille au style
// de base du composant (transpiler/index.ts) : rien à l'exécution, rien pour un composant qui ne l'écrit pas. Valeur : un nombre de pixels ou une
// longueur fixe, 24px sans valeur. Une balise de tableau est refusée : le navigateur ne saute jamais sa mise en page. Un `<li>` aussi : son
// numéro ou sa puce, peint hors de la balise, serait rogné, et une balise intérieure ne le sauve pas sous WebKit, qui y range le numéro
const OFFSCREEN_TABLE_TAGS = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup']
const OFFSCREEN_LENGTH  = /^(\d+(?:\.\d+)?)(px|r?em|ex|ch|r?lh|[sld]?v[hw]|vmin|vmax|cm|mm|in|pt|pc)?$/

function bindingOffscreen(env: AttrCtx, written: string, bare: boolean): AttrResult {
  const tag = (env.node.name ?? '').toLowerCase()
  if (OFFSCREEN_TABLE_TAGS.includes(tag)) throw new Error(t('generator.offscreen-table', { tag: tag }))
  if (tag === 'li') throw new Error(t('generator.offscreen-li', {}))
  const isDynamic = env.attr.type === 'dynamic'
  const m         = bare ? null : OFFSCREEN_LENGTH.exec(isDynamic ? '' : written.trim())
  if (!bare && (!m || parseFloat(m[1]) === 0)) throw new Error(t('generator.offscreen-value', { written: isDynamic ? `{${String(env.attr.expr ?? '').trim()}}` : written }))
  const size = m ? m[1] + (m[2] ?? 'px') : '24px'
  state.offscreen.add(size)
  return { attrStr: env.attrStr + ` mjs-offscreen='${size}'`, id: env.id }
}

// `@wake=view|interaction` sur la balise d'un composant : rendu par le serveur, il ne se réveille qu'à la vue ou au premier signe d'intention
// sur lui, la page du serveur restant affichée jusque-là (runtime/mjs_wake.ts, au cœur seulement si une page l'écrit). Un attribut fixe sur
// la balise, rendu aussi par le serveur, le même code pour les deux valeurs. Avec `interaction`, ce que l'utilisateur a fait dans la page du
// serveur (le focus, une saisie, une case…) passe au réveil à la vue, par la place de chaque élément dans le gabarit, en `ssr` comme en
// `ssr:markers` ; le runtime réveille `interaction` comme `view` en `ssr:positional` et `ssr:diff`. `idle` est refusée (le réveil au repos
// du navigateur fait plus de travail qu'une page sans `@wake`, sans gain sur `view`) ; une balise qui n'est pas un composant aussi. Construit
// pour le développement, le composant pose aussi les textes que la console affiche quand `@wake` est sans tout son effet (cf. mjs_wake.ts) :
// la balise n'a plus de page du serveur à garder, ou, sans boîte, elle n'affiche que du texte ; avec `interaction`, la vue n'a pas à sa place
// un élément où l'utilisateur a fait quelque chose dans la page du serveur. Une fois par composant
const WAKE_VALUES = ['view', 'interaction']

function bindingWake(env: AttrCtx, writtenValue: string, bare: boolean): AttrResult {
  const tag = (env.node.name ?? '').toLowerCase()
  if (!tag.startsWith('mjs-')) throw new Error(t('generator.wake-component', { tag: tag }))
  const isDynamic = env.attr.type === 'dynamic'
  const value     = isDynamic || bare ? '' : writtenValue.trim()
  if (value === 'idle') throw new Error(t('generator.wake-idle', {}))
  if (!WAKE_VALUES.includes(value)) throw new Error(t('generator.wake-value', { written: isDynamic ? `${written('wake')}={${String(env.attr.expr ?? '').trim()}}` : bare ? written('wake') : `${written('wake')}=${writtenValue}` }))
  if (state.devWarnings && !state.initialPropBinds.some((b) => b.includes('_mjs_wakeLost'))) state.initialPropBinds.push(`{ µ._mjs_wakeLost ??= ${JSON.stringify(t('generator.wake-no-effect', {}))}; µ._mjs_wakeText ??= ${JSON.stringify(t('generator.wake-no-box', {}))}; }`)
  if (state.devWarnings && value === 'interaction' && !state.initialPropBinds.some((b) => b.includes('_mjs_wakeMiss'))) state.initialPropBinds.push(`{ µ._mjs_wakeMiss ??= ${JSON.stringify(t('generator.wake-mismatch', {}))}; }`)
  return { attrStr: env.attrStr + ` mjs-wake='${value}'`, id: env.id }
}

// `@size="largeurxhauteur"` sur la balise d'un composant de l'appli : en fichiers séparés, la place que garde sa balise tant que son code
// n'est pas arrivé, vide (le bouclier du cœur la cache sans toucher à sa taille) ou avec la silhouette de `*skeleton` dans cette place ; ce
// qui la suit ne bouge pas à son arrivée s'il a la taille annoncée. Un attribut fixe sur la balise et une règle par valeur au style de base
// du composant qui l'écrit (transpiler/index.ts, cf. sizeCss), qui ne vaut que tant que la balise n'est ni définie ni rendue par le
// serveur : rien à l'exécution, rien pour un composant qui ne l'écrit pas. Valeur : la largeur puis la hauteur séparées par `x`, chacune un
// nombre (pixels) ou une longueur en px, %, em, rem, vw ou vh ; `x48`, la hauteur seule, la largeur suit la mise en page. Construit pour le
// développement, le composant compare, à l'arrivée de l'enfant, sa hauteur à celle de la place, et sa largeur quand la valeur en donne une
// (`x48` : la hauteur seule), pour les balises de son premier rendu, et dit l'écart en console : une hauteur qui change pousse ce qui suit,
// une largeur seule ce qui est à côté. SIZE_DIRECTIVE : le nom que le lecteur donne au générateur ; l'écriture du mot (`:size`), que les
// messages et les macros citent, vient de la table des mots de MJS (parser/mjs-words.ts)
export const SIZE_DIRECTIVE = '@size'
const SIZE_ATTR             = 'mjs-size'
const SIZE_VALUE            = /^(?:(\d+(?:\.\d+)?)(px|%|r?em|v[wh])?)?x(\d+(?:\.\d+)?)(px|%|r?em|v[wh])?$/

function bindingSize(env: AttrCtx, writtenValue: string, bare: boolean): AttrResult {
  const tag = (env.node.name ?? '').toLowerCase()
  if (!tag.startsWith('mjs-') || tag.startsWith('mjs-core-')) throw new Error(t('generator.size-component', { name: written('size'), tag: tag }))
  const isDynamic = env.attr.type === 'dynamic'
  const value     = isDynamic || bare ? '' : writtenValue.trim()
  const m         = SIZE_VALUE.exec(value)
  if (!m || parseFloat(m[1] ?? '1') === 0 || parseFloat(m[3]) === 0) throw new Error(t('generator.size-value', { name: written('size'), written: isDynamic ? `${written('size')}={${String(env.attr.expr ?? '').trim()}}` : bare ? written('size') : `${written('size')}="${writtenValue}"` }))
  state.sizes.add(value)
  if (state.devWarnings && !state.initialPropBinds.some((b) => b.includes(`'[${SIZE_ATTR}]:not(:defined)'`))) {
    const vars      = { name: written('size'), tag: '%b', written: '%e', declared: '%a', actual: '%r' }
    const told      = JSON.stringify(t('generator.size-mismatch', vars))
    const widthText = JSON.stringify(t('generator.size-mismatch-width', vars))
    state.initialPropBinds.push(`{ const _mjs_sr = this._shadow || this.shadowRoot || this; requestAnimationFrame(() => _mjs_sr.querySelectorAll('[${SIZE_ATTR}]:not(:defined)').forEach((el) => { const a = el.getBoundingClientRect(), v = el.getAttribute('${SIZE_ATTR}'), f = (r) => Math.round(r.width) + ' × ' + Math.round(r.height); customElements.whenDefined(el.localName).then(() => requestAnimationFrame(() => requestAnimationFrame(() => { const b = el.getBoundingClientRect(), h = Math.abs(a.height - b.height) > 1; if (el.isConnected && (h || (v.charAt(0) !== 'x' && Math.abs(a.width - b.width) > 1))) µ.warn((h ? ${told} : ${widthText}).replace('%b', el.localName).replace('%e', v).replace('%a', f(a)).replace('%r', f(b))); }))); })); }`)
  }
  return { attrStr: env.attrStr + ` ${SIZE_ATTR}='${value}'`, id: env.id }
}

// les règles des places gardées du composant (cf. bindingSize), au style de base : vide sans `@size`
export function sizeCss(sizes: Set<string>): string {
  return [...sizes].map((value) => {
    const [, w, wu, h, hu] = SIZE_VALUE.exec(value) ?? []
    return `[${SIZE_ATTR}="${value}"]:not(:defined):not([mjs-ssr]){display:block;box-sizing:border-box;${w ? `width:${w}${wu ?? 'px'};` : ''}height:${h}${hu ?? 'px'};overflow:hidden}`
  }).join('')
}

// ============================================================================
// BindingAttach — @attach={tooltip($msg)} ou @attach={(node) -> setup}
// Mode détecté via AST : DIRECT vs FACTORY (cf. ast_daemon analyze_attach_mode)
// ============================================================================
// attache écrite en fonction dont le corps tient plusieurs instructions (`(el) -> a; b`, une instruction par ligne sous la flèche, `(el) -> a; -> b`) :
// le texte nettoyé n'est pas une seule expression, la flèche s'arrêtait à la première instruction et la suite tombait hors d'elle (`el is not defined`,
// composant non rendu). Civet le relit en une seule flèche, comme le corps d'un gestionnaire, qui rend sa dernière valeur. Sans flèche en tête, des
// instructions (`_node.focus(); _node.select()`) restent telles qu'écrites ; une flèche que Civet ne relit pas ainsi (corps illisible, que la lecture du
// gabarit laisse avec sa flèche `->`) et un texte qui ne se lit pas en instructions (`el.dataset.a = '1'; -> f()`) ne se compileraient pas : refusés à la
// construction, par un message qui dit quoi écrire
function singleExpression(js: string): boolean {
  try {
    acorn.parse(`(${js}\n)`, { ecmaVersion: 'latest', sourceType: 'module' })
    return true
  }
  catch {
    return false
  }
}
// des instructions que le code émis peut recevoir telles quelles
function hasStatements(js: string): boolean {
  try {
    acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true })
    return true
  }
  catch {
    return false
  }
}
// tête de flèche au début du texte (`(el) ->`, `(el, n = f(1)) =>`, `({ a = g(2) }) ->`, `el =>`, `->`, `async (el) =>`) : les parenthèses des paramètres
// se comptent avec crochets et accolades, sur le texte masqué (chaînes, gabarits, commentaires) — une valeur par défaut en contient
function startsWithArrow(js: string): boolean {
  const mask = maskInertSameLength(js)
  let i = (/^\s*(?:async(?=[\s(])\s*)?/.exec(mask)?.[0] ?? '').length
  if (mask[i] === '(') {
    let depth = 0
    for (; i < mask.length; i++) {
      const c = mask[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      if (depth === 0) break
    }
    if (depth !== 0) return false
    i++
  }
  else i += (/^[A-Za-z_$][\w$]*/.exec(mask.slice(i))?.[0] ?? '').length
  return /^\s*[-=]>/.test(mask.slice(i))
}
function attachAsArrow(js: string, attrName: string): string {
  if (singleExpression(js)) return js
  if (startsWithArrow(js)) {
    let read = ''
    try {
      read = getCivetCompile()(`(${js})`, { js: true, sync: true }).trim().replace(/;$/, '')
    }
    catch {
      read = ''
    }
    if (read !== '' && singleExpression(read)) return read
  }
  else if (hasStatements(js)) return js
  throw new Error(t('generator.attach-body-unreadable', { attrName: shownName(attrName) }))
}

function bindingAttach(env: AttrCtx): AttrResult {
  // seul modificateur : `.once`, la fabrique est appelée une fois par balise, jamais rejouée
  const modifiers = (env.attrName ?? '').split('.').slice(1)
  for (const mod of modifiers) {
    if (mod === 'once') continue
    const suggestion = suggestKey(mod, ['once'])
    const hint = suggestion && suggestion !== mod ? t('generator.hint-modifier-suggestion', { suggestion }) : ''
    throw new Error(t('generator.attach-modifier-unknown', { attrName: shownName(env.attrName ?? ''), mod, hint }))
  }
  const once = modifiers.includes('once')
  const rawExpr = env.attr.expr ?? env.attr.val
  if (!rawExpr) return { id: env.id }

  const jsFunc = attachAsArrow(cleanJs(rawExpr, env.compiler.externalVars, false, env.compiler.moduleName), env.attrName ?? '')
  // setTimeout / setInterval : refusés comme dans les autres accolades du gabarit — l'attache se rejoue à chaque pose de la balise
  rejectTemplateTimer(jsFunc)

  // `.once` : aucune variable suivie, la balise déjà attachée n'est jamais reposée
  // une attache agit, elle ne s'affiche pas : une fonction du <script> qu'elle appelle n'y est pas suivie, elle garde son seul
  // passage (une fonction qui écrit un magasin s'y relançait sur sa propre écriture) ; une méthode `@f` l'est, comme toujours
  const vars = once ? [] : getEffectVars(rawExpr, false, true)
  const id = env.id ?? `a${++state.counter}`
  // `@attach` installe un teardown `_mjs_td` → destroy walker requis.
  state.hasDestroyHooks = true

  // `el`, second nom de la balise à côté de `_node` : l'expression qui le lit sans que rien ne le lie (ni paramètre ou déclaration de l'expression, ni `<script>` de
  // l'auteur, ni `@this=!{el}`) est écrite à la main comme avec `_node` (mode direct) et reçoit la balise sous ce nom ; le `el` de l'auteur garde la main, le mode ne change pas
  // une attache faite de plusieurs instructions (`el.dataset.a = '1'; el.dataset.b = '2'`) ne se lit pas entre parenthèses : ses noms se lisent sur ses instructions
  const readsEl  = /\bel\b/.test(jsFunc) && (freeIdentifiers(`(${jsFunc});`) ?? freeIdentifiers(jsFunc))?.has('el') === true && !state.refVars.has('el') && !scriptDeclareEl()
  const isDirect = readsEl || /\b_node\b/.test(jsFunc)
  const mode     = isDirect ? 'direct' : 'factory'

  const evalBody = mode === 'factory'
    ? `const _mjs_setup = ${jsFunc}; _mjs_clean = (typeof _mjs_setup === 'function') ? _mjs_setup(_node) : null;`
    : `${readsEl ? 'const el = _node; ' : ''}_mjs_clean = ${jsFunc};`
  // passage de l'attache (`µ._mjs_attPass` : la balise) : une minuterie posée pendant sa partie synchrone lui appartient
  // (runtime/mjs_every.ts) et s'arrête au détachement, avec le nettoyage de l'attache — la prochaine attache en pose une neuve.
  // Appel optionnel (`?.(`) : le module des minuteries n'est au cœur que si l'appli en pose une, et lui seul pose `_node._mjs_mt` ;
  // le contrat du cœur ne réclame pas un tel appel — une appli qui a une attache et aucune minuterie se construit
  const evalBlock = `let _mjs_clean; const _mjs_ap = µ._mjs_attPass; µ._mjs_attPass = _node; try { ${evalBody} } finally { µ._mjs_attPass = _mjs_ap; } if (_node._mjs_mt) _mjs_clean = µ._mjs_attStop?.(_node, _mjs_clean);`

  // `_mjs_att` : connexion du composant (`_mjs_ae`, avancé à chaque déconnexion) où la balise a reçu
  // son attache ; remis à zéro quand son nettoyage tourne (mjs_destroy_hooks.ts)
  // développement : une valeur rendue qui n'est ni une fonction ni rien (le nombre de `requestAnimationFrame`, un objet) est ignorée, mjs_debug.ts le dit
  const notFunction = state.devWarnings ? ` else if (_mjs_clean != null) µ._mjs_attachNotFn?.(this, _node, _mjs_clean, ${env.node.line ?? 0});` : ''
  // la main d'arrêt d'un `µafter … always: true` (marque 2, runtime/mjs_every.ts) n'est pas un nettoyage : son tir part
  // même après la disparition de la balise ; un `µevery … always: true` tourne jusqu'à la destruction du composant
  const attachLogic = `/* Purge précédente si params mutent */ if (_node._mjs_td) { _node._mjs_td(); if (this._mjs_attachments) this._mjs_attachments.delete(_node._mjs_td); _node._mjs_td = null; } /* Execution (mode ${mode}) */ ${evalBlock} _node._mjs_att = this._mjs_ae; if (typeof _mjs_clean === 'function') { if (_mjs_clean._mjs_timer !== 2) { _node._mjs_td = _mjs_clean; this._mjs_attachments = this._mjs_attachments || new Set(); this._mjs_attachments.add(_mjs_clean); } }${notFunction}`
  // rendu qui repasse sans rien changer pour l'attache : la balise déjà attachée ne se rejoue pas.
  // Exception, une lecture qu'aucun effet ne suit (paramètre de route `&x`, `µurl`…) : seul le
  // rendu complet de la navigation la rattrape, l'attache garde alors le rejeu à chaque rendu ; le code seul
  // compte, pas les chaînes (`mark('Q&A')` ou `mark('prix en µ')` ne lisent rien)
  const tracked = once || !/µ|&[\w$]/.test(maskNonCode(rawExpr, 'civet'))
  const guard   = `_node._mjs_att !== this._mjs_ae`

  if (env.ctx.type === 'root') {
    const code = `{ const _node = this._mjs_nodes.${id}; if(_node) { ${attachLogic} } }`
    // Deux registres :
    //   1. ctx.updates → _mjs_renderStruct (via le marqueur `_mjs_td` dans
    //      classifyUpdates) → pose l'attache sur la balise qu'un bloc struct
    //      parent vient de créer ({if}/{key}/{for}) ; une balise déjà attachée
    //      est sautée. Aussi exécuté au mount via fullRender.
    //   2. Si l'expression lit des vars réactives ($x), on enregistre aussi
    //      l'attach dans effectsByVar → re-tire quand la var change
    //      (ex. `@attach={tooltip($content)}` doit re-poser le tooltip à
    //      chaque mutation de $content). Sans ça, l'attach reste figé sur
    //      la valeur initiale.
    // Double invocation au mount possible — idempotente grâce à la garde
    // `if (_node._mjs_td) { purge; }` dans attachLogic.
    env.ctx.updates.push(tracked ? `{ const _node = this._mjs_nodes.${id}; if(_node && _node._mjs_att !== this._mjs_ae) { ${attachLogic} } }` : code)
    if (vars.length > 0) registerEffect(code, vars)
  } else if (env.ctx.type === 'for') {
    // dans une ligne, une attache SANS dépendance (ni `$x`, ni `µ`/`&x`, ni nom de la boucle ou d'un
    // `{const}`) est posée une fois par balise ; celle qui lit la ligne se rejoue quand la ligne repasse
    const free = once || (tracked && vars.length === 0 && !readsScope(env, jsFunc))
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}${free ? ` && _mjs_n${env.lid}._mjs_att !== this._mjs_ae` : ''}) { let _node = _mjs_n${env.lid}; ${attachLogic} } }`)
    // `@attach={tooltip($m)}` en row lisant une var externe : sans
    // `structVars`, `_mjs_renderStruct` sauté → l'attach reste figé sur $m initial.
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await}) : `@attach={...}` ne
    // s'exécutait jamais dans cette branche. Même remède que bindingStandard :
    // pose initiale via `__nodes[id]` (le teardown éventuel s'installe dès la
    // création du fragment), réactivité ultérieure via `registerEffect` +
    // `this._mjs_nodes[id]` si l'expression dépend d'une var réactive (même
    // garde `vars.length > 0` qu'au root).
    const initCode = `{ const _node = __nodes['${id}']; if(_node${once ? ` && ${guard}` : ''}) { ${attachLogic} } }`
    // les variables que lit un `{const}` recréé par l'effet comptent aussi : `{const t = $theme}` puis `@attach={marque(t)}` suit `$theme` ; `.once` n'en suit aucune
    const effectVars = once ? vars : [...new Set([...vars, ...constVars(env, jsFunc)])]
    const shown      = currentBranch(env)
    // branche nommée (`{success v}`, `{error err}`) et forme réactive : l'effet seul pose l'attache, comme `@emit`. Le règlement de la
    // promesse invalide `_awaits_` : la branche est créée, puis TOUS les effets tournent, celui-ci compris, sur le nœud déjà en page ; la
    // pose faite à la création de la branche (nœud encore dans son fragment) serait aussitôt nettoyée par cet effet puis refaite, la
    // fabrique appelée deux fois et son nettoyage lancé pour rien. La branche d'attente et une branche sans nom de valeur gardent la pose
    // à la création : une promesse remplacée recrée l'attente sans rendu complet derrière. Dans un `{if}` ou un `{key}` de la branche, la
    // balise née d'un changement de choix n'a aucun rendu complet derrière elle non plus : l'effet de ce bloc (cf. followedByBlock) pose
    // l'attache de ce contenu neuf (`_mjs_flip`), à l'affichage de la branche c'est le rendu complet qui s'en charge
    // `µpending` lu par la branche n'en fait pas une branche nommée : son entrée de portée n'est pas la valeur de la branche
    const named = (env.ctx.scope ?? []).some((e) => e.kind === 'await' && e.field !== 'pending')
    if (!(effectVars.length > 0 && named)) env.ctx.updates.push(initCode)
    else if (env.ctx.inBlock) env.ctx.updates.push(`if (this._mjs_flip) ${initCode}`)
    if (effectVars.length > 0) {
      // effet posé à la racine : valeur `{await}` et `{const}` de la branche recréés s'ils sont lus, et seulement quand cette
      // branche est celle qui est affichée (cf. currentBranch), que la fabrique lise la valeur de la branche ou non : promesse
      // remplacée ou rejetée, la valeur lue vaut `null` et `marque(v.label, $theme)` ferait tomber le composant quand `$theme`
      // change ; `marque($theme)` rejouerait la fabrique sur un nœud retiré de la page, dont personne ne défera plus la pose
      const prelude      = scopeSkeleton(env, jsFunc, () => '', 'js')
      const reactiveCode = `{ const _node = this._mjs_nodes.${id}; if(_node${shown ? ` && ${shown}` : ''}) { ${prelude}${attachLogic} } }`
      registerEffect(reactiveCode, effectVars)
    }
  }
  return { id }
}

// ============================================================================
// @emit.EVENT_NAME={expr} (réactif) / @emit.once.EVENT_NAME={expr} (mount only)
// `this._mjs_emit(eventName, data)` existe déjà côté runtime (mjs_element.ts,
// INCHANGÉ ici) — on ne fait qu'évaluer `expr` et le rappeler à chaque
// changement de dépendance réactive (forme réactive standard, comme n'importe
// quel `={expr}` du framework) ou UNE seule fois au montage (`.once`).
// ============================================================================
function bindingEmit(env: AttrCtx): AttrResult {
  const attrName = env.attrName ?? ''
  const segs = attrName.slice('@emit.'.length).split('.')
  let isOnce: boolean
  let eventName: string
  if (segs.length === 1) {
    isOnce = false
    eventName = segs[0]
  } else if (segs.length === 2 && segs[0] === 'once') {
    isOnce = true
    eventName = segs[1]
  } else {
    throw new Error(t('generator.emit-shape-not-recognized', { attrName: shownName(attrName) }))
  }
  if (!eventName) throw new Error(t('generator.emit-shape-not-recognized', { attrName: shownName(attrName) }))

  const rawExpr = env.attr.expr ?? env.attr.val
  if (!rawExpr) return { id: env.id }

  // Site EXPR (valeur d'attribut @emit.x={expr}) — même helper que dynamic().
  const jsVal = cleanTemplateExpr(rawExpr, env.compiler.externalVars, env.compiler.moduleName)

  // `.once` : `vars: []` route le code dans le bucket mount-only (jamais
  // indexé dans effectsByVar) — même patron que le Setup-only de
  // bindingDimensions (~ligne 624). Zéro mécanisme d'abonnement/désabonnement
  // à écrire : la forme réactive et `.once` partagent EXACTEMENT le même
  // branchement ci-dessous, seul `vars` diffère.
  const vars = isOnce ? [] : getEffectVars(rawExpr)
  const code = `this._mjs_emit('${eventName}', ${jsVal});`

  if (env.ctx.type === 'root') {
    // `pushUpdate` (PAS le garde `if (vars.length > 0)` de bindingAttach) :
    // ce garde ne fonctionne LÀ-BAS que parce que le code de @attach contient
    // le marqueur `_mjs_td`, que `classifyUpdates` (transpiler/index.ts)
    // range dans `struct` — donc rejoué au mount via `_mjs_renderStruct` MÊME
    // sans passer par `registerEffect`. Le code de @emit ne porte AUCUN
    // marqueur struct : sans appel INCONDITIONNEL à `registerEffect`, un
    // `vars` vide (cas `.once`, ou une forme réactive à expression pure sans
    // dépendance) ne serait JAMAIS exécuté, pas même au mount — vérifié en
    // traçant classifyUpdates/mountOnlyEffects/_mjs_eff (transpiler/index.ts).
    // `pushUpdate` est le patron RÉEL majoritaire de ce fichier (cf. `dynamic()`
    // juste au-dessus) : registerEffect INCONDITIONNEL pour root, vars=[] →
    // bucket mount-only (CompilerState.registerEffect).
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(code)
    for (const v of vars) state.structVars.add(v)
  } else {
    // ctx.type ni 'root' ni 'for' (branche {await}) : `@emit.x={...}` ne
    // s'exécutait jamais dans cette branche — ni au montage (`.once`) ni en
    // réaction à une mutation ultérieure. Le code ne référence aucun nœud
    // (`this._mjs_emit` direct, pas de `__nodes`) : safe à exécuter n'importe
    // quand après la création du composant.
    //
    // Forme RÉACTIVE (`vars.length > 0`) — `registerEffect` SEUL, jamais
    // `ctx.updates` en plus : le règlement de CETTE promesse invalide déjà
    // `'_awaits_'`, qui déclenche un rendu COMPLET (`_mjs_effectsAll`, cf.
    // mjs_element.ts `_mjs_invalidate`) — `_mjs_effectsAll` EST la liste de
    // tous les effects enregistrés via `registerEffect` (toutes vars
    // confondues, transpiler/index.ts `_mjs_eff`), donc le code y est déjà
    // rejoué une fois pile à ce règlement. L'empiler AUSSI dans
    // `ctx.updates` (créé la branche) le faisait tirer une 2e fois au MÊME
    // règlement — mesuré : root + un {await} sans rapport ailleurs n'émet
    // qu'UNE fois (comportement correct, déjà `registerEffect` seul là-bas
    // aussi, cf. `pushUpdate`) ; la mutation ultérieure d'une var suivie
    // continue de tirer une fois via le dispatch ciblé `_mjs_effectsByVar`.
    //
    // Forme `.once` (`vars` vide) — `registerEffect` route vers le bucket
    // "mount only" (jamais réindexé par var) : seul `ctx.updates` (exécuté à
    // la création de CETTE branche précise) déclenche l'émission voulue.
    //
    // L'effet de la forme réactive court à la RACINE, hors de la fonction de la branche : la
    // valeur `{await}` et les `{const}` de la branche y sont recréés s'ils sont lus (sans eux,
    // « … is not defined » dès le montage) — et seulement branche AFFICHÉE, que l'expression lise
    // la valeur de la branche ou non : avant le règlement, la valeur n'existe pas encore (`null`),
    // l'élément qui émet non plus ; une branche remplacée ou rejetée n'émet plus rien tant qu'elle
    // ne revient pas ; les variables que lit un `{const}` recréé comptent aussi : `{const c = $obj}`
    // puis `@emit.ok={c.x}` repart quand `$obj` change
    const prelude    = scopeSkeleton(env, jsVal, () => '', 'js')
    const shown      = currentBranch(env)
    const effectVars = isOnce ? vars : [...new Set([...vars, ...constVars(env, jsVal)])]
    if (effectVars.length > 0) {
      registerEffect(prelude || shown ? `if (${shown || 'true'}) { ${prelude}${code} }` : code, effectVars)
      // le contenu neuf d'un `{if}` ou d'un `{key}` de la branche n'a aucun rendu complet derrière lui : l'effet du bloc (cf. followedByBlock) l'annonce (`_mjs_flip`)
      if (env.ctx.inBlock) env.ctx.updates.push(`if (this._mjs_flip) { ${code} }`)
    }
    else env.ctx.updates.push(code)
  }
  return { id: env.id }
}

// ============================================================================
// Dispatcher principal — port de compile_tag.rb (la grosse switchcase
// d'attributs). Ordre des conditions = identique V1.
// ============================================================================
// noms posés par la PROPRIÉTÉ du nœud, jamais par le texte de l'attribut : `value` et les attributs booléens du HTML (leur seule présence vaut vrai, « false » les
// laisserait actifs). La liste du générateur, la seule : compile.ts l'importe. L'exécution en tient une copie (mjs_element.ts, `MJS_BOOLEAN_PROPS`) et l'analyseur
// la sienne pour l'attribut nu (parser/index.ts) : tests/attributs-booleens-liste-complete.test.ts les veut d'accord
// les propriétés écrites par un mot (`:disabled={…}`) : la table des mots de MJS (parser/mjs-words.ts)
export { MJS_BOOLEAN_PROPS }

const MEDIA_ATTRS = ['currentTime', 'duration', 'paused', 'volume', 'muted', 'playbackRate']
const DIM_ATTRS = ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight']

/** Découpe le corps d'un `@flip={…}` en couples `clé → valeur BRUTE`, en respectant
 * profondeur ET chaînes : `easing: 'cubic-bezier(0.25, 1, 0.5, 1)'` porte des virgules
 * qui ne séparent rien, et `duration: fn(a, b)` non plus. Le premier `:` de niveau 0
 * sépare la clé de la valeur ; la valeur est rendue VERBATIM (expression comprise).
 *
 * Dans une chaîne, un `\` CONSOMME le caractère suivant, quel qu'il soit. Le coup d'œil
 * en arrière d'avant (`part[i - 1] !== '\'`) ne distinguait pas `\'` (apostrophe échappée,
 * la chaîne continue) de `\\'` (antislash littéral PUIS fin de chaîne) : sur le second, la
 * chaîne ne se refermait jamais et avalait tous les champs suivants — build en échec. */
function splitFlipEntries(body: string): Array<[string, string]> {
  const inner = body.trim().replace(/^\{/, '').replace(/\}$/, '')
  const entries: Array<[string, string]> = []
  const pushEntry = (part: string): void => {
    let d = 0
    let q = ''
    for (let i = 0; i < part.length; i++) {
      const ch = part[i]
      if (q) { if (ch === '\\') { i++; continue }; if (ch === q) q = ''; continue }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue }
      if (ch === '(' || ch === '[' || ch === '{') d++
      else if (ch === ')' || ch === ']' || ch === '}') d--
      else if (ch === ':' && d === 0) { entries.push([part.slice(0, i).trim(), part.slice(i + 1).trim()]); return }
    }
  }
  let depth = 0
  let quote = ''
  let cur   = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote) { cur += ch; if (ch === '\\') { if (i + 1 < inner.length) cur += inner[++i]; continue }; if (ch === quote) quote = ''; continue }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { pushEntry(cur); cur = '' }
    else cur += ch
  }
  pushEntry(cur)
  return entries
}

/** Liaison d'un attribut `mjs-flip*` sur une valeur CALCULÉE (`duration: 200 * $ralenti`).
 * Même code d'update que `dynamic()` — `_mjs_updAttr` au root (+ effets), `_mjs_updAttrNode` sur la
 * row en `{for}` (+ `structVars`, sinon une var externe à la boucle fige l'attribut à vie) —
 * mais sans toucher `attrStr` : le repli statique déjà écrit (`mjs-flip='200'`) reste, et
 * l'update le remplace dès le premier rendu. Le runtime relit les trois attributs à CHAQUE
 * animation (mjs_flip.ts) : rien d'autre à réveiller.
 *
 * `secours` — SANS lui, une expression qui vaut `undefined`/`null`/`false` fait RETIRER
 * l'attribut par `_mjs_updAttrNode` (sémantique normale des attributs). CRITIQUE sur la durée :
 * `hasAttribute('mjs-flip')` est la porte d'entrée de tout le mécanisme FLIP, le nœud
 * devient invisible du système et l'animation s'arrête, sans un mot. On coalesce donc vers
 * la valeur de repli, dans une variable temporaire pour n'évaluer l'expression QU'UNE fois.
 * `delay`/`easing` le portent aussi, par symétrie : le runtime a certes ses propres défauts
 * (`isNaN → 0`, `getAttribute(…) || 'cubic-bezier(…)'`), mais l'attribut posé dit ce qui
 * s'applique au lieu de le laisser deviner — un `mjs-flip-delay` absent et un `='0'` se
 * lisent pareil au runtime, pas dans l'inspecteur.
 *
 * Le secours arrive TOUJOURS déjà encodé en littéral JS (`JSON.stringify` chez l'appelant) :
 * il vient d'une valeur écrite par l'utilisateur, et une clé dupliquée (`delay: 007, delay: $x`
 * — `splitFlipEntries` ne déduplique pas) glissait sinon `007` NU en position d'expression →
 * « Octal literals are not allowed in strict mode », build du composant en échec. Le runtime
 * relit ces trois attributs au `parseInt` : une chaîne convient exactement comme un nombre. */
function flipBinding(env: AttrCtx, attrName: string, expr: string, id: string, backup?: string): void {
  const vars  = getEffectVars(expr)
  const jsVar = cleanTemplateExpr(expr, env.compiler.externalVars, env.compiler.moduleName)
  const tmp   = `_mjsFlipVal_${id}`
  const val   = backup != null ? `(${tmp} == null || ${tmp} === false) ? ${backup} : ${tmp}` : tmp
  if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { const ${tmp} = ${jsVar}; µ._mjs_updAttrNode(_mjs_n${env.lid}, '${attrName}', ${val}${safeAttrFlag(attrName)}); } }`)
    for (const v of vars) state.structVars.add(v)
  }
  else pushUpdate(env, `{ const ${tmp} = ${jsVar}; this._mjs_updAttr('${id}', '${attrName}', ${val}${safeAttrFlag(attrName)}); }`, vars)
}

// les anciennes animations qui n'ont pas d'effet du même nom : `@in=*zoom` est refusé, `@in=*elastic_fly` ne
// joue rien — le message donne l'effet qui les remplace
const REMOVED_ANIMATIONS = new Map([
  ['zoom',          '*scale(start: 0.55)'],
  ['zoomOut',       '*scale(start: 1.45)'],
  ['elastic_fly',   '*fly(up, easing: elastic-out)'],
  ['elastic_scale', '*scale(easing: elastic-out)'],
  ['volet',         '*cover']
])

// un réglage que l'effet a, pour l'exemple d'un message : sa durée si elle a une valeur par défaut, sinon son
// réglage principal avec la sienne (`*typewriter` n'a pas de durée par défaut : sa vitesse, `speed: 30`)
function exampleSetting(name: string): string {
  const spec = effectSpec(name)
  if (!spec) return 'duration: 400ms'
  const duration = spec.settings.duration?.dflt
  if (typeof duration === 'string') return `duration: ${duration}`
  const mainDefault = spec.settings[spec.main]?.dflt
  if (typeof mainDefault === 'string' || typeof mainDefault === 'number') return `${spec.main}: ${mainDefault}`
  return 'duration: 400ms'
}

// les réglages que chaque animation d'avant lisait dans son objet (`@in.fly={ y: 200 }`) : un autre n'y faisait rien et ne passe
// pas dans la proposition ; `steps` (la finesse de ses images clés) n'a pas d'équivalent dans un effet
const OLD_COMMON = ['delay', 'duration', 'easing', 'steps']
const OLD_DIR    = ['dir', 'direction', ...OLD_COMMON]
const OLD_SETTINGS: Record<string, string[]> = {
  fade:          OLD_COMMON,
  iris:          OLD_COMMON,
  fly:           ['x', 'y', 'opacity', ...OLD_COMMON],
  slide:         ['axis', ...OLD_COMMON],
  scale:         ['start', 'opacity', ...OLD_COMMON],
  zoom:          ['start', 'opacity', ...OLD_COMMON],
  zoomOut:       ['start', 'opacity', ...OLD_COMMON],
  blur:          ['amount', 'opacity', ...OLD_COMMON],
  draw:          ['speed', ...OLD_COMMON],
  typewriter:    ['speed', 'duration'],
  pane:         OLD_DIR,
  reveal:        OLD_DIR,
  flip:          OLD_DIR,
  cube:          OLD_DIR,
  turn:          OLD_DIR,
  swipe:         OLD_DIR,
  bars:          ['count', ...OLD_DIR],
  blocks:        ['cols', 'rows', ...OLD_COMMON],
  elastic_fly:   ['y', 'delay', 'duration', 'steps'],
  elastic_scale: ['start', 'delay', 'duration', 'steps']
}

// une valeur de l'objet d'avant : fixe (un nombre, un texte), une variable écrite telle quelle (`$h`, `item.delay`), ou un calcul
type OldValue = { fixed: string | number | boolean } | { variable: string } | { compute: string }

function oldValue(n: any, src: string): OldValue {
  const text = src.slice(n.start, n.end).replace(/\s+/g, ' ')
  if (n.type === 'Literal' && ['number', 'string', 'boolean'].includes(typeof n.value)) return { fixed: n.value }
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return { fixed: n.operator === '-' ? -n.argument.value : n.argument.value }
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return { fixed: n.quasis[0].value.cooked }
  if (/^[$\p{L}_][$\p{L}\w]*(?:\.[$\p{L}_][$\p{L}\w]*)*$/u.test(text)) return { variable: text }
  return { compute: text }
}

const oldText = (v: OldValue | undefined): string => !v ? '0' : 'fixed' in v ? String(v.fixed) : 'variable' in v ? v.variable : v.compute
// une durée d'avant, en ms → celle d'un effet : 2000 → 2s, 220 → 220ms
const oldTime = (ms: number): string => ms !== 0 && ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`
// une courbe d'avant (`'cubicOut'`, `µ.easing.quadInOut`, `'ease-in'`) → son nom dans un effet (cubic-out, quad-in-out, ease-in)
const oldCurve = (name: string): string => /^cubic-bezier\(/.test(name) ? name : name.split('.').pop()!.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
const round2   = (x: number): number => Math.round(x * 100) / 100

// une longueur d'avant (`22`, `'-50%'`) : son nombre et son unité ; absente, nulle ; null pour une variable, un calcul, un texte illisible
function oldLength(v: OldValue | undefined): { n: number, unit: string } | null {
  if (!v) return { n: 0, unit: '' }
  if (!('fixed' in v)) return null
  const m = /^(-?\d*\.?\d+)(px|%|em|rem|vw|vh)?$/.exec(String(v.fixed).trim())
  return m ? { n: Number(m[1]), unit: m[2] ?? '' } : null
}

// la valeur convient à ce réglage de l'effet (sa règle au catalogue) ; une transition de l'appli (µanim.create) n'en a pas
function fitsSetting(effect: string, key: string, value: string): boolean {
  if (!effectSpec(effect)) return true
  try {
    parseEffect(effect, `${key}: ${value}`, [], true)
    return true
  }
  catch {
    return false
  }
}

interface OldTransition {
  line?: number
  written: string
  directive: string
  name: string
  effect: string
  notes: string
  settled: boolean
  replaced: boolean
  modifiers: boolean
}

/** une ancienne écriture (`@in.fly={ y: 22, duration: 220 }`) et l'effet qui la remplace, ses réglages écrits convertis
 * (`*fly(up, distance: 22, duration: 220ms)`) ; un réglage calculé devient une variable `$…` à poser dans le `<script>` — un
 * effet ne prend qu'une valeur fixe ou une variable écrite telle quelle, jamais `{…}` */
function rewriteOldTransition(attr: Attr, line?: number): OldTransition {
  const name        = OLD_TRANSITION.exec(attr.name ?? '')![2]
  const directive   = transitionDirective(attr.name ?? '')
  const written     = attr.type === 'boolean' ? '' : String(attr.expr ?? attr.val ?? '')
  const writtenAttr = shownName(attr.name ?? '') + (attr.type === 'dynamic' ? `={${written.replace(/\s+/g, ' ')}}` : written ? `="${written}"` : '')
  const replacement = REMOVED_ANIMATIONS.get(name)
  // l'effet qui la remplace et ses réglages : `*scale(start: 0.55)` → scale, [start, 0.55] ; une valeur sans nom va au principal
  const [, effect, args]  = /^\*(\w+)(?:\((.*)\))?$/.exec(replacement ?? '*' + name)!
  const spec              = effectSpec(effect)
  const settings          = (args ? args.split(', ') : []).map((a): [string, string] => a.includes(': ') ? a.split(': ') as [string, string] : [spec?.main ?? '', a])
  const notes: string[]   = []
  const without: string[] = []
  // le corps de l'objet, comme le lisait l'écriture d'avant : `{ y: 200 }` et `{{ y: 200 }}` se valent
  let body = written.trim()
  if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1).trim()
  if (body.endsWith(';')) body = body.slice(0, -1).trim()
  const set = (key: string, value: string): void => {
    const i = settings.findIndex(([k]) => k === key)
    if (i >= 0) settings[i] = [key, value]
    else settings.push([key, value])
  }
  const asVariable = (key: string, compute: string): void => {
    set(key, '$' + key)
    notes.push(t('transitions.old-compute', { setting: key, computation: compute, variable: '$' + key }))
  }
  // l'objet entier se calcule (`{$reglages}`, une condition) : un effet se règle réglage par réglage
  let object: any = null
  let whole       = false
  if (body !== '') {
    try {
      whole = (acorn.parse(`(${body})`, { ecmaVersion: 'latest' }) as any).body.length === 1
    }
    catch {
      whole = false
    }
    if (!whole) {
      try {
        const e = (acorn.parse(`({${body}})`, { ecmaVersion: 'latest' }) as any).body
        if (e.length === 1 && e[0].expression?.type === 'ObjectExpression' && e[0].expression.properties.every((p: any) => p.type === 'Property' && !p.computed && p.kind === 'init')) object = e[0].expression
      }
      catch {
        object = null
      }
      whole = !object
    }
  }
  if (whole) notes.push(t('transitions.old-object', { computation: body.replace(/\s+/g, ' '), example: `*${effect}(duration: $duration)` }))
  if (object) {
    const src   = `({${body}})`
    const read  = new Map<string, OldValue>(object.properties.map((p: any) => [p.key.type === 'Identifier' ? p.key.name : String(p.key.value), oldValue(p.value, src)]))
    const reads   = OLD_SETTINGS[name]
    let flySeen = false
    for (const [settingKey, val] of read) {
      // un réglage que l'animation ne lisait pas, ou sans équivalent ; une transition de l'appli garde tous les siens
      if ((reads && !reads.includes(settingKey)) || settingKey === 'steps') {
        without.push(settingKey)
        continue
      }
      // `x`, `y` (où la balise partait) → la direction où elle va et sa distance, à la place du premier des deux
      if (effect === 'fly' && (settingKey === 'x' || settingKey === 'y')) {
        if (flySeen) continue
        flySeen  = true
        const x  = read.get('x')
        const y  = read.get('y')
        const lx = oldLength(x)
        const ly = oldLength(y)
        if (lx && ly && (lx.n === 0 || ly.n === 0 || lx.unit === ly.unit)) {
          const unit = lx.n !== 0 ? lx.unit : ly.unit
          if (lx.n !== 0 || ly.n !== 0) set('direction', lx.n === 0 ? (ly.n > 0 ? 'up' : 'down') : ly.n === 0 ? (lx.n > 0 ? 'left' : 'right') : Math.abs(lx.n) === Math.abs(ly.n) ? `${ly.n > 0 ? 'up' : 'down'}-${lx.n > 0 ? 'left' : 'right'}` : String(round2((Math.atan2(-lx.n, ly.n) * 180 / Math.PI + 360) % 360)))
          set('distance', round2(Math.hypot(lx.n, ly.n)) + unit)
          continue
        }
        // une seule des deux tenue par une variable ou un calcul, l'autre absente ou nulle : la direction de son axe, le signe suit
        const alone = lx?.n === 0 && y && !('fixed' in y) ? ['up', y] as const : ly?.n === 0 && x && !('fixed' in x) ? ['left', x] as const : null
        if (!alone) {
          notes.push(t('transitions.old-xy', { x: oldText(x), y: oldText(y) }))
          continue
        }
        set('direction', alone[0])
        if ('variable' in alone[1]) set('distance', alone[1].variable)
        else asVariable('distance', oldText(alone[1]))
        continue
      }
      const key = settingKey === 'dir' ? 'direction' : settingKey
      // la vitesse de *draw se compte en px par seconde, celle d'avant en px par ms
      const perMs = name === 'draw' && settingKey === 'speed'
      if ('compute' in val) {
        asVariable(key, perMs ? `(${val.compute}) * 1000` : val.compute)
        continue
      }
      if ('variable' in val) {
        const curve = key === 'easing' && !val.variable.startsWith('$') ? oldCurve(val.variable) : ''
        if (curve && fitsSetting(effect, key, curve)) set(key, curve)
        else if (perMs) asVariable(key, `${val.variable} * 1000`)
        else set(key, val.variable)
        continue
      }
      const v      = val.fixed
      const number = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d*\.?\d+$/.test(v.trim()) ? Number(v) : null
      const value  = key === 'duration' || key === 'delay' ? (number !== null ? oldTime(number) : String(v))
        : key === 'easing' ? oldCurve(String(v))
        : perMs && number !== null ? String(Math.max(1, Math.round(number * 1000)))
        : typeof v === 'string' && !/^[\w.%#-]+$/.test(v) ? `'${v.replace(/'/g, '\\\'')}'`
        : String(v)
      if (fitsSetting(effect, key, value)) set(key, value)
      else without.push(settingKey)
    }
  }
  if (without.length > 0) notes.push(t('transitions.old-no-equivalent', { settings: without.join(', '), count: without.length }))
  // le réglage principal, quand c'est un mot (une direction, un axe), s'écrit en tête sans son nom : *fly(up, distance: 200)
  const i               = settings.findIndex(([k, v]) => k === spec?.main && /^[a-z]+(?:-[a-z]+)?$/.test(v))
  const writtenSettings = settings.map(([k, v]) => `${k}: ${v}`)
  const order           = i < 0 ? writtenSettings : [settings[i][1], ...writtenSettings.filter((_, j) => j !== i)]
  return {
    line,
    written: writtenAttr,
    directive:     shownName(directive),
    name,
    effect:         '*' + effect + (order.length > 0 ? `(${order.join(', ')})` : ''),
    notes:         notes.join(''),
    settled:        body !== '',
    replaced:     !!replacement,
    modifiers: directive !== (attr.name ?? '').split('.')[0]
  }
}

/** le message d'une ou de plusieurs anciennes écritures d'un composant : une seule, la phrase entière ; plusieurs, une ligne chacune */
function oldTransitionsMessage(cases: OldTransition[]): string {
  if (cases.length > 1) return t('transitions.old-many', { count: cases.length, lines: cases.map((c) => t('transitions.old-line', { line: c.line, written: c.written, writing: `${c.directive}=${c.effect}`, notes: c.notes + (c.replaced ? t('transitions.old-removed', { name: c.name }) : '') })).join('') })
  const c = cases[0]
  if (c.replaced) return t('transitions.removed', { written: c.written, directive: c.directive, effect: c.effect, notes: c.notes })
  if (!c.settled) return t('transitions.old', { written: c.written, directive: c.directive, name: c.name, setting: exampleSetting(c.name), modifiers: c.modifiers })
  return t('transitions.old-set', { written: c.written, writing: `${c.directive}=${c.effect}`, notes: c.notes, directive: c.directive, name: c.name, modifiers: c.modifiers })
}

/** l'ancienne écriture des transitions dans tout le gabarit d'un composant (`@in.fly={…}`, `@out.zoom`) : une seule erreur les
 * donne toutes, chacune avec sa ligne et sa nouvelle écriture — le build du projet les donne ainsi toutes en une construction */
export function refuseOldTransitions(root: Node): void {
  const cases: OldTransition[] = []
  const stack: Node[]        = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    // `@in.local=*fly` : l'écriture d'aujourd'hui avec un modificateur inconnu, que le répartiteur refuse à part
    for (const a of n.attrs) if (a.name && DIRECTIVES.oldSyntax(a.name, '') && !/^\*/.test(String(a.val ?? ''))) cases.push(rewriteOldTransition(a, n.line))
    const rest = [...n.children, ...n.branches.flatMap((b) => b.children)]
    for (let i = rest.length - 1; i >= 0; i--) stack.push(rest[i])
  }
  if (cases.length > 0) throw new Error(oldTransitionsMessage(cases))
}

// les gestionnaires `on…` que le navigateur connaît (norme HTML, et les normes qui l'étendent : pointeur, toucher, animations, transitions,
// sélection, plein écran) : un `on…` calculé de ces noms s'écrit `@nom={…}` ; hors de la liste (`one`, ou un événement qu'elle ne compte pas,
// `search`), le message n'affirme rien et donne les deux voies, sans nom d'événement : `@…={…}` si c'est un événement, un nom `data-…` sinon
const BROWSER_EVENTS = new Set('abort afterprint animationcancel animationend animationiteration animationstart auxclick beforeinput beforematch beforeprint beforetoggle beforeunload blur cancel canplay canplaythrough change click close command contextlost contextmenu contextrestored copy cuechange cut dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error focus formdata fullscreenchange fullscreenerror gotpointercapture hashchange input invalid keydown keypress keyup languagechange load loadeddata loadedmetadata loadstart lostpointercapture message messageerror mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup offline online pagehide pagereveal pageshow pageswap paste pause play playing pointercancel pointerdown pointerenter pointerleave pointermove pointerout pointerover pointerrawupdate pointerup popstate progress ratechange rejectionhandled reset resize scroll scrollend securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled storage submit suspend timeupdate toggle touchcancel touchend touchmove touchstart transitioncancel transitionend transitionrun transitionstart unhandledrejection unload volumechange waiting webkitanimationend webkitanimationiteration webkitanimationstart webkittransitionend wheel'.split(' '))

export function dispatchAttribute(env: AttrCtx): AttrResult {
  // Spread
  if (env.attr.type === 'spread') return spread(env)

  if (!env.attrName) return { id: env.id }

  const attrName = env.attrName
  const rawVal = env.rawVal

  // *effet(réglages)
  if (attrName.startsWith('*')) return bindingEffect(env)

  // <@module> : l'expression du composant, ses props dynamiques et l'`accept` sont traités d'un bloc
  if (attrName === 'mjs-comp') return bindingModule(env)
  if (env.node.attrs.some((a) => a.name === 'mjs-comp') && (attrName === 'mjs-accept' || propModule(env.node, env.attr))) return { id: env.id }

  // #DX — Liaison two-way MAL FORMÉE. `rawVal` commence par `!` (intention de
  // binding `=!{…}`) mais n'est pas un `!{…}` bien formé. Avant, ça retombait
  // SILENCIEUSEMENT en attribut dynamique → un attribut cassé (ex. la chaîne
  // littérale "!.number5"), sans le moindre avertissement. On échoue désormais
  // à la compilation avec un message actionnable.
  if (rawVal.startsWith('!') && !/^!\{(.+)\}$/.test(rawVal)) {
    const castMatch = rawVal.match(/^!\.(number|int|float|string|bool|boolean)\b/)
    const hint = castMatch
      ? t('generator.hint-cast-suffix-name', { attrName: shownName(attrName), cast: castMatch[1] })
      : t('generator.hint-syntax-two-way', { attrName: shownName(attrName) })
    throw new Error(t('generator.binding-two-way-malformed', { attrName: shownName(attrName), rawVal, hint }))
  }

  // @group avec !{…}
  if (DIRECTIVES.group(attrName, rawVal)) {
    return bindingGroup(env)
  }

  // @html / @text avec !{…}
  if (DIRECTIVES.content(attrName, rawVal)) {
    return bindingContent(env)
  }

  // Media attrs
  if (MEDIA_ATTRS.includes(attrName) && /^!\{(.+)\}$/.test(rawVal)) {
    return bindingMedia(env)
  }

  // Dimension attrs
  if (DIM_ATTRS.includes(attrName) && /^!\{(.+)\}$/.test(rawVal)) {
    return bindingDimensions(env)
  }

  // @this
  if (DIRECTIVES.thisOne(attrName, rawVal)) {
    return bindingThis(env)
  }
  // `@this={ref}`, sans `!` : refusé, il tombait dans le repli des événements (écoute d'un événement « this ») et la variable ne recevait
  // jamais le nœud
  if (attrName === '@this' && env.attr.type === 'dynamic') throw new Error(t('generator.this-no-exclamation-mark', { expr: String(env.attr.expr ?? '').trim() }))
  // `@this` écrit sans valeur ou avec un texte (`@this="ref"`), et `@preload` sans valeur (le préchargement d'un lien se règle par une valeur,
  // sans défaut) : refusés de même, ils tombaient aussi dans le repli des événements (écoute d'un événement « this » ou « preload »)
  const writtenValue = (env.attr.val ?? '').toString()
  const bare         = env.attr.type !== 'dynamic' && (writtenValue === '' || writtenValue === 'true')
  if (attrName === '@this') throw new Error(t('generator.this-no-reference', { written: bare ? written('this') : `${written('this')}="${writtenValue}"`, ref: !bare && /^[A-Za-z_$][\w$]*$/.test(writtenValue) ? writtenValue : 'ref' }))
  if (attrName === '@preload' && bare) throw new Error(t('generator.preload-no-value', {}))
  // `@offscreen` : toutes ses formes passent ici, avant les liaisons — une valeur calculée ne peut pas entrer dans la règle fixe
  if (DIRECTIVES.offscreen(attrName, rawVal)) return bindingOffscreen(env, writtenValue, bare)
  // `@wake` : toutes ses formes passent ici, une valeur calculée comprise (refusée)
  if (DIRECTIVES.wake(attrName, rawVal)) return bindingWake(env, writtenValue, bare)
  // `@size` : toutes ses formes passent ici, une valeur calculée comprise (refusée)
  if (DIRECTIVES.place(attrName, rawVal)) return bindingSize(env, writtenValue, bare)

  // `data-*` / `aria-*` en `!{…}` sur un composant : attribut de la balise qui suit la variable (sens unique)
  if ((env.node.name ?? '').includes('-') && COMPONENT_DOM_ATTR.test(attrName) && /^!\{(.+)\}$/.test(rawVal)) {
    return dynamic({ ...env, attr: { ...env.attr, type: 'dynamic', expr: rawVal.slice(2, -1) } })
  }

  // mjs-foo with !{...} → binding_component
  if ((env.node.name ?? '').startsWith('mjs-') && /^!\{(.+)\}$/.test(rawVal)) {
    return bindingComponent(env)
  }

  // !{…} → binding_standard (général)
  if (/^!\{(.+)\}$/.test(rawVal)) {
    return bindingStandard(env)
  }

  // CSS custom property : --xxx
  if (attrName.startsWith('--')) {
    env.attrName = `@style.${attrName}`
    return bindingStyle(env)
  }

  // @style.x
  if (DIRECTIVES.style(attrName, rawVal)) return bindingStyle(env)

  // @class{cond}
  if (DIRECTIVES.cls(attrName, rawVal)) return bindingClass(env)

  // @flip simple — `@flip`, `@flip=300`, ou `@flip={duration: 300, delay: 600, easing: '...'}`.
  if (DIRECTIVES.flip(attrName, rawVal)) {
    let duration = '200'
    let delay = ''
    let easing = ''
    // `@flip={…}` : la valeur bracée est un attribut DYNAMIQUE → son contenu
    // (équilibré par le lexer, virgules ET espaces inclus) est dans
    // `env.attr.expr`, tandis que `env.rawVal` est VIDE. Sans ce repli, toute
    // forme objet `@flip={duration: 1200}` retombait silencieusement sur 200
    // (et `{a, b}` multi-champ était tronqué). La forme simple `@flip=1200`
    // passe par `rawVal` et n'est pas concernée.
    const flipVal = (env.attr.type === 'dynamic' && env.attr.expr != null)
      ? `{${env.attr.expr}}`
      : rawVal
    // Champs CALCULÉS (`duration: 200 * $ralenti`) : non figeables au build, ils partent en
    // LIAISON plus bas. L'ancienne lecture par regex (`duration\s*:\s*(\d+)`) ne voyait que
    // le littéral — `2500 * $ralenti` était silencieusement réduit à `2500` : build vert,
    // console muette, animation qui ne suit pas.
    let durationExpr: string | null = null
    let delayExpr:    string | null = null
    let easingExpr:   string | null = null
    if (flipVal && flipVal.trim().startsWith('{')) {
      // Forme objet : on extrait duration/delay/easing (le runtime ne lit que
      // `mjs-flip` en parseInt ; delay/easing passent par des attrs dédiés).
      for (const [key, val] of splitFlipEntries(flipVal)) {
        if (!val) continue
        if (key === 'duration')   { if (/^\d+$/.test(val)) duration = val; else durationExpr = val }
        else if (key === 'delay') { if (/^\d+$/.test(val)) delay    = val; else delayExpr    = val }
        else if (key === 'easing') {
          const lit = val.match(/^(['"])([^'"]*)\1$/)
          if (lit) easing = lit[2]
          else easingExpr = val
        }
      }
    } else if (flipVal !== '->' && flipVal !== '' && flipVal !== 'true') {
      duration = flipVal
    }
    let attrStr = env.attrStr + ` mjs-flip='${duration}'`
    if (delay) attrStr += ` mjs-flip-delay='${delay}'`
    if (easing) attrStr += ` mjs-flip-easing='${easing}'`
    state.hasFlip = true
    state.hasDestroyHooks = true
    if (env.ctx.loops.length > 0) {
      const loops = env.ctx.loops
      const last  = loops[loops.length - 1]
      if (!attrStr.includes('mjs-key')) {
        // étiquette de la balise = celle de sa ligne : clé du `by` du `{for}`, la même que celle de la liste ; sans `by`, l'`id` de l'élément, à défaut l'indice de création de la ligne
        // dans une liste imbriquée, elle commence par celle de chaque ligne qui l'enveloppe, de la plus extérieure à la plus intérieure, séparées par `\u241f` (␟) : deux lignes intérieures
        // de même clé sous deux lignes extérieures restent distinctes ; une ligne extérieure dont le nom est repris plus bas ne se relit plus, son indice interne la représente
        // une ligne à plusieurs balises @flip, à toute profondeur, y ajoute la place de la balise dans le gabarit (`#place`, calculée par `placesFlip`, compile.ts)
        const lineLabel = (l: typeof last, idx: string) => l.key ? `${l.item}?.${l.key} ?? ${idx}` : `${l.item}.id !== undefined ? ${l.item}.id : ${idx}`
        const outer     = loops.slice(0, -1).map((l, i) => loops.slice(i + 1).some((m) => m.item === l.item || m.index === l.item) ? l.internalIndex : `(${lineLabel(l, l.internalIndex)})`)
        const flipLabel = outer.length ? [...outer, `(${lineLabel(last, last.index)})`].join(' + "\\u241f" + ') : lineLabel(last, last.index)
        const flipPlace = last.flipPlaces?.get(env.node)
        attrStr += flipPlace === undefined ? ` mjs-key='\${${flipLabel}}'` : ` mjs-key='\${${flipLabel}}#${flipPlace}'`
      }
    }
    // Les champs calculés se posent PAR-DESSUS le repli statique, à chaque rendu ; l'id doit
    // remonter à l'appelant pour que `this._mjs_nodes[id]` existe au root. Les trois portent une
    // valeur de SECOURS (cf. `flipBinding`) : vitale sur `mjs-flip`, qui rend le nœud visible
    // du mécanisme FLIP et ne doit JAMAIS être retiré ; par symétrie sur delay/easing.
    if (durationExpr || delayExpr || easingExpr) {
      const flipId = env.id ?? `a${++state.counter}`
      if (durationExpr) flipBinding(env, 'mjs-flip', durationExpr, flipId, JSON.stringify(duration))
      if (delayExpr)    flipBinding(env, 'mjs-flip-delay', delayExpr, flipId, JSON.stringify(delay || '0'))
      if (easingExpr)   flipBinding(env, 'mjs-flip-easing', easingExpr, flipId, JSON.stringify(easing || 'cubic-bezier(0.25, 1, 0.5, 1)'))
      return { attrStr, id: flipId }
    }
    return { attrStr, id: env.id }
  }

  // @attach
  if (DIRECTIVES.attach(attrName, rawVal)) return bindingAttach(env)

  // @childtransition
  if (DIRECTIVES.children(attrName, rawVal)) {
    // apostrophe → `&#39;` (chemin clone/innerHTML, décodée au parse).
    return { attrStr: env.attrStr + ` mjs-childtransition='${rawVal.replace(/'/g, '&#39;')}'`, id: env.id }
  }

  // @lightDom — directive instance qui rend le Shadow DOM inopérant.
  // Usage : `<mjs-foo @lightDom />` au lieu du défaut Shadow DOM closed.
  // Compile-time → émet un attribut HTML `mjs-light` lu par le constructor
  // du custom element au moment de l'upgrade.
  // Pour les rares cas où l'isolation Shadow DOM n'est pas désirée (apps
  // qui veulent Tailwind/Bootstrap global, tables géantes perf-critical,
  // intégration native avec libs tierces qui font `document.querySelector`).
  if (DIRECTIVES.lightDom(attrName, rawVal)) {
    return { attrStr: env.attrStr + ` mjs-light`, id: env.id }
  }

  // @transition=*x(…) / @in=*x / @out=*x, modificateurs .global/.shared, et @introstart / @introend /
  // @outrostart / @outroend ; l'ancienne écriture `@in.fly={…}` donne la nouvelle
  const oldTransition = OLD_TRANSITION.exec(attrName)
  if (oldTransition && DIRECTIVES.oldSyntax(attrName, rawVal)) {
    // `@in.local=*fly` : l'écriture d'aujourd'hui, avec un modificateur inconnu (habitude Svelte)
    if (/^\*/.test(String(env.attr.val ?? ''))) throw new Error(t('transitions.modifier', { directive: written(oldTransition[1]), mod: oldTransition[2] }))
    // le nom d'une ancienne animation tombe, les modificateurs écrits (`@in.fly.shared`) restent sur la directive proposée, les
    // réglages écrits passent dans l'effet ; le gabarit entier est relu avant (refuseOldTransitions), ceci vaut pour une balise hors de lui
    throw new Error(oldTransitionsMessage([rewriteOldTransition(env.attr, env.node.line)]))
  }
  if (DIRECTIVES.transition(attrName, rawVal)) {
    if (!/^\*/.test(String(env.attr.val ?? ''))) throw new Error(t('transitions.expects-effect', { directive: shownName(attrName.split('.')[0]) }))
    return bindingTransition(env)
  }
  if (/^@(?:introstart|introend|outrostart|outroend)$/.test(attrName)) {
    return bindingTransition(env)
  }

  // @emit.EVENT_NAME={expr} / @emit.once.EVENT_NAME={expr} — DOIT précéder le
  // fallback générique `@xxx → eventListener()` plus bas : sans ça, un
  // `@emit.xxx=` quelconque tomberait silencieusement dans un mauvais binding
  // (piège préexistant du fallback, cf. commentaire sur MJS_BOOLEAN_PROPS
  // juste en dessous).
  if (DIRECTIVES.emission(attrName, rawVal)) return bindingEmit(env)

  // `@booleanProp`
  // (`@open`/`@checked`/`@disabled`/etc., ex. `<details @open>`) forçait
  // INCONDITIONNELLEMENT vers `bindingStandard` — qui n'accepte QUE la forme
  // two-way bien formée `!{…}`. Or par construction, une valeur `!{…}` bien
  // formée est DÉJÀ interceptée PLUS HAUT (ligne ~1669, la règle générale
  // « !{…} → binding_standard », valable pour N'IMPORTE QUEL attribut,
  // préfixé @ ou non) — on n'atteint donc CE bloc QUE pour les 2 AUTRES
  // formes, que `bindingStandard` rejette TOUJOURS avec une erreur cryptique
  // (« expected !{...} pattern, got "true" ») :
  //   - `@open` nu (`type: 'boolean'`, aucune expression à lier) — statique.
  //   - `@open={expr}` (`type: 'dynamic'`) — dynamique UNIDIRECTIONNEL, un cas
  //     d'usage courant (`<details @open={isExpanded}>`) qui n'a pas besoin
  //     d'écrire en retour vers `isExpanded`.
  // Fix : router chaque forme vers le handler qui la comprend RÉELLEMENT —
  // `dynamic()` (même chemin que `open={isExpanded}` SANS @, délègue à
  // `_mjs_updAttrNode`, qui gère déjà correctement le retrait des booléens sur
  // false/null/undefined) pour le cas dynamique, `booleanAttr()` (statique,
  // équivalent à `open` sans @) pour le cas nu — au lieu de laisser
  // `bindingStandard` échouer sur les DEUX.
  if (attrName.startsWith('@')) {
    const attrPure = attrName.slice(1)
    if (DIRECTIVES.boolean(attrName, rawVal)) {
      env.attrName = attrPure
      if (env.attr.type === 'dynamic') return dynamic(env)
      return booleanAttr(env)
    }
    // un mot de MJS qui reçoit un gestionnaire (`:preload={…}`, `:method={…}`, `:html={…}`), ou `:preload` une valeur qu'il ne prend pas
    // (`:preload="bientot"`) : refusé, jamais lu comme l'écoute d'un événement de ce nom ; le message donne la forme du mot et renvoie à µmount
    const word = oldWordOf(attrName)
    if (word && (env.attr.type === 'dynamic' || (word.word === 'preload' && !/^(?:on|hover|off)$/.test(rawVal)))) throw new Error(t('generator.word-value-refused', { written: shownName(attrName) + (env.attr.type === 'dynamic' ? `={${String(env.attr.expr ?? '').trim()}}` : env.attr.type === 'boolean' ? '' : `="${rawVal}"`), word: word.word, shape: wordForm(word.word) }))
    // repli — tout `@xxx` inconnu est un écouteur d'événement, un nom d'événement est libre,
    // le compilateur ne le compare à RIEN (casse comprise) ; les
    // directives des balises de section sont contrôlées dans transpiler/sections.ts et directives.ts
    return eventListener(env)
  }

  // attribut `on…` d'une balise HTML, SVG ou tierce (ni composant `<@…>`, ni macro) qui lit une expression : sa valeur devient calculée, et le filtre
  // des attributs ne pose jamais un nom `on…` calculé — la balise le recevait vide, sans un mot. Refusé, avec la forme à écrire : `@click={…}` pour
  // un événement de la liste, les deux voies sinon (`@…={…}`, sans nom d'événement, ou un nom `data-…`). Une balise tierce (nom à tiret) reçoit la forme calculée en propriété
  // (`onclick={$f}`) : seule sa forme texte qui lit une expression est refusée. Des accolades qui n'en ouvrent aucune (`{}`, quantifieur `{2}`,
  // accolade d'une chaîne jamais refermée) laissent le texte tel quel, que le navigateur exécute
  if (/^on[a-z]/i.test(attrName) && !/^(?:mjs-|@)/.test(env.node.name ?? '') && !env.node.attrs.some((a) => /^mjs-(?:el|comp)$/.test(a.name ?? ''))) {
    const computed = env.attr.type === 'dynamic'
    const vars     = { module: env.compiler.moduleName ?? '', line: env.node.cite ?? env.attr.line ?? env.node.line ?? '', tag: env.node.name ?? '', attr: attrName, evt: attrName.slice(2).toLowerCase() }
    if (computed ? !(env.node.name ?? '').includes('-') : splitBraceSegments(rawVal).some((s) => s.expr !== null)) {
      throw new Error(BROWSER_EVENTS.has(vars.evt) ? t('generator.handler-native-braces', vars) : t('generator.attribute-on-computed', vars))
    }
    // un `$x` écrit sans accolades (`onclick="f($x)"`), que la valeur interpole comme dans tout attribut (même repère que plus bas) : calculée
    // elle aussi, jamais posée par le filtre ; la construction passe, avec un avertissement qui donne la même forme à écrire
    // une fois par attribut : la même balise peut passer deux fois ici dans une construction
    if (!computed && /(?<![\w]|(?<!\.)\.)\$[a-zA-Z_]/.test(rawVal) && !state.warnedAttrs.has(`${vars.line}\0${attrName}`)) {
      state.warnedAttrs.add(`${vars.line}\0${attrName}`)
      const line = typedLine('events', BROWSER_EVENTS.has(vars.evt) ? t('generator.handler-native-braces', vars) : t('generator.attribute-on-computed', vars), state.lint)
      if (line !== null) printDiagnostic(line, state.colorsEnabled)
    }
    if (!computed && rawVal.includes('{')) return staticAttr(env)
  }

  // raw_val avec $xxx et pas mjs-* → interpolation type "if dirty" ; même repère que `parseMixedString` (utils.ts) et
  // `getEffectVars` (state.ts) : un `$` collé à un mot (« 5$ ») ou après un seul point (« v1.$n ») est du texte, mais après
  // `..` ou `...` (« Chargement...$n ») c'est une variable
  if (/(?<![\w]|(?<!\.)\.)\$[a-zA-Z_]/.test(rawVal) && !attrName.startsWith('mjs-')) {
    // `isRawText: true` — `rawVal` est la valeur BRUTE de l'attribut (raccourci `$var` nu
    // hors accolades, ex. `href="#$ancre"`) : le `#` y est un caractère littéral, pas un
    // commentaire Civet — masquer comme du code perdrait la dépendance (`#$ancre` blanchi
    // en entier par maskNonCode, qui traite `#` suivi d'un non-identifiant comme un commentaire).
    const vars = getEffectVars(rawVal, true)
    const needsAlias = rawVal.includes('@@') || rawVal.includes('$store') ||
                       rawVal.includes('$$') || rawVal.includes('$__')
    const ptr = needsAlias ? '_mjsThis' : 'this'
    const jsEval = parseMixedString(rawVal, env.compiler.externalVars, env.compiler.moduleName)
    // nom que le gabarit déclare et que la mise à jour retrouve (cf. adjustedAttr) ; à la racine et dans une branche le gabarit ne déclare pas l'attribut, la mise
    // à jour le crée par `setAttribute`, sans espace de noms : un attribut que l'analyseur HTML pose dans un espace de noms (`xlink:href`) y est donc déclaré vide,
    // comme le fait une valeur entre accolades seules, et la mise à jour le retrouve par son nom qualifié
    const adj     = adjustedAttr(env, attrName)
    const name    = adj.name
    const declare = adj.ns ? ` ${name}=''` : ''
    // cette branche n'avait qu'un chemin ROOT
    // (`this._mjs_updAttr`, qui lit `this._mjs_nodes[id]`) : dans un `{for}`, les refs
    // de row vivent dans `__nodes` (PAS `this._mjs_nodes`) → `this._mjs_nodes[id]`
    // est TOUJOURS `undefined` → no-op SILENCIEUX sur TOUTES les rows. Un
    // attribut interpolé contenant un `$var` (ex. `title="prix : {$prefix}"`)
    // disparaissait donc purement et simplement en boucle.
    //
    // Fix : `µ._mjs_updAttrNode(node, name, val)` factorise EXACTEMENT la logique
    // de `this._mjs_updAttr` (props booléennes, `null`/`false`→removeAttribute,
    // filtre XSS `µ._mjs_safeAttr`) mais prend le NODE directement au lieu de le
    // chercher dans `this._mjs_nodes[id]` — utilisable aussi bien au root
    // (`this._mjs_nodes.${id}`) qu'en `{for}` (`__nodes['${lid}']`). `_mjs_updAttr`
    // lui-même est refactoré pour DÉLÉGUER à ce helper (zéro duplication,
    // root et for utilisent désormais UNE SEULE logique — ferme au passage
    // le défaut jumeau « booléens/null cassés en {for} »).
    if (env.ctx.type === 'for') {
      env.ctx.updates.push(
        `{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${writeValue(env, `_mjs_n${env.lid}`, adj, jsEval)}; } }`
      )
      // le fix CRITIQUE rend l'attribut `$var` interpolé
      // VISIBLE au mount, mais sans `structVars` il reste NON réactif (var externe
      // mutée hors row → `_mjs_renderStruct` sauté). `vars` est déjà calculé plus haut.
      for (const v of vars) state.structVars.add(v)
      return { id: env.id, attrStr: env.attrStr + ` ${name}=''` }
    }
    if (env.ctx.type !== 'root') {
      // contexte {await} (ni root ni for) : ce code s'exécute
      // DANS la createFn de la branche, AVANT que `_mjs_updIf` (mjs_element.ts) ne
      // fusionne les refs dans `this._mjs_nodes` — `this._mjs_nodes[id]` est encore vide
      // à cet instant précis. Même remède : viser les refs LOCALES
      // `__nodes` de la branche, déjà peuplées à ce point du corps généré.
      const id = env.id ?? `e${++state.counter}`
      env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) ${writeValue(env, '_mjs_node', adj, jsEval)}; }`)
      // la chaîne suit ses variables : effet de la racine, la pose ci-dessus la vaut à la construction de la branche
      trackInBranch(env, id, jsEval, `${writeValue(env, '_mjs_node', adj, jsEval)};`, vars)
      return { id, attrStr: env.attrStr + declare }
    }
    const id = env.id ?? `e${++state.counter}`
    const code = writeRootValue(env, ptr, id, adj, jsEval)
    pushUpdate(env, code, vars)
    return { id, attrStr: env.attrStr + declare }
  }

  // Type spécifique
  if (env.attr.type === 'dynamic') return dynamic(env)
  if (env.attr.type === 'boolean') return booleanAttr(env)

  // Mixed string with {...}
  if ((env.attr.val ?? '').includes('{') || rawVal.includes('{')) {
    return interpolation(env)
  }

  return staticAttr(env)
}

// liste calculée qui garde les objets d'une liste de l'état nommée par un chemin (`$.l`, `$.o.items`), sans en ajouter : `filter`,
// `slice`, `toSorted`, `toReversed`, enchaînés (`$.l.filter(f).slice(0, 5)`) — rend ce chemin ; sinon null (`map`, `concat`, fonction à
// soi, parenthèse dans une chaîne, liste d'un élément de boucle `row.cells.filter(f)` dont le suivi ne retrouve pas le chemin : dans le
// doute, null)
function viewPath(iterable: string): string | null {
  const m = /^\$(?:\.[A-Za-z_$][\w$]*)+?(?=\.(?:filter|slice|toSorted|toReversed)\()/.exec(iterable)
  if (!m) return null
  let i = m[0].length
  while (i < iterable.length) {
    const call = /^\.(?:filter|slice|toSorted|toReversed)\(/.exec(iterable.slice(i))
    if (!call) return null
    let n = 1
    i += call[0].length
    for (; i < iterable.length && n > 0; i++) {
      const c = iterable[i]
      if (c === '\'' || c === '"' || c === '`') return null
      if (c === '(') n++
      else if (c === ')') n--
    }
    if (n > 0) return null
  }
  return m[0]
}

// élément d'une boucle écrit par un gestionnaire : `x.n = v`, `x.n += v`, `x.n++`, `++x.n`, `delete x.k`, `x.tags.push(v)`,
// `x.d.setHours(h)` (cf. le préambule des gestionnaires) — une lecture seule (`$sel = x.id`, `ouvrir(x)`) ne relit pas la liste
function elementWritten(item: string, code: string): boolean {
  const n    = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rest = '(?:\\??\\.[\\w$]+|\\[[^\\]\\n]*\\])'
  const str  = `(?<![\\w$.])${n}${rest}+`
  return new RegExp(`${str}\\s*(?:(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?!=)|\\+\\+|--)|(?:\\+\\+|--|\\bdelete\\s+)${n}${rest}+|(?<![\\w$.])${n}${rest}*\\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|clear|delete|set[A-Z][\\w$]*)(?![\\w$])`).test(code)
}

// le corps d'un rappel de transition (`@introend={…}`), écrit dans la langue des gestionnaires et compilé comme eux (transpiler/index.ts) :
// raccourcis de MJS, nom lié sans déclaration (`t = $o`) déclaré chez lui, Civet. Il reste dans la fermeture
// de la balise, qui voit les noms du script et ceux que le gabarit met en portée (variable d'un `{for}`, `{const}`) : ceux-là ne sont pas
// redéclarés. Compilé au premier niveau, pas en fonction : sa dernière valeur n'est pas rendue (le rappel `introend` est attendu)
function callbackBody(a: Attr, env: AttrCtx): string {
  const raw  = callbackText(a)
  const code = cleanJsHandler(dedent(alignsOnFirstLine(raw)).trim(), env.compiler.externalVars, env.compiler.moduleName, undefined, a.line ?? env.node.line, env.compiler.scriptLang)
  if (!code.trim()) return ''
  const known = [...(env.compiler.handlerScope ?? []), ...(env.ctx.locals ?? [])]
  const text  = tokenize(applyMjsSugarToScript(code, 'civet', known, '<script> (handlers)'), { externalVars: env.compiler.externalVars })
  const batch = `${env.compiler.moduleName}.inlines`
  let js: string
  try {
    js = getCivetCompile()(text, { js: true, sync: true, filename: batch })
  }
  catch (err: any) {
    throw callbackFault(t('transpiler.handler-inline-failed-civet', { moduleName: env.compiler.moduleName, lineHint: '', civetMsg: `${a.name}={${raw.trim()}} : ${err?.message ?? err}`, gluedTernaryHint: '' }), raw, text, a.line ?? env.node.line)
  }
  return statementEnds(js)
}

// une faute de Civet dans un rappel, à sa position dans le texte compilé (`<module>.inlines:L:C`), ou le refus d'une
// garde, à la place du nom fautif dans le texte écrit (`batch` = `written`) : le transpileur la cite à sa place dans le fichier, comme celle
// d'un gestionnaire (locateCallback, transpiler/index.ts) ; à défaut, ou sans position (`<module>.inlines`), à la ligne de l'attribut
function callbackFault(message: string, written: string, batch: string, line: number | undefined): Error {
  return Object.assign(new Error(message), { transitionCallback: { written: written, batch: batch, line: line } })
}

// le texte écrit d'un rappel de transition, sans ses accolades
function callbackText(a: Attr): string {
  return a.expr != null ? String(a.expr) : String(a.val ?? '').replace(/^\s*\{/, '').replace(/\}\s*$/, '')
}

// la place d'un nom fautif dans le texte écrit d'un rappel (`<module>.inlines:L:C`, cf. callbackFault) : sa première occurrence qui
// vérifie `re`, chaînes et commentaires masqués ; aucune, `<module>.inlines` seul, cité à la ligne de l'attribut
function namePlace(written: string, re: RegExp, moduleName: string): string {
  const k = maskInertSameLength(written).search(re)
  if (k < 0) return `${moduleName}.inlines`
  const before = written.slice(0, k).split('\n')
  return `${moduleName}.inlines:${before.length}:${before[before.length - 1].length + 1}`
}

// l'écriture d'un nom (`n = …`, `n += …`, `n++`, `--n`), pas sa lecture ni une déclaration (`n := …`, `n .= …`)
function writeOf(name: string): RegExp {
  const n = name.replace(/\$/g, '\\$')
  return new RegExp(`(?<![\\w$.])${n}\\s*(?:(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])|\\+\\+|--)|(?:\\+\\+|--)\\s*${n}(?![\\w$])`)
}

// le rappel en fonction, comme un gestionnaire : `async` quand son premier niveau attend, ses écritures lues dans la fonction entière (un
// `return` de premier niveau compris) ; les gardes des gestionnaires y passent — JavaScript produit illisible, constante du script ou nom
// du gabarit réaffecté (analyzeConstReassign), setTimeout ou setInterval (callbackTimer) — refusées par des messages de rappel de
// transition, cités au nom fautif dans le fichier, sinon à la ligne de l'attribut (cf. callbackFault)
function callbackFunction(a: Attr, env: AttrCtx): string {
  const js = callbackBody(a, env)
  if (!js.trim()) return '() => {}'
  const fn     = `${awaitsAtTopLevel(js) ? 'async ' : ''}() => {\n${js}\n}`
  const locals = env.ctx.locals ?? new Set<string>()
  // les noms du gabarit posés devant la fonction comme les copies du squelette d'un gestionnaire (cf. isSkeletonInit,
  // transpiler/const-reassign.ts) : le rappel lit ceux de la ligne rendue, une réaffectation serait perdue sans un mot
  const copies                         = [...locals].map((name) => `let ${name} = _mjs_ri_0;`).join(' ')
  const { violation, parsable, error } = analyzeConstReassign(copies ? `{ ${copies}\n${fn}\n}` : fn, (env.compiler.handlerConsts ?? []).filter((name) => !locals.has(name)), locals)
  const timer                          = violation || !parsable ? null : callbackTimer(fn, locals)
  if (!violation && parsable && !timer) return fn
  const written    = callbackText(a)
  const moduleName = env.compiler.moduleName ?? '?'
  const vars       = { moduleName, callback: a.name }
  let message: string
  if (violation) message = t(violation.template ? 'transpiler.callback-local-template-reassigned' : 'transpiler.callback-const-reassigned', { ...vars, name: violation.name, position: namePlace(written, writeOf(violation.name), moduleName) })
  else if (!parsable) message = t('transpiler.callback-js-invalid', { ...vars, position: `${moduleName}.inlines`, excerpt: error?.excerpt ?? '' })
  else message = t('transpiler.timer-raw', { ...vars, name: timer, handler: 'yes', position: namePlace(written, new RegExp(`(?<![\\w$])${timer}(?![\\w$])`), moduleName) })
  throw callbackFault(message, written, written, a.line ?? env.node.line)
}

// Civet sépare ses instructions par des sauts de ligne, que la mise à plat du code de la transition retire (cf.
// flattenPreservingLiterals) : un `;` à la fin de chaque instruction qui s'en passait, lue sur l'arbre
const NO_FINAL_BRACE = new Set(['ExpressionStatement', 'VariableDeclaration', 'ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement', 'DoWhileStatement', 'DebuggerStatement'])
function statementEnds(js: string): string {
  let tree: any
  try {
    tree = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
  }
  catch {
    return js
  }
  const ends: number[] = []
  const visit = (n: any): void => {
    if (NO_FINAL_BRACE.has(n.type) && js[n.end - 1] !== ';' && !(n.type === 'VariableDeclaration' && /^For(?:In|Of)?Statement$/.test(n.parent ?? ''))) ends.push(n.end)
    for (const [k, v] of Object.entries(n)) for (const c of Array.isArray(v) ? v : [v]) if (c && typeof (c as any).type === 'string') visit(Object.assign(c, { parent: k === 'init' || k === 'left' ? n.type : undefined }))
  }
  visit(tree)
  let out = js
  for (const end of ends.sort((x, y) => y - x)) out = out.slice(0, end) + ';' + out.slice(end)
  return out
}

// l'élément d'une boucle écrit par un rappel de transition (cf. elementWritten), lu sur son JavaScript : par le nom de la variable du
// `{for}` seulement là où ni une déclaration ni un paramètre du rappel ne le masque (`x := { n: 0 }`, `(x) => x.n++` écrivent un autre
// objet) ; illisible, le rappel garde la lecture du texte
const WRITING_METHOD_RE = /^(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|clear|delete|set[A-Z][\w$]*)$/
function writesFreeElement(item: string, js: string): boolean {
  if (!elementWritten(item, js)) return false
  let tree: any
  try {
    tree = acorn.parse(`(() => {\n${js}\n})`, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true })
  }
  catch {
    return true
  }
  // le nom lié par un motif (`x`, `{ x }`, `[a, ...x]`, `x = 1`)
  const bound = (p: any): boolean => !!p && (p.type === 'Identifier' ? p.name === item : p.type === 'ObjectPattern' ? p.properties.some((q: any) => bound(q.type === 'RestElement' ? q.argument : q.value)) : p.type === 'ArrayPattern' ? p.elements.some(bound) : p.type === 'RestElement' ? bound(p.argument) : p.type === 'AssignmentPattern' && bound(p.left))
  const declare = (s: any): boolean => (s?.type === 'VariableDeclaration' && s.declarations.some((d: any) => bound(d.id))) || ((s?.type === 'FunctionDeclaration' || s?.type === 'ClassDeclaration') && s.id?.name === item)
  // les `var` d'une fonction, blocs compris, fonctions imbriquées non
  const varIn = (n: any): boolean => !!n && typeof n.type === 'string' && !/Function/.test(n.type) && ((n.type === 'VariableDeclaration' && n.kind === 'var' && declare(n)) || Object.values(n).some((v: any) => (Array.isArray(v) ? v : [v]).some((c: any) => c && typeof c.type === 'string' && varIn(c))))
  const root = (m: any): boolean => {
    while (m?.type === 'MemberExpression' || m?.type === 'ChainExpression') m = m.type === 'ChainExpression' ? m.expression : m.object
    return m?.type === 'Identifier' && m.name === item
  }
  const member  = (m: any): boolean => (m?.type === 'MemberExpression' || m?.type === 'ChainExpression') && root(m)
  const written = (n: any): boolean => (n.type === 'AssignmentExpression' && member(n.left)) || (n.type === 'UpdateExpression' && member(n.argument)) || (n.type === 'UnaryExpression' && n.operator === 'delete' && member(n.argument)) || (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.computed && WRITING_METHOD_RE.test(n.callee.property?.name ?? '') && root(n.callee.object))
  const visit   = (n: any, mask: boolean): boolean => {
    if (/Function/.test(n.type)) mask ||= n.params.some(bound) || (n.type === 'FunctionExpression' && n.id?.name === item) || varIn(n.body)
    if (n.type === 'BlockStatement' || n.type === 'StaticBlock') mask ||= n.body.some(declare)
    if (n.type === 'SwitchStatement') mask ||= n.cases.some((c: any) => c.consequent.some(declare))
    if (n.type === 'ForStatement' || n.type === 'ForInStatement' || n.type === 'ForOfStatement') mask ||= declare(n.init ?? n.left)
    if (n.type === 'CatchClause') mask ||= bound(n.param)
    if (!mask && written(n)) return true
    return Object.values(n).some((v: any) => (Array.isArray(v) ? v : [v]).some((c: any) => c && typeof c.type === 'string' && visit(c, mask)))
  }
  return visit(tree, false)
}
