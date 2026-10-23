// animations/wheel.coffee — un rayon balaie la balise comme l'aiguille d'une horloge et la découvre
// (la « roue » des logiciels de présentation, le « clock wipe » du montage) : `spokes` rayons à la
// fois, autour de `origin` ([x, y] en fractions de la balise), dans le sens des aiguilles d'une
// montre — `reverse` : dans l'autre. Options : spokes (1), origin, reverse, duration (700), delay,
// easing (linear).
(function(opts = {}) {
  var n, ox, oy, pct, rev, setup;
  n = Math.max(1, opts.spokes || 1);
  ox = opts.origin ? opts.origin[0] : 0.5;
  oy = opts.origin ? opts.origin[1] : 0.5;
  rev = !!opts.reverse;
  pct = function(v) {
    return Math.round(v * 1000) / 1000;
  };
  setup = function(node) {
    var ref, ref1, ref2, ref3;
    return {
      delay: (ref = opts.delay) != null ? ref : 0,
      duration: (ref1 = opts.duration) != null ? ref1 : 700,
      easing: µ.easing.resolve((ref2 = opts.easing) != null ? ref2 : 'linear'),
      steps: (ref3 = opts.steps) != null ? ref3 : 60,
      css: function(t, u) {
        // chaque secteur de 360/n degrés se découvre depuis midi ; à t = 1, tout est visible
        var sector = 360 / n;
        var a = pct(t * sector);
        var at = `at ${pct(ox * 100)}% ${pct(oy * 100)}%`;
        return {
          maskImage: rev
            ? `repeating-conic-gradient(from 0deg ${at}, transparent 0deg ${pct(sector - a)}deg, #000 ${pct(sector - a)}deg ${pct(sector)}deg)`
            : `repeating-conic-gradient(from 0deg ${at}, #000 0deg ${a}deg, transparent ${a}deg ${pct(sector)}deg)`
        };
      }
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
