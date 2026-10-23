// mjs_fx_toolsvg — le <svg> caché (taille nulle, hors du flux, masqué aux lecteurs d'écran) qui porte les filtres d'un effet, posé dans la
// racine de la balise : le <body> du document, ou son shadow root (ou le fragment où elle attend encore d'être posée : le <svg> y suit la balise),
// là où le filtre `url(#id)` se résout ; sans getRootNode (navigateur ancien), le <body>
//   var svg = µ._mjs_fxSvgDefs(el);    l'effet y ajoute ses <filter> (et son repère éventuel) et retire le <svg> à son retrait
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxSvgDefs = function(el) {
  var root = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
  var tpl  = document.createElement('template');
  tpl.innerHTML = '<svg aria-hidden="true" width="0" height="0"></svg>';
  var svg = (root.nodeType === 11 ? root : document.body).appendChild(tpl.content.firstChild);
  svg.style.position = 'absolute';
  return svg;
};
