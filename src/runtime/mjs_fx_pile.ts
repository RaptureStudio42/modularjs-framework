// mjs_fx_pile — `*pile` : les enfants directs de la balise sont des panneaux qui s'empilent au
// défilement : chacun monte du bas, vient se coller en haut, `gap` plus bas que le précédent, et le
// recouvre ; un panneau recouvert rapetisse, s'assombrit, se floute. Réglages : gap (le décalage de
// chaque panneau sous le précédent en px, on voit le haut de ceux d'avant ; 0), top (la distance au
// haut de la zone visible où les panneaux se collent, en px ; 0), scale (ce que perd en taille un
// panneau chaque fois qu'un autre le recouvre, de 0 à 0.3 ; 0.05), dim (ce qu'il perd en lumière
// chaque fois, de 0 à 1, 1 = noir ; 0), blur (le flou qu'il prend chaque fois, en px ; 0), radius
// (l'arrondi des panneaux en px ; celui qu'ils ont déjà), origin (top : un panneau recouvert
// rapetisse vers son bord haut ; center : vers son milieu ; top).
// Technique : `position: sticky` et un `top` par panneau (l'index posé une fois dans une variable CSS,
// le reste est du calcul CSS) ; rien ne bouge à l'écran par JavaScript hors le recouvrement. Le
// recouvrement d'un panneau (de 0 à 1 : la part de lui cachée par le suivant) se lit sur la boîte du
// suivant ; la profondeur d'un panneau est la somme des recouvrements de tous ceux qui sont au-dessus
// de lui (« chaque fois qu'un autre le recouvre »), c'est la SEULE variable écrite par panneau
// (`--mjs-fx-pile-d`), enregistrée non héritée quand le navigateur le permet : la changer ne
// recalcule pas le style du contenu du panneau. L'échelle, le filtre en découlent en CSS.
// La mise en page se lit HORS de l'image d'animation : à l'arrivée près de l'écran, au redimensionnement,
// quand les panneaux changent ou changent de taille (la zone visible et son padding haut,
// après lequel les panneaux se collent, le haut du contenu de la pile, le `bottom` que l'auteur a posé
// sur un panneau, la place naturelle de chaque panneau, lue le temps d'un instant sans `sticky`, et sa
// hauteur, ramenées à la mise en page avec l'échelle qu'on y a posée). Pendant le défilement elle ne se relit
// que si une mesure bon marché dit qu'elle a changé, quelle que soit la cadence des évènements (une relecture coûte deux
// mises en page : à cadence lente, relire au premier évènement de chaque série les multiplierait) : la boîte de la pile
// elle-même (elle n'est pas collante) a quitté la place que le défilement lui donne, c'est que quelque chose a changé de
// hauteur au-dessus (une image qui se charge) ; une pile qui défile elle-même lit à la place la hauteur de son contenu (sa boîte
// ne bouge pas quand c'est son contenu qui monte, et toute sa géométrie est dans son propre repère, mais un panneau qui change
// de hauteur, une image qui se charge dans le panneau, change celle de son contenu) ; un observateur de taille voit le reste
// (deux panneaux qui changent en sens contraire de la même quantité ne changent pas la hauteur du contenu) ; la hauteur de la boîte de la pile
// (padding, bordure, `gap` du conteneur, marge d'un panneau : rien de tout cela ne change la taille d'un panneau ni la place de la boîte) est comparée
// à celle de la dernière lecture, à chaque évènement (une lecture de plus sur une mise en page déjà à jour) et par l'observateur de taille, au repos.
// L'image d'animation ne lit plus rien : la place d'un panneau se calcule (sa place
// naturelle moins le défilement, remontée par son `bottom`, ou sa place collée si elle est plus basse ; le
// défilement se lit à son événement), puis elle écrit seulement ce qui change. Aucune boucle : l'écouteur de
// défilement n'existe que tant que la pile est près de l'écran, une image est demandée par défilement (jamais
// au repos), `will-change` n'est posé que pendant le mouvement, et deux images la première fois que la pile
// est près de l'écran : sans ce passage par un calque, le texte des panneaux est rastérisé autrement avant le
// premier défilement qu'après, et change d'aspect (d'un pixel, et de lissage) quand on défile. Il n'y a pas de
// ligne de temps CSS (`animation-timeline`) : la profondeur d'un panneau somme des recouvrements dont les
// plages dépendent de la mise en page mesurée, et chaque panneau resterait un calque en permanence.
// « Réduire les animations » : l'empilement collant reste, sans rapetissement, sans assombrissement
// ni flou, et plus aucun écouteur. Sans `scale`, `dim` ni `blur`, la pile ne fait que se coller.
// Une balise en `overflow` qui ne défile pas (hidden, auto sans hauteur), la pile elle-même ou un de ses
// ancêtres, casse `sticky` : la console le dit, une fois par pile, et la pile ne calcule plus rien (rien
// ne se colle, donc rien ne rapetissit : ni écouteur, ni image demandée) ; relu chaque fois qu'elle
// arrive près de l'écran. Une pile qui défile elle-même (`overflow: auto` et une hauteur) est sa propre
// zone visible. Le corps compte quand la racine rogne aussi (sinon son `overflow` passe à la fenêtre).
// Un `zoom` CSS (ou une échelle) sur la zone ou au-dessus change l'unité des boîtes lues à l'écran, pas celle du défilement, du padding et des `offset*` de la zone (pour la page, le
// défilement est à l'écran) : le rapport des deux ramène les boîtes à la mise en page. Il est lu avec le reste de la géométrie, arrondi au centième seulement quand la taille entière de la
// mise en page l'explique (un zoom de quatre tiers resterait sinon à 1,33 et la boîte de la pile ne tomberait plus où le défilement la prédit). Un `zoom` sur la pile, ou entre elle et
// la zone, change l'unité de ses `gap`, `top` et `bottom`, de sa bordure et de son padding : le rapport de la pile à la zone les ramène à la mise en page.
// Le suivi du défilement est propre à la pile : µ._mjs_fxScroll suit UNE balise et cherche son
// conteneur à chaque image, quatre panneaux feraient quatre écouteurs et quatre lectures. Un seul
// écouteur par racine (le document, les shadow roots) : un défilement de la page n'appelle qu'une fois.

