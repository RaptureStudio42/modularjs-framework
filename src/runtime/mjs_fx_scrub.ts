// mjs_fx_scrub — `*scrub` : une vidéo, ou une suite d'images, qui n'avance pas toute seule : elle avance
// quand on descend dans la page, recule quand on remonte (ou, avec `on: hover`, quand la souris va de
// gauche à droite de la balise). Trois balises : une <video> (sans `frames` ; son temps courant suit la
// lecture), un <canvas> (l'image est dessinée à la taille de la balise × la densité de l'écran, au plus 2),
// une <img> (son `src` change ; l'adresse d'origine est rendue au retrait).
// Réglages : frames (le gabarit d'adresse d'une suite d'images, `###` = le numéro, autant de `#` que de
// chiffres, complété de zéros : 'img/seq-###.webp' ; sans lui la balise est une <video>), count (le nombre
// d'images de la suite, avec frames), images (une LISTE d'adresses, à la place de frames et de count : pour une
// suite courte ; un élément est une adresse, ou l'objet que rend µimage('…') — en objet, ou en son texte JSON, ce
// qu'un chemin local de la liste devient au build — dont seul `src` sert : son `srcset` choisit une variante selon
// une largeur, une suite d'images n'en a pas besoin), first (le numéro de la première image ; 1), on (scroll : suit le
// défilement ; hover : suit la souris ; scroll), zone (on: scroll : la bande d'écran où la lecture se joue,
// `60% 40%`), from et to (la portion de la vidéo ou de la suite parcourue, de 0 à 1 ; 0 et 1), smooth (le
// lissage : 0 = collé au défilement, 1 = très amorti ; 0.15), fit (suite dans un <canvas> : cover remplit la
// balise, contain montre l'image entière ; cover), reverse (lit à l'envers).
// Une balise collante (position: sticky) dans une section plus haute que l'écran : la lecture suit la
// traversée de la section (cf. µ._mjs_fxStuck, comme *stagger), la balise reste en place.
// Technique : une seule boucle d'images d'animation, vivante tant que la position lissée n'a pas rejoint la
// cible (écart sous 0,0005) ; au repos, ni boucle ni minuterie. Une balise à plus d'un écran de la vue ne suit
// rien et ne charge rien : le défilement n'est pas écouté, la boucle est coupée, ni vidéo ni image n'est demandée ;
// à chaque retour près de la vue (et à la pose), la première position lue est prise d'un coup, sans rattraper
// l'ancienne, et le chargement des images part de l'image où l'on est.
// Vidéo : en pause, muette (son attribut est rendu au retrait). Loin de la vue elle n'est ni chargée ni cherchée :
// son `preload` reste celui de l'auteur et `currentTime` n'est pas écrit ; à l'approche `preload` passe à auto,
// puis `currentTime` n'est écrit que si la cible a bougé d'au moins une image (1/30 s) et qu'aucune recherche
// n'est en cours. Le `preload` de l'auteur est rendu au retrait.
// Suite d'images : chargée à la demande, l'image voulue d'abord puis ses voisines, six chargements au plus à la
// fois, décodée avant d'être montrée ; une image pas encore prête cède la place à la plus proche déjà prête.
// Quand la balise s'éloigne de la vue, toute la suite est lâchée (chargements en route abandonnés, images rendues
// au navigateur) ; à son retour elle se recharge depuis l'image où l'on est (le cache du navigateur les rend).
// Poids : près de la vue, la suite demandée tient en mémoire, au plus nombre d'images × largeur × hauteur × 4
// octets (200 images de 1600 × 900 px : 1,15 Go au plus). L'auteur choisit la taille et le nombre de ses images
// en conséquence : à la taille de la balise, pas plus.
// « Réduire les animations » : pas de lissage, la position suit directement.
// Refusé, avec un message en console : une balise qui n'est ni <video> ni <canvas>/<img>, frames sans count
// ni #, un <canvas> qui porte déjà un autre contexte que 2d.
// Un <canvas> se dimensionne par la CSS (`width: 100%`) ; sans taille CSS, il garde sa taille d'avant l'effet.

