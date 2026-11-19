// mjs_ujs.ts
// LRU borné (µ.LRUCache, défini dans mjs_page_cache.ts) : avant, une Map sans limite
// retenait UN ARBRE DOM COMPLET (composants + shadow + listeners) par page
// visitée, à vie. 10 pages = le confort SPA sans la dérive mémoire.
// >>> extrait-test pageCache-init
µ.pageCache = typeof µ.LRUCache === 'function' ? new µ.LRUCache(10) : new Map();
// <<< extrait-test pageCache-init

// Jeton de séquence anti-course : deux clics rapprochés lançaient deux fetchs
// concurrents, et le DERNIER ARRIVÉ (pas le dernier cliqué) gagnait le DOM —
// avec, avant, un pushState exécuté au retour réseau → URL et contenu
// désynchronisés. Le pushState part désormais AU CLIC (comme Turbo) et tout
// callback périmé est jeté.
µ._mjs_navSeq = 0;

// Abandon RÉEL (pas seulement ignoré) du fetch de navigation précédent :
// AVANT, `_mjs_navSeq` jetait la RÉPONSE périmée mais le TRANSFERT continuait
// (bande passante/serveur sollicités pour rien). Un AbortController PAR
// NAVIGATION, remplacé à CHAQUE nouvelle interception (clic/soumission/
// popstate refetch/lien mjs-method) — le préchargement (_mjs_preloadCache) n'est
// PAS concerné, lui seul. `_request` (mjs_ajax.ts) traite un abandon PILOTÉ
// PAR CE SIGNAL comme un chemin SILENCIEUX (ni erreur console, ni callback
// error) — voir son commentaire.
// >>> extrait-test _mjs_navController
µ._mjs_navController = null;
// <<< extrait-test _mjs_navController
// >>> extrait-test _mjs_abortStaleNav
µ._mjs_abortStaleNav = function() {
  if (µ._mjs_navController) {
    try { µ._mjs_navController.abort(); } catch {}
  }
  µ._mjs_navController = typeof AbortController === 'function' ? new AbortController() : null;
  return µ._mjs_navController;
};
// <<< extrait-test _mjs_abortStaleNav

// Chemin (pathname+search) de la page actuellement AFFICHÉE. Nécessaire au
// popstate pour mettre en cache la page QUITTÉE (window.location a déjà
// changé quand l'événement tire).
µ._mjs_lastUjsPath = window.location.pathname + window.location.search;

// Sauvegarde/restauration du scroll par page (standard Turbo/SvelteKit) :
// le swap manuel du DOM échappe au scrollRestoration natif du navigateur.
// Map SANS BORNE : une session SPA
// longue durée qui visite de nombreuses URLs distinctes (back/forward,
// pagination) accumulait une entrée par page, POUR TOUJOURS — même dérive
// que pageCache/_mjs_preloadCache avant leur passage en LRU. Contrairement à
// pageCache, cette Map n'est PAS purgée en même temps que pageCache s'évince
// (une position de scroll reste utile même après éviction du DOM hiberné :
// le cache-MISS réseau du popstate restaure quand même le scroll une fois
// la page re-fetchée, cf. `_mjs_restoreScroll` plus bas) — borne INDÉPENDANTE,
// large (entrées minuscules : juste 2 nombres par page).
// >>> extrait-test _mjs_scrollPos
µ._mjs_scrollPos = typeof µ.LRUCache === 'function' ? new µ.LRUCache(50) : new Map();
// <<< extrait-test _mjs_scrollPos

// `history.scrollRestoration` n'était
// JAMAIS mis à 'manual' : le commentaire ci-dessus affirmait déjà que le
// natif du navigateur ne convient pas à un swap DOM manuel, mais sans cette
// ligne, il restait actif EN PARALLÈLE de `_mjs_saveScroll`/`_mjs_restoreScroll` —
// sur un retour arrière, le navigateur restaure D'ABORD sa propre position
// mémorisée, puis notre code écrase IMMÉDIATEMENT avec la sienne : un
// double-scroll/flash au lieu d'un seul mouvement net, surtout visible sur
// machine lente si un paint a le temps de se produire entre les deux.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

// Éviction LRU du pageCache : l'arbre parqué avait été EXEMPTÉ de destruction
// (hibernation). Abandonné pour de bon, ses teardowns doivent tourner — sinon
// chaque timer posé en @mount fuyait à vie (précisément ce que le LRU borne).
// >>> extrait-test pageCache-onEvict
µ.pageCache.onEvict = function(_path, nodes) {
  var i;
  if (Array.isArray(nodes)) {
    for (i = 0; i < nodes.length; i++) { if (nodes[i] && nodes[i].nodeType === 1) { µ._mjs_destroyEvictedTree(nodes[i]); } }
  } else if (nodes && nodes.nodeType === 1) {
    // défense : une valeur élément seul (ancien format, ou appelant externe) reste tolérée.
    µ._mjs_destroyEvictedTree(nodes);
  }
};
// <<< extrait-test pageCache-onEvict
// l'entrée courante que donne `window.navigation`, quoi qu'elle soit : l'API Navigation, que MJS l'ait reconnue ou non au
// chargement (seule l'interception en dépend), une cale, un élément ; aucune quand elle manque ou ne se lit pas (`Proxy`
// de l'API dont l'accesseur refuse le récepteur)
µ._mjs_navEntry = function() {
  try { return window.navigation.currentEntry; } catch { /* aucune entrée lisible */ }
};
// la position, sous l'adresse de la page ; celle d'une entrée de la page (ancre, route `#/…`, entrée sans fragment :
// adresse avec `#`), sous le nom que le navigateur donne à l'entrée quittée quand il le donne (µ._mjs_navEntry ; sa clé
// survit à `replaceState`, au rechargement et au retour) : deux entrées de même adresse, une ancre suivie deux fois,
// gardent chacune la leur
µ._mjs_saveScroll = function(path) {
  var entry = µ._mjs_navEntry();
  µ._mjs_scrollPos.set(entry && path.indexOf('#') !== -1 ? path + ' ' + entry.key : path, [window.scrollX, window.scrollY]);
};
// le nom sous lequel retrouver la position d'une entrée de la page (`path` : adresse avec `#`) : l'adresse et le nom que
// le navigateur donne à l'entrée ; quand il ne le donne pas (WebKit l'oublie pour les entrées d'une page rechargée après
// un retour jusqu'à la première entrée de l'onglet), la dernière position gardée pour cette adresse
µ._mjs_entryKey = function(path) {
  var entry = µ._mjs_navEntry(), key = path;
  if (entry) { return path + ' ' + entry.key; }
  (µ._mjs_scrollPos._map || µ._mjs_scrollPos).forEach(function(_p, k) { if (k === path || k.lastIndexOf(path + ' ', 0) === 0) { key = k; } });
  return key;
};
// les positions traversent le chargement complet (F5, retour sur une page quittée par une navigation complète) : rangées
// dans sessionStorage au départ de la page (les 50 du cache, sauf celle d'une adresse — chemin, paramètres et fragment,
// sans le nom de l'entrée ni le `#` d'une entrée sans fragment — de plus de 2 048 caractères), avec celle de l'entrée
// quittée — sauf quand l'adresse est déjà celle d'une navigation en vol, sur le contenu d'avant ; reprises au chargement
window.addEventListener('pagehide', function() {
  var loc = window.location, all = [];
  if (loc.pathname + loc.search === µ._mjs_lastUjsPath) { µ._mjs_saveScroll(loc.pathname + loc.search + (loc.hash || '#')); }
  try {
    (µ._mjs_scrollPos._map || µ._mjs_scrollPos).forEach(function(p, k) { if (k.split(' ')[0].replace(/#$/, '').length <= 2048) { all.push([k, p[0], p[1]]); } });
    sessionStorage.setItem('mjs-scroll', JSON.stringify(all.slice(-50)));
  } catch { /* stockage refusé ou plein : les positions ne durent que le temps de la page */ }
});
try {
  JSON.parse(sessionStorage.getItem('mjs-scroll') || '[]').forEach(function(p) {
    if (Array.isArray(p) && typeof p[0] === 'string') { µ._mjs_scrollPos.set(p[0], [Number(p[1]) || 0, Number(p[2]) || 0]); }
  });
} catch { /* stockage refusé ou illisible : aucune position reprise */ }
// position gardée de l'entrée que la page retrouve en se chargeant, au rechargement et au retour (ou à l'avance) sur une
// entrée déjà vue — jamais une entrée neuve (lien, adresse tapée), qui part de son ancre ou du haut : celle de l'entrée,
// à défaut celle de sa page quittée par un lien de la navigation ; null sinon
µ._mjs_keptEntryPos = function() {
  var loc = window.location, nav;
  try { nav = performance.getEntriesByType('navigation')[0]; } catch { nav = null; }
  if (!nav || (nav.type !== 'reload' && nav.type !== 'back_forward')) { return null; }
  return µ._mjs_scrollPos.get(µ._mjs_entryKey(loc.pathname + loc.search + (loc.hash || '#'))) || µ._mjs_scrollPos.get(loc.pathname + loc.search) || null;
};
// >>> extrait-test _mjs_restoreScroll
µ._mjs_restoreScroll = function(path, follow) {
  var p, x, y, href, arrive;
  p = µ._mjs_scrollPos.get(path);
  x = p ? p[0] : 0;
  y = p ? p[1] : 0;
  // `follow` : page redemandée au serveur au retour (Précédent, Suivant, page absente du cache) — ses composants se
  // peignent après la reprise : la position est tenue par le suivi (µ._mjs_anchorArrive), qui coupe l'ancrage de
  // défilement du navigateur le temps qu'elle tient ; reprise d'un coup, le contenu peint au-dessus la décalait de sa
  // hauteur. À l'image suivante comme sans suivi (après la suite de la navigation : routeur, `mjs:load`), et seulement
  // si l'adresse est encore celle de la page
  if (follow && typeof µ._mjs_anchorArrive === 'function') {
    href   = window.location.href;
    arrive = function() { if (window.location.href === href) { µ._mjs_anchorArrive([x, y]); } };
    if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(arrive); }
    else { arrive(); }
    return;
  }
  // appelé JUSTE APRÈS un `replaceWith`
  // (cache-hit) ou la fin d'un fetch réseau (cache-miss, sans `follow`) : dans le cas
  // cache-miss surtout, les composants du nouvel arbre viennent de se
  // connecter et peuvent ne pas avoir terminé leur rendu initial (effets
  // réactifs, sous-composants) — la page n'a pas encore sa hauteur finale, et
  // `scrollTo(x, y)` se fait CLAMPER à la hauteur (trop petite) du moment,
  // au lieu de la position réellement mémorisée. Report d'une frame (même
  // idiome que `_mjs_scanEager` plus bas) : laisse le navigateur peindre le
  // contenu inséré avant de scroller. `instant` : une position rendue ne glisse pas, même sous `scroll-behavior: smooth`
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function() { window.scrollTo({ left: x, top: y, behavior: 'instant' }); });
  } else {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
};
// <<< extrait-test _mjs_restoreScroll

µ.realTarget = function(e) {
  if (typeof e.composedPath === 'function') {
    return e.composedPath()[0];
  } else {
    return e.target;
  }
};

// point d'accroche remplaçable de la confirmation @confirm (mjs-confirm) — une
// modale personnalisée réassigne µ.confirm(message, élément) directement : cette
// réassignation PRIME TOUJOURS (elle écrase la fonction par défaut ci-dessous),
// quelle que soit µ.config.confirm ; retour booléen synchrone OU promesse de
// booléen (thenable, cf. gates clic/submit plus bas). Le défaut, lui, ROUTE par
// µ.config.confirm (mjs_init.ts) : false (ou absent/null/undefined) → window.confirm
// natif, accepté d'office si absent (comportement historique conservé À L'IDENTIQUE) ;
// true → modale maison µ.modal.fire (mjs_modal.ts, module optionnel 'modal' — cf.
// bundler/index.ts CANONICAL) ; µ.modal absent du build (sélection `runtime` explicite
// sans 'modal') → repli natif défensif, jamais un crash. Toute AUTRE valeur (ancien
// branchement 'sweetalert2'/classe-objet custom, RETIRÉ — plus de porte de sortie vers
// un adaptateur externe) → repli natif, avec UN SEUL µ.warn par session (pas un par clic).
// >>> extrait-test confirm-default
var _confirmCfgWarned = false;
µ.confirm = function(message, el) {
  var v = µ.config && µ.config.confirm;
  // forme OBJET (mjs-confirm=text/ok/cancel, cf. transpiler @confirm=objet) : JSON STRICT posé
  // par le compilateur, reconnu ICI à son premier caractère (une accolade ouvrante). Parse SOUS TRY :
  // un texte brut qui commence banalement par une accolade (jamais produit par notre compilo, mais un
  // back qui poserait l'attribut À LA MAIN reste possible) retombe simplement sur le texte tel quel,
  // jamais un crash.
  // Une réassignation DIRECTE de µ.confirm par l'application (prime toujours, cf. bandeau ci-dessus)
  // reçoit TOUJOURS `message` BRUT (chaîne ou JSON non parsé) — ce parsing n'existe que dans cette
  // implémentation par défaut.
  var text = message, confirmButtonText, cancelButtonText;
  // code 123 = accolade ouvrante (jamais le caractère littéral ICI : ce fichier s'extrait par
  // comptage naïf d'accolades dans les tests, cf. tests/ujs-*.test.ts — un caractère isolé,
  // même en commentaire, fausserait le compte et ferait déborder l'extraction).
  if (typeof message === 'string' && message.charCodeAt(0) === 123) {
    try {
      var parsed = JSON.parse(message);
      if (parsed && typeof parsed === 'object') {
        text = parsed.text;
        if (parsed.ok) { confirmButtonText = parsed.ok; }
        if (parsed.cancel) { cancelButtonText = parsed.cancel; }
      }
    } catch { /* texte brut : JSON invalide, `text` reste `message` tel quel */ }
  }
  if (v === true) {
    if (µ.modal && typeof µ.modal.fire === 'function') {
      var opts = { text: text, icon: 'question', showCancelButton: true };
      if (confirmButtonText) { opts.confirmButtonText = confirmButtonText; }
      if (cancelButtonText) { opts.cancelButtonText = cancelButtonText; }
      return µ.modal.fire(opts).then(function(r) { return !!r.isConfirmed; });
    }
    if (!_confirmCfgWarned) {
      _confirmCfgWarned = true;
      µ.warn(µ._mjs_msg('ujsConfirmNoModal', null, 'µ.config.confirm = true mais µ.modal est absent (module \'modal\' non inclus dans `runtime`) — repli sur window.confirm.'));
    }
    return typeof window.confirm === 'function' ? window.confirm(text) : true;
  }
  if (v != null && v !== false && !_confirmCfgWarned) {
    _confirmCfgWarned = true;
    µ.warn(µ._mjs_msg('ujsConfirmValue', null, 'µ.config.confirm attend désormais true/false (l\'ancien \'sweetalert2\'/objet n\'existe plus) — repli sur window.confirm.'));
  }
  return typeof window.confirm === 'function' ? window.confirm(text) : true;
};
// <<< extrait-test confirm-default

// chemin (pathname+search) de la
// destination FINALE après tout redirect serveur suivi NATIVEMENT par fetch
// (`finalUrl` = response.url). Repli sur `fallback` si absent ou cross-origin
// (on ne pilote pas une URL hors de notre origine). Partagé clic/popstate.
// >>> extrait-test _mjs_finalPathFor
µ._mjs_finalPathFor = function(finalUrl, fallback) {
  if (!finalUrl) { return fallback; }
  try {
    var u = new URL(finalUrl, window.location.href);
    if (u.origin !== window.location.origin) { return fallback; }
    return u.pathname + u.search;
  } catch { return fallback; }
};
// <<< extrait-test _mjs_finalPathFor

// NAVIGATION COMPLÈTE de repli (clic cross-page) : l'URL a DÉJÀ été poussée au
// clic — si la destination EST l'URL courante et porte un hash, réassigner
// `location.href` ne recharge RIEN (navigation same-document : le navigateur
// vise juste l'ancre) → page inchangée en silence. Seul `reload()` force alors
// un vrai chargement ; sinon, navigation dure classique.
// >>> extrait-test _mjs_hardNav
µ._mjs_hardNav = function(destination) {
  var url, href;
  try { url = new URL(destination, window.location.href); href = url.href; } catch { url = null; href = destination; }
  // même garde de protocole que µ._mjs_navApplyJson, posée ICI en défense en profondeur
  // (µ._mjs_hardNav a d'autres appelants, cf. le repli cross-page ci-dessus) : seul http(s) part vers
  // location.href — une destination `javascript:`/`data:`/`blob:`… EXÉCUTAIT le script au lieu de
  // naviguer (prouvé Chromium, régression).
  if (url && url.protocol !== 'http:' && url.protocol !== 'https:') {
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsHardNavProtocol', { destination: destination }, 'navigation dure refusée, protocole non http/https : {destination}'));
    return;
  }
  if (href === window.location.href) { return window.location.reload(); }
  return window.location.href = destination;
};
// <<< extrait-test _mjs_hardNav

// la navigation vers le serveur demandée sans le module ajax au cœur (la construction ne l'a pas vue : un lien `/x` de la page
// hôte ou d'un script extérieur) : vrai, et l'appelant laisse partir le navigateur ; dit une fois quoi ajouter à la liste `"runtime"`
µ._mjs_navNoAjax = function() {
  if (typeof µ._mjs_ajaxRequest === 'function') { return false; }
  if (!µ._mjs_navNoAjaxSaid) {
    µ._mjs_navNoAjaxSaid = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsNoAjaxNav', null, 'navigation vers le serveur sans le module ajax : le navigateur charge la page. Pour la navigation de MJS, ajoutez "ujs", "ajax" et "modal" à la liste "runtime" de mjs.config.json.'));
  }
  return true;
};

// FOCUS APRÈS SWAP (accessibilité, cf. Turbo/SvelteKit) : un lecteur d'écran
// ne suit PAS un remplacement de contenu sans un focus explicite — sans lui,
// le focus reste sur l'ancien lien cliqué (détaché du DOM) ou nulle part.
// Traverse aussi les shadow roots (`_shadow`, même convention que
// `µ._mjs_destroyEvictedTree`, mjs_page_cache.ts) : le contenu MJS vit en shadow,
// invisible à un `querySelector` natif depuis la lumière — d'où un walk dédié
// plutôt qu'un simple `root.querySelector(sel)`. Partagé clic/popstate/submit.
// >>> extrait-test _mjs_deepFind
// `ok` (facultatif) : un nœud qui répond au sélecteur n'est rendu que s'il l'accepte, sinon la recherche continue
µ._mjs_deepFind = function(node, selector, depth, ok) {
  if (!node || depth > 50) { return null; }
  if (µ._mjs_matches(node, selector) && (!ok || ok(node))) { return node; }
  var kids = node.children, i, found;
  if (kids) {
    for (i = 0; i < kids.length; i++) {
      found = µ._mjs_deepFind(kids[i], selector, depth + 1, ok);
      if (found) { return found; }
    }
  }
  if (node._shadow && node._shadow !== node && node._shadow.children) {
    for (i = 0; i < node._shadow.children.length; i++) {
      found = µ._mjs_deepFind(node._shadow.children[i], selector, depth + 1, ok);
      if (found) { return found; }
    }
  }
  return null;
};
// <<< extrait-test _mjs_deepFind
// >>> extrait-test ancre-de-la-page
// CIBLE D'UNE ANCRE de la page affichée, cherchée comme le navigateur — l'id, puis l'ancre nommée (`<a name>`), le
// fragment tel quel puis décodé — et aussi dans l'ombre des composants, même fermée (`_shadow`), que le navigateur ne
// voit pas : { el } ; { el, shadow } quand seule une ombre la porte ; { top } pour le haut de la page (fragment vide,
// ou `top` sans cible de ce nom) ; null sinon
µ._mjs_anchorTarget = function(hash) {
  var raw = String(hash || '').replace(/^#/, ''), names = [raw], dec, el, i, n;
  if (!raw) { return { top: true }; }
  try { dec = decodeURIComponent(raw); } catch { dec = raw; }
  if (dec !== raw) { names.push(dec); }
  for (i = 0; i < names.length; i++) {
    el = document.getElementById(names[i]) || Array.prototype.find.call(document.getElementsByName(names[i]), function(a) { return a.localName === 'a'; });
    if (el) { return { el: el }; }
  }
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    for (i = 0; i < names.length; i++) {
      n  = CSS.escape(names[i]);
      el = µ._mjs_deepFind(document.documentElement, '#' + n, 0) || µ._mjs_deepFind(document.documentElement, 'a[name=' + n + ']', 0);
      if (el) { return { el: el, shadow: true }; }
    }
  }
  return dec.toLowerCase() === 'top' ? { top: true } : null;
};
// défile jusqu'à la cible d'une ancre et dit si elle existe ; `instant` (Précédent, Suivant, arrivée) : sans glisser,
// sinon comme le navigateur (`scroll-behavior` de la page) ; `shadowOnly` (clic) : seulement la cible que le navigateur,
// qui vient de défiler, n'a pas vue
µ._mjs_anchorScroll = function(hash, instant, shadowOnly) {
  var t = µ._mjs_anchorTarget(hash), behavior = instant ? 'instant' : 'auto';
  if (!t) { return false; }
  if (shadowOnly && !t.shadow) { return true; }
  // le `scrollIntoView` de la balise, jamais celui d'un composant du même nom
  if (t.top) { window.scrollTo({ left: 0, top: 0, behavior: behavior }); }
  else { Element.prototype.scrollIntoView.call(t.el, { behavior: behavior }); }
  return true;
};
// la page posée sur la cible du fragment `hash` comme le navigateur l'y pose : le haut de la cible au haut de la vue
// (marges de défilement comprises), ou la page au bout quand la cible est plus bas ; le haut de la page pour `#top`.
// Une cible que seule l'ombre d'un composant porte, le navigateur ne la voit pas
µ._mjs_atFragment = function(hash) {
  var t = hash ? µ._mjs_anchorTarget(hash) : null, r, m, max;
  if (!t || t.shadow) { return false; }
  if (t.top) { return window.scrollY <= 2; }
  r   = t.el.getBoundingClientRect();
  m   = (parseFloat(getComputedStyle(t.el).scrollMarginTop) || 0) + (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);
  max = document.documentElement.scrollHeight - window.innerHeight;
  return Math.abs(r.top - m) <= 2 || (window.scrollY >= max - 2 && r.top > m);
};
// suit l'ancre d'un clic comme le navigateur (défilement, `:target`, point de départ de la tabulation), par l'adresse
// complète du lien (jamais `#x` seul, que `<base href>` détournerait). La page affichée est une vraie page : l'ancre
// remplace son entrée d'historique, Précédent ramène à la page d'avant. Avec `µ._anchorHistory` (réglage du projet,
// posé par le manifeste), chaque ancre ajoute une entrée, comme le navigateur seul — de même depuis une route `#/…`,
// dont l'entrée reste. Le `popstate` émis pendant l'appel (synchrone dans les trois moteurs) n'est pas un Précédent :
// `_mjs_anchorNav` le fait sauter
µ._mjs_anchorGo = function(link) {
  var loc = window.location, push = !!µ._anchorHistory || loc.hash.startsWith('#/'), state = window.history.state, mode = window.history.scrollRestoration;
  if (µ._mjs_anchorStop) { µ._mjs_anchorStop(); }
  // position de l'entrée quittée, rendue au Précédent (cf. popstate) : seulement quand elle reste dans l'historique
  if (push && link.href !== loc.href && typeof µ._mjs_saveScroll === 'function') { µ._mjs_saveScroll(loc.pathname + loc.search + (loc.hash || '#')); }
  µ._mjs_anchorNav = true;
  try {
    if (push) { loc.assign(link.href); }
    else { loc.replace(link.href); }
  }
  finally {
    µ._mjs_anchorNav = false;
  }
  // l'entrée ajoutée garde le défilement de celle qu'elle suit, coupé par la navigation : WebKit la crée avec le défilement
  // natif (`auto`), y défilait lui-même jusqu'à l'ancre au retour, avant la position gardée, et la page revenue par un
  // chargement complet finissait sur l'ancre
  if (push && mode && window.history.scrollRestoration !== mode) { window.history.scrollRestoration = mode; }
  // l'entrée remplacée garde l'état que l'application y avait rangé (`location.replace` l'efface sous Chromium et
  // Firefox) ; `replaceState` ne touche ni à `:target` ni au point de départ de la tabulation
  if (!push && state != null) {
    try { window.history.replaceState(state, '', loc.href); } catch { /* état laissé tel quel */ }
  }
  µ._mjs_anchorScroll(link.hash, false, true);
};
// l'ancre d'un clic, prise à la fin de la propagation comme l'action du navigateur : un écouteur de l'application posé
// sur `document` après la navigation, ou sur `window`, la retient encore par `preventDefault()`. Le dernier écouteur de
// `window` décide ; un clic que la navigation ne voit pas remonter jusqu'à lui (relancé après une coupure de la
// propagation, ou hors du document) est suivi aussitôt
µ._mjs_anchorClick = function(e, link) {
  var last;
  if (e.currentTarget !== document || e.eventPhase !== Event.BUBBLING_PHASE || e.cancelBubble) {
    e.preventDefault();
    µ._mjs_anchorGo(link);
    return;
  }
  last = function(ev) {
    if (ev !== e) { return; }
    window.removeEventListener('click', last);
    if (e.defaultPrevented) { return; }
    e.preventDefault();
    µ._mjs_anchorGo(link);
  };
  window.addEventListener('click', last);
  // propagation coupée après la navigation : le navigateur suit l'ancre lui-même, l'écouteur s'en va
  setTimeout(function() { window.removeEventListener('click', last); }, 0);
};
// l'ancre de l'adresse, atteinte une fois la page montée (arrivée sur le site, page reçue d'un lien ou d'un formulaire) :
// le navigateur ne voit ni l'ombre des composants ni une cible peinte après lui (composant défini après le chargement,
// premier rendu, bloc `{if}` ouvert plus tard). La page y défile dès que la cible existe, puis l'y garde à chaque
// changement de taille de la page ou d'un composant (contenu peint au-dessus d'elle) — jusqu'au premier geste de
// l'utilisateur (molette, toucher, touche, pointeur), un focus qu'il déplace sans défiler (lecteur d'écran), un
// défilement qui n'est pas le sien (barre de défilement, script de la page), le départ de l'adresse, ou 10 s. Le temps
// du suivi, l'ancrage de défilement du navigateur (`overflow-anchor`) est coupé sur la page : il recalerait la page
// lui-même quand du contenu se peint au-dessus, ce que le suivi fait déjà, et son défilement passerait pour un
// défilement étranger. `pos` ([x, y], position gardée de l'entrée retrouvée au chargement, µ._mjs_keptEntryPos, ou de la
// page redemandée au serveur au retour, µ._mjs_restoreScroll) : rejointe à la place de l'ancre, de la même façon, dès que
// la page est assez haute
µ._mjs_anchorArrive = function(pos) {
  var loc = window.location, hash = loc.hash, href = loc.href, gestures = ['wheel', 'touchstart', 'keydown', 'pointerdown'], x = window.scrollX, y = window.scrollY, t, el, i, ro, timer, st, anchor, prio, styled, follow, moved, focused, stop;
  if (µ._mjs_anchorStop) { µ._mjs_anchorStop(); }
  if (!pos && (!hash || hash.startsWith('#/'))) { return; }
  if (pos && typeof ResizeObserver !== 'function') {
    window.scrollTo({ left: pos[0], top: pos[1], behavior: 'instant' });
    return;
  }
  t = pos ? null : µ._mjs_anchorTarget(hash);
  // le haut de la page n'a rien à attendre ; un navigateur sans `ResizeObserver` essaie une fois
  if (!pos && ((t && t.top) || typeof ResizeObserver !== 'function')) {
    µ._mjs_anchorScroll(hash, true);
    return;
  }
  el = t && t.el;
  follow = function() {
    if (loc.href !== href) { stop(); return; }
    if (pos) { window.scrollTo({ left: pos[0], top: pos[1], behavior: 'instant' }); }
    else {
      if (!el || !el.isConnected) { t = µ._mjs_anchorTarget(hash); el = t && t.el; }
      if (!el) { return; }
      // le `scrollIntoView` de la balise, jamais celui d'un composant du même nom
      Element.prototype.scrollIntoView.call(el, { behavior: 'instant' });
    }
    x = window.scrollX;
    y = window.scrollY;
  };
  moved = function() {
    if (Math.abs(window.scrollX - x) <= 2 && Math.abs(window.scrollY - y) <= 2) { return; }
    // position gardée : le navigateur qui pose lui-même la page sur la cible du fragment de l'adresse (WebKit y revient
    // après le chargement, ses feuilles de style arrivées) ne l'arrête pas, elle la reprend
    if (pos && µ._mjs_atFragment(hash)) { follow(); return; }
    stop();
  };
  // le focus que la navigation pose elle-même après un échange de page (µ._mjs_focusAfterSwap) n'arrête rien, ni celui
  // qui se pose sur un champ `autofocus` de la page, hors d'un `<dialog>` : le navigateur l'y pose lui-même (WebKit, sur
  // le contenu reçu, après celui de la navigation), ce n'est pas un geste du visiteur. Le champ d'un composant est
  // l'élément actif de son ombre (un léger : de sa racine d'ombre native), l'événement ne désigne que l'hôte
  focused = function(e) {
    var f = e.target;
    for (var r = µ._mjs_shadowOf(f); r && r.activeElement; r = µ._mjs_shadowOf(f)) { f = r.activeElement; }
    if (!µ._mjs_focusing && !(f.hasAttribute && f.hasAttribute('autofocus') && !f.closest('dialog'))) { stop(); }
  };
  stop = function() {
    if (µ._mjs_anchorStop === stop) { µ._mjs_anchorStop = null; }
    ro.disconnect();
    clearTimeout(timer);
    for (i = 0; i < gestures.length; i++) { window.removeEventListener(gestures[i], stop, true); }
    window.removeEventListener('focusin', focused, true);
    window.removeEventListener('scroll', moved);
    window.removeEventListener('load', follow);
    // la valeur que l'application pose pendant le suivi reste ; l'attribut `style` que le suivi a ajouté s'en va avec lui
    if (st.getPropertyValue('overflow-anchor') === 'none' && st.getPropertyPriority('overflow-anchor') === 'important') { st.setProperty('overflow-anchor', anchor, prio); }
    if (!styled && !st.length) { document.documentElement.removeAttribute('style'); }
  };
  // l'ancrage du navigateur rendu ensuite tel que l'auteur l'avait (sa valeur en ligne, ou rien)
  st     = document.documentElement.style;
  styled = document.documentElement.hasAttribute('style');
  anchor = st.getPropertyValue('overflow-anchor');
  prio   = st.getPropertyPriority('overflow-anchor');
  st.setProperty('overflow-anchor', 'none', 'important');
  ro = new ResizeObserver(follow);
  µ._mjs_anchorStop = stop;
  follow();
  ro.observe(document.documentElement);
  if (document.body) {
    ro.observe(document.body);
    // les composants de la page aussi : sous `html, body { height: 100% }`, ni l'un ni l'autre ne grandit
    Array.prototype.forEach.call(document.body.querySelectorAll('*'), function(n) { if (n.localName.indexOf('-') > 0) { ro.observe(n); } });
  }
  for (i = 0; i < gestures.length; i++) { window.addEventListener(gestures[i], stop, { capture: true, passive: true }); }
  window.addEventListener('focusin', focused, true);
  window.addEventListener('scroll', moved, { passive: true });
  // position gardée d'une page encore en chargement : WebKit défile lui-même vers le fragment de l'adresse juste avant
  // `load`, la position la reprend avant qu'il ne se peigne
  if (pos && document.readyState !== 'complete') { window.addEventListener('load', follow); }
  timer = setTimeout(stop, 10000);
};
// <<< extrait-test ancre-de-la-page
// Cascade (1er trouvé gagne) : [autofocus] du nouveau contenu > premier <h1>
// (pose tabindex="-1" s'il n'en a pas, pour le rendre focusable SANS entrer
// dans l'ordre de tabulation naturel) > le conteneur lui-même (idem). Jamais
// au chargement initial (pas de swap = pas d'appel — cf. call-sites, tous
// dans un callback de navigation ujs). `{preventScroll:true}` : la
// restauration de scroll (`_mjs_restoreScroll`, plus haut) gère déjà la position —
// un `focus()` natif re-scrollerait sinon l'élément dans la vue, parasite.
// `nodes` : tout le contenu reçu (nœuds installés), où le champ `autofocus` et le titre `<h1>` se cherchent aussi
// au-delà de `root`, son premier élément. Seul celui qui prend vraiment le focus compte : celui d'un `<dialog>` fermé,
// d'un `popover` caché, d'une partie `inert` ou `hidden`, ou un champ désactivé, ne le prend pas (le navigateur le
// refuse), le suivant est essayé, puis la cascade continue ; un titre qui ne le prend pas ne garde pas le tabindex posé
// pour lui
// >>> extrait-test _mjs_focusAfterSwap
µ._mjs_focusAfterSwap = function(root, nodes) {
  if (!root) { return; }
  var all = nodes || [];
  // le `focus` de la balise, jamais celui d'un composant du même nom (`@focus = ->` reçoit son propre argument) ; posé
  // par la navigation, il n'arrête pas le suivi de l'ancre de la page reçue (µ._mjs_anchorArrive)
  var focus = function(el) {
    µ._mjs_focusing = true;
    try {
      if (typeof HTMLElement === 'function' && el instanceof HTMLElement) { HTMLElement.prototype.focus.call(el, { preventScroll: true }); }
      else if (typeof el.focus === 'function') { el.focus({ preventScroll: true }); }
    }
    finally {
      µ._mjs_focusing = false;
    }
  };
  // le champ a-t-il pris le focus ? Un écouteur de la page qui le pose ailleurs l'a pris aussi ; sans `getRootNode`
  // (harnais), rien ne dit le contraire
  var took = function(el) {
    var before;
    if (typeof el.getRootNode !== 'function') { focus(el); return true; }
    before = document.activeElement;
    focus(el);
    return el.getRootNode().activeElement === el || document.activeElement !== before;
  };
  // dans `root`, puis dans le reste du contenu reçu, le premier `sel` que `ok` accepte
  var find = function(sel, ok) {
    var t = µ._mjs_deepFind(root, sel, 0, ok), i;
    for (i = 0; !t && i < all.length; i++) { if (all[i] !== root && all[i].nodeType === 1) { t = µ._mjs_deepFind(all[i], sel, 0, ok); } }
    return t;
  };
  // un titre, ou le conteneur, prend le focus sans entrer dans l'ordre de tabulation : tabindex="-1" s'il n'en a pas
  var tab = function(el) {
    var add = typeof el.hasAttribute === 'function' && !el.hasAttribute('tabindex');
    if (add) { el.setAttribute('tabindex', '-1'); }
    return add;
  };
  var heading = function(el) {
    var add = tab(el);
    if (took(el)) { return true; }
    if (add) { el.removeAttribute('tabindex'); }
    return false;
  };
  if (find('[autofocus]', took) || find('h1', heading)) { return; }
  tab(root);
  focus(root);
};
// <<< extrait-test _mjs_focusAfterSwap

// ──────────────────────────────────────────────────────────────────────────
// ZONE DE NAVIGATION — une navigation remplace le
// CONTENU d'un contenant. Le contenant = la clé `target` de la fiche JSON
// (sélecteur CSS) si elle est présente et résolue, sinon `<body>` — la
// cascade #app-root/mjs-child disparaît. `method` ('update' défaut/'append'/'replace',
// cf. µ._mjs_navMethodOf/µ._mjs_navInstallNodes plus bas) décide QUOI faire du contenant,
// cette fonction ne fait que le TROUVER. `target` introuvable (sélecteur
// invalide compris, cf. try/catch — un CSS cassé ne doit jamais faire jeter la
// navigation) retombe sur la DERNIÈRE zone suivie (`µ._mjs_navZone`, posée par
// µ._mjs_navTrackZone plus bas) si elle est encore connectée : un `method:
// 'replace'` a pu la faire céder sa place au module lui-même, qui reste alors
// la cible tant qu'il reste monté ; sinon `<body>` + avertissement (une fois
// par sélecteur distinct, diagnostic dev hors catalogue i18n, jamais montré à
// l'utilisateur final). `doc` (défaut `document`) : LE MÊME calcul s'applique
// côté RÉPONSE (document parsé par DOMParser, cf. call-sites plus bas) —
// l'avertissement, lui, ne compte QUE pour le document COURANT (celui
// réellement affiché), jamais pour une réponse parsée hors-document.
// >>> extrait-test helpers-navigation
// remplacement insensible à une méthode `replaceWith` du composant (cf. mjs_element.ts)
µ._mjs_swap = µ._mjs_swap || function(cur, nn) {
  if (typeof Node !== 'function' || !(cur instanceof Node)) return cur.replaceWith(nn);
  var p = cur.parentNode;
  if (p) Node.prototype.replaceChild.call(p, nn, cur);
};
// `matches`/`closest` de la balise, insensibles à une méthode du composant du même nom (cf. mjs_element.ts)
µ._mjs_matches = µ._mjs_matches || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.matches.call(n, sel);
  return !!n && typeof n.matches === 'function' && n.matches(sel);
};
µ._mjs_closest = µ._mjs_closest || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.closest.call(n, sel);
  return n && typeof n.closest === 'function' ? n.closest(sel) : null;
};
// >>> extrait-test _mjs_navMountZone
µ._mjs_navMountZone = function(doc, target) {
  var el;
  doc = doc || document;
  if (!target) { return { zone: doc.body, mode: 'body', target: null }; }
  try { el = doc.querySelector(target); } catch { el = null; }
  if (el) { return { zone: el, mode: 'target', target: target }; }
  if (doc === document && µ._mjs_navZone && µ._mjs_navZone.isConnected && µ._mjs_navZone !== doc.body) {
    return { zone: µ._mjs_navZone, mode: 'replaced', target: target };
  }
  if (doc === document && !Object.prototype.hasOwnProperty.call(µ._mjs_navTargetWarned, target)) {
    µ._mjs_navTargetWarned[target] = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsTargetMissing', { target: target }, 'cible de navigation \'{target}\' introuvable dans la page — contenu de <body> remplacé.'));
  }
  return { zone: doc.body, mode: 'body', target: null };
};
// <<< extrait-test _mjs_navMountZone
µ._mjs_navTargetWarned = {};         // sélecteurs `target` déjà signalés introuvables dans la PAGE (une fois chacun)
µ._mjs_navRespTargetWarned = {};     // sélecteurs `target` déjà signalés introuvables dans la RÉPONSE (une fois chacun)
µ._mjs_navMethodWarned = {};         // valeurs `method` déjà signalées inconnues (une fois chacune)
µ._mjs_navReplaceBodyWarned = false; // 'replace' dégradé sur <body> (une fois, toujours le même cas)

