// mjs_fx_filter — `*filter` : un atelier de retouche photo, sur une <img> comme sur n'importe quelle
// balise ou composant. Tout passe par la propriété `filter` de la balise : des fonctions CSS quand
// elles suffisent, sinon UN filtre SVG posé dans la même racine que la balise (retiré avec l'effet).
// Trois couches, cumulables : une ambiance (`style`), puis un filtre SVG si l'ambiance en demande un,
// puis les dix réglages fins, enfin l'ombre portée.
// Réglages : style (l'ambiance ou l'effet spécial ; grayscale — mais `none` dès qu'un réglage fin est
// écrit sans style) :
//   ambiances en CSS pur : grayscale, sepia, vintage, noir, warm, cool, vivid, faded, dramatic, blur,
//   invert ; ambiances en filtre SVG (teinte fondue feFlood + feBlend, vignette, grain, trame) :
//   duotone, polaroid, lomo, kodachrome, technicolor, cyberpunk, sunset, night, nightvision, thermal,
//   xray, newsprint, bleach, cross, pastel, matrix ; effets spéciaux (filtre SVG) : posterize,
//   threshold, sharpen, emboss, edges, chromatic, pixelate, grain, halftone, vignette, tiltshift,
//   bloom, ripple, scanlines ; none (les réglages fins seuls).
// amount (la dose de l'ambiance ou de l'effet, de 0 à 1 : 0 = l'image d'origine ; 1 ; ne dose pas les
// réglages fins),
// brightness, contrast, saturate (de 0 à 3, 1 = inchangé), hue (en degrés), grayscale, sepia, invert
// (de 0 à 1), blur (px), opacity (de 0 à 1), shadow (une ombre portée CSS : `0 8px 20px #0008`) —
// les réglages fins, écrits ou non selon le cas ; rien n'est posé pour un réglage non écrit,
// colors (duotone : l'ombre, la lumière ; trois couleurs = tritone, ombres, tons moyens, lumières ;
// [#1b1464, #ffd1e8]),
// levels (posterize ; 4), threshold (threshold ; 0.35), strength (sharpen, emboss, edges, vignette,
// bloom, grain, tiltshift : 1 = le rendu par défaut, la valeur le multiplie ; 1),
// size (pixelate : le pavé, 8 ; halftone : la trame, 10 ; grain : la taille, 1), shift (chromatic,
// en px ; 6), radius (vignette en % ; 40 — bloom en px ; 14), band (tiltshift : la bande nette, en % ;
// 30), frequency (ripple ; 15), scale (ripple ; 40), gap (scanlines, en px ; 4),
// duration (le passage d'un état à l'autre, en CSS pur seulement : un filtre SVG bascule d'un coup ;
// 400ms), easing (ease), on (always ; hover : filtré au survol ; rest : filtré au repos, les vraies
// couleurs au survol ; view : dès l'arrivée à l'écran ; always),
// spot (le diamètre, en px, de la zone sous la souris où la balise se montre SANS son filtre ; 0 : aucune),
// soft (le bord de cette zone, qui s'efface sur cette largeur, en px ; 40), smooth (le retard de la zone
// sur la souris, de 0.01 à 1 : 1 colle à la souris ; 0.2), ring (un cercle borde la zone ; non), color (la
// couleur de ce cercle ; #fff), near (la zone se montre dès que la souris approche de la balise, avant d'y
// entrer, et part d'un coup, sans fondu ; non), parallax (la balise et son double glissent avec la zone, de 0
// à 1 ; 0) — cf. _mjsFxSpot plus bas.
// Une variable (`*filter(brightness: $l)`) suit sur place : la valeur est réécrite, le filtre SVG
// garde son nœud et son id. Le dégradé des teintes de lomo, technicolor, cyberpunk, sunset et cross
// est une image `data:` (feImage) : il demande `img-src data:` dans la politique de sécurité ; sans
// elle, l'image se voit sans teinte dégradée.
// WebKit (Safari, et tous les navigateurs d'iOS) lit en coordonnées de PAGE les x/y des sous-régions de
// primitives et la position des lumières, au lieu de celles de la balise : sans parade une balise s'efface
// dès qu'elle n'est pas au coin de la page. pixelate, tiltshift, halftone (newsprint) et le vignettage
// (vignette, polaroid, lomo, nightvision) y ont donc leur propre construction ; la trame et le vignettage
// y donnent leur lumière en fractions de la boîte (objectBoundingBox). Les autres moteurs gardent le
// filtre d'avant, au pixel près, lumière du vignettage en px comprise. WebKit se reconnaît à son
// fabricant, que l'agent d'utilisateur d'une émulation ne change pas.

// Sections marquées (`// @@ …`, filtrées par le build, bundler/fx-sections.ts) : `spot` (la zone sans filtre : sa lentille, son double, ses
// règles CSS et leur pose), `soft` (son bord), `smooth` (son retard), `ring` (son cercle), `near` (son approche) et `parallax` (sa dérive) ne
// partent que si l'appli écrit le réglage ; tel quel, le fichier porte tout. Ce que fait `*filter` sans rien écrire n'est dans aucune section :
// l'atelier de retouche, la pose et le retrait du filtre, le suivi d'une variable. `soft`, `smooth`, `ring`, `near` et `parallax` n'ont de sens
// qu'avec une zone : leurs sections sont dans celle de `spot`.

var _mjsFxR = function(v) { return Math.round(v * 1000) / 1000; };
var _mjsFxF = function(v) { return Math.round(v * 1e8) / 1e8; };
// le moteur WebKit (cf. µ._mjs_fxWebkit, mjs_fx_toolwebkit.ts)
var _mjsFxWebkit = µ._mjs_fxWebkit;
var _MJS_FX_FILTERS = {
  grayscale: function(t) { return 'grayscale(' + _mjsFxR(t) + ')'; },
  sepia: function(t) { return 'sepia(' + _mjsFxR(t) + ')'; },
  vintage: function(t) { return 'sepia(' + _mjsFxR(.45 * t) + ') contrast(' + _mjsFxR(1 - .08 * t) + ') brightness(' + _mjsFxR(1 + .06 * t) + ') saturate(' + _mjsFxR(1 - .2 * t) + ')'; },
  noir: function(t) { return 'grayscale(' + _mjsFxR(t) + ') contrast(' + _mjsFxR(1 + .45 * t) + ') brightness(' + _mjsFxR(1 - .08 * t) + ')'; },
  warm: function(t) { return 'sepia(' + _mjsFxR(.25 * t) + ') saturate(' + _mjsFxR(1 + .35 * t) + ') hue-rotate(' + _mjsFxR(-8 * t) + 'deg)'; },
  cool: function(t) { return 'saturate(' + _mjsFxR(1 - .15 * t) + ') hue-rotate(' + _mjsFxR(12 * t) + 'deg) brightness(' + _mjsFxR(1 + .04 * t) + ')'; },
  vivid: function(t) { return 'saturate(' + _mjsFxR(1 + .7 * t) + ') contrast(' + _mjsFxR(1 + .12 * t) + ')'; },
  faded: function(t) { return 'contrast(' + _mjsFxR(1 - .22 * t) + ') brightness(' + _mjsFxR(1 + .1 * t) + ') saturate(' + _mjsFxR(1 - .35 * t) + ')'; },
  dramatic: function(t) { return 'contrast(' + _mjsFxR(1 + .4 * t) + ') saturate(' + _mjsFxR(1 + .25 * t) + ') brightness(' + _mjsFxR(1 - .06 * t) + ')'; },
  blur: function(t) { return 'blur(' + _mjsFxR(6 * t) + 'px)'; },
  invert: function(t) { return 'invert(' + _mjsFxR(t) + ')'; }
};

// les ambiances neuves : réglages `adj` (fonctions CSS, ramenées vers l'identité par amount), teinte
// fondue `bl` (mode de fusion, couleur `col` ou dégradé `cols` + angle, opacité), effet `fx`
var _MJS_FX_AMB = {
  polaroid:    { adj: { brightness: 1.08, contrast: .92, saturate: 1.25, sepia: .18 }, bl: { mode: 'soft-light', col: '#f7d9a0', op: .6 }, fx: { name: 'vignette', p: { strength: .35, radius: 60 } } },
  lomo:        { adj: { contrast: 1.35, saturate: 1.5, brightness: 1.15 }, bl: { mode: 'overlay', cols: ['#ff5a1f', '#1a2bff'], angle: 160, op: .35 }, fx: { name: 'vignette', p: { strength: .85, radius: 35 } } },
  kodachrome:  { adj: { saturate: 1.5, contrast: 1.25, sepia: .12, brightness: 1.05 }, bl: { mode: 'overlay', col: '#ffb347', op: .25 } },
  technicolor: { adj: { saturate: 2.2, contrast: 1.2 }, bl: { mode: 'soft-light', cols: ['#00e5ff', '#ff2e63'], angle: 90, op: .6 } },
  cyberpunk:   { adj: { contrast: 1.25, saturate: 1.4, brightness: .95 }, bl: { mode: 'hard-light', cols: ['#ff00c8', '#00e5ff'], angle: 135, op: .5 } },
  sunset:      { adj: { sepia: .25, saturate: 1.5, contrast: 1.1 }, bl: { mode: 'overlay', cols: ['#3b1a78', '#ff8a3d'], angle: 180, op: .85 } },
  night:       { adj: { brightness: .65, contrast: 1.2, saturate: .6 }, bl: { mode: 'multiply', col: '#3a56d4', op: .75 } },
  nightvision: { adj: { grayscale: 1, brightness: 1.5, contrast: 1.25 }, bl: { mode: 'multiply', col: '#5dff5d', op: 1 }, fx: { name: 'vignette', p: { strength: .9, radius: 30 } } },
  thermal:     { fx: { name: 'duotone', colors: ['#1a0b66', '#ff3d00', '#fff27a'] } },
  xray:        { adj: { grayscale: 1, invert: 1, contrast: 1.2 }, bl: { mode: 'multiply', col: '#6ec1ff', op: 1 } },
  newsprint:   { adj: { contrast: 1.2 }, bl: { mode: 'multiply', col: '#e8d7a8', op: 1 }, fx: { name: 'halftone', p: { size: 7 } } },
  bleach:      { adj: { saturate: .35, contrast: 1.5, brightness: 1.2 }, fx: { name: 'grain', p: { amount: .3 } } },
  cross:       { adj: { contrast: 1.3, saturate: 1.4 }, bl: { mode: 'overlay', cols: ['#1aff9c', '#ff3df0'], angle: 160, op: .5 } },
  pastel:      { adj: { brightness: 1.15, contrast: .75, saturate: 1.1 }, bl: { mode: 'screen', col: '#f5d0ff', op: .35 } },
  matrix:      { adj: { grayscale: 1, brightness: .75, contrast: 1.8 }, bl: { mode: 'multiply', col: '#00ff41', op: 1 }, fx: { name: 'scanlines', p: { gap: 4, opacity: .4 } } }
};

// les valeurs de départ de chaque effet spécial (en unités du rendu par défaut)
var _MJS_FX_P = {
  posterize: { levels: 4 },
  threshold: { level: .35 },
  sharpen:   { amount: 1 },
  emboss:    { strength: 1 },
  edges:     { strength: 1 },
  chromatic: { shift: 6 },
  pixelate:  { size: 8 },
  grain:     { amount: .5, size: 1 },
  halftone:  { size: 10 },
  vignette:  { strength: .7, radius: 40 },
  tiltshift: { blur: 8, band: 30 },
  bloom:     { radius: 14, strength: .6 },
  ripple:    { scale: 40, frequency: 15 },
  scanlines: { gap: 4, opacity: .35 },
  duotone:   {}
};

