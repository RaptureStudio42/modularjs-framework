// mjs_fx_spoiler — `*spoiler` : un texte caché, révélé au clic, comme les messages masqués des
// messageries. Tant qu'il est caché, le texte est transparent, ni sélectionnable ni lisible à l'écran, et
// ce qui n'est pas du texte ne se voit pas non plus (une image, un SVG, le fond d'un <mark> : chaque balise
// du contenu est transparente ; avec `blur`, les images, vidéos, SVG et toiles, le texte restant flou) ;
// la balise devient un bouton : `role="button"`, `tabindex="0"` (seulement si elle n'en a pas), un
// `aria-label` (libellés du runtime, clé `mjs.fx.spoiler` du projet, sinon « Texte masqué, activer
// pour l'afficher »), Entrée et Espace révèlent. Révélé, ces attributs sont rendus comme ils étaient.
// La balise garde son `display` : un `<span>` qui court sur plusieurs lignes continue de couler avec
// le texte. Un calque posé dans la balise (dans le composant si la balise en est un) porte les grains,
// la barre ou les pavés ; il couvre la balise (celle d'une seule boîte : tout son rectangle ; une
// balise en ligne : chacun de ses rectangles de ligne, `getClientRects()`, relu quand la mise en
// page change — redimensionnement, police chargée, texte qui se réécrit). Posez l'effet sur un
// `<span>` pour ne cacher que quelques mots. Tant que le texte est caché, ce qui s'y atteint au
// clavier (lien, bouton, champ) reçoit `tabindex="-1"` ; rendu à la révélation et au retrait.
// Réglages : style (grains : des grains qui grouillent sur le texte ; blur : le texte flou ; bar : une
// barre pleine ; pixels : de gros pavés ; grains), color (la couleur des grains, de la barre, du
// flou ; la couleur du texte), density (de 1 à 10, la quantité de grains ; 5), size (le grain en px,
// de 0.5 à 6 ; 1.2 — pour pixels, un pavé fait six fois cette taille), speed (l'agitation des grains,
// le temps d'un tour ; 1.2s), duration (le fondu de la révélation ; 500ms), on (click : un clic révèle ;
// hover : le survol révèle, la sortie recache ; click), again (un second clic recache ; non),
// revealed (l'état, à tenir par une variable : vrai révèle, faux recache ; non), radius (l'arrondi du
// calque ; 4).
// À la révélation, la balise émet l'événement DOM `mjs:reveal` (il remonte, même hors d'un composant), quelle qu'en soit la cause.
// « Réduire les animations » : les grains ne bougent pas, le fondu est immédiat. Les grains ne
// tournent que tant que le texte est caché et à l'écran.

