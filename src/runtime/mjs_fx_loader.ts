// mjs_fx_loader — `*loader(style)` : un indicateur de chargement dessiné dans la balise (vide, de
// préférence : `<span *loader(bloom)></span>`), dans le composant si la balise en est un. Les
// styles, repris du dossier d'animations :
//   steps  : un cadre pointillé qui bascule par quarts, un carré qui se replie dedans
//   plus   : une croix lumineuse dont les bras pivotent autour du centre
//   neon   : un arc de néon qui s'ouvre et se referme en glissant
//   dots   : un anneau de billes lumineuses qui s'éteignent tour à tour
//   trio   : trois anneaux de couleur qui se poursuivent
//   3d     : un anneau en dégradé, creusé dans une dalle en relief
//   bloom  : une fleur de carrés qui plongent vers le centre
//   spiral, galaxy, cross : des points lumineux qui filent le long de rayons — une spirale,
//            quatre bras, une croix
//   vortex : vingt points qui naissent grands, flous et transparents, font un tour complet en
//            se rapprochant du centre et en rapetissant, deviennent nets puis s'effacent ; ils
//            partent l'un après l'autre (un vingtième du cycle d'écart) : une file qui s'enroule
// Réglages : style (dots), color (la couleur ; celle du style), color2 (la seconde couleur du
// dégradé de 3d ; #e91e63), size (la taille en px ; 96), speed (un cycle ; celui du style, 4s pour vortex).
// Chaque style est dessiné à sa taille d'origine puis réduit à `size`. Le dessin est muet ; la balise
// dit aux lecteurs d'écran qu'un chargement est en cours : une région `role="status"` (sauf un rôle écrit)
// dont le texte, réservé aux lecteurs d'écran, arrive une image après elle — « Chargement » dans la langue
// affichée, ou l'`aria-label` écrit ; une région vivante dit ce qui change en elle, pas son nom. Elle
// retrouve ses attributs au retrait. Une balise qui a son propre rôle (un bouton, un lien, un titre… : autre
// chose qu'un div, un span ou un composant) le garde : la région est alors le texte posé dans le dessin, et
// dit « Chargement » (l'`aria-label` de la balise est son nom, pas celui du chargement).

