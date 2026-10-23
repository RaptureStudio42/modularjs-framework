// mjs_fx_annotate — `*annotate` : un trait dessiné à la main autour d'un mot, comme au feutre, qui
// se trace sous les yeux : underline (souligné), circle (entouré), box (encadré), strike (barré),
// cross (rayé d'une croix), bracket (entre crochets). Sur un calque SVG posé par-dessus la balise
// (dans le composant si la balise en est un) ;
// un texte en ligne sur plusieurs lignes : le souligné et le barré suivent chaque ligne. Le tracé
// tremble un peu, et toujours de la même façon pour le même texte. Réglages : style (underline),
// color (#ff4fa3), width (l'épaisseur, px ; 2), padding (l'écart au texte, px ; 5), strokes (le
// nombre de passages, comme un vrai trait de feutre ; 2), duration (le tracé entier ; 800ms), delay,
// on (view, hover, click, load ; always : le trait se retrace sans fin, après une pause `every`, calé
// sur l'horloge commune des effets qui se répètent ; sans `every`, la variable de thème `$$fx-every`,
// sinon 3s).
// « Réduire les animations » : avec always, le trait est là une fois pour toutes.

// une règle du tracé selon l'état de la balise (`a` : ses attributs), écrite deux fois : depuis la
// balise, et depuis `:host(…)` — sur un composant, le calque vit dans son shadow root, d'où la balise
// ne se voit que par `:host`
var _mjsFxAnnotateWhen = function(a, body) {
  return '[mjs-fx~="annotate"]' + a + ' [mjs-fx-layer="annotate"] path{' + body + '}:host([mjs-fx~="annotate"]' + a + ') [mjs-fx-layer="annotate"] path{' + body + '}';
};

