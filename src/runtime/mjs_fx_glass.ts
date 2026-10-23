// mjs_fx_glass — `*glass` : du verre dépoli — la balise floute ce qu'il y a derrière elle, sous un
// voile clair, un fin liseré et une ombre. Réglages : blur (le flou en px ; 10), tint (le voile ;
// blanc translucide), border (le liseré ; oui), shadow (l'ombre portée ; oui).

µ._mjs_fxDefs.glass = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  css: '[mjs-fx~="glass"]{background:linear-gradient(var(--mjs-glass-tint,rgba(255,255,255,.13)),transparent);-webkit-backdrop-filter:blur(var(--mjs-glass-blur,10px));backdrop-filter:blur(var(--mjs-glass-blur,10px));border:1px solid rgba(255,255,255,.1);box-shadow:0 25px 25px rgba(0,0,0,.25)}'
    + '[mjs-fx~="glass"][mjs-fx-glass-noborder]{border-color:transparent}'
    + '[mjs-fx~="glass"][mjs-fx-glass-noshadow]{box-shadow:none}',
  vars: { blur: 'px', tint: '' },
  setup: function(el, s) {
    if (s.border === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-glass-noborder', '');
    if (s.shadow === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-glass-noshadow', '');
    return function() {
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-glass-noborder');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-glass-noshadow');
    };
  }
};