// ÉVÉNEMENTS DE CYCLE DE NAVIGATION — before-visit/visit/load (cf. leurs sites
// d'émission plus bas : handlers clic/popstate, µ._mjs_navDispatch, µ._mjs_navApplyJson, et le premier
// chargement en fin de fichier). Helper MUTUALISÉ, MÊME convention que l'événement before-cache (
// juste plus bas) : émis sur `document`, `bubbles: true`, charge utile dans `detail`, nom préfixé
// `mjs:`. Enveloppé (try/catch) : ni un écouteur qui jette, ni l'absence de `document.dispatchEvent`/
// `CustomEvent` (harnais de test minimal), ne doivent jamais empêcher une navigation — un environnement
// dégradé rend donc TOUJOURS `true`. `cancelable` : SEUL `before-visit` l'est — `false` renvoyé si et
// seulement si un écouteur a appelé `preventDefault()` sur CET événement-là.
µ._mjs_navEmit = function(name, detail, cancelable) {
  var ev;
  // `load`, signal terminal d'une navigation, émis après toute installation : la page qu'elle quittait n'attend plus
  // rien, son repère tombe (cf. µ._mjs_navHibernate)
  if (name === 'load') { µ._mjs_navLeft = null; }
  try {
    ev = new CustomEvent('mjs:' + name, { detail: detail, bubbles: true, cancelable: !!cancelable });
    document.dispatchEvent(ev);
    return !(cancelable && ev.defaultPrevented);
  } catch {}
  return true;
};

// NORMALISATION detail.path/url DES 3 ÉVÉNEMENTS DE CYCLE —
// `response.url` (`finalUrl`, mjs_ajax.ts), `link.href` et le repli `window.location.href` d'un
// formulaire sans `action` sont TOUJOURS ABSOLUS par construction (Fetch API / DOM) : sans ce filtre,
// `detail.path`/`url` fuyaient l'origine (`http://mon-site.example/produits/42` au lieu de
// `/produits/42`) — l'exemple canonique de la doc (`analytics.page(e.detail.path)`) enregistrait alors
// une URL absolue. UN SEUL point de passage pour les 13 sites d'émission (2 before-visit/3 visit/8
// load, dont l'initial) : plus aucun site ne compose `path`/`url` à la main. Idempotent sur une entrée
// déjà relative. Hôte DIFFÉRENT → chaîne rendue TELLE QUELLE, jamais rabotée à l'aveugle (on ne
// prétend rien savoir d'une URL hors de notre hôte). Enveloppé (try/catch) : `window.location`/`URL`
// inexploitables (harnais de test minimal) ne doivent jamais faire tomber l'émission — repli sur la
// chaîne brute, comme µ._mjs_finalPathFor plus haut.
µ._mjs_navEmitPaths = function(u) {
  var abs;
  try {
    abs = new URL(u, window.location.href);
    // host (hôte+port), PAS origin (qui inclut le schéma) : un http→https sur le MÊME hôte
    // (upgrade HSTS/force_ssl, dev→prod) doit rester rabotable ; µ._mjs_finalPathFor, lui, PILOTE une
    // navigation réelle (pushState/assign) et reste strict sur le schéma — volontairement pas touché.
    if (abs.host !== window.location.host) { return { path: u, url: u }; } // autre hôte : on ne rabote rien
    return { path: abs.pathname + abs.search, url: abs.pathname + abs.search + abs.hash };
  } catch {}
  return { path: u, url: u }; // harnais sans window.location exploitable : chaîne brute
};

// NORMALISATION PARTAGÉE — quatre valeurs de
// `method` : 'replace' et 'append' tels quels, 'none' tel quel (« ne bouge pas » — la page
// affichée reste affichée, cf. µ._mjs_navInstallNodes plus bas), tout le reste (absent/vide/'update'/
// inconnu) devient 'update' — l'ancien défaut implicite ('append', qui en réalité VIDAIT puis
// réinjectait) change donc de NOM sans changer de comportement ; le VRAI `append` (ajoute sans rien
// retirer) est désormais une valeur à part entière, cf. µ._mjs_navInstallNodes plus bas. Valeur inconnue →
// averti UNE FOIS par valeur DISTINCTE (jamais par appel), diagnostic dev hors catalogue i18n comme les
// autres µ.warn de ce fichier. Utilisée par le chemin JSON (µ._mjs_navApplyJson) ET le chemin HTML
// (X-MJS-Method, cf. les 3 sites de swap plus bas).
µ._mjs_navMethodOf = function(raw) {
  if (raw === 'replace') { return 'replace'; }
  if (raw === 'append') { return 'append'; }
  if (raw === 'none') { return 'none'; }
  if (raw == null || raw === '' || raw === 'update') { return 'update'; }
  if (!Object.prototype.hasOwnProperty.call(µ._mjs_navMethodWarned, raw)) {
    µ._mjs_navMethodWarned[raw] = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsUnknownMethod', { raw: raw }, 'method \'{raw}\' inconnu dans la fiche de navigation — \'update\' appliqué.'));
  }
  return 'update';
};

// POLITIQUE DE CACHE PAR PAGE — trois valeurs : 'cache-first' (défaut, la
// page hiberne normalement) · 'revalidate' (affichée depuis le cache puis vérifiée en fond, cf.
// µ._mjs_navRevalidate plus bas) · 'no-cache' (jamais archivée, cf. µ._mjs_navHibernate plus bas). MÊME
// PATRON que µ._mjs_navMethodOf juste au-dessus : valeur inconnue → 'cache-first' + averti UNE FOIS par
// valeur DISTINCTE. Trois canaux d'entrée (précédence en-tête > balise > défaut, cf. µ._mjs_navCacheOf) :
// chemin JSON (clé `cache` de la fiche, lue par µ._mjs_navApplyJson), chemin HTML (en-tête X-MJS-Cache,
// décodé dans mjs_ajax.ts à côté de target/method) et son repli balise (<meta name="mjs-cache">,
// cf. µ._mjs_navCacheOf). `null`/absent → 'cache-first' SANS avertissement (comme method/'update').
µ._mjs_navCacheWarned = {}; // valeurs `cache` déjà signalées inconnues (une fois chacune)
µ._mjs_navCachePolicyOf = function(raw) {
  if (raw === 'cache-first' || raw === 'revalidate' || raw === 'no-cache') { return raw; }
  if (raw == null || raw === '') { return 'cache-first'; }
  if (!Object.prototype.hasOwnProperty.call(µ._mjs_navCacheWarned, raw)) {
    µ._mjs_navCacheWarned[raw] = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsUnknownCache', { raw: raw }, 'cache \'{raw}\' inconnu dans la fiche de navigation — \'cache-first\' appliqué.'));
  }
  return 'cache-first';
};

// RÉSOLUTION CHEMIN HTML — en-tête `headerVal` (nav.cache, déjà décodé par mjs_ajax.ts) PRIME
// sur la balise <meta name="mjs-cache"> lue DANS `doc`, le document PARSÉ DE LA RÉPONSE — JAMAIS
// `document.head` : cette balise est HORS du périmètre piloté par µ._mjs_navHeadKeyOf (cf. son
// bandeau plus bas) — une balise de PROTOCOLE, pas une métadonnée de page — `document.head` ne la
// voit donc JAMAIS changer au swap et refléterait encore la PREMIÈRE page chargée — y lire la balise
// serait un bogue silencieux. `doc.querySelector` gardé par `typeof` : un `doc` minimal (harnais de
// test, réponse sans <head> exploitable) reste toléré.
µ._mjs_navCacheOf = function(doc, headerVal) {
  var raw, meta;
  raw = headerVal;
  if (!raw && doc) {
    meta = typeof doc.querySelector === 'function' ? doc.querySelector('meta[name="mjs-cache"]') : null;
    raw = meta && typeof meta.getAttribute === 'function' ? meta.getAttribute('content') : null;
  }
  return µ._mjs_navCachePolicyOf(raw);
};

// RECHARGEMENT DUR (`X-MJS-Reload`/`reload`) — « j'ai traité, recharge tout » :
// vocabulaire manquant au protocole de navigation, repris d'un `AjaxController` Rails utilisé
// avant MJS (`ajax_complete: :reload`). MÊME PATRON que µ._mjs_navMethodOf/µ._mjs_navCachePolicyOf
// juste au-dessus : normalisation d'un côté (µ._mjs_navReloadAsked), exécution de l'autre
// (µ._mjs_navHardReload) — mais AUCUN vocabulaire fermé à défendre ici (contrairement à `method`/`cache`),
// donc AUCUN avertissement sur une valeur inattendue : un serveur qui pose `X-MJS-Reload: 1` n'a rien
// de mal formé à se faire signaler.
//
// µ._mjs_navReloadAsked(raw) — vrai si `raw === true` (booléen, chemin JSON) ou une chaîne NON VIDE dont
// la valeur rognée en minuscules n'est ni '0' ni 'false' ; tout le reste (null/undefined/''/'0'/
// 'false'/false/un nombre) vaut faux.
µ._mjs_navReloadAsked = function(raw) {
  var v;
  if (raw === true) { return true; }
  if (typeof raw !== 'string') { return false; }
  v = raw.trim().toLowerCase();
  if (v === '') { return false; }
  return v !== '0' && v !== 'false';
};

// RÉPONSE À INSTALLER ? (chemins réseau du clic et du popstate) — DOMParser fabrique TOUJOURS un <body>
// exploitable, même depuis `null` ou du texte brut : sans tri préalable, un 204, un PDF, un CSV ou un
// message d'erreur en texte s'installaient tels quels dans la zone de navigation.
// µ._mjs_navBodyKind(html, nav) → 'empty' (204, corps vide ou blanc : rien à afficher, comme un
// navigateur), 'html' (page complète OU fragment, cf. docs/21-navigation.md « le fragment reçu ») ou
// 'other' (tout le reste : le navigateur doit traiter la réponse lui-même). Le Content-Type annoncé
// par le serveur tranche (`nav.type`, lu par mjs_ajax.ts) ; sans en-tête, un corps qui commence par
// une balise passe pour du HTML — jamais un test « <html » : il écarterait les fragments.
µ._mjs_navBodyKind = function(html, nav) {
  var type;
  if (html == null || typeof html !== 'string' || html.trim() === '') { return 'empty'; }
  type = (nav && typeof nav.type === 'string') ? nav.type.toLowerCase() : '';
  if (type) { return (type.indexOf('text/html') !== -1 || type.indexOf('application/xhtml+xml') !== -1) ? 'html' : 'other'; }
  return /^\s*</.test(html) ? 'html' : 'other';
};

// µ._mjs_navHardReload(dest) — POURQUOI la distinction assign/reload : `window.location.assign` sur
// l'adresse COURANTE ne garantit RIEN — une URL identique à un fragment près (même pathname+search
// que celle déjà affichée, SEUL le hash change) est une navigation SAME-DOCUMENT PAR SPÉCIFICATION
// HTML (le navigateur vise juste l'ancre) : AUCUNE requête ne part, la page ne recharge jamais.
// `window.location.reload()`, lui, force TOUJOURS un aller-retour réseau.
// la comparaison portait sur `href` EN ENTIER (fragment
// compris) : prouvé dans un Chromium réel (Playwright), `assign()` vers une destination qui ne
// diffère de l'adresse affichée QUE par le fragment était un no-op silencieux — un back qui répond
// `X-MJS-Reload` en redirigeant vers `/checkout#confirmation` depuis `/checkout` n'obtenait donc
// JAMAIS le rechargement promis. Comparaison désormais sur la PARTIE DOCUMENT SEULE (origin+
// pathname+search, hash exclu) : partie document DIFFÉRENTE ⇒ `assign` (repart forcément au
// serveur, comme avant) ; partie document IDENTIQUE ET fragment DIFFÉRENT ⇒ le fragment demandé est
// posé D'ABORD (`window.location.hash = u.hash`, mise à jour SYNCHRONE de `window.location.href` —
// un `assign` ensuite serait de nouveau same-document, cf. ci-dessus), PUIS `reload()` force le
// vrai aller-retour ; tout identique ⇒ `reload()` seul, comme avant. Résolution en absolu (`new
// URL`) dans un try/catch : une entrée qui ne résout pas replie directement sur `reload()`, jamais un
// throw qui remonterait jusqu'à l'appelant. Gardé par `typeof window !== 'undefined' && window.location`
// (harnais de test minimal) : sinon ne fait rien, aucun crash.
µ._mjs_navHardReload = function(dest) {
  var u, sameDoc;
  if (typeof window === 'undefined' || !window.location) { return; }
  try {
    u = new URL(dest, window.location.href);
  } catch {
    window.location.reload();
    return;
  }
  // même garde de protocole que µ._mjs_hardNav (défense en profondeur) : une destination `javascript:`/`data:`…
  // exécuterait du code au lieu de naviguer
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsHardNavProtocol', { destination: dest }, 'navigation dure refusée, protocole non http/https : {destination}'));
    return;
  }
  sameDoc = u.origin === window.location.origin && u.pathname === window.location.pathname && u.search === window.location.search;
  if (!sameDoc) {
    window.location.assign(u.href);
    return;
  }
  if (u.hash !== window.location.hash) { window.location.hash = u.hash; } // même document, fragment différent : posé AVANT le reload (sinon un assign resterait same-document)
  window.location.reload();
};

// OPT-OUT PAR ÉLÉMENT (`@noUJS` → mjs-no-ujs) : désactive l'interception UJS pour CET élément
// précis (lien ou formulaire) — la navigation native reprend la main. Nom UNIQUE :
// l'ancien `mjs-no-ajax` (jamais publié) a été purgé, deux noms pour une seule chose = dette.
// Placé dans ce bandeau (ZONE DE NAVIGATION) plutôt qu'à côté de µ._mjs_isPreloadableLink, son autre
// consommateur : les handlers clic/submit, PAS le préchargement, en dépendent en premier lieu.
// >>> extrait-test _mjs_navNoUjs
µ._mjs_navNoUjs = function(el) {
  return !!el && typeof el.hasAttribute === 'function' && el.hasAttribute('mjs-no-ujs');
};
// <<< extrait-test _mjs_navNoUjs

// `@noUJS` + `@method` sur le MÊME élément — combinaison contradictoire et SILENCIEUSE :
// l'opt-out rend la main au navigateur, qui ne sait suivre un lien qu'en GET ; un autre verbe que `get` est perdu
// sans trace. Averti UNE FOIS PAR ÉLÉMENT (drapeau porté par le nœud, pas par une clé globale :
// deux liens distincts méritent chacun leur avertissement), juste avant le retour de l'opt-out.
// >>> extrait-test _mjs_navWarnNoUjsMethod
// `e` : l'événement d'un lien que le navigateur suivrait lui-même (vers une autre origine, clic avec Ctrl, Maj,
// Alt ou Cmd, clic du milieu, attribut `target` ou `download`) — parti en GET, sans le verbe : le geste est
// retenu à chaque fois (`preventDefault`), l'avertissement une fois par lien. `get`, quelle que soit sa casse, est le
// verbe même du navigateur, rien de perdu, avec ou sans `e` : le geste, ou la navigation native de `@noUJS`, suit son
// cours, comme sur un lien ordinaire, sans avertissement
µ._mjs_navWarnNoUjsMethod = function(el, e) {
  if (!el || typeof el.getAttribute !== 'function' || !el.getAttribute('mjs-method')) { return; }
  if (el.getAttribute('mjs-method').toLowerCase() === 'get') { return; }
  if (e) { e.preventDefault(); }
  if (el._mjs_mjsNoUjsMethodWarned) { return; }
  el._mjs_mjsNoUjsMethodWarned = true;
  if (e) { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsMethodNative', { method: el.getAttribute('mjs-method') }, ':method="{method}" : lien non suivi — vers une autre origine, avec une touche Ctrl, Maj, Alt ou Cmd, au clic du milieu, avec `target` ou `download`, le navigateur le suivrait lui-même, en GET, sans le verbe. Seul un clic simple sur un lien de la même origine, sans `target` ni `download`, envoie la requête.')); }
  else { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsMethodNoUjs', { method: el.getAttribute('mjs-method') }, ':method="{method}" ignoré — :noUJS rend la navigation native, et le navigateur ne sait faire qu\'un GET sur un lien. Retirez l\'un des deux.')); }
};
// <<< extrait-test _mjs_navWarnNoUjsMethod

// SUIVI DE ZONE — dernier nœud installé en mode 'replace', sur
// les DEUX chemins depuis que `target`/`method` voyagent aussi en en-têtes HTTP (chemin HTML) et plus
// seulement dans la fiche JSON. `null` → aucun suivi (contenant intact, jamais remplacé).
µ._mjs_navZone = null;
// >>> extrait-test _mjs_navTrackZone
µ._mjs_navTrackZone = function(el) { µ._mjs_navZone = el; };
// <<< extrait-test _mjs_navTrackZone

// CONTENANT COURANT — celui que le dernier montage a REMPLI (posé par µ._mjs_zoneFill, seul
// point d'entrée de tous les remplissages : JSON, HTML, cache-hit, panneau 404). C'est LUI que
// le cache de pages hiberne et restaure. Sans cet état, un montage ciblé (`target`) aurait
// photographié les enfants de <body> — habillage compris — tout en ne remplaçant que le contenu
// de la cible : contenu restauré au mauvais endroit au Précédent, et drapeau d'hibernation posé
// sur des nœuds restés VIVANTS (composants exemptés de destruction à vie).
// `null` → <body> (aucun montage encore, ou contenant disparu du DOM) ; `false` → dernier
// montage en 'replace' (le contenant a cédé sa place : plus de contenant stable où reposer le
// contenu quitté, cette page ne participe donc pas au cache).
µ._mjs_navContainer = null;
// >>> extrait-test _mjs_navCacheZone
µ._mjs_navCacheZone = function() {
  if (µ._mjs_navContainer === false) { return null; }
  if (µ._mjs_navContainer && µ._mjs_navContainer.isConnected) { return µ._mjs_navContainer; }
  return document.body;
};
// <<< extrait-test _mjs_navCacheZone

// HIBERNATION EN COURS — page tout juste photographiée par la navigation EN VOL (posé aux 3
// sites qui appellent `µ.pageCache.set`, plus bas : popstate/clic/soumission) : `{ path, nodes }` tant
// qu'un `method: 'append'` peut encore avoir besoin de la dé-hiberner (cf. µ._mjs_navDropHibernation/
// µ._mjs_zoneAppend) ; `null` dès que l'hibernation a été consommée normalement (µ._mjs_zoneFill, un swap
// classique qui vide effectivement le contenant) ou qu'aucune navigation n'est en vol.
µ._mjs_navHibernated = null;

// POLITIQUE DE CACHE DE LA PAGE AFFICHÉE — décrit la page qu'on est en train de MONTRER, posée
// par le chemin qui l'installe (à côté de chaque µ._mjs_navTrackZone : les 3 branches de µ._mjs_navInstallNodes
// plus bas, et les 2 restaurations cache-hit synchrones dans les handlers popstate/clic) ; consultée
// par µ._mjs_navHibernate au moment de la QUITTER. `null` (aucune installation encore, ou µ._mjs_navInstallNodes
// jamais appelé avec un `cache` connu) équivaut à 'cache-first' — repli sûr, comportement historique.
µ._mjs_navCachePolicy = null;

// ──────────────────────────────────────────────────────────────────────────
// GESTION DU <HEAD> AU FIL DE LA NAVIGATION — un swap UJS échange le CONTENU
// du contenant (cf. bandeau ZONE DE NAVIGATION plus haut) mais laissait jusqu'ici le <head> intact :
// titre d'onglet et métadonnées figés sur la toute première page chargée. Périmètre PILOTÉ,
// VOLONTAIREMENT FERMÉ (µ._mjs_navHeadKeyOf juste en dessous en dresse la liste EXACTE) — SEULS le
// <title>, une poignée de <meta> (description/keywords/robots/author/og:*/twitter:*/article:*) et
// <link rel="canonical"> traversent une navigation. NI les styles NI les scripts : un
// <link rel="stylesheet"> retiré puis réinséré est RE-ÉVALUÉ par le navigateur (clignotement à
// CHAQUE navigation), un <script> réinséré REJOUE son code (écouteurs posés en double) — c'est très
// exactement là que Turbo a ses bogues les plus subtils, on ne rouvre pas ce dossier ici. Les styles
// des composants MJS ne sont PAS concernés par cette exclusion : ils vivent dans le SHADOW ROOT du
// composant, jamais dans <head>, ils arrivent et repartent AVEC lui — un swap de contenant les gère
// déjà tout seul, sans avoir besoin de ce bandeau.
// Réconciliation PAR CLÉ et SUR PLACE (jamais un vidage/réinsertion en bloc) : le nœud EXISTANT
// survit tant que la page qui arrive porte encore la même clé (seul son `content`/`href` est
// recopié), il n'est retiré QUE si la page qui arrive ne la déclare plus (sinon l'og:image d'une
// fiche produit traînerait jusque sur la page contact) — jamais de re-requête, jamais de flash,
// contrairement à ce qu'un retrait/réinsertion d'un <link rel="stylesheet"> provoquerait.
// Un <head> REÇU VIDE (fixture de test sans <head>, réponse dégradée) ne déclenche RIEN : vide veut
// dire « cette réponse ne porte aucune information de tête », jamais « efface tout ce qui existe ».
// Opt-out global : `µ.config.navHead = false` désactive tout ce bandeau, comportement identique à
// à l'origine (seul le contenant change, la tête n'est plus jamais touchée).
// ──────────────────────────────────────────────────────────────────────────

// PÉRIMÈTRE FERMÉ — rend la clé de réconciliation d'un élément de <head>, ou `null` s'il est HORS
// périmètre (auquel cas µ._mjs_navHeadReconcile ne le touche jamais, ni en retrait ni en recopie).
// Défensif comme le reste du fichier : un nœud sans `getAttribute`, ou qui n'est pas un ÉLÉMENT
// (`nodeType` 1), rend `null` sans discussion.
µ._mjs_navHeadKeyOf = function(el) {
  var name, prop, rel, tag;
  if (!el || typeof el.getAttribute !== 'function' || el.nodeType !== 1) { return null; }
  tag = el.tagName;
  if (tag === 'META') {
    // casse STRICTE et VOULUE (`Description`/`OG:IMAGE` non reconnus) : les conventions HTML et Open
    // Graph sont en minuscules — délibérément AUCUNE tolérance ici, contrairement à `rel` (LINK, ci-dessous).
    name = el.getAttribute('name');
    if (name === 'description' || name === 'keywords' || name === 'robots' || name === 'author') { return 'meta:name:' + name; }
    if (name && (name.indexOf('og:') === 0 || name.indexOf('twitter:') === 0)) { return 'meta:name:' + name; }
    prop = el.getAttribute('property');
    if (prop && (prop.indexOf('og:') === 0 || prop.indexOf('twitter:') === 0 || prop.indexOf('article:') === 0)) { return 'meta:prop:' + prop; }
    return null;
  }
  if (tag === 'LINK') {
    rel = (el.getAttribute('rel') || '').trim().toLowerCase();
    // `rel` est une LISTE DE TOKENS séparés par des espaces
    // (spécification HTML, ex. `rel="canonical alternate"`), jamais une égalité stricte : un
    // <link rel="canonical alternate"> n'était jamais reconnu depuis une page reçue, et s'il était déjà
    // dans la page courante il y restait planté à vie (jamais nettoyé par le retrait des clés absentes).
    if (rel.split(/\s+/).indexOf('canonical') !== -1) { return 'link:canonical'; }
    return null;
  }
  return null;
};

// Tous les attributs d'un élément de <head>, en paires [nom, valeur] — forme PLATE partagée par
// µ._mjs_navApplyHead (table construite depuis le document PARSÉ) et µ._mjs_navSnapshotHead (table construite
// depuis une PHOTO, cf. plus bas) : aucun des deux ne fait transiter un NamedNodeMap vivant plus loin
// que sa propre fonction.
µ._mjs_navHeadAttrs = function(el) {
  var out, list, i;
  out = [];
  list = el.attributes;
  if (!list) { return out; }
  for (i = 0; i < list.length; i++) { out.push([list[i].name, list[i].value]); }
  return out;
};
µ._mjs_navHeadAttrValue = function(attrs, name) {
  var i;
  for (i = 0; i < attrs.length; i++) { if (attrs[i][0] === name) { return attrs[i][1]; } }
  return null;
};

// CORPS FACTORISÉ (µ._mjs_navApplyHead ET µ._mjs_navRestoreHead l'appellent, jamais dupliqué) — `table` :
// clé (µ._mjs_navHeadKeyOf) → { tag, attrs, node? }. `node` (présent UNIQUEMENT côté µ._mjs_navApplyHead, un
// document parsé fournit de VRAIS éléments) permet `document.importNode` pour une clé toute neuve ;
// absent (µ._mjs_navRestoreHead, qui ne repart que d'une PHOTO figée, cf. µ._mjs_navSnapshotHead) → repli
// systématique sur `createElement` + recopie d'attributs, exactement le même repli qu'un harnais de
// test minimal sans `importNode`.
// Gardée (`document.head`/`.children` absents) : un `document` minimal (harnais de test) ne fait
// jamais tomber cette fonction — même défense que le reste de ce fichier.
µ._mjs_navHeadReconcile = function(table) {
  var existing, i, j, el, key, entry, handled, val, fresh, attrName;
  if (!document.head || !document.head.children) { return; }
  existing = Array.prototype.slice.call(document.head.children); // copie AVANT de muter (retraits en cours de boucle)
  handled = {};
  for (i = 0; i < existing.length; i++) {
    el = existing[i];
    key = µ._mjs_navHeadKeyOf(el);
    if (!key) { continue; } // hors périmètre : jamais touché (styles/scripts/viewport/mjs-cache… ; le jeton CSRF a sa recopie à part, µ._mjs_navCsrf)
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      entry = table[key];
      attrName = el.tagName === 'LINK' ? 'href' : 'content';
      val = µ._mjs_navHeadAttrValue(entry.attrs, attrName);
      if (val !== null) { el.setAttribute(attrName, val); } // nœud EXISTANT conservé, jamais retiré/recréé
      handled[key] = true;
    } else {
      // la page qui arrive ne déclare plus cette métadonnée : la garder ferait traîner celle de la
      // page quittée (l'og:image d'une fiche produit sur la page contact, par exemple).
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }
  }
  for (key in table) {
    if (!Object.prototype.hasOwnProperty.call(table, key) || handled[key]) { continue; }
    entry = table[key];
    if (entry.node && typeof document.importNode === 'function') {
      fresh = document.importNode(entry.node, true);
    } else {
      fresh = document.createElement(entry.tag);
      for (j = 0; j < entry.attrs.length; j++) { fresh.setAttribute(entry.attrs[j][0], entry.attrs[j][1]); }
    }
    document.head.appendChild(fresh);
  }
};

// FICHE DU FICHIER DE PAGE (`render.startup: 'bundle'`) d'un document reçu : le manifeste ne la lit qu'au
// démarrage ; à l'arrivée par un lien interne, c'est ici qu'elle repointe `µ.paths` sur le fichier de page
// (déjà préchargé par son lien), AVANT que le contenu ne soit installé et que l'Autoloader ne voie les
// balises. Valeurs posées telles quelles (même forme que le manifeste, préfixe factorisé inclus). Un nom
// de la page quittée absent de celle-ci garde le fichier de la précédente : déjà en cache, importé une
// seule fois, les composants déjà définis y sont ignorés. Fiche absente ou abîmée : aucun effet.
// >>> extrait-test _mjs_navPageFile
µ._mjs_navPageFile = function(doc) {
  var tag, card, prev;
  try {
    // la fiche est le <script type="application/json"> que le build écrit, jamais un autre élément du même id : un contenu de
    // visiteur rendu par le serveur dans la page reçue (un élément ordinaire, cet id et du texte) ne désigne rien
    tag = doc && doc.querySelector('script#__mjs_page[type="application/json"]');
    card = tag && JSON.parse(tag.textContent);
    if (!µ.paths || !card || typeof card.file !== 'string' || !Array.isArray(card.names)) { return; }
    // le fichier de page vit dans le dossier du cœur, sous la forme des valeurs de `µ.paths` : son nom seul (préfixe factorisé,
    // `µ.pathsPrefix`), ou ce nom à la racine du site (fichiers servis sans préfixe) — donc ni autre dossier (`../`, `/uploads/`),
    // ni schéma (`http:`, `data:`), ni `//hôte`, ni blanc ou tabulation en tête, ni antislash
    if (!/^\/?mjs_page-[\w.-]+\.js$/.test(card.file)) { return; }
    // l'ancien chemin de chaque nom est gardé : si le fichier de page n'arrive pas (404), le
    // composant se recharge par son fichier séparé (cf. Autoloader.load) ; « déjà gardé » lu sur les noms propres de la
    // table : un nom qu'elle hérite (`constructor`, prototype pollué) n'y passe pas pour gardé
    prev = µ._mjs_pagePrev || (µ._mjs_pagePrev = {});
    card.names.forEach(function(n) {
      if (typeof n !== 'string') { return; }
      if (!Object.prototype.hasOwnProperty.call(prev, n)) { prev[n] = µ.paths[n]; }
      µ.paths[n] = card.file;
    });
  } catch {}
};
// <<< extrait-test _mjs_navPageFile

// JETON CSRF de la page reçue (`<meta name="csrf-token">` et `csrf-param`, lus dans son <head> seulement)
// recopié dans la page : une connexion ou une déconnexion faite par la navigation fait tourner le jeton du
// serveur, et µ.ajax (donc les liens @method et les formulaires sans champ de jeton) le relit ici à chaque
// requête. Du protocole, pas de la tête pilotée : hors `µ.config.navHead`. Absent de la page reçue : celui
// de la page reste.
µ._mjs_navCsrf = function(doc) {
  var names = ['csrf-param', 'csrf-token'], i, got, val, el;
  if (!doc || !doc.head || !document.head) { return; }
  for (i = 0; i < names.length; i++) {
    got = doc.head.querySelector('meta[name="' + names[i] + '"]');
    val = got ? got.getAttribute('content') : null;
    if (val == null) { continue; }
    el = document.head.querySelector('meta[name="' + names[i] + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', names[i]);
      document.head.appendChild(el);
    }
    el.setAttribute('content', val);
  }
};

// Applique le <head> du document PARSÉ `doc` (réponse HTML d'une navigation, cf. les 3 sites de swap
// et µ._mjs_navRevalidate plus bas) au `document` COURANT. Opt-out puis gardes AVANT tout, TITRE ensuite,
// MÉTADONNÉES en dernier (réconciliation PAR CLÉ, cf. µ._mjs_navHeadReconcile juste au-dessus).
µ._mjs_navApplyHead = function(doc) {
  try { µ._mjs_navCsrf(doc); } catch {} // AVANT la désactivation : le jeton suit toujours
  if (µ.config && µ.config.navHead === false) { return; } // désactivation globale, cf. bandeau
  try {
    var t, table, kids, i, key, node;
    // Un <head> ABSENT ou VIDE (`doc.head.children.length === 0`, cf. bandeau) ne veut RIEN dire de
    // la page reçue — sortie immédiate, RIEN ne change (jamais interprété comme « efface tout »).
    if (!doc || !doc.head || !doc.head.children || doc.head.children.length === 0) { return; }
    t = doc.querySelector('title');
    // Titre absent ou blanc : ne JAMAIS effacer le titre affiché — on garde ce qui est déjà là.
    if (t && typeof t.textContent === 'string' && t.textContent.trim() !== '') {
      document.title = t.textContent.trim();
    }
    table = {};
    kids = doc.head.children;
    for (i = 0; i < kids.length; i++) {
      node = kids[i];
      key = µ._mjs_navHeadKeyOf(node);
      if (key) { table[key] = { tag: node.tagName, attrs: µ._mjs_navHeadAttrs(node), node: node }; } // dernier gagnant si doublon
    }
    µ._mjs_navHeadReconcile(table);
  } catch {} // une réconciliation de tête ne doit JAMAIS faire tomber la navigation
};

// PHOTO du <head> COURANT — prise par µ._mjs_navHibernate PENDANT que la page à archiver est
// ENCORE affichée (donc le <head> photographié est bien LE SIEN), posée sur `nodes._mjs_mjsHead` (même
// patron que `nodes._mjs_mjsCachePolicy`, cf. µ._mjs_navHibernate plus bas). `attrs` : TOUS les attributs du
// nœud (pas seulement `content`/`href`) — µ._mjs_navRestoreHead en a besoin pour reconstruire un nœud
// NEUF si celui d'origine a disparu du <head> courant entre-temps (une autre page, restée affichée
// plus longtemps, a pu retirer cette clé). Gardée (`document.head` absent) : jamais de throw.
µ._mjs_navSnapshotHead = function() {
  var metas, kids, i, key, node, head;
  metas = [];
  head = document.head;
  kids = head && head.children;
  if (kids) {
    for (i = 0; i < kids.length; i++) {
      node = kids[i];
      key = µ._mjs_navHeadKeyOf(node);
      if (key) { metas.push({ key: key, tag: node.tagName, attrs: µ._mjs_navHeadAttrs(node) }); }
    }
  }
  return { title: document.title, metas: metas };
};

// RESTAURATION depuis une PHOTO — appelée aux 2 restaurations cache-hit SYNCHRONES (popstate/
// clic, cf. leurs call-sites plus bas) : sans elle, un Précédent vers une page en cache garderait le
// titre de la page qu'on quitte (le bogue à l'envers) — les composants restaurés sont RÉVEILLÉS
// (µawake) et non re-montés, leur <@head><title> ne re-tire JAMAIS. `snap` absent (page mise en cache
// avant ce mécanisme, ou hibernée en 'no-cache') → aucun changement.
µ._mjs_navRestoreHead = function(snap) {
  var table, i, m;
  if (!snap) { return; }
  table = {};
  for (i = 0; i < snap.metas.length; i++) {
    m = snap.metas[i];
    table[m.key] = { tag: m.tag, attrs: m.attrs };
  }
  µ._mjs_navHeadReconcile(table);
  // `typeof snap.title === 'string'` SEUL, `snap.title !==
  // ''` RETIRÉ : une PHOTO (µ._mjs_navSnapshotHead) est le portrait COMPLET d'une page qu'on a RÉELLEMENT
  // affichée — un titre vide y est une INFORMATION (« cette page n'avait pas de titre »), jamais une
  // absence d'information, donc jamais un motif pour laisser traîner le titre de la page qu'on quitte.
  // DIFFÉRENT de µ._mjs_navApplyHead (juste au-dessus) : celui-là lit une page qui ARRIVE (réponse HTTP en
  // cours de parse) — un <title> absent ou blanc y signifie « je ne dis RIEN du titre » (un serveur qui
  // ne pilote pas le titre d'onglet, un fragment de gabarit incomplet), jamais « efface celui affiché » —
  // raison pour laquelle µ._mjs_navApplyHead, LUI, garde son test `!== ''` (`t.textContent.trim() !== ''`).
  if (typeof snap.title === 'string') { document.title = snap.title; }
};

// HIBERNATION — la page quittée est PHOTOGRAPHIÉE (lecture de `childNodes`, cf. call-sites
// popstate/clic/_mjs_navDispatch plus bas), jamais retirée sur le champ : le retrait réel n'a lieu
// qu'au prochain µ._mjs_zoneFill (le swap), sinon le contenant resterait vide pendant tout un fetch
// réseau en vol (exactement comme `replaceWith` ne détachait l'ancien contenu QU'AU swap).
// Vide `zone` puis y insère `nodes` (tableau, dans l'ordre) — `replaceChildren` s'il existe
// (natif, happy-dom des tests l'implémente aussi), sinon boucle retrait+réinsertion (ES5,
// ce fichier reste du style CoffeeScript compilé : pas de spread).
// >>> extrait-test _mjs_zoneFill
µ._mjs_zoneFill = function(zone, nodes) {
  var i;
  µ._mjs_navContainer = zone; // contenant courant du cache de pages (cf. µ._mjs_navCacheZone plus haut)
  µ._mjs_navHibernated = null; // hibernation consommée normalement : ce fill VIDE le contenant
  if (typeof zone.replaceChildren === 'function') {
    zone.replaceChildren.apply(zone, nodes);
    return;
  }
  while (zone.firstChild) { zone.removeChild(zone.firstChild); }
  for (i = 0; i < nodes.length; i++) { zone.appendChild(nodes[i]); }
};
// <<< extrait-test _mjs_zoneFill

// AJOUTE `nodes` à la SUITE du contenu déjà présent dans `zone`, sans RIEN retirer (method
// 'append') — miroir de µ._mjs_zoneFill mais sans vidage préalable. µ._mjs_navDropHibernation AVANT tout
// ajout : le contenu que la navigation vient de photographier pour le cache de pages (cf. bandeau
// HIBERNATION plus bas) reste PHYSIQUEMENT ici (un append ne le retire jamais) — sans ce nettoyage,
// ses nœuds garderaient `_mjs_page_cached` à vie (fuite : composants exemptés de destruction pour
// toujours) et l'entrée `µ.pageCache` sous le chemin quitté pointerait des nœuds encore VIVANTS.
// >>> extrait-test _mjs_zoneAppend
µ._mjs_zoneAppend = function(zone, nodes) {
  var i;
  µ._mjs_navContainer = zone; // contenant courant du cache de pages (cf. µ._mjs_navCacheZone plus haut)
  µ._mjs_navDropHibernation();
  for (i = 0; i < nodes.length; i++) { zone.appendChild(nodes[i]); }
};
// <<< extrait-test _mjs_zoneAppend

// DÉ-HIBERNATION — consomme µ._mjs_navHibernated si un `append` en a hérité un (posé aux 3 sites
// `pageCache.set`, plus bas, jamais consommé par un µ._mjs_zoneFill normal) : remet `_mjs_page_cached` à
// `false` sur ses nœuds ÉLÉMENTS (ils restent vivants, un append ne les a jamais détachés) et retire
// l'entrée périmée de `µ.pageCache` — sinon un retour arrière vers le chemin quitté réinstallerait
// SEULEMENT ces nœuds-là, effaçant tout ce que l'append a ajouté depuis.
// >>> extrait-test _mjs_navDropHibernation
µ._mjs_navDropHibernation = function() {
  var h, i;
  µ._mjs_navLeft = null; // la page reste affichée, plus rien ne la quitte (cf. µ._mjs_navHibernate)
  if (!µ._mjs_navHibernated) { return; }
  h = µ._mjs_navHibernated;
  for (i = 0; i < h.nodes.length; i++) { if (h.nodes[i].nodeType === 1) { h.nodes[i]._mjs_page_cached = false; } }
  if (µ.pageCache && typeof µ.pageCache.delete === 'function') { µ.pageCache.delete(h.path); }
  µ._mjs_navHibernated = null;
};
// <<< extrait-test _mjs_navDropHibernation

