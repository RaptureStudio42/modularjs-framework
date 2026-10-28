// mjs_deep — mutations PROFONDES d'un état : `µ._mjs_deepSet` (`$o.x = v`), `µ._mjs_deepCall`
// (`$liste.push(v)`), `µ._mjs_deepDelete` (`delete $o.x`) et `µ._mjs_makeDeepProxy` (enveloppe rendue
// au point de FUITE d'un chemin, et rune `µproxy`). DÉTACHÉES de mjs_init.ts : le suiveur de
// chemins (generator/path-tracker.ts) et le transpileur émettent ces quatre appels LITTÉRALEMENT,
// et eux seuls les appellent — un projet qui ne mute jamais en profondeur ne les a jamais
// appelées (bundler/features.ts, clé `deep`).
//
// Une clé qui vaut `__proto__`, `constructor` ou `prototype` est refusée, à n'importe quel rang du chemin, et rien ne
// s'écrit dans une fonction ni dans un prototype (cf. _mjsDeepRefus). Les briques qu'elles partagent avec le reste du cœur — `µ._mjs_toRaw`, `µ._mjs_rawSet`,
// `µ._mjs_snap`, `el._set`/`el._mjs_notifyMutation`, `el._mjs_wrapDeep` — restent où elles sont : le filet
// `_mjs_wrapDeep` (mjs_element.ts) couvre les mutations qui échappent au suivi statique, avec ou sans
// ce fichier.

// nom réservé (CWE-1321) : une clé qui vaut `__proto__`, `constructor` ou `prototype`, à n'importe quel rang du chemin
// (variable comprise), ou le nom de la méthode appelée, est refusée — rien n'est écrit, un avertissement nomme le segment.
// Une clé objet (`['__proto__']`, objet dont `toString` rend le nom) est convertie une fois, comme JavaScript la
// convertit, et rangée convertie dans le chemin : la comparaison, la règle des types, la navigation et l'écriture voient
// la même clé. Un indice ou un symbole n'est jamais un nom réservé. Le contrôle, payé par toute écriture profonde, vit
// dans deux petites fonctions communes aux aides (`_mjsDeepChemin`, `_mjsDeepInterdit`, plus bas) : seul le refus appelle
// celle-ci. L'objet atteint au bout du chemin passe le même refus : rangé dans l'état par une lecture
// (`$loc.p = $$o[k]`), il est là où JavaScript mène — une fonction (`Object`, où mène `constructor`) ou un prototype
// (`Object.prototype`, où mène `__proto__` : l'objet que range son propre constructeur) ne reçoit rien, l'avertissement
// nomme le segment qui y mène ; un objet absent garde l'erreur de JavaScript
function _mjsDeepRefus(k) {
  µ.warn(µ._mjs_msg('initPath', { seg: k }, 'chemin d\'état refusé (segment « {seg} ») — mutation ignorée.'));
}

// tête de chaque aide : clé objet convertie une fois et rangée convertie, nom réservé refusé ; rend `false` au refus.
// Hors des aides, comme `_mjsDeepInterdit` : V8 ne fond une aide dans la boucle qui l'appelle (ni appel, ni tableau du
// chemin fabriqué à chaque tour) qu'au-dessous de 460 octets de bytecode, et `µ._mjs_deepSet` les dépassait avec ses
// gardes en ligne (1 000 000 d'écritures `$o.a.b.c = i` : 25 % plus lentes)
function _mjsDeepChemin(path) {
  var i, k;
  for (i = 0; i < path.length; i++) {
    k = path[i];
    if (typeof k === 'object' || typeof k === 'function') path[i] = k = String(k);
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') { _mjsDeepRefus(k); return false; }
  }
  return true;
}

// objet atteint au bout du chemin, écrit ou modifié : ni une fonction ni un prototype ; rend `true` au refus
function _mjsDeepInterdit(o) {
  var c;
  if (typeof o === 'function') { _mjsDeepRefus('constructor'); return true; }
  if (o != null && (c = o.constructor) && c.prototype === o) { _mjsDeepRefus('__proto__'); return true; }
  return false;
}

// racine d'une écriture profonde : l'objet brut que tient l'enveloppe rangée dans l'état (`µ._mjs_toRaw`, qui passe par le
// piège de l'enveloppe). Une enveloppe garde la même cible toute sa vie : la dernière déballée se retient le temps du tour,
// oubliée à la microtâche suivante (rien n'est retenu au-delà) — une boucle d'écritures ne repasse pas par le piège à chaque
// écriture
let _mjsRacEnv, _mjsRacBrut, _mjsRacTour = 0;
function _mjsRacOubli() {
  _mjsRacEnv  = _mjsRacBrut = void 0;
  _mjsRacTour = 0;
}
function _mjsDeepRacine(o) {
  if (_mjsRacTour && o === _mjsRacEnv) return _mjsRacBrut;
  if (!_mjsRacTour) {
    _mjsRacTour = 1;
    queueMicrotask(_mjsRacOubli);
  }
  _mjsRacEnv = o;
  return _mjsRacBrut = µ._mjs_toRaw(o);
}

