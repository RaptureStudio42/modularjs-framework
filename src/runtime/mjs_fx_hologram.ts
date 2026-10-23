// mjs_fx_hologram — `*hologram` : un reflet irisé qui suit la souris, comme sur une carte à
// collectionner brillante. Un calque posé au-dessus du contenu (dans le composant si la balise en
// est un), qui ne capte pas les clics : le motif se fond avec ce qu'il y a dessous (mix-blend-mode).
//
// Deux familles de styles.
//
// Les styles simples — rainbow (arc-en-ciel), foil (feuille métallisée à fines rayures), galaxy (nuées
// et points brillants), prism (facettes), gold (reflet doré) — sont un motif et un éclat blanc sous la
// souris. Leurs réglages : colors (sa propre palette), strength (l'intensité, de 0 à 1 ; 0.7), size (la
// taille du motif en % de la balise ; 200), angle (l'inclinaison des bandes ; 110), blend (le mode de
// fusion ; color-dodge), speed (la dérive du reflet quand la souris n'est pas là, un tour en ; 7s —
// 0 : il reste au centre), on (always : le reflet est là et dérive tout seul ; hover : visible au
// survol seulement ; view : le reflet est là mais ne dérive que tant que la balise est à l'écran ;
// load : comme always ; always).
//
// Les styles de carte sont les finitions des cartes à collectionner : sheen (un simple éclat), frame
// (tout brille sauf l'illustration), curtain (des filets verticaux dans l'illustration), night-sky (un ciel
// étoilé), frost et lattice (paillettes, croisillons), opal (une nacre de plages pastel), streaks, rays,
// rays-window, rays-cloud, rays-fade, rays-wide (des rayons en diagonale qui se croisent, sur un motif gravé
// ou non), haze et haze-deep (un voile de couleur), dust et dust-dark (des grains de couleur), glint et
// glint-dark (or), bloom (fond argenté). Le reflet et l'éclat suivent la souris, portés par un ressort, et
// tout revient en place quand la souris part ; la carte ne penche jamais d'elle-même (c'est le rôle de
// `*tilt`, qui se pose sur la même balise : le reflet de *hologram et la pente de *tilt se cumulent). Leurs
// réglages : image (le motif gravé de la carte : une adresse, µasset, µimage ; sans elle, le style répète son
// propre motif, celui du thème), mask (l'image qui dit où le motif brille ; sans elle : partout, ou selon la
// fenêtre), zone (la fenêtre de l'illustration : une forme CSS de `clip-path`, écrite telle quelle — `inset(10% 8% 53% 8%)`
// pour un rectangle, `polygon(…)` pour un coin coupé, `circle(…)`, `ellipse(…)`, `path(…)` ; curtain, night-sky et
// rays-window ne brillent que dedans, frame que dehors — un `inset(…)` ou un `polygon(…)` lui suffit, il n'a pas de contraire
// pour les autres formes ; sans elle : toute la carte), shine (l'éclat sous la souris : bright, calm ou shade ;
// opal connaît bright, le défaut, et calm, plus sombre ; rays connaît bright, le défaut, calm, gris acier
// sans halo, et shade, qui assombrit les bords ; un autre style, ou une valeur qu'il ne connaît pas, garde son
// éclat), glow (la couleur de la lueur ; hsl(175, 100%, 90%)), brightness (frame : l'éclat du motif ; 0.55),
// zoom (un clic amène la carte au milieu de l'écran, agrandie ; un second clic, Échap ou un clic ailleurs la renvoie ;
// true : la carte vient sans tourner ; spin : la carte fait un tour complet autour de son axe vertical en venant, son dos se
// voit à mi-course, et elle fait le tour dans l'autre sens en repartant ; non), back (l'image du dos de la carte, vue pendant
// le tour d'un zoom spin ; une adresse, µasset, µimage ; sans elle, un dos uni et sombre, de l'arrondi de la carte), shadow (l'ombre portée de la carte, et sa lueur quand
// elle est agrandie ; oui), seed (night-sky : la place du ciel étoilé, de 0 à 999 ; au hasard),
// strength (1), on (hover : le reflet n'existe qu'au survol — rien dans la page au repos ; always : il
// reste visible ; load, view : le reflet se promène seul une fois, quatre secondes, à l'apparition ou à
// l'arrivée à l'écran, puis attend la souris ; hover).
//
// Communs : glare (l'éclat sous la souris ; true), radius (en px, l'arrondi du calque ; celui de la
// balise). « Réduire les animations » : plus de dérive, de ressort ni d'inclinaison — le reflet ne
// suit plus que la souris.
//
// Les motifs des styles de carte : onze images, que le THÈME peut remplacer une à une par une variable posée sur la balise ou
// sur un ancêtre : `--mjs-hologram-pattern-<nom>: url(…)` — sparkles (des paillettes), grain, sky-far, sky-mid et sky-near
// (les trois plans du ciel de cosmos), ripples et ripples-mask (des anneaux), waves (des vagues), discs (des disques à
// sillons), maze (des bandes à coudes), weave (un dallage de bandes). Le build livre ces images (en production, celles des styles écrits ; en développement, les onze),
// et la feuille les prend quand le thème n'en donne pas ; l'effet n'en dessine aucune. Un motif sans image est simplement absent, et le reste du style (les dégradés, les éclats) tient. La feuille lit
// la variable elle-même : l'effet ne la lit jamais.
//
// Rendu des styles de carte : au repos la balise ne porte ni calque ni transformation ; le calque
// (trois balises) naît au premier survol et repart quand le ressort s'est posé. Une seule boucle,
// qui s'arrête d'elle-même ; par image, quatre variables sur le calque (deux de plus pendant la
// démonstration) et quatre sur la balise (le tour, la taille, le déplacement) — et seulement pendant un zoom ; le dos de la carte,
// un calque de plus, n'existe que le temps d'un tour (zoom spin). Une carte agrandie garde le premier plan (`mjs-fx-hologram-up`) jusqu'à la
// dernière image du ressort. Pendant le vol — le ressort de la carte écrit sa transformation à chaque image, à l'aller comme au retour — la balise
// porte `mjs-fx-hologram-fly`, qui coupe ses transitions, d'où qu'elles viennent (la pente d'*tilt, une règle de l'auteur) : relancée à chaque
// écriture, une transition de `transform` retarderait la carte derrière le ressort, et un voisin la recouvrirait en chemin ; seule la lueur de
// la carte garde la sienne. Hors du vol, les transitions de la balise sont les siennes. Si l'auteur a
// donné une transformation à la balise (`rotate(8deg)`), elle est lue une fois quand le mouvement
// commence, composée avec celle de l'effet pendant tout le mouvement, et rendue telle quelle à la fin.
// Limite : la carte agrandie garde sa place dans le document (elle y est déplacée et grossie, pas sortie
// de son parent) ; un ancêtre qui rogne (`overflow` autre que visible) la rogne donc aussi.
//
// Pour le build : les styles de carte et le moteur de carte sont des SECTIONS MARQUÉES — une ligne `// @@ <noms>` jusqu'à la
// ligne `// @@` suivante (ou `// @@ <noms>` en fin de ligne, pour cette ligne seule) ; <noms> : des styles de carte (la section
// sert à l'un d'eux au moins) ou `cards` (à une carte au moins : la feuille, le moteur). Le build n'embarque que les sections
// des styles écrits dans les pages de l'appli (tous si un style vient d'une variable, aucun si seul un style simple est écrit —
// src/bundler/hologram-styles.ts) ; tel quel, ce fichier porte tout.

var _MJS_FX_HOLO_PALS = {
  rainbow: ['#ff3d81', '#ffb13d', '#f3ff3d', '#3dffa0', '#3dc8ff', '#a03dff'],
  foil: ['#ff6ec7', '#ffd86e', '#6effc1', '#6ec9ff', '#b36eff'],
  galaxy: ['#7a5cff', '#00d4ff', '#ff2fb3'],
  prism: ['#ff5fa2', '#ffe066', '#5ff2b8', '#5fb4ff', '#b085ff'],
  gold: ['#8a6914', '#ffd700', '#fff6b8', '#ffd700', '#8a6914']
};

// la place du reflet (0..1 dans la balise) et la taille du motif, écrites une fois pour toutes
var _mjsFxHoloX  = 'calc(var(--mjs-fx-hologram-x,.5) * 100%)';
var _mjsFxHoloY  = 'calc(var(--mjs-fx-hologram-y,.5) * 100%)';
var _mjsFxHoloXi = 'calc((1 - var(--mjs-fx-hologram-x,.5)) * 100%)';
var _mjsFxHoloYi = 'calc((1 - var(--mjs-fx-hologram-y,.5)) * 100%)';
var _mjsFxHoloSz = 'var(--mjs-hologram-size,200%) var(--mjs-hologram-size,200%)';
var _mjsFxHoloAn = 'var(--mjs-hologram-angle,110deg)';
var _mjsFxHoloPal = 'var(--mjs-fx-hologram-pal)';
var _mjsFxHoloStar = function(r, x, y) { return 'radial-gradient(' + r + 'px ' + r + 'px at ' + x + '% ' + y + '%,#fff,transparent)'; };

// ----- les styles de carte -----
// @@ cards
// les styles de carte que la feuille connaît (ceux de la feuille embarquée par le build)
var _MJS_FX_HOLO_CARDS = {};
// les images des motifs que le build livre (nom du motif -> adresse) ; vide tel quel : sans image livrée, un motif absent
var _MJS_FX_HOLO_IMAGES = {};
// @@

