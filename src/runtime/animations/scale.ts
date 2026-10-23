// animations/scale.ts — la balise grandit jusqu'à sa taille depuis `start` (0 : un point ; 20 : vingt fois trop grande) en s'opacifiant
// de la part `opacity` (0) de son opacité jusqu'à tout ; `origin` (« x% y% ») : le point d'où elle grandit, le centre par défaut ;
// `axis` : x ou y, elle ne grandit que dans ce sens (both par défaut)
// options : start (0), opacity (0), origin, axis, duration (400), delay (0), easing (ease-out)
(function(opts = {}) {
  var gap = 1 - (opts.start ?? 0);
  var fn  = opts.axis === 'x' ? 'scaleX' : opts.axis === 'y' ? 'scaleY' : 'scale';
  return µ._mjs_animFrom(opts, {
    add: function(node, style, rest) {
      var tf = style.transform === 'none' ? '' : style.transform;
      // l'opacité de départ est une part de celle de la balise : celle de l'enveloppe n'est pas la bonne
      var od = rest * (1 - (opts.opacity ?? 0));
      return function(t, u) {
        var f = { transform: `${tf} ${fn}(${1 - gap * u})`.trim(), opacity: rest - od * u };
        if (opts.origin) f.transformOrigin = opts.origin;
        return f;
      };
    }
  });
});
