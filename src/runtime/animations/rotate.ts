// animations/rotate.ts — la balise arrive en tournant sur elle-même (autour de `origin`, « x% y% », le centre par défaut), en grandissant
// depuis `start` et en s'opacifiant ; elle repart comme elle est venue
// options : angle (degrés ; -200), start (l'échelle de départ, au millième ; 1), opacity (l'opacité de départ ; 0), origin, duration (600), delay (0), easing (ease-out)
(function(opts = {}) {
  var angle = opts.angle ?? -200;
  var gap   = 1 - (opts.start ?? 1);
  return µ._mjs_animFrom(opts, {
    duration: 600,
    opacity: opts.opacity,
    add: function(node, style) {
      var tf = style.transform === 'none' ? '' : style.transform;
      return function(t, u, o) {
        var f = { transform: `${tf} rotate(${Math.round(angle * u * 100) / 100 || 0}deg) scale(${Math.round((1 - gap * u) * 1000) / 1000})`.trim(), opacity: o };
        if (opts.origin) f.transformOrigin = opts.origin;
        return f;
      };
    }
  });
});