// FACTORISATION — corps commun aux 3 sites d'hibernation (popstate/clic/soumission GET dans
// µ._mjs_navDispatch, plus bas), avant identiques et dupliqués trois fois : photographie `zone.childNodes`,
// flag `_mjs_page_cached` sur les nœuds ÉLÉMENTS, `µ._mjs_saveScroll`, `pageCache.set` + µ._mjs_navHibernated.
// Point de passage UNIQUE qui rend la politique de cache par page tenable à poser une seule fois.
//
// POLITIQUE (µ._mjs_navCachePolicy, la page qu'on QUITTE, cf. sa déclaration plus haut) :
// - 'no-cache' → AUCUNE entrée n'est créée (ni pageCache.set, ni flag, ni µ._mjs_navHibernated) : un retour
//   arrière refera une vraie requête. `_mjs_saveScroll`, LUI, tourne quand même : la
//   position de scroll est une Map INDÉPENDANTE du LRU pageCache (cf. tête de fichier, même raisonnement
//   déjà appliqué au cache-miss réseau) — refuser la mise en cache DOM (le poids mémoire d'un arbre
//   vivant) n'a aucune raison de sacrifier aussi le confort du retour au bon endroit après le re-fetch ;
//   alternative écartée : sauter aussi `_mjs_saveScroll`, qui aurait remis le scroll à zéro sur un simple
//   opt-out de cache, régression UX sans rapport avec l'intention de `no-cache`.
// - 'revalidate' → entre au cache NORMALEMENT (comme 'cache-first'), MAIS le tableau `nodes` porte en
//   plus une propriété `_mjs_mjsCachePolicy = 'revalidate'` — DIRECTEMENT sur le tableau (comme
//   `_mjs_page_cached` est posé directement sur chaque nœud), jamais une Map à part : bornée par
//   construction par le MÊME LRU que pageCache, zéro structure supplémentaire à garder en synchro à
//   l'éviction. Consommée par les restaurations cache-hit (_swapPopCache/_swapClickCache) pour décider
//   d'un rafraîchissement en fond (µ._mjs_navRevalidate).
// - 'cache-first' → rien ne change, comportement historique.
//
// ÉVÉNEMENT before-cache — émis juste avant de poser le flag et d'archiver : MJS hiberne un
// arbre VIVANT (une modale ouverte, un menu déplié, un tiroir sorti ressortent tels quels au retour
// arrière) — avant cet instant, l'application peut refermer ce qui doit l'être. Pas émis en 'no-cache'
// (rien n'est archivé, rien à nettoyer avant). Enveloppé (try/catch) : ni un écouteur qui jette, ni
// l'absence de `document.dispatchEvent` (harnais de test minimal), ne doivent empêcher `pageCache.set`
// — même défense que µ._mjs_navWarnScripts plus haut.
µ._mjs_navHibernate = function(zone, path) {
  var policy, nodes, i, headSnap;
  // scroll sauvegardé pour TOUTE page qui pourra être revisitée par l'historique, même sans
  // zone hibernable (method:'replace' -> µ._mjs_navCacheZone() rend null) : sorti de la garde `!zone`,
  // même schéma déjà appliqué à la sortie 'no-cache' juste en dessous.
  if (path != null && typeof µ._mjs_saveScroll === 'function') { µ._mjs_saveScroll(path); }
  // la page quittée, avec le numéro de la navigation qui la quitte (lien, retour, soumission GET), reste affichée
  // jusqu'à l'arrivée de la page demandée : un retour sur l'une de ses entrées avant cette arrivée abandonne la
  // navigation et la laisse telle quelle (cf. popstate), politique de cache ou zone comprises. Le repère ne vaut que
  // pour cette navigation en vol : son numéro le périme dès qu'une autre part, il tombe quand elle arrive (`mjs:load`,
  // µ._mjs_navEmit) ou s'achève sans rien installer (µ._mjs_navDropHibernation, envoi sans page reçue)
  µ._mjs_navLeft = path + ' ' + µ._mjs_navSeq;
  if (!zone || path == null || !µ.pageCache || typeof µ.pageCache.set !== 'function') { return; }
  policy = µ._mjs_navCachePolicy || 'cache-first';
  if (policy === 'no-cache') { return; }
  // la barre de navigation, posée dans <body> par une navigation qui dure, et la modale ouverte (fermée à l'arrivée de la
  // page, cf. mjs_modal.ts) ne sont pas de la page : laissées hors de la photo, sinon elles revenaient à l'écran avec la
  // page, sans plus rien pour les retirer
  nodes = Array.prototype.filter.call(zone.childNodes, function(n) { return n !== µ._mjs_navProgressEl && n !== µ._mjs_modalLayer; });
  try {
    document.dispatchEvent(new CustomEvent('mjs:before-cache', { detail: { path: path, zone: zone }, bubbles: true, cancelable: false }));
  } catch {}
  for (i = 0; i < nodes.length; i++) { if (nodes[i].nodeType === 1) { nodes[i]._mjs_page_cached = true; } }
  if (policy === 'revalidate') { nodes._mjs_mjsCachePolicy = 'revalidate'; nodes._mjs_mjsReceived = µ._mjs_navReceived; }
  // photo prise MAINTENANT, pendant que la page à archiver est ENCORE affichée (seule fenêtre où
  // `document.title`/`document.head` décrivent encore CETTE page, avant que la navigation ne les remplace).
  // posée INCONDITIONNELLEMENT, plus seulement « si elle dit
  // quelque chose » : cette condition était FAUSSE — une page SANS titre ni métadonnée pilotée n'était
  // alors JAMAIS photographiée, et au retour cache-hit vers elle, le titre ET les métadonnées de la page
  // quittée entre-temps restaient collés dessus (µ._mjs_navRestoreHead ne reçoit RIEN à restaurer sans photo,
  // cf. son commentaire). Prouvé par exécution.
  headSnap = µ._mjs_navSnapshotHead();
  nodes._mjs_mjsHead = headSnap;
  µ.pageCache.set(path, nodes);
  µ._mjs_navHibernated = { path: path, nodes: nodes };
};

// REVALIDATION EN FOND (policy 'revalidate') — appelée juste après une restauration cache-hit
// synchrone (_swapPopCache/_swapClickCache) dont l'entrée porte `_mjs_mjsCachePolicy === 'revalidate'` : le
// contenu déjà affiché n'attend PAS ce fetch (zéro régression de vitesse), une requête GET part en fond
// vérifier sa fraîcheur. `µ._mjs_ajaxRequest` appelé DIRECTEMENT (pas µ._mjs_navRequest, qui pose toujours
// X-MJS-Nav) : la comparaison porte sur du HTML (innerHTML du contenant, cf. plus bas) — poser
// X-MJS-Nav ferait répondre `mjs serve` en JSON (fiche protocole), incomparable à un tableau de nœuds
// DOM déjà installés (cf. commentaire de µ._mjs_ajaxRequest dans mjs_ajax.ts, second consommateur voulu).
// Jamais de pushState, jamais µ.nav.active (silencieux, ce n'est pas une navigation visible) : aucun des
// deux n'est posé ici. Annulation : `seq` capturé AVANT le départ, comme tout fetch ujs — une navigation
// plus récente (µ._mjs_navSeq bumpé ailleurs, clic/popstate/submit) invalide la réponse tardive, réutilise
// le jeton EXISTANT plutôt que d'en réinventer un (µ._mjs_navController/_mjs_abortStaleNav n'est PAS touché ici :
// il est partagé avec les navigations PRINCIPALES, l'abandonner depuis un simple rafraîchissement de fond
// couperait un fetch de navigation réel qui serait par ailleurs en vol).
// >>> extrait-test _mjs_navRevalidate
µ._mjs_navRevalidate = function(zone, path) {
  var seq, received;
  if (typeof µ._mjs_ajaxRequest !== 'function') { return; }
  seq = µ._mjs_navSeq;
  received = µ._mjs_navReceived; // la page restaurée telle que reçue (posée par la restauration, juste avant cet appel)
  µ._mjs_ajaxRequest({
    method: 'GET',
    url: path,
    success: function(html, finalUrl, _schemaKey, nav) {
      var doc, parser, zoneInfo, newRoot, freshTarget, differs, newNodes, _fresh, _asked, _print;
      if (seq !== µ._mjs_navSeq || !zone) { return; } // navigation plus récente : réponse jetée
      if (!html || typeof html !== 'string') { return; } // réponse JSON/vide : hors périmètre de cette comparaison HTML
      // REDIRECTION SUIVIE — `fetch` suit nativement un 302 : la réponse peut être une AUTRE page
      // (session expirée → /login). Sans cette garde, un rafraîchissement de FOND déversait le
      // contenu de cette autre page dans le contenant courant, sans toucher l'URL affichée :
      // l'utilisateur se croyait toujours sur la page demandée. Un refetch silencieux n'a pas à
      // décider d'une navigation — on abandonne, la prochaine navigation RÉELLE verra la redirection.
      // origine comparée aussi : renvoyée au même chemin d'une autre origine, la page du tiers jouerait ses gestionnaires en
      // ligne avec l'origine du site
      if (finalUrl) {
        try {
          _fresh = new URL(finalUrl, window.location.href);
          _asked = new URL(path, window.location.href);
          if (_fresh.origin !== _asked.origin || _fresh.pathname + _fresh.search !== _asked.pathname + _asked.search) { return; }
        } catch { return; }
      }
      // `nav.reload`/`nav.method` REÇUS ICI : DÉLIBÉRÉMENT jamais lus sur ce chemin, même esprit
      // que la garde de redirection juste au-dessus. Ce refetch est un rafraîchissement SILENCIEUX de
      // fond (contenu déjà affiché, l'utilisateur n'a RIEN demandé) : un `X-MJS-Reload` y emporterait la
      // page sous ses yeux sans le moindre geste de sa part. `nav.method` n'a de toute façon aucun effet
      // ici — cette fonction ne passe jamais par µ._mjs_navInstallNodes, elle compare puis appelle
      // µ._mjs_zoneFill directement.
      // la page que le serveur rend à une navigation du framework : la même confiance que la page chargée en entier,
      // lue par la politique `mjs` (Trusted Types), comme aux quatre autres lectures de ce fichier
      parser = new DOMParser();
      doc = parser.parseFromString(µ._mjs_th(html), 'text/html');
      freshTarget = (nav && typeof nav.target === 'string' && nav.target) ? nav.target : null;
      zoneInfo = µ._mjs_navMountZone(doc, freshTarget);
      newRoot = zoneInfo.zone;
      if (!newRoot) { return; }
      newNodes = Array.prototype.slice.call(newRoot.childNodes);
      _print = newNodes.map(function(n) { return n.outerHTML || n.nodeValue; }).join('');
      // signature bon marché (PAS d'arbres DOM comparés) : X-MJS-Version PRIORITAIRE si présent des
      // deux côtés (build changé depuis le chargement de cette page ⇒ considéré différent sans même
      // comparer le HTML) ; à défaut, la page reçue maintenant contre celle reçue la fois précédente — jamais
      // contre le DOM vivant : un composant qui pose un attribut sur sa balise (prop reflétée, `theme`) rendait
      // la comparaison toujours fausse et remontait la page à chaque retour (repli sur le DOM vivant sans empreinte)
      if (nav && nav.version && µ.version && nav.version !== µ.version) {
        differs = true;
      } else {
        differs = typeof received === 'string' ? _print !== received : newRoot.innerHTML !== zone.innerHTML;
      }
      if (!differs) { return; } // identique : rien ne bouge, aucun clignotement
      µ._mjs_navTransplantPermanents(zone, newNodes); // 3e site de vidage — sans ça, un rafraîchissement de FOND détruisait le permanent en silence
      if (µ._mjs_navI18nSeed) { µ._mjs_navI18nSeed(doc); }
      µ._mjs_navPageFile(doc);
      µ._mjs_navApplyHead(doc); // APRÈS le test `differs` : un rafraîchissement de fond qui ne change rien ne touche pas non plus la tête
      µ._mjs_zoneFill(zone, newNodes);
      µ._mjs_navReceived = _print;
      // L'entrée de cache de ce chemin pointe encore les nœuds qu'on vient de DÉTACHER : on la
      // retire plutôt que de la laisser mentir jusqu'au prochain départ. Le prochain retour arrière
      // redemandera la page au serveur — c'est exactement ce que `revalidate` promet.
      if (µ.pageCache && typeof µ.pageCache.delete === 'function') { µ.pageCache.delete(path); }
    },
    error: function() {} // échec réseau en fond : silencieux, le contenu déjà affiché reste tel quel
  });
};
// <<< extrait-test _mjs_navRevalidate

// 1er nœud ÉLÉMENT d'un tableau installé (texte/commentaire ignorés) — cible de
// µ._mjs_focusAfterSwap après un swap en tableau (cf. les 5 fonctions de swap plus bas).
// >>> extrait-test _mjs_navFirstEl
µ._mjs_navFirstEl = function(nodes) {
  var i;
  for (i = 0; i < nodes.length; i++) { if (nodes[i].nodeType === 1) { return nodes[i]; } }
  return null;
};
// <<< extrait-test _mjs_navFirstEl

// AVERTISSEMENT <SCRIPT> DANS LE CONTENU ÉCHANGÉ — un <script> inséré par un swap (innerHTML/
// appendChild, jamais document.write) ne s'exécute JAMAIS : règle du DOM, pas un choix de MJS. `nodes`
// : tableau de nœuds AVANT le swap (cf. les 3 sites HTML plus bas, appelés sur `newNodes`). N'appelle
// et ne relance JAMAIS (enveloppe try/catch globale, même défense que le sélecteur de
// µ._mjs_navMountZone : un contenu échangé exotique ne doit jamais faire jeter la navigation).
µ._mjs_navScriptWarned = {}; // signatures de <script> déjà signalées (une fois chacune)
// types RÉELLEMENT exécutables par le navigateur (casse insensible) — absent/vide vaut
// 'text/javascript' implicite (spec HTML). Tout AUTRE type ('application/json', 'importmap',
// 'text/template'…) porte des DONNÉES, jamais du code : ignoré, il ne bruite jamais l'avertissement.
µ._mjs_navExecScriptTypes = { '': 1, 'text/javascript': 1, 'application/javascript': 1, 'text/ecmascript': 1, 'application/ecmascript': 1, 'module': 1 };
µ._mjs_navWarnScripts = function(nodes) {
  try {
    var scripts = [], loadedSrcs = [], i, j, n, kids, sig, type, srcEls;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (!n || n.nodeType !== 1) { continue; }
      if (n.tagName === 'SCRIPT') { scripts.push(n); }
      if (typeof n.querySelectorAll === 'function') {
        kids = n.querySelectorAll('script');
        for (j = 0; j < kids.length; j++) { scripts.push(kids[j]); }
      }
    }
    if (!scripts.length) { return; }
    // scripts déjà chargés dans la page COURANTE (le bundle de l'app relayé par le gabarit
    // apparaîtrait sinon à CHAQUE navigation) : comparés par URL RÉSOLUE (`el.src`), pas l'attribut brut.
    srcEls = document.querySelectorAll('script[src]');
    for (i = 0; i < srcEls.length; i++) { loadedSrcs.push(srcEls[i].src); }
    for (i = 0; i < scripts.length; i++) {
      type = ((typeof scripts[i].getAttribute === 'function' && scripts[i].getAttribute('type')) || '').toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(µ._mjs_navExecScriptTypes, type)) { continue; }
      if (scripts[i].src) {
        if (loadedSrcs.indexOf(scripts[i].src) !== -1) { continue; }
        sig = scripts[i].src;
      } else {
        sig = (scripts[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }
      if (Object.prototype.hasOwnProperty.call(µ._mjs_navScriptWarned, sig)) { continue; }
      µ._mjs_navScriptWarned[sig] = true;
      µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsScriptSwapped', { sig: sig }, '<script> détecté dans le contenu échangé : le navigateur ne ré-exécute JAMAIS un <script> injecté (règle du DOM) — ce code ne tournera pas. Déplacez-le dans un composant MJS (µmount), ou posez :noUJS sur les liens qui mènent à cette page. Script : {sig}'));
    }
  } catch {}
};

// ÉLÉMENTS PERMANENTS `mjs-permanent` — un nœud qui porte cet attribut ET un `id` traverse
// une navigation SANS être recréé (lecteur audio qui joue, chat ouvert, panneau et son défilement) :
// avant toute installation (µ._mjs_navInstallNodes plus bas, modes 'update'/'replace' — 'append' ne
// retire rien, rien à transplanter), le nœud est APPARIÉ PAR ID entre l'arbre affiché (`zone`) et
// l'arbre qui arrive (`nodes`) ; le nœud VIVANT est TRANSPLANTÉ (déplacé, jamais cloné/recréé) à la
// place de son homologue ENTRANT. SYNCHRONE, dans le MÊME tick que l'installation qui suit (aucun
// `await`/microtask entre les deux) : mjs_element.ts ressuscite un composant reconnecté avant que sa
// destruction différée (microtask de disconnectedCallback) n'ait eu l'occasion de tourner — un
// aller-retour détaché→rattaché étalé sur deux ticks le ferait passer par une destruction complète.
//
// `_mjs_navFindById`/`_mjs_navFindByIdIn` : comparaison MANUELLE de `.id`, jamais un sélecteur CSS interpolé
// (`'#'+id`) — un `id` peut porter des caractères qui casseraient un tel sélecteur (espace, `:`…), un
// simple parcours d'arbre n'a besoin d'aucun échappement.
// >>> extrait-test _mjs_navFindByIdIn
µ._mjs_navFindByIdIn = function(node, id, depth) {
  var kids, i, found;
  // plafond de profondeur (même valeur que µ._mjs_deepFind, plus haut dans ce fichier) : un arbre
  // pathologique au-delà d'une dizaine de milliers de niveaux plantait la récursion (RangeError) —
  // repli id non trouvé, comme n'importe quelle recherche qui échoue.
  if (!node || node.nodeType !== 1 || depth > 50) { return null; }
  if (node.id === id) { return node; }
  kids = node.children;
  if (!kids) { return null; }
  for (i = 0; i < kids.length; i++) {
    found = µ._mjs_navFindByIdIn(kids[i], id, depth + 1);
    if (found) { return found; }
  }
  return null;
};
// <<< extrait-test _mjs_navFindByIdIn
// >>> extrait-test _mjs_navFindById
µ._mjs_navFindById = function(nodes, id) {
  var i, found;
  for (i = 0; i < nodes.length; i++) {
    found = µ._mjs_navFindByIdIn(nodes[i], id, 0);
    if (found) { return found; }
  }
  return null;
};
// <<< extrait-test _mjs_navFindById
// AVERTI UNE FOIS PAR ÉLÉMENT (drapeau porté par le nœud, même patron que µ._mjs_navWarnNoUjsMethod plus
// haut) : sans `id`, aucun appariement possible entre deux navigations — le nœud n'est simplement
// jamais transplanté, détruit normalement avec le reste de la page quittée.
// >>> extrait-test _mjs_navWarnPermanentNoId
µ._mjs_navWarnPermanentNoId = function(el) {
  if (!el || el._mjs_mjsPermanentNoIdWarned) { return; }
  el._mjs_mjsPermanentNoIdWarned = true;
  µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsPermanentNoId', null, '[mjs-permanent] sans id ignoré — un appariement entre deux navigations exige un id stable sur cet élément.'));
};
// <<< extrait-test _mjs_navWarnPermanentNoId
// AVERTI UNE FOIS PAR ID (clé globale, pas un drapeau de nœud : c'est l'ID qui est en cause, pas
// l'élément) — deux nœuds VIVANTS partageant le même `id` : le HTML l'interdit déjà, mais rien ne
// l'empêchait ici et le second évinçait silencieusement le premier du document.
µ._mjs_navPermanentDupWarned = {};
µ._mjs_navWarnPermanentDupId = function(id) {
  if (Object.prototype.hasOwnProperty.call(µ._mjs_navPermanentDupWarned, id)) { return; }
  µ._mjs_navPermanentDupWarned[id] = true;
  µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsPermanentDupId', { id: id }, '[mjs-permanent] id \'{id}\' porté par PLUSIEURS éléments — un seul peut traverser la navigation, les autres partent avec la page quittée. Un id doit être unique dans le document.'));
};
// >>> extrait-test _mjs_navTransplantPermanents
µ._mjs_navTransplantPermanents = function(zone, nodes) {
  var permanents, found, i, j, live, id, incoming, transplanted, places;
  if (!zone || !nodes || !nodes.length) { return; }
  places = []; // [parent, suivant, copie reçue] : la place que chaque vivant quitte dans l'arbre qui part
  permanents = [];
  // `zone` elle-même peut porter l'attribut (pas seulement ses descendants). Ordre du DOCUMENT
  // (querySelectorAll) : un ANCÊTRE permanent est donc toujours traité avant ses descendants
  // permanents — la garde `incoming === live` juste dessous en dépend.
  if (µ._mjs_matches(zone, '[mjs-permanent]')) { permanents.push(zone); }
  if (typeof zone.querySelectorAll === 'function') {
    found = zone.querySelectorAll('[mjs-permanent]');
    for (i = 0; i < found.length; i++) { permanents.push(found[i]); }
  }
  transplanted = []; // nœuds vivants DÉJÀ posés dans l'arbre entrant (détection des id dupliqués)
  for (i = 0; i < permanents.length; i++) {
    live = permanents[i];
    id = live.id;
    if (!id) { µ._mjs_navWarnPermanentNoId(live); continue; }
    incoming = µ._mjs_navFindById(nodes, id);
    if (!incoming) { continue; } // la page qui arrive ne le réclame pas : comportement normal, rien à transplanter
    // PERMANENT IMBRIQUÉ DANS UN PERMANENT — l'ancêtre a déjà été transplanté, ce nœud est donc DÉJÀ
    // dans l'arbre entrant : il s'y retrouve lui-même comme homologue. Sans cette garde,
    // `vivant.replaceWith(vivant)` le RETIRE du document sans jamais le réinsérer (perte silencieuse).
    if (incoming === live) { continue; }
    // ID DUPLIQUÉ entre deux nœuds vivants — l'homologue trouvé est un permanent qu'on vient de poser :
    // sans cette garde, ce second nœud évinçait le premier, déjà transplanté, du document.
    if (transplanted.indexOf(incoming) !== -1) { µ._mjs_navWarnPermanentDupId(id); continue; }
    if (live.parentNode) { places.push([live.parentNode, live.nextSibling, incoming]); }
    µ._mjs_swap(incoming, live); // no-op DOM silencieux si `incoming` est une racine sans parent (cf. boucle sous)
    for (j = 0; j < nodes.length; j++) { if (nodes[j] === incoming) { nodes[j] = live; } } // racine du tableau : l'entrée elle-même
    transplanted.push(live);
  }
  // la copie reçue reprend la place quittée dans l'arbre qui part (archivé au cache de pages) : un Précédent servi
  // par le cache y retrouve l'élément par son id et le rend au vivant, même imbriqué dans une enveloppe (enfant
  // direct du contenant, le tableau archivé le tient déjà). Posée en microtâche, une fois cet arbre sorti de la
  // page par l'installation synchrone qui suit — jamais dans un arbre affiché, où elle serait connectée
  // (composant monté, <iframe> chargée) : si l'arbre y est encore, la place reste vide
  if (places.length) {
    Promise.resolve().then(function() {
      var k, s;
      for (k = 0; k < places.length; k++) {
        s = places[k];
        if (s[0].isConnected || s[2].parentNode || typeof s[0].insertBefore !== 'function') { continue; }
        try { s[0].insertBefore(s[2], (s[1] && s[1].parentNode === s[0]) ? s[1] : null); } catch {}
      }
    });
  }
};
// <<< extrait-test _mjs_navTransplantPermanents

// BARRE DE NAVIGATION : µ._mjs_navProgressStart/Stop vivent dans mjs_nav_progress.ts (partagés avec le
// routeur), présents dès que ce module l'est.

// Installe un TABLEAU de nœuds (contenu HTML échangé, cf. les 3 sites de swap plus bas) dans le
// contenant résolu par µ._mjs_navMountZone. Quatre valeurs de `method` :
// - 'none' → RIEN n'est installé (« ne bouge pas » — cf. bandeau juste avant le corps ci-dessous).
// - 'replace' ET zone ≠ <body> ET détachable (parentNode) → le contenant CÈDE SA PLACE (replaceWith,
//   suivi par µ._mjs_navTrackZone sur le 1er nœud ÉLÉMENT : la navigation suivante retrouve ce module tant
//   qu'il reste monté) ; visant <body> (JAMAIS remplacé lui-même) → averti une fois, dégradé en 'update'.
// - 'append' → le contenant SURVIT, `nodes` s'ajoute à la SUITE de ce qui est déjà là (µ._mjs_zoneAppend,
//   rien n'est retiré), suivi neutralisé.
// - sinon ('update', défaut — toute valeur déjà normalisée en amont par µ._mjs_navMethodOf) → le contenant
//   SURVIT, vidé puis réinjecté (µ._mjs_zoneFill), suivi neutralisé.
// RENVOIE le contenant EFFECTIF après installation :
// `zoneInfo.zone` se DÉTACHE en 'replace' réel (isConnected===false après le replaceWith) — un appelant
// qui capturait `zoneInfo.zone` AVANT cet appel (tous les sites d'émission de `mjs:load`, plus bas)
// obtenait donc un nœud MORT pour `detail.zone`. 'append'/'update'/'replace' dégradé <body> → la zone
// elle-même (inchangée, jamais détachée sur ces 3 chemins). 'none' → `null` (cf. corps ci-dessous).
// >>> extrait-test _mjs_navInstallNodes
µ._mjs_navInstallNodes = function(zoneInfo, nodes, method, cache) {
  var _parent;
  // 'none' : rien à installer, la page AFFICHÉE reste affichée telle quelle. Les trois états de
  // zone (µ._mjs_navContainer/µ._mjs_navTrackZone/µ._mjs_navCachePolicy) décrivent CETTE page toujours montée —
  // aucun des trois ne bouge ici. Seule l'hibernation posée AVANT que la réponse n'arrive (par le site
  // appelant, cf. µ._mjs_navHibernate) est annulée : sans ce nettoyage, les nœuds encore affichés
  // resteraient marqués hibernés (composants exemptés de destruction à vie, entrée µ.pageCache pointant
  // des nœuds pourtant vivants) — même remède que µ._mjs_zoneAppend juste plus bas, même raison.
  if (method === 'none') {
    µ._mjs_navDropHibernation();
    return null;
  }
  // page 'revalidate' : empreinte du contenu REÇU, prise avant que ses composants n'y touchent — la revalidation
  // la compare à la page redemandée (µ._mjs_navRevalidate), jamais au DOM vivant
  µ._mjs_navReceived = cache === 'revalidate' ? Array.prototype.map.call(nodes, function(n) { return n.outerHTML || n.nodeValue; }).join('') : null;
  if (method === 'replace' && zoneInfo.zone !== document.body && zoneInfo.zone.parentNode) {
    _parent = zoneInfo.zone.parentNode; // capturé AVANT le replaceWith : zoneInfo.zone se détache juste après
    µ._mjs_navTransplantPermanents(zoneInfo.zone, nodes); // AVANT que le contenant ne cède sa place
    // le `replaceWith` de la balise, jamais celui d'un composant du même nom (`@replaceWith = ->` laissait la zone en place)
    if (typeof Element === 'function' && zoneInfo.zone instanceof Element) { Element.prototype.replaceWith.apply(zoneInfo.zone, nodes); }
    else { zoneInfo.zone.replaceWith.apply(zoneInfo.zone, nodes); }
    µ._mjs_navContainer = false; // plus de contenant stable : cette page ne se cache pas
    µ._mjs_navTrackZone(µ._mjs_navFirstEl(nodes)); // le 1er ÉLÉMENT, pas nodes[0] (peut être du texte)
    µ._mjs_navCachePolicy = cache || 'cache-first'; // la page qui vient de s'installer, à côté du suivi de zone
    return _parent;
  }
  if (method === 'replace' && zoneInfo.zone === document.body && !µ._mjs_navReplaceBodyWarned) {
    µ._mjs_navReplaceBodyWarned = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsReplaceNoTarget', null, 'method \'replace\' sans target : <body> n\'est jamais remplacé — contenu remplacé à la place.'));
  }
  if (method === 'append') {
    µ._mjs_zoneAppend(zoneInfo.zone, nodes);
    µ._mjs_navTrackZone(null);
    µ._mjs_navCachePolicy = cache || 'cache-first';
    return zoneInfo.zone;
  }
  µ._mjs_navTransplantPermanents(zoneInfo.zone, nodes); // AVANT le vidage (µ._mjs_zoneFill emporterait le permanent avec le reste)
  µ._mjs_zoneFill(zoneInfo.zone, nodes);
  µ._mjs_navTrackZone(null);
  µ._mjs_navCachePolicy = cache || 'cache-first';
  return zoneInfo.zone;
};
// <<< extrait-test _mjs_navInstallNodes

// Enveloppe mince de µ._mjs_navInstallNodes pour le cas UN SEUL nœud (composant JSON, panneau 404) —
// appelants inchangés (µ._mjs_navApplyJson, µ._mjs_navShowNotFound), délègue avec `[el]`. RENVOIE la
// valeur de µ._mjs_navInstallNodes telle quelle — propage le contenant effectif à qui en a besoin.
// >>> extrait-test _mjs_navInstallInZone
µ._mjs_navInstallInZone = function(zoneInfo, el, method, cache) {
  return µ._mjs_navInstallNodes(zoneInfo, [el], method, cache);
};
// <<< extrait-test _mjs_navInstallInZone

// Restauration d'une page du cache, commune au retour arrière / avant (popstate) et au clic : `seq` = numéro de la
// navigation qui la demande, `zone` = contenant visé (capturé AVANT hibernation), `nodes` = entrée du cache, `path` =
// page restaurée, `end` = la suite (routeur, mjs:load), rappelée en DERNIÈRE ligne — une transition de vue
// (µ._mjs_vtWrapSwap) peut différer tout ce corps, la suite attend l'installation réelle. `anchor` : un clic vers une
// ancre de cette page, qui y va (µ._mjs_anchorArrive) au lieu de rendre la position gardée
µ._mjs_navSwapCache = function(seq, zone, nodes, path, end, anchor) {
  // swap PÉRIMÉ sous transition de vue : cf. bandeau de `swap` dans µ._mjs_navApplyJson.
  if (seq !== µ._mjs_navSeq) { return; }
  var i;
  µ._mjs_navRestoreHead(nodes._mjs_mjsHead); // même ordre que le chemin réseau : tête d'abord, contenu ensuite
  µ._mjs_navTransplantPermanents(zone, nodes); // ce site vide `zone` en court-circuitant µ._mjs_navInstallNodes
  µ._mjs_zoneFill(zone, nodes);
  // Fin d'hibernation : sans ce reset, l'arbre restauré gardait le flag à
  // vie et ses composants échappaient À JAMAIS à la destruction différée.
  for (i = 0; i < nodes.length; i++) { if (nodes[i].nodeType === 1) { nodes[i]._mjs_page_cached = false; } }
  µ._mjs_navTrackZone(null); // le contenant survit, plus rien à suivre
  µ._mjs_navCachePolicy = nodes._mjs_mjsCachePolicy || 'cache-first'; // la politique de CETTE page revit avec elle
  µ._mjs_navReceived = nodes._mjs_mjsReceived; // et son empreinte reçue (revalidation)
  µ._mjs_lastUjsPath = path;
  if (anchor && typeof µ._mjs_anchorArrive === 'function') {
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    µ._mjs_anchorArrive();
  }
  else { µ._mjs_restoreScroll(path); }
  // Accessibilité : cache-hit = swap synchrone, focus quand même déplacé
  // (cf. `_mjs_focusAfterSwap` plus haut) — l'origine du contenu (cache ou
  // réseau) n'a pas à changer le comportement pour un lecteur d'écran.
  // APRÈS `_mjs_restoreScroll` (ordre voulu : `{preventScroll:true}` empêche déjà
  // tout scroll parasite du focus, mais la restauration de position reste
  // l'étape qui « termine » la navigation, le focus la clôt).
  if (typeof µ._mjs_focusAfterSwap === 'function') { µ._mjs_focusAfterSwap(µ._mjs_navFirstEl(nodes), nodes); }
  // 'revalidate' : le cache-hit reste immédiat (rien ci-dessus n'attend le réseau), une
  // vérification part en fond APRÈS l'affichage (jamais avant, zéro régression de vitesse).
  if (nodes._mjs_mjsCachePolicy === 'revalidate') { µ._mjs_navRevalidate(zone, path); }
  end();
};

// RÉSOLUTION CROISÉE DU CONTENANT (chemin HTML UNIQUEMENT) — le chemin HTML a DEUX documents :
// la page affichée et la réponse parsée. Le contenant doit exister des DEUX côtés. Absent de la
// RÉPONSE (gabarit différent : page de connexion, page legacy, erreur…), remplir le contenant courant
// avec le <body> ENTIER de la réponse imbriquerait tout son habillage (en-tête, pied) DANS la cible —
// page visiblement cassée, et en SILENCE (µ._mjs_navMountZone n'avertit que pour le document COURANT,
// jamais pour une réponse parsée). On dégrade alors les
// DEUX côtés sur <body> — la page qui ARRIVE porte son propre habillage, le résultat reste juste —
// avec un avertissement une fois par sélecteur distinct. Le cas inverse (présent côté réponse, absent
// côté page) reste géré par µ._mjs_navMountZone lui-même (repli <body> + son propre avertissement).
µ._mjs_navResolveZones = function(doc, target) {
  var newInfo = µ._mjs_navMountZone(doc, target);
  if (target && newInfo.mode !== 'target') {
    if (!Object.prototype.hasOwnProperty.call(µ._mjs_navRespTargetWarned, target)) {
      µ._mjs_navRespTargetWarned[target] = true;
      µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsTargetMissingReceived', { target: target }, 'cible de navigation \'{target}\' introuvable dans la page reçue — contenu de <body> remplacé (des deux côtés).'));
    }
    target = null;
    newInfo = µ._mjs_navMountZone(doc, null);
  }
  return { newZone: newInfo.zone, liveInfo: µ._mjs_navMountZone(document, target) };
};

// Panneau « Page introuvable » du protocole JSON (404 PATHNAME, cf.
// docs/21-navigation.md) — même classe/mêmes libellés que celui du routeur
// hash (_mjs_showNoMatch, mjs_router.ts) mais ciblé sur le CONTENANT DE NAVIGATION
// (cf. bandeau ci-dessus) plutôt que sur la 1ʳᵉ `<@view>` : une navigation JSON 404
// n'a par nature AUCUNE vue routée montée (aucune route pathname ne
// correspond) — rien à quoi raccrocher `_mjs_showNoMatch` tel quel (choix
// signalé). Respecte `µ.config.routeNotFound` comme le routeur. `target`/
// `method` (optionnels, repli `null`/'update' — les appelants existants sans
// ces arguments continuent de marcher) : mêmes clés de fiche que le cas
// nominal (µ._mjs_navApplyJson), un 404 porte lui aussi un contenant/mode. `cache` (idem repli
// `undefined` → 'cache-first' via µ._mjs_navInstallInZone) : un panneau 404 s'installe comme une page
// ordinaire, sa politique de cache suit la même fiche.
// RENVOIE le contenant EFFECTIF après installation — valeur de µ._mjs_navInstallInZone propagée
// telle quelle : µ._mjs_navApplyJson (branche 404) s'en sert pour detail.zone, capturer le contenant
// AVANT cet appel (comme précédemment) redonnait un nœud DÉTACHÉ en method:'replace' (cf.
// µ._mjs_navInstallNodes). Modes 'silent'/'warn' : sortie AVANT toute installation — RENVOIE désormais
// `false` plutôt que le contenant : `µ._mjs_navApplyJson` (branche 404)
// s'en sert pour GARDER `opts.onSwapped()`, qui ne doit JAMAIS tourner sans installation réelle
// (poison symétrique à `method:'none'`, cf. son bandeau — un 404 silencieux avançait quand même
// `µ._mjs_lastUjsPath`). Mode 'error' : valeur TOUJOURS truthy (le contenant réel, INCHANGÉ) — detail.zone
// ne bouge pas.
µ._mjs_navShowNotFound = function(matchPath, target, method, cache) {
  var mode, msg, rt, label, write, zoneInfo, box, h, p, code, style;
  mode = (µ.config && µ.config.routeNotFound) || 'error';
  if (mode === 'silent') { µ._mjs_logger()?.('[µ.UJS] ' + µ._mjs_txt('ujsNoPage', { matchPath: matchPath }, 'Aucune page ne correspond à \'{matchPath}\'.')); return false; }
  msg = '[µ.UJS] ' + µ._mjs_txt('ujsNoPage', { matchPath: matchPath }, 'Aucune page ne correspond à \'{matchPath}\'.');
  if (mode === 'warn') { µ.warn(msg); return false; }
  µ.error(msg);
  rt = µ.Router;
  // µ._mjs_label (mjs_init.ts) choisit la langue AFFICHÉE, avant le routeur
  // (fallback si `Router` absent de ce build) puis le repli littéral fr codé en dur.
  label = function(k) {
    var v;
    if (typeof µ._mjs_label === 'function') {
      v = µ._mjs_label('router', k);
      if (v) { return v; }
    }
    if (rt && typeof rt._mjs_routerLabel === 'function') { return rt._mjs_routerLabel(k); }
    return { notFound: 'Page introuvable', noRoute: 'Aucune route ne correspond à cette adresse.' }[k];
  };
  zoneInfo = µ._mjs_navMountZone(document, target);
  box = document.createElement('div');
  box.setAttribute('data-mjs-route-error', '');
  box.className = 'mjs-route-error';
  h = document.createElement('strong');
  p = document.createElement('p');
  // les libellés : récrits à l'arrivée du fichier de la langue s'il les surcharge, le panneau encore affiché (µ._mjs_labelKeep, mjs_i18n.ts)
  write = function() { h.textContent = label('notFound'); p.textContent = label('noRoute'); };
  if (µ._mjs_labelKeep) { µ._mjs_labelKeep(write); }
  else { write(); }
  code = document.createElement('code'); code.textContent = matchPath;
  box.appendChild(h); box.appendChild(p); box.appendChild(code);
  if (µ._csp) {
    // sous `µ._csp` : feuille constructible unique, adoptée une seule fois sur `document`
    // (le CSS du panneau est statique, pas besoin d'un <style> par appel).
    if (!µ._mjs_ujsRouteErrorSheetAdopted) {
      var errorSheet = new CSSStyleSheet();
      errorSheet.replaceSync(µ._mjs_routeErrorCss);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, errorSheet];
      µ._mjs_ujsRouteErrorSheetAdopted = true;
    }
  } else {
    style = document.createElement('style');
    style.textContent = µ._mjs_routeErrorCss;
    // marquée pour la règle qui la cache (cf. _mjs_routeErrorCss) : une règle de la page qui rend
    // visibles les enfants (`* { display: block }`) afficherait sinon son CSS en texte
    style.setAttribute('data-mjs-route-error-css', '');
    // style FRÈRE du texte dans `box` (jamais dans le textContent) — rendu identique, mais `box`
    // s'installe seul (plus de fragment) : la zone reste traçable à la navigation suivante.
    box.appendChild(style);
  }
  return µ._mjs_navInstallInZone(zoneInfo, box, method, cache);
};

