// mjs_fx_underline — `*underline` : un soulignement qui se dessine (un pseudo-élément `::after` de
// la balise). Réglages : color (la couleur du texte), thickness (px ; 3), offset (l'écart sous le
// texte en px ; 2), origin (left, center, right : d'où part le trait), duration (350ms), easing, on
// (hover, view, click, always).

µ._mjs_fxDefs.underline = {
  css: '[mjs-fx~="underline"]::after{content:"";position:absolute;left:0;bottom:calc(-1 * var(--mjs-underline-offset,2px));width:100%;height:var(--mjs-underline-thickness,3px);border-radius:2px;background:var(--mjs-underline-color,currentColor);transform:scaleX(0);transform-origin:right;transition:transform var(--mjs-underline-duration,350ms) var(--mjs-underline-easing,ease);pointer-events:none}'
    + '[mjs-fx~="underline"][mjs-fx-on~="underline"]::after{transform:scaleX(1);transform-origin:left}'
    + '[mjs-fx~="underline"][mjs-fx-underline-origin="center"]::after,[mjs-fx~="underline"][mjs-fx-underline-origin="center"][mjs-fx-on~="underline"]::after{transform-origin:center}'
    + '[mjs-fx~="underline"][mjs-fx-underline-origin="right"]::after{transform-origin:left}'
    + '[mjs-fx~="underline"][mjs-fx-underline-origin="right"][mjs-fx-on~="underline"]::after{transform-origin:right}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="underline"]::after{transition:none}}',
  vars: { color: '', thickness: 'px', offset: 'px', duration: '', easing: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxRelative(el);
    if (s.origin && s.origin !== 'left') µ._mjs_dom.setAttribute(el, 'mjs-fx-underline-origin', s.origin);
    var gate = µ._mjs_fxState(el, 'underline', s.on);
    return function() {
      gate();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-underline-origin');
      restore();
    };
  }
};
