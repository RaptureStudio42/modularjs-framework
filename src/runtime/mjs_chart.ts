// mjs_chart — les calculs des graphiques, sans DOM : échelles aux bornes rondes, places sur l'axe x (jours, instants, nombres, libellés),
// regroupement par période, tendance, statistiques, classes d'histogramme, parts de camembert, tracés SVG, choix des étiquettes d'axe,
// nombres et dates écrits par Intl dans la langue donnée. Écrit une fois pour les modules de graphiques du cœur. Fichier détecté (clé
// 'chart') : le module écrit `µ._mjs_chart` littéralement, une application sans graphique n'en paie pas un octet. Fichier simple, sans
// import : seul `µ._mjs_chart` sort, les aides locales portent le préfixe _chr.
//
// L'entrée est NEUTRE : une série = { key, name, unit, color, kind, points: [ { x, y } ] }, `kind: 'text'` pour une série de mots (jamais
// tracée, jamais comptée). Avant un tracé, les séries passent en TABLE (tableOf) : une colonne par abscisse, une valeur ou null par série.
// La forme des lignes de données d'une application (une ligne par abscisse, ses mesures rangées par clé de série) arrive par l'adaptateur,
// en fin de fichier : il ne fait que traduire, le reste du fichier ne le connaît pas. Les positions sont des FRACTIONS de la zone de tracé
// (0 à 1, y de haut en bas), les tracés SVG sont dans un cadre de WIDE x HIGH.

var _chrWide  = 1000;
var _chrHigh  = 300;
var _chrNice  = [1, 2, 2.5, 5, 10];
var _chrFine  = [1, 2, 2.5, 3, 4, 5, 6, 8];
var _chrSteps = ['auto', 'day', 'week', 'month', 'year'];
var _chrIntl  = {};
var _chrWalls = {};

// une mesure écrite en texte, comme la lit le serveur (Float de Ruby) : blancs ASCII autour, un signe, des décimales (« 12 », « .5 »,
// « 5. », « 1e3 ») ou de l'hexadécimal (« 0x1A », « 0x1.8p1 »), un souligné seul entre deux chiffres (« 1_000 ») ; ni binaire (« 0b101 »),
// ni octal (« 0o17 »), ni « Infinity », ni virgule décimale. Groupes : signe, chiffres et fraction hexadécimaux, exposant binaire, décimal
var _chrNumberText = /^[ \t\n\v\f\r]*([+-]?)(?:0[xX]((?:[\da-fA-F]+(?:_[\da-fA-F]+)*)?)(?:\.((?:[\da-fA-F]+(?:_[\da-fA-F]+)*)?))?(?:[pP]([+-]?\d+(?:_\d+)*))?|((?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?))[ \t\n\v\f\r]*$/;
var _chrDecimalText = /^[ \t\n\v\f\r]*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\v\f\r]*$/;

// une heure écrite à la façon ISO 8601 : le jour, un « T » ou un blanc, l'heure (secondes et fractions facultatives), puis son fuseau ou
// rien (Z, +02:00, -0700, +02) ; aussi Time#to_s de Ruby et de Rails, le fuseau après un blanc (« 2026-10-19 08:15:00 UTC », « 2026-10-19
// 10:15:00 +0200 »). Groupes : année, mois, jour, heure, minute, seconde, fraction, fuseau
var _chrClockText = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|UTC|GMT|UT|[+-]\d{2}(?::?\d{2})?)?\s*$/i;

// une heure écrite en RFC 2822 (courriel, en-têtes HTTP) : le jour de la semaine facultatif, le jour, le mois en anglais, l'année, l'heure,
// puis son fuseau ou rien (« Mon, 19 Oct 2026 08:15:00 GMT », « 19 Oct 2026 10:15 +0200 »). Groupes : jour, mois, année, heure, minute,
// seconde, fuseau
var _chrMailText = /^\s*(?:[a-z]{3},?\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|UTC|GMT|UT|[+-]\d{2}(?::?\d{2})?)?\s*$/i;
var _chrMonths = 'janfebmaraprmayjunjulaugsepoctnovdec';

// une position (fraction de la zone, part d'un tour, rang dans une classe) au millionième : la poussière des flottants s'en va. Jamais une
// valeur des données : une échelle s'arrondit selon son pas (_chrSnap), une moyenne selon ses chiffres (_chrTidy)
function _chrRound(value) {
  return Math.round(value * 1e6) / 1e6;
}

// une valeur d'échelle écrite juste : arrondie au dixième du pas (un pas de 2,5 garde sa demi-unité), c'est le nombre décimal exact, sans
// la poussière des flottants (0,1 + 0,2), à toute grandeur
function _chrSnap(value, step) {
  var power = Math.floor(Math.log10(step)) - 1;
  var n = Math.round(value / Math.pow(10, power));
  return Math.abs(n) < 1e21 ? Number(n + 'e' + power) : value;
}

// une moyenne sans la poussière des flottants ((0,1 + 0,2) / 2 vaut 0,15), à quinze chiffres significatifs : une petite valeur garde les siens
function _chrTidy(value) {
  return Number(value.toPrecision(15));
}

// deux bornes trop proches pour une échelle : égales, ou séparées par moins d'un millième de milliardième de leur grandeur (la poussière
// des flottants) ; elles s'écartent alors comme des valeurs égales
function _chrFlat(low, high) {
  return !(high - low > Math.max(Math.abs(low), Math.abs(high)) * 1e-12);
}

// une mesure en nombre, null pour une case vide ou un mot : un nombre fini, ou un texte qui se lit tout entier en nombre (_chrNumberText) ;
// une décimale ordinaire, sans souligné ni hexadécimal, va droit à Number, qui la lit de même
function _chrNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  if (_chrDecimalText.test(value)) {
    var plain = Number(value);
    return Number.isFinite(plain) ? plain : null;
  }
  var m = _chrNumberText.exec(value);
  if (!m || (m[5] === undefined && !m[2] && m[3] === undefined)) return null;
  var n = m[5] === undefined ? _chrHex(m) : Number(m[1] + m[5].replace(/_/g, ''));
  return Number.isFinite(n) ? n : null;
}

// la valeur d'un hexadécimal lu par _chrNumberText : ses chiffres, fraction comprise, en un entier, décalé de 4 bits par chiffre de la
// fraction et de l'exposant binaire ; le décalage se fait en deux fois, un tout petit nombre ne tombe pas à zéro en route
function _chrHex(m) {
  var part = (m[3] || '').replace(/_/g, '');
  var shift = Number((m[4] || '0').replace(/_/g, '')) - 4 * part.length;
  var half = Math.floor(shift / 2);
  return (m[1] === '-' ? -1 : 1) * parseInt(m[2].replace(/_/g, '') + part || '0', 16) * Math.pow(2, half) * Math.pow(2, shift - half);
}

function _chrNumbers(values) {
  return (values || []).map(_chrNumber).filter(function(v) { return v !== null; });
}

// la somme compensée de Kahan-Babuska, celle du serveur : les erreurs d'arrondi des décimales ne s'accumulent pas
function _chrSum(list) {
  var f = 0;
  var c = 0;
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    var t = f + x;
    c += Math.abs(f) >= Math.abs(x) ? (f - t) + x : (x - t) + f;
    f = t;
  }
  return f + c;
}

// [ le plus petit, le plus grand ] d'une liste de nombres, sans étaler la liste en arguments (une longue série dépasserait la pile)
function _chrSpan(list) {
  var low = Infinity;
  var high = -Infinity;
  for (var i = 0; i < list.length; i++) {
    if (list[i] < low) low = list[i];
    if (list[i] > high) high = list[i];
  }
  return [low, high];
}

function _chrFormat(lang, options, dates) {
  var key = (dates ? 'd|' : 'n|') + lang + '|' + JSON.stringify(options);
  if (!_chrIntl[key]) _chrIntl[key] = dates ? new Intl.DateTimeFormat(lang || undefined, options) : new Intl.NumberFormat(lang || undefined, options);
  return _chrIntl[key];
}

function _chrNiceStep(raw) {
  var power = Math.pow(10, Math.floor(Math.log10(raw)));
  return _chrNice.map(function(m) { return m * power; }).find(function(candidate) { return candidate >= raw * (1 - 1e-9); }) || raw;
}