// @@ cards
// la feuille des styles de carte. Chaque style est fait de cinq boîtes au plus — i : le reflet, ses
// deux pseudo-éléments, b : l'éclat, le sien — et chaque boîte de quelques briques : des bandes de
// couleur, des barres sombres, une lumière sous la souris, un motif. Une boîte s'écrit
// { g: ses couches, m: leur fusion entre elles, s: leurs tailles, p: leurs places, f: son filtre,
//   x: sa fusion avec la carte, o: son opacité, c: sa découpe, k: son masque (0 : aucun), z: son rang }
var _mjsFxHoloSheet = function() {
  var N    = '--mjs-fx-hologram-';
  var q    = function(k) { return 'var(' + N + k + ')'; };
  // la souris : en % de la carte (X, Y), de 0 à 1 (FX, FY) ; sa distance au centre (C) ; la présence du
  // reflet (O) ; le glissement du fond, plus court que celui de la souris (BX, BY)
  var X    = q('px');
  var Y    = q('py');
  var FX   = q('x');
  var FY   = q('y');
  var C    = q('c');
  var O    = q('o');
  var BX   = q('bx');
  var BY   = q('by');
  var FOIL = q('foil');
  var MASK = q('mask');
  // un motif du style : l'image que le thème donne (--mjs-hologram-pattern-<nom>), à défaut celle que le build livre, à défaut
  // aucune (la couche reste vide) ; `pat` : un motif que l'image de la carte remplace quand elle en a une
  var tex  = function(n) { return 'var(--mjs-hologram-pattern-' + n + ',' + (_MJS_FX_HOLO_IMAGES[n] ? _mjsFxHoloUrl(_MJS_FX_HOLO_IMAGES[n]) : 'none') + ')'; };
  var pat  = function(n) { return 'var(' + N + 'foil,' + tex(n) + ')'; };
  var GLIT = tex('sparkles'); // @@ frost lattice haze dust-dark glint haze-deep glint-dark dust bloom

  // les palettes
  var SUN   = ['hsl(2,100%,73%)', 'hsl(53,100%,69%)', 'hsl(93,100%,69%)', 'hsl(176,100%,76%)', 'hsl(228,100%,74%)', 'hsl(283,100%,73%)']; // @@ frost streaks rays rays-cloud rays-wide rays-fade glint glint-dark rays-window bloom
  var DEEP  = ['hsl(0,57%,37%)', 'hsl(40,53%,39%)', 'hsl(90,60%,35%)', 'hsl(180,60%,35%)', 'hsl(180,60%,35%)', 'hsl(210,57%,39%)', 'hsl(280,55%,31%)']; // @@ haze dust-dark haze-deep dust bloom
  var NIGHT = ['hsl(53,65%,60%)', 'hsl(93,56%,50%)', 'hsl(176,54%,49%)', 'hsl(228,59%,55%)', 'hsl(283,60%,55%)', 'hsl(326,59%,51%)']; // @@ night-sky
  var PEARL = ['hsl(3,95%,85%)', 'hsl(207,100%,84%)', 'hsl(29,100%,85%)', 'hsl(160,100%,86%)', 'hsl(309,94%,87%)', 'hsl(188,95%,85%)']; // @@ lattice
  var VIVID = ['hsl(2,70%,47%)', 'hsl(228,60%,64%)', 'hsl(176,55%,39%)', 'hsl(123,68%,35%)', 'hsl(283,75%,57%)']; // @@ rays-wide
  var FIVE  = ['#c929f1', '#0dbde9', '#21e985', '#eedf10', '#f80e35']; // @@ curtain
  var SOFT  = function(second) { return ['hsla(283,49%,60%,.75)', second, 'hsla(53,67%,53%,.75)', 'hsla(93,56%,52%,.75)', 'hsla(176,38%,50%,.75)', 'hsla(228,100%,77%,.75)', 'hsla(283,49%,61%,.75)']; }; // @@ opal dust-dark dust
  var GOLD  = 'linear-gradient(45deg,hsl(46,95%,50%),hsl(52,100%,69%))'; // @@ glint glint-dark
  var rot   = function(a, k) { return a.slice(k).concat(a.slice(0, k)); }; // @@ frost streaks rays rays-cloud rays-wide rays-fade glint-dark rays-window bloom

  // les briques
  // @@ night-sky frost lattice opal streaks rays rays-cloud rays-wide rays-fade dust-dark dust rays-window bloom
  // des bandes qui se répètent, chacune un pas plus loin ; refermées sur la première couleur, ou non
  var bands = function(angle, step, colors, unit, open) {
    var s = [];
    var n = colors.length + (open ? 0 : 1);
    for (var i = 0; i < n; i++) s.push(colors[i % colors.length] + ' ' + +(step * (i + 1)).toFixed(3) + (unit || '%'));
    return 'repeating-linear-gradient(' + angle + 'deg,' + s.join(',') + ')';
  };
  // @@
  // @@ haze dust-dark haze-deep dust bloom
  // un long dégradé qui parcourt trois fois la palette
  var sweep = function(angle) { return 'linear-gradient(' + angle + 'deg,' + DEEP.concat(DEEP, DEEP, [DEEP[0]]).join(',') + ')'; };
  // @@
  // @@ streaks rays rays-cloud rays-wide rays-fade rays-window
  // des barres sombres en diagonale, un filet clair au milieu
  var BARS  = 'repeating-linear-gradient(133deg,#0e152e 0%,hsl(180,10%,60%) 3.8%,hsl(180,29%,66%) 4.5%,hsl(180,10%,60%) 5.2%,#0e152e 10%,#0e152e 12%)';
  // @@
  // la lumière sous la souris : des arrêts de couleur autour du point ; `mid` : un ovale, à mi-chemin du centre
  var spot  = function(stops, shape) { return 'radial-gradient(' + (shape || 'farthest-corner circle') + ' at ' + X + ' ' + Y + ',' + stops + ')'; };
  var mid   = function(stops) { return 'radial-gradient(farthest-corner ellipse at calc(' + X + ' * .5 + 25%) calc(' + Y + ' * .5 + 25%),' + stops + ')'; }; // @@ lattice opal
  var SHADE = spot('hsla(0,0%,0%,.1) 12%,hsla(0,0%,0%,.15) 20%,hsla(0,0%,0%,.25) 120%'); // @@ streaks rays rays-cloud rays-fade rays-window
  // @@ lattice
  // des marches de gris nettes, de largeur `w`
  var steps = function(angle, w, levels) {
    var s = ['hsl(0,0%,' + levels[0] + '%) 0%', 'hsl(0,0%,' + levels[0] + '%) 1%', 'hsl(0,0%,' + levels[0] + '%) ' + w + '%'];
    for (var i = 1; i < levels.length; i++) s.push('hsl(0,0%,' + levels[i] + '%) ' + +(w * i + 0.01).toFixed(3) + '%', 'hsl(0,0%,' + levels[i] + '%) ' + +(w * (i + 1)).toFixed(3) + '%');
    return 'repeating-linear-gradient(' + angle + 'deg,' + s.join(',') + ')';
  };
  // @@
  // @@ curtain
  // deux filets clairs sur fond noir, puis du noir jusqu'à `end`
  var twin  = function(end) { return 'repeating-linear-gradient(90deg,#000 6%,hsl(0,0%,70%) 9%,#000 10.5%,hsl(0,0%,70%) 12%,#000 15%,#000 ' + end + '%)'; };
  // @@
  var tone  = function(b, c, s) { return 'brightness(' + b + ') contrast(' + c + ')' + (s === void 0 ? '' : ' saturate(' + s + ')'); };
  // @@ opal rays rays-cloud rays-wide rays-fade haze dust-dark glint haze-deep glint-dark dust rays-window bloom
  // un éclat qui monte avec la distance de la souris au centre
  var lit   = function(k, base) { return 'calc(' + C + ' * ' + k + ' + ' + base + ')'; };
  // @@
  var CLIP  = q('clip'); // @@ frame curtain night-sky frost lattice rays-window
  var FRAME = 'inset(2.8% 4% round 2.55% / 1.5%)'; // @@ lattice opal
  var G     = '25% 25%'; // @@ frost haze dust-dark glint haze-deep glint-dark dust bloom
  var JIT   = function(sign) { return 'calc(50% - 2px * ' + FX + ' ' + sign + ' 1px) calc(50% - 2px * ' + FY + ' ' + sign + ' 1px)'; }; // @@ glint haze-deep glint-dark

  var L   = '[mjs-fx-hologram-card]';
  var css = L + '{' + N + 'px:calc(var(' + N + 'x,.5) * 100%);' + N + 'py:calc(var(' + N + 'y,.5) * 100%);' + N + 'bx:calc(37% + var(' + N + 'x,.5) * 26%);' + N + 'by:calc(33% + var(' + N + 'y,.5) * 34%);' + N + 'clip:none;' + N + 'inv:none}'
    // le pseudo-élément de l'éclat n'a pas d'arrondi (l'éclat le rogne) : arrondi, son masque serait échantillonné autrement
    + L + ' i,' + L + ' b{position:absolute;inset:0;border-radius:inherit;overflow:hidden}'
    + L + ' i::before,' + L + ' i::after{position:absolute;inset:0;border-radius:inherit;mask-image:' + MASK + ';mask-size:cover;mask-position:center}'
    + L + ' b::after{position:absolute;inset:0}'
    + L + ' i{background-size:cover;background-position:center;filter:' + tone(0.85, 2.75, 0.65) + ';mix-blend-mode:color-dodge;opacity:' + O + ';mask-image:' + MASK + ';mask-size:cover;mask-position:center}'
    + L + ' b{background-image:' + spot('hsla(0,0%,100%,.8) 10%,hsla(0,0%,100%,.65) 20%,hsla(0,0%,0%,.5) 90%') + ';mix-blend-mode:overlay;opacity:' + O + '}';

  var KEYS = [['g', 'background-image'], ['m', 'background-blend-mode'], ['s', 'background-size'], ['p', 'background-position'], ['f', 'filter'], ['x', 'mix-blend-mode'], ['o', 'opacity'], ['c', 'clip-path'], ['k', 'mask-image'], ['z', 'z-index']];
  var BOX  = { i: ' i', ib: ' i::before', ia: ' i::after', b: ' b', ba: ' b::after' };
  // un style (ou plusieurs qui partagent ces boîtes) ; `nu` : ce qui change quand la carte n'a ni image
  // gravée ni masque — ses découpes (c) valent dès qu'il n'y a pas de masque, le reste (le motif du style
  // à sa taille, ses dosages) dès qu'il n'y a pas d'image
  // `tag` : une valeur du réglage `shine` — les règles ne valent alors que pour cet éclat (le style sans éclat écrit prend la base)
  var style = function(names, def, nu, tag) {
    var list = names.split(' ');
    var emit = function(d, extra) {
      for (var box in d) {
        var sel = list.map(function(n) { return '[mjs-fx-hologram-style="' + n + '"]' + (tag ? '[mjs-fx-hologram-shine="' + tag + '"]' : '') + extra + BOX[box]; }).join(',');
        var v   = d[box];
        var o   = [];
        if (v === 0) o.push(box.length > 1 ? 'content:none' : 'display:none');
        else {
          if (box.length > 1) o.push('content:""');
          for (var i = 0; i < KEYS.length; i++) {
            var val = v[KEYS[i][0]];
            if (val === void 0) continue;
            o.push(KEYS[i][1] + ':' + (KEYS[i][0] === 'g' ? val.join(',') : val === 0 ? 'none' : val));
          }
          // l'éclat masqué : son masque à sa taille, posé au coin
          if (box === 'ba' && v.k) o.push('mask-size:cover');
        }
        css += sel + '{' + o.join(';') + '}';
      }
    };
    emit(def, '');
    if (nu) {
      var bare = {};
      var open = {};
      for (var bx in nu) {
        if (nu[bx] === 0) {
          bare[bx] = 0;
          continue;
        }
        for (var kk in nu[bx]) {
          var to = kk === 'c' ? open : bare;
          (to[bx] || (to[bx] = {}))[kk] = nu[bx][kk];
        }
      }
      emit(bare, '[mjs-fx-hologram-nu]');
      emit(open, '[mjs-fx-hologram-open]');
    }
    // les styles de carte que la feuille connaît : c'est d'après cette table que l'effet choisit son chemin
    for (var k = 0; k < list.length; k++) _MJS_FX_HOLO_CARDS[list[k]] = true;
  };

  // @@ sheen
  // basic : rien que l'éclat commun
  style('sheen', { i: 0 });
  // @@

  // @@ frame
  // reverse : le motif de la carte brille partout sauf dans l'illustration ; un second éclat dans la fenêtre
  style('frame', {
    i:  { g: [spot('#fff 5%,#000 50%,#fff 80%', 'circle'), 'linear-gradient(-45deg,#000 15%,#fff,#000 85%)', 'var(' + N + 'foil,none)'], m: 'soft-light,difference', s: '120% 120%,200% 200%,cover', p: 'center,calc(100% * ' + FX + ') calc(100% * ' + FY + '),center', f: 'brightness(var(--mjs-hologram-brightness,.55)) contrast(1.5) saturate(1)', o: 'calc(1.5 * ' + O + ' - ' + C + ')' },
    b:  { g: [spot('hsla(0,0%,100%,.8) 10%,hsla(0,0%,100%,.5) 20%,hsla(0,0%,0%,.75) 90%')], f: tone(0.7, 1.5) },
    ba: { g: [spot('hsl(0,0%,100%) 10%,hsla(0,0%,100%,.5) 20%,hsla(0,0%,0%,.5) 120%')], f: tone(1, 1.5), o: O, c: CLIP }
  }, { i: { c: q('inv') } });
  // @@

  // @@ curtain
  // holo : un arc-en-ciel tramé de fines lignes, deux jeux de filets qui glissent en sens contraires, dans la fenêtre
  var LINES = function(w) { return 'repeating-linear-gradient(90deg,black 0px,black ' + w * 2 + 'px,#666 ' + w * 2 + 'px,#666 ' + w * 4 + 'px)'; };
  var RAIN  = 'repeating-linear-gradient(110deg,' + FIVE.concat(FIVE, FIVE).join(',') + ')';
  style('curtain', {
    i:  { g: [RAIN, LINES(1)], m: 'overlay', s: '400% 400%,cover', p: 'calc((50% - ' + BX + ') * 2.6 + 50%) calc((50% - ' + BY + ') * 3.5 + 50%),center', f: tone(1.1, 1.1, 1.2), c: CLIP },
    ib: { g: [twin(42), twin(30)], m: 'screen', s: '200% 200%,200% 200%', p: 'calc((50% - ' + BX + ') * 1.65 + 50% + ' + BY + ' * .5) ' + BX + ',calc((50% - ' + BX + ') * -.9 + 50% - ' + BY + ' * .75) ' + BY, f: tone(1.15, 1.1), x: 'hard-light' },
    ia: { g: [spot('hsla(0,0%,90%,.8) 0%,hsla(0,0%,78%,.1) 25%,hsl(0,0%,0%) 90%')], s: 'cover', p: 'center', f: tone(0.6, 4), x: 'luminosity' },
    b:  { f: tone(0.8, 1.5), o: 'calc(' + O + ' * .8)' },
    ba: { g: [spot('hsl(180,100%,95%) 5%,hsla(0,0%,39%,.25) 55%,hsla(0,0%,0%,.36) 110%')], f: tone(0.6, 3), x: 'overlay', c: CLIP }
  });
  css += '@media screen and (max-width:900px){[mjs-fx-hologram-style="curtain"] i{background-image:' + RAIN + ',' + LINES(0.5) + '}}';
  // @@

  // @@ night-sky
  // cosmos : trois plans d'étoiles sous le même arc-en-ciel, qui glissent chacun à son allure, dans la fenêtre
  var SKY    = bands(82, 4, NIGHT.concat(NIGHT.slice().reverse()), '%', true);
  var PLACE  = 'var(' + N + 'cosmos,center center)';
  var cosmos = function(a, b) { return PLACE + ',calc(' + a + '% + ' + FX + ' * ' + b + '%) calc(' + a + '% + ' + FY + ' * ' + b + '%),center'; };
  style('night-sky', {
    i:  { g: [tex('sky-far'), SKY, spot('hsla(180,100%,89%,.5) 5%,hsla(180,14%,57%,.3) 40%,hsl(0,0%,0%) 130%')], m: 'color-burn,multiply', s: 'cover,400% 900%,cover', p: cosmos(10, 80), f: tone(1, 1, 0.8), c: CLIP },
    ib: { g: [tex('sky-mid'), SKY], m: 'lighten,multiply', s: 'cover,400% 900%', p: cosmos(15, 70), f: tone(1.25, 1.75, 0.8), x: 'overlay' },
    ia: { g: [tex('sky-near'), SKY], m: 'multiply,multiply', s: 'cover,400% 900%', p: cosmos(20, 60), f: tone(1.25, 1.75, 0.8), x: 'multiply' },
    b:  { g: [spot('hsla(204,100%,95%,.8) 5%,hsla(250,15%,20%,1) 150%')], f: tone(0.75, 2, 2), o: 'calc(' + O + ' * (.25 + ' + C + '))' },
    ba: { g: [spot('hsl(280,100%,96%) 5%,hsl(0,0%,10%) 60%')], f: tone(0.75, 2.5, 2), x: 'soft-light', o: 'calc(1 - ' + FY + ' * .75)', c: CLIP }
  });
  // @@

  var SLIDE = 'calc(50% + (50% - ' + BX + ') * 3) calc(50% + (50% - ' + BY + ') * 3)'; // @@ frost bloom
  var FADE  = 'brightness(calc(.75 - ' + C + ' * .5)) contrast(1) saturate(1)'; // @@ frost bloom
  // @@ frost
  // amazing : deux nappes de paillettes décalées, le motif de la carte qui s'allume, un arc-en-ciel qui ne garde que sa saturation
  style('frost', {
    i:  { g: [GLIT, GLIT, spot('hsla(150,20%,10%,1) 10%,hsla(177,22%,80%,.1) 50%,hsla(0,0%,95%,.98) 90%')], m: 'soft-light,color-burn', s: G + ',' + G + ',cover', p: '40% 45%,55% 55%,center', f: tone(1, 1, 0.9) },
    ib: { g: [FOIL, spot('hsla(50,20%,90%,.95) 10%,rgba(181,139,164,.5) 50%,hsl(0,0%,0%) 60%')], m: 'color-burn', s: 'cover,cover', p: 'center,center', f: tone(1, 1, 1), x: 'lighten', o: '.5', k: 0 },
    ia: { g: [bands(133, 5, rot(SUN, 5))], s: '400% 800%', p: SLIDE, f: FADE, x: 'saturation', k: 0 },
    b:  { g: [spot('hsla(50,20%,90%,.45) 0%,hsla(150,20%,30%,.45) 45%,hsla(0,0%,0%,.9) 120%')], f: tone(0.9, 2) },
    ba: { g: [spot('hsla(50,20%,90%,.75) 0%,hsla(150,20%,30%,.65) 45%,hsla(0,0%,0%,1) 90%')], f: tone(1, 1.5), x: 'overlay', o: '1', k: MASK }
  }, {
    i:  { c: CLIP },
    b:  { g: [spot('hsla(0,0%,100%,1) 10%,hsla(0,0%,100%,.85) 20%,hsla(0,0%,0%,.35) 90%')], f: 'none', x: 'multiply' },
    ba: 0
  });
  // @@

  // @@ lattice
  // radiant : un croisillon de marches de gris sous la lueur de la carte, des paillettes fines, un motif nacré dans la fenêtre
  var GREYS = [10, 20, 35, 42.5, 50, 42.5, 35, 20, 10, 0];
  var CROSS = 'calc((' + BX + ' - 50%) * 1.5 + 50%) calc((' + BY + ' - 50%) * 1.5 + 50%)';
  style('lattice', {
    i:  { g: [mid('hsl(0,0%,95%) 20%,var(--mjs-hologram-glow,hsl(175, 100%, 90%)) 130%'), steps(45, 1.2, GREYS), steps(-45, 1.2, GREYS)], m: 'exclusion,darken,color-dodge', s: 'cover,210% 210%,210% 210%', p: 'center,' + CROSS + ',' + CROSS, f: tone(0.5, 2, 1.75), c: FRAME },
    ib: { g: [GLIT, mid('hsla(0,0%,58%,.8) 10%,hsla(0,0%,20%,.9) 20%,hsla(0,0%,20%,.5) 50%')], m: 'color-dodge', s: '15% 15%,350% 350%', p: 'center', f: tone(0.66, 2, 0.5), x: 'overlay', z: 2 },
    ia: { g: [pat('waves'), bands(55, 200, PEARL, 'px')], m: 'hard-light', s: 'cover,400% 100%', p: 'center,calc((' + BX + ' - 50%) * -2.5 + 50%) calc((' + BY + ' - 50%) * -2.5 + 50%)', f: tone(0.6, 3, 2), x: 'color-dodge', c: CLIP },
    b:  { g: [spot('hsla(0,0%,100%,.33) 0%,hsl(0,0%,25%) 110%')], f: tone(1, 1.5), x: 'hard-light' }
  }, { ia: { m: 'difference', s: '25% auto,400% 100%' } });
  // @@

  // @@ opal
  // gallery : un métal irisé — de larges bandes pâles, et une lumière dure qui les fait miroiter
  style('opal', {
    i:  { g: [bands(-22, 5, SOFT('hsla(2,74%,59%,.75)'), '%', true)], m: 'color-dodge', s: '300% 400%', p: '0% ' + BY, f: 'brightness(' + lit(0.3, 0.5) + ') contrast(2.3) saturate(1)', c: FRAME },
    ia: { g: [mid('hsl(0,0%,100%) 5%,hsla(300,100%,11%,.6) 40%,hsl(0,0%,22%) 120%')], s: '400% 500%', p: 'center', f: 'brightness(' + lit(0.2, 0.4) + ') contrast(.85) saturate(1.1)', x: 'hard-light' },
    b:  { g: [spot('hsla(0,0%,100%,1) 10%,hsla(0,0%,100%,.6) 35%,hsla(180,11%,35%,1) 60%')], x: 'soft-light' }
  });
  // @@
  // l'éclat discret d'opal : plus sombre, plus contrasté, un peu moins présent
  style('opal', { b: { f: tone(0.8, 1.5), o: 'calc(' + O + ' * .8)' } }, 0, 'calm'); // @@ opal

  // @@ streaks rays rays-cloud rays-fade rays-window
  // les rayons : des bandes d'arc-en-ciel et des barres en diagonale qui se croisent, sur un motif ; le second
  // calque glisse à l'envers du premier — c'est ce qui fait bouger la lumière quand la souris bouge
  var RAYS  = function(first, k) { return [first, bands(0, 5, rot(SUN, k)), BARS, SHADE]; };
  // @@
  var LEAN  = 'calc(' + BX + ' + ' + BY + ' * .2)'; // @@ rays rays-cloud rays-window
  var SAME  = 'center,0% ' + BY + ',' + BX + ' ' + BY + ',' + BX + ' ' + BY; // @@ streaks rays-fade
  var BACK  = 'center,0% ' + BY + ',calc(' + BX + ' * -1) calc(' + BY + ' * -1),' + BX + ' ' + BY; // @@ streaks rays-fade
  var SAME2 = 'center,0% ' + BY + ',' + LEAN + ' ' + BY + ',' + BX + ' ' + BY; // @@ rays rays-cloud rays-window
  var BACK2 = 'center,0% ' + BY + ',calc(' + LEAN + ' * -1) calc(' + BY + ' * -1),' + BX + ' ' + BY; // @@ rays rays-cloud rays-window
  var WIDE  = ',200% 700%,300% 100%,200% 100%'; // @@ streaks rays rays-cloud rays-fade rays-window
  var TIGHT = ',200% 400%,195% 100%,200% 100%'; // @@ streaks rays rays-cloud rays-fade rays-window
  var SOFTL = 'soft-light,hue,hard-light'; // @@ rays rays-cloud rays-fade rays-window
  var EXCL  = 'exclusion,hue,hard-light'; // @@ rays rays-fade rays-window
  var HALO  = function(end) { return [spot('hsl(0,0%,100%) 0%,hsla(0,0%,0%,0) ' + end + '%')]; }; // @@ rays rays-cloud rays-window
  var STEEL = spot('hsl(0,0%,100%) 0%,hsla(210,3%,54%,.33) 45%,hsla(0,0%,20%,.9) 130%'); // @@ streaks rays
  var SLATE = spot('hsl(0,0%,75%) 5%,hsl(200,5%,35%) 60%,hsl(320,40%,10%) 150%'); // @@ rays rays-cloud

  // @@ streaks
  // v : les rayons sur un grain fin
  style('streaks', {
    i:  { g: RAYS(tex('grain'), 0), m: 'screen,hue,hard-light', s: '500px 100%' + WIDE, p: SAME, f: tone(0.8, 2.95, 0.65) },
    ia: { g: RAYS(tex('grain'), 5), m: 'screen,hue,hard-light', s: '500px 100%' + TIGHT, p: BACK, f: tone(1, 2.5, 1.75), x: 'soft-light' },
    b:  { g: [STEEL], f: tone(0.9, 1.75), x: 'hard-light', o: 'calc(' + O + ' * .5)' }
  }, { i: { f: tone(0.7, 2, 0.5) } });
  // @@

  // @@ rays rays-window
  // v-full, gallery-v, shiny, shiny-v : les rayons sur le motif gravé de la carte, plus vifs loin du centre
  style('rays rays-window', {
    i:  { g: RAYS(pat('ripples'), 0), m: SOFTL, s: 'cover' + WIDE, p: SAME2, f: 'brightness(' + lit(0.4, 0.4) + ') contrast(1.4) saturate(2.25)' },
    ia: { g: RAYS(pat('ripples'), 5), m: SOFTL, s: 'cover' + TIGHT, p: BACK2, f: 'brightness(' + lit(0.4, 0.8) + ') contrast(1.5) saturate(1.25)', x: 'exclusion' }
  }, {
    i:  { m: EXCL, s: '33%' + WIDE, f: 'brightness(' + lit(0.3, 0.35) + ') contrast(2) saturate(1.5)' },
    ia: { m: EXCL, s: '33%' + TIGHT, f: 'brightness(' + lit(0.5, 0.8) + ') contrast(1.6) saturate(1.4)' }
  });
  // @@
  style('rays rays-window', { ib: { g: HALO(40), s: 'cover', p: 'center', x: 'overlay', o: '.75', k: 0, z: 1 } }); // @@ rays rays-window
  style('rays', {}, { ib: 0 }); // @@ rays
  // l'éclat de rays : vif par défaut (bright) ; calm le rend gris acier, sans halo ; shade assombrit les bords au lieu de les éclairer
  style('rays', { b: { g: [SLATE], s: '120% 150%', p: 'center', f: tone(1, 1.2, 1), x: 'hard-light', o: 'calc(' + O + ' * .75)' } }); // @@ rays
  style('rays', { ib: 0, b: { g: [STEEL], s: 'auto', p: '0% 0%', f: tone(0.9, 1.75), x: 'hard-light', o: 'calc(' + O + ' * .4)' } }, 0, 'calm'); // @@ rays
  style('rays', { b: { g: [spot('hsl(0,0%,90%) 5%,hsl(200,5%,45%) 80%,hsl(320,40%,10%) 150%')], s: '120% 140%', p: 'center', f: tone(0.88, 2.25, 0.7), x: 'darken', o: 'calc(' + O + ' * ' + C + ' * .75)' } }, { ia: { f: 'brightness(' + lit(0.4, 0.5) + ') contrast(1.4) saturate(1.2)', x: 'difference' } }, 'shade'); // @@ rays
  style('rays-window', { i: { c: CLIP }, b: { g: [spot('hsl(0,0%,100%) 0%,hsl(320,5%,15%) 150%')], s: 'cover', p: 'center', f: tone(1.2, 1, 0.7), x: 'multiply', o: 'calc(' + O + ' * ' + C + ')' } }, { ia: { f: 'brightness(' + lit(0.4, 0.5) + ') contrast(1.4) saturate(1.2)', x: 'difference' } }); // @@ rays-window

  // @@ rays-cloud
  // trainer-full : les mêmes rayons, plus posés, sous un éclat qui assombrit
  style('rays-cloud', {
    i:  { g: RAYS(pat('waves'), 0), m: SOFTL, s: 'cover' + WIDE, p: SAME2, f: 'brightness(' + lit(0.05, 0.8) + ') contrast(1.75) saturate(1.2)' },
    ib: { g: HALO(80), s: 'cover', p: 'center', x: 'screen', o: '.5', k: 0, z: 1 },
    ia: { g: RAYS(pat('waves'), 5), m: SOFTL, s: 'cover' + TIGHT, p: BACK2, f: 'brightness(' + lit(0.4, 0.85) + ') contrast(2) saturate(.5)', x: 'exclusion' },
    b:  { g: [SLATE], s: '170% 170%', p: 'center', f: tone(1.5, 1.4, 1), x: 'multiply', o: 'calc(' + O + ' * .75)' }
  }, {
    i:  { m: 'color-burn,hue,hard-light', s: '20%' + WIDE, f: 'brightness(' + lit(0.05, 0.6) + ') contrast(1.5) saturate(1.2)' },
    ia: { m: 'color-burn,hue,hard-light', s: '20%' + TIGHT, f: 'brightness(' + lit(0.05, 0.6) + ') contrast(1.5) saturate(1.2)' }
  });
  // @@

  // @@ rays-fade
  // vstar : les rayons, pastel, que le masque de la carte laisse s'effacer sous la souris
  var VEIL = MASK + ',' + spot('hsla(0,0%,100%,0) 0%,hsla(0,0%,100%,.5) 120%');
  style('rays-fade', {
    i:  { g: RAYS(pat('maze'), 0), m: SOFTL, s: 'cover' + WIDE, p: SAME, f: 'brightness(' + lit(0.75, 0.25) + ') contrast(2) saturate(1.25)', k: VEIL },
    ib: { g: [spot('hsla(190,7%,80%,.75) 0%,hsla(260,7%,50%,.25) 45%,hsl(310,7%,50%) 120%')], x: 'hard-light', o: '.8', k: VEIL, z: 2 },
    ia: { g: RAYS(pat('maze'), 5), m: SOFTL, s: 'cover' + TIGHT, p: BACK, f: 'brightness(' + lit(0.75, 0.5) + ') contrast(1.5) saturate(1.5)', x: 'exclusion', k: VEIL },
    b:  { g: [spot('hsl(195,90%,90%) 5%,hsl(300,3%,60%) 60%,hsl(350,0%,15%) 150%')], f: tone(0.7, 2), x: 'hard-light', o: 'calc(' + O + ' * ' + C + ' * .75)' }
  }, {
    i:  { m: EXCL, s: '18% 15%' + WIDE, f: 'brightness(' + lit(0.25, 0.35) + ') contrast(1.8) saturate(1.75)' },
    ia: { m: EXCL, s: '18% 15%' + TIGHT },
    b:  { f: tone(0.55, 2) }
  });
  // @@

  // @@ rays-wide
  // vmax : de très larges bandes qui bougent à peine, sur un motif très marqué
  style('rays-wide', {
    i:  { g: [pat('discs'), bands(-33, 6, VIVID), 'repeating-linear-gradient(133deg,hsla(227,53%,12%,.5) 0%,hsl(180,10%,50%) 2.5%,hsl(83,50%,35%) 5%,hsl(180,10%,50%) 7.5%,hsla(227,53%,12%,.5) 10%,hsla(227,53%,12%,.5) 15%)', spot('hsla(189,76%,77%,.6) 0%,hsla(147,59%,77%,.6) 25%,hsla(271,55%,69%,.6) 50%,hsla(355,56%,72%,.6) 75%')], m: 'difference,luminosity,soft-light', s: 'cover,1100% 1100%,600% 600%,200% 200%', p: 'center,' + BX + ' ' + BY + ',' + BX + ' ' + BY + ',' + BX + ' ' + BY, f: 'brightness(' + lit(0.4, 0.4) + ') contrast(2) saturate(1)' },
    ia: { g: [bands(0, 6, rot(SUN, 5)), BARS], m: 'hue,hard-light', s: '200% 700%,300% 100%', p: '0% ' + BY + ',' + BX + ' ' + BY, f: 'saturate(1.5)', x: 'lighten', o: 'calc(.3 * ' + O + ' + ' + O + ' * ' + C + ' * .5)' },
    b:  { g: [spot('hsla(0,0%,100%,.75) 0%,hsl(0,0%,0%) 120%')], f: tone(1, 1), x: 'hard-light', o: 'calc(.2 * ' + O + ' + ' + O + ' * ' + C + ' * .8)' }
  }, { i: { s: '60% 30%,1100% 1100%,600% 600%,200% 200%' } });
  // @@

  var HALF = 'calc(25% + 50% * ' + FX + ') calc(25% + 50% * ' + FY + ')'; // @@ haze haze-deep
  var NEAR = 'calc(25% + ' + X + ' / 2) calc(25% + ' + Y + ' / 2)'; // @@ haze haze-deep
  var TINT = 'linear-gradient(-45deg,' + DEEP[0] + ',' + DEEP[4] + ')'; // @@ haze haze-deep
  // @@ haze haze-deep
  // les paillettes sur dégradés profonds : rainbow-rare et secret-rainbow (un voile de couleur qui suit la
  // souris), rainbow-alt et gallery-vmax (des bandes pâles qui montent)
  style('haze haze-deep', {
    i:  { g: [TINT, GLIT, sweep(-30)], m: 'luminosity,soft-light', s: '200% 200%,' + G + ',400% 400%' },
    ib: { g: [pat('ripples-mask')], m: 'difference', s: 'cover', p: 'center', f: tone(2.5, 1), o: 'calc((' + C + ' + .4) * .6)' },
    ia: { g: [GLIT, sweep(-60)], m: 'soft-light', s: G + ',400% 400%', k: 0 }
  }, { ib: { s: '33%' } });
  // @@
  // @@ haze
  style('haze', {
    i:  { p: HALF + ',center,' + NEAR, f: 'brightness(' + lit(0.25, 0.6) + ') contrast(2.2) saturate(.75)' },
    ib: { x: 'darken' },
    ia: { p: 'center,' + X + ' ' + Y, f: 'brightness(' + lit(0.3, 0.55) + ') contrast(2) saturate(1)', x: 'color-dodge' },
    b:  { g: [spot('hsl(0,0%,80%),hsla(187,10%,85%,.25) 30%,hsl(197,6%,25%) 120%')], f: tone(0.9, 1.75), x: 'hard-light', o: 'calc(' + C + ' * .9)' }
  });
  // @@
  // @@ haze-deep
  style('haze-deep', {
    i:  { p: HALF + ',' + JIT('+') + ',' + NEAR, f: 'brightness(' + lit(0.5, 0.75) + ') contrast(2) saturate(1)' },
    ib: { x: 'multiply', k: 0, m: 'hard-light' },
    ia: { p: JIT('-') + ',' + X + ' ' + Y, f: 'brightness(' + lit(0.35, 0.35) + ') contrast(2) saturate(1)', x: 'exclusion' },
    b:  { g: [spot('hsl(0,0%,80%),hsla(0,0%,74.9%,.25) 30%,hsl(0,0%,21.6%) 130%')], f: tone(0.9, 2), x: 'hard-light', o: 'calc(' + C + ' * .9)' }
  });
  // @@
  var PALE = SOFT('hsla(2,70%,58%,.75)'); // @@ dust-dark dust
  // @@ dust-dark dust
  style('dust-dark dust', {
    i:  { m: 'luminosity,overlay', s: '200% 400%,' + G + ',400% 400%', p: '0% ' + BY + ',center,calc(' + BX + ' * 1.5) calc(' + BY + ' * 1.5)', f: 'brightness(' + lit(0.3, 0.3) + ') contrast(3) saturate(1.8)' },
    ib: { g: [FOIL], m: 'difference', s: 'cover', p: 'center', f: tone(1.5, 1.5), x: 'color-dodge', o: 'calc((' + C + ' + .6) * .4)' },
    ia: { g: [GLIT, sweep(-60)], m: 'overlay', s: G + ',400% 400%', p: 'center,calc(' + BX + ' * -1.5) calc(' + BY + ' * -1.5)', f: 'brightness(' + lit(0.5, 0.6) + ') contrast(3) saturate(1)', x: 'color-dodge', o: 'calc(1.2 - ' + C + ' / 2)', k: 0 }
  });
  // @@
  style('dust-dark', { i: { g: [bands(133, 5, PALE, '%', true), GLIT, sweep(-30)] }, b: { g: [spot('hsla(50,20%,90%,.75) 0%,hsla(150,20%,30%,.65) 45%,hsla(0,0%,0%,1) 100%')], f: tone(0.9, 2), o: 'calc(' + O + ' * .75)' } }); // @@ dust-dark
  style('dust', { i: { g: [bands(133, 6, PALE, '%', true), GLIT, sweep(-30)] }, b: { g: [spot('hsl(50,30%,90%) 0%,hsl(162,5%,40%),hsl(0,0%,0%) 120%')], f: tone(1, 1), x: 'hard-light', o: 'calc(' + O + ' * ' + C + ' * .85)' } }); // @@ dust

  var DULL = 'brightness(' + lit(0.3, 0.2) + ') contrast(2) saturate(.75)'; // @@ glint glint-dark
  // @@ glint
  // l'or : deux nappes de paillettes qui glissent l'une contre l'autre, une roue de couleurs, le motif de la carte doré
  style('glint', {
    i:  { g: [GLIT, GLIT, 'conic-gradient(' + [SUN[3], SUN[4], SUN[5], SUN[0], SUN[3]].join(',') + ')', spot('hsla(150,0%,0%,.98) 10%,hsla(0,0%,95%,.15) 90%')], m: 'soft-light,hard-light,overlay', s: G + ',' + G + ',cover,cover', p: '45% 45%,55% 55%,center,center', f: 'brightness(' + lit(0.2, 0.4) + ') contrast(1) saturate(2.7)' },
    ib: { g: [pat('weave'), GOLD, spot('hsla(10,20%,90%,.95) 10%,hsl(0,0%,0%) 70%')], m: 'hard-light,multiply', s: 'cover,cover,cover', p: 'center,center,center', f: tone(1.25, 1.25, 0.35), x: 'lighten', o: '.8', k: 0 },
    ia: { g: [GLIT], s: G, p: JIT('+'), f: 'brightness(' + lit(0.6, 0.6) + ') contrast(1.5)', x: 'overlay', k: 0 },
    b:  { g: [spot('hsla(45,8%,80%,.3) 0%,hsl(22,15%,12%) 180%')], f: tone(1.3, 1.5), x: 'hard-light' }
  }, { i: { f: DULL }, ib: { s: '33%,cover,cover' } });
  // @@
  // @@ glint-dark
  style('glint-dark', {
    i:  { g: [GLIT, GLIT, spot('hsl(152.7,21.6%,10%) 10%,hsla(177,22%,80%,.1) 50%,hsla(0,0%,95%,.98) 90%'), GOLD], m: 'soft-light,darken,color', s: G + ',' + G + ',cover,cover', p: '40% 45%,55% 55%,center,center', f: tone(1, 1, 1), k: 0 },
    ib: { g: [pat('weave'), spot('hsla(50,20%,90%,.95) 10%,hsla(324,22%,63%,.5) 50%,hsl(0,0%,0%) 90%')], m: 'color-burn', s: 'cover,cover', p: 'center,center', f: tone(1, 1, 1), x: 'exclusion', o: '1', k: 0 },
    ia: { g: [GLIT, 'conic-gradient(' + rot(SUN, 2).concat([SUN[2]]).join(',') + ')'], m: 'luminosity', s: G + ',cover', p: JIT('+'), f: 'brightness(' + lit(0.5, 0.6) + ') contrast(2) saturate(3)', x: 'soft-light', k: 0 },
    b:  { g: [spot('hsla(40,100%,95%,.2) 10%,hsla(40,20%,5%,1) 180%')], f: tone(1, 1), x: 'hard-light' }
  }, { i: { f: DULL }, ib: { s: '33%,cover' }, b: { f: tone(0.5, 1) } });
  // @@

  // @@ bloom
  // shiny-vmax : les paillettes sur fond argenté, le motif de la carte en filigrane, un éclat que le masque découpe
  style('bloom', {
    i:  { g: [GLIT, GLIT, sweep(-30), spot('hsla(248,5%,10%,1) 10%,hsla(206,5%,80%,.1) 50%,hsla(0,0%,95%,.98) 90%')], m: 'soft-light,overlay,color-burn', s: G + ',' + G + ',400% 400%,cover', p: '40% 45%,55% 55%,calc(' + BX + ' * 1.5) calc(' + BY + ' * 1.5),center', f: tone(1, 1, 0.85) },
    ib: { g: [FOIL, spot('hsla(248,5%,91%,.95) 10%,hsla(206,5%,68%,.5) 50%,hsl(0,0%,0%) 120%')], m: 'color-burn', s: 'cover,cover', p: 'center,center', f: tone(1, 1, 0.4), x: 'lighten', o: '.35', k: 0 },
    ia: { g: [bands(-30, 5, rot(SUN, 5))], s: '400% 800%', p: SLIDE, f: FADE, x: 'hue', k: 0 },
    b:  { g: [spot('hsla(248,5%,90%,.45) 0%,hsla(206,5%,30%,.45) 45%,hsla(0,0%,0%,.33) 120%')], f: tone(1, 1.25) },
    ba: { g: [spot('hsla(248,5%,90%,.75) 0%,hsla(206,5%,30%,.65) 45%,hsla(0,0%,0%,.75) 100%')], f: tone(1, 1.25), x: 'overlay', o: '1', k: MASK }
  }, { ia: { f: 'brightness(' + lit(0.4, 0.5) + ') contrast(1.4) saturate(1.2)', x: 'difference' } });
  // @@

  return css;
};
// @@

