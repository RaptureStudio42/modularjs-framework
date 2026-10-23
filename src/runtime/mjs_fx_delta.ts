// mjs_fx_delta — `*delta` : un nombre qui change se voit. Quand le nombre écrit dans la balise monte
// (un `{$cours}` réactif), la balise clignote dans la couleur `up`, une flèche ▲ à côté du nombre ;
// quand il baisse, dans la couleur `down`, avec ▼ ; et le nombre compte de l'ancienne valeur à la
// nouvelle. Rien au premier affichage. Sur un calque posé par-dessus le texte, qui reste en place ;
// la flèche est hors du flux : le nombre ne bouge jamais. Réglages : duration (le clignotement et le
// compte ; 1s), up (#16a34a), down (#dc2626), arrow (la flèche ; oui), fx (l'effet qui écrit le
// nouveau nombre — *count : il compte de l'ancien au nouveau ; un autre effet qui se joue une fois,
// rejoué sur le nombre à chaque changement : *scramble, *stagger, *fly(up)… ; none : d'un coup ;
// *count), separator, decimal, prefix, suffix (le nombre écrit, comme *count), easing (le compte).

µ._mjs_fxDefs.delta = {
  css: '[mjs-fx~="delta"] [mjs-fx-layer="text"]{font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '[mjs-fx-delta-num]{position:relative;display:inline-block}'
    + '[mjs-fx-delta-arrow]{position:absolute;left:100%;top:50%;margin-left:.3em;font-size:.6em;font-style:normal;line-height:1;transform:translateY(-50%);opacity:0;pointer-events:none}'
    + '[mjs-fx~="delta"][mjs-fx-delta-go="up"]{animation:mjs-fx-delta-up var(--mjs-delta-duration,1s) ease-out}'
    + '[mjs-fx~="delta"][mjs-fx-delta-go="down"]{animation:mjs-fx-delta-down var(--mjs-delta-duration,1s) ease-out}'
    + '[mjs-fx-delta-go="up"] [mjs-fx-delta-arrow]{color:var(--mjs-delta-up,#16a34a);animation:mjs-fx-delta-arrow var(--mjs-delta-duration,1s) ease-out}'
    + '[mjs-fx-delta-go="down"] [mjs-fx-delta-arrow]{color:var(--mjs-delta-down,#dc2626);animation:mjs-fx-delta-arrow var(--mjs-delta-duration,1s) ease-out}'
    // la couleur part de celle du sens, et revient d'elle-même à celle de la balise
    + '@keyframes mjs-fx-delta-up{from{background-color:color-mix(in srgb,var(--mjs-delta-up,#16a34a) 28%,transparent);color:var(--mjs-delta-up,#16a34a)}}'
    + '@keyframes mjs-fx-delta-down{from{background-color:color-mix(in srgb,var(--mjs-delta-down,#dc2626) 28%,transparent);color:var(--mjs-delta-down,#dc2626)}}'
    + '@keyframes mjs-fx-delta-arrow{from,60%{opacity:1}to{opacity:0}}'
    // réduire les animations : la couleur tient, puis revient d'un coup
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="delta"][mjs-fx-delta-go],[mjs-fx-delta-go] [mjs-fx-delta-arrow]{animation-timing-function:steps(1,end)}}',
  vars: { duration: '', up: '', down: '' },
  setup: function(el, s, comp) {
    var num    = µ._mjs_fxNum(s);
    // l'effet qui écrit le nouveau nombre : { fx, s } (count : le compte ci-dessous), null : d'un coup
    var fx     = s.fx === 'none' ? null : s.fx && typeof s.fx === 'object' ? s.fx : { fx: 'count', s: {} };
    var target = null;
    var shown  = null;
    // la durée, suivie quand une variable la tient (cf. set)
    var dur    = s.duration;
    var raf    = 0;
    var box    = null;
    var val    = null;
    var arrow  = null;
    var dead   = false;
    // l'effet posé sur le nombre, retiré avant le suivant
    var played = null;
    // les deux nombres du dernier changement (l'ancien, le nouveau) : la balise garde la place du plus large
    var pair   = [];
    // le nœud de texte du nombre : un normalize() de la page retire un nœud vide (avant la première image du compte), il se refait quand il manque
    var numNode = function() {
      return val.firstChild || val.appendChild(document.createTextNode(''));
    };
    var paint = function(v) {
      shown = v;
      if (val) numNode().nodeValue = num.fmt(v);
    };
    var unplay = function() {
      if (played) played();
      played = null;
    };
    // un autre effet que le compte : le nouveau nombre écrit d'un coup, l'effet joué dessus
    var play = function() {
      unplay();
      if (!val || µ._mjs_fxCalm()) return;
      played = µ._mjs_fxOnce(comp, val, fx);
    };
    // le clignotement, relancé à chaque changement (même en plein clignotement)
    var flash = function(dir) {
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-delta-go');
      void el.offsetWidth;
      µ._mjs_dom.setAttribute(el, 'mjs-fx-delta-go', dir);
      if (arrow) arrow.textContent = dir === 'up' ? '▲' : '▼';
    };
    var animate = function(a, b) {
      cancelAnimationFrame(raf);
      if (fx && fx.fx !== 'count') {
        paint(b);
        play();
        return;
      }
      if (!fx || µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') { paint(b); return; }
      // *count(…) : sa durée et sa courbe, sinon celles de *delta
      var d  = µ._mjs_fxMs(fx.s.duration !== void 0 ? fx.s.duration : dur, 1000);
      var cv = fx.s.easing ? µ._mjs_fxNum({ easing: fx.s.easing }).curve : num.curve;
      var t0 = null;
      var tick = function(now) {
        if (dead) return;
        if (t0 === null) t0 = now;
        var k = d > 0 ? Math.min(1, (now - t0) / d) : 1;
        paint(a + (b - a) * cv(k));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    var tx = µ._mjs_fxLayer(comp, el, function(l, txt) {
      var n = num.parse(txt);
      unplay();
      box   = null;
      val   = null;
      arrow = null;
      // pas un nombre : le texte tel quel
      if (n === null) { l.textContent = txt; target = null; return; }
      // le nombre (l'effet de fx joue sur lui seul), et sa flèche à côté, hors du flux
      box = document.createElement('span');
      box.setAttribute('mjs-fx-delta-num', '');
      val = document.createElement('span');
      val.setAttribute('mjs-fx-delta-val', '');
      box.appendChild(val);
      if (s.arrow !== false) {
        arrow = document.createElement('i');
        arrow.setAttribute('mjs-fx-delta-arrow', '');
        box.appendChild(arrow);
      }
      l.appendChild(box);
      var prev = target;
      target = n;
      if (prev === null || shown === null) { pair = [n]; paint(n); return; }
      if (n === prev) { paint(shown); return; }
      pair = [shown, n];
      flash(n > prev ? 'up' : 'down');
      animate(shown, n);
    });
    // une balise en ligne passe en inline-block : le clignotement couvre sa boîte, qui a une largeur
    var inline = µ._mjs_fxMovable(el);
    var minW   = el.style.minWidth;
    var reserve = function() {
      if (dead) return;
      if (!val) { el.style.minWidth = minW; return; }
      µ._mjs_fxNumWidth(el, numNode(), pair, num.fmt);
    };
    reserve();
    tx.onBuild(reserve);
    // une police arrivée après la pose change la largeur des chiffres : la place est reprise une fois, à la fin
    // du chargement (cf. µ._mjs_fxOnFonts)
    var unfonts = µ._mjs_fxOnFonts(reserve);
    var off = function() {
      dead = true;
      unfonts();
      cancelAnimationFrame(raf);
      unplay();
      tx.off();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-delta-go');
      el.style.minWidth = minW;
      inline();
    };
    // la durée tenue par une variable : la feuille la lit (le clignotement), le compte aussi (les
    // couleurs : la feuille seule ; les autres réglages : l'effet repart)
    off.set = function(k, v) {
      if (k !== 'duration') return false;
      dur = v;
    };
    return off;
  }
};
