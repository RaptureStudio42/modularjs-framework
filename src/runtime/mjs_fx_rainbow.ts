// mjs_fx_rainbow — `*rainbow` : chaque lettre prend une couleur de la liste, et les couleurs
// voyagent de lettre en lettre. Sur un calque de lettres posé par-dessus le texte, qui reste en
// place. Réglages : speed (un tour complet des couleurs ; 3s), colors (la liste ; un arc-en-ciel),
// animate (non : des couleurs fixes), order (l'ordre des lettres : right, left, center, edges,
// random — le voyage des couleurs le suit), on (always, hover, view, click, load). La liste se règle
// aussi par thème : `$$rainbow-colors: red, gold`.

µ._mjs_fxDefs.rainbow = {
  css: '[mjs-fx~="rainbow"] [mjs-fx-letter]{transition:color .25s linear,-webkit-text-fill-color .25s linear}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="rainbow"] [mjs-fx-letter][mjs-fx-letter]{transition:none}}',
  vars: {},
  setup: function(el, s, comp) {
    var tx    = µ._mjs_fxLayer(comp, el);
    var pal   = s.colors || µ._mjs_fxList(el, '--mjs-rainbow-colors') || ['#ff4d4d', '#ff9f1a', '#ffe14d', '#4dff88', '#4dd2ff', '#6b6bff', '#d24dff'];
    var shift = 0;
    var timer = null;
    var rank  = [];
    var paint = function() {
      var ls = tx.layer.querySelectorAll('[mjs-fx-letter]');
      if (rank.length !== ls.length) rank = µ._mjs_fxRanks(ls.length, s.order);
      for (var j = 0; j < ls.length; j++) {
        var c = pal[(((rank[j] - shift) % pal.length) + pal.length) % pal.length];
        ls[j].style.setProperty('color', c);
        ls[j].style.setProperty('-webkit-text-fill-color', c);
      }
    };
    tx.onBuild(function() {
      rank = [];
      paint();
    });
    paint();
    var cycle = µ._mjs_fxMs(s.speed, 3000);
    var start = function() {
      if (s.animate === false || µ._mjs_fxCalm() || timer) return;
      timer = setInterval(function() {
        shift++;
        paint();
      }, Math.max(30, cycle / pal.length));
    };
    var stop = function() {
      clearInterval(timer);
      timer = null;
    };
    var gate = µ._mjs_fxRun(el, s.on, start, stop, cycle);
    return function() {
      gate();
      tx.off();
    };
  }
};
