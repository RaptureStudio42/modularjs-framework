// mjs_for — bloc `{for}` (listes réactives, réconciliation par clé). Patch de
// `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même technique que mjs_on.ts/
// mjs_flip.ts : ajouté APRÈS la classe, DOIT rester après mjs_element.ts dans la
// concaténation — et AVANT mjs_flip.ts, qui capture `_mjs_reconcileList` à son propre
// chargement pour le patcher, cf. bundler/index.ts). `{for item in $liste}`
// compile en `this._mjs_updFor(...)` (racine, `{if}` et `{key}`) / `this._mjs_updList(...)` (liste dans
// une autre liste ou dans une branche `{await}` — mjs_for_nested.ts, joint à part sur ce même
// appel, cf. son en-tête) — les deux délèguent à `_mjs_reconcileList`, le moteur
// de réconciliation (LIS, pool, dying/revive, FLIP), aidé de `_mjs_liveEntryNodes`
// et `_mjs_mjsPurgeNestedListCaches` (fuite des caches de `{for}` imbriqués détruits
// pour de bon). `_mjs_mjsTag` (tatouage `_mjsId` d'un item-objet non keyé) est
// partagé avec le cacheId des `{for}` imbriqués (compile.ts). Un composant qui
// n'écrit jamais `{for}` (ni directement, ni via un module du cœur qu'il
// utilise, ex. `<@@select>`) n'appelle donc jamais ces méthodes.

// `µ._mjs_inside` (test d'inclusion insensible à une méthode `contains` du composant) : posé par
// mjs_element.ts, toujours au cœur avant ce fichier

// index des lignes d'une liaison filtrée par valeur (`_mjs_filt[<liaison>].idx`, cf. generator/attributes/index.ts) : une clé porte la fonction de sa ligne ;
// quand plusieurs lignes portent la même valeur, un Set de leurs fonctions (`multi` : la purge en masse ne peut plus compter une entrée par ligne)
µ._mjs_filtPut = function(fe, k, f) {
  var e = fe.idx.get(k);
  if (e === void 0) fe.idx.set(k, f);
  else if (e instanceof Set) e.add(f);
  else if (e !== f) { fe.idx.set(k, new Set([e, f])); fe.multi = true; }
};
// retire la fonction `f` d'une ligne de la clé `k` (sans `f`, l'entrée entière : la ligne n'a jamais posé la sienne) ; l'entrée d'une autre ligne reste
µ._mjs_filtDrop = function(idx, k, f) {
  var e = idx.get(k);
  if (e instanceof Set) { e.delete(f); if (!e.size) idx.delete(k); }
  else if (f === void 0 || e === f) idx.delete(k);
};
// appelle la fonction de chaque ligne de la clé (`e` : l'entrée de l'index, absente si personne ne porte la valeur)
µ._mjs_filtCall = function(e, m) {
  if (e instanceof Set) e.forEach(function(f) { f(m); });
  else if (e) e(m);
};

