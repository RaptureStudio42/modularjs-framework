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
import { asiGuard, closeRhs, emitAssign, emitPattern, emitUpdate, instructionSeule, poserBloc, rhsStart, writeValueUnused, type WriteTarget } from './emit-write.js'
import { selfWriteError, SELF_WRITE_STORE } from '../sigils.js'

/** Segment dynamique (`$.x[k]` → valeur runtime de `k`). Marqueur OBJET :
 *  l'ancien préfixe string `__dyn:` était forgeable par une clé littérale
 *  `$.x["__dyn:alert(1)"]` → code émis brut dans le path. */
// `effet` : clé faite d'une expression qui agit (appel, `++`, affectation, `await`…) — relue par une écriture qui lit sa cible
// (`+=`, `++`), elle passe par un paramètre (cf. pathTarget), évaluée une fois
type DynSegment = { dyn: string, effet?: true }
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
  guard?: Garde
}

// garde d'un élément de liste (cf. AliasEntry.guard) : `racine` la variable de la liste, `params` les paramètres à poser aux rappels
// (le sien, ceux des rappels qui l'entourent) la première fois qu'une écriture s'en sert
interface Garde { test: string, racine: string, params: (() => void)[] }

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
const SANS_ECRITURE = new Set(['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'reduce', 'reduceRight', 'includes', 'indexOf', 'lastIndexOf', 'join', 'slice', 'concat', 'at', 'flat', 'keys', 'values', 'entries', 'get', 'has', 'toString', 'toLocaleString', 'valueOf', 'then', 'catch', 'finally', 'focus', 'blur', 'click', 'scrollIntoView', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'postMessage', 'play', 'pause', 'abort', 'close', 'send'])

// fonctions qui ne modifient pas ce qu'elles reçoivent (cf. avis) : leur appel ne fait jamais avertir
const SANS_ECRITURE_FN = /^(?:console\.\w+|JSON\.\w+|Object\.(?:keys|values|entries|freeze|isFrozen|getPrototypeOf|getOwnPropertyNames)|Array\.(?:isArray|from)|String|Number|Boolean|structuredClone|alert|µ[\w$.]*|_mjs[\w$.]*)$/

// méthodes qui définissent un accesseur sur l'objet qui les appelle (`o.__defineGetter__(k, f)`) : appelées par un objet du magasin atteint
// sans chemin, elles passent son aide gardée, qui refuse un prototype ou une fonction du navigateur (cf. CallExpression)
const DEFINIT_L_OBJET = new Set(['__defineGetter__', '__defineSetter__'])

// fonctions qui modifient leur premier argument (cf. avis)
const ECRIT_LE_PREMIER = /^(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.(?:set|deleteProperty|defineProperty|setPrototypeOf))$/

// fonctions qui figent leur premier argument : aucune valeur ne change (aucun avertissement), mais l'objet reçu passe la même garde
// (cf. premierGarde) — `Object.freeze($l.find(f)[k])` ne fige ni `Object` ni `Object.prototype`
const FIGE_LE_PREMIER = /^(?:Object\.(?:freeze|seal|preventExtensions)|Reflect\.preventExtensions)$/

/** avertissement du réglage `proxy: false` : une écriture de l'état que le compilateur ne voit pas (`forme` : 1 par un alias,
 *  2 par une fonction qui modifie son premier argument, 3 par une méthode inconnue, 4 l'objet passé à une fonction, 5 les éléments
 *  passés à un rappel venu d'ailleurs) ; `at` : position dans le code reçu par la passe, `racine` : la variable à rafraîchir */
export interface AvisInvisible { at: number, forme: number, nom: string, racine: string }

// méthodes qui rendent un ÉLÉMENT de la collection (liste, Map) : l'objet rendu est celui que le magasin range, une
// écriture à travers lui est une écriture du magasin (cf. findRoot)
const FIND_METHODS = new Set(['find', 'findLast', 'at', 'get'])

// méthodes qui rendent l'élément qu'elles RETIRENT : celui d'une copie reste un objet du magasin (cf. findRoot) ; `splice`
// rend ceux qu'il retire dans une liste (cf. copyRoot)
const POP_METHODS = new Set(['pop', 'shift'])

// méthodes qui modifient la collection et dont la valeur sort BRUTE de l'état local, la méthode compilée (`µ._mjs_deepCall`) l'appelant
// sur l'objet brut, avec l'enveloppe comme avec le réglage `proxy: false` : élément retiré (`pop`, `shift`), liste des éléments retirés
// (`splice`), la collection elle-même (RENDU_MEME) — une écriture qui part d'elle passe par l'aide gardée (cf. renduBrut, racineGardee)
const RENDU_BRUT = new Set(['pop', 'shift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add'])

// celles qui rendent la collection même : avec l'enveloppe, en tête de la chaîne d'une écriture (`$.l.sort(f)[0].x = v`), relue par
// l'enveloppe (`µ._mjs_deepMeme`, mjs_deep.ts), l'écran suit l'écriture (cf. boundChain)
const RENDU_MEME = new Set(['sort', 'reverse', 'fill', 'copyWithin', 'set', 'add'])

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
 * Transforme le code JS pour utiliser le path-tracking et insérer des wraps
 * Proxy automatiquement aux points d'escape détectés.
 *
 * Doit être appelé APRÈS transformReactiveWrites (qui gère les `$.x = y`
 * top-level) pour ne traiter que les mutations profondes.
 */
export function applyPathTracking(js: string, opts: { sansProxy?: boolean } = {}): string {
  return applyPathTrackingMapped(js, opts).code
}

/** réglage `proxy: false` : variables de l'état local que le compilateur SAIT simples — chacune de leurs écritures (`µ._set(_mjsThis,
 *  'x', v)` ou `µwrite $x, v`, dans le script et dans les gestionnaires, cf. `codes`) pose une valeur simple (cf. valeurSimple). Une écriture par une
 *  clé calculée (`$[k] = v`) ou un code illisible : aucune. Rien ne modifie une valeur simple en place — elle n'avertit pas */
export function etatSimple(codes: string[]): Set<string> {
  const ecrites = new Map<string, any[]>()
  let doute     = false
  for (const code of codes) {
    if (!code || !/µ\._set\(|µ\._mjs_rawWrite\(/.test(code)) continue
    let ast: any
    try {
      ast = parseModule(code)
    }
    catch {
      doute = true
      continue
    }
    walk.simple(ast, {
      CallExpression(n: any) {
        const c = n.callee
        if (c.type !== 'MemberExpression' || c.computed || c.object.type !== 'Identifier' || c.object.name !== 'µ' || c.property.name !== '_set') return
        const k = n.arguments[1]
        if (k?.type !== 'Literal' || typeof k.value !== 'string') doute = true
        else ecrites.set(k.value, [...ecrites.get(k.value) ?? [], n.arguments[2]])
      },
      // `µwrite $x, v` : la case brute, sans `µ._set` (cf. sigils.ts) — une écriture du composant comme une autre
      AssignmentExpression(n: any) {
        const l = n.left
        const c = l.type === 'MemberExpression' && l.object.type === 'CallExpression' ? l.object.callee : null
        if (c?.type !== 'MemberExpression' || c.object.type !== 'Identifier' || c.object.name !== 'µ' || c.property.name !== '_mjs_rawWrite') return
        if (l.computed || l.property.type !== 'Identifier') doute = true
        else ecrites.set(l.property.name, [...ecrites.get(l.property.name) ?? [], n.right])
      },
    })
  }
  const simples = new Set<string>(doute ? [] : ecrites.keys())
  // une variable qui reçoit une valeur non simple sort, et avec elle celles qui recopiaient sa valeur
  for (let sortie = true; sortie;) {
    sortie = false
    for (const [k, vals] of ecrites) {
      if (simples.has(k) && !vals.every((v) => valeurSimple(v, simples))) {
        simples.delete(k)
        sortie = true
      }
    }
  }
  return simples
}

// valeur toujours simple (chaîne, nombre, booléen, BigInt, null, undefined) : littéral, gabarit, opération (`a * 2`, `!a`, `typeof a`),
// `++` (forme compilée comprise), `String(x)`, `Number(x)`, variable de l'état encore simple ; dans le doute, non
function valeurSimple(v: any, simples: Set<string>): boolean {
  if (!v) return true
  switch (v.type) {
    case 'Literal': return !v.regex
    case 'TemplateLiteral':
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'UpdateExpression': return true
    case 'LogicalExpression': return valeurSimple(v.left, simples) && valeurSimple(v.right, simples)
    case 'ConditionalExpression': return valeurSimple(v.consequent, simples) && valeurSimple(v.alternate, simples)
    case 'SequenceExpression': return valeurSimple(v.expressions[v.expressions.length - 1], simples)
    case 'Identifier': return v.name === 'undefined' || v.name === 'NaN' || v.name === 'Infinity' || v.name === '_mjs_n'
    case 'MemberExpression': return v.object.type === 'Identifier' && v.object.name === '$' && !v.computed && simples.has(v.property.name)
    case 'CallExpression': return (v.callee.type === 'ArrowFunctionExpression' && v.callee.body.type === 'UpdateExpression') || (v.callee.type === 'Identifier' && /^(?:String|Number|Boolean|parseInt|parseFloat)$/.test(v.callee.name))
    default: return false
  }
}

// clé d'un nom qui lit plusieurs clés du magasin (cf. noteStore) : jamais celle d'une lecture, qui est un identifiant
const NO_KEY = '?'

// « clé » d'une variable qui ne tient aucun objet du magasin mais porte le nom d'une variable déclarée ou affectée (`=`)
// d'une lecture du magasin (cf. storeKey) : son écriture passe par l'aide DOUCE (`µ._mjs_softSetOn`…), qui écrit comme
// JavaScript et refuse seulement un prototype du langage ou l'une de ses fonctions — aucune clé prévenue
const SOFT = '~'

// « clé » d'un objet de l'état LOCAL que la passe ne compile pas, avec le réglage `proxy: false` (cf. racineGardee) : la variable précédée
// de `#`, qu'aucune clé du magasin ne porte (une clé est un identifiant) — son écriture passe par l'aide gardée du composant
// (`µ._mjs_deepSetOn`…, mjs_deep.ts), qui écrit comme JavaScript, ne prévient personne et refuse un prototype ou une fonction du navigateur ;
// avec l'enveloppe aussi, pour ce qu'elle ne garde pas (prototype lu par `Object.getPrototypeOf`, élément du rappel de `sort`)
const LOCALE = '#'

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
// `storeOnly` : module autonome (`.civet`/`.coffee` importé), sans état de composant — seules les racines
// `µ.store.x` sont suivies, un `$.x` y est un identifiant ordinaire (jQuery, par exemple) laissé tel quel.
// `sansProxy` : réglage `proxy: false` (mjs.config.json), objets de l'état rangés sans enveloppe — la passe relève alors les écritures
// de l'état qu'elle ne voit pas (alias, fonction qui modifie son argument, méthode inconnue, cf. AvisInvisible), rendues dans `avis`
// pour l'avertissement de construction. Le code produit est le même avec ou sans lui
export function applyPathTrackingMapped(js: string, opts: { storeOnly?: boolean, sansProxy?: boolean } = {}): PassResult & { avis?: AvisInvisible[] } {
  const storeOnly = !!opts.storeOnly
  const sansProxy = !!opts.sansProxy
  const avis: AvisInvisible[] = []
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

  // tête de l'aide qui écrit un objet atteint (`Set`, `Call`, `Delete`) : gardée, la clé prévenue, ou douce (cf. SOFT) ; objet de l'état
  // local que la passe ne compile pas (cf. LOCALE) : l'aide gardée du composant
  const onHead = (aide: string, root: string) => root[0] === LOCALE ? `µ._mjs_deep${aide}On(${JSON.stringify(root.slice(1))}, ` : root === SOFT ? `µ._mjs_soft${aide}On(` : `µ._mjs_store${aide}On(${keyArg(root)}, `

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
        const k   = node.property
        const nom = !node.computed ? k.name : k.type === 'Literal' ? k.value : k.type === 'TemplateLiteral' && k.expressions.length === 0 ? k.quasis[0].value.cooked : undefined
        if (nom === 'constructor') return true
        if (nom === undefined) return false
        node = node.object
      }
    }
    return false
  }

  // aide qui lit une clé calculée de la chaîne d'une écriture gardée (cf. boundChain) : `µ._mjs_storeCle` pour un objet du magasin
  // (mjs_store_globals.ts ; sa clé, ou `#$` devant elle, cf. premierGarde), `µ._mjs_deepCle` pour un objet de l'état local (cf. LOCALE),
  // aucune pour l'aide douce (cf. SOFT)
  const aideCle = (root: string) => root.startsWith(LOCALE + '$') ? 'µ._mjs_storeCle' : root[0] === LOCALE ? 'µ._mjs_deepCle' : root === SOFT ? null : 'µ._mjs_storeCle'

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
        return null
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
        const suite = { origin: headPath.origin, guard: headPath.guard }
        if (tail) return { path: [...headPath.path, tail], ...suite }
        if (tailComputed !== null) return { path: [...headPath.path, tailComputed], ...suite }
        // clé faite d'une expression (`$.l[$.i]`, `$.l[i + 1]`, `$.l[$.l.length]`) : l'état local seulement, le magasin garde son
        // écriture par l'objet (cf. findRoot)
        if (headPath.origin === 'local' && expr.property.type !== 'PrivateIdentifier') return { path: [...headPath.path, exprSegment(expr.property)], ...suite }
      }
    }
    return null
  }

  // segment d'une clé faite d'une expression : son texte DÉJÀ RÉÉCRIT (une écriture réécrite dedans survit), entre parenthèses pour
  // une expression à virgule, qu'une liste de clés couperait sinon ; `effet` quand elle agit (cf. DynSegment)
  function exprSegment(k: any): DynSegment {
    const texte = k.type === 'SequenceExpression' ? `(${ms.slice(k.start, k.end)})` : ms.slice(k.start, k.end)
    let effet = false
    walk.full(k, (n: any) => {
      if (/^(?:Call|New|Update|Assignment|Await|Yield|TaggedTemplate|Import|Function|ArrowFunction|Class)Expression$/.test(n.type) || (n.type === 'UnaryExpression' && n.operator === 'delete')) effet = true
    })
    return effet ? { dyn: texte, effet: true } : { dyn: texte }
  }

  // le chemin a une clé qui agit (cf. DynSegment.effet)
  const agit = (tp: AliasEntry) => tp.path.some((p) => typeof p === 'object' && p.effet)

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
      const copie = o.name === 'Object' ? name === 'values' || name === 'entries' : name === 'from'
      return copie && args.length === 1 && args[0].type !== 'SpreadElement' ? itemsRoot(args[0]) : null
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
  function morceau(a: number, b: number): string | null {
    try {
      return ms.slice(a, b)
    }
    catch {
      return null
    }
  }

  // appel de la chaîne déjà réécrit d'un bloc par la passe (`$.l.pop()`, `$.l.splice(i, 1)`, cf. morceau) : ses maillons et ses clés
  // sont ceux du chemin compilé, la chaîne de l'écriture repart de lui
  const reecrit = (x: any) => x.type === 'CallExpression' && morceau(x.callee.end, x.end) === null

  // objet `o` d'une écriture par un objet du magasin ou de l'état (élément trouvé, variable suivie, racine) : chaque maillon `?.` de
  // sa chaîne est testé une fois, son objet lié à un paramètre local (aucune case partagée). `lire` : l'aide des clés (cf. aideCle) —
  // une clé calculée de la chaîne, ni littérale ni écrite en clair, est lue par `µ._mjs_deepCle` (objet de l'état local, mjs_deep.ts) ou
  // `µ._mjs_storeCle` (objet du magasin, mjs_store_globals.ts), qui refusent une clé réservée que l'objet lu n'a pas en
  // propre — la chaîne est jugée comme par l'enveloppe et le chemin compilé, pas seulement l'objet atteint (`$l.find(f)[k].isAdmin = v`,
  // `k` = `'constructor'`, mène à une classe de l'appli), `?.[k]` compris. Rend les liaisons, le texte de l'objet, `cles` (une clé
  // ainsi lue) et `meme` (la tête relue par l'enveloppe, cf. RENDU_MEME) ; un appel déjà réécrit (cf. reecrit) devient la tête, lu entier
  // (`$.l.pop().fait = true`) ; null quand le texte ne se lit pas
  function boundChain(o: any, lire: string | null = null): { binds: Binding[], object: string, cles: boolean, meme: boolean } | null {
    let { head, segs } = chainOf(o)
    const binds: Binding[] = []
    let i = segs.length - 1
    while (i >= 0 && !reecrit(segs[i])) i--
    if (i >= 0) [head, segs] = [segs[i], segs.slice(i + 1)]
    // tête faite d'une expression (`($$o[k] || {})[k2]`, cf. findRoot) : ses parenthèses, qu'acorn laisse hors du nœud
    const tete = morceau(head.start, head.end)
    if (tete === null) return null
    let object = head.type === 'Identifier' || head.type === 'ThisExpression' ? tete : `(${tete})`
    let cles   = false
    // avec l'enveloppe, la collection que rend `sort` & co. en tête de l'écriture (cf. RENDU_MEME) : relue par l'enveloppe, l'écran suit
    const meme = !sansProxy && head.type === 'CallExpression' && RENDU_MEME.has(head.callee.property?.name) ? renduBrut(head) : null
    if (meme) object = `µ._mjs_deepMeme(_mjsThis, ${tete}, ${JSON.stringify(meme)})`
    for (const s of segs) {
      if (s.type === 'MemberExpression' && s.optional) {
        const param = `_mjs_o${binds.length + 1}`
        binds.push({ param, value: object, test: param })
        object = param
      }
      if (lire && s.type === 'MemberExpression' && s.computed && s.property.type !== 'Literal' && !(s.property.type === 'TemplateLiteral' && s.property.expressions.length === 0)) {
        object = `${lire}(${object}, ${keyText(s)})`
        cles   = true
        continue
      }
      const texte = morceau(s.type === 'CallExpression' ? s.callee.end : js.lastIndexOf(s.optional ? '?.' : s.computed ? '[' : '.', s.property.start), s.end)
      if (texte === null) return null
      object += texte
    }
    return { binds, object, cles, meme: meme !== null }
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
  // `cles` : l'aide qui lit les clés calculées de la chaîne (cf. aideCle, boundChain)
  function foundParts(m: any, cles: string | null = null): { binds: Binding[], obj: string, key: string, acc: string, sep: number } | null {
    const k = m.property
    if (k.type === 'PrivateIdentifier') return null
    const key = keyText(m)
    const sep = js.lastIndexOf(m.optional ? '?.' : m.computed ? '[' : '.', k.start)
    const chaine = boundChain(m.object, cles)
    // aucun maillon ni clé lue (cf. boundChain) : l'objet tel quel, ses parenthèses comprises ; texte qui ne se lit pas : l'écriture reste
    // telle qu'écrite
    const obj = chaine?.binds.length || chaine?.cles || chaine?.meme ? chaine.object : morceau(m.start, sep)
    if (!chaine || obj === null) return null
    return { binds: chaine.binds, obj, key, acc: m.computed ? `[${key}]` : `.${k.name}`, sep }
  }

  // cible d'écriture d'un objet du magasin (cf. emit-write.ts) : `µ._mjs_storeSetOn` rend la valeur écrite, sa forme
  // directe vaut partout. Relue (`+=`, `++`), la cible lit l'objet, et une clé calculée autre qu'un nom ou un littéral,
  // par les paramètres d'une fonction fléchée (`bind`) : l'objet n'est évalué qu'une fois — le prédicat n'est pas
  // rappelé —, aucune case partagée, et la valeur de droite y garde son ordre (lue après l'objet). Une variable et une
  // clé simple se relisent telles quelles. `?.` n'est jamais dans une cible d'affectation : Civet et CoffeeScript
  // l'écrivent par une variable de travail
  function foundTarget(m: any, root: string, read: boolean, wait = false): WriteTarget | null {
    const p = foundParts(m, aideCle(root))
    if (!p || p.binds.length) return null
    if (root[0] === LOCALE) p.obj = objetGarde(root, m.object, p.obj)
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
  // ET des deux origines) et on RETIENT le magasin et l'état local profond ($.o.k, profondeur ≥ 2, cf. parLesAides) — les
  // cibles `$.x` (profondeur 1, déjà réécrites par transformReactiveWrites qui tourne AVANT) sont laissées telles quelles.
  // Une feuille sans chemin qui passe par un objet du magasin (`[da[k1][k2]] = v` par une variable suivie, `[$$o.a[k +
  // ''][k2]] = v`, cf. findRoot) reçoit l'écriture de cet objet (`µ._mjs_storeSetOn`, cf. foundTarget) : la clé racine
  // prévenue
  function collectStoreTargets(pattern: any, out: { node: any, set: string, tail?: string }[]): void {
    forEachPatternLeaf(pattern, (leaf: any) => {
      if (leaf.type !== 'MemberExpression') return
      const tp = getPath(leaf)
      if (tp) {
        if (parLesAides(tp)) out.push({ node: leaf, set: pathTarget(tp, '').set })
        return
      }
      // objet de l'état local que la passe ne compile pas (réglage `proxy: false`, cf. racineGardee) : l'aide gardée, averti
      const root = findRoot(leaf.object) ?? racineGardee(leaf.object)
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
  function parLesAides(tp: AliasEntry): boolean {
    return tp.origin === 'store' || tp.path.length > 1
  }

  // cible RELUE (`+=`, `++`, affectation logique) : celle de pathTarget, relue par le texte de la cible ; une clé de l'état local qui
  // agit (cf. DynSegment.effet) passe par un paramètre d'une fonction fléchée appelée sur place (`bind`, cf. emit-write.ts), évaluée
  // une fois et dans l'ordre de JavaScript (clés, relecture, valeur de droite) — le chemin et la relecture lisent le paramètre.
  // `wait` : la valeur de droite attend (`await`)
  function pathTargetRead(tp: AliasEntry, target: any, wait = false): WriteTarget {
    if (tp.origin !== 'local' || !agit(tp)) return pathTarget(tp, js.slice(target.start, target.end))
    const params: string[] = []
    const values: string[] = []
    const path: Path = tp.path.map((p) => {
      if (typeof p !== 'object' || !p.effet) return p
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
        if (i !== undefined && liste && liste.type !== 'SpreadElement' && f && isFunction(f)) {
          notePattern(f.params[i], liste, true, false)
          // `reduce` et `reduceRight` sans valeur de départ : l'accumulateur part du premier élément
          if (i === 1 && n.arguments.length === (nom === 'call' ? 2 : 1)) notePattern(f.params[0], liste, true, false)
        }
        // rappel de comparaison (`$$l.sort((a, b) => …)`, `toSorted`) : ses deux paramètres sont des éléments
        else if (nom !== null && !c.computed && SORT_METHODS.has(nom) && f && isFunction(f)) for (const p of f.params.slice(0, 2)) notePattern(p, liste, true, false)
      },
    })
  }

  // ── Éléments de liste de l'état (cf. elemAlias) ─────────────────────────────────────────────────────────────────────────
  // seule valeur d'une variable : déclarée avec elle, ou déclarée sans valeur puis affectée une fois (`=`), jamais liée autrement
  // (paramètre, `++`, motif, variable d'une boucle) — sinon null
  const seuleValeur = (id: any): any => {
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
  const jamaisRelie = (id: any): boolean => (occs.get(id.name) ?? []).every((o) => o.role === 'ref' || o.id === id || bindingOf(o.id) !== bindingOf(id))
  // liste dont le chemin est connu : chemin de l'état local (`$.l`, `$.o.items`) ou partie d'un élément déjà suivi (`row.cells`),
  // sans clé qui agit
  const cheminDeListe = (e: any): AliasEntry | null => {
    const tp = getPath(e, true)
    return tp && tp.origin === 'local' && !agit(tp) ? tp : null
  }
  // garde lue AU MOMENT de l'écriture, par le chemin même que suivra l'aide (chaque maillon après `$` par `?.`) : il mène encore à
  // cet objet — sinon (liste remplacée, réordonnée ou vidée, `await` passé entre-temps, collection à soi dont le rappel ne reçoit pas
  // l'indice) l'écriture telle qu'écrite, celle de JavaScript. Comparés bruts : une enveloppe et l'objet qu'elle tient sont le même
  const lectureSure = (path: Path) => '$' + path.map((p, k) => {
    const cle = typeof p === 'object' ? `[${p.dyn}]` : typeof p === 'number' ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? p : `[${JSON.stringify(p)}]`
    return (k ? '?.' : cle[0] === '[' ? '' : '.') + cle
  }).join('')
  const ajouteElement = (id: any, liste: AliasEntry, idx: string, params?: () => void) => {
    const path: Path = [...liste.path, { dyn: idx }]
    const guard = { test: `µ._mjs_toRaw(${lectureSure(path)}) === µ._mjs_toRaw(${id.name})`, racine: String(liste.path[0]), params: [...(liste.guard?.params ?? []), ...(params ? [params] : [])] }
    elemAlias.set(bindingOf(id), { path, origin: 'local', guard })
  }
  // variable de TRAVAIL (cf. work) qui tient une partie de l'état local par son chemin : `(base = $.o).n || (base.n = 1)`, que
  // CoffeeScript écrit pour `$o.n or= 1` (et `?=`, `and=`). Ses écritures suivent ce chemin, gardées comme celles d'un élément de
  // liste (cf. parGarde) : l'écran suit, avec ou sans l'enveloppe, comme pour `||=` de Civet — une fonction de l'appli rangée dans
  // l'état comprise (`$format.appels or= 1`)
  if (!storeOnly) {
    for (const [a, w] of work) {
      const tp = !w.others.length && a.right.type === 'MemberExpression' ? getPath(a.right) : null
      if (tp?.origin === 'local' && !agit(tp)) elemAlias.set(bindingOf(a.left), { path: tp.path, origin: 'local', guard: { test: `µ._mjs_toRaw(${lectureSure(tp.path)}) === µ._mjs_toRaw(${a.left.name})`, racine: String(tp.path[0]), params: [] } })
    }
  }
  // les noms que lisent les clés du chemin (`$$liste[slot]`) désignent, partout où le nom est lu ou écrit, la variable qu'ils désignaient
  // là où il a été pris : sinon la garde lirait une autre variable, ou un nom hors de portée (ReferenceError)
  const clesEnPortee = (o: Occ, v: any): boolean => {
    const b           = bindingOf(o.id)
    const noms: any[] = []
    for (let m = v; m?.type === 'MemberExpression'; m = m.object) {
      if (m.computed) walk.full(m.property, (n: any) => { if (n.type === 'Identifier') noms.push(n) })
    }
    return noms.length === 0 || (occs.get(o.id.name) ?? []).every((r) => bindingOf(r.id) !== b || noms.every((n) => bindingOf({ type: 'Identifier', name: n.name, start: r.id.start, end: r.id.end }) === bindingOf(n)))
  }
  // gardes des noms pris sur un chemin fixe de l'état local : la valeur qui agit y est évaluée avant la garde (cf. parGarde)
  const gardesDeNom = new WeakSet<object>()
  // la valeur agit (appel, `new`, `++`, affectation, gabarit étiqueté, `delete`) : elle peut remplacer ou déplacer l'objet du chemin
  const valeurAgit = (e: any): boolean => {
    let a = false
    walk.full(e, (n: any) => { if (/^(?:Call|New|Update|Assignment|TaggedTemplate|Import)Expression$/.test(n.type) || (n.type === 'UnaryExpression' && n.operator === 'delete')) a = true })
    return a
  }
  // nom pris sur un chemin fixe de l'état local (`t := $o.a.b`, `t = $o.a.b` de CoffeeScript), réglage `proxy: false` : sa seule valeur (cf. seuleValeur), un chemin
  // sans clé qui agit. Ses écritures suivent ce chemin, gardées comme celles d'un élément de liste (cf. parGarde) : le chemin relu au
  // moment de l'écriture mène encore à cet objet, sinon l'écriture telle qu'écrite. Avec l'enveloppe, elle voit déjà ces écritures
  if (sansProxy && !storeOnly) {
    for (const [, list] of occs) {
      for (const o of list) {
        const v  = o.role === 'decl' ? o.node.init : o.role === 'assign' && o.node.operator === '=' ? o.node.right : null
        const tp = v?.type === 'MemberExpression' && !elemAlias.has(bindingOf(o.id)) && seuleValeur(o.id) === v ? getPath(v) : null
        if (tp?.origin === 'local' && tp.path.length > 1 && !agit(tp) && clesEnPortee(o, v)) {
          const guard = { test: `µ._mjs_toRaw(${lectureSure(tp.path)}) === µ._mjs_toRaw(${o.id.name})`, racine: String(tp.path[0]), params: [] }
          gardesDeNom.add(guard)
          elemAlias.set(bindingOf(o.id), { path: tp.path, origin: 'local', guard })
        }
      }
    }
  }
  // nom pris sur un chemin du magasin (`t := $$o.a.b`, `sheet = $$liste[slot]` de CoffeeScript), avec ou sans l'enveloppe : sa seule
  // valeur (cf. seuleValeur), un chemin sans clé qui agit. Son écriture simple (`t.c = v`) suit ce chemin quand, relu au moment de
  // l'écriture, il mène encore à cet objet (cf. cheminMagasin)
  const cheminsMagasin = new Map<string, Path>()
  if (!storeOnly) {
    for (const [, list] of occs) {
      for (const o of list) {
        const v  = o.role === 'decl' ? o.node.init : o.role === 'assign' && o.node.operator === '=' ? o.node.right : null
        const tp = v?.type === 'MemberExpression' && seuleValeur(o.id) === v ? getPath(v) : null
        if (tp?.origin === 'store' && !agit(tp) && clesEnPortee(o, v)) cheminsMagasin.set(bindingOf(o.id), tp.path)
      }
    }
  }
  // `t.c = v` → `(µ.store.o?.a?.b === t ? µ._mjs_storeDeepSet("o", ["a", "b", "c"], v) : µ._mjs_storeSetOn("o", t, "c", v))` ; valeur
  // lue (`return t.c = v`, dernière ligne d'une fonction Civet) : par un paramètre qui la rend. Sinon rien : l'écriture d'aujourd'hui
  function cheminMagasin(node: any, ancestors: any[]): boolean {
    const t     = node.left
    const path  = t.object.type === 'Identifier' && !t.computed && node.operator === '=' ? cheminsMagasin.get(bindingOf(t.object)) : undefined
    if (!path || suspension(node.right)) return false
    const k     = JSON.stringify(path[0])
    const o     = t.object.name
    const nu    = writeValueUnused(ancestors)
    const agitV = valeurAgit(node.right)
    const forme = (obj: string, v: string) => `${obj} != null && µ.store${lectureSure(path).slice(1)} === ${obj} ? µ._mjs_storeDeepSet(${k}, ${pathToJsLiteral([...path.slice(1), t.property.name])}, ${v}) : µ._mjs_storeSetOn(${k}, ${obj}, ${JSON.stringify(t.property.name)}, ${v})`
    // valeur qui n'agit pas, non lue : la garde en ligne, la valeur écrite dans chaque branche (une seule est évaluée) ; toute l'écriture
    // est remplacée, parenthèses de la valeur comprises (acorn les compte dans `node.end`), celles d'une expression à virgule gardées
    if (nu && !agitV) {
      const v = node.right.type === 'SequenceExpression' ? `(${ms.slice(node.right.start, node.right.end)})` : ms.slice(node.right.start, node.right.end)
      ms.overwrite(node.start, node.end, `${asiGuard(ancestors)}(${forme(o, v)})`)
      return true
    }
    // valeur lue, ou valeur qui agit (`t.c = f()`) : par un paramètre ; quand elle agit, le nom puis la valeur d'abord (l'ordre de
    // JavaScript), le chemin relu ensuite — une valeur qui remplace ou déplace l'objet n'envoie pas l'écriture ailleurs
    const start = rhsStart(js, node)
    ms.overwrite(node.start, start, `${asiGuard(ancestors)}((${agitV ? '_mjs_o, ' : ''}_mjs_v) => (${forme(agitV ? '_mjs_o' : o, '_mjs_v')}${nu ? '' : ', _mjs_v'}))(${agitV ? o + ', ' : ''}`)
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
      const pose = (d: Occ) => (d.role === 'decl' || d.role === 'assign') && d.fn === o.fn
      const rj   = (occs.get(`_mjs_rj_${m[1]}`) ?? []).some(pose) ? `_mjs_rj_${m[1]}` : null
      const idx  = rj ?? (!v.computed && v.property.name === '_mjs_it' ? `_mjs_ra_${m[1]}._mjs_ix` : v.computed && v.property.type === 'Identifier' && v.property.name === `_mjs_ri_${m[1]}` ? `_mjs_ri_${m[1]}` : null)
      if (!idx || seuleValeur(o.id) !== v) continue
      const rl    = (occs.get(`_mjs_rl_${m[1]}`) ?? []).find(pose)
      const lv    = rl ? seuleValeur(rl.id) : null
      const liste = lv ? cheminDeListe(lv) : null
      if (liste) ajouteElement(o.id, liste, idx)
    }
  }
  // paramètre d'un rappel de liste écrit sur place (`$.l.forEach((x) => x.n++)`, `map`, `filter`… cf. CALLBACK_METHODS) : l'indice est
  // le paramètre qui suit l'élément, ajouté au rappel (`_mjs_iN`) à sa première écriture compilée.
  // Dans l'ordre du texte : un rappel dans un rappel (`r.cells.forEach(…)`) part de l'élément du premier
  const rappels: any[] = []
  walk.simple(ast, {
    CallExpression(n: any) {
      const c = n.callee
      if (c.type === 'MemberExpression' && !c.computed && !c.optional && !n.optional && CALLBACK_METHODS.has(c.property.name) && n.arguments[0] && isFunction(n.arguments[0])) rappels.push(n)
    },
  })
  for (const n of rappels.sort((a, b) => a.start - b.start)) {
    const rang       = CALLBACK_METHODS.get(n.callee.property.name)!
    const f          = n.arguments[0]
    const [el, ix, ar] = [f.params[rang], f.params[rang + 1], f.params[rang + 2]]
    const liste      = f.params.length <= rang + 3 ? cheminDeListe(n.callee.object) : null
    if (!liste || el?.type !== 'Identifier' || [ix, ar].some((p) => p && p.type !== 'Identifier') || ![el, ix, ar].every((p) => !p || jamaisRelie(p))) continue
    const idx = ix ? ix.name : `_mjs_i${elemAlias.size}`
    let pose  = !!ix
    ajouteElement(el, liste, idx, () => {
      if (pose) return
      pose = true
      const dernier = f.params[f.params.length - 1]
      const ajout   = `, ${idx}`
      // `x => …` sans parenthèses : elles viennent avec les paramètres
      if (js.slice(dernier.end).trimStart()[0] === ')') ms.appendLeft(dernier.end, ajout)
      else {
        ms.prependRight(dernier.start, '(')
        ms.appendLeft(dernier.end, `${ajout})`)
      }
    })
  }

  // écriture par un élément de liste (cf. AliasEntry.guard) : `(test ? appel compilé : écriture telle qu'écrite)`, les paramètres du
  // rappel posés ; sans garde, l'appel seul. Une valeur lue en tête d'instruction (`x.n++ || f()`) garde l'écriture telle qu'écrite
  // avec l'enveloppe, qui la voit : rend `false` ; sans elle (réglage `proxy: false`), compilée aussi, posée entre les parenthèses de la
  // garde sans son propre point-virgule (`emit` reçoit des ancêtres où une parenthèse la sort de la tête). Une clé qui agit
  // (`x.t[k++] = 1`, `x.t[($l.reverse(), 0)] = 1`) garde toujours l'écriture telle qu'écrite : la garde se lirait avant son effet, qui
  // peut déplacer l'objet dans la liste (l'écriture irait à un autre), et sa cible liée (`+=`, `++`) poserait son point-virgule dans la garde
  function parGarde(node: any, ancestors: any[], tp: AliasEntry, emit: (anc: any[]) => void): boolean {
    const g = tp.guard
    if (!g) {
      emit(ancestors)
      return true
    }
    const asi = asiGuard(ancestors)
    // valeur ou argument qui attend (`x.n = await f()`) : la garde se lirait avant l'attente, la liste a pu changer depuis
    const attend = node.type === 'AssignmentExpression' ? suspension(node.right) : node.type === 'CallExpression' && node.arguments.some((a: any) => suspension(a))
    const tete   = asi !== '' && !writeValueUnused(ancestors)
    if ((tete && !sansProxy) || agit(tp) || attend) return false
    // la branche telle qu'écrite, avec le réglage `proxy: false` : par l'aide gardée (cf. ecritureGardee) — l'élément déplacé atteint
    // peut-être un prototype ou une fonction du navigateur par une clé venue de l'extérieur
    // nom pris sur un chemin fixe (cf. gardesDeNom) dont la valeur agit : `t.c = f()` — la valeur d'abord, par un paramètre, puis la garde,
    // le chemin relu APRÈS elle ; écriture composée ou méthode (`t.n += f()`, `t.l.push(f())`) : l'écriture telle qu'écrite
    const agitV = gardesDeNom.has(g) && (node.type === 'AssignmentExpression' ? valeurAgit(node.right) : node.type === 'CallExpression' && node.arguments.some(valeurAgit))
    if (agitV && !(node.type === 'AssignmentExpression' && node.operator === '=')) return false
    let hisse = ''
    if (agitV) {
      hisse = node.right.type === 'SequenceExpression' ? `(${ms.slice(node.right.start, node.right.end)})` : ms.slice(node.right.start, node.right.end)
      ms.overwrite(node.right.start, node.right.end, '_mjs_v')
    }
    const orig = (sansProxy && texteGarde(node, ancestors)) || ms.slice(node.start, node.end)
    emit(tete ? [...ancestors.slice(0, -1), { type: 'ParenthesizedExpression', start: node.start - 1, end: node.end + 1, expression: node }, node] : ancestors)
    // préfixe posé À DROITE de `node.start` : il reste dans le texte de l'écriture quand elle est la valeur d'une autre (`t.n = t.z = 6`)
    ms.prependRight(node.start, hisse ? `${asi}((_mjs_v) => (${g.test} ? ` : `${asi}(${g.test} ? `)
    ms.appendLeft(node.end, hisse ? ` : ${orig}))(${hisse})` : ` : ${orig})`)
    for (const f of g.params) f()
    return true
  }

  // ── Réglage `proxy: false` : les écritures que la passe ne voit pas (cf. AvisInvisible) ────────────────────────────────────
  // variable de l'état local que tient `e` : chemin de l'état, élément trouvé ou retiré (`$.l.find(f)`, `$.l.at(-1)`, `$.l.pop()`),
  // élément de liste suivi (cf. elemAlias), nom qui tient l'un d'eux (cf. aliasLocaux) — sinon null
  const aliasLocaux = new Map<string, string>()
  function racineLocale(e: any): string | null {
    if (storeOnly || !e) return null
    if (e.type === 'ChainExpression') return racineLocale(e.expression)
    if (e.type === 'Identifier') return elemAlias.get(bindingOf(e))?.guard?.racine ?? aliasLocaux.get(bindingOf(e)) ?? null
    // champ de l'instance qui en tient une partie (`@t = $l.find(f)` de CoffeeScript, `this.t`, cf. lie)
    if (e.type === 'MemberExpression' && e.object.type === 'ThisExpression' && !e.computed && e.property.type === 'Identifier') return aliasLocaux.get('this.' + e.property.name) ?? null
    // prototype d'une partie de l'état local (`Object.getPrototypeOf($.l.find(f))`, cf. isProtoOf) : l'aide gardée le refuse
    if (e.type === 'CallExpression' && isProtoOf(e)) return racineLocale(e.arguments[0])
    // valeur lue par `Reflect.get(o, k)` (celle de `o[k]`), élément trouvé par `Array.prototype.find.call(l, f)`
    if (isReflectGet(e)) return racineLocale(e.arguments[0]) ?? racineCopie(e.arguments[0])
    if (e.type === 'CallExpression' && appelDeListe(e, FIND_METHODS)) return racineDesElements(e.arguments[0])
    // champ d'un objet fait par étalement (`({ ...$.o }).a`) : une partie de `$.o`
    if (e.type === 'MemberExpression') return e.object.type === 'Identifier' && e.object.name === '$' ? (e.computed ? null : e.property.name) : racineLocale(e.object) ?? (e.computed || e.object.type === 'ObjectExpression' ? racineCopie(e.object) : null)
    if (e.type === 'CallExpression') return e.callee.type === 'MemberExpression' && !e.callee.computed && (FIND_METHODS.has(e.callee.property.name) || POP_METHODS.has(e.callee.property.name)) ? racineLocale(e.callee.object) ?? racineCopie(e.callee.object) : null
    if (e.type === 'LogicalExpression') return racineLocale(e.left) ?? racineLocale(e.right)
    if (e.type === 'ConditionalExpression') return racineLocale(e.consequent) ?? racineLocale(e.alternate)
    return null
  }
  // variable de l'état local dont `e` tient les ÉLÉMENTS : une liste de l'état (cf. racineLocale), ou une liste calculée qui garde ses
  // objets (`$.l.filter(f)`, `$.l.slice(1)`, cf. COPY_METHODS, nom qui en tient une) — la copie elle-même n'en est pas une partie, ses
  // éléments si (`$.l.filter(f)[0]`, `c.find(g)`)
  function racineDesElements(e: any): string | null {
    return racineCopie(e) ?? racineLocale(e)
  }
  // nom qui tient une copie gardant les objets de l'état local (`c = $.l.filter(f)`) → la variable de la liste ; copie faite par
  // `Object.values`, `Object.entries` (ses paires), `Array.from` ou l'étalement (`[...$.l]`), comme pour le magasin (cf. copyRoot)
  const copiesLocales = new Map<string, string>()
  function racineCopie(e: any): string | null {
    if (e?.type === 'ChainExpression') e = e.expression
    // étalement d'une liste ou d'un objet (`[...$.l]`, `({ ...$.o })`)
    if (e?.type === 'ArrayExpression' || e?.type === 'ObjectExpression') {
      let r: string | null = null
      for (const el of e.elements ?? e.properties) if (el?.type === 'SpreadElement') r ??= racineDesElements(el.argument)
      return r
    }
    const c = e?.type === 'CallExpression' ? e.callee : null
    const a = c?.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && e.arguments[0]?.type !== 'SpreadElement' ? e.arguments[0] : null
    if (a && ((c.object.name === 'Object' && (c.property.name === 'values' || c.property.name === 'entries')) || (c.object.name === 'Array' && c.property.name === 'from'))) return racineDesElements(a)
    // `concat` : les éléments de la liste et ceux des listes qu'il reçoit (`[].concat($.l)`) ; `Array.of(...$.l)`
    if (c?.type === 'MemberExpression' && !c.computed && (c.property.name === 'concat' || (c.object.type === 'Identifier' && c.object.name === 'Array' && c.property.name === 'of'))) {
      let r = c.property.name === 'concat' ? racineDesElements(c.object) : null
      for (const x of e.arguments) r ??= x.type === 'SpreadElement' ? racineDesElements(x.argument) : c.property.name === 'concat' ? racineDesElements(x) : null
      if (r) return r
    }
    if (c?.type === 'MemberExpression' && !c.computed && COPY_METHODS.has(c.property.name)) return racineDesElements(c.object)
    // liste retournée, triée ou remplie sur place (`$.l.slice().reverse()`, `c.sort(f)`), Map ou Set rendu par `set` ou `add` : la même
    // collection, ses éléments ; `splice` : la liste des éléments retirés ; `map(f)` et `flatMap(f)` : leur rappel peut rendre les objets
    // mêmes (`$.l.map((t) => t)`), écrits alors par l'aide gardée
    if (c?.type === 'MemberExpression' && !c.computed && (RENDU_BRUT.has(c.property.name) || c.property.name === 'map' || c.property.name === 'flatMap') && !POP_METHODS.has(c.property.name)) return racineDesElements(c.object)
    return e?.type === 'Identifier' ? copiesLocales.get(bindingOf(e)) ?? null : null
  }
  // nom (ou noms d'un motif : `{ constructor: c } = $.l.find(f)`) qui reçoit une partie de l'état local, ou une copie qui en garde les objets
  // `affecte` : motif d'une affectation (`({ [k]: c } = $.o)`), dont un nom posé par la passe est un champ (cf. motifsCles)
  function lie(cible: any, valeur: any, affecte = false): void {
    // motif de liste sur une liste écrite (`[t] = [$.l.find(f)]`) : chaque nom reçoit sa valeur
    if (cible.type === 'ArrayPattern' && valeur.type === 'ArrayExpression') {
      cible.elements.forEach((c: any, i: number) => {
        const v = valeur.elements[i]
        if (c && v && v.type !== 'SpreadElement' && c.type !== 'RestElement') lie(c.type === 'AssignmentPattern' ? c.left : c, v, affecte)
      })
      return
    }
    const r = racineLocale(valeur)
    if (cible.type === 'MemberExpression') {
      if (r && cible.object.type === 'ThisExpression' && !cible.computed && cible.property.type === 'Identifier') aliasLocaux.set('this.' + cible.property.name, r)
      return
    }
    // motif sur une copie qui garde les objets (`const [a] = $.l.splice(0, 1)`, `[x, y] = c`) : ses noms en tiennent une partie
    if (cible.type !== 'Identifier') {
      lieMotif(cible, r ?? racineCopie(valeur), affecte)
      return
    }
    const c = r ? null : racineCopie(valeur)
    if (r) aliasLocaux.set(bindingOf(cible), r)
    else if (c) copiesLocales.set(bindingOf(cible), c)
  }
  // nom qui tient une partie de l'état local (`t = $.o`, `const it = $.l.find(f)`, `t ??= $.l.find(f)`) ; deux tours pour une chaîne
  // (`b = a`). Motif (`for (const { constructor: c } of $.l)`, `({ constructor: c }) => …`) : chacun de ses noms
  const lieMotif = (p: any, r: string | null, affecte = false) => {
    if (!r) return
    forEachPatternLeaf(p, (f: any) => { if (f.type === 'Identifier') aliasLocaux.set(bindingOf(f), r) })
    clesDeMotif(p, affecte)
  }
  // clé calculée d'un motif qui lit une partie de l'état (`const { [k]: c } = $.l.find(f)`) : jugée par `µ._mjs_deepNom` et
  // `µ._mjs_deepNomLu` (mjs_deep.ts), qui refusent une clé réservée menant à une fonction ou à un prototype — le motif lit alors une clé
  // absente (cf. motifsCles, posé après la passe) ; propriété du motif → vrai dans un motif d'affectation (cf. lie)
  const motifsCles = new Map<any, boolean>()
  function clesDeMotif(p: any, affecte = false): void {
    if (p?.type === 'ObjectPattern') {
      for (const q of p.properties) {
        if (q.type === 'RestElement') continue
        if (q.computed && q.key.type !== 'Literal' && !(q.key.type === 'TemplateLiteral' && q.key.expressions.length === 0)) motifsCles.set(q, affecte)
        clesDeMotif(q.value, affecte)
      }
    }
    else if (p?.type === 'ArrayPattern') for (const q of p.elements) clesDeMotif(q, affecte)
    else if (p?.type === 'AssignmentPattern') clesDeMotif(p.left, affecte)
    else if (p?.type === 'RestElement') clesDeMotif(p.argument, affecte)
  }
  // méthode d'une liste appelée sur `l` (`Array.prototype.find.call(l, f)`) dont le nom est dans `noms`
  const appelDeListe = (e: any, noms: Set<string> | Map<string, number>) => e.callee.type === 'MemberExpression' && !e.callee.computed && e.callee.property.name === 'call' && isArrayMethod(e.callee.object) && noms.has(e.callee.object.property.name) && e.arguments.length > 0 && e.arguments[0].type !== 'SpreadElement'
  // noms qui tiennent la valeur de `pop` & co. (cf. renduBrut, lieBrut) : avec l'enveloppe, ceux d'aliasLocaux, posés seulement pour
  // ces valeurs ; avec le réglage `proxy: false`, à part (aliasLocaux y tient toute partie de l'état), lus par racineGardee
  const brutsNoms = sansProxy ? new Map<string, string>() : aliasLocaux
  // valeurs que tient une liste ou un objet écrits (`[0, t]`, `{ t }`, `[...l]`, `{ ...o }`) ou que garde une copie (`Object.values(o)`,
  // `Object.entries(o)`, `Object.fromEntries(l)`, `Object.assign({}, o)`, `Array.from(l)`, `Array.of(t)`, `l.concat(t)`) : ses parties
  // sont les leurs (cf. racineBrute) ; sinon null
  function sourcesDeCopie(e: any): any[] | null {
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
  // variable de l'état local d'une valeur que la méthode compilée laisse brute : la méthode qui l'a rendue (cf. renduBrut), le nom qui la
  // tient (cf. brutsNoms), une liste, un objet ou une copie qui la tient (cf. sourcesDeCopie), le prototype d'une partie de l'état, ou une
  // chaîne qui part d'eux (`$.l.pop().tags`, `t.find(f)`, `Object.values($.l.pop())[0]`) ; sinon null
  function racineBrute(e: any): string | null {
    for (let x = e; x;) {
      const r = renduBrut(x)
      if (r) return r
      const s = sourcesDeCopie(x)
      if (s) {
        for (const y of s) {
          const q = racineBrute(y)
          if (q) return q
        }
        return null
      }
      if (x.type === 'Identifier') return brutsNoms.get(bindingOf(x)) ?? null
      if (x.type === 'MemberExpression' && x.object.type === 'ThisExpression' && !x.computed && x.property.type === 'Identifier') return brutsNoms.get('this.' + x.property.name) ?? null
      if (x.type === 'ConditionalExpression' || x.type === 'LogicalExpression') return racineBrute(x.type === 'LogicalExpression' ? x.left : x.consequent) ?? racineBrute(x.type === 'LogicalExpression' ? x.right : x.alternate)
      if (x.type === 'CallExpression' && isProtoOf(x)) return racineLocale(x)
      x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : x.type === 'AwaitExpression' ? x.argument : x.type === 'SequenceExpression' ? x.expressions[x.expressions.length - 1] : null
    }
    return null
  }
  // appel compilé (`µ._mjs_deepCall`) d'une méthode de RENDU_BRUT sur un chemin de l'état local (`$.l.pop()`, `$.o.l.splice(i, 1)`,
  // élément suivi `t.tags.sort(f)`) : la variable de l'état ; sinon null
  function renduBrut(e: any): string | null {
    if (storeOnly || e?.type !== 'CallExpression') return null
    const c = e.callee
    if (c.type !== 'MemberExpression' || c.computed || !RENDU_BRUT.has(c.property.name)) return null
    const tp = getPath(c.object, true)
    return tp?.origin === 'local' && typeof tp.path[0] === 'string' ? tp.path[0] : null
  }
  // fonction écrite dans ce code et jamais réaffectée qu'un nom désigne (`function cmp(a, b) {…}`, `const cmp = (a, b) => …`) : ses
  // paramètres reçoivent ce que reçoit le nom passé en rappel (`$.l.sort(cmp)`) ; sinon null
  let fonctions: Map<string, any> | null = null
  function fonctionLocale(id: any): any {
    if (id?.type !== 'Identifier' || tainted.has(id.name)) return isFunction(id ?? {}) ? id : null
    if (!fonctions) {
      fonctions = new Map()
      walk.simple(ast, {
        FunctionDeclaration(n: any) {
          if (n.id) fonctions!.set(bindingOf(n.id), n)
        },
        VariableDeclarator(n: any) {
          if (n.id.type === 'Identifier' && n.init && isFunction(n.init)) fonctions!.set(bindingOf(n.id), n.init)
        },
        // variable déclarée sans valeur, affectée une seule fois (cf. once) : `cmp = (a, b) -> …` de CoffeeScript
        AssignmentExpression(n: any) {
          if (once.has(n) && n.left.type === 'Identifier' && isFunction(n.right)) fonctions!.set(bindingOf(n.left), n.right)
        },
      })
    }
    return fonctions.get(bindingOf(id)) ?? null
  }
  // tours jusqu'à ce qu'aucun nom neuf ne se lie (`c3 = b3`, `b3 = a3`, `a3 = $.l.find(f)`, écrits dans cet ordre), huit au plus
  if (sansProxy && !storeOnly) {
    for (let tour = 0, taille = -1; tour < 8 && taille !== aliasLocaux.size + copiesLocales.size; tour++) {
      taille = aliasLocaux.size + copiesLocales.size
      walk.simple(ast, {
        VariableDeclarator(n: any) {
          if (n.init) lie(n.id, n.init)
        },
        AssignmentExpression(n: any) {
          if (n.operator === '=' || LOGICAL_ASSIGN.has(n.operator)) lie(n.left, n.right, true)
        },
        // variable d'une boucle `for … of` sur une liste de l'état, calculée ou non (`for (const y of $.l.filter(f))`)
        ForOfStatement(n: any) {
          const r  = racineDesElements(n.right)
          let id   = n.left.type === 'VariableDeclaration' ? n.left.declarations[0]?.id : n.left
          const c  = n.right.type === 'CallExpression' ? n.right.callee : null
          // paire rendue par `entries()` (`for (const [i, y] of $.l.entries())`) : l'élément en est le second
          if (id?.type === 'ArrayPattern' && c?.type === 'MemberExpression' && !c.computed && c.property.name === 'entries') id = id.elements[1]
          if (id?.type !== 'MemberExpression') lieMotif(id, r, n.left.type !== 'VariableDeclaration')
        },
        // paramètres d'un rappel écrit en place sur une liste de l'état, calculée ou non : l'élément, et la liste reçue en 3e
        // (`$.l.forEach((x, i, arr) => { arr[i].n = 1 })`) ; les deux éléments d'un rappel de comparaison (`$.l.sort((a, b) => …)`)
        // méthode appelée sur `l` (`Array.prototype.forEach.call(l, f)`) ; `reduce` et `reduceRight` sans valeur de départ :
        // l'accumulateur part du premier élément
        CallExpression(n: any) {
          const call = appelDeListe(n, CALLBACK_METHODS)
          const c    = call ? n.callee.object : n.callee
          const args = call ? n.arguments.slice(1) : n.arguments
          const nom  = c.type === 'MemberExpression' && !c.computed ? c.property.name : null
          const rang = nom === null ? undefined : CALLBACK_METHODS.get(nom)
          const a0   = rang === undefined && !SORT_METHODS.has(nom ?? '') ? null : args[0]
          // rappel nommé : la fonction écrite dans ce code (cf. fonctionLocale) ; un rappel que la passe ne lit pas (paramètre, import,
          // méthode, `this.cmp`) reste hors de la garde
          const f    = a0 && fonctionLocale(a0)
          const r    = a0 ? racineDesElements(call ? n.arguments[0] : c.object) : null
          if (r && f) for (const p of rang === undefined ? f.params.slice(0, 2) : [f.params[rang], f.params[rang + 2], rang === 1 && args.length === 1 ? f.params[0] : null]) lieMotif(p, r)
        },
      })
    }
  }
  // ce que la méthode compilée (`µ._mjs_deepCall`) laisse BRUT — la valeur de `pop` & co. (cf. renduBrut : `t = $.l.pop()`,
  // `const [a] = $.l.splice(0, 1)`, `for (const t of $.l.splice(0, 2))`, `$.l.splice(0, 2).forEach((t) => …)`), une liste, un objet ou une
  // copie qui la tient (`o = { t: $.l.pop() }`, `o.t = $.l.pop()` : l'objet `o` du script), le paramètre d'une fonction appelée en place
  // (`((o) => …)(t)`), et les deux éléments du rappel de comparaison de `sort` sur une liste de l'état (`$.l.sort((a, b) => …)`,
  // `$.l.sort(cmp)` d'une fonction de ce code, cf. fonctionLocale) ; les noms qui les reçoivent ensuite (`c = a` dans le rappel, `s = a`
  // hors de lui, `p = Object.getPrototypeOf($.o)`) aussi. Une écriture par eux passe par l'aide gardée (cf. racineGardee) ; avec le
  // réglage, la passe voit déjà les noms qui tiennent une partie de l'état (cf. lie), ceux-ci y ajoutent ce qu'elle ne suit pas
  if (!storeOnly) {
    const lieNoms = (p: any, r: string | null, affecte = false) => {
      if (!sansProxy) return lieMotif(p, r, affecte)
      if (r) forEachPatternLeaf(p, (f: any) => { if (f.type === 'Identifier') brutsNoms.set(bindingOf(f), r) })
    }
    const lieBrut = (cible: any, valeur: any, affecte = false): void => {
      // motif de liste sur une liste écrite (`[t] = [$.l.pop()]`) : chaque nom reçoit sa valeur
      if (cible.type === 'ArrayPattern' && valeur.type === 'ArrayExpression') {
        cible.elements.forEach((c: any, i: number) => {
          const v = valeur.elements[i]
          if (c && v && v.type !== 'SpreadElement' && c.type !== 'RestElement') lieBrut(c.type === 'AssignmentPattern' ? c.left : c, v, affecte)
        })
        return
      }
      const r = racineBrute(valeur)
      if (!r) return
      let v = valeur
      while (v.type === 'ChainExpression' || v.type === 'AwaitExpression') v = v.type === 'ChainExpression' ? v.expression : v.argument
      if (cible.type === 'Identifier') {
        brutsNoms.set(bindingOf(cible), r)
      }
      else if (cible.type !== 'MemberExpression') lieNoms(cible, r, affecte)
      // champ de l'instance (`@t = $l.pop()` de CoffeeScript, `this.t`)
      else if (cible.object.type === 'ThisExpression' && !cible.computed && cible.property.type === 'Identifier') brutsNoms.set('this.' + cible.property.name, r)
      // champ d'un objet du script (`o.t = $.l.pop()`) : l'objet en tient une partie
      else {
        const b = baseLocale(cible)
        if (b) brutsNoms.set(b, r)
      }
    }
    for (let tour = 0, taille = -1; tour < 8 && taille !== brutsNoms.size; tour++) {
      taille = brutsNoms.size
      walk.simple(ast, {
        VariableDeclarator(n: any) {
          if (n.init) lieBrut(n.id, n.init)
        },
        AssignmentExpression(n: any) {
          if (n.operator === '=' || LOGICAL_ASSIGN.has(n.operator)) lieBrut(n.left, n.right, true)
        },
        ForOfStatement(n: any) {
          const id = n.left.type === 'VariableDeclaration' ? n.left.declarations[0]?.id : n.left
          if (id && id.type !== 'MemberExpression') lieNoms(id, racineBrute(n.right), n.left.type !== 'VariableDeclaration')
        },
        CallExpression(n: any) {
          // fonction appelée en place (`((o) => { o.a[k].x = v })(t)`) : chaque paramètre reçoit son argument
          if (isFunction(n.callee)) n.callee.params.forEach((p: any, i: number) => {
            const a = n.arguments[i]
            if (a && a.type !== 'SpreadElement') lieBrut(p.type === 'AssignmentPattern' ? p.left : p, a)
          })
          const c    = n.callee
          const nom  = c.type === 'MemberExpression' && !c.computed ? c.property.name : null
          const rang = nom === null ? undefined : CALLBACK_METHODS.get(nom)
          // tri compilé d'une liste de l'état (`$.l.sort(f)`), rappel sur une valeur brute (`$.l.splice(0, 2).forEach(f)`)
          const tri  = nom === 'sort' && renduBrut(n) !== null
          const r    = tri ? renduBrut(n) : rang !== undefined || nom === 'sort' ? racineBrute(c.object) : null
          if (!r || !n.arguments[0]) return
          // rappel que la passe ne lit pas : hors de la garde
          const f = fonctionLocale(n.arguments[0])
          if (f) for (const p of rang === undefined ? f.params.slice(0, 2) : [f.params[rang], f.params[rang + 2], rang === 1 && n.arguments.length === 1 ? f.params[0] : null]) lieNoms(p, r)
        },
      })
    }
  }
  // clés calculées des motifs liés (cf. clesDeMotif) — aucune case ni pile partagée, rien ne reste après une erreur : une déclaration
  // (`[k]: c`) devient `[µ._mjs_deepNomA]: n = µ._mjs_deepNom(k), [n]: t, [µ._mjs_deepNomA]: c = µ._mjs_deepNomLu(t, n)` — la clé absente
  // `µ._mjs_deepNomA` donne à `n` la clé convertie une fois (le texte entre les crochets, entier : `[(0, k)]`), la valeur est lue une fois
  // dans `t`, puis jugée avec sa clé par `µ._mjs_deepNomLu` (mjs_deep.ts), deux noms posés ici, propres au site et à chaque appel. Un motif
  // d'affectation, sans nom à poser, passe par un cadre neuf (`µ._mjs_deepNom(k, 1)`) : `[µ._mjs_deepNomA]: µ._mjs_deepNomF = µ._mjs_deepNom(k, 1),
  // [µ._mjs_deepNomF.k]: µ._mjs_deepNomF.v, [µ._mjs_deepNomA]: c = µ._mjs_deepNomV` — JavaScript évalue la cible `µ._mjs_deepNomF.v`
  // (son cadre) avant de lire la valeur, que le cadre juge en la recevant. Un défaut écrit (`[k]: c = d`) passe par un motif de liste
  // (`[c = d] = [jugée]`), qui le prend quand la valeur jugée est `undefined`
  for (const [q, affecte] of motifsCles) {
    const n   = affecte ? 'µ._mjs_deepNomF' : `_mjs_cn${q.key.start}`
    const t   = affecte ? 'µ._mjs_deepNomF.v' : `_mjs_cle${q.key.start}`
    const lu  = affecte ? 'µ._mjs_deepNomV' : `µ._mjs_deepNomLu(${t}, ${n})`
    const def = q.value.type === 'AssignmentPattern'
    ms.appendLeft(q.start + 1, `µ._mjs_deepNomA]: ${n} = µ._mjs_deepNom(`)
    ms.prependRight(js.indexOf(']', q.key.end), `${affecte ? ', 1' : ''}), [${affecte ? n + '.k' : n}`)
    ms.prependLeft(q.value.start, `${t}, [µ._mjs_deepNomA]: ${def ? '[' : ''}`)
    ms.prependRight(q.value.end, def ? `] = [${lu}]` : ` = ${lu}`)
    changed = true
  }
  // écriture par `objet` que la passe ne compile pas : un objet de l'état local (nom qui en tient une partie, élément rendu par une
  // méthode, `$.l.find(f)`) fait avertir, nommé par sa tête, ou par son texte quand elle est `$`
  function invisible(objet: any, at: number): void {
    const r = sansProxy ? racineLocale(objet) : null
    if (!r) return
    let e = objet
    while (e.type === 'MemberExpression' || e.type === 'ChainExpression' || e.type === 'CallExpression') e = e.type === 'MemberExpression' ? e.object : e.type === 'ChainExpression' ? e.expression : e.callee
    // tête qui ne tient rien de l'état (`Object` de `Object.values($m)[0]`) : le texte de l'objet
    avis.push({ at, forme: 1, nom: e.type === 'Identifier' && e.name !== '$' && racineLocale(e) ? e.name : js.slice(objet.start, objet.end).replace(/\$\./g, '$'), racine: '$' + r })
  }
  // variable de l'état local dont l'objet `e` d'une écriture que la passe ne compile pas est une partie (réglage `proxy: false`) : celle de
  // racineLocale, ou celle d'une chaîne de membres et d'appels qui part de l'état (`$.l.values().next().value`, `$.l.map(f)[0]`) — la clé
  // de l'aide gardée (cf. LOCALE) ; sinon null. Un objet rendu par un appel est une valeur neuve (`$.l.slice().reverse()`), sauf un
  // élément trouvé ou retiré (cf. racineLocale)
  function racineGardee(e: any): string | null {
    if (storeOnly) return null
    // avec l'enveloppe, ce qu'elle ne garde pas (cf. racineBrute) : une chaîne qui part de la valeur de `pop` & co. (`$.l.pop()[k].x = v`,
    // `(0, $.l.shift()).x = v`), d'un nom qui en tient une, d'un élément du rappel de `sort` (`a[k].x = v`), du prototype d'une partie de
    // l'état (`Object.getPrototypeOf($.o).constructor.x = v`)
    if (!sansProxy) {
      const r = racineBrute(e)
      return r ? LOCALE + r : null
    }
    if ((e.type === 'ChainExpression' ? e.expression : e).type === 'CallExpression') {
      const r = racineLocale(e)
      if (r) return LOCALE + r
    }
    // tête faite d'une virgule ou d'un `await` (`(0, $.l.pop())[k].x = v`) : leur valeur
    else for (let x = e; x; x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : x.type === 'SequenceExpression' ? x.expressions[x.expressions.length - 1] : x.type === 'AwaitExpression' ? x.argument : null) {
      const r = racineLocale(x)
      if (r) return LOCALE + r
    }
    // valeur de `pop` & co. tenue par une liste, un objet ou une copie (`Object.assign({}, $.l.pop()).a`), un nom qui les tient, le
    // paramètre d'une fonction appelée en place (cf. lieBrut) : sortie de l'état, aucun avertissement, l'écriture gardée
    const b = racineBrute(e)
    return b ? LOCALE + b : null
  }
  // objet d'une écriture gardée dont la chaîne écrit un nom réservé dans le code (`$.l.find(f).constructor.prototype`, `['__proto__']`),
  // sans clé calculée après lui (cf. ctorWritten) : passé par `µ._mjs_deepSur`, qui nomme ce nom (le premier écrit) quand il mène à un
  // prototype ou à une fonction du navigateur ; sinon le texte tel quel
  // `texte` : celui de l'objet, ses clés calculées déjà lues par `µ._mjs_deepCle` (cf. boundChain, clesGardees) ; `sur` : l'objet passe
  // toujours par `µ._mjs_deepSur` (premier argument d'`Object.assign`, cf. premierGarde ; objet d'une écriture avec `yield`)
  function objetGarde(root: string, e: any, texte: string, sur = false): string {
    let s: string | null = null
    for (let x = e; x; x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : null) {
      if (x.type !== 'MemberExpression') continue
      const k   = x.property
      const nom = !x.computed ? k.name : k.type === 'Literal' ? k.value : k.type === 'TemplateLiteral' && k.expressions.length === 0 ? k.quasis[0].value.cooked : undefined
      if (nom === undefined) break
      if (nom === '__proto__' || nom === 'constructor' || nom === 'prototype') s = nom
    }
    // objet du magasin (`#$` devant sa clé, cf. premierGarde) : l'aide du magasin, sans le module des écritures profondes
    const aide = root.startsWith(LOCALE + '$') ? 'µ._mjs_storeSur' : 'µ._mjs_deepSur'
    return s ? `${aide}(${JSON.stringify(root.slice(1))}, ${texte}, "${s}")` : sur ? `${aide}(${JSON.stringify(root.slice(1))}, ${texte})` : texte
  }
  // texte du premier argument `e` d'une fonction qui modifie l'objet qu'elle reçoit (cf. premierGarde), tenu entre `debut` et `fin` :
  // chaque clé calculée de sa chaîne (`$.l.find(f)[k]`), ni littérale ni dans une chaîne `?.`, lue par `aide` (cf. aideCle, boundChain).
  // Sans une telle clé, ou sans aide, `texte`
  function clesGardees(e: any, texte: string, debut: number, fin: number, aide: string | null): string {
    const cles: any[] = []
    for (let x = e; x; x = x.type === 'MemberExpression' ? x.object : x.type === 'CallExpression' ? x.callee : x.type === 'ChainExpression' ? x.expression : null) {
      if (x.optional || x.type === 'ChainExpression') return texte
      // appel déjà réécrit (cf. reecrit) : ses clés sont celles du chemin compilé, qui les refuse lui-même
      if (reecrit(x)) break
      if (x.type === 'MemberExpression' && x.computed && x.property.type !== 'Literal' && !(x.property.type === 'TemplateLiteral' && x.property.expressions.length === 0)) cles.push(x)
    }
    if (!cles.length || !aide) return texte
    const copie = ms.clone()
    for (const x of cles) {
      const ouvre = js.lastIndexOf('[', x.property.start)
      copie.prependRight(x.start, aide + '(')
      copie.overwrite(ouvre, ouvre + 1, ', ')
      copie.overwrite(x.end - 1, x.end, ')')
    }
    return copie.slice(debut, fin)
  }
  // écriture relue dont la valeur porte `yield` (`$.l.find(f)[k].x ||= yield v`, `$$l.find(f)[k].x ||= yield v`) : aucune fonction
  // fléchée ne reçoit le `yield`, l'objet passe en place par `µ._mjs_deepSur`, qui rend un objet gelé pour un prototype ou une fonction
  // du navigateur ; l'écriture reste celle de JavaScript, sans aide ni redessin. Rend faux quand rien n'est posé (`?.` dans l'objet)
  function objetSurPlace(m: MagicString, cible: any, root: string): boolean {
    const p = foundParts(cible, aideCle(root))
    if (!p || p.binds.length) return false
    const r = root[0] === LOCALE ? root : LOCALE + '$' + (root === SOFT || root === NO_KEY ? '…' : root)
    m.overwrite(cible.start, p.sep, objetGarde(r, cible.object, p.obj, true))
    return true
  }
  // écriture `node` par un objet de l'état local que la passe ne compile pas (cf. racineGardee), posée sur `m` (le texte, ou sa copie, cf.
  // texteGarde) par l'aide gardée : affectation, `++`/`--` (`bloc` : l'instruction qu'elle est, cf. instructionSeule), méthode qui
  // modifie, `delete`. Rend faux quand rien n'est posé (aucun objet de l'état, `?.` dans l'objet, `yield` qu'aucune fonction fléchée ne
  // reçoit) : l'écriture reste telle qu'écrite
  function ecritureGardee(m: MagicString, node: any, ancestors: any[], bloc: any = null): boolean {
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const cible = node.type === 'AssignmentExpression' ? node.left : node.argument
      const root  = cible.type === 'MemberExpression' ? racineGardee(cible.object) : null
      const wait  = root ? suspension(node.type === 'AssignmentExpression' ? node.right : cible) : null
      const t     = root && !(wait === 'yield' && node.type === 'UpdateExpression') ? foundTarget(cible, root, node.type === 'UpdateExpression' || node.operator !== '=', wait === 'await') : null
      if (t && wait === 'yield' && t.bind) return objetSurPlace(m, cible, root!)
      if (!t) return false
      if (node.type === 'AssignmentExpression') emitAssign(m, js, node, ancestors, t)
      else {
        emitUpdate(m, node, ancestors, t, !!bloc)
        if (bloc) poserBloc(m, bloc)
      }
      return true
    }
    const cible = node.type === 'CallExpression' ? node.callee : node.argument
    const root  = cible?.type === 'MemberExpression' && !(node.type === 'CallExpression' && (cible.computed || node.optional)) ? racineGardee(cible.object) : null
    const p     = root ? foundParts(cible, aideCle(root)) : null
    if (!p || p.binds.length) return false
    const obj = objetGarde(root!, cible.object, p.obj)
    if (node.type === 'UnaryExpression') m.overwrite(node.start, node.end, `${onHead('Delete', root!)}${obj}, ${p.key})`)
    else if (node.arguments.length === 0) m.overwrite(node.start, node.end, `${onHead('Call', root!)}${obj}, '${cible.property.name}', [])`)
    else {
      m.overwrite(node.start, js.indexOf('(', cible.end) + 1, `${onHead('Call', root!)}${obj}, '${cible.property.name}', [`)
      m.overwrite(node.end - 1, node.end, '])')
    }
    return true
  }
  // la même écriture, posée sur une copie du texte entre les parenthèses d'une garde (cf. parGarde) : son texte, ou null
  function texteGarde(node: any, ancestors: any[]): string | null {
    const copie = ms.clone()
    const anc   = [...ancestors.slice(0, -1), { type: 'ParenthesizedExpression', start: node.start - 1, end: node.end + 1, expression: node }, node]
    return ecritureGardee(copie, node, anc) ? copie.slice(node.start, node.end) : null
  }
  // écriture que la passe ne compile pas : avertie avec le réglage `proxy: false` (cf. invisible), passée par l'aide gardée quand son
  // objet est une partie de l'état local (cf. ecritureGardee)
  function ecritureInvisible(node: any, ancestors: any[], objet: any, bloc: any = null): void {
    invisible(objet, node.start)
    if (ecritureGardee(ms, node, ancestors, bloc)) changed = true
  }
  // nom d'une fonction écrite `Objet.nom` (`Object.assign`) ; méthode d'une liste qui la modifie, prise sur `Array.prototype` ou sur une
  // liste vide écrite (`Array.prototype.push`, `[].splice`) : `Array.prototype.nom` — sinon null
  function nomDeFonction(e: any): string | null {
    if (e?.type !== 'MemberExpression' || e.computed) return null
    const o = e.object
    if (o.type === 'Identifier') return `${o.name}.${e.property.name}`
    const liste = (o.type === 'MemberExpression' && !o.computed && o.object.type === 'Identifier' && o.object.name === 'Array' && o.property.name === 'prototype') || (o.type === 'ArrayExpression' && o.elements.length === 0)
    return liste && MUTATIVE_METHODS.Array.has(e.property.name) ? `Array.prototype.${e.property.name}` : null
  }
  // objet que modifie ou fige un appel (cf. premierGarde, appelInvisible) : premier argument d'une fonction qui modifie ou fige ce qu'elle
  // reçoit (cf. ECRIT_LE_PREMIER, FIGE_LE_PREMIER), écrit tel quel, premier élément d'une liste écrite étalée (`Object.assign(...[o], …)`),
  // ou passé par `call`, `apply`, `Reflect.apply` (`Object.assign.apply(null, [o, …])`, `Reflect.apply(Object.assign, null, [o, …])`) ;
  // objet sur lequel `call`, `apply` ou `Reflect.apply` appelle une méthode d'une liste qui la modifie (`Array.prototype.push.call(o, v)`).
  // Rend le nom de la fonction et l'objet, null sinon
  function cibleModifiee(node: any): { nom: string, cible: any } | null {
    const c  = node.callee
    let nom  = nomDeFonction(c)
    let fn   = c
    let soi  = null
    let args = node.arguments
    if (nom === 'Reflect.apply') {
      fn   = node.arguments[0]
      nom  = nomDeFonction(fn)
      soi  = node.arguments[1]
      args = node.arguments[2]?.type === 'ArrayExpression' ? node.arguments[2].elements : null
    }
    else if (!nom && c?.type === 'MemberExpression' && !c.computed && (c.property.name === 'call' || c.property.name === 'apply')) {
      fn   = c.object
      nom  = nomDeFonction(fn)
      soi  = node.arguments[0]
      args = c.property.name === 'call' ? node.arguments.slice(1) : node.arguments[1]?.type === 'ArrayExpression' ? node.arguments[1].elements : null
    }
    if (!nom) return null
    // méthode d'une liste : l'objet de l'appel
    if (nom.startsWith('Array.prototype.')) return fn !== c && soi && soi.type !== 'SpreadElement' ? { nom, cible: soi } : null
    if (!(ECRIT_LE_PREMIER.test(nom) || FIGE_LE_PREMIER.test(nom)) || !args) return null
    let a0 = args[0]
    if (a0?.type === 'SpreadElement' && a0.argument.type === 'ArrayExpression') a0 = a0.argument.elements[0]
    return a0 && a0.type !== 'SpreadElement' ? { nom, cible: a0 } : null
  }
  // objet que modifie ou fige un appel (cf. cibleModifiee), pris dans le magasin, ou dans l'état local avec le réglage `proxy: false` :
  // passé par `µ._mjs_storeSur` (magasin) ou `µ._mjs_deepSur`, qui refusent un prototype ou une fonction du navigateur
  // (`Object.assign($$t.find(f).constructor, …)`) — la fonction reçoit alors un objet gelé, et échoue comme avec l'enveloppe
  function premierGarde(node: any): void {
    const a0 = cibleModifiee(node)?.cible
    if (!a0) return
    const store = findRoot(a0)
    const root  = store !== null && store !== SOFT && store !== NO_KEY ? LOCALE + '$' + store : racineGardee(a0)
    const texte = root ? morceau(a0.start, a0.end) : null
    if (texte === null) return
    ms.overwrite(a0.start, a0.end, objetGarde(root!, a0, clesGardees(a0, texte, a0.start, a0.end, aideCle(root!)), true))
    changed = true
  }
  // appel qui peut modifier l'état local sans passer par une aide : fonction qui modifie son premier argument ; appel dont la valeur
  // n'est pas lue (appelé pour son effet) — méthode inconnue d'un objet de l'état, rappel venu d'ailleurs qui reçoit ses éléments,
  // objet de l'état passé en argument. Une méthode qui modifie une liste, une Map, un Set ou une Date est compilée
  function appelInvisible(node: any, ancestors: any[]): void {
    const c     = node.callee
    const objet = c.type === 'MemberExpression' && !c.computed ? (c.object.type === 'Identifier' ? c.object.name : c.object.type === 'ThisExpression' ? 'this' : null) : null
    const nomFn = c.type === 'Identifier' ? c.name : objet ? `${objet}.${c.property.name}` : null
    const a0    = node.arguments[0]
    // fonction qui modifie ce qu'elle reçoit, appelée par son nom, par `call`, `apply` ou `Reflect.apply` (cf. cibleModifiee)
    const cm    = cibleModifiee(node)
    if (cm && !FIGE_LE_PREMIER.test(cm.nom)) {
      const r = racineLocale(cm.cible)
      if (r) avis.push({ at: node.start, forme: 2, nom: cm.nom, racine: '$' + r })
      return
    }
    if (!writeValueUnused(ancestors) || (nomFn && SANS_ECRITURE_FN.test(nomFn))) return
    const r = c.type === 'MemberExpression' && !c.computed ? racineLocale(c.object) : null
    if (r) {
      const m = c.property.name
      if (CALLBACK_METHODS.has(m)) {
        if (a0 && a0.type !== 'SpreadElement' && !isFunction(a0)) avis.push({ at: node.start, forme: 5, nom: js.slice(a0.start, a0.end), racine: '$' + r })
      }
      else if (!ALL_MUTATIVE.has(m) && !SANS_ECRITURE.has(m)) avis.push({ at: node.start, forme: 3, nom: m, racine: '$' + r })
      return
    }
    // méthode d'une liste, d'une Map ou d'un Set appelée sur une copie qui garde les objets de l'état (`l = Array.from($l)`, puis
    // `l.splice(i, 0, t)`) : elle range ou lit l'objet reçu, sans le modifier — aucun avertissement
    if (c.type === 'MemberExpression' && !c.computed && (ALL_MUTATIVE.has(c.property.name) || SANS_ECRITURE.has(c.property.name)) && racineCopie(c.object)) return
    for (const a of node.arguments) {
      const ra = racineLocale(a.type === 'SpreadElement' ? a.argument : a)
      if (ra) {
        avis.push({ at: node.start, forme: 4, nom: nomFn ?? js.slice(c.start, c.end), racine: '$' + ra })
        return
      }
    }
  }
  // variable de la tête d'une boucle du script (cf. ForOfStatement)
  let tetes = 0

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
      // telles quelles ; celles du magasin et de l'état local profond (`$.o.k`) passent par les aides (cf. parLesAides).
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
          if (!cheminMagasin(node, ancestors)) emitAssign(ms, js, node, ancestors, t)
          changed = true
        }
        else if (t && objetSurPlace(ms, target, root!)) changed = true
        else ecritureInvisible(node, ancestors, target.object)
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
      // l'état local aussi, avec ou sans l'enveloppe : cf. parLesAides ; une clé qui agit, relue, passe par un paramètre (cf.
      // pathTargetRead), qu'une valeur de droite avec `yield` ne peut pas recevoir
      if (isCompound) {
        if (!parLesAides(tp)) return
        const wait = suspension(node.right)
        if ((wait === 'yield' && agit(tp)) || !parGarde(node, ancestors, tp, (anc) => emitAssign(ms, js, node, anc, pathTargetRead(tp, target, wait === 'await')))) return ecritureInvisible(node, ancestors, target.object)
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
      if (!parGarde(node, ancestors, tp, (anc) => emitAssign(ms, js, node, anc, pathTarget(tp, '')))) return ecritureInvisible(node, ancestors, target.object)
      changed = true
    },

    // tête d'une boucle qui écrit un champ de l'état local (`for ($.o.k of l)`, `for ($.o.k in o)`) : une variable de la boucle, écrite
    // dans le champ par l'aide au début de chaque tour — `for (const _mjs_fN of l) { µ._mjs_deepSet(_mjsThis, ["o", "k"], _mjs_fN); … }`
    ForOfStatement: teteDeBoucle,
    ForInStatement: teteDeBoucle,

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
      const tp   = getPath(target, true)
      const bloc = instructionSeule(ancestors)
      if (!tp) {
        const root = findRoot(target.object)
        const wait = root ? suspension(target) : null
        const t    = root && wait !== 'yield' ? foundTarget(target, root, true, wait === 'await') : null
        if (t) {
          emitUpdate(ms, node, ancestors, t, !!bloc)
          if (bloc) poserBloc(ms, bloc)
          changed = true
        }
        else ecritureInvisible(node, ancestors, target.object, bloc)
        return
      }
      // l'état local aussi, avec ou sans l'enveloppe : cf. parLesAides
      if (!parLesAides(tp)) return

      // valeur non lue (instruction seule…) : forme DIRECTE, qui commence par `µ` — les formes fidèles
      // commencent par `(` et Civet n'écrit pas de point-virgule : posées après une autre ligne, elles
      // étaient lues comme l'appel de cette ligne (« … is not a function » au clic). Même règle que
      // l'état local (transform-reactive.ts).
      // l'opérateur de JavaScript sur `_mjs_n`, qui reçoit la valeur lue une seule fois : même conversion que le langage (un
      // `BigInt` reste un `BigInt`, `'5'` donne 6), comme l'état local (transform-reactive.ts). Instruction seule : le bloc qui
      // déclare `_mjs_n` se pose après la garde, autour d'elle. Cf. emitUpdate
      if (!parGarde(node, ancestors, tp, (anc) => emitUpdate(ms, node, anc, pathTargetRead(tp, target), !!bloc))) return ecritureInvisible(node, ancestors, target.object, bloc)
      if (bloc) poserBloc(ms, bloc)
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
      if (sansProxy) appelInvisible(node, ancestors)
      premierGarde(node)
      if (callee?.type !== 'MemberExpression') return
      // clé calculée (`$o.m[push]()`) : la méthode est celle que nomme la valeur de la clé, pas le nom écrit entre les
      // crochets — l'appel reste tel quel
      if (callee.computed) return
      const methodName = callee.property?.name
      // accesseur défini sur un objet du magasin atteint sans chemin (cf. DEFINIT_L_OBJET) : son aide gardée
      const definit    = DEFINIT_L_OBJET.has(methodName)
      if (!methodName || !(ALL_MUTATIVE.has(methodName) || definit)) return
      // LIMITE CONNUE — la réécriture ne teste
      // QUE le NOM de méthode (`ALL_MUTATIVE`), jamais le TYPE : `$.form.set(k,v)`
      // / `$.o.add(y)` / `$.o.clear()` sur un OBJET MÉTIER à méthode homonyme (pas
      // un vrai Map/Set) partent aussi en `µ._mjs_deepCall`. Choix CONSERVATEUR assumé :
      // prouver la collection-ité exigerait l'info de type de l'analyzer (indispo
      // ici, coûteux) ; le runtime `µ._mjs_deepCall` + le filet Proxy `_mjs_wrapDeep`
      // absorbent le cas. Documenté plutôt que restreint (restreindre ferait perdre
      // la notification compilée sur de vrais Map/Set aliasés).

      const tp   = definit ? null : getPath(callee.object, true)
      // sans chemin : méthode appelée à travers un objet du magasin (`µ.store.t.find(f).tags.push(x)`, cf. findRoot)
      const root = tp ? null : findRoot(callee.object) ?? (definit ? null : racineGardee(callee.object))
      const p    = root ? foundParts(callee, aideCle(root)) : null
      if (!tp && !p) {
        if (!definit) invisible(callee.object, node.start)
        return
      }
      // objet de l'état local (cf. racineGardee) : averti, son nom réservé écrit dans le code nommé par le refus (cf. objetGarde)
      if (p && root![0] === LOCALE) {
        invisible(callee.object, node.start)
        p.obj = objetGarde(root!, callee.object, p.obj)
      }

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
      const tail = tp ? ')' : onTail(root!, ctorWritten(callee.object))

      // méthode d'une `Date` sur un chemin de l'état local : un nom que porte aussi un objet à soi (lecteur, calendrier) — compilée
      // seulement si l'objet est une Date, sinon l'appel tel qu'écrit, sa méthode recevant l'objet de JavaScript (avec l'enveloppe, ses
      // écritures d'après un `await` restent vues). Dans une chaîne `?.`, par une clé qui agit ou lue en tête d'instruction : telle quelle
      const dateSeule = tp?.origin === 'local' && MUTATIVE_METHODS.Date.has(methodName)
      if (dateSeule && (chaine || agit(tp!) || (asiGuard(ancestors) && !writeValueUnused(ancestors)))) return invisible(callee.object, node.start)
      // méthode d'une liste, d'une Map ou d'un Set sur un chemin de l'état local, avec l'enveloppe : un nom que porte aussi un objet à
      // soi (panier, file d'attente) — compilée seulement pour ce que l'enveloppe ne range pas comme un objet ordinaire (liste, Map, Set,
      // liste typée…), sinon l'appel tel qu'écrit, sur l'enveloppe, qui voit les écritures de la méthode, celles d'après un `await`
      // comprises. Sans l'enveloppe (`proxy: false`), dans une chaîne `?.`, par une clé qui agit ou lue en tête d'instruction : compilée
      // pour tout objet, comme avant (elle prévient après la méthode)
      const objetSeul = !sansProxy && !dateSeule && tp?.origin === 'local' && !(chaine || agit(tp!) || (asiGuard(ancestors) && !writeValueUnused(ancestors)))
      const args = node.arguments ?? []
      const appel = () => {
        const tel = dateSeule || objetSeul ? ms.slice(node.start, node.end) : ''
        if (args.length === 0) {
          ms.overwrite(node.start, node.end, `${avant}${head}'${methodName}', []${tail}`)
        } else {
          // Bordures uniquement (cf. AssignmentExpression) : les arguments
          // restent en place, leurs édits imbriqués survivent — leurs parenthèses aussi
          // (`$liste.push((a, b))` pousse UN élément) : la réécriture s'arrête à la parenthèse
          // ouvrante de l'appel et reprend à sa fermante, la dernière du nœud.
          ms.overwrite(node.start, js.indexOf('(', callee.end) + 1, `${avant}${head}'${methodName}', [`)
          ms.overwrite(node.end - 1, node.end, ']' + tail)
        }
        if (dateSeule) {
          // test posé à DROITE de `node.start` : argument d'un autre appel (`$d.setTime($e.setDate(1))`), à gauche il tombait avec la
          // bordure que l'appel extérieur réécrit (cf. objetSeul)
          ms.prependRight(node.start, `${tp!.guard ? '' : asiGuard(ancestors)}(${js.slice(callee.object.start, callee.object.end)} instanceof Date ? `)
          ms.appendLeft(node.end, ` : ${tel})`)
        }
        else if (objetSeul) {
          // l'objet relu par `_mjsThis._state`, l'objet que le code appelle `$` : ni le test ni l'appel ne sont une lecture pour les
          // dépendances d'un `µeffect` (effect-deps.ts), pas plus que l'appel compilé. Le test posé à DROITE de `node.start`, sur l'appel
          // lui-même : argument d'un autre appel (`$l.push($l.shift())`), à gauche il tombait avec la bordure que l'appel extérieur réécrit
          const lu = (texte: string) => texte[0] === '$' ? '_mjsThis._state' + texte.slice(1) : texte
          ms.prependRight(node.start, `${tp!.guard ? '' : asiGuard(ancestors)}(Object.prototype.toString.call(${lu(js.slice(callee.object.start, callee.object.end))}) !== '[object Object]' ? `)
          ms.appendLeft(node.end, ` : ${lu(tel)})`)
        }
      }
      // élément de liste (cf. parGarde) : jamais dans une chaîne `?.`, dont le texte ne part pas de `$`
      if (!tp || !parGarde(node, ancestors, tp, appel)) {
        if (tp) return ecritureInvisible(node, ancestors, callee.object)
        appel()
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
        const root = tp ? (tp.origin === 'local' ? racineGardee(m.object) : null) : findRoot(m.object) ?? racineGardee(m.object)
        const p    = root ? foundParts(m, aideCle(root)) : null
        const wait = p ? suspension(m) : null
        // objet de l'état local, réglage `proxy: false` (cf. racineGardee) : averti, son nom réservé écrit dans le code nommé (cf. objetGarde)
        if (p && root![0] === LOCALE) {
          invisible(m.object, node.start)
          p.obj = objetGarde(root!, m.object, p.obj)
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
        const p    = root ? foundParts(target, aideCle(root)) : null
        if (p) {
          ms.overwrite(node.start, node.end, `${onHead('Delete', root!)}${p.obj}, ${p.key}${onTail(root!, ctorWritten(target.object))}`)
          changed = true
        }
        else ecritureInvisible(node, ancestors, target.object)
        return
      }
      if (tp.path.length < 1) return
      if (!parGarde(node, ancestors, tp, () => ms.overwrite(node.start, node.end, tp.origin === 'local' ? `µ._mjs_deepDelete(_mjsThis, ${pathToJsLiteral(tp.path)})` : storeDelete(tp.path)))) return ecritureInvisible(node, ancestors, target.object)
      changed = true
    },
  })

  // cf. ForOfStatement : un champ de l'état local (profondeur 2 et plus), ni élément de liste ni clé qui agit ; un champ d'un objet du
  // magasin ou de l'état local que la passe ne compile pas (`for ($.l.find(f)[k].x of l)`, cf. foundTarget), par l'aide gardée
  function teteDeBoucle(node: any): void {
    const m    = node.left.type === 'MemberExpression' ? node.left : null
    const tp   = m ? getPath(m) : null
    const root = m && !tp ? findRoot(m.object) ?? racineGardee(m.object) : null
    const t    = root && !suspension(m) ? foundTarget(m, root, false) : null
    if (!t && (!tp || tp.origin !== 'local' || tp.path.length < 2 || agit(tp))) return
    if (t && root![0] === LOCALE) invisible(m.object, m.start)
    const v     = `_mjs_f${++tetes}`
    const ecrit = `${t ? t.set : pathTarget(tp!, '').set}${v}${t?.tail ?? ')'};`
    ms.overwrite(node.left.start, node.left.end, `const ${v}`)
    if (node.body.type === 'BlockStatement') ms.appendLeft(node.body.start + 1, ` ${ecrit}`)
    else {
      ms.prependRight(node.body.start, `{ ${ecrit} `)
      ms.appendLeft(node.body.end, ' }')
    }
    changed = true
  }

  const r = passResult(ms, js, changed, 'path-tracker')
  return avis.length ? { ...r, avis } : r
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