µ._mjs_fxDefs.annotate = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx-layer="annotate"]{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;fill:none;stroke:var(--mjs-annotate-color,#ff4fa3);stroke-width:var(--mjs-annotate-width,2px);stroke-linecap:round;stroke-linejoin:round}'
    + '[mjs-fx-layer="annotate"] path{stroke-dasharray:var(--l) var(--l);stroke-dashoffset:var(--l)}'
    // chaque passage à son tour, pour sa part de `duration`
    + _mjsFxAnnotateWhen('[mjs-fx-play~="annotate"]', 'animation:mjs-fx-annotate calc(var(--mjs-annotate-duration,800ms) * var(--p)) ease-out calc(var(--mjs-annotate-delay,0s) + var(--mjs-annotate-duration,800ms) * var(--s)) 1 both')
    + _mjsFxAnnotateWhen('[mjs-fx-annotate-done]', 'animation:none;stroke-dashoffset:0')
    + '@keyframes mjs-fx-annotate{to{stroke-dashoffset:0}}'
    + '@media (prefers-reduced-motion:reduce){' + _mjsFxAnnotateWhen('[mjs-fx-play~="annotate"]', 'animation:none;stroke-dashoffset:0') + '}',
  vars: { color: '', width: 'px', duration: '', delay: '' },
  setup: function(el, s) {
    var style   = /^(box|circle|strike|cross|bracket)$/.test(s.style) ? s.style : 'underline';
    var pad     = typeof s.padding === 'number' ? s.padding : 5;
    var passes  = s.strokes || 2;
    var dur     = s.duration;
    var wait    = s.delay;
    var NS      = 'http://www.w3.org/2000/svg';
    var restore = µ._mjs_fxRelative(el);
    var host    = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'annotate');
    µ._mjs_dom.setAttribute(el, 'mjs-fx-annotate-style', style);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('mjs-fx-layer', 'annotate');
    svg.setAttribute('aria-hidden', 'true');
    // une taille de départ, pour que la première mesure ait une échelle à lire (la vraie vient avec le tracé)
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    µ._mjs_dom.appendChild(host, svg);
    // un tremblement tiré d'une graine : le même texte tremble toujours de la même façon
    var seed = 0;
    var rnd  = function() {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    var j = function(a) { return (rnd() * 2 - 1) * a; };
    // une ligne tremblée de (x1, y1) à (x2, y2) : des points, puis leur longueur
    var line = function(x1, y1, x2, y2, a) {
      var pts = [];
      for (var k = 0; k <= 8; k++) {
        var t = k / 8;
        pts.push([x1 + (x2 - x1) * t + j(a * .4), y1 + (y2 - y1) * t + j(a)]);
      }
      return pts;
    };
    var ellipse = function(cx, cy, rx, ry) {
      var pts = [];
      var a0  = -Math.PI * .7 + j(.2);
      var n   = 28;
      for (var k = 0; k <= n; k++) {
        var a = a0 + k / n * Math.PI * 2.12;
        var q = 1 + j(.05);
        pts.push([cx + Math.cos(a) * rx * q, cy + Math.sin(a) * ry * q]);
      }
      return pts;
    };
    // les points → un tracé lissé (courbes passant par les milieux), et une longueur un peu généreuse
    var path = function(pts) {
      var d   = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
      var len = 0;
      for (var k = 1; k < pts.length; k++) {
        len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        var mx = k < pts.length - 1 ? (pts[k][0] + pts[k + 1][0]) / 2 : pts[k][0];
        var my = k < pts.length - 1 ? (pts[k][1] + pts[k + 1][1]) / 2 : pts[k][1];
        d += 'Q' + pts[k][0].toFixed(1) + ' ' + pts[k][1].toFixed(1) + ' ' + mx.toFixed(1) + ' ' + my.toFixed(1);
      }
      return { d: d, len: Math.ceil(len * 1.1) + 2 };
    };
    // la place du texte déjà dessinée : la même, rien n'est redessiné (le tracé en cours ne repart pas)
    var drawn = null;
    var build = function() {
      var o  = svg.getBoundingClientRect();
      var cs = typeof getComputedStyle === 'function' ? getComputedStyle(svg) : null;
      // le tracé se compte en pixels de mise en page, ceux du calque : un parent qui réduit la page
      // (`transform: scale(.5)`) le montre plus petit, et la taille du calque à l'écran, face à celle
      // de sa mise en page, donne l'échelle
      var kx = cs && o.width > 0 && parseFloat(cs.width) > 0 ? parseFloat(cs.width) / o.width : 1;
      var ky = cs && o.height > 0 && parseFloat(cs.height) > 0 ? parseFloat(cs.height) / o.height : 1;
      // une boîte de l'écran → ses coordonnées dans le calque, dont l'origine est là où le navigateur l'a posé
      var inside = function(r) {
        return { left: (r.left - o.left) * kx, top: (r.top - o.top) * ky, right: (r.right - o.left) * kx, bottom: (r.bottom - o.top) * ky, width: r.width * kx, height: r.height * ky };
      };
      var b     = inside(µ._mjs_dom.getBoundingClientRect(el));
      var rects = typeof el.getClientRects === 'function' ? Array.prototype.slice.call(µ._mjs_dom.getClientRects(el)).map(inside) : [];
      if (rects.length === 0) rects = [b];
      var place = [b].concat(rects).map(function(r) { return [r.left, r.top, r.width, r.height].map(Math.round).join(' '); }).join(',');
      if (place === drawn) return;
      drawn = place;
      seed = (el.textContent || '').length * 7919 + style.length;
      var shapes = [];
      for (var p = 0; p < passes; p++) {
        var wob = 1.5 + p * .8;
        if (style === 'underline' || style === 'strike') {
          rects.forEach(function(r) {
            var y = style === 'underline' ? r.bottom + pad * .4 : r.top + r.height * .55;
            shapes.push(line(r.left - 2 + j(2), y + j(1), r.right + 2 + j(2), y + j(1.5), wob * .6));
          });
        }
        else if (style === 'box') {
          var L = b.left - pad, T = b.top - pad, R = b.right + pad, B = b.bottom + pad;
          shapes.push(line(L + j(2), T + j(2), R + j(2), T + j(2), wob).concat(line(R + j(2), T, R + j(2), B, wob).slice(1), line(R, B + j(2), L, B + j(2), wob).slice(1), line(L + j(2), B, L + j(2), T - j(3), wob).slice(1)));
        }
        else if (style === 'circle') {
          shapes.push(ellipse(b.left + b.width / 2 + j(2), b.top + b.height / 2 + j(2), b.width / 2 + pad * 1.6, b.height / 2 + pad * 1.4));
        }
        else if (style === 'cross') {
          shapes.push(line(b.left - pad, b.top - pad, b.right + pad, b.bottom + pad, wob));
          shapes.push(line(b.right + pad, b.top - pad, b.left - pad, b.bottom + pad, wob));
        }
        else {
          var l = b.left - pad, r2 = b.right + pad, t = b.top - pad / 2, bt = b.bottom + pad / 2, w = Math.max(4, pad + 2);
          shapes.push([[l + w, t + j(1)], [l + j(1), t + j(1)], [l + j(1), (t + bt) / 2], [l + j(1), bt + j(1)], [l + w, bt + j(1)]]);
          shapes.push([[r2 - w, t + j(1)], [r2 + j(1), t + j(1)], [r2 + j(1), (t + bt) / 2], [r2 + j(1), bt + j(1)], [r2 - w, bt + j(1)]]);
        }
      }
      var paths = shapes.map(path);
      var total = paths.reduce(function(a, q) { return a + q.len; }, 0) || 1;
      var at    = 0;
      svg.textContent = '';
      svg.setAttribute('width', String(Math.max(1, Math.ceil(b.width + pad * 4))));
      svg.setAttribute('height', String(Math.max(1, Math.ceil(b.height + pad * 4))));
      paths.forEach(function(q) {
        var e = document.createElementNS(NS, 'path');
        e.setAttribute('d', q.d);
        e.style.setProperty('--l', String(q.len));
        e.style.setProperty('--p', (q.len / total).toFixed(3));
        e.style.setProperty('--s', (at / total).toFixed(3));
        at += q.len;
        svg.appendChild(e);
      });
    };
    build();
    // redessiné quand le texte change de place, une image plus tard. Un mot en ligne n'a pas de boîte
    // pour ResizeObserver (jamais prévenu) : on suit aussi le premier bloc qui le porte (la fenêtre, la
    // taille du texte), et l'arrivée des polices (le mot s'élargit sans que rien d'autre ne bouge)
    var dead  = false;
    var again = 0;
    var redo  = function() {
      if (dead || again) return;
      if (typeof requestAnimationFrame !== 'function') { build(); return; }
      again = requestAnimationFrame(function() {
        again = 0;
        if (!dead) build();
      });
    };
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(redo) : null;
    if (ro) {
      ro.observe(el);
      var box = el;
      while (box && typeof getComputedStyle === 'function' && /^(inline|contents)$/.test(getComputedStyle(box).display)) box = box.parentElement || (box.parentNode && box.parentNode.host) || null; // eslint-disable-line no-unmodified-loop-condition -- garde de présence de getComputedStyle, invariante par construction : la sortie se fait par box, remplacé à chaque tour
      if (box && box !== el) ro.observe(box);
    }
    // le texte de la balise change sans que sa taille ne bouge (un mot lié, `{$mot}`, sur une ligne qui ne casse pas) :
    // aucun ResizeObserver ne le dit, le trait restait sous l'ancien mot — redessiné aussi (son propre calque excepté)
    var mo = typeof MutationObserver === 'function' ? new MutationObserver(function(l) {
      for (var i = 0; i < l.length; i++) {
        if (!svg.contains(l[i].target)) {
          redo();
          return;
        }
      }
    }) : null;
    if (mo) mo.observe(el, { childList: true, characterData: true, subtree: true });
    // le tracé est repris à la fin de chaque chargement de police (cf. µ._mjs_fxOnFonts), et quand `ready` se résout (souvent déjà
    // tenu à la pose, la police partie après)
    var fonts   = typeof document !== 'undefined' ? document.fonts : null;
    var unfonts = µ._mjs_fxOnFonts(redo);
    if (fonts && fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(redo);
    var done = null;
    var loop = null;
    var play = function() {
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-annotate-done');
      µ._mjs_fxPlay(el, 'annotate');
      // tracé fini : il reste, même si le calque est redessiné (taille changée)
      clearTimeout(done);
      done = setTimeout(function() { µ._mjs_dom.setAttribute(el, 'mjs-fx-annotate-done', ''); }, µ._mjs_fxMs(wait, 0) + µ._mjs_fxMs(dur, 800) + 50);
    };
    var stop;
    var plan = function() {};
    if (s.on === 'always') {
      // sans fin : un tracé, la pause `every`, puis le trait s'efface et repart — un tour de 100 ms au moins. Le premier tracé part à la
      // pose ; les suivants se calent sur l'horloge commune des effets qui se répètent, le prochain un tour entier au moins après le dernier
      // (la cadence relue à chaque tracé ; la série repart quand la durée ou l'attente change)
      var at   = 0;
      var tour = function() { return Math.max(100, µ._mjs_fxMs(wait, 0) + µ._mjs_fxMs(dur, 800) + µ._mjs_fxEvery(el, s.every, 3000)); };
      var turn = function() {
        at = Date.now();
        play();
      };
      plan = function() {
        if (loop) loop();
        loop = µ._mjs_fxBeat(tour, turn, Math.max(0, at + tour() - Date.now()));
      };
      turn();
      if (!µ._mjs_fxCalm()) plan();
      stop = function() { if (loop) loop(); };
    }
    else stop = µ._mjs_fxWhen(el, s.on, play);
    var off = function() {
      dead = true;
      stop();
      clearTimeout(done);
      if (again) cancelAnimationFrame(again);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      unfonts();
      µ._mjs_fxPlay(el, 'annotate', true);
      svg.remove();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-annotate-style');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-annotate-done');
      restore();
    };
    // durée et attente tenues par une variable : la feuille les lit, la fin du tracé et le tour aussi (couleur et
    // épaisseur : la feuille seule ; les autres réglages : l'effet repart)
    off.set = function(k, v) {
      if (k === 'duration') dur = v;
      else if (k === 'delay') wait = v;
      else return false;
      if (loop) plan();
    };
    return off;
  }
};
