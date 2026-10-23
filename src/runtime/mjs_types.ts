// mjs_types — types et valeurs permises, contrôlés à chaque écriture. Les règles viennent du bloc
// <vars> d'un composant (compilé par transpiler/var-types.ts en objets courts, cf. son bandeau) :
// `_mjs_types` sur l'instance pour ses variables et ses props, `µ._mjs_storeTypes({...})` au
// chargement du module pour les stores `$$x`. Détaché du cœur : seul un projet qui écrit un <vars>
// l'embarque (bundler/features.ts, clé `types`) ; le cœur n'appelle ces fonctions que derrière
// une règle posée, jamais sinon.
//
// Une valeur passe telle quelle, est CONVERTIE (texte d'un nombre, nombre à virgule dans un int —
// arrondi au plus près —, nombre écrit dans un string), est RAMENÉE dans sa plage, ou est REFUSÉE :
// l'écriture n'a pas lieu, la valeur d'avant reste. Une conversion est silencieuse ; une valeur
// ramenée ou refusée prévient en développement (`µ._typesMode`, posé par le manifeste : 'warn'
// = avertissement, 'error' = erreur qui arrête l'écriture) et se tait en production. Nom SANS
// `_mjs_` : le manifeste n'est pas raccourci avec le cœur, comme `µ._logLevel`.
//
// Listes et objets : chaque élément, chaque champ passe sa règle ; une conversion s'écrit SUR PLACE
// dans l'objet reçu (comme le bornage de l'ancien µminmax), mais seulement après un premier passage
// en lecture seule qui a tout accepté — un objet refusé n'est jamais modifié à moitié. Chaque liste
// et chaque objet contrôlés sont inscrits au registre de leur propriétaire (`el._mjs_treg`, ou
// `µ._mjs_storeTreg` pour les stores) avec leur règle : une écriture plus profonde (`$x.a = v`,
// `$x[cle] = v`, liaison d'un champ, fonction qui reçoit l'objet) retrouve ainsi la règle de son
// conteneur, à l'endroit même de l'écriture. En développement, chaque conteneur inscrit garde aussi
// celui qui le porte, par une référence faible (un élément gardé hors de sa liste ne retient pas la
// liste), avec sa clé ou sa position : le chemin que nomme un message (`$messages[4].id`) se calcule
// au moment du message seulement, par ces liens — une écriture valide n'en calcule aucun, et une liste
// qui bouge (unshift, shift, splice, sort, reverse) n'a aucun élément à renuméroter. La remontée est
// bornée : des liens qui bouclent (un champ typé qui pointe vers son parent), ou une chaîne de plus de
// 1000 conteneurs, ramènent au chemin où le conteneur a été inscrit ; un élément qui n'est plus dans sa
// liste se nomme à sa dernière position connue, suivie d'un point d'interrogation (`$choisies[0?].id`).
// Le registre tient aussi, par une référence faible, la valeur d'à présent de chaque racine (`$x`, `$$x`) :
// un chemin dont le sommet n'est plus cette valeur (liste remplacée), ou dont un parent a disparu
// (ramassé), n'est plus vérifiable — chacune de ses positions de liste est alors marquée de même, et le
// texte d'un message ne dépend pas du ramasse-miettes.

// refus : rendu à la place d'une valeur, jamais une valeur possible
µ._mjs_TNO = Object.freeze({});

var _mjsTHas = Object.prototype.hasOwnProperty;

// statuts : 0 = telle quelle, 1 = convertie, 2 = ramenée dans sa plage, -1 = refusée
function _mjsTNum(r, v) {
  var s = 0;
  if (typeof v === 'string') {
    var t = v.trim();
    if (t === '' || !isFinite(t)) return [-1, v];
    v = +t;
    s = 1;
  }
  if (typeof v !== 'number' || !isFinite(v)) return [-1, v];
  if (r.t === 'i' && v % 1 !== 0) { v = Math.round(v); s = 1; }
  if (r.a !== void 0 && v < r.a) return [2, r.a];
  if (r.b !== void 0 && v > r.b) return [2, r.b];
  return [s, v];
}

// longueur en caractères : une paire de substitution (émoji) compte pour un
function _mjsTLen(v) {
  var n = v.length;
  for (var i = 0; i < v.length; i++) {
    var c = v.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) n--;
  }
  return n;
}

