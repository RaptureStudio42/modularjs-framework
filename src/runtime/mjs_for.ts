// mjs_for — bloc `{for}` (listes réactives, réconciliation par clé). Patch de
// `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même technique que mjs_on.ts/
// mjs_flip.ts : ajouté APRÈS la classe, DOIT rester après mjs_element.ts dans la
// concaténation — et AVANT mjs_flip.ts, qui capture `_mjs_reconcileList` à son propre
// chargement pour le patcher, cf. bundler/index.ts). `{for item in $liste}`
// compile en `this._mjs_updFor(...)` (racine, `{if}` et `{key}`) / `this._mjs_updList(...)` (liste dans
// une autre liste ou dans une branche `{await}` — mjs_for_nested.ts, joint à part sur ce même
// appel, cf. son en-tête) — les deux délèguent à `_mjs_reconcileList`, le moteur
// de réconciliation (LIS, dying/revive, FLIP), aidé de `_mjs_liveEntryNodes`
// et `_mjs_mjsPurgeNestedListCaches` (fuite des caches de `{for}` imbriqués détruits
// pour de bon). `_mjs_mjsTag` (tatouage `_mjsId` d'un item-objet non keyé) est
// partagé avec le cacheId des `{for}` imbriqués (compile.ts). Un composant qui
// n'écrit jamais `{for}` (ni directement, ni via un module du cœur qu'il
// utilise, ex. `<@@select>`) n'appelle donc jamais ces méthodes.

// `µ._mjs_inside` (test d'inclusion insensible à une méthode `contains` du composant) : posé par
// mjs_element.ts, toujours au cœur avant ce fichier

// blocs `<filtered-bindings>` : retirés du cœur par le bundler quand aucune unité du build n'écrit de liaison filtrée par valeur
// (generator/attributes/index.ts, filteredBinding) — sans elle, aucune ligne ne range de clé dans `_mjs_filtIdxKeys`
// <filtered-bindings>
// index des lignes d'une liaison filtrée par valeur (`_mjs_filt[<liaison>].idx`, cf. generator/attributes/index.ts) : une clé porte la fonction de sa ligne ;
// quand plusieurs lignes portent la même valeur, un Set de leurs fonctions (`multi` : la purge en masse ne peut plus compter une entrée par ligne)
// <multiple-filters>
µ._mjs_filtPut = function(fe, k, f) {
  var e = fe.idx.get(k);
  if (e === void 0) fe.idx.set(k, f);
  else if (e instanceof Set) e.add(f);
  else if (e !== f) { fe.idx.set(k, new Set([e, f])); fe.multi = true; }
};
// </multiple-filters>
// retire la fonction `f` d'une ligne de la clé `k` (sans `f`, l'entrée entière : la ligne n'a jamais posé la sienne) ; l'entrée d'une autre ligne reste
µ._mjs_filtDrop = function(idx, k, f) {
  var e = idx.get(k);
  if (e instanceof Set) { e.delete(f); if (!e.size) idx.delete(k); }
  else if (f === void 0 || e === f) idx.delete(k);
};
// <multiple-filters>
// appelle la fonction de chaque ligne de la clé (`e` : l'entrée de l'index, absente si personne ne porte la valeur)
µ._mjs_filtCall = function(e, m) {
  if (e instanceof Set) e.forEach(function(f) { f(m); });
  else if (e) e(m);
};
// </multiple-filters>
// </filtered-bindings>

