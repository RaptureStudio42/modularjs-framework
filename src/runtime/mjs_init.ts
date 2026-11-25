// mjs_init.ts
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
//   1. les balises que le chargeur va chercher (posée par µ.Autoloader, cf.
//      _mjs_shieldTag dans mjs_autoloader.ts, pour chaque balise du manifeste qu'il charge)
//      couvrent les modules imbriqués lazy-loadés (async import) tant qu'ils ne
//      sont pas encore enregistrés. La règle doit être DANS chaque shadow car
//      `:not(:defined)` du document ne traverse pas les frontières Shadow DOM.
//      `:not([mjs-ssr])` en épargne les
//      éléments que le RENDU SERVEUR a déjà peints (attribut posé par
//      server/renderToString.ts et server/render-browser.ts sur chaque
//      élément `mjs-*` rendu) : leur balisage est là, visible, et il reste
//      à l'écran jusqu'au premier rendu client, qui le remplace.
//      `:not([mjs-skel-host])` en épargne ceux qui montrent la silhouette de leur
//      contenu en attendant leur code (mjs_fx_skeleton.ts, µ._mjs_skelShow).
//      SEULEMENT les balises du manifeste, jamais tout `:not(:defined)` : la balise d'une autre bibliothèque (définie plus
//      tard par elle, ou jamais) n'est jamais touchée, et une balise `mjs-*` mal écrite s'affiche telle qu'elle est écrite
//      (l'Autoloader la dit absente du manifeste) au lieu de laisser un trou invisible à vie. Un fichier unique (`js: 'bundle'`,
//      sans Autoloader) définit tous ses composants avant de rendre la main : rien à cacher
//   2. `[mjs-loading]` couvre le gap entre customElements.define et la fin
//      du premier render (posé par connectedCallback, retiré en microtask) —
//      un élément prérendu compris, dont le contenu est alors remplacé.
// Même instance CSSStyleSheet adoptée partout → coût mémoire constant.
// INVISIBLE, PAS RETIRÉ (`visibility`, jamais `display:none`) : la balise garde sa place pendant l'attente — celle de son
// contenu, et celle que la page lui donne (`mjs-core-number{display:block;height:3rem}`, qu'un `display:none!important`
// écrasait) ; un module arrivé après sa page (fichiers séparés, chargés à la demande) ne pousse plus le reste à son
// apparition. Rien n'est peint, rien ne se clique, rien ne prend le focus, rien n'est lu par un lecteur d'écran, comme avant :
// la règle vise aussi TOUT ce que la balise contient (` *`, et `:host([mjs-loading]) *` pour ce que son ombre porte déjà, le
// gabarit d'un module gelé par l'attente de sa langue), sinon un descendant en `visibility:visible` (classe `visible` de
// Tailwind, `.visible` de Bootstrap) reparaîtrait au milieu de la balise cachée
// SANS TRANSITION (`transition:none`, même règle) tant que la balise porte `mjs-loading` : ce que le premier rendu change sous le
// bouclier (classes, effets, état coché, une place mesurée par `µmount`) partirait sinon en transition, cachée, puis finirait
// sous les yeux du visiteur, et `visibility` aussi a la sienne (`transition: visibility 0s .3s` retarderait l'apparition de 300
// ms). `mjs-loading="out"` montre la balise en gardant la coupure, le temps du premier calcul de style de son apparition
// (µ._mjs_unshield, ci-dessous) : la règle qui cache ne vise que la valeur vide, et ce que la balise contient garde alors sa
// propre visibilité (un menu replié reste caché). La coupure suit aussi le contenu qu'un composant transmet par son propre
// `<slot>` au composant qui le reçoit dans son ombre : il tient sa visibilité de ce dernier dans l'arbre aplati sans être son
// descendant dans le DOM (`slot::slotted(*)`, en règle à part : un moteur qui la refuserait garde les autres). `mjs-appearing`
// coupe les transitions de la balise seule (et de ses `::before`, `::after`), jusqu'au même premier calcul de style
// DEUX FEUILLES, LES MÊMES RÈGLES : la page prend la sienne (µ._mjs_shieldDoc) sans les règles `:host(…)`, qui n'y visent jamais rien. Le moteur essaie
// chaque règle ` *` sur chaque élément qu'il restyle : `[mjs-loading] *` est écartée d'emblée par le filtre des ancêtres (aucun ne porte l'attribut),
// `:host([mjs-loading]) *` ne l'est par aucun filtre, et dans la page elle coûtait de 7 à 13 % du recalcul de style d'une liste de mille à dix mille
// lignes (Chromium). Les ombres gardent la feuille entière (µ._mjs_shield) : ses règles `:host(…)` y cachent ce que l'ombre d'une balise qui attend
// porte déjà, quel que soit le chemin qui pose ou retire l'attribut
var _mjsShieldCss = '[mjs-loading=""],[mjs-loading=""] *{visibility:hidden!important}[mjs-loading],[mjs-loading] *,[mjs-appearing],[mjs-appearing]::before,[mjs-appearing]::after{transition:none!important}[mjs-loading] slot::slotted(*){transition:none!important}';

µ._mjs_shield = new CSSStyleSheet();

µ._mjs_shield.replaceSync(_mjsShieldCss + ':host([mjs-loading=""]) *{visibility:hidden!important}:host([mjs-loading]) *{transition:none!important}');

µ._mjs_shieldDoc = new CSSStyleSheet();

µ._mjs_shieldDoc.replaceSync(_mjsShieldCss);

// les pseudo-éléments d'une ombre qui attend (sa feuille, ses textes, un ancêtre caché) : adoptée par elle seule le temps de
// l'attente et du premier calcul de style de son apparition (règles ` *::before` hors de la page : ailleurs, aucun coût)
µ._mjs_shieldWait = new CSSStyleSheet();

µ._mjs_shieldWait.replaceSync(':host::before,:host::after,::before,::after{transition:none!important}::slotted(*)::before,::slotted(*)::after{transition:none!important}');

µ._mjs_shieldWait._mjs_keep = true;

// RETRAIT DU BOUCLIER — le chemin qui retire `mjs-loading` d'une balise (fin du premier rendu, `_dropLoading` de mjs_element.ts ; secours
// de l'attente des textes, mjs_i18n.ts) ; la copie d'un `*marquee` recopie l'attribut de son original et le perd avec lui
// (_mjsFxMarqueeAttrs, mjs_fx_marquee.ts). Un ancêtre encore caché par le bouclier dans l'arbre aplati (dans la page, l'hôte d'une
// ombre, ou le composant qui reçoit par son `<slot>` la balise glissée dans un autre) : le retrait attend le sien (`again`, rangé
// dans `_mjs_dropKids`), sinon ce que cette ombre change ensuite se jouerait en transition, cachée, puis à l'écran. Sinon la
// balise se montre aussitôt, `done` suit, puis les composants qui l'attendaient se montrent à leur tour, dans la même tâche, donc
// à la même image. Le contenu qui a pu être stylé avant (une attente qui a traversé des images, le contenu glissé dans la balise
// quand une tâche est passée depuis l'arrivée du cœur, une ombre lue par un effet) sort en `mjs-loading="out"` : les balises d'une
// même salve de microtâches font ensemble (`_mjsAppear`) le premier calcul de style de leur apparition, sous la coupure, par UNE
// lecture de style calculé, jamais de mise en page, puis la coupure part, et `done` relit ce que ce retrait laisse au guetteur
// d'attributs. Une ombre neuve, que rien n'a encore stylée, n'a aucune transition à couper : elle sort tout de suite ; celle d'un
// composant à `µmount` fait avec la salve ce premier calcul de style, sans coupure, et une classe posée par `µmount` dans un
// `requestAnimationFrame` part de l'état de son premier rendu : elle fait son fondu. La coupure gardée jusque-là coûtait une passe
// de style de plus pour tout son contenu (4 ms pour 400 composants, Chromium) : ce que `µmount` change après avoir lu la mise en
// page (`offsetWidth`) part en transition à l'apparition, pseudo-éléments compris, comme sur une balise déjà affichée. Ce qui
// change ensuite se joue en transition, comme sur une balise qui vient de s'afficher. Aucune image n'est demandée : un onglet en
// arrière-plan (images suspendues) ou un environnement sans `requestAnimationFrame` ne garde ni balise cachée ni transitions coupées
var _mjsAppearQ = null;

// une erreur levée par l'un (un attribut que son composant relit) ne retient ni les autres ni ceux qui attendent : elle est
// signalée à part
function _mjsUnshieldCall(f) {
  if (!f) return;
  try {
    f();
  } catch (e) {
    queueMicrotask(function() { throw e; });
  }
}

function _mjsUnshieldDone(el, done) {
  var kids = el._mjs_dropKids, i;
  el._mjs_dropKids = null;
  _mjsUnshieldCall(done);
  if (kids) for (i = 0; i < kids.length; i++) _mjsUnshieldCall(kids[i]);
}

