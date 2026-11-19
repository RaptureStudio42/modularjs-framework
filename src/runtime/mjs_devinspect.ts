// mjs_devinspect — l'inspecteur d'objets, générique, dans la page, en développement.
//
// N'EST PAS DANS LE BUNDLE DE PRODUCTION : même règle que mjs_debug/mjs_devpanel (cf.
// bundler/index.ts). Chargé JUSTE AVANT mjs_devpanel, qui s'en sert pour ses onglets État et
// Contexte (une valeur composée y devient cliquable et se déplie ICI, avec le même moteur) et
// pour `µconsole valeur`. Ce fichier ne connaît RIEN du panneau ni de la modale : donné un hôte
// DOM et une valeur, il affiche, déplie, et édite — n'importe où on le monte.
//
// Ce qu'il fait : une arborescence dépliable de N'IMPORTE QUELLE valeur JS — objet, tableau,
// Map, Set, classe utilisateur, nœud DOM… — avec édition RÉELLE des scalaires en place. Sur un
// objet réactif MJS, une mutation imbriquée suffit à re-rendre toute seule (filet `_mjs_wrapDeep`,
// mjs_element.ts) : on écrit donc TOUJOURS par affectation directe sur la RÉFÉRENCE vivante
// (jamais un clone), sauf le cas racine `_state` d'un composant, réglé par `onWriteRoot`
// (mjs_devpanel.ts y route vers `el._set`, seul chemin qui déclenche computeds/limits/etc).
//
// État de dépliage — choix retenu : mémorisé PAR NAMESPACE (`_diOpened`, un Set de chemins par
// `ns`) et RÉTABLI à chaque redessin, plutôt que de suspendre le rafraîchissement automatique du
// panneau (700 ms). Suspendre aurait figé l'affichage — donc menti — pendant qu'on inspecte
// justement CE qui bouge ; mémoriser garde les données fraîches ET l'arbre ouvert où on l'a
// laissé. Portée du test : `tests/devpanel.test.ts`.

var _diOpened = new Map();

// le Set des chemins ouverts pour un namespace donné (une valeur/onglet/composant) — créé au
// premier accès, survit à tous les redessins tant que le namespace n'est pas explicitement remis
// à zéro (µ._mjs_diReset, utilisé par `µconsole valeur` pour ne jamais hériter du pli d'un appel précédent)
function _diSetOpened(ns) {
  var s = _diOpened.get(ns);
  if (!s) { s = new Set(); _diOpened.set(ns, s); }
  return s;
}

µ._mjs_diReset = function(ns) { _diOpened.delete(ns); };

// plafond d'affichage par NIVEAU (pas au total) — au-delà, une ligne dit combien restent plutôt
// que de geler l'onglet sur un tableau ou un objet énorme
var _DI_MAX = 200;

