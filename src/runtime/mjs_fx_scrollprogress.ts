// mjs_fx_scrollprogress — `*scrollprogress` : une barre de lecture qui suit le défilement. Un calque
// dans la balise (dans le composant, sur un composant) : un rail et une barre qui grandit avec le
// défilement VERTICAL — la barre vaut 0 en haut, 1 tout en bas ; une balise qui ne déborde pas, une
// page sans défilement : barre vide, sans erreur. Réglages : color (la barre ; #58a6ff), colors (un
// dégradé à la place de la couleur, sur toute la longueur de la barre ; rien), track (la couleur du
// rail ; aucun rail), thickness (px ; 4), place (top, bottom, left, right : left et right donnent une
// barre verticale ; top), source (self : la balise défile elle-même — `overflow: auto` — et la barre
// reste collée à son bord pendant le défilement ; page : la barre suit le défilement de la page,
// fixée au bord de la fenêtre ; self), origin (start, center : elle grandit depuis le milieu, end ;
// start), radius (px ; 0), glow (px : un halo de la couleur de la barre ; 0), zindex (10), duration
// (un lissage du mouvement ; 0s = collée au défilement, suivi sur place quand une variable le tient).
// Deux techniques : `animation-timeline: scroll()` là où il existe (Chromium), pour la page ou une
// balise qui défile (overflow) — aucun JavaScript par pixel, la barre est une animation CSS pilotée
// par le défilement ; sinon (Firefox par défaut, une balise qui ne défile pas)
// un écouteur de défilement passif qui pose une variable CSS, une fois par image. Un lissage
// (duration > 0) passe toujours par la variable : la ligne de temps du défilement ne se lisse pas.
// Accessibilité : le calque porte `role="progressbar"` (0 à 100), un nom (« Progression de la
// lecture » : libellé du framework, clé `mjs.fx.progress` du dictionnaire du projet) et `aria-valuenow`, tenu à jour
// au plus quatre fois par seconde, un lecteur d'écran y trouve où l'on en est de la lecture ; la
// valeur n'est annoncée que si l'on se pose sur la barre, aucun bavardage. Collée à la balise
// (source: self), la barre se pose en position `sticky` : elle ne prend pas de place, mais elle
// ignore le `padding` de la balise et compte sur une balise qui n'est pas un conteneur flex ou
// grille ; une barre verticale a besoin d'une hauteur, relue sur la balise.

