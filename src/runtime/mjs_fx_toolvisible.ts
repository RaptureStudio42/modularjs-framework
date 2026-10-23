// mjs_fx_toolvisible — « n'agir que si la balise est à l'écran » : le même observateur de visibilité pour tous les effets
//   var off = µ._mjs_fxVisible(el, margin, enter, leave);
//   enter() / leave()   la balise, agrandie de `margin` (texte CSS : '200px', '100% 0px'), est à l'écran / n'y est plus (la dernière annonce
//                       du navigateur décide) ; l'état est annoncé dès que le navigateur le connaît
//   off()               rend l'observateur
// sans IntersectionObserver (navigateur ancien) : la balise est tenue pour visible, enter() est appelée tout de suite
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxVisible = function(el, margin, enter, leave) {
  if (typeof IntersectionObserver !== 'function') {
    enter();
    return function() {};
  }
  var io = new IntersectionObserver(function(e) { (e[e.length - 1].isIntersecting ? enter : leave)(); }, { rootMargin: margin });
  io.observe(el);
  return function() { io.disconnect(); };
};
