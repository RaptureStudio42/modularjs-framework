// animations/blur.ts — la balise se précise : floue de `amount` (5 ; un nombre en px, ou une longueur écrite comme « 1em ») et transparente
// à `opacity` (0) au départ, nette et pleine à l'arrivée ; elle repart comme elle est venue
// options : amount (5), opacity (0), duration (400), delay (0), easing (ease-in-out)
(function(opts = {}) {
  var amount = µ._mjs_animLen(opts.amount ?? 5);
  return µ._mjs_animFrom(opts, {
    easing: 'ease-in-out',
    opacity: opts.opacity,
    add: function(node, style) {
      var fl = style.filter === 'none' ? '' : style.filter;
      return function(t, u, o) {
        return { opacity: o, filter: `${fl} blur(${u * amount[0]}${amount[1]})`.trim() };
      };
    }
  });
});