// encore cachée par le bouclier (`mjs-loading` vide ; `out` : déjà montrée, elle sort) ; un élément, seul nœud que rend la remontée
function _mjsHiding(n) {
  return n.getAttribute('mjs-loading') === '';
}

// la lecture se fait sur une balise montrée encore branchée : elle vient de changer, le moteur calcule alors le style de tout le
// document
function _mjsAppear() {
  var q = _mjsAppearQ, i, el, o;
  _mjsAppearQ = null;
  _mjsUnshieldCall(function() {
    for (i = 0; i < q.length; i += 2) if (q[i].isConnected) return getComputedStyle(q[i]).visibility;
  });
  for (i = 0; i < q.length; i += 2) {
    el = q[i];
    el.removeAttribute('mjs-loading');
    el.removeAttribute('mjs-appearing');
    if (el._mjs_waited) {
      el._mjs_waited = false;
      o = el._shadow;
      if (o && o.adoptedStyleSheets) o.adoptedStyleSheets = o.adoptedStyleSheets.filter(function(f) { return f !== µ._mjs_shieldWait; });
    }
    _mjsUnshieldCall(q[i + 1]);
  }
}

// une tâche est passée depuis l'arrivée de ce cœur : la page a pu passer une image, ou un script lire sa mise en page, et styler
// cachées les balises qui attendent leur code (règle 1), avec ce que la page glisse dans leur balise, même quand rien n'y est
// encore peint. Dans la tâche qui définit les composants avec le cœur (un fichier unique, un script en ligne), rien n'a été caché
// avant : rien n'est à couper (la lecture de style et le retrait coûtaient de 2,5 à 6 ms pour 400 balises), et ce que la feuille
// d'une balise déjà affichée change sur elle à sa mise à niveau se joue en transition, comme sur toute balise affichée
var _mjsLate = false;

setTimeout(() => _mjsLate = true);

// la balise seule, posée à sa mise à niveau (constructeur, mjs_element.ts) quand elle était dans la page avant sa définition et
// qu'elle a pu y être stylée cachée. Une balise rendue par le serveur (`mjs-ssr`) est déjà peinte et sort dans la même tâche, rien
// de caché ne s'est vu, et ses éléments repris (une liste de mille lignes) n'ont pas à être restylés deux fois
µ._mjs_appearing = function(el) {
  if (_mjsLate && !el.hasAttribute('mjs-ssr')) el.setAttribute('mjs-appearing', '');
};

// le retrait attend (sa feuille, ses textes, un ancêtre encore caché) : l'attente traverse des images, l'ombre est stylée
// cachée, ses pseudo-éléments compris
µ._mjs_waits = function(el) {
  var o = el._shadow;
  if (el._mjs_waited) return;
  el._mjs_waited = true;
  if (o && o !== el && o.adoptedStyleSheets) o.adoptedStyleSheets = [...o.adoptedStyleSheets, µ._mjs_shieldWait];
};

// l'ombre d'un composant, ou rien : sa racine d'ombre (fermée : `_shadow`, que `shadowRoot` ignore) ; un léger est sa propre ombre
// (`_shadow`, la balise elle-même), son contenu est déjà dans l'arbre qui le porte : sa racine d'ombre native s'il en porte une, où
// s'affichent ses enfants glissés. Commune aux parcours qui entrent dans un composant (le démarrage, µ.elementAt, *follow, *cursors,
// *sticky, *pointer, le panneau de développement)
µ._mjs_shadowOf = function(n) { return n._shadow !== n && n._shadow || n.shadowRoot; };

// parent dans l'arbre aplati : la balise glissée dans un composant monte par le `<slot>` qui la reçoit, le premier de son nom
// (ombres fermées : `assignedSlot` y vaut null, le slot se cherche dans `_shadow`). Un hôte léger (`mjs-light`, `_shadow` est la
// balise elle-même) : ce qu'il contient est son propre arbre, la remontée passe par lui sans fouiller son contenu (fouillé une fois
// par composant qui sort du bouclier, mille lignes rendaient le montage quadratique). Une ombre ouverte (la racine native d'un léger,
// entre autres) : le slot que le navigateur donne à la balise, rien n'est fouillé ; une ombre fermée : le premier slot de son nom dans
// l'ordre de l'arbre, cherché par le moteur et arrêté à lui (un slot vient avant son contenu de repli, jamais parcouru pour lui), sans
// rien lire sur les balises d'avant
// un <form> : chaque lecture faite sur lui (son parent, une donnée posée dessus) cherche d'abord un champ du même nom, liste que le
// navigateur refait après la mise à niveau de chaque champ associé ; lu par chaque composant qui sort du bouclier, mille cases d'un
// formulaire rendaient le montage quadratique. Jamais caché par le bouclier ni hôte d'une ombre, il est passé sans rien lire sur lui :
// son parent se cherche depuis l'enfant, par le moteur (`closest`) ; un formulaire glissé dans un composant y prend le slot de l'enfant
// rien n'est lu sur ce qui porte des propriétés nommées : un élément nommé de la page recouvre la propriété du même nom de `document`
// (`<form name="host">`, `<img name="parentNode">`, un `<object id>`), un champ celle de son formulaire, et la remontée qui les lisait
// tournait sans fin. Elle ne rend que des éléments (`parentElement`) ; en haut de son arbre, la racine se demande à l'enfant : une
// racine d'ombre rend son hôte, le document, une racine détachée ou un formulaire sans parent arrêtent la remontée, sans rien lire sur eux
// aucune interface du navigateur n'est nommée pour une page sans ombre : `x instanceof HTMLFormElement` la faisait fabriquer par le
// navigateur dans chaque page, formulaire ou non (constructeur, prototype, accesseurs gardés en mémoire) ; « mon parent est-il un
// formulaire ? » se demande au moteur depuis l'enfant (`matches`), et `ShadowRoot` n'est nommé qu'une fois le document écarté
// les deux questions passent par les méthodes de la balise elle-même (`Element.prototype`) : l'enfant peut être un composant qui déclare
// `@matches` ou `@closest`, et la sienne partirait à sa place, avec ce sélecteur
function _mjsFlatParent(n) {
  var p = n.parentElement, o, e = Element.prototype;
  if (p && e.matches.call(n, 'form>*')) p = e.closest.call(n, ':not(form,:scope)');
  if (!p) return (p = n.getRootNode()) !== document && p instanceof ShadowRoot && p.host;
  o = µ._mjs_shadowOf(p);
  if (o && p.shadowRoot === o) return n.assignedSlot || p;
  if (o) return o.querySelector(n.slot ? 'slot[name="' + CSS.escape(n.slot) + '"]' : 'slot:not([name]),slot[name=""]') || p;
  return p;
}

// la remontée a sa borne (dix mille ancêtres) : une structure qui reboucle (un slot rangé sous la balise qu'il reçoit) montre la balise au
// lieu de retenir la page
µ._mjs_unshield = function(el, again, done) {
  var n, s, c;
  if (!_mjsHiding(el)) return _mjsUnshieldDone(el, done);
  for (n = _mjsFlatParent(el), c = 1e4; n && c--; n = _mjsFlatParent(n)) {
    if (_mjsHiding(n)) {
      if (!µ.server) µ._mjs_waits(el);
      (n._mjs_dropKids ??= []).push(again);
      return;
    }
  }
  s = !el.hasAttribute('mjs-ssr');
  if (el._mjs_waited || (s && ((_mjsLate && el._shadow !== el && el.firstElementChild) || el._mjs_withFx))) el.setAttribute('mjs-loading', 'out');
  else el.removeAttribute('mjs-loading');
  if (el.hasAttribute('mjs-loading') || el.hasAttribute('mjs-appearing') || (s && el._mjs_hooks?.mount)) {
    if (!_mjsAppearQ) {
      _mjsAppearQ = [];
      queueMicrotask(_mjsAppear);
    }
    _mjsAppearQ.push(el, done);
  }
  _mjsUnshieldDone(el, done);
};

// Feuille système : classes utilitaires utilisées par le runtime (overlays
// d'erreur, fallback). Pas de style inline — tout passe par des classes pour
// que les apps puissent les overrider via leur propre CSS.
µ._mjs_systemSheet = new CSSStyleSheet();

µ._mjs_systemSheet.replaceSync(`.mjs-fatal-error{color:var(--mjs-error-fg, red);font-weight:bold;padding:10px;border:2px solid var(--mjs-error-border, red)}
.mjs-error{color:var(--mjs-error-fg, red)}`);

// les deux feuilles rejoignent le document ensemble, le bouclier d'abord (celui de la page, sans `:host`)
document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_shieldDoc, µ._mjs_systemSheet];

