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
// Une clé que l'effet lit ET écrit (`µ._storeSet('x', …)`, écritures profondes, suppression —
// formes posées par path-tracker.ts) reste une dépendance quand l'écriture a lieu pendant son
// passage synchrone (corps du callback, fonction appelée sur place, fonction plate ou méthode
// APPELÉE) et ne part pas de la clé elle-même, sous le nom '$$x!' : le store ne le signale que pour
// une écriture faite hors de tout effet (mjs_store_globals.ts). Un bouton, un gestionnaire, une
// minuterie ou une réponse réseau qui écrit la clé relance donc l'effet (le bornage
// `$$v = $max if $$v > $max` corrige un `$$v = 50` posé par un bouton) ; sa propre écriture, ou celle
// d'un autre effet, jamais : deux effets qui écrivent la même clé — deux exemplaires qui l'alignent
// sur leur propre valeur — se relanceraient l'un l'autre sans fin ; entre effets, la dernière
// écriture gagne. Écrite en CUMULANT pendant ce passage (`$$n += 1`, `$$n++`, `$$ok = not $$ok`,
// `$$v = Math.min($$v, 9)`, `$$liste.push(x)`), elle n'en est pas une : deux effets qui cumulent sur la
// même clé — deux compteurs, deux exemplaires d'un même composant — se relanceraient l'un l'autre sans
// fin. Écrite APRÈS ce passage — fonction imbriquée (rappel, minuterie, promesse, écouteur), fonction
// plate passée comme valeur, code qui suit le premier `await` d'un effet `async`, générateur —, elle
// reste une dépendance, sans marque, si l'effet la lit pendant ce passage : le message qui s'efface tout
// seul (`if $$toast then setTimeout (-> $$toast = null), 50`) repart quand la minuterie vide la clé, puis
// s'arrête. Écrite après coup ou en cumulant, et lue seulement par ce code différé
// (`setInterval (-> $$tick = $$tick + 1)`), elle n'en est pas une. Les lectures du store d'une méthode
// viennent de SON CORPS déjà réécrit, jamais de `methodReads`, qui range aussi les cibles
// d'écriture en lecture (`$$panier = null` y vaut '$$panier').
//
// DÉRIVÉ — `computedDeps` (3e argument, racines de chaque dérivé, fermeture transitive de l'analyseur) : le
// runtime ajoute à l'enregistrement les racines d'un dérivé lu (`_mjs_computedDeps`), sans marque ni
// exclusion. Un dérivé fondé sur une clé que l'effet écrit (`$e = $$n + 1`, `$$n = …`) cède donc la place,
// dans la liste, à ses racines : la clé y suit la règle d'une lecture directe, et une valeur écrite qui lit
// le dérivé (`$$n = $e`) cumule — sans quoi l'effet repartait sur sa propre écriture, jusqu'au garde-fou.
//
// UNE PASSE — un effet dont toutes les lectures sortent ainsi de la liste (`$$k = $$k + 1`, `$$n = $e`) ne reçoit pas
// une liste vide, que le runtime lit « dépendances inconnues, relancer à chaque mise à jour » : sa liste ne porte que
// la marque '!', qu'aucune écriture ne signale. Il passe au montage, jamais ensuite. Un effet qui ne lit rien de
// réactif garde sa liste vide.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { passResult, type PassResult } from './pass-map.js'
import { collectStoreMemberDep } from '../analyzer/index.js'
import { isStoreRoot, parseModule } from './ast-helpers.js'

// écritures du store telles que path-tracker.ts les réécrit : la clé est le 1er argument — par un chemin, ou à travers
// un élément trouvé (`$$taches.find(f).fait = v` → `µ._mjs_storeSetOn("taches", …)`), qui écrit la clé tout autant
const STORE_WRITERS = new Set([ '_storeSet', '_mjs_storeDeepSet', '_mjs_storeDeepCall', '_mjs_storeDeepDelete', '_mjs_storeDelete', '_mjs_storeSetOn', '_mjs_storeCallOn', '_mjs_storeDeleteOn' ])

// écritures à travers l'objet visé (2e argument : variable qui garde un objet du magasin, élément trouvé) : celle qui
// cumule lit cet objet, donc la clé, comme la même écriture par le chemin lit `µ.store.x` (cf. collectReads)
const OBJECT_WRITERS = new Set([ '_mjs_storeSetOn', '_mjs_storeCallOn', '_mjs_storeDeleteOn' ])

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