// veilleur central flash/error : au moment où un sac de props SERVEUR entre au magasin
// (nominal/none/422/1er chargement, cf. leurs sites d'appel), CONSOMME `props.flash`/`props.error`
// (delete AVANT que le sac n'entre au magasin — `props.errors`, PLURIEL, erreurs PAR CHAMP, n'est
// JAMAIS touché) et les affiche selon la politique effective. Sans aucune des deux clés : inerte,
// zéro coût notable (2 hasOwnProperty). Politique : attribut `mjs-flash` de l'ÉLÉMENT D'ORIGINE
// d'abord ('popup'/'console'/'silent', autre valeur → µ.warn une fois + repli politique globale) ;
// sinon µ.config.flash (mjs_init.ts) : 'popup' (défaut) | 'console' | fonction `(type, message) => …`
// (type ∈ 'flash'|'error') | false (veilleur COUPÉ — clés NON consommées, µres les porte intactes).
var _navFlashAttrWarned = false;
var _navFlashModalWarned = false;
µ._mjs_navFlashPolicy = function(originEl) {
  var attr, cfg;
  attr = (originEl && typeof originEl.getAttribute === 'function' && originEl.hasAttribute('mjs-flash')) ? originEl.getAttribute('mjs-flash') : null;
  if (attr === 'popup' || attr === 'console' || attr === 'silent') { return attr; }
  if (attr && !_navFlashAttrWarned) {
    _navFlashAttrWarned = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsFlashUnknown', { attr: attr }, 'mjs-flash="{attr}" : valeur non reconnue (popup/console/silent attendus) — politique globale utilisée.'));
  }
  cfg = µ.config && µ.config.flash;
  if (cfg === false) { return false; }
  if (typeof cfg === 'function') { return cfg; }
  if (cfg === 'console') { return 'console'; }
  return 'popup'; // défaut, y compris clé absente
};
// affichage brut par le canal résolu — réutilisé tel quel par l'échec transport (µ._mjs_navDispatch/fail,
// plus bas : aucun sac à consommer là-bas, juste un message synthétique) : séparé de µ._mjs_navFlash
// justement pour ce partage.
µ._mjs_navFlashShow = function(type, message, policy) {
  if (policy === false || policy === 'silent') { return; }
  if (typeof policy === 'function') { policy(type, message); return; }
  if (policy === 'console') {
    if (type === 'error') { console.error(message); } else { console.info(message); }
    return;
  }
  // 'popup' — même détection de module absent que µ.confirm plus haut.
  if (µ.modal && typeof µ.modal.fire === 'function') {
    if (type === 'error') { µ.modal.error(message); } else { µ.modal.notify(message, { type: 'success' }); }
    return;
  }
  if (!_navFlashModalWarned) {
    _navFlashModalWarned = true;
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsFlashNoModal', null, 'flash/error à afficher mais µ.modal est absent (module \'modal\' non inclus dans `runtime`) — repli console/alert.'));
  }
  // `typeof window.alert === 'function'` — défensif, MÊME garde que µ.confirm plus haut
  // (`typeof window.confirm === 'function'`) : environnement sans alert (SSR, sandbox de test) →
  // silencieux plutôt qu'un crash pour un simple message de repli.
  if (type === 'error') { if (typeof window.alert === 'function') { window.alert(message); } } else { console.info(message); }
};
µ._mjs_navFlash = function(props, originEl) {
  var policy, hasFlash, hasError, f, e;
  if (!props) { return; }
  hasFlash = Object.prototype.hasOwnProperty.call(props, 'flash');
  hasError = Object.prototype.hasOwnProperty.call(props, 'error');
  if (!hasFlash && !hasError) { return; } // inerte
  policy = µ._mjs_navFlashPolicy(originEl);
  if (policy === false) { return; } // veilleur coupé : clés NON consommées, µres intact
  if (hasFlash) { f = props.flash; delete props.flash; µ._mjs_navFlashShow('flash', f, policy); }
  if (hasError) { e = props.error; delete props.error; µ._mjs_navFlashShow('error', e, policy); }
};

// @callback (mjs-callback) : sur SUCCÈS de navigation SEULEMENT (fiche nominale appliquée ET
// method:'none' — jamais 422, jamais échec transport, jamais popstate, cf. leurs sites d'appel) —
// remonte depuis l'élément PORTEUR de l'attribut (l'élément d'origine lui-même, ou son plus proche
// ancêtre via `closest`) vers le premier nœud (lui compris) qui définit une méthode de CE nom, et
// l'appelle avec le vocabulaire des événements de cycle. `originEl` doit être encore MONTÉ
// (isConnected) : un clic dont le conteneur vient d'être remplacé par le swap n'a plus personne à
// notifier (nœud mort). Boucle ≤50 sauts, traverse les shadow roots via getRootNode().host — même
// esprit que µ.Element::_mjs_findBoundary (mjs_failed.ts).
µ._mjs_navCallbackClimb = function(startEl, name) {
  var node = startEl, hops = 0;
  while (node && hops++ < 50) {
    if (typeof node[name] === 'function') { return node; }
    node = node.parentNode || (node.getRootNode ? node.getRootNode().host : null);
  }
  return null;
};
µ._mjs_navRunCallback = function(originEl, detail) {
  var callbackEl, name, target;
  if (!originEl || !originEl.isConnected || typeof originEl.closest !== 'function') { return; }
  callbackEl = (typeof originEl.hasAttribute === 'function' && originEl.hasAttribute('mjs-callback')) ? originEl : µ._mjs_closest(originEl, '[mjs-callback]');
  if (!callbackEl) { return; }
  name = callbackEl.getAttribute('mjs-callback');
  if (!name) { return; }
  target = µ._mjs_navCallbackClimb(callbackEl, name);
  if (!target) {
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsCallbackMissing', { name: name, tag: callbackEl.tagName.toLowerCase() }, ':callback="{name}" : aucune méthode « {name} » trouvée sur {tag} ni ses ancêtres — rappel ignoré.'));
    return;
  }
  // un rappel qui LÈVE traversait la fonction : le swap DOM avait déjà eu lieu, mais
  // `µ.Router.navigate()` et l'événement `mjs:load` (point d'accroche recommandé pour
  // l'analytique) ne partaient JAMAIS. Même convention que `mjs_socket.ts::_mjs_dispatch` — chaque
  // rappel d'application est isolé, l'échec est DIT, jamais avalé en silence.
  try { target[name](detail); } catch (e) { µ.error('[µ.UJS] :callback="'+ name +'"', e); }
};

// `µ._mjs_navApplyJson(json, finalUrl, opts)` — applique une réponse JSON du
// protocole de navigation (docs/21-navigation.md « Le protocole serveur »).
// `opts.push` (bool, défaut false) : pousser l'historique vers la destination
// finale — FAUX pour un popstate (l'historique a déjà bougé) ou un lien
// same-URL déjà poussé au clic (correction éventuelle laissée au call-site,
// comme pour le chemin HTML existant) ; VRAI pour un PRG (submit qui
// redirige) ou un form GET dont l'URL n'a pas encore été posée par ce chemin.
µ._mjs_navApplyJson = function(json, finalUrl, opts) {
  var dest, target, method, cache, title, bare, known, el, zone, swap, via, evPaths, installedZone, originEl, destOrigin, destProtocol, destUrl, liveOrigin, leave;
  dest = finalUrl || json.url;
  opts = opts || {};
  // origine RÉELLE de `dest`, calculée UNE FOIS (sert aux 2 sites `pushState` plus bas) :
  // jamais un `µ._mjs_finalPathFor` externe ici — cette fonction vit dans le bloc 'helpers-navigation',
  // extrait SEUL par de nombreux tests existants (sans le bloc séparé `_mjs_finalPathFor`). `liveOrigin`
  // absent (harnais de test minimal, sans `window.location.origin`) → jamais de comparaison hasardeuse,
  // repli sur le comportement historique : seul un VRAI navigateur (où `window.location.origin`
  // existe TOUJOURS) peut faire jouer la garde.
  // résolu contre `document.baseURI` (repli
  // `window.location.href` si absent), EXACTEMENT comme µ._mjajaxSameOrigin (mjs_ajax.ts) :
  // `history.pushState` natif résout aussi contre baseURI, jamais location.href — un `<base href>`
  // tiers faisait juger "même origine" une URL relative qui partait RÉELLEMENT ailleurs (SecurityError
  // natif malgré ce garde-fou, prouvé Chromium). `destProtocol` calculé ICI pour le même usage aux 2
  // sites plus bas : une destination hors origine et non http(s) (javascript:/data:/blob:…) ne doit
  // JAMAIS atteindre µ._mjs_hardNav, qui exécuterait le script au lieu de naviguer (prouvé Chromium).
  liveOrigin = window.location && window.location.origin;
  if (liveOrigin) {
    try {
      destUrl = new URL(dest, (typeof document !== 'undefined' && document.baseURI) || window.location.href);
      destOrigin = destUrl.origin;
      destProtocol = destUrl.protocol;
    } catch { destOrigin = liveOrigin; destProtocol = null; }
  }
  // rechargement complet (version du bundle changée, module illisible ou inconnu) : même garde de protocole que
  // µ._mjs_hardNav, recopiée ici (bloc extrait seul par les tests, sans elle) — `dest` peut venir de la fiche
  // (`json.url`), une adresse `javascript:`/`data:`… y exécuterait son code au lieu de naviguer
  leave = function() {
    if (destProtocol && destProtocol !== 'http:' && destProtocol !== 'https:') {
      µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsHardNavProtocol', { destination: dest }, 'navigation dure refusée, protocole non http/https : {destination}'));
      return;
    }
    window.location.assign(dest);
  };
  // `via` transmis par l'appelant (popstate/clic réseau/_mjs_navDispatch, cf. leurs 3 call-sites) ;
  // défaut 'link' (repli raisonnable pour cette fonction, pensée pour la navigation liée).
  via = opts.via || 'link';
  // `originEl` (veilleur flash/error + @callback) : l'élément ayant déclenché CETTE
  // navigation (lien mjs-method/formulaire soumis via µ._mjs_navDispatch, OU lien ordinaire cliqué —
  // cf. leurs bandeaux respectifs, `opts.el`) — absent SEULEMENT au popstate (repli `null`,
  // politique globale, cf. son site d'appel).
  originEl = opts.el || null;
  // `dest` (finalUrl ou json.url) PEUT être ABSOLUE (`finalUrl` = `response.url`, TOUJOURS
  // absolue par construction du Fetch API — prouvé sur le chemin popstate, cf. µ._mjs_navEmitPaths) :
  // path/url de detail calculés SANS l'origine — `dest` lui-même reste INTACT (pushState/
  // window.location.assign/création de l'élément en dépendent tel quel, origine comprise).
  evPaths = µ._mjs_navEmitPaths(dest);
  // clés `target`/`method` de la fiche : le CONTENANT (sélecteur CSS, absent = <body>) et
  // ce qu'on en fait ('update' défaut = contenu vidé puis réinjecté, contenant intact ; 'append' =
  // contenu existant CONSERVÉ, module ajouté à la suite ; 'replace' = le contenant cède sa place au
  // module). Normalisation PARTAGÉE avec le chemin HTML : µ._mjs_navMethodOf (valeur inconnue → 'update' +
  // averti une fois par valeur distincte). `cache` : même patron, µ._mjs_navCachePolicyOf — SEUL
  // canal pour le chemin JSON (pas de balise <meta>, propre au HTML, cf. µ._mjs_navCacheOf).
  target = (typeof json.target === 'string' && json.target) ? json.target : null;
  method = µ._mjs_navMethodOf(json.method);
  cache = µ._mjs_navCachePolicyOf(json.cache);
  // `title` (jusqu'ici lu par AUCUN chemin) : la fiche peut imposer le titre d'onglet, un
  // back applicatif qui parle ce protocole sans composant `<@head><title>` en a désormais le moyen.
  // Absent/vide → `null`, aucun contact avec `document.title` (repli sûr, comportement historique).
  title = (typeof json.title === 'string' && json.title) ? json.title : null;
  // `reload` : un ordre EXPLICITE du serveur passe avant une version DÉDUITE — placé AVANT la
  // garde de version juste en dessous, donc avant toute installation, tout pushState, toute émission
  // mjs:load.
  if (µ._mjs_navReloadAsked(json.reload)) {
    µ._mjs_navHardReload(dest);
    return;
  }
  // version : le bundle a changé depuis le chargement de CETTE page — monter
  // un composant/des props neufs avec l'ancien JS est un terrain miné (formes
  // de compilation potentiellement incompatibles) ; rechargement complet,
  // plus sûr que d'improviser une compatibilité inter-versions.
  if (json.version && µ.version && json.version !== µ.version) {
    leave();
    return;
  }
  // `method:'none'` : « ne bouge pas », traité AVANT la résolution de `json.module` (un back qui
  // répond `none` peut légitimement envoyer `module: null` — ce n'est PAS un 404, ne pars donc pas dans
  // la branche panneau « Page introuvable » juste en dessous). Seules les props sont appliquées, en
  // FUSION (µ._mjs_resMerge, mjs_store_globals.ts — jamais µ._mjs_resSet, qui remplacerait tout le sac : ici
  // aucune nouvelle page n'arrive, la page affichée et ses props survivent). Ni création d'élément, ni
  // µ._mjs_navInstallInZone, ni µ._mjs_focusAfterSwap, ni µ._mjs_vtWrapSwap, ni pushState (même si `opts.push` est
  // vrai), ni µ.Router.navigate, ni mjs:load : l'adresse affichée ne change pas, rien n'a été monté.
  // µ._mjs_navDropHibernation() APPELÉ ICI EXPLICITEMENT : ce chemin ne passe
  // JAMAIS par µ._mjs_navInstallNodes (dont le propre court-circuit 'none' droppe déjà l'hibernation, cf.
  // son bandeau — inatteignable depuis ICI) — pourtant `µ._mjs_navHibernate` a pu tourner AVANT ce point,
  // pour CETTE MÊME navigation, sur les 2 sites qui appellent `_mjs_navApplyJson` avec une réponse JSON
  // (clic/popstate, systématiquement ; `µ._mjs_navDispatch` sur son seul chemin GET, cf. son bandeau) —
  // sans cet appel, une navigation qui hiberne au clic/popstate PUIS reçoit `method:'none'` en JSON
  // laisserait les nœuds affichés marqués hibernés à vie (composants exemptés de destruction, entrée
  // µ.pageCache pointant des nœuds pourtant vivants). Idempotent, sans effet si rien n'est en vol.
  if (method === 'none') {
    µ._mjs_navDropHibernation();
    // consomme props.flash/props.error AVANT que le sac n'entre au magasin (µ._mjs_navFlash
    // mute `json.props` en place, cf. son bandeau) ; module ujs tree-shaké → garde d'existence.
    if (typeof µ._mjs_navFlash === 'function') { µ._mjs_navFlash(json.props || {}, originEl); }
    if (typeof µ._mjs_resMerge === 'function') { µ._mjs_resMerge(json.props || {}); }
    // @callback : APRÈS l'installation du sac (état déjà à jour quand le rappel tourne).
    // `status` : ce chemin n'existe que sur une réponse JSON EXPLOITÉE (jamais atteint si le fetch a
    // échoué, cf. mjs_ajax.ts) — 200 par construction, code EXACT non propagé jusqu'ici (hors zone).
    if (typeof µ._mjs_navRunCallback === 'function') { µ._mjs_navRunCallback(originEl, { path: evPaths.path, url: evPaths.url, status: 200, via: via }); }
    return;
  }
  if (json.module === null) {
    // 404 PÉRIMÉ : garde EN
    // TÊTE de branche, même raisonnement que le bandeau `swap` nominal plus bas — une navigation
    // plus RÉCENTE a pu démarrer PENDANT que cette réponse était en vol et gagner le DOM ; ce chemin ne
    // connaît AUCUNE transition différée (pas de µ._mjs_vtWrapSwap sur la branche 404, toujours synchrone),
    // donc les 3 sites d'appel normaux (popstate/clic/_mjs_navDispatch) ont TOUJOURS déjà écarté un
    // `opts.seq` périmé avant d'atteindre cette fonction (leur propre garde synchrone, cf. leurs 3
    // bandeaux) — cette garde vise un appelant DIRECT (défense en profondeur). Rien n'est installé, rien
    // n'est poussé, aucun événement émis : `µ._mjs_navDropHibernation()` volontairement PAS appelée
    // (l'hibernation courante appartient à la navigation gagnante, pas à celle-ci — même remarque que le
    // bandeau `swap` plus bas).
    if (opts.seq != null && opts.seq !== µ._mjs_navSeq) { return; }
    // 404 côté serveur (aucune page ne matche ce pathname) — même sémantique
    // que le 404 du routeur hash (µ.config.routeNotFound).
    // `dest` HORS ORIGINE (redirection suivie par fetch vers un autre host, ou `json.url`
    // absolu mal formé côté back) : jamais de pushState (SecurityError natif non catché, même risque
    // que µ._mjs_finalPathFor, cf. son bandeau) — navigation dure à la place.
    if (opts.push) {
      // protocole testé EN PREMIER, avant le
      // test d'origine : un `blob:` de MÊME origine (`URL.origin` vaut l'origine qui l'a créé, par
      // spec) passait tout droit la branche « même origine » vers `window.history.pushState`, qui
      // REJETTE pourtant un blob: (même « même origine ») avec SecurityError natif non catché
      // (confirmé sur Chromium réel) — l'ancien contrôle ne vivait QUE dans la branche
      // « origine différente » juste en dessous, jamais atteinte dans ce cas.
      if (liveOrigin && destProtocol !== 'http:' && destProtocol !== 'https:') { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsHardNavOutside', { dest: dest }, 'navigation abandonnée, url hors origine et protocole non http/https : {dest}')); return; }
      if (liveOrigin && destOrigin !== liveOrigin) {
        return µ._mjs_hardNav(dest);
      }
      window.history.pushState({}, '', dest);
    }
    if (µ.Router && typeof µ.Router._mjs_updateUrlStore === 'function') { µ.Router._mjs_updateUrlStore(); }
    // un panneau « Page introuvable » a droit à son titre, SYNCHRONE, comme le cas nominal.
    if (title) { document.title = title; }
    // contenant EFFECTIF retourné par µ._mjs_navShowNotFound (celui capturé AVANT l'installation,
    // via µ._mjs_navMountZone, se détache en method:'replace', cf. µ._mjs_navInstallNodes) — capturé ici pour
    // detail.zone plus bas. FALSY (`false`) en modes 'silent'/'warn' (cf. bandeau de
    // µ._mjs_navShowNotFound) : rien n'a été installé, sert de garde juste en dessous.
    installedZone = µ._mjs_navShowNotFound(dest, target, method, cache);
    // RÉGRESSION corrigée : `opts.onSwapped` (posée par les 3 appelants,
    // cf. leurs bandeaux) tournait ICI même en modes 'silent'/'warn', où `µ._mjs_navShowNotFound` n'installe
    // RIEN (sort AVANT toute installation) — `onSwapped` y écrit pourtant `µ._mjs_lastUjsPath` vers la
    // destination 404 et défile (window.scrollTo/µ._mjs_restoreScroll) : incohérence DOM/chemin, poison
    // symétrique à l'ancien `method:'none'` (cf. son bandeau plus haut). `installedZone` (truthy
    // SEULEMENT si un panneau a RÉELLEMENT été installé, mode 'error' — falsy sinon) sert désormais de
    // garde ; l'ancienne comparaison `opts.seq` ici est devenue REDONDANTE (la garde ajoutée en TÊTE de
    // cette branche a déjà écarté tout `opts.seq` périmé avant ce point) et retirée.
    if (typeof opts.onSwapped === 'function' && installedZone) { opts.onSwapped(); }
    // mjs:load : un panneau 404 est une installation réussie (le contenant a bien reçu quelque
    // chose) — seuls les cas version/module inconnus (ci-dessus/ci-dessous) partent en rechargement dur.
    // ÉMIS DANS TOUS LES CAS, installation réelle ('error') ou pas ('silent'/'warn') :
    // signal TERMINAL de la navigation (une appli qui affiche un indicateur de chargement au départ doit
    // le voir se terminer, cf. µ.nav.active/barre de progression) — délibérément PAS gardé par
    // `installedZone`, à la différence de `opts.onSwapped` juste au-dessus.
    µ._mjs_navEmit('load', { path: evPaths.path, url: evPaths.url, via: via, zone: installedZone, initial: false }, false);
    return;
  }
  // json.module non-chaîne (réponse serveur malformée, nombre/objet) faisait
  // lever .replace() DANS le rappel de succès (exception avalée par le pipeline fetch, page laissée
  // telle quelle sous une URL déjà poussée). Même issue que le module inconnu juste en dessous :
  // rechargement complet, jamais un throw.
  if (typeof json.module !== 'string' || !json.module) {
    leave();
    return;
  }
  bare = json.module.replace('mjs-', '');
  known = (µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, bare)) ||
    (typeof customElements !== 'undefined' && !!customElements.get(json.module));
  if (!known) {
    // bundle périmé côté client (manifeste ignorant de ce module, et pas déjà
    // défini) : rechargement complet plutôt qu'un montage impossible.
    leave();
    return;
  }
  // cas nominal — el/zone calculés AVANT l'enveloppe (pushState idem) ; swap (resSet + montage +
  // focus) enveloppé dans la transition de page (mjs-vt), MIROIR des chemins HTML (cf.
  // click/popstate/submit) : avant, ce chemin montait SANS JAMAIS passer par µ._mjs_vtWrapSwap —
  // une transition configurée était perdue dès que le serveur parlait le protocole JSON.
  // opts.onSwapped (optionnel, threadée par les 3 sites d'appel clic/
  // popstate/_mjs_navDispatch) : un scroll posé par l'appelant JUSTE APRÈS le retour (SYNCHRONE) de
  // cette fonction arrivait AVANT la permutation réelle quand µ._mjs_vtWrapSwap DIFFÈRE `swap` (rappel
  // async de document.startViewTransition) — la page QUITTÉE était ramenée en haut avant le swap.
  // onSwapped, si fournie, est appelée ICI-MÊME, DANS swap(), après l'installation et le focus,
  // avant µ._mjs_navRunCallback — toujours dans le MÊME tick que le swap réel, différé ou pas. Branches
  // method:'none' (plus haut) et module:null/404 (plus haut) : rien n'est permuté, onSwapped n'y
  // est JAMAIS appelée (aucun swap à y attacher).
  el = document.createElement(json.module);
  zone = µ._mjs_navMountZone(document, target);
  // même garde que la branche 404 ci-dessus : `dest` hors origine → navigation dure, jamais
  // un pushState qui lève un SecurityError non catché (cf. bandeau plus haut).
  if (opts.push) {
    // même garde de protocole, testée EN PREMIER, que la branche 404 ci-dessus
    // (code dupliqué, même régression blob: même origine, confirmé sur Chromium réel).
    if (liveOrigin && destProtocol !== 'http:' && destProtocol !== 'https:') { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsHardNavOutside', { dest: dest }, 'navigation abandonnée, url hors origine et protocole non http/https : {dest}')); return; }
    if (liveOrigin && destOrigin !== liveOrigin) {
      return µ._mjs_hardNav(dest);
    }
    window.history.pushState({}, '', dest);
  }
  // µ._mjs_vtWrapSwap peut DIFFÉRER `swap` (rappel de
  // document.startViewTransition, asynchrone) : la queue ci-dessous (navigate + mjs:load), avant
  // posée juste APRÈS l'appel à µ._mjs_vtWrapSwap, s'exécutait alors AVANT l'installation réelle —
  // `mjs:load` partait avec `zone: undefined` (`installedZone` pas encore affecté à ce moment) et le
  // routeur se resynchronisait sur l'ANCIEN DOM. `_afterSwap` se rappelle désormais en DERNIÈRE ligne
  // de `swap`, après @callback (même ordre relatif qu'avant : callback puis navigate puis load) :
  // sans transition de vue (`_mjs_vtWrapSwap` appelle `swap()` SYNCHRONEMENT), l'ordre observable reste
  // IDENTIQUE à aujourd'hui.
  var _afterSwap = function() {
    // MIROIR de la queue du swap HTML existant (cf. click/popstate, plus bas) : resynchronise
    // µ.url/<@view>. document.title : la fiche pose le titre si elle en porte un (SYNCHRONE,
    // ci-dessus, avant même cette ligne) ; le <@head><title> d'un composant qui arrive tire ensuite
    // dans sa microtâche et garde toujours le dernier mot ; le silence du serveur (title:null) ne
    // change rien au titre déjà affiché. L'autoloader charge le module seul à l'insertion
    // (MutationObserver mjs_autoloader.ts, observe(document.body) en subtree — rien à appeler ici).
    if (µ.Router && typeof µ.Router.navigate === 'function') { µ.Router._mjs_follow = 1; µ.Router.navigate(dest, false); }
    // mjs:load : APRÈS installation ET resynchronisation du routeur. zone: le
    // contenant EFFECTIF retourné par µ._mjs_navInstallInZone (zone.zone est détaché en method:'replace').
    µ._mjs_navEmit('load', { path: evPaths.path, url: evPaths.url, via: via, zone: installedZone, initial: false }, false);
  };
  swap = function() {
    // swap PÉRIMÉ sous transition de vue : `µ._mjs_vtWrapSwap`
    // peut DIFFÉRER `swap` (rappel de document.startViewTransition, asynchrone) ; une navigation plus
    // récente a pu démarrer PENDANT ce délai (`µ._mjs_navSeq` déjà rebumpé) — sans cette garde, le swap
    // périmé installait son propre DOM PAR-DESSUS celui de la navigation gagnante, et sa queue
    // (`_afterSwap` : navigate + mjs:load) partait APRÈS celle de la navigation gagnante (ordre
    // inversé, aggravation du défaut ci-dessus). `opts.seq` posé par les 3 appelants (popstate/
    // clic/_mjs_navDispatch, cf. leurs 3 sites d'appel) ; absent → jamais périmé, comportement identique
    // à avant. Hibernation (µ._mjs_navHibernated/µ.pageCache) : la navigation la PLUS RÉCENTE hiberne à
    // SON tour la page encore affichée (celle-ci n'a pas encore changé, le swap périmé n'a jamais
    // tourné) SOUS LA MÊME CLÉ — son hibernation REMPLACE celle du swap périmé et sera consommée
    // normalement par SON propre swap (µ._mjs_zoneFill) ; le swap périmé, lui, n'a plus rien à consommer
    // en sortant ici — µ._mjs_navDropHibernation() viserait l'hibernation COURANTE (celle de la
    // navigation gagnante) et la détruirait à tort : PAS appelée ici.
    if (opts.seq != null && opts.seq !== µ._mjs_navSeq) { return; }
    // consomme props.flash/props.error AVANT que le sac n'entre au magasin (delete en
    // place sur `json.props`, cf. µ._mjs_navFlash) ; module ujs tree-shaké → garde d'existence.
    if (typeof µ._mjs_navFlash === 'function') { µ._mjs_navFlash(json.props || {}, originEl); }
    if (typeof µ._mjs_resSet === 'function') { µ._mjs_resSet(json.props || {}); }
    // titre posé ICI, SYNCHRONE, AVANT l'installation (même ordre que le chemin HTML,
    // µ._mjs_navApplyHead) : le composant qui arrive peut porter son propre <@head><title>, qui tire
    // ensuite dans SA microtâche (µ.effect, cf. µ._setHead/mjs_runes.ts) et gagne TOUJOURS — aucune
    // priorité codée en dur, seul l'ordre naturel décide.
    if (title) { document.title = title; }
    // valeur RETOURNÉE : le contenant EFFECTIF après installation (zone.zone se détache en
    // method:'replace', cf. µ._mjs_navInstallNodes) — capturée ici pour detail.zone plus bas.
    installedZone = µ._mjs_navInstallInZone(zone, el, method, cache);
    if (typeof µ._mjs_focusAfterSwap === 'function') { µ._mjs_focusAfterSwap(el); }
    // cf. bandeau ci-dessus : APRÈS le focus, AVANT @callback.
    if (typeof opts.onSwapped === 'function') { opts.onSwapped(); }
    // @callback : APRÈS l'installation de la page (état déjà à jour quand le rappel
    // tourne). `status` : 200 par construction (même remarque que la branche 'none' plus haut).
    if (typeof µ._mjs_navRunCallback === 'function') { µ._mjs_navRunCallback(originEl, { path: evPaths.path, url: evPaths.url, status: 200, via: via }); }
    // DERNIÈRE ligne de `swap` : cf. bandeau `_afterSwap` ci-dessus.
    _afterSwap();
  };
  if (typeof µ._mjs_vtWrapSwap === 'function') { µ._mjs_vtWrapSwap(opts.vtLink || null, swap); } else { swap(); }
};

// Canal interne UJS — même moteur que µ.ajax.* (µ._mjs_ajaxRequest, alias de
// `_request` exposé par mjs_ajax.ts) mais pose TOUJOURS l'en-tête
// `X-MJS-Nav: 1` (négociation du protocole de navigation, cf. render-server.ts
// et docs/21-navigation.md) — canal INTERNE, jamais exposé publiquement : un
// µ.ajax.get/post/... appelé par l'application ne porte JAMAIS cet en-tête,
// seuls `_mjs_ajaxGet`/`_mjs_navDispatch` (ce fichier) l'utilisent. Signature calquée
// sur `_request` (method/url/data/success/error/always/timeout/signal) plutôt
// que sur un verbe précis de µ.ajax — un seul point d'entrée pour
// GET/DELETE/POST/PUT/PATCH.
// une réponse venue d'une AUTRE origine (redirection du serveur suivie par fetch, que le tiers autorise par CORS) : le navigateur seul
// aurait quitté le site pour elle. Jamais rendue à la navigation — sa page, installée dans celle du site, y jouerait ses gestionnaires
// en ligne (`onerror`, `onclick`) avec l'origine du site ; sa fiche JSON y poserait ses props. Adresse illisible : tenue pour étrangère ;
// sans origine de page à comparer (harnais sans `location.origin`, qu'un navigateur porte toujours), rien n'est jugé
µ._mjs_navForeign = function(u) {
  var here = window.location && window.location.origin;
  if (!u || !here) { return false; }
  try { return new URL(u, window.location.href).origin !== here; } catch { return true; }
};
µ._mjs_navRequest = function(method, url, data, success, error, always, timeout, signal) {
  // module runtime 'ajax' absent du cœur : aucune requête ne peut partir — averti une fois, une lecture part par le navigateur
  if (typeof µ._mjs_navNoAjax === 'function' && µ._mjs_navNoAjax()) {
    if (method === 'GET' || method === 'HEAD') { µ._mjs_hardNav(url); }
    return;
  }
  return µ._mjs_ajaxRequest({
    method: method,
    url: url,
    data: data,
    headers: { 'X-MJS-Nav': '1' },
    // le jeton CSRF qu'une réponse porte en en-tête, réussie ou refusée (µ._mjs_navCsrfHeader)
    // réponse d'une autre origine, réussie ou refusée : rien d'elle ne passe (corps, en-têtes X-MJS-*), l'appelant reçoit un échec
    // qui ne porte que son adresse (`foreign`) — un lien repart par le navigateur, un envoi va à cette adresse (µ._mjs_navDispatch)
    success: typeof success === 'function' ? function(body, finalUrl, schemaKey, nav) {
      if (µ._mjs_navForeign(finalUrl)) { return typeof error === 'function' ? error({ foreign: true, url: finalUrl }) : void 0; }
      µ._mjs_navCsrfHeader(nav, finalUrl, signal);
      return success(body, finalUrl, schemaKey, nav);
    } : success,
    error: typeof error === 'function' ? function(err) {
      if (err && µ._mjs_navForeign(err.url)) { return error({ foreign: true, url: err.url }); }
      µ._mjs_navCsrfHeader(err && err.nav, err && err.url, signal);
      return error(err);
    } : error,
    always: always,
    timeout: timeout,
    signal: signal
  });
};
// JETON CSRF porté en en-tête par une réponse de navigation (`X-CSRF-Token`, fiche JSON ou page HTML) : une fiche n'a
// pas de <head> où le serveur recopie sa balise, une connexion ou une déconnexion faite par la navigation laissait
// sinon µ.ajax (liens @method, envois) sur le jeton d'avant. Il remplace celui de la page (`<meta name="csrf-token">`,
// posée si absente), que µ.ajax relit à chaque envoi ; une page HTML qui porte sa balise la recopie ensuite
// (µ._mjs_navCsrf). Seulement une réponse de l'origine de la page, redirections comprises, et d'une navigation encore en
// cours : une réponse abandonnée (navigation plus récente, partie avant une connexion) ne remet pas l'ancien jeton, et
// le préchargement au survol (sans signal d'abandon) n'y touche pas — la page servie ensuite depuis le préchargement le
// donne quand elle s'affiche (µ._mjs_ujsOnClick)
µ._mjs_navCsrfHeader = function(nav, finalUrl, signal) {
  var token = nav && nav.csrf, el;
  if (!token || !signal || signal.aborted || !document.head) { return; }
  try {
    if (new URL(finalUrl, window.location.href).origin !== window.location.origin) { return; }
  } catch { return; }
  el = document.head.querySelector('meta[name="csrf-token"]');
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', 'csrf-token');
    document.head.appendChild(el);
  }
  el.setAttribute('content', token);
};

// l'échange d'une page HTML reçue, commun à la visite d'une page (µ._mjs_navVisit : lien, Précédent / Suivant) et à
// l'envoi (µ._mjs_navDispatch) : la réponse analysée par `o.parser` (le DOMParser de l'appelant : chaque entrée garde le
// sien), ses `target`, `method` et `cache` (en-têtes X-MJS-*, repli <meta name="mjs-cache"> lu dans la page reçue), les
// deux contenants résolus ENSEMBLE au moment de la réponse (µ._mjs_navResolveZones : le contenant de la page a pu être
// remplacé pendant la requête, remplir un nœud détaché ne faisait rien), puis l'échange sous la transition de vue de
// `link` (µ._mjs_vtWrapSwap, qui peut le DIFFÉRER) : traductions, fichier de page, `o.head` (le jeton d'une réponse
// préchargée, avant la tête : la balise de la page reçue a le dernier mot), la tête d'abord (synchrone : un
// <@head><title> qui arrive tirera ensuite dans sa microtâche et gagnera), le contenu. `o.after(nodes, zone)` le
// termine, en dernière ligne, avec le contenant EFFECTIF (détaché en method:'replace', cf. µ._mjs_navInstallNodes). Faux
// sans l'un des deux contenants : rien d'installé, le repli est à l'appelant ; `o.ready` dès qu'ils sont trouvés
µ._mjs_navSwapPage = function(html, nav, seq, link, o) {
  var target = (nav && typeof nav.target === 'string' && nav.target) ? nav.target : null, method = µ._mjs_navMethodOf(nav && nav.method), doc = new o.parser().parseFromString(µ._mjs_th(html), 'text/html'), cache = µ._mjs_navCacheOf(doc, nav && nav.cache), zones = µ._mjs_navResolveZones(doc, target), liveInfo = zones.liveInfo, nodes, swap;
  if (!zones.newZone || !liveInfo.zone) { return false; }
  if (o.ready) { o.ready(); }
  nodes = Array.prototype.slice.call(zones.newZone.childNodes);
  µ._mjs_navWarnScripts(nodes);
  swap = function() {
    // échange PÉRIMÉ sous transition de vue : `seq` pris avant la requête (cf. bandeau de `swap` dans µ._mjs_navApplyJson)
    if (seq !== µ._mjs_navSeq) { return; }
    if (µ._mjs_navI18nSeed) { µ._mjs_navI18nSeed(doc); }
    µ._mjs_navPageFile(doc);
    if (o.head) { o.head(); }
    µ._mjs_navApplyHead(doc);
    o.after(nodes, µ._mjs_navInstallNodes(liveInfo, nodes, method, cache));
  };
  if (typeof µ._mjs_vtWrapSwap === 'function') { µ._mjs_vtWrapSwap(link, swap); } else { swap(); }
  return true;
};

