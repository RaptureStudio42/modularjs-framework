// mjs_element.ts
var MJS_BOOLEAN_PROPS, MJS_NATIVE_ATTRS, MJS_SET_MUTATORS, MJS_MAP_MUTATORS, MJS_DATE_MUTATORS, MJS_ARRAY_MUTATORS,
  MJS_RESOLVED_DESTROY,
  hasProp = {}.hasOwnProperty;

// Promesse résolue PARTAGÉE (une seule alloc au chargement du module) : le chemin
// dominant de `_mjs_destroyNodeAndChildren` (pas de crochet de destruction) est 100 %
// synchrone — la renvoyer garde le même contrat pour les appelants (`.then`/`.catch`
// disponibles, `mjs_if.ts`/`mjs_key.ts`/`mjs_html.ts` chaînent un `.catch` dessus) sans
// allouer une Promise neuve à chaque destruction.
MJS_RESOLVED_DESTROY = Promise.resolve();

// blocs `<wrapper>` : l'enveloppe (Proxy) des objets de l'état, `_mjs_wrapDeep`, et ce qu'elle est seule à appeler ; retirés du cœur par
// le bundler avec le réglage `proxy: false` de mjs.config.json, en production comme en développement, où `_mjs_wrapDeep` prend le texte de
// `<no-wrapper>` : l'objet rangé tel quel
// <wrapper>
// Static sets module-level : évite N × `new Set([…])` par appel à
// `_mjs_wrapDeep`. Les Sets sont identiques pour TOUS les Proxy Set/Map/Date,
// pas besoin d'une instance par target.
MJS_SET_MUTATORS = new Set(['add', 'delete', 'clear']);
MJS_MAP_MUTATORS = new Set(['set', 'delete', 'clear']);
// Toutes les méthodes mutatrices de Date (setTime, setDate, setHours…).
// Les méthodes UTC sont incluses car elles mutent aussi l'instance.
MJS_DATE_MUTATORS = new Set([
  'setTime',
  'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds',
  'setUTCFullYear', 'setUTCMonth', 'setUTCDate', 'setUTCHours', 'setUTCMinutes', 'setUTCSeconds', 'setUTCMilliseconds',
  'setYear', // legacy mais toujours présente
]);
// méthodes qui changent une liste, appelées sur son enveloppe par un code qui la reçoit (`trier($rows)`) : jouées sur la liste
// brute, le composant prévenu une fois après (cf. _mjsEnvMut) — jamais redessiné au milieu de l'opération
MJS_ARRAY_MUTATORS = new Set(['pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'push']);

// pièges du Proxy de `_mjs_wrapDeep` (méthode mutatrice d'une Map/Set/Date, écriture, suppression) : la copie de
// l'objet d'avant la mutation, faite UNIQUEMENT si µ.inspect suit cette var — sinon coût prohibitif sur les
// tableaux et Map souvent mutés ; puis, la mutation faite (`h`, la fiche de l'objet écrit), l'époque de la var et la
// notification de toutes les clés qui atteignent l'objet
function _mjsSnapBefore(el, rootKey, obj) {
  const ins = el._mjs_inspections;
  return (ins && ins.has(rootKey)) ? µ._mjs_snap(obj) : void 0;
}
function _mjsMutated(h, obj, snap) {
  const el = h.e, rootKey = h.r;
  (el._mjs_bindEpochs ||= {})[rootKey] = µ._mjs_bumpEpoch(obj);
  // <middle>
  // un composant peut tenir un conteneur de l'objet écrit (`item={$o.a}`, puis `t = $o.a.b; t.c = v`) : la remontée fait avancer leurs
  // époques comme sous l'écriture directe (cf. _mjsLift) ; repliée, les liaisons des clés de l'objet écrit sont redites (cf. _mjsRetell)
  if (µ._mjs_middle && _mjsLift(h, obj)) return _mjsRetell(el, h, rootKey, 2, () => el._mjs_notifyMutationAliased(obj, rootKey, snap));
  // </middle>
  el._mjs_notifyMutationAliased(obj, rootKey, snap);
}
// </wrapper>
// <wall>
// écriture, définition ou suppression refusée par l'enveloppe de `_mjs_wrapDeep` dans un prototype : même avertissement que
// les aides d'écriture profonde (mjs_deep.ts), `seg` le segment qui y mène ; rend `true`, la valeur d'un refus du piège `set`
// ou `deleteProperty` (une écriture refusée ne lève pas, même en mode strict). Hors du bloc `<wrapper>` : les enveloppes de `µ.state`
// et de `µ.Store`, des Proxy même sous le réglage `proxy: false`, refusent par lui (cf. µ._mjs_wall) ; blocs `<wall>` : avec l'enveloppe,
// ou quand une unité du build écrit `µ.state` ou `µ.Store` (bundler/index.ts)
function _mjsEnvReject(seg) {
  µ.warn(µ._mjs_msg('initPath', { seg: seg }, 'chemin d\'état refusé (segment « {seg} ») — mutation ignorée.'));
  return true;
}
// <families>
// le même mur pour les enveloppes de `µ.state` et de `µ.Store` (fichiers à part) : quand l'objet brut `o` est un prototype (`Array.prototype`,
// `Object.prototype`, rangé par une clé venue de données ; même test que `__reject`, `_mjs_wrapDeep`), la fiche `f` de son enveloppe prend
// pour pièges `t` avec, par-dessus, l'écriture, la suppression, la définition, la fermeture aux ajouts et le changement de prototype refusés
// (`_mjsEnvReject`) ; rend `true` alors. Appelé une fois, à la création de l'enveloppe : une écriture ordinaire n'en paie rien. Le mur d'un
// jeu de pièges est fait une fois
const _mjsWalls = new Map();
µ._mjs_wall = (o, f, t) => {
  let c, m;
  if (!((c = o.constructor) && c.prototype === o)) return false;
  if ((m = _mjsWalls.get(t)) === void 0) {
    const non = () => _mjsEnvReject('__proto__'), falsy = () => !_mjsEnvReject('__proto__');
    _mjsWalls.set(t, m = { __proto__: t, set: non, deleteProperty: non, defineProperty: falsy, preventExtensions: falsy, setPrototypeOf: falsy });
  }
  Object.setPrototypeOf(f, m);
  return true;
};
// </families>
// </wall>
// <wrapper>

// pièges des enveloppes qui retiennent leur dernier enfant lu (`k`, `p`, cf. `_mjs_wrapDeep`) : oubliés à la microtâche qui suit
// la première lecture du tour — un objet retiré de l'état ne survit pas au tour, même si plus rien n'est relu dans son conteneur
const _mjsKids = [];
function _mjsKidsForget() {
  for (const h of _mjsKids) h.k = h.p = void 0;
  _mjsKids.length = 0;
}

// pièges des enveloppes de `_mjs_wrapDeep`, COMMUNS à toutes : `this` est la fiche de l'objet enveloppé, le gestionnaire de son Proxy, qui ne
// garde que des champs — `e` le composant, `r` la clé qui a créé l'enveloppe, `s` l'ensemble des clés qui atteignent l'objet, fait à la
// deuxième seulement (une clé, le cas courant : `r` suffit, aucun ensemble par objet), `x` l'enveloppe, `f` le
// refus d'un prototype, `t` les mutateurs d'une Map, d'un Set, d'une date, `q` vrai pour Map, Set, date, expression régulière, `m` et `o` les
// méthodes liées (du prototype, propres à l'objet), `u` l'enveloppeur de ce qui sort par une méthode de lecture, tous trois faits au premier
// besoin, `k` `p` `n` le dernier enfant lu, `a` `b` `v` les liens vers ses conteneurs, `l` ceux au-delà de deux, champ posé au troisième seulement (cf. _mjsBind, seulement si un composant reçoit une prop). Aucune fonction par enveloppe : une méthode liée se fait dans une aide, avec ses seules valeurs,
// jamais dans un piège, où elle garderait la lecture en cours. Les pièges sont les méthodes d'une classe, dont le corps est toujours strict :
// que le cœur soit chargé en module ou évalué comme un script (rendu côté serveur, tests), une écriture que le moteur refuse (champ de
// plus dans un objet gelé, propriété en lecture seule, suppression d'une propriété qui ne se supprime pas) lève par l'enveloppe l'erreur
// qu'elle lève sur l'objet lui-même, et personne n'est prévenu
const MJS_ENV_TRAPS = (class {
  get(obj, prop, _receiver) {
    // Fast-path Symbol (Symbol.iterator, Symbol.toPrimitive, etc.)
    if (typeof prop === 'symbol') {
      // (a) — accès à la cible BRUTE (utilisé par µ._mjs_deepSet/µ._mjs_deepCall pour
      // muter sans re-déclencher le set trap → évite la double invalidation).
      if (prop === µ._mjs_RAW) return obj;
      const val = obj[prop];
      // <precision>
      // <derived-values>
      // fonction lue pendant le calcul d'une valeur précise (itérateur, conversion), propre à l'objet ou héritée d'un prototype
      // qui n'est pas du langage (`Symbol.toPrimitive` d'une classe, cf. _mjsFnLang) : du code de l'application, qui peut
      // lire par une fermeture un état que MJS écrit — la règle de toujours, objet gelé compris (regardée avant la garde qui
      // rend telle quelle une valeur figée) ; une autre valeur, comme pour un champ nommé : héritée (accesseur
      // `Symbol.toStringTag` ou `Symbol.isConcatSpreadable` d'une classe), ou `undefined` venu d'un prototype qui n'est ni
      // celui des objets ni celui des listes (cf. _mjsAbsentInherited)
      if (_mjsP !== null && (typeof val === 'function' ? hasProp.call(obj, prop) || !_mjsFnLang.has(val) : val === void 0 ? _mjsAbsentInherited(obj, prop) : !hasProp.call(obj, prop))) _mjsDoubtCalc(_mjsP);
      // </derived-values>
      // </precision>
      if (typeof val !== 'function' || µ._mjs_fixed(obj, prop)) return val;
      // (c) — for-of / spread / déstructuration : le Symbol.iterator d'un
      // Array plain doit yield des éléments PROXIFIÉS (réactifs), comme
      // `.forEach` — sinon `for (t of $arr) t.x = …` ne re-rend pas.
      // Map/Set : même ré-enveloppement que `entries()` (Map) / `values()` (Set), plus bas
      if (prop === Symbol.iterator) return this.q ? µ._mjs_readFn(obj, prop, val, this.x, this.u ??= _mjsEnvWrap(this, obj)) : val.bind(this.x);
      return val.bind(obj);
    }

    const val = obj[prop];
    // <precision>
    // <derived-values>
    // lus pendant le calcul d'une valeur précise, la règle de toujours : un objet brut (`µraw`), celle que demande la marque ;
    // une fonction propre à l'objet (méthode rangée dans l'objet, `get`, `map`…) ou héritée d'un prototype qui n'est pas du
    // langage (méthode, `toString` d'une classe ou d'un prototype fait par `Object.create`, `join` d'une sous-classe de liste,
    // cf. _mjsFnLang), du code de l'application qui peut lire par une fermeture un état que MJS écrit (une variable, un
    // magasin) ; la méthode d'un prototype du langage n'en paie rien ; une valeur qui n'est pas une donnée propre de l'objet
    // (accesseur d'une classe, champ hérité par `Object.create`, `size` d'une `Map`, Proxy de l'application) : elle vient d'un
    // objet que l'enveloppe ne range pas sous la clé de la variable, et une autre variable qui écrit cet objet
    // (`$base.prix = 10`) ne préviendrait pas la valeur ; `undefined` de même, quand le prototype de l'objet n'est ni celui
    // des objets ni celui des listes (champ absent d'un objet fait par `Object.create`, accesseur d'une classe qui le rend
    // au départ, cf. _mjsAbsentInherited)
    if (_mjsP !== null && (typeof val === 'function' ? hasProp.call(obj, prop) || !_mjsFnLang.has(val) : val === void 0 ? _mjsAbsentInherited(obj, prop) : !hasProp.call(obj, prop) || (val !== null && typeof val === 'object' && µ._mjs_rawSet.has(val)))) _mjsDoubtCalc(_mjsP);
    // méthode de parcours d'une liste, à sa première lecture par l'enveloppe (méthode du prototype) : la fonction du
    // parcours d'un bloc (cf. _mjsWalk), gardée et rendue comme une méthode liée
    if (typeof val === 'function' && val === _mjsWalked[prop] && Array.isArray(obj) && !this.m?.has(prop) && !hasProp.call(obj, prop)) (this.m ||= new Map()).set(prop, _mjsWalk(this.e, obj, prop, this.r, this, this.x));
    // <derived-check>
    // calcul d'une valeur précise hors production et sa relecture de contrôle (cf. _mjsPrecise, _mjsRereading) : l'accesseur
    // propre qu'ils lisent se relève, avec ce qu'il rend ; l'avertissement nomme celui qui rend autre chose
    if (_mjsRereads !== null) _mjsReread(obj, prop, val);
    // </derived-check>
    // </derived-values>
    // </precision>

    // SÉCURITÉ — pollution de prototype EN LECTURE (CWE-1321) : `__proto__`/
    // `constructor`/`prototype` HÉRITÉS (pas une donnée propre de l'objet) ne doivent
    // jamais fuir à travers ce Proxy — les exposer les enveloppe récursivement (branche
    // plain plus bas), et écrire sur l'enveloppe pollue le PROTOTYPE RÉEL, partagé par
    // tout le realm. Une clé PROPRE (l'utilisateur a volontairement une donnée nommée
    // `constructor` etc.) reste lue normalement. Même famille que le set trap plus bas
    // (`µ._mjs_safeKey`, écriture) — ici, c'est la LECTURE qui était sans garde.
    if (
      (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') &&
      !hasProp.call(obj, prop)
    ) {
      return void 0;
    }

    // Fonction de l'appli propre à l'objet ou à la liste (`$outil = { format: (n) -> n }`) : son relais (µ._mjs_fnRelay, mjs_init.ts),
    // gardé par l'enveloppe — `this` reste l'enveloppe quand on l'appelle seule, un champ écrit par toute variable qui le tient
    // (`f := $outil.format; f.appels = 10`) va à la fonction et prévient les clés qui atteignent l'objet ; une fonction du
    // navigateur rangée dans un objet (`Object`, `setTimeout`) se lit par sa copie, qui garde le `this` reçu, sans que ni elle ni son
    // `prototype` ne s'atteignent par elle (µ._mjs_natCopy, mjs_init.ts).
    // Méthode, liée une fois par enveloppe (`m`, `o`). Set/Map/Date/RegExp : leurs internal
    // slots ne survivent pas au Proxy — liée à la cible ; les méthodes mutatives notifient la
    // mutation. `Map.get(k)`, `forEach`, les itérateurs rendaient la valeur INTERNE brute par un
    // appel natif, HORS de ce trap : ré-enveloppée par l'aide commune (µ._mjs_readFn, mjs_init.ts) ;
    // la clé d'une Map sort enveloppée comme la valeur (`get`, `has`, `set`, `delete` la retrouvent sous toutes ses formes), `has` d'un
    // Set retrouve l'élément rendu enveloppé. Objet ou liste : liée au PROXY (pas obj) → mutations
    // `this.x = y` dans la méthode passent par le proxy set handler → re-render correct ; liste :
    // `indexOf`, `includes`, `find`… retrouvent l'objet poussé, tenu brut ou par son enveloppe.
    // `obj[prop]` au lieu de Reflect.get pour que les getters soient
    // invoqués avec `this = obj` (crucial pour champs privés `#x`).
    // propriété FIGÉE (µ._mjs_fixed, mjs_init.ts : objet gelé, propriété ni modifiable ni configurable d'un objet
    // fermé aux ajouts) : la règle des Proxy exige SA valeur, rendue brute — une enveloppe ou une méthode liée
    // faisait lever le moteur à la lecture, et le rendu tombait. Testée seulement pour un objet ou une fonction :
    // la lecture d'une primitive ne la paie pas
    if (typeof val === 'function') {
      // méthode du prototype déjà liée : rendue sans payer la garde, la règle des Proxy ne visant que les propriétés
      // propres ; une méthode propre se garde à chaque lecture (objet gelé après coup : SA valeur)
      let bound = this.m?.get(prop);
      if (bound !== undefined) return bound;
      if (µ._mjs_fixed(obj, prop)) return val;
      const own = hasProp.call(obj, prop);
      // relais rangé pour une fonction remplacée depuis par le chemin (`$outil.format = g`, écrit sur l'objet brut, hors de ce
      // piège) : refait pour la nouvelle
      if (own && (bound = this.o?.get(prop)) !== undefined && (bound[µ._mjs_RAW] ?? val) === val) return bound;
      bound = (this.t && this.t.has(prop)) ? _mjsEnvMut(this, obj, prop, val)
        : own && !this.q && !_mjsNatFn(val) ? µ._mjs_fnRelay(val, this.x, _mjsEnvRelay(this, obj))
        : own && !this.q && !Array.isArray(obj) ? µ._mjs_natCopy(val, obj)
        : (this.q || Array.isArray(obj)) ? µ._mjs_readFn(obj, prop, val, this.x, this.u ??= _mjsEnvWrap(this, obj)) : val.bind(this.x);
      (own ? (this.o ||= new Map()) : (this.m ||= new Map())).set(prop, bound);
      return bound;
    }
    if (this.q) {
      // <precision>
      // <derived-values>
      // objet rangé dans un champ propre d'une `Map`, d'un `Set` ou d'une date (`$m.meta`), lu pendant le calcul d'une valeur
      // précise : rendu tel quel, sans être rangé sous la clé de la variable, et une autre variable qui l'écrit
      // (`$ligne.prix = 10`) ne préviendrait pas la valeur — la règle de toujours
      if (_mjsP !== null && val !== null && typeof val === 'object') _mjsDoubtCalc(_mjsP);
      // </derived-values>
      // </precision>
      return val;
    }

    // Plain object/array : fast path.
    if (val !== null && typeof val === 'object' && !µ._mjs_rawSet.has(val)) {
      if (µ._mjs_fixed(obj, prop)) {
        // <precision>
        // <derived-values>
        // propriété figée lue pendant le calcul d'une valeur précise (objet ou liste gelés) : son objet se rend tel quel, sans
        // être rangé sous la clé de la variable, et une autre variable qui l'écrit (`$sel = $rows[1]` puis `$sel.nom = …`) ne
        // préviendrait pas la valeur — la règle de toujours
        if (_mjsP !== null) _mjsDoubtCalc(_mjsP);
        // </derived-values>
        // </precision>
        return val;
      }
      if (val === this.k && this.n === (this.s === void 0 ? 1 : this.s.size)) return this.p;
      // <middle>
      // premier sous-objet enveloppé de ce conteneur : sa référence faible, que ses sous-objets gardent pour lien (cf. _mjsBind)
      if (this.v === void 0) this.v = _mjsRef(obj);
      // </middle>
      const kp = this.e._mjs_wrapDeep(val, this.r, this);
      // <precision>
      // <derived-values>
      // objet que l'enveloppe ne suit pas (`Error`, objet natif, étiqueté par `Symbol.toStringTag`), rendu tel quel : même
      // règle ; jamais retenu ci-dessous, la lecture suivante d'une valeur précise repasse par ce contrôle
      if (kp === val) {
        if (_mjsP !== null) _mjsDoubtCalc(_mjsP);
        return val;
      }
      // </derived-values>
      // </precision>
      // premier enfant retenu depuis le dernier oubli : le piège s'inscrit, la microtâche suivante l'oublie
      if (!this.k && _mjsKids.push(this) === 1) queueMicrotask(_mjsKidsForget);
      this.k = val;
      this.p = kp;
      this.n = this.s === void 0 ? 1 : this.s.size;
      return kp;
    }
    return val;
  }
  set(obj, prop, value, _receiver) {
    // SÉCURITÉ — defense-in-depth : ce Proxy est le
    // filet d'un alias ÉCHAPPÉ (`externalMerge($obj, untrusted)`) ; une clé
    // `__proto__`/`constructor`/`prototype` d'une source non fiable ne doit
    // pas polluer le prototype. Les Symbols passent (µ._mjs_safeKey ne bloque que
    // les 3 chaînes dangereuses).
    if (!µ._mjs_safeKey(prop)) return true;
    if (this.f) return _mjsEnvReject(this.f);
    const el = this.e, rootKey = this.r;
    // déballe une valeur ENTRANTE déjà enveloppée (par CE composant
    // ou un autre) : `$a.nested = $b` (où `$b` est déjà un Proxy réactif) ne
    // doit pas empiler Proxy-de-Proxy — même idiome que les set-traps runes
    // (mjs_runes.ts).
    value = µ._mjs_rawIn(value);
    // types (mjs_types.ts) : l'écriture passe la règle de son conteneur, s'il en a une — un
    // alias échappé (`regler($x)`) n'y échappe pas ; refusée, elle n'a simplement pas lieu
    const __treg = el._mjs_treg;
    if (__treg !== void 0 && __treg.has(obj)) {
      value = µ._mjs_tdeep(el, __treg, obj, prop, value);
      if (value === µ._mjs_TNO) return true;
    }
    // Snapshot pour µ.inspect (seulement si activé pour cette var).
    const __snapSet = _mjsSnapBefore(el, rootKey, obj);
    if (this.q) {
      obj[prop] = value;
      if (!µ._mjs_rawSet.has(obj)) _mjsMutated(this, obj, __snapSet);
      return true;
    }
    const __av = obj[prop];
    if (__av === value) {
      return true;
    }
    // Invalide le cache de méthode si la prop est réécrite avec une
    // fonction différente (rare mais possible).
    this.m?.delete(prop);
    this.o?.delete(prop);
    obj[prop] = value;
    // <middle>
    // l'objet remplacé sort de ce conteneur (cf. _mjsExited)
    if (µ._mjs_middle && this.v != null && __av !== null && typeof __av === 'object') _mjsExited(el._mjs_rootsByTarget, this.v, obj, __av);
    // </middle>
    if (!µ._mjs_rawSet.has(obj)) {
      // le CÔTÉ MUTANT enregistre SA PROPRE époque tout de suite :
      // sans ça, l'écho qui revient de la frontière two-way ne se
      // distinguerait pas d'une mutation externe, et se re-notifierait
      // lui-même (cf. `_set`, comparaison oldRaw/parsed + époque).
      _mjsMutated(this, obj, __snapSet);
    }
    // <precision>
    // <derived-values>
    // objet brut écrit par cette enveloppe : personne n'est prévenu, ses valeurs précises doutent
    else _mjsDoubtKeys(el, this.s || [this.r]);
    // </derived-values>
    // </precision>
    return true;
  }
  // `deleteProperty` manquait : ce Proxy est le
  // FILET pour un alias ÉCHAPPÉ (`$obj` passé à une fonction externe qui
  // fait `delete alias.k`) — le path-tracking compile-time (path-tracker.ts,
  // visiteur UnaryExpression) ne voit QUE les `delete` écrits en clair dans
  // le script du composant, pas ceux exécutés depuis un code appelé. Sans ce
  // trap, `delete` sur l'alias supprimait bien la clé (Reflect par défaut)
  // mais ne notifiait JAMAIS `rootKey` → DOM figé. Symétrique du `set`
  // ci-dessus.
  deleteProperty(obj, prop) {
    // SÉCURITÉ — symétrique du set trap.
    if (!µ._mjs_safeKey(prop)) return true;
    if (this.f) return _mjsEnvReject(this.f);
    const el = this.e, rootKey = this.r;
    // types : un champ obligatoire d'un objet typé ne se supprime pas
    const __tregDel = el._mjs_treg;
    if (__tregDel !== void 0 && !µ._mjs_tdelete(el, __tregDel, obj, prop)) return true;
    const __snapDel = _mjsSnapBefore(el, rootKey, obj);
    const had = prop in obj;
    this.m?.delete(prop);
    this.o?.delete(prop);
    // <middle>
    // l'objet supprimé sort de ce conteneur (cf. _mjsExited) : lu avant, sans appeler d'accesseur
    const __avD = µ._mjs_middle && this.v != null ? Reflect.getOwnPropertyDescriptor(obj, prop)?.value : void 0;
    // </middle>
    delete obj[prop];
    // <middle>
    if (__avD != null && typeof __avD === 'object') _mjsExited(el._mjs_rootsByTarget, this.v, obj, __avD);
    // </middle>
    if (had && !µ._mjs_rawSet.has(obj)) _mjsMutated(this, obj, __snapDel);
    // <precision>
    // <derived-values>
    if (had && µ._mjs_rawSet.has(obj)) _mjsDoubtKeys(el, this.s || [this.r]);
    // </derived-values>
    // </precision>
    return true;
  }
  // SÉCURITÉ — `Object.defineProperty(proxy, '__proto__', …)`
  // contournait le `set`/`deleteProperty` ci-dessus (chemin d'écriture DIFFÉRENT du Proxy) :
  // même garde (filet d'un alias ÉCHAPPÉ, cf. commentaire du `set` plus haut), mais la définition refusée rend faux :
  // `Object.defineProperty` lève alors une `TypeError`, là où le `set` refusé se tait
  // Une définition faite est une écriture, comme par le `set` : l'écran suit, les valeurs dérivées qui lisent l'objet se refont
  defineProperty(obj, prop, desc) {
    if (!µ._mjs_safeKey(prop)) return false;
    if (this.f) {
      _mjsEnvReject(this.f);
      return false;
    }
    const el = this.e, rootKey = this.r;
    // <development>
    // développement : une définition sur un objet venu d'une prop est dite comme une écriture (mjs_debug.ts)
    µ._mjs_devDefined?.(el, obj, rootKey, prop);
    // </development>
    const __snapDef = _mjsSnapBefore(el, rootKey, obj);
    // une définition qui ne change rien (la propriété est déjà une donnée propre, chaque attribut donné y est déjà le même selon `Object.is`, la règle de la définition, où `-0` sur `0` change la donnée) :
    // faite sans prévenir personne, comme l'affectation `$s.k = v` à valeur égale ; une clé absente (même à `undefined`),
    // un attribut changé seul ou un accesseur est une écriture
    const __before = Reflect.getOwnPropertyDescriptor(obj, prop);
    const __equal  = !this.q && __before && 'value' in __before && Object.keys(desc).every((k) => k in __before && Object.is(__before[k], µ._mjs_rawIn(desc[k])));
    if (!Reflect.defineProperty(obj, prop, desc)) return false;
    if (__equal) return true;
    this.m?.delete(prop);
    this.o?.delete(prop);
    // <precision>
    // <derived-values>
    _mjsDefined(el, obj, desc, this);
    // </derived-values>
    // </precision>
    if (!µ._mjs_rawSet.has(obj)) _mjsMutated(this, obj, __snapDef);
    // <precision>
    // <derived-values>
    // objet brut : personne n'est prévenu, ses valeurs précises doutent
    else _mjsDoubtKeys(el, this.s || [this.r]);
    // </derived-values>
    // </precision>
    return true;
  }
  // SÉCURITÉ — `Object.setPrototypeOf(proxy, evil)` changeait le
  // PROTOTYPE en un seul appel, hors de portée du trap `set` (pas une écriture de clé).
  setPrototypeOf(obj, proto) {
    // message copié à tort du store (mjs_store.ts) :
    // ici c'est l'ÉTAT RÉACTIF d'un COMPOSANT (_mjs_wrapDeep), pas le store global.
    µ.warn(µ._mjs_msg('elProto', null, 'état : changement de prototype refusé'));
    return false;
  }
}).prototype;
// ce qui sort d'une liste, d'une Map ou d'un Set par une méthode de lecture (µ._mjs_readFn, mjs_init.ts) : même enveloppe qu'une lecture par
// indice — un objet modifié pendant une itération prévient le composant ; `h`, la fiche du conteneur `obj`
// la clé `k` atteint l'objet de la fiche `f` : une clé de plus que celle qui l'a créée fait son ensemble
function _mjsKeyOf(f, k) {
  if (k !== f.r) (f.s ||= new Set([f.r])).add(k);
}
function _mjsEnvWrap(h, obj) {
  return (v) => {
    // <middle>
    // premier sous-objet rendu par une méthode de lecture : la référence faible du conteneur `obj`, pour son lien (cf. _mjsBind)
    if (h.v === void 0 && v !== null && (typeof v === 'object' || typeof v === 'function')) h.v = _mjsRef(obj);
    // </middle>
    // <precision>
    // <derived-values>
    // pendant le calcul d'une valeur précise, un objet rendu tel quel fait douter le calcul (cf. _mjsRawRead)
    if (_mjsP !== null) return _mjsRawRead(v, h.e._mjs_wrapDeep(v, h.r, h));
    // </derived-values>
    // </precision>
    return h.e._mjs_wrapDeep(v, h.r, h);
  };
}
// méthode mutatrice d'une Map, d'un Set, d'une date (`prop`, fonction `val` de l'objet brut `obj`), liée une fois par enveloppe
function _mjsEnvMut(h, obj, prop, val) {
  return function(...args) {
    const __snap = _mjsSnapBefore(h.e, h.r, obj);
    // liste (`pop`, `splice`, `sort`… appelés par un code qui la reçoit) : arguments déballés, méthode jouée sur la liste brute, comme
    // la même méthode écrite dans le composant (µ._mjs_deepCall, mjs_deep.ts) ; la liste rendue (`sort`, `reverse`…) sort enveloppée
    if (Array.isArray(obj)) {
      for (let i = 0; i < args.length; i++) args[i] = µ._mjs_rawIn(args[i]);
      // types : une liste typée fait contrôler ce que la méthode a changé ; refusée, la méthode est défaite, personne n'est prévenu
      const __treg  = h.e._mjs_treg;
      const __before = __treg !== void 0 && __treg.has(obj) ? µ._mjs_tbefore(obj, prop) : void 0;
      // la liste d'avant : sa longueur, et ses éléments pour une méthode qui les range autrement sans toucher à la longueur
      const __len   = obj.length;
      const __cp    = prop === 'sort' || prop === 'reverse' || prop === 'fill' || prop === 'copyWithin' ? obj.slice() : void 0;
      const result  = val.apply(obj, args);
      if (__before !== void 0 && !µ._mjs_tafter(h.e, __treg, obj, __before, prop, args, result)) return result === obj ? h.x : result;
      // liste inchangée (tri d'une liste déjà triée, `pop` d'une liste vide, `splice(0, 0)`) : personne n'est prévenu, comme sous le piège
      // d'écriture — un tri sur place relu à chaque rendu (`{for r in trier($rows)}`, `{for r in $rows.sort(cmp)}`, un reffet) ne tourne pas sans fin
      let __chg = obj.length !== __len;
      if (__cp !== void 0) for (let i = 0; i < __len && !__chg; i++) __chg = obj[i] !== __cp[i];
      else if (prop === 'splice') for (let i = 0; i < result.length && !__chg; i++) __chg = result[i] !== args[i + 2];
      // valeurs retirées par `pop`, `shift`, `splice` : rendues enveloppées, comme lues par l'enveloppe avant leur retrait — écrite ensuite
      // par ce nom (`o = x.pop()`, `o.n = 1`, `x.push(o)`), la ligne prévient l'enfant qui la tient
      const __out = prop === 'splice' ? result.slice() : prop === 'pop' || prop === 'shift' ? [result] : [];
      let __returned = result === obj ? h.x : result;
      for (let i = 0; i < __out.length; i++) {
        if (__out[i] === null || typeof __out[i] !== 'object' || µ._mjs_rawSet.has(__out[i])) continue;
        const __e = (h.u ??= _mjsEnvWrap(h, obj))(__out[i]);
        if (prop === 'splice') result[i] = __e;
        else __returned = __e;
      }
      if (!__chg) return __returned;
      // <middle>
      // et sorties de cette liste (cf. _mjsExited)
      if (µ._mjs_middle && h.v != null) for (let i = 0; i < __out.length; i++) if (__out[i] !== null && typeof __out[i] === 'object') _mjsExited(h.e._mjs_rootsByTarget, h.v, obj, __out[i]);
      // </middle>
      _mjsMutated(h, obj, __snap);
      return __returned;
    }
    // <collections>
    // ce que la méthode range (valeur d'une Map) : déballé, comme la même méthode écrite directement
    // (µ._mjs_deepCall, mjs_deep.ts) — une liste donnée est rangée telle quelle ; la clé d'une Map, l'élément
    // d'un Set : celle que la collection range pour cet objet, sous la forme donnée, brute ou enveloppée, une seule entrée
    // (cf. µ._mjs_keyIn)
    if (prop === 'add') args[0] = µ._mjs_keyIn(obj, args[0]);
    else if (prop === 'set') {
      args[0] = µ._mjs_keyIn(obj, args[0]);
      args[1] = µ._mjs_toRaw(args[1]);
    }
    // <middle>
    // valeur d'une Map remplacée ou retirée, clé d'une Map ou élément d'un Set retirés : sortis de cette collection (cf. _mjsExited)
    const __m  = µ._mjs_middle && h.v != null && (prop === 'set' || prop === 'delete') ? h.e._mjs_rootsByTarget : void 0;
    const __sv = __m !== void 0 && obj instanceof Map ? Map.prototype.get.call(obj, args[0]) : void 0;
    // </middle>
    let result = val.apply(obj, args);
    // l'élément d'un Set, la clé d'une Map donnés sous une autre forme que celle que tient la collection (enveloppés par
    // un parcours, bruts, enveloppés par une autre famille) se retirent aussi (cf. µ._mjs_keyAlt, mjs_init.ts)
    if (prop === 'delete' && !result) result = (args[0] = µ._mjs_keyAlt(obj, args[0])) !== void 0 && val.call(obj, args[0]);
    // <middle>
    if (__m !== void 0) {
      if (__sv != null && typeof __sv === 'object' && __sv !== args[1]) _mjsExited(__m, h.v, obj, __sv);
      if (prop === 'delete' && args[0] != null && typeof args[0] === 'object') _mjsExited(__m, h.v, obj, args[0]);
    }
    // </middle>
    // clé retirée, collection vidée : l'index de la collection l'oublie (cf. µ._mjs_keyDrop, mjs_init.ts)
    if (prop === 'delete' || prop === 'clear') µ._mjs_keyDrop(obj, prop === 'clear', args[0]);
    // </collections>
    // <no-collections>
    // // sans la part des collections : ce que la méthode range (élément d'un Set, valeur d'une Map) est déballé, la clé d'une Map reste
    // // telle quelle (`get` la retrouve sous la forme donnée) ; l'élément d'un Set rendu enveloppé par une itération se retire aussi
    // if (prop === 'add') args[0] = µ._mjs_toRaw(args[0]);
    // else if (prop === 'set') args[1] = µ._mjs_toRaw(args[1]);
    // let result = val.apply(obj, args);
    // if (obj instanceof Set && prop === 'delete' && !result) result = val.call(obj, µ._mjs_toRaw(args[0]));
    // </no-collections>
    // cf. commentaire jumeau du set-trap plus bas : le
    // mutateur natif (add/delete/clear/set…) EST le côté mutant.
    _mjsMutated(h, obj, __snap);
    return result;
  };
}
// champ écrit sur une fonction propre à l'objet `obj` par son relais (µ._mjs_fnRelay, mjs_init.ts) : une écriture de l'objet
function _mjsEnvRelay(h, obj) {
  return () => _mjsMutated(h, obj, _mjsSnapBefore(h.e, h.r, obj));
}
// </wrapper>
// <links>
// les liens vers les conteneurs, hors du bloc `<wrapper>` : `µ.state` et `µ.Store` restent des Proxy sous le réglage `proxy: false`
// et les appellent par `µ` (fichiers à part) ; une famille sans composant leur donne pour `el` un petit objet de même forme
// (`_mjs_rootsByTarget`, `_state`, `_mjs_computeds`, `_mjs_bindEpochs`, `_mjs_wr` absent : tout détenteur est un autre) ; blocs
// `<links>` : avec l'enveloppe, ou sous `proxy: false` quand une unité du build écrit `µ.state` ou `µ.Store` (bundler/index.ts)
// <middle>
// D'OÙ VIENT un objet enveloppé : sa fiche garde des liens FAIBLES vers les conteneurs par lesquels sa famille d'enveloppes l'a lu — `a`,
// celui de sa dernière lecture, `b`, le précédent, et `l`, la petite liste de ceux au-delà de deux, champ posé sur la fiche au troisième
// conteneur seulement — : les chemins qu'une écriture directe aurait dans son code (`$o.a.b.c = v`), pour l'écriture faite par un nom
// (`t = $o.a.b; t.c = v`). Le lien est la référence faible du conteneur (`v` de SA fiche, faite à son premier sous-objet enveloppé et
// partagée par tous : une seule pour une liste de 10 000 lignes) ; un objet gardé ne retient pas son ancien conteneur. Posé à la création
// de la fiche, revu à chaque lecture par un conteneur : une comparaison quand c'est le même. L'objet rangé à plusieurs endroits
// (`$o.liste[0]` et `$o.courant`, une ligne dans trois listes), relu ailleurs entre la prise du nom et l'écriture, ou qui se contient,
// garde tous ses chemins. Sans `WeakRef` (vieux navigateur), aucun lien : la fiche n'est pas sûre
function _mjsRef(o) {
  return typeof WeakRef === 'function' ? new WeakRef(o) : null;
}
// le lien `de` de la fiche `f` devient `vers`, à la place qu'il occupe ; rend faux quand la fiche ne l'a pas
function _mjsSwap(f, from, to) {
  const l = f.l, i = l === void 0 ? -1 : l.indexOf(from);
  if (f.a === from) f.a = to;
  else if (f.b === from) f.b = to;
  else if (i !== -1) l[i] = to;
  else return false;
  return true;
}
// SORTIE d'un conteneur, sue au moment de l'écriture, sans rien parcourir : l'objet `x` qu'une affectation, une suppression ou un
// mutateur vient de retirer du conteneur `c` (`w`, la référence faible de `c`) voit son lien vers lui devenir DOUTEUX — le jumeau de
// `w` (`w.q`, fait une fois par conteneur, qui rend le même conteneur et porte `w`). Le lien n'est pas retiré : rien ne dit en temps
// constant que l'objet n'est plus rangé ailleurs dans ce conteneur (deux lignes échangées, le même objet sous deux champs), et la
// remontée le suit toujours — au pire une époque avancée pour rien, jamais un enfant figé. Il redevient sûr quand l'objet est relu par
// ce conteneur (cf. _mjsBind). Les mutateurs qui ne rendent pas ce qu'ils retirent (`length`, `fill`, `copyWithin`, `clear`) et
// `Object.defineProperty` ne marquent rien : l'objet retiré reste lié jusqu'au ramasse-miettes. Appelée seulement quand un composant
// peut tenir un objet de l'état (µ._mjs_middle)
function _mjsExited(m, w, c, x) {
  const f = m.get(µ._mjs_toRaw(x));
  if (f === void 0 || f.a == null) return;
  if (w.q === void 0) (w.q = new WeakRef(c)).w = w;
  _mjsSwap(f, w, w.q);
}
// mjs_deep.ts, joint hors du cœur par la page des visionneuses, la lit sur `µ` (cf. VIEWER_RUNTIME, server/viewer-page.ts)
µ._mjs_exited = _mjsExited;
// l'objet de la fiche `f` est lu par un autre conteneur que celui de son premier lien (`x`, la référence faible de ce conteneur) : déjà
// connu, rien ; lien douteux vers lui, il redevient sûr ; sinon il prend la première place, l'ancien premier passe second. Les deux
// places prises, il chasse le lien dont le conteneur ne porte plus rien dans l'état (cf. _mjsDrops : une liste remplacée, une ligne
// recopiée) ; si les deux portent encore l'objet, il va dans la liste `l`, d'où les liens morts se retirent au passage. Un objet tenu
// par plus de huit conteneurs vivants (le dictionnaire commun aux 10 000 lignes d'une table) ne se suit plus lien par lien, et sans
// référence faible (`x` nul) aucun lien ne se pose : la fiche n'est plus SÛRE — `a` nul, pour toujours : une remontée qui la croise ne
// répond plus de tous les conteneurs et se replie (cf. _mjsLift)
function _mjsBind(f, x, el) {
  const a = f.a, b = f.b, l = f.l;
  if (a === null || b === x || l !== void 0 && l.includes(x)) return;
  if (x === null) {
    f.a = null;
    f.b = void 0;
  }
  else if (x.q !== void 0 && _mjsSwap(f, x.q, x)) return;
  else if (a === void 0) f.a = x;
  else if (b === void 0 || _mjsDrops(b, el)) {
    f.b = a;
    f.a = x;
  }
  else if (_mjsDrops(a, el)) f.a = x;
  else if ((f.l = l === void 0 ? [] : l.filter((w) => !_mjsDrops(w, el))).push(x) > 6) {
    f.a = null;
    f.b = f.l = void 0;
  }
}
// le conteneur d'un lien (`w`) ne porte plus rien dans l'état : il n'existe plus, ou il en est sorti (cf. _mjsOutsideState)
function _mjsDrops(w, el) {
  const o = w.deref();
  return o === void 0 || _mjsOutsideState(o, el, 0);
}
// l'objet `o` est sorti de l'état, vu de cette famille d'enveloppes : aucune de ses clés ne le tient, et aucun de ses liens ne le tient
// plus (cf. _mjsHolds) — conteneur disparu, conteneur lui-même sorti de l'état, ou, pour un lien douteux, conteneur où l'objet n'est
// plus rangé : la ligne recopiée (`$rows[i] = { ...$rows[i], k }`), la liste remplacée (`$rows = $rows.filter(…)`,
// `$o.rows = $o.rows.filter(…)`, `$o = {...$o, rows: l}`). Un lien douteux seul ne prouve rien : le conteneur est regardé (cf.
// _mjsRange). Dans le doute, faux : fiche pas sûre, plus de trois niveaux, clé qui est une valeur dérivée (son calcul repartirait)
function _mjsOutsideState(o, el, n) {
  const f = el._mjs_rootsByTarget.get(o), cs = el._mjs_computeds;
  if (f === void 0 || f.a === null || n > 3) return false;
  if (_mjsHolds(f.a, o, el, n) || _mjsHolds(f.b, o, el, n) || f.l !== void 0 && f.l.some((w) => _mjsHolds(w, o, el, n))) return false;
  if (f.s === void 0) return !(cs && cs[f.r]) && µ._mjs_toRaw(el._state[f.r]) !== o;
  for (const k of f.s) if (cs && cs[k] || µ._mjs_toRaw(el._state[k]) === o) return false;
  return true;
}
// le lien `w` tient encore l'objet `x` dans l'état : vers un conteneur qui existe et n'est pas sorti de l'état — et, pour un lien DOUTEUX
// (un jumeau : une écriture a sorti `x` de ce conteneur sans dire s'il y est rangé ailleurs — deux lignes échangées, une ligne retirée
// puis remise, le même objet sous deux champs), où `x` est encore rangé (cf. _mjsRange) : jamais « sorti » sans preuve
function _mjsHolds(w, x, el, n) {
  const c = w !== void 0 ? w.deref() : void 0;
  return c !== void 0 && !_mjsOutsideState(c, el, n + 1) && (w.w === void 0 || _mjsRange(c, x));
}
// l'objet `x` est-il encore rangé dans le conteneur `c` ? Regardé seulement pour un lien douteux, au moment de libérer une place :
// une liste d'au plus 2 048 éléments, une `Map` ou un `Set` d'au plus 2 048 entrées (par les méthodes natives, jamais celles d'une
// sous-classe), un objet ordinaire d'au plus 2 048 champs, tous des données — éléments bruts ou enveloppés. Au-delà, devant un
// accesseur ou un conteneur d'une autre sorte, rien n'est regardé : dans le doute, il y est encore
function _mjsRange(c, x) {
  let i, ks, d;
  if (Array.isArray(c)) {
    if (c.length > 2048) return true;
    for (i = 0; i < c.length; i++) if (µ._mjs_toRaw(c[i]) === x) return true;
    return false;
  }
  if (c instanceof Map || c instanceof Set) {
    i = 0;
    for (d of (c instanceof Map ? Map : Set).prototype.entries.call(c)) {
      if (i++ > 2048 || µ._mjs_toRaw(d[0]) === x || µ._mjs_toRaw(d[1]) === x) return true;
    }
    return false;
  }
  ks = Object.getPrototypeOf(c);
  if (ks !== Object.prototype && ks !== null) return true;
  ks = Reflect.ownKeys(c);
  if (ks.length > 2048) return true;
  for (i = 0; i < ks.length; i++) {
    d = Reflect.getOwnPropertyDescriptor(c, ks[i]);
    if (d === void 0 || !('value' in d) || µ._mjs_toRaw(d.value) === x) return true;
  }
  return false;
}
// écriture faite par une enveloppe dans l'objet `obj` de la fiche `h` (nom local, fonction qui reçoit l'objet, méthode) : elle remonte ses
// liens (`a`, `b`, puis la liste `l` de l'objet à plus de deux conteneurs), douteux compris, et fait avancer l'époque de chaque conteneur qu'un autre composant que l'écrivain tient (`µ._mjs_holders`), ou
// que l'écrivain a tenu le premier et qu'un autre a rangé depuis (marqué partagé, `µ._mjs_sharedRoots`) — la règle des objets du milieu d'un chemin écrit
// (_mjsDeepMiddle, mjs_deep.ts) : l'enfant à qui le parent repose l'un d'eux y voit une mutation, pas un écho. Par conteneur : une lecture
// de la table des fiches, une de celle des objets tenus, quelle que soit la taille des données ; aucune clé de l'appli n'est lue.
// `_mjsClimbed` : les objets déjà remontés, file et marque de passage à la fois — un objet rangé à deux endroits du même ancêtre, ou qui se
// contient, n'est remonté qu'une fois, sans repli ; vidée à la sortie, elle ne retient rien. Un lien périmé (objet sorti de son conteneur) fait au
// pire avancer une époque pour rien. Objet de la variable écrite marqué partagé : il avance toujours, et l'écrivain en prend l'époque — reposé tel
// quel ou réécrit, il reste un écho pour lui (cf. _mjsDeepEpoch, mjs_deep.ts). Rend vrai quand elle ne répond pas de tous les
// conteneurs — ce qui ne peut pas se suivre : fiche pas sûre (`a` nul : navigateur sans `WeakRef`, objet enveloppé sans passer par son
// conteneur, cf. µ._mjs_deepSame, mjs_deep.ts, objet tenu par plus de huit conteneurs), plus de 32 objets remontés : l'appelant se replie
const _mjsClimbed = [];
function _mjsLift(h, obj) {
  const el = h.e, m = el._mjs_rootsByTarget, p = µ._mjs_sharing, me = el._mjs_wr, seen = _mjsClimbed;
  // objet de la variable écrite, cherché seulement si un objet de la page a été marqué partagé un jour, lu AVANT la remontée (pendant
  // elle, rien ne se lit dans l'état, aucun code de l'appli ne tourne). Marqué : il avance toujours, que les liens y mènent ou non, et
  // l'écrivain en prend l'époque. Non marqué, tenu d'abord par l'écrivain : personne d'autre ne le tient, il n'avance pas et la remontée
  // le passe (sa lecture se fait ici, pas là-bas : une lecture de plus par écriture, celle du carnet des objets marqués) ; sinon la
  // remontée le traite comme tout conteneur
  let root = p ? µ._mjs_toRaw(el._state[h.r]) : void 0;
  let f = h, fallback = false, i, j, l, w, o, t, e;
  if (p && root !== obj) {
    if (µ._mjs_sharedRoots.has(root)) {
      µ._mjs_epochs.set(root, e = (µ._mjs_epochs.get(root) || 0) + 1);
      el._mjs_bindEpochs[h.r] = e;
    }
    else if (µ._mjs_holders.get(root) !== me) root = void 0;
  }
  seen[0] = obj;
  for (i = 0; i < seen.length; i++) {
    if (i !== 0) f = m.get(seen[i]);
    if (f === void 0) continue;
    if (f.a === null || seen.length > 32) {
      fallback = true;
      break;
    }
    for (j = 0, l = f.l; j < (l === void 0 ? 2 : l.length + 2); j++) {
      w = j === 0 ? f.a : j === 1 ? f.b : l[j - 2];
      if (w === void 0 || (o = w.deref()) === void 0 || seen.includes(o)) continue;
      seen.push(o);
      // LE SEUL endroit où la remontée compare le détenteur d'un objet (µ._mjs_holders : objet brut → la référence faible de son premier détenteur) à celle du composant qui écrit (`moi` ; absente : il n'a encore rangé aucun objet, tout objet tenu l'est par un autre) ; tenu d'abord par l'écrivain, l'objet avance aussi quand il est marqué partagé
      if (o !== root && (t = µ._mjs_holders.get(o)) !== void 0 && (t !== me || p && µ._mjs_sharedRoots.has(o))) µ._mjs_epochs.set(o, (µ._mjs_epochs.get(o) || 0) + 1);
    }
  }
  seen.length = 0;
  return fallback;
}
// <families>
// pour les enveloppes de `µ.state` et de `µ.Store` (fichiers à part) : gardé seulement quand une unité du build les écrit
µ._mjs_bind  = _mjsBind;
µ._mjs_lift = _mjsLift;
µ._mjs_ref   = _mjsRef;
// </families>
// </middle>
// <families>
// une variable du composant `el` qui tient un objet d'un état partagé ou d'un magasin (`$courant = st.rows[1]`, fiche notée par `_set`) l'a
// écrit, ou plus bas (`$courant.x.c = v`, `obj` l'objet écrit) : l'état est prévenu comme après une écriture faite par lui — ses lecteurs,
// la liste qui repose la ligne à ses enfants. La clé écrite et les autres clés qui atteignent l'objet, chaque fiche une fois ; une note
// dont la variable a quitté l'objet de sa fiche est passée. L'époque de l'objet a déjà avancé et l'écrivain l'a prise (_mjsMutated,
// _mjsDeepEpoch, mjs_deep.ts) : l'avis de l'état ne lui coûte aucun rendu de plus (quand un carnet tient l'objet, la lecture du carnet lui redit un avis : deux avis, un rendu)
function _mjsTap(el, obj, rootKey) {
  const n = el._mjs_tap;
  if (n === void 0) return;
  const f = el._mjs_rootsByTarget ? el._mjs_rootsByTarget.get(obj) : void 0, seen = [];
  const see = (k) => {
    const h = n.get(k);
    if (h === void 0 || seen.includes(h) || µ._mjs_toRaw(el._state[k]) !== µ._mjs_toRaw(h.x)) return;
    seen.push(h);
    if (h.B !== void 0) µ._mjs_storeTap(h);
    else µ._mjs_stateTap(h, obj);
  };
  see(rootKey);
  if (f !== void 0) (f.s || [f.r]).forEach(see);
  // <wrapper>
  // les états et magasins ainsi prévenus : l'avis du registre des détenteurs qui suit ne les prévient pas une seconde fois (cf. _mjsClaimNotice)
  _mjsTapEl  = el;
  _mjsTapObj = obj;
  _mjsTapSeen = seen;
  // </wrapper>
}
// appelée par µ depuis l'écriture servie par la mise à jour fine : mjs_deep.ts est aussi joint à la page du journal d'erreurs, hors de la portée du cœur
µ._mjs_tapWrite = _mjsTap;
// </families>
// </links>

// enveloppe d'une valeur dérivée compilée (`{ _mjs_c: true, f }`) : elle porte toujours sa fonction `f` — une donnée
// reçue qui a la clé `_mjs_c` (JSON, dictionnaire aux clés choisies par un utilisateur) n'en est pas une
function _mjsDerive(x) {
  return x?._mjs_c && typeof x.f === 'function';
}
// <reffets-state>

// blocs `<reffets-state>` : gardés par le bundler quand le build a un reffet et un état partagé (`µ.state`, magasin, contexte) ; sans l'un
// des deux, ils partent, et le texte d'avant, gardé en commentaire dans un bloc `<no-reffets-state>`, reprend sa place.
// Composant dont le rendu complet en cours n'est demandé que par des états partagés (`_mjs_pending_full` valait 2, cf. µ._mjs_uNotice,
// mjs_runes.ts) : ses reffets qui ont noté leurs lectures ne passent pas tous (_mjs_effGo)
var _mjsU2 = null;
// à ce rendu, le reffet `e` passe-t-il d'office ? oui s'il a lu un état partagé qui a changé depuis son dernier passage (`u`, `uv` :
// µ._mjs_uRead, mjs_signals.ts), et dans le doute : son code peut en lire un après coup ou par un chemin que le passage ne note pas (`d`,
// relevé de la construction, mjs_effect.ts), ou il a lu une valeur dérivée à l'horloge qui peut en être faite (`uh`)
function _mjsUGo(e) {
  const n = e.n, u = n.u;
  if (e.d === 1 || n.uh === n.ep) return true;
  if (u !== undefined && n.ue === n.ep) for (let i = 0; i < u.length; i++) if (u[i].ver !== n.uv[i]) return true;
  return false;
}
// </reffets-state>

// blocs `<derived-values>` : retirés du cœur par le bundler quand aucune unité du build n'a de valeur dérivée (`µ._mjs_setComputed`), hors build
// de développement complet (l'atelier de thème, compilé à la volée, en a)
// <derived-values>
// horloge des valeurs dérivées d'un composant, rangée sous ce symbole dans la table de ses dérivées (`_mjs_computeds`, que
// ses miroirs partagent) : `n` compte les écritures du composant, `v` garde pour chaque variable le compte de sa dernière
// écriture. Une valeur dérivée retient le compte de son dernier calcul (`_mjs_seen`) : relue, elle sert sa valeur tant que
// le compte n'a pas bougé, se recalcule sinon. Toute écriture du composant périme donc toutes ses valeurs dérivées, mais
// une écriture coûte un compte, quel que soit leur nombre ; une écriture qui ne change rien ne compte pas
const _MJS_CLOCK = Symbol('mjs-clock');
function _mjsCount(cs, k) {
  const h = cs[_MJS_CLOCK];
  h.v[k] = ++h.n;
}
// valeurs à l'horloge montrées : refaites à leur lecture après toute écriture du composant, elles changent aussi par une écriture
// profonde ou un `µrefresh` qui n'écrit aucune variable qu'elles lisent, quand une de ces variables tient un objet à risque (cf.
// _mjsIsHidden), dont `µrefresh` a signalé l'objet (accesseur propre à l'objet qui lit un autre objet). Après une telle écriture, servie
// par le chemin ordinaire ou champ par champ (mise à jour fine, mjs_deep.ts), ce qui montre une de ces valeurs, quand l'écriture ne l'a
// pas fait refaire (liaison, bloc, prop d'un enfant), se redessine si elle a changé (un objet, une fonction, un calcul qui lève :
// toujours), comme après `µrefresh` : ni reffet ni parent lié. Les autres ne sont pas refaites : une valeur qui fait une requête ne
// repart pas à chaque frappe. Posé à la première valeur à l'horloge d'une instance, sur elle seule (ses `_mjs_notifyMutationAliased`
// et `_mjs_fineNote` propres) : un composant aux valeurs précises n'en paie rien, l'écriture d'un champ reste servie champ par champ
const _mjsSeenEls = new WeakSet();
function _mjsClockView(el) {
  if (_mjsSeenEls.has(el)) return;
  _mjsSeenEls.add(el);
  const a = el._mjs_notifyMutationAliased;
  el._mjs_notifyMutationAliased = function(o, k, x, rw) {
    a.call(this, o, k, x, rw);
    // <wrapper>
    // <collections>
    // collection écrite par ce composant (méthode, champ posé) : son verdict gardé s'oublie et l'époque des verdicts avance — une
    // collection qui la range est à regarder de nouveau (cf. _mjsTracked) ; un objet sans verdict : une lecture, rien de plus
    if (µ._mjs_keyIdx._mjs_v?.delete(o)) _mjsVerdictN++;
    // </collections>
    // </wrapper>
    _mjsClockRedraw(this);
  };
  // <fine-grained>
  const b = el._mjs_fineNote;
  el._mjs_fineNote = function(k) {
    b.call(this, k);
    _mjsClockRedraw(this);
  };
  // </fine-grained>
}
// <loops>
// composants dont les valeurs à l'horloge attendent la sortie d'une boucle qui écrit l'état : une entrée de sa file (µ._mjs_lqF,
// mjs_init.ts, appelle le `_mjs_invalidate` de chacune), une fois par boucle, au lieu d'un calcul à chaque tour
let _mjsSeenLoop = null;
// </loops>
function _mjsClockRedraw(el) {
  if (!el._mjs_is_mounted || el._mjs_has_crashed) return;
  // <loops>
  if (µ._mjs_lq) {
    if (_mjsSeenLoop === null) {
      _mjsSeenLoop = new Set();
      µ._mjs_lqq.push({ _mjs_lqk: [0], _mjs_invalidate() {
        const s = _mjsSeenLoop;
        _mjsSeenLoop = null;
        s.forEach(_mjsClockRedraw);
      } });
    }
    _mjsSeenLoop.add(el);
    return;
  }
  // </loops>
  const cs = el._mjs_computeds, ks = el._mjs_computedKeys, e = el._mjs_effectsByVar, s = el._mjs_renderStructVars, h = cs[_MJS_CLOCK];
  // pendant un rendu, un reffet ou un calcul : redessinée au tour suivant, sans être relue ici (comme `µrefresh`)
  const f  = µ._mjs_inEffect, c = µ._mjs_computing, read = !f && !c && !µ._mjs_sigCur;
  µ._mjs_inEffect = f || !!c;
  try {
    for (let i = 0; i < ks.length; i++) {
      const d = ks[i], v = cs[d];
      if (v._mjs_seen < 0 || v._mjs_seen === h.n || v._mjs_evaluating || !(e && e[d] || s && s[d] === 1)) continue;
      // <precision>
      // valeur précise : elle suit ses sources (sans le graphe des signaux, elle est à l'horloge)
      if (v._mjs_n && v._mjs_src) continue;
      // </precision>
      if (!_mjsIsHidden(el, d)) continue;
      if (read) {
        // un calcul qui lève est laissé au rendu, qui le refait et rend son erreur par le chemin habituel : l'écriture va au bout
        const before = v._mjs_cached;
        let x = el;
        try {
          x = el._state[d];
        }
        catch {}
        if (Object.is(before, x) && Object(x) !== x) continue;
      }
      el._mjs_invalidate(d, 1);
    }
  }
  finally {
    µ._mjs_inEffect = f;
  }
}
// objet à risque — que MJS ne suit pas et qui peut cacher la lecture d'un autre objet du composant : une fonction (fermeture,
// champs), l'instance d'une classe de l'application (accesseurs, méthodes), un objet ou une liste gelés, scellés ou fermés aux ajouts
// (l'enveloppe rend leurs champs bruts), un objet que `µrefresh` a signalé (`_mjsReported`, toute variable qui le tient), une `Map`, un
// `Set`, une `WeakMap` ou un `WeakSet` que l'enveloppe ne suit pas en entier (cf. _mjsTracked ; sans l'enveloppe, ou dans un cœur bâti
// sans la part des collections, où la clé d'une `Map` sort brute, aucun ne l'est). Pas à
// risque : un objet ou une liste ordinaires, que l'enveloppe suit ; une `Date`, une expression régulière, des valeurs qu'elle suit par
// leurs méthodes ; les autres objets du navigateur (`URL`, `DOMRect`, listes typées, nœuds, `DOMStringMap`, `NamedNodeMap`…), qu'elle
// rend tels quels (cf. `_mjs_wrapDeep`) et qui ne tiennent aucun objet du composant : l'étiquette d'une collection se lit en entier.
// `n` : la profondeur, d'une collection à celles qu'elle range
// <refresh>
const _mjsReported = new WeakSet();
// </refresh>
function _mjsRisk(x, n) {
  if (x === null || typeof x !== 'object' && typeof x !== 'function') return false;
  x = µ._mjs_toRaw(x);
  // <refresh>
  if (_mjsReported.has(x)) return true;
  // </refresh>
  if (typeof x === 'function') return true;
  // objet ou liste ordinaires, ouverts aux ajouts : le cas courant, sans lire leur étiquette
  const p = Object.getPrototypeOf(x);
  if ((p === Object.prototype || p === Array.prototype || p === null) && Object.isExtensible(x)) return false;
  const g = Object.prototype.toString.call(x);
  if (/^\[object (Weak)?(Map|Set)\]$/.test(g)) {
    // <wrapper>
    // <collections>
    if (_mjsTracked(x, p, n)) return false;
    // </collections>
    // </wrapper>
    return true;
  }
  return /^\[object (Object|Array)\]$/.test(g);
}
// <wrapper>
// <collections>
// collection que l'enveloppe suit en entier : ses entrées objets (clé, valeur, élément) sortent enveloppées, rangées sous la clé de la
// variable comme les champs d'un objet (cf. `_mjs_wrapDeep`) — l'écriture de l'une d'elles par une autre variable prévient la valeur qui
// lit la collection, rien n'est à refaire après les autres. Elle ne suit pas : une collection brute (`µraw`) ou d'une classe de
// l'application (sous-classe : accesseurs, méthodes), un champ posé sur la collection (rendu tel quel), une entrée elle-même à risque
// (fonction lue ou appelée, instance d'une classe, objet gelé, objet signalé, collection qui en range ; au-delà de trois niveaux, sans
// regarder), ni une `WeakMap`, qui ne se parcourt pas : ce que son `get` rendra ne se sait pas. Rien ne se lit dans un `WeakSet`. Seule
// l'entrée est regardée, pas ce qu'un objet ou une liste ordinaires rangés là rangent à leur tour (« plus loin » : `µrefresh`).
// Bloc gardé avec la part des collections seulement : sans elle, la clé d'une `Map` sort brute (µ._mjs_readFn, mjs_init.ts) et aucune
// collection n'est suivie en entier.
// Le verdict est GARDÉ d'une écriture à l'autre (`s`), dans un carnet posé sur l'index des clés (µ._mjs_keyIdx, mjs_init.ts) : `µrefresh`
// refait cet index, les verdicts partent avec lui (objet signalé, collection changée hors de MJS). Une frappe sans rapport ne coûte donc
// ni parcours ni calcul ; le parcours s'arrête à la première entrée à risque. Le verdict se refait quand la collection a changé par MJS :
// son époque a avancé (`e` : écriture par une enveloppe, d'un composant, de µ.state ou de µ.Store, cf. µ._mjs_bumpEpoch), ou ce
// composant vient de l'écrire (cf. _mjsClockView : méthode appelée par le code compilé, champ posé). Celui d'une collection qui en range
// d'autres (`n`, l'époque des verdicts à sa pose ; 0 pour celle qui n'en range aucune) tombe aussi dès qu'une collection au verdict gardé
// est écrite par un composant aux valeurs à l'horloge montrées. Verdict « à risque » d'une collection rangée dans une autre : noté sans
// valoir (`n` à -1) — il peut venir de la seule limite des trois niveaux —, pour que son écriture fasse tomber celui de la collection
// qui la range. Ne se voient pas, comme tout changement fait hors de MJS (`µrefresh`) : un objet gelé après avoir été rangé, une
// collection rangée dans une autre et écrite par un autre composant, µ.state ou µ.Store
const _mjsCollections = [Map.prototype, Set.prototype, WeakSet.prototype];
var _mjsVerdictN = 1, _mjsJudged = 0;
function _mjsTracked(x, p, n) {
  _mjsJudged++;
  if (n > 2 || !_mjsCollections.includes(p) || µ._mjs_rawSet.has(x) || Reflect.ownKeys(x).length !== 0) return false;
  if (p === WeakSet.prototype) return true;
  const g = µ._mjs_keyIdx._mjs_v ||= new WeakMap(), e = µ._mjs_epochs.get(x), a = _mjsJudged, r = g.get(x);
  if (r && r.e === e && (!r.n || r.n === _mjsVerdictN)) return r.s;
  let s = true;
  for (const c of x.entries()) {
    if (_mjsRisk(c[1], n + 1) || c[0] !== c[1] && _mjsRisk(c[0], n + 1)) {
      s = false;
      break;
    }
  }
  g.set(x, { s, e, n: a === _mjsJudged ? 0 : s || !n ? _mjsVerdictN : -1 });
  return s;
}
// </collections>
// </wrapper>
// une variable lue par la valeur dérivée `d` (fermeture des variables qu'elle lit, valeurs dérivées aplaties, `_mjs_computedDeps`) tient
// un objet à risque ; un objet qui refuse d'être regardé (Proxy de l'application dont un piège lève) en est un : l'écriture va au bout
function _mjsIsHidden(el, d) {
  const ds = el._mjs_computedDeps?.[d] || [], cs = el._mjs_computeds;
  try {
    for (let i = 0; i < ds.length; i++) {
      const k = ds[i];
      if (cs[k] === void 0 && _mjsRisk(el._state[k], 0)) return true;
    }
  }
  catch {
    return true;
  }
  return false;
}
// <derived-check>
// valeur dérivée qui porte une règle dans le <vars> (`total int 0..100` pour `$total = $a * 2`), hors production (bloc retiré de la
// production) : le verdict d'une écriture, lu sans rien écrire (µ._mjs_tderived, mjs_types.ts), à son premier calcul (`first`) et à
// chaque recalcul qui rend autre chose que le précédent (`before`) — un objet ou une liste, qui ont pu changer sur place, à chaque
// recalcul ; jamais à une lecture servie. Lu hors du calcul en cours : ni le graphe des signaux, ni le calcul précis, ni le relevé de
// ses accesseurs n'en voient une lecture. Un composant sans <vars> n'en paie que le premier test. Rien n'est jugé tant qu'une valeur qui
// attend du composant n'a pas donné sa première réponse (`$half = $r * 2` vaudrait NaN) : toutes ses valeurs à règle le sont à cette
// réponse (µ._mjs_tderivedAll, appelé par mjs_await_derived.ts)
function _mjsDerivedCheck(el, k, x, before, first) {
  const T = el._mjs_types;
  if (T === void 0 || !hasProp.call(T, k) || µ._mjs_tderived === void 0 || _mjsAwaitingFirst(el)) return;
  if (!first && Object.is(before, x) && (x === null || typeof x !== 'object')) return;
  const __graph = µ._mjs_sigCur, __computing = µ._mjs_computing;
  // <precision>
  const __precise = _mjsP, __reads = _mjsRereads;
  _mjsP     = null;
  _mjsRereads = null;
  // </precision>
  µ._mjs_sigCur    = null;
  µ._mjs_computing = null;
  try {
    µ._mjs_tderived(el, k, x);
  }
  finally {
    µ._mjs_sigCur    = __graph;
    µ._mjs_computing = __computing;
    // <precision>
    _mjsP     = __precise;
    _mjsRereads = __reads;
    // </precision>
  }
}
// une valeur qui attend du composant n'a pas encore donné sa première réponse (`ok`, mjs_await_derived.ts)
function _mjsAwaitingFirst(el) {
  const a = el._mjs_aw;
  if (a !== void 0) for (const k in a) if (!a[k].ok) return true;
  return false;
}
// les valeurs dérivées à règle de `el`, jugées sur leur valeur du moment quand plus aucune valeur qui attend n'est sans réponse
µ._mjs_tderivedAll = function(el) {
  const T = el._mjs_types, cs = el._mjs_computeds;
  if (T === void 0 || !cs || µ._mjs_tderived === void 0 || _mjsAwaitingFirst(el)) return;
  for (const k in cs) if (hasProp.call(T, k)) µ._mjs_tderived(el, k, el._state[k]);
};
// </derived-check>
// <precision>
// valeurs dérivées PRÉCISES : le compilateur prouve ce qu'elles lisent et nomme leurs sources (`_mjs_src`,
// analyzer/derived-classes.ts) ; chacune est un nœud du graphe des signaux (mjs_signals.ts, cf. _mjsPrecise), qui note à chaque
// calcul les sources qu'il lit vraiment (generator/transform-reactive.ts). Relue, elle se refait seulement si l'une d'elles a
// changé depuis son dernier calcul — une source de la branche qu'il n'a pas prise ne compte pas — et, refaite à l'identique,
// elle ne fait pas refaire les valeurs précises qui la lisent. Dans le doute,
// la règle de toujours : une valeur précise qui lit un objet tenu par un autre composant, par `µ.state`, `µ.Store` ou un
// magasin, un objet brut (`µraw`), un objet où la variable a posé un accesseur ou une fonction, une fonction propre à l'objet
// ou héritée d'un prototype qui n'est pas du langage (méthode rangée dans l'objet, itérateur propre, méthode ou conversion d'une
// classe, d'un prototype fait par `Object.create`, d'une sous-classe de liste : du code de l'application, qui peut lire par une
// fermeture un état que MJS écrit), une valeur ou un champ absent venus d'une classe ou d'un prototype fait par `Object.create`
// (accesseur d'une classe, champ que le prototype recevra : un autre objet, cf. _mjsAbsentInherited), un objet qu'une `Map`, un
// `Set` ou une liste rend sans l'envelopper (une fonction, cf. _mjsRawRead), ou dont une source
// tient une fonction ou un objet que le composant n'enveloppe pas, repasse à l'horloge pour toujours, et ses sources avec elle
// (`h.d`) : toute valeur précise qui les lit y passe aussi. Ne se regardent pas à la lecture, en production comme en
// développement : un accesseur propre à l'objet, posé avant que la variable le reçoive, et ce que l'objet change hors de MJS ;
// `µrefresh($x)` le signale, et en développement la relecture le rappelle (cf. _mjsRereading)
// valeur précise en cours de calcul : les pièges de l'enveloppe y notent un doute (`_mjs_d`). `var` comme `_mjsDoubtN` : lus
// à chaque lecture d'une enveloppe, sans le contrôle d'initialisation qu'un `let` impose au moteur
var _mjsP = null;
const _mjsProprios = new WeakMap();  // objet enveloppé → son premier détenteur (la référence faible du composant, cf. _mjsWeak, ou 0 : µ.state, µ.Store)
const _mjsDoubtful  = new WeakSet();  // objets dont les valeurs précises doutent
var _mjsDoubtN     = 0;
// clés du composant devenues douteuses : leurs valeurs précises repassent à l'horloge. Le doute n'avance pas l'horloge du
// composant : relue avant sa prochaine écriture, une valeur sert son dernier calcul, comme à l'horloge — un objet changé par
// un autre composant ne la refait pas plus ; refaite à la lecture qui suit. Un composant sans valeur dérivée n'en garde
// rien : l'objet douteux l'est pour tous (`_mjsDoubtful`), une valeur précise faite plus tard le voit à son calcul (cf.
// _mjsPreciseEnd)
function _mjsDoubtKeys(el, keys) {
  const h = el && keys ? el._mjs_computeds?.[_MJS_CLOCK] : void 0;
  if (!h) return;
  const d = (h.d ||= {}), fresh = [];
  keys.forEach((k) => {
    if (d[k] === 1) return;
    d[k] = 1;
    // compte plus récent que tout calcul fait, sans avancer l'horloge
    h.v[k] = h.n + 1;
    fresh.push(k);
  });
  // les valeurs précises qui en lisent une passent à l'horloge tout de suite (le graphe ne voit pas un doute) : refaites à leur
  // lecture après la prochaine écriture du composant, servies telles quelles avant ; leurs sources doutent à leur tour
  if (fresh.length !== 0) el._mjs_computedKeys.forEach((n) => {
    const v = el._mjs_computeds[n], s = v && v._mjs_src;
    if (s && fresh.some((k) => s.includes(k))) {
      v._mjs_src = null;
      _mjsClockView(el);
      _mjsDoubtKeys(el, s);
    }
  });
}
// <wrapper>
// le calcul de la valeur précise `v` doute
function _mjsDoubtCalc(v) {
  v._mjs_d = 1;
}
// </wrapper>
function _mjsDoubt(t) {
  if (_mjsDoubtful.has(t)) return false;
  _mjsDoubtful.add(t);
  _mjsDoubtN++;
  return true;
}
// objet dont on doute désormais : les clés de son premier détenteur qui l'atteignent aussi — tant qu'il vit, dans la page ou non : sorti,
// il relit encore ses valeurs précises, et peut revenir (`0`, sans `deref` : µ.state, µ.Store, personne à prévenir)
function _mjsDistrust(t) {
  if (!_mjsDoubt(t)) return;
  const p = _mjsProprios.get(t)?.deref?.();
  const f = p ? p._mjs_rootsByTarget?.get(t) : void 0;
  if (f) _mjsDoubtKeys(p, f.s || [f.r]);
}
µ._mjs_distrust = _mjsDistrust;
// un détenteur de plus pour `t` : un second, l'objet n'est plus celui d'un seul composant
µ._mjs_isClaimed = function(t, el) {
  const p = _mjsProprios.get(t), w = el && _mjsWeak(el);
  if (p === void 0) _mjsProprios.set(t, w);
  else if (p !== w) _mjsDistrust(t);
};
// objets d'un état ou d'un magasin faits avant ce fichier (`µ.nav`, `µ.res`, mjs_store_globals.ts) : notés maintenant
if (µ._mjs_claimedBefore) {
  µ._mjs_claimedBefore.forEach((t) => µ._mjs_isClaimed(t, 0));
  µ._mjs_claimedBefore = null;
}
// <wrapper>
// enveloppe neuve de `t` dans `el` (`f`, sa fiche) : son détenteur noté ; déjà douteux, ses clés le sont (composant sans valeur dérivée :
// aucune recherche, son doute ne servirait à rien, cf. _mjsDoubtKeys)
function _mjsControl(el, t, f) {
  // <no-collections>
  // // cœur bâti sans la part des collections : la clé objet d'une `Map` sort brute, sans faire douter le calcul qui la lit (µ._mjs_readFn,
  // // mjs_init.ts) — la `Map` elle-même fait douter : la valeur précise qui la lit passe à l'horloge, que l'écran suit
  // if (t instanceof Map) _mjsDoubt(t);
  // </no-collections>
  µ._mjs_isClaimed(t, el);
  if (_mjsDoubtN !== 0 && el._mjs_computeds != null && _mjsDoubtful.has(t)) _mjsDoubtKeys(el, f.s || [f.r]);
}
// fonctions des prototypes du langage (objet, liste, `Map`, `Set`, date, expression régulière), relevées au chargement : elles ne
// lisent que l'objet et ce qu'on leur passe. Lue pendant le calcul d'une valeur précise, une fonction héritée qui n'en est pas une
// (méthode ou conversion d'une classe, `toString` d'un prototype fait par `Object.create`, `join` d'une sous-classe de liste) est
// du code de l'application, qui peut lire par une fermeture un objet qu'une autre variable écrit (`$reglages.devise = 'USD'`) :
// elle fait douter le calcul, comme une fonction propre à l'objet (cf. le piège de `_mjs_wrapDeep`)
const _mjsFnLang = new Set();
[Object.prototype, Array.prototype, Map.prototype, Set.prototype, Date.prototype, RegExp.prototype].forEach((p) => Reflect.ownKeys(p).forEach((k) => {
  const d = Reflect.getOwnPropertyDescriptor(p, k);
  if (typeof d.value === 'function') _mjsFnLang.add(d.value);
}));
// `undefined` lu pendant le calcul d'une valeur précise, qui n'est pas une donnée propre de `o` : un champ absent, ou l'accesseur
// d'une classe qui le rend. Sur un objet de simples données (prototype des objets, des listes, ou aucun), il n'a d'autre source
// que l'objet, que la variable range sous sa clé : rien à regarder. Sur un autre prototype (classe, `Object.create(base)`), il
// vient d'un objet que l'enveloppe ne range pas sous la clé de la variable — l'accesseur d'une classe qui lit un autre objet, le
// champ que `base` recevra — et une autre variable qui écrit cet objet (`$ligne.prix = 10`, `$base.prix = 10`) ne préviendrait
// pas la valeur : il fait douter le calcul. Un `getPrototypeOf` par champ absent lu, rien de plus pour un champ présent
function _mjsAbsentInherited(o, k) {
  const p = Object.getPrototypeOf(o);
  return p !== Object.prototype && p !== Array.prototype && p !== null && !hasProp.call(o, k);
}
// ce qui sort d'une `Map` ou d'un `Set` par une méthode de lecture (`get`, `for…of`, `forEach`…, la clé d'une `Map` comme la valeur)
// pendant le calcul d'une valeur précise : `r`, ce qu'en fait l'enveloppe ; l'objet `v` rendu tel quel (étiqueté par
// `Symbol.toStringTag`, `Error`, objet natif) ou la fonction (clé ou valeur d'une `Map`, élément d'un `Set`) n'est pas rangé sous la
// clé de la variable, et une autre variable qui l'écrit (`$ligne.prix = 10`, `$f.nom = 'z'`) ne préviendrait pas la valeur : il fait douter
// le calcul, comme à la lecture d'un champ
function _mjsRawRead(v, r) {
  if (r === v && (typeof v === 'object' ? v !== null : typeof v === 'function')) _mjsDoubtCalc(_mjsP);
  return r;
}
// <collections>
// clé d'une `Map`, élément d'un `Set` rangés sous l'enveloppe d'une autre famille (composant parent, `µ.state`, `µ.Store`), rendus tels
// quels par l'aide commune (µ._mjs_readFn, mjs_init.ts) : ce n'est pas cette enveloppe qui les range sous la clé de la variable, et une
// écriture faite par l'autre famille ne préviendrait pas la valeur — lus pendant le calcul d'une valeur précise, ils le font douter
µ._mjs_doubtKey = () => {
  if (_mjsP !== null) _mjsDoubtCalc(_mjsP);
};
// </collections>
// parcours d'une liste par le calcul contrôlé d'une valeur précise (`filter`, `map`, `find`…) : la liste se parcourt brute, une
// seule entrée pour toute la liste au lieu d'un passage par le piège à chaque indice, avec le résultat du piège : chaque élément
// se rend enveloppé au rappel ; un objet brut (`µraw`), un élément figé se rendent bruts et font douter le calcul (la liste,
// ouverte aux ajouts à l'entrée, a été gelée par le rappel, par la variable peut-être : une écriture faite pendant le calcul, que
// le graphe compterait) ; un objet que l'enveloppe ne suit pas (erreur, objet natif ou étiqueté) se rend tel quel et fait douter
// le calcul ; une fonction, une valeur qui n'est pas une donnée propre de la liste (Proxy de l'application,
// trou rempli par un prototype) se relisent par le piège ; un trou vide se rend tel quel (le prototype est celui des listes,
// garde plus bas : rien à regarder, cf. _mjsAbsentInherited) ; `filter` et `find` rendent les éléments tels que le rappel les a reçus.
// Le rappel est appelé comme par la méthode, sans lire son `call`. Une fonction par enveloppe et par méthode, gardée comme une
// méthode liée (la même d'une lecture à l'autre) ; garde refaite à chaque appel, la méthode appelée par la variable sinon : hors
// du calcul d'une valeur précise, liste douteuse, rappel qui n'est pas une fonction (l'erreur de la méthode, au même moment),
// prototype autre que celui des listes, constructeur propre ou constructeur des listes remplacé (le tableau rendu), liste fermée
// aux ajouts
const _mjsWalked = Object.assign(Object.create(null), { filter: Array.prototype.filter, map: Array.prototype.map, forEach: Array.prototype.forEach, some: Array.prototype.some, every: Array.prototype.every, find: Array.prototype.find, findIndex: Array.prototype.findIndex });
function _mjsWalk(el, raw, name, rootKey, roots, proxy) {
  const m = _mjsWalked[name];
  return function(fn, thisOne) {
    const p = _mjsP;
    if (p === null || typeof fn !== 'function' || _mjsDoubtful.has(raw) || Object.getPrototypeOf(raw) !== Array.prototype || hasProp.call(raw, 'constructor') || Array.prototype.constructor !== Array || Array[Symbol.species] !== Array || !Object.isExtensible(raw)) return Reflect.apply(m, proxy, arguments);
    const w = (x, i) => {
      if (typeof x === 'function' || (x !== void 0 && !hasProp.call(raw, i))) return proxy[i];
      if (x === null || typeof x !== 'object') return x;
      if (µ._mjs_rawSet.has(x) || µ._mjs_fixed(raw, i)) {
        _mjsDoubtCalc(p);
        return x;
      }
      // objet que l'enveloppe ne suit pas (`Error`, objet natif, étiqueté par `Symbol.toStringTag`) : rendu tel quel, il n'est
      // pas rangé sous la clé de la liste, et une autre variable qui l'écrit (`$err.message = …`) ne préviendrait pas la valeur
      // <middle>
      // ce que le parcours enveloppe vient de la liste : sa référence faible, pour le lien (cf. _mjsBind)
      if (roots.v === void 0) roots.v = _mjsRef(raw);
      // </middle>
      const kp = el._mjs_wrapDeep(x, rootKey, roots);
      if (kp === x) _mjsDoubtCalc(p);
      return kp;
    };
    let r;
    if (name === 'filter') {
      r = [];
      Reflect.apply(_mjsWalked.forEach, raw, [(x, i) => {
        const v = w(x, i);
        if (Reflect.apply(fn, thisOne, [v, i, proxy])) r[r.length] = v;
      }]);
      return r;
    }
    if (name === 'find') return Reflect.apply(_mjsWalked.findIndex, raw, [(x, i) => Reflect.apply(fn, thisOne, [r = w(x, i), i, proxy])]) < 0 ? void 0 : r;
    return Reflect.apply(m, raw, [(x, i) => Reflect.apply(fn, thisOne, [w(x, i), i, proxy])]);
  };
}
// propriété définie par une enveloppe (`f`, la fiche de l'objet) : une écriture, que le piège dit comme le `set` ; un accesseur ou une
// fonction fait douter l'objet, et les valeurs précises qui le lisent repassent à l'horloge
function _mjsDefined(el, t, desc, f) {
  if (desc && (desc.get || desc.set || typeof desc.value === 'function')) {
    _mjsDoubt(t);
    _mjsDoubtKeys(el, f.s || [f.r]);
  }
}
// </wrapper>
// nom de champ que porte un prototype du langage autrement qu'en méthode : une donnée posée par l'application
const _mjsLangProtos = [Object.prototype, String.prototype, Number.prototype, Boolean.prototype, Array.prototype];
function _mjsLanguageName(n) {
  for (let i = 0; i < _mjsLangProtos.length; i++) {
    const p = Reflect.getOwnPropertyDescriptor(_mjsLangProtos[i], n);
    if (p && (p.get || p.set || typeof p.value !== 'function')) return true;
  }
  return false;
}
// fin du calcul d'une valeur précise : à l'horloge pour toujours si le calcul a douté, si une de ses sources est douteuse ou
// tient ce que l'enveloppe ne suit pas (objet brut ou natif, fonction)
function _mjsPreciseEnd(el, v) {
  const s = v._mjs_src, h = v._mjs_h, d = h.d, cs = el._mjs_computeds;
  let doubt = v._mjs_d;
  for (let i = 0; !doubt && i < s.length; i++) {
    const k = s[i];
    // `.nom` : champ lu hors de l'état, posé sur un prototype du langage par l'application ; une valeur dérivée : la sienne
    if (k.charCodeAt(0) === 46) {
      if (_mjsLanguageName(k.slice(1))) doubt = 1;
      continue;
    }
    if (d && d[k] === 1) doubt = 1;
    if (doubt || cs[k] !== void 0) continue;
    const x = el._state[k];
    if (typeof x === 'function') doubt = 1;
    else if (x !== null && typeof x === 'object') {
      const t = µ._mjs_toRaw(x);
      // <wrapper>
      if (el._mjs_rootsByTarget?.get(t)?.x !== x || _mjsDoubtful.has(t)) doubt = 1;
      // </wrapper>
      // <no-wrapper>
      // // sans l'enveloppe, aucun objet de l'état n'est enveloppé par le composant
      // doubt = 1;
      // </no-wrapper>
    }
  }
  if (doubt) {
    v._mjs_src = null;
    _mjsClockView(el);
    _mjsDoubtKeys(el, s);
    v._mjs_seen = h.n;
  }
}
// fonction du nœud d'une valeur précise : son calcul, appelé par le graphe à sa lecture (µ._mjs_sigGet), ou pour vérifier une valeur
// précise qui la lit ; ses lectures notent un doute (cf. _mjsDoubtCalc), et la règle de toujours la reprend si elle a douté. Le compte de
// l'horloge est relu APRÈS le calcul : une écriture faite par le calcul lui-même ne le périme pas. Rend au graphe une valeur simple
// telle quelle (refaite à l'identique, elle ne fait pas refaire celles qui la lisent), un objet ou une fonction sous un jeton neuf :
// refaite, elle peut rendre le même objet changé en place (`$sel = $l.find(…)` après `$l[0].nom = …`), que `Object.is` dirait
// identique — les valeurs précises qui lisent son contenu se refont
function _mjsPrecise(el, v) {
  return function() {
    const __computing = µ._mjs_computing, __precise = _mjsP;
    // <derived-check>
    // les accesseurs propres que lit le calcul, avec ce qu'ils rendent (cf. _mjsReread) : la relecture n'accusera que ceux qui
    // rendent autre chose
    const __rereads = _mjsRereads;
    _mjsRereads     = v._mjs_reads = [];
    // </derived-check>
    v._mjs_evaluating = true;
    v._mjs_done       = 1;
    µ._mjs_computing  = el;
    _mjsP             = v;
    try {
      // <derived-check>
      const __before = v._mjs_cached, __first = v._mjs_seen < 0;
      // </derived-check>
      const x = v._mjs_cached = v.f.call(el._state);
      v._mjs_seen = v._mjs_h.n;
      if (v._mjs_src !== null) _mjsPreciseEnd(el, v);
      // <derived-check>
      // la règle de la valeur, si elle en a une (cf. _mjsDerivedCheck) : son nom est celui de son nœud, `$` en moins
      if (el._mjs_types !== void 0) _mjsDerivedCheck(el, v._mjs_n.name.slice(1), x, __before, __first);
      // </derived-check>
      return x !== null && (typeof x === 'object' || typeof x === 'function') ? {} : x;
    }
    finally {
      v._mjs_evaluating = false;
      µ._mjs_computing  = __computing;
      _mjsP             = __precise;
      // <derived-check>
      _mjsRereads         = __rereads;
      // </derived-check>
    }
  };
}
// <derived-check>
// contrôle des valeurs précises, hors production (bloc retiré de la production) : une valeur qui va servir son dernier calcul
// après une écriture du composant (l'horloge l'aurait refaite) est refaite à part et comparée. Une différence dit qu'une donnée
// qu'elle lit a changé hors de MJS : un avertissement par valeur et par composant, qui dit quoi écrire ; la valeur servie reste
// celle du dernier calcul, comme en production. Le calcul de contrôle ne note aucun doute (`_mjsP` nul) et ne garde rien que
// les accesseurs propres qu'il lit (`read`, cf. _mjsReread), avec ce qu'ils rendent
function _mjsRereading(el, k, v) {
  const __computing = µ._mjs_computing, __precise = _mjsP, __graph = µ._mjs_sigCur, __rereads = _mjsRereads, read = [];
  let x;
  v._mjs_evaluating = true;
  µ._mjs_computing  = el;
  _mjsP             = null;
  µ._mjs_sigCur     = null;
  _mjsRereads         = read;
  try {
    x = v.f.call(el._state);
  }
  catch {
    // le recalcul lève : la production sert le dernier calcul sans le refaire, rien à comparer
    return;
  }
  finally {
    v._mjs_evaluating = false;
    µ._mjs_computing  = __computing;
    _mjsP             = __precise;
    µ._mjs_sigCur     = __graph;
    _mjsRereads         = __rereads;
  }
  if (_mjsSameValue(x, v._mjs_cached, 0)) return;
  const key = el.localName + ' ' + k;
  if ((µ._mjs_lastWarned ||= new Set()).has(key)) return;
  µ._mjs_lastWarned.add(key);
  // le remède, source par source : `µrefresh($x)`, `µrefresh($$x)` pour un magasin (source `$x`) ; ni champ de prototype (`.nom`)
  // ni valeur dérivée
  const w = v._mjs_src.filter((s) => s.charCodeAt(0) !== 46 && el._mjs_computeds[s] === void 0).map((s) => '`µrefresh($' + s + ')`').join(', ') || '`µrefresh($x)`';
  // un accesseur propre que la valeur lit et qui rend autre chose qu'au dernier calcul (`v._mjs_reads`, relevé par _mjsPrecise) : MJS
  // ne voit pas changer ce qu'il lit, écrit par MJS ou non — le message le nomme, sans parler d'un changement fait hors de MJS ;
  // un accesseur qu'elle ne lit pas, ou qui rend ce qu'il rendait (une constante lue à côté d'un champ changé hors de MJS), n'est
  // pas la cause : il n'est pas nommé
  const a = _mjsAccessor(el, v, _mjsOthers(read, v._mjs_reads || []));
  if (a) µ.warn(µ._mjs_msg('derivedAccessor', { k: '$' + k, c: el.localName, a: '`' + a + '`', w: w }, 'La valeur dérivée « {k} » du composant <{c}> a servi son dernier calcul alors que son recalcul donne autre chose : elle lit un accesseur posé sur un objet ({a}), et MJS ne voit pas changer ce que lit cet accesseur, même quand votre code l\'écrit par une autre variable `$`. Juste après chacun de ces changements, écrivez {w}, ou rangez cette valeur dans un champ plutôt que dans un accesseur. Cet avertissement n\'existe qu\'en développement : la valeur servie reste celle de la production.'));
  else µ.warn(µ._mjs_msg('derivedPrecise', { k: '$' + k, c: el.localName, w: w }, 'La valeur dérivée « {k} » du composant <{c}> a servi son dernier calcul alors que son recalcul donne autre chose : une donnée qu\'elle lit a sans doute été changée hors de MJS (bibliothèque, script extérieur, objet gardé dans une variable sans `$`). Juste après ce changement, écrivez {w}. Cet avertissement n\'existe qu\'en développement : la valeur servie reste celle de la production.'));
}
// accesseurs lus par la relecture (`read`, par triplets objet brut, nom, valeur) qui ne rendent pas ce qu'ils rendaient au dernier
// calcul (`avant`, même forme) : lus seulement maintenant, ou de valeur autre au sens du contrôle (cf. _mjsSameValue)
function _mjsOthers(read, before) {
  const r = [];
  for (let i = 0; i < read.length; i += 3) {
    let j = 0;
    while (j < before.length && (before[j] !== read[i] || before[j + 1] !== read[i + 1])) j += 3;
    if (j >= before.length || !_mjsSameValue(read[i + 2], before[j + 2], 0)) r.push(read[i], read[i + 1], read[i + 2]);
  }
  return r;
}
// accesseur propre (`get` posé sur l'objet lui-même, que la lecture d'une valeur précise ne regarde pas) que la relecture de la
// valeur `v` a lu (`read`, cf. _mjsReread), cherché depuis ses sources sur 6 niveaux comme la comparaison : son chemin (`$l[0].p`) ;
// hors d'atteinte (dans une `Map`, plus profond), son nom (`.p`) ; aucun lu, ''. Lu sur les objets bruts, hors du graphe ; un objet
// qui lève à l'examen (Proxy de l'application) n'en a pas
function _mjsAccessor(el, v, read) {
  if (read.length === 0) return '';
  const wasRead = (o, k) => {
    for (let j = 0; j < read.length; j += 3) if (read[j] === o && read[j + 1] === k) return true;
    return false;
  };
  const seen = new Set(), graph = µ._mjs_sigCur;
  const see = (o, ch, n) => {
    if (o === null || typeof o !== 'object' || n > 6) return '';
    o = µ._mjs_toRaw(o);
    if (seen.has(o)) return '';
    seen.add(o);
    const keys = Reflect.ownKeys(o);
    for (let i = 0; i < keys.length; i++) {
      const d   = Reflect.getOwnPropertyDescriptor(o, keys[i]);
      const name = ch + (Array.isArray(o) ? '[' + String(keys[i]) + ']' : '.' + String(keys[i]));
      const r   = d === void 0 ? '' : d.get ? (wasRead(o, keys[i]) ? name : '') : see(d.value, name, n + 1);
      if (r) return r;
    }
    return '';
  };
  µ._mjs_sigCur = null;
  try {
    for (let i = 0; i < v._mjs_src.length; i++) {
      const s = v._mjs_src[i];
      const r = s.charCodeAt(0) !== 46 && el._mjs_computeds[s] === void 0 ? see(el._state[s], '$' + s, 0) : '';
      if (r) return r;
    }
  }
  catch {
    // examen impossible : le nom de l'accesseur lu
  }
  finally {
    µ._mjs_sigCur = graph;
  }
  return '.' + String(read[1]);
}
// relecture de contrôle en cours (cf. _mjsRereading), ou calcul d'une valeur précise hors production (cf. _mjsPrecise) : les
// accesseurs propres qu'il lit par une enveloppe, par triplets (objet brut, nom, valeur rendue) ; null hors de ces calculs
var _mjsRereads = null;
// lecture du champ `k` de `o` par une enveloppe pendant l'un de ces calculs, valeur `x` : un accesseur propre se relève
function _mjsReread(o, k, x) {
  const d = Reflect.getOwnPropertyDescriptor(o, k);
  if (d !== void 0 && d.get !== void 0) _mjsRereads.push(o, k, x);
}
// même valeur, au sens du contrôle : identiques, ou de même contenu sur 6 niveaux — listes, objets et instances (par leurs
// champs propres), `Map`, `Set`, dates, expressions régulières, fonctions de même texte (une fermeture neuve à chaque calcul).
// Au-delà, un objet qui se contient lui-même compris, deux objets sont tenus pour égaux : pas d'avertissement plutôt qu'un faux
function _mjsSameValue(a, b, n) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return String(a) === String(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (n > 6) return true;
  a = µ._mjs_toRaw(a);
  b = µ._mjs_toRaw(b);
  if (a === b) return true;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => _mjsSameValue(x, b[i], n + 1));
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map) return a.size === b.size && [...a].every(([c, x]) => b.has(c) && _mjsSameValue(x, b.get(c), n + 1));
  if (a instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((c) => hasProp.call(b, c) && _mjsSameValue(a[c], b[c], n + 1));
}
// </derived-check>
// </precision>
// </derived-values>

// <refresh>
// `µrefresh($x)` (compilé en `µ._mjs_refresh(_mjsThis, 'x')`, sigils.ts) : le signal d'un changement fait hors de MJS dans ce que
// tient `$x` (bibliothèque, script extérieur, objet gardé dans une variable sans `$`). Ce qui affiche `$x`, et les variables qui
// tiennent le même objet, se redessine ; les valeurs dérivées qui les lisent se refont — précises, elles repassent à l'horloge
// pour toujours ; aucun `µeffect` ne repart, le parent lié n'est pas prévenu ; l'enfant à qui une liaison de `$x` repose un objet que
// `$x` atteint se rafraîchit de même, et ainsi de proche en proche (cf. _mjsRetell). Avec ou sans la précision ;
// en production, le bloc n'entre au cœur que si une unité du build écrit la rune
// appelé pendant un rendu (une fonction que lit le gabarit, un écouteur que ce rendu déclenche : le blur du champ qu'il retire, le
// focus d'un `el.focus()` dans `@attach`, un clic qu'il lance) ou le calcul d'une valeur dérivée : jamais ignoré, appliqué juste
// après, comme une écriture faite par un effet — jamais au milieu du rendu, et compté par le détecteur de boucle
µ._mjs_refresh = function(el, k) {
  const r = µ._mjs_rendering || µ._mjs_computing, f = µ._mjs_inEffect;
  // <refresh-notice>
  // le calcul d'une valeur dérivée qui l'appelle ne se périme pas lui-même, mais deux valeurs dont chacune rafraîchit une source
  // de l'autre se refont l'une l'autre sans fin : plus de 1 000 appels faits par les calculs d'un composant dans la même rafale
  // (nommée par la minuterie du détecteur de boucle) → µrefresh et la valeur nommés, une fois par composant
  const c = µ._mjs_computing;
  if (c) {
    const e = µ._mjs_mtT ||= setTimeout(() => { µ._mjs_mtT = 0; });
    if (c._mjs_rfE !== e) {
      c._mjs_rfE = e;
      c._mjs_rfN = 0;
    }
    if (++c._mjs_rfN > 1000 && !(µ._mjs_rafWarned ||= new Set()).has(c.localName)) {
      µ._mjs_rafWarned.add(c.localName);
      const cs = c._mjs_computeds || {};
      const d  = Object.keys(cs).find((n) => cs[n]?._mjs_evaluating);
      µ.warn(µ._mjs_msg('refreshCompute', { k: '$' + k, d: '$' + d, c: c.localName }, 'µrefresh({k}) est appelé par le calcul de la valeur dérivée {d} du composant <{c}>, plus de 1 000 fois dans la même rafale : deux valeurs dérivées dont chacune rafraîchit une source de l\'autre se refont l\'une l\'autre en boucle. Une valeur dérivée ne doit pas appeler µrefresh : écrivez µrefresh({k}) dans le script ou dans un gestionnaire d\'événement, juste après le changement fait hors de MJS. Cet avertissement n\'existe qu\'en développement.'));
    }
  }
  // un rendu qui le rappelle à chaque fois (fonction que lit le gabarit, écouteur relancé par chaque rendu) : le détecteur de
  // boucle coupe le composant après 10 000 rendus de la rafale ; µrefresh nommé, une fois par composant et par variable
  const key = el.localName + ' ' + k;
  if (!c && r && el._mjs_mtN > 10000 && el._mjs_mtE === µ._mjs_mtT && !(µ._mjs_rafWarned ||= new Set()).has(key)) {
    µ._mjs_rafWarned.add(key);
    µ.warn(µ._mjs_msg('refreshRender', { k: '$' + k, c: el.localName }, 'µrefresh({k}) est appelé pendant chaque rendu du composant <{c}> (une fonction que lit le gabarit, ou un écouteur que ce rendu déclenche à chaque fois), et chaque appel redessine ce que ce rendu affiche : une boucle, que MJS a coupée. Écrivez µrefresh({k}) dans le script ou dans un gestionnaire d\'événement, juste après le changement fait hors de MJS ; une fonction que lit le gabarit ou une valeur dérivée ne doit pas l\'appeler. Cet avertissement n\'existe qu\'en développement : la production coupe la boucle de même.'));
  }
  // </refresh-notice>
  const x = el._state[k];
  const t = x !== null && typeof x === 'object' ? µ._mjs_toRaw(x) : void 0;
  // <collections>
  // index des clés des collections de l'état (µ._mjs_keyAlt, mjs_init.ts) : oubliés, refaits au prochain raté — une collection a pu changer
  µ._mjs_keyIdx = new WeakMap();
  // </collections>
  // <derived-values>
  // objet signalé : les valeurs à l'horloge qui lisent une variable qui le tient suivent aussi les écritures profondes à venir (cf.
  // _mjsIsHidden, _mjsClockRedraw)
  if (t !== void 0) _mjsReported.add(t);
  // <precision>
  if (t !== void 0) {
    _mjsDoubtKeys(el, [k]);
    const fi = el._mjs_rootsByTarget?.get(t);
    if (fi) _mjsDoubtKeys(el, fi.s || [fi.r]);
  }
  // </precision>
  // </derived-values>
  // pendant un rendu ou un calcul : au tour suivant, comme une écriture faite par un effet
  µ._mjs_inEffect = f || !!r;
  try {
    if (t !== void 0) el._mjs_notifyMutationAliased(t, k, x, 1);
    else el._mjs_notifyMutation(k, x, 1);
  } finally {
    µ._mjs_inEffect = f;
  }
};
// </refresh>

// <write-no-render>
// `µwrite $x, v` (lexer : `µ._mjs_rawWrite(_mjsThis).x = v`) : la case écrite sans rendu ni liaison, mais les valeurs dérivées
// qui la lisent se recalculent à leur prochaine lecture — un compte de plus à leur horloge, APRÈS l'écriture (la valeur est
// calculée avant). Une seule enveloppe par composant
µ._mjs_rawWrite = function(el) {
  return el._mjs_rawProxy ||= new Proxy(el._state, {
    set(t, k, v) {
      t[k] = v;
      // objet rangé sans rendu : le composant est noté parmi ceux qui le tiennent, comme par une affectation ordinaire (cf. `_set`,
      // _mjsHold) — le second composant qui prend ainsi l'objet d'un autre le marque partagé : ce qu'il y écrit par son code compilé fait
      // avancer son époque, le premier le voit quand l'objet lui est redonné, et l'écran d'une valeur à l'horloge du premier suit
      if (v !== null && typeof v === 'object') _mjsHold(el, µ._mjs_toRaw(v));
      // <derived-values>
      if (el._mjs_computeds) _mjsCount(el._mjs_computeds, k);
      // </derived-values>
      // <signals>
      // comme l'horloge : chaque écriture avance la boîte, même valeur comprise ; sans rendu, aucun reffet ne repart
      if (el._mjs_sigBoxes) µ._mjs_sigWrite(el, k, 1);
      // </signals>
      return true;
    }
  });
};
// </write-no-render>

// époques des liaisons (`µ._mjs_epochs`, mjs_init.ts) : seul `_set` les compare, quand il reçoit l'objet qu'une de ses
// variables tient déjà — prop d'un enfant, liaison à deux sens, objet partagé par deux composants. Tant qu'aucun objet de
// l'état n'est tenu par deux composants, personne n'en compare : une écriture profonde ne fait pas avancer l'époque de
// l'objet écrit (mjs_deep.ts). L'objet rangé dans l'état d'un second composant est MARQUÉ partagé (`µ._mjs_sharedRoots`), lui seul : ses écritures profondes font avancer son époque, celles des autres objets de la page gardent leur précision ; `µ._mjs_sharing` dit seulement qu'un objet de la page a été marqué un jour — tant qu'il est faux, aucune écriture ne lit le carnet des objets marqués. La
// table des objets tenus (`µ._mjs_holders` : objet → la référence faible de son premier détenteur, cf. _mjsWeak), tenue à jour par toute affectation, sert aussi aux écritures profondes : un parent qui écrit un champ d'un objet
// qu'un enfant tient (`item={r}` d'une ligne) en fait avancer l'époque, que l'enfant compare quand l'objet lui revient
const _mjsHolders = µ._mjs_holders = new WeakMap();
µ._mjs_sharedRoots = new WeakSet();
µ._mjs_sharing  = false;
// référence faible d'un composant, une par composant, faite à son premier objet rangé : c'est elle que rangent les deux tables qui notent le
// premier détenteur d'un objet (`µ._mjs_holders`, `_mjsProprios`), jamais le composant — elles le garderaient en mémoire, lui et ses balises,
// tant que vit l'objet (une liste gardée par la page ou par un magasin). Qui lit ces tables compare la référence (`t !== el._mjs_wr` : tenu
// d'abord par un autre) ou la suit (`t.deref()` : le premier détenteur tant qu'il vit, dans la page ou non). Sans `WeakRef` (vieux
// navigateur), un objet qui rend le composant : il reste retenu
function _mjsWeak(el) {
  return el._mjs_wr ||= typeof WeakRef === 'function' ? new WeakRef(el) : { deref: () => el };
}
// blocs `<retell>` : gardés avec `<middle>` quand l'enveloppe est là (la remontée repliée s'en sert) ; sans l'enveloppe (réglage
// `proxy: false`), seul `µrefresh` s'en sert — une appli de production qui n'écrit pas la rune n'en porte rien (bundler/index.ts)
// <retell>
// LA REDITE : les liaisons d'une clé d'un composant sont redites quand `µrefresh` la rafraîchit (mode 1 : `_mjs_invalidate` le sait par son
// drapeau `rw`, pour une variable comme pour une clé du magasin) ou quand une écriture par un nom dont la remontée s'est repliée l'atteint
// (mode 2, cf. _mjsLift : `k` et les clés de la fiche `f` de l'objet écrit, marquées ici). Pendant qu'elles rejouent — sur-le-champ, ou à
// la passe du composant si son rendu attend (`_mjs_invalidate` nomme dans `µ._mjs_retold` le composant dont les liaisons rejouent et ses clés
// redites) — l'enfant à qui l'une d'elles repose l'objet qu'il tient déjà, époque inchangée, est prévenu quand même (cf. `_set`,
// _mjsRetold) : jamais un enfant figé. Aucun parcours des données. La marque (`_mjs_rdp`, clé → mode) part avec l'appel qui l'a posée, sauf
// si un rendu attend : la passe suivante du composant la prend
µ._mjs_retold = null;
function _mjsRetell(el, f, k, mode, fn) {
  const before = el._mjs_rdp, p = before || (el._mjs_rdp = Object.create(null));
  if (!(p[k] > mode)) p[k] = mode;
  if (f !== void 0) {
    if (f.s === void 0) {
      if (!(p[f.r] > mode)) p[f.r] = mode;
    }
    else f.s.forEach((c) => {
      if (!(p[c] > mode)) p[c] = mode;
    });
  }
  try {
    return fn();
  }
  finally {
    // un rendu qui attend (passe en microtâche, boucle qui écrit l'état, gel d'une traduction) rejouera ces liaisons : la marque reste
    let freed = before === void 0 && !el._mjs_render_scheduled && !el._mjs_i18n_hold;
    // <loops>
    freed &&= !el._mjs_lqk;
    // </loops>
    if (freed) el._mjs_rdp = void 0;
  }
}
// l'enfant `el` reçoit pour sa variable `k` l'objet `raw` qu'il tient déjà pendant que le composant qui le donne redit des clés : il suit
// si l'une d'elles atteint l'objet chez le donneur (sa fiche, une consultation) — objet que le donneur ne connaît pas (objet brut,
// sous-objet sans l'enveloppe) : il suit aussi, plutôt que de rester figé. Époque inchangée (`reel` à 0) : clé rafraîchie, il se
// rafraîchit comme par son propre `µrefresh` — il se redessine, ses valeurs dérivées se refont, aucun reffet ne repart, le parent lié
// n'est pas prévenu ; clé écrite, il est prévenu comme d'une écriture. Époque avancée (`reel` à 1 : une écriture vue par MJS) : il est
// prévenu de cette écriture, comme toujours. Dans tous ces cas ses propres liaisons sont redites à leur tour, de proche en proche : son
// enfant, dont l'objet peut n'avoir pas avancé, suit aussi. Le donneur qui reçoit son propre objet (écho d'une prop liée) ne redit rien
function _mjsRetold(el, k, raw, old, real) {
  // <wrapper>
  const d = µ._mjs_retold, ks = d.k, f = d.e === el ? void 0 : d.e._mjs_rootsByTarget?.get(raw);
  // </wrapper>
  // <no-wrapper>
  // // sans l'enveloppe, la fiche du donneur ne connaît que les variables qui tiennent l'objet lui-même, jamais celle qui l'atteint plus
  // // bas (`$sel = $rows[0]` : la ligne est aussi sous `$rows`) : l'enfant suit toute clé redite, comme pour un objet que le donneur ne
  // // connaît pas
  // const d = µ._mjs_retold, ks = d.k, f = void 0;
  // </no-wrapper>
  let m = 0;
  if (d.e !== el) {
    if (f === void 0) {
      for (const c in ks) if (ks[c] > m) m = ks[c];
    }
    else if (f.s === void 0) m = ks[f.r] || 0;
    else f.s.forEach((c) => {
      if (ks[c] > m) m = ks[c];
    });
  }
  // <refresh>
  if (m === 1 && !real) {
    µ._mjs_refresh(el, k);
    return true;
  }
  // </refresh>
  if (m !== 0) _mjsRetell(el, el._mjs_rootsByTarget?.get(raw), k, m, () => el._mjs_notifyMutation(k, old));
  else if (real) el._mjs_notifyMutation(k, old);
  return true;
}
// </retell>
// <middle>
// un composant peut tenir un objet du milieu d'un chemin écrit (`item={$o.a.b}`, puis `$o.a.b.c.d = v` chez le parent) : vrai dès qu'un
// objet de l'état est tenu par deux composants, ou qu'un composant reçoit un objet lu dans un état (enveloppé, cf. `_set`) ; une écriture
// profonde fait alors avancer l'époque des objets du milieu de son chemin que tient un composant (_mjsDeepMiddle, mjs_deep.ts). Bloc
// gardé seulement si une unité du build passe une prop à un composant (bundler/index.ts) ; sans l'enveloppe (réglage `proxy: false`),
// rien ne dit d'où vient un objet reçu : vrai d'emblée
// <wrapper>
µ._mjs_middle = false;
// </wrapper>
// <no-wrapper>
// µ._mjs_middle = true;
// </no-wrapper>
// </middle>
// `el` range l'objet `raw` : le premier à le tenir, sa référence faible est notée ; un AUTRE l'a tenu avant lui — encore dans la page ou
// non, encore en vie ou non : sorti, il peut l'écrire encore (requête finie après son départ, page gardée par le routeur) ou revenir —,
// l'objet est marqué partagé, pour de bon. Rangé pour la première fois : les écritures profondes oublient la réponse « tenu par
// personne » qu'elles retenaient pour lui (`µ._mjs_notHeld`, cf. _mjsDeepHeld, mjs_deep.ts)
function _mjsHold(el, raw) {
  const w = _mjsWeak(el), t = _mjsHolders.get(raw);
  if (t === void 0) {
    _mjsHolders.set(raw, w);
    if (raw === µ._mjs_notHeld) µ._mjs_notHeld = void 0;
  }
  else if (t !== w) {
    µ._mjs_sharedRoots.add(raw);
    // <no-middle>
    // µ._mjs_sharing = true;
    // </no-middle>
    // <middle>
    µ._mjs_sharing = µ._mjs_middle = true;
    // </middle>
  }
}
// <wrapper>
// LE REGISTRE DES DÉTENTEURS : objet brut → la référence faible de chaque détenteur qui en a fait l'enveloppe — un composant (son
// `_mjs_wr`, cf. _mjsWeak), un état de module ou un `µ.Store` (leur `_mjs_dr`, cf. µ._mjs_claims) : la sienne seule tant qu'un seul le
// tient, une liste dès le second, et `µ._mjs_claimed` se lève pour de bon. Une inscription par enveloppe créée, rien par lecture. Lu par
// l'écriture d'un détenteur (son enveloppe, un chemin compilé, la mise à jour fine), drapeau levé seulement : tant qu'aucun objet n'a eu deux
// détenteurs, une écriture n'en paie que la lecture du drapeau ; lu aussi par l'écriture du magasin par un objet trouvé (µ._mjs_storeSetOn,
// mjs_store_globals.ts), qui ne sait pas par quel conteneur un composant atteint l'objet. Chaque AUTRE détenteur en est prévenu, une fois,
// par ses propres clés (`_mjs_claimNotice`). Clés faibles : la table ne retient ni un objet ni un composant ; un détenteur mort, sorti de la
// page ou qui ne tient plus l'objet est sauté et retiré de sa liste par l'avis, et une liste qui double de taille hors d'un avis perd au
// passage ses détenteurs morts
const _mjsClaimants = new WeakMap();
µ._mjs_claimed = false;
// avis en cours : une écriture faite pendant l'avis ne prévient aucun détenteur (ni cascade ni boucle), et la prop liée du détenteur
// prévenu ne remonte pas (cf. `_mjs_notifyMutation`) ; `_mjsClaimTurn`, le tour d'avis, noté `_mjs_claimT` sur chaque
// détenteur prévenu : rangé deux fois dans une liste, même sous deux références (rechargement à chaud), il ne l'est qu'une fois, et sa
// seconde place part
let _mjsNoticing = false, _mjsClaimTurn = 0;
// états et magasins que l'écrivain `_mjsTapEl` vient de prévenir pour l'objet `_mjsTapObj` (`_mjsTapSeen`, leurs fiches, cf. _mjsTap) :
// l'avis qui suit les passe
let _mjsTapEl, _mjsTapObj, _mjsTapSeen;
// <claimant-families>
function _mjsClaimRef(h) {
  return typeof WeakRef === 'function' ? new WeakRef(h) : { deref: () => h };
}
// </claimant-families>
// `w`, la référence faible d'un détenteur, vient de faire l'enveloppe de l'objet brut `raw`
function _mjsClaims(w, raw) {
  const d = _mjsClaimants.get(raw);
  if (d === void 0) _mjsClaimants.set(raw, w);
  else if (d !== w) {
    if (!Array.isArray(d)) _mjsClaimants.set(raw, [d, w]);
    else {
      // pendant un avis, la liste est celle qu'il parcourt et range en place (cf. _mjsClaimNotice) : élaguée là, ses places glisseraient et
      // un détenteur vivant serait sauté, puis perdu ; l'avis retire lui-même les morts. Seize détenteurs ou plus, une puissance de deux :
      // écrit court, la garde de l'avis ne pèse rien
      if (!_mjsNoticing && d.length > 15 && !(d.length & (d.length - 1))) _mjsClaimPrune(d);
      d.push(w);
    }
    µ._mjs_claimed = true;
  }
}
// <claimant-families>
// pour les enveloppes de `µ.state` et de `µ.Store` (fichiers à part) : leur objet de famille, sans `_mjs_wr` (tout détenteur est un autre
// pour la remontée, cf. _mjsLift), prend sa propre référence faible ; retirée avec `_mjsClaimRef` quand ni mjs_state.ts ni mjs_store.ts, seuls
// à l'appeler, n'est dans la construction
µ._mjs_claims = (h, raw) => _mjsClaims(h._mjs_dr ||= _mjsClaimRef(h), raw);
// </claimant-families>
// la liste `d` perd ses détenteurs morts ; un composant hors de la page y reste : une ligne déplacée par un `{for}` en sort le temps de la
// réconciliation, où des enveloppes se font
function _mjsClaimPrune(d) {
  let i, j = 0;
  for (i = 0; i < d.length; i++) {
    if (d[i].deref() !== void 0) d[j++] = d[i];
  }
  d.length = j;
}
// écriture faite dans l'objet brut `raw` par le composant `el` (nul : le magasin, cf. µ._mjs_storeSetOn) : chaque autre détenteur en est
// prévenu, une fois. `a` et `b` : objets dont les variables sont déjà prévenues par l'écriture (pour le magasin, l'objet écrit et la racine
// de sa clé, cf. µ._mjs_storeNotifyDeep) — la clé d'un détenteur qui en tient un est passée
function _mjsClaimNotice(el, raw, a, b) {
  const d = _mjsClaimants.get(raw), fs = _mjsTapEl === el && _mjsTapObj === raw ? _mjsTapSeen : void 0;
  _mjsTapEl = _mjsTapObj = _mjsTapSeen = void 0;
  if (d === void 0 || _mjsNoticing) return;
  const me = el ? el._mjs_wr : void 0;
  if (d === me) return;
  // la garde des boucles de rendu de l'écrivain (`_mjs_mtN`, cf. la passe du composant) compte aussi ses avis, au même plafond et avec
  // le même message, dès qu'il a fait 100 rendus dans la rafale : écrire l'objet partagé à chacun de ses rendus n'y fait pas redessiner
  // ses détenteurs sans fin ; une écriture faite hors de ses rendus (gestionnaire, boucle du script) n'y compte pas
  if (el !== null && el._mjs_mtN >= 100 && el._mjs_mtE === (µ._mjs_mtT || 0) && !_mjsClaimGuard(el)) return;
  _mjsNoticing = true;
  try {
    if (!Array.isArray(d)) {
      if (!_mjsClaimWarns(d, raw, a, b, fs, el)) _mjsClaimants.delete(raw);
      return;
    }
    const t = ++_mjsClaimTurn, n = d.length;
    let i, j = 0, w, x;
    for (i = 0; i < n; i++) {
      w = d[i];
      x = w.deref();
      // mort : sa place part ; le même détenteur sous une seconde référence (rechargement à chaud) : une seule place, un seul avis
      if (x === void 0 || x._mjs_claimT === t) continue;
      x._mjs_claimT = t;
      if (x === el || _mjsClaimWarns(w, raw, a, b, fs, el)) d[j++] = w;
    }
    // détenteurs inscrits pendant l'avis (un rendu fait sur-le-champ) : gardés
    for (i = n; i < d.length; i++) d[j++] = d[i];
    d.length = j;
  }
  finally {
    _mjsNoticing = false;
  }
}
// mjs_deep.ts et mjs_store_globals.ts le lisent sur `µ`
µ._mjs_claimNotice = _mjsClaimNotice;
// un avis de plus compté à la garde de l'écrivain : à 10 001 dans la rafale, l'avertissement de la passe du rendu, une fois ; au-delà de
// 10 100, l'avis ne part plus
function _mjsClaimGuard(el) {
  const n = ++el._mjs_mtN;
  if (n === 10001) µ.warn(µ._mjs_msg('elLoop', { tag: el.tagName ? el.tagName.toLowerCase() : '?' }, 'Boucle réactive détectée sur <{tag}> : plus de 10 000 rendus dans la même rafale de microtasks. Un effet mute probablement sa propre dépendance ($x = $x + … dans un µeffect ?). Effets suspendus pour garder la page vivante.'));
  return n <= 10100;
}
// <development>
// l'écran de `el` suit-il une écriture de l'objet brut `raw` ? Oui quand le registre le connaît comme détenteur, ou qu'un état de module ou
// un `µ.Store` qui tient l'objet le compte parmi les lecteurs d'une clé qui l'atteint. L'avertissement d'un objet reçu modifié
// (mjs_debug.ts) ne dit que l'écran suit qu'alors
µ._mjs_claimKnown = (el, raw) => {
  const d = _mjsClaimants.get(raw), w = el._mjs_wr;
  if (d === void 0) return false;
  if (!Array.isArray(d)) return d === w || _mjsClaimReads(d.deref(), el, raw);
  return d.some((x) => x === w || _mjsClaimReads(x.deref(), el, raw));
};
// le détenteur `h`, un état de module (l'objet de sa famille) ou un `µ.Store`, compte-t-il `el` parmi les lecteurs d'une clé par où il
// atteint l'objet brut `raw` ? Les clés sont celles que son avis prévient (`_mjs_claimNotice`) ; un composant détenteur ne répond pas ici
function _mjsClaimReads(h, el, raw) {
  if (h === void 0 || h._mjs_wr !== void 0) return false;
  const f = h._mjs_rootsByTarget.get(raw);
  if (f === void 0) return false;
  // µ.Store : ses abonnés, par clé ; état de module : ses lecteurs, rangés par clé sous son objet interne
  const subscribers = h._mjs_subscribers, readers = subscribers === void 0 ? µ._mjs_universalDeps.get(h.i) : void 0;
  for (const k of subscribers !== void 0 ? f.B.keys() : f.s || [f.r]) {
    const s = subscribers !== void 0 ? subscribers.get(k) : readers && readers[k];
    if (s !== void 0 && s.has(el)) return true;
  }
  return false;
}
// </development>
// composant remis dans la page : il redevient un détenteur des objets d'où un avis l'a retiré pendant son absence, ceux qu'il tient
// encore (sa fiche)
function _mjsClaimReturns(el) {
  const l = el._mjs_claimOut, w = _mjsWeak(el);
  el._mjs_claimOut = void 0;
  for (const raw of l) if (el._mjs_rootsByTarget.get(raw) !== void 0) _mjsClaims(w, raw);
}
// le détenteur de la référence faible `w` est prévenu (cf. `_mjs_claimNotice`) ; faux quand il est mort, sorti de la page ou qu'il ne tient
// plus l'objet. Un état ou un magasin que l'écrivain vient de prévenir (`fs`, cf. _mjsTap), et l'écrivain `el` lui-même sous une autre
// référence, sont passés, et gardés
function _mjsClaimWarns(w, raw, a, b, fs, el) {
  const x = w.deref();
  if (x === void 0) return false;
  if (x === el) return true;
  if (fs !== void 0 && fs.some((h) => h.e === x)) return true;
  return x._mjs_claimNotice(raw, a, b);
}
// </wrapper>
// <ledger>
// carnet des objets gardés, pour l'appli dont une unité range un objet du magasin ou d'un état de module là où une variable `$` peut le
// prendre (STORE_HELD, bundler/features.ts) : objet brut → composants dans la page qui le tiennent dans une variable `$`, prop comprise
// (`_set`). Une écriture du magasin (mjs_store_globals.ts) ou d'un état de module (mjs_state.ts) y cherche l'objet écrit, les objets
// gardés que son chemin traverse et la racine de sa clé, et prévient chaque composant qui en tient un (µ._mjs_ledgerSees) : le second
// détenteur, le composant remis dans la page, la liste gardée entière, l'écriture plus bas que l'objet gardé. Seules ces écritures le
// lisent : une écriture par la variable d'un composant (`$sel.nom = v`) prévient ce composant, comme dans une appli sans carnet — un
// objet de l'état d'un composant se conduit de même dans toutes les applis, quel que soit un autre fichier. À côté, par composant,
// les objets qu'il tient et le nombre de ses variables qui les tiennent : une variable qui quitte un objet l'y décompte, un composant
// sorti de la page quitte le carnet et y revient s'il y rentre. Clés faibles : rien n'y retient un objet, ni un composant sorti. Le
// carnet lui-même et sa lecture (`_mjsLedger`, µ._mjs_ledgerSees) sont posés dans mjs_init.ts, avant tout fichier qui écrit l'état dès
// le chargement du cœur (`µ.url` du routeur, concaténé avant ce fichier)
const _mjsLedgerOf = new WeakMap();
function _mjsLedgerSet(el, raw, n) {
  var d = _mjsLedgerOf.get(el), s = _mjsLedger.get(raw), c;
  if (d === void 0) _mjsLedgerOf.set(el, d = new Map());
  c = (d.get(raw) || 0) + n;
  if (c < 1) {
    d.delete(raw);
    if (s !== void 0) s.delete(el);
    return;
  }
  d.set(raw, c);
  if (!el.isConnected) return;
  if (s === void 0) _mjsLedger.set(raw, s = new Set());
  s.add(el);
}
// composant entré dans la page (`dans` vrai) ou sorti : il rejoint, ou quitte, la liste de chaque objet qu'il tient
function _mjsLedgerPage(el, inside) {
  var d = _mjsLedgerOf.get(el), o, s;
  if (d === void 0) return;
  for (o of d.keys()) {
    s = _mjsLedger.get(o);
    if (!inside) { if (s !== void 0) s.delete(el); continue; }
    if (s === void 0) _mjsLedger.set(o, s = new Set());
    s.add(el);
  }
}
// </ledger>

// <loops>
// prop liée à deux sens (`v=!{$x}`) écrite pendant une boucle qui écrit l'état (generator/loop-batch.ts) : son nom est noté
// (`_mjs_lqb`) et le composant entre dans la file des boucles (`µ._mjs_lqq`, mjs_init.ts) sous le nom `_MJS_LINKS` ; la
// sortie de la boucle la plus extérieure le repasse par `_mjs_invalidate`, qui envoie alors un `mjs-bind` par nom noté,
// avec la valeur finale : un événement par liaison et par boucle, au lieu d'un par écriture
const _MJS_LINKS = Symbol('mjs-links');
function _mjsBindsInLoop(el, k) {
  if (el._mjs_lqb) el._mjs_lqb.add(k);
  else el._mjs_lqb = new Set([k]);
  if (el._mjs_lqk) {
    el._mjs_lqk.add(_MJS_LINKS);
  }
  else {
    el._mjs_lqk = new Set([_MJS_LINKS]);
    µ._mjs_lqq.push(el);
  }
}
// </loops>

// expression du gabarit qui lit l'état par une clé calculée sans rien appeler (`{$[$k]}`, ou valeur dérivée qui en lit
// une) : la variable lue n'est connue qu'à l'exécution, le compilateur lui donne la dépendance `*` (analyzer/index.ts),
// écrite après chaque écriture du composant, une fois son propre rendu passé. Posé à la première connexion sur la seule
// instance qui en a une (son `_mjs_invalidate` propre) : les autres composants n'en paient rien, à aucune écriture
function _mjsAll(el) {
  const inv = el._mjs_invalidate;
  if (inv._mjs_all || !(el._mjs_effectsByVar?.['*'] || el._mjs_renderStructVars?.['*'])) return;
  // <redraw>
  const invalidateWithStar = function(k, rw) {
    inv.call(this, k, rw);
    if (k !== '*' && k !== '_awaits_') inv.call(this, '*', rw);
  // </redraw>
  // <no-redraw>
  // const invalidateWithStar = function(k) {
    // inv.call(this, k);
    // if (k !== '*' && k !== '_awaits_') inv.call(this, '*');
  // </no-redraw>
  };
  invalidateWithStar._mjs_all = true;
  el._mjs_invalidate = invalidateWithStar;
}

// le VRAI shadow root d'une balise est prêt, neuf ou repris d'un rendu serveur (jamais pour le repli `mjs-light`) :
// pont UJS (retargeting shadow fermé, cf. µ._mjs_ujsShadowAttach dans mjs_ujs.ts) et @title (mjs_title.ts), gardes
// `typeof` : ces modules peuvent être absents d'un runtime tree-shaké ; puis le défilement interne
function _mjsShadowReady(el) {
  el._mjs_isLight = false;
  if (typeof µ._mjs_ujsShadowAttach === 'function') { µ._mjs_ujsShadowAttach(el._shadow); }
  if (typeof µ._mjs_titleAttach === 'function') { µ._mjs_titleAttach(el._shadow); }
  if (el._shadow.addEventListener) { el._shadow.addEventListener('scroll', µ._mjs_innerScroll, { capture: true, passive: true }); }
}
// <server-places>
// la place d'un élément dans la page d'un composant, la même dans la page écrite par le serveur et dans la vue que le client bâtit du
// même gabarit : le réveil paresseux (mjs_wake.ts) et la saisie faite avant le démarrage (`<server-input>`) la lisent
var _MJS_WK_OUTSIDE = { STYLE: 1, LINK: 1, SCRIPT: 1, TEMPLATE: 1 };

// le composant dont la page contient `n` : l'hôte de sa racine d'ombre, ou le composant qui l'entoure (léger, ou dont il est un enfant glissé
// dans un `<slot>`)
function _mjsWkHost(n) {
  for (n = n.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 11) return n.host || null;
    if (n.tagName && n.tagName.indexOf('MJS-') === 0) return n;
  }
  return null;
}

// rang d'une balise parmi ses sœurs, feuilles de style et scripts du serveur mis à part
function _mjsWkRank(el) {
  var i = 0, c;
  for (c = el.parentNode.firstElementChild; c !== el; c = c.nextElementSibling) if (!_MJS_WK_OUTSIDE[c.tagName]) i++;
  return i;
}

// la place d'un élément depuis `top`, en texte : une étape par balise (`NOM:rang`), `#` pour entrer dans une racine d'ombre ; null hors de
// `top`
function _mjsWkPath(n, top) {
  var steps = [], p;
  while (n && n !== top) {
    p = n.parentNode;
    if (!p) return null;
    steps.unshift(n.tagName + ':' + _mjsWkRank(n));
    if (p === top) return steps.join('/');
    if (p.nodeType === 11) steps.unshift('#');
    n = p.nodeType === 11 ? p.host : p;
  }
  return n ? steps.join('/') : null;
}
// </server-places>
// <field-places>
// l'élément à la place `p` depuis `top` (cf. _mjsWkPath), s'il porte la balise que nomme chaque étape ; null sinon
function _mjsWkAt(top, p) {
  var n = top;
  p.split('/').every(function(s) {
    var c, i;
    if (s === '#') return n = n._shadow || n.shadowRoot;
    s = s.split(':');
    for (i = +s[1], c = n.firstElementChild; c && (_MJS_WK_OUTSIDE[c.tagName] || i--); c = c.nextElementSibling);
    return n = c && c.tagName === s[0] ? c : null;
  });
  return n;
}

// la marque de `n` vue depuis `top` : de `n` à `top` exclu, chaque élément, sa balise, ses attributs (hors l'état de l'utilisateur, la valeur
// de départ d'un champ et les repères du framework, dont le nom qu'il donne à un groupe `:group` sans `name`, `mjs-grp-…`) et son texte propre, sans blancs (un composant, sa balise seule) ; d'une liste, ses
// options. À la même place, une autre marque est un autre contenu : une ligne de `{for}` d'un autre élément, un autre bouton radio, une
// autre option
function _mjsWkSig(n, top) {
  var s = [], m = n, p, a, tx;
  for (; m && m !== top && m.nodeType === 1; m = (p = m.parentNode) && p.nodeType === 11 ? p.host : p) {
    a  = [];
    tx = '';
    if (m.tagName.indexOf('-') < 0) {
      Array.prototype.forEach.call(m.attributes, function(x) {
        if (!/^(mjs-|data-mjs|checked$|selected$|open$|style$)/.test(x.name) && !(x.name === 'value' && (m.tagName === 'SELECT' || m.tagName === 'INPUT' && m.type !== 'checkbox' && m.type !== 'radio')) && !(x.name === 'name' && x.value.indexOf('mjs-grp-') === 0)) a.push(x.name + '=' + x.value);
      });
      if (m.tagName !== 'TEXTAREA') Array.prototype.forEach.call(m.childNodes, function(c) { if (c.nodeType === 3) tx += c.data.replace(/\s+/g, ''); });
    }
    s.push(m.tagName + ' ' + a.sort().join(' ') + ' ' + tx);
  }
  if (n.tagName === 'SELECT') Array.prototype.forEach.call(n.options, function(o) { s.push(o.value + '|' + o.text.replace(/\s+/g, '')); });
  return s.join('\n');
}
// </field-places>
// <server-input>
// ce que le visiteur a tapé dans la page du serveur avant le démarrage du composant (le code de la page pas encore arrivé, un composant qui
// attendait son réveil) : relevé avant que sa vue remplace cette page ou la reprenne, chaque champ dont l'état n'est plus celui que le
// serveur a écrit (`defaultValue`, `defaultChecked`, `defaultSelected`), par sa place depuis le composant et sa marque (cf. _mjsWkPath,
// _mjsWkSig), les pages des composants qu'elle contient comprises ; au premier rendu, le champ lié de même place dans la vue le reçoit et
// sa liaison l'écrit dans sa variable (cf. _mjsTypedPut). Aucun événement n'est envoyé ; une page où rien n'a été tapé ne fait rien de plus
var _mjsTyped = new WeakMap(), _mjsTypedNo = new WeakSet(), _mjsTypedAny = 0;

// chaque champ de `root`, et ceux des pages du serveur des composants qu'il contient
function _mjsTypedEach(root, f) {
  root.querySelectorAll('input,textarea,select,[mjs-ssr]').forEach(function(n) {
    var r = n._shadow || n.shadowRoot;
    if (!n.hasAttribute('mjs-ssr')) f(n);
    else if (r && r !== n) _mjsTypedEach(r, f);
  });
}

// la saisie de la page de `el`, relevée avant que sa vue la remplace ou la reprenne : la valeur d'un champ de texte (`v`), une case ou un
// bouton radio (`c`), les options d'une liste (`s`) ; un champ dont le réveil à l'intention reporte lui-même la saisie n'est pas relevé
// (mjs_wake.ts). La liste, même vide, cache celle d'un composant qui l'entoure (cf. _mjsTypedPut)
function _mjsTypedTake(el) {
  var out = [];
  _mjsTypedEach(el._shadow || el, function(n) {
    var t = n.type, x = {};
    if (_mjsTypedNo.has(n)) return;
    if (n.tagName === 'SELECT') {
      // une liste déroulante (ni `size` plus grand que 1, ni `multiple`) où le serveur n'a choisi aucune option (sa variable n'en vaut aucune)
      // montre la première qu'on peut choisir : ce choix du navigateur n'est pas relevé, ni cette même option choisie par le visiteur, que rien
      // n'en distingue. Une boîte de liste ou une liste multiple ne choisit rien d'elle-même : tout choix y est celui du visiteur
      if (Array.prototype.some.call(n.options, function(o) { return o.selected !== o.defaultSelected; }) && (n.multiple || n.size > 1 || Array.prototype.some.call(n.options, function(o) { return o.defaultSelected; }) || n.selectedIndex !== Array.prototype.findIndex.call(n.options, function(o) { return !o.matches(':disabled'); }))) x.s = Array.prototype.map.call(n.options, function(o) { return o.selected; });
    }
    else if (t === 'checkbox' || t === 'radio') {
      if (n.checked !== n.defaultChecked) x.c = n.checked;
    }
    else if (t !== 'file' && n.value !== n.defaultValue) x.v = n.value;
    if ('v' in x || 'c' in x || x.s) {
      x.p = _mjsWkPath(n, el);
      x.k = _mjsWkSig(n, el);
      out.push(x);
    }
  });
  if (out.length) _mjsTypedAny = 1;
  _mjsTyped.set(el, out);
}

// au premier rendu de `c`, avant la pose de ses liaisons : la saisie relevée dans sa page du serveur, sinon dans celle du composant le plus
// proche qui l'a jetée en bâtissant sa vue (`replace`, `prerender`), passe à chaque champ lié de `c` qui occupe la même place et porte la
// même marque ; la liaison du champ (route marquée 4 par le compilateur) l'écrit dans sa variable, appelée seule, comme le ferait sa
// frappe, sans événement : ni `input` ni `change` ne partent, aucun gestionnaire de l'appli n'est appelé. Un champ d'un autre composant
// attend le premier rendu du sien ; une place où la vue n'a pas le même champ ne reçoit rien
function _mjsTypedPut(c) {
  var o = c, l;
  while (o && !(l = _mjsTyped.get(o))) o = _mjsWkHost(o);
  if (l) l.slice().forEach(function(x) {
    var n = _mjsWkAt(o, x.p), r = n && n._mjs_ev, d = r && r._mjs_reg, m = c._mjs_rt && c._mjs_rt['c' in x ? 'change' : 'input'], fs = [];
    if (!d || d.o !== c || !m || _mjsWkSig(n, o) !== x.k) return;
    d.ids.forEach(function(id) {
      var s = r[id] === n ? m[id] : void 0;
      if (s !== void 0) (typeof s === 'number' || typeof s[0] === 'number' ? [s] : s).forEach(function(y) { if (y[1] & 4) fs.push(y[0]); });
    });
    if (!fs.length) return;
    l.splice(l.indexOf(x), 1);
    if ('v' in x && n.value !== x.v) n.value = x.v;
    if ('c' in x && n.checked !== x.c) n.checked = x.c;
    if (x.s) x.s.forEach(function(v, i) { n.options[i].selected = v; });
    // un bouton radio décoché ne dit rien : celui qu'on a coché le dit
    if (x.c !== false || n.type === 'checkbox') fs.forEach(function(i) { c._mjs_inline[i]({ target: n }, n); });
  });
}
// </server-input>

// <server-resume>
// un composant léger rendu par le serveur jette sa page, au constructeur comme au réveil d'une instance paresseuse (mjs_wake.ts) : en
// `ssr:markers`, le serveur écrit la page du composant, le repère `<!--mjs-l-->`, puis le contenu que la page lui a glissé
// (server/renderToString.ts) ; seuls la page et le repère partent, le contenu glissé garde ses nœuds du serveur, et la vue s'accroche après
// lui (connectedCallback), comme sur un composant léger bâti ici. Sans repère, tout part : false
function _mjsLightDrop(el) {
  while (el.firstChild && !(el.firstChild.nodeType === 8 && el.firstChild.data === 'mjs-l')) el.removeChild(el.firstChild);
  return !!(el.firstChild && el.removeChild(el.firstChild));
}
// <wake-up>
µ._mjs_lightDrop = _mjsLightDrop;
// </wake-up>
// </server-resume>

// valeur d'un attribut relue comme la prop qu'il porte, selon son type déclaré (`static props` du composant)
function _mjsParseProp(schema, key, v) {
  var typeStr, val;
  typeStr = schema[key];
  if (typeStr === Number) {
    val = Number(v);
    if (isNaN(val)) {
      return 0;
    } else {
      return val;
    }
  }
  if (typeStr === Boolean) {
    return v !== 'false' && v !== null;
  }
  if (typeStr === Object || typeStr === Array) {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeStr === String) {
    return String(v);
  }
  if (v === 'true') {
    return true;
  }
  if (v === 'false') {
    return false;
  }
  if (v === 'null') {
    return null;
  }
  if (v === 'undefined') {
    return void 0;
  }
  // Props objet (SSR / passage de données) : une valeur d'attribut qui EST
  // un JSON objet/array est auto-ré-hydratée (ex. <mjs-x item='{"a":1}'>).
  // Fallback string si le JSON est invalide → aucun impact sur les attributs
  // string classiques (qui ne commencent pas par { ou [, ou ne sont pas du
  // JSON valide).
  if (typeof v === 'string' && v.length > 1) {
    const _c0 = v.charCodeAt(0);
    if (_c0 === 123 || _c0 === 91) { // '{' ou '['
      try {
        return JSON.parse(v);
      } catch {
        // garder la valeur brute
      }
    }
  }
  return v;
}

// l'observateur d'attributs de chaque composant appelle cette même fonction (sa propre fermeture retenait tout le contexte
// du montage, une par instance) : il n'observe que les attributs de sa balise, la cible de ses relevés est le composant
function _mjsAttrsMoved(records) {
  records[0].target._mjs_onAttrs(records);
}

// Attributs HTML natifs / d'accessibilité à NE PAS exposer comme props
// réactives du composant — ils restent attachés au custom element pour le
// browser/screen-reader, et ne polluent pas $.X côté script.
MJS_NATIVE_ATTRS = new Set(['class', 'id', 'style', 'src', 'href', 'alt', 'title', 'type', 'value', 'placeholder', 'disabled', 'checked', 'name', 'for', 'tabindex', 'role', 'lang', 'dir', 'hidden', 'draggable', 'contenteditable', 'spellcheck', 'translate', 'inert', 'slot', 'is', 'part', 'exportparts']);

MJS_BOOLEAN_PROPS = new Set(['value', 'checked', 'disabled', 'open', 'readonly', 'required', 'selected', 'hidden', 'multiple', 'autofocus', 'muted', 'autoplay', 'loop', 'controls', 'allowfullscreen', 'async', 'default', 'defer', 'formnovalidate', 'inert', 'ismap', 'itemscope', 'nomodule', 'novalidate', 'playsinline', 'reversed']);

// factorise la logique de `_mjs_updAttr` (props
// booléennes, `null`/`false`/`undefined` → removeAttribute, filtre XSS
// `µ._mjs_safeAttr`) pour un NODE donné directement, sans passer par la lookup
// `this._mjs_nodes[id]`. Avant ce helper, le générateur émettait dans un `{for}`
// un `setAttribute(String(v))` NU (voir attributes/index.ts, chemins
// dynamic/filtered) : `disabled={item.locked}` avec `locked=false` écrivait
// `disabled="false"` (= toujours désactivé, présence d'attribut) au lieu de
// retirer l'attribut ; `null`/`undefined` devenaient les chaînes littérales
// `"null"`/`"undefined"` ; et aucun filtre XSS n'était appliqué (contrairement
// au root, qui passait déjà par `_mjs_updAttr` → `µ._mjs_safeAttr`). `_mjs_updAttr`
// délègue désormais ICI (zéro duplication) : root et `{for}` partagent
// maintenant EXACTEMENT la même sémantique.
// les méthodes de nœud dont le cadre se sert, prises au prototype : une méthode du composant du même
// nom (`@remove = ->`, un nom naturel) masque celle de sa balise — le composant restait alors en
// fantôme dans la page. Un objet qui n'est pas un nœud du DOM (un banc de test) garde sa méthode
// (ce fichier est toujours au cœur : les blocs {for}, {await}… s'en servent sans la reposer ; un
// fichier du runtime qui peut être chargé sans lui pose la sienne)
µ._mjs_rm ||= function(n) {
  if (typeof Node !== 'function' || !(n instanceof Node)) return n.remove();
  var p = n.parentNode;
  if (p) Node.prototype.removeChild.call(p, n);
};
µ._mjs_inside ||= function(a, b) {
  return typeof Node === 'function' && a instanceof Node ? Node.prototype.contains.call(a, b) : a.contains(b);
};
// <copy-listeners>
// la balise `to` route ses événements comme `from`, qu'elle copie (*marquee) ou remplace (`<@element>`, `<@module>`, composant en échec) : une
// table à elle (cf. `_mjs_registerRefs`), même description et même entrée de ligne que celle de `from`, où les identifiants de `from` la
// désignent. Une copie déjà à jour garde la sienne ; un original sans gestionnaire retire celle de sa copie
µ._mjs_evCopy = function(from, to) {
  var r = from._mjs_ev, c = to._mjs_ev, d, tab, i;
  if (r === void 0) {
    if (c !== void 0) to._mjs_ev = void 0;
    return;
  }
  d = r._mjs_reg;
  if (c !== void 0 && c._mjs_reg === d && c._mjs_ent === r._mjs_ent) return;
  tab = { _mjs_reg: d, _mjs_ent: r._mjs_ent };
  for (i = 0; i < d.ids.length; i++) if (r[d.ids[i]] === from) tab[d.ids[i]] = to;
  to._mjs_ev = tab;
};
// </copy-listeners>
// <free-handler-no-signals>
// gestionnaire de `<@window>`, `<@document>`… (transpiler/macros.ts) dans un cœur sans graphe des signaux : aucun calcul en cours à
// quitter, il reste tel quel ; avec le graphe, mjs_signals.ts pose celui qui le tient hors du calcul en cours (bloc retiré, bundler/index.ts)
µ._mjs_sigFree ||= (f) => f;
// </free-handler-no-signals>
// même chose pour `matches`, `closest` et `animate`, que le cadre appelle sur toutes les balises de la
// page : `@matches = ->` (les profils compatibles d'un site de rencontres) envoyait le focus d'après
// navigation sur le composant, `@closest` répondait aux clics à la place de la balise, `@animate`
// remplaçait sa transition. Un objet qui n'est pas un élément (nœud texte, banc de test) garde les siennes
// >>> extrait-test natifs-de-balise
// blocs `<native>` : retirés du cœur par le bundler quand aucune unité du build n'appelle `µ._mjs_matches`/`µ._mjs_animate`
// (<@@field>), hors build de développement complet (l'éclair du panneau) ; les modules du runtime qui s'en servent posent leur
// copie ou viennent avec un fichier qui la pose (mjs_fx.ts)
// <native>
µ._mjs_matches ||= function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.matches.call(n, sel);
  return !!n && typeof n.matches === 'function' && n.matches(sel);
};
// </native>
µ._mjs_closest ||= function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.closest.call(n, sel);
  return n && typeof n.closest === 'function' ? n.closest(sel) : null;
};
// <native>
µ._mjs_animate ||= function(n, frames, opts) {
  if (typeof Element === 'function' && n instanceof Element && typeof Element.prototype.animate === 'function') return Element.prototype.animate.call(n, frames, opts);
  return n.animate(frames, opts);
};
// </native>
// <<< extrait-test natifs-de-balise

// <attr-select>
// valeur liée d'un <select>, en liaison simple ou double sens (code généré par attributes/index.ts) : un tableau
// choisit les options d'un `multiple` (`.value = tableau` ne choisissait rien). Ses <option> peuvent arriver après
// elle (liste chargée ensuite, `{for}`) ou prendre leur valeur après elle (valeur calculée, `<option value={µPas.JOUR}>` :
// au premier rendu, la valeur du <select> s'écrit avant celle de ses options, clonées à `value=''`) : la valeur (`_mjs_sv`,
// jamais undefined ici) est réappliquée quand une option arrive, part ou change de valeur (son attribut `value`, ou son texte
// pour une option sans `value`, `<optgroup>` compris), observé dès la première écriture, sauf si l'utilisateur a choisi depuis la dernière écriture
// de la variable (`null`) — en double sens, son choix écrit la variable, réappliquée ensuite comme avant. Réappliquer n'écrit
// aucun attribut ni aucun texte (`.value`, `.selected` : des propriétés), l'observateur ne se relance donc pas. La valeur se pose
// en texte, comme le navigateur la lit : la page du rendu serveur compare les options sans conversion, un nombre n'y choisissait
// rien. L'observateur rappelle
// µ._mjs_selVal, jamais cette fonction elle-même : mjs_types.ts l'enveloppe (µ._mjs_tsel) pour une liste, simple ou à choix multiples,
// liée à une variable typée, où un nombre sans option de son texte exact choisit celle qui l'écrit autrement (`01` pour 1)
µ._mjs_selVal = (node, val) => {
  if (node._mjs_sv === void 0) {
    new MutationObserver(() => node._mjs_sv !== null && µ._mjs_selVal(node, node._mjs_sv)).observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });
    node.addEventListener('input', () => node._mjs_sv = null);
  }
  node._mjs_sv = val;
  if (node.multiple && Array.isArray(val)) {
    val = val.map(String);
    for (const o of node.options) o.selected = val.includes(o.value);
  }
  else node.value = String(val);
};
// </attr-select>

// la classe écrite (mêlée ou calculée) de chaque balise, celle que son écriture suivante remplace, dans une table du cœur, jamais sur la
// balise : un élément tiers (absent du manifeste) reçoit les clés étalées en propriétés propres, et une clé de la donnée peut porter le nom
// court qu'un nom interne prend en production
var _mjs_clsBases = new WeakMap();

// <attr-upd>
// la mise à jour d'un attribut calculé, et la méthode qui la sert (`_mjs_updAttr`) : hors du cœur de production quand aucune unité ni aucun
// module du cœur ne l'appelle (bundler/index.ts), comme la valeur d'un <select>, la prop en attente et le filtre des attributs
µ._mjs_updAttrNode = function(node, attrName, val, safe) {
  if (!node) return;
  if (MJS_BOOLEAN_PROPS.has(attrName)) {
    if (attrName === 'value') {
      // valeur absente (undefined, null) : champ vide, comme le texte `{$x}` — jamais « undefined »
      if (val == null) val = '';
      // champ de saisie : la valeur liée ne s'écrit que quand ELLE change (`_mjs_vw`, dernière
      // valeur écrite), jamais contre le DOM vivant — un rendu qui repasse (ligne de {for}, branche,
      // navigation) remettait sinon le modèle par-dessus la frappe en cours. Le <select> garde la
      // comparaison au DOM : ses <option> peuvent arriver après sa valeur
      if (node.tagName === 'SELECT') return µ._mjs_selVal(node, val);
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        if (node._mjs_vw === val) return;
        node._mjs_vw = val;
      }
      if (node.value !== val) node.value = val;
      return;
    }
    const boolVal = !!val;
    var first     = false;
    // case cochée, option choisie : même règle que la valeur d'un champ — le clic de
    // l'utilisateur reste tant que la valeur liée ne change pas (`_mjs_bw`, dernière écrite)
    if ((attrName === 'checked' && node.tagName === 'INPUT') || (attrName === 'selected' && node.tagName === 'OPTION')) {
      if (node._mjs_bw === boolVal) return;
      first        = node._mjs_bw === void 0;
      node._mjs_bw = boolVal;
      // premier rendu dans la page : l'attribut dit la valeur de départ, celle où `form.reset()`
      // revient — posé avant la propriété, qui garde le dernier mot ; plus touché ensuite
      if (first && !µ._isServer) {
        if (boolVal) node.setAttribute(attrName, '');
        else         node.removeAttribute(attrName);
      }
    }
    // `hasIdl` capturé AVANT l'assignation qui suit (une propriété expando
    // fausserait le test après coup). Sur une balise SANS IDL native pour cet attribut (ex
    // `<div disabled={…}>`), `node[attrName] = boolVal` ne crée qu'une expando : aucune
    // réflexion DOM vers l'attribut de contenu, qui reste posé pour toujours. On simule
    // alors la réflexion EXPLICITEMENT, mais UNIQUEMENT en l'absence d'IDL — les balises
    // natives (button/input, ou `hidden` porté par HTMLElement) gardent leur réflexion
    // native intacte, y compris le cas FANTOME SSR checked/selected juste en dessous (qui
    // doit rester silencieux côté client, cf. son propre commentaire).
    const hasIdl = attrName in Object.getPrototypeOf(node);
    if (node[attrName] !== boolVal) node[attrName] = boolVal;
    if (!hasIdl) {
      if (boolVal) node.setAttribute(attrName, '');
      else         node.removeAttribute(attrName);
    }
    // FANTOME SSR — `checked`/`selected` sont les deux attributs que
    // la spec DOM soumet au « dirty flag » : ecrire la propriete IDL ne touche PAS
    // l'attribut de contenu. Au rendu serveur, le generateur a pose un temoin
    // `checked=''` dans le HTML statique et personne ne le retire : une case
    // rendue COCHEE alors que l'etat dit decochee. On miroite donc l'attribut,
    // mais UNIQUEMENT au serveur (`µ._isServer`) — cote client, l'attribut de
    // contenu porte la valeur PAR DEFAUT du formulaire (reset) : posée au premier rendu (plus haut),
    // on n'y touche plus
    if (µ._isServer && (attrName === 'checked' || attrName === 'selected')) {
      if (boolVal) node.setAttribute(attrName, '');
      else         node.removeAttribute(attrName);
    }
    return;
  }
  // la classe calculée ne remplace que ce qu'elle avait posé : une classe basculée par `@class{…}` sur
  // la même balise (le choix courant d'une liste, après un tri) reste ; sans autre classe que la
  // sienne, l'écriture reste directe
  if (attrName === 'class') {
    var own   = val === false || val == null ? '' : String(val);
    var written = own;
    var base  = _mjs_clsBases.get(node);
    var cur   = node.getAttribute('class') || '';
    if (base !== void 0 && cur !== base) {
      var before = base.split(/\s+/);
      var after = own.split(/\s+/);
      cur.split(/\s+/).forEach(function(c) {
        if (c && before.indexOf(c) < 0 && after.indexOf(c) < 0) written += (written ? ' ' : '') + c;
      });
    }
    // première écriture sur une balise déjà classée : ses bascules `@class{…}` (leurs jetons, que le compilateur passe en `sur`) ont pu
    // passer avant elle — l'ordre des mises à jour suit les variables, pas l'ordre d'écriture — et ne rejoueront pas : leurs jetons déjà
    // posés restent. Tout autre jeton déjà là (la classe d'un rendu serveur que l'état d'ici ne redit pas) tombe, comme avant
    else if (base === void 0 && cur && safe) {
      var wanted  = own.split(/\s+/);
      var toggled = ' ' + safe + ' ';
      cur.split(/\s+/).forEach(function(c) {
        if (c && wanted.indexOf(c) < 0 && toggled.indexOf(' ' + c + ' ') >= 0) written += (written ? ' ' : '') + c;
      });
    }
    // <spread-class>
    // la part qu'un étalement pose sur la balise (`_mjs_spCk`, µ._mjs_spCls, µ._mjs_spWc) reste : la classe écrite ne la connaît pas
    var part = _mjs_spCk.get(node);
    if (part) part.split(' ').forEach(function(c) { if (written.split(/\s+/).indexOf(c) < 0) written += (written ? ' ' : '') + c; });
    // </spread-class>
    _mjs_clsBases.set(node, own);
    // `class` n'a rien à faire refuser au filtre des attributs (µ._mjs_safeAttr) : écrite directement
    if (written) { if (cur !== written) node.setAttribute('class', written); }
    else node.removeAttribute('class');
    return;
  }
  if (val === false && /^(?:aria-|(?:draggable|spellcheck|contenteditable|writingsuggestions)$)/i.test(attrName)) {
    // aria-* à false = chaîne 'false' (existe pour le lecteur d'écran), pas un retrait ; de même pour draggable, spellcheck, contenteditable et
    // writingsuggestions, dont l'absence rend la valeur par défaut du navigateur (une image glissable, l'orthographe vérifiée) ; noms comparés
    // sans la casse, comme en HTML (`contentEditable`), sans risque, écrits sans le filtre
    if (node.getAttribute(attrName) !== 'false') node.setAttribute(attrName, 'false');
  } else if (val === false || val === null || val === void 0) {
    node.removeAttribute(attrName);
  } else {
    const strVal = typeof val === 'string' ? val : String(val);
    // `sur` : nom écrit dans le gabarit, que le compilateur sait sans risque (ni `on…`, ni `srcdoc`, ni adresse, cf.
    // safeAttrFlag, generator/utils.ts) — écrit sans le filtre ; un nom à risque ou calculé (étalement, balise dynamique) y passe
    if (safe) { if (node.getAttribute(attrName) !== strVal) node.setAttribute(attrName, strVal); }
    else µ._mjs_safeAttr(node, attrName, strVal);
  }
};
// </attr-upd>

// <spread-class>
// la classe étalée : un étalement `{...o}` qui porte `class` en fait une part de la classe de la balise (ses jetons, `_mjs_spCk`), comme la même
// valeur écrite en clair (code généré par attributes/index.ts, un appel par étalement). Elle s'ajoute à la classe écrite (en dur, `f`, que le
// compilateur passe ; mêlée ou calculée, `_mjs_clsBases`) et aux bascules `@class{…}`, et n'en retire que ce qu'elle seule apportait ;
// l'écriture de la classe écrite la garde (µ._mjs_updAttrNode). Chaque étalement de la balise garde ce qu'il pose, par son rang `r` : le
// dernier qui pose la classe l'emporte, même quand un étalement plus haut change, et une classe qu'aucun étalement ne pose plus quitte la
// balise. µ._mjs_spCls : la classe seule, posée tout de suite, sur une balise ordinaire qui a une classe écrite ou sur le composant d'un
// `<@module>`, où la classe est un attribut de la balise même quand le composant déclare `$class` ; ses relevés vont à part (`_mjs_spm`, les
// autres clés de l'étalement y sont des attributs rangés dans `_mjs_spk`) et suivent le composant quand il change (µ._updModule), comme la
// balise d'un `<@element>` (µ._updDynEl), dans `<spread-class-only>`. La balise d'un composant passe par µ._mjs_spWc (`<spread-component>`),
// qui pose aussi ses attributs ; les deux se servent de la pose commune qui suit, seule dans ce bloc
var _mjs_spJet = function(v) { return v === false || v == null ? [] : String(v).split(/\s+/).filter(Boolean); };
// la part étalée de la classe de chaque balise, dans une table du cœur, jamais sur la balise : un élément tiers (absent du manifeste) reçoit
// les clés étalées en propriétés propres, et une clé de la donnée peut porter le nom court qu'un nom interne prend en production
var _mjs_spCk = new WeakMap();
// pose `c`, la classe étalée de la balise `n`, à la place de sa part d'avant
var _mjs_spUn = function(n, c, f) {
  var neu = _mjs_spJet(c), guard = _mjs_spJet([_mjs_clsBases.get(n), f].join(' ')).concat(neu);
  _mjs_spJet(_mjs_spCk.get(n)).forEach(function(x) { if (guard.indexOf(x) < 0) n.classList.remove(x); });
  if (neu.length) n.classList.add.apply(n.classList, neu);
  _mjs_spCk.set(n, neu.join(' '));
};
// </spread-class>
// <spread-class-only>
µ._mjs_spCls = function(n, r, o, f) {
  var pk = n._mjs_spm || (n._mjs_spm = {}), av = pk[r], seen = {}, a, k, c;
  for (k in o) if (k === 'class') { seen[k] = o[k]; a = 1; }
  if (!(av || a)) return;
  pk[r] = seen;
  for (k in pk) if ('class' in pk[k]) c = pk[k].class;
  _mjs_spUn(n, c, f);
};
// </spread-class-only>
// <spread-component>
// µ._mjs_spWc — un étalement `{...o}` sur la balise d'un composant (balise à tiret ; code généré par attributes/index.ts, un appel par
// étalement, après la livraison des props) y pose ce qu'y poserait la même valeur écrite en clair : la classe, comme `class={…}` (part de la
// classe de la balise, cf. `<spread-class>`), sauf quand le composant déclare lui-même une prop `class` (`_mjs_var_bits`, sans la casse), qui
// la garde pour lui ; `data-*` et `aria-*`, toujours et tout de suite ; les attributs globaux que le navigateur lit sur la balise (`id`,
// `title`, `role`, `hidden`, `tabindex`, `lang`, `dir`, `slot`, la liste de COMPONENT_GLOBAL_ATTR), sauf quand le composant déclare une prop
// de ce nom, qui les garde pour elle (déclarée sous une autre casse, elle reçoit la valeur sous son nom). Avant la définition du composant
// (module chargé plus tard), la classe et les attributs globaux attendent qu'il le soit, une seule attente par balise (`_mjs_spWw`), qui pose
// l'état du moment. `e` : les noms écrits sur la balise, que l'étalement ne touche jamais. Chaque étalement de la balise garde ce qu'il pose
// (par son rang `r`) : le dernier qui pose un nom l'emporte, même quand un étalement plus haut change, et un nom qu'aucun
// étalement ne pose plus quitte la balise. Ces relevés et l'attente vivent dans des tables du cœur, jamais sur la balise, et les props
// déclarées ne se lisent que sur un composant du projet (`µ.Element`) : un élément tiers (absent du manifeste) reçoit les clés étalées en
// propriétés propres, et une clé de la donnée peut porter le nom court qu'un nom interne prend en production
var _mjs_spWk = new WeakMap(), _mjs_spWw = new WeakSet();
µ._mjs_spWc = function(n, r, o, f, e) {
  var pk = _mjs_spWk.get(n), av, seen = {}, a, k;
  if (!pk) _mjs_spWk.set(n, pk = {});
  av = pk[r];
  for (k in o) if (!(e && e.test(k)) && /^(data-|aria-|(class|id|title|role|hidden|tabindex|lang|dir|slot)$)/i.test(k)) { seen[k.toLowerCase()] = o[k]; a = 1; }
  if (!(av || a)) return;
  pk[r] = seen;
  // les props que déclare le composant, sur une instance du projet seulement
  var bits = function() { return n instanceof µ.Element ? n._mjs_var_bits : void 0; };
  // la prop du même nom que déclare le composant, sans la casse
  var decl = function(x) { var b = bits(); for (var d in b) if (d.toLowerCase() === x) return d; };
  // `s` : composant pas encore défini, `data-*` et `aria-*` seuls ; `t` : chaque nom posé par un étalement de la balise, avec la valeur du
  // dernier qui le pose, et ceux que cet étalement posait (sans valeur s'il n'est plus posé)
  var set = function(s) {
    var d, x, t = {};
    for (k in av) t[k] = void 0;
    for (x in pk) for (k in pk[x]) t[k] = pk[x][k];
    if (!s && !decl('class')) _mjs_spUn(n, t.class, f);
    for (k in t) if (k !== 'class') {
      d = /^(data|aria)-/.test(k);
      if (d || !s && !(x = decl(k))) µ._mjs_updAttrNode(n, k, t[k]);
      else if (!s && x !== k && t[k] !== void 0) n._set(x, t[k]);
    }
  };
  if (bits()) set();
  else {
    set(1);
    if (!_mjs_spWw.has(n)) {
      _mjs_spWw.add(n);
      customElements.whenDefined(n.localName).then(function() { _mjs_spWw.delete(n); set(); });
    }
  }
};
// </spread-component>
// <attr-global>
// µ._mjs_attrGlob — un attribut global calculé (`class`, `title`… : la liste de COMPONENT_GLOBAL_ATTR) écrit sur la balise d'un composant
// (balise à tiret ; code généré par attributes/index.ts, componentLogic, après la livraison de sa prop `p`) s'y pose comme sa forme fixe
// (`s` : la fin de son écriture, cf. writeEnd), sauf quand le composant déclare lui-même une prop de ce nom (`_mjs_var_bits`, sans la
// casse) : il la garde pour lui, sans attribut, et la reçoit sous son nom quand il la déclare sous une autre casse. Une balise pas encore
// définie (ligne de {for}, branche, module chargé plus tard) ne dit pas ses props : l'attribut attend sa définition, une attente par balise,
// et c'est la dernière valeur écrite de chaque attribut qui se pose. Ces valeurs vivent dans une table du cœur, jamais sur la balise, et les props déclarées ne se lisent que sur
// un composant du projet (`µ.Element`) : un élément tiers (absent du manifeste) reçoit les clés étalées en propriétés propres, et une clé
// de la donnée peut porter le nom court qu'un nom interne prend en production
var _mjs_agK = new WeakMap(), _mjs_agW = new WeakSet();
µ._mjs_attrGlob = function(n, a, v, p, s) {
  var t     = _mjs_agK.get(n);
  // les props que déclare le composant, sur une instance du projet seulement
  var bits  = () => n instanceof µ.Element && n._mjs_var_bits;
  // la prop du même nom (sans la casse) que l'attribut `x` la garde, ou la reçoit sous son nom ; sinon l'attribut se pose
  var set = (x) => {
    var b = bits(), d = b && Object.keys(b).find((k) => k.toLowerCase() === x);
    if (!d) µ._mjs_updAttrNode(n, x, t[x][0], t[x][2]);
    else if (d !== t[x][1]) n._set(d, t[x][0]);
  };
  if (!t) _mjs_agK.set(n, t = {});
  t[a] = [v, p, s];
  if (bits()) set(a);
  // une attente par balise : sa définition pose la dernière valeur de chaque attribut écrit d'ici là
  else if (!_mjs_agW.has(n)) {
    _mjs_agW.add(n);
    customElements.whenDefined(n.localName).then(() => { _mjs_agW.delete(n); for (var x in t) set(x); });
  }
};
// </attr-global>

// compteur global de topologie pour le cache de résolution §§ (_mjs_getRCtx) —
// toute connexion/déconnexion/écriture de contexte invalide les caches d'ancêtre
µ._mjs_rctxEpoch = 0;

// MODE LÉGER — `:host` réécrit en nom de balise. Un composant
// `mjs-light` n'a pas de vrai host (HTMLElement, pas de Shadow DOM) : sa feuille est adoptée par
// le DOCUMENT ou par le shadow réel de l'ancêtre le plus proche — dans les deux cas `:host` n'y
// désigne RIEN (matche tout au niveau document, rien au niveau d'un shadow qui n'est pas le sien),
// et `:host-context()` n'a jamais de sens hors shadow. D'où le composant resté `display: inline`
// malgré le préfixe `:host{display:X}` que le compilateur pose devant CHAQUE baseCss (V1,
// transpiler/index.ts § injectTemplate) : la règle ne matchait jamais rien. Passe caractère par
// caractère (jamais de regex globale : parenthèses potentiellement imbriquées, `:host(:not(.a))`)
// — `::slotted(...)` ne commence jamais par `:host`, jamais touché (aucun sens en mode léger,
// pas de shadow où slotter) ; une custom property `--host-x` n'a pas de `:` devant, jamais
// confondue. Cache par BALISE + texte : une réécriture par composant, jamais par instance.
µ._lightHostCss = function(css, tag) {
  var cacheKey, ch, close, consumedAny, contexts, ctxAncestor, ctxOnHost, findParenEnd, i, j, len, open, out, skipQuoted, suffix;
  if (!css) return css;
  µ._mjs_lightHostCssCache ??= new Map();
  cacheKey = tag+String.fromCharCode(1)+css; // séparateur jamais présent dans du CSS
  if (µ._mjs_lightHostCssCache.has(cacheKey)) {
    return µ._mjs_lightHostCssCache.get(cacheKey);
  }
  // fin d'une chaîne entre guillemets ouverte à l'indice `k` (échappements sautés) : indice qui suit
  // le guillemet fermant
  skipQuoted = function(k) {
    var q = css[k];
    while (++k < css.length) {
      if (css[k] === '\\') k++;
      else if (css[k] === q) return k + 1;
    }
    return k;
  };
  // parenthèse FERMANTE appariée à celle d'indice `open` (`:host(:not(.a))` → la bonne, pas la 1re) ;
  // une parenthèse dans une chaîne ne compte pas (`:host([title=")"])`)
  findParenEnd = function(start) {
    var depth, j;
    depth = 0;
    for (j = start; j < css.length; j++) {
      if (css[j] === '"' || css[j] === '\'') j = skipQuoted(j) - 1;
      else if (css[j] === '(') depth++;
      else if (css[j] === ')') {
        depth--;
        if (depth === 0) return j;
      }
    }
    return -1;
  };
  out = '';
  i = 0;
  len = css.length;
  while (i < len) {
    // guillemets : contenu recopié tel quel, jamais de :host à réécrire dedans (`content: ":host"`)
    if (css[i] === '"' || css[i] === '\'') {
      j = skipQuoted(i);
      out += css.slice(i, j);
      i = j;
      continue;
    }
    // suite de pseudo-classes hôte CONSÉCUTIVES (`:host-context(.a):host(.b)`, sans espace ni
    // combinateur entre elles) : UN seul composé — contextes en préfixes ancêtres (dans l'ordre),
    // UN nom de balise, suffixes accolés (dans l'ordre) — jamais un tag par token de la suite
    contexts = [];
    suffix = '';
    consumedAny = false;
    j = i;
    while (true) {
      if (css.startsWith(':host-context(', j)) {
        open = j + 13; // indice du '('
        close = findParenEnd(open);
        if (close === -1) break;
        contexts.push(css.slice(open + 1, close));
        j = close + 1;
        consumedAny = true;
        continue;
      }
      if (css.startsWith(':host(', j)) {
        open = j + 5; // indice du '('
        close = findParenEnd(open);
        if (close === -1) break;
        suffix += css.slice(open + 1, close);
        j = close + 1;
        consumedAny = true;
        continue;
      }
      if (css.startsWith(':host', j)) {
        ch = css[j + 5];
        if (ch == null || !/[\w-]/.test(ch)) {
          j += 5;
          consumedAny = true;
          continue;
        }
      }
      break;
    }
    if (consumedAny) {
      if (contexts.length) {
        // sémantique CSS réelle de :host-context() : matche l'hôte si l'hôte LUI-MÊME
        // porte le sélecteur donné, OU si un de ses ANCÊTRES le porte — pas l'ancêtre
        // seul. `:where(...)` groupe les deux formes avec la MÊME spécificité (pas de
        // priorité artificielle entre elles). Plusieurs :host-context chaînés (rare) :
        // seuls les deux cas extrêmes sont couverts (tout ancêtre / tout sur l'hôte),
        // pas les combinaisons mixtes (limite documentée, cf. docs/09-directives-dom.md).
        // Le cas « tout ancêtre » suppose en plus des ancêtres DISTINCTS, un par
        // contexte (`contexts.join(' ')` = chaîne de descendance stricte, ex.
        // « .a .c tag ») : un SEUL ancêtre qui porte les deux classes à la fois
        // (`<div class="a c">`) ne correspond PAS à ce sélecteur.
        ctxAncestor = contexts.join(' ');
        ctxOnHost = contexts.join('');
        out += ':where('+ctxAncestor+' '+tag+suffix+','+tag+suffix+ctxOnHost+')';
      } else {
        out += tag+suffix;
      }
      i = j;
    } else {
      out += css[i];
      i++;
    }
  }
  µ._mjs_lightHostCssCache.set(cacheKey, out);
  return out;
};

// RENDU SERVEUR — ce qu'un lecteur EXTÉRIEUR au bundle doit savoir d'un composant monté : sa
// feuille scopée (à inliner dans le `<template shadowrootmode>`), son mode light, ses nœuds de
// binding, l'état de ses `{await}` et son rendu en attente. Les propriétés `_mjs_*` portent un nom
// RACCOURCI en production (mangleProps) : seul du code compilé AVEC le bundle peut les nommer. Ce
// nom-ci n'est jamais raccourci — c'est par lui que le rendu serveur (server/renderToString.ts,
// server/render-browser.ts) lit ces valeurs.
// un défilement dans un composant ne sort pas de son shadow root (`scroll` ne traverse pas) : chaque
// shadow root le relaie à qui s'y abonne — les effets qui dessinent sur la page (*cursors, *follow,
// *heatmap), dont les marques suivent le contenu
µ._mjs_scrollSubs ||= new Set();
µ._mjs_innerScroll = function(e) {
  if (µ._mjs_scrollSubs.size) µ._mjs_scrollSubs.forEach(function(f) { f(e); });
};

// Héritage CSS depuis <@view css="..."> : on remonte l'arbre en franchissant
// les frontières Shadow DOM (via root.host), et on accumule toutes les feuilles
// de chaque <metamjs-view css="..."> ancêtre. Ça permet qu'un composant imbriqué
// (enfant d'un composant injecté dans la view) hérite aussi du thème de la view.
// Partagé par `_mjs_applyLayout` et par `µ._ssrInfo` (le rendu serveur écrit les mêmes feuilles).
µ._mjs_inheritedCss = function(el) {
  var cssAttr, j, len, node, ref, root, scope, sheetName;
  var names = [];
  // rien n'est lu sur les ancêtres eux-mêmes : `closest` pris au prototype (µ._mjs_closest) y trouve les vues, `getRootNode` (du
  // composant, puis de chaque hôte franchi) l'ombre à quitter — lue sur un <form>, une propriété est d'abord cherchée parmi ses champs,
  // liste que le navigateur refait après la mise à niveau de chaque champ associé : mille cases d'un formulaire la faisaient refaire mille fois
  scope = el;
  node = el.parentElement;
  for (;;) {
    node = µ._mjs_closest(node, 'metamjs-view');
    if (node) {
      cssAttr = node.getAttribute('css');
      if (cssAttr) {
        ref = cssAttr.split(/\s+/);
        for (j = 0, len = ref.length; j < len; j++) {
          sheetName = ref[j];
          if (sheetName) {
            names.push(sheetName);
          }
        }
      }
      node = node.parentElement;
      continue;
    }
    root = scope.getRootNode();
    if (root.nodeType !== 11 || !root.host) return names; // ShadowRoot → on saute à l'hôte, qui peut être lui-même une vue
    node = scope = root.host;
  }
};

// <server-info>
// ce que le rendu serveur relit d'un composant : en production, seulement dans une construction qui peut rendre côté serveur (bundler/index.ts)
µ._ssrInfo = function(el) {
  return {
    baseCss: el._mjs_baseCss,
    // feuilles partagées que le montage adopte AVANT la feuille propre, dans l'ordre de
    // `_mjs_applyLayout` : remise à zéro, héritées d'une vue, déclarées par `@css`
    sheets: (µ.CSS && µ.CSS['mjs_reset'] ? ['mjs_reset'] : []).concat(µ._mjs_inheritedCss(el), el._mjs_sharedCss || []),
    isLight: el._mjs_isLight === true,
    nodes: el._mjs_nodes,
    awaitStates: el._mjs_awaitStates,
    renderScheduled: el._mjs_render_scheduled === true
  };
};
// </server-info>

// ============================================================================
// Convention Shadow DOM & GC
// ============================================================================
// Chaque composant MJS attache un Shadow DOM en mode `closed` :
//   - **Pourquoi closed** : empêche l'accès externe via `el.shadowRoot` (qui
//     retourne `null` sur closed). Force l'API publique du composant (props,
//     events) au lieu de scraping DOM-interne fragile. C'est le contrat MJS :
//     l'extérieur ne voit QUE l'API exposée, jamais le DOM interne.
//   - **Référence cachée** dans `this._shadow` : le composant lui-même garde
//     une référence privée pour pouvoir muter son arbre. Pas exposé.
//
// **GC (garbage collection)** :
//   - Quand un composant est retiré du DOM (`remove()`, `innerHTML = ""`,
//     etc.), `disconnectedCallback()` est appelé. Le composant y :
//     1. quitte le magasin (`_mjs_store_unsubs`, µ._mjs_storeUnsubscribe), les traductions et le carnet ;
//     2. joue sa file `µsleep` ;
//     3. remet sa destruction (`@destroy`, `_mjs_destroy_cbs`) au microtask suivant : un composant seulement déplacé, reconnecté
//        dans le même tour, n'est pas détruit. Ses tables internes (`_mjs_effects`, `_mjs_inline`, `_mjs_binds`…) ne sont pas
//        vidées : elles partent avec lui.
//   - Une fois ces désincriptions faites, plus aucune référence externe
//     ne pointe vers le composant → le browser le GC, et avec lui :
//       a. son Shadow DOM (children, listeners internes, adoptedStyleSheets
//          locales restent rattachées à la sheet partagée mais sans ref).
//       b. son `_state`, `_mjs_nodes`, etc.
//   - **Important** : ne PAS faire de référence circulaire externe (ex.
//     stocker `el` dans un global sans WeakRef) sinon fuite mémoire. Les
//     subscriptions du Store passent par `_mjs_store_unsubs` (cf. mjs_store.ts)
//     qui sont vidées dans disconnectedCallback.
// ============================================================================
µ.Element = class Element extends HTMLElement {
  constructor() {
    super();
    // déjà dans la page quand sa définition arrive (mise à niveau pendant son enregistrement, `µ._mjs_defining` : µ._def, mjs_dom.ts) :
    // la balise a pu y être stylée, cachée par le bouclier ; `mjs-appearing` (la balise seule, sans transition) ne part qu'après le
    // premier calcul de style qui suit son premier rendu, jamais posé au serveur, d'où partirait la page. Le composant cloné d'un
    // gabarit (une ligne de liste, une branche) est mis à niveau à son insertion, connecté lui aussi, mais avant tout calcul de style :
    // rien n'a pu le styler, il n'a rien à couper
    if (µ._mjs_defining) µ._mjs_appearing(this);
    // crochet de construction, posé le temps d'un `cloneNode` : le miroir vivant de `µclone el, mirror: true` (mjs_clone.ts), dont l'état est celui de
    // l'original avant que son script ne le lise — celui aussi de la copie d'un composant que pose *marquee (mjs_fx_marquee.ts)
    µ._mjs_mirror?.(this);
    // <wake-up>
    // (gardes `?.` : un harnais qui évalue ce fichier sans mjs_wake.ts) une balise que la vue d'un composant recrée à la place d'une instance qui attendait son réveil reprend
    // sa page ; pendant un réveil, une balise bâtie par la construction d'une autre attend son tour (`@wake`, mjs_wake.ts)
    µ._mjs_wakeNew?.(this);
    // </wake-up>
    // Mode `mjs-light` (opt-in instance) : si l'élément porte l'attribut
    // `mjs-light`, le composant n'utilise PAS de Shadow DOM. À la place,
    // `this._shadow` pointe sur le composant lui-même (light DOM).
    // Trade-offs :
    //   + héritage CSS global (Bootstrap, Tailwind, etc. marchent direct)
    //   + querySelector externe trouve les enfants (DevTools, tests E2E)
    //   + délégation événementielle fonctionne pareil (events bubble)
    //   − pas d'isolation : risques de collisions de styles/sélecteurs
    //   − pas de <slot> ni shadow-only API
    //   − adoptedStyleSheets indisponible → fallback <style> inline
    //
    // Détection robuste : on accepte l'attribut `mjs-light` OU une propriété
    // statique `mjsLight = true` sur la classe (fallback pour environnements
    // où l'attribut n'est pas posé avant constructor — happy-dom, etc.) OU un
    // drapeau transitoire PAR INSTANCE (`document.createElement(tag)`
    // sur un tag déjà défini — branches `{success}`/`{error}` d'un `{await}`,
    // seul chemin qui pose encore `mjs-light` en deux temps, createElement
    // PUIS setAttribute — construit l'instance SYNCHRONE, avant ce
    // `setAttribute` : `hasAttribute` échoue ici. `µ._mjs_lightNext` est posé par
    // le code généré JUSTE avant CET appel précis et effacé juste après (cf.
    // src/generator/paths.ts) : jamais un Set par tag (essayé puis RETIRÉ —
    // régression prouvée : `@lightDom` est une directive d'USAGE, pas de
    // définition du composant, deux instances du même tag peuvent différer,
    // un Set partagé par tag aurait contaminé l'une par l'autre). Pour un tag
    // pas encore défini, `createElement` ne construit rien tout de suite —
    // l'upgrade réel n'a lieu qu'à la connexion, `hasAttribute` y suffit déjà,
    // ce drapeau n'y intervient jamais (jamais posé assez tôt pour ce cas).
    var _isLight = false;
    try {
      if (this.hasAttribute && this.hasAttribute('mjs-light')) _isLight = true;
      else if (this.getAttributeNames && this.getAttributeNames().indexOf('mjs-light') >= 0) _isLight = true;
      else if (this.constructor && this.constructor.mjsLight === true) _isLight = true;
      else if (µ._mjs_lightNext && this.tagName && µ._mjs_lightNext === this.tagName.toLowerCase()) {
        _isLight = true;
        µ._mjs_lightNext = null;
      }
    } catch { /* ignore */ }
    if (_isLight) {
      this._shadow = this;
      this._mjs_isLight = true;
      // SSR (render-then-replace) en mode light : le serveur a peint le contenu EN ENFANTS DIRECTS
      // (pas de <template shadowrootmode> ici — un léger n'a pas de shadow), et l'attribut `mjs-ssr`
      // de la balise le dit. Cette « photo » se remplace comme celle d'un shadow déclaratif : la vue
      // interactive appendue juste après, dans le constructor généré, prend sa place. Sans ce
      // retrait, les deux coexisteraient — page en double, la photo INERTE devant. La balise n'a
      // d'enfants à ce stade que si le PARSEUR les a posés (upgrade différé par le module du
      // bundle) : une instance créée au client, elle, arrive vide et sans cet attribut.
      // <server-input>
      if (this.hasAttribute && this.hasAttribute('mjs-ssr')) _mjsTypedTake(this);
      // </server-input>
      // <wake-up>
      // en attente de son réveil (`@wake`, mjs_wake.ts) : la page du serveur reste affichée, rien n'est construit avant le réveil
      if (!µ._mjs_wakeHold?.(this))
      // </wake-up>
      if (this.hasAttribute && this.hasAttribute('mjs-ssr')) {
        // <server-resume>
        // en `ssr:markers`, le contenu que la page a glissé reste (cf. _mjsLightDrop)
        if (!_mjsLightDrop(this))
        // </server-resume>
        this.replaceChildren();
      }
    } else if (this.shadowRoot) {
      // SSR (render-then-replace) : le serveur a envoyé un Shadow DOM
      // déclaratif (`<template shadowrootmode="open">`), déjà attaché AVANT
      // l'upgrade du custom element. On le RÉUTILISE au lieu d'appeler
      // attachShadow (qui lèverait "already hosts a shadow tree"), et on vide
      // son contenu (la « photo » serveur). La vraie vue interactive du client,
      // appendue juste après dans le constructor généré, prend sa place : c'est
      // le swap. `_mjs_ssrAdopt` sert d'amorce à la future config `ssrMode`.
      this._shadow = this.shadowRoot;
      this._mjs_ssrAdopt = true;
      // pont UJS, @title, défilement interne : posés dès que `this._shadow` est un VRAI shadow root
      _mjsShadowReady(this);
      // <server-input>
      _mjsTypedTake(this);
      // </server-input>
      // En mode hydratation, on GARDE le DOM serveur (il sera adopté par
      // _mjs_mount → _mjs_hydrate). En render-then-replace (défaut), on vide la
      // « photo » serveur ici pour laisser place à la vue reconstruite.
      // <wake-up>
      // en attente de son réveil (`@wake`, mjs_wake.ts) : la page du serveur reste affichée, rien n'est construit avant le réveil
      if (!µ._mjs_wakeHold?.(this))
      // </wake-up>
      if (!µ._mjs_ssrHydrate) {
        this._shadow.replaceChildren();
      }
    } else {
      try {
        this._shadow = this.attachShadow({
          mode: 'closed'
        });
      } catch {
        // si on arrive ICI et que
        // `attachShadow` échoue avec "already hosts a shadow tree", c'est
        // qu'un Shadow DOM a déjà été attaché EN AMONT — nécessairement par
        // le PARSEUR HTML via Declarative Shadow DOM (`<template
        // shadowrootmode="closed">`, ex. SSR avec `shadowMode:'closed'` dans
        // les options de rendu). La branche `this.shadowRoot` ci-dessus n'a
        // rien vu : `.shadowRoot` renvoie TOUJOURS `null` pour un shadow
        // `closed`, PAR SPEC, même celui posé par le parseur lui-même — rien
        // n'expose ce shadow existant à personne d'autre que le code qui l'a
        // créé. Impossible de l'adopter ni de le vider pour y monter la vraie
        // vue interactive. AVANT ce fix, la DOMException NATIVE ("Failed to
        // execute 'attachShadow'...") remontait TELLE QUELLE hors du
        // constructor : par la spec Custom Elements, un constructor qui jette
        // une erreur non rattrapée marque l'élément "failed to upgrade" À
        // VIE — composant mort, sans AUCUN indice reliant le crash à sa
        // cause réelle (l'option `shadowMode:'closed'` côté SSR, à plusieurs
        // fichiers de distance). Fix : convertir en erreur EXPLICITE,
        // actionnable — la seule vraie solution reste `shadowMode:'open'`
        // (défaut), seul mode que ce moteur d'hydratation sait adopter (cf.
        // avertissement jumeau côté serveur, renderToString.ts).
        throw new Error(
          '[mjs] ' + µ._mjs_txt('elementClosedShadow', { tag: this.tagName.toLowerCase() }, '<{tag}> : un Shadow DOM \'closed\' préexiste (SSR avec shadowMode:\'closed\' ?) — MJS ne peut pas l\'adopter ni le reconstruire (contenu inaccessible en mode closed). Utilisez shadowMode:\'open\' (défaut) dans les options de rendu SSR.')
        );
      }
      // même appel que la branche SSR reuse ci-dessus : ici pour le cas nominal (attachShadow neuf)
      _mjsShadowReady(this);
    }
    this._mjs_nodes = {};
    // routage des événements : chaque balise mène à la table de son bloc par une PROP (`_mjs_ev`, cf. _mjs_registerRefs / _mjs_bindEvents),
    // au lieu d'une WeakMap par instance. Plus rien à initialiser ici.
    this._state = {};
    // <signals>
    // boîtes du graphe des signaux (mjs_signals.ts), nées à la première lecture notée, et nœuds de ses valeurs précises : déclarés
    // ici pour garder la forme
    this._mjs_sigBoxes = null;
    this._mjs_sigNodes = null;
    // </signals>
    // Lazy-init des structures rarement utilisées.
    // Économise N × (alloc Set + alloc array) par composant (avant : 4 allocs).
    // Sur 1000 rows = 4000 allocs économisées. Les lecteurs utilisent `?.size`
    // ou check `if (this._mjs_inspections)` → safe.
    // _mjs_binds : utilisé dans _mjs_notifyMutation pour `mjs-bind:X` events
    // _mjs_inspections : utilisé pour µ.inspect (rare en prod)
    // _mjs_effects : utilisé par µ.effect() (peut être vide pour beaucoup de comp)
    // _mjs_inline : populé par init via template (jamais vide en pratique)
    this._mjs_render_scheduled = false;
    this._mjs_inline = [];
    this._mjs_refuses = null;
    this._mjs_is_mounted = false;
    this._mjs_mjsInitialized = false;
    // la prop liée remonte vers le parent (cf. _mjs_notifyMutation) : fermé jusqu'à ce que la connexion ait reçu les valeurs du parent
    this._mjs_bindOpen = false;
    // Bug-fix : flag indépendant de `_mjs_lastMutedVars` pour signaler au
    // microtask consumer qu'au moins une var muée pilote `_mjs_renderStruct`.
    // Mis à `true` dans `_mjs_invalidate` si `_mjs_renderStructVars[k] === 1`,
    // remis à `false` dans le microtask. Garantit que `_mjs_renderStruct` est
    // appelé même quand l'optim a sauté l'alloc de `_mjs_lastMutedVars`
    // (i.e. composant sans `µ.effect()` user, mutation externe via
    // `µ._set` d'une var pilotant un `{for}` / `{if}` / etc.).
    this._mjs_pending_struct_dirty = false;
    // Optim #3 — Guard de dedup pour _mjs_renderStruct dans le fast-path sync.
    // Évite que N mutations consécutives sur des vars structurelles re-rendent
    // N fois la struct dans le même tick. Reset par un microtask scheduling
    // au 1er fire dans un tick donné.
    this._mjs_struct_dispatched_in_tick = false;
  }

  // ==========================================
  // CŒUR RÉACTIF V2 (sans Proxy)
  // ==========================================
  // Rewrite V2 : `$.x = y` est transformé en compile-time en
  // `µ._set(this, 'x', y)`. Les lectures `$.x` sont directes sur `_state`, sans Proxy pour une variable ; un objet ou une liste de
  // l'état se lit par son enveloppe (`_mjs_wrapDeep`, un Proxy par objet, cf. le registre des détenteurs), qui suit les écritures
  // faites hors du code compilé

  // Pour les valeurs calculées (computed), `_mjs_setComputed` installe un getter
  // sur _state qui déballe la fonction à la lecture.

    // _set : assignation primitive depuis le code utilisateur transformé
  // <precision>
  // `code` : 1 quand l'écriture vient du code du composant (`µ._set`, mjs_init.ts)
  _set(k, v, code) {
  // </precision>
  // <clock>
  // _set(k, v) {
  // </clock>
    // clé qui n'est ni un texte ni un symbole (`$[$k] = v`, `$k` un nombre, un booléen, null, undefined, un objet) : la
    // clé de propriété qu'elle désigne, un texte — celui que lisent les reffets et les liaisons. Convertie AVANT la garde :
    // une liste `['__proto__']` désigne `__proto__`
    if (typeof k !== 'string' && typeof k !== 'symbol') k = String(k);
    // SÉCURITÉ — proto-pollution : un `{...$data}`
    // (spread) où `$data` vient d'un JSON réseau peut porter une clé PROPRE
    // `__proto__`/`constructor`/`prototype` (JSON.parse crée une own-prop
    // énumérable). Le codegen spread appelle `node._set(k, v)` par entrée →
    // sans garde, le setter natif `__proto__` de `_state` change son
    // [[Prototype]] et un `{$role}` lu via proto pollué renvoie la valeur
    // injectée. Ces trois clés sont refusées au premier niveau de l'état comme dans une écriture
    // profonde (µ._mjs_deepSet, mjs_deep.ts).
    // Rend `false` (écriture refusée) — le code généré (`µ._set(...)`) ne dépend plus
    // de cette valeur (l'affectation réactive utilisée comme valeur vaut désormais la
    // valeur assignée, jamais le retour de `_set`), un appelant DIRECT peut donc
    // distinguer un refus d'un succès.
    if (!µ._mjs_safeKey(k)) return false;
    // Hot path bench: 1000× setLabel('string'). Factorise typeof v
    // pour éviter 3 typeof checks séparés. La majorité des sets sont primitive→primitive.
    const old = this._state[k];
    let tv = typeof v;
    if (old === v && (tv !== 'object' || v === null)) {
      // 1. Sortie ultra-rapide si la primitive n'a pas changé
      // champ nombre en saisie refusée lié à `k` : la même valeur écrite par le code le remplace (rare, cf. µ._mjs_refuse)
      if (this._mjs_refuses) µ._mjs_refuseRestore(this, k, old);
      return true;
    }
    // 1-bis. Types et valeurs permises (bloc <vars>, mjs_types.ts) : la règle de la variable passe
    // avant tout le reste — valeur convertie, ramenée dans sa plage, ou refusée (rien n'est écrit,
    // la valeur d'avant reste). Un composant sans <vars> ne paie que ce test
    const T = this._mjs_types;
    if (T !== void 0 && hasProp.call(T, k)) {
      v = µ._mjs_tset(this, k, v);
      if (v === µ._mjs_TNO) return false;
      tv = typeof v;
      if (old === v && (tv !== 'object' || v === null)) return true;
    }
    // Variant posé en PROP (`layout={expr}`) et non en attribut : `syncProps`
    // ne surveille que les ATTRIBUTS — sans ce relais, la bascule changeait l'état
    // sans jamais rejouer la feuille du variant.
    // `_mjs_var_bits` tranche l'homonymie : un composant qui déclare LUI-MÊME `$layout`
    // s'en sert comme d'un état ordinaire (`'list'`/`'grid'`, rien à voir avec le style)
    // et garde la main — sinon le seul fait de nommer sa variable `layout` faisait
    // crasher son montage dès qu'un `<style name="…">` existait ailleurs dans le fichier
    // `_mjs_lay` : le composant lit µlayout — sa prop `layout`, déclarée pour lui, reste le modèle
    if ((k === 'layout' || k === 'template') && this._shadow && (this._mjs_lay || !(this._mjs_var_bits && hasProp.call(this._mjs_var_bits, k)))) {
      this._mjs_layoutName = v || '';   // mémorisé pour la reconnexion : aucun attribut ne le porte
      this._mjs_applyLayout(v || 'default');
    }
    // Thème nommé posé en PROP (`theme={expr}`) : pendant exact du relais ci-dessus, mais l'inverse
    // en mécanique — le CSS du thème est DÉJÀ dans le composant, c'est son sélecteur qui exige
    // l'attribut (`:where(:host([theme='gold']), mjs-x[theme='gold'])`). Sans ce reflet, la prop
    // posait un état et RIEN d'autre : aucune erreur, aucun style, panne muette.
    // Même garde `_mjs_var_bits` : un composant qui déclare son propre `$theme` métier garde la main
    if (k === 'theme' && this._shadow && !(this._mjs_var_bits && hasProp.call(this._mjs_var_bits, k))) {
      if (v) this.setAttribute('theme', v);
      else   this.removeAttribute('theme');
    }
    // `old` primitif était boxé par `old._mjs_c` puis
    // `µ._mjs_interpolatorSet.has(old)` sur le chemin des composants riches
    // (computeds/binds désarment le fast-path #B) : on gate ces accès « objet »
    // par un test de type unique (aucun primitif n'est un wrapper computed ni un
    // interpolateur) — évite le boxing sur le hot path des sets primitifs.
    const oldObj = old !== null && typeof old === 'object';
    // Optim #B — Fast-path "pure data var" : aucun computed / binds / inspections,
    // valeur primitive simple, pas d'effect/struct sur k, pas
    // d'effects user → on bypass _mjs_notifyMutation (skip computed dirty-marking et
    // dispatch mjs-bind) et on appelle directement _mjs_invalidate(k).
    //
    // _mjs_invalidate fera lui-même son fast-path interne (effects vides + struct
    // vide → return rapide, sans alloc microtask pour les vars pures).
    //
    // NB: on appelle quand même _mjs_invalidate(k) pour respecter le contrat API
    // (tests runtime override _mjs_invalidate pour les assertions).
    // Valeurs dérivées : une écriture de plus à leur horloge (cf. _MJS_CLOCK), sans en marquer aucune
    if (
      (tv === 'string' || tv === 'number' || tv === 'boolean') &&
      (!this._mjs_effects || this._mjs_effects.length === 0) &&
      !this._mjs_binds &&
      !this._mjs_inspections &&
      !(oldObj && _mjsDerive(old)) &&
      !(oldObj && µ._mjs_interpolatorSet.has(old))
    ) {
      // <ledger>
      // la variable quitte l'objet qu'elle tenait (cf. _mjsLedgerSet)
      if (oldObj) _mjsLedgerSet(this, µ._mjs_toRaw(old), -1);
      // </ledger>
      this._state[k] = v;
      // <derived-values>
      if (this._mjs_computeds) _mjsCount(this._mjs_computeds, k);
      // </derived-values>
      // <signals>
      if (this._mjs_sigBoxes) µ._mjs_sigWrite(this, k);
      // </signals>
      this._mjs_invalidate(k);
      return true;
    }
    // 2. Protection des Computed : ré-écrire un computed avec une primitive
    // ne le casse pas — on garde juste le wrapper et notifie les listeners.
    if (oldObj && _mjsDerive(old) && tv !== 'function' && !_mjsDerive(v)) {
      this._mjs_notifyMutation(k, old);
      return true;
    }
    var parsed = v;
    // 2-ter. Assigner une valeur (nombre OU objet/tableau) à une var qui tient
    // un interpolateur (spring/tweened) règle sa CIBLE — on ne remplace PAS la
    // var (sauf si on assigne un autre interpolateur = ré-init). Permet les
    // ressorts composites : `$coords = { x, y }` → `spring.value = { x, y }`.
    if (oldObj && µ._mjs_interpolatorSet.has(old)
        && !(v != null && µ._mjs_interpolatorSet.has(v))
        && (tv === 'number' || (tv === 'object' && v !== null))) {
      old.value = v;
      return true;
    }
    // 3. Interception des nombres (interpolateurs) — une plage éventuelle est déjà passée plus
    // haut (types, 1-bis), un ressort y a reçu ses bornes
    if (tv === 'number') {
      if (oldObj && µ._mjs_interpolatorSet.has(old)) {
        old.value = parsed;
        return true;
      }
    } else if (parsed != null && µ._mjs_interpolatorSet.has(parsed)) {
      // `this` = owner (clé de la Map _mjs_invalidators — voir mjs_spring.ts/
      // mjs_interpolate.ts) : un ré-attach par ce MÊME composant remplace son
      // entrée (pas d'accumulation à chaque re-render) ; un AUTRE composant
      // partageant le même interpolateur garde la SIENNE.
      parsed._mjs_attachInvalidator(this, () => {
        return this._mjs_notifyMutation(k, old);
      });
    }
    if (old === parsed && (tv !== 'object' || parsed === null)) {
      // 4. Sortie finale si la valeur clampée/calculée est identique
      return true;
    }
    // 5. Wrap des objets dans un Proxy invalidant la clé top-level sur toute
    // mutation profonde. `$.box.width = X` doit re-render même si on n'a pas
    // appelé `µ._set(this, 'box', ...)` directement. Le compile-time gain
    // reste sur les primitives ; les objets payent le coût Proxy V1 (~marginal).
    if (tv === 'object' && parsed !== null && !µ._mjs_interpolatorSet.has(parsed) && !_mjsDerive(parsed) && !(parsed instanceof Promise) && !µ._mjs_rawSet.has(parsed)) {
      // reconnaissance des enveloppes (mort de la boucle two-way
      // inter-composants). `parsed` peut arriver ENVELOPPÉ par
      // un AUTRE composant/rune/store (écho d'une liaison `!{}`, ou valeur
      // partagée assignée telle quelle) : on déballe jusqu'au brut AVANT de
      // comparer/wrapper, sinon chaque frontière empile un Proxy-de-Proxy —
      // identité neuve à chaque aller-retour, carnet (la fiche de l'objet) jamais
      // stable, ping-pong infini.
      parsed = µ._mjs_toRaw(parsed);
      var oldRaw = µ._mjs_toRaw(old);
      if (oldRaw === parsed) {
        // Même brut des DEUX côtés : soit un ÉCHO pur (le pair nous renvoie
        // ce qu'on vient nous-même de lui envoyer, l'époque de mutation n'a
        // pas bougé depuis notre dernier passage sur cette clé — silence,
        // c'est ÇA qui tue la boucle), soit une mutation RÉELLE survenue
        // entre-temps ailleurs sur ce même brut (l'époque a bougé) qu'il
        // faut répercuter LOCALEMENT (DOM/binds) sans réécrire `_state[k]` —
        // le Proxy local déjà en place lit de toute façon le brut partagé.
        var ep = µ._mjs_epochs.get(parsed) || 0;
        // époque inchangée depuis notre dernier passage sur cette clé : aucun changement vu par MJS entre-temps — l'écho d'une
        // liaison, une prop reposée telle quelle, le même objet réécrit par le composant (`$x = o`, l'enveloppe de l'état) restent
        // muets. `$x = $x` n'arrive pas ici : la construction le refuse (sigils.ts, selfWriteError)
        if (((this._mjs_bindEpochs != null && this._mjs_bindEpochs[k]) || 0) === ep) {
          // <retell>
          // le composant qui donne l'objet redit les liaisons d'une de ses variables (`µrefresh($x)`, écriture par un nom dont la
          // remontée s'est repliée) : l'enfant qui tient un objet atteint par cette variable suit (cf. _mjsRetold)
          if (µ._mjs_retold) _mjsRetold(this, k, parsed, old, 0);
          // </retell>
          return true;
        }
        // mutation réelle survenue ailleurs sur ce même brut (l'époque a bougé) : une écriture
        (this._mjs_bindEpochs ||= {})[k] = ep;
        // <retell>
        // prévenu d'une écriture pendant que le composant qui donne l'objet redit ses liaisons : il les redit à son tour à ses propres
        // enfants, dont l'objet peut n'avoir pas avancé (cf. _mjsRetold)
        if (µ._mjs_retold) return _mjsRetold(this, k, parsed, old, 1);
        // </retell>
        this._mjs_notifyMutation(k, old);
        return true;
      }
      // <middle>
      // objet reçu enveloppé, donc lu dans un état (prop `item={$o.a.b}`, ligne `item={r}`) : un composant peut tenir un objet du milieu
      // d'un chemin écrit (cf. µ._mjs_middle)
      if (v !== parsed) µ._mjs_middle = true;
      // </middle>
      // <families>
      // objet reçu par l'enveloppe d'un état partagé ou d'un magasin et rangé par le code du composant (`$courant = st.rows[1]`) : sa
      // fiche, notée plus bas (cf. _mjsTap). Une prop que livre le parent (`item={$$stock[0]}`, sans `code`) n'en note aucune : l'enfant
      // qui écrit l'objet reçu ne prévient ni le parent ni les lecteurs de l'état, comme pour tout objet reçu par une prop à sens unique.
      // Sous la règle de l'horloge, `µ._set` ne dit pas qui écrit : toute enveloppe reçue note sa fiche
      // <precision>
      var __fi = v !== parsed && code ? v[µ._mjs_HANDLER] : void 0;
      // </precision>
      // <clock>
      // var __fi = v !== parsed ? v[µ._mjs_HANDLER] : void 0;
      // </clock>
      // </families>
      // liste : ses éléments rangés bruts (`$l = $l.filter(…)` lit des éléments enveloppés), copiée s'il le faut
      var __raw = µ._mjs_rawIn(parsed);
      // <shared-object>
      parsed = this._mjs_wrapDeep(__raw, k);
      // </shared-object>
      // <no-shared-object>
      // parsed = __raw;
      // </no-shared-object>
      (this._mjs_bindEpochs ||= {})[k] = µ._mjs_epochs.get(__raw) || 0;
      // le composant est noté parmi ceux qui tiennent l'objet ; un autre l'a tenu avant lui : l'objet est marqué partagé (cf. _mjsHold)
      _mjsHold(this, __raw);
      // <ledger>
      // un objet neuf pour la variable : le carnet sait que ce composant le tient
      _mjsLedgerSet(this, __raw, 1);
      // </ledger>
    }
    // <retell>
    // objet µraw reposé tel quel par le composant qui le donne pendant qu'il redit ses liaisons (`µrefresh($x)`, `rows={$x}`) : l'enfant
    // suit comme pour un objet enveloppé (cf. _mjsRetold) — rafraîchi, ses listes relisent les lignes brutes changées sur place
    else if (old === parsed && µ._mjs_retold && µ._mjs_retold.e !== this && tv === 'object' && parsed !== null && µ._mjs_rawSet.has(parsed)) return _mjsRetold(this, k, parsed, old, 0);
    // </retell>
    // <ledger>
    // la variable quitte l'objet qu'elle tenait : le même objet repris n'arrive pas ici (écho ou mutation, plus haut)
    if (oldObj) _mjsLedgerSet(this, µ._mjs_toRaw(old), -1);
    // </ledger>
    // <families>
    // la variable note la fiche de l'état dont elle tient l'objet, ou l'oublie quand elle prend une autre valeur ; le même objet reposé
    // (écho ou mutation, plus haut) garde sa note
    if (__fi !== void 0) {
      (this._mjs_tap ||= new Map()).set(k, __fi);
      µ._mjs_tap = true;
    }
    else if (this._mjs_tap !== void 0) this._mjs_tap.delete(k);
    // </families>
    this._state[k] = parsed;
    this._mjs_notifyMutation(k, old);
    return true;
  }

  // <wrapper>
  // Wrap récursif optimisé : intercepte les sets et notifie la clé
  // top-level. Cache via WeakMap pour éviter de re-wrapper le même objet à
  // chaque get.
  //
  // Set/Map/Date/RegExp ont des internal slots ([[SetData]] etc.) que le
  // Proxy ne préserve pas. On doit binder les méthodes natives sur le
  // target original pour éviter "Method called on incompatible receiver".
  // Les méthodes mutatives (add/delete/clear/set) sont en plus wrappées pour
  // notifier la mutation à la clé top-level.
  //
  // Optimisations vs version naïve :
  //   - **Précalcul** des bools `isWrapped`, `mutators` UNE fois par Proxy
  //     (pas à chaque get).
  //   - **methodCache local** : `val.bind(obj)` calculé 1 seule fois par
  //     prop accédée. Évite alloc d'une nouvelle Function à chaque accès en
  //     hot path (ex : .push/.length appelés en boucle).
  //   - **Fast-path Symbol** : Symbols sont rares, traités en premier sans
  //     dispatch.
  //   - `mutators` est un Set (O(1) `.has`) au lieu d'array `.includes` O(n).
  _mjs_wrapDeep(target, rootKey, via) {
    // reconnaissance des enveloppes : `target` peut être l'enveloppe
    // d'un AUTRE composant/rune/store (cf. µ._mjs_RAW) — on retrouve le brut
    // AVANT tout, pour que le carnet (_mjs_rootsByTarget, indexé par target) reste
    // stable peu importe le pair qui nous l'a transmis (jamais de Proxy-de-
    // Proxy à la frontière). Un Proxy MJS n'est jamais une Promise/Node.
    target = µ._mjs_toRaw(target);
    // cible déjà enveloppée par ce composant (objet de l'état relu, ligne d'une liste) : son enveloppe, rendue avant les
    // contrôles de type, déjà passés à sa création ; seule la marque µraw, qui peut venir après coup, se relit, et les
    // clés qui l'atteignent s'ajoutent à celles de sa fiche (`__rs`), comme plus bas — une comparaison quand c'est la sienne
    const __rt = this._mjs_rootsByTarget;
    const __rs = __rt !== void 0 ? __rt.get(target) : void 0;
    if (__rs !== void 0 && !µ._mjs_rawSet.has(target)) {
      if (rootKey !== __rs.r) _mjsKeyOf(__rs, rootKey);
      if (via !== void 0 && via.s !== void 0) via.s.forEach((k) => _mjsKeyOf(__rs, k));
      // <middle>
      // lu par un autre conteneur que la dernière fois : son lien est revu — une comparaison quand c'est le même (cf. _mjsBind)
      if (via !== void 0 && __rs.a !== via.v) _mjsBind(__rs, via.v, this);
      // </middle>
      // <development>
      // développement : la marque d'un objet venu d'une prop, ou envoyé par un événement (`_mjs_dv`, posée sur sa fiche),
      // passe à ce qu'on en lit (mjs_debug.ts) : une lecture de propriété pour un conteneur sans marque, deux quand les marques sont les
      // mêmes, aucune recherche. Retiré de tout cœur sans mjs_debug.ts (production, cœur nu)
      if (via !== void 0 && via._mjs_dv !== void 0 && via._mjs_dv !== __rs._mjs_dv) µ._mjs_devRead(via._mjs_dv, __rs);
      // </development>
      // <precision>
      // <derived-values>
      // composant sans valeur dérivée : aucune recherche, son doute ne servirait à rien (cf. _mjsDoubtKeys)
      if (_mjsDoubtN !== 0 && this._mjs_computeds != null && _mjsDoubtful.has(target)) _mjsDoubtKeys(this, __rs.s || [__rs.r]);
      // </derived-values>
      // </precision>
      return __rs.x;
    }
    if (target instanceof Promise || µ._mjs_rawSet.has(target) || target instanceof Node) {
      return target;
    }
    // Objets natifs "exotiques" (CanvasRenderingContext2D, CSSStyleDeclaration,
    // DOMRect, TypedArray, AudioContext…) : leurs méthodes font un brand-check
    // sur `this` (internal slots) et rejettent un Proxy — "X called on an object
    // that does not implement interface …". On les renvoie BRUTS : ce sont des
    // handles opaques, l'utilisateur ne mute pas leurs props en attendant de la
    // réactivité. Cas vécu : `$context = $canvas.getContext('2d')` puis
    // `$context.beginPath()`.
    //
    // Détection (cf. Vue `reactive`) : un objet plain ET une instance de classe
    // utilisateur rapportent tous deux `[object Object]` ; un objet natif
    // rapporte son tag spécifique. On wrappe donc UNIQUEMENT : plain/instance
    // user (`[object Object]`), Array, et Map/Set/Date/RegExp (traités plus bas).
    //
    // Passe aussi, enveloppé et gardé comme `Object.prototype` (cf. `__reject` plus bas), un prototype qui porte une
    // étiquette — `Map.prototype`, `Set.prototype`, où mène `__proto__` : l'objet que range son propre constructeur, et
    // qui garde le `valueOf` d'`Object.prototype`. Le prototype d'une valeur simple (`String.prototype`,
    // `Number.prototype`, `Boolean.prototype`, `Symbol.prototype`, `BigInt.prototype`) a le sien, qui vérifie son `this` :
    // rendu tel quel, ses lectures (`String(p)`, `{p}` dans la vue) marchent comme en JavaScript, une enveloppe les ferait
    // lever. Testé seulement pour ce qui serait rendu tel quel : un objet ou une liste n'en paie rien. Une `WeakMap`, un `WeakSet`
    // passent aussi, enveloppés comme une `Map`, un `Set` (comme Vue : clé déballée pour `get`, `has`, `set`, `delete`, `add`, valeur
    // sortie de `get` enveloppée) : testés ici seulement, leurs méthodes de modification notées dans `__w`, que les autres enveloppes
    // lisent une fois
    let __c;
    // <weak>
    let __w;
    // </weak>
    if (
      !Array.isArray(target) &&
      !(target instanceof Map) && !(target instanceof Set) &&
      !(target instanceof Date) && !(target instanceof RegExp) &&
      Object.prototype.toString.call(target) !== '[object Object]' &&
      !((__c = target?.constructor) && __c.prototype === target && target.valueOf === ({}).valueOf)
      // <weak>
      && !(__w = target instanceof WeakMap ? MJS_MAP_MUTATORS : target instanceof WeakSet ? MJS_SET_MUTATORS : void 0)
      // </weak>
    ) {
      // <no-weak>
      // // <development>
      // // `WeakMap`, `WeakSet` rendus tels quels par un cœur bâti sans leur part : le développement le dit (µ._mjs_collMissing, mjs_init.ts)
      // µ._mjs_collMissing(target);
      // // </development>
      // </no-weak>
      return target;
    }
    // UNE seule enveloppe par cible brute, quelle que soit la clé qui l'atteint : après `$sel = it`,
    // `it === $sel`, `$items.indexOf($sel)` rend son rang, `includes` le trouve.
    // cible BRUTE → sa fiche, qui porte son enveloppe (`x`) et les clés d'état par lesquelles elle a été atteinte (`r`, `s`, revues à
    // CHAQUE appel, plus haut) : `$a = obj ; $b = obj` partagent le MÊME objet — une mutation faite via l'un doit aussi prévenir un
    // lecteur de l'autre (cf. `_mjs_notifyMutationAliased`). Une seule table par composant : la fiche est aussi le carnet des
    // enveloppes, rangée une fois son enveloppe faite. Une cible sans enveloppe n'a pas de fiche
    this._mjs_rootsByTarget ??= new WeakMap();
    // objet qui est un prototype (`Object.prototype`, rangé dans l'état par une lecture `$loc.p = $$o['__proto__']`) : rien ne
    // s'y écrit, ne s'y définit ni ne s'y supprime par cette enveloppe (`+=`, `||=`, alias, `Object.assign`, rune `µproxy`), même
    // contrôle que les aides d'écriture profonde (mjs_deep.ts). Testé une fois, à la création de l'enveloppe : une écriture n'en
    // paie que la lecture. Ni gelé, ni scellé, ni fermé aux ajouts (`preventExtensions` plus bas). `Function.prototype`,
    // qu'enveloppent une lecture dans une `Map` ou un `Set` de l'état et la rune `µproxy`, en est un ; rangé à la racine, il reste
    // brut (cf. `_set`). Une fonction du navigateur (`Object`) n'a jamais d'enveloppe — rendue telle quelle plus haut, comme tout
    // objet natif — et une fonction de l'appli qui en reçoit une reçoit l'écriture, comme dans les aides
    const __reject = (__c = target.constructor) && __c.prototype === target ? '__proto__' : '';

    // Précalcul une seule fois par création de Proxy.
    const isMap = target instanceof Map;
    const isSet = target instanceof Set;
    const isDate = target instanceof Date;
    const isDateLike = isDate || target instanceof RegExp;
    // <weak>
    const isWrapped = isMap || isSet || isDateLike || __w;
    // </weak>
    // <no-weak>
    // const isWrapped = isMap || isSet || isDateLike;
    // </no-weak>
    // <no-collections>
    // // <development>
    // // `Map`, `Set` enveloppés par un cœur bâti sans la part des collections : le développement le dit (µ._mjs_collMissing, mjs_init.ts)
    // if (isMap || isSet) µ._mjs_collMissing(target);
    // // </development>
    // </no-collections>
    // Réutilise les Sets static module-level (1 alloc total au lieu de N).
    const mutators = isSet ? MJS_SET_MUTATORS
                   : isMap ? MJS_MAP_MUTATORS
                   : isDate ? MJS_DATE_MUTATORS
                   // <weak>
                   : isWrapped ? __w
                   // </weak>
                   // `Array.prototype`, liste lui aussi, rangé par une clé venue de l'extérieur : ses méthodes passent par l'enveloppe, qui refuse
                   // toute écriture dans un prototype
                   : Array.isArray(target) && !__reject ? MJS_ARRAY_MUTATORS
                   : null;
    // la fiche de l'objet : le gestionnaire de son Proxy, aux pièges communs (MJS_ENV_TRAPS) ; elle ne garde que ses champs, sans fermeture.
    // Méthodes liées (`m` du prototype — `includes`, `map`, `get`…, rendues sans garde ; `o` propres à l'objet, gardées à chaque lecture) et
    // enveloppeur des lectures (`u`) faits à la première lecture d'une méthode. Les méthodes d'un objet ou d'une liste se lient à
    // l'ENVELOPPE (`x`), pas à l'objet brut : `this.x = y` dans la méthode passe par le piège `set` et prévient le composant (classe
    // `Box { embiggen(n) { @width += n } }` appelée par `$box.embiggen(10)`). La fiche tient aussi le dernier objet rendu par
    // cette enveloppe (`k`, brut) et son enveloppe (`p`), avec le nombre de clés qui atteignaient alors le conteneur (`n`) : relu
    // dans le même tour (`$o.a.b` dans une boucle, ligne d'un rendu), il est déjà rangé sous toutes ces clés, son enveloppe se rend
    // sans repasser par le carnet. Une clé de plus pour le conteneur, ou un autre objet, repasse par `_mjs_wrapDeep`. Oublié à la
    // microtâche suivante (`_mjsKidsForget`) : retiré de l'état, il part au ramasse-miettes. Rangé sur la fiche, jamais
    // dans une fonction faite pendant une lecture, qui garderait cette lecture et l'objet lu
    const handler = {
      __proto__: MJS_ENV_TRAPS,
      e:         this,
      r:         rootKey,
      s:         void 0,
      x:         void 0,
      f:         __reject,
      t:         mutators,
      q:         isWrapped,
      m:         void 0,
      o:         void 0,
      u:         void 0,
      // <middle>
      // liens faibles vers ses conteneurs (cf. _mjsBind) : `a` celui par lequel il vient d'être lu, `b` le précédent (ceux au-delà de deux :
      // `l`, champ posé au troisième seulement) ; `v`, sa propre référence faible, faite à son premier sous-objet enveloppé
      a:         via !== void 0 ? via.v ?? null : void 0,
      b:         void 0,
      v:         void 0,
      // </middle>
      k:         void 0,
      p:         void 0,
      n:         0
    };
    // prototype ou fonction (`__reject`) : ni gelé, ni scellé, ni fermé aux ajouts — `Object.freeze`, `Object.seal` et
    // `Object.preventExtensions` lèvent leur TypeError, `Reflect.preventExtensions` rend `false`, même avertissement.
    // Posé pour eux seuls : un autre objet de l'état n'a pas ce piège (`undefined`, le comportement de JavaScript), et
    // la création de son enveloppe n'alloue rien de plus
    if (__reject) handler.preventExtensions = () => !_mjsEnvReject(__reject);
    // sous-objet lu par l'enveloppe de son conteneur (`via`, la fiche du conteneur) : il est atteint par TOUTES les clés du
    // conteneur, pas seulement par celle qui a créé son enveloppe
    if (via !== void 0 && via.s !== void 0) via.s.forEach((k) => _mjsKeyOf(handler, k));
    // <development>
    // développement : la marque du conteneur passe à l'objet lu, celle d'une livraison notée à l'objet rangé à la racine (mjs_debug.ts)
    µ._mjs_devCreate?.(this, target, handler, via);
    // </development>
    // <precision>
    // <derived-values>
    _mjsControl(this, target, handler);
    // </derived-values>
    // </precision>
    const proxy = new Proxy(target, handler);
    handler.x   = proxy;
    this._mjs_rootsByTarget.set(target, handler);
    // le composant devient un détenteur de l'objet (cf. _mjsClaims)
    _mjsClaims(_mjsWeak(this), target);
    // <reffets-state>
    // objet dont un composant a fait l'enveloppe : l'état partagé qui écrit dedans fait passer tous les reffets de ses abonnés (µ._mjs_uHeld,
    // mjs_runes.ts)
    µ._mjs_uHeld.add(target);
    // </reffets-state>
    // <weak>
    // enveloppe d'une `WeakMap`, d'un `WeakSet` : notée pour µraw, qui en rend la vraie collection sans rien lire sur ce qu'il reçoit
    // (µ._mjs_weakRaw, mjs_init.ts)
    if (__w) µ._mjs_weakRaw.set(proxy, target);
    // </weak>
    return proxy;
  }
  // </wrapper>
  // <no-wrapper>
  // // réglage `proxy: false` (mjs.config.json) : l'objet est rangé tel quel, sans enveloppe ; seules les écritures que le compilateur
  // // voit préviennent (mjs_deep.ts), un changement fait hors de MJS se signale par `µrefresh($x)`. La clé qui l'atteint est notée :
  // // l'écriture faite par l'une des variables qui tiennent le même objet, et `µrefresh`, préviennent aussi les autres (cf.
  // // `_mjs_notifyMutationAliased`)
  // // <shared-object>
  // _mjs_wrapDeep(target, rootKey) {
  //   if (target !== null && typeof target === 'object') {
  //     const rs = this._mjs_rootsByTarget ??= new WeakMap();
  //     let r = rs.get(target);
  //     // la fiche de l'objet, réduite à ses clés : `r` la première, `s` leur ensemble dès la deuxième
  //     if (r === void 0) rs.set(target, r = { r: rootKey, s: void 0 });
  //     else if (rootKey !== r.r) (r.s ||= new Set([r.r])).add(rootKey);
  //     // <development>
  //     // développement : la marque d'un objet venu d'une prop, ou envoyé par un événement, passe à l'objet rangé (mjs_debug.ts)
  //     µ._mjs_devCreate?.(this, target, r);
  //     // </development>
  //   }
  //   return target;
  // }
  // // </shared-object>
  // </no-wrapper>

  // <derived-values>
  // _mjs_setComputed : enregistre une fonction calculée et installe un getter sur _state.
  //
  // **Memoization (parité Svelte 5)** :
  // Le getter cache le résultat dans `v._mjs_cached` et le sert tant que l'horloge du
  // composant (`v._mjs_h.n`, cf. _MJS_CLOCK) n'a pas bougé depuis son calcul
  // (`v._mjs_seen`). Une lecture qui suit une écriture réévalue une fois et re-cache.
  // Évite la ré-évaluation O(n) sur lectures multiples dans le même frame.
  //
  // Détection de cycle conservée via `_mjs_evaluating`. Réassignation primitive
  // `$.x = 5` route via le setter qui convertit en value writable.
  // <precision>
  _mjs_setComputed(k, fn, src) {
  // </precision>
  // <clock>
  // _mjs_setComputed(k, fn) {
  // </clock>
    var descriptor, el;
    if (this._mjs_computeds == null) {
      this._mjs_computeds = {};
      this._mjs_computedKeys = [];
      // horloge de la table, partagée avec elle par les miroirs (cf. _MJS_CLOCK)
      // <precision>
      this._mjs_computeds[_MJS_CLOCK] = { n: 0, v: {}, d: void 0 };
      // </precision>
      // <clock>
      // this._mjs_computeds[_MJS_CLOCK] = { n: 0, v: {} };
      // </clock>
    }
    if (!(k in this._mjs_computeds)) {
      this._mjs_computedKeys.push(k);
    }
    this._mjs_computeds[k] = {
      f: fn,
      _mjs_evaluating: false,
      _mjs_c: true,
      _mjs_cached: void 0,
      // jamais calculée : aucun compte de l'horloge ne vaut -1
      _mjs_seen: -1,
      // <precision>
      _mjs_h: this._mjs_computeds[_MJS_CLOCK],
      // valeur précise : ses sources (cf. _mjsPreciseEnd) ; null : à l'horloge
      _mjs_src: src || null,
      _mjs_d: 0,
      // valeur précise : son nœud du graphe des signaux (cf. _mjsPrecise) ; null : à l'horloge, ou cœur sans le graphe
      _mjs_n: null,
      // calcul fait pendant la lecture en cours (cf. le contrôle de développement)
      _mjs_done: 0
      // </precision>
      // <clock>
      // _mjs_h: this._mjs_computeds[_MJS_CLOCK]
      // </clock>
    };
    // <precision>
    // à l'horloge : son écran suit aussi les écritures profondes (cf. _mjsClockView)
    if (src && µ._mjs_sigDerived) {
      const __v = this._mjs_computeds[k];
      __v._mjs_n = µ._mjs_sigDerived(this, '$' + k, _mjsPrecise(this, __v));
    }
    else _mjsClockView(this);
    // </precision>
    // <clock>
    // _mjsClockView(this);
    // </clock>
    // Installer le getter (idempotent)
    descriptor = Object.getOwnPropertyDescriptor(this._state, k);
    if (!(descriptor != null ? descriptor.get : void 0)) {
      el = this;
      Object.defineProperty(this._state, k, {
        configurable: true,
        enumerable: true,
        // <precision>
        // valeur à l'horloge : la règle de toujours, sans rien de plus ; valeur précise (`src`) : cf. plus bas
        get: src ? function() {
          var v = el._mjs_computeds[k];
          if (!v) {
            return void 0;
          }
          if (v._mjs_evaluating) {
            µ.warn(µ._mjs_msg('elCycle', { k: k }, 'Cycle réactif détecté sur \'{k}\' — retourne undefined'));
            return void 0;
          }
          // valeur précise : le graphe la refait si une source qu'elle a lue a changé depuis son dernier calcul, et note la lecture
          // pour le calcul en cours ; servie sans calcul après une écriture du composant (l'horloge l'aurait refaite), elle passe
          // au contrôle de développement. Une exception de son calcul se relève à chaque lecture, jusqu'au changement d'une source
          if (v._mjs_n !== null && v._mjs_src !== null) {
            const __seenMark = v._mjs_seen;
            v._mjs_done = 0;
            µ._mjs_sigGet(v._mjs_n);
            if (v._mjs_src !== null) {
              // <derived-check>
              if (v._mjs_done === 0 && __seenMark !== v._mjs_h.n) _mjsRereading(el, k, v);
              // </derived-check>
              v._mjs_seen = v._mjs_h.n;
            }
            return v._mjs_cached;
          }
          // à l'horloge (doute, cœur sans le graphe) : la règle de toujours, calculée sans contrôle de ses lectures
          if (v._mjs_seen === v._mjs_h.n) {
            return v._mjs_cached;
          }
          v._mjs_evaluating = true;
          // le composant dont le dérivé se calcule, hors rendu compris (bascule de langue) : un libellé du cœur
          // lu là sans sa langue le note, et il se redessine à l'arrivée du fichier (µ._mjs_i18nLookup, mjs_i18n.ts)
          const __computing = µ._mjs_computing;
          const __precise    = _mjsP;
          µ._mjs_computing = el;
          _mjsP            = null;
          try {
            // <derived-check>
            const __before = v._mjs_cached, __first = v._mjs_seen < 0;
            // </derived-check>
            v._mjs_cached = v.f.call(el._state);
            // compte relu APRÈS le calcul : une écriture faite par le calcul lui-même ne le périme pas
            v._mjs_seen = v._mjs_h.n;
            // <derived-check>
            _mjsDerivedCheck(el, k, v._mjs_cached, __before, __first);
            // </derived-check>
            return v._mjs_cached;
          } finally {
            v._mjs_evaluating = false;
            µ._mjs_computing = __computing;
            _mjsP            = __precise;
          }
        } : function() {
        // </precision>
        // <clock>
        // get: function() {
        // </clock>
          var v;
          // V2 — plus de bitmask tracking. La closure des deps est connue
          // au compile-time via analyzer.computedDeps (déjà exposée via
          // l'analyzer). Pour les stores universels / effets qui lisent
          // un computed, ils s'abonnent à `comp._mjs_effectsByVar[<computedName>]`
          // s'il y a effectivement un dispatcher pour cette var.
          v = el._mjs_computeds[k];
          if (!v) {
            return void 0;
          }
          if (v._mjs_evaluating) {
            µ.warn(µ._mjs_msg('elCycle', { k: k }, 'Cycle réactif détecté sur \'{k}\' — retourne undefined'));
            return void 0;
          }
          // Cache hit : aucune écriture du composant depuis le dernier calcul, la valeur mémorisée sert
          if (v._mjs_seen === v._mjs_h.n) {
            return v._mjs_cached;
          }
          v._mjs_evaluating = true;
          // le composant dont le dérivé se calcule, hors rendu compris (bascule de langue) : un libellé du cœur
          // lu là sans sa langue le note, et il se redessine à l'arrivée du fichier (µ._mjs_i18nLookup, mjs_i18n.ts)
          const __computing = µ._mjs_computing;
          µ._mjs_computing = el;
          try {
            // <derived-check>
            const __before = v._mjs_cached, __first = v._mjs_seen < 0;
            // </derived-check>
            v._mjs_cached = v.f.call(el._state);
            // compte relu APRÈS le calcul : une écriture faite par le calcul lui-même ne le périme pas
            v._mjs_seen = v._mjs_h.n;
            // <derived-check>
            _mjsDerivedCheck(el, k, v._mjs_cached, __before, __first);
            // </derived-check>
            return v._mjs_cached;
          } finally {
            v._mjs_evaluating = false;
            µ._mjs_computing = __computing;
          }
        },
        set: function(newVal) {
          // <derived-choice>
          // `µderived $x = expr, $a` que le composant écrit (`_mjs_computedSrc` : ses dépendances nommées, posées par le code
          // généré) : sa fonction rend le choix tant qu'aucune n'a changé depuis — écrite (comptes de l'horloge, cf. _MJS_CLOCK)
          // ou, valeur dérivée elle-même, relue autre —, puis reprend son calcul ; un nouveau choix repart de la fonction
          // d'origine (`_mjs_f`). Toute autre valeur dérivée écrite devient une variable ordinaire (plus bas)
          const __dn = el._mjs_computedSrc?.get(k), __dv = el._mjs_computeds[k];
          if (__dn && __dv) {
            const __h = __dv._mjs_h, __n = __h.n, __f = __dv._mjs_f || (__dv._mjs_f = __dv.f), __seenMark = __dn.map((s) => el._state[s]);
            __dv.f = function() {
              for (let i = 0; i < __dn.length; i++) if (__h.v[__dn[i]] > __n || el._state[__dn[i]] !== __seenMark[i]) return (__dv.f = __f).call(this);
              return newVal;
            };
            el._mjs_notifyMutation(k, void 0);
            return;
          }
          // </derived-choice>
          // Réassignation primitive : convertir le getter en value writable.
          delete el._mjs_computeds[k];
          if (el._mjs_computedKeys) {
            const __idx = el._mjs_computedKeys.indexOf(k);
            if (__idx !== -1) el._mjs_computedKeys.splice(__idx, 1);
          }
          Object.defineProperty(el._state, k, {
            configurable: true,
            writable: true,
            enumerable: true,
            value: newVal
          });
          el._mjs_notifyMutation(k, void 0);
        }
      });
    }
    this._mjs_notifyMutation(k, void 0);
    return true;
  }
  // </derived-values>

  // Les HOOKS DE CYCLE DE VIE en runes (µmount/µawake/µsleep/µdestroy/µurlChange/µfailed nu,
  // `_mjs_hook`/`_mjs_fireMount`) et l'API interne de teardown qu'ils partagent
  // (`_mjs_onDestroy`/`_mjs_onSleep`/`_mjs_onAwake`) vivent désormais dans
  // src/runtime/mjs_lifecycle.ts — patch de `µ.Element.prototype` posé APRÈS
  // cette classe, même technique que mjs_on.ts.

  // <shared-object>
  // objet BRUT muté (`obj` : cible du proxy `_mjs_wrapDeep` qui vient de trapper la
  // mutation, ou conteneur écrit par une mutation profonde compilée, mjs_deep.ts) atteint
  // par PLUSIEURS clés d'état (`$a = obj ; $b = obj`, cf. la fiche de `_mjs_rootsByTarget`, posée par
  // `_mjs_wrapDeep`) : notifie CHACUNE, et toujours `rootKey` (la clé écrite) — sinon un
  // lecteur de `$b` ne voit jamais passer une mutation faite via `$a`, alors que les deux
  // pointent le même objet. Une seule enveloppe par cible, mais chaque clé a son propre
  // abonnement : jamais de double invalidation pour un même lecteur.
  // <redraw>
  _mjs_notifyMutationAliased(obj, rootKey, oldValue, rw) {
  // </redraw>
  // <no-redraw>
  // _mjs_notifyMutationAliased(obj, rootKey, oldValue) {
  // </no-redraw>
    // <families>
    // un objet d'un état partagé ou d'un magasin tenu par une variable du composant : l'état est prévenu aussi (cf. _mjsTap) ; µrefresh
    // (`rw`) n'y touche pas
    // <redraw>
    if (µ._mjs_tap && !rw) _mjsTap(this, obj, rootKey);
    // </redraw>
    // <no-redraw>
    // if (µ._mjs_tap) _mjsTap(this, obj, rootKey);
    // </no-redraw>
    // </families>
    // <wrapper>
    // les autres détenteurs de l'objet écrit en sont prévenus (cf. _mjsClaimNotice), dès qu'un objet a eu deux détenteurs ; `µrefresh` (`rw`)
    // n'y touche pas
    // <redraw>
    if (µ._mjs_claimed && !rw) _mjsClaimNotice(this, obj);
    // </redraw>
    // <no-redraw>
    // if (µ._mjs_claimed) _mjsClaimNotice(this, obj);
    // </no-redraw>
    // </wrapper>
    // la fiche de l'objet : `r`, la clé qui l'a créée — la seule dans le cas courant, où rien n'est cherché — et `s`, toutes ses clés.
    // L'ensemble est pris AVANT de prévenir : une liaison relue pendant la notification de `r` peut lire l'objet par la clé écrite pour la
    // première fois et créer l'ensemble (`$a = S ; $b = { sub: S }`, `{$a.x > 0 ? $b.sub.x : 0}`, puis `$b.sub.x = 5`) — la clé écrite,
    // absente au départ, est alors prévenue plus bas ; un ensemble déjà là se parcourt vivant, la clé qui s'y ajoute est visitée
    var f = this._mjs_rootsByTarget && this._mjs_rootsByTarget.get(obj), s = f && f.s, ks = s || (f && f.r !== rootKey ? [f.r] : void 0);
    // <other-names>
    // réglage `proxy: false` : la fiche ne connaît que les variables qui tiennent l'objet elles-mêmes. Une variable que le compilateur a
    // notée comme un autre nom d'une autre (`$sel = $rows[i]`, `_mjs_otherNames`, cf. stateAliases) prévient aussi celle-ci, dont une liste peut
    // montrer l'objet écrit : ses listes relisent leurs lignes (cf. _mjs_invalidate)
    var al = this._mjs_otherNames !== void 0 && hasProp.call(this._mjs_otherNames, rootKey) ? this._mjs_otherNames[rootKey] : void 0;
    if (al !== void 0) ks = ks ? [...ks, ...al] : al;
    // </other-names>
    if (ks) {
      // <redraw>
      ks.forEach((key) => this._mjs_notifyMutation(key, oldValue, rw));
      // </redraw>
      // <no-redraw>
      // ks.forEach((key) => this._mjs_notifyMutation(key, oldValue));
      // </no-redraw>
      if (s && s.has(rootKey)) return;
    }
    // <redraw>
    this._mjs_notifyMutation(rootKey, oldValue, rw);
    // </redraw>
    // <no-redraw>
    // this._mjs_notifyMutation(rootKey, oldValue);
    // </no-redraw>
  }
  // </shared-object>
  // <no-shared-object>
  // // aucune clé notée sur un objet (sans `_mjs_wrapDeep`) : seule la clé écrite est prévenue. Gardée pour les mutations profondes que joint
  // // la page du journal d'erreurs, compilée à la volée (mjs_deep.ts, cf. server/viewer-page.ts)
  // _mjs_notifyMutationAliased(obj, rootKey, oldValue, rw) {
  // <families>
  //   if (µ._mjs_tap && !rw) _mjsTap(this, obj, rootKey);
  // </families>
  //   this._mjs_notifyMutation(rootKey, oldValue, rw);
  // }
  // </no-shared-object>
  // <wrapper>
  // AVIS DU REGISTRE DES DÉTENTEURS (cf. _mjsClaimNotice) : un autre a écrit l'objet brut `raw`, dont ce composant a fait l'enveloppe. Sorti de
  // la page, ou ne le tenant plus (sa prop mène ailleurs, cf. _mjsOutsideState), il rend faux. Sinon chaque clé qui l'atteint chez lui (sa
  // fiche) prend l'époque de l'objet qu'elle tient — celui que son parent lui repose ensuite est un écho : un seul avis par écriture —, puis
  // elle est prévenue comme d'une écriture, sans avertissement ni relais à son parent lié ; une clé qui tient `a` ou `b` est passée
  _mjs_claimNotice(raw, a, b) {
    const f = this._mjs_rootsByTarget !== void 0 ? this._mjs_rootsByTarget.get(raw) : void 0;
    if (f === void 0) return false;
    // sorti de la page (le routeur qui le garde, une ligne retirée) : l'objet est noté, il s'y réinscrit s'il revient (cf. _mjsClaimReturns)
    if (this._mjs_mjsInitialized && !this.isConnected) {
      (this._mjs_claimOut ||= []).push(raw);
      return false;
    }
    // <middle>
    if (_mjsOutsideState(raw, this, 0)) return false;
    // </middle>
    const be = this._mjs_bindEpochs ||= {};
    for (const k of f.s || [f.r]) {
      const o = µ._mjs_toRaw(this._state[k]);
      if (o !== void 0 && (o === a || o === b)) continue;
      be[k] = µ._mjs_epochs.get(o) || 0;
      this._mjs_notifyMutation(k, this._state[k]);
    }
    // <derived-values>
    // valeurs à l'horloge montrées : refaites comme après une écriture du composant (cf. _mjsClockView)
    if (_mjsSeenEls.has(this)) _mjsClockRedraw(this);
    // </derived-values>
    return true;
  }
  // </wrapper>

  // <fine-grained>
  // écriture servie champ par champ (mise à jour fine, mjs_deep.ts) : l'horloge des valeurs dérivées et la boîte de `k` avancent comme
  // sur le chemin ordinaire (`_mjs_notifyMutation`) ; seules les liaisons du champ écrit repassent
  _mjs_fineNote(k) {
    // <derived-values>
    const __cs = this._mjs_computeds;
    if (__cs) _mjsCount(__cs, k);
    // </derived-values>
    // <signals>
    if (this._mjs_sigBoxes) µ._mjs_sigWrite(this, k);
    // </signals>
  }
  // </fine-grained>

  // HUB CENTRAL DES MUTATIONS
  // <redraw>
  // `rw` : `µrefresh($x)`, qui redessine seulement — ni reffet ni parent lié prévenu
  _mjs_notifyMutation(k, oldValue, rw) {
  // </redraw>
  // <no-redraw>
  // _mjs_notifyMutation(k, oldValue) {
  // </no-redraw>
    // Cache local des slots rarement utilisés. Le pattern Coffee
    // `((ref = X) != null ? ref.size : void 0)` génère 2 var décl + chained
    // ternary. V8 ne hoist pas ces locaux entre appels. Cache direct simplifié.
    // 99% des composants n'ont ni `_mjs_inspections` ni `_mjs_binds` → skip total.
    const __ins = this._mjs_inspections;
    // affichage de `µinspect` (tout `$x`, ou ses seuls chemins) : dans mjs_inspect.ts, le
    // module qui pose `_mjs_inspections` — un projet qui n'inspecte rien n'en embarque pas une ligne
    if (__ins && __ins.size > 0 && __ins.has(k)) µ._mjs_inspectShow(this, k, oldValue);
    // <derived-values>
    // Valeurs dérivées : toute écriture les périme toutes, d'un compte de plus à leur horloge (cf. _MJS_CLOCK) — une
    // écriture coûte la même chose quel que soit leur nombre ; chacune se recalcule à sa prochaine lecture
    const __cs = this._mjs_computeds;
    if (__cs) _mjsCount(__cs, k);
    // </derived-values>
    // <signals>
    // graphe des signaux (mjs_signals.ts) : la boîte de `k`, si une lecture notée l'a créée, avance aux mêmes écritures que l'horloge
    // (mutations profondes et enveloppe de l'état par _mjs_notifyMutationAliased, µrefresh) ; sans lecteur, une lecture et un test.
    // `µrefresh` (`rw`) n'y relance aucun reffet
    // <redraw>
    if (this._mjs_sigBoxes) µ._mjs_sigWrite(this, k, rw);
    // </redraw>
    // <no-redraw>
    // if (this._mjs_sigBoxes) µ._mjs_sigWrite(this, k);
    // </no-redraw>
    // </signals>
    // <redraw>
    this._mjs_invalidate(k, rw);
    if (rw) return;
    // </redraw>
    // <no-redraw>
    // this._mjs_invalidate(k);
    // </no-redraw>
    // Ne créer le CustomEvent (alloc + dispatch) qu'une fois la condition
    // validée. Avant, l'allocation se faisait quand même.
    // Cache local + simplify du Set#has check.
    const __binds = this._mjs_binds;
    // ne remonte que ce que l'enfant écrit lui-même, une fois les valeurs de son parent reçues : ni le défaut de son script (`$x = null`, à sa mise
    // à niveau), ni ce que le parent lui livre à la connexion (attribut, registre `µ._mjs_pend`) — le parent gagne, sa variable ne reçoit jamais
    // ces valeurs. Reste ouvert détaché : un `µsleep`, un `µdestroy` ou une minuterie écrivent encore dans la variable d'un parent détaché avec lui
    if (__binds && __binds.size > 0 && __binds.has(k) && this._mjs_bindOpen) {
      // <wrapper>
      // prévenu par le registre des détenteurs (cf. _mjsClaimNotice) : il n'a rien écrit, sa prop liée ne remonte pas
      if (_mjsNoticing) return;
      // </wrapper>
      // pendant la réconciliation d'un `{for}`, une ligne déplacée voit ses enfants déconnectés puis reconnectés alors que les indices gardés
      // sur les nœuds sont ceux de l'ancienne place : l'écriture attend la fin de la réconciliation (cf. mjs_for.ts) et part vers la ligne d'arrivée
      if (µ._mjs_hold) return µ._mjs_holdBind(this, k, oldValue);
      // <loops>
      // une boucle qui écrit l'état tourne : la prop remonte une fois, à sa sortie, avec sa valeur finale (cf. _mjsBindsInLoop)
      if (µ._mjs_lq) return _mjsBindsInLoop(this, k);
      // </loops>
      return this._mjs_emitBind(k);
    }
  }

  // l'écriture liée part vers le parent : `mjs-bind:k`, la valeur de l'état dans `e.data`
  _mjs_emitBind(k) {
    // Convention MJS : `e.data` (pas `e.detail`). Voir _mjs_emit.
    // Direct assignation au lieu de defineProperty (économise ~50ns alloc).
    // CustomEvent ne réserve pas la prop `data`, assignation libre OK.
    const _bindEv = new CustomEvent(`mjs-bind:${k}`, {
      bubbles: true,
      composed: false
    });
    _bindEv.data = this._state[k];
    return this.dispatchEvent(_bindEv);
  }

  // ==========================================
  // CYCLE DE VIE ET API PRIVÉE DE L'INSTANCE
  // ==========================================

  // `_mjs_setContext`/`_mjs_getContext` (§) et `_mjs_setRCtx`/`_mjs_getRCtx`/
  // `_mjs_rctxRemember` (§§) vivent désormais dans src/runtime/mjs_context.ts —
  // patch de `µ.Element.prototype` posé APRÈS cette classe, même technique que
  // mjs_on.ts.

  // `_mjs_on` (rune `µon`) vit désormais dans src/runtime/mjs_on.ts — patch de
  // `µ.Element.prototype` posé APRÈS cette classe, même technique que mjs_flip.ts.

  // `_mjs_emit` (rune `µemit`, directive `@emit.NOM`) vit désormais dans
  // src/runtime/mjs_emit.ts — patch de `µ.Element.prototype` posé APRÈS cette
  // classe, même technique que mjs_on.ts.

  connectedCallback() {
    // <wake-up>
    // en attente de son réveil, ou de son tour pendant un réveil (`@wake`, mjs_wake.ts) : sa connexion attend, seul son déclencheur est posé
    if (this._mjs_wakeCalls) return µ._mjs_wakeArm(this);
    // </wake-up>
    // <wrapper>
    // remis dans la page après un avis reçu dehors : il se réinscrit au registre des détenteurs (cf. _mjsClaimReturns)
    if (this._mjs_claimOut !== void 0 && this.isConnected) _mjsClaimReturns(this);
    // </wrapper>
    // connexion jouée après le départ de l'élément : le navigateur la met en file à l'insertion, elle tourne après celle
    // d'un ancêtre qui l'a déjà retiré (la garde `µurlChange` d'un layout rendu par le cache qui renvoie ailleurs, le
    // `µawake` d'un parent qui retire son enfant) — le cycle suit son cours (props, montage en attente, destruction différée
    // s'il reste dehors), seuls `µawake` et l'inscription au routeur (son `µurlChange`) sont sautés ; la déconnexion qui la
    // suit en file ne joue pas `µsleep` (`_mjs_arrive`, lu par disconnectedCallback)
    const arrive = this._mjs_arrive = this.isConnected;
    // <child-props>
    let __kh = !!this._mjs_kf;
    if (!this._mjs_mjsInitialized) {
      // <shadow-before-host>
      // première connexion avant celle de son hôte (happy-dom connecte le contenu d'une ombre avant son hôte ; un navigateur, jamais) :
      // les hôtes pas encore connectés qui livrent des props aux composants de leur racine (`_mjs_kb`, generator/compile.ts) les posent
      // d'abord, du plus haut au plus proche — leurs props à eux sont là, posées par leur parent avant l'insertion. Une liaison qui lève ne
      // coupe rien, le premier rendu de l'hôte la rejoue (cf. plus bas). Gardé au seul cœur bâti pour happy-dom (réglage `happyDom` du
      // bundler, posé par le harnais de test) : absent du cœur des navigateurs
      const __hs = [];
      for (let __h = this.getRootNode().host; __h && __h._mjs_kb && !__h._mjs_mjsInitialized && !__h._mjs_is_mounted; __h = __h.getRootNode().host) __hs.unshift(__h);
      for (const __h of __hs) {
        try {
          __h._mjs_kb();
        } catch {
          // no-op : rejouée par le premier rendu de l'hôte
        }
      }
      // </shadow-before-host>
      // composant léger qui livre des props aux composants de sa racine : son contenu attend la fin de la reprise de ses props (plus
      // bas), comme celui d'un composant mis à niveau dans la page ; le rendu que cette reprise demanderait attend avec lui s'il n'est
      // pas déjà en file, pour que ses enfants se connectent avant ce rendu, comme sans cette attente
      if (this._mjs_kb && this._mjs_pendingLightFragment) {
        this._mjs_kf                   = this._mjs_pendingLightFragment;
        this._mjs_pendingLightFragment = null;
        if (!this._mjs_render_scheduled) {
          this._mjs_render_scheduled = __kh = true;
          this._mjs_pending          = new Set();
        }
      }
    }
    // </child-props>
    // Reprise du fragment différé par `_mjs_mount` en mode léger (cf. son
    // commentaire) : `connectedCallback` n'a pas la contrainte
    // « pas d'enfants » du constructeur, l'insertion peut se faire ici sans
    // risque, quel que soit l'ordre réel construction/upgrade.
    if (this._mjs_pendingLightFragment) {
      this.appendChild(this._mjs_pendingLightFragment);
      this._mjs_pendingLightFragment = null;
    }
    if (!this._mjs_mjsInitialized) {
      // Anti-FOUC : pose [mjs-loading] AVANT tout travail de montage. La règle
      // globale [mjs-loading]{visibility:hidden!important} (cf. µ._mjs_shield)
      // prend le relais du :not(:defined) qui vient de s'éteindre à l'upgrade.
      // Retiré en fin du premier render ci-dessous (`mjs-appearing`, posé à la mise à niveau : cf. le constructeur)
      this.setAttribute('mjs-loading', '');
      _mjsAll(this);
    }
    this._mjs_is_mounted = true;
    // topologie changée (connexion) : invalide tous les caches de résolution §§
    µ._mjs_rctxEpoch++;
    // `disconnectedCallback` pose
    // `_mjs_dead = true` inconditionnellement (fiabilise le nettoyage
    // paresseux). Or un simple DÉPLACEMENT DOM (réordonnancement d'un {for},
    // `appendChild` ailleurs, restauration pageCache) déclenche
    // disconnect+connect dans le MÊME tick, SANS destruction : sans reset ici,
    // le composant vivant reste marqué mort → `_mjs_notifyInvalidators`
    // (µspring/µinterpolate) purge ses liaisons (ressorts figés), un reconcile
    // le traite DEAD (recréation fraîche, perte d'état), les `introend` sautent.
    // On le ressuscite en tête de (re)connexion (+ `_mjs_dying` par symétrie).
    this._mjs_dead = false;
    this._mjs_dying = false;
    // `_mjs_layoutName` (dernier variant RÉELLEMENT appliqué) avant les attributs : un
    // variant posé en prop par le parent (`layout={expr}`) doit survivre à une
    // reconnexion. On ne lit surtout pas `_state` — un composant peut avoir un `$layout`
    // à lui, sans rapport avec le style (cf. le garde de `_set`)
    // <layout-variable>
    this._mjs_applyLayout(this._mjs_layoutName || this._mjs_layAttr('layout') || this._mjs_layAttr('template') || 'default');
    // </layout-variable>
    // <no-layout-variable>
    // this._mjs_applyLayout(this._mjs_layoutName || this.getAttribute('layout') || this.getAttribute('template') || 'default');
    // </no-layout-variable>
    let __pend = µ._mjs_pending.get(this);
    // props TYPÉES d'une racine rendue par le serveur (option `props`) : l'attribut `mjs-props` (JSON) porte ce que le texte
    // d'un attribut ne sait pas dire — un nombre, une chaîne que la balise relirait en booléen ou en liste (cf.
    // src/server/root-props.ts). Versées EN TÊTE du registre : une prop posée par le parent l'emporte, l'attribut texte
    // d'une prop typée n'est pas relu. Lu à la première connexion (au serveur, au démarrage du client, pour une balise posée
    // plus tard : navigation d'une page rendue par requête), puis seulement quand son texte a changé : la balise déplacée ou remise par
    // le cache des pages garde les props que le composant a écrites depuis. Ses clés se lisent comme les noms d'attributs (`propDe`) :
    // `user-id` est la prop `userId`, celle dont l'attribut n'est pas relu, et `data-*` n'en est jamais une. Clés sûres :
    // `_set` refuse les autres (`µ._mjs_safeKey`) ; JSON illisible ou qui n'est pas un objet : les seuls attributs texte,
    // comme sans `mjs-props`
    const __tj = this.getAttribute('mjs-props');
    if (__tj && __tj !== this._mjs_tj) {
      this._mjs_tj = __tj;
      try {
        const __tp = JSON.parse(__tj);
        if (typeof __tp === 'object') {
          const __tc = Object.create(null);
          for (const __n in __tp) {
            const __k = this._mjs_propKey(__n);
            if (__k !== null) __tc[__k] = __tp[__n];
          }
          __pend = Object.assign(__tc, __pend);
        }
      } catch {
        // no-op
      }
    }
    // à chaque connexion, les valeurs que le parent livre (attributs, registre) ne sont pas des écritures de l'enfant et ne remontent pas : celles du
    // registre peuvent être périmées (le défaut qu'un composant du milieu a posé avant d'avoir reçu la sienne), l'attribut d'une page rendue par le
    // serveur reste celui de la page servie ; leur écho écraserait la variable du parent — la prop liée reste fermée jusqu'à la fin de cette reprise
    // remis dans la page après sa destruction différée (µmount réarmé, références `@this` vidées) : les props relues ou reprises ci-dessous
    // passent par le chemin synchrone de `_set`, qui lançait µmount avant le rendu complet de la reconnexion ; µmount attend ce rendu,
    // qui repose les références, comme au premier montage — réarmé à 2 après la demande de ce rendu (plus bas) : seule sa fin le lance
    const __remount = this._mjs_mjsInitialized && this._mjs_pendingMount;
    if (__remount) this._mjs_pendingMount = false;
    this._mjs_bindOpen = false;
    // <child-props>
    // première connexion : le premier rendu, demandé plus bas (`_awaits_`), lit toutes les liaisons ; les props reprises ci-dessous
    // (attributs, registre `µ._mjs_pend`, propriétés propres) l'attendent, comme celles d'un composant qui livre des props (plus haut),
    // sans quoi chacune ferait passer sur-le-champ les liaisons qui la lisent (chemin synchrone de _mjs_invalidate), une fois de plus
    if (!this._mjs_mjsInitialized && !this._mjs_render_scheduled) {
      this._mjs_render_scheduled = __kh = true;
      this._mjs_pending          = new Set();
    }
    // </child-props>
    this._mjs_syncProps(void 0, __pend);
    // Props posées par un parent AVANT la mise à niveau : elles n'ont jamais touché
    // l'élément, un registre hors instance les tenait (`µ._mjs_pend`, cf. mjs_init.ts).
    // CHAQUE clé passe par `_set`, dans l'ordre où elle est arrivée : le chemin exact d'un
    // enfant déjà défini quand son parent pose ses props (`node._set(k, v)`, sans filtre).
    // L'état n'est pas l'instance — une clé venue d'une donnée d'exécution (étalement
    // `{...$data}`) y dort sans masquer la méthode du prototype qui porte le même nom court
    // en production, et une prop au nom d'attribut natif (`id`, `title`) arrive comme
    // ailleurs. Vient AVANT la reprise des propriétés propres ci-dessous : ces dernières
    // sont forcément postérieures (`µ._mjs_pend` retire celle qu'il double).
    if (__pend) {
      µ._mjs_pending.delete(this);
      for (const __pk in __pend) {
        this._set(__pk, __pend[__pk]);
      }
      // les dernières valeurs livrées par le parent : sa liaison rejouée sans les changer ne les réécrit pas (cf. µ._mjs_prop, mjs_init.ts)
      this._mjs_pv = this._mjs_pv ? Object.assign(this._mjs_pv, __pend) : __pend;
    }
    this._mjs_bindOpen = true;
    if (this._mjs_var_bits) {
      // Object.keys + for-let-i au lieu de for...in (V8 spécialise mieux).
      const __vbk = Object.keys(this._mjs_var_bits);
      // clés homonymes état/méthode (`_mjs_state_methods`, cf transpiler) :
      // les méthodes du composant vivent SUR L'INSTANCE (fermetures sur les
      // variables internes) ; une clé qui nomme aussi une méthode ne doit pas
      // voir sa FONCTION versée dans l'état — une valeur non-fonction posée
      // par un parent avant l'upgrade, elle, reste sauvée normalement
      const __smn = this._mjs_state_methods;
      for (let __vi = 0, __vln = __vbk.length; __vi < __vln; __vi++) {
        const __k = __vbk[__vi];
        if (this.hasOwnProperty(__k)) {
          if (__smn && __smn[__k] && typeof this[__k] === 'function') { continue; }
          this._set(__k, this[__k]);
          // propriété figée par la page (`Object.defineProperty` sans `configurable`) : on la
          // laisse, un `delete` lèverait et couperait la fin du montage
          const __d = Object.getOwnPropertyDescriptor(this, __k);
          if (__d && __d.configurable) { delete this[__k]; }
        }
      }
    }
    // <child-props>
    // première connexion d'un composant qui livre des props aux composants de sa racine (`_mjs_kb`, generator/compile.ts) : ses props
    // reprises, les leurs leur sont posées avant qu'ils n'entrent dans la page — registre `µ._mjs_pend` d'un enfant pas encore mis à
    // niveau, relu par sa connexion avant son `µawake` — puis son contenu retenu (`_mjs_mount`, mode léger plus haut) y entre, avant que
    // son premier rendu ne soit demandé : les hooks gardent leur ordre. Une liaison qui lève n'arrête rien : le contenu entre, le rendu
    // suit, et ce premier rendu, qui rejoue les liaisons, mène l'erreur au chemin habituel (`_mjs_catchError`, repli `<@failed>`)
    if (this._mjs_kb && !this._mjs_mjsInitialized) {
      try {
        this._mjs_kb();
      } catch {
        // no-op : rejouée par le premier rendu
      }
      if (this._mjs_kf) {
        this._shadow.appendChild(this._mjs_kf);
        this._mjs_kf = null;
        // le rangement des slots se décide à l'entrée du contenu, avant tout rendu : le constructeur n'a vu qu'une ombre vide, et le slot
        // par défaut écrit hors de tout bloc ne partira plus (mjs_slots.ts)
        this._mjs_injectSlots?.();
        // les liens à précharger dès leur apparition (`:preload="on"`) cherchés une fois ce contenu entré, contenu léger de ses enfants
        // compris (cf. µ._mjs_maybeScanEager, mjs_ujs.ts)
        µ._mjs_maybeScanEager?.(this);
      }
    }
    // le rendu retenu pendant la reprise des props (plus haut) part avec le premier, demandé juste après (`_awaits_`)
    if (__kh) this._mjs_render_scheduled = false;
    // </child-props>
    // retire `mjs-loading` ET vide l'enregistrement que ce retrait vient de poser dans le guetteur
    // d'attributs : il se réveillait pour rien, une fois par composant. Un autre attribut changé
    // entre-temps (posé par le parent) est relu ici, comme le guetteur l'aurait fait juste après
    // (retrait sans transition, après celui d'un ancêtre encore caché : µ._mjs_unshield, mjs_init.ts)
    const _dropLoading = () => {
      if (!this._mjs_is_mounted) return;
      µ._mjs_unshield(this, _dropLoading, () => this._mjs_onAttrs(this._mjs_propObserver.takeRecords()));
    };
    this._mjs_invalidate('_awaits_');
    // 2 et non `true` : une écriture faite pendant le rendu de ce retour (la largeur mesurée par une balise qu'il crée) ne lance pas µmount
    // par le chemin synchrone de `_mjs_invalidate`, la fin du rendu en lot le lance, après les références `:this` qu'il repose
    if (__remount) this._mjs_pendingMount = 2;
    // i18n (mjs_i18n.ts, module OPTIONNEL — `µ.i18n` peut être absent si le
    // runtime bundlé n'inclut pas 'i18n') : `_mjs_i18n` posé par le
    // compilateur = [section|null, overrideMode|null]. `µ.i18n._mjs_connect` enregistre le
    // composant et, en mode 'wait' avec fragment pas encore arrivé, gèle le PREMIER rendu
    // (déjà planifié juste au-dessus par `_mjs_invalidate('_awaits_')`) jusqu'à son arrivée —
    // cf. la garde `_mjs_i18n_hold` dans `_mjs_invalidate` — et allonge `_mjs_cssPending` de
    // cette attente. Sa place est ICI, avant la lecture de `_mjs_cssPending` ci-dessous : la
    // retenue de [mjs-loading] doit déjà y trouver l'attente du fragment
    if (this._mjs_i18n && µ.i18n) µ.i18n._mjs_connect(this);
    // Anti-FOUC : _mjs_invalidate schédule le premier render en microtask. La
    // microtask suivante (enchaînée ici) s'exécute APRÈS ce render, on peut
    // donc retirer [mjs-loading] → le composant apparaît déjà rendu.
    //
    // Sauf si `_mjs_applyLayout` (appelé juste au-dessus, SANS await) est
    // parti chercher une feuille partagée en différé : il a alors posé sa promesse
    // sur `_mjs_cssPending` AVANT de rendre la main, et on retient [mjs-loading]
    // jusqu'à ce qu'elle soit adoptée. Sans ça le composant s'afficherait nu le
    // temps d'un aller-retour réseau — exactement le clignotement que le mode
    // paresseux doit éviter. Même retenue pour le gel i18n en mode 'wait' : sa
    // promesse a rejoint `_mjs_cssPending` juste au-dessus (cf. `_mjs_connect`).
    // Hors 'lazy' et hors 'wait', `_mjs_cssPending` est toujours absent et
    // le chemin ci-dessous est celui de toujours, à l'identique.
    const _cssPending = this._mjs_cssPending;
    if (_cssPending) {
      // l'attente traverse des images : l'ombre est stylée cachée, sa sortie fait sous la coupure son premier calcul de style (mjs_init.ts)
      if (!µ.server) µ._mjs_waits(this);
      _cssPending.then(_dropLoading);
    } else {
      queueMicrotask(_dropLoading);
    }
    this._mjs_propObserver ??= new MutationObserver(_mjsAttrsMoved);
    this._mjs_propObserver.observe(this, {
      attributes: true
    });
    if (!this._mjs_mjsInitialized) {
      this._mjs_mjsInitialized = true;
      // µmount différé après le 1er render (cf. mjs_element_int.coffee).
      // Permet aux bindings @this=!{ref} d'être appliqués avant l'appel.
      // Skip ce flag si pas de hook mount déclaré (gain micro mais évite
      // de checker `_mjs_pendingMount` dans chaque _mjs_invalidate fast-path).
      if (typeof this._mjs_hooks?.mount === 'function') {
        this._mjs_pendingMount = true;
      }
    }
    // SSR : les hooks de cycle de vie CLIENT (µawake/µmount) ne s'exécutent
    // PAS côté serveur (µ._isServer posé par renderToString dans happy-dom) ;
    // ils joueront à l'hydratation dans le navigateur, comme onMount de Svelte.
    // file `_mjs_awake_cbs` — même motif que `_mjs_mount_cbs` : la map des hooks
    // n'a qu'UNE case par nom, une rune qui s'y poserait écraserait le `µawake ->`
    // de l'utilisateur. Contrairement à la file de montage, celle-ci n'est PAS
    // vidée : elle rejoue à chaque reconnexion (µevery `pause: true`)
    // <awake>
    if (arrive && !µ._isServer) {
      this._mjs_lifeRun('awake', this._mjs_awake_cbs);
      // retiré par son propre `µawake` : sa déconnexion, jouée pendant le hook, a déjà tout défait ; rien ne s'inscrit après elle
      if (!this.isConnected) return;
    }
    // </awake>
    // <no-awake>
    // if (arrive && !µ._isServer) this._mjs_lifeRun('awake', this._mjs_awake_cbs);
    // </no-awake>
    // Store global statisé (`$$`) — abonnement PAR CLÉ (mjs_store_globals.ts),
    // en miroir de µ._mjs_registerUniversalDep pour les contextes. `_mjs_storeKeys`
    // est posé par le compilateur (liste statique des clés `$$x` lues par CE
    // composant, '*' = énumération de structure). Reposé à CHAQUE (re)connexion
    // (même cycle que le reste de connectedCallback, avant l'inscription au
    // routeur ci-dessous) : survit à awake/sleep, symétrique de
    // µ._mjs_storeUnsubscribe en disconnectedCallback.
    // garde `typeof` : `vault`/mjs_store_globals.ts est un module OPTIONNEL — un
    // composant peut lire `$$x` (donc porter `_mjs_storeKeys`) alors que le projet a
    // omis 'vault' de son `runtime` explicite ; sans la garde, TypeError à CHAQUE connexion.
    if (this._mjs_storeKeys && this._mjs_storeKeys.length > 0 && typeof µ._mjs_storeSubscribe === 'function') {
      µ._mjs_storeSubscribe(this, this._mjs_storeKeys);
    }
    // <ledger>
    // rentré dans la page : le composant rejoint le carnet de chaque objet qu'il tient (cf. _mjsLedgerPage)
    _mjsLedgerPage(this, true);
    // </ledger>
    // i18n : `µ.i18n._mjs_connect(this)` se fait plus haut, avant la lecture de `_mjs_cssPending`
    if (this._mjs_is_router_aware && arrive) µ.Router?.register?.(this);
  }

  // nom d'attribut, ou clé de `mjs-props` (cf. connectedCallback) → clé de la prop (`user-id` → `userId`) ; null s'il n'en désigne
  // jamais une. Skip : préfixes MJS internes, attributs natifs HTML, et conventions
  // ARIA/data-* (gérés par le browser, jamais exposés comme props).
  // EXCEPTION : si l'attribut natif (`title`, `src`, `name`, …) correspond
  // à une prop DÉCLARÉE du composant (`_mjs_var_bits`), c'est une vraie prop
  // — le browser pose aussi l'attribut natif mais le composant veut la
  // valeur dans `_state` (cas `<mjs-audio-player title="…">`).
  // <layout-variable>
  // attribut `layout` / `template` qui choisit un modèle de style ; nul quand le composant déclare la variable du même nom, son état à
  // lui (même garde que `_set`), sauf s'il lit µlayout
  _mjs_layAttr(k) {
    return this._mjs_lay || !(this._mjs_var_bits && hasProp.call(this._mjs_var_bits, k)) ? this.getAttribute(k) : null;
  }
  // </layout-variable>

  _mjs_propKey(name) {
    const _nameL = name.toLowerCase();
    let key = name.replace(/-([a-z])/g, function(g) {
      return g[1].toUpperCase();
    });
    let _isDeclaredProp = this._mjs_var_bits != null
      && hasProp.call(this._mjs_var_bits, key);
    // le nom d'attribut et la prop déclarée se comparent sans la casse, comme tout nom d'attribut HTML : écrits en clair, `tabIndex="3"` et `userName="u"`
    // arrivent en minuscules (`tabindex`, `username`), ils vont aux props déclarées `$tabIndex` et `$userName`, sous leur nom. Vers une prop déclarée
    // seulement : un nom sans prop de ce nom reste tel quel, et la prop au nom exact passe devant (`$username` et `$userName` déclarées : `username` va à
    // `$username`). Un nom à tiret n'a pas d'égal parmi les props (`user-name` est déjà `userName`, `data-*` et `aria-*` n'en sont pas)
    if (!_isDeclaredProp && this._mjs_var_bits != null && _nameL.indexOf('-') < 0) {
      for (const k in this._mjs_var_bits) {
        if (k.length === _nameL.length && k.toLowerCase() === _nameL && hasProp.call(this._mjs_var_bits, k)) {
          key = k;
          _isDeclaredProp = true;
          break;
        }
      }
    }
    if (name.startsWith('mjs-')
        || (MJS_NATIVE_ATTRS.has(_nameL) && !_isDeclaredProp)
        || _nameL.startsWith('aria-')
        || _nameL.startsWith('data-')
        // Anti-`onclick` ciblé : seulement les VRAIS handlers DOM (présents
        // sur le prototype). L'ancien `startsWith('on')` avalait aussi des
        // props légitimes : `online`, `onboarding-step`, `onyx-color`…
        || (_nameL.startsWith('on') && (_nameL in HTMLElement.prototype))) {
      return null;
    }
    return key;
  }

  // `only` : les seuls attributs à relire (ceux qui ont bougé, cf. `_mjs_onAttrs`) ; absent, tous au montage, et à une
  // reconnexion ceux dont le texte a changé depuis leur dernière lecture. `deja` : les props que le parent a posées TYPÉES dans le registre, relu par connectedCallback
  // (au montage seulement) : leur attribut, reflet texte ou posé par le rendu serveur, n'est pas relu
  _mjs_syncProps(only, already) {
    var attr, j, key, len, parsed, ref, results, schema;
    schema = this.constructor.props || {};
    // une copie : un `_set` qui ôte un attribut pendant la lecture (la prop `readonly` d'un module du cœur relue fausse) ne décale plus la liste
    ref = [...this.attributes];
    results = [];
    for (j = 0, len = ref.length; j < len; j++) {
      attr = ref[j];
      if (only && !only.has(attr.name)) continue;
      key = this._mjs_propKey(attr.name);
      if (key === null) continue;
      // le dernier texte lu, noté par l'élément sous le nom de l'attribut (table posée au premier attribut qui va à une prop) ; pas sur le nœud de
      // l'attribut : WebKit oublie ce qui y est noté quand son ramasse-miettes le reprend. À une reconnexion (ligne déplacée, page remise par le cache des pages, rechargement à chaud), un attribut au texte
      // inchangé n'est pas relu — il rendait sa valeur de départ à la prop que le composant a écrite depuis ; changé pendant l'absence,
      // il est relu. Noté aussi quand le registre le saute (ci-dessous) : la reconnexion ne le prend pas pour neuf
      const __read      = this._mjs_read ??= Object.create(null);
      const __unchanged    = __read[attr.name] === attr.value;
      __read[attr.name] = attr.value;
      // relu en chaîne, 7 deviendrait "7" chez l'enfant, puis chez le parent par la liaison à deux sens
      if ((already && hasProp.call(already, key)) || (__unchanged && !only && this._mjs_mjsInitialized)) continue;
      parsed = _mjsParseProp(schema, key, attr.value);
      // l'attribut n'est que le REFLET texte de la prop courante (le module `option` pose
      // `value="18"` pour `value={18}`, et cet observateur le relit aussitôt) : le relire
      // remplaçait le nombre ou le booléen posé par le parent par son texte
      const __cur = this._state[key];
      if (__cur !== parsed && (typeof __cur === 'number' || typeof __cur === 'boolean' || typeof __cur === 'bigint') && String(__cur) === attr.value) {
        results.push(void 0);
        continue;
      }
      if (this._state[key] !== parsed) {
        this._set(key, parsed);
        // <layout-variable>
        if ((key === 'template' || key === 'layout') && this._mjs_layAttr(key) != null) {
        // </layout-variable>
        // <no-layout-variable>
        // if (key === 'template' || key === 'layout') {
        // </no-layout-variable>
          results.push(this._mjs_applyLayout(attr.value));
        } else {
          results.push(void 0);
        }
      } else {
        results.push(void 0);
      }
    }
    return results;
  }

  // seuls les attributs qui ont bougé sont relus : relire les autres rendait leur valeur de
  // départ aux props écrites depuis (µmount, liaison qui remonte de l'enfant) — le simple retrait
  // de `mjs-loading`, juste après le premier rendu, y suffisait (et celui de `mjs-appearing`, après le premier calcul de style)
  _mjs_onAttrs(records) {
    var names = new Set(), i, a;
    for (i = 0; i < records.length; i++) if ((a = records[i].attributeName) !== 'mjs-loading' && a !== 'mjs-appearing') names.add(a);
    if (names.size) this._mjs_syncProps(names);
  }

  disconnectedCallback() {
    var e, err, j, len, marks, ref, ref1, ref2, ref3, ref4, refs, td, unsub;
    // <wake-up>
    // sortie de la page avant son réveil (`@wake`, mjs_wake.ts) : rien n'était construit, seul son déclencheur est retiré
    if (this._mjs_wakeCalls) return µ._mjs_wakeGone(this);
    // </wake-up>
    this._mjs_is_mounted = false;
    // topologie changée (déconnexion) : invalide + purge (ne pas retenir des
    // références d'ancêtres morts)
    µ._mjs_rctxEpoch++;
    this._mjs_rctx_cache = null;
    // `_mjs_dead` n'était posé QUE par le walk
    // interne `_mjs_destroyNodeAndChildren` (retrait via un bloc {if}/{for} du
    // PARENT) — un composant déconnecté par un autre chemin (ex. `el.remove()`
    // direct depuis du code utilisateur) ne l'avait jamais. Le poser ICI,
    // inconditionnellement, fiabilise tout nettoyage paresseux basé sur ce
    // flag (ex. `_mjs_notifyInvalidators` de µspring/µ.interpolate, mjs_spring.ts/
    // mjs_interpolate.ts) quel que soit le chemin de déconnexion.
    this._mjs_dead = true;
    if ((ref = this._mjs_propObserver) != null) {
      ref.disconnect();
    }
    if (this._mjs_is_router_aware) {
      if ((ref1 = µ.Router) != null) {
        if (typeof ref1.unregister === "function") {
          ref1.unregister(this);
        }
      }
    }
    // connexion suivante : chaque balise redevient à attacher (`_mjs_att` périmé), le rendu de la
    // reconnexion repose les `@attach` dont le nettoyage tourne juste en dessous
    this._mjs_ae++;
    // <attached>
    if (this._mjs_attachments) {
      ref2 = this._mjs_attachments;
      for (td of ref2) {
        // une référence `@this` reste dans la liste : elle se vide en dernier, au retrait pour de bon (cf. la fin de la méthode) —
        // `µsleep`, `µdestroy` et le nettoyage de `µmount` la lisent encore, un composant seulement déplacé la garde
        if (td._mjs_ref) { (refs || (refs = [])).push(td); continue; }
        ref2.delete(td);
        try { td(); } catch (e) { µ.warn(µ._mjs_msg('elTeardown', null, ':attach/:this teardown en erreur :'), e); }
      }
      // les td ci-dessus s'exécutent UNE fois,
      // mais chaque nœud garde son marqueur `_mjs_td` (le Set ne
      // contient que des fonctions, pas les nœuds). Au reconnect (déplacement
      // DOM), le full re-render passe par `attachLogic` qui, voyant le marqueur
      // truthy, RAPPELLE le teardown déjà exécuté (2e fois, sans setup
      // intercalé) → casse un teardown non idempotent (unsubscribe compté,
      // observer.disconnect, socket.close). On NULLE donc les marqueurs (td déjà
      // lancés) en balayant le shadow — uniquement quand des attachments
      // existent, donc coût nul pour les composants sans @attach/@this.
      if (this._shadow && this._shadow.querySelectorAll) {
        const __ann = this._shadow.querySelectorAll('*');
        for (let __ai = 0, __aln = __ann.length; __ai < __aln; __ai++) {
          const __ael = __ann[__ai];
          if (__ael._mjs_td) __ael._mjs_td = null;
          // la marque d'une référence reste sur sa balise, qu'un bloc qui la retire vide encore la référence ; effacée au retrait
          // pour de bon (cf. la fin de la méthode) — les siennes seulement : le balayage traverse aussi le contenu d'un enfant
          // léger, qui peut avoir été sorti juste avant (`p.remove(); ailleurs.append(enfant)`) et garde ses propres marques
          if (__ael._mjs_ref_td && ref2.has(__ael._mjs_ref_td)) (marks ||= []).push(__ael);
        }
      }
      // la marque d'une attache posée par le parent sur ce composant ; celle de sa référence (`_mjs_ref_td`) reste, comme ci-dessus
      if (this._mjs_td) this._mjs_td = null;
    }
    // </attached>
    if (this._mjs_store_unsubs) {
      ref3 = this._mjs_store_unsubs;
      for (unsub of ref3) {
        unsub();
      }
      this._mjs_store_unsubs.clear();
    }
    // <signals>
    // retiré de la page pour de bon (toujours hors de la page à la microtâche suivante, hors du cache des pages) : ses reffets quittent le
    // graphe des signaux, qu'une boîte partagée (miroir) ou lue par un autre ne le retienne pas ; un simple déplacement les garde. Revenu
    // plus tard dans la page, chaque reffet suit son relevé de la construction
    if (this._mjs_sigNodes) {
      const __that = this;
      queueMicrotask(() => {
        if (!__that.isConnected && !(µ._mjs_isPageCached && µ._mjs_isPageCached(__that))) µ._mjs_sigDrop(__that, 1);
      });
    }
    // </signals>
    if (this._mjs_effects) {
      ref4 = this._mjs_effects;
      for (j = 0, len = ref4.length; j < len; j++) {
        e = ref4[j];
        // effacé : au reconnect, `_mjs_runEffectsV2` rappelle le nettoyage avant
        // de re-fire l'effet → le teardown tournait DEUX fois (faux pour une
        // désinscription comptée). Effacé AVANT d'être joué : un retrait du reffet
        // demandé depuis ce nettoyage (mjs_effect.ts) ne le rejoue pas
        var __cl = e.cleanup;
        e.cleanup = null;
        try {
          if (__cl) __cl.call(e);
        } catch (error1) {
          err = error1;
          µ.warn("Cleanup error on unmount:", err);
        }
      }
    }
    // Nettoyage des abonnements universels (µ.state — contextes §§). Garde
    // défensive (même patron que le nettoyage i18n juste en dessous) :
    // `mjs_runes.ts` reste aujourd'hui du cœur, jamais retiré — un composant
    // ne doit pourtant jamais planter à la déconnexion si un cœur futur s'en
    // passait.
    if (typeof µ._mjs_cleanupUniversalDeps === "function") { µ._mjs_cleanupUniversalDeps(this); }
    // Nettoyage des abonnements au store global statisé (`$$`, mjs_store_globals.ts,
    // module OPTIONNEL — appelé pour TOUT composant, même sans `$$`, garde requise) : sans la
    // garde, un projet dont `runtime` explicite omet 'vault' plantait à CHAQUE déconnexion.
    if (typeof µ._mjs_storeUnsubscribe === "function") { µ._mjs_storeUnsubscribe(this); }
    // <ledger>
    // sorti de la page : le carnet ne le garde plus, ses objets restent notés pour son retour (cf. _mjsLedgerPage)
    _mjsLedgerPage(this, false);
    // </ledger>
    // Nettoyage du registre i18n (mjs_i18n.ts, module OPTIONNEL).
    if (µ.i18n && this._mjs_i18n) { µ.i18n._mjs_unmount(this); }
    // file `_mjs_sleep_cbs` — symétrique de `_mjs_awake_cbs`, jamais vidée, et
    // gardée côté SERVEUR comme elle : ce que suspend une rune n'existe qu'au
    // navigateur (le hook `µsleep` n'a pas cette garde, par héritage — on ne la reprend pas ici). Pas après une connexion
    // jouée hors du document (cf. connectedCallback) : elle n'a pas joué `µawake`
    if (this._mjs_arrive) this._mjs_lifeRun('sleep', this._mjs_sleep_cbs);
    // ---- Destruction DIFFÉRÉE — fix critique : `onDestroy` (où vivent le
    // hook utilisateur `@destroy` et les callbacks `_mjs_onDestroy`) n'était
    // JAMAIS invoqué par le runtime. Un déplacement DOM synchrone
    // (réordonnancement de liste, appendChild ailleurs) déclenche
    // disconnect+connect dans le même tick → on ne détruit qu'au microtask
    // suivant, si TOUJOURS déconnecté. Les sous-arbres parqués par le
    // pageCache d'ujs (hibernation, réinsérés tels quels) sont exemptés.
    if ((typeof this._mjs_hooks?.destroy === 'function' || this._mjs_destroy_cbs) && !this._mjs_destroy_scheduled) {
      this._mjs_destroy_scheduled = true;
      const __self = this;
      queueMicrotask(() => {
        __self._mjs_destroy_scheduled = false;
        if (__self.isConnected) return;
        // garde défensive (même patron que µ._mjs_cleanupUniversalDeps ci-dessus) :
        // `_mjs_isPageCached` vit dans mjs_init.ts, cœur strict jamais retiré aujourd'hui — rien à
        // rattraper en pratique, mais un composant ne doit jamais planter à sa destruction
        // différée si un cœur futur s'en passait.
        if (typeof µ._mjs_isPageCached === "function" && µ._mjs_isPageCached(__self)) return;
        __self._mjs_runDestroyCallbacks();
      });
    }
    // <attached>
    // les références `@this`, après la destruction différée ci-dessus. Un composant seulement déplacé (reconnecté dans le même tour)
    // garde les siennes, inscrites dans sa liste et marquées sur leurs balises, comme s'il n'avait pas bougé ; retiré pour de bon,
    // chacune quitte la liste et se vide, et sa balise perd sa marque
    if (refs) {
      const __me = this;
      queueMicrotask(() => {
        if (__me.isConnected) return;
        // <page-cache>
        // page mise en mémoire par le cache des pages : ses références restent, comme sa destruction est sautée — ses minuteries
        // tournent toujours et les lisent ; vidées quand elle quitte la mémoire (µ._mjs_destroyEvictedTree, mjs_page_cache.ts)
        if (µ._mjs_isPageCached?.(__me)) return;
        // </page-cache>
        for (const __td of refs) {
          ref2.delete(__td);
          try { __td(); } catch (e) { µ.warn(µ._mjs_msg('elTeardown', null, ':attach/:this teardown en erreur :'), e); }
        }
        if (marks) for (const __el of marks) __el._mjs_ref_td = null;
      });
    }
    // </attached>
  }

  // hook µawake / µsleep de l'utilisateur, puis la file des runes (au navigateur seulement) : chacun
  // sous son try — une erreur ne sort jamais de connectedCallback / disconnectedCallback (sinon
  // `el.remove()` levait chez l'appelant et la suite, destruction différée comprise, n'avait pas
  // lieu : µevery tournait après le retrait), et n'empêche pas les suivants de tourner
  _mjs_lifeRun(name, cbs) {
    for (const fn of [this._mjs_hooks?.[name], ...(!µ._isServer && cbs || [])]) {
      try { fn?.call(this); } catch (e) { µ.warn(µ._mjs_msg('lifeRun', { name }, 'hook µ{name} en erreur :'), e); }
    }
  }

  // `_mjs_runDestroyCallbacks` (exécution effective du teardown définitif, appelée
  // par la destruction différée ci-dessus ET par µ._mjs_destroyEvictedTree —
  // mjs_page_cache.ts, appel déjà gardé `typeof` là-bas) vit désormais dans
  // src/runtime/mjs_lifecycle.ts, avec le reste des crochets de cycle de vie.

  // ==========================================
  // ROUTAGE DES ÉVÉNEMENTS
  // ==========================================
  // V2 — routing événementiel sans attributs DOM.
  //
  // Avant : chaque élément avec un handler portait `mjs-id="..."`, et le
  // routeur faisait `e.target.closest('[mjs-id]')` + `getAttribute('mjs-id')`.
  //
  // Maintenant : chaque balise qui porte un gestionnaire mène par `_mjs_ev` à la table de son bloc (posée par `_mjs_registerRefs` :
  // le composant qui l'a écrite et ses identifiants). Le routage remonte `parentNode` depuis la cible jusqu'à une balise dont la
  // table appartient à ce composant, et s'arrête à l'ombre.
  _mjs_bindEvents(routes, passive) {
    // <server-input>
    // les routes du composant, où la liaison d'un champ porte sa marque (cf. _mjsTypedPut)
    this._mjs_rt = routes;
    // </server-input>
    // Skip IIFE: les arrow fns capturent déjà `evt`/`map` via closure
    // locale du let. Économise N allocs IIFE par composant + 1 frame de stack.
    // Skip `for...in` au profit de Object.keys (V8 spécialise mieux).
    const root = this._shadow;
    const events = Object.keys(routes);
    // Auto-passive : les types listés (touch/wheel sans preventDefault) sont
    // enregistrés `passive` → le navigateur scrolle sans attendre le handler.
    const passiveSet = passive ? new Set(passive) : null;
    // la phase où l'événement se route : un événement qui remonte l'est à la remontée, comme un écouteur posé sur
    // la balise (un `stopPropagation()` natif d'un descendant arrête nos gestionnaires, `.stop` ne prive jamais la
    // cible des siens, l'enfant joue avant la balise que son parent a posée) ; à la capture (1), celui qui ne
    // remonte pas (focus, blur, load, scroll, un événement envoyé sans `bubbles`…), qu'une écoute à la remontée ne
    // verrait jamais, et `submit` : un envoi retenu (`@submit.prevent`) ne part jamais, même quand un écouteur de la
    // page coupe l'événement sur le formulaire. Celui qui naît dans du contenu glissé (2), chez nous ou chez un
    // enfant, est lu à la capture et routé une fois sa cible atteinte, après les écouteurs de celle-ci (un
    // `stopPropagation()` natif posé sur elle arrête nos gestionnaires, `.stop` ne la prive pas des siens, un
    // composant glissé joue avant le gestionnaire que son auteur pose sur sa balise) : son auteur joue avant le
    // cadre qui le reçoit (le bouton glissé qui a son gestionnaire joue seul)
    const cap = (e) => {
      if (!e.bubbles || e.type === 'submit') return 1;
      // glissé, notre balise chez un enfant ou celle d'un autre chez nous : entre la cible et notre racine, un ancêtre
      // est un hôte à ombre (fermée chez MJS, où `assignedSlot` ne dit rien)
      for (let n = e.target.parentNode; n && n !== root; n = n.parentNode) {
        if (n.shadowRoot || n._mjs_isLight === false) return 2;
      }
      return 0;
    };
    for (let __ei = 0, __eln = events.length; __ei < __eln; __ei++) {
      const evt = events[__ei];
      const map = routes[evt];
      // entrée/sortie de survol : le vrai pointeur se lit sur le jumeau qui remonte (Chromium ne les
      // présente même pas à cette racine, sauf écouteur ailleurs dans la page) ; celles qu'un code
      // fabrique (`dispatchEvent`) gardent le routeur ordinaire, ci-dessous
      // (table et routeur dans mjs_boundary.ts, absents d'un projet sans ces événements : routeur ordinaire)
      const __be = this._mjs_boundaryEvents;
      const boundary = __be && hasProp.call(__be, evt);
      if (boundary) root.addEventListener(__be[evt], (e) => this._mjs_routeBoundary(evt, map, e), true);
      const step = !!passiveSet && passiveSet.has(evt);
      // un seul routeur par type, posé aux deux phases de la racine : chaque événement n'y est routé qu'une fois,
      // dans la sienne ; le contenu glissé, sur sa cible, derrière ses écouteurs (rien si l'un d'eux a coupé la
      // propagation) — `p`, le chemin lu à la capture : vu de la cible, l'intérieur fermé du cadre n'y figure plus
      const route = (e, p) => {
        if (!p) {
          let c;
          if (boundary && e.isTrusted || (e.eventPhase === 1) !== (c = cap(e)) > 0) return;
          if (c > 1) {
            p = e.composedPath();
            e.target.addEventListener(evt, (x) => x === e && !e.cancelBubble && route(e, p), { once: true, passive: step });
            return;
          }
        }
        let t = e.target;
        // contenu glissé dans un de nos slots : ses nœuds sont ceux du composant qui l'a écrit, et leurs
        // identifiants de routage (`e1`, `e2`… numérotés par composant) tomberaient sur les nôtres —
        // jamais lus ici. L'événement nous arrive par le slot : la remontée reprend là, sauf si un
        // gestionnaire du contenu glissé l'a déjà pris sans `.propagate` (mode léger : pas de slot)
        if (t && root !== this && t.getRootNode() !== root) {
          t = this._mjs_slotEntry?.(e, true, p);
          if (!t) return;
        }
        // un effet retient l'événement de sa balise avant ses liaisons et ses gestionnaires (*guard :
        // une valeur hors de la règle ne part pas dans la variable)
        if (t && t._mjs_hold && t._mjs_hold(e)) return;
        const __inline = this._mjs_inline;
        while (t && t !== root) {
          // la table de la balise (`_mjs_ev` : celle de sa ligne ou de son bloc, cf. `_mjs_registerRefs`), lue pendant la remontée : sa
          // description dit le composant qui l'a écrite et ses identifiants ; ceux qui désignent la balise sont les siens. Sans ombre pour
          // séparer deux composants (un léger posé chez nous, ou ce que nous lui confions), leurs nœuds se côtoient : on ne lit que ceux
          // que NOUS avons écrits
          const r = t._mjs_ev;
          const d = r && r._mjs_reg;
          if (d && d.o === this) {
            const ids = d.ids;
            // une balise peut porter plusieurs identifiants (événement + liaison de boucle) : on essaie chacun, dans l'ordre de la
            // table ; le 1er qui a un gestionnaire dans `map` gagne
            for (let i = 0, len = ids.length; i < len; i++) {
              if (r[ids[i]] !== t) continue;
              const slot = map[ids[i]];
              if (slot !== void 0) {
                // Route : `idx` (nombre) = handler simple ; `[idx, flags]` =
                // handler + bitmask (bit 0 `.propagate` — le routeur poursuit
                // sa remontée ; bit 1 `.once`) ; `[[idx, flags], …]` =
                // PLUSIEURS handlers sur le même couple (événement, nœud).
                //
                // Le 3ᵉ cas est le correctif : une liaison
                // two-way et une directive `@événement` qui reposent sur le
                // même événement du même élément (`<input value=!{$x}
                // @input={…}>`) partagent un id de routage — l'une écrasait
                // l'autre EN SILENCE côté compilateur. Elles s'exécutent
                // maintenant TOUTES, dans l'ordre émis : liaisons d'abord,
                // pour que la directive lise la variable déjà à jour.
                const list = (typeof slot === 'number' || typeof slot[0] === 'number') ? null : slot;
                const nh = list ? list.length : 1;
                let ran = false, propagate = false;
                for (let k = 0; k < nh; k++) {
                  const one = list ? list[k] : slot;
                  let fnIdx, once = false;
                  if (typeof one === 'number') {
                    fnIdx = one;
                  } else {
                    fnIdx = one[0];
                    const fl = one[1] | 0;
                    if ((fl & 1) !== 0) propagate = true;
                    once = (fl & 2) !== 0;
                  }
                  const fnWrapper = __inline[fnIdx];
                  if (typeof fnWrapper !== 'function') continue;
                  // `.once` PAR NŒUD (sémantique `{ once: true }` native) :
                  // l'ancien `delete map[id]` supprimait la route par id
                  // COMPILE-TIME, partagé par toutes les rows d'un {for} → le
                  // premier clic sur n'importe quelle row désarmait toutes les
                  // autres (et les futures). WeakMap<nœud, Set<clé>> : le nœud
                  // mort libère son entrée. Clé par handler quand le couple en
                  // porte plusieurs — un `.once` ne désarme pas son voisin.
                  if (once) {
                    // le TYPE d'événement fait partie de la clé : deux `.once` distincts sur
                    // le même nœud (ex. `@click.once` et `@keydown.once`) partagent le même id
                    // de routage — sans `evt`, le premier type déclenché désarmait aussi l'autre.
                    const onceKey = evt + ':' + (list ? ids[i] + '#' + k : ids[i]);
                    this._mjs_once_fired ||= new WeakMap();
                    let __fired = this._mjs_once_fired.get(t);
                    if (__fired && __fired.has(onceKey)) continue;
                    if (!__fired) { __fired = new Set(); this._mjs_once_fired.set(t, __fired); }
                    __fired.add(onceKey);
                  }
                  // Expose l'élément matché via `e.currentTarget` (sémantique
                  // DOM standard / parité Svelte-React) — sinon `e.currentTarget`
                  // = le shadow root (le listener délégué est posé dessus) →
                  // `e.currentTarget.getBoundingClientRect()` échoue. Le 2e arg
                  // `t` reste aussi disponible. Cas vécu : seek slider audio-player.
                  try { Object.defineProperty(e, 'currentTarget', { value: t, configurable: true }); } catch { /* event read-only */ }
                  // passage de ce gestionnaire, rendu à sa fin même s'il lève : un événement routé imbriqué ouvre le
                  // sien puis rend la main ; la fonction de retrait d'un `µon` posé pendant ce passage en porte la
                  // marque (mjs_on.ts)
                  var __prev = µ._mjs_evPass, __pass = µ._mjs_evPass = {};
                  // <signals>
                  // un gestionnaire ne lit pour aucun calcul en cours : déclenché pendant le passage d'un reffet (clic, focus, `µemit`), ses
                  // lectures sont les siennes, jamais celles du reffet (sinon un gestionnaire qui cumule le relançait sans fin)
                  var __sig = µ._mjs_sigCur;
                  µ._mjs_sigCur = null;
                  // </signals>
                  try {
                    const result = fnWrapper.call(this, e, t);
                    // fonction rendue (forme `@click={save}`) appelée, sauf une fonction marquée née dans ce passage : retrait
                    // d'un `µon` (`@click={$brancher()}`, l'écouteur que ce gestionnaire vient de poser reste), main d'arrêt d'un
                    // `µafter` ou d'un `µevery` (`@click={tard(e)}`, la minuterie qu'il vient de lancer part)
                    if (typeof result === 'function' && result._mjs_born !== __pass) {
                      result.call(this, e, t);
                    }
                    // une promesse rendue, sur une balise qu'un effet `on: success|error` écoute (mjs_fx.ts)
                    else if (result && t._mjs_fxResult && typeof result.then === 'function') {
                      t._mjs_fxResult(result);
                    }
                  } finally {
                    µ._mjs_evPass = __prev;
                    // <signals>
                    µ._mjs_sigCur = __sig;
                    // </signals>
                  }
                  // Restaure le getter natif de currentTarget — même obligation
                  // que dans _mjs_on : l'event POURSUIT sa propagation et un
                  // listener tiers en aval lisait notre valeur figée.
                  try { delete e.currentTarget; } catch { /* read-only */ }
                  ran = true;
                }
                // Aucun handler exécutable sous cet id → on tente l'id suivant.
                if (!ran) continue;
                // `.stop` (e.stopPropagation) pose `cancelBubble` → on coupe
                // la remontée du routeur, y compris après un `.propagate`.
                // Vérifié APRÈS la liste : `stopPropagation` n'a jamais coupé
                // les autres listeners du MÊME nœud (c'est le rôle de
                // `stopImmediatePropagation`), on reste sur la sémantique DOM.
                if (e.cancelBubble) {
                  // les écouteurs posés après nous sur la racine (`µon`, la navigation) ne jouent pas non plus ;
                  // méthode native : la navigation surveille celle de l'événement, et elle est relancée juste en dessous
                  Event.prototype.stopImmediatePropagation.call(e);
                  // ce qui attendait la remontée (la navigation d'un lien, pont shadow de mjs_ujs.ts) ne
                  // la verra jamais : elle joue ici, gestionnaires déjà joués, sauf action prévenue
                  if (e._mjs_afterStop !== void 0 && !e.defaultPrevented) e._mjs_afterStop(e);
                  return;
                }
                // Handler normal : le nœud le plus proche gagne → on s'arrête, et le composant qui
                // affiche ce nœud dans un de ses slots le saura (`_mjs_slotEntry`).
                if (!propagate) {
                  e._mjs_taken = t;
                  return;
                }
                // `.propagate` : on sort des ids de CE nœud et on laisse le
                // `while` remonter vers l'ancêtre suivant.
                break;
              }
            }
          }
          t = t.parentNode;
          // Si parentNode traverse une frontière ShadowRoot, on s'arrête.
          if (t && t.nodeType === 11) break;
        }
      };
      for (const capture of [true, false]) root.addEventListener(evt, route, { capture, passive: step });
      // la navigation (mjs_ujs.ts, absente d'un projet sans elle) lit le lien et l'envoi à la remontée sur cette
      // même racine, une fois nos gestionnaires joués (`@click.prevent` la retient) : son écouteur repasse après nous
      µ._mjs_ujsLate?.(root, evt);
    }
  }

  // ==========================================
  // GESTION OPTIMISÉE DES STYLES
  // ==========================================
  // Renommée `_applyTemplate` → `_mjs_applyLayout` : ce mécanisme n'a jamais posé
  // de gabarit, il charge une feuille de style — un variant de FORME
  // (grille, ordre, masquage), jamais de couleurs (variables `$$` d'un `<theme>`).
  async _mjs_applyLayout(name = 'default') {
    var sheet, sheets, tag;
    sheets = [];
    // un fetch de variant lent ne doit pas écraser une bascule demandée APRÈS lui
    const _seq = (this._mjs_layoutSeq = (this._mjs_layoutSeq || 0) + 1);
    if (µ._mjs_shield) {
      // Shield FOUC : la même instance µ._mjs_shield est adoptée dans chaque
      // Shadow DOM pour que ses règles (`:not(:defined)` + `[mjs-loading]`)
      // atteignent les modules imbriqués — les règles du document ne
      // traversent pas les frontières Shadow DOM.
      sheets.push(µ._mjs_shield);
    }
    if (µ.CSS['mjs_reset']) {
      sheets.push(µ.CSS['mjs_reset']);
    }
    // THÈMES DE DOCUMENT dans un shadow (mesuré au navigateur) — une feuille du
    // DOCUMENT ne franchit pas la frontière shadow : seules les valeurs HÉRITÉES la traversent.
    // Sans les deux lignes ci-dessous, un `<div theme="sombre">` écrit DANS un composant ne
    // matchait AUCUNE règle — et comme une appli MJS n'est faite que de composants, « poser un
    // thème sur une section » ne marchait en pratique que dans le HTML de la page. Les deux
    // feuilles sont des instances PARTAGÉES (jamais recopiées) : le coût est une entrée de plus
    // dans adoptedStyleSheets. Elles passent AVANT le style du composant, qui garde le dernier
    // mot chez lui ; sur l'hôte lui-même rien ne change, la règle du document continue de primer
    // sur une règle de shadow (critère d'encapsulation, mesuré au navigateur).
    if (µ._mjs_themeSheet) {
      sheets.push(µ._mjs_themeSheet);
    }
    if (µ._mjs_themeAppSheet) {
      sheets.push(µ._mjs_themeAppSheet);
    }
    var inheritedNames = µ._mjs_inheritedCss(this);
    // Mode `css: 'lazy'` : les feuilles partagées ne sont pas dans le
    // bundle, ce sont des `.css` hachés dont l'URL vit au manifeste. `µ._mjs_lazyCssWait`
    // (mjs_lazy_css.ts, joint seulement dans ce mode) rend la promesse des feuilles encore
    // absentes, ou `null` : on les attend AVANT d'adopter quoi que ce soit, pour que la
    // cascade reste celle de toujours (feuilles héritées, puis déclarées, puis le style du
    // composant, qui garde le dernier mot). Le composant est caché pendant ce temps par
    // `[mjs-loading]`, posé au connectedCallback et retenu par `_mjs_cssPending` : il
    // apparaît habillé, jamais nu. Hors 'lazy', la fonction n'existe pas : le bloc coûte un
    // test et rien d'autre, sans le moindre `await`.
    var __lw = µ._mjs_lazyCssWait && µ._mjs_lazyCssWait(this, inheritedNames);
    if (__lw) {
      this._mjs_cssPending = __lw;
      await __lw;
      this._mjs_cssPending = null;
      // même garde de fraîcheur que le variant plus bas : une bascule demandée
      // PENDANT le chargement doit gagner
      if (_seq !== this._mjs_layoutSeq) { return; }
    }
    // feuilles nommées, héritées puis déclarées par le composant : celles du registre sont poussées dans cet ordre (les
    // feuilles extérieures en premier, pour que les styles locaux du composant puissent les surcharger). Une feuille
    // CONNUE du mode paresseux n'est pas orpheline : elle est simplement différée (et absente au rendu serveur, par
    // construction) — c'est `µ._mjs_fetchLazyCss` qui parle quand son fichier manque vraiment
    const named = (names, orphan) => {
      for (const sheetName of names) {
        if (µ.CSS[sheetName]) {
          sheets.push(µ.CSS[sheetName]);
        } else if (!(µ._cssLazy && µ._cssLazy[sheetName])) {
          orphan(sheetName);
        }
      }
    };
    named(inheritedNames, (sheetName) => µ.warn(µ._mjs_msg('elOrphanInherited', { sheetName: sheetName }, 'Orphelin CSS hérité : La feuille \'{sheetName}\' est absente du registre.')));
    if (this._mjs_sharedCss) {
      named(this._mjs_sharedCss, (sheetName) => µ.warn(µ._mjs_msg('elOrphanLocal', { sheetName: sheetName }, 'Orphelin CSS local : La feuille \'{sheetName}\' est introuvable.')));
    }
    const css = this._mjs_baseCss;
    const hasCss = css && css.trim() !== "";
    if (hasCss) {
      tag = this.tagName.toLowerCase();
      // une feuille par texte, partagée par toutes les instances
      sheet = (µ._mjs_componentStyleCache ??= new Map()).get(css);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        µ._mjs_componentStyleCache.set(css, sheet);
      }
      sheets.push(sheet);
      // Index PAR TAG de la feuille adoptée (rechargement CSS à chaud en dev,
      // cf. µ._hotCss dans mjs_hotcss.ts) — s'AJOUTE au cache par texte
      // ci-dessus sans le modifier (zéro régression prod, byte-safe).
      (µ._mjs_componentStyleByTag ??= new Map()).set(tag, sheet);
    }
    // Mode `mjs-light` : HTMLElement n'a pas `adoptedStyleSheets`. On émet le
    // CSS du composant comme un <style> inline injecté dans le head global
    // (avec déduplication via cache). Le CSS hérité (Bootstrap, vars CSS,
    // thèmes) marche déjà via cascade naturelle, on n'a qu'à injecter le
    // baseCss du composant lui-même.
    if (this._mjs_isLight) {
      // Garde-fou — un light IMBRIQUÉ vit DANS le vrai shadow d'un ancêtre :
      // document.head ne franchit JAMAIS cette frontière (encapsulation Shadow DOM), la feuille
      // doit rejoindre CE shadow-là. Même idiome que le reste du fichier (`getRootNode().host`)
      // pour détecter le shadow hôte ; racine (hors de tout shadow réel, `.host` absent) : repli
      // document.head, mêmes aides (feuille adoptée sous CSP, sinon <style>) que pour le shadow hôte.
      var lightRoot = this.getRootNode ? this.getRootNode() : null;
      if (hasCss) {
        // `:host` réécrit en `tag` AVANT adoption/injection : le document (ou le shadow de
        // l'ancêtre) n'a pas de host réel, `:host` n'y matcherait rien. Réécrit aussi AVANT le test
        // de déduplication du document (donc SUR le texte réécrit) : deux composants au CSS source
        // identique mais balises différentes ont un texte réécrit différent (leur nom y est imprimé)
        // et donnent chacun leur PROPRE feuille, à raison
        const lightCss = µ._lightHostCss(css, tag);
        // blocs `<csp>` : la voie des feuilles construites, que seule une appli `csp: true` emploie (`µ._csp`, posé par son manifeste) ;
        // sans ce réglage, le cœur ne la porte pas
        // <csp>
        // sous CSP : une feuille adoptée par `root` (shadow de l'ancêtre ou document). Seule table
        // qui la retient pour µ._hotCss : pas de <style data-mjs-css> sous CSP, et
        // µ._mjs_componentStyleByTag (chemin ombre) ne la voit pas. Une feuille par balise et par texte,
        // partagée par toutes les racines qui l'adoptent : une neuve par ombre, et une de plus à chaque
        // reconnexion de l'hôte, faisait grossir la table sans fin (liste d'hôtes montés puis retirés)
        const adopt = (root) => {
          const entries = (µ._mjs_lightSheetsByTag ??= new Map()).get(tag) || [];
          let entry = entries.find((x) => x.text === lightCss);
          if (!entry) {
            entry = { sheet: new CSSStyleSheet(), text: lightCss };
            entry.sheet.replaceSync(lightCss);
            // gardée quand l'hôte repose ses feuilles (`_mjs_keep`, plus bas) : créé par le constructeur de l'hôte, le léger
            // se connecte avant lui, et sa feuille partait au premier montage. Tenue par la table, la marque survit (WebKit
            // recrée sans elle une feuille que plus aucun code ne tient)
            entry.sheet._mjs_keep = true;
            entries.push(entry);
            µ._mjs_lightSheetsByTag.set(tag, entries);
          }
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, entry.sheet];
          return entry.sheet;
        };
        // </csp>
        // sinon un <style> ; `data-mjs-css` : marqueur pour le rechargement CSS à chaud en dev
        // (µ._hotCss : remplacement du textContent par tag) — distinct de data-mjs-light
        // (inchangé) pour ne rien casser chez qui le cible déjà
        const styleEl = (parent) => {
          const lightStyleEl = document.createElement('style');
          lightStyleEl.setAttribute('data-mjs-light', tag);
          lightStyleEl.setAttribute('data-mjs-css', tag);
          lightStyleEl.textContent = lightCss;
          parent.appendChild(lightStyleEl);
        };
        if (lightRoot && lightRoot.host) {
          // ATTENTION — un light n'a JAMAIS de piste d'adoption SSR (docs/19-ssr.md : « hydrateScript
          // reste vide pour ce mode, quel que soit ssrMode ») : il RECONSTRUIT systématiquement son
          // contenu à la connexion, y compris quand c'est l'HÔTE (ancêtre à shadow réel) qui vide puis
          // reconstruit LE SIEN (mesuré : `replaceChildren` + `adoptedStyleSheets = sheets` de l'hôte
          // ÉCRASENT tout ce qu'une instance PRÉCÉDENTE de ce même tag avait posé). Un marqueur qui ne
          // fait que « j'ai déjà pose » resterait vrai après cet écrasement et bloquerait la repose de
          // l'instance qui SURVIT — la garde vérifie donc la présence RÉELLE, à chaque connexion.
          // <csp>
          if (µ._csp) {
            lightRoot._mjs_mjsLightSheets ??= new Map();
            var knownSheet = lightRoot._mjs_mjsLightSheets.get(tag);
            if (!knownSheet || lightRoot.adoptedStyleSheets.indexOf(knownSheet) === -1) {
              lightRoot._mjs_mjsLightSheets.set(tag, adopt(lightRoot));
            }
          } else
          // </csp>
          if (!lightRoot.querySelector('style[data-mjs-light="' + tag + '"]')) {
            styleEl(lightRoot);
          }
        } else {
          // racine (hors de tout shadow réel) : une seule feuille par texte réécrit, dans le document
          µ._mjs_lightStyleInjected ??= new Set();
          if (!µ._mjs_lightStyleInjected.has(lightCss)) {
            // <csp>
            if (µ._csp) {
              adopt(document);
            } else
            // </csp>
            styleEl(document.head);
            µ._mjs_lightStyleInjected.add(lightCss);
          }
        }
      }
    } else {
      // les feuilles posées en route (`_mjs_keep` : un effet, une bulle, une traduction en
      // attente, un léger de l'ombre sous CSP) restent — leur module ne les reposerait pas
      var kept = this._shadow.adoptedStyleSheets.filter(function(s) { return s._mjs_keep; });
      this._shadow.adoptedStyleSheets = kept.length ? sheets.concat(kept) : sheets;
    }
    if (name === 'default') {
      return;
    }
    // Variant NOMMÉ demandé : la queue (empreinte, requête réseau, mode light,
    // adoption finale) vit désormais dans src/runtime/mjs_layout_variant.ts — patch de
    // `µ.Element.prototype` DÉTECTÉ au build (`<style name="…">`, cf. son en-tête). `sheets`/`_seq`
    // transmis tels quels : comportement BYTE-IDENTIQUE à l'ancien corps unique.
    if (typeof this._mjs_applyLayoutVariant === 'function') {
      return this._mjs_applyLayoutVariant(name, sheets, _seq);
    }
    // Filet défensif (atteint seulement si aucun variant n'est déclaré ni déposé, cf. l'en-tête
    // du fichier ci-dessus) : on garde silencieusement les feuilles déjà adoptées au-dessus,
    // même repli que les autres gardes défensives de cette classe (ex. _mjs_isPageCached).
  }

  // Point de montage unique du contenu initial (appelé par le constructor
  // généré). Centralise la bascule entre « créer + appendre » (défaut /
  // historique) et l'ADOPTION des nœuds rendus par le serveur (hydratation SSR).
  // `factory()` retourne {fragment, refs}.
  _mjs_mount(factory) {
    // Hydratation SSR : si le mode est activé (µ._mjs_ssrHydrate) ET qu'un DSD
    // serveur est présent (_mjs_ssrAdopt), on tente d'adopter les nœuds
    // existants au lieu de les recréer. Tout échec retombe silencieusement sur
    // la création normale → jamais de page cassée.
    if (this._mjs_ssrAdopt && µ._mjs_ssrHydrate) {
      // bloc `<server-resume>` : retiré du cœur par le bundler quand mjs_hydrate.ts, seul fichier qui pose `_mjs_hydrate`, n'est pas du build
      // <server-resume>
      if (typeof this._mjs_hydrate === 'function') {
        try {
          if (this._mjs_hydrate(factory)) {
            return;
          }
        } catch {
          // fallback : création normale ci-dessous
        }
      }
      else
      // </server-resume>
      // Les trois approches d'adoption vivent dans mjs_hydrate.ts, joint selon le bloc
      // `render` du projet (cf. son en-tête) : la PAGE peut demander l'hydratation à un cœur
      // qui ne les embarque pas (serveur qui rend par l'API, mode posé par en-tête HTTP). Rien
      // n'est cassé — la vue est reconstruite juste en dessous, à l'identique — mais le gain
      // attendu n'a pas lieu : on le dit UNE fois, pas une par composant.
      if (!µ._mjs_hydrateWarned) {
        µ._mjs_hydrateWarned = true;
        µ.warn(µ._mjs_msg('elHydrate', null, 'hydratation demandée par la page mais absente du cœur : mode ssr:markers/positional/diff dans render, ou runtime: [\'hydrate\'].'));
      }
      // Hydratation échouée / non applicable / absente : on jette la « photo » serveur
      // (non vidée en mode hydratation, cf. constructor) avant de reconstruire,
      // sinon la vue neuve s'ajouterait en doublon.
      if (this._shadow && this._shadow.replaceChildren) {
        this._shadow.replaceChildren();
      }
    }
    const built = factory();
    this._mjs_nodes = built.refs;
    this._mjs_registerRefs(built.refs);
    if (this._mjs_isLight) {
      // Spec Custom Elements : `document.createElement(tag)` avec le tag DÉJÀ
      // DÉFINI exige que le constructeur ne pose ni enfant ni attribut sur
      // l'élément lui-même (sinon NotSupportedError, « The result must not
      // have children », levée par le navigateur À LA SORTIE du constructeur
      // — silencieuse pour l'appelant, elle avorte toute la construction du
      // parent). En mode léger (`_shadow === this`), `appendChild` ICI viole
      // cette règle dès que ce composant est construit avec un tag déjà
      // connu (un enfant `@lightDom` recréé une fois son module
      // chargé). Un vrai Shadow DOM n'est jamais concerné : il vise le
      // Shadow Root, jamais l'élément lui-même. On diffère l'insertion à
      // `connectedCallback`, qui n'a pas cette contrainte (elle ne s'applique
      // qu'au retour du constructeur, jamais après).
      this._mjs_pendingLightFragment = built.fragment;
    }
    // <child-props>
    // composant qui livre des props aux composants de sa racine (second argument, posé par le compilateur), mis à niveau dans une page
    // déjà là (balise insérée par son parent, page chargée) : ses enfants y entreraient tout de suite, connectés avant que ses props ne
    // soient reprises et leur soient livrées. Son contenu attend la fin de cette reprise (connectedCallback) ; hors de la page, ses
    // enfants ne sont pas mis à niveau avant lui, rien n'attend. Le rendu que demande l'état de départ de son script attend aussi : demandé
    // après la connexion de ses enfants, il joue après leurs premiers rendus, son `µmount` après les leurs
    else if (arguments[1] && this.isConnected) {
      this._mjs_kf               = built.fragment;
      this._mjs_render_scheduled = true;
      this._mjs_pending          = new Set();
    }
    // </child-props>
    else {
      this._shadow.appendChild(built.fragment);
    }
  }

  // _mjs_registerRefs : enregistre les refs (sortie de __create_X) dans
  // _nodeIds pour le routing événementiel. Les text nodes (placeholders) ne
  // sont pas indexés ; seuls les Elements le sont (events ne bubble pas
  // depuis un text node).
  //
  // V1 utilisait _metamorphose qui walk un DOM cloné. Ce walk est
  // supprimé : les refs sont déjà des pointeurs JS directs.
  _mjs_registerRefs(refs) {
    if (!refs) return;
    // Object.keys + for est ~1.5-2× plus rapide que `for...in` sur V8
    // (pas d'enumeration prototype chain, pas de hidden-class iterator).
    // Sur create 1k items × ~6 refs par item, économie cumulée.
    const __keys = Object.keys(refs);
    const __klen = __keys.length;
    // Optim #7 — Skip les ids sans event listener. La classe expose
    // `_mjs_evt_ids` (Set<string>) au compile-time, calculée à partir de
    // `state.events`. Si absente (modules sans event), on enregistre tout
    // (compat). Si présente, on ne tag que les ids présents.
    const __evtIds = this.constructor._mjs_evt_ids;
    // la table du bloc, une par appel (jamais une par balise) : sa description (`_mjs_reg` : le composant qui a écrit ses balises, ses
    // identifiants qui portent un gestionnaire) et, sous chaque identifiant, sa balise ; chaque balise y mène par `_mjs_ev`, la seule
    // propriété qu'elle reçoit (cf. `_mjs_bindEvents`). Une balise peut porter plusieurs identifiants (@click + liaison de boucle)
    let tab;
    for (let __i = 0; __i < __klen; __i++) {
      const id = __keys[__i];
      if (__evtIds && !__evtIds.has(id)) continue;
      const n = refs[id];
      if (!n || n.nodeType !== 1 /* ELEMENT_NODE */) continue;
      tab ||= { _mjs_reg: { o: this, ids: [] } };
      tab._mjs_reg.ids.push(id);
      tab[id]  = n;
      n._mjs_ev = tab;
    }
  }

  // `_mjs_injectSlots` (slots indexés `<@slot {i}/>`) : mjs_slots.ts, joint seulement si le code
  // compilé l'appelle (constructeur d'un composant qui écrit `<@slot`).

  // ==========================================
  // _mjs_invalidate — dispatch direct V2 par varName.
  // ==========================================
  // Au lieu d'un `render(dirty)` monolithique qui balaye `if (dirty & MASK)`
  // pour tous les effects, on lit `_mjs_effectsByVar[k]` et n'exécute QUE les
  // effects abonnés à la var muée.
  //
  // Mount initial (`_mjs_invalidate('_awaits_')`) → fire tous les `_mjs_effectsAll`
  // + `_mjs_renderStruct`.
  //
  // Async fire (promise resolved dans un `{await}`) → idem, full render via
  // `_awaits_` car on ne sait pas quel effect est concerné.
  //
  // Coalescence : pending Set + microtask. Plusieurs mutations dans le même
  // frame fusionnent leurs effects ; le render struct ne tourne qu'une fois.
  // index par-donnée des µ.effect user (l'équivalent des « reactions »
  // de Svelte : `mark_reactions` retourne tout de suite si rien ne lit la donnée).
  // Avant : `_mjs_invalidate` désarmait son ultra-fast-path dès qu'un composant avait
  // UN µeffect → chemin lent (alloc Set + scan) pour TOUTES ses vars. Ici on calcule
  // UNE fois l'union des `staticVars` de tous les effects : une mutation d'une var
  // qu'AUCUN effect ne lit peut court-circuiter, même si d'autres vars ont des effects.
  // SÛRETÉ (comportement préservé) : si un effect a des `staticVars` VIDES (il « fire
  // toujours » — store universel/computed non vu au scan, cf. _mjs_runEffectsV2 ~1771), on
  // DÉSACTIVE l'opti pour ce composant (sentinelle `null` → toujours vrai).
  _mjs_varHasUserEffect(k) {
    const eff = this._mjs_effects;
    if (!eff || eff.length === 0) return false;
    let idx = this._mjs_userEffectVars;
    if (idx === undefined) {
      idx = new Set();
      for (let i = 0; i < eff.length; i++) {
        const sv = eff[i].staticVars;
        if (!sv || sv.length === 0) { idx = null; break; }
        for (let j = 0; j < sv.length; j++) idx.add(sv[j]);
      }
      this._mjs_userEffectVars = idx;
    }
    return idx === null ? true : idx.has(k);
  }

  // <redraw>
  _mjs_invalidate(k, rw) {
  // </redraw>
  // <no-redraw>
  // _mjs_invalidate(k) {
  // </no-redraw>
    // <refresh>
    // `µrefresh` (`rw`) : jusqu'à la fin du rendu qu'il déclenche, les listes de ce composant ne sautent aucune ligne (cf. _mjs_reconcileList)
    if (rw) this._mjs_rfl = 1;
    // </refresh>
    // <loops>
    // sortie d'une boucle qui écrit l'état : les props liées écrites pendant la boucle remontent, une fois chacune, avec leur
    // valeur finale (cf. _mjsBindsInLoop)
    if (k === _MJS_LINKS) {
      const __b = this._mjs_lqb;
      this._mjs_lqb = null;
      if (__b) __b.forEach((__k) => this._mjs_emitBind(__k));
      return;
    }
    // </loops>
    if (this._mjs_has_crashed) return;
    // <fine-grained>
    // lignes propres (mise à jour fine, mjs_for.ts) : une écriture de `k` qui n'est ni servie champ par champ (mjs_deep.ts, sans passer
    // ici) ni un changement de structure compilé (`rw` à 0, mjs_deep.ts) a pu changer le contenu d'une ligne — écriture entière,
    // enveloppe, `µrefresh`, repli du chemin fin : ses listes relisent toutes leurs lignes à leur prochaine passe. Avant le gel de la
    // traduction et les voies rapides, qui rendent la main sans rendu
    const __fi = this._mjs_fineIds;
    if (__fi !== void 0 && rw !== 0) {
      const __fv = this._mjs_fine[k];
      if (__fv !== void 0 && __fv.r !== void 0) for (const __l of __fv.r) __fi[__l[0]] = 1;
    }
    // </fine-grained>
    // <derived-values>
    // #7 — `_awaits_` = notification externe (store universel, await, mount) :
    // une source lue par un computed (contexte, store partagé) a pu changer
    // sans que ce computed soit abonné par varName. Un compte de plus à leur horloge
    // (cf. _MJS_CLOCK) force la ré-évaluation au prochain accès — sinon un derived sur store /
    // contexte sert une valeur périmée. Coût négligeable : `_awaits_` est rare,
    // et au mount les computeds n'ont encore jamais été calculés.
    //
    // STATISATION — même trou pour les clés store (`$$clé`/`$$*`) : le
    // store statisé (mjs_store_globals.ts) appelle `comp._mjs_invalidate('$$'+key)`
    // DIRECTEMENT (pas de passage par `_mjs_notifyMutation`, réservé aux mutations
    // LOCALES), donc le compte de l'horloge ci-dessous ne se
    // faisait jamais pour un `$X = $$y*2` — le getter `_state.X` servait la
    // valeur `_mjs_cached` périmée indéfiniment après une écriture `$$y = …`.
    // clé qui n'est pas un texte (symbole, appelant direct ; `_set` convertit les autres) : jamais un magasin
    if ((k === '_awaits_' || (typeof k === 'string' && k.charCodeAt(0) === 36 && k.charCodeAt(1) === 36)) && this._mjs_computeds) {
      _mjsCount(this._mjs_computeds, k);
    }
    // </derived-values>
    // GEL i18n en mode 'wait' — tant que le fragment n'est pas là, on ne peint
    // RIEN : le rendu COMPLET déclenché à la levée du gel rattrape tout ce qui a
    // été muté entre-temps. Posé dans `connectedCallback`, levé à la résolution
    // (qui aboutit TOUJOURS, échec réseau compris).
    if (this._mjs_i18n_hold) { this._mjs_pending_full = true; return; }
    // <reffet-before>
    // écriture faite par un reffet d'avant qui passe sur-le-champ (`_mjs_beforeW`, posé le temps de son tour) : recueillie, puis
    // rendue dans le passage de l'écriture qui l'a lancé (chemin rapide, plus bas)
    // <redraw>
    if (this._mjs_beforeW && !rw) {
    // </redraw>
    // <no-redraw>
    // if (this._mjs_beforeW) {
    // </no-redraw>
      this._mjs_beforeW.add(k);
      return;
    }
    // </reffet-before>
    // Optim #B-bis — Ultra fast-path no-op : si la var muée n'a strictement
    // RIEN à fire (pas d'effects ciblés, pas de struct, pas d'effects user, pas
    // d'_awaits_), on évite alloc Set + queueMicrotask + le bloc batch entier.
    // Sans ça, chaque µ._set(this, 'pureDataVar', x) schedule un microtask qui
    // ne fait rien — overhead massif sur run1k (1000 rows × invalidate).
    if (
      k !== '_awaits_' &&
      !this._mjs_render_scheduled &&
      this._mjs_is_mounted &&
      // <redraw>
      (rw || !this._mjs_varHasUserEffect(k)) &&
      // </redraw>
      // <no-redraw>
      // !this._mjs_varHasUserEffect(k) &&
      // </no-redraw>
      (!this._mjs_effectsByVar || !this._mjs_effectsByVar[k]) &&
      (!this._mjs_renderStructVars || this._mjs_renderStructVars[k] !== 1)
    ) {
      return;
    }
    // Fast path sync direct étendu.
    //
    // Au lieu de `length === 1` uniquement, on autorise N effects ciblés.
    // Le coût d'un loop court (<=4 fns) est inférieur au coût d'un queueMicrotask
    // + Set allocation + iteration. Gain mesuré sur update10thRow.
    //
    // Conditions strictes pour rester safe :
    //   - k !== '_awaits_' (full render reste async)
    //   - !this._mjs_render_scheduled (pas de batch en cours)
    //   - !µ._mjs_inEffect (pas dans une exécution d'effect — évite cascade sync)
    //   - this._mjs_is_mounted (le mount initial reste async)
    //   - _mjs_effectsByVar[k] existe et n'est pas vide
    //   - µ.effect user présent : routé vers une microtask coalescée (cf.
    //     ligne ~1876) — pas d'exécution sync ici, N écritures même
    //     tick = UN seul run sur l'état final
    //
    // Skip µ.activeComponent setter/getter Proxy : ces updates ciblés
    // sont des _mjs_updText/_mjs_updAttr simples qui ne touchent pas aux stores
    // universels. Pas besoin de tracker l'activeComponent.
    //   - pas la 2e écriture, dans le même tour, d'une var qui pilote un bloc (`$x = {…}; $x = null`) :
    //     son rendu de bloc est reporté (dédoublonné), ses liaisons liraient la branche encore
    //     affichée avec la nouvelle valeur (`$x.champ` sur null) — elle passe par le chemin
    //     ordinaire, le bloc d'abord
    if (
      k !== '_awaits_' &&
      !this._mjs_render_scheduled &&
      !µ._mjs_inEffect &&
      this._mjs_is_mounted &&
      this._mjs_effectsByVar &&
      !(this._mjs_struct_dispatched_in_tick && this._mjs_renderStructVars && this._mjs_renderStructVars[k] === 1)
    ) {
      const __list = this._mjs_effectsByVar[k];
      const __hasUserEffects = this._mjs_effects && this._mjs_effects.length > 0;
      // Fast-path ultra-court : si pas d'effects user, pas de _mjs_renderStruct
      // non plus à fire (rare mais possible), on inline le minimum.
      // clé au nom d'une méthode d'`Object.prototype` (`hasOwnProperty`, venue d'un étalement, d'un attribut, de `$[$k]`) : la table rend
      // cette méthode, qui n'est pas une liste de liaisons
      if (typeof __list === 'object' && __list.length > 0) {
        // <loops>
        // une boucle qui écrit l'état tourne (µ._mjs_lq, mjs_init.ts) : une variable qui ne pilote aucun bloc attend la
        // sortie de la boucle, qui la repasse ici une fois — ses textes et attributs écrits une fois, pas à chaque tour ;
        // une variable qui pilote un bloc (1) ou pose une prop sur un composant enfant (2, l'état de l'enfant) garde son chemin
        // <redraw>
        if (µ._mjs_lq && !rw && (!this._mjs_renderStructVars || !this._mjs_renderStructVars[k])) {
        // </redraw>
        // <no-redraw>
        // if (µ._mjs_lq && (!this._mjs_renderStructVars || !this._mjs_renderStructVars[k])) {
        // </no-redraw>
          if (this._mjs_lqk) {
            this._mjs_lqk.add(k);
          }
          else {
            this._mjs_lqk = new Set([k]);
            µ._mjs_lqq.push(this);
          }
          return;
        }
        // </loops>
        // <refresh>
        const __returned = µ._mjs_rendering;
        // </refresh>
        // <retell>
        // les liaisons qui rejouent sont celles de ce composant : ses clés redites, s'il en a (cf. _mjsRetell), jamais celles d'un autre
        const __rdA = µ._mjs_retold;
        let __rd    = this._mjs_rdp;
        // <redraw>
        // `µrefresh` (`rw`) : la clé rafraîchie est redite
        if (rw && !(__rd && __rd[k])) (__rd ||= Object.create(null))[k] = 1;
        // </redraw>
        µ._mjs_retold = __rd === void 0 ? null : { e: this, k: __rd };
        // </retell>
        µ._mjs_inEffect = true;
        try {
          // <reffet-before>
          // reffets d'avant l'écran qui lisent `k` : l'écran est encore celui d'avant cette écriture. Ce qu'ils écrivent est recueilli
          // (`_mjs_beforeW`) et rendu dans ce passage avec `k` : blocs, liaisons, puis la passe en microtâche des `µeffect`. Aucun lot
          // ouvert pour eux : l'écriture suivante du gestionnaire passe aussi sur-le-champ
          let __bw = null, __bs = false;
          // <redraw>
          if (this._mjs_before && !rw) {
          // </redraw>
          // <no-redraw>
          // if (this._mjs_before) {
          // </no-redraw>
            __bw = this._mjs_beforeW = new Set();
            try {
              this._mjs_runBefore(k, null);
            } finally {
              this._mjs_beforeW = null;
            }
            if (this._mjs_has_crashed) return;
            const __r = this._mjs_renderStructVars;
            for (const __w of __bw) {
              if (__r && __r[__w] === 1) {
                __bs = true;
                if (this._mjs_chgd) this._mjs_chgd.add(__w);
              }
            }
          }
          // </reffet-before>
          // ORDRE CRITIQUE : struct AVANT effects. Mêmes raisons que dans la
          // microtask normale (cf. ligne 1143+). Si la var muée pilote un bloc
          // struct ({if}/{for}/{key}/{await}), celui-ci doit re-render
          // d'abord : il peut détruire l'ancien node et créer un fresh node
          // (avec une NOUVELLE ref dans this._mjs_nodes.X). Si on tirait les
          // effects D'ABORD, ils muteraient l'ANCIEN node (jeté après) et le
          // FRESH node créé par struct resterait vide. Cas vécu : tuto
          // `blocs-key` où `_mjs_updText('t3', ...)` doit muter le NEW t3 créé
          // par `_mjs_updKey`, pas l'ancien.
          // Skip _mjs_renderStruct si la var muée ne pilote AUCUN bloc
          // structurel (compile-time info dans _mjs_renderStructVars). Gain massif
          // sur select1k : `$selected` ne pilote pas l'iterable du `{for}`,
          // donc inutile de re-balayer _mjs_updFor + _mjs_reconcileList × 1000 rows.
          // <refresh>
          // un rendu tourne : un `µrefresh` appelé pendant ce rendu est appliqué juste après (µ._mjs_refresh)
          µ._mjs_rendering = 1;
          // </refresh>
          const __rsv = this._mjs_renderStructVars;
          // `_awaits_` est la clé spéciale émise par `_mjs_updAwait` quand une
          // promesse `{await}` résout (success/error) : `_mjs_renderStruct` DOIT
          // tourner pour rendre la nouvelle branche, même si `_awaits_` n'est
          // pas dans `_mjs_renderStructVars` (qui ne liste que les vars user).
          const __needsStruct = k === '_awaits_' || (__rsv != null && __rsv[k] === 1);
          // Optim #3 — Guard de dedup : le 1er rendu de bloc du tick pose le drapeau (remis à zéro en
          // microtask) ; une 2e écriture d'une var qui pilote un bloc dans le même tick
          // (`$items.push(a); $items.push(b)`, `$x = {…}; $x = null`) n'entre plus dans cette voie
          // (cf. sa condition d'entrée) : le chemin ordinaire rend les blocs puis les liaisons, sur
          // l'état final
          if (__needsStruct && this._mjs_renderStruct) {
            this._mjs_struct_dispatched_in_tick = true;
            // noms écrits depuis la dernière passe : un `{for}` de racine ne se rejoue que si l'un des siens y figure
            if (this._mjs_chgd) this._mjs_chgd.add(k);
            const __self = this;
            queueMicrotask(() => { __self._mjs_struct_dispatched_in_tick = false; });
            try { this._mjs_safeRenderStruct(); } catch (err) {
              this._mjs_catchError(err);
              return;
            }
          }
          // <reffet-before>
          // un bloc que pilote une écriture d'un reffet d'avant, `k` n'en pilotant aucun : rendu ici, avant les liaisons
          if (__bs && !__needsStruct && this._mjs_renderStruct) {
            this._mjs_struct_dispatched_in_tick = true;
            const __self = this;
            queueMicrotask(() => { __self._mjs_struct_dispatched_in_tick = false; });
            try { this._mjs_safeRenderStruct(); } catch (err) {
              this._mjs_catchError(err);
              return;
            }
          }
          // </reffet-before>
          // Inline le loop d'effects (court typiquement 1-3).
          // Skip `typeof === 'function'` (10-15ns) → truthy check direct.
          // `_mjs_renderStruct` est soit une function (assignée par template), soit undef.
          // Idem `_mjs_catchError` (méthode prototype, toujours présente).
          for (let __i = 0, __ln = __list.length; __i < __ln; __i++) {
            try { __list[__i].call(this); } catch (err) {
              this._mjs_catchError(err);
              return;
            }
          }
          // <reffet-before>
          // liaisons des variables écrites par les reffets d'avant
          if (__bw) {
            for (const __w of __bw) {
              const __l = this._mjs_effectsByVar[__w];
              if (typeof __l === 'object') {
                for (let __i = 0, __ln = __l.length; __i < __ln; __i++) {
                  try { __l[__i].call(this); } catch (err) {
                    this._mjs_catchError(err);
                    return;
                  }
                }
              }
            }
          }
          // </reffet-before>
          // µ.effect utilisateurs : intersection staticVars avec {k}.
          // skip l'alloc Set + le scan `_mjs_runEffectsV2` si AUCUN effect
          // ne lit `k` (même si le composant a des effects sur d'AUTRES vars).
          // coalescence des µeffect user : le fast-path ne les
          // exécute plus en sync à CHAQUE écriture (N écritures même tick = N runs
          // sur états intermédiaires) ; on accumule les vars muées et on exécute
          // UNE passe en microtask, sur l'état final — aligné sur l'intention
          // documentée en tête de fast-path et sur la sémantique du chemin batch.
          // bloc `<reffets-pass>` : retiré du cœur sans mjs_effect.ts, seul fichier qui inscrit un reffet (`_mjs_effects`)
          // <reffets-pass>
          // <redraw>
          if (!rw && __hasUserEffects && this._mjs_varHasUserEffect(k)) {
          // </redraw>
          // <no-redraw>
          // if (__hasUserEffects && this._mjs_varHasUserEffect(k)) {
          // </no-redraw>
            this._mjs_uePlan(k);
          }
          // </reffets-pass>
          // <reffet-before>
          // `µeffect` qui lisent une variable écrite par un reffet d'avant : la passe en microtâche de ceux de `k`, déjà prévue (un
          // reffet d'avant qui a passé lit `k` ou ne lit aucune variable connue : `_mjs_varHasUserEffect(k)` vrai)
          if (__bw && this._mjs_ue_pending) for (const __w of __bw) this._mjs_ue_pending.add(__w);
          // </reffet-before>
          // écriture faite pendant le premier rendu (liaison `clientWidth=!{…}` qui pose la largeur mesurée), ou pendant le rendu du retour
          // d'un composant détruit (montage réarmé à 2, connectedCallback) : µmount attend la fin de ce rendu, qui le lance après toutes
          // ses références `:this` (plus bas, passage en microtâche)
          if (this._mjs_pendingMount === true && !this._mjs_initial_render) {
            this._mjs_pendingMount = false;
            // SSR : hooks client — pas d'exécution côté serveur (cf. µ._isServer).
            this._mjs_fireMount();
          }
        } finally {
          µ._mjs_inEffect = false;
          // <retell>
          µ._mjs_retold = __rdA;
          // </retell>
          // <refresh>
          µ._mjs_rendering = __returned;
          this._mjs_rfl = 0;
          // </refresh>
        }
        return;
      }
    }
    if (!this._mjs_render_scheduled) {
      // Pas de réutilisation Set : on alloue une Set neuve à chaque batch
      // car le pending est lu par le microtask consumer (avant le clear).
      // Le coût de `new Set()` est ~10ns, négligeable vs le travail du batch.
      this._mjs_pending = new Set();
      this._mjs_pending_full = false;
      // Skip alloc _mjs_lastMutedVars si pas d'effects user (_mjs_runEffectsV2
      // lit ce set, mais retourne tôt si this._mjs_effects est vide). Économise
      // 1 alloc Set par batch. Sur update10thRow × 16, gain mesurable.
      if (this._mjs_effects && this._mjs_effects.length > 0) {
        this._mjs_lastMutedVars = new Set();
      } else {
        this._mjs_lastMutedVars = null;
      }
      this._mjs_render_scheduled = true;
      queueMicrotask(() => {
        this._mjs_render_scheduled = false;
        if (this._mjs_has_crashed) return;
        // GEL i18n 'wait' — un batch PROGRAMMÉ AVANT la pose du gel arriverait
        // ici quand même : vider `_mjs_pending_full`/`_mjs_pending` dans
        // `connectedCallback` ne suffisait pas, `_mjs_pending_struct_dirty` (posé
        // par les écritures d'état du setup) relançait tout de même le rendu
        // structurel ET les effets — d'où le flash de placeholders mesuré
        // malgré l'annulation. On sort ici : la levée du gel invalide en
        // `_awaits_` et reprogramme un rendu COMPLET.
        if (this._mjs_i18n_hold) { this._mjs_pending_full = true; return; }
        // Garde anti-boucle réactive. Une boucle d'effets (un effet qui
        // mute sa propre dépendance) s'exprime ici en chaîne INFINIE de
        // microtasks : le navigateur ne reprend jamais la main → onglet gelé
        // sans même un avertissement. On compte les flushs de CHAQUE composant par
        // RAFALE de microtasks : une page qui monte 10 000 composants d'un coup n'est
        // pas une boucle, seule une boucle re-rend le MÊME composant sans fin. La
        // rafale est nommée par sa minuterie de fin (`_mjs_mtT`, setTimeout 0, qui ne
        // s'exécute QUE si la chaîne s'arrête) : rafale nouvelle, compteur du composant
        // reparti de zéro. La minuterie n'est armée qu'au 100e rendu d'un composant compté
        // sans elle (rafale « 0 », d'une rafale à l'autre) : un rendu ordinaire n'ajoute aucune
        // tâche après lui, et une boucle est coupée après 100 + 10 000 rendus au plus, les
        // 10 000 derniers dans la même rafale. Seuil volontairement large (10 000, façon Solid) : aucune
        // cascade légitime ne l'atteint. Au-delà : un avertissement explicite (une fois
        // par rafale et par composant), et les effets du composant s'arrêtent jusqu'à la fin
        // de la rafale (plus bas) tandis que l'affichage suit encore l'état — la chaîne se
        // brise sans laisser un écran périmé ; si elle continue sans eux, le rendu s'arrête aussi.
        const __e = µ._mjs_mtT || 0;
        if (this._mjs_mtE !== __e) {
          this._mjs_mtE = __e;
          this._mjs_mtN = 0;
        }
        if (!__e && this._mjs_mtN >= 100) {
          this._mjs_mtE = µ._mjs_mtT = setTimeout(() => { µ._mjs_mtT = 0; });
          this._mjs_mtN = 0;
        }
        const __n = ++this._mjs_mtN;
        if (__n > 10000) {
          if (__n === 10001) {
            µ.warn(µ._mjs_msg('elLoop', { tag: this.tagName ? this.tagName.toLowerCase() : '?' }, 'Boucle réactive détectée sur <{tag}> : plus de 10 000 rendus dans la même rafale de microtasks. Un effet mute probablement sa propre dépendance ($x = $x + … dans un µeffect ?). Effets suspendus pour garder la page vivante.'));
          }
          if (__n > 10100) return;
        }
        // `_mjs_pending_full` ne donne plus de passe-droit : un composant monté
        // puis retiré DANS LE MÊME TICK exécutait tout son mount (effects,
        // _mjs_renderStruct, onMount) sur un arbre détaché. Au remount,
        // connectedCallback ré-invalide de toute façon.
        if (!this._mjs_is_mounted) return;
        const pending = this._mjs_pending;
        const fullRender = this._mjs_pending_full;
        this._mjs_pending = null;
        this._mjs_pending_full = false;
        // <retell>
        // clés redites depuis la dernière passe (cf. _mjsRetell) : leurs liaisons rejouent dans celle-ci, qui prend la marque
        const __rdA   = µ._mjs_retold, __rd = this._mjs_rdp;
        this._mjs_rdp = void 0;
        µ._mjs_retold  = __rd === void 0 ? null : { e: this, k: __rd };
        // </retell>
        µ.activeComponent = this;
        try {
          // <reffets-state>
          if (fullRender === 2) _mjsU2 = this;
          // </reffets-state>
          // <reffet-before>
          // reffets d'avant l'écran : tous au montage et à un rendu complet, sinon ceux qui lisent une variable écrite depuis la
          // dernière passe ; suspendus avec les autres par la garde des 10 000 rendus. Le lot reste ouvert le temps de leur tour : ce
          // qu'ils écrivent entre dans ce passage (blocs, liaisons, `µeffect` qui le lisent), au lieu d'ouvrir un lot dont les
          // variables écrites remplaceraient celles de ce passage
          if (this._mjs_before) {
            const __bv = this._mjs_beforeVars;
            this._mjs_beforeVars = null;
            if (__n <= 10000 && (fullRender || __bv)) {
              this._mjs_render_scheduled = true;
              this._mjs_pending = pending;
              this._mjs_lastMutedVars ||= new Set();
              try {
                this._mjs_runBefore(null, fullRender ? null : __bv);
              } finally {
                this._mjs_render_scheduled = false;
                this._mjs_pending = null;
              }
            }
            if (this._mjs_has_crashed) return;
          }
          // </reffet-before>
          // ORDRE : struct AVANT effects.
          // Les blocs `{if}` / `{for}` / `{key}` / `{await}` doivent rendre
          // LEUR contenu (et merger leurs refs dans `this._mjs_nodes`) AVANT que
          // les effects ne tournent — sinon un `@attach` / interpolation /
          // binding posé sur un nœud créé par un bloc struct lit `_mjs_nodes.X`
          // = undefined au mount et no-op silencieux.
          //
          // Blocs structurels rejoués SI :
          //   - mount initial (fullRender), OU
          //   - au moins une des vars muées pilote la struct (compile-time
          //     check via _mjs_renderStructVars).
          // Gain massif sur select1k : `selected` ne pilote pas
          // l'iterable `data` → skip total de _mjs_updFor + _mjs_reconcileList.
          //
          // Bug-fix : `_mjs_lastMutedVars` peut être null si pas d'effects user
          // (optim = skip alloc Set). On utilise le flag
          // `_mjs_pending_struct_dirty` posé directement par `_mjs_invalidate` quand
          // une var muée matche `_mjs_renderStructVars`. Indépendant de la
          // présence d'effects user.
          let __runStruct = fullRender || this._mjs_pending_struct_dirty === true;
          this._mjs_pending_struct_dirty = false;
          // <refresh>
          // un rendu tourne : un `µrefresh` appelé pendant ce rendu est appliqué juste après (µ._mjs_refresh)
          µ._mjs_rendering = 1;
          // </refresh>
          if (__runStruct && this._mjs_renderStruct) {
            try { this._mjs_safeRenderStruct(); } catch (err) {
              this._mjs_catchError(err);
              return;
            }
          }
          if (fullRender) {
            // Mount initial ou async fire : exécute TOUS les effects.
            // Skip `typeof === 'function'` checks (méthode prototype garantie).
            // for-let-i au lieu de for-of (V8 spécialise mieux sur Array).
            // <server-input>
            // au premier rendu, avant la pose des liaisons : la saisie faite dans la page du serveur avant le démarrage (cf. _mjsTypedPut)
            if (_mjsTypedAny && this._mjs_initial_render) _mjsTypedPut(this);
            // </server-input>
            const __ea = this._mjs_effectsAll;
            if (__ea) {
              for (let __i = 0, __ln = __ea.length; __i < __ln; __i++) {
                try { __ea[__i].call(this); } catch (err) {
                  this._mjs_catchError(err);
                  return;
                }
              }
            }
          } else if (pending) {
            // Dispatch ciblé : seuls les effects abonnés aux vars muées.
            // NB : pending est un Set → for-of OK, pas d'indexAccess.
            for (const fn of pending) {
              try { fn.call(this); } catch (err) {
                this._mjs_catchError(err);
                return;
              }
            }
          }
          // µ.effect — exécution des effets utilisateur.
          // Mode V2 : on les fire tous au mount initial, et sinon on filtre
          // par intersection de leur staticMask avec les vars muées.
          // _mjs_runEffectsV2 est sur prototype, toujours présent. Pas besoin
          // de typeof === 'function' check. Évite N typeof par batch.
          // Le early-return interne gère le cas pas d'effects.
          // µ._mjs_inEffect posé ici AUSSI (miroir du site _mjs_ue_pending plus haut) :
          // sans lui, une écriture nested faite par un effet de CE chemin reprenait le
          // fast-path sync (lecteur unique : garde d'entrée _mjs_invalidate) et patchait le
          // DOM 1 microtâche trop tôt — l'invariant « cascade nested toujours différée »
          // ne tenait que d'un côté ; pas de fusion _mjs_lastMutedVars nécessaire ici (rien
          // ne le relit après l'appel sur ce chemin)
          // <refresh>
          µ._mjs_rendering = 0;
          // </refresh>
          // <retell>
          µ._mjs_retold = null;
          // </retell>
          µ._mjs_inEffect = true;
          try {
            if (__n <= 10000) this._mjs_runEffectsV2(pending, fullRender);
          } finally {
            µ._mjs_inEffect = false;
          }
          // <wait-view>
          // valeur qui attend, page servie : les composants que ce premier rendu a bâtis dans ses blocs sont notés (mjs_await_derived.ts)
          if (this._mjs_initial_render && µ._mjs_awView !== void 0) µ._mjs_awView(this);
          // </wait-view>
          // µmount fire APRÈS le 1er render.
          if (this._mjs_pendingMount) {
            this._mjs_pendingMount = false;
            // SSR : hooks client — pas d'exécution côté serveur (cf. µ._isServer).
            this._mjs_fireMount();
          }
        } finally {
          µ.activeComponent = null;
          this._mjs_initial_render = false;
          // <reffets-state>
          _mjsU2 = null;
          // </reffets-state>
          // <retell>
          µ._mjs_retold = __rdA;
          // </retell>
          // <refresh>
          µ._mjs_rendering = 0;
          this._mjs_rfl = 0;
          // </refresh>
        }
      });
    }
    // <retell>
    // <redraw>
    // variable rafraîchie (`rw` : µrefresh) dont le rendu attend : sa passe redira ses liaisons (cf. _mjsRetell)
    if (rw) (this._mjs_rdp ||= Object.create(null))[k] ||= 1;
    // </redraw>
    // </retell>
    if (k === '_awaits_') {
      this._mjs_pending_full = true;
      if (this._mjs_chgd) this._mjs_chgd.add(k);
    } else {
      // for-let-i au lieu de for-of (évite alloc iterator + symbol lookup).
      const __ebv = this._mjs_effectsByVar;
      if (__ebv) {
        const list = __ebv[k];
        if (typeof list === 'object') {
          const __pset = this._mjs_pending;
          for (let __i = 0, __ln = list.length; __i < __ln; __i++) {
            __pset.add(list[__i]);
          }
        }
      }
      // <redraw>
      if (this._mjs_lastMutedVars && !rw) this._mjs_lastMutedVars.add(k);
      // </redraw>
      // <no-redraw>
      // if (this._mjs_lastMutedVars) this._mjs_lastMutedVars.add(k);
      // </no-redraw>
      if (this._mjs_chgd) this._mjs_chgd.add(k);
      // <reffet-before>
      // <redraw>
      if (this._mjs_before && !this._mjs_beforeIn && !rw) (this._mjs_beforeVars ||= new Set()).add(k);
      // </redraw>
      // <no-redraw>
      // if (this._mjs_before && !this._mjs_beforeIn) (this._mjs_beforeVars ||= new Set()).add(k);
      // </no-redraw>
      // </reffet-before>
      // Bug-fix : track séparément si une var muée pilote `_mjs_renderStruct`.
      // Indépendant de la présence d'effects user (qui était la condition
      // pour allouer `_mjs_lastMutedVars`). Sans ce flag, un composant sans effect
      // user mais avec `{for}` / `{if}` ne re-renderait pas la struct au
      // `µ._set(el, 'rowsVar', ...)` externe.
      if (this._mjs_pending_struct_dirty === false) {
        const __rsv = this._mjs_renderStructVars;
        if (__rsv != null && __rsv[k] === 1) {
          this._mjs_pending_struct_dirty = true;
        }
      }
    }
  }

  // <reffet-before>
  // reffets d'avant l'écran (`µeffect.before`, mjs_effect.ts) : ceux qui lisent `k` (chemin rapide), une des variables de `vars` (passe
  // en microtâche), ou tous (les deux nuls : montage, rendu complet) ; ceux qui ne lisent aucune variable connue, toujours ; un reffet
  // qui a noté ses lectures au graphe des signaux, quand une source lue à son dernier passage a changé (_mjs_effGo) ; `graph` : ceux-là
  // seulement.
  // Leurs écritures entrent dans le passage en cours (recueillies sur le chemin rapide, lot gardé ouvert en microtâche) et ne les
  // relancent pas ; nettoyage, retrait et erreur comme `_mjs_runEffectsV2`
  _mjs_runBefore(k, vars, graph) {
    const __effs = this._mjs_effects;
    const __in   = µ._mjs_inEffect;
    const __prev = µ._mjs_effRun;
    const __all = !graph && k === null && vars === null;
    µ._mjs_inEffect = this._mjs_beforeIn = true;
    try {
      for (let __i = 0, __n = __effs.length; __i < __n; __i++) {
        const e = __effs[__i];
        if (!e.before || !this._mjs_effGo(e, k, vars, __all, graph)) continue;
        µ._mjs_effRun = e;
        const __cl = e.cleanup;
        e.cleanup = null;
        try {
          if (__cl) __cl.call(e);
        } catch (err) { µ.warn('Cleanup error:', err); }
        try {
          const res = e.fn && e.fn();
          if (typeof res === 'function' && !res._mjs_timer) {   // main d'arrêt de µafter / µevery rendue : pas un nettoyage (mjs_every.ts)
            if (e.fn) e.cleanup = res;
            else res.call(e);
          }
        } catch (err) { this._mjs_catchError(err); }
      }
    } finally {
      µ._mjs_effRun = __prev;
      µ._mjs_inEffect = __in;
      this._mjs_beforeIn = false;
    }
  }
  // </reffet-before>

  // <reffets-pass>
  // passe en microtâche des `µeffect`, sur l'état final des écritures du tour : `k` y entre (variable écrite, '' pour un réveil du
  // graphe des signaux, cf. _mjs_effWake)
  _mjs_uePlan(k) {
    let __ue = this._mjs_ue_pending;
    if (__ue) {
      __ue.add(k);
      return;
    }
    __ue = this._mjs_ue_pending = new Set();
    __ue.add(k);
    queueMicrotask(() => {
      const __vars = this._mjs_ue_pending;
      this._mjs_ue_pending = null;
      if (!__vars || this._mjs_has_crashed || !this._mjs_is_mounted) return;
      // un batch complet est déjà planifié : il exécutera _mjs_runEffectsV2
      // lui-même — on fusionne nos vars dans son set et on s'efface
      if (this._mjs_render_scheduled) {
        if (this._mjs_lastMutedVars) { for (const __v of __vars) this._mjs_lastMutedVars.add(__v); }
        else this._mjs_lastMutedVars = __vars;
        return;
      }
      // passe du seul réveil du graphe (source d'un autre propriétaire, aucun rendu ici) : bornée par la garde des 10 000 reprises
      // par rafale du graphe (mjs_signals.ts), une boucle ne passant par aucun lot du composant
      if (__vars.size === 1 && __vars.has('') && !µ._mjs_sigGuard(this)) return;
      const __prevMuted = this._mjs_lastMutedVars;
      this._mjs_lastMutedVars = __vars;
      µ._mjs_inEffect = true;
      try {
        // <reffet-before>
        // reffets d'avant l'écran marqués par le graphe sans écriture du composant (le chemin rapide joue ceux de ses écritures)
        if (this._mjs_before) this._mjs_runBefore(null, null, true);
        // </reffet-before>
        this._mjs_runEffectsV2(undefined, false);
      } finally {
        µ._mjs_inEffect = false;
        // un batch imbriqué (écriture faite PAR un effet pendant la passe)
        // a pu installer un Set NEUF de vars muées : ne jamais l'écraser —
        // on restaure l'ancien seulement si rien de neuf n'a été posé,
        // sinon on fusionne l'ancien dedans
        const __cur = this._mjs_lastMutedVars;
        if (__cur == null || __cur === __vars) this._mjs_lastMutedVars = __prevMuted;
        else if (__prevMuted) { for (const __v of __prevMuted) __cur.add(__v); }
      }
    });
  }

  // un reffet du composant marqué par le graphe des signaux (mjs_signals.ts, une source lue à son dernier passage a changé) : la passe
  // des reffets est demandée comme pour une écriture ; c'est elle qui regarde le graphe (cf. _mjs_effGo)
  _mjs_effWake() {
    if (!this._mjs_has_crashed) this._mjs_uePlan('');
  }

  // un reffet doit-il passer ? Tous au montage et à un rendu complet (`tout`). Un reffet qui a noté ses lectures au graphe des signaux :
  // si une source lue à son dernier passage a vraiment changé (une valeur dérivée refaite à l'identique ne compte pas), ou si une clé
  // du magasin de son relevé (`res`) est écrite — `k`, ou une des variables de `vars`. Sinon, la règle du relevé de la construction :
  // une de ses variables écrite, ou aucune variable connue (il passe à chaque fois). `graph` : le graphe seul
  _mjs_effGo(e, k, vars, all, graph) {
    const __g = e.n;
    let __sv = e.staticVars;
    if (__g !== undefined && __g.deps !== null && __g.deps.length !== 0) {
      // <reffets-state>
      // rendu complet demandé par des états partagés seulement : le reffet ne passe d'office que s'il en a lu un qui a changé, ou dans le
      // doute (_mjsUGo) ; sinon le graphe et son relevé décident, avec les variables écrites dans ce lot
      if (all && _mjsU2 === this) {
        all = _mjsUGo(e);
        if (vars == null) vars = this._mjs_lastMutedVars;
      }
      // </reffets-state>
      if (all || µ._mjs_sigStale(__g)) return true;
      if (graph) return false;
      __sv = e.res;
    }
    else if (graph) return false;
    else if (all || !__sv || __sv.length === 0) return true;
    for (let __j = 0; __j < __sv.length; __j++) if (k != null ? __sv[__j] === k : vars != null && vars.has(__sv[__j])) return true;
    return false;
  }
  // </reffets-pass>

  // ==========================================
  // _mjs_runEffectsV2 — exécution des µ.effect() utilisateur.
  // ==========================================
  // Garde la sémantique V1 (staticMask scanné côté script + tracking runtime
  // via Proxy stores) mais ne dépend plus du bitmask global :
  //   - Au mount (fullRender) → fire tous les effects.
  //   - Sinon → fire les effects dont `staticVars` intersecte les vars muées.
  // `staticVars` est calculé par µ.effect côté runtime (cf. mjs_runes.ts).
  _mjs_runEffectsV2(pendingFns, fullRender) {
    const __effs = this._mjs_effects;
    if (!__effs || __effs.length === 0 || this._mjs_has_crashed) return;
    // Récupère les vars muées : on stocke depuis _mjs_invalidate
    // Skip alloc Set() inutile (mutedVars peut rester null si pas de
    // vars muées, on test directement via mutedVars && mutedVars.has(v)).
    // Skip aussi la re-alloc en sortie : sera ré-alloué par _mjs_invalidate au
    // prochain batch ou laissé null.
    const mutedVars = this._mjs_lastMutedVars;
    this._mjs_lastMutedVars = null;
    // <precision>
    // passe sans variable écrite, rien que des `µrefresh($x)` qui redessinent (cf. _mjs_notifyMutation) : aucun effet, pas même ceux qui
    // ne lisent aucune variable connue
    if (!fullRender && mutedVars?.size === 0) return;
    // </precision>
    // passage imbriqué (lancé pendant un effet) : l'effet extérieur redevient l'effet en cours à la fin
    const __effPrev = µ._mjs_effRun;
    // for-let-i au lieu de for-of (V8 spécialise mieux sur Array).
    for (let __ei = 0, __eln = __effs.length; __ei < __eln; __ei++) {
      const e = __effs[__ei];
      // <reffet-before>
      if (e.before) continue;
      // </reffet-before>
      let shouldFire = fullRender;
      const __sv = e.staticVars;
      // <reffets-pass>
      // reffet qui a noté ses lectures au graphe des signaux : le graphe décide, avec les clés du magasin de son relevé (_mjs_effGo)
      if (e.n !== undefined && e.n.deps !== null && e.n.deps.length !== 0) {
        if (!this._mjs_effGo(e, null, mutedVars, fullRender, false)) continue;
        shouldFire = true;
      }
      // </reffets-pass>
      if (!shouldFire && __sv && __sv.length > 0 && mutedVars) {
        for (let __vi = 0, __vln = __sv.length; __vi < __vln; __vi++) {
          if (mutedVars.has(__sv[__vi])) { shouldFire = true; break; }
        }
      }
      // Effects sans staticVars (univ. stores, computed, etc.) : fire toujours
      // (compromis runtime — sera tracké via subscribers au prochain refactor).
      if (!shouldFire && (!__sv || __sv.length === 0)) {
        shouldFire = true;
      }
      if (!shouldFire) continue;
      // effet en cours : une écriture du store faite pendant son passage ne relance pas les effets qui écrivent eux-mêmes
      // la clé (mjs_store_globals.ts)
      µ._mjs_effRun = e;
      // nettoyage (une fonction ou null : seul ce qu'un passage rend de fonction y est rangé) effacé avant d'être joué :
      // un retrait du reffet demandé pendant ce passage (µeffect rend la fonction qui le retire, mjs_effect.ts) ne le
      // rejoue pas
      var __cl = e.cleanup;
      e.cleanup = null;
      try {
        if (__cl) __cl.call(e);
      } catch (err) { µ.warn('Cleanup error:', err); }
      try {
        // reffet retiré (`fn` effacé) : il ne tourne plus ; retiré pendant son propre passage, ce qu'il vient de rendre
        // joue aussitôt, une fois
        const res = e.fn && e.fn();
        if (typeof res === 'function' && !res._mjs_timer) {   // main d'arrêt de µafter / µevery rendue : pas un nettoyage (mjs_every.ts)
          if (e.fn) e.cleanup = res;
          else res.call(e);
        }
      } catch (err) {
        if (typeof this._mjs_catchError === 'function') this._mjs_catchError(err);
      } finally {
        µ._mjs_effRun = __effPrev;
      }
    }
  }

  // purge des états indexés par bloc
  // ({for} imbriqués + {await}) dont l'ancre vit dans le sous-arbre `node`.
  // Appelé UNIQUEMENT aux points de mort DÉFINITIVE de `_mjs_destroyNodeAndChildren`
  // (jamais quand le nœud est seulement `_mjs_dying` : il peut être ressuscité
  // par `_mjs_tryReviveDying`/le revival `hasDying` de `_mjs_reconcileList`).
  // `node` est le plus souvent un élément, mais peut aussi être
  // l'ancre TEXTE d'un {await}/{for} imbriqué (`s-<id>`/`e-<id>`, frère du
  // contenu) : les deux fonctions appelées ci-dessous ne font que des
  // comparaisons/`.contains()` (hérité de `Node`, jamais de `querySelectorAll`),
  // sûres sur un nœud texte comme sur un élément.
  _mjs_mjsPurgeSubtreeState(node) {
    if (this._mjs_list_anchor != null) this._mjs_mjsPurgeNestedListCaches(node);
    if (this._mjs_awaitMap != null) this._mjs_mjsPurgeAwaitMaps(node);
  }

  // PAS `async` : le chemin DOMINANT (pas de crochet de destruction) est 100 % synchrone —
  // une fonction async allouerait une Promise NEUVE à CHAQUE destruction pour rien.
  // `MJS_RESOLVED_DESTROY` (module-level, une seule alloc) préserve le contrat pour
  // les appelants (`.then`/`.catch` toujours disponibles) sans ce coût répété. Seul le
  // chemin AVEC crochets délègue à `_mjs_destroyWithHooks` (mjs_destroy_hooks.ts), qui
  // reste `async` — sa Promise est renvoyée TELLE QUELLE, jamais ré-enveloppée.
  _mjs_destroyNodeAndChildren(node, waitOut = false) {
    // la purge des caches de {for}
    // imbriqués (+ Maps {await}) NE doit PLUS se faire ICI, en TÊTE : un nœud
    // seulement marqué `_mjs_dying` (outro en cours) peut être RESSUSCITÉ
    // (`_mjs_tryReviveDying`, revival `hasDying` de `_mjs_reconcileList`). Purger dès la
    // tête vidait le cache d'un {for} imbriqué dont les rows étaient toujours
    // dans le DOM → au revive, le `_mjs_updList` suivant repartait d'un cache vide
    // et DUPLIQUAIT les rows. On purge donc UNIQUEMENT aux points de mort
    // DÉFINITIVE ci-dessous (via `_mjs_mjsPurgeSubtreeState`), où le nœud ne peut
    // plus revivre. Les chemins SANS outro purgent au même tick qu'avant (les
    // 3 fast-paths retirent le nœud immédiatement).
    if (node.nodeType !== 1) {
      // CORRECTIF — l'ancre TEXTE d'un {await} (`s-<id>`/
      // `e-<id>`, FRÈRE du contenu, jamais descendant) sortait ici SANS jamais passer
      // par `_mjs_mjsPurgeSubtreeState` : `_mjs_awaitMap`/`_mjs_awaitLastRender` restaient peuplés
      // à la fermeture de la branche {if}/{key} englobante, et `_mjs_updAwait` retrouvait au
      // ré-affichage la MÊME promesse + le MÊME dernier statut rendu → le contenu du
      // {await} ne réapparaissait jamais. Un nœud texte n'a jamais `_mjs_outro`/
      // `_mjs_dying` : sa mort est toujours DÉFINITIVE, la purge est donc sans risque
      // (cf. commentaire ci-dessus sur les points de mort définitive).
      this._mjs_mjsPurgeSubtreeState(node);
      µ._mjs_rm(node);
      return MJS_RESOLVED_DESTROY;
    }
    if (node._mjs_dying) {
      return MJS_RESOLVED_DESTROY;
    }
    // Fast path "no destroy hooks" : si le composant entier n'a JAMAIS
    // déclaré de `@transition/@in/@out/@attach/@this=!/@flip` au compile-time
    // (flag posé via `static _mjs_noDestroyHooks = true`), aucun descendant
    // ne peut avoir `_mjs_outro` / `_mjs_td` / `_mjs_ref_td` / `_mjs_global`.
    // On peut bypass complet le walk DFS + le pipeline transitions.
    // Gain massif sur replace1k / clear1k (1000 destroy × walk évité).
    if (!waitOut && this.constructor._mjs_noDestroyHooks === true) {
      node._mjs_dead = true;
      // Mort définitive (no-destroy-hooks ⇒ pas d'outro ⇒ pas de revive).
      this._mjs_mjsPurgeSubtreeState(node);
      µ._mjs_rm(node);
      return MJS_RESOLVED_DESTROY;
    }
    // Au-delà de ce point, le composant PEUT porter des hooks de destruction
    // (transitions/@attach/@this=!/@flip) — la suite (marquage `_mjs_dying`, 2e
    // fast-path dynamique, orchestration des teardowns/outros) vit désormais dans
    // src/runtime/mjs_destroy_hooks.ts, DÉTACHÉ du cœur. Ce point n'est atteignable
    // QUE si le compilateur a détecté `hasDestroyHooks` pour AU MOINS un composant
    // du projet — sinon `_mjs_noDestroyHooks` vaudrait `true` PARTOUT et le
    // fast-path ci-dessus aurait déjà retourné : le fichier est donc TOUJOURS
    // présent ici pour un projet réel (cf. son en-tête). Filet défensif quand même
    // (mêmes gestes que le fast-path ci-dessus) si un bug de détection manquait
    // malgré tout un émetteur.
    if (typeof this._mjs_destroyWithHooks === 'function') {
      return this._mjs_destroyWithHooks(node, waitOut);
    }
    node._mjs_dead = true;
    this._mjs_mjsPurgeSubtreeState(node);
    µ._mjs_rm(node);
    return MJS_RESOLVED_DESTROY;
  }

  // <attr-upd>
  _mjs_updAttr(id, attrName, val, safe) {
    // Inspiré Solid `setAttribute` : skip hasAttribute (qui read attr map)
    // avant removeAttribute, et skip String() si déjà string.
    // V8 spécialise mieux getAttribute===setAttribute branch que has+set.
    // Logique déléguée à `µ._mjs_updAttrNode` (voir sa définition en tête de
    // fichier) — root et `{for}` partagent désormais EXACTEMENT le même code.
    µ._mjs_updAttrNode(this._mjs_nodes[id], attrName, val, safe);
  }
  // </attr-upd>

  // `_mjs_updHtml` (interpolation brute `{{…}}`) : mjs_html.ts, joint seulement si le code compilé
  // l'appelle.

  // <root-text>
  // hors du cœur de production quand aucune unité ni aucun module du cœur ne l'appelle (bundler/index.ts)
  _mjs_updText(id, val) {
    // Inspiré Solid `insertExpression` : skip String() si déjà string,
    // assigne direct via node.data (équivalent nodeValue mais plus rapide en V8
    // car node.data est un slot Text-specific, pas une property Node générique).
    // V8 spécialise mieux le get/set sur Text.data que sur Node.nodeValue.
    const node = this._mjs_nodes[id];
    if (!node) return;
    // Coerce uniquement si non-string. Number → toString natif. null/undefined → ''.
    // Évite `String(val)` qui allocate même si val est déjà la string courante.
    const t = typeof val;
    const s = t === 'string' ? val
            : (val == null ? '' : (t === 'number' ? '' + val : String(val)));
    if (node.data !== s) {
      node.data = s;
    }
  }
  // </root-text>

  // Garde de réentrance pour `_mjs_renderStruct`. Si une var structurelle mute
  // PENDANT le rendu (ex. l'interpolation d'un item de `{for}` qui écrit un
  // `$`, ce qui déclenche `_mjs_invalidate` → un nouvel appel structurel), l'appel
  // imbriqué NE relance PAS `_mjs_renderStruct` (sinon la liste se reconstruit en
  // double) : il pose `_mjs_renderStructDirty`, et la boucle ci-dessous rejoue une
  // passe de plus avec l'état final. Aucun update perdu, aucun double rendu.
  // Coût : O(1) autour d'une opération déjà lourde — n'affecte aucun hot path
  // par-item (`_mjs_reconcileList`, `_mjs_updText`… intacts).
  _mjs_safeRenderStruct() {
    if (this._mjs_inRenderStruct) {
      this._mjs_renderStructDirty = true;
      return;
    }
    this._mjs_inRenderStruct = true;
    try {
      let __guard = 0;
      do {
        this._mjs_renderStructDirty = false;
        this._mjs_renderStruct();
      } while (this._mjs_renderStructDirty && ++__guard < 20);
      // passe finie : plus rien d'écrit en attente (la 1re passe, complète, fait naître le registre)
      if (this._mjs_chgd) this._mjs_chgd.clear();
      else this._mjs_chgd = new Set();
      if (this._mjs_renderStructDirty) {
        // Sortie de boucle PAR LE GARDE : un cycle réactif réel re-mute une
        // var structurelle à chaque passe. Avant : abandon silencieux, DOM
        // potentiellement incohérent et bug user indétectable.
        µ.warn(µ._mjs_msg('elStructLoop', { tag: this.tagName?.toLowerCase() }, '<{tag}> : boucle de mutations structurelles détectée (20 passes) — re-render abandonné. Une var pilotant un {for}/{if} est probablement re-mutée par le rendu lui-même.'));
      }
    } finally {
      this._mjs_inRenderStruct = false;
    }
  }

  // (`_updElement` supprimé : orphelin — la version vivante de
  // `<@element>` est `µ._updDynEl` (mjs_runes, marqueur `mjs-el`) ; aucun
  // émetteur dans le générateur, et il ne ré-enregistrait pas `_nodeIds`.)

  _mjs_catchError(err) {
    var ref;
    µ.error(`Crash intercepted in ${(ref = this.tagName) != null ? ref.toLowerCase() : void 0}:`, err);
    this._mjs_has_crashed = true;
    this.classList.add('mjs-error');
    this._mjs_render_scheduled = false;
    // Frontière `<@failed>` — repli propre, propagation vers l'ancêtre qui en porte un, limite de
    // réessai — dans mjs_failed.ts, joint seulement si une source compilée pose un repli (balise
    // `<@failed>` ou rune nue `µfailed`, les deux SEULS écrivains de `_mjs_fallback`). Absente,
    // aucun composant n'a de repli : rien à rendre, aucun ancêtre à trouver, l'overlay fatal
    // ci-dessous suffit. Rend `true` quand le crash est pris en charge (repli affiché ou remonté).
    if (this._mjs_runBoundary && this._mjs_runBoundary(err)) return;
    this._shadow.textContent = "";
    // Pas de fallback OU fallback en erreur → overlay fatal. textContent (pas
    // innerHTML) : err.message reflète souvent l'entrée utilisateur (JSON.parse,
    // validations…) — un message contenant `<img onerror=…>` s'exécutait au
    // crash (XSS).
    // Garde-fou — compteur STRUCTUREL (jamais un test de sous-chaîne sur le HTML
    // sérialisé, faux positif sur une PROSE qui cite la classe) : lu tel quel par renderToString.ts
    // (fenêtre happy-dom) et par render-browser.ts (page.evaluate), un crash SANS frontière <@failed>
    // absorbante et un seul.
    µ._fatalErrors = (µ._fatalErrors || 0) + 1;
    var __fatal = document.createElement('div');
    __fatal.className = 'mjs-fatal-error';
    // n'importe quelle valeur jetée (`undefined`, un Symbol, un objet sans prototype) : son texte, jamais une seconde
    // exception ici
    let __txt = '';
    try { __txt = ': ' + String(err?.message ?? err); } catch { /* valeur sans texte */ }
    __fatal.textContent = 'Fatal Error' + __txt;
    // en production le texte est d'abord court : le fichier de messages, à son arrivée, réécrit ce bandeau
    if (Object.isExtensible(err)) err._mjs_fatal = __fatal;
    this._shadow.appendChild(__fatal);
  }

  // V2 — `_runEffects` legacy retiré (utilisait bitmask + `_getEmptyMask`).
  // Remplacé par `_mjs_runEffectsV2` au-dessus, qui filtre par intersection de
  // varNames avec les vars muées.

};

// connexion courante du composant, lue par `@attach` : une balise dont `_mjs_att` vaut cette
// valeur a déjà reçu son attache et le rendu suivant la saute (cf. bindingAttach, générateur) ;
// valeur de départ sur le prototype, avancée par `disconnectedCallback` sur l'instance
µ.Element.prototype._mjs_ae = 1;
