// mjs_fx_gallery — `*gallery` : les enfants directs de la balise (images, cartes, liens cliquables) sont des
// panneaux rangés dans l'espace par des transformations CSS 3D — ni canvas ni bibliothèque — et qu'on fait
// avancer. Une position `p` court de 0 à n − 1 ; le panneau `i` est à la distance `d = i − p` du premier plan,
// et le style dit où le mettre. Les nombres de chaque style sont comptés en unités de panneau : un style est
// dessiné pour un panneau de `ref` unités de large et de haut, et la taille réelle du plus grand panneau (lue une
// fois, à la pose et quand la taille change) y est ramenée — la composition est donc la même quelle que soit
// la taille des panneaux. La balise doit avoir une hauteur (les panneaux sont posés en absolu, centrés) ; un
// `overflow: hidden` sur elle coupe ce qui déborde. Pas de `transform-style: preserve-3d` : le fond de la balise
// serait alors un plan à z = 0 qui cacherait les panneaux reculés ; la superposition (et donc le clic) suit le
// `z-index`, tiré de la profondeur.
// Réglages : style (depth : un panneau devant, les autres s'enfoncent en diagonale ; coverflow : le plan
// incliné des deux côtés ; strip : une bande à plat qui se referme vers les bords ; wheel : une roue
// verticale ; arc : un arc de cercle face à soi ; tunnel : on avance à travers les panneaux, celui qui passe
// la caméra s'efface ; sphere : les panneaux répartis sur une sphère qui tourne, n panneaux = un tour ; coverflow), on (ce qui fait
// avancer — scroll : le défilement de la page, dans `zone` ou la traversée de la section si la balise est
// collante ; drag : le glisser (souris, doigt) avec élan, et la molette sur le sens du glisser ; pointer :
// la place de la souris de gauche à droite ; always : tout seul, en faisant l'aller-retour sans `loop` ;
// scroll), loop (sans fin : après le dernier, le premier ; sphere tourne toujours sans fin ; false), snap
// (drag : s'arrête pile sur un panneau, la sphère tourne librement ; true), gap (l'écart entre deux panneaux, × celui du style ; 1),
// perspective (la distance de la caméra en px ; 1200), tilt (toute la scène penche vers la souris, en
// degrés au bord de la balise ; 0), speed (always : le temps de passer d'un panneau au suivant ; 4s), zone
// (scroll : la bande d'écran), index (le panneau de départ ; en `scroll`, le défilement mène de ce panneau au dernier ; 0), smooth (le lissage, de 0.01 à 1, 1 = aucun ;
// 0.1). La balise émet `change` (`e.detail = { index }`) quand le panneau de premier plan change.
// Un clic sans déplacement (moins de 5 px) reste un clic ; après un vrai glisser, le clic qui suit est retenu. Un appui
// finit où qu'il soit relâché (la fenêtre écoute le relâchement le temps de l'appui) ou quand la souris bouge sans bouton.
// `touch-action: pan-y` (pan-x pour wheel, qui glisse en vertical) : le doigt garde le défilement de la page
// dans l'autre sens. La molette n'est prise que dans le sens du glisser (ou le vertical avec Maj) : seul
// écouteur non passif, il ne retient le défilement de la page que dans ce cas. Clavier : la balise prend
// `tabindex="0"` (rendu au retrait), flèches gauche et droite = panneau précédent et suivant,
// `aria-roledescription="carousel"` ; un panneau caché est retiré de la tabulation (`inert`). « Réduire les
// animations » : les panneaux prennent leur place sans lissage ni élan, `always` ne tourne pas, la scène ne
// penche plus. Une seule boucle d'images, qui s'arrête quand `p` a rejoint sa cible, que l'élan est mort et que
// l'inclinaison est posée ; hors écran, `scroll` n'écoute plus le défilement et `always` se repose. Par image :
// une `transform` et une `opacity` écrites par panneau visible, seulement quand elles changent ; le `z-index` est le rang de
// profondeur du panneau (1 à n), écrit seulement quand ce rang change.

var _mjsGalleryDeg = 180 / Math.PI;

function _mjsGalleryNum(v, dflt, min, max) {
  return typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
}

function _mjsGalleryRound(v) {
  return Math.round(v * 100) / 100;
}

