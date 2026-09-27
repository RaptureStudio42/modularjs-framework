// effect-deps — précalcule au COMPILE-TIME les dépendances réactives d'un
// `µ.effect(callback)` (sucre source : `µeffect -> ...`), au lieu de les
// déduire au RUNTIME par un scan texte de `callback.toString()`.
//
// `µ.effect` (mjs_runes.ts) calculait
// SES dépendances en scannant `fn.toString()` avec une regex littérale
// `$.<var>` (une par clé connue de `comp._mjs_var_bits`). Cassé dès que le code
// est minifié : esbuild (bundler/minify.ts, `minify:true` → `minifyIdentifiers`
// inclus) renomme le PARAMÈTRE local `$` (`function($){...}` → `function(n){...}`,
// vérifié empiriquement sur le VRAI pipeline prod, NODE_ENV=production) SANS
// toucher aux noms de PROPRIÉTÉ (`mangleProps` est restreint à `/^_mjs_/`,
// cf. minify.ts) — le texte minifié contient `n.count`, plus jamais `$.count` :
// la regex ne matche PLUS RIEN. Conséquence : `staticVars` reste TOUJOURS vide
// en prod → CHAQUE `µeffect` bascule sur le mode fail-open "pas de deps
// connues → fire à CHAQUE mutation, peu importe la var" (mjs_element.ts
// `_mjs_runEffectsV2`) — défait tout l'intérêt du dispatch V2 par var, et un
// effect à side-effects (requête réseau, log, animation...) se déclenche
// bien plus souvent en prod qu'en dev, silencieusement (pas un crash — une
// dégradation de perf/comportement difficile à soupçonner).
//
// Fix : détecter ICI, en AST, chaque `µ.effect(callback)` émis par le
// compilateur et lister les `$.xxx` lus (même famille de technique que
// path-tracker.ts pour les mutations) — puis émettre cette liste comme 2e
// argument LITTÉRAL (des STRINGS, jamais renommées par un minifieur, seul
// `_mjs_*` est manglé) : `µ.effect(callback, ["count","label"])`.
// `mjs_runes.ts` utilise ce précalcul quand il est fourni, et ne retombe sur
// le scan `fn.toString()` que si absent (rétrocompat : `µ.effect` appelé hors
// pipeline compilateur, ex. code runtime écrit à la main).
//
// Portée : les `$.xxx` en LECTURE comptent, en DOT notation ou en BRACKET
// notation à clé littérale (`$['xxx']`). Une clé dynamique (`$[expr]`) ne peut
// pas être résolue statiquement — ignorée. Un alias (`box = $.box; box.width`)
// ou une mutation déjà réécrite par path-tracker.ts (`_mjs_deepSet`/`_mjs_deepCall`)
// ne sont pas vus non plus.
//
// FONCTIONS PLATES — une lecture $.x cachée dans une
// fonction plate du même script (`helper = function() { return $.b + 1 }`
// appelée depuis l'effect) restait invisible à l'ancien scan (portée limitée
// au premier niveau du callback + methodReads). Sans danger tant que la liste
// de deps restait VIDE (le filet runtime « aucune dep connue → fire à chaque
// mutation » prenait le relais) — mais dès qu'UNE lecture directe cohabitait
// avec l'appel caché, la liste devenait NON VIDE, le filet se désactivait, et
// la mutation cachée ne redéclenchait plus jamais l'effet : `$b` changeait,
// rien ne rejouait. `$` étant une liaison LOCALE du module compilé, une
// lecture `$.x` ne peut apparaître que dans CE module — les fonctions
// top-level du script (déclaration, affectation de variable, affectation nue
// après un `let` séparé) sont donc résolues PAR LEUR NOM et suivies
// TRANSITIVEMENT (position appel `helper()` ET position valeur
// `list.forEach(helper)`, garde de cycle). Une fonction imbriquée dans une
// AUTRE fonction top-level (donc absente de `ast.body`) reste hors de portée,
// tout comme un alias.
//
// un effet qui APPELLE une méthode
// du composant (`µeffect -> $.total = @fmt()`, compilé `this.fmt()`) devait
// hériter des lectures DE CETTE méthode : sans ça, `{@fmt()}` change dans le
// template mais l'effet qui appelait un équivalent ne se re-déclenchait pas.
// `methodReads` (2e argument, cf. analyzer/index.ts — Analyzer.methodReads,
// déjà point-fixé : une méthode qui en appelle une autre hérite de SES
// lectures) est consulté à chaque `this.<nom>()`/`_mjsThis.<nom>()` rencontré
// DANS le callback. Noms d'état/computed SIMPLES : toujours inclus (le
// runtime étend les computeds via comp._mjs_computedDeps à l'enregistrement, cf.
// mjs_runes.ts ~162-172).
//
// STORE — une lecture `µ.store.x` (`$$x`) devient la dépendance '$$x' (`µ.store` parcouru
// en entier : '$$*'), qu'elle soit dans le callback, dans une fonction plate ou dans une
// méthode appelée. Le store appelle `_mjs_invalidate('$$x')` sur les composants abonnés à la
// clé (`_mjs_storeKeys`, qui relève aussi les `$$x` LUS dans le <script>, cf. collectStoreReads)
// et `_mjs_runEffectsV2` compare cette clé aux dépendances : sans elle, un effet qui lisait
// aussi un `$x` local ne se relançait JAMAIS sur l'écriture de la clé (liste non vide, filet
// « aucune dépendance connue » désactivé) ; seul, il se relançait à CHAQUE mutation, y
// compris celles qu'il provoquait — `$$n += 1 if $$actif` bouclait jusqu'au garde-fou.
// Une clé que l'effet ÉCRIT lui-même (`µ._storeSet('x', …)`, écritures profondes,
// suppression — formes posées par path-tracker.ts, dans le callback, une fonction plate ou une
// méthode) n'est jamais une dépendance : il ne se relance pas sur sa propre écriture. Les
// lectures du store d'une méthode viennent de SON CORPS déjà réécrit, jamais de `methodReads`,
// qui range aussi les cibles d'écriture en lecture (`$$panier = null` y vaut '$$panier').

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { passResult, type PassResult } from './pass-map.js'
import { collectStoreMemberDep } from '../analyzer/index.js'

