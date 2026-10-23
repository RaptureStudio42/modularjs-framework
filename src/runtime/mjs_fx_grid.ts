// mjs_fx_grid — `*grid(style)` : une grille de cases au fond de la balise, sous son contenu, qui
// réagit à la souris (dans le composant si la balise en est un). Les styles :
//   hex    : des alvéoles ; celle que survole la souris s'allume et s'éteint derrière elle
//   halo   : des carrés qui gonflent autour du pointeur
//   trail  : des cases qui s'allument au passage du pointeur puis tombent en tournant
//   needle : des boussoles dont l'aiguille pointe vers la souris
//   lines  : un quadrillage de traits fins, sans case ni écoute de la souris
// Réglages : style (hex), light (hex seulement — fill : l'alvéole se remplit ; outline : elle
// s'entoure d'un trait ; glow : une lueur suit la souris sous la grille, vue dans les joints ;
// rows : chaque rangée a sa teinte ; fill), color (la couleur ; celle du style), size (la taille
// d'une case en px ; celle du style), rainbow (hex : la teinte de la grille tourne ; trail :
// chaque case tombe dans sa teinte ; oui ; sans effet sur lines), fade (un fondu qui efface la
// grille : none, down, up, left, right, edges — du bord vers le centre ; none). La grille se
// reconstruit quand la balise change de taille (sauf lines : ses traits suivent tout seuls).

