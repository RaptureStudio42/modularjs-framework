// animations/iris.coffee — une ouverture qui grandit au centre (ou au point `origin`, [x, y] en fractions de la
// balise) et découvre la balise, jumeau « sur un élément » du rideau de page iris (mjs_vt_presets.ts)
// `shape` : circle (un rond), box (un rectangle), diamond (un losange), cross (une croix), ellipse (un ovale aux
// proportions de la balise) — les iris des logiciels de montage
// `origin: pointer` : le point où la souris a cliqué ou survolé en dernier, le centre sans geste connu ; hors de
// la balise, l'ouverture part du point de son bord le plus proche
//   le clic est noté dès le chargement de ce fichier : un seul écouteur `pointerdown`, passif et de capture, posé
//   une fois pour la page et qui ne travaille qu'à un clic (la balise naît dans le gestionnaire du clic, trop
//   tard pour l'attendre)
//   le survol l'est par un écouteur `pointermove` passif et de capture, posé à la première pose d'une balise qui
//   part du pointeur et retiré avec la dernière (un observateur de taille la voit quitter la page) : il travaille
//   à chaque mouvement de la souris, il n'existe donc que tant qu'une balise en a besoin ; un survol d'avant la
//   première pose n'est pas connu
// `start` (de 0 à 1) : l'ouverture de départ, en part de l'ouverture finale — 0.2, la fenêtre est déjà ouverte au
// cinquième
// `angle` (en degrés) : l'inclinaison de la fenêtre fermée, qu'elle perd en proportion de son ouverture et qui
// s'efface quand elle est toute ouverte — la forme est alors un polygone dont les points tournent autour de
// l'origine, dans le repère de l'écran (circle ne penche pas) : un rectangle penché de -11° qui part du cinquième
// et se redresse s'écrit box, start 0.2, angle -11 ; un ovale qui part de rien en se redressant de 8°, ellipse,
// angle 8
(function() {
  // le dernier point touché ou survolé de la page, lu par `origin: pointer` : { x, y } en px de la fenêtre, null
  // sans geste connu ; l'état est celui de la page (partagé si ce fichier est chargé deux fois) : le point, le
  // clic écouté (`down`), le survol écouté (`move`), les balises qui en ont besoin (`users`) et l'observateur
  // de taille qui les voit partir (`watch`)
  var last = µ._mjs_lastPointer || (µ._mjs_lastPointer = { x: null, y: null, down: false, move: false, users: new Set(), watch: null, note: null });
  var doc  = typeof document === 'object' && document && typeof document.addEventListener === 'function' ? document : null;
  var note = last.note || (last.note = function(e) {
    if (typeof e.clientX !== 'number' || !(e.clientX || e.clientY || e.detail > 0 || e.pointerType)) return;
    last.x = e.clientX;
    last.y = e.clientY;
  });
  if (doc && !last.down) {
    last.down = true;
    doc.addEventListener('pointerdown', note, { capture: true, passive: true });
  }
  // les balises parties de la page ne comptent plus ; plus aucune balise qui en ait besoin : le survol n'est plus
  // écouté, l'observateur de taille non plus
  var prune = function() {
    last.users.forEach(function(n) { if (n.isConnected === false) last.users.delete(n); });
    if (last.users.size > 0 || !last.move) return;
    doc.removeEventListener('pointermove', note, { capture: true });
    last.move = false;
    if (last.watch) last.watch.disconnect();
    last.watch = null;
  };
  // une balise qui part du pointeur : le survol est écouté tant qu'elle est dans la page
  var follow = function(node) {
    if (!doc || last.users.has(node)) return;
    prune();
    last.users.add(node);
    if (!last.move) {
      last.move = true;
      doc.addEventListener('pointermove', note, { capture: true, passive: true });
    }
    if (node.nodeType === 1 && typeof ResizeObserver === 'function') (last.watch || (last.watch = new ResizeObserver(prune))).observe(node);
  };
  return function(opts = {}) {
    var pct, setup, start, angle, tilted, shape;
    pct = function(v) {
      return Math.round(v * 1000) / 1000;
    };
    // l'ouverture de départ, en part de l'ouverture finale ; l'inclinaison de la fenêtre fermée
    start  = opts.start > 0 ? Math.min(1, opts.start) : 0;
    angle  = isFinite(opts.angle) ? +opts.angle : 0;
    tilted = angle !== 0;
    shape  = opts.shape;
    setup = function(node) {
      var ref, ref1, ref2, ref3, ox, oy, w, h, r, far, bw, bh, p, known, ends;
      if (opts.origin === 'pointer') follow(node);
      known = !!opts.origin && opts.origin !== 'pointer';
      ox = known ? opts.origin[0] : 0.5;
      oy = known ? opts.origin[1] : 0.5;
      // le rayon qui atteint le coin le plus loin du point d'origine, en % de circle() (la diagonale
      // divisée par √2) ; 72 % depuis le centre
      r = typeof node.getBoundingClientRect === 'function' ? (µ._mjs_dom ? µ._mjs_dom.getBoundingClientRect(node) : node.getBoundingClientRect()) : null;
      w = r && r.width > 0 ? r.width : 1;
      h = r && r.height > 0 ? r.height : 1;
      // `pointer` : le dernier point touché, pris dans la boîte de la balise ; sans geste connu, le centre ; un
      // point hors de la balise est ramené au point de son bord le plus proche (le coin au-delà d'un coin) :
      // partie de l'extérieur, l'ouverture ne montrerait rien pendant un bon quart de sa durée
      p = opts.origin === 'pointer' ? last : null;
      if (p && p.x !== null && r && r.width > 0 && r.height > 0) {
        ox = Math.min(1, Math.max(0, (p.x - r.left) / r.width));
        oy = Math.min(1, Math.max(0, (p.y - r.top) / r.height));
        known = true;
      }
      far = known ? Math.ceil(100 * Math.hypot(Math.max(ox, 1 - ox) * w, Math.max(oy, 1 - oy) * h) / Math.sqrt((w * w + h * h) / 2)) + 1 : 72;
      // l'ovale garde les proportions de la balise : son rayon est le même en % de la largeur et de la hauteur,
      // juste assez grand pour atteindre le coin le plus loin du point d'origine (72 % depuis le centre)
      ends = known ? Math.ceil(100 * Math.hypot(Math.max(ox, 1 - ox), Math.max(oy, 1 - oy))) + 1 : 72;
      // la boîte de la balise sans sa transformation, pour tourner les points en pixels (jamais en % : une
      // balise qui n'est pas carrée y déformerait la fenêtre penchée)
      bw = node.offsetWidth > 0 ? node.offsetWidth : w;
      bh = node.offsetHeight > 0 ? node.offsetHeight : h;
      return {
        delay: (ref = opts.delay) != null ? ref : 0,
        duration: (ref1 = opts.duration) != null ? ref1 : 380,
        easing: µ.easing.resolve((ref2 = opts.easing) != null ? ref2 : 'ease-out'),
        steps: (ref3 = opts.steps) != null ? ref3 : 60,
        // les images clés dépendent de la boîte de la balise : un polygone tourné en pixels, un point de la souris pris dans la boîte
        measured: (tilted && (shape === 'box' || shape === 'diamond' || shape === 'cross' || shape === 'ellipse')) || opts.origin === 'pointer',
        css: function(t, u) {
          // à t=1 la boîte entière est visible ; q : l'ouverture, de `start` à 1
          var q  = start ? start + (1 - start) * t : t;
          var mx = Math.max(ox, 1 - ox), my = Math.max(oy, 1 - oy);
          var pt = function(x, y) { return pct(x * 100) + '% ' + pct(y * 100) + '%'; };
          var a, b, wx, wy, c, d, pts, i, th, cs, sn, dx, dy, rad;
          if (shape === 'box' && !tilted) {
            return { clipPath: `inset(${pct((1 - q) * oy * 100)}% ${pct((1 - q) * (1 - ox) * 100)}% ${pct((1 - q) * (1 - oy) * 100)}% ${pct((1 - q) * ox * 100)}%)` };
          }
          if (shape === 'ellipse' && !tilted) {
            return { clipPath: `ellipse(${pct(q * ends)}% ${pct(q * ends)}% at ${pct(ox * 100)}% ${pct(oy * 100)}%)` };
          }
          if (shape === 'box') {
            a = (1 - q) * ox;
            b = (1 - q) * oy;
            c = 1 - (1 - q) * (1 - ox);
            d = 1 - (1 - q) * (1 - oy);
            pts = [[a, b], [c, b], [c, d], [a, d]];
          }
          else if (shape === 'diamond') {
            // demi-diagonales doublées : à t=1, le losange passe par les quatre coins
            a = 2 * q * mx;
            b = 2 * q * my;
            pts = [[ox - a, oy], [ox, oy - b], [ox + a, oy], [ox, oy + b]];
          }
          else if (shape === 'cross') {
            // bras longs de 2t, épais de t : à t=1, la croix couvre toute la boîte
            a = 2 * q * mx;
            b = 2 * q * my;
            wx = q * mx;
            wy = q * my;
            pts = [[ox - wx, oy - b], [ox + wx, oy - b], [ox + wx, oy - wy], [ox + a, oy - wy], [ox + a, oy + wy], [ox + wx, oy + wy], [ox + wx, oy + b], [ox - wx, oy + b], [ox - wx, oy + wy], [ox - a, oy + wy], [ox - a, oy - wy], [ox - wx, oy - wy]];
          }
          else if (shape === 'ellipse') {
            // un ovale penché : 96 points, le nombre ne change jamais d'une image à l'autre
            rad = q * ends / 100;
            pts = [];
            for (i = 0; i < 96; i++) pts.push([ox + rad * Math.cos(i * Math.PI / 48), oy + rad * Math.sin(i * Math.PI / 48)]);
          }
          else {
            return {
              clipPath: `circle(${pct(q * far)}% at ${pct(ox * 100)}% ${pct(oy * 100)}%)`
            };
          }
          if (tilted) {
            // la fenêtre fermée penche de `angle`, elle se redresse en s'ouvrant ; rotation autour de l'origine, en pixels
            th = angle * (1 - q) * Math.PI / 180;
            cs = Math.cos(th);
            sn = Math.sin(th);
            for (i = 0; i < pts.length; i++) {
              dx = (pts[i][0] - ox) * bw;
              dy = (pts[i][1] - oy) * bh;
              pts[i] = [ox + (dx * cs - dy * sn) / bw, oy + (dx * sn + dy * cs) / bh];
            }
          }
          return { clipPath: 'polygon(' + pts.map(function(v) { return pt(v[0], v[1]); }).join(', ') + ')' };
        }
      };
    };
    setup._isCfgFactory = true;
    return {
      intro: setup,
      outro: setup
    };
  };
})();
