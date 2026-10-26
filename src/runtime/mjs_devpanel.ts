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
// derrière, sans écran assombri par-dessus. Déplaçable (poignée = la `.barre`) et redimensionnable (`.grip-h`
// en bas, `.grip-c` en flottant) ; la géométrie vit dans `_dpGeo`, persistée en `localStorage`
// (`_dpGeoRelire`/`_dpGeoEcrire`), et se ré-applique à chaque `_dpRender()` (`_dpGeoAppliquer`).
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
// elle ouvre sur ce composant (cherche aussi dans les Shadow DOM imbriqués, cf. `_dpResoudre`,
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
var _dpOnglet = 'etat', _dpObjet = null, _dpFocusPrecedent = null;
var _dpVue = null;   // 'stores' ou 'effets' quand l'entrée du même nom est choisie dans l'arbre, sinon null (un composant)
var _dpArbreReplies = new Set();   // uids de composants REPLIÉS dans l'arbre — vide = tout déplié (comportement historique)
var _dpSignaturePrec = '';   // quel volet a été rendu au tour d'avant — cf. la préservation du défilement dans `_dpRender`
var _dpPointeur = false;   // un bouton du pointeur enfoncé dans le panneau — cf. `_dpTick`
var _dpFocusRestored = null;   // le contrôle d'un réglage dont le panneau vient de rendre le focus, tant qu'on n'y a pas retouché — cf. `_dpFocusRestore`

// géométrie du panneau — PERSISTE entre deux `_dpRender()` (qui réécrit tout l'innerHTML
// toutes les 700 ms) : le style est ré-appliqué à chaque rendu depuis cet objet
var _dpGeo = { mode: 'bas', h: 320, x: 40, y: 40, w: 720 };
var _dpGlissement = null;   // pointeur en cours de déplacement/redimensionnement, sinon null
var _dpGeoRelue  = false;   // la relecture du stockage est PARESSEUSE — cf. _dpGeoRelire

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
var _dpMaj = { on: false, fx: 'flash', color: '#facc15', duration: 600, style: 'outline' };
var _dpMajRelu = false;
var _dpMajObs  = new Map();   // racine observée → MutationObserver
var _dpMajFile = new Set();   // balises à éclairer à la prochaine image
var _dpMajTimer = 0;
var _dpMajImage = 0;
var _dpMajMuets = new WeakSet();   // balises où le panneau joue un effet : les attributs qu'il y réécrit ne comptent pas

function _dpMajRelire() {
  if (_dpMajRelu) return;
  _dpMajRelu = true;
  try {
    var v = JSON.parse(localStorage.getItem('mjs-devpanel-maj') || 'null');
    if (v && typeof v === 'object') ['fx', 'color', 'duration', 'style'].forEach(function(k) { if (v[k] !== void 0) _dpMaj[k] = v[k]; });
  }
  catch {}
}

function _dpMajEcrire() {
  try {
    localStorage.setItem('mjs-devpanel-maj', JSON.stringify({ fx: _dpMaj.fx, color: _dpMaj.color, duration: _dpMaj.duration, style: _dpMaj.style }));
  }
  catch {}
}

// un calque d'effet, le panneau ou son calque de surlignage : rien de la page
function _dpMajHorsPage(n) {
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
function _dpMajCalques(m) {
  if (m.addedNodes.length + m.removedNodes.length === 0) return false;
  var hors = function(n) { return _dpMajHorsPage(n) || _dpUpdateEffectNode(n); };
  return Array.prototype.every.call(m.addedNodes, hors) && Array.prototype.every.call(m.removedNodes, hors);
}

// la balise qu'une mutation désigne, si c'est une mise à jour de MJS ; null sinon
function _dpMajCible(m) {
  var t = m.type === 'characterData' ? m.target.parentNode : m.target;
  if (!t || t.nodeType !== 1 || _dpUpdateEffectNode(t)) return null;
  if (m.type === 'attributes') {
    var a = m.attributeName || '';
    if (/^mjs-/.test(a) || (a === 'style' && t.hasAttribute('mjs-fx')) || _dpMajMuets.has(t)) return null;
  }
  if (m.type === 'childList' && _dpMajCalques(m)) return null;
  for (var p = t; p && p.nodeType === 1; p = p.parentNode) {
    if (_dpMajHorsPage(p)) return null;
  }
  return t;
}

// un effet de l'appli : chargé, ou son fichier connu (il arrive à la demande, cf. mjs_fx.ts)
function _dpFxDispo(n) {
  return !!(µ._mjs_fxDefs && (µ._mjs_fxDefs[n] || (µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, 'mjs_fx_' + n.replace(/-/g, '_')))));
}

// les effets de l'appli qui se jouent une fois, proposés à la place de l'éclair
function _dpMajEffets() {
  var cat = µ._mjs_fxCatalog || {};
  return Object.keys(cat).filter(function(n) {
    var on = cat[n].s && cat[n].s.on;
    return n !== 'flash' && on && on[0][0] === 'l' && on[0][1].indexOf('load') >= 0 && _dpFxDispo(n);
  }).sort();
}

function _dpMajEclairer() {
  _dpMajImage = 0;
  var file = Array.from(_dpMajFile);
  _dpMajFile.clear();
  file.forEach(function(t) {
    if (!t.isConnected) return;
    var fx = _dpMaj.fx;
    if (fx !== 'flash' && _dpFxDispo(fx) && typeof µ._mjs_fx === 'function') {
      // un effet que la balise porte déjà (écrit dans l'appli) n'est pas repris ni retiré
      if (t._mjs_fxOff && t._mjs_fxOff[fx]) return;
      var r = t.getRootNode();
      // l'effet écrit dans le style de la balise, son retrait l'efface : ces écritures relançaient
      // l'effet à chaque retrait, sans fin — la balise reste muette tant qu'il dure, et jusqu'à ce
      // que l'observateur ait lu le retrait (le tour d'après)
      _dpMajMuets.add(t);
      var off = µ._mjs_fx(r && r.host ? r.host : null, t, fx, { on: 'load' });
      if (!off) {
        _dpMajMuets.delete(t);
        return;
      }
      setTimeout(function() {
        off();
        setTimeout(function() { _dpMajMuets.delete(t); }, 0);
      }, Math.max(100, +_dpMaj.duration || 600) + 400);
      return;
    }
    if (typeof µ._mjs_fxFlash === 'function') µ._mjs_fxFlash(t, { color: _dpMaj.color, duration: +_dpMaj.duration || 600, style: _dpMaj.style });
  });
}

// les racines à observer : la page, et chaque composant monté (les nouveaux sont repris à chaque tour)
function _dpMajSuivre() {
  var racines = [document.body];
  µ.instances.forEach(function(el) {
    var r = el._shadow || el.shadowRoot;
    if (r && el.isConnected) racines.push(r);
  });
  racines.forEach(function(r) {
    if (!r || _dpMajObs.has(r)) return;
    var mo = new MutationObserver(function(liste) {
      for (var i = 0; i < liste.length; i++) {
        var t = _dpMajCible(liste[i]);
        if (t) _dpMajFile.add(t);
      }
      if (_dpMajFile.size > 0 && !_dpMajImage) _dpMajImage = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(_dpMajEclairer) : setTimeout(_dpMajEclairer, 16);
    });
    mo.observe(r, { childList: true, characterData: true, attributes: true, subtree: true });
    _dpMajObs.set(r, mo);
  });
  // les composants partis : leur racine n'est plus suivie
  _dpMajObs.forEach(function(mo, r) {
    if (r !== document.body && !(r.host && r.host.isConnected)) {
      mo.disconnect();
      _dpMajObs.delete(r);
    }
  });
}

function _dpMajBasculer(on) {
  _dpMaj.on = on;
  if (on) {
    _dpMajSuivre();
    if (!_dpMajTimer) _dpMajTimer = setInterval(_dpMajSuivre, 1000);
    return;
  }
  clearInterval(_dpMajTimer);
  _dpMajTimer = 0;
  _dpMajObs.forEach(function(mo) { mo.disconnect(); });
  _dpMajObs.clear();
  _dpMajFile.clear();
}

/** Nom court d'une instance : `mjs-my-counter` → `my-counter`. */
function _dpName(el) {
  return el.tagName.toLowerCase().replace(/^mjs-/, '');
}

// identifiant STABLE par instance — namespace des chemins dépliés dans mjs_devinspect, et clé
// de repli/dépli de l'arbre. Un WeakMap plutôt qu'une propriété posée sur l'élément : zéro
// risque de collision avec une clé `_state`/`_mjs_var_bits` du composant lui-même
var _dpUidMap = new WeakMap(), _dpUidSuivant = 1;
function _dpUid(el) {
  var id = _dpUidMap.get(el);
  if (!id) { id = _dpUidSuivant++; _dpUidMap.set(el, id); }
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

/** Arbre des instances vivantes : [{el, enfants:[…]}], racines d'abord. */
function _dpTree() {
  var vivantes = [];
  µ.instances.forEach(function(el) { if (el.isConnected) vivantes.push(el); });
  var noeuds = new Map();
  vivantes.forEach(function(el) { noeuds.set(el, { el: el, enfants: [] }); });
  var racines = [];
  vivantes.forEach(function(el) {
    var parent = _dpParent(el);
    if (parent && noeuds.has(parent)) noeuds.get(parent).enfants.push(noeuds.get(el));
    else racines.push(noeuds.get(el));
  });
  return racines;
}

// `matches` de la balise, insensible à une méthode du composant du même nom (cf. mjs_element.ts)
µ._mjs_matches = µ._mjs_matches || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.matches.call(n, sel);
  return !!n && typeof n.matches === 'function' && n.matches(sel);
};