µ._mjs_fxDefs.grid = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx~="grid"]{isolation:isolate}'
    + '[mjs-fx-layer="grid"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;border-radius:inherit}'
    + '[mjs-fx-layer="grid"] i{position:absolute;display:block;box-sizing:border-box}'
    + '[mjs-fx-grid="halo"] i{background:var(--mjs-fx-grid-c);transform:scale(0);transition:transform .12s linear}'
    + '[mjs-fx-grid="trail"] i{background:#222;border:1px solid #000}'
    + '[mjs-fx-grid="trail"] i[mjs-fx-on]{background:var(--mjs-fx-grid-c);box-shadow:0 0 10px color-mix(in srgb,var(--mjs-fx-grid-c) 33%,transparent),0 0 30px color-mix(in srgb,var(--mjs-fx-grid-c) 33%,transparent),0 0 80px var(--mjs-fx-grid-c);z-index:1;animation:mjs-fx-grid-fall 2s linear forwards}'
    + '[mjs-fx-grid="trail"] i[mjs-fx-back]{animation:mjs-fx-grid-back .8s ease both}'
    + '[mjs-fx-grid="needle"] i{border:1px solid var(--mjs-fx-grid-c);border-radius:50%}'
    + '[mjs-fx-grid="needle"] i::before{content:"";position:absolute;left:0;top:50%;width:100%;height:1px;background:var(--mjs-fx-grid-c)}'
    + '[mjs-fx-grid="needle"] i::after{content:"";position:absolute;right:-10px;top:calc(50% - 5px);width:10px;height:10px;background:#e4403d;box-shadow:calc(-1 * var(--mjs-fx-grid-s) - 10px) 0 #3192e1}'
    + '[mjs-fx-grid="hex"] i{background:#0c0c0c;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);transition:background 1.5s}'
    + '[mjs-fx-grid="hex"] i::before{content:"";position:absolute;top:0;left:0;width:50%;height:100%;background:rgba(255,255,255,.02)}'
    + '[mjs-fx-grid="hex"] i[mjs-fx-on]{background:var(--mjs-fx-grid-c);transition:background 0s}'
    + '[mjs-fx-grid="hex"][mjs-fx-grid-light="outline"] i::after{content:"";position:absolute;inset:4px;background:linear-gradient(90deg,rgba(255,255,255,.02) 50%,transparent 50%),#0c0c0c;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)}'
    + '[mjs-fx-grid="hex"][mjs-fx-grid-light="glow"]{background:radial-gradient(circle calc(var(--mjs-fx-grid-s) * 2.45) at var(--mjs-fx-grid-x,-999px) var(--mjs-fx-grid-y,-999px),var(--mjs-fx-grid-c) 45%,transparent 100%)}'
    + '[mjs-fx-grid="hex"][mjs-fx-grid-light="glow"] i[mjs-fx-on]{background:#0c0c0c}'
    + '[mjs-fx-grid="hex"][mjs-fx-grid-light="rows"] i{transition:background 2s}'
    + '[mjs-fx-grid="hex"][mjs-fx-grid-light="rows"] i[mjs-fx-on]{transition:background 0s}'
    + '[mjs-fx-grid="lines"]{background-image:linear-gradient(90deg,var(--mjs-fx-grid-c) 1px,transparent 1px),linear-gradient(var(--mjs-fx-grid-c) 1px,transparent 1px);background-size:var(--mjs-fx-grid-s) var(--mjs-fx-grid-s)}'
    + '[mjs-fx-grid-fade="down"]{-webkit-mask-image:linear-gradient(#000,transparent);mask-image:linear-gradient(#000,transparent)}'
    + '[mjs-fx-grid-fade="up"]{-webkit-mask-image:linear-gradient(transparent,#000);mask-image:linear-gradient(transparent,#000)}'
    + '[mjs-fx-grid-fade="right"]{-webkit-mask-image:linear-gradient(90deg,#000,transparent);mask-image:linear-gradient(90deg,#000,transparent)}'
    + '[mjs-fx-grid-fade="left"]{-webkit-mask-image:linear-gradient(90deg,transparent,#000);mask-image:linear-gradient(90deg,transparent,#000)}'
    + '[mjs-fx-grid-fade="edges"]{-webkit-mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}'
    + '[mjs-fx-grid-rainbow]{animation:mjs-fx-grid-hue 4s linear infinite}'
    + '@keyframes mjs-fx-grid-fall{0%{transform:translate(0,0) rotate(0deg)}100%{transform:translate(0,var(--mjs-fx-grid-h,100vh)) rotate(360deg)}}'
    + '@keyframes mjs-fx-grid-back{from{opacity:0}}'
    + '@keyframes mjs-fx-grid-hue{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(360deg)}}'
    // « réduire les animations » : la case allumée ne tombe pas ; elle reste sur place le temps de sa
    // chute (une animation immobile, dont la fin l'éteint)
    + '@keyframes mjs-fx-grid-still{to{opacity:1}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-grid-rainbow]{animation:none}[mjs-fx-grid="trail"] i[mjs-fx-on]{animation-name:mjs-fx-grid-still}[mjs-fx-grid="halo"] i{transition:none}}',
  vars: {},
  setup: function(el, s) {
    var style = /^(hex|halo|trail|needle|lines)$/.test(s.style) ? s.style : 'hex';
    var light = /^(fill|outline|glow|rows)$/.test(s.light) ? s.light : 'fill';
    var size  = s.size || { hex: 100, halo: 50, trail: 48, needle: 50, lines: 64 }[style];
    var color = s.color || { hex: '#0f0', halo: '#fff', trail: '#0f0', needle: '#fff', lines: 'rgba(255,255,255,.1)' }[style];
    var hue   = s.rainbow !== false;
    var fade  = /^(down|up|left|right|edges)$/.test(s.fade) ? s.fade : '';
    var host  = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'grid');
    var restore = µ._mjs_fxRelative(el);
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'grid');
    layer.setAttribute('mjs-fx-grid', style);
    layer.setAttribute('aria-hidden', 'true');
    if (fade) layer.setAttribute('mjs-fx-grid-fade', fade);
    if (style === 'hex') layer.setAttribute('mjs-fx-grid-light', light);
    if (style === 'hex' && hue && light !== 'rows' && !µ._mjs_fxCalm()) layer.setAttribute('mjs-fx-grid-rainbow', '');
    layer.style.setProperty('--mjs-fx-grid-c', color);
    layer.style.setProperty('--mjs-fx-grid-s', size + 'px');
    µ._mjs_dom.insertBefore(host, layer, host.firstChild);
    // des traits seulement : ni case, ni mesure, ni souris
    if (style === 'lines') {
      return function() {
        layer.remove();
        restore();
      };
    }
    var cells = [];
    var lit   = null;
    var frame = 0;
    var last  = null;
    var prev  = null;
    // les cases à la taille du calque : position (x, y) = coin haut gauche, (cx, cy) = centre
    var build = function() {
      layer.textContent = '';
      cells = [];
      lit   = null;
      var W = layer.clientWidth;
      var H = layer.clientHeight;
      if (!W || !H) return;
      layer.style.setProperty('--mjs-fx-grid-h', H + 'px');
      var add = function(x, y, w, h, row) {
        var c = document.createElement('i');
        c.style.left   = x + 'px';
        c.style.top    = y + 'px';
        c.style.width  = w + 'px';
        c.style.height = h + 'px';
        if (style === 'hex' && light === 'rows') c.style.filter = 'hue-rotate(' + (row * 36) + 'deg)';
        layer.appendChild(c);
        cells.push({ el: c, x: x, y: y, cx: x + w / 2, cy: y + h / 2 });
      };
      if (style === 'hex') {
        var w  = size;
        var h  = size * 1.1;
        var px = size * 1.04;
        var py = px * 0.817;
        for (var r = 0; r * py - h / 2 < H && cells.length < 3000; r++) {
          for (var x = -w / 2 + (r % 2 ? px / 2 : 0); x < W; x += px) add(x, r * py - h * 0.25, w, h, r);
        }
      }
      else if (style === 'needle') {
        var pitch = size * 1.6;
        var cols  = Math.max(1, Math.floor((W + size * 0.6) / pitch));
        var rows  = Math.max(1, Math.floor((H + size * 0.6) / pitch));
        var ox    = (W - (cols * pitch - size * 0.6)) / 2;
        var oy    = (H - (rows * pitch - size * 0.6)) / 2;
        for (var j = 0; j < rows && cells.length < 3000; j++) for (var k = 0; k < cols; k++) add(ox + k * pitch, oy + j * pitch, size, size, j);
      }
      else {
        for (var y = 0; y < H && cells.length < 3000; y += size) for (var x2 = 0; x2 < W; x2 += size) add(x2, y, size, size, 0);
      }
    };
    // la case sous le point (x, y) du calque : la plus proche par son centre
    var under = function(x, y) {
      var best = null;
      var d    = Infinity;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (Math.abs(c.cx - x) > size || Math.abs(c.cy - y) > size * 1.2) continue;
        var e = (c.cx - x) * (c.cx - x) + (c.cy - y) * (c.cy - y);
        if (e < d) { d = e; best = c; }
      }
      return best;
    };
    var fall = function(c) {
      if (!c || µ._mjs_dom.hasAttribute(c.el, 'mjs-fx-on') || µ._mjs_dom.hasAttribute(c.el, 'mjs-fx-back')) return;
      µ._mjs_dom.setAttribute(c.el, 'mjs-fx-on', '');
      c.el.style.animationDuration = (1 + Math.random() * 3).toFixed(2) + 's';
      if (hue) c.el.style.filter = 'hue-rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      var back = function() {
        µ._mjs_dom.removeEventListener(c.el, 'animationend', back);
        µ._mjs_dom.removeAttribute(c.el, 'mjs-fx-on');
        c.el.style.filter = '';
        c.el.style.animationDuration = '';
        µ._mjs_dom.setAttribute(c.el, 'mjs-fx-back', '');
        setTimeout(function() { µ._mjs_dom.removeAttribute(c.el, 'mjs-fx-back'); }, 900);
      };
      µ._mjs_dom.addEventListener(c.el, 'animationend', back);
    };
    var draw = function() {
      frame = 0;
      var b = layer.getBoundingClientRect();
      // le pointeur se compte en pixels de mise en page, ceux des cases : un parent qui réduit la page
      // (`transform: scale(.5)`) montre le calque plus petit que sa mise en page
      var x = (last.clientX - b.left) * (b.width > 0 && layer.clientWidth > 0 ? layer.clientWidth / b.width : 1);
      var y = (last.clientY - b.top) * (b.height > 0 && layer.clientHeight > 0 ? layer.clientHeight / b.height : 1);
      // une case n'est réécrite que si elle change vraiment depuis sa dernière écriture (`v`) : son carré
      // d'un quart de pixel au moins, son aiguille d'un degré (moins d'un pixel au bout) — loin du
      // pointeur, la plupart ne bougent plus assez
      if (style === 'halo') {
        for (var i = 0; i < cells.length; i++) {
          var c = cells[i];
          var k = Math.exp(Math.hypot(c.x - x, c.y - y) * -0.01) * 4;
          if (c.v !== void 0 && Math.abs(k - c.v) * size < 0.25) continue;
          c.v = k;
          c.el.style.transform = 'scale(' + k.toFixed(3) + ')';
        }
      }
      else if (style === 'needle') {
        for (var n = 0; n < cells.length; n++) {
          var q = cells[n];
          var a = Math.atan2(y - q.cy, x - q.cx) * 180 / Math.PI;
          if (q.v !== void 0 && Math.abs(a - q.v) < 1) continue;
          q.v = a;
          q.el.style.transform = 'rotate(' + a.toFixed(1) + 'deg)';
        }
      }
      else if (style === 'trail') {
        // pas plus d'une demi-case entre deux points : un geste vif allume toutes les cases franchies
        var from  = prev || { x: x, y: y };
        var steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / (size / 2)));
        for (var t = 1; t <= steps; t++) fall(under(from.x + (x - from.x) * t / steps, from.y + (y - from.y) * t / steps));
      }
      else {
        if (light === 'glow') {
          layer.style.setProperty('--mjs-fx-grid-x', x.toFixed(1) + 'px');
          layer.style.setProperty('--mjs-fx-grid-y', y.toFixed(1) + 'px');
        }
        var now = under(x, y);
        if (now !== lit) {
          if (lit) µ._mjs_dom.removeAttribute(lit.el, 'mjs-fx-on');
          if (now) µ._mjs_dom.setAttribute(now.el, 'mjs-fx-on', '');
          lit = now;
        }
      }
      prev = { x: x, y: y };
    };
    var move = function(e) {
      last = e;
      if (!frame) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0);
    };
    var leave = function() {
      prev = null;
      if (style === 'halo') {
        for (var i = 0; i < cells.length; i++) {
          cells[i].el.style.transform = '';
          cells[i].v = 0;
        }
      }
      if (style === 'hex') {
        if (lit) µ._mjs_dom.removeAttribute(lit.el, 'mjs-fx-on');
        lit = null;
        layer.style.removeProperty('--mjs-fx-grid-x');
        layer.style.removeProperty('--mjs-fx-grid-y');
      }
    };
    build();
    var wait = null;
    var ro   = typeof ResizeObserver === 'function' ? new ResizeObserver(function() {
      clearTimeout(wait);
      wait = setTimeout(build, 120);
    }) : null;
    if (ro) ro.observe(el);
    µ._mjs_dom.addEventListener(el, 'pointermove', move);
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
    return function() {
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      if (ro) ro.disconnect();
      clearTimeout(wait);
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      layer.remove();
      restore();
    };
  }
};
