// mjs_fx_parallax — `*parallax` : la balise glisse à son propre rythme quand la page défile — plus
// lentement, plus vite, ou de côté. Réglages : speed (le glissement pour chaque pixel défilé :
// 0.5 = la balise prend du retard, 1 = elle reste immobile à l'écran, -0.5 = elle file plus vite,
// 2 = deux fois le défilement ; 0.5), axis (y : de haut en bas ; x : de côté ; y), origin (view :
// la balise est à sa place quand elle passe au milieu de l'écran ; page : à sa place en haut de la
// page, comme la bande qui glisse de la démo ; view), smooth (l'élan : la part de l'écart que la
// balise rattrape à chaque image, comptée à 60 images par seconde — 1 : elle est collée au
// défilement ; 0.1 : elle le rattrape avec retard et continue un peu après l'arrêt de la molette,
// comme emportée par son élan ; de 0.01 à 1 ; 1). Le glissement passe par la propriété
// `translate` : la transformation propre de la balise n'est pas touchée ; une balise en ligne passe
// en `inline-block` le temps de l'effet. Dans un conteneur qui défile (overflow auto ou scroll, dont
// le contenu déborde), c'est lui qui compte, le plus proche : son milieu pour view, son défilement
// pour page ; il est reconnu à chaque tracé, même devenu défilable après la pose.
// L'élan (smooth sous 1) : le défilement fixe la cible, une seule boucle (une image d'animation à
// la fois) en rapproche la balise et s'arrête d'elle-même quand l'écart passe sous 0,1 px ; par
// image, une seule écriture, la variable que `translate` lit. La boucle ne lit RIEN de la mise en
// page : la boîte de la balise et le conteneur qui défile autour d'elle se lisent à la pose, au
// redimensionnement, quand un conteneur encore inconnu défile et au début d'un geste de défilement
// (rien depuis un quart de seconde), dans l'événement ; entre deux lectures la place de la balise
// se déduit du défilement relu à chaque événement. Une balise (ou un ancêtre) `sticky` ou `fixed`
// ne suit pas le défilement en ligne droite : sa mise en page se relit alors à chaque événement.
// Quand ni la balise ni sa cible ne sont à moins de 100 px de l'écran, ou dans un onglet caché, rien
// ne tourne : la balise se pose d'un coup sur sa cible. Une balise emportée hors de l'écran par son
// élan, dont la cible est à l'écran, revient en glissant. `will-change` n'est posé que le temps du
// mouvement. Sous « réduire les animations », pas d'élan. Sans élan (smooth 1), une écriture par
// image de défilement, ni mesure de plus ni écoute de plus.
// L'élan est une section marquée du fichier : le build de production ne l'embarque que si une page écrit smooth. Sans lui, la pose est la même
// (la mise en page lue hors des images, une écriture par image de défilement) sans la boucle de rattrapage, `will-change`, l'écoute de l'onglet ni `off.set`.

