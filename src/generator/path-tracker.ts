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
// (mjs_store_globals.ts, _mjsStoreReject) — aucun coût à la lecture ; un objet relu (`+=`, `++`) ou testé (`?.`) est
// tenu par un paramètre local (cf. bindings), aucune case partagée. La valeur d'une variable suivie reste une lecture
// nue, comme en JavaScript
//
// Pour les escapes (function call, push, throw, yield, alias non trackable),
// la passe ne pose aucun wrap (l'ancien `µ._mjs_makeDeepProxy(_mjsThis, path)` est retiré).
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
import { asiGuard, closeRhs, emitAssign, emitPattern, emitUpdate, loneStatement, setBlock, rhsStart, writeValueUnused, type WriteTarget } from './emit-write.js'
import { selfWriteError, SELF_WRITE_STORE } from '../sigils.js'

/** Segment dynamique (`$.x[k]` → valeur runtime de `k`). Marqueur OBJET :
 *  l'ancien préfixe string `__dyn:` était forgeable par une clé littérale
 *  `$.x["__dyn:alert(1)"]` → code émis brut dans le path. */
// `effet` : clé faite d'une expression qui agit (appel, `++`, affectation, `await`…) — relue par une écriture qui lit sa cible
// (`+=`, `++`), elle passe par un paramètre (cf. pathTarget), évaluée une fois
type DynSegment = { dyn: string, effect?: true }
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
  /** chemin d'un ÉLÉMENT de liste (variable d'une boucle `{for}`, paramètre d'un rappel, cf. elemAlias) : `test` relit ce chemin au
   *  moment de l'écriture et vérifie qu'il mène encore à cet objet — l'appel compilé seulement alors, l'écriture telle qu'écrite sinon */
  guard?: Guard
}

// garde d'un élément de liste (cf. AliasEntry.guard) : `racine` la variable de la liste, `params` les paramètres à poser aux rappels
// (le sien, ceux des rappels qui l'entourent) la première fois qu'une écriture s'en sert
interface Guard { test: string, root: string, params: (() => void)[] }

// opérateurs composés (`+=` etc., COMPOUND_OPS d'ast-helpers.ts), `++`, `--` et cibles d'un motif sur un chemin profond : lecture
// et écriture explicites, pour le magasin (`$$obj.a += v`, qui n'a aucun filet : `µ.store.obj` rend l'objet BRUT) comme pour l'état
// local (`$.o.a += v`, profondeur 2 et plus), avec ou sans l'enveloppe `_mjs_wrapDeep` — l'aide compilée écrit l'objet brut et
// prévient une fois, le piège de l'enveloppe ne voit rien