µ._mjs_fxDefs.scrollprogress = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx-layer="scrollprogress"]{display:block;box-sizing:border-box;overflow:clip;pointer-events:none;z-index:var(--mjs-scrollprogress-zindex,10);border-radius:var(--mjs-scrollprogress-radius,0px);background:var(--mjs-scrollprogress-track,transparent)}'
    + '[mjs-fx-layer="scrollprogress"][mjs-fx-scrollprogress-glow]{overflow:visible;filter:drop-shadow(0 0 var(--mjs-scrollprogress-glow,0px) var(--mjs-fx-scrollprogress-halo,var(--mjs-scrollprogress-color,#58a6ff)))}'
    + '[mjs-fx-layer="scrollprogress"] i{display:block;width:100%;height:100%;border-radius:inherit;background:var(--mjs-scrollprogress-color,#58a6ff);transform-origin:0 50%;transform:scaleX(var(--mjs-fx-scrollprogress-p,0));transition:transform var(--mjs-scrollprogress-duration,0s) linear}'
    + '[mjs-fx-layer="scrollprogress"][mjs-fx-scrollprogress-gradient] i{background:linear-gradient(to right,var(--mjs-scrollprogress-colors))}'
    // la balise défile (source: self) : le calque se colle à son bord, sans prendre de place
    + '[mjs-fx-scrollprogress-place="top"]{position:sticky;top:0;width:100%;height:var(--mjs-scrollprogress-thickness,4px);margin-bottom:calc(-1 * var(--mjs-scrollprogress-thickness,4px))}'
    + '[mjs-fx-scrollprogress-place="bottom"]{position:sticky;bottom:0;width:100%;height:var(--mjs-scrollprogress-thickness,4px);margin-top:calc(-1 * var(--mjs-scrollprogress-thickness,4px))}'
    + '[mjs-fx-scrollprogress-place="left"]{position:sticky;top:0;float:left;width:var(--mjs-scrollprogress-thickness,4px);height:var(--mjs-fx-scrollprogress-size,100%);margin-right:calc(-1 * var(--mjs-scrollprogress-thickness,4px))}'
    + '[mjs-fx-scrollprogress-place="right"]{position:sticky;top:0;float:right;width:var(--mjs-scrollprogress-thickness,4px);height:var(--mjs-fx-scrollprogress-size,100%);margin-left:calc(-1 * var(--mjs-scrollprogress-thickness,4px))}'
    // la page défile (source: page) : le calque est fixé au bord de la fenêtre
    + '[mjs-fx-scrollprogress-source="page"]{position:fixed;float:none;margin:0;height:var(--mjs-scrollprogress-thickness,4px)}'
    + '[mjs-fx-scrollprogress-source="page"][mjs-fx-scrollprogress-place="top"]{top:0;left:0;right:auto;bottom:auto}'
    + '[mjs-fx-scrollprogress-source="page"][mjs-fx-scrollprogress-place="bottom"]{bottom:0;left:0;top:auto;right:auto}'
    + '[mjs-fx-scrollprogress-source="page"][mjs-fx-scrollprogress-place="left"]{left:0;top:0;width:var(--mjs-scrollprogress-thickness,4px);height:100%}'
    + '[mjs-fx-scrollprogress-source="page"][mjs-fx-scrollprogress-place="right"]{right:0;top:0;left:auto;width:var(--mjs-scrollprogress-thickness,4px);height:100%}'
    // le sens de la barre : verticale à gauche et à droite ; l'origine de sa croissance
    + '[mjs-fx-scrollprogress-place="left"] i,[mjs-fx-scrollprogress-place="right"] i{transform-origin:50% 0;transform:scaleY(var(--mjs-fx-scrollprogress-p,0))}'
    + '[mjs-fx-scrollprogress-origin="center"] i{transform-origin:50% 50%!important}'
    + '[mjs-fx-scrollprogress-origin="end"] i{transform-origin:100% 50%!important}'
    + '[mjs-fx-scrollprogress-origin="end"][mjs-fx-scrollprogress-place="left"] i,[mjs-fx-scrollprogress-origin="end"][mjs-fx-scrollprogress-place="right"] i{transform-origin:50% 100%!important}'
    + '[mjs-fx-scrollprogress-gradient][mjs-fx-scrollprogress-place="left"] i,[mjs-fx-scrollprogress-gradient][mjs-fx-scrollprogress-place="right"] i{background:linear-gradient(to bottom,var(--mjs-scrollprogress-colors))}'
    // ligne de temps du défilement : la barre est une animation pilotée par le défilement
    + '@keyframes mjs-fx-scrollprogress-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}'
    + '@keyframes mjs-fx-scrollprogress-growy{from{transform:scaleY(0)}to{transform:scaleY(1)}}'
    + '[mjs-fx-scrollprogress-native] i{transition:none;animation:mjs-fx-scrollprogress-grow linear both;animation-timeline:scroll(nearest)}'
    + '[mjs-fx-scrollprogress-native][mjs-fx-scrollprogress-source="page"] i{animation-timeline:scroll(root)}'
    + '[mjs-fx-scrollprogress-native][mjs-fx-scrollprogress-place="left"] i,[mjs-fx-scrollprogress-native][mjs-fx-scrollprogress-place="right"] i{animation-name:mjs-fx-scrollprogress-growy}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="scrollprogress"] i{transition:none}}',
  vars: { color: '', colors: '', track: '', thickness: 'px', radius: 'px', glow: 'px', zindex: '', duration: '' },
  setup: function(el, s) {
    var place  = /^(bottom|left|right)$/.test(s.place) ? s.place : 'top';
    var page   = s.source === 'page';
    var origin = /^(center|end)$/.test(s.origin) ? s.origin : 'start';
    var host   = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'scrollprogress');
    var layer = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'scrollprogress');
    layer.setAttribute('role', 'progressbar');
    layer.setAttribute('aria-valuemin', '0');
    layer.setAttribute('aria-valuemax', '100');
    layer.setAttribute('aria-valuenow', '0');
    var said = typeof µ._mjs_label === 'function' ? µ._mjs_label('fx', 'progress') : void 0;
    if (typeof said !== 'string') said = typeof µ._mjs_labelLang === 'function' && µ._mjs_labelLang() === 'en' ? 'Reading progress' : 'Progression de la lecture';
    layer.setAttribute('aria-label', said);
    // la place, la source et l'origine aussi sur le calque, où la feuille les lit : sur un composant il
    // vit dans son shadow root, d'où les attributs de la balise ne se voient pas
    layer.setAttribute('mjs-fx-scrollprogress-place', place);
    layer.setAttribute('mjs-fx-scrollprogress-source', page ? 'page' : 'self');
    layer.setAttribute('mjs-fx-scrollprogress-origin', origin);
    layer.appendChild(document.createElement('i'));
    var sup = false;
    try {
      sup = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline', 'scroll()');
    }
    catch {}
    // la ligne de temps du navigateur remonte jusqu'à la page quand la balise ne défile pas : elle ne
    // vaut que pour la page ou une balise qui défile, et sans lissage ; le reste passe par la variable
    var rolls    = page || (typeof getComputedStyle === 'function' && /auto|scroll|hidden/.test(getComputedStyle(el).overflowY));
    var native   = false;
    var timeline = function(v) {
      native = sup && rolls && !(µ._mjs_fxMs(v, 0) > 0);
      if (native) layer.setAttribute('mjs-fx-scrollprogress-native', '');
      else layer.removeAttribute('mjs-fx-scrollprogress-native');
    };
    timeline(s.duration);
    var tone = function(g, c) {
      if (g > 0) layer.setAttribute('mjs-fx-scrollprogress-glow', '');
      else layer.removeAttribute('mjs-fx-scrollprogress-glow');
      if (Array.isArray(c) && c.length > 0) {
        layer.setAttribute('mjs-fx-scrollprogress-gradient', '');
        layer.style.setProperty('--mjs-fx-scrollprogress-halo', c[0]);
      }
      else {
        layer.removeAttribute('mjs-fx-scrollprogress-gradient');
        layer.style.removeProperty('--mjs-fx-scrollprogress-halo');
      }
    };
    tone(s.glow, s.colors);
    // en haut, à gauche et à droite, la barre vient avant le contenu (un flottant se pose en tête) ; en bas, après
    if (place === 'bottom') µ._mjs_dom.appendChild(host, layer);
    else µ._mjs_dom.insertBefore(host, layer, host.firstChild);
    // la part lue du défilement vertical, de 0 à 1 : la page, ou la balise
    var read = function() {
      var h;
      var t;
      if (page) {
        var d = document.documentElement;
        h = d.scrollHeight - (window.innerHeight || d.clientHeight || 0);
        t = window.scrollY || d.scrollTop || 0;
      }
      else {
        h = el.scrollHeight - el.clientHeight;
        t = el.scrollTop;
      }
      return h > 0 ? Math.min(1, Math.max(0, t / h)) : 0;
    };
    var frame = 0;
    var timer = 0;
    var draw = function() {
      frame = 0;
      layer.style.setProperty('--mjs-fx-scrollprogress-p', String(Math.round(read() * 10000) / 10000));
    };
    // la valeur annoncée : au plus quatre fois par seconde, lue à l'instant de la mise à jour
    var tell = function() {
      timer = 0;
      var v = String(Math.round(read() * 100));
      if (layer.getAttribute('aria-valuenow') !== v) layer.setAttribute('aria-valuenow', v);
    };
    var onScroll = function() {
      if (!native && !frame) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0);
      if (!timer) timer = setTimeout(tell, 250);
    };
    // une barre verticale posée sur la balise : sa hauteur est celle de la balise (en px)
    var size = function() {
      if (!page && (place === 'left' || place === 'right') && el.clientHeight) layer.style.setProperty('--mjs-fx-scrollprogress-size', el.clientHeight + 'px');
      onScroll();
    };
    var target = page ? window : el;
    µ._mjs_dom.addEventListener(target, 'scroll', onScroll, { passive: true });
    window.addEventListener('resize', size);
    var ro = !page && typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
    if (ro) ro.observe(el);
    if (!native) draw();
    tell();
    size();
    var stop = function() {
      µ._mjs_dom.removeEventListener(target, 'scroll', onScroll);
      window.removeEventListener('resize', size);
      if (ro) ro.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      clearTimeout(timer);
      layer.remove();
    };
    // glow, colors et duration suivis sur place ; place, source et origin relancent l'effet
    var cur = { glow: s.glow, colors: s.colors };
    stop.set = function(k, v) {
      if (k === 'glow' || k === 'colors') {
        cur[k] = v;
        tone(cur.glow, cur.colors);
        return;
      }
      // un lissage qui arrive ou qui part : la barre quitte ou retrouve la ligne de temps du navigateur
      if (k === 'duration') {
        timeline(v);
        if (!native) draw();
        return;
      }
      if (k === 'place' || k === 'source' || k === 'origin') return false;
    };
    return stop;
  }
};