// la visite d'une page, commune au lien (µ._mjs_ujsOnClick) et au Précédent / Suivant (popstate) : l'appelant a déjà pris
// la navigation (adresse poussée ou venue de l'historique, `µ._mjs_navSeq` avancé, navigation précédente abandonnée) ;
// ici `mjs:visit`, la page quittée hibernée (simple PHOTOGRAPHIE : ses nœuds ne partent qu'au prochain µ._mjs_zoneFill,
// jamais pendant la requête), la page demandée rendue par le cache de pages, sinon demandée au serveur (un lien sert
// d'abord le HTML préchargé, µ._mjs_ajaxGet), échangée (µ._mjs_navSwapPage), sa position et le focus rendus, puis le
// routeur et `mjs:load`, APRÈS l'installation réelle. `µ._mjs_lastUjsPath` ne bouge qu'à l'échange réel, qu'une
// transition de vue peut différer : posé plus tôt, un départ pendant ce délai rangeait la page encore affichée sous la
// clé de la suivante (pageCache empoisonné). `v` : `via` ('link', ou 'popstate' : un retour rend la position gardée de
// son entrée et garde l'adresse de l'historique, même redirigée ; un lien part du haut de la page ou va à son ancre, et
// suit la redirection), `seq` (le numéro de la navigation ; absent au retour, lu au même moment qu'avant), `ctrl` (son
// AbortController), `from` (la page quittée), `path` (la page demandée, clé du cache), `dest` (son adresse pour le
// routeur et les événements), `url` (l'adresse demandée, aussi dans `µ.nav.href`), `back` (l'adresse d'un rechargement,
// `url` à défaut), `paths` (chemin et adresse des événements), `link` (le lien suivi : sa transition de vue, sa politique
// mjs-flash), `undo` (rend l'adresse poussée quand rien ne s'installe), `root` (retour : le contenant de la page, sans
// lequel seul le routeur suit), `parser` (le DOMParser de l'appelant, cf. µ._mjs_navSwapPage)
µ._mjs_navVisit = function(v) {
  var pop = v.via === 'popstate', seq = v.seq, link = v.link || null, path = v.path, back = v.back || v.url, signal = v.ctrl && v.ctrl.signal, zone = µ._mjs_navCacheZone(), cachedNodes, ref;
  var navOff = function() {
    if (µ.nav) { µ.nav.active = false; µ.nav.href = null; }
    if (typeof µ._mjs_navProgressStop === 'function') { µ._mjs_navProgressStop(); }
  };
  // repli par un chargement complet (échec, réponse sans contenant exploitable) : l'adresse est déjà celle de la page
  // demandée — un lien la charge (µ._mjs_hardNav : même adresse → rechargement, jamais une réassignation muette), un
  // retour recharge son entrée, le navigateur tranche (cache HTTP, erreur)
  var hard = function() { return pop ? window.location.reload() : µ._mjs_hardNav(back); };
  // `cached` : servie par le cache de pages, sans requête (lu avant l'hibernation, qui ne touche pas cette entrée)
  µ._mjs_navEmit('visit', { path: v.paths.path, url: v.paths.url, via: v.via, cached: !!(zone && µ.pageCache && µ.pageCache.has(path)) }, false);
  // hibernation, pas destruction : les composants du sous-arbre parqué échappent à l'onDestroy différé (µ._mjs_navHibernate)
  µ._mjs_navHibernate(zone, v.from);
  if (zone && µ.pageCache.has(path)) {
    cachedNodes = µ.pageCache.get(path);
    // la navigation en vol, abandonnée par l'appelant, n'a plus de réponse pour éteindre `µ.nav` et la barre : la page
    // gardée s'installe sans requête, elles s'éteignent ici
    navOff();
    if (seq == null) { seq = µ._mjs_navSeq; }
    // restauration commune (µ._mjs_navSwapCache, qui va à l'ancre d'un lien `#section`), close par `finCache` en DERNIÈRE
    // ligne : une transition de vue peut la différer, le routeur et `mjs:load` attendent l'installation réelle
    var endCache = function() {
      if ((ref = µ.Router) != null) { ref._mjs_follow = 1; ref.navigate(v.dest, false); }
      // zone : le contenant réellement visé, pris AVANT l'hibernation (µ._mjs_navCacheZone() ment en 'replace')
      µ._mjs_navEmit('load', { path: v.paths.path, url: v.paths.url, via: v.via, zone: zone, initial: false }, false);
    };
    var swapCache = function() { µ._mjs_navSwapCache(seq, zone, cachedNodes, path, endCache, !!link && !!link.hash && !link.hash.startsWith('#/')); };
    if (typeof µ._mjs_vtWrapSwap === 'function') { µ._mjs_vtWrapSwap(link, swapCache); } else { swapCache(); }
    return;
  }
  if (seq == null) { seq = µ._mjs_navSeq; }
  if (pop && !v.root) { return (ref = µ.Router) != null ? (ref._mjs_follow = 1, ref.navigate(v.dest, false)) : void 0; }
  // µnav (état réactif public, mjs_store_globals.ts) et la barre : posés seulement quand une requête part vraiment
  if (µ.nav) { µ.nav.active = true; µ.nav.href = v.url; }
  if (typeof µ._mjs_navProgressStart === 'function') { µ._mjs_navProgressStart(); } // armé indépendamment de µ.nav (la barre de navigation, mjs_nav_progress.ts)
  var ok = function(html, finalUrl, _schemaKey, nav, preloaded) {
    var navDest = v.dest, finalPath, kind;
    if (seq !== µ._mjs_navSeq) {
      return; // une navigation plus récente a gagné — réponse périmée jetée
    }
    // le jeton CSRF de l'en-tête d'une réponse préchargée, pris quand la page s'affiche, jamais au survol ni quand rien
    // ne s'installe (celui d'une réponse demandée l'est à son arrivée, µ._mjs_navRequest)
    var csrf = function() {
      if (preloaded) { µ._mjs_navCsrfHeader(nav, finalUrl, signal); }
    };
    navOff();
    // lien redirigé par le serveur (`finalUrl` = response.url) : l'adresse affichée (l'entrée du clic corrigée, pas une
    // nouvelle) et `µ._mjs_lastUjsPath` suivent la destination FINALE — sinon /login s'affichait sous /admin et rangeait
    // son contenu sous la clé /admin au départ suivant ; calculé seulement quand un échange a lieu (JSON, ou HTML aux deux
    // contenants), le repli par chargement complet n'y touche pas
    var fix = function() {
      if (pop) { return; }
      finalPath = µ._mjs_finalPathFor(finalUrl, path);
      if (finalPath === path) { return; }
      try {
        var _fu = new URL(finalUrl, window.location.href);
        // le fragment demandé suit la redirection qui n'en donne pas (`response.url` n'en a jamais), comme avec le
        // navigateur seul : la page reçue va à son ancre
        navDest = _fu.pathname + _fu.search + (_fu.hash || link.hash);
        window.history.replaceState({}, '', navDest);
      } catch { navDest = v.dest; }
    };
    // la position, dans l'échange réel : un retour rend celle gardée de son entrée, tenue par le suivi (`follow`) pendant
    // que ses composants se peignent ; un lien part du haut (sans glisser, même sous `scroll-behavior: smooth`) ou va à
    // l'ancre de l'adresse (lien vers `/page#section`), atteinte dès que sa cible existe
    var arrive = function() {
      if (pop) {
        µ._mjs_lastUjsPath = µ._mjs_finalPathFor(finalUrl, path);
        µ._mjs_restoreScroll(path, true);
        return;
      }
      µ._mjs_lastUjsPath = finalPath;
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      if (typeof µ._mjs_anchorArrive === 'function') { µ._mjs_anchorArrive(); }
    };
    if (html && typeof html === 'object') {
      // chemin JSON du protocole de navigation : l'historique est déjà juste (adresse du clic, corrigée par `fix`, ou celle
      // du retour), rien n'est poussé ; la position dans `onSwapped`, l'échange réel ; `el` : la politique mjs-flash du lien
      fix();
      µ._mjs_navApplyJson(html, pop ? finalUrl : navDest, { push: false, vtLink: link, via: v.via, el: link, seq: seq, onSwapped: function() { csrf(); arrive(); } });
      return;
    }
    // RÈGLE UNIQUE, même ordre sur tous les chemins : X-MJS-Reload (avant toute analyse : un ordre du serveur passe avant
    // une version déduite) > version périmée (bundle changé depuis le chargement de la page : chargement complet plutôt
    // qu'un échange avec l'ancien JS) > X-MJS-Method: none > échange
    if (µ._mjs_navReloadAsked(nav && nav.reload)) {
      µ._mjs_navHardReload(finalUrl || back);
      return;
    }
    if (nav && nav.version && µ.version && nav.version !== µ.version) {
      window.location.assign(finalUrl || back);
      return;
    }
    // « ne bouge pas » (corps ignoré), puis une réponse qui n'est pas du HTML (µ._mjs_navBodyKind) : 204 ou corps vide,
    // rien à afficher, comme un navigateur ; texte, CSV, PDF, le navigateur la traite lui-même. Rien d'installé : la photo
    // de cette navigation cesse de marquer hibernés des nœuds toujours affichés (µ._mjs_navDropHibernation), l'adresse
    // poussée au clic revient sur la page affichée (`undo` ; docs/21-navigation.md : « pas de changement d'adresse »)
    if (µ._mjs_navMethodOf(nav && nav.method) === 'none') {
      µ._mjs_navDropHibernation();
      if (v.undo) { v.undo(); }
      return;
    }
    kind = µ._mjs_navBodyKind(html, nav);
    if (kind !== 'html') {
      if (kind === 'other') {
        if (pop) { return window.location.reload(); }
        µ._mjs_hardNav(back);
        return;
      }
      µ._mjs_navDropHibernation();
      if (v.undo) { v.undo(); }
      return;
    }
    if (µ._mjs_navSwapPage(html, nav, seq, link, { parser: v.parser, ready: fix, head: csrf, after: function(nodes, installed) {
      arrive();
      // focus APRÈS la position (`{ preventScroll: true }` : il ne la déplace pas, il clôt la navigation)
      if (typeof µ._mjs_focusAfterSwap === 'function') { µ._mjs_focusAfterSwap(µ._mjs_navFirstEl(nodes), nodes); }
      if ((ref = µ.Router) != null) { ref._mjs_follow = 1; ref.navigate(navDest, false); }
      // `load` : la destination réellement installée (adresse finale d'un lien redirigé, cf. `fix`) ; un retour garde
      // celle de l'historique, ce que voit l'utilisateur. `installed` : le contenant effectif
      var loadPaths = pop ? v.paths : µ._mjs_navEmitPaths(navDest);
      µ._mjs_navEmit('load', { path: loadPaths.path, url: loadPaths.url, via: v.via, zone: installed, initial: false }, false);
    } })) {
      return;
    }
    return hard();
  };
  // échec (4xx, 5xx, délai, panne) : sans repli, l'adresse montrait une page jamais affichée, en silence ; seulement pour
  // la navigation la plus récente (une réponse périmée qui échoue enfin n'impose aucun rechargement)
  var ko = function() {
    if (seq !== µ._mjs_navSeq) { return; }
    navOff();
    return hard();
  };
  return pop ? µ._mjs_navRequest('GET', v.url, void 0, ok, ko, void 0, void 0, signal) : µ._mjs_ajaxGet(v.url, ok, ko, signal);
};
// la visite d'un lien, acceptée (µ._mjs_ujsOnClick ; avec l'API Navigation, dans la navigation qui l'engage, µ._mjs_navGo) :
// la navigation précédente abandonnée — numéro de visite avancé, abandon réel du fetch en vol (cf. `_mjs_abortStaleNav`,
// haut de fichier), inconditionnel comme au popstate, que la visite résolve ensuite en cache-hit ou en requête
// (`v.ctrl.signal`) — puis la visite. Une seule fois : déjà partie (son numéro pris), elle ne repart pas — le gestionnaire
// d'une API qui le joue après `pushState` la trouve lancée par le filet de µ._mjs_navGo
µ._mjs_navStart = function(v) {
  if (v.seq) { return; }
  v.seq  = ++µ._mjs_navSeq;
  v.ctrl = typeof µ._mjs_abortStaleNav === 'function' ? µ._mjs_abortStaleNav() : null;
  return µ._mjs_navVisit(v);
};
// <<< extrait-test helpers-navigation

// ──────────────────────────────────────────────────────────────────────────
// TRANSITIONS DE PAGE (mjs-vt) — swap du contenant de navigation enveloppé dans l'API View
// Transitions du navigateur, même esprit que @viewTransition (routeur, mjs_router.ts)
// mais au niveau PAGE : cascade attribut du lien déclencheur (`mjs-vt`, converti
// depuis `@pageTransition` par preprocessHtml) > config globale `µ.viewTransition`. Pas de <a>
// pour popstate/submit (pas de clic) → config seule pour ces 2 chemins (`link` vaut
// `null`). Résolution INDÉPENDANTE de celle du routeur (_mjs_vtResolveWithPriority, niveau <@view>) —
// une transition de page n'a pas de « vue routée ».
// >>> extrait-test _mjs_vtResolvePage
µ._mjs_vtResolvePage = function(link) {
  var attr = link && typeof link.getAttribute === 'function' ? link.getAttribute('mjs-vt') : null;
  if (attr === 'on') { return true; }
  if (attr === 'off' || attr === 'none') { return false; }
  if (attr) { return attr; }
  var cfg = µ.viewTransition;
  return (cfg && cfg !== 'none') ? cfg : false;
};
// <<< extrait-test _mjs_vtResolvePage

// Enveloppe `swap` (fonction SYNCHRONE : replaceWith + restauration de scroll +
// focus, TOUT ce qui existe déjà à chaque point d'appel, ORDRE INTERNE inchangé)
// dans `document.startViewTransition` si la garde d'environnement ET la résolution
// sont actives ; sinon exécute `swap` directement — chemin historique inchangé. Un rideau
// joue même sans l'API (vrai DOM) ; un préréglage natif, sans elle, exécute `swap` directement.
// Résolution en CHAÎNE (préréglage) → µ._mjs_vtApplyPreset AVANT de démarrer la
// transition (mjs_vt_presets.ts, chargé avant mjs_router/mjs_ujs — ordre CANONICAL,
// bundler/index.ts). `µ.Router._mjs_vtEnabled` : garde D'ENVIRONNEMENT PARTAGÉE avec le
// routeur (cf. son commentaire dans mjs_router.ts) — ni dupliquée ni redéfinie ici ;
// absente (runtime tree-shaké sans 'router') ⇒ repli silencieux sur `swap()` direct.
// >>> extrait-test _mjs_vtWrapSwap
µ._mjs_vtWrapSwap = function(link, swap) {
  var rt = µ.Router;
  if (!rt || typeof rt._mjs_vtEnabled !== 'function' || !rt._mjs_vtEnabled()) { return swap(); }
  var resolved = µ._mjs_vtResolvePage(link);
  if (!resolved) { return swap(); }
  // DRAPEAU DE RÉENTRANCE, partagé avec mjs_router.ts (µ._mjs_vtPageSwapping) : levé le temps EXACT
  // de l'exécution de `swap` — que document.startViewTransition rappelle de façon ASYNCHRONE
  // (spécification CSS View Transitions, vérifié dans Chromium), jamais pendant l'appel lui-même, et
  // que les rideaux rappellent plus tard encore. `swap` peut appeler Router.navigate() (les 6 sites
  // d'échange de page finissent par lui), qui ouvrirait SINON sa PROPRE transition depuis l'intérieur
  // de celle-ci. `finally` : baissé même si `swap` lève.
  var swapGuarded = function() {
    µ._mjs_vtPageSwapping = true;
    try { return swap(); } finally { µ._mjs_vtPageSwapping = false; }
  };
  // rideaux « à travers le noir » : mêmes règles que le routeur
  if (typeof µ._mjs_vtCurtainRun === 'function' && typeof resolved === 'string' && µ._mjs_vtCurtainRun(resolved, swapGuarded)) { return; }
  // navigateur sans l'API View Transitions : permutation directe, silencieuse (seuls les rideaux jouent sans elle) ;
  // le drapeau de réentrance reste levé, la vue du routeur ne lance pas sa propre transition, comme avec l'API
  if (typeof document.startViewTransition !== 'function') { return swapGuarded(); }
  if (typeof µ._mjs_vtApplyPreset === 'function') { µ._mjs_vtApplyPreset(resolved); }
  // couche de lévitation : mêmes hooks que le routeur (cf. mjs_vt_presets.ts)
  var hoist = (typeof µ._mjs_vtHoistStart === 'function') ? µ._mjs_vtHoistStart() : null;
  // pose html[data-mjs-vt] (docs/17-router.md:420), même garde µ._mjs_vtParse que
  // mjs_router.ts : runtime tree-shaké sans 'vt_presets' malgré un préréglage résolu → repli 'on'.
  // Garde sur document.documentElement lui-même : de nombreux tests existants (vt-presets-ujs.test.ts
  // et consorts) stubbent `document` par un objet minimal { startViewTransition }, sans documentElement.
  // JETON DE SÉQUENCE, partagé avec mjs_router.ts (même
  // compteur µ._mjs_vtAttrSeq, même attribut html[data-mjs-vt]) : deux transitions chevauchées (celle-ci
  // démarre pendant qu'une PRÉCÉDENTE tourne encore) — le retrait à `finished` de la précédente ne
  // doit RETIRER l'attribut QUE si aucune pose plus récente n'a eu lieu depuis ; sinon il efface
  // celui de la transition ACTIVE (prouvé Chromium).
  var vtAttrSeq = (µ._mjs_vtAttrSeq = (µ._mjs_vtAttrSeq || 0) + 1);
  if (document.documentElement) { document.documentElement.dataset.mjsVt = (typeof resolved === 'string' && typeof µ._mjs_vtParse === 'function') ? µ._mjs_vtParse(resolved).base : 'on'; }
  var t;
  try {
    t = document.startViewTransition(hoist ? function() { swapGuarded(); return µ._mjs_vtHoistSwapSettled(hoist); } : swapGuarded);
  } catch (e) {
    // startViewTransition peut lever (état invalide) : l'attribut ne reste pas collé
    if (document.documentElement) { delete document.documentElement.dataset.mjsVt; }
    throw e;
  }
  // retrait à finished, y compris en échec (transition annulée/rejetée), SEULEMENT si
  // le compteur n'a pas bougé depuis la pose (aucune transition plus récente encore active).
  var clearVtAttr = function() { if (µ._mjs_vtAttrSeq === vtAttrSeq && document.documentElement) { delete document.documentElement.dataset.mjsVt; } };
  if (t && t.finished) { t.finished.then(clearVtAttr, clearVtAttr); }
  // transition sautée (enchaînement rapide) → `ready`/`finished` rejettent sans
  // consommateur : on absorbe (cf. le même garde dans mjs_router.ts)
  if (t && t.ready && typeof t.ready.catch === 'function') { t.ready.catch(function() {}); }
  // nettoyage à FINISHED, jamais ready (image VIVANTE côté new, cf. _mjs_vtHoistEnd)
  if (hoist && t && t.finished) { var done = function() { µ._mjs_vtHoistEnd(hoist); }; t.finished.then(done, done); }
  if (!hoist && t && t.finished && typeof t.finished.catch === 'function') { t.finished.catch(function() {}); }
  return t;
};
// <<< extrait-test _mjs_vtWrapSwap

// >>> extrait-test popstate-listener
window.addEventListener('popstate', function(e) {
  var currentRoot, destination, evPaths, fullDest, leavingPath, ref, destHash;
  // `popstate` émis par l'ancre que la navigation suit elle-même (µ._mjs_anchorGo, clic) : pas un Précédent, le
  // navigateur défile seul jusqu'à la cible — rejouer ici une position gardée ramenait la page là où l'utilisateur
  // avait quitté l'ancre, pas sur elle
  if (µ._mjs_anchorNav) { return; }
  // ancre non-route (`#footnote`, sans
  // le `/` de route) : `popstate` tire AUSSI pour un retour PAR-DESSUS une
  // entrée d'ancre de la page (une par ancre cliquée avec `µ._anchorHistory`,
  // ou posée par le navigateur : adresse tapée, `location.hash` d'un script).
  // Sans garde-fou ici, `_mjs_getMatchPath` prend TOUT ce qui suit `#` sans distinguer
  // route et ancre → route vers un chemin bidon (`/footnote`) qui ne matche
  // AUCUNE route déclarée → `_mjs_injectViewsForComponent` VIDE TOUTES les
  // `<@view>` (aucune route ne correspond). Une ancre non-route n'est PAS un
  // changement de page : on ne touche qu'à la position (plus bas), jamais aux
  // vues ni au contenu affiché.
  destHash = window.location.hash;
  destination = window.location.pathname + window.location.search;
  // retour sur une entrée de la page que quitte la navigation en vol (µ._mjs_navLeft : lien, retour, tout formulaire),
  // avant l'arrivée de la page demandée : la navigation est abandonnée sans relève — sa réponse ne s'installe pas,
  // `µ.nav` et la barre de navigation, qu'elle aurait éteints, s'éteignent ici — et la page, qui n'a quitté ni l'écran
  // ni sa position, reste telle quelle : la position gardée de l'entrée date d'un départ plus ancien (rechargement,
  // ancre), ce départ-là n'a rangé que celle de la page
  var _navOff = function() {
    if (µ.nav) { µ.nav.active = false; µ.nav.href = null; }
    if (typeof µ._mjs_navProgressStop === 'function') { µ._mjs_navProgressStop(); }
  };
  // ne court-circuiter QUE si la
  // PAGE ne change pas. Le fix 1ʳᵉ passe sortait dès que le hash de destination
  // était une ancre non-route (`#footnote`), en supposant qu'un pop d'ancre est
  // toujours un mouvement DANS la page. FAUX : un retour arrière INTER-PAGES peut
  // atterrir sur une URL portant une ancre (`/b#footnote` laissée par un clic
  // `<a href="#footnote">` sur /b, puis nav ujs vers /c). Le retour
  // /c → /b#footnote sortait immédiatement : aucun swap, `_mjs_lastUjsPath`/`_mjs_navSeq`
  // intacts → contenu de /c sous l'URL /b#footnote, toute la chaîne pageCache
  // corrompue. On ne sort que si la page est identique (vrai ancrage en page).
  // Seule la position change alors, et le défilement natif est coupé : elle revient ici — celle gardée au départ de
  // cette entrée (clic sur une autre ancre), sinon l'ancre elle-même, cherchée comme le navigateur et dans les ombres
  // des composants (µ._mjs_anchorTarget : id, `<a name>`, `#top`), sans glisser. Une entrée neuve de même adresse (lien
  // `mjs-no-ujs`, `location.hash` d'un script) va à l'ancre : la position gardée porte le nom de son entrée quand le
  // navigateur le donne (µ._mjs_saveScroll, µ._mjs_entryKey)
  if (destHash && !destHash.startsWith('#/') && destination === µ._mjs_lastUjsPath) {
    // retour sur l'ancre de la page que quitte la navigation en vol : abandonnée ici, la branche sort avant l'abandon
    // commun (cf. `_navOff`, plus haut)
    if (µ._mjs_navLeft === destination + ' ' + µ._mjs_navSeq) {
      µ._mjs_navSeq++;
      if (typeof µ._mjs_abortStaleNav === 'function') { µ._mjs_abortStaleNav(); }
      _navOff();
      return;
    }
    var _keptKey = typeof µ._mjs_entryKey === 'function' ? µ._mjs_entryKey(destination + destHash) : destination + destHash;
    if (µ._mjs_scrollPos && µ._mjs_scrollPos.has(_keptKey)) { µ._mjs_restoreScroll(_keptKey); }
    else if (typeof µ._mjs_anchorScroll === 'function') { µ._mjs_anchorScroll(destHash, true); }
    return;
  }
  // Ancre non-route EXCLUE du chemin routé (sinon `_mjs_getMatchPath` prendrait
  // `footnote` pour une route et viderait les vues) ; une vraie route hash
  // (`#/…`) est conservée.
  fullDest = destination + (destHash.startsWith('#/') ? destHash : '');
  var _mzCur = µ._mjs_navMountZone(document, null);
  currentRoot = _mzCur.zone;
  leavingPath = µ._mjs_lastUjsPath;
  // Toute navigation historique INVALIDE les fetchs en vol : sans ce bump,
  // une réponse tardive (clic A→B puis Précédent avant la réponse) écrasait
  // la page restaurée avec le contenu de B alors que l'URL affichait A.
  µ._mjs_navSeq++;
  // Abandon réel du fetch de navigation précédent (cf. `_mjs_abortStaleNav`, plus
  // haut) : posé ICI, AVANT tout branchement cache-hit/cache-miss/hash — un
  // retour arrière doit tuer un fetch encore en vol quelle que soit l'issue
  // de CE popstate (`_navCtrl` n'est consommé que par la branche refetch,
  // plus bas, mais l'abandon lui-même est inconditionnel).
  var _navCtrl = typeof µ._mjs_abortStaleNav === 'function' ? µ._mjs_abortStaleNav() : null;
  // Navigation hash pure (même page) : le routeur interne suffit.
  if (leavingPath === destination) {
    // retour sur la page que quitte la navigation en vol, abandonnée juste au-dessus (cf. `_navOff`) : éteinte avant le
    // routeur, qui allume lui-même la barre quand le composant de la route doit encore arriver
    var _left = µ._mjs_navLeft === destination + ' ' + (µ._mjs_navSeq - 1);
    if (_left) { _navOff(); }
    if ((ref = µ.Router) != null) {
      // slash final posé à la main : nettoie l'URL AVANT de router — sinon `_mjs_updateUrlStore`
      // mémorise la forme sale et le listener hashchange sautera son navigate (même matchPath)
      if (ref._mjs_canonicalizeUrl) { ref._mjs_canonicalizeUrl(); destHash = window.location.hash; fullDest = destination + (destHash.startsWith('#/') ? destHash : ''); }
      ref._mjs_follow = 1;
      ref.navigate(fullDest, false);
    }
    // la page n'a quitté ni l'écran ni sa position, qui reste
    if (_left) { return; }
    // `history.scrollRestoration` est coupé pour toute la page (plus haut) : la position de la route
    // retrouvée, gardée à son départ (clic sur un lien `#/…`, µ.Router.navigate) sous l'adresse complète
    // (`#` seul pour l'entrée sans fragment, jamais confondue avec la clé de page) et le nom de l'entrée quand le
    // navigateur le donne (µ._mjs_saveScroll, µ._mjs_entryKey), revient ici ; une entrée jamais quittée par ces chemins garde le
    // défilement en place, comme avant ; sans routeur aussi (entrée sans fragment quittée par une ancre ordinaire, cf. le clic)
    var _hashKey = window.location.pathname + window.location.search + (window.location.hash || '#');
    if (typeof µ._mjs_entryKey === 'function') { _hashKey = µ._mjs_entryKey(_hashKey); }
    // <routes-idle>
    // la page retrouvée attend son code (µ.Router.navigate) : sa position revient quand elle est posée, pas sur l'ancienne page
    var _navWait = µ.Router && µ.Router._mjs_navWait;
    if (_navWait) { _navWait.then(function(ok) { if (ok && µ._mjs_scrollPos && µ._mjs_scrollPos.has(_hashKey)) { µ._mjs_restoreScroll(_hashKey); } }); return; }
    // </routes-idle>
    if (µ._mjs_scrollPos && µ._mjs_scrollPos.has(_hashKey)) { µ._mjs_restoreScroll(_hashKey); }
    return;
  }
  // la suite, commune au clic (µ._mjs_navVisit) : `mjs:visit`, non annulable (PAS de before-visit ici : l'URL a déjà bougé
  // au popstate, annuler serait un mensonge — même choix que Turbo), émis APRÈS les courts-circuits plus haut, qui
  // n'émettent rien ; la page QUITTÉE hibernée à son tour (un retour puis « suivant » la retrouve), la page gardée
  // restaurée, sinon redemandée comme par un clic (entrée jamais visitée, évincée du LRU, ou montée en 'replace') par le
  // canal interne (µ._mjs_navRequest : X-MJS-Nav, réponse JSON ou HTML), sans le HTML préchargé ; l'adresse reste celle
  // de l'historique, même redirigée, et la position gardée de l'entrée revient. Sans contenant dans la page, seul le
  // routeur suit
  evPaths = µ._mjs_navEmitPaths(fullDest);
  return µ._mjs_navVisit({ via: 'popstate', ctrl: _navCtrl, root: currentRoot, from: leavingPath, path: destination, dest: fullDest, url: fullDest, back: destination, paths: evPaths, parser: DOMParser });
});
// <<< extrait-test popstate-listener

// hashchange : un `location.hash = '#/…'` PROGRAMMATIQUE (ou une édition directe
// du fragment dans la barre d'adresse) n'émet ni clic ni popstate — sans ce
// listener, le routeur interne ne réagissait qu'aux clics de liens et au
// back/forward, et piloter l'URL par code ne routait pas.
//
// Trois garde-fous :
//   1. On ne route que les hash de ROUTE (`#/…`) : un ancre `#section` doit
//      garder son scroll natif et ne PAS vider les <@view> (même convention que
//      le handler de clic, `isHashRoute`).
//   2. Anti-double back/forward : un retour sur route hash émet popstate ET
//      hashchange ; popstate a déjà navigué (et posé `_mjs_lastNavPath`), donc si le
//      matchPath n'a pas bougé on saute. (Les clics passent par pushState qui
//      n'émet PAS hashchange → aucun conflit de ce côté.)
//   3. Même si l'ordre popstate/hashchange s'inversait, re-naviguer vers le même
//      matchPath est visuellement idempotent (injectView rafraîchit au lieu de
//      remonter) — le pire cas reste bénin.
// >>> extrait-test hashchange-listener
window.addEventListener('hashchange', function() {
  var hash, matchPath, ref, hashQuery, qi;
  hash = window.location.hash;
  if (hash && !hash.startsWith('#/')) {
    // ancre ordinaire : pas une route, la vue affichée reste ; µ.url suit quand même l'adresse (fragment, adresse complète)
    if (µ.url) { µ.url.hash = hash; µ.url.href = window.location.href; }
    return;
  }
  if ((ref = µ.Router) == null) {
    return;
  }
  // Slash final tapé à la main / lien codé en dur (`#/about/`) : on nettoie
  // l'URL AVANT de router. `replaceState` (dans _mjs_canonicalizeUrl) ne réémet pas
  // hashchange → pas de ré-entrée ; `window.location.href` reflète déjà la forme
  // propre pour le `navigate` ci-dessous.
  if (ref._mjs_canonicalizeUrl) { ref._mjs_canonicalizeUrl(); }
  matchPath = ref._mjs_getMatchPath(window.location.href);
  // comparer SEULEMENT `matchPath`
  // (comme avant) confondait "même route" avec "rien n'a changé" : un
  // changement de QUERY seul (même route, ex. `#/liste?tri=nom` →
  // `#/liste?tri=prix`) laisse `matchPath` inchangé → `navigate()` (donc
  // `_mjs_updateUrlStore`) était sauté en entier → `µ.url.query` restait figé
  // sur l'ancienne query à vie. On compare maintenant AUSSI la query — le
  // garde-fou anti-double-fire (popstate a déjà navigué) ne saute que si
  // route ET query sont TOUTES LES DEUX identiques à la dernière navigation.
  hash = window.location.hash; // relu : _mjs_canonicalizeUrl a pu le modifier
  qi = hash.indexOf('?');
  hashQuery = qi !== -1 ? hash.slice(qi + 1) : '';
  if (matchPath === ref._mjs_lastNavPath && hashQuery === ref._mjs_lastNavQuery) {
    // même route mais hash nettoyé par `_mjs_canonicalizeUrl` (slash final) : resync `µ.url`
    if (µ.url != null && µ.url.hash !== window.location.hash) { ref._mjs_updateUrlStore(matchPath); }
    return;
  }
  ref._mjs_follow = 1;
  return ref.navigate(window.location.href, false);
});
// <<< extrait-test hashchange-listener

// ──────────────────────────────────────────────────────────────────────────
// LE SECOND MOTEUR — l'API Navigation du navigateur, reconnue au chargement du runtime et gardée (µ._mjs_nav, absente
// sans elle), seulement la sienne : sa classe `Navigation`, l'accesseur de son entrée courante et `addEventListener`, du
// code natif, et l'objet de `window.navigation`, une instance de cette classe que son accesseur accepte. Toute autre
// `navigation` de la page, posée avant le runtime — variable globale d'un script
// (`var navigation = document.getElementById('nav')`), élément d'identifiant `navigation` d'un navigateur sans l'API, objet
// quelconque, `Proxy` de l'API, cale ou polyfill de l'API, même par sa classe (`window.Navigation`) — n'est pas prise pour
// elle, ni l'API du navigateur qu'un script de la page masque (`addEventListener` enveloppé sans
// `Function.prototype.toString` maquillé, classe `Navigation` remplacée) : rien n'est intercepté, la visite part comme sans
// l'API, une par clic ; posée après, elle ne change rien à l'interception. Seule l'interception dépend de cette
// reconnaissance : les positions lisent l'entrée de `window.navigation`, quoi qu'elle soit (µ._mjs_navEntry), et le
// `navigate` du `pushState` d'un lien que la page annule, l'interception écartée, garde l'adresse sans retenir la visite,
// comme sans interception. Un seul écouteur
// `navigate` prend par `intercept` ce que la navigation de MJS lui remet : la visite d'un lien, décidée par le clic
// (µ._mjs_ujsOnClick : geste, `@noUJS`, cible, `@confirm`, `@method`, coupures de la propagation) et engagée par
// `pushState({})` comme sans l'API (µ._mjs_navGo), dont l'API annonce le `navigate` : l'entrée neuve garde l'état `{}` de
// `history.state`, la page ne reçoit aucun `beforeunload` et aucun départ n'est annoncé (mjs_init.ts : une navigation du
// même document) ; la position et le focus restent ceux de MJS (`scroll` et `focusReset` : 'manual'). Le gestionnaire rend
// la main aussitôt : la visite se poursuit comme sans l'API, abandonnée par la suivante (numéro de visite et
// AbortController). Tout le reste va au navigateur : autre origine ou autre document (`canIntercept` faux), téléchargement,
// rechargement, ancre et route `#/…` (suivies par le clic et `hashchange`), envoi de formulaire (pris par l'écouteur
// `submit`), lien que la navigation de MJS n'a pas pris (geste, `@noUJS`, coupure de la propagation hors composant, lien
// d'une ombre fermée coupé en capture sur le document) et navigation lancée par un script (`location.href`,
// `navigation.navigate()`), même par un écouteur `navigate` pendant l'annonce d'un lien : un chargement complet, comme sans
// l'API. Précédent et Suivant restent à `popstate` : interceptés, ils perdaient sous WebKit la position d'une route sur une
// page rechargée par un retour. Sans l'API reconnue, le clic pousse l'adresse lui-même (`pushState`, celui d'une cale qui
// le remplace) puis la visite part
// la visite `v` d'un lien, remise à l'API : `pushState` engage l'entrée neuve et annonce son `navigate`, que l'écouteur
// intercepte pour jouer la visite (µ._mjs_navStart), dans l'appel même : rien ne coupe la visite en vol avant que la
// nouvelle soit acceptée. Annulée par la page (`preventDefault()` d'un écouteur `navigate`, posé avant ou après celui de
// MJS), elle reste sans suite : l'adresse et la page restent, la visite en vol continue. Abandonnée par le navigateur pour
// une autre navigation de la page engagée pendant l'annonce (`history.replaceState()` ou `pushState()` d'un écouteur),
// elle se joue comme sans l'API, sur l'adresse que la page a laissée
µ._mjs_navGo = function(url, v) {
  var n = µ._mjs_nav, at = n.currentEntry, href = location.href, seen;
  // la visite attendue, le temps de l'appel seulement (un `pushState` refusé lève)
  µ._mjs_navNext = v;
  try {
    window.history.pushState({}, '', url);
  }
  finally {
    // un `navigate` du navigateur vu pendant l'appel : µ._mjs_navOnNavigate retire la visite attendue au premier
    seen           = µ._mjs_navNext !== v;
    µ._mjs_navNext = null;
  }
  // le filet, toujours armé : au retour de l'appel, la visite part si elle n'est pas déjà partie (µ._mjs_navStart : une
  // seule fois) quand aucun `navigate` du navigateur n'a été vu pendant l'appel — `history.pushState()` remplacé par la page,
  // quelle que soit sa forme (fonction, fonction liée, `Proxy`), qui appelle celui du navigateur plus tard (l'entrée poussée
  // alors n'est pas interceptée) ou jamais —, ou quand l'entrée ou l'adresse a changé : une autre navigation du même
  // document engagée à sa place, ou le `navigate` du lien vu sans être pris ; elle part alors comme sans l'API. Sinon, le
  // `navigate` du lien a été vu et rien n'a bougé : elle reste sans suite (annulée, ou abandonnée pour un autre document,
  // que le navigateur charge), sauf si le gestionnaire la joue plus tard (commit retardé par un `precommitHandler` de la
  // page)
  if (!seen || n.currentEntry !== at || location.href !== href) { µ._mjs_navStart(v); }
};
// le `navigate` de la visite attendue, sûrement celui de son `pushState` : le premier que le navigateur annonce pendant
// l'appel, une entrée neuve du même document (`push`, `destination.sameDocument`) à son adresse, que la page n'a pas annulé
// (`intercept()` lèverait). Un `navigate` que le navigateur n'a pas lancé (`dispatchEvent()` d'un script, `isTrusted`
// faux : une cale qui le simule) n'est pas celui de l'API, il ne compte pas. Tout autre `navigate` vu pendant l'appel retire
// la visite attendue sans être pris : une navigation lancée pendant l'annonce par un écouteur de la page posé avant le
// runtime (`location.href`, `location.assign()`, `location.replace()`, `navigation.navigate()`, même vers l'adresse du
// lien) reste au navigateur — un chargement complet, question du `beforeunload` comprise — et celle du lien, qu'elle
// abandonne, n'est plus attendue. La visite reconnue quitte `µ._mjs_navNext` avant de se jouer : un `navigate` lancé
// pendant sa partie synchrone (départ par `location.assign()` dans un écouteur `mjs:visit`, ou `mjs:load` d'une page du
// cache de pages ; `pushState` de la page) n'est pas pris pour elle, il va au navigateur — un départ y reste un départ,
// question du `beforeunload` comprise. L'erreur de la visite reste une erreur de la page (rendue en promesse rejetée, l'API
// la tairait)
µ._mjs_navOnNavigate = function(e) {
  var v = µ._mjs_navNext;
  if (!e.isTrusted) { return; }
  // retirée au premier `navigate` vu : seul celui-là peut être le sien
  µ._mjs_navNext = null;
  if (v && e.canIntercept && !e.defaultPrevented && e.navigationType === 'push' && e.destination.sameDocument && e.destination.url === v.url) {
    e.intercept({ scroll: 'manual', focusReset: 'manual', handler: function() {
      try { µ._mjs_navStart(v); } catch (err) { window.reportError(err); }
    } });
  }
};
// l'API du navigateur, seulement la sienne : sa classe, l'accesseur de son entrée courante et `addEventListener`, du code
// natif — leur texte (`Function.prototype.toString`) finit par `[native code] }`, une cale ou un polyfill les écrit en
// JavaScript — et l'objet de la page, une instance de cette classe que l'accesseur natif accepte (il refuse tout autre
// objet, `Proxy` de l'API compris, et lève) ; sans l'API, la classe manque et la lecture lève. Puis l'écouteur accepté.
// Elle ne décide que de l'interception : `history.pushState()`, quel qu'il soit, se juge au clic (le filet de µ._mjs_navGo)
try {
  const N = window.Navigation, api = window.navigation, entry = Object.getOwnPropertyDescriptor(N.prototype, 'currentEntry').get;
  const native = function(f) { return /\[native code\]\s*\}$/.test(Function.prototype.toString.call(f)); };
  if (native(N) && native(entry) && native(api.addEventListener) && api instanceof N && entry.call(api) !== void 0) {
    api.addEventListener('navigate', µ._mjs_navOnNavigate);
    µ._mjs_nav = api;
  }
}
catch { /* sans l'API du navigateur : la navigation de MJS sans elle */ }

