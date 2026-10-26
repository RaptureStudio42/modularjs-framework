// mjs_init.coffee
var MetaViewStub, µ;

µ = {};

// `µ.attach = {}` : namespace
// orphelin, jamais lu ni écrit nulle part ailleurs (`@attach` le template
// directive est un mécanisme totalement distinct, `bindingAttach` dans
// generator/attributes/index.ts, qui n'y touche pas). Retiré.

// Registre global pour les Singletons CSS partagés (@css)
if (µ.CSS == null) {
  µ.CSS = {};
}

// Mode `css: 'lazy'` (`µ._mjs_fetchLazyCss`) vit désormais dans
// src/runtime/mjs_lazy_css.ts — détecté PAR CONFIG (`css: 'lazy'`), jamais par
// scan (cf. bundler/index.ts, resolveRuntimeFiles).

// Shield FOUC : DEUX règles partagées entre le document et chaque
// Shadow DOM (via _mjs_applyLayout, cf. mjs_element.ts).
//   1. `:not(:defined)` couvre les modules imbriqués lazy-loadés (async
//      import) tant qu'ils ne sont pas encore enregistrés. La règle doit
//      être DANS chaque shadow car `:not(:defined)` du document ne traverse
//      pas les frontières Shadow DOM. `:not([mjs-ssr])` en épargne les
//      éléments que le RENDU SERVEUR a déjà peints (attribut posé par
//      server/renderToString.ts et server/render-browser.ts sur chaque
//      élément `mjs-*` rendu) : leur balisage est là, visible, et il reste
//      à l'écran jusqu'au premier rendu client, qui le remplace.
//      `:not([mjs-skel-host])` en épargne ceux qui montrent la silhouette de leur
//      contenu en attendant leur code (mjs_fx_skeleton.ts, µ._mjs_skelShow).
//   2. `[mjs-loading]` couvre le gap entre customElements.define et la fin
//      du premier render (posé par connectedCallback, retiré en microtask) —
//      un élément prérendu compris, dont le contenu est alors remplacé.
// Même instance CSSStyleSheet adoptée partout → coût mémoire constant.
µ._mjs_shield = new CSSStyleSheet();

µ._mjs_shield.replaceSync(':not(:defined):not([mjs-ssr]):not([mjs-skel-host]),[mjs-loading]{display:none!important}');

// Feuille système : classes utilitaires utilisées par le runtime (overlays
// d'erreur, fallback). Pas de style inline — tout passe par des classes pour
// que les apps puissent les overrider via leur propre CSS.
µ._mjs_systemSheet = new CSSStyleSheet();

µ._mjs_systemSheet.replaceSync(`.mjs-fatal-error{color:var(--mjs-error-fg, red);font-weight:bold;padding:10px;border:2px solid var(--mjs-error-border, red)}
.mjs-error{color:var(--mjs-error-fg, red)}`);

// les deux feuilles rejoignent le document ensemble, le bouclier d'abord
document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_shield, µ._mjs_systemSheet];

// Thème clair/sombre embarqué (`µ._mjs_themeSheet`/`µ._mjs_themeAppSheet`/`µ._themeAdopt`, 8 variables
// --mjs-surface/fg/fg-muted/border/hover/selected/accent/shadow + thèmes d'application
// `*.theme.mjs`) vit dans src/runtime/mjs_theme.ts, DÉTECTÉ — plus rattaché d'office au cœur.

// `µ._mjs_routeErrorCss` (panneau « route introuvable ») vit désormais dans
// src/runtime/mjs_page_cache.ts, avec le reste du cache de pages routeur/UJS.

// Stub : `metamjs-view` est un tag interne émis par le compilateur pour
// matérialiser la directive <@view>. Il contient un tiret → il est traité
// comme custom element par le DOM, donc piégé en permanence par le shield
// `:not(:defined)` s'il n'est pas enregistré. On le déclare en no-op.
MetaViewStub = class MetaViewStub extends HTMLElement {};

if (!customElements.get('metamjs-view')) {
  customElements.define('metamjs-view', MetaViewStub);
}

// SSR — flag d'activation de l'hydratation par adoption. Le serveur l'a posé soit via une
// balise script inline (window.__mjs_ssrHydrate = true) AVANT le bundle, soit — sous `csp:
// true`, un script inline étant bloqué par `script-src` — via l'attribut `data-mjs-ssr-hydrate`
// du nœud racine. Lu ici, au boot, avant tout montage de composant.
// NB : pas de balise script littérale dans ce commentaire — le runtime peut être
// chargé via un script inline, qu'une telle séquence couperait.
try {
  if (typeof globalThis !== 'undefined' && globalThis.__mjs_ssrHydrate) {
    // La valeur est le MODE d'hydratation ('a' | 'b' | 'c'), conservé tel quel
    // pour que _mjs_hydrate dispatche vers la bonne approche.
    µ._mjs_ssrHydrate = globalThis.__mjs_ssrHydrate;
  } else if (typeof document !== 'undefined') {
    const hydrateEl = document.querySelector('[data-mjs-ssr-hydrate]');
    if (hydrateEl) {
      µ._mjs_ssrHydrate = hydrateEl.getAttribute('data-mjs-ssr-hydrate');
    }
  }
} catch {
  // no-op
}

// `µ._activeEffectComponent`/
// `µ._activeEffectMask` : reliques V1 (bitmask). Jamais réassignés nulle part
// (seul lu 1 fois, mjs_store.ts, dans une var LOCALE elle-même jamais
// utilisée ensuite) — toujours `null` à vie. Le mécanisme courant est
// `µ.activeComponent` (juste en dessous) + le dispatch direct `_mjs_effectsByVar`
// (V2, sans bitmask). Retirés avec leur site de lecture mort (mjs_store.ts).
// ----------------------------------------------------------------------------
// `µ.activeComponent` — composant en cours d'initialisation/render.
//
// Les runes (`µ.state()`, `µ.store()`, `µ.derived()`...) s'enregistrent sur ce
// composant à la création. Le pattern est partagé par Svelte (`current_component`),
// Vue (`currentInstance`), React (`currentDispatcher`), Solid (`Owner`) — c'est
// LE pattern standard JS pour ce besoin (JS étant single-threaded, c'est safe).
//
// Implémentation en **stack** plutôt que variable flat : si un init imbrique
// un autre init (lazy import, async effect, effets en cascade), `push` empile
// le composant courant et `pop` restaure l'ancien. Une variable flat perdrait
// le contexte parent au premier `= null` du finally d'un sous-init.
//
// Exposé en lecture via `µ.activeComponent` (getter) — les anciens lecteurs
// continuent à fonctionner sans modification.
// ----------------------------------------------------------------------------
µ._mjs_initStack = [];

// Push/pop de la pile : jamais exposés en fonctions à part — `µ.activeComponent`
// (juste en dessous) EST le point d'entrée, `= obj` pousse et `= null` dépile.
// Un ancien couple `_mjs_pushComponent`/`_mjs_popComponent` faisait doublon,
// jamais appelé nulle part dans src/ (aucun compilateur ne les émet), retiré.
Object.defineProperty(µ, 'activeComponent', {
  get: function() {
    return µ._mjs_initStack.length > 0 ? µ._mjs_initStack[µ._mjs_initStack.length - 1] : null;
  },
  set: function(c) {
    // `= null` est interprété comme pop, `= obj` comme push.
    if (c === null || c === void 0) {
      µ._mjs_initStack.pop();
    } else {
      µ._mjs_initStack.push(c);
    }
  },
  configurable: true,
});