// un axe aux bornes rondes : { min, max, ticks } qui couvre [low, high] en `wanted` intervalles environ (4) ; `zero` y ajoute 0 (barres,
// aires). Les graduations sont les multiples du pas, écrits justes (_chrSnap) : distinctes à toute grandeur. Des bornes égales, ou qui ne
// diffèrent que par la poussière des flottants, s'écartent d'un dixième ; un pas que les flottants n'atteignent pas : les deux bornes.
// `places` (le nombre de chiffres après la virgule de l'écran) : un pas d'au moins 10^-N, qui s'écrit en N chiffres (cf. _chrPlaces)
function _chrNiceScale(low, high, wanted, zero, places) {
  var from = Number(low);
  var to = Number(high);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { min: 0, max: 1, ticks: [0, 1] };
  if (zero) {
    from = Math.min(from, 0);
    to = Math.max(to, 0);
  }
  if (_chrFlat(from, to)) {
    if (from === 0 && to === 0) to = 1;
    else {
      var pad = Math.max(Math.abs(from), Math.abs(to)) * 0.1;
      from -= pad;
      to += pad;
    }
  }
  var step = _chrPlaces(_chrNiceStep(Math.max((to - from) / (wanted || 4), _chrFloor(places))), places);
  if (!(step > 0 && step < Infinity)) return { min: from, max: to, ticks: [from, to] };
  var first = Math.floor(from / step + 1e-9);
  var last = Math.ceil(to / step - 1e-9);
  var ticks = [];
  for (var k = first; k <= last; k++) ticks.push(_chrSnap(k * step, step));
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks: ticks };
}

// l'axe d'un ensemble de valeurs (cases vides et mots écartés) : `zero` y ajoute 0, `ticks` le nombre d'intervalles voulu (4) ; `min` et
// `max` sont des bornes imposées — une échelle de 1 à 5 ne se resserre jamais en deçà, une valeur qui les dépasse l'élargit ; `places`, le
// nombre de chiffres de l'écran (cf. _chrNiceScale). Ni valeur ni borne : de 0 à 1
function _chrScaleOf(values, options) {
  var o = options || {};
  var all = _chrNumbers(values).concat(_chrNumbers([o.min, o.max]));
  if (!all.length) return { min: 0, max: 1, ticks: [0, 1] };
  var span = _chrSpan(all);
  return _chrNiceScale(span[0], span[1], o.ticks || 4, o.zero, o.places);
}

// le plus petit écart que `places` chiffres après la virgule savent écrire (10^-N) ; 0 sans `places`
function _chrFloor(places) {
  return places === undefined || places === null ? 0 : Math.pow(10, -places);
}

// un pas rond qui s'écrit en `places` chiffres : 2,5 × 10^-N en demande un de plus (0,25 s'écrirait 0,3), il passe à 5 × 10^-N
function _chrPlaces(step, places) {
  return places !== undefined && places !== null && _chrStepDigits(step) > places ? step * 2 : step;
}

// la place d'une valeur dans un domaine, de 0 (min) à 1 (max) ; un domaine sans épaisseur donne le milieu
function _chrRatio(value, min, max) {
  if (!(max > min)) return 0.5;
  return (Number(value) - min) / (max - min);
}

// une abscisse en nombre : un jour ou un instant en millisecondes (cf. _chrInstant), un nombre tel quel (virgule ou point) ; null pour un
// libellé ou une abscisse qui ne se lit pas. Un jour impossible (le 31 novembre, le mois 13 ou 0, le jour 0) n'est pas un jour, comme une
// heure impossible (cf. _chrClock) : Date.UTC le ferait passer à une autre date (le 31 novembre au 1er décembre)
function _chrParseX(kind, text) {
  if (kind === 'date') {
    var parts = String(text || '').slice(0, 10).split('-').map(Number);
    return parts.length === 3 && parts.every(Number.isInteger) && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1 && (parts[2] <= 28 || parts[2] <= new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate()) ? Date.UTC(parts[0], parts[1] - 1, parts[2]) : null;
  }
  if (kind === 'datetime') return _chrInstant(text);
  if (kind === 'number') {
    var figure = Number(String(text).replace(',', '.'));
    return Number.isFinite(figure) && String(text).trim() !== '' ? figure : null;
  }
  return null;
}

// la place de chaque colonne sur l'axe x : une case par colonne (`slots`, les barres), sinon à l'échelle du temps et des nombres, à
// intervalles égaux pour des libellés (ou dès qu'une abscisse ne se lit pas)
function _chrXFractions(texts, kind, slots) {
  var count = texts.length;
  if (slots) return texts.map(function(_, i) { return (i + 0.5) / count; });
  var spread = texts.map(function(text) { return _chrParseX(kind, text); });
  if (kind !== 'category' && spread.length > 1 && spread.every(function(v) { return v !== null; })) {
    var span = _chrSpan(spread);
    return spread.map(function(v) { return _chrRound(_chrRatio(v, span[0], span[1])); });
  }
  return texts.map(function(_, i) { return count <= 1 ? 0.5 : _chrRound(i / (count - 1)); });
}

// comme _chrXFractions, avec UNE place de plus après la dernière colonne (le point suivant estimé de la tendance) : { fractions, next } ;
// les barres gagnent une case, le temps et les nombres un écart moyen, les libellés un intervalle
function _chrXFractionsAhead(texts, kind, slots) {
  var count = texts.length;
  if (slots) return { fractions: texts.map(function(_, i) { return (i + 0.5) / (count + 1); }), next: (count + 0.5) / (count + 1) };
  var spread = texts.map(function(text) { return _chrParseX(kind, text); });
  if (kind !== 'category' && count > 1 && spread.every(function(v) { return v !== null; })) {
    var span = _chrSpan(spread);
    if (span[1] > span[0]) {
      var end = span[1] + (span[1] - span[0]) / (count - 1);
      return { fractions: spread.map(function(v) { return _chrRound(_chrRatio(v, span[0], end)); }), next: 1 };
    }
  }
  return { fractions: texts.map(function(_, i) { return _chrRound(i / count); }), next: 1 };
}