function _mjsTStr(r, v) {
  var s = 0;
  if ((typeof v === 'number' && isFinite(v)) || typeof v === 'boolean') { v = String(v); s = 1; }
  if (typeof v !== 'string') return [-1, v];
  if (r.a !== void 0 || r.b !== void 0) {
    var n = _mjsTLen(v);
    if ((r.a !== void 0 && n < r.a) || (r.b !== void 0 && n > r.b)) return [-1, v];
  }
  if (r.r !== void 0) {
    r.r.lastIndex = 0;
    if (!r.r.test(v)) return [-1, v];
  }
  return [s, v];
}

// valeurs permises : exactes, ou converties vers l'une d'elles (texte d'un nombre, nombre en texte)
function _mjsTLit(r, v) {
  var l = r.v, i;
  for (i = 0; i < l.length; i++) if (l[i] === v) return [0, v];
  if (typeof v === 'string') {
    var t = v.trim();
    for (i = 0; i < l.length; i++) {
      if (typeof l[i] === 'number' && t !== '' && +t === l[i]) return [1, l[i]];
      if (typeof l[i] === 'boolean' && t === String(l[i])) return [1, l[i]];
    }
  }
  else if (typeof v === 'number' || typeof v === 'boolean') {
    for (i = 0; i < l.length; i++) if (l[i] === String(v)) return [1, l[i]];
  }
  return [-1, v];
}

function _mjsTBanned(n, v) {
  for (var i = 0; i < n.length; i++) {
    var b = n[i];
    if (b !== null && typeof b === 'object') {
      if (typeof v === 'number' && (b.a === void 0 || v >= b.a) && (b.b === void 0 || v <= b.b)) return true;
    }
    else if (b === v) return true;
  }
  return false;
}