// ----------------------------------------------------------------------------
// Tag sets — remplacent les anciens `Object.defineProperty(obj, '_mjs_X', ...)`.
// Pourquoi : un `defineProperty(obj, 'string', ...)` définit une prop par
// STRING littérale qui ne participe pas au mangle de propriétés esbuild. En
// prod, les lecteurs dotted `obj._mjs_X` sont manglés vers `obj.a` mais la
// prop reste sous le nom `_mjs_X` → la prop déclarée et la prop lue divergent
// → tag perdu, fonctionnalité cassée.
//
// Solution : WeakSet global. La présence dans le set est l'équivalent d'un
// flag booléen, sans pollution `enumerable: true` sur l'objet et sans
// dépendance au mangle. WeakSet ne retient pas les objets contre le GC.
//
//   µ._mjs_rawSet.add(obj)         → équivaut à obj._mjs_raw = true
//   µ._mjs_rawSet.has(obj)         → équivaut à obj._mjs_raw
//
//   µ._mjs_interpolatorSet.add(this)  → équivaut à this._mjs_is_interpolator = true
//   µ._mjs_interpolatorSet.has(obj)   → équivaut à obj._mjs_is_interpolator
// ----------------------------------------------------------------------------
µ._mjs_rawSet = new WeakSet();

µ._mjs_interpolatorSet = new WeakSet();

// ----------------------------------------------------------------------------
// Logging helpers — `µ.log()`/`µ.warn()`/`µ.error()` remplacent les `console.*`
// dans le runtime, gouvernés par un NIVEAU EFFECTIF, du plus bavard au plus
// muet : 'log' (tout) > 'warn' (avertissements + erreurs) > 'error' (erreurs
// seules) > 'silent' (rien).
//
// Le niveau vient de `µ._logLevel` (chaîne posée par le build, clé `logLevel`
// de mjs.config.json — cf. bundler/config.ts) ; absent, repli 'log' (jamais un
// silence par accident ; le manifeste le pose toujours). Défauts du build : dev 'log', prod 'error'.
//
// `µ.debug = true`, posé à la main dans la console, FORCE 'log' quel que soit
// ce réglage — l'échappatoire de mise au point survit au niveau configuré, EN
// DÉVELOPPEMENT, minifié ou non. En build de production minifié, le build réécrit la
// LECTURE ci-dessous en un identifiant libre que le minifieur pose à `false` (pas un
// define de `µ.debug`, cf. bundleRuntime, bundler/index.ts) : le branchement disparaît à la compilation, l'échappatoire
// console n'existe plus dans ce bundle-là (µ.debug reste assignable, mais plus lu nulle part).
//
// En PROD, au-dessus de 'log', le build retire du cœur les traces `µ.log(…)` et
// `µ._mjs_logger()?.(…)` avec leurs arguments, et l'aide `µ._mjs_logger` avec elles ;
// aux niveaux 'error' (le défaut) et 'silent', les appels `µ.warn(…)` du runtime aussi,
// au niveau 'silent' ses appels `µ.error(…)` quand le journal des erreurs n'est pas
// embarqué ; le minifieur retire enfin les appels `console.*` correspondants DU BUNDLE
// (cf. bundler/minify.ts, `cutRuntimeTraces` et `pure`, dépendant du niveau) — cette
// vérification de niveau reste utile en dev/non-minifié, où rien n'est retiré à la
// compilation, et pour les appels écrits par l'application, qui restent.
// ----------------------------------------------------------------------------
µ.debug = false;

var MJS_LOG_LEVEL_RANK = { log: 3, warn: 2, error: 1, silent: 0 };

var mjsLogLevel = function() {
  if (µ.debug) return 'log';
  return µ._logLevel || 'log';
};

µ.log = function(...args) {
  if (MJS_LOG_LEVEL_RANK[mjsLogLevel()] >= MJS_LOG_LEVEL_RANK.log) {
    if (_mjsMsgPend) { _mjsMsgNote('log', args); }
    console.log(...args);
  }
};

// `µ._mjs_logger()?.(…)` : µ.log quand le niveau laisse passer `log`, sinon rien ; l'appel optionnel ne calcule
// alors pas ses arguments ; garde des traces dont le texte coûte (µ._mjs_txt tire le texte de la table des
// messages) : coupée, une trace n'appelle pas µ._mjs_txt, ne pose aucun écouteur, n'inscrit aucune entrée
// d'attente, ne demande aucun fichier
// en PROD au-dessus de 'log' le build retire ces appels avec leurs arguments, puis cette aide, bornée par les
// repères ci-dessous (bundler/minify.ts, cutRuntimeTraces) ; une trace ne porte jamais d'effet de bord
// <trace-logger>
µ._mjs_logger = function() {
  return MJS_LOG_LEVEL_RANK[mjsLogLevel()] >= MJS_LOG_LEVEL_RANK.log ? µ.log : null;
};
// </trace-logger>

µ.warn = function(...args) {
  if (MJS_LOG_LEVEL_RANK[mjsLogLevel()] >= MJS_LOG_LEVEL_RANK.warn) {
    if (_mjsMsgPend) { _mjsMsgNote('warn', args); }
    console.warn(...args);
  }
};

µ.error = function(...args) {
  if (MJS_LOG_LEVEL_RANK[mjsLogLevel()] >= MJS_LOG_LEVEL_RANK.error) {
    if (_mjsMsgPend) { _mjsMsgNote('error', args); }
    console.error(...args);
  }
};

// Écriture d'attribut DÉFENSIVE pour les valeurs/clés DYNAMIQUES (binding
// `attr={…}`, spread `{...obj}` dont les clés/valeurs peuvent venir d'un objet
// non fiable réseau/API). Modèle ALLOW-LIST (l'ancienne denylist laissait passer
// `srcdoc` et `data:image/svg+xml`) :
//   - gestionnaires inline `on*` → refus (exécution JS) ;
//   - `srcdoc` (HTML inline d'iframe) → refus EN BLOC : sink HTML, pas une URL —
//     une valeur non fiable y exécute du script (cf. @html pour un opt-in
//     explicite et audité) ;
//   - attributs de type URL → seuls http(s)/mailto/tel passent (+ URL relative,
//     sans schéma). `javascript:`/`vbscript:`/`file:`… refusés PARTOUT ;
//     `data:`/`blob:` refusés sur les contextes EXÉCUTABLES/navigables
//     (iframe|frame|embed[src], object[data], a|area|base[href], action,
//     formaction, ping, codebase) mais TOLÉRÉS sur les contextes MÉDIA
//     (img/vidéo/audio/source/poster/background) où ils sont sûrs et idiomatiques
//     (aperçu base64, object-URL de fichier — un SVG chargé en <img> ne script pas).
// Symétrique du filtre `on*` de syncProps (sens entrant).
µ._mjs_URL_ATTRS = { href: 1, src: 1, 'xlink:href': 1, action: 1, formaction: 1, poster: 1, ping: 1, background: 1 };

// Schémas explicitement AUTORISÉS sur un attribut URL (allow-list). Tout autre
// schéma EXPLICITE (data:/blob:/javascript:/vbscript:/file:…) est filtré ; une URL
// SANS schéma (relative, `/x`, `#x`, `?x`, `//host`) ne matche pas → passe.
// Schémas TOUJOURS dangereux sur un attribut URL (exécution JS ou accès local) →
// refus partout. Denylist ciblée plutôt qu'allow-list étroite : une allow-list
// {http,https,mailto,tel} cassait silencieusement sms:/ftp:/geo:/webcal:/deep-links
// légitimes sans gain sécurité. srcdoc et data:/blob: en contexte
// exécutable restent filtrés séparément ci-dessous.
µ._mjs_DANGER_SCHEMES = { javascript: 1, vbscript: 1, file: 1 };

