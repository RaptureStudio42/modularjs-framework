// animations/ink.coffee — la balise apparaît (ou disparaît) à travers un masque qui s'étale. Chaque
// style est une carte en gris (pour chaque point, le moment 0..1 où il apparaît), dessinée une fois
// dans le navigateur ; on en tire une planche de 32 images côte à côte (canal alpha), posée en
// `mask-image` sur la balise, et le jeu avance en changeant `mask-position` d'une image à la
// suivante. À la sortie, la même carte se rejoue à l'envers. Sans toile 2D, ou si l'image de masque
// ne vient pas : un fondu.
// Styles : blots (des taches d'encre qui s'étalent depuis `origin`), brush (de grands coups de
// pinceau, l'un après l'autre, vers `direction`), wash (une nappe d'aquarelle vers `direction`),
// smoke (un nuage de fumée qui se forme depuis `origin`), drip (des coulures de vitesses inégales
// vers `direction`), dots (une trame de points qui grossissent), shards (des éclats de verre depuis
// `origin`), swirl (un tourbillon autour de `origin`), tear (une feuille qu'on déchire vers `direction`),
// burn (un papier qui brûle : un front mordu qui part de `origin`, des braises en avance), frost (des
// cristaux de givre qui poussent depuis les bords, et depuis `origin` s'il n'est pas au centre), rain
// (des gouttes qui glissent vers `direction` et laissent des traînées qui s'élargissent), cells (une
// mosaïque de cellules qui s'allument depuis `origin`), cracks (des fissures qui partent d'`origin`
// puis s'élargissent), ripple (des ondes concentriques depuis `origin`), scribble (un trait de crayon
// en zigzag qui balaie vers `direction`), petals (une rosace de pétales depuis `origin`), glitch (des
// blocs qui décrochent par salves, en bandes perpendiculaires à `direction`), topo (des lignes de
// niveau qui s'épaississent), maze (un labyrinthe creusé depuis `origin`, puis ses murs qui fondent).
// Options : style (blots), image (l'adresse d'une image de masque, lue par sa luminosité : le sombre
// apparaît d'abord ; l'emporte sur style), soft (la douceur du bord, 0.005..1 ; celle du style),
// count (la quantité de formes — des gouttes, des cellules, des pétales, des niveaux… ; celle du style), seed (la variante, 3), direction en degrés (celle
// du style), origin [x, y] de 0 à 1 (le centre), invert (le clair d'abord), duration (1800), delay,
// easing (linéaire).
(function() {
  // ---- bruit
  var rng = function(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function() { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
  };
  var noise = function(seed) {
    var p = new Uint8Array(512), g = new Float32Array(256), r = rng(seed * 9973 + 7), i, j, t;
    for (i = 0; i < 256; i++) { p[i] = i; g[i] = r(); }
    for (i = 255; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 256; i++) p[i + 256] = p[i];
    return function(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      xi &= 255; yi &= 255;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = g[p[p[xi] + yi]], b = g[p[p[xi + 1] + yi]], c = g[p[p[xi] + yi + 1]], d = g[p[p[xi + 1] + yi + 1]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };
  var fbm = function(n, x, y, oct) {
    var s = 0, a = .5, f = 1, t = 0;
    for (var i = 0; i < oct; i++) { s += a * n(x * f, y * f); t += a; a *= .5; f *= 2; }
    return s / t;
  };

  // ---- les styles : douceur, quantité et direction par défaut (0 = vers le haut, 90 = vers la droite)
  var STYLES = {
    blots:  { soft: .10, count: 5 },
    brush:  { soft: .05, count: 6, angle: 100 },
    wash:   { soft: .40, count: 3, angle: 135 },
    smoke:  { soft: .28, count: 3 },
    drip:   { soft: .03, count: 6, angle: 180 },
    dots:   { soft: .04, count: 12, angle: 135 },
    shards: { soft: .01, count: 7 },
    swirl:  { soft: .06, count: 3 },
    tear:   { soft: .01, count: 5, angle: 90 },
    burn:     { soft: .03,  count: 1, clip: .01 },
    frost:    { soft: .02,  count: 6, clip: .002 },
    rain:     { soft: .02,  count: 6, angle: 180, clip: .02 },
    cells:    { soft: .02,  count: 7, clip: .002 },
    cracks:   { soft: .015, count: 6, clip: .002 },
    ripple:   { soft: .04,  count: 6, clip: .002 },
    scribble: { soft: .03,  count: 8, angle: 90, clip: .08 },
    petals:   { soft: .012,  count: 8, clip: .002 },
    glitch:   { soft: .005, count: 6, clip: .002 },
    topo:     { soft: .03,  count: 8, clip: .002 },
    maze:     { soft: .015, count: 8, clip: .002 }
  };


  // ---- la carte d'un style : pour chaque point, le moment (0..1) où il apparaît
  var inkMap = function(style, fw, fh, o) {
    var asp = fw / fh, map = new Float32Array(fw * fh), R = rng(o.seed * 7919 + 13), N = noise(o.seed + 1);
    var a   = o.angle * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    var ox  = o.ox * asp, oy = o.oy, far = 0, lo = Infinity, hi = -Infinity, clo = Infinity, chi = -Infinity, i, k;
    [[0, 0], [asp, 0], [0, 1], [asp, 1]].forEach(function(c) {
      var s = c[0] * dx + c[1] * dy, t = -c[0] * dy + c[1] * dx;
      lo = Math.min(lo, s); hi = Math.max(hi, s); clo = Math.min(clo, t); chi = Math.max(chi, t);
      far = Math.max(far, Math.hypot(c[0] - ox, c[1] - oy));
    });
    var along  = function(X, Y) { return (X * dx + Y * dy - lo) / (hi - lo); };
    var across = function(X, Y) { return (-X * dy + Y * dx - clo) / (chi - clo); };
    var count  = o.count, f, g, NEAR = 1e9;
    // la cartographie par sources : on pose des points (put, line) qui portent chacun leur moment d'arrivée,
    // puis spread les épaissit à la vitesse k (le moment d'un point = celui de la source la plus proche
    // + k fois sa distance) ; une trace posée à t est large de (T - t) / k à l'instant T
    var put    = function(X, Y, t) {
      var x = Math.floor(X * fh), y = Math.floor(Y * fh);
      if (x >= 0 && x < fw && y >= 0 && y < fh && t < map[y * fw + x]) map[y * fw + x] = t;
    };
    var line   = function(X0, Y0, X1, Y1, t0, t1) {
      var n = Math.max(1, Math.ceil(Math.hypot(X1 - X0, Y1 - Y0) * fh)), j;
      for (j = 0; j <= n; j++) put(X0 + (X1 - X0) * j / n, Y0 + (Y1 - Y0) * j / n, t0 + (t1 - t0) * j / n);
    };
    var sweep  = function(M, rev) {
      var tot = fw * fh, q, n, y, x, j, nx, ny, v, e;
      for (q = 0; q < tot; q++) {
        n = rev ? tot - 1 - q : q;
        y = Math.floor(n / fw);
        x = n - y * fw;
        v = map[n];
        for (j = 0; j < 8; j++) {
          nx = x + M[j][0]; ny = y + M[j][1];
          if (nx >= 0 && nx < fw && ny >= 0 && ny < fh) { e = map[ny * fw + nx] + M[j][2]; if (e < v) v = e; }
        }
        map[n] = v;
      }
    };
    var spread = function(k) {
      var u = k / fh, a1 = u, a2 = u * 1.4142, a3 = u * 2.2361;
      sweep([[-1, 0, a1], [-1, -1, a2], [0, -1, a1], [1, -1, a2], [-2, -1, a3], [-1, -2, a3], [1, -2, a3], [2, -1, a3]], false);
      sweep([[1, 0, a1], [1, 1, a2], [0, 1, a1], [-1, 1, a2], [2, 1, a3], [1, 2, a3], [-1, 2, a3], [-2, 1, a3]], true);
    };
    // les moments posés sont ramenés à 0..1, puis épaissis de façon que l'épaississement dure `lent` fois le tracé
    var tree   = function(lent) {
      var tot = map.length, t1 = 0, dmax = 0, keep, q;
      for (q = 0; q < tot; q++) if (map[q] < NEAR && map[q] > t1) t1 = map[q];
      for (q = 0; q < tot; q++) if (map[q] < NEAR) map[q] /= t1 || 1;
      keep = new Float32Array(map);
      for (q = 0; q < tot; q++) if (map[q] < NEAR) map[q] = 0;
      spread(1);
      for (q = 0; q < tot; q++) if (map[q] > dmax) dmax = map[q];
      map.set(keep);
      spread(lent / (dmax || 1));
    };
    // un tracé fin d'abord (le moment posé à chaque point, de 0 à T0), puis tout s'épaissit en même temps, à la même
    // vitesse, jusqu'à tout remplir (de T0 à 1) ; w : la largeur du trait fin
    var branch = function(T0, w) {
      var tot = map.length, t1 = 0, dmax = 0, keep, dist, q, K, d, tn;
      for (q = 0; q < tot; q++) if (map[q] < NEAR && map[q] > t1) t1 = map[q];
      for (q = 0; q < tot; q++) if (map[q] < NEAR) map[q] /= t1 || 1;
      keep = new Float32Array(map);
      for (q = 0; q < tot; q++) if (map[q] < NEAR) map[q] = 0;
      spread(1);
      dist = new Float32Array(map);
      for (q = 0; q < tot; q++) if (dist[q] > dmax) dmax = dist[q];
      map.set(keep);
      K = 80 / (dmax || 1);
      spread(K);
      for (q = 0; q < tot; q++) {
        d  = dist[q];
        tn = map[q] - K * d;
        map[q] = d <= w ? T0 * Math.max(0, Math.min(1, tn)) : T0 + (1 - T0) * (d - w) / ((dmax - w) || 1);
      }
    };
    // le point (X, Y) d'une position (a, c) dans le repère de `direction`
    var back   = function(a, c) {
      var s = lo + a * (hi - lo), t = clo + c * (chi - clo);
      return [s * dx - t * dy, s * dy + t * dx];
    };
    var jitter = function(sc, amp, ox2) {
      var x, y;
      for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) map[y * fw + x] += (N((x + .5) / fh * sc + ox2, (y + .5) / fh * sc) - .5) * amp;
    };
    if (style === 'blots') {
      var blots = [{ x: ox, y: oy, d: 0, s: 1 }], drops = [];
      for (i = 1; i < count; i++) blots.push({ x: R() * asp, y: R(), d: .15 + R() * .45, s: .5 + R() * .7 });
      blots.forEach(function(b) {
        for (k = 0; k < 6; k++) {
          var an = R() * Math.PI * 2, di = .12 + R() * .35;
          drops.push({ x: b.x + Math.cos(an) * di, y: b.y + Math.sin(an) * di, r: .015 + R() * .05, d: b.d + .1 + R() * .4 });
        }
      });
      f = function(X, Y) {
        var wx = X + (fbm(N, X * 2.2, Y * 2.2, 3) - .5) * .35 + (N(X * 9, Y * 9) - .5) * .05;
        var wy = Y + (fbm(N, X * 2.2 + 31.7, Y * 2.2 + 11.3, 3) - .5) * .35 + (N(X * 9 + 5.1, Y * 9 + 8.7) - .5) * .05;
        var v  = Infinity, j, b, d;
        for (j = 0; j < blots.length; j++) { b = blots[j]; v = Math.min(v, b.d * far + Math.hypot(wx - b.x, wy - b.y) / b.s); }
        for (j = 0; j < drops.length; j++) { b = drops[j]; d = Math.hypot(wx - b.x, wy - b.y); if (d < b.r) v = Math.min(v, b.d * far + d * .6); }
        return v;
      };
    }
    else if (style === 'brush') {
      f = function(X, Y) {
        var al = along(X, Y), ac = across(X, Y);
        var t  = ac * count + (fbm(N, al * 4, ac * 3, 3) - .5) * 1.4;
        var n  = Math.max(0, Math.min(count - 1, Math.floor(t))), fr = t - n;
        var u  = (n % 2 ? 1 - al : al) + (N(al * 3, ac * 60) - .5) * .3 + Math.pow(Math.abs(fr - .5) * 2, 3) * .15;
        return n * .8 + Math.max(0, Math.min(1, u));
      };
    }
    else if (style === 'wash') f = function(X, Y) { return along(X, Y) * .5 + fbm(N, X * count * .5, Y * count * .5, 4) * .5; };
    else if (style === 'smoke') f = function(X, Y) { return fbm(N, X * count * .8, Y * count * .8, 5) * .75 + Math.hypot(X - ox, Y - oy) / far * .25; };
    else if (style === 'drip') {
      // des colonnes de vitesses inégales, chacune finie par un bout rond (un demi-cercle de sa largeur)
      var K = count * 4, speed = [], tip = (chi - clo) / K / (hi - lo) / 2;
      for (i = 0; i < K; i++) speed.push(R() < .3 ? .3 + R() * .2 : .55 + R() * .45);
      f = function(X, Y) {
        var al = along(X, Y), ac = across(X, Y) * K, ci = Math.max(0, Math.min(K - 1, Math.floor(ac))), c = (ac - ci) * 2 - 1;
        return (al + (1 - Math.sqrt(Math.max(0, 1 - c * c))) * tip) / speed[ci];
      };
    }
    else if (style === 'dots') {
      f = function(X, Y) {
        var gy = Y * count, row = Math.floor(gy), sh = row % 2 ? .5 : 0, gx = X * count + sh, col = Math.floor(gx);
        var d  = Math.hypot(gx - col - .5, gy - row - .5) / .7071;
        return along((col + .5 - sh) / count, (row + .5) / count) * .72 + d * .28;
      };
    }
    else if (style === 'shards') {
      var seeds = [];
      for (i = 0; i < count * 6; i++) { var sx = R() * asp, sy = R(); seeds.push({ x: sx, y: sy, v: Math.hypot(sx - ox, sy - oy) / far * .8 + R() * .2 }); }
      f = function(X, Y) {
        var best = null, d = Infinity, j, e;
        for (j = 0; j < seeds.length; j++) { e = (seeds[j].x - X) * (seeds[j].x - X) + (seeds[j].y - Y) * (seeds[j].y - Y); if (e < d) { d = e; best = seeds[j]; } }
        return best.v + Math.sqrt(d) * .25;
      };
    }
    else if (style === 'swirl') {
      f = function(X, Y) {
        var r = Math.hypot(X - ox, Y - oy) / far, s = (Math.atan2(Y - oy, X - ox) / (Math.PI * 2) + .5) * count + r * 2.5;
        return r * .45 + (s - Math.floor(s)) * .55;
      };
    }
    else if (style === 'burn') {
      // un front qui part des foyers (le premier en `origin`), tordu par un bruit lent, mordu par un bruit fin ;
      // des braises (des taches du bruit le plus haut) s'allument en avance sur le front
      var fires = [{ x: ox, y: oy, d: 0 }];
      for (i = 1; i < count; i++) fires.push({ x: R() * asp, y: R(), d: .1 + R() * .3 });
      f = function(X, Y) {
        var wx = X + (fbm(N, X * 3, Y * 3, 3) - .5) * .42, wy = Y + (fbm(N, X * 3 + 17.1, Y * 3 + 5.3, 3) - .5) * .42;
        var v  = Infinity, j, e, b = N(X * 34 + 3.3, Y * 34 + 1.1);
        for (j = 0; j < fires.length; j++) v = Math.min(v, fires[j].d + Math.hypot(wx - fires[j].x, wy - fires[j].y) / far);
        e = Math.abs(N(X * 16 + 9.7, Y * 16 + 2.2) - .5);
        v += (e - .12) * .18;
        if (b > .7) v -= (b - .7) * 1.1;
        return v;
      };
    }
    else if (style === 'frost') {
      // des tiges qui partent des bords (et d'`origin` hors du centre), des branches à 60° de chaque côté, de plus en plus courtes
      var twig = function(x, y, an, len, t, dep) {
        var st = .02, n = Math.max(2, Math.round(len / st)), j, a = an, nx, ny;
        for (j = 1; j <= n; j++) {
          a  += (R() - .5) * .12;
          nx  = x + Math.cos(a) * st; ny = y + Math.sin(a) * st;
          line(x, y, nx, ny, t, t + st * .6);
          x = nx; y = ny; t += st * .6;
          if (dep < 3 && j % 3 === 0 && j < n) {
            twig(x, y, a + Math.PI / 3, len * (1 - j / n) * .42, t, dep + 1);
            twig(x, y, a - Math.PI / 3, len * (1 - j / n) * .42, t, dep + 1);
          }
        }
      };
      g = function() {
        var K = Math.ceil(count * 1.5), per = asp * 2 + 2, p, e, hor;
        map.fill(NEAR);
        for (i = 0; i < K; i++) {
          p = (i + .2 + R() * .6) / K * per;
          if (p < asp) { e = [p, 0, Math.PI / 2]; hor = false; }
          else if (p < asp + 1) { e = [asp, p - asp, Math.PI]; hor = true; }
          else if (p < asp * 2 + 1) { e = [asp - (p - asp - 1), 1, -Math.PI / 2]; hor = false; }
          else { e = [0, 1 - (p - asp * 2 - 1), 0]; hor = true; }
          twig(e[0], e[1], e[2] + (R() - .5) * .5, (hor ? asp : 1) * .5 * (.8 + R() * .3), 0, 0);
        }
        if (Math.abs(o.ox - .5) + Math.abs(o.oy - .5) > .001) for (i = 0; i < 6; i++) twig(ox, oy, (i + R() * .5) / 6 * Math.PI * 2, .45, 0, 0);
        branch(.45, 2.5 / fh);
        jitter(12, .05, 0);
      };
    }
    else if (style === 'rain') {
      // des gouttes qui glissent vers `direction` : une traînée sinueuse chacune, plus des gouttelettes fixes
      g = function() {
        var K = count * 3, id, a0, c0, d0, L, nn, j, a, c, p;
        map.fill(NEAR);
        for (id = 0; id < K; id++) {
          c0 = R(); a0 = R() * .8; d0 = R() * .5; L = .25 + R() * .55;
          nn = Math.ceil(L * (hi - lo) * fh);
          for (j = 0; j <= nn; j++) {
            a = a0 + L * j / nn;
            if (a > 1.02) break;
            c = c0 + (fbm(N, a * 4 + id * 7.3, id * 3.7, 2) - .5) * .35 + (N(a * 25 + id * 3.1, id * 1.7) - .5) * .02;
            p = back(a, c);
            put(p[0], p[1], d0 + (a - a0) * .5);
          }
        }
        for (i = 0; i < K * 2; i++) { p = back(R(), R()); put(p[0], p[1], R() * .9); }
        tree(1.3);
      };
    }
    else if (style === 'cells') {
      // une mosaïque de Voronoï sur une grille de germes décalés ; chaque cellule s'allume selon sa distance à `origin`,
      // s'ouvre depuis son germe, et son joint (là où deux cellules se touchent) ferme la marche
      var cs = 1 / (count * .7 + 2), cols = Math.ceil(asp / cs) + 2, rows = Math.ceil(1 / cs) + 2, pts = [], cj, ci;
      for (cj = 0; cj < rows; cj++) for (ci = 0; ci < cols; ci++) {
        var px = (ci - 1 + .15 + R() * .7) * cs, py = (cj - 1 + .15 + R() * .7) * cs;
        pts.push({ x: px, y: py, v: Math.hypot(px - ox, py - oy) / far * .8 + R() * .1 });
      }
      f = function(X, Y) {
        var ci0 = Math.floor(X / cs) + 1, cj0 = Math.floor(Y / cs) + 1, d1 = Infinity, d2 = Infinity, b = null, di, dj, q, d, ca, cb;
        for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
          ca = ci0 + di; cb = cj0 + dj;
          if (ca < 0 || cb < 0 || ca >= cols || cb >= rows) continue;
          q = pts[cb * cols + ca];
          d = Math.hypot(q.x - X, q.y - Y);
          if (d < d1) { d2 = d1; d1 = d; b = q; }
          else if (d < d2) d2 = d;
        }
        return b.v + .1 * d1 / cs + .06 * Math.max(0, 1 - (d2 - d1) / (cs * .12));
      };
    }
    else if (style === 'cracks') {
      // des fissures en éclair qui partent d'`origin` vers les bords, ramifiées, puis qui s'élargissent
      var crack = function(x, y, an, t, dep, budget) {
        var st = .02, j, a, nx, ny, sp = st / far * .5;
        for (j = 0; j < budget; j++) {
          an += (R() - .5) * .1;
          a   = an + (R() - .5) * 1.1;
          nx  = x + Math.cos(a) * st; ny = y + Math.sin(a) * st;
          line(x, y, nx, ny, t, t + sp);
          x = nx; y = ny; t += sp;
          if (x < -.05 || x > asp + .05 || y < -.05 || y > 1.05) return;
          if (dep < 2 && R() < .07) crack(x, y, an + (R() < .5 ? -1 : 1) * (.5 + R() * .6), t, dep + 1, 25 + Math.floor(R() * 25));
        }
      };
      g = function() {
        var K = count + 3;
        map.fill(NEAR);
        for (i = 0; i < K; i++) crack(ox, oy, (i + R() * .6) / K * Math.PI * 2, 0, 0, 130);
        branch(.4, 2.5 / fh);
        jitter(18, .06, 0);
      };
    }
    else if (style === 'ripple') {
      // des anneaux qui partent d'`origin`, chacun né un peu après le précédent, qui s'épaississent jusqu'à se toucher
      var rings = count + 3;
      f = function(X, Y) {
        var r = Math.hypot(X - ox, Y - oy) / far + (fbm(N, X * 5, Y * 5, 2) - .5) * .03, u = r * rings, ri = Math.floor(u), fr = u - ri;
        if (ri === 0 && fr < .5) fr = .5;
        return ri / rings * .55 + Math.abs(fr * 2 - 1) * .45;
      };
    }
    else if (style === 'scribble') {
      // un seul trait de crayon : des rangées en zigzag serré et tremblé (qui se croisent un peu aux bouts), parcourues
      // tour à tour dans un sens puis dans l'autre ; le trait fin passe d'abord partout, l'épaississement vient après
      g = function() {
        var rows = Math.max(2, Math.ceil(count / 2)), rh = (chi - clo) / rows, nz = Math.max(4, Math.round((hi - lo) / (rh * .6))), per = Math.ceil(rh * 1.3 * fh), nn = nz * per, r, j, u, ph, a, c, p;
        map.fill(NEAR);
        for (r = 0; r < rows; r++) for (j = 0; j <= nn; j++) {
          u  = j / nn;
          ph = u * nz;
          a  = (r % 2 ? 1 - u : u) + (N(u * 40 + r * 3.7, r * 1.9) - .5) * .5 / nz;
          c  = (r + Math.abs(2 * (ph - Math.floor(ph)) - 1) * 1.15 - .075 + (N(u * 23 + r * 1.3, 9.1 + r) - .5) * .3) / rows;
          p  = back(a, c);
          put(p[0], p[1], (r + u) / rows);
        }
        branch(.6, 2 / fh);
      };
    }
    else if (style === 'petals') {
      // une rosace : des couronnes de pétales en amande, chacune plus grande que la précédente et décalée d'un demi-pétale ;
      // la plus petite est devant. Les fentes entre pétales vont jusqu'au cœur et ne se referment qu'à la fin
      var L = 4, jit = [], slot = Math.PI * 2 / count;
      for (i = 0; i < L; i++) jit.push(R() * .3 * slot);
      f = function(X, Y) {
        var r = Math.hypot(X - ox, Y - oy) + (N(X * 6, Y * 6) - .5) * .02, th = Math.atan2(Y - oy, X - ox) + Math.PI, j, rj, x, d, hw;
        for (j = 0; j < L; j++) {
          rj = far * [.32, .58, .85, 1.25][j];
          if (r > rj) continue;
          x  = r / rj;
          d  = Math.abs((((th + j * slot * .5 + jit[j]) % slot) + slot) % slot - slot / 2);
          hw = slot / 2 * .74 * Math.pow(Math.sin(Math.PI * Math.pow(x, .8)), .9);
          if (d <= hw) return j * .24 + .2 * (x * .6 + d / (hw || 1) * .4);
        }
        return 1;
      };
    }
    else if (style === 'glitch') {
      // des bandes de hauteurs inégales (les unes très fines), coupées en blocs de largeurs inégales ; chaque bloc
      // apparaît avec l'une des `count` salves, à un souffle près
      var salvos = [], bands = [], a1 = 0, nb, cuts, blocks;
      for (i = 0; i < count; i++) salvos.push((i + .1 + R() * .5) / count);
      while (a1 < 1) {
        var a0 = a1, bh = R() < .25 ? .004 + R() * .01 : .02 + R() * R() * .14;
        a1 = Math.min(1, a0 + bh);
        nb = R() < .3 ? 1 : 2 + Math.floor(R() * 5);
        cuts = [0];
        for (i = 1; i < nb; i++) cuts.push(R());
        cuts.sort(function(p, q) { return p - q; });
        blocks = cuts.map(function(c) { return { c: c, t: salvos[Math.floor(R() * salvos.length)] + R() * .1 }; });
        bands.push({ a1: a1, blocks: blocks });
      }
      f = function(X, Y) {
        var al = along(X, Y), ac = across(X, Y), j = 0, k2, bl;
        while (j < bands.length - 1 && al > bands[j].a1) j++;
        bl = bands[j].blocks;
        for (k2 = bl.length - 1; k2 > 0 && ac < bl[k2].c; k2--);
        return bl[k2].t;
      };
    }
    else if (style === 'topo') {
      // les lignes de niveau d'un relief lissé : la ligne est proche du bord d'une tranche de hauteur, elle apparaît
      // fine (les basses tranches un peu avant) puis s'épaissit jusqu'à tout remplir
      var levels = count + 3;
      f = function(X, Y) {
        var h = (fbm(N, X * 1.6 + 3.1, Y * 1.6 + 7.7, 3) - .5) * 2.4 + .5, q = h * levels, fr = q - Math.floor(q);
        return h * .25 + Math.min(fr, 1 - fr) * 2 * .75;
      };
    }
    else if (style === 'maze') {
      // un labyrinthe creusé case par case depuis `origin` (en profondeur d'abord) : couloirs aux 3/5 de la case,
      // les murs fondent à la fin
      var ms = 1 / (count + 4), mc = Math.ceil(asp / ms), mr = Math.ceil(1 / ms), ord = new Int32Array(mc * mr).fill(-1), op = new Uint8Array(mc * mr), stack, cur, nxt, nn2 = 0, c2, r2, opts, dd;
      c2 = Math.max(0, Math.min(mc - 1, Math.floor(ox / ms))); r2 = Math.max(0, Math.min(mr - 1, Math.floor(oy / ms)));
      stack = [r2 * mc + c2];
      ord[stack[0]] = nn2++;
      while (stack.length) {
        cur = stack[stack.length - 1];
        c2 = cur % mc; r2 = (cur - c2) / mc;
        opts = [];
        if (c2 < mc - 1 && ord[cur + 1] < 0) opts.push(0);
        if (r2 < mr - 1 && ord[cur + mc] < 0) opts.push(1);
        if (c2 > 0 && ord[cur - 1] < 0) opts.push(2);
        if (r2 > 0 && ord[cur - mc] < 0) opts.push(3);
        if (!opts.length) { stack.pop(); continue; }
        dd  = opts[Math.floor(R() * opts.length)];
        nxt = cur + [1, mc, -1, -mc][dd];
        op[cur] |= 1 << dd;
        op[nxt] |= 1 << ((dd + 2) % 4);
        ord[nxt] = nn2++;
        stack.push(nxt);
      }
      f = function(X, Y) {
        var cx = Math.max(0, Math.min(mc - 1, Math.floor(X / ms))), cy = Math.max(0, Math.min(mr - 1, Math.floor(Y / ms))), id = cy * mc + cx;
        var u = X / ms - cx, v = Y / ms - cy, bx = Math.abs(u - .5), by = Math.abs(v - .5), t = -1;
        if (bx <= .3 && by <= .3) t = ord[id];
        else if (by <= .3 && u > .8 && (op[id] & 1)) t = Math.max(ord[id], ord[id + 1]);
        else if (bx <= .3 && v > .8 && (op[id] & 2)) t = Math.max(ord[id], ord[id + mc]);
        else if (by <= .3 && u < .2 && (op[id] & 4)) t = Math.max(ord[id], ord[id - 1]);
        else if (bx <= .3 && v < .2 && (op[id] & 8)) t = Math.max(ord[id], ord[id - mc]);
        if (t >= 0) return t / nn2 * .78;
        return .8 + .2 * Math.min(1, (Math.max(bx, by) - .3) / .2);
      };
    }
    else f = function(X, Y) { return along(X, Y) + (fbm(N, X * count * 1.2, Y * count * 1.2, 4) - .5) * .12 + (N(X * 40, Y * 40) - .5) * .02; };
    var min = Infinity, max = -Infinity, x, y, v;
    if (g) g();
    else for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) map[y * fw + x] = f((x + .5) / fh, (y + .5) / fh);
    for (i = 0; i < map.length; i++) {
      v = map[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // les styles neufs : quelques points isolés ne fixent pas les bornes (une petite part de la carte aux deux bouts, 0,2 % ou davantage selon le style, est ramenée à 0 et à 1)
    if (STYLES[style].clip) {
      var bins = new Uint32Array(1024), acc = 0, cut = map.length * STYLES[style].clip, span = max - min || 1;
      for (i = 0; i < map.length; i++) bins[Math.min(1023, Math.floor((map[i] - min) / span * 1024))]++;
      for (k = 0; k < 1024; k++) { acc += bins[k]; if (acc > cut) break; }
      var lo2 = min + k / 1024 * span;
      acc = 0;
      for (k = 1023; k > 0; k--) { acc += bins[k]; if (acc > cut) break; }
      max = min + (k + 1) / 1024 * span;
      min = lo2;
    }
    for (i = 0; i < map.length; i++) map[i] = Math.max(0, Math.min(1, (map[i] - min) / (max - min || 1)));
    return map;
  };

  // ---- la carte d'une image : sa luminosité (le sombre d'abord)
  var imageMap = function(img, fw, fh) {
    var cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    var c = cv.getContext('2d'), w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, r = Math.max(fw / w, fh / h);
    c.fillStyle = '#fff';
    c.fillRect(0, 0, fw, fh);
    c.drawImage(img, (fw - w * r) / 2, (fh - h * r) / 2, w * r, h * r);
    var d = c.getImageData(0, 0, fw, fh).data, map = new Float32Array(fw * fh), min = 1, max = 0, i, v;
    for (i = 0; i < map.length; i++) { v = (d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114) / 255; map[i] = v; if (v < min) min = v; if (v > max) max = v; }
    for (i = 0; i < map.length; i++) map[i] = (map[i] - min) / (max - min || 1);
    return map;
  };

  // ---- la planche : n images de la carte côte à côte, chacune bordée d'un pixel recopié (le masque
  // agrandi ne bave pas sur l'image voisine) ; rend ce qu'il faut poser sur la balise (p0, p1 : les
  // positions de la première et de la dernière image, en %)
  var inkSprite = function(map, mw, mh, ss, n, soft, invert) {
    var fw = mw / ss, fh = mh / ss, q = 255 / (ss * ss), cw = fw + 2, W = cw * n, H = fh + 2, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data, k, x, y, sx, sy, t, m, P, a, i, j;
    for (k = 0; k < n; k++) {
      P = k / (n - 1) * (1 + soft);
      for (y = 0; y < H; y++) {
        sy = Math.max(0, Math.min(fh - 1, y - 1));
        for (x = 0; x < cw; x++) {
          sx = Math.max(0, Math.min(fw - 1, x - 1));
          a  = 0;
          for (j = 0; j < ss; j++) for (i = 0; i < ss; i++) {
            m = map[(sy * ss + j) * mw + sx * ss + i];
            t = (P - (invert ? 1 - m : m)) / soft;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            a += t * t * (3 - 2 * t);
          }
          d[(y * W + k * cw + x) * 4 + 3] = a * q;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    var den = n * cw - fw;
    return { url: cv.toDataURL('image/png'), n: n, mw: (n * cw / fw * 100) + '%', mh: (H / fh * 100) + '%', p0: 100 / den, p1: ((n - 1) * cw + 1) * 100 / den };
  };
  // ---- la balise
  var FW     = 256;
  var SS     = 2;
  var N      = 32;
  var sheets = new Map();
  var images = {};
  var warned = {};
  var has2d  = null;
  var PROPS  = ['opacity', 'mask-image', 'mask-size', 'mask-repeat', 'mask-position', '-webkit-mask-image', '-webkit-mask-size', '-webkit-mask-repeat', '-webkit-mask-position'];

  var canvas2d = function() {
    if (has2d === null) {
      try {
        has2d = !!document.createElement('canvas').getContext('2d');
      }
      catch {
        has2d = false;
      }
    }
    return has2d;
  };

  // une image de masque : chargée une fois par adresse ; ceux qui l'attendent sont prévenus à son arrivée
  var load = function(url) {
    var e = images[url];
    if (e) return e;
    e = images[url] = { s: 0, img: new Image(), w: [] };
    e.img.crossOrigin = 'anonymous';
    e.img.onload = function() {
      e.s = 1;
      e.w.splice(0).forEach(function(f) { f(); });
    };
    e.img.onerror = function() {
      fail(url);
      e.w.splice(0).forEach(function(f) { f(); });
    };
    e.img.src = url;
    return e;
  };

  // l'image ne sert pas : un seul avertissement par adresse, et le fondu
  var fail = function(url) {
    images[url].s = 2;
    if (warned[url]) return;
    warned[url] = true;
    µ.warn('[ModularJS] *ink : l\'image de masque \'' + url + '\' n\'a pas pu être lue (introuvable, ou d\'une autre origine sans autorisation) — repli en fondu.');
  };

  var setup = function(opts) {
    var style    = STYLES[opts.style] ? opts.style : 'blots';
    var base     = STYLES[style];
    var count    = opts.count != null ? opts.count : base.count;
    var seed     = opts.seed != null ? opts.seed : 3;
    var angle    = opts.angle != null ? opts.angle : base.angle || 0;
    var origin   = opts.origin || [.5, .5];
    var invert   = !!opts.invert;
    return function(node) {
      // l'adresse de l'image de masque : une chaîne, ou ce que rend µimage('…')
      var image = µ._mjs_fxImage(opts.image, node) || null;
      var soft  = opts.soft != null ? opts.soft : image ? .1 : base.soft;
      var sprite = null, saved = null, last = -1, wait = false, hid = false, listening = false, lastT = 0, tick;
      // la planche de la balise à sa taille : un sprite, 'wait' (l'image n'est pas arrivée), ou null (le fondu)
      var ensure = function() {
        if (sprite) return sprite;
        var r = µ._mjs_dom ? µ._mjs_dom.getBoundingClientRect(node) : node.getBoundingClientRect(), fh = r.width && r.height ? Math.max(32, Math.min(400, Math.round(FW * r.height / r.width / 16) * 16)) : 144;
        var key, e, map, mh = fh * SS, mw = FW * SS;
        if (!canvas2d()) return null;
        if (image) {
          e = load(image);
          if (e.s === 0) {
            if (!listening) {
              listening = true;
              e.w.push(function() {
                listening = false;
                if (wait) tick(lastT);
              });
            }
            return 'wait';
          }
          if (e.s === 2) return null;
          key = ['i', image, invert, soft, fh].join('|');
        }
        else key = ['s', style, soft, count, seed, angle, origin[0], origin[1], invert, fh].join('|');
        // les planches gardées : huit au plus, la moins récente chassée (refaite si on la redemande) — une liste dont chaque
        // ligne a sa graine les gardait toutes, pour toujours (une image de plus de 100 Ko chacune)
        var sheet = sheets.get(key);
        if (sheet) sheets.delete(key);
        else {
          try {
            map   = image ? imageMap(e.img, mw, mh) : inkMap(style, mw, mh, { seed: seed, angle: angle, ox: origin[0], oy: origin[1], count: count });
            sheet = inkSprite(map, mw, mh, SS, N, soft, invert);
          }
          catch {
            if (!image) return null;
            fail(image);
            return null;
          }
        }
        sheets.set(key, sheet);
        if (sheets.size > 8) sheets.delete(sheets.keys().next().value);
        return sprite = sheet;
      };
      var save = function() {
        if (saved) return;
        saved = {};
        PROPS.forEach(function(p) { saved[p] = node.style.getPropertyValue(p); });
      };
      var restore = function() {
        if (!saved) return;
        PROPS.forEach(function(p) {
          if (saved[p] === '') node.style.removeProperty(p);
          else node.style.setProperty(p, saved[p]);
        });
        saved = null;
        last  = -1;
        hid   = false;
      };
      tick = function(t) {
        var sp, k, p;
        // l'image de masque pas encore demandée, balise loin de l'écran : tenue cachée (comme pendant
        // son chargement), sans la demander ; au bout du jeu elle est montrée telle quelle
        if (image && !sprite && !images[image] && µ._mjs_fxFarImage(node)) {
          if (t >= 1) {
            restore();
            return;
          }
          lastT = t;
          save();
          node.style.opacity = '0';
          hid = true;
          return;
        }
        // tenue cachée avant son jeu, loin de l'écran : l'opacité suffit, sans fabriquer la planche
        if (t === 0 && !sprite && !image && µ._mjs_fxFar(node)) {
          lastT = t;
          save();
          node.style.opacity = '0';
          hid = true;
          return;
        }
        sp    = ensure();
        lastT = t;
        wait  = sp === 'wait';
        if (wait) {
          // l'image de masque n'est pas arrivée à la fin du jeu : la balise est montrée telle quelle,
          // jamais laissée cachée
          if (t >= 1) {
            restore();
            return;
          }
          save();
          node.style.opacity = '0';
          hid = true;
          return;
        }
        if (t >= 1) {
          restore();
          return;
        }
        save();
        if (!sp) {
          node.style.opacity = String(t);
          return;
        }
        if (hid) {
          if (saved.opacity === '') node.style.removeProperty('opacity');
          else node.style.opacity = saved.opacity;
          hid = false;
        }
        k = Math.round(t * (N - 1));
        k = k < 0 ? 0 : k > N - 1 ? N - 1 : k;
        if (k === last) return;
        if (last < 0) {
          ['', '-webkit-'].forEach(function(v) {
            node.style.setProperty(v + 'mask-image', 'url(' + sp.url + ')');
            node.style.setProperty(v + 'mask-size', sp.mw + ' ' + sp.mh);
            node.style.setProperty(v + 'mask-repeat', 'no-repeat');
          });
        }
        last = k;
        p    = (sp.p0 + k * (sp.p1 - sp.p0) / (N - 1)) + '% 50%';
        node.style.setProperty('mask-position', p);
        node.style.setProperty('-webkit-mask-position', p);
      };
      // la planche est préparée d'avance seulement pour une balise à l'écran : hors écran, elle
      // attend le premier jeu (le calcul coûte des dizaines de ms, payées pour rien au démarrage)
      if (!image && !µ._mjs_fxFar(node)) ensure();
      return {
        delay: opts.delay != null ? opts.delay : 0,
        duration: opts.duration != null ? opts.duration : 1800,
        easing: µ.easing.resolve(opts.easing != null ? opts.easing : 'linear'),
        tick: tick,
        // l'effet arrêté en plein jeu (retiré, relancé) : la balise retrouve son style
        cleanup: function() {
          wait = false;
          restore();
        }
      };
    };
  };

  var make = function(opts) {
    var f = setup(opts || {});
    f._isCfgFactory = true;
    return { intro: f, outro: f };
  };
  make.inkMap = inkMap;
  return make;
})();
