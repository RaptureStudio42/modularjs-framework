// mjs_fx_matrix — `*matrix` : une pluie de caractères au fond de la balise, sous son contenu (une
// toile, dans le composant si la balise en est un). Chaque colonne active (ou ligne, si la pluie va
// de côté) avance d'un caractère à chaque pas ; la tête est d'une autre couleur ; un voile
// transparent posé à chaque pas efface la traîne. Réglages : color (principal : la couleur de la
// pluie ; #00ff66), head (la couleur du caractère de tête ; #e9fff1), background (le fond de la
// toile ; #000), speed (de 1 à 10 : 6 + 3 × speed pas par seconde ; 5), density (de 1 à 10 : la part
// des colonnes actives, en dixièmes ; 6), size (la taille des caractères en px ; 15), chars (ses
// propres caractères ; katakana demi-chasse et chiffres), trail (l'opacité du voile posé à chaque
// pas, de 0.01 = traîne longue à 0.5 = courte ; 0.06), direction (down, up, left, right ; down),
// opacity (de la toile, de 0 à 1 ; 1), on (always, hover : la pluie ne tombe qu'au survol, view :
// tant que la balise est à l'écran ; always). Les couleurs acceptent toute couleur CSS, variables
// comprises (le navigateur la lit). La toile suit la taille de la balise (densité d'écran bornée à
// 2) ; la boucle s'arrête hors écran et onglet caché ; « réduire les animations » : une image fixe.