// Regex hoistées au module (évite recompilation par appel — chemin chaud des
// attributs dynamiques). `_mjs_ctrlCharRe` (flag `g`) sert à `replace` (reset de
// lastIndex garanti) ; `_mjs_schemeRe` (sans `g`) sert à `exec`, toujours depuis 0.
µ._mjs_ctrlCharRe = /[\x00-\x20]+/g;
µ._mjs_schemeRe = /^([a-z][a-z0-9+.\-]*):/;

// Contextes où un schéma data:/blob: devient EXÉCUTABLE ou navigable (le contenu
// est interprété comme document → scripts actifs, ou navigation top-level) — à
// distinguer des contextes MÉDIA (data:/blob: y sont inertes).
µ._mjs_isExecUrlAttr = function(nl, tn) {
  if (nl === 'action' || nl === 'formaction' || nl === 'ping' || nl === 'codebase') { return true; }
  // xlink:href (SVG <a>/<use>/<image>) : navigable/chargeable → traiter comme href.
  if (nl === 'xlink:href') { return true; }
  if (nl === 'src') { return tn === 'IFRAME' || tn === 'FRAME' || tn === 'EMBED' || tn === 'SCRIPT'; }
  if (nl === 'data') { return tn === 'OBJECT'; }
  if (nl === 'href') { return tn === 'A' || tn === 'AREA' || tn === 'BASE' || tn === 'SCRIPT'; }
  return false;
};

µ._mjs_safeAttr = function(node, name, value) {
  var nl = ('' + name).toLowerCase();
  // 1. Gestionnaire d'événement inline → refus INCONDITIONNEL de tout `on[a-z]…`.
  //    On NE teste PLUS `nl in HTMLElement.prototype` : les WindowEventHandlers
  //    (onbeforeunload/onmessage/onpopstate/onhashchange/onstorage/onunload…) n'y
  //    figurent pas mais restent des handlers actifs sur <body>/<frameset>.
  if (nl.length > 2 && nl.charCodeAt(0) === 111 && nl.charCodeAt(1) === 110) {
    var c3 = nl.charCodeAt(2);
    if (c3 >= 97 && c3 <= 122) { return; }
  }
  // 2. `srcdoc` = HTML inline d'iframe → refus EN BLOC (sink HTML, pas une URL).
  if (nl === 'srcdoc') {
    return;
  }
  // 3. Attribut de type URL → allow-list de schémas. `data`/`codebase` ne sont
  //    des URL que sur <object>/<applet>.
  var tn = ('' + (node.tagName || '')).toUpperCase();
  var isUrlAttr = µ._mjs_URL_ATTRS[nl] === 1;
  if (!isUrlAttr) {
    if (nl === 'data') { isUrlAttr = (tn === 'OBJECT'); }
    else if (nl === 'codebase') { isUrlAttr = (tn === 'OBJECT' || tn === 'APPLET'); }
  }
  if (isUrlAttr) {
    var clean = ('' + value).replace(µ._mjs_ctrlCharRe, '').toLowerCase();
    var m = µ._mjs_schemeRe.exec(clean);
    if (m) {
      var sc = m[1];
      // javascript:/vbscript:/file: → refus partout
      if (µ._mjs_DANGER_SCHEMES[sc] === 1) { return; }
      // data:/blob: → refus seulement sur contexte exécutable/navigable (inertes en média)
      if ((sc === 'data' || sc === 'blob') && µ._mjs_isExecUrlAttr(nl, tn)) { return; }
      // tout autre schéma (http/https/mailto/tel/sms/ftp/geo/webcal/deep-links…) : autorisé
    }
  }
  if (node.getAttribute(name) !== ('' + value)) { node.setAttribute(name, value); }
};

// `µ._mjs_isPageCached`/`µ._mjs_destroyEvictedTree` vivent désormais dans
// src/runtime/mjs_page_cache.ts, avec le reste du cache de pages routeur/UJS.

