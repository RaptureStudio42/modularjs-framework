// mjs_fx_particles — `*particles` : des particules animées dans la balise (dans le composant si la
// balise en est un). Les modes :
//   snow    : de la neige qui tombe (dans le sens de `direction` : down par défaut, up la fait
//             monter, un angle la pousse de biais, comme un vent)
//   stars   : un ciel d'étoiles qui scintillent
//   network : des points qui dérivent, reliés par des fils quand ils sont proches ; la souris les
//             repousse (ou les attire), un clic en ajoute quatre (la démo particles.js)
//   aura    : des étincelles qui jaillissent du centre de la balise et s'en éloignent, sous elle
//   meteors : des étoiles filantes, un trait lumineux et sa traîne, dans le sens de `direction`
//             (en biais, vers le bas à gauche, si `direction` n'est pas écrit)
// Réglages : mode (snow), count (snow 40, stars 60, network 80 pour 800 × 800 px — 800 points au plus, ceux des clics compris —, aura : une
// étincelle toutes les 80 ms, tant que la balise est à l'écran et l'onglet visible), color (#fff), speed (snow : la traversée d'un flocon, 6s ; stars :
// un scintillement, 2s ; network : plus court = plus vif, 6s = la démo ; aura : la vie d'une
// étincelle, 2s), direction (snow : un mot ou un angle ; down), links (network : la portée des fils en px, 0 = sans
// fil ; 150), mouse (network : repulse, attract, none ; repulse), on (always : sans arrêt ; hover :
// pendant le survol — au repos, l'aura ne fait rien naître, les autres modes restent figés).

