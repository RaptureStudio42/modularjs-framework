// mjs_fx_physics — `*physics(mode)` : les enfants directs de la balise deviennent des corps solides. Ce
// sont les VRAIES balises de la page (texte sélectionnable, liens cliquables) qui bougent ; un moteur
// maison, court, les fait tomber, rebondir, rouler ou se balancer. Les modes :
//   fall  : ils tombent, rebondissent, roulent les uns sur les autres et s'entassent au fond du
//           conteneur ; on les attrape à la souris ou au doigt et on les lance
//   float : pas de pesanteur ; chacun est retenu à sa place par un ressort, la souris les bouscule, ils
//           reviennent en se balançant
//   hang  : chacun pend à un fil accroché au-dessus de sa place et se balance ; on tire dessus, on lâche
// Réglages : mode (fall), gravity (la pesanteur, de -3 à 3 ; 1 = 1000 px/s², négative : ça monte ; 1, et 0 en
// float), bounce (le rebond, de 0 à 1 ; 0.5), friction (le frottement entre corps et contre les bords, de 0 à
// 1 ; 0.3), drag (on attrape et on lance les corps à la souris ou au doigt ; true), walls (les bords du
// conteneur qui retiennent : all = les quatre, floor = le sol et les côtés, none = aucun ; all), spin (les
// corps tournent, sinon ils restent droits ; true), strength (float et hang : la raideur du ressort ou du
// fil, de 0 à 1, 0 = aucun ; 0.3), length (hang : la longueur du fil en px ; 100), push (float : la portée
// de la bousculade de la souris en px, 0 = aucune ; 140), color (hang : la couleur des fils, celle du texte
// sinon), sleep (le délai sans geste au bout duquel des corps qui ne se calment pas se figent où ils sont,
// 0 = jamais ; 30s), on (quand la simulation part — view : à l'arrivée à l'écran, load : dès l'apparition,
// click : au premier clic ; view).
// La mise en page d'origine fait foi : à la pose, la boîte de chaque enfant est lue UNE fois (et de nouveau
// quand le conteneur ou un enfant change de taille, ou qu'un enfant arrive ou part : la simulation repart
// de la mise en page) ; ensuite un enfant ne bouge que par `translate` et `rotate`, sans aucune lecture de
// boîte ; les fils de `hang` de même : une balise par fil, couchée par `transform` seul, ni mise en page ni
// peinture par image (un calque composé pendant la simulation seulement) ; en contraste forcé, ils prennent la
// couleur du texte du thème. Le calque des fils et les fils sont à l'abri de la CSS de l'auteur : des balises
// que nulle règle ne vise par son type (`span`, `i`), une géométrie en `!important` (marge, cadre, ombre, contour…). La forme d'un corps est sa boîte de bordure, orientée, coins arrondis compris : un `border-radius`
// qui vaut au moins la moitié du petit côté en fait une pilule, ou un disque si la boîte est carrée.
// Le moteur (`engine`, testé seul) : pas fixe de 1/120 s, au plus 4 pas par image. Les boîtes se touchent
// par une face (deux points de contact : une pile ne tremble pas) ou par un coin ; les contacts sont
// spéculatifs (un corps rapide ne traverse rien) et mous (deux corps qui se recouvrent se dégagent sans
// à-coup). Frottement, rebond, ressorts amortis (la souris, le rappel de `float`, le fil de `hang`).
// Les corps s'endorment : quand tous sont immobiles depuis une demi-seconde, la boucle s'arrête, elle ne
// repart qu'à un geste. Sans enfant, rien ne tourne. Le sommeil est garanti : des corps qui ne peuvent se
// ranger (un conteneur trop petit pour eux, ils se repoussent sans fin) se figent où ils sont `sleep` après le
// dernier geste (saisie, bousculade, réglage qui change ; tant qu'un corps est tenu, le compte reste à zéro ;
// 30 s par défaut, 0 = jamais) ; aucun mouvement qui s'amortit n'atteint les 30 s (le plus long mesuré, un corps
// lancé sans pesanteur à la vitesse maximale, dort au bout de 19 s), un délai plus court fige un mouvement encore
// en route. Hors écran et onglet caché : en pause. « Réduire les animations » : rien ne bouge.
// Effets économes : au-delà de 60 corps (20 en mode économe), les corps de trop restent fixes (obstacles).

