// mjs_devpanel — le panneau d'inspection, dans la page, en développement.
//
// N'EST PAS DANS LE BUNDLE DE PRODUCTION : le bundler n'ajoute ce fichier (et mjs_devinspect,
// juste avant lui) qu'aux builds non-prod, exactement comme mjs_debug (cf. bundler/index.ts,
// insertion juste avant mjs_flip). Zéro poids et zéro test de garde en prod : le code n'y est
// simplement pas.
//
// Ce qu'il montre, et que personne d'autre ne peut montrer : la réactivité de MJS est
// résolue À LA COMPILATION, donc le graphe des dépendances est connu. Chaque composant
// embarque déjà `_mjs_computedDeps` (`{ total: ['price','quantity'] }`) et `_mjs_effectsByVar`.
// Le panneau répond donc à la seule question qui compte quand un écran reste figé :
// « de quoi ce dérivé dépend-il, et cette variable-là en fait-elle partie ? »
//
// Ancré en bas de la fenêtre par défaut (`_dpGeo.mode === 'bas'`), page visible en permanence
// derrière, sans écran assombri par-dessus. Déplaçable (poignée = la `.bar`) et redimensionnable (`.grip-h`
// en bas, `.grip-c` en flottant) ; la géométrie vit dans `_dpGeo`, persistée en `localStorage`
// (`_dpGeoReread`/`_dpGeoWrite`), et se ré-applique à chaque `_dpRender()` (`_dpGeoApply`).
// `Échap` (dans le panneau) referme, le focus entre à l'ouverture et revient d'où il venait à la fermeture
// (`role="dialog"`, sans `aria-modal` : ce n'est plus une modale). Le
// volet de droite est en onglets (État/Dérivés/Liaisons/Contexte/Attributs et props/Style et
// thème/Effets) ; l'onglet État réutilise mjs_devinspect (µ._mjs_diRender) directement sur `_state` — une
// valeur composée s'y déplie EN PLACE avec le même moteur, c'est la « combinaison des deux
// outils » demandée. Seul cas spécial : écrire une clé de PREMIER NIVEAU de `_state` doit passer
// par `el._set` (computeds/limites/etc en dépendent) — mjs_devinspect l'ignore, on le lui donne
// via `onWriteRoot`. Plus profond dans un objet d'état, l'affectation directe suffit déjà :
// la réactivité MJS est profonde par défaut (filet `_mjs_wrapDeep`, mjs_element.ts).
//
// Ouverture : Ctrl+Shift+Espace (aucun navigateur ne le prend ; bascule), ou la rune `µconsole`,
// seule porte d'entrée publique — sans argument elle ouvre, avec un sélecteur CSS ou un élément
// elle ouvre sur ce composant (cherche aussi dans les Shadow DOM imbriqués, cf. `_dpResolve`,
// puisque `µ.instances` est déjà plat), avec une autre valeur elle ouvre l'inspecteur générique,
// avec `false` elle ferme. Écrite dans un composant, le compilateur en fait `µ.console(_mjsThis)`
// (appel gardé, rien en production) : le panneau s'ouvre sur CE composant ; tapée dans la console
// du navigateur, c'est l'accesseur `window.µconsole` posé en bas de ce fichier. Raccourci
// changeable par `µ.config.devPanelKey` (`e.code` d'une touche). Le bouton « cibler » de la barre
// désigne un composant d'un clic dans la page.
//
// Arbre : un double-clic sur un composant ouvre ou ferme sa branche, comme sa flèche ▸/▾. En
// tête, l'entrée « stores ($$) » montre `µ.store` dans l'inspecteur générique : une clé s'écrit
// par son accesseur (`µ._storeSet`, qui prévient), une valeur plus profonde par affectation
// directe PUIS `µ._mjs_storeNotifyKey` — un store n'a pas de filet réactif, ses objets sont bruts.

var _dpHost = null, _dpRoot = null, _dpTimer = null, _dpSelected = null, _dpHighlight = null;
var _dpTab = 'state', _dpObject = null, _dpFocusPrecedent = null;
var _dpView = null;   // 'stores' ou 'effets' quand l'entrée du même nom est choisie dans l'arbre, sinon null (un composant)
var _dpTreeFolded = new Set();   // uids de composants REPLIÉS dans l'arbre — vide = tout déplié (comportement historique)
var _dpSignaturePrev = '';   // quel volet a été rendu au tour d'avant — cf. la préservation du défilement dans `_dpRender`
var _dpPointer = false;   // un bouton du pointeur enfoncé dans le panneau — cf. `_dpTick`
var _dpFocusRestored = null;   // le contrôle d'un réglage dont le panneau vient de rendre le focus, tant qu'on n'y a pas retouché — cf. `_dpFocusRestore`

// géométrie du panneau — PERSISTE entre deux `_dpRender()` (qui réécrit tout l'innerHTML
// toutes les 700 ms) : le style est ré-appliqué à chaque rendu depuis cet objet
var _dpGeo          = { mode: 'bottom', h: 320, x: 40, y: 40, w: 720 };
var _dpDrag         = null;   // pointeur en cours de déplacement/redimensionnement, sinon null
var _dpGeoWasReread = false;   // la relecture du stockage est PARESSEUSE — cf. _dpGeoReread

// registre des rendus — mjs_debug enveloppe déjà `_mjs_runEffectsV2` pour la télémétrie
// visuelle ; on compte ici, sur le même point de passage, sans le doubler
if (µ.Element && !µ.Element.prototype._mjs_dpCounted) {
  µ.Element.prototype._mjs_dpCounted = true;
  var _dpOriginalRun = µ.Element.prototype._mjs_runEffectsV2;
  µ.Element.prototype._mjs_runEffectsV2 = function(d, full) {
    this._mjs_renderCount = (this._mjs_renderCount || 0) + 1;
    return _dpOriginalRun.call(this, d, full);
  };
}

// « mises à jour » : chaque morceau de la page que MJS réécrit s'éclaire — un texte réécrit éclaire sa
// balise, un attribut réécrit la sienne, ce qui ne bouge pas reste sombre. Tant que le mode est coché
// (panneau fermé compris), les racines des composants et la page sont observées ; les calques des
// effets, les nœuds qu'ils posent (`mjs-fx-…`) et leurs marques (`mjs-*`, le style d'une balise qui porte un effet) ne comptent pas.
// L'éclair : *flash (µ._mjs_fxFlash, embarqué dans tout cœur de développement) avec sa couleur, sa
// durée, son style, ou un autre effet du cœur qui se joue une fois. Réglages gardés (localStorage) ;
// le mode lui-même repart décoché à chaque chargement.
var _dpUpd          = { on: false, fx: 'flash', color: '#facc15', duration: 600, style: 'outline' };
var _dpUpdWasReread = false;
var _dpUpdObs       = new Map();   // racine observée → MutationObserver
var _dpUpdQueue     = new Set();   // balises à éclairer à la prochaine image
var _dpUpdTimer     = 0;
var _dpUpdImage     = 0;
var _dpUpdMuted     = new WeakSet();   // balises où le panneau joue un effet : les attributs qu'il y réécrit ne comptent pas

function _dpUpdReread() {
  if (_dpUpdWasReread) return;
  _dpUpdWasReread = true;
  try {
    var v = JSON.parse(localStorage.getItem('mjs-devpanel-upd') || 'null');
    if (v && typeof v === 'object') ['fx', 'color', 'duration', 'style'].forEach(function(k) { if (v[k] !== void 0) _dpUpd[k] = v[k]; });
  }
  catch {}
}

function _dpUpdWrite() {
  try {
    localStorage.setItem('mjs-devpanel-upd', JSON.stringify({ fx: _dpUpd.fx, color: _dpUpd.color, duration: _dpUpd.duration, style: _dpUpd.style }));
  }
  catch {}
}

// un calque d'effet, le panneau ou son calque de surlignage : rien de la page
function _dpUpdOffPage(n) {
  return n.nodeType === 1 && (n.hasAttribute('mjs-fx-layer') || n.hasAttribute('data-mjs-devpanel') || n.hasAttribute('data-mjs-devpanel-highlight'));
}

// un nœud qu'un effet pose (un `<canvas mjs-fx-dissolve-dust>` ajouté au `<body>`, une lettre `mjs-fx-letter`…) porte un
// attribut `mjs-fx-…` : l'ajouter, le retirer ou le réécrire n'est pas une mise à jour ; une balise habillée d'un effet
// (`mjs-fx`, et ses marques `mjs-fx-<effet>-<réglage>`) reste une balise de la page
function _dpUpdateEffectNode(n) {
  if (n.nodeType !== 1 || n.hasAttribute('mjs-fx')) return false;
  return Array.prototype.some.call(n.attributes, function(a) { return a.name.indexOf('mjs-fx-') === 0; });
}

// seuls des calques d'effets, des nœuds d'effets ou des éléments du panneau glissés ou retirés : rien que MJS ait réécrit
function _dpUpdLayers(m) {
  if (m.addedNodes.length + m.removedNodes.length === 0) return false;
  var outside = function(n) { return _dpUpdOffPage(n) || _dpUpdateEffectNode(n); };
  return Array.prototype.every.call(m.addedNodes, outside) && Array.prototype.every.call(m.removedNodes, outside);
}

// la balise qu'une mutation désigne, si c'est une mise à jour de MJS ; null sinon
function _dpUpdTarget(m) {
  var t = m.type === 'characterData' ? m.target.parentNode : m.target;
  if (!t || t.nodeType !== 1 || _dpUpdateEffectNode(t)) return null;
  if (m.type === 'attributes') {
    var a = m.attributeName || '';
    if (/^mjs-/.test(a) || (a === 'style' && t.hasAttribute('mjs-fx')) || _dpUpdMuted.has(t)) return null;
  }
  if (m.type === 'childList' && _dpUpdLayers(m)) return null;
  for (var p = t; p && p.nodeType === 1; p = p.parentNode) {
    if (_dpUpdOffPage(p)) return null;
  }
  return t;
}

// un effet de l'appli : chargé, ou son fichier connu (il arrive à la demande, cf. mjs_fx.ts)
function _dpFxAvailable(n) {
  return !!(µ._mjs_fxDefs && (µ._mjs_fxDefs[n] || (µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, 'mjs_fx_' + n.replace(/-/g, '_')))));
}

// les effets de l'appli qui se jouent une fois, proposés à la place de l'éclair
function _dpUpdEffects() {
  var cat = µ._mjs_fxCatalog || {};
  return Object.keys(cat).filter(function(n) {
    var on = cat[n].s && cat[n].s.on;
    return n !== 'flash' && on && on[0][0] === 'l' && on[0][1].indexOf('load') >= 0 && _dpFxAvailable(n);
  }).sort();
}

