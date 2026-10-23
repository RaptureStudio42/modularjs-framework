// mjs_fx_stack — `*stack` : la balise se soulève et dévoile une pile de cartes dessous (des ombres
// pleines, décalées en diagonale). Réglages : layers (le nombre de cartes dessous ; 2), gap
// (l'écart entre deux cartes en px ; 40), color (les cartes dessous ; #fff), on (hover, view,
// click, always).

µ._mjs_fxDefs.stack = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
  css: '[mjs-fx~="stack"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="stack"][mjs-fx-on~="stack"]{transform:translate(var(--mjs-fx-stack-lift),var(--mjs-fx-stack-lift));box-shadow:var(--mjs-fx-stack)}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="stack"]{transition:none}}',
  vars: {},
  setup: function(el, s) {
    var L = s.layers || 2;
    var g = s.gap === void 0 ? 40 : s.gap;
    var c = s.color || '#fff';
    var out = [];
    for (var k = 1; k <= L; k++) {
      out.push(((k - 1) * g + 10) + 'px ' + ((k - 1) * g + 10) + 'px 20px rgba(0,0,0,.15)');
      out.push((k * g) + 'px ' + (k * g) + 'px 0 ' + c);
    }
    out.push((L * g) + 'px ' + (L * g) + 'px 40px rgba(0,0,0,.15)');
    out.push(((L + 1) * g) + 'px ' + ((L + 1) * g) + 'px 0 rgba(0,0,0,.1)');
    el.style.setProperty('--mjs-fx-stack', out.join(','));
    el.style.setProperty('--mjs-fx-stack-lift', (-(L + 1) * g / 2) + 'px');
    var tr      = µ._mjs_fxTransition(el, 'stack', 'transform .5s,box-shadow .5s');
    var restore = µ._mjs_fxMovable(el);
    var gate    = µ._mjs_fxState(el, 'stack', s.on);
    return function() {
      gate();
      el.style.removeProperty('--mjs-fx-stack');
      el.style.removeProperty('--mjs-fx-stack-lift');
      restore();
      tr();
    };
  }
};