(function() {
  var L   = '[mjs-fx-layer="loader"]';
  var S   = function(x) { return L + '[mjs-fx-loader-style="' + x + '"]'; };
  var P   = function(x, p) { return S(x) + ' [mjs-fx-p="' + p + '"]'; };
  var glow = function(n) { return n.map(function(r) { return '0 0 ' + r + 'px var(--mjs-fx-loader-c)'; }).join(','); };
  // couleur et cycle de chaque style : le réglage, sinon ceux de la démo d'origine
  var base = function(x, c, t) { return S(x) + '{--mjs-fx-loader-c:var(--mjs-loader-color,' + c + ');--mjs-fx-loader-t:var(--mjs-loader-speed,' + t + ')}'; };
  var ray  = function(x) { return P(x, 'ray') + '{position:absolute;top:0;left:-200px;width:200px;height:2px;transform-origin:right;transform:rotate(calc(18deg * var(--i)))}'
    + P(x, 'ray') + '::before{content:"";position:absolute;width:15px;height:15px;border-radius:50%;background:var(--mjs-fx-loader-c);box-shadow:' + glow([10, 20, 40, 60, 80, 100]) + ';animation:mjs-fx-loader-ray var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.05 * var(--i)) infinite}'; };

  var css = L + '{display:inline-block;position:relative;vertical-align:middle;pointer-events:none}'
    // le texte des lecteurs d'écran : hors de la mise en page, rien de peint
    + L + ' [mjs-fx-loader-said]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'
    + L + ' [mjs-fx-loader-box]{position:absolute;left:0;top:0;transform-origin:0 0}'
    + L + ' [mjs-fx-p]{box-sizing:border-box}'
    + base('steps', '#0f0', '2s') + base('plus', '#03e9f4', '2s') + base('neon', '#25e6ff', '2s')
    + base('dots', '#00efff', '1s') + base('trio', '#00ff99', '3s') + base('3d', '#2196f3', '2s') + base('bloom', '#00ffc8', '5s')
    + base('spiral', '#00ebff', '2s') + base('galaxy', '#00ebff', '2s') + base('cross', '#00ebff', '2s') + base('vortex', '#25e2bc', '4s')
    // steps
    + P('steps', 'frame') + '{position:absolute;left:10px;top:10px;width:300px;height:300px;animation:mjs-fx-loader-steps calc(var(--mjs-fx-loader-t) * 4) steps(4) infinite}'
    + P('steps', 'frame') + '::before{content:"";position:absolute;inset:-5px;border:2px dashed var(--mjs-fx-loader-c)}'
    + P('steps', 'fold') + '{position:absolute;bottom:0;left:0;width:150px;height:150px;border:4px solid var(--mjs-fx-loader-c);transform-origin:bottom right;animation:mjs-fx-loader-fold var(--mjs-fx-loader-t) ease-in infinite}'
    + '@keyframes mjs-fx-loader-steps{0%{transform:rotate(360deg)}100%{transform:rotate(0deg)}}'
    + '@keyframes mjs-fx-loader-fold{0%{transform:rotate(0deg)}50%,100%{transform:rotate(90deg)}}'
    // plus
    + P('plus', 'core') + '{position:absolute;left:150px;top:150px;width:150px;height:150px;background:var(--mjs-fx-loader-c);box-shadow:' + glow([5, 25, 50, 200]) + '}'
    + P('plus', 'arm') + '{position:absolute;top:-100%;left:0;width:100%;height:100%;border:4px solid var(--mjs-fx-loader-c);background:var(--mjs-fx-loader-c);box-shadow:' + glow([5, 25, 50]) + ';transform-origin:bottom right;animation:mjs-fx-loader-plus var(--mjs-fx-loader-t) ease-in-out infinite}'
    + P('plus', 'arm') + '[mjs-fx-k="2"]{transform-origin:top left;top:100%;left:0}'
    + P('plus', 'arm') + '[mjs-fx-k="3"]{transform-origin:bottom left;top:0;left:100%}'
    + P('plus', 'arm') + '[mjs-fx-k="4"]{transform-origin:top right;top:0;left:-100%}'
    + '@keyframes mjs-fx-loader-plus{0%{transform:rotate(0deg)}50%,100%{transform:rotate(180deg)}}'
    // neon : trois copies superposées, la 2e et la 3e floutées font le halo
    + P('neon', 'box') + '{position:absolute;left:25px;top:55px;width:150px;display:flex;justify-content:center}'
    + P('neon', 'box') + '[mjs-fx-k="2"]{filter:blur(10px)}'
    + P('neon', 'box') + '[mjs-fx-k="3"]{filter:blur(20px)}'
    + P('neon', 'mover') + '{animation:mjs-fx-loader-slide var(--mjs-fx-loader-t) linear infinite}'
    + S('neon') + ' svg{display:block;position:relative;width:90px;height:90px;overflow:visible;animation:mjs-fx-loader-flip var(--mjs-fx-loader-t) ease-in-out infinite}'
    + S('neon') + ' circle{fill:none;stroke-width:10;stroke:var(--mjs-fx-loader-c);stroke-linecap:round;transform:translate(5px,5px);stroke-dasharray:250;stroke-dashoffset:249;animation:mjs-fx-loader-dash var(--mjs-fx-loader-t) ease-in-out infinite}'
    + '@keyframes mjs-fx-loader-slide{0%{transform:rotate(180deg) translateX(-40px)}100%{transform:rotate(180deg) translateX(40px)}}'
    + '@keyframes mjs-fx-loader-flip{0%{transform:rotateY(0deg)}50%{transform:rotateY(0deg)}50.001%,100%{transform:rotateY(180deg)}}'
    + '@keyframes mjs-fx-loader-dash{0%,2%{stroke-dashoffset:249}50%{stroke-dashoffset:125}98%,100%{stroke-dashoffset:249}}'
    // dots
    + P('dots', 'arm') + '{position:absolute;left:50px;top:50px;width:200px;height:200px;transform:rotate(calc(18deg * var(--i)))}'
    + P('dots', 'arm') + '::before{content:"";position:absolute;top:0;left:0;width:30px;height:30px;border-radius:50%;background:var(--mjs-fx-loader-c);box-shadow:' + glow([20, 40, 80, 160]) + ';animation:mjs-fx-loader-dots var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.1 * var(--i)) infinite}'
    + '@keyframes mjs-fx-loader-dots{0%{transform:scale(1)}80%,100%{transform:scale(0)}}'
    // trio : l'anneau est creusé par un masque (la démo le couvrait d'un disque noir)
    + P('trio', 'ring') + '{position:absolute;left:20px;top:20px;width:200px;height:200px;border-radius:50%;animation:mjs-fx-loader-spin var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * var(--i) / -3) infinite}'
    + P('trio', 'ring') + '[mjs-fx-k="1"]{filter:hue-rotate(290deg)}'
    + P('trio', 'ring') + '[mjs-fx-k="2"]{filter:hue-rotate(240deg)}'
    + P('trio', 'ring') + '::before{content:"";position:absolute;top:0;left:0;width:50%;height:100%;background:linear-gradient(to top,transparent,transparent,color-mix(in srgb,var(--mjs-fx-loader-c) 33%,transparent));background-size:100px 180px;background-repeat:no-repeat;border-top-left-radius:100px;border-bottom-left-radius:100px;-webkit-mask:radial-gradient(circle at 100% 50%,transparent 79px,#000 80px);mask:radial-gradient(circle at 100% 50%,transparent 79px,#000 80px)}'
    + P('trio', 'head') + '{position:absolute;top:0;left:50%;transform:translateX(-50%);width:20px;height:20px;background:var(--mjs-fx-loader-c);border-radius:50%;box-shadow:' + glow([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) + '}'
    + '@keyframes mjs-fx-loader-spin{to{transform:rotate(360deg)}}'
    // 3d
    + P('3d', 'slab') + '{position:absolute;left:0;top:0;width:300px;height:300px;background:#c9d5e0;border-radius:50px;box-shadow:30px 30px 30px -10px rgba(0,0,0,.15),inset 15px 15px 10px rgba(255,255,255,.75),-15px -15px 35px rgba(255,255,255,.55),inset -1px -1px 10px rgba(0,0,0,.2)}'
    + P('3d', 'hole') + '{position:absolute;inset:35px;background:#acbaca;border-radius:50%;box-shadow:5px 5px 15px 0 #152b4a66,inset 5px 5px 5px rgba(255,255,255,.55),-6px -6px 10px #fff}'
    + P('3d', 'hole') + '::before{content:"";position:absolute;inset:4px;background:linear-gradient(var(--mjs-fx-loader-c),var(--mjs-loader-color2,#e91e63));border-radius:50%;animation:mjs-fx-loader-spin var(--mjs-fx-loader-t) linear infinite}'
    + P('3d', 'hole') + '::after{content:"";position:absolute;inset:35px;background:#acbaca;border-radius:50%}'
    + P('3d', 'glow') + '{position:absolute;inset:4px;background:linear-gradient(var(--mjs-fx-loader-c),var(--mjs-loader-color2,#e91e63));border-radius:50%;animation:mjs-fx-loader-spin var(--mjs-fx-loader-t) linear infinite;filter:blur(20px);z-index:1;mix-blend-mode:plus-lighter}'
    + P('3d', 'glow') + '::before{content:"";position:absolute;inset:40px;background:#bdcbdb;border-radius:50%;animation:mjs-fx-loader-spin var(--mjs-fx-loader-t) linear infinite}'
    // bloom
    + P('bloom', 'petal') + '{position:absolute;left:310px;top:310px;transform:rotate(calc(45deg * var(--j)))}'
    + P('bloom', 'sq') + '{position:absolute;transform:rotate(calc(18deg * var(--i)))}'
    + P('bloom', 'sq') + '::before{content:"";position:absolute;width:15px;height:15px;border:2px solid var(--mjs-fx-loader-c);border-radius:2px;animation:mjs-fx-loader-bloom var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.1 * var(--i)) infinite}'
    + '@keyframes mjs-fx-loader-bloom{0%{transform:translateX(250px) scale(4);opacity:0}50%{opacity:1}100%{transform:translateX(-10px) scale(0)}}'
    // spirales
    + P('spiral', 'arm') + '{position:absolute;left:230px;top:230px}'
    + P('galaxy', 'arm') + '{position:absolute;left:230px;top:230px;transform:rotate(calc(90deg * var(--j)))}'
    + P('cross', 'arm') + '{position:absolute;left:320px;top:320px;transform:rotate(calc(90deg * var(--j))) scale(.75)}'
    + ray('spiral') + ray('galaxy') + ray('cross')
    + P('cross', 'ray') + '{left:0}'
    + '@keyframes mjs-fx-loader-ray{0%{transform:translateX(200px) scale(1);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translateX(0px) scale(0);opacity:0}}'
    // vortex : chaque point tourne autour du centre du dessin (son transform-origin) en rapetissant — son orbite aussi
    // (50 px d'orbite à l'échelle 1 : 150 au départ, 25 à l'arrivée) — et part un vingtième de cycle après le précédent.
    // Le flou qui se résorbe ne s'anime pas (un `filter` animé refait le style et la peinture des vingt points à chaque
    // image, en boucle) : le point porte deux disques, l'un flou et fixe (::before), l'autre net (::after), en fondu
    // enchaîné d'opacité pendant la première moitié du cycle ; `plus-lighter` les additionne, la somme des deux opacités
    // vaut 1 : le mélange est exact, sans creux. Tout passe par `transform` et `opacity`, menés par la carte graphique.
    + P('vortex', 'dot') + '{position:absolute;left:235px;top:185px;width:30px;height:30px;isolation:isolate;transform-origin:-35px 15px;animation:mjs-fx-loader-vortex var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.05 * var(--i)) infinite}'
    + P('vortex', 'dot') + '::before,' + P('vortex', 'dot') + '::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--mjs-fx-loader-c)}'
    + P('vortex', 'dot') + '::before{filter:blur(3px);animation:mjs-fx-loader-vortex-soft var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.05 * var(--i)) infinite}'
    + P('vortex', 'dot') + '::after{mix-blend-mode:plus-lighter;animation:mjs-fx-loader-vortex-sharp var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.05 * var(--i)) infinite}'
    + '@keyframes mjs-fx-loader-vortex{0%{transform:rotate(0deg) scale(3);opacity:0}50%{opacity:1}100%{transform:rotate(360deg) scale(.5);opacity:0}}'
    + '@keyframes mjs-fx-loader-vortex-soft{0%{opacity:1}50%,100%{opacity:0}}'
    + '@keyframes mjs-fx-loader-vortex-sharp{0%{opacity:0}50%,100%{opacity:1}}'
    // « réduire les animations » : le loader se fige (il reste visible, il dit toujours « ça charge ») ; le point de
    // vortex et ses deux disques ont leur propre règle, aussi précise que leur animation, sans quoi leur `animation:` l'emporterait
    + '@media (prefers-reduced-motion:reduce){' + L + ' [mjs-fx-p]{animation-play-state:paused}' + L + ' [mjs-fx-p]::before{animation-play-state:paused}' + L + ' [mjs-fx-p]::after{animation-play-state:paused}' + L + ' svg{animation-play-state:paused}' + L + ' circle{animation-play-state:paused}' + P('vortex', 'dot') + '{animation-play-state:paused}' + P('vortex', 'dot') + '::before,' + P('vortex', 'dot') + '::after{animation-play-state:paused}}';

  // taille d'origine de chaque style (px), et son dessin
  var NATIVE = { steps: 320, plus: 450, neon: 200, dots: 300, trio: 240, '3d': 300, bloom: 620, spiral: 460, galaxy: 460, cross: 640, vortex: 400 };
  var part = function(parent, p, k, vars) {
    var s = document.createElement('span');
    s.setAttribute('mjs-fx-p', p);
    if (k !== void 0) s.setAttribute('mjs-fx-k', String(k));
    for (var v in vars || {}) s.style.setProperty(v, String(vars[v]));
    parent.appendChild(s);
    return s;
  };
  var SVG = 'http://www.w3.org/2000/svg';
  var draw = {
    steps: function(b) { part(part(b, 'frame'), 'fold'); },
    plus: function(b) {
      var core = part(b, 'core');
      for (var k = 1; k <= 4; k++) part(core, 'arm', k);
    },
    neon: function(b) {
      for (var k = 1; k <= 3; k++) {
        var mover = part(part(b, 'box', k), 'mover');
        var svg   = document.createElementNS(SVG, 'svg');
        var c     = document.createElementNS(SVG, 'circle');
        c.setAttribute('cx', '40');
        c.setAttribute('cy', '40');
        c.setAttribute('r', '40');
        svg.appendChild(c);
        mover.appendChild(svg);
      }
    },
    dots: function(b) { for (var i = 1; i <= 20; i++) part(b, 'arm', void 0, { '--i': i }); },
    vortex: function(b) { for (var i = 1; i <= 20; i++) part(b, 'dot', void 0, { '--i': i }); },
    trio: function(b) { for (var k = 0; k < 3; k++) part(part(b, 'ring', k, { '--i': k }), 'head'); },
    '3d': function(b) {
      part(part(part(b, 'slab'), 'hole'), 'glow');
    },
    bloom: function(b) {
      for (var j = 0; j < 4; j++) {
        var petal = part(b, 'petal', void 0, { '--j': j });
        for (var i = 1; i <= 20; i++) part(petal, 'sq', void 0, { '--i': i });
      }
    },
    spiral: function(b, n) {
      for (var j = 0; j < (n || 1); j++) {
        var arm = part(b, 'arm', void 0, { '--j': j });
        for (var i = 1; i <= 20; i++) part(arm, 'ray', void 0, { '--i': i });
      }
    }
  };
  draw.galaxy = function(b) { draw.spiral(b, 4); };
  draw.cross  = draw.galaxy;

  µ._mjs_fxDefs.loader = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    css: css,
    vars: { color: '', color2: '', speed: '' },
    setup: function(el, s) {
      var style = NATIVE[s.style] ? s.style : 'dots';
      var size  = s.size || 96;
      var host  = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'loader');
      var layer = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', 'loader');
      layer.setAttribute('mjs-fx-loader-style', style);
      layer.style.width  = size + 'px';
      layer.style.height = size + 'px';
      var box = document.createElement('span');
      box.setAttribute('mjs-fx-loader-box', '');
      box.setAttribute('aria-hidden', 'true');
      box.style.width     = NATIVE[style] + 'px';
      box.style.height    = NATIVE[style] + 'px';
      box.style.transform = 'scale(' + (size / NATIVE[style]).toFixed(4) + ')';
      draw[style](box);
      layer.appendChild(box);
      µ._mjs_dom.appendChild(host, layer);
      // la balise, elle, s'annonce : la région d'abord, vide, son texte une image après (posés ensemble, plusieurs
      // lecteurs d'écran ne disent rien)
      var role  = µ._mjs_dom.getAttribute(el, 'role');
      var own   = role === null && !/^(?:div|span)$/.test(el.localName) && el.localName.indexOf('-') < 0;
      var dit   = own ? null : µ._mjs_dom.getAttribute(el, 'aria-label');
      var frame = 0;
      var said  = null;
      if (role === null && !own) µ._mjs_dom.setAttribute(el, 'role', 'status');
      // « Chargement » dans la langue de la page : récrit à l'arrivée du fichier de la langue s'il le surcharge (une image après la
      // région, comme à la pose, si son texte n'y est pas encore)
      if (dit === null) {
        µ._mjs_fxLabelKeep(function() {
          dit = µ._mjs_fxLabel('loading');
          if (said && !frame) said.textContent = dit;
        });
      }
      if (dit) {
        said = document.createElement('span');
        said.setAttribute('mjs-fx-loader-said', '');
        if (own) said.setAttribute('role', 'status');
        layer.appendChild(said);
        frame = requestAnimationFrame(function() {
          frame = requestAnimationFrame(function() {
            frame = 0;
            said.textContent = dit;
          });
        });
      }
      return function() {
        if (frame) cancelAnimationFrame(frame);
        layer.remove();
        if (role === null && !own) µ._mjs_dom.removeAttribute(el, 'role');
      };
    }
  };
})();
