// mjs_fx_unveil — `*unveil` : une barre de couleur passe sur la balise et la découvre (un
// pseudo-élément `::after`). Réglages : color (la barre ; rose), duration (1.1s), direction (le sens
// de la barre : right, left, up, down), delay (0s), easing, on (view, hover, click, load).

µ._mjs_fxDefs.unveil = {
  css: '[mjs-fx~="unveil"][mjs-fx-wait]{-webkit-text-fill-color:transparent}'
    + '[mjs-fx~="unveil"][mjs-fx-play~="unveil"]{animation:mjs-fx-unveil-text var(--mjs-unveil-duration,1.1s) steps(1) var(--mjs-unveil-delay,0s) both}'
    + '[mjs-fx~="unveil"]::after{content:"";position:absolute;inset:0;background:var(--mjs-unveil-color,#ff4fa3);transform:scale(0,1);pointer-events:none}'
    + '[mjs-fx~="unveil"][mjs-fx-play~="unveil"]::after{animation:var(--mjs-fx-unveil-name,mjs-fx-unveil-right) var(--mjs-unveil-duration,1.1s) var(--mjs-unveil-easing,ease-in-out) var(--mjs-unveil-delay,0s) both}'
    + '[mjs-fx~="unveil"][mjs-fx-unveil-dir="left"]{--mjs-fx-unveil-name:mjs-fx-unveil-left}'
    + '[mjs-fx~="unveil"][mjs-fx-unveil-dir="up"]{--mjs-fx-unveil-name:mjs-fx-unveil-up}'
    + '[mjs-fx~="unveil"][mjs-fx-unveil-dir="down"]{--mjs-fx-unveil-name:mjs-fx-unveil-down}'
    + '@keyframes mjs-fx-unveil-text{0%{-webkit-text-fill-color:transparent}50%,to{-webkit-text-fill-color:currentColor}}'
    + '@keyframes mjs-fx-unveil-right{0%{transform:scale(0,1);transform-origin:left}49.9%{transform:scale(1,1);transform-origin:left}50%{transform:scale(1,1);transform-origin:right}to{transform:scale(0,1);transform-origin:right}}'
    + '@keyframes mjs-fx-unveil-left{0%{transform:scale(0,1);transform-origin:right}49.9%{transform:scale(1,1);transform-origin:right}50%{transform:scale(1,1);transform-origin:left}to{transform:scale(0,1);transform-origin:left}}'
    + '@keyframes mjs-fx-unveil-down{0%{transform:scale(1,0);transform-origin:top}49.9%{transform:scale(1,1);transform-origin:top}50%{transform:scale(1,1);transform-origin:bottom}to{transform:scale(1,0);transform-origin:bottom}}'
    + '@keyframes mjs-fx-unveil-up{0%{transform:scale(1,0);transform-origin:bottom}49.9%{transform:scale(1,1);transform-origin:bottom}50%{transform:scale(1,1);transform-origin:top}to{transform:scale(1,0);transform-origin:top}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="unveil"][mjs-fx-play~="unveil"]{animation:none}[mjs-fx~="unveil"][mjs-fx-play~="unveil"]::after{animation:none}[mjs-fx~="unveil"][mjs-fx-wait]{-webkit-text-fill-color:currentColor}}',
  vars: { color: '', duration: '', delay: '', easing: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxRelative(el);
    if (s.direction && s.direction !== 'right') µ._mjs_dom.setAttribute(el, 'mjs-fx-unveil-dir', s.direction);
    var stop = µ._mjs_fxWhen(el, s.on, function() { µ._mjs_fxPlay(el, 'unveil'); });
    return function() {
      stop();
      µ._mjs_fxPlay(el, 'unveil', true);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-unveil-dir');
      restore();
    };
  }
};
