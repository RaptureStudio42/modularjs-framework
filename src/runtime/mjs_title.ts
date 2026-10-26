// mjs_title — directive @title : bulle d'infobulle universelle, posable sur N'IMPORTE QUELLE
// balise (`@title="texte"`, `@title={ text: '…', delay, side, dur, transition }` ou
// `@title={{ expr }}`, cf. transpiler/index.ts `preprocessHtml`). Module CŒUR (toujours inclus,
// comme mjs_element) : la
// bulle naît PARESSEUSEMENT DANS LA RACINE de l'élément survolé (shadow du composant s'il est
// fermé, document sinon) — stylable DEPUIS LE SASS DU COMPOSANT lui-même (API Popover, top-layer,
// jamais rognée par un ancêtre overflow/z-index), avec un repli body + position fixed pour les
// navigateurs/harnais sans Popover (happy-dom compris, cf. tests/runtime-title.test.ts).
//
// Écoute par RACINE (µ._mjs_titleAttach(root), posé par mjs_element.ts au même endroit que le pont
// UJS — cf. µ._mjs_ujsShadowAttach, mjs_ujs.ts) : un Shadow DOM FERMÉ retargete les événements à sa
// frontière, un délégué document-level ne verrait jamais l'élément réel. Chaque racine n'est
// attachée qu'une fois (WeakSet). `document` lui-même est attaché au chargement de ce module
// (couvre le light DOM et les balises hors composant).
//
// Accessibilité : survol ET focus clavier (mouseover/focusin, sorties mouseout/focusout —
// Escape ferme aussi), aria-describedby posé/retiré proprement (jeton ajouté/retiré, existant
// préservé), texte TOUJOURS en textContent pour `mjs-title` (jamais interprété). Config
// `µ.config.title` (mjs_init.ts) ← fusion avec `mjs-title-conf` posé par le compilateur sur
// l'élément (l'élément gagne toujours).
//
// `mjs-title-html` (compilé depuis `@title={{ expr }}`, transpiler/index.ts) :
// même bulle, contenu posé en innerHTML (élément RÉEL, PAS échappé) au lieu de textContent. Un
// élément qui porte les DEUX attributs voit `mjs-title-html` GAGNER (cf. __titleResolveContent) —
// forme la plus riche, choisie EXPLICITEMENT par le développeur via le doublement d'accolades.
// SÉCURITÉ : porte ouverte VOLONTAIRE, exactement comme `{{expr}}` en interpolation de texte —
// aucune désinfection ici, ne l'alimente JAMAIS avec une saisie non maîtrisée. Un `<script>` posé
// dedans reste inerte (règle HTML standard de `innerHTML`) — mais un attribut `onerror`/`onload`
// (`<img src=x onerror=…>`, `<body onload=…>`) s'EXÉCUTE RÉELLEMENT : le parseur HTML compile ces
// attributs en gestionnaire d'événement vivant, `innerHTML` compris (« event handler content
// attributes », comportement standard, prouvé en Chromium). Le test `<script>` inerte
// (tests/runtime-title.test.ts) prouve UN cas rassurant, pas une garantie générale — le test
// voisin sur `onerror` prouve le vecteur réel.
//
// Styles : petite feuille adoptée (µ._mjs_titleSheet, même patron que µ._mjs_modalSheet/µ._mjs_shield) —
// TOUS les sélecteurs de défauts enveloppés `:where(...)` (spécificité nulle : le SASS du
// composant gagne toujours, même avec une classe nue). Variables `--mjs-title-*` pour les
// couleurs/formes (CSS pur, pas de clé JS pour celles-ci) ; `--mjs-title-dur` seule est
// alimentée par la config (setProperty sur la bulle — canal variable, zéro style inline pour la
// durée). Le positionnement (top/left, calculé depuis getBoundingClientRect, et max-height d'une
// bulle plus haute que la fenêtre) reste, lui, posé en style direct — donnée purement géométrique
// et jetable, même famille que le FLIP (mjs_easing.ts).

