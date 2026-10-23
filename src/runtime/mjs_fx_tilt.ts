// mjs_fx_tilt — `*tilt` : l'élément s'incline en 3D pour suivre la souris, et revient en place
// quand elle part. Réglages : max (inclinaison maximale en degrés ; 12), scale (grossissement au
// survol ; 1.03), perspective (800), direction (toward : le coin sous le pointeur vient vers soi ;
// away : il s'enfonce), glare (un reflet suit la souris), duration (le retour à plat ; 450ms),
// follow (la durée du suivi pendant le survol, en ligne droite ; 100ms ; 0 : collée à la souris),
// wait (l'attente avant le retour, quand le pointeur quitte la balise ; 0ms : le retour part tout de suite),
// bounce (le rebond du retour : la balise passe de cette part du chemin de l'autre côté de sa position de
// repos avant de s'y poser ; 0 : aucun ; 0.3 : 30 % ; au plus 0.5), un ressort sous-amorti échantillonné en
// courbe CSS `linear()` au lieu d'une boucle d'images : rien ne tourne au repos, le navigateur anime seul,
// un navigateur sans `linear()` garde la courbe d'avant,
// depth (la parallaxe : les enfants directs de la balise flottent devant elle, à cette distance en
// px ; 0), slide (le fond de la balise glisse avec la souris).
// Un coin qui s'enfonce peut sortir de sous le pointeur au bord de la carte : tant que le pointeur
// reste dans le cadre de la carte à plat, le suivi continue (sinon la carte tremblerait). La boîte de la carte se lit à l'entrée du
// pointeur — et de nouveau, à plat, au mouvement qui suit un défilement (la carte a bougé sous lui : son inclinaison retirée le temps
// d'une lecture, sans transition, puis remise) —, jamais à chaque mouvement. Avec wait la carte reste inclinée pendant l'attente puis le retour (1,65 s pour 650ms
// d'attente et 1s de retour) : un pointeur qui revient trouve alors une carte dont le rectangle est incliné. Sa boîte se lit alors à plat, là
// où la carte est aujourd'hui (la page a pu défiler, la mise en page changer) : le temps d'une lecture elle est posée à plat, sans transition,
// puis remise dans l'angle où elle était, appliqué sur l'instant ; le suivi repart de cet angle, sans délai, même quand la cible du pointeur
// vaut celle du repos (au centre, avec scale: 1). Cette lecture est une section du fichier (wait) : sans wait, comme dans la V3, la boîte se
// lit à chaque entrée et rien de plus n'est embarqué.
// Pour la carte graphique : `will-change: transform` n'est posé que pendant le geste (au repos, une carte
// ne réserve aucun calque). Le reflet est le `::after` de la balise, un dégradé radial dont la souris écrit le
// centre (deux variables) : aucun élément n'est posé dans la carte (le `* + *`, `:last-child` ou
// `childElementCount` de l'auteur ne le voient pas) et il se dessine aussi sur un composant. Le déplacer sans
// le repeindre n'est pas possible dans un pseudo-élément : un rognage qui suit la souris (`clip-path` animé) fait
// repeindre le pseudo-élément à chaque mouvement, davantage qu'un dégradé écrit par variable (mesuré).

// le rebond est une section du fichier : une appli qui n'écrit pas bounce ne l'embarque pas
// @@ bounce
// ressort sous-amorti x'' = -2·ζ·ω·x' - ω²·(x - 1), de dépassement `b` : ζ = -ln b / √(π² + ln² b) ;
// enveloppe e^-5t (0,7 % en fin de course, qui se pose alors sur 1), échantillonné en 48 pas
var _mjsTiltSpring = function(b) {
  var l = Math.log(b);
  var z = -l / Math.sqrt(Math.PI * Math.PI + l * l);
  var q = Math.sqrt(1 - z * z);
  var w = 5 / z * q;
  var p = ['0'];
  for (var i = 1; i < 48; i++) {
    var t = i / 48;
    p.push((1 - Math.exp(-5 * t) * (Math.cos(w * t) + z / q * Math.sin(w * t))).toFixed(3).replace(/\.?0+$/, ''));
  }
  return 'linear(' + p.join(',') + ',1)';
};
// @@

