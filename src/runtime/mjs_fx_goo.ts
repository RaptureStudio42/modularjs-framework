// mjs_fx_goo — `*goo(mode)` : un effet liquide (un filtre SVG de flou et de contraste, posé à côté
// de la balise). Les modes :
//   drip  : la balise saigne — des gouttes de sa couleur jaillissent sans cesse et se fondent en
//           une flaque autour d'elle (sous son contenu)
//   merge : les enfants de la balise fusionnent comme du liquide quand ils s'approchent : chacun
//           porte un halo flou de sa couleur (son ::before, comme la démo), les halos voisins se
//           soudent en un pont liquide ; avec `drag`, on les déplace à la souris ; avec `pointer`, une
//           goutte de plus suit la souris et se soude aux formes dont elle s'approche
// Réglages : mode (drip), color (drip : les gouttes ; la couleur de fond de la balise, sinon
// #f00 ; merge : la goutte du pointeur ; la couleur de fond du premier enfant, sinon #f00), strength (le flou qui soude les formes, en px ; 10), halo (merge : la portée du halo de
// chaque forme, en px — plus il est grand, plus elles se soudent de loin ; 0 : au contact
// seulement ; 50), count (drip : les gouttes par salve ; 3), distance (drip : la portée des gouttes
// en px ; 200), on (drip — always : sans arrêt ; hover : pendant le survol), drag (merge : les
// enfants se déplacent à la souris), pointer (merge : le diamètre en px d'une goutte qui suit la
// souris et se soude aux enfants ; 0 : aucune ; 0).
// La goutte du pointeur est un disque posé dans la balise comme les formes (elle porte donc leur halo),
// déplacé par `translate` ; elle n'existe que pendant que la souris est sur la balise et ne capte
// aucun clic ; elle a son propre calque (`will-change: translate`, posé avec elle, retiré avec elle) : la bouger ne refait pas
// la trame de la balise filtrée. La boîte de la balise est lue à l'entrée, puis seulement à l'image qui suit un défilement
// ou un redimensionnement (la page, et chaque racine entre la balise et la page : un défilement ne sort
// pas d'un shadow root) : la goutte revient alors sous la dernière position de la souris, même posée
// (c'est la balise qui a bougé sous elle). Jamais à chaque mouvement, ni hors du survol.
// Le build de production n'embarque la goutte (ses sections `// @@ pointer`) que si une page écrit `pointer` : sans lui, le fichier est
// celui d'avant la goutte. Ce que `*goo` faisait avant (les deux modes, le halo, le glisser) n'est dans aucune section.

