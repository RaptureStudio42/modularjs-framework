// mjs_fx_neon — `*neon` : une lueur de néon autour du texte (ou du cadre). Réglages : color (#0ff),
// where (text, box, both : le texte, le cadre, les deux ; text), size (ampleur du halo ; 1), core
// (le cœur du tube : la couleur du texte sous la lueur ; #fff), flicker (le néon grésille), breathe
// (le halo respire : il va et vient entre un quart de sa taille et sa taille, sans jamais s'éteindre),
// speed (un cycle du grésillement, ou un aller-retour de la respiration ; 3s), on (always : tout le
// temps ; hover : au survol ; view : dès que la balise est à l'écran ; click : chaque clic l'allume
// ou l'éteint). Avec flicker ET breathe, les deux jouent ensemble, au même rythme.
// La respiration ne repeint rien : elle ne bouge que l'opacité d'un calque, le navigateur ne fait que
// recomposer. Côté texte, la lueur est coupée en deux : le cœur (4 et 10 px) reste sur la balise, la partie
// large (22 et 44 px) est portée par ::before, une copie du texte posée sous le texte, qui ne porte que cette
// ombre. Côté cadre (box, both), ::after porte la lueur entière (sans texte, au bord extérieur de la balise,
// bordure comprise) et la balise garde le quart : un calque qui passe de rien à tout. Là où un calque ne peut
// pas se poser, l'ombre elle-même respire, de un quart de sa taille à sa taille : un champ, un composant, un
// média (pas de pseudo-élément) ; pour le cadre, une balise que son overflow rogne (le calque serait coupé).
// Une balise sans texte ne fait respirer aucun texte ; celui qui lui arrive plus tard respire dès qu'il est là.
// Hors de l'écran, à 100 px près, la respiration se met en pause.
// La respiration (breathe) est une section marquée du fichier : le build de production ne l'embarque que si une page écrit breathe.
// Sans elle, le module est celui du néon d'avant : même feuille, même pose, rien de plus.

