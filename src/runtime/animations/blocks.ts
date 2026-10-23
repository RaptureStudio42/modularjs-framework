// animations/blocks.coffee — damier de tuiles qui s'assemblent (clip-path), jumeau élément du rideau de page blocks (mjs_vt_presets.ts) ; `order` :
// l'ordre d'arrivée des tuiles — diagonal (une vague en diagonale), random (au hasard), rows (rangée par rangée),
// columns (colonne par colonne), center (du centre vers les bords), edges (des bords vers le centre) ; `seed`
// fixe le tirage de random et le désordre de rows et de columns (des tuiles d'une même bande qui ne partent pas
// toutes ensemble) : le même à chaque fois, l'entrée et la sortie se répondent. La durée totale ne change pas
// d'un ordre à l'autre : les tuiles arrivent toutes dans la fenêtre de la vague diagonale
(function(opts = {}) {
  var CORNERS, LENGTH, STAGGER, clamp01, cols, kmax, pct, polygon, pt, rows, setup, total, order, seed, rng, delays;
  STAGGER = 40;
  LENGTH = 240;
  // ordre des 4 coins (sx, sy) autour du centre, avant rotation
  CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  pct = function(v) {
    return Math.round(v * 100) / 100;
  };
  clamp01 = function(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  };
  polygon = function(points) {
    return 'polygon(' + points.join(', ') + ')';
  };
  // point formaté clé (2 décimales, %)
  pt = function(x, y) {
    return pct(x) + '% ' + pct(y) + '%';
  };
  cols = opts.cols != null ? Math.max(1, Math.round(opts.cols)) : 6;
  rows = opts.rows != null ? Math.max(1, Math.round(opts.rows)) : 4;
  kmax = cols - 1 + rows - 1;
  total = kmax * STAGGER + LENGTH;
  order = ['random', 'rows', 'columns', 'center', 'edges'].indexOf(opts.order) >= 0 ? opts.order : 'diagonal';
  seed  = opts.seed != null && isFinite(opts.seed) ? Math.round(opts.seed) : 3;
  // le hasard de `random` : un générateur à graine (le même tirage à chaque fois)
  rng = function(from) {
    var s = from % 2147483647;
    if (s <= 0) s += 2147483646;
    return function() { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
  };
  // le retard de chaque tuile (rangée par rangée, de gauche à droite), en ms : la diagonale, x + y fois STAGGER ; les
  // autres ordres rangent les tuiles de 0 (la première servie) à 1 (la dernière) et les étalent sur la même fenêtre
  // (kmax × STAGGER) — `w` × `h`, la boîte en px : le centre et les bords comptent la distance en pixels, des cercles
  // même dans une boîte étirée. rows et columns : la place de la bande, plus un retard tiré au sort qui ne dépasse
  // pas la moitié de l'étendue des bandes — des bandes irrégulières, qui se chevauchent
  delays = function(w, h) {
    var out = [], n = cols * rows, i, j, x, y, c, t, d, low, top, list;
    if (order === 'diagonal') {
      for (y = 0; y < rows; y++) {
        for (x = 0; x < cols; x++) out.push((x + y) * STAGGER);
      }
      return out;
    }
    c = rng(seed * 7919 + 13);
    if (order === 'random') {
      // un tirage de rangs sans doublon : chaque tuile a le sien (Fisher-Yates)
      list = [];
      for (i = 0; i < n; i++) list.push(i);
      for (j = n - 1; j > 0; j--) {
        i = Math.floor(c() * (j + 1));
        t = list[j];
        list[j] = list[i];
        list[i] = t;
      }
      for (i = 0; i < n; i++) out[list[i]] = n > 1 ? i / (n - 1) : 0;
    }
    else {
      for (y = 0; y < rows; y++) {
        for (x = 0; x < cols; x++) {
          if (order === 'rows') d = y / rows + c() / 2;
          else if (order === 'columns') d = x / cols + c() / 2;
          else d = Math.hypot(((x + 0.5) / cols - 0.5) * w, ((y + 0.5) / rows - 0.5) * h);
          out.push(d);
        }
      }
      // de 0 (la première tuile servie) à 1 (la dernière)
      low = Math.min.apply(null, out);
      top = Math.max.apply(null, out);
      for (i = 0; i < n; i++) out[i] = top > low ? (out[i] - low) / (top - low) : 0;
      if (order === 'edges') {
        for (i = 0; i < n; i++) out[i] = 1 - out[i];
      }
    }
    for (i = 0; i < n; i++) out[i] *= kmax * STAGGER;
    return out;
  };
  setup = function(node) {
    var delay, duration, easing, h, rect, ref, ref1, ref2, ref3, steps, w, starts;
    // mesure la boîte seulement pour garder les tuiles carrées durant la rotation
    rect = typeof node.getBoundingClientRect === 'function' ? (µ._mjs_dom ? µ._mjs_dom.getBoundingClientRect(node) : node.getBoundingClientRect()) : null;
    w = rect && rect.width > 0 ? rect.width : 1;
    h = rect && rect.height > 0 ? rect.height : 1;
    starts = delays(w, h);
    delay = (ref = opts.delay) != null ? ref : 0;
    duration = (ref1 = opts.duration) != null ? ref1 : 620;
    easing = (ref2 = opts.easing) != null ? ref2 : 'linear';
    steps = (ref3 = opts.steps) != null ? ref3 : 60;
    return {
      delay: delay,
      duration: duration,
      easing: µ.easing.resolve(easing),
      steps: steps,
      // les tuiles tournent en pixels : le moteur refait les images clés quand la balise prend sa taille
      measured: true,
      // cascade calculée ICI : chaque tuile arrive tournée puis se pose droite, sommets en nombre constant
      css: function(t, u) {
        var cx, cy, dx, dy, e, firstCorners, hh, hw, i, m, n, p, points, rx, ry, s, sx, sy, theta, tileCorners, x, y;
        n = cols * rows;
        points = [];
        firstCorners = [];
        for (y = 0; y < rows; y++) {
          for (x = 0; x < cols; x++) {
            p = clamp01((t * total - starts[y * cols + x]) / LENGTH);
            e = µ.easing.cubicOut(p);
            s = 1.02 * e;
            theta = -(Math.PI / 2) * (1 - e);
            cx = (x + 0.5) * 100 / cols;
            cy = (y + 0.5) * 100 / rows;
            hw = (w / cols / 2) * s;
            hh = (h / rows / 2) * s;
            tileCorners = [];
            for (i = 0; i < 4; i++) {
              sx = CORNERS[i][0];
              sy = CORNERS[i][1];
              dx = sx * hw;
              dy = sy * hh;
              rx = dx * Math.cos(theta) - dy * Math.sin(theta);
              ry = dx * Math.sin(theta) + dy * Math.cos(theta);
              tileCorners.push(pt(cx + rx / w * 100, cy + ry / h * 100));
            }
            for (i = 0; i < 4; i++) { points.push(tileCorners[i]); }
            points.push(tileCorners[0]);
            firstCorners.push(tileCorners[0]);
          }
        }
        // retour : repasse par les 1ers coins en sens inverse — chaque segment de liaison compte deux fois, aire nulle
        for (m = n - 2; m >= 1; m--) { points.push(firstCorners[m]); }
        return {
          clipPath: polygon(points)
        };
      }
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
