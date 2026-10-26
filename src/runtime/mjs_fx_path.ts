// mjs_fx_path — `*path` : la balise suit un tracé, en tournant avec la courbe (un avion sur un
// parcours, une bille sur un fil). Le tracé : `d` (le réglage principal) est soit le NOM d'un tracé tout
// fait — wave, loop, circle, infinity, zigzag, spiral, heart —, soit SON PROPRE tracé, écrit comme
// l'attribut `d` d'un <path> SVG (`*path('M10 100 C 60 20, 100 20, 145 80 S 230 140, 280 60')` : M L H V C S
// Q T A Z, en majuscules ou minuscules), soit, avec `from`, le <path> d'un SVG de la page, par son
// sélecteur CSS (`*path(from: '#trace')`) : son `d` est lu et la balise suit le tracé LÀ OÙ IL EST DESSINÉ
// à l'écran, position et échelle du SVG comprises (translation et échelle ; une rotation ou une
// inclinaison du SVG n'est pas suivie ; `viewbox` n'y compte pas, le SVG a le sien). Sans `from`, les
// unités du tracé sont des pixels depuis le coin du parent positionné de la balise ; avec `viewbox`
// (`'0 0 290 160'`, le repère du tracé écrit dans `d`), le tracé est mis à l'échelle du parent, au
// centre, sans déformation, comme un SVG de même viewBox qui le remplirait ; les tracés tout faits sont
// écrits dans un repère `0 0 290 160` et se comportent ainsi (sans `viewbox`).
// Un tracé illisible : un avertissement qui le cite, la balise ne bouge pas.
// Réglages : duration (un parcours ; 4s), delay (0s), easing (une courbe : un mot CSS, cubic-bezier(…)
// ou une courbe de µeasing en kebab, bounce-out ; linear), rotate (la balise tourne avec la courbe ;
// oui), angle (un décalage de cette rotation, degrés, pour une image qui « regarde » vers le haut ;
// 0), reverse (le parcours à l'envers ; non), alternate (aller-retour : une durée vaut alors un
// aller, un tour complet en dure deux ; non), repeat (le nombre de parcours ; 0 = sans fin), start et
// end (de 0 à 1, la portion du tracé parcourue ; 0 et 1), anchor (le point de la balise posé sur le
// tracé : un mot ou `x% y%` ; center), on (always, hover, view, click, load : un parcours ; scroll :
// l'avancée suit le défilement, dans la bande `zone`), zone.
// Deux techniques : `offset-path` + `offset-distance` (Chromium, Firefox, Safari récents) — le parcours
// est une animation CSS, ses durées sont des variables CSS ; sans `offset-path`, une minuterie
// qui lit un <path> caché (`getPointAtLength`) et pose les propriétés `translate` et `rotate` de la
// balise. Une `transform` de la balise ne se mêle pas au mouvement. « Réduire les animations » : la
// balise reste au point `start`.

var _mjsFxPathN = 0;

// les tracés tout faits, dans un repère 0 0 290 160
var _MJS_FX_PATHS = {
  wave:     'M10 100 C 60 20, 100 20, 145 80 S 230 140, 280 60',
  loop:     'M10 130 C 70 130, 120 120, 140 90 C 165 50, 120 20, 95 50 C 70 85, 130 135, 190 120 C 240 108, 260 70, 280 30',
  circle:   'M30 80 A 115 62 0 1 0 260 80 A 115 62 0 1 0 30 80',
  infinity: 'M145 80 C 190 10, 270 10, 270 80 C 270 150, 190 150, 145 80 C 100 10, 20 10, 20 80 C 20 150, 100 150, 145 80 Z',
  zigzag:   'M10 120 L 55 40 L 100 120 L 145 40 L 190 120 L 235 40 L 280 120',
  spiral:   'M145 80 a 8 8 0 0 1 16 0 a 16 16 0 0 1 -32 0 a 24 24 0 0 1 48 0 a 32 32 0 0 1 -64 0 a 40 40 0 0 1 80 0 a 48 48 0 0 1 -96 0 a 56 56 0 0 1 112 0',
  heart:    'M145 140 C 40 80, 40 20, 90 20 C 120 20, 140 40, 145 55 C 150 40, 170 20, 200 20 C 250 20, 250 80, 145 140 Z'
};