µ._mjs_fxDefs.neon = {
  css: '[mjs-fx~="neon"]{--mjs-fx-neon:0 0 calc(4px * var(--mjs-neon-size,1)) var(--mjs-neon-core,#fff),0 0 calc(10px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(22px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(44px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff)}'
    // la transition s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
    + '[mjs-fx~="neon"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"]:not([mjs-fx-neon-where="box"]){color:var(--mjs-neon-core,#fff);text-shadow:var(--mjs-fx-neon)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-where="box"],[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-where="both"]{box-shadow:var(--mjs-fx-neon)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-flicker]{animation:mjs-fx-neon-flicker var(--mjs-neon-speed,3s) infinite}'
    + '@keyframes mjs-fx-neon-flicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.4}}'
    // @@ breathe
    // la respiration : la lueur en trois tailles — petite (un quart), cœur (4 et 10 px), large (22 et 44 px)
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe]{--mjs-fx-neon-lo:0 0 calc(1px * var(--mjs-neon-size,1)) var(--mjs-neon-core,#fff),0 0 calc(2.5px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(5.5px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(11px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff);--mjs-fx-neon-in:0 0 calc(4px * var(--mjs-neon-size,1)) var(--mjs-neon-core,#fff),0 0 calc(10px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff);--mjs-fx-neon-out:0 0 calc(22px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff),0 0 calc(44px * var(--mjs-neon-size,1)) var(--mjs-neon-color,#0ff)}'
    // texte avec calque : le calque passe sous le texte (isolation), invisible tant que le néon est éteint
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="layer"]{isolation:isolate}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="frame"]{isolation:isolate}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="layer"]::before{content:attr(mjs-fx-neon-text);content:attr(mjs-fx-neon-text) / "";white-space-collapse:preserve-breaks;position:absolute;inset:0;z-index:-1;box-sizing:border-box;padding:inherit;color:transparent;pointer-events:none;text-shadow:var(--mjs-fx-neon-out);opacity:0;transition:opacity .3s ease}'
    + µ._mjs_fxPlaceCss(function(a) { return '[mjs-fx~="neon"][mjs-fx-neon-breathe~="layer"]' + a + '::before'; })
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="layer"][mjs-fx-neon-pre]::before{white-space-collapse:inherit}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="layer"]{text-shadow:var(--mjs-fx-neon-in)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="layer"]::before{animation:mjs-fx-neon-breathe var(--mjs-neon-speed,3s) ease-in-out infinite}'
    // cadre : le calque ::after porte la lueur entière et sa seule opacité bouge ; la balise garde le quart (la petite ombre
    // sert aussi d'état de départ : l'allumage et l'extinction se font en douceur autour de l'animation)
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="frame"]::after{content:"";position:absolute;inset:var(--mjs-fx-neon-inset,0);z-index:-1;border-radius:inherit;pointer-events:none;box-shadow:var(--mjs-fx-neon);opacity:0;transition:opacity .3s ease}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="frame"]{box-shadow:var(--mjs-fx-neon-lo)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="frame"]::after{animation:mjs-fx-neon-breathe var(--mjs-neon-speed,3s) ease-in-out infinite}'
    // champ, composant, média ; cadre que son overflow rogne : l'ombre elle-même respire, de la petite taille à la grande
    // (celle d'en dessous, la petite, sert d'état de départ : l'allumage et l'extinction se font en douceur autour de l'animation)
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="text"]{text-shadow:var(--mjs-fx-neon-lo)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="box"]{box-shadow:var(--mjs-fx-neon-lo)}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="box"]{--mjs-fx-neon-ab:mjs-fx-neon-breathe-box var(--mjs-neon-speed,3s) ease-in-out infinite}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="text"]{--mjs-fx-neon-at:mjs-fx-neon-breathe-text var(--mjs-neon-speed,3s) ease-in-out infinite}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe][mjs-fx-neon-flicker]{--mjs-fx-neon-af:mjs-fx-neon-flicker var(--mjs-neon-speed,3s) infinite}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"]:is([mjs-fx-neon-breathe~="box"],[mjs-fx-neon-breathe~="text"]){animation:var(--mjs-fx-neon-af,none),var(--mjs-fx-neon-ab,none),var(--mjs-fx-neon-at,none)}'
    + '@keyframes mjs-fx-neon-breathe{0%,100%{opacity:0}50%{opacity:1}}'
    + '@keyframes mjs-fx-neon-breathe-box{0%,100%{box-shadow:var(--mjs-fx-neon-lo)}50%{box-shadow:var(--mjs-fx-neon)}}'
    + '@keyframes mjs-fx-neon-breathe-text{0%,100%{text-shadow:var(--mjs-fx-neon-lo)}50%{text-shadow:var(--mjs-fx-neon)}}'
    // hors de l'écran : en pause
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-away],[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-away]::before,[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-away]::after{animation-play-state:paused}'
    // @@
    // « réduire les animations » : plus rien ne bouge, la lueur reste à sa taille (la grande)
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="neon"]{transition:none}[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-flicker]{animation:none}'
    // @@ breathe
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe]{animation:none}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="layer"]::before{transition:none}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="layer"]::before{animation:none;opacity:1}'
    + '[mjs-fx~="neon"][mjs-fx-neon-breathe~="frame"]::after{transition:none}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="frame"]::after{animation:none;opacity:1}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="text"]{text-shadow:var(--mjs-fx-neon)}'
    + '[mjs-fx~="neon"][mjs-fx-on~="neon"][mjs-fx-neon-breathe~="box"]{box-shadow:var(--mjs-fx-neon)}'
    // @@
    + '}',
  vars: { color: '', size: '', core: '', speed: '' },
  setup: function(el, s) {
    if (s.where && s.where !== 'text') µ._mjs_dom.setAttribute(el, 'mjs-fx-neon-where', s.where);
    if (s.flicker) µ._mjs_dom.setAttribute(el, 'mjs-fx-neon-flicker', '');
    var gate = µ._mjs_fxState(el, 'neon', s.on || 'always');
    var tr   = µ._mjs_fxTransition(el, 'neon', 'text-shadow .3s ease,box-shadow .3s ease,color .3s ease');
    // @@ breathe
    var calm = function() {};
    if (s.breathe) {
      var box   = s.where === 'box' || s.where === 'both';
      var text  = s.where !== 'box';
      // un champ, un composant, un média : leur texte n'est pas le leur et ils ne portent pas de pseudo-élément
      var boxy  = µ._mjs_fxBoxy(el);
      // le calque du cadre est dans la balise : un overflow qui rogne lui couperait la lueur, l'ombre elle-même respire alors
      var cs    = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      var clip  = !!cs && /hidden|clip|scroll|auto|paint|strict|content/.test(cs.overflowX + ' ' + cs.overflowY + ' ' + (cs.contain || ''));
      var frame = box && !boxy && !clip;
      // la copie du texte : possible dans toute balise qui porte un pseudo-élément, posée tant qu'elle a du texte propre
      var copy  = text && !boxy;
      // les marques de la respiration, selon ce que la balise porte à l'instant
      var mark  = function(has) {
        var parts = [];
        if (text && boxy) parts.push('text');
        else if (copy && has) parts.push('layer');
        if (box) parts.push(frame ? 'frame' : 'box');
        µ._mjs_dom.setAttribute(el, 'mjs-fx-neon-breathe', parts.join(' '));
      };
      var watch   = function() {};
      var restore = function() {};
      var moved   = function() {};
      var place   = null;
      // un calque est absolu et se range dans sa balise : positionnée, et une balise en ligne passe en inline-block
      if (copy || frame) {
        moved   = µ._mjs_fxMovable(el);
        restore = µ._mjs_fxRelative(el);
      }
      if (copy) {
        // la copie du texte, tenue à jour s'il change (ou s'il arrive) ; rangée comme lui (une grille, un flex, un bouton) ;
        // un <br> y coupe la ligne (cf. µ._mjs_fxCopyText)
        var sync = function() {
          var t = µ._mjs_fxCopyText(el);
          µ._mjs_dom.setAttribute(el, 'mjs-fx-neon-text', t);
          // une balise qui garde ses espaces (`pre`, `pre-wrap`…) : la copie aussi, sinon elle replie ceux qui se suivent
          if (/^(?:pre|break)/.test(getComputedStyle(el).whiteSpace || '')) µ._mjs_dom.setAttribute(el, 'mjs-fx-neon-pre', '');
          else µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-pre');
          mark(t.trim() !== '');
        };
        sync();
        watch = µ._mjs_fxOnText(el, sync);
        place = µ._mjs_fxPlace(el);
      }
      else mark(false);
      // le calque du cadre part du bord extérieur de la balise : sa bordure, relue à la pose, le décale d'autant
      if (frame) {
        var edge  = function(v) { return '-' + (parseFloat(v) || 0) + 'px'; };
        var inset = edge(cs.borderTopWidth) + ' ' + edge(cs.borderRightWidth) + ' ' + edge(cs.borderBottomWidth) + ' ' + edge(cs.borderLeftWidth);
        if (inset !== '-0px -0px -0px -0px') el.style.setProperty('--mjs-fx-neon-inset', inset);
      }
      // hors de l'écran (à 100 px près), l'animation est mise en pause ; elle repart au retour
      var rest = µ._mjs_fxRun(el, 'always', function() { µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-away'); }, function() { µ._mjs_dom.setAttribute(el, 'mjs-fx-neon-away', ''); });
      calm = function() {
        rest();
        watch();
        if (place) place.off();
        restore();
        moved();
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-away');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-text');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-pre');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-breathe');
        el.style.removeProperty('--mjs-fx-neon-inset');
      };
    }
    // @@
    return function() {
      calm(); // @@ breathe
      gate();
      tr();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-where');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-neon-flicker');
    };
  }
};
