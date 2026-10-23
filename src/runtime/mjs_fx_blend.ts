// mjs_fx_blend — `*blend` : les 16 modes de fusion des logiciels de retouche (multiply, screen,
// overlay, difference, hue…), avec une couleur, un dégradé ou une seconde image. Trois usages. 1)
// sans color, colors ni image : la balise elle-même se fond avec ce qu'il y a derrière elle
// (`mix-blend-mode`) — un titre en `difference` s'inverse sur ce qu'il recouvre. 2) avec color ou
// colors : un calque de couleur ou de dégradé, fondu avec le rendu de la balise. 3) avec image :
// deux images fusionnées, la seconde couvre la balise. Une balise à contenu (div, section, un
// composant) reçoit un calque (dans son shadow root si c'est un composant), isolé pour que la
// fusion ne déborde pas sur la page ; une balise sans contenu (img, video, canvas, svg, input…)
// reçoit un filtre SVG (feFlood ou feImage + feBlend) posé par `filter: url(#…)`, dans la même
// racine, retiré avec l'effet. Avec `order: under`, une balise à contenu reçoit ce même filtre : un
// calque ne peut pas fondre un texte nu (il n'y a pas de nœud à qui donner `mix-blend-mode`), le
// filtre fond le rendu entier de la balise — fond, texte nu, enfants — par-dessus le calque. Dans le
// filtre, le calque couvre la boîte de la balise et ses coins arrondis, rien d'autre : ce qui en
// déborde (une ombre, un enfant) passe tel quel — sauf dans Safari, dont le filtre borne le calque à
// une boîte qui englobe ce qui déborde : l'ombre ou l'enfant y est fondu avec lui ; comme tout filtre,
// la balise devient le cadre de ses enfants en `position: fixed`. Une balise en ligne qui n'est pas remplacée (span, lien) : le
// calque couvre toute la région du filtre (la boîte qui englobe ses lignes), sans coins ; une <img> ou
// un <svg> en ligne gardent leur boîte et leurs coins. Un dégradé ou des coins arrondis passent par un SVG
// en `data:` : une politique de sécurité qui le refuse laisse des coins carrés et un dégradé uni
// (sa première couleur), avec un avertissement. La propriété `filter` se partage :
// `*filter`, `*liquid` et `*chromatic` posés sur la même balise s'y cumulent, `*blend` en dernier
// (ces effets dessinent d'abord, le calque se fond ensuite ; ce qu'ils font déborder de la boîte, une
// ombre, un décalage, le halo d'un flou, est rogné à la région du filtre) ; ceux d'un parent ne comptent
// pas.
// Réglages : mode (multiply ; normal, multiply, screen, overlay, darken, lighten, color-dodge,
// color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity),
// color (la couleur du calque), colors (un dégradé, à l'angle `angle` ; il passe avant color), angle
// (180, vers le bas comme en CSS), image (la seconde image ; elle passe avant colors et color), fit
// (cover, contain, stretch, repeat ; cover), position (le point de l'image gardé visible ; center),
// opacity (de 0 à 1, la force du calque ; 1), order (over : le calque est fondu par-dessus la
// balise ; under : la balise est fondue par-dessus le calque ; over), duration (le fondu d'un état à
// l'autre ; 400ms), on (always, hover, rest, view ; always).
// « Réduire les animations » : le calque passe d'un état à l'autre sans fondu.

var _MJS_FX_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
var _MJS_FX_BLEND_BARE  = /^(img|video|canvas|svg|iframe|object|embed|input|textarea|select|audio|math)$/;
var _mjsFxBlendN        = 0;

// une couleur CSS telle que le navigateur la voit SUR la balise (var(), currentColor, color-mix()… résolus avec ses propres valeurs, cf.
// µ._mjs_fxColorOn, mjs_fx_toolcolor.ts) : un calque SVG ou une image en `data:` ne voit ni les variables ni le thème de la page
function _mjsFxBlendColor(c, near) {
  return µ._mjs_fxColorOn(near, c) || String(c);
}