µ._mjs_fxDefs.parallax = {
  css: '[mjs-fx~="parallax"]{translate:var(--mjs-fx-parallax-x,0px) var(--mjs-fx-parallax-y,0px)}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="parallax"][mjs-fx~="parallax"]{translate:none}}',
  vars: {},
  setup: function(el, s) {
    var k     = s.speed === void 0 ? 0.5 : s.speed;
    var x     = s.axis === 'x';
    var page  = s.origin === 'page';
    var frame = 0;
    // @@ smooth
    // l'élan : 1 = collée au défilement ; plus bas, la part de l'écart rattrapée à chaque image (à 60 par
    // seconde) ; le plancher évite une cible que la balise n'atteindrait jamais
    var tame  = function(v) { return v == null || !(v < 1) ? 1 : v > 0.01 ? +v : 0.01; };
    var ease  = tame(s.smooth);
    var calm  = µ._mjs_fxCalm();
    var tamed = function() { return ease < 1 && !calm; };
    // @@
    // une balise en ligne ne se déplace pas : `inline-block` le temps de l'effet
    var inline = µ._mjs_fxMovable(el);
    // le glissement posé (cur) et celui qu'on vise (goal)
    var cur   = 0;
    var goal  = 0;
    var stale = false;
    // @@ smooth
    var last  = 0;
    var near  = true;
    var warm  = null;
    // @@
    // remonter d'un nœud, en traversant les racines d'ombre
    var up    = function(n) { return n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode; };
    var inside = function(t) {
      for (var n = up(el); n; n = up(n)) {
        if (n === t) return true;
      }
      return false;
    };
    // la mise en page se lit hors de la boucle d'images : `geo` garde la boîte de la balise (sans son glissement), le
    // conteneur qui défile autour d'elle (le plus proche dont le contenu déborde, la page mise à part ; il peut le devenir
    // après la pose : un conteneur qui vient de défiler compte aussi en `overflow: hidden`, d'où `moved`) et le défilement
    // du moment ; entre deux lectures, la place de la balise se déduit du défilement relu à chaque événement (sy, sx : la
    // page ; st, sl : le conteneur). `line` : rien ne colle la balise à l'écran (`sticky`, `fixed`), le défilement la
    // déplace en ligne droite
    var moved = [];
    var geo   = null;
    var cold  = true;
    var seen  = -1e9;
    var sy    = 0;
    var st    = 0;
    // @@ smooth
    var sx    = 0;
    var sl    = 0;
    // @@
    var read  = function() {
      var p     = null;
      var line  = true;
      var watch = [];
      for (var n = el; n && n.nodeType === 1 && n !== document.documentElement; n = up(n)) {
        var cs = typeof getComputedStyle === 'function' ? getComputedStyle(n) : null;
        if (cs && /^(sticky|fixed)$/.test(cs.position || '')) line = false;
        if (n === el || !(moved.indexOf(n) >= 0 || (cs && /(auto|scroll)/.test(cs.overflowY || '')))) continue;
        watch.push(n);
        if (!p && n.scrollHeight > n.clientHeight) p = n;
      }
      // les boîtes ne servent qu'à la place de repos (origin: view) et à savoir si la balise se voit (avec élan)
      var box = !page;
      if (!box) box = tamed(); // @@ smooth
      var r   = box ? µ._mjs_dom.getBoundingClientRect(el) : { top: 0, left: 0, width: 0, height: 0 };
      var pr  = box && p ? µ._mjs_dom.getBoundingClientRect(p) : { top: 0 };
      geo = {
        p: p, watch: watch, line: line, box: box, h: r.height, ih: innerHeight,
        w: r.width, iw: innerWidth, left: r.left - (x ? cur : 0), // @@ smooth
        top: r.top - (x ? 0 : cur),
        mid: p ? pr.top + p.clientTop + p.clientHeight / 2 : innerHeight / 2
      };
      cold = false;
      sy = geo.sy = window.scrollY;
      sx = geo.sx = window.scrollX || 0; // @@ smooth
      st = geo.st = p ? p.scrollTop : 0;
      sl = geo.sl = p ? p.scrollLeft : 0; // @@ smooth
    };
    // le défilement du moment, sans relire la mise en page
    var sample = function() {
      sy = window.scrollY;
      sx = window.scrollX || 0; // @@ smooth
      st = geo.p ? geo.p.scrollTop : 0;
      sl = geo.p ? geo.p.scrollLeft : 0; // @@ smooth
    };
    // un conteneur qui défile (ou peut défiler) autour de la balise est-il devenu défilable, ou ne l'est-il plus ? Seuls ceux
    // que la lecture a vus en `overflow` auto ou scroll, ou qui ont défilé, sont revus, du plus proche au plus lointain
    var other = function() {
      for (var i = 0; i < geo.watch.length; i++) {
        if (geo.watch[i].scrollHeight > geo.watch[i].clientHeight) return geo.watch[i] !== geo.p;
      }
      return geo.p !== null;
    };
    var look = function() {
      if (cold || !geo.line || other()) read();
      else if (!geo.box && (!page || tamed())) read(); // @@ smooth
      else sample();
    };
    // le glissement que le défilement demande, en px sur l'axe de l'effet
    var aim = function() {
      if (page) return (geo.p ? st : sy) * k;
      // la place de repos : la boîte lue, déplacée du défilement depuis ; le milieu : celui de la zone visible du
      // conteneur (qui suit le défilement de la page), sinon de l'écran
      var oy  = (sy - geo.sy) + (st - geo.st);
      var mid = geo.p ? geo.mid - (sy - geo.sy) : geo.ih / 2;
      return (mid - (geo.top - oy + geo.h / 2)) * k;
    };
    var put   = function() {
      el.style.setProperty(x ? '--mjs-fx-parallax-x' : '--mjs-fx-parallax-y', cur.toFixed(1) + 'px');
    };
    // @@ smooth
    // `will-change` seulement pendant le mouvement : la balise a son propre calque le temps du rattrapage,
    // puis le rend avec la valeur que l'auteur avait écrite
    var hot  = function() {
      if (warm !== null) return;
      warm = el.style.getPropertyValue('will-change');
      el.style.setProperty('will-change', 'translate');
    };
    var cool = function() {
      if (warm === null) return;
      if (warm === '') el.style.removeProperty('will-change');
      else el.style.setProperty('will-change', warm);
      warm = null;
    };
    // la balise se voit-elle, ou se verra-t-elle au bout de son rattrapage ? (à 100 px de l'écran près ; la
    // boîte qui défile autour d'elle ne compte pas : au pire la boucle tourne une seconde pour rien). Sa boîte se déduit
    // de la lecture et du défilement depuis : aucune lecture ici
    var gaze = function() {
      var oy = (sy - geo.sy) + (st - geo.st);
      var ox = (sx - geo.sx) + (sl - geo.sl);
      var t  = geo.top - oy + (x ? 0 : cur);
      var l  = geo.left - ox + (x ? cur : 0);
      var b  = t + geo.h;
      var r  = l + geo.w;
      var dx = x ? goal - cur : 0;
      var dy = x ? 0 : goal - cur;
      return (b > -100 && t < geo.ih + 100 && r > -100 && l < geo.iw + 100)
        || (b + dy > -100 && t + dy < geo.ih + 100 && r + dx > -100 && l + dx < geo.iw + 100);
    };
    // @@
    // la cible se recalcule après un défilement, avant d'écrire, d'après la lecture et le défilement relu à l'événement :
    // aucune lecture de la mise en page ici, ni pendant le rattrapage ; sans élan, la balise n'a pas à savoir si elle se voit
    var refresh = function() {
      if (!stale) return;
      stale = false;
      goal  = aim();
      near  = !tamed() || gaze(); // @@ smooth
    };
    // @@ smooth
    // le rattrapage ne tourne que si la balise se voit, l'onglet aussi, et si l'élan est permis
    var live = function() {
      return tamed() && near && !document.hidden && typeof requestAnimationFrame === 'function';
    };
    // @@
    // la balise part vers sa cible d'une part f de l'écart. Rend vrai tant qu'il reste 0,1 px d'écart
    // (une cible qui n'est pas un nombre compte comme atteinte)
    var move = function(f) {
      cur += (goal - cur) * f;
      var more = Math.abs(goal - cur) >= 0.1;
      if (!more) cur = goal;
      put();
      return more;
    };
    // une image : sans élan f vaut 1 (la balise arrive d'un coup), sinon la part rattrapée suit le temps
    // écoulé (60 images par seconde ou 144, même élan) ; la boucle repart tant qu'il reste de l'écart
    var tick = function(now) {
      frame = 0;
      refresh();
      var f = 1;
      if (live()) f = 1 - Math.pow(1 - ease, Math.min(0.1, last ? (now - last) / 1000 : 1 / 60) * 60); // @@ smooth
      last = now; // @@ smooth
      if (move(f)) {
        hot(); // @@ smooth
        frame = requestAnimationFrame(tick); // @@ smooth
      }
      else {
        last = 0; // @@ smooth
        cool(); // @@ smooth
      }
    };
    var ask = function() {
      if (frame) return;
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick);
      else tick(0);
    };
    // la balise se pose d'un coup sur sa cible : la pose, l'onglet caché, l'élan retiré
    var jump = function() {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); // @@ smooth
      frame = 0; // @@ smooth
      last  = 0; // @@ smooth
      look();
      stale = true;
      refresh();
      move(1);
      cool(); // @@ smooth
    };
    // un événement de défilement (ou le redimensionnement) : un conteneur encore inconnu qui défile, un nouveau geste
    // (rien depuis un quart de seconde) ou une fenêtre qui change de taille font relire la mise en page ICI, dans
    // l'événement, jamais dans la boucle d'images ; sinon seul le défilement est relu
    var once   = null;
    var scroll = function(e) {
      // le défilement de la page arrive deux fois, par la capture sur le document puis par la fenêtre : traité une fois
      if (e && e === once) return;
      once = e;
      var t  = e && e.target;
      var at = e && e.timeStamp;
      if (t && t.nodeType === 1 && moved.indexOf(t) < 0 && inside(t)) {
        moved.push(t);
        cold = true;
      }
      if (!(at - seen < 250) || (e && e.type === 'resize')) cold = true;
      seen = at;
      look();
      stale = true;
      ask();
    };
    // @@ smooth
    // un rattrapage en cours (une image attendue, ou de l'écart) : la balise se pose d'un coup quand l'onglet
    // se cache ; sans rattrapage, il n'y a rien à poser
    var going = function() { return frame || cur !== goal; };
    var tab   = function() {
      if (document.hidden && going()) jump();
    };
    // @@
    // un défilement ne sort pas d'un shadow root : écouté en capture sur chaque racine entre la balise
    // et la page (celui d'un conteneur n'arrive pas non plus à la fenêtre)
    var roots = [];
    for (var rt = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document; rt && roots.indexOf(rt) < 0; rt = rt.host && rt.host.getRootNode ? µ._mjs_dom.getRootNode(rt.host) : null) roots.push(rt);
    for (var i = 0; i < roots.length; i++) µ._mjs_dom.addEventListener(roots[i], 'scroll', scroll, { capture: true, passive: true });
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', scroll);
    // @@ smooth
    // l'onglet n'est écouté que tant qu'il y a un élan à tenir (sans élan, le tracé d'avant : aucune écoute de plus)
    var tabbed = false;
    var follow = function() {
      if (tabbed === tamed()) return;
      tabbed = !tabbed;
      if (tabbed) µ._mjs_dom.addEventListener(document, 'visibilitychange', tab);
      else µ._mjs_dom.removeEventListener(document, 'visibilitychange', tab);
    };
    // @@
    jump();
    follow(); // @@ smooth
    var off = function() {
      // @@ smooth
      if (tabbed) {
        tabbed = false;
        µ._mjs_dom.removeEventListener(document, 'visibilitychange', tab);
      }
      // @@
      for (var j = 0; j < roots.length; j++) µ._mjs_dom.removeEventListener(roots[j], 'scroll', scroll, { capture: true });
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', scroll);
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      cool(); // @@ smooth
      el.style.removeProperty('--mjs-fx-parallax-x');
      el.style.removeProperty('--mjs-fx-parallax-y');
      inline();
    };
    // @@ smooth
    // l'élan se règle sans reposer l'effet ; speed, axis et origin, eux, le reposent
    off.set = function(key, v) {
      if (key !== 'smooth') return false;
      ease = tame(v);
      follow();
      if (!tamed() && going()) jump();
    };
    // @@
    return off;
  }
};
