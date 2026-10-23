// mjs_fx_toolroots — les racines d'une balise, de la sienne vers le haut : son shadow root, celui de son hôte, jusqu'au document (un
// défilement ne sort pas d'une ombre : il faut un écouteur à chaque racine)
//   µ._mjs_fxRoots(el)    la liste, sans doublon
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxRoots = function(el) {
  var roots = [];
  for (var r = µ._mjs_dom.getRootNode(el); r && roots.indexOf(r) < 0; r = r.host && µ._mjs_dom.getRootNode(r.host)) roots.push(r);
  return roots;
};
