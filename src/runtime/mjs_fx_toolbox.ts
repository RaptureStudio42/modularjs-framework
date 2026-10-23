// mjs_fx_toolbox — la boîte d'une balise à l'écran : pour les effets qui suivent le pointeur dans le repère d'une balise (la boîte se lit
// à l'entrée de la souris, se garde, et se relit quand elle a pu changer : mjs_fx_toolwatch.ts)
//   µ._mjs_fxBox(el)    { l, t, sx, sy } : coin haut-gauche à l'écran, échelle (boîte à l'écran sur boîte de mise en page : la
//                       transformation d'un ancêtre) ; 1 quand l'une des deux n'a pas de taille (balise sans boîte, svg)
//                       un point de la fenêtre se rend dans le repère intérieur de la balise (bordure déduite, échelle défaite) par
//                       (clientX - l) / sx - el.clientLeft
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxBox = function(el) {
  var r = µ._mjs_dom.getBoundingClientRect(el);
  var w = el.offsetWidth;
  var h = el.offsetHeight;
  return { l: r.left, t: r.top, sx: w && r.width ? r.width / w : 1, sy: h && r.height ? r.height / h : 1 };
};
