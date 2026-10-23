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
    // rendu côté client, qui s'appuie sur ces ancres : il part ici, sinon une liste y ajouterait ses lignes à celles du serveur.
    for (var b in refs) {
      if (b.charCodeAt(0) === 115 && b.charCodeAt(1) === 45) { // 's-'
        var from = refs[b];
        var to = refs['e-' + b.slice(2)];
        // le parseur range parfois les deux ancres chez des parents différents (un <tr> sous un <table>, un <div> sous un <p>…) ; sans jumelle
        // ou dans l'ordre inverse, elles n'encadrent plus rien : la vue n'est pas reprise, elle est rebâtie
        if (!to || !(from.compareDocumentPosition(to) & 4) || from.parentNode !== to.parentNode) return false;
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