// ----------------------------------------------------------------------------
// Configuration runtime — surchargable par l'utilisateur via `µ.config.X = ...`
// avant le mount des composants, ou par injection du bundler à terme.
// ----------------------------------------------------------------------------
µ.config = {
  // Taille max du cache LRU des templates HTML parsés. Quand un {if}/{for} se
  // re-ouvre, on évite de re-parser la string HTML via ce cache. Default 1000 —
  // ~quelques MB en mémoire, suffit pour 99% des apps. Pour apps massives avec
  // beaucoup de templates dynamiques (interpolation × N items), monter à 2000+.
  // Référence : Svelte précompile tout, Vue cache par-composant illimité,
  // Lit n'a pas de cap. MJS borne car interpolation produit des strings uniques.
  templateCacheSize: 1000,

  // Branchement de la modale @confirm (mjs_ujs.ts, µ.confirm) : true (défaut) = modale maison
  // µ.modal.fire (mjs_modal.ts) ; false = window.confirm natif. SEULES valeurs supportées :
  // true/false — l'ancien branchement 'sweetalert2' (window.Swal)/classe-objet custom est
  // RETIRÉ (plus de porte de sortie vers un adaptateur externe). µ.confirm réassigné
  // directement par l'application reste le chemin pour du 100% custom, et prime toujours
  // sur cette clé. NB : la CLÉ ABSENTE (µ.config forgé à la main, runtime sans mjs_init)
  // reste traitée en natif par mjs_ujs.ts — ce défaut-ci est celui du µ.config livré.
  confirm: true,

  // Couche sonore (opt-in) des modales et notifications (µ.modal.fire/success/error/info/warn/
  // notify, __modalSound côté mjs_modal.ts) : false (défaut) = silence total ; true = signatures
  // WebAudio embarquées (notes synthétiques courtes, une par type success/error/warning/info/
  // notify — AudioContext créé PARESSEUSEMENT au premier son, puis réutilisé) ; objet
  // `{success:'/x.mp3', ...}` = fichier PAR TYPE (`new Audio(url).play()`), type absent de
  // l'objet → repli sur la signature embarquée. Un `sound` passé à UN APPEL précis
  // (`fire({sound:...})`/`notify(msg,{sound:...})`) prime toujours sur cette clé globale. Toute
  // erreur du chemin son (politique autoplay du navigateur, AudioContext absent) reste MUETTE —
  // jamais une erreur, jamais un warning pour un simple son qui ne joue pas.
  modalSound: false,

  // Plafond des toasts AFFICHÉS simultanément (µ.modal.notify, mjs_modal.ts) — façon « succès
  // Steam » : au-delà, les nouveaux toasts ATTENDENT EN FILE (FIFO) et s'affichent quand une
  // place se libère, ZÉRO éviction (un toast déjà affiché n'est jamais chassé). Défaut 5 ;
  // `false`/`0`/`Infinity` = pas de plafond NUMÉRIQUE — la place réellement disponible à l'écran
  // borne quand même la pile (mjs_modal.ts) : le surplus attend en file. Relu à CHAQUE
  // affichage — un changement à chaud s'applique au prochain toast à afficher, jamais rétroactif
  // sur ceux déjà affichés ou déjà en file.
  notifyMax: 5,

  // Position du conteneur de toasts (µ.modal.notify, mjs_modal.ts) — 8 préréglages ('top-right'
  // défaut, 'top-left', 'bottom-right', 'bottom-left', et leurs variantes 'quarter-*' ancrées à
  // 25% du bord haut/bas plutôt que collées au coin) OU un objet de longueurs CSS parmi
  // `{top, right, bottom, left}` pour un placement libre (posé en custom properties, jamais de
  // style en dur). Valeur inconnue → µ.warn + repli 'top-right'. Comme `notifyMax`, RELUE à
  // CHAQUE affichage réel : un changement à chaud déplace le conteneur COURANT (donc les toasts
  // déjà affichés avec) et s'applique aux suivants.
  notifyPosition: 'top-right',

  // Sens du FLUX des toasts (µ.modal.notify, mjs_modal.ts) — l'ordre d'empilement, à ne pas
  // confondre avec le sens de CROISSANCE de la pile, dicté lui par l'ancrage : 'up' = le nouveau
  // toast arrive AU-DESSUS des précédents, 'down' = en dessous, 'auto' (défaut) = ce que dit le
  // préréglage de position (les ancrages bas empilent vers le haut, les autres vers le bas). Sert
  // surtout au placement libre `{top, bottom, …}`, qui n'a pas de préréglage pour le décider.
  // Comme notifyMax et notifyPosition : relu à CHAQUE affichage réel, valeur inconnue → warn + 'auto'.
  notifyFlow: 'auto',

  // Durée de vie par défaut d'un toast en ms (µ.modal.notify, mjs_modal.ts) — `opts.duration` d'un
  // appel précis prime toujours sur cette clé globale ; `0` reste permanent (aucun retrait auto,
  // aucune barre de vie), quelle que soit la source (config ou appel).
  notifyDuration: 4000,

  // Pause du décompte d'un toast (µ.modal.notify, mjs_modal.ts) : `true` (défaut) = tant que le pointeur (souris, stylet) survole
  // le toast ou que le focus est dedans, le minuteur de fermeture et la barre de vie s'arrêtent, puis repartent avec le temps
  // RESTANT ; `false` = le décompte continue quoi qu'il arrive. `opts.pause` d'un appel précis (booléen) prime toujours sur cette
  // clé globale ; toute valeur non booléenne vaut l'absence d'option (ici : `true`). Relue à CHAQUE appel de notify(). Un toast
  // permanent (`duration: 0`) n'a rien à figer.
  notifyPause: true,

  // Glisser pour fermer (µ.modal.notify, mjs_modal.ts) : `true` (défaut) = on tire le toast à l'horizontale (doigt, souris, stylet)
  // et, lâché au-delà d'un seuil (distance ou lancer) dans le sens de l'ancrage de la pile, il sort de l'écran en glissant puis se
  // ferme comme par la croix ; en deçà il revient. `false` = rien de tout cela (ni geste, ni touch-action, ni pointerdown retenu).
  // `opts.swipe` d'un appel précis (booléen) prime toujours sur cette clé globale ; toute valeur non booléenne vaut l'absence
  // d'option (ici : `true`). Relue à CHAQUE appel de notify().
  notifySwipe: true,

  // La barre de navigation (mjs_nav_progress.ts) — un trait de lumière en haut de la page quand
  // un lien, un formulaire ou une page du routeur met du temps : `true` (défaut) = après 500 ms ; un
  // nombre = ce seuil en ms ; `{ delay, place }` (place : 'top', 'bottom') ; `false` = jamais.
  // L'allure se règle en CSS (variables --mjs-nav-progress-color/-height/-speed/-zindex).
  navProgress: true,

  // Politique du veilleur flash/error (µ._mjs_navFlash, mjs_ujs.ts) sur les sacs de props serveur qui
  // entrent au magasin depuis la navigation (nominal/none/422/1er chargement) : 'popup' (défaut) =
  // µ.modal.notify/µ.modal.error (mjs_modal.ts — repli alert/console si le module 'modal' est absent
  // du build) ; 'console' = console.info/console.error ; fonction `(type, message) => …` (type
  // 'flash'|'error') = affichage 100% custom ; false = veilleur COUPÉ (props.flash/props.error NON
  // consommés, µ.res les porte tels quels). Un attribut `mjs-flash` sur l'élément d'origine (lien/
  // formulaire) prime toujours sur cette clé globale.
  flash: 'popup',

  // Que faire quand AUCUNE route d'AUCUN composant routé ne matche l'URL (cf.
  // mjs_router.ts, `_mjs_checkNoMatch`) : 'error' (défaut) = message console + panneau
  // « Page introuvable » à l'écran ; 'warn' = console seule, vues vides ;
  // 'silent' = trace de debug seulement. Déclarer une route de repli
  // (`'/*': 'not-found-page'`) rend le cas inatteignable — c'est la voie
  // recommandée pour servir sa propre page 404.
  routeNotFound: 'error',

  // Directive @title (bulle d'infobulle universelle sur n'importe quelle balise, cf.
  // mjs_title.ts) : délai d'apparition en ms (annulé si la souris/le focus quitte avant),
  // côté préféré 'top'/'bottom' (bascule automatique si la place manque), durée de transition
  // en ms (posée en variable CSS --mjs-title-dur sur la bulle) et type de transition ('fade' =
  // opacité seule, 'slide' = opacité + léger décalage). `@title="texte"` seul suffit déjà (ces
  // 4 réglages ont leurs propres défauts) — cette clé ne fait qu'ajuster le comportement
  // GLOBAL ; `@title={ delay: …, side: … }` sur un élément précis (mjs-title-conf) prime
  // toujours sur elle. Couleurs/rayon/ombre/décalage restent CSS pur (variables
  // --mjs-title-{bg,fg,radius,pad,shadow,offset}, cf. µ._mjs_titleSheet) — pas de clé JS pour
  // ceux-là, la personnalisation visuelle passe par le SASS du composant.
  title: { delay: 400, side: 'top', dur: 150, transition: 'fade' },

  // Étage CLIENT du journal d'erreurs 3 étages (mjs_journal.ts, module optionnel
  // 'journal') : `false` (défaut) = module INERTE — aucun écouteur posé, rien n'est jamais
  // envoyé, même si le module est bundlé (`runtime: [...,'journal']`/'all'). `true` : écoute
  // error + unhandledrejection + un enrobage de µ.error (le console.error d'origine
  // reste appelé EN PLUS), déduplique par signature, plafonne à 20 envois par session, poste
  // sur `POST /__mjs/errors` (sendBeacon, repli fetch keepalive) — encore FAUT-IL que le
  // serveur accepte ces envois (`journal.client` de mjs.config.json, défaut false lui aussi :
  // les DEUX portes, client ET serveur, doivent être ouvertes). Toute erreur DANS ce veilleur
  // reste muette (jamais de crash en cascade pour un outil de diagnostic).
  journal: false
};