function _dpUpdHighlight() {
  _dpUpdImage = 0;
  var file = Array.from(_dpUpdQueue);
  _dpUpdQueue.clear();
  file.forEach(function(t) {
    if (!t.isConnected) return;
    var fx = _dpUpd.fx;
    if (fx !== 'flash' && _dpFxAvailable(fx) && typeof µ._mjs_fx === 'function') {
      // un effet que la balise porte déjà (écrit dans l'appli) n'est pas repris ni retiré
      if (t._mjs_fxOff && t._mjs_fxOff[fx]) return;
      var r = t.getRootNode();
      // l'effet écrit dans le style de la balise, son retrait l'efface : ces écritures relançaient
      // l'effet à chaque retrait, sans fin — la balise reste muette tant qu'il dure, et jusqu'à ce
      // que l'observateur ait lu le retrait (le tour d'après)
      _dpUpdMuted.add(t);
      var off = µ._mjs_fx(r && r.host ? r.host : null, t, fx, { on: 'load' });
      if (!off) {
        _dpUpdMuted.delete(t);
        return;
      }
      setTimeout(function() {
        off();
        setTimeout(function() { _dpUpdMuted.delete(t); }, 0);
      }, Math.max(100, +_dpUpd.duration || 600) + 400);
      return;
    }
    if (typeof µ._mjs_fxFlash === 'function') µ._mjs_fxFlash(t, { color: _dpUpd.color, duration: +_dpUpd.duration || 600, style: _dpUpd.style });
  });
}

// les racines à observer : la page, et chaque composant monté (les nouveaux sont repris à chaque tour) ; un léger, qui est sa propre
// ombre, l'est avec l'arbre qui le porte, sa racine d'ombre native à part s'il en porte une
function _dpUpdTrack() {
  var roots = [document.body];
  µ.instances.forEach(function(el) {
    var r = µ._mjs_shadowOf(el);
    if (r && el.isConnected) roots.push(r);
  });
  roots.forEach(function(r) {
    if (!r || _dpUpdObs.has(r)) return;
    var mo = new MutationObserver(function(list) {
      for (var i = 0; i < list.length; i++) {
        var t = _dpUpdTarget(list[i]);
        if (t) _dpUpdQueue.add(t);
      }
      if (_dpUpdQueue.size > 0 && !_dpUpdImage) _dpUpdImage = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(_dpUpdHighlight) : setTimeout(_dpUpdHighlight, 16);
    });
    mo.observe(r, { childList: true, characterData: true, attributes: true, subtree: true });
    _dpUpdObs.set(r, mo);
  });
  // les composants partis : leur racine n'est plus suivie
  _dpUpdObs.forEach(function(mo, r) {
    if (r !== document.body && !(r.host && r.host.isConnected)) {
      mo.disconnect();
      _dpUpdObs.delete(r);
    }
  });
}

function _dpUpdToggle(on) {
  _dpUpd.on = on;
  if (on) {
    _dpUpdTrack();
    if (!_dpUpdTimer) _dpUpdTimer = setInterval(_dpUpdTrack, 1000);
    return;
  }
  clearInterval(_dpUpdTimer);
  _dpUpdTimer = 0;
  _dpUpdObs.forEach(function(mo) { mo.disconnect(); });
  _dpUpdObs.clear();
  _dpUpdQueue.clear();
}

/** Nom court d'une instance : `mjs-my-counter` → `my-counter`. */
function _dpName(el) {
  return el.tagName.toLowerCase().replace(/^mjs-/, '');
}

// identifiant STABLE par instance — namespace des chemins dépliés dans mjs_devinspect, et clé
// de repli/dépli de l'arbre. Un WeakMap plutôt qu'une propriété posée sur l'élément : zéro
// risque de collision avec une clé `_state`/`_mjs_var_bits` du composant lui-même
var _dpUidMap = new WeakMap(), _dpNextUid = 1;
function _dpUid(el) {
  var id = _dpUidMap.get(el);
  if (!id) { id = _dpNextUid++; _dpUidMap.set(el, id); }
  return id;
}

/** L'instance MJS la plus proche AU-DESSUS de `el`, frontières d'ombre franchies. */
function _dpParent(el) {
  var node = el.parentNode;
  while (node) {
    if (node.nodeType === 11) { node = node.host; continue; }
    if (node instanceof µ.Element) return node;
    node = node.parentNode;
  }
  return null;
}

/** Arbre des instances vivantes : [{el, children:[…]}], racines d'abord. */
function _dpTree() {
  var live = [];
  µ.instances.forEach(function(el) { if (el.isConnected) live.push(el); });
  var nodes = new Map();
  live.forEach(function(el) { nodes.set(el, { el: el, children: [] }); });
  var roots = [];
  live.forEach(function(el) {
    var parent = _dpParent(el);
    if (parent && nodes.has(parent)) nodes.get(parent).children.push(nodes.get(el));
    else roots.push(nodes.get(el));
  });
  return roots;
}

// `matches` de la balise, insensible à une méthode du composant du même nom (cf. mjs_element.ts)
µ._mjs_matches = µ._mjs_matches || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.matches.call(n, sel);
  return !!n && typeof n.matches === 'function' && n.matches(sel);
};

/** Vrai si `selecteur` matche un ANCÊTRE de `el` (frontières d'ombre franchies). */
function _dpAncestorMatch(el, selector) {
  var node = el.parentNode;
  while (node) {
    if (node.nodeType === 11) { node = node.host; continue; }
    if (node.nodeType === 1 && µ._mjs_matches(node, selector)) return true;
    node = node.parentNode;
  }
  return false;
}

/**
 * L'instance que `selecteur` désigne, en descendant `µ.instances` — déjà PLAT (il contient
 * toute instance connectée, quelle que soit sa profondeur d'imbrication en Shadow DOM, cf.
 * mjs_debug.ts) : un `document.querySelector` seul ne verrait pas un composant niché derrière
 * une frontière d'ombre fermée, cette liste si. Retient la PREMIÈRE instance qui `matches()`
 * elle-même — en priorité —, sinon dont un ANCÊTRE matche (un sélecteur peut désigner une section
 * qui enveloppe le composant sans être lui, ex. `.panier` autour d'un `<mjs-cart-item>`). Ordre de parcours =
 * ordre d'insertion dans `µ.instances`, donc globalement l'ordre de CONNEXION des composants —
 * documenté ici pour qui s'attendrait à un ordre visuel strict (pas garanti à travers plusieurs
 * arbres de Shadow DOM indépendants). Sélecteur invalide : aucune correspondance, jamais un crash.
 */
function _dpResolve(selector) {
  var candidates = Array.from(µ.instances).filter(function(el) { return el.isConnected; });
  try {
    // d'abord une instance que le sélecteur désigne ELLE-MÊME : un enfant enregistré avant son
    // parent l'emportait sinon (son ancêtre matche aussi), `µconsole 'mjs-parent'` ouvrait sur l'enfant
    for (var i = 0; i < candidates.length; i++) {
      if (µ._mjs_matches(candidates[i], selector)) return candidates[i];
    }
    for (var j = 0; j < candidates.length; j++) {
      if (_dpAncestorMatch(candidates[j], selector)) return candidates[j];
    }
  } catch { /* sélecteur invalide : aucune correspondance, jamais un crash */ }
  return null;
}

/** Valeur lisible et courte, pour une ligne de tableau (délègue à l'inspecteur générique). */
function _dpPreview(v) {
  return µ._mjs_diPreview(v);
}

// `_mjs_computedKeys` est un TABLEAU de noms (cf. `_mjs_setComputed`, mjs_element.ts), pas une
// table — s'y tromper listerait les indices `0`, `1`… à la place des dérivés
/** Les clés d'état PROPRES au composant, sans les dérivés ni la plomberie. */
function _dpStateKeys(el) {
  var state = el._state || {};
  var derives = new Set(el._mjs_computedKeys || []);
  // l'état ne porte que les variables du composant, aucune clé interne : seuls les dérivés sont retirés. `$_x` est un nom de
  // var d'état valide (SIGIL_ID autorise `_` en 1re position, c'est même l'exemple du framework pour µread/µwrite) : listé
  return Object.keys(state).filter(function(k) { return !derives.has(k); }).sort();
}

// texte de la règle d'une variable ou d'un store typé (bloc <vars>, présent hors production)
function _dpRule(rules, k) {
  return rules && Object.prototype.hasOwnProperty.call(rules, k) ? rules[k].d : void 0;
}

function _dpDeriveKeys(el) {
  return (el._mjs_computedKeys || []).slice().sort();
}

/** Surligne l'élément dans la page, sans toucher à son style à lui. */
function _dpSurligner(el) {
  if (!_dpHighlight) {
    _dpHighlight = document.createElement('div');
    _dpHighlight.setAttribute('data-mjs-devpanel-highlight', '');
    _dpHighlight.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #6ea8fe;background:rgba(110,168,254,.15);border-radius:3px;transition:all .08s';
    document.body.appendChild(_dpHighlight);
  }
  if (!el) { _dpHighlight.style.display = 'none'; return; }
  var r = el.getBoundingClientRect();
  _dpHighlight.style.display = 'block';
  _dpHighlight.style.left   = r.left + 'px';
  _dpHighlight.style.top    = r.top + 'px';
  _dpHighlight.style.width  = r.width + 'px';
  _dpHighlight.style.height = r.height + 'px';
}

// Relit `_dpGeo` depuis `localStorage` — stockage absent, refusé ou valeur corrompue : on garde
// les valeurs par défaut, jamais de plantage.
//
// DEUX précautions, chacune payée par une vraie panne :
//   1. PARESSEUSE — appelée à l'OUVERTURE du panneau, jamais au chargement du module. Le module
//      est concaténé dans le core de tout bundle de développement : une exception ici tuait le
//      RESTE du core (`µ.instances` jamais posé, `µ.console` jamais défini), que le développeur
//      ouvre le panneau ou non.
//   2. `typeof localStorage` EST DANS le try — sur un document d'origine opaque (`about:blank`,
//      `page.setContent()` d'un Playwright, iframe sandboxée sans `allow-same-origin`), le simple
//      `typeof` lève un `SecurityError`. La garde `typeof … === 'undefined'` posée DEVANT le try
//      (motif repris de mjs_i18n/mjs_accounts, où l'accès est paresseux et opt-in) ne protège donc
//      rien ici : c'est elle qui jetait.
function _dpGeoReread() {
  if (_dpGeoWasReread) return;
  _dpGeoWasReread = true;
  try {
    if (typeof localStorage === 'undefined') { _dpGeoClamp(); return; }
    var raw = localStorage.getItem('mjs-devpanel-geo');
    if (!raw) { _dpGeoClamp(); return; }
    var read = JSON.parse(raw);
    if (!read || typeof read !== 'object') { _dpGeoClamp(); return; }
    if (read.mode === 'bottom' || read.mode === 'floating') _dpGeo.mode = read.mode;
    if (typeof read.h === 'number') _dpGeo.h = read.h;
    if (typeof read.w === 'number') _dpGeo.w = read.w;
    if (typeof read.x === 'number') _dpGeo.x = read.x;
    if (typeof read.y === 'number') _dpGeo.y = read.y;
  } catch { /* stockage désactivé ou valeur corrompue : on garde les valeurs par défaut */ }
  _dpGeoClamp();
}

/** Écrit `_dpGeo` dans `localStorage` — silencieux si le stockage est indisponible. */
function _dpGeoWrite() {
  // même raison qu'au § 2 de `_dpGeoReread` : le `typeof` lui-même peut lever, il reste DANS le try
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('mjs-devpanel-geo', JSON.stringify(_dpGeo));
  } catch { /* stockage indisponible ou refusé : tant pis */ }
}

/** Ramène `_dpGeo` dans des bornes valides, fenêtre courante comprise. */
function _dpGeoClamp() {
  _dpGeo.h = Math.min(Math.max(_dpGeo.h, 140), Math.max(140, window.innerHeight - 40));
  _dpGeo.w = Math.min(Math.max(_dpGeo.w, 320), Math.max(320, window.innerWidth - 40));
  _dpGeo.x = Math.min(Math.max(_dpGeo.x, 0), Math.max(0, window.innerWidth - 80));
  _dpGeo.y = Math.min(Math.max(_dpGeo.y, 0), Math.max(0, window.innerHeight - 80));
}

