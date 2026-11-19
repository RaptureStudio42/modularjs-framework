// compile — orchestrateur du compilateur HTML, port consolidé de :
//   compiler_html/{compile, walk, compile_tag, compile_if, compile_for,
//                  compile_await, compile_key, preprocessor}.rb
//
// V2 — dispatch direct sans bitmask :
//   - Les updates text/attr/binding sont émis SANS condition `if (dirty & ...)`
//     et enregistrés dans `state.effectsByVar` par varName via `registerEffect`.
//   - Les blocs structurels (`{if}`, `{for}`, `{await}`, `{key}`) restent
//     centralisés dans `ctx.updates` et seront placés par le transpiler dans
//     `_mjs_renderStruct` (exécuté à chaque mutation — coût marginal).

import * as acorn from 'acorn'
import * as acornWalk from 'acorn-walk'
import { shownName } from '../parser/mjs-words.js'
import { parse, stackOverflow, Node } from '../parser/index.js'
import type { LinkSeen, ProjectTagSeen, TagRef, Attr, MixedLine } from '../parser/index.js'
import { state, reset, getEffectVars, registerEffect } from './state.js'
import type { EventRoute } from './state.js'
import { cleanTemplateExpr, freeIdentifiers, decodeHtmlEntities, runesAwait, readsMuPending, setTemplateLocals } from './utils.js'
import { dispatchAttribute, detectFilteredPattern, isRawExpr, branchText, writeRawHtml, followedByBlock, keptValues, currentBranch, refuseOldTransitions, handlerCode, MJS_BOOLEAN_PROPS, SELECT_VALUE_DEFER_PREFIX, type AttrCtx } from './attributes/index.js'
import { generateCreateFnBody, SVG_NS, MATH_NS, lineMark, retainRootLines } from './paths.js'
import { expressionEnd, MU_T_OR_LANG_RE } from '../sigils.js'
import { t } from '../messages/index.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { patternNames } from '../analyzer/derived-reads.js'
import { noHashComment } from '../lexer/index.js'

const VOID_TAGS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                   'link', 'meta', 'param', 'source', 'track', 'wbr']

// balises dont le contenu est du texte brut pour le navigateur (aucune balise n'y est analysée)
const RAW_TEXT = new Set(['textarea', 'title', 'style', 'script'])

// noms exacts des directives, suivis au plus d'un modificateur (`@in.global`, `@style.color`,
// `@class{…}`) : `@input`, `@invalid`, `@transitionend`, `@outcome` restent des événements, dont
// la ligne de {for} doit être posée sur la balise
const SPECIAL_ATTR_NAMES = ['@transition', '@in', '@out', '@introstart', '@introend', '@outrostart', '@outroend',
                            '@attach', '@this', '@class', '@style', '@flip',
                            '@childtransition', '@html', '@text', '@group']

function isSpecialAttr(name: string | null | undefined): boolean {
  if (!name) return false
  return SPECIAL_ATTR_NAMES.some((p) => name === p || (name.startsWith(p) && /^[.{]/.test(name.slice(p.length))))
}

// Optim #5 — Helpers pour la closure des refs.
//
// `extractRefsForClosure(localUpdates)` :
//   - scanne `localUpdates` (string JS) pour trouver tous les `__nodes['xxx']`
//   - retourne la liste des `xxx` uniques + le code transformé où chaque
//     `__nodes['xxx']` est remplacé par `_nref_safe(xxx)`
//
// `safeRefVarName(id)` : convertit un id de ref (peut contenir `-`, `:`, etc.)
// en identifier JS valide pour variable locale.
function safeRefVarName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_$]/g, '_')
}

