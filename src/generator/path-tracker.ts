// path-tracker — suit les alias de `$.X` dans le scope et
// transforme les mutations profondes en `µ._mjs_deepSet(_mjsThis, path, val)`
// au lieu de passer par un Proxy runtime.
//
// Statisation $$ — même suivi pour les chemins profonds du store universel
// (`$$obj.a.b` → `µ.store.obj.a.b`, racine reconnue par `isStoreRoot`, ast-helpers.ts) :
// `µ._mjs_storeDeepSet(rootKey, path, val)` / `µ._mjs_storeDeepCall(rootKey, path,
// method, args)` / `µ._mjs_storeDeepDelete(rootKey, path)`. Le TOP-LEVEL store
// (`$$x = v`/`$$x += v`/`$$x++`) passe AUSSI par une réécriture
// (`µ._storeSet(key, val)`) — l'accesseur natif `µ.store.x` seul ne
// suffit plus : `_mjs_storeDelete` peut le remplacer par une propriété PLATE
// (voir mjs_store_globals.ts), auquel cas une écriture directe ne notifie
// plus rien. Seul le TOP-LEVEL 'local' (`$.x = v`) reste sans réécriture ici
// (transformReactiveWrites + filet Proxy `_mjs_wrapDeep` s'en chargent déjà).
//
// Élément TROUVÉ dans le magasin — une cible qui passe par `find`, `findLast`, `at` ou `get`
// (`$$taches.find(f).fait = v`, `$$m.get(k).tags.push(x)`), ou par une variable qui garde un objet du magasin
// (`t = $$taches.find(f)`, l'alias `sous := $$cfg.a`, puis `t.fait = v`), n'a pas de chemin : l'écriture va À
// L'OBJET, comme en JavaScript, puis prévient la clé racine — `µ._mjs_storeSetOn(rootKey, objet, clé, val)` /
// `µ._mjs_storeCallOn(rootKey, objet, method, args)` / `µ._mjs_storeDeleteOn(rootKey, objet, clé)`. Aucun coût à la
// lecture : pas de mandataire sur le magasin, la réécriture est faite ici, à la compilation. Même écriture à travers
// la variable de TRAVAIL que Civet et CoffeeScript écrivent pour `?.`, `||=`, `&&=`, `??=` / `?=`
// (`(ref = µ.store.m.get(k)) != null ? ref.n = 1 : void 0`, cf. work), à travers la variable affectée une seule
// fois (`var t;` puis `t = …`, cf. once), et pour un chemin qu'aucun chemin littéral n'écrit (`$$l[0][a.k] = v`).
// Une clé calculée, après l'élément ou la racine, se lit comme JavaScript la lit (`$$taches.find(f)[k]` rend
// `Object.prototype` pour `k` valant `__proto__`, la fonction `Object` pour `constructor`) : l'aide d'écriture refuse
// ensuite d'écrire dans un prototype ou dans une fonction, comme elle refuse un nom réservé pour la clé écrite
// (mjs_store_globals.ts, _mjsStoreRefus) — aucun coût à la lecture ; un objet relu (`+=`, `++`) ou testé (`?.`) est
// tenu par un paramètre local (cf. bindings), aucune case partagée. La valeur d'une variable suivie reste une lecture
// nue, comme en JavaScript
//
// Pour les escapes (function call, push, throw, yield, alias non trackable),
// le compilateur injecte automatiquement un wrap `µ._mjs_makeDeepProxy(_mjsThis, path)`
// pour que la réactivité reste préservée à travers la frontière non trackée.
//
// Innovation algorithmique : zéro Proxy sur ~95% du code, Proxy ciblé sur les
// 5% restants. Vue/Svelte font Proxy partout (lent), Solid abandonne la
// rétrocompat (DX dégradée).
//
// la détection de `µproxy $.X` (escape hatch
// manuel → wrap inconditionnel) ne vit PAS ici mais dans transpiler/index.ts
// (~873-886), en AMONT de cette passe. Commentaire corrigé pour ne pas égarer
// le lecteur (l'ancienne formulation « Détecte aussi µproxy » laissait croire
// que le sucre était traité dans ce fichier).
//
// SÛRETÉ : le suivi est volontairement CONSERVATEUR. Un nom
// est « taint » (jamais traité comme alias) s'il est : paramètre d'une
// fonction/arrow/catch, cible d'une réassignation nue (`t = {}`) ou par
// motif (`[t] = […]`, `({t} = o)`), binding de for-of/for-in, ou déclaré
// plus d'une fois. Avant, `function f(box){box.x=1}` avec un alias externe
// `box` émettait `µ._mjs_deepSet(_mjsThis, ['box','x'], 1)` → corruption du
// state ET l'objet visé jamais muté. Perdre le tracking d'un alias
// réassigné (rare, motif compris) est préférable à corrompre l'état.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { passResult, type PassResult } from './pass-map.js'
import { COMPOUND_OPS, forEachPatternLeaf, isStoreRoot, parseModule } from './ast-helpers.js'
import { asiGuard, emitAssign, emitPattern, emitUpdate, writeValueUnused, type WriteTarget } from './emit-write.js'

/** Segment dynamique (`$.x[k]` → valeur runtime de `k`). Marqueur OBJET :
 *  l'ancien préfixe string `__dyn:` était forgeable par une clé littérale
 *  `$.x["__dyn:alert(1)"]` → code émis brut dans le path. */
type DynSegment = { dyn: string }
type Path = (string | number | DynSegment)[]

/** Statisation $$ — `origin` distingue une racine `$.x` ('local', state du
 * composant, `_mjsThis`) d'une racine `µ.store.x` ('store', global) : les
 * DEUX empruntent le MÊME suivi de chemin (getPath), seule la
 * fonction runtime émise diffère (`µ._mjs_deepSet`/`_mjs_deepCall`/`_mjs_deepDelete` vs
 * `µ._mjs_storeDeepSet`/`_mjs_storeDeepCall`/`_mjs_storeDeepDelete`, ce dernier trio
 * séparant en plus `path[0]` = clé racine du store des segments suivants). */
type PathOrigin = 'local' | 'store'

interface AliasEntry {
  /** Path par lequel cet alias pointe vers le state. ['box', 'width'] etc.
   * Pour origin='store', path[0] EST la clé racine du store (ex. `$$box` →
   * ['box'], `$$box.width` → ['box', 'width']). */
  path: Path
  origin: PathOrigin
}

// STATISATION — opérateurs composés (`+=` etc.) sur un chemin profond du
// store (`$$obj.a += v`, depth >= 2). BUG D'INTÉGRATION trouvé à la
// vérification : contrairement au state LOCAL (le filet Proxy `_mjs_wrapDeep`
// intercepte la mutation en place même sans réécriture compile-time ici, cf.
// runtime mjs_element.ts), le store statisé n'a AUCUN filet — `µ.store.obj`
// renvoie l'objet BRUT (`µ._mjs_storeRaw`), donc `µ.store.obj.a += 1` généré tel
// quel mutait en silence, zéro notification (prouvé : DOM figé alors que la
// valeur brute progressait). On expand donc CETTE origine en lecture+set
// explicite ; 'local' reste skip (le filet existant suffit, pas de régression
// à introduire dans un mécanisme qui marche déjà). Opérateurs : COMPOUND_OPS (ast-helpers.ts).

// Méthodes mutatives connues par type d'objet — nécessaires pour propager
// l'invalidation au runtime quand on appelle .push(), .splice(), etc.
const MUTATIVE_METHODS: Record<string, Set<string>> = {
  Array: new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']),
  Map: new Set(['set', 'delete', 'clear']),
  Set: new Set(['add', 'delete', 'clear']),
}

// Toutes les méthodes mutatives confondues (pour détection conservatrice)
const ALL_MUTATIVE = new Set([
  ...MUTATIVE_METHODS.Array,
  ...MUTATIVE_METHODS.Map,
  ...MUTATIVE_METHODS.Set,
])

// méthodes qui rendent un ÉLÉMENT de la collection (liste, Map) : l'objet rendu est celui que le magasin range, une
// écriture à travers lui est une écriture du magasin (cf. findRoot)
const FIND_METHODS = new Set(['find', 'findLast', 'at', 'get'])

// méthodes qui rendent l'élément qu'elles RETIRENT : celui d'une copie reste un objet du magasin (cf. findRoot) ; `splice`
// rend ceux qu'il retire dans une liste (cf. copyRoot)
const POP_METHODS = new Set(['pop', 'shift'])

// méthodes qui reçoivent un rappel → rang du paramètre qui tient l'ÉLÉMENT (le `forEach` d'une Map ou d'un Set compris) :
// un objet du magasin quand la liste en est un, ou une copie qui garde ses objets (cf. noteStore) ; aussi écrites en clé
// littérale (`$$l['forEach'](f)`), ou appelées par `Array.prototype.forEach.call(l, f)`
const CALLBACK_METHODS = new Map([['forEach', 0], ['map', 0], ['filter', 0], ['some', 0], ['every', 0], ['flatMap', 0], ['find', 0], ['findLast', 0], ['findIndex', 0], ['findLastIndex', 0], ['reduce', 1], ['reduceRight', 1]])