(function() {
  var SVG = 'http://www.w3.org/2000/svg';
  var n   = 0;
  // @@ pointer
  // la couleur de fond d'une balise, #f00 si elle n'en a pas
  var paint = function(node) {
    var cs = node && typeof getComputedStyle === 'function' ? getComputedStyle(node) : null;
    return cs && cs.backgroundColor && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) ? cs.backgroundColor : '#f00';
  };
  // @@
  µ._mjs_fxDefs.goo = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    css: '[mjs-fx-goo-svg]{position:absolute;width:0;height:0;overflow:hidden;pointer-events:none}'
      + '[mjs-fx~="goo"][mjs-fx-goo="drip"]{isolation:isolate}'
      + '[mjs-fx-layer="goo"]{position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit}'
      + '[mjs-fx-layer="goo"] b{position:absolute;inset:0;border-radius:inherit;background:var(--mjs-fx-goo-c)}'
      + '[mjs-fx-layer="goo"] i{position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:var(--mjs-fx-goo-c);animation:mjs-fx-goo-drop 2s linear forwards}'
      + '[mjs-fx~="goo"][mjs-fx-goo-drag] > *{touch-action:none;cursor:grab}'
      // merge : le halo de chaque forme, sa couleur floutée autour d'elle
      + '[mjs-fx~="goo"][mjs-fx-goo="merge"]:not([mjs-fx-goo-bare]) > *::before{content:"";position:absolute;inset:calc(-1 * var(--mjs-goo-halo,50px));border-radius:inherit;background:inherit;filter:blur(var(--mjs-goo-halo,50px));pointer-events:none}'
      // @@ pointer
      // merge, pointer : la goutte du pointeur, enfant de la balise comme les formes
      + '[mjs-fx~="goo"][mjs-fx-goo="merge"] > [mjs-fx-goo-drop]{position:absolute;left:0;top:0;width:var(--mjs-goo-pointer,0px);height:var(--mjs-goo-pointer,0px);margin:0;border-radius:50%;background:var(--mjs-fx-goo-pc);pointer-events:none;will-change:translate}'
      // @@
      + '@keyframes mjs-fx-goo-drop{0%{transform:translate(0,0) scale(1)}100%{transform:translate(var(--dx),var(--dy)) scale(.5)}}'
      + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="goo"] i{display:none}}',
    vars: {
      halo: 'px',
      pointer: 'px' // @@ pointer
    },
    // effets économes : suivi (ses gouttes coulent sans fin)
    heavy: true,
    setup: function(el, s, comp) {
      var id   = 'mjs-fx-goo-' + (++n);
      var blur = s.strength === void 0 ? 10 : s.strength;
      // le filtre vit dans la même racine que ce qu'il filtre : une référence url(#…) ne sort pas d'un
      // arbre. merge : la balise, dans la racine où elle vit ; drip : sa flaque, dans le composant si la
      // balise en est un
      var root = (s.mode !== 'merge' && µ._mjs_fxInner(el)) || (el.getRootNode ? µ._mjs_dom.getRootNode(el) : document);
      var at   = root && root.nodeType === 11 ? root : document.body;
      if (at !== document.body) µ._mjs_fxAdopt(root, 'goo');
      var svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('mjs-fx-goo-svg', '');
      svg.setAttribute('aria-hidden', 'true');
      var f = document.createElementNS(SVG, 'filter');
      f.setAttribute('id', id);
      var g = document.createElementNS(SVG, 'feGaussianBlur');
      g.setAttribute('in', 'SourceGraphic');
      g.setAttribute('stdDeviation', String(blur));
      var m = document.createElementNS(SVG, 'feColorMatrix');
      m.setAttribute('values', '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ' + (s.mode === 'merge' ? '20 -10' : '50 -10'));
      f.appendChild(g);
      f.appendChild(m);
      svg.appendChild(f);
      at.appendChild(svg);
      var restore = µ._mjs_fxRelative(el);
      var undo    = [];
      if (s.mode === 'merge') {
        var before = el.style.filter;
        el.style.filter = 'url(#' + id + ')';
        µ._mjs_dom.setAttribute(el, 'mjs-fx-goo', 'merge');
        if (s.halo === 0) µ._mjs_dom.setAttribute(el, 'mjs-fx-goo-bare', '');
        // le halo d'une forme se range sur elle : une forme `static` passe en `relative` (rendue au retrait)
        var posed = [];
        var anchor = function() {
          for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
            if (c._mjs_fxGooPos !== void 0 || typeof getComputedStyle !== 'function' || getComputedStyle(c).position !== 'static') continue;
            c._mjs_fxGooPos = c.style.position;
            c.style.position = 'relative';
            posed.push(c);
          }
        };
        anchor();
        var kids = typeof MutationObserver === 'function' ? new MutationObserver(anchor) : null;
        if (kids) kids.observe(el, { childList: true });
        undo.push(function() {
          if (kids) kids.disconnect();
          for (var i = 0; i < posed.length; i++) {
            posed[i].style.position = posed[i]._mjs_fxGooPos;
            delete posed[i]._mjs_fxGooPos;
          }
          el.style.filter = before;
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-goo');
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-goo-bare');
        });
        if (s.drag) {
          µ._mjs_dom.setAttribute(el, 'mjs-fx-goo-drag', '');
          var grab = null;
          var down = function(e) {
            // un second doigt pendant une saisie : ignoré (il prenait la place du premier, sa forme sautait sous lui) ;
            // un pointeur principal reprend toujours, un relâchement perdu ne bloque rien
            if (grab && e.pointerId !== grab.id && !e.isPrimary) return;
            var t = e.target;
            while (t && t.parentNode !== el) t = t.parentNode;
            if (!t || t.nodeType !== 1) return;
            var cur = (t.style.translate || '0px 0px').split(' ');
            grab = { el: t, id: e.pointerId, x: e.clientX - parseFloat(cur[0] || 0), y: e.clientY - parseFloat(cur[1] || 0) };
            if (t.setPointerCapture) t.setPointerCapture(e.pointerId);
            e.preventDefault();
          };
          var move = function(e) {
            if (!grab || e.pointerId !== grab.id) return;
            grab.el.style.translate = (e.clientX - grab.x) + 'px ' + (e.clientY - grab.y) + 'px';
          };
          var up = function(e) { if (grab && e.pointerId === grab.id) grab = null; };
          µ._mjs_dom.addEventListener(el, 'pointerdown', down);
          µ._mjs_dom.addEventListener(el, 'pointermove', move);
          µ._mjs_dom.addEventListener(el, 'pointerup', up);
          µ._mjs_dom.addEventListener(el, 'pointercancel', up);
          undo.push(function() {
            µ._mjs_dom.removeEventListener(el, 'pointerdown', down);
            µ._mjs_dom.removeEventListener(el, 'pointermove', move);
            µ._mjs_dom.removeEventListener(el, 'pointerup', up);
            µ._mjs_dom.removeEventListener(el, 'pointercancel', up);
            µ._mjs_dom.removeAttribute(el, 'mjs-fx-goo-drag');
          });
        }
        // @@ pointer
        // la goutte qui suit la souris : un disque enfant de la balise, que le filtre soude aux formes
        // dont il s'approche ; elle naît quand la souris entre et part avec elle. La boîte de la balise
        // se lit une fois (à l'entrée), et de nouveau seulement à l'image qui suit un défilement ou un
        // redimensionnement, où la goutte revient sous la dernière position de la souris : la souris
        // posée ne bouge pas, c'est la balise qui passe sous elle
        var dot     = null;
        var box     = null;
        var last    = null;
        var unwatch = null;
        var tracked = false;
        var place = function(e) {
          if (!box) {
            var rect = µ._mjs_dom.getBoundingClientRect(el);
            var kx   = el.offsetWidth ? rect.width / el.offsetWidth : 1;
            var ky   = el.offsetHeight ? rect.height / el.offsetHeight : 1;
            box = { x: rect.left + el.clientLeft * kx, y: rect.top + el.clientTop * ky, kx: kx || 1, ky: ky || 1 };
          }
          dot.style.translate = 'calc(' + ((e.clientX - box.x) / box.kx).toFixed(1) + 'px - 50%) calc(' + ((e.clientY - box.y) / box.ky).toFixed(1) + 'px - 50%)';
        };
        // l'aide de défilement du moteur (la page, et chaque racine entre la balise et la page : un défilement
        // ne sort pas d'un shadow root) rend la main à l'image qui suit un défilement ou un redimensionnement
        var again = function() {
          box = null;
          if (dot && last) place(last);
        };
        var follow = function(e) {
          last = e;
          if (!dot) {
            dot = document.createElement('i');
            dot.setAttribute('mjs-fx-goo-drop', '');
            dot.setAttribute('aria-hidden', 'true');
            dot.style.setProperty('--mjs-fx-goo-pc', s.color || paint(el.firstElementChild));
            box = null;
            place(e);
            µ._mjs_dom.appendChild(el, dot);
            unwatch = µ._mjs_fxScroll(el, again);
          }
          else {
            // une balise réécrite par son composant a pu emporter la goutte : elle revient
            if (dot.parentNode !== el) µ._mjs_dom.appendChild(el, dot);
            place(e);
          }
        };
        var forget = function() {
          if (!dot) return;
          unwatch();
          unwatch = null;
          dot.remove();
          dot  = null;
          box  = null;
          last = null;
        };
        // la goutte se suit tant que `pointer` est au-dessus de 0 : écouteurs posés ou retirés avec lui
        var track = function(on) {
          if (on === tracked) return;
          tracked = on;
          var f = on ? 'addEventListener' : 'removeEventListener';
          µ._mjs_dom[f](el, 'pointerenter', follow);
          µ._mjs_dom[f](el, 'pointermove', follow, { passive: true });
          µ._mjs_dom[f](el, 'pointerleave', forget);
          if (!on) forget();
        };
        if (s.pointer > 0) track(true);
        undo.push(function() { track(false); });
        // @@
      }
      else {
        var host = µ._mjs_fxInner(el) || el;
        if (host !== el) µ._mjs_fxAdopt(host, 'goo');
        var cs    = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        var bg    = cs && cs.backgroundColor && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) ? cs.backgroundColor : '#f00';
        µ._mjs_dom.setAttribute(el, 'mjs-fx-goo', 'drip');
        var layer = document.createElement('span');
        layer.setAttribute('mjs-fx-layer', 'goo');
        layer.setAttribute('aria-hidden', 'true');
        layer.style.setProperty('--mjs-fx-goo-c', s.color || bg);
        layer.style.filter = 'url(#' + id + ')';
        layer.appendChild(document.createElement('b'));
        µ._mjs_dom.insertBefore(host, layer, host.firstChild);
        var reach = s.distance === void 0 ? 200 : s.distance;
        var timer = null;
        var drops = function() {
          if (µ._mjs_fxCalm()) return;
          for (var i = 0; i < µ._mjs_fxCount(s.count || 3); i++) {
            var d = document.createElement('i');
            var a = Math.random() * 2 * Math.PI;
            var r = reach * (0.75 + Math.random() * 0.5);
            d.style.setProperty('--dx', (Math.cos(a) * r).toFixed(1) + 'px');
            d.style.setProperty('--dy', (Math.sin(a) * r).toFixed(1) + 'px');
            layer.appendChild(d);
            setTimeout(function(x) { return function() { x.remove(); }; }(d), 2000);
          }
        };
        // les gouttes coulent quand on les demande (toujours, ou pendant le survol), la balise à l'écran,
        // sans « réduire les animations » : hors de l'écran, ni minuterie ni goutte
        var want = s.on !== 'hover';
        var seen = true;
        var run  = function() {
          var go = want && seen && !µ._mjs_fxCalm();
          if (go && !timer) timer = setInterval(drops, 100);
          else if (!go && timer) {
            clearInterval(timer);
            timer = null;
          }
        };
        var enter = function() {
          want = true;
          run();
        };
        var leave = function() {
          want = false;
          run();
        };
        if (s.on === 'hover') {
          µ._mjs_dom.addEventListener(el, 'pointerenter', enter);
          µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
          undo.push(function() {
            µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
            µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
          });
        }
        if (typeof IntersectionObserver === 'function') {
          seen = false;
          // une goutte vole jusqu'à 1,25 fois la portée depuis le milieu de la balise, et mesure 20 px : la
          // balise compte comme à l'écran tant que ses gouttes peuvent s'y voir (une balise un peu hors
          // de l'écran continue de couler, une balise loin non)
          var margin = Math.ceil(Math.max(0, +reach || 0) * 1.25) + 10;
          var io     = new IntersectionObserver(function(entries) {
            for (var i = 0; i < entries.length; i++) seen = entries[i].isIntersecting;
            run();
          }, { rootMargin: margin + 'px' });
          io.observe(el);
          undo.push(function() { io.disconnect(); });
        }
        run();
        undo.push(function() {
          clearInterval(timer);
          timer = null;
          layer.remove();
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-goo');
        });
      }
      var stop = function() {
        for (var i = undo.length - 1; i >= 0; i--) undo[i]();
        svg.remove();
        restore();
      };
      // le halo tenu par une variable : sa variable CSS suit (le moteur) ; à 0, les formes ne se soudent
      // qu'au contact (plus de halo), au-dessus de 0 il revient. Les autres réglages relancent l'effet
      stop.set = function(k, v) {
        // @@ pointer
        // la goutte du pointeur (pointer) naît ou part avec lui, sa taille suit sa variable CSS
        if (k === 'pointer') {
          if (s.mode === 'merge') track(v > 0);
          return;
        }
        // @@
        if (k !== 'halo') return false;
        if (s.mode !== 'merge') return;
        if (v === 0) µ._mjs_dom.setAttribute(el, 'mjs-fx-goo-bare', '');
        else µ._mjs_dom.removeAttribute(el, 'mjs-fx-goo-bare');
      };
      return stop;
    }
  };
})();
