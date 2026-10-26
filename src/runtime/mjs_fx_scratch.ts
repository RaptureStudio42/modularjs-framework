// mjs_fx_scratch — `*scratch` : une carte à gratter. Une toile posée par-dessus le contenu de la
// balise (dans le composant si la balise en est un) ; on la gratte à la souris ou au doigt (événements
// `pointer`, `touch-action: none`), le contenu apparaît dessous. Le contenu n'est PAS caché aux lecteurs
// d'écran : c'est un jeu visuel, la toile seule est cachée (`aria-hidden`) et ne prend pas le focus.
// Réglages : color (la couche à gratter ; #b9bec7), colors (un dégradé à la place), image (une image de
// couverture à la place : une adresse, ou `µimage('…')` ; la couche de couleur couvre le temps du
// chargement, et reste si l'image ne vient pas, avec un avertissement), text (un mot écrit sur la
// couche, « Grattez » par exemple ; aucun), ink (la couleur de ce mot ; #5b6270), brush (le diamètre
// du pinceau en px ; 28), shape (round, square ; round), threshold (la part grattée, de 0.05 à 1, à
// partir de laquelle le reste de la couche s'efface en fondu ; 0.6), duration (ce fondu ; 500ms),
// revealed (l'état, à tenir par une variable : vrai, tout est découvert ; repassé à faux, la couche
// revient ; faux), radius (l'arrondi de la balise et de la toile).
// Quand le seuil est atteint, la balise émet l'événement DOM `mjs:scratch` (il remonte, même hors d'un composant ;
// `detail: { part }`, la part grattée de 0 à 1) — une seule fois par couche : il repart après un retour
// de la couche. Le seuil se mesure sur un petit calque à part qui ne garde que le tracé du pinceau,
// jamais sur la toile : une image d'une autre origine, sans autorisation, rend la toile illisible, et
// le seuil se mesure pourtant. Sans toile 2D, la couche reste pleine (un aplat de la couleur) et
// seule `revealed` la découvre. La toile suit la taille de la balise (ResizeObserver, densité de
// l'écran) : une taille changée garde ce qui est gratté. Une couleur de `colors` que la toile ne sait
// pas lire est ignorée avec un avertissement (repli sur color si plus aucune ne reste).