// relance partagée @confirm (clic ET submit, cf. les deux gates plus bas) — une
// fois la promesse de µ.confirm résolue à true, rejoue l'action d'origine :
// neutralise mjs-confirm le temps du replay (les gates retraversés laissent
// alors passer), puis restaure — dépose/redépose SYNCHRONE, aucune fenêtre
// d'incohérence, pas de jeton à tenir. clickTarget (relance CLIC uniquement)
// GAGNE TOUJOURS sur form quand fourni — même si le porteur mjs-confirm est
// un <form> : on reclique la cible RÉELLEMENT cliquée d'origine (pas
// forcément confirmEl — icône, span…), pour préserver EXACTEMENT la
// sémantique du clic accepté synchrone (un clic inerte reste inerte, un
// bouton submit re-déclenche nativement sa soumission). La voie soumission
// directe (form/requestSubmit/submit) ne sert donc qu'au gate SUBMIT.
// `submitter` (4e paramètre, mémorisé côté gate
// SUBMIT depuis `e.submitter`) — quand `confirmEl` est un WRAPPER (mjs-confirm sur le <form> ou
// un ancêtre, pas sur le bouton), `confirmEl.form` n'existe pas et la voie soumission directe
// perdait le soumissionnaire réel (formaction/formtarget/formmethod du bouton). Repli :
// `clickTarget.closest(...)` si la relance CLIC n'a pas de `.click` exploitable.
// >>> extrait-test _mjs_ujsConfirmRefire
µ._mjs_ujsConfirmRefire = function(confirmEl, form, clickTarget, submitter) {
  var saved, target, realSubmitter, isSubmitBtn, click;
  // le `click` de la balise, jamais celui d'un composant du même nom (`@click = ->` : le clic accepté n'était jamais rejoué)
  click = function(n) {
    if (typeof HTMLElement === 'function' && n instanceof HTMLElement) { HTMLElement.prototype.click.call(n); }
    else { n.click(); }
  };
  saved = confirmEl.getAttribute('mjs-confirm');
  confirmEl.removeAttribute('mjs-confirm');
  try {
    if (clickTarget && typeof clickTarget.click === 'function') {
      click(clickTarget);
    }
    else {
      target = form || (confirmEl.tagName === 'FORM' ? confirmEl : null);
      if (target) {
        if (typeof target.requestSubmit === 'function') {
          // `confirmEl` PEUT être un ancêtre form-associated NON-bouton (<fieldset mjs-confirm>
          // englobant le bouton d'envoi) : `.form` existe mais requestSubmit(confirmEl) lève une
          // TypeError native AVANT tout dispatch — validé comme un VRAI bouton de soumission avant
          // de le passer, sinon repli sur submitter/realSubmitter/bare (comme non form-associated).
          isSubmitBtn = µ._mjs_matches(confirmEl, 'button, input[type="submit"], input[type="image"]');
          try {
            if (confirmEl !== target && confirmEl.form === target && isSubmitBtn) { target.requestSubmit(confirmEl); }
            else if (submitter) {
              // `submitter` transmis par l'appelant (e.submitter mémorisé, gate SUBMIT) : DÉJÀ
              // vérifié par le navigateur comme soumissionnaire de CE <form> — aucun re-test `.form`.
              target.requestSubmit(submitter);
            }
            else if (clickTarget && (realSubmitter = µ._mjs_closest(clickTarget, 'button, input[type="submit"], input[type="image"]')) && realSubmitter.form === target) {
              // repli : bouton retrouvé depuis la cible du clic d'origine (relance CLIC sans `.click`
              // exploitable) — `.form === target` vérifie qu'il appartient bien à CE formulaire.
              target.requestSubmit(realSubmitter);
            }
            else { target.requestSubmit(); } // sans soumissionnaire trouvé : comportement d'origine
          }
          catch (reqErr) {
            // repli ultime (cas non prévu) : jamais une exception qui fuit hors du `.then()`
            // appelant (promesse orpheline, formulaire jamais soumis en silence) — averti, pas avalé.
            µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsConfirmRetry', { tag: (confirmEl.tagName || '?').toLowerCase(), reqErr: reqErr }, ':confirm : requestSubmit({tag}) a échoué après acceptation, repli sur requestSubmit() nu — {reqErr}'));
            // GARDE MUETTE : le repli lui-même peut échouer
            // (2e échec) — jamais un `catch` vide, averti nommément plutôt qu'avalé en silence.
            try { target.requestSubmit(); } catch (e) { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsConfirmRetryFailed', { e: e }, ':confirm : relance de requestSubmit() nu a ÉGALEMENT échoué, formulaire non soumis — {e}')); }
          }
        }
        else if (typeof target.submit === 'function') { target.submit(); }
      }
      else if (typeof confirmEl.click === 'function') { click(confirmEl); }
    }
  }
  finally {
    if (saved != null) { confirmEl.setAttribute('mjs-confirm', saved); }
  }
};
// <<< extrait-test _mjs_ujsConfirmRefire

// Nommé (au lieu d'anonyme) : réutilisé tel quel comme listener du PONT SHADOW
// (µ._mjs_ujsShadowAttach, plus bas) — un composant en Shadow DOM fermé a besoin
// EXACTEMENT du même handler, posé directement sur son shadow root (cf. le
// commentaire de µ._mjs_ujsShadowAttach pour le pourquoi du retargeting).
// >>> extrait-test _mjs_ujsOnClick
µ._mjs_ujsOnClick = function(e) {
  var currentPath, destPath, destination, evPaths, fullDest, isHashRoute, isSamePage, link, ref, target;
  // action déjà prévenue — y compris par un gestionnaire du composant : la prise en charge du lien
  // n'a lieu qu'à la remontée, une fois ces gestionnaires joués (pont shadow, µ._mjs_ujsShadowAttach)
  if (e.defaultPrevented) {
    return;
  }
  // Bouton gauche seul — extrait du garde combiné modificateurs (déplacé plus
  // bas, cf. commentaire) : un clic milieu/droit n'a rien à confirmer non plus.
  if (e.button !== 0) {
    return;
  }
  target = µ.realTarget(e);
  // CONFIRMATION AVANT ACTION (@confirm → mjs-confirm) : HISSÉE tout en tête,
  // AVANT même `link = target.closest('a')` — un bouton NU (sans <a>
  // englobant) doit lui aussi être confirmé (avant ce hissage, `!link`
  // sortait plus haut et un bouton sans lien n'atteignait jamais cette gate).
  // Remonte du nœud RÉELLEMENT cliqué (pas forcément `link` : une icône à
  // l'intérieur, un <button>, par ex.) au porteur `mjs-confirm` le plus
  // proche (lien, bouton, formulaire — `closest` ne distingue pas la balise,
  // seul l'attribut compte). Refus → STOP TOTAL : `preventDefault` (aucune
  // navigation, ni ajax ni native) + `stopImmediatePropagation` — bloque
  // AUSSI les listeners délégués du COMPOSANT lui-même posés sur le même
  // shadow root (cf. µ._mjs_ujsShadowAttach/mjs_element.ts : le pont écoute
  // AVANT _mjs_bindEvents, donc ce stop coupe la remontée avant le routeur
  // d'événements du composant).
  // Idempotence PAR ÉVÉNEMENT shadow OPEN (SSR
  // shadowMode:'open', reprise dans mjs_element.ts) : `µ.realTarget`
  // (composedPath()[0]) voit la VRAIE cible aussi bien depuis le pont (shadow
  // root, capture) que depuis CE listener document (bulle) — rien ne les
  // masque l'un de l'autre, contrairement au closed (retargeting natif). Le
  // MÊME objet Event traverse les deux, sans marqueur le gate tournait deux
  // fois : 2 popups pour 1 clic ACCEPTÉ (un refus, lui, était déjà protégé —
  // `stopImmediatePropagation` juste en dessous coupe la remontée avant le 2e
  // passage). `_mjs_mjsConfirmGated` posé au 1er passage : le 2e saute le gate
  // mais poursuit le reste du handler normalement (lien/canonicalisation
  // doivent quand même tourner au niveau document, comme avant ce fix).
  // le marqueur `_mjs_mjsConfirmGated` ne se pose plus
  // qu'APRÈS avoir trouvé un VRAI porteur `[mjs-confirm]` (déplacé DANS le `if` ci-dessous) : un
  // composant en shadow fermé qui en contient un AUTRE (lui aussi shadow fermé) fait tourner le
  // pont EXTERNE avant le pont INTERNE (capture) — depuis l'externe, `target` (composedPath()[0])
  // est TRONQUÉ par le navigateur à l'hôte du composant interne (nœuds d'un shadow fermé
  // invisibles depuis l'extérieur), `closest('[mjs-confirm]')` n'y trouve donc RIEN. Poser le
  // marqueur quand même (ancien code) fermait la garde AVANT que le pont interne — seul à voir le
  // vrai bouton — ait pu jouer µ.confirm : la suppression partait sans aucune popup. L'idempotence
  // shadow OUVERT ci-dessus reste garantie : le 1er passage qui TROUVE le porteur marque l'événement.
  if (!e._mjs_mjsConfirmGated) {
    var _confirmEl = µ._mjs_closest(target, '[mjs-confirm]');
    if (_confirmEl && typeof _confirmEl.hasAttribute === 'function' && _confirmEl.hasAttribute('mjs-confirm')) {
      e._mjs_mjsConfirmGated = true;
      // lien `@method` que le navigateur suivrait lui-même (Ctrl, Maj, Alt ou Cmd, `target`, `download`, autre origine ;
      // le clic du milieu n'arrive pas ici, cf. µ._mjs_ujsOnAuxClick) : le geste ne fait rien, AVANT la question — après
      // « oui », la relance d'un clic simple aurait envoyé la requête que le geste ne demandait pas ; `get` n'a rien à
      // perdre, la question est posée comme sur un lien ordinaire
      var _methodLink = µ._mjs_closest(target, 'a');
      if (_methodLink && typeof _methodLink.getAttribute === 'function' && _methodLink.getAttribute('mjs-method') && _methodLink.getAttribute('mjs-method').toLowerCase() !== 'get' && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (_methodLink.target && _methodLink.target !== '_self') || _methodLink.hasAttribute('download') || (_methodLink.origin !== window.location.origin && (_methodLink.protocol === 'http:' || _methodLink.protocol === 'https:')))) {
        µ._mjs_navWarnNoUjsMethod(_methodLink, e);
        return;
      }
      // pending : modale déjà ouverte pour CET élément, clics avalés sans re-appeler µ.confirm
      if (_confirmEl._mjs_mjsConfirmPending) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      var _res = typeof µ.confirm === 'function' ? µ.confirm(_confirmEl.getAttribute('mjs-confirm'), _confirmEl) : true;
      // thenable (modale asynchrone) : bloque l'événement d'origine, relance sur résolution vraie
      if (_res && typeof _res.then === 'function') {
        e.preventDefault();
        e.stopImmediatePropagation();
        _confirmEl._mjs_mjsConfirmPending = true;
        _res.then(function(ok) {
          _confirmEl._mjs_mjsConfirmPending = false;
          if (ok && _confirmEl.isConnected) { µ._mjs_ujsConfirmRefire(_confirmEl, null, target); }
        }, function() {
          _confirmEl._mjs_mjsConfirmPending = false;
        });
        return;
      }
      if (!_res) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // accepté sur l'instant : si ce clic part en envoi (bouton d'envoi, Entrée dans un champ), la question de
      // cet envoi est déjà répondue — l'envoi qui suit, dans la même tâche, ne la repose pas (µ._mjs_ujsOnSubmit)
      _confirmEl._mjs_mjsAccepted = true;
      setTimeout(function() { _confirmEl._mjs_mjsAccepted = false; }, 0);
    }
  }
  // appel de la phase de capture (µ._mjs_ujsConfirmClick) : la confirmation seule — le lien attend la
  // remontée, après les gestionnaires, pour qu'un `.prevent` le retienne
  if (e._mjs_ujsGateOnly) {
    // le lien, lu AVANT les gestionnaires : l'un d'eux peut retirer de la page la balise cliquée (une icône du
    // lien, basculée par `{if}`) — la remontée ne retrouverait plus le lien depuis elle
    e._mjs_link = { from: target, link: µ._mjs_closest(target, 'a') };
    return;
  }
  // Modificateurs restants (bouton déjà filtré plus haut) — APRÈS la gate
  // @confirm : un clic-molette/ctrl-clic sur un lien confirmé doit quand même
  // déclencher la popup avant que le navigateur n'ouvre son propre onglet
  // (sauf sur un lien `@method` d'un autre verbe que `get`, retenu avant la question, cf. la gate plus haut).
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    µ._mjs_navWarnNoUjsMethod(e._mjs_link && e._mjs_link.link || µ._mjs_closest(target, 'a'), e);
    return;
  }
  // le lien lu à la capture par la racine la plus proche de la vraie cible (dans une ombre fermée, le document ne voit
  // que l'hôte) ; sinon le plus proche de la cible vue d'ici
  link = e._mjs_link && e._mjs_link.link || µ._mjs_closest(target, 'a');
  if (!link) {
    return;
  }
  if (µ._mjs_navNoUjs(link)) {
    µ._mjs_navWarnNoUjsMethod(link);
    return;
  }
  // `origin` (pas `host`) : un lien http: depuis une page https: partagerait
  // le host mais le fetch serait bloqué mixed-content → navigation avalée.
  // le navigateur suivrait lui-même un lien http(s) vers une autre origine, en GET : un lien `@method` est retenu, averti
  // (sauf `get`, suivi comme un lien ordinaire)
  if (link.origin !== window.location.origin) {
    if (link.protocol === 'http:' || link.protocol === 'https:') { µ._mjs_navWarnNoUjsMethod(link, e); }
    return;
  }
  // Tout target nommé (_blank, iframe nommée…) doit suivre le comportement
  // natif — seul `_self` (ou rien) se fait intercepter.
  if (link.target && link.target !== '_self') {
    µ._mjs_navWarnNoUjsMethod(link, e);
    return;
  }
  if (link.hasAttribute('download')) {
    µ._mjs_navWarnNoUjsMethod(link, e);
    return;
  }
  if (link.protocol === 'javascript:' || link.protocol === 'mailto:') {
    return;
  }
  // LIEN À VERBE HTTP (@method → mjs-method) : toujours intercepté (mêmes
  // garde-fous que ci-dessus, déjà passés) — au lieu du GET natif, requête
  // mutante via le pipeline PARTAGÉ avec la soumission de formulaire
  // (`µ._mjs_navDispatch`, défini plus bas, juste après le handler de submit) :
  // `_method=<verbe>` en corps de formulaire + CSRF automatique (même chemin
  // qu'un submit, cf. mjs_ajax.ts — la réponse suit EXACTEMENT le même
  // traitement : redirection suivie + swap, 422 re-rendu, erreurs → repli).
  // Verbe inconnu → warning puis repli sur la navigation normale ci-dessous
  // (PAS de preventDefault dans ce cas : les branches same-page/cross-page
  // gèrent leur propre interception, comme si `mjs-method` était absent).
  // `get`, quelle que soit sa casse : le verbe même d'un lien, reconnu — la navigation normale, sans avertissement
  // (lien préchargeable, cf. µ._mjs_isPreloadableLink)
  var _methodAttr = typeof link.getAttribute === 'function' ? link.getAttribute('mjs-method') : null;
  if (_methodAttr && _methodAttr.toUpperCase() !== 'GET') {
    var _verb = _methodAttr.toUpperCase();
    if (_verb === 'DELETE' || _verb === 'POST' || _verb === 'PUT' || _verb === 'PATCH') {
      e.preventDefault();
      // Garde anti-double-clic interne (capacité « désactivation pendant
      // soumission ») : une requête mjs-method est déjà en vol pour CE lien.
      if (link._mjs_mjsBusy) {
        return;
      }
      link.setAttribute('aria-disabled', 'true');
      link._mjs_mjsBusy = true;
      var _methodPayload = new FormData();
      _methodPayload.append('_method', _methodAttr.toLowerCase());
      return µ._mjs_navDispatch(link.href, _verb, _methodPayload, {
        via: 'method',
        el: link, // élément d'origine (veilleur flash/error + @callback), lu par closure dans done/fail
        restoreBusy: function() {
          link.removeAttribute('aria-disabled');
          link._mjs_mjsBusy = false;
        }
      });
    }
    // la passe à blanc d'une coupure n'avertit pas : si MJS ne prend pas le lien (il rejouerait, donc avertirait), elle
    // garde l'avertissement pour le dire elle-même
    if (e._mjs_ujsDry) { e._mjs_ujsDryWarn = _methodAttr; }
    else { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsVerbUnknown', { verb: _methodAttr }, 'mjs-method="{verb}" : verbe HTTP non reconnu (get/delete/post/put/patch attendus) — navigation normale.')); }
  }
  // pathname ET search : un lien `?page=2` depuis `?page=1` est une VRAIE
  // navigation — avant (pathname seul), l'URL était poussée mais aucun fetch
  // ne partait → pagination/filtres par query string inutilisables.
  isSamePage = link.pathname === window.location.pathname && link.search === window.location.search;
  if (isSamePage) {
    isHashRoute = link.hash.startsWith('#/');
    // ancre ordinaire (`#section`, ou `#` seul, le haut de la page — sauf depuis une route `#/…` affichée, qu'il quitte
    // par le chemin des routes ci-dessous) : suivie par la navigation elle-même, comme le navigateur, une fois la
    // propagation finie — l'application garde le dernier mot (µ._mjs_anchorClick, µ._mjs_anchorGo)
    if (!isHashRoute && (link.hash || (link.href.indexOf('#') !== -1 && !window.location.hash.startsWith('#/')))) {
      µ._mjs_anchorClick(e, link);
      return;
    }
    e.preventDefault();
    destination = link.pathname + link.search + link.hash;
    // canonicalise le slash final
    // (`#/about/` → `#/about`) AVANT dédoublonnage ET pushState : `_mjs_canonHash`
    // n'était appliqué que dans la branche `pushHistory` de `navigate`, jamais
    // sur ce chemin same-page → un lien `#/about/` laissait l'URL sale (pushState
    // n'émet pas hashchange → `_mjs_canonicalizeUrl` ne repasse pas) et contournait
    // le dédoublonnage (`#/about` ≠ `#/about/` → nouvelle entrée pour la même page).
    var _rt = µ.Router;
    if (_rt && _rt._mjs_canonHash && link.hash) {
      destination = link.pathname + link.search + _rt._mjs_canonHash(link.hash);
    }
    // re-clic sur un lien qui pointe déjà
    // vers la page ET le hash ACTUELLEMENT affichés : pushState empilait quand
    // même une 2e entrée d'historique STRICTEMENT IDENTIQUE à la courante — un
    // seul retour arrière ne faisait alors RIEN de visible (on retombe sur le
    // même contenu déjà affiché), il en fallait DEUX pour vraiment quitter la
    // page. Rien à pousser ni à re-router quand la destination EST déjà celle
    // affichée (préventDefault reste nécessaire : on ne laisse pas le
    // navigateur gérer nativement un lien qu'on a décidé de prendre en charge).
    // lien sans fragment vers la page affichée (ou `#` depuis une route) : le haut de la page, comme le rechargement
    // du navigateur seul
    if (destination === window.location.pathname + window.location.search + window.location.hash) {
      if (!link.hash) { window.scrollTo({ left: 0, top: 0, behavior: 'instant' }); }
      // <routes-idle>
      // la page de cette route n'est pas arrivée (visite coupée) : le reclic de son lien vaut une visite — un essai, sans entrée
      // d'historique en plus ; sans effet quand la page est là ou déjà attendue (mjs_router.ts, navigate)
      if (isHashRoute && _rt && typeof _rt._mjs_resolveModules === 'function' && typeof µ.pathOf === 'function' && _rt._mjs_resolveModules(destination).some((n) => µ.pathOf(n) && !customElements.get('mjs-' + n))) { _rt._mjs_follow = 1; _rt.navigate(destination, false); }
      // </routes-idle>
      return;
    }
    // position de la route quittée, rendue au Précédent (cf. popstate) : le défilement natif est coupé
    if (typeof µ._mjs_saveScroll === 'function') { µ._mjs_saveScroll(window.location.pathname + window.location.search + (window.location.hash || '#')); }
    window.history.pushState({}, '', destination);
    if (!link.hash) { window.scrollTo({ left: 0, top: 0, behavior: 'instant' }); }
    // entrée neuve : la route part du haut de la page (µ.Router.navigate, 4e argument)
    return (ref = µ.Router) != null ? ref.navigate(destination, false, false, true) : void 0;
  } else {
    // sans ajax au cœur, le navigateur suit le lien lui-même (µ._mjs_navNoAjax)
    if (typeof µ._mjs_navNoAjax === 'function' && µ._mjs_navNoAjax()) { return; }
    // la cascade #app-root/mjs-child a disparu : le chemin HTML n'a par nature
    // aucun `target` (pas de fiche), le contenant est donc TOUJOURS <body> côté réponse HTML —
    // il y a donc TOUJOURS quelque chose à échanger (le contenant du cache, lui, est celui du
    // dernier montage : µ._mjs_navCacheZone, plus bas).
    e.preventDefault();
    destination = link.href;
    // pageCache empoisonné : lire
    // `window.location` ICI (au lieu de `µ._mjs_lastUjsPath`) semble correct dans
    // le cas nominal (les deux coïncident), mais diverge lors d'un DOUBLE-CLIC
    // rapide, avant que le fetch du 1er clic ne résolve. Le `pushState`
    // (quelques lignes plus bas) est SYNCHRONE — il déplace `window.location`
    // vers la destination du 1er clic IMMÉDIATEMENT, alors que le DOM affiché
    // reste celui de la page de départ tant que le fetch n'a pas répondu (le
    // swap n'arrive que dans le callback ajax, plus bas). Un 2e clic pendant
    // cette fenêtre lisait `window.location` = destination du 1er clic (déjà
    // poussée) alors que `currentRoot` est ENCORE le DOM du point de départ →
    // `pageCache.set(destinationDu1erClic, rootDuPointDeDépart)` : le contenu
    // de la page de DÉPART se retrouvait caché sous la clé de la page
    // INTERMÉDIAIRE jamais réellement affichée — poison silencieux, révélé
    // seulement bien plus tard (retour en arrière vers cette URL). `_mjs_lastUjsPath`
    // est le signal FIABLE ici : il ne bouge QUE quand le contenu change
    // RÉELLEMENT (cf. commentaire plus bas), donc reflète toujours la page
    // VRAIMENT affichée, contrairement à `window.location` (mutable dès le
    // clic, avant tout swap DOM réel).
    currentPath = µ._mjs_lastUjsPath;
    destPath = link.pathname + link.search;
    fullDest = link.pathname + link.search + link.hash;
    // mjs:before-visit, ANNULABLE : AVANT tout effet de bord (pushState pas encore posé, _mjs_navSeq
    // pas encore bumpé, aucune hibernation) — un écouteur qui annule laisse la page EN PLACE
    // (e.preventDefault() déjà posé plus haut, cf. commentaire ci-dessus : exactement le garde-fou voulu).
    // µ._mjs_navEmitPaths : réutilisé pour `visit`/`load` plus bas (rien ne réassigne destPath/
    // fullDest entre ces émissions).
    evPaths = µ._mjs_navEmitPaths(fullDest);
    if (!µ._mjs_navEmit('before-visit', { path: evPaths.path, url: evPaths.url, via: 'link' }, true)) { return; }
    // pushState AU CLIC : l'URL reflète l'intention immédiatement et l'ordre
    // d'historique ne dépend plus de l'ordre d'arrivée des réponses réseau. Avec l'API Navigation, le même `pushState`
    // part plus bas, la visite prête : l'API l'annonce par un `navigate`, intercepté (µ._mjs_navGo)
    var _navFromUrl = window.location.pathname + window.location.search + window.location.hash;
    if (!µ._mjs_nav) { window.history.pushState({}, '', fullDest); }
    // « rien à installer » (204, corps vide, X-MJS-Method: none) : l'adresse poussée ci-dessus revient sur
    // la page RÉELLEMENT affichée — son URL complète (hash compris) quand elle concorde avec `currentPath`,
    // sinon `currentPath` seul (double clic rapide, cf. bandeau plus haut). replaceState et non
    // history.back() : aucun popstate déclenché, aucune course avec un clic suivant.
    var _revertClickUrl = function() {
      var back = (_navFromUrl.split('#')[0] === currentPath) ? _navFromUrl : currentPath;
      if (typeof back !== 'string' || !back) { return; }
      try { window.history.replaceState({}, '', back); } catch { /* adresse laissée telle quelle */ }
    };
    // la suite, une fois la visite acceptée (µ._mjs_navStart : la navigation précédente abandonnée, puis µ._mjs_navVisit,
    // commune au Précédent / Suivant) : `mjs:visit`, hibernation de la page quittée, cache de pages, sinon requête (le HTML
    // préchargé d'abord), échange, position et focus, routeur, `mjs:load` ; une redirection corrige l'entrée du clic, une
    // réponse sans rien à installer rend l'adresse d'avant (`_revertClickUrl`) ; avec l'API Navigation, acceptée dans la
    // navigation qu'elle intercepte (µ._mjs_navGo)
    var _visit = { via: 'link', from: currentPath, path: destPath, dest: fullDest, url: destination, paths: evPaths, link: link, undo: _revertClickUrl, parser: DOMParser };
    return µ._mjs_nav ? µ._mjs_navGo(fullDest, _visit) : µ._mjs_navStart(_visit);
  }
};
// <<< extrait-test _mjs_ujsOnClick
// la balise est-elle dans un composant léger (sans ombre : ses nœuds sont ceux de la page) ?
µ._mjs_ujsInLight = function(n) {
  for (; n && n.nodeType === 1; n = n.parentNode) {
    if (n._mjs_isLight === true) { return true; }
  }
  return false;
};
// la balise est-elle glissée (slot) dans un composant à ombre ? Elle est alors dans la page, mais le composant l'enveloppe
µ._mjs_ujsInShadowHost = function(n) {
  for (; n && n.nodeType === 1; n = n.parentNode) {
    if (n._shadow) { return true; }
  }
  return false;
};
// un écouteur NATIF peut couper la propagation d'un clic ou d'un envoi de formulaire (`stopPropagation()` sur le
// lien ou le formulaire, sous lui ou sur un de ses conteneurs, en remontée ou posé en capture) : l'écouteur de
// remontée de la navigation ne le verrait jamais, et le navigateur rechargerait la page, ou enverrait lui-même
// le formulaire. Le dernier écouteur de chaque nœud du chemin — derrière ceux de la page, donc après eux,
// `preventDefault` natif compris — prend alors le lien ou l'envoi lui-même dès qu'il voit `cancelBubble`
µ._mjs_ujsCut = function(e) {
  if (!e._mjs_ujsWatch || !e.cancelBubble || e._mjs_ujsTaken) { return; }
  e._mjs_ujsTaken = true;
  µ._mjs_ujsRun(e);
};
// l'action que MJS ferait de cet événement, jouée une fois : la navigation du lien, ou l'envoi du formulaire
µ._mjs_ujsRun = function(e) {
  if (e.type === 'submit') { µ._mjs_ujsOnSubmit(e); }
  else { µ._mjs_ujsOnClick(e); }
};
// une coupure posée sur un nœud que la surveillance ne voit pas (la racine, ou au-dessus d'elle) : d'autres écouteurs du
// même nœud jouent encore, et le dernier mot de l'auteur sur `defaultPrevented` n'est pas dit. Une première passe
// (la prise de MJS appelle `preventDefault()` juste avant d'agir : il lève alors une sentinelle, sans rien faire) dit
// si MJS prendrait le lien ou l'envoi ; si oui, l'action native est retenue, et MJS ne joue qu'une fois la
// propagation finie, sauf si un écouteur de l'auteur a appelé `preventDefault()` entre-temps. Si MJS ne le prend pas
// (modificateur, cible nommée, formulaire à lui), la première passe a déjà tout dit, le navigateur agit comme avant
µ._mjs_ujsHold = function(e) {
  var native = Event.prototype.preventDefault, sentinel = {}, intercepted = false, eventPath;
  if (!e.cancelBubble || e._mjs_ujsTaken) { return; }
  e._mjs_ujsTaken = true;
  if (e.defaultPrevented || !e.cancelable) { µ._mjs_ujsRun(e); return; }
  e.preventDefault = function() { throw sentinel; };
  e._mjs_ujsDry = true;
  try {
    µ._mjs_ujsRun(e);
  }
  catch (thrown) {
    if (thrown !== sentinel) { throw thrown; }
    intercepted = true;
  }
  finally {
    delete e.preventDefault;
    delete e._mjs_ujsDry;
  }
  if (!intercepted) {
    // MJS ne prend pas le lien : personne ne rejouera, l'avertissement du verbe inconnu se dit ici, une fois
    if (e._mjs_ujsDryWarn) { µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsVerbUnknown', { verb: e._mjs_ujsDryWarn }, 'mjs-method="{verb}" : verbe HTTP non reconnu (get/delete/post/put/patch attendus) — navigation normale.')); }
    return;
  }
  eventPath = e.composedPath().slice();
  native.call(e);
  // un écouteur `passive: true` ignore `preventDefault()` : le navigateur agira seul, MJS ne rejoue pas
  if (!e.defaultPrevented) { return; }
  e.preventDefault = function() {
    e._mjs_ujsAuthor = true;
    return native.apply(this, arguments);
  };
  // l'événement est fini quand MJS joue : il lui faut son chemin, et un `defaultPrevented` qui ne dit que l'auteur
  e.composedPath = function() { return eventPath.slice(); };
  Object.defineProperty(e, 'defaultPrevented', { configurable: true, get: function() { return e._mjs_ujsAuthor === true; } });
  // `returnValue` dit l'inverse de `defaultPrevented` ; lui assigner `false` retient l'action, comme le natif
  Object.defineProperty(e, 'returnValue', { configurable: true, get: function() { return e._mjs_ujsAuthor !== true; }, set: function(v) { if (v === false) { e.preventDefault(); } } });
  // `defaultPrevented` ne dit que l'auteur : s'il a retenu l'action entre-temps, MJS n'agit pas
  setTimeout(function() { µ._mjs_ujsRun(e); }, 0);
};
// ce que ces écouteurs ne voient pas : `stopImmediatePropagation()` saute le reste des écouteurs du nœud, les
// leurs compris, et une coupure posée sur un nœud qu'ils ne surveillent pas (la racine, ou au-dessus d'elle :
// `_mjs_ujsWatched` liste les nœuds surveillés) ne passe devant aucun d'eux. Ces appels sont enveloppés, sur CET
// événement ; la coupure à fond est prise dans la microtâche qui suit l'écouteur de l'auteur (le reste des écouteurs
// du nœud est sauté : son dernier mot sur `defaultPrevented` est dit), la coupure simple sur un nœud non surveillé
// passe par µ._mjs_ujsHold (les autres écouteurs du nœud jouent encore). Une microtâche qui tourne après l'envoi
// (clic ou `requestSubmit()` fabriqué par un script, ou par la touche Entrée sous Firefox) trouve `cancelBubble`
// remis à zéro : elle ne fait rien, le navigateur a déjà agi
µ._mjs_ujsWatchStop = function(e) {
  var stop = e.stopPropagation, stopNow = e.stopImmediatePropagation;
  e.stopPropagation = function() {
    stop.apply(this, arguments);
    if (e._mjs_ujsWatched.indexOf(e.currentTarget) < 0) { queueMicrotask(function() { µ._mjs_ujsHold(e); }); }
  };
  e.stopImmediatePropagation = function() {
    stopNow.apply(this, arguments);
    queueMicrotask(function() { µ._mjs_ujsCut(e); });
  };
};
// pose l'écouteur de µ._mjs_ujsCut (en capture et en remontée, une seule fois) sur chaque nœud du chemin de
// l'événement (un clic, ou un envoi de formulaire) jusqu'à `boundary` (exclue : son écouteur de remontée est celui de
// la navigation) — posé deux fois sur un nœud, il ne compte qu'une fois ; un événement qui n'est pas surveillé
// (`_mjs_ujsWatch`) le laisse sans effet
µ._mjs_ujsWatchPath = function(e, boundary) {
  var eventPath = typeof e.composedPath === 'function' ? e.composedPath() : [], i;
  e._mjs_ujsWatch = true;
  if (!e._mjs_ujsWatched) {
    e._mjs_ujsWatched = [];
    µ._mjs_ujsWatchStop(e);
  }
  for (i = 0; i < eventPath.length && eventPath[i] !== boundary; i++) {
    eventPath[i].addEventListener(e.type, µ._mjs_ujsCut, { once: true });
    eventPath[i].addEventListener(e.type, µ._mjs_ujsCut, { once: true, capture: true });
    e._mjs_ujsWatched.push(eventPath[i]);
  }
};
// écouteur de CAPTURE : la seule confirmation @confirm de µ._mjs_ujsOnClick, avant tout gestionnaire —
// le lien, lui, est pris en charge à la remontée (cf. µ._mjs_ujsShadowAttach). Un gestionnaire qui coupe la
// remontée (`.stop`) empêcherait la navigation de voir le lien : le routeur du composant la joue alors
// lui-même (mjs_element.ts, `_mjs_bindEvents`, `e._mjs_afterStop`), comme pour un formulaire. Un écouteur
// natif qui la coupe (`stopPropagation()` en remontée ou posé en capture, `stopImmediatePropagation()`) est
// surveillé (µ._mjs_ujsWatchPath, µ._mjs_ujsWatchStop) sur la racine d'une ombre, et dans un composant léger de
// la page — le lien d'une page ordinaire reste à son écouteur de remontée
µ._mjs_ujsConfirmClick = function(e) {
  var boundary = e.currentTarget;
  e._mjs_ujsGateOnly = true;
  try {
    µ._mjs_ujsOnClick(e);
  }
  finally {
    e._mjs_ujsGateOnly = false;
  }
  e._mjs_afterStop = µ._mjs_ujsOnClick;
  if (boundary && !e.defaultPrevented && e._mjs_link && e._mjs_link.link && e._mjs_link.from === µ.realTarget(e) && (boundary !== document || µ._mjs_ujsInLight(e._mjs_link.from))) {
    µ._mjs_ujsWatchPath(e, boundary);
  }
};
// capture du pont shadow : la même confirmation, posée sur la racine de l'ombre (seul endroit où un shadow
// fermé laisse voir la vraie cible)
µ._mjs_ujsShadowClick = function(e) {
  µ._mjs_ujsConfirmClick(e);
};
// la confirmation, en capture sur le document : avant l'écouteur propre d'un bouton servi par le back
// et avant le routeur d'un composant léger (délégation en capture sur sa balise) — à la remontée,
// l'action était déjà partie ; le lien, lui, reste pris en charge à la remontée
document.addEventListener('click', µ._mjs_ujsConfirmClick, true);
document.addEventListener('click', µ._mjs_ujsOnClick);
// clic du milieu : un `auxclick`, jamais un `click` — le navigateur ouvrirait le lien dans un onglet, en GET ; un lien
// `@method` y est retenu, averti, sauf `get` (µ._mjs_navWarnNoUjsMethod). Posé aussi sur la racine d'une ombre
// (µ._mjs_ujsShadowAttach) : dans une ombre fermée, le document ne voit que l'hôte
µ._mjs_ujsOnAuxClick = function(e) {
  if (e.button === 1) { µ._mjs_navWarnNoUjsMethod(µ._mjs_closest(µ.realTarget(e), 'a'), e); }
};
document.addEventListener('auxclick', µ._mjs_ujsOnAuxClick);

// la valeur du champ `_method` d'un formulaire sans construire de `FormData`, dans le même ordre : le premier contrôle de
// ce nom qui serait envoyé (ni désactivé, ni case décochée, ni fichier, jamais un bouton), puis le bouton qui envoie
// (`submitter`), que `FormData` ne connaît pas non plus et qu'on lui ajoute en dernier
µ._mjs_ujsMethodField = function(form, submitter) {
  var els = form.elements, i, el;
  for (i = 0; els && i < els.length; i++) { // eslint-disable-line no-unmodified-loop-condition -- els est une garde de nullité, invariante par construction : la sortie se fait par i, incrémenté à chaque tour
    el = els[i];
    if (el.name !== '_method' || el.disabled || el.type === 'file') { continue; }
    if (el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'image') { continue; }
    if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) { continue; }
    return el.value;
  }
  if (submitter && submitter.name === '_method') { return submitter.value; }
  return null;
};
// Nommé (au lieu d'anonyme) — même raison que µ._mjs_ujsOnClick ci-dessus :
// réutilisé tel quel par le PONT SHADOW (µ._mjs_ujsShadowAttach, plus bas).
// >>> extrait-test _mjs_ujsOnSubmit
µ._mjs_ujsOnSubmit = function(e) {
  var form, method, payload, submitter, url;
  // Garde anti double-passage pont→document (shadow OPEN, aucun retargeting, cf. le commentaire de
  // µ._mjs_ujsOnClick sur cette même dette) : un refus/thenable @confirm pose `e.preventDefault()` DANS
  // la gate ci-dessous (pas ici, plus en amont comme avant) — cette garde-ci absorbe donc le 2ᵉ
  // passage pour CES deux cas. Le 3ᵉ cas (acceptation SYNCHRONE) ne pose PAS `preventDefault` dans la
  // gate : c'est le marqueur `e._mjs_mjsConfirmGated` (juste en dessous, comme le clic) qui protège celui-là.
  if (e.defaultPrevented) {
    return;
  }
  form = µ._mjs_closest(µ.realTarget(e), 'form');
  if (!form) {
    return;
  }
  // CONFIRMATION AVANT ACTION (@confirm → mjs-confirm) — HISSÉE ici, AVANT le test d'opt-out
  // (défaut corrigé : un formulaire `@noUJS` + `@confirm` doit être confirmé, comme un lien
  // `@noUJS` + `@confirm` l'est déjà côté clic) : remonte du nœud RÉELLEMENT soumissionnaire (le
  // bouton cliqué, `e.submitter` ; repli sur le <form> lui-même pour un Enter/une soumission
  // programmatique) au porteur `mjs-confirm` le plus proche. Marqueur `e._mjs_mjsConfirmGated`, EN
  // MIROIR du clic — nécessaire : le `preventDefault()` inconditionnel qui absorbait
  // seul le double passage pont→document n'est plus en amont (une acceptation synchrone ne prévient
  // plus rien ici, cf. plus bas), donc le marqueur est ce qui empêche un 2ᵉ appel de µ.confirm.
  // EN MIROIR de la garde clic ci-dessus : le marqueur
  // ne se pose qu'APRÈS avoir trouvé un VRAI porteur `[mjs-confirm]`, sinon le pont EXTERNE d'un
  // formulaire imbriqué dans un composant lui-même imbriqué fermerait la garde à tort avant que
  // le pont INTERNE (seul à voir le vrai porteur) n'ait joué µ.confirm.
  if (!e._mjs_mjsConfirmGated) {
    var _confirmSrc = (e.submitter && typeof e.submitter.closest === 'function') ? e.submitter : form;
    var _confirmEl = µ._mjs_closest(_confirmSrc, '[mjs-confirm]');
    // mémorisé ICI (avant tout `await`/thenable, cf.
    // µ._mjs_ujsConfirmRefire) — le vrai soumissionnaire de CETTE soumission, retransmis au replay.
    var _confirmSubmitter = e.submitter;
    if (_confirmEl && typeof _confirmEl.hasAttribute === 'function' && _confirmEl.hasAttribute('mjs-confirm')) {
      e._mjs_mjsConfirmGated = true;
      // pending : modale déjà ouverte pour CET élément, soumissions avalées sans re-appeler µ.confirm
      if (_confirmEl._mjs_mjsConfirmPending) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // déjà répondue par le clic accepté qui a déclenché cet envoi (même tâche, cf. µ._mjs_ujsOnClick) : pas de
      // seconde question — cette réponse ne vaut que pour cet envoi
      var _res = _confirmEl._mjs_mjsAccepted ? true : (typeof µ.confirm === 'function' ? µ.confirm(_confirmEl.getAttribute('mjs-confirm'), _confirmEl) : true);
      _confirmEl._mjs_mjsAccepted = false;
      // thenable (modale asynchrone) : bloque la soumission d'origine, relance sur résolution vraie
      if (_res && typeof _res.then === 'function') {
        e.preventDefault();
        e.stopImmediatePropagation();
        _confirmEl._mjs_mjsConfirmPending = true;
        _res.then(function(ok) {
          _confirmEl._mjs_mjsConfirmPending = false;
          if (ok && _confirmEl.isConnected) { µ._mjs_ujsConfirmRefire(_confirmEl, form, null, _confirmSubmitter); }
        }, function() {
          _confirmEl._mjs_mjsConfirmPending = false;
        });
        return;
      }
      if (!_res) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // acceptation SYNCHRONE : on NE prévient PAS ici — la suite du handler décide (opt-out →
      // soumission native CONFIRMÉE ; sinon `e.preventDefault()` inconditionnel plus bas, à sa
      // place habituelle, comme si @confirm n'avait jamais existé).
    }
  }
  // appel de la phase de capture (µ._mjs_ujsConfirmSubmit) : la confirmation seule — l'envoi attend la
  // remontée, après les gestionnaires du composant, pour qu'un `@submit.prevent` le retienne
  if (e._mjs_ujsGateOnly) {
    return;
  }
  if (µ._mjs_navNoUjs(form)) {
    return;
  }
  // `submitter` remonté ICI (avant, plus bas, lu
  // seulement pour name/value) — un <button formaction/formtarget/formmethod> soumissionnaire a
  // la PRIORITÉ HTML sur les attributs du <form> lui-même ; repli sur ceux du <form> si le bouton
  // ne porte pas l'attribut, ou pour une soumission par la touche Entrée (e.submitter === null,
  // aucun bouton n'a déclenché l'envoi). Avant, target/action/method du FORMULAIRE
  // étaient lus inconditionnellement : un <button formaction="/autre"> partait vers l'action du
  // <form>, jamais la sienne.
  submitter = e.submitter;
  // form.target/form.action sont les PROPRIÉTÉS IDL de HTMLFormElement : un
  // <input name="target">/<input name="action"> dans le formulaire les MASQUE par l'ÉLÉMENT nommé
  // (règle HTML des propriétés nommées) — new URL(élément) lève un TypeError, et l'élément (truthy)
  // faisait sortir la fonction en silence. On lit les ATTRIBUTS, jamais les propriétés IDL ;
  // l'action relative se résout contre la page, une action inanalysable laisse faire le navigateur.
  // lecture par PRÉSENCE, jamais par troncature `||` —
  // `formaction=""`/`formmethod=""`/`formtarget=""` sont des valeurs HTML VALIDES (pas une absence) :
  // le `||` précédent les traitait comme absentes et retombait à tort sur le `<form>`. `hasAttribute`
  // (repli `getAttribute(...) !== null` pour un objet de test sans `hasAttribute`).
  var _attrPresent = function(el, name) {
    if (!el) { return false; }
    if (typeof el.hasAttribute === 'function') { return el.hasAttribute(name); }
    return typeof el.getAttribute === 'function' && el.getAttribute(name) !== null;
  };
  var _formTarget = _attrPresent(submitter, 'formtarget') ? submitter.getAttribute('formtarget') : form.getAttribute('target');
  if (_formTarget && _formTarget !== '_self') {
    return;
  }
  var _actionAttr;
  if (_attrPresent(submitter, 'formaction')) {
    // formaction="" : valeur vide d'un attribut URL présent = URL du document (sémantique HTML),
    // jamais l'action du <form> — on NE retombe PAS sur `form.getAttribute('action')` ici.
    // `.split('#')[0]` : `document.URL` porte le
    // FRAGMENT courant (ex. une ancre de section) — sans ce retrait, une soumission GET voyait sa
    // query construite plus bas (`_mjs_navDispatch`) atterrir SYNTAXIQUEMENT dans le fragment
    // (`.../search#results?q=hello`), perdue au fetch réel (`URL().search` vide). Un fragment n'a
    // jamais fait partie de la « URL du document » au sens formulaire de la spec HTML.
    _actionAttr = submitter.getAttribute('formaction') || document.URL.split('#')[0];
  }
  else {
    _actionAttr = form.getAttribute('action');
  }
  if (_actionAttr) {
    var _actionOrigin;
    try {
      _actionOrigin = new URL(_actionAttr, window.location.href).origin;
    } catch {
      return; // action inanalysable : soumission NATIVE, aucun preventDefault
    }
    if (_actionOrigin !== window.location.origin) {
      return;
    }
  }
  // la passe à blanc d'une coupure ne construit aucun `FormData` (il joue l'événement `formdata`, un effet de bord) :
  // le champ `_method` est lu sur les contrôles du formulaire
  if (!e._mjs_ujsDry) {
    payload = new FormData(form);
    if (submitter && submitter.name) {
      payload.append(submitter.name, submitter.value);
    }
  }
  // payload.get('_method') peut rendre un File (input file nommé "_method") :
  // ne retenir la valeur que si c'est une chaîne, jamais method.toUpperCase() sur un objet.
  // ordre : `_method` (champ, override explicite du verbe,
  // INCHANGÉ) > `formmethod` du bouton soumissionnaire > `method` du <form> > GET.
  var _m = payload ? payload.get('_method') : µ._mjs_ujsMethodField(form, submitter);
  var _methodFromAttr = false;
  if (typeof _m === 'string' && _m) {
    method = _m;
  }
  else if (_attrPresent(submitter, 'formmethod')) {
    // Valeur vide/invalide d'un attribut énuméré présent = son défaut GET (jamais le
    // <form>) ; 'dialog'/'post' explicites conservés (inchangé).
    var _fm = (submitter.getAttribute('formmethod') || '').toUpperCase();
    method = (_fm === 'POST' || _fm === 'DIALOG') ? _fm : 'GET';
    _methodFromAttr = true;
  }
  else {
    method = form.getAttribute('method') || 'GET';
    _methodFromAttr = true;
  }
  method = method.toUpperCase();
  // `method="dialog"` (HTML) ferme le <dialog> englobant SANS réseau, jamais intercepté par
  // l'UJS (spec HTML : cette méthode de formulaire n'envoie rien) — sinon `_mjs_navDispatch` refusait le
  // verbe (`Unsupported HTTP verb: DIALOG`) et bloquait la fermeture native sans repli. Résolu ICI,
  // AVANT `e.preventDefault()` (déplacé plus bas, pas avant comme le reste de cette fonction) : sortir
  // après l'aurait déjà empêché le navigateur de fermer la boîte.
  // le défaut natif ne vaut QUE si DIALOG vient d'un
  // ATTRIBUT HTML (`_methodFromAttr`, posé ci-dessus) : un `_method` de champ caché n'est PAS une
  // méthode HTML — laisser filer soumettrait le <form> avec SON vrai `method` réel (souvent post),
  // en silence, <dialog> jamais fermé. Refusé explicitement, comme précédemment pour ce cas précis.
  if (method === 'DIALOG') {
    if (!_methodFromAttr) {
      e.preventDefault();
      µ.error('[µ.UJS] ' + µ._mjs_txt('ujsMethodDialog', null, '_method=dialog n\'a pas de sens : dialog est un attribut method/formmethod, pas un verbe HTTP'));
      return;
    }
    return;
  }
  // sans ajax au cœur, le navigateur envoie le formulaire lui-même (µ._mjs_navNoAjax)
  if (typeof µ._mjs_navNoAjax === 'function' && µ._mjs_navNoAjax()) { return; }
  e.preventDefault();
  // MÊME retrait de fragment que `document.URL`
  // ci-dessus, même raison (formulaire sans action ni formaction : repli sur l'URL de la page).
  url = _actionAttr || window.location.href.split('#')[0];
  // DÉSACTIVATION PENDANT SOUMISSION : boutons de soumission du formulaire
  // (`disabled`) + `aria-busy="true"` sur le <form> — restaurés dans TOUS les
  // chemins de sortie par `_mjs_navDispatch` (`opts.restoreBusy`, appelé
  // inconditionnellement au début de `done`/`fail` : succès+swap et 422
  // n'ont RIEN à restaurer, le <form> disabled est remplacé PAR le swap ;
  // échec réseau/repli restaure explicitement — idempotent/sans effet si
  // l'élément a déjà quitté le DOM). Opt-out : `mjs-no-disable` sur le <form>.
  var _submitButtons = [];
  var _busyForm = null;
  if (!(typeof form.hasAttribute === 'function' && form.hasAttribute('mjs-no-disable')) && typeof form.querySelectorAll === 'function') {
    // envoi déjà en vol pour un formulaire qui modifie (POST, PUT, PATCH, DELETE) : ignoré — les boutons désactivés
    // n'arrêtent ni la touche Entrée d'un formulaire sans bouton ni un `requestSubmit()`, la requête serait partie deux
    // fois. Un GET (recherche en direct, `requestSubmit()` à chaque frappe) part à chaque fois : il abandonne celui en
    // vol, la dernière réponse gagne
    if (form._mjs_mjsBusy && method !== 'GET') {
      return;
    }
    form._mjs_mjsBusy = true;
    var _btnList = form.querySelectorAll("button[type='submit'], button:not([type]), input[type='submit']");
    for (var _bi = 0; _bi < _btnList.length; _bi++) {
      _submitButtons.push(_btnList[_bi]);
      _btnList[_bi].disabled = true;
    }
    if (typeof form.setAttribute === 'function') { form.setAttribute('aria-busy', 'true'); }
    _busyForm = form;
  }
  // jeton anti-course
  // `µ._mjs_navSeq` PARTAGÉ avec le clic (clic ET submit se disputent le MÊME
  // "qui a gagné la course d'affichage") : géré désormais par `_mjs_navDispatch`
  // (chemin PARTAGÉ avec le lien mjs-method, cf. handler de clic plus haut).
  // le format déclaré par le bouton soumissionnaire (`formenctype`), à défaut par le <form> (`enctype`)
  var _enctype = _attrPresent(submitter, 'formenctype') ? submitter.getAttribute('formenctype') : form.getAttribute('enctype');
  return µ._mjs_navDispatch(url, method, payload, {
    el: submitter || form, // élément d'origine (veilleur flash/error + @callback), lu par closure dans done/fail
    form: form, // la réussite ou l'échec de l'envoi lui est dit (effets `on: success|error`)
    multipart: String(_enctype || '').toLowerCase() === 'multipart/form-data',
    restoreBusy: function() {
      for (var _bj = 0; _bj < _submitButtons.length; _bj++) { _submitButtons[_bj].disabled = false; }
      if (_busyForm) { _busyForm._mjs_mjsBusy = false; }
      if (_busyForm && typeof _busyForm.removeAttribute === 'function') { _busyForm.removeAttribute('aria-busy'); }
    }
  });
};
// <<< extrait-test _mjs_ujsOnSubmit
// écouteur de CAPTURE, comme pour un lien : la seule confirmation @confirm de µ._mjs_ujsOnSubmit, avant
// tout gestionnaire (un refus empêche aussi le `@submit` du composant) — l'envoi, lui, est pris en charge
// à la remontée, une fois les gestionnaires joués : `e.defaultPrevented` dit alors si l'un d'eux l'a
// retenu. Un gestionnaire qui coupe la remontée (`.stop`) cacherait la soumission à la navigation : le
// routeur du composant la lui rend (mjs_element.ts, `_mjs_bindEvents`, `e._mjs_afterStop`). Un écouteur natif
// qui la coupe (`stopPropagation()` en remontée ou posé en capture, `stopImmediatePropagation()`) est
// surveillé comme pour un lien (µ._mjs_ujsWatchPath, µ._mjs_ujsWatchStop) sur la racine d'une ombre, dans
// un composant léger de la page, et pour un formulaire de la page glissé (slot) dans un composant à ombre (la coupure
// peut alors venir de l'hôte, du body ou du document, avant le pont de l'ombre ; une coupure en capture sur `window`
// joue avant toute écoute de MJS : le navigateur envoie le formulaire) — le formulaire d'une page ordinaire reste à
// son écouteur de remontée, donc au navigateur quand un écouteur le coupe. Rappelée par cette surveillance, µ._mjs_ujsOnSubmit garde ses refus :
// `preventDefault()` de l'auteur, formulaire que la navigation ne prend pas
µ._mjs_ujsConfirmSubmit = function(e) {
  var boundary = e.currentTarget, form;
  e._mjs_ujsGateOnly = true;
  try {
    µ._mjs_ujsOnSubmit(e);
  }
  finally {
    e._mjs_ujsGateOnly = false;
  }
  e._mjs_afterStop = µ._mjs_ujsOnSubmit;
  form = µ._mjs_closest(µ.realTarget(e), 'form');
  if (boundary && form && !e.defaultPrevented && (boundary !== document || µ._mjs_ujsInLight(form) || µ._mjs_ujsInShadowHost(form))) {
    µ._mjs_ujsWatchPath(e, boundary);
  }
};
document.addEventListener('submit', µ._mjs_ujsConfirmSubmit, true);
document.addEventListener('submit', µ._mjs_ujsOnSubmit);

