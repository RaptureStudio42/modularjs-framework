// mjs_fx_stagger — `*stagger` : les lettres arrivent l'une après l'autre — ou les mots (`unit:
// word`). Sur un calque de lettres posé par-dessus le texte, qui reste en place. Réglages : style
// (l'arrivée de chaque lettre : move — elle glisse —, zoom, flip, blur, rotate, fade ; move),
// direction (move : le sens du glissement, un mot ou un angle ; up), step (l'écart entre deux
// lettres ; 45ms), duration (d'une lettre ; 500ms), order (l'ordre : right, left, center, edges,
// random), distance (le chemin d'une lettre en px ; 16), delay (l'attente avant la première),
// easing, unit (letter, word ; letter), on (view, hover, click, load ; scroll : l'arrivée suit le
// défilement — rien au bas de la zone visible, tout quand la balise en atteint le milieu, et
// retour en arrière si l'on remonte), zone (scroll : la bande de l'écran où se joue l'arrivée,
// `60% 40%` — elle part quand le haut du texte passe la première hauteur, elle est finie à la
// seconde), opacity (l'opacité de départ de chaque lettre ou mot : `.2`, ceux à venir restent en
// gris ; 0).
// Au défilement, sans step ni easing écrits : un mot après l'autre, d'un pas régulier (le pas vaut
// la durée d'un mot), sans courbe — un texte qui se révèle au fil de la lecture. Une balise collante (position:
// sticky) dans une section plus haute que l'écran : l'arrivée suit la traversée de la section (cf.
// µ._mjs_fxStuck), le texte reste en place pendant que les mots s'allument.
// Variantes : `unit: line` — le texte arrive ligne par ligne, telles qu'elles tombent à l'écran ; les
// lignes se lisent à la mise en page (les mots groupés par leur `offsetTop`, une seule lecture),
// refaites quand la LARGEUR de la balise change (ResizeObserver) ou qu'une police arrive tard
// (document.fonts.ready), sans rejouer l'arrivée ; chaque mot porte le rang de sa ligne
// (--mjs-fx-stagger-k) : les mots d'une ligne arrivent ensemble. `unit: child` — ce sont les enfants
// directs de la balise qui arrivent l'un après l'autre, sur place, sans calque de texte (ni script,
// style, template, slot, ni calque d'un autre effet) : chacun reçoit la marque `mjs-fx-child` et son
// rang ; un enfant ajouté plus tard arrive seul, à son tour, les autres ne rejouent pas. `clip` : false
// par défaut — chaque unité monte de derrière un cache, visible seulement dans sa propre boîte ; sans
// effet sur fade et blur. Lettres, mots et lignes sont enveloppés d'un cache (`mjs-fx-cut`, overflow:
// clip, avec une marge de rognage pour les jambages et les accents, compensée par une marge négative) ;
// un enfant n'est pas enveloppé : il glisse et sa découpe (`clip-path`) se contre-déplace, la fenêtre
// reste sa propre boîte. Sans distance écrite, l'unité part de toute sa boîte (--mjs-fx-stagger-d).
// Le pas par défaut : 45ms pour une lettre ou un mot, 130ms pour une ligne, 90ms pour un enfant
// (--mjs-fx-stagger-sp, posé en ligne tant que ni la balise ni le thème n'écrivent de pas).
// Au repos d'une ligne ou d'un enfant (arrivée finie, ou avancée au bout) : plus d'animation, plus de
// will-change, caches retirés ; au défilement ils reviennent dès que l'avancée repasse sous 1. Lettres et
// mots n'ont pas de repos : comme avant les variantes, leurs animations restent posées (et leurs caches, s'ils
// en ont). « Réduire les animations » : rien ne s'anime, aucune fin n'arrive — les enfants redeviennent
// naturels dès que l'arrivée est jouée.
// Au défilement, l'avancée (--mjs-fx-stagger-p, enregistrée sans héritage) est écrite sur chaque unité qui s'anime (mot,
// lettre, enfant), jamais sur la balise : écrite sur la balise et héritée, elle ferait recalculer le style de tous ses
// descendants à chaque image. Elle n'est écrite que si elle change : hors de l'arrivée (0 avant, 1 après) l'état est posé
// une fois, puis rien à chaque image. Les mots d'une ligne et les enfants ont leur calque (will-change : transform,
// opacity) tant que l'avancée est entre 0 et 1 (`mjs-fx-stagger-live` sur la balise) ET que SA propre arrivée est en
// cours (`mjs-fx-stagger-now` sur l'unité, posé au début de son animation et retiré à sa fin ou à son annulation : cette
// animation est en pause, son délai suit l'avancée, et elle dit elle-même quand elle commence et quand elle finit) :
// l'animation en pause dont le délai change à chaque image ne repeint pas le calque du parent, et une ligne ou un
// enfant dont l'arrivée est finie rend son calque, donc sa graisse, à ce moment-là, pas à la fin de toutes. Une ligne
// n'est pas une balise : ce sont ses mots qui portent le calque. Pas de calque pour une lettre ni un mot (des centaines,
// sans repos pour les rendre).
// Sections marquées (`// @@ …`, filtrées par le build, bundler/fx-sections.ts) : `unit: line`, `unit: child`, `clip` et `on: scroll` ne partent que si
// l'appli écrit le réglage ; tel quel, le fichier porte tout. Ce que fait `*stagger` sans rien écrire (les lettres et les mots, les six styles, le
// pas et la courbe) n'est dans aucune section. Les drapeaux `line` et `rests` se déclarent dans la section des lignes et des enfants, `scroll` dans
// celle du défilement, des lignes et des enfants ; `child` est toujours là (le calque de texte n'est pas posé pour des enfants).