// les réglages de la balise → les paramètres de l'effet spécial (`strength` multiplie le rendu par défaut)
var _MJS_FX_USER = {
  posterize: function(s) { return { levels: s.levels }; },
  threshold: function(s) { return { level: s.threshold }; },
  sharpen:   function(s, k) { return { amount: k }; },
  emboss:    function(s, k) { return { strength: k }; },
  edges:     function(s, k) { return { strength: k }; },
  chromatic: function(s) { return { shift: s.shift }; },
  pixelate:  function(s) { return { size: s.size }; },
  grain:     function(s, k) { return { amount: .5 * k, size: s.size }; },
  halftone:  function(s) { return { size: s.size }; },
  vignette:  function(s, k) { return { strength: Math.min(1, .7 * k), radius: s.radius }; },
  tiltshift: function(s, k) { return { blur: 8 * k, band: s.band }; },
  bloom:     function(s, k) { return { radius: s.radius, strength: Math.min(1, .6 * k) }; },
  ripple:    function(s) { return { scale: s.scale, frequency: s.frequency }; },
  scanlines: function(s) { return { gap: s.gap }; },
  duotone:   function() { return {}; }
};

var _MJS_FX_ADJ   = ['brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'invert', 'blur'];
var _MJS_FX_IDENT = { brightness: 1, contrast: 1, saturate: 1, grayscale: 0, sepia: 0, invert: 0, blur: 0 };
var _MJS_FX_FINE  = ['brightness', 'contrast', 'saturate', 'hue', 'grayscale', 'sepia', 'invert', 'blur', 'opacity', 'shadow'];
var _MJS_FX_LUMA  = '<feColorMatrix type="matrix" values=".2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 0 0 0 1 0"/>';

// une couleur CSS → [r, g, b] (0..255) : `#rgb`, `#rrggbb`, sinon la couleur calculée par le navigateur
// SUR la balise (var() et currentColor y voient ses propres valeurs : une couleur posée sur l'image elle-
// même, que ne verrait pas une sonde du parent ; cf. µ._mjs_fxColorOn, mjs_fx_toolcolor.ts), ramenée en sRGB par un canevas d'un pixel — le
// navigateur la rend dans son espace à elle (oklch(), lab(), color-mix()…), qu'aucune lecture de `rgb(…)` ne voit
function _mjsFxRgb(c, near) {
  var h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (h) {
    var x = h[1].length === 3 ? h[1].replace(/(.)/g, '$1$1') : h[1];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  var seen = µ._mjs_fxColorOn(near, c);
  var m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(seen);
  if (m) return [+m[1], +m[2], +m[3]];
  var cv = document.createElement('canvas');
  var g  = typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
  if (!g || !seen) return [0, 0, 0];
  cv.width  = 1;
  cv.height = 1;
  g.fillStyle = seen;
  g.fillRect(0, 0, 1, 1);
  var d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

// la boîte d'encre de la balise dans WebKit : la région du filtre et la boîte de référence des fractions
// (objectBoundingBox) englobent la bordure, l'ombre de boîte, le contour et ce qui sort des enfants. Les px dont
// elle dépasse la boîte de bordure, de chaque côté ({ l, t, r, b }), dans le repère de la balise (avant sa
// transformation) : le contour, l'ombre (mesurée sur 363 ombres dans WebKit : l'étendue est le flou x 1,4 arrondi
// au pixel supérieur, plus l'étalement ; chaque côté est cette étendue moins ou plus le décalage, arrondi au pixel
// supérieur) et les enfants visibles, lus quand la boîte n'est que mise à l'échelle ou déplacée. Non vus : l'ombre
// de texte, celle d'un enfant, un filtre ou un contour d'enfant.
// Limites : le modèle de l'ombre est juste au pixel CSS près à 1 appareil par pixel CSS ; à deux pixels d'appareil ou
// plus, l'encre peut avoir 1 pixel CSS d'écart sur 1 à 2 % des ombres (la trame ou la lumière y glisse d'autant).
// Une balise tournée, en miroir (scaleX(-1)), sous `zoom` ou dans un ancêtre mis à l'échelle : ses enfants ne sont pas
// comptés (seuls l'ombre et le contour de la balise le sont). L'encre est relue (une fois par image au plus) quand la
// classe ou le style change sur la balise, un enfant ou un ancêtre, quand un enfant est ajouté ou retiré, au survol ou
// au focus, et à chaque image tant qu'une animation ou une transition court ; elle ne l'est pas quand la règle CSS
// change sans qu'aucun attribut ne change (feuille de style modifiée à la main), ni pour une transition qui court sur un ancêtre seulement
function _mjsFxInk(el, rect) {
  var ink = { l: 0, t: 0, r: 0, b: 0 };
  if (typeof getComputedStyle !== 'function') return ink;
  var cs  = getComputedStyle(el);
  var num = function(v) { return parseFloat(v) || 0; };
  var up  = function(l, t, r, b) {
    ink.l = Math.max(ink.l, l);
    ink.t = Math.max(ink.t, t);
    ink.r = Math.max(ink.r, r);
    ink.b = Math.max(ink.b, b);
  };
  var sup = function(v) { return Math.ceil(v - 1e-6); };
  if (cs.outlineStyle && cs.outlineStyle !== 'none' && num(cs.outlineWidth) > 0) {
    var o = num(cs.outlineWidth) + num(cs.outlineOffset);
    up(o, o, o, o);
  }
  var bs = cs.boxShadow;
  if (bs && bs !== 'none') {
    var list = bs.replace(/\([^)]*\)/g, '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (/inset/.test(list[i])) continue;
      var n = (list[i].match(/-?[\d.]+(?:e-?\d+)?px/g) || []).map(num);
      if (n.length < 2) continue;
      var e = sup((n[2] || 0) * 1.4) + (n[3] || 0);
      up(e - n[0], e - n[1], e + n[0], e + n[1]);
    }
  }
  // les enfants : leur boîte se lit à l'écran, le repère de la balise s'en déduit si la transformation n'est qu'une échelle et un déplacement
  var ow = el.offsetWidth;
  var oh = el.offsetHeight;
  if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && (cs.contain || '').indexOf('paint') < 0 && document.createRange) {
    var sx = ow > 0 ? rect.width / ow : 1;
    var sy = oh > 0 ? rect.height / oh : 1;
    var tf = cs.transform;
    var mx = tf && tf !== 'none' ? /^matrix\(([^)]+)\)$/.exec(tf) : null;
    var sure = true;
    if (tf && tf !== 'none') {
      var mv = mx ? mx[1].split(',').map(num) : null;
      // matrix3d ou rotation : la boîte lue à l'écran n'est plus celle du repère de la balise
      sure = !!mv && Math.abs(mv[1]) < 1e-6 && Math.abs(mv[2]) < 1e-6 && Math.abs(mv[0] * ow - rect.width) < 1 && Math.abs(mv[3] * oh - rect.height) < 1;
    }
    else sure = Math.abs(rect.width - ow) < 1 && Math.abs(rect.height - oh) < 1;
    if (sure) {
      var g = document.createRange();
      g.selectNodeContents(el);
      var q = g.getBoundingClientRect();
      if (q.width || q.height) up((rect.left - q.left) / sx, (rect.top - q.top) / sy, (q.right - rect.right) / sx, (q.bottom - rect.bottom) / sy);
    }
  }
  // WebKit arrondit chaque côté de l'encre au pixel supérieur
  for (var k in ink) ink[k] = Math.max(0, sup(ink[k]));
  return ink;
}

// `def` surchargé par les valeurs de `over` qui existent
function _mjsFxMerge(def, over) {
  var out = {};
  for (var k in def) out[k] = def[k];
  if (over) {
    for (var k2 in over) {
      if (over[k2] !== void 0 && over[k2] !== null && !(typeof over[k2] === 'number' && isNaN(over[k2]))) out[k2] = over[k2];
    }
  }
  return out;
}

// les trois canaux d'un feComponentTransfer avec les mêmes attributs
function _mjsFxFuncs(attrs) {
  return '<feFuncR ' + attrs + '/><feFuncG ' + attrs + '/><feFuncB ' + attrs + '/>';
}

// un effet dosé par mélange avec l'image d'origine (1 = l'effet seul)
function _mjsFxMix(prims, t) {
  if (t < 1) prims.push('<feComposite in2="SourceGraphic" operator="arithmetic" k1="0" k2="' + _mjsFxR(t) + '" k3="' + _mjsFxR(1 - t) + '" k4="0"/>');
  return prims;
}

// la bande d'un bord que le pixellisé ne couvre pas, `n` px au bout de l'axe `x` ou `y` d'une boîte `w` × `h` : le
// pavé qui la touche, décalé de la largeur de la bande, n'en garde que la bande (un aplat de ses dimensions, posé au
// bord) et passe sous le pixellisé, qui garde tout le reste tel quel. Un décalage et un aplat : sans `x`/`y` de
// sous-région, que WebKit lit en coordonnées de page. Une rangée ne reçoit ainsi que la couleur de son propre pavé.
// `ik` : ce que la boîte d'encre dépasse la balise (WebKit), le bord de la balise y est décalé d'autant
function _mjsFxEdge(src, axis, n, w, h, out, ik) {
  var x  = axis === 'x';
  var d  = x ? 'dx' : 'dy';
  var id = 'fx-e' + axis;
  var bw = w + ik.l + ik.r;
  var bh = h + ik.t + ik.b;
  return [
    '<feOffset in="' + src + '" ' + d + '="' + n + '" width="' + bw + '" height="' + bh + '" result="' + id + '"/>',
    '<feFlood flood-color="#000" width="' + (x ? n + 1 : bw) + '" height="' + (x ? bh : n + 1) + '"/>',
    '<feOffset ' + d + '="' + ((x ? w + ik.l : h + ik.t) - n) + '" width="' + bw + '" height="' + bh + '"/>',
    '<feComposite in="' + id + '" operator="in" result="' + id + 'b"/>',
    '<feMerge' + (out ? ' result="' + out + '"' : '') + '><feMergeNode in="' + id + 'b"/><feMergeNode in="' + src + '"/></feMerge>'
  ];
}