// test d'inclusion insensible à une méthode `contains` du composant (cf. mjs_element.ts)
µ._mjs_inside = µ._mjs_inside || function(a, b) {
  return typeof Node === 'function' && a instanceof Node ? Node.prototype.contains.call(a, b) : a.contains(b);
};
// même chose pour `closest`
µ._mjs_closest = µ._mjs_closest || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.closest.call(n, sel);
  return n && typeof n.closest === 'function' ? n.closest(sel) : null;
};

µ._mjs_titleSheet = new CSSStyleSheet();

// inset et margin remis : la feuille native de [popover] pose inset:0 et margin:auto, qui tirent la bulle vers le centre de la fenêtre
// overflow:auto comme cette feuille native : sans Popover aussi, une bulle à hauteur bornée rogne son texte
µ._mjs_titleSheet.replaceSync(`:where(.mjs-title){position:fixed;inset:auto;margin:0;z-index:2147483647;max-width:280px;overflow:auto;pointer-events:none;opacity:0;padding:var(--mjs-title-pad, 6px 10px);border-radius:var(--mjs-title-radius, 6px);border:1px solid var(--mjs-border, rgba(255,255,255,.25));background:var(--mjs-title-bg, #1c2333);color:var(--mjs-title-fg, #f4f4f5);box-shadow:var(--mjs-title-shadow, 0 4px 14px rgba(0,0,0,.35));font:13px/1.4 system-ui,sans-serif;transition:opacity var(--mjs-title-dur, 150ms) ease,transform var(--mjs-title-dur, 150ms) ease}
:where(.mjs-title[data-mjs-title-transition="slide"][data-mjs-title-side="top"]){transform:translateY(var(--mjs-title-offset, 4px))}
:where(.mjs-title[data-mjs-title-transition="slide"][data-mjs-title-side="bottom"]){transform:translateY(calc(var(--mjs-title-offset, 4px)*-1))}
:where(.mjs-title.mjs-title-visible){opacity:1;transform:translateY(0)}`);

// reste dans un composant qui repose ses feuilles (cf. _mjs_applyLayout)
µ._mjs_titleSheet._mjs_keep = true;

document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_titleSheet];

// Popover natif (top-layer) — feature-detect UNE FOIS. Absent (vieux navigateur, happy-dom en
// test) → repli : bulle UNIQUE dans document.body, position fixed (jamais dans un shadow — sans
// top-layer, un ancêtre overflow/z-index pourrait la rogner).
var __titlePopoverOk = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

// État module (une seule bulle visible à la fois, philosophie standard des tooltips délégués).
var __titleAttachedRoots  = new WeakSet(); // racines déjà écoutées
var __titleBubbles        = new WeakMap(); // racine (ou document en repli) → bulle créée pour elle
var __titleUid            = 0;
var __titleTimer          = null;
var __titlePendingEl      = null;
var __titleCurrent        = null; // élément dont la bulle est actuellement affichée
var __titleCurrentBubble  = null;
var __titleObserver       = null; // instancié plus bas, une fois __titleHide défini
var __titleDetachObserver = null; // détecte le RETRAIT DOM de la cible pendant l'affichage

// substitution title natif ↔ bulle MJS : la bulle SE SUBSTITUE au `title` natif, jamais les
// deux à la fois — cf. __titleSuppressNative/__titleRestoreNative, appelées depuis __titleDoShow/
// __titleHide (même patron que aria-describedby).
var __titleNativeTitles   = new WeakMap(); // élément → title natif mémorisé pendant la substitution
var __titleAddedAriaLabel = new WeakSet(); // aria-label posé PAR CE MODULE (jamais celui de l'auteur)

// État tactile — appui long : minuteur d'apparition, dérive, survie après relâcher (le
// doigt parti, on laisse lire), horodatage anti-mouseover-synthétique (mobile réémet un survol
// après le relâcher).
var TITLE_TOUCH_PRESS_MS  = 500;  // durée d'appui avant apparition
var TITLE_TOUCH_LINGER_MS = 1500; // survie de la bulle après le relâcher
var TITLE_TOUCH_DRIFT_PX  = 10;   // dérive au-delà de laquelle l'appui en attente est annulé
var __titleTouchTimer     = null; // minuteur d'appui en attente
var __titleTouchEl        = null; // élément visé par l'appui en cours
var __titleTouchStartX    = 0;
var __titleTouchStartY    = 0;
var __titleTouchShown     = false; // bulle actuellement affichée née d'un appui tactile
var __titleTouchHideTimer = null; // minuteur de fermeture programmée après le relâcher
var __titleLastTouchAt    = 0; // horodatage du dernier touchstart

