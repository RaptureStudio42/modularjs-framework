// mjs_fx_smoke — `*smoke` : la souris soulève de la fumée dans la balise — des bouffées naissent
// sous le pointeur, gonflent et se dissipent, retenues par les bords de la balise. Réglages :
// color (la fumée ; #fff), count (la densité de la fumée, de 1 à 100 : trois bouffées vivantes par point
// au plus, 60 à 20, 300 à 100 ; 20), size (une bouffée à sa naissance, en px ; 8), distance (leur portée,
// en px ; 100), duration (la vie d'une bouffée ; 1s). Les bouffées naissent au fil de leur vie : une souris
// qui ne s'arrête pas garde une traînée continue ; « réduire les animations » : aucune bouffée.

µ._mjs_fxDefs.smoke = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  // effet lourd : suivi par la garde de cadence (le mode économe divise ses bouffées par trois)
  heavy: true,
  css: '[mjs-fx-layer="smoke"]{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none}'
    + '[mjs-fx-layer="smoke"] i{position:absolute;width:var(--mjs-smoke-size,8px);height:var(--mjs-smoke-size,8px);margin:calc(var(--mjs-smoke-size,8px) / -2) 0 0 calc(var(--mjs-smoke-size,8px) / -2);border-radius:50%;background:var(--mjs-smoke-color,#fff);animation:mjs-fx-smoke var(--mjs-smoke-duration,1s) ease-out forwards}'
    + '@keyframes mjs-fx-smoke{to{opacity:0;transform:translate(var(--tx),var(--ty)) scale(5)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="smoke"]{display:none}}',
  vars: { color: '', size: 'px', duration: '' },
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'smoke');
    var restore = µ._mjs_fxRelative(el);
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'smoke');
    layer.setAttribute('aria-hidden', 'true');
    µ._mjs_dom.appendChild(host, layer);
    var life  = µ._mjs_fxMs(s.duration, 1000);
    var reach = s.distance === void 0 ? 100 : s.distance;
    var frame = 0;
    var last  = null;
    var draw = function() {
      frame = 0;
      // le point du pointeur dans le calque (`inset:0`) : bordure déduite, mise à l'échelle défaite
      var r = µ._mjs_dom.getBoundingClientRect(el);
      var x = (last.clientX - r.left) / (el.offsetWidth ? r.width / el.offsetWidth : 1) - el.clientLeft;
      var y = (last.clientY - r.top) / (el.offsetHeight ? r.height / el.offsetHeight : 1) - el.clientTop;
      // les bouffées vivantes au plus : trois par point de count, 300 au plus ; chaque image de mouvement en fait naître la part
      // qui tient ce nombre sur une vie (16 ms l'image), arrondie au hasard pour que la moyenne soit juste
      var cap = µ._mjs_fxCount(Math.min(300, 3 * (s.count || 20)));
      var n   = Math.min(Math.floor(cap * 16 / (life + 50) + Math.random()), cap - layer.childElementCount);
      for (var i = 0; i < n; i++) {
        var p = document.createElement('i');
        var a = Math.random() * 2 * Math.PI;
        var d = Math.random() * reach * 0.8 + reach * 0.2;
        p.style.left = x + 'px';
        p.style.top  = y + 'px';
        p.style.setProperty('--tx', (Math.cos(a) * d).toFixed(1) + 'px');
        p.style.setProperty('--ty', (Math.sin(a) * d).toFixed(1) + 'px');
        layer.appendChild(p);
        setTimeout(function(q) { return function() { q.remove(); }; }(p), life + 50);
      }
    };
    var move = function(e) {
      if (µ._mjs_fxCalm()) return;
      last = e;
      if (!frame) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0);
    };
    µ._mjs_dom.addEventListener(el, 'pointermove', move);
    var off = function() {
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      layer.remove();
      restore();
    };
    // la vie d'une bouffée tenue par une variable : sa variable CSS suit (le moteur), les bouffées à
    // naître partent à la nouvelle durée
    off.set = function(k, v) {
      if (k !== 'duration') return false;
      life = µ._mjs_fxMs(v, 1000);
    };
    return off;
  }
};