(function() {
  var A = '[mjs-fx~="spoiler"][mjs-fx-spoiler-hidden]';
  var D = 'var(--mjs-spoiler-duration,500ms)';
  var L = '[mjs-fx-layer="spoiler"]';
  // la règle sur la balise cachée ; dans un composant, le calque vit dans son shadow root (`:host`)
  var H = function(sub, body) { return A + sub + '{' + body + '}:host(' + A + ')' + sub + '{' + body + '}'; };
  // une règle sur le contenu de la balise cachée d'un style (`:not(…)`, ou le style lui-même), dans la page et dans un composant
  var C = function(cond, sub, body) { return A + cond + ' ' + sub + '{' + body + '}:host(' + A + cond + ') ' + sub + '{' + body + '}'; };
  µ._mjs_fxDefs.spoiler = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    css: '[mjs-fx~="spoiler"]{transition:color ' + D + ',-webkit-text-fill-color ' + D + ',text-shadow ' + D + '}'
      + H('', 'color:transparent;-webkit-text-fill-color:transparent;-webkit-user-select:none;user-select:none;cursor:pointer')
      + A + ' *{color:inherit;-webkit-text-fill-color:inherit;text-shadow:inherit}'
      + A + '[mjs-fx-spoiler-style="blur"]{text-shadow:0 0 .4em var(--mjs-spoiler-color,var(--mjs-fx-spoiler-ink))}'
      // ce qui n'est pas du texte : sous un calque, chaque balise du contenu (sauf le calque) ; sous le flou, les médias
      + C(':not([mjs-fx-spoiler-style="blur"])', '*:not(' + L + ')', 'opacity:0')
      + C('[mjs-fx-spoiler-style="blur"]', ':is(img,picture,video,svg,canvas,iframe,object,embed)', 'opacity:0')
      + L + '{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;border-radius:inherit;opacity:0;transition:opacity ' + D + '}'
      + L + '[mjs-fx-spoiler-kind="bar"]:not([mjs-fx-spoiler-lines]){background:var(--mjs-spoiler-color,var(--mjs-fx-spoiler-ink))}'
      + L + '[mjs-fx-spoiler-lines]{inset:auto;left:var(--mjs-fx-spoiler-x,0);top:var(--mjs-fx-spoiler-y,0);width:var(--mjs-fx-spoiler-w,0);height:var(--mjs-fx-spoiler-h,0);border-radius:0}'
      + H(' > ' + L, 'opacity:1')
      + '@media (prefers-reduced-motion:reduce){[mjs-fx~="spoiler"],' + L + '{transition:none}}',
    vars: { color: '', duration: '' },
    radius: true,
    setup: function(el, s) {
      var host = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'spoiler');
      var restoreRel = µ._mjs_fxRelative(el);
      var kind    = /^(grains|blur|bar|pixels)$/.test(s.style) ? s.style : 'grains';
      var hover   = s.on === 'hover';
      var again   = s.again === true;
      var color   = s.color || '';
      var density = s.density === void 0 ? 5 : s.density;
      var size    = s.size === void 0 ? 1.2 : s.size;
      var period  = µ._mjs_fxMs(s.speed, 1200);
      var cs      = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      var ink     = (cs && cs.color) || '#000';
      // l'effet vient d'être défait dans la même tâche (reposé, relancé) : le texte reprend sa couleur par une transition, et sa couleur d'alors est encore transparente
      if (cs && typeof Element === 'function' && typeof Element.prototype.getAnimations === 'function') {
        µ._mjs_dom.getAnimations(el).forEach(function(a) { if (/^(color|-webkit-text-fill-color|text-shadow)$/.test(a.transitionProperty)) a.finish(); });
        ink = cs.color || ink;
      }
      // une balise en ligne : le calque couvre chacun de ses rectangles de ligne, la balise garde son display
      var lines   = !!cs && cs.display === 'inline';
      el.style.setProperty('--mjs-fx-spoiler-ink', ink);
      µ._mjs_dom.setAttribute(el, 'mjs-fx-spoiler-style', kind);
      // le calque : une toile (grains, pavés), une pastille (barre), rien pour le flou
      var layer = null;
      if (kind !== 'blur') {
        layer = document.createElement(kind === 'bar' && !lines ? 'span' : 'canvas');
        layer.setAttribute('mjs-fx-layer', 'spoiler');
        layer.setAttribute('mjs-fx-spoiler-kind', kind);
        if (lines) layer.setAttribute('mjs-fx-spoiler-lines', '');
        layer.setAttribute('aria-hidden', 'true');
        if (s.radius === void 0) layer.style.borderRadius = '4px';
        µ._mjs_dom.appendChild(host, layer);
      }
      var ctx = null;
      try {
        ctx = layer && (kind !== 'bar' || lines) ? layer.getContext('2d') : null;
      }
      catch {
        ctx = null;
      }
      var W      = 0;
      var H2     = 0;
      var points = [];
      var rects  = [];
      var seen   = '';
      var frame  = 0;
      var tick   = 0;
      var shown  = true;
      var gone   = false;
      var hidden = false;
      var saved  = null;
      var raf    = function(f) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : 0; };
      var ink2   = function() { return color || ink; };
      // les grains (ou les pavés) : une position, une phase, un des trois niveaux de transparence
      var build = function() {
        points = [];
        if (!ctx || !W) return;
        if (kind === 'pixels') {
          var cell = Math.max(3, Math.round(size * 6));
          for (var y = 0; y < H2; y += cell) {
            for (var x = 0; x < W; x += cell) points.push({ x: x, y: y, w: Math.min(cell, W - x), h: Math.min(cell, H2 - y), a: Math.random() * 6.2832 });
          }
          return;
        }
        var n = Math.max(1, Math.min(4000, Math.round(W * H2 * density * 0.07 / Math.max(1, size * size / 1.44))));
        for (var i = 0; i < n; i++) points.push({ x: Math.random() * W, y: Math.random() * H2, a: Math.random() * 6.2832, b: Math.random() * 6.2832, r: 1.5 + Math.random() * 2.5, l: i % 3 });
      };
      // une image au temps t (en ms) : les grains tournent chacun sur sa petite courbe, les pavés
      // clignotent chacun à sa phase
      var draw = function(t) {
        if (!ctx || !W) return;
        ctx.clearRect(0, 0, W, H2);
        if (kind === 'bar') {
          ctx.fillStyle = µ._mjs_fxCss(el, '--mjs-spoiler-color') || ink2();
          ctx.fillRect(0, 0, W, H2);
          return;
        }
        ctx.fillStyle = ink2();
        var w = 6.2832 * t / period;
        var i;
        if (kind === 'pixels') {
          for (i = 0; i < points.length; i++) {
            var c = points[i];
            ctx.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(w + c.a));
            ctx.fillRect(c.x, c.y, c.w - 1, c.h - 1);
          }
          ctx.globalAlpha = 1;
          return;
        }
        for (var l = 0; l < 3; l++) {
          ctx.globalAlpha = [0.45, 0.7, 1][l];
          ctx.beginPath();
          for (i = l; i < points.length; i += 3) {
            var p = points[i];
            ctx.rect(p.x + p.r * Math.cos(w + p.a), p.y + p.r * Math.sin(w * 1.7 + p.b), size, size);
          }
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      // la taille de la balise : la toile la suit (densité de l'écran, deux au plus)
      var fit = function() {
        if (!ctx) return;
        if (lines) {
          fitLines();
          return;
        }
        var w = el.clientWidth;
        var h = el.clientHeight;
        if (!w || !h || (w === W && h === H2)) return;
        W  = w;
        H2 = h;
        var dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
        layer.width  = Math.max(1, Math.round(W * dpr));
        layer.height = Math.max(1, Math.round(H2 * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        build();
        draw(tick);
      };
      // une balise en ligne : la boîte englobante de ses lignes porte la toile, un clip la limite aux
      // rectangles de chaque ligne ; l'origine se mesure sur le calque lui-même (le bloc conteneur d'une
      // balise en ligne coupée sur plusieurs lignes n'a pas la même origine partout)
      var fitLines = function() {
        var list = [];
        var all  = µ._mjs_dom.getClientRects(el);
        for (var i = 0; i < all.length; i++) {
          if (all[i].width > 0 && all[i].height > 0) list.push(all[i]);
        }
        // plus de texte : plus de ligne à couvrir, le calque n'a plus de surface
        if (!list.length) {
          if (seen === '') return;
          seen = '';
          layer.style.setProperty('--mjs-fx-spoiler-w', '0px');
          layer.style.setProperty('--mjs-fx-spoiler-h', '0px');
          return;
        }
        var x0 = Infinity;
        var y0 = Infinity;
        var x1 = -Infinity;
        var y1 = -Infinity;
        for (i = 0; i < list.length; i++) {
          x0 = Math.min(x0, list[i].left);
          y0 = Math.min(y0, list[i].top);
          x1 = Math.max(x1, list[i].right);
          y1 = Math.max(y1, list[i].bottom);
        }
        var rel = list.map(function(r) { return { x: r.left - x0, y: r.top - y0, w: r.width, h: r.height }; });
        var key = rel.map(function(r) { return Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.w) + ',' + Math.round(r.h); }).join(';');
        if (key === seen) return;
        seen = key;
        layer.style.setProperty('--mjs-fx-spoiler-x', '0px');
        layer.style.setProperty('--mjs-fx-spoiler-y', '0px');
        var origin = layer.getBoundingClientRect();
        layer.style.setProperty('--mjs-fx-spoiler-x', (x0 - origin.left) + 'px');
        layer.style.setProperty('--mjs-fx-spoiler-y', (y0 - origin.top) + 'px');
        layer.style.setProperty('--mjs-fx-spoiler-w', (x1 - x0) + 'px');
        layer.style.setProperty('--mjs-fx-spoiler-h', (y1 - y0) + 'px');
        rects = rel;
        W  = Math.max(1, Math.ceil(x1 - x0));
        H2 = Math.max(1, Math.ceil(y1 - y0));
        var dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
        layer.width  = Math.max(1, Math.round(W * dpr));
        layer.height = Math.max(1, Math.round(H2 * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        var rad = typeof s.radius === 'number' ? s.radius : 4;
        for (i = 0; i < rects.length; i++) {
          if (typeof ctx.roundRect === 'function') ctx.roundRect(rects[i].x, rects[i].y, rects[i].w, rects[i].h, rad);
          else ctx.rect(rects[i].x, rects[i].y, rects[i].w, rects[i].h);
        }
        ctx.clip();
        build();
        draw(tick);
      };
      // la minuterie : seulement tant que le texte est caché, à l'écran, et que l'animation est permise ;
      // une image sur deux au plus (trente par seconde)
      var last    = 0;
      var checked = 0;
      var loop = function(t) {
        frame = 0;
        if (gone || !hidden || !shown || !ctx) return;
        if (lines && t - checked >= 250) {
          checked = t;
          fit();
        }
        if (kind !== 'bar' && t - last >= 33) {
          last = t;
          tick = t;
          draw(t);
        }
        frame = raf(loop);
      };
      var run = function() {
        if (!frame && hidden && shown && ctx && kind !== 'bar' && !gone && !µ._mjs_fxCalm()) frame = raf(loop);
      };
      var halt = function() {
        if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        frame = 0;
      };
      // la balise comme un bouton, le temps où le texte est caché
      var lock = function() {
        saved = { role: µ._mjs_dom.getAttribute(el, 'role'), tab: µ._mjs_dom.getAttribute(el, 'tabindex'), label: µ._mjs_dom.getAttribute(el, 'aria-label'), inner: [] };
        // ce qui s'atteint au clavier dans le texte caché sort de la tabulation, le temps où il est caché
        var found = µ._mjs_dom.querySelectorAll(el, 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]');
        for (var i = 0; i < found.length; i++) {
          if (µ._mjs_dom.hasAttribute(found[i], 'mjs-fx-layer')) continue;
          saved.inner.push({ node: found[i], tab: µ._mjs_dom.getAttribute(found[i], 'tabindex') });
          µ._mjs_dom.setAttribute(found[i], 'tabindex', '-1');
        }
        µ._mjs_dom.setAttribute(el, 'role', 'button');
        if (saved.tab === null) µ._mjs_dom.setAttribute(el, 'tabindex', '0');
        µ._mjs_dom.setAttribute(el, 'aria-label', µ._mjs_fxLabel('spoiler'));
      };
      var unlock = function() {
        if (!saved) return;
        var back2 = function(node, v) {
          if (v === null) µ._mjs_dom.removeAttribute(node, 'tabindex');
          else µ._mjs_dom.setAttribute(node, 'tabindex', v);
        };
        var back = function(name, v) {
          if (v === null) µ._mjs_dom.removeAttribute(el, name);
          else µ._mjs_dom.setAttribute(el, name, v);
        };
        back('role', saved.role);
        back('aria-label', saved.label);
        if (saved.tab === null) µ._mjs_dom.removeAttribute(el, 'tabindex');
        for (var i = 0; i < saved.inner.length; i++) back2(saved.inner[i].node, saved.inner[i].tab);
        saved = null;
      };
      var hide = function() {
        if (hidden || gone) return;
        hidden = true;
        µ._mjs_dom.setAttribute(el, 'mjs-fx-spoiler-hidden', '');
        lock();
        run();
      };
      var show = function() {
        if (!hidden || gone) return;
        hidden = false;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-spoiler-hidden');
        unlock();
        halt();
        µ._mjs_dom.dispatchEvent(el, new CustomEvent('mjs:reveal', { bubbles: true, composed: true }));
      };
      // au doigt, rien ne survole : le navigateur envoie la sortie juste après le toucher. En `on: hover`, un toucher (ou une
      // activation sans pointeur, `detail` nul) montre donc le texte et le suivant le recache, comme le survol et la sortie
      var finger = false;
      var touch  = function(e) { finger = e.pointerType === 'touch'; };
      var click = function(e) {
        var tap = hover && (finger || e.pointerType === 'touch' || e.detail === 0);
        if (hover && !tap) return;
        if (hidden) {
          e.preventDefault();
          show();
        }
        else if (again || tap) hide();
      };
      var key = function(e) {
        if (!hidden || e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        show();
      };
      var enter = function(e) { if (e.pointerType !== 'touch') show(); };
      var leave = function(e) { if (e.pointerType !== 'touch') hide(); };
      µ._mjs_dom.addEventListener(el, 'click', click);
      µ._mjs_dom.addEventListener(el, 'keydown', key);
      if (hover) {
        µ._mjs_dom.addEventListener(el, 'pointerdown', touch);
        µ._mjs_dom.addEventListener(el, 'pointerenter', enter);
        µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
      }
      var ro = ctx && typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
      if (ro) {
        ro.observe(el);
        if (lines && el.parentElement) ro.observe(el.parentElement);
      }
      // une balise en ligne n'a pas de boîte à observer : la fenêtre, le parent, une police qui arrive
      // (même tard) et le texte qui se réécrit préviennent
      var onResize = function() {
        if (!gone) fit();
      };
      var fonts = ctx && lines && typeof document.fonts === 'object' && document.fonts ? document.fonts : null;
      var mo    = ctx && lines && typeof MutationObserver === 'function' ? new MutationObserver(onResize) : null;
      // une police qui arrive : le calque est relu une fois, à la fin du chargement. `loading` (un chargement
      // commence) arme la reprise ; la fin se dit par `ready` (neuf à cet instant) et par `loadingdone` : WebKit
      // n'émet que `loading` puis `ready`, Chromium résout `ready` après `loadingdone`, Firefox avant. Le premier
      // signal relit ; le second, son jumeau, laisse la lecture faite
      var waiting = false;
      var twin    = false;
      var byReady = function() {
        if (!waiting) return;
        waiting = false;
        twin    = true;
        onResize();
      };
      var byDone = function() {
        var paired = twin;
        twin       = false;
        waiting    = false;
        if (!paired) onResize();
      };
      var onLoading = function() {
        waiting = true;
        twin    = false;
        if (fonts.ready) fonts.ready.then(byReady);
      };
      if (ctx && lines) {
        window.addEventListener('resize', onResize);
        if (fonts && typeof fonts.addEventListener === 'function') {
          fonts.addEventListener('loading', onLoading);
          fonts.addEventListener('loadingdone', byDone);
        }
        // une police déjà en route à la pose : son `loading` est parti avant l'effet, qui ne l'a pas entendu
        if (fonts && fonts.status === 'loading') onLoading();
        if (mo) mo.observe(el, { childList: true, characterData: true, subtree: true });
      }
      var io = ctx && typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(entries) {
        shown = entries[entries.length - 1].isIntersecting;
        if (shown) run();
        else halt();
      }) : null;
      if (io) io.observe(el);
      fit();
      if (s.revealed !== true) hide();
      var off = function() {
        µ._mjs_dom.removeEventListener(el, 'click', click);
        µ._mjs_dom.removeEventListener(el, 'keydown', key);
        µ._mjs_dom.removeEventListener(el, 'pointerdown', touch);
        µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
        µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        if (mo) mo.disconnect();
        if (fonts && typeof fonts.removeEventListener === 'function') {
          fonts.removeEventListener('loading', onLoading);
          fonts.removeEventListener('loadingdone', byDone);
        }
        window.removeEventListener('resize', onResize);
        halt();
        gone = true;
        unlock();
        if (layer) layer.remove();
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-spoiler-hidden');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-spoiler-style');
        el.style.removeProperty('--mjs-fx-spoiler-ink');
        restoreRel();
      };
      // l'état tenu par une variable, la couleur, la quantité, la taille, la vitesse, le « un second clic » :
      // suivis sur place ; le style et le déclencheur : l'effet repart
      off.set = function(k, v) {
        if (k === 'revealed') {
          if (v === true) show();
          else hide();
        }
        else if (k === 'again') again = v === true;
        else if (k === 'color') {
          color = v || '';
          draw(tick);
        }
        else if (k === 'density' || k === 'size' || k === 'speed') {
          if (k === 'density') density = v === void 0 ? 5 : v;
          if (k === 'size') size = v === void 0 ? 1.2 : v;
          if (k === 'speed') period = µ._mjs_fxMs(v, 1200);
          build();
          draw(tick);
        }
        else if (k === 'radius') {
          if (layer) layer.style.borderRadius = v === void 0 ? '4px' : '';
        }
        else if (k === 'duration') return;
        else return false;
      };
      return off;
    }
  };
})();