// `µ._mjs_deepSet(el, ['box', 'width'], 200)` : assigne sans Proxy, navigue
// le chemin et notifie la mutation à la clé top-level. Le compilateur
// génère cet appel pour tous les `$.X.Y... = Z` dont l'alias est trackable.
// Rend la valeur AFFECTÉE (sémantique JS d'une assignation), pas le retour de
// la notification — un appelant qui utilise `$.obj.x = v` comme VALEUR (return,
// affectation en chaîne, argument…) doit lire exactement ce qui a été écrit.
µ._mjs_deepSet = function(el, path, value) {
  var i, o, topKey, isRaw, root;
  if (!_mjsDeepChemin(path)) return value;
  topKey = path[0];
  if (path.length === 1) {
    el._set(topKey, value);
    return value;
  }
  // Naviguer sur la cible BRUTE : muter via le Proxy re-déclencherait le set
  // trap → double notification (avec la notif explicite ci-dessous).
  o = _mjsDeepRacine(el._state[topKey]);
  // racine (avant navigation) : c'est TOUJOURS elle qui porte l'« époque » de
  // mutation comparée par `_set` côté two-way (`=!{}`) — peu importe la
  // profondeur réellement mutée, cf. bump plus bas.
  root = o;
  // racine marquée µ.raw : mêmes sémantiques que `_mjs_wrapDeep`
  // (mjs_element.ts) — la mutation s'écrit, mais ne notifie JAMAIS.
  isRaw = µ._mjs_rawSet.has(o);
  i = 1;
  while (i < path.length - 1) {
    o = o[path[i]];
    i++;
  }
  // objet écrit : ni une fonction ni un prototype (cf. _mjsDeepRefus)
  if (_mjsDeepInterdit(o)) return value;
  // clé déjà convertie en tête de l'aide : la règle des types, la comparaison et l'écriture voient la même clé
  var __last = path[path.length - 1];
  // Déballe la VALEUR écrite (pas seulement `o`, le conteneur navigué ci-dessus) : un pair peut
  // renvoyer un objet doublement enveloppé (écho de liaison) — même logique que `_set`, éléments d'une
  // liste compris (`$o.items = $o.items.filter(…)`). Une primitive, que `µ._mjs_rawIn` rendrait telle quelle, passe sans
  // l'appel : il pèserait dans le budget d'inlining de V8 (cf. _mjsDeepChemin)
  if (value !== null && typeof value === 'object') value = µ._mjs_rawIn(value);
  // types (mjs_types.ts) : un champ ou un élément sous une valeur typée passe la règle de son
  // conteneur — clé calculée comprise (`$x[cle] = v`), contrôlée ici, à l'écriture. Valeur rendue :
  // celle écrite par le code (sémantique d'une affectation), même convertie, ramenée ou refusée
  var __ecrite = value;
  var __treg = el._mjs_treg;
  if (__treg !== void 0 && __treg.has(o)) {
    value = µ._mjs_tdeep(el, __treg, o, __last, value);
    if (value === µ._mjs_TNO) return __ecrite;
  }
  if (isRaw) {
    o[__last] = value;
    return __ecrite;
  }
  // Garde d'égalité : `$obj.x = mêmeValeur` ne doit pas forcer un re-render.
  if (o[__last] === value) return __ecrite;
  // Snapshot pour µ.inspect (seulement si activé pour cette top-key).
  var __ins = el._mjs_inspections;
  var __snap = (__ins && __ins.has(topKey)) ? µ._mjs_snap(el._state[topKey]) : void 0;
  o[__last] = value;
  // Même geste que le set trap du Proxy filet (_mjs_wrapDeep, mjs_element.ts) :
  // le CÔTÉ MUTANT enregistre SA PROPRE époque tout de suite, sur la RACINE —
  // sans ça, un enfant lié en two-way (`obj=!{$obj}`) qui mute profondément
  // l'objet partagé ne fait jamais avancer l'époque que le parent compare dans
  // `_set` pour distinguer un écho d'une mutation réelle : le parent croit
  // recevoir un écho et ne se redessine jamais, quelle que soit la profondeur.
  // Tant qu'aucun objet de l'état n'est tenu par deux composants (`µ._mjs_partage`, posé par `_set`, mjs_element.ts),
  // personne ne compare d'époque : l'écriture s'en dispense (une recherche et une écriture dans une WeakMap de moins)
  if (µ._mjs_partage) (el._mjs_bindEpochs || (el._mjs_bindEpochs = {}))[topKey] = µ._mjs_bumpEpoch(root);
  // prévient toutes les variables qui atteignent l'objet écrit, pas seulement `topKey` : après
  // `$sel = it ; $sel.n = 'Z'`, la liste `$items` qui affiche le même objet se redessine aussi
  // (même geste que l'enveloppe ; idem pour `_mjs_deepCall` et `_mjs_deepDelete` plus bas)
  el._mjs_notifyMutationAliased(o, topKey, __snap);
  return __ecrite;
};

