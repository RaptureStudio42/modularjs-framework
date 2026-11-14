// mjs_wake — le réveil paresseux d'un composant rendu par le serveur : `@wake=view` ou `@wake=interaction` sur sa balise, dans un gabarit
// (attribut `mjs-wake`, posé à la construction et rendu aussi par le serveur). La page du serveur reste affichée, telle quelle, jusqu'au
// réveil : quand la balise paraît à l'écran (IntersectionObserver), ou, avec `interaction` sur une page rendue en `ssr`, `ssr:markers` ou
// `prerender`, au premier signe d'intention sur elle (le pointeur qui y entre, un doigt posé, le focus clavier, ou ce focus déjà en elle) ;
// en `ssr:positional` et `ssr:diff`, `interaction` se réveille comme `view`. Jusque-là, le composant est la page du serveur, comme une
// page qui démarre : aucun geste n'est retenu, annulé, arrêté ni rejoué (le signe d'intention est écouté passivement, le réveil attend la
// fin de son événement), un geste arrivé avant la fin du réveil a l'effet qu'il a dans la page du serveur ; ce que le navigateur fait seul
// (une saisie, une case cochée, un formulaire envoyé) se fait dans la page du serveur. Avec `interaction`, ce que l'utilisateur y a changé
// passe au réveil à la vue, que la vue remplace la page du serveur ou la reprenne : le focus et sa sélection, une saisie, une case, une
// option, un `<details>`, une zone défilée, chacun à la même place dans le gabarit (cf. _mjsRvNote).
// Une balise sans boîte (`display: contents`) ne paraît jamais elle-même à l'écran : elle paraît quand un des enfants qu'elle affiche paraît.
// Une boîte perdue pendant l'attente (une feuille de style, une règle `@media` au redimensionnement), que l'IntersectionObserver ne rapporte
// pas hors de l'écran, est vue par un ResizeObserver.
// Chaque occurrence attend son déclencheur, alors que la balise est définie une fois pour toutes : mise à niveau pendant qu'elle attend,
// l'instance ne construit rien (blocs `<reveil>` de µ.Element) — ses appels de construction sont retenus, rejoués au réveil. Ce que sa page
// contient attend avec elle, et ses crochets (`µawake`, `µmount`) jouent dans l'ordre de la même page sans `@wake` ; un enfant qui a son
// propre `@wake` attend ensuite le sien.
// La page du serveur n'est gardée que si la balise qui attend en vient : celle du serveur, ou celle que la vue de son parent recrée à la même
// place quand ce parent vient lui-même de la page du serveur (la racine de la page, un composant qui attendait son réveil, un composant repris
// du serveur). Une balise paresseuse bâtie au client sans page à reprendre se construit tout de suite, et le développement le dit.
// Sans rendu serveur, il n'y a pas de page à garder : la balise se construit tout de suite. N'entre au cœur que si une page écrit `@wake`

var _MJS_RV_HORS = { STYLE: 1, LINK: 1, SCRIPT: 1, TEMPLATE: 1 };
// les instances qui attendaient dans la page d'un composant qui la jette pour bâtir sa vue (mode `replace`, réveil), rangées par place : la
// balise que sa vue recrée à la même place reprend leur page
var _mjsRvKept = new WeakMap();
// <reveil-intention>
// le focus perdu avec la page jetée et sa sélection, que la vue de la balise `interaction` qui a reçu son champ lui rend (cf. _mjsRvMatch)
var _mjsRvFoc = new WeakMap();
// </reveil-intention>
// la balise qu'attend chaque enfant observé à la place d'une balise sans boîte (cf. _mjsRvSee)
var _mjsRvFor = new WeakMap();
// le rang de chaque balise dans l'ordre de ses définitions (µ._def) : au démarrage, une balise se définit après celles qui l'affichent, et
// chaque définition met à niveau ses balises dans l'ordre du document ; un réveil suit cet ordre
var _mjsRvTypes = Object.create(null), _mjsRvN = 0;
// pendant un réveil dans l'ordre des définitions : les instances que sa construction bâtit, retenues jusqu'à leur tour
var _mjsRvBatch = null;
// le démarrage d'une page rendue par le serveur dure tant que des définitions arrivent : une balise paresseuse construite alors sans page du
// serveur le dit, une fois par balise (développement)
var _mjsRvBoot = 1, _mjsRvBootT = 0, _mjsRvSsr = 0, _mjsRvSaid = Object.create(null);

// rendue par le serveur et en attente : la balise porte encore `mjs-wake`, ou un de ses ancêtres (à travers les racines d'ombre)
function _mjsRvWaits(n) {
  for (; n; n = n.parentNode || (n.nodeType === 11 ? n.host : null)) {
    if (n.nodeType === 1 && n.hasAttribute('mjs-wake') && n.hasAttribute('mjs-ssr')) return true;
  }
  return false;
}

