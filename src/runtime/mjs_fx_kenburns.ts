// mjs_fx_kenburns — `*kenburns` : le lent zoom d'une photo qui glisse en même temps (l'effet
// « Ken Burns » des documentaires et des diaporamas). Posé sur le cadre de l'image —
// `<figure *kenburns><img …></figure>`, ou une balise qui a une image de fond — : le cadre ne bouge
// pas et ne déborde pas, l'image dedans avance. Réglages : zoom (l'agrandissement au bout du
// chemin ; 1.2), direction (le sens du glissement : un mot ou un angle ; right), distance (le
// glissement, en % du cadre — au-delà de (zoom − 1) × 50, le bord de l'image se découvre ; 5),
// duration (un aller ; 12s), easing (ease-in-out), on (always : aller-retour sans fin ; hover ;
// view ; click : un aller par clic ; load : un aller à l'apparition).

µ._mjs_fxDefs.kenburns = {
  // l'image d'une <picture> : la sienne bouge (la <picture>, en ligne, ne se transforme pas)
  css: '[mjs-fx~="kenburns"]{overflow:hidden;isolation:isolate}'
    + '[mjs-fx~="kenburns"] > :is(img,video),[mjs-fx~="kenburns"] > picture > img,[mjs-fx~="kenburns"][mjs-fx-kenburns-bg]::before{animation:var(--mjs-fx-kenburns-go,mjs-fx-kenburns) var(--mjs-kenburns-duration,12s) var(--mjs-kenburns-easing,ease-in-out) 0s var(--mjs-fx-kenburns-times,infinite) alternate both}'
    // une image de fond : sa copie (le même fond), sous le contenu, bouge à sa place
    + '[mjs-fx~="kenburns"][mjs-fx-kenburns-bg]::before{content:"";position:absolute;inset:0;z-index:-1;background:inherit}'
    + '@keyframes mjs-fx-kenburns{from{transform:scale(1) translate(0,0)}to{transform:scale(var(--mjs-kenburns-zoom,1.2)) translate(calc(var(--mjs-fx-kenburns-x,1) * var(--mjs-kenburns-distance,5) * 1%),calc(var(--mjs-fx-kenburns-y,0) * var(--mjs-kenburns-distance,5) * 1%))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="kenburns"] > :is(img,video),[mjs-fx~="kenburns"] > picture > img,[mjs-fx~="kenburns"][mjs-fx-kenburns-bg]::before{animation:none}}',
  vars: { zoom: '', distance: '', duration: '', easing: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxRelative(el);
    var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 90));
    el.style.setProperty('--mjs-fx-kenburns-x', String(v.x));
    el.style.setProperty('--mjs-fx-kenburns-y', String(v.y));
    var media = Array.prototype.some.call(el.children, function(c) { return /^(img|video|picture)$/.test(c.localName); });
    var cs    = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (!media && cs && cs.backgroundImage && cs.backgroundImage !== 'none') µ._mjs_dom.setAttribute(el, 'mjs-fx-kenburns-bg', '');
    var gate = µ._mjs_fxLoop(el, 'kenburns', s.on || 'always');
    return function() {
      gate();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-kenburns-bg');
      el.style.removeProperty('--mjs-fx-kenburns-x');
      el.style.removeProperty('--mjs-fx-kenburns-y');
      restore();
    };
  }
};