µ._mjs_fxDefs.stagger = {
  css: µ._mjs_fxOrderCss('stagger')
    + '[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-letter]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-stagger-step,45ms)) 1 normal both}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="zoom"]{--mjs-fx-stagger-name:mjs-fx-stagger-zoom}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"]{--mjs-fx-stagger-name:mjs-fx-stagger-flip}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="blur"]{--mjs-fx-stagger-name:mjs-fx-stagger-blur}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="rotate"]{--mjs-fx-stagger-name:mjs-fx-stagger-rotate}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="fade"]{--mjs-fx-stagger-name:mjs-fx-stagger-fade}'
    // les mots plutôt que les lettres : le rang de chaque mot est posé sur lui (--mjs-fx-stagger-k)
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-letter]{animation:none}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-stagger-step,45ms)) 1 normal both}'
    // @@ unit=line,child
    // le pas qu'une ligne ou un enfant prend sans pas écrit : l'effet pose son défaut en ligne dans --mjs-fx-stagger-sp, la variable du pas écrit reprend la main dès qu'elle existe
    + '[mjs-fx~="stagger"]{--mjs-fx-stagger-sp:var(--mjs-stagger-step,45ms)}'
    // @@
    // @@ unit=line
    // les lignes : les mots s'animent, au rang de leur ligne
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="line"][mjs-fx-play~="stagger"] [mjs-fx-letter]{animation:none}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="line"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-fx-stagger-sp)) 1 normal both;will-change:transform,opacity}'
    // @@
    // @@ unit=child
    // les enfants : chaque enfant marqué (mjs-fx-child) s'anime sur place ; avant l'arrivée jouée (on: view), il attend à son état de départ
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="child"][mjs-fx-play~="stagger"] > [mjs-fx-child]{animation:var(--mjs-fx-stagger-name,mjs-fx-stagger-move) var(--mjs-stagger-duration,500ms) var(--mjs-stagger-easing,ease-out) calc(var(--mjs-stagger-delay,0s) + var(--mjs-fx-stagger-k) * var(--mjs-fx-stagger-sp)) 1 normal both;will-change:transform,opacity}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="child"][mjs-fx-wait] > [mjs-fx-child]{opacity:var(--mjs-stagger-opacity,0)}'
    // @@
    // @@ on=scroll
    // au défilement : l'animation arrêtée, son instant tiré de l'avancée (--mjs-fx-stagger-p) — un
    // délai négatif place chaque lettre au bon moment de son arrivée
    // (le pas `--mjs-fx-stagger-st` et la courbe `--mjs-fx-stagger-ease` : ceux que l'effet pose au
    // défilement quand ils ne sont pas écrits)
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll] [mjs-fx-layer="text"]{--mjs-fx-stagger-total:calc((var(--mjs-fx-stagger-c,1) - 1) * var(--mjs-fx-stagger-st,var(--mjs-stagger-step,45ms)) + var(--mjs-stagger-duration,500ms))}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-unit="child"]{--mjs-fx-stagger-total:calc((var(--mjs-fx-stagger-c,1) - 1) * var(--mjs-fx-stagger-st,var(--mjs-stagger-step,45ms)) + var(--mjs-stagger-duration,500ms))}' // @@ unit=child
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-play~="stagger"] [mjs-fx-letter],[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-unit="word"][mjs-fx-play~="stagger"] [mjs-fx-word]{animation-play-state:paused;animation-timing-function:var(--mjs-fx-stagger-ease,var(--mjs-stagger-easing,ease-out));animation-delay:calc(var(--mjs-fx-stagger-k) * var(--mjs-fx-stagger-st,var(--mjs-stagger-step,45ms)) - var(--mjs-fx-stagger-p,0) * var(--mjs-fx-stagger-total))}'
    // @@ unit=line,child
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-unit="line"][mjs-fx-play~="stagger"] [mjs-fx-word],[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-unit="child"][mjs-fx-play~="stagger"] > [mjs-fx-child]{animation-play-state:paused;animation-timing-function:var(--mjs-fx-stagger-ease,var(--mjs-stagger-easing,ease-out));animation-delay:calc(var(--mjs-fx-stagger-k) * var(--mjs-fx-stagger-st,var(--mjs-stagger-step,45ms)) - var(--mjs-fx-stagger-p,0) * var(--mjs-fx-stagger-total));will-change:auto}'
    // pendant l'arrivée (l'avancée entre 0 et 1), les mots d'une ligne et les enfants dont SA propre arrivée est en cours (`mjs-fx-stagger-now`) ont leur calque : l'animation en pause dont le délai change à chaque image ne repeint pas celui du parent ; celui d'une ligne ou d'un enfant qui a fini s'en va avec sa fin
    + '[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-live][mjs-fx-stagger-unit="line"][mjs-fx-play~="stagger"] [mjs-fx-word][mjs-fx-stagger-now],[mjs-fx~="stagger"][mjs-fx-stagger-scroll][mjs-fx-stagger-live][mjs-fx-stagger-unit="child"][mjs-fx-play~="stagger"] > [mjs-fx-child][mjs-fx-stagger-now]{will-change:transform,opacity}'
    // @@
    // @@
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"] [mjs-fx-word]{perspective:400px}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"] [mjs-fx-letter]{transform-origin:50% 100%}'
    + '[mjs-fx~="stagger"][mjs-fx-stagger-style="flip"][mjs-fx-stagger-unit="child"][mjs-fx-play~="stagger"] > [mjs-fx-child]{transform-origin:50% 100%}' // @@ unit=child
    // la lettre arrive du côté opposé à son mouvement : `direction` up → elle monte depuis le bas
    + '@keyframes mjs-fx-stagger-move{from{opacity:var(--mjs-stagger-opacity,0);transform:translate(calc(var(--mjs-fx-stagger-x,0) * -1 * var(--mjs-stagger-distance,16px)),calc(var(--mjs-fx-stagger-y,-1) * -1 * var(--mjs-stagger-distance,16px)))}}'
    + '@keyframes mjs-fx-stagger-zoom{from{opacity:var(--mjs-stagger-opacity,0);transform:scale(.3)}}'
    + '@keyframes mjs-fx-stagger-flip{from{opacity:var(--mjs-stagger-opacity,0);transform:rotateX(-90deg)}}'
    + '@keyframes mjs-fx-stagger-blur{from{opacity:var(--mjs-stagger-opacity,0);filter:blur(8px)}}'
    + '@keyframes mjs-fx-stagger-rotate{from{opacity:var(--mjs-stagger-opacity,0);transform:rotate(-45deg) scale(.6)}}'
    + '@keyframes mjs-fx-stagger-fade{from{opacity:var(--mjs-stagger-opacity,0)}}'
    // @@ unit=child
    // un enfant qui bascule : sans le calque, sa perspective est dans sa propre transformation
    + '[mjs-fx~="stagger"][mjs-fx-stagger-unit="child"][mjs-fx-stagger-style="flip"]{--mjs-fx-stagger-name:mjs-fx-stagger-child-flip}'
    + '@keyframes mjs-fx-stagger-child-flip{from{opacity:var(--mjs-stagger-opacity,0);transform:perspective(400px) rotateX(-90deg)}}'
    // @@
    // @@ clip=true
    // le cache (clip) : l'unité part de toute sa boîte (--mjs-fx-stagger-d : celle de la distance écrite, sinon posée en ligne par l'effet) ; la lettre, le mot ou la ligne, rognés par leur enveloppe
    + '[mjs-fx~="stagger"][mjs-fx-stagger-clip]{--mjs-fx-stagger-d:var(--mjs-stagger-distance,16px);--mjs-fx-stagger-name:mjs-fx-stagger-clip-move}'
    + '[mjs-fx~="stagger"] [mjs-fx-cut]{display:inline-block;vertical-align:top;overflow:hidden;overflow:clip;padding:.25em .12em;margin:-.25em -.12em}'
    + '@keyframes mjs-fx-stagger-clip-move{from{opacity:var(--mjs-stagger-opacity,0);transform:translate(calc(var(--mjs-fx-stagger-x,0) * -1 * var(--mjs-fx-stagger-d)),calc(var(--mjs-fx-stagger-y,-1) * -1 * var(--mjs-fx-stagger-d)))}}'
    // @@
    // @@ clip=true
    // l'enfant, lui, glisse et sa découpe se contre-déplace de la même longueur (en % de sa boîte, ou en px écrits) : la fenêtre reste la boîte de l'enfant, élargie de 10 %
    // @@ unit=child
    + '[mjs-fx~="stagger"][mjs-fx-stagger-clip][mjs-fx-stagger-unit="child"]{--mjs-fx-stagger-name:mjs-fx-stagger-clip-box}'
    + '@keyframes mjs-fx-stagger-clip-box{from{opacity:var(--mjs-stagger-opacity,0);transform:translate(calc(var(--mjs-fx-stagger-x,0) * -1 * var(--mjs-fx-stagger-d)),calc(var(--mjs-fx-stagger-y,-1) * -1 * var(--mjs-fx-stagger-d)));clip-path:inset(calc(var(--mjs-fx-stagger-y,-1) * var(--mjs-fx-stagger-d) - 10%) calc(var(--mjs-fx-stagger-x,0) * -1 * var(--mjs-fx-stagger-d) - 10%) calc(var(--mjs-fx-stagger-y,-1) * -1 * var(--mjs-fx-stagger-d) - 10%) calc(var(--mjs-fx-stagger-x,0) * var(--mjs-fx-stagger-d) - 10%))}to{clip-path:inset(-10%)}}'
    // @@
    // @@
    // @@ unit=line,child
    // au repos d'une ligne (arrivée finie, ou avancée au bout) : plus d'animation, plus de will-change
    + '[mjs-fx~="stagger"][mjs-fx-stagger-rest][mjs-fx-stagger-rest][mjs-fx-stagger-rest] [mjs-fx-letter],[mjs-fx~="stagger"][mjs-fx-stagger-rest][mjs-fx-stagger-rest][mjs-fx-stagger-rest] [mjs-fx-word]{animation:none;will-change:auto}'
    // @@
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-word][mjs-fx-word]{will-change:auto}}' // @@ unit=line
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="stagger"][mjs-fx-play~="stagger"] > [mjs-fx-child][mjs-fx-child]{animation:none;will-change:auto}}' // @@ unit=child
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-letter][mjs-fx-letter],[mjs-fx~="stagger"][mjs-fx-play~="stagger"] [mjs-fx-word][mjs-fx-word]{animation:none}}',
  vars: { step: '', duration: '', distance: 'px', delay: '', easing: '', opacity: '' },
  setup: function(el, s, comp) {
    var words  = s.unit === 'word';
    var child  = s.unit === 'child';
    // @@ unit=line,child
    var line   = s.unit === 'line';
    // le repos (les animations retirées à la fin) ne vaut que pour une ligne et un enfant : lettres et mots gardent les leurs, comme avant
    var rests  = line || child;
    words      = words || line;
    // @@
    var scroll = s.on === 'scroll'; // @@ on=scroll unit=line,child
    // @@ clip=true
    var slide  = !s.style || s.style === 'move';
    // le cache ne sert à rien à fade et blur (rien ne sort de la boîte) : ni enveloppe, ni découpe
    var cut    = s.clip === true && s.style !== 'fade' && s.style !== 'blur';
    // @@
    if (s.style && s.style !== 'move') µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-style', s.style);
    if (s.order && s.order !== 'right') µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-order', s.order);
    if (s.unit === 'word') µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-unit', 'word');
    if (rests) µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-unit', s.unit); // @@ unit=line,child
    if (cut && slide) µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-clip', ''); // @@ clip=true
    var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 0));
    el.style.setProperty('--mjs-fx-stagger-x', String(v.x));
    el.style.setProperty('--mjs-fx-stagger-y', String(v.y));
    // @@ unit=line,child clip=true
    // le pas d'une ligne ou d'un enfant, la distance d'un cache : posés en ligne tant que ni la balise ni le thème
    // n'écrivent le réglage (`k` : step, distance ; `x` : sa valeur écrite) — sa variable CSS les remplace sinon
    var dflts = {};
    // @@
    if (rests) dflts.step = ['--mjs-fx-stagger-sp', line ? '130ms' : '90ms']; // @@ unit=line,child
    if (cut && slide) dflts.distance = ['--mjs-fx-stagger-d', child ? '115%' : 'calc(100% + .35em)']; // @@ clip=true
    // @@ unit=line,child clip=true
    var fall = function(k, x) {
      var d = dflts[k];
      if (!d) return;
      if (x === void 0 && !µ._mjs_fxCss(el, '--mjs-stagger-' + k)) el.style.setProperty(d[0], d[1]);
      else el.style.removeProperty(d[0]);
    };
    fall('step', s.step);
    fall('distance', s.distance);
    // @@
    var tx     = child ? null : µ._mjs_fxLayer(comp, el);
    var units  = 0; // @@ unit=line,child
    var ended  = 0; // @@ unit=line
    var rested = false; // @@ unit=line,child clip=true
    var played = false; // @@ unit=child
    var alive  = true; // @@ unit=line
    var kids   = []; // @@ unit=child
    // @@ on=scroll
    // ── au défilement : l'avancée écrite sur chaque unité qui s'anime (les enfants, les mots, ou les lettres), pas sur la
    // balise ; `cells` : les unités du calque, relues à chaque reconstruction. Elle n'est écrite que si elle change : `fed` est
    // celle que portent les unités d'aujourd'hui (0 : rien d'écrit, la variable enregistrée vaut 0 sans cela), `prog` celle
    // du défilement. Hors de l'arrivée (0 avant, 1 après) l'état est posé une fois ; au repos (lignes, enfants) rien n'est écrit
    var cells  = null;
    var prog   = 0;
    var fed    = 0;
    // @@
    // @@ unit=line,child
    // le calque des lignes et des enfants pendant l'arrivée, rendu à sa fin : il ne sert qu'au défilement
    // @@ on=scroll
    var live   = false;
    // plus aucune unité n'a son calque (le repos, le retrait)
    var dim    = function(us) {
      if (us) for (var i = 0; i < us.length; i++) µ._mjs_dom.removeAttribute(us[i], 'mjs-fx-stagger-now');
    };
    // @@
    // @@
    // @@ on=scroll
    var feed   = function(p) {
      var us = cells;
      if (child) us = kids; // @@ unit=child
      if (rested) return; // @@ unit=line,child
      if (!us || p === fed) return;
      fed = p;
      var v = String(p);
      for (var i = 0; i < us.length; i++) us[i].style.setProperty('--mjs-fx-stagger-p', v);
    };
    // @@
    // @@ unit=child
    // ── les enfants : un élément direct, ni calque d'effet ni balise sans boîte
    var mine = function(n) {
      return n.nodeType === 1 && n.parentNode === el && !µ._mjs_dom.hasAttribute(n, 'mjs-fx-layer') && !/^(script|style|template|slot)$/.test(n.localName);
    };
    var flag = function(c, k) {
      µ._mjs_dom.setAttribute(c, 'mjs-fx-child', '');
      c.style.setProperty('--mjs-fx-stagger-k', String(k));
    };
    var unflag = function(c) {
      µ._mjs_dom.removeAttribute(c, 'mjs-fx-child');
      c.style.removeProperty('--mjs-fx-stagger-k');
      c.style.removeProperty('--mjs-fx-stagger-p');
      µ._mjs_dom.removeAttribute(c, 'mjs-fx-stagger-now');
      if (c.getAttribute('style') === '') c.removeAttribute('style');
    };
    // tous les enfants redeviennent naturels
    var unmark = function() {
      for (var i = 0; i < el.children.length; i++) if (µ._mjs_dom.hasAttribute(el.children[i], 'mjs-fx-child')) unflag(el.children[i]);
      fed = 0; // @@ on=scroll
    };
    // tous les enfants en une seule cascade, dans l'ordre demandé
    var rankAll = function() {
      kids = [];
      for (var i = 0; i < el.children.length; i++) if (mine(el.children[i])) kids.push(el.children[i]);
      var r = µ._mjs_fxRanks(kids.length, s.order || 'right');
      for (var j = 0; j < kids.length; j++) flag(kids[j], r[j]);
      units = kids.length;
      el.style.setProperty('--mjs-fx-stagger-c', String(units));
      fed = 0; // @@ on=scroll
      feed(prog); // @@ on=scroll
    };
    // @@
    // @@ unit=line
    // ── les lignes : les mots groupés par leur place à la mise en page (une lecture, aucune écriture entre
    // les lectures), le rang de la ligne posé sur chaque mot ; rend le nombre de lignes
    var lines = function(ws) {
      var tops = [];
      for (var i = 0; i < ws.length; i++) tops.push(ws[i].offsetTop);
      var rows = [];
      var n    = 0;
      for (var j = 0; j < ws.length; j++) {
        if (j > 0 && tops[j] - tops[j - 1] > 1) n++;
        rows.push(n);
      }
      var total = ws.length > 0 ? n + 1 : 0;
      var r     = µ._mjs_fxRanks(total, s.order || 'right');
      for (var k = 0; k < ws.length; k++) ws[k].style.setProperty('--mjs-fx-stagger-k', String(r[rows[k]]));
      return total;
    };
    // @@
    // @@ clip=true
    // ── le cache : chaque unité (lettre, mot ; une ligne = ses mots) dans une enveloppe qui la rogne ; posé
    // pour l'arrivée, retiré au repos — rien ne sert plus à la fin
    var wrap = function() {
      if (!cut || child || !tx.layer || µ._mjs_fxCalm()) return;
      var us = tx.layer.querySelectorAll(words ? '[mjs-fx-word]' : '[mjs-fx-letter]');
      for (var i = 0; i < us.length; i++) {
        if (µ._mjs_dom.hasAttribute(us[i].parentNode, 'mjs-fx-cut')) continue;
        var w = document.createElement('span');
        w.setAttribute('mjs-fx-cut', '');
        us[i].parentNode.insertBefore(w, us[i]);
        w.appendChild(us[i]);
      }
    };
    var unwrap = function() {
      if (!tx || !tx.layer) return;
      var ws = tx.layer.querySelectorAll('[mjs-fx-cut]');
      for (var i = 0; i < ws.length; i++) {
        var p = ws[i].parentNode;
        p.insertBefore(ws[i].firstChild, ws[i]);
        p.removeChild(ws[i]);
      }
    };
    // @@
    // @@ unit=line,child
    // ── le repos d'une ligne ou d'un enfant : sans animation (les enfants démarqués, les lignes sous `mjs-fx-stagger-rest`), caches
    // retirés ; `yes` faux : l'arrivée reprend la main (le défilement qui repasse sous 1). Lettres et mots n'en ont pas
    // il n'existe que pour une ligne, ou pour un enfant dont l'arrivée suit le défilement : seuls ces deux cas l'appellent
    // @@ unit=line on=scroll
    var settle = function(yes) {
      if (!rests || rested === yes) return;
      rested = yes;
      // @@ unit=child
      if (child) {
        if (!yes) return rankAll();
        unmark();
        return;
      }
      // @@
      // @@ unit=line
      if (yes) {
        µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-rest', '');
        unwrap(); // @@ clip=true
        dim(cells); // @@ on=scroll
        return;
      }
      wrap(); // @@ clip=true
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-rest');
      // @@
    };
    // @@
    // @@
    var play = function() {
      played = true; // @@ unit=child
      ended  = 0; // @@ unit=line
      if (child) rankAll(); // @@ unit=child
      wrap(); // @@ clip=true
      // @@ unit=line
      if (line) {
        rested = false;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-rest');
      }
      // @@
      µ._mjs_fxPlay(el, 'stagger');
      // « réduire les animations » : rien ne s'anime, aucune fin n'arrivera — les enfants redeviennent naturels tout de suite
      if (child && µ._mjs_fxCalm()) unmark(); // @@ unit=child
    };
    // @@ unit=line,child
    // la fin d'une animation de l'effet : un enfant redevient naturel à la sienne, le texte au retour de la dernière ; au
    // défilement, l'avancée seule décide du repos. Une vraie fin seulement : une animation rembobinée dans son attente
    // (un pas ou un délai qui change pendant l'arrivée, un retour en arrière) dit aussi `animationend`, sans être finie
    var over = function(t) {
      if (typeof t.getAnimations !== 'function') return true;
      var list = t.getAnimations();
      for (var i = 0; i < list.length; i++) if ((list[i].animationName || '').indexOf('mjs-fx-stagger') === 0 && list[i].playState !== 'finished') return false;
      return true;
    };
    var onEnd = function(e) {
      var t = e.target;
      if (scroll || !t || t === el || (e.animationName || '').indexOf('mjs-fx-stagger') !== 0 || !over(t)) return;
      // @@ unit=child
      if (child) {
        if (t.parentNode === el && µ._mjs_dom.hasAttribute(t, 'mjs-fx-child')) unflag(t);
        return;
      }
      // @@
      // @@ unit=line
      if (tx.layer && tx.layer.contains(t) && µ._mjs_dom.hasAttribute(t, words ? 'mjs-fx-word' : 'mjs-fx-letter') && ++ended >= units) settle(true);
      // @@
    };
    // @@
    var mo = null; // @@ unit=child
    var ro = null; // @@ unit=line
    // sans la section des enfants, le bloc qui suit tient seul
    // @@ unit=child
    if (child) {
      rankAll();
      // un enfant venu plus tard arrive seul, à son tour ; avant la première arrivée, ou au défilement, tous refont une cascade.
      // Un enfant déplacé (retiré puis remis dans le même tour : une liste triée, un {for} à clés qui réordonne) n'est pas neuf
      mo = typeof MutationObserver === 'function' ? new MutationObserver(function(list) {
        var fresh = [];
        var moved = [];
        for (var i = 0; i < list.length; i++) moved.push.apply(moved, list[i].removedNodes);
        for (i = 0; i < list.length; i++) {
          for (var j = 0; j < list[i].addedNodes.length; j++) {
            var n = list[i].addedNodes[j];
            if (mine(n) && !µ._mjs_dom.hasAttribute(n, 'mjs-fx-child') && moved.indexOf(n) < 0) fresh.push(n);
          }
        }
        if (!played || scroll) {
          if (rested) el.style.setProperty('--mjs-fx-stagger-c', String(Array.prototype.filter.call(el.children, mine).length));
          else rankAll();
        }
        else if (fresh.length > 0 && !µ._mjs_fxCalm()) {
          var r = µ._mjs_fxRanks(fresh.length, s.order || 'right');
          for (var k = 0; k < fresh.length; k++) flag(fresh[k], r[k]);
        }
      }) : null;
      if (mo) mo.observe(el, { childList: true });
    }
    else
    // @@
    {
      // à chaque reconstruction du calque : le rang des mots, et le nombre d'éléments qui arrivent
      var count = function() {
        if (!tx.layer) return;
        var ws = tx.layer.querySelectorAll('[mjs-fx-word]');
        var ls = words ? ws : tx.layer.querySelectorAll('[mjs-fx-letter]');
        var n  = ls.length;
        cells = ls; // @@ on=scroll
        // @@ unit=line
        if (line) n = lines(ws);
        else
        // @@
        if (words) {
          var r = µ._mjs_fxRanks(ws.length, s.order || 'right');
          for (var i = 0; i < ws.length; i++) ws[i].style.setProperty('--mjs-fx-stagger-k', String(r[i]));
        }
        units = words ? ws.length : n; // @@ unit=line,child
        ended = 0; // @@ unit=line
        tx.layer.style.setProperty('--mjs-fx-stagger-c', String(n));
        // un texte qui change une fois l'arrivée finie arrive à nouveau (ses lettres neuves se jouent, comme toujours) ;
        // sinon le cache est reposé sur les unités neuves
        if (rested && !scroll) play(); // @@ unit=line
        if (!rested) wrap(); // @@ clip=true
        fed = 0; // @@ on=scroll
        feed(prog); // @@ on=scroll
      };
      count();
      tx.onBuild(count);
      // @@ unit=line
      if (line) {
        // la largeur de la balise change, ou une police arrive : les lignes tombent ailleurs — le rang des mots est
        // relu, l'arrivée ne rejoue pas
        var regroup = function() {
          if (!alive || !tx.layer) return;
          tx.layer.style.setProperty('--mjs-fx-stagger-c', String(lines(tx.layer.querySelectorAll('[mjs-fx-word]'))));
        };
        var width = -1;
        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(function(entries) {
            var w = entries[entries.length - 1].contentRect.width;
            if (w === width) return;
            width = w;
            regroup();
          });
          ro.observe(el);
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(regroup);
      }
      // @@
    }
    if (rests) µ._mjs_dom.addEventListener(el, 'animationend', onEnd); // @@ unit=line,child
    // @@ unit=line,child
    // au défilement l'animation de chaque unité est en pause, son délai suit l'avancée : elle dit elle-même quand son arrivée commence et quand elle finit
    // @@ on=scroll
    var kinds = ['animationstart', 'animationend', 'animationcancel'];
    var lit   = function(e) {
      var t = e.target;
      if (t === el || (e.animationName || '').indexOf('mjs-fx-stagger') !== 0) return;
      if (e.type === 'animationstart') µ._mjs_dom.setAttribute(t, 'mjs-fx-stagger-now', '');
      else µ._mjs_dom.removeAttribute(t, 'mjs-fx-stagger-now');
    };
    if (scroll && rests) kinds.forEach(function(k) { µ._mjs_dom.addEventListener(el, k, lit); });
    // @@
    // @@
    var stop;
    // sans la section du défilement, la ligne qui suit tient seule
    // @@ on=scroll
    // au défilement : un mot après l'autre, d'un pas régulier, sans courbe — sauf pas ou courbe écrits
    // (`k` : step, easing ; `v` : sa valeur), ou posés par le thème
    var regular = function(k, v) {
      var p = k === 'step' ? '--mjs-fx-stagger-st' : '--mjs-fx-stagger-ease';
      if (v !== void 0 || µ._mjs_fxCss(el, '--mjs-stagger-' + k)) el.style.removeProperty(p);
      else el.style.setProperty(p, k === 'step' ? 'var(--mjs-stagger-duration,500ms)' : 'linear');
    };
    if (scroll) {
      µ._mjs_fxRegister('--mjs-fx-stagger-p', '<number>', '0');
      µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-scroll', '');
      regular('step', s.step);
      regular('easing', s.easing);
      µ._mjs_fxPlay(el, 'stagger');
      stop = µ._mjs_fxScroll(el, function(p) {
        prog = p;
        settle(p >= 1); // @@ unit=line,child
        feed(p);
        // l'arrivée est en cours : les lignes et les enfants ont leur calque (lettres et mots, rien de plus qu'avant)
        // @@ unit=line,child
        var now = rests && p > 0 && p < 1;
        if (now === live) return;
        live = now;
        if (now) µ._mjs_dom.setAttribute(el, 'mjs-fx-stagger-live', '');
        else µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-live');
        // @@
      }, s.zone);
    }
    else
    // @@
    stop = µ._mjs_fxWhen(el, s.on, function() { play(); });
    var off = function() {
      alive = false; // @@ unit=line
      stop();
      if (mo) mo.disconnect(); // @@ unit=child
      if (ro) ro.disconnect(); // @@ unit=line
      µ._mjs_dom.removeEventListener(el, 'animationend', onEnd); // @@ unit=line,child
      unwrap(); // @@ clip=true
      // @@ unit=line,child
      // les unités qui avaient leur calque le rendent, et l'écoute de leurs animations s'arrête
      kinds.forEach(function(k) { µ._mjs_dom.removeEventListener(el, k, lit); }); // @@ on=scroll
      dim(cells); // @@ on=scroll
      // @@
      // @@ on=scroll
      if (cells) for (var i = 0; i < cells.length; i++) cells[i].style.removeProperty('--mjs-fx-stagger-p');
      // @@
      if (tx) tx.off();
      if (child) unmark(); // @@ unit=child
      µ._mjs_fxPlay(el, 'stagger', true);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-style');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-order');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-unit');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-scroll'); // @@ on=scroll
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-clip'); // @@ clip=true
      // @@ unit=line,child
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-rest');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-stagger-live');
      // @@
      el.style.removeProperty('--mjs-fx-stagger-x');
      el.style.removeProperty('--mjs-fx-stagger-y');
      // @@ on=scroll
      el.style.removeProperty('--mjs-fx-stagger-st');
      el.style.removeProperty('--mjs-fx-stagger-ease');
      // @@
      el.style.removeProperty('--mjs-fx-stagger-sp'); // @@ unit=line,child
      el.style.removeProperty('--mjs-fx-stagger-d'); // @@ clip=true
      el.style.removeProperty('--mjs-fx-stagger-c'); // @@ unit=child
    };
    // @@ on=scroll unit=line,child clip=true
    // le pas ou la courbe tenus par une variable : leur variable CSS suit (le moteur) ; au défilement,
    // le pas régulier et la courbe linéaire cèdent la place à la valeur écrite, et reviennent quand
    // elle est effacée
    // le pas d'une ligne ou d'un enfant et la distance d'un cache : leur défaut posé en ligne suit de même (cf. fall)
    off.set = function(k, v) {
      if (k !== 'step' && k !== 'easing' && k !== 'distance') return false;
      // un réglage effacé : le moteur retire sa variable juste après, le thème se lit sans elle
      if (v === void 0) el.style.removeProperty('--mjs-stagger-' + k);
      fall(k, v); // @@ unit=line,child clip=true
      if (scroll && k !== 'distance') regular(k, v); // @@ on=scroll
    };
    // @@
    return off;
  }
};
