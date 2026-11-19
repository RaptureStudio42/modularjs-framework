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
//
// DOUTE — un composant redessiné parce qu'un état partagé a changé (`µurl`, `µnav`, un `µ.state`, un `µStore`, un contexte `§§x`) ne fait
// passer, parmi ses reffets qui ont noté leurs lectures, que ceux qui ont lu cet état pendant leur dernier passage (runtime/mjs_signals.ts,
// µ._mjs_uRead). Le passage ne note que ce qu'il lit lui-même : le code qui peut tourner APRÈS lui échappe à la note. Le relevé le juge donc
// ici, et dit le doute par un 3e argument (`µ.effect(f, [...], 1)`) : le reffet passe alors à chaque rendu demandé par un état partagé,
// comme tous le faisaient.
//
// LA RÈGLE — le reffet ne reste précis que si tout son code d'après coup tient dans la LISTE BLANCHE ci-dessous. Est d'après coup : le
// corps de toute fonction écrite dans le reffet (rappel, minuterie, promesse, écouteur), sauf celle qu'il appelle sur place et celle qu'il
// rend (son nettoyage, qui ne dit jamais quand repartir) ; ce qui suit le premier `await` ; une fonction génératrice ; et, parcourus à leur
// tour, le corps d'une fonction du script ou d'une méthode du composant appelée de là ou passée par son nom.
//
// LA LISTE BLANCHE (aucune de ces formes n'appelle du code de l'appli, donc aucune ne peut lire un état partagé) :
// - une constante : nombre, texte, booléen, `null`, `undefined`, expression régulière, gabarit de texte sans `${…}` ;
// - `$.x`, clé écrite en toutes lettres qui n'est pas une valeur dérivée, et la clé du magasin `µ.store.x` — la valeur seule : rien n'y
//   est lu plus bas (`$.x.y`), elle n'est ni appelée (`$.f()`), ni convertie ; le piège de lecture de l'enveloppe racine rend ce qui est
//   rangé sans appeler de code de l'appli (seule une valeur dérivée relance un calcul : elle est exclue ; un script qui prend l'état
//   entier comme une valeur — `Object.defineProperty($, …)`, `s = $` — a pu y poser un accesseur : `$.x` n'y est plus de la liste) ;
// - une variable locale dont TOUTES les affectations sont de cette liste (née d'une valeur simple), ou sont des fonctions écrites sur
//   place (leur corps est jugé à son tour) ; le paramètre d'une fonction appelée sur place, qui tient la valeur de son argument ;
// - `!x`, `typeof x`, `void x`, `a === b`, `a !== b`, `a && b`, `a || b`, `a ?? b`, `c ? a : b`, `a, b` : aucune conversion ; un calcul
//   (`+`, `<`, `==`…) seulement entre constantes — sur une valeur, il appellerait sa conversion (`toString`, `valueOf`) ;
// - l'écriture d'une variable `$` ou d'une clé du magasin par l'aide du compilateur (`µ._set`, `µ._storeSet`), d'une variable locale ;
// - un tableau ou un objet écrits sur place (ni étalement, ni clé calculée, ni accesseur) ;
// - `if`, `switch`, `while`, `for (;;)`, `try`, `throw`, `return`, les blocs ; `await` d'une constante ;
// - l'appel d'une fonction écrite sur place, d'une variable locale qui ne tient que des fonctions, d'une fonction du script affectée UNE
//   seule fois dans tout le script, d'une méthode du composant posée une seule fois (`this.m = function…`) — leur corps est parcouru comme
//   du code d'après coup —, de `µ.after` et `µ.every`, et des minuteries du navigateur que le script ne masque pas (hors du rappel,
//   leurs arguments sont des constantes : un délai pris dans une valeur serait converti).
// Tout le reste met dans le doute : un nom libre (import, variable du script, fonction du script réaffectée, `window`, `document`,
// `console`, `Math`…), un paramètre, `this.x`, `µ.x` hors de ces aides, toute lecture `objet.champ`, tout autre appel, `new`, un
// étalement, `in`, `instanceof`, `delete`, une boucle `for … of`, un gabarit de texte avec `${…}`.
//
// LE RAPPEL PASSÉ PAR SON NOM — à un point de report connu (`µafter`, `µevery`, `.then`, `.catch`, `.finally`, `addEventListener`, `.on`,
// `.once`, `.subscribe`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, `queueMicrotask`), ce qui tient la
// place du rappel est une fonction écrite sur place, une variable locale qui ne tient que des fonctions, une fonction du script ou une
// méthode affectées une seule fois (parcourues comme du code d'après coup) ; sinon doute (`µafter 5, $rappel`, `µafter 5, fonctionImportee`).
// Partout, une fonction du script ou une méthode nommée comme valeur est parcourue comme du code d'après coup ; réaffectée, doute.
//
// PENDANT LE PASSAGE, trois lectures que la note ne voit pas mettent aussi dans le doute : l'adresse lue hors de `µurl` (`location`,
// `history`, `window.location`, `document.URL`), qui change avec la navigation ; une clé calculée de l'état (`$[k]`) ; le test
// `k in objet`.
//
// L'APPEL DU PASSAGE — ce que le reffet appelle pendant son passage (appel, `new`, gabarit étiqueté) lit sous la note, mais peut aussi
// remettre une lecture à plus tard. L'appelé est donc TROUVÉ ET JUGÉ, ou DU DEHORS, sinon c'est le doute.
// - Trouvé : une fonction écrite sur place ; une variable locale qui ne tient que des fonctions écrites sur place ; une fonction du script
//   ou une méthode du composant affectées une seule fois ; une méthode appelée par son nom (`objet.nom()`, `window.nom()`, `nom()` d'un nom
//   que le script ne lie pas) quand toutes les valeurs que le script range sous cette clé sont des fonctions écrites sur place (objet
//   littéral, méthode de classe, `x.nom = function…`, `Object.defineProperty(x, 'nom', { value: … })`, écriture profonde d'une variable
//   `$`) ; une classe du script déclarée une fois, sans classe mère, dont les champs sont des constantes ou des fonctions (`new C()` :
//   son constructeur). Jugé : son corps est parcouru comme celui d'un reffet — ce qu'il fait sur place est du passage, ce qu'il pose pour
//   plus tard est du code d'après coup, tenu à la liste blanche ; ses propres appels suivent cette même règle.
// - Du dehors (le code que MJS ne voit pas, non suivi) : une fonction importée, un nom que le script ne lie nulle part (langage,
//   navigateur), une aide du cœur `µ.x()`, une méthode dont le script ne range la clé nulle part (`liste.map()`, `texte.trim()`,
//   `Math.max()`, `document.querySelector()`, méthode de l'élément).
// - Doute, pour tout le reste : un nom du script qui n'est pas une fonction affectée une seule fois (fonction fabriquée par une autre,
//   réaffectée, instance appelée) ; la valeur d'une variable `$` ou d'une clé du magasin (`$f()`) ; une méthode du composant posée
//   autrement que par une fonction écrite sur place, ou deux fois ; une clé sous laquelle le script range autre chose qu'une fonction
//   écrite sur place (`o.k = fabrique()`, `{ k: autre }`) ; un appel calculé (`o[k]()`), le résultat d'un appel (`f()()`), un paramètre,
//   une variable locale qui tient autre chose ; `f.call(…)`, `f.apply(…)`, `f.bind(…)` valent l'appel de `f` ; une clé que le script pose
//   par un accesseur (`get nom()`, descripteur `{ get }`), dont la valeur rendue n'est pas lue (`boite.nom()`) ; et toute méthode appelée
//   par son nom dès que le script range une valeur qui peut être une fonction sous une clé calculée (`o[k] = f`, `{ [k]: f }`). Un motif
//   qui écrit dans un membre (`{ a: o.k } = x`, `[o[i]] = x`, `for (o.k of liste)`) y range une valeur non lue, sous sa clé. Dans une
//   fonction trouvée par sa clé, `this.m()` compte aussi par sa clé.
// CE QUE LE SCRIPT FAIT TOURNER SANS APPEL ÉCRIT — un accesseur (`get`, `set`, descripteur de `Object.defineProperty`), une conversion ou
// une suite de promesse (`toString`, `valueOf`, `toJSON`, `then`), une fonction rangée sous une clé calculée (`[Symbol.iterator]`) — est
// jugé de même, une fois pour le script : si l'un d'eux remet à plus tard du code hors de la liste blanche, ou si le script nomme un
// détour que le relevé ne lit pas (`Proxy`, `Reflect`, `defineProperties`, `setPrototypeOf`, `__proto__`, `__defineGetter__`,
// `__defineSetter__`, un descripteur qui n'est pas écrit sur place, `Object.create(modèle, descripteurs)`), tous ses reffets sont dans le
// doute.
// HORS DE LA RÈGLE : ce qu'une fonction du dehors (importée, d'un `<script module>`, d'un autre composant, rangée sur `µ`, du langage)
// remet elle-même à plus tard, ou fait d'un rappel qu'on lui passe par son nom, n'est pas vu : même limite que pour une clé `$$x`. Dans
// une fonction du script appelée sur un autre objet (`f.call(o)`, `f.apply(o)`), `this.m()` est jugé comme la méthode `m` du composant.

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