// espace RENDU à la page quand le panneau est ancré en bas. La console du navigateur, elle,
// rétrécit le viewport lui-même — aucun script de la page ne peut faire ça. On pose donc un
// padding bas sur l'élément qui défile : la course du défilement s'allonge d'autant, et le bas
// du document redevient atteignable au lieu de rester sous le panneau. Un `position:fixed` de
// la page reste couvert (rien ne peut l'en sortir depuis un script), c'est la seule limite.
var _dpPaddingPrev = null;   // padding bas INLINE d'avant nous, rendu tel quel à la fermeture

function _dpScrollingElement() {
  return document.scrollingElement || document.documentElement;
}

/**
 * Réserve `_dpGeo.h` en bas du document (mode ancré) — DEUX gestes, parce qu'une page peut se
 * mettre en page de deux façons :
 *  1. `padding-bottom` sur l'élément qui défile : allonge la course du défilement. Suffit à une
 *     page qui défile au document (le cas courant) — son bas redevient atteignable.
 *  2. `--mjs-devpanel-h` sur `<html>` (+ l'attribut `data-mjs-devpanel-dock`) : une page dont la
 *     hauteur est celle de la FENÊTRE (`height: 100vh`) ne défile pas, elle est simplement coupée
 *     par le panneau ; le `padding` ne peut rien pour elle. Elle écrit alors
 *     `height: calc(100vh - var(--mjs-devpanel-h, 0px))` et se rétrécit d'elle-même — le seul
 *     moyen depuis un script, le viewport réel n'étant réductible que par le navigateur lui-même.
 */
function _dpReserveSpace() {
  var el = _dpScrollingElement();
  if (el && el.style) {
    if (_dpPaddingPrev === null) _dpPaddingPrev = el.style.paddingBottom || '';
    el.style.paddingBottom = _dpGeo.h + 'px';
  }
  var root = document.documentElement;
  if (root && root.style) {
    root.style.setProperty('--mjs-devpanel-h', _dpGeo.h + 'px');
    root.setAttribute('data-mjs-devpanel-dock', '');
  }
}

/** Rend la place à la page — mode flottant ou panneau fermé. Idempotent. */
function _dpReleaseSpace() {
  var el = _dpScrollingElement();
  if (el && el.style && _dpPaddingPrev !== null) el.style.paddingBottom = _dpPaddingPrev;
  _dpPaddingPrev = null;
  var root = document.documentElement;
  if (root && root.style) {
    root.style.removeProperty('--mjs-devpanel-h');
    root.removeAttribute('data-mjs-devpanel-dock');
  }
}

/** Applique `_dpGeo` en style inline sur le nœud `.panel` — ré-appliqué à chaque rendu, cf. en-tête du fichier. */
function _dpGeoApply(panelEl) {
  if (_dpGeo.mode === 'floating') { panelEl.style.cssText = 'left:' + _dpGeo.x + 'px; top:' + _dpGeo.y + 'px; right:auto; bottom:auto; width:' + _dpGeo.w + 'px; height:' + _dpGeo.h + 'px; border-radius:10px;'; _dpReleaseSpace(); }
  else { panelEl.style.cssText = 'left:0; right:0; bottom:0; top:auto; width:auto; height:' + _dpGeo.h + 'px; border-radius:10px 10px 0 0; border-bottom:0;'; _dpReserveSpace(); }
}

/**
 * Vrai si le focus est DANS un champ de saisie du panneau. Le rendu périodique réécrit tout
 * l'`innerHTML` : sans cette garde, une valeur d'état qu'on tape perdait le focus et le texte
 * en cours toutes les 700 ms — le champ n'existait plus, le caret non plus.
 */
function _dpInputPending() {
  // `activeElement` d'un shadow root peut LEVER hors navigateur (happy-dom remonte à travers
  // les shadow roots frères et finit par déréférencer undefined quand le focus est dans un
  // AUTRE shadow root que le nôtre). Une exception ici sort du callback de `setInterval`, qui
  // ANNULE l'intervalle : le panneau se figerait pour de bon, sans le moindre message. On
  // préfère donc conclure « personne ne saisit » — un rendu de trop, jamais un panneau mort.
  var active;
  try { active = _dpRoot && _dpRoot.activeElement } catch { return false }
  if (!active) return false;
  // le contrôle dont le panneau vient de rendre le focus après un réglage, et auquel on n'a pas retouché : rien n'y est en cours
  if (active === _dpFocusRestored) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable === true;
}

// l'élément du panneau qui a le focus, null sinon — même garde que ci-dessus
function _dpActive() {
  try { return (_dpRoot && _dpRoot.activeElement) || null } catch { return null }
}

// le contrôle d'un réglage qui a le focus, de quoi le retrouver quand le panneau est réécrit : un réglage de l'éclair
// (`data-upd`), ou celui d'un effet (son bloc `data-fx`, sa clé `data-key`) ; null pour tout autre
function _dpFocusMark() {
  var active = _dpActive();
  if (!active || typeof active.hasAttribute !== 'function') return null;
  if (active.hasAttribute('data-upd')) return '[data-upd="' + active.getAttribute('data-upd') + '"]';
  var block = active.hasAttribute('data-key') && active.closest ? active.closest('.fx') : null;
  return block ? '.fx[data-fx="' + block.getAttribute('data-fx') + '"] [data-key="' + active.getAttribute('data-key') + '"]' : null;
}

// rend le focus au contrôle redessiné que `mark` désigne : la réécriture avait détruit celui qui l'avait, le focus tombait
// sur <body> et Échap ne fermait plus le panneau ; sans défilement (le volet reprend sa position juste après) ; tant qu'on
// n'y retouche pas, ce contrôle n'est pas une saisie en cours (cf. `_dpInputPending`) : le battement continue de redessiner, le focus suit
function _dpFocusRestore(mark) {
  var c = mark && _dpRoot ? _dpRoot.querySelector(mark) : null;
  if (!c || typeof c.focus !== 'function') return;
  c.focus({ preventScroll: true });
  _dpFocusRestored = c;
}

// une touche, un appui ou une frappe dans le panneau : on retouche au contrôle, la saisie en cours se protège de nouveau
function _dpFocusRestoredEnd() { _dpFocusRestored = null; }

// une sélection non vide dans une ligne de code du panneau — le repli de « copier l'écriture » la pose pour Ctrl+C, ou on l'a
// faite à la souris : une réécriture du panneau l'effacerait
function _dpSelectionInCode() {
  if (!_dpRoot || typeof window.getSelection !== 'function') return false;
  try {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || String(sel) === '') return false;
    var codes = _dpRoot.querySelectorAll('.fx-code');
    for (var i = 0; i < codes.length; i++) if (sel.containsNode(codes[i], true)) return true;
    // WebKit rapporte une sélection de l'ombre sur son hôte (`containsNode` dit non) : ses vraies bornes viennent de `getComposedRanges`
    if (typeof sel.getComposedRanges === 'function') {
      var ranges = sel.getComposedRanges({ shadowRoots: [_dpRoot] });
      for (var j = 0; j < ranges.length; j++) {
        var rg = document.createRange();
        rg.setStart(ranges[j].startContainer, ranges[j].startOffset);
        rg.setEnd(ranges[j].endContainer, ranges[j].endOffset);
        for (var k = 0; k < codes.length; k++) if (rg.intersectsNode(codes[k])) return true;
      }
    }
  }
  catch { /* une sélection que le navigateur refuse de dire : on redessine comme avant */ }
  return false;
}

// un clic dont l'appui et le relâcher encadraient une réécriture n'atteignait plus son bouton,
// remplacé entre-temps : la réécriture attend le relâcher (où qu'il ait lieu)
function _dpPointerDown() { _dpPointer = true; }
function _dpPointerUp() { _dpPointer = false; }

/** Battement du rafraîchissement périodique : passe son tour tant qu'on saisit (cf. `_dpInputPending`), qu'un bouton du pointeur est enfoncé dans le panneau ou qu'une ligne de code y est sélectionnée (cf. `_dpSelectionInCode`). */
function _dpTick() {
  if (_dpForgetDetached()) return;
  if (_dpInputPending() || _dpPointer || _dpSelectionInCode()) return;
  _dpRender();
}

// l'application peut retirer l'hôte du panneau de la page sans passer par lui — un démarrage qui
// remplace tout le `<body>`, par exemple APRÈS un `µconsole` de `<script module>`, exécuté dès
// l'import : un hôte détaché compte pour fermé, et on range ce qu'il laissait derrière lui
// (minuterie, écouteurs). Rend vrai s'il a fallu le faire
function _dpForgetDetached() {
  if (!_dpHost || _dpHost.isConnected) return false;
  _dpClose();
  return true;
}

/** Démarre un déplacement (`genre` 'deplacer') ou un redimensionnement ('redim-h'/'redim-c') au pointeur. */
function _dpDragStart(e, genre) {
  var panelEl = _dpRoot && _dpRoot.querySelector('.panel');
  if (!panelEl) return;
  if (genre === 'move' && _dpGeo.mode === 'bottom') {
    var rect = panelEl.getBoundingClientRect();   // position/taille visibles à l'instant du bascule bas → flottant
    _dpGeo.mode = 'floating'; _dpGeo.x = rect.left; _dpGeo.y = rect.top; _dpGeo.w = rect.width; _dpGeo.h = rect.height;
  }
  var target = e.currentTarget;
  _dpDrag = { genre: genre, target: target, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, geo0: { x: _dpGeo.x, y: _dpGeo.y, w: _dpGeo.w, h: _dpGeo.h } };
  target.setPointerCapture(e.pointerId);
  target.addEventListener('pointermove', _dpDragMove);
  target.addEventListener('pointerup', _dpDragFinish);
  target.addEventListener('pointercancel', _dpDragFinish);
  clearInterval(_dpTimer); _dpTimer = null;   // sinon l'innerHTML est réécrit sous le pointeur
}

/** Suit le pointeur : ajuste `_dpGeo` et réapplique juste le style, sans repasser par `_dpRender()`. */
function _dpDragMove(e) {
  if (!_dpDrag) return;
  var dx = e.clientX - _dpDrag.x0, dy = e.clientY - _dpDrag.y0;
  var start = _dpDrag.geo0;
  if (_dpDrag.genre === 'move') { _dpGeo.x = start.x + dx; _dpGeo.y = start.y + dy; }
  else if (_dpDrag.genre === 'redim-h') _dpGeo.h = start.h - dy;
  else if (_dpDrag.genre === 'redim-c') { _dpGeo.w = start.w + dx; _dpGeo.h = start.h + dy; }
  _dpGeoClamp();
  var panelEl = _dpRoot && _dpRoot.querySelector('.panel');
  if (panelEl) _dpGeoApply(panelEl);
}

/** Relâche le pointeur, referme le glissement, sauvegarde la géométrie et relance le rendu périodique. */
function _dpDragFinish(e) {
  if (!_dpDrag) return;
  var target = _dpDrag.target;
  target.removeEventListener('pointermove', _dpDragMove);
  target.removeEventListener('pointerup', _dpDragFinish);
  target.removeEventListener('pointercancel', _dpDragFinish);
  if (target.releasePointerCapture) { try { target.releasePointerCapture(_dpDrag.pointerId); } catch { /* déjà relâché */ } }
  _dpDrag = null;
  _dpGeoWrite();
  _dpRender();
  _dpTimer = setInterval(_dpTick, 700);
}

