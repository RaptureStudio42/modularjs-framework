// mjs_fx_bounce — `*bounce` : une vague de lettres qui sautent, en boucle. Sur un calque de lettres
// posé par-dessus le texte, qui reste en place. Réglages : height (hauteur du saut en px ; 14),
// speed (un cycle ; 1.4s), step (l'écart entre deux lettres ; 90ms), order (le sens de la vague :
// right, left, center, edges, random), easing, on (always, hover, view, click, load).

µ._mjs_fxDefs.bounce = {
  css: µ._mjs_fxOrderCss('bounce')
    + '[mjs-fx~="bounce"] [mjs-fx-letter]{animation:var(--mjs-fx-bounce-go,mjs-fx-bounce) var(--mjs-bounce-speed,1.4s) var(--mjs-bounce-easing,ease-in-out) calc(var(--mjs-fx-bounce-k) * var(--mjs-bounce-step,90ms)) var(--mjs-fx-bounce-times,infinite)}'
    + '@keyframes mjs-fx-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(calc(-1 * var(--mjs-bounce-height,14px)))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="bounce"] [mjs-fx-letter][mjs-fx-letter]{animation:none}}',
  vars: { height: 'px', speed: '', step: '', easing: '' },
  setup: function(el, s, comp) {
    if (s.order && s.order !== 'right') µ._mjs_dom.setAttribute(el, 'mjs-fx-bounce-order', s.order);
    var tx   = µ._mjs_fxLayer(comp, el);
    var gate = µ._mjs_fxLoop(el, 'bounce', s.on);
    return function() {
      gate();
      tx.off();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-bounce-order');
    };
  }
};