// @@ cards
// les variables que la balise porte pendant le mouvement : déclarées sans héritage, leur changement
// ne fait recalculer le style d'aucun descendant
var _mjsFxHoloTyped = false;
var _mjsFxHoloTypes = function() {
  if (_mjsFxHoloTyped) return;
  _mjsFxHoloTyped = true;
  if (typeof CSS === 'undefined' || !CSS.registerProperty) return;
  var defs = [['rx', '<angle>', '0deg'], ['tx', '<length>', '0px'], ['ty', '<length>', '0px'], ['s', '<number>', '1']];
  for (var i = 0; i < defs.length; i++) {
    try { CSS.registerProperty({ name: '--mjs-fx-hologram-' + defs[i][0], syntax: defs[i][1], inherits: false, initialValue: defs[i][2] }); }
    catch (e) { }
  }
};
// @@

var _mjsFxHoloUrl = function(v) { return 'url("' + String(v).replace(/["\\\n]/g, function(c) { return c === '\n' ? '' : '\\' + c; }) + '")'; }; // @@ cards

// @@ cards
// la carte agrandie : une seule à la fois dans la page
var _mjsFxHoloActive = null;

// un ressort amorti, pas à pas : `v` les valeurs, `u` leurs vitesses (par soixantième de seconde), `t` les
// cibles, `k` la raideur, `d` l'amortissement, `m` l'inverse de la masse (0 : immobile) qui remonte de `r`
// par soixantième de seconde ; `dt` en soixantièmes de seconde — la vitesse reçoit l'élan du pas, la valeur
// avance de cette vitesse : le mouvement dure le même temps quelle que soit la cadence de l'écran ; rend vrai
// quand tout est posé
var _mjsFxHoloSpring = function(sp, dt) {
  var settled = true;
  for (var i = 0; i < sp.v.length; i++) {
    var delta = sp.t[i] - sp.v[i];
    var u     = sp.u[i] + (sp.k * delta - sp.d * sp.u[i]) * sp.m * dt;
    if (Math.abs(u) < 0.01 && Math.abs(delta) < 0.01) {
      sp.v[i] = sp.t[i];
      sp.u[i] = 0;
    }
    else {
      settled = false;
      sp.u[i] = u;
      sp.v[i] += u * dt;
    }
  }
  sp.m = Math.min(sp.m + sp.r * dt, 1);
  return settled;
};

// vrai quand toutes les valeurs et vitesses du ressort sont des nombres finis
var _mjsFxHoloSane = function(sp) {
  for (var i = 0; i < sp.v.length; i++) {
    if (!Number.isFinite(sp.v[i]) || !Number.isFinite(sp.u[i])) return false;
  }
  return true;
};

// le calque qu'un script a emporté en réécrivant la balise (textContent, innerHTML…) revient : le même nœud, après le retrait de ses copies figées (`innerHTML +=` en laisse)
var _mjsFxHoloBack = function(host, node) {
  if (node.parentNode === host) return;
  var copies = host.querySelectorAll(':scope > [mjs-fx-layer="' + node.getAttribute('mjs-fx-layer') + '"]');
  for (var i = 0; i < copies.length; i++) copies[i].remove();
  µ._mjs_dom.appendChild(host, node);
};

var _mjsFxHoloCard = function(el, s, style) {
  _mjsFxHoloTypes();
  var host    = µ._mjs_fxInner(el) || el;
  if (host !== el) µ._mjs_fxAdopt(host, 'hologram');
  var restore = µ._mjs_fxRelative(el);
  var calm    = µ._mjs_fxCalm();
  var on      = s.on || 'hover';
  var power   = s.strength !== void 0 ? s.strength : 1;
  var seed    = s.seed !== void 0 ? [(s.seed * 37 % 100) / 100, (s.seed * 61 % 100) / 100] : [Math.random(), Math.random()];
  var layer   = null;
  var frame   = 0;
  var last    = 0;
  var point   = null;
  var over    = false;
  var endT    = 0;
  var showT   = 0;
  var show    = 0;
  var zoomed  = false;
  var flying  = false;
  var gyro    = null;
  var moveT   = 0;
  var marked  = false;
  var edge    = s.radius !== void 0;
  // la souris, le reflet, le fond : x, y (en %), o, deux places sans emploi (zéro : la carte ne penche pas), bx, by (en %)
  var sp      = { v: [50, 50, 0, 0, 0, 50, 50], u: [0, 0, 0, 0, 0, 0, 0], t: [50, 50, 0, 0, 0, 50, 50], k: 0.066, d: 0.25, m: 1, r: 0 };
  // la carte agrandie : taille, déplacement (px), tour sur elle-même (degrés)
  var pop     = { v: [1, 0, 0, 0], u: [0, 0, 0, 0], t: [1, 0, 0, 0], k: 0.033, d: 0.45, m: 1, r: 0 };
  if (s.shadow !== false) µ._mjs_dom.setAttribute(el, 'mjs-fx-hologram-shadow', '');

  var image = function(k) {
    var v = µ._mjs_fxImage ? µ._mjs_fxImage(s[k], el) : s[k];
    return v ? String(v) : '';
  };
  // le motif et le masque partent dès la pose : au premier survol ils sont là
  var foil = image('image');
  var mask = image('mask');
  // le zoom tourne (spin) : le dos de la carte, l'image qu'on lui donne, son calque, et la face montrée
  var spin    = s.zoom === 'spin'; // @@ zoom=spin hologram.back
  var dorsal  = image('back'); // @@ zoom=spin hologram.back
  var rear    = null; // @@ zoom=spin hologram.back
  var faced   = false; // @@ zoom=spin hologram.back
  var first   = true; // @@ zoom=spin hologram.back
  // vrai : le tour joue à chaque zoom, aller et retour ; faux : seulement au premier zoom de chaque carte (comme sur le site d'origine)
  var each    = true; // @@ zoom=spin hologram.back
  if (typeof Image === 'function') {
    if (foil) new Image().src = foil;
    if (mask) new Image().src = mask;
    if (dorsal) new Image().src = dorsal; // @@ zoom=spin hologram.back
  }

  // @@ hologram.zone
  // la fenêtre de l'illustration : la forme CSS écrite, telle quelle
  var zone = function() {
    var z = s.zone;
    if (!z) return;
    z = String(z);
    layer.style.setProperty('--mjs-fx-hologram-clip', z);
    // @@ style=frame
    // et son contraire (tout le cadre, percé de la fenêtre) : un `inset(…)` ou un `polygon(…)` se lit en points, toute autre forme n'en a pas
    var m   = /^(inset|polygon)\((.*)\)$/.exec(z);
    var pts = [];
    if (m) {
      var a = m[2].split(',');
      if (m[1] === 'polygon') pts = /^\s*(?:evenodd|nonzero)\s*$/.test(a[0]) ? a.slice(1) : a;
      else {
        var v = m[2].split(/\s+round\s/)[0].trim().split(/\s+/);
        var t = v[0];
        var r = v[1] || t;
        var b = v[2] || t;
        var l = v[3] || r;
        pts = [l + ' ' + t, 'calc(100% - ' + r + ') ' + t, 'calc(100% - ' + r + ') calc(100% - ' + b + ')', l + ' calc(100% - ' + b + ')'];
      }
    }
    layer.style.setProperty('--mjs-fx-hologram-inv', pts.length ? 'polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,' + pts.join(',') + ',' + pts[0] + ',0% 0%)' : 'none');
    // @@
  };
  // @@
  var build = function() {
    if (layer) return _mjsFxHoloBack(host, layer);
    layer = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'hologram');
    layer.setAttribute('mjs-fx-hologram-card', '');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('mjs-fx-hologram-style', style);
    if (!foil) layer.setAttribute('mjs-fx-hologram-nu', '');
    if (!mask) layer.setAttribute('mjs-fx-hologram-open', '');
    if (s.shine) layer.setAttribute('mjs-fx-hologram-shine', s.shine);
    if (edge) layer.setAttribute('mjs-fx-hologram-radius', '');
    // l'éclat d'abord, le reflet par-dessus
    if (s.glare !== false) layer.appendChild(document.createElement('b'));
    layer.appendChild(document.createElement('i'));
    if (foil) layer.style.setProperty('--mjs-fx-hologram-foil', _mjsFxHoloUrl(foil));
    if (mask) layer.style.setProperty('--mjs-fx-hologram-mask', _mjsFxHoloUrl(mask));
    layer.style.setProperty('--mjs-fx-hologram-cosmos', Math.floor(seed[0] * 734) + 'px ' + Math.floor(seed[1] * 1280) + 'px');
    zone(); // @@ hologram.zone
    µ._mjs_dom.appendChild(host, layer);
  };
  var drop = function() {
    if (!layer) return;
    layer.remove();
    layer = null;
  };

  // ce que la balise porte pendant le mouvement, et rien au repos
  var mark = function(yes) {
    if (yes === marked) return;
    marked = yes;
    if (yes) {
      // la transformation de l'auteur, lue une fois ici, avant toute écriture de l'image ; l'effet la compose avec la sienne
      var own = typeof getComputedStyle === 'function' ? getComputedStyle(el).transform : '';
      if (own && own !== 'none') el.style.setProperty('--mjs-fx-hologram-own', own);
      µ._mjs_dom.setAttribute(el, 'mjs-fx-hologram-3d', '');
    }
    else {
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-3d');
      var names = ['rx', 'tx', 'ty', 's', 'own'];
      for (var i = 0; i < names.length; i++) el.style.removeProperty('--mjs-fx-hologram-' + names[i]);
    }
  };
  var put = function() {
    var v    = sp.v;
    var p    = pop.v;
    var flat = Math.abs(p[3]) < 0.005 && Math.abs(p[0] - 1) < 0.0005 && Math.abs(p[1]) < 0.05 && Math.abs(p[2]) < 0.05;
    // la marque d'abord : c'est elle qui lit la transformation de l'auteur, avant les écritures de l'image
    mark(!flat);
    var c = Math.min(Math.sqrt((v[1] - 50) * (v[1] - 50) + (v[0] - 50) * (v[0] - 50)) / 50, 1);
    if (layer) {
      build();
      layer.style.setProperty('--mjs-fx-hologram-x', (v[0] / 100).toFixed(4));
      layer.style.setProperty('--mjs-fx-hologram-y', (v[1] / 100).toFixed(4));
      layer.style.setProperty('--mjs-fx-hologram-c', c.toFixed(4));
      layer.style.setProperty('--mjs-fx-hologram-o', (Math.max(v[2], 0) * power).toFixed(4));
      // la démonstration mène le fond à part ; sinon il se déduit de la souris, en CSS
      if (show) {
        layer.style.setProperty('--mjs-fx-hologram-bx', v[5].toFixed(3) + '%');
        layer.style.setProperty('--mjs-fx-hologram-by', v[6].toFixed(3) + '%');
      }
    }
    if (flat) return;
    el.style.setProperty('--mjs-fx-hologram-rx', p[3].toFixed(3) + 'deg'); // @@ zoom=spin hologram.back
    if (rear) turn(p[3]); // @@ zoom=spin hologram.back
    el.style.setProperty('--mjs-fx-hologram-s', p[0].toFixed(4));
    el.style.setProperty('--mjs-fx-hologram-tx', p[1].toFixed(2) + 'px');
    el.style.setProperty('--mjs-fx-hologram-ty', p[2].toFixed(2) + 'px');
  };

  // la souris à (x, y) en % de la carte : le reflet y va, le fond glisse moins loin
  var aim = function(x, y, o) {
    var t = sp.t;
    t[0]  = x;
    t[1]  = y;
    t[2]  = o;
    t[5]  = 37 + x * 0.26;
    t[6]  = 33 + y * 0.34;
  };
  var rest = on === 'always' ? 1 : 0;
  // les cibles du repos : le reflet au centre, éteint (allumé s'il reste), la carte à plat
  var park = function() {
    for (var i = 0; i < 7; i++) sp.t[i] = i === 2 ? rest : i === 3 || i === 4 ? 0 : 50;
  };
  // tout à sa cible, sans vitesse
  var still = function() {
    for (var i = 0; i < 7; i++) {
      sp.v[i] = sp.t[i];
      sp.u[i] = 0;
    }
    for (var j = 0; j < 4; j++) {
      pop.v[j] = pop.t[j];
      pop.u[j] = 0;
    }
  };
  // @@ zoom=spin hologram.back
  // le dos de la carte, le temps d'un tour : un calque plein, de l'arrondi de la carte, retourné pour se lire à l'endroit ; il couvre la
  // face quand la carte se montre de dos, naît avec le tour et repart avec lui
  var cover = function() {
    if (rear) return _mjsFxHoloBack(host, rear);
    rear = document.createElement('span');
    rear.setAttribute('mjs-fx-layer', 'hologram-back');
    rear.setAttribute('aria-hidden', 'true');
    if (dorsal) rear.style.setProperty('--mjs-fx-hologram-back', _mjsFxHoloUrl(dorsal));
    µ._mjs_dom.appendChild(host, rear);
  };
  var unback = function() {
    if (!rear) return;
    rear.remove();
    rear  = null;
    faced = false;
  };
  // de dos entre un quart de tour et trois quarts (le cosinus de l'angle est négatif) : la face change quand la carte est de chant
  var turn = function(deg) {
    cover();
    var yes = Math.cos(deg * Math.PI / 180) < 0;
    if (yes === faced) return;
    faced = yes;
    if (yes) rear.setAttribute('mjs-fx-hologram-turned', '');
    else rear.removeAttribute('mjs-fx-hologram-turned');
  };
  // @@
  // en vol, tant que le ressort de la carte écrit sa transformation à chaque image : la balise porte une marque qui coupe ses transitions, d'où qu'elles
  // viennent (la pente d'*tilt, une règle de l'auteur) ; relancée à chaque écriture, une transition de `transform` retarderait la carte derrière le ressort
  var fly = function(yes) {
    if (yes === flying) return;
    flying = yes;
    if (yes) µ._mjs_dom.setAttribute(el, 'mjs-fx-hologram-fly', '');
    else µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-fly');
  };
  var unshow = function() {
    show = 0;
    if (!layer) return;
    layer.style.removeProperty('--mjs-fx-hologram-bx');
    layer.style.removeProperty('--mjs-fx-hologram-by');
  };
  var tick = function(now) {
    frame = 0;
    var dt = last ? Math.min((now - last) * 60 / 1000, 30) : 1;
    last   = now;
    // la démonstration : quatre secondes d'un tour lent, la lumière et la carte en rond
    if (show) {
      var r = (now - show) / 20 * 0.05;
      if (now - show > 4000) {
        unshow();
        settle(0);
      }
      else {
        sp.t[0] = 55 + Math.sin(r) * 55;
        sp.t[1] = 55 + Math.cos(r) * 55;
        sp.t[2] = 0.8;
        sp.t[5] = 20 + Math.sin(r) * 20;
        sp.t[6] = 20 + Math.cos(r) * 20;
      }
    }
    else if (point) {
      // la boîte de la carte telle qu'elle est à l'écran (inclinée), lue avant toute écriture
      var b = µ._mjs_dom.getBoundingClientRect(el);
      if (b.width && b.height) aim(Math.min(Math.max((point[0] - b.left) / b.width * 100, 0), 100), Math.min(Math.max((point[1] - b.top) / b.height * 100, 0), 100), 1);
      point = null;
    }
    var done;
    if (calm) {
      still();
      done = true;
    }
    else {
      // une image en retard : le ressort rattrape le temps passé, par pas d'un soixantième de seconde
      // (le mouvement dure le même temps sur une machine lente, au lieu de passer au ralenti)
      var steps = Math.max(1, Math.round(dt));
      var a     = false;
      var z     = false;
      for (var k = 0; k < steps; k++) {
        a = _mjsFxHoloSpring(sp, dt / steps);
        z = _mjsFxHoloSpring(pop, dt / steps);
      }
      done = a && z;
      // ceinture : un nombre qui n'est pas fini ne se rattrape plus (le ressort ne le ramènerait jamais à sa cible) ;
      // tout revient au repos d'un coup et la boucle finit
      if (!_mjsFxHoloSane(sp) || !_mjsFxHoloSane(pop)) {
        park();
        pop.t[0] = 1;
        pop.t[1] = pop.t[2] = pop.t[3] = 0;
        still();
        done = true;
        z    = true;
      }
    }
    // en vol : la marque est posée avant la première écriture de la carte
    if (!calm && !z) fly(true);
    put();
    // le reflet éteint pour de bon (à zéro, sans vitesse) : le calque repart sans attendre
    // que la carte ait fini de se redresser — le prochain mouvement de la souris le refera
    if (layer && !zoomed && !show && rest === 0 && sp.t[2] === 0 && sp.v[2] === 0 && sp.u[2] === 0) drop();
    // ni reflet ni inclinaison : plus rien à montrer, le ressort ne finit pas sa course à vide
    if (!done && !layer && !marked && !show && !zoomed) {
      still();
      done = true;
      z    = true;
    }
    // et ôtée après la dernière
    if (calm || z) fly(false);
    if (!done || show) return go();
    last = 0;
    if (!zoomed && rest === 0 && sp.t[2] === 0 && sp.v[2] < 0.001) drop();
    if (!zoomed) {
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-up');
      unback(); // @@ zoom=spin hologram.back
    }
  };
  var go = function() {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  // le retour au repos : un ressort mou, qui part en douceur
  var settle = function(delay) {
    clearTimeout(endT);
    endT = setTimeout(function() {
      endT = 0;
      sp.k = 0.01;
      sp.d = 0.06;
      sp.m = 0;
      sp.r = 1 / 60;
      sp.t[0] = sp.t[1] = sp.t[5] = sp.t[6] = 50;
      sp.t[2] = rest;
      sp.t[3] = sp.t[4] = 0;
      go();
    }, delay);
  };
  var follow = function() {
    sp.k = 0.066;
    sp.d = 0.25;
  };
  var move = function(e) {
    // un événement sans coordonnées finies (fabriqué par un script) ne dit pas où est la souris
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    if (_mjsFxHoloActive && _mjsFxHoloActive !== el) return;
    if (show) unshow();
    clearTimeout(showT);
    over  = true;
    point = [e.clientX, e.clientY];
    clearTimeout(endT);
    endT  = 0;
    follow();
    build();
    go();
  };
  var leave = function() {
    over  = false;
    point = null;
    settle(500);
  };

  // la démonstration (on: load, view)
  var demo = function() {
    if (over || zoomed || calm) return;
    build();
    sp.k = 0.02;
    sp.d = 0.5;
    show = performance.now();
    go();
  };

  // ----- la carte agrandie (zoom) -----
  var center = function() {
    var b = µ._mjs_dom.getBoundingClientRect(el);
    var w = el.offsetWidth || b.width;
    var h = el.offsetHeight || b.height;
    var view = document.documentElement;
    // le centre de la carte à sa place : celui qu'on voit, moins le déplacement en cours
    pop.t[1] = Math.round(view.clientWidth / 2 - (b.left + b.width / 2 - pop.v[1]));
    pop.t[2] = Math.round(view.clientHeight / 2 - (b.top + b.height / 2 - pop.v[2]));
    pop.t[0] = Math.min(window.innerWidth / w * 0.9, window.innerHeight / h * 0.9, 1.75);
  };
  // un téléphone qu'on penche : la carte agrandie suit, à partir de la position où on la tenait
  var orient = function(e) {
    if (!gyro) return gyro = [e.gamma || 0, e.beta || 0];
    var x = Math.min(Math.max((e.gamma || 0) - gyro[0], -16), 16);
    var y = Math.min(Math.max((e.beta || 0) - gyro[1], -18), 18);
    follow();
    sp.t[0] = (x + 16) / 32 * 100;
    sp.t[1] = (y + 18) / 36 * 100;
    sp.t[2] = 1;
    sp.t[5] = 37 + (x + 16) / 32 * 26;
    sp.t[6] = 33 + (y + 18) / 36 * 34;
    go();
  };
  var scrolled = function() {
    clearTimeout(moveT);
    moveT = setTimeout(function() {
      if (!zoomed) return;
      center();
      go();
    }, 300);
  };
  var outside = function(e) {
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(el) >= 0) return;
    // la liste des nœuds de l'événement ne montre pas l'intérieur d'une racine d'ombre fermée (un composant) : la boîte de la carte à l'écran dit si le clic est dessus
    var b = µ._mjs_dom.getBoundingClientRect(el);
    if (b.width > 0 && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) return;
    unzoom();
  };
  var key = function(e) {
    if (e.key === 'Escape' && zoomed) unzoom();
    else if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
      e.preventDefault();
      toggle();
    }
  };
  var unzoom = function() {
    if (!zoomed) return;
    zoomed = false;
    gyro   = null;
    if (_mjsFxHoloActive === el) _mjsFxHoloActive = null;
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-zoomed');
    window.removeEventListener('deviceorientation', orient, true);
    window.removeEventListener('scroll', scrolled, true);
    document.removeEventListener('pointerdown', outside, true);
    pop.m = 0;
    pop.r = 1 / 30;
    pop.t[0] = 1;
    pop.t[1] = pop.t[2] = pop.t[3] = 0;
    settle(100);
    go();
  };
  var toggle = function() {
    if (zoomed) return unzoom();
    // une seule carte agrandie : l'autre rentre
    if (_mjsFxHoloActive && _mjsFxHoloActive._mjs_fxHoloClose) _mjsFxHoloActive._mjs_fxHoloClose();
    _mjsFxHoloActive = el;
    zoomed = true;
    build();
    µ._mjs_dom.setAttribute(el, 'mjs-fx-hologram-zoomed', '');
    µ._mjs_dom.setAttribute(el, 'mjs-fx-hologram-up', '');
    pop.m = 1;
    center();
    var wait = 100;
    // @@ zoom=spin hologram.back
    // le tour : la carte tourne autour de son axe vertical en venant (360 degrés), et fait le tour dans l'autre sens en repartant ; il joue à chaque
    // zoom tant que `each` est vrai — pour qu'il ne joue qu'au premier zoom de chaque carte, `each` devient faux ; « réduire les animations » : pas de tour
    if (spin && !calm && (each || first)) {
      pop.t[3] = 360;
      wait = 1000;
      cover();
    }
    first = false;
    // @@
    settle(wait);
    // le gyroscope : seulement sur un appareil qu'on tient en main (ailleurs il ne sert à rien)
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) window.addEventListener('deviceorientation', orient, true);
    window.addEventListener('scroll', scrolled, { capture: true, passive: true });
    document.addEventListener('pointerdown', outside, true);
    go();
  };
  var hidden = function() {
    if (document.visibilityState === 'visible') return;
    // l'onglet caché : tout revient d'un coup, le calque part avec le reflet (la carte agrandie garde le sien)
    unshow();
    clearTimeout(showT);
    park();
    for (var j = 0; j < 7; j++) {
      sp.v[j] = sp.t[j];
      sp.u[j] = 0;
    }
    put();
    if (!zoomed && rest === 0) drop();
  };

  µ._mjs_dom.addEventListener(el, 'pointerenter', move, { passive: true });
  µ._mjs_dom.addEventListener(el, 'pointermove', move, { passive: true });
  µ._mjs_dom.addEventListener(el, 'pointerleave', leave, { passive: true });
  document.addEventListener('visibilitychange', hidden);
  var tab = false;
  if (s.zoom) {
    el._mjs_fxHoloClose = unzoom;
    µ._mjs_dom.addEventListener(el, 'click', toggle);
    µ._mjs_dom.addEventListener(el, 'keydown', key);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-hologram-zoom', '');
    if (!µ._mjs_dom.hasAttribute(el, 'tabindex')) {
      tab = true;
      µ._mjs_dom.setAttribute(el, 'tabindex', '0');
    }
  }
  var halt = function() {};
  if (on === 'always') {
    build();
    sp.v[2] = sp.t[2] = 1;
    put();
  }
  else if (on === 'load') showT = setTimeout(demo, 2000);
  else if (on === 'view') halt = µ._mjs_fxWhen(el, 'view', demo);

  var off = function() {
    halt();
    clearTimeout(endT);
    clearTimeout(showT);
    clearTimeout(moveT);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    fly(false);
    if (zoomed) {
      zoomed = false;
      if (_mjsFxHoloActive === el) _mjsFxHoloActive = null;
      window.removeEventListener('deviceorientation', orient, true);
      window.removeEventListener('scroll', scrolled, true);
      document.removeEventListener('pointerdown', outside, true);
    }
    µ._mjs_dom.removeEventListener(el, 'pointerenter', move);
    µ._mjs_dom.removeEventListener(el, 'pointermove', move);
    µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
    document.removeEventListener('visibilitychange', hidden);
    if (s.zoom) {
      µ._mjs_dom.removeEventListener(el, 'click', toggle);
      µ._mjs_dom.removeEventListener(el, 'keydown', key);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-zoom');
      el._mjs_fxHoloClose = null;
      if (tab) µ._mjs_dom.removeAttribute(el, 'tabindex');
    }
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-zoomed');
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-up');
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-hologram-shadow');
    unback(); // @@ zoom=spin hologram.back
    mark(false);
    drop();
    restore();
  };
  // l'intensité, la lueur et l'éclat suivent leur variable sans reposer l'effet
  off.set = function(k, v) {
    if (k === 'strength') {
      power = v !== void 0 ? v : 1;
      put();
    }
    else if (k === 'radius') {
      // retenu même sans calque : le prochain calque le prend à sa naissance
      edge = v !== void 0;
      if (!layer) return;
      if (edge) layer.setAttribute('mjs-fx-hologram-radius', '');
      else layer.removeAttribute('mjs-fx-hologram-radius');
    }
    // @@ zoom=spin hologram.back
    else if (k === 'back') {
      dorsal = v ? String(µ._mjs_fxImage ? µ._mjs_fxImage(v, el) : v) : '';
      if (dorsal && typeof Image === 'function') new Image().src = dorsal;
      if (!rear) return;
      if (dorsal) rear.style.setProperty('--mjs-fx-hologram-back', _mjsFxHoloUrl(dorsal));
      else rear.style.removeProperty('--mjs-fx-hologram-back');
    }
    // @@
    else if (k !== 'glow' && k !== 'brightness') return false;
  };
  return off;
};
// @@