// méthodes qui rendent une COPIE gardant les objets de la liste, de la Map ou du Set (cf. copyRoot)
const COPY_METHODS = new Set(['filter', 'slice', 'concat', 'flat', 'toSorted', 'toReversed', 'toSpliced', 'with', 'values', 'entries'])

// boucles : une affectation qu'elles portent est rejouée à chaque tour (cf. once)
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'])

// portées d'un `let`, d'un `const` ou d'une fonction déclarée (cf. bindingOf)
const BLOCKS = new Set(['Program', 'BlockStatement', 'StaticBlock', 'SwitchStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'CatchClause'])

// affectations logiques : la variable garde sa valeur, ou prend celle de droite (cf. noteStore)
const LOGICAL_ASSIGN = new Set(['||=', '&&=', '??='])

const isFunction = (n: any) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'

/**
 * Transforme le code JS pour utiliser le path-tracking et insérer des wraps
 * Proxy automatiquement aux points d'escape détectés.
 *
 * Doit être appelé APRÈS transformReactiveWrites (qui gère les `$.x = y`
 * top-level) pour ne traiter que les mutations profondes.
 */
export function applyPathTracking(js: string): string {
  return applyPathTrackingMapped(js).code
}

// clé d'un nom qui lit plusieurs clés du magasin (cf. noteStore) : jamais celle d'une lecture, qui est un identifiant
const NO_KEY = '?'

// « clé » d'une variable qui ne tient aucun objet du magasin mais porte le nom d'une variable déclarée ou affectée (`=`)
// d'une lecture du magasin (cf. storeKey) : son écriture passe par l'aide DOUCE (`µ._mjs_softSetOn`…), qui écrit comme
// JavaScript et refuse seulement un prototype du langage ou l'une de ses fonctions — aucune clé prévenue
const SOFT = '~'

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
// `storeOnly` : module autonome (`.civet`/`.coffee` importé), sans état de composant — seules les racines
// `µ.store.x` sont suivies, un `$.x` y est un identifiant ordinaire (jQuery, par exemple) laissé tel quel
export function applyPathTrackingMapped(js: string, opts: { storeOnly?: boolean } = {}): PassResult {
  const storeOnly = !!opts.storeOnly
  // Statisation $$ — `µ.store.` déclenche aussi le tracking (`$$obj.a.b`
  // compile déjà en `µ.store.obj.a.b` à ce stade, cf. lexer/generator/utils).
  // `$[` aussi (composant seulement) : `$[k].x = v`, `delete $[k]`, `$[k].push(…)` sans aucun `$.`
  if (!js || (!js.includes('$.') && !js.includes('µ.store.') && (storeOnly || !js.includes('$[')))) return { code: js }

  let ast: acorn.Node
  try {
    ast = parseModule(js)
  } catch {
    return { code: js }
  }

  const ms = new MagicString(js)
  let changed = false

  // ── Passe 1 : noms « taint » (jamais aliasables — voir l'en-tête). ────────
  const tainted = new Set<string>()
  const declaredOnce = new Set<string>()
  const collectPatternNames = (pat: any) => forEachPatternLeaf(pat, (leaf: any) => { if (leaf.type === 'Identifier') tainted.add(leaf.name) })
  // occurrences des noms, pour les variables déclarées sans valeur (cf. work, once) : `decl` déclaration, `assign`
  // affectation nue, `bind` autre liaison (paramètre, motif, `catch`, variable d'un `for … in/of`, `++`, nom d'une
  // fonction), `ref` lecture. Déclaration et affectation gardent leur fonction (`fn`, ou le programme), l'affectation
  // son instruction (`stmt`) et sa boucle éventuelle dans cette fonction (`loop`)
  type Occ = { id: any, role: 'decl' | 'assign' | 'bind' | 'ref', node: any, fn?: any, stmt?: any, loop?: boolean }
  const occs = new Map<string, Occ[]>()
  const noteOcc = (id: any, anc: any[], type: string) => {
    const parent = anc[anc.length - 2]
    let role: Occ['role'] = 'ref'
    if (type === 'VariablePattern') {
      const loop = anc[anc.length - 4]
      if (parent.type === 'AssignmentExpression' && parent.left === id) role = 'assign'
      else if (parent.type === 'VariableDeclarator' && parent.id === id && !((loop?.type === 'ForInStatement' || loop?.type === 'ForOfStatement') && loop.left === anc[anc.length - 3])) role = 'decl'
      else role = 'bind'
    }
    else if (parent?.type === 'UpdateExpression' || ((parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') && parent.left === id)) role = 'bind'
    const o: Occ = { id, role, node: parent }
    if (role === 'decl' || role === 'assign') {
      o.fn = anc[0]
      for (let i = anc.length - 2; i >= 0; i--) {
        const a = anc[i]
        if (isFunction(a)) {
          o.fn = a
          break
        }
        if (!o.stmt && (a.type.endsWith('Statement') || a.type === 'VariableDeclaration')) o.stmt = a
        if (LOOPS.has(a.type)) o.loop = true
      }
    }
    let list = occs.get(id.name)
    if (!list) occs.set(id.name, list = [])
    list.push(o)
  }
  // portées qui déclarent chaque nom (cf. bindingOf) : une fonction ses paramètres, son nom (expression) et ses `var` ;
  // un bloc (programme, `{…}`, `for`, `switch`, `catch`) ses `let`, `const`, ses fonctions et le paramètre d'un `catch`
  const declScopes = new Map<string, any[]>()
  const declare = (scope: any, pat: any) => forEachPatternLeaf(pat, (leaf: any) => {
    if (leaf.type !== 'Identifier') return
    let l = declScopes.get(leaf.name)
    if (!l) declScopes.set(leaf.name, l = [])
    if (!l.includes(scope)) l.push(scope)
  })
  const enclosing = (anc: any[], block: boolean) => {
    for (let i = anc.length - 2; i > 0; i--) if (block ? BLOCKS.has(anc[i].type) : isFunction(anc[i])) return anc[i]
    return anc[0]
  }
  walk.fullAncestor(ast, (node: any, _st: any, anc: any[], type: string) => {
    if (node.type === 'Identifier') noteOcc(node, anc, type)
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        for (const p of node.params ?? []) {
          collectPatternNames(p)
          declare(node, p)
        }
        if (node.id) declare(node.type === 'FunctionDeclaration' ? enclosing(anc, true) : node, node.id)
        break
      case 'CatchClause':
        collectPatternNames(node.param)
        declare(node, node.param)
        break
      case 'VariableDeclaration': {
        const scope = enclosing(anc, node.kind !== 'var')
        for (const d of node.declarations) declare(scope, d.id)
        break
      }
      case 'ForOfStatement':
      case 'ForInStatement': {
        const left = node.left
        if (left?.type === 'VariableDeclaration') {
          for (const d of left.declarations ?? []) collectPatternNames(d.id)
        } else {
          collectPatternNames(left)
        }
        break
      }
      case 'AssignmentExpression':
        // réassignation nue (`t = {}`) OU par motif (`[t] = […]`, `({t} = o)`) : l'alias ne pointe plus le state —
        // collectPatternNames ignore un membre (`[$.a] = …`), seuls les identifiants liés sont taintés
        if (node.left?.type === 'Identifier') tainted.add(node.left.name)
        else collectPatternNames(node.left)
        break
      case 'UpdateExpression':
        if (node.argument?.type === 'Identifier') tainted.add(node.argument.name)
        break
      case 'VariableDeclarator':
        if (node.id?.type === 'Identifier') {
          // Déclaré 2× (scopes différents) : ambigu → taint.
          if (declaredOnce.has(node.id.name)) tainted.add(node.id.name)
          else declaredOnce.add(node.id.name)
        } else {
          // Déstructuration : les noms liés ne sont pas des alias suivables —
          // et `const {items} = $.data` suivi de `items.push(x)` muterait le
          // state SANS notification si on les laissait passer pour des vars
          // libres. On les taint (le Proxy _mjs_wrapDeep reste le filet).
          collectPatternNames(node.id)
        }
        break
    }
  })

  // variable de TRAVAIL (Civet `let ref;`, CoffeeScript `var ref, base;`) : déclarée sans valeur, affectée puis lue dans
  // une SEULE instruction — la forme qu'écrivent les deux compilateurs pour `?.`, `||=`, `&&=`, `??=` / `?=`
  // (`(ref = µ.store.m.get(k)) != null ? ref.meta.vu = true : void 0`, `(base = µ.store.o).a || (base.a = v)`). Elle
  // ne tient que ce que ces affectations lui donnent : parties d'un élément trouvé ou d'un chemin du magasin, sous la
  // même clé racine, ses écritures vont à l'objet qu'elle tient, puis préviennent la clé (cf. workIds). Suivie par
  // liaison, pas par nom : CoffeeScript redéclare `ref` dans chaque fonction, une fonction imbriquée qui redéclare le nom
  // tient une autre variable. 1re affectation → lectures, autres affectations
  const work = new Map<any, { ids: any[], others: any[] }>()
  // variable affectée UNE seule fois (CoffeeScript : `var t;` puis `t = $$taches.find(f)`, `sous = $$obj.a`) : déclarée
  // une fois sans valeur, affectée une fois dans la fonction qui la déclare, hors d'une boucle, jamais liée autrement
  // (paramètre, motif, `++`) — suivie comme sa déclaration le serait (`t := …`)
  const once = new Set<any>()
  // sans valeur : `let t`, ou `let t = undefined` que Civet écrit pour une variable apparue d'abord dans un bloc
  // (`if c` puis `t = …`)
  const noValue = (d: Occ) => !d.node.init || (d.node.init.type === 'Identifier' && d.node.init.name === 'undefined')
  for (const [name, list] of occs) {
    const decls = list.filter((o) => o.role === 'decl')
    for (const d of decls) {
      if (!noValue(d)) continue
      const F      = d.fn
      const inner  = decls.filter((o) => o.fn !== F && o.fn.start >= F.start && o.fn.end <= F.end).map((o) => o.fn)
      const inside = list.filter((o) => o !== d && o.id.start >= F.start && o.id.end <= F.end && !inner.some((g) => o.id.start >= g.start && o.id.end <= g.end))
      if (inside.some((o) => o.role === 'bind' || o.role === 'decl' || (o.role === 'assign' && o.node.operator !== '='))) continue
      const assigns = inside.filter((o) => o.role === 'assign').sort((a, b) => a.id.start - b.id.start)
      const S       = assigns[0]?.stmt
      if (!S || assigns[0].fn !== F) continue
      if (inside.every((o) => o.id.start >= assigns[0].id.start && o.id.end <= S.end)) {
        work.set(assigns[0].node, { ids: inside.filter((o) => o.role === 'ref').map((o) => o.id), others: assigns.slice(1).map((o) => o.node) })
      }
    }
    const assigns = list.filter((o) => o.role === 'assign')
    if (decls.length !== 1 || !noValue(decls[0]) || assigns.length !== 1 || assigns[0].node.operator !== '=' || work.has(assigns[0].node)) continue
    if (assigns[0].fn !== decls[0].fn || assigns[0].loop || list.some((o) => o.role === 'bind')) continue
    once.add(assigns[0].node)
    tainted.delete(name)
  }

  // ── Passe 2 : réécritures. ──────────────────────────────────────────────────
  // variable qui garde un objet du magasin (`t = $$taches.find(f)`, `sous := $$cfg.a`) → clé racine. Déclarée une fois,
  // jamais réaffectée, pas un paramètre (les noms taintés n'y entrent jamais) ; elle vise l'OBJET qu'elle tient :
  // l'écriture `t.fait = v` va à cet objet, puis prévient la clé — aucun chemin à rejouer
  const foundMap = new Map<string, string>()
  // lectures d'une variable de travail suivie → clé racine, posées à sa 1re affectation (cf. work)
  const workIds = new Map<any, string>()

  // variable qui reçoit QUELQUE PART une lecture du magasin (cf. noteStore) → clé de ses lectures, NO_KEY quand elles en
  // lisent plusieurs, par variable (liaison, cf. bindingOf). `storeNames` : les noms des variables déclarées ou affectées
  // (`=`) d'une telle lecture — une autre variable du même nom passe par l'aide douce (cf. SOFT) ; `paramNames` : ceux
  // des autres liaisons (variable d'une boucle, nom d'un motif, valeur par défaut, affectation logique, paramètre d'un
  // rappel), suivis par leur variable seulement — un `t` d'une autre boucle ou d'un autre rappel reste tel qu'écrit
  const storeBindings = new Map<string, string>()
  const storeNames    = new Set<string>()
  const paramNames    = new Set<string>()
  // variable qui tient une COPIE gardant les objets du magasin (`actives := $$l.filter(f)`, le `ref` que CoffeeScript tire
  // pour `for t in $$l.filter(f)`) → clé de ces objets, par variable (cf. copyRoot) : la copie n'est pas au magasin
  // (`actives.push(x)` n'écrit qu'elle), ses éléments le sont (`actives[0].fait = v`)
  const copyNames    = new Set<string>()
  const copyBindings = new Map<string, string>()
  // clé passée à l'aide gardée : `null` pour NO_KEY, aucune clé prévenue
  const keyArg = (root: string) => root === NO_KEY ? 'null' : JSON.stringify(root)

  // variable que désigne un identifiant : la portée la plus proche qui déclare son nom (cf. declScopes), aucune pour un
  // nom libre — `rang:nom`. Le `ref` que CoffeeScript déclare dans deux fonctions, ou un même nom déclaré dans deux
  // fonctions, sont deux variables
  const scopeRanks  = new Map<any, number>()
  const bindingMemo = new Map<any, string>()
  function bindingOf(id: any): string {
    let b = bindingMemo.get(id)
    if (b !== undefined) return b
    let best: any = null
    for (const s of declScopes.get(id.name) ?? []) {
      if (s.start <= id.start && id.end <= s.end && (!best || s.start > best.start || (s.start === best.start && s.end < best.end))) best = s
    }
    if (best && !scopeRanks.has(best)) scopeRanks.set(best, scopeRanks.size)
    b = `${best ? scopeRanks.get(best) : ''}:${id.name}`
    bindingMemo.set(id, b)
    return b
  }

  // clé d'une écriture par un nom qui lit le magasin (cf. noteStore) : celle de sa variable ; une autre variable du même
  // nom (paramètre, autre fonction, autre bloc) ne tient pas cet objet — SOFT pour le nom d'une variable déclarée ou
  // affectée (`=`), rien pour les autres (cf. paramNames)
  const storeKey = (id: any) => {
    if (!storeNames.has(id.name) && !paramNames.has(id.name)) return null
    return storeBindings.get(bindingOf(id)) ?? (storeNames.has(id.name) ? SOFT : null)
  }

  // clé d'un objet qui vaut l'un ou l'autre (`a || b`, ternaire) : la première qui en a une, une clé du magasin plutôt
  // que SOFT
  const pick = (a: string | null, b: string | null) => a === null || (a === SOFT && b !== null) ? b : a

  // tête de l'aide qui écrit un objet atteint (`Set`, `Call`, `Delete`) : gardée, la clé prévenue, ou douce (cf. SOFT)
  const onHead = (aide: string, root: string) => root === SOFT ? `µ._mjs_soft${aide}On(` : `µ._mjs_store${aide}On(${keyArg(root)}, `

  // clé de deux valeurs possibles d'un nom : l'une ou l'autre, NO_KEY quand ce sont deux clés différentes
  const both = (a: string | null, b: string | null) => a === null ? b : b === null || a === b ? a : NO_KEY

  // Helper : analyse un node `expr` et retourne son path s'il est trackable.
  function getPath(expr: any): AliasEntry | null {
    if (!expr) return null
    // `$.x` → ['x'] (origin='local')
    if (expr.type === 'MemberExpression') {
      const tail = expr.computed ? null : expr.property?.name
      const tailComputed = expr.computed ? extractComputedKey(expr.property) : null
      const head = expr.object
      if (head?.type === 'Identifier' && head.name === '$') {
        if (storeOnly) return null
        if (tail) return { path: [tail], origin: 'local' }
        if (tailComputed !== null) return { path: [tailComputed], origin: 'local' }
        return null
      }
      // `µ.store.x` → ['x'] (origin='store'). Clé racine DYNAMIQUE
      // (`µ.store[expr]`) non trackée (conservateur, même limite que `$[cle]`).
      if (isStoreRoot(head)) {
        if (tail) return { path: [tail], origin: 'store' }
        return null
      }
      // Récursif : `$.x.y`, `µ.store.x.y`, `$.x[i]`, etc.
      const headPath = getPath(head)
      if (headPath) {
        if (tail) return { path: [...headPath.path, tail], origin: headPath.origin }
        if (tailComputed !== null) return { path: [...headPath.path, tailComputed], origin: headPath.origin }
      }
    }
    return null
  }

  // clé racine du magasin quand l'objet `expr` est un objet du magasin : élément trouvé (`µ.store.t.find(f)`,
  // `µ.store.m.get(k).meta`, `alias.find(f)`), variable de foundMap ou de travail, ou chaîne partie d'une racine
  // (`µ.store.l[0][a.k]`, qu'aucun chemin n'écrit) — sinon null. L'état local (`$.items.find(f)`) a son filet
  // `_mjs_wrapDeep` ; l'élément d'une copie qui garde les objets du magasin l'est aussi (`filter(f)[0]`, cf. copyRoot), un
  // appel optionnel (`find?.(f)`) ou une autre méthode (`map(f)[0]`) ne sont pas suivis. Un objet fait d'une expression qui peut rendre un objet du magasin (`$$o[k] || {}`, `?? {}`,
  // `$$o[k] ||= {}`, ternaire, virgule, `?.`) prend la clé de la première de ses valeurs possibles qui en a une : son
  // écriture passe par les aides, un objet neuf (`{}`) reçoit l'écriture comme en JavaScript. Ternaire entre deux clés : la seconde n'est prévenue que si elle range l'objet écrit (index du magasin)
  // `Object.getPrototypeOf(x)` ou `Reflect.getPrototypeOf(x)`, appel direct à un seul argument (cf. findRoot)
  function isProtoOf(e: any): boolean {
    const c = e.callee
    return e.type === 'CallExpression' && !e.optional && e.arguments.length === 1 && e.arguments[0].type !== 'SpreadElement' && c.type === 'MemberExpression' && !c.computed && !c.optional && c.object.type === 'Identifier' && (c.object.name === 'Object' || c.object.name === 'Reflect') && c.property.name === 'getPrototypeOf'
  }

  // `nom` : la valeur d'un nom (déclaration, affectation, cf. noteStore et track) — une expression qui peut rendre deux
  // clés différentes (`$$a.get(k) or $$b[0]`, ternaire, `||=`) n'en prévient aucune (NO_KEY), et `await` rend la valeur
  // attendue (l'objet même, quand le magasin ne tient pas une promesse)
  function findRoot(expr: any, nom = false): string | null {
    for (let e = expr; e; ) {
      if (e.type === 'Identifier') {
        // la valeur d'un nom ne prend jamais SOFT : une variable qui ne tient pas d'objet du magasin n'en donne aucun
        const k = workIds.get(e) ?? (tainted.has(e.name) ? null : foundMap.get(e.name)) ?? storeKey(e)
        return nom && k === SOFT ? null : k
      }
      if (e.type === 'MemberExpression' && isStoreRoot(e.object)) return e.computed ? null : e.property.name
      if (e.type === 'MemberExpression') {
        // élément d'une copie qui garde les objets du magasin (`$$l.filter(f)[0]`, `ref[i]` d'une boucle CoffeeScript)
        const c = copyRoot(e.object)
        if (c) return c
        e = e.object
      }
      else if (e.type === 'CallExpression' && !e.optional && e.callee.type === 'MemberExpression' && !e.callee.computed && (FIND_METHODS.has(e.callee.property.name) || POP_METHODS.has(e.callee.property.name))) {
        // élément d'une copie qui garde les objets du magasin (`$$l.filter(f).find(g)`, `copie.at(0)`, `copie.pop()`) ;
        // `pop` et `shift` sur une autre liste rendent un élément qu'elle n'a plus
        const pop = POP_METHODS.has(e.callee.property.name)
        const tp  = pop ? null : getPath(e.callee.object)
        if (tp) return tp.origin === 'store' ? String(tp.path[0]) : null
        const c = copyRoot(e.callee.object)
        if (c || pop) return c
        e = e.callee.object
      }
      // prototype d'un objet du magasin (`Object.getPrototypeOf($$o.m)`, `Reflect.getPrototypeOf`) : la valeur reste celle
      // de JavaScript (lecture nue), une écriture par elle passe par les aides, qui refusent un prototype
      else if (isProtoOf(e)) e = e.arguments[0]
      else if (e.type === 'LogicalExpression') return nom ? both(findRoot(e.left, true), findRoot(e.right, true)) : pick(findRoot(e.left), findRoot(e.right))
      else if (e.type === 'ConditionalExpression') return nom ? both(findRoot(e.consequent, true), findRoot(e.alternate, true)) : pick(findRoot(e.consequent), findRoot(e.alternate))
      else if (e.type === 'AssignmentExpression') {
        if (e.operator === '=') return findRoot(e.right, nom)
        return nom ? both(findRoot(e.left, true), findRoot(e.right, true)) : pick(findRoot(e.left), findRoot(e.right))
      }
      else if (e.type === 'SequenceExpression') e = e.expressions[e.expressions.length - 1]
      else if (e.type === 'ChainExpression') e = e.expression
      else if (nom && e.type === 'AwaitExpression') e = e.argument
      else return null
    }
    return null
  }

  // clé racine des objets d'une COPIE qui les garde (cf. COPY_METHODS) : `$$l.filter(f)`, `slice()`, `concat(…)`,
  // `toSorted()`, `values()` et `entries()` d'une Map…, `Object.values($$o)`, `Object.entries($$o)`, `Array.from($$l)`,
  // `[...$$l]`, ou variable qui en tient une (cf. copyBindings) — sinon null. La copie n'est pas au magasin, ses éléments
  // le sont ; `map`, `flatMap` (le rappel peut rendre des objets neufs), `Array.from(l, f)` et une copie profonde
  // (`structuredClone`, `JSON.parse`) n'en sont pas. Les éléments qu'une copie retire par `splice` (`copie.splice(0, 1)`)
  // en restent ; ceux que le magasin retire lui-même n'y sont plus (comme `pop`)
  function copyRoot(e: any): string | null {
    if (e.type === 'ChainExpression') e = e.expression
    if (e.type === 'Identifier') return copyNames.has(e.name) ? copyBindings.get(bindingOf(e)) ?? null : null
    if (e.type === 'ArrayExpression') {
      let r: string | null = null
      for (const el of e.elements) if (el?.type === 'SpreadElement') r = both(r, itemsRoot(el.argument))
      return r
    }
    if (e.type !== 'CallExpression' || e.optional || e.callee.type !== 'MemberExpression' || e.callee.computed) return null
    const o    = e.callee.object
    const name = e.callee.property.name
    const args = e.arguments
    if (o.type === 'Identifier' && (o.name === 'Object' || o.name === 'Array')) {
      const copie = o.name === 'Object' ? name === 'values' || name === 'entries' : name === 'from'
      return copie && args.length === 1 && args[0].type !== 'SpreadElement' ? itemsRoot(args[0]) : null
    }
    if (name === 'splice') return copyRoot(o)
    if (!COPY_METHODS.has(name)) return null
    let r = itemsRoot(o)
    if (name === 'concat') for (const a of args) r = both(r, itemsRoot(a.type === 'SpreadElement' ? a.argument : a))
    return r
  }

  // clé des ÉLÉMENTS de `e` : ceux d'une copie qui les garde (cf. copyRoot), ou ceux d'un objet du magasin, qui en sont
  // aussi (`for t of $$l`, `$$l.forEach((t) -> …)`)
  function itemsRoot(e: any): string | null {
    return copyRoot(e) ?? findRoot(e, true)
  }

  // clé racine de la valeur d'une variable de travail (cf. findRoot) ; `?.` dans la valeur (`(ref = µ.store.m?.get(k))`) :
  // un maillon vide la laisse vide, rien n'est écrit par elle
  function rootOf(e: any): string | null {
    return findRoot(e.type === 'ChainExpression' ? e.expression : e)
  }

  // segments d'un objet de chaîne `o`, de sa tête à lui (membres et appels)
  function chainOf(o: any): { head: any, segs: any[] } {
    const segs: any[] = []
    let e = o
    while (e.type === 'MemberExpression' || e.type === 'CallExpression') {
      segs.unshift(e)
      e = e.type === 'MemberExpression' ? e.object : e.callee
    }
    return { head: e, segs }
  }

  // texte d'une clé : un nom en littéral, une clé calculée telle quelle — une expression à virgule entre parenthèses,
  // qu'une liste de clés couperait sinon en deux
  const keyText = (s: any) => !s.computed ? JSON.stringify(s.property.name) : s.property.type === 'SequenceExpression' ? `(${ms.slice(s.property.start, s.property.end)})` : ms.slice(s.property.start, s.property.end)

  // valeur liée à un paramètre local de fonction fléchée (cf. bindings) ; `test` : le texte comparé à `null` (maillon `?.`)
  type Binding = { param: string, value: string, test?: string }

  // objet `o` d'une écriture par un objet du magasin (élément trouvé, variable suivie, racine) : chaque maillon `?.` de
  // sa chaîne est testé une fois, son objet lié à un paramètre local (aucune case partagée) ; ses clés, calculées
  // comprises, restent telles qu'écrites, lues comme JavaScript les lit. Rend les liaisons et le texte de l'objet
  function boundChain(o: any): { binds: Binding[], object: string } {
    const { head, segs } = chainOf(o)
    const binds: Binding[] = []
    // tête faite d'une expression (`($$o[k] || {})[k2]`, cf. findRoot) : ses parenthèses, qu'acorn laisse hors du nœud
    let object = head.type === 'Identifier' || head.type === 'ThisExpression' ? ms.slice(head.start, head.end) : `(${ms.slice(head.start, head.end)})`
    for (const s of segs) {
      if (s.type === 'MemberExpression' && s.optional) {
        const param = `_mjs_o${binds.length + 1}`
        binds.push({ param, value: object, test: param })
        object = param
      }
      object += ms.slice(s.type === 'CallExpression' ? s.callee.end : js.lastIndexOf(s.optional ? '?.' : s.computed ? '[' : '.', s.property.start), s.end)
    }
    return { binds, object }
  }

  // liaisons posées autour d'une écriture (cf. Binding) : `((p) => p == null ? vide : CORPS)(valeur)`, une fonction
  // fléchée appelée sur place par liaison, le corps entre `open` et `close`. Un `await` dans ce qui passe dedans (valeur
  // de droite, arguments) : la fonction est `async`, attendue — la suite garde son ordre et sa valeur
  function bindings(binds: Binding[], empty: string, wait: boolean): { open: string, close: string } {
    let open = '', close = ''
    for (const b of binds) {
      open  += `${wait ? '(await (async ' : '('}(${b.param}) => ${b.test ? `${b.test} == null ? ${empty} : ` : ''}`
      close  = `)(${b.value})${wait ? ')' : ''}${close}`
    }
    return { open, close }
  }

  // `await` ou `yield` dans `node`, hors d'une fonction imbriquée : une fonction fléchée qui le reçoit doit être `async`,
  // et aucune ne reçoit un `yield` (l'écriture reste alors telle quelle)
  function suspension(node: any): 'await' | 'yield' | null {
    let found: 'await' | 'yield' | null = null
    walk.recursive(node, null, {
      Function() {},
      AwaitExpression(n: any, st: any, c: any) {
        found ??= 'await'
        c(n.argument, st, 'Expression')
      },
      YieldExpression() {
        found = 'yield'
      },
    })
    return found
  }

  // morceaux d'une cible `objet.clé` qui passe par un objet du magasin : l'objet (texte DÉJÀ RÉÉCRIT de sa source,
  // `ms.slice` : une écriture réécrite dans le prédicat survit ; maillons `?.`, cf. boundChain), la clé
  // (littéral d'un nom, ou texte d'une clé calculée), son accès, et la position du `.`, `?.` ou `[` qui suit l'objet
  function foundParts(m: any): { binds: Binding[], obj: string, key: string, acc: string, sep: number } | null {
    const k = m.property
    if (k.type === 'PrivateIdentifier') return null
    const key = keyText(m)
    const sep = js.lastIndexOf(m.optional ? '?.' : m.computed ? '[' : '.', k.start)
    const { binds, object } = boundChain(m.object)
    // aucun maillon : l'objet tel quel, ses parenthèses comprises
    const obj = binds.length ? object : ms.slice(m.start, sep)
    return { binds, obj, key, acc: m.computed ? `[${key}]` : `.${k.name}`, sep }
  }

  // cible d'écriture d'un objet du magasin (cf. emit-write.ts) : `µ._mjs_storeSetOn` rend la valeur écrite, sa forme
  // directe vaut partout. Relue (`+=`, `++`), la cible lit l'objet, et une clé calculée autre qu'un nom ou un littéral,
  // par les paramètres d'une fonction fléchée (`bind`) : l'objet n'est évalué qu'une fois — le prédicat n'est pas
  // rappelé —, aucune case partagée, et la valeur de droite y garde son ordre (lue après l'objet). Une variable et une
  // clé simple se relisent telles quelles. `?.` n'est jamais dans une cible d'affectation : Civet et CoffeeScript
  // l'écrivent par une variable de travail
  function foundTarget(m: any, root: string, read: boolean, wait = false): WriteTarget | null {
    const p = foundParts(m)
    if (!p || p.binds.length) return null
    const head = onHead('Set', root)
    const k    = m.property
    const obj  = m.object.type === 'Identifier'
    const key  = !m.computed || k.type === 'Identifier' || k.type === 'Literal'
    if (!read || (obj && key)) return { set: `${head}${p.obj}, ${p.key}, `, read: `${p.obj}${p.acc}`, returnsValue: true }
    const o      = obj ? p.obj : '_mjs_o'
    const params = [obj ? '' : '_mjs_o', key ? '' : '_mjs_k'].filter(Boolean).join(', ')
    const values = [obj ? '' : p.obj, key ? '' : p.key].filter(Boolean).join(', ')
    return { set: `${head}${o}, ${key ? p.key : '_mjs_k'}, `, read: `${o}${key ? p.acc : '[_mjs_k]'}`, returnsValue: true, bind: { params, values, wait } }
  }

  function extractComputedKey(node: any): string | number | DynSegment | null {
    if (!node) return null
    // la clé que le moteur lit : une expression régulière vaut son texte (`/a/ig` → '/a/gi', drapeaux dans l'ordre du moteur), un BigInt
    // ses chiffres en base dix (`0x10n` → '16') — jamais l'objet lui-même, que le chemin compilé ne sait pas écrire
    if (node.type === 'Literal' && node.regex) return node.value instanceof RegExp ? String(node.value) : `/${node.regex.pattern}/${node.regex.flags}`
    if (node.type === 'Literal' && typeof node.value === 'bigint') return String(node.value)
    if (node.type === 'Literal') return node.value as string | number
    // Identifier dynamique : on garde le nom de var, le code généré
    // utilisera la valeur runtime via interpolation
    if (node.type === 'Identifier') return { dyn: node.name }
    return null
  }

  // Sérialise un Path en code JS : `['box', 'width']` ou `['list', i]` (dyn)
  function pathToJsLiteral(path: Path): string {
    const parts = path.map(p => {
      if (typeof p === 'number') return String(p)
      if (typeof p === 'object' && p !== null) return p.dyn
      return JSON.stringify(p)
    })
    return `[${parts.join(', ')}]`
  }

  // Statisation $$ — motif de déstructuration :
  // collecte récursive des cibles MemberExpression du STORE (`getPath(...)` →
  // origin 'store') dans un ArrayPattern/ObjectPattern, JAMAIS le RHS d'un
  // AssignmentPattern (une valeur par défaut est une LECTURE, pas une cible
  // d'écriture). Miroir de `collectStateTargets` (transform-reactive.ts), en
  // plus général : celle-ci ne sait matcher QUE `$.x` (depth 1, comparaison de
  // nom en dur) ; ici on délègue à `getPath` (déjà capable de la profondeur
  // ET des deux origines) et on RETIENT seulement 'store' — les cibles
  // 'local' ($.x profondeur 1, déjà réécrites par transformReactiveWrites qui
  // tourne AVANT ; $.o.k profondeur ≥ 2, couvert par le filet Proxy
  // _mjs_wrapDeep) sont laissées telles quelles, elles n'ont besoin de rien ici.
  // Une feuille sans chemin qui passe par un objet du magasin (`[da[k1][k2]] = v` par une variable suivie, `[$$o.a[k +
  // ''][k2]] = v`, cf. findRoot) reçoit l'écriture de cet objet (`µ._mjs_storeSetOn`, cf. foundTarget) : la clé racine
  // prévenue
  function collectStoreTargets(pattern: any, out: { node: any, set: string }[]): void {
    forEachPatternLeaf(pattern, (leaf: any) => {
      if (leaf.type !== 'MemberExpression') return
      const tp = getPath(leaf)
      if (tp) {
        if (tp.origin === 'store') out.push({ node: leaf, set: pathTarget(tp, '').set })
        return
      }
      const root = findRoot(leaf.object)
      const t    = root && !suspension(leaf) ? foundTarget(leaf, root, false) : null
      if (t) out.push({ node: leaf, set: t.set })
    })
  }

  // Parenthèses autour de la valeur (`$$x = ((...) + 1)`, `$$x = (noter(), 2)`) : acorn ne les
  // inclut PAS dans `node.right` mais les consomme dans `node.end` — la réécriture va jusqu'à
  // `rhsStart` et ferme par `closeRhs` (emit-write.ts) : parenthèses superflues retirées,
  // celles d'une expression à virgule gardées (sans elles, plusieurs arguments, la première valeur
  // écrite au lieu de la dernière).

  // Cible d'écriture d'un chemin (cf. emit-write.ts) : `µ._mjs_deepSet` rend déjà la valeur écrite, sa forme
  // directe vaut aussi là où la valeur est lue ; `µ._storeSet`/`µ._mjs_storeDeepSet` ne rendent rien — valeur
  // LUE (`$a = $$b = 5`, `return $$x = v`, `if $$sel = trouver()`), la fermeture rend la valeur écrite.
  // `read` : le texte de la cible, qui relit la valeur courante
  function pathTarget(tp: AliasEntry, read: string): WriteTarget {
    if (tp.origin === 'local') return { set: `µ._mjs_deepSet(_mjsThis, ${pathToJsLiteral(tp.path)}, `, read, returnsValue: true }
    if (tp.path.length === 1) return { set: `µ._storeSet(${JSON.stringify(tp.path[0])}, `, read }
    return { set: `µ._mjs_storeDeepSet(${JSON.stringify(tp.path[0])}, ${pathToJsLiteral(tp.path.slice(1))}, `, read }
  }

  // suppression d'un chemin du magasin : `delete $$x` → `µ._mjs_storeDelete("x")`, plus profond → `µ._mjs_storeDeepDelete`
  function storeDelete(path: Path): string {
    return path.length === 1 ? `µ._mjs_storeDelete(${JSON.stringify(path[0])})` : `µ._mjs_storeDeepDelete(${JSON.stringify(path[0])}, ${pathToJsLiteral(path.slice(1))})`
  }

  // variable qui prend sa valeur d'un objet du magasin — élément trouvé (`t := $$taches.find(f)`), chemin (`sous :=
  // $$cfg.a`, `it := $$liste[i]`) : sa déclaration, ou l'affectation unique d'une variable déclarée sans valeur (cf.
  // once). Elle vise l'OBJET qu'elle tient : ses écritures vont à cet objet, comme en JavaScript, puis préviennent la
  // clé (cf. foundMap) — aucun chemin rejoué, un `$$cfg = autre` ou un `unshift` entre les deux ne détournent rien. Une
  // copie (`$$liste.slice()`) ou un objet de l'état local (`ancien := $a`, filet `_mjs_wrapDeep`) n'ont pas de racine
  // (cf. findRoot) ; sa valeur reste une lecture nue (en-tête)
  function track(name: string, init: any): void {
    const root = findRoot(init, true)
    if (root) foundMap.set(name, root)
  }

  // la variable de `id` tient une valeur de clé `r` (cf. bindingOf) : sa clé, NO_KEY quand elle en tient deux ; rend vrai
  // si la variable a changé
  function noteBinding(map: Map<string, string>, id: any, r: string | null): boolean {
    if (!r) return false
    const b = bindingOf(id)
    const k = map.get(b)
    if (r === k || k === NO_KEY) return false
    map.set(b, k === undefined ? r : NO_KEY)
    return true
  }

  // variable qui reçoit QUELQUE PART une lecture du magasin — déclaration, affectation (`=`, `||=`, `&&=`, `??=`), variable
  // d'une boucle `for…of` ou `for…in` sur le magasin ou sur une copie qui garde ses objets, nom d'une déstructuration,
  // paramètre par sa valeur par défaut ou qui reçoit l'élément d'un rappel —, suivie ou non : une écriture par elle (`lu[k]
  // = v`, `delete lu[k]`, `lu.push(x)`) passe toujours par l'aide gardée, qui refuse un nom réservé, un prototype, une
  // fonction, même quand elle est réaffectée ou reprise dans une boucle (noms « taint », jamais pris pour un alias) ;
  // elle prévient la clé que lit sa variable (cf. bindingOf) quand elle n'en lit qu'une, aucune quand elle en lit
  // plusieurs (NO_KEY). Une autre variable du même nom ne tient pas cet objet (cf. storeKey) : elle écrit comme
  // JavaScript, par l'aide douce quand `byName` (déclaration, affectation `=` d'un nom, cf. storeNames). Seules ces
  // écritures-là paient une aide. Tours répétés tant qu'une variable change (une clé, puis NO_KEY) : une chaîne (`b := a`,
  // `a := $$o[k]`) se résout dans n'importe quel ordre. `part` : le nom tient une partie de `init` (cf. itemsRoot). Rend
  // vrai si la variable a changé
  function noteStore(id: any, init: any, part = false, byName = false): boolean {
    const r = part ? itemsRoot(init) : findRoot(init, true)
    if (!noteBinding(storeBindings, id, r)) return false
    ;(byName ? storeNames : paramNames).add(id.name)
    return true
  }
  let encore = true
  // motif lié à une valeur (`{ a } := $$prefs`, `[t] = $$liste`, `for { meta } of $$fiches`) : chacun de ses noms en tient
  // une partie, ou sa valeur par défaut (`{ a = $$o.b } = …`, `(t = $$o.a) ->`). `part` : le nom tient une partie de
  // `init` (élément d'une boucle, d'un rappel, d'un motif) ; sinon `init` même, qui peut être une copie (cf. copyBindings)
  const notePattern = (p: any, init: any, part = false, byName = false): void => {
    if (!p) return
    if (p.type === 'Identifier') {
      if (init && noteStore(p, init, part, byName)) encore = true
      if (init && !part && noteBinding(copyBindings, p, copyRoot(init))) {
        copyNames.add(p.name)
        encore = true
      }
    }
    else if (p.type === 'AssignmentPattern') {
      notePattern(p.left, p.right, false, byName)
      notePattern(p.left, init, part, byName)
    }
    else if (p.type === 'ArrayPattern') for (const el of p.elements) notePattern(el, init, true, byName)
    else if (p.type === 'ObjectPattern') for (const pr of p.properties) notePattern(pr.type === 'RestElement' ? pr.argument : pr.value, init, true, byName)
    else if (p.type === 'RestElement') notePattern(p.argument, init, part, byName)
  }
  const noteLoop = (n: any) => notePattern(n.left.type === 'VariableDeclaration' ? n.left.declarations[0].id : n.left, n.right, true)
  // `Array.prototype.forEach` (une méthode à rappel d'une liste), objet de `.call(l, f)`
  const isArrayMethod = (m: any) => m.type === 'MemberExpression' && !m.computed && m.object.type === 'MemberExpression' && !m.object.computed && m.object.object.type === 'Identifier' && m.object.object.name === 'Array' && m.object.property.name === 'prototype' && CALLBACK_METHODS.has(m.property.name)
  while (encore) {
    encore = false
    walk.simple(ast, {
      // un nom déclaré ou affecté (`=`) : suivi aussi par son nom (cf. storeNames)
      VariableDeclarator(n: any) {
        notePattern(n.id, n.init, false, n.id.type === 'Identifier')
      },
      AssignmentExpression(n: any) {
        if (n.operator === '=' || LOGICAL_ASSIGN.has(n.operator)) notePattern(n.left, n.right, false, n.operator === '=' && n.left.type === 'Identifier')
      },
      ForOfStatement: noteLoop,
      ForInStatement: noteLoop,
      Function(n: any) {
        for (const p of n.params) notePattern(p, null)
      },
      // paramètre qui reçoit l'élément d'un rappel (cf. CALLBACK_METHODS) : une partie de la liste, suivi par sa variable ;
      // méthode écrite en clé littérale (`$$l['forEach'](f)`), rappel de `Array.from(l, f)` (second argument) et méthode
      // d'une liste appelée sur `l` (`Array.prototype.forEach.call(l, f)`)
      CallExpression(n: any) {
        const c   = n.callee
        const nom = c.type !== 'MemberExpression' ? null : !c.computed ? c.property.name : c.property.type === 'Literal' && typeof c.property.value === 'string' ? c.property.value : null
        let i     = nom === null ? undefined : CALLBACK_METHODS.get(nom)
        let liste = c.object
        let f     = n.arguments[0]
        if (nom === 'from' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'Array') [i, liste, f] = [0, n.arguments[0], n.arguments[1]]
        else if (nom === 'call' && !c.computed && isArrayMethod(c.object)) [i, liste, f] = [CALLBACK_METHODS.get(c.object.property.name), n.arguments[0], n.arguments[1]]
        if (i !== undefined && liste && liste.type !== 'SpreadElement' && f && isFunction(f)) notePattern(f.params[i], liste, true, false)
      },
    })
  }

  walk.ancestor(ast, {
    // déclarations `let/const/var X = µ.store.path`, `X = $$l.find(f)`, `X = autreVariableSuivie` (cf. track)
    VariableDeclarator(node: any) {
      if (node.id?.type !== 'Identifier' || !node.init) return
      if (tainted.has(node.id.name)) return
      track(node.id.name, node.init)
    },

    // Mutation directe sur alias : `obj.x = y` → `µ._mjs_deepSet(_mjsThis, [...alias, 'x'], y)`
    // Statisation $$ : racine store → `µ._mjs_storeDeepSet(rootKey, [...tail], y)`.
    AssignmentExpression(node: any, _st: any, ancestors: any[]) {
      // affectation d'un nom : 1re affectation d'une variable de travail (cf. work), ou affectation unique qui vaut
      // déclaration (cf. once)
      if (node.left.type === 'Identifier') {
        const w    = work.get(node)
        const root = w ? rootOf(node.right) : null
        if (root) {
          for (const id of w!.ids) workIds.set(id, root)
          // une autre valeur que celles de cette clé (`ref = ref.a` en part) : la variable n'est pas suivie
          if (w!.others.some((a: any) => rootOf(a.right) !== root)) for (const id of w!.ids) workIds.delete(id)
        }
        else if (once.has(node)) track(node.left.name, node.right)
        return
      }
      const isCompound = COMPOUND_OPS.has(node.operator)
      if (node.operator !== '=' && !isCompound) return
      const target = node.left

      // Statisation $$ — motif de déstructuration (ArrayPattern/ObjectPattern)
      // CIBLANT LE STORE : `[$$a, $$b]
      // = [$$b, $$a]` (compilé `[µ.store.a, µ.store.b] = [µ.store.b,
      // µ.store.a]`) échappait à la garde MemberExpression ci-dessous — la
      // mutation passait par l'accesseur natif À NU, aucun `µ._storeSet`,
      // aucune notification si l'accesseur avait disparu. Panne réelle :
      // `delete $$a` PUIS, dans le MÊME handler, `[$$a, $$b] =
      // [$$b, $$a]` — l'accesseur de `a` vient d'être supprimé par le delete
      // qui précède, la lecture RHS `µ.store.a` rend `undefined` (propriété
      // absente), ce `undefined` s'écrit dans `b` (notifié via l'accesseur
      // natif de `b`, encore vivant : `b` perd sa valeur en silence) et `a`
      // redevient une propriété PLATE, écrite hors accesseur — plus jamais
      // notifiée (le trou visé par le CORRECTIF ci-dessus revient par
      // cette porte). Même patron que le motif LOCAL de transform-reactive.ts
      // (collectStateTargets, IIFE `_mjsD*`/`_mjsR`) — nommage `_mjsS*`/`_mjsSR`
      // DIFFÉRENT ici pour ne jamais collisionner sur un motif MIXTE (`[$.a,
      // $$b] = …`, réécrit par les DEUX passes, l'une dans l'autre :
      // transformReactiveWrites tourne AVANT, applyPathTracking réécrit ensuite
      // l'IIFE qu'elle a laissée). Les cibles 'local' du motif ($.x, déjà
      // réécrites par transformReactiveWrites ; $.o.k profond, couvert par le
      // filet Proxy _mjs_wrapDeep) sont laissées telles quelles — seul le store,
      // sans AUCUN filet, a besoin de cette réécriture.
      if (node.operator === '=' && (target.type === 'ArrayPattern' || target.type === 'ObjectPattern')) {
        const storeTargets: { node: any, set: string }[] = []
        collectStoreTargets(target, storeTargets)
        if (storeTargets.length === 0) return // motif sans cible store, intouché (local géré ailleurs)

        // ASI, `void`, parenthèses du motif : même forme que le motif LOCAL (cf. emitPattern)
        emitPattern(ms, js, node, ancestors, storeTargets.map(t => t.node), storeTargets.map(t => t.set), '_mjsS', '_mjsSR')
        changed = true
        return
      }

      if (target.type !== 'MemberExpression') return

      const tp = getPath(target)
      if (!tp) {
        // `yield` dans la valeur : la forme directe seulement (`µ._mjs_storeSetOn(…, yield v)`, arguments évalués dans
        // l'ordre de JavaScript), aucune fonction fléchée ne peut le recevoir
        const root = findRoot(target.object)
        const wait = root ? suspension(node.right) : null
        const t    = root ? foundTarget(target, root, isCompound, wait === 'await') : null
        if (t && !(wait === 'yield' && t.bind)) {
          emitAssign(ms, js, node, ancestors, t)
          changed = true
        }
        return
      }
      // Le top-level $.x = y reste géré par transformReactiveWrites (le filet
      // Proxy `_mjs_wrapDeep` suffit côté 'local', AUCUNE réécriture ici). Le
      // top-level `$$x = y` (origin 'store', profondeur 1) était laissé à
      // l'accesseur natif `µ.store.x` (set trap) — CORRECTIF : cet accesseur
      // DISPARAÎT si `_mjs_storeDelete` a supprimé
      // la clé (`delete µ.store[key]`), une réassignation ultérieure recrée
      // alors une propriété PLATE (plus aucune notification, `_storeDeclare`
      // skip silencieusement toute clé déjà `hasOwnProperty`). On route donc
      // AUSSI le top-level store par l'API notifiante explicite (`µ._storeSet`),
      // jamais par l'accesseur — ceinture et bretelles avec la conversion
      // plat→accesseur posée dans `_storeDeclare` (mjs_store_globals.ts).
      if (tp.origin === 'local' && tp.path.length < 2) return

      // Compound (`+=` etc.) : seule l'origine 'store' est traitée ici (cf.
      // commentaire COMPOUND_OPS plus haut) — 'local' reste skip,
      // `transformReactiveWrites`/le filet Proxy `_mjs_wrapDeep` suffisent déjà
      // pour ce cas (« gérés ailleurs »). Court-circuit `||=`/`&&=`/`??=` :
      // `baseOp` EST le vrai opérateur JS (`||`/`&&`/`??`), le rhs n'est donc
      // évalué QUE si le court-circuit le permet (sémantique native préservée) ;
      // `_storeSet`/`_mjs_storeDeepSet` sautent en plus l'écriture+notification si
      // la valeur calculée est identique à l'existante (cas où le court-circuit
      // renvoie la valeur de gauche inchangée).
      if (isCompound) {
        if (tp.origin !== 'store') return
        emitAssign(ms, js, node, ancestors, pathTarget(tp, js.slice(target.start, target.end)))
        changed = true
        return
      }

      // Édits de BORDURE : le chunk RHS reste en place dans MagicString, donc
      // les transformations déjà appliquées à l'intérieur (post-ordre :
      // `$.y++`, assignations imbriquées) survivent — un overwrite global
      // recopiait le source ORIGINAL du RHS et les perdait.
      // `µ._mjs_deepSet` rend déjà la valeur écrite : sa forme directe vaut aussi là où la valeur est lue.
      emitAssign(ms, js, node, ancestors, pathTarget(tp, ''))
      changed = true
    },

    // STATISATION — `$$obj.a++`/`--` (depth >= 2, origine 'store'
    // uniquement, même raison que ci-dessus : aucun filet Proxy sur le store).
    // CORRECTIF : le top-level `$$x++`/`--$$x`
    // (depth === 1) était laissé à l'accesseur natif (même trou que
    // AssignmentExpression ci-dessus) : traité ici aussi, via `µ._storeSet`
    // (pas `_mjs_storeDeepSet`, dont la navigation par chemin ne supporte pas un
    // path vide). Fidélité pré/post-fixe : même schéma IIFE que transform-reactive.ts.
    UpdateExpression(node: any, _st: any, ancestors: any[]) {
      const target = node.argument
      if (!target || target.type !== 'MemberExpression') return
      const tp = getPath(target)
      if (!tp) {
        const root = findRoot(target.object)
        const wait = root ? suspension(target) : null
        const t    = root && wait !== 'yield' ? foundTarget(target, root, true, wait === 'await') : null
        if (t) {
          emitUpdate(ms, node, ancestors, t)
          changed = true
        }
        return
      }
      if (tp.origin !== 'store') return

      // valeur non lue (instruction seule…) : forme DIRECTE, qui commence par `µ` — les formes fidèles
      // commencent par `(` et Civet n'écrit pas de point-virgule : posées après une autre ligne, elles
      // étaient lues comme l'appel de cette ligne (« … is not a function » au clic). Même règle que
      // l'état local (transform-reactive.ts).
      // `(+…)` : même sémantique JS que le state local (transform-reactive.ts) — `++`/`--`
      // convertissent TOUJOURS l'opérande en nombre. Prefix : la cible relue APRÈS
      // l'écriture porte déjà la valeur numérique (pas de reconversion nécessaire) ;
      // postfix : `_v` (valeur AVANT écriture, capturée une seule fois) doit être
      // convertie à la fois pour le calcul et pour l'ancienne valeur rendue. Cf. emitUpdate
      emitUpdate(ms, node, ancestors, pathTarget(tp, js.slice(target.start, target.end)))
      changed = true
    },

    // Méthodes mutatives sur alias : `arr.push(x)` → `µ._mjs_deepCall(_mjsThis, path, 'push', [x])`
    // Statisation $$ : racine store → `µ._mjs_storeDeepCall(rootKey, [...tail], method, args)`
    // (`$$arr.push(x)` à la racine même : rootKey='arr', tail=[]).
    // Escape auto-detection retirée : trop de faux positifs sur
    // CallExpression (Object.keys, Math.min, console.log, etc.). Le runtime
    // Proxy `_mjs_wrapDeep` reste le filet de sécurité pour les cas non trackés.
    CallExpression(node: any, _st: any, ancestors: any[]) {
      const callee = node.callee
      if (callee?.type !== 'MemberExpression') return
      // clé calculée (`$o.m[push]()`) : la méthode est celle que nomme la valeur de la clé, pas le nom écrit entre les
      // crochets — l'appel reste tel quel
      if (callee.computed) return
      const methodName = callee.property?.name
      if (!methodName || !ALL_MUTATIVE.has(methodName)) return
      // LIMITE CONNUE — la réécriture ne teste
      // QUE le NOM de méthode (`ALL_MUTATIVE`), jamais le TYPE : `$.form.set(k,v)`
      // / `$.o.add(y)` / `$.o.clear()` sur un OBJET MÉTIER à méthode homonyme (pas
      // un vrai Map/Set) partent aussi en `µ._mjs_deepCall`. Choix CONSERVATEUR assumé :
      // prouver la collection-ité exigerait l'info de type de l'analyzer (indispo
      // ici, coûteux) ; le runtime `µ._mjs_deepCall` + le filet Proxy `_mjs_wrapDeep`
      // absorbent le cas. Documenté plutôt que restreint (restreindre ferait perdre
      // la notification compilée sur de vrais Map/Set aliasés).

      const tp   = getPath(callee.object)
      // sans chemin : méthode appelée à travers un objet du magasin (`µ.store.t.find(f).tags.push(x)`, cf. findRoot)
      const root = tp ? null : findRoot(callee.object)
      const p    = root ? foundParts(callee) : null
      if (!tp && !p) return

      // `?.` dans la chaîne (`$liste?.push(x)`, `$o?.items.push(x)`, `$liste.push?.(x)`) : un maillon
      // vide arrête TOUTE la chaîne, sans erreur — l'appel notifiant passe derrière le test du
      // maillon : `G == null ? void 0 : µ._mjs_deepCall(…)`. `G` = l'objet du maillon optionnel le
      // plus extérieur, écrit avec ses propres `?.`. Pour l'état local, `G` se lit par
      // `_mjsThis._state` (l'objet que le code appelle `$`) : une écriture réécrite n'est jamais une
      // lecture pour les dépendances d'un `µeffect` (effect-deps.ts), le test non plus.
      // la recherche passe aussi les appels d'un élément trouvé (`$$m?.get(k).tags.push(x)`), absents d'un chemin
      let maillon: any = null
      for (let m = callee; !maillon && m; m = m.type === 'MemberExpression' ? m.object : m.type === 'CallExpression' ? m.callee : null) {
        if (m.type === 'MemberExpression' && m.optional) maillon = m
      }
      const garde = node.optional ? callee : maillon?.object
      // la chaîne entière (`$$l?.push(1).toFixed()`) : l'appel, puis les maillons qui le prolongent
      let k = ancestors.length - 1
      while (k > 1 && ((ancestors[k - 1].type === 'MemberExpression' && ancestors[k - 1].object === ancestors[k]) ||
        (ancestors[k - 1].type === 'CallExpression' && ancestors[k - 1].callee === ancestors[k]))) k--
      const chaine = garde && ancestors[k - 1]?.type === 'ChainExpression' ? ancestors[k - 1] : null
      if (garde && !chaine) return
      let avant = '', apres = '', objet = p?.obj
      if (chaine) {
        const texte = js.slice(garde.start, garde.end)
        if (tp?.origin === 'local' && texte[0] !== '$') return
        const posChaine = ancestors.slice(0, k)
        const lue = !writeValueUnused(posChaine)
        if (tp) {
          apres = lue ? ')' : ''
          avant = `${lue ? asiGuard(posChaine) + '(' : ''}${tp.origin === 'local' ? '_mjsThis._state' + texte.slice(1) : texte} == null ? void 0 : `
        }
        else {
          // objet du magasin : chaque maillon testé une fois, son objet tenu par un paramètre local (cf. boundChain),
          // la suite de la chaîne repart de lui. `?.` sur la méthode (`tags?.push(x)`) ou sur l'appel (`push?.(x)`) :
          // l'objet de la méthode est lié à son tour, puis testé, ou sa méthode
          const wait = suspension(node)
          if (wait === 'yield') return
          const binds = [...p!.binds]
          if (callee.optional || node.optional) {
            const param = `_mjs_o${binds.length + 1}`
            binds.push({ param, value: objet!, test: [callee.optional ? param : '', node.optional ? `${param}.${methodName}` : ''].filter(Boolean).join(' == null || ') })
            objet = param
          }
          const b = bindings(binds, 'void 0', wait === 'await')
          avant = asiGuard(posChaine) + b.open
          apres = b.close
        }
      }

      // `head` = tête d'appel déjà fermée par sa 1ʳᵉ virgule (`prefix(path, `
      // pour 'local' ; `prefix(rootKey, path, ` pour 'store' ; `prefix(rootKey, objet, ` pour un élément trouvé)
      const head = !tp
        ? `${onHead('Call', root!)}${objet}, `
        : tp.origin === 'local'
          ? `µ._mjs_deepCall(_mjsThis, ${pathToJsLiteral(tp.path)}, `
          : `µ._mjs_storeDeepCall(${JSON.stringify(tp.path[0])}, ${pathToJsLiteral(tp.path.slice(1))}, `

      const args = node.arguments ?? []
      if (args.length === 0) {
        ms.overwrite(node.start, node.end, `${avant}${head}'${methodName}', [])`)
      } else {
        // Bordures uniquement (cf. AssignmentExpression) : les arguments
        // restent en place, leurs édits imbriqués survivent — leurs parenthèses aussi
        // (`$liste.push((a, b))` pousse UN élément) : la réécriture s'arrête à la parenthèse
        // ouvrante de l'appel et reprend à sa fermante, la dernière du nœud.
        ms.overwrite(node.start, js.indexOf('(', callee.end) + 1, `${avant}${head}'${methodName}', [`)
        ms.overwrite(node.end - 1, node.end, '])')
      }
      if (apres) ms.appendLeft(chaine.end, apres)
      changed = true
    },

    // Suppression de clé sur état/alias : `delete $.obj.clé` (ou `delete alias.x`)
    // → `µ._mjs_deepDelete(_mjsThis, [...path])`. Sans ça, `delete` mutait bien la
    // cible mais ne NOTIFIAIT jamais → aucun re-render (le trap `deleteProperty`
    // du Proxy `µ.state` ne couvre que les STORES, pas les `$.` d'un composant).
    // On émet dès la profondeur 1 : le top-level `delete $.x` n'est PAS vu par
    // transformReactiveWrites (qui ne traite que les AssignmentExpression), donc
    // c'est bien ici qu'on le câble ; `delete $[expr]` aussi (clé évaluée à l'exécution).
    // Plus bas, les clés computées non littérales (`delete $.o[expr]`) donnent un path nul
    // → laissées brutes : l'enveloppe de `$.o` prévient la suppression.
    //
    // Statisation $$ : `delete $$x` (profondeur racine, 1 segment) →
    // `µ._mjs_storeDelete('x')` (fonction TOP-LEVEL dédiée, contrat runtime) ;
    // `delete $$obj.a.b` (profondeur >= 2) → `µ._mjs_storeDeepDelete('obj', ['a','b'])`.
    UnaryExpression(node: any, _st: any, ancestors: any[]) {
      if (node.operator !== 'delete') return
      const target = node.argument
      // `?.` dans la cible (`delete $$m.get(k)?.meta`, `delete $$taches[0]?.note`, que Civet garde tels quels) : un
      // maillon vide arrête la suppression sans erreur (`true`, comme en JavaScript), sinon elle passe par l'aide qui
      // prévient la clé
      if (target?.type === 'ChainExpression' && target.expression.type === 'MemberExpression') {
        const m  = target.expression
        const tp = getPath(m)
        let out  = ''
        if (tp?.origin === 'store') {
          let maillon: any = null
          for (let e = m; !maillon && e.type === 'MemberExpression'; e = e.object) if (e.optional) maillon = e
          if (maillon) out = `${ms.slice(maillon.object.start, maillon.object.end)} == null ? true : ${storeDelete(tp.path)}`
        }
        const root = tp ? null : findRoot(m.object)
        const p    = root ? foundParts(m) : null
        const wait = p ? suspension(m) : null
        if (p && wait !== 'yield') {
          // chaque maillon testé une fois, son objet tenu par un paramètre local (cf. boundChain) ; `?.` sur la clé
          // supprimée (`get(k)?.tags`) : son objet lié à son tour, puis testé
          const binds = [...p.binds]
          let obj     = p.obj
          if (m.optional) {
            const param = `_mjs_o${binds.length + 1}`
            binds.push({ param, value: obj, test: param })
            obj = param
          }
          const { open, close } = bindings(binds, 'true', wait === 'await')
          out = `${open}${onHead('Delete', root!)}${obj}, ${p.key})${close}`
        }
        if (out) {
          ms.overwrite(node.start, node.end, `${asiGuard(ancestors)}(${out})`)
          changed = true
        }
        return
      }
      if (!target || target.type !== 'MemberExpression') return
      const tp = getPath(target)
      if (!tp) {
        // `delete $[k]` (clé faite d'une expression) : comme `delete $.x`, par l'aide qui prévient la variable et périme les
        // valeurs dérivées qui la lisent — la clé reste en place, évaluée une fois
        if (!storeOnly && target.computed && target.object.type === 'Identifier' && target.object.name === '$') {
          ms.overwrite(node.start, target.property.start, 'µ._mjs_deepDelete(_mjsThis, [')
          ms.overwrite(target.property.end, node.end, '])')
          changed = true
          return
        }
        // à travers un objet du magasin : `µ._mjs_storeDeleteOn(rootKey, objet, clé)`
        const root = findRoot(target.object)
        const p    = root ? foundParts(target) : null
        if (p) {
          ms.overwrite(node.start, node.end, `${onHead('Delete', root!)}${p.obj}, ${p.key})`)
          changed = true
        }
        return
      }
      if (tp.path.length < 1) return
      ms.overwrite(node.start, node.end, tp.origin === 'local' ? `µ._mjs_deepDelete(_mjsThis, ${pathToJsLiteral(tp.path)})` : storeDelete(tp.path))
      changed = true
    },
  })

  return passResult(ms, js, changed, 'path-tracker')
}