µ._mjs_fxDefs.scrub = {
  vars: {},
  setup: function(el, s) {
    // l'adresse d'un élément de `images` : une chaîne telle quelle, ou l'objet que rend µimage('…'), en objet ou en son texte JSON (ce qu'un chemin
    // local de la liste devient au build) : son `src` ; son `srcset` ne sert pas, une suite d'images n'a pas de largeur où choisir une variante
    var address = function(item) {
      var raw = item;
      if (typeof raw === 'string' && raw.charAt(0) === '{') {
        try {
          raw = JSON.parse(raw);
        }
        catch (e) {
          return item;
        }
      }
      return raw && typeof raw === 'object' && typeof raw.src === 'string' ? raw.src : item;
    };
    var tag    = (el.localName || '').toLowerCase();
    var list   = Array.isArray(s.images) && s.images.length > 0 ? s.images.map(address) : null;
    var frames = typeof s.frames === 'string' ? s.frames : '';
    var seq    = !!(list || frames);
    var count  = list ? list.length : s.count > 1 ? Math.round(s.count) : 0;
    // refusé : le message le dit en console, la balise reste telle qu'elle est
    var refuse = function(msg) {
      µ.warn(msg, el);
      return function() {};
    };
    if (!seq && tag !== 'video') return refuse(µ._mjs_msg('scrubTag', { tag: tag }, '*scrub : sans frames ni images, la balise doit être une <video> (c\'est une <{tag}>) — l\'effet n\'est pas posé. Pour une suite d\'images, écrivez frames et count sur un <canvas> ou une <img>.'));
    if (seq && tag !== 'canvas' && tag !== 'img') return refuse(µ._mjs_msg('scrubSeqTag', { tag: tag }, '*scrub : une suite d\'images (frames, images) se pose sur un <canvas> ou une <img>, pas sur une <{tag}> — l\'effet n\'est pas posé.'));
    if (seq && !count) return refuse(µ._mjs_msg('scrubCount', null, '*scrub : frames demande count, le nombre d\'images de la suite — l\'effet n\'est pas posé. Écrivez par exemple *scrub(frames: \'img/seq-###.webp\', count: 120).'));
    if (seq && !list && frames.indexOf('#') < 0) return refuse(µ._mjs_msg('scrubHash', null, '*scrub : frames doit contenir ### à la place du numéro de l\'image (img/seq-###.webp) — l\'effet n\'est pas posé.'));
    var ctx = tag === 'canvas' ? el.getContext('2d') : null;
    if (tag === 'canvas' && !ctx) return refuse(µ._mjs_msg('scrubContext', null, '*scrub : ce <canvas> porte déjà un autre contexte que 2d — l\'effet n\'est pas posé.'));
    var video  = tag === 'video';
    var hover  = s.on === 'hover';
    var zone   = s.zone;
    var from   = s.from === void 0 ? 0 : s.from;
    var to     = s.to === void 0 ? 1 : s.to;
    var back   = s.reverse === true;
    var smooth = s.smooth === void 0 ? 0.15 : s.smooth;
    var fit    = s.fit === 'contain' ? 'contain' : 'cover';
    var calm   = µ._mjs_fxCalm();
    var rate   = 0;
    var target = 0;
    var pos    = 0;
    var last   = 0;
    var raf    = 0;
    // près de la vue : l'observateur le dira ; sans observateur, la balise est toujours près
    var near   = typeof IntersectionObserver !== 'function';
    var snap   = false;
    var gone   = false;
    var undo   = [];
    var paint  = null;
    var pump   = null;
    var redraw = null;
    var drop   = null;
    // le lissage par seconde : 2.4 / smooth (0.15 → 16, la constante de la référence) ; aucun à 0, ni sous « réduire les animations »
    var tune = function() { rate = calm || !(smooth > 0) ? 0 : 2.4 / smooth; };
    tune();
    // la position lue (0 → 1) devient celle de la vidéo ou de la suite, dans la portion de from à to
    var place = function(p) {
      var u = from + (to - from) * (back ? 1 - p : p);
      return u < 0 ? 0 : u > 1 ? 1 : u;
    };

    // ----- la boucle : une image d'animation à la fois, tant que la position lissée n'a pas rejoint la cible -----
    var tick = function(now) {
      raf = 0;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      pos = rate > 0 ? pos + (target - pos) * (1 - Math.exp(-dt * rate)) : target;
      if (Math.abs(target - pos) < 0.0005) pos = target;
      paint();
      if (pos !== target) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    var aim = function(p) {
      target = p;
      // la première position lue après chaque réveil est prise d'un coup : rien ne se rattrape depuis l'ancienne, et le chargement part de l'image où l'on est
      if (snap) {
        snap = false;
        pos  = p;
        paint();
        if (pump) pump();
        return;
      }
      if (pos === target) return;
      if (rate > 0 && typeof requestAnimationFrame === 'function') {
        if (!raf) raf = requestAnimationFrame(tick);
      }
      else {
        pos = target;
        paint();
      }
    };

    // ----- la vidéo : en pause, muette, son temps courant suit la position ; ni chargée ni cherchée tant que la balise est loin -----
    if (video) {
      var dur     = 0;
      var sent    = -1;
      var auto    = false;
      var muted   = el.muted;
      var hadMute = µ._mjs_dom.hasAttribute(el, 'muted');
      var preload = µ._mjs_dom.getAttribute(el, 'preload');
      var seek    = function() {
        if (!near || !(dur > 0)) return;
        var want = Math.min(place(pos) * dur, Math.max(0, dur - 0.01));
        // pas de recherche empilée sur une autre ; en fin de recherche (seeked), la cible du moment est reprise
        if (el.seeking || Math.abs(want - sent) < 1 / 30) return;
        sent = want;
        el.currentTime = want;
      };
      var meta = function() {
        dur  = isFinite(el.duration) ? el.duration : 0;
        sent = -1;
        seek();
      };
      var hush = function() { el.pause(); };
      if (!hadMute) µ._mjs_dom.setAttribute(el, 'muted', '');
      el.muted = true;
      el.pause();
      µ._mjs_dom.addEventListener(el, 'loadedmetadata', meta);
      µ._mjs_dom.addEventListener(el, 'seeked', seek);
      µ._mjs_dom.addEventListener(el, 'play', hush);
      if (el.readyState >= 1) meta();
      paint = seek;
      // le `preload` de l'auteur reste en place tant que la balise est loin de la vue : il passe à auto à son approche, une fois
      pump = function() {
        if (gone || !near || auto) return;
        auto = true;
        µ._mjs_dom.setAttribute(el, 'preload', 'auto');
      };
      undo.push(function() {
        µ._mjs_dom.removeEventListener(el, 'loadedmetadata', meta);
        µ._mjs_dom.removeEventListener(el, 'seeked', seek);
        µ._mjs_dom.removeEventListener(el, 'play', hush);
        if (!hadMute) µ._mjs_dom.removeAttribute(el, 'muted');
        el.muted = muted;
        if (auto) {
          if (preload === null) µ._mjs_dom.removeAttribute(el, 'preload');
          else µ._mjs_dom.setAttribute(el, 'preload', preload);
        }
      });
    }

    // ----- la suite d'images : chargée à la demande, l'image voulue d'abord, puis ses voisines -----
    else {
      var imgs  = [];
      var ok    = [];
      var busy  = 0;
      var todo  = count;
      var cur   = Math.round(place(0) * (count - 1));
      var shown = -1;
      var first = s.first === void 0 ? 1 : s.first;
      var addr  = function(i) {
        if (list) return list[i];
        return frames.replace(/#+/g, function(m) { return String(first + i).padStart(m.length, '0'); });
      };
      // la plus proche image déjà prête (celle qu'on veut, sinon ses voisines de plus en plus loin) ; -1 : aucune
      var closest = function(i) {
        if (ok[i] === 1) return i;
        for (var d = 1; d < count; d++) {
          if (i + d < count && ok[i + d] === 1) return i + d;
          if (i - d >= 0 && ok[i - d] === 1) return i - d;
        }
        return -1;
      };
      var draw = null;
      var show = function(i) {
        if (i !== cur) {
          cur = i;
          pump();
        }
        var j = closest(i);
        if (j < 0 || j === shown) return;
        shown = j;
        draw(j);
      };
      var load = function(i) {
        var im  = imgs[i] = new Image();
        var end = function(good) {
          // une suite lâchée (ou retirée) entre-temps : cette image n'est plus celle de sa place, elle ne compte plus
          if (gone || imgs[i] !== im) return;
          busy--;
          ok[i] = good ? 1 : 2;
          if (good) show(cur);
          pump();
        };
        busy++;
        todo--;
        im.decoding = 'async';
        im.src      = addr(i);
        (typeof im.decode === 'function' ? im.decode() : new Promise(function(done, fail) {
          im.onload  = done;
          im.onerror = fail;
        })).then(function() { end(true); }, function() { end(false); });
      };
      // jamais plus de six chargements à la fois, les plus proches de l'image voulue d'abord ; rien tant que la balise est loin
      pump = function() {
        if (gone || !near || todo === 0) return;
        for (var d = 0; d < count; d++) {
          if (busy >= 6) break;
          if (cur + d < count && !imgs[cur + d]) load(cur + d);
          if (d > 0 && busy < 6 && cur - d >= 0 && !imgs[cur - d]) load(cur - d);
        }
      };
      paint = function() { show(Math.round(place(pos) * (count - 1))); };
      // la suite lâchée (balise loin de la vue, retrait) : chargements en route abandonnés, images rendues au navigateur, comptes remis à zéro ;
      // elle se recharge à l'approche suivante, depuis l'image où l'on est. La toile, ou le src de l'<img>, garde la dernière image montrée
      drop = function() {
        for (var i = 0; i < imgs.length; i++) {
          if (imgs[i] && ok[i] === void 0) imgs[i].src = '';
        }
        imgs = [];
        ok   = [];
        busy = 0;
        todo = count;
      };
      undo.push(drop);
      if (tag === 'img') {
        var src0 = µ._mjs_dom.getAttribute(el, 'src');
        draw = function(j) { µ._mjs_dom.setAttribute(el, 'src', imgs[j].src); };
        undo.push(function() {
          if (src0 === null) µ._mjs_dom.removeAttribute(el, 'src');
          else µ._mjs_dom.setAttribute(el, 'src', src0);
        });
      }
      else {
        var w0     = µ._mjs_dom.getAttribute(el, 'width');
        var h0     = µ._mjs_dom.getAttribute(el, 'height');
        var pin    = null;
        var tested = false;
        draw = function(j) {
          var im = imgs[j];
          var W  = el.width;
          var H  = el.height;
          var iw = im.naturalWidth || W;
          var ih = im.naturalHeight || H;
          ctx.clearRect(0, 0, W, H);
          if (fit === 'contain') {
            var k = Math.min(W / iw, H / ih);
            ctx.drawImage(im, 0, 0, iw, ih, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
          }
          else {
            var c = Math.max(W / iw, H / ih);
            ctx.drawImage(im, (iw - W / c) / 2, (ih - H / c) / 2, W / c, H / c, 0, 0, W, H);
          }
        };
        // la toile à la taille de la balise (px CSS `w`, `h`) × la densité de l'écran, au plus 2 ; vidée par ce changement, la suite se redessine
        var size = function(w, h) {
          if (!(w > 0 && h > 0)) return;
          var d  = Math.min(2, window.devicePixelRatio || 1);
          var bw = Math.max(1, Math.round(w * d));
          var bh = Math.max(1, Math.round(h * d));
          if (bw === el.width && bh === el.height) return;
          el.width  = bw;
          el.height = bh;
          // une toile sans taille CSS prend celle de son contenu : agrandie, elle grossirait à chaque mesure ; relue une seule fois,
          // elle est alors fixée à la taille qu'elle avait
          if (!tested) {
            tested = true;
            var b = µ._mjs_dom.getBoundingClientRect(el);
            if (Math.abs(b.width - w) > 1 || Math.abs(b.height - h) > 1) {
              pin = [el.style.width, el.style.height];
              el.style.width  = w + 'px';
              el.style.height = h + 'px';
            }
          }
          redraw();
        };
        redraw = function() {
          shown = -1;
          show(cur);
        };
        var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function(entries) {
          var r = entries[entries.length - 1].contentRect;
          size(r.width, r.height);
        }) : null;
        if (ro) ro.observe(el);
        else size(el.clientWidth, el.clientHeight);
        undo.push(function() {
          if (ro) ro.disconnect();
          if (pin) {
            el.style.width  = pin[0];
            el.style.height = pin[1];
          }
          if (w0 === null) µ._mjs_dom.removeAttribute(el, 'width');
          else µ._mjs_dom.setAttribute(el, 'width', w0);
          if (h0 === null) µ._mjs_dom.removeAttribute(el, 'height');
          else µ._mjs_dom.setAttribute(el, 'height', h0);
        });
      }
    }

    // ----- ce qui fait avancer : le défilement (suivi tant que la balise est près de la vue), ou la souris -----
    var stopScroll = null;
    var wake = function() {
      if (hover) {
        if (pump) pump();
        return;
      }
      snap = true;
      if (!stopScroll) stopScroll = µ._mjs_fxScroll(el, aim, zone);
    };
    var doze = function() {
      if (stopScroll) stopScroll();
      stopScroll = null;
      if (raf) cancelAnimationFrame(raf);
      raf  = 0;
      last = 0;
      if (drop) drop();
    };
    if (hover) {
      var box   = null;
      var enter = function() { box = µ._mjs_dom.getBoundingClientRect(el); };
      var move  = function(e) {
        if (!box) enter();
        if (box.width > 0) aim(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
      };
      µ._mjs_dom.addEventListener(el, 'pointerenter', enter);
      µ._mjs_dom.addEventListener(el, 'pointermove', move, { passive: true });
      undo.push(function() {
        µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
        µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      });
    }
    // une balise à plus d'un écran de la vue ne suit rien, ne charge rien et ne garde rien en mémoire ; sans observateur, elle est toujours près
    var io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(function(entries) {
        var yes = entries[entries.length - 1].isIntersecting;
        if (yes === near) return;
        near = yes;
        if (yes) wake();
        else doze();
      }, { rootMargin: '100% 0px' });
      io.observe(el);
    }
    else wake();

    var off = function() {
      gone = true;
      if (io) io.disconnect();
      doze();
      for (var u = undo.length - 1; u >= 0; u--) undo[u]();
    };
    // le lissage, la portion, le sens, le cadrage et la zone suivis sur place ; le reste (la suite, le mode) relance l'effet
    off.set = function(k, v) {
      if (k === 'smooth') {
        smooth = v === void 0 ? 0.15 : v;
        tune();
      }
      else if (k === 'from' || k === 'to' || k === 'reverse') {
        if (k === 'from') from = v === void 0 ? 0 : v;
        else if (k === 'to') to = v === void 0 ? 1 : v;
        else back = v === true;
        paint();
      }
      else if (k === 'fit') {
        fit = v === 'contain' ? 'contain' : 'cover';
        if (redraw) redraw();
      }
      else if (k === 'zone') {
        zone = v;
        if (stopScroll) {
          stopScroll();
          stopScroll = µ._mjs_fxScroll(el, aim, zone);
        }
      }
      else return false;
    };
    return off;
  }
};