// `µ._mjs_deepCall(el, ['list'], 'push', [item])` : appelle une méthode mutative
// sur un sous-objet et notifie la mutation à la clé top-level.
µ._mjs_deepCall = function(el, path, methodName, args) {
  var i, o, a, result, topKey, isRaw, root;
  if (!_mjsDeepChemin(path)) return void 0;
  if (methodName === '__proto__' || methodName === 'constructor' || methodName === 'prototype') { _mjsDeepRefus(methodName); return void 0; }
  topKey = path[0];
  // Naviguer + appeler sur la cible BRUTE : appeler la méthode mutative via le
  // Proxy re-déclencherait le set trap (index + length) → notifs multiples, en
  // plus de la notif explicite ci-dessous.
  o = _mjsDeepRacine(el._state[topKey]);
  root = o; // racine (avant navigation) — cf. commentaire epoch de _mjs_deepSet
  // racine marquée µ.raw : mêmes sémantiques que `_mjs_wrapDeep`
  // (mjs_element.ts) — la méthode s'appelle, mais ne notifie JAMAIS.
  isRaw = µ._mjs_rawSet.has(o);
  i = 1;
  while (i < path.length) {
    o = o[path[i]];
    i++;
  }
  // objet modifié : ni une fonction ni un prototype (cf. _mjsDeepRefus)
  if (_mjsDeepInterdit(o)) return void 0;
  // Déballe aussi chaque ARGUMENT (ex. `arr.push($objEnveloppé)`) — pas seulement `o` ci-dessus. Sur place : le code
  // compilé écrit la liste des arguments en littéral, neuve à chaque appel ; une valeur qui n'est pas un objet passe telle
  // quelle (`µ._mjs_toRaw` la rendrait telle quelle), sans appel ni liste ni fonction fabriquées à chaque écriture
  for (i = 0; i < args.length; i++) {
    a = args[i];
    if (a !== null && typeof a === 'object') args[i] = µ._mjs_toRaw(a);
  }
  // types (mjs_types.ts) : une liste typée modifiée par une méthode (push, splice, sort…) fait
  // contrôler ce qu'elle a changé ; refusée, la méthode est défaite, et personne n'est prévenu
  var __treg = el._mjs_treg;
  var __avant = (__treg !== void 0 && Array.isArray(o) && __treg.has(o)) ? µ._mjs_tbefore(o, methodName) : void 0;
  if (isRaw) {
    result = o[methodName].apply(o, args);
    if (__avant !== void 0) µ._mjs_tafter(el, __treg, o, __avant, methodName, args, result);
    return result;
  }
  // Snapshot pour µ.inspect (seulement si activé pour cette top-key).
  var __ins = el._mjs_inspections;
  var __snap = (__ins && __ins.has(topKey)) ? µ._mjs_snap(el._state[topKey]) : void 0;
  result = o[methodName].apply(o, args);
  if (__avant !== void 0 && !µ._mjs_tafter(el, __treg, o, __avant, methodName, args, result)) return result;
  // même geste que _mjs_deepSet : fait avancer l'époque AVANT de notifier, pour
  // que le two-way (mjs-bind:X) distingue un écho d'une mutation réelle — si un objet de l'état est tenu par deux composants
  if (µ._mjs_partage) (el._mjs_bindEpochs || (el._mjs_bindEpochs = {}))[topKey] = µ._mjs_bumpEpoch(root);
  el._mjs_notifyMutationAliased(o, topKey, __snap);
  return result;
};

