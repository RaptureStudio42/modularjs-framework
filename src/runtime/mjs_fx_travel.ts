// mjs_fx_travel — `*travel` : la balise voyage, au fil du défilement, de sa place jusqu'à celle d'une autre balise
// (sa destination) : elle en prend peu à peu la position et la taille, en tournant si on le veut ; on remonte, elle
// revient. Plusieurs destinations, séparées par des virgules : elle passe par chacune, dans l'ordre, et reste posée
// sur celle qu'elle a atteinte entre deux étapes.
// Réglages : to (le sélecteur CSS de la destination — plusieurs séparés par des virgules = des étapes ; exigé),
// rotate (la rotation à plat faite sur tout le voyage, en degrés ; 0), spin (la rotation autour de l'axe vertical, la
// balise se retourne, en degrés, sans perspective ; 0), arc (la bosse du chemin, en px : 0 = ligne droite, positif = le
// chemin bombe vers la droite quand le voyage descend la page ; 0), size (la balise prend aussi la taille de la
// destination, la plus grande qui y tienne sans la déformer ; true), zone (la bande de l'écran où se joue chaque étape :
// elle commence quand sa place de départ est à la première hauteur, elle finit quand sa place d'arrivée est à la seconde ;
// sans zone, le milieu de l'écran pour les deux), easing (la courbe de chaque étape : un mot CSS, cubic-bezier(…) ou une
// courbe de µeasing comme back-out ; ease-in-out), smooth (la traîne du mouvement derrière le défilement, en secondes :
// 0 = collée au défilement, 1 = très amortie ; 0.12), fade (la destination est cachée — visibility — tant que la balise
// n'y est pas arrivée ; false).
// Technique : la balise RESTE dans le flux, elle ne bouge que par les propriétés `translate`, `rotate` et `scale`
// (écrites en direct, sans variable CSS : rien ne se recalcule dans ses enfants) ; sa `transform` n'est pas touchée,
// et son origine de transformation est supposée au centre (celle par défaut). Les places — la sienne, celles des
// destinations — sont lues en coordonnées du défilement (celui de la page, ou du conteneur qui défile autour d'elle),
// UNE fois à la pose, puis quand une boîte change de taille (ResizeObserver sur la balise, les destinations, le document
// et le conteneur) : pendant le défilement, seule la position de défilement est lue. Une seule boucle d'images, lancée
// par le défilement, qui rejoint la cible en douceur (smooth) puis s'arrête d'elle-même ; `will-change` n'est posé que
// pendant ce mouvement. À plus d'un écran du voyage rien ne se voit : la balise est posée d'un coup, sans animation.
// Loin de l'écran (la balise et ses destinations à plus de 200 px, le défilement hors du voyage : rien ne se voit) l'effet
// n'écoute rien, ni le défilement ni la taille : un observateur de visibilité pose les écouteurs quand l'une d'elles
// approche, ou quand le défilement est en plein voyage, et les rend quand elles s'éloignent ; la balise attend alors sur
// sa place, et se pose d'un coup là où le défilement la veut dès que l'écran s'en rapproche. Une étape ne commence
// jamais avant le haut du défilement : à 0 de défilement la balise est sur sa place, où qu'elle soit dans l'écran. Le
// `transform` de l'auteur, quand il déplace le centre de la balise, est compté : l'échelle et la rotation de l'effet
// s'y appliquent aussi, la balise arrive pile sur sa destination.
// Destinations cherchées dans la racine où vit la balise (le shadow root de son composant), puis dans celle du composant
// qui la contient, et ainsi de suite jusqu'à la page — la plus proche l'emporte ; une destination introuvable est
// signalée une fois en console, son étape est sautée, et elle est cherchée de nouveau à chaque défilement tant
// qu'elle manque. « Réduire les animations » : ni traîne ni rotation, la balise saute d'une place à l'autre à
// mi-chemin de chaque étape.
// Limites : un ancêtre qui rogne (overflow) rogne aussi la balise en vol ; une balise fixe ou collante n'a pas de place
// de repos dans le défilement ; la balise et ses destinations partagent le même défilement.