// Fusion config : défauts internes ← µ.config.title ← mjs-title-conf de l'élément (l'élément
// gagne). Toute valeur absente/invalide est ignorée EN SILENCE, clé par clé — jamais de warn (pas
// de bruit sur un survol répété).
function __titleResolveConfig(el) {
  var cfg = { delay: 400, side: 'top', dur: 150, transition: 'fade' };
  var g = µ.config && µ.config.title;
  if (g && typeof g === 'object') {
    if (typeof g.delay === 'number') { cfg.delay = g.delay; }
    if (g.side === 'top' || g.side === 'bottom') { cfg.side = g.side; }
    if (typeof g.dur === 'number') { cfg.dur = g.dur; }
    if (g.transition === 'fade' || g.transition === 'slide') { cfg.transition = g.transition; }
  }
  var raw = el.getAttribute('mjs-title-conf');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.delay === 'number') { cfg.delay = parsed.delay; }
        if (parsed.side === 'top' || parsed.side === 'bottom') { cfg.side = parsed.side; }
        if (typeof parsed.dur === 'number') { cfg.dur = parsed.dur; }
        if (parsed.transition === 'fade' || parsed.transition === 'slide') { cfg.transition = parsed.transition; }
      }
    } catch { /* JSON invalide : repli silencieux sur les valeurs déjà résolues */ }
  }
  return cfg;
}

// Résolution PURE du côté effectif — testable directement avec des rects fabriqués, aucune
// dépendance DOM. `preferred` non reconnu (mjs-title-conf corrompu, passé outre la fusion)
// retombe sur 'top'.
// le côté préféré s'il a la place, sinon l'autre s'il l'a ; aucun des deux : celui qui a le plus de place (égalité : le préféré)
µ._mjs_titleResolveSide = function(preferred, rect, bubbleHeight, gap, viewportH) {
  var up   = rect.top;
  var down = viewportH - rect.bottom;
  var need = bubbleHeight + gap;
  if (preferred === 'bottom') { return down >= need || (up < need && down >= up) ? 'bottom' : 'top'; }
  return up >= need || (down < need && up >= down) ? 'top' : 'bottom';
};

// Bulle PARESSEUSE, réutilisée PAR RACINE (test « bulle unique ») : `host` = la racine réelle en
// mode Popover, TOUJOURS `document` en repli (une seule bulle globale, cf. bandeau de tête).
function __titleBubbleFor(host) {
  // `document` n'accepte PAS d'enfant direct (un seul élément racine, <html>) — la feuille reste
  // adoptée sur `host` (document ou shadow root), mais le MONTAGE d'un document va dans son body ;
  // un shadow root, lui, accepte un enfant direct sans détour.
  var mount = host === document ? document.body : host;
  var b = __titleBubbles.get(host);
  if (b) {
    // Ré-ancrage défensif : une racine reconstruite entre-temps (ex. swap plein `<body>` par une
    // navigation UJS) aurait emporté la bulle avec l'ancien contenu — la MÊME instance est
    // simplement recollée, jamais recréée (garde le test « bulle unique » vrai dans ce cas aussi).
    if (!b.isConnected) { mount.appendChild(b); }
    return b;
  }
  b = document.createElement('div');
  b.className = 'mjs-title';
  b.id = 'mjs-title-' + (++__titleUid);
  b.setAttribute('role', 'tooltip');
  if (__titlePopoverOk) { b.setAttribute('popover', 'manual'); }
  if ('adoptedStyleSheets' in host && host.adoptedStyleSheets.indexOf(µ._mjs_titleSheet) === -1) {
    // Adoption JIT (pas au constructor du composant) — mjs_element.ts `_mjs_applyLayout` réécrit
    // ENTIÈREMENT `_shadow.adoptedStyleSheets` à CHAQUE connectedCallback : une adoption posée au
    // constructor (via µ._mjs_titleAttach) s'y ferait effacer avant même le premier survol. ICI, la
    // bulle est déjà nécessaire → le montage du composant est forcément terminé.
    host.adoptedStyleSheets = host.adoptedStyleSheets.concat(µ._mjs_titleSheet);
  }
  mount.appendChild(b);
  __titleBubbles.set(host, b);
  return b;
}

