// mjs_state.ts — la rune publique µ.state (objet réactif, proxys récursifs sur les collections natives).
// Détachée de mjs_runes.ts : le cœur n'en a pas besoin, seuls le code d'un projet qui l'écrit (`µ.state(`,
// `µ$x = …`) et les modules optionnels qui s'en servent l'appellent. Le registre des dépendances
// universelles (`µ._mjs_registerUniversalDep` & co) reste dans mjs_runes.ts, que ce fichier suit.
// Méthodes MUTATRICES des collections natives (Array/Map/Set/Date) — set
// module-level (1 alloc), aligné sur `MJS_STORE_MUTATORS` de mjs_store.ts. Voir
// `_wrap` : appelées via le proxy d'une collection de store, elles notifient les
// abonnés (avant, `_wrap` rendait ces collections BRUTES → `$$todos
// .push()` / `$$m.set()` / `$$s.add()` mutaient en SILENCE, sans re-render).
// `setInt8`…`setBigUint64` : setters NOMMÉS d'une DataView (même famille que les `setX` de Date
// juste avant, énumérés pareillement plutôt qu'un test de motif) — sans eux, muter par cette
// voie ne notifiait personne (même défaut que µ.Store, mjs_store.ts).
const MJS_STATE_MUTATORS = new Set(['set', 'add', 'delete', 'clear', 'setTime', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds', 'push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin', 'setInt8', 'setUint8', 'setInt16', 'setUint16', 'setInt32', 'setUint32', 'setFloat32', 'setFloat64', 'setBigInt64', 'setBigUint64']);

// CRITIQUE — mutation
// PROFONDE d'un store universel totalement silencieuse : `$$game.score += 10`
// (l'exemple même documenté par mjs_store_globals.ts) lisait `µ.store.game` (le get
// trap racine retournait le sous-objet BRUT, sans wrap récursif), puis mutait
// `.score` sur cet objet ordinaire — AUCUN trap ne voit passer cette écriture,
// donc AUCUNE notification. `µ.Store._mjs_buildProxy` (mjs_store.ts) résout déjà
// ce problème pour les singletons importés (`µ$$x`) en wrappant récursivement
// chaque sous-objet lu, avec un cache d'identité (WeakMap) et un `rootKey`
// qui bubble TOUJOURS la notification vers la clé de PREMIER NIVEAU — même
// stratégie portée ici, sur les primitives `µ._mjs_registerUniversalDep` /
// `µ._mjs_notifyUniversalChange` / `µ._mjs_STRUCT` déjà existantes (pas de nouveau
// mécanisme : la clé mutée profondément notifie comme si c'était la clé
// racine elle-même qui avait changé — cohérent avec µ.Store).
// <signaux>
// propriétaire des boîtes de chaque état dans le graphe des signaux (mjs_signals.ts), retrouvé depuis l'objet brut
// (`µ._mjs_toRaw(état)`) : un objet à part, jamais énuméré avec les clés de l'état
if (!µ._mjs_stateSig) µ._mjs_stateSig = new WeakMap();
// </signaux>
// <carnet>
// écriture sous la racine d'un état (`µ$$panier.items[0].nom = v`) : l'objet écrit, la valeur de sa clé et l'état entier préviennent les
// composants qui les tiennent dans une variable `$` (µ._mjs_carnetVoit, mjs_init.ts) — trois lectures du carnet par écriture
function _mjsStateCarnet(o, internal, rootKey) {
  var r = internal[rootKey];
  µ._mjs_carnetVoit(o);
  if (r !== o && r !== null && typeof r === 'object') µ._mjs_carnetVoit(r);
  if (internal !== o) µ._mjs_carnetVoit(internal);
}
// </carnet>
// les enveloppes des objets d'un état : une FICHE par objet brut, qui est le gestionnaire de son Proxy, aux pièges communs (MJS_STATE_COLL pour
// une collection native, MJS_STATE_OBJ pour un objet) ; elle ne garde que ses champs, sans fermeture — `e`, l'objet de la famille (un par
// état : `_mjs_rootsByTarget`, objet brut → fiche, qui est aussi le carnet des enveloppes ; `i`, l'objet brut de l'état ; `g`, le
// propriétaire de ses boîtes de signaux ; `k`, sa garde des clés ; `w`, vrai quand le cœur porte les liens vers les conteneurs), `r` la clé
// racine de sa création, `s` l'ensemble des clés qui l'atteignent (posé à la deuxième), `x` son enveloppe, `a` `b` `l` `v` ses liens vers ses
// conteneurs (cf. _mjsLie, mjs_element.ts). L'objet de la famille a la forme de ce que les aides des liens lisent d'un composant (`_state`,
// `_mjs_computeds`, `_mjs_bindEpochs` ; `_mjs_wr` absent : tout détenteur est un autre)
// la clé `k` atteint l'objet de la fiche `f` : une clé de plus que celle qui l'a créée fait son ensemble (même règle que _mjsCle,
// mjs_element.ts, absente d'un cœur sans l'enveloppe)
function _mjsStateCle(f, k) {
  if (k !== f.r) (f.s ||= new Set([f.r])).add(k);
}
// écriture sous la clé racine de la fiche `f` : les lecteurs de TOUTES les clés qui atteignent l'objet sont prévenus (`f.s`), une seule fois
// chacun — le cache est à UN SEUL niveau (`state.a === state.b`, cf. tests d'identité) : un lecteur qui descend (`.x`) après avoir atteint
// l'objet par une autre clé que celle de la création de son enveloppe s'abonne à la fois à la clé racine lue en premier et à celle de la
// fiche ; sans dédoublonnage, ce même composant serait invalidé une fois par clé, pour une seule mutation
function _mjsStateNotifie(f) {
  const fam = f.e, s = f.s;
  // <signaux>
  if (fam.g._mjs_sigBoxes) {
    if (s === void 0) µ._mjs_sigWrite(fam.g, f.r);
    else s.forEach((k) => µ._mjs_sigWrite(fam.g, k));
  }
  // </signaux>
  if (s === void 0) {
    µ._mjs_notifyUniversalChange(fam.i, f.r);
    return;
  }
  const deps = µ._mjs_universalDeps.get(fam.i);
  if (!deps) return;
  const notified = new Set();
  s.forEach((key) => {
    const subs = deps[key];
    if (!subs) return;
    subs.forEach((comp) => {
      if (notified.has(comp)) return;
      notified.add(comp);
      comp._mjs_invalidate('_awaits_');
    });
  });
}
// les liens vers les conteneurs ne servent que si un composant peut tenir un objet de l'état : une appli de production sans prop
// (`<milieu>` absent, bundler/index.ts) n'en porte que trois aides vides
// <milieu>
// premier sous-objet lu par la fiche `h` du conteneur `obj` : sa référence faible, que ses sous-objets gardent pour lien — seulement quand un
// composant peut tenir un objet de l'état (µ._mjs_milieu) et que le cœur porte les liens ; rend la fiche, passée à l'enveloppeur
function _mjsStateVia(h, obj) {
  if (h.v === void 0 && µ._mjs_milieu && h.e.w) h.v = µ._mjs_ref(obj);
  return h;
}
// écriture faite par l'enveloppe de la fiche `h` dans `obj` : elle remonte les liens de l'objet et fait avancer l'époque des conteneurs
// qu'un composant tient (cf. _mjsMonte, mjs_element.ts) ; quand elle ne répond pas de tous les conteneurs (fiche pas sûre, plus de 32
// objets), l'état se replie
function _mjsStateMonte(h, obj) {
  if (µ._mjs_milieu && h.e.w && µ._mjs_monte(h, obj)) _mjsStateRepli(h);
}
// LE REPLI : la remontée n'a pas fait avancer tous les conteneurs de l'objet écrit, un enfant qui en tient un n'y verrait qu'un écho. Les
// abonnés que l'écriture va prévenir (clés de la fiche `h`) redisent leurs liaisons à leur prochaine passe (marque de redite posée avant,
// mode 2, cf. _mjsRedire, mjs_element.ts) : l'enfant à qui l'une d'elles repose son objet suit, jamais un écran figé
function _mjsStateRepli(h) {
  // <redite>
  const deps = µ._mjs_universalDeps.get(h.e.i);
  if (deps) (h.s || [h.r]).forEach((k) => {
    if (deps[k]) deps[k].forEach((c) => {
      (c._mjs_rdp ||= Object.create(null))._awaits_ = 2;
    });
  });
  // </redite>
}
// objet `av` retiré du conteneur `obj` par une affectation ou une suppression : son lien vers lui devient douteux (cf. _mjsSorti, mjs_element.ts)
function _mjsStateSorti(h, obj, av) {
  if (µ._mjs_milieu && h.v != null && av !== null && typeof av === 'object') µ._mjs_sorti(h.e._mjs_rootsByTarget, h.v, obj, av);
}
// </milieu>
// <sans-milieu>
// const _mjsStateVia = () => void 0, _mjsStateMonte = _mjsStateVia, _mjsStateSorti = _mjsStateVia;
// </sans-milieu>
// <familles>
// une variable d'un composant qui tient un objet de cet état (fiche `h`, notée par `_set`) l'a écrit, ou un objet plus bas `obj` : l'état
// est prévenu comme après une écriture faite par son piège `set`, sans réécrire la donnée — l'époque de l'objet a déjà avancé, prise par
// l'écrivain (cf. _mjsFil, mjs_element.ts)
µ._mjs_stateFil = function(h, obj) {
  const g = h.e._mjs_rootsByTarget.get(obj) || h, o = g === h ? µ._mjs_toRaw(h.x) : obj;
  _mjsStateMonte(g, o);
  _mjsStateNotifie(g);
  // <carnet>
  _mjsStateCarnet(o, h.e.i, h.r);
  // </carnet>
};
// </familles>
// `_mjsStateWrap` : construit (ou retrouve) l'enveloppe d'un sous-objet de l'état de la famille `fam`. `rootKey` = la clé de PREMIER NIVEAU
// sous laquelle ce sous-objet a été atteint (héritée telle quelle à chaque descente, jamais réécrite — comme `rootKey || prop` de µ.Store) ;
// `via`, la fiche du conteneur qui le lit (absente pour une lecture à la racine)
function _mjsStateWrap(fam, target, rootKey, via) {
  if (target === null || typeof target !== 'object') return target;
  // reconnaissance d'enveloppe à l'ENTRÉE, symétrique de _mjs_wrapDeep
  // (mjs_element.ts) et _mjs_buildProxy (mjs_store.ts) : une valeur déjà proxifiée
  // par un autre filet est déballée jusqu'au brut AVANT cache/re-wrap — sans
  // ça, µ.state({list: $items}) posait un Proxy-de-Proxy transitoire.
  target = µ._mjs_toRaw(target);
  // Respecter `µ.raw(obj)` : jamais de proxy ni de notification sur une
  // cible marquée brute — restaure le contrat de µ.raw, aligné sur µ.Store.
  if (µ._mjs_rawSet.has(target)) return target;
  // Promise en vol : jamais proxifiée (le wrap casserait le brand-check `.then`).
  if (target instanceof Promise) return target;
  // déjà enveloppé par cet état : CETTE clé racine s'ajoute aux voies d'accès de sa fiche — `state.b` ajoute 'b' même si `shared` a été
  // enveloppé par 'a' (`µ.state({a: shared, b: shared})` : une seule enveloppe, `state.a === state.b`, et une écriture prévient les
  // lecteurs des deux clés) ; lu par un autre conteneur que la dernière fois, son lien est revu — une comparaison quand c'est le même
  let f = fam._mjs_rootsByTarget.get(target);
  if (f !== void 0) {
    if (rootKey != null) _mjsStateCle(f, rootKey);
    if (via !== void 0 && via.v !== void 0 && f.a !== via.v) µ._mjs_lie(f, via.v, fam);
    return f.x;
  }
  // <precision>
  // <derivees>
  // objet tenu par cet état : une valeur précise d'un composant qui le tient aussi doute (mjs_element.ts)
  µ._mjs_detenu ? µ._mjs_detenu(target, 0) : (µ._mjs_detenusAvant ||= []).push(target);
  // </derivees>
  // </precision>
  // Collections natives (Array/Map/Set/Date) : proxy à mutateurs NOTIFIANTS (MJS_STATE_COLL), stratégie de `µ.Store._mjs_buildProxy` :
  // les méthodes mutatrices notifient `rootKey` (+ `µ._mjs_STRUCT` pour les lecteurs d'énumération) ; méthodes non-mutatrices et
  // éléments liés à la cible BRUTE (brand-check Map/Set/Date + identité des éléments préservés).
  // `ArrayBuffer.isView` couvre TypedArray ET DataView, `instanceof ArrayBuffer` le buffer
  // BRUT (pas une vue) — même famille que Map/Set/Date/Array : leurs méthodes/accesseurs
  // natifs exigent la vraie instance en `this`, incompatible avec le proxy d'un objet (MJS_STATE_OBJ),
  // qui ne lie JAMAIS les fonctions qu'il retourne (aligné sur µ.Store, mjs_store.ts).
  // `WeakMap`, `WeakSet` aussi : leurs méthodes exigent la vraie collection en `this`, comme celles d'une `Map`, d'un `Set`
  const coll = target instanceof Map || target instanceof Set || target instanceof WeakMap || target instanceof WeakSet || target instanceof Date ||
    Array.isArray(target) || ArrayBuffer.isView(target) || target instanceof ArrayBuffer;
  if (coll) {
    // <sans-collections>
    // // <developpement>
    // // collection rangée par un cœur bâti sans la part des collections : le développement le dit (µ._mjs_collMissing, mjs_init.ts)
    // µ._mjs_collMissing(target);
    // // </developpement>
    // </sans-collections>
  }
  f = {
    __proto__: coll ? MJS_STATE_COLL : MJS_STATE_OBJ,
    e:         fam,
    r:         rootKey,
    s:         void 0,
    x:         void 0,
    a:         via !== void 0 ? via.v : void 0,
    b:         void 0,
    v:         void 0
  };
  // <familles>
  // un prototype rangé (`Array.prototype`, par une clé venue de données) : le mur (µ._mjs_mur, mjs_element.ts), sur les pièges d'un objet —
  // ses méthodes passent par l'enveloppe, qui refuse, au lieu d'être appliquées à l'objet brut comme celles d'une liste
  µ._mjs_mur(target, f, MJS_STATE_OBJ);
  // </familles>
  f.x = new Proxy(target, f);
  // <faibles>
  // enveloppe d'une `WeakMap`, d'un `WeakSet` : notée pour µraw, qui en rend la vraie collection (µ._mjs_weakRaw, mjs_init.ts)
  if (target instanceof WeakMap || target instanceof WeakSet) µ._mjs_weakRaw.set(f.x, target);
  // </faibles>
  fam._mjs_rootsByTarget.set(target, f);
  return f.x;
}
// les pièges d'une collection native de l'état (`this`, la fiche)
const MJS_STATE_COLL = (class {
  get(obj, key) {
    if (key === µ._mjs_RAW) return obj;
    // <familles>
    if (key === µ._mjs_FICHE) return this;
    // </familles>
    // pollution de prototype (CWE-1321) : même garde que `set`/`deleteProperty`
    // ci-dessous (garde des clés), côté LECTURE — __proto__/constructor/prototype HÉRITÉS
    // (pas une donnée propre) enveloppaient Object.prototype, exposé ensuite en
    // écriture. Clé PROPRE (donnée métier) : comportement normal.
    if (typeof key === 'string' && !µ._mjs_safeKey(key) && !Object.prototype.hasOwnProperty.call(obj, key)) return void 0;
    if (µ._mjs_initStack.length > 0) { µ._mjs_registerUniversalDep(this.e.i, this.r); }
    const v = obj[key];
    // propriété figée (objet gelé…) : sa valeur, telle quelle — règle des Proxy, cf. µ._mjs_fixed (mjs_init.ts)
    if ((typeof v === 'function' || typeof v === 'object' && v !== null) && µ._mjs_fixed(obj, key)) return v;
    if (typeof v === 'function') {
      if (MJS_STATE_MUTATORS.has(key)) {
        return (...args) => {
          // <collections>
          // la donnée rangée reste brute : un élément ou une valeur tenus par leur enveloppe sont déballés, la clé d'une Map,
          // l'élément d'un Set sont ceux que la collection range pour cet objet, bruts ou enveloppés (cf. µ._mjs_keyIn, mjs_init.ts) : une
          // seule entrée par objet
          const x = args.map((a, i) => i || !(obj instanceof Map || obj instanceof Set || obj instanceof WeakMap || obj instanceof WeakSet) ? µ._mjs_toRaw(a) : µ._mjs_keyIn(obj, a));
          const r = v.apply(obj, x);
          // clé retirée, collection vidée : l'index de la collection l'oublie (cf. µ._mjs_keyDrop, mjs_init.ts)
          if (key === 'delete' || key === 'clear') µ._mjs_keyDrop(obj, key === 'clear', x[0]);
          // </collections>
          // <sans-collections>
          // // sans la part des collections : la donnée rangée reste brute, la clé d'une Map reste telle quelle (`get` la retrouve)
          // const r = v.apply(obj, args.map((a, i) => i || !(obj instanceof Map) ? µ._mjs_toRaw(a) : a));
          // </sans-collections>
          // époque de mutation du brut (cf. mjs_element.ts, `_set`/
          // `_mjs_wrapDeep`) : un composant qui a reçu ce tableau/cette
          // collection en liaison two-way doit pouvoir distinguer un écho
          // pur d'une mutation réelle survenue ICI, côté rune.
          µ._mjs_bumpEpoch(obj);
          _mjsStateMonte(this, obj);
          _mjsStateNotifie(this);
          // <carnet>
          _mjsStateCarnet(obj, this.e.i, this.r);
          // </carnet>
          µ._mjs_notifyUniversalChange(this.e.i, µ._mjs_STRUCT);
          // Map.set/… rendent `this` (chaînage natif) : rendre la cible BRUTE cassait
          // la réactivité de la chaîne — rendre le PROXY à la place (même fix que
          // µ.Store, mjs_store.ts).
          // <familles>
          // un prototype retiré (`pop`, `shift`, `splice` : un `Array.prototype` rangé par une clé venue de données) sort enveloppé, donc muré,
          // comme par l'enveloppe d'un composant (µ._mjs_mur, mjs_element.ts) ; un objet ordinaire retiré sort brut, comme avant
          let c;
          if (key === 'splice') r.forEach((e, i) => { if (e !== null && typeof e === 'object' && (c = e.constructor) && c.prototype === e) r[i] = _mjsStateWrap(this.e, e, this.r, _mjsStateVia(this, obj)); });
          else if ((key === 'pop' || key === 'shift') && r !== null && typeof r === 'object' && (c = r.constructor) && c.prototype === r) return _mjsStateWrap(this.e, r, this.r, _mjsStateVia(this, obj));
          // </familles>
          return r === obj ? this.x : r;
        };
      }
      // méthode qui ne modifie pas la collection (µ._mjs_readFn, mjs_init.ts, commune avec l'état d'un
      // composant et µ.Store) : l'élément rendu, passé au rappel ou sorti d'une Map / d'un Set est enveloppé,
      // le modifier prévient les lecteurs ; une liste retrouve l'objet poussé, tenu brut ou par son enveloppe
      return µ._mjs_readFn(obj, key, v, this.x, (x) => x === null || typeof x !== 'object' ? x : _mjsStateWrap(this.e, x, this.r, _mjsStateVia(this, obj)));
    }
    // un ÉLÉMENT objet d'une collection (`st.list[0]`) : même enveloppe qu'un champ d'objet, même `rootKey` — la fiche garantit
    // `st.list[0] === st.list[0]` ; un non-objet est rendu tel quel
    if (v === null || typeof v !== 'object') return v;
    return _mjsStateWrap(this.e, v, this.r, _mjsStateVia(this, obj));
  }
  // écriture DIRECTE (`arr.length=0`, `arr[i]=x`, `map.x=y`) : le
  // piège `get` ci-dessus ne voit passer QUE les méthodes de MJS_STATE_MUTATORS,
  // une affectation nue mutait le brut en silence (aucune notification). Même
  // schéma que le piège d'un objet (MJS_STATE_OBJ), rootKey systématique,
  // `µ._mjs_STRUCT` sur ajout de clé/index.
  set(obj, key, value) {
    // proto-pollution (CWE-1321) : `arr['__proto__']=…`/
    // `arr['constructor']=…` passaient SANS garde (contrairement à
    // `_mjs_wrapDeep`/`µ.Store`, qui filtrent déjà cette même famille de clés) —
    // remplaçait le PROTOTYPE de l'INSTANCE. Même garde que celle d'un objet.
    if (this.e.k(key)) return true;
    value = µ._mjs_rawIn(value);
    const av = obj[key];
    if (av === value) return true;
    const isNew = !(key in obj);
    // `Object.freeze(st.arr)` puis écriture : retourner
    // `true` inconditionnellement ici violait l'invariant Proxy (le moteur exige
    // que le trap `set` rapporte le résultat RÉEL sur une prop non-configurable/
    // non-writable du target) → TypeError « trap returned truish… » non liée à un
    // vrai refus. `Reflect.set` porte ce résultat, et seule une écriture RÉUSSIE
    // notifie.
    const success = Reflect.set(obj, key, value);
    if (success) {
      µ._mjs_bumpEpoch(obj);
      _mjsStateMonte(this, obj);
      _mjsStateSorti(this, obj, av);
      _mjsStateNotifie(this);
      // <carnet>
      _mjsStateCarnet(obj, this.e.i, this.r);
      // </carnet>
      if (isNew) µ._mjs_notifyUniversalChange(this.e.i, µ._mjs_STRUCT);
    }
    return success;
  }
  // `delete arr[i]` : même trou que `set` ci-dessus.
  deleteProperty(obj, key) {
    // même garde proto-pollution que le `set` ci-dessus.
    if (this.e.k(key)) return true;
    const had = key in obj;
    const av  = µ._mjs_milieu && this.v != null ? Reflect.getOwnPropertyDescriptor(obj, key)?.value : void 0;
    // même invariant Proxy que le `set` ci-dessus
    // (`delete arr.length` sur un Array natif refuse : non-configurable) —
    // résultat RÉEL de `Reflect.deleteProperty`, pas `true` en dur.
    const success = Reflect.deleteProperty(obj, key);
    if (success && had) {
      µ._mjs_bumpEpoch(obj);
      _mjsStateMonte(this, obj);
      _mjsStateSorti(this, obj, av);
      _mjsStateNotifie(this);
      // <carnet>
      _mjsStateCarnet(obj, this.e.i, this.r);
      // </carnet>
      µ._mjs_notifyUniversalChange(this.e.i, µ._mjs_STRUCT);
    }
    return success;
  }
}).prototype;
// les pièges d'un objet de l'état (`this`, la fiche)
const MJS_STATE_OBJ = (class {
  get(obj, key) {
    if (key === µ._mjs_RAW) return obj;
    // <familles>
    if (key === µ._mjs_FICHE) return this;
    // </familles>
    // même garde que celle d'une collection (CWE-1321) : __proto__/constructor/prototype
    // HÉRITÉS (pas une donnée propre) exposaient Object.prototype, enveloppé, en écriture.
    if (typeof key === 'string' && !µ._mjs_safeKey(key) && !Object.prototype.hasOwnProperty.call(obj, key)) return void 0;
    if (µ._mjs_initStack.length > 0) {
      µ._mjs_registerUniversalDep(this.e.i, this.r);
    }
    const val = obj[key];
    // un dérivé compilé porte sa fonction `f` : une donnée reçue qui a la clé `_mjs_c` n'en est pas un
    if ((val != null) && val._mjs_c && typeof val.f === 'function') {
      if (val._mjs_evaluating) {
        µ.warn(µ._mjs_msg('runesCycle', { key: String(key) }, 'µ.state : cycle de computed détecté sur « {key} » — undefined retourné.'));
        return void 0;
      }
      val._mjs_evaluating = true;
      try {
        return val.f.call(this.x);
      } finally {
        val._mjs_evaluating = false;
      }
    }
    if (val === null || typeof val !== 'object') return val;
    // propriété figée (objet gelé…) : sa valeur, telle quelle — règle des Proxy, cf. µ._mjs_fixed (mjs_init.ts)
    if (µ._mjs_fixed(obj, key)) return val;
    return _mjsStateWrap(this.e, val, this.r, _mjsStateVia(this, obj));
  }
  set(obj, key, value) {
    // même garde proto-pollution que celle d'une collection :
    // `st.obj['__proto__']=…`/`st.obj['constructor']=…` passaient SANS garde ni avertissement,
    // remplaçant le PROTOTYPE de l'objet BRUT.
    if (this.e.k(key)) return true;
    // Déballer un éventuel proxy stocké : `store.b = store.a` ne doit
    // pas empiler proxy-sur-proxy (notifs/abonnements dupliqués en profondeur).
    value = µ._mjs_rawIn(value);
    const av = obj[key];
    if (av === value) return true;
    // ne notifier µ._mjs_STRUCT (itérations `{for k in $$obj}`) que sur AJOUT
    // de clé : une simple mutation de valeur ne change pas la structure. Aligne
    // µ.state sur µ.Store → plus de re-rendu structurel superflu.
    const isNew = !(key in obj);
    // `Object.freeze(st.obj)` puis écriture : `true` en dur violait
    // l'invariant Proxy sur une propriété non-configurable/non-writable (même bogue que sur
    // une collection, symétrique). `Reflect.set` porte le résultat RÉEL, seule une écriture RÉUSSIE notifie.
    const success = Reflect.set(obj, key, value);
    if (success) {
      // époque de mutation du brut `obj` (cf. mjs_element.ts).
      µ._mjs_bumpEpoch(obj);
      _mjsStateMonte(this, obj);
      _mjsStateSorti(this, obj, av);
      _mjsStateNotifie(this);
      // <carnet>
      _mjsStateCarnet(obj, this.e.i, this.r);
      // </carnet>
      if (isNew) µ._mjs_notifyUniversalChange(this.e.i, µ._mjs_STRUCT);
    }
    return success;
  }
  deleteProperty(obj, key) {
    // même garde proto-pollution que `set` ci-dessus.
    if (this.e.k(key)) return true;
    const had = key in obj;
    const av  = µ._mjs_milieu && this.v != null ? Reflect.getOwnPropertyDescriptor(obj, key)?.value : void 0;
    // même invariant Proxy que `set` ci-dessus : résultat RÉEL de
    // `Reflect.deleteProperty`, pas `true` en dur.
    const success = Reflect.deleteProperty(obj, key);
    if (success && had) {
      µ._mjs_bumpEpoch(obj);
      _mjsStateMonte(this, obj);
      _mjsStateSorti(this, obj, av);
      _mjsStateNotifie(this);
      // <carnet>
      _mjsStateCarnet(obj, this.e.i, this.r);
      // </carnet>
      µ._mjs_notifyUniversalChange(this.e.i, µ._mjs_STRUCT);
    }
    return success;
  }
  ownKeys(obj) {
    if (µ._mjs_initStack.length > 0) { µ._mjs_registerUniversalDep(this.e.i, this.r); }
    return Reflect.ownKeys(obj);
  }
}).prototype;
µ.state = function(initialData = {}) {
  var _internal, proxy;
  _internal = typeof initialData === 'object' ? {...initialData} : {
    value: initialData
  };
  // <signaux>
  // une boîte n'y naît qu'à la première lecture notée d'une clé (µ._mjs_STRUCT : l'énumération) ; les écritures de la racine et des
  // sous-objets l'avancent aux mêmes points que les lecteurs prévenus plus bas ; sans lecteur, une lecture et un test
  const _sigOwner = { _mjs_sigBoxes: null };
  µ._mjs_stateSig.set(_internal, _sigOwner);
  // </signaux>
  // garde proto-pollution (CWE-1321) PARTAGÉE par la racine (proxy `set`/
  // `defineProperty`/`deleteProperty` de `µ.state`, plus bas) ET les proxys imbriqués
  // (`_wrap`, juste après) : __proto__/constructor/prototype refusés en écriture PARTOUT,
  // avec le même avertissement — avant, seule la racine en était dépourvue
  // (`state.__proto__ = x` remplaçait le prototype sans le moindre avertissement).
  // le refus se dit par une trace de développement, une fois par nom pour cet état (rien en production) : une écriture
  // répétée, à chaque image, ne remplit pas la console
  let _refusDits;
  const _guardKey = (key) => {
    if (typeof key !== 'string' || µ._mjs_safeKey(key)) return false;
    if (!(_refusDits ||= new Set()).has(key)) {
      _refusDits.add(key);
      µ._mjs_logger()?.('[ModularJS] ' + µ._mjs_txt('runesKey', { key: key }, 'µ.state : clé refusée (« {key} ») — mutation ignorée.'));
    }
    return true;
  };
  // l'objet de la famille de cet état (cf. MJS_STATE_COLL, plus haut) : sa table objet brut → fiche remplace le carnet des enveloppes et
  // l'ensemble des clés par objet ; `w` se lit une fois, le cœur porte les liens vers les conteneurs (`<familles>`, mjs_element.ts) ou non
  const fam = {
    _mjs_rootsByTarget: new WeakMap(),
    _state:             _internal,
    _mjs_computeds:     void 0,
    _mjs_bindEpochs:    {},
    i:                  _internal,
    // <signaux>
    g:                  _sigOwner,
    // </signaux>
    k:                  _guardKey,
    w:                  µ._mjs_lie !== void 0
  };
  const _wrap = (target, rootKey) => _mjsStateWrap(fam, target, rootKey, void 0);
  // <precision>
  // <derivees>
  µ._mjs_detenu ? µ._mjs_detenu(_internal, 0) : (µ._mjs_detenusAvant ||= []).push(_internal);
  // </derivees>
  // </precision>
  proxy = new Proxy(_internal, {
    get: function(target, key) {
      // Accès à la cible BRUTE — utilisé par l'unwrap du set trap pour
      // ne pas empiler proxy-sur-proxy lors d'une réaffectation entre clés.
      if (key === µ._mjs_RAW) return target;
      // même garde que les proxys imbriqués (`_wrap`, plus haut) : __proto__/constructor/
      // prototype HÉRITÉS (pas une donnée propre) exposaient Object.prototype, enveloppé, en
      // écriture — la racine n'avait AUCUNE garde en lecture.
      if (typeof key === 'string' && !µ._mjs_safeKey(key) && !Object.prototype.hasOwnProperty.call(target, key)) return void 0;
      // Fast path : skip activeComponent lecture (getter sur stack)
      // si on est hors init. La majorité des reads se font après init.
      // µ._mjs_initStack.length === 0 est O(1), pas de stack traversal.
      // 1. Tracking universel : si un composant lit ce store, on l'enregistre
      // comme dépendant pour déclencher son re-render à la moindre mutation.
      if (µ._mjs_initStack.length > 0) {
        µ._mjs_registerUniversalDep(target, key);
      }
      const val = target[key];
      // 2. Déballage automatique des computed (`_mjs_c`) — même logique que
      // `_mjs_buildProxy` côté composant. C'est ce qui rend possible les
      // auto-derived dans les modules externes (`$.x = $.y * 2` posé par
      // l'analyzer AST). Sa fonction `f` le distingue d'une donnée qui porterait la clé `_mjs_c`.
      if ((val != null) && val._mjs_c && typeof val.f === 'function') {
        // Garde de cycle (même pattern que `_mjs_setComputed`) : deux computed
        // qui se lisent mutuellement partaient en récursion infinie
        // (RangeError brut, sans indice sur la clé fautive).
        if (val._mjs_evaluating) {
          µ.warn(µ._mjs_msg('runesCycle', { key: String(key) }, 'µ.state : cycle de computed détecté sur « {key} » — undefined retourné.'));
          return void 0;
        }
        val._mjs_evaluating = true;
        try {
          return val.f.call(proxy);
        } finally {
          val._mjs_evaluating = false;
        }
      }
      // Réactivité profonde (fix ci-dessus) : un sous-objet est retourné
      // enveloppé, avec `rootKey = key` (clé de premier niveau) — toute
      // mutation, à quelque profondeur que ce soit sous cette clé, notifie
      // comme si `key` elle-même avait changé.
      return _wrap(val, key);
    },
    set: function(target, key, value) {
      // même garde que les proxys imbriqués (_guardKey, cf. plus haut) : la racine en était
      // dépourvue — `state.__proto__ = x` remplaçait le prototype de l'état sans le moindre
      // avertissement (CWE-1321).
      if (_guardKey(key)) return true;
      // Déballer un proxy µ.state stocké : `store.b = store.a` doit ranger
      // la cible BRUTE, pas le proxy (sinon re-wrap en chaîne à chaque relecture).
      value = µ._mjs_rawIn(value);
      if (target[key] === value) {
        return true;
      }
      target[key] = value;
      // <signaux>
      // la clé, puis la structure, comme les lecteurs prévenus ci-dessous
      if (_sigOwner._mjs_sigBoxes) {
        µ._mjs_sigWrite(_sigOwner, key);
        µ._mjs_sigWrite(_sigOwner, µ._mjs_STRUCT);
      }
      // </signaux>
      // époque de mutation du brut (cf. mjs_element.ts, `_set`/`_mjs_wrapDeep`).
      µ._mjs_bumpEpoch(target);
      // <carnet>
      µ._mjs_carnetVoit(target);
      // </carnet>
      µ._mjs_notifyUniversalChange(target, key);
      // Un lecteur peut dépendre de la *structure* (énumération via `{for … in @store}`)
      // sans lire cette clé précise. On le réveille aussi : sur une clé neuve (ajout/reset) ET
      // sur mise à jour de valeur (positions d'un stream qui bougent). No-op s'il n'y a
      // aucun abonné structure — les stores lus par clé fixe (ex. `@sock.state`) ne
      // sont jamais énumérés, donc jamais impactés.
      µ._mjs_notifyUniversalChange(target, µ._mjs_STRUCT);
      return true;
    },
    deleteProperty: function(target, key) {
      // même garde que `set` ci-dessus (symétrique).
      if (_guardKey(key)) return true;
      // Sans ce trap, `delete monStore.x` retirait bien la clé mais ne notifiait
      // AUCUN lecteur → pas de re-render. On notifie comme le set trap (uniquement
      // si la clé existait, pour ne pas réveiller les composants sur un no-op).
      var had = key in target;
      delete target[key];
      if (had) {
        µ._mjs_bumpEpoch(target);
        // <carnet>
        µ._mjs_carnetVoit(target);
        // </carnet>
        // <signaux>
        if (_sigOwner._mjs_sigBoxes) {
          µ._mjs_sigWrite(_sigOwner, key);
          µ._mjs_sigWrite(_sigOwner, µ._mjs_STRUCT);
        }
        // </signaux>
        µ._mjs_notifyUniversalChange(target, key);
        µ._mjs_notifyUniversalChange(target, µ._mjs_STRUCT);
      }
      return true;
    },
    // `Object.defineProperty(state, '__proto__', …)` contournait le trap `set` ci-dessus
    // (chemin d'écriture DIFFÉRENT du Proxy) — même garde, même message (cf. µ.Store,
    // mjs_store.ts).
    defineProperty: function(target, key, desc) {
      if (_guardKey(key)) return false;
      return Reflect.defineProperty(target, key, desc);
    },
    ownKeys: function(target) {
      // Énumération = dépendance sur l'ENSEMBLE des clés (cf. µ._mjs_STRUCT ci-dessus).
      if (µ._mjs_initStack.length > 0) { µ._mjs_registerUniversalDep(target, µ._mjs_STRUCT); }
      return Reflect.ownKeys(target);
    }
  });
  return proxy;
};
