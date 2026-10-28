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

import * as acorn from 'acorn'
import { state, getEffectVars, registerEffect } from '../state.js'
import { typedLine, printDiagnostic } from '../../diagnostics.js'
import { cleanJs, cleanJsExpr, decodeHtmlEntities, freeIdentifiers, parseMixedString, corpsDeFlecheEnBloc, attrSur as attrSurNom } from '../utils.js'
import { transformReactiveWrites } from '../transform-reactive.js'
import { applyPathTracking } from '../path-tracker.js'
import type { Node, Attr } from '../../parser/index.js'
import { transitionDirective } from '../../parser/index.js'
import type { PorteeEntree } from '../compile.js'
import { t } from '../../messages/index.js'
import { suggestKey } from '../../bundler/config.js'
import { maskNonCode } from '../../mask.js'
import { adjustAttr, SVG_NS, MATH_NS } from '../paths.js'

export interface AttrCtx {
  compiler: typeof state
  node: Node
  attr: Attr
  attrName: string | null | undefined
  rawVal: string
  ctx: { type: string; updates: string[]; loops: any[]; locals?: Set<string>; portee?: PorteeEntree[]; svgNs?: string | null; foreign?: boolean; enBloc?: boolean; branche?: { id: string; etat: string } }
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
function pushInline(env: AttrCtx, code: string): void {
  state.inlines.push(code)
  state.inlineLocals.push(env.ctx.locals ? Array.from(env.ctx.locals).sort() : [])
  state.inlineLines.push(env.node.line)
}

/** Ce que les aides de portée lisent d'un site de liaison : la portée du gabarit (`ctx`) et, pour la grammaire Civet, les noms du script (`compiler`) ; un texte de
 * branche, que `walk` (compile.ts) compile sans `AttrCtx`, les passe seuls */
type EnvPortee = Pick<AttrCtx, 'ctx' | 'compiler'>

/** Les entrées de la portée qu'un code doit recréer, une case par entrée : chaque `{for}` toujours (son
 * itérable est lu aussi) ; un `{const}` ou la valeur de la branche `{await}` seulement si `code` lit son nom,
 * ou si l'une des entrées recréées après lui le lit (itérable d'une boucle, expression d'un autre `{const}`). */
function porteeLue(portee: PorteeEntree[], code: string): boolean[] {
  const lu      = (texte: string, nom: string): boolean => new RegExp(`(?<![\\w$.])${nom}(?![\\w$])`).test(texte)
  const retenue = portee.map(() => false)
  let aLire     = code
  for (let i = portee.length - 1; i >= 0; i--) {
    const e = portee[i]
    if (e.kind === 'for') {
      retenue[i] = true
      aLire     += '\n' + e.loop.iterable
    }
    else if (lu(aLire, e.name)) {
      retenue[i] = true
      if (e.kind === 'const') aLire += '\n' + e.raw
    }
  }
  return retenue
}

/** Ce que lit le squelette après l'entrée `i` de la portée : `code`, l'itérable de chaque boucle intérieure et l'expression de
 * chaque `{const}` recréé après elle — une variable de ligne lue à travers un `{const}` de la ligne (`{const lab = v[0]}`), ou un
 * `{const}` qui en lit un autre, compte comme lue. */
function texteLuApres(portee: PorteeEntree[], retenue: boolean[], i: number, code: string): string {
  let texte = code
  for (let k = i + 1; k < portee.length; k++) {
    const e = portee[k]
    if (!retenue[k]) continue
    if (e.kind === 'for') texte += '\n' + e.loop.iterable
    else if (e.kind === 'const') texte += '\n' + e.raw
  }
  return texte
}

/** Squelette qui recrée, en tête d'un gestionnaire ou d'une liaison, les noms que le gabarit met
 * en portée ICI, dans l'ordre du gabarit (cf. PorteeEntree, compile.ts) : chaque `{for}` par la
 * ligne propre au site (`ligneBoucle`, inchangée), puis chaque `{const}` et la valeur de la
 * branche `{success}`/`{error}` — ceux-là seulement s'ils sont lus, par `code` ou par une entrée
 * recréée après eux (itérable d'une boucle, expression d'un autre `{const}`). Sans eux, un
 * `{const}` ou la valeur chargée levait « … is not defined » au clic, et une boucle sur cette
 * valeur aussi. Chacun passe par un temporaire (`_mjs_cst_N`, `_mjs_aw_N`), comme les boucles par
 * `_mjs_ra_N`/`_mjs_ri_N` : le contrôle des constantes reconnaît ainsi le squelette et refuse toute
 * AUTRE écriture de ces noms, qui ne toucherait qu'une copie locale (cf. const-reassign.ts). Ces
 * temporaires sont des affectations, pas des déclarations : leur préfixe réservé `_mjs_` garantit
 * qu'aucune variable du `<script>` ne porte leur nom, sans quoi le gestionnaire l'écraserait. */
function squelettePortee(env: EnvPortee, code: string, ligneBoucle: (l: any, luApres: string) => string, grammaire: 'civet' | 'js' = 'civet'): string {
  const portee: PorteeEntree[] = env.ctx.portee ?? env.ctx.loops.map((loop: any) => ({ kind: 'for' as const, loop }))
  const retenue = porteeLue(portee, code)
  let sortie = ''
  for (let i = 0; i < portee.length; i++) {
    const e = portee[i]
    if (!retenue[i]) continue
    if (e.kind === 'for') {
      sortie += ligneBoucle(e.loop, texteLuApres(portee, retenue, i, code))
      continue
    }
    const temp   = e.kind === 'const' ? `_mjs_cst_${i}` : `_mjs_aw_${i}`
    const valeur = e.kind === 'const'
      ? (grammaire === 'js' ? e.js : cleanJs(e.raw, env.compiler.externalVars))
      : `_mjsThis._mjs_awaitStates?.get('${e.id}')?.${e.champ}`
    sortie += grammaire === 'js' ? `const ${temp} = ${valeur}; let ${e.name} = ${temp}; ` : `  ${temp} = ${valeur}\n  ${e.name} = ${temp}\n`
  }
  return sortie
}

/** Squelette d'une boucle pour la réécriture DOM→modèle d'une liaison deux sens (cf.
 * squelettePortee). Optim #8 — lit la prop JS `_mjs_idx_N` si présente, sinon l'attribut. L'élément
 * se relit dans la collection elle-même : sa position pour un tableau, sa clé pour un objet (la boucle
 * d'un objet range sa clé comme index ; ses valeurs en tableau ne s'y liraient pas), sa position dans
 * la liste de ses éléments pour un Set ou une Map (une paire `[clé, valeur]`, comme la ligne l'affiche).
 * Harmonisation Civet — seul point de divergence Coffee/Civet du squelette : l'existentiel
 * binaire Coffee `a ? b` (sans `:`) n'existe pas en Civet (« Failed to parse ») ; Civet exprime le
 * même repli via `??`, que CoffeeScript ne connaît PAS (« unexpected ? »). */
function ligneBoucleLiaison(l: any): string {
  const d = l.depth
  return `  _mjs_ri_${d} = _mjs_el._mjs_idx_${d} ${state.templateLang === 'js' ? '?' : '??'} _mjs_el.getAttribute('data-mjs-idx-${d}')\n` +
    `  _mjs_ra_${d} = ${l.iterable}\n` +
    `  _mjs_ra_${d} = Array.from(_mjs_ra_${d}) if _mjs_ra_${d} instanceof Map or _mjs_ra_${d} instanceof Set\n` +
    `  ${l.item} = _mjs_ra_${d}[_mjs_ri_${d}]\n` +
    `  ${l.index} = _mjs_ri_${d}\n`
}

/** Les variables réactives que lisent les `{const}` qu'un code oblige à recréer (cf. porteeLue) : l'effet qui
 * les recrée doit suivre ces variables, sinon un `{const}` lu par la condition ou la valeur ne bouge plus
 * quand elles changent. */
function varsDesConst(env: EnvPortee, code: string): string[] {
  const portee  = env.ctx.portee ?? []
  const retenue = porteeLue(portee, code)
  const vars    = new Set<string>()
  portee.forEach((e, i) => { if (retenue[i] && e.kind === 'const') for (const v of getEffectVars(e.raw)) vars.add(v) })
  return [...vars]
}

/** Effet posé à la RACINE pour une liaison située dans une branche `{await}` (hors de la fonction
 * de la branche) : la valeur `{success}`/`{error}` et les `{const}` de la branche y sont recréés,
 * sans quoi son premier passage levait « … is not defined » et le composant entier tombait ; et
 * seulement quand cette branche est celle qui est affichée (cf. brancheCourante).
 * Aucune boucle ici : un `{for}` a son propre chemin, et un `{await}` n'est jamais dans un `{for}`. */
function effetRacineLiaison(env: EnvPortee, id: string, expr: string, updateLogic: string): string {
  const affichee = brancheCourante(env)
  return `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node${affichee ? ` && ${affichee}` : ''}) { ${squelettePortee(env, expr, () => '', 'js')}${updateLogic} } }`
}

/** Un attribut ou une prop posé dans une branche `{await}` suit ses variables : la pose se fait à la construction de la branche (par l'appelant), cet effet de la racine la
 * rejoue quand une variable lue change (cf. effetRacineLiaison). Les variables qu'un `{const}` lu par l'expression lit comptent comme les siennes, l'effet recrée ce
 * `{const}` ; sans variable réactive la pose suffit, rien ne peut changer ce qu'elle a écrit. */
function suivreEnBranche(env: AttrCtx, id: string, code: string, updateLogic: string, vars: string[], prop = false): void {
  const varsEffet = [...new Set([...vars, ...varsDesConst(env, code)])]
  if (prop) notePropVars(varsEffet)
  if (varsEffet.length > 0) registerEffect(effetRacineLiaison(env, id, code, updateLogic), varsEffet)
}

/** Vars qui posent une prop sur un composant enfant (cf. state.propVars) : la prop est de l'état de l'enfant, une boucle qui écrit ces vars
 * la lui livre à chaque écriture, sans attendre la sortie de la boucle comme un texte */
function notePropVars(vars: string[]): void {
  for (const v of vars) state.propVars.add(v)
}

/** Ce qui dit que la branche qui porte la liaison est bien celle que le bloc `{await}` affiche (`_mjs_awaitLastRender`, que le runtime passe à la branche affichée avant de la
 * créer et retire quand la promesse disparaît) : l'attente, `{success}` et `{error}`, nommées ou non (`ctx.branche`, posé par compileAwait). Une branche qui n'est plus affichée
 * (promesse remplacée, rejetée ou retirée) laisse ses nœuds connus du composant : l'effet qui y écrirait changerait une balise retirée de la page, relirait la valeur de la
 * branche qui n'existe plus (`null`) et ferait tomber le composant entier, rappellerait la fabrique d'une attache sans que personne la défasse, écrirait dans un nœud texte que
 * le pool de nœuds texte (mjs_textpool) a réattribué à une autre branche, ou insérerait les lignes d'une liste `{for}` entre deux repères que ce pool a réattribués. */
export function brancheCourante(env: EnvPortee): string {
  const b = env.ctx.branche
  return b ? `_mjsThis._mjs_awaitLastRender?.get('${b.id}') === '${b.etat}'` : ''
}

/** Le texte `{expr}` (ou `{{expr}}`, `brut`) d'une branche `{await}` qui lit une variable réactive, ou un `{const}` qui en lit une, ou qui est un texte traduit (il suit la
 * langue) : son nœud `lid` est repéré par l'appelant (un marqueur, ou le conteneur du HTML brut), écrit une première fois à la construction de la branche (`pose`, dans
 * la fonction de la branche, où la valeur de la branche et les `{const}` sont déjà là) puis tenu à jour par un effet de la racine (`effet`), qui recrée cette valeur et ces
 * `{const}` (cf. squelettePortee) et ne tourne que si la branche est celle qui est affichée (cf. brancheCourante). Rend null quand rien ne peut changer le texte : il
 * reste alors calculé une fois, dans le gabarit de la branche. */
export function texteDeBranche(env: EnvPortee, lid: string, jsVar: string, vars: string[], brut: boolean): { pose: string; effet: string; vars: string[] } | null {
  const suivies = [...new Set([...vars, ...varsDesConst(env, jsVar)])]
  if (suivies.length === 0 && !/µ\.t\(|__mjsLang/.test(jsVar)) return null
  // le HTML brut ne se réécrit que s'il a changé (`_mjs_h`, comme les lignes d'un `{for}`), le texte de même ; `null` et `undefined` n'écrivent rien dans un texte, comme
  // `_mjs_updText` à la racine (le HTML brut écrit « null », là aussi comme à la racine)
  const ecrire = brut
    ? `const _mjs_ts = String(${jsVar}); if (_mjs_node._mjs_h !== _mjs_ts) { _mjs_node.innerHTML = _mjs_ts; _mjs_node._mjs_h = _mjs_ts; }`
    : `const _mjs_ts = \`\${(${jsVar}) ?? ''}\`; if (_mjs_node.data !== _mjs_ts) _mjs_node.data = _mjs_ts;`
  const garde = brancheCourante(env)
  return {
    pose:  `{ const _mjs_node = __nodes['${lid}']; if(_mjs_node) { ${ecrire} } }`,
    effet: `{ const _mjs_node = this._mjs_nodes.${lid}; if(_mjs_node${garde ? ` && ${garde}` : ''}) { ${squelettePortee(env, jsVar, () => '', 'js')}${ecrire} } }`,
    vars:  suivies
  }
}

/** Un `{if}` ou un `{key}` posé dans une branche `{await}` suit ses variables : sa condition (ou sa clé) est rejouée par un effet de la racine, qui reconstruit le contenu du
 * bloc entre ses ancres quand le choix change. `choix` est le code de la condition (ou de la clé), `tout` tout le code que l'effet rejoue (le choix, les fabriques du contenu, ses
 * mises à jour) : la valeur de la branche et les `{const}` que `tout` lit sont recréés en tête de l'effet (`prelude`, cf. squelettePortee), mais seuls les `{const}` que lit le
 * choix lui font suivre leurs variables (le contenu suit les siennes par ses propres effets). Rend null quand le choix ne lit aucune variable (la valeur de la branche seule, des
 * constantes) : il reste fait une fois, à la construction de la branche. */
export function suiviDeBloc(env: EnvPortee, choix: string, tout: string, vars: string[]): { prelude: string; garde: string; vars: string[] } | null {
  const suivies = [...new Set([...vars, ...varsDesConst(env, choix)])]
  if (suivies.length === 0) return null
  return { prelude: squelettePortee(env, tout, () => '', 'js'), garde: brancheCourante(env), vars: suivies }
}

/** Helper : enregistre un code d'update au root (effectsByVar + ctx.updates),
 * ou simplement dans ctx.updates pour les contextes for/await/etc. */
function pushUpdate(env: AttrCtx, code: string, vars: string[]): void {
  if (env.ctx.type === 'root') {
    registerEffect(code, vars)
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
function adjustedAttr(env: AttrCtx, attrName: string): { name: string, ns: string | null } {
  const tag = (env.node.name ?? '').toLowerCase()
  return adjustAttr(tag === 'svg' ? SVG_NS : tag === 'math' ? MATH_NS : env.ctx.svgNs ?? null, attrName)
}

/** `, 1` pour un nom sans risque (cf. attrSur, generator/utils.ts) ; rien pour une prop booléenne, que le runtime écrit par sa propriété, jamais par le filtre */
function attrSur(nom: string): string {
  return MJS_BOOLEAN_PROPS.includes(nom) ? '' : attrSurNom(nom)
}

/** Le nœud que `µ._mjs_updAttrNode` reçoit pour un attribut étranger (`xlink:href`, `xml:lang`…) d'un élément SVG : un jumeau du nœud qui garde la lecture, le retrait et le
 * filtre de sécurité de la mise à jour (c'est elle qui l'appelle) et ne change que la CRÉATION, posée dans l'espace de noms `ns`. Sans lui la mise à jour retire l'attribut
 * quand la valeur devient `null`, `undefined` ou `false`, puis le recrée par `setAttribute`, qui le pose SANS espace de noms : un `<use xlink:href>` n'est plus lu (adresse
 * vide, boîte 0 x 0, l'icône disparaît pour de bon), un `xml:lang` ne donne plus sa langue. La recherche et le retrait se font par le nom qualifié, comme avant : le rendu
 * serveur (happy-dom) laisse `xml:lang` et `xml:space` sans espace de noms, une recherche par espace de noms ne les y trouverait pas et en créerait un second.
 * `noeud` est un identifiant déjà lié, qui peut valoir `undefined` (la mise à jour ne fait alors rien). */
function noeudEtranger(noeud: string, ns: string): string {
  const k = '_mjs_k'
  const v = '_mjs_v'
  return `${noeud} && { tagName: ${noeud}.tagName, getAttribute: (${k}) => ${noeud}.getAttribute(${k}), setAttribute: (${k}, ${v}) => ${noeud}.hasAttribute(${k}) ? ${noeud}.setAttribute(${k}, ${v}) : ${noeud}.setAttributeNS('${ns}', ${k}, ${v}), removeAttribute: (${k}) => ${noeud}.removeAttribute(${k}) }`
}

/** L'appel qui écrit la valeur d'un attribut calculé sur le nœud `noeud` (cf. adjustedAttr pour `adj`) : `µ._mjs_updAttrNode` tel quel, sauf pour un attribut étranger, dont le
 * jumeau (cf. noeudEtranger) est lié à un nom avant l'appel : le nom de l'attribut reste le deuxième argument de la mise à jour. Sans point-virgule final. */
function ecrireAttr(noeud: string, adj: { name: string, ns: string | null }, valeur: string): string {
  if (!adj.ns) return `µ._mjs_updAttrNode(${noeud}, '${adj.name}', ${valeur}${attrSur(adj.name)})`
  return `{ const _mjs_j = ${noeudEtranger(noeud, adj.ns)}; µ._mjs_updAttrNode(_mjs_j, '${adj.name}', ${valeur}${attrSur(adj.name)}) }`
}

/** La même écriture à la racine du composant, où le nœud se lit par son identifiant : `this._mjs_updAttr('a1', …)` ; un attribut étranger prend le nœud de `${ptr}._mjs_nodes`. */
function ecrireAttrRacine(ptr: string, id: string, adj: { name: string, ns: string | null }, valeur: string): string {
  if (!adj.ns) return `${ptr}._mjs_updAttr('${id}', '${adj.name}', ${valeur}${attrSur(adj.name)});`
  return `{ const _mjs_node = ${ptr}._mjs_nodes.${id}; ${ecrireAttr('_mjs_node', adj, valeur)}; }`
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
const DOM_ATTR_COMPOSANT = /^(?:data|aria)-/i

// la prop qu'un attribut à tiret pose sur un composant du framework (balise `mjs-…`) porte le nom que la forme en dur obtient : le composant relit
// l'attribut `search-placeholder` sous `searchPlaceholder` (`syncProps`, mjs_element.ts : nom mis en minuscules par l'analyseur HTML, chaque `-x` devient `X`).
// Les formes calculées (`{…}`, `!{…}`, `{...p}`) rangeaient la valeur sous le nom écrit, une clé que personne ne lit. `data-*`, `aria-*` et `mjs-*` ne sont pas
// des props : ils gardent leur nom, comme sur une balise ordinaire ou tierce
const NOT_A_PROP = /^(?:data|aria|mjs)-/i

// les attributs globaux que le navigateur lit sur la balise d'un composant (son `id`, que visent `<@@toolbar for>`, `<label for>` et `aria-labelledby` ;
// sa classe, sa bulle, son rôle, sa langue, son sens d'écriture, son emplacement, son ordre de tabulation, `hidden`) : écrits en valeur calculée,
// ils s'y posent comme leur forme fixe (cf. logiqueComposant)
const ATTR_GLOBAL_COMPOSANT = /^(?:id|class|title|role|hidden|tabindex|lang|dir|slot)$/i

/** Le code qui livre la valeur calculée `jsVar` d'un attribut à la balise d'un composant `mjs-…` (`_mjs_node`) : toujours sa prop (`_set`, ou le
 * registre d'attente avant sa mise à niveau, cf. µ._mjs_pend) ; `data-*` et `aria-*` se posent en plus sur la balise, un attribut global
 * (ATTR_GLOBAL_COMPOSANT) aussi, sauf quand le composant déclare lui-même une prop de ce nom (`_mjs_var_bits`) : il la garde pour lui, sans
 * attribut (`<@@chart hidden={['a']}>` ne cache pas le graphique). Le nom se compare sans la casse, comme un attribut HTML : `tabIndex={…}`
 * va à une prop `$tabindex`, `tabindex={…}` à une prop `$tabIndex`, qui reçoit alors la valeur sous son nom. Une balise pas encore mise à
 * niveau (ligne de {for}, branche, module chargé plus tard) ne dit pas ses props : l'attribut attend que la balise soit définie, et c'est la
 * dernière valeur écrite (`_mjs_ha`) qui se pose */
function logiqueComposant(attrName: string, prop: string, pendProp: string, jsVar: string, recue: string): string {
  if (DOM_ATTR_COMPOSANT.test(attrName)) return `const __mjsV = ${jsVar}; if (_mjs_node._set) { _mjs_node._set('${attrName}', __mjsV); } else { µ._mjs_pend(_mjs_node, '${attrName}', __mjsV); } µ._mjs_updAttrNode(_mjs_node, '${attrName}', __mjsV${attrSur(attrName)});`
  if (!ATTR_GLOBAL_COMPOSANT.test(attrName)) return `if (_mjs_node._set) { _mjs_node._set('${prop}', ${jsVar}); } else { µ._mjs_pend(_mjs_node, ${pendProp}, ${jsVar}); }${recue}`
  const nom = attrName.toLowerCase()
  return `const __mjsV = ${jsVar}; if (_mjs_node._set) { _mjs_node._set('${prop}', __mjsV); } else { µ._mjs_pend(_mjs_node, ${pendProp}, __mjsV); }${recue} ` +
    `{ const _mjs_h = _mjs_node, _mjs_w = () => { const _mjs_d = _mjs_h._mjs_var_bits && Object.keys(_mjs_h._mjs_var_bits).find((_mjs_k) => _mjs_k.toLowerCase() === '${nom}'); ` +
    `if (!_mjs_d) µ._mjs_updAttrNode(_mjs_h, '${nom}', _mjs_h._mjs_ha['${nom}']${attrSur(nom)}); else if (_mjs_d !== '${prop}') _mjs_h._set(_mjs_d, _mjs_h._mjs_ha['${nom}']); }; ` +
    `(_mjs_h._mjs_ha ??= {})['${nom}'] = __mjsV; if (_mjs_h._mjs_var_bits) _mjs_w(); else customElements.whenDefined(_mjs_h.localName).then(_mjs_w); }`
}

function propName(name: string): string {
  if (!name.includes('-') || NOT_A_PROP.test(name)) return name
  return name.toLowerCase().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}

const isComponent = (node: Node): boolean => (node.name ?? '').startsWith('mjs-')

// ancienne écriture d'une transition (`@in.fly={…}`) : le nom d'une animation après la directive
const ANCIENNE_TRANSITION = /^@(transition|in|out)\.([A-Za-z_]\w*)/

// directives écrites en `@…` que le répartiteur (dispatchAttribute) traite, selon le nom et la valeur brute : un `@…`
// qu'aucune ne prend est un gestionnaire d'événement (son repli, `eventListener`), les événements des transitions
// (`@introstart`…) compris. La seule liste : le répartiteur la suit, la règle de l'avertissement « écrit sa prop » la relit
const DIRECTIVES: Record<string, (nom: string, val: string) => boolean> = {
  groupe:     (nom, val) => /^@group(\.[a-z]+)?$/.test(nom) && /^!\{(.+)\}$/.test(val),
  contenu:    (nom, val) => (nom === '@html' || nom === '@text') && /^!\{(.+)\}$/.test(val),
  ceci:       (nom, val) => nom === '@this' && /^!?\{(.+)\}$/.test(val),
  style:      (nom) => nom.startsWith('@style.'),
  classe:     (nom) => nom.startsWith('@class{'),
  flip:       (nom) => nom === '@flip',
  attache:    (nom) => nom === '@attach' || nom.startsWith('@attach.'),
  enfants:    (nom) => nom === '@childtransition',
  lumiere:    (nom) => nom === '@lightDom',
  ancienne:   (nom) => { const v = ANCIENNE_TRANSITION.exec(nom); return !!v && v[2] !== 'global' && v[2] !== 'shared' },
  transition: (nom) => /^@(?:transition|in|out)(?:\.(?:global|shared))*$/.test(nom),
  emission:   (nom) => nom.startsWith('@emit.'),
  booleen:    (nom) => MJS_BOOLEAN_PROPS.includes(nom.slice(1)),
}

// une balise qui porte un gestionnaire d'événement qui exécute du code (`@change={…}`, `@ferme={…}`, `@introstart={…}`) donne au parent un canal
// pour suivre ce que l'enfant écrit : en développement, sa prop à sens unique écrite par l'enfant n'est pas dite (mjs_debug.ts). Une directive (cf.
// DIRECTIVES) n'en est pas un, ni une valeur à deux sens (`!{…}`), ni un `@…` écrit sans valeur, qui n'exécute rien (`@persist` : le
// répartiteur reçoit `->`, compile.ts). `val` : la valeur brute qu'il reçoit, `code` celle que le gestionnaire exécuterait
const porteUnEcouteur = (node: Node): boolean => (node.attrs ?? []).some((a) => {
  const nom  = a.name ?? ''
  const val  = (a.val ?? '').toString()
  const code = a.type === 'dynamic' ? a.expr : val === 'true' ? '' : val
  return nom.startsWith('@') && !!code && !val.startsWith('!') && !Object.values(DIRECTIVES).some((d) => d(nom, val))
})

// la même règle pour une clé connue à l'exécution seulement (donnée étalée `{...p}`)
const SPREAD_KEY = "_mjs_k.indexOf('-') < 0 || /^(?:data|aria|mjs)-/i.test(_mjs_k) ? _mjs_k : _mjs_k.toLowerCase().replace(/-([a-z])/g, (_mjs_m) => _mjs_m[1].toUpperCase())"

// balise `mjs-…` pas encore mise à niveau, liaison à deux sens : la prop prend le nom de la forme en dur (registre des props en attente d'un composant du projet,
// propriété propre reprise à sa mise à niveau), sauf pour une balise que le manifeste dit tierce — elle reçoit l'attribut brut, que son auteur lit tel quel
// (le test de µ._mjs_pend, mjs_init.ts)
const FOREIGN_TAG = '(µ.paths && !Object.prototype.hasOwnProperty.call(µ.paths, _mjs_node.localName.slice(4)))'

function booleanAttr(env: AttrCtx): AttrResult {
  const attrName = env.attrName ?? ''
  const bare     = !(env.node.name ?? '').includes('-') || BARE_ATTR_KEEP_NATIVE.has(attrName) || attrName.startsWith('mjs-') || DOM_ATTR_COMPOSANT.test(attrName)
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
  const jsVar = cleanJsExpr(expr, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
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
  // développement : chaque clé livrée à un composant est une prop à sens unique, que l'enfant ne devrait pas écrire lui-même (mjs_debug.ts le dit),
  // sauf quand la balise porte un gestionnaire d'événement : le parent suit alors par l'événement
  const recue       = state.devWarnings && isComponent(env.node) && !porteUnEcouteur(env.node) ? ' µ._mjs_oneWay?.(_mjs_node, _mjs_p);' : ''
  const updateLogic = `${keyDecl}if (_mjs_node._set) { _mjs_node._set(${setKey}, _mjs_v); } else { µ._mjs_pend(_mjs_node, ${pendKey}, _mjs_v); }${recue}`
  // balise native : chaque clé s'écrit comme un attribut calculé (`µ._mjs_updAttrNode` : retrait sur false, null et undefined, filtre des
  // adresses). Chaque étalement de la balise garde les clés et les valeurs qu'il pose (`_mjs_spk`, par son rang parmi les attributs) : une clé
  // posée par plusieurs étalements prend la valeur du dernier qui la pose, comme à la première pose, même quand un étalement plus haut change ;
  // une clé qu'aucun étalement ne pose plus (objet qui la perd, devenu vide ou nul) reprend la valeur fixe écrite par l'auteur sur la balise,
  // telle que le navigateur la lit (un attribut booléen HTML nu, `hidden`, est rangé par l'analyseur en `{true}`), ou quitte la balise. `noeud` : l'expression qui donne le nœud, ou null quand `_mjs_node` est déjà lié (effet
  // de la racine d'une branche `{await}`)
  const rang     = Math.max(0, (env.node.attrs ?? []).indexOf(env.attr))
  const fixes    = (env.node.attrs ?? []).filter((a) => /^[a-zA-Z_][\w:.-]*$/.test(a.name ?? '') &&
    (a.type === 'boolean' || (a.type === 'dynamic' && a.expr === 'true') || (a.type === 'static' && !/\{|(?<![\w]|(?<!\.)\.)\$[a-zA-Z_]/.test(a.val ?? ''))))
  const remettre = fixes.length === 0
    ? '_mjs_node.removeAttribute(_mjs_a);'
    : `{ const _mjs_f = {__proto__: null, ${fixes.map((a) => `${JSON.stringify(a.name)}: ${JSON.stringify(a.type === 'static' ? decodeHtmlEntities(a.val ?? '') : '')}`).join(', ')}}; ` +
      'if (_mjs_a in _mjs_f) _mjs_node.setAttribute(_mjs_a, _mjs_f[_mjs_a]); else _mjs_node.removeAttribute(_mjs_a); }'
  const etaler = (noeud: string | null, valeur: string): string => {
    const lier = noeud ? `const _mjs_node = ${noeud}; ` : ''
    return isWc
      ? `{ const _mjs_spd = ${valeur}; if(_mjs_spd) { ${lier}if(_mjs_node) for (const _mjs_k in _mjs_spd) { const _mjs_v = _mjs_spd[_mjs_k]; ${updateLogic} } } }`
      : `{ const _mjs_spd = ${valeur}; ${lier}if(_mjs_node) { ` +
        `const _mjs_pk = (_mjs_node._mjs_spk ??= {}), _mjs_av = _mjs_pk[${rang}], _mjs_vu = _mjs_pk[${rang}] = {__proto__: null}; ` +
        `if(_mjs_spd) for (const _mjs_k in _mjs_spd) _mjs_vu[_mjs_k.replace(/_/g, '-')] = _mjs_spd[_mjs_k]; ` +
        `for (let _mjs_i = 0; _mjs_i < 2; _mjs_i++) for (const _mjs_a in (_mjs_i ? _mjs_av : _mjs_vu)) if (!_mjs_i || !(_mjs_a in _mjs_vu)) { ` +
        `let _mjs_t; for (const _mjs_r in _mjs_pk) if (_mjs_a in _mjs_pk[_mjs_r]) _mjs_t = _mjs_pk[_mjs_r]; ` +
        `if (_mjs_t) µ._mjs_updAttrNode(_mjs_node, _mjs_a, _mjs_t[_mjs_a]); else ${remettre} } } }`
  }

  // `for..in` (zéro alloc) au lieu de `Object.entries().forEach()`
  // (alloue un tableau d'entries + une closure à CHAQUE update — par mutation au
  // root, par row × réconciliation en {for}).
  if (env.ctx.type === 'root') {
    // `_mjs_spd` (préfixe réservé) et non `o` : sinon `<div {...o}>` (item de
    // boucle ou var nommé `o`) émettrait `const o = o` → ReferenceError TDZ au
    // mount.
    pushUpdate(env, etaler(`this._mjs_nodes.${id}`, jsVar), vars)
    if (isWc) notePropVars(vars)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(etaler(`__nodes['${env.lid}']`, jsVar))
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
    env.ctx.updates.push(etaler(`__nodes['${id}']`, jsVar))
    // effet posé à la racine (cf. effetRacineLiaison) : valeur `{await}` et `{const}` de la branche recréés avant d'être lus — sans eux,
    // « … is not defined » dès le premier passage — et seulement quand cette branche est celle qui est affichée : avant l'arrivée de la
    // promesse (ou après son remplacement, son rejet, son retrait) la valeur est `null`, et `{...v.attrs}` la lisait quand même ;
    // un `{const}` lu par l'étalement est recréé par l'effet : l'effet suit donc aussi les variables que ce `{const}` lit
    const spreadLogic = etaler(null, jsVar)
    const varsEffet   = [...new Set([...vars, ...varsDesConst(env, jsVar)])]
    if (isWc) notePropVars(varsEffet)
    registerEffect(effetRacineLiaison(env, id, jsVar, spreadLogic), varsEffet)
  }

  return { id }
}

// ============================================================================
// Dynamic : attr={$expr}
// ============================================================================
function dynamic(env: AttrCtx): AttrResult {
  const vars = getEffectVars(env.attr.expr ?? '')
  // Site EXPR (valeur d'attribut attr={$expr}).
  const jsVar = cleanJsExpr(env.attr.expr ?? '', env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
  const id = env.id ?? `a${++state.counter}`
  const attrName = env.attrName ?? ''
  const isWc = (env.node.name ?? '').includes('-')
  // la prop d'un composant `mjs-…` porte le nom que la forme en dur obtient (cf. propName) ; `data-*` et `aria-*` gardent le nom écrit
  const prop = isComponent(env.node) ? propName(attrName) : attrName
  // en attente : une balise que le manifeste dit tierce reçoit le nom écrit, que son auteur lit tel quel
  const pendProp = prop === attrName ? `'${attrName}'` : `${FOREIGN_TAG} ? '${attrName}' : '${prop}'`
  // développement : la prop est livrée à sens unique, l'écriture que l'enfant en ferait lui-même sera dite (mjs_debug.ts), sauf quand la balise
  // porte un gestionnaire d'événement : le parent suit alors par l'événement
  const recue = state.devWarnings && isComponent(env.node) && !porteUnEcouteur(env.node) ? ` µ._mjs_oneWay?.(_mjs_node, '${prop}');` : ''
  // nom (et espace de noms) que le gabarit déclare et que la mise à jour retrouve (cf. adjustedAttr) ; un composant garde le nom écrit, qui est celui d'une prop
  const adj = isWc ? { name: attrName, ns: null } : adjustedAttr(env, attrName)
  const nom = adj.name

  let attrStr = env.attrStr

  // un attribut booléen calculé ne s'écrit pas dans le gabarit (de la ligne, d'un bloc {if} ou {key} de la racine) : `selected=''` y vaudrait « choisi » jusqu'à la mise à jour,
  // et le navigateur ne retient qu'une option choisie par liste — l'option qui arrive ainsi prend le choix des autres, puis la mise à jour la déchoisit et la liste retombe sur sa première
  // option (de même une case radio qui prend le groupe, un `autofocus` qui prend le focus, un `autoplay` qui démarre). La mise à jour qui suit pose la valeur ; la constante `true`
  // (attribut nu, `checked={true}`) n'en a pas, son gabarit la porte. La racine elle-même se construit d'un seul tenant, avant sa mise à jour, sans choix déjà fait à emporter : elle garde son témoin
  const sansTemoin = attrName !== 'value' && MJS_BOOLEAN_PROPS.includes(attrName) && env.attr.expr?.trim() !== 'true'

  if (env.ctx.type === 'root') {
    let code: string
    if (isWc) {
      // la valeur reste aussi une prop de l'état du composant ; data-*, aria-* et les attributs globaux se posent en plus sur sa balise (cf. logiqueComposant)
      const updateLogic = logiqueComposant(attrName, prop, pendProp, jsVar, recue)
      code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    } else {
      code = ecrireAttrRacine('this', id, adj, jsVar)
    }
    pushUpdate(env, code, vars)
    if (isWc) notePropVars(vars)
    if (!isWc && !(sansTemoin && env.ctx.enBloc)) attrStr += ` ${nom}=''`
  } else if (env.ctx.type === 'for') {
    if (isWc) {
      // la valeur reste aussi une prop de l'état du composant ; data-*, aria-* et les attributs globaux se posent en plus sur sa balise (cf. logiqueComposant)
      const updateLogic = logiqueComposant(attrName, prop, pendProp, jsVar, recue)
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
        // un attribut booléen (`selected`, `checked`, `disabled`…) se pose et se retire comme hors boucle (`µ._mjs_updAttrNode`) : écrit en
        // texte, `"false"` laissait l'attribut PRÉSENT, donc actif — toutes les lignes s'allumaient. `data-*` et `aria-*` gardent le texte
        const booleen      = filt.isBoolean && attrName !== 'value' && MJS_BOOLEAN_PROPS.includes(attrName)
        const setMatchAttr = booleen
          ? `${ecrireAttr('_mjs_node', adj, 'true')};`
          : filt.isBoolean
            ? `_mjs_node.setAttribute('${nom}', 'true');`
            : `${ecrireAttr('_mjs_node', adj, filt.matchValue)};`
        const setUnmatchAttr = booleen
          ? `${ecrireAttr('_mjs_node', adj, 'false')};`
          : filt.isBoolean
            ? `_mjs_node.setAttribute('${nom}', 'false');`
            : (filt.unmatchValue.trim() === "''" || filt.unmatchValue.trim() === '""'
                ? `_mjs_node.removeAttribute('${nom}');`
                : `${ecrireAttr('_mjs_node', adj, filt.unmatchValue)};`)
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
        const refaire = valeurLitLaLigne([filt.matchValue, filt.unmatchValue], lastLoop!.item, filt.itemAccess, env.ctx)
        const lacher  = !filtreSurLaCle(lastLoop, filt.itemAccess)
        const multi   = plusieursLignes(lacher, env.ctx.loops)
        const creer   = `const __f = (_mjs_match) => { let _mjs_node = _mjs_n${env.lid}; if (_mjs_match) { ${setMatchAttr} } else { ${setUnmatchAttr} } }; `
        liaisonFiltree(env, filt.externVar, idxName, keyExpr, filteredLogic, poseFonctionFiltree(creer, idxName, refaire, lacher, multi), multi, appelFiltre)
        if (!sansTemoin) attrStr += ` ${nom}=''`
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
        env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${ecrireAttr(`_mjs_n${env.lid}`, adj, jsVar)}; } }`)
      }
    }
    // WC (`<mjs-x foo=!{$shared}>`) et attribut dynamique NON
    // filtré (`data-active={$mode}`) : var externe partagée → `structVars` sinon
    // `_mjs_renderStruct` sauté → DOM figé à vie sur mutation. Les chemins FILTRÉS
    // (au-dessus) ont leur effect dédié → ils sont déjà `return`és et exclus.
    for (const v of vars) state.structVars.add(v)
    if (!isWc && !sansTemoin) attrStr += ` ${nom}=''`
  } else {
    if (isWc) {
      // même chemin que la branche `for` ci-dessus :
      // sans ça, une prop dynamique de composant (`<mjs-card item={d}>`) en
      // branche `{await}` ne posait RIEN — `item` disparaissait en silence.
      // la valeur reste aussi une prop de l'état du composant ; data-*, aria-* et les attributs globaux se posent en plus sur sa balise (cf. logiqueComposant)
      const updateLogic = logiqueComposant(attrName, prop, pendProp, jsVar, recue)
      env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${updateLogic} } }`)
      // la prop suit ses variables : effet de la racine, comme à la racine (la pose ci-dessus la vaut à la construction de la branche)
      suivreEnBranche(env, id, jsVar, updateLogic, vars, true)
    } else {
      attrStr += ` ${attrName}='\${${jsVar}}'`
      // l'attribut aussi : la valeur posée à la construction est réécrite par `µ._mjs_updAttrNode` (filtre des adresses, nom et espace de noms du gabarit) quand une variable lue change
      suivreEnBranche(env, id, jsVar, `${ecrireAttr('_mjs_node', adj, jsVar)};`, vars)
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
    segments.push({ text: val.slice(textStart, start), expr })
    textStart = i
  }
  segments.push({ text: val.slice(textStart), expr: null })
  return segments
}

// reconstruit un gabarit JS (`\`...\``) depuis des `segments` déjà scannés en équilibré
// (`splitBraceSegments`) — remplace un appel à `parseMixedString` (utils.ts) qui n'a AUCUNE
// garde sur un `{` jamais refermé : sa boucle sort simplement quand `i>=n` puis émet quand
// même `${cleanJsExpr(...)}` sur ce qui reste, un texte pourtant censé demeurer littéral
// (comme le fait déjà le chemin clone juste plus bas, via ces mêmes `segments`) — plantait le
// composant au montage (ReferenceError), sans la moindre erreur de compilation.
function buildTemplateFromSegments(
  segments: { text: string; expr: string | null }[],
  externalVars: string[],
  templateLang: 'civet' | 'js',
  moduleName: string | undefined
): string {
  let tpl = ''
  for (const s of segments) {
    // texte fixe : entités décodées comme le ferait le navigateur (cf. parseMixedString), un `${` du décodage reste du texte
    tpl += decodeHtmlEntities(s.text).replace(/[\\`]|\$(?=\{)/g, (c) => '\\' + c)
    if (s.expr !== null) tpl += `\${${cleanJsExpr(s.expr, externalVars, templateLang, moduleName)}}`
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
    ? cleanJsExpr(expressions[0], env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
    : buildTemplateFromSegments(segments, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)

  const id = env.id ?? `a${++state.counter}`
  const attrName = env.attrName ?? ''
  // nom (et espace de noms) que le gabarit déclare et que la mise à jour retrouve (cf. adjustedAttr)
  const adj = adjustedAttr(env, attrName)
  const nom = adj.name
  let attrStr = env.attrStr

  if (env.ctx.type === 'root') {
    const code = ecrireAttrRacine('this', id, adj, jsTemplateStr)
    pushUpdate(env, code, vars)
    attrStr += ` ${nom}=''`
  } else if (env.ctx.type === 'for') {
    // SÉCURITÉ (XSS) — `href="{item.url}"` (interpolation QUOTÉE
    // dans un {for}, données d'item souvent distantes) émettait un `setAttribute`
    // BRUT contournant `µ._mjs_safeAttr` : `item.url = "javascript:…"` passait tel quel
    // (incohérent avec `href={item.url}` NON quoté, déjà filtré). On route par
    // `µ._mjs_updAttrNode` (comme root via `_mjs_updAttr`) → filtre javascript:/data:html.
    // La valeur vient d'un template literal (toujours string) → jamais false/null,
    // donc pas de removeAttribute intempestif ; `_mjs_safeAttr` re-diffe en interne.
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${ecrireAttr(`_mjs_n${env.lid}`, adj, jsTemplateStr)}; } }`)
    // var externe interpolée dans la row (`title="v : {$prefix}"`) :
    // sans `structVars`, `_mjs_renderStruct` sauté → attribut figé à vie sur mutation.
    for (const v of vars) state.structVars.add(v)
    attrStr += ` ${nom}=''`
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
      if (s.expr !== null) jsValClone += `\${${cleanJsExpr(s.expr, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)}}`
    }
    attrStr += ` ${attrName}='${jsValClone}'`
    // la chaîne suit les variables qu'elle lit (cf. dynamic, branche {await}) ; le nœud est celui de `mjs-id`, posé par l'appelant
    suivreEnBranche(env, id, jsTemplateStr, `${ecrireAttr('_mjs_node', adj, jsTemplateStr)};`, vars)
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
      throw new Error(t('generator.event-emit-forme', { attrName, evt }))
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
    const hint = suggestion && suggestion !== mod ? t('generator.hint-modificateur-suggestion', { suggestion }) : ''
    throw new Error(t('generator.event-modificateur-inconnu', { attrName, mod, hint }))
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
    rawContent = dedent(env.attr.expr.toString()).trim()
  } else if (env.attr.val != null && env.attr.val !== '') {
    rawContent = dedent(env.attr.val.toString().replace(/^\{/, '').replace(/\}$/, '')).trim()
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
    if (evt.includes(':')) throw new Error(t('generator.event-deux-points-abrege', { evt }))
    rawContent = `${evt}(e, el)`
  }

  // en Civet, les accolades derrière une flèche sont un bloc, jamais un objet (cf. corpsDeFlecheEnBloc)
  const cleanedJs = env.compiler.templateLang === 'js' ? cleanJs(rawContent, env.compiler.externalVars) : corpsDeFlecheEnBloc(cleanJs(rawContent, env.compiler.externalVars))
  const idx = state.inlines.length

  // noms du gabarit en portée (boucles, `{const}`, valeur `{await}`), recréés dans l'ordre
  const reconstructCoffee = squelettePortee(env, cleanedJs, (l, luApres) => {
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
    // ligneBoucleLiaison) — cette conversion seulement quand l'élément est lu : par le gestionnaire, par l'itérable d'une boucle
    // intérieure ou par un `{const}` recréé après la boucle (texteLuApres)
    // ligne pure d'un `{for}` de racine (cf. LoopInfo.parEntree) : l'élément et l'indice se lisent sur l'entrée de la ligne, que la
    // réconciliation tient à jour même quand elle saute la ligne (`_mjs_it`, `_mjs_ix`) ; la balise y mène par `_mjs_row` (posé par le
    // gabarit de la ligne). Le temporaire garde le nom du squelette, que le contrôle des constantes reconnaît (cf. const-reassign.ts)
    if (l.parEntree) {
      return `  _mjs_ra_${d} = el._mjs_row._mjs_en\n` +
        `  ${item} = _mjs_ra_${d}._mjs_it\n` +
        `  ${idxVar} = _mjs_ra_${d}._mjs_ix\n`
    }
    const lu = new RegExp(`(?<![\\w$.])${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(luApres)
    return `  _mjs_ri_${d} = el._mjs_idx_${d} ${state.templateLang === 'js' ? '?' : '??'} el.getAttribute('data-mjs-idx-${d}')\n` +
      `  _mjs_ra_${d} = ${iterable}\n` +
      (lu ? `  _mjs_ra_${d} = Array.from(_mjs_ra_${d}) if _mjs_ra_${d} instanceof Map or _mjs_ra_${d} instanceof Set\n` : '') +
      `  _mjs_ri_${d} = +_mjs_ri_${d} if Array.isArray(_mjs_ra_${d})\n` +
      `  ${item} = _mjs_ra_${d}[_mjs_ri_${d}]\n` +
      `  ${idxVar} = _mjs_ri_${d}\n`
  })

  const userCode = dedent(cleanedJs).split('\n').map(l => `  ${l}`).join('\n')
  pushInline(env, `(e, el) =>\n${modCoffee}${reconstructCoffee}${userCode}`)

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
  const jsVar = cleanJs(varExpr, env.compiler.externalVars)

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

  let updateLogic: string
  if (baseAttr === 'value' && (env.node.name ?? '').toLowerCase() === 'select') {
    // <select> : l'aide du runtime choisit les options (un tableau pour `multiple`) et réapplique la valeur quand elles
    // changent (options chargées ensuite) ; variable vide (`null`) : rien de choisi
    updateLogic = `µ._mjs_selVal(_mjs_node, ${jsVar} == null ? '' : ${jsVar});`
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
    updateLogic = `µ._mjs_updAttrNode(_mjs_node, '${baseAttr}', ${jsVar}${attrSur(baseAttr)});`
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
    const reactiveCode = effetRacineLiaison(env, id, jsVar, updateLogic)
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    registerEffect(reactiveCode, [...new Set([...vars, ...varsDesConst(env, jsVar)])])
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
    valExtractor = `if _mjs_el.type == 'select-multiple' then Array.from(_mjs_el.selectedOptions).map((_mjs_opt) => _mjs_opt.value) else (if ${autoNum} then Number(_mjs_el.value) else ${castExpr('_mjs_el.value')})`
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
  const reconstructCoffee = squelettePortee(env, jsVar, ligneBoucleLiaison)

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

  registerEventRoute(evtType, id, idx, 0, 'binding')

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
  const jsVar = cleanJs(varExpr, env.compiler.externalVars)
  const id = env.id ?? `d${++state.counter}`

  let attrStr = env.attrStr
  let reconstructJs = ''
  if (env.ctx.loops && env.ctx.loops.length > 0) {
    const propPosed = pushIdxPropUpdates(env)
    // un nom déjà déclaré par une boucle englobante (l'`index` par défaut de deux boucles imbriquées) est réaffecté, jamais redéclaré :
    // un second `let index` dans le même bloc empêchait le composant de se construire
    const declares = new Set<string>()
    const poser    = (nom: string, valeur: string): string => {
      const decl = declares.has(nom) ? '' : 'let '
      declares.add(nom)
      return `${decl}${nom} = ${valeur}; `
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
      reconstructJs += poser(l.item, `_mjs_ra_${d}[_mjs_ri_${d}]`)
      reconstructJs += poser(l.index, `_mjs_ri_${d}`)
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
  const jsVar = cleanJs(varExpr, env.compiler.externalVars)

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
      const reactiveCode = effetRacineLiaison(env, id, jsVar, updateLogic)
      // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
      registerEffect(reactiveCode, [...new Set([...vars, ...varsDesConst(env, jsVar)])])
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
  const reconstructCoffee = squelettePortee(env, jsVar, ligneBoucleLiaison)

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
  const jsVar = cleanJs(varName, env.compiler.externalVars)
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
  const reconstructCoffee = squelettePortee(env, varName, ligneBoucleLiaison)

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
  const corps  = (n: string): string => prop === 'innerHTML'
    ? `const _mjs_h = String(${jsVar}); if (${n}._mjs_html !== _mjs_h) { ${n}._mjs_html = _mjs_h; if (${n}.innerHTML !== _mjs_h) ${n}.innerHTML = _mjs_h; }`
    : `if (${n}.textContent !== String(${jsVar})) ${n}.textContent = String(${jsVar});`
  const ecrire = (n: string): string => prop === 'innerHTML'
    ? `if (${n}) { ${corps(n)} }`
    : `if (${n} && ${n}.textContent !== String(${jsVar})) ${n}.textContent = String(${jsVar});`

  if (env.ctx.type === 'root') {
    const code = `{ ` +
      `const _mjs_node = ${ptr}._mjs_nodes['${id}']; ` +
      `${ecrire('_mjs_node')} ` +
      `}`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ ` +
      `const _mjs_node = __nodes['${env.lid}']; ` +
      `${ecrire('_mjs_node')} ` +
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
      `${ecrire('_mjs_node')} ` +
      `}`
    env.ctx.updates.push(initCode)
    // effet posé à la racine : valeur `{await}` et `{const}` de la branche recréés s'ils sont lus (cf. effetRacineLiaison),
    // et seulement quand cette branche est celle qui est affichée (cf. brancheCourante), qu'elle lise la valeur de la branche ou non :
    // promesse remplacée ou rejetée, la valeur lue vaut `null` et `v.titre` ferait tomber le composant, et le nœud retiré de la page
    // continuerait de recevoir le texte ou le HTML (un `<img onerror>` écrit dans un nœud détaché s'exécute quand même)
    const prelude      = squelettePortee(env, jsVar, () => '', 'js')
    const affichee     = brancheCourante(env)
    const reactiveCode = prelude || affichee
      ? `{ const _mjs_node = ${ptr}._mjs_nodes['${id}']; if (_mjs_node${affichee ? ` && ${affichee}` : ''}) { ${prelude}${corps('_mjs_node')} } }`
      : `{ ` +
        `const _mjs_node = ${ptr}._mjs_nodes['${id}']; ` +
        `${ecrire('_mjs_node')} ` +
        `}`
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    registerEffect(reactiveCode, [...new Set([...vars, ...varsDesConst(env, jsVar)])])
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
  const jsVar = cleanJs(varExpr, env.compiler.externalVars)

  const vars = getEffectVars(varExpr)

  const rawAttr = env.attrName ?? ''
  const cast = rawAttr.match(/\.(number|int|float|string|bool|boolean)$/)?.[1]

  const pureVarName = varExpr.replace(/^\$/, '').replace(/[^a-zA-Z0-9_]/g, '-')
  const id = env.id ?? `g${++state.counter}`
  // le groupe natif porte le numéro de l'exemplaire du composant (`_mjs_gid`, donné au premier passage) : sans lui, deux exemplaires posés dans
  // le même arbre (`@lightDom`), ou deux composants qui lient la même variable, formaient un seul groupe — un clic dans l'un décochait l'autre
  // sans que son état bouge. Un `name` écrit par l'auteur reste le sien
  const nomAuteur = (env.node.attrs ?? []).some((a) => a.name === 'name')
  const nomGroupe = (suffixe: string): string => nomAuteur ? '' :
    `{ const _mjs_gn = \`mjs-grp-${pureVarName}-\${_mjsThis._mjs_gid ??= (µ._mjs_gseq = (µ._mjs_gseq || 0) + 1)}${suffixe}\`; if (_mjs_node.name !== _mjs_gn) _mjs_node.name = _mjs_gn; } `

  const updateLogic = `if (_mjs_node.type === 'radio') { ` +
    `_mjs_node.checked = (_mjs_node.value === String(${jsVar})); ` +
    `} else if (_mjs_node.type === 'checkbox') { ` +
    `_mjs_node.checked = (Array.isArray(${jsVar}) && ${jsVar}.map(String).includes(_mjs_node.value)); ` +
    `}`

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${nomGroupe('')}${updateLogic} } }`
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
    const uniqueSuffix = dependsOnLoop ? loopsGrp.map((l) => `-\${${l.index}}`).join('') : ''
    const updateLogicFor = nomAuteur
      ? (uniqueSuffix ? `_mjs_node.name = \`mjs-grp-${pureVarName}${uniqueSuffix}\`; ${updateLogic}` : updateLogic)
      : `${nomGroupe(uniqueSuffix)}${updateLogic}`
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
    const initCode = `{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${nomGroupe('')}${updateLogic} } }`
    env.ctx.updates.push(initCode)
    const reactiveCode = effetRacineLiaison(env, id, jsVar, updateLogic)
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    registerEffect(reactiveCode, [...new Set([...vars, ...varsDesConst(env, jsVar)])])
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
  const reconstructCoffee = squelettePortee(env, jsVar, ligneBoucleLiaison)

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

  registerEventRoute('change', id, idx, 0, 'binding')

  attrStr += ` name='mjs-grp-${pureVarName}'`
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
  const jsVar = cleanJs(varExpr, env.compiler.externalVars)
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
  const jsVar = cleanJs(varExpr, env.compiler.externalVars)
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
  const reconstructCoffee = squelettePortee(env, jsVar, ligneBoucleLiaison)

  const updateLogic = `(_mjs_node._mjs_binds ??= new Set()).add('${prop}'); ` +
    `if (_mjs_node._set) { ` +
    `  if (_mjs_node._state && _mjs_node._state['${prop}'] !== ${jsVar}) _mjs_node._set('${prop}', ${jsVar}); ` +
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
    `  µ._mjs_pend(_mjs_node, ${pendKey}, ${jsVar}, 1); ` +
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
    const reactiveCode = effetRacineLiaison(env, id, jsVar, updateLogic)
    // l'effet recrée les `{const}` que la liaison lit : il suit aussi les variables que ces `{const}` lisent
    const varsEffet = [...new Set([...vars, ...varsDesConst(env, jsVar)])]
    notePropVars(varsEffet)
    registerEffect(reactiveCode, varsEffet)
  }

  const idx = state.inlines.length
  let inlineBody = `  return if _mjs_el and _mjs_el != _mjs_e.target\n`
  inlineBody += reconstructCoffee
  // Convention MJS : l'event `mjs-bind:X` porte la valeur dans `_mjs_e.data`
  // (cf. `_mjs_notifyMutation` runtime, `_bindEv.data = ...`). PAS `e.detail`.
  // comparaison sans conversion : de vide à 0 (ou de 0 à vide), la valeur remonte
  if (cast) {
    inlineBody += `  _mjs_cast = ${castExprFor(cast, '_mjs_e.data')}\n`
    inlineBody += `  ${jsVar} = _mjs_cast unless Object.is(${jsVar}, _mjs_cast)\n`
  } else {
    inlineBody += `  ${jsVar} = _mjs_e.data unless Object.is(${jsVar}, _mjs_e.data)\n`
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
  const lang    = env.compiler.templateLang
  const expr    = (e: string) => cleanJsExpr(e, env.compiler.externalVars, lang, env.compiler.moduleName)
  const dyn     = env.node.attrs.filter((a) => propModule(env.node, a))
  const natifs  = dyn.filter((a) => /^(?:class|style|id|data-.*|aria-.*)$/i.test(a.name ?? ''))
  const props   = dyn.filter((a) => !natifs.includes(a))
  const varsDe  = (l: Attr[]) => [...new Set(l.flatMap((a) => getEffectVars(a.expr ?? '')))]
  const vars    = [...new Set([...getEffectVars(env.attr.expr ?? ''), ...varsDe(dyn)])]
  const id      = env.id ?? `a${++state.counter}`
  const accept  = env.node.attrs.find((a) => a.name === 'mjs-accept')
  const liste   = accept ? `[${String(accept.val ?? '').split(/\s+/).filter(Boolean).map((n) => `'${n}'`).join(', ')}]` : 'null'
  const objet   = (l: Attr[]) => `{ ${l.map((a) => `${JSON.stringify(propName(a.name ?? ''))}: (${expr(a.expr ?? '')})`).join(', ')} }`
  const appel   = (noeud: string, lesProps: string, refs = '') => `µ._updModule(this, null, (${expr(env.attr.expr ?? '')}), ${liste}, ${lesProps}, ${noeud}, ${objet(natifs)}${refs});`

  if (env.ctx.type === 'for') {
    // une ligne rejoue tout à chaque passage, comme un composant écrit en dur dans une ligne ; `__nodes`
    // (les refs de la ligne) permet de resynchroniser la liste quand le composant remplace le repère
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${appel(`_mjs_n${env.lid}`, objet(props), ', __nodes')} } }`)
    for (const v of vars) state.structVars.add(v)
    return { id }
  }

  // racine ou branche `{await}` : le composant (et les attributs de la balise) suivent l'expression du
  // composant ; les props sont posées à la création, puis chacune par son propre effet, sur ses seules
  // variables — comme un composant écrit en dur : changer `$t` ne repose pas `ids` ni `opts`
  const varsMain = [...new Set([...getEffectVars(env.attr.expr ?? ''), ...varsDe(natifs)])]
  const lesProps = `() => (${objet(props)})`
  if (env.ctx.type === 'root') {
    pushUpdate(env, `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${appel('_mjs_node', lesProps)} } }`, varsMain)
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
  env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) { ${appel('_mjs_node', lesProps)} } }`)
  const affichee = brancheCourante(env)
  const garde    = (corps: string) => affichee ? `if (${affichee}) { ${corps} }` : corps
  const noms     = (l: string[]) => l.map((e) => expr(e)).join(', ')
  // les variables que lit un `{const}` recréé par un effet comptent aussi : `{const c = $obj}` puis `x={c.x}` suit `$obj` ; l'effet
  // du composant et des attributs de la balise suit celles que lisent l'expression du composant et les attributs natifs, chaque
  // prop suit celles que lit sa propre expression
  const varsConst = (l: string[]) => varsDesConst(env, noms(l))
  registerEffect(garde(`{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${squelettePortee(env, noms([env.attr.expr ?? '', ...dyn.map((a) => a.expr ?? '')]), () => '', 'js')}${appel('_mjs_node', lesProps)} } }`), [...new Set([...varsMain, ...varsConst([env.attr.expr ?? '', ...natifs.map((a) => a.expr ?? '')])])])
  for (const p of props) {
    const pv = [...new Set([...getEffectVars(p.expr ?? ''), ...varsConst([p.expr ?? ''])])]
    if (pv.length === 0) continue
    registerEffect(garde(`{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${squelettePortee(env, noms([p.expr ?? '']), () => '', 'js')}µ._mjs_modSet(_mjs_node, ${JSON.stringify(propName(p.name ?? ''))}, (${expr(p.expr ?? '')})); } }`), pv)
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

// les réglages d'une transition créée par `µanim.create` : nommés, une valeur fixe (une durée
// devient des ms, `12` un nombre, `right` ou `'texte'` une chaîne, `[a, b]` une liste) ou une
// variable (`$x`, `item.id`) lue à la pose
function customOpts(name: string, raw: string, scope: string[], expr: (v: string) => string): string {
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
    throw new Error(t('transitions.maison-valeur', { nom: name, reglage: '', valeur: v }))
  }
  for (const item of splitTop(raw)) {
    if (item === '') continue
    const m = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/.exec(item)
    if (!m) throw new Error(t('transitions.maison-positionnel', { nom: name }))
    try {
      parts.push(`${JSON.stringify(m[1])}: ${lit(m[2].trim())}`)
    }
    catch {
      throw new Error(t('transitions.maison-valeur', { nom: name, reglage: m[1], valeur: m[2].trim() }))
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

  const getVal = (a: any): string => {
    let val = a.expr ?? a.val ?? ''
    val = val.toString().trim()
    if (val.startsWith('{') && val.endsWith('}')) val = val.slice(1, -1)
    if (val.includes('Generated by CoffeeScript')) {
      val = val.split('\n').filter((l: string) => !l.includes('Generated by CoffeeScript')).join(' ')
    }
    val = val.trim()
    if (val.endsWith(';')) val = val.slice(0, -1)
    return val.trim()
  }

  // Les callbacks contiennent du code utilisateur (`$.x = ...`) — il faut le
  // faire passer par le même pipeline que le script init pour que les
  // assignations déclenchent `µ._set(_mjsThis, …)` et l'invalidation qui va
  // avec. Sans ça, `$.status = 'intro started'` écrit sur `_state` mais
  // n'invalide rien → le binding `{$status}` ne re-render pas.
  const cbAssignments = Object.entries(cbs)
    .filter(([_, a]) => a)
    .map(([key, a]) => {
      // Pas de bare-ref ici : les handlers inline sont compilés PENDANT le walk du
      // template, donc `effectsByVar` est encore partiel → on ne peut pas prouver
      // qu'une ref n'est pas bindée. On laisse `µ._mjs_deepSet` (réactif, correct) ;
      // le hot-path (refresh dans le script principal) est optimisé en ligne 966.
      const body = applyPathTracking(transformReactiveWrites(cleanJs(getVal(a), env.compiler.externalVars)))
      // `\n` explicite avant `; };` (pas juste un espace) : `getVal`/`cleanJs` ont déjà
      // consommé le saut de ligne d'origine (`.trim()`) — sans un VRAI `\n` ici, un `body`
      // se terminant par un commentaire `//` (Civet/Coffee) avalerait la fermeture du
      // callback. `flattenPreservingLiterals` (plus bas) préserve ensuite ce saut de ligne
      // PRÉCISÉMENT parce qu'il termine potentiellement un tel commentaire.
      return `_mjs_node._mjs_cb_${key} = () => { ${body}\n; };`
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
    if (!m && /^\*[A-Za-z][\w-]*(?:\.[a-z][a-z0-9_]*)?$/.test(String(a.val ?? ''))) throw new Error(t('transitions.guillemets', { directive: transitionDirective(a.name ?? '@' + dir), effet: String(a.val) }))
    if (!m) throw new Error(t('transitions.attend-effet', { directive: '@' + dir }))
    const name  = m[1]
    const raw   = m[2]
    const scope = env.ctx.locals ? Array.from(env.ctx.locals) : []
    const expr  = (v: string) => cleanJsExpr(v, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
    if (!effectSpec(name)) {
      const proche = nearestEffect(name)
      // une faute de frappe sur un effet connu (`fdae`), ou un alias que cet effet n'a pas (`fade.inconnu`) : l'erreur donne le
      // bon nom ; sinon, une transition créée par µanim.create (vérifiée en fin de build)
      // un effet retiré ou fondu dans un autre (`*knockout` → `*gradient.knockout`) : le message de l'effet posé directement
      if (proche.distance <= 1 || (name.includes('.') && EFFECTS[name.split('.')[0]]) || removedEffectError(name)) parseEffect(name, raw, scope)
      state.usedAnimations.add(name)
      return `µ._mjs_fxAnimCustom(${JSON.stringify(name)}, ${customOpts(name, raw, scope, expr)}\n)`
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
                .catch(_mjs_err => console.warn(${JSON.stringify(t('generator.erreur-intro'))}, _mjs_err));
            });
          } catch(_mjs_err) { console.error(${JSON.stringify(t('generator.echec-intro'))}, _mjs_err); }
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
  // `$x` → `$.x`, `and`/`or`/`not` → `&&`/`||`/`!`) avant de chercher l'op.
  // Sans ça, `@class{$selected is item}` n'est jamais reconnu comme filtered
  // → fallback non-filtered → l'effect global n'est pas registered →
  // le binding ne re-tire jamais sur mutation de `$selected`.
  const trimmed = cleanJs(conditionExpr, externalVars).trim()
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
} | null {
  if (!expr) return null
  // Idem `detectFilteredPattern` : normalise les idiomes Coffee/Civet pour
  // que `is`/`isnt`/`and`/`or`/`not` ne bloquent pas la détection filtered.
  const trimmed = cleanJs(expr, externalVars).trim()

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
    // La cond doit matcher un filtered pattern.
    const filt = detectFilteredPattern(before, loopItem, externalVars)
    if (!filt) return null
    return {
      externVar: filt.externVar,
      itemAccess: filt.itemAccess,
      matchValue: trueVal,
      unmatchValue: falseVal,
      isBoolean: false,
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
    }
  }
  return null
}

// le champ filtré est-il la clé du `by` de la boucle ? Une ligne gardée par sa clé garde alors la même valeur filtrée : son entrée d'index ne change jamais de clé, rien à lâcher.
// Sans `by`, sur un autre champ ou sur l'élément lui-même, le champ peut changer sur une ligne gardée
function filtreSurLaCle(boucle: { key?: string | null } | null, itemAccess: string): boolean {
  return !!boucle && boucle.key != null && itemAccess === boucle.key
}

// plusieurs lignes peuvent porter la valeur filtrée dès que le champ n'est pas la clé du `by` d'une boucle seule (`lacher`) : une valeur répétée, une clé reprise dans un autre groupe d'une
// boucle imbriquée. L'index garde alors la fonction de chaque ligne (cf. poseFonctionFiltree) ; la boucle seule filtrée sur sa clé garde le code d'avant, à l'octet
function plusieursLignes(lacher: boolean, boucles: unknown[]): boolean {
  return lacher || boucles.length > 1
}

// la valeur écrite par une liaison filtrée (attribut, style) lit-elle la ligne ? Un nom de la portée de la ligne — élément, index, `{const}`, boucle parente — rend périmée la fonction
// gardée dans l'index : elle a fermé sur la passe qui l'a faite. Ne la rendent pas périmée : un texte ou un nombre, le champ filtré lui-même (même valeur tant que la clé ne change pas,
// et une clé qui change fait refaire la fonction), une variable d'état (`$.x`, relue à l'appel). Dans le doute (gabarit de texte, portée inconnue, élément filtré lu) : oui
function valeurLitLaLigne(valeurs: string[], item: string, itemAccess: string, ctx: AttrCtx['ctx']): boolean {
  if (!ctx.portee) return true
  const noms = new Set<string>(ctx.locals ?? [])
  for (const l of ctx.loops) {
    if (l.item) noms.add(l.item)
    if (l.index) noms.add(l.index)
  }
  for (const p of ctx.portee) {
    if (p.kind === 'for') {
      if (p.loop.item) noms.add(p.loop.item)
      if (p.loop.index) noms.add(p.loop.index)
    }
    else noms.add(p.name)
  }
  const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const champ    = itemAccess ? new RegExp(`(?<![\\w$.])${echapper(item)}\\.${echapper(itemAccess)}(?![\\w$.\\[(])`, 'g') : null
  for (const valeur of valeurs) {
    if (valeur.includes('`')) return true
    let texte = valeur.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '0')
    if (champ) texte = texte.replace(champ, '0')
    texte = texte.replace(/\b\d[\w.]*/g, '0').replace(/\.\.\./g, ' ')
    for (const m of texte.matchAll(/(?<![\w$µ.])[A-Za-z_$µ][\w$µ]*/g)) if (noms.has(m[0])) return true
  }
  return false
}

// pose, dans l'index d'une liaison filtrée par valeur (attribut, style), la fonction de la ligne. `refaire` : la fonction est refaite à CHAQUE passe de la ligne (sinon seulement si la clé
// est inédite ou détenue par une autre ligne) ; `lacher` : la ligne lâche l'entrée de son ancienne clé, tant qu'elle est la sienne. Sans l'un ni l'autre, le code est celui d'avant, à l'octet
function poseFonctionFiltree(creer: string, idxName: string, refaire: boolean, lacher: boolean, multi = false): string {
  const lecture = `const __f0 = __fns['${idxName}']; `
  // `multi` : plusieurs lignes peuvent porter la même valeur (cf. dynamic) ; l'index garde alors la fonction de chacune, un Set quand une clé en porte plusieurs
  // (µ._mjs_filtPut). La ligne retire la sienne, sous la clé où elle est posée, avant d'en poser une neuve : le garde reste celui d'avant, une clé à Set la fait refaire à chaque passe
  if (multi) {
    const cle     = lacher ? `const _mjs_pk = (__nodes._mjs_filterKeys ??= {})['${idxName}']; ` : ''
    const retire  = `if (__f0 !== void 0) µ._mjs_filtDrop(__idx, ${lacher ? '_mjs_pk' : '__k'}, __f0); `
    const poseSet = `µ._mjs_filtPut(__fe, __k, __f); __fns['${idxName}'] = __f; `
    if (refaire) return `${lecture}${cle}${retire}${creer}${poseSet}`
    return `${lecture}if (__f0 === void 0 || __idx.get(__k) !== __f0) { ${cle}${retire}${creer}${poseSet}} `
  }
  const lache   = lacher ? `const _mjs_pk = (__nodes._mjs_filterKeys ??= {})['${idxName}']; if (__f0 !== void 0 && _mjs_pk !== __k && __idx.get(_mjs_pk) === __f0) __idx.delete(_mjs_pk); ` : ''
  const pose    = `__idx.set(__k, __f); __fns['${idxName}'] = __f; `
  if (refaire) return `${lacher ? lecture : ''}${lache}${creer}${pose}`
  return `${lecture}if (__f0 === void 0 || __idx.get(__k) !== __f0) { ${lache}${creer}${pose}} `
}

// liaison filtrée par valeur d'une ligne de `{for}` (attribut, `@class`, `@style`), commune aux trois : la passe de la
// ligne (`logique`) la pose et range sa fonction ou son nœud (`pose`) dans l'index de sa valeur ; l'effet de la racine
// ne touche que les deux lignes qui changent quand la variable bouge, l'ancienne valeur s'éteint, la nouvelle s'allume.
// `bascule(valeur, allume)` : l'effet sur l'entrée d'une valeur quand une seule ligne la porte ; avec `multi`, plusieurs
// lignes peuvent la porter et µ._mjs_filtCall les appelle toutes. Le texte émis est le même pour les trois liaisons
function liaisonFiltree(env: AttrCtx, externVar: string, idxName: string, keyExpr: string, logique: string, pose: string, multi: boolean, bascule: (valeur: string, allume: string) => string): void {
  env.ctx.updates.push(
    `{ const _mjs_n${env.lid} = __nodes['${env.lid}']; ` +
    `if(_mjs_n${env.lid}) { let _mjs_node = _mjs_n${env.lid}; ${logique} ` +
    `const __k = ${keyExpr}; ` +
    `const __fe = ((_mjsThis._mjs_filt ??= {})['${idxName}'] ??= { idx: null, prev: void 0 }); ` +
    `const __idx = (__fe.idx ??= new Map()); ` +
    `const __fns = (__nodes._mjs_filterFns ??= {}); ` +
    pose +
    `(_mjsThis._mjs_filtIdxKeys ??= new Set()).add('${idxName}'); ` +
    `(__nodes._mjs_filterKeys ??= {})['${idxName}'] = __k; ` +
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
      : `if (_mjs_prev !== void 0) { ${bascule('_mjs_prev', 'false')} } ` +
        `if (_mjs_curr !== void 0) { ${bascule('_mjs_curr', 'true')} } `) +
    `} ` +
    `__fe.prev = _mjs_curr; ` +
    `} }`
  // Expansion transitive : si la variable est un dérivé, l'effet s'abonne aussi à ses dépendances statiques (sinon une
  // dépendance qui mute laisse le dérivé périmé et l'effet endormi) — getEffectVars passe par analyzer.resolveSnippetDeps.
  // Hors garde de branche : le souvenir `prev` suit la variable même quand un {if} cache la liste, sinon la ligne
  // éteinte au retour n'est pas la bonne (cf. CompilerState.registerEffect)
  const filtVars = getEffectVars(`$${externVar}`)
  registerEffect(filtEffectCode, filtVars.length > 0 ? filtVars : [externVar], { unguarded: true })
}

// effet sur la ligne seule d'une valeur, pour l'attribut et le style : sa fonction, appelée allumée ou éteinte
const appelFiltre = (valeur: string, allume: string): string => `const _mjs_f = _mjs_idx.get(${valeur}); if (_mjs_f) _mjs_f(${allume});`

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
  const jetons    = (v: string | undefined): string[] => (v ?? '').trim().split(/\s+/).filter(Boolean)
  const condition = (a: { name?: string }): string => (a.name ?? '').match(/@class\{(.+)\}/)![1]
  const bascules  = (env.node.attrs ?? []).filter((a) => /^@class\{.+\}$/.test(a.name ?? ''))
  const miennes   = jetons(env.rawVal)
  const groupes   = new Map<string, string[]>(miennes.length === 0 ? [[m[1], []]] : [])
  for (const c of miennes) {
    const porteuses = bascules.includes(env.attr) ? bascules.filter((a) => a === env.attr || jetons(a.val).includes(c)) : [env.attr]
    if (porteuses[0] !== env.attr) continue
    const cond = porteuses.length > 1 ? porteuses.map((a) => `(${condition(a)})`).join(' || ') : m[1]
    groupes.set(cond, [...(groupes.get(cond) ?? []), c])
  }
  // toutes ses classes ensemble (le cas courant) : la chaîne écrite, garde et code d'avant à l'octet
  let id = env.id
  for (const [cond, classes] of groupes) id = basculeDeClasses(env, id, classes.length === miennes.length ? env.rawVal : classes.join(' '), cond)
  return { id }
}

// une bascule de `className` (une ou plusieurs classes) sur la condition `conditionExpr` ; rend l'id du nœud, créé au besoin
function basculeDeClasses(env: AttrCtx, idNoeud: string | undefined, className: string, conditionExpr: string): string {
  // Site EXPR (condition @class{cond}, même nature qu'un {if}).
  const jsVar = cleanJsExpr(conditionExpr, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)

  const vars = getEffectVars(conditionExpr)
  const id = idNoeud ?? `c${++state.counter}`
  // Toggle GARDÉ : ne touche le DOM que si la condition a CHANGÉ pour ce nœud.
  // L'updateFn d'un {for} est ré-exécutée sur TOUTES les lignes à chaque
  // réconciliation → l'ancien `toggle()` inconditionnel faisait 1000 appels
  // DOM no-op par update (profiler : poste de style-recalc sur create/update).
  // L'état est porté par le nœud (`_mjs_cl_<classe>`), partagé entre l'updateFn
  // et la closure du filtered-dispatch — cohérent car les deux écrivent la
  // même classe sur le même nœud.
  const safeCls = className.replace(/[^a-zA-Z0-9_$]/g, '_')
  const guardProp = `_mjs_node._mjs_cl_${safeCls}`
  // `@class{cond}="foo bar"` (multi-classes) : un token
  // avec espace fait jeter `classList.toggle` (InvalidCharacterError). On émet un
  // toggle par classe (tokens connus au compile). La garde reste sur `safeCls`
  // (valeur combinée) — cohérente entre updateFn et effet filtré.
  const clsTokens = className.trim().split(/\s+/).filter(Boolean)
  const clsToggle = (nodeVar: string, boolExpr: string): string =>
    clsTokens.map((c) => `${nodeVar}.classList.toggle('${c}', ${boolExpr});`).join(' ')
  const updateLogic = `{ const _mjs_tv = !!(${jsVar}); if (${guardProp} !== _mjs_tv) { ${clsToggle('_mjs_node', '_mjs_tv')} ${guardProp} = _mjs_tv; } }`

  if (env.ctx.type === 'root') {
    const code = `{ const _mjs_node = this._mjs_nodes.${id}; if(_mjs_node) { ${updateLogic} } }`
    pushUpdate(env, code, vars)
  } else if (env.ctx.type === 'for') {
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
      // `_mjs_filtIdxKeys` (Set côté instance) pour énumérer les Maps actives au
      // destroy, et (b) la filterKey dans `__nodes._mjs_filterKeys` (par row) pour
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
      // plusieurs lignes peuvent porter la valeur (cf. plusieursLignes) : l'index garde alors la
      // fonction de chaque ligne (un Set quand une clé en porte plusieurs), non son nœud, et une
      // ligne qui change de clé (champ filtré modifié, ligne positionnelle d'une liste sans clé)
      // lâche son ancienne entrée (cf. poseFonctionFiltree). La boucle seule filtrée sur sa clé
      // garde l'index de nœuds d'avant, à l'octet
      const lacher = !filtreSurLaCle(lastLoop, filt.itemAccess)
      const multi  = plusieursLignes(lacher, env.ctx.loops)
      const creer  = `const __f = (_mjs_match) => { ${clsToggle(`_mjs_n${env.lid}`, '_mjs_match')} _mjs_n${env.lid}._mjs_cl_${safeCls} = _mjs_match; }; `
      const pose   = multi
        ? poseFonctionFiltree(creer, idxName, false, lacher, true)
        : `if (__fns['${idxName}'] === void 0 || __idx.get(__k) !== _mjs_n${env.lid}) { __idx.set(__k, _mjs_n${env.lid}); __fns['${idxName}'] = _mjs_n${env.lid}; } `
      // l'index stocke le NŒUD de la ligne (sans `multi`) : l'effet de la racine bascule la classe directement, sans
      // appel de fonction, et tient à jour la garde `_mjs_cl_${safeCls}` que relit la passe de la ligne
      liaisonFiltree(env, filt.externVar, idxName, keyExpr, updateLogic, pose, multi, (valeur, allume) => `const _mjs_nd = _mjs_idx.get(${valeur}); if (_mjs_nd) { ${clsToggle('_mjs_nd', allume)} _mjs_nd._mjs_cl_${safeCls} = ${allume}; }`)
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
    const varsEffet = [...new Set([...vars, ...varsDesConst(env, jsVar)])]
    if (varsEffet.length > 0) registerEffect(effetRacineLiaison(env, id, jsVar, updateLogic), varsEffet)
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
    jsCond = cleanJsExpr(conditionExpr, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
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
    if (fullMatch) fullExprRaw = cleanJsExpr(fullMatch[1], env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
    // Site EXPR (interpolation @style.X="pre-{$e}-post") — scan ÉQUILIBRÉ
    // (`buildTemplateFromSegments`/`splitBraceSegments`, cf. `interpolation()` ci-dessus),
    // PAS la regex naïve `/\{([^}]+)\}/` qui refermait sur le PREMIER `}` : un objet littéral
    // imbriqué (`{f({k: $w})}`) tronquait l'expression avant sa vraie fin → échec de
    // compilation sur du CSS pourtant valide.
    jsVal = buildTemplateFromSegments(splitBraceSegments(rawVal), env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
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
        const ecrireStyle = (valeur: string): string => {
          const v = valeur.trim()
          if (v === 'null' || v === 'undefined' || v === "''" || v === '""') return `_mjs_node.style.removeProperty('${cssProp}');`
          const texte = /^'([^'\\]*)'$|^"([^"\\]*)"$/.exec(v)
          if (!texte) return styleSetter(v)
          const brut = texte[1] ?? texte[2]
          if (/!important\s*$/i.test(brut)) return `_mjs_node.style.setProperty('${cssProp}', ${JSON.stringify(brut.replace(/\s*!important\s*$/i, '').trim())}, 'important');`
          return `_mjs_node.style.setProperty('${cssProp}', String(${v}));`
        }
        const setMatch   = ecrireStyle(filt.matchValue)
        const setUnmatch = ecrireStyle(filt.unmatchValue)
        const filteredLogic = `if (!!(${filt.itemAccess ? `${lastLoop!.item}.${filt.itemAccess}` : lastLoop!.item} === _mjsThis._state.${filt.externVar})) { ${setMatch} } else { ${setUnmatch} }`
        const keyExpr = filt.itemAccess
          ? `${lastLoop!.item}.${filt.itemAccess}`
          : `${lastLoop!.item}`
        // propriété de clé par fn (même schéma que @class et l'attribut filtrés) : (re)pose si la
        // clé est inédite ou détenue par une AUTRE ligne. L'ancien `if (!__idx.has(__k))` gardait la
        // fonction de la PREMIÈRE ligne à jamais : une liste reconstruite (un {if} qui la cache puis
        // la réaffiche) laissait l'index pointer sur les nœuds retirés — le choix suivant ne
        // touchait plus rien d'affiché, l'ancien restait allumé. Mêmes rattrapages que l'attribut
        // filtré, émis seulement là où le défaut est possible : fonction refaite à chaque passe si la
        // valeur lit la ligne, ancienne clé lâchée si le champ filtré n'est pas la clé du `by`
        const refaire = valeurLitLaLigne([filt.matchValue, filt.unmatchValue], lastLoop!.item, filt.itemAccess, env.ctx)
        const lacher  = !filtreSurLaCle(lastLoop, filt.itemAccess)
        const multi   = plusieursLignes(lacher, env.ctx.loops)
        const creer   = `const __f = (_mjs_match) => { let _mjs_node = _mjs_n${env.lid}; if (_mjs_match) { ${setMatch} } else { ${setUnmatch} } }; `
        liaisonFiltree(env, filt.externVar, idxName, keyExpr, filteredLogic, poseFonctionFiltree(creer, idxName, refaire, lacher, multi), multi, appelFiltre)
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
    const codeLu    = `${jsCond} ${fullExprRaw ?? jsVal}`
    const varsEffet = [...new Set([...vars, ...varsDesConst(env, codeLu)])]
    if (varsEffet.length > 0) registerEffect(effetRacineLiaison(env, id, codeLu, updateLogic), varsEffet)
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
function fixedCode(ecrit: string, settings: ParsedEffect): string {
  const proj = projectEffect(ecrit)
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
const OUVERTE      = /<[!?\/]/
function keptText(raw: string): string | null {
  const closed = raw.replace(CONSTRUCTION, '')
  if (OUVERTE.test(closed)) return null
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
function locateFault(err: unknown, ligne: number | undefined): unknown {
  if (err instanceof Error && ligne) (err as Error & { mjsLine?: number }).mjsLine = ligne
  return err
}

function bindingEffect(env: AttrCtx): AttrResult {
  const ecrit = (env.attrName ?? '').slice(1)
  let settings: ParsedEffect
  let name: string
  // toute faute de cet effet (nom inconnu, réglage faux, mauvaise balise, connexion absente) porte la ligne de sa balise
  try {
    settings = parseEffect(ecrit, env.rawVal, env.ctx.locals ? Array.from(env.ctx.locals) : [])
    // un effet de l'appli : réglé, c'est l'effet de la bibliothèque qui se pose ; CSS, sa définition part avec
    name     = settings.base ?? ecrit
    // un garde muet ne joue aucun effet de refus : *shake ne part pas au cœur
    if (name === 'guard' && settings.fixed.silent === true && !('fx' in settings.fixed) && !('fx' in settings.dynamic)) settings.fixed.fx = 'none'
    pullDefaults(name, settings)
    defaultSock(name, ecrit, settings, state.instanceProps.has('sock'))
    effectBind(name, settings, env.node as any)
    effectKids(name, settings, env.node)
    if (projectEffect(ecrit)) state.usesProjectEffects = true
    checkPlacement(name, settings, env.node.name ?? '', !!(env.ctx.svgNs || env.ctx.foreign), ecrit)
  }
  catch (err) {
    throw locateFault(err, env.node.line)
  }
  // une transition posée directement joue son animation (runtime/animations/<nom>.ts)
  if (effectSpec(name)!.transition) state.usedAnimations.add(name)
  const avant    = customDef(ecrit, settings) + nestedDefs(settings)
  const id       = env.id ?? `a${++state.counter}`
  // retrait de l'effet à la destruction du nœud ou du composant → chemin de destruction complet
  state.hasDestroyHooks = true
  const nodeRef  = env.ctx.type === 'root' ? `this._mjs_nodes.${id}` : env.ctx.type === 'for' ? `__nodes['${env.lid}']` : `__nodes['${id}']`
  const dynKeys  = Object.keys(settings.dynamic)
  const fixed    = fixedCode(ecrit, settings)
  if (dynKeys.length === 0) {
    env.ctx.updates.push(`{ const _mjs_fxn = ${nodeRef}; if(_mjs_fxn) { ${avant}µ._mjs_fx(this, _mjs_fxn, ${JSON.stringify(name)}, ${fixed}); } }`)
    return { id }
  }
  const dyn  = '{' + dynKeys.map(k => `${JSON.stringify(k)}: (${cleanJsExpr(settings.dynamic[k], env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)})`).join(', ') + '}'
  const spec = JSON.stringify(settings.spec)
  const vars = [...new Set(dynKeys.flatMap(k => getEffectVars(settings.dynamic[k])))]
  env.ctx.updates.push(`{ const _mjs_fxn = ${nodeRef}; if(_mjs_fxn) { ${avant}µ._mjs_fx(this, _mjs_fxn, ${JSON.stringify(name)}, ${fixed}, ${dyn}, ${spec}); } }`)
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
function litLaPortee(env: AttrCtx, code: string): boolean {
  for (const local of env.ctx.locals ?? []) {
    for (const nom of local.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (new RegExp(`(?<![\\w$.])${nom.replace(/\$/g, '\\$')}(?![\\w$])`).test(code)) return true
    }
  }
  return false
}

// le `<script>` de l'auteur déclare-t-il `el` à sa racine (variable, fonction, classe, import) ? Lu sur le JS que l'analyseur garde du script, jamais sur le
// `<script module>` ni sur un `@import` (le générateur ne les reçoit pas). Mémorisé par analyseur, il y en a un par compilation
const SCRIPT_DECLARE_EL = new WeakMap<object, boolean>()

function scriptDeclareEl(): boolean {
  const analyseur = state.analyzer
  const code      = analyseur?.modifiedCode
  if (typeof code !== 'string' || !code.includes('el')) return false
  const connu = SCRIPT_DECLARE_EL.get(analyseur)
  if (connu !== undefined) return connu
  let declaree = false
  try {
    const importe = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body.some((s: any) => s.type === 'ImportDeclaration' && s.specifiers.some((sp: any) => sp.local.name === 'el'))
    // une lecture de `el` ajoutée au bout du script reste libre tant que rien ne le déclare à sa racine (`var` des blocs compris)
    const libres  = freeIdentifiers(`${code}\n;el;`)
    declaree = importe || (libres !== null && !libres.has('el'))
  }
  catch {
    // script illisible : une autre passe le dira, `el` reste alors celui du framework
  }
  SCRIPT_DECLARE_EL.set(analyseur, declaree)
  return declaree
}

// ============================================================================
// BindingAttach — @attach={tooltip($msg)} ou @attach={(node) -> setup}
// Mode détecté via AST : DIRECT vs FACTORY (cf. ast_daemon analyze_attach_mode)
// ============================================================================
function bindingAttach(env: AttrCtx): AttrResult {
  // seul modificateur : `.once`, la fabrique est appelée une fois par balise, jamais rejouée
  const modificateurs = (env.attrName ?? '').split('.').slice(1)
  for (const mod of modificateurs) {
    if (mod === 'once') continue
    const suggestion = suggestKey(mod, ['once'])
    const hint = suggestion && suggestion !== mod ? t('generator.hint-modificateur-suggestion', { suggestion }) : ''
    throw new Error(t('generator.attach-modificateur-inconnu', { attrName: env.attrName ?? '', mod, hint }))
  }
  const once = modificateurs.includes('once')
  const rawExpr = env.attr.expr ?? env.attr.val
  if (!rawExpr) return { id: env.id }

  const jsFunc = cleanJs(rawExpr, env.compiler.externalVars)

  // `.once` : aucune variable suivie, la balise déjà attachée n'est jamais reposée
  const vars = once ? [] : getEffectVars(rawExpr)
  const id = env.id ?? `a${++state.counter}`
  // `@attach` installe un teardown `_mjs_td` → destroy walker requis.
  state.hasDestroyHooks = true

  // `el`, second nom de la balise à côté de `_node` : l'expression qui le lit sans que rien ne le lie (ni paramètre ou déclaration de l'expression, ni `<script>` de
  // l'auteur, ni `@this=!{el}`) est écrite à la main comme avec `_node` (mode direct) et reçoit la balise sous ce nom ; le `el` de l'auteur garde la main, le mode ne change pas
  const litEl    = /\bel\b/.test(jsFunc) && freeIdentifiers(`(${jsFunc});`)?.has('el') === true && !state.refVars.has('el') && !scriptDeclareEl()
  const isDirect = litEl || /\b_node\b/.test(jsFunc)
  const mode     = isDirect ? 'direct' : 'factory'

  const evalBlock = mode === 'factory'
    ? `const _mjs_setup = ${jsFunc}; const _mjs_clean = (typeof _mjs_setup === 'function') ? _mjs_setup(_node) : null;`
    : `${litEl ? 'const el = _node; ' : ''}const _mjs_clean = ${jsFunc};`

  // `_mjs_att` : connexion du composant (`_mjs_ae`, avancé à chaque déconnexion) où la balise a reçu
  // son attache ; remis à zéro quand son nettoyage tourne (mjs_destroy_hooks.ts)
  // développement : une valeur rendue qui n'est ni une fonction ni rien (le nombre de `requestAnimationFrame`, un objet) est ignorée, mjs_debug.ts le dit
  const nonFonction = state.devWarnings ? ` else if (_mjs_clean != null) µ._mjs_attachNotFn?.(this, _node, _mjs_clean, ${env.node.line ?? 0});` : ''
  const attachLogic = `/* Purge précédente si params mutent */ if (_node._mjs_td) { _node._mjs_td(); if (this._mjs_attachments) this._mjs_attachments.delete(_node._mjs_td); _node._mjs_td = null; } /* Execution (mode ${mode}) */ ${evalBlock} _node._mjs_att = this._mjs_ae; if (typeof _mjs_clean === 'function') { _node._mjs_td = _mjs_clean; this._mjs_attachments = this._mjs_attachments || new Set(); this._mjs_attachments.add(_mjs_clean); }${nonFonction}`
  // rendu qui repasse sans rien changer pour l'attache : la balise déjà attachée ne se rejoue pas.
  // Exception, une lecture qu'aucun effet ne suit (paramètre de route `&x`, `µurl`…) : seul le
  // rendu complet de la navigation la rattrape, l'attache garde alors le rejeu à chaque rendu ; le code seul
  // compte, pas les chaînes (`mark('Q&A')` ou `mark('prix en µ')` ne lisent rien)
  const suivie = once || !/µ|&[\w$]/.test(maskNonCode(rawExpr, env.compiler.templateLang))
  const garde  = `_node._mjs_att !== this._mjs_ae`

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
    env.ctx.updates.push(suivie ? `{ const _node = this._mjs_nodes.${id}; if(_node && _node._mjs_att !== this._mjs_ae) { ${attachLogic} } }` : code)
    if (vars.length > 0) registerEffect(code, vars)
  } else if (env.ctx.type === 'for') {
    // dans une ligne, une attache SANS dépendance (ni `$x`, ni `µ`/`&x`, ni nom de la boucle ou d'un
    // `{const}`) est posée une fois par balise ; celle qui lit la ligne se rejoue quand la ligne repasse
    const libre = once || (suivie && vars.length === 0 && !litLaPortee(env, jsFunc))
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}${libre ? ` && _mjs_n${env.lid}._mjs_att !== this._mjs_ae` : ''}) { let _node = _mjs_n${env.lid}; ${attachLogic} } }`)
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
    const initCode = `{ const _node = __nodes['${id}']; if(_node${once ? ` && ${garde}` : ''}) { ${attachLogic} } }`
    // les variables que lit un `{const}` recréé par l'effet comptent aussi : `{const t = $theme}` puis `@attach={marque(t)}` suit `$theme` ; `.once` n'en suit aucune
    const varsEffet = once ? vars : [...new Set([...vars, ...varsDesConst(env, jsFunc)])]
    const affichee  = brancheCourante(env)
    // branche nommée (`{success v}`, `{error err}`) et forme réactive : l'effet seul pose l'attache, comme `@emit`. Le règlement de la
    // promesse invalide `_awaits_` : la branche est créée, puis TOUS les effets tournent, celui-ci compris, sur le nœud déjà en page ; la
    // pose faite à la création de la branche (nœud encore dans son fragment) serait aussitôt nettoyée par cet effet puis refaite, la
    // fabrique appelée deux fois et son nettoyage lancé pour rien. La branche d'attente et une branche sans nom de valeur gardent la pose
    // à la création : une promesse remplacée recrée l'attente sans rendu complet derrière. Dans un `{if}` ou un `{key}` de la branche, la
    // balise née d'un changement de choix n'a aucun rendu complet derrière elle non plus : l'effet de ce bloc (cf. suiviDeBloc) pose
    // l'attache de ce contenu neuf (`_mjs_basc`), à l'affichage de la branche c'est le rendu complet qui s'en charge
    const nommee = (env.ctx.portee ?? []).some((e) => e.kind === 'await')
    if (!(varsEffet.length > 0 && nommee)) env.ctx.updates.push(initCode)
    else if (env.ctx.enBloc) env.ctx.updates.push(`if (this._mjs_basc) ${initCode}`)
    if (varsEffet.length > 0) {
      // effet posé à la racine : valeur `{await}` et `{const}` de la branche recréés s'ils sont lus, et seulement quand cette
      // branche est celle qui est affichée (cf. brancheCourante), que la fabrique lise la valeur de la branche ou non : promesse
      // remplacée ou rejetée, la valeur lue vaut `null` et `marque(v.label, $theme)` ferait tomber le composant quand `$theme`
      // change ; `marque($theme)` rejouerait la fabrique sur un nœud retiré de la page, dont personne ne défera plus la pose
      const prelude      = squelettePortee(env, jsFunc, () => '', 'js')
      const reactiveCode = `{ const _node = this._mjs_nodes.${id}; if(_node${affichee ? ` && ${affichee}` : ''}) { ${prelude}${attachLogic} } }`
      registerEffect(reactiveCode, varsEffet)
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
    throw new Error(t('generator.emit-forme-non-reconnue', { attrName }))
  }
  if (!eventName) throw new Error(t('generator.emit-forme-non-reconnue', { attrName }))

  const rawExpr = env.attr.expr ?? env.attr.val
  if (!rawExpr) return { id: env.id }

  // Site EXPR (valeur d'attribut @emit.x={expr}) — même helper que dynamic().
  const jsVal = cleanJsExpr(rawExpr, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)

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
    const prelude   = squelettePortee(env, jsVal, () => '', 'js')
    const affichee  = brancheCourante(env)
    const varsEffet = isOnce ? vars : [...new Set([...vars, ...varsDesConst(env, jsVal)])]
    if (varsEffet.length > 0) {
      registerEffect(prelude || affichee ? `if (${affichee || 'true'}) { ${prelude}${code} }` : code, varsEffet)
      // le contenu neuf d'un `{if}` ou d'un `{key}` de la branche n'a aucun rendu complet derrière lui : l'effet du bloc (cf. suiviDeBloc) l'annonce (`_mjs_basc`)
      if (env.ctx.enBloc) env.ctx.updates.push(`if (this._mjs_basc) { ${code} }`)
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
export const MJS_BOOLEAN_PROPS = ['value', 'checked', 'disabled', 'open', 'readonly',
                                  'required', 'selected', 'hidden', 'multiple',
                                  'autofocus', 'muted', 'autoplay', 'loop', 'controls',
                                  'allowfullscreen', 'async', 'default', 'defer', 'formnovalidate',
                                  'inert', 'ismap', 'itemscope', 'nomodule', 'novalidate',
                                  'playsinline', 'reversed']

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
function flipBinding(env: AttrCtx, attrName: string, expr: string, id: string, secours?: string): void {
  const vars  = getEffectVars(expr)
  const jsVar = cleanJsExpr(expr, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
  const tmp   = `_mjsFlipVal_${id}`
  const val   = secours != null ? `(${tmp} == null || ${tmp} === false) ? ${secours} : ${tmp}` : tmp
  if (env.ctx.type === 'for') {
    env.ctx.updates.push(`{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { const ${tmp} = ${jsVar}; µ._mjs_updAttrNode(_mjs_n${env.lid}, '${attrName}', ${val}${attrSur(attrName)}); } }`)
    for (const v of vars) state.structVars.add(v)
  }
  else pushUpdate(env, `{ const ${tmp} = ${jsVar}; this._mjs_updAttr('${id}', '${attrName}', ${val}${attrSur(attrName)}); }`, vars)
}

// les anciennes animations qui n'ont pas d'effet du même nom : `@in=*zoom` est refusé, `@in=*elastic_fly` ne
// joue rien — le message donne l'effet qui les remplace
const REMOVED_ANIMATIONS = new Map([
  ['zoom',          '*scale(start: 0.55)'],
  ['zoomOut',       '*scale(start: 1.45)'],
  ['elastic_fly',   '*fly(up, easing: elastic-out)'],
  ['elastic_scale', '*scale(easing: elastic-out)']
])

// un réglage que l'effet a, pour l'exemple d'un message : sa durée si elle a une valeur par défaut, sinon son
// réglage principal avec la sienne (`*typewriter` n'a pas de durée par défaut : sa vitesse, `speed: 30`)
function exampleSetting(nom: string): string {
  const spec = effectSpec(nom)
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
  volet:         OLD_DIR,
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
type OldValue = { fixe: string | number | boolean } | { variable: string } | { calcul: string }

function oldValue(n: any, src: string): OldValue {
  const texte = src.slice(n.start, n.end).replace(/\s+/g, ' ')
  if (n.type === 'Literal' && ['number', 'string', 'boolean'].includes(typeof n.value)) return { fixe: n.value }
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return { fixe: n.operator === '-' ? -n.argument.value : n.argument.value }
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return { fixe: n.quasis[0].value.cooked }
  if (/^[$\p{L}_][$\p{L}\w]*(?:\.[$\p{L}_][$\p{L}\w]*)*$/u.test(texte)) return { variable: texte }
  return { calcul: texte }
}

const oldText = (v: OldValue | undefined): string => !v ? '0' : 'fixe' in v ? String(v.fixe) : 'variable' in v ? v.variable : v.calcul
// une durée d'avant, en ms → celle d'un effet : 2000 → 2s, 220 → 220ms
const oldTime = (ms: number): string => ms !== 0 && ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`
// une courbe d'avant (`'cubicOut'`, `µ.easing.quadInOut`, `'ease-in'`) → son nom dans un effet (cubic-out, quad-in-out, ease-in)
const oldCurve = (nom: string): string => /^cubic-bezier\(/.test(nom) ? nom : nom.split('.').pop()!.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
const round2   = (x: number): number => Math.round(x * 100) / 100

// une longueur d'avant (`22`, `'-50%'`) : son nombre et son unité ; absente, nulle ; null pour une variable, un calcul, un texte illisible
function oldLength(v: OldValue | undefined): { n: number, unit: string } | null {
  if (!v) return { n: 0, unit: '' }
  if (!('fixe' in v)) return null
  const m = /^(-?\d*\.?\d+)(px|%|em|rem|vw|vh)?$/.exec(String(v.fixe).trim())
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
  ligne?: number
  ecrite: string
  directive: string
  nom: string
  effet: string
  notes: string
  reglee: boolean
  remplacee: boolean
  modificateurs: boolean
}

/** une ancienne écriture (`@in.fly={ y: 22, duration: 220 }`) et l'effet qui la remplace, ses réglages écrits convertis
 * (`*fly(up, distance: 22, duration: 220ms)`) ; un réglage calculé devient une variable `$…` à poser dans le `<script>` — un
 * effet ne prend qu'une valeur fixe ou une variable écrite telle quelle, jamais `{…}` */
function rewriteOldTransition(attr: Attr, ligne?: number): OldTransition {
  const nom         = ANCIENNE_TRANSITION.exec(attr.name ?? '')![2]
  const directive   = transitionDirective(attr.name ?? '')
  const ecrit       = attr.type === 'boolean' ? '' : String(attr.expr ?? attr.val ?? '')
  const ecrite      = (attr.name ?? '') + (attr.type === 'dynamic' ? `={${ecrit.replace(/\s+/g, ' ')}}` : ecrit ? `="${ecrit}"` : '')
  const remplacante = REMOVED_ANIMATIONS.get(nom)
  // l'effet qui la remplace et ses réglages : `*scale(start: 0.55)` → scale, [start, 0.55] ; une valeur sans nom va au principal
  const [, effect, args] = /^\*(\w+)(?:\((.*)\))?$/.exec(remplacante ?? '*' + nom)!
  const spec     = effectSpec(effect)
  const reglages = (args ? args.split(', ') : []).map((a): [string, string] => a.includes(': ') ? a.split(': ') as [string, string] : [spec?.main ?? '', a])
  const notes: string[] = []
  const sans: string[]  = []
  // le corps de l'objet, comme le lisait l'écriture d'avant : `{ y: 200 }` et `{{ y: 200 }}` se valent
  let corps = ecrit.trim()
  if (corps.startsWith('{') && corps.endsWith('}')) corps = corps.slice(1, -1).trim()
  if (corps.endsWith(';')) corps = corps.slice(0, -1).trim()
  const poser = (key: string, value: string): void => {
    const i = reglages.findIndex(([k]) => k === key)
    if (i >= 0) reglages[i] = [key, value]
    else reglages.push([key, value])
  }
  const enVariable = (key: string, calcul: string): void => {
    poser(key, '$' + key)
    notes.push(t('transitions.ancienne-calcul', { reglage: key, calcul, variable: '$' + key }))
  }
  // l'objet entier se calcule (`{$reglages}`, une condition) : un effet se règle réglage par réglage
  let objet: any = null
  let entier      = false
  if (corps !== '') {
    try {
      entier = (acorn.parse(`(${corps})`, { ecmaVersion: 'latest' }) as any).body.length === 1
    }
    catch {
      entier = false
    }
    if (!entier) {
      try {
        const e = (acorn.parse(`({${corps}})`, { ecmaVersion: 'latest' }) as any).body
        if (e.length === 1 && e[0].expression?.type === 'ObjectExpression' && e[0].expression.properties.every((p: any) => p.type === 'Property' && !p.computed && p.kind === 'init')) objet = e[0].expression
      }
      catch {
        objet = null
      }
      entier = !objet
    }
  }
  if (entier) notes.push(t('transitions.ancienne-objet', { calcul: corps.replace(/\s+/g, ' '), exemple: `*${effect}(duration: $duration)` }))
  if (objet) {
    const src  = `({${corps}})`
    const lus  = new Map<string, OldValue>(objet.properties.map((p: any) => [p.key.type === 'Identifier' ? p.key.name : String(p.key.value), oldValue(p.value, src)]))
    const lit  = OLD_SETTINGS[nom]
    let flyVu  = false
    for (const [cle, val] of lus) {
      // un réglage que l'animation ne lisait pas, ou sans équivalent ; une transition de l'appli garde tous les siens
      if ((lit && !lit.includes(cle)) || cle === 'steps') {
        sans.push(cle)
        continue
      }
      // `x`, `y` (où la balise partait) → la direction où elle va et sa distance, à la place du premier des deux
      if (effect === 'fly' && (cle === 'x' || cle === 'y')) {
        if (flyVu) continue
        flyVu = true
        const x  = lus.get('x')
        const y  = lus.get('y')
        const lx = oldLength(x)
        const ly = oldLength(y)
        if (lx && ly && (lx.n === 0 || ly.n === 0 || lx.unit === ly.unit)) {
          const unit = lx.n !== 0 ? lx.unit : ly.unit
          if (lx.n !== 0 || ly.n !== 0) poser('direction', lx.n === 0 ? (ly.n > 0 ? 'up' : 'down') : ly.n === 0 ? (lx.n > 0 ? 'left' : 'right') : Math.abs(lx.n) === Math.abs(ly.n) ? `${ly.n > 0 ? 'up' : 'down'}-${lx.n > 0 ? 'left' : 'right'}` : String(round2((Math.atan2(-lx.n, ly.n) * 180 / Math.PI + 360) % 360)))
          poser('distance', round2(Math.hypot(lx.n, ly.n)) + unit)
          continue
        }
        // une seule des deux tenue par une variable ou un calcul, l'autre absente ou nulle : la direction de son axe, le signe suit
        const seul = lx?.n === 0 && y && !('fixe' in y) ? ['up', y] as const : ly?.n === 0 && x && !('fixe' in x) ? ['left', x] as const : null
        if (!seul) {
          notes.push(t('transitions.ancienne-xy', { x: oldText(x), y: oldText(y) }))
          continue
        }
        poser('direction', seul[0])
        if ('variable' in seul[1]) poser('distance', seul[1].variable)
        else enVariable('distance', oldText(seul[1]))
        continue
      }
      const key = cle === 'dir' ? 'direction' : cle
      // la vitesse de *draw se compte en px par seconde, celle d'avant en px par ms
      const parMs = nom === 'draw' && cle === 'speed'
      if ('calcul' in val) {
        enVariable(key, parMs ? `(${val.calcul}) * 1000` : val.calcul)
        continue
      }
      if ('variable' in val) {
        const courbe = key === 'easing' && !val.variable.startsWith('$') ? oldCurve(val.variable) : ''
        if (courbe && fitsSetting(effect, key, courbe)) poser(key, courbe)
        else if (parMs) enVariable(key, `${val.variable} * 1000`)
        else poser(key, val.variable)
        continue
      }
      const v      = val.fixe
      const nombre = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d*\.?\d+$/.test(v.trim()) ? Number(v) : null
      const valeur = key === 'duration' || key === 'delay' ? (nombre !== null ? oldTime(nombre) : String(v))
        : key === 'easing' ? oldCurve(String(v))
        : parMs && nombre !== null ? String(Math.max(1, Math.round(nombre * 1000)))
        : typeof v === 'string' && !/^[\w.%#-]+$/.test(v) ? `'${v.replace(/'/g, '\\\'')}'`
        : String(v)
      if (fitsSetting(effect, key, valeur)) poser(key, valeur)
      else sans.push(cle)
    }
  }
  if (sans.length > 0) notes.push(t('transitions.ancienne-sans', { reglages: sans.join(', '), nb: sans.length }))
  // le réglage principal, quand c'est un mot (une direction, un axe), s'écrit en tête sans son nom : *fly(up, distance: 200)
  const i      = reglages.findIndex(([k, v]) => k === spec?.main && /^[a-z]+(?:-[a-z]+)?$/.test(v))
  const ecrits = reglages.map(([k, v]) => `${k}: ${v}`)
  const ordre  = i < 0 ? ecrits : [reglages[i][1], ...ecrits.filter((_, j) => j !== i)]
  return {
    ligne,
    ecrite,
    directive,
    nom,
    effet:         '*' + effect + (ordre.length > 0 ? `(${ordre.join(', ')})` : ''),
    notes:         notes.join(''),
    reglee:        corps !== '',
    remplacee:     !!remplacante,
    modificateurs: directive !== (attr.name ?? '').split('.')[0]
  }
}

/** le message d'une ou de plusieurs anciennes écritures d'un composant : une seule, la phrase entière ; plusieurs, une ligne chacune */
function oldTransitionsMessage(cas: OldTransition[]): string {
  if (cas.length > 1) return t('transitions.anciennes', { nb: cas.length, lignes: cas.map((c) => t('transitions.ancienne-ligne', { ligne: c.ligne, ecrite: c.ecrite, ecriture: `${c.directive}=${c.effet}`, notes: c.notes + (c.remplacee ? t('transitions.ancienne-retiree', { nom: c.nom }) : '') })).join('') })
  const c = cas[0]
  if (c.remplacee) return t('transitions.retiree', { ecrite: c.ecrite, directive: c.directive, effet: c.effet, notes: c.notes })
  if (!c.reglee) return t('transitions.ancienne', { ecrite: c.ecrite, directive: c.directive, nom: c.nom, reglage: exampleSetting(c.nom), modificateurs: c.modificateurs })
  return t('transitions.ancienne-reglee', { ecrite: c.ecrite, ecriture: `${c.directive}=${c.effet}`, notes: c.notes, directive: c.directive, nom: c.nom, modificateurs: c.modificateurs })
}

/** l'ancienne écriture des transitions dans tout le gabarit d'un composant (`@in.fly={…}`, `@out.zoom`) : une seule erreur les
 * donne toutes, chacune avec sa ligne et sa nouvelle écriture — le build du projet les donne ainsi toutes en une construction */
export function refuseOldTransitions(root: Node): void {
  const cas: OldTransition[] = []
  const pile: Node[]         = [root]
  while (pile.length > 0) {
    const n = pile.pop()!
    // `@in.local=*fly` : l'écriture d'aujourd'hui avec un modificateur inconnu, que le répartiteur refuse à part
    for (const a of n.attrs) if (a.name && DIRECTIVES.ancienne(a.name, '') && !/^\*/.test(String(a.val ?? ''))) cas.push(rewriteOldTransition(a, n.line))
    const suite = [...n.children, ...n.branches.flatMap((b) => b.children)]
    for (let i = suite.length - 1; i >= 0; i--) pile.push(suite[i])
  }
  if (cas.length > 0) throw new Error(oldTransitionsMessage(cas))
}

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
      ? t('generator.hint-cast-suffixe-nom', { attrName, cast: castMatch[1] })
      : t('generator.hint-syntaxe-two-way', { attrName })
    throw new Error(t('generator.liaison-two-way-malformee', { attrName, rawVal, hint }))
  }

  // @group avec !{…}
  if (DIRECTIVES.groupe(attrName, rawVal)) {
    return bindingGroup(env)
  }

  // @html / @text avec !{…}
  if (DIRECTIVES.contenu(attrName, rawVal)) {
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
  if (DIRECTIVES.ceci(attrName, rawVal)) {
    return bindingThis(env)
  }
  // `@this={ref}`, sans `!` : refusé, il tombait dans le repli des événements (écoute d'un événement « this ») et la variable ne recevait
  // jamais le nœud
  if (attrName === '@this' && env.attr.type === 'dynamic') throw new Error(t('generator.this-sans-point-exclamation', { expr: String(env.attr.expr ?? '').trim() }))
  // `@this` écrit sans valeur ou avec un texte (`@this="ref"`), et `@preload` sans valeur (le préchargement d'un lien se règle par une valeur,
  // sans défaut) : refusés de même, ils tombaient aussi dans le repli des événements (écoute d'un événement « this » ou « preload »)
  const ecrit = (env.attr.val ?? '').toString()
  const nu    = env.attr.type !== 'dynamic' && (ecrit === '' || ecrit === 'true')
  if (attrName === '@this') throw new Error(t('generator.this-sans-reference', { ecrit: nu ? '@this' : `@this="${ecrit}"`, ref: !nu && /^[A-Za-z_$][\w$]*$/.test(ecrit) ? ecrit : 'ref' }))
  if (attrName === '@preload' && nu) throw new Error(t('generator.preload-sans-valeur', {}))

  // `data-*` / `aria-*` en `!{…}` sur un composant : attribut de la balise qui suit la variable (sens unique)
  if ((env.node.name ?? '').includes('-') && DOM_ATTR_COMPOSANT.test(attrName) && /^!\{(.+)\}$/.test(rawVal)) {
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
  if (DIRECTIVES.classe(attrName, rawVal)) return bindingClass(env)

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
  if (DIRECTIVES.attache(attrName, rawVal)) return bindingAttach(env)

  // @childtransition
  if (DIRECTIVES.enfants(attrName, rawVal)) {
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
  if (DIRECTIVES.lumiere(attrName, rawVal)) {
    return { attrStr: env.attrStr + ` mjs-light`, id: env.id }
  }

  // @transition=*x(…) / @in=*x / @out=*x, modificateurs .global/.shared, et @introstart / @introend /
  // @outrostart / @outroend ; l'ancienne écriture `@in.fly={…}` donne la nouvelle
  const vieille = ANCIENNE_TRANSITION.exec(attrName)
  if (vieille && DIRECTIVES.ancienne(attrName, rawVal)) {
    // `@in.local=*fly` : l'écriture d'aujourd'hui, avec un modificateur inconnu (habitude Svelte)
    if (/^\*/.test(String(env.attr.val ?? ''))) throw new Error(t('transitions.modificateur', { directive: '@' + vieille[1], mod: vieille[2] }))
    // le nom d'une ancienne animation tombe, les modificateurs écrits (`@in.fly.shared`) restent sur la directive proposée, les
    // réglages écrits passent dans l'effet ; le gabarit entier est relu avant (refuseOldTransitions), ceci vaut pour une balise hors de lui
    throw new Error(oldTransitionsMessage([rewriteOldTransition(env.attr, env.node.line)]))
  }
  if (DIRECTIVES.transition(attrName, rawVal)) {
    if (!/^\*/.test(String(env.attr.val ?? ''))) throw new Error(t('transitions.attend-effet', { directive: attrName.split('.')[0] }))
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
    if (DIRECTIVES.booleen(attrName, rawVal)) {
      env.attrName = attrPure
      if (env.attr.type === 'dynamic') return dynamic(env)
      return booleanAttr(env)
    }
    // repli — tout `@xxx` inconnu est un écouteur d'événement, un nom d'événement est libre,
    // le compilateur ne le compare à RIEN (casse comprise) ; les
    // directives des balises de section sont contrôlées dans transpiler/sections.ts et directives.ts
    return eventListener(env)
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
    const jsEval = parseMixedString(rawVal, env.compiler.externalVars, env.compiler.templateLang, env.compiler.moduleName)
    // nom que le gabarit déclare et que la mise à jour retrouve (cf. adjustedAttr) ; à la racine et dans une branche le gabarit ne déclare pas l'attribut, la mise
    // à jour le crée par `setAttribute`, sans espace de noms : un attribut que l'analyseur HTML pose dans un espace de noms (`xlink:href`) y est donc déclaré vide,
    // comme le fait une valeur entre accolades seules, et la mise à jour le retrouve par son nom qualifié
    const adj     = adjustedAttr(env, attrName)
    const nom     = adj.name
    const declare = adj.ns ? ` ${nom}=''` : ''
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
        `{ const _mjs_n${env.lid} = __nodes['${env.lid}']; if(_mjs_n${env.lid}) { ${ecrireAttr(`_mjs_n${env.lid}`, adj, jsEval)}; } }`
      )
      // le fix CRITIQUE rend l'attribut `$var` interpolé
      // VISIBLE au mount, mais sans `structVars` il reste NON réactif (var externe
      // mutée hors row → `_mjs_renderStruct` sauté). `vars` est déjà calculé plus haut.
      for (const v of vars) state.structVars.add(v)
      return { id: env.id, attrStr: env.attrStr + ` ${nom}=''` }
    }
    if (env.ctx.type !== 'root') {
      // contexte {await} (ni root ni for) : ce code s'exécute
      // DANS la createFn de la branche, AVANT que `_mjs_updIf` (mjs_element.ts) ne
      // fusionne les refs dans `this._mjs_nodes` — `this._mjs_nodes[id]` est encore vide
      // à cet instant précis. Même remède : viser les refs LOCALES
      // `__nodes` de la branche, déjà peuplées à ce point du corps généré.
      const id = env.id ?? `e${++state.counter}`
      env.ctx.updates.push(`{ const _mjs_node = __nodes['${id}']; if(_mjs_node) ${ecrireAttr('_mjs_node', adj, jsEval)}; }`)
      // la chaîne suit ses variables : effet de la racine, la pose ci-dessus la vaut à la construction de la branche
      suivreEnBranche(env, id, jsEval, `${ecrireAttr('_mjs_node', adj, jsEval)};`, vars)
      return { id, attrStr: env.attrStr + declare }
    }
    const id = env.id ?? `e${++state.counter}`
    const code = ecrireAttrRacine(ptr, id, adj, jsEval)
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