// Positionnement : au-dessus par défaut, bascule en dessous (ou l'inverse) si la place
// manque — cf. µ._mjs_titleResolveSide, seule la lecture des rects est faite ici.
// bulle déjà ouverte (cf. __titleDoShow) et ramenée au bord gauche avant la mesure : à son ancienne
// place, la largeur restante pourrait la plier ; contre un bord, glissée vers l'intérieur
// zoom CSS autour de la bulle (html, conteneur zoomé) : le navigateur multiplie ses top et left par lui, lu sur l'écran en la
// décalant de 1 000 px (currentCSSZoom manque à Safari) ; plus haute que la fenêtre, hauteur bornée à la fenêtre moins deux
// écarts, le surplus rogné ; aucun côté assez grand, ramenée dans la fenêtre quitte à couvrir son élément
function __titlePosition(bubble, trigger, side) {
  var gap   = 8;
  var vh    = window.innerHeight;
  bubble.style.top       = '0px';
  bubble.style.left      = '0px';
  bubble.style.maxHeight = '';
  var rect  = trigger.getBoundingClientRect();
  var brect = bubble.getBoundingClientRect();
  bubble.style.top = '1000px';
  var zoom  = (bubble.getBoundingClientRect().top - brect.top) / 1000 || 1;
  if (brect.height > vh - 2 * gap) {
    bubble.style.maxHeight = parseFloat(getComputedStyle(bubble).height) - (brect.height - vh + 2 * gap) / zoom + 'px';
    brect = bubble.getBoundingClientRect();
  }
  var eff   = µ._mjs_titleResolveSide(side, rect, brect.height, gap, vh);
  var top   = eff === 'top' ? (rect.top - brect.height - gap) : (rect.bottom + gap);
  var left  = Math.max(gap, Math.min(rect.left + (rect.width - brect.width) / 2, document.documentElement.clientWidth - brect.width - gap));
  if (top < 0 || top + brect.height > vh) { top = Math.max(gap, Math.min(top, vh - brect.height - gap)); }
  bubble.style.top  = top / zoom + 'px';
  bubble.style.left = left / zoom + 'px';
  bubble.setAttribute('data-mjs-title-side', eff);
}

// aria-describedby : jeton ajouté/retiré proprement, l'existant (posé par l'app) survit.
function __titleDescribe(el, id) {
  var prev   = el.getAttribute('aria-describedby');
  var tokens = prev ? prev.split(/\s+/).filter(Boolean) : [];
  if (tokens.indexOf(id) === -1) {
    tokens.push(id);
    el.setAttribute('aria-describedby', tokens.join(' '));
  }
}
function __titleUndescribe(el, id) {
  var prev = el.getAttribute('aria-describedby');
  if (!prev) { return; }
  var tokens = prev.split(/\s+/).filter(Boolean).filter(function(tok) { return tok !== id; });
  if (tokens.length > 0) { el.setAttribute('aria-describedby', tokens.join(' ')); } else { el.removeAttribute('aria-describedby'); }
}

// Nom accessible : un `title` natif peut être le SEUL nom accessible d'un élément sans texte
// visible ni aria-label/aria-labelledby (icône seule, etc.) — sa disparition le rendrait anonyme
// pour les technologies d'assistance. Heuristique délibérément simple (PAS l'algorithme complet
// Accessible Name — hors périmètre d'une directive posable sur N'IMPORTE QUELLE balise) :
// aria-label/aria-labelledby déjà posés OU texte visible non vide ⇒ title n'était pas la seule
// source, on ne touche à rien.
function __titleNeedsAccessibleName(el) {
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) { return false; }
  var text = el.textContent;
  return !text || text.replace(/\s+/g, '') === '';
}

