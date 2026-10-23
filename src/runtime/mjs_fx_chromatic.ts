// mjs_fx_chromatic — `*chromatic` : les canaux de couleur de la balise se séparent (aberration
// chromatique), l'écart grandit au survol. Un filtre SVG posé dans la même racine que la balise
// (feColorMatrix par canal + feOffset + feBlend) : il marche sur une `<img>`, un titre, une carte
// entière ; sur un texte il reste un filtre (pas de variante text-shadow : un seul comportement, la
// même netteté partout). Réglages : gap (l'écart de chaque canal extérieur au repos, en px ; 4),
// grow (l'écart quand l'effet est actif, en px ; 12), angle (la direction du décalage, 90 =
// horizontal ; 90), mode (rgb : rouge d'un côté, bleu de l'autre ; cmy : cyan, magenta, jaune ; rgb),
// animate (l'écart tremble ; faux), speed (la durée d'un tremblement ; 2s), duration (le passage du
// repos à l'actif ; 250ms), on (hover, view, click, always). La boucle ne tourne que pendant un
// passage ou un tremblement, jamais hors écran. « Réduire les animations » : l'écart du repos,
// fixe. Deux effets à filtre sur une même balise (`*chromatic` et `*filter`, `*liquid`) se disputent
// la propriété `filter` : un avertissement dit d'en poser un sur une balise englobante. `*blend` fait
// exception : il compose son filtre après celui de `*chromatic` (le calque se fond sur l'image décalée).