// la colonne la plus proche d'une position (0 à 1) sur l'axe x, -1 sans colonne
function _chrNearestIndex(fractions, at) {
  var best = -1;
  var gap = Infinity;
  fractions.forEach(function(f, i) {
    var d = Math.abs(f - at);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}

// les étiquettes de l'axe x à montrer : entières, sans chevauchement, la première et la dernière toujours là. Avec `options.width` (la zone
// de tracé, en px), chaque étiquette a sa largeur (`measure(texte)` en px, sinon `charWidth` px par caractère, 6,5) et sa place réelle : la
// première part du bord gauche, la dernière finit au bord droit, les autres sont centrées sur leur abscisse, et deux voisines gardent `gap`
// px entre elles (8) ; trop étroit pour la première et la dernière ensemble, la première reste seule. Sans largeur, l'écart minimal est une
// part de la zone réglée sur le plus long libellé : deux dates voisines peuvent alors se toucher sur un écran étroit
function _chrLabelPicks(fractions, texts, options) {
  var count = fractions.length;
  if (count === 0) return [];
  var o = options || {};
  if (o.width > 0) return _chrLabelsFit(fractions, texts, o);
  var longest = Math.max.apply(null, texts.map(function(t) { return String(t).length; }));
  var gap = Math.min(0.5, Math.max(0.14, longest * 0.017));
  var shown = [0];
  for (var i = 1; i < count; i++) if (fractions[i] - fractions[shown[shown.length - 1]] >= gap) shown.push(i);
  var last = count - 1;
  if (shown[shown.length - 1] !== last) {
    if (fractions[last] - fractions[shown[shown.length - 1]] >= gap || shown.length === 1) shown.push(last);
    else shown[shown.length - 1] = last;
  }
  return shown;
}

// le choix à la largeur réelle (cf. _chrLabelPicks) : de gauche à droite, une étiquette reste quand elle commence après la précédente gardée,
// écart compris ; la dernière retire ensuite celles qu'elle toucherait, jamais la première
function _chrLabelsFit(fractions, texts, o) {
  var last = fractions.length - 1;
  var gap = o.gap === undefined ? 8 : o.gap;
  var box = function(i) {
    var text = String(texts[i]);
    var size = o.measure ? o.measure(text) : text.length * (o.charWidth || 6.5);
    var at = fractions[i] * o.width;
    if (i === 0) return [at, at + size];
    if (i === last) return [at - size, at];
    return [at - size / 2, at + size / 2];
  };
  var shown = [0];
  var edges = [box(0)[1]];
  for (var i = 1; i < last; i++) {
    var b = box(i);
    if (b[0] >= edges[edges.length - 1] + gap) {
      shown.push(i);
      edges.push(b[1]);
    }
  }
  if (last === 0) return shown;
  var end = box(last)[0];
  while (shown.length > 1 && edges[edges.length - 1] + gap > end) {
    shown.pop();
    edges.pop();
  }
  if (edges[0] + gap <= end) shown.push(last);
  return shown;
}

// les classes d'un histogramme : { from, to, count }, bornes rondes écrites justes (_chrSnap), la dernière classe fermée à droite ; Sturges (3
// à 12 classes) sauf `wanted`. Des valeurs égales, ou qui ne diffèrent que par la poussière des flottants : une seule classe. `places` : des
// classes d'au moins 10^-N, d'une largeur qui s'écrit en N chiffres (cf. _chrNiceScale)
function _chrHistogramBins(values, wanted, places) {
  var numbers = _chrNumbers(values);
  if (numbers.length === 0) return [];
  var span = _chrSpan(numbers);
  var low = span[0];
  var high = span[1];
  var classes = wanted || Math.min(12, Math.max(3, Math.ceil(Math.log2(numbers.length) + 1)));
  var width = _chrPlaces(_chrNiceStep(Math.max((high - low) / classes, _chrFloor(places))), places);
  if (_chrFlat(low, high) || !(width > 0 && width < Infinity)) return [{ from: low, to: high, count: numbers.length }];
  var first = Math.floor(low / width + 1e-9);
  var start = _chrSnap(first * width, width);
  var total = Math.max(1, Math.ceil(_chrRound((high - start) / width) - 1e-9));
  var bins = [];
  for (var i = 0; i < total; i++) bins.push({ from: _chrSnap((first + i) * width, width), to: _chrSnap((first + i + 1) * width, width), count: 0 });
  numbers.forEach(function(v) {
    var at = Math.min(total - 1, Math.floor(_chrRound((v - start) / width) + 1e-9));
    bins[at].count++;
  });
  return bins;
}

// les parts d'un camembert : seules les valeurs positives comptent ; { total, slices: [ { …entrée, value, share, percent, from, to } ] },
// from et to en tours (0 à 1), dans l'ordre des entrées
function _chrPieShares(entries) {
  var parts = entries.filter(function(e) { return Number(e.value) > 0; });
  var total = parts.reduce(function(sum, e) { return sum + Number(e.value); }, 0);
  var done = 0;
  var slices = parts.map(function(e) {
    var share = Number(e.value) / total;
    var slice = Object.assign({}, e, { value: Number(e.value), share: share, percent: Math.round(share * 1000) / 10, from: _chrRound(done), to: _chrRound(done + share) });
    done += share;
    return slice;
  });
  return { total: total, slices: slices };
}

// les parts d'un camembert tirées de points { x, y } : les valeurs d'une même abscisse s'additionnent, les parts positives se rangent de la
// plus grande à la plus petite (à égalité, dans l'ordre d'arrivée), les `max` premières (7) restent et les suivantes se fondent en une seule
// part « autres » — { key: '#others', others: true, count }, son libellé vient de l'écran ; puis _chrPieShares
function _chrPieParts(points, max) {
  var keep = max || 7;
  var totals = new Map();
  (points || []).forEach(function(p) {
    var v = _chrNumber(p.y);
    if (v === null) return;
    var name = p.x === null || p.x === undefined || p.x === '' ? '—' : String(p.x);
    totals.set(name, (totals.get(name) || 0) + v);
  });
  var ranked = Array.from(totals, function(e) { return { key: e[0], label: e[0], value: e[1] }; }).filter(function(e) { return e.value > 0; }).sort(function(a, b) { return b.value - a.value; });
  var parts = ranked.slice(0, keep);
  if (ranked.length > keep) parts.push({ key: '#others', others: true, count: ranked.length - keep, value: _chrSum(ranked.slice(keep).map(function(e) { return e.value; })) });
  return _chrPieShares(parts);
}

function _chrPoint(cx, cy, radius, turn) {
  var angle = (turn - 0.25) * 2 * Math.PI;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function _chrFixed2(value) {
  return value.toFixed(2);
}

// le secteur d'un anneau (rayon interne `inner`, 0 pour une part pleine) entre deux positions en tours, depuis le haut dans le sens des
// aiguilles ; un tour entier se trace en deux demi-arcs (à remplir en evenodd)
function _chrArcPath(cx, cy, outer, inner, from, to) {
  var span = Math.min(1, Math.max(0, to - from));
  if (span <= 0) return '';
  if (span >= 0.9999) {
    var top = _chrPoint(cx, cy, outer, 0);
    var bottom = _chrPoint(cx, cy, outer, 0.5);
    var ring = 'M ' + _chrFixed2(top[0]) + ' ' + _chrFixed2(top[1]) + ' A ' + outer + ' ' + outer + ' 0 0 1 ' + _chrFixed2(bottom[0]) + ' ' + _chrFixed2(bottom[1]) + ' A ' + outer + ' ' + outer + ' 0 0 1 ' + _chrFixed2(top[0]) + ' ' + _chrFixed2(top[1]) + ' Z';
    if (inner > 0) {
      var up = _chrPoint(cx, cy, inner, 0);
      var down = _chrPoint(cx, cy, inner, 0.5);
      ring += ' M ' + _chrFixed2(up[0]) + ' ' + _chrFixed2(up[1]) + ' A ' + inner + ' ' + inner + ' 0 0 0 ' + _chrFixed2(down[0]) + ' ' + _chrFixed2(down[1]) + ' A ' + inner + ' ' + inner + ' 0 0 0 ' + _chrFixed2(up[0]) + ' ' + _chrFixed2(up[1]) + ' Z';
    }
    return ring;
  }
  var big = span > 0.5 ? 1 : 0;
  var a = _chrPoint(cx, cy, outer, from);
  var b = _chrPoint(cx, cy, outer, to);
  var d = 'M ' + _chrFixed2(a[0]) + ' ' + _chrFixed2(a[1]) + ' A ' + outer + ' ' + outer + ' 0 ' + big + ' 1 ' + _chrFixed2(b[0]) + ' ' + _chrFixed2(b[1]);
  if (inner > 0) {
    var e = _chrPoint(cx, cy, inner, to);
    var f = _chrPoint(cx, cy, inner, from);
    d += ' L ' + _chrFixed2(e[0]) + ' ' + _chrFixed2(e[1]) + ' A ' + inner + ' ' + inner + ' 0 ' + big + ' 0 ' + _chrFixed2(f[0]) + ' ' + _chrFixed2(f[1]);
  }
  else d += ' L ' + cx + ' ' + cy;
  return d + ' Z';
}

// la droite de tendance d'une série par les moindres carrés, comme le serveur : les valeurs dans l'ordre, une par rang (0, 1, 2…) sans
// compter les cases vides ; `first` est la valeur de la droite au rang 0, `next` celle du rang qui suit la dernière valeur (le point suivant
// estimé), `direction` : up, down ou flat (pente sous 1e-9) ; null sous deux valeurs
function _chrTrendFit(values) {
  var numbers = _chrNumbers(values);
  var count = numbers.length;
  if (count < 2) return null;
  var mid = (count - 1) / 2;
  var mean = _chrSum(numbers) / count;
  var top = _chrSum(numbers.map(function(v, i) { return (i - mid) * (v - mean); }));
  var bottom = _chrSum(numbers.map(function(_, i) { return (i - mid) * (i - mid); }));
  var slope = bottom === 0 ? 0 : top / bottom;
  var origin = mean - slope * mid;
  return { slope: slope, first: origin, next: origin + slope * count, count: count, direction: Math.abs(slope) < 1e-9 ? 'flat' : (slope > 0 ? 'up' : 'down') };
}

// la médiane d'une liste TRIÉE, null quand elle est vide
function _chrMedian(sorted) {
  var n = sorted.length;
  if (n === 0) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// l'arrondi du serveur : `digits` décimales, la moitié loin de zéro ; sans `digits`, la valeur exacte
function _chrDigits(value, digits) {
  if (value === null || digits === undefined || digits === null) return value;
  var k = Math.pow(10, digits);
  var scaled = value * k;
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / k || 0;
}

// la lecture statistique d'une série, celle du serveur : effectif, somme, moyenne, médiane, quartiles, extrêmes, étendue (max − min) et écart
// type (de l'échantillon, n − 1 ; 0 sous deux valeurs). Quartiles par les MOITIÉS EXCLUSIVES, sans interpolation : Q1 est la médiane de la
// moitié basse, Q3 celle de la moitié haute, la médiane d'un effectif impair n'appartient à aucune des deux ; sous deux valeurs, pas de
// quartile (null). `digits` : l'arrondi du serveur (2), sinon les valeurs exactes. Série vide : n = 0, somme 0, le reste null
function _chrStats(values, digits) {
  var numbers = _chrNumbers(values).sort(function(a, b) { return a - b; });
  var n = numbers.length;
  if (n === 0) return { n: 0, sum: 0, mean: null, median: null, q1: null, q3: null, min: null, max: null, range: null, deviation: null };
  var sum = _chrSum(numbers);
  var mean = sum / n;
  var half = Math.floor(n / 2);
  var deviation = n < 2 ? 0 : Math.sqrt(_chrSum(numbers.map(function(v) { return (v - mean) * (v - mean); })) / (n - 1));
  var fix = function(v) { return _chrDigits(v, digits); };
  return { n: n, sum: fix(sum), mean: fix(mean), median: fix(_chrMedian(numbers)), q1: fix(_chrMedian(numbers.slice(0, half))), q3: fix(_chrMedian(numbers.slice(n - half))), min: fix(numbers[0]), max: fix(numbers[n - 1]), range: fix(numbers[n - 1] - numbers[0]), deviation: fix(deviation) };
}

function _chrTwo(n) {
  return String(n).padStart(2, '0');
}

// le jour (année, mois de 0 à 11, jour) où tombe une abscisse de temps : un jour tel quel, un instant à l'heure locale de l'écran ; `utc` :
// un instant déjà ramené à l'heure qu'il affiche (cf. _chrWallTime), lu en UTC
function _chrDayParts(kind, text, utc) {
  var stamp = _chrParseX(kind === 'date' ? 'date' : 'datetime', text);
  if (stamp === null) return null;
  var d = new Date(stamp);
  return kind === 'date' || utc ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] : [d.getFullYear(), d.getMonth(), d.getDate()];
}

// le premier jour de la période d'une abscisse, en AAAA-MM-JJ : le jour lui-même, le lundi de sa semaine, le premier du mois ou de l'année ;
// le compte des jours se fait en UTC une fois le jour lu, un changement d'heure ne déplace donc rien ; null quand l'abscisse ne se lit pas ;
// `utc` : cf. _chrDayParts
function _chrPeriodStart(kind, text, step, utc) {
  var parts = _chrDayParts(kind, text, utc);
  if (parts === null) return null;
  var at = Date.UTC(parts[0], parts[1], parts[2]);
  if (step === 'week') at -= ((new Date(at).getUTCDay() + 6) % 7) * 86400000;
  else if (step === 'month') at = Date.UTC(parts[0], parts[1], 1);
  else if (step === 'year') at = Date.UTC(parts[0], 0, 1);
  var d = new Date(at);
  return d.getUTCFullYear() + '-' + _chrTwo(d.getUTCMonth() + 1) + '-' + _chrTwo(d.getUTCDate());
}

// regroupe-t-on ? seulement un axe de temps, avec un pas connu autre que `auto`
function _chrGrouping(kind, step) {
  return step !== 'auto' && _chrSteps.indexOf(step) >= 0 && (kind === 'date' || kind === 'datetime');
}

// des éléments rangés par période : [ { x: premier jour, items } ] dans l'ordre du temps ; un élément dont l'abscisse ne se lit pas est laissé
function _chrBuckets(items, kind, step, xOf, utc) {
  var buckets = new Map();
  items.forEach(function(item) {
    var start = _chrPeriodStart(kind, xOf(item), step, utc);
    if (start === null) return;
    if (!buckets.has(start)) buckets.set(start, { x: start, items: [] });
    buckets.get(start).items.push(item);
  });
  return Array.from(buckets.values()).sort(function(a, b) { return a.x < b.x ? -1 : (a.x > b.x ? 1 : 0); });
}

// les séries regroupées par période (`step` : auto, day, week, month, year) : un point par période, la moyenne de ses valeurs, `count` le
// nombre de valeurs réunies, l'abscisse au premier jour de la période (l'axe devient un axe de jours) ; une série de mots ne se moyenne pas,
// elle reste sans point. `auto`, un pas inconnu ou un axe qui n'est pas le temps : les séries telles quelles ; `utc` : cf. _chrDayParts.
// { series, kind, grouped }
function _chrGroupPoints(series, kind, step, utc) {
  if (!_chrGrouping(kind, step)) return { series: series, kind: kind, grouped: false };
  var grouped = series.map(function(s) {
    if (s.kind === 'text') return Object.assign({}, s, { points: [] });
    var numeric = (s.points || []).filter(function(p) { return _chrNumber(p.y) !== null; });
    var points = _chrBuckets(numeric, kind, step, function(p) { return p.x; }, utc).map(function(bucket) {
      var ys = bucket.items.map(function(p) { return _chrNumber(p.y); });
      return { x: bucket.x, y: _chrTidy(_chrSum(ys) / ys.length), count: ys.length };
    });
    return Object.assign({}, s, { points: points });
  });
  return { series: grouped, kind: 'date', grouped: true };
}

// un nombre écrit dans la langue donnée : deux décimales, et trois chiffres significatifs sous 0,1, où deux décimales n'en gardent qu'un ou
// aucun (0,004 ; 0,0123) ; sous le dix-millième, en notation scientifique (3,2E-5), comme l'axe ; « — » pour une valeur absente. `step`,
// facultatif : l'écart de deux nombres voisins à distinguer (les bornes des classes d'un histogramme) ; assez de chiffres pour qu'ils ne
// s'écrivent jamais pareil (1,001 et 1,002 au pas d'un millième). `places`, facultatif : exactement ce nombre de chiffres après la virgule,
// sans notation scientifique (le réglage `decimals` du graphique) ; une valeur qui s'y arrondit à zéro s'écrit sans signe (« 0,00 », jamais
// « -0,00 »). Un zéro négatif (« -0.0 », ce que Rails envoie pour `(-0.04).round(1)`) s'écrit 0 dans tous les cas
function _chrFormatNumber(value, lang, step, places) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  var n = Number(value) || 0;
  if (places !== undefined && places !== null) return _chrFormat(lang, { minimumFractionDigits: places, maximumFractionDigits: places }).format(Math.round(Math.abs(n) * Math.pow(10, places)) ? n : 0);
  var size = Math.abs(n);
  var fine = step === undefined ? null : _chrStepDigits(step);
  if (size > 0 && size < 1e-4) return _chrFormat(lang, { notation: 'scientific', maximumSignificantDigits: Math.max(3, fine === null ? 0 : Math.min(21, Math.floor(Math.log10(size)) + fine + 1)) }).format(n);
  var digits = size > 0 && size < 0.1 ? 2 - Math.floor(Math.log10(size)) : 2;
  return _chrFormat(lang, { maximumFractionDigits: Math.min(20, Math.max(digits, fine === null ? 0 : fine)) }).format(n);
}

// les décimales d'un pas, sans la poussière des flottants (1,002 − 1,001 en a trois, 0,0025 quatre, 2,5 une, 100 aucune) ; null sans pas
function _chrStepDigits(step) {
  var s = Math.abs(Number(step));
  if (!(s > 0 && s < Infinity)) return null;
  var clean = Number(s.toPrecision(6));
  return Math.max(0, _chrFigures(clean) - 1 - Math.floor(Math.log10(clean)));
}

// les chiffres significatifs d'un nombre (1,25 M : 3 ; 0,002 : 1), sans la poussière des flottants
function _chrFigures(value) {
  var text = Number(Math.abs(value).toPrecision(15)).toExponential();
  return Math.max(1, text.indexOf('e') - (text.indexOf('.') < 0 ? 0 : 1));
}

// une graduation écrite court, avec tous ses chiffres (deux graduations voisines s'écrivent toujours différemment) : abrégée dès 10 000
// (12 k, 1,25 M), en notation scientifique sous le dix-millième et dès 10^15 (3,2E-5) ; avec `places`, en entier, avec exactement ce
// nombre de chiffres après la virgule ; un zéro négatif s'écrit 0
function _chrAxisNumber(value, lang, places) {
  if (places !== undefined && places !== null) return _chrFormatNumber(value, lang, undefined, places);
  var n = Number(value) || 0;
  var size = Math.abs(n);
  var options = { maximumSignificantDigits: _chrFigures(n) };
  if (size >= 1e15 || (size > 0 && size < 1e-4)) options.notation = 'scientific';
  else if (size >= 10000) options.notation = 'compact';
  return _chrFormat(lang, options).format(n);
}

// les chiffres d'une série écrits dans la langue donnée : `figures` porte la lecture de _chrStats, et `next` et `slope` de la tendance ;
// `range` écrit les deux bornes (min – max), une valeur absente s'écrit « — » ; `places` : cf. _chrFormatNumber
function _chrStatsText(figures, lang, places) {
  var s = figures || {};
  var write = function(v) { return _chrFormatNumber(v, lang, undefined, places); };
  return { mean: write(s.mean), median: write(s.median), q1: write(s.q1), q3: write(s.q3), range: write(s.min) + ' – ' + write(s.max), deviation: write(s.deviation), next: write(s.next), slope: write(s.slope) };
}

// une abscisse écrite pour l'écran : un jour (le même partout), un instant (à l'heure locale ; `utc` : déjà ramené à l'heure qu'il affiche,
// cf. _chrWallTime), un nombre, ou le libellé tel quel ; `short` : sans l'année
function _chrFormatX(kind, text, lang, short, utc) {
  if (kind === 'date' || kind === 'datetime') {
    var stamp = _chrParseX(kind, text);
    if (stamp === null) return String(text);
    var options = kind === 'date' || utc ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short' };
    if (kind === 'datetime') Object.assign(options, { hour: '2-digit', minute: '2-digit' });
    if (!short) options.year = 'numeric';
    return _chrFormat(lang, options, true).format(stamp);
  }
  if (kind === 'number') return _chrFormatNumber(_chrParseX('number', text), lang);
  return String(text);
}

// une période écrite pour l'écran : un jour, le lundi de sa semaine, un mois (« octobre 2026 ») ou une année ; `short` : pour l'axe
function _chrFormatPeriod(step, start, lang, short) {
  var stamp = _chrParseX('date', start);
  if (stamp === null) return String(start);
  if (step === 'month') return _chrFormat(lang, { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }, true).format(stamp);
  if (step === 'year') return _chrFormat(lang, { year: 'numeric', timeZone: 'UTC' }, true).format(stamp);
  return _chrFormatX('date', start, lang, short);
}

// les séries mises en table : une colonne par abscisse (`xs`), chaque série y range sa valeur ou null (un nombre pour une série de nombres,
// le mot tel quel pour une série de mots) et, dans `cells`, le point d'où vient la valeur. Les colonnes suivent le temps ou les nombres (axes
// date, datetime, number ; une abscisse qui ne se lit pas vient après, dans l'ordre d'arrivée), l'ordre d'arrivée pour des libellés ; une
// abscisse répétée DANS une série ouvre une colonne de plus : deux mesures du même jour restent deux points
function _chrTableOf(series, kind) {
  var columns = [];
  var index = new Map();
  var cells = series.map(function(s) {
    var seen = new Map();
    return (s.points || []).map(function(p) {
      var name = String(p.x);
      var n = seen.get(name) || 0;
      var id = n + '|' + name;
      seen.set(name, n + 1);
      if (!index.has(id)) {
        index.set(id, columns.length);
        columns.push({ x: p.x, n: n, at: kind === 'category' ? null : _chrParseX(kind, p.x), order: columns.length });
      }
      return { column: index.get(id), point: p, value: s.kind === 'text' ? (p.y === undefined ? null : p.y) : _chrNumber(p.y) };
    });
  });
  var sorted = columns.slice();
  if (kind !== 'category') {
    sorted.sort(function(a, b) {
      if (a.at === null || b.at === null) return a.at === null && b.at === null ? a.order - b.order : (a.at === null ? 1 : -1);
      return a.at - b.at || a.n - b.n || a.order - b.order;
    });
  }
  var place = [];
  sorted.forEach(function(c, k) { place[c.order] = k; });
  return {
    xs: sorted.map(function(c) { return c.x; }),
    series: series.map(function(s, k) {
      var values = sorted.map(function() { return null; });
      var points = sorted.map(function() { return null; });
      cells[k].forEach(function(cell) {
        values[place[cell.column]] = cell.value;
        points[place[cell.column]] = cell.point;
      });
      var column = Object.assign({}, s, { values: values, cells: points });
      delete column.points;
      return column;
    })
  };
}

function _chrPathOf(points, wide, high) {
  var d = '';
  var open = false;
  points.forEach(function(p) {
    if (p === null) {
      open = false;
      return;
    }
    d += (open ? ' L ' : ' M ') + _chrFixed2(p.x * wide) + ' ' + _chrFixed2(p.y * high);
    open = true;
  });
  return d.trim();
}

function _chrAreaOf(points, baseline, wide, high) {
  var runs = [];
  var run = null;
  points.forEach(function(p) {
    if (p === null) {
      run = null;
      return;
    }
    if (run === null) {
      run = [];
      runs.push(run);
    }
    run.push(p);
  });
  return runs.map(function(r) {
    var body = r.map(function(p) { return _chrFixed2(p.x * wide) + ' ' + _chrFixed2(p.y * high); }).join(' L ');
    return 'M ' + _chrFixed2(r[0].x * wide) + ' ' + _chrFixed2(baseline * high) + ' L ' + body + ' L ' + _chrFixed2(r[r.length - 1].x * wide) + ' ' + _chrFixed2(baseline * high) + ' Z';
  }).join(' ');
}

// tout ce qu'un graphique à axes dessine, depuis une table (_chrTableOf, ou l'adaptateur) : les séries visibles avec leurs points, tracés et
// aires, les barres groupées par case, l'axe y commun (ou une échelle par série quand les unités diffèrent). `options` : kind (l'axe x),
// shape (line, area, bar, dots), trend (la droite de chaque série de nombres qui a deux valeurs, prolongée jusqu'au point suivant estimé :
// une place de plus sur l'axe x et dans l'échelle), bounds ({ min, max } : des bornes que l'échelle garde, élargie seulement par une valeur
// ou une tendance qui les dépasse), hidden (les clés des séries masquées), places (le nombre de chiffres de l'écran, cf. _chrNiceScale). Une
// série de mots ne se dessine jamais
function _chrPlotModel(table, options) {
  var o = options || {};
  var hidden = o.hidden || [];
  var texts = table.xs;
  var visible = table.series.filter(function(s) { return s.kind !== 'text' && hidden.indexOf(s.key) < 0; });
  var slots = o.shape === 'bar';
  var zero = o.shape === 'bar' || o.shape === 'area';
  var valuesOf = function(s) { return s.values.filter(function(v) { return v !== null; }); };
  var fits = visible.map(function(s) { return o.trend ? _chrTrendFit(valuesOf(s)) : null; });
  var places = fits.some(function(f) { return f !== null; }) ? _chrXFractionsAhead(texts, o.kind, slots) : { fractions: _chrXFractions(texts, o.kind, slots), next: null };
  var fractions = places.fractions;
  // seules les séries qui ont une valeur décident d'une échelle par série : une série vide n'a rien à mettre à l'échelle
  var filled = visible.filter(function(s) { return valuesOf(s).length > 0; });
  var units = Array.from(new Set(filled.map(function(s) { return s.unit || ''; })));
  var own = filled.length > 1 && units.length > 1;
  var bounds = o.bounds || {};
  var scaleFor = function(list) {
    var all = [];
    list.forEach(function(s) {
      var fit = fits[visible.indexOf(s)];
      all = all.concat(valuesOf(s), fit ? [fit.first, fit.next] : []);
    });
    return _chrScaleOf(all, { zero: zero, min: bounds.min, max: bounds.max, places: o.places });
  };
  var common = scaleFor(visible);
  var lines = visible.map(function(s, k) {
    var scale = own ? scaleFor([s]) : common;
    var base = Math.min(1, Math.max(0, 1 - _chrRatio(0, scale.min, scale.max)));
    var points = s.values.map(function(value, i) {
      return value === null ? null : { i: i, value: value, x: fractions[i], y: 1 - _chrRatio(value, scale.min, scale.max) };
    });
    var trend = null;
    if (fits[k]) {
      var start = points.find(function(p) { return p !== null; });
      var from = { x: start.x, y: 1 - _chrRatio(fits[k].first, scale.min, scale.max) };
      var to = { x: places.next, y: 1 - _chrRatio(fits[k].next, scale.min, scale.max) };
      trend = { from: from, to: to, slope: fits[k].slope, next: fits[k].next, direction: fits[k].direction, d: 'M ' + _chrFixed2(from.x * _chrWide) + ' ' + _chrFixed2(from.y * _chrHigh) + ' L ' + _chrFixed2(to.x * _chrWide) + ' ' + _chrFixed2(to.y * _chrHigh) };
    }
    var figures = _chrStats(s.values);
    var marks = {};
    ['mean', 'median', 'q1', 'q3'].forEach(function(name) {
      if (figures[name] === null) return;
      var y = 1 - _chrRatio(figures[name], scale.min, scale.max);
      marks[name] = { value: figures[name], y: y, d: 'M 0 ' + _chrFixed2(y * _chrHigh) + ' L ' + _chrWide + ' ' + _chrFixed2(y * _chrHigh) };
    });
    return { key: s.key, name: s.name, unit: s.unit, color: s.color, scale: scale, baseline: base, points: points, d: _chrPathOf(points, _chrWide, _chrHigh), area: _chrAreaOf(points, base, _chrWide, _chrHigh), trend: trend, stats: figures, marks: marks };
  });
  var bars = [];
  if (slots) {
    var group = 0.74 / texts.length;
    var each = group / Math.max(1, visible.length);
    texts.forEach(function(_, i) {
      lines.forEach(function(line, j) {
        var p = line.points[i];
        if (p === null) return;
        var top = Math.min(p.y, line.baseline);
        bars.push({ i: i, key: line.key, color: line.color, left: fractions[i] - group / 2 + j * each, width: each, top: top, height: Math.abs(line.baseline - p.y) });
      });
    });
  }
  return { slots: slots, own: own, scale: own ? null : common, xs: texts, fractions: fractions, lines: lines, bars: bars, count: texts.length };
}

// les statistiques de chaque série VISIBLE sur ce qui est affiché — la table des colonnes montrées, période choisie et regroupement compris :
// [ { key, name, unit, color, stats, trend, marks } ] ; `stats` : _chrStats ; `trend` : _chrTrendFit, que la droite soit tracée ou non (null
// sous deux valeurs) ; `marks` : un trait par statistique (mean, median, q1, q3 : sa valeur, sa hauteur `y` dans l'échelle de la série, son
// tracé d'un bord à l'autre ; absent quand la statistique n'existe pas), et `trend`, la droite de plotModel quand `options.trend` la demande
function _chrSeriesStats(table, options) {
  return _chrPlotModel(table, options).lines.map(function(line) {
    var values = line.points.filter(function(p) { return p !== null; }).map(function(p) { return p.value; });
    var marks = Object.assign({}, line.marks);
    if (line.trend) marks.trend = line.trend;
    return { key: line.key, name: line.name, unit: line.unit, color: line.color, stats: line.stats, trend: _chrTrendFit(values), marks: marks };
  });
}

// la place des traits de moyenne et de médiane sur un histogramme : { mean, median } en fraction de la largeur des classes (de la première
// borne à la dernière), null quand la valeur manque
function _chrHistogramMarks(bins, figures) {
  var s = figures || {};
  if (!bins.length) return { mean: null, median: null };
  var low = bins[0].from;
  var span = Math.max(bins[bins.length - 1].to - low, 1e-9);
  var place = function(v) { return v === null || v === undefined ? null : Math.min(1, Math.max(0, (Number(v) - low) / span)); };
  return { mean: place(s.mean), median: place(s.median) };
}

// des barres EMPILÉES, depuis une table : par colonne, une case (comme les barres groupées), les séries visibles posées l'une sur l'autre dans
// leur ordre, chaque segment partant du cumul des précédentes ; une valeur absente ou négative n'empile rien. L'échelle part de 0 et couvre
// le plus haut total (`bounds` et `places` comme pour plotModel). { scale, totals, fractions, segments: [ { i, key, color, value, base, top, height,
// left, width } ] } ; base est le cumul sous le segment, top et height en fraction de hauteur (0 en haut)
function _chrStackModel(table, options) {
  var o = options || {};
  var hidden = o.hidden || [];
  var count = table.xs.length;
  var visible = table.series.filter(function(s) { return s.kind !== 'text' && hidden.indexOf(s.key) < 0; });
  var plus = function(v) { return v !== null && v > 0 ? v : 0; };
  var totals = table.xs.map(function(_, i) { return _chrSum(visible.map(function(s) { return plus(s.values[i]); })); });
  var bounds = o.bounds || {};
  var scale = _chrScaleOf(totals, { zero: true, min: bounds.min, max: bounds.max, places: o.places });
  var fractions = _chrXFractions(table.xs, o.kind, true);
  var slot = 1 / Math.max(count, 1);
  var segments = [];
  table.xs.forEach(function(_, i) {
    var base = 0;
    visible.forEach(function(s) {
      var v = plus(s.values[i]);
      if (v === 0) return;
      var top = 1 - _chrRatio(base + v, scale.min, scale.max);
      segments.push({ i: i, key: s.key, color: s.color, value: v, base: base, top: top, height: (1 - _chrRatio(base, scale.min, scale.max)) - top, left: i * slot + slot * 0.14, width: slot * 0.72 });
      base += v;
    });
  });
  return { scale: scale, totals: totals, fractions: fractions, segments: segments };
}

// la grille « jour × heure » de points datés, à l'heure locale : 7 lignes (lundi à dimanche) de 24 colonnes (0 h à 23 h) ; `measure` : count
// (le nombre de points, défaut), sum ou mean de leurs y (une case sans valeur vaut alors null pour mean, 0 pour sum) ; `utc` : cf. _chrDayParts
function _chrWeekHours(points, measure, utc) {
  var sums = [];
  var counts = [];
  for (var d = 0; d < 7; d++) {
    sums.push(new Array(24).fill(0));
    counts.push(new Array(24).fill(0));
  }
  (points || []).forEach(function(p) {
    var stamp = _chrParseX('datetime', p.x);
    var v = measure === 'sum' || measure === 'mean' ? _chrNumber(p.y) : 1;
    if (stamp === null || v === null) return;
    var at = new Date(stamp);
    var day = ((utc ? at.getUTCDay() : at.getDay()) + 6) % 7;
    var hour = utc ? at.getUTCHours() : at.getHours();
    sums[day][hour] += v;
    counts[day][hour]++;
  });
  if (measure === 'mean') return sums.map(function(row, d) { return row.map(function(v, h) { return counts[d][h] ? _chrTidy(v / counts[d][h]) : null; }); });
  return measure === 'sum' ? sums : counts;
}

// l'échelle des niveaux d'intensité (carte, calendrier) : `intervals` intervalles égaux (4, soit cinq niveaux) d'un pas rond (1, 2, 2,5, 3,
// 4, 5, 6 ou 8 fois une puissance de 10) ; la graduation du haut est la plus proche au-dessus de la plus grande valeur (elle atteint le
// dernier niveau), celle du bas ne dépasse pas la plus petite. `min` et `max` sont des bornes imposées, qu'une valeur au-delà élargit ; des
// valeurs toutes égales (ou qui ne diffèrent que par la poussière des flottants) tombent au milieu ; les graduations sont écrites justes
// (_chrSnap), à toute grandeur. Ni valeur ni borne : null. { min, max, step, ticks }
function _chrLevelScale(values, options) {
  var o = options || {};
  var all = _chrNumbers(values).concat(_chrNumbers([o.min, o.max]));
  if (!all.length) return null;
  var span = _chrSpan(all);
  var low = span[0];
  var high = span[1];
  var n = o.intervals || 4;
  if (_chrFlat(low, high)) {
    var pad = low === 0 && high === 0 ? 0.5 : Math.max(Math.abs(low), Math.abs(high)) * 0.1;
    low -= pad;
    high += pad;
  }
  var raw = (high - low) / n;
  var power = Math.pow(10, Math.floor(Math.log10(raw)));
  var step = raw;
  var max = high;
  for (var i = 0; i < 2 * _chrFine.length; i++) {
    step = _chrFine[i % _chrFine.length] * power * (i < _chrFine.length ? 1 : 10);
    step = _chrSnap(step, step);
    max = _chrSnap(Math.ceil(high / step - 1e-9) * step, step);
    if (step >= raw * (1 - 1e-9) && max - n * step <= low + step * 1e-9) break;
  }
  var ticks = [];
  for (var k = n; k >= 0; k--) ticks.push(_chrSnap(max - k * step, step));
  return { min: ticks[0], max: max, step: step, ticks: ticks };
}

// le niveau d'une valeur sur l'échelle des niveaux : sa graduation la plus proche, de 1 à intervals + 1 (une humeur sur une échelle de 1 à 5 :
// son arrondi) ; 0 sans valeur
function _chrLevel(value, scale) {
  var v = _chrNumber(value);
  if (v === null || !scale) return 0;
  return 1 + Math.min(scale.ticks.length - 1, Math.max(0, Math.round((v - scale.min) / scale.step + 1e-9)));
}

// une grille de valeurs (lignes × colonnes, une valeur ou null par case) en cases d'intensité : le niveau de chaque case sur l'échelle des
// niveaux (_chrLevelScale, `classes` intervalles, 4 ; `bounds` : { min, max } imposées), 0 pour une case vide seulement ; `share` : sa place
// sur l'échelle, de 0 à 1. `peak` : la première case la plus haute (null quand tout est vide). { scale, rows, cols, cells: [ { row, col,
// value, level, share } ], peak }
function _chrHeatModel(grid, options) {
  var o = options || {};
  var bounds = o.bounds || {};
  var values = [];
  (grid || []).forEach(function(row) { row.forEach(function(v) { if (_chrNumber(v) !== null) values.push(_chrNumber(v)); }); });
  var scale = _chrLevelScale(values, { intervals: o.classes || 4, min: bounds.min, max: bounds.max });
  var peak = null;
  var cells = [];
  (grid || []).forEach(function(row, r) {
    row.forEach(function(raw, c) {
      var v = _chrNumber(raw);
      if (v !== null && (!peak || v > peak.value)) peak = { row: r, col: c, value: v };
      cells.push({ row: r, col: c, value: v, level: _chrLevel(v, scale), share: v === null ? 0 : _chrRatio(v, scale.min, scale.max) });
    });
  });
  return { scale: scale, rows: (grid || []).length, cols: (grid && grid[0] ? grid[0].length : 0), cells: cells, peak: peak };
}

// la géométrie d'un radar, depuis une table : un axe par colonne (le premier vers le haut, puis dans le sens des aiguilles), un polygone par
// série visible (une valeur absente compte 0), une échelle commune de 0 à la plus grande valeur (`bounds` : { min, max } imposées, de 0 à 100
// pour des parts). `options` : cx, cy, radius (50, 50, 34 : un cadre de 100), gap (11 : l'écart des libellés au bout des axes), hidden. Les
// points sont des chaînes « x,y x,y … » prêtes pour un <polygon> ; un libellé est ancré start à droite du centre, end à gauche, middle
// au milieu. { scale, axes: [ { i, x, y, label: { x, y, anchor } } ], rings: [ { value, points } ], shapes: [ { key, color, points,
// vertices: [ { i, value, x, y } ] } ] }
function _chrRadarModel(table, options) {
  var o = options || {};
  var cx = o.cx === undefined ? 50 : o.cx;
  var cy = o.cy === undefined ? 50 : o.cy;
  var radius = o.radius === undefined ? 34 : o.radius;
  var gap = o.gap === undefined ? 11 : o.gap;
  var n = table.xs.length;
  var hidden = o.hidden || [];
  var visible = table.series.filter(function(s) { return s.kind !== 'text' && hidden.indexOf(s.key) < 0; });
  var bounds = o.bounds || {};
  var all = [];
  visible.forEach(function(s) { all = all.concat(s.values.filter(function(v) { return v !== null; })); });
  var scale = _chrScaleOf(all, { zero: true, min: bounds.min, max: bounds.max });
  var at = function(i, r) {
    var angle = (i * 2 * Math.PI / n) - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  var reach = function(v) { return radius * Math.min(1, Math.max(0, _chrRatio(v === null ? 0 : v, scale.min, scale.max))); };
  var join = function(list) { return list.map(function(p) { return _chrFixed2(p.x) + ',' + _chrFixed2(p.y); }).join(' '); };
  var axes = table.xs.map(function(_, i) {
    var end = at(i, radius);
    var place = at(i, radius + gap);
    return { i: i, x: end.x, y: end.y, label: { x: place.x, y: place.y, anchor: place.x > cx + 2 ? 'start' : (place.x < cx - 2 ? 'end' : 'middle') } };
  });
  var rings = n ? scale.ticks.filter(function(t) { return t > scale.min; }).map(function(t) {
    return { value: t, points: join(table.xs.map(function(_, i) { return at(i, reach(t)); })) };
  }) : [];
  var shapes = visible.map(function(s) {
    var vertices = s.values.map(function(v, i) {
      var p = at(i, reach(v));
      return { i: i, value: v, x: p.x, y: p.y };
    });
    return { key: s.key, color: s.color, points: n ? join(vertices) : '', vertices: vertices };
  });
  return { scale: scale, axes: axes, rings: rings, shapes: shapes };
}

function _chrDayKey(stamp) {
  var d = new Date(stamp);
  return d.getUTCFullYear() + '-' + _chrTwo(d.getUTCMonth() + 1) + '-' + _chrTwo(d.getUTCDate());
}

// un calendrier façon « contributions » : les valeurs de points datés rangées par jour, semaine (du lundi) ou mois ; chaque case porte sa
// moyenne (`measure` : mean, défaut ; sum ; count), son nombre de valeurs et un niveau. Par jour : `columns` colonnes de semaines (26), lignes
// du lundi au dimanche, la dernière colonne étant la semaine de `today` (défaut : le jour du dernier point) ; un jour après `today` est
// `future`. Par semaine ou par mois : les `size` dernières périodes jusqu'à celle de `today` (26 semaines, 12 mois). Les niveaux suivent
// l'échelle des niveaux (_chrLevelScale : `bounds` imposées, `classes` intervalles, 4) : la graduation la plus proche, de 1 à 5 (une humeur
// de 1 à 5 : son arrondi) ; une case sans valeur est au niveau 0. `months` (par jour et par semaine) : les colonnes où un mois commence,
// sans la première quand la deuxième la suit aussitôt ; `utc` : cf. _chrDayParts. { step, scale, cells: [ { from, to, col, row, count, value, level, future } ],
// months: [ { col, month } ] }
function _chrCalendarModel(points, options) {
  var o = options || {};
  var kind = o.kind || 'date';
  var step = o.step === 'week' || o.step === 'month' ? o.step : 'day';
  var measure = o.measure || 'mean';
  var found = new Map();
  var last = null;
  (points || []).forEach(function(p) {
    var y = _chrNumber(p.y);
    var dayOf = _chrPeriodStart(kind, p.x, 'day', o.utc);
    if (dayOf === null || (y === null && measure !== 'count')) return;
    if (last === null || dayOf > last) last = dayOf;
    var start = _chrPeriodStart('date', dayOf, step);
    var cell = found.get(start) || { sum: [], count: 0 };
    if (y !== null) cell.sum.push(y);
    cell.count++;
    found.set(start, cell);
  });
  var today = o.today || last;
  var none = { step: step, scale: null, cells: [], months: [] };
  if (!today || _chrParseX('date', today) === null) return none;
  var day = 86400000;
  var periods = [];
  if (step === 'day') {
    var columns = o.columns || 26;
    var first = _chrParseX('date', _chrPeriodStart('date', today, 'week')) - (columns - 1) * 7 * day;
    for (var k = 0; k < columns * 7; k++) periods.push({ from: _chrDayKey(first + k * day), col: Math.floor(k / 7), row: k % 7 });
    periods.forEach(function(c) { c.to = c.from; });
  }
  else {
    var size = o.size || (step === 'week' ? 26 : 12);
    var end = _chrParseX('date', _chrPeriodStart('date', today, step));
    for (var j = size - 1; j >= 0; j--) {
      var from;
      var to;
      if (step === 'week') {
        from = end - j * 7 * day;
        to = from + 6 * day;
      }
      else {
        var e = new Date(end);
        from = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - j, 1);
        to = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - j + 1, 1) - day;
      }
      periods.push({ from: _chrDayKey(from), to: _chrDayKey(to), col: size - 1 - j, row: 0 });
    }
  }
  var valueOf = function(cell) {
    if (!cell) return null;
    if (measure === 'count') return cell.count;
    if (!cell.sum.length) return null;
    return measure === 'sum' ? _chrSum(cell.sum) : _chrTidy(_chrSum(cell.sum) / cell.sum.length);
  };
  var values = periods.map(function(c) { return valueOf(found.get(c.from)); });
  var present = values.filter(function(v) { return v !== null; });
  var bounds = o.bounds || {};
  var scale = _chrLevelScale(present, { intervals: o.classes || 4, min: bounds.min, max: bounds.max });
  var cells = periods.map(function(c, i) {
    var cell = found.get(c.from);
    return { from: c.from, to: c.to, col: c.col, row: c.row, count: cell ? cell.count : 0, value: values[i], level: _chrLevel(values[i], scale), future: c.from > today };
  });
  var months = [];
  var per = step === 'day' ? 7 : (step === 'week' ? 1 : 0);
  if (per) {
    for (var c = 0; c * per < cells.length; c++) {
      var head = cells[c * per].from.slice(0, 7);
      if (c === 0 || head !== cells[(c - 1) * per].from.slice(0, 7)) months.push({ col: c, month: head + '-01' });
    }
    if (months.length > 1 && months[1].col === 1) months.shift();
  }
  return { step: step, scale: scale, cells: cells, months: months };
}

// un jour de la semaine écrit dans la langue donnée (`day` : 0 pour lundi, 6 pour dimanche ; `style` : long, short, narrow)
function _chrFormatWeekday(day, lang, style) {
  return _chrFormat(lang, { weekday: style || 'short', timeZone: 'UTC' }, true).format(Date.UTC(2026, 9, 19 + Number(day)));
}

// un jour AAAA-MM-JJ écrit dans la langue donnée, selon les options d'Intl (`{ month: 'short' }` : « oct. » ; `{ weekday: 'long', day:
// 'numeric', month: 'long', year: 'numeric' }` : « lundi 5 octobre 2026 »)
function _chrFormatDay(day, lang, options) {
  var stamp = _chrParseX('date', day);
  return stamp === null ? String(day) : _chrFormat(lang, Object.assign({ timeZone: 'UTC' }, options), true).format(stamp);
}

// une heure du jour (0 à 23) écrite dans la langue donnée : « 08 h », « 8 AM »
function _chrFormatHour(hour, lang) {
  return _chrFormat(lang, { hour: 'numeric', timeZone: 'UTC' }, true).format(Date.UTC(2026, 9, 19, Number(hour)));
}

// ADAPTATEUR — les lignes de données d'une application : `rows: [ { id, x, readings: { clé: valeur } } ]`, `series: [ { key, name, unit,
// color, kind } ]`. Il traduit vers la table (fromRows : une colonne par ligne, dans l'ordre des lignes, `cells` porte la ligne elle-même) et
// garde le regroupement par lignes (groupRows : `count` compte les lignes de la période, `id` reste quand elle n'en a qu'une). Il peut changer
// sans toucher à ce qui précède

// la mesure d'une ligne pour une série, null quand la case est vide ou n'est pas un nombre
function _chrReading(row, key) {
  return row && row.readings ? _chrNumber(row.readings[key]) : null;
}

function _chrFromRows(rows, series) {
  return {
    xs: rows.map(function(r) { return r.x; }),
    series: series.map(function(s) {
      var values = rows.map(function(r) {
        if (s.kind !== 'text') return _chrReading(r, s.key);
        var word = r && r.readings ? r.readings[s.key] : null;
        return word === undefined ? null : word;
      });
      return Object.assign({}, s, { values: values, cells: rows });
    })
  };
}

// les lignes regroupées par période : la moyenne de chaque série de nombres (une série de mots ne se moyenne pas, elle disparaît des
// mesures) ; une ligne regroupée garde `count` (les lignes de sa période) et son `id` seulement quand elle n'en regroupe qu'une ; son
// abscisse est le premier jour de la période. `auto`, un pas inconnu ou un axe qui n'est pas le temps : les lignes telles quelles ; `utc` :
// cf. _chrDayParts. { rows, kind, grouped }
function _chrGroupRows(rows, series, kind, step, utc) {
  if (!_chrGrouping(kind, step)) return { rows: rows, kind: kind, grouped: false };
  var numbers = series.filter(function(s) { return s.kind !== 'text'; });
  var grouped = _chrBuckets(rows, kind, step, function(row) { return row.x; }, utc).map(function(bucket) {
    var readings = {};
    numbers.forEach(function(s) {
      var found = bucket.items.map(function(r) { return _chrReading(r, s.key); }).filter(function(v) { return v !== null; });
      if (found.length) readings[s.key] = _chrTidy(_chrSum(found) / found.length);
    });
    return { id: bucket.items.length === 1 ? bucket.items[0].id : null, x: bucket.x, count: bucket.items.length, readings: readings };
  });
  return { rows: grouped, kind: 'date', grouped: true };
}

// les points d'une série tirés des lignes : { x, y, row } pour chaque ligne qui a une mesure (une série de mots : son mot), pour le camembert,
// la carte jour × heure et le calendrier
function _chrPointsOf(rows, key, words) {
  return rows.map(function(r) {
    var raw = r && r.readings ? r.readings[key] : null;
    return { x: r.x, y: words ? (raw === undefined ? null : raw) : _chrReading(r, key), row: r };
  }).filter(function(p) { return p.y !== null; });
}

// l'heure d'une abscisse telle qu'elle s'affiche, rendue en instant UTC (« 2026-10-19T08:15:00.000Z ») : sans `zone`, l'heure écrite, son
// fuseau ignoré, sans conversion ; dans une zone IANA (`Europe/Paris`, `UTC`), l'instant écrit ramené à l'heure de cette zone (sans fuseau
// écrit, l'heure est déjà celle de la zone). Le calcul la lit ensuite en UTC (`utc`) : la même heure au serveur et au navigateur, quels que
// soient leurs fuseaux. Une heure se lit par _chrClock (ISO 8601, Time#to_s, RFC 2822), jamais par Date.parse, dont le résultat change
// d'un moteur à l'autre : un texte qui n'en est pas une (« Oct 19 2026 08:15 », un mois impossible) reste tel quel ; une zone inconnue
// d'Intl lève une RangeError, le module la vérifie avant. Chaque heure ramenée est gardée, par zone et par texte (`_chrWalls`, 20 000 par zone au plus) : un graphique recalculé au survol
// ne refait pas ses heures
function _chrWallTime(text, zone) {
  var kept = _chrWalls[zone || ''] || (_chrWalls[zone || ''] = new Map());
  var out = kept.get(text);
  if (out !== undefined) return out;
  if (kept.size >= 20000) kept.clear();
  out = _chrWallOf(text, zone);
  kept.set(text, out);
  return out;
}

function _chrWallOf(text, zone) {
  var c = _chrClock(text);
  if (c === null) return text;
  return new Date(zone && c[1] !== null ? _chrZoneWall(c[0] - c[1], zone) : c[0]).toISOString();
}

// une heure lue (cf. _chrClockText, _chrMailText) : [ l'heure écrite en millisecondes, comme si elle était UTC ; le décalage de son fuseau
// en millisecondes, null sans fuseau ] ; null quand le texte n'est pas une heure, ou que son mois, son jour, son heure ou son décalage est
// impossible : le 31 novembre, le 30 février, 24:30, 60 secondes, +25:00. « 24:00 », la fin du jour, reste minuit le lendemain
function _chrClock(text) {
  var s = String(text);
  var m = _chrClockText.exec(s);
  var mail = m ? null : _chrMailText.exec(s);
  if (mail) m = [s, mail[3], _chrMonths.indexOf(mail[2].toLowerCase()) / 3 + 1, mail[1], mail[4], mail[5], mail[6], '', mail[7]];
  if (!m) return null;
  var month = +m[2];
  var shift = m[8] ? _chrOffset(m[8]) : null;
  if (!(month >= 1 && month <= 12 && month % 1 === 0) || +m[3] < 1 || (+m[3] > 28 && +m[3] > new Date(Date.UTC(+m[1], month, 0)).getUTCDate()) || +m[4] > 24 || (+m[4] === 24 && /[1-9]/.test(m[5] + (m[6] || '') + (m[7] || ''))) || +m[5] > 59 || +(m[6] || 0) > 59 || (m[8] && shift === null)) return null;
  return [Date.UTC(+m[1], month - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? Number((m[7] + '00').slice(0, 3)) : 0), shift];
}

// l'instant d'une heure écrite (cf. _chrClock), en millisecondes : par son fuseau ; sans fuseau, à l'heure locale de l'écran, comme se lit
// une heure ISO sans fuseau ; null quand le texte n'est pas une heure. Une heure déjà ramenée (cf. _chrWallTime, « 2026-10-19T08:15:00.000Z »)
// a l'écriture exacte que la norme du langage fixe pour Date.parse, lue pareil par tous les moteurs : elle y va droit, plus vite, jusqu'au
// 28 du mois, avant 24 h, minutes et secondes sous 60 (au-delà, un moteur peut passer à la suite : le 30 février devient le 2 mars, 10:00:60
// devient 10:01 ; _chrClock les refuse). Chiffres lus par leur code, sans découper le texte : 50 est « 2 », 52 « 4 », 54 « 6 », 57 « 9 »
function _chrInstant(text) {
  if (typeof text === 'string' && text.length === 24 && text[10] === 'T' && text[23] === 'Z' && (text.charCodeAt(8) < 50 || (text.charCodeAt(8) === 50 && text.charCodeAt(9) < 57)) && (text.charCodeAt(11) < 50 || (text.charCodeAt(11) === 50 && text.charCodeAt(12) < 52)) && text.charCodeAt(14) < 54 && text.charCodeAt(17) < 54) {
    var stamp = Date.parse(text);
    return Number.isNaN(stamp) ? null : stamp;
  }
  var c = _chrClock(text);
  if (c === null) return null;
  if (c[1] !== null) return c[0] - c[1];
  var d = new Date(c[0]);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()).getTime();
}