// @@ hologram.dev
// l'avertissement du développement, une fois par balise : image, mask et back ne servent qu'aux styles de carte, un style simple les ignore et ne charge aucune image. Son texte est du
// groupe `dev` des libellés, que le build de production n'écrit nulle part (ni au manifeste ni dans les messages) : seul un fichier entier le porte. L'étiquette est celle d'un réglage
// `dev` que personne n'écrit, jamais `dev` seul : le filtre des styles de carte lirait un style de ce nom, et une page dont le style vient d'une variable (tous les styles) l'embarquerait.
// Le registre des composants (`µ.instances`) n'existe qu'en développement : une construction de production qui embarquerait ce fichier entier reste muette
var _mjsFxHoloTold = typeof WeakSet === 'function' ? new WeakSet() : null;
var _mjsFxHoloTell = function(el, s, style) {
  if (!µ.instances || !(s.image || s.mask || s.back)) return;
  if (_mjsFxHoloTold) {
    if (_mjsFxHoloTold.has(el)) return;
    _mjsFxHoloTold.add(el);
  }
  µ.warn(µ._mjs_msg('dev.hologramImages', { style: style }, '*hologram : image, mask et back ne servent qu\'aux styles de carte ; avec le style « {style} », ils sont ignorés et aucune image n\'est chargée'), el);
};

