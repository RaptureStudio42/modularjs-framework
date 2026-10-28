// mjs_hydrate — hydratation SSR par ADOPTION du DOM rendu par le serveur, dans ses trois
// approches : 'a' marqueurs, 'b' walk positionnel, 'c' diff léger. Patch de
// `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même technique que mjs_html.ts : ajouté
// APRÈS la classe, DOIT rester après mjs_element.ts dans la concaténation).
//
// JOINT PAR CONFIGURATION (bundler/index.ts, `wantsHydrate`), jamais par scan de code : le bloc
// `render` déclare le mode de chaque page, et seuls `ssr:markers`/`ssr:positional`/`ssr:diff`
// hydratent. `csr` et `prerender` ne rendent rien à adopter ; `ssr`/`ssr:replace` (défaut) jette
// la photo serveur et reconstruit la vue — aucun des trois n'appelle ces méthodes. Un serveur qui
// rend par l'API sans bloc `render` demande le module par `runtime: ['hydrate']`.
//
// Le cœur garde l'amorce (constructeur : `µ._mjs_ssrHydrate` + `_mjs_ssrAdopt`, qui décident de
// CONSERVER la photo serveur) et l'aiguillage de `_mjs_mount`, gardé par l'existence de la
// méthode : sans ce fichier, une page qui demande quand même l'hydratation est avertie une fois,
// puis rendue par « rendre puis remplacer » — même vue, sans adoption.
if (µ.Element) {
  // Hydratation par adoption : dispatche vers l'approche choisie (µ._mjs_ssrHydrate).
  // 'a' = marqueurs, 'b' = walk positionnel, 'c' = diff. Défaut : 'a'.
  µ.Element.prototype._mjs_hydrate = function(factory) {
    var mode = µ._mjs_ssrHydrate;
    if (mode === 'b') {
      return this._mjs_hydrateB(factory);
    }
    if (mode === 'c') {
      return this._mjs_hydrateC(factory);
    }
    return this._mjs_hydrateA(factory);
  };

  // le champ caché qu'un module du cœur écrit dans sa propre balise (<input type="hidden"> posé après le contenu de la page)
  // n'est pas dans la vue de la page : ni nœud en trop à retirer, ni nœud à réaligner ; le module le reprend par son nom,
  // qu'il se soit synchronisé avant ou après la reprise de la page
  µ.Element.prototype._mjs_coreField = function(parent, node) {
    return node.nodeType === 1 && node.tagName === 'INPUT' && node.type === 'hidden' && !!parent.localName && parent.localName.indexOf('mjs-core-') === 0;
  };

  // une feuille de style écrite par le serveur en tête d'une racine d'ombre : `<style>` en ligne, ou `<link rel="stylesheet">` vers
  // le fichier partagé (`mjs_ssr_style_…`) quand le répéter en ligne coûterait trop cher. La vue du client n'en porte pas (ses feuilles
  // sont adoptées) : ni nœud à réaligner, ni nœud en trop à retirer
  var srvSheet = function(n) {
    return n.nodeType === 1 && (n.tagName === 'STYLE' || (n.tagName === 'LINK' && (n.getAttribute('href') || '').indexOf('mjs_ssr_style_') !== -1));
  };

  // la ref d'une ancre de bloc ({for}, {if}, {key}, {await}) : `s-<id>` et `e-<id>`, deux nœuds texte vides que le HTML du serveur n'écrit pas. Sans marqueurs, rien ne dit où commence et où finit ce que le serveur a rendu du bloc :
  // l'aligner sur la vue neuve l'attribue au nœud d'à côté (un `<p>` du bloc tenu pour le `<p>` suivant, qui disparaît ; un texte coupé à la mauvaise longueur). Le positionnel et le diff laissent donc ces composants à « rendre puis remplacer »
  var blockAnchor = function(key) {
    return key.charCodeAt(0) === 115 && key.charCodeAt(1) === 45; // 's-'
  };

  // Repères des LIGNES d'une liste, écrits par le serveur en `markers` (`µ._ssrRows`) et relevés par le client (`_mjs_adoptRows`), à part de
  // ceux de la racine (`mjs-h`, `mjs-e`) que l'étape 1 ramasse dans toute la racine d'ombre : `<!--mjs-l:<clé>-->` devant la tête de chaque
  // ligne (clé passée par `encodeURIComponent`, jamais `-->` dans un commentaire ; `#` pour une clé d'identité), `mjs-r="<réf> …"` sur un élément repris,
  // `<!--mjs-r:<réf> …-->` devant un texte repris, `<!--mjs-q:<réf> …-->` à la place d'un texte vide (l'ancre d'un bloc imbriqué)
  var rowHead = function(n, to) {
    return !!n && n !== to && n.nodeType === 8 && n.data.slice(0, 6) === 'mjs-l:';
  };
  var refsOn = function(refs, keys, node) {
    var ks = keys.split(' ');
    for (var i = 0; i < ks.length; i++) refs[ks[i]] = node;
  };
  // l'ancre de fin d'un bloc imbriqué (repère `mjs-q:e-<id>`) parmi les frères qui suivent `n`, avant `stop` ; null si le parseur l'a déplacée
  var blockEnd = function(n, d, stop) {
    var fin = 'mjs-q:e-' + d.slice(8).split(' ')[0];
    for (var x = n.nextSibling; x && x !== stop; x = x.nextSibling) {
      if (x.nodeType === 8 && x.data.split(' ')[0] === fin) return x;
    }
    return null;
  };

  // relève les repères de `n` à `stop` exclu (frères, puis leurs descendants) dans `refs` et les retire ; `out` reçoit les nœuds de tête de
  // la ligne. Un bloc imbriqué court de son ancre de tête à son ancre de fin : gardé quand c'est une liste dont le serveur a écrit les lignes
  // (reprises à son premier rendu), vidé sinon (son premier rendu le refait). Rend faux quand un repère n'est plus à sa place
  var rowMarks = function(n, stop, refs, out) {
    while (n && n !== stop) {
      var d = n.nodeType === 8 ? n.data : '';
      var q = d.slice(0, 6) === 'mjs-q:';
      if (n.nodeType === 1) {
        var a = n.getAttribute('mjs-r');
        if (a !== null) {
          n.removeAttribute('mjs-r');
          refsOn(refs, a, n);
        }
        if (n.firstChild && !rowMarks(n.firstChild, null, refs, null)) return false;
      }
      else if (q || d.slice(0, 6) === 'mjs-r:') {
        var c = n;
        // un texte repris suit son repère (sinon le parseur l'a sorti de là) ; un texte vide, que le HTML n'écrit pas, naît à la place du sien
        n = q ? µ._tm(c) : c.nextSibling;
        if (!q) {
          if (!n || n.nodeType !== 3) return false;
          c.parentNode.removeChild(c);
        }
        refsOn(refs, d.slice(6), n);
        if (q && d.charCodeAt(6) === 115 && d.charCodeAt(7) === 45) { // 's-'
          var fin = blockEnd(n, d, stop);
          if (!fin) return false;
          var keep = rowHead(n.nextSibling, fin);
          if (keep) n._mjs_srv = 1;
          if (out) out.push(n);
          while (n.nextSibling !== fin) {
            if (keep) {
              n = n.nextSibling;
              if (out) out.push(n);
            }
            else n.parentNode.removeChild(n.nextSibling);
          }
          // l'ancre de fin, relevée au tour suivant
          n = fin;
          continue;
        }
      }
      if (out) out.push(n);
      n = n.nextSibling;
    }
    return true;
  };

  // une clé d'identité se fabrique à chaque page : celle du serveur n'est jamais celle du navigateur, la ligne se reprend alors par son
  // rang. C'est le tatouage de l'élément de la ligne (`_mjs_mjsTag` : liste sans `by`, clé `by` vide ; rang d'occurrence `#<n>` compris),
  // ou l'identifiant d'une clé objet sans texte propre (`_mjs_keyOf`, mjs_for.ts : clé `by` objet, gelé ou non, ou fonction ; clé objet
  // d'une Map sans `by`, premier élément de la paire). Reconnue sur l'objet lui-même (lu sans rien poser), jamais sur sa forme : une clé
  // écrite par l'auteur (texte, nombre, objet qui s'écrit lui-même comme une date ; `by` ou clé d'une Map), même `mjs-1`, se compare
  // telle quelle. Le serveur l'écrit `#`, qu'aucune clé encodée ne donne. `by` : le nom de la clé `by` de la liste
  var identKey = function(el, it, k, by) {
    var v = by && it != null ? it[by] : null;
    if (v != null) return Object(v) === v && el._mjs_keyId(v) === k;
    var t = it !== null && typeof it === 'object' ? el._mjs_mjsTag(it, 1) : void 0;
    return !!t && (k === t || k.slice(0, t.length + 1) === t + '#') || !by && Array.isArray(it) && Object(it[0]) === it[0] && el._mjs_keyId(it[0]) === k;
  };

  // Premier rendu d'une liste dont le serveur a écrit les lignes (ancre `_mjs_srv`, posée à la reprise) : chaque ligne est REPRISE — ses
  // nœuds gardés (focus, saisie, défilement), ses repères relevés puis retirés, son gabarit appelé sur ces nœuds (`tplFn(élément, index,
  // réfs)`) au lieu d'en fabriquer de neufs — quand sa clé est celle de l'élément de même rang, une fois les doublons écartés comme le fait
  // la réconciliation (la première occurrence d'une clé reste, avec son rang dans la collection). Une ligne qui ne correspond pas (autre
  // clé, repère déplacé par le parseur, gabarit qui échoue) part, la réconciliation qui suit la refait avec les éléments restés sans ligne.
  // Rend les clés reprises, dans l'ordre : la passe d'avant de la réconciliation ; `by` : le nom de la clé `by` de la liste
  µ.Element.prototype._mjs_adoptRows = function(start, end, cache, keys, items, isArray, keysArr, tplFn, by) {
    start._mjs_srv = 0;
    var parent = start.parentNode;
    var heads  = [];
    var done   = [];
    var seen   = new Set();
    var last   = start;
    var j      = 0;
    // têtes de ligne ; un bloc imbriqué posé en tête d'une ligne est sauté d'un tenant (ses propres lignes ne sont pas celles-ci)
    for (var n = start.nextSibling; n && n !== end; n = n.nextSibling) {
      if (rowHead(n, end)) heads.push(n);
      else if (n.nodeType === 8 && n.data.slice(0, 8) === 'mjs-q:s-') n = blockEnd(n, n.data, end) || n;
    }
    for (var i = 0; i < heads.length; i++) {
      var h    = heads[i];
      var stop = heads[i + 1] || end;
      var key  = h.data.slice(6);
      // l'élément de même rang, doublons écartés : `at`, son rang dans la collection
      while (j < keys.length && seen.has(keys[j])) j++;
      var at = j++;
      var k  = at < keys.length ? keys[at] : null;
      var it = k !== null ? items[at] : void 0;
      var en = null;
      if (k !== null) seen.add(k);
      parent.removeChild(h);
      // clé d'identité des deux côtés : reprise par le rang ; sinon la même clé, écrite par l'auteur des deux côtés
      if (k !== null && (key === '#' ? identKey(this, it, k, by) : key === encodeURIComponent(k) && !identKey(this, it, k, by))) {
        var refs  = {};
        var nodes = [];
        if (rowMarks(last.nextSibling, stop, refs, nodes) && nodes.length) {
          try {
            var ix    = isArray ? at : keysArr[at];
            var built = tplFn(it, ix, refs);
            // éléments enregistrés pour le routage des événements, sauf si le tplFn l'a fait (`_mjs_reg`)
            if (!refs._mjs_reg) this._mjs_registerRefs(refs);
            en = {nodes: nodes, __nodes: refs, _mjs_updFn: built.updateFn || null, _mjs_init: built._mjs_init || 0, _mjs_p: built._mjs_p, _mjs_it: it, _mjs_ix: ix};
            refs._mjs_en = en;
          }
          catch {
            en = null;
          }
        }
      }
      if (en) {
        cache.set(k, en);
        done.push(k);
        last = en.nodes[en.nodes.length - 1];
      }
      else {
        while (last.nextSibling && last.nextSibling !== stop) parent.removeChild(last.nextSibling);
      }
    }
    return done;
  };

  // Rendu serveur, mode `markers` : les lignes de chaque liste dont les ancres sont reprises (celles de la racine, puis celles des lignes
  // repérées, de proche en proche) reçoivent leurs repères. Appelé par le rendu serveur juste après ceux de la racine
  µ._ssrRows = function(el) {
    var lists = el._mjs_list_anchor;
    if (!lists || !el._mjs_nodes) return;
    var doc      = el.ownerDocument;
    var byAnchor = new Map();
    for (var id in lists) byAnchor.set(lists[id], id);
    var mark = function(refs) {
      for (var a in refs) {
        var cid   = blockAnchor(a) ? byAnchor.get(refs[a]) : void 0;
        var cache = cid !== void 0 && el._mjs_list_cache && el._mjs_list_cache[cid];
        var order = cache && el._mjs_list_order[cid];
        if (!order) continue;
        // le nom de la clé `by` de la liste, posé sur son ancre par la réconciliation (mjs_for.ts)
        var by = refs[a]._mjs_by;
        for (var i = 0; i < order.length; i++) {
          var en = cache.get(order[i]);
          var ns = en && el._mjs_liveEntryNodes(en.nodes);
          if (!ns || !ns[0] || !ns[0].parentNode) continue;
          // clé d'identité : `#`, reprise par le rang (cf. identKey) ; toute autre clé, encodée
          var key = order[i];
          ns[0].parentNode.insertBefore(doc.createComment('mjs-l:' + (identKey(el, en._mjs_it, key, by) ? '#' : encodeURIComponent(key))), ns[0]);
          // un nœud qui porte plusieurs réfs n'a qu'un repère, réfs séparées par une espace
          var r     = en.__nodes;
          var byRef = new Map();
          for (var k in r) {
            var t = r[k];
            if (!t || !(t.nodeType === 1 || t.nodeType === 3 && t.parentNode)) continue;
            var ks = byRef.get(t);
            if (ks) ks.push(k);
            else byRef.set(t, [k]);
          }
          byRef.forEach(function(ks, t) {
            if (t.nodeType === 1) {
              t.setAttribute('mjs-r', ks.join(' '));
              return;
            }
            t.parentNode.insertBefore(doc.createComment((t.data === '' ? 'mjs-q:' : 'mjs-r:') + ks.join(' ')), t);
            if (t.data === '') return;
            // un texte repris que suit un autre texte : le parseur les fusionnerait, un commentaire vide les sépare (le client le laisse)
            var f = t.nextSibling;
            while (f && f.nodeType === 3 && f.data === '') f = f.nextSibling;
            if (f && f.nodeType === 3) t.parentNode.insertBefore(doc.createComment(''), t.nextSibling);
          });
          mark(r);
        }
      }
    };
    mark(el._mjs_nodes);
  };

  // Le serveur et le navigateur lisent le même module, mais pas forcément le même build : un serveur construit en développement et un navigateur construit en production
  // (qui a retiré des morceaux du module) numérotent leurs repères autrement, et la vue du navigateur lirait alors d'autres nœuds que les siens. Chaque nœud qui porte un
  // événement dans la vue du navigateur (`_mjs_evt_ids`, qui compte aussi ceux des blocs, que le serveur n'étiquette pas) doit avoir été repris. Quand l'un manque, le gabarit de
  // la racine dit exactement ce qui est attendu : les mêmes repères, sur des nœuds de même sorte. Sans événement à comparer, rien ne dit qu'un repère manque : la vue est reprise
  µ.Element.prototype._mjs_refsMatch = function(refs, factory) {
    var evt = this.constructor._mjs_evt_ids;
    if (!evt) return true;
    var missing = false;
    evt.forEach(function(id) {
      if (!refs[id]) missing = true;
    });
    if (!missing) return true;
    var built = factory();
    if (!built || !built.refs) return false;
    var keys = Object.keys(built.refs);
    for (var i = 0; i < keys.length; i++) {
      var want = built.refs[keys[i]];
      var have = refs[keys[i]];
      if (want && (!have || have.nodeType !== want.nodeType || have.localName !== want.localName)) return false;
    }
    return true;
  };

  // Approche A — marqueurs. Réutilise les nœuds du DSD serveur au lieu de les
  // recréer : walke le shadow, reconstruit `_mjs_nodes` depuis les marqueurs émis
  // par le serveur (attribut `mjs-h` sur les éléments, commentaire `mjs-h:<key>`
  // avant les text nodes, commentaire `mjs-e:<key>` à la place d'un text node vide),
  // les retire, et rebranche les events via
  // _mjs_registerRefs. Retourne false si rien à adopter, ou si le parseur du navigateur a déplacé
  // des ancres de bloc ou du texte repris (→ fallback création).
  µ.Element.prototype._mjs_hydrateA = function(factory) {
    var root = this._shadow;
    if (!root || !root.querySelectorAll) return false;
    var refs = {};
    var found = 0;
    // 1. Éléments porteurs de `mjs-h`.
    var els = root.querySelectorAll('[mjs-h]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      var k = e.getAttribute('mjs-h');
      if (k) {
        refs[k] = e;
        e.removeAttribute('mjs-h');
        found++;
      }
    }
    // 2. Commentaires `mjs-h:<key>` → le text node qui suit immédiatement ; `mjs-e:<key>` → un text node VIDE (ancre d'un bloc,
    // interpolation vide), que le HTML ne peut pas écrire : un neuf prend la place du commentaire.
    var doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc && doc.createTreeWalker) {
      var walker = doc.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */, null);
      var comments = [];
      var c;
      while ((c = walker.nextNode())) {
        if (/^mjs-[he]:/.test(c.data || '')) {
          comments.push(c);
        }
      }
      for (var j = 0; j < comments.length; j++) {
        var cm = comments[j];
        var key = (cm.data || '').slice(6);
        if (key && cm.data.charAt(4) === 'e') {
          refs[key] = µ._tm(cm);
          found++;
          continue;
        }
        if (key) {
          var tn = cm.nextSibling;
          // le texte suit son commentaire ; le parseur l'a sorti de là (texte écrit directement dans un <table> ou un <tr>) : cette vue ne se reprend pas, elle est rebâtie
          if (!tn || tn.nodeType !== 3) return false;
          refs[key] = tn;
          found++;
        }
        if (cm.parentNode) {
          cm.parentNode.removeChild(cm);
        }
      }
    }
    // 3. Blocs : ce que le serveur a rendu d'un bloc ({for}, {if}, {key}, {await}) entre ses deux ancres est refait par son premier
    // rendu côté client, qui s'appuie sur ces ancres : il part ici, sinon une liste y ajouterait ses lignes à celles du serveur. Sauf les
    // lignes d'une liste que le serveur a repérées (`mjs-l:` en tête) : gardées, la liste les reprend à son premier rendu (`_mjs_adoptRows`)
    for (var b in refs) {
      if (b.charCodeAt(0) === 115 && b.charCodeAt(1) === 45) { // 's-'
        var from = refs[b];
        var to = refs['e-' + b.slice(2)];
        // le parseur range parfois les deux ancres chez des parents différents (un <tr> sous un <table>, un <div> sous un <p>…) ; sans jumelle
        // ou dans l'ordre inverse, elles n'encadrent plus rien : la vue n'est pas reprise, elle est rebâtie
        if (!to || !(from.compareDocumentPosition(to) & 4) || from.parentNode !== to.parentNode) return false;
        if (rowHead(from.nextSibling, to)) {
          from._mjs_srv = 1;
          continue;
        }
        while (from.nextSibling !== to) {
          from.parentNode.removeChild(from.nextSibling);
        }
      }
    }
    if (found === 0) {
      return false; // aucun marqueur → composant non hydratable, fallback création
    }
    // 4. Les repères du serveur sont-ils ceux que la vue du navigateur attend ? Sinon (serveur et navigateur construits autrement) la vue est rebâtie, sans erreur
    if (!this._mjs_refsMatch(refs, factory)) {
      var tag = this.tagName.toLowerCase();
      var told = µ._mjs_hydrateTold || (µ._mjs_hydrateTold = {});
      if (!told[tag]) {
        told[tag] = true;
        µ.warn(µ._mjs_msg('elHydrateMismatch', { tag: tag }, '<{tag}> : les repères écrits par le serveur ne correspondent pas à ceux du navigateur — ce composant est reconstruit, sans le gain de la reprise. Cause probable : le serveur et le navigateur ont été construits différemment (autre « env », autres pages) ; construisez-les à l\'identique.'));
      }
      return false;
    }
    this._mjs_nodes = refs;
    this._mjs_registerRefs(refs);
    this._mjs_hydrated = true;
    return true;
  };

  // Approche B — walk positionnel (SANS marqueurs). On crée le fragment client
  // (factory) pour CONNAÎTRE la structure + les refs, puis on aligne ce fragment
  // avec le DOM serveur position par position : chaque nœud réactif du fragment
  // est remplacé, dans `_mjs_nodes`, par le nœud serveur de même position. Le
  // fragment client est jeté (on garde le DOM serveur). Les text nodes fusionnés
  // par le parseur sont re-découpés via splitText. Fragile par nature (toute
  // divergence de structure désaligne) → fallback création en cas d'écart.
  µ.Element.prototype._mjs_hydrateB = function(factory) {
    var root = this._shadow;
    if (!root) return false;
    var built = factory();
    if (!built || !built.refs || !built.fragment) return false;
    // Map inverse : nœud du fragment → liste de clés de ref.
    var nodeToKeys = new Map();
    for (var key in built.refs) {
      if (!Object.prototype.hasOwnProperty.call(built.refs, key)) continue;
      if (blockAnchor(key)) return false; // un bloc : la vue est rebâtie, comme en `replace`
      var n = built.refs[key];
      if (!n) continue;
      var arr = nodeToKeys.get(n);
      if (arr) { arr.push(key); } else { nodeToKeys.set(n, [key]); }
    }
    var newRefs = {};
    var ok = this._mjs_walkAdopt(root, built.fragment, nodeToKeys, newRefs);
    if (!ok) return false; // désalignement → fallback création
    this._mjs_nodes = newRefs;
    this._mjs_registerRefs(newRefs);
    this._mjs_hydrated = true;
    return true;
  };

  // Walk parallèle serveur ↔ fragment client. Côté serveur on saute les balises
  // de style (absentes du fragment, le CSS étant en adoptedStyleSheets). Pour les
  // text nodes, on découpe le nœud serveur (splitText) à la longueur du nœud
  // fragment afin de réaligner après une fusion de texte par le parseur HTML, puis
  // on lui rend le texte du fragment : une interpolation est vide dans le fragment
  // (remplie par le premier effect), sa valeur écrite par le serveur n'a donc pas de
  // longueur connue, et le texte fixe qui la suit serait coupé au mauvais endroit
  // (« Bonjour Bob! » → « Bonjour BobB »).
  µ.Element.prototype._mjs_walkAdopt = function(serverParent, fragmentParent, nodeToKeys, newRefs) {
    var s = serverParent.firstChild;
    var f = fragmentParent.firstChild;
    while (f) {
      while (s && srvSheet(s)) {
        s = s.nextSibling;
      }
      if (!s) return false; // plus de nœud serveur → désalignement
      if (f.nodeType !== s.nodeType) return false; // types divergents → désalignement
      if (f.nodeType === 3) {
        var fl = (f.data || '').length;
        if ((s.data || '').length > fl && typeof s.splitText === 'function') {
          s.splitText(fl);
        }
        if (s.data !== f.data) {
          s.data = f.data;
        }
      }
      var keys = nodeToKeys.get(f);
      if (keys) {
        for (var i = 0; i < keys.length; i++) {
          newRefs[keys[i]] = s;
        }
      }
      if (f.firstChild) {
        if (!this._mjs_walkAdopt(s, f, nodeToKeys, newRefs)) return false;
      }
      f = f.nextSibling;
      s = s.nextSibling;
    }
    // Fragment épuisé → purge des nœuds serveur excédentaires (hors style).
    // Un placeholder `{$x}` vide côté fragment (rempli seulement au 1er
    // effect) splitText(0) sur le nœud serveur non-vide, laissant le reliquat
    // texte comme frère orphelin (ex. « 5 » de « compteur : 5 ») → sans cette
    // purge il reste affiché en double (« compteur : 55 »).
    while (s) {
      var sn = s.nextSibling;
      if (!srvSheet(s) && !this._mjs_coreField(serverParent, s)) {
        serverParent.removeChild(s);
      }
      s = sn;
    }
    return true;
  };

  // Approche C — diff léger. Comme B (réconcilie le fragment client avec le DOM
  // serveur), mais au lieu d'ÉCHOUER sur un écart, on le CORRIGE : on réutilise
  // les nœuds serveur compatibles et on patche le reste (texte, nœud
  // manquant/en trop, balise divergente). Plus robuste qu'un walk strict (tolère
  // un mismatch serveur/client), au prix d'un parcours comparatif.
  µ.Element.prototype._mjs_hydrateC = function(factory) {
    var root = this._shadow;
    if (!root) return false;
    var built = factory();
    if (!built || !built.refs || !built.fragment) return false;
    var nodeToKeys = new Map();
    for (var key in built.refs) {
      if (!Object.prototype.hasOwnProperty.call(built.refs, key)) continue;
      if (blockAnchor(key)) return false; // un bloc : la vue est rebâtie, comme en `replace`
      var n = built.refs[key];
      if (!n) continue;
      var arr = nodeToKeys.get(n);
      if (arr) { arr.push(key); } else { nodeToKeys.set(n, [key]); }
    }
    var newRefs = {};
    this._mjs_diffAdopt(root, built.fragment, nodeToKeys, newRefs);
    this._mjs_nodes = newRefs;
    this._mjs_registerRefs(newRefs);
    this._mjs_hydrated = true;
    return true;
  };

  // Réconcilie les enfants de `serverParent` (DOM rendu) avec ceux de
  // `fragmentParent` (vue client neuve), en réutilisant au maximum les nœuds
  // serveur. Saute les balises de style côté serveur.
  µ.Element.prototype._mjs_diffAdopt = function(serverParent, fragmentParent, nodeToKeys, newRefs) {
    var s = serverParent.firstChild;
    var f = fragmentParent.firstChild;
    while (f) {
      var fNext = f.nextSibling;
      while (s && srvSheet(s)) {
        s = s.nextSibling;
      }
      var matched;
      if (s && f.nodeType === s.nodeType && (f.nodeType !== 1 || f.tagName === s.tagName)) {
        // Nœud serveur compatible → réutilisé. Pour un text node : re-découpe si
        // fusionné, puis corrige le contenu si divergent.
        matched = s;
        if (f.nodeType === 3) {
          var fl = (f.data || '').length;
          if ((s.data || '').length > fl && typeof s.splitText === 'function') {
            s.splitText(fl);
          }
          if (s.data !== f.data) {
            s.data = f.data;
          }
        }
        s = s.nextSibling;
      } else {
        // Pas de correspondance → on insère le nœud fragment ici (déplacé dans le
        // DOM serveur). Si s est null, insertBefore équivaut à un append.
        serverParent.insertBefore(f, s);
        matched = f;
      }
      var keys = nodeToKeys.get(f);
      if (keys) {
        for (var i = 0; i < keys.length; i++) { newRefs[keys[i]] = matched; }
      }
      if (f.firstChild && matched.nodeType === 1) {
        this._mjs_diffAdopt(matched, f, nodeToKeys, newRefs);
      }
      f = fNext;
    }
    // Nœuds serveur excédentaires (hors style) → suppression.
    while (s) {
      var sn = s.nextSibling;
      if (!srvSheet(s) && !this._mjs_coreField(serverParent, s)) {
        serverParent.removeChild(s);
      }
      s = sn;
    }
  };
}