var _DP_CSS = `
:host { all: initial; }
.panel { position: fixed; display: grid; grid-template-rows: auto 1fr; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.5); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; z-index: 2147483647; overflow: hidden; }
.grip-h { position: absolute; top: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; z-index: 1; }
.grip-c { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; z-index: 1; }
.bar { display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; border-bottom: 1px solid #30363d; background: #161b22; cursor: move; }
.title { font-weight: 700; color: #6ea8fe; }
.count { opacity: .6; }
.bar button { font: inherit; background: #21262d; color: inherit; border: 1px solid #30363d; border-radius: 6px; padding: .15rem .5rem; cursor: pointer; }
.bar button[aria-pressed="true"] { background: #1f6feb; border-color: #1f6feb; }
.bar .push { margin-left: auto; }
.upd { display: flex; flex-wrap: wrap; align-items: center; gap: .9rem; padding: .35rem .75rem; border-bottom: 1px solid #30363d; background: #0d1117; }
.upd label { display: flex; align-items: center; gap: .35rem; color: #8b949e; }
.upd select, .upd input { font: inherit; background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 4px; padding: .05rem .3rem; }
.upd input[type="number"] { width: 5.5rem; }
.upd input[type="color"] { width: 2.2rem; height: 1.4rem; padding: 0; }
.body { display: grid; grid-template-columns: minmax(220px, 30%) 1fr; overflow: hidden; }
.tree { overflow: auto; border-right: 1px solid #30363d; padding: .35rem 0; }
.node { display: flex; align-items: center; }
.fold { font: inherit; background: none; border: 0; color: #8b949e; cursor: pointer; width: 1.3rem; flex: none; }
.line { display: flex; flex: 1; align-items: center; gap: .4rem; padding: .1rem .6rem .1rem 0; cursor: pointer; white-space: nowrap; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; user-select: none; }
.line-stores { color: #d2a8ff; }
.line:hover { background: #161b22; }
.line[aria-selected="true"] { background: #1f6feb; }
.line .renders { opacity: .55; font-size: .9em; }
.detail { display: flex; flex-direction: column; overflow: hidden; }
.di-header { padding: .6rem .8rem .3rem; font-weight: 700; color: #6ea8fe; }
.tabs { display: flex; gap: .9rem; padding: 0 .8rem .4rem; border-bottom: 1px solid #30363d; flex-wrap: wrap; }
.tab { font: inherit; background: transparent; color: #8b949e; border: 0; border-bottom: 2px solid transparent; padding: .3rem .1rem; cursor: pointer; }
.tab[aria-selected="true"] { color: #e6edf3; border-bottom-color: #6ea8fe; }
.tab-body { flex: 1; overflow: auto; padding: .6rem .8rem; }
.tab-body h2 { margin: 0 0 .4rem; font-size: 12px; color: #6ea8fe; text-transform: uppercase; letter-spacing: .06em; }
.tab-body section { margin-bottom: .9rem; }
.back-link { font: inherit; background: none; border: 0; color: #6ea8fe; cursor: pointer; padding: .5rem .8rem 0; text-align: left; }
table { border-collapse: collapse; width: 100%; }
td { padding: .12rem .4rem .12rem 0; vertical-align: top; }
td.key { color: #7ee787; white-space: nowrap; }
td.deps { color: #d2a8ff; white-space: nowrap; }
.di-css { white-space: pre-wrap; word-break: break-word; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: .5rem; max-height: 240px; overflow: auto; }
.empty { opacity: .5; }
.help { padding: 2rem; text-align: center; opacity: .6; }
.line-effects { color: #ff7b72; }
.fx { border: 1px solid #30363d; border-radius: 6px; padding: .4rem .55rem; margin-bottom: .6rem; }
.fx-head { display: flex; align-items: center; gap: .5rem; }
.fx-tag { color: #8b949e; }
.fx-name { color: #ff7b72; font-weight: 700; }
.fx-head [data-action="fx-copy"] { margin-left: auto; }
.fx-var { color: #79c0ff; }
.fx-head button { font: inherit; background: #21262d; color: inherit; border: 1px solid #30363d; border-radius: 6px; padding: .05rem .45rem; cursor: pointer; }
.fx-code { display: block; margin: .3rem 0 .4rem; color: #79c0ff; white-space: pre-wrap; word-break: break-word; }
.fx input, .fx select { font: inherit; background: #0d1117; color: inherit; border: 1px solid #30363d; border-radius: 4px; padding: .05rem .3rem; max-width: 16rem; }
.fx input[type="number"] { width: 6.5rem; }
.fx-rule { color: #8b949e; }
.fx-main { color: #d2a8ff; font-size: .85em; }
`;

// la rangée des réglages de l'éclair, sous la barre, quand « mises à jour » est coché
function _dpUpdSettings() {
  var o = function(v, t, taken) { return '<option value="' + v + '"' + (taken ? ' selected' : '') + '>' + t + '</option>'; };
  var effects = ['flash'].concat(_dpUpdEffects());
  return '<div class="upd">' +
    '<label>' + µ._mjs_txt('dev.updEffect', null, 'effet') + ' <select data-upd="fx">' + effects.map(function(n) { return o(n, '*' + n, n === _dpUpd.fx); }).join('') + '</select></label>' +
    '<label>style <select data-upd="style">' + ['outline', 'fill', 'glow'].map(function(n) { return o(n, n, n === _dpUpd.style); }).join('') + '</select></label>' +
    '<label>' + µ._mjs_txt('dev.updColor', null, 'couleur') + ' <input type="color" data-upd="color" value="' + µ._esc(String(_dpUpd.color)) + '"></label>' +
    '<label>' + µ._mjs_txt('dev.updDuration', null, 'durée') + ' <input type="number" data-upd="duration" min="50" max="5000" step="50" value="' + (+_dpUpd.duration || 600) + '"> ms</label>' +
    '</div>';
}

/** (Re)dessine tout le panneau. */
function _dpRender() {
  if (!_dpRoot) return;
  // un contrôle de réglage dont le panneau a rendu le focus (cf. `_dpFocusRestore`) et qui l'a gardé : redessiné, il le garde encore
  var mark = _dpFocusRestored && _dpActive() === _dpFocusRestored ? _dpFocusMark() : null;
  _dpFocusRestored = null;
  // le rendu réécrit TOUT l'innerHTML : sans ces deux mesures, les deux volets sautaient en
  // haut toutes les 700 ms. L'arbre garde toujours sa position ; le volet de droite seulement
  // si c'est le même composant, le même onglet — sinon on veut bien repartir du début.
  var pane = _dpRoot.querySelector('.tree'), prevBody = _dpRoot.querySelector('.tab-body');
  var treeScroll = pane ? pane.scrollTop : 0, defBody = prevBody ? prevBody.scrollTop : 0;
  var signature = _dpTab + '|' + (_dpSelected ? _dpUid(_dpSelected) : 0) + '|' + (_dpObject ? 'obj' : '') + '|' + (_dpView || '');
  var roots = _dpTree();
  var total = 0;
  µ.instances.forEach(function(el) { if (el.isConnected) total++; });

  var grip = _dpGeo.mode === 'bottom' ? '<div class="grip-h" data-grip="h"></div>' : '<div class="grip-c" data-grip="c"></div>';
  var anchorLabel = _dpGeo.mode === 'floating' ? µ._mjs_txt('dev.anchorBottom', null, 'ancrer en bas') : µ._mjs_txt('dev.anchorDetach', null, 'détacher');
  var html = '<div class="panel" role="dialog" aria-labelledby="dp-title" tabindex="-1">' + grip + '<div class="bar"><span class="title" id="dp-title">ModularJS</span>' +
    '<span class="count">' + (total > 1 ? µ._mjs_txt('dev.mountedMany', { n: total }, '{n} composants montés') : µ._mjs_txt('dev.mountedOne', { n: total }, '{n} composant monté')) + '</span>' +
    '<button data-action="target" aria-pressed="' + (_dpAiming ? 'true' : 'false') + '" title="' + µ._mjs_txt('dev.tipTarget', null, 'cliquer ensuite un élément de la page') + '">' + µ._mjs_txt('dev.btnTarget', null, 'cibler') + '</button>' +
    '<button class="push" data-action="flash" aria-pressed="' + (µ.debugMode ? 'true' : 'false') + '" title="' + µ._mjs_txt('dev.tipFlash', null, 'chaque composant qui se re-rend s\'éclaire') + '">' + µ._mjs_txt('dev.btnFlash', null, 'clignoter au rendu') + '</button>' +
    '<button data-action="updates" aria-pressed="' + (_dpUpd.on ? 'true' : 'false') + '" title="' + µ._mjs_txt('dev.tipUpdates', null, 'chaque morceau que MJS réécrit s\'éclaire') + '">' + µ._mjs_txt('dev.btnUpdates', null, 'mises à jour') + '</button>' +
    '<button data-action="dock">' + anchorLabel + '</button>' +
    '<button data-action="refresh">' + µ._mjs_txt('dev.btnRefresh', null, 'rafraîchir') + '</button>' +
    '<button data-action="close">' + µ._mjs_txt('dev.btnClose', null, 'fermer') + '</button>' +
    '</div>' + (_dpUpd.on ? _dpUpdSettings() : '') + '<div class="body"><div class="tree"></div><div class="detail"></div></div></div>';
  _dpRoot.innerHTML = µ._mjs_th('<style>' + _DP_CSS + '</style>' + html);

  var tree = _dpRoot.querySelector('.tree');
  // en tête de l'arbre, les stores — seulement s'il y en a (clés CACHÉES exclues : µlang & co)
  var storeKeys = µ.store ? Object.keys(µ.store) : [];
  if (storeKeys.length > 0) {
    var storesNode = document.createElement('div');
    storesNode.className = 'node';
    storesNode.innerHTML = µ._mjs_th('<span class="fold" aria-hidden="true"></span><button type="button" class="line line-stores" aria-selected="' + (_dpView === 'stores' && !_dpObject ? 'true' : 'false') + '"><span>stores ($$)</span><span class="renders">·' + storeKeys.length + '</span></button>');
    storesNode.querySelector('.line').addEventListener('click', function() { _dpView = 'stores'; _dpObject = null; _dpRender(); });
    tree.appendChild(storesNode);
  }
  // puis les effets de la page — seulement s'il y en a
  var effectCount = _dpFxList(null).length;
  if (effectCount > 0) {
    var effectsNode = document.createElement('div');
    effectsNode.className = 'node';
    effectsNode.innerHTML = µ._mjs_th('<span class="fold" aria-hidden="true"></span><button type="button" class="line line-effects" aria-selected="' + (_dpView === 'effects' && !_dpObject ? 'true' : 'false') + '"><span>' + µ._mjs_txt('dev.rowEffects', null, 'effets (*)') + '</span><span class="renders">·' + effectCount + '</span></button>');
    effectsNode.querySelector('.line').addEventListener('click', function() { _dpView = 'effects'; _dpObject = null; _dpRender(); });
    tree.appendChild(effectsNode);
  }
  var lines = [];
  (function walk(nodes, depth) {
    nodes.sort(function(a, b) { return _dpName(a.el) < _dpName(b.el) ? -1 : 1; });
    nodes.forEach(function(n) {
      lines.push({ el: n.el, depth: depth, hasKids: n.children.length > 0 });
      if (!_dpTreeFolded.has(_dpUid(n.el))) walk(n.children, depth + 1);
    });
  })(roots, 0);

  lines.forEach(function(l) {
    var uid = _dpUid(l.el);
    var node = document.createElement('div');
    node.className = 'node';
    node.style.paddingLeft = (l.depth * 0.9) + 'rem';
    node.innerHTML = µ._mjs_th((l.hasKids
        ? '<button type="button" class="fold" data-uid="' + uid + '" aria-expanded="' + (_dpTreeFolded.has(uid) ? 'false' : 'true') + '">' + (_dpTreeFolded.has(uid) ? '▸' : '▾') + '</button>'
        : '<span class="fold" aria-hidden="true"></span>') +
      '<button type="button" class="line" aria-selected="' + (l.el === _dpSelected && !_dpView ? 'true' : 'false') + '"><span>' +
      µ._esc(_dpName(l.el)) + '</span><span class="renders">·' + (l.el._mjs_renderCount || 0) + '</span></button>');
    var foldButton = node.querySelector('.fold[data-uid]');
    if (foldButton) {
      foldButton.addEventListener('click', function(e) {
        e.stopPropagation();
        if (_dpTreeFolded.has(uid)) _dpTreeFolded.delete(uid); else _dpTreeFolded.add(uid);
        _dpRender();
      });
    }
    var lineButton = node.querySelector('.line');
    lineButton.addEventListener('click', function() { _dpSelected = l.el; _dpObject = null; _dpView = null; _dpRender(); });
    // double-clic = la flèche : les deux clics qui le précèdent ont déjà sélectionné (et redessiné
    // l'arbre — le double-clic arrive sur la ligne REDESSINÉE, écoutée comme les autres)
    lineButton.addEventListener('dblclick', function() {
      if (!l.hasKids) return;
      if (_dpTreeFolded.has(uid)) _dpTreeFolded.delete(uid); else _dpTreeFolded.add(uid);
      _dpRender();
    });
    lineButton.addEventListener('mouseenter', function() { _dpSurligner(l.el); });
    lineButton.addEventListener('mouseleave', function() { _dpSurligner(null); });
    tree.appendChild(node);
  });

  _dpRenderDetail(_dpRoot.querySelector('.detail'));

  _dpRoot.querySelectorAll('.bar button').forEach(function(b) {
    b.addEventListener('click', function() {
      var action = b.getAttribute('data-action');
      if (action === 'close') _dpToggle(false);
      else if (action === 'target') { if (_dpAiming) _dpAimEnd(); else _dpAimStart(); _dpRender(); }
      else if (action === 'refresh') _dpRender();
      else if (action === 'flash') { µ.debugMode = !µ.debugMode; _dpRender(); }
      else if (action === 'updates') { _dpUpdReread(); _dpUpdToggle(!_dpUpd.on); _dpRender(); }
      else if (action === 'dock') { _dpGeo.mode = _dpGeo.mode === 'floating' ? 'bottom' : 'floating'; _dpGeoClamp(); _dpGeoWrite(); _dpRender(); }
    });
  });

  _dpRoot.querySelectorAll('[data-upd]').forEach(function(c) {
    c.addEventListener('change', function() {
      var k = c.getAttribute('data-upd');
      _dpUpd[k] = k === 'duration' ? Math.max(50, Math.min(5000, +c.value || 600)) : c.value;
      _dpUpdWrite();
      // redessiné : le contrôle est remplacé et le focus lui est rendu — au clavier (une flèche sur un menu, Entrée
      // dans un nombre) on y reste, Échap ferme encore le panneau —, et le rafraîchissement périodique reprend (il
      // passe son tour tant qu'on saisit)
      var mark = _dpFocusMark();
      _dpRender();
      _dpFocusRestore(mark);
    });
  });

  var panelEl = _dpRoot.querySelector('.panel');
  _dpRoot.querySelector('.bar').addEventListener('pointerdown', function(e) {
    if (e.target.closest('button')) return;
    _dpDragStart(e, 'move');
  });
  var gripH = _dpRoot.querySelector('.grip-h');
  if (gripH) gripH.addEventListener('pointerdown', function(e) { _dpDragStart(e, 'redim-h'); });
  var gripC = _dpRoot.querySelector('.grip-c');
  if (gripC) gripC.addEventListener('pointerdown', function(e) { _dpDragStart(e, 'redim-c'); });
  _dpGeoApply(panelEl);

  var newTree = _dpRoot.querySelector('.tree');
  if (newTree) newTree.scrollTop = treeScroll;
  var newBody = _dpRoot.querySelector('.tab-body');
  if (newBody && signature === _dpSignaturePrev) newBody.scrollTop = defBody;
  _dpSignaturePrev = signature;
  _dpFocusRestore(mark);
}