// vrai si le nœud (dernier de `anc`, chemin depuis la fonction parcourue `anc[0]`) peut s'exécuter APRÈS
// le passage synchrone de cette fonction : fonction génératrice, code d'une fonction async qui commence après son
// premier `await`, ou nœud placé dans une fonction imbriquée (rappel, minuterie, promesse, écouteur, nettoyage
// rendu) — sauf une fonction appelée sur place (`((_v) => …)(x)`, forme émise pour `$$x++`)
function apresCoup(anc: any[]): boolean {
  const n = anc[anc.length - 1]
  for (let i = 0; i < anc.length - 1; i++) {
    const f = anc[i]
    if (f.type !== 'FunctionExpression' && f.type !== 'ArrowFunctionExpression' && f.type !== 'FunctionDeclaration') continue
    if (f.generator || (f.async && n.start >= finPremierAwait(f))) return true
    if (i > 0 && !(anc[i - 1].type === 'CallExpression' && anc[i - 1].callee === f)) return true
  }
  return false
}

// fin du premier `await` d'une fonction async, fonctions imbriquées exclues (Infinity sans `await`) : son argument
// est lu pendant le passage, ce qui commence après tourne plus tard ; une boucle `for await` compte dès son corps
const finsAwait = new WeakMap<any, number>()
function finPremierAwait(f: any): number {
  const fin = finsAwait.get(f)
  if (fin !== undefined) return fin
  let min = Infinity
  walk.recursive(f.body, null, {
    Function() {},
    AwaitExpression(n: any, st: any, c: any) {
      if (n.end < min) min = n.end
      c(n.argument, st, 'Expression')
    },
    ForOfStatement(n: any, st: any, c: any) {
      if (n.await && n.body.start < min) min = n.body.start
      walk.base.ForOfStatement(n, st, c)
    },
  })
  finsAwait.set(f, min)
  return min
}

// ce que `collectReads` relève d'un effet, cf. son commentaire
interface Lectures {
  reads: Set<string>
  syncReads: Set<string>
  syncDeps: Set<string>
  excluded: Set<string>
  cumul: Set<string>
  writes: Set<string>
}

// racines d'un dérivé (`computedDeps`), null pour un nom qui n'en est pas un
function racinesDe(derives: Record<string, string[]> | undefined, nom: string): string[] | null {
  return derives && Object.prototype.hasOwnProperty.call(derives, nom) ? derives[nom] : null
}

// vrai si `node` lit la clé `cle` du store (`µ.store.cle`, à toute profondeur), elle-même ou par un dérivé
// calculé d'elle (`$.e`, `$e = $$cle + 1`)
function litCle(node: any, cle: string, derives?: Record<string, string[]>): boolean {
  let lu = false
  walk.simple(node, {
    MemberExpression(m: any) {
      const nom = m.computed ? m.property?.value : m.property?.name
      if (isStoreRoot(m.object) && nom === cle) lu = true
      else if (m.object?.type === 'Identifier' && m.object.name === '$' && typeof nom === 'string' && racinesDe(derives, nom)?.includes(`$$${cle}`)) lu = true
    },
  })
  return lu
}

// vrai si `x` lit l'objet `o` qu'écrit `µ._mjs_storeSetOn` (2e argument) : la variable qui garde l'élément trouvé
// (`t.n = t.n + 1`), ou le paramètre qui tient l'objet relu (`((_mjs_o) => µ._mjs_storeSetOn("l", _mjs_o, "n",
// _mjs_o.n + (1)))(objet)`, forme de `+=` et `++`, path-tracker.ts)
function litObjet(x: any, o: any): boolean {
  let lu = false
  if (o?.type === 'Identifier') walk.simple(x, { Identifier(i: any) { if (i.name === o.name) lu = true } })
  return lu
}

