// mjs_fx_glitch — `*glitch` : le titre qui glitche par salves.
// Deux façons, choisies seules (réglage `mode`, « auto » quand il n'est pas écrit) :
//   - text (une balise qui porte son texte) : pendant une salve, le texte tremble et s'éclaire, et
//     deux calques colorés (les pseudo-éléments, qui recopient le texte) montrent des tranches qui
//     se décalent ;
//   - box (un composant, une image, un champ… dont le texte n'est pas le sien) : la balise elle-même
//     tremble, se dédouble en couleurs, et deux bandes colorées la balaient.
// Réglages : every (entre deux salves, calées sur l'horloge commune des effets qui se répètent, `0` = sans
// arrêt ; sans lui, la variable de thème `$$mjs-fx-every`, sinon 5s), on (always : les salves se suivent ;
// hover : pendant le survol ; view : tant que la balise est à l'écran ; click : une salve par clic ;
// load : une salve à l'apparition), burst (durée d'une salve ; 1.5s), strength (amplitude en px ;
// 4), color, color2 (les deux calques), glow (le halo), mode (text, box).

µ._mjs_fxDefs.glitch = {
  css: '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])::before,[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])::after{content:attr(mjs-fx-glitch-text);content:attr(mjs-fx-glitch-text) / "";white-space-collapse:preserve-breaks;position:absolute;inset:0;box-sizing:border-box;padding:inherit;display:none;pointer-events:none;mix-blend-mode:var(--mjs-glitch-blend,screen)}'
    + µ._mjs_fxPlaceCss(function(a) { return '[mjs-fx~="glitch"]' + a + ':not([mjs-fx-glitch-mode="box"])::before,[mjs-fx~="glitch"]' + a + ':not([mjs-fx-glitch-mode="box"])::after'; })
    + '[mjs-fx~="glitch"][mjs-fx-glitch-pre]::before,[mjs-fx~="glitch"][mjs-fx-glitch-pre]::after{white-space-collapse:inherit}'
    + '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])[mjs-fx-glitch-burst]{animation:mjs-fx-glitch .4s ease-in-out 3;filter:drop-shadow(0 0 20px var(--mjs-glitch-glow,rgba(16,185,129,.6))) drop-shadow(0 0 60px var(--mjs-glitch-glow,rgba(16,185,129,.6)))}'
    + '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])[mjs-fx-glitch-burst]::before{display:block;color:var(--mjs-glitch-color,#00d29499);animation:mjs-fx-glitch-1 .3s ease-in-out infinite}'
    + '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])[mjs-fx-glitch-burst]::after{display:block;color:var(--mjs-glitch-color2,#fb2c3666);animation:mjs-fx-glitch-2 .3s ease-in-out 50ms infinite}'
    + '@keyframes mjs-fx-glitch{0%{opacity:1;transform:translate(0)}10%{transform:translate(calc(-.75 * var(--mjs-glitch-strength,4px)),calc(.5 * var(--mjs-glitch-strength,4px)))}20%{transform:translate(calc(.75 * var(--mjs-glitch-strength,4px)),calc(-.5 * var(--mjs-glitch-strength,4px)))}30%{opacity:.8;transform:translate(calc(-.5 * var(--mjs-glitch-strength,4px)),calc(-.25 * var(--mjs-glitch-strength,4px)))}40%{transform:translate(calc(.5 * var(--mjs-glitch-strength,4px)),calc(.25 * var(--mjs-glitch-strength,4px)))}50%{opacity:1;transform:translate(calc(-.25 * var(--mjs-glitch-strength,4px)),calc(.5 * var(--mjs-glitch-strength,4px)))}60%{transform:translate(calc(.75 * var(--mjs-glitch-strength,4px)),calc(-.25 * var(--mjs-glitch-strength,4px)))}70%{opacity:.9;transform:translate(calc(-.75 * var(--mjs-glitch-strength,4px)),calc(.25 * var(--mjs-glitch-strength,4px)))}80%{transform:translate(calc(.25 * var(--mjs-glitch-strength,4px)),calc(-.5 * var(--mjs-glitch-strength,4px)))}90%{transform:translate(calc(-.5 * var(--mjs-glitch-strength,4px)),calc(.5 * var(--mjs-glitch-strength,4px)))}100%{opacity:1;transform:translate(0)}}'
    + '@keyframes mjs-fx-glitch-1{0%{clip-path:inset(0 0 80%);transform:translate(calc(-1 * var(--mjs-glitch-strength,4px)))}20%{clip-path:inset(20% 0 60%);transform:translate(var(--mjs-glitch-strength,4px))}40%{clip-path:inset(40% 0);transform:translate(calc(-1 * var(--mjs-glitch-strength,4px)))}60%{clip-path:inset(60% 0 20%);transform:translate(var(--mjs-glitch-strength,4px))}80%{clip-path:inset(80% 0 0);transform:translate(calc(-1 * var(--mjs-glitch-strength,4px)))}100%{clip-path:inset(0 0 80%);transform:translate(0)}}'
    + '@keyframes mjs-fx-glitch-2{0%{clip-path:inset(80% 0 0);transform:translate(var(--mjs-glitch-strength,4px))}20%{clip-path:inset(60% 0 20%);transform:translate(calc(-1 * var(--mjs-glitch-strength,4px)))}40%{clip-path:inset(40% 0);transform:translate(var(--mjs-glitch-strength,4px))}60%{clip-path:inset(20% 0 60%);transform:translate(calc(-1 * var(--mjs-glitch-strength,4px)))}80%{clip-path:inset(0 0 80%);transform:translate(var(--mjs-glitch-strength,4px))}100%{clip-path:inset(80% 0 0);transform:translate(0)}}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"][mjs-fx-glitch-burst]{animation:mjs-fx-glitch-box .45s steps(1,end) infinite}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"]::before,[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"]::after{content:"";position:absolute;left:0;right:0;display:none;pointer-events:none;mix-blend-mode:var(--mjs-glitch-blend,screen)}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"][mjs-fx-glitch-burst]::before{display:block;height:14%;background:var(--mjs-glitch-color,#00d29499);animation:mjs-fx-glitch-bar .5s steps(1,end) infinite}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"][mjs-fx-glitch-burst]::after{display:block;height:9%;background:var(--mjs-glitch-color2,#fb2c3666);animation:mjs-fx-glitch-bar .35s steps(1,end) 60ms infinite reverse}'
    + '@keyframes mjs-fx-glitch-box{0%{transform:translate(0);filter:none}15%{transform:translate(calc(-1 * var(--mjs-glitch-strength,4px)),1px) skewX(-3deg);filter:drop-shadow(-3px 0 var(--mjs-glitch-color,#00d29499)) drop-shadow(3px 0 var(--mjs-glitch-color2,#fb2c3666))}35%{transform:translate(calc(.75 * var(--mjs-glitch-strength,4px)),-1px);filter:drop-shadow(0 0 16px var(--mjs-glitch-glow,rgba(16,185,129,.6)))}55%{transform:translate(calc(-.5 * var(--mjs-glitch-strength,4px)),2px) skewX(4deg);filter:drop-shadow(3px 0 var(--mjs-glitch-color,#00d29499)) drop-shadow(-3px 0 var(--mjs-glitch-color2,#fb2c3666))}75%{transform:translate(calc(.5 * var(--mjs-glitch-strength,4px)),0);filter:none}100%{transform:translate(0);filter:none}}'
    + '@keyframes mjs-fx-glitch-bar{0%{top:8%}25%{top:56%}50%{top:30%}75%{top:78%}100%{top:4%}}'
    // « réduire les animations » : une règle par sélecteur, chacune aussi spécifique que celle
    // qu'elle coupe (le `:not(…)` compte)
    + '@media (prefers-reduced-motion:reduce){'
    + '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])[mjs-fx-glitch-burst]{animation:none}'
    + '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])[mjs-fx-glitch-burst]::before{animation:none}'
    + '[mjs-fx~="glitch"]:not([mjs-fx-glitch-mode="box"])[mjs-fx-glitch-burst]::after{animation:none}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"][mjs-fx-glitch-burst]{animation:none}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"][mjs-fx-glitch-burst]::before{display:none}'
    + '[mjs-fx~="glitch"][mjs-fx-glitch-mode="box"][mjs-fx-glitch-burst]::after{display:none}}',
  vars: { color: '', color2: '', glow: '', strength: 'px' },
  setup: function(el, s) {
    var box   = s.mode === 'box' || (s.mode !== 'text' && µ._mjs_fxBoxy(el));
    var watch = function() {};
    var moved = function() {};
    if (box) µ._mjs_dom.setAttribute(el, 'mjs-fx-glitch-mode', 'box');
    else {
      // les calques recopient le texte de la balise (pas les lettres qu'un autre effet y pose) ; un
      // texte réactif ({$titre}) les tient à jour ; un <br> y coupe la ligne (cf. µ._mjs_fxCopyText)
      var sync = function() {
        µ._mjs_dom.setAttribute(el, 'mjs-fx-glitch-text', µ._mjs_fxCopyText(el));
        // une balise qui garde ses espaces (`pre`, `pre-wrap`…) : la copie aussi, sinon elle replie ceux qui se suivent
        if (/^(?:pre|break)/.test(getComputedStyle(el).whiteSpace || '')) µ._mjs_dom.setAttribute(el, 'mjs-fx-glitch-pre', '');
        else µ._mjs_dom.removeAttribute(el, 'mjs-fx-glitch-pre');
      };
      sync();
      watch = µ._mjs_fxOnText(el, sync);
      // le texte tremble : une balise en ligne (un mot) passe en inline-block, sans quoi seules les
      // copies bougent
      moved = µ._mjs_fxMovable(el);
    }
    var restore = µ._mjs_fxRelative(el);
    var place   = box ? null : µ._mjs_fxPlace(el);
    var burst   = µ._mjs_fxMs(s.burst, 1500);
    var first, beat, end;
    var fire = function() {
      µ._mjs_dom.setAttribute(el, 'mjs-fx-glitch-burst', '');
      clearTimeout(end);
      end = setTimeout(function() { µ._mjs_dom.removeAttribute(el, 'mjs-fx-glitch-burst'); }, burst);
    };
    // salves en série (always, view) : la première 2 s après le départ (un tour, s'il est plus court), les suivantes calées sur l'horloge
    // commune des effets qui se répètent, la prochaine un tour entier au moins après elle, la cadence relue à chaque salve ; `every: 0` =
    // sans arrêt (une cadence relue à 0 aussi : la salve reste)
    var every = function() { return µ._mjs_fxEvery(el, s.every, 5000); };
    var start = function() {
      stop();
      var p = every();
      if (p === 0) { µ._mjs_dom.setAttribute(el, 'mjs-fx-glitch-burst', ''); return; }
      first = setTimeout(function() {
        var q = every();
        if (q === 0) return start();
        fire();
        beat = µ._mjs_fxBeat(every, function(r) {
          if (r === 0) start();
          else fire();
        }, q);
      }, Math.min(2000, p));
    };
    var stop = function() {
      clearTimeout(first);
      if (beat) beat();
      beat = null;
      clearTimeout(end);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-glitch-burst');
    };
    // une salve par geste : un clic, l'apparition, la fin de l'action (réussie ou ratée) — la série
    // (première salve à 2 s) n'y aurait pas le temps : elle s'arrête au bout de `burst`
    var on   = s.on || 'always';
    var gate = on === 'hover'
      ? µ._mjs_fxRun(el, 'hover', function() { µ._mjs_dom.setAttribute(el, 'mjs-fx-glitch-burst', ''); }, stop, burst)
      : on === 'click' || on === 'load' || on === 'success' || on === 'error'
      ? µ._mjs_fxRun(el, on, fire, function() {}, burst)
      : µ._mjs_fxRun(el, on, start, stop, burst);
    return function() {
      gate();
      stop();
      watch();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-glitch-text');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-glitch-pre');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-glitch-mode');
      if (place) place.off();
      restore();
      moved();
    };
  }
};
