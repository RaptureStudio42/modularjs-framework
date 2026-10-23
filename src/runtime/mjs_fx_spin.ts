// mjs_fx_spin — `*spin` : une rotation continue. Réglages : speed (un tour ; 2.5s), direction (cw,
// ccw : sens des aiguilles d'une montre ou inverse ; cw), axis (z : à plat ; x : comme une roue qui
// bascule vers soi ; y : comme une pièce qui tourne sur elle-même ; z), origin (le point autour
// duquel elle tourne : center, top-left…, « x% y% » ; center), easing, on (always, hover, view,
// click, load). La rotation s'ajoute au transform de l'auteur (animation-composition: add) : un badge
// centré par translate(-50%, -50%) tourne sur place.

µ._mjs_fxDefs.spin = {
  css: '[mjs-fx~="spin"]{transform-origin:var(--mjs-fx-spin-origin,50% 50%);animation:var(--mjs-fx-spin-go,var(--mjs-fx-spin-name,mjs-fx-spin)) var(--mjs-spin-speed,2.5s) var(--mjs-spin-easing,linear) 0s var(--mjs-fx-spin-times,infinite) var(--mjs-fx-spin-dir,normal);animation-composition:add}'
    + '[mjs-fx~="spin"][mjs-fx-spin-axis="x"]{--mjs-fx-spin-name:mjs-fx-spin-x}'
    + '[mjs-fx~="spin"][mjs-fx-spin-axis="y"]{--mjs-fx-spin-name:mjs-fx-spin-y}'
    + '@keyframes mjs-fx-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'
    + '@keyframes mjs-fx-spin-x{from{transform:rotateX(0deg)}to{transform:rotateX(360deg)}}'
    + '@keyframes mjs-fx-spin-y{from{transform:rotateY(0deg)}to{transform:rotateY(360deg)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="spin"][mjs-fx~="spin"]{animation:none}}',
  vars: { speed: '', easing: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxMovable(el);
    if (s.axis && s.axis !== 'z') µ._mjs_dom.setAttribute(el, 'mjs-fx-spin-axis', s.axis);
    if (s.direction === 'ccw') el.style.setProperty('--mjs-fx-spin-dir', 'reverse');
    var at = µ._mjs_fxPoint(s.origin);
    if (s.origin && at) el.style.setProperty('--mjs-fx-spin-origin', s.origin.indexOf('%') > 0 ? s.origin : at.x * 100 + '% ' + at.y * 100 + '%');
    var gate = µ._mjs_fxLoop(el, 'spin', s.on);
    return function() {
      gate();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-spin-axis');
      el.style.removeProperty('--mjs-fx-spin-dir');
      el.style.removeProperty('--mjs-fx-spin-origin');
      restore();
    };
  }
};
