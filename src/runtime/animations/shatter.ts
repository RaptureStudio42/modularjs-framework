// animations/shatter.coffee — l'image se reconstitue à partir de tuiles éparpillées : chacune part
// d'un point tiré au sort (jusqu'à `spread` px, tournée jusqu'à `rotate` degrés) et rejoint sa place,
// les unes après les autres ; à la sortie, l'image vole en éclats. Les tuiles sont posées sur un
// calque juste avant la balise, à sa place (la balise est cachée le temps du jeu) ; elles découpent
// l'image de la balise (`<img>`) ou son image de fond. Sans image : un fondu.
// Options : size (le côté d'une tuile en px ; 20 — plus grand sur une grande image : jamais plus de 2 500 tuiles), spread (400),
// rotate (360), duration (1200), delay, easing (de chaque tuile).
(function(opts = {}) {
  var rotate, setup, size, spread;
  size = opts.size != null ? Math.max(4, opts.size) : 20;
  spread = opts.spread != null ? opts.spread : 400;
  rotate = opts.rotate != null ? opts.rotate : 360;
  setup = function(node) {
    var bg, cols, e, ease, h, k, layer, m, place, ref, ref1, rows, side, src, tiles, w, x, y;
    src = node.currentSrc || node.src || '';
    if (!src && typeof window.getComputedStyle === 'function') {
      bg = window.getComputedStyle(node).backgroundImage || '';
      m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
      src = m ? m[1] : '';
    }
    w = node.offsetWidth;
    h = node.offsetHeight;
    if (!src || !w || !h || !node.parentNode) {
      return {
        delay: (ref = opts.delay) != null ? ref : 0,
        duration: (ref1 = opts.duration) != null ? ref1 : 1200,
        easing: µ.easing.resolve(opts.easing),
        css: function(t) {
          return { opacity: t };
        }
      };
    }
    ease = µ.easing.resolve(opts.easing);
    layer = document.createElement('span');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;pointer-events:none;z-index:1';
    // jamais plus de 2 500 tuiles : sur une grande image, elles grandissent autant qu'il faut (90 000 éléments figeaient la page)
    side = Math.max(size, Math.floor(Math.sqrt(w * h / 2500)));
    while (Math.ceil(w / side) * Math.ceil(h / side) > 2500) side++;
    cols = Math.ceil(w / side);
    rows = Math.ceil(h / side);
    tiles = [];
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        e = document.createElement('i');
        e.style.cssText = 'position:absolute;left:' + x * side + 'px;top:' + y * side + 'px;width:' + side + 'px;height:' + side + 'px;background:url("' + src.replace(/"/g, '%22') + '") ' + (-x * side) + 'px ' + (-y * side) + 'px / ' + w + 'px ' + h + 'px no-repeat;will-change:transform';
        layer.appendChild(e);
        // chaque tuile : son point de départ, son angle, son tour d'arrivée
        tiles.push({ el: e, dx: (Math.random() * 2 - 1) * spread, dy: (Math.random() * 2 - 1) * spread, r: (Math.random() * 2 - 1) * rotate, k: Math.random() });
      }
    }
    place = function() {
      layer.style.left = node.offsetLeft + 'px';
      layer.style.top = node.offsetTop + 'px';
      layer.style.width = node.offsetWidth + 'px';
      layer.style.height = node.offsetHeight + 'px';
    };
    return {
      delay: (ref = opts.delay) != null ? ref : 0,
      duration: (ref1 = opts.duration) != null ? ref1 : 1200,
      easing: µ.easing.linear,
      tick: function(t) {
        var i, q, tl, v;
        // t = 1 : l'image entière, à sa place ; t = 0 : entièrement éclatée, plus rien à l'écran (fin
        // d'une sortie, attente d'une entrée) — le calque n'est dans la page qu'entre les deux
        if (t >= 1 || t <= 0) {
          layer.remove();
          node.style.visibility = t >= 1 ? '' : 'hidden';
          return;
        }
        // par la méthode du DOM : un composant parent qui écrit `@insertBefore` masque celle de sa balise
        if (!layer.parentNode && node.parentNode) {
          if (µ._mjs_dom) µ._mjs_dom.insertBefore(node.parentNode, layer, node);
          else node.parentNode.insertBefore(layer, node);
        }
        place();
        node.style.visibility = 'hidden';
        for (i = 0; i < tiles.length; i++) {
          tl = tiles[i];
          // chaque tuile voyage sur une moitié du temps, sa moitié à elle
          q = (t - tl.k * 0.5) / 0.5;
          q = q < 0 ? 0 : q > 1 ? 1 : q;
          v = 1 - ease(q);
          tl.el.style.transform = 'translate(' + (tl.dx * v).toFixed(1) + 'px,' + (tl.dy * v).toFixed(1) + 'px) rotate(' + (tl.r * v).toFixed(1) + 'deg)';
        }
      },
      // l'effet arrêté en plein jeu (retiré, relancé) : le calque part, l'image redevient visible
      cleanup: function() {
        layer.remove();
        node.style.visibility = '';
      }
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