// libellés du runtime (src/runtime-labels.ts) posés par le manifest en TOUTES langues
// (`µ._runtimeLabels = { fr: {…}, en: {…} }`) : la langue se choisit ICI, à l'affichage, jamais au build —
// un site basculé en anglais montrait des toasts « Succès »/« Erreur ».
// CORRECTIF d'ordre : la langue DEMANDÉE au store (`µlang`, µ._mjs_storeRaw.__mjsLang)
// prime désormais sur la langue EFFECTIVE du module i18n (µ._mjs_i18nEffectiveLang, mjs_i18n.ts) — un toast
// tiré dans le MÊME TICK qu'un clic « EN » sortait encore en français, `µ._mjs_i18nEffectiveLang()` restant
// sur l'ancienne langue tant que le swap asynchrone n'a pas fini d'assurer les fragments de la
// langue cible. Ordre complet : store (`__mjsLang`) → langue effective i18n
// → `<html lang>` → langue de repli du build (`µ._runtimeLabelsLang` = i18n.default du projet, sinon
// clé `lang` du CLI). Langue inconnue de la table (de, es…) → repli sur celle du build, puis en, puis
// fr. `µ._mjs_label` consulte D'ABORD le dictionnaire du PROJET (`µ._mjs_i18nLookup`, mjs_i18n.ts) sur la clé
// racine réservée `mjs.<groupe>.<clé>` (`mjs.toast.success`, `mjs.modal.cancel`…) — une chaîne trouvée
// là l'emporte sur cette table entière, cf. docs/29-i18n.md « Libellés du framework ».
µ._mjs_labelLang = function() {
  var l = (µ._mjs_storeRaw && µ._mjs_storeRaw.__mjsLang) || (typeof µ._mjs_i18nEffectiveLang === 'function' && µ._mjs_i18nEffectiveLang()) || (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || µ._runtimeLabelsLang || '';
  return String(l).toLowerCase().split('-')[0];
};
µ._mjs_label = function(group, key) {
  var fromProject = typeof µ._mjs_i18nLookup === 'function' ? µ._mjs_i18nLookup('mjs.' + group + '.' + key) : undefined;
  if (typeof fromProject === 'string') { return fromProject; }
  var all = µ._runtimeLabels;
  if (!all) { return undefined; }
  var tbl = all[µ._mjs_labelLang()] || all[µ._runtimeLabelsLang] || all.en || all.fr;
  return (tbl && tbl[group]) ? tbl[group][key] : undefined;
};
// message que le framework écrit dans la console du navigateur (avertissement, erreur levée) : texte
// du groupe `err` de la table (clé `dev.xxx` = groupe `dev`), dans la langue courante, surchargeable
// par `mjs.err.<clé>` dans les dictionnaires du site. `fr` = texte français de secours, rendu tel quel
// quand la table manque ; `{nom}` est remplacé par `vars.nom`, une accolade sans variable reste
// intacte ({for}, {if}…). `_mjs_msg` pose le préfixe [ModularJS], identique dans toutes les langues ;
// `_mjs_txt` rend le texte seul (morceau d'un message à plusieurs arguments). Ne lève jamais : au
// pire, le texte de secours (ou la clé).
// EN PRODUCTION le groupe `err` n'est pas au manifeste : il vit dans un fichier par langue
// (`µ._msgUrls`, posé par le build), chargé une seule fois, et seulement quand un message est
// réellement ÉCRIT (µ.log/warn/error au niveau courant) ou qu'une erreur du framework atteint la page
// sans être attrapée (événements `error` / `unhandledrejection` de window, écoutés dès la première
// inscription). `_mjs_txt` rend alors un texte court (clé + variables, `clé {}` sans variables) et se
// contente d'inscrire l'entrée dans une table d'attente (50 entrées, 10 appels notés chacune) : une
// trace coupée ne télécharge donc rien — le build la retire avec ses arguments au-dessus de 'log', et les traces
// qui tirent un texte de la table (routeur, UJS) sont gardées par µ._mjs_logger, qui n'évalue pas leur texte
// quand le niveau les coupe, même sans minification. Au niveau 'log' ces traces écrivent : le build pose leur texte au
// manifeste (groupe `err` réduit à ces textes, bundler/minify.ts), elles sortent en texte tout de suite, dans l'ordre. À l'arrivée
// du fichier, chaque appel noté est rejoué une fois, même niveau, mêmes arguments, texte complet ; une
// erreur levée sans appel noté sort par µ.error. Toutes les entrées de la langue quittent la table,
// résolues ou non, à l'arrivée comme à l'échec ; un échec ne relance rien avant 30 s. Sans `document` ni
// `fetch` (prérendu, Node) : texte court, aucune inscription.
// état par langue : absent = jamais demandé, Infinity = chargé, 1 = en cours, sinon date de l'échec
var _mjsMsgLoads = {};
var _mjsMsgWait  = new Map();
var _mjsMsgPend  = 0;
// un appel à µ.log/warn/error dont un argument (chaîne, ou erreur par son `message` : crash d'un
// composant intercepté) contient un texte court en attente : niveau et arguments sont notés, pour être
// rejoués avec le texte complet (même niveau, même préfixe)
function _mjsMsgNote(lvl, args) {
  var call = [lvl, args];
  _mjsMsgWait.forEach(function(w, s) {
    if (!args.some(function(a) { return (a?.message || a)?.indexOf?.(s) >= 0; })) { return; }
    if (w.c.length < 10) { w.c.push(call); }
    _mjsMsgAsk(w);
  });
}
// texte d'une valeur quelconque, sans jamais lever : `String` écrit aussi un Symbol (une concaténation `+ ''` lève sur
// lui) ; un objet sans prototype, qui n'a ni toString ni valueOf, donne un texte vide
function _mjsMsgStr(a) {
  try { return String(a); } catch { return ''; }
}
// une erreur non attrapée qui porte un texte court en attente : l'entrée est « levée »
function _mjsMsgHear(e) {
  var m = _mjsMsgStr(e.message || e.error?.message || e.reason?.message || e.reason);
  _mjsMsgWait.forEach(function(w, s) { if (m.indexOf(s) >= 0) { w.t = 1; _mjsMsgAsk(w); } });
}
// texte complet d'une entrée : les morceaux en attente dans ses variables sont résolus d'abord
// (et ne s'écrivent plus seuls), sur une copie — l'objet de l'appelant, peut-être gelé, reste le sien
function _mjsMsgFull(e) {
  var v = Object.assign({}, e.v);
  for (var n in v) {
    var p = _mjsMsgWait.get(v[n]);
    if (p) { p.p = 1; v[n] = _mjsMsgFull(p); }
  }
  return µ._mjs_txt(e.k, v);
}
function _mjsMsgDone(lang, ok, err) {
  var keys  = [];
  var text  = {};
  var calls = [];
  _mjsMsgWait.forEach(function(w, s) { if (w.l === lang) { keys.push(s); } });
  _mjsMsgLoads[lang] = ok ? Infinity : Date.now();
  if (ok) {
    var all = µ._runtimeLabels = µ._runtimeLabels || {};
    (all[lang] = all[lang] || {}).err = err;
    keys.sort(function(x, y) { return y.length - x.length; }).forEach(function(s) {
      var e = _mjsMsgWait.get(s);
      if ((text[s] = _mjsMsgFull(e)) === s) { return; }
      if (e.c.length) { calls.push(...e.c); }
      else if (e.t && !e.p) { calls.push(['error', [(e.m ? '[ModularJS] ' : '') + text[s]]]); }
    });
  }
  keys.forEach(function(s) { _mjsMsgWait.delete(s); });
  _mjsMsgPend = _mjsMsgWait.size ? 1 : 0;
  // texte d'un argument par _mjsMsgStr : un Symbol ou un objet sans prototype n'arrête plus le rejeu
  var full = function(a) { return keys.reduce(function(t, s) { return t.split(s).join(text[s]); }, _mjsMsgStr(a)); };
  calls.forEach(function(c) {
    if (c.d) { return; }
    c.d = 1;
    // une erreur passée en objet est rejouée par son texte ; le bandeau fatal qu'elle a posé dans la page suit
    µ[c[0]](...c[1].map(function(a) {
      if (a?._mjs_fatal) { a._mjs_fatal.textContent = 'Fatal Error: ' + full(a.message); }
      var t = full(a);
      return typeof a === 'string' || (a?.message && t !== _mjsMsgStr(a)) ? t : a;
    }));
  });
}
function _mjsMsgAsk(w) {
  var at = _mjsMsgLoads[w.l];
  if (at < 2 || Date.now() - at < 30000) { return; }
  _mjsMsgLoads[w.l] = 1;
  new Promise(function(r) { r(fetch(w.u)); }).then(function(r) { return r.ok ? r.json() : Promise.reject(r); }).then(function(err) {
    _mjsMsgDone(w.l, 1, err);
  }, function() { _mjsMsgDone(w.l); });
}
// langue du fichier de messages à servir : la courante, sinon celle du projet, sinon en, sinon fr
function _mjsMsgLang() {
  return [µ._mjs_labelLang(), µ._runtimeLabelsLang, 'en', 'fr'].filter(function(l) { return Object.prototype.hasOwnProperty.call(µ._msgUrls, l); })[0];
}
// <msg-idle>
// réglage `messages: 'idle'` : le build ajoute `µ._msgIdle()` au manifeste, qui télécharge le fichier de
// la langue courante une fois la page affichée et au repos ; bloc retiré du cœur sans ce réglage
var _mjsMsgIdle = 0;
µ._msgIdle = function() {
  if (_mjsMsgIdle++ || typeof document === 'undefined' || typeof fetch !== 'function') { return; }
  var go = function() {
    try {
      var lang = _mjsMsgLang();
      if (lang) { _mjsMsgAsk({ l: lang, u: µ._msgUrls[lang] }); }
    } catch { }
  };
  var rest = function() { window.requestIdleCallback ? window.requestIdleCallback(go) : setTimeout(go, 200); };
  document.readyState === 'complete' ? rest() : window.addEventListener('load', rest);
};
// </msg-idle>
µ._mjs_txt = function(key, vars, fr, msg) {
  var txt = typeof fr === 'string' ? fr : String(key);
  try {
    var dot = String(key).indexOf('.');
    var grp = dot < 0 ? 'err' : key.slice(0, dot);
    var t   = µ._mjs_label(grp, dot < 0 ? key : key.slice(dot + 1));
    if (typeof t === 'string') { txt = t; }
    else if (grp === 'err' && µ._msgUrls) {
      txt = String(key);
      try { txt += ' ' + JSON.stringify(vars || {}); } catch { txt += ' {}'; }
      try {
        var urls = µ._msgUrls;
        var lang = _mjsMsgLang();
        var at   = _mjsMsgLoads[lang];
        if (lang && typeof document !== 'undefined' && typeof fetch === 'function' && !(Date.now() - at < 30000) && !_mjsMsgWait.has(txt)) {
          if (_mjsMsgWait.size > 49) { _mjsMsgWait.delete(_mjsMsgWait.keys().next().value); }
          _mjsMsgWait.set(txt, { k: key, v: vars, c: [], m: msg, l: lang, u: urls[lang] });
          if (!_mjsMsgPend) {
            window.addEventListener('error', _mjsMsgHear);
            window.addEventListener('unhandledrejection', _mjsMsgHear);
          }
          _mjsMsgPend = 1;
        }
      } catch { }
      return txt;
    }
    return txt.replace(/\{(\w+)\}/g, function(m, n) { return (vars && Object.prototype.hasOwnProperty.call(vars, n)) ? String(vars[n]) : m; });
  }
  catch { return txt; }
};
µ._mjs_msg = function(key, vars, fr) {
  return '[ModularJS] ' + µ._mjs_txt(key, vars, fr, 1);
};

// ----------------------------------------------------------------------------
// V2 rewrite : helpers compile-time pour la suppression du Proxy.
// Le générateur transforme `$.x = y` en `µ._set(this, 'x', y)`. Cette fonction
// délègue à `el._set` qui contient la logique d'assignation + invalidation.
// Idem pour `µ._mjs_setComputed` (computed wrappers détectés par l'analyzer AST).
// ----------------------------------------------------------------------------
µ._set = function(el, k, v) {
  return el._set(k, v);
};

// ----------------------------------------------------------------------------
// Props posées par un parent sur un enfant PAS ENCORE mis à niveau : retenues
// HORS de l'instance, dans un registre indexé par l'élément.
// Un enfant pas encore défini n'a ni `_set` ni `_mjs_var_bits`, et ses noms courts
// de production sont inconnus du parent : une clé venue d'une donnée
// d'exécution (JSON reçu, étalement `{...$data}`) qui tombe sur le nom court
// d'une méthode du prototype la MASQUE sur l'instance — « this.o is not a
// function » à la mise à niveau, composant vide. Le registre garde la valeur
// jusqu'au montage (cf. connectedCallback, mjs_element.ts), qui la verse dans
// l'état par `_set` — le chemin exact d'un enfant déjà défini.
// WeakMap : un enfant dont la balise n'est jamais définie part avec ses
// entrées, sans rien retenir.
// ----------------------------------------------------------------------------
µ._mjs_pending = new WeakMap();

// Clés déjà refusées par un élément tiers (élément → clés), pour ne pas répéter le même
// avertissement à chaque re-rendu du parent.
µ._mjs_ro = new WeakMap();

µ._mjs_pend = function(el, k, v, attr) {
  // `__proto__`/`constructor`/`prototype` : refusées AVANT tout, élément tiers compris — ces
  // noms-là ne s'écrivent sur aucun élément (CWE-1321).
  if (!µ._mjs_safeKey(k)) return;
  // élément TIERS : il porte SES noms, jamais ceux du framework — la prop reste une propriété
  // propre (une bibliothèque tierce la lit à sa mise à niveau), comportement d'avant le registre.
  // Liaison à deux sens (`attr`) : une balise que le manifeste dit étrangère au projet reçoit un ATTRIBUT,
  // texte ou JSON pour un objet, comme toute balise qui n'est pas un composant. Sans manifeste, une balise
  // définie mais pas encore mise à niveau (ligne de `{for}`) reste prise pour un élément tiers : sa
  // propriété propre, TYPÉE, est reprise à la mise à niveau, un attribut la ferait relire en chaîne.
  // Un composant DU PROJET va au registre : le manifeste (`µ.paths`, clé = nom sans le préfixe
  // `mjs-`) le reconnaît, qu'il soit déjà défini ou non — une ligne de `{for}` est peuplée avant
  // son insertion, donc avant la mise à niveau, même quand la balise est définie depuis
  // longtemps. Une balise `mjs-` absente du manifeste est un web component tiers (cas documenté,
  // docs/15). Clé CHERCHÉE EN PROPRE : `µ.paths` est un objet ordinaire, `µ.paths['constructor']`
  // répondait l'héritage d'Object — `<mjs-constructor>` passait pour un composant du projet.
  // Sans manifeste (harnais, rendu serveur), repli : le préfixe, sauf balise déjà
  // définie — un composant du projet, lui, n'arrive jamais ici une fois défini ET mis à niveau.
  var n = el.localName || (el.tagName || '').toLowerCase();
  var duProjet = n.slice(0, 4) === 'mjs-' && (µ.paths ? Object.prototype.hasOwnProperty.call(µ.paths, n.slice(4)) : !customElements.get(n));
  if (!duProjet) {
    if (attr && µ.paths) {
      v = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (el.getAttribute(k) !== v) { el.setAttribute(k, v); }
      return;
    }
    // propriété en LECTURE SEULE sur l'élément tiers (une page peut figer `value` par
    // Object.defineProperty) : l'écriture LÈVE en mode strict, et l'exception partirait du rendu
    // du PARENT — frontière d'erreur, hôte vidé. On prévient une fois par élément et par clé,
    // la valeur posée par la page reste.
    try {
      el[k] = v;
    }
    catch {
      var vues = µ._mjs_ro.get(el);
      if (!vues) {
        vues = Object.create(null);
        µ._mjs_ro.set(el, vues);
      }
      if (!vues[k]) {
        vues[k] = true;
        µ.warn(µ._mjs_msg('initReadOnly', { tag: n, prop: k }, '<{tag}> : propriété « {prop} » en lecture seule, valeur ignorée.'));
      }
    }
    return;
  }
  // propriété propre du même nom : la page (ou un parent d'hier) l'a posée AVANT cette
  // écriture-ci. Le montage verse le registre PUIS les propriétés propres — sans ce retrait,
  // une valeur périmée gagnerait sur la plus récente. Retirée ici, une propriété propre
  // présente à la mise à niveau est forcément postérieure : l'ordre redevient chronologique.
  // Une propriété NATIVE (`id`, `title`, `dir`) vit sur le prototype, jamais sur l'élément :
  // rien à retirer, elle passe par le registre comme les autres.
  // Retrait SEULEMENT si le descripteur l'autorise : `delete` d'une propriété propre non
  // configurable LÈVE en mode strict (une page peut la figer par Object.defineProperty), et
  // l'exception partirait du rendu du PARENT — frontière d'erreur, parent vidé, enfant jamais
  // monté. Figée, elle reste et gagne à la mise à niveau, comme toute propriété propre.
  var d = Object.getOwnPropertyDescriptor(el, k);
  if (d && d.configurable) { delete el[k]; }
  var m = µ._mjs_pending.get(el);
  if (!m) {
    m = Object.create(null);
    µ._mjs_pending.set(el, m);
  }
  m[k] = v;
};

// Path-tracking compile-time avec auto-Proxy fallback.

// Clé UNIQUE issue d'une source non fiable (attribut de balise, réhydratation SSR d'un JSON de page,
// pièges des enveloppes réactives) : bloque `__proto__`/`constructor`/`prototype`.
µ._mjs_safeKey = function(k) {
  return k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
};

// Clé Symbol d'accès à la cible BRUTE d'un Proxy réactif (cf. get trap de
// _mjs_wrapDeep). Permet à µ._mjs_deepSet/µ._mjs_deepCall de naviguer et muter SANS repasser
// par le set trap — qui notifierait une 2e fois, en plus de la notif explicite.
µ._mjs_RAW = Symbol('mjs_raw');

// RECONNAISSANCE DES ENVELOPPES (mort de la boucle two-way inter-
// composants). `µ._mjs_toRaw` déballe une chaîne de Proxy réactifs (le SIEN comme
// celui d'un AUTRE composant/rune/store — tous répondent à µ._mjs_RAW) jusqu'à la
// cible brute : un filet qui reçoit l'enveloppe d'un pair retrouve ainsi la
// MÊME cible que celle déjà connue de son propre carnet (_mjs_proxyCache indexé
// par target), au lieu d'empiler un Proxy-de-Proxy à chaque frontière — c'est
// cet empilement qui cassait l'identité et faisait repartir le ping-pong.
// Boucle (pas un seul niveau) : une chaîne héritée peut être imbriquée. Le symbole se lit une fois par niveau : sur une
// enveloppe, chaque lecture passe par son piège `get`
µ._mjs_toRaw = function(o) {
  var r;
  while (o != null && typeof o === 'object' && (r = o[µ._mjs_RAW])) o = r;
  return o;
};

// valeur RANGÉE dans un état (affectation) : déballée. Un objet est rangé tel quel, jamais copié ni parcouru : ses
// accesseurs restent des accesseurs, deux variables qui le reçoivent le partagent, une donnée neuve ou profonde (réponse
// JSON, liste chaînée) ne coûte rien — une liste rangée DANS un objet garde les enveloppes reçues. Une liste qui en
// tient (`l = l.filter(…)`, `[...l, x]` : éléments lus par l'enveloppe) est rangée par une copie de ses données brutes,
// faite à chaque affectation : la liste de l'auteur reste intacte, une liste gelée donne une copie gelée. Une liste
// µraw est rangée telle quelle
µ._mjs_rawIn = (v) => {
  v = µ._mjs_toRaw(v);
  if (!Array.isArray(v) || µ._mjs_rawSet.has(v) || !v.some((e) => e !== µ._mjs_toRaw(e))) return v;
  const c = v.map(µ._mjs_toRaw);
  return Object.isFrozen(v) ? Object.freeze(c) : c;
};

// propriété FIGÉE de `o` : propre, ni modifiable ni configurable — la règle des Proxy exige que la lire par une
// enveloppe rende SA valeur (une enveloppe ou une méthode liée fait lever le moteur). Appelée seulement quand la valeur
// lue est un objet ou une fonction : une primitive ne paie rien. Un objet ouvert aux ajouts, le cas courant, ne paie
// qu'un test ; ses propriétés figées par `Object.defineProperty` ne sont pas vues (limite écrite, docs/03)
µ._mjs_fixed = (o, k) => !Object.isExtensible(o) && (k = Object.getOwnPropertyDescriptor(o, k)) !== void 0 && k.writable === false && k.configurable === false;

// méthode d'une collection réactive qui ne la modifie pas, commune à l'état d'un composant (mjs_element.ts), à
// µ.state et à µ.Store : `o` la collection brute, `k` la méthode, `f` sa fonction, `p` l'enveloppe, `w` enveloppe
// une valeur lue. Liste : `indexOf`, `lastIndexOf`, `includes` cherchent l'élément déballé dans la liste brute —
// l'objet poussé se retrouve, tenu brut ou par son enveloppe ; une liste rangée dans un objet, qui tient ses éléments
// par leur enveloppe, ne les y retrouve pas. Le reste lit par l'enveloppe (`find`, `findIndex`… : un appel du
// prédicat par élément, tel que l'état le rend). Map / Set : ce qui en sort (`get`, `forEach`, `values`, `entries`,
// `for…of`) est enveloppé, les clés d'une Map restent brutes ; `has` retrouve aussi ce qu'on tient par son enveloppe
µ._mjs_readFn = (o, k, f, p, w) => {
  if (Array.isArray(o)) {
    return /^(lastI|i)ndexOf$|^includes$/.test(String(k)) ? (x, ...r) => f.call(o, µ._mjs_toRaw(x), ...r) : f.bind(p);
  }
  if (o instanceof Map || o instanceof Set) {
    // itérateur qui ré-enveloppe : valeurs, ou entrées [clé, valeur] (clé d'une Map brute)
    const s = o instanceof Set, it = (n) => function* () { for (const x of f.call(o)) yield n ? [s ? w(x[0]) : x[0], w(x[1])] : w(x); };
    return k === 'get' ? (x) => w(f.call(o, x))
      : k === 'has' ? (x) => f.call(o, x) || f.call(o, µ._mjs_toRaw(x))
      : k === 'forEach' ? (t, h) => f.call(o, (v, x) => t.call(h, w(v), s ? w(x) : x, p))
      : k === 'values' || (s && (k === 'keys' || k === Symbol.iterator)) ? it(0)
      : k === 'entries' || k === Symbol.iterator ? it(1)
      : f.bind(o);
  }
  return f.bind(o);
};

// Époque de mutation PAR OBJET BRUT (WeakMap globale, O(1), zéro comparaison
// de contenu). Sert à distinguer un ÉCHO pur (le pair renvoie l'objet qu'on
// vient nous-même de muter, rien de neuf à propager) d'une mutation RÉELLE
// survenue entre-temps côté pair (deux composants frères sur le même objet,
// chaîne A→B→C…) : le CÔTÉ MUTANT bump son époque et la mémorise localement
// (_mjs_bindEpochs) ; un `_set` qui reçoit le MÊME objet brut compare l'époque
// courante à celle mémorisée — égales ⇒ écho, on avale en silence.
µ._mjs_epochs = new WeakMap();
µ._mjs_bumpEpoch = function(raw) {
  const e = (µ._mjs_epochs.get(raw) || 0) + 1;
  µ._mjs_epochs.set(raw, e);
  return e;
};

// Helper snapshot shallow par type (Array/Map/Set/plain object) — clone juste
// le top-level container pour permettre l'affichage du `From` dans µ.inspect.
µ._mjs_snap = function(v) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Map) return new Map(v);
  if (v instanceof Set) return new Set(v);
  if (typeof v === 'object') return {...v};
  return v;
};