// la courbe d'un réglage `easing`, en JavaScript : une fonction de 0 à 1 (un mot CSS, cubic-bezier(…), ou une courbe
// de µeasing écrite en kebab, bounce-out → µ.easing.bounceOut)
function _mjsFxTravelEase(v) {
  var kw = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
  var b  = typeof v === 'string' && Object.prototype.hasOwnProperty.call(kw, v) ? kw[v] : null;
  if (!b && typeof v === 'string') {
    var m = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(v);
    if (m) b = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  if (b) {
    if (b[0] === b[1] && b[2] === b[3]) return function(t) { return t; };
    var at = function(t, p, q) { return 3 * p * t * (1 - t) * (1 - t) + 3 * q * t * t * (1 - t) + t * t * t; };
    return function(x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0;
      var hi = 1;
      for (var i = 0; i < 24; i++) {
        var mid = (lo + hi) / 2;
        if (at(mid, b[0], b[2]) < x) lo = mid;
        else hi = mid;
      }
      return at((lo + hi) / 2, b[1], b[3]);
    };
  }
  var nom = typeof v === 'string' ? v.replace(/-(\w)/g, function(_, c) { return c.toUpperCase(); }) : '';
  if (nom && µ.easing && typeof µ.easing[nom] === 'function') return µ.easing[nom];
  return function(t) { return t; };
}

// les sélecteurs de `to`, coupés aux virgules de premier niveau (pas dans une parenthèse, un crochet ou des guillemets :
// `a:is(b, c), [d="e,f"]`)
function _mjsFxTravelSplit(v) {
  var out   = [];
  var depth = 0;
  var quote = '';
  var cur   = '';
  var str   = typeof v === 'string' ? v : '';
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    // un caractère échappé (`.a\,b`, `[d="e\"f"]`) reste dans son sélecteur
    if (c === '\\') {
      cur += c + str.charAt(++i);
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
    }
    else if (c === '"' || c === '\'') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(function(x) { return x !== ''; });
}

// la destination d'un sélecteur : dans chaque racine où vit la balise, de la plus proche à la page — la plus proche
// l'emporte ; null si introuvable, false si illisible (un sélecteur faux ne casse rien, et n'est pas cherché de nouveau)
function _mjsFxTravelFind(el, sel) {
  var list = µ._mjs_fxRoots(el).filter(function(r) { return r.nodeType === 11 || r.nodeType === 9; });
  if (list.indexOf(document) < 0) list.push(document);
  for (var i = 0; i < list.length; i++) {
    try {
      var hit = µ._mjs_dom.querySelector(list[i], sel);
      if (hit && hit !== el && !µ._mjs_dom.contains(el, hit)) return hit;
    }
    catch (e) {
      return false;
    }
  }
  return null;
}

// la rotation à plat `flat` composée à celle autour de l'axe vertical `turn` (degrés) en UNE seule propriété `rotate`
// (axe et angle, par un quaternion) : la balise se retourne d'abord, puis tourne à plat — comme `rotate(flat) rotateY(turn)`
function _mjsFxTravelRotate(flat, turn) {
  if (!turn) return flat ? flat.toFixed(2) + 'deg' : '';
  var a = flat * Math.PI / 360;
  var b = turn * Math.PI / 360;
  var w = Math.cos(a) * Math.cos(b);
  var x = -Math.sin(a) * Math.sin(b);
  var y = Math.cos(a) * Math.sin(b);
  var z = Math.sin(a) * Math.cos(b);
  var s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-6) return '';
  return (x / s).toFixed(5) + ' ' + (y / s).toFixed(5) + ' ' + (z / s).toFixed(5) + ' ' + (2 * Math.atan2(s, w) * 180 / Math.PI).toFixed(2) + 'deg';
}

// de combien le `transform` de l'auteur déplace le centre de la balise (origine au centre) : la translation de sa matrice
// calculée, { x, y } en px ; null quand il ne le déplace pas
function _mjsFxTravelShift(el) {
  var m = typeof getComputedStyle === 'function' ? /^matrix(3d)?\(([^)]*)\)$/.exec(getComputedStyle(el).transform || '') : null;
  if (!m) return null;
  var v = m[2].split(',');
  var x = parseFloat(v[m[1] ? 12 : 4]) || 0;
  var y = parseFloat(v[m[1] ? 13 : 5]) || 0;
  return x || y ? { x: x, y: y } : null;
}

