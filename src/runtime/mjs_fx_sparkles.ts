// mjs_fx_sparkles — `*sparkles` : des étincelles naissent autour de la balise, scintillent et
// s'éteignent (un « Nouveau », un prix, une offre). Sur un calque posé dans la balise (dans le
// composant si la balise en est un), qui la déborde un peu ; les étincelles passent sous le texte.
// Réglages : color (#ffc700), count (le nombre d'étincelles à la fois ; 10), size (la plus grande,
// px ; 18), speed (la vie d'une étincelle ; 700ms), on (always, hover, view, click, load).

µ._mjs_fxDefs.sparkles = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx~="sparkles"]{isolation:isolate}'
    + '[mjs-fx-layer="sparkles"]{position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:-1}'
    + '[mjs-fx-layer="sparkles"] svg{position:absolute;fill:var(--mjs-sparkles-color,#ffc700);animation:mjs-fx-sparkle var(--mjs-sparkles-speed,700ms) ease-in-out forwards}'
    + '@keyframes mjs-fx-sparkle{0%{transform:scale(0) rotate(0)}50%{transform:scale(1) rotate(90deg)}100%{transform:scale(0) rotate(180deg)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="sparkles"]{display:none}}',
  vars: { color: '', speed: '' },
  // effets économes : suivi, et relancé (il règle sa cadence à la pose)
  heavy: true,
  liteRestart: true,
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'sparkles');
    var restore = µ._mjs_fxRelative(el);
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'sparkles');
    layer.setAttribute('aria-hidden', 'true');
    µ._mjs_dom.appendChild(host, layer);
    var life  = µ._mjs_fxMs(s.speed, 700);
    var max   = s.size || 18;
    var every = Math.max(20, life / µ._mjs_fxCount(s.count || 10));
    var timer = null;
    var NS    = 'http://www.w3.org/2000/svg';
    // une étincelle : une étoile à quatre branches, à un point tiré au sort, de taille tirée au sort
    var one = function() {
      var z   = Math.round(max * (0.4 + Math.random() * 0.6));
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 68 68');
      svg.setAttribute('width', String(z));
      svg.setAttribute('height', String(z));
      svg.style.left   = (Math.random() * 100).toFixed(1) + '%';
      svg.style.top    = (Math.random() * 100).toFixed(1) + '%';
      svg.style.margin = (-z / 2) + 'px 0 0 ' + (-z / 2) + 'px';
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M34 0C36 22 46 32 68 34C46 36 36 46 34 68C32 46 22 36 0 34C22 32 32 22 34 0Z');
      svg.appendChild(p);
      layer.appendChild(svg);
      setTimeout(function() { svg.remove(); }, life + 50);
    };
    var start = function() {
      if (timer || µ._mjs_fxCalm()) return;
      one();
      timer = setInterval(one, every);
    };
    var stop = function() {
      clearInterval(timer);
      timer = null;
    };
    var gate = µ._mjs_fxRun(el, s.on, start, stop, life * 3);
    var off  = function() {
      gate();
      stop();
      layer.remove();
      restore();
    };
    // la vie d'une étincelle tenue par une variable : sa variable CSS suit (le moteur) ; celles à naître
    // vivent la nouvelle durée, la cadence suit (le nombre à la fois reste celui de count)
    off.set = function(k, v) {
      if (k !== 'speed') return false;
      life  = µ._mjs_fxMs(v, 700);
      every = Math.max(20, life / µ._mjs_fxCount(s.count || 10));
      if (!timer) return;
      clearInterval(timer);
      timer = setInterval(one, every);
    };
    return off;
  }
};