// écritures du store telles que path-tracker.ts les réécrit : la clé est le 1er argument
const STORE_WRITERS = new Set([ '_storeSet', '_mjs_storeDeepSet', '_mjs_storeDeepCall', '_mjs_storeDeepDelete', '_mjs_storeDelete' ])

function isStoreRoot(node: any): boolean {
  return node?.type === 'MemberExpression' && !node.computed && node.object?.type === 'Identifier' && node.object.name === 'µ' &&
    node.property?.type === 'Identifier' && node.property.name === 'store'
}

// '$$x' si `node` écrit la clé x du store (appel réécrit, ou cible `µ.store.x` restée nue), sinon null
function storeWriteKey(node: any): string | null {
  if (node.type === 'CallExpression') {
    const c = node.callee
    if (c?.type !== 'MemberExpression' || c.computed || c.object?.type !== 'Identifier' || c.object.name !== 'µ') return null
    if (!STORE_WRITERS.has(c.property?.name)) return null
    const k = node.arguments?.[0]
    return k?.type === 'Literal' && typeof k.value === 'string' ? `$$${k.value}` : null
  }
  const cible = node.type === 'AssignmentExpression' ? node.left : node.argument
  if (cible?.type === 'MemberExpression' && !cible.computed && isStoreRoot(cible.object) && cible.property?.type === 'Identifier') return `$$${cible.property.name}`
  return null
}