(function() {
  var NS = 'http://www.w3.org/2000/svg';
  var n   = 0;
  var r   = function(v) { return Math.round(v * 1000) / 1000; };
  var num = function(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  // la matrice qui ne garde qu'une couleur : un 1 par canal gardé
  var keep = function(red, green, blue) { return [red, 0, 0, 0, 0, 0, green, 0, 0, 0, 0, 0, blue, 0, 0, 0, 0, 0, 1, 0].join(' '); };
  var MODES = {
    rgb: { blend: 'screen', first: keep(1, 0, 0), middle: keep(0, 1, 0), last: keep(0, 0, 1) },
    cmy: { blend: 'lighten', first: keep(0, 1, 1), middle: keep(1, 0, 1), last: keep(1, 1, 0) }
  };
  var make = function(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  µ._mjs_fxDefs.chromatic = {
    css: '[mjs-fx~="chromatic"][mjs-fx-chromatic-on]{filter:var(--mjs-fx-chromatic-filter,none)}',
    setup: function(el, s) {
      var cfg = {
        gap:      num(s.gap, 4),
        grow:     num(s.grow, 12),
        angle:    µ._mjs_fxDeg(s.angle, 90),
        animate:  s.animate === true,
        speed:    µ._mjs_fxMs(s.speed, 2000),
        duration: µ._mjs_fxMs(s.duration, 250)
      };
      var mode = MODES[s.mode] || MODES.rgb;
      var id   = 'mjs-fx-chromatic-' + (++n);
      var root = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
      var at   = root && root.nodeType === 11 ? root : document.body;
      var svg  = make('svg', { 'mjs-fx-chromatic-svg': '', 'aria-hidden': 'true', width: '0', height: '0' });
      svg.style.position = 'absolute';
      var f    = make('filter', { id: id, 'color-interpolation-filters': 'sRGB', x: '-30%', y: '-30%', width: '160%', height: '160%' });
      var offA = make('feOffset', { in: 'a', result: 'a2' });
      var offC = make('feOffset', { in: 'c', result: 'c2' });
      f.appendChild(make('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: mode.first, result: 'a' }));
      f.appendChild(offA);
      f.appendChild(make('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: mode.middle, result: 'b' }));
      f.appendChild(make('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: mode.last, result: 'c' }));
      f.appendChild(offC);
      f.appendChild(make('feBlend', { in: 'a2', in2: 'b', mode: mode.blend, result: 'ab' }));
      f.appendChild(make('feBlend', { in: 'ab', in2: 'c2', mode: mode.blend }));
      svg.appendChild(f);
      at.appendChild(svg);

      var calm    = µ._mjs_fxCalm();
      var cur     = cfg.gap;
      var active  = false;
      var visible = true;
      var shown   = false;
      var raf     = 0;
      var last    = 0;
      var goal    = function() { return !calm && active ? cfg.grow : cfg.gap; };
      // la zone du filtre suit l'écart : assez large pour ne pas couper les franges, pas plus
      var region  = function() {
        var box = el.getBoundingClientRect ? µ._mjs_dom.getBoundingClientRect(el) : null;
        var m   = Math.max(cfg.gap, cfg.grow) * 1.4 + 4;
        var px  = box && box.width > 0 ? Math.min(300, Math.max(10, m / box.width * 100)) : 30;
        var py  = box && box.height > 0 ? Math.min(300, Math.max(10, m / box.height * 100)) : 30;
        f.setAttribute('x', r(-px) + '%');
        f.setAttribute('width', r(100 + 2 * px) + '%');
        f.setAttribute('y', r(-py) + '%');
        f.setAttribute('height', r(100 + 2 * py) + '%');
      };
      var draw    = function(now) {
        var d    = cur;
        var turn = 0;
        if (cfg.animate && !calm && cfg.speed > 0 && cur >= .05) {
          var phase = now * 2 * Math.PI / cfg.speed;
          d    = cur * (1 + .3 * Math.sin(phase * 5) * Math.cos(phase * 1.7));
          turn = 6 * Math.sin(phase * 3.1 + 1);
        }
        var v = µ._mjs_fxVec(cfg.angle + turn);
        offA.setAttribute('dx', r(-v.x * d));
        offA.setAttribute('dy', r(-v.y * d));
        offC.setAttribute('dx', r(v.x * d));
        offC.setAttribute('dy', r(v.y * d));
        // écart nul : le filtre est retiré, la balise ne le paie pas
        var on = cur >= .05;
        if (on === shown) return;
        shown = on;
        if (on) {
          el.style.setProperty('--mjs-fx-chromatic-filter', 'url(#' + id + ')');
          µ._mjs_dom.setAttribute(el, 'mjs-fx-chromatic-on', '');
        }
        else {
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-chromatic-on');
          el.style.removeProperty('--mjs-fx-chromatic-filter');
        }
      };
      var wants = function() {
        if (calm || !visible || (typeof document !== 'undefined' && document.hidden)) return false;
        if (Math.abs(cur - goal()) > .05) return true;
        return cfg.animate && cur >= .05;
      };
      var tick = function(now) {
        raf = 0;
        var dt = last ? Math.min(100, now - last) : 16;
        last = now;
        var g = goal();
        if (cfg.duration <= 0) cur = g;
        else cur += (g - cur) * (1 - Math.exp(-dt * 3 / cfg.duration));
        if (Math.abs(cur - g) < .05) cur = g;
        draw(now);
        if (wants()) raf = requestAnimationFrame(tick);
        else last = 0;
      };
      var wake = function() {
        if (raf || !wants() || typeof requestAnimationFrame !== 'function') return;
        region();
        raf = requestAnimationFrame(tick);
      };
      var stopRaf = function() {
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf  = 0;
        last = 0;
      };

      // l'état actif : posé par le cœur (jeton `chromatic` dans `mjs-fx-on`), relu à chaque changement
      var gate = µ._mjs_fxState(el, 'chromatic', s.on || 'hover');
      var read = function() { active = (µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').indexOf('chromatic') >= 0; wake(); };
      var mo   = typeof MutationObserver === 'function' ? new MutationObserver(read) : null;
      if (mo) mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-on'] });
      else active = true;
      read();
      var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(entries) {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) wake();
        else stopRaf();
      }) : null;
      if (io) io.observe(el);
      var onVisible = function() { if (document.hidden) stopRaf(); else wake(); };
      document.addEventListener('visibilitychange', onVisible);
      region();
      draw(0);
      wake();

      // deux filtres sur la même balise : le dernier posé gagne, l'autre est perdu
      var warned = setTimeout(function() {
        var tokens = (µ._mjs_dom.getAttribute(el, 'mjs-fx') || '').split(' ');
        var other  = tokens.indexOf('filter') >= 0 || tokens.indexOf('liquid') >= 0;
        // *blend posé en filtre compose les filtres de la balise : rien ne se perd
        if (!other || el._mjs_fxFilterWarn || µ._mjs_dom.getAttribute(el, 'mjs-fx-blend-use') === 'filter') return;
        el._mjs_fxFilterWarn = true;
        µ.warn(µ._mjs_msg('chromaticFilter', null, '*chromatic : la balise porte déjà un autre effet à filtre (*filter ou *liquid) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.'));
      }, 0);

      var off = function() {
        clearTimeout(warned);
        stopRaf();
        gate();
        if (mo) mo.disconnect();
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVisible);
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-chromatic-on');
        el.style.removeProperty('--mjs-fx-chromatic-filter');
        el._mjs_fxFilterWarn = false;
        svg.remove();
      };
      // un réglage tenu par une variable change sur place (le mode et le déclencheur reposent l'effet)
      off.set = function(k, v) {
        if (k === 'gap') cfg.gap = num(v, 4);
        else if (k === 'grow') cfg.grow = num(v, 12);
        else if (k === 'angle') cfg.angle = µ._mjs_fxDeg(v, 90);
        else if (k === 'speed') cfg.speed = µ._mjs_fxMs(v, 2000);
        else if (k === 'duration') cfg.duration = µ._mjs_fxMs(v, 250);
        else if (k === 'animate') cfg.animate = v === true;
        else return false;
        if (calm) cur = goal();
        region();
        draw(performance.now());
        wake();
      };
      return off;
    }
  };
})();
