// mjs_fx_split — `*split` : le texte se coupe en deux moitiés qui glissent chacune de son côté (deux
// pseudo-éléments qui recopient le texte). La coupe passe par le centre, dans le sens du
// glissement ; chaque moitié glisse de son côté. Réglages : color (la seconde moitié ; la couleur du
// texte), distance (px ; 8), direction (le sens du glissement : un mot ou un angle — right : moitiés
// haute et basse qui glissent de côté ; up : moitiés gauche et droite qui glissent en hauteur ; 45 :
// une coupe en diagonale ; right), duration (350ms), on (hover, view, click, always).

µ._mjs_fxDefs.split = {
  css: '[mjs-fx~="split"]{-webkit-text-fill-color:transparent}'
    // les moitiés ne se lisent pas (texte de remplacement vide) : le texte de la balise, resté en place,
    // est lu une fois ; la première déclaration sert aux navigateurs qui ne connaissent pas `/ ""`
    + '[mjs-fx~="split"]::before,[mjs-fx~="split"]::after{content:attr(mjs-fx-split-text);content:attr(mjs-fx-split-text) / "";white-space-collapse:preserve-breaks;position:absolute;inset:0;box-sizing:border-box;padding:inherit;-webkit-text-fill-color:currentColor;transition:transform var(--mjs-split-duration,350ms) ease;pointer-events:none}'
    + '[mjs-fx~="split"][mjs-fx-split-pre]::before,[mjs-fx~="split"][mjs-fx-split-pre]::after{white-space-collapse:inherit}'
    + '[mjs-fx~="split"]::before{clip-path:var(--mjs-fx-split-a,inset(0 0 50% 0))}'
    + '[mjs-fx~="split"]::after{clip-path:var(--mjs-fx-split-b,inset(50% 0 0 0));-webkit-text-fill-color:var(--mjs-split-color,currentColor)}'
    + '[mjs-fx~="split"][mjs-fx-on~="split"]::before{transform:translate(calc(var(--mjs-fx-split-x,1) * -1 * var(--mjs-split-distance,8px)),calc(var(--mjs-fx-split-y,0) * -1 * var(--mjs-split-distance,8px)))}'
    + '[mjs-fx~="split"][mjs-fx-on~="split"]::after{transform:translate(calc(var(--mjs-fx-split-x,1) * var(--mjs-split-distance,8px)),calc(var(--mjs-fx-split-y,0) * var(--mjs-split-distance,8px)))}'
    + µ._mjs_fxPlaceCss(function(a) { return '[mjs-fx~="split"]' + a + '::before,[mjs-fx~="split"]' + a + '::after'; })
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="split"]::before,[mjs-fx~="split"]::after{transition:none}}',
  vars: { color: '', distance: 'px', duration: '' },
  setup: function(el, s) {
    // le texte propre de la balise, suivi : les calques des autres effets posés dessus (lettres,
    // compteur) n'y entrent pas, et leurs changements ne le relisent pas ; un <br> y coupe la ligne (cf. µ._mjs_fxCopyText)
    var sync = function() {
      µ._mjs_dom.setAttribute(el, 'mjs-fx-split-text', µ._mjs_fxCopyText(el));
      // une balise qui garde ses espaces (`pre`, `pre-wrap`…) : la copie aussi, sinon elle replie ceux qui se suivent
      if (/^(?:pre|break)/.test(getComputedStyle(el).whiteSpace || '')) µ._mjs_dom.setAttribute(el, 'mjs-fx-split-pre', '');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-split-pre');
    };
    sync();
    var watch   = µ._mjs_fxOnText(el, sync);
    var restore = µ._mjs_fxRelative(el);
    var place   = µ._mjs_fxPlace(el);
    var v       = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 90));
    el.style.setProperty('--mjs-fx-split-x', String(v.x));
    el.style.setProperty('--mjs-fx-split-y', String(v.y));
    // les deux moitiés : la balise (en %) coupée par la droite qui passe au centre dans le sens du
    // glissement ; ses proportions comptent pour une coupe en biais (recalculée quand elle change)
    var half = function(nx, ny) {
      var sq  = [[0, 0], [100, 0], [100, 100], [0, 100]];
      var out = [];
      for (var i = 0; i < 4; i++) {
        var a  = sq[i];
        var b  = sq[(i + 1) % 4];
        var da = (a[0] - 50) * nx + (a[1] - 50) * ny;
        var db = (b[0] - 50) * nx + (b[1] - 50) * ny;
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) {
          var t = da / (da - db);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      return 'polygon(' + out.map(function(p) { return Math.round(p[0] * 100) / 100 + '% ' + Math.round(p[1] * 100) / 100 + '%'; }).join(',') + ')';
    };
    var cut = function() {
      // la boîte des moitiés : celle de la balise, ou celle du texte quand elles se rangent comme lui
      var cs = µ._mjs_dom.hasAttribute(el, 'mjs-fx-place-h') || µ._mjs_dom.hasAttribute(el, 'mjs-fx-place-v') ? getComputedStyle(el, '::before') : null;
      var W  = (cs && parseFloat(cs.width)) || el.clientWidth || 1;
      var H  = (cs && parseFloat(cs.height)) || el.clientHeight || 1;
      // la normale de la coupe, vue en % de la balise
      var nx = -v.y / H;
      var ny = v.x / W;
      el.style.setProperty('--mjs-fx-split-a', half(-nx, -ny));
      el.style.setProperty('--mjs-fx-split-b', half(nx, ny));
    };
    cut();
    var ro = typeof ResizeObserver === 'function' && v.x !== 0 && v.y !== 0 ? new ResizeObserver(cut) : null;
    if (ro) ro.observe(el);
    var gate = µ._mjs_fxState(el, 'split', s.on);
    return function() {
      gate();
      watch();
      if (ro) ro.disconnect();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-split-text');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-split-pre');
      ['--mjs-fx-split-x', '--mjs-fx-split-y', '--mjs-fx-split-a', '--mjs-fx-split-b'].forEach(function(k) { el.style.removeProperty(k); });
      place.off();
      restore();
    };
  }
};
