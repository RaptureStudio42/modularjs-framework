// mjs_fx_dock — `*dock` : les enfants de la balise grossissent à l'approche de la souris, le plus
// proche le plus fort, et s'écartent pour se faire de la place (le dock d'un bureau). La balise
// garde sa taille : la rangée s'élargit autour de son centre. Réglages : scale (l'agrandissement de
// l'enfant sous la souris ; 1.6), range (la portée, px de mise en page : elle suit un parent qui réduit
// la barre ; au-delà, un enfant garde sa taille ; 140), axis (x : une rangée, les enfants grandissent
// vers le haut ; y : une colonne, vers la droite ; x), duration (le suivi ; 150ms). La barre peut
// défiler, et ses enfants changer pendant le survol. Les calques posés par d'autres effets (`mjs-fx-layer`)
// ne sont pas des enfants. L'agrandissement et le décalage d'une icône sont une animation de `scale` et de
// `translate` qui s'ajoute à ceux que la feuille lui donne à chaque instant (`composite: add`) : son `transform`
// (une icône tournée le reste), son `translate` et son `scale` d'auteur restent — une icône réduite par `scale: .8`
// (ce qu'écrit Tailwind 4) grossit à partir de là, une classe échangée ou un `:hover` de l'auteur compris.

µ._mjs_fxDefs.dock = {
  // une icône relevée (marque `mjs-fx-dock-i`) grandit depuis son pied (une colonne : depuis son bord gauche)
  css: '[mjs-fx~="dock"] > :where([mjs-fx-dock-i]){transform-origin:50% 100%}'
    + '[mjs-fx~="dock"][mjs-fx-dock-axis="y"] > :where([mjs-fx-dock-i]){transform-origin:0 50%}',
  vars: { duration: '' },
  setup: function(el, s) {
    var max   = typeof s.scale === 'number' ? s.scale : 1.6;
    var range = s.range || 140;
    var y     = s.axis === 'y';
    var still = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    var waapi = typeof Element === 'function' && typeof Element.prototype.animate === 'function';
    if (y) µ._mjs_dom.setAttribute(el, 'mjs-fx-dock-axis', 'y');
    // les enfants, sans les calques des autres effets (`*mesh`, `*ripple`…) : ce ne sont pas des icônes
    var kids = function() { return Array.prototype.filter.call(el.children, function(c) { return !µ._mjs_dom.hasAttribute(c, 'mjs-fx-layer'); }); };
    // chaque icône : son agrandissement et son décalage, de `from` à `to` ([scale, px]) par l'animation native `anim` (aucune : arrivée)
    var state = new Map();
    var ms    = 150;
    var go = function(c, sv, tv) {
      var st = state.get(c);
      if (!st) state.set(c, st = { from: [1, 0], to: [1, 0], anim: null });
      if (st.to[0] === sv && st.to[1] === tv) return;
      var p = st.anim && st.anim.effect && st.anim.effect.getComputedTiming ? st.anim.effect.getComputedTiming().progress : 1;
      if (p === null || p === void 0) p = 1;
      var cur = [st.from[0] + (st.to[0] - st.from[0]) * p, st.from[1] + (st.to[1] - st.from[1]) * p];
      if (st.anim) st.anim.cancel();
      st.anim = null;
      st.from = cur;
      st.to   = [sv, tv];
      if (!waapi || (sv === 1 && !tv && cur[0] === 1 && !cur[1])) return;
      var at = function(v) { return y ? '0px ' + v + 'px' : v + 'px 0px'; };
      var a  = st.anim = µ._mjs_dom.animate(c, { translate: [at(cur[1]), at(tv)], scale: [String(cur[0]), String(sv)] }, { duration: still && still.matches ? 0 : ms, easing: 'ease-out', fill: 'forwards', composite: 'add' });
      // sans `composite: add` (un vieux navigateur), l'animation remplacerait le scale et le translate de l'auteur : l'icône ne bouge pas
      if (a.effect && a.effect.composite !== 'add') {
        a.cancel();
        st.anim = null;
        st.from = st.to = [1, 0];
        return;
      }
      if (sv === 1 && !tv) a.onfinish = function() {
        if (st.anim !== a) return;
        a.cancel();
        st.anim = null;
      };
    };
    var reset = function() {
      kids().forEach(function(c) {
        c.style.removeProperty('--mjs-fx-dock-s');
        c.style.removeProperty('--mjs-fx-dock-t');
        go(c, 1, 0);
      });
    };
    // une icône est marquée à son premier relevé (une icône arrivée ensuite l'est au relevé suivant)
    var marked = [];
    var own    = function(c) {
      if (µ._mjs_dom.hasAttribute(c, 'mjs-fx-dock-i')) return;
      µ._mjs_dom.setAttribute(c, 'mjs-fx-dock-i', '');
      marked.push(c);
    };
    kids().forEach(own);
    // tout se compte en pixels de mise en page, dans le contenu de la balise : un parent qui la réduit
    // (`transform: scale(.5)`) la montre plus petite que sa mise en page (`ratio` : pixels de mise en
    // page par pixel d'écran, la portée suit donc la réduction), et le défilement de la balise décale
    // ce que la souris touche dans son contenu
    var ratio = function(o) {
      var layout = y ? el.offsetHeight : el.offsetWidth;
      var seen   = y ? o.height : o.width;
      return layout > 0 && seen > 0 ? layout / seen : 1;
    };
    var scrolled = function() { return y ? el.scrollTop : el.scrollLeft; };
    // le milieu et la taille de chaque enfant dans la balise, en mise en page : sans sa transformation
    // (décalé et grossi par le mouvement d'avant, il paraissait plus loin, et la cloche rétrécissait) ;
    // relevés à l'entrée de la souris, un mouvement ne relit plus que la boîte de la balise, et refaits
    // quand les enfants changent. Un enfant sans taille de mise en page (un SVG, une boîte sans mise en
    // page) : sa boîte à l'écran, ramenée en mise en page. Une icône partie de la barre perd son agrandissement
    var boxes = null;
    var survey = function() {
      var o = µ._mjs_dom.getBoundingClientRect(el);
      var k = ratio(o);
      var d = scrolled();
      ms = µ._mjs_fxMs(µ._mjs_fxCss(el, '--mjs-dock-duration'), 150);
      state.forEach(function(st, c) {
        if (c.parentNode === el) return;
        if (st.anim) st.anim.cancel();
        state.delete(c);
      });
      boxes = kids().map(function(c) {
        own(c);
        var size = y ? c.offsetHeight : c.offsetWidth;
        var at   = c.offsetParent === el ? (y ? c.offsetTop + el.clientTop : c.offsetLeft + el.clientLeft) : c.offsetParent === el.offsetParent ? (y ? c.offsetTop - el.offsetTop : c.offsetLeft - el.offsetLeft) : NaN;
        if (!(size > 0) || !isFinite(at)) {
          var r = µ._mjs_dom.getBoundingClientRect(c);
          size = (y ? r.height : r.width) * k;
          at   = (y ? r.top - o.top : r.left - o.left) * k + d;
        }
        return { c: c, mid: at + size / 2, size: size };
      });
    };
    // le relevé vaut tant que les enfants sont les mêmes, dans le même ordre : une icône ajoutée, retirée
    // ou remplacée pendant le survol le fait refaire au mouvement suivant
    var fresh = function() {
      var all = kids();
      if (!boxes || boxes.length !== all.length) return false;
      for (var i = 0; i < all.length; i++) {
        if (boxes[i].c !== all[i]) return false;
      }
      return true;
    };
    var move = function(e) {
      if (!fresh()) survey();
      var o = µ._mjs_dom.getBoundingClientRect(el);
      var p = (y ? e.clientY - o.top : e.clientX - o.left) * ratio(o) + scrolled();
      // chaque enfant : son agrandissement (une cloche douce autour de la souris), puis le
      // décalage qui lui fait sa place — la rangée s'écarte de part et d'autre de son centre
      var grow = boxes.map(function(b) {
        var d = Math.abs(p - b.mid);
        var k = d >= range ? 0 : (1 + Math.cos(Math.PI * d / range)) / 2;
        return { c: b.c, s: 1 + (max - 1) * k, size: b.size };
      });
      var extra = grow.reduce(function(a, g) { return a + (g.s - 1) * g.size; }, 0);
      var before = 0;
      grow.forEach(function(g) {
        var e2 = (g.s - 1) * g.size;
        var sv = Math.round(g.s * 1000) / 1000;
        var tv = Math.round((before + e2 / 2 - extra / 2) * 10) / 10;
        g.c.style.setProperty('--mjs-fx-dock-s', String(sv));
        g.c.style.setProperty('--mjs-fx-dock-t', tv + 'px');
        go(g.c, sv, tv);
        before += e2;
      });
    };
    var leave = function() {
      boxes = null;
      reset();
    };
    µ._mjs_dom.addEventListener(el, 'pointerenter', survey);
    µ._mjs_dom.addEventListener(el, 'pointermove', move);
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
    return function() {
      µ._mjs_dom.removeEventListener(el, 'pointerenter', survey);
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      state.forEach(function(st) { if (st.anim) st.anim.cancel(); });
      state.clear();
      marked.forEach(function(c) {
        c.style.removeProperty('--mjs-fx-dock-s');
        c.style.removeProperty('--mjs-fx-dock-t');
        µ._mjs_dom.removeAttribute(c, 'mjs-fx-dock-i');
      });
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-dock-axis');
    };
  }
};