// Substitution : mémorise le title natif EXACT (chaîne vide comprise) et le retire — jamais
// rien à mémoriser si l'élément n'en avait pas (`getAttribute` rend `null`, test « rien
// d'inventé »). Rappelée par le MutationObserver (plus bas) quand l'auteur repose un `title`
// PENDANT que la bulle est affichée : la bulle MJS reste seule maîtresse (réécrasé aussitôt), la
// mémoire est mise à jour avec cette dernière valeur — c'est ELLE qui sera restituée à la
// fermeture. `native === ''` : aucun nom accessible à préserver, aria-label non posé. Déjà
// possédé par ce module (rappel en cours de substitution) : la valeur de l'aria-label suit,
// jamais un nouveau calcul d'heuristique (l'auteur n'a rien pu poser entre-temps sur un attribut
// que ce module tient déjà).
function __titleSuppressNative(el) {
  var native = el.getAttribute('title');
  if (native == null) { return; }
  __titleNativeTitles.set(el, native);
  el.removeAttribute('title');
  if (native === '') { return; }
  if (__titleAddedAriaLabel.has(el)) { el.setAttribute('aria-label', native); return; }
  if (__titleNeedsAccessibleName(el)) { el.setAttribute('aria-label', native); __titleAddedAriaLabel.add(el); }
}

// Restitution : title natif reposé À L'IDENTIQUE (WeakMap conserve la chaîne vide comme
// n'importe quelle autre valeur), aria-label retiré SEULEMENT si posé par ce module. Fonctionne
// aussi sur un nœud déjà déconnecté (élément recyclé par une navigation, composant détruit) —
// `setAttribute`/`removeAttribute` sur un nœud détaché ne lève jamais, juste sans effet visible.
function __titleRestoreNative(el) {
  if (!__titleNativeTitles.has(el)) { return; }
  el.setAttribute('title', __titleNativeTitles.get(el));
  __titleNativeTitles.delete(el);
  if (__titleAddedAriaLabel.has(el)) { el.removeAttribute('aria-label'); __titleAddedAriaLabel.delete(el); }
}

// Résout le contenu à afficher : `mjs-title-html` GAGNE si les DEUX attributs sont posés
// sur le même élément (forme la plus riche, choisie EXPLICITEMENT via le doublement d'accolades
// au compilateur) — jamais un mélange des deux contenus. `null` si aucun des deux n'est posé ou
// si le gagnant est une chaîne vide (comportement inchangé : bulle vide = pas de bulle).
function __titleResolveContent(el) {
  var html = el.getAttribute('mjs-title-html');
  if (html != null && html !== '') { return { html: true, value: html }; }
  var text = el.getAttribute('mjs-title');
  if (text != null && text !== '') { return { html: false, value: text }; }
  return null;
}

// Apparition — l'attribut est relu ICI (valeur COURANTE, jamais celle capturée au survol).
function __titleDoShow(el, root, cfg) {
  if (!el.isConnected) { return; } // parti pendant le délai
  var content = __titleResolveContent(el);
  if (!content) { return; }
  if (__titleCurrent && __titleCurrent !== el) { __titleHide(); } // bascule propre (aria + observer)
  __titleSuppressNative(el); // substitution : title natif mis de côté avant l'observer (l. plus bas)
  var host   = __titlePopoverOk ? root : document;
  var bubble = __titleBubbleFor(host);
  if (content.html) { bubble.innerHTML = content.value; } else { bubble.textContent = content.value; }
  bubble.setAttribute('data-mjs-title-transition', cfg.transition);
  bubble.style.setProperty('--mjs-title-dur', cfg.dur + 'ms');
  // ouverte AVANT la mesure : un popover fermé est en display:none (0 × 0) ; elle reste à opacity 0
  // jusqu'à mjs-title-visible, posée plus bas dans la même tâche — aucune image au mauvais endroit
  if (__titlePopoverOk && typeof bubble.showPopover === 'function') {
    try { bubble.showPopover(); } catch { /* déjà ouverte : sans conséquence */ }
  }
  __titlePosition(bubble, el, cfg.side);
  if (__titleObserver) {
    __titleObserver.disconnect();
    __titleObserver.observe(el, { attributes: true, attributeFilter: ['mjs-title', 'mjs-title-html', 'title'] });
  }
  // observateur DÉDIÉ (jamais partagé avec __titleObserver ci-dessus) sur `root` en
  // childList+subtree — un retrait DOM de `el` (ou d'un de ses ancêtres, jusqu'à `root`) pendant
  // l'affichage referme la bulle au lieu de la laisser orpheline pour toujours (aucun mouseout/
  // mouseleave natif n'est émis par un retrait programmatique, cf. en-tête).
  if (__titleDetachObserver) {
    __titleDetachObserver.disconnect();
    __titleDetachObserver.observe(root, { childList: true, subtree: true });
  }
  __titleCurrent       = el;
  __titleCurrentBubble = bubble;
  __titleDescribe(el, bubble.id);
  // Reflow forcé AVANT de rebasculer la classe : redémarre la transition CSS sur une bulle
  // réutilisée (même bulle qu'au tour précédent) — même patron que les transitions anti-flash du
  // framework (épingler l'état de départ avant de déclencher l'état d'arrivée).
  bubble.classList.remove('mjs-title-visible');
  void bubble.offsetHeight;
  bubble.classList.add('mjs-title-visible');
}