// les effets spéciaux : des primitives SVG (le premier lit SourceGraphic, les suivants le résultat
// précédent) ; `p` = paramètres, `t` = amount, `box` = taille de la balise en px (vignette, tiltshift)
var _MJS_FX_BUILD = {
  posterize: function(p, t) {
    var v = [];
    for (var i = 0; i < p.levels; i++) v.push(_mjsFxR(i / (p.levels - 1)));
    return _mjsFxMix(['<feComponentTransfer>' + _mjsFxFuncs('type="discrete" tableValues="' + v.join(' ') + '"') + '</feComponentTransfer>'], t);
  },
  threshold: function(p, t) {
    return _mjsFxMix([_MJS_FX_LUMA, '<feComponentTransfer>' + _mjsFxFuncs('type="linear" slope="120" intercept="' + _mjsFxR(-120 * p.level) + '"') + '</feComponentTransfer>'], t);
  },
  duotone: function(p, t) {
    var tab = function(i) { return p.cols.map(function(c) { return _mjsFxR(c[i] / 255); }).join(' '); };
    return _mjsFxMix([_MJS_FX_LUMA, '<feComponentTransfer><feFuncR type="table" tableValues="' + tab(0) + '"/><feFuncG type="table" tableValues="' + tab(1) + '"/><feFuncB type="table" tableValues="' + tab(2) + '"/></feComponentTransfer>'], t);
  },
  sharpen: function(p, t) {
    var a = _mjsFxR(p.amount * t);
    return ['<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 ' + _mjsFxR(-a) + ' 0 ' + _mjsFxR(-a) + ' ' + _mjsFxR(1 + 4 * a) + ' ' + _mjsFxR(-a) + ' 0 ' + _mjsFxR(-a) + ' 0"/>'];
  },
  emboss: function(p, t) {
    var s = p.strength;
    var k = [-s, -s, 0, -s, 0, s, 0, s, s].map(_mjsFxR).join(' ');
    return _mjsFxMix(['<feColorMatrix type="saturate" values="0"/>', '<feConvolveMatrix order="3" preserveAlpha="true" divisor="1" bias="0.5" kernelMatrix="' + k + '"/>'], t);
  },
  edges: function(p, t) {
    var s = p.strength;
    var k = [-s, -s, -s, -s, 8 * s, -s, -s, -s, -s].map(_mjsFxR).join(' ');
    return _mjsFxMix(['<feColorMatrix type="saturate" values="0"/>', '<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="' + k + '"/>'], t);
  },
  chromatic: function(p, t) {
    var s = _mjsFxR(p.shift * t);
    return [
      '<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="fx-r"/>',
      '<feOffset in="fx-r" dx="' + _mjsFxR(-s) + '" dy="0" result="fx-ro"/>',
      '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="fx-g"/>',
      '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="fx-b"/>',
      '<feOffset in="fx-b" dx="' + s + '" dy="0" result="fx-bo"/>',
      '<feBlend in="fx-ro" in2="fx-g" mode="screen" result="fx-rg"/>',
      '<feBlend in="fx-rg" in2="fx-bo" mode="screen"/>'
    ];
  },
  // pixellisation : un pixel d'échantillon au centre de chaque pavé (feFlood d'un pixel, répété par
  // feTile), gardé de l'image par feComposite, puis étalé sur tout le pavé par feMorphology. WebKit
  // lisant le x/y du pixel en coordonnées de page, il y naît à l'origine du pavé et feOffset le pose
  // au centre. Quand le pavé ne divise pas la boîte, le dernier pavé de la rangée et de la colonne est
  // partiel ; son centre sort de la boîte s'il fait moins que la moitié d'un pavé, et sans échantillon
  // il restait transparent : sa bande prend la couleur du pavé qui la touche (cf. _mjsFxEdge)
  pixelate: function(p, t, box) {
    var s  = Math.max(2, Math.round(p.size));
    var c  = Math.floor(s / 2);
    var w  = box.w || 0;
    var h  = box.h || 0;
    var rx = w % s;
    var ry = h % s;
    var gx = rx > 0 && rx <= c;
    var gy = ry > 0 && ry <= c;
    var ik = _mjsFxWebkit && box.ink || { l: 0, t: 0, r: 0, b: 0 };
    var cp = '<feComposite width="' + s + '" height="' + s + '"/>';
    // WebKit : l'échantillon est posé dans son pavé, puis répété ; la grille part de la balise, que la boîte d'encre dépasse de `ik`
    var up = _mjsFxWebkit
      ? ['<feFlood width="1" height="1"/>', cp, '<feOffset dx="' + (c + ik.l) % s + '" dy="' + (c + ik.t) % s + '" width="' + s + '" height="' + s + '"/>', '<feTile result="fx-a"/>']
      : ['<feFlood x="' + c + '" y="' + c + '" width="1" height="1"/>', cp, '<feTile result="fx-a"/>'];
    var prims = up.concat([
      '<feComposite in="SourceGraphic" in2="fx-a" operator="in"/>',
      '<feMorphology operator="dilate" radius="' + c + '"' + (gx || gy ? ' result="fx-p"' : '') + '/>'
    ]);
    if (gx) prims = prims.concat(_mjsFxEdge('fx-p', 'x', rx, w, h, gy ? 'fx-q' : '', ik));
    if (gy) prims = prims.concat(_mjsFxEdge(gx ? 'fx-q' : 'fx-p', 'y', ry, w, h, '', ik));
    return _mjsFxMix(prims, t);
  },
  grain: function(p, t) {
    var a = _mjsFxR(p.amount * t);
    return [
      '<feTurbulence type="fractalNoise" baseFrequency="' + _mjsFxR(.9 / p.size) + '" numOctaves="2" seed="3" result="fx-n"/>',
      '<feColorMatrix in="fx-n" type="saturate" values="0" result="fx-g"/>',
      '<feComposite in="fx-g" in2="SourceGraphic" operator="arithmetic" k1="0" k2="' + a + '" k3="1" k4="' + _mjsFxR(-a / 2) + '"/>',
      '<feComposite in2="SourceAlpha" operator="in"/>'
    ];
  },
  // la trame : le gris flouté de l'image + des pavés où un point de lumière tombe du centre (un
  // éclairage diffus, répété par feTile) ; un fort contraste n'en garde que des points noirs. WebKit
  // lisant la position de la lumière en coordonnées de page, le pavé et la lumière y sont donnés en
  // fractions de la boîte (primitiveUnits objectBoundingBox) ; le flou y reste en px : WebKit ne met pas
  // l'écart-type à l'échelle. WebKit arrondit le pavé vers l'extérieur, au pixel de l'appareil : de l'origine
  // de la balise (souvent fractionnaire) au bout du pavé, un pavé de `s` px en fait `s` + 1 dès que l'origine
  // ou la largeur n'est pas entière, et la période est fausse. Le pavé est donné de `0,9 / dpr` px en dessous
  // de `s` : arrondi, il fait `s` à toute origine fractionnaire jusqu'à neuf dixièmes de pixel d'appareil. La
  // fraction se calcule sur la taille sans arrondi de la boîte (`box.fw`, `box.fh`) quand elle est connue
  halftone: function(p, t, box) {
    var s  = Math.max(2, Math.round(p.size));
    var z  = _mjsFxR(.2887 * s);
    var ik = box.ink || { l: 0, t: 0, r: 0, b: 0 };
    var bw = (box.fw || box.w || 100) + ik.l + ik.r;
    var bh = (box.fh || box.h || 100) + ik.t + ik.b;
    var dp = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    // le pavé naît à l'origine de la boîte d'encre : décalé de ce qu'elle dépasse la balise, modulo le pavé, il tombe aux mêmes places de la balise
    var px = ik.l % s;
    var py = ik.t % s;
    var tw = _mjsFxWebkit ? _mjsFxF((s - .9 / dp) / bw) : s;
    var th = _mjsFxWebkit ? _mjsFxF((s - .9 / dp) / bh) : s;
    var lx = _mjsFxWebkit ? _mjsFxF((px + s / 2) / bw) : s / 2;
    var ly = _mjsFxWebkit ? _mjsFxF((py + s / 2) / bh) : s / 2;
    var lz = _mjsFxWebkit ? _mjsFxF(z / Math.sqrt((bw * bw + bh * bh) / 2)) : z;
    var xy = _mjsFxWebkit ? (px || py ? 'x="' + _mjsFxF(px / bw) + '" y="' + _mjsFxF(py / bh) + '" ' : '') : 'x="0" y="0" ';
    return _mjsFxMix([
      '<feColorMatrix type="matrix" values=".1276 .4291 .0433 0 0 .1276 .4291 .0433 0 0 .1276 .4291 .0433 0 0 0 0 0 0 1"/>',
      '<feGaussianBlur stdDeviation="' + _mjsFxR(s * .22) + '" result="fx-g"/>',
      '<feFlood flood-color="#000" ' + xy + 'width="' + tw + '" height="' + th + '" result="fx-f"/>',
      '<feDiffuseLighting in="fx-f" ' + xy + 'width="' + tw + '" height="' + th + '" surfaceScale="0" diffuseConstant="1" lighting-color="#fff" result="fx-l"><fePointLight x="' + lx + '" y="' + ly + '" z="' + lz + '"/></feDiffuseLighting>',
      '<feTile in="fx-l" result="fx-t"/>',
      '<feComponentTransfer in="fx-t" result="fx-d">' + _mjsFxFuncs('type="linear" slope="-1" intercept="1"') + '</feComponentTransfer>',
      '<feComposite in="fx-g" in2="fx-d" operator="arithmetic" k1="-1" k2="1" k3="1" k4="0"/>',
      '<feComponentTransfer>' + _mjsFxFuncs('type="linear" slope="10" intercept="-4.5"') + '</feComponentTransfer>',
      '<feComposite in2="SourceAlpha" operator="in"/>'
    ], t);
  },
  // le vignettage : un éclairage diffus depuis le centre (circulaire), remis en forme par une table
  // (clair jusqu'au rayon, puis de plus en plus sombre jusqu'aux coins), multiplié sur l'image. La
  // lumière est au centre de la balise, en px ; WebKit la lit en coordonnées de page, elle y est donnée en
  // fractions de la boîte (primitiveUnits objectBoundingBox) : au centre, sa hauteur en px divisée par la
  // racine de (largeur² + hauteur²) / 2. Cette boîte englobe ce qui déborde (ombre, contour, enfant sorti) et
  // décentre la lumière : les autres moteurs gardent les px, qui la tiennent au centre de la balise
  vignette: function(p, t, box) {
    var w   = box.w || 100;
    var h   = box.h || 100;
    var ik  = box.ink || { l: 0, t: 0, r: 0, b: 0 };
    var rc  = Math.sqrt(w * w + h * h) / 2;
    var z   = .3 * rc;
    var R   = p.radius / 100;
    var st  = Math.min(1, p.strength * t);
    var tab = [];
    for (var i = 0; i < 64; i++) {
      var l  = i / 63;
      var rn = l <= 0 ? 9 : z * Math.sqrt(1 / (l * l) - 1) / rc;
      tab.push(_mjsFxR(1 - st * Math.min(1, Math.max(0, (rn - R) / (1 - R || 1)))));
    }
    var light = _mjsFxWebkit
      ? '<fePointLight x="' + _mjsFxF((ik.l + w / 2) / (w + ik.l + ik.r)) + '" y="' + _mjsFxF((ik.t + h / 2) / (h + ik.t + ik.b)) + '" z="' + _mjsFxF(_mjsFxR(z) / Math.sqrt(((w + ik.l + ik.r) * (w + ik.l + ik.r) + (h + ik.t + ik.b) * (h + ik.t + ik.b)) / 2)) + '"/>'
      : '<fePointLight x="' + _mjsFxR(w / 2) + '" y="' + _mjsFxR(h / 2) + '" z="' + _mjsFxR(z) + '"/>';
    return [
      '<feDiffuseLighting in="SourceAlpha" surfaceScale="0" diffuseConstant="1" lighting-color="#fff" result="fx-l">' + light + '</feDiffuseLighting>',
      '<feComponentTransfer in="fx-l" result="fx-m">' + _mjsFxFuncs('type="table" tableValues="' + tab.join(' ') + '"') + '</feComponentTransfer>',
      '<feBlend in="SourceGraphic" in2="fx-m" mode="multiply"/>',
      '<feComposite in2="SourceAlpha" operator="in"/>'
    ];
  },
  // tilt-shift : l'image nette dans une bande horizontale, floue au-dessus et au-dessous ; le masque
  // est la bande, élargie d'une fois et demie le flou, puis adoucie (son bord est à mi-pente). WebKit
  // lisant le y de la bande en coordonnées de page, elle y naît en haut de la balise et feOffset la
  // descend, aux lignes entières que les autres moteurs donnent à une bande (en dessous pour le haut,
  // au-dessus pour le bas)
  tiltshift: function(p, t, box) {
    var w  = box.w || 100;
    var h  = box.h || 100;
    var sg = Math.max(2, h * .08);
    var y0 = h * (50 - p.band / 2) / 100 - 1.5 * sg;
    var hb = h * p.band / 100 + 3 * sg;
    var up = Math.max(0, Math.floor(_mjsFxR(y0)));
    var dn = Math.min(h, Math.ceil(_mjsFxR(y0) + _mjsFxR(hb)));
    var xy = _mjsFxWebkit ? '' : 'x="0" y="0" ';
    // WebKit : la bande naît en haut de la boîte d'encre, qui dépasse la balise de `ik` : elle y est décalée d'autant
    var ik = _mjsFxWebkit && box.ink || { l: 0, t: 0, r: 0, b: 0 };
    var bw = _mjsFxR(w + ik.l + ik.r);
    var bh = _mjsFxR(h + ik.t + ik.b);
    var bd = _mjsFxWebkit
      ? '<feFlood flood-color="#fff" width="' + _mjsFxR(w) + '" height="' + (dn - up) + '"/><feOffset ' + (ik.l ? 'dx="' + ik.l + '" ' : '') + 'dy="' + (up + ik.t) + '" width="' + bw + '" height="' + bh + '" result="fx-b"/>'
      : '<feFlood flood-color="#fff" x="0" y="' + _mjsFxR(y0) + '" width="' + _mjsFxR(w) + '" height="' + _mjsFxR(hb) + '" result="fx-b"/>';
    return [
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + _mjsFxR(p.blur * t) + '" result="fx-bl"/>',
      bd,
      '<feGaussianBlur in="fx-b" stdDeviation="0 ' + _mjsFxR(sg) + '" ' + xy + 'width="' + bw + '" height="' + bh + '" result="fx-m"/>',
      '<feComposite in="SourceGraphic" in2="fx-m" operator="in" result="fx-s"/>',
      '<feComposite in="fx-bl" in2="fx-m" operator="out" result="fx-o"/>',
      '<feMerge><feMergeNode in="fx-o"/><feMergeNode in="fx-s"/></feMerge>'
    ];
  },
  bloom: function(p, t) {
    return [
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + p.radius + '" result="fx-bl"/>',
      '<feComponentTransfer in="fx-bl" result="fx-gl"><feFuncR type="linear" slope="1.3"/><feFuncG type="linear" slope="1.3"/><feFuncB type="linear" slope="1.3"/><feFuncA type="linear" slope="' + _mjsFxR(p.strength * t) + '"/></feComponentTransfer>',
      '<feBlend in="fx-gl" in2="SourceGraphic" mode="screen"/>'
    ];
  },
  ripple: function(p, t) {
    return [
      '<feTurbulence type="fractalNoise" baseFrequency="' + _mjsFxR(p.frequency / 1000) + '" numOctaves="2" seed="2" result="fx-t"/>',
      '<feDisplacementMap in="SourceGraphic" in2="fx-t" scale="' + _mjsFxR(p.scale * t) + '" xChannelSelector="R" yChannelSelector="G"/>'
    ];
  },
  // les lignes : un trait d'un pixel par pavé de `gap` px, répété par feTile, posé sur l'image. x/y à 0 hors
  // WebKit : sans eux la sous-région prend la région du filtre, négative dès qu'une ombre ou un enfant déborde ;
  // WebKit ne les lit pas à sa place
  scanlines: function(p, t, box) {
    var xy = _mjsFxWebkit ? '' : 'x="0" y="0" ';
    // WebKit : le trait naît en haut de la boîte d'encre, un décalage le ramène aux lignes de la balise
    var py = _mjsFxWebkit && box.ink ? box.ink.t % p.gap : 0;
    return [
      '<feFlood flood-color="#000" flood-opacity="' + _mjsFxR(p.opacity * t) + '" ' + xy + 'width="' + p.gap + '" height="1"/>',
      '<feComposite width="' + p.gap + '" height="' + p.gap + '"/>',
      py ? '<feOffset dy="' + _mjsFxR(py) + '" width="' + p.gap + '" height="' + p.gap + '"/>' : '',
      '<feTile result="fx-sl"/>',
      '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="fx-sl"/></feMerge>'
    ];
  }
};

