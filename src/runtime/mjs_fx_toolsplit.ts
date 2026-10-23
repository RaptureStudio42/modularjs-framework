// mjs_fx_toolsplit — couper une liste CSS à ses virgules de premier niveau, hors parenthèses et guillemets :
// `linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5)), url(…)` fait deux fonds
//   µ._mjs_fxCssList(list)    les éléments, sans blancs autour ; une liste vide donne [''] ; une chaîne qui n'en est pas une est lue comme du texte
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxCssList = function(v) {
  var str = String(v || '');
  var out = [];
  var at  = 0;
  var lvl = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    if (c === '"' || c === '\'') {
      for (i++; i < str.length && str.charAt(i) !== c; i++) if (str.charAt(i) === '\\') i++;
    }
    else if (c === '(') lvl++;
    else if (c === ')') lvl--;
    else if (c === ',' && lvl === 0) {
      out.push(str.slice(at, i).trim());
      at = i + 1;
    }
  }
  out.push(str.slice(at).trim());
  return out;
};