// la place d'un panneau : chaque style remplit `q` (x, y, z en px ; rx, ry, rz en degrés ; s la taille ; o l'opacité ;
// zi l'ordre de superposition) pour la distance `d` du panneau de rang `i`, et rend false quand il est hors de la
// scène. `k` : u (px par unité de panneau), g (l'écart), n, w et h (la boîte de la balise), p (la perspective), turn
// (sphere : l'angle de rotation). Les nombres sont comptés comme dans une scène 3D dont l'axe y monte : y et les
// rotations x et z sont retournés ici pour le CSS ; `ref` : la taille de panneau pour laquelle le style est dessiné,
// `pitch` : les unités à glisser pour passer un panneau, `axis` : le sens du glisser
var _MJS_GALLERY = {
  // un panneau devant, les autres s'enfoncent en diagonale (8 × 5)
  depth: { ref: [8, 5], axis: 'x', pitch: 4, place: function(d, i, k, q) {
    var a = Math.abs(d);
    if (a >= 1.3) return false;
    q.x  = d * .9 * k.g * k.u;
    q.y  = -d * .4 * k.g * k.u;
    q.z  = -a * 5 * k.u;
    q.ry = d * .35 * _mjsGalleryDeg;
    q.s  = 1 - Math.min(.55, a * .3);
    q.o  = Math.min(1, (1.3 - a) / .3);
    return true;
  } },
  // le plan incliné des deux côtés (4,7 × 3,1)
  coverflow: { ref: [4.7, 3.1], axis: 'x', pitch: 4.9, place: function(d, i, k, q) {
    var a = Math.abs(d);
    if (a >= 1.6) return false;
    q.x  = d * 4.9 * k.g * k.u;
    q.z  = -a * 1.3 * k.u;
    q.ry = -d * .7 * _mjsGalleryDeg;
    q.rz = d * .08 * _mjsGalleryDeg;
    q.o  = Math.min(1, (1.6 - a) / .3);
    return true;
  } },
  // une bande à plat qui se referme vers les bords (3,2 × 4,1)
  strip: { ref: [3.2, 4.1], axis: 'x', pitch: 3.35, place: function(d, i, k, q) {
    var a = Math.abs(d);
    if (a >= 4) return false;
    q.x  = d * 3.35 * k.g * k.u;
    q.y  = .1 * k.u;
    q.ry = Math.max(-.65, Math.min(.65, -d * .15)) * _mjsGalleryDeg;
    q.o  = Math.min(1, (4 - a) / .6);
    return true;
  } },
  // une roue verticale (4,7 × 3,1)
  wheel: { ref: [4.7, 3.1], axis: 'y', pitch: 3.65, place: function(d, i, k, q) {
    var a = Math.abs(d);
    if (a >= 2.7) return false;
    q.x  = Math.sin(d * .65) * .7 * k.u;
    q.y  = d * 3.65 * k.g * k.u;
    q.z  = -a * .7 * k.u;
    q.rx = -d * .16 * _mjsGalleryDeg;
    q.rz = -Math.sin(d * .8) * .12 * _mjsGalleryDeg;
    q.o  = Math.min(1, (2.7 - a) / .6);
    return true;
  } },
  // un arc de cercle face à soi (1,35 × 2) : l'angle de chaque panneau est d × 16°
  arc: { ref: [1.35, 2], axis: 'x', pitch: 1.54, place: function(d, i, k, q) {
    var a = d * .28 * k.g;
    var b = Math.abs(a);
    if (b >= 1.9) return false;
    q.x  = Math.sin(a) * 5.5 * k.u;
    q.y  = (.7 - Math.cos(a) * 1.3) * k.u;
    q.z  = (Math.cos(a) * 2 - 2) * k.u;
    q.rx = .12 * _mjsGalleryDeg;
    q.ry = a * .85 * _mjsGalleryDeg;
    q.rz = a * .12 * _mjsGalleryDeg;
    q.o  = Math.min(1, (1.9 - b) / .3);
    return true;
  } },
  // on avance à travers les panneaux : celui qui passe la caméra s'efface, ceux du fond se perdent
  tunnel: { ref: [4.7, 3.1], axis: 'x', pitch: 4, place: function(d, i, k, q) {
    if (d <= -1 || d >= 4) return false;
    q.z = -d * k.p * .55 * k.g;
    if (q.z >= k.p * .85) return false;
    q.o  = d < 0 ? 1 + d : Math.min(1, (4 - d) / 2);
    q.zi = 1000 - Math.round(d * 100);
    return true;
  } },
  // les panneaux répartis sur une sphère (spirale à angle d'or : 2,399 rad d'un panneau au suivant), ceux de derrière plus petits et plus pâles ;
  // `p` est un angle (n panneaux = un tour), la sphère a pour rayons 24 % de la largeur et 34 % de la hauteur
  sphere: { ref: [1, 1], axis: 'x', pitch: 0, place: function(d, i, k, q) {
    var y = 1 - (i + .5) / k.n * 2;
    var r = Math.sqrt(1 - y * y);
    var a = i * 2.399 + k.turn;
    var z = Math.sin(a) * r;
    q.x  = Math.cos(a) * r * .24 * k.w * k.g;
    q.y  = y * .34 * k.h * k.g;
    q.s  = .8 + z * .35;
    q.o  = .55 + (z + 1) * .22;
    q.zi = Math.round((z + 1) * 500) + 1;
    return true;
  } }
};

