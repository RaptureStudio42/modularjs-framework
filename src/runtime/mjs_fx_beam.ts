// mjs_fx_beam — `*beam` : des faisceaux de lumière floue qui entrent par un coin du fond de la
// balise, sous son contenu (un calque, dans le composant si la balise en est un). Réglages : color
// (la lumière ; blanc), angle (l'inclinaison des faisceaux, de -80 à 80 degrés ; -35), opacity (de 0
// à 1, atteinte à la fin de l'entrée ; 0.21), count (le nombre de faisceaux, de 1 à 4 ; 2), blur (le
// flou en px ; 70), origin (le coin d'entrée : top-left, top-right ; top-left), duration (l'entrée
// d'un faisceau ; 2s), delay (l'attente du premier faisceau, les suivants arrivent 250ms après leur
// voisin ; 750ms), on (view, hover, click, load). « Réduire les animations » : les faisceaux sont
// là tout de suite, à leur place.

µ._mjs_fxDefs.beam = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx~="beam"]{isolation:isolate}'
    + '[mjs-fx-layer="beam"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;border-radius:inherit}'
    + '[mjs-fx-layer="beam"][mjs-fx-beam-origin="top-right"]{transform:scaleX(-1)}'
    + '[mjs-fx-layer="beam"] i{position:absolute;display:block;left:-10%;top:-45%;width:120%;height:34%;border-radius:50%;background:var(--mjs-beam-color,#fff);opacity:0;filter:blur(var(--mjs-beam-blur,70px));transform-origin:0 50%}'
    + '[mjs-fx-layer="beam"] i:nth-child(2){top:-30%;height:22%}'
    + '[mjs-fx-layer="beam"] i:nth-child(3){top:-20%;height:14%}'
    + '[mjs-fx-layer="beam"] i:nth-child(4){top:-12%;height:9%}'
    + '[mjs-fx-layer="beam"][mjs-fx-beam-play] i{animation:mjs-fx-beam-in var(--mjs-beam-duration,2s) ease var(--mjs-beam-delay,750ms) forwards}'
    + '[mjs-fx-layer="beam"][mjs-fx-beam-play] i:nth-child(2){animation-delay:calc(var(--mjs-beam-delay,750ms) + 250ms)}'
    + '[mjs-fx-layer="beam"][mjs-fx-beam-play] i:nth-child(3){animation-delay:calc(var(--mjs-beam-delay,750ms) + 500ms)}'
    + '[mjs-fx-layer="beam"][mjs-fx-beam-play] i:nth-child(4){animation-delay:calc(var(--mjs-beam-delay,750ms) + 750ms)}'
    + '@keyframes mjs-fx-beam-in{0%{opacity:0;transform:rotate(calc(var(--mjs-beam-angle,-35deg) * -1)) translate(-22%,-12%) scale(.5)}100%{opacity:var(--mjs-beam-opacity,.21);transform:rotate(calc(var(--mjs-beam-angle,-35deg) * -1)) translate(0,0) scale(1)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="beam"] i,[mjs-fx-layer="beam"][mjs-fx-beam-play] i{animation:none;opacity:var(--mjs-beam-opacity,.21);transform:rotate(calc(var(--mjs-beam-angle,-35deg) * -1))}}',
  vars: { color: '', angle: 'deg', opacity: '', blur: 'px', duration: '', delay: '' },
  setup: function(el, s) {
    var count = Math.min(4, Math.max(1, Math.round(s.count || 2)));
    var host  = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'beam');
    var restore = µ._mjs_fxRelative(el);
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'beam');
    layer.setAttribute('aria-hidden', 'true');
    if (s.origin === 'top-right') layer.setAttribute('mjs-fx-beam-origin', 'top-right');
    for (var i = 0; i < count; i++) layer.appendChild(document.createElement('i'));
    µ._mjs_dom.insertBefore(host, layer, host.firstChild);
    // l'entrée rejouée : l'attribut retiré, la mise en page forcée, l'attribut reposé
    var stop = µ._mjs_fxWhen(el, s.on, function() {
      layer.removeAttribute('mjs-fx-beam-play');
      void layer.offsetWidth;
      layer.setAttribute('mjs-fx-beam-play', '');
    });
    return function() {
      stop();
      layer.remove();
      restore();
    };
  }
};
