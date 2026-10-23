// mjs_fx_dissolve — `*dissolve` : le texte se désagrège — un front l'efface, et chaque bout de
// lettre qu'il franchit s'envole en poussière, dans la couleur de la lettre. Le texte reste
// effacé ; un nouveau déclenchement le fait revenir puis se désagréger encore. Réglages : duration
// (la traversée du front ; 5.5s), direction (left : le front file vers la gauche, la poussière
// vers la droite ; right : l'inverse), delay (le texte reste lisible avant de partir ; 2s),
// particles (la poussière ; oui), on (view, hover, click, load). Avec « réduire les animations »,
// le texte disparaît sans mouvement. La poussière vit dans le repère de la balise, relu à chaque
// image : la page qui défile l'emporte avec le texte, au lieu de la laisser sur place à l'écran.

µ._mjs_fxDefs.dissolve = {
  css: '[mjs-fx~="dissolve"][mjs-fx-dissolve-run]{-webkit-mask-image:linear-gradient(to right,#000 50%,transparent 55%);mask-image:linear-gradient(to right,#000 50%,transparent 55%);-webkit-mask-size:220% 100%;mask-size:220% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:var(--mjs-fx-dissolve-p,0%) 0;mask-position:var(--mjs-fx-dissolve-p,0%) 0}'
    + '[mjs-fx~="dissolve"][mjs-fx-dissolve-run="right"]{-webkit-mask-image:linear-gradient(to right,transparent 45%,#000 50%);mask-image:linear-gradient(to right,transparent 45%,#000 50%)}'
    + '[mjs-fx-dissolve-dust]{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646}',
  vars: {},
  // l'attente puis la traversée du front (une sortie `@out=*dissolve` l'attend)
  span: function(el, s) { return µ._mjs_fxMs(s.delay, 2000) + Math.max(100, µ._mjs_fxMs(s.duration, 5500)); },
  setup: function(el, s) {
    var right = s.direction === 'right';
    var D     = Math.max(100, µ._mjs_fxMs(s.duration, 5500));
    var wait  = µ._mjs_fxMs(s.delay, 2000);
    var raf   = 0;
    var timer = null;
    var dust  = null;
    // position du masque pour un avancement k (0 → 1) : le front entre par un bord, sort par l'autre
    var at = function(k) { el.style.setProperty('--mjs-fx-dissolve-p', ((right ? 1 - k : k) * 100).toFixed(2) + '%'); };
    // les pixels des lettres, dans leur couleur, lus à la place exacte de chaque caractère
    var letters = function(box) {
      var off = document.createElement('canvas');
      off.width  = Math.max(1, Math.ceil(box.width));
      off.height = Math.max(1, Math.ceil(box.height));
      var g = off.getContext && off.getContext('2d');
      if (!g || typeof document.createRange !== 'function') return null;
      var walker = document.createTreeWalker(el, 4);
      var range  = document.createRange();
      while (walker.nextNode()) {
        var node = walker.currentNode;
        var cs   = getComputedStyle(node.parentElement);
        g.font      = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        g.fillStyle = cs.color;
        g.textBaseline = 'alphabetic';
        var asc = g.measureText('M').fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
        for (var i = 0; i < node.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          var r = range.getBoundingClientRect();
          if (!r.width) continue;
          g.fillText(node.data[i], r.left - box.left, r.top - box.top + asc);
        }
      }
      return { w: off.width, h: off.height, data: g.getImageData(0, 0, off.width, off.height).data };
    };
    var stop = function() {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (dust) dust.remove();
      dust = null;
    };
    var run = function() {
      stop();
      µ._mjs_dom.setAttribute(el, 'mjs-fx-dissolve-run', right ? 'right' : 'left');
      at(0);
      timer = setTimeout(function() {
        if (µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') { at(1); return; }
        var box   = µ._mjs_dom.getBoundingClientRect(el);
        var mask  = s.particles === false ? null : letters(box);
        var ctx   = null;
        var parts = [];
        if (mask) {
          µ._mjs_fxAdopt(document, 'dissolve');
          dust = document.createElement('canvas');
          dust.setAttribute('mjs-fx-dissolve-dust', '');
          dust.setAttribute('aria-hidden', 'true');
          dust.width  = innerWidth;
          dust.height = innerHeight;
          document.body.appendChild(dust);
          ctx = dust.getContext('2d');
        }
        // le front (milieu de la rampe du masque), en px depuis le bord gauche de la balise ; chaque
        // grain est posé en px depuis le coin de la balise, et peint là où elle est à cette image
        var front = function(k) { return right ? box.width * (-0.155 + 1.2 * k) : box.width * (1.155 - 1.2 * k); };
        var t0 = performance.now();
        var last = t0;
        var fx = front(0);
        var tick = function(now) {
          var k  = Math.min(1, (now - t0) / D);
          var dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          at(k);
          if (ctx) {
            var cur = µ._mjs_dom.getBoundingClientRect(el);
            // la fenêtre redimensionnée : le calque reprend sa taille (il se vide, tout est repeint)
            if (dust.width !== innerWidth || dust.height !== innerHeight) {
              dust.width  = innerWidth;
              dust.height = innerHeight;
            }
            var nx = front(k);
            var a  = Math.max(0, Math.floor(Math.min(fx, nx)));
            var b  = Math.min(mask.w, Math.ceil(Math.max(fx, nx)));
            fx = nx;
            for (var x = a; x < b; x++) {
              for (var y = 0; y < mask.h; y++) {
                var p = (y * mask.w + x) * 4;
                if (mask.data[p + 3] < 128 || Math.random() > 0.35) continue;
                var size = 1.5 + Math.pow(Math.random(), 2) * 5;
                parts.push({ x: x, y: y, vx: (right ? -1 : 1) * (40 + Math.random() * Math.random() * 240) * 1.4 / Math.sqrt(size), vy: (Math.random() - 0.5) * 110 / Math.sqrt(size), size: size, life: 0.9 + Math.random() * 1.7, age: 0, c: 'rgb(' + mask.data[p] + ',' + mask.data[p + 1] + ',' + mask.data[p + 2] + ')' });
              }
            }
            ctx.clearRect(0, 0, dust.width, dust.height);
            var alive = [];
            for (var i = 0; i < parts.length; i++) {
              var q = parts[i];
              q.age += dt;
              if (q.age >= q.life) continue;
              var f = q.age / q.life;
              var z = q.size * (1 - 0.5 * f);
              q.vx *= 1 - 0.8 * dt;
              q.vy += Math.sin(q.x * 0.02 + now * 0.002) * 40 * dt;
              q.x  += q.vx * dt;
              q.y  += q.vy * dt;
              ctx.globalAlpha = 1 - f * f * f;
              ctx.fillStyle   = q.c;
              ctx.fillRect(cur.left + q.x - z / 2, cur.top + q.y - z / 2, z, z);
              alive.push(q);
            }
            parts = alive;
          }
          if (k < 1 || parts.length > 0) raf = requestAnimationFrame(tick);
          else if (dust) {
            dust.remove();
            dust = null;
          }
        };
        raf = requestAnimationFrame(tick);
      }, wait);
    };
    var gate = µ._mjs_fxWhen(el, s.on, run);
    return function() {
      gate();
      stop();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-dissolve-run');
      el.style.removeProperty('--mjs-fx-dissolve-p');
    };
  }
};