// Méthodes mutatives connues par type d'objet — nécessaires pour propager
// l'invalidation au runtime quand on appelle .push(), .splice(), etc. ; celles d'une `Date` sont la liste du cœur
// (`MJS_DATE_MUTATORS`, mjs_element.ts)
const MUTATIVE_METHODS: Record<string, Set<string>> = {
  Array: new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']),
  Map: new Set(['set', 'delete', 'clear']),
  Set: new Set(['add', 'delete', 'clear']),
  Date: new Set(['setTime', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds', 'setUTCFullYear', 'setUTCMonth', 'setUTCDate', 'setUTCHours', 'setUTCMinutes', 'setUTCSeconds', 'setUTCMilliseconds', 'setYear']),
}

// Toutes les méthodes mutatives confondues (pour détection conservatrice)
const ALL_MUTATIVE = new Set([
  ...MUTATIVE_METHODS.Array,
  ...MUTATIVE_METHODS.Map,
  ...MUTATIVE_METHODS.Set,
  ...MUTATIVE_METHODS.Date,
])

// réglage `proxy: false` (cf. avis) : méthodes appelées sans que leur valeur soit lue qui ne modifient pas l'objet (lecture d'une
// liste ou d'une chaîne, promesse, élément du DOM) — aucun avertissement ; `forEach` a sa propre règle (rappel venu d'ailleurs)
const NO_WRITE = new Set(['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'reduce', 'reduceRight', 'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'concat', 'at', 'flat', 'keys', 'values', 'entries', 'get', 'has', 'toString', 'toLocaleString', 'valueOf', 'then', 'catch', 'finally', 'focus', 'blur', 'click', 'scrollIntoView', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'postMessage', 'play', 'pause', 'abort', 'close', 'send'])

// fonctions qui ne modifient pas ce qu'elles reçoivent (cf. avis) : leur appel ne fait jamais avertir
const NO_WRITE_FN = /^(?:console\.\w+|JSON\.\w+|Object\.(?:keys|values|entries|freeze|isFrozen|getPrototypeOf|getOwnPropertyNames)|Array\.(?:isArray|from)|String|Number|Boolean|structuredClone|alert|µ[\w$.]*|_mjs[\w$.]*)$/

// méthodes qui définissent un accesseur sur l'objet qui les appelle (`o.__defineGetter__(k, f)`) : appelées par un objet du magasin atteint
// sans chemin, elles passent son aide gardée, qui refuse un prototype ou une fonction du navigateur (cf. CallExpression)
const DEFINES_OBJECT = new Set(['__defineGetter__', '__defineSetter__'])

// fonctions qui modifient leur premier argument (cf. avis)
const WRITES_FIRST = /^(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.(?:set|deleteProperty|defineProperty|setPrototypeOf))$/

// fonctions qui figent leur premier argument : aucune valeur ne change (aucun avertissement), mais l'objet reçu passe la même garde
// (cf. firstGuard) — `Object.freeze($l.find(f)[k])` ne fige ni `Object` ni `Object.prototype`
const FREEZES_FIRST = /^(?:Object\.(?:freeze|seal|preventExtensions)|Reflect\.preventExtensions)$/

/** avertissement du réglage `proxy: false` : une écriture de l'état que le compilateur ne voit pas (`forme` : 1 par un alias,
 *  2 par une fonction qui modifie son premier argument, 3 par une méthode inconnue, 4 l'objet passé à une fonction, 5 les éléments
 *  passés à un rappel venu d'ailleurs) ; `at` : position dans le code reçu par la passe, `racine` : la variable à rafraîchir */
export interface InvisibleNotice { at: number, shape: number, name: string, root: string }

// méthodes qui rendent un ÉLÉMENT de la collection (liste, Map) : l'objet rendu est celui que le magasin range, une
// écriture à travers lui est une écriture du magasin (cf. findRoot)
const FIND_METHODS = new Set(['find', 'findLast', 'at', 'get'])

// méthodes qui rendent l'élément qu'elles RETIRENT : celui d'une copie reste un objet du magasin (cf. findRoot) ; `splice`
// rend ceux qu'il retire dans une liste (cf. copyRoot)
const POP_METHODS = new Set(['pop', 'shift'])

// méthodes qui modifient la collection et dont la valeur sort BRUTE de l'état local, la méthode compilée (`µ._mjs_deepCall`) l'appelant
// sur l'objet brut, avec l'enveloppe comme avec le réglage `proxy: false` : élément retiré (`pop`, `shift`), liste des éléments retirés
// (`splice`), la collection elle-même (RETURNS_SAME) — une écriture qui part d'elle passe par l'aide gardée (cf. returnsRaw, keptRoot)
const RETURNS_RAW = new Set(['pop', 'shift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add'])

// celles qui rendent la collection même : avec l'enveloppe, en tête de la chaîne d'une écriture (`$.l.sort(f)[0].x = v`), relue par
// l'enveloppe (`µ._mjs_deepSame`, mjs_deep.ts), l'écran suit l'écriture (cf. boundChain)
const RETURNS_SAME = new Set(['sort', 'reverse', 'fill', 'copyWithin', 'set', 'add'])

// méthodes qui reçoivent un rappel → rang du paramètre qui tient l'ÉLÉMENT (le `forEach` d'une Map ou d'un Set compris) :
// un objet du magasin quand la liste en est un, ou une copie qui garde ses objets (cf. noteStore) ; aussi écrites en clé
// littérale (`$$l['forEach'](f)`), ou appelées par `Array.prototype.forEach.call(l, f)`
const CALLBACK_METHODS = new Map([['forEach', 0], ['map', 0], ['filter', 0], ['some', 0], ['every', 0], ['flatMap', 0], ['find', 0], ['findLast', 0], ['findIndex', 0], ['findLastIndex', 0], ['reduce', 1], ['reduceRight', 1]])

// méthodes dont le rappel de comparaison reçoit deux ÉLÉMENTS, ses deux premiers paramètres (`$$l.sort((a, b) => …)`)
const SORT_METHODS = new Set(['sort', 'toSorted'])

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
 * Transforme le code JS pour utiliser le path-tracking ; aux points d'escape
 * détectés, aucun wrap Proxy n'est posé (cf. l'en-tête du fichier).
 *
 * Doit être appelé APRÈS transformReactiveWrites (qui gère les `$.x = y`
 * top-level) pour ne traiter que les mutations profondes.
 */
export function applyPathTracking(js: string, opts: { withoutProxy?: boolean } = {}): string {
  return applyPathTrackingMapped(js, opts).code
}

/** réglage `proxy: false` : variables de l'état local que le compilateur SAIT simples — chacune de leurs écritures (`µ._set(_mjsThis,
 *  'x', v)` ou `µwrite $x, v`, dans le script et dans les gestionnaires, cf. `codes`) pose une valeur simple (cf. simpleValue). Une écriture par une
 *  clé calculée (`$[k] = v`) ou un code illisible : aucune. Rien ne modifie une valeur simple en place — elle n'avertit pas */
export function simpleState(codes: string[]): Set<string> {
  const written = new Map<string, any[]>()
  let doubt     = false
  for (const code of codes) {
    if (!code || !/µ\._set\(|µ\._mjs_rawWrite\(/.test(code)) continue
    let ast: any
    try {
      ast = parseModule(code)
    }
    catch {
      doubt = true
      continue
    }
    walk.simple(ast, {
      CallExpression(n: any) {
        const c = n.callee
        if (c.type !== 'MemberExpression' || c.computed || c.object.type !== 'Identifier' || c.object.name !== 'µ' || c.property.name !== '_set') return
        const k = n.arguments[1]
        if (k?.type !== 'Literal' || typeof k.value !== 'string') doubt = true
        else written.set(k.value, [...written.get(k.value) ?? [], n.arguments[2]])
      },
      // `µwrite $x, v` : la case brute, sans `µ._set` (cf. sigils.ts) — une écriture du composant comme une autre
      AssignmentExpression(n: any) {
        const l = n.left
        const c = l.type === 'MemberExpression' && l.object.type === 'CallExpression' ? l.object.callee : null
        if (c?.type !== 'MemberExpression' || c.object.type !== 'Identifier' || c.object.name !== 'µ' || c.property.name !== '_mjs_rawWrite') return
        if (l.computed || l.property.type !== 'Identifier') doubt = true
        else written.set(l.property.name, [...written.get(l.property.name) ?? [], n.right])
      },
    })
  }
  const simpleNames = new Set<string>(doubt ? [] : written.keys())
  // une variable qui reçoit une valeur non simple sort, et avec elle celles qui recopiaient sa valeur
  for (let output = true; output;) {
    output = false
    for (const [k, vals] of written) {
      if (simpleNames.has(k) && !vals.every((v) => simpleValue(v, simpleNames))) {
        simpleNames.delete(k)
        output = true
      }
    }
  }
  return simpleNames
}

// valeur toujours simple (chaîne, nombre, booléen, BigInt, null, undefined) : littéral, gabarit, opération (`a * 2`, `!a`, `typeof a`),
// `++` (forme compilée comprise), `String(x)`, `Number(x)`, variable de l'état encore simple ; dans le doute, non
function simpleValue(v: any, simpleNames: Set<string>): boolean {
  if (!v) return true
  switch (v.type) {
    case 'Literal': return !v.regex
    case 'TemplateLiteral':
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'UpdateExpression': return true
    case 'LogicalExpression': return simpleValue(v.left, simpleNames) && simpleValue(v.right, simpleNames)
    case 'ConditionalExpression': return simpleValue(v.consequent, simpleNames) && simpleValue(v.alternate, simpleNames)
    case 'SequenceExpression': return simpleValue(v.expressions[v.expressions.length - 1], simpleNames)
    case 'Identifier': return v.name === 'undefined' || v.name === 'NaN' || v.name === 'Infinity' || v.name === '_mjs_n'
    case 'MemberExpression': return v.object.type === 'Identifier' && v.object.name === '$' && !v.computed && simpleNames.has(v.property.name)
    case 'CallExpression': return (v.callee.type === 'ArrowFunctionExpression' && v.callee.body.type === 'UpdateExpression') || (v.callee.type === 'Identifier' && /^(?:String|Number|Boolean|parseInt|parseFloat)$/.test(v.callee.name))
    default: return false
  }
}

/** réglage `proxy: false` : les variables de l'état local qui prennent un objet atteint par une autre (`$sel = $rows[i]`, `$sel = $o.a.b`,
 *  `$sel = $rows.find(f)`, `findLast`, `at` ; en tête du script, une valeur dérivée, comme dans une fonction du script ou dans un gestionnaire,
 *  cf. `codes`) en sont un autre nom — sans l'enveloppe, rien d'autre ne le dit au cœur. Rend, par variable, celles dont elle prend ainsi un
 *  objet, de proche en proche (`$a = $rows[0]` puis `$b = $a.sub` : `{ a: ['rows'], b: ['a', 'rows'] }`, `_mjs_otherNames`, mjs_element.ts).
 *  L'objet rendu par un autre appel (`choisir($rows)`, `$rows.filter(f)[0]`) ou atteint par une clé calculée de l'état (`$[k][0]`) n'est pas
 *  noté ; un code illisible n'en note aucun */
export function stateAliases(codes: string[]): Record<string, string[]> {
  const out = new Map<string, string[]>()
  for (const code of codes) {
    if (!code || !/µ\._(?:set|mjs_setComputed)\(/.test(code)) continue
    let ast: any
    try {
      ast = parseModule(code)
    }
    catch {
      continue
    }
    walk.ancestor(ast, {
      CallExpression(n: any, _s: any, anc: any[]) {
        const c = n.callee, k = n.arguments[1]
        const f = c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'µ' ? c.property.name : null
        if ((f !== '_set' && f !== '_mjs_setComputed') || k?.type !== 'Literal' || typeof k.value !== 'string') return
        let v = n.arguments[2]
        // valeur dérivée (`$sel = $rows[1]` en tête du script) : ce que rend sa flèche
        if (f === '_mjs_setComputed') v = v?.type !== 'ArrowFunctionExpression' ? null : v.body.type !== 'BlockStatement' ? v.body : v.body.body.length === 1 && v.body.body[0].type === 'ReturnStatement' ? v.body.body[0].argument : null
        // valeur lue (`return $sel = $rows[i]`, dernière ligne d'une fonction CoffeeScript ou Civet) : écrite par le paramètre de la
        // flèche qui la reçoit (transform-reactive.ts)
        else if (v?.type === 'Identifier') {
          let a: any = null
          for (let i = anc.length - 2; i >= 0 && a === null; i--) if (anc[i].type === 'CallExpression' && anc[i].callee.type === 'ArrowFunctionExpression') a = anc[i]
          const p = a ? a.callee.params.findIndex((x: any) => x.type === 'Identifier' && x.name === v.name) : -1
          v = p === -1 ? null : a.arguments[p]
        }
        const y = rootReached(v)
        if (y === null || y === k.value) return
        const l = out.get(k.value) ?? []
        if (!l.includes(y)) out.set(k.value, [...l, y])
      },
    })
  }
  // de proche en proche : l'autre nom d'un autre nom
  const nearby = (x: string): string[] => {
    const l = [...out.get(x)!]
    for (let i = 0; i < l.length; i++) for (const z of out.get(l[i]) ?? []) if (z !== x && !l.includes(z)) l.push(z)
    return l
  }
  return Object.fromEntries([...out.keys()].map((x) => [x, nearby(x)]))
}

// la variable de l'état local dont un chemin d'au moins un pas mène à la valeur (`$.rows[i]`, `$.o.a.b`, `$.rows?.[i]`), ou dont une
// liste rend l'élément par une méthode (`$.rows.find(f)`, `$.o.l.findLast(f)`, `$.rows.at(-1)`) ; sinon null
function rootReached(v: any): string | null {
  let t = v?.type === 'ChainExpression' ? v.expression : v
  if (t?.type === 'CallExpression' && t.callee.type === 'MemberExpression' && !t.callee.computed && /^(?:find|findLast|at)$/.test(t.callee.property.name)) {
    const l = t.callee.object
    if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'Identifier' && l.object.name === '$' && l.property.type === 'Identifier') return l.property.name
    t = l
  }
  let m = t
  while (m?.type === 'MemberExpression' && m.object?.type === 'MemberExpression') m = m.object
  return m !== t && m.object?.type === 'Identifier' && m.object.name === '$' && !m.computed && m.property?.type === 'Identifier' ? m.property.name : null
}

// clé d'un nom qui lit plusieurs clés du magasin (cf. noteStore) : jamais celle d'une lecture, qui est un identifiant
const NO_KEY = '?'

// « clé » d'une variable qui ne tient aucun objet du magasin mais porte le nom d'une variable déclarée ou affectée (`=`)
// d'une lecture du magasin (cf. storeKey) : son écriture passe par l'aide DOUCE (`µ._mjs_softSetOn`…), qui écrit comme
// JavaScript et refuse seulement un prototype du langage ou l'une de ses fonctions — aucune clé prévenue
const SOFT = '~'

// « clé » d'un objet de l'état LOCAL que la passe ne compile pas, avec le réglage `proxy: false` (cf. keptRoot) : la variable précédée
// de `#`, qu'aucune clé du magasin ne porte (une clé est un identifiant) — son écriture passe par l'aide gardée du composant
// (`µ._mjs_deepSetOn`…, mjs_deep.ts), qui écrit comme JavaScript, ne prévient personne et refuse un prototype ou une fonction du navigateur ;
// avec l'enveloppe aussi, pour ce qu'elle ne garde pas (prototype lu par `Object.getPrototypeOf`, élément du rappel de `sort`)
const LOCALE = '#'

// `$` suivi d'une clé entre crochets, comme la passe le lit (`$[k]`, `$?.[k]`, `($)[k]`, blancs et commentaires compris) : le filtre
// d'avant l'analyse — un faux positif (`a$[k]`, un texte) ne coûte que l'analyse, un oubli laisserait une lecture sans garde
const STATE_ROOT = /\$(?:[\s)]|\/\*[\s\S]*?\*\/|\/\/.*)*(?:\?\.(?:\s|\/\*[\s\S]*?\*\/|\/\/.*)*)?\[/

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
// `storeOnly` : module autonome (`.civet`/`.coffee` importé), sans état de composant — seules les racines
// `µ.store.x` sont suivies, un `$.x` y est un identifiant ordinaire (jQuery, par exemple) laissé tel quel.
// `withoutProxy` : réglage `proxy: false` (mjs.config.json), objets de l'état rangés sans enveloppe — la passe relève alors les écritures
// de l'état qu'elle ne voit pas (alias, fonction qui modifie son argument, méthode inconnue, cf. AvisInvisible), rendues dans `avis`
// pour l'avertissement de construction. Le code produit est le même avec ou sans lui
export function applyPathTrackingMapped(js: string, opts: { storeOnly?: boolean, withoutProxy?: boolean } = {}): PassResult & { notice?: InvisibleNotice[] } {
  const storeOnly = !!opts.storeOnly
  const withoutProxy = !!opts.withoutProxy
  const notice: InvisibleNotice[] = []
  // Statisation $$ — `µ.store.` déclenche aussi le tracking (`$$obj.a.b`
  // compile déjà en `µ.store.obj.a.b` à ce stade, cf. lexer/generator/utils).
  // `$[` aussi (composant seulement, `$?.[` compris, cf. STATE_ROOT) : `$[k].x = v`, `delete $[k]`, `$[k].push(…)`, `x = $?.[k]` sans aucun `$.`
  // `µ.store[` aussi : `µ.store[k].x = v` sans aucun `µ.store.`
  if (!js || (!js.includes('$.') && !js.includes('µ.store') && (storeOnly || !STATE_ROOT.test(js)))) return { code: js }

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

  // tête de l'aide qui écrit un objet atteint (`Set`, `Call`, `Delete`) : gardée, la clé prévenue, ou douce (cf. SOFT) ; objet de l'état
  // local que la passe ne compile pas (cf. LOCALE) : l'aide gardée du composant
  const onHead = (helper: string, root: string) => root[0] === LOCALE ? `µ._mjs_deep${helper}On(${JSON.stringify(root.slice(1))}, ` : root === SOFT ? `µ._mjs_soft${helper}On(` : `µ._mjs_store${helper}On(${keyArg(root)}, `

  // fin de l'appel d'une de ces aides : `)` ; `ctor`, `constructor` écrit dans l'objet de l'écriture (cf. ctorWritten) : l'aide du magasin
  // reçoit `ctor` à 1 en dernier argument (`a` à 0), et l'avertissement d'une fonction du navigateur atteinte nomme ce `constructor` écrit
  // dans le code (mjs_store_globals.ts)
  const onTail = (root: string, ctor: boolean) => ctor && root[0] !== LOCALE && root !== SOFT ? ', 0, 1)' : ')'

  // vrai si l'objet d'une écriture passe par `constructor` écrit dans le code (`$$t.find(f).constructor.x = v`, `t['constructor'].x = v`,
  // t[`constructor`]) : le nom ne vient pas d'une clé de l'extérieur. Une clé calculée écrite après lui (`t.constructor[k].x = v`) peut
  // seule mener à la fonction du navigateur (champ de données nommé `constructor`) : faux, l'avertissement de la clé venue de l'extérieur
  function ctorWritten(node: any): boolean {
    while (node) {
      if (node.type === 'ChainExpression') node = node.expression
      else if (node.type === 'CallExpression') node = node.callee
      else if (node.type !== 'MemberExpression') return false
      else {
        const k    = node.property
        const name = !node.computed ? k.name : k.type === 'Literal' ? k.value : k.type === 'TemplateLiteral' && k.expressions.length === 0 ? k.quasis[0].value.cooked : undefined
        if (name === 'constructor') return true
        if (name === undefined) return false
        node = node.object
      }
    }
    return false
  }

  // aide qui lit une clé calculée de la chaîne d'une écriture gardée (cf. boundChain) : `µ._mjs_keyStore` pour un objet du magasin
  // (mjs_store_globals.ts ; sa clé, ou `#$` devant elle, cf. firstGuard), `µ._mjs_deepKey` pour un objet de l'état local (cf. LOCALE),
  // aucune pour l'aide douce (cf. SOFT)
  const keyHelper = (root: string) => root.startsWith(LOCALE + '$') ? 'µ._mjs_keyStore' : root[0] === LOCALE ? 'µ._mjs_deepKey' : root === SOFT ? null : 'µ._mjs_keyStore'

  // clé de deux valeurs possibles d'un nom : l'une ou l'autre, NO_KEY quand ce sont deux clés différentes
  const both = (a: string | null, b: string | null) => a === null ? b : b === null || a === b ? a : NO_KEY

  // nom qui tient l'ÉLÉMENT d'une liste de l'état dont le chemin est connu (variable d'une boucle `{for}` du gabarit, paramètre d'un
  // rappel, cf. plus bas) → son chemin, l'indice compris, et sa garde (cf. AliasEntry.guard) ; par variable (cf. bindingOf)
  const elemAlias = new Map<string, AliasEntry>()

  // Helper : analyse un node `expr` et retourne son path s'il est trackable. `alias` : un nom qui tient un élément de liste (cf.
  // elemAlias) part de son chemin — pour une écriture seulement, jamais pour les autres questions de la passe
  function getPath(expr: any, alias = false): AliasEntry | null {
    if (!expr) return null
    if (alias && expr.type === 'Identifier') return storeOnly ? null : elemAlias.get(bindingOf(expr)) ?? null
    // `$.x` → ['x'] (origin='local')
    if (expr.type === 'MemberExpression') {
      const tail = expr.computed ? null : expr.property?.name
      const tailComputed = expr.computed ? extractComputedKey(expr.property) : null
      const head = expr.object
      if (head?.type === 'Identifier' && head.name === '$') {
        if (storeOnly) return null
        if (tail) return { path: [tail], origin: 'local' }
        if (tailComputed !== null) return { path: [tailComputed], origin: 'local' }
        // clé faite d'une expression à la racine (`$[c.nom].valeur = v`) : un chemin, comme plus bas (`$.o[c.nom]`) — l'aide refuse une clé réservée
        return expr.computed && expr.property.type !== 'PrivateIdentifier' ? { path: [exprSegment(expr.property)], origin: 'local' } : null
      }
      // `µ.store.x` → ['x'] (origin='store'). Clé racine DYNAMIQUE
      // (`µ.store[expr]`) non trackée (conservateur, même limite que `$[cle]`).
      if (isStoreRoot(head)) {
        if (tail) return { path: [tail], origin: 'store' }
        return null
      }
      // Récursif : `$.x.y`, `µ.store.x.y`, `$.x[i]`, etc.
      const headPath = getPath(head, alias)
      if (headPath) {
        const rest = { origin: headPath.origin, guard: headPath.guard }
        if (tail) return { path: [...headPath.path, tail], ...rest }
        if (tailComputed !== null) return { path: [...headPath.path, tailComputed], ...rest }
        // clé faite d'une expression (`$.l[$.i]`, `$.l[i + 1]`, `$.l[$.l.length]`) : l'état local seulement, le magasin garde son
        // écriture par l'objet (cf. findRoot)
        if (headPath.origin === 'local' && expr.property.type !== 'PrivateIdentifier') return { path: [...headPath.path, exprSegment(expr.property)], ...rest }
      }
    }
    return null
  }

  // segment d'une clé faite d'une expression : son texte DÉJÀ RÉÉCRIT (une écriture réécrite dedans survit), entre parenthèses pour
  // une expression à virgule, qu'une liste de clés couperait sinon ; `effet` quand elle agit (cf. DynSegment)
  function exprSegment(k: any): DynSegment {
    const text = k.type === 'SequenceExpression' ? `(${ms.slice(k.start, k.end)})` : ms.slice(k.start, k.end)
    let effect = false
    walk.full(k, (n: any) => {
      if (/^(?:Call|New|Update|Assignment|Await|Yield|TaggedTemplate|Import|Function|ArrowFunction|Class)Expression$/.test(n.type) || (n.type === 'UnaryExpression' && n.operator === 'delete')) effect = true
    })
    return effect ? { dyn: text, effect: true } : { dyn: text }
  }

  // le chemin a une clé qui agit (cf. DynSegment.effet)
  const acts = (tp: AliasEntry) => tp.path.some((p) => typeof p === 'object' && p.effect)

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
  // `Reflect.get(o, k)`, appel direct : la valeur de `o[k]` (cf. findRoot, racineLocale)
  function isReflectGet(e: any): boolean {
    const c = e.callee
    return e.type === 'CallExpression' && !e.optional && e.arguments.length >= 2 && e.arguments[0].type !== 'SpreadElement' && c.type === 'MemberExpression' && !c.computed && !c.optional && c.object.type === 'Identifier' && c.object.name === 'Reflect' && c.property.name === 'get'
  }

  // `nom` : la valeur d'un nom (déclaration, affectation, cf. noteStore et track) — une expression qui peut rendre deux
  // clés différentes (`$$a.get(k) or $$b[0]`, ternaire, `||=`) n'en prévient aucune (NO_KEY), et `await` rend la valeur
  // attendue (l'objet même, quand le magasin ne tient pas une promesse)
  function findRoot(expr: any, name = false): string | null {
    for (let e = expr; e; ) {
      if (e.type === 'Identifier') {
        // la valeur d'un nom ne prend jamais SOFT : une variable qui ne tient pas d'objet du magasin n'en donne aucun
        const k = workIds.get(e) ?? (tainted.has(e.name) ? null : foundMap.get(e.name)) ?? storeKey(e)
        return name && k === SOFT ? null : k
      }
      // clé calculée à la racine (`µ.store[k].x = v`) : aucune clé à prévenir, mais l'objet atteint passe par l'aide gardée, qui refuse un prototype
      if (e.type === 'MemberExpression' && isStoreRoot(e.object)) return e.computed ? NO_KEY : e.property.name
      if (e.type === 'MemberExpression') {
        // élément d'une copie qui garde les objets du magasin (`$$l.filter(f)[0]`, `ref[i]` d'une boucle CoffeeScript)
        const c = copyRoot(e.object)
        if (c) return c
        // valeur que rend l'itérateur d'une telle copie (`$$l.values().next().value`, la paire de `entries()`)
        const n = e.object
        const v = !e.computed && e.property.name === 'value' && n.type === 'CallExpression' && !n.optional && n.arguments.length === 0 && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name === 'next' ? copyRoot(n.callee.object) : null
        if (v) return v
        e = e.object
      }
      // valeur lue par `Reflect.get(o, k)` : celle de `o[k]`
      else if (isReflectGet(e)) e = e.arguments[0]
      else if (e.type === 'CallExpression' && !e.optional && e.callee.type === 'MemberExpression' && !e.callee.computed && (FIND_METHODS.has(e.callee.property.name) || POP_METHODS.has(e.callee.property.name))) {
        // élément d'une copie qui garde les objets du magasin (`$$l.filter(f).find(g)`, `copie.at(0)`, `copie.pop()`) ;
        // `pop` et `shift` sur une liste du magasin rendent un élément qu'elle n'a plus : écrit sans prévenir de clé (SOFT)
        const pop = POP_METHODS.has(e.callee.property.name)
        const tp  = pop ? null : getPath(e.callee.object)
        if (tp) return tp.origin === 'store' ? String(tp.path[0]) : null
        const c = copyRoot(e.callee.object)
        if (c || pop) return c ?? (findRoot(e.callee.object, true) !== null ? SOFT : null)
        e = e.callee.object
      }
      // prototype d'un objet du magasin (`Object.getPrototypeOf($$o.m)`, `Reflect.getPrototypeOf`) : la valeur reste celle
      // de JavaScript (lecture nue), une écriture par elle passe par les aides, qui refusent un prototype
      else if (isProtoOf(e)) e = e.arguments[0]
      else if (e.type === 'LogicalExpression') return name ? both(findRoot(e.left, true), findRoot(e.right, true)) : pick(findRoot(e.left), findRoot(e.right))
      else if (e.type === 'ConditionalExpression') return name ? both(findRoot(e.consequent, true), findRoot(e.alternate, true)) : pick(findRoot(e.consequent), findRoot(e.alternate))
      else if (e.type === 'AssignmentExpression') {
        if (e.operator === '=') return findRoot(e.right, name)
        return name ? both(findRoot(e.left, true), findRoot(e.right, true)) : pick(findRoot(e.left), findRoot(e.right))
      }
      else if (e.type === 'SequenceExpression') e = e.expressions[e.expressions.length - 1]
      else if (e.type === 'ChainExpression') e = e.expression
      else if (name && e.type === 'AwaitExpression') e = e.argument
      else return null
    }
    return null
  }

  // clé racine des objets d'une COPIE qui les garde (cf. COPY_METHODS) : `$$l.filter(f)`, `slice()`, `concat(…)`,
  // `toSorted()`, `values()` et `entries()` d'une Map…, `Object.values($$o)`, `Object.entries($$o)`, `Array.from($$l)`,
  // `[...$$l]`, ou variable qui en tient une (cf. copyBindings) — sinon null. La copie n'est pas au magasin, ses éléments le sont ;
  // `map(f)` et `flatMap(f)` rendent SOFT (cf. plus haut) : le rappel rend souvent des objets neufs, qu'on écrit sans prévenir de clé,
  // mais il peut rendre les objets mêmes (`map((t) => t)`), dont l'écriture refuse alors un prototype ou une fonction du navigateur ;
  // `Array.from(l, f)` et une copie profonde (`structuredClone`, `JSON.parse`) n'en sont pas. Les éléments qu'une copie retire par `splice` (`copie.splice(0, 1)`)
  // en restent ; ceux que le magasin retire lui-même n'y sont plus (comme `pop`)
  function copyRoot(e: any): string | null {
    if (e.type === 'ChainExpression') e = e.expression
    if (e.type === 'Identifier') return copyNames.has(e.name) ? copyBindings.get(bindingOf(e)) ?? null : null
    if (e.type === 'ArrayExpression') {
      let r: string | null = null
      for (const el of e.elements) if (el?.type === 'SpreadElement') r = both(r, itemsRoot(el.argument))
      return r
    }
    // objet fait par étalement (`({ ...$$o })`) : ses valeurs sont celles de l'objet du magasin
    if (e.type === 'ObjectExpression') {
      let r: string | null = null
      for (const el of e.properties) if (el.type === 'SpreadElement') r = both(r, findRoot(el.argument, true))
      return r
    }
    if (e.type !== 'CallExpression' || e.optional || e.callee.type !== 'MemberExpression' || e.callee.computed) return null
    const o    = e.callee.object
    const name = e.callee.property.name
    const args = e.arguments
    if (o.type === 'Identifier' && (o.name === 'Object' || o.name === 'Array')) {
      const copy = o.name === 'Object' ? name === 'values' || name === 'entries' : name === 'from'
      return copy && args.length === 1 && args[0].type !== 'SpreadElement' ? itemsRoot(args[0]) : null
    }
    // copie retournée ou triée sur place (`$$l.slice().reverse()`) : la même copie ; liste du magasin elle-même (`$$l.sort(f)`,
    // `reverse()`, `fill(v)`) : ses éléments ; ceux qu'elle retire (`$$l.splice(i, 1)`) n'y sont plus, écrits sans prévenir de clé (SOFT)
    if (name === 'reverse' || name === 'sort' || name === 'fill' || name === 'copyWithin') return itemsRoot(o)
    if (name === 'splice') return copyRoot(o) ?? (findRoot(o, true) !== null ? SOFT : null)
    if (name === 'map' || name === 'flatMap') return itemsRoot(o) ? SOFT : null
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

  // texte DÉJÀ RÉÉCRIT entre `a` et `b`, ou null quand une borne tombe dans un morceau que la passe a réécrit d'un bloc (méthode de
  // l'état compilée, `$.l.pop()` → `µ._mjs_deepCall(…)`) : ce morceau ne se coupe plus, il se lit entier
  function piece(a: number, b: number): string | null {
    try {
      return ms.slice(a, b)
    }
    catch {
      return null
    }
  }

  // appel de la chaîne déjà réécrit d'un bloc par la passe (`$.l.pop()`, `$.l.splice(i, 1)`, cf. morceau) : ses maillons et ses clés
  // sont ceux du chemin compilé, la chaîne de l'écriture repart de lui
  const rewritten = (x: any) => x.type === 'CallExpression' && piece(x.callee.end, x.end) === null

  // objet `o` d'une écriture par un objet du magasin ou de l'état (élément trouvé, variable suivie, racine) : chaque maillon `?.` de
  // sa chaîne est testé une fois, son objet lié à un paramètre local (aucune case partagée). `lire` : l'aide des clés (cf. keyHelper) —
  // une clé calculée de la chaîne, ni littérale ni écrite en clair, est lue par `µ._mjs_deepKey` (objet de l'état local, mjs_deep.ts) ou
  // `µ._mjs_keyStore` (objet du magasin, mjs_store_globals.ts), qui refusent une clé réservée que l'objet lu n'a pas en
  // propre — la chaîne est jugée comme par l'enveloppe et le chemin compilé, pas seulement l'objet atteint (`$l.find(f)[k].isAdmin = v`,
  // `k` = `'constructor'`, mène à une classe de l'appli), `?.[k]` compris. Rend les liaisons, le texte de l'objet, `cles` (une clé
  // ainsi lue) et `meme` (la tête relue par l'enveloppe, cf. RETURNS_SAME) ; un appel déjà réécrit (cf. reecrit) devient la tête, lu entier
  // (`$.l.pop().fait = true`) ; null quand le texte ne se lit pas
  function boundChain(o: any, read: string | null = null): { binds: Binding[], object: string, keys: boolean, same: boolean } | null {
    let { head, segs } = chainOf(o)
    const binds: Binding[] = []
    let i = segs.length - 1
    while (i >= 0 && !rewritten(segs[i])) i--
    if (i >= 0) [head, segs] = [segs[i], segs.slice(i + 1)]
    // tête faite d'une expression (`($$o[k] || {})[k2]`, cf. findRoot) : ses parenthèses, qu'acorn laisse hors du nœud
    const headText = piece(head.start, head.end)
    if (headText === null) return null
    let object = head.type === 'Identifier' || head.type === 'ThisExpression' ? headText : `(${headText})`
    let keys   = false
    // avec l'enveloppe, la collection que rend `sort` & co. en tête de l'écriture (cf. RETURNS_SAME) : relue par l'enveloppe, l'écran suit
    const same = !withoutProxy && head.type === 'CallExpression' && RETURNS_SAME.has(head.callee.property?.name) ? returnsRaw(head) : null
    if (same) object = `µ._mjs_deepSame(_mjsThis, ${headText}, ${JSON.stringify(same)})`
    for (const s of segs) {
      if (s.type === 'MemberExpression' && s.optional) {
        const param = `_mjs_o${binds.length + 1}`
        binds.push({ param, value: object, test: param })
        object = param
      }
      if (read && s.type === 'MemberExpression' && s.computed && s.property.type !== 'Literal' && !(s.property.type === 'TemplateLiteral' && s.property.expressions.length === 0)) {
        object = `${read}(${object}, ${keyText(s)})`
        keys   = true
        continue
      }
      const text = piece(s.type === 'CallExpression' ? s.callee.end : js.lastIndexOf(s.optional ? '?.' : s.computed ? '[' : '.', s.property.start), s.end)
      if (text === null) return null
      object += text
    }
    return { binds, object, keys, same: same !== null }
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
  // `cles` : l'aide qui lit les clés calculées de la chaîne (cf. keyHelper, boundChain)
  function foundParts(m: any, keys: string | null = null): { binds: Binding[], obj: string, key: string, acc: string, sep: number } | null {
    const k = m.property
    if (k.type === 'PrivateIdentifier') return null
    const key = keyText(m)
    const sep = js.lastIndexOf(m.optional ? '?.' : m.computed ? '[' : '.', k.start)
    const chain = boundChain(m.object, keys)
    // aucun maillon ni clé lue (cf. boundChain) : l'objet tel quel, ses parenthèses comprises ; texte qui ne se lit pas : l'écriture reste
    // telle qu'écrite
    const obj = chain?.binds.length || chain?.keys || chain?.same ? chain.object : piece(m.start, sep)
    if (!chain || obj === null) return null
    return { binds: chain.binds, obj, key, acc: m.computed ? `[${key}]` : `.${k.name}`, sep }
  }

  // cible d'écriture d'un objet du magasin (cf. emit-write.ts) : `µ._mjs_storeSetOn` rend la valeur écrite, sa forme
  // directe vaut partout. Relue (`+=`, `++`), la cible lit l'objet, et une clé calculée autre qu'un nom ou un littéral,
  // par les paramètres d'une fonction fléchée (`bind`) : l'objet n'est évalué qu'une fois — le prédicat n'est pas
  // rappelé —, aucune case partagée, et la valeur de droite y garde son ordre (lue après l'objet). Une variable et une
  // clé simple se relisent telles quelles. `?.` n'est jamais dans une cible d'affectation : Civet et CoffeeScript
  // l'écrivent par une variable de travail
  function foundTarget(m: any, root: string, read: boolean, wait = false): WriteTarget | null {
    const p = foundParts(m, keyHelper(root))
    if (!p || p.binds.length) return null
    if (root[0] === LOCALE) p.obj = guardedObject(root, m.object, p.obj)
    const head = onHead('Set', root)
    const tail = onTail(root, ctorWritten(m.object))
    const k    = m.property
    const obj  = m.object.type === 'Identifier'
    const key  = !m.computed || k.type === 'Identifier' || k.type === 'Literal'
    if (!read || (obj && key)) return { set: `${head}${p.obj}, ${p.key}, `, read: `${p.obj}${p.acc}`, returnsValue: true, tail }
    const o      = obj ? p.obj : '_mjs_o'
    const params = [obj ? '' : '_mjs_o', key ? '' : '_mjs_k'].filter(Boolean).join(', ')
    const values = [obj ? '' : p.obj, key ? '' : p.key].filter(Boolean).join(', ')
    return { set: `${head}${o}, ${key ? p.key : '_mjs_k'}, `, read: `${o}${key ? p.acc : '[_mjs_k]'}`, returnsValue: true, bind: { params, values, wait }, tail }
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
  // ET des deux origines) et on RETIENT le magasin et l'état local profond ($.o.k, profondeur ≥ 2, cf. byHelpers) — les
  // cibles `$.x` (profondeur 1, déjà réécrites par transformReactiveWrites qui tourne AVANT) sont laissées telles quelles.
  // Une feuille sans chemin qui passe par un objet du magasin (`[da[k1][k2]] = v` par une variable suivie, `[$$o.a[k +
  // ''][k2]] = v`, cf. findRoot) reçoit l'écriture de cet objet (`µ._mjs_storeSetOn`, cf. foundTarget) : la clé racine
  // prévenue
  function collectStoreTargets(pattern: any, out: { node: any, set: string, tail?: string }[]): void {
    forEachPatternLeaf(pattern, (leaf: any) => {
      if (leaf.type !== 'MemberExpression') return
      const tp = getPath(leaf)
      if (tp) {
        if (byHelpers(tp)) out.push({ node: leaf, set: pathTarget(tp, '').set })
        return
      }
      // objet de l'état local que la passe ne compile pas (réglage `proxy: false`, cf. keptRoot) : l'aide gardée, averti
      const root = findRoot(leaf.object) ?? keptRoot(leaf.object)
      const t    = root && !suspension(leaf) ? foundTarget(leaf, root, false) : null
      if (t) out.push({ node: leaf, set: t.set, tail: t.tail })
      if (t && root![0] === LOCALE) invisible(leaf.object, leaf.start)
    })
  }

  // Parenthèses autour de la valeur (`$$x = ((...) + 1)`, `$$x = (noter(), 2)`) : acorn ne les
  // inclut PAS dans `node.right` mais les consomme dans `node.end` — la réécriture va jusqu'à
  // `rhsStart` et ferme par `closeRhs` (emit-write.ts) : parenthèses superflues retirées,
  // celles d'une expression à virgule gardées (sans elles, plusieurs arguments, la première valeur
  // écrite au lieu de la dernière).

  // `++`, `--`, affectation composée ou logique, cible d'un motif, sur un chemin : celui du magasin passe toujours par les aides,
  // celui de l'état local aussi (profondeur 2 et plus, `$.x` à la racine reste à transformReactiveWrites), avec ou sans l'enveloppe
  function byHelpers(tp: AliasEntry): boolean {
    return tp.origin === 'store' || tp.path.length > 1
  }

  // cible RELUE (`+=`, `++`, affectation logique) : celle de pathTarget, relue par le texte de la cible ; une clé de l'état local qui
  // agit (cf. DynSegment.effet) passe par un paramètre d'une fonction fléchée appelée sur place (`bind`, cf. emit-write.ts), évaluée
  // une fois et dans l'ordre de JavaScript (clés, relecture, valeur de droite) — le chemin et la relecture lisent le paramètre.
  // `wait` : la valeur de droite attend (`await`)
  function pathTargetRead(tp: AliasEntry, target: any, wait = false): WriteTarget {
    if (tp.origin !== 'local' || !acts(tp)) return pathTarget(tp, js.slice(target.start, target.end))
    const params: string[] = []
    const values: string[] = []
    const path: Path = tp.path.map((p) => {
      if (typeof p !== 'object' || !p.effect) return p
      params.push(`_mjs_k${params.length + 1}`)
      values.push(p.dyn)
      return { dyn: params[params.length - 1] }
    })
    const read = '$' + path.map((p) => typeof p === 'object' ? `[${p.dyn}]` : typeof p === 'number' ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`).join('')
    return { set: `µ._mjs_deepSet(_mjsThis, ${pathToJsLiteral(path)}, `, read, returnsValue: true, bind: { params: params.join(', '), values: values.join(', '), wait } }
  }

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
  let again = true
  // motif lié à une valeur (`{ a } := $$prefs`, `[t] = $$liste`, `for { meta } of $$fiches`) : chacun de ses noms en tient
  // une partie, ou sa valeur par défaut (`{ a = $$o.b } = …`, `(t = $$o.a) ->`). `part` : le nom tient une partie de
  // `init` (élément d'une boucle, d'un rappel, d'un motif) ; sinon `init` même, qui peut être une copie (cf. copyBindings)
  const notePattern = (p: any, init: any, part = false, byName = false): void => {
    if (!p) return
    if (p.type === 'Identifier') {
      if (init && noteStore(p, init, part, byName)) again = true
      if (init && !part && noteBinding(copyBindings, p, copyRoot(init))) {
        copyNames.add(p.name)
        again = true
      }
    }
    else if (p.type === 'AssignmentPattern') {
      notePattern(p.left, p.right, false, byName)
      notePattern(p.left, init, part, byName)
    }
    // motif de liste sur une liste écrite (`[t] = [$$l.find(f)]`) : chaque nom reçoit sa valeur, jusqu'au premier étalement
    else if (p.type === 'ArrayPattern' && !part && init?.type === 'ArrayExpression') {
      for (let i = 0; i < p.elements.length && i < init.elements.length && init.elements[i]?.type !== 'SpreadElement'; i++) if (p.elements[i]?.type !== 'RestElement') notePattern(p.elements[i], init.elements[i], false, byName)
    }
    else if (p.type === 'ArrayPattern') for (const el of p.elements) notePattern(el, init, true, byName)
    else if (p.type === 'ObjectPattern') for (const pr of p.properties) notePattern(pr.type === 'RestElement' ? pr.argument : pr.value, init, true, byName)
    else if (p.type === 'RestElement') notePattern(p.argument, init, part, byName)
  }
  const noteLoop = (n: any) => notePattern(n.left.type === 'VariableDeclaration' ? n.left.declarations[0].id : n.left, n.right, true)
  // `Array.prototype.forEach` (une méthode à rappel d'une liste), objet de `.call(l, f)`
  const isArrayMethod = (m: any) => m.type === 'MemberExpression' && !m.computed && m.object.type === 'MemberExpression' && !m.object.computed && m.object.object.type === 'Identifier' && m.object.object.name === 'Array' && m.object.property.name === 'prototype' && CALLBACK_METHODS.has(m.property.name)
  while (again) {
    again = false
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
        const c    = n.callee
        const name = c.type !== 'MemberExpression' ? null : !c.computed ? c.property.name : c.property.type === 'Literal' && typeof c.property.value === 'string' ? c.property.value : null
        let i      = name === null ? undefined : CALLBACK_METHODS.get(name)
        let list   = c.object
        let f      = n.arguments[0]
        if (name === 'from' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'Array') [i, list, f] = [0, n.arguments[0], n.arguments[1]]
        else if (name === 'call' && !c.computed && isArrayMethod(c.object)) [i, list, f] = [CALLBACK_METHODS.get(c.object.property.name), n.arguments[0], n.arguments[1]]
        if (i !== undefined && list && list.type !== 'SpreadElement' && f && isFunction(f)) {
          notePattern(f.params[i], list, true, false)
          // `reduce` et `reduceRight` sans valeur de départ : l'accumulateur part du premier élément
          if (i === 1 && n.arguments.length === (name === 'call' ? 2 : 1)) notePattern(f.params[0], list, true, false)
        }
        // rappel de comparaison (`$$l.sort((a, b) => …)`, `toSorted`) : ses deux paramètres sont des éléments
        else if (name !== null && !c.computed && SORT_METHODS.has(name) && f && isFunction(f)) for (const p of f.params.slice(0, 2)) notePattern(p, list, true, false)
      },
    })
  }

  // ── Éléments de liste de l'état (cf. elemAlias) ─────────────────────────────────────────────────────────────────────────
  // seule valeur d'une variable : déclarée avec elle, ou déclarée sans valeur puis affectée une fois (`=`), jamais liée autrement
  // (paramètre, `++`, motif, variable d'une boucle) — sinon null
  const singleValue = (id: any): any => {
    const b = bindingOf(id)
    let v: any = null
    let n = 0
    for (const o of occs.get(id.name) ?? []) {
      if (o.role === 'ref' || bindingOf(o.id) !== b || (o.role === 'decl' && noValue(o))) continue
      if (o.role === 'bind' || (o.role === 'assign' && o.node.operator !== '=')) return null
      v = o.role === 'decl' ? o.node.init : o.node.right
      n++
    }
    return n === 1 ? v : null
  }
  // paramètre jamais lié ailleurs dans sa portée (ni affecté, ni `++`)
  const neverLinked = (id: any): boolean => (occs.get(id.name) ?? []).every((o) => o.role === 'ref' || o.id === id || bindingOf(o.id) !== bindingOf(id))
  // liste dont le chemin est connu : chemin de l'état local (`$.l`, `$.o.items`) ou partie d'un élément déjà suivi (`row.cells`),
  // sans clé qui agit
  const listPath = (e: any): AliasEntry | null => {
    const tp = getPath(e, true)
    return tp && tp.origin === 'local' && !acts(tp) ? tp : null
  }
  // garde lue AU MOMENT de l'écriture, par le chemin même que suivra l'aide (chaque maillon après `$` par `?.`) : il mène encore à
  // cet objet — sinon (liste remplacée, réordonnée ou vidée, `await` passé entre-temps, collection à soi dont le rappel ne reçoit pas
  // l'indice) l'écriture telle qu'écrite, celle de JavaScript. Comparés bruts : une enveloppe et l'objet qu'elle tient sont le même
  const safeRead = (path: Path) => '$' + path.map((p, k) => {
    const key = typeof p === 'object' ? `[${p.dyn}]` : typeof p === 'number' ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? p : `[${JSON.stringify(p)}]`
    return (k ? '?.' : key[0] === '[' ? '' : '.') + key
  }).join('')
  const addElement = (id: any, list: AliasEntry, idx: string, params?: () => void) => {
    const path: Path = [...list.path, { dyn: idx }]
    const guard = { test: `µ._mjs_toRaw(${safeRead(path)}) === µ._mjs_toRaw(${id.name})`, root: String(list.path[0]), params: [...(list.guard?.params ?? []), ...(params ? [params] : [])] }
    elemAlias.set(bindingOf(id), { path, origin: 'local', guard })
  }
  // variable de TRAVAIL (cf. work) qui tient une partie de l'état local par son chemin : `(base = $.o).n || (base.n = 1)`, que
  // CoffeeScript écrit pour `$o.n or= 1` (et `?=`, `and=`). Ses écritures suivent ce chemin, gardées comme celles d'un élément de
  // liste (cf. byGuard) : l'écran suit, avec ou sans l'enveloppe, comme pour `||=` de Civet — une fonction de l'appli rangée dans
  // l'état comprise (`$format.appels or= 1`)
  if (!storeOnly) {
    for (const [a, w] of work) {
      const tp = !w.others.length && a.right.type === 'MemberExpression' ? getPath(a.right) : null
      if (tp?.origin === 'local' && !acts(tp)) elemAlias.set(bindingOf(a.left), { path: tp.path, origin: 'local', guard: { test: `µ._mjs_toRaw(${safeRead(tp.path)}) === µ._mjs_toRaw(${a.left.name})`, root: String(tp.path[0]), params: [] } })
    }
  }
  // les noms que lisent les clés du chemin (`$$liste[slot]`) désignent, partout où le nom est lu ou écrit, la variable qu'ils désignaient
  // là où il a été pris : sinon la garde lirait une autre variable, ou un nom hors de portée (ReferenceError)
  const keysInScope = (o: Occ, v: any): boolean => {
    const b            = bindingOf(o.id)
    const names: any[] = []
    for (let m = v; m?.type === 'MemberExpression'; m = m.object) {
      if (m.computed) walk.full(m.property, (n: any) => { if (n.type === 'Identifier') names.push(n) })
    }
    return names.length === 0 || (occs.get(o.id.name) ?? []).every((r) => bindingOf(r.id) !== b || names.every((n) => bindingOf({ type: 'Identifier', name: n.name, start: r.id.start, end: r.id.end }) === bindingOf(n)))
  }
  // gardes des noms pris sur un chemin fixe de l'état local : la valeur qui agit y est évaluée avant la garde (cf. byGuard)
  const nameGuards = new WeakSet<object>()
  // la valeur agit (appel, `new`, `++`, affectation, gabarit étiqueté, `delete`) : elle peut remplacer ou déplacer l'objet du chemin
  const valueActs = (e: any): boolean => {
    let a = false
    walk.full(e, (n: any) => { if (/^(?:Call|New|Update|Assignment|TaggedTemplate|Import)Expression$/.test(n.type) || (n.type === 'UnaryExpression' && n.operator === 'delete')) a = true })
    return a
  }
  // nom pris sur un chemin fixe de l'état local (`t := $o.a.b`, `t = $o.a.b` de CoffeeScript), réglage `proxy: false` : sa seule valeur (cf. singleValue), un chemin
  // sans clé qui agit. Ses écritures suivent ce chemin, gardées comme celles d'un élément de liste (cf. byGuard) : le chemin relu au
  // moment de l'écriture mène encore à cet objet, sinon l'écriture telle qu'écrite. Avec l'enveloppe, elle voit déjà ces écritures
  if (withoutProxy && !storeOnly) {
    for (const [, list] of occs) {
      for (const o of list) {
        const v  = o.role === 'decl' ? o.node.init : o.role === 'assign' && o.node.operator === '=' ? o.node.right : null
        const tp = v?.type === 'MemberExpression' && !elemAlias.has(bindingOf(o.id)) && singleValue(o.id) === v ? getPath(v) : null
        if (tp?.origin === 'local' && tp.path.length > 1 && !acts(tp) && keysInScope(o, v)) {
          const guard = { test: `µ._mjs_toRaw(${safeRead(tp.path)}) === µ._mjs_toRaw(${o.id.name})`, root: String(tp.path[0]), params: [] }
          nameGuards.add(guard)
          elemAlias.set(bindingOf(o.id), { path: tp.path, origin: 'local', guard })
        }
      }
    }
  }
  // nom pris sur un chemin du magasin (`t := $$o.a.b`, `sheet = $$liste[slot]` de CoffeeScript), avec ou sans l'enveloppe : sa seule
  // valeur (cf. singleValue), un chemin sans clé qui agit. Son écriture simple (`t.c = v`) suit ce chemin quand, relu au moment de
  // l'écriture, il mène encore à cet objet (cf. storePath)
  const storePaths = new Map<string, Path>()
  if (!storeOnly) {
    for (const [, list] of occs) {
      for (const o of list) {
        const v  = o.role === 'decl' ? o.node.init : o.role === 'assign' && o.node.operator === '=' ? o.node.right : null
        const tp = v?.type === 'MemberExpression' && singleValue(o.id) === v ? getPath(v) : null
        if (tp?.origin === 'store' && !acts(tp) && keysInScope(o, v)) storePaths.set(bindingOf(o.id), tp.path)
      }
    }
  }
  // `t.c = v` → `(µ.store.o?.a?.b === t ? µ._mjs_storeDeepSet("o", ["a", "b", "c"], v) : µ._mjs_storeSetOn("o", t, "c", v))` ; valeur
  // lue (`return t.c = v`, dernière ligne d'une fonction Civet) : par un paramètre qui la rend. Sinon rien : l'écriture d'aujourd'hui
  function storePath(node: any, ancestors: any[]): boolean {
    const t    = node.left
    const path = t.object.type === 'Identifier' && !t.computed && node.operator === '=' ? storePaths.get(bindingOf(t.object)) : undefined
    if (!path || suspension(node.right)) return false
    const k     = JSON.stringify(path[0])
    const o     = t.object.name
    const bare  = writeValueUnused(ancestors)
    const actsV = valueActs(node.right)
    const shape = (obj: string, v: string) => `${obj} != null && µ.store${safeRead(path).slice(1)} === ${obj} ? µ._mjs_storeDeepSet(${k}, ${pathToJsLiteral([...path.slice(1), t.property.name])}, ${v}) : µ._mjs_storeSetOn(${k}, ${obj}, ${JSON.stringify(t.property.name)}, ${v})`
    // valeur qui n'agit pas, non lue : la garde en ligne, la valeur écrite dans chaque branche (une seule est évaluée) ; toute l'écriture
    // est remplacée, parenthèses de la valeur comprises (acorn les compte dans `node.end`), celles d'une expression à virgule gardées
    if (bare && !actsV) {
      const v = node.right.type === 'SequenceExpression' ? `(${ms.slice(node.right.start, node.right.end)})` : ms.slice(node.right.start, node.right.end)
      ms.overwrite(node.start, node.end, `${asiGuard(ancestors)}(${shape(o, v)})`)
      return true
    }
    // valeur lue, ou valeur qui agit (`t.c = f()`) : par un paramètre ; quand elle agit, le nom puis la valeur d'abord (l'ordre de
    // JavaScript), le chemin relu ensuite — une valeur qui remplace ou déplace l'objet n'envoie pas l'écriture ailleurs
    const start = rhsStart(js, node)
    ms.overwrite(node.start, start, `${asiGuard(ancestors)}((${actsV ? '_mjs_o, ' : ''}_mjs_v) => (${shape(actsV ? '_mjs_o' : o, '_mjs_v')}${bare ? '' : ', _mjs_v'}))(${actsV ? o + ', ' : ''}`)
    closeRhs(ms, node, start, ')')
    return true
  }
  // variable d'une boucle `{for}` du gabarit, dans le préambule d'un gestionnaire (attributes/index.ts) : `x = _mjs_ra_N._mjs_it`
  // (indice `_mjs_ra_N._mjs_ix`, ligne d'une liste de racine) ou `x = _mjs_ra_N[_mjs_ri_N]` (indice `_mjs_ri_N`), la liste relue
  // sous `_mjs_rl_N` dans la même fonction quand le gestionnaire écrit l'élément ; liste calculée qui en garde les objets (réglage
  // `proxy: false`) : l'élément retrouvé dans la liste relue par son identité, indice `_mjs_rj_N`
  for (const [, list] of occs) {
    for (const o of list) {
      const v = o.role === 'decl' ? o.node.init : o.role === 'assign' && o.node.operator === '=' ? o.node.right : null
      const m = v?.type === 'MemberExpression' && v.object.type === 'Identifier' ? /^_mjs_ra_(\d+)$/.exec(v.object.name) : null
      if (!m) continue
      const sets = (d: Occ) => (d.role === 'decl' || d.role === 'assign') && d.fn === o.fn
      const rj   = (occs.get(`_mjs_rj_${m[1]}`) ?? []).some(sets) ? `_mjs_rj_${m[1]}` : null
      const idx  = rj ?? (!v.computed && v.property.name === '_mjs_it' ? `_mjs_ra_${m[1]}._mjs_ix` : v.computed && v.property.type === 'Identifier' && v.property.name === `_mjs_ri_${m[1]}` ? `_mjs_ri_${m[1]}` : null)
      if (!idx || singleValue(o.id) !== v) continue
      const rl   = (occs.get(`_mjs_rl_${m[1]}`) ?? []).find(sets)
      const lv   = rl ? singleValue(rl.id) : null
      const list = lv ? listPath(lv) : null
      if (list) addElement(o.id, list, idx)
    }
  }
  // paramètre d'un rappel de liste écrit sur place (`$.l.forEach((x) => x.n++)`, `map`, `filter`… cf. CALLBACK_METHODS) : l'indice est
  // le paramètre qui suit l'élément, ajouté au rappel (`_mjs_iN`) à sa première écriture compilée.
  // Dans l'ordre du texte : un rappel dans un rappel (`r.cells.forEach(…)`) part de l'élément du premier
  const callbacks: any[] = []
  walk.simple(ast, {
    CallExpression(n: any) {
      const c = n.callee
      if (c.type === 'MemberExpression' && !c.computed && !c.optional && !n.optional && CALLBACK_METHODS.has(c.property.name) && n.arguments[0] && isFunction(n.arguments[0])) callbacks.push(n)
    },
  })
  for (const n of callbacks.sort((a, b) => a.start - b.start)) {
    const rank         = CALLBACK_METHODS.get(n.callee.property.name)!
    const f            = n.arguments[0]
    const [el, ix, ar] = [f.params[rank], f.params[rank + 1], f.params[rank + 2]]
    const list         = f.params.length <= rank + 3 ? listPath(n.callee.object) : null
    if (!list || el?.type !== 'Identifier' || [ix, ar].some((p) => p && p.type !== 'Identifier') || ![el, ix, ar].every((p) => !p || neverLinked(p))) continue
    const idx = ix ? ix.name : `_mjs_i${elemAlias.size}`
    let sets  = !!ix
    addElement(el, list, idx, () => {
      if (sets) return
      sets       = true
      const last = f.params[f.params.length - 1]
      const add  = `, ${idx}`
      // `x => …` sans parenthèses : elles viennent avec les paramètres
      if (js.slice(last.end).trimStart()[0] === ')') ms.appendLeft(last.end, add)
      else {
        ms.prependRight(last.start, '(')
        ms.appendLeft(last.end, `${add})`)
      }
    })
  }

  // écriture par un élément de liste (cf. AliasEntry.guard) : `(test ? appel compilé : écriture telle qu'écrite)`, les paramètres du
  // rappel posés ; sans garde, l'appel seul. Une valeur lue en tête d'instruction (`x.n++ || f()`) garde l'écriture telle qu'écrite
  // avec l'enveloppe, qui la voit : rend `false` ; sans elle (réglage `proxy: false`), compilée aussi, posée entre les parenthèses de la
  // garde sans son propre point-virgule (`emit` reçoit des ancêtres où une parenthèse la sort de la tête). Une clé qui agit
  // (`x.t[k++] = 1`, `x.t[($l.reverse(), 0)] = 1`) garde toujours l'écriture telle qu'écrite : la garde se lirait avant son effet, qui
  // peut déplacer l'objet dans la liste (l'écriture irait à un autre), et sa cible liée (`+=`, `++`) poserait son point-virgule dans la garde
  function byGuard(node: any, ancestors: any[], tp: AliasEntry, emit: (anc: any[]) => void): boolean {
    const g = tp.guard
    if (!g) {
      emit(ancestors)
      return true
    }
    const asi = asiGuard(ancestors)
    // valeur ou argument qui attend (`x.n = await f()`) : la garde se lirait avant l'attente, la liste a pu changer depuis
    const pends = node.type === 'AssignmentExpression' ? suspension(node.right) : node.type === 'CallExpression' && node.arguments.some((a: any) => suspension(a))
    const head   = asi !== '' && !writeValueUnused(ancestors)
    if ((head && !withoutProxy) || acts(tp) || pends) return false
    // la branche telle qu'écrite, avec le réglage `proxy: false` : par l'aide gardée (cf. keptWrite) — l'élément déplacé atteint
    // peut-être un prototype ou une fonction du navigateur par une clé venue de l'extérieur
    // nom pris sur un chemin fixe (cf. nameGuards) dont la valeur agit : `t.c = f()` — la valeur d'abord, par un paramètre, puis la garde,
    // le chemin relu APRÈS elle ; écriture composée ou méthode (`t.n += f()`, `t.l.push(f())`) : l'écriture telle qu'écrite
    const actsV = nameGuards.has(g) && (node.type === 'AssignmentExpression' ? valueActs(node.right) : node.type === 'CallExpression' && node.arguments.some(valueActs))
    if (actsV && !(node.type === 'AssignmentExpression' && node.operator === '=')) return false
    let hoisted = ''
    if (actsV) {
      hoisted = node.right.type === 'SequenceExpression' ? `(${ms.slice(node.right.start, node.right.end)})` : ms.slice(node.right.start, node.right.end)
      ms.overwrite(node.right.start, node.right.end, '_mjs_v')
    }
    const orig = (withoutProxy && keptText(node, ancestors)) || ms.slice(node.start, node.end)
    emit(head ? [...ancestors.slice(0, -1), { type: 'ParenthesizedExpression', start: node.start - 1, end: node.end + 1, expression: node }, node] : ancestors)
    // préfixe posé À DROITE de `node.start` : il reste dans le texte de l'écriture quand elle est la valeur d'une autre (`t.n = t.z = 6`)
    ms.prependRight(node.start, hoisted ? `${asi}((_mjs_v) => (${g.test} ? ` : `${asi}(${g.test} ? `)
    ms.appendLeft(node.end, hoisted ? ` : ${orig}))(${hoisted})` : ` : ${orig})`)
    for (const f of g.params) f()
    return true
  }

  // ── Réglage `proxy: false` : les écritures que la passe ne voit pas (cf. AvisInvisible) ────────────────────────────────────
  // variable de l'état local que tient `e` : chemin de l'état, élément trouvé ou retiré (`$.l.find(f)`, `$.l.at(-1)`, `$.l.pop()`),
  // élément de liste suivi (cf. elemAlias), nom qui tient l'un d'eux (cf. localAliases) — sinon null
  const localAliases = new Map<string, string>()
  function localRoot(e: any): string | null {
    if (storeOnly || !e) return null
    if (e.type === 'ChainExpression') return localRoot(e.expression)
    if (e.type === 'Identifier') return elemAlias.get(bindingOf(e))?.guard?.root ?? localAliases.get(bindingOf(e)) ?? null
    // champ de l'instance qui en tient une partie (`@t = $l.find(f)` de CoffeeScript, `this.t`, cf. lie)
    if (e.type === 'MemberExpression' && e.object.type === 'ThisExpression' && !e.computed && e.property.type === 'Identifier') return localAliases.get('this.' + e.property.name) ?? null
    // prototype d'une partie de l'état local (`Object.getPrototypeOf($.l.find(f))`, cf. isProtoOf) : l'aide gardée le refuse
    if (e.type === 'CallExpression' && isProtoOf(e)) return localRoot(e.arguments[0])
    // valeur lue par `Reflect.get(o, k)` (celle de `o[k]`), élément trouvé par `Array.prototype.find.call(l, f)`
    if (isReflectGet(e)) return localRoot(e.arguments[0]) ?? copiedRoot(e.arguments[0])
    if (e.type === 'CallExpression' && listCall(e, FIND_METHODS)) return elementsRoot(e.arguments[0])
    // champ d'un objet fait par étalement (`({ ...$.o }).a`) : une partie de `$.o`
    if (e.type === 'MemberExpression') return e.object.type === 'Identifier' && e.object.name === '$' ? (e.computed ? null : e.property.name) : localRoot(e.object) ?? (e.computed || e.object.type === 'ObjectExpression' ? copiedRoot(e.object) : null)
    if (e.type === 'CallExpression') return e.callee.type === 'MemberExpression' && !e.callee.computed && (FIND_METHODS.has(e.callee.property.name) || POP_METHODS.has(e.callee.property.name)) ? localRoot(e.callee.object) ?? copiedRoot(e.callee.object) : null
    if (e.type === 'LogicalExpression') return localRoot(e.left) ?? localRoot(e.right)
    if (e.type === 'ConditionalExpression') return localRoot(e.consequent) ?? localRoot(e.alternate)
    return null
  }
  // variable de l'état local dont `e` tient les ÉLÉMENTS : une liste de l'état (cf. racineLocale), ou une liste calculée qui garde ses
  // objets (`$.l.filter(f)`, `$.l.slice(1)`, cf. COPY_METHODS, nom qui en tient une) — la copie elle-même n'en est pas une partie, ses
  // éléments si (`$.l.filter(f)[0]`, `c.find(g)`)
  function elementsRoot(e: any): string | null {
    return copiedRoot(e) ?? localRoot(e)
  }
  // nom qui tient une copie gardant les objets de l'état local (`c = $.l.filter(f)`) → la variable de la liste ; copie faite par
  // `Object.values`, `Object.entries` (ses paires), `Array.from` ou l'étalement (`[...$.l]`), comme pour le magasin (cf. copyRoot)
  const copiesLocales = new Map<string, string>()
  function copiedRoot(e: any): string | null {
    if (e?.type === 'ChainExpression') e = e.expression
    // étalement d'une liste ou d'un objet (`[...$.l]`, `({ ...$.o })`)
    if (e?.type === 'ArrayExpression' || e?.type === 'ObjectExpression') {
      let r: string | null = null
      for (const el of e.elements ?? e.properties) if (el?.type === 'SpreadElement') r ??= elementsRoot(el.argument)
      return r
    }
    const c = e?.type === 'CallExpression' ? e.callee : null
    const a = c?.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && e.arguments[0]?.type !== 'SpreadElement' ? e.arguments[0] : null
    if (a && ((c.object.name === 'Object' && (c.property.name === 'values' || c.property.name === 'entries')) || (c.object.name === 'Array' && c.property.name === 'from'))) return elementsRoot(a)
    // `concat` : les éléments de la liste et ceux des listes qu'il reçoit (`[].concat($.l)`) ; `Array.of(...$.l)`
    if (c?.type === 'MemberExpression' && !c.computed && (c.property.name === 'concat' || (c.object.type === 'Identifier' && c.object.name === 'Array' && c.property.name === 'of'))) {
      let r = c.property.name === 'concat' ? elementsRoot(c.object) : null
      for (const x of e.arguments) r ??= x.type === 'SpreadElement' ? elementsRoot(x.argument) : c.property.name === 'concat' ? elementsRoot(x) : null
      if (r) return r
    }
    if (c?.type === 'MemberExpression' && !c.computed && COPY_METHODS.has(c.property.name)) return elementsRoot(c.object)
    // liste retournée, triée ou remplie sur place (`$.l.slice().reverse()`, `c.sort(f)`), Map ou Set rendu par `set` ou `add` : la même
    // collection, ses éléments ; `splice` : la liste des éléments retirés ; `map(f)` et `flatMap(f)` : leur rappel peut rendre les objets
    // mêmes (`$.l.map((t) => t)`), écrits alors par l'aide gardée
    if (c?.type === 'MemberExpression' && !c.computed && (RETURNS_RAW.has(c.property.name) || c.property.name === 'map' || c.property.name === 'flatMap') && !POP_METHODS.has(c.property.name)) return elementsRoot(c.object)
    return e?.type === 'Identifier' ? copiesLocales.get(bindingOf(e)) ?? null : null
  }
  // nom (ou noms d'un motif : `{ constructor: c } = $.l.find(f)`) qui reçoit une partie de l'état local, ou une copie qui en garde les objets
  // `affecte` : motif d'une affectation (`({ [k]: c } = $.o)`), dont un nom posé par la passe est un champ (cf. patternKeyMap)
  function bound(target: any, value: any, assigns = false): void {
    // motif de liste sur une liste écrite (`[t] = [$.l.find(f)]`) : chaque nom reçoit sa valeur
    if (target.type === 'ArrayPattern' && value.type === 'ArrayExpression') {
      target.elements.forEach((c: any, i: number) => {
        const v = value.elements[i]
        if (c && v && v.type !== 'SpreadElement' && c.type !== 'RestElement') bound(c.type === 'AssignmentPattern' ? c.left : c, v, assigns)
      })
      return
    }
    const r = localRoot(value)
    if (target.type === 'MemberExpression') {
      if (r && target.object.type === 'ThisExpression' && !target.computed && target.property.type === 'Identifier') localAliases.set('this.' + target.property.name, r)
      return
    }
    // motif sur une copie qui garde les objets (`const [a] = $.l.splice(0, 1)`, `[x, y] = c`) : ses noms en tiennent une partie
    if (target.type !== 'Identifier') {
      bindPattern(target, r ?? copiedRoot(value), assigns)
      return
    }
    const c = r ? null : copiedRoot(value)
    if (r) localAliases.set(bindingOf(target), r)
    else if (c) copiesLocales.set(bindingOf(target), c)
  }
  // nom qui tient une partie de l'état local (`t = $.o`, `const it = $.l.find(f)`, `t ??= $.l.find(f)`) ; deux tours pour une chaîne
  // (`b = a`). Motif (`for (const { constructor: c } of $.l)`, `({ constructor: c }) => …`) : chacun de ses noms
  const bindPattern = (p: any, r: string | null, assigns = false) => {
    if (!r) return
    forEachPatternLeaf(p, (f: any) => { if (f.type === 'Identifier') localAliases.set(bindingOf(f), r) })
    patternKeys(p, assigns)
  }
  // clé calculée d'un motif qui lit une partie de l'état (`const { [k]: c } = $.l.find(f)`) : jugée par `µ._mjs_deepName` et
  // `µ._mjs_deepNameRead` (mjs_deep.ts), qui refusent une clé réservée menant à une fonction ou à un prototype — le motif lit alors une clé
  // absente (cf. patternKeyMap, posé après la passe) ; propriété du motif → vrai dans un motif d'affectation (cf. lie)
  const patternKeyMap = new Map<any, boolean>()
  function patternKeys(p: any, assigns = false): void {
    if (p?.type === 'ObjectPattern') {
      for (const q of p.properties) {
        if (q.type === 'RestElement') continue
        if (q.computed && q.key.type !== 'Literal' && !(q.key.type === 'TemplateLiteral' && q.key.expressions.length === 0)) patternKeyMap.set(q, assigns)
        patternKeys(q.value, assigns)
      }
    }
    else if (p?.type === 'ArrayPattern') for (const q of p.elements) patternKeys(q, assigns)
    else if (p?.type === 'AssignmentPattern') patternKeys(p.left, assigns)
    else if (p?.type === 'RestElement') patternKeys(p.argument, assigns)
  }
  // méthode d'une liste appelée sur `l` (`Array.prototype.find.call(l, f)`) dont le nom est dans `noms`
  const listCall = (e: any, names: Set<string> | Map<string, number>) => e.callee.type === 'MemberExpression' && !e.callee.computed && e.callee.property.name === 'call' && isArrayMethod(e.callee.object) && names.has(e.callee.object.property.name) && e.arguments.length > 0 && e.arguments[0].type !== 'SpreadElement'
  // noms qui tiennent la valeur de `pop` & co. (cf. returnsRaw, lieBrut) : avec l'enveloppe, ceux d'localAliases, posés seulement pour
  // ces valeurs ; avec le réglage `proxy: false`, à part (localAliases y tient toute partie de l'état), lus par keptRoot
  const rawNames = withoutProxy ? new Map<string, string>() : localAliases
  // valeurs que tient une liste ou un objet écrits (`[0, t]`, `{ t }`, `[...l]`, `{ ...o }`) ou que garde une copie (`Object.values(o)`,
  // `Object.entries(o)`, `Object.fromEntries(l)`, `Object.assign({}, o)`, `Array.from(l)`, `Array.of(t)`, `l.concat(t)`) : ses parties
  // sont les leurs (cf. racineBrute) ; sinon null
  function copySources(e: any): any[] | null {
    if (e.type === 'ArrayExpression') return e.elements.filter(Boolean).map((x: any) => x.type === 'SpreadElement' ? x.argument : x)
    if (e.type === 'ObjectExpression') return e.properties.map((p: any) => p.type === 'SpreadElement' ? p.argument : p.kind === 'init' && !p.method ? p.value : null).filter(Boolean)
    const c = e.type === 'CallExpression' ? e.callee : null
    if (c?.type !== 'MemberExpression' || c.computed) return null
    const args = e.arguments.map((x: any) => x.type === 'SpreadElement' ? x.argument : x)
    if (c.property.name === 'concat') return [c.object, ...args]
    if (c.object.type !== 'Identifier') return null
    if (c.object.name === 'Object' && /^(?:values|entries|fromEntries|assign)$/.test(c.property.name)) return args
    return c.object.name === 'Array' && (c.property.name === 'from' || c.property.name === 'of') ? args.slice(0, c.property.name === 'from' ? 1 : undefined) : null
  }
  // objet du script dont `m` écrit un champ (`o.t`, `o.a.t`) : sa variable (cf. bindingOf) ; ni `$`, ni un nom libre (`window`), sinon null
  function baseLocale(m: any): string | null {
    let b = m
    while (b.type === 'MemberExpression') b = b.object
    if (b.type !== 'Identifier' || b.name === '$') return null
    const v = bindingOf(b)
    return v.startsWith(':') ? null : v
  }
  // variable de l'état local d'une valeur que la méthode compilée laisse brute : la méthode qui l'a rendue (cf. returnsRaw), le nom qui la
  // tient (cf. rawNames), une liste, un objet ou une copie qui la tient (cf. copySources), le prototype d'une partie de l'état, ou une
  // chaîne qui part d'eux (`$.l.pop().tags`, `t.find(f)`, `Object.values($.l.pop())[0]`) ; sinon null
  function rawRoot(e: any): string | null {
    for (let x = e; x;) {
      const r = returnsRaw(x)
      if (r) return r
      const s = copySources(x)
      if (s) {
        for (const y of s) {
          const q = rawRoot(y)
          if (q) return q
        }
        return null
      }
      if (x.type === 'Identifier') return rawNames.get(bindingOf(x)) ?? null
      if (x.type === 'MemberExpression' && x.object.type === 'ThisExpression' && !x.computed && x.property.type === 'Identifier') return rawNames.get('this.' + x.property.name) ?? null
      if (x.type === 'ConditionalExpression' || x.type === 'LogicalExpression') return rawRoot(x.type === 'LogicalExpression' ? x.left : x.consequent) ?? rawRoot(x.type === 'LogicalExpression' ? x.right : x.alternate)
      if (x.type === 'CallExpression' && isProtoOf(x)) return localRoot(x)
      x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : x.type === 'AwaitExpression' ? x.argument : x.type === 'SequenceExpression' ? x.expressions[x.expressions.length - 1] : null
    }
    return null
  }
  // appel compilé (`µ._mjs_deepCall`) d'une méthode de RETURNS_RAW sur un chemin de l'état local (`$.l.pop()`, `$.o.l.splice(i, 1)`,
  // élément suivi `t.tags.sort(f)`) : la variable de l'état ; sinon null
  function returnsRaw(e: any): string | null {
    if (storeOnly || e?.type !== 'CallExpression') return null
    const c = e.callee
    if (c.type !== 'MemberExpression' || c.computed || !RETURNS_RAW.has(c.property.name)) return null
    const tp = getPath(c.object, true)
    return tp?.origin === 'local' && typeof tp.path[0] === 'string' ? tp.path[0] : null
  }
  // fonction écrite dans ce code et jamais réaffectée qu'un nom désigne (`function cmp(a, b) {…}`, `const cmp = (a, b) => …`) : ses
  // paramètres reçoivent ce que reçoit le nom passé en rappel (`$.l.sort(cmp)`) ; sinon null
  let functions: Map<string, any> | null = null
  function localFunction(id: any): any {
    if (id?.type !== 'Identifier' || tainted.has(id.name)) return isFunction(id ?? {}) ? id : null
    if (!functions) {
      functions = new Map()
      walk.simple(ast, {
        FunctionDeclaration(n: any) {
          if (n.id) functions!.set(bindingOf(n.id), n)
        },
        VariableDeclarator(n: any) {
          if (n.id.type === 'Identifier' && n.init && isFunction(n.init)) functions!.set(bindingOf(n.id), n.init)
        },
        // variable déclarée sans valeur, affectée une seule fois (cf. once) : `cmp = (a, b) -> …` de CoffeeScript
        AssignmentExpression(n: any) {
          if (once.has(n) && n.left.type === 'Identifier' && isFunction(n.right)) functions!.set(bindingOf(n.left), n.right)
        },
      })
    }
    return functions.get(bindingOf(id)) ?? null
  }
  // tours jusqu'à ce qu'aucun nom neuf ne se lie (`c3 = b3`, `b3 = a3`, `a3 = $.l.find(f)`, écrits dans cet ordre), huit au plus
  if (withoutProxy && !storeOnly) {
    for (let turn = 0, size = -1; turn < 8 && size !== localAliases.size + copiesLocales.size; turn++) {
      size = localAliases.size + copiesLocales.size
      walk.simple(ast, {
        VariableDeclarator(n: any) {
          if (n.init) bound(n.id, n.init)
        },
        AssignmentExpression(n: any) {
          if (n.operator === '=' || LOGICAL_ASSIGN.has(n.operator)) bound(n.left, n.right, true)
        },
        // variable d'une boucle `for … of` sur une liste de l'état, calculée ou non (`for (const y of $.l.filter(f))`)
        ForOfStatement(n: any) {
          const r = elementsRoot(n.right)
          let id  = n.left.type === 'VariableDeclaration' ? n.left.declarations[0]?.id : n.left
          const c = n.right.type === 'CallExpression' ? n.right.callee : null
          // paire rendue par `entries()` (`for (const [i, y] of $.l.entries())`) : l'élément en est le second
          if (id?.type === 'ArrayPattern' && c?.type === 'MemberExpression' && !c.computed && c.property.name === 'entries') id = id.elements[1]
          if (id?.type !== 'MemberExpression') bindPattern(id, r, n.left.type !== 'VariableDeclaration')
        },
        // paramètres d'un rappel écrit en place sur une liste de l'état, calculée ou non : l'élément, et la liste reçue en 3e
        // (`$.l.forEach((x, i, arr) => { arr[i].n = 1 })`) ; les deux éléments d'un rappel de comparaison (`$.l.sort((a, b) => …)`)
        // méthode appelée sur `l` (`Array.prototype.forEach.call(l, f)`) ; `reduce` et `reduceRight` sans valeur de départ :
        // l'accumulateur part du premier élément
        CallExpression(n: any) {
          const call = listCall(n, CALLBACK_METHODS)
          const c    = call ? n.callee.object : n.callee
          const args = call ? n.arguments.slice(1) : n.arguments
          const name = c.type === 'MemberExpression' && !c.computed ? c.property.name : null
          const rank = name === null ? undefined : CALLBACK_METHODS.get(name)
          const a0   = rank === undefined && !SORT_METHODS.has(name ?? '') ? null : args[0]
          // rappel nommé : la fonction écrite dans ce code (cf. localFunction) ; un rappel que la passe ne lit pas (paramètre, import,
          // méthode, `this.cmp`) reste hors de la garde
          const f = a0 && localFunction(a0)
          const r = a0 ? elementsRoot(call ? n.arguments[0] : c.object) : null
          if (r && f) for (const p of rank === undefined ? f.params.slice(0, 2) : [f.params[rank], f.params[rank + 2], rank === 1 && args.length === 1 ? f.params[0] : null]) bindPattern(p, r)
        },
      })
    }
  }
  // ce que la méthode compilée (`µ._mjs_deepCall`) laisse BRUT — la valeur de `pop` & co. (cf. returnsRaw : `t = $.l.pop()`,
  // `const [a] = $.l.splice(0, 1)`, `for (const t of $.l.splice(0, 2))`, `$.l.splice(0, 2).forEach((t) => …)`), une liste, un objet ou une
  // copie qui la tient (`o = { t: $.l.pop() }`, `o.t = $.l.pop()` : l'objet `o` du script), le paramètre d'une fonction appelée en place
  // (`((o) => …)(t)`), et les deux éléments du rappel de comparaison de `sort` sur une liste de l'état (`$.l.sort((a, b) => …)`,
  // `$.l.sort(cmp)` d'une fonction de ce code, cf. localFunction) ; les noms qui les reçoivent ensuite (`c = a` dans le rappel, `s = a`
  // hors de lui, `p = Object.getPrototypeOf($.o)`) aussi. Une écriture par eux passe par l'aide gardée (cf. keptRoot) ; avec le
  // réglage, la passe voit déjà les noms qui tiennent une partie de l'état (cf. lie), ceux-ci y ajoutent ce qu'elle ne suit pas
  if (!storeOnly) {
    const bindNames = (p: any, r: string | null, assigns = false) => {
      if (!withoutProxy) return bindPattern(p, r, assigns)
      if (r) forEachPatternLeaf(p, (f: any) => { if (f.type === 'Identifier') rawNames.set(bindingOf(f), r) })
    }
    const bindRaw = (target: any, value: any, assigns = false): void => {
      // motif de liste sur une liste écrite (`[t] = [$.l.pop()]`) : chaque nom reçoit sa valeur
      if (target.type === 'ArrayPattern' && value.type === 'ArrayExpression') {
        target.elements.forEach((c: any, i: number) => {
          const v = value.elements[i]
          if (c && v && v.type !== 'SpreadElement' && c.type !== 'RestElement') bindRaw(c.type === 'AssignmentPattern' ? c.left : c, v, assigns)
        })
        return
      }
      const r = rawRoot(value)
      if (!r) return
      let v = value
      while (v.type === 'ChainExpression' || v.type === 'AwaitExpression') v = v.type === 'ChainExpression' ? v.expression : v.argument
      if (target.type === 'Identifier') {
        rawNames.set(bindingOf(target), r)
      }
      else if (target.type !== 'MemberExpression') bindNames(target, r, assigns)
      // champ de l'instance (`@t = $l.pop()` de CoffeeScript, `this.t`)
      else if (target.object.type === 'ThisExpression' && !target.computed && target.property.type === 'Identifier') rawNames.set('this.' + target.property.name, r)
      // champ d'un objet du script (`o.t = $.l.pop()`) : l'objet en tient une partie
      else {
        const b = baseLocale(target)
        if (b) rawNames.set(b, r)
      }
    }
    for (let turn = 0, size = -1; turn < 8 && size !== rawNames.size; turn++) {
      size = rawNames.size
      walk.simple(ast, {
        VariableDeclarator(n: any) {
          if (n.init) bindRaw(n.id, n.init)
        },
        AssignmentExpression(n: any) {
          if (n.operator === '=' || LOGICAL_ASSIGN.has(n.operator)) bindRaw(n.left, n.right, true)
        },
        ForOfStatement(n: any) {
          const id = n.left.type === 'VariableDeclaration' ? n.left.declarations[0]?.id : n.left
          if (id && id.type !== 'MemberExpression') bindNames(id, rawRoot(n.right), n.left.type !== 'VariableDeclaration')
        },
        CallExpression(n: any) {
          // fonction appelée en place (`((o) => { o.a[k].x = v })(t)`) : chaque paramètre reçoit son argument
          if (isFunction(n.callee)) n.callee.params.forEach((p: any, i: number) => {
            const a = n.arguments[i]
            if (a && a.type !== 'SpreadElement') bindRaw(p.type === 'AssignmentPattern' ? p.left : p, a)
          })
          const c    = n.callee
          const name = c.type === 'MemberExpression' && !c.computed ? c.property.name : null
          const rank = name === null ? undefined : CALLBACK_METHODS.get(name)
          // tri compilé d'une liste de l'état (`$.l.sort(f)`), rappel sur une valeur brute (`$.l.splice(0, 2).forEach(f)`)
          const sort = name === 'sort' && returnsRaw(n) !== null
          const r    = sort ? returnsRaw(n) : rank !== undefined || name === 'sort' ? rawRoot(c.object) : null
          if (!r || !n.arguments[0]) return
          // rappel que la passe ne lit pas : hors de la garde
          const f = localFunction(n.arguments[0])
          if (f) for (const p of rank === undefined ? f.params.slice(0, 2) : [f.params[rank], f.params[rank + 2], rank === 1 && n.arguments.length === 1 ? f.params[0] : null]) bindNames(p, r)
        },
      })
    }
  }
  // clés calculées des motifs liés (cf. patternKeys) — aucune case ni pile partagée, rien ne reste après une erreur : une déclaration
  // (`[k]: c`) devient `[µ._mjs_deepNameA]: n = µ._mjs_deepName(k), [n]: t, [µ._mjs_deepNameA]: c = µ._mjs_deepNameRead(t, n)` — la clé absente
  // `µ._mjs_deepNameA` donne à `n` la clé convertie une fois (le texte entre les crochets, entier : `[(0, k)]`), la valeur est lue une fois
  // dans `t`, puis jugée avec sa clé par `µ._mjs_deepNameRead` (mjs_deep.ts), deux noms posés ici, propres au site et à chaque appel. Un motif
  // d'affectation, sans nom à poser, passe par un cadre neuf (`µ._mjs_deepName(k, 1)`) : `[µ._mjs_deepNameA]: µ._mjs_deepNameF = µ._mjs_deepName(k, 1),
  // [µ._mjs_deepNameF.k]: µ._mjs_deepNameF.v, [µ._mjs_deepNameA]: c = µ._mjs_deepNameV` — JavaScript évalue la cible `µ._mjs_deepNameF.v`
  // (son cadre) avant de lire la valeur, que le cadre juge en la recevant. Un défaut écrit (`[k]: c = d`) passe par un motif de liste
  // (`[c = d] = [jugée]`), qui le prend quand la valeur jugée est `undefined`
  for (const [q, assigns] of patternKeyMap) {
    const n    = assigns ? 'µ._mjs_deepNameF' : `_mjs_cn${q.key.start}`
    const t    = assigns ? 'µ._mjs_deepNameF.v' : `_mjs_keyAt${q.key.start}`
    const read = assigns ? 'µ._mjs_deepNameV' : `µ._mjs_deepNameRead(${t}, ${n})`
    const def  = q.value.type === 'AssignmentPattern'
    ms.appendLeft(q.start + 1, `µ._mjs_deepNameA]: ${n} = µ._mjs_deepName(`)
    ms.prependRight(js.indexOf(']', q.key.end), `${assigns ? ', 1' : ''}), [${assigns ? n + '.k' : n}`)
    ms.prependLeft(q.value.start, `${t}, [µ._mjs_deepNameA]: ${def ? '[' : ''}`)
    ms.prependRight(q.value.end, def ? `] = [${read}]` : ` = ${read}`)
    changed = true
  }
  // écriture par `objet` que la passe ne compile pas : un objet de l'état local (nom qui en tient une partie, élément rendu par une
  // méthode, `$.l.find(f)`) fait avertir, nommé par sa tête, ou par son texte quand elle est `$`
  function invisible(object: any, at: number): void {
    const r = withoutProxy ? localRoot(object) : null
    if (!r) return
    let e = object
    while (e.type === 'MemberExpression' || e.type === 'ChainExpression' || e.type === 'CallExpression') e = e.type === 'MemberExpression' ? e.object : e.type === 'ChainExpression' ? e.expression : e.callee
    // tête qui ne tient rien de l'état (`Object` de `Object.values($m)[0]`) : le texte de l'objet
    notice.push({ at, shape: 1, name: e.type === 'Identifier' && e.name !== '$' && localRoot(e) ? e.name : js.slice(object.start, object.end).replace(/\$\./g, '$'), root: '$' + r })
  }
  // variable de l'état local dont l'objet `e` d'une écriture que la passe ne compile pas est une partie (réglage `proxy: false`) : celle de
  // racineLocale, ou celle d'une chaîne de membres et d'appels qui part de l'état (`$.l.values().next().value`, `$.l.map(f)[0]`) — la clé
  // de l'aide gardée (cf. LOCALE) ; sinon null. Un objet rendu par un appel est une valeur neuve (`$.l.slice().reverse()`), sauf un
  // élément trouvé ou retiré (cf. racineLocale)
  function keptRoot(e: any): string | null {
    if (storeOnly) return null
    // avec l'enveloppe, ce qu'elle ne garde pas (cf. racineBrute) : une chaîne qui part de la valeur de `pop` & co. (`$.l.pop()[k].x = v`,
    // `(0, $.l.shift()).x = v`), d'un nom qui en tient une, d'un élément du rappel de `sort` (`a[k].x = v`), du prototype d'une partie de
    // l'état (`Object.getPrototypeOf($.o).constructor.x = v`)
    if (!withoutProxy) {
      const r = rawRoot(e)
      return r ? LOCALE + r : null
    }
    if ((e.type === 'ChainExpression' ? e.expression : e).type === 'CallExpression') {
      const r = localRoot(e)
      if (r) return LOCALE + r
    }
    // tête faite d'une virgule ou d'un `await` (`(0, $.l.pop())[k].x = v`) : leur valeur
    else for (let x = e; x; x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : x.type === 'SequenceExpression' ? x.expressions[x.expressions.length - 1] : x.type === 'AwaitExpression' ? x.argument : null) {
      const r = localRoot(x)
      if (r) return LOCALE + r
    }
    // valeur de `pop` & co. tenue par une liste, un objet ou une copie (`Object.assign({}, $.l.pop()).a`), un nom qui les tient, le
    // paramètre d'une fonction appelée en place (cf. lieBrut) : sortie de l'état, aucun avertissement, l'écriture gardée
    const b = rawRoot(e)
    return b ? LOCALE + b : null
  }
  // objet d'une écriture gardée dont la chaîne écrit un nom réservé dans le code (`$.l.find(f).constructor.prototype`, `['__proto__']`),
  // sans clé calculée après lui (cf. ctorWritten) : passé par `µ._mjs_deepSafe`, qui nomme ce nom (le premier écrit) quand il mène à un
  // prototype ou à une fonction du navigateur ; sinon le texte tel quel
  // `texte` : celui de l'objet, ses clés calculées déjà lues par `µ._mjs_deepKey` (cf. boundChain, keptKeys) ; `sur` : l'objet passe
  // toujours par `µ._mjs_deepSafe` (premier argument d'`Object.assign`, cf. firstGuard ; objet d'une écriture avec `yield`)
  function guardedObject(root: string, e: any, text: string, safe = false): string {
    let s: string | null = null
    for (let x = e; x; x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : null) {
      if (x.type !== 'MemberExpression') continue
      const k    = x.property
      const name = !x.computed ? k.name : k.type === 'Literal' ? k.value : k.type === 'TemplateLiteral' && k.expressions.length === 0 ? k.quasis[0].value.cooked : undefined
      if (name === undefined) break
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') s = name
    }
    // objet du magasin (`#$` devant sa clé, cf. firstGuard) : l'aide du magasin, sans le module des écritures profondes
    const helper = root.startsWith(LOCALE + '$') ? 'µ._mjs_storeSafe' : 'µ._mjs_deepSafe'
    return s ? `${helper}(${JSON.stringify(root.slice(1))}, ${text}, "${s}")` : safe ? `${helper}(${JSON.stringify(root.slice(1))}, ${text})` : text
  }
  // texte du premier argument `e` d'une fonction qui modifie l'objet qu'elle reçoit (cf. firstGuard), tenu entre `start` et `end` :
  // chaque clé calculée de sa chaîne (`$.l.find(f)[k]`), ni littérale ni dans une chaîne `?.`, lue par `aide` (cf. keyHelper, boundChain).
  // Sans une telle clé, ou sans aide, `texte`
  function keptKeys(e: any, text: string, start: number, end: number, helper: string | null): string {
    const keys: any[] = []
    for (let x = e; x; x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : null) {
      if (x.optional || x.type === 'ChainExpression') return text
      // appel déjà réécrit (cf. reecrit) : ses clés sont celles du chemin compilé, qui les refuse lui-même
      if (rewritten(x)) break
      if (x.type === 'MemberExpression' && x.computed && x.property.type !== 'Literal' && !(x.property.type === 'TemplateLiteral' && x.property.expressions.length === 0)) keys.push(x)
    }
    if (!keys.length || !helper) return text
    const copy = ms.clone()
    for (const x of keys) {
      const opens = js.lastIndexOf('[', x.property.start)
      copy.prependRight(x.start, helper + '(')
      copy.overwrite(opens, opens + 1, ', ')
      copy.overwrite(x.end - 1, x.end, ')')
    }
    return copy.slice(start, end)
  }
  // écriture relue dont la valeur porte `yield` (`$.l.find(f)[k].x ||= yield v`, `$$l.find(f)[k].x ||= yield v`) : aucune fonction
  // fléchée ne reçoit le `yield`, l'objet passe en place par `µ._mjs_deepSafe`, qui rend un objet gelé pour un prototype ou une fonction
  // du navigateur ; l'écriture reste celle de JavaScript, sans aide ni redessin. Rend faux quand rien n'est posé (`?.` dans l'objet)
  function objectInPlace(m: MagicString, target: any, root: string): boolean {
    const p = foundParts(target, keyHelper(root))
    if (!p || p.binds.length) return false
    const r = root[0] === LOCALE ? root : LOCALE + '$' + (root === SOFT || root === NO_KEY ? '…' : root)
    m.overwrite(target.start, p.sep, guardedObject(r, target.object, p.obj, true))
    return true
  }
  // écriture `node` par un objet de l'état local que la passe ne compile pas (cf. keptRoot), posée sur `m` (le texte, ou sa copie, cf.
  // keptText) par l'aide gardée : affectation, `++`/`--` (`bloc` : l'instruction qu'elle est, cf. loneStatement), méthode qui
  // modifie, `delete`. Rend faux quand rien n'est posé (aucun objet de l'état, `?.` dans l'objet, `yield` qu'aucune fonction fléchée ne
  // reçoit) : l'écriture reste telle qu'écrite
  function keptWrite(m: MagicString, node: any, ancestors: any[], block: any = null): boolean {
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = node.type === 'AssignmentExpression' ? node.left : node.argument
      const root   = target.type === 'MemberExpression' ? keptRoot(target.object) : null
      const wait   = root ? suspension(node.type === 'AssignmentExpression' ? node.right : target) : null
      const t      = root && !(wait === 'yield' && node.type === 'UpdateExpression') ? foundTarget(target, root, node.type === 'UpdateExpression' || node.operator !== '=', wait === 'await') : null
      if (t && wait === 'yield' && t.bind) return objectInPlace(m, target, root!)
      if (!t) return false
      if (node.type === 'AssignmentExpression') emitAssign(m, js, node, ancestors, t)
      else {
        emitUpdate(m, node, ancestors, t, !!block)
        if (block) setBlock(m, block)
      }
      return true
    }
    const target = node.type === 'CallExpression' ? node.callee : node.argument
    const root   = target?.type === 'MemberExpression' && !(node.type === 'CallExpression' && (target.computed || node.optional)) ? keptRoot(target.object) : null
    const p      = root ? foundParts(target, keyHelper(root)) : null
    if (!p || p.binds.length) return false
    const obj = guardedObject(root!, target.object, p.obj)
    if (node.type === 'UnaryExpression') m.overwrite(node.start, node.end, `${onHead('Delete', root!)}${obj}, ${p.key})`)
    else if (node.arguments.length === 0) m.overwrite(node.start, node.end, `${onHead('Call', root!)}${obj}, '${target.property.name}', [])`)
    else {
      m.overwrite(node.start, js.indexOf('(', target.end) + 1, `${onHead('Call', root!)}${obj}, '${target.property.name}', [`)
      m.overwrite(node.end - 1, node.end, '])')
    }
    return true
  }
  // la même écriture, posée sur une copie du texte entre les parenthèses d'une garde (cf. byGuard) : son texte, ou null
  function keptText(node: any, ancestors: any[]): string | null {
    const copy = ms.clone()
    const anc  = [...ancestors.slice(0, -1), { type: 'ParenthesizedExpression', start: node.start - 1, end: node.end + 1, expression: node }, node]
    return keptWrite(copy, node, anc) ? copy.slice(node.start, node.end) : null
  }
  // écriture que la passe ne compile pas : avertie avec le réglage `proxy: false` (cf. invisible), passée par l'aide gardée quand son
  // objet est une partie de l'état local (cf. keptWrite)
  function invisibleWrite(node: any, ancestors: any[], object: any, block: any = null): void {
    invisible(object, node.start)
    if (keptWrite(ms, node, ancestors, block)) changed = true
  }
  // nom d'une fonction écrite `Objet.nom` (`Object.assign`) ; méthode d'une liste qui la modifie, prise sur `Array.prototype` ou sur une
  // liste vide écrite (`Array.prototype.push`, `[].splice`) : `Array.prototype.nom` — sinon null
  function functionName(e: any): string | null {
    if (e?.type !== 'MemberExpression' || e.computed) return null
    const o = e.object
    if (o.type === 'Identifier') return `${o.name}.${e.property.name}`
    const list = (o.type === 'MemberExpression' && !o.computed && o.object.type === 'Identifier' && o.object.name === 'Array' && o.property.name === 'prototype') || (o.type === 'ArrayExpression' && o.elements.length === 0)
    return list && MUTATIVE_METHODS.Array.has(e.property.name) ? `Array.prototype.${e.property.name}` : null
  }
  // objet que modifie ou fige un appel (cf. firstGuard, invisibleCall) : premier argument d'une fonction qui modifie ou fige ce qu'elle
  // reçoit (cf. WRITES_FIRST, FREEZES_FIRST), écrit tel quel, premier élément d'une liste écrite étalée (`Object.assign(...[o], …)`),
  // ou passé par `call`, `apply`, `Reflect.apply` (`Object.assign.apply(null, [o, …])`, `Reflect.apply(Object.assign, null, [o, …])`) ;
  // objet sur lequel `call`, `apply` ou `Reflect.apply` appelle une méthode d'une liste qui la modifie (`Array.prototype.push.call(o, v)`).
  // Rend le nom de la fonction et l'objet, null sinon
  function modifiedTarget(node: any): { name: string, target: any } | null {
    const c    = node.callee
    let name   = functionName(c)
    let fn     = c
    let itself = null
    let args   = node.arguments
    if (name === 'Reflect.apply') {
      fn     = node.arguments[0]
      name   = functionName(fn)
      itself = node.arguments[1]
      args   = node.arguments[2]?.type === 'ArrayExpression' ? node.arguments[2].elements : null
    }
    else if (!name && c?.type === 'MemberExpression' && !c.computed && (c.property.name === 'call' || c.property.name === 'apply')) {
      fn     = c.object
      name   = functionName(fn)
      itself = node.arguments[0]
      args   = c.property.name === 'call' ? node.arguments.slice(1) : node.arguments[1]?.type === 'ArrayExpression' ? node.arguments[1].elements : null
    }
    if (!name) return null
    // méthode d'une liste : l'objet de l'appel
    if (name.startsWith('Array.prototype.')) return fn !== c && itself && itself.type !== 'SpreadElement' ? { name, target: itself } : null
    if (!(WRITES_FIRST.test(name) || FREEZES_FIRST.test(name)) || !args) return null
    let a0 = args[0]
    if (a0?.type === 'SpreadElement' && a0.argument.type === 'ArrayExpression') a0 = a0.argument.elements[0]
    return a0 && a0.type !== 'SpreadElement' ? { name, target: a0 } : null
  }
  // objet que modifie ou fige un appel (cf. modifiedTarget), pris dans le magasin, ou dans l'état local avec le réglage `proxy: false` :
  // passé par `µ._mjs_storeSafe` (magasin) ou `µ._mjs_deepSafe`, qui refusent un prototype ou une fonction du navigateur
  // (`Object.assign($$t.find(f).constructor, …)`) — la fonction reçoit alors un objet gelé, et échoue comme avec l'enveloppe
  function firstGuard(node: any): void {
    const a0 = modifiedTarget(node)?.target
    if (!a0) return
    const store = findRoot(a0)
    const root  = store !== null && store !== SOFT && store !== NO_KEY ? LOCALE + '$' + store : keptRoot(a0)
    const text  = root ? piece(a0.start, a0.end) : null
    if (text === null) return
    ms.overwrite(a0.start, a0.end, guardedObject(root!, a0, keptKeys(a0, text, a0.start, a0.end, keyHelper(root!)), true))
    changed = true
  }
  // appel qui peut modifier l'état local sans passer par une aide : fonction qui modifie son premier argument ; appel dont la valeur
  // n'est pas lue (appelé pour son effet) — méthode inconnue d'un objet de l'état, rappel venu d'ailleurs qui reçoit ses éléments,
  // objet de l'état passé en argument. Une méthode qui modifie une liste, une Map, un Set ou une Date est compilée
  function invisibleCall(node: any, ancestors: any[]): void {
    const c      = node.callee
    const object = c.type === 'MemberExpression' && !c.computed ? (c.object.type === 'Identifier' ? c.object.name : c.object.type === 'ThisExpression' ? 'this' : null) : null
    const fnName = c.type === 'Identifier' ? c.name : object ? `${object}.${c.property.name}` : null
    const a0     = node.arguments[0]
    // fonction qui modifie ce qu'elle reçoit, appelée par son nom, par `call`, `apply` ou `Reflect.apply` (cf. modifiedTarget)
    const cm    = modifiedTarget(node)
    if (cm && !FREEZES_FIRST.test(cm.name)) {
      const r = localRoot(cm.target)
      if (r) notice.push({ at: node.start, shape: 2, name: cm.name, root: '$' + r })
      return
    }
    if (!writeValueUnused(ancestors) || (fnName && NO_WRITE_FN.test(fnName))) return
    const r = c.type === 'MemberExpression' && !c.computed ? localRoot(c.object) : null
    if (r) {
      const m = c.property.name
      if (CALLBACK_METHODS.has(m)) {
        if (a0 && a0.type !== 'SpreadElement' && !isFunction(a0)) notice.push({ at: node.start, shape: 5, name: js.slice(a0.start, a0.end), root: '$' + r })
      }
      else if (!ALL_MUTATIVE.has(m) && !NO_WRITE.has(m)) notice.push({ at: node.start, shape: 3, name: m, root: '$' + r })
      return
    }
    // méthode d'une liste, d'une Map ou d'un Set appelée sur une copie qui garde les objets de l'état (`l = Array.from($l)`, puis
    // `l.splice(i, 0, t)`) : elle range ou lit l'objet reçu, sans le modifier — aucun avertissement
    if (c.type === 'MemberExpression' && !c.computed && (ALL_MUTATIVE.has(c.property.name) || NO_WRITE.has(c.property.name)) && copiedRoot(c.object)) return
    for (const a of node.arguments) {
      const ra = localRoot(a.type === 'SpreadElement' ? a.argument : a)
      if (ra) {
        notice.push({ at: node.start, shape: 4, name: fnName ?? js.slice(c.start, c.end), root: '$' + ra })
        return
      }
    }
  }
  // variable de la tête d'une boucle du script (cf. ForOfStatement)
  let heads = 0

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
      // l'IIFE qu'elle a laissée). Les cibles `$.x` du motif, déjà réécrites par transformReactiveWrites, sont laissées
      // telles quelles ; celles du magasin et de l'état local profond (`$.o.k`) passent par les aides (cf. byHelpers).
      if (node.operator === '=' && (target.type === 'ArrayPattern' || target.type === 'ObjectPattern')) {
        const storeTargets: { node: any, set: string, tail?: string }[] = []
        collectStoreTargets(target, storeTargets)
        if (storeTargets.length === 0) return // motif sans cible du magasin ni chemin profond, intouché (`$.x` géré ailleurs)

        // ASI, `void`, parenthèses du motif : même forme que le motif LOCAL (cf. emitPattern)
        emitPattern(ms, js, node, ancestors, storeTargets.map(t => t.node), storeTargets.map(t => t.set), '_mjsS', '_mjsSR', storeTargets.map(t => t.tail ?? ')'))
        changed = true
        return
      }

      if (target.type !== 'MemberExpression') return

      const tp = getPath(target, true)
      if (!tp) {
        // `yield` dans la valeur : la forme directe seulement (`µ._mjs_storeSetOn(…, yield v)`, arguments évalués dans
        // l'ordre de JavaScript), aucune fonction fléchée ne peut le recevoir
        const root = findRoot(target.object)
        const wait = root ? suspension(node.right) : null
        const t    = root ? foundTarget(target, root, isCompound, wait === 'await') : null
        if (t && !(wait === 'yield' && t.bind)) {
          if (!storePath(node, ancestors)) emitAssign(ms, js, node, ancestors, t)
          changed = true
        }
        else if (t && objectInPlace(ms, target, root!)) changed = true
        else invisibleWrite(node, ancestors, target.object)
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

      // Compound (`+=` etc.) : l'origine 'store' est traitée ici, l'état local
      // aussi (cf. la fin de ce commentaire). Court-circuit `||=`/`&&=`/`??=` :
      // `baseOp` EST le vrai opérateur JS (`||`/`&&`/`??`), le rhs n'est donc
      // évalué QUE si le court-circuit le permet (sémantique native préservée) ;
      // `_storeSet`/`_mjs_storeDeepSet` sautent en plus l'écriture+notification si
      // la valeur calculée est identique à l'existante (cas où le court-circuit
      // renvoie la valeur de gauche inchangée).
      // l'état local aussi, avec ou sans l'enveloppe : cf. byHelpers ; une clé qui agit, relue, passe par un paramètre (cf.
      // pathTargetRead), qu'une valeur de droite avec `yield` ne peut pas recevoir
      if (isCompound) {
        if (!byHelpers(tp)) return
        const wait = suspension(node.right)
        if ((wait === 'yield' && acts(tp)) || !byGuard(node, ancestors, tp, (anc) => emitAssign(ms, js, node, anc, pathTargetRead(tp, target, wait === 'await')))) return invisibleWrite(node, ancestors, target.object)
        changed = true
        return
      }

      // `$$x = $$x` : refusé (cf. storeSelfWrite)
      storeSelfWrite(node)

      // Édits de BORDURE : le chunk RHS reste en place dans MagicString, donc
      // les transformations déjà appliquées à l'intérieur (post-ordre :
      // `$.y++`, assignations imbriquées) survivent — un overwrite global
      // recopiait le source ORIGINAL du RHS et les perdait.
      // `µ._mjs_deepSet` rend déjà la valeur écrite : sa forme directe vaut aussi là où la valeur est lue.
      if (!byGuard(node, ancestors, tp, (anc) => emitAssign(ms, js, node, anc, pathTarget(tp, '')))) return invisibleWrite(node, ancestors, target.object)
      changed = true
    },

    // tête d'une boucle qui écrit un champ de l'état local (`for ($.o.k of l)`, `for ($.o.k in o)`) : une variable de la boucle, écrite
    // dans le champ par l'aide au début de chaque tour — `for (const _mjs_fN of l) { µ._mjs_deepSet(_mjsThis, ["o", "k"], _mjs_fN); … }`
    ForOfStatement: loopHead,
    ForInStatement: loopHead,

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
      const tp    = getPath(target, true)
      const block = loneStatement(ancestors)
      if (!tp) {
        const root = findRoot(target.object)
        const wait = root ? suspension(target) : null
        const t    = root && wait !== 'yield' ? foundTarget(target, root, true, wait === 'await') : null
        if (t) {
          emitUpdate(ms, node, ancestors, t, !!block)
          if (block) setBlock(ms, block)
          changed = true
        }
        else invisibleWrite(node, ancestors, target.object, block)
        return
      }
      // l'état local aussi, avec ou sans l'enveloppe : cf. byHelpers
      if (!byHelpers(tp)) return

      // valeur non lue (instruction seule…) : forme DIRECTE, qui commence par `µ` — les formes fidèles
      // commencent par `(` et Civet n'écrit pas de point-virgule : posées après une autre ligne, elles
      // étaient lues comme l'appel de cette ligne (« … is not a function » au clic). Même règle que
      // l'état local (transform-reactive.ts).
      // l'opérateur de JavaScript sur `_mjs_n`, qui reçoit la valeur lue une seule fois : même conversion que le langage (un
      // `BigInt` reste un `BigInt`, `'5'` donne 6), comme l'état local (transform-reactive.ts). Instruction seule : le bloc qui
      // déclare `_mjs_n` se pose après la garde, autour d'elle. Cf. emitUpdate
      if (!byGuard(node, ancestors, tp, (anc) => emitUpdate(ms, node, anc, pathTargetRead(tp, target), !!block))) return invisibleWrite(node, ancestors, target.object, block)
      if (block) setBlock(ms, block)
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
      if (withoutProxy) invisibleCall(node, ancestors)
      firstGuard(node)
      if (callee?.type !== 'MemberExpression') return
      // clé calculée (`$o.m[push]()`) : la méthode est celle que nomme la valeur de la clé, pas le nom écrit entre les
      // crochets — l'appel reste tel quel
      if (callee.computed) return
      const methodName = callee.property?.name
      // accesseur défini sur un objet du magasin atteint sans chemin (cf. DEFINES_OBJECT) : son aide gardée
      const defines    = DEFINES_OBJECT.has(methodName)
      if (!methodName || !(ALL_MUTATIVE.has(methodName) || defines)) return
      // LIMITE CONNUE — la réécriture ne teste
      // QUE le NOM de méthode (`ALL_MUTATIVE`), jamais le TYPE : `$.form.set(k,v)`
      // / `$.o.add(y)` / `$.o.clear()` sur un OBJET MÉTIER à méthode homonyme (pas
      // un vrai Map/Set) partent aussi en `µ._mjs_deepCall`. Choix CONSERVATEUR assumé :
      // prouver la collection-ité exigerait l'info de type de l'analyzer (indispo
      // ici, coûteux) ; le runtime `µ._mjs_deepCall` + le filet Proxy `_mjs_wrapDeep`
      // absorbent le cas. Documenté plutôt que restreint (restreindre ferait perdre
      // la notification compilée sur de vrais Map/Set aliasés).

      const tp   = defines ? null : getPath(callee.object, true)
      // sans chemin : méthode appelée à travers un objet du magasin (`µ.store.t.find(f).tags.push(x)`, cf. findRoot)
      const root = tp ? null : findRoot(callee.object) ?? (defines ? null : keptRoot(callee.object))
      const p    = root ? foundParts(callee, keyHelper(root)) : null
      if (!tp && !p) {
        if (!defines) invisible(callee.object, node.start)
        return
      }
      // objet de l'état local (cf. keptRoot) : averti, son nom réservé écrit dans le code nommé par le refus (cf. guardedObject)
      if (p && root![0] === LOCALE) {
        invisible(callee.object, node.start)
        p.obj = guardedObject(root!, callee.object, p.obj)
      }

      // `?.` dans la chaîne (`$liste?.push(x)`, `$o?.items.push(x)`, `$liste.push?.(x)`) : un maillon
      // vide arrête TOUTE la chaîne, sans erreur — l'appel notifiant passe derrière le test du
      // maillon : `G == null ? void 0 : µ._mjs_deepCall(…)`. `G` = l'objet du maillon optionnel le
      // plus extérieur, écrit avec ses propres `?.`. Pour l'état local, `G` se lit par
      // `_mjsThis._state` (l'objet que le code appelle `$`) : une écriture réécrite n'est jamais une
      // lecture pour les dépendances d'un `µeffect` (effect-deps.ts), le test non plus.
      // la recherche passe aussi les appels d'un élément trouvé (`$$m?.get(k).tags.push(x)`), absents d'un chemin
      let link: any = null
      for (let m = callee; !link && m; m = m.type === 'MemberExpression' ? m.object : m.type === 'CallExpression' ? m.callee : null) {
        if (m.type === 'MemberExpression' && m.optional) link = m
      }
      const guard = node.optional ? callee : link?.object
      // la chaîne entière (`$$l?.push(1).toFixed()`) : l'appel, puis les maillons qui le prolongent
      let k = ancestors.length - 1
      while (k > 1 && ((ancestors[k - 1].type === 'MemberExpression' && ancestors[k - 1].object === ancestors[k]) ||
        (ancestors[k - 1].type === 'CallExpression' && ancestors[k - 1].callee === ancestors[k]))) k--
      const chain = guard && ancestors[k - 1]?.type === 'ChainExpression' ? ancestors[k - 1] : null
      if (guard && !chain) return
      let before = '', after = '', object = p?.obj
      let path: Path | null = null
      if (chain) {
        const text = js.slice(guard.start, guard.end)
        if (tp?.origin === 'local' && text[0] !== '$') return
        // clé qui agit dans la chaîne (`$l[$i++]?.push(x)`) : le test du maillon la rejouerait — l'appel reste tel qu'écrit, que voit
        // l'enveloppe ; sans elle (réglage `proxy: false`), celui de l'état local est compilé : chaque clé qui agit dans l'objet testé est
        // tenue par un paramètre (cf. pathTargetRead), évaluée une fois, dans l'ordre de JavaScript, lue par le test et par le chemin.
        // Celles d'après le maillon (`$o?.l[$j++].push(x)`) restent au chemin seul, jouées quand le maillon n'est pas vide. Un `?.` avant
        // une telle clé (`$o?.l[$j++]?.push(x)`), ou `yield` : tel qu'écrit, averti
        if (tp && acts(tp) && !(withoutProxy && tp.origin === 'local')) return invisible(callee.object, node.start)
        const ancestorChain = ancestors.slice(0, k)
        const read = !writeValueUnused(ancestorChain)
        // clés qui agissent dans l'objet testé, du maillon vers la racine : le membre qui les porte, leur rang dans le chemin
        const bound: { m: any, i: number, param: string }[] = []
        let beforeKey                                       = false
        let inside                                          = guard === callee
        for (let m = callee.object, i = tp ? tp.path.length - 1 : -1; i >= 0 && m?.type === 'MemberExpression'; m = m.object, i--) {
          inside ||= m === guard
          const s = tp!.path[i]
          if (inside && typeof s === 'object' && s.effect) bound.push({ m, i, param: '' })
          if (bound.length && m.optional) beforeKey = true
        }
        if (bound.length) {
          const wait = suspension(node)
          if (beforeKey || wait === 'yield') return invisible(callee.object, node.start)
          let test = text
          bound.forEach((x, n) => {
            x.param = `_mjs_k${bound.length - n}`
            test    = test.slice(0, x.m.property.start - guard.start) + x.param + test.slice(x.m.property.end - guard.start)
          })
          path = tp!.path.map((s, i) => bound.find((x) => x.i === i) ? { dyn: bound.find((x) => x.i === i)!.param } : s)
          const b = bindings(bound.slice().reverse().map((x, n) => ({ param: x.param, value: (tp!.path[x.i] as DynSegment).dyn, test: n === bound.length - 1 ? '_mjsThis._state' + test.slice(1) : '' })), 'void 0', wait === 'await')
          before = asiGuard(ancestorChain) + b.open
          after = b.close
        }
        else if (tp) {
          after  = read ? ')' : ''
          before = `${read ? asiGuard(ancestorChain) + '(' : ''}${tp.origin === 'local' ? '_mjsThis._state' + text.slice(1) : text} == null ? void 0 : `
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
            binds.push({ param, value: object!, test: [callee.optional ? param : '', node.optional ? `${param}.${methodName}` : ''].filter(Boolean).join(' == null || ') })
            object = param
          }
          const b = bindings(binds, 'void 0', wait === 'await')
          before = asiGuard(ancestorChain) + b.open
          after = b.close
        }
      }

      // `head` = tête d'appel déjà fermée par sa 1ʳᵉ virgule (`prefix(path, `
      // pour 'local' ; `prefix(rootKey, path, ` pour 'store' ; `prefix(rootKey, objet, ` pour un élément trouvé)
      const head = !tp
        ? `${onHead('Call', root!)}${object}, `
        : tp.origin === 'local'
          ? `µ._mjs_deepCall(_mjsThis, ${pathToJsLiteral(path ?? tp.path)}, `
          : `µ._mjs_storeDeepCall(${JSON.stringify(tp.path[0])}, ${pathToJsLiteral(tp.path.slice(1))}, `
      const tail = tp ? ')' : onTail(root!, ctorWritten(callee.object))

      // méthode d'une `Date` sur un chemin de l'état local : un nom que porte aussi un objet à soi (lecteur, calendrier) — compilée
      // seulement si l'objet est une Date, sinon l'appel tel qu'écrit, sa méthode recevant l'objet de JavaScript (avec l'enveloppe, ses
      // écritures d'après un `await` restent vues). Dans une chaîne `?.`, par une clé qui agit ou lue en tête d'instruction : telle quelle
      const dateOnly = tp?.origin === 'local' && MUTATIVE_METHODS.Date.has(methodName)
      if (dateOnly && (chain || acts(tp!) || (asiGuard(ancestors) && !writeValueUnused(ancestors)))) return invisible(callee.object, node.start)
      // méthode d'une liste, d'une Map ou d'un Set sur un chemin de l'état local, avec l'enveloppe : un nom que porte aussi un objet à
      // soi (panier, file d'attente) — compilée seulement pour ce que l'enveloppe ne range pas comme un objet ordinaire (liste, Map, Set,
      // liste typée…), sinon l'appel tel qu'écrit, sur l'enveloppe, qui voit les écritures de la méthode, celles d'après un `await`
      // comprises. Sans l'enveloppe (`proxy: false`), dans une chaîne `?.`, par une clé qui agit ou lue en tête d'instruction : compilée
      // pour tout objet, comme avant (elle prévient après la méthode)
      const objectOnly = !withoutProxy && !dateOnly && tp?.origin === 'local' && !(chain || acts(tp!) || (asiGuard(ancestors) && !writeValueUnused(ancestors)))
      const args = node.arguments ?? []
      const call = () => {
        const verbatim = dateOnly || objectOnly ? ms.slice(node.start, node.end) : ''
        if (args.length === 0) {
          ms.overwrite(node.start, node.end, `${before}${head}'${methodName}', []${tail}`)
        } else {
          // Bordures uniquement (cf. AssignmentExpression) : les arguments
          // restent en place, leurs édits imbriqués survivent — leurs parenthèses aussi
          // (`$liste.push((a, b))` pousse UN élément) : la réécriture s'arrête à la parenthèse
          // ouvrante de l'appel et reprend à sa fermante, la dernière du nœud.
          ms.overwrite(node.start, js.indexOf('(', callee.end) + 1, `${before}${head}'${methodName}', [`)
          ms.overwrite(node.end - 1, node.end, ']' + tail)
        }
        // l'objet relu par `_mjsThis._state`, l'objet que le code appelle `$` : ni le test ni l'appel ne sont une lecture pour les
        // dépendances d'un `µeffect` (effect-deps.ts), pas plus que l'appel compilé
        const read = (text: string) => text[0] === '$' ? '_mjsThis._state' + text.slice(1) : text
        if (dateOnly) {
          // test posé à DROITE de `node.start` : argument d'un autre appel (`$d.setTime($e.setDate(1))`), à gauche il tombait avec la
          // bordure que l'appel extérieur réécrit (cf. objectOnly)
          ms.prependRight(node.start, `${tp!.guard ? '' : asiGuard(ancestors)}(${read(js.slice(callee.object.start, callee.object.end))} instanceof Date ? `)
          ms.appendLeft(node.end, ` : ${read(verbatim)})`)
        }
        else if (objectOnly) {
          // l'objet relu par `_mjsThis._state`, l'objet que le code appelle `$` : ni le test ni l'appel ne sont une lecture pour les
          // dépendances d'un `µeffect` (effect-deps.ts), pas plus que l'appel compilé. Le test posé à DROITE de `node.start`, sur l'appel
          // lui-même : argument d'un autre appel (`$l.push($l.shift())`), à gauche il tombait avec la bordure que l'appel extérieur réécrit
          ms.prependRight(node.start, `${tp!.guard ? '' : asiGuard(ancestors)}(Object.prototype.toString.call(${read(js.slice(callee.object.start, callee.object.end))}) !== '[object Object]' ? `)
          ms.appendLeft(node.end, ` : ${read(verbatim)})`)
        }
      }
      // élément de liste (cf. byGuard) : jamais dans une chaîne `?.`, dont le texte ne part pas de `$`
      if (!tp || !byGuard(node, ancestors, tp, call)) {
        if (tp) return invisibleWrite(node, ancestors, callee.object)
        call()
      }
      if (after) ms.appendLeft(chain.end, after)
      changed = true
    },

    // Suppression de clé sur état/alias : `delete $.obj.clé` (ou `delete alias.x`)
    // → `µ._mjs_deepDelete(_mjsThis, [...path])`. Sans ça, `delete` mutait bien la
    // cible mais ne NOTIFIAIT jamais → aucun re-render (le trap `deleteProperty`
    // du Proxy `µ.state` ne couvre que les STORES, pas les `$.` d'un composant).
    // On émet dès la profondeur 1 : le top-level `delete $.x` n'est PAS vu par
    // transformReactiveWrites (qui ne traite que les AssignmentExpression), donc
    // c'est bien ici qu'on le câble ; `delete $[expr]` aussi (clé évaluée à l'exécution).
    // Plus bas, une clé calculée non littérale (`delete $.o[expr]`) a un path, comme une clé
    // écrite (getPath suit `$.x[i]`).
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
          let link: any = null
          for (let e = m; !link && e.type === 'MemberExpression'; e = e.object) if (e.optional) link = e
          if (link) out = `${ms.slice(link.object.start, link.object.end)} == null ? true : ${storeDelete(tp.path)}`
        }
        const root = tp ? (tp.origin === 'local' ? keptRoot(m.object) : null) : findRoot(m.object) ?? keptRoot(m.object)
        const p    = root ? foundParts(m, keyHelper(root)) : null
        const wait = p ? suspension(m) : null
        // objet de l'état local, réglage `proxy: false` (cf. keptRoot) : averti, son nom réservé écrit dans le code nommé (cf. guardedObject)
        if (p && root![0] === LOCALE) {
          invisible(m.object, node.start)
          p.obj = guardedObject(root!, m.object, p.obj)
        }
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
          out = `${open}${onHead('Delete', root!)}${obj}, ${p.key}${onTail(root!, ctorWritten(m.object))}${close}`
        }
        if (out) {
          ms.overwrite(node.start, node.end, `${asiGuard(ancestors)}(${out})`)
          changed = true
        }
        return
      }
      if (!target || target.type !== 'MemberExpression') return
      const tp = getPath(target, true)
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
        const p    = root ? foundParts(target, keyHelper(root)) : null
        if (p) {
          ms.overwrite(node.start, node.end, `${onHead('Delete', root!)}${p.obj}, ${p.key}${onTail(root!, ctorWritten(target.object))}`)
          changed = true
        }
        else invisibleWrite(node, ancestors, target.object)
        return
      }
      if (tp.path.length < 1) return
      if (!byGuard(node, ancestors, tp, () => ms.overwrite(node.start, node.end, tp.origin === 'local' ? `µ._mjs_deepDelete(_mjsThis, ${pathToJsLiteral(tp.path)})` : storeDelete(tp.path)))) return invisibleWrite(node, ancestors, target.object)
      changed = true
    },
  })

  // cf. ForOfStatement : un champ de l'état local (profondeur 2 et plus), ni élément de liste ni clé qui agit ; un champ d'un objet du
  // magasin ou de l'état local que la passe ne compile pas (`for ($.l.find(f)[k].x of l)`, cf. foundTarget), par l'aide gardée
  function loopHead(node: any): void {
    const m    = node.left.type === 'MemberExpression' ? node.left : null
    const tp   = m ? getPath(m) : null
    const root = m && !tp ? findRoot(m.object) ?? keptRoot(m.object) : null
    const t    = root && !suspension(m) ? foundTarget(m, root, false) : null
    if (!t && (!tp || tp.origin !== 'local' || tp.path.length < 2 || acts(tp))) return
    if (t && root![0] === LOCALE) invisible(m.object, m.start)
    const v       = `_mjs_f${++heads}`
    const written = `${t ? t.set : pathTarget(tp!, '').set}${v}${t?.tail ?? ')'};`
    ms.overwrite(node.left.start, node.left.end, `const ${v}`)
    if (node.body.type === 'BlockStatement') ms.appendLeft(node.body.start + 1, ` ${written}`)
    else {
      ms.prependRight(node.body.start, `{ ${written} `)
      ms.appendLeft(node.body.end, ' }')
    }
    changed = true
  }

  // lecture d'une clé faite d'une expression à la racine de l'état (`x = $[k]`, `x = $?.[k]`, `Object.assign($[k], o)`, `f($[k])`) : par
  // `µ._mjs_deepKey` (mjs_deep.ts), qui refuse `__proto__`, `constructor` et `prototype` — ni `Object.prototype` ni la fonction `Object`
  // ne sont rendus au code de l'appli, comme pour l'écriture (cf. getPath). Après le parcours, là seulement où le texte de la lecture
  // est resté tel qu'écrit : une écriture ou un appel compilés prennent sa clé dans leur chemin, que leur aide refuse. Ni la cible
  // d'une écriture (`$[k] = v`, `$[k]++`, `delete $[k]`, un motif, `for ($[k] of l)`), ni la fonction appelée (`$[k]()`, son `this`).
  // Le magasin n'en a pas besoin : `µ.store` refuse lui-même ces trois noms, par tout chemin (mjs_store_globals.ts)
  if (!storeOnly && STATE_ROOT.test(js)) {
    // relecture que pose l'écriture compilée d'une clé de la racine (transform-reactive.ts : `µ._set(_mjsThis, k, $[k] + (1))`,
    // `_mjs_n = $[k]`, `((_mjs_n) => ++_mjs_n)($[k])`, `((_v) => …)($[k] + (1))`) : sa valeur va à `µ._set`, qui refuse ces trois noms
    const arrow = (c: any, name: string) => c?.type === 'CallExpression' && c.callee.type === 'ArrowFunctionExpression' && c.callee.params[0]?.type === 'Identifier' && c.callee.params[0].name === name
    const rereads = (e: any, anc: any[]): boolean => {
      const p = anc[anc.length - 2]
      const g = anc[anc.length - 3]
      if ((p.type === 'AssignmentPattern' || p.type === 'AssignmentExpression') && p.right === e && p.left.type === 'Identifier' && p.left.name === '_mjs_n') return true
      if (arrow(p, '_mjs_n') && p.arguments.includes(e)) return true
      if ((p.type === 'BinaryExpression' || p.type === 'LogicalExpression') && p.left === e && arrow(g, '_v') && g.arguments.includes(p)) return true
      return anc.some((a, i) => a.type === 'CallExpression' && a.callee.type === 'MemberExpression' && a.callee.object.type === 'Identifier' && a.callee.object.name === 'µ' && a.callee.property.name === '_set' && a.arguments.includes(anc[i + 1]))
    }
    walk.ancestor(ast, {
      MemberExpression(e: any, _st: any, anc: any[]) {
        const k = e.property
        if (!e.computed || e.object.type !== 'Identifier' || e.object.name !== '$' || k.type === 'Literal' || (k.type === 'TemplateLiteral' && !k.expressions.length)) return
        const p = anc[anc.length - 2]
        const g = anc[anc.length - 3]
        if ((p.type === 'AssignmentExpression' && p.left === e) || p.type === 'UpdateExpression' || (p.type === 'UnaryExpression' && p.operator === 'delete')) return
        if (p.type === 'ArrayPattern' || p.type === 'RestElement' || (p.type === 'AssignmentPattern' && p.left === e) || (p.type === 'Property' && g?.type === 'ObjectPattern')) return
        if (((p.type === 'ForOfStatement' || p.type === 'ForInStatement') && p.left === e) || ((p.type === 'CallExpression' || p.type === 'NewExpression') && p.callee === e) || (p.type === 'TaggedTemplateExpression' && p.tag === e)) return
        if (rereads(e, anc) || piece(e.start, k.start) !== js.slice(e.start, k.start) || piece(k.end, e.end) !== js.slice(k.end, e.end)) return
        const seq = k.type === 'SequenceExpression'
        ms.overwrite(e.start, k.start, `µ._mjs_deepKey($, ${seq ? '(' : ''}`, { contentOnly: true })
        ms.overwrite(k.end, e.end, seq ? '))' : ')', { contentOnly: true })
        changed = true
      },
    })
  }

  const r = passResult(ms, js, changed, 'path-tracker')
  return notice.length ? { ...r, notice } : r
}