// @@
µ._mjs_fxDefs.hologram = {
  css: '[mjs-fx~="hologram"],:host([mjs-fx~="hologram"]){isolation:isolate}'
    + '[mjs-fx-layer="hologram"]{position:absolute;inset:0;pointer-events:none;border-radius:inherit}'
    + '[mjs-fx-layer="hologram"][mjs-fx-hologram-radius]{border-radius:var(--mjs-hologram-radius)}'
    + '[mjs-fx-hologram-simple] i,[mjs-fx-hologram-simple] b{position:absolute;inset:0;border-radius:inherit;opacity:var(--mjs-hologram-strength,.7)}'
    + '[mjs-fx-hologram-simple] i{mix-blend-mode:var(--mjs-hologram-blend,color-dodge);filter:saturate(1.4) brightness(.85);background-position:' + _mjsFxHoloX + ' ' + _mjsFxHoloY + ';background-size:' + _mjsFxHoloSz + '}'
    + '[mjs-fx-hologram-simple] b{mix-blend-mode:overlay;background:radial-gradient(circle at ' + _mjsFxHoloX + ' ' + _mjsFxHoloY + ',rgba(255,255,255,.85),transparent 45%)}'
    + '[mjs-fx-hologram-style="rainbow"] i,[mjs-fx-hologram-style="gold"] i{background-image:linear-gradient(' + _mjsFxHoloAn + ',' + _mjsFxHoloPal + ')}'
    + '[mjs-fx-hologram-style="gold"] i{filter:saturate(1.1) brightness(.95)}'
    + '[mjs-fx-hologram-style="foil"] i{background-image:repeating-linear-gradient(calc(' + _mjsFxHoloAn + ' + 90deg),transparent 0 2px,rgba(0,0,0,.5) 2px 3px),linear-gradient(' + _mjsFxHoloAn + ',' + _mjsFxHoloPal + ');background-size:auto,' + _mjsFxHoloSz + ';background-position:0 0,' + _mjsFxHoloX + ' ' + _mjsFxHoloY + '}'
    + '[mjs-fx-hologram-style="galaxy"] i{background-image:' + _mjsFxHoloStar(1.5, 20, 30) + ',' + _mjsFxHoloStar(1, 70, 20) + ',' + _mjsFxHoloStar(1.2, 40, 75) + ',' + _mjsFxHoloStar(1, 85, 65)
      + ',radial-gradient(circle at 30% 40%,var(--mjs-fx-hologram-c1),transparent 55%),radial-gradient(circle at 70% 60%,var(--mjs-fx-hologram-c2),transparent 55%),radial-gradient(circle at 50% 100%,var(--mjs-fx-hologram-c3),transparent 60%);'
      + 'background-size:70px 70px,70px 70px,70px 70px,70px 70px,' + _mjsFxHoloSz + ',' + _mjsFxHoloSz + ',' + _mjsFxHoloSz + ';'
      + 'background-position:calc(var(--mjs-fx-hologram-x,.5) * 30px) calc(var(--mjs-fx-hologram-y,.5) * 30px),calc(var(--mjs-fx-hologram-x,.5) * 30px) calc(var(--mjs-fx-hologram-y,.5) * 30px),calc(var(--mjs-fx-hologram-x,.5) * 30px) calc(var(--mjs-fx-hologram-y,.5) * 30px),calc(var(--mjs-fx-hologram-x,.5) * 30px) calc(var(--mjs-fx-hologram-y,.5) * 30px),'
      + _mjsFxHoloX + ' ' + _mjsFxHoloY + ',' + _mjsFxHoloXi + ' ' + _mjsFxHoloYi + ',50% 50%}'
    + '[mjs-fx-hologram-style="prism"] i{background-image:repeating-conic-gradient(from 0deg at 50% 50%,transparent 0 12deg,rgba(255,255,255,.22) 12deg 24deg),conic-gradient(from ' + _mjsFxHoloAn + ' at 50% 50%,' + _mjsFxHoloPal + ');background-size:' + _mjsFxHoloSz + ',' + _mjsFxHoloSz + ';background-position:' + _mjsFxHoloXi + ' ' + _mjsFxHoloYi + ',' + _mjsFxHoloX + ' ' + _mjsFxHoloY + '}'
    + '[mjs-fx-layer="hologram"][mjs-fx-hologram-hover] i,[mjs-fx-layer="hologram"][mjs-fx-hologram-hover] b{opacity:0;transition:opacity .3s ease}'
    + '[mjs-fx-layer="hologram"][mjs-fx-hologram-hover][mjs-fx-hologram-on] i,[mjs-fx-layer="hologram"][mjs-fx-hologram-hover][mjs-fx-hologram-on] b{opacity:var(--mjs-hologram-strength,.7)}'
    // @@ cards
    // les styles de carte : la balise ne se transforme que pendant le mouvement ; son ombre, sa lueur
    + '[mjs-fx~="hologram"][mjs-fx-hologram-3d]{transform:translate(var(--mjs-fx-hologram-tx,0px),var(--mjs-fx-hologram-ty,0px)) scale(var(--mjs-fx-hologram-s,1)) perspective(600px) rotateY(var(--mjs-fx-hologram-rx,0deg)) var(--mjs-fx-hologram-own,);will-change:transform}'
    + '[mjs-fx~="hologram"][mjs-fx-hologram-up]{z-index:2147483000}'
    + '[mjs-fx~="hologram"][mjs-fx-hologram-fly]{transition:box-shadow .4s ease!important}'
    + ':where([mjs-fx~="hologram"][mjs-fx-hologram-zoom]){cursor:pointer}'
    + '[mjs-fx~="hologram"][mjs-fx-hologram-zoomed]{touch-action:none}'
    // @@ zoom=spin hologram.back
    // le dos : retourné pour se lire à l'endroit, au-dessus de tout ce que la carte contient, invisible tant qu'elle montre sa face
    + '[mjs-fx-layer="hologram-back"]{position:absolute;inset:0;z-index:2147483000;pointer-events:none;visibility:hidden;border-radius:inherit;transform:scaleX(-1);background:#1d2230 var(--mjs-fx-hologram-back,none) center / cover}'
    + '[mjs-fx-layer="hologram-back"][mjs-fx-hologram-turned]{visibility:visible}'
    // @@
    // l'ombre au repos, sa transition et le curseur sont sans poids (:where) : ce qu'écrit sur la balise un autre effet (*tilt, *neon…) ou
    // son auteur les remplace, jamais l'inverse ; l'état agrandi, lui, est une marque de l'effet et garde son poids
    + ':where([mjs-fx~="hologram"][mjs-fx-hologram-shadow]){box-shadow:0 10px 20px -5px #000,0 2px 15px -5px #000;transition:box-shadow .4s ease}'
    + '[mjs-fx~="hologram"][mjs-fx-hologram-shadow][mjs-fx-hologram-zoomed],[mjs-fx~="hologram"][mjs-fx-hologram-shadow][mjs-fx-hologram-zoom]:focus-visible{box-shadow:0 0 3px -1px #fff,0 0 3px 1px hsl(47,100%,78%),0 0 12px 2px var(--mjs-hologram-glow,hsl(175, 100%, 90%)),0 10px 20px -5px #000,0 0 40px -30px var(--mjs-hologram-glow,hsl(175, 100%, 90%)),0 0 50px -20px var(--mjs-hologram-glow,hsl(175, 100%, 90%))}'
    + _mjsFxHoloSheet()
    // @@
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="hologram"] i,[mjs-fx-layer="hologram"] b{transition:none}:where([mjs-fx~="hologram"][mjs-fx-hologram-shadow]){transition:none}}',
  vars: { strength: '', size: '%', angle: 'deg', blend: '', radius: 'px', glow: '', brightness: '' },
  image: true,
  setup: function(el, s) {
    var style = s.style || 'rainbow';
    if (_MJS_FX_HOLO_CARDS[style]) return _mjsFxHoloCard(el, s, style); // @@ cards
    _mjsFxHoloTell(el, s, style); // @@ hologram.dev
    var host  = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'hologram');
    var restore = µ._mjs_fxRelative(el);
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'hologram');
    layer.setAttribute('mjs-fx-hologram-simple', '');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('mjs-fx-hologram-style', style);
    var hover = s.on === 'hover';
    if (hover) layer.setAttribute('mjs-fx-hologram-hover', '');
    if (s.radius !== void 0) layer.setAttribute('mjs-fx-hologram-radius', '');
    layer.appendChild(document.createElement('i'));
    if (s.glare !== false) layer.appendChild(document.createElement('b'));
    // la palette : refermée sur sa première couleur (le motif se répète sans couture) ; galaxy en prend trois
    var palette = function(list) {
      var l = list && list.length > 0 ? list : _MJS_FX_HOLO_PALS[style] || _MJS_FX_HOLO_PALS.rainbow;
      layer.style.setProperty('--mjs-fx-hologram-pal', l.concat(l[0]).join(', '));
      for (var k = 0; k < 3; k++) layer.style.setProperty('--mjs-fx-hologram-c' + (k + 1), l[k % l.length]);
    };
    palette(s.colors);
    // le reflet : sa place (x, y de 0 à 1) dans la balise
    var cx = 0.5;
    var cy = 0.5;
    var put = function() {
      layer.style.setProperty('--mjs-fx-hologram-x', cx.toFixed(3));
      layer.style.setProperty('--mjs-fx-hologram-y', cy.toFixed(3));
    };
    put();
    µ._mjs_dom.appendChild(host, layer);
    // une réécriture de la balise par un script a emporté le calque (et, par `innerHTML +=`, laissé sa copie figée) : le même nœud revient
    var back = function() {
      if (layer.parentNode === host) return;
      var copies = host.querySelectorAll(':scope > [mjs-fx-layer="hologram"]');
      for (var i = 0; i < copies.length; i++) copies[i].remove();
      µ._mjs_dom.appendChild(host, layer);
    };
    // un observateur des enfants de la balise (la balise seule, pas son sous-arbre) : le calque emporté revient aussitôt, sans attendre un geste ni la boucle,
    // arrêtée au repos ; débranché au retrait de l'effet
    var keep = typeof MutationObserver === 'function' ? new MutationObserver(back) : null;
    if (keep) keep.observe(host, { childList: true });
    var pt = null;
    var read = function(e) {
      var r = µ._mjs_dom.getBoundingClientRect(el);
      if (!r.width || !r.height) return null;
      return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    var enter = function(e) {
      layer.setAttribute('mjs-fx-hologram-on', '');
      move(e);
    };
    var move = function(e) {
      back();
      pt = read(e);
      // sans dérive à suivre (survol seul, ou « réduire les animations »), le reflet va droit à la souris
      if (pt && !drift) {
        cx = pt.x;
        cy = pt.y;
        put();
      }
      wake();
    };
    var leave = function() {
      pt = null;
      layer.removeAttribute('mjs-fx-hologram-on');
      wake();
    };
    var period = µ._mjs_fxMs(s.speed, 7000);
    var drift  = !hover && !µ._mjs_fxCalm();
    var frame  = 0;
    var live   = false;
    // la dérive : le reflet rejoint doucement la souris, ou la courbe qu'il suit tout seul ; arrivé, sans courbe à suivre (la souris posée, ou
    // `speed: 0`), il ne bouge plus : la boucle s'arrête, le geste suivant la relance
    var tick = function(t) {
      back();
      var tx = 0.5;
      var ty = 0.5;
      if (pt) {
        tx = pt.x;
        ty = pt.y;
      }
      else if (period > 0) {
        var a = Math.PI * 2 * t / period;
        tx = 0.5 + 0.4 * Math.sin(a);
        ty = 0.5 + 0.3 * Math.cos(a * 0.7);
      }
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      var still = (pt || !(period > 0)) && Math.abs(tx - cx) < 1e-4 && Math.abs(ty - cy) < 1e-4;
      if (still) {
        cx = tx;
        cy = ty;
      }
      put();
      frame = still ? 0 : requestAnimationFrame(tick);
    };
    var start = function() {
      live = true;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    var stop = function() {
      live = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    // un geste relance la boucle arrêtée, si la dérive tourne (à l'écran, hors `on: hover` et « réduire les animations »)
    var wake = function() {
      if (live) start();
    };
    µ._mjs_dom.addEventListener(el, 'pointerenter', enter);
    µ._mjs_dom.addEventListener(el, 'pointermove', move);
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
    var halt = drift ? µ._mjs_fxRun(el, s.on === 'view' ? 'view' : 'always', start, stop) : function() {};
    var off = function() {
      halt();
      stop();
      µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      if (keep) keep.disconnect();
      layer.remove();
      restore();
    };
    // la palette et l'arrondi suivent leur variable sans reposer l'effet
    off.set = function(k, v) {
      if (k === 'colors') palette(v);
      else if (k === 'radius') {
        if (v === void 0) layer.removeAttribute('mjs-fx-hologram-radius');
        else layer.setAttribute('mjs-fx-hologram-radius', '');
      }
      else if (k !== 'strength' && k !== 'size' && k !== 'angle' && k !== 'blend') return false;
    };
    return off;
  }
};