// le composant dont la page contient `n` : l'hôte de sa racine d'ombre, ou le composant qui l'entoure (léger, ou dont il est un enfant glissé
// dans un `<slot>`)
function _mjsRvHost(n) {
  for (n = n.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 11) return n.host || null;
    if (n.tagName && n.tagName.indexOf('MJS-') === 0) return n;
  }
  return null;
}

// rang d'une balise parmi ses sœurs, feuilles de style et scripts du serveur mis à part
function _mjsRvRank(el) {
  var i = 0, c;
  for (c = el.parentNode.firstElementChild; c !== el; c = c.nextElementSibling) if (!_MJS_RV_HORS[c.tagName]) i++;
  return i;
}

// la place d'un élément depuis `top`, en texte : une étape par balise (`NOM:rang`), `#` pour entrer dans une racine d'ombre ; null hors de
// `top`
function _mjsRvPath(n, top) {
  var steps = [], p;
  while (n && n !== top) {
    p = n.parentNode;
    if (!p) return null;
    steps.unshift(n.tagName + ':' + _mjsRvRank(n));
    if (p === top) return steps.join('/');
    if (p.nodeType === 11) steps.unshift('#');
    n = p.nodeType === 11 ? p.host : p;
  }
  return n ? steps.join('/') : null;
}

// la place d'un élément dans l'ordre du document, racines d'ombre comprises (la page d'un hôte avant ses enfants), celui des mises à niveau
// d'une définition
function _mjsRvKey(n) {
  var k = [], p;
  for (; n && (p = n.parentNode); n = p.nodeType === 11 ? p.host : p) k.unshift(p.nodeType === 11 ? -1 : 0, Array.prototype.indexOf.call(p.childNodes, n));
  return k;
}

