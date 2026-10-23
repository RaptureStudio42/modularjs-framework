// mjs_fx_border — `*border(style)` : une bordure animée. Les styles :
//   gradient : un liseré en dégradé et son halo lumineux autour de la balise (deux
//              pseudo-éléments, sous le contenu : le halo reste dehors, le liseré sur le bord)
//   wave     : les quatre bords se découpent en dentelle qui défile (la dentelle prend la couleur
//              du fond derrière la balise)
//   run      : un trait de lumière court le long des quatre bords, l'un après l'autre
// Réglages : style (gradient), colors (gradient : les couleurs ; orange et rose), color (wave : la
// dentelle, le fond derrière la balise si absent ; run : le trait, #0f0), width (l'épaisseur du
// liseré ou du trait en px ; celle du style), glow (gradient : le halo en px ; 30), angle
// (gradient : l'orientation du dégradé ; 45), animate (gradient : les couleurs tournent autour
// de la balise), speed (wave : un pas de dentelle, 0.5s ; run : un tour, 4s ; gradient : un tour
// des couleurs, 4s), delay (run : l'attente avant le premier tour ; 0s).

µ._mjs_fxDefs.border = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  css: '[mjs-fx~="border"]{isolation:isolate}'
    // gradient
    + '[mjs-fx~="border"][mjs-fx-border="gradient"]::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;box-sizing:border-box;padding:var(--mjs-fx-border-w);background:var(--mjs-fx-border-g);background-size:300% 300%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}'
    + '[mjs-fx~="border"][mjs-fx-border="gradient"]::before{content:"";position:absolute;inset:calc(-1 * var(--mjs-border-glow,30px));z-index:-1;border-radius:calc(var(--mjs-fx-border-r,0px) + var(--mjs-border-glow,30px));pointer-events:none;box-sizing:border-box;padding:var(--mjs-border-glow,30px);background:var(--mjs-fx-border-g);background-size:300% 300%;background-clip:content-box;filter:blur(calc(var(--mjs-border-glow,30px) / 2));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}'
    + '[mjs-fx~="border"][mjs-fx-border="gradient"][mjs-fx-border-spin]::after{animation:mjs-fx-border-flow var(--mjs-border-speed,4s) linear infinite}'
    + '[mjs-fx~="border"][mjs-fx-border="gradient"][mjs-fx-border-spin]::before{animation:mjs-fx-border-flow var(--mjs-border-speed,4s) linear infinite}'
    + '@keyframes mjs-fx-border-flow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'
    // wave : quatre bandes, une par bord ; creux et bosses dans la couleur du fond
    + '[mjs-fx-layer="border"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit}'
    + '[mjs-fx-layer="border"] i{position:absolute;height:15px}'
    + '[mjs-fx-layer="border"] i::before{content:"";position:absolute;left:0;bottom:0;width:100%;height:15px;background-image:radial-gradient(circle at 10px 15px,var(--mjs-fx-border-c) 12px,transparent 13px);background-size:40px 20px;animation:mjs-fx-border-wave var(--mjs-fx-border-t) linear infinite}'
    + '[mjs-fx-layer="border"] i::after{content:"";position:absolute;left:0;bottom:0;width:100%;height:10px;background-image:radial-gradient(circle at 10px -5px,transparent 12px,var(--mjs-fx-border-c) 13px);background-size:20px 20px;animation:mjs-fx-border-wave var(--mjs-fx-border-t) linear infinite}'
    + '[mjs-fx-layer="border"] i[mjs-fx-k="0"]{left:0;right:0;bottom:0}'
    + '[mjs-fx-layer="border"] i[mjs-fx-k="1"]{left:0;right:0;top:0;transform:rotate(180deg)}'
    + '[mjs-fx-layer="border"] i[mjs-fx-k="2"]{left:0;top:0;width:var(--mjs-fx-border-h);transform-origin:0 0;transform:translateX(15px) rotate(90deg)}'
    + '[mjs-fx-layer="border"] i[mjs-fx-k="3"]{left:100%;top:0;width:var(--mjs-fx-border-h);transform-origin:0 0;transform:translate(-15px,var(--mjs-fx-border-h)) rotate(-90deg)}'
    + '@keyframes mjs-fx-border-wave{0%{background-position:0 0}100%{background-position:40px 0}}'
    // run : quatre traits, chacun son bord, décalés d'un quart de tour
    + '[mjs-fx-layer="border-run"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit}'
    + '[mjs-fx-layer="border-run"] i{position:absolute;animation:var(--mjs-fx-border-n) var(--mjs-fx-border-t) linear var(--mjs-fx-border-d) infinite}'
    + '[mjs-fx-layer="border-run"] i[mjs-fx-k="0"]{--mjs-fx-border-n:mjs-fx-border-run-top;top:0;left:0;width:100%;height:var(--mjs-fx-border-w);background:linear-gradient(90deg,transparent,var(--mjs-fx-border-c));transform:translateX(-100%)}'
    + '[mjs-fx-layer="border-run"] i[mjs-fx-k="1"]{--mjs-fx-border-n:mjs-fx-border-run-right;top:0;right:0;width:var(--mjs-fx-border-w);height:100%;background:linear-gradient(180deg,transparent,var(--mjs-fx-border-c));transform:translateY(-100%)}'
    + '[mjs-fx-layer="border-run"] i[mjs-fx-k="2"]{--mjs-fx-border-n:mjs-fx-border-run-bottom;bottom:0;right:0;width:100%;height:var(--mjs-fx-border-w);background:linear-gradient(270deg,transparent,var(--mjs-fx-border-c));transform:translateX(100%)}'
    + '[mjs-fx-layer="border-run"] i[mjs-fx-k="3"]{--mjs-fx-border-n:mjs-fx-border-run-left;bottom:0;left:0;width:var(--mjs-fx-border-w);height:100%;background:linear-gradient(0deg,transparent,var(--mjs-fx-border-c));transform:translateY(100%)}'
    + '@keyframes mjs-fx-border-run-top{0%{transform:translateX(-100%)}25%,100%{transform:translateX(100%)}}'
    + '@keyframes mjs-fx-border-run-right{0%,25%{transform:translateY(-100%)}50%,100%{transform:translateY(100%)}}'
    + '@keyframes mjs-fx-border-run-bottom{0%,50%{transform:translateX(100%)}75%,100%{transform:translateX(-100%)}}'
    + '@keyframes mjs-fx-border-run-left{0%,75%{transform:translateY(100%)}100%{transform:translateY(-100%)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="border"][mjs-fx-border="gradient"][mjs-fx-border-spin]::after{animation:none}[mjs-fx~="border"][mjs-fx-border="gradient"][mjs-fx-border-spin]::before{animation:none}[mjs-fx-layer="border"] i::before{animation:none}[mjs-fx-layer="border"] i::after{animation:none}[mjs-fx-layer="border-run"] i{animation:none}}',
  vars: { glow: 'px' },
  setup: function(el, s) {
    var style   = /^(gradient|wave|run)$/.test(s.style) ? s.style : 'gradient';
    var restore = µ._mjs_fxRelative(el);
    var undo    = [];
    var tour    = null;
    µ._mjs_dom.setAttribute(el, 'mjs-fx-border', style);
    undo.push(function() { µ._mjs_dom.removeAttribute(el, 'mjs-fx-border'); });
    if (style === 'gradient') {
      var c = s.colors || µ._mjs_fxList(el, '--mjs-border-colors') || ['#ffbc00', '#ff0058'];
      var a = typeof s.angle === 'number' ? s.angle : 45;
      el.style.setProperty('--mjs-fx-border-g', 'linear-gradient(' + a + 'deg,' + (s.animate ? c.concat(c[0]) : c).join(',') + ')');
      el.style.setProperty('--mjs-fx-border-w', (s.width || 4) + 'px');
      // l'arrondi de la balise, pour que le halo en suive le tour ; en % (un avatar rond, 50 %), rapporté
      // à la balise
      tour = function() {
        var v = typeof getComputedStyle === 'function' ? getComputedStyle(el).borderTopLeftRadius : '';
        var r = parseFloat(v);
        if (/%/.test(v)) r = r * Math.min(el.offsetWidth, el.offsetHeight) / 100;
        if (r > 0) el.style.setProperty('--mjs-fx-border-r', r + 'px');
        else el.style.removeProperty('--mjs-fx-border-r');
      };
      tour();
      if (s.animate) µ._mjs_dom.setAttribute(el, 'mjs-fx-border-spin', '');
      // le tour des couleurs (animate) : la vitesse écrite, sinon celle du thème ($$border-speed), 4s
      if (s.speed) el.style.setProperty('--mjs-border-speed', s.speed);
      undo.push(function() {
        el.style.removeProperty('--mjs-fx-border-g');
        el.style.removeProperty('--mjs-fx-border-w');
        el.style.removeProperty('--mjs-fx-border-r');
        if (s.speed) el.style.removeProperty('--mjs-border-speed');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-border-spin');
      });
    }
    else {
      var host  = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'border');
      var layer = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', style === 'wave' ? 'border' : 'border-run');
      layer.setAttribute('aria-hidden', 'true');
      var col = s.color;
      if (!col && style === 'wave') {
        // la dentelle se découpe dans le fond : la première couleur de fond opaque derrière la balise
        for (var p = el.parentElement || (el.getRootNode && µ._mjs_dom.getRootNode(el).host); p && !col; p = p.parentElement || (p.getRootNode && µ._mjs_dom.getRootNode(p).host)) {
          var bg = typeof getComputedStyle === 'function' ? getComputedStyle(p).backgroundColor : '';
          if (bg && !/^(transparent|rgba\([^)]*,\s*0\))$/.test(bg)) col = bg;
        }
      }
      // aucun fond derrière la balise (ni la page) : celui de la page, la couleur système Canvas
      layer.style.setProperty('--mjs-fx-border-c', col || (style === 'wave' ? 'Canvas' : '#0f0'));
      layer.style.setProperty('--mjs-fx-border-t', s.speed || (style === 'wave' ? '.5s' : '4s'));
      layer.style.setProperty('--mjs-fx-border-w', (s.width || 2) + 'px');
      layer.style.setProperty('--mjs-fx-border-d', s.delay || '0s');
      for (var k = 0; k < 4; k++) {
        var i = document.createElement('i');
        i.setAttribute('mjs-fx-k', String(k));
        layer.appendChild(i);
      }
      var size = function() { layer.style.setProperty('--mjs-fx-border-h', layer.clientHeight + 'px'); };
      size();
      var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
      if (ro) ro.observe(el);
      µ._mjs_dom.appendChild(host, layer);
      undo.push(function() {
        if (ro) ro.disconnect();
        layer.remove();
      });
    }
    var stop = function() {
      for (var u = undo.length - 1; u >= 0; u--) undo[u]();
      restore();
    };
    // l'arrondi changé (réglage `radius`, posé par le cœur) : le halo en suit le tour
    stop.set = function(k) {
      if (k !== 'radius') return false;
      if (tour) tour();
    };
    return stop;
  }
};
