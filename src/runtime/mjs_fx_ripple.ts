// mjs_fx_ripple — `*ripple` : une onde part du point touché (clic) ou du point d'entrée de la
// souris. Les ondes naissent dans un calque posé DANS l'élément (dernier enfant, recréé s'il a
// disparu), jamais sur l'élément lui-même : son débordement reste le sien. Sur un composant, le
// calque va dans le composant (son shadow root), qui reçoit la feuille de l'effet : le contenu
// passé au composant n'est pas touché, et l'onde couvre toute la balise.
// Posé sur `<@document>`, un anneau part de chaque point cliqué dans la page (dans un calque fixe
// posé dans le document).
// Réglages : color (currentColor ; sur `<@document>`, #03a9f4), duration (600ms), on (click : au
// toucher ; enter : à l'entrée du pointeur ; move : une onde douce à chaque mouvement du pointeur,
// au plus une par image), origin (le point d'où part l'onde : pointer — le point touché —, center,
// top-left…, « x% y% » ; pointer), opacity (l'opacité de l'onde au départ ; 0.35), easing, size (sur
// `<@document>` : le diamètre final de l'anneau en px ; 100).

µ._mjs_fxDefs.ripple = {
  css: '[mjs-fx-layer="ripple"]{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none}'
    + '[mjs-fx-drop]{position:absolute;border-radius:50%;background:var(--mjs-ripple-color,currentColor);opacity:var(--mjs-ripple-opacity,.35);transform:scale(0);pointer-events:none;animation:mjs-fx-ripple var(--mjs-ripple-duration,600ms) var(--mjs-ripple-easing,ease-out) forwards}'
    + '[mjs-fx-drop][mjs-fx-soft]{opacity:1;background:radial-gradient(circle,var(--mjs-ripple-color,rgba(255,255,255,.3)) 0%,transparent 70%)}'
    + '@keyframes mjs-fx-ripple{to{transform:scale(1);opacity:0}}'
    + '[mjs-fx-layer="ripple-page"]{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:hidden;pointer-events:none;z-index:2147483646}'
    + '[mjs-fx-ring]{position:absolute;box-sizing:border-box;border:2px solid var(--mjs-fx-ripple-c,#03a9f4);border-radius:50%;transform:translate(-50%,-50%);animation:mjs-fx-ripple-ring var(--mjs-ripple-duration,600ms) linear forwards}'
    + '@keyframes mjs-fx-ripple-ring{0%{width:0;height:0;opacity:1}50%{opacity:1}100%{width:var(--mjs-fx-ripple-size,100px);height:var(--mjs-fx-ripple-size,100px);opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-drop]{display:none}[mjs-fx-ring]{display:none}}',
  vars: { color: '', duration: '', opacity: '', easing: '' },
  setup: function(el, s) {
    // sur <@document> : un anneau à chaque point cliqué de la page
    if (el === document.documentElement) {
      µ._mjs_fxAdopt(document, 'ripple');
      var page = document.createElement('span');
      page.setAttribute('mjs-fx-layer', 'ripple-page');
      page.setAttribute('aria-hidden', 'true');
      page.style.setProperty('--mjs-fx-ripple-c', s.color || '#03a9f4');
      page.style.setProperty('--mjs-fx-ripple-size', (s.size || 100) + 'px');
      document.body.appendChild(page);
      var ev   = s.on === 'move' ? 'pointermove' : s.on === 'enter' ? 'pointerover' : 'pointerdown';
      var dur  = µ._mjs_fxMs(s.duration, 600);
      var ring = function(e) {
        var r = document.createElement('i');
        r.setAttribute('mjs-fx-ring', '');
        r.style.left = e.clientX + 'px';
        r.style.top  = e.clientY + 'px';
        r.addEventListener('animationend', function() { r.remove(); });
        page.appendChild(r);
        setTimeout(function() { r.remove(); }, dur + 100);
      };
      document.addEventListener(ev, ring);
      var gone = function() {
        document.removeEventListener(ev, ring);
        page.remove();
      };
      // retouchées à chaud (panneau de développement) : la couleur et la durée, que les anneaux
      // recopient, suivent sans reposer l'effet
      gone.set = function(k, v) {
        if (k === 'color') page.style.setProperty('--mjs-fx-ripple-c', v || '#03a9f4');
        else if (k === 'duration') dur = µ._mjs_fxMs(v, 600);
        else return false;
      };
      return gone;
    }
    var restore = µ._mjs_fxRelative(el);
    var type    = s.on === 'enter' ? 'pointerenter' : s.on === 'move' ? 'pointermove' : 'pointerdown';
    var soft    = s.on === 'move';
    var frame   = 0;
    var layer   = null;
    // le point du pointeur dans la boîte où naissent les ondes (le calque `inset:0`) : bordure déduite,
    // mise à l'échelle (scale, *zoom) défaite
    var spot = function(e, r) {
      var kx = el.offsetWidth ? r.width / el.offsetWidth : 1;
      var ky = el.offsetHeight ? r.height / el.offsetHeight : 1;
      return { x: (e.clientX - r.left) / kx - el.clientLeft, y: (e.clientY - r.top) / ky - el.clientTop, w: el.clientWidth || r.width / kx, h: el.clientHeight || r.height / ky };
    };
    var fire = function(e) {
      // « réduire les animations » : aucune onde — une goutte qui ne s'anime pas n'est jamais retirée
      // (son retrait attend la fin de son animation)
      if (µ._mjs_fxCalm()) return;
      // au mouvement : au plus une onde par image
      if (soft) {
        if (frame) return;
        frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(function() { frame = 0; }) : (setTimeout(function() { frame = 0; }, 16), 1);
      }
      // l'intérieur d'un composant se lit au premier geste : il peut se monter après la pose
      var host = µ._mjs_fxInner(el) || el;
      if (!layer || layer.parentNode !== host) {
        if (layer) layer.remove();
        if (host !== el) µ._mjs_fxAdopt(host, 'ripple');
        layer = document.createElement('span');
        layer.setAttribute('mjs-fx-layer', 'ripple');
        layer.setAttribute('aria-hidden', 'true');
        µ._mjs_dom.appendChild(host, layer);
      }
      var p    = spot(e, µ._mjs_dom.getBoundingClientRect(el));
      var at   = µ._mjs_fxPoint(s.origin, null);
      var x    = at ? at.x * p.w : p.x;
      var y    = at ? at.y * p.h : p.y;
      var d    = 2 * Math.hypot(Math.max(x, p.w - x), Math.max(y, p.h - y));
      var drop = document.createElement('span');
      drop.setAttribute('mjs-fx-drop', '');
      if (soft) drop.setAttribute('mjs-fx-soft', '');
      drop.style.width  = d + 'px';
      drop.style.height = d + 'px';
      drop.style.left   = (x - d / 2) + 'px';
      drop.style.top    = (y - d / 2) + 'px';
      drop.addEventListener('animationend', function() { drop.remove(); });
      layer.appendChild(drop);
    };
    µ._mjs_dom.addEventListener(el, type, fire);
    return function() {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      µ._mjs_dom.removeEventListener(el, type, fire);
      if (layer) layer.remove();
      restore();
    };
  }
};
