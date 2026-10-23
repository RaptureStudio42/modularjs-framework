// animations/fly.ts — la balise arrive de loin et se pose : elle part déplacée de `x`, `y` (un nombre en px, ou une longueur écrite comme
// « 10% »), transparente à `opacity`, floue de `blur` (px, au centième), tournée de `rotate` et penchée de `skew` (degrés, la rotation d'abord :
// l'inclinaison tourne avec la balise), et se redresse en arrivant ; elle repart comme elle est venue
// options : x, y (0), opacity (0), blur, skew, rotate (sans), duration (400), delay (0), easing (ease-out)
(function(opts = {}) {
  var x   = µ._mjs_animLen(opts.x ?? 0);
  var y   = µ._mjs_animLen(opts.y ?? 0);
  var deg = function(v, u) {
    return Math.round(v * u * 100) / 100 || 0;
  };
  return µ._mjs_animFrom(opts, {
    opacity: opts.opacity,
    add: function(node, style) {
      var tf = style.transform === 'none' ? '' : style.transform;
      var fl = style.filter === 'none' ? '' : style.filter;
      return function(t, u, o) {
        var f = { transform: `${tf} translate(${u * x[0]}${x[1]}, ${u * y[0]}${y[1]})${opts.rotate ? ` rotate(${deg(opts.rotate, u)}deg)` : ''}${opts.skew ? ` skewX(${deg(opts.skew, u)}deg)` : ''}`.trim(), opacity: o };
        if (opts.blur) f.filter = `${fl} blur(${Math.round(opts.blur * u * 100) / 100}px)`.trim();
        return f;
      };
    }
  });
});
