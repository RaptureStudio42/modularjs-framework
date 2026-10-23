// mjs_context — contexte de sous-arbre figé (`§clé`, `_mjs_setContext`/`_mjs_getContext`) et
// RÉACTIF (`§§clé`, `_mjs_setRCtx`/`_mjs_getRCtx`/`_mjs_rctxRemember`). Patch de
// `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même technique que mjs_on.ts/mjs_emit.ts) :
// self-contained (`_mjs_rctx_cache`/`_mjs_rctxEpoch` sont de simples propriétés/compteurs, jamais lus
// par une autre méthode du cœur — seuls les DEUX APPELS `this._mjs_rctx_cache = null;`/
// `µ._mjs_rctxEpoch++;` restent dans connectedCallback/disconnectedCallback, cœur, et ne dépendent
// pas de ce fichier). `_mjs_setRCtx` appelle `µ.state(...)` (mjs_runes.ts, cœur strict — jamais
// détaché, cf. bundler/config.ts) : aucune dépendance vers un autre module détecté. Un composant
// qui n'écrit ni `§`/`§§`, ni leurs formes ASCII (option contextAlias), ni les runes
// `µsetContext`/`µ.setContext`/`µ.getContext` (transpiler/index.ts) ne compile aucun appel
// `this._mjs_setContext`/`_mjs_getRCtx`/etc. — ces méthodes peuvent alors manquer sans risque.
if (µ.Element) {
  // le parent d'un nœud (l'hôte, pour la racine d'une ombre), lu sans rien lire SUR lui : l'accesseur du prototype est appelé avec le nœud
  // pour cible, et un contexte ne se cherche que sur un composant — lue sur un <form>, une propriété (son parent, une donnée posée dessus)
  // est d'abord cherchée parmi ses champs, liste que le navigateur refait après la mise à niveau de chaque champ associé : mille lecteurs
  // d'un contexte placés entre les mille cases d'un formulaire la faisaient refaire mille fois. Seule la racine d'une ombre passe à son hôte :
  // le `host` d'un lien (<a>, <area>) est celui de son adresse, une chaîne — un lecteur resté dans un lien retiré de la page s'arrête à lui
  var _mjsCtxParent = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode').get;
  var _mjsCtxUp = function(n) {
    return _mjsCtxParent.call(n) || (n.nodeType === 11 ? n.host : null);
  };

  µ.Element.prototype._mjs_setContext = function(key, value) {
    if (this._mjs_contexts == null) {
      this._mjs_contexts = new Map();
    }
    return this._mjs_contexts.set(key, value);
  };

  µ.Element.prototype._mjs_getContext = function(key) {
    var current = this;
    while (current) {
      if (current instanceof µ.Element && current._mjs_contexts && current._mjs_contexts.has(key)) {
        return current._mjs_contexts.get(key);
      }
      current = _mjsCtxUp(current);
    }
    return void 0;
  };

  // Contexte RÉACTIF de sous-arbre (sigil `§§clé`, hors singleton importé).
  // Comme `§` (résolution en remontant l'arbre depuis l'ancêtre déclarant), MAIS
  // réactif : la valeur vit dans un proxy `µ.state`, donc lire une propriété abonne
  // le composant lecteur (« universal deps », µ._mjs_registerUniversalDep) et toute
  // mutation re-rend les abonnés du sous-arbre. Espace de noms séparé de `§`
  // (_mjs_rctx) pour qu'un contexte figé et un contexte réactif de même clé ne se
  // marchent pas dessus. STATISATION — `µ.store` (`$$`) n'est PLUS un Proxy
  // et ne passe PLUS par les universal deps : dispatch par clé statique, voir
  // mjs_store_globals.ts (_mjs_storeSubscribe/_mjs_storeNotifyKey).
  µ.Element.prototype._mjs_setRCtx = function(key, value) {
    var k, next, raw;
    if (this._mjs_rctx == null) {
      this._mjs_rctx = new Map();
    }
    var proxy = this._mjs_rctx.get(key);
    if (proxy) {
      // réaffectation (`§§theme = {…}`) : le MÊME objet réactif prend le nouveau contenu, champ par champ — chaque
      // écriture prévient ses lecteurs, déjà abonnés à lui. Un objet neuf laissait les consommateurs montés sur
      // l'ancien, avec l'ancienne valeur. Même forme que `µ.state` : un objet copié, une valeur simple dans `value`
      raw = µ._mjs_toRaw(proxy);
      next = value === void 0 ? {} : typeof value === 'object' ? { ...value } : { value: value };
      for (k in next) proxy[k] = next[k];
      for (k in raw) if (!(k in next)) delete proxy[k];
      return proxy;
    }
    proxy = µ.state(value);
    this._mjs_rctx.set(key, proxy);
    // contexte posé : invalide les caches de résolution §§ en aval
    µ._mjs_rctxEpoch++;
    return proxy;
  };

  // cache PAR INSTANCE (this._mjs_rctx_cache) du parcours d'ancêtre — un hit
  // n'est valable que si son epoch mémorisé égale µ._mjs_rctxEpoch courant (posé à
  // jour par connectedCallback/disconnectedCallback/_mjs_setRCtx) ; sinon
  // reparcours normal, inchangé.
  µ.Element.prototype._mjs_getRCtx = function(key) {
    var cache, current, entry;
    cache = this._mjs_rctx_cache;
    entry = cache && cache.get(key);
    if (entry && entry.epoch === µ._mjs_rctxEpoch) {
      return entry.value;
    }
    current = this;
    while (current) {
      if (current instanceof µ.Element && current._mjs_rctx && current._mjs_rctx.has(key)) {
        return this._mjs_rctxRemember(key, current._mjs_rctx.get(key));
      }
      current = _mjsCtxUp(current);
    }
    // l'échec (void 0) se mémorise aussi : le parcours raté jusqu'à la racine
    // est le plus coûteux
    return this._mjs_rctxRemember(key, void 0);
  };

  µ.Element.prototype._mjs_rctxRemember = function(key, value) {
    if (this._mjs_rctx_cache == null) {
      this._mjs_rctx_cache = new Map();
    }
    this._mjs_rctx_cache.set(key, { epoch: µ._mjs_rctxEpoch, value: value });
    return value;
  };
}