function _mjsTKey(p, k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? p + '.' + k : p + "['" + String(k).replace(/'/g, "\\'") + "']";
}

// développement : `µ._typesMode` vaut 'warn' ou 'error' — les messages partent, et les chemins d'à présent
// se calculent pour eux
function _mjsTDev() {
  var mode = µ._typesMode;
  return mode === 'warn' || mode === 'error';
}

// une référence faible quand l'environnement en a, forte sinon
function _mjsTWeak(o) {
  return typeof WeakRef === 'function' ? new WeakRef(o) : { deref: function() { return o; } };
}

// inscription d'un conteneur au registre : sa règle et son chemin d'inscription ; en développement, aussi
// le conteneur qui le porte (`up`, gardé par une référence faible : un élément gardé hors de sa liste ne
// retient pas la liste) et sa clé ou sa position dans celui-ci (`at`). La production n'écrit aucun
// message : elle ne garde aucun lien
function _mjsTEntry(r, p, up, at) {
  if (up !== void 0 && _mjsTDev()) return { r: r, p: p, up: _mjsTWeak(up), at: at };
  return { r: r, p: p };
}

// le conteneur qui porte l'inscrit `e`, ou rien (racine, production, conteneur ramassé)
function _mjsTUp(e) {
  return e.up === void 0 ? void 0 : e.up.deref();
}

// ce qu'ajoute au chemin d'un conteneur la clé d'un champ, ou la position d'un élément de liste (`inList`)
function _mjsTSeg(inList, at) {
  return inList ? '[' + at + ']' : _mjsTKey('', at);
}

// la clé ou la position que nomme un chemin pour `v` (inscrit en `c`) dans son conteneur `o`. Dans une
// liste, la position inscrite n'est qu'un indice : un élément déplacé depuis se retrouve (et la position
// trouvée est retenue) ; un élément qui n'y est plus garde sa dernière position connue, suivie d'un point
// d'interrogation, jamais une position qu'il n'a plus
function _mjsTStep(c, v, inList, o) {
  var at = c.at;
  if (!inList) return _mjsTSeg(false, at);
  var mark = '';
  if (o[at] !== v) {
    var i = o.indexOf(v);
    if (i >= 0) c.at = at = i;
    else mark = '?';
  }
  return '[' + at + mark + ']';
}

// le plafond de la remontée d'un chemin, en conteneurs : une chaîne plus profonde ne se remonte pas jusqu'au
// bout (un lien qui boucle malgré la garde de revisite ne la ferait pas finir) ; en deçà, le chemin est entier
var _MJS_T_DEPTH = 1000;

// `v`, inscrit en `e` sans conteneur au-dessus, est-il la valeur d'à présent de la racine que nomme son
// chemin (`$x`, `$$x`) ? Le registre la tient pour chaque racine écrite en développement
function _mjsTCurrent(reg, e, v) {
  var roots = reg._mjs_roots;
  var w     = roots === void 0 ? void 0 : roots[e.p];
  return w !== void 0 && w.deref() === v;
}

// la valeur d'à présent d'une racine, tenue faiblement : c'est la variable ou le store qui la retient, pas le
// registre. La production n'en tient aucune : elle ne nomme rien
function _mjsTRoot(reg, p, v) {
  if (!_mjsTDev()) return;
  (reg._mjs_roots || (reg._mjs_roots = {}))[p] = v !== null && typeof v === 'object' ? _mjsTWeak(v) : void 0;
}

// un chemin dont le sommet n'est pas vérifiable : chaque position de liste qu'il nomme est la dernière connue,
// donc marquée. Une clé entre guillemets (`['a-b']`) passe telle quelle
function _mjsTDoubt(p) {
  return p.replace(/\['(?:[^'\\]|\\.)*'\]|\[(\d+)\]/g, function(m, n) { return n === void 0 ? m : '[' + n + '?]'; });
}

// chemin d'un conteneur inscrit, tel qu'un message le nomme : celui de son parent, puis sa clé (champ) ou
// sa position (liste). Calculé au moment du message, jamais à l'écriture. La remontée s'arrête à la racine,
// à un parent qui n'est plus là (ramassé, ou non inscrit), à un lien qui boucle (un conteneur déjà
// rencontré : un champ typé qui pointe vers son parent) ou au plafond de profondeur — elle rend alors, comme
// sans lien (production), le chemin où le conteneur a été inscrit. Un sommet qui n'est pas la valeur
// d'à présent de sa racine (liste remplacée), ou un parent disparu, rend le chemin en marquant chaque
// position de liste : il n'est plus vérifiable
function _mjsTPath(reg, e, v) {
  if (e.up === void 0) return e.p;
  var es = [e];
  var vs = [v];
  var up, pe;
  for (;;) {
    up = _mjsTUp(es[es.length - 1]);
    pe = up === void 0 ? void 0 : reg.get(up);
    if (pe === void 0) break;
    if (es.length >= _MJS_T_DEPTH) return e.p;
    if (vs.indexOf(up) >= 0) return e.p;
    es.push(pe);
    vs.push(up);
  }
  var top = es[es.length - 1];
  var p   = top.p;
  for (var k = es.length - 2; k >= 0; k--) p += _mjsTStep(es[k], vs[k], es[k + 1].r.t === 'a', vs[k + 1]);
  return top.up === void 0 && _mjsTCurrent(reg, top, vs[vs.length - 1]) ? p : _mjsTDoubt(p);
}

// la note d'un contrôle (`note.refus`, `note.borne`) avec le chemin d'à présent de la valeur contrôlée : les
// chemins que le contrôle note sont relatifs à cette valeur, et le sien ne se calcule qu'ici, au moment d'un
// message — celui de son conteneur `up` puis sa clé ou sa position `at`, ou `p` (le chemin d'inscription)
// pour une variable ou un store. La production ne nomme rien : rien ne se calcule
function _mjsTWhere(n, reg, p, up, at) {
  if (n === void 0 || !_mjsTDev()) return n;
  var pe = up === void 0 ? void 0 : reg.get(up);
  n.p    = (pe === void 0 ? p : _mjsTPath(reg, pe, up) + _mjsTSeg(pe.r.t === 'a', at)) + n.p;
  return n;
}

// idem pour une liste `o` (inscrite en `e`) dont une méthode a été appelée : les chemins notés sont
// relatifs à la liste
function _mjsTWhereList(n, reg, e, o) {
  if (n !== void 0 && _mjsTDev()) n.p = _mjsTPath(reg, e, o) + n.p;
  return n;
}

// `up`, `at` : le conteneur qui porte le contrôlé, et sa clé ou sa position dans celui-ci (pour l'inscrire)
function _mjsTArr(r, v, w, note, p, up, at) {
  v = µ._mjs_toRaw(v);
  if (!Array.isArray(v)) return [-1, v];
  if ((r.a !== void 0 && v.length < r.a) || (r.b !== void 0 && v.length > r.b)) return [-1, v];
  var s = 0;
  for (var i = 0; i < v.length; i++) {
    var x = _mjsTChk(r.e, v[i], w, note, p + '[' + i + ']', v, i);
    if (x[0] < 0) return [-1, v];
    if (x[0] > s) s = x[0];
    if (w !== null && x[1] !== v[i]) v[i] = x[1];
  }
  if (w !== null) w.set(v, _mjsTEntry(r, p, up, at));
  return [s, v];
}

function _mjsTObj(r, v, w, note, p, up, at) {
  v = µ._mjs_toRaw(v);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [-1, v];
  var s = 0, f = r.f;
  for (var k in f) {
    if (!_mjsTHas.call(f, k)) continue;
    var x0 = v[k];
    if (x0 === void 0 && r.o !== void 0 && r.o.indexOf(k) >= 0) continue;
    var x = _mjsTChk(f[k], x0, w, note, _mjsTKey(p, k), v, k);
    if (x[0] < 0) return [-1, v];
    if (x[0] > s) s = x[0];
    if (w !== null && x[1] !== x0) v[k] = x[1];
  }
  if (w !== null) w.set(v, _mjsTEntry(r, p, up, at));
  return [s, v];
}

// choix : une valeur exacte d'abord, sinon la première règle qui sait la convertir ou la ramener
function _mjsTUni(r, v, w, note, p, up, at) {
  var u = r.u, choisie = -1, x;
  for (var i = 0; i < u.length; i++) {
    x = _mjsTChk(u[i], v, null, null, p);
    if (x[0] === 0) { choisie = i; break; }
    if (x[0] > 0 && choisie < 0) choisie = i;
  }
  if (choisie < 0) return [-1, v];
  return _mjsTChk(u[choisie], v, w, note, p, up, at);
}

// `w` : registre en écriture (2e passage) ou null (1er passage, lecture seule) ; `note` recueille
// la première valeur refusée et la première ramenée, avec leur chemin, pour le message
function _mjsTChk(r, v, w, note, p, up, at) {
  var x;
  switch (r.t) {
    case 'i':
    case 'f': x = _mjsTNum(r, v); break;
    case 's': x = _mjsTStr(r, v); break;
    case 'b': x = typeof v === 'boolean' ? [0, v] : v === 'true' ? [1, true] : v === 'false' ? [1, false] : [-1, v]; break;
    case 'l': x = _mjsTLit(r, v); break;
    case 'a': x = _mjsTArr(r, v, w, note, p, up, at); break;
    case 'o': x = _mjsTObj(r, v, w, note, p, up, at); break;
    case 'u': x = _mjsTUni(r, v, w, note, p, up, at); break;
    default:  x = [0, v];
  }
  if (x[0] >= 0 && r.n !== void 0 && _mjsTBanned(r.n, x[1])) x = [-1, v];
  if (note !== null) {
    if (x[0] < 0 && note.refus === void 0) note.refus = { p: p, v: v, d: r.d };
    else if (x[0] === 2 && note.borne === void 0) note.borne = { p: p, v: v, to: x[1], d: r.d };
  }
  return x;
}

function _mjsTRepr(v) {
  if (typeof v === 'string') return "'" + (v.length > 40 ? v.slice(0, 40) + '…' : v) + "'";
  if (v !== null && typeof v === 'object') {
    try {
      var j = JSON.stringify(v);
      return j.length > 60 ? j.slice(0, 60) + '…' : j;
    }
    catch (_e) { return Object.prototype.toString.call(v); }
  }
  return String(v);
}

// message de développement : refus (kind 0), valeur ramenée (kind 1), valeur animée reçue (kind 2) ;
// rien en production
function _mjsTMsg(el, kind, n) {
  var mode = µ._typesMode;
  if ((mode !== 'warn' && mode !== 'error') || n === void 0) return;
  var ou  = el && el.localName ? ' (<' + el.localName + '>)' : '';
  var d   = n.d === void 0 ? '' : µ._mjs_txt('typesAllowed', { d: n.d }, ' — permis : {d}');
  var txt = kind === 0
    ? µ._mjs_msg('typesRefuses', { p: n.p, v: _mjsTRepr(n.v), d: d, at: ou }, '{p} refuse {v}{d}{at}')
    : kind === 1
    ? µ._mjs_msg('typesBrought', { p: n.p, v: _mjsTRepr(n.v), to: _mjsTRepr(n.to), d: d, at: ou }, '{p} : {v} ramené à {to}{d}{at}')
    : µ._mjs_msg('typesAnimated', { p: n.p, at: ou }, '{p} reçoit une valeur animée : ses bornes se règlent en la créant (µspring(valeur, raideur, amortissement, min, max), µinterpolate(valeur, durée, min, max)) — retirez {p} du <vars>{at}');
  if (mode === 'error') throw new Error(txt);
  µ.warn(txt);
}

// contrôle complet d'une écriture : premier passage en lecture seule, message, puis second passage
// qui écrit les conversions dans les listes et objets et les inscrit au registre — rend
// [statut, valeur] (statut -1 : refusée). `p` : le chemin où la valeur s'inscrit ; `up`, `at` : le conteneur
// qui porte la valeur écrite, et sa clé ou sa position dans celui-ci (rien pour une variable ou un store).
// Le premier passage note des chemins relatifs à la valeur : celui d'à présent de la valeur ne se calcule
// que pour un message
function _mjsTWriteX(r, v, reg, p, el, up, at) {
  var note = {};
  var x = _mjsTChk(r, v, null, note, '');
  if (x[0] < 0) { _mjsTMsg(el, 0, _mjsTWhere(note.refus, reg, p, up, at)); return x; }
  if (x[0] === 2) _mjsTMsg(el, 1, _mjsTWhere(note.borne, reg, p, up, at));
  if (r.t === 'a' || r.t === 'o' || r.t === 'u') {
    x[1] = _mjsTChk(r, v, reg, null, p, up, at)[1];
    if (up === void 0) _mjsTRoot(reg, p, x[1]);
  }
  return x;
}

function _mjsTWrite(r, v, reg, p, el, up, at) {
  var x = _mjsTWriteX(r, v, reg, p, el, up, at);
  return x[0] < 0 ? µ._mjs_TNO : x[1];
}

// contrôle seul, sans registre ni message — { s: statut, v: valeur à écrire }
µ._mjs_tcheck = function(r, v) {
  var x = _mjsTChk(r, v, null, null, '');
  if (x[0] >= 0 && (r.t === 'a' || r.t === 'o' || r.t === 'u')) x[1] = _mjsTChk(r, v, new WeakMap(), null, '')[1];
  return { s: x[0], v: x[1] };
};

// écriture d'une variable ou d'une prop de composant typée : la valeur à écrire, ou µ._mjs_TNO
µ._mjs_tset = function(el, k, v) {
  var r = el._mjs_types[k];
  if (v !== null && typeof v === 'object') {
    // un ressort (µspring, µinterpolate) a ses propres bornes : le compilateur refuse une variable
    // du <vars> qui en reçoit un ; arrivé quand même (par une fonction), il passe tel quel, sans les
    // bornes de la règle — ce serait un doublon — et le développement le dit
    if (µ._mjs_interpolatorSet.has(v)) {
      _mjsTMsg(el, 2, { p: '$' + k });
      return v;
    }
    // une promesse ou un dérivé passent : leur valeur arrive plus tard (un dérivé porte sa fonction `f`, une
    // donnée reçue qui a la clé `_mjs_c` n'en est pas un)
    if (typeof v.then === 'function' || (v._mjs_c && typeof v.f === 'function')) return v;
  }
  var x = _mjsTWriteX(r, v, el._mjs_treg || (el._mjs_treg = new WeakMap()), '$' + k, el);
  if (x[0] < 0) return µ._mjs_TNO;
  // une liste ou un objet corrigé sur place : son époque avance, pour qu'un pair lié en deux sens
  // (`=!{}`) voie une vraie mutation et se redessine, jamais un écho à ignorer
  if (x[0] > 0 && x[1] !== null && typeof x[1] === 'object' && typeof µ._mjs_bumpEpoch === 'function') µ._mjs_bumpEpoch(x[1]);
  return x[1];
};

// règle d'une écriture sous un conteneur inscrit : champ d'objet, élément ou longueur de liste ; `p` : le
// chemin où la valeur s'inscrira (celui d'inscription du conteneur, puis la clé ou la position), `at` : sa
// clé ou sa position
function _mjsTSub(e, o, key, v) {
  var r = e.r;
  if (typeof key === 'symbol') return null;
  if (r.t === 'o') {
    if (!_mjsTHas.call(r.f, key)) return null;
    if (v === void 0 && r.o !== void 0 && r.o.indexOf(key) >= 0) return null;
    return { r: r.f[key], p: _mjsTKey(e.p, key), at: key };
  }
  if (r.t !== 'a') return null;
  if (key === 'length') return { len: true };
  var i = typeof key === 'number' ? key : (/^(?:0|[1-9]\d*)$/.test(key) ? +key : -1);
  if (i < 0) return null;
  return { r: r.e, p: e.p + '[' + i + ']', i: i, at: i };
}

// écriture `o[key] = v` sous une valeur typée (compilée, filet d'un alias, store) : la valeur à
// écrire, ou µ._mjs_TNO. `el` : le composant propriétaire (null pour un store), pour le message
µ._mjs_tdeep = function(el, reg, o, key, v) {
  var e = reg.get(o);
  if (e === void 0) return v;
  var sub = _mjsTSub(e, o, key, v);
  if (sub === null) return v;
  var r = e.r;
  if (sub.len) {
    // une liste qui grandit sans ses éléments (un `push` dont l'élément a été refusé) ou sort de
    // ses bornes est refusée
    var n = +v, i;
    var ok = (r.a === void 0 || n >= r.a) && (r.b === void 0 || n <= r.b);
    for (i = o.length; ok && i < n; i++) if (!(i in o)) ok = false;
    if (ok) return v;
    _mjsTMsg(el, 0, { p: _mjsTPath(reg, e, o) + '.length', v: v, d: r.d });
    return µ._mjs_TNO;
  }
  if (sub.i !== void 0 && r.b !== void 0 && sub.i >= r.b) {
    _mjsTMsg(el, 0, { p: _mjsTPath(reg, e, o) + '[' + sub.i + ']', v: v, d: r.d });
    return µ._mjs_TNO;
  }
  return _mjsTWrite(sub.r, v, reg, sub.p, el, o, sub.at);
};

// avant une méthode appelée sur une liste typée : de quoi la défaire. Une méthode qui ajoute, retire
// ou range (push, unshift, splice, pop, shift, sort, reverse) : la longueur seule, µ._mjs_tafter ne
// contrôlera que ce qu'elle a changé ; une autre (fill, copyWithin) : une copie, la liste entière
// repassera sa règle
var _MJS_T_FAST = { push: 1, unshift: 1, splice: 1, pop: 1, shift: 1, sort: 1, reverse: 1 };
µ._mjs_tbefore = function(o, name) {
  return _mjsTHas.call(_MJS_T_FAST, name) ? o.length : o.slice();
};

// défait une méthode connue : `n0` la longueur d'avant, [a, b) les éléments ajoutés, `res` ce que la
// méthode a rendu (les éléments retirés par splice, pop, shift)
function _mjsTUndo(o, name, n0, a, b, res) {
  switch (name) {
    case 'push': o.length = n0; break;
    case 'unshift': o.splice(0, b); break;
    case 'splice': Array.prototype.splice.apply(o, [a, b - a].concat(res)); break;
    case 'pop': if (o.length < n0) o.push(res); break;
    case 'shift': if (o.length < n0) o.unshift(res); break;
  }
}

// la liste entière repasse sa règle (méthode inconnue, ou copie passée par l'appelant) ; refusée, elle
// revient à `avant`
function _mjsTAfterAll(el, reg, o, e, avant) {
  var note = {};
  var x    = _mjsTChk(e.r, o, null, note, '');
  var back = function() {
    o.length = 0;
    Array.prototype.push.apply(o, avant);
  };
  if (x[0] < 0) {
    back();
    _mjsTMsg(el, 0, _mjsTWhereList(note.refus, reg, e, o));
    return false;
  }
  if (x[0] === 2) {
    // mode 'error' : l'erreur arrête l'écriture, la liste revient à son état d'avant
    try {
      _mjsTMsg(el, 1, _mjsTWhereList(note.borne, reg, e, o));
    }
    catch (err) {
      back();
      throw err;
    }
  }
  _mjsTChk(e.r, o, reg, null, e.p, _mjsTUp(e), e.at);
  return true;
}

// après une méthode qui a modifié une liste typée — `avant` rendu par µ._mjs_tbefore, `name` la
// méthode, `args` ses arguments, `res` ce qu'elle a rendu. Une méthode connue ne fait contrôler que
// le nombre d'éléments et ses ajouts : un fil de messages qui en reçoit des milliers un par un ne
// revérifie pas toute la liste à chaque fois. Refusée, la liste est défaite ; une valeur ramenée, en
// mode 'error', l'arrête aussi. Rend `true` si la liste est gardée
µ._mjs_tafter = function(el, reg, o, avant, name, args, res) {
  var e = reg.get(o);
  if (e === void 0) return true;
  if (typeof avant !== 'number') return _mjsTAfterAll(el, reg, o, e, avant);
  var r  = e.r;
  var n0 = avant;
  var a  = 0;
  var b  = 0;
  var i, x, v;
  if (name === 'push') {
    a = n0;
    b = o.length;
  }
  else if (name === 'unshift') b = o.length - n0;
  else if (name === 'splice') {
    var d = args.length > 0 ? Math.trunc(Number(args[0])) || 0 : 0;
    a = d < 0 ? Math.max(n0 + d, 0) : Math.min(d, n0);
    b = a + Math.max(0, args.length - 2);
  }
  var note = {};
  var s    = 0;
  if ((r.a !== void 0 && o.length < r.a) || (r.b !== void 0 && o.length > r.b)) {
    note.refus = { p: '', v: o, d: r.d };
    s = -1;
  }
  else {
    for (i = a; i < b; i++) {
      x = _mjsTChk(r.e, o[i], null, note, '[' + i + ']');
      if (x[0] < 0) {
        s = -1;
        break;
      }
      if (x[0] > s) s = x[0];
    }
  }
  if (s < 0) {
    _mjsTUndo(o, name, n0, a, b, res);
    _mjsTMsg(el, 0, _mjsTWhereList(note.refus, reg, e, o));
    return false;
  }
  if (s === 2) {
    // mode 'error' : l'erreur arrête la méthode, la liste revient à son état d'avant
    try {
      _mjsTMsg(el, 1, _mjsTWhereList(note.borne, reg, e, o));
    }
    catch (err) {
      _mjsTUndo(o, name, n0, a, b, res);
      throw err;
    }
  }
  // second passage sur les ajouts : conversions écrites, objets et listes inscrits au registre
  for (i = a; i < b; i++) {
    v = o[i];
    if (s === 0 && (v === null || typeof v !== 'object')) continue;
    x = _mjsTChk(r.e, v, reg, null, e.p + '[' + i + ']', o, i);
    if (x[1] !== v) o[i] = x[1];
  }
  return true;
};

// `delete o[key]` sous un objet typé : un champ obligatoire ne se supprime pas
µ._mjs_tdelete = function(el, reg, o, key) {
  var e = reg.get(o);
  if (e === void 0 || e.r.t !== 'o' || !_mjsTHas.call(e.r.f, key)) return true;
  if (e.r.o !== void 0 && e.r.o.indexOf(key) >= 0) return true;
  _mjsTMsg(el, 0, { p: _mjsTKey(_mjsTPath(reg, e, o), key), v: void 0, d: e.r.f[key].d });
  return false;
};

// règles des stores, posées par le module compilé de chaque composant qui en déclare dans son
// <vars> : la première déclaration d'un store fait foi (le build refuse deux règles différentes
// pour le même store), et la valeur déjà présente la passe tout de suite
µ._mjs_storeTypes = function(rules) {
  var R   = µ._mjs_storeRules || (µ._mjs_storeRules = {});
  var reg = µ._mjs_storeTreg || (µ._mjs_storeTreg = new WeakMap());
  for (var k in rules) {
    if (!_mjsTHas.call(rules, k) || _mjsTHas.call(R, k)) continue;
    R[k] = rules[k];
    if (!_mjsTHas.call(µ._mjs_storeRaw, k)) continue;
    // convertie ou ramenée (sur place pour une liste ou un objet) : les lecteurs sont prévenus
    var x = _mjsTWriteX(rules[k], µ._mjs_storeRaw[k], reg, '$$' + k, null);
    if (x[0] > 0) {
      µ._mjs_storeRaw[k] = x[1];
      µ._mjs_storeNotifyDeep(k);
    }
  }
};

// écriture d'un store typé (`$$x = v`) : la valeur à écrire, ou µ._mjs_TNO
µ._mjs_tstore = function(key, v) {
  return _mjsTWrite(µ._mjs_storeRules[key], v, µ._mjs_storeTreg, '$$' + key, null);
};