µ._mjs_fxDefs.travel = {
  setup: function(el, s) {
    var DFLT   = { rotate: 0, spin: 0, arc: 0, size: true, easing: 'ease-in-out', smooth: 0.12, fade: false };
    var cfg    = { to: s.to, zone: s.zone };
    var inline = µ._mjs_fxMovable(el);
    // le style de la balise avant l'effet : rendu au retrait
    var orig   = { translate: el.style.getPropertyValue('translate'), rotate: el.style.getPropertyValue('rotate'), scale: el.style.getPropertyValue('scale'), 'will-change': el.style.getPropertyValue('will-change') };
    var shown  = { translate: '', rotate: '', scale: '' };
    for (var k0 in DFLT) cfg[k0] = s[k0] === void 0 ? DFLT[k0] : s[k0];
    var parts   = _mjsFxTravelSplit(cfg.to);
    var dests   = [];
    var warned  = {};
    var ease    = _mjsFxTravelEase(cfg.easing);
    var ro      = null;
    var io      = null;
    var watched = [];
    var seen    = [];
    var near    = [];
    var roots   = µ._mjs_fxRoots(el);
    var S       = null;
    var adopted = null;
    var places  = [];
    var stops   = [null];
    var shift   = null;
    var hid     = [];
    var saved   = [];
    var A       = [0];
    var B       = [0];
    var Sc      = [1];
    var lo      = 0;
    var hi      = 0;
    var margin  = 0;
    var eps     = 0.001;
    var calm    = false;
    var ready   = false;
    var gone    = false;
    var armed   = false;
    var moving  = false;
    var cur     = 0;
    var target  = 0;
    var last    = 0;
    var raf     = 0;

    // écrit une propriété de l'effet (rend celle d'avant, ou la retire, pour une valeur vide) — seulement si elle change
    var put = function(name, value) {
      if (shown[name] === value) return;
      shown[name] = value;
      if (value !== '') el.style.setProperty(name, value);
      else if (orig[name]) el.style.setProperty(name, orig[name]);
      else el.style.removeProperty(name);
    };
    // la hauteur visible et la position de défilement du conteneur (ou de la page)
    var view = function() { return S ? S.clientHeight : window.innerHeight || document.documentElement.clientHeight || 1; };
    var read = function() { return S ? S.scrollTop : window.scrollY || document.documentElement.scrollTop || 0; };
    // le conteneur le plus proche qui défile : cherché à chaque mesure, un conteneur n'a pas toujours sa taille à la pose
    var seek = function() {
      if (typeof getComputedStyle !== 'function') return null;
      for (var n = µ._mjs_fxParent(el); n && n.nodeType === 1 && n !== document.documentElement; n = µ._mjs_fxParent(n)) {
        var oy = getComputedStyle(n).overflowY || '';
        // un conteneur qui défile, ou un overflow caché que le script a déjà fait défiler
        if ((/(auto|scroll)/.test(oy) && n.scrollHeight > n.clientHeight) || (oy === 'hidden' && n.scrollTop > 0)) return n;
      }
      return null;
    };
    // une place : le centre et la taille d'une boîte, dans l'espace du défilement (x, y du contenu) ; null si elle ne s'affiche pas
    var place = function(node, bx, by) {
      var r = µ._mjs_dom.getBoundingClientRect(node);
      if (!(r.width || r.height)) return null;
      return { x: r.left + bx + r.width / 2, y: r.top + by + r.height / 2, w: r.width, h: r.height };
    };
    // la visibilité rendue aux destinations cachées
    var release = function() {
      for (var k = 1; k < stops.length; k++) {
        if (!hid[k]) continue;
        stops[k].style.visibility = saved[k];
        hid[k] = false;
      }
    };
    // `fade` : une destination reste cachée tant que la balise n'y est pas arrivée
    var reveal = function(u) {
      for (var k = 1; k < stops.length; k++) {
        var hide = cfg.fade && !(u >= k - eps);
        if (!!hid[k] === hide) continue;
        if (hide) saved[k] = stops[k].style.visibility;
        stops[k].style.visibility = hide ? 'hidden' : saved[k];
        hid[k] = hide;
      }
    };
    // les bornes de chaque étape, en position de défilement : 0 quand la place de départ est à la première hauteur de la
    // zone, 1 quand la place d'arrivée est à la seconde ; une étape ne commence jamais avant la fin de la précédente
    var plan = function() {
      var n  = places.length - 1;
      var z  = µ._mjs_fxZone(cfg.zone) || [0.5, 0.5];
      var h  = view();
      var px = 1;
      var ds = 0;
      A  = [0];
      B  = [0];
      Sc = [1];
      for (var k = 1; k <= n; k++) {
        var p = places[k - 1];
        var q = places[k];
        A[k] = p.y - z[0] * h;
        B[k] = q.y - z[1] * h;
        // le voyage commence quand on défile : aucune étape ne démarre avant le haut du défilement ; une destination déjà
        // atteinte à ce moment-là est rejointe d'un coup, dès le premier défilement
        if (A[k] < 0) {
          A[k] = 0;
          if (B[k] < 0) B[k] = 0;
        }
        if (k > 1 && B[k - 1] > A[k - 1] && A[k] < B[k - 1]) A[k] = B[k - 1];
        Sc[k] = cfg.size && places[0].w > 0 && places[0].h > 0 && q.w > 0 && q.h > 0 ? Math.min(q.w / places[0].w, q.h / places[0].h) : 1;
        px = Math.max(px, Math.sqrt(Math.pow(q.x - p.x, 2) + Math.pow(q.y - p.y, 2)) + Math.abs(cfg.arc));
        ds = Math.max(ds, Math.abs(Sc[k] - Sc[k - 1]));
      }
      lo = n > 0 ? Math.min.apply(null, A.slice(1).concat(B.slice(1))) : 0;
      hi = n > 0 ? Math.max.apply(null, A.slice(1).concat(B.slice(1))) : 0;
      margin = h + Math.abs(cfg.arc);
      // l'écart sous lequel la balise est arrivée : un demi-pixel, un demi-degré, quelques millièmes d'échelle
      eps = Math.min(0.5 / px, 0.5 * Math.max(n, 1) / Math.max(1, Math.abs(cfg.rotate) + Math.abs(cfg.spin)), 0.004 / Math.max(ds, 0.01));
    };
    // l'avancée du voyage, de 0 (sur sa place) à n (sur la dernière destination), pour une position de défilement
    var progress = function(pos) {
      var u = 0;
      for (var k = 1; k < A.length; k++) {
        var t = B[k] === A[k] ? (pos > A[k] ? 1 : 0) : (pos - A[k]) / (B[k] - A[k]);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (calm) t = t >= 0.5 ? 1 : 0;
        if (t > 0) u = k - 1 + t;
      }
      return u;
    };
    // pose la balise à l'avancée `cur`
    var draw = function() {
      var n = places.length - 1;
      var u = cur;
      if (n < 1 || !(u > 0)) {
        put('translate', '');
        put('rotate', '');
        put('scale', '');
        reveal(0);
        return;
      }
      var j = Math.min(n, Math.ceil(u));
      var e = u - (j - 1) >= 1 ? 1 : ease(u - (j - 1));
      var a = places[j - 1];
      var b = places[j];
      var x = a.x + (b.x - a.x) * e;
      var y = a.y + (b.y - a.y) * e;
      // la bosse du chemin : perpendiculaire à l'étape, à sa droite pour une étape qui descend (dx et dy sont déclarés plus bas, ils servent deux fois)
      if (cfg.arc) {
        dx      = b.x - a.x;
        dy      = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          var m = cfg.arc * Math.sin(Math.PI * (e < 0 ? 0 : e > 1 ? 1 : e)) / len;
          x += dy * m;
          y -= dx * m;
        }
      }
      var f  = (j - 1 + e) / n;
      var sc = cfg.size ? Sc[j - 1] + (Sc[j] - Sc[j - 1]) * e : 1;
      var dx = x - places[0].x;
      var dy = y - places[0].y;
      // le décalage du centre par le `transform` de l'auteur passe lui aussi par l'échelle et la rotation de l'effet : sans
      // ce rattrapage la balise arriverait décalée de (1 - échelle) fois ce décalage, tourné
      if (shift) {
        var ang = calm ? 0 : cfg.rotate * f * Math.PI / 180;
        var tur = calm ? 0 : cfg.spin * f * Math.PI / 180;
        var sx  = shift.x * Math.cos(tur);
        dx += shift.x - sc * (sx * Math.cos(ang) - shift.y * Math.sin(ang));
        dy += shift.y - sc * (sx * Math.sin(ang) + shift.y * Math.cos(ang));
      }
      put('translate', dx.toFixed(2) + 'px ' + dy.toFixed(2) + 'px');
      put('scale', cfg.size ? sc.toFixed(4) : '');
      put('rotate', calm ? '' : _mjsFxTravelRotate(cfg.rotate * f, cfg.spin * f));
      reveal(u);
    };
    var settle = function() {
      if (!moving) return;
      moving = false;
      if (orig['will-change']) el.style.setProperty('will-change', orig['will-change']);
      else el.style.removeProperty('will-change');
    };
    // la boucle : rejoint la cible en douceur (indépendante de la cadence), s'arrête dès qu'elle y est
    var tick = function(now) {
      raf = 0;
      var t   = typeof now === 'number' ? now : Date.now();
      var dt  = last ? Math.min(Math.max(t - last, 0), 100) : 16.7;
      var tau = Math.max(cfg.smooth * 1000, 1);
      last = t;
      var d = target - cur;
      if (Math.abs(d) < eps) cur = target;
      else cur += d * (1 - Math.exp(-dt / tau));
      draw();
      if (cur !== target) raf = requestAnimationFrame(tick);
      else {
        last = 0;
        settle();
      }
    };
    var go = function() {
      if (raf) return;
      if (typeof requestAnimationFrame !== 'function') {
        cur = target;
        draw();
        return;
      }
      if (!moving) {
        moving = true;
        el.style.setProperty('will-change', 'translate, rotate, scale');
      }
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    // la cible suit le défilement : posée d'un coup quand tout se passe hors de l'écran, sans lissage ou en mouvement réduit
    var retarget = function() {
      if (places.length < 2 || !armed) return;
      var pos = read();
      var u   = progress(pos);
      if (pos < lo - margin || pos > hi + margin || calm || cfg.smooth * 1000 < 2) {
        target = cur = u;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        settle();
        draw();
        return;
      }
      if (u === target) return;
      target = u;
      go();
    };
    // les boîtes, lues une fois : à la pose, puis quand l'une d'elles change de taille
    var measure = function() {
      if (gone) return;
      calm = µ._mjs_fxCalm();
      put('translate', '');
      put('rotate', '');
      put('scale', '');
      release();
      S = adopted || seek();
      shift = _mjsFxTravelShift(el);
      var bx  = window.scrollX || 0;
      var by  = window.scrollY || 0;
      if (S) {
        var box = µ._mjs_dom.getBoundingClientRect(S);
        bx = S.scrollLeft - box.left - S.clientLeft;
        by = S.scrollTop - box.top - S.clientTop;
      }
      var own = place(el, bx, by);
      places = own ? [own] : [];
      stops  = [null];
      hid    = [];
      if (own) {
        for (var i = 0; i < parts.length; i++) {
          var d = dests[i];
          if (!d || !d.isConnected) d = dests[i] = _mjsFxTravelFind(el, parts[i]);
          if (!d) {
            if (!warned[parts[i]]) {
              warned[parts[i]] = true;
              µ.warn(µ._mjs_msg('travelNone', { to: parts[i] }, '*travel : la destination « {to} » est introuvable, cette étape est sautée — vérifiez le sélecteur, il est cherché dans votre composant puis dans la page'));
            }
            continue;
          }
          if (stops.indexOf(d) > 0) continue;
          var p = place(d, bx, by);
          if (!p) continue;
          places.push(p);
          stops.push(d);
        }
      }
      plan();
      if (io) look();
      if (ro) {
        var want = [el].concat(stops.slice(1), [document.documentElement]);
        if (S) want.push(S);
        for (var a = 0; a < want.length; a++) {
          if (watched.indexOf(want[a]) < 0) ro.observe(want[a]);
        }
        for (var b = 0; b < watched.length; b++) {
          if (want.indexOf(watched[b]) < 0) ro.unobserve(watched[b]);
        }
        watched = want;
      }
      // la première fois qu'elle écoute, la balise se pose où le défilement la veut déjà (page rechargée en milieu de course)
      if (armed && !ready && places.length > 1) {
        ready = true;
        cur = target = progress(read());
      }
      draw();
      retarget();
    };
    // une destination introuvable (et lisible) à la pose, cherchée de nouveau : une recherche par sélecteur qui manque, pas
    // un observateur de plus
    var lost = function() {
      for (var i = 0; i < parts.length; i++) {
        if (warned[parts[i]] && dests[i] === null && _mjsFxTravelFind(el, parts[i])) return true;
      }
      return false;
    };
    var onScroll = function(e) {
      // une destination ajoutée depuis la pose, même hors du flux (la page ne change pas de taille) : trouvée au défilement
      if (lost()) measure();
      var t = e && e.target;
      if (t && t.nodeType === 1) {
        // un conteneur autour de la balise qui défile : s'il a défilé à la verticale c'est lui qui compte (même en overflow
        // caché, mené par un script) ; à l'horizontale il n'est pas le repère, mais la balise a changé de place : les boîtes
        // sont relues
        if (t !== S) {
          if (!µ._mjs_fxWithin(t, el)) return;
          if (t.scrollTop > 0) adopted = t;
          measure();
          return;
        }
      }
      else if (S) return;
      retarget();
    };
    var unlisten = function() {
      for (var j = 0; j < roots.length; j++) µ._mjs_dom.removeEventListener(roots[j], 'scroll', onScroll, { capture: true });
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
      ro      = null;
      watched = [];
    };
    // les écouteurs ne vivent que près de l'écran : posés quand le voyage approche (la balise se pose où le défilement la
    // veut, sans glissade), rendus quand il s'éloigne (la balise attend sur sa place de départ, loin de l'écran)
    var attach = function() {
      if (armed || gone) return;
      armed = true;
      ready = false;
      // un écouteur en capture par racine : le document reçoit aussi le défilement de la page, un écouteur de la fenêtre le lirait une seconde fois
      for (var i0 = 0; i0 < roots.length; i0++) µ._mjs_dom.addEventListener(roots[i0], 'scroll', onScroll, { capture: true, passive: true });
      if (typeof ResizeObserver === 'function') ro = new ResizeObserver(function() { measure(); });
      else window.addEventListener('resize', measure);
      measure();
    };
    var detach = function() {
      if (armed) {
        armed = false;
        unlisten();
      }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      target = cur = 0;
      draw();
      settle();
    };
    // les boîtes dont l'approche réveille l'effet : la balise et ses destinations
    var look = function() {
      var want = [el].concat(stops.slice(1));
      for (var a = 0; a < want.length; a++) {
        if (seen.indexOf(want[a]) < 0) io.observe(want[a]);
      }
      for (var b = 0; b < seen.length; b++) {
        if (want.indexOf(seen[b]) >= 0) continue;
        io.unobserve(seen[b]);
        var at = near.indexOf(seen[b]);
        if (at >= 0) near.splice(at, 1);
      }
      seen = want;
    };
    // le défilement est en plein voyage : la balise est en route, donc à l'écran, même si ni sa place ni ses destinations
    // n'en sont près (page rechargée, saut de défilement)
    var flying = function() {
      if (places.length < 2) return false;
      var pos = read();
      return pos >= lo && pos <= hi;
    };
    // l'observateur de visibilité (l'écran élargi de 200 px) : il dit quelles boîtes sont près de l'écran. Sa première
    // réponse vient après la mise en page, c'est là que les boîtes sont lues (à la pose du composant elles n'existent pas
    // encore) ; sans lui, le voyage est toujours suivi
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(function(entries) {
        if (gone) return;
        for (var i = 0; i < entries.length; i++) {
          if (seen.indexOf(entries[i].target) < 0) continue;
          var at = near.indexOf(entries[i].target);
          if (entries[i].isIntersecting && at < 0) near.push(entries[i].target);
          else if (!entries[i].isIntersecting && at >= 0) near.splice(at, 1);
        }
        // les boîtes ne sont pas toutes connues (première réponse, balise cachée jusque-là, destination absente) : relues
        if (places.length < 2) measure();
        if (near.length || flying()) attach();
        else detach();
      }, { rootMargin: '200px 0px' });
      seen = [el];
      io.observe(el);
    }
    else attach();
    var off = function() {
      if (gone) return;
      gone = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (io) io.disconnect();
      unlisten();
      release();
      put('translate', '');
      put('rotate', '');
      put('scale', '');
      settle();
      inline();
    };
    // tous les réglages se suivent sur place : la destination relit les boîtes, les autres reposent la balise
    off.set = function(k, v) {
      if (k === 'to') {
        cfg.to = v;
        parts  = _mjsFxTravelSplit(v);
        dests  = [];
        warned = {};
        measure();
        return;
      }
      cfg[k] = v === void 0 && k in DFLT ? DFLT[k] : v;
      if (k === 'easing') ease = _mjsFxTravelEase(cfg.easing);
      plan();
      draw();
      retarget();
    };
    return off;
  }
};