µ._mjs_setComputed = function(el, k, fn) {
  return el._mjs_setComputed(k, fn);
};

// ----------------------------------------------------------------------------
// computeLISIndices — Longest Increasing Subsequence (algo standard, O(n log n)).
//
// Utilisé par `_mjs_reconcileList` pour minimiser les `insertBefore` lors d'un
// reorder de liste keyed. Les items dont l'index est dans la LIS gardent leur
// position naturelle (zéro DOM op) ; les autres sont déplacés.
//
// Entrée : tableau d'index `oldPosArr[i]` = position dans l'ancien ordre, ou
// `-1` pour les nouveaux items. Les `-1` sont ignorés (toujours insérés).
//
// Sortie : Set des indices i dont oldPosArr[i] fait partie de la LIS.
//
// Référence : algorithme classique avec binary search dans tails. Utilisé par
// Svelte 3-5, Vue 3, React Fiber. ~50 LOC.
// ----------------------------------------------------------------------------
µ._mjs_lis = function(arr) {
  const n = arr.length;
  if (n === 0) return new Set();
  // tails[k] = index dans arr de l'item finissant la LIS de longueur (k+1)
  //            avec la plus petite valeur possible.
  const tails = [];
  // parents[i] = prédécesseur de arr[i] dans la LIS qui se termine à i.
  const parents = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v === -1) continue;  // skip new items
    // Binary search : position où v s'insérerait dans `tails` (par valeur).
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[tails[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    // Le predecessor est l'item finissant la LIS de longueur lo (= tails[lo-1])
    if (lo > 0) parents[i] = tails[lo - 1];
    tails[lo] = i;
  }
  // Reconstruction de la LIS depuis le dernier index trouvé.
  const result = new Set();
  if (tails.length === 0) return result;
  let curr = tails[tails.length - 1];
  while (curr !== -1) {
    result.add(curr);
    curr = parents[curr];
  }
  return result;
};

