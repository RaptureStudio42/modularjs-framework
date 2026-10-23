// mjs_fx_shake — `*shake` : une secousse (une saisie refusée…). Tenu par une variable,
// `*shake($erreur)` secoue la balise chaque fois que la variable passe à vrai ; sinon, la secousse
// part au geste choisi par `on`. Réglages : when (la variable), on (view, hover, click, load ;
// click), direction (l'axe de la secousse : un mot ou un angle — right ou left : de gauche à
// droite, up ou down : de haut en bas, 45 : en diagonale ; right), distance (px ; 8), repeat (le
// nombre de secousses ; 1), duration (une secousse ; 450ms). La secousse s'ajoute au transform de
// l'auteur (animation-composition: add).

µ._mjs_fxDefs.shake = {
  css: '[mjs-fx~="shake"][mjs-fx-play~="shake"]{animation:mjs-fx-shake var(--mjs-shake-duration,450ms) ease 0s var(--mjs-shake-repeat,1);animation-composition:add}'
    + '@keyframes mjs-fx-shake{0%,100%{transform:translate(0,0)}20%,60%{transform:translate(calc(var(--mjs-fx-shake-x,1) * -1 * var(--mjs-shake-distance,8px)),calc(var(--mjs-fx-shake-y,0) * -1 * var(--mjs-shake-distance,8px)))}40%,80%{transform:translate(calc(var(--mjs-fx-shake-x,1) * var(--mjs-shake-distance,8px)),calc(var(--mjs-fx-shake-y,0) * var(--mjs-shake-distance,8px)))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="shake"][mjs-fx-play~="shake"][mjs-fx-play~="shake"]{animation:none}}',
  vars: { distance: 'px', repeat: '', duration: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxMovable(el);
    var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 90));
    el.style.setProperty('--mjs-fx-shake-x', String(v.x));
    el.style.setProperty('--mjs-fx-shake-y', String(v.y));
    // `when` suivi : chaque changement de la variable repose l'effet (µ._mjs_fxSet) — vrai = secousse
    if (s.when === true) µ._mjs_fxPlay(el, 'shake');
    var stop = s.when === void 0 ? µ._mjs_fxWhen(el, s.on || 'click', function() { µ._mjs_fxPlay(el, 'shake'); }) : function() {};
    return function() {
      stop();
      µ._mjs_fxPlay(el, 'shake', true);
      el.style.removeProperty('--mjs-fx-shake-x');
      el.style.removeProperty('--mjs-fx-shake-y');
      restore();
    };
  }
};
