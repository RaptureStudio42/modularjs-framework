// mjs_fx_velocity — `*velocity` : la balise réagit à la VITESSE du défilement : elle penche, s'étire,
// bascule, se bombe, se floute ou prend du retard selon la vitesse à laquelle la page (ou le
// conteneur qui la porte) défile, et revient à plat dès qu'on s'arrête. Réglages : style (skew : elle
// penche ; stretch : elle s'étire dans le sens du défilement ; tilt : elle bascule en 3D ; bend : elle
// se bombe comme une feuille ; blur : flou de vitesse ; shift : elle prend du retard puis rattrape ;
// skew), strength (la force de la réaction, de 0 à 5 : à 1 elle est pleine vers 1 500 px par seconde, à 2 vers 750 ; 2),
// max (la borne de la déformation, en degrés pour skew et tilt, en % pour stretch, en px pour blur,
// shift et bend ; 12), smooth (la vitesse du retour à plat, de 0.01 à 1 : la part de la vitesse
// nouvelle prise à chaque image à 60 images par seconde, la même à toute cadence ; 0.15), axis (y : le
// défilement de haut en bas ; x : de côté ; y).
// Technique : UNE boucle pour toute la page, quel que soit le nombre de balises : un seul écouteur de
// défilement (par racine : un défilement ne sort pas d'un shadow root), la position de chaque défilement
// suivi lue à son événement (l'image d'animation ne lit rien de la mise en page), la vitesse lissée par
// balise ; par balise une seule variable écrite
// par image (la vitesse bornée de -1 à 1, `--mjs-fx-velocity-v`, enregistrée non héritée quand le
// navigateur le permet : la changer ne recalcule pas le contenu de la balise) ; skew, scale, rotate,
// translate et filter en découlent en CSS, tant que la balise n'est pas à plat. Une balise hors de
// l'écran n'est pas écrite ; la boucle s'arrête d'elle-même quand plus rien ne défile et que tout est
// revenu à plat ; les écouteurs ne vivent que tant qu'une balise est à l'écran ; `will-change` n'est
// posé que pendant la déformation. Une balise suit les défilements de tous ses ancêtres qui défilent
// et de la page : sa vitesse est la somme des leurs. Un saut (une ancre, un retour en haut sans glissé, une page qui revient en haut :
// plus d'un écran du défilement en une image ; Page suivante sans défilement doux : plus d'un demi-écran d'un coup, au repos) n'est
// pas une vitesse : il ne compte pas, la balise reste à plat. Un défilement rapide, lui, a déjà bougé à l'image d'avant.
// La déformation s'AJOUTE au style de l'auteur, posé en feuille ou en ligne : pour la propriété que le
// style écrit (transform pour skew et tilt, scale pour stretch, translate pour shift, filter pour blur
// et bend), la valeur de l'auteur est lue une fois, au premier défilement qui suit un arrêt (à
// l'événement de défilement, jamais dans l'image d'animation), reprise par le CSS de la déformation,
// puis rendue telle quelle à l'arrêt. Une balise au repos ne porte que sa tenue (`mjs-fx-velocity-style` et `-axis`) :
// aucune variable, aucun attribut style qu'elle n'avait pas. Une balise en ligne (span, lien) passe en
// inline-block le temps de l'effet (µ._mjs_fxMovable), sans quoi rien ne se transforme.
// bend : un filtre SVG `feDisplacementMap` propre à la balise, posé dans la même racine qu'elle, dont la
// carte de déplacement (un profil en cloche le long de l'axe : les lignes du milieu s'élargissent) est
// dessinée UNE fois ; seul son attribut `scale` suit la vitesse, la balise ne porte le filtre que
// pendant la déformation. C'EST LE STYLE COÛTEUX : un filtre SVG se repeint à chaque image, les
// autres se règlent par la carte graphique. En effets économes (µ._mjs_fxLite) bend retombe sur skew.
// « Réduire les animations » : rien ne bouge, aucun écouteur.