if (µ.Element) {
  // retire de l'index filtré la fonction de chaque liaison d'une ligne qui disparaît (`_mjs_filterKeys` dit sous quelle clé, `_mjs_filterFns` laquelle) : l'index la garderait,
  // avec le nœud mort qu'elle ferme, et une ligne recyclée par le pool y retrouverait celle de son ancien usage
  µ.Element.prototype._mjs_filtPurgeEntry = function(entry) {
    var names = this._mjs_filtIdxKeys, nodes = entry && entry.__nodes, keys = nodes && nodes._mjs_filterKeys;
    if (!names || !keys) return;
    for (var name of names) {
      var fe = this._mjs_filt[name];
      if (keys[name] !== void 0 && fe && fe.idx) µ._mjs_filtDrop(fe.idx, keys[name], nodes._mjs_filterFns ? nodes._mjs_filterFns[name] : void 0);
    }
    nodes._mjs_filterKeys = null;
    nodes._mjs_filterFns  = null;
  };

  // la même purge pour les lignes d'un cache de liste qu'on abandonne d'un bloc (ancres refaites, ligne parente détruite)
  µ.Element.prototype._mjs_filtPurgeCache = function(cache) {
    if (cache) for (var entry of cache.values()) this._mjs_filtPurgeEntry(entry);
  };

  // fuite non bornée des caches de
  // {for} imbriqués : `_mjs_list_cache`/`_mjs_list_order`/`_mjs_list_anchor`/`_mjs_list_pool`
  // (posés par _mjs_reconcileList, cf. ~ligne 2523) sont indexés par un cacheId
  // qui embarque la clé/l'id de LA ROW qui les contient (compile.ts
  // `uniqueCacheId`). Quand cette row est supprimée de la liste EXTÉRIEURE,
  // rien ne purgeait ces 4 tables → chaque row qui a un jour existé (avec un
  // {for} imbriqué dedans) laisse une entrée à vie sur `this`, même après
  // suppression complète de la liste extérieure (ex. chat qui scrolle,
  // todo-list avec suppressions) → fuite mémoire non bornée sur la durée de
  // vie du composant. Cherche, parmi les ancres de {for} imbriqués connues,
  // celles contenues dans le sous-arbre qui va disparaître, et purge tout
  // d'un coup. `root.contains(anchor)` gère n'importe quelle profondeur
  // d'imbrication en UNE passe (pas besoin de recurser niveau par niveau).
  µ.Element.prototype._mjs_mjsPurgeNestedListCaches = function(root) {
    const anchors = this._mjs_list_anchor;
    for (const cacheId in anchors) {
      const anchor = anchors[cacheId];
      if (anchor && (anchor === root || (root.contains && µ._mjs_inside(root, anchor)))) {
        delete anchors[cacheId];
        if (this._mjs_list_cache) {
          this._mjs_filtPurgeCache(this._mjs_list_cache[cacheId]);
          delete this._mjs_list_cache[cacheId];
        }
        if (this._mjs_list_order) delete this._mjs_list_order[cacheId];
        if (this._mjs_list_pool) delete this._mjs_list_pool[cacheId];
      }
    }
  };

  // Fix — `entry.nodes` (posé par `_mjs_reconcileList` à la
  // construction de l'entrée) est un INSTANTANÉ des top-level childNodes du
  // fragment produit par `tplFn`. Un `{if}` racine imbriqué dans l'itération
  // insère son contenu comme SIBLING de ses 2 marqueurs (`_mjs_updItemIf`) — DANS
  // le DOM vivant, sur un rendu ultérieur, jamais dans `entry.nodes`. Avant
  // destruction d'une entrée, on retrouve les nodes RÉELLEMENT présents en
  // marchant du premier au dernier node capturé (bornes stables : ce sont
  // l'élément et les 2 marqueurs, jamais remplacés en place) — ça englobe
  // tout contenu inséré entre-temps par un `{if}`/`{key}` frère. Repli sur le
  // snapshot d'origine si les bornes ont disparu du DOM (detached/pool).
  µ.Element.prototype._mjs_liveEntryNodes = function(entryNodes) {
    if (!entryNodes || entryNodes.length <= 1) return entryNodes;
    const __first = entryNodes[0];
    const __last = entryNodes[entryNodes.length - 1];
    if (!__first || !__first.parentNode || !__last || __last.parentNode !== __first.parentNode) return entryNodes;
    const __out = [];
    let __n = __first;
    while (__n) {
      __out.push(__n);
      if (__n === __last) return __out;
      __n = __n.nextSibling;
    }
    // `__last` jamais atteint (topologie inattendue) : repli sûr.
    return entryNodes;
  };

  // Sous-arbre porteur d'état HORS GABARIT (une clé garantit l'identité — un
  // nœud du pool ne peut donc être recyclé pour une AUTRE clé que si rien, en
  // dessous, ne porte un état que le gabarit ne reconstruit pas). Deux
  // familles bien distinctes :
  //  - état OPAQUE, jamais réinitialisable de l'extérieur : `[contenteditable]`,
  //    `<details>` (son `open` REFLÈTE l'attribut dans les deux sens — rien,
  //    nulle part, ne garde la valeur d'ORIGINE du gabarit une fois basculé,
  //    contrairement à value/checked/selected ci-dessous ; la capter coûterait
  //    un DFS de plus À LA CRÉATION de CHAQUE ligne, create1k compris, pour un
  //    tag rare dans une liste), audio/vidéo (lecture en cours), canvas
  //    (dessin), iframe (document chargé), élément personnalisé (nom avec
  //    tiret = composant, état interne possible) : jamais recyclé.
  //  - champ de FORMULAIRE (INPUT/TEXTAREA/SELECT) : le navigateur préserve
  //    déjà NATIVEMENT la valeur du gabarit (`defaultValue`/`defaultChecked`/
  //    `option.defaultSelected` reflètent l'attribut STATIQUE du template,
  //    jamais modifiés par une écriture `.value =`/`.checked =` ultérieure —
  //    c'est le « dirty value flag » du DOM). Recyclable SANS blocage — mais
  //    cette fonction ne fait ICI que le CONSTAT, elle n'écrit rien : les
  //    nœuds sont encore CONNECTÉS AU DOCUMENT à ce stade (le retrait DOM vient
  //    après, chez l'appelant), et un `<input type=radio>` encore connecté à
  //    qui on écrit `checked=true` déclenche NATIVEMENT le décochage de tout
  //    autre radio du même `name` dans le même arbre — y compris un radio
  //    totalement étranger à cette ligne, jamais touché par ce `{for}`. Les
  //    champs de formulaire rencontrés sont donc seulement COLLECTÉS dans
  //    `formNodesOut` (si fourni par l'appelant) ; c'est `_mjs_mjsResetFormFields`
  //    plus bas qui remet `value`/`checked`/`selected` au gabarit, appelée par
  //    l'appelant UNE FOIS le sous-arbre détaché du document vivant. Les
  //    liaisons de la NOUVELLE clé s'appliquent normalement juste après (PASS 2
  //    plus bas, inconditionnelle) : une liaison lit toujours l'état RÉEL du
  //    nœud pour décider d'écrire (`if (node.value !== val)`, jamais une valeur
  //    mise en cache à part) — remettre le defaultValue avant ne peut donc
  //    jamais faire sauter l'écriture qui suit, même si la nouvelle valeur
  //    coïncide avec l'ancienne (couvert par test).
  // DFS manuelle plutôt que `querySelectorAll` (même choix que le scan de
  // `_mjs_destroyWithHooks`, mjs_destroy_hooks.ts) : early-exit au 1er match
  // opaque, aucune allocation dans le cas commun (une row de texte, ex. le
  // banc officiel — `formNodesOut` est un tableau RÉUTILISÉ posé par
  // l'appelant, jamais alloué ici). Mesuré réellement (bundler + happy-dom
  // réels, 300 lignes, remplacement total des clés, plusieurs passes en ordre
  // alterné, cf. rapport) : une row de texte n'est pas affectée ; une row à
  // `<input>` (lié ou non) reste autour de 6-8 ms par remplacement (guard
  // précédente : jamais recyclée, destroy + recreate systématiques, ~10-14 ms)
  // — net, mais PAS nul : ce n'est pas un recyclage sans aucune vérification.
  var __mjsOpaqueTags = {DETAILS: 1, AUDIO: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1};
  // OPTION : une liste dont les lignes SONT les options d'un <select> posé hors de la ligne
  var __mjsFormTags = {INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1};
  µ.Element.prototype._mjs_mjsHasOwnState = function(nodes, formNodesOut) {
    for (let __ni = 0, __nln = nodes.length; __ni < __nln; __ni++) {
      const __root = nodes[__ni];
      if (__root.nodeType !== 1) continue;
      let __n = __root;
      while (__n) {
        const __tag = __n.tagName;
        if (__mjsOpaqueTags[__tag] || __tag.indexOf('-') !== -1) return true;
        if (__n.hasAttribute && __n.hasAttribute('contenteditable') && __n.getAttribute('contenteditable') !== 'false') return true;
        if (__mjsFormTags[__tag] && formNodesOut) formNodesOut.push(__n);
        if (__n.firstElementChild) {
          __n = __n.firstElementChild;
          continue;
        }
        while (__n && __n !== __root && !__n.nextElementSibling) {
          __n = __n.parentElement;
        }
        if (!__n || __n === __root) break;
        __n = __n.nextElementSibling;
      }
    }
    return false;
  };

  // Remise au gabarit d'une liste de champs de formulaire (INPUT/TEXTAREA/
  // SELECT) COLLECTÉS par `_mjs_mjsHasOwnState` ci-dessus. À appeler
  // UNIQUEMENT une fois le sous-arbre détaché du document vivant (jamais
  // avant : cf. commentaire ci-dessus sur le vol de sélection radio) — les
  // deux appelants de `_mjs_mjsHasOwnState` le font juste après leur
  // `removeChild`/effacement DOM. Même remise à zéro qu'avant, seulement
  // déplacée dans le temps.
  µ.Element.prototype._mjs_mjsResetFormFields = function(nodes) {
    for (let __fi = 0, __fln = nodes.length; __fi < __fln; __fi++) {
      const __n = nodes[__fi];
      const __tag = __n.tagName;
      if (__tag === 'SELECT') {
        // pas de `.defaultValue` fiable sur <select> (multi ou pas) :
        // seule chaque <option> garde son `selected` de gabarit — lu sur
        // l'attribut (ce que reflète `defaultSelected`), que certains DOM
        // simulés n'implémentent pas
        const __opts = __n.options;
        for (let __oi = 0, __oln = __opts.length; __oi < __oln; __oi++) {
          const __opt = __opts[__oi];
          const __def = __opt.hasAttribute('selected');
          if (__opt.selected !== __def) __opt.selected = __def;
          // mémo de la liaison `selected={…}` (µ._mjs_updAttrNode) : la ligne recyclée la réécrit
          __opt._mjs_bw = void 0;
        }
      } else if (__tag === 'OPTION') {
        // la ligne EST l'option : même remise au gabarit que ci-dessus, sans quoi le choix fait
        // sur l'ancienne clé passait à la nouvelle, la liaison `selected={…}` ne réécrivant que
        // ce qui change
        const __def = __n.hasAttribute('selected');
        if (__n.selected !== __def) __n.selected = __def;
        __n._mjs_bw = void 0;
      } else {
        if (__n.value !== __n.defaultValue) __n.value = __n.defaultValue;
        // `checked`/`defaultChecked` n'existent que sur INPUT (case/radio) —
        // sans effet sur TEXTAREA, pas besoin de tester le tag ici. Le nœud
        // est déjà détaché ici : plus aucun risque de mutuelle exclusion
        // native sur un radio étranger.
        if (__tag === 'INPUT' && __n.checked !== __n.defaultChecked) __n.checked = __n.defaultChecked;
        // mémos des liaisons `value={…}`/`checked={…}` (µ._mjs_updAttrNode) : remis au gabarit, le
        // champ recyclé reçoit la valeur de sa nouvelle clé même égale à celle de l'ancienne
        __n._mjs_vw = void 0;
        __n._mjs_bw = void 0;
      }
    }
  };

  // ligne pure (`_mjs_p`, posé par le compilateur) d'une collection µraw : mêmes élément et index
  // que ceux de la dernière mise à jour → rien à relire (renvoie 1) ; sinon note le couple.
  // l'élément est une valeur simple ou lui-même µraw : un objet ordinaire d'une liste µraw reste
  // modifiable sur place par un autre chemin suivi (tableau réactif d'origine, store), comme le proxy
  // suivi d'un objet marqué µraw après coup
  function _mjs_skipRow(en, it, ix, raw) {
    if (raw && en._mjs_p && en._mjs_it === it && en._mjs_ix === ix && (Object(it) !== it || µ._mjs_rawSet.has(it) && µ._mjs_toRaw(it) === it)) return 1;
    en._mjs_it = it;
    en._mjs_ix = ix;
  }

  // clé `by` d'une ligne : une valeur simple par String() ; un objet qui s'écrit lui-même (date, tableau, classe à toString)
  // par ce texte, comme avant ; un objet sans texte propre (« [object Object] », qui confondait tous les objets en une seule
  // ligne) ou une fonction, par son identité. L'identifiant vit dans une WeakMap, rien n'est écrit sur l'objet ;
  // l'enveloppe réactive et l'objet brut donnent la même clé
  const _mjs_keyIds = new WeakMap();
  // compteur des clés fabriquées, unique pour toute la page (clés d'objet ci-dessous, tatouage `_mjsId` de `_mjs_mjsTag`)
  let _mjs_idGen = 0;
  function _mjs_keyOf(k) {
    if (Object(k) !== k) return String(k);
    if (typeof k === 'object') {
      const s = String(k);
      if (!s.startsWith('[object ')) return s;
    }
    k = µ._mjs_toRaw(k);
    let id = _mjs_keyIds.get(k);
    if (id === void 0) _mjs_keyIds.set(k, id = 'mjs-o' + ++_mjs_idGen);
    return id;
  }

  // un `{for}` de racine se rejoue-t-il dans cette passe de structure ? Oui si l'une de ses variables a
  // été écrite depuis la dernière passe, ou si rien n'est connu : rendu complet (`_awaits_` : montage,
  // langue, promesse, reprise), écriture du store entier (`$$*`), ou avant la fin de la 1re passe
  // (`_mjs_chgd` n'existe pas encore). Un nom écrit en trop ne fait que rejouer la liste, jamais la figer
  µ.Element.prototype._mjs_chg = function(v) {
    var c = this._mjs_chgd;
    // passe de structure appelée directement, hors de la passe protégée : rien n'a été noté, tout est rejoué
    if (!c || !this._mjs_inRenderStruct || c.has('_awaits_') || c.has('$$*')) return true;
    for (var i = 0; i < v.length; i++) {
      if (c.has(v[i])) return true;
    }
    return false;
  };

  // _mjs_updFor : tplFn(item, index) retourne {fragment, refs} (plus de
  // HTML+paths). Le runtime n'a plus besoin de cloner/walker.
  // Cache `mjs-childtransition` sur le parentNode : pas de getAttribute
  // à chaque tick (sur update10thRow × 16, économise 16 getAttribute).
  µ.Element.prototype._mjs_updFor = function(id, col, tplFn, keyFn, updateFn, keyAttr) {
    var childMode, e, s, parent;
    s = this._mjs_nodes['s-' + id];
    e = this._mjs_nodes['e-' + id];
    // On ne court-circuite plus sur `!col` : une collection null/undefined
    // doit DÉTRUIRE les rows existantes (parité {if}), pas les laisser en
    // fantômes. `_mjs_reconcileList` gère la collection falsy (teardown + reset).
    if (!(s && e)) {
      return;
    }
    parent = s.parentNode;
    if (parent && parent._mjs_ctMode === void 0) {
      parent._mjs_ctMode = (typeof parent.getAttribute === "function")
        ? (parent.getAttribute('mjs-childtransition') || null)
        : null;
    }
    childMode = parent ? parent._mjs_ctMode : null;
    return this._mjs_reconcileList(id, s, e, childMode, col, tplFn, keyFn, updateFn, keyAttr);
  };

  // clé implicite `_mjsId` d'un item-objet de
  // `{for}` non keyé, SOURCE UNIQUE : appelée par `_mjs_reconcileList` ci-dessous
  // ET par le code généré du cacheId des `{for}` imbriqués (compile.ts,
  // `uniqueCacheId`) — l'occurrence sœur assignait directement `_mjsId`
  // (énumérable, crash sur objet gelé) au lieu de passer par ce même chemin.
  // `item` déjà garanti non-null/objet par l'appelant (branche `typeof ===
  // 'object'` posée avant l'appel des deux côtés). Un objet non extensible (gelé, scellé) ne peut pas porter le
  // tatouage : son identifiant vit dans la WeakMap des clés, le même d'un rendu à l'autre — un identifiant neuf à
  // chaque appel changeait le cache de la liste interne à chaque passe (éléments affichés en double sous une clé
  // `by` gelée, lignes d'éléments gelés refaites à chaque réaffectation). Jamais d'exception.
  µ.Element.prototype._mjs_mjsTag = function(item) {
    let key = item._mjsId || _mjs_keyIds.get(item);
    if (!key) {
      // compteur unique pour toute la page : le tatouage est posé sur l'objet, qu'un autre composant peut afficher aussi
      key = 'mjs-' + ++_mjs_idGen;
      if (Object.isExtensible(item)) Object.defineProperty(item, '_mjsId', { value: key, enumerable: false, configurable: true, writable: false });
      else _mjs_keyIds.set(item, key);
    }
    return key;
  };

  µ.Element.prototype._mjs_reconcileList = function(cacheId, startNode, endNode, childMode, col, tplFn, keyFn, updateFn, keyAttr) {
    var cache, d, dyingTail, entry, i, index, isArray, item, items, j, keysArr, l, lastItemNode, lastNode, len, len1, len2, m, n, newEntries, newKeySet, newKeys, nxt, o, oldKey, oldKeys, parentNode, ref, ref1, ref2, ref3;
    if (!col) {
      // Collection falsy (null/undefined) : au lieu d'un early-return qui
      // laissait les anciennes rows en fantômes (incohérence `[]` vide vs `null`
      // ne fait rien), on DÉTRUIT les rows entre les ancres (même walk que
      // `_mjs_updIf(null)`) et on réinitialise les tables du cacheId. Symétrie avec
      // {if}, qui détruit d'abord PUIS teste `if (!createFn) return`.
      if (startNode && endNode && startNode.parentNode) {
        // la plage entre les ancres est figée AVANT de détruire : le nettoyage d'un effet retire parfois
        // un FRÈRE de sa balise (la copie de *reflect, la bulle de *guard) ; lire `nextSibling` en
        // marchant s'arrêterait sur ce nœud parti et laisserait affichées les lignes suivantes, effets actifs
        const __range = [];
        let __n = startNode.nextSibling;
        while (__n && __n !== endNode) {
          __range.push(__n);
          __n = __n.nextSibling;
        }
        for (let __ri = 0, __rln = __range.length; __ri < __rln; __ri++) {
          const __t = __range[__ri];
          if (!__t.parentNode) continue; // déjà détaché : frère d'un effet nettoyé plus tôt dans la plage
          if (!__t._mjs_dying) {
            this._mjs_destroyNodeAndChildren(__t, childMode === 'all' || childMode === 'out' || childMode === 'transition');
          }
        }
      }
      if (this._mjs_list_cache) this._mjs_list_cache[cacheId] = new Map();
      if (this._mjs_list_order) this._mjs_list_order[cacheId] = [];
      if (this._mjs_list_pool != null) this._mjs_list_pool[cacheId] = void 0;
      return;
    }
    isArray = Array.isArray(col);
    // un Set donne ses éléments, une Map ses paires [clé, valeur] (comme `for…of`), rangées par position ; sans `by`, la
    // ligne d'une Map garde la clé de la Map comme clé (la paire est un tableau neuf à chaque passe)
    let __mapK = null;
    if (!isArray && (col instanceof Set || col instanceof Map)) {
      if (col instanceof Map && !keyAttr && !keyFn) __mapK = Array.from(col.keys());
      items = Array.from(col);
      isArray = true;
    }
    else {
      items = isArray ? col : Object.values(col);
    }
    keysArr = isArray ? null : Object.keys(col);
    this._mjs_list_cache ??= {};
    this._mjs_list_order ??= {};
    // Re-montage : si le bloc parent ({if}/{key}/{await}) a été démonté puis
    // recréé, `startNode` est une NOUVELLE ancre et les entries en cache
    // pointent sur des nœuds détruits. On repart alors d'un état frais → re-
    // rendu complet dans le conteneur recréé. Sans ça, `oldKeys` ferait croire
    // que tous les items existent déjà et rien ne serait inséré (cas vécu :
    // menu d'un tuto fermé puis rouvert → {for} interne vide).
    this._mjs_list_anchor ??= {};
    if (this._mjs_list_anchor[cacheId] !== startNode) {
      this._mjs_filtPurgeCache(this._mjs_list_cache[cacheId]);
      this._mjs_list_cache[cacheId] = new Map();
      this._mjs_list_order[cacheId] = [];
      if (this._mjs_list_pool != null) {
        this._mjs_list_pool[cacheId] = void 0;
      }
      this._mjs_list_anchor[cacheId] = startNode;
    }
    // Simplify Coffee ternaire (var ref = X) != null ? ref : default.
    cache = this._mjs_list_cache[cacheId] || new Map();
    oldKeys = this._mjs_list_order[cacheId] || [];
    // #2 — Dé-doublonnage défensif des clés AVANT la reconcile. Deux items de
    // même clé (`by id` avec ids dupliqués) font planter la phase d'insertion
    // (`insertBefore` sur un nœud déjà déplacé : "Failed to execute
    // 'insertBefore' on 'Node'"). On ne garde que la 1ère occurrence de chaque
    // clé + un warn une fois — parité Svelte/React — au lieu de crasher. Scan
    // O(n) (early-break au 1er doublon) ; le re-filtrage (allocation) ne
    // s'exécute QUE si un doublon est réellement présent (cas anormal).
    // PERF — dans le cas commun (aucun doublon, aucune clé null), le Set construit
    // ici EST exactement `new Set(newKeys)` → on le réutilise comme `newKeySet`
    // plus bas (`__dupKeySet`), de sorte que l'update (update10th/swap1k) ne paie
    // PAS de 2e construction de Set : coût net ~nul. Seul le fresh create alloue
    // un Set en plus (négligeable sur create1k).
    let __dupKeySet = null;
    // clé de chaque élément, lue UNE fois par passe et déjà convertie : le chemin rapide et la boucle principale la reprennent
    let __mk = null;
    // rang d'origine de chaque élément retenu quand des doublons sont écartés : l'index de la ligne reste celui de la
    // collection (sinon les lignes après le doublon recevaient un index décalé, et `splice(i, 1)` retirait un autre élément)
    let __ix = null;
    if (keyAttr || keyFn || __mapK) {
      const __n = items.length;
      __mk = new Array(__n);
      let __seen = new Set(), __hasDup = false, __hadNull = false;
      for (let __i = 0; __i < __n; __i++) {
        const __it = items[__i];
        let __k = keyAttr ? (__it != null ? __it[keyAttr] : null) : keyFn ? keyFn(__it, isArray ? __i : keysArr[__i]) : __mapK[__i];
        if (__k == null) { __hadNull = true; __mk[__i] = null; continue; }
        if (typeof __k !== 'string') __k = _mjs_keyOf(__k);
        __mk[__i] = __k;
        if (__seen.has(__k)) __hasDup = true;
        else __seen.add(__k);
      }
      if (__hasDup) {
        const __seen2 = new Set();
        const __fi = [], __fk = keysArr ? [] : null;
        __ix = [];
        // les clés retenues se tassent sur place dans `__mk` (l'écriture ne dépasse jamais la lecture)
        for (let __i = 0; __i < __n; __i++) {
          const __k = __mk[__i];
          if (__k !== null) {
            if (__seen2.has(__k)) continue;
            __seen2.add(__k);
          }
          __mk[__fi.length] = __k;
          __fi.push(items[__i]);
          __ix.push(__i);
          if (__fk) __fk.push(keysArr[__i]);
        }
        items = __fi;
        __mk.length = __fi.length;
        if (keysArr) keysArr = __fk;
        if (!this._mjs_dupKeyWarned) {
          this._mjs_dupKeyWarned = true;
          µ.warn(µ._mjs_msg('forDupKeys', { id: cacheId }, '{for} : clés dupliquées détectées — seules les 1ères occurrences sont rendues. Vérifiez l\'unicité de la clé `by`. (cacheId: {id})'));
        }
        // Après dé-dup : ne PAS réutiliser (clés null possibles, fallback _mjsId
        // dans la boucle principale → divergence) → newKeySet reconstruit (rare).
      } else if (!__hadNull) {
        // Cas commun : __seen == set des clés de newKeys → réutilisable.
        __dupKeySet = __seen;
      }
    }
    // Pré-allouer la capacité au lieu de let-V8-grow. Sur 1k items,
    // évite ~log2(1000) = ~10 reallocs/copies. Le `[]` puis push N fois
    // (V8 commence à 4 capacité, double à chaque grow).
    newKeys = new Array(items.length);
    newEntries = new Array(items.length);
    // Pool d'entries détruites par cacheId. Sur replace1k, la destruction
    // puis re-création immédiate du même template au même endroit (1000 tr
    // détruits → 1000 tr créés) bénéficie d'un pool : on réutilise les sous-
    // arbres au lieu de re-créer.
    // Activé uniquement si le composant n'a pas de hooks destroy
    // (cf. _mjs_noDestroyHooks) — sinon le node pourrait avoir des
    // listeners / _mjs_td / _mjs_outro résiduels.
    this._mjs_list_pool ??= {};
    var __pool = this._mjs_list_pool[cacheId];
    var __canPool = this.constructor._mjs_noDestroyHooks === true;
    var __poolLimit = 256;
    parentNode = startNode.parentNode;
    // Si le startNode a déjà été détaché (un bloc parent {if}/{key}/{await}
    // est en train d'être démonté), on ne tente PAS de réconcilier — le
    // cleanup parent va de toute façon retirer tout ce qui restait. Insérer
    // ailleurs causerait NotFoundError sur insertBefore.
    if (!parentNode) {
      return;
    }
    // Fast path "fresh creation". Si le cache est vide, tous les
    // `cache.get(key)` retournent undefined → on peut skip toute la logique
    // hasDead/hasDying. Sur create 1k items, gain ~3-5ms (1000 × Map.get +
    // 1000 × .some() évités).
    const isFreshCreate = cache.size === 0;
    const __raw = µ._mjs_rawSet.has(col);

    // ── Fast-path allStays ANTICIPÉ ──────────────────────
    // Cas dominant de `{for}` après mutation d'items (ex. update-every-10th :
    // mêmes clés, même ordre, seules les DONNÉES changent). Avant, on payait
    // 1000 objets `newEntries` + `new Set(newKeys)` + Map lookups AVANT de
    // découvrir l'allStays en bas. Ici on confirme l'ordre par une simple
    // comparaison de clés position-par-position (zéro allocation), puis on
    // appelle directement les updateFn. C'est l'équivalent du « zéro re-touch
    // structurel » de Solid/Svelte, sans signaux.
    // Garde-fous : pas de fresh-create, pas de transitions/await (childMode),
    // pas d'invalidation structurelle en cours, longueurs égales.
    const __wait0 = childMode === 'all' || childMode === 'out' || childMode === 'transition';
    if (!isFreshCreate && !__wait0 && items.length === oldKeys.length && cache.size === oldKeys.length) {
      let __same = true;
      // Passe 1 — VÉRIFICATION seule (zéro effet de bord, zéro allocation) :
      // mêmes clés dans le même ordre ET aucune entry en cours de mort/transition
      // (un nœud dead/dying invaliderait le skip structurel).
      for (let __qi = 0; __qi < items.length; __qi++) {
        // `__qi` est la POSITION NUMÉRIQUE ; pour
        // une collection OBJET (`{for cle, item in $obj}`), le chemin normal
        // (ex. ligne ~2554 dans cette même fonction) utilise
        // `isArray ? __i : keysArr[__i]` comme « index » (= la CLÉ objet).
        // Ce fast-path passait `__qi` nu partout → interpolation de la
        // variable d'index affichait 0,1,2… au lieu des clés, et tout `by`
        // fondé sur l'index basculait silencieusement hors fast-path.
        const __k = __mk !== null ? __mk[__qi] : null;
        if (__k === null) { __same = false; break; }
        if (__k !== oldKeys[__qi]) { __same = false; break; }
        const __en = cache.get(__k);
        const __n0 = __en && __en.nodes ? __en.nodes[0] : null;
        if (__n0 == null || __n0._mjs_dead || __n0._mjs_dying) { __same = false; break; }
      }
      if (__same) {
        // Passe 2 — seules les updateFn tournent. Aucune allocation d'entries,
        // aucun Set de clés, aucun toucher DOM structurel.
        // les lignes relisent le parent (retenue des écritures liées, en bas de fichier)
        µ._mjs_holdPush = 1;
        for (let __qi = 0; __qi < items.length; __qi++) {
          const __entry = cache.get(oldKeys[__qi]);
          if (__entry == null) continue;
          const __it = items[__qi];
          const __idxArg = isArray ? (__ix !== null ? __ix[__qi] : __qi) : keysArr[__qi];
          if (_mjs_skipRow(__entry, __it, __idxArg, __raw)) continue;
          if (__entry._mjs_updFn) __entry._mjs_updFn(__it, __idxArg);
          else if (updateFn) updateFn(__entry.__nodes, __it, __idxArg);
        }
        return;
      }
    }

    // Track les indices de newEntries qui correspondent à des entries DEAD
    // invalidées (cache.delete + nouvelle entry fresh sans insertion DOM).
    // Sans ça, le fast path `allStays` skip l'insertion alors que les fresh
    // nodes ne sont jamais attachés au DOM (cas vécu : recoche d'un `{if}`
    // qui contient un `{for}` dont les items étaient en outro complète).
    const __invalidatedIdx = new Set();
    // for classique au lieu de items.forEach((item, loopIndex) => {...}).
    // Évite l'allocation d'une closure-arrow par appel à _mjs_reconcileList et
    // facilite l'inlining V8 sur le hot loop create/update 1000 items.
    // Hoist let scope au lieu de var redéclaré (hidden classes V8 stables).
    const __itemsLen = items.length;
    const __occ = new Map();
    for (let __loopIdx = 0; __loopIdx < __itemsLen; __loopIdx++) {
      const item = items[__loopIdx];
      const loopIndex = __loopIdx;
      const index = isArray ? (__ix !== null ? __ix[loopIndex] : loopIndex) : keysArr[loopIndex];
      let key;
      // clé lue et convertie par la pré-passe ci-dessus
      const manualKey = __mk !== null ? __mk[__loopIdx] : null;
      if (manualKey !== null) {
        key = manualKey;
      } else if (item !== null && typeof item === 'object') {
        // cf. _mjs_mjsTag : tatouage non-énumérable,
        // repli silencieux sur objet non extensible.
        key = this._mjs_mjsTag(item);
        // même objet déjà vu dans la liste : le rang d'apparition sépare les occurrences (la 1re garde sa clé)
        const __nb = __occ.get(key) | 0;
        __occ.set(key, __nb + 1);
        if (__nb) key += '#' + __nb;
      } else {
        key = `idx-${index}`;
      }
      newKeys[__loopIdx] = key;
      let entry, hasDead, hasDying;
      if (isFreshCreate) {
        entry = void 0;
        hasDead = false;
        hasDying = false;
      } else if (__canPool) {
        // Composant sans destroy hooks : aucune entry ne peut être
        // _mjs_dying/_mjs_dead (le pool détache sans poser ces flags,
        // et le fast path retire le node du cache via cache.delete).
        // Skip le scan `.some()` ~25× plus rapide qu'un cache hit.
        entry = cache.get(key);
        hasDead = false;
        hasDying = false;
      } else {
        entry = cache.get(key);
        // Inline les .some() au lieu de chaining ternaire (4 niveaux
        // imbriqués Coffee). Aussi rapide en cache hit normal, beaucoup plus
        // léger en cache miss (entry == null → skip entire chain).
        // Le tplFn produit du HTML avec des espaces/newlines autour du `<div>`,
        // donc `entry.nodes` peut contenir [textNode, divNode, textNode].
        // On scanne TOUS les nodes pour trouver l'état effectif (un text node
        // n'aura jamais de _mjs_dying/_mjs_dead).
        if (entry && entry.nodes) {
          hasDead = false;
          hasDying = false;
          const __ens = entry.nodes;
          for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
            const __en = __ens[__ei];
            if (__en._mjs_dead) hasDead = true;
            if (__en._mjs_dying) hasDying = true;
            if (hasDead && hasDying) break;
          }
        } else {
          hasDead = false;
          hasDying = false;
        }
      }
      // Si une entry pointe vers un node dont l'outro est complète (removed
      // du DOM, _mjs_dead), invalider le cache et recréer fresh.
      if (entry && hasDead) {
        if (µ.debug) {
          µ.log(`[mjs-tx] reconcile ${cacheId} key=${key} → DEAD, invalidating`);
        }
        // Anti-leak : purge symétrique des filtered indexes pour
        // une entry invalidée DEAD (l'updateFn ne sera plus jamais appelée).
        this._mjs_filtPurgeEntry(entry);
        cache.delete(key);
        entry = void 0;
        hasDying = false;
        __invalidatedIdx.add(__loopIdx);
      }
      // Si l'entry pointe vers un node encore en outro (_mjs_dying mais pas
      // encore dead), redéclencher l'intro — `_mjs_runTransition` rebuild les
      // keyframes from current t et joue vers t=1 (continuité visuelle
      // parfaite, easing correct dans le sens intro).
      if (entry && hasDying) {
        if (µ.debug) {
          µ.log(`[mjs-tx] reconcile ${cacheId} key=${key} → DYING, reviving`);
        }
        const __dyingNodes = entry.nodes;
        for (let __dj = 0, __djLen = __dyingNodes.length; __dj < __djLen; __dj++) {
          const __dn = __dyingNodes[__dj];
          if (!__dn._mjs_dying) {
            continue;
          }
          __dn._mjs_dying = false;
          __dn._mjs_dead = false;
          // un node évacué en dyingTail avec
          // `@flip` (mjs_element.ts ~3167, `µ._mjs_fixPosition`) reste épinglé en
          // `position:absolute` + largeur/hauteur/position FIGÉES tant que
          // personne ne le retire. Sans ce nettoyage, une row ressuscitée ICI
          // (clé réapparue pendant son outro) rejouait son intro correctement
          // mais restait visuellement détachée du flux normal — un
          // `position:absolute` orphelin ne se corrige jamais tout seul.
          if (typeof µ._mjs_unfixPosition === 'function') {
            µ._mjs_unfixPosition(__dn);
          }
          if (__dn._mjs_intro) {
            (function(n) {
              return µ._mjs_whenLayouted(n, function() {
                return µ._mjs_playTransition(n, n._mjs_intro, 'in').then(function() {
                  if (n._mjs_dying || n._mjs_dead) {
                    return;
                  }
                  try {
                    return typeof n._mjs_cb_introend === "function" ? n._mjs_cb_introend() : void 0;
                  } catch (error1) {
                    return null;
                  }
                }).catch(function(err) {
                  return µ.warn("[ModularJS] Recyclage re-intro failed:", err);
                });
              });
            })(__dn);
          }
        }
      } else if (entry) {
        if (µ.debug) {
          µ.log(`[mjs-tx] reconcile ${cacheId} key=${key} → cache hit (alive)`);
        }
      } else {
        if (µ.debug) {
          µ.log(`[mjs-tx] reconcile ${cacheId} key=${key} → fresh node`);
        }
      }
      if (!entry) {
        // Pool : essaie de récupérer une entry déjà construite.
        // Le DOM des nodes est intact (attributes statiques préservés), seule
        // updateFn est ré-appliquée plus tard pour bind les valeurs dynamiques.
        let __reused = false;
        if (__pool && __pool.length > 0) {
          entry = __pool.pop();
          entry._mjs_ix = void 0;
          __reused = true;
        }
        if (!__reused) {
          // tplFn retourne maintenant {fragment, refs} directement.
          // Optim #5 — tplFn peut aussi retourner updateFn (refs en closure).
          const __built = tplFn(item, index);
          const __nodes = __built.refs || {};
          // Enregistre les éléments dans _nodeIds pour le routing événementiel.
          // Optim #5 — si tplFn a déjà appelé _mjs_registerRefs (cas closure refs),
          // skip pour éviter le double appel. Le tplFn pose __nodes._mjs_reg = true.
          if (!__nodes._mjs_reg) this._mjs_registerRefs(__nodes);
          // Capture les top-level nodes du fragment AVANT insertion. Une
          // fois inséré dans le DOM, le fragment est vidé.
          const __frag0 = __built.fragment;
          const __cnLen = __frag0.childNodes.length;
          // Optim #4 — fast-path single root : la majorité des row-templates
          // ont 1 seul top-level node. On évite new Array + boucle.
          let nodes;
          if (__cnLen === 1) {
            nodes = [__frag0.firstChild];
          } else {
            nodes = new Array(__cnLen);
            let __cn = __frag0.firstChild;
            for (let __ci = 0; __cn; __ci++) {
              nodes[__ci] = __cn;
              __cn = __cn.nextSibling;
            }
          }
          // Optim #5 — _mjs_updFn : closure updateFn capturant les refs locales.
          // Quand présent, _mjs_reconcileList l'appelle avec (item, index) au lieu
          // de l'updateFn global avec (__nodes, item, index).
          // `_mjs_init` = 1 quand le tplFn a DÉJÀ posé l'état initial (fusion
          // de la pose dans la factory, composants sans transitions). Le 1er
          // pass-updateFn est alors sauté (et `_mjs_init` remis à 0 → updates
          // futurs normaux).
          entry = {nodes, __nodes, _mjs_updFn: __built.updateFn || null, _mjs_init: __built._mjs_init || 0, _mjs_p: __built._mjs_p, _mjs_it: item, _mjs_ix: index};
          __nodes._mjs_en = entry;
        }
        cache.set(key, entry);
      }
      newEntries[__loopIdx] = {key, entry, item, index};
    }
    // Skip newKeySet alloc si oldKeys.length === 0 (fresh create) :
    // pas besoin de tester si chaque oldKey est encore dans newKeys.
    // #2/perf — réutilise le Set du pré-passage de dé-doublonnage quand il est
    // garanti égal à `new Set(newKeys)` (cas commun sans doublon ni clé null).
    newKeySet = oldKeys.length > 0 ? (__dupKeySet !== null ? __dupKeySet : new Set(newKeys)) : null;
    // Boucle for classique au lieu de forEach (évite alloc closure
    // par entry destroyed). Sur clear 1k items, gain ~1-2ms.
    const __wait = childMode === 'all' || childMode === 'out' || childMode === 'transition';

    // Bulk clear inspired par Solid `cleanChildren` (parent.textContent = "").
    // Condition stricte : full clear (newLen === 0), pas de hooks destroy, pas
    // de cascade outro. On utilise Range.deleteContents() qui efface tous les
    // nodes entre startNode et endNode en UNE seule opération native (1 reflow,
    // pas N × removeChild). Gain mesuré sur clear1k_x8 (de 145ms ~vers ~100ms).
    //
    // NB: On ne touche pas aux markers startNode/endNode (ils sont préservés
    // car le Range a startNode.nextSibling pour début et endNode pour fin).
    // On évacue toutes les entries du cache vers le pool si possible.
    if (__canPool && !__wait && items.length === 0 && oldKeys.length > 0 && parentNode.firstChild) {
      // Pool : on push les entries détachées (sans coût de removeChild individuel).
      // NB: Range.deleteContents détache TOUS les nodes du Range — ils restent
      // valides comme objets JS (intacts pour réutilisation).
      if (!__pool) __pool = this._mjs_list_pool[cacheId] = [];
      // Anti-leak : si la classe a des filtered indexes
      // (`_mjs_filt[<clé>].idx`), purger les entrées correspondantes pour les rows clear.
      // Sinon la Map garde des fns qui capturent les nodes → fuite mémoire
      // (typique des benchs cycliques create/clear×N et des feeds infinis).
      var __fk = this._mjs_filtIdxKeys;
      var __filtB = this._mjs_filt;
      // Optim #E — Bulk clear des filter Maps en UNE opération native.
      // Si toutes les entries d'une Map correspondent aux rows clear (cas
      // monoFor), `__idx.clear()` est O(1) au lieu de N×delete (O(N) overhead).
      // On vérifie size === oldKeys.length pour rester safe quand plusieurs
      // {for} partagent le même filtered attribute.
      if (__fk) {
        var __lent = false;
        for (const __idxName of __fk) {
          var __feB = __filtB && __filtB[__idxName];
          var __idxBulk = __feB && __feB.idx;
          if (__idxBulk && __idxBulk.size === oldKeys.length && !__feB.multi) __idxBulk.clear();
          else if (__idxBulk) __lent = true;
        }
        // une liaison dont l'index porte d'autres lignes que celles-ci : ligne par ligne (multi-{for} ou plusieurs lignes par valeur)
        if (__lent) for (j = 0, len = oldKeys.length; j < len; j++) this._mjs_filtPurgeEntry(cache.get(oldKeys[j]));
      }
      // Fix — vidange du cache en itérant les VALEURS, sans
      // get-par-clé : on ne reset _mjs_filterKeys que pour les entries qui partent
      // au pool (les autres sont GC avec leur objet), puis cache.clear() O(1)
      // au lieu de N×delete. Au clear mesuré (pool plein dès les warmups),
      // cette boucle ne fait quasi plus rien.
      var __room = __poolLimit - __pool.length;
      // Tableau RÉUTILISÉ (comme `_mjs_reusableFragment`/`_mjs_reusableRange`
      // plus bas) : accumule les champs de formulaire des entries qui partent
      // au pool, remis au gabarit plus bas UNE FOIS l'effacement DOM fait
      // (cf. `_mjs_mjsHasOwnState` : jamais avant, sous peine de voler la
      // sélection d'un radio étranger encore connecté).
      var __formNodesBulk = µ._mjs_reusableFormNodes;
      if (!__formNodesBulk) __formNodesBulk = µ._mjs_reusableFormNodes = [];
      __formNodesBulk.length = 0;
      if (__room > 0) {
        for (const __e of cache.values()) {
          if (__e && __e.__nodes && __e.__nodes._mjs_filterKeys) { __e.__nodes._mjs_filterKeys = null; __e.__nodes._mjs_filterFns = null; }
          // Même garde que le retrait un-par-un ci-dessous : un sous-arbre à
          // état propre ne part pas au pool (recyclage cross-clé interdit),
          // il est simplement abandonné au GC (déjà détaché du DOM par le
          // clear en masse ci-dessous).
          if (__e) {
            const __beforeLen = __formNodesBulk.length;
            // relevé VIVANT de la ligne, pris avant l'effacement : un `{if}` à sa racine a pu
            // changer ses nœuds depuis la création, et c'est ce relevé que la ligne recyclée
            // remettra à l'écran (l'instantané d'origine y ramenait un vieux texte)
            const __live = this._mjs_liveEntryNodes(__e.nodes);
            if (this._mjs_mjsHasOwnState(__live, __formNodesBulk)) {
              // pas poolable : rejette les champs captés pour CETTE entry
              // (elle n'ira jamais au pool, donc jamais remise au gabarit).
              __formNodesBulk.length = __beforeLen;
              continue;
            }
            __e.nodes = __live;
          }
          __pool.push(__e);
          if (--__room <= 0) break;
        }
      }
      cache.clear();
      // Effacement DOM. Cas « contrôlé » (à la Svelte 5) : si le {for} occupe
      // TOUT son conteneur (markers aux deux extrémités), `textContent = ''`
      // est le chemin RemoveChildren natif groupé — nettement plus rapide que
      // `Range.deleteContents()` qui traverse nœud à nœud en tenant ses bornes
      // (profiler : _mjs_reconcileList self-time 56 ms sur clear1k, dominé par ce
      // poste). Les markers détachés restent valides : on les ré-ancre.
      if (startNode.previousSibling === null && endNode.nextSibling === null && startNode.parentNode === parentNode) {
        parentNode.textContent = '';
        parentNode.appendChild(startNode);
        parentNode.appendChild(endNode);
      } else {
        var __r = µ._mjs_reusableRange;
        if (!__r) __r = µ._mjs_reusableRange = document.createRange();
        __r.setStartAfter(startNode);
        __r.setEndBefore(endNode);
        __r.deleteContents();
        // Gecko (FF151) : deleteContents() est un no-op silencieux quand les nœuds
        // du Range sont des enfants light-DOM assignés à un <slot> ({for} slotté) —
        // post-condition + repli par retrait manuel, Chromium ne paie jamais ce chemin
        if (startNode.nextSibling !== endNode) {
          let __n2 = startNode.nextSibling;
          while (__n2 && __n2 !== endNode) { const __t2 = __n2; __n2 = __n2.nextSibling; parentNode.removeChild(__t2); }
        }
      }
      // Remise au gabarit des champs de formulaire des lignes poolées —
      // seulement maintenant que le sous-arbre est détaché du document vivant.
      if (__formNodesBulk.length) this._mjs_mjsResetFormFields(__formNodesBulk);
      __formNodesBulk.length = 0;
      // Reset cache state (sera ré-écrit en bas de la fn).
      this._mjs_list_order[cacheId] = newKeys;
      this._mjs_list_cache[cacheId] = cache;
      return;
    }

    // Anti-leak : hoist le Set _mjs_filtIdxKeys hors de la boucle.
    // Si la classe n'utilise aucun filtered dispatch, le check est `null` →
    // l'overhead se limite à 1 lecture de prop par _mjs_reconcileList.
    var __fkSet = this._mjs_filtIdxKeys;
    // Destruction groupée pour le « replace total » (replace1k : AUCUNE
    // ancienne clé réutilisée). Au lieu de N removeChild individuels (poste
    // dominant au profil : ~76 ms sur replace1k), on détache TOUT le contenu du
    // {for} en UNE fois via `textContent=''` (chemin RemoveChildren natif
    // groupé, comme le clear). La boucle de destruction ci-dessous tourne
    // ensuite normalement : le `removeChild` y devient un no-op (parentNode
    // déjà null), mais le pooling et la purge filtered restent identiques —
    // donc aucune logique de réconciliation n'est court-circuitée. Conditions :
    // pas de transitions (__canPool && !__wait) et le {for} occupe tout son
    // conteneur (markers aux deux extrémités), exactement comme le fast-path
    // clear. Les nouvelles lignes (déjà construites, encore détachées) seront
    // insérées après par la phase de placement.
    if (__canPool && !__wait && oldKeys.length > 0 &&
        startNode.previousSibling === null && endNode.nextSibling === null &&
        startNode.parentNode === parentNode) {
      let __anyReused = false;
      for (let __ri = 0; __ri < oldKeys.length; __ri++) {
        if (newKeySet.has(oldKeys[__ri])) { __anyReused = true; break; }
      }
      if (!__anyReused) {
        // lignes à plusieurs nœuds de tête (un `{if}` à leur racine) : relevé VIVANT de chacune
        // AVANT le retrait groupé — détachés, ses nœuds ne se retrouvent plus entre ses bornes, et
        // l'instantané de création, périmé après une bascule de branche, partirait à la réserve
        const __e0 = cache.get(oldKeys[0]);
        if (__e0 && __e0.nodes.length > 1) {
          for (let __ri = 0; __ri < oldKeys.length; __ri++) {
            const __eo = cache.get(oldKeys[__ri]);
            if (__eo) __eo.nodes = this._mjs_liveEntryNodes(__eo.nodes);
          }
        }
        parentNode.textContent = '';
        parentNode.appendChild(startNode);
        parentNode.appendChild(endNode);
      }
    }
    // Tableau RÉUTILISÉ (même singleton que le chemin bulk-clear plus haut) :
    // collecte les champs de formulaire d'UNE entry à la fois, remis au
    // gabarit juste après son removeChild (jamais avant, cf.
    // `_mjs_mjsHasOwnState`). Nettoyé au tout début de chaque itération
    // concernée pour ne jamais faire fuiter les nœuds d'une entry précédente.
    var __formNodes = µ._mjs_reusableFormNodes;
    if (!__formNodes) __formNodes = µ._mjs_reusableFormNodes = [];
    for (j = 0, len = oldKeys.length; j < len; j++) {
      oldKey = oldKeys[j];
      if (!newKeySet.has(oldKey)) {
        entry = cache.get(oldKey);
        const __ens = this._mjs_liveEntryNodes(entry.nodes);
        // Pool des entries au lieu de destroy si pas de hooks destroy,
        // qu'on n'a pas de cascade outro à jouer, ET que le sous-arbre ne
        // porte aucun état hors gabarit (sinon la ligne recyclée pour une
        // AUTRE clé emporterait avec elle un input tapé/un composant enfant —
        // une clé doit garantir l'identité). Détection SEULE (aucune
        // écriture) : le node est encore CONNECTÉ ici, le removeChild vient
        // plus bas.
        let __hasOwnState = true;
        if (__canPool && !__wait) {
          __formNodes.length = 0;
          __hasOwnState = this._mjs_mjsHasOwnState(__ens, __formNodes);
        }
        if (__canPool && !__wait && !__hasOwnState) {
          // anti-leak {for} imbriqué :
          // le chemin pool fait un `removeChild` DIRECT (jamais
          // `_mjs_destroyNodeAndChildren`), donc la purge du sous-arbre doit se faire
          // ICI. Sûr car `__canPool && !__wait` ⇒ pas d'outro ⇒ pas de revive.
          // La branche `else` (destroy réel avec outro) purge, elle, à la mort
          // DÉFINITIVE via `_mjs_mjsPurgeSubtreeState` : y purger tôt casserait le
          // revival dying-tail (une row `@out` ré-apparue PENDANT son outro
          // dupliquerait le {for} imbriqué — cache purgé mais DOM ressuscité).
          if (this._mjs_list_anchor != null) {
            for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
              const __rn = __ens[__ei];
              if (__rn.nodeType === 1) this._mjs_mjsPurgeNestedListCaches(__rn);
            }
          }
          if (!__pool) __pool = this._mjs_list_pool[cacheId] = [];
          if (__pool.length < __poolLimit) {
            // Détache les nodes du DOM (les laisse intacts pour réutilisation).
            for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
              var __nd = __ens[__ei];
              if (__nd.parentNode) __nd.parentNode.removeChild(__nd);
            }
            // Remise au gabarit — seulement maintenant que le sous-arbre est
            // détaché du document vivant (plus aucun risque de mutuelle
            // exclusion native sur un radio étranger).
            if (__formNodes.length) this._mjs_mjsResetFormFields(__formNodes);
            // la ligne recyclée remettra à l'écran ses nœuds VIVANTS, pas l'instantané de sa
            // création (périmé si un `{if}` à sa racine a basculé depuis)
            entry.nodes = __ens;
            __pool.push(entry);
          } else {
            // Pool plein : on peut quand même bypass le walk DFS car
            // __canPool implique _mjs_noDestroyHooks (pas de transitions).
            // Entry jetée au GC juste après : pas la peine de la remettre au gabarit.
            for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
              var __ndr = __ens[__ei];
              if (__ndr.parentNode) __ndr.parentNode.removeChild(__ndr);
            }
          }
        } else {
          for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
            this._mjs_destroyNodeAndChildren(__ens[__ei], __wait);
          }
        }
        // Anti-leak : purger les filtered indexes (cf. note plus
        // haut). Critique pour le pool : sinon l'entry retournera avec une
        // entrée fantôme dans `_mjs_filt[X].idx` liée à l'ANCIEN node (rebound via
        // closure capture) → fuite + résultats erronés au prochain mute.
        if (__fkSet) this._mjs_filtPurgeEntry(entry);
        cache.delete(oldKey);
      }
    }
    // Nœuds en outro (dying) — DEUX régimes selon `@flip` :
    //
    // • SANS `@flip` (défaut, ex. crossfade simple) : façon Svelte, le nœud
    //   mourant RESTE DANS LE FLUX à sa place. Le `transform` l'anime sans
    //   toucher sa boîte → il tient son créneau jusqu'à la fin de l'outro, puis
    //   est retiré (la liste ne se referme qu'à ce moment). On ne l'évacue PAS /
    //   ne l'épingle PAS en `absolute` (ça refermait la liste IMMÉDIATEMENT → les
    //   voisins comblaient le trou pendant l'outro → superposition à la suppr).
    //   On le COLLECTE seulement pour que la réinsertion des vivants le SAUTE
    //   (skip `_mjs_dying` dans la boucle backward), sinon `nextSibling` croirait
    //   une mauvaise position (« inversion visuelle »).
    //
    // • AVEC `@flip` : ANCIEN comportement — évacuer le dying en fin de zone +
    //   l'épingler en `absolute` à sa position d'origine. Le FLIP a BESOIN que
    //   les vivants reflowent PENDANT ce reconcile (il mesure leur position
    //   avant/après pour animer le glissement). Si on gardait le dying en flux,
    //   les vivants ne bougeraient pas ici → FLIP voit un delta nul → pas de
    //   glissement (saut à la fin de l'outro). Le flip masque lui-même le trou.
    //
    // `__canPool` (`_mjs_noDestroyHooks`) ⇒ pas de transitions ⇒ aucun dying.
    var __hasFlip = this.constructor._mjs_hasFlip === true;
    dyingTail = [];
    if (!__canPool) {
      n = startNode.nextSibling;
      while (n && n !== endNode) {
        if (n._mjs_dying) {
          dyingTail.push(n);
        }
        n = n.nextSibling;
      }
      if (__hasFlip) {
        for (l = 0, len1 = dyingTail.length; l < len1; l++) {
          d = dyingTail[l];
          parentNode.insertBefore(d, endNode);
          if (d._mjs_xfRect && typeof µ._mjs_fixPosition === 'function') {
            µ._mjs_fixPosition(d, d._mjs_xfRect);
            d._mjs_xfRect = null;
          }
        }
      }
    }
    // Avec flip : insérer les vivants avant le 1er dying évacué. Sinon (in-flow) :
    // relativement à endNode (le skip `_mjs_dying` backward gère les dying inline).
    lastNode = (__hasFlip && dyingTail.length > 0) ? dyingTail[0] : endNode;

    // Fast path "fresh create" : si cache était vide AVANT cette itération
    // (isFreshCreate) ET qu'on n'a rien détruit (oldKeys.length === 0), tous les
    // items sont nouveaux. On peut bypass LIS+dyingTail+stays check et faire un
    // append linéaire dans UN fragment unique, puis UN seul insertBefore.
    // Gain sur create 1k items : ~5-10ms.
    if (isFreshCreate && oldKeys.length === 0 && dyingTail.length === 0) {
      // Accumule TOUT dans un fragment puis insère. Fragment pris en EXCLUSIVITÉ jusqu'à
      // l'insertion : un rendu réveillé PENDANT `insertBefore` (slotchange synchrone sous
      // happy-dom, le DOM du module de test) reprenait le même fragment encore plein et
      // emportait nos lignes dans son propre conteneur — il en crée un autre, et le nôtre
      // revient au pool une fois vidé par l'insertion.
      var __freshFrag = µ._mjs_reusableFragment || document.createDocumentFragment();
      µ._mjs_reusableFragment = null;
      const __ne = newEntries;
      const __neLen = __ne.length;
      for (let __ix = 0; __ix < __neLen; __ix++) {
        const __ent = __ne[__ix];
        const __entryNodes = __ent.entry.nodes;
        const __enLen = __entryNodes.length;
        for (let __ni = 0; __ni < __enLen; __ni++) {
          __freshFrag.appendChild(__entryNodes[__ni]);
        }
      }
      parentNode.insertBefore(__freshFrag, endNode);
      µ._mjs_reusableFragment = __freshFrag;
      // Appel des updateFn APRÈS insertion (cohérent avec sémantique).
      // Optim #5 — préférer entry._mjs_updFn (closure refs locales) si présent.
      // Une entry fraîche dont le tplFn a déjà posé l'état (_mjs_init=1)
      // saute ce passage (et repasse en update normal aux tours suivants).
      µ._mjs_holdPush = 1;
      for (let __ix = 0; __ix < __neLen; __ix++) {
        const __ent = __ne[__ix];
        const __entry = __ent.entry;
        if (__entry._mjs_init) {
          __entry._mjs_init = 0;
        } else if (__entry._mjs_updFn) {
          __entry._mjs_updFn(__ent.item, __ent.index);
        } else if (updateFn) {
          updateFn(__entry.__nodes, __ent.item, __ent.index);
        }
      }
      this._mjs_list_order[cacheId] = newKeys;
      this._mjs_list_cache[cacheId] = cache;
      return;
    }

    // ALGO DE PLACEMENT : LIS-based (Svelte 3-5 / Vue 3 / React Fiber).
    //
    // L'algo naïf fait `insertBefore` par item DÉPLACÉ → sur un reorder
    // complet (sort), c'est N insertBefore. LIS calcule la plus longue
    // sous-séquence d'indices "déjà ordonnés" — ces items restent en place
    // (zéro DOM op) — et fait `insertBefore` UNIQUEMENT sur les autres.
    //
    // Sur un sort de 1000 items : algo naïf = 1000 insertBefore ; LIS = ~50
    // (les 950 dans la LIS restent stables).
    //
    // Fast path "all-stays" : sur update10thRow / partial-update, l'ordre
    // ne change PAS (mêmes keys au même rang). On évite alors : Map alloc (+N
    // inserts), Array.map alloc, _mjs_lis() (Set alloc + N log N algo). On va
    // directement à la phase updateFn. Détection O(N) très bon marché.
    // Si des entries DEAD ont été invalidées, on NE PEUT PAS prendre le fast
    // path allStays — les fresh nodes correspondants ne sont pas encore dans
    // le DOM, il faut passer par le LIS path qui les insère.
    let allStays = __invalidatedIdx.size === 0 && newKeys.length === oldKeys.length;
    if (allStays) {
      for (let __ki = 0, __kln = newKeys.length; __ki < __kln; __ki++) {
        if (newKeys[__ki] !== oldKeys[__ki]) { allStays = false; break; }
      }
    }
    // Fast path allStays terminal : on bypass complètement la boucle
    // backward fragment-build (inutile car aucun DOM move) et on applique juste
    // updateFn forward sur les entries. Économise ~N iterations + checks.
    // Mesure : sur update10thRow × 1000 rows, ~2-5ms.
    if (allStays) {
      // Optim #5 — préférer entry._mjs_updFn (closure refs locales) si présent.
      µ._mjs_holdPush = 1;
      const __ne = newEntries;
      const __neLen = __ne.length;
      for (let __ix = 0; __ix < __neLen; __ix++) {
        const __ent = __ne[__ix];
        const __entry = __ent.entry;
        if (_mjs_skipRow(__entry, __ent.item, __ent.index, __raw)) continue;
        if (__entry._mjs_updFn) {
          __entry._mjs_updFn(__ent.item, __ent.index);
        } else if (updateFn) {
          updateFn(__entry.__nodes, __ent.item, __ent.index);
        }
      }
      this._mjs_list_order[cacheId] = newKeys;
      this._mjs_list_cache[cacheId] = cache;
      return;
    }
    let oldPosArr, lisSet;
    // Construction du tableau d'index : pour chaque newEntries[i], `oldPosArr[i]`
    // = position dans oldKeys (ou -1 si nouveau). Les `-1` sont toujours
    // insérés. La LIS opère sur les positions valides.
    const oldKeyToIdx = new Map();
    for (let oi = 0; oi < oldKeys.length; oi++) oldKeyToIdx.set(oldKeys[oi], oi);
    oldPosArr = newEntries.map((e, __mi) => {
      // Une entry invalidée DEAD est une fresh node — sa key existait dans
      // oldKeys mais le node n'est plus là. On la traite comme "nouvelle"
      // dans la LIS pour forcer son insertion DOM.
      if (__invalidatedIdx.has(__mi)) return -1;
      const pos = oldKeyToIdx.get(e.key);
      return pos === undefined ? -1 : pos;
    });
    lisSet = µ._mjs_lis(oldPosArr);

    // DocumentFragment batch insert.
    //
    // L'algo backward insère normalement chaque item via N × insertBefore
    // individuels (N nodes par item × M items). Sur create 1k items × ~5
    // nodes/item = 5000 insertBefore → 5000 reflows potentiels.
    //
    // Optim : accumule les nodes consécutifs (en ordre forward dans le fragment)
    // tant qu'ils s'insèrent au même point d'ancrage (`domAnchor`). Dès qu'on
    // rencontre un "stays" (item qui ne bouge pas) → on flush le fragment AU
    // POINT D'ANCRAGE COURANT (qui est dans le DOM), puis on met l'ancrage
    // sur le premier node du stays. Flush final à la fin.
    //
    // Note importante : `lastNode` change à chaque itération (pour le check
    // `lastItemNode.nextSibling !== lastNode`), mais `domAnchor` ne change
    // QUE quand on rencontre un stays ou à la fin — sinon il garde la position
    // DOM où on insérera le fragment accumulé.
    //
    // Sur create from empty, tous les items sont "moves" et la totalité de la
    // liste passe par UN seul appel `parentNode.insertBefore(frag, endNode)`.
    // DocumentFragment réutilisable (pool singleton).
    //
    // `document.createDocumentFragment()` est cheap mais alloué × chaque
    // _mjs_reconcileList. Le réutiliser réduit la pression GC et économise
    // 1-3ms cumulé sur les reorders fréquents.
    //
    // Sémantique : après `parentNode.insertBefore(frag, anchor)`, le fragment
    // est automatiquement vidé par le browser (move semantics). On peut donc
    // le réutiliser immédiatement après chaque flush. Pris en exclusivité
    // jusqu'au dernier flush, comme pour la création fraîche ci-dessus.
    var __fragHasChild = false;
    var __frag = µ._mjs_reusableFragment || document.createDocumentFragment();
    µ._mjs_reusableFragment = null;
    var __domAnchor = lastNode;
    // PASS 1 — placement DOM : on attache TOUS les nodes au parent réel via
    // l'algo LIS, en accumulant dans __frag puis flush au point d'ancrage.
    // PAS d'appel updateFn dans cette passe — sinon les bindings (transitions,
    // @attach, ...) tireraient sur des nodes encore dans le fragment temporaire
    // (`__frag`), donc !isConnected → getComputedStyle vide, offsetHeight=0,
    // sampling slide/fly à 0 → animation invisible. Cas vécu : recoche d'un
    // `{if}` qui contient un `{for}` avec `@transition.slide.global`.
    for (i = m = ref2 = newEntries.length - 1; m >= 0; i = m += -1) {
      ({entry} = newEntries[i]);
      // µ-opt — hoist les nodes de l'entrée (relus 4× : last, first×2, ref3) + `nodes[0]`.
      // `_mjs_liveEntryNodes` et pas `entry.nodes` : une entrée dont un `{if}` racine a
      // basculé porte, dans le DOM, des nœuds absents de l'instantané. Les oublier
      // ici ne fuit pas — ça DÉPLACE la ligne en laissant son `{if}` derrière elle.
      const __en = this._mjs_liveEntryNodes(entry.nodes);
      const __n0 = __en[0];
      lastItemNode = __en[__en.length - 1];
      const stays = oldPosArr[i] !== -1 && lisSet.has(i);
      // Saute les nœuds en outro (dying) restés inline : ils ne comptent pas pour
      // juger si un vivant est « déjà à la bonne place ». Sans ce skip, un dying
      // entre deux vivants ferait échouer le test → insertBefore inutile + ordre
      // faux (l'ancienne raison de la dying-tail).
      var __nsLiving = lastItemNode.nextSibling;
      while (__nsLiving && __nsLiving._mjs_dying) { __nsLiving = __nsLiving.nextSibling; }
      if (stays || __nsLiving === lastNode) {
        if (__fragHasChild) {
          parentNode.insertBefore(__frag, __domAnchor);
          __fragHasChild = false;
        }
        __domAnchor = __n0;
      } else {
        var __firstChildBefore = __frag.firstChild;
        for (o = 0, len2 = __en.length; o < len2; o++) {
          __frag.insertBefore(__en[o], __firstChildBefore);
        }
        __fragHasChild = true;
      }
      lastNode = __n0;
    }
    if (__fragHasChild) {
      parentNode.insertBefore(__frag, __domAnchor);
    }
    µ._mjs_reusableFragment = __frag;
    // PASS 2 — bindings : maintenant que tous les nodes sont dans parentNode,
    // updateFn voit isConnected=true et le sampling fonctionne correctement.
    // Une entry fraîche dont le tplFn a déjà posé l'état (_mjs_init=1, émis
    // seulement pour les composants SANS transitions/@attach) saute ce passage.
    µ._mjs_holdPush = 1;
    for (i = m = ref2 = newEntries.length - 1; m >= 0; i = m += -1) {
      ({entry, item, index} = newEntries[i]);
      if (entry._mjs_init) {
        entry._mjs_init = 0;
      } else if (_mjs_skipRow(entry, item, index, __raw)) {
        continue;
      } else if (entry._mjs_updFn) {
        entry._mjs_updFn(item, index);
      } else if (updateFn) {
        updateFn(entry.__nodes, item, index);
      }
    }
    this._mjs_list_order[cacheId] = newKeys;
    return this._mjs_list_cache[cacheId] = cache;
  };

  // Écritures liées retenues pendant une réconciliation. Une ligne qui change de place voit ses enfants déconnectés puis reconnectés ; ce qu'un
  // enfant écrit alors dans sa propriété liée (`µawake`, rejoué à chaque connexion) part vers le gestionnaire de sa ligne, qui lit l'élément par
  // l'indice gardé sur le nœud : tant que la ligne n'a pas repris son indice (passe des liaisons, ci-dessus), c'est celui de l'ancienne place, et
  // l'écriture tombe chez l'élément qui l'occupe. Elle attend donc la fin de la réconciliation la plus extérieure (une liste imbriquée se
  // réconcilie dans la mise à jour de la ligne qui la porte), puis part, une fois par enfant et par propriété, vers la ligne d'arrivée
  //
  // la passe des liaisons (`µ._mjs_holdPush`) relit le parent dans l'enfant et remet sa valeur par-dessus ce que l'enfant vient d'écrire : on
  // garde donc, pour ce que l'enfant écrit avant elle, la dernière valeur (`value`) et celle d'avant son écriture (`before`) ; si la passe a
  // remis `before`, le parent n'a rien changé et l'écriture de l'enfant est rejouée, sinon le parent a changé la ligne en même temps et il
  // gagne ; ce que la passe écrit elle-même (`0`) repart avec la valeur que l'enfant tient alors
  µ._mjs_hold     = 0;
  µ._mjs_holdPush = 0;
  µ._mjs_holdBind = function(el, k, old) {
    const held = µ._mjs_held ||= new Map();
    let keys = held.get(el);
    if (!keys) held.set(el, keys = new Map());
    if (µ._mjs_holdPush) {
      if (!keys.has(k)) keys.set(k, 0);
      return;
    }
    let rec = keys.get(k);
    if (!rec) keys.set(k, rec = { before: old, value: void 0 });
    rec.value = el._state[k];
  };
  const baseReconcile = µ.Element.prototype._mjs_reconcileList;
  µ.Element.prototype._mjs_reconcileList = function() {
    const push = µ._mjs_holdPush;
    µ._mjs_hold++;
    µ._mjs_holdPush = 0;
    try {
      return baseReconcile.apply(this, arguments);
    } finally {
      µ._mjs_holdPush = push;
      if (--µ._mjs_hold === 0) {
        const held = µ._mjs_held;
        µ._mjs_held = null;
        if (held) held.forEach((keys, el) => {
          if (!el._mjs_is_mounted) return;
          keys.forEach((rec, k) => {
            const cur = el._state[k];
            if (rec && cur !== rec.value && cur === rec.before) el._set(k, rec.value);
            else el._mjs_emitBind(k);
          });
        });
      }
    }
  };
}