// PONT SHADOW (retargeting) — un listener document-level ne voit JAMAIS la
// cible réelle d'un clic/submit survenu dans un Shadow DOM FERMÉ : la spec
// retargete `e.target` à la frontière du shadow, `document.addEventListener`
// ne reçoit que le HOST (le custom element), jamais le <a>/<button> interne —
// `closest()` depuis le host ne retrouve donc jamais l'élément réellement
// cliqué (symptôme prouvé : @confirm sur un bouton dans un composant →
// suppression SANS popup). Le pont attache les MÊMES handlers nommés
// ci-dessus DIRECTEMENT sur le shadow root : à ce niveau, `e.target` N'EST
// PAS retargeté (on est À L'INTÉRIEUR de la frontière), `closest()`
// fonctionne normalement. Appelé par mjs_element.ts (constructor) dès qu'un
// VRAI shadow root est établi (jamais pour le repli `mjs-light`, qui vit déjà
// en light DOM sous document — le pont y serait un doublon pur). Marqueur
// `_mjs_mjsUjsBound` sur le root : idempotent, un composant qui recrée/réadopte
// son shadow n'accumule pas 2 paires de listeners.
//
// CAPTURE, pas bulle (3ᵉ argument `true`) — DÉTERMINANT : le routeur du composant
// (`_mjs_bindEvents`, mjs_element.ts, délégation @click/@submit) est UN écouteur par
// type, posé aux DEUX phases de sa racine, qui route chaque événement dans l'une ou
// l'autre. Sur un ANCÊTRE du nœud réellement cliqué (le shadow root ici), la phase
// CAPTURE s'exécute TOUJOURS avant la phase BULLE, et dans une même phase les
// écouteurs jouent dans l'ordre où ils ont été posés : en capture ET posé AVANT
// (constructor, cf. mjs_element.ts), le pont passe avant le routeur dans les deux
// cas, assez tôt pour qu'un refus @confirm (`stopImmediatePropagation`) empêche le
// handler du composant de tourner (constaté : posé en bulle, `remove()` s'exécutait
// quand même malgré un refus).
//
// CLIC EN DEUX TEMPS — la capture ne porte QUE la confirmation (µ._mjs_ujsShadowClick) : la prise en
// charge du lien y passait aussi, avant les gestionnaires du composant, et un `@click.prevent` sur un
// `<a href="#/…">` arrivait trop tard (adresse déjà poussée). Le lien est lu à la REMONTÉE, sur ce même
// shadow root (seul endroit où un shadow fermé le laisse voir), une fois les gestionnaires joués :
// `e.defaultPrevented` dit alors si l'un d'eux l'a retenu. Un gestionnaire qui coupe la remontée
// (`.stop`) n'arrête pas la navigation pour autant : le routeur du composant la relance lui-même
// (mjs_element.ts, `_mjs_bindEvents`). La soumission suit le même partage (µ._mjs_ujsConfirmSubmit) :
// la question en capture, l'envoi à la remontée — un `@submit.prevent` le retient.
µ._mjs_ujsShadowAttach = function(root) {
  if (!root || root._mjs_mjsUjsBound) {
    return;
  }
  root._mjs_mjsUjsBound = true;
  root.addEventListener('click', µ._mjs_ujsShadowClick, true);
  root.addEventListener('click', µ._mjs_ujsShadowLate);
  root.addEventListener('auxclick', µ._mjs_ujsOnAuxClick);
  root.addEventListener('submit', µ._mjs_ujsConfirmSubmit, true);
  root.addEventListener('submit', µ._mjs_ujsShadowLate);
  // survol : dans une ombre fermée, l'écouteur du document ne voit que l'hôte, jamais le lien
  root.addEventListener('pointerover', µ._mjs_ujsHover);
};
// remontée sur la racine d'une ombre. Comme l'action par défaut du navigateur, qui attend la fin de la propagation, la
// navigation ne décide qu'une fois joués tous les écouteurs : un événement qui sort de l'ombre (un clic, un formulaire
// de la page glissé dans le composant) est pris par l'écouteur de remontée du document — un `@click.prevent` que le
// parent pose sur la balise de l'enfant retient ainsi le lien écrit dans l'enfant. Le lien a été lu à la capture
// (`e._mjs_link`, depuis la racine qui voit la vraie cible), et la surveillance des coupures natives
// (µ._mjs_ujsWatchPath) s'étend aux nœuds qui restent jusqu'au document. Celui qui reste dans l'ombre (l'envoi d'un
// formulaire du composant, qui ne la traverse pas) est pris ici, derrière les gestionnaires du composant
µ._mjs_ujsShadowLate = function(e) {
  var p = e.composedPath(), i = p.indexOf(e.currentTarget), d = p.indexOf(document);
  if (d < 0) {
    µ._mjs_ujsRun(e);
    return;
  }
  for (i++; e._mjs_ujsWatch && i < d; i++) {
    p[i].addEventListener(e.type, µ._mjs_ujsCut, { once: true });
    e._mjs_ujsWatched.push(p[i]);
  }
};
// le routeur d'un composant (mjs_element.ts, `_mjs_bindEvents`) écoute aussi à la remontée sur cette racine, posé après
// ce pont : l'écouteur de remontée repasse derrière lui, la navigation lit l'action une fois les gestionnaires du
// composant joués
µ._mjs_ujsLate = function(root, type) {
  if ((type === 'click' || type === 'submit') && root._mjs_mjsUjsBound) {
    root.removeEventListener(type, µ._mjs_ujsShadowLate);
    root.addEventListener(type, µ._mjs_ujsShadowLate);
  }
};

// Chemin PARTAGÉ soumission de formulaire / lien mjs-method : construit et
// dispatche la requête ajax (verbe GET/HEAD/DELETE/POST/PUT/PATCH), gère la
// réponse EXACTEMENT comme un submit (PRG, 422 re-rendu via `done`,
// invalidation cache, warn sur réponse non reconnue — commentaires
// historiques ci-dessous, inchangés). Posé ICI (une seule fois pour les DEUX
// appelants) : jeton anti-course `µ._mjs_navSeq`, abandon du fetch précédent
// (`_mjs_abortStaleNav`), état réactif `µ.nav`, focus post-swap. `opts.restoreBusy`
// (facultatif) : rappelé inconditionnellement au DÉBUT de `done`/`fail` — cf.
// commentaire du handler submit plus haut pour le raisonnement des 3 chemins
// de sortie (succès+swap/422/échec). `µ.nav`, LUI, ne doit PAS retomber si
// CETTE navigation est périmée (une plus récente en a déjà pris la charge) —
// d'où un reset séparé, gardé par `!stale`/`seq === µ._mjs_navSeq`.
// >>> extrait-test _mjs_navDispatch
µ._mjs_navDispatch = function(url, method, payload, opts) {
  var qs, getUrl, seq, navCtrl, navSignal, via, emitPath, emitUrl, evPaths;
  opts = opts || {};
  via = opts.via || 'form';
  // qs/getUrl calculés ICI (déplacés depuis la branche GET plus bas, retirés là-bas) : sur
  // un formulaire GET, `detail.url` de before-visit/visit doit porter la query, pas l'action nue.
  if (method === 'GET' || method === 'HEAD') {
    // `url` peut porter un FRAGMENT explicite (une
    // action `/x#anchor`, jamais retirée : seuls `document.URL`/`window.location.href`, ci-dessus
    // dans µ._mjs_ujsOnSubmit, le sont À LA SOURCE). Sans ce détachement, la query s'ajoutait APRÈS le
    // `#` — la query atterrissait SYNTAXIQUEMENT dans le fragment, invisible d'un fetch réel. Le
    // fragment (s'il en reste un) est ré-accroché APRÈS la query, jamais avant.
    var _urlHashIdx = url.indexOf('#');
    var _urlBase = _urlHashIdx >= 0 ? url.slice(0, _urlHashIdx) : url;
    var _urlHash = _urlHashIdx >= 0 ? url.slice(_urlHashIdx) : '';
    qs = new URLSearchParams(payload).toString();
    // spec HTML (form GET, « mutate action URL ») : la
    // query DU FORMULAIRE REMPLACE celle de l'action, jamais ne s'y AJOUTE (comportement natif d'un
    // `<form method="get">`, sans UJS) — avant, `sep` choisissait `&` dès que `_urlBase` portait
    // déjà un `?` (query ACCUMULÉE : `/x?existing=1&q=hello` au lieu de `/x?q=hello` ; `action="?"` →
    // `?&q=hello`, `&` orphelin). `qs` VIDE (formulaire sans champ) : `_urlBase` gardée TELLE QUELLE,
    // query existante comprise — la spec remplacerait par une query VIDE (`/x?`) mais rien ne dépend
    // d'un `?` nu, comportement historique conservé (pragmatique, signalé plutôt que corrigé).
    var _urlQIdx = _urlBase.indexOf('?');
    var _urlNoQuery = _urlQIdx >= 0 ? _urlBase.slice(0, _urlQIdx) : _urlBase;
    getUrl = (qs ? _urlNoQuery + '?' + qs : _urlBase) + _urlHash;
  }
  // µ._mjs_navEmitPaths : `url` peut être ABSOLUE (lien @method → link.href ; formulaire sans
  // action → repli window.location.href, tous deux TOUJOURS absolus) — `url`/`getUrl` eux-mêmes
  // restent intacts (le fetch réel plus bas s'en sert tel quel).
  evPaths = µ._mjs_navEmitPaths(getUrl || url);
  emitPath = evPaths.path;
  emitUrl = evPaths.url;
  // mjs:before-visit, ANNULABLE : tout en TÊTE, avant TOUT effet de bord (seq pas encore bumpé,
  // aucun abandon de fetch précédent, µ.nav pas encore posé, aucune hibernation). Annulé : `restoreBusy`
  // rappelé s'il existe (posé par l'appelant AVANT cet appel — sinon un lien @method resterait
  // aria-disabled à vie), puis sortie immédiate.
  if (!µ._mjs_navEmit('before-visit', { path: emitPath, url: emitUrl, via: via }, true)) {
    if (typeof opts.restoreBusy === 'function') { opts.restoreBusy(); }
    return;
  }
  seq = ++µ._mjs_navSeq;
  // un envoi quitte la page affichée comme un lien, quel que soit son verbe : elle le reste jusqu'à la réponse, et un
  // retour sur l'une de ses entrées avant elle abandonne l'envoi (cf. popstate, µ._mjs_navHibernate)
  µ._mjs_navLeft = µ._mjs_lastUjsPath + ' ' + seq;
  navCtrl = typeof µ._mjs_abortStaleNav === 'function' ? µ._mjs_abortStaleNav() : null;
  navSignal = navCtrl ? navCtrl.signal : void 0;
  if (µ.nav) { µ.nav.active = true; µ.nav.href = url; }
  if (typeof µ._mjs_navProgressStart === 'function') { µ._mjs_navProgressStart(); } // armé indépendamment de µ.nav (la barre de navigation, mjs_nav_progress.ts)
  // mjs:visit, non annulable : ce chemin (soumission/@method) ne lit jamais le cache.
  µ._mjs_navEmit('visit', { path: emitPath, url: emitUrl, via: via, cached: false }, false);
  var _restoreBusy = function() {
    if (typeof opts.restoreBusy === 'function') { opts.restoreBusy(); }
  };
  // Funnel UNIQUE de tous les retours de _mjs_navDispatch (done non périmé, fail 422, fail générique,
  // verbe non supporté, plus bas) : y accrocher µ._mjs_navProgressStop ici couvre tous ces sites d'un coup.
  var _restoreNav = function() {
    if (µ.nav) { µ.nav.active = false; µ.nav.href = null; }
    if (typeof µ._mjs_navProgressStop === 'function') { µ._mjs_navProgressStop(); }
  };
  // envoi dont la réponse n'installe rien (« ne bouge pas », 204, réponse non reconnue, échec) : la page affichée
  // reste, plus rien ne la quitte (µ._mjs_navLeft) ; formulaire GET : l'adresse poussée au geste revient sur elle —
  // son adresse complète, fragment compris, quand elle concorde avec `_curPath`, comme au clic — et la photo prise au
  // départ pour le cache cesse de marquer hibernés des nœuds toujours affichés (`_curPath`/`_getFromUrl` : branche GET,
  // plus bas)
  var _undoGet = function() {
    var back;
    µ._mjs_navLeft = null;
    if (method !== 'GET' && method !== 'HEAD') { return; }
    if (typeof µ._mjs_navDropHibernation === 'function') { µ._mjs_navDropHibernation(); }
    back = (typeof _getFromUrl === 'string' && _getFromUrl.split('#')[0] === _curPath) ? _getFromUrl : _curPath;
    if (typeof back !== 'string' || !back) { return; }
    try { window.history.replaceState({}, '', back); } catch { /* adresse laissée telle quelle */ }
  };
  // envoi qui modifie le serveur (verbe autre que GET/HEAD) : `µ.pageCache` (pages hibernées) et `µ._mjs_preloadCache`
  // (HTML préchargé au survol/eager) sont figés au contenu lu AVANT la mutation. Exemple concret : DELETE d'un post
  // depuis sa page de détail, retour vers `/posts` — si `/posts` est encore en cache (visitée juste avant), le post
  // supprimé y restait listé indéfiniment (contenu obsolète resservi, sans aucun nouveau fetch). Aucune granularité
  // possible (pas de tag de dépendance page↔ressource dans ce framework) : on purge tout par sécurité, au prix d'un
  // simple re-fetch au prochain accès — même politique que Turbo/Rails-UJS après un submit non-GET. `pageCache` reste
  // sûr à vider : `.clear()` (LRUCache, mjs_page_cache.ts) passe par onEvict pour chaque entrée (sinon les arbres DOM
  // hibernés qu'il contient fuiraient leurs timers). Une seule aide pour les cinq sorties de `done`/`fail` (fiche JSON,
  // page installée, rien d'installé, 422, échec) : un correctif posé ici vaut pour toutes
  var _purgeCaches = function() {
    if (method === 'GET' || method === 'HEAD') { return; }
    if (µ.pageCache && µ.pageCache.clear) { µ.pageCache.clear(); }
    if (µ._mjs_preloadCache && µ._mjs_preloadCache.clear) { µ._mjs_preloadCache.clear(); }
    if (µ._mjs_preloaded && µ._mjs_preloaded.clear) { µ._mjs_preloaded.clear(); }
  };
  // envoi qui modifie le serveur abandonné en route (retour sur la page, navigation plus récente) : sans réponse, ni
  // `done` ni `fail` ne passent, alors qu'il a pu arriver au serveur — les caches se vident en `always`, comme après
  // une réponse
  var _answered = false;
  var _always = function() {
    _restoreBusy();
    if (!_answered) { _purgeCaches(); }
  };
  var done = function(html, finalUrl, _schemaKey, nav) {
    var stale, absUrl, shouldPush, _swapped, _installedZone, loadPaths;
    stale = seq !== µ._mjs_navSeq;
    // posé à true SEULEMENT dans la branche HTML+zone (seule à installer réellement un
    // contenu ici — le JSON émet dans µ._mjs_navApplyJson, 422/échec/réponse non reconnue n'installent
    // rien) : n'émettre `load` qu'à la toute fin de cette fonction, si et seulement si c'est vrai.
    _swapped = false;
    _restoreBusy();
    if (stale) {
      // rien à afficher : une navigation plus récente a déjà gagné le DOM/l'URL.
    } else if (html && typeof html === 'object') {
      // chemin JSON du protocole de navigation (X-MJS-Nav, cf.
      // µ._mjs_navRequest). MIROIR du PRG HTML plus bas (méthode mutante +
      // `finalUrl` distinct de l'URL soumise ⇒ pushState) — auto-contenu
      // (`return` en fin de branche) : le PRG partagé de fin de fonction
      // (chemin HTML) ne doit pas repousser une 2e fois l'historique.
      try { absUrl = new URL(url, window.location.href).href; } catch { absUrl = url; }
      shouldPush = (method !== 'GET' && method !== 'HEAD') && !!finalUrl && finalUrl !== absUrl;
      // _restoreNav() AVANT µ._mjs_navApplyJson (qui émet mjs:load) : sans ce déplacement, un
      // écouteur mjs:load lisait µ.nav.active===true ICI alors qu'il vaut déjà false sur les branches
      // clic/popstate pour ce même événement — incohérence d'état corrigée, reste de l'ordre inchangé
      // (purge des caches, PRG/_mjs_lastUjsPath toujours APRÈS, comme avant).
      _restoreNav();
      // `el: opts.el` : plomberie de l'élément d'origine (posé par les 2 call-sites de
      // µ._mjs_navDispatch, cf. son bandeau), lu ici par closure et retransmis pour que µ._mjs_navFlash/
      // µ._mjs_navRunCallback (dans µ._mjs_navApplyJson) le voient sur CE chemin (mjs-method/submit → JSON).
      // `µ._mjs_lastUjsPath` déplacé en `onSwapped`
      // (même raisonnement que les 2 sites jumeaux popstate/clic, cf. leurs bandeaux) : posé
      // SYNCHRONE juste après cet appel (avant), il pouvait pointer la destination alors que
      // le swap réel (transition différée par µ._mjs_vtWrapSwap, DANS µ._mjs_navApplyJson) n'avait pas
      // encore eu lieu — une 2e navigation démarrée dans ce délai hibernait le DOM encore affiché
      // sous CETTE clé (pageCache empoisonné).
      var _onJsonSwapped = function() {
        if (shouldPush) {
          try { var _ju = new URL(finalUrl, window.location.href); µ._mjs_lastUjsPath = _ju.pathname + _ju.search; } catch {}
        } else if ((method === 'GET' || method === 'HEAD') && getUrl) {
          try { var _gu = new URL(getUrl, window.location.href); µ._mjs_lastUjsPath = _gu.pathname + _gu.search; } catch {}
          // action qui porte une ancre (`action="#resultats"`) : la page reçue y va, comme en HTML
          if (typeof µ._mjs_anchorArrive === 'function') { µ._mjs_anchorArrive(); }
        }
      };
      // formulaire GET : le fragment de l'action suit la réponse, que `response.url` ne porte jamais (redirection
      // comprise, comme avec le navigateur seul)
      var _jsonDest = finalUrl, _getHash = ((method === 'GET' || method === 'HEAD') && getUrl && getUrl.indexOf('#') !== -1) ? getUrl.slice(getUrl.indexOf('#')) : '';
      if (_getHash && typeof finalUrl === 'string' && finalUrl.indexOf('#') === -1) { _jsonDest = finalUrl + _getHash; }
      µ._mjs_navApplyJson(html, _jsonDest, { push: shouldPush, via: via, el: opts.el, seq: seq, onSwapped: _onJsonSwapped });
      _purgeCaches();
      return;
    } else if (µ._mjs_navReloadAsked(nav && nav.reload)) {
      // X-MJS-Reload (chemin HTML/texte) : AVANT tout parse — la page s'en va, le corps de la
      // réponse est sans importance. Branche à part (pas nichée dans le test `html.includes('<html')`
      // plus bas) : un back qui répond `reload` peut légitimement renvoyer un corps qui n'est PAS une
      // page HTML complète (200 vide, JSON minimal).
      // RÈGLE UNIQUE, même ordre sur les 4 chemins (JSON/
      // HTML clic/popstate/submit) : reload EXPLICITE > version PÉRIMÉE > method:'none' > swap normal.
      // Un ordre demandé par le serveur prime sur tout, y compris une version déjà différente.
      _restoreNav();
      µ._mjs_navHardReload(finalUrl || url);
      return;
    } else if (nav && nav.version && µ.version && nav.version !== µ.version) {
      // HISSÉE hors de la branche `html.includes('<html')` :
      // nichée là, elle restait INATTEIGNABLE dès que `µ._mjs_navMethodOf(nav.method) === 'none'` répondait
      // avant elle sur CE chemin (soumission/@method) — même bundle périmé, un CLIC rechargeait (popstate
      // et clic testent la version AVANT 'none'), une SOUMISSION ne faisait RIEN. Même garde que le
      // chemin JSON (json.version) et que popstate/clic (ordre désormais IDENTIQUE sur les 4 chemins) :
      // bundle client changé depuis le chargement de cette page ⇒ rechargement complet plutôt qu'un swap
      // avec l'ancien JS. `finalUrl || url` : MÊME destination qu'avant ce déplacement, inchangée.
      window.location.assign(finalUrl || url);
      return;
    } else if (µ._mjs_navMethodOf(nav && nav.method) === 'none') {
      // X-MJS-Method: none (chemin HTML/texte) : le back répond « ne bouge pas » — corps ignoré
      // AVANT tout parse ET avant l'avertissement « réponse non reconnue » plus bas (un back peut
      // répondre un 200 vide sans être grondé). µ._mjs_navDropHibernation annule l'hibernation posée avant
      // la réponse pour CETTE navigation (les nœuds affichés restent affichés, pas hibernés pour rien).
      _restoreNav();
      µ._mjs_navDropHibernation();
      _undoGet(); // formulaire GET : l'adresse poussée au geste revient sur la page affichée
      return;
    } else if (html && typeof html === 'string' && html.includes('<html')) {
      // l'échange (µ._mjs_navSwapPage, commun avec la visite d'une page) : `target`/`method`/`cache` de la réponse, ses deux
      // contenants résolus ensemble au moment de la réponse, puis l'échange sous la transition de vue (config seule : pas de
      // lien déclencheur pour un envoi). MÊME motif que les autres échanges : µ._mjs_vtWrapSwap peut DIFFÉRER l'échange — la
      // queue (`_endSubmit` : _restoreNav, purge, PRG, mjs:load) se rappelle en DERNIÈRE ligne de l'échange (`after`) ; sans
      // transition de vue, l'ordre observable reste le même. `return` juste après : sans lui, la queue partagée des branches
      // SANS échange (plus bas dans `done`) jouerait une SECONDE fois. `_swapped` posé dès les deux contenants trouvés
      var _endSubmit = function() {
        if (!stale) { _restoreNav(); }
        _purgeCaches(); // mutation : caches vidés (cf. `_purgeCaches`)
        // PRG (Post/Redirect/Get) cassé :
        // `fetch` suit les redirections NATIVEMENT ; `finalUrl` (= `response.url`,
        // cf. mjs_ajax.ts) reflète la destination RÉELLE après tout redirect
        // serveur. Sans mise à jour de l'URL affichée, un submit POST/PUT/PATCH/
        // DELETE qui redirige laissait la barre d'adresse bloquée sur l'endpoint
        // de MUTATION d'origine (ex. `/posts` pour un POST qui crée et redirige
        // vers `/posts/42`) — un F5 RE-SOUMETTRAIT alors le formulaire (boîte
        // navigateur "confirmer la resoumission"), exactement ce que PRG existe
        // pour éviter. Exclut GET/HEAD : leur URL EST déjà la requête elle-même
        // (query comprise) — un autre sujet.
        // `!stale` (cf. plus haut) : une navigation plus récente a
        // déjà posé la BONNE URL — ne pas l'écraser avec celle, périmée, de CE submit.
        // `url` est la valeur BRUTE de
        // l'attribut action (souvent RELATIVE : `/posts`), `finalUrl` (response.url)
        // toujours ABSOLUE : `finalUrl !== url` était vrai à CHAQUE submit non-GET à
        // action relative même SANS redirection → pushState PARASITE vers l'endpoint
        // de mutation (barre sur la ressource supprimée après un DELETE, entrée
        // d'historique en trop, `_mjs_lastUjsPath` pollué). On normalise `url` en absolu
        // avant de comparer.
        var _absUrl;
        try { _absUrl = new URL(url, window.location.href).href; } catch { _absUrl = url; }
        if (!stale && method !== 'GET' && method !== 'HEAD' && finalUrl && finalUrl !== _absUrl) {
          try {
            window.history.pushState({}, '', finalUrl);
            var _u = new URL(finalUrl, window.location.href);
            µ._mjs_lastUjsPath = _u.pathname + _u.search;
          } catch {}
        }
        // mjs:load émis ICI, à la toute fin de `_endSubmit` (elle-même appelée en toute fin
        // de l'échange, `after`, cf. bandeau ci-dessus) : APRÈS le bloc PRG ci-dessus (un POST/PUT/
        // PATCH/DELETE qui redirige ne pousse `finalUrl` qu'à cet instant) et APRÈS _restoreNav()
        // (plus haut) — µ.nav.active est retombé quand l'écouteur tourne, comme sur clic/popstate.
        // `_swapped` : garde posée par la SEULE branche qui installe un contenu sur ce chemin
        // (toujours vraie ici — conservée telle quelle, défensive, cf. bandeau ci-dessus).
        if (_swapped) {
          loadPaths = µ._mjs_navEmitPaths(finalUrl || getUrl || url);
          µ._mjs_navEmit('load', { path: loadPaths.path, url: loadPaths.url, via: via, zone: _installedZone, initial: false }, false);
        }
      };
      if (µ._mjs_navSwapPage(html, nav, seq, null, { parser: DOMParser, ready: function() { _swapped = true; }, after: function(nodes, installed) {
        // le contenant EFFECTIF après installation (détaché en method:'replace', cf. µ._mjs_navInstallNodes)
        _installedZone = installed;
        if (typeof µ._mjs_focusAfterSwap === 'function') { µ._mjs_focusAfterSwap(µ._mjs_navFirstEl(nodes), nodes); }
        // navigation GET/HEAD réellement effectuée : l'URL (poussée AU GESTE, cf. branche GET plus bas) devient la page
        // AFFICHÉE → `_mjs_lastUjsPath` DOIT la refléter, sinon le prochain clic archive les résultats sous la clé de la page
        // d'AVANT le submit (pageCache empoisonné) ; il ne bouge qu'à l'échange RÉEL. `mjs:load` part en fin de `_endSubmit`,
        // après le bloc PRG (un POST/PUT/PATCH/DELETE qui redirige ne pousse `finalUrl` qu'alors)
        if ((method === 'GET' || method === 'HEAD') && getUrl) {
          try { var _gu = new URL(getUrl, window.location.href); µ._mjs_lastUjsPath = _gu.pathname + _gu.search; } catch {}
          // action qui porte une ancre (`action="#resultats"`) : la page reçue y va, comme celle d'un lien
          if (typeof µ._mjs_anchorArrive === 'function') { µ._mjs_anchorArrive(); }
        }
        _endSubmit();
      } })) {
        return;
      }
      // HTML complet reçu mais aucun <body> exploitable (page courante ou réponse serveur mal formée) : sans ce warn, le
      // submit "réussissait" en silence sans rien afficher de nouveau — aucune trace pour comprendre pourquoi.
      µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsSubmitNoBody', null, 'Réponse HTML du submit reçue, mais aucun <body> exploitable (page courante ou réponse serveur) — aucun contenu mis à jour.'));
    } else if (html != null) {
      // réponse non-HTML (JSON, texte,
      // fragment sans <html) silencieusement ignorée : aucun swap, aucune
      // trace. Un submit qui semble n'avoir "rien fait" est un des pièges de
      // debug les plus frustrants — un warn coûte rien et pointe direct la
      // cause (serveur mal configuré pour ce endpoint, ou usage volontaire
      // d'un endpoint JSON qui devrait alors porter @noUJS).
      µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsSubmitNotHtml', null, 'Réponse du submit non reconnue comme une page HTML complète (attendu : une chaîne contenant "<html") — aucun contenu mis à jour. Pour gérer vous-même une réponse non-HTML, posez :noUJS sur le <form>.'));
    }
    // ici, rien n'a été installé (204, réponse non reconnue, page sans <body>)
    if (!stale) { _restoreNav(); _undoGet(); }
    _purgeCaches(); // mutation : caches vidés (cf. `_purgeCaches`)
    // PRG (Post/Redirect/Get) cassé :
    // `fetch` suit les redirections NATIVEMENT ; `finalUrl` (= `response.url`,
    // cf. mjs_ajax.ts) reflète la destination RÉELLE après tout redirect
    // serveur. Sans mise à jour de l'URL affichée, un submit POST/PUT/PATCH/
    // DELETE qui redirige laissait la barre d'adresse bloquée sur l'endpoint
    // de MUTATION d'origine (ex. `/posts` pour un POST qui crée et redirige
    // vers `/posts/42`) — un F5 RE-SOUMETTRAIT alors le formulaire (boîte
    // navigateur "confirmer la resoumission"), exactement ce que PRG existe
    // pour éviter. Exclut GET/HEAD : leur URL EST déjà la requête elle-même
    // (query comprise) — un autre sujet.
    // `!stale` (cf. plus haut) : une navigation plus récente a
    // déjà posé la BONNE URL — ne pas l'écraser avec celle, périmée, de CE submit.
    // `url` est la valeur BRUTE de
    // l'attribut action (souvent RELATIVE : `/posts`), `finalUrl` (response.url)
    // toujours ABSOLUE : `finalUrl !== url` était vrai à CHAQUE submit non-GET à
    // action relative même SANS redirection → pushState PARASITE vers l'endpoint
    // de mutation (barre sur la ressource supprimée après un DELETE, entrée
    // d'historique en trop, `_mjs_lastUjsPath` pollué). On normalise `url` en absolu
    // avant de comparer.
    var _absUrl;
    try { _absUrl = new URL(url, window.location.href).href; } catch { _absUrl = url; }
    if (!stale && method !== 'GET' && method !== 'HEAD' && finalUrl && finalUrl !== _absUrl) {
      try {
        window.history.pushState({}, '', finalUrl);
        var _u = new URL(finalUrl, window.location.href);
        µ._mjs_lastUjsPath = _u.pathname + _u.search;
      } catch {}
    }
    // mjs:load émis ICI, à la toute fin de `done` : APRÈS le bloc PRG ci-dessus (un POST/PUT/
    // PATCH/DELETE qui redirige ne pousse `finalUrl` qu'à cet instant) et APRÈS _restoreNav() (plus
    // haut, avant ce bloc) — µ.nav.active est retombé quand l'écouteur tourne, comme sur clic/popstate.
    // `_swapped` : garde posée par la SEULE branche qui installe un contenu sur ce chemin.
    if (_swapped) {
      loadPaths = µ._mjs_navEmitPaths(finalUrl || getUrl || url);
      µ._mjs_navEmit('load', { path: loadPaths.path, url: loadPaths.url, via: via, zone: _installedZone, initial: false }, false);
    }
  };
  // callback d'ERREUR du submit :
  // avant, aucun n'était passé → toute réponse non-2xx (dont le 422 de validation
  // qui renvoie le formulaire ré-affiché avec ses erreurs, convention Rails/Turbo)
  // était convertie en Error par mjs_ajax, son corps JETÉ, et le submit
  // "réussissait" en silence sans rien afficher. On ré-affiche le corps HTML d'un
  // 4xx via `done` (qui gère aussi l'invalidation de cache) ; sinon on invalide
  // par sécurité (la mutation a pu partir) et on trace.
  var fail = function(err) {
    var st;
    err = err || {};
    st = err.status;
    // l'envoi a abouti, puis le serveur a renvoyé vers une autre origine (paiement, connexion par un tiers) : le navigateur y va,
    // comme sans MJS — jamais sa page dans celle du site (µ._mjs_navRequest)
    if (err.foreign) {
      _restoreBusy();
      _purgeCaches();
      // formulaire GET : l'adresse poussée au geste repart par le navigateur, qui suit lui-même la redirection et met l'arrivée à sa
      // place dans l'historique (`Précédent` ramène à la page du site, comme sans MJS) ; un autre envoi va à l'adresse d'arrivée
      if (seq === µ._mjs_navSeq) { _restoreNav(); µ._mjs_navLeft = null; µ._mjs_hardNav((method === 'GET' || method === 'HEAD') && getUrl ? getUrl : err.url); }
      return;
    }
    if (typeof err.body === 'string' && st >= 400 && st < 500 && err.body.indexOf('<html') !== -1) {
      // `err.nav` transmis comme sur le chemin de succès (mjs_ajax attache l'objet
      // `{version,target,method}` à l'erreur) : une page d'erreur HTML complète servie par un build
      // PLUS RÉCENT doit déclencher le rechargement, pas un swap avec l'ancien JS — target/method
      // profitent pareil d'un éventuel repli HTML porté par l'erreur (même chemin que le succès).
      return done(err.body, err.url, void 0, err.nav);
    }
    // 422 JSON (protocole de navigation, docs/21-navigation.md
    // « Formulaires ») : le corps suit la forme EXACTE du serveur ({module,
    // props, url, title:null, version}, `errors` ajouté DANS `props`) — on
    // pose SEULEMENT les props (le composant en place re-rend par
    // réactivité, `µres.errors` par ex.) : PAS de remontage, PAS d'historique
    // — contrairement au cas nominal de µ._mjs_navApplyJson, jamais appelé ici.
    //
    // FUSION (µ._mjs_resMerge), plus jamais µ._mjs_resSet.
    // Le critère du sac est « une NOUVELLE page arrive-t-elle ? » : oui →
    // remplacement intégral (les props de la page quittée s'en vont avec elle) ;
    // non → fusion. Un 422 est le cas « non » par excellence — la page affichée
    // ne bouge pas, seul le formulaire est refusé. En remplacement, un back qui
    // répond juste `props: { errors: … }` (ce que fait n'importe quel Rails
    // idiomatique : re-rendre le formulaire fautif, pas l'état complet de la
    // page) EFFAÇAIT tout le reste du sac — panier, compteurs, badges, pagination
    // en cours — sur une simple faute de saisie. `mjs serve` masquait le défaut
    // en renvoyant systématiquement le sac entier ; un back applicatif, non.
    // Même règle que `method:'none'` (µ._mjs_navApplyJson, plus haut) : les clés
    // tues survivent, EFFACER une clé demande de l'envoyer explicitement à
    // `null`. Garde `typeof` conservée à l'identique (µ._mjs_resMerge vit dans
    // mjs_store_globals.ts, module toujours présent mais lu défensivement ici).
    if (err.body && typeof err.body === 'object' && st === 422) {
      _restoreBusy();
      // formulaire GET refusé : la page affichée reste, l'adresse poussée au geste revient sur elle (`_undoGet`)
      if (seq === µ._mjs_navSeq) { _restoreNav(); _undoGet(); }
      _purgeCaches();
      // veilleur flash/error : CONSOMME props.flash/props.error AVANT µ._mjs_resMerge (jamais
      // props.errors, pluriel — laissé intact pour le composant). `opts.el` lu par CLOSURE (posé par
      // les 2 call-sites de µ._mjs_navDispatch, cf. son bandeau) — jamais de callback ici (@callback = succès
      // seulement, un 422 est un refus).
      if (typeof µ._mjs_navFlash === 'function') { µ._mjs_navFlash(err.body.props || {}, opts.el); }
      // l'objet formulaire (mjs_form.ts), s'il est là : ces erreurs répondent au formulaire de cet envoi, et à lui seul (son départ, il
      // le lit sur `mjs:visit`)
      µ._mjs_formTell?.(opts, err.body);
      if (typeof µ._mjs_resMerge === 'function') { µ._mjs_resMerge(err.body.props || {}); }
      return;
    }
    _restoreBusy();
    // échec (panne réseau, erreur sans page HTML) d'un formulaire GET : rien n'a été installé, même retour de
    // l'adresse et de la photo de la page affichée qu'une réponse « ne bouge pas » ou 204
    if (seq === µ._mjs_navSeq) { _restoreNav(); _undoGet(); }
    _purgeCaches();
    µ.warn('[µ.UJS] ' + µ._mjs_txt('ujsSubmitFailed', { status: (st || '?') }, 'Submit en échec (statut {status}) — aucune page de repli HTML complète dans la réponse.'));
    // échec TRANSPORT (ni 422, ni page d'erreur HTML complète, ni réponse reconnue) :
    // affichage utilisateur EN PLUS du warn console ci-dessus, par le même canal que le veilleur
    // (respecte @flash/mjs-flash et µ.config.flash — silent/console/false s'appliquent tel quel).
    // µ._mjs_label('ujs', 'sendFailed') choisit la langue AFFICHÉE, repli littéral
    // fr codé en dur si absent (µ._mjs_label indisponible ou clé manquante, vieux manifest).
    if (typeof µ._mjs_navFlashShow === 'function' && typeof µ._mjs_navFlashPolicy === 'function') {
      µ._mjs_navFlashShow('error', ((typeof µ._mjs_label === 'function' && µ._mjs_label('ujs', 'sendFailed')) || 'Échec de l\'envoi — le serveur n\'a pas répondu.') + (st ? ' (' + st + ')' : ''), µ._mjs_navFlashPolicy(opts.el));
    }
  };
  // la réussite ou l'échec de l'envoi, dit au formulaire (ou au lien @method) : les effets `on: success` /
  // `on: error` de ses balises l'écoutent (µ._mjs_fxOnResult, mjs_fx.ts). Dit à la réponse, avant son
  // affichage (qui peut remplacer le formulaire) ; une page d'erreur réaffichée par `fail` reste un échec
  var _tell = function(ok, data) {
    if (typeof µ._mjs_fxTell === 'function') { µ._mjs_fxTell(opts.form || opts.el, ok, data); }
  };
  var _done = function(html, finalUrl, schemaKey, nav) {
    _answered = true;
    _tell(true, html);
    return done(html, finalUrl, schemaKey, nav);
  };
  var _fail = function(err) {
    _answered = true;
    // renvoyé vers une autre origine : l'envoi, lui, a réussi
    _tell(!!(err && err.foreign), err);
    return fail(err);
  };
  // FIX CRITIQUE : `µ.ajax.get`/`delete` ont la signature (url, success,
  // error, always) — SANS paramètre data. L'ancien appel uniforme
  // `ajaxFunction(url, payload, done)` passait le FormData en `success` :
  // un formulaire GET partait SANS ses champs et son callback atterrissait
  // en `error` → recherche/filtre/pagination par formulaire silencieusement
  // morts. On sérialise les champs en query string pour GET, et DELETE part
  // sans corps (REST : l'identifiant voyage dans l'URL ; exception plus bas : formulaire à champ `_method`).
  if (method === 'GET' || method === 'HEAD') {
    // qs/getUrl calculés en TÊTE de fonction désormais (before-visit/visit en ont besoin
    // avant même de savoir si cette navigation aura lieu) — cf. le bloc juste après `opts = opts || {}`.
    // un form GET est une VRAIE
    // navigation : on pousse l'URL AU GESTE (même politique « l'URL reflète
    // l'intention » que le clic) pour que la recherche/le filtre soit
    // bookmarkable (F5 conserve), partageable, et que le Précédent en sorte —
    // avant, la barre restait figée sur l'URL d'avant la recherche, et au prochain
    // clic le DOM des résultats s'archivait sous la clé de la page d'AVANT
    // (pageCache empoisonné). On hiberne la page quittée comme le clic (Précédent
    // post-recherche resservi sans re-fetch). `_mjs_lastUjsPath` ne bouge qu'au swap
    // RÉEL (cf. `done`).
    var _curMz = µ._mjs_navMountZone(document, null);
    var _curRoot = _curMz.zone;
    var _curPath = µ._mjs_lastUjsPath;
    var _getFromUrl = window.location.pathname + window.location.search + window.location.hash; // pour `_undoGet`
    try { window.history.pushState({}, '', getUrl); } catch {}
    // le contenu du contenant est hiberné, contenant compris quand c'est <body>
    // (avant : <body> en était exclu du pageCache). Simple PHOTOGRAPHIE (lecture de
    // childNodes, aucun retrait) : le retrait RÉEL des nœuds n'a lieu qu'au prochain
    // µ._mjs_zoneFill (cf. commentaire du même motif au popstate).
    µ._mjs_navHibernate(µ._mjs_navCacheZone(), _curPath);
    // `fail` et pas `void 0` : sans callback d'échec, un GET de formulaire (recherche, filtre)
    // qui tombe en panne réseau ne repassait JAMAIS par `_restoreNav` — µ.nav.active restait à `true`
    // à vie, et depuis, la barre de progression restait à l'écran. `fail` garde déjà les verbes
    // non mutants hors de la purge de cache, il est sûr sur ce chemin.
    // `_restoreBusy` en `always` (aux trois requêtes de cette fonction, par `_always` pour les deux qui modifient le
    // serveur) : une requête abandonnée par une navigation plus récente ne passe ni par `done` ni par `fail` (chemin
    // muet de `_request`) ; sans lui, le lien @method restait `aria-disabled` à vie et les boutons du formulaire grisés.
    // Idempotent.
    // Jamais `_restoreNav` ici : µ.nav appartient à la navigation gagnante
    return µ._mjs_navRequest('GET', getUrl, void 0, _done, _fail, _restoreBusy, void 0, navSignal);
  }
  // DELETE part sans corps (l'identifiant voyage dans l'adresse) — sauf un formulaire (verbe venu d'un
  // champ `_method` ou de son attribut `method="delete"`) qui porte d'autres champs (paramètres, jeton
  // `authenticity_token` du formulaire, motif saisi) : le formulaire natif les envoyait, ils partent dans
  // le corps, préparé comme celui de POST/PUT/PATCH plus bas. Un lien @method n'a que `_method` : toujours sans corps.
  var _deleteBody = false;
  if (method === 'DELETE' && payload && typeof payload.forEach === 'function') {
    payload.forEach(function(_v, k) { if (k !== '_method') { _deleteBody = true; } });
  }
  if (method === 'DELETE' && !_deleteBody) {
    return µ._mjs_navRequest('DELETE', url, void 0, _done, _fail, _always, void 0, navSignal);
  }
  // Verbes supportés à ce point (GET/HEAD/DELETE sans corps déjà traités ci-dessus) :
  // POST/PUT/PATCH et DELETE avec corps — µ._mjs_navRequest parle directement à _request
  // (pas de dispatch via µ.ajax[method], canal PUBLIC désormais court-circuité
  // par le canal interne) : la validation du verbe reste donc EXPLICITE ici.
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
    µ.error(`[µ.UJS] Unsupported HTTP verb: ${method}`);
    _restoreBusy();
    if (seq === µ._mjs_navSeq) { _restoreNav(); _undoGet(); }
    return;
  }
  // un formulaire qui déclare multipart/form-data (`enctype`, ou `formenctype`
  // du bouton : `opts.multipart`) part dans ce format, fichier joint ou non,
  // comme avec le navigateur seul ; un autre part en
  // application/x-www-form-urlencoded, son format, sauf quand un vrai fichier
  // est joint : il garde alors son FormData multipart, pour que le fichier
  // parte. « Fichier réellement joint » = valeur `instanceof File` avec un nom
  // ou un poids — un `<input type=file>` laissé vide vaut `File{name:'',
  // size:0}`, PAS un fichier joint. Garde `typeof File !== 'undefined'` :
  // harnais de tests sans constructeur File.
  var _hasRealFile = false;
  if (typeof payload.forEach === 'function' && typeof File !== 'undefined') {
    payload.forEach(function(v) {
      if (v instanceof File && (v.name !== '' || v.size > 0)) { _hasRealFile = true; }
    });
  }
  if (!_hasRealFile && !opts.multipart && typeof payload.forEach === 'function') {
    // aucun fichier joint : reconstruction en URLSearchParams (ordre
    // préservé), fichier VIDE omis — sinon il se sérialiserait en
    // "[object File]" au lieu de disparaître proprement.
    var _params = new URLSearchParams();
    payload.forEach(function(v, k) {
      if (typeof File !== 'undefined' && v instanceof File) { return; }
      _params.append(k, v);
    });
    payload = _params;
  }
  // (method, url, data, success, error, always, timeout, signal) — même canal
  // interne que GET/DELETE ci-dessus (µ._mjs_navRequest, pose X-MJS-Nav).
  return µ._mjs_navRequest(method, url, payload, _done, _fail, _always, void 0, navSignal);
};
// <<< extrait-test _mjs_navDispatch

