// mjs_store.coffee
// Mutators set static module-level (1 alloc au lieu de N par store). `setInt8`…`setBigUint64` :
// setters NOMMÉS d'une DataView (même famille que les `setX` de Date juste avant, énumérés
// pareillement plutôt qu'un test de motif) — sans eux, muter par cette voie ne notifiait personne.
const MJS_STORE_MUTATORS = new Set(['set', 'add', 'delete', 'clear', 'setTime', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds', 'push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin', 'setInt8', 'setUint8', 'setInt16', 'setUint16', 'setInt32', 'setUint32', 'setFloat32', 'setFloat64', 'setBigInt64', 'setBigUint64']);

// les pièges d'une enveloppe du magasin (`this`, sa fiche : cf. _mjs_buildProxy) — `e` le magasin, `r` la clé de départ, `c` vrai pour une
// collection native, `x` l'enveloppe, `B` la `Map` clé → fiche de l'objet, `f` les relais de ses fonctions propres (au premier besoin), `h` la
// fiche du premier couple de l'objet, qui porte `s` (les clés qui l'atteignent, posé à la deuxième) et ses liens vers ses conteneurs `a` `b`
// `l` `v` (cf. _mjsLie, mjs_element.ts) ; le magasin sert d'objet de famille aux aides des liens (`_state`, `_mjs_rootsByTarget`,
// `_mjs_bindEpochs` ; `_mjs_computeds`, `_mjs_wr` absents : aucune clé dérivée, tout détenteur est un autre)
const MJS_STORE_TRAPS = (class {
  get(obj, prop, receiver) {
    const st = this.e;
    var component, val;
    // fast-path symbole EN TÊTE (cf. mjs_runes.ts) : accès à la
    // cible BRUTE pour µ._mjs_toRaw — sans lui, un composant qui reçoit une
    // valeur issue du store ne la reconnaît jamais comme une enveloppe
    // MJS et la ré-enveloppe (Proxy-de-Proxy, identité neuve).
    if (prop === µ._mjs_RAW) return obj;
    // <familles>
    if (prop === µ._mjs_FICHE) return this;
    // </familles>
    // pollution de prototype (CWE-1321) : lire __proto__/constructor/prototype HÉRITÉ
    // (pas une donnée propre de la cible) enveloppait Object.prototype — écrire ensuite
    // une clé dessus pollue TOUS les objets du realm. Clé PROPRE (donnée métier, ex.
    // { constructor: 'Ferrari' }) : comportement normal, cf. mutateurs/registre plus bas.
    if (typeof prop === 'string' && !µ._mjs_safeKey(prop) && !Object.prototype.hasOwnProperty.call(obj, prop)) {
      return void 0;
    }
    if (this.r === null && typeof prop === 'string' && µ._mjs_safeKey(prop)) {
      component = µ.activeComponent;
      if (component) {
        // abonner MÊME une clé
        // PAS ENCORE écrite (données async) : avant, le get n'abonnait que si
        // `_mjs_subscribers.has(prop)`, donc lire `store.data.x` avant la 1ʳᵉ
        // écriture ne posait AUCUN abonnement et la 1ʳᵉ écriture notifiait un
        // Set neuf VIDE → jamais de re-render. On crée l'entrée à la lecture.
        var _subs = st._mjs_subscribers.get(prop);
        if (!_subs) {
          _subs = new Set();
          st._mjs_subscribers.set(prop, _subs);
        }
        // N'inscrire l'unsubscribe QUE si le composant n'était pas déjà
        // abonné : avant, une closure FRAÎCHE s'accumulait dans
        // `_mjs_store_unsubs` à CHAQUE lecture de la clé (le Set ne déduplique
        // pas des fonctions distinctes) → croissance mémoire par render.
        if (!_subs.has(component)) {
          _subs.add(component);
          if (component._mjs_store_unsubs == null) {
            component._mjs_store_unsubs = new Set();
          }
          component._mjs_store_unsubs.add(() => {
            return _subs.delete(component);
          });
        }
      }
      // V2 — plus de bitmask. Les stores universels notifient déjà
      // leurs subscribers via `_mjs_subscribers.set/has/forEach`. Le
      // tracking runtime via `_activeEffectMask`/`_activeEffectComponent`
      // (retirés de mjs_init.ts,
      // c'étaient des reliques V1 toujours `null`) était redondant. Les
      // effets restent fired par leur subscription dans `_mjs_subscribers`
      // au-dessus. (storeKey + _mjs_var_bits checks aussi supprimés — V2
      // dispatch direct.)
    }
    // collections natives : le getter natif (Map.prototype.size, Set.prototype.size…)
    // exige la vraie instance en `this` — appelé avec receiver = le PROXY, il lève
    // TypeError (internal slot absent). Receiver = la cible BRUTE pour ces getters ;
    // inchangé pour un objet plain (receiver = proxy, nécessaire aux getters `this`-sensibles
    // définis par l'utilisateur, ex. champs privés `#x`).
    val = Reflect.get(obj, prop, this.c ? obj : receiver);
    // propriété figée (objet gelé…) : sa valeur, telle quelle — règle des Proxy, cf. µ._mjs_fixed (mjs_init.ts)
    if ((typeof val === 'function' || typeof val === 'object' && val !== null) && µ._mjs_fixed(obj, prop)) return val;
    // AVANT : `!this.c` bloquait le wrap récursif dès que le CONTENEUR (obj) était lui-même
    // une collection native — `store.data.list[0]` rendait donc l'objet BRUT (aucun proxy
    // interposé), et `store.data.list[0].n = 99` mutait en silence (zéro trap, zéro
    // notification). Même défaut déjà trouvé et corrigé côté µ.state (mjs_runes.ts, `_wrap` :
    // « un ÉLÉMENT objet d'une collection restait BRUT ») mais jamais porté ici — trouvé en
    // revue le 23/09/2026, prouvé par exécution. Le wrap doit s'appliquer à la VALEUR lue,
    // sans condition sur le conteneur qui la porte (this.c ne sert plus qu'à choisir le
    // traitement des MÉTHODES juste en dessous).
    if (typeof val === 'object' && val !== null) {
      return st._mjs_buildProxy(val, this.r || prop, _mjsStoreVia(this, obj));
    }
    if (typeof val === 'function') {
      // fonction de l'appli propre à l'objet ou à la liste (`store.data.outil.format`) : son relais (µ._mjs_fnRelay, mjs_init.ts),
      // un par clé et par enveloppe — `this` reste l'enveloppe quand on l'appelle seule, un champ écrit par toute variable qui le
      // tient va à la fonction et prévient comme une écriture de la clé ; une fonction du navigateur reste liée sans lien
      if ((!this.c || Array.isArray(obj)) && Object.prototype.hasOwnProperty.call(obj, prop) && !_mjsNatif(val)) {
        let r = (this.f ||= new Map()).get(prop);
        if (r === void 0 || r[µ._mjs_RAW] !== val) {
          this.f.set(prop, r = µ._mjs_fnRelay(val, this.x, () => {
            µ._mjs_bumpEpoch(obj);
            _mjsStoreMonte(this, obj);
            st._mjs_notifyMutation(this.B, this.r, prop);
          }));
        }
        return r;
      }
      if (this.c) {
        if (MJS_STORE_MUTATORS.has(prop)) {
          return (...args) => {
            // <collections>
            var result, x;
            // la donnée rangée reste brute : un élément ou une valeur tenus par leur enveloppe sont déballés, la clé d'une Map,
            // l'élément d'un Set sont ceux que la collection range pour cet objet, bruts ou enveloppés (cf. µ._mjs_keyIn, mjs_init.ts) : une
            // seule entrée par objet
            x      = args.map((a, i) => i || !(obj instanceof Map || obj instanceof Set || obj instanceof WeakMap || obj instanceof WeakSet) ? µ._mjs_toRaw(a) : µ._mjs_keyIn(obj, a));
            result = val.apply(obj, x);
            // clé retirée, collection vidée : l'index de la collection l'oublie (cf. µ._mjs_keyDrop, mjs_init.ts)
            if (prop === 'delete' || prop === 'clear') µ._mjs_keyDrop(obj, prop === 'clear', x[0]);
            // </collections>
            // <sans-collections>
            // // sans la part des collections : la donnée rangée reste brute, la clé d'une Map reste telle quelle (`get` la retrouve)
            // var result;
            // result = val.apply(obj, args.map((a, i) => i || !(obj instanceof Map) ? µ._mjs_toRaw(a) : a));
            // </sans-collections>
            // époque de mutation du brut (cf. mjs_element.ts).
            µ._mjs_bumpEpoch(obj);
            _mjsStoreMonte(this, obj);
            st._mjs_notifyMutation(this.B, this.r, prop);
            // Map.set/… rendent `this` (chaînage natif) : rendre la cible BRUTE cassait
            // la réactivité de la chaîne (`.set().set()` mutait en silence dès le 2ᵉ
            // maillon) — rendre le PROXY à la place.
            // <familles>
            // un prototype retiré (`pop`, `shift`, `splice` : un `Array.prototype` rangé par une clé venue de données) sort enveloppé, donc muré,
            // comme par l'enveloppe d'un composant (µ._mjs_mur, mjs_element.ts) ; un objet ordinaire retiré sort brut, comme avant
            // `c` déclaré ici : `x`, plus haut, n'existe que dans le bloc `<collections>`
            let c;
            if (prop === 'splice') result.forEach((e, i) => { if (e !== null && typeof e === 'object' && (c = e.constructor) && c.prototype === e) result[i] = st._mjs_buildProxy(e, this.r, _mjsStoreVia(this, obj)); });
            else if ((prop === 'pop' || prop === 'shift') && result !== null && typeof result === 'object' && (c = result.constructor) && c.prototype === result) return st._mjs_buildProxy(result, this.r, _mjsStoreVia(this, obj));
            // </familles>
            return result === obj ? this.x : result;
          };
        }
        // méthode qui ne modifie pas la collection (µ._mjs_readFn, mjs_init.ts, commune avec l'état d'un
        // composant et µ.state) : l'élément rendu, passé au rappel ou sorti d'une Map / d'un Set (`get`,
        // `forEach`, `values`, `for…of`…) est enveloppé comme une lecture par indice ; une liste retrouve
        // l'objet poussé, tenu brut ou par son enveloppe
        return µ._mjs_readFn(obj, prop, val, this.x, (x) => (typeof x === 'object' && x !== null) ? st._mjs_buildProxy(x, this.r, _mjsStoreVia(this, obj)) : x);
      }
      // fonction du navigateur propre à un objet : sa copie, qui garde le `this` reçu (µ._mjs_natCopy, mjs_init.ts)
      return Object.prototype.hasOwnProperty.call(obj, prop) && !Array.isArray(obj) ? µ._mjs_natCopy(val, obj) : val.bind(receiver);
    }
    return val;
  }
  set(obj, prop, value, receiver) {
    const st = this.e;
    var success, isNew, av;
    // parité avec µ._storeSet (mjs_store_globals.ts) : une
    // clé __proto__/constructor/prototype venue d'un `{...$data}` réseau ne doit pas remplacer
    // le PROTOTYPE de l'état.
    if (typeof prop === 'string' && !µ._mjs_safeKey(prop)) { µ.warn(µ._mjs_msg('storeKey', { prop: prop }, 'µ.Store : clé refusée (« {prop} ») — mutation ignorée.')); return true; }
    // donnée brute rangée, jamais une enveloppe (`store.data.list = store.data.list.filter(…)`)
    value = µ._mjs_rawIn(value);
    av = Reflect.get(obj, prop, receiver);
    if (av === value) {
      return true;
    }
    // Clé racine AJOUTÉE (nouvelle own-prop) → l'énumération change de forme.
    isNew = this.r === null && typeof prop === 'string' && !Object.prototype.hasOwnProperty.call(obj, prop);
    success = Reflect.set(obj, prop, value, receiver);
    if (success && !µ._mjs_rawSet.has(obj)) {
      // Clé AJOUTÉE après construction : registre créé à la volée — avant,
      // `store.data.nouvelle = x` n'était JAMAIS réactive (pas de
      // subscribers → lecture non trackée, _mjs_notify muet), sans warning.
      if (this.r === null && typeof prop === 'string' && !st._mjs_subscribers.has(prop)) {
        st._mjs_subscribers.set(prop, new Set());
      }
      // époque de mutation du brut (cf. mjs_element.ts).
      µ._mjs_bumpEpoch(obj);
      _mjsStoreMonte(this, obj);
      _mjsStoreSorti(this, obj, av);
      st._mjs_notifyMutation(this.B, this.r, prop);
      // énumération RACINE :
      // un lecteur de `{for k in store.data}` / `Object.keys` dépend de la
      // STRUCTURE (ownKeys) sans lire la clé précise. On le réveille à l'AJOUT
      // d'une clé (pas sur simple update d'une clé existante).
      if (isNew) {
        st._mjs_notify(µ._mjs_STRUCT);
      }
    }
    return success;
  }
  // `deleteProperty`/`ownKeys` manquaient :
  // `delete store.data.x` supprimait la clé (Reflect par défaut) sans
  // JAMAIS notifier, et `{for k in store.data}` n'était pas tracké comme
  // dépendant de l'ÉNUMÉRATION (ajout/retrait de clé invisible) —
  // incohérent avec `µ.state` qui a ces deux traps (mjs_runes.ts,
  // `µ._mjs_STRUCT`). Même stratégie ici, adaptée au modèle `_mjs_subscribers`.
  deleteProperty(obj, prop) {
    const st = this.e;
    var had, success, av;
    // symétrique du trap `set` ci-dessus.
    if (typeof prop === 'string' && !µ._mjs_safeKey(prop)) { µ.warn(µ._mjs_msg('storeKey', { prop: prop }, 'µ.Store : clé refusée (« {prop} ») — mutation ignorée.')); return true; }
    had = Object.prototype.hasOwnProperty.call(obj, prop);
    av  = µ._mjs_milieu && this.h.v != null ? Reflect.getOwnPropertyDescriptor(obj, prop)?.value : void 0;
    success = Reflect.deleteProperty(obj, prop);
    if (success && had && !µ._mjs_rawSet.has(obj)) {
      if (this.r === null && typeof prop === 'string' && !st._mjs_subscribers.has(prop)) {
        st._mjs_subscribers.set(prop, new Set());
      }
      // époque de mutation du brut (cf. mjs_element.ts).
      µ._mjs_bumpEpoch(obj);
      _mjsStoreMonte(this, obj);
      _mjsStoreSorti(this, obj, av);
      st._mjs_notifyMutation(this.B, this.r, prop);
      // Retrait d'une clé racine → réveiller les lecteurs d'énumération.
      if (this.r === null) {
        st._mjs_notify(µ._mjs_STRUCT);
      }
    }
    return success;
  }
  ownKeys(obj) {
    const st = this.e;
    // Énumération d'un sous-objet NICHÉ = dépendance sur la clé racine.
    var component = µ.activeComponent;
    if (this.r === null) {
      // énumération RACINE
      // (`{for k in store.data}` / `Object.keys(store.data)`) : sans abonnement
      // ici, ajouter/retirer une clé racine ne re-rendait pas. On abonne via la
      // clé-sentinelle structurelle `µ._mjs_STRUCT` (partagée avec µ.state), notifiée
      // par le set (clé neuve) et le delete racine ci-dessus.
      if (component) {
        var _subsS = st._mjs_subscribers.get(µ._mjs_STRUCT);
        if (!_subsS) {
          _subsS = new Set();
          st._mjs_subscribers.set(µ._mjs_STRUCT, _subsS);
        }
        if (!_subsS.has(component)) {
          _subsS.add(component);
          if (component._mjs_store_unsubs == null) component._mjs_store_unsubs = new Set();
          component._mjs_store_unsubs.add(() => _subsS.delete(component));
        }
      }
      return Reflect.ownKeys(obj);
    }
    if (component && st._mjs_subscribers.has(this.r)) {
      var _subsEnum = st._mjs_subscribers.get(this.r);
      if (!_subsEnum.has(component)) {
        _subsEnum.add(component);
        if (component._mjs_store_unsubs == null) component._mjs_store_unsubs = new Set();
        component._mjs_store_unsubs.add(() => _subsEnum.delete(component));
      }
    }
    return Reflect.ownKeys(obj);
  }
  // `Object.defineProperty(store.data, '__proto__', …)`
  // contournait le trap `set` ci-dessus (chemin d'écriture DIFFÉRENT du Proxy) : même garde,
  // même message.
  defineProperty(obj, prop, desc) {
    if (typeof prop === 'string' && !µ._mjs_safeKey(prop)) { µ.warn(µ._mjs_msg('storeKey', { prop: prop }, 'µ.Store : clé refusée (« {prop} ») — mutation ignorée.')); return false; }
    return Reflect.defineProperty(obj, prop, desc);
  }
  // `Object.setPrototypeOf(store.data, evil)` changeait
  // le PROTOTYPE en un seul appel, hors de portée du trap `set` (pas une écriture de clé).
  setPrototypeOf(obj, proto) {
    µ.warn(µ._mjs_msg('storeProto', null, 'store : changement de prototype refusé'));
    return false;
  }
}).prototype;
// les liens vers les conteneurs ne servent que si un composant peut tenir un objet du magasin : une appli de production sans prop
// (`<milieu>` absent, bundler/index.ts) n'en porte que trois aides vides
// <milieu>
// fiche du conteneur `obj` lu par l'enveloppe de la fiche `h` : sa référence faible, faite à son premier sous-objet lu, que ses sous-objets
// gardent pour lien — seulement quand un composant peut tenir un objet du magasin (µ._mjs_milieu) et que le cœur porte les liens ; la racine
// n'en donne pas (sa clé de départ dit déjà qui la tient)
function _mjsStoreVia(h, obj) {
  const f = h.h;
  if (h.r === null) return void 0;
  if (f.v === void 0 && µ._mjs_milieu && µ._mjs_lie !== void 0) f.v = µ._mjs_ref(obj);
  return f;
}
// écriture faite par l'enveloppe de la fiche `h` dans `obj` : elle remonte les liens de l'objet et fait avancer l'époque des conteneurs
// qu'un composant tient (cf. _mjsMonte, mjs_element.ts) ; quand elle ne répond pas de tous les conteneurs, le magasin se replie
function _mjsStoreMonte(h, obj) {
  if (µ._mjs_milieu && µ._mjs_lie !== void 0 && µ._mjs_monte(h.h, obj)) _mjsStoreRepli(h);
}
// LE REPLI, comme celui de `µ.state` (_mjsStateRepli, mjs_state.ts) : les abonnés des clés que l'écriture va prévenir (cf.
// _mjs_notifyMutation) redisent leurs liaisons à leur prochaine passe — jamais un écran figé
function _mjsStoreRepli(h) {
  // <redite>
  const subs = h.e._mjs_subscribers, pose = (k) => {
    const l = subs.get(k);
    if (l) l.forEach((c) => {
      (c._mjs_rdp ||= Object.create(null))._awaits_ = 2;
    });
  };
  if (h.B.size > 1) h.B.forEach((f, k) => pose(k));
  else pose(h.r);
  // </redite>
}
// objet `av` retiré du conteneur `obj` par une affectation ou une suppression : son lien vers lui devient douteux (cf. _mjsSorti, mjs_element.ts)
function _mjsStoreSorti(h, obj, av) {
  if (µ._mjs_milieu && h.h.v != null && av !== null && typeof av === 'object') µ._mjs_sorti(h.e._mjs_rootsByTarget, h.h.v, obj, av);
}
// </milieu>
// <sans-milieu>
// const _mjsStoreVia = () => void 0, _mjsStoreMonte = _mjsStoreVia, _mjsStoreSorti = _mjsStoreVia;
// </sans-milieu>
// <familles>
// une variable d'un composant qui tient un objet de ce magasin (fiche `h`, notée par `_set`) l'a écrit, ou plus bas : le magasin est
// prévenu comme après une écriture faite par son piège `set`, sans réécrire la donnée (cf. _mjsFil, mjs_element.ts)
µ._mjs_storeFil = function(h) {
  _mjsStoreMonte(h, µ._mjs_toRaw(h.x));
  h.e._mjs_notifyMutation(h.B, h.r, null);
};
// </familles>

µ.Store = class Store {
  constructor(initialState) {
    // Marqueur "raw" dans µ._mjs_rawSet (cf. mjs_init.ts) — pas de prop string
    // sur l'instance (mangle-safe + sans pollution énumération).
    µ._mjs_rawSet.add(this);
    // `|| {}` : `new µ.Store(null)` crashait sur Object.keys(null).
    this._state = initialState || {};
    // <signaux>
    // boîtes du graphe des signaux (mjs_signals.ts), nées à la première lecture notée : déclarées ici pour garder la forme
    this._mjs_sigBoxes = null;
    // </signaux>
    this._mjs_subscribers = new Map();
    Object.keys(this._state).forEach((key) => {
      return this._mjs_subscribers.set(key, new Set());
    });
    // objet brut → fiche de son premier couple (cf. _mjs_buildProxy) ; époques des clés, pour les aides des liens (mjs_element.ts)
    this._mjs_rootsByTarget = new WeakMap();
    this._mjs_bindEpochs    = {};
    this.data = this._mjs_buildProxy(this._state, null);
    // <magasin-fin>
    // propriétaire de ses reffets, arrêtés quand on le jette : la racine `µeffect.root` en cours, sinon le module dont le premier niveau
    // le crée (mjs_effect.ts)
    this._mjs_proprio = µ._mjs_proprio ? µ._mjs_proprio() : null;
    this._mjs_fin     = 0;
    // </magasin-fin>
  }
  // <magasin-fin>

  // `magasin.destroy()` : le magasin est jeté. Les reffets de son propriétaire s'arrêtent, ses abonnés (composants, reffets) ne sont
  // plus prévenus ; il reste lisible, une écriture y est rangée sans relancer personne (avertissement de développement, une fois). Un
  // composant affiché qui le lit encore garde ce qu'il montre (avertissement de développement). Un deuxième appel ne fait rien ; une
  // clé de données nommée `destroy` vit dans `.data`, sans rapport
  destroy() {
    var p = this._mjs_proprio, lu = null, l;
    if (this._mjs_fin) return;
    this._mjs_fin     = 1;
    this._mjs_proprio = null;
    this._mjs_subscribers.forEach(function(abonnes) {
      abonnes.forEach(function(c) {
        if (!lu && c._mjs_is_mounted) lu = c;
      });
      abonnes.clear();
    });
    if (lu) µ.warn(µ._mjs_msg('storeDestroyedRead', { tag: lu.localName }, 'Un magasin est jeté (destroy()) alors que <{tag}> le lit encore : ce composant garde ce qu\'il affiche et n\'est plus prévenu de ses changements. Jetez le magasin quand plus aucun composant affiché ne le lit (dans le µdestroy du dernier, par exemple).'));
    if (p) {
      l      = p.effs;
      p.effs = [];
      l.forEach(function(s) { s.stop(); });
    }
  }
  // </magasin-fin>

  _mjs_buildProxy(target, rootKey, via) {
    var f0, f, isBuiltIn;
    // reconnaissance des enveloppes : `target` peut être l'enveloppe
    // d'un composant/rune (cf. µ._mjs_RAW) — déballage AVANT tout, même principe
    // que _mjs_wrapDeep (mjs_element.ts) : le carnet (_mjs_proxyCache) reste stable
    // peu importe le pair qui nous transmet la valeur.
    target = µ._mjs_toRaw(target);
    if (target instanceof Promise || (target != null && µ._mjs_rawSet.has(target))) {
      return target;
    }
    // une enveloppe par couple (target, rootKey) — même stratégie que _mjs_wrapDeep
    // (mjs_element.ts) : un objet rangé sous DEUX clés racines (`new µ.Store({a:
    // shared, b: shared})`) a un proxy PAR clé (identité stable par clé, cf.
    // tests/store-cache-proxy-cle-racine.test.ts). Les clés de `B` (clé → fiche) servent aussi de
    // registre « quelles clés ont un jour atteint cet objet » — réutilisé par
    // `_mjs_notifyMutation`, plus bas, pour la notification croisée entre alias
    // (chaque clé d'accès y crée forcément une entrée AVANT qu'on puisse muter à travers elle).
    // la fiche du premier couple de cet objet (`h` de chaque fiche) porte ses liens vers les conteneurs et la `Map` des couples (`B`) ;
    // lu par un autre conteneur que la dernière fois, son lien est revu — une comparaison quand c'est le même (cf. _mjsLie, mjs_element.ts)
    f0 = this._mjs_rootsByTarget.get(target);
    if (f0 !== void 0) {
      if (via !== void 0 && via.v !== void 0 && f0.a !== via.v) µ._mjs_lie(f0, via.v, this);
      f = f0.B.get(rootKey);
      if (f !== void 0) return f.x;
    }
    // `ArrayBuffer.isView` couvre TypedArray ET DataView en un seul test — même famille que
    // Map/Set/Date/Array juste avant : leurs getters/méthodes natifs exigent la vraie instance
    // en `this` (internal slot), incompatible avec le PROXY reçu comme receiver par défaut.
    // `instanceof ArrayBuffer` couvre le buffer BRUT (pas une vue) — `isView` rend faux dessus :
    // `.byteLength` (accesseur) et `.slice()` (méthode) levaient la même erreur, mesuré.
    // `WeakMap`, `WeakSet` aussi : leurs méthodes exigent la vraie collection en `this`, comme celles d'une `Map`, d'un `Set`
    isBuiltIn = target instanceof Map || target instanceof Set || target instanceof WeakMap || target instanceof WeakSet || target instanceof Date || Array.isArray(target) || ArrayBuffer.isView(target) || target instanceof ArrayBuffer;
    // <sans-collections>
    // // <developpement>
    // // collection rangée par un cœur bâti sans la part des collections : le développement le dit (µ._mjs_collMissing, mjs_init.ts)
    // if (isBuiltIn) µ._mjs_collMissing(target);
    // // </developpement>
    // </sans-collections>
    // <precision>
    // <derivees>
    // objet tenu par ce magasin : une valeur précise d'un composant qui le tient aussi doute (mjs_element.ts)
    µ._mjs_detenu ? µ._mjs_detenu(target, 0) : (µ._mjs_detenusAvant ||= []).push(target);
    // </derivees>
    // </precision>
    f = {
      __proto__: MJS_STORE_TRAPS,
      e:         this,
      r:         rootKey,
      c:         isBuiltIn,
      x:         void 0,
      B:         f0 !== void 0 ? f0.B : new Map(),
      f:         void 0,
      h:         f0,
      s:         void 0,
      a:         f0 === void 0 && via !== void 0 ? via.v : void 0,
      b:         void 0,
      v:         void 0
    };
    // <familles>
    // un prototype rangé (`Array.prototype`, par une clé venue de données) : le mur (µ._mjs_mur, mjs_element.ts) ; jamais une collection,
    // ses méthodes passent par l'enveloppe, qui refuse, au lieu d'être appliquées à l'objet brut
    if (µ._mjs_mur(target, f, MJS_STORE_TRAPS)) f.c = false;
    // </familles>
    if (f0 === void 0) {
      f.h = f;
      this._mjs_rootsByTarget.set(target, f);
    }
    // une clé de plus que celle du premier couple : l'ensemble des clés qui atteignent l'objet, que lisent les aides des liens
    else if (rootKey !== f0.r) (f0.s ||= new Set([f0.r])).add(rootKey);
    f.x = new Proxy(target, f);
    // <faibles>
    // enveloppe d'une `WeakMap`, d'un `WeakSet` : notée pour µraw, qui en rend la vraie collection (µ._mjs_weakRaw, mjs_init.ts)
    if (target instanceof WeakMap || target instanceof WeakSet) µ._mjs_weakRaw.set(f.x, target);
    // </faibles>
    f.B.set(rootKey, f);
    return f.x;
  }
  // notifie la mutation d'un sous-objet atteint par le proxy `rootKey`/`prop` — `byRoot`
  // (le cache (rootKey → proxy) DE CET OBJET, déjà en main dans la closure de l'appelant,
  // cf. `_mjs_buildProxy` : pas de second lookup WeakMap ici) donne aussi les clés qui
  // l'ont un jour atteint. Partagé sous PLUSIEURS clés racines → notifie CHACUNE, pas
  // seulement celle du proxy qui a muté : `store.data.b.x = 1` doit aussi réveiller un
  // lecteur de `store.data.a` quand `a` et `b` pointent sur le MÊME objet — sinon la
  // mutation lui reste invisible. Racine (rootKey null) : un seul propriétaire possible
  // pour une clé de premier niveau, comportement inchangé (`byRoot` vaut alors `void 0`,
  // jamais construit pour la racine elle-même).
  _mjs_notifyMutation(byRoot, rootKey, prop) {
    if (rootKey === null) {
      this._mjs_notify(prop);
      return;
    }
    if (byRoot && byRoot.size > 1) {
      byRoot.forEach((proxy, key) => this._mjs_notify(key));
    } else {
      this._mjs_notify(rootKey);
    }
  }

  _mjs_notify(rootKey) {
    // <magasin-fin>
    // magasin jeté : l'écriture est rangée, personne n'est prévenu
    if (this._mjs_fin) {
      if (this._mjs_fin++ === 1) µ.warn(µ._mjs_msg('storeDestroyed', { key: String(rootKey) }, 'Ce magasin est jeté (destroy()) : l\'écriture de « {key} » y est rangée, mais elle ne prévient plus personne, aucun composant ni reffet ne repart. Créez un nouveau magasin si la donnée doit encore vivre.'));
      return;
    }
    // </magasin-fin>
    // <signaux>
    // graphe des signaux (mjs_signals.ts) : la boîte de la clé avance, qu'un composant soit abonné ou non (µ._mjs_STRUCT : la
    // structure) ; sans lecteur, une lecture et un test
    if (this._mjs_sigBoxes) µ._mjs_sigWrite(this, rootKey);
    // </signaux>
    if (!(rootKey && this._mjs_subscribers.has(rootKey))) {
      return;
    }
    if (this._mjs_pendingNotifs == null) {
      this._mjs_pendingNotifs = new Set();
    }
    this._mjs_pendingNotifs.add(rootKey);
    // <reffet-magasin>
    // clé de la passe → son auteur : le reffet d'un magasin qui l'écrit pendant son passage (`µ._mjs_magW`, mjs_effect.ts) quand il est le
    // seul à l'écrire, sinon 0. La passe ne prévient pas ce reffet de sa propre écriture : il ne se relance pas en rafale ; les autres
    // abonnés, composants et reffets, sont prévenus comme toujours
    var w = µ._mjs_magW || 0, a = this._mjs_auteurs ||= new Map();
    a.set(rootKey, a.has(rootKey) && a.get(rootKey) !== w ? 0 : w);
    // </reffet-magasin>
    // Event Debouncing (Coalescence)
    if (!this._mjs_is_notifying) {
      this._mjs_is_notifying = true;
      return queueMicrotask(() => {
        var i, key, len, notified, pending, results;
        // <reffet-magasin>
        var auteurs       = this._mjs_auteurs;
        this._mjs_auteurs = null;
        // </reffet-magasin>
        this._mjs_is_notifying = false;
        pending = Array.from(this._mjs_pendingNotifs);
        this._mjs_pendingNotifs.clear();
        results = [];
        // un même composant abonné à PLUSIEURS clés de cette passe (fan-out
        // `_mjs_notifyMutation` sur un objet partagé entre plusieurs clés racines,
        // cf. plus haut) ne doit être invalidé qu'UNE fois — même garde que
        // `_notifyRoots` (mjs_runes.ts, µ.state), ensemble tenu le temps du flush.
        notified = new Set();
        for (i = 0, len = pending.length; i < len; i++) {
          key = pending[i];
          // Les effets lecteurs d'un store universel (`µ.store.<key>` / `$$key`)
          // ne sont PAS indexés dans `_mjs_effectsByVar['$$'+key]` (le générateur n'y
          // range que les `$` locaux/derived) → `_mjs_invalidate('$$'+key)` tombait
          // dans le fast-path no-op et ne re-rendait JAMAIS l'abonné. `'_awaits_'`
          // force le full render (struct + `_mjs_effectsAll`, où vivent ces effets),
          // ciblé aux seuls composants abonnés à la clé mutée. État global =
          // mutations rares → le re-render complet (borné à 1 composant) est
          // acceptable.
          results.push(this._mjs_subscribers.get(key).forEach((comp) => {
            if (notified.has(comp)) return;
            // <reffet-magasin>
            if (comp._mjs_mag && comp._mjs_mag === auteurs.get(key)) return;
            // </reffet-magasin>
            notified.add(comp);
            return typeof comp._mjs_invalidate === "function" ? comp._mjs_invalidate('_awaits_') : void 0;
          }));
        }
        return results;
      });
    }
  }

};