var _MJS_FX_PATH_ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// un tracé `d` mis à l'échelle (sx, sy) puis déplacé (tx, ty), réécrit en commandes absolues ; null
// si le tracé est illisible
function _mjsFxPathMap(d, sx, sy, tx, ty) {
  var src  = String(d);
  var pos  = 0;
  var out  = [];
  var cx   = 0;
  var cy   = 0;
  var mx   = 0;
  var my   = 0;
  var cmd  = '';
  var reNum  = /[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/y;
  var reFlag = /[\s,]*([01])/y;
  var reCmd  = /[\s,]*([MmLlHhVvCcSsQqTtAaZz])/y;
  var reEnd  = /[\s,]*$/y;
  var num = function() {
    reNum.lastIndex = pos;
    var m = reNum.exec(src);
    if (!m) return null;
    pos = reNum.lastIndex;
    return parseFloat(m[1]);
  };
  var flag = function() {
    reFlag.lastIndex = pos;
    var m = reFlag.exec(src);
    if (!m) return null;
    pos = reFlag.lastIndex;
    return parseInt(m[1], 10);
  };
  var X = function(x) { return Math.round((x * sx + tx) * 1000) / 1000; };
  var Y = function(y) { return Math.round((y * sy + ty) * 1000) / 1000; };
  var R = function(v) { return Math.round(v * 1000) / 1000; };
  while (true) {
    reEnd.lastIndex = pos;
    if (reEnd.test(src)) break;
    reCmd.lastIndex = pos;
    var m = reCmd.exec(src);
    if (m) {
      cmd = m[1];
      pos = reCmd.lastIndex;
    }
    else if (cmd === '' || cmd === 'Z' || cmd === 'z') return null;
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    if (out.length === 0 && cmd !== 'M' && cmd !== 'm') return null;
    var up  = cmd.toUpperCase();
    var rel = cmd !== up;
    var ox  = rel ? cx : 0;
    var oy  = rel ? cy : 0;
    if (up === 'Z') {
      out.push('Z');
      cx   = mx;
      cy   = my;
      continue;
    }
    var a = [];
    for (var i = 0; i < _MJS_FX_PATH_ARGS[up]; i++) {
      var v = up === 'A' && (i === 3 || i === 4) ? flag() : num();
      if (v === null) return null;
      a.push(v);
    }
    if (up === 'M') {
      cx = a[0] + ox;
      cy = a[1] + oy;
      mx = cx;
      my = cy;
      out.push('M' + X(cx) + ' ' + Y(cy));
    }
    else if (up === 'L') {
      cx = a[0] + ox;
      cy = a[1] + oy;
      out.push('L' + X(cx) + ' ' + Y(cy));
    }
    else if (up === 'H') {
      cx = a[0] + ox;
      out.push('H' + X(cx));
    }
    else if (up === 'V') {
      cy = a[0] + oy;
      out.push('V' + Y(cy));
    }
    else if (up === 'C') {
      out.push('C' + X(a[0] + ox) + ' ' + Y(a[1] + oy) + ' ' + X(a[2] + ox) + ' ' + Y(a[3] + oy) + ' ' + X(a[4] + ox) + ' ' + Y(a[5] + oy));
      cx = a[4] + ox;
      cy = a[5] + oy;
    }
    else if (up === 'S') {
      out.push('S' + X(a[0] + ox) + ' ' + Y(a[1] + oy) + ' ' + X(a[2] + ox) + ' ' + Y(a[3] + oy));
      cx = a[2] + ox;
      cy = a[3] + oy;
    }
    else if (up === 'Q') {
      out.push('Q' + X(a[0] + ox) + ' ' + Y(a[1] + oy) + ' ' + X(a[2] + ox) + ' ' + Y(a[3] + oy));
      cx = a[2] + ox;
      cy = a[3] + oy;
    }
    else if (up === 'T') {
      out.push('T' + X(a[0] + ox) + ' ' + Y(a[1] + oy));
      cx = a[0] + ox;
      cy = a[1] + oy;
    }
    else {
      out.push('A' + R(Math.abs(a[0] * sx)) + ' ' + R(Math.abs(a[1] * sy)) + ' ' + R(a[2]) + ' ' + a[3] + ' ' + (sx * sy < 0 ? 1 - a[4] : a[4]) + ' ' + X(a[5] + ox) + ' ' + Y(a[6] + oy));
      cx = a[5] + ox;
      cy = a[6] + oy;
    }
  }
  return out.length > 0 ? out.join(' ') : null;
}

// la courbe d'un réglage `easing`, en JavaScript : une fonction de 0 à 1
function _mjsFxPathEase(v) {
  var kw = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
  var b  = typeof v === 'string' ? kw[v] : null;
  if (!b && typeof v === 'string') {
    var m = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(v);
    if (m) b = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  if (b) {
    if (b[0] === b[1] && b[2] === b[3]) return function(t) { return t; };
    var at = function(t, p, q) { return 3 * p * t * (1 - t) * (1 - t) + 3 * q * t * t * (1 - t) + t * t * t; };
    return function(x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0;
      var hi = 1;
      for (var i = 0; i < 24; i++) {
        var mid = (lo + hi) / 2;
        if (at(mid, b[0], b[2]) < x) lo = mid;
        else hi = mid;
      }
      return at((lo + hi) / 2, b[1], b[3]);
    };
  }
  var nom = typeof v === 'string' ? v.replace(/-(\w)/g, function(_, c) { return c.toUpperCase(); }) : '';
  if (nom && µ.easing && typeof µ.easing[nom] === 'function') return µ.easing[nom];
  return function(t) { return t; };
}

// la courbe pour une animation CSS : un mot ou un cubic-bezier tels quels ; une courbe de µeasing
// échantillonnée en `linear(…)`
function _mjsFxPathCssEase(v, ok) {
  if (typeof v !== 'string' || v === '') return 'linear';
  if (/^(?:linear|ease|ease-in|ease-out|ease-in-out)$/.test(v) || /^cubic-bezier\(/.test(v)) return v;
  if (!ok) return 'linear';
  var f = _mjsFxPathEase(v);
  var p = [];
  for (var i = 0; i <= 32; i++) p.push(Math.round(f(i / 32) * 1000) / 1000);
  return 'linear(' + p.join(', ') + ')';
}

µ._mjs_fxDefs.path = {
  css: '[mjs-fx~="path"]{offset-path:var(--mjs-fx-path-d,none);offset-distance:var(--mjs-fx-path-a,0%);offset-rotate:var(--mjs-fx-path-rot,auto);offset-anchor:var(--mjs-fx-path-anchor,50% 50%);animation:var(--mjs-fx-path-go,mjs-fx-path) var(--mjs-path-duration,4s) var(--mjs-fx-path-ease,linear) var(--mjs-path-delay,0s) var(--mjs-fx-path-times,infinite) normal both}'
    + '[mjs-fx~="path"][mjs-fx-path-alt]{animation-name:var(--mjs-fx-path-go,mjs-fx-path-back);animation-duration:calc(2 * var(--mjs-path-duration,4s))}'
    + '[mjs-fx~="path"][mjs-fx-path-mode="js"]{offset-path:none;animation:none}'
    // la mesure du point de départ : la balise posée sur le point 0 0, droite ; une déclaration !important passe devant
    // l'animation sans la couper (`animation: none` la ferait repartir du début à chaque mesure)
    + '[mjs-fx~="path"][mjs-fx-path-cal]{offset-distance:0%!important;offset-rotate:0deg!important}'
    + '@keyframes mjs-fx-path{from{offset-distance:var(--mjs-fx-path-from,0%)}to{offset-distance:var(--mjs-fx-path-to,100%)}}'
    + '@keyframes mjs-fx-path-back{0%{offset-distance:var(--mjs-fx-path-from,0%);offset-rotate:var(--mjs-fx-path-rot,auto)}49.999%{offset-distance:var(--mjs-fx-path-to,100%);offset-rotate:var(--mjs-fx-path-rot,auto)}50%{offset-distance:var(--mjs-fx-path-to,100%);offset-rotate:var(--mjs-fx-path-rot2,auto)}100%{offset-distance:var(--mjs-fx-path-from,0%);offset-rotate:var(--mjs-fx-path-rot2,auto)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="path"][mjs-fx~="path"]{animation:none}}',
  vars: { duration: '', delay: '' },
  map: _mjsFxPathMap,
  shapes: _MJS_FX_PATHS,
  setup: function(el, s) {
    var sup = function(a, b) { try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports(a, b); } catch { return false; } };
    var offset = sup('offset-path', 'path("M0 0")');
    var calm   = µ._mjs_fxCalm();
    var from   = typeof s.from === 'string' && s.from !== '' ? s.from : '';
    var name   = typeof s.d === 'string' && s.d.trim() !== '' ? s.d.trim() : 'wave';
    var shape  = Object.prototype.hasOwnProperty.call(_MJS_FX_PATHS, name) ? _MJS_FX_PATHS[name] : '';
    var vb     = /^\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*$/.exec(typeof s.viewbox === 'string' ? s.viewbox : '');
    var box    = vb && parseFloat(vb[3]) > 0 && parseFloat(vb[4]) > 0 ? [parseFloat(vb[1]), parseFloat(vb[2]), parseFloat(vb[3]), parseFloat(vb[4])] : shape ? [0, 0, 290, 160] : null;
    var anchor = µ._mjs_fxPoint(s.anchor, { x: 0.5, y: 0.5 }) || { x: 0.5, y: 0.5 };
    var a      = typeof s.start === 'number' ? s.start : 0;
    var b      = typeof s.end === 'number' ? s.end : 1;
    var back   = !!s.reverse;
    var f0     = back ? b : a;
    var f1     = back ? a : b;
    var turn   = s.rotate !== false;
    var angle  = typeof s.angle === 'number' ? s.angle : 0;
    var alt    = s.alternate === true;
    var times  = typeof s.repeat === 'number' && s.repeat > 0 ? s.repeat : 0;
    var on     = s.on || 'always';
    var dur    = µ._mjs_fxMs(s.duration, 4000);
    var delay  = µ._mjs_fxMs(s.delay, 0);
    var pct    = function(v) { return Math.round(v * 10000) / 100 + '%'; };
    var set    = function(k, v) { el.style.setProperty('--mjs-fx-path-' + k, v); };
    var mark   = offset ? 'offset' : 'js';
    µ._mjs_dom.setAttribute(el, 'mjs-fx-path-mode', mark);
    var cleanup = [];
    var undo    = function() {
      for (var i = cleanup.length - 1; i >= 0; i--) cleanup[i]();
      cleanup = [];
    };
    var gone = function() {
      undo();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-path-mode');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-path-alt');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-path-cal');
      ['d', 'a', 'rot', 'rot2', 'anchor', 'ease', 'from', 'to', 'go', 'times'].forEach(function(k) { el.style.removeProperty('--mjs-fx-path-' + k); });
    };
    // le parent positionné de la balise : le repère des unités du tracé
    var up = function(n) { return n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode; };
    var framed = function() {
      var n = up(el);
      while (n && n.nodeType === 1 && typeof getComputedStyle === 'function' && getComputedStyle(n).position === 'static') n = up(n); // eslint-disable-line no-unmodified-loop-condition -- garde de présence de getComputedStyle, invariante par construction : la sortie se fait par n, remplacé à chaque tour
      return n && n.nodeType === 1 ? n : document.documentElement;
    };
    var frame = function() {
      var n = framed();
      var r = µ._mjs_dom.getBoundingClientRect(n);
      return n === document.documentElement ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: r.left + n.clientLeft, y: r.top + n.clientTop, w: n.clientWidth, h: n.clientHeight };
    };
    var warn = function(why) {
      µ.warn(µ._mjs_msg('pathStays', { why: why, tag: (el.localName ? ' (<' + el.localName + '>)' : '') }, '*path : {why} — la balise ne bouge pas{tag}'));
    };
    var watch = null;
    // où est le tracé à l'écran : son `d` et sa mise à l'échelle { d, sx, sy, tx, ty }
    var resolve = function() {
      if (from) {
        var root = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
        var node = null;
        try {
          node = root.querySelector(from) || document.querySelector(from);
        }
        catch {}
        if (!node || node.localName !== 'path') {
          warn(µ._mjs_txt('pathMissing', { from: from }, 'le tracé « {from} » n\'existe pas dans votre composant (il faut un <path> SVG)'));
          return null;
        }
        watch = node;
        var m = typeof node.getScreenCTM === 'function' ? node.getScreenCTM() : null;
        return { d: µ._mjs_dom.getAttribute(node, 'd') || '', sx: m ? m.a : 1, sy: m ? m.d : 1, tx: m ? m.e : 0, ty: m ? m.f : 0 };
      }
      var fr = frame();
      if (!box) return { d: s.d, sx: 1, sy: 1, tx: fr.x, ty: fr.y };
      // un parent sans taille : les unités du tracé restent des pixels
      var sized = fr.w > 0 && fr.h > 0;
      var k     = sized ? Math.min(fr.w / box[2], fr.h / box[3]) : 1;
      return { d: shape || s.d, sx: k, sy: k, tx: fr.x + (sized ? (fr.w - box[2] * k) / 2 : 0) - box[0] * k, ty: fr.y + (sized ? (fr.h - box[3] * k) / 2 : 0) - box[1] * k };
    };
    // la rotation : avec la courbe (auto), ou à l'envers quand on remonte le tracé
    var spin = function(backward) { return turn ? (backward ? 'reverse ' : 'auto ') + angle + 'deg' : '0deg'; };
    set('a', pct(a));
    set('anchor', pct(anchor.x) + ' ' + pct(anchor.y));
    set('from', pct(f0));
    set('to', pct(f1));
    set('rot', spin(f0 > f1));
    set('rot2', spin(!(f0 > f1)));
    set('ease', _mjsFxPathCssEase(s.easing, sup('animation-timing-function', 'linear(0, 1)')));
    if (alt && on !== 'scroll') µ._mjs_dom.setAttribute(el, 'mjs-fx-path-alt', '');
    if (times > 0 && on !== 'scroll') set('times', String(times));
    var ease = _mjsFxPathEase(s.easing);
    var apply = null;
    var rebuild = function() {};
    // l'avancée de la balise : un nombre de 0 à 1 le long de la portion parcourue
    var seek = function(p) { apply(f0 + (f1 - f0) * ease(p), f0 > f1); };
    // OFFSET-PATH : le tracé en variable CSS, le parcours une animation CSS
    var build = function() {
      var g = resolve();
      if (!g) return false;
      // la mesure : le point 0 0 du repère de `offset-path`, vu à l'écran
      set('d', 'path("M0 0")');
      µ._mjs_dom.setAttribute(el, 'mjs-fx-path-cal', '');
      var r = µ._mjs_dom.getBoundingClientRect(el);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-path-cal');
      var d = _mjsFxPathMap(g.d, g.sx, g.sy, g.tx - (r.left + anchor.x * r.width), g.ty - (r.top + anchor.y * r.height));
      if (d === null) {
        el.style.removeProperty('--mjs-fx-path-d');
        warn(µ._mjs_txt('pathUnreadable', { d: String(g.d).slice(0, 60) }, 'le tracé « {d} » est illisible'));
        return false;
      }
      set('d', 'path("' + d + '")');
      return true;
    };
    // SANS OFFSET-PATH : un <path> caché et les propriétés `translate` et `rotate`
    var line = null;
    var rest = { x: 0, y: 0 };
    var len  = 0;
    var save = { translate: el.style.translate, rotate: el.style.rotate, origin: el.style.transformOrigin };
    var raf  = 0;
    var place = function(t, backward) {
      if (!line || !len) return;
      var l  = Math.min(len, Math.max(0, t * len));
      var pt = line.getPointAtLength(l);
      el.style.translate = (pt.x - rest.x) + 'px ' + (pt.y - rest.y) + 'px';
      if (!turn) return;
      var p0 = line.getPointAtLength(Math.max(0, l - 1));
      var p1 = line.getPointAtLength(Math.min(len, l + 1));
      var deg = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI + angle + (backward ? 180 : 0);
      el.style.rotate = Math.round(deg * 100) / 100 + 'deg';
    };
    var buildJs = function() {
      var g = resolve();
      if (!g) return false;
      var d = _mjsFxPathMap(g.d, g.sx, g.sy, g.tx, g.ty);
      if (d === null) {
        warn(µ._mjs_txt('pathUnreadable', { d: String(g.d).slice(0, 60) }, 'le tracé « {d} » est illisible'));
        return false;
      }
      if (!line) {
        var ns  = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('mjs-fx-layer', 'path-trace');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
        line = document.createElementNS(ns, 'path');
        svg.appendChild(line);
        document.body.appendChild(svg);
        cleanup.push(function() { svg.remove(); line = null; });
      }
      line.setAttribute('d', d);
      len = typeof line.getTotalLength === 'function' ? line.getTotalLength() : 0;
      // le point de repos de l'ancre : la balise sans translation ni rotation
      el.style.translate = '';
      el.style.rotate = '';
      el.style.transformOrigin = pct(anchor.x) + ' ' + pct(anchor.y);
      var r = µ._mjs_dom.getBoundingClientRect(el);
      rest = { x: r.left + anchor.x * r.width, y: r.top + anchor.y * r.height };
      return true;
    };
    apply = offset ? function(t) { set('a', pct(t)); } : place;
    var ok = offset ? build() : buildJs();
    if (!ok) return function() { gone(); };
    if (!offset) {
      cleanup.push(function() {
        el.style.translate = save.translate;
        el.style.rotate = save.rotate;
        el.style.transformOrigin = save.origin;
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      });
      place(a, false);
    }
    // la mise à jour quand la page change : fenêtre, parent, SVG, tracé réécrit (la première annonce de l'observateur de taille
    // relit la mise en page finale, sans toucher au parcours)
    rebuild = function() {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
      if (offset) build();
      else {
        buildJs();
        if (!running) place(a, false);
      }
    };
    var again = function() { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(rebuild); else rebuild(); };
    window.addEventListener('resize', again);
    cleanup.push(function() { window.removeEventListener('resize', again); });
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(again);
      var pn = up(el);
      if (pn && pn.nodeType === 1) ro.observe(pn);
      if (watch) {
        ro.observe(watch.ownerSVGElement || watch);
      }
      cleanup.push(function() { ro.disconnect(); });
    }
    if (watch && typeof MutationObserver === 'function') {
      var mo = new MutationObserver(again);
      mo.observe(watch, { attributes: true, attributeFilter: ['d', 'transform'] });
      cleanup.push(function() { mo.disconnect(); });
    }
    var running = false;
    if (calm) {
      return function() { gone(); };
    }
    if (on === 'scroll') {
      set('go', 'none');
      // la balise bouge : l'avancée se lit sur son cadre (le parent positionné), qui reste en place
      var stopScroll = µ._mjs_fxScroll(framed(), function(p) { seek(p); }, s.zone);
      return function() {
        stopScroll();
        gone();
      };
    }
    if (offset) {
      var gate = µ._mjs_fxLoop(el, 'path', on);
      return function() {
        gate();
        gone();
      };
    }
    // sans offset-path : la minuterie, mêmes mots que µ._mjs_fxLoop
    var t0 = 0;
    var tick = function(now) {
      raf = 0;
      var e = now - t0 - delay;
      if (e < 0) {
        place(f0, f0 > f1);
        raf = requestAnimationFrame(tick);
        return;
      }
      var cycle = alt ? 2 * dur : dur;
      var turns = on === 'click' || on === 'load' || on === 'success' || on === 'error' ? 1 : times;
      var n = Math.floor(e / cycle);
      if (turns > 0 && n >= turns) {
        place(alt ? f0 : f1, !alt && f0 > f1);
        running = false;
        return;
      }
      var k = (e % cycle) / dur;
      if (k <= 1 || !alt) seek(Math.min(1, k));
      else apply(f1 + (f0 - f1) * ease(k - 1), !(f0 > f1));
      raf = requestAnimationFrame(tick);
    };
    var start = function() {
      if (running) return;
      running = true;
      t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      raf = requestAnimationFrame(tick);
    };
    var halt = function() {
      running = false;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
      place(a, false);
    };
    var turnsAll = times > 0 ? times : 1;
    var stopRun = µ._mjs_fxRun(el, on, function() {
      halt();
      start();
    }, halt, delay + dur * (alt ? 2 : 1) * (on === 'click' || on === 'load' ? 1 : turnsAll) + 50);
    return function() {
      stopRun();
      gone();
    };
  }
};
