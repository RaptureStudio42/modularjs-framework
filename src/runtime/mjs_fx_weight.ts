// mjs_fx_weight — `*weight` : la graisse des lettres ondule sous la souris — chaque lettre
// s'épaissit selon sa distance au pointeur. Sur un calque de lettres posé par-dessus le texte, qui
// reste en place et reste lu une seule fois (le calque est caché aux lecteurs d'écran, comme *bounce).
// Réglages : radius (le rayon d'influence en px ; 120), strength (de 0 à 1, la part de l'écart de
// graisse atteinte au plus près ; 1), min (la valeur de l'axe au repos ; 300 pour wght, 75 pour wdth), max (la valeur
// au plus près ; 900 pour wght, 125 pour wdth), axis (l'axe de la police variable, 4 lettres ; wght — wdth marche aussi,
// avec ses propres bornes ; un autre axe prend celles de wght si min et max ne sont pas écrits),
// fallback (que faire sans police variable : auto, des graisses par crans si la police en a, sinon
// un étirement vertical ; bold, deux crans, min et max ; stretch, l'étirement ; none, rien ; auto),
// duration (le lissage ; 150ms), idle (sans souris, une vague parcourt le texte toute seule ; oui),
// speed (un aller de la vague ; 3s).
// La police variable se détecte par mesure : un mot d'essai, dans la police de la balise, pris aux
// deux bouts de l'axe — s'il change de largeur, l'axe existe. Une police à chasse fixe ne change pas
// de largeur : elle passe pour une police sans axe. Sans mise en page (rien à mesurer), la mesure est
// refaite à la première image, et à chaque police qui finit de charger. La marque `mjs-fx-weight-mode` dit le choix : variable, steps, bold,
// stretch, none. « Réduire les animations » : plus de vague, plus de lissage ; la souris suit encore.
// Aucune boucle quand la souris est loin et idle est faux, ni quand la balise est hors de l'écran.

