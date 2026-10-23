// mjs_fx_circular — `*circular` : le texte posé en cercle, qui tourne (un badge « défiler • défiler
// • » au coin d'une page). Chaque caractère, espaces compris, prend sa part du cercle : un texte qui
// finit par une espace referme la boucle proprement. Sur un calque posé par-dessus le texte, qui
// reste en place, invisible ; la balise prend la taille du cercle. Réglages : radius (le rayon, px ;
// 60), speed (un tour ; 12s), direction (cw : le sens des aiguilles d'une montre, ccw ; cw), on
// (always, hover, view, click : un tour par clic, load : un tour à l'apparition).

µ._mjs_fxDefs.circular = {
  css: '[mjs-fx~="circular"]{display:inline-block;width:calc(2 * var(--mjs-circular-radius,60px));height:calc(2 * var(--mjs-circular-radius,60px));white-space:nowrap;text-indent:-99999px;vertical-align:middle}'
    + '[mjs-fx~="circular"] [mjs-fx-layer="text"]{inset:auto;left:50%;top:50%;width:0;height:0;padding:0;text-indent:0;animation:var(--mjs-fx-circular-go,mjs-fx-circular) var(--mjs-circular-speed,12s) linear 0s var(--mjs-fx-circular-times,infinite) var(--mjs-fx-circular-dir,normal)}'
    // chaque caractère centré sur le cercle, tourné vers l'extérieur
    + '[mjs-fx~="circular"] [mjs-fx-letter]{position:absolute;left:0;top:0;white-space:pre;transform:translate(-50%,-50%) rotate(calc(var(--i) * 360deg / var(--n))) translateY(calc(-1 * var(--mjs-circular-radius,60px)))}'
    + '@keyframes mjs-fx-circular{to{transform:rotate(360deg)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="circular"] [mjs-fx-layer="text"][mjs-fx-layer="text"]{animation:none}}',
  vars: { radius: 'px', speed: '' },
  setup: function(el, s, comp) {
    if (s.direction === 'ccw') el.style.setProperty('--mjs-fx-circular-dir', 'reverse');
    var tx = µ._mjs_fxLayer(comp, el, function(layer, txt) {
      var chars = µ._mjs_fxGraphemes(txt.replace(/\s+/g, ' ').replace(/^ /, ''));
      for (var i = 0; i < chars.length; i++) {
        var l = document.createElement('span');
        l.setAttribute('mjs-fx-letter', '');
        l.textContent = chars[i];
        l.style.setProperty('--i', String(i));
        layer.appendChild(l);
      }
      layer.style.setProperty('--n', String(Math.max(1, chars.length)));
    }, true);
    var gate = µ._mjs_fxLoop(el, 'circular', s.on || 'always');
    return function() {
      gate();
      tx.off();
      el.style.removeProperty('--mjs-fx-circular-dir');
    };
  }
};