µ._mjs_fxDefs.tilt = {
  css: '[mjs-fx~="tilt"]{transform:perspective(var(--mjs-tilt-perspective,800px)) rotateX(var(--mjs-fx-tilt-rx,0deg)) rotateY(var(--mjs-fx-tilt-ry,0deg)) scale(var(--mjs-fx-tilt-scale,1));transition:transform var(--mjs-tilt-duration,450ms) var(--mjs-tilt-ease,cubic-bezier(.2,.8,.2,1));transition-delay:var(--mjs-tilt-wait,0ms)}'
    + '[mjs-fx~="tilt"][mjs-fx-tilt-active]{transition:transform var(--mjs-tilt-follow,100ms) linear;will-change:transform}'
    + '[mjs-fx~="tilt"][mjs-fx-tilt-glare]::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(circle at var(--mjs-fx-tilt-gx,50%) var(--mjs-fx-tilt-gy,50%),rgba(255,255,255,.35),transparent 60%);opacity:0;transition:opacity .3s}'
    + '[mjs-fx~="tilt"][mjs-fx-tilt-glare][mjs-fx-tilt-active]::after{opacity:1}'
    + '[mjs-fx~="tilt"][mjs-fx-tilt-depth]{transform-style:preserve-3d}'
    + '[mjs-fx~="tilt"][mjs-fx-tilt-depth] > *{translate:0 0 var(--mjs-tilt-depth,0px)}'
    + '[mjs-fx~="tilt"][mjs-fx-tilt-slide]{background-position-x:var(--mjs-fx-tilt-bx,50%)}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="tilt"]{transform:none;transition:none}[mjs-fx~="tilt"][mjs-fx-tilt-glare]::after{display:none}[mjs-fx~="tilt"][mjs-fx-tilt-depth] > *{translate:none}}',
  vars: { perspective: 'px', duration: '', depth: 'px', follow: '', wait: '' },
  setup: function(el, s) {
    var max     = s.max !== void 0 ? s.max : 12;
    var scale   = s.scale !== void 0 ? s.scale : 1.03;
    var sign    = s.direction === 'away' ? -1 : 1;
    var restore = s.glare ? µ._mjs_fxRelative(el) : function() {};
    var inline  = µ._mjs_fxMovable(el);
    var box     = null;
    // les enfants flottent devant la carte tant que la profondeur n'est pas nulle
    var depth   = function(v) {
      if (v) µ._mjs_dom.setAttribute(el, 'mjs-fx-tilt-depth', '');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-tilt-depth');
    };
    // @@ bounce
    // le rebond du retour : une courbe de ressort, posée seulement quand il est demandé et que le navigateur la sait
    var bounce = function(v) {
      v = Math.min(0.5, v);
      if (v > 0.01 && window.CSS && CSS.supports('transition-timing-function', 'linear(0,1)')) el.style.setProperty('--mjs-tilt-ease', _mjsTiltSpring(v));
      else el.style.removeProperty('--mjs-tilt-ease');
    };
    bounce(+s.bounce || 0);
    // @@
    if (s.glare) µ._mjs_dom.setAttribute(el, 'mjs-fx-tilt-glare', '');
    depth(s.depth);
    if (s.slide) µ._mjs_dom.setAttribute(el, 'mjs-fx-tilt-slide', '');
    var inside = function(e) { return box && e.clientX > box.left && e.clientX < box.right && e.clientY > box.top && e.clientY < box.bottom; };
    // la carte a défilé sous le pointeur (sa boîte oubliée) : sa boîte se relit à plat, comme à l'entrée — l'inclinaison et le
    // grossissement retirés le temps d'une lecture, sans transition (le relais `--mjs-tilt-follow` à 0s), puis remis
    var level = function() {
      var tilt = ['--mjs-fx-tilt-rx', '--mjs-fx-tilt-ry', '--mjs-fx-tilt-scale'];
      var kept = tilt.map(function(n) { return el.style.getPropertyValue(n); });
      var pace = el.style.getPropertyValue('--mjs-tilt-follow');
      el.style.setProperty('--mjs-tilt-follow', '0s');
      tilt.forEach(function(n) { el.style.removeProperty(n); });
      var r = µ._mjs_dom.getBoundingClientRect(el);
      tilt.forEach(function(n, i) { if (kept[i]) el.style.setProperty(n, kept[i]); });
      // l'angle remis s'applique sur l'instant (lire la boîte applique le style), puis le suivi retrouve sa durée : il repart de cet angle
      µ._mjs_dom.getBoundingClientRect(el);
      if (pace) el.style.setProperty('--mjs-tilt-follow', pace);
      else el.style.removeProperty('--mjs-tilt-follow');
      return r;
    };
    var move = function(e) {
      if (!box) box = level();
      var r = box;
      if (!r.width || !r.height) return;
      var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      var y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      el.style.setProperty('--mjs-fx-tilt-rx', (sign * (y - 0.5) * 2 * max).toFixed(2) + 'deg');
      el.style.setProperty('--mjs-fx-tilt-ry', (sign * (0.5 - x) * 2 * max).toFixed(2) + 'deg');
      el.style.setProperty('--mjs-fx-tilt-scale', String(scale));
      if (s.glare) {
        el.style.setProperty('--mjs-fx-tilt-gx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--mjs-fx-tilt-gy', (y * 100).toFixed(1) + '%');
      }
      if (s.slide) el.style.setProperty('--mjs-fx-tilt-bx', (25 + x * 50).toFixed(1) + '%');
    };
    var reset = function() {
      box = null;
      document.removeEventListener('pointermove', follow);
      document.removeEventListener('scroll', scrolled, true);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-tilt-active');
      el.style.removeProperty('--mjs-fx-tilt-rx');
      el.style.removeProperty('--mjs-fx-tilt-ry');
      el.style.removeProperty('--mjs-fx-tilt-scale');
      el.style.removeProperty('--mjs-fx-tilt-bx');
    };
    // la page (ou un conteneur) défile sous la carte : sa boîte n'est plus à sa place, elle est oubliée et relue au
    // mouvement suivant — l'inclinaison se calculait sur l'ancienne place, et une carte sortie de sous le pointeur
    // restait suivie tant qu'il restait dans l'ancien cadre
    var scrolled = function() { box = null; };
    // pointeur sorti de la carte inclinée mais encore dans son cadre à plat : suivi par le document
    var follow = function(e) {
      if (inside(e)) move(e);
      else reset();
    };
    // @@ wait
    // la carte revient encore à plat (attente ou retour en cours) : sa transition de `transform` court
    var returning = function() {
      var a = el.getAnimations ? µ._mjs_dom.getAnimations(el) : [];
      return a.some(function(x) { return x.transitionProperty === 'transform'; });
    };
    // sa boîte à plat, lue là où elle est aujourd'hui : posée à plat sans transition (celle du retour s'arrête, et sa cible n'attend plus un délai
    // quand elle vaut celle du repos), lue, puis remise dans l'angle où elle était, appliqué sur l'instant (lire les animations applique le style) :
    // le suivi repart de cet angle ; rien n'est dessiné entre les deux, et une transition d'une autre propriété continue. La lecture n'écrit en ligne que `transform`
    // et `transition` (qui fixe aussi ses propriétés séparées), celle-ci avec la priorité `!important` pour battre une transition `!important` de la feuille de l'auteur.
    // Avant : la valeur et la priorité de `transform`, de `transition` et de chaque propriété séparée de transition que le navigateur expose. Après : ce qui a été posé
    // est retiré, puis chacune est remise avec sa valeur et sa priorité (rien si elle était vide), le raccourci d'abord (il porte un `var()` que les propriétés séparées ne
    // rendent pas) puis les propriétés séparées. Aucune autre déclaration de l'auteur n'est lue ni réécrite : relire puis réécrire le texte du style la déforme dans
    // Chromium et WebKit quand un raccourci à plusieurs propriétés est suivi d'un champ plus court (`animation`, `background`, `mask` aussi). L'ordre des déclarations peut changer,
    // sans effet (une valeur par propriété). Un raccourci qui porte un `var()` suivi d'un champ séparé n'est lisible par aucune API : il ne se rend pas
    var flatBox = function() {
      var was   = getComputedStyle(el).transform;
      var names = ['transform', 'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior'];
      var kept  = names.map(function(n) { return [el.style.getPropertyValue(n), el.style.getPropertyPriority(n)]; });
      el.style.setProperty('transition', 'all 0s', 'important');
      el.style.transform = 'none';
      var r              = µ._mjs_dom.getBoundingClientRect(el);
      el.style.transform = was;
      returning();
      el.style.removeProperty('transition');
      el.style.removeProperty('transform');
      names.forEach(function(n, i) { if (kept[i][0]) el.style.setProperty(n, kept[i][0], kept[i][1]); });
      return r;
    };
    // @@
    var enter = function() {
      document.removeEventListener('pointermove', follow);
      document.addEventListener('scroll', scrolled, { capture: true, passive: true });
      if (!box && returning()) box = flatBox(); // @@ wait
      if (!box) box = µ._mjs_dom.getBoundingClientRect(el);
      µ._mjs_dom.setAttribute(el, 'mjs-fx-tilt-active', '');
    };
    var leave = function(e) {
      if (inside(e)) document.addEventListener('pointermove', follow);
      else reset();
    };
    µ._mjs_dom.addEventListener(el, 'pointerenter', enter);
    µ._mjs_dom.addEventListener(el, 'pointermove', move);
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
    var off = function() {
      µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      reset();
      el.style.removeProperty('--mjs-fx-tilt-gx');
      el.style.removeProperty('--mjs-fx-tilt-gy');
      el.style.removeProperty('--mjs-tilt-ease'); // @@ bounce
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-tilt-glare');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-tilt-depth');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-tilt-slide');
      restore();
      inline();
    };
    // la profondeur tenue par une variable : sa variable CSS suit (le moteur), les enfants flottent ou
    // reviennent à plat avec elle ; les autres réglages relancent l'effet
    off.set = function(k, v) {
      if (k === 'depth') depth(v);
      else if (k === 'bounce') bounce(+v || 0); // @@ bounce
      else return false;
    };
    return off;
  }
};