// l'adresse de la page lue hors de `µurl` : par son nom (`location`, `history`), ou sur la fenêtre et le document (`window.location`, `document.URL`)
const ADDRESS         = new Set([ 'location', 'history' ])
const ADDRESS_MEMBERS = new Set([ 'location', 'history', 'URL', 'documentURI' ])
const WINDOWS         = new Set([ 'window', 'document', 'globalThis', 'self' ])

// points de report connus (en-tête, LE RAPPEL PASSÉ PAR SON NOM) : runes du cœur (`µ.after(_mjsThis, délai, rappel)` : le rappel en dernier),
// fonctions du navigateur (le rappel en premier), méthodes d'une promesse, d'une cible d'événements, d'un émetteur
const REPORTS_MU       = new Set([ 'after', 'every' ])
const GLOBAL_DEFERRALS = new Set([ 'setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask' ])
const MEMBER_DEFERRALS = new Set([ 'then', 'catch', 'finally', 'on', 'once', 'subscribe' ])
// fonctions du navigateur qu'un code d'après coup peut appeler : les minuteries et leurs arrêts
const SAFE_GLOBALS  = new Set([ ...GLOBAL_DEFERRALS, 'clearTimeout', 'clearInterval', 'cancelAnimationFrame', 'cancelIdleCallback' ])
// aides du cœur qu'un code d'après coup peut appeler : l'écriture d'une variable `$` (`µ._set(_mjsThis, 'x', v)`), d'une clé du magasin
// (`µ._storeSet('x', v)`), et les deux minuteries
const MU_HELPERS  = new Set([ '_set', '_storeSet', ...REPORTS_MU ])
const ASSIGNMENTS = new Set([ '=', '||=', '&&=', '??=' ])
// ce que le langage appelle de lui-même sur un objet : une conversion, la suite d'une promesse
const IMPLICIT_KEYS = new Set([ 'toString', 'valueOf', 'toJSON', 'then' ])
// noms qui posent un accesseur ou détournent un objet sans que le relevé puisse lire lequel
const DETOURS         = new Set([ 'Proxy', 'Reflect', 'defineProperties', 'setPrototypeOf', '__proto__', '__defineGetter__', '__defineSetter__' ])
// appel d'une fonction par l'une de ses propres méthodes : l'appelé est la fonction elle-même
const BY_METHOD     = new Set([ 'call', 'apply', 'bind' ])

// ce que l'appel du passage demande au script entier (en-tête, L'APPEL DU PASSAGE) : sous quelle clé il range une fonction (`writers` :
// pour chaque clé, les valeurs écrites — la fonction écrite sur place, ou `null` pour une valeur que le relevé ne lit pas), ses classes,
// ce qu'il fait tourner sans appel écrit (`implicites`), les noms qu'il lie et ceux qu'il importe, une clé calculée qui reçoit une valeur
// qui peut être une fonction (`calculee`), un détour que le relevé ne lit pas (`detour`)
interface Callables {
  writers: Map<string, any[]>
  classes: Map<string, any[]>
  implicit: any[]
  bound: Set<string>
  imported: Set<string>
  computed: boolean
  detour: boolean
}

// la valeur `v` peut-elle être une fonction ? Une constante, un calcul, un objet ou un tableau écrits sur place n'en sont pas une
function canBeCalled(v: any): boolean {
  switch (v?.type) {
    case undefined: case 'Literal': case 'TemplateLiteral': case 'ObjectExpression': case 'ArrayExpression': case 'BinaryExpression':
    case 'UnaryExpression': case 'UpdateExpression': case 'NewExpression':
      return false
    default: return true
  }
}
// clé écrite en toutes lettres par le nœud `n` (nom, texte ; un nombre quand la clé n'est pas calculée), sinon null
function keyOf(n: any, computed: boolean): string | null {
  if (n?.type === 'Literal') return typeof n.value === 'string' || !computed ? String(n.value) : null
  return !computed && n?.type === 'Identifier' ? n.name : null
}

// ce que la liste blanche demande au script entier : ses valeurs dérivées, les noms de son premier niveau, ses fonctions et ses méthodes
// affectées une seule fois, le jugement d'une méthode passée par son nom, et « ce nœud tourne-t-il après le passage ? »
interface Blank {
  stateAsValue: boolean
  derives: Set<string>
  names: Set<string>
  safeFunction: (name: string) => boolean
  safeMethod: (name: string) => boolean
  lateMethod: (name: string) => boolean
  late: (anc: any[]) => boolean
}

// noms que pose le motif `m` (paramètre, déclaration, cible d'une décomposition)
function namesInPattern(m: any, s: Set<string>): void {
  if (!m) return
  if (m.type === 'Identifier') s.add(m.name)
  else if (m.type === 'ObjectPattern') for (const q of m.properties) namesInPattern(q.type === 'RestElement' ? q.argument : q.value, s)
  else if (m.type === 'ArrayPattern') for (const q of m.elements) namesInPattern(q, s)
  else if (m.type === 'AssignmentPattern') namesInPattern(m.left, s)
  else if (m.type === 'RestElement') namesInPattern(m.argument, s)
}

// noms que déclare la fonction `f` : ses paramètres (celui d'un `catch` compris) et ses variables locales, fonctions imbriquées exclues
const declarations = new WeakMap<any, { params: Set<string>, locales: Set<string> }>()
function declare(f: any): { params: Set<string>, locales: Set<string> } {
  let d = declarations.get(f)
  if (d) return d
  d = { params: new Set(), locales: new Set() }
  const dd = d
  for (const q of f.params || []) namesInPattern(q, dd.params)
  if (f.id?.name && f.type !== 'FunctionDeclaration') dd.locales.add(f.id.name)
  walk.recursive(f.body, null, {
    Function(n: any) {
      if (n.type === 'FunctionDeclaration' && n.id?.name) dd.locales.add(n.id.name)
    },
    VariableDeclarator(n: any, st: any, c: any) {
      namesInPattern(n.id, dd.locales)
      if (n.init) c(n.init, st, 'Expression')
    },
    CatchClause(n: any, st: any, c: any) {
      namesInPattern(n.param, dd.params)
      c(n.body, st, 'Statement')
    },
    ClassDeclaration(n: any) {
      if (n.id?.name) dd.locales.add(n.id.name)
    },
  } as any)
  declarations.set(f, d)
  return d
}

// à qui est le nom `nom` lu par le dernier nœud de `anc` : paramètre ou variable locale d'une fonction qui l'entoure (`f`, à la place `i`
// de `anc`), sinon nom libre — premier niveau du script, import, ou nom du navigateur
function resolve(name: string, anc: any[]): { kind: 'param' | 'local' | 'free', f?: any, i: number } {
  for (let i = anc.length - 2; i >= 0; i--) {
    const a = anc[i]
    if (a.type !== 'FunctionExpression' && a.type !== 'ArrowFunctionExpression' && a.type !== 'FunctionDeclaration') continue
    const d = declare(a)
    if (d.params.has(name)) return { kind: 'param', f: a, i }
    if (d.locales.has(name)) return { kind: 'local', f: a, i }
  }
  return { kind: 'free', i: -1 }
}

// toutes les valeurs données au nom `nom` dans la fonction `f`, fonctions imbriquées comprises ; `null` : une écriture qui n'est pas une
// affectation simple (`+=`, `++`, décomposition, variable d'une boucle `for … of`)
const NO_VALUE = { type: 'Literal' }
function assignments(f: any, name: string): any[] {
  const vs: any[] = []
  const inside = (m: any): boolean => {
    const s = new Set<string>()
    namesInPattern(m, s)
    return s.has(name)
  }
  walk.ancestor(f.body, {
    VariableDeclarator(d: any, _s: any, anc: any[]) {
      if (!inside(d.id)) return
      const loop = anc[anc.length - 3]
      if (d.id.type !== 'Identifier' || ((loop?.type === 'ForOfStatement' || loop?.type === 'ForInStatement') && loop.left === anc[anc.length - 2])) vs.push(null)
      else vs.push(d.init || NO_VALUE)
    },
    AssignmentExpression(a: any) {
      if (a.left?.type === 'Identifier') { if (a.left.name === name) vs.push(ASSIGNMENTS.has(a.operator) ? a.right : null) }
      else if (a.left?.type !== 'MemberExpression' && inside(a.left)) vs.push(null)
    },
    UpdateExpression(u: any) {
      if (u.argument?.type === 'Identifier' && u.argument.name === name) vs.push(null)
    },
    ForOfStatement(s: any) {
      if (s.left?.type !== 'VariableDeclaration' && inside(s.left)) vs.push(null)
    },
    ForInStatement(s: any) {
      if (s.left?.type !== 'VariableDeclaration' && inside(s.left)) vs.push(null)
    },
    FunctionDeclaration(d: any) {
      if (d.id?.name === name) vs.push(d)
    },
  } as any)
  return vs
}