µ._mjs_fxDefs.gallery = {
  css: '[mjs-fx~="gallery"]{perspective:var(--mjs-gallery-perspective,1200px)}'
    + '[mjs-fx~="gallery"] > *{position:absolute;left:50%;top:50%;margin:0;translate:-50% -50%;transition-property:none}'
    + '[mjs-fx~="gallery"] > [mjs-fx-gallery-hidden]{visibility:hidden;pointer-events:none}'
    + '[mjs-fx~="gallery"][mjs-fx-gallery-moving] > *{will-change:transform,opacity}'
    + '[mjs-fx~="gallery"][mjs-fx-gallery-on="drag"]{touch-action:pan-y;cursor:grab;user-select:none;-webkit-user-select:none}'
    + '[mjs-fx~="gallery"][mjs-fx-gallery-on="drag"][mjs-fx-gallery-axis="y"]{touch-action:pan-x}'
    + '[mjs-fx~="gallery"][mjs-fx-gallery-on="drag"][mjs-fx-gallery-drag]{cursor:grabbing}',
  vars: { perspective: 'px' },
  setup: function(el, s, comp) {
    var style  = _MJS_GALLERY[s.style] ? s.style : 'coverflow';
    var mode   = s.on === 'drag' || s.on === 'pointer' || s.on === 'always' ? s.on : 'scroll';
    var loop   = !!s.loop;
    var snap   = s.snap !== false;
    var tilt   = _mjsGalleryNum(s.tilt, 0, 0, 30);
    var speed  = Math.max(50, µ._mjs_fxMs(s.speed, 4000));
    var start  = Math.round(_mjsGalleryNum(s.index, 0, 0, 10000));
    var smooth = _mjsGalleryNum(s.smooth, .1, .01, 1);
    var K      = { u: 0, g: _mjsGalleryNum(s.gap, 1, .2, 4), n: 0, w: 0, h: 0, p: _mjsGalleryNum(s.perspective, 1200, 200, 5000), turn: 0 };
    var Q      = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, o: 1, zi: 0 };
    var cfg    = _MJS_GALLERY[style];
    var recs   = [];
    var n      = 0;
    var cw     = 0;
    var ch     = 0;
    var pw     = 0;
    var ph     = 0;
    var pos    = 0;
    var target = 0;
    var vel    = 0;
    var tx     = 0;
    var ty     = 0;
    var gx     = 0;
    var gy     = 0;
    var w      = 0;
    var dir    = 1;
    var raf    = 0;
    var last   = 0;
    var shown  = -1;
    var best   = 0;
    var box    = null;
    var calm   = false;
    var ready  = false;
    var going  = false;
    var fling  = false;
    var moving = false;
    var wt     = 0;
    var drag   = { down: false, on: false, moved: false, id: 0, x: 0, y: 0, v: 0, t: 0 };
    var undo   = [];
    var inline = µ._mjs_fxMovable(el);
    var rel    = µ._mjs_fxRelative(el);
    var on2    = function(t, ev, f, o) {
      µ._mjs_dom.addEventListener(t, ev, f, o);
      undo.push(function() { µ._mjs_dom.removeEventListener(t, ev, f, o); });
    };
    // une galerie circulaire (loop, et la sphère qui tourne sans fin) n'a pas de bornes
    var circ = function() { return loop || style === 'sphere'; };
    var norm = function(v) { return n < 1 ? 0 : circ() ? ((v % n) + n) % n : Math.min(n - 1, Math.max(0, v)); };
    var clampT = function(v) { return circ() || n < 1 ? v : Math.min(n - 1, Math.max(0, v)); };
    // le lissage : un ressort critique, de raideur tirée de `smooth` ; 0 = aucun (smooth à 1, ou mouvement réduit)
    var rate = function() { w = calm || smooth >= 1 ? 0 : -120 * Math.log(1 - smooth); };
    var evalCalm = function() {
      calm = µ._mjs_fxCalm();
      rate();
    };
    var setMoving = function(yes) {
      if (yes === moving) return;
      moving = yes;
      if (yes) µ._mjs_dom.setAttribute(el, 'mjs-fx-gallery-moving', '');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-moving');
    };
    var pxPer = function() { return Math.max(1, style === 'sphere' ? cw / Math.max(1, n) : cfg.pitch * K.g * K.u); };
    var hide = function(r) {
      r.hid = true;
      µ._mjs_dom.setAttribute(r.c, 'mjs-fx-gallery-hidden', '');
      µ._mjs_dom.setAttribute(r.c, 'inert', '');
    };
    var reveal = function(r) {
      r.hid = false;
      µ._mjs_dom.removeAttribute(r.c, 'mjs-fx-gallery-hidden');
      if (!r.was.inert) µ._mjs_dom.removeAttribute(r.c, 'inert');
    };
    // la transformation d'un panneau : l'inclinaison de la scène (autour du centre de la balise, qui est celui de
    // chaque panneau), puis sa place
    var css = function(q) {
      var t = tx || ty ? 'rotateX(' + _mjsGalleryRound(tx) + 'deg) rotateY(' + _mjsGalleryRound(ty) + 'deg) ' : '';
      t += 'translate3d(' + _mjsGalleryRound(q.x) + 'px,' + _mjsGalleryRound(q.y) + 'px,' + _mjsGalleryRound(q.z) + 'px)';
      if (q.rx) t += ' rotateX(' + _mjsGalleryRound(q.rx) + 'deg)';
      if (q.ry) t += ' rotateY(' + _mjsGalleryRound(q.ry) + 'deg)';
      if (q.rz) t += ' rotateZ(' + _mjsGalleryRound(q.rz) + 'deg)';
      if (q.s !== 1) t += ' scale(' + Math.round(q.s * 10000) / 10000 + ')';
      return t;
    };
    var frontOf = function() {
      if (n < 1) return -1;
      if (style === 'sphere') return best;
      return norm(Math.round(pos));
    };
    var emit = function(i) {
      if (i < 0 || i === shown) return;
      shown = i;
      if (ready) µ._mjs_dom.dispatchEvent(el, new CustomEvent('change', { detail: { index: i } }));
    };
    // l'ordre de superposition : le rang de chaque panneau selon sa profondeur (à égalité, le dernier dans la page passe devant), écrit seulement
    // quand il change. La profondeur change presque à chaque image, son rang rarement, et chaque `z-index` écrit fait repeindre toute la galerie
    var stack = function() {
      var by = recs.slice().sort(function(a, b) { return a.k - b.k; });
      for (var j = 0; j < by.length; j++) {
        if (!by[j].hid && by[j].z !== j + 1) by[j].c.style.zIndex = by[j].z = j + 1;
      }
    };
    // une écriture par panneau visible, et seulement ce qui a changé
    var draw = function() {
      K.n    = n;
      K.turn = n > 0 ? pos / n * 2 * Math.PI : 0;
      var place = cfg.place;
      var bz    = -1e9;
      for (var i = 0; i < n; i++) {
        var r = recs[i];
        var d = i - pos;
        if (loop) d -= n * Math.round(d / n);
        Q.x = Q.y = Q.z = Q.rx = Q.ry = Q.rz = 0;
        Q.s  = 1;
        Q.o  = 1;
        Q.zi = 1000 - Math.round(Math.abs(d) * 100);
        var seen = place(d, i, K, Q);
        r.k = Q.zi;
        if (!seen) {
          if (r.hid !== true) hide(r);
          continue;
        }
        if (r.hid !== false) reveal(r);
        var t = css(Q);
        if (t !== r.t) r.c.style.transform = r.t = t;
        var o = Q.o < 1 ? String(Math.round(Math.max(0, Q.o) * 1000) / 1000) : r.was.o;
        if (o !== r.o) r.c.style.opacity = r.o = o;
        if (Q.zi > bz) {
          bz   = Q.zi;
          best = i;
        }
      }
      stack();
      emit(frontOf());
    };
    // un pas du mouvement, `dt` en secondes : l'élan d'un glisser sans `snap`, la marche d'`always`, puis le ressort
    // qui amène `pos` sur `target` ; l'inclinaison de la scène suit la souris de la même raideur
    var step = function(dt) {
      if (tx !== gx || ty !== gy) {
        if (w === 0) {
          tx = gx;
          ty = gy;
        }
        else {
          var kt = 1 - Math.exp(-w * dt);
          tx += (gx - tx) * kt;
          ty += (gy - ty) * kt;
          if (Math.abs(gx - tx) < .01 && Math.abs(gy - ty) < .01) {
            tx = gx;
            ty = gy;
          }
        }
      }
      if (drag.on) return;
      if (going) {
        target += dir * dt * 1000 / speed;
        if (!circ()) {
          if (target >= n - 1) {
            target = Math.max(0, n - 1);
            dir    = -1;
          }
          else if (target <= 0) {
            target = 0;
            dir    = 1;
          }
        }
      }
      if (fling) {
        pos += vel * dt;
        vel *= Math.pow(.95, dt * 60);
        target = pos;
        if (!circ() && (pos < 0 || pos > n - 1)) {
          fling  = false;
          target = clampT(pos);
        }
        else if (Math.abs(vel) < .03) {
          fling = false;
          vel   = 0;
        }
      }
      else if (w === 0) {
        pos = target;
        vel = 0;
      }
      else {
        var x  = pos - target;
        var e  = Math.exp(-w * dt);
        var t1 = vel + w * x;
        pos = target + (x + t1 * dt) * e;
        vel = (vel - t1 * w * dt) * e;
        if (Math.abs(pos - target) < .001 && Math.abs(vel) < .02) {
          pos = target;
          vel = 0;
        }
      }
      // sans fin : les deux restent dans un tour, l'écart entre eux ne change pas
      if (circ() && n > 0 && (pos < 0 || pos >= n)) {
        var sh = n * Math.floor(pos / n);
        pos    -= sh;
        target -= sh;
      }
    };
    // `always` n'a rien à faire avec moins de deux panneaux (un panneau ajouté plus tard la remet en route : cf. le MutationObserver)
    var busy = function() { return !drag.on && ((going && n > 1) || fling || pos !== target || vel !== 0 || tx !== gx || ty !== gy); };
    var frame = function(now) {
      raf = 0;
      var dt = last ? Math.min(.1, (now - last) / 1000) : 1 / 60;
      last = now;
      step(dt);
      draw();
      if (busy()) raf = requestAnimationFrame(frame);
      else if (!drag.on) {
        last = 0;
        setMoving(false);
      }
    };
    var wake = function(now) {
      if (raf) return;
      if (typeof requestAnimationFrame !== 'function') {
        pos = target;
        draw();
        return;
      }
      setMoving(true);
      // appelée depuis une image d'animation (le suivi du défilement) : on dessine dans cette image-là, sans en attendre une autre
      if (now) frame(now);
      else raf = requestAnimationFrame(frame);
    };
    // les panneaux : les enfants directs qui se dessinent ; ce que l'auteur avait écrit en ligne leur est rendu
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function() {
      measure();
      draw();
    }) : null;
    var adopt = function(c) {
      if (ro) ro.observe(c);
      return { c: c, t: null, o: c.style.opacity, z: null, hid: null, was: { t: c.style.transform, o: c.style.opacity, z: c.style.zIndex, inert: µ._mjs_dom.hasAttribute(c, 'inert'), style: µ._mjs_dom.getAttribute(c, 'style') } };
    };
    var release = function(r) {
      if (ro) ro.unobserve(r.c);
      µ._mjs_dom.removeAttribute(r.c, 'mjs-fx-gallery-hidden');
      if (!r.was.inert) µ._mjs_dom.removeAttribute(r.c, 'inert');
      r.c.style.transform = r.was.t;
      r.c.style.opacity   = r.was.o;
      r.c.style.zIndex    = r.was.z;
      if (r.was.style === null && !µ._mjs_dom.getAttribute(r.c, 'style')) µ._mjs_dom.removeAttribute(r.c, 'style');
    };
    var collect = function() {
      var old  = recs;
      var kids = Array.prototype.filter.call(el.children, function(c) { return !/^(script|style|template|link|meta)$/i.test(c.localName); });
      recs = kids.map(function(c) {
        for (var j = 0; j < old.length; j++) {
          if (old[j].c === c) return old[j];
        }
        return adopt(c);
      });
      old.forEach(function(r) { if (recs.indexOf(r) < 0) release(r); });
      n = recs.length;
      pos    = norm(pos);
      target = clampT(target);
    };
    // les boîtes se lisent ici et à chaque changement de taille, jamais pendant le mouvement
    var measure = function() {
      cw  = el.clientWidth;
      ch  = el.clientHeight;
      var a = 0;
      var b = 0;
      for (var i = 0; i < recs.length; i++) {
        a = Math.max(a, recs[i].c.offsetWidth);
        b = Math.max(b, recs[i].c.offsetHeight);
      }
      pw  = a;
      ph  = b;
      K.w = cw;
      K.h = ch;
      K.u = Math.max(pw / cfg.ref[0], ph / cfg.ref[1]);
      box = null;
    };
    var applyStyle = function() {
      cfg = _MJS_GALLERY[style];
      if (cfg.axis === 'y') µ._mjs_dom.setAttribute(el, 'mjs-fx-gallery-axis', 'y');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-axis');
    };
    var tab  = !µ._mjs_dom.hasAttribute(el, 'tabindex');
    var role = µ._mjs_dom.getAttribute(el, 'aria-roledescription');
    if (tab) µ._mjs_dom.setAttribute(el, 'tabindex', '0');
    if (role === null) µ._mjs_dom.setAttribute(el, 'aria-roledescription', 'carousel');
    µ._mjs_dom.setAttribute(el, 'mjs-fx-gallery-on', mode);
    applyStyle();
    evalCalm();
    collect();
    measure();
    pos    = norm(start);
    target = pos;
    draw();
    ready = true;
    if (ro) ro.observe(el);
    else {
      var onSize = function() {
        measure();
        draw();
      };
      window.addEventListener('resize', onSize);
      undo.push(function() { window.removeEventListener('resize', onSize); });
    }
    var mo = typeof MutationObserver === 'function' ? new MutationObserver(function() {
      collect();
      measure();
      draw();
      if (going) wake();
    }) : null;
    if (mo) mo.observe(el, { childList: true });

    // le clavier : flèches gauche et droite
    on2(el, 'keydown', function(e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var k = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!k) return;
      e.preventDefault();
      evalCalm();
      target = clampT(Math.round(target) + k);
      wake();
    });

    // le glisser : un clic sans déplacement reste un clic, la prise du pointeur ne vient qu'au-delà de 5 px ; avant elle, un
    // relâchement hors de la balise ne lui est pas adressé : la fenêtre l'écoute le temps de l'appui (`unpress` la retire)
    var unpress    = null;
    var swallowOff = null;
    var swallowOn  = function() {
      if (swallowOff) swallowOff();
      var h = function(e) {
        e.stopPropagation();
        e.preventDefault();
        swallowOff();
      };
      var t = setTimeout(function() { swallowOff(); }, 50);
      window.addEventListener('click', h, true);
      swallowOff = function() {
        window.removeEventListener('click', h, true);
        clearTimeout(t);
        swallowOff = null;
      };
    };
    // la molette, un geste = des événements à moins de 160 ms l'un de l'autre : avec `snap`, un cran (100 px, 3 lignes, une page)
    // avance d'un panneau et un geste de plusieurs crans d'autant (`wacc` : le geste en crans, `wdone` : les panneaux déjà comptés)
    var wacc      = 0;
    var wdone     = 0;
    var wheelStop = function() {
      wt    = 0;
      wacc  = 0;
      wdone = 0;
    };
    if (mode === 'drag') {
      on2(el, 'pointerdown', function(e) {
        if ((e.pointerType === 'mouse' && e.button !== 0) || drag.on) return;
        evalCalm();
        drag.down  = true;
        drag.moved = false;
        drag.id    = e.pointerId;
        drag.x     = e.clientX;
        drag.y     = e.clientY;
        drag.v     = cfg.axis === 'y' ? e.clientY : e.clientX;
        drag.t     = e.timeStamp;
        // l'élan s'arrête au toucher
        fling  = false;
        vel    = 0;
        target = pos;
        if (unpress) unpress();
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
        unpress = function() {
          window.removeEventListener('pointerup', end, true);
          window.removeEventListener('pointercancel', end, true);
          unpress = null;
        };
      });
      on2(el, 'pointermove', function(e) {
        if (!drag.down || e.pointerId !== drag.id) return;
        // une souris qui bouge sans bouton : le relâchement ne nous a pas été dit (hors de la fenêtre, perte du focus), l'appui est fini
        if (e.pointerType === 'mouse' && e.buttons === 0) {
          end(e);
          return;
        }
        if (!drag.moved) {
          if (Math.abs(e.clientX - drag.x) < 5 && Math.abs(e.clientY - drag.y) < 5) return;
          drag.moved = true;
          drag.on    = true;
          try {
            µ._mjs_dom.setPointerCapture(el, e.pointerId);
          }
          catch {}
          µ._mjs_dom.setAttribute(el, 'mjs-fx-gallery-drag', '');
          setMoving(true);
        }
        var v  = cfg.axis === 'y' ? e.clientY : e.clientX;
        var dp = -(v - drag.v) / pxPer();
        drag.v = v;
        // au bout d'une galerie sans fin, la main tire plus qu'elle ne bouge
        if (!circ() && ((pos <= 0 && dp < 0) || (pos >= n - 1 && dp > 0))) dp *= .35;
        pos += dp;
        target = pos;
        var dt = e.timeStamp - drag.t;
        drag.t = e.timeStamp;
        if (dt > 0) vel = vel * .5 + dp / dt * 500;
        wake();
      });
      var end = function(e) {
        // au doigt, le panneau touché tient la prise du pointeur : quand la galerie la prend, il la perd, et cette perte remonte
        // jusqu'ici — ce n'est pas la fin du geste
        if (e.type === 'lostpointercapture' && e.target !== el) return;
        if (!drag.down || e.pointerId !== drag.id) return;
        if (unpress) unpress();
        var moved = drag.moved;
        drag.down  = false;
        drag.moved = false;
        if (!moved) {
          // un clic : il reste un clic, la galerie se pose sur son panneau
          if (snap && style !== 'sphere') {
            target = clampT(Math.round(pos));
            wake();
          }
          return;
        }
        drag.on = false;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-drag');
        try {
          µ._mjs_dom.releasePointerCapture(el, e.pointerId);
        }
        catch {}
        swallowOn();
        if (e.timeStamp - drag.t > 80 || calm) vel = 0;
        // l'élan : sans `snap` il s'éteint de lui-même (× 0,95 par image), avec `snap` le ressort le prend et
        // pose la galerie sur le panneau où il l'aurait menée
        if (snap && style !== 'sphere') {
          target = clampT(Math.round(pos + vel * .3167));
          if (calm) pos = target;
        }
        else {
          fling  = !calm && Math.abs(vel) > .03;
          target = fling ? pos : clampT(pos);
        }
        wake();
      };
      on2(el, 'pointerup', end);
      on2(el, 'pointercancel', end);
      on2(el, 'lostpointercapture', end);
      on2(el, 'dragstart', function(e) { e.preventDefault(); });
      // la molette ne prend que le sens du glisser (le vertical avec Maj pour un glisser horizontal) : seul écouteur non passif
      on2(el, 'wheel', function(e) {
        var f  = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        var dx = e.deltaX * f;
        var dy = e.deltaY * f;
        var m  = cfg.axis === 'y' ? dy : Math.abs(dx) > Math.abs(dy) ? dx : e.shiftKey ? dy : 0;
        if (!m) return;
        e.preventDefault();
        evalCalm();
        fling = false;
        if (snap && style !== 'sphere') {
          // le sens inverse commence un nouveau geste
          if (wacc * m < 0) {
            wacc  = 0;
            wdone = 0;
          }
          wacc += m / (e.deltaMode === 1 ? 48 : e.deltaMode === 2 ? 400 : 100);
          var steps = (wacc < 0 ? -1 : 1) * Math.max(1, Math.round(Math.abs(wacc)));
          target = clampT(Math.round(target) + steps - wdone);
          wdone  = steps;
        }
        else target = clampT(target + m * .0025);
        clearTimeout(wt);
        wt = setTimeout(wheelStop, 160);
        wake();
      }, { passive: false });
    }

    // la place de la souris, de gauche à droite ; l'inclinaison de la scène suit aussi la souris. La boîte de la balise se lit
    // à l'entrée de la souris et se relit quand la page défile pendant qu'elle y reste (le suivi du défilement ne dure que ce temps)
    if (mode === 'pointer' || tilt > 0) {
      var unwatch = null;
      on2(el, 'pointerenter', function() { box = null; });
      on2(el, 'pointermove', function(e) {
        if (!box) {
          box = µ._mjs_dom.getBoundingClientRect(el);
          if (!unwatch) unwatch = µ._mjs_fxScroll(el, function() { box = null; });
        }
        if (!(box.width > 0 && box.height > 0)) return;
        var fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
        var fy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
        if (mode === 'pointer') target = style === 'sphere' ? fx * n : fx * Math.max(0, n - 1);
        if (tilt > 0 && !calm) {
          gy = (fx - .5) * 2 * tilt;
          gx = -(fy - .5) * 2 * tilt;
        }
        wake();
      });
      on2(el, 'pointerleave', function() {
        if (unwatch) unwatch();
        unwatch = null;
        if (tilt > 0) {
          gx = 0;
          gy = 0;
          wake();
        }
      });
      undo.push(function() {
        if (unwatch) unwatch();
        unwatch = null;
      });
    }

    // le défilement de la page : écouté seulement quand la balise est près de l'écran ; la première place lue à
    // chaque retour est prise d'un coup (le lissage ne rattrape pas ce qui s'est joué hors de vue)
    if (mode === 'scroll') {
      var halt   = null;
      var first  = true;
      var seeing = null;
      var follow = function(p) {
        var from = Math.min(norm(start), Math.max(0, n - 1));
        target = from + p * Math.max(0, n - 1 - from);
        if (style === 'sphere') target = p * n;
        if (first) {
          first = false;
          pos   = target;
          vel   = 0;
        }
        wake(typeof performance === 'object' ? performance.now() : Date.now());
      };
      var enter = function() {
        if (halt) return;
        first = true;
        evalCalm();
        halt = µ._mjs_fxScroll(el, follow, s.zone);
      };
      var leave = function() {
        if (!halt) return;
        halt();
        halt = null;
      };
      if (typeof IntersectionObserver === 'function') seeing = µ._mjs_fxVisible(el, '200px', enter, leave);
      else enter();
      undo.push(function() {
        if (seeing) seeing();
        leave();
      });
    }

    // tout seul : tant que la balise est près de l'écran, sinon la boucle se repose
    if (mode === 'always') {
      undo.push(µ._mjs_fxRun(el, 'always', function() {
        if (calm) return;
        going = true;
        wake();
      }, function() { going = false; }));
    }

    var off = function() {
      for (var i = 0; i < undo.length; i++) undo[i]();
      undo = [];
      if (unpress) unpress();
      if (swallowOff) swallowOff();
      clearTimeout(wt);
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      recs.forEach(release);
      recs = [];
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-on');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-axis');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-moving');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gallery-drag');
      if (tab) µ._mjs_dom.removeAttribute(el, 'tabindex');
      if (role === null) µ._mjs_dom.removeAttribute(el, 'aria-roledescription');
      rel();
      inline();
    };
    // un réglage tenu par une variable se suit sur place ; `on` et `zone` relancent l'effet, comme `tilt` quand il
    // apparaît ou disparaît (les écouteurs de la souris)
    off.set = function(k, v) {
      switch (k) {
        case 'style':
          style = _MJS_GALLERY[v] ? v : 'coverflow';
          applyStyle();
          measure();
          // la sphère tourne sans fin : un style borné ramène la galerie dans ses bornes, comme `loop` qui s'éteint
          pos    = norm(pos);
          target = clampT(target);
          break;
        case 'loop':
          loop = !!v;
          pos    = norm(pos);
          target = clampT(target);
          break;
        case 'snap':
          snap = v !== false;
          break;
        case 'gap':
          K.g = _mjsGalleryNum(v, 1, .2, 4);
          break;
        case 'perspective':
          K.p = _mjsGalleryNum(v, 1200, 200, 5000);
          break;
        case 'tilt':
          var t2 = _mjsGalleryNum(v, 0, 0, 30);
          if ((t2 > 0) !== (tilt > 0)) return false;
          tilt = t2;
          if (!tilt) {
            gx = 0;
            gy = 0;
          }
          break;
        case 'speed':
          speed = Math.max(50, µ._mjs_fxMs(v, 4000));
          break;
        case 'smooth':
          smooth = _mjsGalleryNum(v, .1, .01, 1);
          rate();
          break;
        case 'index':
          start  = Math.round(_mjsGalleryNum(v, 0, 0, 10000));
          // une galerie circulaire va au plus court, vers la copie la plus proche du panneau visé (comme le clavier)
          if (circ() && n > 0) {
            var d = norm(start) - norm(target);
            target += d - n * Math.round(d / n);
          }
          else target = clampT(norm(start));
          break;
        default:
          return false;
      }
      draw();
      wake();
    };
    return off;
  }
};