// vrai si l'écriture `n` de la clé '$$x' CUMULE : la valeur écrite part de la clé elle-même (`$$n += 1`,
// `$$n++`, `$$ok = not $$ok`, `$$v = Math.min($$v, 9)`, `$$liste.push(x)`), ou de l'élément trouvé qu'elle écrit
// (`$$l.find(f).n += 1`, `t.ok = not t.ok`). Rejouée sur l'écriture d'un
// autre effet qui cumule aussi (deux compteurs, deux exemplaires d'un composant), elle ne se stabilise jamais
function cumule(n: any, k: string, anc: any[], derives?: Record<string, string[]>): boolean {
  const cle = k.slice(2)
  let val: any, obj: any
  if (n.type === 'AssignmentExpression') {
    if (n.operator !== '=') return true
    val = n.right
  }
  else {
    const nom = n.callee.property.name
    if (nom === '_mjs_storeDeepCall' || nom === '_mjs_storeCallOn') return true
    if (nom === '_storeSet') val = n.arguments[1]
    else if (nom === '_mjs_storeDeepSet') val = n.arguments[2]
    else if (nom === '_mjs_storeSetOn') [obj, val] = [n.arguments[1], n.arguments[3]]
    else return false
  }
  const lit = (x: any) => litCle(x, cle, derives) || litObjet(x, obj)
  if (val && lit(val)) return true
  // forme expression de `$$n++` : `((_v) => (µ._storeSet("n", (+_v) + 1), +_v))(µ.store.n)`, la valeur vient de
  // l'argument de la fonction appelée sur place
  for (let i = anc.length - 2; i > 0; i--) {
    const p = anc[i - 1]
    if (p.type === 'CallExpression' && p.callee === anc[i] && p.arguments.some(lit)) return true
  }
  return false
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
export function annotateEffectDeps(js: string, methodReads?: Record<string, string[]>, computedDeps?: Record<string, string[]>): string {
  return annotateEffectDepsMapped(js, methodReads, computedDeps).code
}

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
export function annotateEffectDepsMapped(js: string, methodReads?: Record<string, string[]>, computedDeps?: Record<string, string[]>): PassResult {
  if (!js || !js.includes('µ.effect(')) return { code: js }

  let ast: acorn.Node
  try {
    ast = parseModule(js)
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
  // (fnByName, TRANSITIF — `seen` coupe les cycles), et dans `store.syncDeps` ceux lus pendant son passage
  // synchrone ; les lectures du STORE vont dans `store.reads` (dans `store.syncReads` aussi, faites pendant ce
  // passage), dans `store.excluded` les clés qu'il écrit après ce passage ou en cumulant (en-tête), corps des
  // méthodes compris — dans `store.cumul` aussi, écrites en cumulant pendant ce passage —, et dans `store.writes`
  // celles qu'il écrit pendant ce passage sans cumuler.
  // `storeOnly` : dans le corps d'une méthode, les `$.xxx` restent ceux de
  // methodReads (filtrés des variables externes par l'analyseur). `late` : `fn` elle-même peut tourner
  // après ce passage (passée comme valeur, ou atteinte depuis un rappel).
  function collectReads(fn: any, deps: Set<string>, seen: Set<string>, store: Lectures, storeOnly = false, late = false): void {
    // écriture de la clé `k` du store par le nœud `n`, faite après le passage (`t`) ou pendant. Cumulée à travers l'objet
    // visé (`s.n++`, `t.n += 1`, `p.l.push(x)` par une variable prise hors de l'effet), elle LIT la clé, comme par le
    // chemin (`$$e.a.n++` lit `µ.store.e`) : sans cette lecture, un effet qui ne lit rien d'autre recevait une liste
    // vide, relancé à chaque mise à jour, sa propre écriture comprise, jusqu'au garde-fou
    const ecrit = (n: any, k: string, anc: any[], t: boolean): void => {
      const c = cumule(n, k, anc, computedDeps)
      if (c && n.type === 'CallExpression' && OBJECT_WRITERS.has(n.callee.property.name)) {
        store.reads.add(k)
        if (!t) store.syncReads.add(k)
      }
      if (t) store.excluded.add(k)
      else if (c) {
        store.excluded.add(k)
        store.cumul.add(k)
      }
      else store.writes.add(k)
    }
    walk.ancestor(fn, {
      MemberExpression(n: any, _s: any, anc: any[]) {
        if (n.object?.type !== 'Identifier' || n.object.name !== '$') {
          collectStoreMemberDep(n, anc, store.reads)
          if (!late && !apresCoup(anc)) collectStoreMemberDep(n, anc, store.syncReads)
          return
        }
        if (storeOnly) return
        const key = n.computed ? extractComputedStaticKey(n.property) : (n.property?.name ?? null)
        if (!key) return
        deps.add(key)
        if (!late && !apresCoup(anc)) store.syncDeps.add(key)
      },
      AssignmentExpression(n: any, _s: any, anc: any[]) {
        const k = storeWriteKey(n)
        if (k) ecrit(n, k, anc, late || apresCoup(anc))
      },
      // `µ.store.x++` resté nu : toujours un cumul
      UpdateExpression(n: any, _s: any, anc: any[]) {
        const k = storeWriteKey(n)
        if (!k) return
        store.excluded.add(k)
        if (!late && !apresCoup(anc)) store.cumul.add(k)
      },
      // `this.fmt()`/`_mjsThis.fmt()` : méthode connue → ses lectures d'état
      // (déjà point-fixées, '@' résolus) s'ajoutent aux deps de CET effet ;
      // son corps donne celles du store (en-tête).
      CallExpression(n: any, _s: any, anc: any[]) {
        const t = late || apresCoup(anc)
        const k = storeWriteKey(n)
        if (k) ecrit(n, k, anc, t)
        const cc = n.callee
        if (cc?.type !== 'MemberExpression' || cc.computed || cc.property?.type !== 'Identifier') return
        if (cc.object?.type !== 'ThisExpression' && !(cc.object?.type === 'Identifier' && cc.object.name === '_mjsThis')) return
        const nom = cc.property.name
        const sub = storeOnly ? null : methodReads?.[nom]
        if (sub) for (const r of sub) {
          if (r.startsWith('$$')) continue
          deps.add(r)
          if (!t) store.syncDeps.add(r)
        }
        const corps = methodByName.get(nom)
        const cle   = (t ? '@!' : '@') + nom
        if (!corps || seen.has(cle)) return
        seen.add(cle)
        collectReads(corps, deps, seen, store, true, t)
      },
      // fonction plate du module référencée — position appel (`helper()`) OU
      // position valeur (`list.forEach(helper)`) : héritage transitif de SES
      // lectures (en-tête). Clé de `seen` distincte en mode store seul : un
      // passage depuis une méthode ne doit pas masquer le parcours complet ;
      // distincte aussi quand elle peut tourner après coup (passée comme valeur :
      // `setTimeout(helper)`), pour que ses écritures y soient vues comme telles.
      Identifier(n: any, _s: any, anc: any[]) {
        if (!fnByName.has(n.name)) return
        const p   = anc[anc.length - 2]
        const t   = late || apresCoup(anc) || !(p?.type === 'CallExpression' && p.callee === n)
        const cle = (storeOnly ? '~' : '') + (t ? '!' : '') + n.name
        if (seen.has(cle)) return
        seen.add(cle)
        collectReads(fnByName.get(n.name), deps, seen, store, storeOnly, t)
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
      // fonction plate du module passée par son NOM (`µeffect compte`) : mêmes lectures que si elle était
      // écrite en ligne — sans liste, le repli du runtime lisait le texte de la fonction, qui n'a plus de
      // `$.` une fois minifié (l'effet se relançait alors à chaque mutation, en production seulement)
      const fn = cb.type === 'Identifier' ? fnByName.get(cb.name) : cb
      if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionDeclaration')) return

      const deps  = new Set<string>()
      const store: Lectures = { reads: new Set(), syncReads: new Set(), syncDeps: new Set(), excluded: new Set(), cumul: new Set(), writes: new Set() }
      const seen  = new Set<string>(cb.type === 'Identifier' ? [cb.name] : [])
      collectReads(fn, deps, seen, store)
      // dérivé fondé sur une clé que l'effet écrit : remplacé par ses racines, la clé passe par la règle des lectures
      // du store juste en dessous (en-tête) ; un dérivé intermédiaire n'apporte rien, ses racines sont déjà là
      for (const d of [...deps]) {
        const racines = racinesDe(computedDeps, d)
        if (!racines?.some(r => store.writes.has(r) || store.excluded.has(r))) continue
        deps.delete(d)
        for (const r of racines) {
          if (racinesDe(computedDeps, r)) continue
          if (!r.startsWith('$$')) deps.add(r)
          else {
            store.reads.add(r)
            if (store.syncDeps.has(d)) store.syncReads.add(r)
          }
        }
      }
      // une clé que l'effet écrit pendant son passage synchrone, sans cumuler, reste une dépendance, marquée '!' : seule
      // une écriture hors de tout effet la signale ; lue pendant ce passage et écrite seulement après coup, elle en reste
      // une, sans marque ; écrite en cumulant pendant ce passage, ou après coup et lue seulement après coup, elle n'en est
      // pas une (en-tête)
      for (const k of store.reads) {
        if (store.excluded.has(k) && (store.cumul.has(k) || !store.syncReads.has(k))) continue
        deps.add(store.writes.has(k) ? `${k}!` : k)
      }
      // tout ce qu'il lit, il l'écrit en cumulant ou après coup (`$$k = $$k + 1`, `$$n = $e`) : une liste vide dirait « aucune
      // dépendance connue », que le runtime relance à chaque mise à jour du composant — jusqu'au garde-fou au montage, puis
      // sur tout rendu sans rapport. La marque '!', qu'aucune écriture ne signale, le fait passer au montage seulement
      if (deps.size === 0 && store.reads.size > 0) deps.add('!')

      const depsLit = `[${[...deps].map(d => JSON.stringify(d)).join(', ')}]`
      ms.appendLeft(cb.end, `, ${depsLit}`)
      changed = true
    },
  })

  return passResult(ms, js, changed, 'effect-deps')
}