(function() {
  var STEP     = 1 / 120;
  var G0       = 1000;
  var MARGIN   = 3;
  var PUSHOUT  = 300;
  var REST     = 120;
  var MAXV     = 3500;
  var AIR      = 0.35;
  var HANG_AIR = 1;
  var SPIN_AIR = 0.6;
  var ROLL_AIR = 1.5;
  var SLEEP_V  = 4;
  var SLEEP_T  = 0.5;
  var AWAKE_T  = 30; // le délai par défaut du sommeil forcé (réglage sleep), en secondes
  var PASSES   = 8;
  var SETTLES  = 4;
  var FAR      = 5000;
  var DEEP     = 4;
  var NUDGE_A  = 14000;
  var GRAB_A   = 60000;
  var ROPE     = 1.5; // l'épaisseur d'un fil de `hang`, en px
  var CAP      = ROPE * Math.PI / 8; // dont chaque bout du fil dépasse : l'aire d'un bout arrondi, π (ROPE / 2)² / 2
  var TILT     = 5e-5; // l'inclinaison (rad) ajoutée à tout fil : droit comme un i, il serait calé sur des pixels entiers (2 px ou 1 px au lieu de 1,5)

  // un ressort amorti résolu en implicite sur un pas (f : sa raideur en Hz, z : son amortissement relatif).
  // lead : la vitesse de rattrapage par px d'écart ; grip : la part de la masse effective que la passe applique ;
  // keep : la part des impulsions déjà données qu'une nouvelle passe garde
  function soften(f, z) {
    var w = 2 * Math.PI * f;
    var a = 2 * z + STEP * w;
    var b = STEP * w * a;
    return { lead: w / a, grip: b / (1 + b), keep: 1 / (1 + b) };
  }

  var HARD = soften(60, 10);
  var GRAB = soften(7, 0.8);

  var GROUND = { x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, im: 0, ii: 0 };
  // le contact en cours de calcul : un ou deux points ; la normale va du corps A vers le corps B
  var M      = { n: 0, nx: 0, ny: 0, x: [0, 0], y: [0, 0], s: [0, 0], id: [0, 0] };
  // le point du coeur d'un corps le plus près d'un point du monde (CQ), et ce point dans le repère du corps (LQ)
  var CQ   = { x: 0, y: 0 };
  var LQ   = { x: 0, y: 0 };
  var FACE = 0;

  function point(k, x, y, s, id) {
    M.x[k]  = x;
    M.y[k]  = y;
    M.s[k]  = s;
    M.id[k] = id;
  }

  // ----- les corps : un coeur convexe (un point, ou un rectangle) épaissi d'un rayon -----
  // disque : un point ; boîte aux coins arrondis : un rectangle rétréci du rayon ; une pilule en est une dont
  // le coeur n'a qu'1 px d'épaisseur (les axes de ses deux bouts comptent comme ceux de ses flancs)
  function makeBody(id, o) {
    var w     = Math.max(o.w, 1);
    var h     = Math.max(o.h, 1);
    var min   = Math.min(w, h);
    var r     = Math.min(Math.max(o.radius || 0, 0), min / 2);
    var b     = { id: id, x: o.x, y: o.y, a: 0, vx: 0, vy: 0, w: 0, hw: w / 2, hh: h / 2, hx: o.x, hy: o.y, fixed: !!o.fixed, frozen: false, touch: false, fast: 0, sp: null, asp: null, rope: null, cs: 1, sn: 0, wx: [], wy: [], wnx: [], wny: [], lnx: [], lny: [] };
    var round = r >= min / 2 - 0.25;
    var area;
    if (round && Math.abs(w - h) <= 1) {
      r    = min / 2;
      b.n  = 1;
      b.lx = [0];
      b.ly = [0];
      area = Math.PI * r * r;
    }
    else {
      if (round) r = min / 2 - 0.5;
      var cx = w / 2 - r;
      var cy = h / 2 - r;
      b.n  = 4;
      b.lx = [-cx, cx, cx, -cx];
      b.ly = [-cy, -cy, cy, cy];
      area = w * h - (4 - Math.PI) * r * r;
      for (var i = 0; i < 4; i++) {
        var j   = (i + 1) & 3;
        var ex  = b.lx[j] - b.lx[i];
        var ey  = b.ly[j] - b.ly[i];
        var len = Math.sqrt(ex * ex + ey * ey);
        b.lnx[i] = ey / len;
        b.lny[i] = -ex / len;
      }
    }
    var inertia = b.n === 1 ? 0.5 * area * r * r : area * (w * w + h * h) / 12;
    b.r  = r;
    b.br = Math.sqrt(b.hw * b.hw + b.hh * b.hh);
    b.im = b.fixed ? 0 : 1 / area;
    b.i0 = b.fixed ? 0 : 1 / inertia;
    b.ii = o.spin === false ? 0 : b.i0;
    sync(b);
    return b;
  }

  // les sommets et les normales dans le monde, d'après la pose
  function sync(b) {
    var cs = Math.cos(b.a);
    var sn = Math.sin(b.a);
    b.cs = cs;
    b.sn = sn;
    for (var i = 0; i < b.n; i++) {
      b.wx[i] = b.x + cs * b.lx[i] - sn * b.ly[i];
      b.wy[i] = b.y + sn * b.lx[i] + cs * b.ly[i];
      if (b.n > 1) {
        b.wnx[i] = cs * b.lnx[i] - sn * b.lny[i];
        b.wny[i] = sn * b.lnx[i] + cs * b.lny[i];
      }
    }
  }

  // la distance d'un point du monde au coeur d'un corps ; le point du coeur le plus proche est rangé dans CQ,
  // le point demandé (dans le repère du corps) dans LQ
  function closest(b, px, py) {
    var dx = px - b.x;
    var dy = py - b.y;
    var lx = b.cs * dx + b.sn * dy;
    var ly = -b.sn * dx + b.cs * dy;
    var qx = 0;
    var qy = 0;
    LQ.x = lx;
    LQ.y = ly;
    if (b.n === 4) {
      var hx = b.lx[1];
      var hy = b.ly[2];
      qx = lx < -hx ? -hx : lx > hx ? hx : lx;
      qy = ly < -hy ? -hy : ly > hy ? hy : ly;
    }
    CQ.x = b.x + b.cs * qx - b.sn * qy;
    CQ.y = b.y + b.sn * qx + b.cs * qy;
    var ddx = px - CQ.x;
    var ddy = py - CQ.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // ----- les contacts : disque et disque, disque et boîte, boîte et boîte -----
  function discs(A, B, margin) {
    var dx = B.wx[0] - A.wx[0];
    var dy = B.wy[0] - A.wy[0];
    var d  = Math.sqrt(dx * dx + dy * dy);
    var rr = A.r + B.r;
    if (d > rr + margin) return 0;
    var nx = d > 1e-9 ? dx / d : 0;
    var ny = d > 1e-9 ? dy / d : 1;
    M.nx = nx;
    M.ny = ny;
    point(0, 0.5 * (A.wx[0] + B.wx[0] + nx * (A.r - B.r)), 0.5 * (A.wy[0] + B.wy[0] + ny * (A.r - B.r)), d - rr, 0);
    return 1;
  }

  // un disque D contre une boîte P (la normale va de D vers P) : le point du coeur de la boîte le plus près du
  // centre du disque donne la normale ; le centre dans le coeur, on sort par la face la plus proche
  function discBox(D, P, margin) {
    var cx = D.wx[0];
    var cy = D.wy[0];
    var d  = closest(P, cx, cy);
    var rr = D.r + P.r;
    var nx;
    var ny;
    if (d > rr + margin) return 0;
    if (d > 1e-9) {
      nx = (CQ.x - cx) / d;
      ny = (CQ.y - cy) / d;
    }
    else {
      var ex = P.lx[1] - Math.abs(LQ.x);
      var ey = P.ly[2] - Math.abs(LQ.y);
      var ox = ex < ey ? (LQ.x < 0 ? -1 : 1) : 0;
      var oy = ex < ey ? 0 : (LQ.y < 0 ? -1 : 1);
      nx = -(P.cs * ox - P.sn * oy);
      ny = -(P.sn * ox + P.cs * oy);
      d  = -Math.min(ex, ey);
    }
    var s = d - rr;
    M.nx = nx;
    M.ny = ny;
    point(0, cx + nx * (D.r + s * 0.5), cy + ny * (D.r + s * 0.5), s, 0);
    return 1;
  }

  // l'écart de la boîte Q à chaque face de P, mesuré selon la normale de la face : le plus grand (négatif :
  // recouvrement), et la face qui le donne (FACE)
  function faceGap(P, Q) {
    var best = -Infinity;
    for (var i = 0; i < 4; i++) {
      var low = Infinity;
      for (var j = 0; j < 4; j++) low = Math.min(low, (Q.wx[j] - P.wx[i]) * P.wnx[i] + (Q.wy[j] - P.wy[i]) * P.wny[i]);
      if (low > best) {
        best = low;
        FACE = i;
      }
    }
    return best;
  }

  // la face rf de R (la référence) et la face fi de I qui lui fait face : de celle-ci on garde la part qui se
  // projette sur la référence, un point à chaque bout ; sans part en regard, un coin contre un coin
  function patch(R, rf, I, fi, flip, margin) {
    var r1  = (rf + 1) & 3;
    var i1  = (fi + 1) & 3;
    var nx  = R.wnx[rf];
    var ny  = R.wny[rf];
    var px  = R.wx[rf];
    var py  = R.wy[rf];
    var tx  = -ny;
    var ty  = nx;
    var len = (R.wx[r1] - px) * tx + (R.wy[r1] - py) * ty;
    var ax  = I.wx[fi];
    var ay  = I.wy[fi];
    var bx  = I.wx[i1];
    var by  = I.wy[i1];
    var ua  = (ax - px) * tx + (ay - py) * ty;
    var ub  = (bx - px) * tx + (by - py) * ty;
    var ha  = (ax - px) * nx + (ay - py) * ny;
    var hb  = (bx - px) * nx + (by - py) * ny;
    var rad = R.r + I.r;
    var s0  = 0;
    var s1  = 1;
    var du  = ub - ua;
    // la part a→b dont la projection tombe entre 0 et len
    if (Math.abs(du) > 1e-9) {
      var p = -ua / du;
      var q = (len - ua) / du;
      s0 = Math.max(0, Math.min(p, q));
      s1 = Math.min(1, Math.max(p, q));
    }
    else if (ua < 0 || ua > len) s0 = 2;
    var k    = 0;
    var sign = flip ? -1 : 1;
    if (s0 > s1) {
      // le bout de la référence le plus proche, contre le sommet de l'autre face qui en est le plus près
      var cr = ua + ub < len ? rf : r1;
      var cx = R.wx[cr];
      var cy = R.wy[cr];
      var da = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
      var db = (bx - cx) * (bx - cx) + (by - cy) * (by - cy);
      var ex = db < da ? bx : ax;
      var ey = db < da ? by : ay;
      var d  = Math.sqrt(Math.min(da, db));
      if (d > rad + margin) return 0;
      var vx = d > 1e-9 ? (ex - cx) / d : nx;
      var vy = d > 1e-9 ? (ey - cy) / d : ny;
      M.nx = sign * vx;
      M.ny = sign * vy;
      point(0, 0.5 * (cx + ex + vx * (R.r - I.r)), 0.5 * (cy + ey + vy * (R.r - I.r)), d - rad, 64 + (flip ? 16 : 0) + cr * 4 + (db < da ? i1 : fi));
      return 1;
    }
    M.nx = sign * nx;
    M.ny = sign * ny;
    for (var n = 0; n < (s1 - s0 > 1e-6 ? 2 : 1); n++) {
      var s = n === 0 ? s0 : s1;
      var h = ha + s * (hb - ha);
      if (h - rad > margin) continue;
      var u    = ua + s * du;
      var cut  = u < len / 2 ? 0 : 1;
      var id   = (flip ? 16 : 0) + (s === 0 ? fi : s === 1 ? 4 + i1 : 8 + cut);
      var lift = 0.5 * (R.r - I.r - h);
      point(k++, ax + s * (bx - ax) + nx * lift, ay + s * (by - ay) + ny * lift, h - rad, id);
    }
    return k;
  }

  // deux boîtes : la face de contact est celle où l'écart est le plus grand (la première en cas d'égalité)
  function boxes(A, B, margin) {
    var ga  = faceGap(A, B);
    var fa  = FACE;
    var gb  = faceGap(B, A);
    var fb  = FACE;
    var rad = A.r + B.r;
    if (ga > rad + margin || gb > rad + margin) return 0;
    var flip = gb > ga + 0.05;
    var R    = flip ? B : A;
    var I    = flip ? A : B;
    var rf   = flip ? fb : fa;
    var fi   = 0;
    var low  = Infinity;
    // la face de l'autre boîte qui s'oppose le plus à celle de la référence
    for (var k = 0; k < 4; k++) {
      var dot = R.wnx[rf] * I.wnx[k] + R.wny[rf] * I.wny[k];
      if (dot < low) {
        low = dot;
        fi  = k;
      }
    }
    return patch(R, rf, I, fi, flip, margin);
  }

  // un corps contre un bord du conteneur (un plan : son point, sa normale vers l'intérieur) : les deux sommets
  // du coeur les plus près du plan
  function wallContact(B, wl, margin) {
    var nx = wl.nx;
    var ny = wl.ny;
    var m0 = Infinity;
    var m1 = Infinity;
    var j0 = -1;
    var j1 = -1;
    for (var i = 0; i < B.n; i++) {
      var s = (B.wx[i] - wl.px) * nx + (B.wy[i] - wl.py) * ny - B.r;
      if (s < m0) {
        m1 = m0;
        j1 = j0;
        m0 = s;
        j0 = i;
      }
      else if (s < m1) {
        m1 = s;
        j1 = i;
      }
    }
    var k = 0;
    M.nx = nx;
    M.ny = ny;
    if (m0 <= margin) point(k++, B.wx[j0] - nx * (B.r + m0 * 0.5), B.wy[j0] - ny * (B.r + m0 * 0.5), m0, j0);
    if (j1 >= 0 && m1 <= margin) point(k++, B.wx[j1] - nx * (B.r + m1 * 0.5), B.wy[j1] - ny * (B.r + m1 * 0.5), m1, j1);
    return k;
  }

  function collide(A, B, margin) {
    if (A.n === 1 && B.n === 1) return discs(A, B, margin);
    if (A.n === 1) return discBox(A, B, margin);
    if (B.n === 1) {
      var k = discBox(B, A, margin);
      M.nx = -M.nx;
      M.ny = -M.ny;
      return k;
    }
    return boxes(A, B, margin);
  }

  // une contrainte molle sur une seule direction : le point (rx, ry) du corps b, mesuré selon l'axe unitaire
  // (ax, ay), est rappelé vers sa cible ; err : l'écart selon l'axe (px) ; acc : l'impulsion déjà donnée, bornée
  // entre lo et hi ; rend la nouvelle impulsion cumulée
  function axis(b, rx, ry, ax, ay, err, soft, acc, lo, hi) {
    var rn  = rx * ay - ry * ax;
    var kin = b.im + b.ii * rn * rn;
    if (kin <= 0) return acc;
    var cdot = ax * (b.vx - b.w * ry) + ay * (b.vy + b.w * rx);
    var next = Math.max(lo, Math.min(hi, acc - soft.grip / kin * (cdot + soft.lead * err) - soft.keep * acc));
    var lam  = next - acc;
    b.vx += b.im * lam * ax;
    b.vy += b.im * lam * ay;
    b.w  += b.ii * rn * lam;
    return next;
  }

  // la même contrainte sur l'angle : le corps est rappelé vers l'angle nul
  function twist(b, err, soft, acc) {
    var lam = -soft.grip / b.ii * (b.w + soft.lead * err) - soft.keep * acc;
    b.w += b.ii * lam;
    return acc + lam;
  }

  // ----- le monde : bords, ressorts, pas de simulation -----
  function makeWorld(o) {
    var W      = { bodies: [], width: o.width || 0, height: o.height || 0, gravity: 0, bounce: 0.5, friction: 0.3, walls: 'all', mode: 'fall', strength: 0.3, length: 100, push: 0, asleep: false, calm: 0, awake: 0, sleepAfter: AWAKE_T, grabbed: null, pointer: null, count: 0 };
    var bodies = W.bodies;
    var cache  = new Map();
    var live   = [];
    var edges  = [];
    var spring = [];
    var mobile = [];
    var stamp  = 0;
    var sweep  = function(c, k) { if (c.stamp !== stamp) cache.delete(k); };

    function wallList() {
      var list = [];
      if (W.walls === 'none') return list;
      list.push({ px: 0, py: W.height, nx: 0, ny: -1 });
      list.push({ px: 0, py: 0, nx: 1, ny: 0 });
      list.push({ px: W.width, py: 0, nx: -1, ny: 0 });
      if (W.walls === 'all') list.push({ px: 0, py: 0, nx: 0, ny: 1 });
      return list;
    }

    // les réglages (la pesanteur en multiple de 1000 px/s², sleep en secondes), puis les ressorts de chaque corps
    W.config = function(c) {
      if (c.gravity !== void 0) W.gravity = c.gravity * G0;
      if (c.bounce !== void 0) W.bounce = c.bounce;
      if (c.friction !== void 0) W.friction = c.friction;
      if (c.walls !== void 0) W.walls = c.walls;
      if (c.mode !== void 0) W.mode = c.mode;
      if (c.strength !== void 0) W.strength = c.strength;
      if (c.length !== void 0) W.length = c.length;
      if (c.push !== void 0) W.push = c.push;
      if (c.sleep !== void 0) W.sleepAfter = c.sleep;
      if (c.width !== void 0) W.width = c.width;
      if (c.height !== void 0) W.height = c.height;
      edges = wallList();
      W.joints();
      W.wake();
    };

    W.add = function(spec) {
      var b = makeBody(bodies.length, spec);
      bodies.push(b);
      W.count = bodies.length;
      return b;
    };

    // le ressort de rappel de `float`, le fil de `hang`, posés d'après la mise en page (hx, hy). Sous la
    // pesanteur, un ressort ou un fil s'allonge du poids du corps : leur cible en tient compte, le corps
    // repose alors exactement à sa place
    W.joints = function() {
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        b.sp   = null;
        b.asp  = null;
        b.rope = null;
        if (b.fixed || W.strength <= 0) continue;
        if (W.mode === 'float') {
          var fs = 0.5 + 5.5 * W.strength;
          var ws = 2 * Math.PI * fs;
          b.sp = { soft: soften(fs, 0.14), oy: -W.gravity / (ws * ws) };
          if (b.ii > 0) b.asp = { soft: soften(fs, 0.14) };
        }
        else if (W.mode === 'hang') {
          var fh  = 1.5 + 28 * W.strength;
          var wh  = 2 * Math.PI * fh;
          var dir = W.gravity < 0 ? 1 : -1;
          var sag = Math.min(Math.abs(W.gravity) / (wh * wh), W.length * 0.5);
          b.rope = { soft: soften(fh, 0.15), ax: b.hx, ay: b.hy + dir * (b.hh + W.length), lx: 0, ly: dir * b.hh, rest: Math.max(0.5, W.length - sag) };
        }
      }
    };

    W.wake = function() {
      W.asleep = false;
      W.calm   = 0;
      W.awake  = 0;
    };

    W.grab = function(b, lx, ly, tx, ty) {
      W.grabbed = { b: b, lx: lx, ly: ly, tx: tx, ty: ty, soft: GRAB };
      W.wake();
    };

    W.pull = function(tx, ty) {
      if (!W.grabbed) return;
      W.grabbed.tx = tx;
      W.grabbed.ty = ty;
      W.wake();
    };

    W.release = function() {
      W.grabbed = null;
      W.wake();
    };

    // le point (x, y) du monde dans le repère du corps
    W.local = function(b, x, y) {
      var dx = x - b.x;
      var dy = y - b.y;
      return { x: b.cs * dx + b.sn * dy, y: -b.sn * dx + b.cs * dy };
    };

    // un corps est-il à portée de la souris (float) ?
    W.near = function(x, y) {
      if (W.push <= 0) return false;
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (!b.fixed && !b.frozen && closest(b, x, y) - b.r < W.push) return true;
      }
      return false;
    };

    // chaque corps à sa place de mise en page, immobile, ses ressorts neufs
    W.reset = function() {
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        b.x      = b.hx;
        b.y      = b.hy;
        b.a      = b.vx = b.vy = b.w = 0;
        b.frozen = false;
        sync(b);
      }
      W.grabbed = null;
      W.joints();
      W.wake();
    };

    W.sleep = function() {
      for (var i = 0; i < bodies.length; i++) bodies[i].vx = bodies[i].vy = bodies[i].w = 0;
      W.grabbed = null;
      W.asleep  = true;
    };

    // l'énergie mécanique (cinétique et pesanteur) des corps libres, pour les tests
    W.energy = function() {
      var e = 0;
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b.fixed) continue;
        e += 0.5 * (b.vx * b.vx + b.vy * b.vy) / b.im + 0.5 * b.w * b.w / (b.i0 || 1) + W.gravity * (W.height - b.y) / b.im;
      }
      return e;
    };

    // le plus fort recouvrement des contacts du dernier pas (négatif), pour les tests
    W.depth = function() {
      var d = 0;
      for (var i = 0; i < live.length; i++) {
        for (var k = 0; k < live[i].np; k++) d = Math.min(d, live[i].p[k].s);
      }
      return d;
    };

    function newPoint() {
      return { x: 0, y: 0, s: 0, id: -1, ax: 0, ay: 0, bx: 0, by: 0, nm: 0, tm: 0, jn: 0, jt: 0, mj: 0, rv: 0 };
    }

    // le contact de la clé donnée : celui du pas d'avant, dont les points qui portent la même marque gardent
    // leurs impulsions (le pas repart de là), ou un neuf
    function contactOf(key, A, B) {
      var c = cache.get(key);
      if (!c) {
        c = { key: key, a: A, b: B, np: 0, nx: 0, ny: 0, stamp: 0, p: [newPoint(), newPoint()] };
        cache.set(key, c);
      }
      var n0  = c.np;
      var id0 = c.p[0].id;
      var id1 = c.p[1].id;
      var n00 = c.p[0].jn;
      var t00 = c.p[0].jt;
      var n01 = c.p[1].jn;
      var t01 = c.p[1].jt;
      c.np    = M.n;
      c.nx    = M.nx;
      c.ny    = M.ny;
      c.stamp = stamp;
      for (var k = 0; k < M.n; k++) {
        var q = c.p[k];
        q.x  = M.x[k];
        q.y  = M.y[k];
        q.s  = M.s[k];
        q.id = M.id[k];
        q.jn = 0;
        q.jt = 0;
        if (n0 > 0 && q.id === id0) {
          q.jn = n00;
          q.jt = t00;
        }
        else if (n0 > 1 && q.id === id1) {
          q.jn = n01;
          q.jt = t01;
        }
      }
      live.push(c);
    }

    function collideAll() {
      stamp++;
      live.length   = 0;
      mobile.length = 0;
      var n = bodies.length;
      var i;
      var j;
      var k = 0;
      for (i = 0; i < n; i++) {
        var A = bodies[i];
        A.touch = false;
        A.fast  = Math.sqrt(A.vx * A.vx + A.vy * A.vy) + Math.abs(A.w) * A.br;
        if (!A.fixed && !A.frozen) mobile.push(i);
      }
      for (i = 0; i < n; i++) {
        var P = bodies[i];
        if (P.frozen) continue;
        var m;
        if (!P.fixed) {
          m = MARGIN + P.fast * STEP;
          for (j = 0; j < edges.length; j++) {
            M.n = wallContact(P, edges[j], m);
            if (M.n > 0) {
              contactOf(-1 - j * 100000 - i, GROUND, P);
              P.touch = true;
            }
          }
        }
        // deux corps fixes ne se rencontrent pas : un corps fixe ne parcourt que les corps libres qui le suivent (`mobile`, croissante), un corps
        // libre tous ceux qui le suivent. Au-delà de 60 enfants, les corps de trop sont fixes : leurs paires ne se parcourent plus (mêmes paires, même ordre)
        while (k < mobile.length && mobile[k] <= i) k++;
        var end = P.fixed ? mobile.length : n;
        for (var t = P.fixed ? k : i + 1; t < end; t++) {
          j = P.fixed ? mobile[t] : t;
          var Q = bodies[j];
          if (Q.frozen || (P.fixed && Q.fixed)) continue;
          m = MARGIN + (P.fast + Q.fast) * STEP;
          var dx = Q.x - P.x;
          var dy = Q.y - P.y;
          var rr = P.br + Q.br + m + Math.max(P.r, Q.r);
          if (dx * dx + dy * dy > rr * rr) continue;
          M.n = collide(P, Q, m);
          if (M.n > 0) {
            contactOf(i * 10000 + j, P, Q);
            P.touch = true;
            Q.touch = true;
          }
        }
      }
      cache.forEach(sweep);
    }

    // une impulsion (px, py) au point q d'un contact : elle pousse B et repousse A
    function give(A, B, q, px, py) {
      A.vx -= A.im * px;
      A.vy -= A.im * py;
      A.w  -= A.ii * (q.ax * py - q.ay * px);
      B.vx += B.im * px;
      B.vy += B.im * py;
      B.w  += B.ii * (q.bx * py - q.by * px);
    }

    // les masses effectives de chaque point, et la vitesse d'approche d'avant le pas (pour le rebond)
    function prepare() {
      for (var i = 0; i < live.length; i++) {
        var c  = live[i];
        var A  = c.a;
        var B  = c.b;
        var nx = c.nx;
        var ny = c.ny;
        for (var k = 0; k < c.np; k++) {
          var q   = c.p[k];
          q.ax = q.x - A.x;
          q.ay = q.y - A.y;
          q.bx = q.x - B.x;
          q.by = q.y - B.y;
          var rna = q.ax * ny - q.ay * nx;
          var rnb = q.bx * ny - q.by * nx;
          var rta = -q.ax * nx - q.ay * ny;
          var rtb = -q.bx * nx - q.by * ny;
          var kn  = A.im + B.im + A.ii * rna * rna + B.ii * rnb * rnb;
          var kt  = A.im + B.im + A.ii * rta * rta + B.ii * rtb * rtb;
          q.nm = kn > 0 ? 1 / kn : 0;
          q.tm = kt > 0 ? 1 / kt : 0;
          q.rv = (B.vx - B.w * q.by - A.vx + A.w * q.ay) * nx + (B.vy + B.w * q.bx - A.vy - A.w * q.ax) * ny;
          q.mj = 0;
        }
      }
    }

    // les impulsions du pas d'avant, redonnées d'emblée : la pile n'a pas à les retrouver à chaque pas
    function warm() {
      for (var i = 0; i < live.length; i++) {
        var c = live[i];
        for (var k = 0; k < c.np; k++) {
          var q = c.p[k];
          give(c.a, c.b, q, q.jn * c.nx + q.jt * c.ny, q.jn * c.ny - q.jt * c.nx);
        }
      }
    }

    // une passe sur les contacts, dans un sens ou dans l'autre ; `push` : le dégagement des corps qui se
    // recouvrent (absent à la détente, qui ne fait que retirer la vitesse restée dans les contacts)
    function solve(push, back) {
      for (var n = 0; n < live.length; n++) {
        var c  = live[back ? live.length - 1 - n : n];
        var A  = c.a;
        var B  = c.b;
        var nx = c.nx;
        var ny = c.ny;
        var tx = ny;
        var ty = -nx;
        var k;
        var q;
        var dvx;
        var dvy;
        var lam;
        for (k = 0; k < c.np; k++) {
          q   = c.p[k];
          dvx = B.vx - B.w * q.by - A.vx + A.w * q.ay;
          dvy = B.vy + B.w * q.bx - A.vy - A.w * q.ax;
          var cap = W.friction * q.jn;
          var nt  = Math.max(-cap, Math.min(cap, q.jt - q.tm * (dvx * tx + dvy * ty)));
          lam  = nt - q.jt;
          q.jt = nt;
          give(A, B, q, lam * tx, lam * ty);
        }
        for (k = 0; k < c.np; k++) {
          q   = c.p[k];
          dvx = B.vx - B.w * q.by - A.vx + A.w * q.ay;
          dvy = B.vy + B.w * q.bx - A.vy - A.w * q.ax;
          var vn   = dvx * nx + dvy * ny;
          var bias = 0;
          var grip = 1;
          var keep = 0;
          // un écart positif : le corps peut s'approcher de tout l'écart pendant ce pas, pas plus
          if (q.s > 0) bias = q.s / STEP;
          else if (push) {
            bias = Math.max(HARD.lead * q.s, -PUSHOUT);
            grip = HARD.grip;
            keep = HARD.keep;
          }
          var nn = Math.max(0, q.jn - q.nm * grip * (vn + bias) - keep * q.jn);
          lam  = nn - q.jn;
          q.jn = nn;
          if (nn > q.mj) q.mj = nn;
          give(A, B, q, lam * nx, lam * ny);
        }
      }
    }

    // le rebond : la vitesse d'approche d'avant le pas revient, réduite, aux points qui ont vraiment été touchés
    function bounce() {
      if (W.bounce <= 0) return;
      for (var i = 0; i < live.length; i++) {
        var c = live[i];
        for (var k = 0; k < c.np; k++) {
          var q = c.p[k];
          if (q.rv > -REST || q.mj === 0) continue;
          var dvx = c.b.vx - c.b.w * q.by - c.a.vx + c.a.w * q.ay;
          var dvy = c.b.vy + c.b.w * q.bx - c.a.vy - c.a.w * q.ax;
          var nn  = Math.max(0, q.jn - q.nm * (dvx * c.nx + dvy * c.ny + W.bounce * q.rv));
          var lam = nn - q.jn;
          q.jn = nn;
          give(c.a, c.b, q, lam * c.nx, lam * c.ny);
        }
      }
    }

    // les ressorts du pas : la souris qui tient un corps, le rappel de float (position et angle), le fil de
    // hang (il ne fait que tirer, et seulement tendu)
    function prepareSprings() {
      spring.length = 0;
      var g = W.grabbed;
      if (g && !g.b.fixed) aim(g.b, g, g.lx, g.ly, g.tx, g.ty, GRAB_A);
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b.frozen || b.fixed) continue;
        if (b.sp) aim(b, b.sp, 0, 0, b.hx, b.hy + b.sp.oy, 0);
        if (b.asp) {
          b.asp.b    = b;
          b.asp.kind = 2;
          b.asp.err  = Math.atan2(b.sn, b.cs);
          b.asp.j    = 0;
          spring.push(b.asp);
        }
        if (b.rope) tether(b, b.rope);
      }
    }

    // le ressort de rappel du point (lx, ly) du corps vers (tx, ty), son effort borné à maxA px/s² (0 : sans borne)
    function aim(b, j, lx, ly, tx, ty, maxA) {
      j.b    = b;
      j.kind = 1;
      j.rx   = b.cs * lx - b.sn * ly;
      j.ry   = b.sn * lx + b.cs * ly;
      j.ex   = b.x + j.rx - tx;
      j.ey   = b.y + j.ry - ty;
      j.jx   = 0;
      j.jy   = 0;
      j.cap  = maxA > 0 ? maxA * STEP / b.im : Infinity;
      spring.push(j);
    }

    function tether(b, j) {
      var rx  = b.cs * j.lx - b.sn * j.ly;
      var ry  = b.sn * j.lx + b.cs * j.ly;
      var ux  = b.x + rx - j.ax;
      var uy  = b.y + ry - j.ay;
      var len = Math.sqrt(ux * ux + uy * uy);
      if (len <= j.rest || len < 1e-6) return;
      j.b    = b;
      j.kind = 3;
      j.rx   = rx;
      j.ry   = ry;
      j.ux   = ux / len;
      j.uy   = uy / len;
      j.err  = len - j.rest;
      j.j    = 0;
      spring.push(j);
    }

    function solveSprings() {
      for (var i = 0; i < spring.length; i++) {
        var j = spring[i];
        if (j.kind === 1) {
          j.jx = axis(j.b, j.rx, j.ry, 1, 0, j.ex, j.soft, j.jx, -j.cap, j.cap);
          j.jy = axis(j.b, j.rx, j.ry, 0, 1, j.ey, j.soft, j.jy, -j.cap, j.cap);
        }
        else if (j.kind === 3) j.j = axis(j.b, j.rx, j.ry, j.ux, j.uy, j.err, j.soft, j.j, -Infinity, 0);
        else j.j = twist(j.b, j.err, j.soft, j.j);
      }
    }

    // la souris passe sur le conteneur (float) : chaque corps à portée est repoussé, d'autant plus fort qu'elle
    // est près, en un point de sa surface (il tourne s'il est touché de côté)
    function nudge() {
      var p = W.pointer;
      if (!p || W.push <= 0) return;
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b.fixed || b.frozen) continue;
        var gap = closest(b, p.x, p.y) - b.r;
        if (gap >= W.push) continue;
        var f  = 1 - Math.max(gap, 0) / W.push;
        var dv = NUDGE_A * f * f * STEP;
        var dx = CQ.x - p.x;
        var dy = CQ.y - p.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < 1e-6) {
          dx = b.x - p.x;
          dy = b.y - p.y;
          dd = Math.sqrt(dx * dx + dy * dy);
          if (dd < 1e-6) {
            dx = 0;
            dy = -1;
            dd = 1;
          }
        }
        var ux = dx / dd;
        var uy = dy / dd;
        var ax = CQ.x - ux * b.r - b.x;
        var ay = CQ.y - uy * b.r - b.y;
        b.vx += ux * dv;
        b.vy += uy * dv;
        b.w  += b.ii * (ax * uy - ay * ux) * dv / b.im;
      }
    }

    // un corps qui sort d'un bord par un pas trop grand est ramené à DEEP px de profondeur
    function contain(b) {
      for (var j = 0; j < edges.length; j++) {
        var wl = edges[j];
        var s  = Infinity;
        for (var i = 0; i < b.n; i++) s = Math.min(s, (b.wx[i] - wl.px) * wl.nx + (b.wy[i] - wl.py) * wl.ny - b.r);
        if (s >= -DEEP) continue;
        b.x += wl.nx * (-DEEP - s);
        b.y += wl.ny * (-DEEP - s);
        var vn = b.vx * wl.nx + b.vy * wl.ny;
        if (vn < 0) {
          b.vx -= vn * wl.nx;
          b.vy -= vn * wl.ny;
        }
        sync(b);
      }
    }

    // un pas de 1/120 s : contacts, vitesses, passes de résolution, positions, détente, rebond, sommeil
    W.step = function() {
      if (W.asleep) return;
      // sans corps, rien à simuler : le monde dort (une boucle qui n'a rien à faire s'arrête)
      if (bodies.length === 0) return W.sleep();
      var i;
      var b;
      collideAll();
      prepare();
      prepareSprings();
      nudge();
      var air = 1 / (1 + STEP * (W.mode === 'hang' ? HANG_AIR : AIR));
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (b.fixed || b.frozen) continue;
        b.vy += W.gravity * STEP;
        b.vx *= air;
        b.vy *= air;
        b.w  /= 1 + STEP * (SPIN_AIR + (b.touch ? ROLL_AIR : 0));
        var sp = b.vx * b.vx + b.vy * b.vy;
        if (sp > MAXV * MAXV) {
          sp   = MAXV / Math.sqrt(sp);
          b.vx *= sp;
          b.vy *= sp;
        }
      }
      warm();
      // les passes vont tantôt dans un sens, tantôt dans l'autre : le poids d'une pile descend dès la première
      for (i = 0; i < PASSES; i++) {
        solveSprings();
        solve(true, i & 1);
      }
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (b.fixed || b.frozen) continue;
        b.x += b.vx * STEP;
        b.y += b.vy * STEP;
        b.a += b.w * STEP;
        sync(b);
        contain(b);
        if (b.x < -FAR || b.x > W.width + FAR || b.y < -FAR || b.y > W.height + FAR) {
          b.frozen = true;
          b.vx     = b.vy = b.w = 0;
        }
      }
      for (i = 0; i < SETTLES; i++) solve(false, i & 1);
      bounce();
      var still = !W.grabbed;
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (b.fixed || b.frozen) continue;
        var wv = b.w * b.br;
        if (b.vx * b.vx + b.vy * b.vy + wv * wv > SLEEP_V * SLEEP_V) still = false;
      }
      if (!still) W.calm = 0;
      else {
        W.calm += STEP;
        if (W.calm >= SLEEP_T) W.sleep();
      }
      // des corps qui ne peuvent se ranger se repoussent sans fin : sans geste, ils se figent où ils sont au bout de
      // sleepAfter secondes (une saisie en cours est un geste qui dure ; 0 = jamais)
      if (W.grabbed) W.awake = 0;
      else W.awake += STEP;
      if (W.sleepAfter > 0 && W.awake >= W.sleepAfter) W.sleep();
    };

    edges = wallList();
    return W;
  }

  var ENGINE = { world: makeWorld, step: STEP, gravity: G0, awake: AWAKE_T };

  // ----- l'effet : les enfants du conteneur dans le monde -----
  var DFLT = { gravity: 1, bounce: 0.5, friction: 0.3, drag: true, walls: 'all', strength: 0.3, length: 100, push: 140, sleep: AWAKE_T * 1000 };

  // le délai de `sleep` (une durée CSS ; absent ou illisible : le défaut, 30 s) en secondes, l'unité du moteur
  function seconds(v) {
    return µ._mjs_fxMs(v, DFLT.sleep) / 1000;
  }

  µ._mjs_fxDefs.physics = {
    css: '[mjs-fx~="physics"]>[mjs-fx-physics-body]{transform-origin:50% 50%}'
      + '[mjs-fx~="physics"][mjs-fx-physics-run]>[mjs-fx-physics-body]{will-change:translate,rotate}'
      + ':where([mjs-fx~="physics"][mjs-fx-physics-drag])>[mjs-fx-physics-body]{cursor:grab}'
      + '[mjs-fx~="physics"][mjs-fx-physics-held]{cursor:grabbing;-webkit-user-select:none;user-select:none}'
      + '[mjs-fx~="physics"][mjs-fx-physics-hang]{isolation:isolate}'
      // le calque et les fils sont à nous : une règle de l'auteur sur `span`, `i` ou sur toutes les balises du bac (`*`, `> *`, `:last-child`) ne doit ni les déplacer ni les habiller.
      // Leurs balises n'ont pas de nom qu'une règle vise par son type, et leur géométrie est en `!important` : marge, remplissage, cadre, contour, ombre, rayon, transition
      + '[mjs-fx~="physics"]>[mjs-fx-layer="physics"]{position:absolute!important;inset:0 auto auto 0!important;display:block!important;width:0!important;height:0!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;outline:0!important;box-shadow:none!important;overflow:visible!important;translate:none!important;rotate:none!important;scale:none!important;transform:none!important;pointer-events:none!important;z-index:-1!important}'
      + '[mjs-fx~="physics"]>[mjs-fx-layer="physics"]>mjsfxcord{position:absolute!important;inset:0 auto auto 0!important;display:block!important;width:1px!important;height:1px!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;outline:0!important;box-shadow:none!important;translate:none!important;rotate:none!important;scale:none!important;transition-property:none!important;background:var(--mjs-physics-color,currentColor)!important;transform-origin:0 0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + '[mjs-fx~="physics"][mjs-fx-physics-run]>[mjs-fx-layer="physics"]>mjsfxcord{will-change:transform}'
      // contraste forcé : un arrière-plan y est remplacé par la couleur du fond (le fil s'effacerait), sauf une couleur système : le fil prend celle du texte du thème
      + '@media (forced-colors:active){[mjs-fx~="physics"]>[mjs-fx-layer="physics"]>mjsfxcord{background:CanvasText!important}}',
    vars: { color: '' },
    engine: ENGINE,
    setup: function(el, s) {
      // « réduire les animations » : rien ne bouge, la mise en page d'origine reste
      if (µ._mjs_fxCalm()) return function() {};
      var mode  = /^(fall|float|hang)$/.test(s.mode) ? s.mode : 'fall';
      // sans pesanteur par défaut en float ; les autres réglages ont les mêmes valeurs partout
      var dflt    = function(k) { return k === 'gravity' && mode === 'float' ? 0 : DFLT[k]; };
      var pick    = function(k) { return s[k] === void 0 ? dflt(k) : s[k]; };
      var cfg     = { mode: mode, gravity: pick('gravity'), bounce: pick('bounce'), friction: pick('friction'), walls: pick('walls'), strength: pick('strength'), length: pick('length'), push: mode === 'float' ? pick('push') : 0, sleep: seconds(pick('sleep')) };
      var on      = s.on || 'view';
      var spin    = s.spin === void 0 ? true : s.spin;
      var drag    = pick('drag');
      var restore = µ._mjs_fxRelative(el);
      var world   = null;
      var kids    = [];
      var layer   = null;
      var origin  = { x: 0, y: 0, ok: false };
      var undo    = [];
      var scrolls = [];
      var started = false;
      var seen    = typeof IntersectionObserver !== 'function';
      var hidden  = typeof document !== 'undefined' && document.hidden === true;
      var raf     = 0;
      var last    = 0;
      var acc     = 0;
      var down    = null;
      var swallow = null;
      var warned  = false;
      var gone    = false;
      var late    = 0;
      var redo    = 0;
      var ro      = null;
      var mo      = null;
      var io      = null;
      var each    = function(ev, f) {
        µ._mjs_dom.addEventListener(el, ev, f);
        undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
      };
      var flag    = function(name, yes) {
        if (yes) µ._mjs_dom.setAttribute(el, name, '');
        else µ._mjs_dom.removeAttribute(el, name);
      };

      // chaque enfant reprend sa place d'origine : ses styles d'avant, sa marque, ses fils
      var free = function() {
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          k.el.style.translate   = k.t0;
          k.el.style.rotate      = k.r0;
          k.el.style.touchAction = '';
          µ._mjs_dom.removeAttribute(k.el, 'mjs-fx-physics-body');
          k.movable();
        }
        kids = [];
        if (layer) {
          layer.remove();
          layer = null;
        }
      };

      // l'état de départ est un équilibre : float et hang attendent un geste, fall attend son départ ; sans enfant,
      // il n'y a rien à faire
      var rests = function() {
        return !started || kids.length === 0 || (mode !== 'fall' && kids.some(function(k) { return !!(k.body.sp || k.body.rope); }));
      };

      // la mise en page d'origine : UNE lecture du conteneur, puis de chaque enfant
      var layout = function() {
        free();
        var list = [];
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
          if (µ._mjs_dom.hasAttribute(c, 'mjs-fx-layer') || /^(script|style|template)$/.test(c.localName)) continue;
          list.push(c);
        }
        var movs = list.map(function(c) { return µ._mjs_fxMovable(c); });
        var cr   = µ._mjs_dom.getBoundingClientRect(el);
        var cw   = el.clientWidth;
        var ch   = el.clientHeight;
        var ox   = cr.left + el.clientLeft;
        var oy   = cr.top + el.clientTop;
        origin.x  = ox;
        origin.y  = oy;
        origin.ok = true;
        var max   = µ._mjs_fxCount(60);
        world     = ENGINE.world({ width: cw, height: ch });
        var n = 0;
        for (var i = 0; i < list.length; i++) {
          var e  = list[i];
          var r  = µ._mjs_dom.getBoundingClientRect(e);
          var cs = getComputedStyle(e);
          // la taille se lit dans la boîte de mise en page, que l'enfant (transform, rotate, scale) ou un ancêtre soit
          // transformé : le rectangle, transformé lui, ne sert (avec ses décimales) que s'il s'y accorde à 1 px près
          var ow = e.offsetWidth;
          var oh = e.offsetHeight;
          var w  = Math.abs(r.width - ow) <= 1 ? r.width : ow || r.width;
          var h  = Math.abs(r.height - oh) <= 1 ? r.height : oh || r.height;
          if (!(w > 0) || !(h > 0)) {
            movs[i]();
            continue;
          }
          // le plus petit des arrondis des quatre coins (un pourcentage se prend sur le côté qu'il mesure)
          var rad = 1e9;
          var cor = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
          for (var q = 0; q < 4; q++) {
            var parts = String(cor[q]).split(' ');
            for (var p = 0; p < parts.length; p++) {
              var v = parseFloat(parts[p]) || 0;
              rad = Math.min(rad, /%$/.test(parts[p]) ? v / 100 * (p === 0 ? w : h) : v);
            }
          }
          var kid = { el: e, t0: e.style.translate, r0: e.style.rotate, movable: movs[i], ow: ow, oh: oh, dx: 0, dy: 0, da: 0, body: null, cord: null };
          kid.body = world.add({ x: r.left + r.width / 2 - ox, y: r.top + r.height / 2 - oy, w: w, h: h, radius: rad === 1e9 ? 0 : rad, spin: spin, fixed: n >= max });
          n++;
          µ._mjs_dom.setAttribute(e, 'mjs-fx-physics-body', '');
          kids.push(kid);
        }
        world.config(cfg);
        world.asleep = rests();
        if (mode === 'hang') strings();
        watchSizes();
        go();
      };

      // un fil : une balise d'1 px de côté, couchée sur le segment qui va de l'accroche (fixe) au point d'attache du corps
      // par une seule matrice (rien d'autre n'est écrit, rien n'est relu) : tournée, étirée en long, épaissie à ROPE, plus
      // longue de CAP à chaque bout (les bouts arrondis d'un trait) et inclinée de TILT (l'écart au bout : moins de 0,02 px)
      var tie = function(k) {
        var b   = k.body;
        var r   = b.rope;
        var dx  = b.x + b.cs * r.lx - b.sn * r.ly - r.ax;
        var dy  = b.y + b.sn * r.lx + b.cs * r.ly - r.ay;
        var len = Math.sqrt(dx * dx + dy * dy);
        var ux  = len > 0 ? dx / len : 0;
        var uy  = len > 0 ? dy / len : 1;
        var vx  = ux - TILT * uy;
        var vy  = uy + TILT * ux;
        var tot = len + 2 * CAP;
        k.cord.style.transform = 'matrix(' + (-ROPE * vy).toFixed(4) + ',' + (ROPE * vx).toFixed(4) + ',' + (tot * vx).toFixed(3) + ',' + (tot * vy).toFixed(3) + ',' + (r.ax + ROPE / 2 * vy - CAP * vx).toFixed(3) + ',' + (r.ay - ROPE / 2 * vx - CAP * vy).toFixed(3) + ')';
      };

      // les fils de `hang` : un calque sans taille, un fil par corps (une balise, déplacée par `transform` seulement, quand
      // le corps bouge). Leurs balises, `mjsfxlayer` et `mjsfxcord`, ne sont celles d'aucune règle de l'auteur (`span`, `i`) ; sans tiret dans leur
      // nom : le bouclier du cœur cache (`display:none`) toute balise à tiret qui n'est pas définie
      var strings = function() {
        layer = document.createElement('mjsfxlayer');
        layer.setAttribute('mjs-fx-layer', 'physics');
        layer.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (!k.body.rope) continue;
          k.cord = document.createElement('mjsfxcord');
          layer.appendChild(k.cord);
          tie(k);
        }
        // en dernier : les `:nth-child` et `:first-child` de l'auteur gardent leurs enfants ; derrière eux (z-index
        // négatif, la balise isolée) : un corps qui passe cache le fil
        µ._mjs_dom.appendChild(el, layer);
      };

      // les poses du monde dans la mise en page : `translate` et `rotate`, seulement pour ce qui a bougé
      var draw = function() {
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          var b = k.body;
          if (b.fixed) continue;
          var dx = b.x - b.hx;
          var dy = b.y - b.hy;
          if (Math.abs(dx - k.dx) < 0.01 && Math.abs(dy - k.dy) < 0.01 && Math.abs(b.a - k.da) < 0.0002) continue;
          k.dx                 = dx;
          k.dy                 = dy;
          k.da                 = b.a;
          k.el.style.translate = dx.toFixed(2) + 'px ' + dy.toFixed(2) + 'px';
          k.el.style.rotate    = b.a.toFixed(4) + 'rad';
          if (k.cord) tie(k);
        }
      };

      // la boucle : une seule, qui s'arrête d'elle-même quand tout dort, hors écran, onglet caché
      var frame = function(now) {
        raf  = 0;
        acc  += last ? Math.min((now - last) / 1000, 0.05) : STEP;
        last = now;
        var n = 0;
        while (acc >= STEP && n < 4) {
          world.step();
          acc -= STEP;
          n++;
        }
        if (acc > STEP) acc = 0;
        draw();
        if (world.asleep || !started || !seen || hidden) {
          flag('mjs-fx-physics-run', false);
          return;
        }
        raf = requestAnimationFrame(frame);
      };

      var go = function() {
        var run = !gone && started && seen && !hidden && !!world && !world.asleep;
        if (run && !raf) {
          last = 0;
          acc  = 0;
          flag('mjs-fx-physics-run', true);
          raf = requestAnimationFrame(frame);
        }
        else if (!run && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          flag('mjs-fx-physics-run', false);
        }
      };

      var wake = function() {
        if (!world) return;
        world.wake();
        go();
      };

      // la souris dans le repère du conteneur : son origine est lue au premier geste, relue après un défilement
      var stale = function() { origin.ok = false; };
      var point = function(e) {
        if (!origin.ok) {
          var r = µ._mjs_dom.getBoundingClientRect(el);
          origin.x  = r.left + el.clientLeft;
          origin.y  = r.top + el.clientTop;
          origin.ok = true;
        }
        return { x: e.clientX - origin.x, y: e.clientY - origin.y };
      };

      // un défilement ne se suit que pendant que la souris est sur le conteneur
      var watch = function(yes) {
        if (yes && scrolls.length === 0) {
          var root = µ._mjs_dom.getRootNode(el);
          scrolls.push(window);
          if (root && root.nodeType === 11) scrolls.push(root);
          for (var i = 0; i < scrolls.length; i++) scrolls[i].addEventListener('scroll', stale, { capture: true, passive: true });
          origin.ok = false;
        }
        else if (!yes) {
          for (var j = 0; j < scrolls.length; j++) scrolls[j].removeEventListener('scroll', stale, { capture: true });
          scrolls = [];
        }
      };

      var kidAt = function(t) {
        while (t && t.parentNode !== el) t = t.parentNode;
        if (t) for (var i = 0; i < kids.length; i++) {
          if (kids[i].el === t) return kids[i];
        }
        return null;
      };

      // le geste est fini : le corps est lâché (il garde sa vitesse), et le clic qui suit un vrai déplacement
      // n'est pas pour la balise
      var finish = function() {
        if (!down) return;
        var d = down;
        down                       = null;
        d.kid.el.style.touchAction = '';
        if (!d.live) return;
        world.release();
        flag('mjs-fx-physics-held', false);
        try {
          µ._mjs_dom.releasePointerCapture(el, d.id);
        }
        catch (e) {}
        swallow = function(ev) {
          ev.stopPropagation();
          ev.preventDefault();
        };
        µ._mjs_dom.addEventListener(el, 'click', swallow, true);
        setTimeout(function() { µ._mjs_dom.removeEventListener(el, 'click', swallow, true); }, 0);
        go();
      };

      var press = function(e) {
        if (!drag || !started || !world || (e.pointerType === 'mouse' && e.button !== 0)) return;
        // un seul geste à la fois : un second pointeur (un autre doigt, un doigt pendant que la souris tient un corps) ne prend pas le corps
        // tenu ; un appui resté sans suite cède la place, et rend à son corps le défilement tactile
        if (down && down.live) return;
        finish();
        var k = kidAt(e.target);
        if (!k || k.body.fixed) return;
        // un corps saisi n'est pas repris par le défilement tactile : touch-action le dit dès le toucher
        k.el.style.touchAction = 'none';
        var p = point(e);
        down = { id: e.pointerId, kid: k, cx: e.clientX, cy: e.clientY, wx: p.x, wy: p.y, live: false };
      };

      var move = function(e) {
        // un appui fini hors du conteneur, où son lâcher n'est pas venu : le survol qui suit, sans bouton, ne le reprend pas
        if (down && !down.live && e.pointerId === down.id && !e.buttons) finish();
        if (down && e.pointerId === down.id) {
          var p = point(e);
          if (!down.live) {
            var ddx = e.clientX - down.cx;
            var ddy = e.clientY - down.cy;
            // un simple clic (moins de 5 px) reste un clic : la balise le reçoit
            if (ddx * ddx + ddy * ddy < 25) return;
            down.live = true;
            var l = world.local(down.kid.body, down.wx, down.wy);
            world.grab(down.kid.body, l.x, l.y, p.x, p.y);
            µ._mjs_dom.setPointerCapture(el, e.pointerId);
            flag('mjs-fx-physics-held', true);
            var sel = typeof getSelection === 'function' ? getSelection() : null;
            if (sel && sel.removeAllRanges) sel.removeAllRanges();
          }
          world.pull(p.x, p.y);
          go();
          return;
        }
        if (!started || !world || mode !== 'float' || !(world.push > 0) || e.pointerType === 'touch') return;
        var q = point(e);
        world.pointer = q;
        if (world.near(q.x, q.y)) wake();
      };

      // la perte de capture d'un enfant, qui remonte jusqu'ici, n'est pas la fin du geste : au doigt, c'est la capture implicite de
      // l'enfant touché qui cède la place à celle du conteneur
      var up    = function(e) { if (down && e.pointerId === down.id && (e.type !== 'lostpointercapture' || e.target === el)) finish(); };
      var enter = function() { watch(true); };
      var leave = function() {
        if (down && down.live) return;
        watch(false);
        if (world) world.pointer = null;
      };

      // le conteneur ou un enfant change de taille, un enfant arrive ou part : la simulation repart de la mise en page
      var again = function() {
        if (gone) return;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        flag('mjs-fx-physics-run', false);
        finish();
        layout();
      };

      // le conteneur et chaque enfant : relus à chaque mise en page (les enfants ne sont plus les mêmes)
      var watchSizes = function() {
        if (!ro) return;
        ro.disconnect();
        ro.observe(el);
        for (var i = 0; i < kids.length; i++) ro.observe(kids[i].el);
      };
      var resized = function() {
        if (el.clientWidth !== world.width || el.clientHeight !== world.height) return true;
        for (var i = 0; i < kids.length; i++) {
          if (Math.abs(kids[i].el.offsetWidth - kids[i].ow) > 1.5 || Math.abs(kids[i].el.offsetHeight - kids[i].oh) > 1.5) return true;
        }
        return false;
      };

      flag('mjs-fx-physics-drag', drag);
      flag('mjs-fx-physics-hang', mode === 'hang');
      each('pointerdown', press);
      each('pointerup', up);
      each('pointercancel', up);
      each('lostpointercapture', up);
      each('pointermove', move);
      // le glisser-déposer natif d'un lien ou d'une image prendrait le geste (le pointeur serait annulé) : le corps est saisi à la place
      each('dragstart', function(e) { if (drag && kidAt(e.target)) e.preventDefault(); });
      each('pointerenter', enter);
      each('pointerleave', leave);
      // la mise en page ne se refait pas dans le rappel de l'observateur : elle réécrit des boîtes qu'il suit, et le navigateur signale des notifications non livrées (erreur de la page) ; elle se refait à l'image suivante
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(function() {
          if (!world || redo) return;
          redo = requestAnimationFrame(function() {
            redo = 0;
            if (world && resized()) again();
          });
        });
      }
      if (typeof MutationObserver === 'function') {
        mo = new MutationObserver(function(list) {
          for (var i = 0; i < list.length; i++) {
            var nodes = Array.prototype.slice.call(list[i].addedNodes).concat(Array.prototype.slice.call(list[i].removedNodes));
            for (var j = 0; j < nodes.length; j++) {
              if (nodes[j].nodeType === 1 && !µ._mjs_dom.hasAttribute(nodes[j], 'mjs-fx-layer')) return again();
            }
          }
        });
        mo.observe(el, { childList: true });
      }
      layout();
      if (typeof IntersectionObserver === 'function') {
        io = new IntersectionObserver(function(entries) {
          seen = entries[entries.length - 1].isIntersecting;
          go();
        });
        io.observe(el);
      }
      var vis = function() {
        hidden = document.hidden === true;
        go();
      };
      document.addEventListener('visibilitychange', vis);

      var stopWhen = µ._mjs_fxWhen(el, on, function() {
        if (started) return;
        started = true;
        if (!rests()) world.wake();
        go();
        // une balise sans hauteur : rien ne peut tomber. Dit une fois, un peu après le départ (la feuille de
        // style peut arriver après la pose)
        late = setTimeout(function() {
          if (gone || warned || el.clientHeight > 0) return;
          warned = true;
          µ.warn(µ._mjs_msg('physicsHeight', null, '*physics : la balise n\'a pas de hauteur — rien ne peut tomber. Donnez-lui une hauteur (height ou min-height).'), el);
        }, 500);
      });

      var off = function() {
        gone = true;
        clearTimeout(late);
        stopWhen();
        finish();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (redo) cancelAnimationFrame(redo);
        if (ro) ro.disconnect();
        if (mo) mo.disconnect();
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', vis);
        watch(false);
        for (var i = undo.length - 1; i >= 0; i--) undo[i]();
        free();
        flag('mjs-fx-physics-run', false);
        flag('mjs-fx-physics-drag', false);
        flag('mjs-fx-physics-hang', false);
        flag('mjs-fx-physics-held', false);
        restore();
      };

      // les réglages tenus par une variable, suivis sans reposer l'effet : la mise en page ne se relit pas ;
      // mode, spin et on repartent de zéro (rendre false), comme la raideur, la longueur et la pesanteur de hang
      off.set = function(k, v) {
        if (!world || !Object.prototype.hasOwnProperty.call(DFLT, k)) return false;
        var val = v === void 0 ? dflt(k) : v;
        if (k === 'drag') {
          drag = val;
          flag('mjs-fx-physics-drag', drag);
          return;
        }
        if (k === 'push' && mode !== 'float') return;
        // les fils de hang sont dessinés d'après leur accroche et leur longueur : ces réglages repartent de la mise en page
        if (mode === 'hang' && (k === 'strength' || k === 'length' || k === 'gravity')) return false;
        // gardé aussi dans cfg : une remise en page refait le monde d'après cfg, la valeur reçue ici doit y survivre
        var c = {};
        c[k] = cfg[k] = k === 'sleep' ? seconds(val) : val;
        world.config(c);
        if (started) wake();
        else world.asleep = true;
      };
      return off;
    }
  };
})();