µ._mjs_fxDefs.weight = {
  css: '[mjs-fx~="weight"] [mjs-fx-letter]{transition:font-variation-settings var(--mjs-weight-duration,150ms) ease-out,font-weight var(--mjs-weight-duration,150ms) ease-out,transform var(--mjs-weight-duration,150ms) ease-out}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="weight"] [mjs-fx-letter][mjs-fx-letter]{transition:none}}',
  vars: { duration: '' },
  setup: function(el, s, comp) {
    var radius   = s.radius === void 0 ? 120 : s.radius;
    var strength = s.strength === void 0 ? 1 : s.strength;
    var axis     = s.axis || 'wght';
    // par axe : les bornes par défaut, puis les deux bouts de la mesure qui reconnaît l'axe (la largeur d'une police va
    // d'environ 75 à 125, souvent de 75 à 100 seulement : mesurée à 100 et 900, elle ne changeait pas)
    var span     = axis === 'wdth' ? [75, 125, 50, 200] : [300, 900, 100, 900];
    var lo       = s.min === void 0 ? span[0] : s.min;
    var hi       = s.max === void 0 ? span[1] : s.max;
    // sans police variable, les crans et le gras sont des graisses : les bornes de l'axe ne valent que pour wght
    var wlo      = axis === 'wght' ? lo : 300;
    var whi      = axis === 'wght' ? hi : 900;
    var fallback = s.fallback || 'auto';
    var idle     = s.idle !== false;
    var period   = µ._mjs_fxMs(s.speed, 3000);
    var tx       = µ._mjs_fxLayer(comp, el);
    var layer    = tx.layer;
    var letters  = [];
    var written  = [];
    var mode     = 'none';
    var blind    = false;
    var pointer  = null;
    var frame    = 0;
    var dirty    = false;
    var shown    = true;
    var gone     = false;
    var raf      = function(f) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : (f(0), 0); };
    // la largeur d'un mot d'essai, dans la police du calque, avec les réglages `set`
    var wide = function(set) {
      var p = document.createElement('span');
      p.style.position   = 'absolute';
      p.style.visibility = 'hidden';
      p.style.whiteSpace = 'nowrap';
      for (var k in set) p.style[k] = set[k];
      p.textContent = 'Mmmmmmmwwwwiiii';
      layer.appendChild(p);
      var w = p.getBoundingClientRect().width;
      p.remove();
      return w;
    };
    var decide = function() {
      var a = wide({ fontVariationSettings: '"' + axis + '" ' + span[2] });
      var b = wide({ fontVariationSettings: '"' + axis + '" ' + span[3] });
      blind = a === 0 && b === 0;
      if (Math.abs(a - b) > 2) return 'variable';
      if (fallback === 'bold' || fallback === 'stretch' || fallback === 'none') return fallback;
      return Math.abs(wide({ fontWeight: '100' }) - wide({ fontWeight: '900' })) > 2 ? 'steps' : 'stretch';
    };
    var settle = function() {
      mode = decide();
      µ._mjs_dom.setAttribute(el, 'mjs-fx-weight-mode', mode);
    };
    // une lettre à son niveau k (de 0 à 1) : la graisse, selon le choix fait
    var put = function(i, k) {
      var st = letters[i].style;
      var w  = Math.round(lo + (hi - lo) * k);
      var v;
      if (mode === 'variable') {
        v = '"' + axis + '" ' + w;
        if (written[i] !== v) st.fontVariationSettings = v;
      }
      else if (mode === 'steps') {
        v = String(Math.min(900, Math.max(100, Math.round((wlo + (whi - wlo) * k) / 100) * 100)));
        if (written[i] !== v) st.fontWeight = v;
      }
      else if (mode === 'bold') {
        v = String(k >= 0.5 ? whi : wlo);
        if (written[i] !== v) st.fontWeight = v;
      }
      else if (mode === 'stretch') {
        v = 'scaleY(' + Math.round((1 + 0.5 * k) * 1000) / 1000 + ')';
        if (written[i] !== v) st.transform = v;
      }
      written[i] = v;
    };
    var reset = function() {
      for (var i = 0; i < letters.length; i++) {
        letters[i].style.removeProperty('font-variation-settings');
        letters[i].style.removeProperty('font-weight');
        letters[i].style.removeProperty('transform');
      }
      written = [];
    };
    var collect = function() {
      letters = Array.prototype.slice.call(layer.querySelectorAll('[mjs-fx-letter]'));
      written = [];
      dirty   = false;
    };
    // le jeu continu : la vague, hors « réduire les animations », balise à l'écran
    var waving = function() { return idle && shown && mode !== 'none' && !µ._mjs_fxCalm(); };
    var update = function(t) {
      frame = 0;
      if (gone || mode === 'none' && !blind) return;
      var b = layer.getBoundingClientRect();
      if (blind && b.width > 0) {
        settle();
        reset();
        if (mode === 'none') return;
      }
      var r    = radius;
      var wave = waving();
      // rien à faire : pas de vague, rien d'épaissi, et le pointeur loin du calque
      if (!wave && !dirty && !(pointer && pointer.x > b.left - r && pointer.x < b.right + r && pointer.y > b.top - r && pointer.y < b.bottom + r)) return;
      // les mesures d'abord, les écritures ensuite : une seule mise en page par image
      var boxes = [];
      var x0    = Infinity;
      var x1    = -Infinity;
      var y0    = Infinity;
      var y1    = -Infinity;
      for (var i = 0; i < letters.length; i++) {
        var lb = letters[i].getBoundingClientRect();
        boxes.push(lb);
        x0 = Math.min(x0, lb.left);
        x1 = Math.max(x1, lb.right);
        y0 = Math.min(y0, lb.top);
        y1 = Math.max(y1, lb.bottom);
      }
      if (boxes.length === 0) return;
      // le pointeur compte quand il est à un rayon du texte ; sinon la vague, qui court d'un bout à l'autre du texte
      var near = pointer && pointer.x > x0 - r && pointer.x < x1 + r && pointer.y > y0 - r && pointer.y < y1 + r;
      var p    = near ? pointer : wave ? { x: x0 + (0.5 + 0.55 * Math.sin(2 * Math.PI * t / period)) * (x1 - x0), y: (y0 + y1) / 2 } : null;
      if (!p && !dirty) return;
      var ks = [];
      for (var n = 0; n < boxes.length; n++) {
        var d = p ? Math.hypot(boxes[n].left + boxes[n].width / 2 - p.x, boxes[n].top + boxes[n].height / 2 - p.y) : r;
        var k = Math.min(1, Math.max(0, 1 - d / r));
        ks.push(k * k * (3 - 2 * k) * strength);
      }
      dirty = false;
      for (var j = 0; j < ks.length; j++) {
        put(j, ks[j]);
        if (ks[j] > 0) dirty = true;
      }
    };
    var loop = function(t) {
      update(t);
      if (waving() && !gone) frame = raf(loop);
    };
    var kick = function() {
      if (!frame && !gone) frame = raf(loop);
    };
    settle();
    collect();
    tx.onBuild(function() {
      collect();
      kick();
    });
    var move  = function(e) {
      pointer = { x: e.clientX, y: e.clientY };
      kick();
    };
    // une police qui arrive après la pose (@font-face) : la mesure est refaite une fois, à la fin du chargement (cf. µ._mjs_fxOnFonts)
    var again = function() {
      if (gone) return;
      var before = mode;
      settle();
      if (mode !== before) reset();
      kick();
    };
    var unfonts = µ._mjs_fxOnFonts(again);
    var leave = function() {
      pointer = null;
      kick();
    };
    var up = function(e) {
      if (e.pointerType === 'touch') leave();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    document.documentElement.addEventListener('pointerleave', leave);
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(entries) {
      shown = entries[entries.length - 1].isIntersecting;
      if (shown) kick();
    }) : null;
    if (io) io.observe(el);
    kick();
    var off = function() {
      gone = true;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      document.documentElement.removeEventListener('pointerleave', leave);
      unfonts();
      if (io) io.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      reset();
      tx.off();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-weight-mode');
    };
    // la distance, la force, les deux graisses, la vague : suivies sur place ; l'axe et le repli
    // demandent de mesurer la police à nouveau (l'effet repart)
    off.set = function(key, v) {
      if (key === 'radius') radius = v === void 0 ? 120 : v;
      else if (key === 'strength') strength = v === void 0 ? 1 : v;
      else if (key === 'min') lo = v === void 0 ? 300 : v;
      else if (key === 'max') hi = v === void 0 ? 900 : v;
      else if (key === 'speed') period = µ._mjs_fxMs(v, 3000);
      else if (key === 'idle') idle = v !== false;
      else if (key === 'duration') return;
      else return false;
      kick();
    };
    return off;
  }
};
