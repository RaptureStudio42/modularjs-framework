// mjs_fx_iso — `*iso` : la balise devient un cube vu de trois quarts (vue isométrique) : elle en
// est le dessus, deux pseudo-éléments en font les côtés, dans sa couleur un peu assombrie. Au
// geste, le cube se soulève. Réglages : depth (l'épaisseur du cube en px ; 60), lift (la hauteur
// du soulèvement en px ; 20), shadow (l'ombre portée ; oui), on (hover, view, click, always).

µ._mjs_fxDefs.iso = {
  css: '[mjs-fx~="iso"]{transform:rotate(-30deg) skew(25deg) translate(0,0);box-shadow:calc(-1 * var(--mjs-iso-depth,60px) - 10px) calc(var(--mjs-iso-depth,60px) + 10px) 25px rgba(0,0,0,.2)}'
    // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
    + '[mjs-fx~="iso"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="iso"][mjs-fx-on~="iso"]{transform:rotate(-30deg) skew(25deg) translate(var(--mjs-iso-lift,20px),calc(-1 * var(--mjs-iso-lift,20px)));box-shadow:calc(-1 * var(--mjs-iso-depth,60px) - 10px - var(--mjs-iso-lift,20px)) calc(var(--mjs-iso-depth,60px) + 10px + var(--mjs-iso-lift,20px)) 30px rgba(0,0,0,.25)}'
    + '[mjs-fx~="iso"][mjs-fx-iso-flat]{box-shadow:none}'
    + '[mjs-fx~="iso"]::before{content:"";position:absolute;left:calc(-1 * var(--mjs-iso-depth,60px));top:calc(var(--mjs-iso-depth,60px) / 2);width:var(--mjs-iso-depth,60px);height:100%;background:inherit;box-shadow:inset 0 0 0 2000px rgba(0,0,0,.1);transform:skewY(-45deg);pointer-events:none}'
    + '[mjs-fx~="iso"]::after{content:"";position:absolute;left:calc(var(--mjs-iso-depth,60px) / -2);bottom:calc(-1 * var(--mjs-iso-depth,60px));width:100%;height:var(--mjs-iso-depth,60px);background:inherit;box-shadow:inset 0 0 0 2000px rgba(0,0,0,.05);transform:skewX(-45deg);pointer-events:none}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="iso"]{transition:none}}',
  vars: { depth: 'px', lift: 'px' },
  setup: function(el, s) {
    var tr      = µ._mjs_fxTransition(el, 'iso', 'transform .5s,box-shadow .5s');
    var inline  = µ._mjs_fxMovable(el);
    var restore = µ._mjs_fxRelative(el);
    if (s.shadow === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-iso-flat', '');
    var gate = µ._mjs_fxState(el, 'iso', s.on);
    return function() {
      gate();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-iso-flat');
      restore();
      inline();
      tr();
    };
  }
};