// ════════════════════════════════════════════════════════════════════════════
// PRÉCHARGEMENT DES LIENS (µ.preload). Trois niveaux, priorité décroissante :
//   3. attribut `@preload` sur le <a>       → data-mjs-preload  (ce lien)
//   2. directive `@preload` racine de module → host._mjs_preload (tous ses liens)
//   1. config `µ.preload` { view, page }     (défaut global, émis au manifeste)
// Modes : off | hover | on (« eager » toléré en alias : dès l'apparition).
//   - Lien VUE (`#/…`)  → précharge le MODULE de la route (µ.Autoloader.load),
//     quasi gratuit ; cible résolue par µ.Router._mjs_resolveModules (sans injecter).
//   - Lien PAGE (autre page serveur) → fetch du HTML mis en cache → clic instantané.
// ════════════════════════════════════════════════════════════════════════════
µ._mjs_preloaded = new Set();      // clés déjà préchargées (anti-doublon)
// Map SANS BORNE : une session SPA
// longue durée qui survole/eager-précharge de nombreux liens distincts (menu
// de navigation, listing paginé avec IDs dynamiques) accumulait une entrée
// par URL préchargée, POUR TOUJOURS — même dérive mémoire non bornée que
// pageCache avant son passage en LRU (cf. commentaire ligne 5). Borne plus
// large que pageCache (30 vs 10) : ces entrées sont plus légères (texte HTML
// brut, pas un arbre DOM+composants+listeners) et souvent SPÉCULATIVES
// (survol sans clic derrière) — les évincer trop tôt perdrait le bénéfice
// pour un menu qui liste plus de 10 liens. Pas d'onEvict nécessaire (aucun
// teardown : juste du texte, contrairement aux arbres hibernés de pageCache).
// >>> extrait-test _mjs_preloadCache-init
µ._mjs_preloadCache = typeof µ.LRUCache === 'function' ? new µ.LRUCache(30) : new Map();
// <<< extrait-test _mjs_preloadCache-init

// `µ._mjs_preloaded` (Set anti-doublon)
// désynchronisé du LRU `_mjs_preloadCache` : après éviction d'une URL, sa clé RESTAIT
// dans le Set → un nouveau survol était ignoré (`has(key)`) alors que le cache
// était vide → l'URL n'était plus JAMAIS repréchargeable (dégradation silencieuse
// du préchargement au fil de la session). onEvict resynchronise (clé page =
// 'page:' + href, cf. `_mjs_preloadLink`). La Map de repli n'appelle jamais onEvict
// (non bornée) — sans effet, inoffensif.
µ._mjs_preloadCache.onEvict = function(url) { µ._mjs_preloaded.delete('page:' + url); };

// `on` est le nom CANONIQUE (`eager` disparaît de
// mjs.config.json, VALID_PRELOAD_MODES = off/hover/on) ; `eager` reste un alias
// TOLÉRÉ ici, jamais une erreur : un attribut déjà compilé (`data-mjs-preload`,
// le compilateur accepte encore les deux orthographes pour `@preload`) ou un
// `µ.preload` forgé à la main peut porter l'ancien mot, et cette fonction tourne
// à CHAQUE survol/scan — y lever casserait la navigation en silence pour un
// réglage qu'aucune étape de build n'a jamais signalé comme fautif.
// >>> extrait-test _mjs_normPreload
µ._mjs_normPreload = function(m) { return m === 'eager' ? 'on' : m; };
// <<< extrait-test _mjs_normPreload

// Fetch de page conscient du cache de préchargement : sert le HTML déjà préchargé
// s'il existe (clic instantané), sinon délègue à µ.ajax.get. Utilisé par la nav.
// `signal` (AbortController d'une navigation, cf. `_mjs_abortStaleNav`) : PAS
// concerné par la branche préchargée ci-dessous (déjà résolue, rien à
// abandonner) — uniquement transmis au fetch réseau de repli.
// >>> extrait-test _mjs_ajaxGet
µ._mjs_ajaxGet = function(url, cb, errCb, signal) {
  var entry;
  // HTML préchargé servi une seule fois (retiré à l'usage avec sa clé anti-doublon : le survol suivant précharge de
  // nouveau), et seulement s'il a été reçu il y a moins de 10 s : passé ce délai la page a pu changer, le clic la
  // redemande au serveur
  if (µ._mjs_preloadCache.has(url)) {
    entry = µ._mjs_preloadCache.get(url);
    µ._mjs_preloadCache.delete(url);
    µ._mjs_preloaded.delete('page:' + url);
  }
  if (entry !== void 0 && !(entry && entry.t && Date.now() - entry.t > 10000)) {
    // le HTML préchargé mémorise
    // AUSSI sa destination finale (`response.url`) : un lien redirigé au
    // préchargement (survol) doit pouvoir être réconcilié au clic exactement
    // comme un fetch direct. Rétrocompatible avec une entrée « chaîne brute ».
    // `nav` (en-têtes de navigation X-MJS-*) mémorisé
    // lui aussi par `_mjs_preloadLink` désormais, ressorti ici en 4e argument — comme le fetch réseau
    // direct plus bas (`_mjs_navRequest` → succès à 4 arguments, cf. `_request` dans mjs_ajax.ts).
    // Sans ça, une page préchargée ignorait `version`/`reload`/`target`/`method`/`cache` du
    // serveur : la garde « bundle périmé » ne jouait pas dessus. Entrée « chaîne brute » (ancienne,
    // ou posée à la main) : `nav` retombe à `void 0`, toléré tel quel par les appelants. 5e argument
    // `true` : réponse préchargée, dont le jeton CSRF d'en-tête n'est pris que si la page s'affiche (µ._mjs_navCsrfHeader)
    var html = (entry && typeof entry === 'object') ? entry.html : entry;
    var finalUrl = (entry && typeof entry === 'object') ? entry.url : void 0;
    var nav = (entry && typeof entry === 'object') ? entry.nav : void 0;
    return Promise.resolve().then(function() { return cb(html, finalUrl, void 0, nav, true); });
  }
  // canal interne (µ._mjs_navRequest, pose X-MJS-Nav) au lieu de µ.ajax.get
  // direct : cette fonction ne sert QU'à la navigation ujs (cf. son commentaire
  // d'en-tête), jamais à un appel applicatif.
  if (typeof µ._mjs_ajaxRequest === 'function') { return µ._mjs_navRequest('GET', url, void 0, cb, errCb, void 0, void 0, signal); }
  return typeof errCb === 'function' ? errCb() : void 0;
};
// <<< extrait-test _mjs_ajaxGet

// Candidat au préchargement ? (mêmes garde-fous que le handler de clic.)
// >>> extrait-test _mjs_isPreloadableLink
µ._mjs_isPreloadableLink = function(link) {
  return !!link && link.tagName === 'A' && !µ._mjs_navNoUjs(link)
    && link.origin === window.location.origin
    && (!link.target || link.target === '_self')
    && !link.hasAttribute('download')
    && link.protocol !== 'javascript:' && link.protocol !== 'mailto:'
    // @method="delete/post/put/patch" : jamais préchargeable (fetch GET gaspillé — et sur un
    // serveur pas strictement REST, potentiellement DÉCLENCHÉ — au survol d'une route de mutation ;
    // le clic réel passe par µ._mjs_navDispatch, jamais ce cache). "get" explicite reste préchargeable :
    // même verbe que le préchargement lui-même.
    && (!link.hasAttribute('mjs-method') || link.getAttribute('mjs-method').toUpperCase() === 'GET');
};
// <<< extrait-test _mjs_isPreloadableLink

// Mode effectif d'un lien pour son type : attribut (3) > module hôte (2) > config (1).
// asymétrie de vocabulaire :
// `_mjs_normPreload` ('on' ≡ 'eager') était appliqué aux niveaux 3 et 2 (attribut,
// directive module) mais PAS au niveau 1 (config `µ.preload`, ligne juste en
// dessous) — `mjs.config.json` REJETTE déjà 'on' à la validation (bundler/
// config.ts, VALID_PRELOAD_MODES), donc inatteignable par ce chemin normal ;
// mais `µ.preload` reste un objet JS ORDINAIRE, réassignable à la main par du
// code applicatif (`µ.preload = { view: 'on' }`, contournant le validateur
// du bundler) — un tel réglage restait 'on' TEL QUEL jusqu'ici, ne matchant
// alors NI 'off' NI 'hover' NI 'eager' dans `_mjs_preloadLink` → précisément
// « µ.preload forgé à la main avec 'on' » : totalement INERTE, silencieusement.
// Fix : même normalisation appliquée aux 3 niveaux, sans exception.
// les MOTS ont basculé : `on` est
// désormais le nom canonique dans `mjs.config.json` (VALID_PRELOAD_MODES =
// off/hover/on), `eager` l'alias TOLÉRÉ. Le même risque d'asymétrie existerait
// si `eager` forgé à la main dans `µ.preload` n'était normalisé qu'à certains
// niveaux — ce n'est pas le cas, `_mjs_normPreload` tourne aux 3 niveaux ici aussi.
// >>> extrait-test _mjs_effectivePreload
µ._mjs_effectivePreload = function(link, type) {
  const attr = link.getAttribute('data-mjs-preload');
  if (attr) { return µ._mjs_normPreload(attr); }
  const root = link.getRootNode ? link.getRootNode() : null;
  const host = root && root.host;
  if (host && host._mjs_preload) { return µ._mjs_normPreload(host._mjs_preload); }
  return µ._mjs_normPreload((µ.preload && µ.preload[type]) || 'off');
};
// <<< extrait-test _mjs_effectivePreload

// Précharge un lien si son mode effectif l'autorise pour ce déclencheur.
// >>> extrait-test _mjs_preloadLink
µ._mjs_preloadLink = function(link, trigger) {
  if (!µ._mjs_isPreloadableLink(link)) { return; }
  const samePage = link.pathname === window.location.pathname && link.search === window.location.search;
  const isView   = samePage && !!link.hash && link.hash.indexOf('#/') === 0;
  // ancre de la page affichée, ou lien vers elle : la navigation ne la redemande jamais au serveur, rien à précharger
  if (samePage && !isView) { return; }
  const type = isView ? 'view' : 'page';
  const mode = µ._mjs_effectivePreload(link, type);
  if (mode === 'off') { return; }
  // hover déclenche sur 'hover' ET 'on' ; le scan d'apparition, sur 'on' seul.
  // (`trigger` distingue QUI appelle — survol ou scan d'apparition — vocabulaire
  // interne séparé de `mode`, jamais exposé en config/directive : il ne bouge pas.)
  if (trigger === 'hover' && mode !== 'hover' && mode !== 'on') { return; }
  if (trigger === 'eager' && mode !== 'on') { return; }
  const key = type + ':' + (isView ? link.hash : link.href);
  // entrée périmée (reçue il y a plus de 10 s, cf. µ._mjs_ajaxGet) : retirée avec sa clé, ce survol précharge de nouveau
  const old = !isView && µ._mjs_preloadCache.has(link.href) ? µ._mjs_preloadCache.get(link.href) : null;
  if (old && old.t && Date.now() - old.t > 10000) {
    µ._mjs_preloadCache.delete(link.href);
    µ._mjs_preloaded.delete(key);
  }
  if (µ._mjs_preloaded.has(key)) { return; }
  if (isView) {
    µ._mjs_preloaded.add(key);
    if (µ.Router && typeof µ.Router._mjs_resolveModules === 'function' && µ.Autoloader) {
      µ.Router._mjs_resolveModules(link.href).forEach(function(name) {
        µ.Autoloader.load('mjs-' + name);
      });
    }
  } else if (typeof µ._mjs_ajaxRequest === 'function') {
    // Canal INTERNE (µ._mjs_navRequest, pose X-MJS-Nav),
    // comme le fetch réseau direct de `_mjs_ajaxGet` — le HTML préchargé doit porter les MÊMES
    // en-têtes de navigation qu'un clic (parité) ; `nav` (version/reload/target/method/cache)
    // mémorisé avec l'entrée pour être ressorti au clic (cf. `_mjs_ajaxGet`). Avant, `µ.ajax.get`
    // (canal PUBLIC, sans `X-MJS-Nav`) laissait une page préchargée ignorer ces en-têtes — la garde
    // « bundle périmé » ne jouait pas dessus. Garde alignée sur celle de `µ._mjs_navRequest` (même
    // test) plutôt que sur `µ.ajax.get` ; `_mjs_preloaded.add` déplacé DANS cette branche (comme dans
    // la branche `isView` ci-dessus) : un module runtime 'ajax' absent ne doit pas bloquer
    // DÉFINITIVEMENT un essai futur (même raisonnement que le fix onEvict voisin).
    µ._mjs_preloaded.add(key);
    µ._mjs_navRequest('GET', link.href, void 0, function(html, finalUrl, _schemaKey, nav) {
      // no-cache : jamais archivée, même garde que µ._mjs_navHibernate — une page qui refuse
      // explicitement d'être mise en cache ne doit pas non plus être resservie SANS requête depuis
      // le préchargement au survol (jeton one-shot, CSRF frais…). Les TROIS canaux de la politique
      // (docs/21-navigation.md) : en-tête X-MJS-Cache, clé `cache` de la fiche (mode JSON, qu'un
      // préchargement reçoit d'un serveur qui parle le protocole) et <meta name="mjs-cache"> d'une
      // page HTML (lue seulement si la réponse la mentionne : pas de parse inutile).
      if (µ._mjs_navCachePolicyOf(nav && nav.cache) === 'no-cache') { return; }
      if (html && typeof html === 'object' && µ._mjs_navCachePolicyOf(html.cache) === 'no-cache') { return; }
      if (typeof html === 'string' && html.indexOf('mjs-cache') !== -1 && typeof DOMParser !== 'undefined' && µ._mjs_navCacheOf(new DOMParser().parseFromString(µ._mjs_th(html), 'text/html'), null) === 'no-cache') { return; }
      // On mémorise (html, url FINALE) : le clic pourra réconcilier une
      // redirection serveur même sur un lien servi depuis le cache de préchargement.
      µ._mjs_preloadCache.set(link.href, { html: html, url: finalUrl, nav: nav, t: Date.now() });
    }, function() {
      µ._mjs_preloaded.delete(key);   // échec réseau → autorise une nouvelle tentative
    });
  }
};
// <<< extrait-test _mjs_preloadLink

// Scanne un sous-arbre (document en light DOM, ou le shadow d'un composant) et
// précharge ses liens en mode 'eager'. mjs_element rappelle ça au montage (les
// liens MJS vivent en shadow, invisibles d'un querySelectorAll sur document).
// >>> extrait-test _mjs_scanEager
µ._mjs_scanEager = function(root) {
  if (!root || typeof root.querySelectorAll !== 'function') { return; }
  const links = root.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i++) { µ._mjs_preloadLink(links[i], 'eager'); }
};
// <<< extrait-test _mjs_scanEager

// Appelé à la construction de CHAQUE composant (les liens MJS vivent en shadow, fermé
// côté client → invisibles d'un scan sur document). Gate bon marché : on ne scanne
// que si le mode 'on' (préchargement dès l'apparition) est réellement en jeu
// (directive du module, config globale ou lien `:preload="on"` présent au premier rendu).
// bloc `<preload-on>` : la porte lue à l'image qui suit la construction, pour les liens `:preload="on"` écrits dans un bloc (`{if}`,
// `{for}`) ou dans le gabarit d'un composant léger, que le constructeur ne voit pas encore ; au cœur de production de la seule appli dont
// une unité écrit `:preload` (bundler/index.ts). Sans lui, les lignes `<no-preload-on>` reprennent leur texte : la porte lue à la
// construction, aucune liste, aucune opération de plus par composant
// >>> extrait-test _mjs_maybeScanEager
// <preload-on>
// composants construits depuis la dernière image, en attente de la lecture de leur porte
let _mjsEagerHosts = [];
const _mjsEagerFlush = function() {
  const hosts = _mjsEagerHosts;
  const cfg   = µ.preload || {};
  _mjsEagerHosts = [];
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    // Même normalisation 'eager'≡'on' que _mjs_effectivePreload (cf. son commentaire) —
    // cohérence si µ.preload ou host._mjs_preload portent encore l'ancien mot.
    // un lien `<a @preload="on">`
    // (priorité MAXIMALE, tuto 30-1 : « dès que le lien apparaît ») en shadow d'un
    // module hover/off n'était JAMAIS scanné à l'apparition (gate consultant
    // seulement module hôte + config) → repli au SURVOL seulement. On complète la
    // gate par un querySelector ciblé (un seul par montage, pas un scan complet).
    const eager = µ._mjs_normPreload(host._mjs_preload) === 'on'
      || µ._mjs_normPreload(cfg.view) === 'on' || µ._mjs_normPreload(cfg.page) === 'on'
      || (host._shadow.querySelector && host._shadow.querySelector('a[data-mjs-preload="on"], a[data-mjs-preload="eager"]'));
    if (eager) { µ._mjs_scanEager(host._shadow); }
  }
};
// </preload-on>
µ._mjs_maybeScanEager = function(host) {
  if (µ._isServer || !host || !host._shadow) { return; }
  // <child-props>
  // contenu retenu hors de l'ombre jusqu'à la reprise de ses props (`_mjs_kf`, mjs_element.ts) : rien à chercher encore, son entrée
  // relance la recherche
  if (host._mjs_kf) { return; }
  // </child-props>
  // <preload-on>
  // la porte se lit à l'image suivante, pour tous les composants construits d'ici là : leur premier rendu a posé les liens des
  // blocs (`{if}`, `{for}`) et ceux d'un gabarit léger, que le constructeur ne voit pas encore ; un ajout en liste par composant.
  // Sans image (onglet caché), la liste ne retient pas sans fin des composants peut-être retirés : tous les 1 024, une minuterie
  // la lit
  const waiting = _mjsEagerHosts.push(host);
  if (waiting === 1 && typeof requestAnimationFrame === 'function') { requestAnimationFrame(_mjsEagerFlush); }
  else if (waiting === 1) { _mjsEagerFlush(); }
  else if ((waiting & 1023) === 0) { setTimeout(_mjsEagerFlush, 0); }
  // </preload-on>
  // <no-preload-on>
  // const cfg = µ.preload || {};
  // // même normalisation 'eager'≡'on' que _mjs_effectivePreload ; un lien `:preload="on"` écrit dans l'ombre d'un module hover ou off
  // // complète la porte par une recherche ciblée, une par construction
  // const eager = µ._mjs_normPreload(host._mjs_preload) === 'on'
  //   || µ._mjs_normPreload(cfg.view) === 'on' || µ._mjs_normPreload(cfg.page) === 'on'
  //   || (host._shadow.querySelector && host._shadow.querySelector('a[data-mjs-preload="on"], a[data-mjs-preload="eager"]'));
  // if (!eager) { return; }
  // if (typeof requestAnimationFrame === 'function') {
  //   requestAnimationFrame(function() { µ._mjs_scanEager(host._shadow); });
  // } else {
  //   µ._mjs_scanEager(host._shadow);
  // }
  // </no-preload-on>
};
// <<< extrait-test _mjs_maybeScanEager

// Survol : un seul listener délégué. L'anti-doublon rend l'appel répété (à chaque
// entrée de souris) quasi gratuit.
// Posé aussi sur la racine de chaque ombre (µ._mjs_ujsShadowAttach), seule à voir le lien d'une ombre fermée.
µ._mjs_ujsHover = function(e) {
  const link = µ._mjs_closest(µ.realTarget(e), 'a');
  if (link) { µ._mjs_preloadLink(link, 'hover'); }
};
document.addEventListener('pointerover', µ._mjs_ujsHover);

// Balaye le document au boot (liens 'eager' en light DOM).
if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(function() { µ._mjs_scanEager(document); });
} else {
  µ._mjs_scanEager(document);
}

// ──────────────────────────────────────────────────────────────────────────
// PREMIER CHARGEMENT — `mjs:load` pour la page déjà présente à l'arrivée sur le site (SSR ou
// navigation navigateur classique de la 1re page — jamais un clic/popstate/submit ne l'amène) :
// `via: 'initial'`, `initial: true` — seule émission de tout le cycle de vie à porter cette valeur.
// `document.readyState === 'loading'` (script posé en tête) → les composants ne sont pas encore montés
// (upgrade customElements synchrone pendant le parse) : on attend DOMContentLoaded. Sinon (script
// déféré/module, ou en fin de <body>) → un microtask suffit, JAMAIS synchrone à l'import (les
// composants déjà présents au parse sont encore en cours d'upgrade au moment où CE fichier s'exécute).
// Gardé : ce fichier peut être chargé dans un pool SSR (happy-dom, aucun vrai navigateur derrière
// `document`).
// >>> extrait-test _mjs_navEmitInitial
µ._mjs_navEmitInitial = function() {
  // µ._mjs_navEmitPaths : `window.location.href` est TOUJOURS absolue (même origine, par
  // construction — c'est la localisation courante) ; normalisée pour l'uniformité avec les 12 autres
  // sites d'émission (idempotent : la même origine, une fois rabotée, redonne le chemin attendu).
  var evPaths = µ._mjs_navEmitPaths(window.location.href);
  µ._mjs_navEmit('load', { path: evPaths.path, url: evPaths.url, via: 'initial', zone: µ._mjs_navMountZone(document, null).zone, initial: true }, false);
  // la page montée : la position gardée de l'entrée quand la page revient (rechargement, retour après un chargement
  // complet), sinon l'ancre de l'adresse d'arrivée, dont la cible a pu échapper au navigateur (µ._mjs_anchorArrive)
  if (typeof µ._mjs_anchorArrive === 'function') { µ._mjs_anchorArrive(typeof µ._mjs_keptEntryPos === 'function' ? µ._mjs_keptEntryPos() : null); }
};
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', µ._mjs_navEmitInitial, { once: true });
  } else {
    Promise.resolve().then(µ._mjs_navEmitInitial);
  }
}
// <<< extrait-test _mjs_navEmitInitial