/** Vrai si `selecteur` matche un ANCÊTRE de `el` (frontières d'ombre franchies). */
function _dpAncetreMatch(el, selecteur) {
  var node = el.parentNode;
  while (node) {
    if (node.nodeType === 11) { node = node.host; continue; }
    if (node.nodeType === 1 && µ._mjs_matches(node, selecteur)) return true;
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
function _dpResoudre(selecteur) {
  var candidats = Array.from(µ.instances).filter(function(el) { return el.isConnected; });
  try {
    // d'abord une instance que le sélecteur désigne ELLE-MÊME : un enfant enregistré avant son
    // parent l'emportait sinon (son ancêtre matche aussi), `µconsole 'mjs-parent'` ouvrait sur l'enfant
    for (var i = 0; i < candidats.length; i++) {
      if (µ._mjs_matches(candidats[i], selecteur)) return candidats[i];
    }
    for (var j = 0; j < candidats.length; j++) {
      if (_dpAncetreMatch(candidats[j], selecteur)) return candidats[j];
    }
  } catch { /* sélecteur invalide : aucune correspondance, jamais un crash */ }
  return null;
}

/** Valeur lisible et courte, pour une ligne de tableau (délègue à l'inspecteur générique). */
function _dpApercu(v) {
  return µ._mjs_diApercu(v);
}

// `_mjs_computedKeys` est un TABLEAU de noms (cf. `_mjs_setComputed`, mjs_element.ts), pas une
// table — s'y tromper listerait les indices `0`, `1`… à la place des dérivés
/** Les clés d'état PROPRES au composant, sans les dérivés ni la plomberie. */
function _dpEtatKeys(el) {
  var etat = el._state || {};
  var derives = new Set(el._mjs_computedKeys || []);
  // préfixe interne EXPLICITE (`_mjs_`), pas tout ce qui commence par `_` : `$_x` est un nom de
  // var d'état valide (SIGIL_ID autorise `_` en 1re position, c'est même l'exemple du framework
  // pour µread/µwrite) — un filtre sur le seul `_` la masquait à tort dans l'onglet État.
  return Object.keys(etat).filter(function(k) { return !derives.has(k) && k.indexOf('_mjs_') !== 0; }).sort();
}

// texte de la règle d'une variable ou d'un store typé (bloc <vars>, présent hors production)
function _dpRegle(regles, k) {
  return regles && Object.prototype.hasOwnProperty.call(regles, k) ? regles[k].d : void 0;
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
function _dpGeoRelire() {
  if (_dpGeoRelue) return;
  _dpGeoRelue = true;
  try {
    if (typeof localStorage === 'undefined') { _dpGeoBorner(); return; }
    var brut = localStorage.getItem('mjs-devpanel-geo');
    if (!brut) { _dpGeoBorner(); return; }
    var lu = JSON.parse(brut);
    if (!lu || typeof lu !== 'object') { _dpGeoBorner(); return; }
    if (lu.mode === 'bas' || lu.mode === 'flottant') _dpGeo.mode = lu.mode;
    if (typeof lu.h === 'number') _dpGeo.h = lu.h;
    if (typeof lu.w === 'number') _dpGeo.w = lu.w;
    if (typeof lu.x === 'number') _dpGeo.x = lu.x;
    if (typeof lu.y === 'number') _dpGeo.y = lu.y;
  } catch { /* stockage désactivé ou valeur corrompue : on garde les valeurs par défaut */ }
  _dpGeoBorner();
}

/** Écrit `_dpGeo` dans `localStorage` — silencieux si le stockage est indisponible. */
function _dpGeoEcrire() {
  // même raison qu'au § 2 de `_dpGeoRelire` : le `typeof` lui-même peut lever, il reste DANS le try
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('mjs-devpanel-geo', JSON.stringify(_dpGeo));
  } catch { /* stockage indisponible ou refusé : tant pis */ }
}

/** Ramène `_dpGeo` dans des bornes valides, fenêtre courante comprise. */
function _dpGeoBorner() {
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
var _dpPaddingPrec = null;   // padding bas INLINE d'avant nous, rendu tel quel à la fermeture

function _dpElementDefilant() {
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
function _dpReserverEspace() {
  var el = _dpElementDefilant();
  if (el && el.style) {
    if (_dpPaddingPrec === null) _dpPaddingPrec = el.style.paddingBottom || '';
    el.style.paddingBottom = _dpGeo.h + 'px';
  }
  var racine = document.documentElement;
  if (racine && racine.style) {
    racine.style.setProperty('--mjs-devpanel-h', _dpGeo.h + 'px');
    racine.setAttribute('data-mjs-devpanel-dock', '');
  }
}

/** Rend la place à la page — mode flottant ou panneau fermé. Idempotent. */
function _dpLibererEspace() {
  var el = _dpElementDefilant();
  if (el && el.style && _dpPaddingPrec !== null) el.style.paddingBottom = _dpPaddingPrec;
  _dpPaddingPrec = null;
  var racine = document.documentElement;
  if (racine && racine.style) {
    racine.style.removeProperty('--mjs-devpanel-h');
    racine.removeAttribute('data-mjs-devpanel-dock');
  }
}

/** Applique `_dpGeo` en style inline sur le nœud `.panneau` — ré-appliqué à chaque rendu, cf. en-tête du fichier. */
function _dpGeoAppliquer(panneauEl) {
  if (_dpGeo.mode === 'flottant') { panneauEl.style.cssText = 'left:' + _dpGeo.x + 'px; top:' + _dpGeo.y + 'px; right:auto; bottom:auto; width:' + _dpGeo.w + 'px; height:' + _dpGeo.h + 'px; border-radius:10px;'; _dpLibererEspace(); }
  else { panneauEl.style.cssText = 'left:0; right:0; bottom:0; top:auto; width:auto; height:' + _dpGeo.h + 'px; border-radius:10px 10px 0 0; border-bottom:0;'; _dpReserverEspace(); }
}

/**
 * Vrai si le focus est DANS un champ de saisie du panneau. Le rendu périodique réécrit tout
 * l'`innerHTML` : sans cette garde, une valeur d'état qu'on tape perdait le focus et le texte
 * en cours toutes les 700 ms — le champ n'existait plus, le caret non plus.
 */
function _dpSaisieEnCours() {
  // `activeElement` d'un shadow root peut LEVER hors navigateur (happy-dom remonte à travers
  // les shadow roots frères et finit par déréférencer undefined quand le focus est dans un
  // AUTRE shadow root que le nôtre). Une exception ici sort du callback de `setInterval`, qui
  // ANNULE l'intervalle : le panneau se figerait pour de bon, sans le moindre message. On
  // préfère donc conclure « personne ne saisit » — un rendu de trop, jamais un panneau mort.
  var actif;
  try { actif = _dpRoot && _dpRoot.activeElement } catch { return false }
  if (!actif) return false;
  // le contrôle dont le panneau vient de rendre le focus après un réglage, et auquel on n'a pas retouché : rien n'y est en cours
  if (actif === _dpFocusRestored) return false;
  return actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || actif.tagName === 'SELECT' || actif.isContentEditable === true;
}

// l'élément du panneau qui a le focus, null sinon — même garde que ci-dessus
function _dpActive() {
  try { return (_dpRoot && _dpRoot.activeElement) || null } catch { return null }
}

// le contrôle d'un réglage qui a le focus, de quoi le retrouver quand le panneau est réécrit : un réglage de l'éclair
// (`data-maj`), ou celui d'un effet (son bloc `data-fx`, sa clé `data-cle`) ; null pour tout autre
function _dpFocusMark() {
  var actif = _dpActive();
  if (!actif || typeof actif.hasAttribute !== 'function') return null;
  if (actif.hasAttribute('data-maj')) return '[data-maj="' + actif.getAttribute('data-maj') + '"]';
  var bloc = actif.hasAttribute('data-cle') && actif.closest ? actif.closest('.fx') : null;
  return bloc ? '.fx[data-fx="' + bloc.getAttribute('data-fx') + '"] [data-cle="' + actif.getAttribute('data-cle') + '"]' : null;
}

// rend le focus au contrôle redessiné que `mark` désigne : la réécriture avait détruit celui qui l'avait, le focus tombait
// sur <body> et Échap ne fermait plus le panneau ; sans défilement (le volet reprend sa position juste après) ; tant qu'on
// n'y retouche pas, ce contrôle n'est pas une saisie en cours (cf. `_dpSaisieEnCours`) : le battement continue de redessiner, le focus suit
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
function _dpPointeurBas() { _dpPointeur = true; }
function _dpPointeurHaut() { _dpPointeur = false; }

/** Battement du rafraîchissement périodique : passe son tour tant qu'on saisit (cf. `_dpSaisieEnCours`), qu'un bouton du pointeur est enfoncé dans le panneau ou qu'une ligne de code y est sélectionnée (cf. `_dpSelectionInCode`). */
function _dpTick() {
  if (_dpOublierDetache()) return;
  if (_dpSaisieEnCours() || _dpPointeur || _dpSelectionInCode()) return;
  _dpRender();
}

// l'application peut retirer l'hôte du panneau de la page sans passer par lui — un démarrage qui
// remplace tout le `<body>`, par exemple APRÈS un `µconsole` de `<script module>`, exécuté dès
// l'import : un hôte détaché compte pour fermé, et on range ce qu'il laissait derrière lui
// (minuterie, écouteurs). Rend vrai s'il a fallu le faire
function _dpOublierDetache() {
  if (!_dpHost || _dpHost.isConnected) return false;
  _dpFermer();
  return true;
}

/** Démarre un déplacement (`genre` 'deplacer') ou un redimensionnement ('redim-h'/'redim-c') au pointeur. */
function _dpGlisserDemarrer(e, genre) {
  var panneauEl = _dpRoot && _dpRoot.querySelector('.panneau');
  if (!panneauEl) return;
  if (genre === 'deplacer' && _dpGeo.mode === 'bas') {
    var rect = panneauEl.getBoundingClientRect();   // position/taille visibles à l'instant du bascule bas → flottant
    _dpGeo.mode = 'flottant'; _dpGeo.x = rect.left; _dpGeo.y = rect.top; _dpGeo.w = rect.width; _dpGeo.h = rect.height;
  }
  var cible = e.currentTarget;
  _dpGlissement = { genre: genre, cible: cible, pointerId: e.pointerId, depX: e.clientX, depY: e.clientY, geoDep: { x: _dpGeo.x, y: _dpGeo.y, w: _dpGeo.w, h: _dpGeo.h } };
  cible.setPointerCapture(e.pointerId);
  cible.addEventListener('pointermove', _dpGlisserBouger);
  cible.addEventListener('pointerup', _dpGlisserFinir);
  cible.addEventListener('pointercancel', _dpGlisserFinir);
  clearInterval(_dpTimer); _dpTimer = null;   // sinon l'innerHTML est réécrit sous le pointeur
}

/** Suit le pointeur : ajuste `_dpGeo` et réapplique juste le style, sans repasser par `_dpRender()`. */
function _dpGlisserBouger(e) {
  if (!_dpGlissement) return;
  var dx = e.clientX - _dpGlissement.depX, dy = e.clientY - _dpGlissement.depY;
  var depart = _dpGlissement.geoDep;
  if (_dpGlissement.genre === 'deplacer') { _dpGeo.x = depart.x + dx; _dpGeo.y = depart.y + dy; }
  else if (_dpGlissement.genre === 'redim-h') _dpGeo.h = depart.h - dy;
  else if (_dpGlissement.genre === 'redim-c') { _dpGeo.w = depart.w + dx; _dpGeo.h = depart.h + dy; }
  _dpGeoBorner();
  var panneauEl = _dpRoot && _dpRoot.querySelector('.panneau');
  if (panneauEl) _dpGeoAppliquer(panneauEl);
}

/** Relâche le pointeur, referme le glissement, sauvegarde la géométrie et relance le rendu périodique. */
function _dpGlisserFinir(e) {
  if (!_dpGlissement) return;
  var cible = _dpGlissement.cible;
  cible.removeEventListener('pointermove', _dpGlisserBouger);
  cible.removeEventListener('pointerup', _dpGlisserFinir);
  cible.removeEventListener('pointercancel', _dpGlisserFinir);
  if (cible.releasePointerCapture) { try { cible.releasePointerCapture(_dpGlissement.pointerId); } catch { /* déjà relâché */ } }
  _dpGlissement = null;
  _dpGeoEcrire();
  _dpRender();
  _dpTimer = setInterval(_dpTick, 700);
}

var _DP_CSS = `
:host { all: initial; }
.panneau { position: fixed; display: grid; grid-template-rows: auto 1fr; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.5); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; z-index: 2147483647; overflow: hidden; }
.grip-h { position: absolute; top: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; z-index: 1; }
.grip-c { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; z-index: 1; }
.barre { display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; border-bottom: 1px solid #30363d; background: #161b22; cursor: move; }
.titre { font-weight: 700; color: #6ea8fe; }
.compte { opacity: .6; }
.barre button { font: inherit; background: #21262d; color: inherit; border: 1px solid #30363d; border-radius: 6px; padding: .15rem .5rem; cursor: pointer; }
.barre button[aria-pressed="true"] { background: #1f6feb; border-color: #1f6feb; }
.barre .pousse { margin-left: auto; }
.maj { display: flex; flex-wrap: wrap; align-items: center; gap: .9rem; padding: .35rem .75rem; border-bottom: 1px solid #30363d; background: #0d1117; }
.maj label { display: flex; align-items: center; gap: .35rem; color: #8b949e; }
.maj select, .maj input { font: inherit; background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 4px; padding: .05rem .3rem; }
.maj input[type="number"] { width: 5.5rem; }
.maj input[type="color"] { width: 2.2rem; height: 1.4rem; padding: 0; }
.corps { display: grid; grid-template-columns: minmax(220px, 30%) 1fr; overflow: hidden; }
.arbre { overflow: auto; border-right: 1px solid #30363d; padding: .35rem 0; }
.noeud { display: flex; align-items: center; }
.repli { font: inherit; background: none; border: 0; color: #8b949e; cursor: pointer; width: 1.3rem; flex: none; }
.ligne { display: flex; flex: 1; align-items: center; gap: .4rem; padding: .1rem .6rem .1rem 0; cursor: pointer; white-space: nowrap; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; user-select: none; }
.ligne-stores { color: #d2a8ff; }
.ligne:hover { background: #161b22; }
.ligne[aria-selected="true"] { background: #1f6feb; }
.ligne .rendus { opacity: .55; font-size: .9em; }
.detail { display: flex; flex-direction: column; overflow: hidden; }
.di-entete { padding: .6rem .8rem .3rem; font-weight: 700; color: #6ea8fe; }
.onglets { display: flex; gap: .9rem; padding: 0 .8rem .4rem; border-bottom: 1px solid #30363d; flex-wrap: wrap; }
.onglet { font: inherit; background: transparent; color: #8b949e; border: 0; border-bottom: 2px solid transparent; padding: .3rem .1rem; cursor: pointer; }
.onglet[aria-selected="true"] { color: #e6edf3; border-bottom-color: #6ea8fe; }
.onglet-corps { flex: 1; overflow: auto; padding: .6rem .8rem; }
.onglet-corps h2 { margin: 0 0 .4rem; font-size: 12px; color: #6ea8fe; text-transform: uppercase; letter-spacing: .06em; }
.onglet-corps section { margin-bottom: .9rem; }
.lien-retour { font: inherit; background: none; border: 0; color: #6ea8fe; cursor: pointer; padding: .5rem .8rem 0; text-align: left; }
table { border-collapse: collapse; width: 100%; }
td { padding: .12rem .4rem .12rem 0; vertical-align: top; }
td.cle { color: #7ee787; white-space: nowrap; }
td.deps { color: #d2a8ff; white-space: nowrap; }
.di-css { white-space: pre-wrap; word-break: break-word; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: .5rem; max-height: 240px; overflow: auto; }
.vide { opacity: .5; }
.aide { padding: 2rem; text-align: center; opacity: .6; }
.ligne-effets { color: #ff7b72; }
.fx { border: 1px solid #30363d; border-radius: 6px; padding: .4rem .55rem; margin-bottom: .6rem; }
.fx-tete { display: flex; align-items: center; gap: .5rem; }
.fx-balise { color: #8b949e; }
.fx-nom { color: #ff7b72; font-weight: 700; }
.fx-tete [data-action="fx-copier"] { margin-left: auto; }
.fx-var { color: #79c0ff; }
.fx-tete button { font: inherit; background: #21262d; color: inherit; border: 1px solid #30363d; border-radius: 6px; padding: .05rem .45rem; cursor: pointer; }
.fx-code { display: block; margin: .3rem 0 .4rem; color: #79c0ff; white-space: pre-wrap; word-break: break-word; }
.fx input, .fx select { font: inherit; background: #0d1117; color: inherit; border: 1px solid #30363d; border-radius: 4px; padding: .05rem .3rem; max-width: 16rem; }
.fx input[type="number"] { width: 6.5rem; }
.fx-regle { color: #8b949e; }
.fx-principal { color: #d2a8ff; font-size: .85em; }
`;

// la rangée des réglages de l'éclair, sous la barre, quand « mises à jour » est coché
function _dpMajReglages() {
  var o = function(v, t, pris) { return '<option value="' + v + '"' + (pris ? ' selected' : '') + '>' + t + '</option>'; };
  var effets = ['flash'].concat(_dpMajEffets());
  return '<div class="maj">' +
    '<label>' + µ._mjs_txt('dev.majEffect', null, 'effet') + ' <select data-maj="fx">' + effets.map(function(n) { return o(n, '*' + n, n === _dpMaj.fx); }).join('') + '</select></label>' +
    '<label>style <select data-maj="style">' + ['outline', 'fill', 'glow'].map(function(n) { return o(n, n, n === _dpMaj.style); }).join('') + '</select></label>' +
    '<label>' + µ._mjs_txt('dev.majColor', null, 'couleur') + ' <input type="color" data-maj="color" value="' + µ._esc(String(_dpMaj.color)) + '"></label>' +
    '<label>' + µ._mjs_txt('dev.majDuration', null, 'durée') + ' <input type="number" data-maj="duration" min="50" max="5000" step="50" value="' + (+_dpMaj.duration || 600) + '"> ms</label>' +
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
  var volet = _dpRoot.querySelector('.arbre'), corpsPrec = _dpRoot.querySelector('.onglet-corps');
  var defArbre = volet ? volet.scrollTop : 0, defCorps = corpsPrec ? corpsPrec.scrollTop : 0;
  var signature = _dpOnglet + '|' + (_dpSelected ? _dpUid(_dpSelected) : 0) + '|' + (_dpObjet ? 'obj' : '') + '|' + (_dpVue || '');
  var racines = _dpTree();
  var total = 0;
  µ.instances.forEach(function(el) { if (el.isConnected) total++; });

  var grip = _dpGeo.mode === 'bas' ? '<div class="grip-h" data-grip="h"></div>' : '<div class="grip-c" data-grip="c"></div>';
  var libelleAncrer = _dpGeo.mode === 'flottant' ? µ._mjs_txt('dev.anchorBottom', null, 'ancrer en bas') : µ._mjs_txt('dev.anchorDetach', null, 'détacher');
  var html = '<div class="panneau" role="dialog" aria-labelledby="dp-titre" tabindex="-1">' + grip + '<div class="barre"><span class="titre" id="dp-titre">ModularJS</span>' +
    '<span class="compte">' + (total > 1 ? µ._mjs_txt('dev.mountedMany', { n: total }, '{n} composants montés') : µ._mjs_txt('dev.mountedOne', { n: total }, '{n} composant monté')) + '</span>' +
    '<button data-action="cibler" aria-pressed="' + (_dpVisee ? 'true' : 'false') + '" title="' + µ._mjs_txt('dev.tipTarget', null, 'cliquer ensuite un élément de la page') + '">' + µ._mjs_txt('dev.btnTarget', null, 'cibler') + '</button>' +
    '<button class="pousse" data-action="flash" aria-pressed="' + (µ.debugMode ? 'true' : 'false') + '" title="' + µ._mjs_txt('dev.tipFlash', null, 'chaque composant qui se re-rend s\'éclaire') + '">' + µ._mjs_txt('dev.btnFlash', null, 'clignoter au rendu') + '</button>' +
    '<button data-action="maj" aria-pressed="' + (_dpMaj.on ? 'true' : 'false') + '" title="' + µ._mjs_txt('dev.tipUpdates', null, 'chaque morceau que MJS réécrit s\'éclaire') + '">' + µ._mjs_txt('dev.btnUpdates', null, 'mises à jour') + '</button>' +
    '<button data-action="ancrer">' + libelleAncrer + '</button>' +
    '<button data-action="refresh">' + µ._mjs_txt('dev.btnRefresh', null, 'rafraîchir') + '</button>' +
    '<button data-action="close">' + µ._mjs_txt('dev.btnClose', null, 'fermer') + '</button>' +
    '</div>' + (_dpMaj.on ? _dpMajReglages() : '') + '<div class="corps"><div class="arbre"></div><div class="detail"></div></div></div>';
  _dpRoot.innerHTML = '<style>' + _DP_CSS + '</style>' + html;

  var arbre = _dpRoot.querySelector('.arbre');
  // en tête de l'arbre, les stores — seulement s'il y en a (clés CACHÉES exclues : µlang & co)
  var clesStore = µ.store ? Object.keys(µ.store) : [];
  if (clesStore.length > 0) {
    var noeudStores = document.createElement('div');
    noeudStores.className = 'noeud';
    noeudStores.innerHTML = '<span class="repli" aria-hidden="true"></span><button type="button" class="ligne ligne-stores" aria-selected="' + (_dpVue === 'stores' && !_dpObjet ? 'true' : 'false') + '"><span>stores ($$)</span><span class="rendus">·' + clesStore.length + '</span></button>';
    noeudStores.querySelector('.ligne').addEventListener('click', function() { _dpVue = 'stores'; _dpObjet = null; _dpRender(); });
    arbre.appendChild(noeudStores);
  }
  // puis les effets de la page — seulement s'il y en a
  var nbEffets = _dpFxListe(null).length;
  if (nbEffets > 0) {
    var noeudEffets = document.createElement('div');
    noeudEffets.className = 'noeud';
    noeudEffets.innerHTML = '<span class="repli" aria-hidden="true"></span><button type="button" class="ligne ligne-effets" aria-selected="' + (_dpVue === 'effets' && !_dpObjet ? 'true' : 'false') + '"><span>' + µ._mjs_txt('dev.rowEffects', null, 'effets (*)') + '</span><span class="rendus">·' + nbEffets + '</span></button>';
    noeudEffets.querySelector('.ligne').addEventListener('click', function() { _dpVue = 'effets'; _dpObjet = null; _dpRender(); });
    arbre.appendChild(noeudEffets);
  }
  var lignes = [];
  (function marcher(noeuds, profondeur) {
    noeuds.sort(function(a, b) { return _dpName(a.el) < _dpName(b.el) ? -1 : 1; });
    noeuds.forEach(function(n) {
      lignes.push({ el: n.el, profondeur: profondeur, aEnfants: n.enfants.length > 0 });
      if (!_dpArbreReplies.has(_dpUid(n.el))) marcher(n.enfants, profondeur + 1);
    });
  })(racines, 0);

  lignes.forEach(function(l) {
    var uid = _dpUid(l.el);
    var noeud = document.createElement('div');
    noeud.className = 'noeud';
    noeud.style.paddingLeft = (l.profondeur * 0.9) + 'rem';
    noeud.innerHTML = (l.aEnfants
        ? '<button type="button" class="repli" data-uid="' + uid + '" aria-expanded="' + (_dpArbreReplies.has(uid) ? 'false' : 'true') + '">' + (_dpArbreReplies.has(uid) ? '▸' : '▾') + '</button>'
        : '<span class="repli" aria-hidden="true"></span>') +
      '<button type="button" class="ligne" aria-selected="' + (l.el === _dpSelected && !_dpVue ? 'true' : 'false') + '"><span>' +
      µ._esc(_dpName(l.el)) + '</span><span class="rendus">·' + (l.el._mjs_renderCount || 0) + '</span></button>';
    var boutonRepli = noeud.querySelector('.repli[data-uid]');
    if (boutonRepli) {
      boutonRepli.addEventListener('click', function(e) {
        e.stopPropagation();
        if (_dpArbreReplies.has(uid)) _dpArbreReplies.delete(uid); else _dpArbreReplies.add(uid);
        _dpRender();
      });
    }
    var boutonLigne = noeud.querySelector('.ligne');
    boutonLigne.addEventListener('click', function() { _dpSelected = l.el; _dpObjet = null; _dpVue = null; _dpRender(); });
    // double-clic = la flèche : les deux clics qui le précèdent ont déjà sélectionné (et redessiné
    // l'arbre — le double-clic arrive sur la ligne REDESSINÉE, écoutée comme les autres)
    boutonLigne.addEventListener('dblclick', function() {
      if (!l.aEnfants) return;
      if (_dpArbreReplies.has(uid)) _dpArbreReplies.delete(uid); else _dpArbreReplies.add(uid);
      _dpRender();
    });
    boutonLigne.addEventListener('mouseenter', function() { _dpSurligner(l.el); });
    boutonLigne.addEventListener('mouseleave', function() { _dpSurligner(null); });
    arbre.appendChild(noeud);
  });

  _dpRenderDetail(_dpRoot.querySelector('.detail'));

  _dpRoot.querySelectorAll('.barre button').forEach(function(b) {
    b.addEventListener('click', function() {
      var action = b.getAttribute('data-action');
      if (action === 'close') _dpBasculer(false);
      else if (action === 'cibler') { if (_dpVisee) _dpViseeFin(); else _dpViseeDebut(); _dpRender(); }
      else if (action === 'refresh') _dpRender();
      else if (action === 'flash') { µ.debugMode = !µ.debugMode; _dpRender(); }
      else if (action === 'maj') { _dpMajRelire(); _dpMajBasculer(!_dpMaj.on); _dpRender(); }
      else if (action === 'ancrer') { _dpGeo.mode = _dpGeo.mode === 'flottant' ? 'bas' : 'flottant'; _dpGeoBorner(); _dpGeoEcrire(); _dpRender(); }
    });
  });

  _dpRoot.querySelectorAll('[data-maj]').forEach(function(c) {
    c.addEventListener('change', function() {
      var k = c.getAttribute('data-maj');
      _dpMaj[k] = k === 'duration' ? Math.max(50, Math.min(5000, +c.value || 600)) : c.value;
      _dpMajEcrire();
      // redessiné : le contrôle est remplacé et le focus lui est rendu — au clavier (une flèche sur un menu, Entrée
      // dans un nombre) on y reste, Échap ferme encore le panneau —, et le rafraîchissement périodique reprend (il
      // passe son tour tant qu'on saisit)
      var mark = _dpFocusMark();
      _dpRender();
      _dpFocusRestore(mark);
    });
  });

  var panneauEl = _dpRoot.querySelector('.panneau');
  _dpRoot.querySelector('.barre').addEventListener('pointerdown', function(e) {
    if (e.target.closest('button')) return;
    _dpGlisserDemarrer(e, 'deplacer');
  });
  var gripH = _dpRoot.querySelector('.grip-h');
  if (gripH) gripH.addEventListener('pointerdown', function(e) { _dpGlisserDemarrer(e, 'redim-h'); });
  var gripC = _dpRoot.querySelector('.grip-c');
  if (gripC) gripC.addEventListener('pointerdown', function(e) { _dpGlisserDemarrer(e, 'redim-c'); });
  _dpGeoAppliquer(panneauEl);

  var arbreNouveau = _dpRoot.querySelector('.arbre');
  if (arbreNouveau) arbreNouveau.scrollTop = defArbre;
  var corpsNouveau = _dpRoot.querySelector('.onglet-corps');
  if (corpsNouveau && signature === _dpSignaturePrec) corpsNouveau.scrollTop = defCorps;
  _dpSignaturePrec = signature;
  _dpFocusRestore(mark);
}

var _DP_ONGLETS = function() {
  return [
    { id: 'etat', libelle: µ._mjs_txt('dev.tabState', null, 'État') },
    { id: 'derives', libelle: µ._mjs_txt('dev.tabDerived', null, 'Dérivés') },
    { id: 'liaisons', libelle: µ._mjs_txt('dev.tabBindings', null, 'Liaisons') },
    { id: 'contexte', libelle: µ._mjs_txt('dev.tabContext', null, 'Contexte') },
    { id: 'props', libelle: µ._mjs_txt('dev.tabProps', null, 'Attributs et props') },
    { id: 'style', libelle: µ._mjs_txt('dev.tabStyle', null, 'Style et thème') },
    { id: 'effets', libelle: µ._mjs_txt('dev.tabEffects', null, 'Effets') }
  ];
}

/**
 * Texte CSS actif sur le composant : les feuilles ADOPTÉES d'abord — c'est par là que passe
 * le framework par défaut (`_shadow.adoptedStyleSheets`, cf. `_mjs_applyLayout`/mjs_element.ts) —
 * un `<style>` réel seulement en repli (mode `mjs-light`, panneau « route introuvable » du
 * routeur : ni l'un ni l'autre n'a d'adoptedStyleSheets).
 */
function _dpStyleTexte(el) {
  var feuilles = (el._shadow && el._shadow.adoptedStyleSheets) || [];
  var morceaux = [];
  feuilles.forEach(function(feuille, i) {
    try {
      var texte = Array.from(feuille.cssRules || []).map(function(r) { return r.cssText; }).join('\n');
      if (texte) morceaux.push('/* feuille ' + (i + 1) + '/' + feuilles.length + ' */\n' + texte);
    } catch { /* feuille illisible (rare) : ignorée sans planter */ }
  });
  if (morceaux.length) return morceaux.join('\n\n');
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
  var actif = document.documentElement.getAttribute('data-mjs-theme') || document.documentElement.getAttribute('theme') || 'light';
  var connus = ['light', 'dark'].concat(Array.isArray(µ._themes) ? µ._themes : []);
  var source = (µ._themeCss || '') + '\n' + (µ._themeCssByName ? Object.keys(µ._themeCssByName).map(function(k) { return µ._themeCssByName[k]; }).join('\n') : '');
  var noms = new Set(), re = /--([a-zA-Z0-9_-]+)\s*:/g, m;
  while ((m = re.exec(source))) noms.add(m[1]);
  var vars = Array.from(noms).sort().map(function(nom) {
    var val = '';
    try { val = getComputedStyle(el).getPropertyValue('--' + nom).trim(); } catch { val = ''; }
    return { nom: nom, val: val };
  });
  return { actif: actif, connus: connus, vars: vars };
}

function _dpOngletStyle(el) {
  var info = _dpThemeInfo(el);
  var css = _dpStyleTexte(el);
  var varsHtml = info.vars.length
    ? '<table>' + info.vars.map(function(v) { return '<tr><td class="cle">--' + µ._esc(v.nom) + '</td><td>' + µ._esc(v.val || µ._mjs_txt('dev.empty', null, '(vide)')) + '</td></tr>'; }).join('') + '</table>'
    : '<p class="vide">' + µ._mjs_txt('dev.themeNone', null, 'aucune variable de thème détectée') + '</p>';
  return '<section><h2>' + µ._mjs_txt('dev.themeActive', null, 'Thème actif') + '</h2><p>' + µ._esc(info.actif) + ' — ' + µ._mjs_txt('dev.themeKnown', null, 'connus :') + ' ' + µ._esc(info.connus.join(', ')) + '</p></section>' +
    '<section><h2>' + µ._mjs_txt('dev.themeVars', null, 'Variables de thème en vigueur') + '</h2>' + varsHtml + '</section>' +
    '<section><h2>' + µ._mjs_txt('dev.cssActive', null, 'CSS actif (feuilles adoptées)') + '</h2><pre class="di-css">' + (css ? µ._esc(css) : '<span class="vide">' + µ._mjs_txt('dev.cssNone', null, 'aucun CSS propre détecté') + '</span>') + '</pre></section>';
}

function _dpOngletProps(el) {
  var declares = el._mjs_var_bits ? Object.keys(el._mjs_var_bits).sort() : [];
  var lignesDeclares = declares.map(function(k) {
    return '<tr><td class="cle">' + µ._esc(k) + '</td><td>' + µ._esc(_dpApercu(el._state ? el._state[k] : undefined)) + '</td></tr>';
  }).join('');
  var attrs = Array.from(el.attributes || []);
  var lignesAttrs = attrs.map(function(a) {
    return '<tr><td class="cle">' + µ._esc(a.name) + '</td><td>' + µ._esc(a.value) + '</td></tr>';
  }).join('');
  return '<section><h2>' + µ._mjs_txt('dev.propsDeclared', null, 'Props / variables déclarées') + '</h2>' + (lignesDeclares ? '<table>' + lignesDeclares + '</table>' : '<p class="vide">' + µ._mjs_txt('dev.noneF', null, 'aucune') + '</p>') + '</section>' +
    '<section><h2>' + µ._mjs_txt('dev.attrsReal', null, 'Attributs réels de l\'élément') + '</h2>' + (lignesAttrs ? '<table>' + lignesAttrs + '</table>' : '<p class="vide">' + µ._mjs_txt('dev.noneM', null, 'aucun') + '</p>') + '</section>';
}

/** Le volet de droite : l'inspecteur d'objet (`µconsole valeur`), ou l'instance sélectionnée en onglets. */
function _dpRenderDetail(hote) {
  if (_dpObjet) {
    hote.innerHTML = '<button type="button" class="lien-retour" data-action="objet-fermer">← ' + µ._mjs_txt('dev.closeInspector', null, 'fermer l\'inspecteur d\'objet') + '</button><div class="onglet-corps"></div>';
    hote.querySelector('[data-action="objet-fermer"]').addEventListener('click', function() { _dpObjet = null; _dpRender(); });
    µ._mjs_diRender(hote.querySelector('.onglet-corps'), _dpObjet.valeur, { ns: _dpObjet.ns, titre: _dpObjet.titre });
    return;
  }
  if (_dpVue === 'stores') {
    var cles = µ.store ? Object.keys(µ.store) : [];
    hote.innerHTML = '<div class="di-entete">stores ($$) · ' + (cles.length > 1 ? µ._mjs_txt('dev.keysMany', { n: cles.length }, '{n} clés') : µ._mjs_txt('dev.keysOne', { n: cles.length }, '{n} clé')) + '</div><div class="onglet-corps"></div>';
    // copie PLATE des clés : lue par les accesseurs de `µ.store` (un store calculé arrive résolu),
    // les objets restent les références vivantes du store — l'écriture profonde les touche vraiment
    var vue = {};
    cles.forEach(function(k) { vue[k] = µ.store[k]; });
    µ._mjs_diRender(hote.querySelector('.onglet-corps'), vue, {
      ns: 'stores',
      triRacine: function(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
      onWriteRoot: function(k, v) { µ.store[k] = v; return true; },
      onWriteDeep: function(k) { µ._mjs_storeNotifyDeep(k); },
      regleRacine: function(k) { return _dpRegle(µ._mjs_storeRules, k); },
      videTexte: µ._mjs_txt('dev.noStore', null, 'aucun store')
    });
    return;
  }
  if (_dpVue === 'effets') {
    var tous = _dpFxListe(null);
    hote.innerHTML = '<div class="di-entete">effets (*) · ' + (tous.length > 1 ? µ._mjs_txt('dev.fxSetMany', { n: tous.length }, '{n} posés') : µ._mjs_txt('dev.fxSetOne', { n: tous.length }, '{n} posé')) + '</div><div class="onglet-corps"></div>';
    var corpsFx = hote.querySelector('.onglet-corps');
    corpsFx.innerHTML = tous.length ? _dpFxHtml(tous, true) : '<p class="vide">' + µ._mjs_txt('dev.noEffectPage', null, 'aucun effet dans la page') + '</p>';
    _dpFxBrancher(corpsFx);
    return;
  }
  var el = _dpSelected;
  if (!el || !el.isConnected) {
    hote.innerHTML = '<p class="aide">' + µ._mjs_txt('dev.pickComponent', null, 'Choisissez un composant à gauche.<br>Survolez une ligne pour le situer dans la page.') + '</p>';
    return;
  }
  var uid = _dpUid(el);
  hote.innerHTML =
    '<div class="di-entete">' + µ._esc(_dpName(el)) + ' · ' + ((el._mjs_renderCount || 0) > 1 ? µ._mjs_txt('dev.renderMany', { n: (el._mjs_renderCount || 0) }, '{n} rendus') : µ._mjs_txt('dev.renderOne', { n: (el._mjs_renderCount || 0) }, '{n} rendu')) + '</div>' +
    '<div class="onglets" role="tablist">' + _DP_ONGLETS().map(function(o) {
      return '<button type="button" class="onglet" role="tab" aria-selected="' + (o.id === _dpOnglet ? 'true' : 'false') + '" data-onglet="' + o.id + '">' + o.libelle + '</button>';
    }).join('') + '</div><div class="onglet-corps"></div>';

  hote.querySelectorAll('.onglet').forEach(function(b) {
    b.addEventListener('click', function() { _dpOnglet = b.getAttribute('data-onglet'); _dpRender(); });
  });

  var corps = hote.querySelector('.onglet-corps');
  if (_dpOnglet === 'derives') {
    var deps = el._mjs_computedDeps || {};
    var lignes = _dpDeriveKeys(el).map(function(k) {
      var d = deps[k] && deps[k].length ? '← ' + deps[k].map(function(x) { return '$' + x; }).join(', ') : '';
      return '<tr><td class="cle">$' + µ._esc(k) + '</td><td>' + µ._esc(_dpApercu(el._state[k])) + '</td><td class="deps">' + µ._esc(d) + '</td></tr>';
    }).join('');
    corps.innerHTML = '<section><h2>' + µ._mjs_txt('dev.derivedTitle', null, 'Dérivés et leurs dépendances') + '</h2>' + (lignes ? '<table>' + lignes + '</table>' : '<p class="vide">' + µ._mjs_txt('dev.noDerived', null, 'aucun dérivé') + '</p>') + '</section>';
  } else if (_dpOnglet === 'liaisons') {
    var lignesL = el._mjs_effectsByVar ? Object.keys(el._mjs_effectsByVar).sort().map(function(k) {
      return '<tr><td class="cle">$' + µ._esc(k) + '</td><td>' + (el._mjs_effectsByVar[k].length > 1 ? µ._mjs_txt('dev.bindingMany', { n: el._mjs_effectsByVar[k].length }, '{n} liaisons') : µ._mjs_txt('dev.bindingOne', { n: el._mjs_effectsByVar[k].length }, '{n} liaison')) + '</td></tr>';
    }).join('') : '';
    corps.innerHTML = '<section><h2>' + µ._mjs_txt('dev.bindingsTitle', null, 'Ce que chaque variable met à jour') + '</h2>' + (lignesL ? '<table>' + lignesL + '</table>' : '<p class="vide">' + µ._mjs_txt('dev.noBinding', null, 'aucune liaison') + '</p>') + '</section>';
  } else if (_dpOnglet === 'contexte') {
    // Deux moitiés, parce que ce sont deux questions différentes : « qu'est-ce que CE composant
    // met à disposition de sa descendance » (sa propre Map `_mjs_contexts`) et « qu'est-ce qu'il
    // REÇOIT, et de qui » (remontée `parentNode || host || getRootNode().host`, exactement le
    // chemin de `_mjs_getContext`, cf. mjs_element.ts). Sans la seconde, l'onglet reste vide sur
    // toute feuille de l'arbre — c'est-à-dire précisément là où on se demande d'où vient `§x`.
    corps.innerHTML = '<section><h2>' + µ._mjs_txt('dev.ctxSet', null, 'Posés ici') + '</h2><div class="ctx-poses"></div></section>' +
      '<section><h2>' + µ._mjs_txt('dev.ctxReceived', null, 'Reçus d\'un ancêtre') + '</h2><div class="ctx-recus"></div></section>';
    µ._mjs_diRender(corps.querySelector('.ctx-poses'), el._mjs_contexts || {}, { ns: 'ctx#' + uid, videTexte: µ._mjs_txt('dev.noCtxSet', null, 'aucun contexte posé par ce composant') });
    var recus = {}, vus = {}, courant = el.parentNode || el.host || (el.getRootNode && el.getRootNode().host);
    while (courant) {
      if (courant._mjs_contexts) courant._mjs_contexts.forEach(function(v, k) {
        // le PLUS PROCHE l'emporte, comme la résolution réelle : on ne réécrit jamais une clé déjà vue
        if (!vus[k]) { vus[k] = true; recus['§' + k + '  ← ' + _dpName(courant)] = v; }
      });
      courant = courant.parentNode || courant.host || (courant.getRootNode && courant.getRootNode().host);
    }
    µ._mjs_diRender(corps.querySelector('.ctx-recus'), recus, { ns: 'ctxr#' + uid, videTexte: µ._mjs_txt('dev.noCtxReceived', null, 'aucun contexte reçu') });
  } else if (_dpOnglet === 'props') {
    corps.innerHTML = _dpOngletProps(el);
  } else if (_dpOnglet === 'style') {
    corps.innerHTML = _dpOngletStyle(el);
  } else if (_dpOnglet === 'effets') {
    var siens = _dpFxListe(el);
    corps.innerHTML = siens.length ? _dpFxHtml(siens, false) : '<p class="vide">' + µ._mjs_txt('dev.noEffectComp', null, 'aucun effet posé par ce composant') + '</p>';
    _dpFxBrancher(corps);
  } else {
    var permis = new Set(_dpEtatKeys(el));
    µ._mjs_diRender(corps, el._state || {}, {
      ns: 'etat#' + uid,
      filtrerRacine: function(k) { return permis.has(k); },
      triRacine: function(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
      onWriteRoot: function(k, v) { el._set(k, v); return true; },
      regleRacine: function(k) { return _dpRegle(el._mjs_types, k); },
      videTexte: µ._mjs_txt('dev.noStateVar', null, 'aucune variable d\'état')
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
var _dpFxLignes = [];              // les effets du dernier rendu, dans l'ordre des blocs (`data-fx`)
var _dpFxCopie = null;             // le bouton « copier » qui vient de servir : { el, nom, mot, fin }
var _dpFxOrigine = new WeakMap();  // balise → { effet: ses réglages avant la première retouche }
var _DP_FX_ON = ['always', 'hover', 'click', 'view', 'load'];
var _DP_FX_KEY = /^[A-Za-z][\w-]*\s*:/;   // ce que la lecture des réglages prend pour le nom d'un réglage (`mot:`)

/** Les effets posés par `comp` (tous ceux de la page si `comp` est nul), balise par balise. */
function _dpFxListe(comp) {
  var vues = new Set(), liste = [];
  var fouiller = function(racine) {
    if (!racine || !racine.querySelectorAll) return;
    racine.querySelectorAll('[mjs-fx]').forEach(function(el) {
      if (vues.has(el)) return;
      vues.add(el);
      var offs = el._mjs_fxOff;
      if (!offs) return;
      Object.keys(offs).forEach(function(nom) {
        var off = offs[nom];
        if (!off || !off._s || (comp && off._c !== comp)) return;
        liste.push({ el: el, nom: nom, comp: off._c });
      });
    });
  };
  fouiller(document);
  µ.instances.forEach(function(inst) { if (inst.isConnected) fouiller(inst._shadow); });
  return liste;
}

/** Réglage principal et règles des réglages : le catalogue, ou la définition d'un effet CSS de l'appli. */
function _dpFxSpec(nom) {
  var cat = µ._mjs_fxCatalog && µ._mjs_fxCatalog[nom];
  if (cat) return cat;
  var def = µ._mjs_fxDefs && µ._mjs_fxDefs[nom];
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
function _dpFxBalise(el) {
  if (el === document.documentElement) return '<@document>';
  var id = el.id ? '#' + el.id : '';
  var cls = !id && el.classList && el.classList.length ? '.' + el.classList[0] : '';
  return '<' + (el.localName || el.tagName.toLowerCase()) + id + cls + '>';
}

function _dpFxTexte(v) {
  if (v === void 0 || v === null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** `*neon(#0ff, size: 2)` : l'effet tel qu'il s'écrit avec ses réglages courants ; la connexion d'un
 * effet en direct (`sock`) s'écrit par sa variable (`ecrit`, cf. µ._mjs_fx), jamais par sa valeur —
 * `@sock`, le défaut, ne s'écrit pas ; un effet donné en réglage (`fx: *scramble(20)`), par son écriture ; la ligne se recompile
 * telle quelle : une valeur qui ressemble à `mot:` (une adresse `wss://…`) s'écrit entre guillemets — et le réglage principal,
 * avec son nom —, une apostrophe passe en guillemets doubles, les clés internes `_…` (la variable que le compilateur donne
 * à *gauge et à *guard) ne s'écrivent pas */
function _dpFxCode(nom, s, spec, ecrit) {
  var quoted = function(v) { return v.indexOf("'") >= 0 ? '"' + v + '"' : "'" + v + "'"; };
  var val = function(v) {
    if (Array.isArray(v)) return '[' + v.map(val).join(', ') + ']';
    if (v && typeof v === 'object' && typeof v.fx === 'string') return _dpFxCode(v.fx, v.s || {}, _dpFxSpec(v.fx));
    // entre guillemets : ce qui couperait la liste des réglages, la ponctuation seule (`'.'`) et ce qui ressemble à `mot:` ;
    // doubles si la valeur porte une apostrophe — la lecture des réglages ne connaît pas `\'`
    if (typeof v === 'string' && (/[,()[\]'"]|^\s|\s$/.test(v) || !/[A-Za-z0-9]/.test(v) || _DP_FX_KEY.test(v))) return quoted(v);
    return String(v);
  };
  var connexion = function(k) { return !!(spec && spec.s[k] && spec.s[k][0][0] === 'v'); };
  var cles = Object.keys(s).filter(function(k) { return k.charAt(0) !== '_'; });
  if (ecrit) Object.keys(ecrit).forEach(function(k) { if (cles.indexOf(k) < 0) cles.push(k); });
  var texte = function(k) {
    if (ecrit && ecrit[k]) return ecrit[k];
    return connexion(k) || s[k] === void 0 ? null : val(s[k]);
  };
  var main = spec && spec.m, morceaux = [];
  // un principal qui commence comme un réglage (`mot:`) s'écrit avec son nom : sans lui, il serait lu comme le nom d'un autre réglage
  if (main && cles.indexOf(main) >= 0 && texte(main) !== null) morceaux.push((typeof s[main] === 'string' && !(ecrit && ecrit[main]) && _DP_FX_KEY.test(s[main]) ? main + ': ' : '') + texte(main));
  cles.forEach(function(k) { if (k !== main && texte(k) !== null) morceaux.push(k + ': ' + texte(k)); });
  return '*' + nom + (morceaux.length ? '(' + morceaux.join(', ') + ')' : '');
}

/** Le contrôle d'un réglage, selon sa règle : case, menu, nombre borné, ou texte (défaut en filigrane). */
function _dpFxChamp(cle, sp, v, dflt) {
  var attr = ' data-cle="' + µ._esc(cle) + '"';
  var aDflt = dflt !== null && dflt !== void 0;
  if (sp[0] === 'b') return '<input type="checkbox"' + attr + ((v === void 0 ? dflt === true : v === true) ? ' checked' : '') + '>';
  if (sp[0] === 'l') {
    var courant = v === void 0 ? dflt : v;
    return '<select' + attr + '>' + (v === void 0 && !aDflt ? '<option value="" selected>—</option>' : '') + sp[1].map(function(x) {
      return '<option value="' + µ._esc(String(x)) + '"' + (String(x) === String(courant) ? ' selected' : '') + '>' + µ._esc(String(x)) + '</option>';
    }).join('') + '</select>';
  }
  var ph = aDflt ? ' placeholder="' + µ._esc(_dpFxTexte(dflt)) + '"' : '';
  if (sp[0] === 'i' || sp[0] === 'f') {
    return '<input type="number"' + attr + (sp[1] !== null ? ' min="' + sp[1] + '"' : '') + (sp[2] !== null ? ' max="' + sp[2] + '"' : '') + ' step="' + (sp[0] === 'i' ? '1' : 'any') + '" value="' + µ._esc(_dpFxTexte(v)) + '"' + ph + '>';
  }
  return '<input type="text"' + attr + ' value="' + µ._esc(_dpFxTexte(v)) + '"' + ph + '>';
}

/** Les blocs des effets de `liste`, groupés par composant si `parComposant`. */
function _dpFxHtml(liste, parComposant) {
  if (parComposant) {
    var groupes = new Map();
    liste.forEach(function(l) { if (!groupes.has(l.comp)) groupes.set(l.comp, []); groupes.get(l.comp).push(l); });
    liste = [];
    groupes.forEach(function(g) { liste = liste.concat(g); });
  }
  _dpFxLignes = liste;
  var html = '', compPrec = null;
  liste.forEach(function(l, i) {
    if (parComposant && l.comp !== compPrec) { compPrec = l.comp; html += '<h2>' + µ._esc(compPrec ? _dpName(compPrec) : '?') + '</h2>'; }
    var spec = _dpFxSpec(l.nom);
    var s = l.el._mjs_fxOff[l.nom]._s || {};
    var ecrit = l.el._mjs_fxWritten && l.el._mjs_fxWritten[l.nom];
    var rangs = (spec ? Object.keys(spec.s) : Object.keys(s)).map(function(k) {
      var sp = spec ? spec.s[k][0] : ['x', ''];
      // la connexion d'un effet en direct : sa variable, montrée, pas réglable ici
      var champ = sp[0] === 'v' ? '<code class="fx-var">' + µ._esc(ecrit && ecrit[k] ? ecrit[k] : s.server ? '—' : '@sock') + '</code>' : _dpFxChamp(k, sp, s[k], spec ? spec.s[k][1] : null);
      return '<tr><td class="cle">' + µ._esc(k) + (spec && k === spec.m ? ' <span class="fx-principal">' + µ._mjs_txt('dev.fxMain', null, 'principal') + '</span>' : '') + '</td><td>' + champ + '</td><td class="fx-regle">' + µ._esc(String(sp[sp.length - 1] || '')) + '</td></tr>';
    }).join('');
    var retouche = (_dpFxOrigine.get(l.el) || {})[l.nom];
    var copie = _dpFxCopie && _dpFxCopie.el === l.el && _dpFxCopie.nom === l.nom && Date.now() < _dpFxCopie.fin ? _dpFxCopie.mot : µ._mjs_txt('dev.fxCopy', null, 'copier l\'écriture');
    html += '<div class="fx" data-fx="' + i + '"><div class="fx-tete"><span class="fx-balise">' + µ._esc(_dpFxBalise(l.el)) + '</span><span class="fx-nom">*' + µ._esc(l.nom) + '</span>' +
      '<button type="button" data-action="fx-copier">' + µ._esc(copie) + '</button>' +
      (retouche ? '<button type="button" data-action="fx-retablir">' + µ._mjs_txt('dev.fxRevert', null, 'rétablir') + '</button>' : '') + '</div>' +
      '<code class="fx-code">' + µ._esc(_dpFxCode(l.nom, s, spec, ecrit)) + '</code><table>' + rangs + '</table></div>';
  });
  return html;
}

/** Survol d'un bloc = la balise surlignée dans la page ; un réglage changé = l'effet réglé. */
function _dpFxBrancher(corps) {
  corps.querySelectorAll('.fx').forEach(function(bloc) {
    var ligne = _dpFxLignes[+bloc.getAttribute('data-fx')];
    if (!ligne) return;
    bloc.addEventListener('mouseenter', function() { _dpSurligner(ligne.el === document.documentElement ? null : ligne.el); });
    bloc.addEventListener('mouseleave', function() { _dpSurligner(null); });
    bloc.querySelectorAll('[data-cle]').forEach(function(champ) {
      champ.addEventListener('change', function() { _dpFxRegler(ligne, champ.getAttribute('data-cle'), champ); });
    });
    var retablir = bloc.querySelector('[data-action="fx-retablir"]');
    if (retablir) retablir.addEventListener('click', function() { _dpFxRetablir(ligne); });
    var copier = bloc.querySelector('[data-action="fx-copier"]');
    if (copier) copier.addEventListener('click', function() { _dpFxCopier(ligne, bloc.getAttribute('data-fx')); });
  });
}

/** La valeur d'un champ selon la règle de son réglage — vide : `undefined` (le défaut de l'effet). */
function _dpFxLire(champ, sp) {
  if (sp[0] === 'b') return champ.checked;
  var v = String(champ.value).trim();
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

function _dpFxRegler(ligne, cle, champ) {
  var off = ligne.el._mjs_fxOff && ligne.el._mjs_fxOff[ligne.nom];
  if (!off) return;
  var spec = _dpFxSpec(ligne.nom);
  var sp = spec && spec.s[cle] ? spec.s[cle][0] : ['x', ''];
  // les réglages d'avant la première retouche, pour « rétablir »
  var orig = _dpFxOrigine.get(ligne.el) || {};
  if (!orig[ligne.nom]) { orig[ligne.nom] = Object.assign({}, off._s); _dpFxOrigine.set(ligne.el, orig); }
  var d = {}, regles = {}, mark = _dpFocusMark();
  d[cle] = _dpFxLire(champ, sp);
  regles[cle] = sp;
  µ._mjs_fxSet(ligne.el, ligne.nom, d, regles);
  _dpRender();
  _dpFocusRestore(mark);
}

/** « copier l'écriture » : la ligne de code, avec les réglages essayés, dans le presse-papiers ;
 * refusé (page hors HTTPS, permission), la ligne est sélectionnée pour Ctrl+C. Le bouton le dit un instant. */
function _dpFxCopier(ligne, rang) {
  var code  = _dpRoot && _dpRoot.querySelector('.fx[data-fx="' + rang + '"] .fx-code');
  var texte = code ? code.textContent : '';
  var dire  = function(mot) {
    _dpFxCopie = { el: ligne.el, nom: ligne.nom, mot: mot, fin: Date.now() + 1500 };
    _dpRender();
    // la remise à zéro du bouton attend la fin d'une sélection de la ligne (le repli : Ctrl+C), qu'elle ne l'efface pas
    setTimeout(function() { if (_dpRoot && !_dpSelectionInCode()) _dpRender(); }, 1600);
  };
  var presse = navigator.clipboard && typeof navigator.clipboard.writeText === 'function' ? navigator.clipboard.writeText(texte) : Promise.reject(new Error('presse-papiers absent'));
  presse.then(function() { dire(µ._mjs_txt('dev.fxCopied', null, 'copié ✓')); }, function() {
    dire(µ._mjs_txt('dev.fxSelected', null, 'sélectionné : Ctrl+C'));
    var c   = _dpRoot && _dpRoot.querySelector('.fx[data-fx="' + rang + '"] .fx-code');
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!c || !sel) return;
    // `setBaseAndExtent` et non `addRange` : WebKit refuse un intervalle posé dans une ombre (la sélection reste vide)
    sel.removeAllRanges();
    sel.setBaseAndExtent(c, 0, c, c.childNodes.length);
  });
}

function _dpFxRetablir(ligne) {
  var orig = _dpFxOrigine.get(ligne.el);
  var avant = orig && orig[ligne.nom];
  var off = ligne.el._mjs_fxOff && ligne.el._mjs_fxOff[ligne.nom];
  if (!avant || !off) return;
  var spec = _dpFxSpec(ligne.nom), d = {}, regles = {}, cles = {};
  Object.keys(off._s).forEach(function(k) { cles[k] = true; });
  Object.keys(avant).forEach(function(k) { cles[k] = true; });
  Object.keys(cles).forEach(function(k) {
    d[k] = avant[k];
    if (spec && spec.s[k]) regles[k] = spec.s[k][0];
  });
  µ._mjs_fxSet(ligne.el, ligne.nom, d, regles);
  delete orig[ligne.nom];
  _dpRender();
}

// l'élément qui a le focus dans la page, en descendant dans les ombres : `document.activeElement` s'arrête à l'hôte d'un
// composant (son ombre est fermée — `_shadow`, `shadowRoot` l'ignore), et c'est le bouton à l'intérieur qui doit le retrouver
function _dpActiveDeep() {
  var a = document.activeElement;
  try {
    while (a) {
      var r = a._shadow || a.shadowRoot;
      if (!r || !r.activeElement) break;
      a = r.activeElement;
    }
  }
  catch { /* `activeElement` d'une racine d'ombre qui lève hors navigateur : on garde l'hôte */ }
  return a;
}

function _dpOuvrir() {
  _dpFocusPrecedent = _dpActiveDeep();
  _dpHost = document.createElement('div');
  _dpHost.setAttribute('data-mjs-devpanel', '');
  _dpRoot = _dpHost.attachShadow({ mode: 'open' });
  document.body.appendChild(_dpHost);
  _dpGeoRelire();   // relecture PARESSEUSE du stockage (jamais au chargement du module) — puis borne
  _dpGeoBorner();   // la fenêtre a pu changer de taille depuis la dernière lecture de `_dpGeo`
  _dpRender();
  var panneauEl = _dpRoot.querySelector('.panneau');
  if (panneauEl && panneauEl.focus) panneauEl.focus();
  document.addEventListener('keydown', _dpEchap);
  _dpRoot.addEventListener('pointerdown', _dpPointeurBas, true);
  ['pointerdown', 'keydown', 'input'].forEach(function(type) { _dpRoot.addEventListener(type, _dpFocusRestoredEnd, true); });
  document.addEventListener('pointerup', _dpPointeurHaut, true);
  document.addEventListener('pointercancel', _dpPointeurHaut, true);
  // rafraîchissement doux : le panneau doit refléter la page sans la ralentir
  _dpTimer = setInterval(_dpTick, 700);
}

function _dpFermer() {
  _dpViseeFin();
  clearInterval(_dpTimer); _dpTimer = null;
  _dpLibererEspace();   // la page retrouve son bas AVANT que le panneau ne disparaisse
  _dpGlissement = null;   // Échap ou fermeture programmatique en plein glissement : plus de pointerup à attendre
  document.removeEventListener('keydown', _dpEchap);
  document.removeEventListener('pointerup', _dpPointeurHaut, true);
  document.removeEventListener('pointercancel', _dpPointeurHaut, true);
  _dpPointeur = false;
  _dpSurligner(null);
  if (_dpHighlight) { _dpHighlight.remove(); _dpHighlight = null; }
  _dpHost.remove(); _dpHost = null; _dpRoot = null;
  _dpObjet = null;
  _dpFocusRestored = null;
  // `isConnected` : `document.contains` ne traverse pas l'ombre d'un composant, où le focus était peut-être
  if (_dpFocusPrecedent && _dpFocusPrecedent.focus && _dpFocusPrecedent.isConnected) _dpFocusPrecedent.focus();
  _dpFocusPrecedent = null;
}

// Échap : annule d'abord une visée « cibler » en cours, ferme le panneau sinon — venue du panneau
// seulement : une Échap de la page (une modale, un menu de l'appli) reste à l'application
function _dpEchap(e) {
  if (e.key !== 'Escape' && e.code !== 'Escape') return;
  if (!_dpVisee && !_dpDansLePanneau(e)) return;
  e.preventDefault();
  if (_dpVisee) { _dpViseeFin(); _dpRender(); return; }
  _dpBasculer(false);
}

// ------------------------------------------------------------------------------------------------
// « cibler » : le prochain clic dans la page désigne un composant — celui qui CONTIENT l'élément
// touché, frontières d'ombre franchies (`composedPath`, un shadow fermé s'arrête à son hôte, qui
// est justement le composant). Écoute en CAPTURE sur le document : le clic de visée est avalé
// avant d'atteindre la page, aucun bouton de l'application ne se déclenche. Un clic DANS le panneau
// n'est jamais une visée (le bouton « cibler » re-cliqué l'arrête, cf. la barre).
// ------------------------------------------------------------------------------------------------
var _dpVisee = false, _dpCurseurPrec = null;
var _DP_VISEE_AVALES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];

function _dpDansLePanneau(e) {
  var chemin = e.composedPath ? e.composedPath() : [];
  return chemin.indexOf(_dpHost) !== -1;
}

function _dpComposantTouche(e) {
  var chemin = e.composedPath ? e.composedPath() : [e.target];
  for (var i = 0; i < chemin.length; i++) {
    if (chemin[i] instanceof µ.Element) return chemin[i];
  }
  return null;
}

function _dpViseeBouger(e) {
  if (!_dpDansLePanneau(e)) _dpSurligner(_dpComposantTouche(e));
}

function _dpViseeAvaler(e) {
  if (_dpDansLePanneau(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
}

function _dpViseeClic(e) {
  if (_dpDansLePanneau(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  var composant = _dpComposantTouche(e);
  _dpViseeFin();
  if (composant) { _dpSelected = composant; _dpObjet = null; _dpVue = null; }
  _dpRender();
}

function _dpViseeDebut() {
  if (_dpVisee) return;
  _dpVisee = true;
  document.addEventListener('pointermove', _dpViseeBouger, true);
  _DP_VISEE_AVALES.forEach(function(type) { document.addEventListener(type, _dpViseeAvaler, true); });
  document.addEventListener('click', _dpViseeClic, true);
  var racine = document.documentElement;
  if (racine && racine.style) { _dpCurseurPrec = racine.style.cursor || ''; racine.style.cursor = 'crosshair'; }
}

function _dpViseeFin() {
  if (!_dpVisee) return;
  _dpVisee = false;
  document.removeEventListener('pointermove', _dpViseeBouger, true);
  _DP_VISEE_AVALES.forEach(function(type) { document.removeEventListener(type, _dpViseeAvaler, true); });
  document.removeEventListener('click', _dpViseeClic, true);
  var racine = document.documentElement;
  if (racine && racine.style && _dpCurseurPrec !== null) racine.style.cursor = _dpCurseurPrec;
  _dpCurseurPrec = null;
  _dpSurligner(null);
}

/** Le composant MJS qui porte `node` (lui-même compris), frontières d'ombre franchies. */
function _dpComposantDe(node) {
  while (node) {
    if (node instanceof µ.Element) return node;
    node = node.parentNode || node.host || null;
  }
  return null;
}

/**
 * Ouvre, ferme ou bascule le panneau — le seul endroit qui le fait. Sans argument : bascule (le
 * raccourci clavier) ; `true`/`false` : ouvre/ferme ; une chaîne : sélecteur CSS, cf. `_dpResoudre`
 * (descend `µ.instances`, déjà plat vis-à-vis des frontières Shadow DOM) ; un élément : son
 * composant. Rend l'état obtenu (`true` = ouvert).
 */
function _dpBasculer(arg) {
  _dpOublierDetache();
  if (typeof arg === 'string') {
    if (!_dpHost) _dpOuvrir();
    var cible = _dpResoudre(arg);
    if (cible) { _dpSelected = cible; _dpObjet = null; _dpVue = null; }
    _dpRender();
    return true;
  }
  if (arg && typeof arg === 'object' && arg.nodeType === 1) {
    if (!_dpHost) _dpOuvrir();
    var composant = _dpComposantDe(arg);
    if (composant) { _dpSelected = composant; _dpObjet = null; _dpVue = null; }
    _dpRender();
    return true;
  }
  var estOuvert = !!_dpHost;
  var vise = arg === undefined ? !estOuvert : !!arg;
  if (vise === estOuvert) return vise;
  if (!vise) { _dpFermer(); return false; }
  _dpOuvrir();
  return true;
}

/** L'inspecteur d'objets générique (mjs_devinspect) sur une valeur quelconque, dans le panneau. */
function _dpInspecter(valeur) {
  if (!_dpHost) _dpOuvrir();
  µ._mjs_diReset('objet');   // jamais l'état de pli d'un appel précédent sur une AUTRE valeur
  _dpObjet = { valeur: valeur, ns: 'objet', titre: µ._mjs_diApercu(valeur) };
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
µ.console = function(cible) {
  if (cible === undefined || cible === null) return _dpBasculer(true);
  if (typeof cible === 'boolean' || typeof cible === 'string') return _dpBasculer(cible);
  if (typeof cible === 'object' && cible.nodeType === 1) return _dpBasculer(cible);
  return _dpInspecter(cible);
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
        var appel = function(cible) { µ.console(cible); return _dpPhrase(); };
        appel.toString = _dpPhrase;
        return appel;
      }
    });
  } catch { /* propriété verrouillée par la page : Ctrl+Shift+Espace reste disponible */ }
}

document.addEventListener('keydown', function(e) {
  var touche = (µ.config && µ.config.devPanelKey) || 'Space';
  if (e.ctrlKey && e.shiftKey && e.code === touche) {
    e.preventDefault();
    _dpBasculer();
  }
});

if (µ.debug) console.log('🔍 ' + µ._mjs_msg('dev.panelArmed', null, 'panneau d\'inspection armé — Ctrl+Shift+Espace, ou µconsole'));