// un dégradé (angle CSS : 180 = de haut en bas) en image SVG, pour feImage
function _mjsFxGradient(c1, c2, angle) {
  var a  = angle * Math.PI / 180;
  var sn = Math.sin(a);
  var cs = Math.cos(a);
  var h  = (Math.abs(sn) + Math.abs(cs)) / 2;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="' + _mjsFxR(.5 - sn * h) + '" y1="' + _mjsFxR(.5 + cs * h) + '" x2="' + _mjsFxR(.5 + sn * h) + '" y2="' + _mjsFxR(.5 - cs * h) + '"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// la teinte fondue d'une ambiance : une couleur (ou un dégradé) fondue sur l'image par un mode de fusion,
// là où l'image existe
function _mjsFxTint(bl, t, base) {
  var op = _mjsFxR(bl.op * t);
  var out;
  if (bl.cols) {
    out = [
      '<feImage href="' + _mjsFxGradient(bl.cols[0], bl.cols[1], bl.angle) + '" preserveAspectRatio="none" result="fx-tf"/>',
      '<feComponentTransfer in="fx-tf"><feFuncA type="linear" slope="' + op + '"/></feComponentTransfer>',
      '<feComposite in2="SourceAlpha" operator="in" result="fx-tc"/>'
    ];
  }
  else {
    out = [
      '<feFlood flood-color="' + bl.col + '" flood-opacity="' + op + '" result="fx-tf"/>',
      '<feComposite in="fx-tf" in2="SourceAlpha" operator="in" result="fx-tc"/>'
    ];
  }
  out.push('<feBlend in="fx-tc" in2="' + base + '" mode="' + bl.mode + '"/>');
  return out;
}

// les fonctions CSS des réglages fins (`written` : au moins un est écrit) et l'ombre portée
function _mjsFxFine(s) {
  var p = [];
  var n = function(k) { return _mjsFxR(+s[k]); };
  var w = function(k) { return s[k] !== void 0 && s[k] !== null; };
  if (w('brightness')) p.push('brightness(' + n('brightness') + ')');
  if (w('contrast')) p.push('contrast(' + n('contrast') + ')');
  if (w('saturate')) p.push('saturate(' + n('saturate') + ')');
  if (w('hue')) p.push('hue-rotate(' + n('hue') + 'deg)');
  if (w('grayscale')) p.push('grayscale(' + n('grayscale') + ')');
  if (w('sepia')) p.push('sepia(' + n('sepia') + ')');
  if (w('invert')) p.push('invert(' + n('invert') + ')');
  if (w('blur')) p.push('blur(' + n('blur') + 'px)');
  if (w('opacity')) p.push('opacity(' + n('opacity') + ')');
  if (w('shadow') && String(s.shadow).trim() !== '') p.push('drop-shadow(' + String(s.shadow).trim() + ')');
  return p.join(' ');
}

// le plan d'un rendu : `pre` (fonctions CSS de l'ambiance, avant le filtre SVG), `prims` (le filtre SVG,
// '' s'il n'en faut pas), `post` (réglages fins, ombre), `box` (vrai si la taille de la balise compte),
// `units` (primitiveUnits du filtre SVG : objectBoundingBox quand une lumière est en fractions de la boîte, WebKit
// seulement ; '' pour des px)
function _mjsFxPlan(el, s, box) {
  var written = false;
  for (var i = 0; i < _MJS_FX_FINE.length; i++) {
    if (s[_MJS_FX_FINE[i]] !== void 0 && s[_MJS_FX_FINE[i]] !== null) written = true;
  }
  var style = s.style !== void 0 && s.style !== null ? s.style : (written ? 'none' : 'grayscale');
  var t     = s.amount === void 0 || s.amount === null || isNaN(+s.amount) ? 1 : Math.min(1, Math.max(0, +s.amount));
  var plan  = { pre: '', prims: '', post: _mjsFxFine(s), box: false, units: '' };
  var fx    = null;
  var tint  = null;
  var pre   = [];
  if (style === 'none') return plan;
  if (_MJS_FX_FILTERS[style]) {
    plan.pre = _MJS_FX_FILTERS[style](t);
    return plan;
  }
  var amb = _MJS_FX_AMB[style];
  if (amb) {
    for (var j = 0; j < _MJS_FX_ADJ.length; j++) {
      var k = _MJS_FX_ADJ[j];
      if (!amb.adj || amb.adj[k] === void 0) continue;
      var v = _mjsFxR(_MJS_FX_IDENT[k] + (amb.adj[k] - _MJS_FX_IDENT[k]) * t);
      pre.push(k + '(' + v + (k === 'blur' ? 'px' : '') + ')');
    }
    plan.pre = pre.join(' ');
    if (t <= 0) return plan;
    if (amb.fx) {
      var cols = amb.fx.colors;
      fx = { name: amb.fx.name, p: _mjsFxMerge(_MJS_FX_P[amb.fx.name], amb.fx.p) };
      if (cols) fx.p.cols = cols.map(function(c) { return _mjsFxRgb(c, el); });
    }
    tint = amb.bl || null;
  }
  else if (_MJS_FX_BUILD[style]) {
    if (t <= 0) return plan;
    var k2 = s.strength === void 0 || s.strength === null || isNaN(+s.strength) ? 1 : +s.strength;
    fx = { name: style, p: _mjsFxMerge(_MJS_FX_P[style], _MJS_FX_USER[style](s, k2)) };
    if (style === 'duotone') {
      var c = Array.isArray(s.colors) ? s.colors : [];
      var l = c.length >= 3 ? [c[0], c[1], c[2]] : c.length === 2 ? [c[0], c[1]] : ['#1b1464', '#ffd1e8'];
      fx.p.cols = l.map(function(x) { return _mjsFxRgb(x, el); });
    }
  }
  else {
    plan.pre = _MJS_FX_FILTERS.grayscale(t);
    return plan;
  }
  var prims = [];
  if (fx) {
    prims = _MJS_FX_BUILD[fx.name](fx.p, t, box);
    var wk = _mjsFxWebkit && (fx.name === 'halftone' || fx.name === 'vignette');
    if (fx.name === 'vignette' || fx.name === 'tiltshift' || fx.name === 'pixelate' || wk || _mjsFxWebkit && fx.name === 'scanlines') plan.box = true;
    if (wk) plan.units = 'objectBoundingBox';
  }
  if (tint) {
    if (prims.length) prims[prims.length - 1] = prims[prims.length - 1].replace(/^<(\w+)/, '<$1 result="fx-out"');
    prims = prims.concat(_mjsFxTint(tint, t, prims.length ? 'fx-out' : 'SourceGraphic'));
  }
  plan.prims = prims.join('');
  return plan;
}

// le <svg> du filtre, posé dans la même racine que la balise (un `url(#…)` ne sort jamais de son
// shadow root)
function _mjsFxHolder(el, id) {
  var svg = µ._mjs_fxSvgDefs(el);
  svg.innerHTML = '<filter id="' + id + '" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1"></filter>';
  var f = svg.firstChild;
  return { svg: svg, filter: f };
}

var _mjsFxFilN = 0;

// les racines (document ou shadow root) qui portent des balises filtrées de WebKit, chacune avec UN observateur
// partagé : un changement de classe ou de style sur un nœud, ou le survol d'un nœud, relit l'encre des seules
// balises filtrées que ce nœud contient (celles de la racine, et celles des shadow roots dont l'hôte est dans le nœud)
var _mjsFxInkRoots = typeof WeakMap === 'function' ? new WeakMap() : null;

function _mjsFxInkMake(root) {
  var st   = { root: root, loc: new Map(), hosts: new Map(), mo: null, off: null };
  var wake = function(node) {
    if (st.loc.size && node.querySelectorAll) {
      var list = µ._mjs_dom.querySelectorAll(node, '[mjs-fx~="filter"]');
      for (var i = 0; i < list.length; i++) {
        var f = st.loc.get(list[i]);
        if (f && list[i] !== node) f();
      }
    }
    st.hosts.forEach(function(set, host) {
      if (µ._mjs_dom.contains(node, host)) set.forEach(function(f) { f(); });
    });
  };
  st.mo = new MutationObserver(function(recs) {
    var seen = new Set();
    for (var i = 0; i < recs.length; i++) {
      if (seen.has(recs[i].target)) continue;
      seen.add(recs[i].target);
      wake(recs[i].target);
    }
  });
  st.mo.observe(root, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
  // le survol d'un ancêtre : seuls les nœuds dont l'état de survol change (ceux qui ne contiennent pas l'autre bout du mouvement)
  var over = function(e) {
    var rel = e.relatedTarget;
    for (var a = e.target; a && a.nodeType === 1; a = a.parentNode) {
      if (rel && µ._mjs_dom.contains(a, rel)) break;
      wake(a);
    }
  };
  µ._mjs_dom.addEventListener(root, 'mouseover', over);
  µ._mjs_dom.addEventListener(root, 'mouseout', over);
  st.off = function() {
    st.mo.disconnect();
    µ._mjs_dom.removeEventListener(root, 'mouseover', over);
    µ._mjs_dom.removeEventListener(root, 'mouseout', over);
  };
  return st;
}

// inscrit `recheck` pour la balise `el` dans sa racine et dans celles des hôtes au-dessus (une variable CSS ou une classe
// posée sur body, l'hôte ou un ancêtre d'un shadow root change l'encre de ce qu'il contient) ; rend la fonction qui le retire
function _mjsFxInkShare(el, recheck) {
  var chain = [];
  var key   = el;
  var root  = µ._mjs_dom.getRootNode(el);
  for (var n = 0; n < 16; n++) {
    var st = _mjsFxInkRoots.get(root);
    if (!st) {
      st = _mjsFxInkMake(root);
      _mjsFxInkRoots.set(root, st);
    }
    if (key === el) st.loc.set(el, recheck);
    else {
      var set = st.hosts.get(key);
      if (!set) {
        set = new Set();
        st.hosts.set(key, set);
      }
      set.add(recheck);
    }
    chain.push([st, key]);
    if (root.nodeType !== 11 || !root.host) break;
    key  = root.host;
    root = µ._mjs_dom.getRootNode(key);
  }
  return function() {
    for (var i = 0; i < chain.length; i++) {
      var s = chain[i][0];
      var k = chain[i][1];
      if (k === el) s.loc.delete(el);
      else {
        var ks = s.hosts.get(k);
        ks.delete(recheck);
        if (!ks.size) s.hosts.delete(k);
      }
      if (!s.loc.size && !s.hosts.size) {
        s.off();
        _mjsFxInkRoots.delete(s.root);
      }
    }
  };
}

// la clé du filtre : la taille de la balise et son encre ; le filtre est refait quand elle change
function _mjsFxKey(box) {
  var ik = box.ink;
  return box.w + 'x' + box.h + (ik ? ' ' + ik.l + ',' + ik.t + ',' + ik.r + ',' + ik.b : '');
}

// @@ spot
// la zone sans filtre (`spot`) : le temps du survol seulement, un double de la balise SANS filtre est posé dans une lentille, elle-même
// en dernier enfant du parent de la balise, au-dessus d'elle ; la lentille est un cadre carré de la taille de la zone (immobile quant à son
// masque : un dégradé radial peint une fois, net sur `spot` px de diamètre, puis il s'efface sur `soft` px) que la souris déplace par
// `translate`, et le double, dans un ancrage que la même écriture déplace en sens inverse, reste en place : seule la lentille se déplace sous
// lui. Rien n'est repeint ni remis en page à chaque image : la carte graphique déplace deux calques, et le double, peint une fois, n'est que
// découpé. La lentille repart en fondu quand la souris sort. Le filtre de la balise, lui, ne change pas : la zone marche donc avec tous les styles.
// Le double est la copie profonde de la balise (une <img> : l'adresse déjà choisie par le navigateur, suivie si elle change pendant le survol),
// sans identifiant, sans marque d'effet (sauf `mjs-fx-layer`, qui le désigne comme calque d'effet aux autres effets, dont la lentille le porte
// aussi), sans gestionnaire en ligne, inerte et caché des lecteurs d'écran ; il prend la boîte de MISE EN PAGE de la balise (offsetWidth,
// offsetHeight) et sa place, lues une fois à l'entrée de la souris (relues après un défilement ou un redimensionnement) : il défile, est rogné et
// arrondi comme elle, et un ancêtre mis à l'échelle ne le déforme pas ; la souris est ramenée dans le repère de la balise par le rapport entre
// sa boîte d'écran et sa boîte de mise en page. Une balise transformée (`transform`, `translate`, `rotate`, `scale`) : le double reprend sa
// transformation et la suit image par image tant qu'une transition ou une animation de la balise la change (un survol qui l'agrandit) ; rien
// n'est relu dans la boucle tant que la balise ne bouge pas, et rien ne tourne souris immobile (ni minuterie, ni image demandée) : une transition ou
// une animation CSS s'annonce par ses événements (`transitionrun`, `animationstart`), une animation lancée par le cœur (`µ._mjs_animate`, celle d'un
// `@in` ou d'un `@flip`) par un relais posé une fois sur cette fonction ; une animation lancée par le script de l'auteur (`element.animate()`) ne
// s'annonce par rien : le prochain mouvement de la souris la trouve (un relevé des animations de la balise, au plus tous les 50 ms), mais souris
// immobile le double ne la suit pas avant. Le double prend aussi l'apparence de l'image, lue une fois sur son style
// calculé à la pose (`object-fit`, arrondi, bordure, ombre, fond, texte…) : une règle qui ne vise la balise que par son parent (`.cadre > img`) ne l'atteint plus.
// Par image, deux écritures : le `translate` de la lentille et celui de son ancrage, sur ces deux calques et nulle part ailleurs ; une seule
// boucle, qui s'arrête d'elle-même quand la zone a rejoint la souris et que la balise ne bouge plus ; rien n'écoute, ni ne tourne, tant que
// `spot` vaut 0.
// Non couvert (la balise est filtrée, sans zone nette) : une vidéo, un canevas, une iframe, un composant ou ce qui en contient, une balise en
// ligne qui n'est pas une image, une balise `sticky`, une balise dans un parent qui rogne ou qui défile sans être positionné et qu'on ne peut
// pas positionner sans déplacer ce qu'il contient (des décalages écrits sur lui, une balise posée en absolu qui le prendrait pour repère : la
// console le dit en développement) ; un tel parent sans ces obstacles est positionné (`position: relative`) le temps du survol, puis rendu tel
// quel. Aussi : une balise ou un ancêtre TOURNÉ (la souris est alors lue dans la boîte d'écran : la zone est décalée). Pendant le survol,
// le parent a un enfant de plus : `:last-child`, `:only-child`, `:nth-last-child` et `:empty` du parent changent, et la lentille passe
// au-dessus des frères posés après la balise. Le double ne suit pas ce qui change pendant le survol (une classe, un contenu, un mouvement que
// le script écrit lui-même image par image) ; une autre marque d'effet de la balise n'y est pas recopiée.
// Le cercle (`ring`) : un anneau de la taille de la zone, posé juste après la lentille, que la même écriture déplace ; il vient et part en
// fondu. L'approche (`near`) : la zone ne vient plus au survol de la balise, elle se montre dès que la souris en est à moins de son rayon et
// de son bord — chaque mouvement de la souris dans la page est lu une fois par image, la balise mesurée à ce moment-là ; loin d'elle, rien
// n'est écrit — et part d'un coup, à la place de la souris (son cercle s'y efface). La dérive (`parallax`) : la balise et son double glissent
// de `parallax` fois l'écart de la zone au centre de la balise — la balise par un filtre SVG qui la décale, posé avant les siens (sa boîte, sa
// place et ce qu'elle reçoit de la souris ne bougent pas), le double par son ancrage — et restent où la souris les a laissés ; sans animation
// (préférence du système), aucune dérive. `*filter.lens` les réunit : le texte flou, une loupe nette et cerclée qui suit la souris de près.
var _mjsFxSpotMedia = /^(video|audio|canvas|iframe|object|embed)$/;
// un bloc qui sert de repère à ce qu'il contient posé en absolu : positionné, transformé, en perspective, filtré, contenu
var _mjsFxSpotHolds = function(ps) {
  return ps.position !== 'static' || (ps.transform || 'none') !== 'none' || (ps.perspective || 'none') !== 'none' || (ps.filter || 'none') !== 'none' || /layout|paint|strict|content/.test(ps.contain || '');
};
// @@ dev
var _mjsFxSpotTold = typeof WeakSet === 'function' ? new WeakSet() : null;
// @@
// ce que le double reprend de la balise pour avoir la même boîte transformée (les quatre premières, puis l'origine)
var _mjsFxSpotMoves = ['transform', 'translate', 'rotate', 'scale', 'transform-origin'];
// ce que le double reprend de l'image, lu une fois sur son style calculé à la pose : l'apparence d'une boîte (rognage, arrondi, bordure, ombre, fond) et de son texte
var _mjsFxSpotLook = ['object-fit', 'object-position', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'box-shadow', 'opacity', 'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip', 'background-origin', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform'];

// les zones nettes au survol sont prévenues quand le cœur anime une balise : un relais posé une fois sur `µ._mjs_animate`, qui garde leur liste
// (vide hors survol : il rend alors l'animation sans rien faire de plus)
function _mjsFxSpotRelay() {
  var animate = µ._mjs_animate;
  if (typeof animate !== 'function') return null;
  if (animate._mjsFxSpot) return animate._mjsFxSpot;
  var relay = function(n) {
    var a = animate.apply(this, arguments);
    for (var i = 0; i < relay._mjsFxSpot.length; i++) relay._mjsFxSpot[i](n);
    return a;
  };
  relay._mjsFxSpot = [];
  relay._mjsFxWas  = animate;
  µ._mjs_animate = relay;
  return relay._mjsFxSpot;
}

// le dernier retrait rend au cœur sa fonction d'origine (si personne n'a enveloppé le relais depuis : il reste alors, inoffensif)
function _mjsFxSpotUnrelay() {
  var relay = µ._mjs_animate;
  if (typeof relay === 'function' && relay._mjsFxSpot && !relay._mjsFxSpot.length) µ._mjs_animate = relay._mjsFxWas;
}

function _mjsFxSpot(el, cur) {
  var copy    = null;
  var lens    = null;
  var shift   = null;
  var fading  = [];
  var bound   = false;
  var inside  = false;
  var box     = null;
  var roots   = [];
  var watcher = null;
  var frame   = 0;
  var last    = 0;
  var warm    = 0;
  var busy    = false;
  var running = false;
  var relay   = null;
  var seenAt  = 0;
  var seen    = [];
  var held    = null;
  var smooth  = 0.2;
  var tx      = 0;
  var ty      = 0;
  var gx      = 0;
  var gy      = 0;
  var ring    = null; // @@ ring
  var nearby  = false; // @@ near
  var pend    = null; // @@ near
  var scan    = 0; // @@ near
  var drift   = null; // @@ parallax
  var wx      = 0; // @@ parallax
  var wy      = 0; // @@ parallax
  // le suivi de la transformation demande les animations du navigateur : sans elles, le double garde celle qu'il a reçue
  var follow  = typeof el.getAnimations === 'function' && typeof requestAnimationFrame === 'function';
  var diameter = function() { return +cur.spot > 0 ? +cur.spot : 0; };
  // @@ soft
  // le bord : 40 px par défaut (la valeur de repli de la feuille, que la lentille ne reçoit alors pas), ce que `soft` écrit sinon
  var edge     = function() { return cur.soft === void 0 || cur.soft === null || isNaN(+cur.soft) ? 40 : +cur.soft; };
  // @@
  // le retard : 0.2 sans réglage ; `smooth` écrit, de 0.01 à 1 : un 0 ou un négatif ne rattraperait jamais la souris, ce qu'une variable ou un appel direct écrit y est ramené
  var rate     = function() {
    var k = 0.2;
    k     = µ._mjs_fxLagSetting(cur.smooth, 0.2); // @@ smooth
    return µ._mjs_fxCalm() ? 1 : k;
  };
  // la zone se pose si la balise est filtrée, ou va l'être à cette entrée de la souris (survol)
  var want = function() {
    if (!diameter() || cur.on === 'rest') return false;
    return cur.on === 'hover' || (µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').indexOf('filter') >= 0;
  };
  var fine = function(cs) {
    var n = el.localName || '';
    if (n.indexOf('-') > 0 || _mjsFxSpotMedia.test(n)) return false;
    if (cs.display === 'inline' && n !== 'img' && n !== 'svg') return false;
    if (cs.position === 'sticky') return false;
    var all = µ._mjs_dom.querySelectorAll(el, '*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].localName.indexOf('-') > 0 || _mjsFxSpotMedia.test(all[i].localName)) return false;
    }
    // posé en absolu, le double est rogné et défile avec le bloc qui le contient (le plus proche parent positionné, transformé…) :
    // un parent qui rogne ou qui défile entre la balise et ce bloc ne le tiendrait pas — ce parent est rendu (`free`) pour être
    // positionné le temps du survol, ou la zone ne se pose pas
    if (cs.position === 'fixed') return true;
    var up = function(n) {
      if (n.parentElement) return n.parentElement;
      var r = µ._mjs_dom.getRootNode(n);
      return r && r.host ? r.host : null;
    };
    for (var a = up(el); a && a !== document.body && a !== document.documentElement; a = up(a)) {
      var ps = getComputedStyle(a);
      if (_mjsFxSpotHolds(ps)) break;
      if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
        if (free(a, ps)) return a;
        tell(a); // @@ dev
        return false;
      }
    }
    return true;
  };
  // positionner ce parent ne déplace rien : aucun décalage écrit sur lui (`top`, `left`… ne comptent pas tant qu'il n'est pas positionné),
  // et aucune balise posée en absolu, dans ce qu'il contient, ne le prendrait pour repère ; une balise positionnée, transformée… sert de
  // repère à ce qu'elle contient, qui n'est pas lu
  var free = function(h, hs) {
    if (hs.top !== 'auto' || hs.right !== 'auto' || hs.bottom !== 'auto' || hs.left !== 'auto') return false;
    var open = function(n) {
      for (var c = n.firstElementChild; c; c = c.nextElementSibling) {
        var s = getComputedStyle(c);
        if (s.position === 'absolute') return false;
        if (_mjsFxSpotHolds(s)) continue;
        if (!open(c)) return false;
        var r = c._shadow || c.shadowRoot;
        if (r && !open(r)) return false;
      }
      return true;
    };
    return open(h);
  };
  // le parent positionné le temps du survol : son `position` écrit sur la balise (valeur, priorité), et son attribut `style` absent, lui sont
  // rendus au départ de la lentille
  var hold = function(h) {
    held = { node: h, had: h.hasAttribute('style'), value: h.style.getPropertyValue('position'), prio: h.style.getPropertyPriority('position') };
    h.style.setProperty('position', 'relative', 'important');
  };
  var release = function() {
    if (!held) return;
    if (held.value) held.node.style.setProperty('position', held.value, held.prio);
    else held.node.style.removeProperty('position');
    if (!held.had && !held.node.style.length) µ._mjs_dom.removeAttribute(held.node, 'style');
    held = null;
  };
  // @@ dev
  // l'avertissement du développement, une fois par balise : le parent qui rogne ne peut pas être positionné sans déplacer ce qu'il contient.
  // Son texte est du groupe `dev` des libellés, que le build de production n'écrit nulle part ; le registre des composants (`µ.instances`)
  // n'existe qu'en développement : une construction de production qui embarquerait ce fichier entier reste muette
  var tell = function(h) {
    if (!µ.instances) return;
    if (_mjsFxSpotTold) {
      if (_mjsFxSpotTold.has(el)) return;
      _mjsFxSpotTold.add(el);
    }
    var cls    = typeof h.className === 'string' ? h.className.trim() : '';
    var parent = '<' + h.localName + (cls ? '.' + cls.split(/\s+/).join('.') : '') + '>';
    µ.warn(µ._mjs_msg('dev.filterSpotParent', { parent: parent }, '*filter : pas de zone nette (spot) sur cette balise — son parent {parent} rogne ou défile sans être positionné, et le positionner déplacerait ce qu\'il contient (une balise posée en absolu, ou des décalages top, left… écrits sur lui). Mettez la balise dans un bloc en position: relative, à l\'intérieur de ce parent'), el);
  };
  // @@
  var strip = function(n) {
    var names = n.getAttributeNames();
    for (var i = 0; i < names.length; i++) {
      if (names[i] === 'id' || names[i] === 'name' || /^(mjs-fx|on)/.test(names[i])) µ._mjs_dom.removeAttribute(n, names[i]);
    }
  };
  // la boîte de la balise à l'écran, et son échelle : le rapport avec sa boîte de mise en page (celle des ancêtres, de sa transformation) ;
  // à moins de 1 % de 1 dans les deux sens, aucune échelle, comme `place` : offsetWidth et offsetHeight sont arrondis au pixel (une balise
  // de 92,4 px de haut n'est pas agrandie de 0,4 %)
  var measure = function() {
    var q  = µ._mjs_dom.getBoundingClientRect(el);
    var sx = el.offsetWidth && q.width ? q.width / el.offsetWidth : 1;
    var sy = el.offsetHeight && q.height ? q.height / el.offsetHeight : 1;
    if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) sx = sy = 1;
    box = { l: q.left, t: q.top, w: q.width, h: q.height, sx: sx, sy: sy };
    return q;
  };
  // la boîte du double : la taille de mise en page de la balise ; sa place, dans le repère du parent où se pose la lentille, est celle de la
  // lentille (le double est à l'origine de son ancrage, qui est au centre de la lentille, ramené par la même écriture que la lentille se déplace) :
  // l'origine est lue sur le double lui-même, puis rapportée à l'échelle des seuls ancêtres
  var place = function(c, r) {
    var st = c.style;
    var ls = lens.style;
    var lw = el.offsetWidth;
    var lh = el.offsetHeight;
    var sx = lw && r.width ? r.width / lw : 1;
    var sy = lh && r.height ? r.height / lh : 1;
    // sans échelle (le cas courant), la boîte d'écran est exacte, jusqu'au pixel fractionnaire ; sinon, celle de mise en page
    var flat = Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01;
    st.setProperty('width', (flat ? r.width : lw) + 'px');
    st.setProperty('height', (flat ? r.height : lh) + 'px');
    if (c._mjs_fxFixed) {
      ls.setProperty('left', r.left + 'px');
      ls.setProperty('top', r.top + 'px');
      pin(); // @@ ring
      return;
    }
    ls.setProperty('left', '0px');
    ls.setProperty('top', '0px');
    var o  = µ._mjs_dom.getBoundingClientRect(c);
    var ax = 1;
    var ay = 1;
    if (!flat) {
      // l'échelle des seuls ancêtres : le double sans sa transformation, sur sa taille de mise en page
      for (var i = 0; i < 4; i++) st.setProperty(_mjsFxSpotMoves[i], 'none');
      var z = µ._mjs_dom.getBoundingClientRect(c);
      ax = lw && z.width ? z.width / lw : 1;
      ay = lh && z.height ? z.height / lh : 1;
      for (var j = 0; j < 4; j++) st.setProperty(_mjsFxSpotMoves[j], seen[j] || 'none');
    }
    ls.setProperty('left', ((r.left - o.left) / ax) + 'px');
    ls.setProperty('top', ((r.top - o.top) / ay) + 'px');
    // @@ parallax
    // le double mesuré portait la dérive : la lentille la lui laisse, au lieu de la défaire
    ls.setProperty('left', ((r.left - o.left) / ax + wx) + 'px');
    ls.setProperty('top', ((r.top - o.top) / ay + wy) + 'px');
    // @@
    pin(); // @@ ring
  };
  // @@ ring
  // le cercle à la place de la lentille : le même repère, centré par la même écriture
  var pin = function() {
    if (!ring) return;
    ring.style.setProperty('left', lens.style.getPropertyValue('left'));
    ring.style.setProperty('top', lens.style.getPropertyValue('top'));
  };
  // @@
  // @@ parallax
  // la dérive : `parallax` fois l'écart de la zone au centre de la balise (sa boîte d'écran ramenée à son échelle), au dixième de px ; la
  // balise la reçoit d'un décalage SVG, posé la première fois qu'elle n'est pas nulle (une règle de la feuille le met avant son filtre)
  var sway = function() {
    var k = µ._mjs_fxCalm() ? 0 : +cur.parallax || 0;
    if (!box) measure();
    wx = +((gx - box.w / box.sx / 2) * k).toFixed(1);
    wy = +((gy - box.h / box.sy / 2) * k).toFixed(1);
    if (!drift && !wx && !wy) return;
    if (!drift) {
      var id  = 'mjs-fx-filter-' + (++_mjsFxFilN);
      var svg = µ._mjs_fxSvgDefs(el);
      svg.innerHTML = '<filter id="' + id + '" color-interpolation-filters="sRGB" x="-1" y="-1" width="3" height="3"><feOffset/></filter>';
      drift = { svg: svg, off: svg.firstChild.firstChild };
      el.style.setProperty('--mjs-fx-filter-drift', 'url(#' + id + ')');
      µ._mjs_dom.setAttribute(el, 'mjs-fx-filter-drift', '');
    }
    drift.off.setAttribute('dx', wx);
    drift.off.setAttribute('dy', wy);
  };
  // @@
  var paint = function() {
    var at = gx.toFixed(1) + 'px ' + gy.toFixed(1) + 'px';
    var ax = -gx;
    var ay = -gy;
    // @@ parallax
    // le double glisse dans son ancrage de ce que la balise glisse
    sway();
    ax = wx - +gx.toFixed(1);
    ay = wy - +gy.toFixed(1);
    // @@
    lens.style.setProperty('translate', at);
    shift.style.setProperty('translate', ax.toFixed(1) + 'px ' + ay.toFixed(1) + 'px');
    if (ring) ring.style.setProperty('translate', at); // @@ ring
  };
  var aim = function(e) {
    if (!box) measure();
    tx = (e.clientX - box.l) / box.sx;
    ty = (e.clientY - box.t) / box.sy;
  };
  // la transformation de la balise, reprise par le double : seul ce qui a changé est écrit ; la boîte d'écran de la balise a alors changé, elle
  // est lue de nouveau au prochain mouvement
  var carry = function() {
    var cs = getComputedStyle(el);
    var st = copy.style;
    var moved = false;
    for (var i = 0; i < _mjsFxSpotMoves.length; i++) {
      var v = cs.getPropertyValue(_mjsFxSpotMoves[i]);
      if (v === seen[i]) continue;
      seen[i] = v;
      st.setProperty(_mjsFxSpotMoves[i], v);
      moved = true;
    }
    if (moved) box = null;
  };
  // la balise change de transformation : une transition de l'une de ces propriétés, ou une animation en cours
  var moving = function() {
    var list = µ._mjs_dom.getAnimations(el);
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.playState !== 'running' && a.playState !== 'pending') continue;
      if (!a.transitionProperty || _mjsFxSpotMoves.indexOf(a.transitionProperty) >= 0) return true;
    }
    return false;
  };
  // la boucle unique : elle rattrape la souris (le retard de `smooth` à 60 images par seconde, le même à toute cadence) et suit la
  // transformation de la balise ; elle s'arrête d'elle-même
  var tick = function(now) {
    frame = 0;
    if (!copy) return;
    var more = false;
    if (follow) {
      // la transformation est relue tant que la balise bouge, et une dernière fois après : c'est l'état d'arrivée ; ce que la balise fait
      // n'est interrogé que lorsqu'une transition ou une animation a été annoncée, jamais à chaque image d'un simple suivi de la souris
      var live = warm > 0 || (running && (running = moving()));
      if (live || busy) carry();
      busy = live;
      if (warm > 0) warm--;
      more = live;
    }
    if (gx !== tx || gy !== ty) {
      var dt = last ? Math.min(now - last, 100) : 17;
      var k  = 1 - Math.pow(1 - smooth, dt / 16.667);
      last   = now;
      gx    += (tx - gx) * k;
      gy    += (ty - gy) * k;
      var end = Math.abs(tx - gx) < 0.1 && Math.abs(ty - gy) < 0.1;
      if (end) {
        gx   = tx;
        gy   = ty;
        last = 0;
      }
      paint();
      if (!end) more = true;
    }
    if (more) frame = requestAnimationFrame(tick);
  };
  var go = function() {
    if (smooth >= 1 || typeof requestAnimationFrame !== 'function') {
      gx = tx;
      gy = ty;
      paint();
    }
    else if (!frame) frame = requestAnimationFrame(tick);
  };
  var stop = function() {
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame   = 0;
    last    = 0;
    warm    = 0;
    busy    = false;
    running = false;
  };
  var stale = function() { box = null; };
  // une transition ou une animation de la balise démarre : le double la suit
  var arm = function() {
    warm    = 1;
    running = true;
    if (!frame) frame = requestAnimationFrame(tick);
  };
  var kick = function(e) {
    if (copy && e.target === el) arm();
  };
  // le cœur anime la balise (`µ._mjs_animate`) : le relais prévient la zone
  var echo = function(n) {
    if (copy && n === el) arm();
  };
  // une animation lancée par le script de l'auteur (`element.animate()`) ne s'annonce par aucun événement : un mouvement de la souris relève les
  // animations de la balise, au plus tous les 50 ms ; souris immobile, rien n'est relevé
  var look = function() {
    var now = Date.now();
    if (!follow || running || now - seenAt < 50) return;
    seenAt = now;
    if (moving()) arm();
  };
  // l'image change d'adresse pendant le survol : le double prend celle que le navigateur a retenue
  var resync = function() {
    if (copy && el.currentSrc) µ._mjs_dom.setAttribute(copy, 'src', el.currentSrc);
  };
  var watch = function() {
    // un défilement ne sort pas d'un shadow root : un écouteur à chaque racine, de la balise jusqu'au document
    var r = µ._mjs_dom.getRootNode(el);
    for (var n = 0; r && n < 8; n++) {
      roots.push(r);
      µ._mjs_dom.addEventListener(r, 'scroll', stale, { capture: true, passive: true });
      r = r.host ? µ._mjs_dom.getRootNode(r.host) : null;
    }
    µ._mjs_dom.addEventListener(window, 'resize', stale, { passive: true });
    if (follow) {
      µ._mjs_dom.addEventListener(el, 'transitionrun', kick, { passive: true });
      µ._mjs_dom.addEventListener(el, 'animationstart', kick, { passive: true });
      relay = _mjsFxSpotRelay();
      if (relay) relay.push(echo);
    }
    if (el.localName === 'img') µ._mjs_dom.addEventListener(el, 'load', resync, { passive: true });
    // la première annonce d'un observateur dit seulement qu'il est posé ; ensuite, la balise a changé de taille : le double la suit
    if (typeof ResizeObserver === 'function') {
      var seenOnce = false;
      watcher = new ResizeObserver(function() {
        if (!seenOnce) {
          seenOnce = true;
          return;
        }
        box = null;
        if (copy) place(copy, µ._mjs_dom.getBoundingClientRect(el));
      });
      watcher.observe(el);
    }
  };
  var unwatch = function() {
    for (var i = 0; i < roots.length; i++) µ._mjs_dom.removeEventListener(roots[i], 'scroll', stale, { capture: true });
    roots = [];
    µ._mjs_dom.removeEventListener(window, 'resize', stale);
    µ._mjs_dom.removeEventListener(el, 'transitionrun', kick);
    µ._mjs_dom.removeEventListener(el, 'animationstart', kick);
    if (relay) {
      var at = relay.indexOf(echo);
      if (at >= 0) relay.splice(at, 1);
    }
    relay = null;
    µ._mjs_dom.removeEventListener(el, 'load', resync);
    if (watcher) watcher.disconnect();
    watcher = null;
  };
  var make = function(e) {
    var parent = el.parentNode;
    if (!parent) return;
    var cs   = getComputedStyle(el);
    var room = fine(cs);
    if (!room) return;
    var c = µ._mjs_dom.cloneNode(el, true);
    strip(c);
    var inner = µ._mjs_dom.querySelectorAll(c, '*');
    for (var i = 0; i < inner.length; i++) strip(inner[i]);
    // une image : l'adresse que le navigateur a retenue pour la balise, sans nouveau choix parmi les variantes
    if (el.localName === 'img') {
      µ._mjs_dom.removeAttribute(c, 'srcset');
      µ._mjs_dom.removeAttribute(c, 'sizes');
      µ._mjs_dom.setAttribute(c, 'loading', 'eager');
      µ._mjs_dom.setAttribute(c, 'decoding', 'sync');
      if (el.currentSrc) µ._mjs_dom.setAttribute(c, 'src', el.currentSrc);
    }
    µ._mjs_dom.setAttribute(c, 'mjs-fx-filter-copy', '');
    µ._mjs_dom.setAttribute(c, 'mjs-fx-layer', 'filter');
    µ._mjs_dom.setAttribute(c, 'aria-hidden', 'true');
    µ._mjs_dom.setAttribute(c, 'inert', '');
    c._mjs_fxFixed = cs.position === 'fixed';
    var st = c.style;
    for (var p = 0; p < _mjsFxSpotLook.length; p++) st.setProperty(_mjsFxSpotLook[p], cs.getPropertyValue(_mjsFxSpotLook[p]));
    st.setProperty('position', 'absolute');
    st.setProperty('left', '0px');
    st.setProperty('top', '0px');
    st.setProperty('margin', '0px');
    st.setProperty('box-sizing', 'border-box');
    st.setProperty('pointer-events', 'none');
    st.setProperty('will-change', 'transform');
    // la lentille (le cadre qui se déplace) et l'ancrage (qui revient en sens inverse), la taille de la zone tenue par deux variables
    lens  = document.createElement('div');
    shift = lens.appendChild(document.createElement('div'));
    shift.appendChild(c);
    µ._mjs_dom.setAttribute(lens, 'mjs-fx-filter-lens', '');
    // @@ near
    // l'approche : la zone sans fondu ; à bord net, découpée et peinte avec la page (cf. la feuille)
    if (nearby) {
      var cut = false;
      cut = !edge(); // @@ soft
      µ._mjs_dom.setAttribute(lens, 'mjs-fx-filter-lens', cut ? 'sharp' : 'near');
      if (cut) st.setProperty('will-change', 'auto');
    }
    // @@
    µ._mjs_dom.setAttribute(lens, 'mjs-fx-layer', 'filter');
    lens.style.setProperty('position', c._mjs_fxFixed ? 'fixed' : 'absolute');
    lens.style.setProperty('--mjs-fx-filter-d', diameter() + 'px');
    lens.style.setProperty('--mjs-fx-filter-s', edge() + 'px'); // @@ soft
    copy = c;
    seen = [];
    if (room !== true) hold(room);
    // en dernier enfant du parent : aucun frère ne change de rang
    µ._mjs_dom.appendChild(parent, lens);
    // @@ ring
    // le cercle, juste après la lentille : par-dessus elle
    if (cur.ring) {
      ring = document.createElement('div');
      µ._mjs_dom.setAttribute(ring, 'mjs-fx-filter-ring', '');
      µ._mjs_dom.setAttribute(ring, 'mjs-fx-layer', 'filter');
      ring.style.setProperty('position', c._mjs_fxFixed ? 'fixed' : 'absolute');
      // hors de la balise, il ne reçoit pas d'elle `visibility: hidden` : elle le lui donne
      ring.style.setProperty('visibility', cs.visibility);
      ring.style.setProperty('--mjs-fx-filter-d', diameter() + 'px');
      if (cur.color) ring.style.setProperty('--mjs-fx-filter-c', cur.color);
      µ._mjs_dom.appendChild(parent, ring);
    }
    // @@
    if (follow) {
      carry();
      running = moving();
    }
    var r = measure();
    tx = (e.clientX - box.l) / box.sx;
    ty = (e.clientY - box.t) / box.sy;
    gx = tx;
    gy = ty;
    paint();
    place(c, r);
    // la transformation peut changer juste après l'entrée (le survol que le navigateur applique après l'écouteur) : deux images pour la reprendre
    if (follow) {
      warm = 2;
      frame = requestAnimationFrame(tick);
    }
  };
  // une copie qui s'efface encore (visite précédente) part tout de suite
  var drop = function() {
    for (var i = 0; i < fading.length; i++) {
      clearTimeout(fading[i].timer);
      fading[i].node.remove();
    }
    fading = [];
    if (lens) lens.remove();
    if (ring) ring.remove(); // @@ ring
    lens  = null;
    shift = null;
    copy  = null;
    ring  = null; // @@ ring
    release();
  };
  var fade = function(c, mark) {
    var item = { node: c, timer: 0 };
    var done = function() {
      clearTimeout(item.timer);
      c.remove();
      var at = fading.indexOf(item);
      if (at >= 0) fading.splice(at, 1);
      if (!lens && !fading.length) release();
    };
    µ._mjs_dom.setAttribute(c, mark || 'mjs-fx-filter-lens', 'out');
    µ._mjs_dom.addEventListener(c, 'animationend', done);
    item.timer = setTimeout(done, 400);
    fading.push(item);
  };
  var enter = function(e) {
    if (inside) return;
    inside = true;
    drop();
    if (!want()) return;
    smooth = rate();
    make(e);
    if (copy) watch();
  };
  var move = function(e) {
    if (!inside) return enter(e);
    if (!copy) return;
    aim(e);
    go();
    look();
  };
  var leave = function() {
    if (!inside) return;
    inside = false;
    unwatch();
    stop();
    box = null;
    if (!copy) return;
    var c = lens;
    var g = ring; // @@ ring
    lens  = null;
    shift = null;
    copy  = null;
    ring  = null; // @@ ring
    if (µ._mjs_fxCalm()) {
      c.remove();
      if (g) g.remove(); // @@ ring
      release();
      return;
    }
    if (g) fade(g, 'mjs-fx-filter-ring'); // @@ ring
    // @@ near
    // l'approche : la zone part d'un coup
    if (nearby) {
      c.remove();
      if (!fading.length) release();
      return;
    }
    // @@
    fade(c);
  };
  // @@ near
  // l'approche : chaque mouvement de la souris dans la page, lu une fois par image ; la balise mesurée à ce moment-là, la zone se montre à
  // moins de son rayon et de son bord de la balise, part au-delà — à la place de la souris. Une balise sans boîte (cachée par `display: none`,
  // la sienne ou celle d'un parent, ou retirée de la page) n'a pas de zone : aucun survol ne la trouverait
  var seek = function(e) {
    pend = e;
    if (!scan) scan = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(sense) : (sense(), 0);
  };
  var sense = function() {
    var e = pend;
    var s = 40;
    scan = 0;
    pend = null;
    if (!e) return;
    measure();
    s = edge(); // @@ soft
    var r = diameter() / 2 + s;
    var x = (e.clientX - box.l) / box.sx;
    var y = (e.clientY - box.t) / box.sy;
    if ((box.w || box.h) && x > -r && y > -r && x < box.w / box.sx + r && y < box.h / box.sy + r) return inside ? move(e) : enter(e);
    if (!inside) return;
    if (copy) {
      tx = x;
      ty = y;
      gx = x;
      gy = y;
      paint();
    }
    leave();
  };
  // @@
  // @@ ring near
  // le cercle ou l'approche changés par une variable : la zone repart, le prochain mouvement de la souris la refait
  var redo = function() {
    unwatch();
    stop();
    drop();
    inside = false;
  };
  // @@
  var bind = function() {
    if (bound) return;
    bound = true;
    // @@ near
    nearby = !!cur.near;
    if (nearby) {
      µ._mjs_dom.addEventListener(document, 'pointermove', seek, { passive: true });
      return;
    }
    // @@
    µ._mjs_dom.addEventListener(el, 'pointerenter', enter, { passive: true });
    µ._mjs_dom.addEventListener(el, 'pointermove', move, { passive: true });
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave, { passive: true });
  };
  var unbind = function() {
    if (!bound) return;
    bound = false;
    // @@ near
    if (nearby) {
      µ._mjs_dom.removeEventListener(document, 'pointermove', seek);
      if (scan && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scan);
      scan   = 0;
      pend   = null;
      nearby = false;
      return;
    }
    // @@
    µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
    µ._mjs_dom.removeEventListener(el, 'pointermove', move);
    µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
  };
  if (diameter()) bind();
  return {
    // un réglage de la zone tenu par une variable : suivi sur place (la zone qui existe garde sa taille, son bord, son retard)
    set: function(k) {
      if (k === 'spot') {
        if (diameter()) {
          bind();
          if (lens) lens.style.setProperty('--mjs-fx-filter-d', diameter() + 'px');
        }
        else {
          unbind();
          unwatch();
          stop();
          drop();
          inside = false;
        }
      }
      else if (k === 'soft' && nearby) redo(); // @@ near
      else if (k === 'soft' && lens) lens.style.setProperty('--mjs-fx-filter-s', edge() + 'px'); // @@ soft
      else if (k === 'smooth') smooth = rate(); // @@ smooth
      else if (k === 'ring') redo(); // @@ ring
      else if (k === 'color' && ring) ring.style.setProperty('--mjs-fx-filter-c', cur.color || '#fff'); // @@ ring
      // @@ near
      else if (k === 'near' && bound) {
        unbind();
        redo();
        bind();
      }
      // @@
    },
    off: function() {
      unbind();
      unwatch();
      stop();
      drop();
      inside = false;
      _mjsFxSpotUnrelay();
      // @@ parallax
      if (drift) {
        drift.svg.remove();
        el.style.removeProperty('--mjs-fx-filter-drift');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-filter-drift');
        drift = null;
      }
      // @@
    }
  };
}