var _DP_TABS = function() {
  return [
    { id: 'state', label: µ._mjs_txt('dev.tabState', null, 'État') },
    { id: 'derived', label: µ._mjs_txt('dev.tabDerived', null, 'Dérivés') },
    { id: 'bindings', label: µ._mjs_txt('dev.tabBindings', null, 'Liaisons') },
    { id: 'context', label: µ._mjs_txt('dev.tabContext', null, 'Contexte') },
    { id: 'props', label: µ._mjs_txt('dev.tabProps', null, 'Attributs et props') },
    { id: 'style', label: µ._mjs_txt('dev.tabStyle', null, 'Style et thème') },
    { id: 'effects', label: µ._mjs_txt('dev.tabEffects', null, 'Effets') }
  ];
}

/**
 * Texte CSS actif sur le composant : les feuilles ADOPTÉES d'abord — c'est par là que passe
 * le framework par défaut (`_shadow.adoptedStyleSheets`, cf. `_mjs_applyLayout`/mjs_element.ts) —
 * un `<style>` réel seulement en repli (mode `mjs-light`, panneau « route introuvable » du
 * routeur : ni l'un ni l'autre n'a d'adoptedStyleSheets).
 */
function _dpStyleText(el) {
  var sheets = (el._shadow && el._shadow.adoptedStyleSheets) || [];
  var pieces = [];
  sheets.forEach(function(sheet, i) {
    try {
      var text = Array.from(sheet.cssRules || []).map(function(r) { return r.cssText; }).join('\n');
      if (text) pieces.push('/* feuille ' + (i + 1) + '/' + sheets.length + ' */\n' + text);
    } catch { /* feuille illisible (rare) : ignorée sans planter */ }
  });
  if (pieces.length) return pieces.join('\n\n');
  var tag = el.tagName.toLowerCase();
  var styleEl = (el._shadow && el._shadow.querySelector && el._shadow.querySelector('style'))
    || document.head.querySelector('style[data-mjs-css="' + tag + '"]')
    || document.head.querySelector('style[data-mjs-light="' + tag + '"], style[data-mjs-light-layout="' + tag + '"]');
  return styleEl ? (styleEl.textContent || '') : '';
}

/**
 * Thème actif + variables en vigueur sur `el`. Les NOMS viennent du CSS déjà connu du runtime
 * (`µ._themeCss`/`µ._themeCssByName`, `--nom:` extrait par expression régulière), CHAQUE valeur
 * est ensuite résolue par `getComputedStyle` — la seule méthode qui marche partout : énumérer
 * les propriétés personnalisées directement depuis `getComputedStyle` est récent et absent de
 * Firefox.
 */
function _dpThemeInfo(el) {
  var active = document.documentElement.getAttribute('data-mjs-theme') || document.documentElement.getAttribute('theme') || 'light';
  var known = ['light', 'dark'].concat(Array.isArray(µ._themes) ? µ._themes : []);
  var source = (µ._themeCss || '') + '\n' + (µ._themeCssByName ? Object.keys(µ._themeCssByName).map(function(k) { return µ._themeCssByName[k]; }).join('\n') : '');
  var names = new Set(), re = /--([a-zA-Z0-9_-]+)\s*:/g, m;
  while ((m = re.exec(source))) names.add(m[1]);
  var vars = Array.from(names).sort().map(function(name) {
    var val = '';
    try { val = getComputedStyle(el).getPropertyValue('--' + name).trim(); } catch { val = ''; }
    return { name: name, val: val };
  });
  return { active: active, known: known, vars: vars };
}

function _dpStyleTab(el) {
  var info = _dpThemeInfo(el);
  var css = _dpStyleText(el);
  var varsHtml = info.vars.length
    ? '<table>' + info.vars.map(function(v) { return '<tr><td class="key">--' + µ._esc(v.name) + '</td><td>' + µ._esc(v.val || µ._mjs_txt('dev.empty', null, '(vide)')) + '</td></tr>'; }).join('') + '</table>'
    : '<p class="empty">' + µ._mjs_txt('dev.themeNone', null, 'aucune variable de thème détectée') + '</p>';
  return '<section><h2>' + µ._mjs_txt('dev.themeActive', null, 'Thème actif') + '</h2><p>' + µ._esc(info.active) + ' — ' + µ._mjs_txt('dev.themeKnown', null, 'connus :') + ' ' + µ._esc(info.known.join(', ')) + '</p></section>' +
    '<section><h2>' + µ._mjs_txt('dev.themeVars', null, 'Variables de thème en vigueur') + '</h2>' + varsHtml + '</section>' +
    '<section><h2>' + µ._mjs_txt('dev.cssActive', null, 'CSS actif (feuilles adoptées)') + '</h2><pre class="di-css">' + (css ? µ._esc(css) : '<span class="empty">' + µ._mjs_txt('dev.cssNone', null, 'aucun CSS propre détecté') + '</span>') + '</pre></section>';
}

function _dpPropsTab(el) {
  var declares = el._mjs_var_bits ? Object.keys(el._mjs_var_bits).sort() : [];
  var declaredLines = declares.map(function(k) {
    return '<tr><td class="key">' + µ._esc(k) + '</td><td>' + µ._esc(_dpPreview(el._state ? el._state[k] : undefined)) + '</td></tr>';
  }).join('');
  var attrs = Array.from(el.attributes || []);
  var attrLines = attrs.map(function(a) {
    return '<tr><td class="key">' + µ._esc(a.name) + '</td><td>' + µ._esc(a.value) + '</td></tr>';
  }).join('');
  return '<section><h2>' + µ._mjs_txt('dev.propsDeclared', null, 'Props / variables déclarées') + '</h2>' + (declaredLines ? '<table>' + declaredLines + '</table>' : '<p class="empty">' + µ._mjs_txt('dev.noneF', null, 'aucune') + '</p>') + '</section>' +
    '<section><h2>' + µ._mjs_txt('dev.attrsReal', null, 'Attributs réels de l\'élément') + '</h2>' + (attrLines ? '<table>' + attrLines + '</table>' : '<p class="empty">' + µ._mjs_txt('dev.noneM', null, 'aucun') + '</p>') + '</section>';
}

