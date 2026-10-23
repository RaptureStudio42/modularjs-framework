// mjs_fx_highlight — `*highlight` : un surligneur passe derrière le texte, et y reste. Réglages :
// color (jaune translucide), height (la part du texte couverte, en % ; 45), direction (right,
// left : le sens du trait), duration (600ms), delay (0s), on (view : dès que la balise est à
// l'écran ; hover : pendant le survol ; click : chaque clic ; always : surligné d'emblée).

µ._mjs_fxDefs.highlight = {
  css: '[mjs-fx~="highlight"]{background-image:linear-gradient(transparent calc(100% - var(--mjs-highlight-height,45%)),var(--mjs-highlight-color,rgba(250,204,21,.55)) 0);background-repeat:no-repeat;background-size:0 100%;background-position:left center;-webkit-box-decoration-break:clone;box-decoration-break:clone}'
    // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
    + '[mjs-fx~="highlight"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="highlight"][mjs-fx-highlight-dir="left"]{background-position:right center}'
    + '[mjs-fx~="highlight"][mjs-fx-on~="highlight"]{background-size:100% 100%}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="highlight"]{transition:none}}',
  vars: { color: '', height: '%', duration: '', delay: '' },
  setup: function(el, s) {
    if (s.direction === 'left') µ._mjs_dom.setAttribute(el, 'mjs-fx-highlight-dir', 'left');
    var gate = µ._mjs_fxState(el, 'highlight', s.on || 'view');
    var tr   = µ._mjs_fxTransition(el, 'highlight', 'background-size var(--mjs-highlight-duration,600ms) ease var(--mjs-highlight-delay,0s)');
    return function() {
      gate();
      tr();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-highlight-dir');
    };
  }
};