// le dégradé CSS `linear-gradient(<deg>, c1 p1, c2…)` : une liste d'arrêts `couleur [position%]`
function _mjsFxBlendStops(list, near, xml) {
  return list.map(function(item, i) {
    var str = String(item).trim();
    var m   = /^(.*\S)\s+(-?\d+(?:\.\d+)?%)$/.exec(str);
    var col = m ? m[1] : str;
    var off = m ? m[2] : (list.length > 1 ? Math.round(i / (list.length - 1) * 1000) / 10 + '%' : '0%');
    return xml ? '<stop offset="' + off + '" stop-color="' + String(_mjsFxBlendColor(col, near)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '"/>' : col + (m ? ' ' + m[2] : '');
  }).join(xml ? '' : ', ');
}

// le même dégradé en SVG (un feImage ne lit pas le CSS) : la ligne du dégradé CSS, sur la boîte w × h
function _mjsFxBlendGradientSvg(list, deg, w, h, near) {
  var a   = deg * Math.PI / 180;
  var dx  = Math.sin(a);
  var dy  = -Math.cos(a);
  var len = Math.abs(w * dx) + Math.abs(h * dy);
  var cx  = w / 2;
  var cy  = h / 2;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="' + (cx - dx * len / 2) + '" y1="' + (cy - dy * len / 2) + '" x2="' + (cx + dx * len / 2) + '" y2="' + (cy + dy * len / 2) + '">'
    + _mjsFxBlendStops(list, near, true)
    + '</linearGradient></defs><rect width="' + w + '" height="' + h + '" fill="url(#g)"/></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// les rayons des quatre coins de la balise en px (haut gauche, haut droit, bas droit, bas gauche),
// réduits ensemble quand ils se chevauchent, comme le fait CSS ; null si aucun coin n'est arrondi
var _MJS_FX_BLEND_CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
function _mjsFxBlendRadii(corners, w, h) {
  if (!corners) return null;
  var px  = function(v, len) { return /%$/.test(v) ? parseFloat(v) * len / 100 : parseFloat(v) || 0; };
  var any = false;
  var r   = corners.map(function(v) {
    var p = v.split(/\s+/);
    var c = [px(p[0], w), px(p[1] || p[0], h)];
    if (c[0] > 0 && c[1] > 0) any = true;
    return c;
  });
  if (!any) return null;
  var f = Math.min(1, w / (r[0][0] + r[1][0] || 1), w / (r[3][0] + r[2][0] || 1), h / (r[0][1] + r[3][1] || 1), h / (r[1][1] + r[2][1] || 1));
  return r.map(function(c) { return [c[0] * f, c[1] * f]; });
}

// la boîte aux coins arrondis, dessinée en px, en SVG `data:` (un feImage ne lit pas le CSS), tramée à
// la densité de l'écran et au zoom de la balise (z) pour des bords nets ; refaite quand la taille change
function _mjsFxBlendRoundSvg(w, h, r, z) {
  var k = Math.min(3, Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)) * z;
  var n = function(v) { return Math.round(v * 1000) / 1000; };
  var d = 'M' + r[0][0] + ',0H' + (w - r[1][0]) + 'A' + r[1][0] + ',' + r[1][1] + ' 0 0 1 ' + w + ',' + r[1][1]
    + 'V' + (h - r[2][1]) + 'A' + r[2][0] + ',' + r[2][1] + ' 0 0 1 ' + (w - r[2][0]) + ',' + h
    + 'H' + r[3][0] + 'A' + r[3][0] + ',' + r[3][1] + ' 0 0 1 0,' + (h - r[3][1])
    + 'V' + r[0][1] + 'A' + r[0][0] + ',' + r[0][1] + ' 0 0 1 ' + r[0][0] + ',0Z';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + n(w * k) + '" height="' + n(h * k) + '" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + d + '" fill="#000"/></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// une politique de sécurité qui refuse les images `data:` : le masque des coins et le dégradé ne se
// chargeraient pas, le calque disparaîtrait. Essayé une fois (null : pas encore su) ; refusé, le calque
// garde des coins carrés, un dégradé devient sa première couleur, et la console le dit
var _mjsFxBlendData = null;
var _mjsFxBlendWait = [];
function _mjsFxBlendProbe(then) {
  _mjsFxBlendWait.push(then);
  if (_mjsFxBlendWait.length > 1) return;
  var img  = new Image();
  var done = function(ok) {
    _mjsFxBlendData = ok;
    if (!ok) µ.warn(µ._mjs_msg('blendCsp', null, '*blend : la politique de sécurité de la page refuse les images data: — le calque garde des coins carrés et un dégradé prend sa première couleur. Ajoutez data: à img-src pour les retrouver.'));
    _mjsFxBlendWait.splice(0).forEach(function(then) { then(); });
  };
  img.onload  = function() { done(true); };
  img.onerror = function() { done(false); };
  img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
}

// la boîte CSS w × h d'un <svg> racine, dite dans les unités de son viewBox (celles que Safari donne à
// une région de filtre) : { x, y, w, h } ; sans viewBox, les px eux-mêmes
function _mjsFxBlendUnits(el, w, h) {
  var vb = el.viewBox && el.viewBox.baseVal;
  if (!vb || !(vb.width > 0 && vb.height > 0)) return { x: 0, y: 0, w: w, h: h };
  var par = String(µ._mjs_dom.getAttribute(el, 'preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/);
  var sx  = w / vb.width;
  var sy  = h / vb.height;
  var ax  = 0;
  var ay  = 0;
  if (par[0] !== 'none') {
    sx = sy = par[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    ax = /xMin/.test(par[0]) ? 0 : /xMax/.test(par[0]) ? 1 : .5;
    ay = /YMin/.test(par[0]) ? 0 : /YMax/.test(par[0]) ? 1 : .5;
  }
  return { x: vb.x - (w - vb.width * sx) * ax / sx, y: vb.y - (h - vb.height * sy) * ay / sy, w: w / sx, h: h / sy };
}

// Firefox (Gecko) : le repère d'un filtre commence au pixel CSS entier le plus proche de la boîte, pas au
// pixel d'appareil où elle est peinte. Il se reconnaît à `mozInnerScreenX`, propre à sa fenêtre, que l'agent
// d'utilisateur d'une émulation ne change pas
function _mjsFxBlendGecko() {
  return typeof window === 'object' && window !== null && 'mozInnerScreenX' in window;
}

// Chromium en émulation de densité (DevTools, Playwright, Puppeteer) met la page en page au pixel CSS : les
// boîtes et le repère du filtre tombent sur le pixel CSS entier ; Chromium réel, à une densité autre que 1,
// met la page en page au pixel d'appareil. Le seul signe visible de la page : une longueur de 33,4 px se
// mesure à la 64e de pixel CSS près en émulation (33,390625), à la 64e de pixel d'appareil près sinon.
// Mesuré une fois par densité ; à 1 les deux calages se confondent
var _mjsFxBlendGrid = [0, false];

// vrai quand v n'est pas un entier (à la précision des flottants près)
function _mjsFxBlendFrac(v) {
  return Math.abs(v - Math.round(v)) > 0.001;
}

// la boîte peinte d'une balise de taille w × h, rendue en cadre de filtre ({ units, x, y, w, h, bw, bh, z, room, snap }, cf. `frame` dans
// _mjsFxBlendFilter) : dans le repère de son filtre, en px du filtre, z étant son zoom, room ce dont la région du filtre dépasse la boîte
// à droite et en bas (cf. `region` dans _mjsFxBlendFilter) ; null quand la balise est transformée (sa boîte dans la page n'a plus la taille de sa mise en
// page, zoom compris : la transformation agrandit le filtre, la boîte n'est plus calée sur des pixels entiers), ou
// quand la densité est fractionnaire et que le calage ne se tient pas : un zoom, un <svg> de Firefox, ou un repère de
// Firefox qui commence entre deux pixels d'appareil (x ou y de la boîte, au pixel CSS entier, fois la densité,
// fractionnaire). Firefox y rasterise le filtre et la balise elle-même à un demi-pixel du calage (mesuré à 1,25, 1,5 et
// 1,75, sur des boîtes tirées au hasard) : aucun calage ne vaut mieux que le cadre au pixel CSS entier, que `frame`
// donne alors
function _mjsFxBlendSpan(el, w, h) {
  var k     = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  var r     = µ._mjs_dom.getBoundingClientRect(el);
  var z     = 1;
  if (Math.abs(r.width - w) > 0.5 || Math.abs(r.height - h) > 0.5) {
    z = _mjsFxBlendZoom(el);
    if (Math.abs(r.width - w * z) > 0.5 * z || Math.abs(r.height - h * z) > 0.5 * z) return null;
  }
  var gecko = _mjsFxBlendGecko();
  var css   = !gecko && k !== 1;
  if (css && _mjsFxBlendGrid[0] !== k) {
    var probe = document.createElement('i');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:33.4px;height:1px';
    (document.body || document.documentElement).appendChild(probe);
    var pw = probe.getBoundingClientRect().width;
    probe.remove();
    _mjsFxBlendGrid = [k, Math.abs(pw - 33.390625) < 0.000001];
  }
  css = css && _mjsFxBlendGrid[1];
  var free  = gecko && k !== 1 && el.localName === 'svg';
  var left  = r.left + (typeof scrollX === 'number' ? scrollX : 0);
  var top   = r.top + (typeof scrollY === 'number' ? scrollY : 0);
  if (_mjsFxBlendFrac(k) && (z !== 1 || gecko && (free || _mjsFxBlendFrac(Math.round(left) * k) || _mjsFxBlendFrac(Math.round(top) * k)))) return null;
  // un axe de la boîte peinte : où elle commence dans le repère du filtre et sa longueur, en px du filtre calés sur les
  // pixels d'appareil. `pos` : sa position dans la page, `len` : sa taille mise en page ; `css` : calée sur le pixel CSS
  // entier (émulation de densité) ; `gecko` : repère du filtre au pixel CSS entier, `free` : à la position exacte (le <svg>
  // de Firefox) ; le filtre compte en px non zoomés, donc un px du filtre vaut `k * z` pixels d'appareil. Ses bords tombent
  // sur l'entier le plus proche : 100,4 de large se peint sur 100 ou 101 pixels selon l'endroit où la boîte commence
  var axis  = function(pos, len) {
    var a = css ? Math.round(pos) * k : Math.round(pos * k);
    var e = css ? Math.round(pos + len) * k : Math.round((pos + len) * k);
    var o = free ? pos * k : css || gecko ? Math.round(pos) * k : a;
    return [(a - o) / (k * z), Math.max(1, e - a) / (k * z)];
  };
  var xs    = axis(left, r.width);
  var ys    = axis(top, r.height);
  return { units: 'userSpaceOnUse', x: xs[0], y: ys[0], w: xs[1], h: ys[1], bw: xs[1], bh: ys[1], z: z, room: .2 / (k * z), snap: true };
}

// le zoom CSS d'une balise (sur elle ou sur un ancêtre) : le repère de son filtre compte en px non zoomés
function _mjsFxBlendZoom(el) {
  var z = 1;
  for (var n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode ? µ._mjs_dom.getRootNode(n).host : null)) {
    var c = typeof getComputedStyle === 'function' ? getComputedStyle(n) : null;
    var v = c ? parseFloat(c.zoom) : 1;
    if (v > 0) z *= v;
  }
  return z;
}

// ce qui rend sa boîte à une balise transformée : la fin d'une transition ou d'une animation. Elle ne touche que sa cible
// et ce qui en descend : seules ces balises-là sont relues, et seulement une fois la transformation revenue à l'identité
var _MJS_FX_BLEND_ENDS = ['transitionend', 'transitioncancel', 'animationend', 'animationcancel'];

// ce qui peut décaler une balise sans changer sa taille (une image ou une police qui arrive, la page qui grandit
// ou se redimensionne, un retour d'onglet, une transformation qui finit) : l'observateur de taille de la balise
// ne bouge pas, ses bornes calées sur les pixels d'appareil deviennent fausses. Un seul jeu d'écouteurs pour
// toutes les balises à filtre relit leur position, une seule fois, à ce qui peut la décaler ; au repos rien ne
// tourne. Chaque balise donne `el` et `read` : rend la réécriture de ses bornes si elles ont changé, sinon null ; les
// lectures se font toutes avant les écritures. Un `load` ne remonte pas hors d'un shadow root, la fin d'une
// transition non plus : chaque racine porte ses écouteurs. Une fin de transition ne relit que les balises qu'elle touche :
// sa cible et celles qui en descendent, de racine d'ombre en hôte, regroupées à l'image suivante comme le reste ; pas celles qu'une
// transformation tient, elles-mêmes ou par un ancêtre (cf. _mjsFxBlendHeld) : la boîte qu'une transformation en cours donne ne dit pas
// où la balise retombera (le premier signal du survol d'un `*tilt` arrive à un demi-pixel de la mise en page, et le cadre qu'on en
// tirerait serait gardé pendant tout le survol), son cadre reste celui du repos jusqu'à la fin de la transition qui rend l'identité
var _mjsFxBlendLive  = [];
var _mjsFxBlendRoots = new Map();
var _mjsFxBlendArmed = null;

// la balise est l'une des cibles, ou en descend ; dans une racine d'ombre, la remontée passe par son hôte
function _mjsFxBlendUnder(el, hit) {
  for (var n = el; n; n = n.parentNode || n.host) if (hit.has(n)) return true;
  return false;
}

// les nombres d'une valeur calculée (`matrix(1, 0, …)`, `1.5 1`, `0px`, `x 45deg`), sans le nom de la fonction (matrix3d)
function _mjsFxBlendNums(v) {
  return (String(v).replace(/^[a-z0-9]+\(/i, '').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
}

// l'élément porte une transformation qui n'est pas l'identité : `transform` autre que none ou une matrice identité (la perspective
// seule, que `*tilt` pose au repos, laisse le plan où il est : le terme m34 d'une matrix3d ne compte pas), `rotate` d'un angle non
// nul, `scale` d'un facteur autre que 1, `translate` d'un décalage non nul. Une matrice qu'on ne sait pas lire compte pour une
// transformation
function _mjsFxBlendTransformed(el) {
  var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  if (!cs) return false;
  var m  = _mjsFxBlendNums(cs.transform);
  var id = m.length === 16 ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, m[11], 0, 0, 0, 1] : [1, 0, 0, 1, 0, 0];
  if (m.length && m.length !== id.length) return true;
  return m.map(function(v, i) { return v - id[i]; })
    .concat(_mjsFxBlendNums(cs.rotate).slice(-1), _mjsFxBlendNums(cs.scale).map(function(v) { return v - 1; }), _mjsFxBlendNums(cs.translate))
    .some(function(v) { return Math.abs(v) > 0.000001; });
}

// la balise, ou un ancêtre (de racine d'ombre en hôte), porte une transformation qui n'est pas l'identité ; `seen` garde la réponse de
// chaque élément le temps d'une relecture, que les balises d'un même conteneur se partagent
function _mjsFxBlendHeld(el, seen) {
  for (var n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode ? µ._mjs_dom.getRootNode(n).host : null)) {
    if (!seen.has(n)) seen.set(n, _mjsFxBlendTransformed(n));
    if (seen.get(n)) return true;
  }
  return false;
}

// `hit` : les cibles des fins de transition ou d'animation, qui bornent la relecture aux balises qu'elles touchent, sauf celles qu'une
// transformation tient ; sans lui, toutes les balises sont relues
function _mjsFxBlendPass(hit) {
  var seen = new Map();
  _mjsFxBlendLive.map(function(e) {
    return !hit || _mjsFxBlendUnder(e.el, hit) && !_mjsFxBlendHeld(e.el, seen) ? e.read() : null;
  }).forEach(function(w) { if (w) w(); });
}

// plusieurs signaux d'affilée (cent images qui arrivent) : une seule relecture à l'image suivante
function _mjsFxBlendWake() {
  var a = _mjsFxBlendArmed;
  if (!a || a.wake) return;
  var run = function() {
    var hit = a.hit;
    a.wake = 0;
    a.hit  = new Set();
    _mjsFxBlendPass(hit);
  };
  if (typeof requestAnimationFrame !== 'function') return run();
  a.wake = requestAnimationFrame(run);
}

// ce qui peut avoir décalé n'importe quelle balise : elles sont toutes relues
function _mjsFxBlendSoon() {
  if (!_mjsFxBlendArmed) return;
  _mjsFxBlendArmed.hit = null;
  _mjsFxBlendWake();
}

// une transition ou une animation finit : sa cible et ce qui en descend ont pu changer de boîte, pas les autres balises
function _mjsFxBlendEnd(e) {
  if (!_mjsFxBlendArmed || !e || !e.target) return;
  if (_mjsFxBlendArmed.hit) _mjsFxBlendArmed.hit.add(e.target);
  _mjsFxBlendWake();
}

// ce que guette chaque racine d'ombre qui porte une balise : le chargement d'une image (en capture : un `load` ne remonte pas hors de la racine) et
// la fin d'une transition ou d'une animation ; `method` : addEventListener ou removeEventListener
function _mjsFxBlendHear(root, method) {
  µ._mjs_dom[method](root, 'load', _mjsFxBlendSoon, true);
  for (var i = 0; i < _MJS_FX_BLEND_ENDS.length; i++) µ._mjs_dom[method](root, _MJS_FX_BLEND_ENDS[i], _mjsFxBlendEnd, true);
}

function _mjsFxBlendWatch(entry) {
  if (!_mjsFxBlendArmed) {
    var a = _mjsFxBlendArmed = { ro: null, on: [], wake: 0, hit: new Set() };
    var on = function(t, name, fn, cap) {
      if (!t || typeof t.addEventListener !== 'function') return;
      t.addEventListener(name, fn, cap);
      a.on.push([t, name, fn, cap]);
    };
    // la page change de taille : un contenu qui arrive au-dessus pousse tout ce qui suit
    if (typeof ResizeObserver === 'function' && document.documentElement) {
      a.ro = new ResizeObserver(function() { _mjsFxBlendPass(); });
      a.ro.observe(document.documentElement);
      if (document.body) a.ro.observe(document.body);
    }
    on(typeof window === 'object' ? window : null, 'load', _mjsFxBlendSoon);
    on(typeof window === 'object' ? window : null, 'resize', _mjsFxBlendSoon);
    on(document, 'visibilitychange', function() { if (document.visibilityState !== 'hidden') _mjsFxBlendSoon(); });
    on(document, 'load', _mjsFxBlendSoon, true);
    on(document.fonts, 'loadingdone', _mjsFxBlendSoon);
    // une transformation qui finit rend sa boîte à la balise : le cadre se relit
    for (var i = 0; i < _MJS_FX_BLEND_ENDS.length; i++) on(document, _MJS_FX_BLEND_ENDS[i], _mjsFxBlendEnd, true);
  }
  _mjsFxBlendLive.push(entry);
  var root = entry.root;
  if (!root || root === document || typeof root.addEventListener !== 'function') return;
  var n = _mjsFxBlendRoots.get(root) || 0;
  _mjsFxBlendRoots.set(root, n + 1);
  if (!n) _mjsFxBlendHear(root, 'addEventListener');
}

function _mjsFxBlendUnwatch(entry) {
  var at = _mjsFxBlendLive.indexOf(entry);
  if (at < 0) return;
  _mjsFxBlendLive.splice(at, 1);
  var root = entry.root;
  var n    = _mjsFxBlendRoots.get(root);
  if (n > 1) _mjsFxBlendRoots.set(root, n - 1);
  else if (n) {
    _mjsFxBlendRoots.delete(root);
    _mjsFxBlendHear(root, 'removeEventListener');
  }
  var a = _mjsFxBlendArmed;
  if (_mjsFxBlendLive.length === 0 && a) {
    _mjsFxBlendArmed = null;
    if (a.ro) a.ro.disconnect();
    if (a.wake && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(a.wake);
    a.on.forEach(function(e) { e[0].removeEventListener(e[1], e[2], e[3]); });
  }
}

// le filtre SVG d'une balise : le calque (feFlood, ou feImage d'une image ou d'un dégradé en `data:`)
// puis feBlend. Le calque couvre la boîte de la balise et rien d'autre (coins arrondis compris) : la
// région du filtre, elle, prend aussi ce qui déborde (une ombre, un enfant), qui passe sans fusion.
// Ses bornes sont en px (des pourcentages se rapportent au viewBox d'un <svg> dans Firefox), calées sur
// les pixels d'appareil que le navigateur peint pour la boîte (cf. _mjsFxBlendSpan), sauf dans Safari
// (cf. `safari` ci-dessous) ; la région du filtre est cette même boîte : quand la boîte change de taille,
// l'observateur donne la taille et seules les bornes changent, sans relire le style ni reconstruire le
// filtre ; un dégradé ou une mosaïque se redessinent. Une balise cachée (display: none) n'a pas de
// boîte : le calque se relit en entier quand elle reparaît.
// `set(k)` règle la force du calque (0 = rien, `o.opacity` = plein) — c'est elle qu'on fait glisser
// pour le fondu. Rend { id, set, off }
function _mjsFxBlendFilter(el, o) {
  var NS   = 'http://www.w3.org/2000/svg';
  var id   = 'mjs-fx-blend-' + (++_mjsFxBlendN);
  var make = function(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  var svg  = make('svg', { 'aria-hidden': 'true', width: '0', height: '0', 'mjs-fx-blend-svg': '' });
  svg.style.position = 'absolute';
  var f = make('filter', { id: id, x: '0', y: '0', width: '1', height: '1', 'color-interpolation-filters': 'sRGB' });
  svg.appendChild(f);
  var slope  = 0;
  var fn     = null;
  var nat    = null;
  var gone   = false;
  // Safari (WebKit, donc aussi Chrome et Firefox sur iOS) lit les x et y d'une sous-région en px
  // (primitiveUnits userSpaceOnUse) depuis le coin de la page, pas de la balise : le calque tombe
  // ailleurs et la balise reste blanche, dès qu'elle n'est pas au coin de la page. Là, le calque se borne
  // en fractions de la boîte de référence (objectBoundingBox), ou, pour un <svg> racine, dans les unités
  // de son viewBox. Cette boîte englobe ce qui déborde (une ombre, un halo de flou, un enfant) : le
  // calque s'étend alors jusque-là. Aucun essai de comportement possible, le défaut est un rendu : WebKit se
  // reconnaît à son fabricant (`navigator.vendor`), que l'agent d'utilisateur d'une émulation ne change pas :
  // « Apple Computer, Inc. » dans Safari, Mac comme iOS, et dans tout navigateur d'iOS ; « Google Inc. » dans
  // Chromium, vide dans Firefox
  var safari = µ._mjs_fxWebkit;
  var rooted = safari && el.localName === 'svg';
  var cs0    = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  // une taille mise en page, au centième de px près ; Safari borne le calque en fractions de sa boîte de
  // référence et garde des pixels entiers. Rien à voir reste 0
  var fit    = function(v) { return v > 0 ? (safari ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100) : 0; };
  // la boîte de la balise : sa taille calculée, qu'une transformation ne change pas (un <svg> compris) ;
  // `none` : elle n'a pas de boîte (display: none), 100 × 100 en attendant
  var box    = function() {
    var px = function(v) { return parseFloat(v) || 0; };
    var w  = cs0 ? px(cs0.width) : 0;
    var h  = cs0 ? px(cs0.height) : 0;
    if (w > 0 && h > 0 && cs0.boxSizing !== 'border-box') {
      w += px(cs0.paddingLeft) + px(cs0.paddingRight) + px(cs0.borderLeftWidth) + px(cs0.borderRightWidth);
      h += px(cs0.paddingTop) + px(cs0.paddingBottom) + px(cs0.borderTopWidth) + px(cs0.borderBottomWidth);
    }
    if (!(w > 0 && h > 0)) {
      var r = µ._mjs_dom.getBoundingClientRect(el);
      w = r.width;
      h = r.height;
    }
    return { w: fit(w) || 100, h: fit(h) || 100, none: !(w > 0 && h > 0) };
  };
  // le repère des bornes du calque pour une boîte b : les unités (userSpaceOnUse, ou objectBoundingBox dans
  // Safari), le cadre { x, y, w, h } qui couvre la boîte, ce que vaut un px de la boîte (kx, ky), la taille
  // de la boîte peinte en px du filtre (bw, bh), sur laquelle se tracent coins, dégradé et mosaïque, et le zoom
  // de la balise (z), qui trame le masque des coins
  var frame  = function(b) {
    if (!safari) {
      var g = _mjsFxBlendSpan(el, b.w, b.h);
      if (g) return g;
      // transformée : le px entier le plus proche, le navigateur peint la boîte dans l'espace de sa transformation,
      // dont la position est le plus souvent entière ; zoomée et transformée : la taille exacte, en px non zoomés,
      // sauf dans Firefox et à une densité fractionnaire, où le px entier colle mieux (mesuré sur des balises tirées
      // au hasard)
      var dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      var zm  = !_mjsFxBlendGecko() && !_mjsFxBlendFrac(dpr) && Math.abs(_mjsFxBlendZoom(el) - 1) > 0.000001;
      var cw  = zm ? b.w : Math.max(1, Math.round(b.w));
      var ch  = zm ? b.h : Math.max(1, Math.round(b.h));
      return { units: 'userSpaceOnUse', x: 0, y: 0, w: cw, h: ch, bw: cw, bh: ch, z: 1, snap: false };
    }
    if (!rooted) return { units: 'objectBoundingBox', x: 0, y: 0, w: 1, h: 1, bw: b.w, bh: b.h, z: 1 };
    var u = _mjsFxBlendUnits(el, b.w, b.h);
    return { units: 'userSpaceOnUse', x: u.x, y: u.y, w: u.w, h: u.h, bw: b.w, bh: b.h, z: 1 };
  };
  // une borne n'est réécrite que si elle change
  var put    = function(n, k, v) {
    if (n.getAttribute(k) !== String(v)) n.setAttribute(k, v);
  };
  // la région du filtre : la boîte peinte plus le coin du repère quand la boîte en est décalé (Firefox rogne le
  // calque à une région qui ne contient pas ce coin), dite en fractions de la boîte b (objectBoundingBox) : la
  // région suit la boîte quand elle change de taille, et garde ce qui déborde (une ombre, un enfant), ce que
  // ne ferait pas une région en px, que Firefox ne redessine pas quand la boîte grandit. À droite et en bas elle
  // dépasse le cadre de `room`, un cinquième de pixel d'appareil. Le navigateur arrondit la région à l'entier
  // supérieur ; une balise peinte par une couche à part (`will-change`, `perspective`, `*tilt`) a une colonne de
  // plus que le cadre (son origine est arrondie avant qu'on lui ajoute sa taille : 38 + 50,5 donne 89, là où la boîte
  // seule s'arrondit à 88), et une région au ras du cadre, ou en deçà, la rogne. Plus loin que le cadre, le rendu ne
  // dépend plus de la taille lue : 40,4 dans le style, 40,39 dans l'observateur, 40,390625 en mise en page. Dans les
  // unités du viewBox, en px, pour un <svg> racine de Safari. Safari garde la boîte de référence ; une balise en
  // ligne aussi, dont le repère part du coin de son bloc conteneur dans Chromium ; une balise transformée aussi,
  // dont la région ne suit pas la transformation
  var region = function(fr, b) {
    var own = !whole && (safari ? rooted : fr.snap);
    if (!own && !f.hasAttribute('filterUnits')) return;
    var x0  = rooted ? fr.x : Math.min(0, fr.x);
    var y0  = rooted ? fr.y : Math.min(0, fr.y);
    var kx  = own && !rooted ? 1 / b.w : 1;
    var ky  = own && !rooted ? 1 / b.h : 1;
    put(f, 'filterUnits', own && rooted ? 'userSpaceOnUse' : 'objectBoundingBox');
    put(f, 'x', own ? x0 * kx : 0);
    put(f, 'y', own ? y0 * ky : 0);
    put(f, 'width', own ? (rooted ? fr.w : (fr.w + Math.abs(fr.x) + fr.room) * kx) : 1);
    put(f, 'height', own ? (rooted ? fr.h : (fr.h + Math.abs(fr.y) + fr.room) * ky) : 1);
  };
  // le point de l'image gardé visible, en mots pour preserveAspectRatio
  var place = function(p, par) {
    var ax = p.x < 1 / 3 ? 'xMin' : p.x > 2 / 3 ? 'xMax' : 'xMid';
    var ay = p.y < 1 / 3 ? 'YMin' : p.y > 2 / 3 ? 'YMax' : 'YMid';
    return ax + ay + ' ' + par;
  };
  var bound   = [];
  var size    = null;
  var mask    = null;
  var corners = null;
  var flood   = null;
  var whole   = false;
  // ce qui décide de refaire les bornes : le cadre, la taille de la boîte peinte et son calage (`snap`). Au
  // premier rendu d'un composant la balise n'a pas de boîte : son cadre de repli porte les mêmes nombres que
  // le vrai, mais pas la même région du filtre, qu'il faut alors réécrire
  var key = function(fr) { return [fr.x, fr.y, fr.w, fr.h, fr.bw, fr.bh, fr.snap].join(); };
  // le calque construit en entier : au départ, mosaïque chargée, images data: refusées
  var draw = function(b) {
    f.textContent = '';
    var given = !!b;
    b     = b || box();
    size  = b;
    bound = [];
    mask  = null;
    // une balise en ligne qui n'est pas remplacée (span, lien, composant en ligne) : Chromium place
    // l'origine du repère au coin de son bloc conteneur, pas au sien — le calque y garde toute la région
    // du filtre, sans coins ; une <img> ou un <svg> en ligne ont leur propre boîte
    whole   = !!cs0 && cs0.display === 'inline' && !_MJS_FX_BLEND_BARE.test(el.localName || '');
    // les rayons tels que CSS les donne (`10px`, `50%`, `40px 20px`), lus une fois : null sans aucun arrondi
    var raw = cs0 && _MJS_FX_BLEND_CORNERS.map(function(k) { return String(cs0[k] || '0').trim(); });
    corners = whole || !raw || !raw.some(function(v) { return parseFloat(v) > 0; }) ? null : raw;
    var fr  = frame(b);
    // un calque borné à la boîte de la balise
    var boxed = function(attrs) {
      if (whole) return attrs;
      attrs.x      = fr.x;
      attrs.y      = fr.y;
      attrs.width  = fr.w;
      attrs.height = fr.h;
      return attrs;
    };
    // une primitive bornée, gardée pour suivre la taille
    var keep = function(n) {
      if (!whole) bound.push(n);
      return n;
    };
    var rad  = _mjsFxBlendRadii(corners, fr.bw, fr.bh);
    var data = _mjsFxBlendData !== false;
    if (o.kind === 'color' && flood === null) flood = _mjsFxBlendColor(o.color, el);
    if ((rad || o.kind === 'gradient') && _mjsFxBlendData === null) _mjsFxBlendProbe(function() {
      if (gone || _mjsFxBlendData) return;
      draw();
      watch();
    });
    last = b.none ? '' : key(fr);
    f.setAttribute('primitiveUnits', fr.units);
    region(fr, b);
    var layer;
    if (o.kind === 'color') layer = make('feFlood', boxed({ 'flood-color': flood, result: 'l' }));
    else if (o.kind === 'gradient' && !data) layer = make('feFlood', boxed({ 'flood-color': _mjsFxBlendColor(String(o.colors[0]).replace(/\s+-?\d+(?:\.\d+)?%$/, ''), el), result: 'l' }));
    else if (o.kind === 'gradient') layer = make('feImage', boxed({ href: _mjsFxBlendGradientSvg(o.colors, o.deg, fr.bw, fr.bh, el), preserveAspectRatio: 'none', result: 'l' }));
    else if (o.fit === 'repeat') {
      // une mosaïque : l'image à sa taille naturelle (connue une fois chargée), répétée par feTile
      if (nat) {
        var kx  = safari ? fr.w / b.w : 1;
        var ky  = safari ? fr.h / b.h : 1;
        var ox  = ((fr.bw - nat.w) * o.pos.x % nat.w + nat.w) % nat.w;
        var oy  = ((fr.bh - nat.h) * o.pos.y % nat.h + nat.h) % nat.h;
        var one = make('feImage', { href: o.src, x: fr.x + ox * kx, y: fr.y + oy * ky, width: nat.w * kx, height: nat.h * ky, preserveAspectRatio: 'none', result: 't' });
        f.appendChild(one);
        layer = make('feTile', boxed({ 'in': 't', result: 'l' }));
      }
      else layer = make('feFlood', boxed({ 'flood-color': '#000', 'flood-opacity': '0', result: 'l' }));
    }
    else layer = make('feImage', boxed({ href: o.src, preserveAspectRatio: o.fit === 'stretch' ? 'none' : place(o.pos, o.fit === 'contain' ? 'meet' : 'slice'), result: 'l' }));
    f.appendChild(keep(layer));
    // les coins arrondis de la balise : le calque ne les dépasse pas
    var round = rad && data;
    if (round) {
      mask = keep(make('feImage', boxed({ href: _mjsFxBlendRoundSvg(fr.bw, fr.bh, rad, fr.z), preserveAspectRatio: 'none', result: 'm' })));
      f.appendChild(mask);
      f.appendChild(make('feComposite', { 'in': 'l', in2: 'm', operator: 'in', result: 'lm' }));
    }
    var ct = make('feComponentTransfer', { 'in': round ? 'lm' : 'l', result: 'k' });
    fn = make('feFuncA', { type: 'linear', slope: slope });
    ct.appendChild(fn);
    f.appendChild(ct);
    f.appendChild(make('feBlend', o.under ? { 'in': 'SourceGraphic', in2: 'k', mode: o.mode } : { 'in': 'k', in2: 'SourceGraphic', mode: o.mode }));
    if (!given) later();
  };
  // la boîte change de taille : les bornes et les coins suivent ; un dégradé ou une mosaïque se redessinent
  var resize = function(b, fr) {
    size = b;
    if (o.kind === 'gradient' || o.fit === 'repeat') return draw(b);
    last = key(fr);
    region(fr, b);
    for (var i = 0; i < bound.length; i++) {
      put(bound[i], 'x', fr.x);
      put(bound[i], 'y', fr.y);
      put(bound[i], 'width', fr.w);
      put(bound[i], 'height', fr.h);
    }
    var rad = mask ? _mjsFxBlendRadii(corners, fr.bw, fr.bh) : null;
    if (rad) mask.setAttribute('href', _mjsFxBlendRoundSvg(fr.bw, fr.bh, rad, fr.z));
  };
  var ro    = null;
  var io    = null;
  var entry = {
    el: el,
    root: el.getRootNode ? µ._mjs_dom.getRootNode(el) : null,
    read: function() {
      if (gone || io || !size || last === '' || (typeof el.getClientRects === 'function' && µ._mjs_dom.getClientRects(el).length === 0)) return null;
      var b  = size;
      var fr = frame(b);
      return key(fr) !== last ? function() { if (!gone) resize(b, fr); } : null;
    }
  };
  var wake = 0;
  var last = '';
  var img  = null;
  // une balise sans boîte (cachée par display: none) : rien à borner, et son display, ses coins, sa taille
  // ne se lisent qu'une fois montrée. Une seule observation, posée tant qu'elle est cachée ; à la première
  // apparition le calque se relit en entier (un <span> caché puis montré est en ligne : ni observateur de
  // taille, ni bornes). Une balise visible n'est jamais observée
  var wait = function() {
    if (io || gone || typeof IntersectionObserver !== 'function' || typeof el.getClientRects !== 'function' || µ._mjs_dom.getClientRects(el).length > 0) return;
    io = new IntersectionObserver(function(entries) {
      if (gone || !entries.some(function(e) { return e.isIntersecting; }) || µ._mjs_dom.getClientRects(el).length === 0) return;
      io.disconnect();
      io = null;
      draw();
      watch();
    }, { rootMargin: '200px' });
    io.observe(el);
  };
  // au premier rendu d'un composant, sa balise n'a pas encore de boîte : son hôte reste caché jusqu'à la fin
  // du rendu. L'image suivante dit si elle l'est vraiment
  var later = function() {
    if (typeof requestAnimationFrame !== 'function') return wait();
    if (wake) return;
    wake = requestAnimationFrame(function() {
      wake = 0;
      wait();
    });
  };
  // l'observateur, posé seulement quand le calque est borné à la boîte
  var watch = function() {
    if (ro || whole || typeof ResizeObserver !== 'function') return;
    ro = new ResizeObserver(function(entries) {
      // la taille de la boîte entière, donnée par l'observateur : aucune mise en page forcée. Elle se dit
      // dans l'écriture de la balise : largeur et hauteur échangées en écriture verticale ou sideways ;
      // sauf une cellule de tableau, que Firefox donne dans l'écriture du tableau : elle se mesure
      var e  = entries[entries.length - 1];
      var bs = e && e.borderBoxSize && e.borderBoxSize[0];
      var vt = !!cs0 && /^(vertical|sideways)/.test(cs0.writingMode || '');
      var tc = !!cs0 && cs0.display === 'table-cell';
      var b  = bs && !tc ? { w: fit(vt ? bs.blockSize : bs.inlineSize), h: fit(vt ? bs.inlineSize : bs.blockSize), none: false } : box();
      if (b.none || !(b.w > 0 && b.h > 0)) return wait();
      var fr = frame(b);
      if (key(fr) !== last) resize(b, fr);
    });
    ro.observe(el, { box: 'border-box' });
    // la position change sans que la taille change : relue à ce qui peut la décaler (cf. _mjsFxBlendWatch) ; pas
    // dans Safari, dont les bornes sont des fractions de la boîte et ne dépendent pas de sa position
    if (!safari) _mjsFxBlendWatch(entry);
  };
  if (o.kind === 'image' && o.fit === 'repeat') {
    img = new Image();
    img.onload = function() {
      nat = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      draw();
      watch();
    };
    img.onerror = function() {
      µ.warn(µ._mjs_msg('blendImage', { src: o.src }, '*blend : l\'image {src} n\'a pas pu être chargée, le calque reste vide.'));
    };
    img.src = o.src;
  }
  draw();
  watch();
  var root = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
  (root.nodeType === 11 ? root : document.body).appendChild(svg);
  return {
    id: id,
    set: function(v) {
      slope = v;
      fn.setAttribute('slope', v);
    },
    off: function() {
      gone = true;
      if (wake && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wake);
      if (ro) {
        ro.disconnect();
        _mjsFxBlendUnwatch(entry);
      }
      if (io) io.disconnect();
      if (img) {
        img.onload = img.onerror = null;
      }
      svg.remove();
    }
  };
}

// la propriété `filter` d'une balise à filtre : celui de `*blend` en dernier, après ceux de `*filter`,
// `*liquid` et `*chromatic` posés sur la MÊME balise (leur marque) — jamais leurs variables héritées
// d'un parent ; une règle par combinaison, la plus précise gagne
var _MJS_FX_BLEND_FILTERS = (function() {
  var U   = '[mjs-fx-blend-use="filter"][mjs-fx-blend-use="filter"][mjs-fx-blend-use="filter"]';
  var out = '';
  [['', ''], ['[mjs-fx-on~="filter"]', 'var(--mjs-fx-filter-value) ']].forEach(function(a) {
    [['', ''], ['[mjs-fx-liquid-on]', 'var(--mjs-fx-liquid-filter) ']].forEach(function(b) {
      [['', ''], ['[mjs-fx-chromatic-on]', 'var(--mjs-fx-chromatic-filter) ']].forEach(function(c) {
        out += U + a[0] + b[0] + c[0] + '{filter:' + a[1] + b[1] + c[1] + 'var(--mjs-fx-blend-filter)}';
      });
    });
  });
  return out;
})();

µ._mjs_fxDefs.blend = {
  image: true,
  css: '[mjs-fx-blend-use="mix"][mjs-fx-on~="blend"]{mix-blend-mode:var(--mjs-fx-blend-mode)}'
    + '[mjs-fx-blend-use="mix"][mjs-fx-blend-alpha]{transition:opacity var(--mjs-blend-duration,400ms)}'
    + '[mjs-fx-blend-use="mix"][mjs-fx-blend-alpha][mjs-fx-on~="blend"]{opacity:var(--mjs-blend-opacity,1)}'
    + '[mjs-fx-blend-use="layer"]{isolation:isolate}'
    + '[mjs-fx-layer="blend"]{position:absolute;inset:0;z-index:1;pointer-events:none;border-radius:inherit;opacity:0;transition:opacity var(--mjs-blend-duration,400ms);mix-blend-mode:var(--mjs-fx-blend-mode,multiply);background-color:var(--mjs-fx-blend-color,transparent);background-image:var(--mjs-fx-blend-bg,none);background-size:var(--mjs-fx-blend-size,cover);background-position:var(--mjs-fx-blend-pos,50% 50%);background-repeat:var(--mjs-fx-blend-repeat,no-repeat)}'
    + '[mjs-fx-blend-use="layer"][mjs-fx-on~="blend"]>[mjs-fx-layer="blend"]{opacity:var(--mjs-blend-opacity,1)}'
    + ':host([mjs-fx-blend-use="layer"][mjs-fx-on~="blend"]) [mjs-fx-layer="blend"]{opacity:var(--mjs-blend-opacity,1)}'
    + _MJS_FX_BLEND_FILTERS
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-blend-use][mjs-fx-blend-alpha],[mjs-fx-layer="blend"]{transition:none}}',
  vars: { opacity: '', duration: '' },
  setup: function(el, s) {
    var mode  = _MJS_FX_BLEND_MODES.indexOf(s.mode) >= 0 ? s.mode : 'multiply';
    var under = s.order === 'under';
    var fit   = ['cover', 'contain', 'stretch', 'repeat'].indexOf(s.fit) >= 0 ? s.fit : 'cover';
    var level = function(v) {
      v = parseFloat(v);
      return isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    };
    var op    = level(s.opacity);
    var pos   = µ._mjs_fxPoint(s.position) || { x: .5, y: .5 };
    var deg   = µ._mjs_fxDeg(s.angle, 180);
    var list  = Array.isArray(s.colors) && s.colors.length > 0 ? s.colors : null;
    var src   = '';
    var kind  = 'mix';
    if (s.image != null && s.image !== '') {
      src = µ._mjs_fxImage(s.image, el);
      if (!src) {
        µ.warn(µ._mjs_msg('blendNoSrc', null, '*blend : l\'image donnée n\'a pas d\'adresse, l\'effet n\'est pas posé.'));
        return function() {};
      }
      kind = 'image';
    }
    else if (list && list.length > 1) kind = 'gradient';
    else if (list || (s.color != null && s.color !== '')) kind = 'color';
    var color = list && list.length === 1 ? list[0] : s.color;
    var bare  = _MJS_FX_BLEND_BARE.test(el.localName || '');
    var use   = kind === 'mix' ? 'mix' : bare || under ? 'filter' : 'layer';
    var undo  = [];
    el.style.setProperty('--mjs-fx-blend-mode', mode);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-blend-use', use);
    if (under && use === 'filter') µ._mjs_dom.setAttribute(el, 'mjs-fx-blend-order', 'under');
    if (use === 'mix' && op < 1) µ._mjs_dom.setAttribute(el, 'mjs-fx-blend-alpha', '');
    var fade = null;
    if (use === 'layer') {
      var host = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'blend');
      undo.push(µ._mjs_fxRelative(el));
      var layer = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', 'blend');
      layer.setAttribute('aria-hidden', 'true');
      if (kind === 'color') layer.style.setProperty('--mjs-fx-blend-color', String(color));
      else if (kind === 'gradient') layer.style.setProperty('--mjs-fx-blend-bg', 'linear-gradient(' + deg + 'deg, ' + _mjsFxBlendStops(list, el, false) + ')');
      else {
        layer.style.setProperty('--mjs-fx-blend-bg', 'url("' + src.replace(/(["\\])/g, '\\$1').replace(/\n/g, '') + '")');
        layer.style.setProperty('--mjs-fx-blend-size', fit === 'stretch' ? '100% 100%' : fit === 'repeat' ? 'auto' : fit);
        layer.style.setProperty('--mjs-fx-blend-repeat', fit === 'repeat' ? 'repeat' : 'no-repeat');
        layer.style.setProperty('--mjs-fx-blend-pos', Math.round(pos.x * 100) + '% ' + Math.round(pos.y * 100) + '%');
      }
      µ._mjs_dom.appendChild(host, layer);
      undo.push(function() { layer.remove(); });
    }
    else if (use === 'filter') {
      // la propriété `filter` est unique : un `filter` de la feuille de la page, hors *filter, serait remplacé
      if (typeof getComputedStyle === 'function' && !/(^| )filter( |$)/.test(µ._mjs_dom.getAttribute(el, 'mjs-fx') || '') && getComputedStyle(el).filter && getComputedStyle(el).filter !== 'none') {
        µ.warn(µ._mjs_msg('blendFilter', null, '*blend : cette balise a déjà un `filter` en CSS, que l\'effet remplace — posez *blend sur une balise qui l\'englobe pour garder les deux.'));
      }
      var flt = _mjsFxBlendFilter(el, { kind: kind, mode: mode, under: under, color: color, colors: list, deg: deg, src: src, fit: fit, pos: pos });
      el.style.setProperty('--mjs-fx-blend-filter', 'url(#' + flt.id + ')');
      undo.push(function() { flt.off(); });
      // le fondu : la force du calque glisse de 0 à `opacity` (un filtre SVG ne se fond pas par transition CSS)
      var on   = false;
      var raf  = 0;
      var cur  = 0;
      var move = function(to) {
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf = 0;
        var ms = µ._mjs_fxMs(µ._mjs_fxCss(el, '--mjs-blend-duration') || s.duration, 400);
        if (ms <= 0 || µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') {
          cur = to;
          flt.set(to);
          return;
        }
        var from = cur;
        var t0   = null;
        var step = function(t) {
          if (t0 === null) t0 = t;
          var k = Math.min(1, (t - t0) / ms);
          cur = from + (to - from) * k;
          flt.set(cur);
          raf = k < 1 ? requestAnimationFrame(step) : 0;
        };
        raf = requestAnimationFrame(step);
      };
      var has = function() { return /(^| )blend( |$)/.test(µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || ''); };
      fade = function() {
        on = has();
        cur = on ? op : 0;
        flt.set(cur);
        if (typeof MutationObserver !== 'function') return;
        var mo = new MutationObserver(function() {
          var now = has();
          if (now === on) return;
          on = now;
          move(on ? op : 0);
        });
        mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-on'] });
        undo.push(function() {
          mo.disconnect();
          if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        });
      };
    }
    var gate = µ._mjs_fxState(el, 'blend', s.on || 'always');
    if (fade) fade();
    var stop = function() {
      for (var i = undo.length - 1; i >= 0; i--) undo[i]();
      gate();
      el.style.removeProperty('--mjs-fx-blend-mode');
      el.style.removeProperty('--mjs-fx-blend-filter');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-blend-use');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-blend-order');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-blend-alpha');
    };
    // l'opacité tenue par une variable suit sur place : le calque d'une balise à contenu lit sa variable CSS
    // (le moteur la pose) ; un filtre glisse vers la nouvelle force ; une balise sans calque gagne sa marque
    // d'opacité. La durée est relue à chaque fondu ; tout autre réglage repose l'effet
    stop.set = function(k, v) {
      if (k === 'duration') return;
      if (k !== 'opacity') return false;
      op = level(v);
      if (use === 'mix' && op < 1) µ._mjs_dom.setAttribute(el, 'mjs-fx-blend-alpha', '');
      else if (use === 'filter' && on) move(op);
    };
    return stop;
  }
};