// Disparition — TOUJOURS immédiate (« disparition immédiate en sortant/blur »).
function __titleHide() {
  if (!__titleCurrent) { return; }
  var el     = __titleCurrent;
  var bubble = __titleCurrentBubble;
  if (__titleObserver) { __titleObserver.disconnect(); }
  if (__titleDetachObserver) { __titleDetachObserver.disconnect(); }
  if (bubble) {
    bubble.classList.remove('mjs-title-visible');
    if (__titlePopoverOk && typeof bubble.hidePopover === 'function') {
      try { bubble.hidePopover(); } catch { /* déjà fermée : sans conséquence */ }
    }
    __titleUndescribe(el, bubble.id);
  }
  __titleRestoreNative(el); // substitution : title natif restitué à l'identique
  __titleCurrent       = null;
  __titleCurrentBubble = null;
  __titleTouchShown    = false; // toute fermeture efface l'origine tactile de la bulle qui vient de partir
}

// MutationObserver RÉUTILISÉ (un seul, redirigé à chaque apparition) : pendant que la bulle est
// visible, un changement de `mjs-title`/`mjs-title-html` la met à jour (même arbitrage que
// __titleResolveContent) ; vidé/retiré → fermeture. Filtre étendu à `title` :
// l'auteur qui repose un title natif PENDANT que la bulle est affichée se le voit réécraser
// aussitôt par __titleSuppressNative — la bulle MJS reste seule maîtresse, et c'est cette
// DERNIÈRE valeur qui sera restituée à la fermeture (jamais l'originale). Aucune boucle :
// __titleSuppressNative ne réécrit rien quand `title` est déjà absent (le retrait qu'elle vient de
// faire ne redéclenche donc rien au passage suivant).
if (typeof MutationObserver !== 'undefined') {
  __titleObserver = new MutationObserver(function(mutations) {
    if (!__titleCurrent || !__titleCurrentBubble) { return; }
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === 'title') { __titleSuppressNative(__titleCurrent); }
    }
    var content = __titleResolveContent(__titleCurrent);
    if (!content) { __titleHide(); return; }
    if (content.html) { __titleCurrentBubble.innerHTML = content.value; } else { __titleCurrentBubble.textContent = content.value; }
  });
}

// observateur DÉDIÉ du retrait DOM — instance SÉPARÉE de __titleObserver ci-dessus (jamais
// partagée) pour ne rien changer au comportement déjà couvert par la réactivité d'attribut. Toute
// mutation dans le sous-arbre de `root` (cf. __titleDoShow) redéclenche une simple vérification
// `isConnected` ; retirée à la fermeture (__titleHide, zéro fuite).
if (typeof MutationObserver !== 'undefined') {
  __titleDetachObserver = new MutationObserver(function() {
    if (__titleCurrent && !__titleCurrent.isConnected) { __titleHide(); }
  });
}

// Minuterie d'apparition : annulée si la souris/le focus quitte avant le délai.
function __titleClearPending() {
  if (__titleTimer != null) { clearTimeout(__titleTimer); __titleTimer = null; }
  __titlePendingEl = null;
}
function __titleScheduleShow(el, root) {
  if (__titleCurrent === el) { return; } // déjà affichée
  __titleClearPending();
  __titlePendingEl = el;
  var cfg = __titleResolveConfig(el);
  __titleTimer = setTimeout(function() {
    __titleTimer     = null;
    __titlePendingEl = null;
    __titleDoShow(el, root, cfg);
  }, cfg.delay);
}