µ._mjs_fxDefs.scratch = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  image: true,
  css: '[mjs-fx-layer="scratch"]{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1;border-radius:inherit;touch-action:none;cursor:crosshair}'
    + '[mjs-fx-layer="scratch"][mjs-fx-scratch-flat]{background:var(--mjs-fx-scratch-fill)}'
    + '[mjs-fx-layer="scratch"][mjs-fx-scratch-done]{opacity:0;pointer-events:none;transition:opacity var(--mjs-scratch-duration,500ms) ease}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="scratch"][mjs-fx-scratch-done]{transition:none}}',
  vars: { duration: '' },
  radius: true,
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'scratch');
    var restore = µ._mjs_fxRelative(el);
    var color   = s.color || '#b9bec7';
    var colors  = Array.isArray(s.colors) && s.colors.length > 0 ? s.colors : null;
    var word    = s.text || '';
    var ink     = s.ink || '#5b6270';
    var brush   = s.brush === void 0 ? 28 : s.brush;
    var shape   = s.shape || 'round';
    var limit   = s.threshold === void 0 ? 0.6 : s.threshold;
    var url     = µ._mjs_fxImage(s.image, el);
    var cv      = document.createElement('canvas');
    cv.setAttribute('mjs-fx-layer', 'scratch');
    cv.setAttribute('aria-hidden', 'true');
    var context = function(c, opts) {
      try {
        return c.getContext('2d', opts) || null;
      }
      catch {
        return null;
      }
    };
    var ctx     = context(cv);
    // une couleur que la toile ne sait pas lire est ignorée (un arrêt de dégradé illisible lève une exception) ; plus aucune : repli sur color
    if (colors && ctx) {
      var probe = ctx.createLinearGradient(0, 0, 1, 1);
      var good  = [];
      var bad   = [];
      for (var c = 0; c < colors.length; c++) {
        try {
          probe.addColorStop(0, colors[c]);
          good.push(colors[c]);
        }
        catch {
          bad.push(String(colors[c]));
        }
      }
      if (bad.length > 0) µ.warn(µ._mjs_msg('scratchColors', { what: (bad.length > 1 ? µ._mjs_txt('scratchBadMany', null, 'ces couleurs ne sont pas lisibles') : µ._mjs_txt('scratchBadOne', null, 'cette couleur n\'est pas lisible')), list: bad.join(', '), fate: (good.length > 0 ? (bad.length > 1 ? µ._mjs_txt('scratchIgnMany', null, 'elles sont ignorées') : µ._mjs_txt('scratchIgnOne', null, 'elle est ignorée')) : µ._mjs_txt('scratchIgnNone', null, 'la couche prend la couleur de color')) }, '*scratch : {what} ({list}), {fate} — donnez une couleur CSS valide dans colors.'), el);
      colors = good.length > 0 ? good : null;
    }
    // le tracé du pinceau seul, à petite échelle : sa part couverte est la part grattée
    var mk      = document.createElement('canvas');
    var mkc     = context(mk, { willReadFrequently: true });
    var W       = 0;
    var H       = 0;
    var done    = s.revealed === true;
    var told    = false;
    var touched = false;
    var down    = false;
    var last    = null;
    var who     = null;
    var frame   = 0;
    var gone    = false;
    var pic     = null;
    if (done) cv.setAttribute('mjs-fx-scratch-done', '');
    if (!ctx) {
      cv.setAttribute('mjs-fx-scratch-flat', '');
      cv.style.setProperty('--mjs-fx-scratch-fill', color);
    }
    var raf = function(f) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : (f(), 0); };
    // le visage de la couche : fond, image, mot ; `atop` : seulement là où la couche reste (un tracé déjà fait)
    var face = function(atop) {
      if (!ctx) return;
      ctx.globalCompositeOperation = atop ? 'source-atop' : 'source-over';
      if (colors) {
        var g = ctx.createLinearGradient(0, 0, W, H);
        for (var i = 0; i < colors.length; i++) g.addColorStop(colors.length > 1 ? i / (colors.length - 1) : 0, colors[i]);
        ctx.fillStyle = g;
      }
      else ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      if (pic) {
        var k = Math.max(W / pic.naturalWidth, H / pic.naturalHeight);
        var w = pic.naturalWidth * k;
        var h = pic.naturalHeight * k;
        ctx.drawImage(pic, (W - w) / 2, (H - h) / 2, w, h);
      }
      if (word) {
        var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        var px = Math.max(12, Math.min(H * 0.22, W * 0.9 / (word.length * 0.6)));
        ctx.fillStyle    = ink;
        ctx.font         = '700 ' + Math.round(px) + 'px ' + ((cs && cs.fontFamily) || 'sans-serif');
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(word, W / 2, H / 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    var paint = function() {
      if (!ctx || !W) return;
      ctx.clearRect(0, 0, W, H);
      face(false);
    };
    var wipe = function() {
      if (mkc) mkc.clearRect(0, 0, mk.width, mk.height);
      touched = false;
    };
    // la taille de la balise : la toile et le calque de mesure la suivent, ce qui est gratté est gardé
    var fit = function() {
      var w = el.clientWidth;
      var h = el.clientHeight;
      if (!w || !h || (w === W && h === H)) return;
      var keep = null;
      var mkeep = null;
      if (touched && ctx) {
        keep = document.createElement('canvas');
        keep.width  = cv.width;
        keep.height = cv.height;
        context(keep).drawImage(cv, 0, 0);
        if (mkc) {
          mkeep = document.createElement('canvas');
          mkeep.width  = mk.width;
          mkeep.height = mk.height;
          context(mkeep).drawImage(mk, 0, 0);
        }
      }
      W = w;
      H = h;
      // la densité de l'écran, sans dépasser deux, ni seize millions de pixels
      var dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
      while (W * H * dpr * dpr > 16000000 && dpr > 0.25) dpr /= 2;
      cv.width  = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      if (mkc) {
        mk.width  = 96;
        mk.height = Math.min(256, Math.max(1, Math.round(96 * H / W)));
        mkc.setTransform(mk.width / W, 0, 0, mk.height / H, 0, 0);
      }
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (keep) {
        ctx.drawImage(keep, 0, 0, W, H);
        if (mkeep) {
          mkc.save();
          mkc.setTransform(1, 0, 0, 1, 0, 0);
          mkc.drawImage(mkeep, 0, 0, mk.width, mk.height);
          mkc.restore();
        }
      }
      else if (!done) paint();
    };
    // la part du tracé : la part des cases du calque de mesure que le pinceau a touchées
    var part = function() {
      if (!mkc || !mk.width) return 0;
      var d = mkc.getImageData(0, 0, mk.width, mk.height).data;
      var n = 0;
      for (var i = 3; i < d.length; i += 4) {
        if (d[i] > 127) n++;
      }
      return n / (d.length / 4);
    };
    var tell = function() {
      frame = 0;
      if (gone || done || !mkc) return;
      var p = part();
      if (p < limit) return;
      done = true;
      cv.setAttribute('mjs-fx-scratch-done', '');
      if (told) return;
      told = true;
      µ._mjs_dom.dispatchEvent(el, new CustomEvent('mjs:scratch', { bubbles: true, composed: true, detail: { part: p } }));
    };
    // un trait du pinceau de `a` à `b` : la toile s'efface, le calque de mesure se remplit
    var dab = function(a, b) {
      var go = function(c, op) {
        c.globalCompositeOperation = op;
        c.fillStyle   = '#000';
        c.strokeStyle = '#000';
        if (shape === 'square') {
          var n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (brush / 4)));
          for (var i = 0; i <= n; i++) c.fillRect(a.x + (b.x - a.x) * i / n - brush / 2, a.y + (b.y - a.y) * i / n - brush / 2, brush, brush);
        }
        else {
          c.lineWidth = brush;
          c.lineCap   = 'round';
          c.lineJoin  = 'round';
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x + (a === b ? 0.01 : 0), b.y);
          c.stroke();
        }
        c.globalCompositeOperation = 'source-over';
      };
      if (ctx) go(ctx, 'destination-out');
      if (mkc) go(mkc, 'source-over');
      touched = true;
      if (!frame) frame = raf(tell);
    };
    var at = function(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / (r.width || W)), y: (e.clientY - r.top) * (H / (r.height || H)) };
    };
    var press = function(e) {
      if (done || !W || (e.pointerType === 'mouse' && e.button > 0)) return;
      // un second doigt pendant le geste : ignoré (il traçait un trait depuis la place du premier, et le lever arrêtait
      // l'autre) ; un pointeur principal reprend toujours, un relâchement perdu ne bloque rien
      if (down && e.pointerId !== who && !e.isPrimary) return;
      down = true;
      who  = e.pointerId;
      last = at(e);
      try {
        cv.setPointerCapture(e.pointerId);
      }
      catch {}
      dab(last, last);
      e.preventDefault();
    };
    var drag = function(e) {
      if (!down || done || e.pointerId !== who) return;
      var p = at(e);
      dab(last, p);
      last = p;
    };
    var lift = function(e) { if (e.pointerId === who) down = false; };
    cv.addEventListener('pointerdown', press);
    cv.addEventListener('pointermove', drag);
    cv.addEventListener('pointerup', lift);
    cv.addEventListener('pointercancel', lift);
    // l'image de couverture : posée dès qu'elle est là, sans toucher à ce qui est déjà gratté
    if (url) {
      var im = new Image();
      im.onload = function() {
        if (gone) return;
        pic = im;
        if (touched) face(true);
        else paint();
      };
      im.onerror = function() {
        if (!gone) µ.warn(µ._mjs_msg('scratchImage', { url: url }, '*scratch : l\'image {url} n\'a pas pu être chargée, la couche de couleur la remplace.'));
      };
      im.src = url;
    }
    µ._mjs_dom.appendChild(host, cv);
    fit();
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    // la couche revient : un tracé neuf, l'événement peut repartir
    var renew = function() {
      if (!done) return;
      done = false;
      told = false;
      wipe();
      paint();
      cv.removeAttribute('mjs-fx-scratch-done');
    };
    var off = function() {
      gone = true;
      if (ro) ro.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      if (url) im.onload = im.onerror = null;
      cv.remove();
      restore();
    };
    // le pinceau, la forme, le seuil : suivis sur place ; l'état `revealed` découvre ou rend la couche ;
    // la couleur, le dégradé, l'image, le mot : l'effet repart (la couche est refaite)
    off.set = function(key, v) {
      if (key === 'revealed') {
        if (v === true) {
          done = true;
          cv.setAttribute('mjs-fx-scratch-done', '');
        }
        else renew();
      }
      else if (key === 'brush') brush = v === void 0 ? 28 : v;
      else if (key === 'shape') shape = v || 'round';
      else if (key === 'threshold') limit = v === void 0 ? 0.6 : v;
      else if (key === 'duration') return;
      else return false;
    };
    return off;
  }
};
