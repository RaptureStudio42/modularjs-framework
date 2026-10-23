// mjs_fx_clay — `*clay` : de la pâte à modeler — la balise se gonfle en relief (deux ombres
// portées, deux ombres internes opposées), ou se creuse. Réglages : color (la pâte ; #1f83f2 ;
// pour un creux, la couleur du fond), shape (raised : en relief ; hollow : en creux), radius
// (l'arrondi en px ; 30), on (always : toujours ; hover, view, click : au geste, avec une
// transition de 0.5s ; always).

µ._mjs_fxDefs.clay = {
  // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
  css: '[mjs-fx~="clay"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="clay"][mjs-fx-on~="clay"]{background:var(--mjs-clay-color,#1f83f2);border-radius:var(--mjs-clay-radius,30px);box-shadow:25px 25px 75px rgba(0,0,0,.25),10px 10px 70px rgba(0,0,0,.25),inset 5px 5px 20px rgba(255,255,255,.25),inset -5px -5px 15px rgba(0,0,0,.75)}'
    + '[mjs-fx~="clay"][mjs-fx-on~="clay"][mjs-fx-clay-hollow]{box-shadow:5px 5px 15px rgba(0,0,0,.25),inset -3px -3px 5px rgba(0,0,0,.5)}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="clay"]{transition:none}}',
  vars: { color: '', radius: 'px' },
  setup: function(el, s) {
    if (s.shape === 'hollow') µ._mjs_dom.setAttribute(el, 'mjs-fx-clay-hollow', '');
    var gate = µ._mjs_fxState(el, 'clay', s.on || 'always');
    var tr   = µ._mjs_fxTransition(el, 'clay', 'background .5s,box-shadow .5s,border-radius .5s');
    return function() {
      gate();
      tr();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-clay-hollow');
    };
  }
};