// l'ordre du démarrage de la page : le rang de la définition, puis la place dans le document
function _mjsRvCmp(a, b) {
  var d = (_mjsRvTypes[a.localName] || 1e9) - (_mjsRvTypes[b.localName] || 1e9), x, y, i;
  if (d) return d;
  x = _mjsRvKey(a);
  y = _mjsRvKey(b);
  for (i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

// les instances qui attendent dans la page de `el`, que sa vue va jeter (mode `replace`, réveil) : rangées par place (`m`), avec leurs sortes
// (balise et déclencheur, `k`), le temps que sa vue les recrée (cf. µ._mjs_wakeNew) ; celles que sa vue reprend telles quelles (modes
// `markers`, `positional`, `diff`) reçoivent leur déclencheur une fois `el` construit
function _mjsRvKeep(el) {
  var root = el._shadow, kept = null, lazy = root && root.querySelectorAll && root.querySelectorAll('[mjs-wake]');
  if (!lazy || !lazy.length) return;
  lazy.forEach(function(c) {
    if (!c.hasAttribute('mjs-ssr') || _mjsRvHost(c) !== el) return;
    kept ||= { m: new Map(), k: new Set(), w: [] };
    kept.m.set(_mjsRvPath(c, root), c);
    kept.k.add(c.localName + ' ' + c.getAttribute('mjs-wake'));
  });
  if (kept) {
    // <reveil-intention>
    // le focus, s'il est dans la page jetée, et sa sélection, rendus une fois la page passée à la balise recréée (cf. _mjsRvMatch), comme
    // le défilement des zones de la page d'une instance `interaction`, qu'un nœud déplacé perd
    kept.a = _mjsRvActive();
    kept.s = kept.a && _mjsRvSel(kept.a);
    kept.t = [];
    kept.m.forEach(function(c) {
      if (c.getAttribute('mjs-wake') === 'interaction') _mjsRvEach(c.shadowRoot || c, function(n) { if (n.scrollTop || n.scrollLeft) kept.t.push([n, n.scrollTop, n.scrollLeft]); });
    });
    // </reveil-intention>
    _mjsRvKept.set(el, kept);
    setTimeout(function() { _mjsRvKept.delete(el); });
  }
  queueMicrotask(function() { _mjsRvKids(el); });
}

// les instances paresseuses de la page de `el` reçoivent leur déclencheur, `el` construit
function _mjsRvKids(el) {
  var root = el._shadow;
  if (!root || !root.querySelectorAll || el._mjs_wakeCalls) return;
  root.querySelectorAll('[mjs-wake]').forEach(function(c) { if (c._mjs_wakeCalls) _mjsRvArm(c); });
}

// la vue de `host` est complète (ses blocs rendus, les places définitives) : chaque balise recréée qui attend encore sa page la reçoit de
// l'instance du serveur qui occupait sa place — son contenu et ses props écrites par le serveur ; sans instance à sa place, elle n'a rien à
// garder et se réveille tout de suite. Un composant léger ne reçoit que la page du composant, devant le contenu glissé que le client lui a
// déjà donné (cf. _mjsRvPage)
function _mjsRvMatch(host) {
  var kept = _mjsRvKept.get(host), root = host._shadow, lit = [];
  if (!kept) return;
  kept.w.splice(0).forEach(function(el) {
    var key = el._mjs_wakeCalls && el.isConnected && _mjsRvPath(el, root), old = key && kept.m.get(key);
    if (!el._mjs_wakeCalls) return;
    if (!old || old.localName !== el.localName || old.getAttribute('mjs-wake') !== el.getAttribute('mjs-wake')) return _mjsRvGo(el);
    kept.m.delete(key);
    if (el.shadowRoot) el.shadowRoot.append(...(old.shadowRoot || old).childNodes);
    else el.prepend(...(el._mjs_wakePg = _mjsRvPage(el, old)));
    if (old.hasAttribute('mjs-props') && !el.hasAttribute('mjs-props')) el.setAttribute('mjs-props', old.getAttribute('mjs-props'));
    // <reveil-intention>
    if (kept.a && el.getAttribute('mjs-wake') === 'interaction' && _mjsRvPath(kept.a, el)) lit.push(el);
    // </reveil-intention>
  });
  // <reveil-intention>
  // le défilement des zones déplacées leur revient ; le focus perdu avec la page jetée (le champ atteint au clavier, avant le démarrage ou
  // dans un parent qui se réveille) est un signe d'intention : la balise `interaction` qui a reçu son champ se réveille, et sa vue rend le
  // focus à ce champ, avec sa sélection (un nœud déplacé ne le reprend pas toujours aussitôt : sous WebKit, pas avant que la feuille de
  // style `<link>` de sa page soit relue)
  kept.t.forEach(function(x) {
    x[0].scrollTop  = x[1];
    x[0].scrollLeft = x[2];
  });
  lit.forEach(function(el) {
    _mjsRvFoc.set(el, [kept.a, kept.s]);
    _mjsRvGo(el);
  });
  // </reveil-intention>
}

// la page de l'instance du serveur `old` que reçoit le composant léger recréé `el`, sans le contenu que la page lui avait glissé (le client
// l'a déjà donné à `el`, avec ses nœuds et ses composants) : ce qui précède le repère `<!--mjs-l-->` (cf. _mjsLightDrop, mjs_element.ts) ;
// sans repère (page rendue sans reprise), tous ses nœuds sauf les derniers, autant que le HTML du contenu glissé du client en donne une fois
// relu (un texte vide ne s'écrit pas, des textes voisins n'en font qu'un). Une instance du serveur à racine d'ombre n'a que sa page
function _mjsRvPage(el, old) {
  var ns = Array.from((old.shadowRoot || old).childNodes), i = ns.findIndex(function(n) { return n.nodeType === 8 && n.data === 'mjs-l'; }), h = document.createElement('template');
  h.innerHTML = el.innerHTML;
  return old.shadowRoot ? ns : ns.slice(0, i < 0 ? Math.max(0, ns.length - h.content.childNodes.length) : i);
}

// libre de se réveiller : aucun ancêtre n'attend, et le composant dont la page la contient est construit
function _mjsRvFree(el) {
  var h = _mjsRvHost(el);
  return !h || (h.matches(':defined') && !h._mjs_wakeCalls && !_mjsRvWaits(h));
}

// un rapport de l'IntersectionObserver (la vue) ou du ResizeObserver (la taille : une boîte perdue hors de l'écran, que le premier ne
// rapporte pas) sur une balise qui attend, ou sur un élément observé à sa place
function _mjsRvSaw(list) {
  list.forEach(function(e) {
    var t = e.target, el = _mjsRvFor.get(t) || t;
    if (!el.isConnected) _mjsRvDisarm(el);
    else if (e.isIntersecting) _mjsRvGo(el);
    else if (el._mjs_wakeArmed) _mjsRvSee(t, el, !(e.contentRect || e.boundingClientRect).height && _mjsRvDisp(t) === 'contents');
  });
}

// `t` observé, à la vue et à la taille, pour la balise qui attend (elle-même, ou un élément à sa place) ; plus observé avec `off`
function _mjsRvObs(t, off) {
  [µ._mjs_wakeIO, µ._mjs_wakeRO].forEach(function(o) { off ? o.unobserve(t) : o.observe(t); });
}

// le déclencheur de `el` posé, s'il est libre de se réveiller (sinon, son parent le posera à son réveil) : `interaction` sur une page rendue
// en `ssr`, `ssr:markers` ou `prerender` (`µ._mjs_ssrHydrate` ni 'b' ni 'c'), les signes d'intention écoutés sur la balise, à la capture et
// passivement (rien n'est annulé ni arrêté ; un doigt posé passe aussi par `pointerover`, `touchstart` pour un navigateur sans événements de
// pointeur), le premier venu réveille dans la tâche suivante, son événement fini dans la page du serveur ; le focus déjà dans la balise (le
// code arrivé après le premier Tab, le parent que ce focus vient de réveiller) réveille de même, aucun `focusin` ne suivra. Ce que
// l'utilisateur a fait dans sa page passe à sa vue au réveil (cf. _mjsRvNote). Sinon la vue (sur ses enfants quand la balise n'a pas de
// boîte, cf. _mjsRvSee) ; sans IntersectionObserver ou sans ResizeObserver, la balise se réveille tout de suite
function _mjsRvArm(el) {
  var how = el.getAttribute('mjs-wake'), stop, go;
  if (!how || el._mjs_wakeArmed || !el.isConnected || !_mjsRvFree(el)) return;
  el._mjs_wakeArmed = true;
  // <reveil-intention>
  if (how === 'interaction' && µ._mjs_ssrHydrate !== 'b' && µ._mjs_ssrHydrate !== 'c') {
    stop = el._mjs_wakeStop = new AbortController();
    go   = function() { _mjsRvDisarm(el); setTimeout(function() { if (el.isConnected) _mjsRvGo(el); }); };
    ['pointerover', 'pointerdown', 'touchstart', 'focusin'].forEach(function(t) { el.addEventListener(t, go, { capture: true, passive: true, signal: stop.signal }); });
    if (el.matches(':focus-within')) go();
    return;
  }
  // </reveil-intention>
  if (typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') _mjsRvGo(el);
  else {
    µ._mjs_wakeIO ||= new IntersectionObserver(_mjsRvSaw);
    µ._mjs_wakeRO ||= new ResizeObserver(_mjsRvSaw);
    _mjsRvObs(el);
  }
}

// `t` hors de l'écran, `el` en attente : au premier rapport de la balise, les balises qu'elle affiche sont observées à sa place (celles d'un
// `<slot>` : les balises qu'il affiche) — une balise sans boîte (`display: contents`, `@display="contents"`), ou qui la perd plus tard, n'est
// pas vue par l'IntersectionObserver : le premier de ses enfants qui paraît la réveille, et un enfant sans boîte, d'emblée ou plus tard, passe
// la main aux siens (une fois : la vue et la taille le rapportent toutes deux). Plus rien à observer sous une balise sans boîte (du texte
// seul), au premier rapport ou quand elle perd sa boîte : elle se réveille tout de suite, et le développement le dit. De même pour du texte
// avec des éléments tous cachés (`display: none`, `hidden`) sous une balise sans boîte, d'emblée ou cachés pendant l'attente : seul le texte
// peut paraître, et le navigateur ne dit pas quand (`seen.t` : du texte vu sous la balise, ou sous un enfant sans boîte)
function _mjsRvSee(t, el, nobox) {
  var seen = el._mjs_wakeSeen, i = seen ? seen.indexOf(t) : -1;
  if (t === el ? !seen : nobox && i >= 0) {
    if (t !== el) {
      _mjsRvObs(t, 1);
      seen.splice(i, 1);
    }
    seen = el._mjs_wakeSeen ||= [];
    Array.prototype.forEach.call(t.assignedNodes ? t.assignedNodes({ flatten: true }) : (t._shadow || t.shadowRoot || t).childNodes, function(c) {
      if (c.nodeType === 3) seen.t ||= /\S/.test(c.data);
      else if (c.nodeType === 1 && !_MJS_RV_HORS[c.tagName]) {
        _mjsRvFor.set(c, el);
        seen.push(c);
        _mjsRvObs(c);
      }
    });
  }
  if (nobox && !seen.length || seen.t && _mjsRvDisp(el) === 'contents' && seen.every(function(c) { return _mjsRvDisp(c) === 'none'; })) {
    _mjsRvSay(el, 1);
    _mjsRvGo(el);
  }
}

// le `display` calculé de `n`
function _mjsRvDisp(n) {
  return getComputedStyle(n).display;
}

// le déclencheur retiré : réveil fait ou en route (signe d'intention reçu), ou balise sortie de la page avant son réveil (rien ne la retient
// plus)
function _mjsRvDisarm(el) {
  if (!el._mjs_wakeArmed) return;
  el._mjs_wakeArmed = false;
  if (el._mjs_wakeStop) el._mjs_wakeStop.abort();
  if (µ._mjs_wakeRO) {
    _mjsRvObs(el, 1);
    if (el._mjs_wakeSeen) el._mjs_wakeSeen.forEach(function(c) { _mjsRvObs(c, 1); _mjsRvFor.delete(c); });
    el._mjs_wakeSeen = null;
  }
}

// rien n'est construit : chaque appel de construction de `el` retenu, rejoué tel quel au réveil (tous ses arguments : le second de
// `_mjs_mount`, posé par le compilateur pour un composant qui livre des props aux composants de sa racine, lui fait garder son contenu
// jusqu'à leur remise, comme sans `@wake`), et le parent lui garde ses props (µ._mjs_pend), comme à une balise pas encore mise à niveau.
// Écrits en propriétés, jamais par leur nom en chaîne : le minifieur de production raccourcit les noms `_mjs_*` du code, pas ceux d'une
// chaîne. `_mjs_wakeAt` : mise à niveau au démarrage de la page (pendant une définition, ou pendant un réveil qui en suit l'ordre)
function _mjsRvHold(el) {
  var calls = el._mjs_wakeCalls = [];
  el._mjs_wakeAt      = !!(µ._mjs_defining || _mjsRvBatch);
  el._mjs_mount       = function() { var a = arguments; calls.push(function() { el._mjs_mount.apply(el, a); }); };
  el._mjs_injectSlots = function() { calls.push(function() { el._mjs_injectSlots(); }); };
  el._mjs_bindEvents  = function() { var a = arguments; calls.push(function() { el._mjs_bindEvents.apply(el, a); }); };
  el.init             = function($) { calls.push(function() { el.init($); }); };
  el._set             = undefined;
}

// une instance retenue construite puis connectée : ses appels de construction rejoués (la vue bâtie, ou reprise du serveur ; la page reprise
// d'une autre balise est jetée, la balise sans `@wake` aurait bâti la sienne), puis sa connexion. Les instances retenues de sa page suivent :
// dans la file `q` d'un réveil dans l'ordre des définitions (qui reçoit aussi les instances que sa construction bâtit), sinon aussitôt, dans
// l'ordre du document ; une instance qui a son propre `@wake` reçoit son déclencheur
function _mjsRvOne(el, q) {
  var calls = el._mjs_wakeCalls, prev = _mjsRvBatch, kids = [];
  if (!calls) return;
  delete el._mjs_wakeCalls;
  delete el._mjs_mount;
  delete el._mjs_injectSlots;
  delete el._mjs_bindEvents;
  delete el.init;
  delete el._set;
  if (el._mjs_wakeTook) el._mjs_ssrAdopt = false;
  // la page du serveur jetée comme le ferait le constructeur : toujours pour un composant léger, jamais pour une vue que le mode reprend ; un
  // composant léger garde le contenu que sa page lui a glissé (`µ._mjs_lightDrop`, mjs_element.ts, présent avec la reprise du serveur) ;
  // l'instance recréée par le client ne jette que la page reçue de celle du serveur (cf. _mjsRvMatch), le contenu glissé qu'il lui a donné reste
  if (el.hasAttribute('mjs-ssr') && (el._mjs_wakeTook || el._mjs_isLight || !µ._mjs_ssrHydrate)) {
    if (!el._mjs_isLight) el._shadow.replaceChildren();
    else if (el._mjs_wakeTook) (el._mjs_wakePg || []).splice(0).forEach(function(n) { n.remove(); });
    else if (!µ._mjs_lightDrop?.(el)) el.replaceChildren();
  }
  _mjsRvBatch = q;
  try {
    calls.forEach(function(c) { c(); });
  }
  finally {
    _mjsRvBatch = prev;
  }
  if (el.isConnected) el.connectedCallback();
  new Set([el._shadow, el]).forEach(function(r) {
    if (r && r.querySelectorAll) r.querySelectorAll('[mjs-ssr]').forEach(function(c) {
      if (!c._mjs_wakeCalls || _mjsRvHost(c) !== el || (q && q.includes(c))) return;
      if (c.hasAttribute('mjs-wake')) _mjsRvArm(c);
      else (q || kids).push(c);
    });
  });
  kids.forEach(function(c) { _mjsRvOne(c, null); });
}

// <reveil-intention>
// l'élément qui a le focus, au fond des racines d'ombre (celle d'un composant fermé comprise)
function _mjsRvActive() {
  var a = document.activeElement, r;
  while (a && (r = a._shadow || a.shadowRoot) && r.activeElement) a = r.activeElement;
  return a;
}

// la sélection d'un champ de texte (début, fin, sens) ; null pour une balise qui n'en a pas (case, liste, champ nombre…)
function _mjsRvSel(n) {
  try {
    return n.selectionStart == null ? null : [n.selectionStart, n.selectionEnd, n.selectionDirection];
  }
  catch {
    return null;
  }
}

// le focus rendu à `n`, sans défilement, et sa sélection `s` ; la mise en page d'abord : sous WebKit, un champ d'un composant né dans la
// même tâche (la balise qu'un parent réveillé vient de recréer) n'est pas focalisable avant elle
function _mjsRvFocus(n, s) {
  n.getClientRects();
  n.focus({ preventScroll: true });
  if (s) {
    try {
      n.setSelectionRange(s[0], s[1], s[2]);
    }
    catch {}
  }
}

// chaque élément sous `root`, les pages des composants qu'il contient comprises
function _mjsRvEach(root, f) {
  root.querySelectorAll('*').forEach(function(n) {
    var r = n._shadow || n.shadowRoot;
    f(n);
    if (r && r !== n) _mjsRvEach(r, f);
  });
}

// l'élément à la place `p` depuis `top` (cf. _mjsRvPath), s'il porte la balise que nomme chaque étape ; null sinon
function _mjsRvAt(top, p) {
  var n = top;
  p.split('/').every(function(s) {
    var c, i;
    if (s === '#') return n = n._shadow || n.shadowRoot;
    s = s.split(':');
    for (i = +s[1], c = n.firstElementChild; c && (_MJS_RV_HORS[c.tagName] || i--); c = c.nextElementSibling);
    return n = c && c.tagName === s[0] ? c : null;
  });
  return n;
}

// la marque de `n` vue depuis `top` : de `n` à `top` exclu, chaque élément, sa balise, ses attributs (hors l'état de l'utilisateur, la valeur
// de départ d'un champ et les repères du framework) et son texte propre, sans blancs (un composant, sa balise seule) ; d'une liste, ses
// options. À la même place, une autre marque est un autre contenu : une ligne de `{for}` d'un autre élément, un autre bouton radio, une
// autre option
function _mjsRvSig(n, top) {
  var s = [], m = n, p, a, tx;
  for (; m && m !== top && m.nodeType === 1; m = (p = m.parentNode) && p.nodeType === 11 ? p.host : p) {
    a  = [];
    tx = '';
    if (m.tagName.indexOf('-') < 0) {
      Array.prototype.forEach.call(m.attributes, function(x) {
        if (!/^(mjs-|data-mjs|checked$|selected$|open$|style$)/.test(x.name) && !(x.name === 'value' && (m.tagName === 'SELECT' || m.tagName === 'INPUT' && m.type !== 'checkbox' && m.type !== 'radio'))) a.push(x.name + '=' + x.value);
      });
      if (m.tagName !== 'TEXTAREA') Array.prototype.forEach.call(m.childNodes, function(c) { if (c.nodeType === 3) tx += c.data.replace(/\s+/g, ''); });
    }
    s.push(m.tagName + ' ' + a.sort().join(' ') + ' ' + tx);
  }
  if (n.tagName === 'SELECT') Array.prototype.forEach.call(n.options, function(o) { s.push(o.value + '|' + o.text.replace(/\s+/g, '')); });
  return s.join('\n');
}

// le texte d'un contenu modifiable, blancs réduits
function _mjsRvTxt(n) {
  return n.textContent.replace(/\s+/g, ' ').trim();
}

// ce que l'utilisateur a fait dans la page de `el` avant son réveil, relevé avant que sa vue la remplace ou la reprenne, chaque élément par sa
// place depuis `el` (cf. _mjsRvPath), la même dans la page du serveur et dans la vue, bâties du même gabarit, et par sa marque (`k`, cf.
// _mjsRvSig) : la saisie d'un champ (`v`, autre que sa valeur écrite dans la page), les fichiers choisis (`i`), une case ou un bouton radio
// (`c`), les options d'une liste (`s`), l'ouverture d'un `<details>` (`o`, comparée à la vue : le navigateur n'en garde pas l'état de
// départ), le texte d'un contenu modifiable (`h`, comparé à la vue : il n'est pas reporté), le défilement d'une zone (`t`), le focus et sa
// sélection (`f`) ; les pages des composants qu'elle contient comprises. null sans rien à reporter
function _mjsRvNote(el) {
  var w = _mjsRvFoc.get(el) || [_mjsRvActive()], out = [];
  _mjsRvFoc.delete(el);
  _mjsRvEach(el._shadow || el, function(n) {
    var t = n.type, box = t === 'checkbox' || t === 'radio', x = { n: n };
    if (n === w[0]) x.f = [w.length > 1 ? w[1] : _mjsRvSel(n)];
    if (n.tagName === 'SELECT') {
      if (Array.prototype.some.call(n.options, function(o) { return o.selected !== o.defaultSelected; })) x.s = Array.prototype.map.call(n.options, function(o) { return o.selected; });
    }
    else if (box) {
      if (n.checked !== n.defaultChecked) x.c = n.checked;
    }
    else if (t === 'file') {
      if (n.files && n.files.length) x.i = n.files;
    }
    else if ((n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') && n.value !== n.defaultValue) x.v = n.value;
    if (n.tagName === 'DETAILS') x.o = n.open;
    if (n.isContentEditable && !(n.parentElement && n.parentElement.isContentEditable)) x.h = _mjsRvTxt(n);
    if (n.scrollTop || n.scrollLeft) x.t = [n.scrollTop, n.scrollLeft];
    if (Object.keys(x).length > 1) {
      x.p = _mjsRvPath(n, el);
      x.k = _mjsRvSig(n, el);
      out.push(x);
    }
  });
  return out.length ? out : null;
}

// un champ de texte : le navigateur n'y envoie `change` qu'à la sortie du champ
function _mjsRvTape(n) {
  return n.tagName === 'TEXTAREA' || /^(text|search|email|url|tel|password|number)$/.test(n.type);
}

// `change` envoyé à la sortie du champ `n`, comme le navigateur l'aurait fait pour la saisie reportée, s'il ne l'a pas envoyé lui-même avant
function _mjsRvLater(n) {
  var vu = false;
  n.addEventListener('change', function() { vu = true; }, { once: true });
  n.addEventListener('blur', function() { if (!vu) n.dispatchEvent(new Event('change', { bubbles: true })); }, { once: true });
}

// ce que relève _mjsRvNote, reporté sur l'élément de même place dans la vue de `el` (rien ne change là où la vue l'a déjà) : le composant
// l'apprend comme si l'utilisateur venait de le faire, par `input` puis `change` (pour un champ de texte qui garde le focus, `change` à sa
// sortie, la saisie y continue), par `toggle` pour un `<details>` ; le focus rendu en dernier (`f`), avec sa sélection. Un élément par
// microtâche, cherché à son tour, la vue rendue après les événements du précédent (le gestionnaire d'un filtre a pu rebâtir la liste qui
// suit) : une place où la vue n'a pas l'élément de la page du serveur (une autre balise, un autre type ou nom de champ, une autre marque : le
// serveur et le navigateur rendent là un contenu différent, ou un gestionnaire a changé la vue) ne reçoit rien, ni un contenu modifiable qui
// a changé (sa vue le rebâtit de son état), et le développement le dit, une fois par balise
function _mjsRvPut(el, notes, f) {
  var x = notes.shift();
  if (!x) {
    if (f[0] && f[0].isConnected && _mjsRvActive() !== f[0]) _mjsRvFocus(f[0], f[1]);
    return;
  }
  _mjsRvOn(el, x, f);
  // le suivant après le rendu que ces événements ont demandé (une microtâche déjà dans la file)
  queueMicrotask(function() { _mjsRvPut(el, notes, f); });
}

// la note `x` reportée sur l'élément de sa place dans la vue de `el`, s'il est le même ; `f`, l'élément qui reprend le focus et sa sélection
function _mjsRvOn(el, x, f) {
  var n = _mjsRvAt(el, x.p), o = x.n, did = false;
  if (n && n !== o && (n.type !== o.type || n.getAttribute('name') !== o.getAttribute('name') || _mjsRvSig(n, el) !== x.k)) n = null;
  if (!n) return _mjsRvSay(el, 2);
  if ('v' in x && n.value !== x.v) {
    n.value = x.v;
    did     = true;
  }
  if (x.i && n.files !== x.i) {
    try {
      n.files = x.i;
      did     = true;
    }
    catch {
      _mjsRvSay(el, 2);
    }
  }
  // un bouton radio décoché ne dit rien : celui qu'on a coché le dit
  if ('c' in x && n.checked !== x.c) {
    n.checked = x.c;
    did       = x.c || n.type === 'checkbox';
  }
  if (x.s) x.s.forEach(function(v, i) {
    if (n.options[i].selected !== v) {
      n.options[i].selected = v;
      did = true;
    }
  });
  if ('o' in x && n.open !== x.o) n.open = x.o;
  if ('h' in x && _mjsRvTxt(n) !== x.h) _mjsRvSay(el, 2);
  if (x.t) {
    n.scrollTop  = x.t[0];
    n.scrollLeft = x.t[1];
  }
  if (did) {
    n.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    if (x.f && 'v' in x && _mjsRvTape(n)) _mjsRvLater(n);
    else n.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (x.f) f.splice(0, 2, n, x.f[0]);
}
// </reveil-intention>

// le déclencheur de `el` est venu : `el` et les instances de sa page qui attendaient avec lui se réveillent, leurs crochets dans l'ordre de
// la même page sans `@wake` — mise à niveau au démarrage de la page, `el` réveille sa page dans l'ordre des définitions (chaque balise à son
// tour, dans l'ordre du document ; une instance que la construction d'une autre bâtit attend son tour, ses props gardées par le parent jusqu'à
// sa connexion) ; construite plus tard (une branche, une ligne bâties par le client), elle se construit comme la balise sans `@wake`, ses
// enfants dans la foulée. Balise pas encore définie : plus rien ne la retient, elle se construit d'elle-même à l'arrivée de son fichier.
// Avec `interaction`, ce que l'utilisateur a fait dans sa page passe à sa vue, une fois complète : la page des balises qu'elle recrée à la
// place de celles qui attendaient reçue (cf. _mjsRvMatch, en microtâche)
function _mjsRvGo(el) {
  var prev = _mjsRvBatch, q, notes;
  if (!el.hasAttribute('mjs-wake')) return;
  _mjsRvDisarm(el);
  // <reveil-intention>
  notes = el._mjs_wakeCalls && el.getAttribute('mjs-wake') === 'interaction' && µ._mjs_ssrHydrate !== 'b' && µ._mjs_ssrHydrate !== 'c' && _mjsRvNote(el);
  // </reveil-intention>
  el.removeAttribute('mjs-wake');
  if (!el._mjs_wakeCalls) return;
  _mjsRvKeep(el);
  if (!el._mjs_wakeAt) _mjsRvOne(el, null);
  else {
    q = _mjsRvBatch = [el];
    try {
      while (q.length) _mjsRvOne(q.sort(_mjsRvCmp).shift(), q);
    }
    finally {
      _mjsRvBatch = prev;
    }
  }
  // <reveil-intention>
  if (notes) queueMicrotask(function() { _mjsRvPut(el, notes, []); });
  // </reveil-intention>
}

// l'ordre des définitions, noté à chacune ; le démarrage dure jusqu'à la tâche qui suit la dernière
var _mjsRvDef = µ._def;
µ._def = function(tag, C) {
  _mjsRvTypes[tag] ||= ++_mjsRvN;
  clearTimeout(_mjsRvBootT);
  _mjsRvBootT = setTimeout(function() { _mjsRvBoot = 0; });
  return _mjsRvDef(tag, C);
};

// `@wake` sans tout son effet sur la balise de `el`, et le développement le dit, une fois par balise et par raison (`k`) : 0, une balise
// paresseuse sans page du serveur à reprendre, construite au démarrage d'une page rendue par le serveur (elle se construit tout de suite) ; 1,
// une balise sans boîte qui n'affiche que du texte (cf. _mjsRvSee) ; 2, une balise `interaction` dont la vue n'a pas, à sa place, un élément
// où l'utilisateur a fait quelque chose dans la page du serveur (cf. _mjsRvPut). Le texte est posé par le code compilé pour le développement
// (`µ._mjs_wakeLost`, `µ._mjs_wakeText`, `µ._mjs_wakeMiss`), absent en production
function _mjsRvSay(el, k) {
  var n = el.localName;
  if (_mjsRvSaid[k + n]) return;
  _mjsRvSaid[k + n] = 1;
  queueMicrotask(function() {
    var s = [µ._mjs_wakeLost, µ._mjs_wakeText, µ._mjs_wakeMiss][k];
    if (s) console.warn(s.replace('{balise}', n));
  });
}

// à la mise à niveau d'une balise bâtie au client (constructeur de µ.Element), avant tout : une balise paresseuse que la vue d'un composant
// recrée à la place d'une instance de même balise et de même déclencheur qui attendait dans la page qu'il vient de jeter attend à son tour,
// comme une balise du serveur (racine d'ombre ouverte, `mjs-ssr`) ; la page de cette instance y passe dès que la vue est complète (cf.
// _mjsRvMatch). Sans instance à reprendre, `@wake` est sans effet (l'attribut part : la balise n'attend pas). Pendant un réveil dans l'ordre
// des définitions, une balise que la construction d'une instance bâtit attend son tour
µ._mjs_wakeNew = function(el) {
  var how = el.getAttribute('mjs-wake'), host, kept;
  if (µ.server || µ._isServer || el.hasAttribute('mjs-ssr')) return;
  if (how && el.isConnected && (host = _mjsRvHost(el)) && (kept = _mjsRvKept.get(host)) && kept.k.has(el.localName + ' ' + how)) {
    if (!el.hasAttribute('mjs-light') && !el.constructor.mjsLight) el.attachShadow({ mode: 'open' });
    el.setAttribute('mjs-ssr', '');
    el._mjs_wakeTook = 1;
    if (kept.w.push(el) === 1) queueMicrotask(function() { _mjsRvMatch(host); });
    return;
  }
  if (how) {
    if (_mjsRvBoot && _mjsRvSsr) _mjsRvSay(el, 0);
    el.removeAttribute('mjs-wake');
  }
  if (_mjsRvBatch) {
    _mjsRvHold(el);
    _mjsRvBatch.push(el);
  }
};

// à la mise à niveau d'une balise rendue par le serveur, avant qu'elle jette sa page : true si elle attend (la sienne ou celle d'un
// ancêtre) — rien n'est construit, aucun geste pris. Une valeur autre que `view` et `interaction` (écrite à la main dans une page du serveur),
// vide comprise (`mjs-wake` seul), part : la balise se réveille au démarrage, comme sans `@wake`. Sinon, les instances qui attendent dans sa page sont gardées pour sa vue
// neuve
µ._mjs_wakeHold = function(el) {
  var how = el.getAttribute('mjs-wake');
  if (µ.server || µ._isServer || !el.hasAttribute('mjs-ssr')) return false;
  _mjsRvSsr = 1;
  if (how !== 'view' && how !== 'interaction') el.removeAttribute('mjs-wake');
  if (!_mjsRvWaits(el)) {
    _mjsRvKeep(el);
    return false;
  }
  _mjsRvHold(el);
  _mjsRvArm(el);
  return true;
};

// la page d'une instance qui attend n'est pas observée : elle le sera à son réveil
µ._mjs_wakeLater = function(root) {
  var host = root.nodeType === 11 ? root.host : root;
  if (!host || !host._mjs_wakeCalls) return false;
  host._mjs_wakeCalls.push(function() { µ.Autoloader.observe(root); });
  return true;
};

µ._mjs_wakeArm  = _mjsRvArm;
µ._mjs_wakeGone = _mjsRvDisarm;