/** Le volet de droite : l'inspecteur d'objet (`µconsole valeur`), ou l'instance sélectionnée en onglets. */
function _dpRenderDetail(host) {
  if (_dpObject) {
    host.innerHTML = µ._mjs_th('<button type="button" class="back-link" data-action="object-close">← ' + µ._mjs_txt('dev.closeInspector', null, 'fermer l\'inspecteur d\'objet') + '</button><div class="tab-body"></div>');
    host.querySelector('[data-action="object-close"]').addEventListener('click', function() { _dpObject = null; _dpRender(); });
    µ._mjs_diRender(host.querySelector('.tab-body'), _dpObject.value, { ns: _dpObject.ns, title: _dpObject.title });
    return;
  }
  if (_dpView === 'stores') {
    var keys = µ.store ? Object.keys(µ.store) : [];
    host.innerHTML = µ._mjs_th('<div class="di-header">stores ($$) · ' + (keys.length > 1 ? µ._mjs_txt('dev.keysMany', { n: keys.length }, '{n} clés') : µ._mjs_txt('dev.keysOne', { n: keys.length }, '{n} clé')) + '</div><div class="tab-body"></div>');
    // copie PLATE des clés : lue par les accesseurs de `µ.store` (un store calculé arrive résolu),
    // les objets restent les références vivantes du store — l'écriture profonde les touche vraiment
    var view = {};
    keys.forEach(function(k) { view[k] = µ.store[k]; });
    µ._mjs_diRender(host.querySelector('.tab-body'), view, {
      ns: 'stores',
      sortRoot: function(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
      onWriteRoot: function(k, v) { µ.store[k] = v; return true; },
      onWriteDeep: function(k) { µ._mjs_storeNotifyDeep(k); },
      ruleRoot: function(k) { return _dpRule(µ._mjs_storeRules, k); },
      emptyText: µ._mjs_txt('dev.noStore', null, 'aucun store')
    });
    return;
  }
  if (_dpView === 'effects') {
    var all = _dpFxList(null);
    host.innerHTML = µ._mjs_th('<div class="di-header">effets (*) · ' + (all.length > 1 ? µ._mjs_txt('dev.fxSetMany', { n: all.length }, '{n} posés') : µ._mjs_txt('dev.fxSetOne', { n: all.length }, '{n} posé')) + '</div><div class="tab-body"></div>');
    var fxBody = host.querySelector('.tab-body');
    fxBody.innerHTML = µ._mjs_th(all.length ? _dpFxHtml(all, true) : '<p class="empty">' + µ._mjs_txt('dev.noEffectPage', null, 'aucun effet dans la page') + '</p>');
    _dpFxWire(fxBody);
    return;
  }
  var el = _dpSelected;
  if (!el || !el.isConnected) {
    host.innerHTML = µ._mjs_th('<p class="help">' + µ._mjs_txt('dev.pickComponent', null, 'Choisissez un composant à gauche.<br>Survolez une ligne pour le situer dans la page.') + '</p>');
    return;
  }
  var uid = _dpUid(el);
  host.innerHTML = µ._mjs_th(
    '<div class="di-header">' + µ._esc(_dpName(el)) + ' · ' + ((el._mjs_renderCount || 0) > 1 ? µ._mjs_txt('dev.renderMany', { n: (el._mjs_renderCount || 0) }, '{n} rendus') : µ._mjs_txt('dev.renderOne', { n: (el._mjs_renderCount || 0) }, '{n} rendu')) + '</div>' +
    '<div class="tabs" role="tablist">' + _DP_TABS().map(function(o) {
      return '<button type="button" class="tab" role="tab" aria-selected="' + (o.id === _dpTab ? 'true' : 'false') + '" data-tab="' + o.id + '">' + o.label + '</button>';
    }).join('') + '</div><div class="tab-body"></div>');

  host.querySelectorAll('.tab').forEach(function(b) {
    b.addEventListener('click', function() { _dpTab = b.getAttribute('data-tab'); _dpRender(); });
  });

  var body = host.querySelector('.tab-body');
  if (_dpTab === 'derived') {
    var deps = el._mjs_computedDeps || {};
    var lines = _dpDeriveKeys(el).map(function(k) {
      var d = deps[k] && deps[k].length ? '← ' + deps[k].map(function(x) { return '$' + x; }).join(', ') : '';
      return '<tr><td class="key">$' + µ._esc(k) + '</td><td>' + µ._esc(_dpPreview(el._state[k])) + '</td><td class="deps">' + µ._esc(d) + '</td></tr>';
    }).join('');
    body.innerHTML = µ._mjs_th('<section><h2>' + µ._mjs_txt('dev.derivedTitle', null, 'Dérivés et leurs dépendances') + '</h2>' + (lines ? '<table>' + lines + '</table>' : '<p class="empty">' + µ._mjs_txt('dev.noDerived', null, 'aucun dérivé') + '</p>') + '</section>');
  } else if (_dpTab === 'bindings') {
    var bindingLines = el._mjs_effectsByVar ? Object.keys(el._mjs_effectsByVar).sort().map(function(k) {
      return '<tr><td class="key">$' + µ._esc(k) + '</td><td>' + (el._mjs_effectsByVar[k].length > 1 ? µ._mjs_txt('dev.bindingMany', { n: el._mjs_effectsByVar[k].length }, '{n} liaisons') : µ._mjs_txt('dev.bindingOne', { n: el._mjs_effectsByVar[k].length }, '{n} liaison')) + '</td></tr>';
    }).join('') : '';
    body.innerHTML = µ._mjs_th('<section><h2>' + µ._mjs_txt('dev.bindingsTitle', null, 'Ce que chaque variable met à jour') + '</h2>' + (bindingLines ? '<table>' + bindingLines + '</table>' : '<p class="empty">' + µ._mjs_txt('dev.noBinding', null, 'aucune liaison') + '</p>') + '</section>');
  } else if (_dpTab === 'context') {
    // Deux moitiés, parce que ce sont deux questions différentes : « qu'est-ce que CE composant
    // met à disposition de sa descendance » (sa propre Map `_mjs_contexts`) et « qu'est-ce qu'il
    // REÇOIT, et de qui » (remontée `parentNode || host || getRootNode().host`, exactement le
    // chemin de `_mjs_getContext`, cf. mjs_element.ts). Sans la seconde, l'onglet reste vide sur
    // toute feuille de l'arbre — c'est-à-dire précisément là où on se demande d'où vient `§x`.
    body.innerHTML = µ._mjs_th('<section><h2>' + µ._mjs_txt('dev.ctxSet', null, 'Posés ici') + '</h2><div class="ctx-set"></div></section>' +
      '<section><h2>' + µ._mjs_txt('dev.ctxReceived', null, 'Reçus d\'un ancêtre') + '</h2><div class="ctx-received"></div></section>');
    µ._mjs_diRender(body.querySelector('.ctx-set'), el._mjs_contexts || {}, { ns: 'ctx#' + uid, emptyText: µ._mjs_txt('dev.noCtxSet', null, 'aucun contexte posé par ce composant') });
    var received = {}, seen = {}, current = el.parentNode || el.host || (el.getRootNode && el.getRootNode().host);
    while (current) {
      if (current._mjs_contexts) current._mjs_contexts.forEach(function(v, k) {
        // le PLUS PROCHE l'emporte, comme la résolution réelle : on ne réécrit jamais une clé déjà vue
        if (!seen[k]) { seen[k] = true; received['§' + k + '  ← ' + _dpName(current)] = v; }
      });
      current = current.parentNode || current.host || (current.getRootNode && current.getRootNode().host);
    }
    µ._mjs_diRender(body.querySelector('.ctx-received'), received, { ns: 'ctxr#' + uid, emptyText: µ._mjs_txt('dev.noCtxReceived', null, 'aucun contexte reçu') });
  } else if (_dpTab === 'props') {
    body.innerHTML = µ._mjs_th(_dpPropsTab(el));
  } else if (_dpTab === 'style') {
    body.innerHTML = µ._mjs_th(_dpStyleTab(el));
  } else if (_dpTab === 'effects') {
    var theirs = _dpFxList(el);
    body.innerHTML = µ._mjs_th(theirs.length ? _dpFxHtml(theirs, false) : '<p class="empty">' + µ._mjs_txt('dev.noEffectComp', null, 'aucun effet posé par ce composant') + '</p>');
    _dpFxWire(body);
  } else {
    var allowed = new Set(_dpStateKeys(el));
    µ._mjs_diRender(body, el._state || {}, {
      ns: 'etat#' + uid,
      filterRoot: function(k) { return allowed.has(k); },
      sortRoot: function(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
      onWriteRoot: function(k, v) { el._set(k, v); return true; },
      ruleRoot: function(k) { return _dpRule(el._mjs_types, k); },
      emptyText: µ._mjs_txt('dev.noStateVar', null, 'aucune variable d\'état')
    });
  }
}

// ------------------------------------------------------------------------------------------------
// Effets : ceux qu'un composant a posés — sur les balises de son gabarit, sur un composant enfant,
// sur <@document> —, réglables à chaud. Le moteur tient déjà tout : une balise habillée garde ses
// effets dans `el._mjs_fxOff[nom]` (réglages courants `_s`, composant qui l'a posé `_c`), et
// `µ._mjs_fxSet` met un réglage à jour (variable CSS sur place, ou effet relancé). Les règles des
// réglages viennent du catalogue, embarqué dans le cœur de développement pour les seuls effets
// utilisés (`µ._mjs_fxCatalog`, cf. bundler) ; un effet CSS de l'appli (fichier *.effects.mjs)
// donne les siens (`µ._mjs_fxDefs[nom].params`). Rien n'est réécrit dans le code : la ligne
// `*neon(#0ff, size: 2)` dit quoi y recopier, « rétablir » défait les retouches.
// ------------------------------------------------------------------------------------------------
var _dpFxLines = [];              // les effets du dernier rendu, dans l'ordre des blocs (`data-fx`)
var _dpFxCopy = null;             // le bouton « copier » qui vient de servir : { el, name, word, fin }
var _dpFxOrigin = new WeakMap();  // balise → { effet: ses réglages avant la première retouche }
var _DP_FX_ON = ['always', 'hover', 'click', 'view', 'load'];
var _DP_FX_KEY = /^[A-Za-z][\w-]*\s*:/;   // ce que la lecture des réglages prend pour le nom d'un réglage (`mot:`)

/** Les effets posés par `comp` (tous ceux de la page si `comp` est nul), balise par balise. */
function _dpFxList(comp) {
  var seen = new Set(), list = [];
  var search = function(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[mjs-fx]').forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      var offs = el._mjs_fxOff;
      if (!offs) return;
      Object.keys(offs).forEach(function(name) {
        var off = offs[name];
        if (!off || !off._s || (comp && off._c !== comp)) return;
        list.push({ el: el, name: name, comp: off._c });
      });
    });
  };
  search(document);
  µ.instances.forEach(function(inst) { if (inst.isConnected) search(inst._shadow); });
  return list;
}

/** Réglage principal et règles des réglages : le catalogue, ou la définition d'un effet CSS de l'appli. */
function _dpFxSpec(name) {
  var cat = µ._mjs_fxCatalog && µ._mjs_fxCatalog[name];
  if (cat) return cat;
  var def = µ._mjs_fxDefs && µ._mjs_fxDefs[name];
  if (!def || !def.params) return null;
  var s = {};
  def.params.forEach(function(p) { s[p[0]] = [['s', 'css'], p[1]]; });
  s.on = [['l', _DP_FX_ON, _DP_FX_ON.join(' | ')], 'always'];
  s.duration = [['t', µ._mjs_txt('dev.fxDuration', null, 'durée')], def.anim ? '1s' : '400ms'];
  s.delay = [['t', µ._mjs_txt('dev.fxDuration', null, 'durée')], '0s'];
  s.easing = [['s', µ._mjs_txt('dev.fxCurve', null, 'courbe')], 'ease'];
  return { m: def.params.length ? def.params[0][0] : 'on', s: s };
}