const isFunction = (x: any): boolean => x?.type === 'FunctionExpression' || x?.type === 'ArrowFunctionExpression' || x?.type === 'FunctionDeclaration'
// clé écrite en toutes lettres du membre `m` (`o.x`, `o['x']`), sinon null
function writtenKey(m: any): string | null {
  if (!m.computed) return m.property?.type === 'Identifier' ? m.property.name : null
  return m.property?.type === 'Literal' && typeof m.property.value === 'string' ? m.property.value : null
}
// `$.x`, clé écrite en toutes lettres qui n'est pas une valeur dérivée
function isDollar(m: any, b: Blank): boolean {
  const k = m?.type === 'MemberExpression' && m.object?.type === 'Identifier' && m.object.name === '$' ? writtenKey(m) : null
  return k !== null && !b.stateAsValue && !b.derives.has(k)
}
// `µ.store.x`, clé écrite en toutes lettres
function isStoreKey(m: any): boolean {
  return m?.type === 'MemberExpression' && isStoreRoot(m.object) && writtenKey(m) !== null
}
// `µ.nom`, `nom` pris dans `noms`
function isMu(m: any, names: Set<string>): boolean {
  return m?.type === 'MemberExpression' && !m.computed && m.object?.type === 'Identifier' && m.object.name === 'µ' && names.has(m.property?.name)
}
// `this.m` ou `_mjsThis.m` : le nom de la méthode, sinon null
function methodOf(m: any): string | null {
  if (m?.type !== 'MemberExpression' || m.computed || m.property?.type !== 'Identifier') return null
  return m.object?.type === 'ThisExpression' || (m.object?.type === 'Identifier' && m.object.name === '_mjsThis') ? m.property.name : null
}

// la valeur `v`, donnée à une variable locale de la fonction `f`, est-elle de la liste blanche ?
function simpleValue(v: any, f: any, b: Blank, stack: Set<string>): boolean {
  if (!v) return false
  switch (v.type) {
    case 'Literal': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': return true
    case 'Identifier': return v.name === 'undefined' || localSimple(v.name, f, b, stack)
    case 'MemberExpression': return isDollar(v, b) || isStoreKey(v)
    case 'UnaryExpression': return (v.operator === '!' || v.operator === 'typeof' || v.operator === 'void') && simpleValue(v.argument, f, b, stack)
    case 'LogicalExpression': return simpleValue(v.left, f, b, stack) && simpleValue(v.right, f, b, stack)
    case 'ConditionalExpression': return simpleValue(v.test, f, b, stack) && simpleValue(v.consequent, f, b, stack) && simpleValue(v.alternate, f, b, stack)
    case 'BinaryExpression': return (v.operator === '===' || v.operator === '!==') && simpleValue(v.left, f, b, stack) && simpleValue(v.right, f, b, stack)
    case 'ParenthesizedExpression': case 'ChainExpression': return simpleValue(v.expression, f, b, stack)
    default: return false
  }
}
// la variable locale `nom` de la fonction `f` ne reçoit-elle que des valeurs de la liste blanche (née d'une valeur simple) ?
function localSimple(name: string, f: any, b: Blank, stack: Set<string>): boolean {
  if (!declare(f).locales.has(name)) return false
  if (stack.has(name)) return true
  stack.add(name)
  const ok = assignments(f, name).every((v) => simpleValue(v, f, b, stack))
  stack.delete(name)
  return ok
}
// la variable locale `nom` de la fonction `f` ne tient-elle que des fonctions écrites sur place ?
function localFunction(name: string, f: any): boolean {
  const vs = assignments(f, name).filter((v) => v !== NO_VALUE)
  return vs.length !== 0 && vs.every(isFunction)
}

// arguments de l'appel `n` qui tiennent la place d'un rappel, quand il s'adresse à un point de report connu
function callbacksOf(n: any): any[] {
  const c = n.callee, a = n.arguments || []
  if (c?.type === 'Identifier') return GLOBAL_DEFERRALS.has(c.name) ? a.slice(0, 1) : []
  if (c?.type !== 'MemberExpression' || c.computed) return []
  if (c.object?.type === 'Identifier' && c.object.name === 'µ') return REPORTS_MU.has(c.property?.name) ? a.slice(-1) : []
  if (c.property?.name === 'addEventListener') return a.slice(1, 2)
  return MEMBER_DEFERRALS.has(c.property?.name) ? a : []
}
// ce qui tient la place d'un rappel (`a`, argument de l'appel qui termine `anc`) est-il une fonction que le relevé juge : écrite sur place,
// variable locale qui ne tient que des fonctions, fonction du script ou méthode affectées une seule fois ? Une constante, un objet
// d'options, le résultat d'un calcul n'en sont pas un
function safeCallback(a: any, anc: any[], b: Blank): boolean {
  switch (a.type) {
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'Literal': case 'TemplateLiteral': case 'ObjectExpression': case 'BinaryExpression': case 'UnaryExpression': return true
    case 'Identifier': {
      if (a.name === 'undefined' || a.name === '_mjsThis') return true
      const r = resolve(a.name, [...anc, a])
      return r.kind === 'local' ? localFunction(a.name, r.f) : r.kind === 'free' && b.safeFunction(a.name)
    }
    case 'MemberExpression': {
      const m = methodOf(a)
      return m !== null && b.safeMethod(m) && b.lateMethod(m)
    }
    default: return false
  }
}

// LA LISTE BLANCHE (en-tête) : le nœud `n`, qui peut tourner après le passage, en est-il ? `sorte` : la place où le parcours le visite
// (`VariablePattern` : un nom déclaré ou écrit, pas lu)
function allowed(n: any, anc: any[], kind: string, b: Blank): boolean {
  const p = anc[anc.length - 2]
  switch (n.type) {
    case 'Literal': case 'TemplateElement': case 'EmptyStatement': case 'BlockStatement': case 'ExpressionStatement': case 'IfStatement':
    case 'ReturnStatement': case 'LogicalExpression': case 'ConditionalExpression': case 'SequenceExpression': case 'ParenthesizedExpression':
    case 'ChainExpression': case 'VariableDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration':
    case 'TryStatement': case 'CatchClause': case 'ThrowStatement': case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement':
    case 'BreakStatement': case 'ContinueStatement': case 'LabeledStatement': case 'SwitchStatement': case 'SwitchCase': case 'Property':
      return true
    case 'VariableDeclarator': return n.id?.type === 'Identifier'
    case 'TemplateLiteral': return n.expressions.length === 0
    case 'AwaitExpression': return n.argument?.type === 'Literal'
    case 'UnaryExpression': return n.operator === '!' || n.operator === 'typeof' || n.operator === 'void' || (n.operator !== 'delete' && n.argument?.type === 'Literal')
    case 'BinaryExpression': return n.operator === '===' || n.operator === '!==' || (n.operator !== 'in' && n.operator !== 'instanceof' && n.left?.type === 'Literal' && n.right?.type === 'Literal')
    case 'AssignmentExpression': return ASSIGNMENTS.has(n.operator) && (n.left?.type === 'Identifier' || isDollar(n.left, b) || isStoreKey(n.left))
    case 'ArrayExpression': return n.elements.every((e: any) => e !== null && e.type !== 'SpreadElement')
    case 'ObjectExpression': return n.properties.every((q: any) => q.type === 'Property' && q.kind === 'init' && !q.computed)
    case 'ThisExpression': return p?.type === 'MemberExpression' && p.object === n
    case 'Identifier': {
      if (kind === 'VariablePattern' || n.name === 'undefined') return true
      // `$`, `µ`, le composant : jugés par le membre qu'on y lit ; le composant, aussi en premier argument d'une aide du cœur
      if (n.name === '$' || n.name === 'µ') return p?.type === 'MemberExpression' && p.object === n
      if (n.name === '_mjsThis') return (p?.type === 'MemberExpression' && p.object === n) || (p?.type === 'CallExpression' && p.arguments[0] === n && isMu(p.callee, MU_HELPERS))
      const r = resolve(n.name, anc)
      // paramètre d'une fonction appelée sur place après coup : il tient la valeur de son argument, jugée à sa place ; tout autre
      // paramètre reçoit ce que lui passe un code que le relevé ne voit pas
      if (r.kind === 'param') return r.i > 0 && anc[r.i - 1].type === 'CallExpression' && anc[r.i - 1].callee === r.f && b.late(anc.slice(0, r.i))
      if (r.kind === 'local') return localSimple(n.name, r.f, b, new Set())
      if (b.safeFunction(n.name)) return true
      return p?.type === 'CallExpression' && p.callee === n && SAFE_GLOBALS.has(n.name) && !b.names.has(n.name)
    }
    case 'MemberExpression': {
      const lowest = p?.type === 'MemberExpression' && p.object === n
      const called = (p?.type === 'CallExpression' || p?.type === 'NewExpression') && p.callee === n
      if (isDollar(n, b) || isStoreKey(n)) return !lowest && !called && p?.type !== 'TaggedTemplateExpression' && p?.type !== 'UpdateExpression' && !(p?.type === 'UnaryExpression' && p.operator === 'delete')
      if (isStoreRoot(n)) return lowest && isStoreKey(p)
      if (isMu(n, MU_HELPERS)) return called && p.type === 'CallExpression'
      const m = methodOf(n)
      return m !== null && called && p.type === 'CallExpression' && b.safeMethod(m)
    }
    case 'CallExpression': {
      const c = n.callee
      let ok = isFunction(c) || isMu(c, MU_HELPERS)
      if (!ok && c.type === 'MemberExpression') {
        const m = methodOf(c)
        ok = m !== null && b.safeMethod(m)
      }
      if (!ok && c.type === 'Identifier') {
        const r = resolve(c.name, [...anc, c])
        ok = r.kind === 'local' ? localFunction(c.name, r.f) : r.kind === 'free' && (b.safeFunction(c.name) || (SAFE_GLOBALS.has(c.name) && !b.names.has(c.name)))
      }
      // une minuterie convertit son délai : hors du rappel, ses arguments sont des constantes (et le composant, premier argument des runes)
      const timer     = isMu(c, REPORTS_MU) || (c.type === 'Identifier' && SAFE_GLOBALS.has(c.name))
      const callbacks = callbacksOf(n)
      if (timer && !n.arguments.every((a: any) => callbacks.includes(a) || a.type === 'Literal' || (a.type === 'Identifier' && a.name === '_mjsThis'))) return false
      return ok && n.arguments.every((a: any) => a.type !== 'SpreadElement') && callbacks.every((a) => safeCallback(a, anc, b))
    }
    default: return false
  }
}