// Délégation par racine : `closest('[mjs-title], [mjs-title-html]')` (un élément qui ne
// porte QUE mjs-title-html doit quand même déclencher la bulle) depuis `e.target` — pas de
// retargeting à gérer ICI, le listener est posé DIRECTEMENT sur la racine concernée (même
// raisonnement que le pont UJS, cf. mjs_ujs.ts µ._mjs_ujsShadowAttach), `closest()` s'arrête
// naturellement à sa frontière.
//
// Double passage racine→document (shadow OUVERT — AUCUN retargeting natif, e.target reste le
// VRAI nœud aux DEUX niveaux ; happy-dom REPRODUIT ce même gap même en shadow FERMÉ, cf. le
// bandeau de tests/ujs-shadow-confirm.test.ts) : SANS garde, le second passage (document) ré-agit
// sur le MÊME élément avec `this === document`, écrasant le `root` shadow déjà résolu par le
// premier passage — la bulle finirait TOUJOURS en repli body, même quand Popover est disponible.
// Marqueur PAR ÉVÉNEMENT `e._mjs_mjsTitleHandled` (même famille que `e._mjs_mjsConfirmGated`, mjs_ujs.ts) :
// posé SEULEMENT quand un élément est réellement trouvé ET traité — un 2ᵉ passage qui ne trouve
// rien à CE niveau reste libre d'agir (délégations de portées différentes, cas légitime).
function __titleAncestor(target) {
  return µ._mjs_closest(target, '[mjs-title], [mjs-title-html]');
}
function __titleOnEnter(e) {
  if (e._mjs_mjsTitleHandled) { return; }
  if (e.type === 'mouseover' && (Date.now() - __titleLastTouchAt) < 800) { return; } // mouseover synthétique émis après un toucher (mobile) : ignoré
  var el = __titleAncestor(e.target);
  if (!el) { return; }
  if (e.relatedTarget && el.contains && µ._mjs_inside(el, e.relatedTarget)) { return; } // reste dedans
  e._mjs_mjsTitleHandled = true;
  __titleScheduleShow(el, this);
}
function __titleOnLeave(e) {
  if (e._mjs_mjsTitleHandled) { return; }
  var el = __titleAncestor(e.target);
  if (!el) { return; }
  if (e.relatedTarget && el.contains && µ._mjs_inside(el, e.relatedTarget)) { return; } // reste dedans
  e._mjs_mjsTitleHandled = true;
  if (__titlePendingEl === el) { __titleClearPending(); }
  if (__titleCurrent === el) { __titleHide(); }
}