// `µ._mjs_deepDelete(el, ['obj', 'clé'])` : supprime une sous-propriété
// (`delete $.obj.clé`) et notifie la mutation à la clé top-level. Calqué sur
// µ._mjs_deepSet — navigue la cible BRUTE (µ._mjs_RAW) pour ne pas repasser par le Proxy
// (qui re-notifierait). Émis par le visiteur UnaryExpression du path-tracker
// (cf. generator/path-tracker.ts) : `delete $.x.y` → `µ._mjs_deepDelete(_mjsThis, […])`.
// Le trap `deleteProperty` de `_mjs_wrapDeep` couvre en plus les delete ÉCHAPPÉS
// (via alias/param non tracé statiquement), en miroir du trap `set`.
// Rend `true` (résultat d'un `delete` réussi, sémantique JS), jamais le retour
// de la notification — même raison que `_mjs_deepSet`.
µ._mjs_deepDelete = function(el, path) {
  var i, o, topKey, isRaw, root;
  if (!_mjsDeepChemin(path)) return false;
  topKey = path[0];
  if (path.length === 1) {
    // `delete $.x` : on retire la clé racine de l'état puis on notifie.
    delete el._state[topKey];
    el._mjs_notifyMutation(topKey);
    return true;
  }
  o = _mjsDeepRacine(el._state[topKey]);
  root = o; // racine (avant navigation) — cf. commentaire epoch de _mjs_deepSet
  // racine marquée µ.raw : mêmes sémantiques que `_mjs_wrapDeep`
  // (mjs_element.ts) — la suppression s'écrit, mais ne notifie JAMAIS.
  isRaw = µ._mjs_rawSet.has(o);
  for (i = 1; i < path.length - 1; i++) { o = o[path[i]]; }
  // objet modifié : ni une fonction ni un prototype (cf. _mjsDeepRefus)
  if (_mjsDeepInterdit(o)) return false;
  // types : un champ obligatoire d'un objet typé ne se supprime pas (clé déjà convertie en tête de l'aide)
  var __cle = path[path.length - 1];
  var __treg = el._mjs_treg;
  if (__treg !== void 0 && !µ._mjs_tdelete(el, __treg, o, __cle)) return false;
  if (isRaw) {
    delete o[__cle];
    return true;
  }
  delete o[__cle];
  // même geste que _mjs_deepSet : fait avancer l'époque AVANT de notifier, pour
  // que le two-way (mjs-bind:X) distingue un écho d'une mutation réelle — si un objet de l'état est tenu par deux composants
  if (µ._mjs_partage) (el._mjs_bindEpochs || (el._mjs_bindEpochs = {}))[topKey] = µ._mjs_bumpEpoch(root);
  el._mjs_notifyMutationAliased(o, topKey);
  return true;
};

// `$` lu comme une valeur, et non comme `$.x` ou `$[k]` (`Object.assign($, …)`, `Reflect.set($, k, v)`, `const s = $`, `f($)`,
// la tête d'une boucle `for ($x of l)`) : le compilateur le rend par `µ._mjs_makeDeepProxy(_mjsThis, [])` (transform-reactive.ts),
// l'état du composant enveloppé. Une écriture par l'enveloppe passe par `_set`, comme `$x = v` ; une suppression par
// `µ._mjs_deepDelete`, comme `delete $x` ; une définition (`Object.defineProperty`) prévient la variable : les valeurs dérivées qui
// la lisent se recalculent, l'écran suit. Sous un nom réservé (`__proto__`, `constructor`, `prototype`), la définition pose une
// propriété propre de l'état, comme sur un objet ordinaire (aucun prototype n'est touché), sans prévenir de variable. Une seule
// enveloppe par composant (`$ === $` reste vrai), qui se déballe comme les autres (`µ._mjs_toRaw`) ; une lecture rend ce que rend l'état
function _mjsStateProxy(el) {
  return el._mjs_stateProxy ||= new Proxy(el._state, {
    get(t, k) {
      return k === µ._mjs_RAW ? t : t[k];
    },
    set(t, k, v) {
      el._set(k, v);
      return true;
    },
    deleteProperty(t, k) {
      µ._mjs_deepDelete(el, [k]);
      return true;
    },
    defineProperty(t, k, d) {
      if (!Reflect.defineProperty(t, k, d)) return false;
      if (µ._mjs_safeKey(k)) el._mjs_notifyMutation(k);
      return true;
    }
  });
}

// `µ._mjs_makeDeepProxy(el, path)` : alias public pour _mjs_wrapDeep, utilisé
// au point d'escape détecté par le compilateur (function call externe,
// storage non-tracké, etc.). Un nom réservé du chemin est refusé comme dans les trois aides (cf. _mjsDeepRefus) :
// rien n'est enveloppé, `undefined` est rendu — sans quoi l'enveloppe d'un prototype (atteint par un objet gelé de
// l'état, que l'état enveloppé rend brut) ferait écrire dans ce prototype tout code qui la reçoit
µ._mjs_makeDeepProxy = function(el, path) {
  var i, o, topKey;
  // chemin vide : l'état lui-même (cf. _mjsStateProxy)
  if (!path.length) return _mjsStateProxy(el);
  if (!_mjsDeepChemin(path)) return void 0;
  topKey = path[0];
  o = el._state[topKey];
  i = 1;
  while (i < path.length) {
    o = o[path[i]];
    i++;
  }
  return el._mjs_wrapDeep(o, topKey);
};
