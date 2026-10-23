// mjs_fx_tracking — `*tracking` : les lettres arrivent écartées et se resserrent jusqu'à leur place
// (le « tracking in » des titres de film). Réglages : spacing (l'écart de départ entre deux
// lettres, en em — négatif : elles partent serrées l'une sur l'autre ; 0.5), blur (le flou de
// départ, px ; 0), opacity (l'opacité de départ ; 0), duration (900ms), delay (l'attente avant de
// partir), easing (ease-out), on (view, hover, click, load).

µ._mjs_fxDefs.tracking = {
  css: '[mjs-fx~="tracking"][mjs-fx-wait]{opacity:0}'
    + '[mjs-fx~="tracking"][mjs-fx-play~="tracking"]{animation:mjs-fx-tracking var(--mjs-tracking-duration,900ms) var(--mjs-tracking-easing,ease-out) var(--mjs-tracking-delay,0s) 1 both}'
    + '@keyframes mjs-fx-tracking{from{letter-spacing:var(--mjs-tracking-spacing,.5em);opacity:var(--mjs-tracking-opacity,0);filter:blur(var(--mjs-tracking-blur,0px))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="tracking"][mjs-fx-play~="tracking"][mjs-fx-play~="tracking"]{animation:none}}',
  vars: { spacing: 'em', blur: 'px', opacity: '', duration: '', delay: '', easing: '' },
  setup: function(el, s) {
    var stop = µ._mjs_fxWhen(el, s.on, function() { µ._mjs_fxPlay(el, 'tracking'); });
    return function() {
      stop();
      µ._mjs_fxPlay(el, 'tracking', true);
    };
  }
};
