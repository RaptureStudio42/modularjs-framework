// mjs_fx_attention — `*attention` : un appel d'attention, le geste bref qui fait regarder une balise
// (un bouton à cliquer, une icône qui a du nouveau). Les styles : tada (grossit en tremblant),
// wobble (tangue de côté), jello (tremble comme une gelée), heartbeat (deux battements de cœur),
// swing (se balance, pendue par le haut), rubber (s'étire comme un élastique), blink (clignote),
// headshake (fait « non » de la tête), jump (saute et rebondit), pop (gonfle un instant), wiggle (un
// petit balancement autour du centre, une cloche, une icône qui appelle).
// Réglages : style (tada), on (view : à l'arrivée à l'écran ; hover, click, load ; always : sans
// fin, avec une pause entre deux appels ; view), every (always : la pause ; hover et view, écrit :
// l'appel se répète pendant le survol, ou tant que la balise est à l'écran, avec cette pause entre
// deux ; always et view : les appels calés sur l'horloge commune des effets qui se répètent ; sans
// lui, la variable de thème `$$mjs-fx-every`, sinon 3s), duration (un appel ; 1s), repeat (le nombre
// d'appels d'affilée ; 1), delay (l'attente avant le premier), angle (wiggle : l'amplitude du
// balancement, en degrés ; 12).
// Le geste s'ajoute au transform de l'auteur (animation-composition: add) : un badge centré par
// translate(-50%, -50%) le fait sur place, et le retrouve tel quel une fois fini.

var _MJS_FX_ATTENTION = {
  tada: '0%,100%{transform:none}10%,20%{transform:scale(.92) rotate(-3deg)}30%,50%,70%,90%{transform:scale(1.1) rotate(3deg)}40%,60%,80%{transform:scale(1.1) rotate(-3deg)}',
  wobble: '0%,100%{transform:none}15%{transform:translateX(-18px) rotate(-5deg)}30%{transform:translateX(14px) rotate(3deg)}45%{transform:translateX(-10px) rotate(-3deg)}60%{transform:translateX(6px) rotate(2deg)}75%{transform:translateX(-3px) rotate(-1deg)}',
  jello: '0%,11%,100%{transform:none}22%{transform:skew(-12deg,-12deg)}33%{transform:skew(6deg,6deg)}44%{transform:skew(-3deg,-3deg)}55%{transform:skew(1.5deg,1.5deg)}66%{transform:skew(-.75deg,-.75deg)}77%{transform:skew(.4deg,.4deg)}88%{transform:skew(-.2deg,-.2deg)}',
  heartbeat: '0%,28%,70%,100%{transform:scale(1)}14%,42%{transform:scale(1.25)}',
  swing: '0%,100%{transform:rotate(0)}20%{transform:rotate(15deg)}40%{transform:rotate(-10deg)}60%{transform:rotate(5deg)}80%{transform:rotate(-5deg)}',
  rubber: '0%,100%{transform:scale(1,1)}30%{transform:scale(1.25,.75)}40%{transform:scale(.75,1.25)}50%{transform:scale(1.15,.85)}65%{transform:scale(.95,1.05)}75%{transform:scale(1.05,.95)}',
  blink: '0%,50%,100%{opacity:1}25%,75%{opacity:0}',
  headshake: '0%,50%,100%{transform:none}6.5%{transform:translateX(-6px) rotateY(-9deg)}18.5%{transform:translateX(5px) rotateY(7deg)}31.5%{transform:translateX(-3px) rotateY(-5deg)}43.5%{transform:translateX(2px) rotateY(3deg)}',
  jump: '0%,20%,53%,100%{transform:translateY(0)}40%,43%{transform:translateY(-24px) scaleY(1.08)}70%{transform:translateY(-12px) scaleY(1.04)}80%{transform:translateY(0) scaleY(.96)}90%{transform:translateY(-4px) scaleY(1.02)}',
  pop: '0%,100%{transform:scale(1)}50%{transform:scale(1.15)}',
  wiggle: '0%{transform:none}24%{transform:rotate(calc(-1 * var(--mjs-attention-angle,12deg)))}48%{transform:rotate(calc(.8 * var(--mjs-attention-angle,12deg)))}72%{transform:rotate(calc(-.5 * var(--mjs-attention-angle,12deg)))}100%{transform:rotate(0)}'
};

