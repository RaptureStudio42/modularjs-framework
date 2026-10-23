// mjs_fx_toolwatch — surveiller l'entourage d'une balise : ce qui peut déplacer ou redimensionner sa boîte à l'écran
//   var off = µ._mjs_fxWatch(el, f, noSize);
//   f()   appelée à un défilement (de la page ou d'un conteneur, jusque dans les shadow roots), au redimensionnement de la fenêtre et à celui
//         de la balise (la première annonce de l'observateur dit seulement qu'il est posé : ignorée)
//   noSize  vrai : la taille de la balise n'est pas surveillée (aucun ResizeObserver posé), pour l'effet qui suit déjà la sienne
//   off() rend tout (écouteurs, observateur)
// sans ResizeObserver (navigateur ancien) : la taille de la balise n'est pas surveillée, le reste marche
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts) ; demande mjs_fx_toolroots.ts

µ._mjs_fxWatch = function(el, f, noSize) {
  var ac   = new AbortController();
  var o    = { capture: true, passive: true, signal: ac.signal };
  var seen = false;
  var ro   = typeof ResizeObserver === 'function' && !noSize && new ResizeObserver(function() {
    if (seen) f();
    seen = true;
  });
  µ._mjs_fxRoots(el).forEach(function(r) { µ._mjs_dom.addEventListener(r, 'scroll', f, o); });
  µ._mjs_dom.addEventListener(window, 'resize', f, o);
  if (ro) ro.observe(el);
  return function() {
    ac.abort();
    if (ro) ro.disconnect();
  };
};
