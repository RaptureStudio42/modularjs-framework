// le fichier d'effet de `*stagger` tel qu'il était avant les variantes (`unit: line`, `unit: child`, `clip`) : la référence de « lettre et mot comme avant »
// de tests/effets-stagger-unites-browser.test.ts, qui le pose à la place du fichier d'aujourd'hui dans une page et compare les styles calculés
// extension .mts EXPRÈS : mocha (--extension ts) ne doit pas le charger, il ne vaut que comme texte

µ._mjs_fxDefs.stagger = {
  css: µ._mjs_fxOrderCss('stagger')
    + '[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-letter]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-stagger-step,45ms)) 1 normal both}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="zoom"]{--mjs-fx-stagger-name:mjs-fx-stagger-zoom}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"]{--mjs-fx-stagger-name:mjs-fx-stagger-flip}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="blur"]{--mjs-fx-stagger-name:mjs-fx-stagger-blur}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="rotate"]{--mjs-fx-stagger-name:mjs-fx-stagger-rotate}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="fade"]{--mjs-fx-stagger-name:mjs-fx-stagger-fade}'
    // les mots plutôt que les lettres : le rang de chaque mot est posé sur lui (--mjs-fx-stagger-k)
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-letter]{animation:none}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-stagger-step,45ms)) 1 normal both}'
    // au défilement : l'animation arrêtée, son instant tiré de l'avancée (--mjs-fx-stagger-p) — un
    // délai négatif place chaque lettre au bon moment de son arrivée
    // (le pas `--mjs-fx-stagger-st` et la courbe `--mjs-fx-stagger-ease` : ceux que l'effet pose au
    // défilement quand ils ne sont pas écrits)
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll] [mjs-fx-layer="text"]{--mjs-fx-stagger-total:calc((var(--mjs-fx-stagger-c,1) - 1) * var(--mjs-fx-stagger-st,var(--mjs-stagger-step,45ms)) + var(--mjs-stagger-duration,500ms))}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-play~="stagger"] [mjs-fx-letter],[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation-play-state:paused;animation-timing-function:var(--mjs-fx-stagger-ease,var(--mjs-stagger-easing,ease-out));animation-delay:calc(var(--mjs-fx-stagger-k) * var(--mjs-fx-stagger-st,var(--mjs-stagger-step,45ms)) - var(--mjs-fx-stagger-p,0) * var(--mjs-fx-stagger-total))}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"] [mjs-fx-word]{perspective:400px}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"] [mjs-fx-letter]{transform-origin:50% 100%}'
    // la lettre arrive du côté opposé à son mouvement : `direction` up → elle monte depuis le bas
    + '@keyframes mjs-fx-stagger-move{from{opacity:var(--mjs-stagger-opacity,0);transform:translate(calc(var(--mjs-fx-stagger-x,0) * -1 * var(--mjs-stagger-distance,16px)),calc(var(--mjs-fx-stagger-y,-1) * -1 * var(--mjs-stagger-distance,16px)))}}'
    + '@keyframes mjs-fx-stagger-zoom{from{opacity:var(--mjs-stagger-opacity,0);transform:scale(.3)}}'
    + '@keyframes mjs-fx-stagger-flip{from{opacity:var(--mjs-stagger-opacity,0);transform:rotateX(-90deg)}}'
    + '@keyframes mjs-fx-stagger-blur{from{opacity:var(--mjs-stagger-opacity,0);filter:blur(8px)}}'
    + '@keyframes mjs-fx-stagger-rotate{from{opacity:var(--mjs-stagger-opacity,0);transform:rotate(-45deg) scale(.6)}}'
    + '@keyframes mjs-fx-stagger-fade{from{opacity:var(--mjs-stagger-opacity,0)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-letter][mjs-fx-letter],[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-word][mjs-fx-word]{animation:none}}',
  vars: { step: '', duration: '', distance: 'px', delay: '', easing: '', opacity: '' },
  setup: function(el, s, comp) {
    var words = s.unit === 'word';
    if (s.style && s.style !== 'move') µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-style', s.style);
    if (s.order && s.order !== 'right') µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-order', s.order);
    if (words) µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-unit', 'word');
    var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 0));
    el.style.setProperty('--mjs-fx-stagger-x', String(v.x));
    el.style.setProperty('--mjs-fx-stagger-y', String(v.y));
    var tx = µ._mjs_fxLayer(comp, el);
    // à chaque reconstruction du calque : le rang des mots, et le nombre d'éléments qui arrivent
    var count = function() {
      if (!tx.layer) return;
      var ws = tx.layer.querySelectorAll('[mjs-fx-word]');
      if (words) {
        var r = µ._mjs_fxRanks(ws.length, s.order || 'right');
        for (var i = 0; i < ws.length; i++) ws[i].style.setProperty('--mjs-fx-stagger-k', String(r[i]));
      }
      tx.layer.style.setProperty('--mjs-fx-stagger-c', String(words ? ws.length : tx.layer.querySelectorAll('[mjs-fx-letter]').length));
    };
    count();
    tx.onBuild(count);
    var stop;
    // au défilement : un mot après l'autre, d'un pas régulier, sans courbe — sauf pas ou courbe écrits
    // (`k` : step, easing ; `v` : sa valeur), ou posés par le thème
    var regular = function(k, v) {
      var p = k === 'step' ? '--mjs-fx-stagger-st' : '--mjs-fx-stagger-ease';
      if (v !== void 0 || µ._mjs_fxCss(el, '--mjs-stagger-' + k)) el.style.removeProperty(p);
      else el.style.setProperty(p, k === 'step' ? 'var(--mjs-stagger-duration,500ms)' : 'linear');
    };
    if (s.on === 'scroll') {
      µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-scroll', '');
      regular('step', s.step);
      regular('easing', s.easing);
      µ._mjs_fxPlay(el, 'stagger');
      stop = µ._mjs_fxScroll(el, function(p) { el.style.setProperty('--mjs-fx-stagger-p', String(p)); }, s.zone);
    }
    else stop = µ._mjs_fxWhen(el, s.on, function() { µ._mjs_fxPlay(el, 'stagger'); });
    var off = function() {
      stop();
      tx.off();
      µ._mjs_fxPlay(el, 'stagger', true);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-style');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-order');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-unit');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-scroll');
      el.style.removeProperty('--mjs-fx-stagger-x');
      el.style.removeProperty('--mjs-fx-stagger-y');
      el.style.removeProperty('--mjs-fx-stagger-p');
      el.style.removeProperty('--mjs-fx-stagger-st');
      el.style.removeProperty('--mjs-fx-stagger-ease');
    };
    // le pas ou la courbe tenus par une variable : leur variable CSS suit (le moteur) ; au défilement,
    // le pas régulier et la courbe linéaire cèdent la place à la valeur écrite, et reviennent quand
    // elle est effacée
    off.set = function(k, v) {
      if (k !== 'step' && k !== 'easing') return false;
      if (s.on !== 'scroll') return;
      // un réglage effacé : le moteur retire sa variable juste après, le thème se lit sans elle
      if (v === void 0) el.style.removeProperty('--mjs-stagger-' + k);
      regular(k, v);
    };
    return off;
  }
};