// µ._buildTemplate et µ._mjs_tplCache SUPPRIMÉS.
// Le compile-time produit désormais des fonctions __create_X() impératives
// qui construisent le DOM directement via document.createElement, sans passer
// par un template HTML ni par un cloneNode. Le cache de template parsé n'a
// plus de raison d'être (la fn est déjà compilée par V8 après le 1er call).

// `µ.LRUCache` vit désormais dans src/runtime/mjs_page_cache.ts (marqueurs
// `extrait-test LRUCache` déplacés avec elle).

// DocumentFragment réutilisable (pool singleton).
//
// `_mjs_reconcileList` accumule des moves dans un DocumentFragment puis fait UN
// seul `insertBefore(frag, anchor)`. Le browser vide automatiquement le
// fragment après cette insertion (move semantics), donc on peut le réutiliser
// indéfiniment sans le recréer. Gain ~1-3ms cumulé sur reorders fréquents
// (évite alloc + pression GC).
//
// Lazy-initialisé dans le premier _mjs_reconcileList qui en a besoin.
µ._mjs_reusableFragment = null;

// Flag global de détection de cascade.
//
// `_mjs_invalidate` peut prendre un fast-path sync direct si une seule var est
// muée. Ce flag empêche les cascades infinies : si un effect mute une autre
// var pendant son exécution, le 2e `_mjs_invalidate` détecte `_mjs_inEffect === true`
// et bascule en microtask (comportement V1).
µ._mjs_inEffect = false;

