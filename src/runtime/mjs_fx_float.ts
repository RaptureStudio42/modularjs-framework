// mjs_fx_float — `*float` : un flottement doux, en boucle. Réglages : distance (px ; 12), speed (un
// aller-retour ; 3s), direction (le côté où la balise flotte : un mot — up, down-left… — ou un
// angle, 0 = vers le haut ; up), easing, on (always, hover, view, click, load).
// Le flottement s'ajoute au transform de l'auteur (animation-composition: add) : un badge centré par
// translate(-50%, -50%) flotte à sa place.

µ._mjs_fxDefs.float = {
  css: '[mjs-fx~="float"]{animation:var(--mjs-fx-float-go,mjs-fx-float) var(--mjs-float-speed,3s) var(--mjs-float-easing,ease-in-out) 0s var(--mjs-fx-float-times,infinite);animation-composition:add}'
    + '@keyframes mjs-fx-float{0%,100%{transform:translate(0,0)}50%{transform:translate(calc(var(--mjs-fx-float-x,0) * var(--mjs-float-distance,12px)),calc(var(--mjs-fx-float-y,-1) * var(--mjs-float-distance,12px)))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="float"][mjs-fx~="float"]{animation:none}}',
  vars: { distance: 'px', speed: '', easing: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxMovable(el);
    var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 0));
    el.style.setProperty('--mjs-fx-float-x', String(v.x));
    el.style.setProperty('--mjs-fx-float-y', String(v.y));
    var gate = µ._mjs_fxLoop(el, 'float', s.on);
    return function() {
      gate();
      el.style.removeProperty('--mjs-fx-float-x');
      el.style.removeProperty('--mjs-fx-float-y');
      restore();
    };
  }
};
