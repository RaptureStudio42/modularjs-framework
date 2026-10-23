// mjs_fx_extrude — `*extrude` : un relief 3D sous le texte (une pile d'ombres), qui se creuse.
// Réglages : color (le relief ; bleu), depth (épaisseur en px ; 6), angle (le côté du relief, en
// degrés : 0 à droite, 90 en bas ; 45), grow (ce qu'il gagne quand il se creuse, en px ; 4), on
// (hover, view, click, always : quand il se creuse).

µ._mjs_fxDefs.extrude = {
  // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
  css: '[mjs-fx~="extrude"]{text-shadow:var(--mjs-fx-extrude)}'
    + '[mjs-fx~="extrude"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="extrude"][mjs-fx-on~="extrude"]{transform:translate(var(--mjs-fx-extrude-dx),var(--mjs-fx-extrude-dy));text-shadow:var(--mjs-fx-extrude-deep)}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="extrude"]{transition:none}[mjs-fx~="extrude"][mjs-fx-on~="extrude"]{transform:none}}',
  vars: { color: '' },
  setup: function(el, s) {
    var depth = s.depth || 6;
    var grow  = s.grow === void 0 ? 4 : s.grow;
    var a     = (typeof s.angle === 'number' ? s.angle : 45) * Math.PI / 180;
    var dx    = Math.cos(a);
    var dy    = Math.sin(a);
    var pile = function(n) {
      var out = [];
      for (var i = 1; i <= n; i++) out.push((i * dx).toFixed(2) + 'px ' + (i * dy).toFixed(2) + 'px 0 var(--mjs-extrude-color,#2563eb)');
      out.push(((n + 1) * dx).toFixed(2) + 'px ' + ((n + 1) * dy).toFixed(2) + 'px ' + (n * 2) + 'px rgba(0,0,0,.55)');
      return out.join(',');
    };
    el.style.setProperty('--mjs-fx-extrude', pile(depth));
    el.style.setProperty('--mjs-fx-extrude-deep', pile(depth + grow));
    el.style.setProperty('--mjs-fx-extrude-dx', (-grow * dx * .75).toFixed(2) + 'px');
    el.style.setProperty('--mjs-fx-extrude-dy', (-grow * dy * .75).toFixed(2) + 'px');
    var tr      = µ._mjs_fxTransition(el, 'extrude', 'transform .3s ease,text-shadow .3s ease');
    var restore = µ._mjs_fxMovable(el);
    var gate    = µ._mjs_fxState(el, 'extrude', s.on);
    return function() {
      gate();
      ['--mjs-fx-extrude', '--mjs-fx-extrude-deep', '--mjs-fx-extrude-dx', '--mjs-fx-extrude-dy'].forEach(function(p) { el.style.removeProperty(p); });
      restore();
      tr();
    };
  }
};
