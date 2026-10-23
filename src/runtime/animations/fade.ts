// animations/fade.ts — la balise apparaît en fondu, de transparente à son opacité, et disparaît de même
// options : duration (400), delay (0), easing (linear)
(function(opts = {}) {
  return µ._mjs_animFrom(opts, { easing: 'linear' });
});