/** `<h1.titre>` : la balise, de quoi la reconnaître. */
function _dpFxTag(el) {
  if (el === document.documentElement) return '<@document>';
  var id = el.id ? '#' + el.id : '';
  var cls = !id && el.classList && el.classList.length ? '.' + el.classList[0] : '';
  return '<' + (el.localName || el.tagName.toLowerCase()) + id + cls + '>';
}

function _dpFxText(v) {
  if (v === void 0 || v === null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** `*neon(#0ff, size: 2)` : l'effet tel qu'il s'écrit avec ses réglages courants ; la connexion d'un
 * effet en direct (`sock`) s'écrit par sa variable (`ecrit`, cf. µ._mjs_fx), jamais par sa valeur —
 * `@sock`, le défaut, ne s'écrit pas ; un effet donné en réglage (`fx: *scramble(20)`), par son écriture ; la ligne se recompile
 * telle quelle : une valeur qui ressemble à `mot:` (une adresse `wss://…`) s'écrit entre guillemets — et le réglage principal,
 * avec son nom —, une apostrophe passe en guillemets doubles, les clés internes `_…` (la variable que le compilateur donne
 * à *gauge et à *guard) ne s'écrivent pas */
function _dpFxCode(name, s, spec, written) {
  var quoted = function(v) { return v.indexOf("'") >= 0 ? '"' + v + '"' : "'" + v + "'"; };
  var val = function(v) {
    if (Array.isArray(v)) return '[' + v.map(val).join(', ') + ']';
    if (v && typeof v === 'object' && typeof v.fx === 'string') return _dpFxCode(v.fx, v.s || {}, _dpFxSpec(v.fx));
    // entre guillemets : ce qui couperait la liste des réglages, la ponctuation seule (`'.'`) et ce qui ressemble à `mot:` ;
    // doubles si la valeur porte une apostrophe — la lecture des réglages ne connaît pas `\'`
    if (typeof v === 'string' && (/[,()[\]'"]|^\s|\s$/.test(v) || !/[A-Za-z0-9]/.test(v) || _DP_FX_KEY.test(v))) return quoted(v);
    return String(v);
  };
  var isBound = function(k) { return !!(spec && spec.s[k] && spec.s[k][0][0] === 'v'); };
  var keys = Object.keys(s).filter(function(k) { return k.charAt(0) !== '_'; });
  if (written) Object.keys(written).forEach(function(k) { if (keys.indexOf(k) < 0) keys.push(k); });
  var text = function(k) {
    if (written && written[k]) return written[k];
    return isBound(k) || s[k] === void 0 ? null : val(s[k]);
  };
  var main = spec && spec.m, pieces = [];
  // un principal qui commence comme un réglage (`mot:`) s'écrit avec son nom : sans lui, il serait lu comme le nom d'un autre réglage
  if (main && keys.indexOf(main) >= 0 && text(main) !== null) pieces.push((typeof s[main] === 'string' && !(written && written[main]) && _DP_FX_KEY.test(s[main]) ? main + ': ' : '') + text(main));
  keys.forEach(function(k) { if (k !== main && text(k) !== null) pieces.push(k + ': ' + text(k)); });
  return '*' + name + (pieces.length ? '(' + pieces.join(', ') + ')' : '');
}

/** Le contrôle d'un réglage, selon sa règle : case, menu, nombre borné, ou texte (défaut en filigrane). */
function _dpFxField(key, sp, v, dflt) {
  var attr = ' data-key="' + µ._esc(key) + '"';
  var aDflt = dflt !== null && dflt !== void 0;
  if (sp[0] === 'b') return '<input type="checkbox"' + attr + ((v === void 0 ? dflt === true : v === true) ? ' checked' : '') + '>';
  if (sp[0] === 'l') {
    var current = v === void 0 ? dflt : v;
    return '<select' + attr + '>' + (v === void 0 && !aDflt ? '<option value="" selected>—</option>' : '') + sp[1].map(function(x) {
      return '<option value="' + µ._esc(String(x)) + '"' + (String(x) === String(current) ? ' selected' : '') + '>' + µ._esc(String(x)) + '</option>';
    }).join('') + '</select>';
  }
  var ph = aDflt ? ' placeholder="' + µ._esc(_dpFxText(dflt)) + '"' : '';
  if (sp[0] === 'i' || sp[0] === 'f') {
    return '<input type="number"' + attr + (sp[1] !== null ? ' min="' + sp[1] + '"' : '') + (sp[2] !== null ? ' max="' + sp[2] + '"' : '') + ' step="' + (sp[0] === 'i' ? '1' : 'any') + '" value="' + µ._esc(_dpFxText(v)) + '"' + ph + '>';
  }
  return '<input type="text"' + attr + ' value="' + µ._esc(_dpFxText(v)) + '"' + ph + '>';
}

/** Les blocs des effets de `liste`, groupés par composant si `byComponent`. */
function _dpFxHtml(list, byComponent) {
  if (byComponent) {
    var groups = new Map();
    list.forEach(function(l) { if (!groups.has(l.comp)) groups.set(l.comp, []); groups.get(l.comp).push(l); });
    list = [];
    groups.forEach(function(g) { list = list.concat(g); });
  }
  _dpFxLines = list;
  var html = '', compPrev = null;
  list.forEach(function(l, i) {
    if (byComponent && l.comp !== compPrev) { compPrev = l.comp; html += '<h2>' + µ._esc(compPrev ? _dpName(compPrev) : '?') + '</h2>'; }
    var spec = _dpFxSpec(l.name);
    var s = l.el._mjs_fxOff[l.name]._s || {};
    var written = l.el._mjs_fxWritten && l.el._mjs_fxWritten[l.name];
    var ranks = (spec ? Object.keys(spec.s) : Object.keys(s)).map(function(k) {
      var sp = spec ? spec.s[k][0] : ['x', ''];
      // la connexion d'un effet en direct : sa variable, montrée, pas réglable ici
      var field = sp[0] === 'v' ? '<code class="fx-var">' + µ._esc(written && written[k] ? written[k] : s.server ? '—' : '@sock') + '</code>' : _dpFxField(k, sp, s[k], spec ? spec.s[k][1] : null);
      return '<tr><td class="key">' + µ._esc(k) + (spec && k === spec.m ? ' <span class="fx-main">' + µ._mjs_txt('dev.fxMain', null, 'principal') + '</span>' : '') + '</td><td>' + field + '</td><td class="fx-rule">' + µ._esc(String(sp[sp.length - 1] || '')) + '</td></tr>';
    }).join('');
    var tweak = (_dpFxOrigin.get(l.el) || {})[l.name];
    var copy = _dpFxCopy && _dpFxCopy.el === l.el && _dpFxCopy.name === l.name && Date.now() < _dpFxCopy.end ? _dpFxCopy.word : µ._mjs_txt('dev.fxCopy', null, 'copier l\'écriture');
    html += '<div class="fx" data-fx="' + i + '"><div class="fx-head"><span class="fx-tag">' + µ._esc(_dpFxTag(l.el)) + '</span><span class="fx-name">*' + µ._esc(l.name) + '</span>' +
      '<button type="button" data-action="fx-copy">' + µ._esc(copy) + '</button>' +
      (tweak ? '<button type="button" data-action="fx-restore">' + µ._mjs_txt('dev.fxRevert', null, 'rétablir') + '</button>' : '') + '</div>' +
      '<code class="fx-code">' + µ._esc(_dpFxCode(l.name, s, spec, written)) + '</code><table>' + ranks + '</table></div>';
  });
  return html;
}

/** Survol d'un bloc = la balise surlignée dans la page ; un réglage changé = l'effet réglé. */
function _dpFxWire(body) {
  body.querySelectorAll('.fx').forEach(function(block) {
    var line = _dpFxLines[+block.getAttribute('data-fx')];
    if (!line) return;
    block.addEventListener('mouseenter', function() { _dpSurligner(line.el === document.documentElement ? null : line.el); });
    block.addEventListener('mouseleave', function() { _dpSurligner(null); });
    block.querySelectorAll('[data-key]').forEach(function(field) {
      field.addEventListener('change', function() { _dpFxSet(line, field.getAttribute('data-key'), field); });
    });
    var restore = block.querySelector('[data-action="fx-restore"]');
    if (restore) restore.addEventListener('click', function() { _dpFxRestore(line); });
    var copy = block.querySelector('[data-action="fx-copy"]');
    if (copy) copy.addEventListener('click', function() { _dpFxCopyCode(line, block.getAttribute('data-fx')); });
  });
}

/** La valeur d'un champ selon la règle de son réglage — vide : `undefined` (le défaut de l'effet). */
function _dpFxRead(field, sp) {
  if (sp[0] === 'b') return field.checked;
  var v = String(field.value).trim();
  if (v === '') return void 0;
  if (sp[0] === 'i' || sp[0] === 'f') return parseFloat(v);
  if (sp[0] === 'l') {
    for (var i = 0; i < sp[1].length; i++) if (String(sp[1][i]) === v) return sp[1][i];
    return v;
  }
  if (sp[0] === 'k' || sp[0] === 'w') {
    return v.split(/,(?![^(]*\))/).map(function(x) { return x.trim().replace(/^(['"])([\s\S]*)\1$/, '$2'); }).filter(function(x) { return x !== ''; });
  }
  if (sp[0] === 'd' && /^-?\d+(?:\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

function _dpFxSet(line, key, field) {
  var off = line.el._mjs_fxOff && line.el._mjs_fxOff[line.name];
  if (!off) return;
  var spec = _dpFxSpec(line.name);
  var sp = spec && spec.s[key] ? spec.s[key][0] : ['x', ''];
  // les réglages d'avant la première retouche, pour « rétablir »
  var orig = _dpFxOrigin.get(line.el) || {};
  if (!orig[line.name]) { orig[line.name] = Object.assign({}, off._s); _dpFxOrigin.set(line.el, orig); }
  var d = {}, rules = {}, mark = _dpFocusMark();
  d[key] = _dpFxRead(field, sp);
  rules[key] = sp;
  µ._mjs_fxSet(line.el, line.name, d, rules);
  _dpRender();
  _dpFocusRestore(mark);
}

/** « copier l'écriture » : la ligne de code, avec les réglages essayés, dans le presse-papiers ;
 * refusé (page hors HTTPS, permission), la ligne est sélectionnée pour Ctrl+C. Le bouton le dit un instant. */
function _dpFxCopyCode(line, rank) {
  var code = _dpRoot && _dpRoot.querySelector('.fx[data-fx="' + rank + '"] .fx-code');
  var text = code ? code.textContent : '';
  var tell = function(word) {
    _dpFxCopy = { el: line.el, name: line.name, word: word, end: Date.now() + 1500 };
    _dpRender();
    // la remise à zéro du bouton attend la fin d'une sélection de la ligne (le repli : Ctrl+C), qu'elle ne l'efface pas
    setTimeout(function() { if (_dpRoot && !_dpSelectionInCode()) _dpRender(); }, 1600);
  };
  var copying = navigator.clipboard && typeof navigator.clipboard.writeText === 'function' ? navigator.clipboard.writeText(text) : Promise.reject(new Error('presse-papiers absent'));
  copying.then(function() { tell(µ._mjs_txt('dev.fxCopied', null, 'copié ✓')); }, function() {
    tell(µ._mjs_txt('dev.fxSelected', null, 'sélectionné : Ctrl+C'));
    var c   = _dpRoot && _dpRoot.querySelector('.fx[data-fx="' + rank + '"] .fx-code');
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!c || !sel) return;
    // `setBaseAndExtent` et non `addRange` : WebKit refuse un intervalle posé dans une ombre (la sélection reste vide)
    sel.removeAllRanges();
    sel.setBaseAndExtent(c, 0, c, c.childNodes.length);
  });
}

function _dpFxRestore(line) {
  var orig = _dpFxOrigin.get(line.el);
  var before = orig && orig[line.name];
  var off = line.el._mjs_fxOff && line.el._mjs_fxOff[line.name];
  if (!before || !off) return;
  var spec = _dpFxSpec(line.name), d = {}, rules = {}, keys = {};
  Object.keys(off._s).forEach(function(k) { keys[k] = true; });
  Object.keys(before).forEach(function(k) { keys[k] = true; });
  Object.keys(keys).forEach(function(k) {
    d[k] = before[k];
    if (spec && spec.s[k]) rules[k] = spec.s[k][0];
  });
  µ._mjs_fxSet(line.el, line.name, d, rules);
  delete orig[line.name];
  _dpRender();
}

// l'élément qui a le focus dans la page, en descendant dans les ombres : `document.activeElement` s'arrête à l'hôte d'un
// composant (son ombre est fermée — `_shadow`, `shadowRoot` l'ignore ; un léger, qui est sa propre ombre : sa racine d'ombre
// native), et c'est le bouton à l'intérieur qui doit le retrouver
function _dpActiveDeep() {
  var a = document.activeElement;
  try {
    while (a) {
      var r = µ._mjs_shadowOf(a);
      if (!r || !r.activeElement) break;
      a = r.activeElement;
    }
  }
  catch { /* `activeElement` d'une racine d'ombre qui lève hors navigateur : on garde l'hôte */ }
  return a;
}

function _dpOpen() {
  _dpFocusPrecedent = _dpActiveDeep();
  _dpHost = document.createElement('div');
  _dpHost.setAttribute('data-mjs-devpanel', '');
  _dpRoot = _dpHost.attachShadow({ mode: 'open' });
  document.body.appendChild(_dpHost);
  _dpGeoReread();   // relecture PARESSEUSE du stockage (jamais au chargement du module) — puis borne
  _dpGeoClamp();   // la fenêtre a pu changer de taille depuis la dernière lecture de `_dpGeo`
  _dpRender();
  var panelEl = _dpRoot.querySelector('.panel');
  if (panelEl && panelEl.focus) panelEl.focus();
  document.addEventListener('keydown', _dpEchap);
  _dpRoot.addEventListener('pointerdown', _dpPointerDown, true);
  ['pointerdown', 'keydown', 'input'].forEach(function(type) { _dpRoot.addEventListener(type, _dpFocusRestoredEnd, true); });
  document.addEventListener('pointerup', _dpPointerUp, true);
  document.addEventListener('pointercancel', _dpPointerUp, true);
  // rafraîchissement doux : le panneau doit refléter la page sans la ralentir
  _dpTimer = setInterval(_dpTick, 700);
}

function _dpClose() {
  _dpAimEnd();
  clearInterval(_dpTimer); _dpTimer = null;
  _dpReleaseSpace();   // la page retrouve son bas AVANT que le panneau ne disparaisse
  _dpDrag = null;   // Échap ou fermeture programmatique en plein glissement : plus de pointerup à attendre
  document.removeEventListener('keydown', _dpEchap);
  document.removeEventListener('pointerup', _dpPointerUp, true);
  document.removeEventListener('pointercancel', _dpPointerUp, true);
  _dpPointer = false;
  _dpSurligner(null);
  if (_dpHighlight) { _dpHighlight.remove(); _dpHighlight = null; }
  _dpHost.remove(); _dpHost = null; _dpRoot = null;
  _dpObject = null;
  _dpFocusRestored = null;
  // `isConnected` : `document.contains` ne traverse pas l'ombre d'un composant, où le focus était peut-être
  if (_dpFocusPrecedent && _dpFocusPrecedent.focus && _dpFocusPrecedent.isConnected) _dpFocusPrecedent.focus();
  _dpFocusPrecedent = null;
}

// Échap : annule d'abord une visée « cibler » en cours, ferme le panneau sinon — venue du panneau
// seulement : une Échap de la page (une modale, un menu de l'appli) reste à l'application
function _dpEchap(e) {
  if (e.key !== 'Escape' && e.code !== 'Escape') return;
  if (!_dpAiming && !_dpInPanel(e)) return;
  e.preventDefault();
  if (_dpAiming) { _dpAimEnd(); _dpRender(); return; }
  _dpToggle(false);
}

// ------------------------------------------------------------------------------------------------
// « cibler » : le prochain clic dans la page désigne un composant — celui qui CONTIENT l'élément
// touché, frontières d'ombre franchies (`composedPath`, un shadow fermé s'arrête à son hôte, qui
// est justement le composant). Écoute en CAPTURE sur le document : le clic de visée est avalé
// avant d'atteindre la page, aucun bouton de l'application ne se déclenche. Un clic DANS le panneau
// n'est jamais une visée (le bouton « cibler » re-cliqué l'arrête, cf. la barre).
// ------------------------------------------------------------------------------------------------
var _dpAiming = false, _dpPrevCursor = null;
var _DP_AIM_SWALLOWED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];

function _dpInPanel(e) {
  var path = e.composedPath ? e.composedPath() : [];
  return path.indexOf(_dpHost) !== -1;
}

function _dpTouchedComponent(e) {
  var path = e.composedPath ? e.composedPath() : [e.target];
  for (var i = 0; i < path.length; i++) {
    if (path[i] instanceof µ.Element) return path[i];
  }
  return null;
}

function _dpAimMove(e) {
  if (!_dpInPanel(e)) _dpSurligner(_dpTouchedComponent(e));
}

function _dpAimSwallow(e) {
  if (_dpInPanel(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
}

function _dpAimClick(e) {
  if (_dpInPanel(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  var component = _dpTouchedComponent(e);
  _dpAimEnd();
  if (component) { _dpSelected = component; _dpObject = null; _dpView = null; }
  _dpRender();
}

function _dpAimStart() {
  if (_dpAiming) return;
  _dpAiming = true;
  document.addEventListener('pointermove', _dpAimMove, true);
  _DP_AIM_SWALLOWED.forEach(function(type) { document.addEventListener(type, _dpAimSwallow, true); });
  document.addEventListener('click', _dpAimClick, true);
  var root = document.documentElement;
  if (root && root.style) { _dpPrevCursor = root.style.cursor || ''; root.style.cursor = 'crosshair'; }
}

function _dpAimEnd() {
  if (!_dpAiming) return;
  _dpAiming = false;
  document.removeEventListener('pointermove', _dpAimMove, true);
  _DP_AIM_SWALLOWED.forEach(function(type) { document.removeEventListener(type, _dpAimSwallow, true); });
  document.removeEventListener('click', _dpAimClick, true);
  var root = document.documentElement;
  if (root && root.style && _dpPrevCursor !== null) root.style.cursor = _dpPrevCursor;
  _dpPrevCursor = null;
  _dpSurligner(null);
}

/** Le composant MJS qui porte `node` (lui-même compris), frontières d'ombre franchies. */
function _dpComponentOf(node) {
  while (node) {
    if (node instanceof µ.Element) return node;
    node = node.parentNode || node.host || null;
  }
  return null;
}

/**
 * Ouvre, ferme ou bascule le panneau — le seul endroit qui le fait. Sans argument : bascule (le
 * raccourci clavier) ; `true`/`false` : ouvre/ferme ; une chaîne : sélecteur CSS, cf. `_dpResolve`
 * (descend `µ.instances`, déjà plat vis-à-vis des frontières Shadow DOM) ; un élément : son
 * composant. Rend l'état obtenu (`true` = ouvert).
 */
function _dpToggle(arg) {
  _dpForgetDetached();
  if (typeof arg === 'string') {
    if (!_dpHost) _dpOpen();
    var target = _dpResolve(arg);
    if (target) { _dpSelected = target; _dpObject = null; _dpView = null; }
    _dpRender();
    return true;
  }
  if (arg && typeof arg === 'object' && arg.nodeType === 1) {
    if (!_dpHost) _dpOpen();
    var component = _dpComponentOf(arg);
    if (component) { _dpSelected = component; _dpObject = null; _dpView = null; }
    _dpRender();
    return true;
  }
  var isOpen = !!_dpHost;
  var wanted = arg === undefined ? !isOpen : !!arg;
  if (wanted === isOpen) return wanted;
  if (!wanted) { _dpClose(); return false; }
  _dpOpen();
  return true;
}

/** L'inspecteur d'objets générique (mjs_devinspect) sur une valeur quelconque, dans le panneau. */
function _dpInspect(value) {
  if (!_dpHost) _dpOpen();
  µ._mjs_diReset('object');   // jamais l'état de pli d'un appel précédent sur une AUTRE valeur
  _dpObject = { value: value, ns: 'object', title: µ._mjs_diPreview(value) };
  _dpRender();
  return true;
}

/**
 * La rune `µconsole` — la SEULE porte d'entrée publique du panneau :
 *   µconsole                → ouvre (dans un composant, le compilateur passe `_mjsThis` : ouvert sur lui)
 *   µconsole '.panier'      → ouvre sur le premier composant que le sélecteur désigne
 *   µconsole élément        → ouvre sur le composant qui porte cet élément
 *   µconsole $$panier       → ouvre l'inspecteur sur une valeur (objet, tableau, nombre…)
 *   µconsole true / false   → ouvre / ferme
 * Sans argument, elle OUVRE et ne referme jamais (écrite dans le code, elle ne doit pas éteindre un
 * panneau ouvert) : seul le raccourci clavier bascule. Rend l'état obtenu (`true` = ouvert).
 */
µ.console = function(target) {
  if (target === undefined || target === null) return _dpToggle(true);
  if (typeof target === 'boolean' || typeof target === 'string') return _dpToggle(target);
  if (typeof target === 'object' && target.nodeType === 1) return _dpToggle(target);
  return _dpInspect(target);
};

// `µconsole` tapé dans la console du navigateur : accesseur sur la fenêtre, NON énumérable —
// aucun parcours de `window` (copie, sérialisation) ne doit ouvrir le panneau par accident. Lu
// seul, il ouvre ; appelé (`µconsole('.panier')`), la fonction qu'il rend prend l'argument
function _dpPhrase() {
  return _dpHost ? '🔍 ' + µ._mjs_txt('dev.panelOpen', null, 'panneau d\'inspection ouvert — Échap pour le fermer') : '🔍 ' + µ._mjs_txt('dev.panelClosed', null, 'panneau d\'inspection fermé');
}

if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, 'µconsole', {
      configurable: true,
      enumerable: false,
      get: function() {
        µ.console(null);
        var call = function(target) { µ.console(target); return _dpPhrase(); };
        call.toString = _dpPhrase;
        return call;
      }
    });
  } catch { /* propriété verrouillée par la page : Ctrl+Shift+Espace reste disponible */ }
}

document.addEventListener('keydown', function(e) {
  var hotkey = (µ.config && µ.config.devPanelKey) || 'Space';
  if (e.ctrlKey && e.shiftKey && e.code === hotkey) {
    e.preventDefault();
    _dpToggle();
  }
});

if (µ.debug) console.log('🔍 ' + µ._mjs_msg('dev.panelArmed', null, 'panneau d\'inspection armé — Ctrl+Shift+Espace, ou µconsole'));
