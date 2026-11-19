// mjs_wake — le réveil paresseux d'un composant rendu par le serveur : `@wake=view` ou `@wake=interaction` sur sa balise, dans un gabarit
// (attribut `mjs-wake`, posé à la construction et rendu aussi par le serveur). La page du serveur reste affichée, telle quelle, jusqu'au
// réveil : quand la balise paraît à l'écran (IntersectionObserver), ou, avec `interaction` sur une page rendue en `ssr`, `ssr:markers` ou
// `prerender`, au premier signe d'intention sur elle (le pointeur qui y entre, un doigt posé, le focus clavier, ou ce focus déjà en elle) ;
// en `ssr:positional` et `ssr:diff`, `interaction` se réveille comme `view`. Jusque-là, le composant est la page du serveur, comme une
// page qui démarre : aucun geste n'est retenu, annulé, arrêté ni rejoué (le signe d'intention est écouté passivement, le réveil attend la
// fin de son événement), un geste arrivé avant la fin du réveil a l'effet qu'il a dans la page du serveur ; ce que le navigateur fait seul
// (une saisie, une case cochée, un formulaire envoyé) se fait dans la page du serveur. Avec `interaction`, ce que l'utilisateur y a changé
// passe au réveil à la vue, que la vue remplace la page du serveur ou la reprenne : le focus et sa sélection, une saisie, une case, une
// option, un `<details>`, une zone défilée, chacun à la même place dans le gabarit (cf. _mjsWkNote).
// Une balise sans boîte (`display: contents`) ne paraît jamais elle-même à l'écran : elle paraît quand un des enfants qu'elle affiche paraît.
// Une boîte perdue pendant l'attente (une feuille de style, une règle `@media` au redimensionnement), que l'IntersectionObserver ne rapporte
// pas hors de l'écran, est vue par un ResizeObserver.
// Chaque occurrence attend son déclencheur, alors que la balise est définie une fois pour toutes : mise à niveau pendant qu'elle attend,
// l'instance ne construit rien (blocs `<wake-up>` de µ.Element) — ses appels de construction sont retenus, rejoués au réveil. Ce que sa page
// contient attend avec elle, et ses crochets (`µawake`, `µmount`) jouent dans l'ordre de la même page sans `@wake` ; un enfant qui a son
// propre `@wake` attend ensuite le sien.
// La page du serveur n'est gardée que si la balise qui attend en vient : celle du serveur, ou celle que la vue de son parent recrée à la même
// place quand ce parent vient lui-même de la page du serveur (la racine de la page, un composant qui attendait son réveil, un composant repris
// du serveur). Une balise paresseuse bâtie au client sans page à reprendre se construit tout de suite, et le développement le dit.
// Sans rendu serveur, il n'y a pas de page à garder : la balise se construit tout de suite. N'entre au cœur que si une page écrit `@wake`

// les instances qui attendaient dans la page d'un composant qui la jette pour bâtir sa vue (mode `replace`, réveil), rangées par place : la
// balise que sa vue recrée à la même place reprend leur page
var _mjsWkKept = new WeakMap();
// <wake-intent>
// le focus perdu avec la page jetée et sa sélection, que la vue de la balise `interaction` qui a reçu son champ lui rend (cf. _mjsWkMatch)
var _mjsWkFoc = new WeakMap();
// </wake-intent>
// la balise qu'attend chaque enfant observé à la place d'une balise sans boîte (cf. _mjsWkSee)
var _mjsWkFor = new WeakMap();
// le rang de chaque balise dans l'ordre de ses définitions (µ._def) : au démarrage, une balise se définit après celles qui l'affichent, et
// chaque définition met à niveau ses balises dans l'ordre du document ; un réveil suit cet ordre
var _mjsWkTypes = Object.create(null), _mjsWkN = 0;
// pendant un réveil dans l'ordre des définitions : les instances que sa construction bâtit, retenues jusqu'à leur tour
var _mjsWkBatch = null;
// le démarrage d'une page rendue par le serveur dure tant que des définitions arrivent : une balise paresseuse construite alors sans page du
// serveur le dit, une fois par balise (développement)
var _mjsWkBoot = 1, _mjsWkBootT = 0, _mjsWkSsr = 0, _mjsWkSaid = Object.create(null);

