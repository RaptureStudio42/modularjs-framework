// mjs_fx_outline — `*outline` : le texte en contour, qui se remplit. Réglages : color (contour et
// remplissage ; la couleur du texte), width (épaisseur du contour en px ; 1.5), fill (se remplir ;
// oui), direction (le sens du remplissage : right, left, up, down), duration (500ms), on (hover :
// au survol ; view : dès que la balise est à l'écran ; click : chaque clic ; always : rempli).

µ._mjs_fxDefs.outline = {
  css: '[mjs-fx~="outline"]{-webkit-text-fill-color:transparent;-webkit-text-stroke:var(--mjs-outline-width,1.5px) var(--mjs-outline-color,currentColor);background-image:linear-gradient(var(--mjs-outline-color,currentColor),var(--mjs-outline-color,currentColor));background-repeat:no-repeat;background-size:0 100%;background-position:left center;-webkit-background-clip:text;background-clip:text}'
    // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
    + '[mjs-fx~="outline"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="outline"][mjs-fx-outline-dir="left"]{background-position:right center}'
    + '[mjs-fx~="outline"][mjs-fx-outline-dir="up"]{background-size:100% 0;background-position:center bottom}'
    + '[mjs-fx~="outline"][mjs-fx-outline-dir="down"]{background-size:100% 0;background-position:center top}'
    + '[mjs-fx~="outline"][mjs-fx-on~="outline"]:not([mjs-fx-outline-nofill]){background-size:100% 100%}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="outline"][mjs-fx~="outline"]{transition:none}}',
  vars: { color: '', width: 'px', duration: '' },
  setup: function(el, s) {
    if (s.fill === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-outline-nofill', '');
    if (s.direction && s.direction !== 'right') µ._mjs_dom.setAttribute(el, 'mjs-fx-outline-dir', s.direction);
    var gate = µ._mjs_fxState(el, 'outline', s.on);
    var tr   = µ._mjs_fxTransition(el, 'outline', 'background-size var(--mjs-outline-duration,500ms) ease');
    return function() {
      gate();
      tr();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-outline-nofill');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-outline-dir');
    };
  }
};