µ._mjs_fxDefs.particles = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx~="particles"]:not([mjs-fx-particles-aura]){isolation:isolate}'
    + '[mjs-fx-layer="particles"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit;z-index:-1}'
    + '[mjs-fx-layer="particles"] i{position:absolute;border-radius:50%;background:var(--mjs-particles-color,#fff)}'
    + '[mjs-fx-layer="particles"][mjs-fx-particles-mode="snow"] i{left:0;top:0;opacity:.85;animation:mjs-fx-snow var(--d) linear var(--w) infinite}'
    + '[mjs-fx-layer="particles"][mjs-fx-particles-mode="stars"] i{animation:mjs-fx-stars var(--d) ease-in-out var(--w) infinite}'
    + '[mjs-fx-layer="particles"][mjs-fx-particles-mode="meteors"] i{left:0;top:0;border-radius:1px;background:linear-gradient(90deg,var(--mjs-particles-color,#fff),transparent);transform-origin:0 50%;animation:mjs-fx-meteor var(--d) linear var(--w) infinite}'
    + '[mjs-fx-layer="particles"][mjs-fx-particles-mode="network"] canvas{position:absolute;inset:0;width:100%;height:100%}'
    + '[mjs-fx-layer="particles"][mjs-fx-particles-mode="aura"]{inset:auto;overflow:visible;z-index:auto}'
    + '[mjs-fx-layer="particles"][mjs-fx-particles-mode="aura"] i{width:5px;height:5px;margin:-2.5px 0 0 -2.5px;box-shadow:0 0 20px var(--mjs-particles-color,#fff),0 0 50px var(--mjs-particles-color,#fff);animation:mjs-fx-aura var(--d) linear forwards}'
    // `on: hover` : figées au repos
    + '[mjs-fx-layer="particles"][mjs-fx-particles-rest] i{animation-play-state:paused}'
    // `speed: 0` : immobiles, chacune au point tiré par où elle serait passée
    + '[mjs-fx-layer="particles"][mjs-fx-particles-still] i{animation:none;transform:translate(var(--px),var(--py)) rotate(var(--a,0deg))}'
    + '@keyframes mjs-fx-snow{from{transform:translate(var(--fx),var(--fy))}to{transform:translate(var(--tx),var(--ty))}}'
    + '@keyframes mjs-fx-stars{50%{opacity:.15;transform:scale(.6)}}'
    + '@keyframes mjs-fx-meteor{0%{opacity:0;transform:translate(var(--fx),var(--fy)) rotate(var(--a))}10%,70%{opacity:1}100%{opacity:0;transform:translate(var(--tx),var(--ty)) rotate(var(--a))}}'
    + '@keyframes mjs-fx-aura{0%{transform:scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(.5);opacity:0}}'
    // « réduire les animations » : l'animation coupée portait le `transform` de la neige et des étoiles filantes (sans lui, toutes en 0,0) : chacune reste à son point tiré, comme avec `speed: 0`
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="particles"][mjs-fx-particles-mode] i{animation:none}[mjs-fx-layer="particles"][mjs-fx-particles-mode="snow"] i,[mjs-fx-layer="particles"][mjs-fx-particles-mode="meteors"] i{transform:translate(var(--px),var(--py)) rotate(var(--a,0deg))}[mjs-fx-layer="particles"][mjs-fx-particles-mode="aura"]{display:none}}',
  vars: { color: '' },
  // effets économes : suivi, et relancé (il compte ses particules à la pose)
  heavy: true,
  liteRestart: true,
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'particles');
    var restore = µ._mjs_fxRelative(el);
    var mode    = /^(snow|stars|network|aura|meteors)$/.test(s.mode) ? s.mode : 'snow';
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'particles');
    layer.setAttribute('mjs-fx-particles-mode', mode);
    layer.setAttribute('aria-hidden', 'true');
    // l'aura se glisse juste avant la balise, à sa place : les étincelles naissent sous elle
    if (mode === 'aura' && el.parentNode) {
      µ._mjs_dom.setAttribute(el, 'mjs-fx-particles-aura', '');
      µ._mjs_dom.insertBefore(el.parentNode, layer, el);
    }
    else µ._mjs_dom.insertBefore(host, layer, host.firstChild);
    var place = function() {
      layer.style.left   = el.offsetLeft + 'px';
      layer.style.top    = el.offsetTop + 'px';
      layer.style.width  = el.offsetWidth + 'px';
      layer.style.height = el.offsetHeight + 'px';
    };
    var undo = [];
    // les écoutes par la méthode de la balise elle-même : un composant qui écrit `@addEventListener` garde la sienne
    var each = function(ev, f, on) {
      µ._mjs_dom.addEventListener(on || el, ev, f);
      undo.push(function() { µ._mjs_dom.removeEventListener(on || el, ev, f); });
    };
    // la couleur relue par le canevas du réseau à chaque image (les autres modes la lisent dans la variable CSS)
    var recolor = null;
    if (mode === 'snow' || mode === 'stars' || mode === 'meteors') {
      if (s.on === 'hover') {
        layer.setAttribute('mjs-fx-particles-rest', '');
        each('pointerenter', function() { layer.removeAttribute('mjs-fx-particles-rest'); });
        each('pointerleave', function() { layer.setAttribute('mjs-fx-particles-rest', ''); });
      }
      var n      = µ._mjs_fxCount(s.count || (mode === 'snow' ? 40 : mode === 'meteors' ? 16 : 60));
      var base   = µ._mjs_fxMs(s.speed, mode === 'snow' ? 6000 : mode === 'meteors' ? 3000 : 2000);
      var flakes = [];
      // une étoile filante : un trait (sa traîne derrière elle), tourné dans le sens de sa course
      var course = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, mode === 'meteors' ? 215 : 180));
      var tilt   = Math.round(Math.atan2(course.y, course.x) * 18000 / Math.PI) / 100 + 180;
      for (var i = 0; i < n; i++) {
        var p = document.createElement('i');
        var size = mode === 'snow' ? 3 + Math.random() * 5 : 1 + Math.random() * 3;
        p.style.width  = mode === 'meteors' ? (40 + Math.random() * 60).toFixed(0) + 'px' : size.toFixed(1) + 'px';
        p.style.height = mode === 'meteors' ? (1 + Math.random()).toFixed(1) + 'px' : size.toFixed(1) + 'px';
        if (mode === 'meteors') p.style.setProperty('--a', tilt + 'deg');
        if (mode === 'stars') {
          p.style.left = (Math.random() * 100).toFixed(1) + '%';
          p.style.top  = (Math.random() * 100).toFixed(1) + '%';
        }
        else flakes.push({ p: p, rx: Math.random(), ry: Math.random(), drift: mode === 'meteors' ? 0 : (Math.random() - 0.5) * 60 });
        p.style.setProperty('--d', (base * (0.6 + Math.random() * 0.8)).toFixed(0) + 'ms');
        p.style.setProperty('--w', (-Math.random() * base).toFixed(0) + 'ms');
        layer.appendChild(p);
      }
      if (mode !== 'stars') {
        // chaque flocon (chaque étoile filante) traverse la balise en passant par un point tiré au
        // sort : il entre par un bord, sort par l'autre, dans le sens de `direction`, un peu déporté ;
        // une traversée de durée nulle (`speed: 0`) : il reste à ce point (« réduire les animations »
        // aussi, la feuille de style le range alors à ce même point)
        var still = !(base > 0);
        if (still) layer.setAttribute('mjs-fx-particles-still', '');
        var fall = course;
        var lay  = function() {
          var W = layer.clientWidth || 100;
          var H = layer.clientHeight || 100;
          for (var k = 0; k < flakes.length; k++) {
            var f  = flakes[k];
            var px = f.rx * W;
            var py = f.ry * H;
            var reach = function(dx, dy) {
              var tx = dx > 1e-6 ? (W - px) / dx : dx < -1e-6 ? -px / dx : Infinity;
              var ty = dy > 1e-6 ? (H - py) / dy : dy < -1e-6 ? -py / dy : Infinity;
              return Math.min(tx, ty);
            };
            var back = reach(-fall.x, -fall.y) + 12;
            var fwd  = reach(fall.x, fall.y) + 12;
            f.p.style.setProperty('--fx', (px - back * fall.x).toFixed(1) + 'px');
            f.p.style.setProperty('--fy', (py - back * fall.y).toFixed(1) + 'px');
            f.p.style.setProperty('--tx', (px + fwd * fall.x - fall.y * f.drift).toFixed(1) + 'px');
            f.p.style.setProperty('--ty', (py + fwd * fall.y + fall.x * f.drift).toFixed(1) + 'px');
            f.p.style.setProperty('--px', px.toFixed(1) + 'px');
            f.p.style.setProperty('--py', py.toFixed(1) + 'px');
          }
        };
        lay();
        var ros = typeof ResizeObserver === 'function' ? new ResizeObserver(lay) : null;
        if (ros) {
          ros.observe(layer);
          undo.push(function() { ros.disconnect(); });
        }
      }
    }
    else if (mode === 'aura') {
      var life  = µ._mjs_fxMs(s.speed, 2000);
      var every = Math.max(10, 1000 / µ._mjs_fxCount(s.count || 12.5));
      var timer = null;
      // la couche est posée à côté de la balise, hors de la portée de sa variable de couleur (le réglage, sa variable, un
      // thème posé sur la balise) : la couleur vue depuis la balise y est recopiée à chaque étincelle
      var shade = '';
      // à l'écran (à 100 px près : les étincelles débordent de la balise) : l'observateur le dit, et rien ne naît avant — une balise posée
      // hors de l'écran n'en fait jamais naître ; sans observateur, elle est toujours à l'écran. `on: hover` : pendant le survol seulement
      var there = typeof IntersectionObserver !== 'function';
      var awake = s.on !== 'hover';
      var spark = function() {
        var c = µ._mjs_fxCss(el, '--mjs-particles-color');
        place();
        if (c !== shade) {
          shade = c;
          if (c) layer.style.setProperty('--mjs-particles-color', c);
          else layer.style.removeProperty('--mjs-particles-color');
        }
        var q = document.createElement('i');
        var a = Math.random() * 2 * Math.PI;
        q.style.left = 'calc(50% + ' + (Math.cos(a) * 20).toFixed(1) + 'px)';
        q.style.top  = 'calc(50% + ' + (Math.sin(a) * 20).toFixed(1) + 'px)';
        q.style.setProperty('--dx', (Math.cos(a) * 100).toFixed(1) + 'px');
        q.style.setProperty('--dy', (Math.sin(a) * 100).toFixed(1) + 'px');
        q.style.setProperty('--d', life + 'ms');
        layer.appendChild(q);
        setTimeout(function() { q.remove(); }, life);
      };
      // une vie nulle (`speed: 0`) : aucune étincelle, rien ne naît pour disparaître aussitôt ; ni hors de l'écran, ni dans un onglet caché
      var start = function() { if (!timer && awake && there && life > 0 && !document.hidden && !µ._mjs_fxCalm()) timer = setInterval(spark, every); };
      var stop  = function() {
        clearInterval(timer);
        timer = null;
      };
      if (s.on === 'hover') {
        each('pointerenter', function() {
          awake = true;
          start();
        });
        each('pointerleave', function() {
          awake = false;
          stop();
        });
      }
      var watch = there ? null : new IntersectionObserver(function(e) {
        there = e[e.length - 1].isIntersecting;
        if (there) start();
        else stop();
      }, { rootMargin: '100px' });
      if (watch) watch.observe(el);
      each('visibilitychange', function() {
        if (document.hidden) stop();
        else start();
      }, document);
      start();
      undo.push(function() {
        if (watch) watch.disconnect();
        stop();
      });
    }
    else {
      // network : un canevas, animé tant que la balise est à l'écran — avec `on: hover`, pendant le
      // survol seulement (au repos, le réseau reste figé, dessiné une fois)
      var cv  = document.createElement('canvas');
      layer.appendChild(cv);
      var ctx = cv.getContext && cv.getContext('2d');
      var dots  = [];
      var W = 0, H = 0, dpr = 1, raf = 0, seen = true, ptr = null;
      var hot   = s.on !== 'hover';
      var reach = s.links === void 0 ? 150 : s.links;
      var pull  = s.mouse === 'attract' ? -1 : s.mouse === 'none' ? 0 : 1;
      // `speed: 0` : des points immobiles (le réseau se dessine, la souris les pousse encore)
      var ms    = µ._mjs_fxMs(s.speed, 6000);
      var v0    = ms > 0 ? 180 * 6000 / ms : 0;
      // les points ajoutés par les clics : pas plus du double de ceux de la balise, ni plus de 800 en tout
      var most  = 0;
      var dot = function(x, y) {
        var a = Math.random() * 2 * Math.PI;
        var v = v0 * (0.3 + Math.random() * 0.7);
        return { x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1 + Math.random() * 4 };
      };
      var mesure = function() {
        var r = layer.getBoundingClientRect();
        W   = r.width;
        H   = r.height;
        dpr = window.devicePixelRatio || 1;
        cv.width  = Math.max(1, Math.round(W * dpr));
        cv.height = Math.max(1, Math.round(H * dpr));
        // la densité de la démo (80 pour 800 × 800 px), et au moins le quart du compte sur une petite balise ; au plus 800
        // points : les fils se testent par paires (n² par image), et un grand compte sur une grande balise (count: 400 sur
        // 1600 × 4000 px : 4 000 points, 8 millions de paires) faisait tomber la page à quelques images par seconde
        var cnt  = µ._mjs_fxCount(s.count || 80);
        var want = Math.min(800, Math.max(Math.round(cnt / 4), Math.round(cnt * (W * H) / (800 * 800))));
        most     = Math.min(800, 2 * want);
        while (dots.length < want) dots.push(dot(Math.random() * W, Math.random() * H));
        if (dots.length > want) dots.length = Math.max(0, want);
        // le canevas redimensionné est vide : redessiné (une image au repos)
        go();
      };
      var t0 = 0;
      // la couleur de chaque image, lue dans la variable CSS de l'effet : le moteur y écrit le réglage et
      // la tient à jour, le navigateur y résout `var(--c)` (le canevas ne lit pas les variables) ; blanc sans rien
      var tint = function() { return µ._mjs_fxCss(el, '--mjs-particles-color') || '#fff'; };
      var tick = function(now) {
        raf = 0;
        if (!ctx || !seen) return;
        var dt = t0 ? Math.min(0.05, (now - t0) / 1000) : 0.016;
        t0 = now;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        var col         = tint();
        ctx.fillStyle   = col;
        ctx.strokeStyle = col;
        for (var i = 0; i < dots.length; i++) {
          var d = dots[i];
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (ptr && pull) {
            var ex = d.x - ptr.x;
            var ey = d.y - ptr.y;
            var e2 = ex * ex + ey * ey;
            if (e2 < 40000 && e2 > 0.01) {
              var ed   = Math.sqrt(e2);
              var push = pull * (1 - ed / 200) * 400 * dt;
              d.x += ex / ed * push;
              d.y += ey / ed * push;
            }
          }
          // un point qui sort revient par le bord opposé
          if (d.x < -d.r) d.x = W + d.r;
          else if (d.x > W + d.r) d.x = -d.r;
          if (d.y < -d.r) d.y = H + d.r;
          else if (d.y > H + d.r) d.y = -d.r;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
          ctx.fill();
        }
        if (reach > 0) {
          ctx.lineWidth = 1;
          // les paires trop éloignées écartées par la distance au carré : la racine pour les seules
          // paires reliées
          var r2 = reach * reach;
          for (var a = 0; a < dots.length; a++) {
            var pa = dots[a];
            for (var b = a + 1; b < dots.length; b++) {
              var pb = dots[b];
              var qx = pa.x - pb.x;
              var qy = pa.y - pb.y;
              var q2 = qx * qx + qy * qy;
              if (q2 > r2) continue;
              ctx.globalAlpha = 0.4 * (1 - Math.sqrt(q2) / reach);
              ctx.beginPath();
              ctx.moveTo(pa.x, pa.y);
              ctx.lineTo(pb.x, pb.y);
              ctx.stroke();
            }
          }
        }
        if (hot && !µ._mjs_fxCalm()) raf = requestAnimationFrame(tick);
      };
      var go = function() {
        if (!raf && ctx && typeof requestAnimationFrame === 'function') {
          t0  = 0;
          raf = requestAnimationFrame(tick);
        }
      };
      // la couleur change : l'image qui suit la lit (le moteur écrit la variable CSS aussitôt après)
      recolor = go;
      mesure();
      var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(mesure) : null;
      if (ro) ro.observe(el);
      var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(e) {
        seen = e[e.length - 1].isIntersecting;
        if (seen) go();
      }) : null;
      if (io) io.observe(el);
      each('pointermove', function(e) {
        var r = layer.getBoundingClientRect();
        ptr = { x: e.clientX - r.left, y: e.clientY - r.top };
      });
      each('pointerleave', function() { ptr = null; });
      if (!hot) {
        each('pointerenter', function() {
          hot = true;
          go();
        });
        each('pointerleave', function() { hot = false; });
      }
      each('click', function(e) {
        var r = layer.getBoundingClientRect();
        for (var k = 0; k < 4; k++) dots.push(dot(e.clientX - r.left, e.clientY - r.top));
        // au-delà du plafond, les plus anciens partent (les fils se comptent par paires de points)
        if (dots.length > most) dots.splice(0, dots.length - most);
      });
      go();
      undo.push(function() {
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf  = 0;
        seen = false;
        if (ro) ro.disconnect();
        if (io) io.disconnect();
      });
    }
    var off = function() {
      for (var u = undo.length - 1; u >= 0; u--) undo[u]();
      layer.remove();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-particles-aura');
      restore();
    };
    // la couleur tenue par une variable : sa variable CSS suit (le moteur), le réseau la relit à
    // l'image suivante ; les autres réglages relancent l'effet
    off.set = function(k, v) {
      if (k !== 'color') return false;
      if (recolor) recolor(v);
    };
    return off;
  }
};