// rendue par le serveur et en attente : la balise porte encore `mjs-wake`, ou un de ses ancêtres (à travers les racines d'ombre)
function _mjsWkWaits(n) {
  for (; n; n = n.parentNode || (n.nodeType === 11 ? n.host : null)) {
    if (n.nodeType === 1 && n.hasAttribute('mjs-wake') && n.hasAttribute('mjs-ssr')) return true;
  }
  return false;
}

// la place d'un élément dans l'ordre du document, racines d'ombre comprises (la page d'un hôte avant ses enfants), celui des mises à niveau
// d'une définition
function _mjsWkKey(n) {
  var k = [], p;
  for (; n && (p = n.parentNode); n = p.nodeType === 11 ? p.host : p) k.unshift(p.nodeType === 11 ? -1 : 0, Array.prototype.indexOf.call(p.childNodes, n));
  return k;
}

// l'ordre du démarrage de la page : le rang de la définition, puis la place dans le document
function _mjsWkCmp(a, b) {
  var d = (_mjsWkTypes[a.localName] || 1e9) - (_mjsWkTypes[b.localName] || 1e9), x, y, i;
  if (d) return d;
  x = _mjsWkKey(a);
  y = _mjsWkKey(b);
  for (i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

// les instances qui attendent dans la page de `el`, que sa vue va jeter (mode `replace`, réveil) : rangées par place (`m`), avec leurs sortes
// (balise et déclencheur, `k`), le temps que sa vue les recrée (cf. µ._mjs_wakeNew) ; celles que sa vue reprend telles quelles (modes
// `markers`, `positional`, `diff`) reçoivent leur déclencheur une fois `el` construit
function _mjsWkKeep(el) {
  var root = el._shadow, kept = null, lazy = root && root.querySelectorAll && root.querySelectorAll('[mjs-wake]');
  if (!lazy || !lazy.length) return;
  lazy.forEach(function(c) {
    if (!c.hasAttribute('mjs-ssr') || _mjsWkHost(c) !== el) return;
    kept ||= { m: new Map(), k: new Set(), w: [] };
    kept.m.set(_mjsWkPath(c, root), c);
    kept.k.add(c.localName + ' ' + c.getAttribute('mjs-wake'));
  });
  if (kept) {
    // <wake-intent>
    // le focus, s'il est dans la page jetée, et sa sélection, rendus une fois la page passée à la balise recréée (cf. _mjsWkMatch), comme
    // le défilement des zones de la page d'une instance `interaction`, qu'un nœud déplacé perd
    kept.a = _mjsWkActive();
    kept.s = kept.a && _mjsWkSel(kept.a);
    kept.t = [];
    kept.m.forEach(function(c) {
      if (c.getAttribute('mjs-wake') === 'interaction') _mjsWkEach(c.shadowRoot || c, function(n) { if (n.scrollTop || n.scrollLeft) kept.t.push([n, n.scrollTop, n.scrollLeft]); });
    });
    // </wake-intent>
    _mjsWkKept.set(el, kept);
    setTimeout(function() { _mjsWkKept.delete(el); });
  }
  queueMicrotask(function() { _mjsWkKids(el); });
}

// les instances paresseuses de la page de `el` reçoivent leur déclencheur, `el` construit
function _mjsWkKids(el) {
  var root = el._shadow;
  if (!root || !root.querySelectorAll || el._mjs_wakeCalls) return;
  root.querySelectorAll('[mjs-wake]').forEach(function(c) { if (c._mjs_wakeCalls) _mjsWkArm(c); });
}

// la vue de `host` est complète (ses blocs rendus, les places définitives) : chaque balise recréée qui attend encore sa page la reçoit de
// l'instance du serveur qui occupait sa place — son contenu et ses props écrites par le serveur ; sans instance à sa place, elle n'a rien à
// garder et se réveille tout de suite. Un composant léger ne reçoit que la page du composant, devant le contenu glissé que le client lui a
// déjà donné (cf. _mjsWkPage)
function _mjsWkMatch(host) {
  var kept = _mjsWkKept.get(host), root = host._shadow, lit = [];
  if (!kept) return;
  kept.w.splice(0).forEach(function(el) {
    var key = el._mjs_wakeCalls && el.isConnected && _mjsWkPath(el, root), old = key && kept.m.get(key);
    if (!el._mjs_wakeCalls) return;
    if (!old || old.localName !== el.localName || old.getAttribute('mjs-wake') !== el.getAttribute('mjs-wake')) return _mjsWkGo(el);
    kept.m.delete(key);
    if (el.shadowRoot) el.shadowRoot.append(...(old.shadowRoot || old).childNodes);
    else el.prepend(...(el._mjs_wakePg = _mjsWkPage(el, old)));
    if (old.hasAttribute('mjs-props') && !el.hasAttribute('mjs-props')) el.setAttribute('mjs-props', old.getAttribute('mjs-props'));
    // <wake-intent>
    if (kept.a && el.getAttribute('mjs-wake') === 'interaction' && _mjsWkPath(kept.a, el)) lit.push(el);
    // </wake-intent>
  });
  // <wake-intent>
  // le défilement des zones déplacées leur revient ; le focus perdu avec la page jetée (le champ atteint au clavier, avant le démarrage ou
  // dans un parent qui se réveille) est un signe d'intention : la balise `interaction` qui a reçu son champ se réveille, et sa vue rend le
  // focus à ce champ, avec sa sélection (un nœud déplacé ne le reprend pas toujours aussitôt : sous WebKit, pas avant que la feuille de
  // style `<link>` de sa page soit relue)
  kept.t.forEach(function(x) {
    x[0].scrollTop  = x[1];
    x[0].scrollLeft = x[2];
  });
  lit.forEach(function(el) {
    _mjsWkFoc.set(el, [kept.a, kept.s]);
    _mjsWkGo(el);
  });
  // </wake-intent>
}

// la page de l'instance du serveur `old` que reçoit le composant léger recréé `el`, sans le contenu que la page lui avait glissé (le client
// l'a déjà donné à `el`, avec ses nœuds et ses composants) : ce qui précède le repère `<!--mjs-l-->` (cf. _mjsLightDrop, mjs_element.ts) ;
// sans repère (page rendue sans reprise), tous ses nœuds sauf les derniers, autant que le HTML du contenu glissé du client en donnerait une
// fois relu (un texte vide ne s'écrit pas, des textes voisins n'en font qu'un), comptés sur ses nœuds : aucun HTML n'est écrit ni relu
// (une page sous Trusted Types refuse une chaîne posée par `innerHTML`). Une instance du serveur à racine d'ombre n'a que sa page
function _mjsWkPage(el, old) {
  var ns = Array.from((old.shadowRoot || old).childNodes), i = ns.findIndex(function(n) { return n.nodeType === 8 && n.data === 'mjs-l'; }), n = 0, t = 0, c;
  if (old.shadowRoot) return ns;
  if (i < 0) for (c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 3) t = 0, n++;
    else if (c.data && !t) t = 1, n++;
  }
  return ns.slice(0, i < 0 ? Math.max(0, ns.length - n) : i);
}

// libre de se réveiller : aucun ancêtre n'attend, et le composant dont la page la contient est construit
function _mjsWkFree(el) {
  var h = _mjsWkHost(el);
  return !h || (h.matches(':defined') && !h._mjs_wakeCalls && !_mjsWkWaits(h));
}

// un rapport de l'IntersectionObserver (la vue) ou du ResizeObserver (la taille : une boîte perdue hors de l'écran, que le premier ne
// rapporte pas) sur une balise qui attend, ou sur un élément observé à sa place
function _mjsWkSaw(list) {
  list.forEach(function(e) {
    var t = e.target, el = _mjsWkFor.get(t) || t;
    if (!el.isConnected) _mjsWkDisarm(el);
    else if (e.isIntersecting) _mjsWkGo(el);
    else if (el._mjs_wakeArmed) _mjsWkSee(t, el, !(e.contentRect || e.boundingClientRect).height && _mjsWkDisp(t) === 'contents');
  });
}

// `t` observé, à la vue et à la taille, pour la balise qui attend (elle-même, ou un élément à sa place) ; plus observé avec `off`
function _mjsWkObs(t, off) {
  [µ._mjs_wakeIO, µ._mjs_wakeRO].forEach(function(o) { off ? o.unobserve(t) : o.observe(t); });
}

// le déclencheur de `el` posé, s'il est libre de se réveiller (sinon, son parent le posera à son réveil) : `interaction` sur une page rendue
// en `ssr`, `ssr:markers` ou `prerender` (`µ._mjs_ssrHydrate` ni 'b' ni 'c'), les signes d'intention écoutés sur la balise, à la capture et
// passivement (rien n'est annulé ni arrêté ; un doigt posé passe aussi par `pointerover`, `touchstart` pour un navigateur sans événements de
// pointeur), le premier venu réveille dans la tâche suivante, son événement fini dans la page du serveur ; le focus déjà dans la balise (le
// code arrivé après le premier Tab, le parent que ce focus vient de réveiller) réveille de même, aucun `focusin` ne suivra. Ce que
// l'utilisateur a fait dans sa page passe à sa vue au réveil (cf. _mjsWkNote). Sinon la vue (sur ses enfants quand la balise n'a pas de
// boîte, cf. _mjsWkSee) ; sans IntersectionObserver ou sans ResizeObserver, la balise se réveille tout de suite
function _mjsWkArm(el) {
  var how = el.getAttribute('mjs-wake'), stop, go;
  if (!how || el._mjs_wakeArmed || !el.isConnected || !_mjsWkFree(el)) return;
  el._mjs_wakeArmed = true;
  // <wake-intent>
  if (how === 'interaction' && µ._mjs_ssrHydrate !== 'b' && µ._mjs_ssrHydrate !== 'c') {
    stop = el._mjs_wakeStop = new AbortController();
    go   = function() { _mjsWkDisarm(el); setTimeout(function() { if (el.isConnected) _mjsWkGo(el); }); };
    ['pointerover', 'pointerdown', 'touchstart', 'focusin'].forEach(function(t) { el.addEventListener(t, go, { capture: true, passive: true, signal: stop.signal }); });
    if (el.matches(':focus-within')) go();
    return;
  }
  // </wake-intent>
  if (typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') _mjsWkGo(el);
  else {
    µ._mjs_wakeIO ||= new IntersectionObserver(_mjsWkSaw);
    µ._mjs_wakeRO ||= new ResizeObserver(_mjsWkSaw);
    _mjsWkObs(el);
  }
}

// `t` hors de l'écran, `el` en attente : au premier rapport de la balise, les balises qu'elle affiche sont observées à sa place (celles d'un
// `<slot>` : les balises qu'il affiche) — une balise sans boîte (`display: contents`, `@display="contents"`), ou qui la perd plus tard, n'est
// pas vue par l'IntersectionObserver : le premier de ses enfants qui paraît la réveille, et un enfant sans boîte, d'emblée ou plus tard, passe
// la main aux siens (une fois : la vue et la taille le rapportent toutes deux). Plus rien à observer sous une balise sans boîte (du texte
// seul), au premier rapport ou quand elle perd sa boîte : elle se réveille tout de suite, et le développement le dit. De même pour du texte
// avec des éléments tous cachés (`display: none`, `hidden`) sous une balise sans boîte, d'emblée ou cachés pendant l'attente : seul le texte
// peut paraître, et le navigateur ne dit pas quand (`seen.t` : du texte vu sous la balise, ou sous un enfant sans boîte)
function _mjsWkSee(t, el, nobox) {
  var seen = el._mjs_wakeSeen, i = seen ? seen.indexOf(t) : -1;
  if (t === el ? !seen : nobox && i >= 0) {
    if (t !== el) {
      _mjsWkObs(t, 1);
      seen.splice(i, 1);
    }
    seen = el._mjs_wakeSeen ||= [];
    Array.prototype.forEach.call(t.assignedNodes ? t.assignedNodes({ flatten: true }) : (t._shadow || t.shadowRoot || t).childNodes, function(c) {
      if (c.nodeType === 3) seen.t ||= /\S/.test(c.data);
      else if (c.nodeType === 1 && !_MJS_WK_OUTSIDE[c.tagName]) {
        _mjsWkFor.set(c, el);
        seen.push(c);
        _mjsWkObs(c);
      }
    });
  }
  if (nobox && !seen.length || seen.t && _mjsWkDisp(el) === 'contents' && seen.every(function(c) { return _mjsWkDisp(c) === 'none'; })) {
    _mjsWkSay(el, 1);
    _mjsWkGo(el);
  }
}

// le `display` calculé de `n`
function _mjsWkDisp(n) {
  return getComputedStyle(n).display;
}

// le déclencheur retiré : réveil fait ou en route (signe d'intention reçu), ou balise sortie de la page avant son réveil (rien ne la retient
// plus)
function _mjsWkDisarm(el) {
  if (!el._mjs_wakeArmed) return;
  el._mjs_wakeArmed = false;
  if (el._mjs_wakeStop) el._mjs_wakeStop.abort();
  if (µ._mjs_wakeRO) {
    _mjsWkObs(el, 1);
    if (el._mjs_wakeSeen) el._mjs_wakeSeen.forEach(function(c) { _mjsWkObs(c, 1); _mjsWkFor.delete(c); });
    el._mjs_wakeSeen = null;
  }
}

// rien n'est construit : chaque appel de construction de `el` retenu, rejoué tel quel au réveil (tous ses arguments : le second de
// `_mjs_mount`, posé par le compilateur pour un composant qui livre des props aux composants de sa racine, lui fait garder son contenu
// jusqu'à leur remise, comme sans `@wake`), et le parent lui garde ses props (µ._mjs_pend), comme à une balise pas encore mise à niveau.
// Écrits en propriétés, jamais par leur nom en chaîne : le minifieur de production raccourcit les noms `_mjs_*` du code, pas ceux d'une
// chaîne. `_mjs_wakeAt` : mise à niveau au démarrage de la page (pendant une définition, ou pendant un réveil qui en suit l'ordre)
function _mjsWkHold(el) {
  var calls           = el._mjs_wakeCalls = [];
  el._mjs_wakeAt      = !!(µ._mjs_defining || _mjsWkBatch);
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
function _mjsWkOne(el, q) {
  var calls = el._mjs_wakeCalls, prev = _mjsWkBatch, kids = [];
  if (!calls) return;
  delete el._mjs_wakeCalls;
  delete el._mjs_mount;
  delete el._mjs_injectSlots;
  delete el._mjs_bindEvents;
  delete el.init;
  delete el._set;
  if (el._mjs_wakeTook) el._mjs_ssrAdopt = false;
  // <server-input>
  if (el.hasAttribute('mjs-ssr')) _mjsTypedTake(el);
  // </server-input>
  // la page du serveur jetée comme le ferait le constructeur : toujours pour un composant léger, jamais pour une vue que le mode reprend ; un
  // composant léger garde le contenu que sa page lui a glissé (`µ._mjs_lightDrop`, mjs_element.ts, présent avec la reprise du serveur) ;
  // l'instance recréée par le client ne jette que la page reçue de celle du serveur (cf. _mjsWkMatch), le contenu glissé qu'il lui a donné reste
  if (el.hasAttribute('mjs-ssr') && (el._mjs_wakeTook || el._mjs_isLight || !µ._mjs_ssrHydrate)) {
    if (!el._mjs_isLight) el._shadow.replaceChildren();
    else if (el._mjs_wakeTook) (el._mjs_wakePg || []).splice(0).forEach(function(n) { n.remove(); });
    else if (!µ._mjs_lightDrop?.(el)) el.replaceChildren();
  }
  _mjsWkBatch = q;
  try {
    calls.forEach(function(c) { c(); });
  }
  finally {
    _mjsWkBatch = prev;
  }
  if (el.isConnected) el.connectedCallback();
  new Set([el._shadow, el]).forEach(function(r) {
    if (r && r.querySelectorAll) r.querySelectorAll('[mjs-ssr]').forEach(function(c) {
      if (!c._mjs_wakeCalls || _mjsWkHost(c) !== el || (q && q.includes(c))) return;
      if (c.hasAttribute('mjs-wake')) _mjsWkArm(c);
      else (q || kids).push(c);
    });
  });
  kids.forEach(function(c) { _mjsWkOne(c, null); });
}

// <wake-intent>
// l'élément qui a le focus, au fond des racines d'ombre (celle d'un composant fermé comprise)
function _mjsWkActive() {
  var a = document.activeElement, r;
  while (a && (r = a._shadow || a.shadowRoot) && r.activeElement) a = r.activeElement;
  return a;
}

// la sélection d'un champ de texte (début, fin, sens) ; null pour une balise qui n'en a pas (case, liste, champ nombre…)
function _mjsWkSel(n) {
  try {
    return n.selectionStart == null ? null : [n.selectionStart, n.selectionEnd, n.selectionDirection];
  }
  catch {
    return null;
  }
}

// le focus rendu à `n`, sans défilement, et sa sélection `s` ; la mise en page d'abord : sous WebKit, un champ d'un composant né dans la
// même tâche (la balise qu'un parent réveillé vient de recréer) n'est pas focalisable avant elle
function _mjsWkFocus(n, s) {
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
function _mjsWkEach(root, f) {
  root.querySelectorAll('*').forEach(function(n) {
    var r = n._shadow || n.shadowRoot;
    f(n);
    if (r && r !== n) _mjsWkEach(r, f);
  });
}

// le texte d'un contenu modifiable, blancs réduits
function _mjsWkTxt(n) {
  return n.textContent.replace(/\s+/g, ' ').trim();
}

// ce que l'utilisateur a fait dans la page de `el` avant son réveil, relevé avant que sa vue la remplace ou la reprenne, chaque élément par sa
// place depuis `el` (cf. _mjsWkPath), la même dans la page du serveur et dans la vue, bâties du même gabarit, et par sa marque (`k`, cf.
// _mjsWkSig) : la saisie d'un champ (`v`, autre que sa valeur écrite dans la page), les fichiers choisis (`i`), une case ou un bouton radio
// (`c`), les options d'une liste (`s`), l'ouverture d'un `<details>` (`o`, comparée à la vue : le navigateur n'en garde pas l'état de
// départ), le texte d'un contenu modifiable (`h`, comparé à la vue : il n'est pas reporté), le défilement d'une zone (`t`), le focus et sa
// sélection (`f`) ; les pages des composants qu'elle contient comprises. null sans rien à reporter
function _mjsWkNote(el) {
  var w = _mjsWkFoc.get(el) || [_mjsWkActive()], out = [];
  _mjsWkFoc.delete(el);
  _mjsWkEach(el._shadow || el, function(n) {
    var t = n.type, box = t === 'checkbox' || t === 'radio', x = { n: n };
    if (n === w[0]) x.f = [w.length > 1 ? w[1] : _mjsWkSel(n)];
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
    if (n.isContentEditable && !(n.parentElement && n.parentElement.isContentEditable)) x.h = _mjsWkTxt(n);
    if (n.scrollTop || n.scrollLeft) x.t = [n.scrollTop, n.scrollLeft];
    if (Object.keys(x).length > 1) {
      x.p = _mjsWkPath(n, el);
      x.k = _mjsWkSig(n, el);
      out.push(x);
    }
  });
  return out.length ? out : null;
}

// un champ de texte : le navigateur n'y envoie `change` qu'à la sortie du champ
function _mjsWkTape(n) {
  return n.tagName === 'TEXTAREA' || /^(text|search|email|url|tel|password|number)$/.test(n.type);
}

// `change` envoyé à la sortie du champ `n`, comme le navigateur l'aurait fait pour la saisie reportée, s'il ne l'a pas envoyé lui-même avant
function _mjsWkLater(n) {
  var seen = false;
  n.addEventListener('change', function() { seen = true; }, { once: true });
  n.addEventListener('blur', function() { if (!seen) n.dispatchEvent(new Event('change', { bubbles: true })); }, { once: true });
}

// ce que relève _mjsWkNote, reporté sur l'élément de même place dans la vue de `el` (rien ne change là où la vue l'a déjà) : le composant
// l'apprend comme si l'utilisateur venait de le faire, par `input` puis `change` (pour un champ de texte qui garde le focus, `change` à sa
// sortie, la saisie y continue), par `toggle` pour un `<details>` ; le focus rendu en dernier (`f`), avec sa sélection. Un élément par
// microtâche, cherché à son tour, la vue rendue après les événements du précédent (le gestionnaire d'un filtre a pu rebâtir la liste qui
// suit) : une place où la vue n'a pas l'élément de la page du serveur (une autre balise, un autre type ou nom de champ, une autre marque : le
// serveur et le navigateur rendent là un contenu différent, ou un gestionnaire a changé la vue) ne reçoit rien, ni un contenu modifiable qui
// a changé (sa vue le rebâtit de son état), et le développement le dit, une fois par balise
function _mjsWkPut(el, notes, f) {
  var x = notes.shift();
  if (!x) {
    if (f[0] && f[0].isConnected && _mjsWkActive() !== f[0]) _mjsWkFocus(f[0], f[1]);
    return;
  }
  _mjsWkOn(el, x, f);
  // le suivant après le rendu que ces événements ont demandé (une microtâche déjà dans la file)
  queueMicrotask(function() { _mjsWkPut(el, notes, f); });
}

// la note `x` reportée sur l'élément de sa place dans la vue de `el`, s'il est le même ; `f`, l'élément qui reprend le focus et sa sélection
function _mjsWkOn(el, x, f) {
  var n = _mjsWkAt(el, x.p), o = x.n, did = false;
  // le nom du champ est dans sa marque (cf. _mjsWkSig), sauf celui que le framework donne à un groupe `:group` sans `name`, que le serveur
  // et le navigateur ne tirent pas toujours pareil
  if (n && n !== o && (n.type !== o.type || _mjsWkSig(n, el) !== x.k)) n = null;
  if (!n) return _mjsWkSay(el, 2);
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
      _mjsWkSay(el, 2);
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
  if ('h' in x && _mjsWkTxt(n) !== x.h) _mjsWkSay(el, 2);
  if (x.t) {
    n.scrollTop  = x.t[0];
    n.scrollLeft = x.t[1];
  }
  if (did) {
    n.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    if (x.f && 'v' in x && _mjsWkTape(n)) _mjsWkLater(n);
    else n.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (x.f) f.splice(0, 2, n, x.f[0]);
}
// </wake-intent>

// le déclencheur de `el` est venu : `el` et les instances de sa page qui attendaient avec lui se réveillent, leurs crochets dans l'ordre de
// la même page sans `@wake` — mise à niveau au démarrage de la page, `el` réveille sa page dans l'ordre des définitions (chaque balise à son
// tour, dans l'ordre du document ; une instance que la construction d'une autre bâtit attend son tour, ses props gardées par le parent jusqu'à
// sa connexion) ; construite plus tard (une branche, une ligne bâties par le client), elle se construit comme la balise sans `@wake`, ses
// enfants dans la foulée. Balise pas encore définie : plus rien ne la retient, elle se construit d'elle-même à l'arrivée de son fichier.
// Avec `interaction`, ce que l'utilisateur a fait dans sa page passe à sa vue, une fois complète : la page des balises qu'elle recrée à la
// place de celles qui attendaient reçue (cf. _mjsWkMatch, en microtâche)
function _mjsWkGo(el) {
  var prev = _mjsWkBatch, q, notes;
  if (!el.hasAttribute('mjs-wake')) return;
  _mjsWkDisarm(el);
  // <wake-intent>
  notes = el._mjs_wakeCalls && el.getAttribute('mjs-wake') === 'interaction' && µ._mjs_ssrHydrate !== 'b' && µ._mjs_ssrHydrate !== 'c' && _mjsWkNote(el);
  // </wake-intent>
  // <server-input>
  // la saisie que ce réveil reporte lui-même, par ses événements, n'est pas relevée une seconde fois (cf. _mjsTypedTake)
  if (notes) notes.forEach(function(x) { _mjsTypedNo.add(x.n); });
  // </server-input>
  el.removeAttribute('mjs-wake');
  if (!el._mjs_wakeCalls) return;
  _mjsWkKeep(el);
  if (!el._mjs_wakeAt) _mjsWkOne(el, null);
  else {
    q = _mjsWkBatch = [el];
    try {
      while (q.length) _mjsWkOne(q.sort(_mjsWkCmp).shift(), q);
    }
    finally {
      _mjsWkBatch = prev;
    }
  }
  // <wake-intent>
  if (notes) queueMicrotask(function() { _mjsWkPut(el, notes, []); });
  // </wake-intent>
}

// l'ordre des définitions, noté à chacune ; le démarrage dure jusqu'à la tâche qui suit la dernière
var _mjsWkDef = µ._def;
µ._def = function(tag, C) {
  _mjsWkTypes[tag] ||= ++_mjsWkN;
  clearTimeout(_mjsWkBootT);
  _mjsWkBootT = setTimeout(function() { _mjsWkBoot = 0; });
  return _mjsWkDef(tag, C);
};

// `@wake` sans tout son effet sur la balise de `el`, et le développement le dit, une fois par balise et par raison (`k`) : 0, une balise
// paresseuse sans page du serveur à reprendre, construite au démarrage d'une page rendue par le serveur (elle se construit tout de suite) ; 1,
// une balise sans boîte qui n'affiche que du texte (cf. _mjsWkSee) ; 2, une balise `interaction` dont la vue n'a pas, à sa place, un élément
// où l'utilisateur a fait quelque chose dans la page du serveur (cf. _mjsWkPut). Le texte est posé par le code compilé pour le développement
// (`µ._mjs_wakeLost`, `µ._mjs_wakeText`, `µ._mjs_wakeMiss`), absent en production
function _mjsWkSay(el, k) {
  var n = el.localName;
  if (_mjsWkSaid[k + n]) return;
  _mjsWkSaid[k + n] = 1;
  queueMicrotask(function() {
    var s = [µ._mjs_wakeLost, µ._mjs_wakeText, µ._mjs_wakeMiss][k];
    if (s) console.warn(s.replace('{tag}', n));
  });
}

// à la mise à niveau d'une balise bâtie au client (constructeur de µ.Element), avant tout : une balise paresseuse que la vue d'un composant
// recrée à la place d'une instance de même balise et de même déclencheur qui attendait dans la page qu'il vient de jeter attend à son tour,
// comme une balise du serveur (racine d'ombre ouverte, `mjs-ssr`) ; la page de cette instance y passe dès que la vue est complète (cf.
// _mjsWkMatch). Sans instance à reprendre, `@wake` est sans effet (l'attribut part : la balise n'attend pas). Pendant un réveil dans l'ordre
// des définitions, une balise que la construction d'une instance bâtit attend son tour
µ._mjs_wakeNew = function(el) {
  var how = el.getAttribute('mjs-wake'), host, kept;
  if (µ.server || µ._isServer || el.hasAttribute('mjs-ssr')) return;
  if (how && el.isConnected && (host = _mjsWkHost(el)) && (kept = _mjsWkKept.get(host)) && kept.k.has(el.localName + ' ' + how)) {
    if (!el.hasAttribute('mjs-light') && !el.constructor.mjsLight) el.attachShadow({ mode: 'open' });
    el.setAttribute('mjs-ssr', '');
    el._mjs_wakeTook = 1;
    if (kept.w.push(el) === 1) queueMicrotask(function() { _mjsWkMatch(host); });
    return;
  }
  if (how) {
    if (_mjsWkBoot && _mjsWkSsr) _mjsWkSay(el, 0);
    el.removeAttribute('mjs-wake');
  }
  if (_mjsWkBatch) {
    _mjsWkHold(el);
    _mjsWkBatch.push(el);
  }
};

// à la mise à niveau d'une balise rendue par le serveur, avant qu'elle jette sa page : true si elle attend (la sienne ou celle d'un
// ancêtre) — rien n'est construit, aucun geste pris. Une valeur autre que `view` et `interaction` (écrite à la main dans une page du serveur),
// vide comprise (`mjs-wake` seul), part : la balise se réveille au démarrage, comme sans `@wake`. Sinon, les instances qui attendent dans sa page sont gardées pour sa vue
// neuve
µ._mjs_wakeHold = function(el) {
  var how = el.getAttribute('mjs-wake');
  if (µ.server || µ._isServer || !el.hasAttribute('mjs-ssr')) return false;
  _mjsWkSsr = 1;
  if (how !== 'view' && how !== 'interaction') el.removeAttribute('mjs-wake');
  if (!_mjsWkWaits(el)) {
    _mjsWkKeep(el);
    return false;
  }
  _mjsWkHold(el);
  _mjsWkArm(el);
  return true;
};

// la page d'une instance qui attend n'est pas observée : elle le sera à son réveil
µ._mjs_wakeLater = function(root) {
  var host = root.nodeType === 11 ? root.host : root;
  if (!host || !host._mjs_wakeCalls) return false;
  host._mjs_wakeCalls.push(function() { µ.Autoloader.observe(root); });
  return true;
};

µ._mjs_wakeArm  = _mjsWkArm;
µ._mjs_wakeGone = _mjsWkDisarm;