function extractComputedStaticKey(node: any): string | null {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

/**
 * Doit s'appliquer APRÈS applyPathTracking (les mutations $.x profondes sont
 * déjà réécrites en _mjs_deepSet/_mjs_deepCall — hors de portée ici, cf. en-tête) et
 * APRÈS transformReactiveWrites (idem pour les écritures top-level $.x = y).
 * `methodReads` (optionnel) : cf. commentaire en tête de fichier.
 */
export function annotateEffectDeps(js: string, methodReads?: Record<string, string[]>): string {
  return annotateEffectDepsMapped(js, methodReads).code
}

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
export function annotateEffectDepsMapped(js: string, methodReads?: Record<string, string[]>): PassResult {
  if (!js || !js.includes('µ.effect(')) return { code: js }

  let ast: acorn.Node
  try {
    ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return { code: js }
  }

  const ms = new MagicString(js)
  let changed = false

  // Fonctions plates TOP-LEVEL du module (cf. en-tête) — 3 formes :
  // déclaration, affectation de variable, affectation nue après un `let` séparé
  // (forme émise pour `nom = -> ...` par le générateur Civet/Coffee).
  const fnByName = new Map<string, any>()
  for (const stmt of (ast as any).body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      fnByName.set(stmt.id.name, stmt)
      continue
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (decl.id?.type === 'Identifier' && decl.init &&
            (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')) {
          fnByName.set(decl.id.name, decl.init)
        }
      }
      continue
    }
    if (stmt.type === 'ExpressionStatement' && stmt.expression?.type === 'AssignmentExpression' &&
        stmt.expression.operator === '=' && stmt.expression.left?.type === 'Identifier' &&
        (stmt.expression.right?.type === 'FunctionExpression' || stmt.expression.right?.type === 'ArrowFunctionExpression')) {
      fnByName.set(stmt.expression.left.name, stmt.expression.right)
    }
  }

  // Méthodes du composant posées au premier niveau (`this.lit = function() {…}`, forme émise pour
  // `@lit = -> …`) : parcourues pour leurs lectures et écritures du STORE seulement (en-tête).
  const methodByName = new Map<string, any>()
  for (const stmt of (ast as any).body) {
    const a = stmt.type === 'ExpressionStatement' ? stmt.expression : null
    if (a?.type === 'AssignmentExpression' && a.operator === '=' && a.left?.type === 'MemberExpression' && !a.left.computed &&
        a.left.object?.type === 'ThisExpression' && a.left.property?.type === 'Identifier' &&
        (a.right?.type === 'FunctionExpression' || a.right?.type === 'ArrowFunctionExpression')) {
      methodByName.set(a.left.property.name, a.right)
    }
  }

  // Parcourt `fn` : les `$.xxx` lus vont dans `deps` — DIRECTEMENT, via une méthode
  // `this.m()`/`_mjsThis.m()` (methodReads) ou via un APPEL à une fonction plate du module
  // (fnByName, TRANSITIF — `seen` coupe les cycles) ; les lectures et les écritures du STORE vont
  // dans `store`, corps des méthodes compris. `storeOnly` : dans le corps d'une méthode, les
  // `$.xxx` restent ceux de methodReads (filtrés des variables externes par l'analyseur).
  function collectReads(fn: any, deps: Set<string>, seen: Set<string>, store: { reads: Set<string>, writes: Set<string> }, storeOnly = false): void {
    walk.ancestor(fn, {
      MemberExpression(n: any, _s: any, anc: any[]) {
        if (n.object?.type !== 'Identifier' || n.object.name !== '$') {
          collectStoreMemberDep(n, anc, store.reads)
          return
        }
        if (storeOnly) return
        const key = n.computed ? extractComputedStaticKey(n.property) : (n.property?.name ?? null)
        if (key) deps.add(key)
      },
      AssignmentExpression(n: any) {
        const k = storeWriteKey(n)
        if (k) store.writes.add(k)
      },
      UpdateExpression(n: any) {
        const k = storeWriteKey(n)
        if (k) store.writes.add(k)
      },
      // `this.fmt()`/`_mjsThis.fmt()` : méthode connue → ses lectures d'état
      // (déjà point-fixées, '@' résolus) s'ajoutent aux deps de CET effet ;
      // son corps donne celles du store (en-tête).
      CallExpression(n: any) {
        const k = storeWriteKey(n)
        if (k) store.writes.add(k)
        const cc = n.callee
        if (cc?.type !== 'MemberExpression' || cc.computed || cc.property?.type !== 'Identifier') return
        if (cc.object?.type !== 'ThisExpression' && !(cc.object?.type === 'Identifier' && cc.object.name === '_mjsThis')) return
        const nom = cc.property.name
        const sub = storeOnly ? null : methodReads?.[nom]
        if (sub) for (const r of sub) { if (!r.startsWith('$$')) deps.add(r) }
        const corps = methodByName.get(nom)
        if (!corps || seen.has(`@${nom}`)) return
        seen.add(`@${nom}`)
        collectReads(corps, deps, seen, store, true)
      },
      // fonction plate du module référencée — position appel (`helper()`) OU
      // position valeur (`list.forEach(helper)`) : héritage transitif de SES
      // lectures (en-tête). Clé de `seen` distincte en mode store seul : un
      // passage depuis une méthode ne doit pas masquer le parcours complet.
      Identifier(n: any) {
        const cle = storeOnly ? `~${n.name}` : n.name
        if (!fnByName.has(n.name) || seen.has(cle)) return
        seen.add(cle)
        collectReads(fnByName.get(n.name), deps, seen, store, storeOnly)
      },
    })
  }

  walk.simple(ast, {
    CallExpression(node: any) {
      const callee = node.callee
      if (!callee || callee.type !== 'MemberExpression' || callee.computed) return
      if (callee.object?.type !== 'Identifier' || callee.object.name !== 'µ') return
      if (callee.property?.name !== 'effect') return

      // Déjà 2 args (re-passe, ou forme inattendue) : ne rien injecter de plus.
      const args = node.arguments ?? []
      if (args.length !== 1) return
      const cb = args[0]
      if (cb.type !== 'FunctionExpression' && cb.type !== 'ArrowFunctionExpression') return

      const deps  = new Set<string>()
      const store = { reads: new Set<string>(), writes: new Set<string>() }
      collectReads(cb, deps, new Set<string>(), store)
      // une clé que l'effet écrit lui-même ne le relance jamais (en-tête)
      for (const k of store.reads) { if (!store.writes.has(k)) deps.add(k) }

      const depsLit = `[${[...deps].map(d => JSON.stringify(d)).join(', ')}]`
      ms.appendLeft(cb.end, `, ${depsLit}`)
      changed = true
    },
  })

  return passResult(ms, js, changed, 'effect-deps')
}