µ._mjs_fxDefs.matrix = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx~="matrix"]{isolation:isolate}'
    + '[mjs-fx-layer="matrix"]{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--mjs-matrix-background,#000);opacity:var(--mjs-matrix-opacity,1)}',
  vars: { color: '', head: '', background: '', opacity: '' },
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'matrix');
    var restore = µ._mjs_fxRelative(el);
    var cv = document.createElement('canvas');
    cv.setAttribute('mjs-fx-layer', 'matrix');
    cv.setAttribute('aria-hidden', 'true');
    µ._mjs_dom.insertBefore(host, cv, host.firstChild);
    var trail = typeof s.trail === 'number' ? s.trail : 0.06;
    // une longue traîne relit sa toile (cf. sweep) : ouverte pour des lectures fréquentes, gardée en mémoire du processeur (sans
    // avertissement de Chromium ni bande rapatriée du processeur graphique à chaque lecture) ; sinon, le rendu par défaut
    var ctx   = cv.getContext && cv.getContext('2d', { willReadFrequently: trail < 0.05 });
    var T     = typeof s.size === 'number' ? s.size : 15;
    var dir   = /^(down|up|left|right)$/.test(s.direction) ? s.direction : 'down';
    var side  = dir === 'left' || dir === 'right';
    var share = (typeof s.density === 'number' ? s.density : 6) / 10;
    var sps   = 6 + 3 * (typeof s.speed === 'number' ? s.speed : 5);
    var chars = Array.from(s.chars || 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789');
    // les couleurs, lues par le navigateur (une variable CSS, color-mix… deviennent un rgb)
    var raw = { color: s.color, head: s.head };
    var col = '#00ff66';
    var hd  = '#e9fff1';
    var lis = function(v) {
      cv.style.color = '';
      cv.style.color = v;
      var out = cv.style.color && typeof getComputedStyle === 'function' ? getComputedStyle(cv).color : '';
      cv.style.color = '';
      return out || v;
    };
    var relit = function() {
      col = lis(raw.color || µ._mjs_fxCss(el, '--mjs-matrix-color') || '#00ff66');
      hd  = lis(raw.head || µ._mjs_fxCss(el, '--mjs-matrix-head') || '#e9fff1');
    };
    var W = 0, H = 0, dpr = 1, lanes = 0, len = 0, heads = [], live = [];
    var raf = 0, seen = true, hot = s.on !== 'hover', acc = 0, last = 0, since = 0, strip = 0, nstep = 0;
    var pick = function() { return chars[Math.floor(Math.random() * chars.length)]; };
    // la cellule (colonne `i`, rang `j` le long de la chute) → le coin en haut à gauche, à l'écran
    var at = function(i, j) {
      if (dir === 'down') return [i * T, j * T];
      if (dir === 'up') return [i * T, H - (j + 1) * T];
      if (dir === 'right') return [j * T, i * T];
      return [W - (j + 1) * T, i * T];
    };
    var put = function(i, j, color, clear) {
      var p = at(i, j);
      if (clear) ctx.clearRect(p[0], p[1], T, T);
      ctx.fillStyle = color;
      ctx.fillText(pick(), p[0] + T / 2, p[1] + T / 2 + 1);
    };
    var step = function() {
      // le voile : il rend la toile transparente d'un cran (le fond CSS reparaît)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = trail;
      ctx.fillStyle   = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (var i = 0; i < lanes; i++) {
        if (!live[i]) continue;
        var j = heads[i];
        if (j > 0) put(i, j - 1, col, true);
        put(i, j, hd, true);
        heads[i] = j * T > (side ? W : H) && Math.random() > 0.96 ? 0 : j + 1;
      }
      nstep++;
      if (trail < 0.05 && nstep % 2 === 0) sweep();
    };
    // les pixels que le voile n'efface plus (un alpha trop faible pour descendre d'un cran) : une
    // bande de la toile est reprise de temps en temps, ces restes s'éteignent
    var sweep = function() {
      if (!ctx.getImageData) return;
      var bands = 16;
      var h  = Math.max(1, Math.ceil(cv.height / bands));
      var y0 = (strip++ % bands) * h;
      if (y0 >= cv.height) return;
      var img = ctx.getImageData(0, y0, cv.width, Math.min(h, cv.height - y0));
      var d   = img.data;
      var lim = Math.min(255, Math.ceil(0.5 / trail));
      var cut = Math.max(1, Math.round(lim / 10));
      var changed = false;
      for (var k = 3; k < d.length; k += 4) {
        if (d[k] === 0 || d[k] > lim) continue;
        d[k] = Math.max(0, d[k] - cut);
        changed = true;
      }
      if (!changed) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(img, 0, y0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    // la toile à la taille de la balise : les colonnes recomptées, la pluie déjà installée à la première mesure. Une
    // notification de même taille (la première du ResizeObserver, toujours envoyée) ne refait rien ; un redimensionnement
    // garde la pluie déjà tombée (la toile recopiée, chaque colonne à son rang) au lieu de refaire son avance — des
    // dizaines de pas sur le fil principal, à chaque image tant qu'on étire la fenêtre
    var mesure = function() {
      if (!ctx) return;
      var w = cv.clientWidth || el.clientWidth || 0;
      var h = cv.clientHeight || el.clientHeight || 0;
      var d = Math.min(2, window.devicePixelRatio || 1);
      // sans taille (styles pas encore posés, balise cachée) : rien à installer, la notification de la vraie taille le fera
      if (!w || !h || (lanes && w === W && h === H && d === dpr)) return;
      var old = null;
      if (lanes && d === dpr) {
        old = document.createElement('canvas');
        old.width  = cv.width;
        old.height = cv.height;
        var oc = old.getContext && old.getContext('2d');
        if (oc) oc.drawImage(cv, 0, 0);
        else old = null;
      }
      var was = old ? heads : [];
      W   = w;
      H   = h;
      dpr = d;
      cv.width  = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font         = T + 'px ui-monospace, monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      lanes = Math.ceil((side ? H : W) / T);
      len   = Math.ceil((side ? W : H) / T);
      heads = [];
      live  = [];
      for (var i = 0; i < lanes; i++) {
        heads.push(i < was.length ? was[i] : Math.floor(Math.random() * len));
        // les colonnes actives se répartissent en suivant le nombre d'or : jamais en paquet
        live.push((i * 0.6180339) % 1 < share);
      }
      relit();
      if (old) {
        // la pluie déjà tombée, collée au bord d'où elle part (en bas pour up, à droite pour left)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(old, dir === 'left' ? cv.width - old.width : 0, dir === 'up' ? cv.height - old.height : 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      else {
        var pre = Math.min(250, Math.max(40, Math.round(3 / trail)));
        for (var n = 0; n < pre; n++) step();
      }
      go();
    };
    var tick = function(now) {
      raf = 0;
      if (!ctx || !seen || !hot || document.hidden || µ._mjs_fxCalm()) return;
      acc += Math.min(100, last ? now - last : 16);
      last = now;
      var dt = 1000 / sps;
      var n  = 0;
      if (now - since > 1500) {
        since = now;
        relit();
      }
      while (acc >= dt && n < 4) {
        acc -= dt;
        step();
        n++;
      }
      go();
    };
    var go = function() {
      if (raf || !ctx || !seen || !hot || µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') return;
      last = 0;
      raf  = requestAnimationFrame(tick);
    };
    var undo = [];
    var each = function(target, ev, f) {
      µ._mjs_dom.addEventListener(target, ev, f);
      undo.push(function() { µ._mjs_dom.removeEventListener(target, ev, f); });
    };
    mesure();
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(mesure) : null;
    if (ro) ro.observe(cv);
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(e) {
      seen = e[e.length - 1].isIntersecting;
      if (seen) go();
    }) : null;
    if (io) io.observe(el);
    each(document, 'visibilitychange', go);
    if (s.on === 'hover') {
      each(el, 'pointerenter', function() {
        hot = true;
        go();
      });
      each(el, 'pointerleave', function() { hot = false; });
    }
    var off = function() {
      for (var u = undo.length - 1; u >= 0; u--) undo[u]();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf  = 0;
      seen = false;
      hot  = false;
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      cv.remove();
      restore();
    };
    // une couleur tenue par une variable : sa variable CSS suit (le moteur), la pluie la relit ; les
    // autres réglages relancent l'effet
    off.set = function(k, v) {
      if (k === 'color' || k === 'head') {
        raw[k] = v;
        relit();
        return;
      }
      if (k === 'background' || k === 'opacity') return;
      return false;
    };
    return off;
  }
};
