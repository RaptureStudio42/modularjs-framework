// animations/swipe.coffee — front dégradé qui balaie l'élément et le révèle derrière lui, jumeau « sur un élément » du rideau de page swipe (mjs_vt_presets.ts)
// Le front suit `angle` (en degrés, 0 = vers le haut, 90 = vers la droite, comme un dégradé CSS) ;
// `dir`/`direction` (right, left, up, down) reste compris.
(function(opts = {}) {
  var angle, css, pct, setup, words;
  pct = function(v) {
    return Math.round(v * 1000) / 1000;
  };
  words = { up: 0, right: 90, down: 180, left: 270 };
  angle = typeof opts.angle === 'number' ? opts.angle : words[opts.dir != null ? opts.dir : opts.direction];
  if (angle == null) {
    if (opts.dir != null || opts.direction != null) µ.warn("[ModularJS] *swipe : direction invalide '" + (opts.dir != null ? opts.dir : opts.direction) + "' — repli vers la droite.");
    angle = 90;
  }
  // le masque : noir (visible) jusqu'au front, transparent après ; le front, large de 20 % de la
  // ligne du dégradé, traverse toute la balise quand t va de 0 à 1
  css = function(t, u) {
    var p = t * 120;
    return {
      maskImage: `linear-gradient(${angle}deg, #000 ${pct(p - 20)}%, transparent ${pct(p)}%)`,
      maskRepeat: 'no-repeat'
    };
  };
  setup = function(node) {
    var ref, ref1, ref2, ref3;
    return {
      delay: (ref = opts.delay) != null ? ref : 0,
      duration: (ref1 = opts.duration) != null ? ref1 : 320,
      easing: µ.easing.resolve((ref2 = opts.easing) != null ? ref2 : 'ease-out'),
      steps: (ref3 = opts.steps) != null ? ref3 : 60,
      css
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