// `baseRefIds` : ids présents dans le template de BASE de l'item (créés
// inconditionnellement). Les refs ABSENTES de cette liste vivent dans un
// corps conditionnel (`{if}`/`{key}`/`{await}` imbriqué) créé à la volée par
// `_mjs_updItemIf` — leur `_nref_` serait capturé `undefined` en tête du tplFn.
// On les laisse donc en lookup live `__nodes['X']` (résolu APRÈS que
// `_mjs_updItemIf` les a mergées dans `__nodes`).
function extractRefsForClosure(code: string, baseRefIds?: string[]): { refIds: string[]; transformedBody: string } {
  const found = new Set<string>()
  const baseSet = baseRefIds ? new Set(baseRefIds) : null
  // Regex : capture les `__nodes['xxx']` où xxx ne contient ni `'` ni `${`
  // (i.e. seulement des refs littérales déjà résolues, pas d'interpolation).
  //
  // Cas {for} imbriqué : le `localUpdates` du for parent contient le `tplFn`
  // du for enfant, lequel a DÉJÀ une ligne `const _nref_X = __nodes['X'];`
  // (extraction faite lors de la compilation du for enfant). Si on re-transforme
  // ce `__nodes['X']`, on produit `const _nref_X = _nref_X;` (auto-référence
  // → ReferenceError "before initialization"). On masque donc d'abord ces
  // lignes d'extraction déjà générées avant le scan, puis on les restaure.
  const guarded: string[] = []
  const work = code.replace(
    /const\s+_nref_[a-zA-Z0-9_$]+\s*=\s*__nodes\['[^'\$\{]+'\];/g,
    (m) => {
      guarded.push(m)
      return `\x00NREF${guarded.length - 1}\x00`
    }
  )
  const re = /__nodes\['([^'\$\{]+)'\]/g
  let transformedBody = work.replace(re, (_m, id) => {
    // Ref conditionnelle (hors template de base) → garder le lookup live
    // `__nodes['X']`, ne PAS la pré-extraire en `_nref_X` (= undefined).
    if (baseSet && !baseSet.has(id)) {
      return _m
    }
    found.add(id)
    return `_nref_${safeRefVarName(id)}`
  })
  // Restaure les lignes d'extraction masquées (intactes).
  transformedBody = transformedBody.replace(
    /\x00NREF(\d+)\x00/g,
    (_m, i) => guarded[+i]
  )
  // Optim #5b — élimine les `const nXXX = _nref_XXX; if(nXXX) { ... }` redondants.
  // Vu que `_nref_XXX` est garantie non-null (extraite dans le tplFn juste après
  // la création du fragment), le test `if(nXXX)` n'est plus nécessaire.
  //
  // Pattern source : `const nLID = _nref_LID; if(nLID) { BODY }` (ou `if (nLID)`)
  // → on garde la déclaration `nLID = _nref_LID` mais on retire le `if(nLID)`.
  //
  // Important : la regex doit matcher les accolades imbriquées. On utilise un
  // matching plus tolérant : on cherche `if (?nVAR ?) {` puis on garde le `{`
  // ouvrant et on laisse le `}` final tel quel — le `if` disparaît seulement,
  // le bloc reste.
  transformedBody = transformedBody.replace(
    /(const\s+(_mjs_n[a-zA-Z0-9_$]+)\s*=\s*_nref_[a-zA-Z0-9_$]+;\s*)if\s*\(\s*\2\s*\)\s*\{/g,
    '$1{'
  )
  return { refIds: Array.from(found), transformedBody }
}

// Préfixe-sentinelle d'une déclaration `{const}`. Une entrée de `ctx.updates`
// qui commence par ce marqueur est une déclaration `const NOM = EXPR;` à
// émettre TELLE QUELLE (sans wrapper `{ … }`) et HISSÉE en tête du corps de
// rendu — afin que `NOM` soit visible des updates frères qui le consomment.
// Choix d'un préfixe en commentaire JS : inerte si jamais émis par erreur.
const CONST_DECL_PREFIX = '/*@mjs-const*/'

// liaison qui livre une prop à un composant enfant (`_set`, ou le registre `µ._mjs_pend` avant sa mise à niveau, cf.
// attributes/index.ts) : celles d'une branche de `{if}` ou d'un bloc `{key}` sont jouées avant que la branche n'entre dans la page
// (`_mjs_kb`, mjs_if.ts et mjs_key.ts) — l'enfant déjà chargé les trouve dès son `µawake`, comme une ligne de `{for}` peuplée avant
// son insertion
const CHILD_PROP = /\._mjs_pend\(/

// sépare les entrées `ctx.updates` d'une branche non-root
// ({if}/{await}/{key}) portant la sentinelle `SELECT_VALUE_DEFER_PREFIX`
// (`bindingStandard`, attributes/index.ts — two-way `<select value=!{...}>`)
// des entrées ordinaires. Les sentinelles reviennent SANS préfixe dans
// `deferred`, à fusionner par l'appelant APRÈS `postUpdates` (paths.ts) — même
// besoin de "courir après les <option> d'un {for} imbriqué", même
// mécanique de report, juste une source différente (paths.ts ne voit jamais
// ce code, émis à côté du HTML qu'il parse).
function splitDeferredUpdates(updates: string[]): { updates: string[]; deferred: string[] } {
  const kept: string[] = []
  const deferred: string[] = []
  for (const u of updates) {
    if (u.startsWith(SELECT_VALUE_DEFER_PREFIX)) deferred.push(u.slice(SELECT_VALUE_DEFER_PREFIX.length))
    else kept.push(u)
  }
  return { updates: kept, deferred }
}

interface Ctx {
  type: 'root' | 'for' | 'await' | string
  updates: string[]
  loops: LoopInfo[]
  /** Locaux de gabarit EN PORTÉE à ce point du walk : variable et index des `{for}`
   * englobants, argument de la branche `{await}` courante, noms des `{const}` déjà
   * rencontrés dans le bloc courant. Copié dans `state.inlineLocals` à l'émission de
   * chaque gestionnaire — c'est ce qui rend le retrait des noms de la liste prédéclarée
   * PAR GESTIONNAIRE (cf. CompilerState.templateLocals, l'union globale). */
  locals: Set<string>
  /** Les mêmes noms, DANS L'ORDRE où le gabarit les introduit (cf. EntryScope) : c'est ce
   * qu'un gestionnaire ou une liaison recrée en tête de son code. Copié là où `locals` l'est —
   * un `{const}` d'un bloc ne fuit jamais dans le bloc voisin. */
  scope: EntryScope[]
  /** namespace SVG/MathML ambiant, posé par
   * `compileTag` en entrant dans `<svg>`/`<math>`, hérité par tout le
   * sous-arbre, boucles comprises (relais nécessaire aux blocs : le contenu d'un `{for}`, d'un
   * `{if}`, d'un `{key}` ou d'une branche `{await}` est compilé en fragment SÉPARÉ, sans jamais
   * voir la balise `<svg>` englobante — cf. GenerateCreateFnBodyOpts.foreignNsRoot). */
  svgNs?: string | null
  /** dans un `<svg>`/`<math>` (hors `<foreignObject>`), boucles comprises : un effet `*nom`
   * n'y est pas permis */
  foreign?: boolean
  /** corps d'une branche `{if}` ou d'un `{key}` de racine : son type reste `root`, mais ses ancres
   * peuvent être recréées d'un rendu à l'autre (un `{for}` n'y est jamais gardé par ses variables) ;
   * dans une branche `{await}`, le corps d'un `{if}` ou d'un `{key}` de la branche : son type reste `await`,
   * et un changement de choix le refait sans rendu complet derrière lui (cf. followedByBlock) */
  inBlock?: boolean
  /** gabarit d'une ligne de `{for}` : ce que la ligne fabriquée par lui pose à sa naissance (gardes de classe à faux, cf. classToggle), joué
   * par le tplFn quand il fabrique la ligne, jamais sur une ligne écrite par le serveur. Partagé par les blocs de la ligne (copie du contexte),
   * que classToggle écarte (`enBloc`) */
  birth?: string[]
  /** dans une branche `{await}`, attente et branche sans nom comprises (ce que `portee` ne dit pas) : l'id du bloc, clé de son état dans `_mjs_awaitLastRender`, et l'état
   * qui dit que CETTE branche est celle qui est affichée (cf. currentBranch, attributes/index.ts) */
  branch?: { id: string; state: 'pending' | 'success' | 'error' }
  /** dans le contenu d'une balise de texte brut (`<textarea>`, `<title>` HTML, `<style>`, `<script>`) d'une branche `{await}` : le navigateur n'y analyse aucune balise, un
   * marqueur de nœud texte y serait écrit tel quel ; le texte y reste calculé une fois */
  rawText?: boolean
}

/** Nom que le gabarit met en portée, dans l'ordre du gabarit : un `{for}` (variable et index), un
 * `{const}` déjà rencontré (expression du gabarit `raw`, et sa forme JavaScript `js`), la valeur de
 * la branche `{success}`/`{error}` courante (relue dans l'état du bloc `{await}` `id`, que le
 * runtime garde : `_mjs_awaitStates`). Un gestionnaire ou une liaison n'est pas compilé dans la
 * fonction de rendu de son bloc : il recrée ces noms en tête de son code (cf. scopeSkeleton,
 * attributes/index.ts). `µpending` y est aussi une valeur de branche (`_mjs_pnd`, champ `pending`). `cle` : le nom que le runtime
 * invalide quand cette valeur change sous une branche affichée (relecture d'un `{await … keep}`) ; sans `cle`, elle ne change jamais
 * tant que la branche est affichée. */
export type EntryScope =
  | { kind: 'for'; loop: LoopInfo }
  | { kind: 'const'; name: string; raw: string; js: string }
  | { kind: 'await'; name: string; id: string; field: 'data' | 'error' | 'pending'; key?: string }

export interface LoopInfo {
  item: string
  index: string
  internalIndex: string
  iterable: string
  depth: number
  /** Nom de l'attribut-clé de la loop (`by X` → 'X'), ou null si non keyée.
   * Sert au cacheId STABLE des loops imbriquées (#1). */
  key: string | null
  /** Place de chaque balise `@flip` du gabarit de la ligne, quand il y a plusieurs places (cf. `placesFlip`) */
  flipPlaces?: Map<Node, number>
  /** Ligne pure d'un `{for}` de racine (cf. lineIsPure) : ses gestionnaires lisent l'élément et l'indice sur l'entrée de la ligne
   * (`_mjs_ev` de la balise → `_mjs_ent`, tenue à jour par la réconciliation), aucun indice n'est posé sur ses balises ; sur un
   * itérable lu dans le store, le gestionnaire qui lit l'élément le relit dans l'itérable à l'indice de l'entrée (écriture par le store) */
  byEntry?: boolean
  /** Index de la première liaison filtrée par valeur de la ligne, qui range sa clé et sa fonction en champs directs (cf. filterFields, attributes/index.ts) */
  filterFields?: string
}

// ============================================================================
// preprocess
// ============================================================================
// l'accolade fermante de l'expression `{…}` qui ouvre en `debut`, ou -1 : lecture commune (finExpression), qui sait les chaînes,
// les gabarits, les commentaires et les regex — un guillemet ou une accolade d'une regex (`{$s.replace(/"/g, '').length > 0}`)
// ouvrait une chaîne fantôme, et la balise se coupait au `>` de la comparaison
function braceEnd(html: string, start: number): number {
  const end = expressionEnd(html, start)
  return end < 0 ? -1 : end - 1
}

// le `>` qui ferme la balise ouverte avant `depuis`, en sautant les valeurs entre guillemets et les expressions `{…}` ; une accolade jamais
// refermée rend le premier `>` qui la suit, comme la lecture d'avant
function tagEnd(html: string, from: number): number {
  let i = from
  while (i < html.length) {
    const ch = html[i]
    if (ch === '"' || ch === "'") {
      const j = html.indexOf(ch, i + 1)
      if (j === -1) return -1
      i = j + 1
      continue
    }
    if (ch === '{') {
      const j = braceEnd(html, i)
      if (j === -1) return html.indexOf('>', i)
      i = j + 1
      continue
    }
    if (ch === '>') return i
    i++
  }
  return -1
}

/** Composants auto-fermés : `<mjs-x … />` → `<mjs-x …></mjs-x>`. La balise se termine au vrai `/>` : un `>` dans une valeur entre guillemets ou
 * dans une expression (`<mjs-x v={$n > 1} />`) ne la coupe plus — le composant était refusé pour un « déséquilibre structurel », et le message
 * proposait d'écrire exactement ce qui était écrit. Partagé par le transpileur (preprocessHtml) et le générateur (preprocess). */
export function closeSelfClosedComponents(html: string): string {
  const opener = /<(mjs-[a-zA-Z0-9_-]+)/g
  let output = ''
  let from = 0
  let m: RegExpExecArray | null
  while ((m = opener.exec(html)) !== null) {
    const start = m.index + m[0].length
    const end   = tagEnd(html, start)
    if (end === -1) continue
    const body = html.slice(start, end)
    if (!body.endsWith('/')) continue
    output += html.slice(from, m.index) + `<${m[1]}${body.slice(0, -1)}></${m[1]}>`
    from = end + 1
    opener.lastIndex = end + 1
  }
  return output + html.slice(from)
}

export function preprocess(htmlRaw: string): string {
  // 1. <@view name [css="..."] [data-mjs-vt="..."] [data-mjs-vt-p="..."]> → <metamjs-view id="name" css="..." data-mjs-vt="..." data-mjs-vt-p="..."></metamjs-view>
  //    Une vue fermée par `</@view>` (vide, ou avec un contenu d'attente que la page de la route remplace) : la balise ouvrante
  //    seule, et `</@view>` devient `</metamjs-view>` — cette fermeture restait sinon orpheline (refus hors de tout bloc, `{if}`
  //    jamais fermé dedans)
  let result = htmlRaw.replace(
    /<@view\s+([\w-]+)((?:\s+(?:css|data-mjs-vt|data-mjs-vt-p)=["'][^"']*["'])*)\s*\/?>/gi,
    (m: string, id: string, attrs: string, offset: number, all: string) => {
      const rest   = all.slice(offset + m.length)
      const closer = rest.search(/<\/@view\s*>/i)
      const next   = rest.search(/<@view\s/i)
      return closer >= 0 && (next < 0 || closer < next) && !m.endsWith('/>') ? `<metamjs-view id="${id}"${attrs}>` : `<metamjs-view id="${id}"${attrs}></metamjs-view>`
    }
  ).replace(/<\/@view\s*>/gi, '</metamjs-view>')

  // 2. {variable} → variable="{variable}" + Web Components auto-fermés
  //
  // la regex de raccourci
  // (`(?<=\s)\{name\}(?=\s|\/|$)`) ne se souciait pas de savoir si `{name}`
  // apparaît DANS une valeur d'attribut DÉJÀ quotée (ex.
  // `class="foo {isActive} bar"`, une interpolation espacée au milieu d'une
  // valeur littérale) — n'importe quel `{name}` entouré d'espaces, où qu'il
  // soit dans la chaîne d'attributs, matchait et se faisait développer EN
  // PLEIN MILIEU de la valeur quotée : guillemet refermé prématurément
  // (`class='foo isActive='`) suivi de texte orphelin hors de toute paire
  // attribut=valeur (` bar>`) — attribut détruit, ET l'interpolation
  // elle-même perdue (aucune liaison réactive émise pour `isActive`). Fix :
  // une SEULE regex avec les valeurs quotées ("..."/'...') comme ALTERNATIVES
  // PRIORITAIRES — à chaque position, le moteur regex matche et CONSOMME
  // D'ABORD une valeur quotée ENTIÈRE si elle commence ici (elle passe donc
  // inchangée, `name` reste `undefined` dans le callback), sautant purement
  // et simplement par-dessus tout `{name}` qu'elle contient ; seul un
  // `{name}` RÉELLEMENT hors de toute valeur quotée atteint l'alternative de
  // raccourci.
  // composants auto-fermés d'abord (closeSelfClosedComponents) : la regex des balises ci-dessous s'arrête au premier `>`, celui d'une expression compris
  result = closeSelfClosedComponents(result).replace(/<([a-zA-Z0-9_-]+)([^>]*)>/g, (_match, tagName, rawAttrs) => {
    const attrs = rawAttrs.replace(
      /"[^"]*"|'[^']*'|(?<=\s)\{(\$?)([a-zA-Z_][a-zA-Z0-9_]*)\}(?=\s|\/|$)/g,
      (m: string, dollar: string | undefined, name: string | undefined) =>
        name === undefined ? m : `${name}="{${dollar}${name}}"`
    )
    return `<${tagName}${attrs}>`
  })

  return result
}

// ============================================================================
// walk : dispatch sur le type de node
// ============================================================================
// les noms du gabarit en portée de ce nœud (ctx.locals), lus par le refus des minuteries de ses accolades
// (rejectTemplateTimer, utils.ts), reposés en sortant du nœud
export function walk(node: Node, ctx: Ctx): string {
  const before = setTemplateLocals(ctx.locals)
  try {
    return walkNode(node, ctx)
  }
  finally {
    setTemplateLocals(before)
  }
}

function walkNode(node: Node, ctx: Ctx): string {
  switch (node.type) {
    case 'root':
      return node.children.map((c) => walk(c, ctx)).join('')

    case 'text':
      // Pas de pré-escape ici : le texte va dans surgicalHtml qui passe
      // ensuite par escapeTpl (transpiler/index.ts) — qui escape `\\`, `\``
      // et `\${` correctement pour le template literal d'output.
      // la marque de ligne (cf. lineMark, paths.ts) est retirée avant toute lecture du gabarit
      return lineMark(node.line) + (node.content ?? '')

    case 'expr': {
      const isRaw = isRawExpr(node)
      // un commentaire `# …` de l'expression se retire avant sa lecture (noHashComment) : `{$t # note}` affiche `$t` ; de même
      // pour la condition d'un bloc, l'itérable d'un `{for}`, l'attente d'un `{await}` et une valeur d'attribut
      const cleanExpr = noHashComment((node.expr ?? '').toString()).trim()

      state.counter += 1
      const lid = `t${state.counter}`
      const vars = getEffectVars(cleanExpr)
      // Site EXPR (interpolation texte {…}).
      const jsVar = cleanTemplateExpr(cleanExpr, state.externalVars, state.moduleName)

      const updMethod = isRaw ? '_mjs_updHtml' : '_mjs_updText'

      if (ctx.type === 'await') {
        // texte qui lit une variable réactive (ou un `{const}` qui en lit une), ou texte traduit (`µ.t(`) ou langue lue (`µlang`), qui suit la langue : son nœud est repéré
        // (un marqueur, ou le conteneur de `{{…}}`), écrit à la construction de la branche puis tenu à jour par un effet de la racine, rejoué à chaque changement de ses
        // variables et à chaque rendu complet (bascule de langue, arrivée d'un dictionnaire), et seulement quand la branche est affichée (cf. branchText)
        const tracked = ctx.rawText ? null : branchText({ ctx, compiler: state }, lid, jsVar, vars, isRaw)
        if (tracked) {
          ctx.updates.push(tracked.sets)
          registerEffect(tracked.effect, tracked.vars)
          return isRaw ? `<span mjs-l-id='${lid}'></span>` : `<script type='mjs/marker' mjs-l-t='${lid}'></script>`
        }
        // `{{…}}` qui ne lit rien de réactif : un nœud texte afficherait les balises → conteneur posé par la branche, rempli
        // à sa construction, une fois : rien ne peut le changer. Un texte `{…}` qui ne lit rien de réactif est calculé une fois de même ;
        // `null` et `undefined` n'y écrivent rien, comme à la racine (`_mjs_updText`)
        if (isRaw) {
          ctx.updates.push(`{ const _mjs_n${lid} = __nodes['${lid}']; if(_mjs_n${lid}) ${writeRawHtml(`_mjs_n${lid}`, `String(${jsVar})`, state.moduleName)}; }`)
          return `<span mjs-l-id='${lid}'></span>`
        }
        return `\${(${jsVar}) ?? ''}`
      }

      if (ctx.loops.length > 0) {
        // une var
        // EXTÉRIEURE au `{for}` (ni l'item ni l'index de la loop — getEffectVars
        // ne renvoie que des VRAIS `$.xxx`, jamais des noms de boucle nus)
        // interpolée en TEXTE dans le corps d'un `{for}` ne déclenchait JAMAIS
        // de re-render sur sa mutation : `vars` (calculé plus haut) n'était
        // utilisé NULLE PART ici — ni `registerEffect` (le code vit dans la
        // closure `updateFn` DU FOR, inaccessible depuis un effect top-level :
        // `__nodes`/`n${lid}` n'existent que dans CE scope précis, un appel
        // depuis `_mjs_effectsAll` lancerait un `ReferenceError`), ni
        // `state.structVars` (qui pilote `_mjs_renderStructVars` — le SEUL
        // déclencheur qui fait re-tourner `_mjs_renderStruct` → `_mjs_updFor` →
        // réapplique cette interpolation). Seule l'ITÉRABLE du `{for}` lui-même
        // (`compileFor`, cf. plus bas) y était ajoutée : `{for item in $items}
        // <p>{item}:{$sharedWidth}</p>{end}` — `$sharedWidth` MUTÉ depuis un
        // bouton hors-loop restait inerte À VIE dans le texte de la row (vérifié
        // empiriquement : `_state.sharedWidth` change bien, le texte jamais).
        // Fix : même traitement que le two-way binding en `{for}`
        // (`bindingStandard`, attributes/index.ts, commentaire "#5") — chaque
        // dep externe rejoint `structVars`. Sans effet pour `{item}`/`{index}`
        // (vars vide, rien à ajouter) — aucune régression sur le chemin normal.
        for (const v of vars) state.structVars.add(v)
        if (isRaw) {
          // Factorise `String(${jsVar})` en variable locale (1 call au lieu de 2).
          ctx.updates.push(`{ const _mjs_n${lid} = __nodes['${lid}']; if(_mjs_n${lid}) { const _mjs_ts = String(${jsVar}); if (_mjs_n${lid}._mjs_h !== _mjs_ts) { ${writeRawHtml(`_mjs_n${lid}`, '_mjs_ts', state.moduleName)}; _mjs_n${lid}._mjs_h = _mjs_ts; } } }`)
          return `<span mjs-l-id='${lid}'></span>`
        }
        // text loop : assigne via node.data direct (équivalent nodeValue,
        // V8 spécialise mieux Text.data) + skip String() si déjà string.
        ctx.updates.push(`{ const _mjs_n${lid} = __nodes['${lid}']; if(_mjs_n${lid}) { const _mjs_tv = ${jsVar}; const _mjs_ts = typeof _mjs_tv === 'string' ? _mjs_tv : (_mjs_tv == null ? '' : String(_mjs_tv)); if (_mjs_n${lid}.data !== _mjs_ts) _mjs_n${lid}.data = _mjs_ts; } }`)
        return `<script type='mjs/marker' mjs-l-t='${lid}'></script>`
      }

      // V2 — Update sans condition, enregistré dans effectsByVar par chaque var.
      const code = `this.${updMethod}('${lid}', ${jsVar});`
      registerEffect(code, vars)
      ctx.updates.push(code)
      return isRaw
        ? `<span mjs-id='${lid}'></span>`
        : `<script type='mjs/marker' mjs-t='${lid}'></script>`
    }

    case 'tag':   return lineMark(node.line) + compileTag(node, ctx)
    case 'if':    return compileIf(node, ctx)
    case 'for':   return compileFor(node, ctx)
    case 'await': return compileAwait(node, ctx)
    case 'key':   return compileKey(node, ctx)
    case 'const': return compileConst(node, ctx)

    default:
      return ''
  }
}

// ============================================================================
// compileTag — port partiel. Le dispatch d'attributs (event_listener,
// binding_*, etc.) est en stub et reste à porter.
// ============================================================================
export function compileTag(node: Node, ctx: Ctx): string {
  if (node.name === '@slot') state.hasDynamicSlots = true

  let id: string | null = null
  let lid: string | null = null
  let attrStr = ''

  if (ctx.loops.length > 0) {
    state.counter += 1
    lid = `l${state.counter}`
  }

  const selfStart = ctx.updates.length

  const hasEvent = node.attrs.some((a) => {
    const n = a.name
    if (n && n.startsWith('@')) {
      const isSpecial = isSpecialAttr(n)
      const isBoolean = MJS_BOOLEAN_PROPS.includes(n.slice(1))
      return !isSpecial && !isBoolean
    }
    return false
  })

  if (hasEvent && ctx.loops.length > 0) {
    const currentDepth = ctx.loops[ctx.loops.length - 1].depth
    for (const l of ctx.loops) {
      // ligne lue sur son entrée (cf. LoopInfo.byEntry) : aucun indice à poser
      if (l.byEntry) continue
      const idxVar = l.depth === currentDepth ? l.index : l.internalIndex
      // Ne PAS poser l'attribut data-mjs-idx-X dans le HTML du template.
      // L'updateFn (appelée immédiatement après create + à chaque mutation)
      // le pose via setAttribute. Cela rend le HTML statique → permet
      // cloneNode au lieu de createElement × N.
      //
      // Avant : `<a data-mjs-idx-0='${index}'>` → interpolation runtime
      //   → empêche cloneNode → tombe en mode imperative.
      // Après : `<a>` + setAttribute via updateFn → HTML statique
      //   → cloneNode possible si pas d'AUTRES interpolations dans le sous-arbre.
      if (lid) {
        // Optim #8 — Pose la valeur en propriété JS directe (`_mjs_idx_N`)
        // pour permettre aux event handlers d'éviter `getAttribute` (slower).
        // Plus de setAttribute miroir : les reconstructs lisent la prop
        // en priorité (posée ici par la MÊME updateFn), l'attribut n'était
        // jamais relu. Économise 1 setAttribute × rows × loops au create et
        // à chaque réordonnancement.
        const idxUpd = `{ const _mjs_nIdx = __nodes['${lid}']; if(_mjs_nIdx && _mjs_nIdx._mjs_idx_${l.depth} !== ${idxVar}) { _mjs_nIdx._mjs_idx_${l.depth} = ${idxVar}; } }`
        if (!ctx.updates.includes(idxUpd)) ctx.updates.push(idxUpd)
        // boucle extérieure : son élément aussi (`_mjs_it_N`), que le gestionnaire préfère à celui de même rang dans la collection
        // quand la ligne extérieure part ou bouge pendant ce rendu (cf. outerInline, attributes/index.ts) ; seulement un nom
        // simple qu'aucun nom posé après la boucle ne cache (boucle intérieure, `{const}`, valeur `{await}`) : sinon la mise à jour
        // poserait la valeur cachante, que le gestionnaire prendrait pour l'élément de la boucle
        const scope = ctx.scope ?? ctx.loops.map((loop) => ({ kind: 'for' as const, loop }))
        const cache = scope.slice(scope.findIndex((e) => e.kind === 'for' && e.loop === l) + 1).some((e) => e.kind === 'for' ? e.loop.item === l.item || e.loop.index === l.item : e.name === l.item)
        // ligne la plus intérieure aussi quand la balise est dans un bloc de la ligne (`{if}`…) : la table de la balise est celle du bloc,
        // sans l'entrée de la ligne (`_mjs_ent`)
        if ((l.depth !== currentDepth || ctx.inBlock) && /^[A-Za-z_$][\w$]*$/.test(l.item) && !cache) {
          const itUpd = `{ const _mjs_nIt = __nodes['${lid}']; if(_mjs_nIt && _mjs_nIt._mjs_it_${l.depth} !== ${l.item}) { _mjs_nIt._mjs_it_${l.depth} = ${l.item}; } }`
          if (!ctx.updates.includes(itUpd)) ctx.updates.push(itUpd)
        }
      }
    }
  }

  // Dispatch attributs via attributes/index.ts
  for (const attr of node.attrs) {
    let rawVal = (attr.val ?? '').toString()
    const attrName = attr.name

    // @open booléen vide vs @click event vide
    if (attrName?.startsWith('@') && (rawVal === '' || rawVal === 'true')) {
      const isSpecial = isSpecialAttr(attrName)
      const isBoolean = MJS_BOOLEAN_PROPS.includes(attrName.slice(1))
      if (!isSpecial && !isBoolean) rawVal = '->'
      else if (isBoolean && rawVal === '') rawVal = 'true'
    }

    const env: AttrCtx = {
      compiler: state, node, attr, attrName, rawVal, ctx, id, lid, attrStr,
    }

    try {
      const result = dispatchAttribute(env)
      if (result.id !== undefined) id = result.id
      if (result.attrStr !== undefined) attrStr = result.attrStr
    } catch (err: any) {
      // Certains bindings stub. On ignore silencieusement
      // pour ne pas planter le compile sur des attrs non encore portés.
      if (!err.message?.includes('not yet implemented')) throw err
      // Fallback : émet l'attr en static littéral pour ne rien casser visuellement.
      // échappe l'apostrophe (`&#39;`, décodée au parse HTML) : `title="l'x"`
      // aurait sinon fermé le quote et généré des attributs parasites (chemin clone).
      if (attrName && !attrName.startsWith('@')) {
        attrStr += ` ${attrName}='${rawVal.replace(/'/g, '&#39;')}'`
      }
    }
  }

  // `<textarea>`/`<title>` HTML hors d'une branche `{await}` (cf. Ctx.rawText) : le navigateur n'analyse aucune balise dans leur
  // contenu, un marqueur de nœud texte y serait écrit tel quel. Un contenu de texte et d'interpolations se lie au texte de l'élément,
  // posé au premier rendu puis réécrit quand une variable lue change ; `null` et `undefined` n'y écrivent rien, comme `_mjs_updText`
  const lowerName = (node.name ?? '').toLowerCase()
  const boundText = ctx.type !== 'await' && (lowerName === 'textarea' || (lowerName === 'title' && !ctx.svgNs)) &&
    node.children.some((c) => c.type === 'expr') && node.children.every((c) => c.type === 'text' || c.type === 'expr')
  if (boundText) {
    const vars: string[] = []
    const pieces: string[] = []
    node.children.forEach((c, i) => {
      if (c.type === 'text') {
        // le saut de ligne qui suit `<textarea>` n'appartient pas à sa valeur (règle du navigateur)
        const raw = i === 0 && lowerName === 'textarea' ? (c.content ?? '').replace(/^\r?\n/, '') : (c.content ?? '')
        if (raw) pieces.push(JSON.stringify(decodeHtmlEntities(raw, true)))
        return
      }
      const expr = (c.expr ?? '').toString().trim()
      vars.push(...getEffectVars(expr))
      pieces.push(`((${cleanTemplateExpr(expr, state.externalVars, state.moduleName)}) ?? '')`)
    })
    const sets = (node: string) => `{ const _mjs_e = ${node}; if (_mjs_e) { const _mjs_s = '' + ${pieces.join(' + ')}; if (_mjs_e.textContent !== _mjs_s) _mjs_e.textContent = _mjs_s; } }`
    if (ctx.loops.length > 0) {
      for (const v of vars) state.structVars.add(v)
      ctx.updates.push(sets(`__nodes['${lid}']`))
    }
    else {
      id ??= `t${++state.counter}`
      const code = sets(`this._mjs_nodes['${id}']`)
      registerEffect(code, [...new Set(vars)])
      ctx.updates.push(code)
    }
  }

  if (id) attrStr += ` mjs-id='${id}'`
  if (lid) attrStr += ` mjs-l-id='${lid}'`

  // entrer dans <svg>/<math> pose le namespace
  // ambiant, hérité par tout le sous-arbre (cf. Ctx.svgNs) ; ailleurs, le
  // namespace ambiant du PARENT se transmet tel quel (une fois DANS un <svg>,
  // tout le sous-arbre y reste — sauf sous <foreignObject>, qui rouvre du HTML : svgNs remis à null).
  const tagNameLower = (node.name ?? '').toLowerCase()
  const childCtx = tagNameLower === 'svg' ? { ...ctx, svgNs: SVG_NS, foreign: true }
    : tagNameLower === 'math' ? { ...ctx, svgNs: MATH_NS, foreign: true }
    : tagNameLower === 'foreignobject' ? { ...ctx, svgNs: null, foreign: false }
    : ctx
  // balise de texte brut d'une branche `{await}` : le texte qu'elle contient reste calculé une fois (cf. Ctx.rawText) ; le <title> d'un <svg> est une balise ordinaire
  const childrenCtx = ctx.type === 'await' && RAW_TEXT.has(tagNameLower) && !(tagNameLower === 'title' && childCtx.svgNs) ? { ...childCtx, rawText: true } : childCtx

  const selfEnd = ctx.updates.length
  const inner = boundText ? '' : node.children.map((c) => walk(c, childrenCtx)).join('')

  if (selfEnd > selfStart) {
    const selfSlice = ctx.updates.splice(selfStart, selfEnd - selfStart)
    ctx.updates.push(...selfSlice)
  }

  if (VOID_TAGS.includes((node.name ?? '').toLowerCase())) {
    return `<${node.name}${attrStr}>`
  }
  return `<${node.name}${attrStr}>${inner}</${node.name}>`
}

// ============================================================================
// compileIf — émis SANS condition, classé "struct" → exécuté à chaque tick
// par `_mjs_renderStruct`. La var de la condition est consommée par l'expr `c`
// mais inutile de l'enregistrer ailleurs : `_mjs_renderStruct` est always-run.
// ============================================================================
export function compileIf(node: Node, ctx: Ctx): string {
  state.counter += 1
  const id = `if${state.counter}`

  // Collecter les vars qui pilotent les conditions du `{if}`.
  const condVars: string[] = []
  for (const branch of node.branches) {
    if (branch.expr) {
      for (const v of getEffectVars(branch.expr)) {
        state.structVars.add(v)
        condVars.push(v)
      }
    }
  }

  if (ctx.type !== 'root') {
    // Parenthèses obligatoires : une condition elle-même ternaire
    // (`{if $mode ? 1 : 0}`) se regrouperait sinon avec la chaîne générée
    // (`a ? b : c ? 0 : -1`) → branche inversée.
    // Site EXPR (condition {if}/{elsif}).
    const evalParts = node.branches.map((b, i) =>
      b.expr ? `(${cleanTemplateExpr(b.expr, state.externalVars, state.moduleName)}) ? ${i} : ` : `${i}`
    )
    let evalLogic = evalParts.join('')
    const last = node.branches[node.branches.length - 1]
    if (last.expr != null) evalLogic += '-1'

    const allBranchUpdates: string[][] = []
    // `postUpdates` (générées par `generateCreateFnBody`, ex.
    // `value` d'un `<select>` dont les `<option>` viennent d'un `{for}`
    // imbriqué) DOIVENT s'exécuter APRÈS `branchUpdates` : posées trop tôt (avant
    // que le `{for}` ne peuple les options réelles), la valeur retombe sur la
    // 1re option. `__nodes` est déjà en scope ici (mergé par `_mjs_updItemIf`).
    const allPostUpdates: string[][] = []
    const htmlLogicParts: string[] = []
    // dans une branche `{await}` les liaisons du contenu ont un effet de racine (cf. attributes/index.ts) : tant que ce `{if}` n'a pas choisi la branche `i`, ses nœuds
    // (laissés dans `this._mjs_nodes` par un choix précédent) ne reçoivent rien : ils ne sont plus à l'écran
    const inBranch = ctx.type === 'await'
    // Chaque branche a sa propre createFn(item, index) → {fragment, refs}.
    // Le runtime appelle la createFn de la branche choisie et merge refs dans __nodes.
    for (let i = 0; i < node.branches.length; i++) {
      const branch = node.branches[i]
      const preSize = ctx.updates.length
      // un `{const}` de CETTE branche ne vit que dans son corps : ensemble isolé par
      // branche, sur l'axe `ctx.locals` hérité (cf. Ctx.locals)
      const branchCtx: Ctx = { ...ctx, inBlock: true, locals: new Set(ctx.locals), scope: [...ctx.scope] }
      if (inBranch) state.effectGuardStack.push(`this._mjs_nodes['s-${id}']?._mjs_old_branch === ${i}`)
      let innerHtmlRaw: string
      try {
        innerHtmlRaw = branch.children.map((c) => walk(c, branchCtx)).join('')
      } finally {
        if (inBranch) state.effectGuardStack.pop()
      }
      const branchUpdatesRaw = ctx.updates.splice(preSize, ctx.updates.length - preSize)
      // cf. commentaire jumeau plus haut (`splitDeferredUpdates`) :
      // un two-way `<select value=!{...}>` de CETTE branche doit attendre les
      // <option> d'un {for} imbriqué, comme `postUpdates` (paths.ts) juste en dessous.
      const { updates: branchUpdates, deferred } = splitDeferredUpdates(branchUpdatesRaw)
      allBranchUpdates.push(branchUpdates)

      // `compactPaths` — accès aux nœuds écrits `µ._p(_f,2,0)`, marqueurs `µ._tm(…)` : des octets
      // en moins dans le code livré, au prix d'un appel de fonction à la construction. Vrai tant
      // qu'on n'est PAS dans une boucle : sous un `{for}`, cette createFn est construite une fois
      // par LIGNE et garde ses chaînes de propriétés directes. Même critère aux autres blocs.
      // `foreignNsRoot` : une branche posée dans un <svg>/<math> y naît (cf. Ctx.svgNs)
      const createBody = generateCreateFnBody(innerHtmlRaw, { splitSelectPostUpdates: true, compactPaths: ctx.loops.length === 0, foreignNsRoot: ctx.svgNs ?? null })
      allPostUpdates.push([...(createBody.postUpdates ?? []), ...deferred])
      // les `{const}` de la branche sont aussi déclarés en tête de sa fonction de création : un élément construit un par un y pose
      // déjà ses valeurs (attribut, texte), qui les lisent
      const decls = branchUpdates.filter((u) => u.startsWith(CONST_DECL_PREFIX)).map((u) => u + ' ').join('')
      // branche d'un `{if}` de ligne qui livre des props à un composant (`µ._mjs_pend(`) : refaite dans une ligne déjà dans la page, elle y
      // entre d'un bloc et ses composants se connecteraient avant que ses mises à jour (`branchExec`, plus bas) ne leur posent leurs props et
      // leur liaison à deux sens ; marqués avant l'insertion (`µ._mjs_waitRow`, mjs_for.ts), ils attendent pour se réveiller la fin de la
      // réconciliation ; ligne encore hors du document (pose initiale fusionnée) : rien à attendre ; branche sans composant : code inchangé.
      // Appel facultatif (`?.`) : un composant compilé hors de la construction, branché sur un cœur qui n'a pas ce bloc, se connecte alors
      // à l'insertion, comme sans lui, au lieu de lever une exception
      const pends = ctx.loops.length > 0 && branchUpdatesRaw.some((u) => u.includes('µ._mjs_pend('))
      const body   = pends ? `const _mjs_b = (() => { ${decls}${createBody.body} })(); if (_mjs_ifStart.isConnected) µ._mjs_waitRow?.(_mjs_b.refs); return _mjs_b;` : decls + createBody.body
      // La fonction prend les vars de boucle parent (item, index, etc.) en closure.
      // On émet directement le body inline pour bénéficier de l'inlining V8.
      htmlLogicParts.push(`if (_c_${id} === ${i}) { _mjs_cfn = () => { ${body} }; }`)
    }
    const htmlLogic = htmlLogicParts.join(' else ')

    const branchExecParts: string[] = []
    for (let i = 0; i < allBranchUpdates.length; i++) {
      const branchUpdates = allBranchUpdates[i]
      const postUpdates = allPostUpdates[i]
      if (branchUpdates.length === 0 && postUpdates.length === 0) continue
      // les `{const}` de la branche sont déclarés en tête de son bloc, sans bloc propre : chaque mise à jour a le sien, et une
      // déclaration enfermée dans le sien (`{ const d = … }`) n'était plus en portée pour les mises à jour qui la lisent
      const decls   = branchUpdates.filter((u) => u.startsWith(CONST_DECL_PREFIX)).map((u) => u + ' ').join('')
      const wrapped = decls + branchUpdates.filter((u) => !u.startsWith(CONST_DECL_PREFIX)).map((u) => `{ ${u} }`).join(' ') + (postUpdates.length > 0 ? ' ' + postUpdates.map((u) => `{ ${u} }`).join(' ') : '')
      branchExecParts.push(`if (_c_${id} === ${i}) { ${wrapped} }`)
    }
    const branchExec = branchExecParts.join(' else ')
    const branchExecBlock = branchExec === '' ? '' : `if (_c_${id} >= 0) { ${branchExec} }`

    // `_c_${id}` (pas `c`) : ce code s'exécute dans le scope des vars de boucle
    // — un item nommé `c` provoquait `const c = c.open ? …` → TDZ au runtime.
    //
    // Même précaution pour `_mjs_ifStart`/`_mjs_ifEnd`/`_mjs_cfn` (avant :
    // `startNode`/`endNode`/`cfn` nus) : un item de boucle nommé `startNode`
    // (mot anglais plausible pour un item DOM/arbre) faisait lire `startNode`
    // dans `evalLogic` (ex. `{if startNode.active}`) — embarqué dans CE MÊME
    // scope — au lieu de désigner l'item utilisateur, la lecture retombait
    // silencieusement sur l'ancre interne (corruption sans erreur). Régression
    // verrouillée par tests/reserved-names-collision.test.ts.
    // l'ancre de départ naît sans choix (`_mjs_old_branch`) : le premier choix construit toujours
    const ifUpdate = `{ const _mjs_ifStart = __nodes['s-${id}']; const _mjs_ifEnd = __nodes['e-${id}']; if (_mjs_ifStart && _mjs_ifEnd) { const _c_${id} = ${evalLogic}; if (_c_${id} !== _mjs_ifStart._mjs_old_branch) { let _mjs_cfn = null; ${htmlLogic} this._mjs_updItemIf(_mjs_ifStart, _mjs_ifEnd, _mjs_cfn, __nodes); _mjs_ifStart._mjs_old_branch = _c_${id}; } ${branchExecBlock} } }`
    ctx.updates.push(ifUpdate)
    // dans une branche `{await}`, le choix suit aussi ses variables : un effet de la racine rejoue la condition et refait le contenu entre les ancres quand elle change, avec la
    // valeur de la branche et les `{const}` recréés (cf. followedByBlock), seulement branche affichée ; les nœuds refaits rejoignent ceux du composant (`__nodes` est `this._mjs_nodes`),
    // et `_mjs_flip` dit aux mises à jour du contenu neuf (attache, événement) qu'aucun rendu complet ne vient derrière. La mise à jour posée plus haut reste celle de la construction de la branche
    const tracked = inBranch ? followedByBlock({ ctx, compiler: state }, evalLogic, `${evalLogic} ${htmlLogic} ${branchExec}`, condVars) : null
    if (tracked) {
      registerEffect(`{ const __nodes = this._mjs_nodes; const _mjs_ifStart = __nodes['s-${id}']; const _mjs_ifEnd = __nodes['e-${id}']; if (_mjs_ifStart && _mjs_ifEnd && ${tracked.guard}) { ${tracked.prelude}const _c_${id} = ${evalLogic}; if (_c_${id} !== _mjs_ifStart._mjs_old_branch) { let _mjs_cfn = null; ${htmlLogic} this._mjs_flip = ~~this._mjs_flip + 1; try { this._mjs_updItemIf(_mjs_ifStart, _mjs_ifEnd, _mjs_cfn, __nodes); _mjs_ifStart._mjs_old_branch = _c_${id}; ${branchExecBlock} } finally { this._mjs_flip--; } } } }`, tracked.vars)
    }
    return `<script type='mjs/marker' mjs-l-t='s-${id}'></script><script type='mjs/marker' mjs-l-t='e-${id}'></script>`
  }

  // Site EXPR (condition {if}/{elsif}, racine).
  const evalParts = node.branches.map((b, i) =>
    b.expr ? `(${cleanTemplateExpr(b.expr, state.externalVars, state.moduleName)}) ? ${i} : ` : `${i}`
  )
  let evalLogic = evalParts.join('')
  const last = node.branches[node.branches.length - 1]
  if (last.expr != null) evalLogic += '-1'

  const preSize = ctx.updates.length

  // Pour chaque branche, on capture (splice) les updates d'interpolation/binding
  // générées par le walk de SON contenu. Ces updates (`_mjs_updText`/`_mjs_updAttr`…)
  // restent enregistrées dans `effectsByVar` (réactivité ultérieure : un clic
  // qui mute la var re-fire l'update, car `_mjs_updIf` aura mergé les refs de la
  // branche dans `this._mjs_nodes`).
  //
  // L'état INITIAL doit aussi être appliqué dès que `_mjs_updIf` vient de créer la
  // branche (mount, ou re-création après un changement de branche) — sans quoi
  // les `_mjs_updText('tN', …)` ne trouvent pas leur node et ne font rien. On
  // inline donc ces updates dans le `ifUpdate` (classé "struct" → exécuté par
  // `_mjs_renderStruct`), juste APRÈS `_mjs_updIf` : à ce moment les refs de la
  // branche active ont été mergées dans `this._mjs_nodes`. Même mécanique que le
  // cas `{if}` imbriqué dans `{for}` (`branchExecBlock`) et que `compileAwait`.
  //
  // BUG : ce même contenu de branche est
  // AUSSI walk()é normalement ci-dessous, ce qui déclenche `registerEffect`
  // (interpolations texte, bindings d'attribut…) : la copie qui en résulte
  // finissait NUE dans `_mjs_effectsAll` (mount) et `_mjs_effectsByVar` (dispatch
  // ciblé sur mutation), sans la garde `_c_${id} === i` que porte
  // `branchExecBlock` plus bas — `{if x?.y} … {x.y.z} … {end}` évaluait
  // `x.y.z` au montage même quand `x?.y` est faux, malgré le `?.` de la
  // condition. Fix : `effectGuardStack` (state.ts) fait porter la MÊME garde
  // de branche aux deux copies — `registerEffect` les enveloppe désormais
  // toutes deux d'un `if (this._mjs_old?.${id} === i) { … }` tant qu'on walk cette
  // branche. `this._mjs_old.${id}` est déjà à jour à l'exécution de ces copies :
  // `_mjs_renderStruct` tourne TOUJOURS avant les effects (mount et update, cf.
  // invalidate-struct-before-effects.test.ts).
  const allBranchUpdates: string[][] = []
  // cf. commentaire jumeau dans la branche non-root ci-dessus :
  // `postUpdates` doivent s'exécuter APRÈS `branchUpdates`, jamais dans le corps
  // de la createFn (trop tôt pour un `{for}` imbriqué qui peuple des <option>).
  const allPostUpdates: string[][] = []
  const htmlParts = node.branches.map((b, i) => {
    const branchPre = ctx.updates.length
    state.effectGuardStack.push(`this._mjs_old?.${id} === ${i}`)
    let innerHtmlRaw: string
    try {
      // idem branche non-root : ensemble de locaux isolé par branche (cf. Ctx.locals)
      const branchCtx: Ctx = { ...ctx, inBlock: true, locals: new Set(ctx.locals), scope: [...ctx.scope] }
      innerHtmlRaw = b.children.map((c) => walk(c, branchCtx)).join('')
    } finally {
      // try/finally : une branche fautive (walk qui lève) ne doit pas laisser
      // la pile de gardes désynchronisée pour les branches/if suivants.
      state.effectGuardStack.pop()
    }
    const branchUpdates = ctx.updates.splice(branchPre, ctx.updates.length - branchPre)
    allBranchUpdates.push(branchUpdates)
    // `compactPaths` : cf. la branche non-root ci-dessus — forme compacte hors boucle seulement.
    const createBody = generateCreateFnBody(innerHtmlRaw, { splitSelectPostUpdates: true, compactPaths: ctx.loops.length === 0, foreignNsRoot: ctx.svgNs ?? null })
    allPostUpdates.push(createBody.postUpdates ?? [])
    return `if (_c_${id} === ${i}) { _mjs_cfn = () => { ${createBody.body} }; }`
  })
  const htmlLogic = htmlParts.join(' else ')

  // Exécution de l'état initial des interpolations/bindings de la branche
  // active. `c >= 0` exclut la pseudo-branche `-1` (aucun `{else}` et toutes
  // les conditions fausses → rien de rendu).
  //
  // Une mise à jour dont le code est identique à un effet enregistré pendant le walk (le jumeau,
  // cf. `effectTwins`) n'est PAS rejouée à chaque passe : l'effet la joue au montage
  // (`_mjs_effectsAll`, juste après la passe structurelle) et à chaque changement de sa variable.
  // Elle n'est posée ici qu'à la (re)création de la branche après le montage, pour les valeurs
  // dont la variable n'a pas bougé. Tout le reste (structure imbriquée, `postUpdates`, liaisons
  // sans jumeau…) garde son rejeu à chaque passe, comme avant.
  const branchExecParts: string[] = []
  const kidParts: string[]        = []
  let hasTwin                     = false
  for (let i = 0; i < allBranchUpdates.length; i++) {
    const branchUpdates = allBranchUpdates[i]
    const postUpdates = allPostUpdates[i]
    if (branchUpdates.length === 0 && postUpdates.length === 0) continue
    // l'ordre d'origine est gardé : une jumelle peut dépendre d'une structure posée avant elle
    // (la valeur d'un <select> après le {for} de ses <option>) ; la jumelle qui livre une prop à un composant part
    // dans `_mjs_kb`, jouée par `_mjs_updIf` avant l'insertion de la branche (cf. CHILD_PROP)
    const kids: string[] = []
    const wrapped        = branchUpdates.map((u) => {
      const twin = state.effectTwins.has(u) && !/_mjs_updIf|_mjs_updFor|_mjs_updAwait|_mjs_updKey|_updElement|_mjs_td|µ\._mjs_fx\(|_mjs_intro|_mjs_outro/.test(u)
      if (twin && CHILD_PROP.test(u)) {
        kids.push(`{ ${u} }`)
        return ''
      }
      if (twin) hasTwin = true
      return twin ? `if (_mjs_nb) { ${u} }` : `{ ${u} }`
    }).filter((u) => u !== '').join(' ') + (postUpdates.length > 0 ? ' ' + postUpdates.map((u) => `{ ${u} }`).join(' ') : '')
    if (kids.length > 0) kidParts.push(`if (_c_${id} === ${i}) { _mjs_kb = () => { ${kids.join(' ')} }; }`)
    if (wrapped.trim() !== '') branchExecParts.push(`if (_c_${id} === ${i}) { ${wrapped} }`)
  }
  const branchExec = branchExecParts.join(' else ')
  const branchExecBlock = branchExec === '' ? '' : ` if (_c_${id} >= 0) { ${branchExec} }`
  // `_mjs_nb` : la branche vient d'être (re)créée après le montage
  const twinDecl = hasTwin ? ' let _mjs_nb = false;' : ''
  const twinSet  = hasTwin ? ' _mjs_nb = !this._mjs_initial_render;' : ''

  // V2 — pas de `if (dirty & ...)` : exécuté à chaque tick via _mjs_renderStruct.
  // On passe une createFn (au lieu de html+paths) à _mjs_updIf.
  // `_c_${id}` (avant : `c` nu). Les
  // updates root s'exécutent DANS la closure `init`, où TOUTES les vars top-level
  // du script sont visibles : un `c = 42` (compteur/caractère, nom banal) au
  // <script> + `{if c > 3}` générait `const c = (c > 3) ? …` → auto-référence en
  // TDZ, crash dur à chaque _mjs_renderStruct. `_mjs_cfn` (pas `cfn`) même précaution.
  // une branche qui porte un repère `<@element>` (`mjs-el`, transpiler/macros.ts) : l'effet de sa balise ne suit que sa variable, la branche
  // recréée après le montage reprend la dernière balise demandée (µ._mjs_dynRe, runtime/mjs_dynamic.ts)
  const dynRe    = htmlParts.some((h) => /\smjs-el=/.test(h)) ? ' µ._mjs_dynRe(this);' : ''
  const kbDecl   = kidParts.length > 0 ? ', _mjs_kb = null' : ''
  const kbSet    = kidParts.length > 0 ? ' ' + kidParts.join(' else ') : ''
  const kbArg    = kidParts.length > 0 ? ', _mjs_kb' : ''
  const ifUpdate = `{ const _mjs_o = (this._mjs_old ??= {}); const _c_${id} = ${evalLogic};${twinDecl} if(_c_${id} !== _mjs_o.${id}){ let _mjs_cfn = null${kbDecl}; ${htmlLogic}${kbSet} this._mjs_updIf('${id}', _mjs_cfn${kbArg});${dynRe} _mjs_o.${id} = _c_${id};${twinSet} }${branchExecBlock} }`

  ctx.updates.splice(preSize, 0, ifUpdate)

  return `<script type='mjs/marker' mjs-t='s-${id}'></script><script type='mjs/marker' mjs-t='e-${id}'></script>`
}

// expression « de ligne » : faite seulement de l'élément, de l'index, de littéraux et d'opérateurs
// (accès `a.b`, `a['b']` compris), sans appel, sans affectation, sans fonction fléchée. Dans le doute : faux
function lineExpr(expr: string | null | undefined, item: string, index: string): boolean {
  if (expr == null) return false
  let e = expr.replace(/'[^'\\#]*'|"[^"\\#]*"/g, '0')
  if (/['"`\\#{}@$;]/.test(e)) return false
  e = e.replace(/\bnot\s+/g, '!').replace(/\b(?:and|or|is|isnt)\b/g, '&')
  if (/[\w\])]\s*\(/.test(e) || /->|=>|\+\+|--|(?<![=!<>])=(?!=)/.test(e)) return false
  e = e.replace(/\b\d[\w.]*/g, '0')
  // un blanc n'est permis que des DEUX côtés d'un opérateur, ou après une virgule : tout autre blanc
  // peut être un appel sans parenthèses (`row.fmt i`, `row.fmt -i`, `row.x? 1`, `row.x . y`)
  e = e.trim().replace(/\s+([+\-*\/%<>=!&|?:]+)\s+/g, '$1').replace(/,\s+/g, ',')
  if (/\s/.test(e) || /[\w\])]\?[(\[]/.test(e)) return false
  e = e.replace(/\??\.[A-Za-z_]\w*/g, '')
  const allowed = new Set([item, index, 'true', 'false', 'null', 'undefined'])
  for (const m of e.match(/[A-Za-z_]\w*/g) ?? []) if (!allowed.has(m)) return false
  return /^[\w+\-*\/%<>=!&|?:()\[\],]*$/.test(e)
}

// ligne de `{for}` « pure » : sa mise à jour ne lit que l'élément et l'index de CETTE boucle. Liste
// blanche : texte, `{expr}` de ligne, balises natives, attributs liés à une expression de ligne,
// classe par clé (`@class{$x === item.y}`, déjà routée par un index clé → nœud), gestionnaires
// d'événements (non joués à la mise à jour). Tout le reste (variable, prop, store, contexte, appel,
// bloc, composant, slot, effet, `{const}`) rend la ligne impure
function lineIsPure(children: Node[], item: string | null, index: string): boolean {
  if (!item) return false
  return children.every((n) => pureLineNode(n, item, index))
}

function pureLineNode(n: Node, item: string, index: string): boolean {
  if (n.type === 'text') return true
  if (n.type === 'expr') return lineExpr(noHashComment(n.expr), item, index)
  if (n.type !== 'tag') return false
  const name = n.name ?? ''
  if (!/^[a-z][a-z0-9]*$/.test(name) || name === 'slot' || name === 'script' || name === 'style' || name === 'template') return false
  for (const a of n.attrs) {
    const an = a.name ?? ''
    if (a.type === 'spread') return false
    if (an.startsWith('@class{') || /^@style\.[\w-]+\{/.test(an)) {
      const cond = an.slice(an.indexOf('{') + 1, -1)
      if (!lineExpr(cond, item, index) && !(an.startsWith('@class{') && detectFilteredPattern(cond, item, state.externalVars ?? []))) return false
    } else if (an.startsWith('@')) {
      if (a.type !== 'dynamic' || !/^@[a-z]+$/.test(an) || isSpecialAttr(an) || MJS_BOOLEAN_PROPS.includes(an.slice(1))) return false
    } else if (!/^[a-z][a-z0-9_:-]*$/.test(an) || an.startsWith('mjs-') || MJS_BOOLEAN_PROPS.includes(an)) {
      return false
    } else if (a.type === 'dynamic') {
      if (!lineExpr(a.expr, item, index)) return false
    } else if (a.type === 'static' && /[{}*]/.test(a.val ?? '')) {
      return false
    }
  }
  return n.children.every((c) => pureLineNode(c, item, index))
}

// globaux JavaScript sans état : leur lecture ne cache aucune variable que le compilateur ne voit pas
// (ni `window`, `document`, `globalThis`, `localStorage`, `navigator`, `location` : ils portent un état)
const STATELESS_GLOBALS = new Set([
  'String', 'Number', 'Boolean', 'Array', 'Object', 'Math', 'JSON', 'Date', 'Intl', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'undefined', 'NaN', 'Infinity', 'Symbol', 'BigInt', 'Map', 'Set', 'encodeURIComponent',
  'decodeURIComponent',
])

// noms que le code émis lit sans les déclarer : état du composant, runtime, nœuds de la ligne, `this` de
// l'appelant, `console` (avertissements émis par `@transition`, sans état) et espace `_mjs_` du générateur (réservé, cf. RESERVED_PREFIX_RE du parseur). Un nom en `_`
// ou `__` du script n'en est pas un : il se distingue par ce préfixe exact, jamais par un simple `_`
const EMITTED_INTERNALS = new Set(['$', 'µ', '__nodes', '_mjsThis', 'console'])

// identifiants libres de l'itérable et du code d'une ligne (enveloppé en fléchée par l'appelant) dont la
// provenance n'est pas connue et sûre : tout sauf état réactif, internes émis et globaux sans état.
// Le code de l'élément, de l'index, des `{const}` et des fléchées en ligne y est déclaré, donc non libre.
// Un code qui ne se parse pas rend un nom fictif : jamais de garde dans le doute
function untrackedIdentifiers(iterable: string, line: string): string[] {
  const blocking = new Set<string>()
  for (const code of [`(${iterable});`, `${line};`]) {
    const free = freeIdentifiers(code)
    if (!free) return ['<non analysable>']
    for (const name of free) {
      if (EMITTED_INTERNALS.has(name) || name.startsWith('_mjs_') || STATELESS_GLOBALS.has(name)) continue
      blocking.add(name)
    }
  }
  return [...blocking]
}

// ============================================================================
// mise à jour fine — les champs que lit un code émis, lus sur son arbre
// ============================================================================

// un code émis (suite d'instructions, `return` et `await` permis) en arbre, dans une fonction fléchée qui ne change ni ses noms libres
// ni `this` : les positions de l'arbre sont décalées de la longueur de son entrée. null quand il ne se lit pas
const ENTRY = '(async () => {\n'
export function codeTree(code: string): any {
  try {
    return acorn.parse(`${ENTRY}${code}\n})`, { ecmaVersion: 'latest', sourceType: 'module' })
  }
  catch {
    return null
  }
}

// ce que lit le code : l'élément d'une ligne (`row.label` → `label`) ou une variable de l'état (`$.o.f7` → `f7`) ; `liste` : la
// variable que la ligne ne doit pas lire ; `permis` : autres noms libres permis (indice, `{const}` de la ligne), relevés quand ils sont lus
export interface ReadBase {
  element?: string
  state?: string
  list?: string
  allowed?: Set<string>
  // `{const}` de la ligne, parmi les noms permis : lus tels quels, comme un champ de l'élément (cf. readBelow)
  consts?: Set<string>
}

// `x` lu sous lui (`x.a`, `x[k]`), passé à un appel qui n'est pas une aide du cœur (`JSON.stringify(x)`) ou étalé : ce qu'il tient est lu,
// et l'objet tenu par le champ d'une ligne peut être une autre ligne de la même liste (`row.parent.label`), que l'écriture d'un de ses
// champs ne rappellerait pas
function readBelow(x: any, p: any): boolean {
  if (!p) return false
  if (p.type === 'MemberExpression') return p.object === x
  if (p.type === 'SpreadElement') return true
  if (p.type !== 'CallExpression' && p.type !== 'NewExpression' || !p.arguments.includes(x)) return false
  const f = p.callee
  const helper = f.type === 'MemberExpression' && !f.computed && f.property.name.startsWith('_mjs_') && (f.object.type === 'ThisExpression' || f.object.type === 'Identifier' && (f.object.name === 'µ' || f.object.name === '_mjsThis'))
  return !helper && !(f.type === 'Identifier' && f.name.startsWith('_mjs_'))
}

// noeud écrit, appelé (méthode de son objet : elle lit `this`) ou parcouru par `for…in` : il n'est pas lu champ par champ
function readAlone(m: any, p: any): boolean {
  if (!p) return true
  if ((p.type === 'CallExpression' || p.type === 'NewExpression') && p.callee === m) return false
  if (p.type === 'TaggedTemplateExpression' && p.tag === m) return false
  if (p.type === 'AssignmentExpression' && p.left === m) return false
  if (p.type === 'UpdateExpression' || p.type === 'UnaryExpression' && p.operator === 'delete') return false
  return !((p.type === 'ForInStatement' || p.type === 'ForOfStatement') && p.left === m)
}

// champs lus sous la base (le premier nom sous l'élément ou sous la variable) et noms permis lus ; null quand le code lit la base
// entière (`JSON.stringify(row)`, `row[k]`, `row?.x`, `$.o` passé tel quel), appelle une méthode de la base (`row.fmt()`,
// `$.o.lire()`), livre une prop à un composant enfant, lit l'état d'une façon que l'analyse ne suit pas (`$[k]`, `$` nu,
// `this._state`, membre du composant `this.fmt`, fonction rangée dans l'état), lit la variable de sa liste, cache un nom suivi sous
// une déclaration homonyme, ou lit un nom libre de provenance inconnue (fonction ou variable du script, import : un appel peut lire
// n'importe quel champ), l'horloge ou le hasard (`Date.now()`, `new Date()`, `Math.random()` : la liaison change sans que rien de lu ne
// change, une passe entière la refaisait). Dans le doute : null. `profond` : la variable suivie est lue sous un de ses champs (`$.o.a.b`,
// `$.o.prix.toFixed(2)`, `JSON.stringify($.o.a)`) — l'objet atteint peut être la variable elle-même (`$o.self = $o`)
export function readFields(code: string, base: ReadBase): { fields: Set<string>, names: Set<string>, deep: boolean } | null {
  const ast = codeTree(code)
  const free = ast && freeIdentifiers(`${ENTRY}${code}\n})`)
  if (!free) return null
  for (const name of free) {
    if (name === base.element || base.allowed?.has(name) || name === '$' || EMITTED_INTERNALS.has(name) || STATELESS_GLOBALS.has(name) || name.startsWith('_mjs_') || name.startsWith('_nref_')) continue
    return null
  }
  const tracked = new Set<string>(['$', ...(base.element ? [base.element] : []), ...(base.allowed ?? [])])
  const fields  = new Set<string>()
  const names   = new Set<string>()
  let safe      = true
  let deep      = false
  acornWalk.fullAncestor(ast, (n: any, _st: any, anc: any[]) => {
    if (!safe) return
    const p = anc[anc.length - 2]
    const g = anc[anc.length - 3]
    // un nom suivi déclaré dans le code (paramètre, variable, fonction, `catch`) : ses lectures n'y seraient plus celles de la base
    const declares: string[] = []
    if (n.type === 'VariableDeclarator') patternNames(n.id, declares)
    else if (/Function/.test(n.type)) { for (const q of n.params) patternNames(q, declares); if (n.id) declares.push(n.id.name) }
    else if (n.type === 'CatchClause') patternNames(n.param, declares)
    else if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) declares.push(n.id.name)
    if (declares.some((d) => tracked.has(d))) { safe = false; return }
    if (n.type === 'ThisExpression' || n.type === 'Identifier' && n.name === '_mjsThis') {
      // le composant : seulement ses internes (`this._mjs_updText`), jamais `this._state` ni un membre de l'auteur
      safe = !!p && p.type === 'MemberExpression' && p.object === n && !p.computed && p.property.name.startsWith('_mjs_')
      return
    }
    if (n.type !== 'Identifier') return
    if (n.name === base.element) {
      safe = !!p && p.type === 'MemberExpression' && p.object === n && !p.computed && !p.optional && readAlone(p, g) && !readBelow(p, g)
      if (safe) fields.add(p.property.name)
      return
    }
    if (base.allowed?.has(n.name)) {
      if (base.consts?.has(n.name) && readBelow(n, p)) safe = false
      names.add(n.name)
      return
    }
    if (n.name !== '$') return
    // `$.x` : une autre variable se lit librement (sa propre écriture prend le chemin ordinaire), sauf appelée ; la variable de la
    // liste jamais ; la variable suivie par un champ nommé, ni appelé ni écrit
    if (!p || p.type !== 'MemberExpression' || p.object !== n || p.computed || p.optional || p.property.name === base.list || !readAlone(p, g)) { safe = false; return }
    if (p.property.name !== base.state) return
    safe = !!g && g.type === 'MemberExpression' && g.object === p && !g.computed && !g.optional && readAlone(g, anc[anc.length - 4])
    if (!safe) return
    fields.add(g.property.name)
    if (readBelow(g, anc[anc.length - 4])) deep = true
  })
  if (!safe) return null
  // méthode appelée sur la valeur d'une autre variable de l'état (`$.w.fmt()`) : elle peut lire n'importe quel champ ; prop livrée à un
  // composant enfant (`µ._mjs_pend`, l'aide qui la garde jusqu'à son réveil) : l'enfant lit ce qu'il veut sous la valeur reçue
  acornWalk.simple(ast, {
    CallExpression(n: any) {
      if (n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name === '_mjs_pend') safe = false
      if (impure(n.callee)) safe = false
      let r = n.callee
      const chain: string[] = []
      while (r.type === 'MemberExpression' || r.type === 'ChainExpression') {
        if (r.type === 'MemberExpression') chain.unshift(r.computed ? '' : r.property.name)
        r = r.type === 'ChainExpression' ? r.expression : r.object
      }
      if (r.type === 'Identifier' && r.name === '$' && !(chain[0] === base.state && chain.length >= 3)) safe = false
    },
    NewExpression(n: any) {
      if (n.callee.type === 'Identifier' && n.callee.name === 'Date' && n.arguments.length === 0) safe = false
    },
  })
  return safe ? { fields, names, deep } : null
}

// `Date()`, `Date.now()`, `Math.random()` : ce que rend l'appel change sans écriture
function impure(f: any): boolean {
  if (f.type === 'Identifier') return f.name === 'Date'
  return f.type === 'MemberExpression' && !f.computed && f.object.type === 'Identifier' && (f.object.name === 'Date' && f.property.name === 'now' || f.object.name === 'Math' && f.property.name === 'random')
}

// le code (passe de structure, transition) lit-il un nom libre de provenance inconnue (fonction ou variable du script, import) ? La
// passe de structure le relit à chacun de ses tours, quelle que soit la variable écrite : une écriture servie champ par champ, qui ne
// la fait pas tourner, le laisserait périmé (`{for r in premiers()}`). `document`, que la passe émise lit elle-même, est permis. Un
// code qui ne se lit pas : oui
export function unknownRead(code: string): boolean {
  const free = freeIdentifiers(`${ENTRY}${code}\n})`)
  if (!free) return true
  for (const name of free) {
    if (name === '$' || name === 'document' || EMITTED_INTERNALS.has(name) || STATELESS_GLOBALS.has(name) || name.startsWith('_mjs_') || name.startsWith('_nref_')) continue
    return true
  }
  return false
}

// masques d'une ligne de `{for}` : un bit par champ de l'élément lu (30 au plus), dans l'ordre où les champs apparaissent ; un `{const}`
// de la ligne porte les champs qu'il lit, que reçoit toute liaison qui le lit. Le champ de la clé vaut -1 dans la table (son écriture
// déplace la ligne : chemin ordinaire). null : la liste garde le chemin ordinaire (cf. readFields)
function lineMasks(consts: string[], bindings: string[], item: string, index: string, key: string | null, list: string): { masks: number[], table: Record<string, number> } | null {
  const table: Record<string, number> = {}
  const byConst = new Map<string, number>()
  const allowed = new Set([index])
  const constNames = new Set<string>()
  let bits = 0
  const mask = (code: string): number | null => {
    const read = readFields(code, { element: item, list, allowed, consts: constNames })
    if (!read) return null
    let m = 0
    for (const c of read.fields) {
      if (table[c] === undefined) {
        if (bits === 30) return null
        table[c] = 1 << bits++
      }
      m |= table[c]
    }
    for (const n of read.names) m |= byConst.get(n) ?? 0
    return m
  }
  for (const d of consts) {
    const src  = d.slice(CONST_DECL_PREFIX.length)
    const decl = codeTree(src)?.body[0].expression.body.body[0]
    const v    = decl?.type === 'VariableDeclaration' && decl.declarations.length === 1 ? decl.declarations[0] : null
    if (!v || v.id.type !== 'Identifier' || !v.init) return null
    const m = mask(src.slice(v.init.start - ENTRY.length, v.init.end - ENTRY.length))
    if (m === null) return null
    byConst.set(v.id.name, m)
    allowed.add(v.id.name)
    constNames.add(v.id.name)
  }
  const masks: number[] = []
  for (const u of bindings) {
    const m = mask(u)
    if (m === null) return null
    masks.push(m)
  }
  if (key) table[key] = -1
  return { masks, table }
}

// variable nue d'un itérable (`$.data` → `data`), sur son arbre ; null pour toute autre forme
function bareVariable(iterable: string): string | null {
  try {
    const e: any = acorn.parseExpressionAt(iterable, 0, { ecmaVersion: 'latest' })
    return e.end === iterable.length && e.type === 'MemberExpression' && !e.computed && !e.optional && e.object.type === 'Identifier' && e.object.name === '$' ? e.property.name : null
  }
  catch {
    return null
  }
}

// un nom simple (élément, clé `by`), sur son arbre
function isName(s: string): boolean {
  try {
    const e: any = acorn.parseExpressionAt(s, 0, { ecmaVersion: 'latest' })
    return e.type === 'Identifier' && e.end === s.length
  }
  catch {
    return false
  }
}

// place de chaque balise `@flip` du gabarit d'une ligne de `{for}`, à toute profondeur (sous une autre balise, un `{if}`, un `{elsif}`, un `{else}` ou un
// `{key}`) : son rang parmi ces balises, une balise avant ses enfants. Les branches d'un même `{if}` se partagent les mêmes places (une seule est là à la
// fois) et le bloc occupe celles de sa branche la plus longue. Un `{for}` imbriqué a ses propres lignes, donc ses propres places : il n'est pas compté.
// Rend le nombre de places
function placesFlip(children: Node[], places: Map<Node, number>, start = 0): number {
  let n = start
  for (const c of children) {
    if (c.type === 'tag') {
      if (c.attrs.some((a) => a.name === '@flip')) places.set(c, n++)
      n = placesFlip(c.children, places, n)
    }
    else if (c.type === 'if') n = Math.max(n, ...c.branches.map((b) => placesFlip(b.children, places, n)))
    else if (c.type === 'key') n = placesFlip(c.children, places, n)
  }
  return n
}

// ============================================================================
// compileFor — classé "struct", exécuté à chaque tick par `_mjs_renderStruct`.
// L'idempotence de `_mjs_updFor` (clés stables + LIS) garantit qu'aucun travail
// inutile n'est fait sur les ticks où la collection est inchangée.
// ============================================================================
export function compileFor(node: Node, ctx: Ctx): string {
  state.counter += 1
  const id = `for${state.counter}`

  // Collecter les vars qui pilotent l'iterable. Si la mutation
  // d'une autre var arrive, `_mjs_renderStruct` peut être skip (gain select1k).
  const varsIterable = getEffectVars(node.iterable)
  for (const v of varsIterable) {
    state.structVars.add(v)
  }

  // Site EXPR (itérable {for X in ITERABLE}).
  const jsIterable = cleanTemplateExpr(node.iterable, state.externalVars, state.moduleName)
  const indexVar = node.index ?? 'index'
  const internalIndex = `_mjs_idx_${ctx.loops.length}`

  const loopInfo: LoopInfo = {
    item: node.item ?? '',
    index: indexVar,
    internalIndex,
    iterable: jsIterable,
    depth: ctx.loops.length,
    key: node.key ?? null,
  }
  // ligne pure d'un `{for}` de racine : ses gestionnaires liront l'élément et l'indice sur l'entrée de la ligne, décidé avant le corps
  // (les balises de la ligne le consultent en se compilant)
  if (ctx.type === 'root' && ctx.loops.length === 0 && lineIsPure(node.children, node.item, indexVar)) loopInfo.byEntry = true
  // plusieurs places : l'étiquette de chaque balise `@flip` ajoute la sienne à celle de la ligne (attributes/index.ts) ; une seule : l'étiquette de la ligne
  const places = new Map<Node, number>()
  if (placesFlip(node.children, places) > 1) loopInfo.flipPlaces = places
  // noms que CE `{for}` introduit dans le corps des handlers de son sous-arbre :
  // le squelette de reconstruction les réassigne en tête de handler, ils doivent
  // donc y rester LOCAUX même si le `<script>` porte un homonyme (cf. state.templateLocals)
  if (loopInfo.item) state.templateLocals.add(loopInfo.item)
  state.templateLocals.add(indexVar)
  // … et ils ne sont locaux que pour les handlers de CE corps, jamais pour ceux d'à côté
  const locals = new Set(ctx.locals)
  if (loopInfo.item) locals.add(loopInfo.item)
  locals.add(indexVar)
  const newLoops = ctx.loops.concat([loopInfo])

  const keyExpr = node.key ? `${node.item}.${node.key}` : 'null'
  // Si la clef est un attribut statique (`item.X`), on passe le NOM de
  // l'attribut (`'X'`) au runtime au lieu de générer une fonction
  // `(item) => item.X`. Le runtime fait `item[keyAttr]` direct, évitant
  // l'overhead d'un appel de fonction par iteration. Sur 1000 items, gain
  // ~3-5ms.
  const keyAttrLit = node.key ? `'${node.key}'` : 'null'
  // fonction de clé : seulement avec `by` ; sans `by`, `null` — une ligne d'un tableau est suivie par son objet ou sa position,
  // celle d'une `Map` par la clé de la `Map` (mjs_for.ts, `_mjs_reconcileList`), qu'une fonction qui rend `null` masquait : chaque
  // passe refaisait toutes les lignes d'une `Map`
  const keyFnLit = node.key ? `(${node.item}, ${indexVar}) => ${keyExpr}` : 'null'

  const loopCtx: Ctx = { type: 'for', loops: newLoops, updates: [], birth: [], locals, scope: ctx.scope.concat([{ kind: 'for', loop: loopInfo }]), svgNs: ctx.svgNs, foreign: ctx.foreign }
  // sous un `{await}` : les variables du dehors que les lignes lisent sont mises de côté, puis rendues
  // à `structVars` — elles servent à refaire la liste quand l'une d'elles change (cf. plus bas)
  const underAwait = ctx.type === 'await' && ctx.loops.length === 0
  // `{for}` de racine : même mise de côté, pour connaître SES variables (itérable + lignes) et ne le
  // rejouer que si l'une d'elles a changé (cf. `_mjs_chg`)
  const root = ctx.type === 'root' && !ctx.inBlock
  const varsBefore = state.structVars
  if (underAwait || root) state.structVars = new Set()
  // les directives qui lisent leur balise dans le document (`@transition`, `@in`/`@out`, `@attach`, `@this=!`, un effet, `@flip` : les
  // seules à lever `hasDestroyHooks`) relevées dans CETTE ligne, à toute profondeur ; le drapeau du composant les reprend ensuite
  const dhComponent = state.hasDestroyHooks
  state.hasDestroyHooks = false
  const bodyRaw = node.children.map((c) => walk(c, loopCtx)).join('')
  const sensitiveLine = state.hasDestroyHooks
  state.hasDestroyHooks = dhComponent || sensitiveLine
  const varsBody = state.structVars
  if (underAwait || root) {
    for (const v of varsBody) varsBefore.add(v)
    state.structVars = varsBefore
  }
  // Les déclarations `{const}` (marquées CONST_DECL_PREFIX) sont émises TELLES
  // QUELLES et HISSÉES en tête — sans wrapper `{ … }`, sinon `NOM` serait
  // scopé à son bloc et invisible des updates frères qui le lisent. L'ordre
  // RELATIF des const est préservé (un `{const}` peut dépendre d'un précédent).
  const constDecls = loopCtx.updates.filter((u) => u.startsWith(CONST_DECL_PREFIX))
  const regularUpdates = loopCtx.updates.filter((u) => !u.startsWith(CONST_DECL_PREFIX))
  const constPrefix = constDecls.length > 0 ? constDecls.join(' ') + ' ' : ''
  let localUpdates = constPrefix + regularUpdates.map((u) => `{ ${u} }`).join(' ')

  // Génère directement une createFn(item, index) → {fragment, refs}.
  // Plus de cloneNode, plus de walk paths, plus de cache HTML.
  // Élagage des refs mortes : on ne fait naviguer/exposer par la factory
  // que les refs réellement consommées — celles citées par `__nodes['X']` dans
  // les updates de la loop (updateFn, lookups live, tplFn des for imbriqués)
  // et celles portant un event listener. Les markers extraits « au cas où »
  // par le walk disparaissent (6 des 13 refs d'un row de bench).
  const keepRefs = new Set<string>()
  {
    const reUses = /__nodes\['([^'\$\{]+)'\]/g
    let mU: RegExpExecArray | null
    while ((mU = reUses.exec(localUpdates)) !== null) keepRefs.add(mU[1])
    if (state.events) {
      for (const evtType of Object.keys(state.events)) {
        const idMap = state.events[evtType]
        if (idMap) for (const eid of Object.keys(idMap)) keepRefs.add(eid)
      }
    }
  }
  // Gabarit de LIGNE : jamais `compactPaths` (défaut faux). Ce corps est exécuté une fois par
  // ligne — 1 000 fois sur une création de liste : il garde ses chaînes de propriétés directes,
  // sans appel de fonction, et son code reste celui d'avant, à l'octet.
  // `foreignNsRoot` : une ligne posée dans un <svg>/<math> y naît (cf. Ctx.svgNs) ; `singleRoot` : une ligne à racine unique est
  // l'élément cloné seul, sans fragment autour
  const createBody = generateCreateFnBody(bodyRaw, { keepRefs, splitSelectPostUpdates: true, foreignNsRoot: ctx.svgNs ?? null, singleRoot: true })
  // `postUpdates` (ex. `value` d'un `<select>` dont les
  // `<option>` viennent d'un `{for}` imbriqué) doivent courir APRÈS les updates
  // de CETTE row (mêmes `__nodes`) : rejouées ici, dans le MÊME `localUpdates`
  // qu'`extractRefsForClosure` transforme juste après (mode clone : toujours vide,
  // `keepRefs` ci-dessus reste calculé sur le `localUpdates` D'AVANT cet ajout).
  const after = createBody.postUpdates && createBody.postUpdates.length > 0 ? ' ' + createBody.postUpdates.map((u) => `{ ${u} }`).join(' ') : ''
  localUpdates += after

  // Optim #5 — Refs en closure (style Solid) : extrait les refs utilisées dans
  // `localUpdates` en variables locales DANS le tplFn, puis crée un updateFn
  // local qui ferme sur ces variables. Évite le dict-lookup `__nodes['lid']` à
  // chaque appel d'update (mesure attendue : ~30-50ms sur create1k/replace1k).
  // une ligne qui porte un repère `<@element>` (`mjs-el`) : la balise neuve prend la place du repère dans les réfs de la ligne (`__nodes`,
  // µ._updDynEl, runtime/mjs_dynamic.ts) ; ses mises à jour (liaisons de la balise, index lu par ses gestionnaires) les relisent donc à
  // chaque passe, jamais une copie gardée du repère
  const keptRefs = /\smjs-el=/.test(createBody.body) ? [] : createBody.refIds
  const { refIds: usedRefIds, transformedBody: localUpdatesClosure } =
    extractRefsForClosure(localUpdates, keptRefs)

  // Optim #5c — _mjs_registerRefs sélectif compile-time.
  // Collecte les ids du {for} qui ont AU MOINS un event listener (via state.events).
  // Si aucun → on skip `_mjs_registerRefs` entièrement.
  // Sinon → on génère un register inline pour les N ids concernés (au lieu
  // d'itérer Object.keys + Set.has() par row).
  const evtIdsInFor: string[] = []
  if (state.events) {
    for (const evtType of Object.keys(state.events)) {
      const idMap = state.events[evtType]
      if (!idMap) continue
      for (const eid of Object.keys(idMap)) {
        if (createBody.refIds.includes(eid) && !evtIdsInFor.includes(eid)) {
          evtIdsInFor.push(eid)
        }
      }
    }
  }
  // Perf, modèle Solid/Svelte : fusionner la pose d'état INITIALE dans la
  // factory. Au create, _mjs_reconcileList rappelait l'updateFn juste après
  // l'insertion uniquement pour poser data/classe/idx — on l'appelle ici, dans
  // le tplFn, et on signale `_mjs_init: 1` → _mjs_reconcileList saute ce passage pour
  // les entries FRAÎCHES (les tours suivants repassent par updateFn, _mjs_init=0).
  // RESTRICTION : composants SANS binding sensible à l'insertion
  // (@transition/@attach/… — flag hasDestroyHooks) ; sinon comportement
  // historique (pose en pass 2 après insertion).
  // un `{for}` imbriqué n'en est pas un (`hasNestedFor`) : dans son composant, une ligne qui livre des props à un composant enfant
  // (`µ._mjs_pend(`, à toute profondeur de la ligne) naît peuplée, encore hors du document — l'enfant y trouve ses props à son
  // réveil, comme dans une liste plate ; une ligne sans composant garde la pose après insertion (code inchangé : au rendu serveur,
  // happy-dom choisit la première option insérée quand une `<select>` reçoit d'un coup des options déjà choisies)
  // le besoin vaut pour la ligne qui porte elle-même une de ces directives (`sensitiveLine`) : posée ailleurs dans le composant, une
  // directive laisse naître peuplée la ligne qui livre des props à un composant enfant
  // une ligne pure d'une liste de premier rang (rien que son élément et son index, aucun bloc : cf. lineIsPure) naît peuplée même
  // quand un `{for}` imbriqué est ailleurs dans le composant : elle garde son saut (cf. pureLine) ; seules les lignes qui portent une
  // liste, ou d'autres blocs, gardent la pose après insertion
  const __pend     = localUpdates.includes('µ._mjs_pend(')
  const __pureHere = state.hasNestedFor && ctx.loops.length === 0 && ctx.type === 'root' && lineIsPure(node.children, node.item, indexVar)
  const __fuseInit = !sensitiveLine && (__pend || (!state.hasDestroyHooks && (!state.hasNestedFor || __pureHere)))
  // ligne peuplée après son insertion qui livre des props à un composant enfant : ses composants, connectés par l'insertion, attendent
  // pour se réveiller la fin de la réconciliation, où leurs props sont posées (`µ._mjs_waitRow`, mjs_for.ts) ; appel facultatif, comme
  // pour la branche d'un `{if}` de ligne
  const __waitRow = !__fuseInit && __pend
  // ligne d'une liste imbriquée : sa closure de mise à jour fermerait sur la portée de la ligne
  // PARENTE au rendu qui l'a construite (élément, index, `{const}`) — gardée sur l'entrée, la
  // réconciliation la préférait à `updateFn` (plus bas), et une ligne parente rechargée par un objet
  // neuf de même clé laissait ses lignes intérieures sur l'ancien objet ; après un tri, un clic y
  // retrouvait l'ancienne ligne parente. La closure ne sert donc plus qu'à la pose initiale
  // fusionnée, quand elle a lieu (le tplFn naît au rendu en cours, sa portée est fraîche) ; les
  // passes suivantes prennent `updateFn`, recréée à chaque rendu de la ligne parente. Hors
  // imbrication (racine, `{if}`/`{key}` de racine, branche `{await}`), aucune portée de ligne à
  // capturer : code généré inchangé
  const keepUpdFn  = ctx.loops.length === 0
  const closureUpd = keepUpdFn || __fuseInit
  // Refs à pré-extraire : union(usedRefIds, evtIdsInFor) pour que les events
  // aient leur _nref_ disponible avant le register ; celles des mises à jour seulement si la closure existe
  const refsToExtract = Array.from(new Set([...(closureUpd ? usedRefIds : []), ...evtIdsInFor]))
  const refExtractLines = refsToExtract.map(
    (rid) => `const _nref_${safeRefVarName(rid)} = __nodes['${rid}'];`
  ).join(' ')

  // Aucun event dans le {for} → ni table, ni enregistrement. Sinon, comme le `__click` de Svelte, UNE propriété par balise qui porte un
  // gestionnaire (`_mjs_ev`, aucun tableau, aucun attribut) : la table des réfs de sa ligne, qui mène aussi à l'entrée de la ligne
  // (`_mjs_ent`, lue par les gestionnaires d'une ligne pure). Sa description (`_mjs_reg` : le composant, les identifiants du gabarit qui
  // portent un gestionnaire) est faite une fois par composant et par gabarit, partagée par toutes les lignes ; le routeur y lit quels
  // identifiants désignent la balise (cf. `_mjs_bindEvents`, mjs_element.ts)
  // au-delà du quatrième niveau, dans un gabarit qui remplace ou copie ses balises (`state.idxCopied`) : les noms des rangs profonds
  // (`ix`), que la balise neuve d'un `<@element>` ou d'un `<@module>` et la copie d'un *marquee reprennent ; des clés nues, que la production raccourcit
  // comme les rangs eux-mêmes. Jusqu'au quatrième niveau, le runtime les nomme seul : code généré inchangé
  const deepRanks = state.idxCopied && loopInfo.depth >= 4 ? `, ix: { ${Array.from({ length: loopInfo.depth - 3 }, (_, i) => `_mjs_idx_${i + 4}: 1`).join(', ')} }` : ''
  const regDesc = evtIdsInFor.length === 0 ? 'true' : `(this._mjs_evd ??= {})['${id}'] ??= { o: this, ids: [${evtIdsInFor.map((eid) => `'${eid}'`).join(', ')}]${deepRanks} }`
  const registerRefsCode = evtIdsInFor.map((eid) => `{ const __n = _nref_${safeRefVarName(eid)}; if (__n && __n.nodeType === 1) __n._mjs_ev = __nodes; }`).join(' ')

  // saut des lignes inchangées : seulement le `{for}` de racine, ligne pure (cf. lineIsPure), pose
  // initiale fusionnée (`_mjs_init`) : le runtime note alors l'élément et l'index posés dès la création.
  // `2` : la mise à jour de la ligne ne lit pas son index (ni à l'écran ni posé sur une balise), une ligne qui glisse est sautée aussi
  const pureLine = keepUpdFn && __fuseInit && ctx.type === 'root' && lineIsPure(node.children, node.item, indexVar)
  const noIndex  = pureLine && lineIsPure(node.children, node.item, '') && !localUpdates.includes('_mjs_idx_')
  const closer   = `const _mjs_updFn = (${node.item || '_item'}, ${indexVar}) => { const ${internalIndex} = ${indexVar}; ${localUpdatesClosure} };`
  // mise à jour fine : liste d'une variable nue (`{for row in $data}`), à la racine ou dans un bloc de la racine (une ligne de liste
  // imbriquée n'a pas de fermeture gardée sur son entrée : chemin ordinaire). La fermeture émise reste celle-ci ; sa forme gardée par
  // les masques des champs que lit chaque liaison (`__f`, troisième paramètre, absent de la pose initiale et de la mise à jour
  // ordinaire : tout se rejoue) n'est calculée que si le transpileur la demande (cf. FineList, state.ts)
  const fineV = ctx.type === 'root' && ctx.loops.length === 0 && closureUpd ? bareVariable(jsIterable) : null
  if (fineV && node.item && isName(node.item) && (!node.key || isName(node.key))) {
    const item = node.item
    state.fineLists.push({ v: fineV, id, plain: closer, fine: () => {
      const r = lineMasks(constDecls, regularUpdates, item, indexVar, node.key ?? null, fineV)
      if (!r) return null
      const kept = constPrefix + regularUpdates.map((u, i) => `${r.masks[i] ? `if (!__f || __f & ${r.masks[i]}) ` : 'if (!__f) '}{ ${u} }`).join(' ') + after
      return { code: `const _mjs_updFn = (${item}, ${indexVar}, __f) => { const ${internalIndex} = ${indexVar}; ${extractRefsForClosure(kept, keptRefs).transformedBody} };`, table: r.table }
    } })
  }
  // un corps cloné s'ouvre par `const _mjs_fr = …` et finit par `return { fragment: _mjs_fr, refs: … };` (generateCloneFnBody) : il se pose tel
  // quel dans le rappel de ligne, qui y prend son fragment et ses réfs sans fonction ni objet entre eux — une fermeture, un appel et un objet
  // de moins par ligne ; tout autre corps (construction impérative) garde sa fonction
  const tplEnd = /return \{ fragment: _mjs_fr, refs: (_mjs_refs|\{\}) \};$/
  const built  = createBody.tplHtml != null && createBody.body.startsWith('const _mjs_fr = ') && tplEnd.test(createBody.body) ? `let _mjs_fr, __nodes = __a; if (!__a) { ${createBody.body.slice(6).replace(tplEnd, '__nodes = $1;')} }` : `const __built = __a ? { refs: __a } : (() => { ${createBody.body} })(); const _mjs_fr = __built.fragment, __nodes = __built.refs;`
  // `__a` : les réfs d'une ligne écrite par le serveur et reprise telle quelle (hydratation par repères, runtime/mjs_hydrate.ts) — le
  // gabarit n'est alors pas fabriqué, la ligne garde ses nœuds ; le reste du tplFn (événements, closure, pose initiale) est le même
  const tplFn = `(${node.item || '_item'}, ${indexVar}, __a) => {
    ${built}
    __nodes._mjs_reg = ${regDesc};${__waitRow ? ' µ._mjs_waitRow?.(__nodes);' : ''}${loopCtx.birth!.length ? ` if (!__a) { ${loopCtx.birth!.join(' ')} }` : ''}
    ${refExtractLines}
    ${registerRefsCode}
    ${closureUpd ? closer : ''}
    ${__fuseInit ? `_mjs_updFn(${node.item || '_item'}, ${indexVar});` : ''}
    return { fragment: _mjs_fr, refs: __nodes${keepUpdFn ? ', updateFn: _mjs_updFn' : ''}${__fuseInit ? ', _mjs_init: 1' : ''}${pureLine ? `, _mjs_p: ${noIndex ? 2 : 1}` : ''} };
  }`

  // fonction de mise à jour passée à CHAQUE rendu, recréée avec la portée courante, refs lues sur
  // l'entrée (`__nodes`) : `_mjs_reconcileList` la prend quand l'entrée n'a pas de closure
  // (`_mjs_updFn`) — toujours le cas d'une ligne de liste imbriquée, cf. `keepUpdFn`
  // hors imbrication, chaque entrée garde sa closure (`keepUpdFn`) : cette seconde copie ne serait jamais appelée
  const updateFn = keepUpdFn ? 'null' : `(__nodes, ${node.item}, ${indexVar}) => { const ${internalIndex} = ${indexVar}; ${localUpdates} }`

  if (ctx.type === 'root') {
    // gardé par ses variables quand on les connaît toutes ; sans aucune variable connue (itérable
    // calculé hors de vue, ligne qui ne lit rien de réactif), dans le doute : rejoué à chaque passe
    const forVars = new Set([...varsIterable, ...varsBody])
    // pas de garde dès qu'un identifiant libre du code émis (itérable + lignes) a une provenance que
    // l'analyse ne suit pas : fonction, constante, `let` ou objet du script, import, global à état
    // (cf. `untrackedIdentifiers`) ; la liste reste alors rejouée à chaque passe de structure
    const guard = root && forVars.size > 0 && untrackedIdentifiers(jsIterable, `(${node.item || '_item'}, ${indexVar}) => { const ${internalIndex} = ${indexVar}; ${localUpdates} }`).length === 0 ? `if(this._mjs_chg([${[...forVars].map((v) => `'${v}'`).join(',')}])) ` : ''
    // une ligne recréée qui porte un repère `<@element>` reprend la dernière balise demandée (µ._mjs_dynRe, cf. `compileIf`)
    const call = `this._mjs_updFor('${id}', ${jsIterable}, ${tplFn}, ${keyFnLit}, ${updateFn}, ${keyAttrLit});`
    ctx.updates.push(`{ const _mjsThis = this; ${guard}${/\smjs-el=/.test(tplFn) ? `{ ${call} µ._mjs_dynRe(this); }` : call} }`)
    return `<script type='mjs/marker' mjs-t='s-${id}'></script><script type='mjs/marker' mjs-t='e-${id}'></script>`
  }

  // Branche `{await}` sans loop parent : le {for} pose ses markers
  // `s-forN`/`e-forN` directement dans le fragment de la branche. Les updates
  // sont inlinées par `compileAwait` dans la createFn de branche et exécutées
  // en mode `__nodes` local (le fragment vient juste d'être construit, pas
  // encore dans `this._mjs_nodes`). On utilise `_mjs_updList` avec un cacheId statique
  // (pas de parent loop → pas de discriminant d'instance nécessaire).
  if (ctx.type === 'await' && ctx.loops.length === 0) {
    // `_mjs_forStart`/`_mjs_forEnd`
    // (avant : `startNode`/`endNode` nus) : mêmes tueurs que `_mjs_ifStart`. Ici
    // les vars TOP-LEVEL du script sont en scope (branche {await} sans loop) — un
    // `startNode = {...}` du <script> + `{for x in startNode.items}` lisait l'ANCRE
    // DOM au lieu de l'objet. Cf. reserved-names-collision.test.ts ({await}+{for}).
    // la liste se refait seule quand une variable de son itérable, ou une variable du dehors lue par une ligne, change : `_mjs_updAwait`
    // ne rejoue pas une branche dont la promesse et le statut n'ont pas changé, et ni l'itérable ni les lignes ne lisent
    // ces variables ailleurs que dans la fonction de mise à jour ; la fonction est gardée par la branche affichée et par les marqueurs
    // (branche retirée : rien) et mémorisée par instance sous l'id du `{for}` ; l'effet enregistré ci-dessous la rappelle.
    // Liste refaite dans la passe en cours (branche juste construite, `_mjs_awaitFresh` levé jusqu'à la
    // fin de la passe, qui est synchrone) : l'effet de la même passe ne la refait pas, les valeurs
    // viennent d'être lues. Hors de cette passe (variable changée plus tard) il la rappelle comme avant
    // les valeurs lues par la liste au moment où elle est construite : l'effet ne saute son rappel que
    // si elles n'ont pas bougé depuis (une écriture arrivée entre la construction et l'effet n'est pas perdue)
    const trackedVars = new Set([...varsIterable, ...varsBody])
    const readValues  = `[${[...trackedVars].map((v) => `$[${JSON.stringify(v)}]`).join(', ')}]`
    // la liste ne se refait que si sa branche est celle qui est affichée (cf. currentBranch), comme toute autre liaison de la branche : ses deux repères sont des nœuds texte
    // retirés avec leur branche, que l'effet garde encore. La fermeture mémorisée porte la garde elle-même : quel que soit l'appelant, une liste dont la branche n'est plus
    // affichée n'est jamais refaite
    const shown   = currentBranch({ ctx, compiler: state })
    const ifShown = shown ? `${shown} && ` : ''
    // liste d'une branche `{success}` gardée (`{await … keep}`) qui lit la valeur de la branche ou `µpending` : ils changent sous la liste
    // à une relecture ; la fonction qui la refait les relit dans l'état du bloc (elle garderait ceux de la construction de la branche), et
    // l'effet suit leur nom (cf. keptValues)
    const kept   = keptValues({ ctx, compiler: state }, `${jsIterable} ${tplFn} ${updateFn}`)
    const reread = kept.map((e) => `${e.name} = _mjsThis._mjs_awaitStates.get('${e.id}').${e.field}; `).join('')
    const redo   = `this._mjs_updList('${id}', _mjs_forStart, _mjs_forEnd, ${jsIterable}, ${tplFn}, ${keyFnLit}, ${updateFn}, ${keyAttrLit});`
    ctx.updates.push(`{ const _mjsThis = this; const _mjs_forStart = __nodes['s-${id}']; const _mjs_forEnd = __nodes['e-${id}']; if(_mjs_forStart && _mjs_forEnd) { const _mjs_redo = () => { if(${ifShown}_mjs_forStart.parentNode && _mjs_forEnd.parentNode) ${reread ? `{ ${reread}${redo} }` : redo.slice(0, -1)}; }; (this._mjs_awaitFors ??= {})['${id}'] = _mjs_redo; _mjs_redo(); (this._mjs_awaitFresh ??= {})['${id}'] = ${readValues}; queueMicrotask(() => { this._mjs_awaitFresh['${id}'] = null; }); } }`)
    const tracked = [...trackedVars, ...kept.map((e) => e.key!)]
    // une ligne qui lit un texte traduit suit aussi la langue : l'effet rappelle la liste à chaque rendu complet
    if (tracked.length > 0 || MU_T_OR_LANG_RE.test(localUpdates)) registerEffect(`{ const _mjs_f = this._mjs_awaitFors && this._mjs_awaitFors['${id}']; const _mjs_w = this._mjs_awaitFresh; const _mjs_s = _mjs_w && _mjs_w['${id}']; if(_mjs_s) _mjs_w['${id}'] = null; const _mjs_v = ${readValues}; if(${ifShown}_mjs_f && !(_mjs_s && _mjs_s.every((_mjs_a, _mjs_i) => _mjs_a === _mjs_v[_mjs_i]))) _mjs_f(); }`, tracked)
    return `<script type='mjs/marker' mjs-l-t='s-${id}'></script><script type='mjs/marker' mjs-l-t='e-${id}'></script>`
  }

  state.counter += 1
  const wrapperLid = `l${state.counter}`
  const parent    = ctx.loops[ctx.loops.length - 1]
  const parentIdx = parent.index   // l'item du parent, lui, est lu par `discriminant()` plus bas — il n'entre plus seul dans le cacheId

  // un {for} imbriqué garde au composant le chemin général de sa réconciliation (`_mjs_noDestroyHooks = false`, cf. transpiler) : ses
  // lignes y sont détruites une à une, ce qui purge les caches des listes qu'elles portent, indexés par la clé de leur ligne (le vidage
  // groupé du mode direct les efface d'un bloc, sans cette purge). Ce chemin seulement : `hasDestroyHooks`, posé dès la pré-passe,
  // couperait aussi la pose initiale fusionnée de toutes les lignes du composant — insérées vides puis peuplées, leurs composants enfants
  // se réveilleraient sans leurs props et ce qu'ils écrivent alors dans une liaison à deux sens se perdrait
  state.hasNestedFor = true

  // #1 — Le cacheId de la loop imbriquée DOIT être stable à la réassignation du
  // parent. Avant : basé sur `parentItem._mjsId` (identité d'OBJET) → réassigner
  // le tableau parent (mêmes clés, nouveaux objets) générait un nouveau _mjsId →
  // nouveau cacheId → le cache interne n'était pas retrouvé → l'ancien contenu
  // restait DANS le DOM + le nouveau s'ajoutait (duplication "NEW x X").
  // Si le parent est keyé (`by X`), on indexe sur SA CLÉ (stable) ; sinon on
  // garde le fallback historique (_mjsId d'objet, ou l'index si primitif).
  // Occurrence sœur d'un correctif précédent — l'assign direct
  // `_mjsId ??= …` dupliquait ici le motif fautif (énumérable, crash sur objet
  // gelé) ; `this._mjs_mjsTag(...)` est désormais la SEULE source de vérité
  // (mjs_element.ts), partagée avec `_mjs_reconcileList`.
  //
  // #2 — Le cacheId doit aussi être unique PAR BRANCHE, à toute profondeur.
  // Avant : seul le parent DIRECT entrait
  // dans le discriminant. À TROIS niveaux, le grand-parent n'y était donc nulle
  // part : deux branches sœurs du grand-parent donnaient le MÊME cacheId à leur
  // boucle interne (le pire cas : un parent non keyé sur des CHAÎNES, qui
  // retombe sur l'index — 0, 1, 2… identiques d'une branche à l'autre). Les
  // branches se partageaient les mêmes cases de cache : au rafraîchissement,
  // `_mjs_reconcileList` retrouvait les clefs de la DERNIÈRE branche rendue,
  // déplaçait SES nœuds entre les ancres de la PREMIÈRE, et ceux que celle-ci
  // avait créés restaient en place, inconnus du cache → contenu affiché EN
  // DOUBLE, sans une ligne d'erreur (constaté en production, chaque valeur
  // rendue deux fois). Le discriminant compose donc
  // maintenant TOUTE la chaîne des ancêtres, séparateur `\x1f` (jamais dans une
  // clef réelle). Les ancêtres au-dessus du parent direct sont indexés par leur
  // `internalIndex` (`_mjs_idx_N`) et non par leur `index` : à ce niveau
  // d'imbrication, deux boucles qui n'ont pas nommé leur index s'appellent
  // toutes deux `index` et la plus proche masque l'autre.
  // Le cas courant à DEUX niveaux émet exactement le même code qu'avant.
  // Clé `by` du parent lue comme la clé de ligne (`_mjs_keyOf`, mjs_for.ts) : une valeur simple, ou un objet
  // qui s'écrit lui-même (date, tableau), par son texte ; un objet ordinaire ou une fonction par son identité.
  // Recollé en texte, un tel objet valait « [object Object] » pour toutes les lignes : leurs listes internes
  // partageaient un seul cache, et les éléments de l'une passaient dans l'autre.
  // Ligne d'objet sans clé réelle (`{for}` sans `by`, ou clé `by` vide : `null`, `undefined`) : la liste interne suit la ligne
  // elle-même, par l'identité de son repère de début (`_mjs_forStart`, propre à chaque ligne affichée, déplacé avec elle, purgé
  // avec elle). Deux lignes à clé vide, ou deux lignes du même objet, ne partagent jamais leurs lignes internes, et la ligne d'une
  // `Map`, gardée par la clé de la `Map` alors que sa paire `[clé, valeur]` est neuve à chaque passe, garde les siennes
  const discriminant = (loop: LoopInfo, idx: string) => loop.key
    ? `(${loop.item} != null && typeof ${loop.item} === 'object' ? ((_mjs_k) => _mjs_k == null ? this._mjs_mjsTag(_mjs_forStart) : Object(_mjs_k) !== _mjs_k || typeof _mjs_k === 'object' && !String(_mjs_k).startsWith('[object ') ? _mjs_k : this._mjs_mjsTag(_mjs_k))(${loop.item}.${loop.key}) : ${idx})`
    : `(typeof ${loop.item} === 'object' && ${loop.item} !== null ? this._mjs_mjsTag(_mjs_forStart) : ${idx})`

  const ancestors = ctx.loops.slice(0, -1).map(loop => `${discriminant(loop, loop.internalIndex)} + '\\x1f' + `).join('')
  const uniqueCacheId = `'${id}_' + ${ancestors}${discriminant(parent, parentIdx)}`

  // `_mjs_forStart`/`_mjs_forEnd`
  // (avant : `startNode`/`endNode` nus) : dans un {for} imbriqué, l'item/index de
  // la boucle PARENTE est en scope. Un item parent nommé `startNode` était shadowé
  // par l'ancre interne → itérable/clé/keyFn lisaient le MARQUEUR DOM (corruption
  // silencieuse). Cf. reserved-names-collision.test.ts ({for}+{for}).
  ctx.updates.push(`{ const _mjsThis = this; const _mjs_forStart = __nodes['s-${wrapperLid}']; const _mjs_forEnd = __nodes['e-${wrapperLid}']; if(_mjs_forStart && _mjs_forEnd) { this._mjs_updList(${uniqueCacheId}, _mjs_forStart, _mjs_forEnd, ${jsIterable}, ${tplFn}, ${keyFnLit}, ${updateFn}, ${keyAttrLit}); } }`)

  // Wrapper start/end markers : ces 2 placeholders matchent les ids
  // `s-${wrapperLid}` et `e-${wrapperLid}` dans le __paths du contexte parent
  // (loop, if, ou key). On émet `<!--$-->` × 2 ; l'attribution `s-`/`e-` se
  // fait dans le HTML brut via les pseudo-markers que extractPaths reconnaîtra.
  return `<script type='mjs/marker' mjs-l-t='s-${wrapperLid}'></script><script type='mjs/marker' mjs-l-t='e-${wrapperLid}'></script>`
}

// `µpending` lu par le code de ces nœuds (cf. litMuPending) : interpolations, conditions, parcours, `{key}`, `{const}`, attributs (cf.
// attrReadsPending) ; jamais un texte ni une chaîne
function readsPending(nodes: Node[]): boolean {
  return nodes.some((n) => {
    switch (n.type) {
      case 'expr':
      case 'const':
        return readsMuPending(n.expr)
      case 'key':
        return readsMuPending(n.expr) || readsPending(n.children)
      case 'for':
        return readsMuPending(n.iterable) || readsPending(n.children)
      case 'if':
        return n.branches.some((b) => readsMuPending(b.expr) || readsPending(b.children))
      case 'tag':
        return n.attrs.some(attrReadsPending) || readsPending(n.children)
      default:
        return false
    }
  })
}

// un attribut lit `µpending` : par son expression (`a={…}`, étalement), par la condition de son nom (`@class{…}`, `@style.x{…}`), par un
// gestionnaire ou une directive écrits entre guillemets (`@click="…"`), par les `{…}` d'une valeur écrite (`title="a {…}"`, `!{…}`) ; le
// code d'un gestionnaire d'événement se lit dans la grammaire du lot des gestionnaires (cf. litMuPending)
function attrReadsPending(a: Attr): boolean {
  const condition = /^@(?:class|style\.[\w-]+)\{([\s\S]*)\}$/.exec(a.name ?? '')
  const handler   = handlerCode(a)
  if (readsMuPending(a.expr, handler) || (condition && readsMuPending(condition[1]))) return true
  if (a.type !== 'static' || !a.val) return false
  if ((a.name ?? '').startsWith('@') && !condition) return readsMuPending(a.val, handler)
  let depth = 0
  let start = 0
  for (let i = 0; i < a.val.length; i++) {
    if (a.val[i] === '{' && depth++ === 0) start = i + 1
    else if (a.val[i] === '}' && depth > 0 && --depth === 0 && readsMuPending(a.val.slice(start, i))) return true
  }
  return false
}

// ============================================================================
// compileAwait — classé "struct" (block structurel always-run).
// `_mjs_updAwait` est idempotent : skip si la promise est inchangée.
// ============================================================================
export function compileAwait(node: Node, ctx: Ctx): string {
  state.counter += 1
  const id = `await${state.counter}`

  // Collecter les vars de l'expression promise.
  const varsAwait = node.expr ? getEffectVars(node.expr) : []
  for (const v of varsAwait) state.structVars.add(v)

  let tplPending = 'null'
  let tplSuccess = 'null'
  let tplError = 'null'

  const awaitCtx: Ctx = { ...ctx, type: 'await' }
  // `{await.keep …}` : pendant une relecture, la branche {success} affichée reste ; sa valeur et `µpending` y changent alors sous la
  // branche, et le runtime invalide leur nom (`~<id>`, `~<id>p`, cf. EntryScope.cle) au départ et à l'arrivée de la relecture
  const keep = node.keep === true

  // noms introduits par les branches (`{then data}`, `{catch err}`) : ils vivent dans la
  // fonction de branche, JAMAIS dans le corps d'un handler inline — un homonyme du
  // `<script>` doit donc y rester local (cf. state.templateLocals)
  for (const branch of node.branches) if (branch.arg) state.templateLocals.add(branch.arg)

  // `µpending` lu dans une branche : la valeur `_mjs_pnd` de sa portée (cf. runesAwait, utils.ts). Une branche qui ne le lit pas n'en
  // porte rien : ni nom, ni entrée de portée — son code est celui d'un bloc sans `µpending`, à l'octet
  const pendingBefore = runesAwait.pending
  let pendingRead     = false
  try {
    for (const branch of node.branches) {
      // l'argument de CETTE branche n'est en portée que dans SON corps — chaque branche a
      // donc son propre ensemble (un `{const}` d'une branche ne doit pas fuir dans la
      // suivante), posé sur l'axe `ctx.locals` hérité (cf. Ctx.locals)
      const branchLocals = new Set(awaitCtx.locals)
      if (branch.arg) branchLocals.add(branch.arg)
      const readsInProgress = readsPending(branch.children)
      runesAwait.pending    = readsInProgress
      pendingRead         ||= readsInProgress
      if (readsInProgress) branchLocals.add('_mjs_pnd')
      // la valeur de la branche, relue par ses gestionnaires dans l'état que le runtime garde
      // pour ce bloc (`_mjs_awaitStates`, clé `id`) : `data` pour `{success}`, `error` pour `{error}`
      const kept = keep && branch.type === 'success'
      const value: EntryScope[] = branch.arg && (branch.type === 'success' || branch.type === 'error')
        ? [{ kind: 'await', name: branch.arg, id, field: branch.type === 'success' ? 'data' : 'error', key: kept ? `~${id}` : undefined }]
        : []
      // `µpending`, vrai tant que la lecture de l'expression est en vol : il ne change sous la branche affichée que dans un {success} gardé
      if (readsInProgress) value.push({ kind: 'await', name: '_mjs_pnd', id, field: 'pending', key: kept ? `~${id}p` : undefined })
      const branchCtx: Ctx = { ...awaitCtx, locals: branchLocals, scope: awaitCtx.scope.concat(value), branch: { id, state: branch.type ?? 'pending' } }
      // Les branches `{await}` peuvent contenir des blocs structurels ({for},
      // {if}, {key}) qui poussent des updates dans `ctx.updates` référençant des
      // markers locaux (`s-forN`/`e-forN` via `__nodes`). On capture ces updates
      // générées par le walk de CETTE branche et on les inline dans sa createFn,
      // exécutées juste après la construction du fragment (où le param `success`
      // est en scope et `__nodes` pointe les refs locales fraîches).
      const preBranch = ctx.updates.length
      const bodyRaw = branch.children.map((c) => walk(c, branchCtx)).join('')
      const branchUpdatesRaw = ctx.updates.splice(
        preBranch,
        ctx.updates.length - preBranch
      )
      // les `{const}` de CETTE branche (CONST_DECL_PREFIX) sont HISSÉS en tête de sa fonction,
      // comme dans un `{for}` : laissés parmi les updates, ils n'étaient déclarés qu'APRÈS la
      // création des éléments, dans un bloc intérieur — une interpolation ou un attribut qui les
      // lisait levait « … is not defined » à l'affichage de la branche
      const constPrefix = branchUpdatesRaw.filter((u) => u.startsWith(CONST_DECL_PREFIX)).map((u) => u + ' ').join('')
      // cf. commentaire jumeau dans la branche non-root de
      // compileIf : un two-way `<select value=!{...}>` de CETTE branche doit
      // attendre les <option> d'un {for} imbriqué, comme `postUpdates` juste en dessous.
      const { updates: branchUpdates, deferred } = splitDeferredUpdates(branchUpdatesRaw.filter((u) => !u.startsWith(CONST_DECL_PREFIX)))
      // Chaque branche émet une createFn qui produit {fragment, refs}.
      // Si la branche a des updates structurelles, on force le mode impératif :
      // le body se termine par `return { fragment: _mjs_fr, refs: <obj> };`. On
      // transforme ce return final pour nommer l'objet `refs` (variable locale),
      // exécuter les updates de branche en mode `__nodes` local, puis retourner.
      // le fragment de CETTE branche ne voit jamais le `<svg>`/`<math>`
      // englobant (compilé séparément, cf. commentaire de Ctx.svgNs) : relayé
      // explicitement, sinon `document.createElement` reste posé en mode
      // impératif pour un `<circle>`/`<text>` réellement dans du SVG.
      const createBody = generateCreateFnBody(bodyRaw, {
        forceImperative: branchUpdatesRaw.length > 0,
        splitSelectPostUpdates: true,
        foreignNsRoot: ctx.svgNs ?? null,
        // cf. compileIf — forme compacte hors boucle seulement (sans effet en mode impératif,
        // qui n'a aucun chemin de nœud à écrire : il crée les éléments un par un).
        compactPaths: ctx.loops.length === 0,
      })
      // `postUpdates` (ex. `value` d'un `<select>` dont les
      // `<option>` viennent d'un `{for}` imbriqué) doivent courir APRÈS
      // `branchUpdates`, dans le MÊME bloc `__nodes` — jamais dans `head` (posées
      // là, trop tôt, avant que `branchUpdates` ne peuple les options réelles).
      const postUpdates = [...(createBody.postUpdates ?? []), ...deferred]
      let fnBody: string
      if (branchUpdates.length > 0 || postUpdates.length > 0) {
        const RET = 'return { fragment: _mjs_fr, refs: '
        const retIdx = createBody.body.lastIndexOf(RET)
        if (retIdx === -1) {
          // Garde-fou : forme de return inattendue → fallback sans updates
          // (le {for} ne serait pas réactif, mais pas de crash de compilation).
          fnBody = createBody.body
        } else {
          const head = createBody.body.slice(0, retIdx)
          // Tout ce qui suit `RET` jusqu'au `};` final est l'objet refs.
          const refsObjAndEnd = createBody.body.slice(retIdx + RET.length)
          const endIdx = refsObjAndEnd.lastIndexOf('};')
          const refsObj = refsObjAndEnd.slice(0, endIdx).trim()
          const tail = [...branchUpdates, ...postUpdates].join(' ')
          fnBody =
            `${head} const _mjs_refs = ${refsObj}; ` +
            `{ const __nodes = _mjs_refs; ${tail} } ` +
            `return { fragment: _mjs_fr, refs: _mjs_refs };`
        }
      } else {
        fnBody = createBody.body
      }
      fnBody = constPrefix + fnBody
      // `µpending` lu à la construction de la branche (un `{const}` compris) : déclaré en tête, relu dans l'état du bloc
      if (/(?<![\w$.])_mjs_pnd(?![\w$])/.test(fnBody)) fnBody = `let _mjs_pnd = this._mjs_awaitStates.get('${id}').pending; ${fnBody}`
      switch (branch.type) {
        case 'pending':
          tplPending = `() => { ${fnBody} }`
          break
        case 'success':
          tplSuccess = `(${branch.arg ?? 'data'}) => { ${fnBody} }`
          break
        case 'error':
          tplError = `(${branch.arg ?? 'err'}) => { ${fnBody} }`
          break
      }
    }
  }
  finally {
    runesAwait.pending = pendingBefore
  }

  if (ctx.type === 'for') {
    // un {await} imbriqué dans un {for} compilait en un placeholder
    // `<span class='mjs-error'>…</span>` VISIBLE des utilisateurs finaux en
    // production, sans la moindre erreur de compilation. Comme
    // `{const}` hors `{for}` (compileConst, même fichier) : on REFUSE plutôt
    // que dégrader. L'asymétrie {if}/{for} est VOULUE : un {await} imbriqué
    // dans un {if} à la racine (ctx.type reste 'root') continue de fonctionner.
    // La ligne citée est celle du mot-clé `{await}` lui-même : le parseur la pose
    // DIRECTEMENT sur le nœud `await` (parser/index.ts, bloc dans readViaTree),
    // même geste que tag/expr — jamais celle du premier descendant muni de `.line`,
    // un `{success}` posé sur une ligne ULTÉRIEURE ou tout texte intercalaire.
    throw new Error(t('generator.await-nested-forbidden', { line: node.cite ?? node.line ?? '?' }))
  }

  if (ctx.type !== 'root') {
    // un {await} dans la branche d'un autre {await}, ou dans un {if}/{key} de cette branche (le type du contexte se
    // transmet) : `_mjs_updAwait` lit ses ancres et garde son état par promesse sur le composant, où les nœuds d'une
    // branche ne sont pas encore quand ses mises à jour courent. Refusé comme celui d'un {for}, plutôt qu'un
    // <span class="mjs-error"> visible des visiteurs en production, sans la moindre erreur de construction
    throw new Error(t('generator.await-nested-in-await', { line: node.cite ?? node.line ?? '?' }))
  }

  // Site EXPR (promesse {await EXPR}) : passée en fonction, avec les variables qu'elle cite — le runtime ne la relit
  // qu'au premier rendu du bloc et quand l'une d'elles a été écrite. Relue à chaque passe, un appel (`charger()`)
  // rendait une promesse neuve à chaque rendu, et sa résolution, qui rend, en relançait une autre, sans fin
  // `µsignal` lu par l'expression : la lecture reçoit le signal que le runtime crée pour elle (`_mjs_sig`, un AbortController par lecture)
  runesAwait.signal = true
  let jsAwaitExpr: string
  try {
    jsAwaitExpr = cleanTemplateExpr(node.expr, state.externalVars, state.moduleName)
  }
  finally {
    runesAwait.signal = false
  }
  const readFn = /(?<![\w$.])_mjs_sig(?![\w$])/.test(jsAwaitExpr) ? `(_mjs_sig) => (${jsAwaitExpr})` : `() => (${jsAwaitExpr})`
  // un contexte (`§§cfg.lang`) ou la propriété d'un objet qui n'est pas une variable `$` (un état partagé :
  // `partage.req`) : relue aussi quand un état partagé lu par le composant change (`_u`, mjs_runes.ts)
  const readNames = /§§|(?<![\w$.µ])[A-Za-zµ_][\w$µ]*\s*(?:\?\.|\.|\[)/.test(node.expr ?? '') ? [...varsAwait, '_u'] : varsAwait
  const readVars = readNames.length > 0 ? `, [${readNames.map((v) => `'${v}'`).join(',')}]` : keep ? ', null' : ''
  // composant construit pour le développement : chargé sur un cœur construit sans une option qu'il emploie (le cœur de production d'une
  // autre construction, qui n'en a gardé que pour ses unités), il dit l'option ignorée, une fois par page — la marque que pose son bloc
  // balisé (`µ._mjs_awaitHasKeep`, `…Pending`, `…Signal`, mjs_await.ts) y manque. Rien en production, ni pour un bloc sans option
  const options = [[keep, 'Keep', '{await.keep}'], [pendingRead, 'Pending', 'µpending'], [readFn.startsWith('(_mjs_sig)'), 'Signal', 'µsignal']] as const
  const checked = state.devWarnings ? options.filter(([read]) => read).map(([, mark, option]) => `µ._mjs_awaitHas${mark} ??= (console.warn(${JSON.stringify(t('generator.await-option-missing', { option, moduleName: state.moduleName }))}), 0); `).join('') : ''
  state.awaitBlocks.push({ id, expr: node.written ?? node.expr ?? '', keep })
  ctx.updates.push(`${checked}this._mjs_updAwait('${id}', ${readFn}, ${tplPending}, ${tplSuccess}, ${tplError}${readVars}${keep ? ', 1' : ''});`)
  return `<script type='mjs/marker' mjs-t='s-${id}'></script><script type='mjs/marker' mjs-t='e-${id}'></script>`
}

// ============================================================================
// compileKey — classé "struct" (block structurel always-run, idempotent
// via cache `_mjs_key_cache`).
// ============================================================================
export function compileKey(node: Node, ctx: Ctx): string {
  state.counter += 1
  const id = `k${state.counter}`
  const rawExpr = node.expr ?? ''

  // Collecter les vars de l'expression-clé.
  const keyVars = getEffectVars(rawExpr.toString())
  for (const v of keyVars) state.structVars.add(v)

  // Site EXPR (expression {key EXPR}).
  const cleanExpr = cleanTemplateExpr(rawExpr.toString(), state.externalVars, state.moduleName)

  if (ctx.type !== 'root') {
    const preSize = ctx.updates.length
    // un `{const}` de CE bloc `{key}` ne vit que dans son corps (cf. Ctx.locals)
    const blockCtx: Ctx = { ...ctx, inBlock: true, locals: new Set(ctx.locals), scope: [...ctx.scope] }
    const innerHtmlRaw = node.children.map((c) => walk(c, blockCtx)).join('')
    const branchUpdatesRaw = ctx.updates.splice(preSize, ctx.updates.length - preSize)
    // cf. commentaire jumeau dans la branche non-root de
    // compileIf : un two-way `<select value=!{...}>` de CETTE branche doit
    // attendre les <option> d'un {for} imbriqué, comme `postUpdates` juste en dessous.
    const { updates: branchUpdates, deferred } = splitDeferredUpdates(branchUpdatesRaw)

    // createFn(item, index) → {fragment, refs}.
    // `compactPaths` : cf. compileIf — forme compacte hors boucle seulement.
    const createBody = generateCreateFnBody(innerHtmlRaw, { splitSelectPostUpdates: true, compactPaths: ctx.loops.length === 0, foreignNsRoot: ctx.svgNs ?? null })
    // `postUpdates` (ex. `value` d'un `<select>` peuplé par un
    // `{for}` imbriqué) rejouées APRÈS `branchUpdates`, même `__nodes` (mergé
    // par `_mjs_updItemIf` juste avant, comme pour `compileIf` non-root).
    const postUpdates = [...(createBody.postUpdates ?? []), ...deferred]
    // les `{const}` du bloc sont déclarés en tête de sa fonction de création (un élément construit un par un y pose déjà ses valeurs,
    // qui les lisent) et en tête de ses mises à jour, dans un bloc commun : chaque mise à jour a le sien, et une déclaration enfermée
    // dans le sien (`{ const d = … }`) n'était plus en portée pour les mises à jour qui la lisent. Le bloc commun laisse aussi la
    // clé, lue juste avant, hors de la portée des déclarations
    const decls           = branchUpdates.filter((u) => u.startsWith(CONST_DECL_PREFIX)).map((u) => u + ' ').join('')
    const updates         = [...branchUpdates.filter((u) => !u.startsWith(CONST_DECL_PREFIX)), ...postUpdates].map((u) => `{ ${u} }`).join(' ')
    const wrappedChildren = decls === '' ? updates : `{ ${decls}${updates} }`

    // `_mjs_keyStart`/`_mjs_keyEnd`/`_mjs_keyVal` (avant : `startNode`/`endNode`/`v`
    // nus) : `cleanExpr` est le texte de `{key EXPR}` tel qu'écrit par l'utilisateur
    // (ex. `{for v in $rows}{key v.id}` → cleanExpr = "v.id"), embarqué dans CE
    // MÊME scope. Avec l'ancien nom `v` : `const v = v.id` — auto-référence en
    // TDZ, CRASH immédiat (« Cannot access 'v' before initialization ») dès que
    // l'item de boucle s'appelait `v`. Avec `startNode`/`endNode` comme nom
    // d'item (mot anglais plausible) : lecture SILENCIEUSE de l'ancre interne au
    // lieu de l'item (corruption sans erreur). Régression verrouillée par
    // tests/reserved-names-collision.test.ts.
    // une ancre neuve n'a pas encore posé sa clé : c'est ce repère (`_mjs_key_set`), non la valeur `undefined`, qui dit qu'il reste à construire (un `{key}` de valeur `undefined`
    // construit son contenu comme les autres, en tout lieu)
    const keyUpdate = `{ const _mjs_keyStart = __nodes['s-${id}']; const _mjs_keyEnd = __nodes['e-${id}']; if (_mjs_keyStart && _mjs_keyEnd) { const _mjs_keyVal = ${cleanExpr}; if (!_mjs_keyStart._mjs_key_set || _mjs_keyVal !== _mjs_keyStart._mjs_old_key) { _mjs_keyStart._mjs_key_set = 1; _mjs_keyStart._mjs_old_key = _mjs_keyVal; this._mjs_updItemIf(_mjs_keyStart, _mjs_keyEnd, () => { ${decls}${createBody.body} }, __nodes); } ${wrappedChildren} } }`
    ctx.updates.push(keyUpdate)
    // dans une branche `{await}`, la clé suit ses variables comme la condition d'un `{if}` (cf. compileIf) : l'effet refait le contenu quand elle change
    const tracked = ctx.type === 'await' ? followedByBlock({ ctx, compiler: state }, cleanExpr, `${cleanExpr} ${decls}${createBody.body} ${wrappedChildren}`, keyVars) : null
    if (tracked) {
      registerEffect(`{ const __nodes = this._mjs_nodes; const _mjs_keyStart = __nodes['s-${id}']; const _mjs_keyEnd = __nodes['e-${id}']; if (_mjs_keyStart && _mjs_keyEnd && ${tracked.guard}) { ${tracked.prelude}const _mjs_keyVal = ${cleanExpr}; if (_mjs_keyVal !== _mjs_keyStart._mjs_old_key) { _mjs_keyStart._mjs_key_set = 1; _mjs_keyStart._mjs_old_key = _mjs_keyVal; this._mjs_flip = ~~this._mjs_flip + 1; try { this._mjs_updItemIf(_mjs_keyStart, _mjs_keyEnd, () => { ${decls}${createBody.body} }, __nodes); ${wrappedChildren} } finally { this._mjs_flip--; } } } }`, tracked.vars)
    }

    return `<script type='mjs/marker' mjs-l-t='s-${id}'></script><script type='mjs/marker' mjs-l-t='e-${id}'></script>`
  }

  const preSize = ctx.updates.length
  // idem branche non-root : ensemble de locaux isolé par bloc (cf. Ctx.locals)
  const blockCtx: Ctx = { ...ctx, inBlock: true, locals: new Set(ctx.locals), scope: [...ctx.scope] }
  // garde toujours vraie : seul but, faire noter par `registerEffect` les jumelles du contenu
  // (cf. `effectTwins`), comme la garde de branche d'un `{if}`
  state.effectGuardStack.push('true')
  let innerHtmlRaw: string
  try {
    innerHtmlRaw = node.children.map((c) => walk(c, blockCtx)).join('')
  } finally {
    state.effectGuardStack.pop()
  }
  // Idem au root : createFn() → {fragment, refs}.
  // `compactPaths` : cf. compileIf — forme compacte hors boucle seulement.
  const createBody = generateCreateFnBody(innerHtmlRaw, { splitSelectPostUpdates: true, compactPaths: ctx.loops.length === 0, foreignNsRoot: ctx.svgNs ?? null })

  // Régression (fil d'Ariane du tuto) — MÊME mécanique que
  // `branchExecBlock` de `compileIf` ci-dessus, et que la branche non-root
  // juste au-dessus : les updates du CONTENU sont retirées de `ctx.updates`
  // et rejouées EN LIGNE, juste après `_mjs_updKey`. Sans ça, elles ne vivaient
  // qu'en effets par-variable — et un bloc reconstruit par une passe
  // structurelle REPORTÉE (garde `_mjs_struct_dispatched_in_tick` : la 2e écriture
  // du même tick reporte la passe en microtask, mais ses effets, eux, tournent
  // tout de suite) restait vide À VIE, plus aucune variable ne mutant derrière.
  // Les copies enregistrées par `registerEffect` pendant le walk, elles, sont
  // intactes : la réactivité ultérieure passe toujours par `_mjs_effectsByVar`.
  const childUpdates = ctx.updates.splice(preSize, ctx.updates.length - preSize)
  // cf. commentaire jumeau dans la branche non-root ci-dessus :
  // `postUpdates` rejouées APRÈS `childUpdates`, même `__nodes` (mergé par
  // `_mjs_updKey` juste avant).
  const postUpdates = createBody.postUpdates ?? []
  // Une mise à jour dont le code est identique à un effet enregistré pendant le walk (le jumeau)
  // n'est PAS rejouée à chaque passe : l'effet la joue au montage et à chaque changement de sa
  // variable. Elle n'est posée ici qu'à la (re)création du bloc après le montage, pour les valeurs
  // dont la variable n'a pas bougé (cf. `compileIf`). L'ordre d'origine est gardé.
  // la jumelle qui livre une prop à un composant est jouée par `_mjs_updKey` avant l'insertion du bloc (cf. CHILD_PROP)
  let hasTwin           = false
  const kids: string[]  = []
  const wrappedChildren = [
    ...childUpdates.map((u) => {
      const twin = state.effectTwins.has(u) && !/_mjs_updIf|_mjs_updFor|_mjs_updAwait|_mjs_updKey|_updElement|_mjs_td|µ\._mjs_fx\(|_mjs_intro|_mjs_outro/.test(u)
      if (twin && CHILD_PROP.test(u)) {
        kids.push(`{ ${u} }`)
        return ''
      }
      if (twin) hasTwin = true
      return twin ? `if (_mjs_nb) { ${u} }` : `{ ${u} }`
    }),
    ...postUpdates.map((u) => `{ ${u} }`),
  ].filter((u) => u !== '').join(' ')
  const kb = kids.length > 0 ? `, () => { ${kids.join(' ')} }` : ''

  // V2 — pas de condition. `_mjs_updKey` est idempotent via `_mjs_key_cache` ; il rend vrai quand
  // il reconstruit : `_mjs_nb` = bloc recréé après le montage. Un repère `<@element>` du bloc recréé reprend la dernière balise
  // demandée (µ._mjs_dynRe, cf. `compileIf`)
  const dynRe     = /\smjs-el=/.test(createBody.body) ? ' µ._mjs_dynRe(this);' : ''
  const keyUpdate = hasTwin
    ? `{ const _mjs_nb = this._mjs_updKey('${id}', ${cleanExpr}, () => { ${createBody.body} }${kb}) && !this._mjs_initial_render;${dynRe} ${wrappedChildren} }`
    : `this._mjs_updKey('${id}', ${cleanExpr}, () => { ${createBody.body} }${kb});${dynRe}${wrappedChildren ? ' ' + wrappedChildren : ''}`
  ctx.updates.splice(preSize, 0, keyUpdate)

  return `<script type='mjs/marker' mjs-t='s-${id}'></script><script type='mjs/marker' mjs-t='e-${id}'></script>`
}

// ============================================================================
// compileConst — `{const NOM = EXPR}` (≡ `{@const}` Svelte).
//
// Émet AUCUN nœud DOM (chaîne vide). Pousse à la place une « update » marquée
// `CONST_DECL_PREFIX` qui sera reconnue par `compileFor` : la déclaration est
// HISSÉE en tête du corps `updateFn` (avant les updates frères), SANS wrapper
// `{ … }` afin que `NOM` reste visible des interpolations qui le consomment
// (`{NOM}` plus loin dans le même `{for}`).
//
// Réactivité : les `$x` de l'EXPR sont ajoutés à `structVars`. Comme un `{for}`
// est structurel (re-joué par `_mjs_renderStruct` → `_mjs_reconcileList` rappelle
// `updateFn` par item), muter un `$x` de l'EXPR re-calcule `NOM` et re-applique
// les interpolations qui en dépendent. Sans loop parent, l'effet ne serait pas
// recalculé hors mount (voir restriction ci-dessous).
// ============================================================================
export function compileConst(node: Node, ctx: Ctx): string {
  const name = (node.name ?? '').toString().trim()
  // même raison que pour `{for}` et `{await}` : le `{const}` est hissé en tête du CORPS DE
  // BOUCLE du template, jamais dans un handler inline — un homonyme du `<script>` doit y
  // rester local, sous peine d'écrire dans la variable du script en croyant toucher celle-ci
  if (name) state.templateLocals.add(name)
  const rawExpr = (node.expr ?? '').toString()
  // Site EXPR (expression {const NOM = EXPR}).
  const jsExpr = cleanTemplateExpr(rawExpr, state.externalVars, state.moduleName)

  // Les vars de l'EXPR pilotent un recalcul → structurel (re-joue le `{for}`).
  for (const v of getEffectVars(rawExpr)) state.structVars.add(v)

  if (ctx.loops.length > 0 || ctx.type === 'await') {
    // Dans un `{for}` (ou une branche `{await}` : corps construit puis updates
    // inlinées en mode `__nodes` local) → déclaration hissée en tête de corps.
    ctx.updates.push(`${CONST_DECL_PREFIX}const ${name} = ${jsExpr};`)
    // … et le nom n'est en portée que dans ce corps-là : les gestionnaires qui suivent
    // DANS ce bloc le voient (recalculé en tête de leur code, cf. EntryScope), ceux d'à
    // côté gardent leur var du `<script>` (cf. Ctx.locals)
    if (name) {
      ctx.locals.add(name)
      ctx.scope.push({ kind: 'const', name, raw: rawExpr, js: jsExpr })
    }
    return ''
  }

  // LIMITATION V1 (volontaire) — `{const}` au NIVEAU RACINE (hors `{for}` /
  // `{await}`) n'est PAS supporté. Au root, chaque update est un statement
  // INDÉPENDANT (enregistré dans `_mjs_effectsByVar` / `mountOnly`, sans scope
  // partagé) : un `const NOM` déclaré dans un effect serait invisible de
  // l'effect frère qui lit `{NOM}` → ReferenceError silencieuse. On rejette
  // explicitement avec une alternative idiomatique plutôt que d'émettre du
  // code cassé.
  throw new Error(t('generator.const-outside-for', { name, expr: rawExpr }))
}

// ============================================================================
// compile : entrypoint
// ============================================================================
export interface CompileOpts {
  // le texte du <script>, lu pour les valeurs de départ écrites en clair (cf. startValues)
  startScript?: string
  // les noms que le <script>, le <script module> et les imports fournissent aux gestionnaires (cf. ResetOpts)
  handlerScope?: Set<string> | null
  // les constantes du <script> et du <script module> (cf. ResetOpts)
  handlerConsts?: string[]
  // la langue du <script> du composant (cf. ResetOpts)
  scriptLang?: string
  analyzer?: any
  externalVars?: string[]
  /** Best-effort, cf. ResetOpts.moduleName (state.ts) — enrichit les erreurs. */
  moduleName?: string
  /** coupe individuellement les avertissements `syntax`/`events` émis ici (parseur compris,
   *  cf. src/diagnostics.ts) — transmis PAR APPEL, jamais un état partagé. */
  lint?: LintToggles
  colorsEnabled?: boolean
  /** cf. ParseDiag.autoSkeleton */
  autoSkeleton?: boolean
  /** cf. ParseDiag.models */
  models?: { dev?: Record<string, string[]>, core?: Record<string, string[]> }
  /** cf. ParseDiag.guarded */
  guarded?: string[]
  /** cf. ParseDiag.guardSilent */
  guardSilent?: boolean
  /** cf. ResetOpts.instanceProps */
  instanceProps?: string[]
  /** cf. ParseDiag.firstLine : la ligne du fichier où commence le HTML reçu (1 par défaut). Le HTML d'un composant est
   *  rogné en tête, ses lignes vides ne comptent plus : le parseur la compte et la pose sur chaque nœud (`Node.line`) ;
   *  le générateur porte celle de chaque balise et de chaque texte jusqu'à la construction du gabarit (lineMark,
   *  paths.ts), où ses messages la citent */
  firstLine?: number
  /** cf. ParseDiag.hostLines : la ligne du composant de chaque ligne du HTML reçu, quand des partiels y sont versés */
  hostLines?: number[]
  /** cf. ParseDiag.lineCites : la ligne telle qu'un message du parseur la cite, partiel compris */
  lineCites?: Array<number | string | MixedLine>
  /** cf. ResetOpts.devWarnings */
  devWarnings?: boolean
  /** cf. ResetOpts.serverRendered */
  serverRendered?: boolean
  /** cf. ResetOpts.derivedPrecise */
  derivedPrecise?: boolean
  /** cf. ResetOpts.proxy */
  proxy?: boolean
  /** cf. ParseDiag.projectTags : reçoit les balises des composants du projet (contrôle propUnknown du build) */
  projectTags?: ProjectTagSeen[]
  /** cf. ParseDiag.links : reçoit les liens `#/…` des éléments `<a>` (contrôle routeUnknown du build) */
  links?: LinkSeen[]
}

export type CompileResult = [
  surgicalHtml: string,
  updates: string[],
  events: Record<string, Record<string, EventRoute>>,
  inlines: string[],
  effectsByVar: Map<string, string[]>,
  /** Vars qui pilotent les blocs structurels. Émise comme tableau
   * dans le template ; runtime skip `_mjs_renderStruct` si la var muée n'est
   * pas dedans. Si vide → `_mjs_renderStruct` toujours skipé (sauf mount). */
  structVars: Set<string>,
  mountOnlyEffects: string[],
  /** Types d'événements à enregistrer en listener `passive` (touch/wheel sans
   * preventDefault) — scroll fluide sans bloquer le thread principal. */
  passiveEvents: string[],
  /** références `<@nom>`/`<mjs-nom>`/`<mjs-core-nom>` (notation
   * unique, `<@mjs-nom>` est une erreur de migration) collectées par le
   * parseur (resolveTagName) ; résolues APRÈS le manifeste complet par le
   * bundler (post-passe, jamais ici — un seul fichier ne connaît pas les
   * autres). */
  tagRefs: TagRef[],
  /** Noms que le template introduit lui-même — variable et index de chaque `{for}`,
   * nom d'un `{const}`, argument d'un `{then}`/`{catch}` — cf. CompilerState.templateLocals. */
  templateLocals: Set<string>,
  /** liaisons two-way vers un composant enfant, root uniquement :
   * même code que leur effect jumeau (dans `updates`/`effectsByVar`), mais
   * rejoué SYNCHRONEMENT dans `init()`, avant tout connectedCallback (cf.
   * state.initialPropBinds). */
  initialPropBinds: string[],
  /** Dépendances DIRECTES de balises (noms SANS préfixe `mjs-`, triés par point
   * de code) — cf. collectDirectComponentDeps ci-dessus. Alimente la table de
   * préchargement du manifeste (writeManifest, bundler/index.ts) ; ne résout
   * PAS les noms contre le manifeste (un nom qui ne compile jamais reste ici,
   * filtré côté bundler, seul point qui connaît tous les composants). */
  componentDeps: string[],
  /** Locaux de gabarit EN PORTÉE de chaque gestionnaire de `inlines` (même index) :
   *  variable/index des `{for}` englobants, argument de branche `{await}`, `{const}` du
   *  bloc courant. Cf. CompilerState.inlineLocals.
   *  EN FIN de tuple, jamais au milieu : ce résultat se lit PAR POSITION (`out[4]`, les
   *  destructurations à trous, l'export public `compileHtml`), un élément inséré au
   *  milieu décale tous ceux d'après — les lecteurs positionnels cassent en silence. */
  inlineLocals: string[][],
  /** vars qui posent une prop sur un composant enfant, hors ligne de `{for}` (cf. CompilerState.propVars) ; en fin de tuple, comme le précédent */
  propVars: Set<string>,
]

// avertissement compile-time (jamais bloquant) : `#{…}` (interpolation
// Civet, réservée au <script>) collée dans un attribut STATIQUE ne s'exécute
// pas, la valeur reste littérale à l'écran — piège fréquent et jusqu'ici
// silencieux. Ciblé sur `type === 'static'` uniquement : jamais les nœuds
// texte (une page de doc y montre légitimement du code Civet), jamais les
// valeurs déjà dynamiques `{…}` (type 'dynamic', aucun risque de confusion).
// Parcours dédié — PAS le `walk()` de codegen (appelé 2× en pre-pass/real-pass,
// un hook là-dedans doublerait l'avertissement) : un seul passage sur l'AST
// brut, juste après le parse. Le message cite la ligne de la balise (`Node.line`)
function warnCivetInterpolationInAttrs(node: Node, moduleName: string | undefined, lint?: LintToggles, colorsEnabled = false): void {
  for (const attr of node.attrs) {
    if (attr.type === 'static' && attr.val && attr.val.includes('#{')) {
      const value = attr.val.length > 60 ? attr.val.slice(0, 60) +'…' : attr.val
      const line = typedLine('syntax', t('generator.interpolation-civet-attribute', { module: moduleName ?? '', attr: attr.name ?? '', value: value, line: node.cite ?? node.line ?? '' }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    }
  }
  for (const child of node.children) warnCivetInterpolationInAttrs(child, moduleName, lint, colorsEnabled)
  for (const branch of node.branches) {
    for (const child of branch.children) warnCivetInterpolationInAttrs(child, moduleName, lint, colorsEnabled)
  }
}

// attributs booléens HTML : leur seule PRÉSENCE vaut vrai, quelle que soit la valeur écrite
const HTML_BOOLEAN_ATTRS = new Set(['allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default',
  'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule',
  'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected'])

// balises dont le texte s'affiche tel qu'écrit (code montré, champ) : un `#` en tête de ligne y
// est voulu — dont le bloc de code du module cœur (`<@@code>` donne `mjs-core-code`) et celui d'un
// composant du développeur (`<@code>` donne `mjs-code`), où un extrait shell, Civet ou Python en a
const LITERAL_TEXT_TAGS = new Set(['pre', 'code', 'kbd', 'samp', 'textarea', 'script', 'style', 'mjs-code', 'mjs-core-code'])

// avertissements compile-time (jamais bloquants) sur deux pièges du HTML qui ne cassent rien au
// build et trompent à l'écran — même parcours dédié que warnCivetInterpolationInAttrs, un seul
// passage sur l'AST brut :
//   - `disabled="false"` sur une balise NATIVE (un composant, lui, lit `"false"` comme false) : la
//     balise reste désactivée ;
//   - une ligne de texte qui commence par `#` suivi d'un autre `#`, ou d'un blanc puis d'un texte (la
//     forme d'un commentaire Civet/Coffee), dans un nœud texte qui court sur plusieurs lignes : elle
//     part à l'écran. Un `#` seul dans sa cellule (`<th>#</th>`, ou sur sa propre ligne), `#1`, un
//     `<pre>`, un bloc de code : rien
// chaque message cite la ligne (`Node.line`, celle du fichier) : celle de la balise, ou celle du `#` lui-même
function warnSilentHtmlTraps(node: Node, moduleName: string | undefined, lint?: LintToggles, colorsEnabled = false, literal = false): void {
  const name = (node.name ?? '').toLowerCase()
  if (node.type === 'tag' && !name.startsWith('mjs-') && !name.startsWith('@')) {
    for (const attr of node.attrs) {
      const attrName = (attr.name ?? '').toLowerCase()
      if (attr.type !== 'static' || !HTML_BOOLEAN_ATTRS.has(attrName) || !/^\s*false\s*$/i.test(String(attr.val ?? ''))) continue
      const line = typedLine('syntax', t('generator.attribute-boolean-false', { module: moduleName ?? '', tag: name, attr: shownName(attrName), line: node.cite ?? node.line ?? '' }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    }
  }
  if (node.type === 'text' && !literal && node.content && node.content.includes('\n')) {
    // le parseur pose `line` sur le premier caractère non blanc du texte : la première ligne du nœud
    // se retrouve en retirant les sauts de ligne du blanc de tête ; sans `line`, la ligne n'est pas citée
    const firstLineNo = node.line === undefined ? undefined : node.line - (node.content.match(/^\s*/)![0].match(/\n/g)?.length ?? 0)
    for (const [offset, srcLine] of node.content.split('\n').entries()) {
      if (!/^\s*#(?:#|[ \t]+\S)/.test(srcLine)) continue
      const raw     = srcLine.trim()
      const excerpt = raw.length > 60 ? raw.slice(0, 60) + '…' : raw
      const line    = typedLine('syntax', t('generator.hash-sign-in-html', { module: moduleName ?? '', excerpt: excerpt, line: firstLineNo === undefined ? '' : firstLineNo + offset }), lint)
      if (line !== null) printDiagnostic(line, colorsEnabled)
    }
  }
  const childLiteral = literal || (node.type === 'tag' && LITERAL_TEXT_TAGS.has(name))
  for (const child of node.children) warnSilentHtmlTraps(child, moduleName, lint, colorsEnabled, childLiteral)
  for (const branch of node.branches) {
    for (const child of branch.children) warnSilentHtmlTraps(child, moduleName, lint, colorsEnabled, childLiteral)
  }
}

// collectDirectComponentDeps — parcourt l'AST déjà parsé (post raccourcis <@nom>,
// post <@include>, post macros <@element>/<@module> — ast est celui RÉELLEMENT
// compilé) et liste les noms de composants référencés LITTÉRALEMENT (balises
// mjs-x, `x` sans le préfixe) — hors <pre>/<code> (exemples de code affichés
// comme texte, jamais de vraies dépendances). Les commentaires HTML n'entrent
// jamais dans l'AST comme balises (readViaTree, parser/index.ts : aucun nœud,
// du texte dans un <textarea> ou un <title>) : rien à exclure ici pour
// eux. `<@element>`/`<@module>` restent des noms réservés (AT_RESERVED_NAMES) —
// resolveTagName ne pousse jamais `mjs-element`/`mjs-module`, donc leur cible
// dynamique n'apparaît jamais dans cette liste. `mjs-core-x` (module cœur, `<@@x>`)
// y entre sous `core-x`, sa clé au manifeste.
// Consommée par le bundler pour la table de préchargement (writeManifest) —
// jamais pour la RÉSOLUTION elle-même (resolveTagShortcuts reste seul juge de
// ce qui compile).
// `mark` : `?`, la balise est sous une branche qui peut être fermée au démarrage (un {if} et ses branches {else} ; ni {for} ni {await},
// presque toujours affichés) ; `~`, sous des branches fermables que les valeurs de départ du <script> ouvrent toutes (cf. openBranch) ;
// rien hors de ces branches. Le nom entre préfixé de sa marque (dépendance de branche), retiré si la même balise est aussi écrite sous une
// marque plus ouverte (rien, puis `~`, puis `?`). Le bundler lit `~` comme ouvert sous `blocks.preload` "idle", comme `?` sous "off"
function collectDirectComponentDeps(node: Node, insideRawBlock: boolean, out: Set<string>, mark: '' | '~' | '?' = '', values: Map<string, unknown> = new Map()): void {
  const nameLower = node.type === 'tag' ? (node.name ?? '').toLowerCase() : ''
  if (node.type === 'tag' && !insideRawBlock && nameLower.startsWith('mjs-')) {
    out.add(mark + (node.name as string).slice('mjs-'.length))
  }
  const childInsideRawBlock = insideRawBlock || nameLower === 'pre' || nameLower === 'code'
  const blockCloses         = node.type === 'if'
  const open                = blockCloses ? openBranch(node, values) : undefined
  for (const child of node.children) collectDirectComponentDeps(child, childInsideRawBlock, out, blockCloses ? '?' : mark, values)
  node.branches.forEach((branch, k) => {
    const branchMark = !blockCloses ? mark : (k === open && mark !== '?' ? '~' : '?')
    for (const child of branch.children) collectDirectComponentDeps(child, childInsideRawBlock, out, branchMark, values)
  })
}

// valeurs de départ écrites en clair au premier niveau du <script> (`$x = …` ou `$x ?= …`, un littéral : true, false, null, undefined,
// un nombre, un texte sans interpolation) ; une variable écrite deux fois au premier niveau, ou sans littéral, n'en a pas. Elles servent à
// deviner, à la construction, la branche d'un {if} ouverte au départ : une devinette fausse (un parent, un µmount qui change la valeur avant
// l'affichage) ne coûte qu'un fichier préchargé pour rien, jamais un affichage faux
const START_LITERAL = /^(true|false|null|undefined|-?\d+(?:\.\d+)?|'[^'\\]*'|"[^"\\#]*")$/

function literalValue(text: string): unknown {
  if (text === 'true' || text === 'false') return text === 'true'
  if (text === 'null' || text === 'undefined') return null
  return /^['"]/.test(text) ? text.slice(1, -1) : Number(text)
}

function startValues(script: string): Map<string, unknown> {
  const lines  = script.split('\n').filter(l => l.trim() !== '' && !/^(#|\/\/)/.test(l.trim()))
  const margin = Math.min(...lines.map(l => l.length - l.trimStart().length))
  const values = new Map<string, unknown>()
  const unsure = new Set<string>()
  for (const line of lines) {
    const m = line.length - line.trimStart().length === margin ? /^\$(\w+)\s*\??=(?!=)\s*(.*?);?\s*$/.exec(line.trim()) : null
    if (!m) continue
    if (values.has(m[1]) || !START_LITERAL.test(m[2])) unsure.add(m[1])
    values.set(m[1], START_LITERAL.test(m[2]) ? literalValue(m[2]) : null)
  }
  for (const name of unsure) values.delete(name)
  return values
}

// une condition de {if} sur une valeur de départ : `$x`, `not $x`, `!$x`, `$x is|isnt|==|!=|===|!== <littéral>` (deux valeurs du même
// type) ; undefined quand elle ne se décide pas
function decideCondition(expr: string | null | undefined, values: Map<string, unknown>): boolean | undefined {
  if (expr == null) return true
  const e = expr.trim()
  let m = /^(not\s+|!\s*)?\$(\w+)$/.exec(e)
  if (m) return values.has(m[2]) ? !values.get(m[2]) === !!m[1] : undefined
  m = /^\(?\$(\w+)\)?\s*(isnt|is|===|!==|==|!=)\s*(.+)$/.exec(e)
  if (!m || !values.has(m[1]) || !START_LITERAL.test(m[3].trim())) return undefined
  const a = values.get(m[1])
  const b = literalValue(m[3].trim())
  if (typeof a !== typeof b) return undefined
  return (a === b) === /^(is|===|==)$/.test(m[2])
}

// la branche d'un {if} ouverte au départ quand chaque condition jusqu'à la première vraie se décide : son rang, -1 quand aucune ne l'est ;
// undefined quand la chaîne ne se décide pas (toutes ses branches restent fermables)
function openBranch(node: Node, values: Map<string, unknown>): number | undefined {
  if (values.size === 0) return undefined
  for (let k = 0; k < node.branches.length; k++) {
    const r = decideCondition(node.branches[k].expr, values)
    if (r === undefined) return undefined
    if (r) return k
  }
  return -1
}

// avertissement compile-time (jamais bloquant) :
// `µemit 'nom', e` dans un handler INLINE (`@click={…}`) relaie l'ÉVÉNEMENT DOM
// reçu tel quel plutôt que sa charge (`e.data`) — le parent lit `e.data` sur le
// CustomEvent émis et trouve `undefined`, aucune erreur nulle part. Ciblé aux
// handlers INLINE seulement : le générateur SYNTHÉTISE lui-même leur signature
// `(e, el) => {…}` (state.inlines.push, attributes/index.ts) — le nom `e` du
// 1er paramètre y est donc FIABLE À 100 %, contrairement à une méthode
// `<script>` nommée par le dev (nom de paramètre libre, hors périmètre).
//
// Scan textuel DÉDIÉ sur `state.inlines` (assemblé une seule fois pour le real
// pass — reset juste avant, cf. le commentaire sur le reset d'inlines plus haut) : PAS le
// walk() de codegen (double pre-pass/real-pass, un hook là-dedans doublerait
// l'avertissement), même famille de garde que warnCivetInterpolationInAttrs.
const RAW_EMIT_RE = /µ\.?\s*emit\s*\(?\s*([^,()\n]*),\s*e\s*(?=[),\n;]|$)/g

// `lineNumbers` : la ligne de la balise de chaque gestionnaire de `inlines` (même index)
function warnRawEventEmit(inlines: string[], lineNumbers: Array<number | undefined>, moduleName: string | undefined, lint?: LintToggles, colorsEnabled = false): void {
  for (const [offset, body] of inlines.entries()) {
    RAW_EMIT_RE.lastIndex = 0
    const m = RAW_EMIT_RE.exec(body)
    if (!m) continue
    const eventName = m[1].trim().replace(/^['"]|['"]$/g, '')
    const lineNo = lineNumbers[offset] ?? ''
    const line = typedLine('events', t('generator.emit-event-raw', { module: moduleName ?? '', eventName, line: lineNo }), lint)
    if (line !== null) printDiagnostic(line, colorsEnabled)
  }
}

export function compile(htmlRaw: string, opts: CompileOpts = {}): CompileResult {
  reset({
    analyzer: opts.analyzer,
    externalVars: opts.externalVars ?? [],
    handlerScope: opts.handlerScope,
    handlerConsts: opts.handlerConsts,
    scriptLang: opts.scriptLang,
    moduleName: opts.moduleName,
    lint: opts.lint,
    colorsEnabled: opts.colorsEnabled,
    instanceProps: opts.instanceProps,
    devWarnings: opts.devWarnings,
    serverRendered: opts.serverRendered,
    derivedPrecise: opts.derivedPrecise,
    proxy: opts.proxy,
  })

  const preprocessed = preprocess(htmlRaw)
  const tagRefs: TagRef[] = []
  // une balise qui en remplace une autre (`<@element>`, `<@module>`) ou un `*marquee` qui copie ses enfants : les lignes profondes nomment leurs rangs
  state.idxCopied = /\smjs-(?:el|mod)=|\s\*marquee\b/.test(preprocessed)
  const ast = parse(preprocessed, tagRefs, { lint: opts.lint, colorsEnabled: opts.colorsEnabled, autoSkeleton: opts.autoSkeleton, models: opts.models, guarded: opts.guarded, guardSilent: opts.guardSilent, firstLine: opts.firstLine, hostLines: opts.hostLines, lineCites: opts.lineCites, projectTags: opts.projectTags, links: opts.links })
  // la génération descend aussi d'un appel par niveau, plus vite que l'analyse : pile épuisée, la ligne
  // du nœud le plus profond
  try {
    return compileTree(ast, tagRefs, opts)
  }
  catch (e) {
    if (stackOverflow(e)) throw new Error(t('parser.nesting-too-deep', { line: deepestLine(ast) }))
    throw e
  }
}

// ligne du nœud le plus profond (celle de son plus proche ancêtre qui en porte une), parcours sans
// récursion : la pile vient justement de déborder
function deepestLine(root: Node): number {
  let line                                   = 0
  let max                                    = -1
  const stack: Array<[Node, number, number]> = [[root, 0, root.line ?? 0]]
  while (stack.length > 0) {
    const [node, depth, ancestorLine] = stack.pop()!
    const l = node.line ?? ancestorLine
    if (depth > max) {
      max  = depth
      line = l
    }
    for (const child of node.children) stack.push([child, depth + 1, l])
    for (const branch of node.branches) for (const child of branch.children) stack.push([child, depth + 1, l])
  }
  return line
}

function compileTree(ast: Node, tagRefs: TagRef[], opts: CompileOpts): CompileResult {
  warnCivetInterpolationInAttrs(ast, opts.moduleName, opts.lint, opts.colorsEnabled)
  warnSilentHtmlTraps(ast, opts.moduleName, opts.lint, opts.colorsEnabled)
  // l'ancienne écriture des transitions (`@in.fly={…}`) : toutes celles du composant dans une seule erreur
  refuseOldTransitions(ast)

  // dépendances directes de balises — comparaison par point de code (jamais
  // localeCompare, cf. writeManifest) pour que deux builds du même code
  // produisent le même tableau.
  const componentDepsSet = new Set<string>()
  collectDirectComponentDeps(ast, false, componentDepsSet, '', startValues(opts.startScript ?? ''))
  for (const d of [...componentDepsSet]) if (/^[?~]/.test(d) && (componentDepsSet.has(d.slice(1)) || (d[0] === '?' && componentDepsSet.has('~' + d.slice(1))))) componentDepsSet.delete(d)
  const componentDeps = Array.from(componentDepsSet).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)

  // Pre-pass : collecte les snippets pour batchCalculateVars
  state.isPrePass = true
  state.snippetRegistry = []
  walk(ast, { type: 'root', updates: [], loops: [], locals: new Set(), scope: [] })

  if (state.analyzer && state.snippetRegistry.length > 0) {
    state.analyzer.batchCalculateVars?.(state.snippetRegistry)
  }

  state.isPrePass = false
  state.counter = 0
  // Le pre-pass a populé `transitionsProcessed` avec les IDs générés à ce
  // moment. Comme `counter` est reset, les mêmes IDs vont être régénérés
  // par le real pass — sans ce reset, bindingTransition voit l'ID dans le
  // Set et skip le setup (=> pas de `node._mjs_intro` => fade ne joue pas).
  state.transitionsProcessed = new Set()
  // Reset également effectsByVar : la pre-pass aurait pu y pousser des entrées
  // qu'on ne doit pas garder pour le real pass.
  state.effectsByVar = new Map()
  // Reset des structVars pour le real pass.
  state.structVars = new Set()
  state.fineLists = []
  // idem : la pre-pass a déjà walké les `{for}`, le real pass les revisite
  state.templateLocals = new Set()
  // idem : les locaux par gestionnaire de la pre-pass ne valent que pour elle, comme leurs lignes
  state.inlineLocals = []
  state.inlineLines = []
  state.boundFields = []
  state.awaitBlocks = []
  // Reset mountOnlyEffects : pendant le pre-pass, `getEffectVars` retourne
  // toujours `[]` (uniquement pour peupler `snippetRegistry`), donc tous les
  // effects sont à tort classés `mountOnly`. Sans ce reset, ils tireraient
  // 2× au mount initial (1× via mountOnly, 1× via fullRender + dispatch).
  state.mountOnlyEffects = []
  state.mountOnlyEffectsSet = new Set()  // miroir de dédup
  // même motif : la pre-pass a pu pousser des liaisons two-way vers
  // un enfant, à ne pas garder pour le real pass (sinon doublon en sortie).
  state.initialPropBinds = []
  state.kidBinds         = []

  // `inlines`/`events`/`eventsWithPrevent`
  // N'étaient PAS reset au basculement real pass : la pre-pass (walk complet) avait
  // déjà poussé chaque handler → tous émis EN DOUBLE (entrées mortes en tête de
  // `_mjs_inline`, ×2 code inline dans le bundle, ×2 compilation Coffee, ×2 closures
  // par instance à chaque init). Le real pass régénère tout avec des ids
  // déterministes (counter reset) ; `keepRefs`/`evtIdsInFor` lisent `state.events`
  // APRÈS le walk du corps → l'ordre est sûr.
  state.inlines = []
  state.events = {}
  state.eventBindCount = {}
  state.eventsWithPrevent = new Set()

  const ctx: Ctx = { type: 'root', updates: [], loops: [], locals: new Set(), scope: [] }
  // marques de ligne retirées ; gardées à part pour les messages de la construction du gabarit racine
  const surgicalHtml = retainRootLines(walk(ast, ctx))

  // dédupe des updates
  const seen = new Set<string>()
  const uniqueUpdates: string[] = []
  for (const u of ctx.updates) {
    if (!seen.has(u)) {
      seen.add(u)
      uniqueUpdates.push(u)
    }
  }

  // Auto-passive : touchstart/touchmove/wheel présents et SANS preventDefault
  // → listener délégué enregistré `passive` (scroll fluide). Dès qu'un handler
  // de ce type fait preventDefault, le type est exclu (reste non-passif).
  const passiveEvents = ['touchstart', 'touchmove', 'wheel'].filter(
    e => state.events[e] && !state.eventsWithPrevent.has(e),
  )

  // avertissement « relais événement brut » (µemit 'x', e), après
  // le real pass, sur les inlines FINALES (cf. warnRawEventEmit plus haut).
  warnRawEventEmit(state.inlines, state.inlineLines, opts.moduleName, opts.lint, opts.colorsEnabled)

  // props des composants de la racine (cf. state.kidBinds) : `_mjs_kb`, posé dans `init()` avec les liaisons à deux sens, jamais joué là,
  // où les props du composant ne sont pas encore arrivées (une valeur par défaut à `null` lue par sa racine y lèverait). Joué à sa
  // première connexion, à la fin de la reprise de ses props (connectedCallback, mjs_element.ts) ; sous happy-dom, qui connecte le contenu
  // d'une ombre avant son hôte, par le premier de ses enfants qui se connecte (bloc `<shadow-before-host>`, même fichier)
  const kidBinds = state.kidBinds.length > 0 ? [...state.initialPropBinds, `_mjsThis._mjs_kb = () => { ${[...new Set(state.kidBinds)].join(' ')} };`] : state.initialPropBinds
  return [surgicalHtml, uniqueUpdates, state.events, state.inlines, state.effectsByVar, state.structVars, state.mountOnlyEffects, passiveEvents, tagRefs, state.templateLocals, kidBinds, componentDeps, state.inlineLocals, state.propVars]
}