// @@
µ._mjs_fxDefs.filter = {
  css: '[mjs-fx~="filter"]{transition:filter var(--mjs-filter-duration,400ms) var(--mjs-filter-easing,ease)}'
    + '[mjs-fx~="filter"][mjs-fx-on~="filter"]{filter:var(--mjs-fx-filter-value)}'
    // @@ spot
    // la zone sans filtre : la lentille (un cadre de la taille de la zone, découpé par un masque radial immobile : net sur `spot`, puis il s'efface sur `soft`)
    // se déplace par `translate` ; son ancrage, au centre, revient en sens inverse et porte le double ; fondu à l'entrée et à la sortie
    + '[mjs-fx-filter-lens][mjs-fx-filter-lens]{left:0;top:0;width:calc(var(--mjs-fx-filter-d,0px) + 2 * var(--mjs-fx-filter-s,40px));height:calc(var(--mjs-fx-filter-d,0px) + 2 * var(--mjs-fx-filter-s,40px));margin:calc(var(--mjs-fx-filter-d,0px) / -2 - var(--mjs-fx-filter-s,40px)) 0 0 calc(var(--mjs-fx-filter-d,0px) / -2 - var(--mjs-fx-filter-s,40px));overflow:clip;pointer-events:none;will-change:transform;-webkit-mask-image:radial-gradient(circle,#000 calc(var(--mjs-fx-filter-d,0px) / 2),transparent calc(var(--mjs-fx-filter-d,0px) / 2 + var(--mjs-fx-filter-s,40px)));mask-image:radial-gradient(circle,#000 calc(var(--mjs-fx-filter-d,0px) / 2),transparent calc(var(--mjs-fx-filter-d,0px) / 2 + var(--mjs-fx-filter-s,40px)));animation:mjs-fx-filter-in .2s ease both}'
    + '[mjs-fx-filter-lens][mjs-fx-filter-lens]>div{position:absolute;left:50%;top:50%;width:0;height:0;will-change:transform}'
    + '[mjs-fx-filter-lens="out"][mjs-fx-filter-lens="out"]{animation:mjs-fx-filter-out .2s ease both}'
    + '@keyframes mjs-fx-filter-in{from{opacity:0}to{opacity:1}}'
    + '@keyframes mjs-fx-filter-out{from{opacity:1}to{opacity:0}}'
    // @@ ring
    // le cercle de la zone : sa taille, centré sur la souris par la même écriture que la lentille, en fondu à l'entrée et à la sortie ; peint avec
    // la page (ni promotion, ni fondu d'entrée qui reste posé une fois fini) : son bord et son ombre sont lissés comme le reste de la page
    + '[mjs-fx-filter-ring][mjs-fx-filter-ring]{left:0;top:0;width:var(--mjs-fx-filter-d,0px);height:var(--mjs-fx-filter-d,0px);margin:calc(var(--mjs-fx-filter-d,0px) / -2) 0 0 calc(var(--mjs-fx-filter-d,0px) / -2);box-sizing:border-box;border:2px solid var(--mjs-fx-filter-c,#fff);border-radius:50%;box-shadow:0 5px 25px rgba(0,0,0,.25);pointer-events:none;animation:mjs-fx-filter-in .2s ease}'
    + '[mjs-fx-filter-ring="out"][mjs-fx-filter-ring="out"]{animation:mjs-fx-filter-out .2s ease both}'
    // @@
    // @@ near
    // la zone de l'approche, sans fondu ; à bord net, découpée par clip-path au lieu du masque, et peinte avec la page : son texte est lissé comme
    // celui de la page (un masque ou un calque à part le lisseraient en gris)
    + '[mjs-fx-filter-lens="near"][mjs-fx-filter-lens="near"]{animation:none}'
    + '[mjs-fx-filter-lens="sharp"][mjs-fx-filter-lens="sharp"]{animation:none;will-change:auto;-webkit-mask-image:none;mask-image:none;clip-path:circle(calc(var(--mjs-fx-filter-d,0px) / 2))}'
    + '[mjs-fx-filter-lens="sharp"][mjs-fx-filter-lens="sharp"]>div{will-change:auto}'
    // @@
    + '[mjs-fx~="filter"][mjs-fx-on~="filter"][mjs-fx-filter-drift]{filter:var(--mjs-fx-filter-drift) var(--mjs-fx-filter-value)}' // @@ parallax
    // @@
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="filter"][mjs-fx~="filter"]{transition:none}'
    // @@ spot
    + '[mjs-fx-filter-lens][mjs-fx-filter-lens]{animation:none}'
    + '[mjs-fx-filter-ring][mjs-fx-filter-ring]{animation:none}' // @@ ring
    // @@
    + '}',
  vars: { duration: '', easing: '' },
  setup: function(el, s) {
    var cur    = Object.create(null);
    var id     = 'mjs-fx-filter-' + (++_mjsFxFilN);
    var holder = null;
    var watch  = null;
    var last   = '';
    var gate   = null;
    var mut    = null;
    var share  = null;
    var frame  = 0;
    for (var k in s) cur[k] = s[k];
    // sans rien à écrire, un filtre neutre (la valeur se combine avec celle de *blend : `none` ne le pourrait pas)
    var paint = function() {
      var box = { w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
      // la taille sans arrondi (offsetWidth arrondit), tant qu'aucune transformation ne la change : le pavé de la trame de WebKit s'y règle
      if (_mjsFxWebkit && el.getBoundingClientRect) {
        var rect = µ._mjs_dom.getBoundingClientRect(el);
        if (Math.abs(rect.width - box.w) < 1 && Math.abs(rect.height - box.h) < 1) {
          box.fw = rect.width;
          box.fh = rect.height;
        }
        box.ink = _mjsFxInk(el, rect);
      }
      var plan = _mjsFxPlan(el, cur, box);
      last = _mjsFxKey(box);
      if (plan.prims) {
        if (!holder) holder = _mjsFxHolder(el, id);
        // jamais retiré : WebKit ne relit pas un attribut retiré (la balise y disparaissait en passant de fractions à des px), le défaut est posé en toutes lettres
        holder.filter.setAttribute('primitiveUnits', plan.units || 'userSpaceOnUse');
        holder.filter.innerHTML = plan.prims;
      }
      el.style.setProperty('--mjs-fx-filter-value', [plan.pre, plan.prims ? 'url(#' + id + ')' : '', plan.post].filter(Boolean).join(' ') || 'opacity(1)');
      if (!plan.prims && holder) {
        holder.svg.remove();
        holder = null;
      }
      // la taille de la balise compte (vignette, tilt-shift, trame dans WebKit) : le filtre est refait quand elle change
      if (plan.box && !watch && typeof ResizeObserver === 'function') {
        watch = new ResizeObserver(function() {
          if (el.offsetWidth + 'x' + el.offsetHeight !== last.split(' ')[0]) paint();
        });
        watch.observe(el);
      }
      else if (!plan.box && watch) {
        watch.disconnect();
        watch = null;
      }
      // dans WebKit l'encre compte aussi : elle change sans que la taille change (classe, enfant déplacé, survol), elle est relue à ces moments-là
      if (_mjsFxWebkit && plan.box) listen();
      else unlisten();
      if (mut) mut.takeRecords();
      if (mut && animated()) recheck();
    };
    // une animation ou une transition court sur la balise ou un enfant (hors celle du filtre lui-même) : l'encre bouge à chaque image
    var animated = function() {
      if (typeof Element !== 'function' || typeof Element.prototype.getAnimations !== 'function') return false;
      var list = µ._mjs_dom.getAnimations(el, { subtree: true });
      for (var i = 0; i < list.length; i++) {
        if (list[i].transitionProperty === 'filter') continue;
        if (list[i].playState === 'running' || list[i].playState === 'pending') return true;
      }
      return false;
    };
    // une relecture au plus par image : l'encre est comparée, le filtre n'est refait que si elle a changé
    var recheck = function() {
      if (frame) return;
      frame = requestAnimationFrame(function() {
        frame = 0;
        if (el.isConnected === false || !el.getBoundingClientRect) return;
        var box = { w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
        box.ink = _mjsFxInk(el, µ._mjs_dom.getBoundingClientRect(el));
        if (_mjsFxKey(box) !== last) paint();
        // tant qu'une animation court, l'image suivante relit encore
        if (animated()) recheck();
      });
    };
    // sans getAnimations (navigateur ancien), la fin ou l'annulation d'une transition ou d'une animation dit que le style a fini de changer
    var EVENTS = ['transitionend', 'transitioncancel', 'animationend', 'animationcancel', 'mouseenter', 'mouseleave', 'focusin', 'focusout'];
    var listen = function() {
      if (mut || typeof MutationObserver !== 'function' || typeof requestAnimationFrame !== 'function') return;
      mut = new MutationObserver(recheck);
      mut.observe(el, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
      if (_mjsFxInkRoots && el.getRootNode) share = _mjsFxInkShare(el, recheck);
      for (var i = 0; i < EVENTS.length; i++) µ._mjs_dom.addEventListener(el, EVENTS[i], recheck);
    };
    var unlisten = function() {
      if (!mut) return;
      mut.disconnect();
      mut = null;
      if (share) share();
      share = null;
      for (var i = 0; i < EVENTS.length; i++) µ._mjs_dom.removeEventListener(el, EVENTS[i], recheck);
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
    };
    paint();
    gate = µ._mjs_fxState(el, 'filter', cur.on || 'always');
    var zone = _mjsFxSpot(el, cur); // @@ spot
    var stop = function() {
      gate();
      zone.off(); // @@ spot
      unlisten();
      if (watch) watch.disconnect();
      if (holder) holder.svg.remove();
      el.style.removeProperty('--mjs-fx-filter-value');
    };
    // un réglage tenu par une variable : le filtre est réécrit sur place, sans retirer l'effet
    stop.set = function(k, v) {
      if (v === void 0) delete cur[k];
      else cur[k] = v;
      if (k === 'on') {
        gate();
        gate = µ._mjs_fxState(el, 'filter', cur.on || 'always');
      }
      else if (/^(spot|soft|smooth|ring|color|near|parallax)$/.test(k)) zone.set(k); // @@ spot
      else if (k !== 'duration' && k !== 'easing') paint();
      return true;
    };
    return stop;
  }
};