// vrai si la lecture `n` (MemberExpression), faite pendant le passage ou après, met le reffet dans le doute sans égard à la liste blanche :
// une clé calculée de l'état (`$[k]`), que le passage ne note pas, et l'adresse lue sur la fenêtre ou le document
function doubtfulRead(n: any): boolean {
  const o    = n.object
  const name = n.computed ? (n.property?.type === 'Literal' ? n.property.value : null) : n.property?.name
  if (o?.type === 'Identifier' && o.name === '$') return n.computed && typeof name !== 'string'
  return o?.type === 'Identifier' && WINDOWS.has(o.name) && ADDRESS_MEMBERS.has(name)
}

// vrai si le nœud (dernier de `anc`) est dans la fonction que le reffet `effet` REND, son nettoyage : elle ne joue qu'avant le passage
// suivant ou à la fin du composant, ce qu'elle lit ne dit jamais quand le reffet doit repartir
function inCleanup(anc: any[], effect: any): boolean {
  if (anc[0] !== effect) return false
  for (let i = 1; i < anc.length - 1; i++) {
    const f = anc[i]
    if (f.type !== 'FunctionExpression' && f.type !== 'ArrowFunctionExpression') continue
    const p = anc[i - 1]
    return (p.type === 'ReturnStatement' && p.argument === f) || (p === effect && effect.body === f)
  }
  return false
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
  const target = node.type === 'AssignmentExpression' ? node.left : node.argument
  if (target?.type === 'MemberExpression' && !target.computed && isStoreRoot(target.object) && target.property?.type === 'Identifier') return `$$${target.property.name}`
  return null
}

// vrai si le nœud (dernier de `anc`, chemin depuis la fonction parcourue `anc[0]`) peut s'exécuter APRÈS
// le passage synchrone de cette fonction : fonction génératrice, code d'une fonction async qui commence après son
// premier `await`, ou nœud placé dans une fonction imbriquée (rappel, minuterie, promesse, écouteur, nettoyage
// rendu) — sauf une fonction appelée sur place (`((_v) => …)(x)`, forme émise pour `$$x++`)
function afterwards(anc: any[]): boolean {
  const n = anc[anc.length - 1]
  for (let i = 0; i < anc.length - 1; i++) {
    const f = anc[i]
    if (f.type !== 'FunctionExpression' && f.type !== 'ArrowFunctionExpression' && f.type !== 'FunctionDeclaration') continue
    if (f.generator || (f.async && n.start >= firstAwaitEnd(f))) return true
    if (i > 0 && !(anc[i - 1].type === 'CallExpression' && anc[i - 1].callee === f)) return true
  }
  return false
}

// fin du premier `await` d'une fonction async, fonctions imbriquées exclues (Infinity sans `await`) : son argument
// est lu pendant le passage, ce qui commence après tourne plus tard ; une boucle `for await` compte dès son corps
const awaitEnds = new WeakMap<any, number>()
function firstAwaitEnd(f: any): number {
  const end = awaitEnds.get(f)
  if (end !== undefined) return end
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
  awaitEnds.set(f, min)
  return min
}

// vrai si la fonction `f` peut lire après son passage synchrone : async, génératrice, ou une fonction posée dans son corps
const afterwardsIn = new WeakMap<any, boolean>()
function readAfterwards(f: any): boolean {
  let r = afterwardsIn.get(f)
  if (r !== undefined) return r
  r = !!(f.async || f.generator)
  if (!r) walk.simple(f.body, { Function() { r = true } })
  afterwardsIn.set(f, r)
  return r
}

// ce que `collectReads` relève d'un effet, cf. son commentaire
interface Reads {
  reads: Set<string>
  syncReads: Set<string>
  syncDeps: Set<string>
  lateReads: Set<string>
  lateDeps: Set<string>
  excluded: Set<string>
  total: Set<string>
  writes: Set<string>
  doubt: boolean
}

// racines d'un dérivé (`computedDeps`), null pour un nom qui n'en est pas un
function rootsOf(derives: Record<string, string[]> | undefined, name: string): string[] | null {
  return derives && Object.prototype.hasOwnProperty.call(derives, name) ? derives[name] : null
}

// vrai si `node` lit la clé `cle` du store (`µ.store.cle`, à toute profondeur), elle-même ou par un dérivé
// calculé d'elle (`$.e`, `$e = $$cle + 1`)
function readsKey(node: any, key: string, derives?: Record<string, string[]>): boolean {
  let read = false
  walk.simple(node, {
    MemberExpression(m: any) {
      const name = m.computed ? m.property?.value : m.property?.name
      if (isStoreRoot(m.object) && name === key) read = true
      else if (m.object?.type === 'Identifier' && m.object.name === '$' && typeof name === 'string' && rootsOf(derives, name)?.includes(`$$${key}`)) read = true
    },
  })
  return read
}

// vrai si `x` lit l'objet `o` qu'écrit `µ._mjs_storeSetOn` (2e argument) : la variable qui garde l'élément trouvé
// (`t.n = t.n + 1`), ou le paramètre qui tient l'objet relu (`((_mjs_o) => µ._mjs_storeSetOn("l", _mjs_o, "n",
// _mjs_o.n + (1)))(objet)`, forme de `+=` et `++`, path-tracker.ts)
function readsObject(x: any, o: any): boolean {
  let read = false
  if (o?.type === 'Identifier') walk.simple(x, { Identifier(i: any) { if (i.name === o.name) read = true } })
  return read
}

