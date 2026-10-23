// mjs_fx_orbit — `*orbit` : les enfants de la balise tournent en cercle autour de son centre (des
// logos autour d'un produit, des icônes autour d'un avatar). Chacun prend sa place sur le cercle, à
// égale distance des autres ; un enfant ajouté ou retiré (un {for}) et tout se répartit de nouveau.
// La balise prend au moins la taille du cercle. Réglages : radius (le rayon, px ; 120), speed (un
// tour ; 20s), direction (cw : le sens des aiguilles d'une montre, ccw ; cw), upright (les enfants
// restent droits, sinon ils tournent avec le cercle ; oui), on (always, hover, view, click : un
// tour par clic, load : un tour à l'apparition).

µ._mjs_fxDefs.orbit = {
  css: '[mjs-fx~="orbit"]{min-width:calc(2 * var(--mjs-orbit-radius,120px));min-height:calc(2 * var(--mjs-orbit-radius,120px))}'
    // au repos (animation coupée, mouvement réduit) : chacun reste à sa place sur le cercle
    + '[mjs-fx~="orbit"] > [mjs-fx-orbit-item]{position:absolute;left:50%;top:50%;margin:0;transform:translate(-50%,-50%) rotate(calc(var(--mjs-fx-orbit-a) * 1deg)) translateY(calc(-1 * var(--mjs-orbit-radius,120px))) rotate(calc(var(--mjs-fx-orbit-a) * -1deg));animation:var(--mjs-fx-orbit-go,mjs-fx-orbit) var(--mjs-orbit-speed,20s) linear 0s var(--mjs-fx-orbit-times,infinite) var(--mjs-fx-orbit-dir,normal)}'
    + '[mjs-fx~="orbit"][mjs-fx-orbit-free] > [mjs-fx-orbit-item]{transform:translate(-50%,-50%) rotate(calc(var(--mjs-fx-orbit-a) * 1deg)) translateY(calc(-1 * var(--mjs-orbit-radius,120px)));animation-name:var(--mjs-fx-orbit-go,mjs-fx-orbit-free)}'
    + '@keyframes mjs-fx-orbit{from{transform:translate(-50%,-50%) rotate(calc(var(--mjs-fx-orbit-a) * 1deg)) translateY(calc(-1 * var(--mjs-orbit-radius,120px))) rotate(calc(var(--mjs-fx-orbit-a) * -1deg))}to{transform:translate(-50%,-50%) rotate(calc(var(--mjs-fx-orbit-a) * 1deg + 360deg)) translateY(calc(-1 * var(--mjs-orbit-radius,120px))) rotate(calc(var(--mjs-fx-orbit-a) * -1deg - 360deg))}}'
    + '@keyframes mjs-fx-orbit-free{from{transform:translate(-50%,-50%) rotate(calc(var(--mjs-fx-orbit-a) * 1deg)) translateY(calc(-1 * var(--mjs-orbit-radius,120px)))}to{transform:translate(-50%,-50%) rotate(calc(var(--mjs-fx-orbit-a) * 1deg + 360deg)) translateY(calc(-1 * var(--mjs-orbit-radius,120px)))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="orbit"] > [mjs-fx-orbit-item]{animation:none}[mjs-fx~="orbit"][mjs-fx-orbit-free] > [mjs-fx-orbit-item]{animation:none}}',
  vars: { radius: 'px', speed: '' },
  setup: function(el, s) {
    var restore = µ._mjs_fxRelative(el);
    if (s.direction === 'ccw') el.style.setProperty('--mjs-fx-orbit-dir', 'reverse');
    if (s.upright === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-orbit-free', '');
    var items = [];
    var clear = function() {
      for (var i = 0; i < items.length; i++) {
        µ._mjs_dom.removeAttribute(items[i], 'mjs-fx-orbit-item');
        items[i].style.removeProperty('--mjs-fx-orbit-a');
      }
    };
    // chaque enfant à son angle : 360° partagés également
    var place = function() {
      clear();
      items = Array.prototype.filter.call(el.children, function(c) { return !µ._mjs_dom.hasAttribute(c, 'mjs-fx-layer'); });
      for (var i = 0; i < items.length; i++) {
        µ._mjs_dom.setAttribute(items[i], 'mjs-fx-orbit-item', '');
        items[i].style.setProperty('--mjs-fx-orbit-a', String(Math.round(i * 36000 / items.length) / 100));
      }
    };
    place();
    var mo = typeof MutationObserver === 'function' ? new MutationObserver(place) : null;
    if (mo) mo.observe(el, { childList: true });
    var gate = µ._mjs_fxLoop(el, 'orbit', s.on || 'always');
    return function() {
      gate();
      if (mo) mo.disconnect();
      clear();
      items = [];
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-orbit-free');
      el.style.removeProperty('--mjs-fx-orbit-dir');
      restore();
    };
  }
};