/** Étiquette de type courte, sans jamais remonter sur la chaîne de prototypes. */
function _mjs_diKind(v) {
  if (v === null) return 'null';
  var t = typeof v;
  if (t === 'undefined' || t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol' || t === 'function') return t;
  if (v instanceof Node) return 'node';   // couvre aussi une instance µ.Element (HTMLElement < Node)
  if (v instanceof Date) return 'date';
  if (v instanceof RegExp) return 'regexp';
  if (v instanceof Error) return 'error';
  if (v instanceof Promise) return 'promise';
  if (v instanceof Map) return 'map';
  if (v instanceof Set) return 'set';
  // ArrayBuffer.isView ne traverse pas un proxy réactif (contrairement à instanceof) : test sur
  // la valeur brute, sinon une vue lue depuis un store ou un état passe pour un objet ordinaire
  if (ArrayBuffer.isView(µ._mjs_toRaw ? µ._mjs_toRaw(v) : v)) return 'typedarray';
  if (Array.isArray(v)) return 'array';
  return 'object';
}
µ._mjs_diKind = _mjs_diKind;

/** Conteneurs qui se déplient ; tout le reste est une feuille (aperçu seul, jamais un déballage infini). */
function _diExpandable(kind) {
  return kind === 'object' || kind === 'array' || kind === 'map' || kind === 'set' || kind === 'typedarray';
}

/** Les seuls types qu'on modifie sur place — exactement la liste demandée : chaîne, nombre, booléen, null. */
function _diEditable(kind) {
  return kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'null';
}

/** Valeur lisible et courte pour une ligne. */
function _mjs_diPreview(v, kind) {
  kind = kind || _mjs_diKind(v);
  switch (kind) {
    case 'null': return 'null';
    case 'undefined': return 'undefined';
    case 'string': return JSON.stringify(v.length > 120 ? v.slice(0, 117) + '…' : v);
    case 'bigint': return String(v) + 'n';
    case 'number': case 'boolean': return String(v);
    case 'symbol': return String(v);
    case 'function': return 'ƒ ' + (v.name || '(anonyme)') + '()';
    case 'node': return '<' + (v.tagName ? v.tagName.toLowerCase() : µ._mjs_txt('dev.inspNode', null, 'nœud')) + '>';
    case 'date': { try { return v.toISOString(); } catch { return 'Date invalide'; } }
    case 'regexp': return v.toString();
    case 'error': return (v.name || 'Error') + ': ' + (v.message || '');
    case 'promise': return 'Promise';
    case 'map': return 'Map(' + v.size + ')';
    case 'set': return 'Set(' + v.size + ')';
    case 'typedarray': {
      // `v.constructor` lu à travers un proxy réactif rend TOUJOURS `undefined` (garde
      // anti-pollution CWE-1321, voulue — cf. cas `default` juste en dessous, même contournement) :
      // nom lu via le PROTOTYPE de la cible BRUTE, jamais par le get trap.
      var rawTA = µ._mjs_toRaw(v);
      var protoTA = rawTA ? Object.getPrototypeOf(rawTA) : null;
      var taName = protoTA && protoTA.constructor && protoTA.constructor.name;
      return (taName || 'TypedArray') + '(' + v.length + ')';
    }
    case 'array': return 'Array(' + v.length + ')';
    default: {
      // `v.constructor` lu à travers un proxy réactif (valeur rangée dans un store/état)
      // rend TOUJOURS `undefined` : la garde anti-pollution de prototype (CWE-1321) bloque
      // `constructor` HÉRITÉ, à raison — ce n'est PAS à rouvrir ici. `Object.getPrototypeOf`
      // sur la cible BRUTE (µ._mjs_toRaw déballe un éventuel proxy) contourne juste l'AFFICHAGE,
      // sans jamais passer par le get trap : une instance de classe garde son nom visible
      // (« Objet Vehicule »), pas juste « Objet ».
      var raw = µ._mjs_toRaw(v);
      var proto = raw ? Object.getPrototypeOf(raw) : null;
      var className = proto && proto.constructor && proto.constructor.name;
      return µ._mjs_txt('dev.inspObject', null, 'Objet') + (className && className !== 'Object' ? ' ' + className : '');
    }
  }
}
µ._mjs_diPreview = _mjs_diPreview;

// entrées PROPRES seulement (jamais le prototype) : Object.keys + clés symboliques énumérables.
// un accesseur qui explose est capturé (okGet false) et affiché comme un échec, pas relancé.
// seules les `max` premières valeurs sont lues ; le reste se compte par le nombre de clés, sans lecture
function _diObjectEntries(v, max) {
  var keys = [], syms = [];
  try {
    keys = Object.keys(v);
    syms = Object.getOwnPropertySymbols(v).filter(function(s) {
      var d = Object.getOwnPropertyDescriptor(v, s);
      return d && d.enumerable;
    });
  } catch { /* ownKeys/getOwnPropertySymbols en échec (proxy exotique) : liste vide, pas de crash */ }
  var all = keys.concat(syms), out = [];
  for (var i = 0; i < all.length && i < max; i++) {
    var c = all[i], val, ok = true, err;
    try { val = v[c]; } catch (e) { ok = false; err = (e && e.message) || String(e); }
    out.push({
      key: c,
      pathSeg: typeof c === 'symbol' ? '@sym' + i : String(c),
      label: typeof c === 'symbol' ? '[' + String(c) + ']' : String(c),
      value: val, okGet: ok, errMsg: err
    });
  }
  return { entries: out, remaining: all.length - out.length };
}

/** Les entrées d'un conteneur, plafonnées à `_DI_MAX`, avec le compte de ce qui reste — compté par la taille,
 *  sans parcourir le reste (le panneau redessine toutes les 700 ms). */
function _diEntries(container, kind) {
  var out = [];
  if (kind === 'map' || kind === 'set') {
    var i = 0;
    for (var e of container.entries()) {
      if (i === _DI_MAX) break;
      out.push(kind === 'map'
        ? { key: e[0], pathSeg: '#' + i, label: _mjs_diPreview(e[0], _mjs_diKind(e[0])), value: e[1], okGet: true }
        : { key: i, pathSeg: '#' + i, label: String(i), value: e[1], okGet: true });
      i++;
    }
    return { entries: out, remaining: container.size - out.length };
  }
  if (kind === 'array' || kind === 'typedarray') {
    var len = container.length || 0;
    for (var k = 0; k < len && k < _DI_MAX; k++) {
      out.push({ key: k, pathSeg: String(k), label: String(k), value: container[k], okGet: true });
    }
    return { entries: out, remaining: len - out.length };
  }
  return _diObjectEntries(container, _DI_MAX);
}

/** Écrit `valeur` à la clé `cle` d'un conteneur — Map/Set/objet-tableau ont chacun leur geste natif. */
function _diSet(container, kind, key, value) {
  if (kind === 'map') { container.set(key, value); return; }
  if (kind === 'set') return;   // pas de notion de clé sur un Set : édition en place non proposée
  container[key] = value;      // objet, tableau, tableau typé — affectation directe sur la RÉFÉRENCE vivante
}

var _DI_CSS = `
.di-title { font-weight: 700; color: #6ea8fe; margin-bottom: .4rem; }
.di-tree { display: flex; flex-direction: column; }
.di-line { display: flex; align-items: center; gap: .35rem; padding: .08rem 0; white-space: nowrap; }
.di-chevron { font: inherit; background: none; border: 0; color: #8b949e; cursor: pointer; width: 1.1em; padding: 0; }
.di-spacer { display: inline-block; width: 1.1em; flex: none; }
.di-key { color: #7ee787; }
.di-type { color: #8b949e; font-size: .85em; }
.di-rule { color: #d2a8ff; font-size: .85em; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.di-preview { color: #e6edf3; overflow: hidden; text-overflow: ellipsis; }
.di-circular { color: #f0883e; }
.di-failed { color: #f85149; }
.di-rest { opacity: .6; padding-left: 1.5rem; font-style: italic; }
.di-value { font: inherit; background: #161b22; color: inherit; border: 1px solid #30363d; border-radius: 4px; padding: 0 .3rem; max-width: 220px; }
.di-check { width: 1em; height: 1em; }
.di-empty { opacity: .5; }
`;

/**
 * Monte l'inspecteur dans `host` (n'importe quel élément DOM) sur `value`. `options` :
 * `title` (bandeau facultatif) · `ns` (namespace du pli, par défaut 'root') ·
 * `onWriteRoot(key, v)` (intercepte l'écriture d'une clé de PREMIER NIVEAU ; retourne `true` si
 * elle a géré l'écriture — sinon repli sur l'affectation directe) · `onWriteDeep(rootKey)`
 * (appelée APRÈS une écriture plus profonde, avec la clé de premier niveau d'où elle descend :
 * sert à prévenir quand la valeur n'a pas de filet réactif, un store) · `filterRoot(cle)` /
 * `sortRoot(a, b)` (ne s'appliquent qu'au premier niveau — un objet niché montre tout, brut) ·
 * `ruleRoot(cle)` (texte de la règle d'une clé de premier niveau, affiché après sa valeur ;
 * `undefined` : rien) · `emptyText` (message quand il n'y a rien à montrer).
 */
µ._mjs_diRender = function(host, value, options) {
  options = options || {};
  var ns = options.ns || 'root';
  var title = options.title;
  var onWriteRoot = options.onWriteRoot;
  var onWriteDeep = options.onWriteDeep;
  var filterRoot = options.filterRoot;
  var sortRoot = options.sortRoot;
  var ruleRoot = options.ruleRoot;
  var emptyText = options.emptyText || µ._mjs_txt('dev.inspNoValue', null, 'aucune valeur');
  var open = _diSetOpened(ns);
  var regs;   // reconstruit à CHAQUE redessin — les fermetures d'un ancien passage ne doivent pas survivre

  function path(parentPathSegs, seg) {
    return ns + JSON.stringify(parentPathSegs.concat([seg]));
  }

  // `racine` : la clé de PREMIER NIVEAU d'où descend ce conteneur — c'est elle qu'`onWriteDeep`
  // reçoit après une écriture profonde (un store se prévient par sa clé racine)
  function renderEntries(container, kind, parentPathSegs, ancestors, depth, filter, sort, root) {
    var res = _diEntries(container, kind);
    var list = res.entries;
    if (depth === 0 && filter) list = list.filter(function(e) { return filter(e.key); });
    if (depth === 0 && sort) list = list.slice().sort(function(a, b) { return sort(a.key, b.key); });
    var html = list.map(function(e) { return renderLine(e, container, kind, parentPathSegs, ancestors, depth, depth === 0 ? e.key : root); }).join('');
    if (res.remaining > 0) html += '<div class="di-rest">… ' + µ._mjs_txt('dev.inspMore', { n: res.remaining, max: _DI_MAX }, 'et {n} de plus (affichage plafonné à {max})') + '</div>';
    return html;
  }

  function renderLine(e, parentContainer, kindParent, parentPathSegs, ancestors, depth, root) {
    var indent = 'style="padding-left:' + (0.5 + depth * 1.1) + 'rem"';
    if (!e.okGet) {
      return '<div class="di-line" ' + indent + '><span class="di-spacer"></span><span class="di-key">' + µ._esc(e.label) +
        '</span><span class="di-type">' + µ._mjs_txt('dev.inspAccessor', null, 'accesseur') + '</span><span class="di-preview di-failed">⚠ ' + µ._mjs_txt('dev.inspFailed', null, 'échec :') + ' ' + µ._esc(e.errMsg) + '</span></div>';
    }
    var chem = path(parentPathSegs, e.pathSeg);
    var vkind = _mjs_diKind(e.value);
    var isObject = e.value !== null && typeof e.value === 'object';
    var circular = _diExpandable(vkind) && isObject && ancestors.indexOf(e.value) !== -1;
    var expandable = _diExpandable(vkind) && !circular;
    var isOpen = expandable && open.has(chem);
    var chevron;
    if (expandable) {
      var idxC = regs.push({ type: 'toggle', path: chem }) - 1;
      chevron = '<button type="button" class="di-chevron" data-di-idx="' + idxC + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' + (isOpen ? '▾' : '▸') + '</button>';
    } else {
      chevron = '<span class="di-spacer" aria-hidden="true"></span>';
    }
    var preview;
    var editable = !expandable && kindParent !== 'set' && _diEditable(vkind);
    if (circular) {
      preview = '<span class="di-preview di-circular">↺ ' + µ._mjs_txt('dev.inspCircular', null, 'référence circulaire') + '</span>';
    } else if (editable && vkind === 'boolean') {
      var idxB = regs.push({ type: 'checkbox', container: parentContainer, kind: kindParent, key: e.key, isRoot: depth === 0, root: root }) - 1;
      preview = '<input type="checkbox" class="di-check" data-di-idx="' + idxB + '"' + (e.value ? ' checked' : '') + '>';
    } else if (editable) {
      var idxI = regs.push({ type: 'input', container: parentContainer, kind: kindParent, key: e.key, valType: vkind, isRoot: depth === 0, root: root }) - 1;
      var val = e.value === null ? '' : String(e.value);
      preview = '<input type="text" class="di-value" data-di-idx="' + idxI + '" data-di-key="' + µ._esc(e.label) + '" value="' + µ._esc(val) + '">';
    } else {
      preview = '<span class="di-preview">' + µ._esc(_mjs_diPreview(e.value, vkind)) + '</span>';
    }
    // la règle d'une variable typée (bloc <vars>) suit sa valeur : `volume  number  50  · int 0..100`
    var rule = depth === 0 && typeof ruleRoot === 'function' ? ruleRoot(e.key) : void 0;
    if (rule) preview += '<span class="di-rule" title="' + µ._esc(rule) + '">· ' + µ._esc(rule) + '</span>';
    var line = '<div class="di-line" ' + indent + '>' + chevron + '<span class="di-key">' + µ._esc(e.label) +
      '</span><span class="di-type">' + vkind + '</span>' + preview + '</div>';
    if (isOpen) {
      var segs = parentPathSegs.concat([e.pathSeg]);
      line += '<div class="di-children">' + renderEntries(e.value, vkind, segs, ancestors.concat([e.value]), depth + 1, null, null, root) + '</div>';
    }
    return line;
  }

  function wire() {
    host.querySelectorAll('[data-di-idx]').forEach(function(el) {
      var reg = regs[+el.getAttribute('data-di-idx')];
      if (!reg) return;
      if (reg.type === 'toggle') {
        el.addEventListener('click', function() {
          if (open.has(reg.path)) open.delete(reg.path); else open.add(reg.path);
          draw();
        });
        return;
      }
      el.addEventListener('change', function() {
        var v;
        if (reg.type === 'checkbox') v = el.checked;
        else if (reg.valType === 'number') v = Number(el.value);
        else if (reg.valType === 'null') v = el.value === '' ? null : el.value;
        else v = el.value;
        if (reg.isRoot && typeof onWriteRoot === 'function' && onWriteRoot(reg.key, v)) { draw(); return; }
        _diSet(reg.container, reg.kind, reg.key, v);
        // valeur SANS filet réactif (un store : objets bruts, cf. mjs_store_globals) — l'écriture
        // directe ne prévient personne, l'hôte le fait par la clé racine
        if (!reg.isRoot && typeof onWriteDeep === 'function') onWriteDeep(reg.root);
        draw();
      });
    });
  }

  function draw() {
    regs = [];
    var kind = _mjs_diKind(value);
    var body;
    if (!_diExpandable(kind)) {
      // racine scalaire (ex. `µconsole 42`) : rien à quoi rattacher une écriture, lecture seule
      body = '<div class="di-tree"><div class="di-line"><span class="di-spacer"></span><span class="di-type">' + kind +
        '</span><span class="di-preview">' + µ._esc(_mjs_diPreview(value, kind)) + '</span></div></div>';
    } else {
      var html = renderEntries(value, kind, [], [value], 0, filterRoot, sortRoot, undefined);
      body = '<div class="di-tree">' + (html || '<p class="di-empty">' + µ._esc(emptyText) + '</p>') + '</div>';
    }
    host.innerHTML = µ._mjs_th('<style>' + _DI_CSS + '</style>' + (title ? '<div class="di-title">' + µ._esc(title) + '</div>' : '') + body);
    wire();
  }

  draw();
};

if (µ.debug) console.log('🔬 ' + µ._mjs_msg('dev.inspectArmed', null, 'inspecteur d\'objets armé — µconsole(valeur), ou depuis le panneau (Ctrl+Shift+Espace)'));