// vrai si l'écriture `n` de la clé '$$x' CUMULE : la valeur écrite part de la clé elle-même (`$$n += 1`,
// `$$n++`, `$$ok = not $$ok`, `$$v = Math.min($$v, 9)`, `$$liste.push(x)`), ou de l'élément trouvé qu'elle écrit
// (`$$l.find(f).n += 1`, `t.ok = not t.ok`). Rejouée sur l'écriture d'un
// autre effet qui cumule aussi (deux compteurs, deux exemplaires d'un composant), elle ne se stabilise jamais
function accumulate(n: any, k: string, anc: any[], derives?: Record<string, string[]>): boolean {
  const key = k.slice(2)
  let val: any, obj: any
  if (n.type === 'AssignmentExpression') {
    if (n.operator !== '=') return true
    val = n.right
  }
  else {
    const name = n.callee.property.name
    if (name === '_mjs_storeDeepCall' || name === '_mjs_storeCallOn') return true
    if (name === '_storeSet') val = n.arguments[1]
    else if (name === '_mjs_storeDeepSet') val = n.arguments[2]
    else if (name === '_mjs_storeSetOn') [obj, val] = [n.arguments[1], n.arguments[3]]
    else return false
  }
  const reads = (x: any) => readsKey(x, key, derives) || readsObject(x, obj)
  if (val && reads(val)) return true
  // `$$n++` en instruction seule : `(_mjs_n = µ.store.n, µ._storeSet("n", ++_mjs_n))` — la valeur part de la clé, relue juste avant ;
  // `_mjs_n` seule : `$$n = ++i` écrit une valeur venue d'ailleurs, la clé lue reste une dépendance
  if (val?.type === 'UpdateExpression' && val.argument?.type === 'Identifier' && val.argument.name === '_mjs_n') return true
  // forme expression de `$$n++` : `((_mjs_n, _mjs_v = _mjs_n++) => (µ._storeSet("n", _mjs_n), _mjs_v))(µ.store.n)`, la valeur vient de
  // l'argument de la fonction appelée sur place
  for (let i = anc.length - 2; i > 0; i--) {
    const p = anc[i - 1]
    if (p.type === 'CallExpression' && p.callee === anc[i] && p.arguments.some(reads)) return true
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
export function annotateEffectDeps(js: string, methodReads?: Record<string, string[]>, computedDeps?: Record<string, string[]>, record = false, noDoubt = false): string {
  return annotateEffectDepsMapped(js, methodReads, computedDeps, record, false, false, noDoubt).code
}

// appel de `µ._mjs_setComputed(…)` : le calcul d'une valeur dérivée, dont les lectures suivent leur propre règle (transform-reactive.ts)
function isDerivedComputation(n: any): boolean {
  const c = n.callee
  return c?.type === 'MemberExpression' && !c.computed && c.object?.type === 'Identifier' && c.object.name === 'µ' && c.property?.name === '_mjs_setComputed'
}

// appel de `µ.effect.root(…)` (`µeffect.root`) : une racine de reffets
function isRoot(n: any): boolean {
  const c = n.callee
  return c?.type === 'MemberExpression' && !c.computed && c.property?.name === 'root' && c.object?.type === 'MemberExpression' && !c.object.computed && c.object.object?.type === 'Identifier' && c.object.object.name === 'µ' && c.object.property?.name === 'effect'
}

// `$.x` (`n`, de parent `p`, sous `gp`) en place d'écriture : affectation, `++`, `delete`, boucle `for … in/of`, motif de destructuration
function isTarget(n: any, p: any, gp: any): boolean {
  switch (p?.type) {
    case 'AssignmentExpression': return p.left === n
    case 'UpdateExpression': return true
    case 'UnaryExpression': return p.operator === 'delete'
    case 'ForInStatement': case 'ForOfStatement': return p.left === n
    case 'ArrayPattern': case 'RestElement': return true
    case 'AssignmentPattern': return p.left === n
    case 'Property': return p.value === n && gp?.type === 'ObjectPattern'
    default: return false
  }
}

// lectures notées pour le graphe des signaux (runtime/mjs_signals.ts) dans le `<script>` d'un composant qui a un reffet, ou dont un
// gestionnaire du gabarit ouvre une racine (`templateRoots`) : chaque `$.x`
// lu dans une fonction — corps d'un reffet, fonctions et méthodes qu'il appelle, rangées dans un objet ou passées comme valeur,
// rappels — prévient la boîte de `x` quand un calcul est en cours : `$[(µ._mjs_sigCur && µ._mjs_sigRead(_mjsThis, 'x'), 'x')]` (un cœur sans
// le graphe n'a pas `µ._mjs_sigCur` : rien n'est noté).
// La forme garde le receveur d'un appel (`$.f()`) et ne commence jamais par une parenthèse : une ligne du CoffeeScript compilé, sans
// point-virgule, ne s'accroche pas à la précédente. Un reffet suit ainsi ce qu'il lit vraiment, à chaque passage, même par une fonction
// que le relevé ne voit pas. Pas notés : le code de premier niveau (passé une fois, à la création), le calcul d'une valeur dérivée
// (`µ._mjs_setComputed`, sa propre règle), une cible d'écriture, une clé calculée (`$[k]`) — le relevé la garde : un reffet qui n'a rien
// noté suit son relevé. Posées avant la liste du relevé, ajoutée ensuite à la fin du rappel.
// Dans les gestionnaires du gabarit (`racines`), seules les lectures écrites dans une racine `µeffect.root`, ou dans une fonction écrite
// dans un gestionnaire qui en ouvre une (`lire = (-> $y); µeffect.root -> …`, la fonction d'un `{const}` du gabarit, refaite dans le
// gestionnaire) : ses reffets sont ceux du composant, comme ceux d'une racine du `<script>` (une clé du magasin qu'ils lisent est notée :
// `$x` doit l'être aussi, sinon son écriture ne les relance plus), et ils appellent ces fonctions ; le reste d'un gestionnaire ne lit
// pour aucun reffet
function noteComponentReads(ms: MagicString, ast: any, roots = false): boolean {
  let done = false
  // gestionnaires qui ouvrent une racine : la fonction la plus haute au-dessus d'un appel de `µ.effect.root`
  const openers = new Set<any>()
  if (roots) walk.ancestor(ast, {
    CallExpression(n: any, _s: any, anc: any[]) {
      if (isRoot(n)) openers.add(anc.find((a) => /Function/.test(a.type)))
    },
  })
  walk.ancestor(ast, {
    MemberExpression(n: any, _s: any, anc: any[]) {
      if (n.object?.type !== 'Identifier' || n.object.name !== '$') return
      const x = !n.computed ? (n.property?.type === 'Identifier' ? n.property.name : null) : (n.property?.type === 'Literal' && typeof n.property.value === 'string' ? n.property.value : null)
      if (x === null) return
      // `premiere` : la fonction la plus haute (dans les gestionnaires du gabarit, le gestionnaire lui-même) ; une fonction écrite dessous,
      // dans un gestionnaire qui ouvre une racine, lit pour ses reffets
      let first: any = null
      let inRoot     = !roots
      for (const a of anc) {
        if (/Function/.test(a.type)) {
          if (first && openers.has(first)) inRoot = true
          first ??= a
        }
        else if (a.type === 'CallExpression' && isDerivedComputation(a)) return
        else if (roots && a.type === 'CallExpression' && isRoot(a)) inRoot = true
      }
      const p = anc[anc.length - 2]
      if (!first || !inRoot || isTarget(n, p, anc[anc.length - 3])) return
      const lit = `'${x.replace(/[\\']/g, '\\$&')}'`
      ms.overwrite(n.object.end, n.end, `[(µ._mjs_sigCur && µ._mjs_sigRead(_mjsThis, ${lit}), ${lit})]`)
      done = true
    },
  })
  return done
}

// Variante qui rend AUSSI la carte de source de cette passe — cf. pass-map.ts.
// `templateRoots` : un gestionnaire du gabarit de ce composant ouvre une racine (transpiler/index.ts) ; ses reffets appellent aussi les
// fonctions du `<script>` (`lireY = -> $y`) : avec `noter`, ses lectures sont notées même quand le script n'a aucun reffet à lui.
// `noDoubt` : le cœur de cette construction fait passer tous les reffets d'un composant redessiné par un état partagé, la marque du doute
// ne s'écrit pas
export function annotateEffectDepsMapped(js: string, methodReads?: Record<string, string[]>, computedDeps?: Record<string, string[]>, record = false, handlers = false, templateRoots = false, noDoubt = false): PassResult {
  if (!js || !((record && templateRoots) || /µ\.effect(?:\.before|\.root)?\(/.test(js))) return { code: js }

  let ast: acorn.Node
  try {
    ast = parseModule(js)
  } catch {
    return { code: js }
  }

  const ms = new MagicString(js)
  // `<script>` d'un composant (`noter`, transpiler/index.ts) : ses lectures notées pour le graphe, avant la liste du relevé ; gestionnaires
  // de son gabarit (`gestionnaires`) : celles de leurs racines et des fonctions écrites dans un gestionnaire qui en ouvre une
  let changed = (record || handlers) && noteComponentReads(ms, ast, !record)

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

  // ce que la liste blanche demande au script entier (cf. Blanc). Comptes des affectations de chaque nom et de chaque `this.nom`, faits au
  // premier besoin : une fonction du script ou une méthode affectée deux fois (`relire = -> …` dans `µmount`) n'est plus celle que le
  // relevé a parcourue ; `this[k] = …`, `Object.assign(this, …)` : plus aucune méthode n'est sûre
  let counts: Map<string, number> | null = null
  const thisCounts = new Map<string, number>()
  let computedThis = false
  const tally = (): Map<string, number> => {
    if (counts) return counts
    const c       = counts = new Map<string, number>()
    const plus    = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) || 0) + 1) }
    const me      = (x: any): boolean => x?.type === 'ThisExpression' || (x?.type === 'Identifier' && x.name === '_mjsThis')
    const pattern = (x: any): void => {
      const s = new Set<string>()
      namesInPattern(x, s)
      s.forEach((k) => plus(c, k))
    }
    ;(walk as any).fullAncestor(ast, (n: any, _st: any, anc: any[]) => {
      if (n.type === 'VariableDeclarator') {
        const loop = anc[anc.length - 3]
        if (n.init || ((loop?.type === 'ForOfStatement' || loop?.type === 'ForInStatement') && loop.left === anc[anc.length - 2])) pattern(n.id)
      }
      else if (n.type === 'AssignmentExpression') {
        const m = methodOf(n.left)
        if (m !== null) plus(thisCounts, m)
        else if (n.left?.type === 'MemberExpression') { if (me(n.left.object)) computedThis = true }
        else pattern(n.left)
      }
      else if (n.type === 'UpdateExpression' && n.argument?.type === 'Identifier') plus(c, n.argument.name)
      else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id?.name) plus(c, n.id.name)
      else if ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && n.left?.type !== 'VariableDeclaration') pattern(n.left)
      else if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.object?.type === 'Identifier' && n.callee.object.name === 'Object' && me(n.arguments?.[0])) computedThis = true
    })
    return c
  }
  const blank: Blank = {
    // l'état entier pris comme une valeur (`µ._mjs_makeDeepProxy(_mjsThis, [])`, generator/transform-reactive.ts)
    stateAsValue: js.includes('_mjs_makeDeepProxy('),
    derives:      new Set(Object.keys(computedDeps || {})),
    names:         new Set(),
    safeFunction: (name) => fnByName.has(name) && tally().get(name) === 1,
    safeMethod:  (name) => methodByName.has(name) && tally() !== null && !computedThis && thisCounts.get(name) === 1,
    // méthode nommée comme valeur : son corps, parcouru comme du code d'après coup pour le doute seul (ses lectures du magasin gardent leur
    // règle), tient-il dans la liste blanche ? Une méthode déjà parcourue pour ce reffet ne l'est pas deux fois
    lateMethod:  (name) => {
      if (byReference.has(name)) return true
      byReference.add(name)
      const attempt: Reads = { reads: new Set(), syncReads: new Set(), syncDeps: new Set(), lateReads: new Set(), lateDeps: new Set(), excluded: new Set(), total: new Set(), writes: new Set(), doubt: false }
      collectReads(methodByName.get(name), new Set(), new Set(), attempt, true, true)
      return !attempt.doubt
    },
    late:         () => false,
  }
  // valeurs dérivées du script (`µ._mjs_setComputed(_mjsThis, 'nom', …)`) : leur lecture relance un calcul, du code de l'appli
  walk.simple(ast, {
    CallExpression(c: any) {
      if (isDerivedComputation(c) && c.arguments?.[1]?.type === 'Literal') blank.derives.add(String(c.arguments[1].value))
    },
  })
  // noms du premier niveau du script : ils masquent une fonction du navigateur du même nom
  for (const stmt of (ast as any).body) {
    if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) namesInPattern(d.id, blank.names)
    else if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id?.name) blank.names.add(stmt.id.name)
    else if (stmt.type === 'ImportDeclaration') for (const sp of stmt.specifiers) blank.names.add(sp.local.name)
  }

  // les appelables du script (cf. Appelables), relevés au premier besoin
  let callables: Callables | null = null
  const fromScript = (): Callables => {
    if (callables) return callables
    const s: Callables = callables = { writers: new Map(), classes: new Map(), implicit: [], bound: new Set(), imported: new Set(), computed: false, detour: false }
    // la clé `k` reçoit la valeur `v` (`k` null : clé calculée) ; une fonction du script nommée là vaut son corps
    const range = (k: string | null, v: any): void => {
      const f = v?.type === 'Identifier' && blank.safeFunction(v.name) ? fnByName.get(v.name) : v
      if (!isFunction(f) && !canBeCalled(v)) return
      if (k === null) {
        s.computed = true
        if (isFunction(f)) s.implicit.push(f)
        return
      }
      if (!s.writers.has(k)) s.writers.set(k, [])
      s.writers.get(k)!.push(isFunction(f) ? f : null)
    }
    // la clé `k` reçoit une valeur que le relevé ne lit pas (ce que rend un accesseur) : `k` null, clé calculée
    const unknown = (k: string | null): void => {
      if (k === null) s.computed = true
      else s.writers.set(k, [...(s.writers.get(k) || []), null])
    }
    // les membres dans lesquels écrit le motif `m` (`{ a: o.k } = x`, `[o.k] = x`) : leur clé reçoit une valeur que le relevé ne suit pas
    const targetedMembers = (m: any, r: any[] = []): any[] => {
      if (!m) return r
      if (m.type === 'MemberExpression') r.push(m)
      else if (m.type === 'ObjectPattern') for (const q of m.properties) targetedMembers(q.type === 'RestElement' ? q.argument : q.value, r)
      else if (m.type === 'ArrayPattern') for (const q of m.elements) targetedMembers(q, r)
      else if (m.type === 'AssignmentPattern') targetedMembers(m.left, r)
      else if (m.type === 'RestElement') targetedMembers(m.argument, r)
      return r
    }
    ;(walk as any).fullAncestor(ast, (n: any, _st: any, anc: any[]) => {
      const p = anc[anc.length - 2]
      if (n.type === 'Identifier') { if (DETOURS.has(n.name)) s.detour = true }
      else if (n.type === 'MemberExpression') { if (!n.computed && DETOURS.has(n.property?.name)) s.detour = true }
      else if (n.type === 'ImportDeclaration') for (const sp of n.specifiers) s.imported.add(sp.local.name)
      else if (isFunction(n)) {
        for (const q of n.params) namesInPattern(q, s.bound)
        if (n.id?.name) s.bound.add(n.id.name)
      }
      else if (n.type === 'VariableDeclarator') namesInPattern(n.id, s.bound)
      else if (n.type === 'CatchClause') namesInPattern(n.param, s.bound)
      else if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') {
        const name = n.id?.name || (p?.type === 'VariableDeclarator' && p.init === n && p.id?.type === 'Identifier' ? p.id.name : p?.type === 'AssignmentExpression' && p.right === n && p.left?.type === 'Identifier' ? p.left.name : null)
        if (n.id?.name) s.bound.add(n.id.name)
        if (name) s.classes.set(name, [...(s.classes.get(name) || []), n])
      }
      else if ((n.type === 'Property' && p?.type === 'ObjectExpression') || n.type === 'PropertyDefinition' || (n.type === 'MethodDefinition' && n.kind !== 'constructor')) {
        const k = keyOf(n.key, n.computed)
        if (n.kind === 'get' || n.kind === 'set') {
          s.implicit.push(n.value)
          // ce que rend un accesseur n'est pas lu : la méthode appelée par ce nom (`boite.relire()`) n'est plus trouvée
          if (n.kind === 'get') unknown(k)
        }
        else {
          range(k, n.value)
          // descripteur donné à `Object.defineProperty` : ses `get` et `set` sont des accesseurs
          if ((k === 'get' || k === 'set') && isFunction(n.value)) s.implicit.push(n.value)
        }
      }
      else if (n.type === 'AssignmentExpression') {
        if (n.left?.type === 'MemberExpression') range(keyOf(n.left.property, n.left.computed), n.right)
        else {
          namesInPattern(n.left, s.bound)
          for (const m of targetedMembers(n.left)) unknown(keyOf(m.property, m.computed))
        }
      }
      // la cible d'une boucle `for (o.k of liste)`, `for ({ a: o.k } of liste)` écrit dans un membre comme un motif
      else if (n.type === 'ForOfStatement' && n.left?.type !== 'VariableDeclaration') for (const m of targetedMembers(n.left)) unknown(keyOf(m.property, m.computed))
      else if (n.type === 'CallExpression') {
        const c = n.callee, a = n.arguments || []
        // écritures par les aides du cœur (`µ._set(_mjsThis, 'x', v)`, `µ._mjs_deepSet(_mjsThis, ['o', 'k'], v)`, `µ._storeSet('x', v)`…) : la
        // valeur en dernier, les clés avant elle
        if (c?.type === 'MemberExpression' && !c.computed && c.object?.type === 'Identifier' && c.object.name === 'µ' && /set/i.test(c.property?.name || '') && a.length > 1) {
          const v = a[a.length - 1]
          for (const x of a.slice(0, -1)) for (const q of x.type === 'ArrayExpression' ? x.elements : [x]) {
            if (q?.type === 'Literal') range(String(q.value), v)
            else if (x.type === 'ArrayExpression') range(null, v)
          }
        }
        // `Object.defineProperty(o, 'k', { value: v })` : la clé `k` reçoit `v` ; un descripteur qui n'est pas écrit sur place : détour
        if (c?.type === 'MemberExpression' && !c.computed && c.property?.name === 'defineProperty' && a.length === 3) {
          if (a[2].type !== 'ObjectExpression') s.detour = true
          else for (const q of a[2].properties) {
            const d = q.type === 'Property' && !q.computed ? keyOf(q.key, false) : null
            if (d === null) s.detour = true
            else if (d === 'value') range(keyOf(a[1], true), q.value)
            else if (d === 'get' || d === 'set') {
              // accesseur donné par le nom d'une fonction du script : jugé comme celui écrit sur place ; toute autre valeur, détour
              const g = q.value?.type === 'Identifier' && blank.safeFunction(q.value.name) ? fnByName.get(q.value.name) : q.value
              if (!isFunction(g)) s.detour = true
              else if (g !== q.value) s.implicit.push(g)
              if (d === 'get') unknown(keyOf(a[1], true))
            }
          }
        }
        // `Object.create(modèle, descripteurs)` : des clés posées par des descripteurs que le relevé ne lit pas
        if (c?.type === 'MemberExpression' && !c.computed && c.property?.name === 'create' && c.object?.type === 'Identifier' && c.object.name === 'Object' && a.length > 1) s.detour = true
      }
    })
    return s
  }

  // la fonction `f` du script, appelée pendant un passage, ne remet-elle à plus tard que du code de la liste blanche ? Jugée comme le corps
  // d'un reffet : ce qu'elle fait sur place est du passage, ce qu'elle pose pour plus tard est du code d'après coup. Un jugement rendu
  // pendant qu'un autre est en cours (deux fonctions qui s'appellent l'une l'autre) n'est gardé que s'il condamne
  const own = new Map<any, boolean>()
  const pending = new Set<any>()
  const clean = (f: any): boolean => {
    const su = own.get(f)
    if (su !== undefined) return su
    if (pending.has(f)) return true
    pending.add(f)
    const attempt: Reads = { reads: new Set(), syncReads: new Set(), syncDeps: new Set(), lateReads: new Set(), lateDeps: new Set(), excluded: new Set(), total: new Set(), writes: new Set(), doubt: false }
    collectReads(f, new Set(), new Set(), attempt, true, false)
    pending.delete(f)
    if (attempt.doubt || pending.size === 0) own.set(f, !attempt.doubt)
    return !attempt.doubt
  }
  // la clé `k`, appelée par son nom : le script n'y range rien (méthode du dehors), ou seulement des fonctions écrites sur place, jugées
  const safeKey = (k: string): boolean => {
    const s = fromScript()
    if (s.computed) return false
    return (s.writers.get(k) || []).every((f) => f !== null && clean(f))
  }
  // `new C()` d'une classe du script : déclarée une fois, sans classe mère, des champs qui ne calculent rien, un constructeur jugé
  const safeClass = (name: string): boolean => {
    const cs = fromScript().classes.get(name) || []
    if (cs.length !== 1 || tally().get(name) !== 1 || cs[0].superClass) return false
    return cs[0].body.body.every((m: any) => m.type === 'MethodDefinition' ? m.kind !== 'constructor' || clean(m.value) : m.type === 'PropertyDefinition' && (!m.value || isFunction(m.value) || m.value.type === 'Literal'))
  }
  // ce que le script fait tourner sans appel écrit (en-tête) ne remet à plus tard que du code de la liste blanche ; jugé une fois
  let safeImplicits: boolean | null = null
  const ownImplicits = (): boolean => {
    if (safeImplicits !== null) return safeImplicits
    const s = fromScript()
    let ok = !s.detour
    for (const k of IMPLICIT_KEYS) for (const f of s.writers.get(k) || []) ok = ok && f !== null && clean(f)
    for (const f of s.implicit) ok = ok && clean(f)
    return safeImplicits = ok
  }
  // L'APPEL DU PASSAGE (en-tête) : l'appelé `c` de l'appel qui termine `anc` (`neuf` : par `new`) est-il trouvé et jugé, ou du dehors ?
  // Une fonction du script ou une méthode affectées une seule fois sont parcourues par `collectReads`, qui les juge au passage
  const passCall = (c: any, anc: any[], fresh: boolean): boolean => {
    while (c?.type === 'ParenthesizedExpression' || c?.type === 'ChainExpression') c = c.expression
    while (c?.type === 'MemberExpression' && !c.computed && BY_METHOD.has(c.property?.name)) c = c.object
    if (isFunction(c)) return true
    if (c?.type === 'Identifier') {
      const r = resolve(c.name, [...anc, c])
      if (r.kind !== 'free') return r.kind === 'local' && localFunction(c.name, r.f)
      const s = fromScript()
      if (fresh && s.classes.has(c.name)) return safeClass(c.name)
      if (fnByName.has(c.name)) return blank.safeFunction(c.name)
      if (s.imported.has(c.name)) return true
      return !s.bound.has(c.name) && !tally().has(c.name) && safeKey(c.name)
    }
    if (c?.type !== 'MemberExpression') return false
    const k = writtenKey(c), o = c.object
    if (k === null || o?.type === 'Super' || isStoreRoot(o) || (o?.type === 'Identifier' && o.name === '$')) return false
    // aide du cœur, champ que le cœur pose sur le composant
    if ((o?.type === 'Identifier' && o.name === 'µ') || k.startsWith('_mjs')) return true
    if (methodOf(c) !== null) {
      // dans une fonction trouvée par sa clé (méthode d'un objet, d'une classe), `this` n'est pas à coup sûr le composant : la clé compte aussi
      if (methodByName.has(k)) return blank.safeMethod(k) && (o.type !== 'ThisExpression' || pending.size === 0 || safeKey(k))
      tally()
      if (computedThis || thisCounts.has(k)) return false
    }
    return safeKey(k)
  }

  // Parcourt `fn` : les `$.xxx` lus vont dans `deps` — DIRECTEMENT, via une méthode
  // `this.m()`/`_mjsThis.m()` (methodReads) ou via un APPEL à une fonction plate du module
  // (fnByName, TRANSITIF — `seen` coupe les cycles), et dans `store.syncDeps` ceux lus pendant son passage
  // synchrone ; les lectures du STORE vont dans `store.reads` (dans `store.syncReads` aussi, faites pendant ce
  // passage), dans `store.excluded` les clés qu'il écrit après ce passage ou en cumulant (en-tête), corps des
  // méthodes compris — dans `store.total` aussi, écrites en cumulant pendant ce passage —, et dans `store.writes`
  // celles qu'il écrit pendant ce passage sans cumuler.
  // `storeOnly` : dans le corps d'une méthode, les `$.xxx` restent ceux de
  // methodReads (filtrés des variables externes par l'analyseur). `late` : `fn` elle-même peut tourner
  // après ce passage (passée comme valeur, ou atteinte depuis un rappel).
  function collectReads(fn: any, deps: Set<string>, seen: Set<string>, store: Reads, storeOnly = false, late = false): void {
    // LA LISTE BLANCHE (en-tête) : tout nœud de `fn` qui peut tourner après le passage doit en être, hors du nettoyage que rend le reffet
    const b: Blank = { ...blank, late: (a: any[]) => late || afterwards(a) }
    if (!store.doubt) (walk as any).fullAncestor(fn, (n: any, _st: any, anc: any[], kind: string) => {
      if (store.doubt || n === fn || !(late || afterwards(anc)) || inCleanup(anc, effectFn)) return
      if (!allowed(n, anc, kind, b)) store.doubt = true
    })
    // écriture de la clé `k` du store par le nœud `n`, faite après le passage (`t`) ou pendant. Cumulée à travers l'objet
    // visé (`s.n++`, `t.n += 1`, `p.l.push(x)` par une variable prise hors de l'effet), elle LIT la clé, comme par le
    // chemin (`$$e.a.n++` lit `µ.store.e`) : sans cette lecture, un effet qui ne lit rien d'autre recevait une liste
    // vide, relancé à chaque mise à jour, sa propre écriture comprise, jusqu'au garde-fou
    const written = (n: any, k: string, anc: any[], t: boolean): void => {
      const c = accumulate(n, k, anc, computedDeps)
      if (c && n.type === 'CallExpression' && OBJECT_WRITERS.has(n.callee.property.name)) {
        store.reads.add(k)
        if (!t) store.syncReads.add(k)
      }
      if (t) store.excluded.add(k)
      else if (c) {
        store.excluded.add(k)
        store.total.add(k)
      }
      else store.writes.add(k)
    }
    walk.ancestor(fn, {
      MemberExpression(n: any, _s: any, anc: any[]) {
        if (!store.doubt && doubtfulRead(n) && !inCleanup(anc, effectFn)) store.doubt = true
        // méthode du composant nommée comme valeur (`[1].map(@@lire)`, `plusTard(@@afficher)`) : elle peut tourner après le passage ; posée
        // une seule fois, son corps est parcouru comme du code d'après coup ; sinon doute
        const pm = anc[anc.length - 2], mv = methodOf(n)
        if (!store.doubt && mv !== null && methodByName.has(mv) && !(pm?.type === 'CallExpression' && pm.callee === n) && !(pm?.type === 'AssignmentExpression' && pm.left === n) && !inCleanup(anc, effectFn) && !(b.safeMethod(mv) && b.lateMethod(mv))) store.doubt = true
        if (n.object?.type !== 'Identifier' || n.object.name !== '$') {
          collectStoreMemberDep(n, anc, store.reads)
          if (!late && !afterwards(anc)) collectStoreMemberDep(n, anc, store.syncReads)
          else collectStoreMemberDep(n, anc, store.lateReads)
          return
        }
        if (storeOnly) return
        const key = n.computed ? extractComputedStaticKey(n.property) : (n.property?.name ?? null)
        if (!key) return
        deps.add(key)
        if (!late && !afterwards(anc)) store.syncDeps.add(key)
        else store.lateDeps.add(key)
      },
      AssignmentExpression(n: any, _s: any, anc: any[]) {
        const k = storeWriteKey(n)
        if (k) written(n, k, anc, late || afterwards(anc))
      },
      // `µ.store.x++` resté nu : toujours un cumul
      UpdateExpression(n: any, _s: any, anc: any[]) {
        const k = storeWriteKey(n)
        if (!k) return
        store.excluded.add(k)
        if (!late && !afterwards(anc)) store.total.add(k)
      },
      // `this.fmt()`/`_mjsThis.fmt()` : méthode connue → ses lectures d'état
      // (déjà point-fixées, '@' résolus) s'ajoutent aux deps de CET effet ;
      // son corps donne celles du store (en-tête).
      CallExpression(n: any, _s: any, anc: any[]) {
        const t = late || afterwards(anc)
        const k = storeWriteKey(n)
        // clé calculée de l'état (`$[k]`, lue par `µ._mjs_deepKey($, k)`, path-tracker.ts) : le passage ne la note pas
        if (n.callee?.type === 'MemberExpression' && !n.callee.computed && n.callee.object?.type === 'Identifier' && n.callee.object.name === 'µ' && n.callee.property?.name === '_mjs_deepKey' && n.arguments?.[0]?.type === 'Identifier' && n.arguments[0].name === '$' && !inCleanup(anc, effectFn)) store.doubt = true
        if (k) written(n, k, anc, t)
        // l'appel du passage (en-tête) : appelé trouvé et jugé, ou du dehors ; après coup, la liste blanche le juge
        if (!store.doubt && !t && !inCleanup(anc, effectFn) && !passCall(n.callee, anc, false)) store.doubt = true
        // rappel passé par son nom à un point de report connu, pendant le passage (en-tête) ; après coup, la liste blanche le juge
        if (!store.doubt && !t && !inCleanup(anc, effectFn) && !callbacksOf(n).every((a) => safeCallback(a, anc, b))) store.doubt = true
        const cc = n.callee
        if (cc?.type !== 'MemberExpression' || cc.computed || cc.property?.type !== 'Identifier') return
        if (cc.object?.type !== 'ThisExpression' && !(cc.object?.type === 'Identifier' && cc.object.name === '_mjsThis')) return
        const name = cc.property.name
        const sub  = storeOnly ? null : methodReads?.[name]
        const body = methodByName.get(name)
        // méthode inconnue, async, génératrice, ou qui pose une fonction (rappel, minuterie, promesse) : ses lectures, relevées sans
        // leur place (methodReads), peuvent tourner après le passage synchrone
        const tm    = t || !body || readAfterwards(body)
        if (sub) for (const r of sub) {
          if (r.startsWith('$$')) continue
          deps.add(r)
          if (!tm) store.syncDeps.add(r)
          else store.lateDeps.add(r)
        }
        const key   = (t ? '@!' : '@') + name
        if (!body || seen.has(key)) return
        seen.add(key)
        collectReads(body, deps, seen, store, true, t)
      },
      NewExpression(n: any, _s: any, anc: any[]) {
        if (!store.doubt && !late && !afterwards(anc) && !inCleanup(anc, effectFn) && !passCall(n.callee, anc, true)) store.doubt = true
      },
      TaggedTemplateExpression(n: any, _s: any, anc: any[]) {
        if (!store.doubt && !late && !afterwards(anc) && !inCleanup(anc, effectFn) && !passCall(n.tag, anc, false)) store.doubt = true
      },
      // fonction plate du module référencée — position appel (`helper()`) OU
      // position valeur (`list.forEach(helper)`) : héritage transitif de SES
      // lectures (en-tête). Clé de `seen` distincte en mode store seul : un
      // passage depuis une méthode ne doit pas masquer le parcours complet ;
      // distincte aussi quand elle peut tourner après coup (passée comme valeur :
      // `setTimeout(helper)`), pour que ses écritures y soient vues comme telles.
      // `k in objet` : l'objet peut être un état partagé, et ce test ne note aucune lecture
      BinaryExpression(n: any, _s: any, anc: any[]) {
        if (n.operator === 'in' && !inCleanup(anc, effectFn)) store.doubt = true
      },
      Identifier(n: any, _s: any, anc: any[]) {
        if (ADDRESS.has(n.name) && !inCleanup(anc, effectFn)) store.doubt = true
        if (!fnByName.has(n.name)) return
        const p = anc[anc.length - 2]
        const t = late || afterwards(anc) || !(p?.type === 'CallExpression' && p.callee === n)
        // fonction du script nommée comme valeur, ou appelée après coup : réaffectée quelque part, ce n'est plus celle que le relevé parcourt
        if (t && !store.doubt && !b.safeFunction(n.name) && resolve(n.name, anc).kind === 'free' && !inCleanup(anc, effectFn)) store.doubt = true
        const key = (storeOnly ? '~' : '') + (t ? '!' : '') + n.name
        if (seen.has(key)) return
        seen.add(key)
        collectReads(fnByName.get(n.name), deps, seen, store, storeOnly, t)
      },
    })
  }

  // la fonction du reffet dont le relevé est en cours (cf. inCleanup)
  let effectFn: any = null
  // méthodes passées comme valeur déjà parcourues pour ce reffet (une méthode qui se passe elle-même ne tourne pas en rond)
  let byReference = new Set<string>()

  walk.simple(ast, {
    CallExpression(node: any) {
      let callee = node.callee
      if (!callee || callee.type !== 'MemberExpression' || callee.computed) return
      // `µ.effect.root(…)` (`µeffect.root`) dans le `<script>` d'un composant ou dans un gestionnaire de son gabarit (`_mjsThis` y est en
      // portée, transpiler/template.ts) : le composant en second argument, les reffets de la racine sont les siens (runtime/mjs_effect.ts)
      if (isRoot(node)) {
        if ((record || handlers) && node.arguments?.length === 1) {
          ms.appendLeft(node.arguments[0].end, ', _mjsThis')
          changed = true
        }
        return
      }
      // `µ.effect.before(…)` (`µeffect.before`, le reffet d'avant l'écran) : mêmes dépendances
      if (callee.property?.name === 'before' && callee.object?.type === 'MemberExpression' && !callee.object.computed) callee = callee.object
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

      const deps         = new Set<string>()
      const store: Reads = { reads: new Set(), syncReads: new Set(), syncDeps: new Set(), lateReads: new Set(), lateDeps: new Set(), excluded: new Set(), total: new Set(), writes: new Set(), doubt: false }
      const seen         = new Set<string>(cb.type === 'Identifier' ? [cb.name] : [])
      effectFn           = fn
      byReference        = new Set()
      collectReads(fn, deps, seen, store)
      // reffet donné par le nom d'une fonction du script affectée deux fois : celle qui tourne n'est pas à coup sûr celle que le relevé a lue
      if (cb.type === 'Identifier' && !blank.safeFunction(cb.name)) store.doubt = true
      if (!store.doubt && !noDoubt && !ownImplicits()) store.doubt = true
      // lue après coup — après un `await`, dans un rappel, une minuterie, une promesse, une fonction passée comme valeur, une méthode
      // async —, seulement ou en plus d'une lecture du passage : le graphe des signaux ne note que le passage synchrone d'un reffet
      // (runtime/mjs_effect.ts), dont une branche non prise ne lit rien. Marquée `~x` en plus de `x`, le runtime la garde au relevé :
      // un reffet qui attend ne repart jamais moins qu'avec le relevé seul
      const deferred = [...deps].filter((d) => !store.syncDeps.has(d) || store.lateDeps.has(d))
      // dérivé fondé sur une clé que l'effet écrit : remplacé par ses racines, la clé passe par la règle des lectures
      // du store juste en dessous (en-tête) ; un dérivé intermédiaire n'apporte rien, ses racines sont déjà là
      for (const d of [...deps]) {
        const roots = rootsOf(computedDeps, d)
        if (!roots?.some(r => store.writes.has(r) || store.excluded.has(r))) continue
        deps.delete(d)
        for (const r of roots) {
          if (rootsOf(computedDeps, r)) continue
          if (!r.startsWith('$$')) deps.add(r)
          else {
            store.reads.add(r)
            if (store.syncDeps.has(d)) store.syncReads.add(r)
            if (store.lateDeps.has(d)) store.lateReads.add(r)
          }
        }
      }
      // une clé que l'effet écrit pendant son passage synchrone, sans cumuler, reste une dépendance, marquée '!' : seule
      // une écriture hors de tout effet la signale ; lue pendant ce passage et écrite seulement après coup, elle en reste
      // une, sans marque ; écrite en cumulant pendant ce passage, ou après coup et lue seulement après coup, elle n'en est
      // pas une (en-tête)
      for (const k of store.reads) {
        if (store.excluded.has(k) && (store.total.has(k) || !store.syncReads.has(k))) continue
        deps.add(store.writes.has(k) ? `${k}!` : k)
      }
      // tout ce qu'il lit, il l'écrit en cumulant ou après coup (`$$k = $$k + 1`, `$$n = $e`) : une liste vide dirait « aucune
      // dépendance connue », que le runtime relance à chaque mise à jour du composant — jusqu'au garde-fou au montage, puis
      // sur tout rendu sans rapport. La marque '!', qu'aucune écriture ne signale, le fait passer au montage seulement
      if (deps.size === 0 && store.reads.size > 0) deps.add('!')
      for (const d of deferred) if (deps.has(d)) deps.add(`~${d}`)
      // clé du magasin lue après coup, seulement ou en plus d'une lecture du passage : le graphe ne note que le passage synchrone, marquée
      // `~$$x`, le runtime la garde au relevé
      for (const k of store.reads) if (deps.has(k) && (!store.syncReads.has(k) || store.lateReads.has(k))) deps.add(`~${k}`)

      const depsLit = `[${[...deps].map(d => JSON.stringify(d)).join(', ')}]`
      // 3e argument : le doute devant un état partagé (en-tête, DOUTE)
      ms.appendLeft(cb.end, `, ${depsLit}${store.doubt && !noDoubt ? ', 1' : ''}`)
      changed = true
    },
  })

  return passResult(ms, js, changed, 'effect-deps')
}
