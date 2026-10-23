// mjs_fx_noise — `*noise` : un grain de pellicule par-dessus la balise, comme une vieille photo (un
// pseudo-élément `::after` : un bruit gris et opaque, mêlé aux couleurs). Réglages : amount (la force du grain, de 0 à 1 ; 0.5), speed (le grain
// qui s'agite ; 0.5s — `0` = grain immobile), blend (overlay, soft-light, multiply, screen : la
// façon dont le grain se mêle aux couleurs ; overlay). Effets économes : le grain s'immobilise.

µ._mjs_fxDefs.noise = {
  css: '[mjs-fx~="noise"]::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'.8\' numOctaves=\'3\' stitchTiles=\'stitch\'/><feColorMatrix type=\'saturate\' values=\'0\'/><feComponentTransfer><feFuncA type=\'linear\' slope=\'0\' intercept=\'1\'/></feComponentTransfer></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\'/></svg>");opacity:var(--mjs-noise-amount,.5);mix-blend-mode:var(--mjs-noise-blend,overlay)}'
    + '[mjs-fx~="noise"][mjs-fx-noise-moving]::after{animation:mjs-fx-noise var(--mjs-noise-speed,.5s) steps(3) infinite;animation-play-state:var(--mjs-fx-lite-play,running)}'
    + '@keyframes mjs-fx-noise{33%{background-position:30px 10px}66%{background-position:-20px 25px}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="noise"][mjs-fx-noise-moving]::after{animation:none}}',
  vars: { amount: '', speed: '', blend: '' },
  // effets économes : suivi (un grain qui s'agite sans fin)
  heavy: true,
  setup: function(el, s) {
    var restore = µ._mjs_fxRelative(el);
    // le grain s'agite tant que sa vitesse n'est pas nulle
    var moving  = function(v) {
      if (µ._mjs_fxMs(v, 500) > 0) µ._mjs_dom.setAttribute(el, 'mjs-fx-noise-moving', '');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-noise-moving');
    };
    moving(s.speed);
    var off = function() {
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-noise-moving');
      restore();
    };
    // la vitesse tenue par une variable : sa variable CSS suit (le moteur), le grain s'agite ou se fige
    // avec elle
    off.set = function(k, v) {
      if (k !== 'speed') return false;
      moving(v);
    };
    return off;
  }
};