// <boucles>
// Rendus d'une boucle regroupés (generator/loop-batch.ts) : le compilateur enveloppe une boucle qui écrit l'état,
// `µ._mjs_lq++; try { … } finally { --µ._mjs_lq || µ._mjs_lqF() }`. Tant qu'une boucle tourne, une écriture qui
// redessinerait tout de suite les textes et attributs d'une variable qui ne pilote aucun bloc et ne pose aucune prop
// d'un composant enfant (voie directe de `_mjs_invalidate`, mjs_element.ts) attend : le composant note le nom (`_mjs_lqk`) et entre une fois dans la file
// `µ._mjs_lqq`. La sortie de la boucle la plus extérieure prévient chaque composant de la file, une fois par nom noté,
// par le chemin ordinaire d'une écriture : textes et attributs à jour avant l'instruction qui suit la boucle, blocs et
// reffets à leur heure habituelle. La file est relevée avant d'être jouée (une boucle jouée pendant la vidange a la
// sienne) ; un composant qui lève n'arrête pas les suivants, son erreur sort en microtâche. Bloc gardé au cœur des seules
// applis dont le compilateur a enveloppé une boucle (bundler/index.ts)
µ._mjs_lq = 0;
µ._mjs_lqq = [];
µ._mjs_lqF = function() {
  var q = µ._mjs_lqq;
  µ._mjs_lqq = [];
  for (var i = 0; i < q.length; i++) {
    var el = q[i], ks = el._mjs_lqk;
    el._mjs_lqk = null;
    try {
      ks.forEach(function(k) { el._mjs_invalidate(k); });
    } catch (e) {
      queueMicrotask(function() { throw e; });
    }
  }
};
// </boucles>

// Helper template+cloneNode pour les `__create_X()` sans interpolations.
//
// Stratégie : parse le HTML UNE SEULE FOIS via `<template>.innerHTML` (singleton
// par string), puis renvoie un clone du `template.content` à chaque appel. Le
// fragment cloné est typiquement 3-5× plus rapide à produire qu'une série de
// N `createElement + appendChild` impératifs.
//
// Cache : Map<HtmlString, HTMLTemplateElement> — la clé est l'HTML littéral.
// Très peu de strings distinctes en pratique (1 par template constant),
// pas besoin de LRU.
// Tags SVG-only : hors d'un `<svg>`, le parseur HTML les crée dans le namespace
// HTML (éléments inconnus, invisibles). Un corps de `{for}` (ou tout sous-template)
// fait d'éléments SVG arrive ici SANS son `<svg>` ancêtre → on doit reparser dans
// un `<svg>` temporaire pour récupérer le bon namespace. Liste volontairement
// limitée aux tags NON ambigus (pas `a`/`title`/`script`/`style`, communs aux 2).
µ._mjs_svgTagRe = /^\s*<(?:circle|ellipse|line|path|polygon|polyline|rect|g|text|tspan|textPath|use|defs|symbol|marker|linearGradient|radialGradient|stop|clipPath|mask|pattern|image|foreignObject|filter|fe[A-Z][a-zA-Z]*|view|switch)\b/;

µ._mjs_cloneTpl = function(html) {
  if (µ._mjs_tplCache == null) {
    µ._mjs_tplCache = new Map();
  }
  var tpl = µ._mjs_tplCache.get(html);
  if (!tpl) {
    tpl = document.createElement('template');
    if (µ._mjs_svgTagRe.test(html)) {
      // Parse dans un <svg> jetable pour namespacer les enfants, puis transplante
      // les nœuds SVG (namespace préservé par appendChild) dans le content du
      // template cache. cloneNode(true) conservera le namespace à chaque clone.
      var wrap = document.createElement('template');
      wrap.innerHTML = '<svg>' + html + '</svg>';
      var svg = wrap.content.firstChild, child;
      if (svg) { while ((child = svg.firstChild)) { tpl.content.appendChild(child); } }
    } else {
      tpl.innerHTML = html;
    }
    µ._mjs_tplCache.set(html, tpl);
  }
  return tpl.content.cloneNode(true);
};

// ----------------------------------------------------------------------------
// Alias ASCII `mu` — portabilité claviers non-français.
//
// Le caractère `µ` (U+00B5) demande AltGr+M sur clavier français, mais est
// quasi-introuvable sur QWERTY (US/UK/IT/ES/DE-natif). `mu` est le nom
// canonique de cette lettre grecque, deux frappes ASCII pures, sans
// collision avec les conventions internes (`_mjs_X` interne ne ressemble
// pas à `mu`).
//
// Usage utilisateur : `mu.state({...})`, `mu.effect(() => ...)`, `mu.emit('event')`.
// **Limite** : le sucre compile-time `µX → µ.X` (runes `µ$count`, `µemit`,
// etc.) NE marche QUE pour `µ`. L'alias `mu` n'autorise que l'accès dotted.
// ----------------------------------------------------------------------------
const mu = µ;

export {
  µ,
  mu
};