// Thème clair/sombre embarqué (`µ._mjs_themeSheet`/`µ._mjs_themeAppSheet`/`µ._themeAdopt`, 8 variables
// --mjs-surface/fg/fg-muted/border/hover/selected/accent/shadow + thèmes d'application
// `*.theme.mjs`) vit dans src/runtime/mjs_theme.ts, DÉTECTÉ — plus rattaché d'office au cœur.

// `µ._mjs_routeErrorCss` (panneau « route introuvable ») vit désormais dans
// src/runtime/mjs_page_cache.ts, avec le reste du cache de pages routeur/UJS.

// Stub : `metamjs-view` est un tag interne émis par le compilateur pour
// matérialiser la directive <@view>. Il contient un tiret → il est traité
// comme custom element par le DOM, donc piégé en permanence par le shield
// `:not(:defined)` s'il n'est pas enregistré. On le déclare ; sans le routeur, il ne fait rien.
// bloc `<view-tag>` : retiré du cœur par le bundler quand aucune unité du build n'écrit `<@view>` et que ni le routeur ni
// les liens (ujs) n'en font partie
// <view-tag>
MetaViewStub = class MetaViewStub extends HTMLElement {
  // <router-view>
  // le routeur suit la vue qui paraît ou sort de la page (un `{if}` qui s'ouvre ou se referme, mjs_router.ts) : bloc retiré
  // du cœur sans le routeur (bundler/index.ts). Une balise déjà dans la page du serveur est mise à niveau dès sa déclaration,
  // avant le routeur (plus bas dans le cœur) : rien alors, le routeur sert ces vues quand leur composant s'inscrit
  connectedCallback() { µ.Router?._mjs_viewIn(this); }
  disconnectedCallback() { µ.Router?._mjs_viewOut(this); }
  // </router-view>
};

if (!customElements.get('metamjs-view')) {
  customElements.define('metamjs-view', MetaViewStub);
}
// </view-tag>

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
// <raw-lines>
// listes marquées avec leurs lignes (`µraw(liste, true)`, mjs_rare_runes.ts) : une note par liste, aucune marque par ligne. La passe d'un `{for}`
// (mjs_for.ts) y lit que chaque ligne de la liste se traite comme un objet µraw. Bloc gardé pour l'appli qui appelle µraw avec un second
// argument (cf. RAW_ROWS, bundler/features.ts)
µ._mjs_rawRows = new WeakSet();
// </raw-lines>
// <weak>
// enveloppe d'une `WeakMap` ou d'un `WeakSet` de l'état → la vraie collection, notée par ceux qui font cette enveloppe (variable `$` :
// `_mjs_wrapDeep`, mjs_element.ts ; µ.state ; µ.Store) et lue par µraw (mjs_rare_runes.ts), qui ne lit ainsi rien sur l'objet reçu.
// Bloc gardé pour l'appli qui nomme `WeakMap` ou `WeakSet`, ou dont la clé `runtime` demande `collections`
µ._mjs_weakRaw = new WeakMap();
// </weak>
// <development>
// collection arrivée dans l'état d'une appli dont aucune unité, aucun fichier importé ne la nomme (une bibliothèque chargée à part la
// donne) : le cœur est bâti sans la part qui la suit (blocs `<collections>`, `<weak>`) et garde ses lignes d'avant ; dit une fois
// par page, avec le remède. Appelé par les seules lignes `<no-collections>` et `<no-weak>` (mjs_element.ts, mjs_state.ts,
// mjs_store.ts) : jamais par un cœur qui porte cette part
var _mjsCollTold   = 0;
µ._mjs_collMissing = (o, c) => {
  if (_mjsCollTold || !(c = o instanceof Map ? 'Map' : o instanceof Set ? 'Set' : o instanceof WeakMap ? 'WeakMap' : o instanceof WeakSet ? 'WeakSet' : '')) return;
  _mjsCollTold = 1;
  µ.warn(µ._mjs_msg('collNotNamed', { c: c }, 'Une collection `{c}` est arrivée dans l\'état, alors qu\'aucun fichier de ce projet ne nomme `{c}` : le cœur a été bâti sans la part qui suit les clés objets des collections. Elle y garde un comportement plus simple, sans erreur : la clé objet d\'une `Map` sort brute et `get` ne la retrouve que sous la forme rangée, une `WeakMap` ou un `WeakSet` reste sans enveloppe dans un composant. Si une bibliothèque chargée à part vous donne cette collection, demandez cette part par "collections": true dans mjs.config.json : elle s\'ajoute sans toucher au repérage des autres modules ; si vous écrivez déjà une liste "runtime", vous pouvez aussi y ajouter "collections". Cet avertissement n\'existe qu\'en développement, une fois par page.'));
};
// </development>

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

// bloc `<page-start>` : retiré du cœur par le bundler quand aucun autre fichier du cœur ne se sert de cette aide (aucun
// chargeur ni µajax : appli en fichier unique sans langue, sans effet, sans feuille ni variante à la demande, sans µajax)
// <page-start>
// DÉPART DE LA PAGE — un chargement du runtime (module d'un composant, fichier de langue, fragment de traduction, fichier
// d'effet, feuille) coupé parce que le visiteur s'en va n'est pas une panne, pas plus qu'une lecture µajax restée sans réponse (mjs_ajax.ts). Firefox et Safari coupent ce qui est en vol dès
// que la navigation part (juste après `beforeunload`), la page restant affichée jusqu'à la réponse de la suivante ; Chromium
// coupe après `pagehide`. Le départ est ANNONCÉ par une navigation vers un autre document (API Navigation : lien, formulaire,
// script) ou par `beforeunload` (barre d'adresse, rechargement, retour), CONFIRMÉ par `pagehide`, oublié au `pageshow`
// (page revenue du cache de navigation). `beforeunload`, seul signal d'un départ par la barre d'adresse, est écouté en
// permanence (`_mjsInFlight` part de 1), sauf dans Firefox (`navigator.vendor` vide) : il y priverait la page du cache de
// navigation, il n'y est écouté que tant qu'un chargement suivi par `µ._mjs_loading` est en vol.
// `µ._mjs_loadFailed(err, report)` : `report` dit l'échec tout de suite quand aucun départ n'est annoncé ; départ annoncé
// depuis moins de 10 s, il attend la fin de ces 10 s et ne dit l'échec que si la page est toujours là (navigation annulée :
// réponse 204, téléchargement, départ refusé) ; page cachée par son départ, rien. Une requête annulée volontairement
// (`AbortError`) ne se dit jamais. `µ._mjs_leaveWait()` : ce qui reste de ces 10 s (ms), 0 sans départ annoncé ou passé le
// délai, -1 page cachée par son départ. `µ._mjs_left()` : un départ annoncé depuis que la page est montrée, quel que soit le
// temps passé — rien ne recharge la page tant qu'une navigation peut être en route (une page suivante lente répond après 10 s).
// La marque d'un départ resté sans suite (réponse 204, téléchargement, départ refusé) tombe à la navigation suivante
// de la page : une navigation MJS lancée après lui (`mjs:visit`) et arrivée (`mjs:load`) ; un départ annoncé pendant
// cette navigation reste en cours, sa marque date d'après elle
var _mjsLeaveAt   = 0;
var _mjsLeaveSeen = 0;
var _mjsHides     = 0;
var _mjsHidden    = 0;
var _mjsDlFrom    = 0;
var _mjsInFlight  = typeof navigator === 'object' && navigator !== null && navigator.vendor ? 1 : 0;
var _mjsLeaving   = function() { _mjsLeaveAt = Date.now(); };
if (typeof window !== 'undefined' && typeof addEventListener === 'function') {
  if (_mjsInFlight) { addEventListener('beforeunload', _mjsLeaving); }
  addEventListener('pagehide', function() { _mjsHides++; _mjsHidden = 1; });
  addEventListener('pageshow', function() { _mjsHidden = _mjsLeaveAt = 0; });
  // un téléchargement n'annonce aucun départ : `downloadRequest` vaut le nom proposé, chaîne vide comprise (attribut `download` sans valeur), et `null` pour une navigation ;
  // Firefox annonce aussitôt le même téléchargement par un second `navigate`, `downloadRequest` nul, venu du même lien : le `navigate` qui suit un téléchargement
  // depuis la même source n'annonce rien non plus (`_mjsDlFrom`). La visite d'un lien que la navigation de MJS remet à l'API (mjs_ujs.ts) part par `pushState` :
  // une navigation du même document, qui n'annonce rien
  if (typeof window.navigation?.addEventListener === 'function') { window.navigation.addEventListener('navigate', function(e) { var from = _mjsDlFrom; _mjsDlFrom = e.downloadRequest == null ? 0 : e.sourceElement; if (!e.destination.sameDocument && e.downloadRequest == null && from !== e.sourceElement) { _mjsLeaving(); } }); }
  if (typeof document === 'object' && document !== null && typeof document.addEventListener === 'function') {
    document.addEventListener('mjs:visit', function() { _mjsLeaveSeen = _mjsLeaveAt; });
    document.addEventListener('mjs:load', function() { if (_mjsLeaveAt === _mjsLeaveSeen) { _mjsLeaveAt = 0; } });
  }
}
// la promesse `p` d'un chargement du runtime, suivie tant qu'elle est en vol ; rendue telle quelle
µ._mjs_loading = function(p) {
  if (typeof window === 'undefined' || typeof addEventListener !== 'function') { return p; }
  if (!_mjsInFlight++) { addEventListener('beforeunload', _mjsLeaving); }
  var end = function() { if (!--_mjsInFlight) { removeEventListener('beforeunload', _mjsLeaving); } };
  Promise.resolve(p).then(end, end);
  return p;
};
µ._mjs_leaveWait = function() { return _mjsHidden ? -1 : Math.max(0, _mjsLeaveAt + 10000 - Date.now()); };
µ._mjs_left = function() { return !!(_mjsHidden || _mjsLeaveAt); };
µ._mjs_loadFailed = function(err, report) {
  var hides = _mjsHides;
  var wait  = µ._mjs_leaveWait();
  if (wait < 0 || (err && err.name === 'AbortError')) { return; }
  if (!wait) { return report(); }
  setTimeout(function() { if (hides === _mjsHides) { report(); } }, wait);
};
// </page-start>

