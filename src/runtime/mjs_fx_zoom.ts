// mjs_fx_zoom — `*zoom` : le contenu grossit dans son cadre, qui ne bouge pas. Sur un cadre
// (`<figure>`, une carte), ses enfants grossissent et le surplus est rogné ; sur une image, une
// vidéo, un composant, une balise sans enfant ou un texte (du texte à elle, des enfants en ligne qui
// ne se transforment pas), la balise grossit dans ses propres limites — rognée le temps du zoom et de
// son retour seulement : au repos, rien n'est coupé (anneau de focus, ombre, menu qui déborde). Les
// calques posés par d'autres effets (`mjs-fx-layer`) ne grossissent pas. Sur la balise elle-même, sa
// transition s'ajoute à celle de l'auteur. Le grossissement passe par la propriété `scale`, qui s'ajoute au
// `transform` de l'auteur ; sur la balise elle-même, une translation de l'auteur (un badge centré par
// translate(-50%, -50%)) déplace aussi le point d'origine : elle grossit à sa place à l'écran.
// Réglages : scale (1.5), origin (le point d'où le contenu grossit : center, top-left…, « x% y% »,
// ou pointer : le point sous la souris, qui suit ; center), duration (500ms), easing, on (hover,
// view, click, always).

µ._mjs_fxDefs.zoom = {
  css: '[mjs-fx~="zoom"]:not([mjs-fx-zoom-self]){overflow:hidden}'
    + '[mjs-fx~="zoom"]:not([mjs-fx-zoom-self]) > :where(:not([mjs-fx-layer])){transform-origin:calc(var(--mjs-fx-zoom-ox,.5) * 100%) calc(var(--mjs-fx-zoom-oy,.5) * 100%);transition:scale var(--mjs-zoom-duration,500ms) var(--mjs-zoom-easing,ease)}'
    + '[mjs-fx~="zoom"][mjs-fx-on~="zoom"]:not([mjs-fx-zoom-self]) > :where(:not([mjs-fx-layer])){scale:var(--mjs-zoom-scale,1.5)}'
    // sur la balise elle-même : le surplus est rogné autour du point d'origine (même hors du centre) ;
    // la découpe (`mjs-fx-zoom-clip`) part de inset(0), posée juste avant le zoom (`mjs-fx-zoom-go`),
    // et part une fois le retour fini
    + '[mjs-fx~="zoom"][mjs-fx-zoom-self]{transform-origin:calc(var(--mjs-fx-zoom-ox,.5) * 100% + var(--mjs-fx-zoom-tx,0px)) calc(var(--mjs-fx-zoom-oy,.5) * 100% + var(--mjs-fx-zoom-ty,0px))}'
    + '[mjs-fx~="zoom"][mjs-fx-zoom-self]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="zoom"][mjs-fx-zoom-self][mjs-fx-zoom-clip]{clip-path:inset(0)}'
    + '[mjs-fx~="zoom"][mjs-fx-zoom-self][mjs-fx-zoom-clip][mjs-fx-zoom-go]{scale:var(--mjs-zoom-scale,1.5);clip-path:inset(calc(var(--mjs-fx-zoom-oy,.5) * (1 - 1 / var(--mjs-zoom-scale,1.5)) * 100%) calc((1 - var(--mjs-fx-zoom-ox,.5)) * (1 - 1 / var(--mjs-zoom-scale,1.5)) * 100%) calc((1 - var(--mjs-fx-zoom-oy,.5)) * (1 - 1 / var(--mjs-zoom-scale,1.5)) * 100%) calc(var(--mjs-fx-zoom-ox,.5) * (1 - 1 / var(--mjs-zoom-scale,1.5)) * 100%))}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="zoom"][mjs-fx-on~="zoom"]:not([mjs-fx-zoom-self]) > :where(:not([mjs-fx-layer])){scale:none}[mjs-fx~="zoom"][mjs-fx-zoom-self][mjs-fx-zoom-clip][mjs-fx-zoom-clip]{scale:none;clip-path:none}}',
  vars: { scale: '', duration: '', easing: '' },
  setup: function(el, s) {
    // les enfants grossissent seuls s'ils le peuvent : pas de texte à la balise (il resterait tel
    // quel), et au moins un enfant transformable (une balise en ligne ne l'est pas, une image si)
    var kids = function() {
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 && /\S/.test(c.data)) return false;
      }
      for (var i = 0; i < el.children.length; i++) {
        var k = el.children[i];
        if (µ._mjs_dom.hasAttribute(k, 'mjs-fx-layer')) continue;
        if (typeof getComputedStyle !== 'function' || getComputedStyle(k).display !== 'inline' || /^(img|video|canvas|iframe|svg|object|embed|input|textarea|select)$/.test(k.localName)) return true;
      }
      return false;
    };
    var self    = µ._mjs_fxBoxy(el) || !kids();
    var restore = µ._mjs_fxMovable(el);
    if (self) µ._mjs_dom.setAttribute(el, 'mjs-fx-zoom-self', '');
    var tr  = self ? µ._mjs_fxTransition(el, 'zoom', 'scale var(--mjs-zoom-duration,500ms) var(--mjs-zoom-easing,ease),clip-path var(--mjs-zoom-duration,500ms) var(--mjs-zoom-easing,ease)') : function() {};
    var aim = function(e) {
      var r = µ._mjs_dom.getBoundingClientRect(el);
      if (!r.width || !r.height) return;
      el.style.setProperty('--mjs-fx-zoom-ox', Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3));
      el.style.setProperty('--mjs-fx-zoom-oy', Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(3));
    };
    var at = µ._mjs_fxPoint(s.origin);
    if (at) {
      el.style.setProperty('--mjs-fx-zoom-ox', String(at.x));
      el.style.setProperty('--mjs-fx-zoom-oy', String(at.y));
    }
    else µ._mjs_dom.addEventListener(el, 'pointermove', aim);
    var gate = µ._mjs_fxState(el, 'zoom', s.on);
    // la balise elle-même : l'état actif suivi (`mjs-fx-on`) — la découpe posée et calculée AVANT le
    // zoom, sa transition part de inset(0) et le surplus est rogné dès la première image ; retirée
    // quand le retour est fini (la durée lue sur la balise : réglage ou thème)
    var mo   = null;
    var wait = null;
    // la translation de l'auteur (son , une translation seule) : le point d'origine la suit, la balise grossit à sa place à
    // l'écran ; relue à chaque zoom, rendue au retrait de la découpe
    var shift = function(on) {
      var m = on && typeof getComputedStyle === 'function' ? /^matrix\(1, 0, 0, 1, (-?[\d.e+-]+), (-?[\d.e+-]+)\)$/.exec(getComputedStyle(el).transform) : null;
      if (m) {
        el.style.setProperty('--mjs-fx-zoom-tx', m[1] + 'px');
        el.style.setProperty('--mjs-fx-zoom-ty', m[2] + 'px');
      }
      else {
        el.style.removeProperty('--mjs-fx-zoom-tx');
        el.style.removeProperty('--mjs-fx-zoom-ty');
      }
    };
    var sync = function() {
      clearTimeout(wait);
      var on = (µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').indexOf('zoom') >= 0;
      if (on) {
        if (!µ._mjs_dom.hasAttribute(el, 'mjs-fx-zoom-clip')) {
          shift(true);
          µ._mjs_dom.setAttribute(el, 'mjs-fx-zoom-clip', '');
          if (typeof getComputedStyle === 'function') void getComputedStyle(el).clipPath;
        }
        µ._mjs_dom.setAttribute(el, 'mjs-fx-zoom-go', '');
      }
      else if (µ._mjs_dom.hasAttribute(el, 'mjs-fx-zoom-go')) {
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-zoom-go');
        wait = setTimeout(function() {
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-zoom-clip');
          shift(false);
        }, µ._mjs_fxMs(µ._mjs_fxCss(el, '--mjs-zoom-duration'), 500) + 50);
      }
    };
    if (self) {
      mo = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null;
      if (mo) mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-on'] });
      sync();
    }
    return function() {
      gate();
      if (mo) mo.disconnect();
      clearTimeout(wait);
      µ._mjs_dom.removeEventListener(el, 'pointermove', aim);
      el.style.removeProperty('--mjs-fx-zoom-ox');
      el.style.removeProperty('--mjs-fx-zoom-oy');
      shift(false);
      tr();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-zoom-self');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-zoom-clip');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-zoom-go');
      restore();
    };
  }
};