µ._mjs_fxDefs.attention = {
  css: Object.keys(_MJS_FX_ATTENTION).map(function(n) {
    return '@keyframes mjs-fx-attention-' + n + '{' + _MJS_FX_ATTENTION[n] + '}[mjs-fx~="attention"][mjs-fx-attention-style="' + n + '"]{--mjs-fx-attention-name:mjs-fx-attention-' + n + '}';
  }).join('')
    + '[mjs-fx~="attention"][mjs-fx-play~="attention"]{animation:var(--mjs-fx-attention-name,mjs-fx-attention-tada) var(--mjs-attention-duration,1s) ease var(--mjs-attention-delay,0s) var(--mjs-attention-repeat,1) both;animation-composition:add}'
    + '[mjs-fx~="attention"][mjs-fx-attention-style="blink"][mjs-fx-play~="attention"]{animation-composition:replace}'
    // on: always, les appels après le premier : sans l'attente `delay`
    + '[mjs-fx~="attention"][mjs-fx-play~="attention"][mjs-fx-attention-again]{animation-delay:0s}'
    + '[mjs-fx~="attention"][mjs-fx-attention-style="swing"]{transform-origin:top center}'
    + '[mjs-fx~="attention"][mjs-fx-attention-style="jump"]{transform-origin:center bottom}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="attention"][mjs-fx-play~="attention"][mjs-fx-play~="attention"]{animation:none}}',
  vars: { duration: '', repeat: '', delay: '', angle: 'deg' },
  setup: function(el, s) {
    var restore = µ._mjs_fxMovable(el);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-attention-style', s.style || 'tada');
    var play = function() { µ._mjs_fxPlay(el, 'attention'); };
    var dur  = s.duration;
    var rep  = s.repeat;
    var wait = s.delay;
    var plan = function() {};
    // un tour : un appel (ses `repeat` passages) et la pause `every`, de 100 ms au moins
    var tour = function() { return Math.max(100, µ._mjs_fxMs(dur, 1000) * (rep || 1) + µ._mjs_fxEvery(el, s.every, 3000)); };
    var stop;
    if (s.on === 'always' || (s.on === 'view' && s.every !== void 0)) {
      // sans fin (always), ou tant que la balise est à l'écran (view, `every` écrit) : le premier appel tout de suite, à la pose (always) ou
      // à l'arrivée à l'écran (view), après l'attente `delay` ; les suivants, un par tour, calés sur l'horloge commune des effets qui se
      // répètent, sans attente (rejouée à chaque appel, une attente plus longue que la pause relançait l'appel avant qu'il ne commence) :
      // le prochain un tour entier au moins après le dernier (et son attente), la cadence relue à chaque appel. La balise qui quitte l'écran
      // coupe l'appel en cours, et revient au repos
      var calm  = µ._mjs_fxCalm();
      var beat  = null;
      var first = true;
      var at    = 0;
      var again = function() {
        first = false;
        at    = Date.now();
        µ._mjs_dom.setAttribute(el, 'mjs-fx-attention-again', '');
        play();
      };
      var next = function() {
        beat = µ._mjs_fxBeat(tour, again, Math.max(0, at + (first ? µ._mjs_fxMs(wait, 0) : 0) + tour() - Date.now()));
      };
      var go = function() {
        // « réduire les animations » : un appel, sans série
        if (calm) return play();
        if (beat) return;
        first = true;
        at    = Date.now();
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-attention-again');
        play();
        next();
      };
      var pause = function() {
        if (beat) beat();
        beat = null;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-attention-again');
      };
      // la série repart quand la durée change : le tour la suit, le prochain appel un tour entier au moins après le dernier
      plan = function() {
        if (!beat) return;
        beat();
        next();
      };
      if (s.on === 'always') {
        go();
        stop = pause;
      }
      else stop = µ._mjs_fxRun(el, 'view', go, function() {
        pause();
        µ._mjs_fxPlay(el, 'attention', true);
      });
    }
    else if (s.on === 'hover' && s.every !== void 0) {
      // `every` écrit : l'appel se répète pendant le survol, la pause entre deux, le premier à l'entrée de la souris (l'attente `delay`
      // avant lui seulement). La souris qui sort coupe l'appel en cours, la balise revient au repos
      var quiet = µ._mjs_fxCalm();
      var loop  = null;
      var call  = function(again) {
        if (again) µ._mjs_dom.setAttribute(el, 'mjs-fx-attention-again', '');
        play();
        if (quiet) return;
        loop = setTimeout(function() { call(true); }, Math.max(100, (again ? 0 : µ._mjs_fxMs(wait, 0)) + µ._mjs_fxMs(dur, 1000) * (rep || 1) + µ._mjs_fxMs(s.every, 3000)));
      };
      stop = µ._mjs_fxRun(el, 'hover', function() {
        if (!loop) call(false);
      }, function() {
        clearTimeout(loop);
        loop = null;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-attention-again');
        µ._mjs_fxPlay(el, 'attention', true);
      });
    }
    else stop = µ._mjs_fxWhen(el, s.on || 'view', play);
    var off = function() {
      stop();
      µ._mjs_fxPlay(el, 'attention', true);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-attention-style');
      restore();
    };
    // durée, passages, attente tenus par une variable : la feuille les lit, le tour les suit aussi (les
    // autres réglages : l'effet repart)
    off.set = function(k, v) {
      if (k === 'duration') dur = v;
      else if (k === 'repeat') rep = v;
      else if (k === 'delay') wait = v;
      else return false;
      plan();
    };
    return off;
  }
};