(function() {
  var NS     = 'http://www.w3.org/2000/svg';
  // la vitesse (px par ms) où la réaction est pleine pour une force de 1
  var VREF   = 1.5;
  // en deçà de cette part de la vitesse pleine, la balise est à plat
  var FLAT   = 0.004;
  // les segments droits du profil en cloche de bend (les arrêts de son dégradé) : l'écart du bord à la courbe vaut π² / (4 × BELL²)
  // de la bosse, 0,05 px pour 80 px à 64 segments ; à 8, le bord se brisait en facettes (1,5 px d'écart pour 40 px)
  var BELL   = 64;
  var STYLES = ['skew', 'stretch', 'tilt', 'bend', 'blur', 'shift'];
  // la propriété que chaque style écrit : celle de l'auteur y est lue, la déformation s'y ajoute
  var PROP   = { skew: 'transform', tilt: 'transform', stretch: 'scale', shift: 'translate', blur: 'filter', bend: 'filter' };
  // tout ce que l'effet écrit sur la balise pendant le mouvement (le style de l'auteur repris, la vitesse, le filtre de bend)
  var VARS   = ['--mjs-fx-velocity-v', '--mjs-fx-velocity-own', '--mjs-fx-velocity-own-y', '--mjs-fx-velocity-filter'];
  // les morceaux d'une valeur calculée (`10px 0px`, `calc(10% + 5px) 3px`) : séparés par les blancs hors parenthèses
  var PARTS  = /(?:[^\s(]|\([^)]*\))+/g;
  var num    = function(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  var range  = function(v, a, b) { return v < a ? a : v > b ? b : v; };

  // ---- l'état de la page : une seule boucle pour toutes les balises ----
  var tags    = [];
  var live    = [];
  var sources = [];
  var roots   = [];
  var byEl    = new Map();
  var ro      = null;
  var raf     = 0;
  var last    = 0;
  var count   = 0;
  var onScroll;

  // la position d'un défilement suivi (la page ou un conteneur) : lue à l'événement de défilement (`cx`, `cy`), pas dans l'image d'animation
  var readX = function(n) { return n === window ? window.scrollX || 0 : n.scrollLeft; };
  var readY = function(n) { return n === window ? window.scrollY || 0 : n.scrollTop; };
  // l'étendue visible d'un défilement (un écran de la page, la boîte d'un conteneur), lue avec sa position
  var spanX = function(n) { return n === window ? innerWidth || 0 : n.clientWidth; };
  var spanY = function(n) { return n === window ? innerHeight || 0 : n.clientHeight; };
  var take = function(node) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].node !== node) continue;
      sources[i].uses++;
      return sources[i];
    }
    var px = readX(node);
    var py = readY(node);
    var sr = { node: node, x: px, y: py, cx: px, cy: py, dx: 0, dy: 0, w: spanX(node), h: spanY(node), uses: 1 };
    sources.push(sr);
    return sr;
  };
  var drop = function(sr) {
    if (--sr.uses > 0) return;
    sources.splice(sources.indexOf(sr), 1);
  };
  // l'écouteur d'une racine (le document, un shadow root) : un défilement ne sort pas d'un shadow root
  var takeRoot = function(root) {
    for (var i = 0; i < roots.length; i++) {
      if (roots[i].root !== root) continue;
      roots[i].uses++;
      return roots[i];
    }
    var r = { root: root, uses: 1 };
    roots.push(r);
    µ._mjs_dom.addEventListener(root, 'scroll', onScroll, { capture: true, passive: true });
    return r;
  };
  var dropRoot = function(r) {
    if (--r.uses > 0) return;
    roots.splice(roots.indexOf(r), 1);
    µ._mjs_dom.removeEventListener(r.root, 'scroll', onScroll, { capture: true });
  };
  // ce qui défile autour de la balise : chaque ancêtre qui rogne ou défile, puis la page
  var scrollersOf = function(el) {
    var list = [];
    if (typeof getComputedStyle === 'function') {
      for (var n = µ._mjs_fxParent(el); n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = µ._mjs_fxParent(n)) {
        var cs = getComputedStyle(n);
        if (!/^(visible|clip)$/.test(cs.overflowY || 'visible') || !/^(visible|clip)$/.test(cs.overflowX || 'visible')) list.push(n);
      }
    }
    list.push(window);
    return list;
  };

  // ---- les réglages ----
  var fix = function(k, v) {
    if (k === 'style') return STYLES.indexOf(v) >= 0 ? v : 'skew';
    if (k === 'axis') return v === 'x' ? 'x' : 'y';
    if (k === 'strength') return range(num(v, 2), 0, 5);
    if (k === 'max') return range(num(v, 12), 0, 90);
    return range(num(v, 0.15), 0.01, 1);
  };

  // ---- ce que l'effet écrit sur la balise ----
  // l'attribut style que l'effet a fait naître (la balise n'en avait pas) et qu'il a vidé repart avec lui
  var tidy = function(rec) {
    if (!rec.styled && µ._mjs_dom.getAttribute(rec.el, 'style') === '') µ._mjs_dom.removeAttribute(rec.el, 'style');
  };
  var wipe = function(rec) {
    for (var i = 0; i < VARS.length; i++) rec.el.style.removeProperty(VARS[i]);
    tidy(rec);
  };

  // ---- bend : le filtre SVG de la balise ----
  // la carte de déplacement, dessinée une fois : le long de l'axe de défilement, un profil en cloche (sin²) ;
  // en travers, une rampe de 0 à 1 qui dit de combien déplacer (0.5 = rien). Rouge pour y, vert pour x ; le
  // gris neutre dessous, la rampe dessus avec la cloche en masque : au milieu la rampe entière, aux bords rien
  var mapUrl = function(axis) {
    var bell = '';
    for (var i = 0; i <= BELL; i++) {
      var g = Math.round(255 * Math.pow(Math.sin(Math.PI * i / BELL), 2));
      bell += '<stop offset="' + (i / BELL) + '" stop-color="rgb(' + g + ',' + g + ',' + g + ')"/>';
    }
    var x   = axis === 'x';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 1 1" preserveAspectRatio="none"><defs>'
      + '<linearGradient id="r" x1="0" y1="0" x2="' + (x ? 0 : 1) + '" y2="' + (x ? 1 : 0) + '"><stop offset="0" stop-color="' + (x ? 'rgb(128,0,128)' : 'rgb(0,128,128)') + '"/><stop offset="1" stop-color="' + (x ? 'rgb(128,255,128)' : 'rgb(255,128,128)') + '"/></linearGradient>'
      + '<linearGradient id="b" x1="0" y1="0" x2="' + (x ? 1 : 0) + '" y2="' + (x ? 0 : 1) + '">' + bell + '</linearGradient>'
      + '<mask id="m"><rect width="1" height="1" fill="url(#b)"/></mask></defs>'
      + '<rect width="1" height="1" fill="rgb(128,128,128)"/><rect width="1" height="1" fill="url(#r)" mask="url(#m)"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  };
  var bendMake = function(rec) {
    var el   = rec.el;
    var id   = 'mjs-fx-velocity-' + (++count);
    var root = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
    var at   = root && root.nodeType === 11 ? root : document.body;
    var make = function(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };
    var svg = make('svg', { 'aria-hidden': 'true', width: '0', height: '0', 'mjs-fx-velocity-svg': '' });
    svg.style.position = 'absolute';
    // la région du filtre et celle de la carte sont les mêmes, en fractions de la boîte (une balise à
    // soi : Safari lit les px depuis le coin de la page) : la carte couvre aussi la marge où la balise se bombe
    var f   = make('filter', { id: id, 'color-interpolation-filters': 'sRGB', filterUnits: 'objectBoundingBox', primitiveUnits: 'objectBoundingBox', x: '-0.1', y: '-0.1', width: '1.2', height: '1.2' });
    var img = make('feImage', { href: mapUrl(rec.cfg.axis), x: '-0.1', y: '-0.1', width: '1.2', height: '1.2', preserveAspectRatio: 'none', result: 'mjs-fx-velocity-map' });
    var map = make('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'mjs-fx-velocity-map', xChannelSelector: 'R', yChannelSelector: 'G', scale: '0' });
    f.appendChild(img);
    f.appendChild(map);
    svg.appendChild(f);
    at.appendChild(svg);
    rec.bend = { svg: svg, img: img, map: map, axis: rec.cfg.axis, id: id };
    // la taille de la boîte, lue ici et à chaque redimensionnement : elle convertit des px en fractions de la boîte
    if (typeof ResizeObserver === 'function') {
      if (!ro) {
        ro = new ResizeObserver(function(entries) {
          for (var i = 0; i < entries.length; i++) {
            var r = byEl.get(entries[i].target);
            if (!r) continue;
            var bs = entries[i].borderBoxSize && entries[i].borderBoxSize[0];
            r.w = bs ? bs.inlineSize : entries[i].contentRect.width;
            r.h = bs ? bs.blockSize : entries[i].contentRect.height;
            if (r.v !== 0 && r.eff === 'bend') bendScale(r, r.v);
          }
        });
      }
      ro.observe(el);
    }
  };
  var bendOff = function(rec) {
    if (!rec.bend) return;
    if (ro) ro.unobserve(rec.el);
    rec.bend.svg.remove();
    rec.bend = null;
  };
  // la carte donne un déplacement de -scale/2 à +scale/2 en travers : pour que le bord du milieu sorte de
  // `max` px, la magnification 1 / (1 - k) du milieu, k = 1.2 × (2 × max / longueur) / (1 + 2 × max / longueur)
  // (la carte est 1.2 fois plus large que la boîte) ; le signe de la vitesse bombe ou creuse
  var bendScale = function(rec, v) {
    var len = rec.cfg.axis === 'x' ? rec.h : rec.w;
    var q   = 2 * rec.cfg.max * Math.abs(v) / (len > 0 ? len : 400);
    var a   = 1.2 * q / (1 + q);
    rec.bend.map.setAttribute('scale', (v > 0 ? -a : a).toFixed(4));
  };

  // ---- la balise ----
  // son style en vigueur : bend retombe sur skew en effets économes
  var apply = function(rec) {
    var el  = rec.el;
    var eff = rec.cfg.style === 'bend' && µ._mjs_fxLite ? 'skew' : rec.cfg.style;
    var cur = rec.eff === eff && (!rec.bend || rec.bend.axis === rec.cfg.axis) && µ._mjs_dom.getAttribute(el, 'mjs-fx-velocity-axis') === rec.cfg.axis;
    if (cur) return;
    // une déformation en cours sous l'ancien style : elle est rendue
    if (rec.v !== 0) paint(rec, 0);
    rec.sm    = 0;
    rec.fresh = false;
    if (rec.bend && (eff !== 'bend' || rec.bend.axis !== rec.cfg.axis)) bendOff(rec);
    rec.eff = eff;
    µ._mjs_dom.setAttribute(el, 'mjs-fx-velocity-style', eff);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-velocity-axis', rec.cfg.axis);
    if (eff === 'bend' && !rec.bend) bendMake(rec);
  };
  // ce que l'auteur a posé sur la balise (sa feuille, son style en ligne) pour la propriété que le style écrit : lu ici, une
  // fois, au premier défilement qui la concerne après un arrêt (`fresh`), avant toute écriture du tracé, jamais à chaque image
  // (le tracé ne le relit que si le défilement ne l'a pas fait : une balise qui vient d'arriver à l'écran). transform et filter :
  // la liste entière ; scale et translate : x puis y (une seule valeur de scale vaut pour x et y, de translate pour x seul)
  var read = function(rec) {
    var v = typeof getComputedStyle === 'function' ? getComputedStyle(rec.el)[PROP[rec.eff]] : '';
    var p = v && v !== 'none' ? v.match(PARTS) : null;
    rec.own   = !p ? [] : rec.eff === 'stretch' ? [p[0], p[1] || p[0]] : rec.eff === 'shift' ? [p[0], p[1] || '0px'] : [v];
    rec.fresh = true;
  };
  // la vitesse bornée écrite (0 : à plat, les variables, la marque et l'attribut style qu'on a fait naître s'en vont) ;
  // bend écrit l'attribut `scale` de son filtre ; au premier tracé d'un mouvement, ce que l'auteur avait posé (lu avant) est
  // repris dans des variables, et bend pose son filtre : le CSS de la déformation s'y ajoute (`initial` : rien, sans hériter d'un parent)
  var paint = function(rec, v) {
    var was = rec.v !== 0;
    var el  = rec.el;
    rec.v = v;
    if (v === 0) {
      if (!was) return;
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-velocity-on');
      wipe(rec);
      return;
    }
    if (!was) {
      el.style.setProperty('--mjs-fx-velocity-own', rec.own[0] || 'initial');
      if (rec.eff === 'stretch' || rec.eff === 'shift') el.style.setProperty('--mjs-fx-velocity-own-y', rec.own[1] || 'initial');
      if (rec.eff === 'bend') el.style.setProperty('--mjs-fx-velocity-filter', 'url(#' + rec.bend.id + ')');
    }
    if (rec.eff === 'bend') bendScale(rec, v);
    else el.style.setProperty('--mjs-fx-velocity-v', String(v));
    if (!was) µ._mjs_dom.setAttribute(el, 'mjs-fx-velocity-on', '');
  };
  // la balise entre à l'écran : elle suit les défilements qui la portent ; sort : elle est rendue à plat et ne suit plus rien
  var show = function(rec) {
    if (rec.live) return;
    rec.live  = true;
    rec.sm    = 0;
    rec.fresh = false;
    // bend convertit `max` en fraction de la boîte : la valeur que la feuille donne (un thème) est lue ici, hors de la boucle
    if (rec.eff === 'bend') {
      var m = parseFloat(µ._mjs_fxCss(rec.el, '--mjs-velocity-max'));
      if (isFinite(m)) rec.cfg.max = range(m, 0, 90);
    }
    rec.src   = scrollersOf(rec.el).map(take);
    rec.roots = µ._mjs_fxRoots(rec.el).map(takeRoot);
    live.push(rec);
  };
  var hide = function(rec) {
    if (!rec.live) return;
    rec.live = false;
    paint(rec, 0);
    rec.sm = 0;
    rec.src.forEach(drop);
    rec.roots.forEach(dropRoot);
    rec.src   = [];
    rec.roots = [];
    live.splice(live.indexOf(rec), 1);
  };

  // la boucle : le déplacement de chaque défilement suivi depuis l'image d'avant (positions lues à l'événement), puis chaque
  // balise à l'écran ; elle s'arrête quand plus rien ne défile et que tout est revenu à plat
  var tick = function(now) {
    raf = 0;
    var dt = last ? range(now - last, 1, 100) : 16.7;
    var i;
    var j;
    for (i = 0; i < sources.length; i++) {
      var sr = sources[i];
      sr.dx = sr.cx - sr.x;
      sr.dy = sr.cy - sr.y;
      // un saut, pas une vitesse : plus d'un écran du défilement en une image, ou plus d'un demi-écran d'un coup au repos (rien
      // n'avait bougé à l'image d'avant : Page suivante sans défilement doux)
      if (sr.w > 0 && Math.abs(sr.dx) > (sr.mx ? sr.w : sr.w / 2)) sr.dx = 0;
      if (sr.h > 0 && Math.abs(sr.dy) > (sr.my ? sr.h : sr.h / 2)) sr.dy = 0;
      sr.mx = sr.dx !== 0;
      sr.my = sr.dy !== 0;
      sr.x  = sr.cx;
      sr.y  = sr.cy;
    }
    var busy = false;
    for (i = 0; i < live.length; i++) {
      var rec = live[i];
      var raw = 0;
      for (j = 0; j < rec.src.length; j++) raw += rec.cfg.axis === 'x' ? rec.src[j].dx : rec.src[j].dy;
      raw /= dt;
      rec.sm += (raw - rec.sm) * (1 - Math.pow(1 - rec.cfg.smooth, dt / 16.7));
      var v = Math.round(range(rec.sm * rec.cfg.strength / VREF, -1, 1) * 1000) / 1000;
      if (Math.abs(v) < FLAT) {
        v = 0;
        if (raw === 0) rec.sm = 0;
      }
      rec.next = v;
      if (v !== 0 || raw !== 0) busy = true;
    }
    // le style de l'auteur, lu à l'événement de défilement, ne l'est ici que pour une balise arrivée depuis ; puis toutes les écritures
    for (i = 0; i < live.length; i++) {
      if (live[i].next !== 0 && live[i].v === 0 && !live[i].fresh) read(live[i]);
    }
    for (i = 0; i < live.length; i++) {
      if (live[i].next !== live[i].v) paint(live[i], live[i].next);
    }
    if (busy) {
      last = now;
      raf  = requestAnimationFrame(tick);
    }
    else {
      last = 0;
      for (i = 0; i < live.length; i++) live[i].fresh = false;
    }
  };
  var wake = function() {
    if (raf || live.length === 0 || typeof requestAnimationFrame !== 'function') return;
    // les effets économes ont pu s'enclencher depuis : bend retombe sur skew
    if (µ._mjs_fxLite) {
      for (var i = 0; i < tags.length; i++) {
        if (tags[i].eff === 'bend') apply(tags[i]);
      }
    }
    raf = requestAnimationFrame(tick);
  };
  // un défilement qui compte : celui d'un défilement suivi (la page, ou un conteneur autour d'une balise à l'écran). Ses positions se
  // lisent ici, avec le style de l'auteur des balises qu'il porte et qui n'ont pas encore été lues : l'image d'animation n'a plus qu'à calculer
  onScroll = function(e) {
    var t    = e && e.target;
    var node = t === document ? window : t;
    for (var i = 0; i < sources.length; i++) {
      var sr = sources[i];
      if (sr.node !== node) continue;
      sr.cx = readX(node);
      sr.cy = readY(node);
      sr.w  = spanX(node);
      sr.h  = spanY(node);
      for (var j = 0; j < live.length; j++) {
        if (!live[j].fresh && live[j].src.indexOf(sr) >= 0) read(live[j]);
      }
      return wake();
    }
  };

  // le CSS de la déformation s'AJOUTE au style de l'auteur (repris dans `--mjs-fx-velocity-own`, `-own-y`) et passe devant lui, même
  // écrit en ligne (!important) ; le filtre de bend tient dans `--mjs-fx-velocity-filter`, posé le temps de la déformation
  µ._mjs_fxDefs.velocity = {
    css: '[mjs-fx~="velocity"][mjs-fx-velocity-on]{will-change:transform}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="skew"][mjs-fx-velocity-on]{transform:var(--mjs-fx-velocity-own,) skewY(calc(var(--mjs-fx-velocity-v,0) * var(--mjs-velocity-max,12) * 1deg))!important}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="skew"][mjs-fx-velocity-axis="x"][mjs-fx-velocity-on]{transform:var(--mjs-fx-velocity-own,) skewX(calc(var(--mjs-fx-velocity-v,0) * var(--mjs-velocity-max,12) * 1deg))!important}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="stretch"][mjs-fx-velocity-on]{scale:var(--mjs-fx-velocity-own,1) calc(var(--mjs-fx-velocity-own-y,1) * (1 + max(var(--mjs-fx-velocity-v,0),-1 * var(--mjs-fx-velocity-v,0)) * var(--mjs-velocity-max,12) / 100))!important;will-change:scale}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="stretch"][mjs-fx-velocity-axis="x"][mjs-fx-velocity-on]{scale:calc(var(--mjs-fx-velocity-own,1) * (1 + max(var(--mjs-fx-velocity-v,0),-1 * var(--mjs-fx-velocity-v,0)) * var(--mjs-velocity-max,12) / 100)) var(--mjs-fx-velocity-own-y,1)!important}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="tilt"][mjs-fx-velocity-on]{transform:var(--mjs-fx-velocity-own,) perspective(900px) rotateX(calc(var(--mjs-fx-velocity-v,0) * var(--mjs-velocity-max,12) * 1deg))!important}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="tilt"][mjs-fx-velocity-axis="x"][mjs-fx-velocity-on]{transform:var(--mjs-fx-velocity-own,) perspective(900px) rotateY(calc(var(--mjs-fx-velocity-v,0) * var(--mjs-velocity-max,12) * -1deg))!important}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="blur"][mjs-fx-velocity-on]{filter:var(--mjs-fx-velocity-own,) blur(calc(max(var(--mjs-fx-velocity-v,0),-1 * var(--mjs-fx-velocity-v,0)) * var(--mjs-velocity-max,12) * 1px))!important;will-change:filter}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="shift"][mjs-fx-velocity-on]{translate:var(--mjs-fx-velocity-own,0px) calc(var(--mjs-fx-velocity-own-y,0px) + var(--mjs-fx-velocity-v,0) * var(--mjs-velocity-max,12) * 1px)!important;will-change:translate}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="shift"][mjs-fx-velocity-axis="x"][mjs-fx-velocity-on]{translate:calc(var(--mjs-fx-velocity-own,0px) + var(--mjs-fx-velocity-v,0) * var(--mjs-velocity-max,12) * 1px) var(--mjs-fx-velocity-own-y,0px)!important}'
      + '[mjs-fx~="velocity"][mjs-fx-velocity-style="bend"][mjs-fx-velocity-on]{filter:var(--mjs-fx-velocity-own,) var(--mjs-fx-velocity-filter,)!important;will-change:filter}'
      + '@media (prefers-reduced-motion:reduce){[mjs-fx~="velocity"][mjs-fx-velocity-style][mjs-fx-velocity-axis][mjs-fx-velocity-on]{transform:none!important;scale:none!important;translate:none!important;filter:none!important;will-change:auto!important}}',
    vars: { max: '' },
    setup: function(el, s) {
      // la vitesse bornée d'une balise, enregistrée NON héritée : l'écrire ne recalcule que sa balise
      µ._mjs_fxRegister('--mjs-fx-velocity-v', '<number>', '0');
      // « réduire les animations » : rien ne bouge, aucune balise suivie, aucun écouteur
      if (µ._mjs_fxCalm()) {
        var calm = function() {};
        calm.set = function() {};
        return calm;
      }
      // l'attribut style de la balise avant que l'effet n'y écrive quoi que ce soit (même l'affichage de µ._mjs_fxMovable)
      var styled = µ._mjs_dom.hasAttribute(el, 'style');
      // une balise en ligne (span, lien) ne se transforme pas : inline-block le temps de l'effet
      var inline = µ._mjs_fxMovable(el);
      var rec = { el: el, cfg: { style: fix('style', s.style), strength: fix('strength', s.strength), max: fix('max', s.max), smooth: fix('smooth', s.smooth), axis: fix('axis', s.axis) }, eff: null, sm: 0, v: 0, next: 0, own: [], styled: styled, live: false, fresh: false, src: [], roots: [], bend: null, w: 0, h: 0 };
      tags.push(rec);
      byEl.set(el, rec);
      apply(rec);
      // la taille de la boîte pour un bend posé d'emblée : relue à la première observation
      var seeing = µ._mjs_fxVisible(el, '100px', function() { show(rec); }, function() { hide(rec); });
      var off = function() {
        hide(rec);
        seeing();
        bendOff(rec);
        tags.splice(tags.indexOf(rec), 1);
        byEl.delete(el);
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-velocity-style');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-velocity-axis');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-velocity-on');
        // l'affichage d'origine d'abord, puis les variables et l'attribut style vidé
        inline();
        wipe(rec);
        // la dernière balise partie : plus d'observateur, plus de boucle
        if (tags.length > 0) return;
        if (ro) ro.disconnect();
        ro = null;
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf  = 0;
        last = 0;
      };
      // tous les réglages se suivent sur place ; style et axis refont la tenue de la balise
      off.set = function(k, v) {
        if (k !== 'style' && k !== 'axis' && k !== 'strength' && k !== 'smooth' && k !== 'max') return false;
        rec.cfg[k] = fix(k, v);
        if (k === 'style' || k === 'axis') apply(rec);
        else if (k === 'max' && rec.v !== 0 && rec.eff === 'bend') bendScale(rec, rec.v);
      };
      return off;
    }
  };
})();
