// animations/shared/from.ts — l'enveloppe commune des transitions qui partent de l'état de la balise (fade, fly, scale, blur, rotate,
// slide) : µ._mjs_animFrom(opts, spec) rend leur paire { intro, outro }, la même fonction pour l'entrée et la sortie, qui lit la balise
// au moment de jouer et rend { delay, duration, easing, steps, css(t, u) }
//   opts   les réglages de la transition tels qu'elle les reçoit : delay (0), duration, easing, steps (60)
//   spec   duration (400) et easing (cubicOut) : ce qu'elle prend à défaut ; opacity (0) : l'opacité de départ, qui rejoint celle de
//          la balise à proportion de ce qui reste du trajet (u) — le seul canal de l'enveloppe, toutes les transitions s'en servent ;
//          add(node, style, rest) : ce que la transition ajoute, rend à son tour une fonction (t, u, o) → { propriété: valeur } (le
//          transform d'un déplacement, le filter d'un flou, les dimensions d'un repli) où o est l'opacité de l'enveloppe, que la
//          transition place où elle veut dans son objet (ou remplace par la sienne) ; rest est l'opacité de la balise (1 si on ne peut
//          pas la lire), style son style calculé à cet instant ; sans add, l'image est { opacity: o }
(function(opts, spec) {
  var setup = function(node) {
    var style = window.getComputedStyle(node);
    var rest  = parseFloat(style.opacity);
    var far, add;
    if (!(rest >= 0)) rest = 1;
    far = rest - (spec.opacity ?? 0);
    add = spec.add && spec.add(node, style, rest);
    return {
      delay: opts.delay ?? 0,
      duration: opts.duration ?? spec.duration ?? 400,
      easing: µ.easing.resolve(opts.easing ?? spec.easing),
      steps: opts.steps ?? 60,
      css: function(t, u) {
        var o = rest - far * u;
        return add ? add(t, u, o) : { opacity: o };
      }
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
