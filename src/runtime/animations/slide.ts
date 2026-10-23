// animations/slide.ts — la balise se déplie : sa hauteur (sa largeur avec `axis: x`), son remplissage, ses marges et ses bordures de ce
// sens passent de rien à leur valeur, et son opacité revient en entier dans les premiers 5 % du trajet ; elle se replie de même. Les
// dimensions se lisent à chaque jeu, sur la balise libérée de l'animation qui la figeait (la mise en page est forcée d'abord)
// options : axis (y), duration (400), delay (0), easing (ease-out)
(function(opts = {}) {
  return µ._mjs_animFrom(opts, {
    add: function(node, style, rest) {
      var y     = (opts.axis ?? 'y') === 'y';
      var size  = node[y ? 'offsetHeight' : 'offsetWidth'];
      var ends  = y ? ['Top', 'Bottom'] : ['Left', 'Right'];
      var props = [y ? 'height' : 'width', 'padding' + ends[0], 'padding' + ends[1], 'margin' + ends[0], 'margin' + ends[1], 'border' + ends[0] + 'Width', 'border' + ends[1] + 'Width'];
      var sizes = props.map(function(p) { return parseFloat(style[p]) || 0; });
      var main  = parseFloat(style[props[0]]);
      // la dimension calculée ; « auto » ne se lit pas, la mesurée la remplace
      sizes[0] = isFinite(main) ? main : size;
      return function(t) {
        var f = { overflow: 'hidden', opacity: Math.min(t * 20, 1) * rest };
        props.forEach(function(p, i) { f[p] = t * sizes[i] + 'px'; });
        f[y ? 'minHeight' : 'minWidth'] = '0px';
        return f;
      };
    }
  });
});