(function() {
  // l'échelle d'un panneau très enfoui ne descend pas plus bas
  var MIN = 0.2;
  var num = function(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  var DFLT = { gap: 0, top: 0, scale: 0.05, dim: 0, blur: 0 };
  var clock = function() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };

  µ._mjs_fxDefs.pile = {
    css: '[mjs-fx~="pile"]>*{position:sticky;top:calc(var(--mjs-pile-top,0px) + var(--mjs-fx-pile-i,0) * var(--mjs-pile-gap,0px));transform-origin:50% 0}'
      + '[mjs-fx~="pile"][mjs-fx-pile-origin="center"]>*{transform-origin:50% 50%}'
      + '[mjs-fx~="pile"][mjs-fx-pile-radius]>*{border-radius:var(--mjs-pile-radius)}'
      + '[mjs-fx~="pile"]>[mjs-fx-pile-under]{scale:max(' + MIN + ',calc(1 - var(--mjs-pile-scale,.05) * var(--mjs-fx-pile-d,0)))}'
      + '[mjs-fx~="pile"][mjs-fx-pile-dim]>[mjs-fx-pile-under]{filter:brightness(max(0,calc(1 - var(--mjs-pile-dim,0) * var(--mjs-fx-pile-d,0))))}'
      + '[mjs-fx~="pile"][mjs-fx-pile-blur]>[mjs-fx-pile-under]{filter:blur(calc(var(--mjs-pile-blur,0px) * var(--mjs-fx-pile-d,0)))}'
      + '[mjs-fx~="pile"][mjs-fx-pile-dim][mjs-fx-pile-blur]>[mjs-fx-pile-under]{filter:brightness(max(0,calc(1 - var(--mjs-pile-dim,0) * var(--mjs-fx-pile-d,0)))) blur(calc(var(--mjs-pile-blur,0px) * var(--mjs-fx-pile-d,0)))}'
      + '[mjs-fx~="pile"][mjs-fx-pile-read]>*{position:relative!important;top:auto!important;bottom:auto!important}'
      + '[mjs-fx~="pile"][mjs-fx-pile-moving]>*{will-change:scale}'
      + '[mjs-fx~="pile"][mjs-fx-pile-moving][mjs-fx-pile-dim]>*,[mjs-fx~="pile"][mjs-fx-pile-moving][mjs-fx-pile-blur]>*{will-change:scale,filter}'
      + '@media (prefers-reduced-motion:reduce){[mjs-fx~="pile"]>[mjs-fx-pile-under]{scale:none!important;filter:none!important}[mjs-fx~="pile"][mjs-fx-pile-moving]>*{will-change:auto!important}}',
    vars: { gap: 'px', top: 'px', scale: '', dim: '', blur: 'px', radius: 'px' },
    setup: function(el, s) {
      // la profondeur d'un panneau, enregistrée NON héritée : l'écrire ne recalcule que son panneau, pas
      // tout son contenu (le navigateur sans `CSS.registerProperty` la garde héritée, ça marche pareil)
      µ._mjs_fxRegister('--mjs-fx-pile-d', '<number>', '0');
      var calm     = µ._mjs_fxCalm();
      var cfg      = { gap: num(s.gap, 0), top: num(s.top, 0), scale: num(s.scale, 0.05), dim: num(s.dim, 0), blur: num(s.blur, 0), radius: s.radius, origin: s.origin === 'center' ? 'center' : 'top' };
      var items    = [];
      var depth    = [];
      var sc       = [];
      var nat      = [];
      var tall     = [];
      var low      = [];
      var pos      = 0;
      var inset    = 0;
      var room     = 0;
      var start    = 0;
      var mark     = 0;
      var markAt   = 0;
      var full     = 0;
      var side     = 0;
      var zoom     = 1;
      var unit     = 1;
      var ready    = false;
      var pane     = null;
      var unwatch  = null;
      var sizes    = null;
      var raf      = 0;
      var timer    = 0;
      var last     = 0;
      var moving   = false;
      var primed   = false;
      var prime    = 0;
      var visible  = false;
      var attached = false;
      var broken   = false;
      var judged   = false;
      var done     = false;
      var seeing   = null;
      var mo       = null;

      var flag = function(name, on, value) {
        if (on) µ._mjs_dom.setAttribute(el, 'mjs-fx-pile-' + name, value || '');
        else µ._mjs_dom.removeAttribute(el, 'mjs-fx-pile-' + name);
      };
      var flags = function() {
        flag('origin', cfg.origin === 'center', 'center');
        flag('dim', cfg.dim > 0);
        flag('blur', cfg.blur > 0);
        flag('radius', typeof cfg.radius === 'number');
      };
      // le panneau rendu tel quel : plus de profondeur, plus de marque
      var clear = function(i) {
        items[i].style.removeProperty('--mjs-fx-pile-d');
        µ._mjs_dom.removeAttribute(items[i], 'mjs-fx-pile-under');
        depth[i] = NaN;
        sc[i]    = 1;
      };
      // la pile a quelque chose à calculer : un recouvrement à suivre, au moins deux panneaux, et rien qui casse `sticky`
      var wants = function() { return !calm && !broken && items.length > 1 && (cfg.scale > 0 || cfg.dim > 0 || cfg.blur > 0); };

      // la zone visible où les panneaux se collent : la balise elle-même ou l'ancêtre le plus proche qui rogne ou défile, sinon
      // la page ; le corps ne compte que si la racine rogne aussi (sinon son `overflow` passe à la fenêtre et ne casse rien)
      var cuts = function(n) {
        var cs = getComputedStyle(n);
        return !/^(visible|clip)$/.test(cs.overflowY || 'visible') || !/^(visible|clip)$/.test(cs.overflowX || 'visible');
      };
      var find = function() {
        if (typeof getComputedStyle !== 'function') return null;
        for (var n = el; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = µ._mjs_fxParent(n)) {
          if (cuts(n)) return n;
        }
        return document.body && cuts(document.documentElement) && cuts(document.body) ? document.body : null;
      };
      // la balise ou un ancêtre qui rogne sans défiler (hidden, auto sans hauteur) : les panneaux ne se collent plus, il n'y a
      // rien à calculer (`broken`) ; relu à chaque arrivée près de l'écran (sa mise en page est alors posée), dit une fois
      var check = function() {
        var p = find();
        // pas encore rendue (sans IntersectionObserver, l'arrivée est annoncée avant le premier rendu) : pas de verdict, la prochaine lecture de la géométrie le rend
        if (p && !p.clientHeight && !p.clientWidth) return;
        judged = true;
        var cs = p ? getComputedStyle(p) : null;
        broken = !!p && !(/(auto|scroll)/.test(cs.overflowY || '') && p.scrollHeight > p.clientHeight + 1);
        if (!broken || el._mjs_fxPileWarn) return;
        el._mjs_fxPileWarn = true;
        µ.warn(µ._mjs_msg('pileOverflow', { tag: p.localName || '' }, '*pile : <{tag}> a un « overflow » (hidden, auto…) mais ne défile pas : les panneaux ne peuvent plus se coller (position: sticky). Retirez-le, ou remplacez-le par « overflow: clip ».'));
      };
      // le rapport entre l'écran et la mise en page d'une boîte (un `zoom` CSS, une échelle) : sa taille de mise en page est un entier (`offset*`, à un pixel près selon
      // sa place), un centième rond qui l'explique à un pixel près est le bon rapport (un zoom de 1,25 sur une zone de 333,4 px de haut), tout autre est gardé tel quel (un zoom de 1,3333)
      var ratio = function(n, r) {
        var size = Math.max(n.offsetWidth, n.offsetHeight);
        var v    = Math.max(r.width, r.height) / size;
        var c    = Math.round(v * 100) / 100;
        return (Math.abs(v - c) * size <= c ? c : v) || 1;
      };
      // l'attribut style qu'on a fait naître sur un panneau (il n'en avait pas) et vidé repart avec nous
      var tidy = function(c) {
        if (c._mjs_fxPileHad === false && µ._mjs_dom.getAttribute(c, 'style') === '') µ._mjs_dom.removeAttribute(c, 'style');
        c._mjs_fxPileHad = void 0;
      };

      // toute la mise en page lue, ici et jamais dans l'image d'animation : la zone visible et son défilement, ce qui borne les panneaux
      // collés (le padding de la zone, le haut du contenu de la pile, le `bottom` que l'auteur a posé sur un panneau), la place de la pile
      // elle-même (qui n'est pas collante), puis la place naturelle de chaque panneau dans la zone (sans `sticky` le temps de la lecture :
      // collé, un panneau ne dit pas où il serait) et sa hauteur, ramenées à la mise en page avec l'échelle que la pile a posée
      var geo = function() {
        if (!judged) {
          check();
          if (broken) return refresh();
        }
        if (!wants()) return;
        pane = find();
        var zone = pane ? getComputedStyle(pane) : null;
        var box  = µ._mjs_dom.getBoundingClientRect(el);
        var area = pane ? µ._mjs_dom.getBoundingClientRect(pane) : null;
        // un `zoom` CSS (ou une échelle) sur la zone ou au-dessus : les boîtes se lisent à l'écran, le défilement et les mesures de la zone sont dans ses
        // propres unités (celles de l'écran pour la page) ; le rapport des deux ramène les boîtes à la mise en page
        zoom   = area ? ratio(pane, area) : 1;
        // un autre `zoom` sur la pile, ou entre elle et la zone : ses `gap`, `top` et `bottom`, sa bordure et son padding sont dans l'unité de la pile ; son rapport à la zone les y ramène
        unit   = ratio(el, box) / zoom;
        var base = area ? area.top + pane.clientTop * zoom : 0;
        var mid  = cfg.origin === 'center';
        pos    = pane ? pane.scrollTop : window.scrollY;
        // la hauteur du contenu d'une pile qui défile elle-même, lue avant la bascule de lecture (les panneaux collés, comme à chaque évènement)
        full   = pane === el ? el.scrollHeight : 0;
        // un panneau collé s'arrête au padding de la zone (le bas utile de la zone sert au `bottom` d'un panneau) et ne quitte pas la pile par le haut
        inset  = zone ? parseFloat(zone.paddingTop) || 0 : 0;
        room   = zone ? pane.clientHeight - (parseFloat(zone.paddingBottom) || 0) : document.documentElement.clientHeight;
        // le haut du contenu de la pile dans le contenu de la zone ; la pile qui défile elle-même le garde à son padding, quel que soit son défilement
        start  = (pane === el ? 0 : (box.top - base) / zoom + pos + el.clientTop * unit) + (parseFloat(getComputedStyle(el).paddingTop) || 0) * unit;
        mark   = box.top;
        // la hauteur de la boîte de la pile (padding, bordure, `gap`, marge d'un panneau la changent sans changer la taille d'un panneau)
        side   = el.offsetHeight;
        markAt = pos;
        var i;
        for (i = 0; i < items.length; i++) {
          var bottom = getComputedStyle(items[i]).bottom;
          low[i] = /px$/.test(bottom) ? parseFloat(bottom) : NaN;
        }
        flag('read', true);
        for (i = 0; i < items.length; i++) {
          var r = µ._mjs_dom.getBoundingClientRect(items[i]);
          var h = r.height / sc[i] / zoom;
          tall[i] = h;
          nat[i]  = (r.top - base) / zoom - (mid ? h * (1 - sc[i]) / 2 : 0) + pos;
        }
        flag('read', false);
        ready = true;
      };

      // les réglages visuels tels que la feuille les donne (un thème `--mjs-pile-scale` posé plus haut, la balise) :
      // lus à la pose et à chaque arrivée près de l'écran (pas quand un réglage vient de changer : la feuille n'a pas
      // encore sa nouvelle valeur), jamais dans la boucle
      var sync = function() {
        if (typeof getComputedStyle !== 'function') return;
        var read = function(k, d) {
          var v = parseFloat(µ._mjs_fxCss(el, '--mjs-pile-' + k));
          return isFinite(v) ? v : d;
        };
        cfg.gap    = read('gap', cfg.gap);
        cfg.top    = read('top', cfg.top);
        cfg.scale  = read('scale', cfg.scale);
        cfg.dim    = read('dim', cfg.dim);
        cfg.blur   = read('blur', cfg.blur);
        cfg.radius = read('radius', cfg.radius);
        flags();
      };

      // les panneaux : les enfants directs, repérés une fois par leur rang
      var index = function() {
        var now = [];
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
          if (!/^(script|style|template|link|meta)$/i.test(c.localName)) now.push(c);
        }
        for (var j = 0; j < items.length; j++) {
          if (now.indexOf(items[j]) >= 0) continue;
          clear(j);
          items[j].style.removeProperty('--mjs-fx-pile-i');
          tidy(items[j]);
        }
        // ceux qui restent gardent ce qu'on a écrit sur eux (profondeur, échelle), les nouveaux repartent de zéro
        var keptDepth = [];
        var keptScale = [];
        for (var k = 0; k < now.length; k++) {
          var at = items.indexOf(now[k]);
          if (at < 0) now[k]._mjs_fxPileHad = µ._mjs_dom.hasAttribute(now[k], 'style');
          keptDepth[k] = at >= 0 ? depth[at] : NaN;
          keptScale[k] = at >= 0 ? sc[at] : 1;
        }
        items = now;
        depth = keptDepth;
        sc    = keptScale;
        ready = false;
        for (var i = 0; i < items.length; i++) items[i].style.setProperty('--mjs-fx-pile-i', String(i));
        if (attached) geo();
        refresh();
        track();
      };

      // le haut d'un panneau dans la zone : sa place naturelle moins le défilement ; remontée jusqu'au bas de la zone si l'auteur lui a posé
      // un `bottom` (sans sortir de la pile par le haut) ; puis, une fois collé, sa place collée (`sticky`), après le padding de la zone
      var place = function(i) {
        var y = nat[i] - pos;
        if (!isNaN(low[i])) y = Math.min(y, room - low[i] * unit - tall[i]);
        return Math.max(y, inset + (cfg.top + i * cfg.gap) * unit, start - pos);
      };

      // aucune lecture : la géométrie et le défilement sont ceux lus hors de l'image ; puis les écritures, seulement celles qui changent
      var update = function() {
        raf = 0;
        var n = items.length;
        if (done || !wants() || !ready) return;
        var i;
        // le recouvrement de chaque panneau par le suivant (0 → 1), cumulé du dernier au premier : la profondeur
        var deep  = [];
        var sum   = 0;
        var below = place(n - 1);
        deep[n - 1] = 0;
        for (i = n - 2; i >= 0; i--) {
          var above = place(i);
          if (tall[i] > 0 && tall[i + 1] > 0) {
            var c = (above + tall[i] - below) / Math.max(1, tall[i] - cfg.gap * unit);
            sum += c < 0 ? 0 : c > 1 ? 1 : c;
          }
          deep[i] = sum;
          below   = above;
        }
        var moved = false;
        for (i = 0; i < n; i++) {
          var v = Math.round(deep[i] * 1000) / 1000;
          if (v === depth[i]) continue;
          var was = depth[i] > 0;
          depth[i] = v;
          sc[i]    = Math.max(MIN, 1 - cfg.scale * v);
          moved    = moved || was || v > 0;
          items[i].style.setProperty('--mjs-fx-pile-d', String(v));
          if (was === v > 0) continue;
          if (v > 0) µ._mjs_dom.setAttribute(items[i], 'mjs-fx-pile-under', '');
          else µ._mjs_dom.removeAttribute(items[i], 'mjs-fx-pile-under');
        }
        // une pile qui se pose à zéro (rien n'a bougé, rien ne bouge) n'a pas besoin de will-change
        if (!moved) return;
        last = clock();
        if (!moving) {
          moving = true;
          flag('moving', true);
        }
        if (!timer) timer = setTimeout(settle, 160);
      };
      // le mouvement est fini : `will-change` est rendu
      var settle = function() {
        timer = 0;
        var gone = clock() - last;
        if (gone < 150) {
          timer = setTimeout(settle, 160 - gone);
          return;
        }
        moving = false;
        flag('moving', false);
      };
      var ask = function() {
        if (!raf && !done && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(update);
      };

      // un défilement qui compte : celui de la zone visible de la pile, ou de la page quand rien ne rogne
      // à chaque évènement, quelle que soit la cadence : le défilement et une seule mesure, la boîte de la pile (elle n'est pas collante : elle suit
      // le défilement tant que rien ne bouge au-dessus) ; si elle a quitté sa place, quelque chose a changé de hauteur au-dessus (une image qui se
      // charge) et la géométrie est relue ; la pile qui défile elle-même garde sa boîte en place (c'est son contenu qui monte) et toute sa géométrie
      // dans son propre repère : rien d'au-dessus ne la change, mais un panneau qui change de hauteur (une image qui se charge dans le panneau)
      // change la hauteur de son contenu, qu'elle compare à celle de la dernière lecture ; tant qu'une lecture n'a pas abouti, elle se refait
      var move = function() {
        if (!ready || !judged) geo();
        else {
          pos = pane ? pane.scrollTop : window.scrollY;
          if ((pane === el ? el.scrollHeight !== full : Math.abs(µ._mjs_dom.getBoundingClientRect(el).top - (mark - (pos - markAt) * zoom)) > 1) || Math.abs(el.offsetHeight - side) > 1) geo();
        }
        ask();
      };
      var onScroll = function(e) {
        var t = e && e.target;
        if (t === pane || (!pane && (t === document || t === window))) return move();
        if (t && t.nodeType === 1 && µ._mjs_fxWithin(t, el)) {
          geo();
          ask();
        }
      };
      // la fenêtre ou la pile change de taille : la géométrie est relue
      var resize = function() {
        geo();
        ask();
      };
      // la taille d'un panneau a changé (une image qui se charge dans le panneau, un contenu qui se replie) : la géométrie est relue ; l'annonce de la
      // pose de l'observateur ne change rien, les tailles sont alors celles de la dernière lecture
      var resized = function(list) {
        for (var j = 0; j < list.length; j++) {
          if (list[j].target === el) {
            if (Math.abs(el.offsetHeight - side) > 1) return resize();
            continue;
          }
          var at = items.indexOf(list[j].target);
          var bs = list[j].borderBoxSize;
          if (at >= 0 && Math.abs((bs ? (bs[0] || bs).blockSize : list[j].target.offsetHeight) - tall[at]) > 1) return resize();
        }
      };
      // les panneaux surveillés sont ceux d'aujourd'hui
      var track = function() {
        if (!sizes) return;
        sizes.disconnect();
        for (var j = 0; j < items.length; j++) sizes.observe(items[j]);
        // la boîte de la pile elle-même, bordure et padding compris
        sizes.observe(el, { box: 'border-box' });
      };
      // ce que l'outil de surveillance annonce : un défilement (avec son événement), un redimensionnement (avec le sien, ou sans, quand c'est la pile)
      var watch = function(e) {
        if (e && e.type === 'scroll') onScroll(e);
        else resize();
      };
      // la première fois, les panneaux passent deux images sur un calque (will-change) : leur texte est alors rastérisé comme il l'est après un
      // défilement ; sans cela, il changerait d'aspect (d'un pixel, et de lissage) au premier défilement
      var warm = function() {
        if (primed || typeof requestAnimationFrame !== 'function') return;
        primed = true;
        flag('moving', true);
        prime = requestAnimationFrame(function() {
          prime = requestAnimationFrame(function() {
            prime = 0;
            if (!moving && !done) flag('moving', false);
          });
        });
      };
      var attach = function() {
        if (attached || !visible || !wants()) return;
        attached = true;
        geo();
        unwatch = µ._mjs_fxWatch(el, watch);
        if (typeof ResizeObserver === 'function') {
          sizes = new ResizeObserver(resized);
          track();
        }
        warm();
        ask();
      };
      var detach = function() {
        if (!attached) return;
        attached = false;
        unwatch();
        if (sizes) sizes.disconnect();
        sizes = null;
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf = 0;
      };
      // ce qui a changé (panneaux, réglages) : tout est relu au prochain tracé ; sans rien à calculer, tout est rendu
      var refresh = function() {
        flags();
        if (wants()) {
          for (var i = 0; i < items.length; i++) {
            if (!isNaN(depth[i])) sc[i] = Math.max(MIN, 1 - cfg.scale * depth[i]);
          }
          if (attached) ask();
          else if (visible) attach();
        }
        else {
          detach();
          if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
          raf = 0;
          for (var j = 0; j < items.length; j++) clear(j);
        }
      };

      sync();
      index();
      mo = typeof MutationObserver === 'function' ? new MutationObserver(index) : null;
      if (mo) mo.observe(el, { childList: true });
      // près de l'écran : l'écouteur de défilement vit ; loin : une dernière lecture, puis plus rien
      seeing = µ._mjs_fxVisible(el, '200px 0px', function() {
        visible = true;
        check();
        sync();
        // la pile n'a plus rien à calculer (`sticky` cassé) : ce qu'elle suivait est rendu
        if (broken) refresh();
        else attach();
      }, function() {
        visible = false;
        // la dernière lecture fige l'état ; une pile qu'on n'a jamais vue près de l'écran en prend un, d'après le défilement d'aujourd'hui
        if (attached || !ready) {
          geo();
          update();
        }
        detach();
      });

      var off = function() {
        done = true;
        seeing();
        if (mo) mo.disconnect();
        detach();
        // une image demandée avant la pose de l'écouteur (la première lecture) ne doit rien écrire après le retrait
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf = 0;
        if (prime && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(prime);
        prime = 0;
        clearTimeout(timer);
        for (var i = 0; i < items.length; i++) {
          clear(i);
          items[i].style.removeProperty('--mjs-fx-pile-i');
          tidy(items[i]);
        }
        ['origin', 'dim', 'blur', 'radius', 'moving'].forEach(function(k) { flag(k, false); });
        el._mjs_fxPileWarn = false;
      };
      // tous les réglages se suivent sur place : une variable CSS (le moteur) et, ici, ce que le calcul en lit
      off.set = function(k, v) {
        if (Object.prototype.hasOwnProperty.call(DFLT, k)) cfg[k] = num(v, DFLT[k]);
        else if (k === 'radius') cfg.radius = v;
        else if (k === 'origin') cfg.origin = v === 'center' ? 'center' : 'top';
        else return false;
        refresh();
      };
      return off;
    }
  };
})();