// <attr-filter>
// hors du cœur de production quand aucune unité ni aucun module du cœur ne s'en sert (bundler/index.ts)
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
  // une clé qui n'est pas un nom d'attribut (espace, chevron, signe égal : la clé d'une donnée étalée) fait lever `setAttribute` : elle est
  // ignorée, et dite, sans arrêter le rendu du composant
  if (node.getAttribute(name) !== ('' + value)) {
    try { node.setAttribute(name, value); }
    catch { µ.warn(µ._mjs_msg('initAttrName', { name: name }, '« {name} » n\'est pas un nom d\'attribut : clé ignorée.')); }
  }
};
// </attr-filter>

// `µ._mjs_isPageCached`/`µ._mjs_destroyEvictedTree` vivent désormais dans
// src/runtime/mjs_page_cache.ts, avec le reste du cache de pages routeur/UJS.

// ----------------------------------------------------------------------------
// Configuration runtime — surchargable par l'utilisateur via `µ.config.X = ...`
// avant le mount des composants, ou par injection du bundler à terme.
// ----------------------------------------------------------------------------
µ.config = {

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
// LE CHARGEUR (bloc `<msg-loader>` : table d'attente, téléchargement, rejeu) reste au cœur hors production ; le build de
// production l'écrit dans son propre fichier, à empreinte (`µ._msgLoader`, cf. msgLoaderSource, bundler/index.ts), et pose à sa
// place l'amorce du bloc `<no-msg-loader>`, qui le demande dans les mêmes deux cas, juste avant le fichier de la langue
// <msg-loader>
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
// langue du fichier de messages à servir : la courante (`pref` : celle de la page quand l'amorce a noté le texte), sinon
// celle du projet, sinon en, sinon fr
function _mjsMsgLang(pref) {
  return [pref || µ._mjs_labelLang(), µ._runtimeLabelsLang, 'en', 'fr'].filter(function(l) { return Object.prototype.hasOwnProperty.call(µ._msgUrls, l); })[0];
}
// le fichier de la langue courante, demandé d'avance (réglage `messages: 'idle'`)
function _mjsMsgEarly() {
  try {
    var lang = _mjsMsgLang();
    if (lang) { _mjsMsgAsk({ l: lang, u: µ._msgUrls[lang] }); }
  } catch { }
}
// <msg-idle>
// réglage `messages: 'idle'` : le build ajoute `µ._msgIdle()` au manifeste, qui télécharge le fichier de
// la langue courante une fois la page affichée et au repos ; bloc retiré du cœur sans ce réglage
var _mjsMsgIdle = 0;
µ._msgIdle = function() {
  if (_mjsMsgIdle++ || typeof document === 'undefined' || typeof fetch !== 'function') { return; }
  var rest = function() { window.requestIdleCallback ? window.requestIdleCallback(_mjsMsgEarly) : setTimeout(_mjsMsgEarly, 200); };
  document.readyState === 'complete' ? rest() : window.addEventListener('load', rest);
};
// </msg-idle>
// texte court d'un message dont le texte manque encore (clé + variables, `clé {}` sans variables), et son entrée dans la table
// d'attente ; `pref` et `txt` : la langue de la page et le texte court notés par l'amorce du cœur de production (cf. _mjsMsgTake)
function _mjsMsgShort(key, vars, msg, pref, txt) {
  if (!txt) {
    txt = String(key);
    try { txt += ' ' + JSON.stringify(vars || {}); } catch { txt += ' {}'; }
  }
  try {
    var lang = _mjsMsgLang(pref);
    var at   = _mjsMsgLoads[lang];
    if (lang && typeof document !== 'undefined' && typeof fetch === 'function' && !(Date.now() - at < 30000) && !_mjsMsgWait.has(txt)) {
      if (_mjsMsgWait.size > 49) { _mjsMsgWait.delete(_mjsMsgWait.keys().next().value); }
      _mjsMsgWait.set(txt, { k: key, v: vars, c: [], m: msg, l: lang, u: µ._msgUrls[lang] });
      if (!_mjsMsgPend) {
        window.addEventListener('error', _mjsMsgHear);
        window.addEventListener('unhandledrejection', _mjsMsgHear);
      }
      _mjsMsgPend = 1;
    }
  } catch { }
  return txt;
}
// le chargeur dans son propre fichier (production) : à son arrivée, l'amorce du cœur l'appelle avec ce qu'elle a noté avant
// lui, rejoué ici dans l'ordre — [0, clé, variables, préfixe, langue, texte court] un texte en attente, [1, niveau, arguments]
// un appel écrit, [2, événement] une erreur non attrapée, [3] le chargement d'avance — et reçoit ses entrées
function _mjsMsgTake(q) {
  var run = [_mjsMsgShort, _mjsMsgNote, _mjsMsgHear, _mjsMsgEarly];
  q.forEach(function(e) { run[e[0]](...e.slice(1)); });
  return { s: _mjsMsgShort, n: _mjsMsgNote, i: _mjsMsgEarly };
}
// </msg-loader>
// <no-msg-loader>
// // AMORCE DU CHARGEUR (production) : le chargeur vit dans son propre fichier (`µ._msgLoader`), importé une fois, quand un
// // texte court noté s'écrit (µ.log/warn/error au niveau courant) ou qu'une erreur non attrapée le porte — les deux cas où part
// // le fichier de la langue, qu'il demande à son tour. D'ici là, l'amorce rend le même texte court et note dans l'ordre ce qu'il
// // rejouera (cf. _mjsMsgTake) : textes en attente (les 50 derniers avant la demande, avec la langue de la page), appels écrits et
// // erreurs qui en portent un (500 entrées au plus pendant l'import). Une fois là, il prend tout en main. Fichier introuvable
// // (404, hors ligne) : les textes courts restent, rien ne tombe, rien n'est noté pendant 30 s, puis un nouvel essai, sous une adresse neuve
// var _mjsMsgPend = 0;
// var _mjsMsgQ    = [];
// // le chargeur : absent, 1 pendant l'import, date d'un échec, puis ses entrées (s : texte court, n : appel écrit, i : d'avance)
// var _mjsMsgL;
// function _mjsMsgShort(key, vars, msg) {
//   if (_mjsMsgL?.s) { return _mjsMsgL.s(key, vars, msg); }
//   var txt = String(key);
//   try { txt += ' ' + JSON.stringify(vars || {}); } catch { txt += ' {}'; }
//   if (typeof document !== 'undefined' && typeof fetch === 'function' && !(Date.now() - _mjsMsgL < 30000) && _mjsMsgQ.length < 500 && !_mjsMsgQ.some(function(q) { return q[5] === txt; })) {
//     if (_mjsMsgL !== 1 && _mjsMsgQ.length > 49) { _mjsMsgQ.shift(); }
//     _mjsMsgQ.push([0, key, vars, msg, µ._mjs_labelLang(), txt]);
//     if (!_mjsMsgPend) {
//       window.addEventListener('error', _mjsMsgHear);
//       window.addEventListener('unhandledrejection', _mjsMsgHear);
//     }
//     _mjsMsgPend = 1;
//   }
//   return txt;
// }
// function _mjsMsgNote(lvl, args) {
//   _mjsMsgL?.n ? _mjsMsgL.n(lvl, args) : _mjsMsgSeen(args, [1, lvl, args]);
// }
// // le chargeur arrivé, ses propres écouteurs entendent les erreurs
// function _mjsMsgHear(e) {
//   if (!_mjsMsgL?.n) { _mjsMsgSeen([e.message || e.error?.message || e.reason?.message || e.reason], [2, e]); }
// }
// // un appel écrit ou une erreur qui porte un texte court noté : noté à son tour, le chargeur demandé
// function _mjsMsgSeen(args, ev) {
//   if (_mjsMsgQ.some(function(q) { return !q[0] && args.some(function(a) { return (a?.message || a)?.indexOf?.(q[5]) >= 0; }); })) {
//     _mjsMsgGo();
//     if (_mjsMsgQ.length < 500) { _mjsMsgQ.push(ev); }
//   }
// }
// // un import() refusé le reste pour toute la page à la même adresse (table des modules du document) : le nouvel essai, 30 s
// // après l'échec, part sous une adresse neuve, la date de cet échec en paramètre
// function _mjsMsgGo() {
//   var at = _mjsMsgL;
//   if (at === 1 || Date.now() - at < 30000) { return; }
//   _mjsMsgL = 1;
//   import(µ._msgLoader + (at ? '?' + at : '')).then(function(m) {
//     _mjsMsgL    = m.default(µ, _mjsMsgQ);
//     _mjsMsgQ    = [];
//     _mjsMsgPend = 1;
//   }, function() {
//     _mjsMsgQ = [];
//     _mjsMsgL = Date.now();
//   });
// }
// // <msg-idle>
// var _mjsMsgIdle = 0;
// µ._msgIdle = function() {
//   if (_mjsMsgIdle++ || typeof document === 'undefined' || typeof fetch !== 'function') { return; }
//   var go = function() {
//     if (_mjsMsgL?.i) { _mjsMsgL.i(); }
//     else {
//       _mjsMsgQ.push([3]);
//       _mjsMsgGo();
//     }
//   };
//   var rest = function() { window.requestIdleCallback ? window.requestIdleCallback(go) : setTimeout(go, 200); };
//   document.readyState === 'complete' ? rest() : window.addEventListener('load', rest);
// };
// // </msg-idle>
// </no-msg-loader>
µ._mjs_txt = function(key, vars, fr, msg) {
  var txt = typeof fr === 'string' ? fr : String(key);
  try {
    var dot = String(key).indexOf('.');
    var grp = dot < 0 ? 'err' : key.slice(0, dot);
    var t   = µ._mjs_label(grp, dot < 0 ? key : key.slice(dot + 1));
    if (typeof t === 'string') { txt = t; }
    else if (grp === 'err' && µ._msgUrls) { return _mjsMsgShort(key, vars, msg); }
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
// <precision>
// `c` : 1 sans mention, une écriture du code du composant ; 0 pour l'écho d'une liaison `!{}` (generator/attributes), écrit par MJS
// </precision>
// ----------------------------------------------------------------------------
// <precision>
µ._set = function(el, k, v, c = 1) {
  return el._set(k, v, c);
// </precision>
// <clock>
// µ._set = function(el, k, v) {
  // return el._set(k, v);
// </clock>
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

// <pending-props>
// hors du cœur de production quand aucune unité ni aucun module du cœur ne pose de prop sur un enfant pas encore mis à niveau (bundler/index.ts)
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
  // texte ou JSON pour un objet, comme toute balise qui n'est pas un composant. Sans manifeste, un élément
  // tiers garde sa propriété propre, TYPÉE : un attribut la ferait relire en chaîne.
  // Un composant DU PROJET va au registre : le manifeste (`µ.paths`, clé = nom sans le préfixe
  // `mjs-`) le reconnaît, qu'il soit déjà défini ou non — une ligne de `{for}` est peuplée avant
  // son insertion, donc avant la mise à niveau, même quand la balise est définie depuis
  // longtemps. Une balise `mjs-` absente du manifeste est un web component tiers (cas documenté,
  // docs/15). Clé CHERCHÉE EN PROPRE : `µ.paths` est un objet ordinaire, `µ.paths['constructor']`
  // répondait l'héritage d'Object — `<mjs-constructor>` passait pour un composant du projet.
  // Sans manifeste (harnais, rendu serveur), repli : le préfixe, sauf balise déjà définie par une classe
  // qui n'est pas celle d'un composant (`µ.Element`). Un composant défini mais pas encore mis à niveau
  // arrive ici : ligne de `{for}` peuplée avant son insertion, enfant de la racine d'un parent qui lui
  // livre ses props avant de le mettre dans la page (`_mjs_kb`, mjs_element.ts). Pris pour un élément
  // tiers, il recevrait sa prop en propriété propre : une prop au nom d'un attribut natif (`title`, `id`,
  // `hidden`) passerait par le setter du navigateur et poserait l'attribut sur la balise, que la prop
  // déclarée garde pour elle (µ._mjs_spWc, mjs_element.ts)
  var n        = el.localName || (el.tagName || '').toLowerCase(), ctor;
  var fromProject = n.slice(0, 4) === 'mjs-' && (µ.paths ? Object.prototype.hasOwnProperty.call(µ.paths, n.slice(4)) : !(ctor = customElements.get(n)) || ctor.prototype instanceof µ.Element);
  if (!fromProject) {
    // `innerHTML` et `outerHTML` posent du HTML : jamais par une prop livrée à un élément tiers, dont la clé peut venir d'une donnée reçue
    // (étalement `{...$data}`) — sur une balise native, la même clé n'est qu'un attribut sans effet ; le HTML voulu s'écrit par `:html` ou `{{ }}`
    if (k === 'innerHTML' || k === 'outerHTML') {
      µ.warn(µ._mjs_msg('initHtmlKey', { tag: n, prop: k }, '<{tag}> : la prop « {prop} » poserait du HTML sur un élément qui n\'est pas un composant du projet, elle est ignorée — écrivez ce HTML par :html ou {{ }}.'));
      return;
    }
    // la valeur typée va aussi au registre : une balise absente du manifeste peut être un composant compilé à part, défini plus tard, qui la
    // reprend à sa mise à niveau au lieu de relire l'attribut en texte (un nombre y devenait une chaîne) ; un élément tiers ne lit jamais le registre
    if (attr && µ.paths) {
      _mjsPendRegistry(el, k, v);
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
      var seen = µ._mjs_ro.get(el);
      if (!seen) {
        seen = Object.create(null);
        µ._mjs_ro.set(el, seen);
      }
      if (!seen[k]) {
        seen[k] = true;
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
  _mjsPendRegistry(el, k, v);
};
// la prop retenue jusqu'à la mise à niveau de la balise (cf. connectedCallback, mjs_element.ts)
function _mjsPendRegistry(el, k, v) {
  var m = µ._mjs_pending.get(el);
  if (!m) {
    m = Object.create(null);
    µ._mjs_pending.set(el, m);
  }
  m[k] = v;
}

// une prop à sens unique que le parent livre à la balise d'un composant déjà mis à niveau (`ouvert={$o}`, cf. componentLogic,
// generator/attributes/index.ts) : écrite quand sa valeur change chez le parent, comparée à la dernière que ce parent a livrée à cette
// balise pour cette prop (`_mjs_pv`, qui tient aussi les props versées du registre à la connexion, cf. connectedCallback, mjs_element.ts),
// et non chaque fois que sa liaison se rejoue (ligne de {for} redessinée ou triée, autre variable lue qui change) : l'enfant qui l'a
// changée lui-même (un champ où l'on tape, un volet fermé) la garde jusque-là. Un objet passe toujours par `_set`, qui le redit à l'enfant
// quand il a changé en profondeur (époques, µrefresh). La ligne d'une liste rangée par index qui porte un autre élément oublie ces valeurs
// (cf. _mjs_updRows, mjs_for.ts) : elle reçoit tout, même valeur comprise. Les écritures du composant lui-même (`µ._set`) n'y passent pas
µ._mjs_prop = function(el, k, v) {
  var pv = el._mjs_pv;
  if (!pv) pv = el._mjs_pv = Object.create(null);
  else if (pv[k] === v && (v !== void 0 || k in pv) && (v === null || typeof v !== 'object')) return;
  pv[k] = v;
  el._set(k, v);
};
// </pending-props>

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
// <families>
// clé Symbol par laquelle l'enveloppe d'un objet de `µ.state` ou de `µ.Store` rend sa fiche : une variable du composant qui la reçoit
// (`$courant = st.rows[1]`) la note, et son écriture prévient l'état (cf. _mjsTap, mjs_element.ts) ; l'enveloppe d'un composant ne répond
// pas. `µ._mjs_tap` : vrai dès qu'une variable a noté une fiche, avant lui une écriture ne paie qu'un test
µ._mjs_HANDLER = Symbol('mjs_handler');
µ._mjs_tap   = false;
// </families>

// RECONNAISSANCE DES ENVELOPPES (mort de la boucle two-way inter-
// composants). `µ._mjs_toRaw` déballe une chaîne de Proxy réactifs (le SIEN comme
// celui d'un AUTRE composant/rune/store — tous répondent à µ._mjs_RAW) jusqu'à la
// cible brute : un filet qui reçoit l'enveloppe d'un pair retrouve ainsi la
// MÊME cible que celle déjà connue de son propre carnet (_mjs_proxyCache indexé
// par target), au lieu d'empiler un Proxy-de-Proxy à chaque frontière — c'est
// cet empilement qui cassait l'identité et faisait repartir le ping-pong.
// Boucle (pas un seul niveau) : une chaîne héritée peut être imbriquée. Le symbole se lit une fois par niveau : sur une
// enveloppe, chaque lecture passe par son piège `get`. Bornée : une enveloppe de l'appli qui se rend elle-même (`new Proxy({}, { get: () => p })`),
// ou deux qui se rendent l'une l'autre, figeaient la page — arrêt quand la valeur ne change plus, et huit pas au plus
µ._mjs_toRaw = function(o) {
  var r, n = 8;
  while (n-- && o != null && typeof o === 'object' && (r = o[µ._mjs_RAW]) && r !== o) o = r;
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

// fonction du navigateur (`Object`, `Array`, `Map`…) : son code est natif. Une clé venue de l'extérieur (`?id=constructor`, un
// formulaire, des données reçues) la range dans l'état ou le magasin (`$serie = $$series[cle]`), et `$serie.values = v` remplacerait
// `Object.values` pour toute la page : l'écriture est refusée, avec le message de ce piège (mjs_deep.ts, mjs_store_globals.ts) ; lue par
// une enveloppe, elle est rendue en copie liée SANS lien, ni elle ni son `prototype` ne s'atteignent par la copie (mjs_element.ts,
// mjs_store.ts). Une fonction liée (`f.bind(…)`) a aussi un code natif, mais l'appli la fabrique : elle reçoit l'écriture, comme toute
// fonction de l'appli. Le seul contrôle, commun au cœur, aux aides profondes et au magasin ; `f` est une fonction : chaque
// appelant le vérifie avant (typeof, ou _mjsStoreNative du magasin pour une valeur quelconque) ; la page des visionneuses, qui joint
// mjs_deep.ts hors du cœur, déclare ce contrôle par la portée de son entrée (VIEWER_RUNTIME, server/viewer-page.ts)
var _mjsNatFn = (f) =>
  // <wrapper-helpers>
  // relais d'une fonction de l'appli lue par une enveloppe (µ._mjs_fnRelay) : son code paraît natif, mais il écrit dans la fonction de l'appli
  !f[µ._mjs_RAW] &&
  // </wrapper-helpers>
  /\[native code\]\s*\}$/.test(Function.prototype.toString.call(f)) && !/^bound /.test(f.name);

// bloc `<wrapper-helpers>` : les aides de lecture des enveloppes (propriété figée, méthode d'une collection, fonction du navigateur, relais
// d'une fonction de l'appli) ; avec le réglage
// `proxy: false`, le bundler les retire du cœur qui ne les nomme plus (µ.state et µ.Store, qui s'en servent, les gardent)
// <wrapper-helpers>
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
// prédicat par élément, tel que l'état le rend). Map / Set : ce qui en sort (`get`, `forEach`, `keys`, `values`, `entries`,
// `for…of`) est enveloppé, la clé objet d'une Map comme la valeur : rangée sous la clé de la variable, une autre variable qui
// l'écrit prévient ; `get` et `has` retrouvent l'entrée sous toutes ses formes, enveloppée ou brute (cf. µ._mjs_keyIn), ceux d'une
// WeakMap, d'un WeakSet aussi. La clé d'une Map, l'élément d'un Set rangés sous l'enveloppe d'une AUTRE famille (composant parent,
// µ.state, µ.Store : collection faite là, puis donnée) sortent tels quels, la forme que tient la collection, et le calcul d'une valeur
// précise qui les lit doute (µ._mjs_doubtKey, mjs_element.ts) : une écriture faite par cette autre famille ne le préviendrait pas
// ce suivi des clés (blocs `<collections>` d'ici, de mjs_element.ts, mjs_deep.ts, mjs_state.ts, mjs_store.ts et mjs_store_globals.ts) n'entre
// au cœur que pour l'appli qui nomme `Map`, `Set`, `WeakMap` ou `WeakSet`, ou dont la clé `runtime` demande `collections` (bundler/index.ts) ;
// sans lui, les lignes `<no-collections>` reprennent leur texte : Map / Set, ce qui en sort est enveloppé, la clé d'une Map reste brute,
// `has` retrouve aussi ce qu'on tient par son enveloppe — les lignes d'avant ce suivi ; µ.state et µ.Store y gardent seulement l'enveloppe
// d'une `WeakMap` ou d'un `WeakSet`, qui y levaient sans elle
µ._mjs_readFn = (o, k, f, p, w) => {
  if (Array.isArray(o)) {
    return /^(lastI|i)ndexOf$|^includes$/.test(String(k)) ? (x, ...r) => f.call(o, µ._mjs_toRaw(x), ...r) : f.bind(p);
  }
  // <collections>
  if (o instanceof Map || o instanceof Set || o instanceof WeakMap || o instanceof WeakSet) {
    // ce qui sort, enveloppé ; une valeur simple (chaîne, nombre) sort telle quelle, sans passer par `w`. Itérateur qui ré-enveloppe :
    // valeurs ou clés, ou entrées [clé, valeur]
    const s = o instanceof Set, e = (x) => (typeof x === 'object' ? x : typeof x === 'function') ? w(x) : x, c = (x, y) => (y = e(x)) !== x && x[µ._mjs_RAW] ? (µ._mjs_doubtKey?.(), x) : y, v = s ? c : e, it = (n) => function* () { for (const x of f.call(o)) yield n === 1 ? [c(x[0]), v(x[1])] : n ? c(x) : v(x); };
    // `get` lit d'abord la forme donnée : une entrée trouvée ne coûte rien de plus ; la forme brute, l'index ensuite (µ._mjs_keyAlt)
    return k === 'get' ? (x, y) => {
      // <development>
      // collection qui tient l'objet sous ses deux formes : l'avertissement de µ._mjs_keyIn
      µ._mjs_keyIn(o, x);
      // </development>
      return e((y = f.call(o, x)) !== void 0 || (x = µ._mjs_keyAlt(o, x)) === void 0 ? y : f.call(o, x));
    }
      : k === 'has' ? (x) => f.call(o, x) || µ._mjs_keyAlt(o, x) !== void 0
      : k === 'forEach' ? (t, h) => f.call(o, (y, x) => t.call(h, v(y), c(x), p))
      : k === 'values' || (s && k === Symbol.iterator) ? it(0)
      : k === 'keys' ? it(2)
      : k === 'entries' || k === Symbol.iterator ? it(1)
      : f.bind(o);
  }
  // </collections>
  // <no-collections>
  // if (o instanceof Map || o instanceof Set) {
  //   // sans la part des collections : itérateur qui ré-enveloppe les valeurs, ou les entrées [clé, valeur] (clé d'une Map brute)
  //   const s = o instanceof Set, it = (n) => function* () { for (const x of f.call(o)) yield n ? [s ? w(x[0]) : x[0], w(x[1])] : w(x); };
  //   return k === 'get' ? (x) => w(f.call(o, x))
  //     : k === 'has' ? (x) => f.call(o, x) || f.call(o, µ._mjs_toRaw(x))
  //     : k === 'forEach' ? (t, h) => f.call(o, (v, x) => t.call(h, w(v), s ? w(x) : x, p))
  //     : k === 'values' || (s && (k === 'keys' || k === Symbol.iterator)) ? it(0)
  //     : k === 'entries' || k === Symbol.iterator ? it(1)
  //     : f.bind(o);
  // }
  // </no-collections>
  return f.bind(o);
};
// <collections>
// clé `x` donnée à `get`, `set`, `add` ou `delete` d'une collection `o` de l'état (Map, Set, WeakMap, WeakSet) : celle qu'elle range
// pour cet objet — `x` si elle le tient tel quel, sinon sa forme brute ou la clé enveloppée que retrouve son index (µ._mjs_keyAlt) ;
// la brute s'il n'y est sous aucune forme, que `set` et `add` rangent : une seule entrée par objet. Une valeur simple, une fonction :
// telles quelles
// <development>
const _mjsBothForms = new WeakSet();  // Map ou Set déjà signalé : il tient un objet sous ses deux formes
// </development>
µ._mjs_keyIn = (o, x, r) => {
  if (x === null || typeof x !== 'object') return x;
  if (!o.has(x)) return µ._mjs_keyAlt(o, x) ?? µ._mjs_toRaw(x);
  // <development>
  // la collection tient aussi la forme brute (faite hors de MJS) : deux entrées pour un objet, qu'un parcours rend sous la même
  // enveloppe ; dit une fois par collection
  if ((r = µ._mjs_toRaw(x)) !== x && o.has(r) && !_mjsBothForms.has(o)) {
    _mjsBothForms.add(o);
    µ.warn(µ._mjs_msg('mapKeyBothForms', {}, 'Une `Map` ou un `Set` de l\'état tient le même objet sous ses deux formes, brut et sous son enveloppe : `get`, `set`, `add` et `delete` prennent l\'entrée de l\'enveloppe, et un parcours rend cet objet deux fois. Gardez une seule forme par objet : quand la collection ne le tient pas encore, MJS range la forme brute. Cet avertissement n\'existe qu\'en développement.'));
  }
  // </development>
  return x;
};
// objet `x` qu'une collection `o` de l'état ne tient pas tel quel : sa forme brute si elle la tient, sinon la clé rangée sous une
// enveloppe (`new Map([[$rows[0], 1]])`, `new Set($s)`, `new Map($m)` faits dans un composant, un magasin ou une rune) que retrouve
// l'INDEX PARESSEUX de la collection (brute → clé rangée), fait au premier objet qu'elle ne tient sous aucune de ces deux formes, en un
// seul parcours ; rien sinon. La collection reste celle qu'on a rangée, jamais copiée ni parcourue à l'affectation : la même pour
// toutes les variables, composants et magasins qui la tiennent. Celle qui ne tient aucune clé enveloppée (WeakMap, WeakSet compris,
// qu'on ne parcourt pas) est notée `false` : un raté n'y coûte ensuite qu'une lecture du carnet. Les écritures de MJS rangent la forme
// brute, trouvée sans l'index ; celles qui retirent une entrée (`delete`) ou vident la collection (`clear`) font oublier à l'index
// l'entrée retirée, ou tout (µ._mjs_keyDrop) : il ne retient rien de ce que la collection ne tient plus ; `µrefresh` oublie tous les
// index (changement fait hors de MJS, cf. µ._mjs_refresh, mjs_element.ts). L'index lui-même est une `WeakMap` (brute → clé rangée) : une
// entrée retirée hors de MJS, sans `µrefresh` (`clear` sur la collection gardée sans `$`), n'y retient pas son objet non plus
µ._mjs_keyIdx = new WeakMap();
µ._mjs_keyAlt = (o, x, r, i, k) => {
  if (x === null || typeof x !== 'object') return;
  if ((r = µ._mjs_toRaw(x)) !== x && o.has(r)) return r;
  if ((i = µ._mjs_keyIdx.get(o)) === void 0) {
    i = false;
    if (o instanceof Map || o instanceof Set) for (k of o.keys()) if (k !== (x = µ._mjs_toRaw(k))) (i ||= new WeakMap()).set(x, k);
    µ._mjs_keyIdx.set(o, i);
  }
  if (i && (k = i.get(r)) !== void 0) {
    if (o.has(k)) return k;
    i.delete(r);
  }
};
// écriture de MJS qui vide une collection `o` de l'état (`clear`, `c` vrai) ou en retire la clé rangée `k` (`delete`) : son index oublie
// tout, ou l'entrée qui menait à `k` — une clé que la collection tient encore sous une autre forme garde la sienne
µ._mjs_keyDrop = (o, c, k, i) => {
  if (c) µ._mjs_keyIdx.delete(o);
  else if ((i = µ._mjs_keyIdx.get(o)) && i.get(c = µ._mjs_toRaw(k)) === k) i.delete(c);
};
// </collections>
// relais d'une fonction de l'appli lue par une enveloppe (état d'un composant, µ.Store) : `f` la fonction, `p` l'enveloppe de l'objet
// qui la range, `n` prévient après une écriture. Appelé seul ou passé en rappel (`g := $outil.double; g()`, `l.map($outil.double)`), il
// appelle `f` avec `p` pour `this`, comme une méthode liée ; `new` construit `f`. Un champ se lit dans `f`, et s'y écrit, s'y supprime
// ou s'y définit par toute variable qui tient le relais (`f := $outil.format; f.appels = 10`) : `n` prévient, l'écran suit, comme pour
// un objet gardé par une variable. Noms réservés refusés et prototype fixe, comme par l'enveloppe d'un objet. Son prototype, par
// `__proto__` comme par `Object.getPrototypeOf`, est la fonction même, comme pour la copie liée d'avant : jamais `Function.prototype`,
// qu'une clé venue de l'extérieur (`$outil.format[cle]`, `cle` valant `'__proto__'`) atteindrait sinon d'un seul pas, ni la classe
// mère d'une classe. Lu ou écrit par une classe qui en hérite (`class B extends $outil.A`, puis `B.x`, `B.x = 1`), il garde le
// sens de JavaScript : l'accesseur reçoit `B` pour `this`, l'écriture se pose sur `B`
// fonction du navigateur `f` rangée dans l'objet brut `o` de l'état (`$o.attendre = setTimeout`, `$o.slice = [].slice`), lue par une
// enveloppe (composant, µ.Store) : sa copie, une par fonction (`_mjsNatCopies`), la même à chaque lecture, qui appelle `f` avec le
// `this` qu'elle reçoit, comme JavaScript — un appel seul n'en donne aucun, `call`, `apply` et `bind` le leur. Une fonction propre à la
// fenêtre (`setTimeout`, `fetch`, `requestAnimationFrame` : `hasOwnProperty`, hérité d'`Object.prototype`, n'en est pas), appelée comme
// méthode d'un objet qui la range (`$o.attendre(f, 10)`, l'enveloppe ou l'objet brut pour `this`), reçoit le `this` d'un appel seul, là
// où JavaScript lèverait ; les objets qui la rangent sont notés (`h`), au plus une comparaison par appel pour toute autre fonction.
// `new` construit `f`, `instanceof` la reconnaît ; la copie n'a pas de prototype à elle (une classe n'en hérite pas), ce qu'on y écrit
// reste sur elle : ni `f` ni son `prototype` ne s'atteignent par elle
const _mjsNatCopies = new WeakMap();
µ._mjs_natCopy = (f, o) => {
  let e = _mjsNatCopies.get(f);
  if (e === void 0) {
    const h = globalThis[f.name] === f && Object.prototype.hasOwnProperty.call(globalThis, f.name) ? new WeakSet() : null;
    const c = function(...a) {
      return new.target ? Reflect.construct(f, a, new.target === c ? f : new.target) : f.apply(h !== null && this != null && h.has(µ._mjs_toRaw(this)) ? void 0 : this, a);
    };
    c.prototype = void 0;
    Object.defineProperties(c, { [Symbol.hasInstance]: { value: (x) => x instanceof f }, name: { value: f.name }, length: { value: f.length } });
    _mjsNatCopies.set(f, e = [c, h]);
  }
  if (e[1] !== null) e[1].add(o);
  return e[0];
};
µ._mjs_fnRelay = (f, p, n) => {
  const r = new Proxy(f, {
    get: (t, k, c) => k === µ._mjs_RAW || k === '__proto__' ? t : Reflect.get(t, k, c === r ? t : c),
    getPrototypeOf: (t) => Object.isExtensible(t) ? t : Object.getPrototypeOf(t),
    apply: (t, _, a) => Reflect.apply(t, p, a),
    construct: (t, a, c) => Reflect.construct(t, a, c === r ? t : c),
    set(t, k, v, c) {
      if (c !== r) return Reflect.set(t, k, v, c);
      if (µ._mjs_safeKey(k) && t[k] !== (v = µ._mjs_rawIn(v))) {
        t[k] = v;
        n();
      }
      return true;
    },
    deleteProperty(t, k) {
      if (µ._mjs_safeKey(k) && k in t) {
        delete t[k];
        n();
      }
      return true;
    },
    defineProperty(t, k, d) {
      if (!µ._mjs_safeKey(k) || !Reflect.defineProperty(t, k, d)) return false;
      n();
      return true;
    },
    setPrototypeOf: () => false
  });
  return r;
};
// </wrapper-helpers>

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
  // <fine-grained>
  µ._mjs_extW++;
  // </fine-grained>
  return e;
};
// <fine-grained>
// lignes propres (mise à jour fine, mjs_for.ts) : écritures d'objets faites par MJS, toutes origines — magasin, µ.state, enveloppe d'un
// composant, objet partagé (`µ._mjs_bumpEpoch`), écriture profonde compilée (mjs_deep.ts). Un composant ne voit pas ce qu'un autre
// écrit dans un objet qu'il montre aussi : une liste reste propre tant que les seules écritures faites depuis sa passe sont les siennes
µ._mjs_extW = 0;
// une liste aux lignes propres est passée dans la page (`_mjs_isClean`, mjs_for.ts) : seul lecteur des comptes d'une écriture profonde
// compilée (`_mjsFineCount`, mjs_deep.ts), qui ne se tiennent qu'à partir d'elle. Jamais baissé
µ._mjs_fineL = 0;
// </fine-grained>
// <ledger>
// carnet des objets gardés (tenu par les composants, cf. _mjsLedgerSet, mjs_element.ts) : objet brut → composants dans la page qui le
// tiennent dans une variable `$`. Posé ici, avec les époques, avant tout fichier qui écrit l'état dès le chargement du cœur (`µ.url` du
// routeur, magasin, état de module) : leurs écritures le lisent quel que soit l'ordre des fichiers, et un objet que personne ne tient
// n'y coûte qu'une lecture
var _mjsLedger = µ._mjs_ledger = new WeakMap();
// objet `x` écrit, ou traversé par l'écriture : son époque avance une fois, et chaque variable qui le tient encore est prévenue comme si
// son composant l'avait écrit — l'objet que le parent lui repose ensuite est un écho. Une entrée périmée (variable qui a pris un autre
// objet sans passer par `_set`) ne redessine rien. Coût par composant qui tient l'objet : une lecture de `_mjs_rootsByTarget`, puis par
// variable qui l'a atteint un déballage et une comparaison
µ._mjs_ledgerSees = function(x) {
  var s = _mjsLedger.get(x), e, el, rs, b, k;
  if (s === void 0 || s.size === 0) return;
  µ._mjs_epochs.set(x, e = (µ._mjs_epochs.get(x) || 0) + 1);
  for (el of s) {
    rs = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(x);
    if (rs === void 0) continue;
    b = el._mjs_bindEpochs || (el._mjs_bindEpochs = {});
    // les clés de sa fiche (cf. `_mjs_wrapDeep`, mjs_element.ts)
    for (k of rs.s || [rs.r]) {
      if (b[k] === e || µ._mjs_toRaw(el._state[k]) !== x) continue;
      b[k] = e;
      el._mjs_notifyMutation(k, el._state[k]);
    }
  }
};
// </ledger>

// <snapshot>
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
// </snapshot>

// <derived-values>
// <precision>
µ._mjs_setComputed = function(el, k, fn, src) {
  return el._mjs_setComputed(k, fn, src);
// </precision>
// <clock>
// µ._mjs_setComputed = function(el, k, fn) {
  // return el._mjs_setComputed(k, fn);
// </clock>
};
// </derived-values>

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
// <longest-run>
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
// </longest-run>

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

// <fine-grained>
// mise à jour fine (mjs_deep.ts) : les liaisons d'un champ écrit, jouées comme celles de la variable sur la voie directe d'une écriture
// (`_mjs_invalidate`, mjs_element.ts)
µ._mjs_fineRun = function(el, fns) {
  var i;
  µ._mjs_inEffect = true;
  try {
    for (i = 0; i < fns.length; i++) fns[i].call(el);
  } catch (e) {
    el._mjs_catchError(e);
  } finally {
    µ._mjs_inEffect = false;
  }
};
// </fine-grained>

// <loops>
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
      // <fine-grained>
      // puis les liaisons des champs écrits pendant la boucle (mise à jour fine, mjs_deep.ts), une fois chacune ; un rendu demandé
      // entre-temps les emmène à son heure, avec leur variable entière, comme sur le chemin ordinaire. Le champ ne naît qu'avec elle
      // (`µ._mjs_lqFine`) : rien n'est écrit sur un composant qui ne l'a pas, dont la forme reste celle que sa boucle optimisée a vue
      // (un champ neuf à la sortie de la première boucle désoptimise la suivante, qui fabrique alors à chaque écriture le tableau du chemin)
      var fs = el._mjs_lqf;
      if (fs) el._mjs_lqf = null;
      if (fs && el._mjs_render_scheduled) new Set(fs.values()).forEach(function(k) { el._mjs_invalidate(k); });
      else if (fs && !el._mjs_has_crashed) µ._mjs_fineRun(el, Array.from(fs.keys()));
      // </fine-grained>
    } catch (e) {
      queueMicrotask(function() { throw e; });
    }
  }
};
// <fine-grained>
// mise à jour fine dans une boucle qui écrit l'état (mjs_deep.ts) : les liaisons du champ écrit (`fns`, de la variable `k`) attendent
// la sortie, une fois chacune ; le composant entre dans la file comme pour un nom noté
µ._mjs_lqFine = function(el, fns, k) {
  var s = el._mjs_lqf, i;
  if (!el._mjs_lqk) {
    el._mjs_lqk = new Set();
    µ._mjs_lqq.push(el);
  }
  if (!s) s = el._mjs_lqf = new Map();
  for (i = 0; i < fns.length; i++) s.set(fns[i], k);
};
// </fine-grained>
// </loops>

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

// HTML que MJS fabrique lui-même (gabarits compilés, morceaux du cœur) → valeur de confiance de la politique Trusted Types
// `mjs`, créée au premier appel là où le navigateur connaît Trusted Types ; ailleurs, la chaîne telle quelle. Une page qui
// refuse de la créer (sa liste `trusted-types …` sans `mjs`, `'none'`, ou une politique `mjs` déjà posée) reçoit la chaîne, comme
// sans Trusted Types : l'aide devient l'identité, la création n'est plus retentée, et un seul avertissement dit d'ajouter `mjs` ;
// la page qui n'exige pas Trusted Types se monte, celle qui les exige (`require-trusted-types-for`) fait passer ces chaînes par
// sa politique `default`, qui peut les modifier, ou garde le refus du navigateur.
// Jamais pour le HTML d'auteur (`{{…}}`, `@html`, `html` d'une modale) : lui passe par la politique de la page, ou il est refusé.
// `tt` : jamais passé par l'appelant, l'usine du navigateur relue à chaque appel (absente côté serveur). `_mjsTplCache` : le contenu
// des gabarits lus par `_mjsTpl` ci-dessous, par HTML littéral (une seule déclaration pour les deux : quelques octets de moins)
var _mjsTTPolicy, _mjsTplCache = new Map();
µ._mjs_th = (html, tt = window.trustedTypes) => {
  try {
    return tt ? (_mjsTTPolicy ||= tt.createPolicy('mjs', { createHTML: (s) => s })).createHTML(html) : html;
  }
  catch (e) {
    µ.warn(µ._mjs_msg('ttPolicy', null, 'la page refuse de créer la politique Trusted Types « mjs » du framework : son en-tête Content-Security-Policy liste ses politiques (trusted-types …) sans « mjs », ou une politique « mjs » existe déjà. Le framework écrit alors son HTML en simple chaîne : la page s\'affiche tant qu\'elle n\'exige pas Trusted Types ; sous require-trusted-types-for \'script\', ce HTML passe par la politique « default » de la page, qui peut le modifier ; sans elle, le navigateur le refuse et aucun composant ne se monte. Ajoutez « mjs » à la liste trusted-types de l\'en-tête (avec \'allow-duplicates\' si deux scripts de la page créent cette politique).'), e);
    µ._mjs_th = (s) => s;
    return html;
  }
};

function _mjsTpl(html) {
  var tpl = _mjsTplCache.get(html), svg;
  if (!tpl) {
    tpl = document.createElement('template');
    // tags SVG seuls : parsés dans un <svg> jetable pour namespacer les enfants, puis remontés à la racine du content (le
    // déplacement garde le namespace, cloneNode(true) aussi)
    svg = µ._mjs_svgTagRe.test(html);
    tpl.innerHTML = µ._mjs_th(svg ? '<svg>' + html + '</svg>' : html);
    if (svg) tpl.content.replaceChildren(...tpl.content.firstChild.childNodes);
    _mjsTplCache.set(html, tpl = tpl.content);
  }
  return tpl;
}
// copie d'un gabarit compilé : son fragment entier, ou, pour une ligne de liste à racine unique, cet élément seul (le compilateur
// choisit, cf. generateCloneFnBody). Une liste clone le même gabarit ligne après ligne : son élément est gardé d'un appel au suivant
// (`_mjsLastEl`, celui du HTML `_mjsLastHtml`), sans le relire dans la table ni dans son fragment. Bloc gardé pour l'appli dont une ligne
// se copie ainsi (`<line-copy>`, cf. ROW_CLONE, bundler/features.ts) : sans lui, la copie relit son gabarit à chaque appel
// <line-copy>
var _mjsLastHtml, _mjsLastEl;
// </line-copy>
µ._mjs_cloneTpl = (html) => _mjsTpl(html).cloneNode(true);
// <line-copy>
µ._mjs_cloneEl  = (html) => (html === _mjsLastHtml ? _mjsLastEl : _mjsLastEl = _mjsTpl(_mjsLastHtml = html).firstChild).cloneNode(true);
// </line-copy>
// <no-line-copy>
// µ._mjs_cloneEl  = (html) => _mjsTpl(html).firstChild.cloneNode(true);
// </no-line-copy>

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