// Appui long tactile : même résolution de cible que le survol (__titleAncestor). `touchstart`
// programme l'apparition après TITLE_TOUCH_PRESS_MS ; `touchmove` au-delà du seuil de dérive annule
// ce minuteur EN ATTENTE (une bulle déjà affichée n'est pas retirée ici — le scroll la fermera) ;
// `touchend`/`touchcancel` annulent le minuteur en attente et, si la bulle tactile est affichée,
// programment sa fermeture après TITLE_TOUCH_LINGER_MS (doigt parti, on laisse lire) ; `contextmenu`
// n'est étouffé que si une bulle tactile est affichée POUR CETTE CIBLE.
function __titleTouchClearPress() {
  if (__titleTouchTimer != null) { clearTimeout(__titleTouchTimer); __titleTouchTimer = null; }
  __titleTouchEl = null;
}
function __titleOnTouchStart(e) {
  // même garde anti double-passage shadow → document que __titleOnEnter/
  // __titleOnLeave (cf. bandeau plus haut) : un `touchstart` composé traverse
  // la racine shadow PUIS document, chacune écoutée séparément — sans garde,
  // la 2e passe (root = document) écrasait `root` et le minuteur programmé
  // par la 1re passe (root = shadow), faisant naître la bulle en repli
  // document.body même quand Popover est disponible dans le shadow.
  if (e._mjs_mjsTitleHandled) { return; }
  __titleLastTouchAt = Date.now();
  var touch = e.touches && e.touches[0];
  if (!touch) { return; }
  var el = __titleAncestor(e.target);
  if (!el) { return; }
  e._mjs_mjsTitleHandled = true;
  __titleTouchClearPress();
  __titleTouchEl     = el;
  __titleTouchStartX = touch.clientX;
  __titleTouchStartY = touch.clientY;
  var root = this;
  __titleTouchTimer = setTimeout(function() {
    __titleTouchTimer = null;
    var target = __titleTouchEl;
    __titleTouchEl = null;
    if (!target) { return; }
    __titleDoShow(target, root, __titleResolveConfig(target));
    if (__titleCurrent === target) { __titleTouchShown = true; }
  }, TITLE_TOUCH_PRESS_MS);
}
function __titleOnTouchMove(e) {
  if (__titleTouchTimer == null) { return; } // rien en attente : bulle déjà affichée ou appui déjà relâché
  var touch = e.touches && e.touches[0];
  if (!touch) { return; }
  var dx   = touch.clientX - __titleTouchStartX;
  var dy   = touch.clientY - __titleTouchStartY;
  var dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > TITLE_TOUCH_DRIFT_PX) { __titleTouchClearPress(); }
}
function __titleOnTouchEnd(e) {
  // même garde double-passage que __titleOnTouchStart (pendant local à
  // `touchstart`, cf. son commentaire) — posée ici aussi pour l'analogue
  // « leave » de l'appui tactile, par symétrie avec __titleOnEnter/__titleOnLeave.
  if (e._mjs_mjsTitleHandled) { return; }
  e._mjs_mjsTitleHandled = true;
  __titleTouchClearPress();
  if (!__titleTouchShown || !__titleCurrent) { return; }
  if (__titleTouchHideTimer != null) { clearTimeout(__titleTouchHideTimer); }
  // le minuteur de survie n'enregistrait PAS pour quel élément il avait été posé, seul du
  // fichier à casser le motif d'identité (`if (__titleCurrent === el)`). Appui long sur A, relâcher,
  // appui long sur B avant l'échéance : le réveil du minuteur de A fermait la bulle de B.
  var cible = __titleCurrent;
  __titleTouchHideTimer = setTimeout(function() {
    __titleTouchHideTimer = null;
    if (__titleCurrent !== cible) { return; }   // une autre bulle a pris la place : pas la nôtre à fermer
    __titleHide();
  }, TITLE_TOUCH_LINGER_MS);
}
function __titleOnContextMenu(e) {
  var el = __titleAncestor(e.target);
  if (el && __titleTouchShown && __titleCurrent === el) { e.preventDefault(); }
}

// Attache par racine, gardée par mjs_element.ts (`typeof µ._mjs_titleAttach === 'function'`) au
// même endroit que le pont UJS. Idempotent : une racine déjà vue ressort AVANT tout addEventListener.
µ._mjs_titleAttach = function(root) {
  if (!root || __titleAttachedRoots.has(root)) { return; }
  __titleAttachedRoots.add(root);
  root.addEventListener('mouseover', __titleOnEnter);
  root.addEventListener('mouseout', __titleOnLeave);
  root.addEventListener('focusin', __titleOnEnter);
  root.addEventListener('focusout', __titleOnLeave);
  root.addEventListener('touchstart', __titleOnTouchStart, { passive: true });
  root.addEventListener('touchmove', __titleOnTouchMove, { passive: true });
  root.addEventListener('touchend', __titleOnTouchEnd, { passive: true });
  root.addEventListener('touchcancel', __titleOnTouchEnd, { passive: true });
  root.addEventListener('contextmenu', __titleOnContextMenu);
};

// Boot : `document` couvre le light DOM + les balises hors composant. Escape ferme la bulle
// visible ; scroll/resize la ferment aussi (choix délibéré, plus simple et plus sûr qu'un
// repositionnement en direct).
µ._mjs_titleAttach(document);

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && __titleCurrent) { __titleHide(); }
});
window.addEventListener('scroll', function() {
  if (__titleCurrent) { __titleHide(); }
}, true);
window.addEventListener('resize', function() {
  if (__titleCurrent) { __titleHide(); }
});
