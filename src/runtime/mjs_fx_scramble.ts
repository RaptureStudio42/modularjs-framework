// mjs_fx_scramble — `*scramble` : les lettres se mélangent, puis se remettent en place une à une
// (effet « décodage »). Sur un calque de lettres posé par-dessus le texte, qui reste en place.
// Réglages : speed (ms entre deux lettres ; 40), on (view : quand la balise entre à l'écran ;
// hover, click ; load : dès l'apparition, même hors de l'écran), order (l'ordre de remise en
// place : right, left, center, edges, random), delay (l'attente avant de commencer), chars (les
// caractères tirés au sort).

µ._mjs_fxDefs.scramble = {
  css: '',
  vars: {},
  // la durée d'un jeu (une sortie `@out=*scramble` l'attend) : l'attente, puis une lettre par pas —
  // les caractères perçus du texte de la balise, pas ceux des calques posés dessus
  span: function(el, s) { return µ._mjs_fxMs(s.delay, 0) + (µ._mjs_fxLetters(µ._mjs_fxOwnText(el)).length + 2) * (s.speed || 40); },
  setup: function(el, s, comp) {
    var tx    = µ._mjs_fxLayer(comp, el);
    // des caractères entiers : un emoji (deux unités UTF-16) n'est jamais coupé en deux
    var chars = Array.from(s.chars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?');
    var step  = s.speed || 40;
    var timer = null;
    var wait  = null;
    // les vraies lettres remises, le temps d'un jeu (un retrait en plein brouillage les rend)
    var show  = null;
    var run = function() {
      clearInterval(timer);
      clearTimeout(wait);
      var ls   = tx.layer.querySelectorAll('[mjs-fx-letter]');
      // le vrai texte vient du calque, jamais des lettres (un brouillage en cours les a changées) ;
      // découpé comme les lettres du calque
      var real = µ._mjs_fxLetters(tx.text);
      show = function() { for (var i = 0; i < ls.length; i++) ls[i].textContent = real[i] === void 0 ? ls[i].textContent : real[i]; };
      if (µ._mjs_fxCalm()) { show(); return; }
      var rank = µ._mjs_fxRanks(ls.length, s.order);
      var top  = Math.max.apply(null, rank.concat([0]));
      var n    = 0;
      wait = setTimeout(function() {
        timer = setInterval(function() {
          for (var i = 0; i < ls.length; i++) ls[i].textContent = rank[i] < n ? real[i] : chars[Math.floor(Math.random() * chars.length)];
          if (++n > top + 1) {
            clearInterval(timer);
            timer = null;
            show();
          }
        }, step);
      }, µ._mjs_fxMs(s.delay, 0));
    };
    // le texte a changé : le nouveau texte s'affiche tel quel
    tx.onBuild(function() {
      clearInterval(timer);
      clearTimeout(wait);
      timer = null;
    });
    var stop = µ._mjs_fxWhen(el, s.on, run);
    return function() {
      stop();
      // retiré en plein brouillage : le calque peut rester (un autre effet de lettres le garde), il
      // retrouve ses vraies lettres
      if (timer && show) show();
      clearInterval(timer);
      clearTimeout(wait);
      tx.off();
    };
  }
};
