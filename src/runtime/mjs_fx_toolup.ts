// mjs_fx_toolup — remonter d'un nœud à travers les shadow roots, et savoir si un nœud est dans un autre
//   µ._mjs_fxParent(n)         le parent de `n` ; à la racine d'une ombre, l'hôte de l'ombre ; null au sommet
//   µ._mjs_fxWithin(root, n)   `root` est-il un ancêtre strict de `n`, ombres comprises ?
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxParent = function(n) {
  return n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode;
};

µ._mjs_fxWithin = function(root, n) {
  for (n = µ._mjs_fxParent(n); n; n = µ._mjs_fxParent(n)) {
    if (n === root) return true;
  }
  return false;
};