if (µ.Element) {
  // <filtered-bindings>
  // retire de l'index filtré la fonction de chaque liaison d'une ligne qui disparaît : l'index la garderait, avec le nœud mort qu'elle ferme.
  // La première liaison filtrée du gabarit range sa clé et sa fonction en champs directs (`_mjs_fk`, `_mjs_ff`), sans dire son index : elles
  // sont retirées de chacun, et l'index d'une autre liaison, qui ne garde jamais cette fonction, n'y perd rien (le retrait compare la fonction).
  // Une liaison suivante les range sous le nom de son index (`_mjs_filterKeys` dit sous quelle clé, `_mjs_filterFns` laquelle)
  µ.Element.prototype._mjs_filtPurgeEntry = function(entry) {
    var names = this._mjs_filtIdxKeys, nodes = entry && entry.__nodes, keys, k, f;
    if (!names || !nodes) return;
    keys = nodes._mjs_filterKeys;
    k    = nodes._mjs_fk;
    f    = nodes._mjs_ff;
    if (!keys && f === void 0) return;
    for (var name of names) {
      var fe = this._mjs_filt[name];
      if (!fe || !fe.idx) continue;
      if (f !== void 0) µ._mjs_filtDrop(fe.idx, k, f);
      if (keys && keys[name] !== void 0) µ._mjs_filtDrop(fe.idx, keys[name], nodes._mjs_filterFns ? nodes._mjs_filterFns[name] : void 0);
    }
    if (keys) {
      nodes._mjs_filterKeys = null;
      nodes._mjs_filterFns  = null;
    }
  };

  // la même purge pour les lignes d'un cache de liste qu'on abandonne d'un bloc (ancres refaites, ligne parente détruite)
  µ.Element.prototype._mjs_filtPurgeCache = function(cache) {
    if (cache) for (var entry of cache.values()) this._mjs_filtPurgeEntry(entry);
  };
  // </filtered-bindings>


  // fuite non bornée des caches de
  // {for} imbriqués : `_mjs_list_cache`/`_mjs_list_order`/`_mjs_list_anchor`
  // (posés par `µ.Element.prototype._mjs_reconcileList`, plus bas dans ce fichier) sont indexés par un cacheId
  // qui embarque la clé/l'id de LA ROW qui les contient (compile.ts
  // `uniqueCacheId`). Quand cette row est supprimée de la liste EXTÉRIEURE,
  // rien ne purgeait ces 3 tables → chaque row qui a un jour existé (avec un
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
          // <filtered-bindings>
          this._mjs_filtPurgeCache(this._mjs_list_cache[cacheId]);
          // </filtered-bindings>
          delete this._mjs_list_cache[cacheId];
        }
        if (this._mjs_list_order) delete this._mjs_list_order[cacheId];
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
  // snapshot d'origine si les bornes ont disparu du DOM (détachées).
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


  // <fine-grained>
  // lignes propres (mise à jour fine) : une liste `{for}` d'une variable qui a sa table (`_mjs_fine`, transpiler/index.ts) est propre après
  // chacune de ses passes ; une écriture de la variable qui n'est ni servie champ par champ (mjs_deep.ts) ni un changement de structure
  // compilé la salit (`_mjs_invalidate`, mjs_element.ts) : tout changement du contenu de ses lignes vu par MJS est déjà à l'écran ou la
  // salit. Rend 2 pour une liste propre — sa passe saute les lignes pures qui gardent leur objet, comme celles d'une liste µraw — et 0 pour
  // une liste sale, jamais passée ou sans table (relue entière). Notée propre dès le début de la passe : une écriture faite pendant la passe
  // la salit pour la suivante. `_mjs_fineIds` : id de la liste → 1 (sale) ou la marque de sa dernière passe (2 et plus), fait à la première
  // passe d'après la table
  function _mjs_isClean(el, id) {
    let fi = el._mjs_fineIds;
    if (el._mjs_fine === void 0) return 0;
    if (fi === void 0) {
      fi = el._mjs_fineIds = {};
      for (const k in el._mjs_fine) {
        const r = el._mjs_fine[k].r;
        // une liste aux lignes propres dans la page : les écritures d'objets se comptent désormais pour elle (`µ._mjs_fineL`, mjs_deep.ts)
        if (r !== void 0) for (const l of r) fi[l[0]] = µ._mjs_fineL = 1;
      }
    }
    const s = fi[id];
    if (s === void 0) return 0;
    // propre si rien ne l'a salie et si aucune écriture d'objet n'a été faite ailleurs depuis sa passe (magasin, autre composant, cf.
    // µ._mjs_extW, mjs_init.ts) : un objet qu'elle montre a pu changer par MJS sans que ce composant le sache
    const d = 2 + µ._mjs_extW - (el._mjs_selfW || 0);
    fi[id] = d;
    return s === d ? 2 : 0;
  }
  // </fine-grained>

  // les props livrées aux composants d'une ligne, oubliées, ceux des blocs qu'elle porte compris (un {for} imbriqué tient les siens à part) :
  // la passe qui suit les leur écrit toutes (cf. µ._mjs_prop, mjs_init.ts)
  function _mjs_forgetProps(ent) {
    const refs = ent.__nodes, roots = ent.nodes;
    for (const k in refs) {
      const n = refs[k];
      if (n && n._mjs_pv) n._mjs_pv = null;
    }
    for (let i = 0; i < roots.length; i++) {
      const all = roots[i].getElementsByTagName ? roots[i].getElementsByTagName('*') : [];
      for (let j = 0; j < all.length; j++) if (all[j]._mjs_pv) all[j]._mjs_pv = null;
    }
  }

  // passe des liaisons, dans l'ordre de la liste : chaque ligne reçoit son élément et son index (`ens` : les entrées dans cet ordre, jamais
  // cherchées dans le cache). Une ligne dont le gabarit vient de poser l'état (`_mjs_init`) attend la passe suivante. Les lignes relisent
  // le parent (retenue des écritures liées, en bas de fichier). La passe faite, les entrées restent notées sur le tableau des clés
  // (`_mjs_rows`) : la passe suivante les y lit, dans l'ordre (cf. `_mjs_forShort`).
  // ligne sautée, sans appel : ligne pure (`_mjs_p`, posé par le compilateur) d'une collection µraw, même élément que celui de la dernière
  // mise à jour, et même index quand la ligne le lit (`_mjs_p` vaut 2 quand elle ne le lit pas). L'entrée garde toujours l'élément et
  // l'index d'aujourd'hui, la ligne sautée comme les autres : les gestionnaires d'une ligne pure les y lisent.
  // l'élément est une valeur simple ou lui-même µraw : un objet ordinaire d'une liste µraw reste modifiable sur place par un autre chemin
  // suivi (tableau réactif d'origine, store), comme le proxy suivi d'un objet marqué µraw après coup (il rend son objet brut, `µ._mjs_RAW`).
  // `raw` à 2 : liste propre (cf. _mjs_isClean) ou liste marquée avec ses lignes (`µraw(liste, true)`), toute ligne pure qui garde son objet est sautée.
  // un objet vu µraw le reste (rien ne retire cette marque) : sa marque est cherchée une fois, ici même, puis la ligne le note (`_mjs_br`,
  // un drapeau : l'objet n'y est pas gardé) et ne cherche plus rien tant qu'elle le montre ; un autre élément fait tomber la note
  function _mjs_updRows(keys, ens, items, isArray, ix, keysArr, raw, updateFn) {
    µ._mjs_holdPush = 1;
    for (let i = 0; i < keys.length; i++) {
      const ent = ens[i];
      if (ent._mjs_init) {
        ent._mjs_init = 0;
        continue;
      }
      const it = items[i];
      const x  = isArray ? (ix ? ix[i] : i) : keysArr[i];
      const p  = ent._mjs_p;
      if (ent._mjs_it !== it) {
        // la ligne porte désormais un autre élément (une autre valeur d'une liste rangée par la place, sans `by`, ou un autre objet, même à
        // la même clé : liste rechargée) : ses composants reçoivent toutes leurs props, même inchangées, comme ceux d'une ligne neuve ; la
        // ligne dont l'objet change sur place, ou qu'un tri déplace, garde son élément et ses composants ce qu'ils ont écrit
        _mjs_forgetProps(ent);
        ent._mjs_it = it;
        ent._mjs_br = 0;
      }
      // <fine-grained>
      else if (raw && p && (p > 1 || ent._mjs_ix === x) && (ent._mjs_br || raw === 2 || Object(it) !== it || µ._mjs_rawSet.has(it) && !it[µ._mjs_RAW] && (ent._mjs_br = 1))) {
        ent._mjs_ix = x;
        continue;
      }
      // </fine-grained>
      // <no-fine-grained>
      // // <no-raw-lines>
      // // else if (raw && p && (p > 1 || ent._mjs_ix === x) && (ent._mjs_br || Object(it) !== it || µ._mjs_rawSet.has(it) && !it[µ._mjs_RAW] && (ent._mjs_br = 1))) {
      // // </no-raw-lines>
      // // <raw-lines>
      // else if (raw && p && (p > 1 || ent._mjs_ix === x) && (ent._mjs_br || raw === 2 || Object(it) !== it || µ._mjs_rawSet.has(it) && !it[µ._mjs_RAW] && (ent._mjs_br = 1))) {
      // // </raw-lines>
      //   ent._mjs_ix = x;
      //   continue;
      // }
      // </no-fine-grained>
      ent._mjs_ix = x;
      if (ent._mjs_updFn) ent._mjs_updFn(it, x);
      else if (updateFn) updateFn(ent.__nodes, it, x);
    }
    keys._mjs_rows = ens;
  }

  // clé `by` d'une ligne qui n'est ni un texte ni un nombre (ceux-là gardent leur valeur, sans appel : `1` et `'1'` sont deux clés) : une
  // autre valeur simple garde la sienne, sauf un symbole, par son texte (le rendu serveur écrit la clé dans le HTML) ; un objet qui s'écrit
  // lui-même (date, tableau, classe à toString) par ce texte ; un objet sans texte propre (« [object Object] », qui confondait tous les
  // objets en une seule ligne) ou une fonction, par son identité. L'identifiant vit dans une WeakMap, rien n'est écrit sur l'objet ;
  // l'enveloppe réactive et l'objet brut donnent la même clé
  const _mjs_keyIds = new WeakMap();
  // compteur des clés fabriquées, unique pour toute la page (clés d'objet ci-dessous, tatouage `_mjsId` de `_mjs_mjsTag`)
  let _mjs_idGen = 0;
  function _mjs_keyOf(k) {
    if (Object(k) !== k) return typeof k === 'symbol' ? String(k) : k;
    if (typeof k === 'object') {
      const s = String(k);
      if (!s.startsWith('[object ')) return s;
    }
    k = µ._mjs_toRaw(k);
    let id = _mjs_keyIds.get(k);
    if (id === void 0) _mjs_keyIds.set(k, id = 'mjs-o' + ++_mjs_idGen);
    return id;
  }
  // <flip>
  // la même clé pour `@flip` (mjs_flip.ts), qui écarte les lignes des clés en double : un bloc retiré du cœur d'une appli sans `@flip`
  µ._mjs_keyOf = _mjs_keyOf;
  // </flip>
  // <server-resume>
  // l'identifiant que la WeakMap des clés garde pour l'objet `k`, lu sans en poser (undefined pour un objet jamais suivi par son
  // identité) : la reprise des lignes rendues par le serveur (mjs_hydrate.ts) y reconnaît une clé fabriquée à chaque page
  µ.Element.prototype._mjs_keyId = function(k) {
    return _mjs_keyIds.get(µ._mjs_toRaw(k));
  };
  // </server-resume>
  // <exit-reverse>
  // lignes qui jouent leur sortie animée, par liste (son ancre de début) puis par clé : une clé remise dans la liste avant la fin de cette
  // sortie reprend sa ligne (`_mjs_outTake`), comme Svelte ; la ligne quitte la table à la fin de sa sortie
  const _mjs_outRows = new WeakMap();
  // retrait d'une ligne d'un composant à transitions : ses nœuds sont détruits ; quand l'un joue sa sortie, la ligne reste à sa clé jusqu'à
  // la fin de la sortie, avec le relevé vivant de ses nœuds (le même geste que le retrait d'une ligne sans table, plus bas, et la table)
  function _mjs_outDrop(el, start, k, entry, wait) {
    const ns = el._mjs_liveEntryNodes(entry.nodes);
    let end  = null;
    for (let i = 0; i < ns.length; i++) {
      const p = el._mjs_destroyNodeAndChildren(ns[i], wait);
      if (ns[i]._mjs_dying && !ns[i]._mjs_dead) end = p;
    }
    // <filtered-bindings>
    if (el._mjs_filtIdxKeys) el._mjs_filtPurgeEntry(entry);
    // </filtered-bindings>
    if (end === null) return;
    let rows = _mjs_outRows.get(start);
    if (!rows) _mjs_outRows.set(start, rows = new Map());
    entry.nodes = ns;
    rows.set(k, entry);
    // fin de la sortie, ou de la reprise qui l'a arrêtée : la ligne morte quitte la table, et la table vide quitte la liste
    end.then(function() {
      if (rows.get(k) === entry && !_mjs_outWhole(entry)) rows.delete(k);
      if (rows.size === 0 && _mjs_outRows.get(start) === rows) _mjs_outRows.delete(start);
    });
  }
  // la ligne peut-elle revenir telle quelle : un de ses nœuds joue encore sa sortie et aucun autre n'est parti pour de bon (un blanc de mise
  // en page retiré revient avec elle ; un repère de bloc, un texte, une balise sans sortie, non ; une balise dont une sortie se joue hors
  // du moteur non plus, rien ne la ramènerait : cf. `µ._mjs_outLost`)
  function _mjs_outWhole(entry) {
    const ns = entry.nodes;
    let out  = false;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (n._mjs_dying && !n._mjs_dead && !µ._mjs_outLost(n)) out = true;
      else if (n.nodeType !== 3 || !/^\s+$/.test(n.data)) return false;
    }
    return out;
  }
  // clé remise dans la liste pendant la sortie de sa ligne (`rows` : la table de la liste) : la ligne revient avec ses nœuds, sa saisie et
  // ses composants, arrêtée dans sa sortie par la passe (« DYING, reviving ») et relue en entier par la passe des liaisons. Une ligne qui ne
  // peut pas revenir laisse aussitôt la place à une neuve : ce qui reste d'elle part sans attendre la fin de sa sortie
  function _mjs_outTake(rows, cache, k) {
    const entry = rows.get(k);
    if (entry === void 0) return;
    rows.delete(k);
    if (_mjs_outWhole(entry)) {
      entry._mjs_it = void 0;
      cache.set(k, entry);
      return entry;
    }
    for (const n of entry.nodes) µ._mjs_rm(n);
  }
  // </exit-reverse>

  // entrée d'une ligne neuve, toujours faite par son gabarit : les nœuds d'une ligne ne servent qu'à sa donnée, jamais à une autre (une
  // ligne retirée part au ramasse-miettes). tplFn rend {fragment, refs}, et parfois sa closure de mise à jour (`updateFn`, refs fermées)
  // que la réconciliation appelle avec (item, index) ; `_mjs_init` = 1 quand le tplFn a déjà posé l'état initial (première passe des
  // liaisons sautée)
  function _mjs_rowEntry(el, tplFn, item, index) {
    const built = tplFn(item, index);
    const refs  = built.refs || {};
    // éléments enregistrés pour le routage des événements, sauf si le tplFn l'a fait (`_mjs_reg`)
    if (!refs._mjs_reg) el._mjs_registerRefs(refs);
    // nœuds de tête relevés AVANT insertion (une fois inséré, le fragment est vide) ; une seule racine le plus souvent, et alors,
    // pour un gabarit à racine unique, l'élément cloné seul, sans fragment (cf. `µ._mjs_cloneEl`)
    const frag = built.fragment;
    const ent  = {nodes: frag.nodeType === 1 ? [frag] : frag.childNodes.length === 1 ? [frag.firstChild] : Array.from(frag.childNodes), __nodes: refs, _mjs_updFn: built.updateFn || null, _mjs_init: built._mjs_init || 0, _mjs_p: built._mjs_p, _mjs_it: item, _mjs_ix: index, _mjs_br: 0};
    // corps sans nœud (un commentaire seul) : la ligne tient un texte vide, sa place dans la liste pour les déplacements et les retraits
    if (!ent.nodes.length) ent.nodes.push(frag.appendChild(document.createTextNode('')));
    refs._mjs_ent = ent;
    return ent;
  }

  // retire une ligne quand rien ne l'attend (ni sortie animée, ni crochet de destruction : `__noHooks && !__wait`) : ses nœuds vivants sont
  // détruits pour de bon, {for} imbriqués purgés, et son index filtré avec eux
  function _mjs_dropRow(el, entry) {
    const ens = el._mjs_liveEntryNodes(entry.nodes);
    for (let i = 0; i < ens.length; i++) el._mjs_destroyNodeAndChildren(ens[i], false);
    // <filtered-bindings>
    if (el._mjs_filtIdxKeys) el._mjs_filtPurgeEntry(entry);
    // </filtered-bindings>
  }

  // clés `by` en double : seule la première occurrence de chaque clé reste, tassée sur place dans `keys` (l'écriture ne dépasse jamais la
  // lecture), avec son rang dans la collection ; avertissement une fois par composant. Rend [éléments, clés de `Map`, rangs, clés gardées]
  function _mjs_dropDupKeys(el, cacheId, keys, items, keysArr) {
    const fi = [], fk = keysArr ? [] : null, ix = [], seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const k = keys[i];
      if (seen.has(k)) continue;
      seen.add(k);
      keys[fi.length] = k;
      fi.push(items[i]);
      ix.push(i);
      if (fk) fk.push(keysArr[i]);
    }
    keys.length = fi.length;
    if (!el._mjs_dupKeyWarned) {
      el._mjs_dupKeyWarned = true;
      µ.warn(µ._mjs_msg('forDupKeys', { id: cacheId }, '{for} : clés dupliquées détectées — seules les 1ères occurrences sont rendues. Vérifiez l\'unicité de la clé `by`. (cacheId: {id})'));
    }
    return [fi, fk, ix, seen];
  }

  // `keys[a..b)` égales, position par position, à `oldKeys[a+d..b+d)`
  function _mjs_sameRun(keys, oldKeys, a, b, d) {
    for (let i = a; i < b; i++) {
      if (keys[i] !== oldKeys[i + d]) return false;
    }
    return true;
  }

  // déplace les nœuds vivants d'une ligne avant `ref`
  function _mjs_moveRow(el, parent, ent, ref) {
    for (const nd of el._mjs_liveEntryNodes(ent.nodes)) parent.insertBefore(nd, ref);
  }

  // milieux de même longueur `[p, e)` : deux lignes échangées, ou une seule ligne déplacée (les autres glissent d'un cran) — un
  // ou deux déplacements, le reste ne bouge pas, et `ens` (les entrées, dans l'ordre d'avant) passe à l'ordre neuf. Rend faux pour
  // tout autre ordre, `ens` intact
  function _mjs_forMove(el, parent, ens, keys, oldKeys, p, e) {
    const A    = ens[p];
    const B    = ens[e - 1];
    const endB = B.nodes[B.nodes.length - 1].nextSibling;
    if (keys[p] === oldKeys[e - 1]) {
      // la dernière ligne du milieu remonte en tête : échange (la première descend à sa place), ou déplacement vers le haut
      const swap = keys[e - 1] === oldKeys[p];
      if (swap ? _mjs_sameRun(keys, oldKeys, p + 1, e - 1, 0) : _mjs_sameRun(keys, oldKeys, p + 1, e, -1)) {
        _mjs_moveRow(el, parent, B, A.nodes[0]);
        if (swap && A.nodes[A.nodes.length - 1].nextSibling !== endB) _mjs_moveRow(el, parent, A, endB);
        if (swap) ens[e - 1] = A;
        else ens.copyWithin(p + 1, p, e - 1);
        ens[p] = B;
        return true;
      }
    }
    if (keys[e - 1] === oldKeys[p] && _mjs_sameRun(keys, oldKeys, p, e - 1, 1)) {
      _mjs_moveRow(el, parent, A, endB);
      ens.copyWithin(p, p + 1, e);
      ens[e - 1] = A;
      return true;
    }
    return false;
  }

  // chemins courts, sans Set, sans Map de positions ni sous-suite croissante : les clés se comparent par position à celles de la passe
  // d'avant, début et fin communs rognés. Mêmes clés : la passe des liaisons seule. En mode direct (`direct` : ni sortie animée, ni crochet
  // de destruction), un seul changement au milieu : lignes échangées ou une ligne déplacée, sinon un bloc neuf à la place d'un bloc ancien
  // (ligne supprimée, ajout en fin, insertion, tout remplacé). Les lignes gardées ne bougent pas. Rend vrai quand la liste est faite,
  // faux pour le chemin général (rien n'a été touché)
  function _mjs_forShort(el, cacheId, startNode, endNode, parentNode, cache, oldKeys, keys, items, isArray, keysArr, tplFn, updateFn, raw, direct) {
    const n   = keys.length;
    const on  = oldKeys.length;
    const min = n < on ? n : on;
    let p = 0;
    let s = 0;
    let c = cache;
    // entrées de la passe d'avant, dans l'ordre de ses clés (`_mjs_rows`, noté sur leur tableau par la passe des liaisons, ou par la reprise
    // des lignes du serveur) : lues là, jamais cherchées une à une dans le cache. Un tableau de clés qui n'en porte pas : chemin général
    let ens = oldKeys._mjs_rows;
    if (!ens) return false;
    while (p < min && keys[p] === oldKeys[p]) p++;
    while (s < min - p && keys[n - 1 - s] === oldKeys[on - 1 - s]) s++;
    // milieux : `[p, ne)` dans la liste neuve, `[p, oe)` dans l'ancienne
    const ne = n - s;
    const oe = on - s;
    if (ne > p || oe > p) {
      if (!direct) return false;
      // l'ordre neuf s'écrit dans une copie : une passe renvoyée au chemin général, ou arrêtée par une erreur, laisse aux clés d'avant leurs entrées
      const old = ens;
      ens       = old.slice();
      if (!(ne === oe && _mjs_forMove(el, parentNode, ens, keys, oldKeys, p, ne))) {
        // bloc neuf (vide pour une suppression) : ses clés, toutes absentes de la liste et distinctes, sont vérifiées avant de rien
        // construire — posées à vide dans le cache (dans un cache neuf quand tout est remplacé) et retirées si l'une renvoie au chemin général
        const all = p + s === 0;
        if (all) c = new Map();
        let j = p;
        for (; j < ne; j++) {
          const k = keys[j];
          if (cache.has(k) || all && c.has(k)) break;
          c.set(k, null);
        }
        if (j < ne) {
          if (!all) while (j > p) cache.delete(keys[--j]);
          return false;
        }
        const ref  = s ? old[oe].nodes[0] : endNode;
        // tout remplacé dans un conteneur que la liste occupe seule : retrait groupé d'abord (relevé vivant des lignes à plusieurs nœuds
        // de tête pris avant : détachés, leurs nœuds ne se retrouvent plus entre leurs bornes)
        if (all && startNode.previousSibling === null && endNode.nextSibling === null && startNode.parentNode === parentNode) {
          if (old[0].nodes.length > 1) {
            for (const eo of old) eo.nodes = el._mjs_liveEntryNodes(eo.nodes);
          }
          parentNode.textContent = '';
          parentNode.appendChild(startNode);
          parentNode.appendChild(endNode);
        }
        // lignes neuves réunies dans un fragment, pris en exclusivité jusqu'à son insertion (cf. la création fraîche : un rendu réveillé
        // pendant l'insertion en prend un autre) ; chaque clé neuve a sa ligne neuve, faite par son gabarit, avec ou sans `by`
        // (docs/05-blocs.md, « Suivi keyé »)
        const frag = µ._mjs_reusableFragment || document.createDocumentFragment();
        µ._mjs_reusableFragment = null;
        // les entrées dans l'ordre neuf : celles d'avant le bloc, le bloc neuf, puis celles d'après
        ens.length = p;
        for (let i = p; i < ne; i++) {
          const ent = _mjs_rowEntry(el, tplFn, items[i], isArray ? i : keysArr[i]);
          const ns = ent.nodes;
          c.set(keys[i], ent);
          ens[i] = ent;
          for (let k = 0; k < ns.length; k++) frag.appendChild(ns[k]);
        }
        if (s) ens = ens.concat(old.slice(oe));
        // anciennes lignes : détruites ligne à ligne
        for (let i = p; i < oe; i++) {
          _mjs_dropRow(el, old[i]);
          if (!all) cache.delete(oldKeys[i]);
        }
        // une suppression seule n'insère rien
        if (ne > p) parentNode.insertBefore(frag, ref);
        µ._mjs_reusableFragment = frag;
      }
    }
    // <transitions>
    // mêmes clés hors du mode direct : une ligne dont la sortie joue encore, ou s'est achevée, se reprend par le chemin général
    else if (!direct) {
      for (const ent of ens) {
        for (const nd of ent.nodes) {
          if (nd._mjs_dead || nd._mjs_dying) return false;
        }
      }
    }
    // </transitions>
    _mjs_updRows(keys, ens, items, isArray, null, keysArr, raw, updateFn);
    el._mjs_list_order[cacheId] = keys;
    el._mjs_list_cache[cacheId] = c;
    return true;
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
    // liste encore jamais rendue qui part vide, rien entre ses bornes : rien à réconcilier, l'état reste celui d'une liste absente
    // (`null`, même chemin plus bas). La réconciliation, grosse fonction, n'est compilée qu'à sa première ligne : le démarrage
    // d'une page dont la liste arrive plus tard ne paie ni sa compilation ni son code en mémoire
    if (Array.isArray(col) && col.length === 0 && s.nextSibling === e && !this._mjs_list_anchor?.[id]) return;
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
  // `by` gelée, lignes d'éléments gelés refaites à chaque réaffectation). Jamais d'exception. `peek` : le tatouage lu
  // seulement, rien n'est posé (un objet jamais suivi par son identité rend undefined)
  µ.Element.prototype._mjs_mjsTag = function(item, peek) {
    let key = item._mjsId || _mjs_keyIds.get(item);
    if (!key && !peek) {
      // compteur unique pour toute la page : le tatouage est posé sur l'objet, qu'un autre composant peut afficher aussi ;
      // sur l'objet brut, pas par l'enveloppe réactive : une définition par l'enveloppe est une écriture de la variable, et le
      // tatouage, posé pendant la réconciliation, n'en est pas une (ni rendu, ni valeur dérivée refaite)
      key = 'mjs-' + ++_mjs_idGen;
      const raw = µ._mjs_toRaw(item);
      if (Object.isExtensible(raw)) Object.defineProperty(raw, '_mjsId', { value: key, enumerable: false, configurable: true, writable: false });
      else _mjs_keyIds.set(item, key);
    }
    return key;
  };

  µ.Element.prototype._mjs_reconcileList = function(cacheId, startNode, endNode, childMode, col, tplFn, keyFn, updateFn, keyAttr) {
    var cache, d, dyingTail, entry, i, isArray, items, j, keysArr, l, lastItemNode, lastNode, len, len1, len2, n, newEntries, newKeySet, o, oldKey, oldKeys, parentNode;
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
      if (this._mjs_list_cache) {
        // <filtered-bindings>
        // les fonctions de ces lignes quittent l'index filtré avec elles
        this._mjs_filtPurgeCache(this._mjs_list_cache[cacheId]);
        // </filtered-bindings>
        this._mjs_list_cache[cacheId] = new Map();
      }
      if (this._mjs_list_order) this._mjs_list_order[cacheId] = [];
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
      // <filtered-bindings>
      this._mjs_filtPurgeCache(this._mjs_list_cache[cacheId]);
      // </filtered-bindings>
      this._mjs_list_cache[cacheId] = new Map();
      this._mjs_list_order[cacheId] = [];
      this._mjs_list_anchor[cacheId] = startNode;
      // <server-resume>
      // le nom de la clé `by` de la liste, le même à chaque passe : le rendu serveur le relit pour écrire ses lignes (`µ._ssrRows`, mjs_hydrate.ts)
      startNode._mjs_by = keyAttr;
      // </server-resume>
    }
    // Simplify Coffee ternaire (var ref = X) != null ? ref : default.
    cache = this._mjs_list_cache[cacheId] || new Map();
    oldKeys = this._mjs_list_order[cacheId] || [];
    // rang d'origine de chaque élément retenu quand des doublons sont écartés : l'index de la ligne reste celui de la
    // collection (sinon les lignes après le doublon recevaient un index décalé, et `splice(i, 1)` retirait un autre élément)
    let __ix = null;
    // composant sans crochet de destruction (`_mjs_noDestroyHooks` : ni transition, ni `@attach`, ni `@this=!`, ni `@flip`) : une ligne
    // retirée part tout de suite, sans parcours de son sous-arbre (chemins courts, vidage groupé)
    var __noHooks = this.constructor._mjs_noDestroyHooks === true;
    parentNode = startNode.parentNode;
    // Si le startNode a déjà été détaché (un bloc parent {if}/{key}/{await}
    // est en train d'être démonté), on ne tente PAS de réconcilier — le
    // cleanup parent va de toute façon retirer tout ce qui restait. Insérer
    // ailleurs causerait NotFoundError sur insertBefore.
    if (!parentNode) {
      return;
    }
    // <fine-grained>
    // liste µraw, ou liste propre (2, cf. _mjs_isClean) : ses lignes pures qui gardent leur objet sont sautées
    // <no-raw-lines>
    // let __raw = µ._mjs_rawSet.has(col) || _mjs_isClean(this, cacheId);
    // </no-raw-lines>
    // <raw-lines>
    // liste marquée avec ses lignes (`µraw(liste, true)`, 2 aussi) : sautées de même, sans chercher la marque d'aucune. La note est lue sur le tableau
    // parcouru : celui que donne un `Set`, une `Map` ou un objet est neuf à chaque passe, jamais noté — `true` ne vaut que pour un tableau
    let __raw = µ._mjs_rawRows.has(items) ? 2 : µ._mjs_rawSet.has(col) || _mjs_isClean(this, cacheId);
    // </raw-lines>
    // </fine-grained>
    // <no-fine-grained>
    // // <no-raw-lines>
    // // let __raw = µ._mjs_rawSet.has(col);
    // // </no-raw-lines>
    // // <raw-lines>
    // let __raw = µ._mjs_rawRows.has(items) ? 2 : µ._mjs_rawSet.has(col);
    // // </raw-lines>
    // </no-fine-grained>
    // <refresh>
    // la liste repasse dans le rendu que déclenche un `µrefresh` de ce composant (`_mjs_rfl`, posé par `_mjs_invalidate`, ôté à la fin de
    // ce rendu) : aucune ligne sautée, les lignes brutes changées sur place sont relues, une fois. Un seul test par passe
    if (this._mjs_rfl) __raw = 0;
    // </refresh>
    const __wait = childMode === 'all' || childMode === 'out' || childMode === 'transition';

    // clé de chaque élément, lue UNE fois par passe : la clé `by` ou celle de la Map, un texte ou un nombre tel quel ; sans clé (ou clé nulle),
    // un objet se suit par son identité (`_mjs_mjsTag` : tatouage non énumérable, repli silencieux sur un objet non extensible ; le
    // rang d'apparition sépare les occurrences d'un même objet, la 1re garde sa clé) et une valeur simple par sa position. Elle se
    // compare d'abord PAR POSITION aux clés de la passe d'avant (chemins courts) : le Set qui cherche les doublons n'est construit
    // que pour le chemin général. Une liste sous son enveloppe donne chaque élément par une lecture de l'enveloppe : faite une fois, ici,
    // et gardée dans un tableau que le reste de la passe relit (la longueur se lit sur la liste brute, sans enveloppe, à chaque tour). Un
    // élément que la lecture des clés a remplacé (accesseur, clé calculée qui écrit la liste) se relit par l'enveloppe, comme avant
    // <wrapper>
    const __src  = isArray && items === col ? col[µ._mjs_RAW] : void 0;
    const __vals = __src ? [] : null;
    const __was  = __src ? [] : null;
    // </wrapper>
    const keys = new Array(items.length);
    let __occ = null;
    // <wrapper>
    for (let __i = 0; __i < (__src || items).length; __i++) {
      const __it = items[__i];
      if (__vals) {
        __vals[__i] = __it;
        __was[__i]  = __src[__i];
      }
    // </wrapper>
    // <no-wrapper>
    // for (let __i = 0; __i < items.length; __i++) {
    //   const __it = items[__i];
    // </no-wrapper>
      let __k = keyAttr ? (__it != null ? __it[keyAttr] : null) : keyFn ? keyFn(__it, isArray ? __i : keysArr[__i]) : __mapK ? __mapK[__i] : null;
      if (__k == null) {
        if (__it !== null && typeof __it === 'object') {
          __k = this._mjs_mjsTag(__it);
          const __nth = (__occ ||= new Map()).get(__k) | 0;
          __occ.set(__k, __nth + 1);
          if (__nth) __k += '#' + __nth;
        }
        else __k = 'idx-' + (isArray ? __i : keysArr[__i]);
      }
      else if (typeof __k !== 'string' && typeof __k !== 'number') __k = _mjs_keyOf(__k);
      keys[__i] = __k;
    }
    // <wrapper>
    if (__vals) {
      for (let __i = 0; __i < __vals.length; __i++) if (__src[__i] !== __was[__i]) __vals[__i] = items[__i];
      items = __vals;
    }
    // </wrapper>

    // <server-resume>
    // premier rendu d'une liste dont le serveur a écrit les lignes (hydratation par repères, mjs_hydrate.ts) : ses lignes sont reprises,
    // nœuds compris, et deviennent la passe d'avant de cette réconciliation, qui refait seulement celles qui ne correspondaient pas
    if (startNode._mjs_srv && cache.size === 0) oldKeys = this._mjs_adoptRows(startNode, endNode, cache, keys, items, isArray, keysArr, tplFn, keyAttr, updateFn);
    // </server-resume>
    // <development>
    // développement : la même clé vue en nombre et en texte par cette liste, dans ce rendu ou d'un rendu au suivant, est dite (mjs_debug.ts)
    µ._mjs_devKeys?.(this, cacheId, keys, oldKeys);
    // </development>
    // <fine-grained>
    // <development>
    // développement : une ligne qu'une passe propre va sauter et dont l'objet a changé hors de MJS est dite (mjs_debug.ts) ; une liste marquée avec
    // ses lignes (`µraw(liste, true)`) n'est pas une liste propre : comme celles d'une liste µraw, ses lignes écrites sur place ne sont pas dites
    µ._mjs_devClean?.(this, cacheId, µ._mjs_rawRows?.has(col) || __raw, cache, keys, items, isArray, keysArr, !!(keyAttr || keyFn || __mapK));
    // </development>
    // </fine-grained>
    // Fast path "fresh creation". Si le cache est vide, tous les
    // `cache.get(key)` retournent undefined → on peut skip toute la logique
    // hasDead/hasDying. Sur create 1k items, gain ~3-5ms (1000 × Map.get +
    // 1000 × .some() évités).
    const isFreshCreate = cache.size === 0;

    // chemins courts (cf. `_mjs_forShort`) : mêmes clés dans tous les modes, un changement de structure en mode direct seulement
    // (aucune sortie animée, aucune ligne mourante)
    if (!isFreshCreate && keys.length > 0 && oldKeys.length > 0 && cache.size === oldKeys.length && _mjs_forShort(this, cacheId, startNode, endNode, parentNode, cache, oldKeys, keys, items, isArray, keysArr, tplFn, updateFn, __raw, __noHooks && !__wait)) return;

    // #2 — Dé-doublonnage défensif des clés AVANT la reconcile. Deux items de
    // même clé (`by id` avec ids dupliqués) font planter la phase d'insertion
    // (`insertBefore` sur un nœud déjà déplacé : "Failed to execute
    // 'insertBefore' on 'Node'"). On ne garde que la 1ère occurrence de chaque
    // clé + un warn une fois — parité Svelte/React — au lieu de crasher (`_mjs_dropDupKeys`). Le Set des
    // clés gardées sert ensuite de `newKeySet`. Une liste sans clé n'a pas de doublon :
    // ses clés d'identité et de position sont uniques par construction. À la création complète (cache
    // vide), aucun Set : les doublons se voient en remplissant le cache, dans la boucle des lignes
    const __byKey = !!(keyAttr || keyFn || __mapK);
    let __seen = null;
    if (__byKey && !isFreshCreate) {
      __seen = new Set();
      let __hasDup = false;
      for (const __k of keys) {
        if (__seen.has(__k)) { __hasDup = true; break; }
        __seen.add(__k);
      }
      if (__hasDup) {
        [items, keysArr, __ix, __seen] = _mjs_dropDupKeys(this, cacheId, keys, items, keysArr);
      }
    }
    // l'entrée de chaque ligne, dans l'ordre neuf ; son élément et son index se relisent dans `items`
    newEntries = new Array(items.length);

    // Track les indices de newEntries qui correspondent à des entries DEAD
    // invalidées (cache.delete + nouvelle entry fresh sans insertion DOM).
    // Sans ça, le fast path `allStays` skip l'insertion alors que les fresh
    // nodes ne sont jamais attachés au DOM (cas vécu : recoche d'un `{if}`
    // qui contient un `{for}` dont les items étaient en outro complète).
    const __invalidatedIdx = new Set();
    // <exit-reverse>
    // lignes de cette liste qui jouent leur sortie (cf. `_mjs_outTake`) : une table seulement quand l'une d'elles en joue une
    const __out = __noHooks ? void 0 : _mjs_outRows.get(startNode);
    // </exit-reverse>
    // for classique au lieu de items.forEach((item, loopIndex) => {...}).
    // Évite l'allocation d'une closure-arrow par appel à _mjs_reconcileList et
    // facilite l'inlining V8 sur le hot loop create/update 1000 items.
    // Hoist let scope au lieu de var redéclaré (hidden classes V8 stables).
    let __itemsLen = items.length;
    for (let __loopIdx = 0; __loopIdx < __itemsLen; __loopIdx++) {
      // création complète d'une liste à clé : une clé déjà posée dans le cache, vide au départ, est un doublon. La collection est tassée
      // une fois (cf. `_mjs_dropDupKeys`) : les places déjà faites, toutes de premières occurrences, ne bougent pas, la boucle reprend ici
      if (__byKey && isFreshCreate && cache.has(keys[__loopIdx])) {
        [items, keysArr, __ix] = _mjs_dropDupKeys(this, cacheId, keys, items, keysArr);
        newEntries.length = __itemsLen = items.length;
        if (__loopIdx >= __itemsLen) break;
      }
      const item = items[__loopIdx];
      const index = isArray ? (__ix !== null ? __ix[__loopIdx] : __loopIdx) : keysArr[__loopIdx];
      // clé lue et convertie par la pré-passe ci-dessus
      const key = keys[__loopIdx];
      let entry = isFreshCreate ? void 0 : cache.get(key);
      // <transitions>
      // <exit-reverse>
      // clé remise pendant la sortie de sa ligne : la même ligne revient (cf. `_mjs_outTake`)
      if (entry === void 0 && __out !== void 0) entry = _mjs_outTake(__out, cache, key);
      // </exit-reverse>
      // Composant sans destroy hooks (`__noHooks`) : aucune entry du cache ne peut être
      // _mjs_dying/_mjs_dead (aucune sortie ne fait attendre une ligne, et une ligne
      // détruite quitte le cache dans le même geste, cf. `_mjs_dropRow`).
      // Skip le scan `.some()` ~25× plus rapide qu'un cache hit.
      let hasDead = false;
      let hasDying = false;
      if (!__noHooks && entry && entry.nodes) {
        // Le tplFn produit du HTML avec des espaces/newlines autour du `<div>`,
        // donc `entry.nodes` peut contenir [textNode, divNode, textNode].
        // On scanne TOUS les nodes pour trouver l'état effectif (un text node
        // n'aura jamais de _mjs_dying/_mjs_dead).
        const __ens = entry.nodes;
        for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
          const __entNode = __ens[__ei];
          if (__entNode._mjs_dead) hasDead = true;
          if (__entNode._mjs_dying) hasDying = true;
          if (hasDead && hasDying) break;
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
        // <filtered-bindings>
        this._mjs_filtPurgeEntry(entry);
        // </filtered-bindings>
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
          // `@flip` (`µ._mjs_fixPosition`, mjs_easing.ts) reste épinglé en
          // `position:absolute` + largeur/hauteur/position FIGÉES tant que
          // personne ne le retire. Sans ce nettoyage, une row ressuscitée ICI
          // (clé réapparue pendant son outro) rejouait son intro correctement
          // mais restait visuellement détachée du flux normal — un
          // `position:absolute` orphelin ne se corrige jamais tout seul.
          if (typeof µ._mjs_unfixPosition === 'function') {
            µ._mjs_unfixPosition(__dn);
          }
          if (__dn._mjs_intro) {
            // <exit-reverse>
            // l'entrée qui reprend la ligne s'annonce (`@introstart`, puis `@introend` à sa fin), comme celle d'un `{if}`
            try {
              if (typeof __dn._mjs_cb_introstart === 'function') __dn._mjs_cb_introstart();
            } catch { /* rappel de l'appli */ }
            // </exit-reverse>
            (function(n) {
              return µ._mjs_whenLayouted(n, function() {
                return µ._mjs_playTransition(n, n._mjs_intro, 'in').then(function() {
                  if (n._mjs_dying || n._mjs_dead) {
                    return;
                  }
                  try {
                    return typeof n._mjs_cb_introend === "function" ? n._mjs_cb_introend() : void 0;
                  } catch {
                    return null;
                  }
                }).catch(function(err) {
                  return µ.warn("[ModularJS] Recyclage re-intro failed:", err);
                });
              });
            })(__dn);
          }
          // <exit-reverse>
          // sans entrée écrite, la sortie en cours revient sur ses pas, depuis là où elle en est, et celles de ses balises intérieures
          // reviennent avec elle (cf. `µ._mjs_txBack`)
          µ._mjs_txBack(__dn, !__dn._mjs_intro);
          // </exit-reverse>
        }
      } else
      // </transitions>
      if (entry) {
        if (µ.debug) {
          µ.log(`[mjs-tx] reconcile ${cacheId} key=${key} → cache hit (alive)`);
        }
      } else {
        if (µ.debug) {
          µ.log(`[mjs-tx] reconcile ${cacheId} key=${key} → fresh node`);
        }
      }
      if (!entry) {
        // ligne neuve, faite par son gabarit
        entry = _mjs_rowEntry(this, tplFn, item, index);
        cache.set(key, entry);
      }
      newEntries[__loopIdx] = entry;
    }
    // Skip newKeySet alloc si oldKeys.length === 0 (fresh create) :
    // pas besoin de tester si chaque oldKey est encore dans la liste.
    // #2/perf — réutilise le Set du dé-doublonnage (les clés gardées).
    newKeySet = oldKeys.length > 0 ? __seen || new Set(keys) : null;
    // Boucle for classique au lieu de forEach (évite alloc closure
    // par entry destroyed). Sur clear 1k items, gain ~1-2ms.

    // Bulk clear inspired par Solid `cleanChildren` (parent.textContent = "").
    // Condition stricte : full clear (newLen === 0), pas de hooks destroy, pas
    // de cascade outro. On utilise Range.deleteContents() qui efface tous les
    // nodes entre startNode et endNode en UNE seule opération native (1 reflow,
    // pas N × removeChild). Gain mesuré sur clear1k_x8 (de 145ms ~vers ~100ms).
    //
    // NB: On ne touche pas aux markers startNode/endNode (ils sont préservés
    // car le Range a startNode.nextSibling pour début et endNode pour fin).
    // Les lignes partent avec le cache, sans être touchées une à une.
    if (__noHooks && !__wait && items.length === 0 && oldKeys.length > 0 && parentNode.firstChild) {
      // Anti-leak : si la classe a des filtered indexes
      // (`_mjs_filt[<clé>].idx`), purger les entrées correspondantes pour les rows clear.
      // Sinon la Map garde des fns qui capturent les nodes → fuite mémoire
      // (typique des benchs cycliques create/clear×N et des feeds infinis).
      // <filtered-bindings>
      var __fk = this._mjs_filtIdxKeys;
      var __filtB = this._mjs_filt;
      // Optim #E — Bulk clear des filter Maps en UNE opération native.
      // Si toutes les entries d'une Map correspondent aux rows clear (cas
      // monoFor), `__idx.clear()` est O(1) au lieu de N×delete (O(N) overhead).
      // On vérifie size === oldKeys.length pour rester safe quand plusieurs
      // {for} partagent le même filtered attribute.
      if (__fk) {
        var __slow = false;
        for (const __idxName of __fk) {
          var __feB = __filtB && __filtB[__idxName];
          var __idxBulk = __feB && __feB.idx;
          if (__idxBulk && __idxBulk.size === oldKeys.length && !__feB.multi) __idxBulk.clear();
          else if (__idxBulk) __slow = true;
        }
        // une liaison dont l'index porte d'autres lignes que celles-ci : ligne par ligne (multi-{for} ou plusieurs lignes par valeur)
        if (__slow) for (j = 0, len = oldKeys.length; j < len; j++) this._mjs_filtPurgeEntry(cache.get(oldKeys[j]));
      }
      // </filtered-bindings>
      // les lignes partent au ramasse-miettes avec le cache : cache.clear() O(1) au lieu de N×delete
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
      // Reset cache state (sera ré-écrit en bas de la fn).
      this._mjs_list_order[cacheId] = keys;
      this._mjs_list_cache[cacheId] = cache;
      return;
    }

    // Anti-leak : hoist le Set _mjs_filtIdxKeys hors de la boucle.
    // Si la classe n'utilise aucun filtered dispatch, le check est `null` →
    // l'overhead se limite à 1 lecture de prop par _mjs_reconcileList.
    // <filtered-bindings>
    var __fkSet = this._mjs_filtIdxKeys;
    // </filtered-bindings>
    // le « tout remplacé » d'une liste en mode direct (retrait groupé) est un chemin court, cf. `_mjs_forShort`
    for (j = 0, len = oldKeys.length; j < len; j++) {
      oldKey = oldKeys[j];
      if (!newKeySet.has(oldKey)) {
        entry = cache.get(oldKey);
        // <exit-reverse>
        // composant à transitions : une ligne qui joue sa sortie reste à sa clé jusqu'à la fin de la sortie (cf. `_mjs_outDrop`)
        if (!__noHooks) {
          _mjs_outDrop(this, startNode, oldKey, entry, __wait);
          cache.delete(oldKey);
          continue;
        }
        // </exit-reverse>
        // mode direct (ni sortie à jouer, ni crochet de destruction) : détruite tout de suite, cf. `_mjs_dropRow`
        if (__noHooks && !__wait) _mjs_dropRow(this, entry);
        else {
          const __ens = this._mjs_liveEntryNodes(entry.nodes);
          for (let __ei = 0, __eln = __ens.length; __ei < __eln; __ei++) {
            this._mjs_destroyNodeAndChildren(__ens[__ei], __wait);
          }
          // Anti-leak : purger les filtered indexes (cf. note plus haut) — sinon
          // une entrée fantôme reste dans `_mjs_filt[X].idx`, liée à l'ANCIEN node.
          // <filtered-bindings>
          if (__fkSet) this._mjs_filtPurgeEntry(entry);
          // </filtered-bindings>
        }
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
    // `__noHooks` (`_mjs_noDestroyHooks`) ⇒ pas de transitions ⇒ aucun dying.
    dyingTail = [];
    // Avec flip : insérer les vivants avant le 1er dying évacué. Sinon (in-flow) :
    // relativement à endNode (le skip `_mjs_dying` backward gère les dying inline).
    lastNode = endNode;
    // <transitions>
    var __hasFlip = this.constructor._mjs_hasFlip === true;
    if (!__noHooks) {
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
    if (__hasFlip && dyingTail.length > 0) lastNode = dyingTail[0];
    // </transitions>

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
      for (let __ni = 0; __ni < newEntries.length; __ni++) {
        const __ns = newEntries[__ni].nodes;
        for (let __k = 0; __k < __ns.length; __k++) __freshFrag.appendChild(__ns[__k]);
      }
      parentNode.insertBefore(__freshFrag, endNode);
      µ._mjs_reusableFragment = __freshFrag;
      // Appel des updateFn APRÈS insertion (cohérent avec sémantique). Une entry
      // fraîche dont le tplFn a déjà posé l'état (_mjs_init=1) saute ce passage
      // (et repasse en update normal aux tours suivants)
      _mjs_updRows(keys, newEntries, items, isArray, __ix, keysArr, __raw, updateFn);
      this._mjs_list_order[cacheId] = keys;
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
    let allStays = __invalidatedIdx.size === 0 && keys.length === oldKeys.length;
    if (allStays) {
      for (let __ki = 0; __ki < keys.length; __ki++) {
        if (keys[__ki] !== oldKeys[__ki]) { allStays = false; break; }
      }
    }
    // Fast path allStays terminal : on bypass complètement la boucle
    // backward fragment-build (inutile car aucun DOM move) et on applique juste
    // updateFn forward sur les entries. Économise ~N iterations + checks.
    // Mesure : sur update10thRow × 1000 rows, ~2-5ms.
    if (allStays) {
      _mjs_updRows(keys, newEntries, items, isArray, __ix, keysArr, __raw, updateFn);
      this._mjs_list_order[cacheId] = keys;
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
      const pos = oldKeyToIdx.get(keys[__mi]);
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
    for (i = newEntries.length - 1; i >= 0; i--) {
      entry = newEntries[i];
      // µ-opt — hoist les nodes de l'entrée (relus 4× : last, first×2, ref3) + `nodes[0]`.
      // `_mjs_liveEntryNodes` et pas `entry.nodes` : une entrée dont un `{if}` racine a
      // basculé porte, dans le DOM, des nœuds absents de l'instantané. Les oublier
      // ici ne fuit pas — ça DÉPLACE la ligne en laissant son `{if}` derrière elle.
      const __entNodes = this._mjs_liveEntryNodes(entry.nodes);
      const __n0 = __entNodes[0];
      lastItemNode = __entNodes[__entNodes.length - 1];
      const stays = oldPosArr[i] !== -1 && lisSet.has(i);
      // Saute les nœuds en outro (dying) restés inline : ils ne comptent pas pour
      // juger si un vivant est « déjà à la bonne place ». Sans ce skip, un dying
      // entre deux vivants ferait échouer le test → insertBefore inutile + ordre
      // faux (l'ancienne raison de la dying-tail).
      var __nsLiving = lastItemNode.nextSibling;
      // <transitions>
      while (__nsLiving && __nsLiving._mjs_dying) { __nsLiving = __nsLiving.nextSibling; }
      // </transitions>
      if (stays || __nsLiving === lastNode) {
        if (__fragHasChild) {
          parentNode.insertBefore(__frag, __domAnchor);
          __fragHasChild = false;
        }
        __domAnchor = __n0;
      } else {
        var __firstChildBefore = __frag.firstChild;
        for (o = 0, len2 = __entNodes.length; o < len2; o++) {
          __frag.insertBefore(__entNodes[o], __firstChildBefore);
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
    _mjs_updRows(keys, newEntries, items, isArray, __ix, keysArr, __raw, updateFn);
    this._mjs_list_order[cacheId] = keys;
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
  // <retained-wakes>
  // Réveils retenus pendant une réconciliation. Une ligne qui porte une directive qui lit sa balise dans le document (`@transition`, `@in`/`@out`,
  // `@attach`, `@this=!`, un effet, `@flip`) n'est peuplée qu'une fois insérée : ses composants, connectés par l'insertion, se réveilleraient
  // avant que la passe des liaisons ne leur pose leurs props et leur liaison à deux sens. Le gabarit d'une telle ligne marque ses composants
  // encore hors du document (`µ._mjs_waitRow`) ; connectés pendant une réconciliation, ils attendent la fin de la plus extérieure. Ce que le
  // parent leur pose entre-temps rejoint le registre des props retenues (`µ._mjs_pending`, relu à la connexion), puis ils se connectent dans
  // l'ordre de leur arrivée, avant le départ des écritures liées retenues : ce qu'ils écrivent à leur réveil remonte vers leur ligne. L'attente
  // se lit sur leur marque (`_mjs_rw`), par le `_set` du prototype : rien n'est posé puis effacé sur l'élément (une propriété effacée le ferait
  // passer en dictionnaire pour V8, et chaque lecture de son état en paierait le prix toute sa vie)
  µ._mjs_waitRow = function(refs) {
    for (const r in refs) {
      const x = refs[r];
      if (x && x.nodeType === 1 && !x.isConnected && x.localName.startsWith('mjs-')) x._mjs_rw = 1;
    }
  };
  const rowHeld = function(k, v) {
    if (!µ._mjs_safeKey(k)) return;
    let m = µ._mjs_pending.get(this);
    if (!m) µ._mjs_pending.set(this, m = Object.create(null));
    m[k] = v;
  };
  const rowConnect    = µ.Element.prototype.connectedCallback;
  const rowDisconnect = µ.Element.prototype.disconnectedCallback;
  const rowSet        = µ.Element.prototype._set;
  // <precision>
  µ.Element.prototype._set = function(k, v, code) {
    return this._mjs_rw === 2 ? rowHeld.call(this, k, v) : rowSet.call(this, k, v, code);
  // </precision>
  // <clock>
  // µ.Element.prototype._set = function(k, v) {
    // return this._mjs_rw === 2 ? rowHeld.call(this, k, v) : rowSet.call(this, k, v);
  // </clock>
  };
  µ.Element.prototype.connectedCallback = function() {
    const w = this._mjs_rw;
    // déjà en attente
    if (w === 2) return;
    if (w) {
      this._mjs_rw = 0;
      if (µ._mjs_hold) {
        this._mjs_rw = 2;
        (µ._mjs_rowQ ||= []).push(this);
        return;
      }
    }
    return rowConnect.apply(this, arguments);
  };
  // jamais connecté : rien à défaire
  µ.Element.prototype.disconnectedCallback = function() {
    if (this._mjs_rw !== 2) return rowDisconnect.apply(this, arguments);
  };
  // un réveil peut en retenir d'autres (réconciliation dans la réconciliation) : la file est relue jusqu'à ce qu'elle reste vide. Rend vrai si
  // l'un d'eux a écrit sa liaison à son réveil (son écriture attend dans le registre des écritures liées retenues)
  const rowGo = function() {
    let q, w = false;
    while ((q = µ._mjs_rowQ)) {
      µ._mjs_rowQ = null;
      for (const x of q) {
        x._mjs_rw = 0;
        // une connexion qui lève ne retient ni les suivantes ni la fin de la réconciliation : son erreur part comme celle d'une connexion
        // faite par le navigateur, signalée sans interrompre l'appelant
        try {
          if (x.isConnected) x.connectedCallback();
        }
        catch (e) {
          queueMicrotask(() => { throw e; });
        }
        if (µ._mjs_held && µ._mjs_held.has(x)) w = true;
      }
    }
    return w;
  };
  // </retained-wakes>
  const baseReconcile = µ.Element.prototype._mjs_reconcileList;
  µ.Element.prototype._mjs_reconcileList = function() {
    const push = µ._mjs_holdPush;
    µ._mjs_hold++;
    µ._mjs_holdPush = 0;
    try {
      return baseReconcile.apply(this, arguments);
    } finally {
      µ._mjs_holdPush = push;
      // <retained-wakes>
      const woke = µ._mjs_hold === 1 && µ._mjs_rowQ && rowGo();
      // </retained-wakes>
      if (--µ._mjs_hold === 0) {
        const held = µ._mjs_held;
        µ._mjs_held = null;
        if (held) {
          held.forEach((keys, el) => {
            if (!el._mjs_is_mounted) return;
            keys.forEach((rec, k) => {
              const cur = el._state[k];
              if (rec && cur !== rec.value && cur === rec.before) el._set(k, rec.value);
              else el._mjs_emitBind(k);
            });
          });
          // ces écritures partent pendant la passe de structure du parent, après le rendu de la liste : un nom de bloc qu'elles écrivent
          // (`_mjs_pending_struct_dirty`) est effacé à la fin de la passe et ne rejouerait plus la liste à la suivante — une ligne ajoutée ou
          // déplacée garderait le texte d'avant l'écriture de son enfant. La passe est donc rejouée tout de suite (`_mjs_safeRenderStruct`)
          this._mjs_renderStructDirty ||= this._mjs_pending_struct_dirty;
        }
        // <retained-wakes>
        // ce qu'un composant réveillé ici a écrit dans sa ligne vient de partir, pendant la passe de structure de son parent et après le rendu
        // de la liste : le nom écrit, effacé à la fin de la passe, ne rejouerait plus la liste à la suivante. La passe est donc rejouée tout de
        // suite (`_mjs_safeRenderStruct`), et chaque ligne affiche ce que sa donnée vaut
        if (woke) this._mjs_renderStructDirty = true;
        // </retained-wakes>
      }
    }
  };
}