// `$$x = $$x` (`µ.store.x = µ.store.x`, `$$x = ($$x)`) : la clé écrite avec sa propre valeur, exactement — refusée (sigils.ts,
// selfWriteError) ; le lecteur la refuse d'abord à sa place (lexer/index.ts), cette passe refuse une forme qui lui arrive sans lui
function storeSelfWrite(node: any): void {
  const key = staticStoreKey(node.left)
  if (key !== null && node.operator === '=' && staticStoreKey(node.right) === key) throw Object.assign(selfWriteError(SELF_WRITE_STORE, key), { mjsAt: node.start })
}

// le `<script module>` d'un composant : `$$x = $$x` y est refusé comme dans le script, un gestionnaire ou le fichier d'un magasin
// (cf. storeSelfWrite) ; les autres écritures du magasin y gardent leur forme
export function refuseStoreSelfWrites(js: string): void {
  if (!js.includes('µ.store.')) return
  let ast: acorn.Node
  try {
    ast = parseModule(js)
  } catch {
    return
  }
  walk.simple(ast, { AssignmentExpression: storeSelfWrite })
}

// `µ.store.x` lu tel quel, sans clé calculée : sa clé, sinon null (cf. storeSelfWrite)
function staticStoreKey(node: any): string | null {
  return node?.type === 'MemberExpression' && !node.computed && isStoreRoot(node.object) && node.property.type === 'Identifier' ? node.property.name : null
}
