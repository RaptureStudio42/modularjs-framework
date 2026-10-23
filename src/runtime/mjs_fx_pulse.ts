// mjs_fx_pulse — `*pulse` : un anneau lumineux bat autour de la balise, en boucle, pour attirer
// l'œil. Réglages : color (l'anneau ; bleu), where (box : un anneau autour du cadre ; text : un halo
// autour des lettres), size (jusqu'où il s'étend en px ; 16), speed (un battement ; 1.8s),
// direction (out : l'anneau part de la balise ; in : il revient vers elle), delay (l'attente avant
// le premier battement), on (always, hover, view, click, load).

µ._mjs_fxDefs.pulse = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  css: '[mjs-fx~="pulse"]{animation:var(--mjs-fx-pulse-go,var(--mjs-fx-pulse-name,mjs-fx-pulse)) var(--mjs-pulse-speed,1.8s) ease-out var(--mjs-pulse-delay,0s) var(--mjs-fx-pulse-times,infinite) var(--mjs-fx-pulse-dir,normal)}'
    + '[mjs-fx~="pulse"][mjs-fx-pulse-where="text"]{--mjs-fx-pulse-name:mjs-fx-pulse-text}'
    + '@keyframes mjs-fx-pulse{0%{box-shadow:0 0 0 0 var(--mjs-pulse-color,rgba(88,166,255,.6))}70%{box-shadow:0 0 0 var(--mjs-pulse-size,16px) transparent}100%{box-shadow:0 0 0 0 transparent}}'
    + '@keyframes mjs-fx-pulse-text{0%{text-shadow:0 0 0 var(--mjs-pulse-color,rgba(88,166,255,.6))}70%{text-shadow:0 0 var(--mjs-pulse-size,16px) transparent}100%{text-shadow:0 0 0 transparent}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="pulse"][mjs-fx~="pulse"]{animation:none}}',
  vars: { color: '', size: 'px', speed: '', delay: '' },
  setup: function(el, s) {
    if (s.where === 'text') µ._mjs_dom.setAttribute(el, 'mjs-fx-pulse-where', 'text');
    if (s.direction === 'in') el.style.setProperty('--mjs-fx-pulse-dir', 'reverse');
    var gate = µ._mjs_fxLoop(el, 'pulse', s.on);
    return function() {
      gate();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-pulse-where');
      el.style.removeProperty('--mjs-fx-pulse-dir');
    };
  }
};
