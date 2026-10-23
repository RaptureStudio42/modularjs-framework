// mjs_fx_magnet — `*magnet` : la balise est attirée par la souris — elle glisse vers le pointeur
// tant qu'il la survole, et revient en place quand il part. Réglages : strength (le déplacement
// quand le pointeur touche le bord, en px ; 20), duration (le retour en place ; 300ms), ring (un
// anneau suit la souris et grossit autour de la balise, comme la démo des icônes), color
// (l'anneau ; #fff). L'aimant déplace la balise par une animation de `translate` qui s'ajoute à celui que
// la feuille lui donne à chaque instant (`composite: add`) : le translate de l'auteur reste — un badge centré
// par `translate: -50% -50%` (ce qu'écrit Tailwind 4), une classe échangée après la pose, un `:hover` —, son
// `transform` (une rotation, un centrage) et sa transition aussi. « Réduire les animations » : la balise ne bouge pas.

µ._mjs_fxDefs.magnet = {
  css: '[mjs-fx-magnet-ring]{position:fixed;left:0;top:0;width:20px;height:20px;box-sizing:border-box;border:10px solid var(--mjs-fx-magnet-c,#fff);border-radius:50%;pointer-events:none;z-index:2147483646;opacity:0;translate:-50% -50%;transition:width .5s,height .5s,border-width .5s,opacity .5s}'
    + '[mjs-fx-magnet-ring][mjs-fx-magnet-big]{width:100px;height:100px;border-width:2px;opacity:1}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-magnet-ring]{transition:none}}',
  vars: { duration: '' },
  setup: function(el, s) {
    var k       = s.strength === void 0 ? 20 : s.strength;
    var restore = µ._mjs_fxMovable(el);
    var still   = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    var waapi   = typeof Element === 'function' && typeof Element.prototype.animate === 'function';
    var ring    = null;
    var box     = null;
    // le tirage, en px : de `from` à `to` par l'animation `anim` (aucune : arrivé)
    var pull    = { from: [0, 0], to: [0, 0], anim: null };
    if (s.ring) {
      µ._mjs_fxAdopt(document, 'magnet');
      ring = document.createElement('span');
      ring.setAttribute('mjs-fx-magnet-ring', '');
      ring.setAttribute('aria-hidden', 'true');
      ring.style.setProperty('--mjs-fx-magnet-c', s.color || '#fff');
      document.body.appendChild(ring);
    }
    // où en est le tirage : sa progression, courbe comprise
    var at = function() {
      var p = pull.anim && pull.anim.effect && pull.anim.effect.getComputedTiming ? pull.anim.effect.getComputedTiming().progress : 1;
      if (p === null || p === void 0) p = 1;
      return [pull.from[0] + (pull.to[0] - pull.from[0]) * p, pull.from[1] + (pull.to[1] - pull.from[1]) * p];
    };
    // le tirage vers (x, y) en `ms`, de là où il en est, par l'animation native (une méthode `animate` de l'auteur sur sa balise
    // n'est pas appelée) ; revenu à (0, 0), l'animation se retire. Sans `composite: add`
    // (un vieux navigateur), elle remplacerait le translate de l'auteur : la balise ne bouge pas
    var go = function(x, y, ms, ease) {
      var c = at();
      if (pull.anim) pull.anim.cancel();
      pull.anim = null;
      pull.from = c;
      pull.to   = [x, y];
      if (!waapi || (!x && !y && !c[0] && !c[1])) return;
      var a = pull.anim = µ._mjs_dom.animate(el, { translate: [c[0] + 'px ' + c[1] + 'px', x + 'px ' + y + 'px'] }, { duration: ms, easing: ease, fill: 'forwards', composite: 'add' });
      if (a.effect && a.effect.composite !== 'add') {
        a.cancel();
        pull.anim = null;
        pull.from = pull.to = [0, 0];
        return;
      }
      if (!x && !y) a.onfinish = function() {
        if (pull.anim !== a) return;
        a.cancel();
        pull.anim = null;
      };
    };
    // la position de repos : mesurée à l'entrée, le tirage encore en cours retranché (le retour en place n'est pas
    // fini quand le pointeur revient vite) — le translate de l'auteur, `:hover` compris, fait partie de la place de repos
    var enter = function() {
      var c = at();
      var r = µ._mjs_dom.getBoundingClientRect(el);
      box = { left: r.left - c[0], top: r.top - c[1], width: r.width, height: r.height };
      µ._mjs_dom.setAttribute(el, 'mjs-fx-magnet-on', '');
      if (ring) ring.setAttribute('mjs-fx-magnet-big', '');
    };
    // vif tant que la souris tire (.1s), à la durée réglée pour le retour
    var move = function(e) {
      if (!box || !box.width || !box.height) return;
      var dx = (e.clientX - box.left - box.width / 2) / (box.width / 2);
      var dy = (e.clientY - box.top - box.height / 2) / (box.height / 2);
      var x  = (Math.max(-1, Math.min(1, dx)) * k).toFixed(1);
      var y  = (Math.max(-1, Math.min(1, dy)) * k).toFixed(1);
      el.style.setProperty('--mjs-fx-magnet-x', x + 'px');
      el.style.setProperty('--mjs-fx-magnet-y', y + 'px');
      if (!(still && still.matches)) go(+x, +y, 100, 'linear');
      if (ring) ring.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    };
    var leave = function() {
      box = null;
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-magnet-on');
      el.style.removeProperty('--mjs-fx-magnet-x');
      el.style.removeProperty('--mjs-fx-magnet-y');
      go(0, 0, µ._mjs_fxMs(µ._mjs_fxCss(el, '--mjs-magnet-duration'), 300), 'ease');
      if (ring) ring.removeAttribute('mjs-fx-magnet-big');
    };
    µ._mjs_dom.addEventListener(el, 'pointerenter', enter);
    µ._mjs_dom.addEventListener(el, 'pointermove', move);
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
    return function() {
      µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      leave();
      if (pull.anim) pull.anim.cancel();
      pull.anim = null;
      if (ring) ring.remove();
      restore();
    };
  }
};