// le décalage d'un fuseau écrit (Z, UTC, GMT, UT, +02:00, -0700, +02), en millisecondes ; null quand il est impossible (plus de 23 heures,
// plus de 59 minutes : +25:00, +02:60)
function _chrOffset(text) {
  if (!/\d/.test(text)) return 0;
  var digits = text.replace(':', '');
  var hours = Number(digits.slice(1, 3));
  var minutes = Number(digits.slice(3, 5) || 0);
  if (hours > 23 || minutes > 59) return null;
  return (digits[0] === '-' ? -1 : 1) * (hours * 60 + minutes) * 60000;
}

// l'heure qu'affiche un instant dans une zone IANA, rendue en instant UTC (l'heure de la zone lue comme si elle était UTC)
function _chrZoneWall(stamp, zone) {
  var parts = {};
  _chrFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }, true).formatToParts(stamp).forEach(function(p) { parts[p.type] = p.value; });
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second, ((stamp % 1000) + 1000) % 1000);
}

// les statistiques de chaque série visible sur les lignes affichées (déjà filtrées sur la période et regroupées) : _chrSeriesStats de leur table
function _chrRowsStats(rows, series, options) {
  return _chrSeriesStats(_chrFromRows(rows, series), options);
}

µ._mjs_chart = {
  WIDE: _chrWide,
  HIGH: _chrHigh,
  STEPS: _chrSteps,
  number: _chrNumber,
  niceScale: _chrNiceScale,
  scaleOf: _chrScaleOf,
  ratio: _chrRatio,
  parseX: _chrParseX,
  xFractions: _chrXFractions,
  xFractionsAhead: _chrXFractionsAhead,
  nearestIndex: _chrNearestIndex,
  labelPicks: _chrLabelPicks,
  histogramBins: _chrHistogramBins,
  pieShares: _chrPieShares,
  pieParts: _chrPieParts,
  arcPath: _chrArcPath,
  trendFit: _chrTrendFit,
  stats: _chrStats,
  periodStart: _chrPeriodStart,
  groupPoints: _chrGroupPoints,
  formatNumber: _chrFormatNumber,
  axisNumber: _chrAxisNumber,
  statsText: _chrStatsText,
  formatX: _chrFormatX,
  formatPeriod: _chrFormatPeriod,
  tableOf: _chrTableOf,
  plotModel: _chrPlotModel,
  reading: _chrReading,
  fromRows: _chrFromRows,
  groupRows: _chrGroupRows,
  seriesStats: _chrSeriesStats,
  histogramMarks: _chrHistogramMarks,
  stackModel: _chrStackModel,
  weekHours: _chrWeekHours,
  levelScale: _chrLevelScale,
  level: _chrLevel,
  heatModel: _chrHeatModel,
  radarModel: _chrRadarModel,
  calendarModel: _chrCalendarModel,
  formatWeekday: _chrFormatWeekday,
  formatDay: _chrFormatDay,
  formatHour: _chrFormatHour,
  pointsOf: _chrPointsOf,
  rowsStats: _chrRowsStats,
  wallTime: _chrWallTime
};
