// animations/pixelate — de gros carreaux à l'image nette : la balise arrive en mosaïque dont les carreaux
// rétrécissent par paliers jusqu'à l'image nette ; à la sortie, le chemin inverse jusqu'à la mosaïque la plus
// grosse ; au défilement (`on: scroll`) le palier suit l'avancée
// sur une <img>, une <video>, un <canvas> comme sur n'importe quelle balise : un filtre SVG propre à la balise,
// fait comme celui de `*filter(pixelate)` (mjs_fx_filter.ts) — un pixel d'échantillon au centre de chaque
// carreau (feFlood d'un pixel, répété par feTile), gardé de l'image par feComposite, puis étalé sur le carreau
// par feMorphology ; les bandes de bord quand le carreau ne divise pas la boîte, la construction de WebKit (qui
// lit en coordonnées de page les x/y du pixel d'échantillon et la région du filtre) et la boîte d'encre de
// WebKit y sont reprises à l'identique ; seule la taille du carreau change à chaque palier : le filtre garde
// son nœud et son id, ses primitives sont réécrites
// la balise qui attend son tour (avant son entrée, avant sa bande de défilement, au bout d'une sortie) est
// cachée (`visibility`) et ne porte rien : ni <svg>, ni filtre, ni observateur de taille ; ils naissent au
// premier palier et repartent à l'image nette, à l'attente, ou avec la balise quand elle quitte la page
// (l'observateur de taille le voit, même quand une autre transition a pris la main sur une entrée coupée)
// une seule pose par balise : celle d'une entrée coupée par la sortie (ou l'inverse) est rendue avant que
// l'autre ne pose la sienne, jamais deux filtres empilés
// deux effets à filtre sur une même balise (`*pixelate` et `*filter`, `*chromatic`, `*liquid`) se disputent la
// propriété `filter` : un avertissement dit d'en poser un sur une balise englobante
// options :
//   size     le côté d'un carreau au départ, en px (48) — jamais plus de deux fois le petit côté de la balise :
//            un carreau dont le centre sortirait d'elle la laisserait vide
//   steps    au plus ce nombre de paliers entre `size` et l'image nette (8), de progression géométrique :
//            chaque palier divise le carreau par le même facteur, jusqu'à 2 px au plus fin ; deux paliers qui
//            tombent sur le même nombre de pixels n'en font qu'un, et le temps se partage entre les paliers
//            visibles (`size: 8, steps: 40` donne les sept tailles de 8 à 2 px, `size: 2` un seul palier)
//   duration (900), delay (0), easing (ease-out)
(function() {
  var NS = 'http://www.w3.org/2000/svg';
  var count = 0;
  // le fabricant du navigateur : « Apple Computer, Inc. » dans Safari et dans tout navigateur d'iOS
  var webkit = typeof navigator === 'object' && navigator !== null && /Apple/.test(navigator.vendor || '');
  // la pose en cours de chaque balise (sa libération) : une seule à la fois
  var owner = new WeakMap();
  // une méthode de la balise prise au prototype (µ._mjs_dom, du moteur des effets) : un composant qui écrit `@getAttribute` ou
  // `@getBoundingClientRect` masque celle de sa balise ; une animation chargée sans le moteur prend celle de la balise
  var dom = function(n, name, a) {
    return µ._mjs_dom ? µ._mjs_dom[name](n, a) : n[name](a);
  };

  // la boîte d'encre de la balise dans WebKit : la région du filtre et la boîte de référence des fractions
  // englobent la bordure, l'ombre de boîte, le contour et ce qui sort des enfants ; les px dont elle dépasse la
  // boîte de bordure, de chaque côté ({ l, t, r, b }), dans le repère de la balise (avant sa transformation) :
  // le contour, l'ombre (l'étendue est le flou x 1,4 arrondi au pixel supérieur, plus l'étalement ; chaque
  // côté est cette étendue moins ou plus le décalage, arrondi au pixel supérieur) et les enfants visibles, lus
  // quand la boîte n'est que mise à l'échelle ou déplacée
  var inkOf = function(el, rect) {
    var ink = { l: 0, t: 0, r: 0, b: 0 };
    if (typeof getComputedStyle !== 'function') return ink;
    var cs  = getComputedStyle(el);
    var num = function(v) { return parseFloat(v) || 0; };
    var up  = function(l, t, r, b) {
      ink.l = Math.max(ink.l, l);
      ink.t = Math.max(ink.t, t);
      ink.r = Math.max(ink.r, r);
      ink.b = Math.max(ink.b, b);
    };
    var sup = function(v) { return Math.ceil(v - 1e-6); };
    if (cs.outlineStyle && cs.outlineStyle !== 'none' && num(cs.outlineWidth) > 0) {
      var o = num(cs.outlineWidth) + num(cs.outlineOffset);
      up(o, o, o, o);
    }
    var bs = cs.boxShadow;
    if (bs && bs !== 'none') {
      var list = bs.replace(/\([^)]*\)/g, '').split(',');
      for (var i = 0; i < list.length; i++) {
        if (/inset/.test(list[i])) continue;
        var m = (list[i].match(/-?[\d.]+(?:e-?\d+)?px/g) || []).map(num);
        if (m.length < 2) continue;
        var e = sup((m[2] || 0) * 1.4) + (m[3] || 0);
        up(e - m[0], e - m[1], e + m[0], e + m[1]);
      }
    }
    var ow = el.offsetWidth;
    var oh = el.offsetHeight;
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && (cs.contain || '').indexOf('paint') < 0 && document.createRange) {
      var sx = ow > 0 ? rect.width / ow : 1;
      var sy = oh > 0 ? rect.height / oh : 1;
      var tf = cs.transform;
      var mx = tf && tf !== 'none' ? /^matrix\(([^)]+)\)$/.exec(tf) : null;
      var sure = true;
      if (tf && tf !== 'none') {
        // matrix3d ou rotation : la boîte lue à l'écran n'est plus celle du repère de la balise
        var mv = mx ? mx[1].split(',').map(num) : null;
        sure = !!mv && Math.abs(mv[1]) < 1e-6 && Math.abs(mv[2]) < 1e-6 && Math.abs(mv[0] * ow - rect.width) < 1 && Math.abs(mv[3] * oh - rect.height) < 1;
      }
      else sure = Math.abs(rect.width - ow) < 1 && Math.abs(rect.height - oh) < 1;
      if (sure) {
        var g = document.createRange();
        g.selectNodeContents(el);
        var q = g.getBoundingClientRect();
        if (q.width || q.height) up((rect.left - q.left) / sx, (rect.top - q.top) / sy, (q.right - rect.right) / sx, (q.bottom - rect.bottom) / sy);
      }
    }
    // WebKit arrondit chaque côté de l'encre au pixel supérieur
    for (var k in ink) ink[k] = Math.max(0, sup(ink[k]));
    return ink;
  };

  // la bande d'un bord que le pixellisé ne couvre pas, `n` px au bout de l'axe `x` ou `y` d'une boîte `w` × `h` : le
  // pavé qui la touche, décalé de la largeur de la bande, n'en garde que la bande (un aplat de ses dimensions, posé au
  // bord) et passe sous le pixellisé, qui garde tout le reste tel quel ; un décalage et un aplat : sans `x`/`y` de
  // sous-région, que WebKit lit en coordonnées de page ; `ik` : ce que la boîte d'encre dépasse la balise (WebKit)
  var edge = function(src, axis, n, w, h, out, ik) {
    var x  = axis === 'x';
    var d  = x ? 'dx' : 'dy';
    var id = 'fx-e' + axis;
    var bw = w + ik.l + ik.r;
    var bh = h + ik.t + ik.b;
    return [
      '<feOffset in="' + src + '" ' + d + '="' + n + '" width="' + bw + '" height="' + bh + '" result="' + id + '"/>',
      '<feFlood flood-color="#000" width="' + (x ? n + 1 : bw) + '" height="' + (x ? bh : n + 1) + '"/>',
      '<feOffset ' + d + '="' + ((x ? w + ik.l : h + ik.t) - n) + '" width="' + bw + '" height="' + bh + '"/>',
      '<feComposite in="' + id + '" operator="in" result="' + id + 'b"/>',
      '<feMerge' + (out ? ' result="' + out + '"' : '') + '><feMergeNode in="' + id + 'b"/><feMergeNode in="' + src + '"/></feMerge>'
    ];
  };

  // les primitives du filtre pour un carreau de `s` px dans une boîte `w` × `h` : un pixel d'échantillon au
  // centre de chaque carreau, gardé de l'image par feComposite, puis étalé sur tout le carreau par feMorphology ;
  // WebKit lisant le x/y du pixel en coordonnées de page, il y naît à l'origine du carreau et feOffset le pose
  // au centre ; quand le carreau ne divise pas la boîte, le dernier de la rangée et de la colonne est partiel :
  // son centre sort de la boîte s'il fait moins que la moitié d'un carreau, et sans échantillon il restait
  // transparent — sa bande prend la couleur du carreau qui la touche
  var build = function(s, w, h, ik) {
    var c  = Math.floor(s / 2);
    var rx = w % s;
    var ry = h % s;
    var gx = rx > 0 && rx <= c;
    var gy = ry > 0 && ry <= c;
    var cp = '<feComposite width="' + s + '" height="' + s + '"/>';
    var up = webkit
      ? ['<feFlood width="1" height="1"/>', cp, '<feOffset dx="' + (c + ik.l) % s + '" dy="' + (c + ik.t) % s + '" width="' + s + '" height="' + s + '"/>', '<feTile result="fx-a"/>']
      : ['<feFlood x="' + c + '" y="' + c + '" width="1" height="1"/>', cp, '<feTile result="fx-a"/>'];
    var prims = up.concat([
      '<feComposite in="SourceGraphic" in2="fx-a" operator="in"/>',
      '<feMorphology operator="dilate" radius="' + c + '"' + (gx || gy ? ' result="fx-p"' : '') + '/>'
    ]);
    if (gx) prims = prims.concat(edge('fx-p', 'x', rx, w, h, gy ? 'fx-q' : '', ik));
    if (gy) prims = prims.concat(edge(gx ? 'fx-q' : 'fx-p', 'y', ry, w, h, '', ik));
    return prims.join('');
  };

  var make = function(opts) {
    opts = opts || {};
    var from  = opts.size != null && isFinite(opts.size) ? Math.max(2, Math.round(opts.size)) : 48;
    var steps = opts.steps != null && isFinite(opts.steps) ? Math.max(1, Math.round(opts.steps)) : 8;
    // le carreau de chaque palier, du plus gros (`size`) au plus fin (2 px au moins), par une progression
    // géométrique : chaque palier divise le carreau par le même facteur ; deux paliers voisins qui tombent sur
    // le même nombre de pixels n'en font qu'un
    var sizes = [];
    for (var j = 0; j < steps; j++) {
      var px = Math.max(2, Math.round(Math.pow(from, 1 - j / steps)));
      if (px !== sizes[sizes.length - 1]) sizes.push(px);
    }
    var levels = sizes.length;

    var setup = function(node) {
      var holder  = null;
      var watch   = null;
      var saved   = null;
      var base    = '';
      var applied = false;
      var hidden  = null;
      var fresh   = false;
      var box     = null;
      var last    = '';
      var shown   = null;
      var tile    = 0;
      var id      = 'mjs-px-' + (++count);
      // les mesures de la balise, lues une fois à la pose du filtre (puis quand elle change de taille)
      var measure = function() {
        var rect = dom(node, 'getBoundingClientRect');
        var b    = { w: node.offsetWidth || Math.round(rect.width) || 0, h: node.offsetHeight || Math.round(rect.height) || 0, ink: { l: 0, t: 0, r: 0, b: 0 } };
        if (webkit) b.ink = inkOf(node, rect);
        return b;
      };
      var paint = function() {
        var s = Math.min(tile, Math.max(2, 2 * Math.min(box.w, box.h) - 1));
        var p = build(s, box.w, box.h, box.ink);
        if (p === last) return;
        last = p;
        holder.filter.innerHTML = p;
      };
      // la balise est à nous : la pose d'une autre transition pixelate (entrée coupée par la sortie, ou
      // l'inverse) est rendue d'abord, sans quoi les deux filtres s'empileraient et le <svg> du premier resterait ;
      // le crochet de libération est celui du moteur pour les remplissages d'une sortie : le bloc l'appelle
      // quand le groupe de sortie a fini, que la balise soit retirée ou ressuscitée
      var begin = function() {
        var other = owner.get(node);
        if (other === release) return;
        if (other) other();
        owner.set(node, release);
        node._mjs_pendingFillRelease = release;
        fresh = !dom(node, 'hasAttribute', 'style');
      };
      var put = function() {
        var cs;
        begin();
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        var f = document.createElementNS(NS, 'filter');
        f.setAttribute('id', id);
        f.setAttribute('color-interpolation-filters', 'sRGB');
        f.setAttribute('x', '0');
        f.setAttribute('y', '0');
        f.setAttribute('width', '1');
        f.setAttribute('height', '1');
        // jamais retiré : WebKit ne relit pas un attribut retiré, le défaut est posé en toutes lettres
        f.setAttribute('primitiveUnits', 'userSpaceOnUse');
        svg.appendChild(f);
        // le <svg> va dans la même racine que la balise : un `url(#…)` ne sort jamais de son shadow root
        var root = node.getRootNode ? dom(node, 'getRootNode') : document;
        (root.nodeType === 11 ? root : document.body).appendChild(svg);
        holder = { svg: svg, filter: f };
        box    = measure();
        saved  = [node.style.getPropertyValue('filter'), node.style.getPropertyPriority('filter')];
        cs     = typeof getComputedStyle === 'function' ? getComputedStyle(node).filter : '';
        base   = cs && cs !== 'none' ? cs + ' ' : '';
        // deux effets à filtre sur la même balise : le dernier posé gagne, l'autre est perdu
        var others = (dom(node, 'getAttribute', 'mjs-fx') || '').split(' ');
        if (!node._mjs_fxFilterWarn && (others.indexOf('filter') >= 0 || others.indexOf('chromatic') >= 0 || others.indexOf('liquid') >= 0)) {
          node._mjs_fxFilterWarn = true;
          µ.warn(µ._mjs_msg('pixelateFilter', null, '*pixelate : la balise porte déjà un autre effet à filtre (*filter, *chromatic ou *liquid) : les deux se disputent la propriété CSS filter. Posez l\'un des deux sur une balise englobante.'));
        }
        // la taille de la balise compte (les bandes de bord) : le filtre est refait quand elle change ; une balise
        // retirée de la page n'a plus de taille, c'est la seule façon de rendre le <svg> d'une entrée coupée par
        // une transition qui a pris le crochet de libération (un fondu) ou qui n'en avait pas (pas de sortie)
        if (typeof ResizeObserver === 'function') {
          watch = new ResizeObserver(function() {
            if (!node.isConnected) {
              release();
              return;
            }
            if (node.offsetWidth === box.w && node.offsetHeight === box.h) return;
            box = measure();
            paint();
          });
          watch.observe(node);
        }
      };
      // la visibilité d'avant rendue : la balise se montre
      var appear = function() {
        if (hidden === null) return;
        if (hidden === '') node.style.removeProperty('visibility');
        else node.style.setProperty('visibility', hidden);
        hidden = null;
      };
      // le palier à l'écran : le filtre se pose au premier, et seule la taille du carreau change ensuite
      var show = function(s) {
        if (!node.isConnected) return false;
        tile = s;
        if (!holder) put();
        paint();
        if (!applied) {
          node.style.setProperty('filter', base + 'url(#' + id + ')');
          applied = true;
        }
        appear();
        return true;
      };
      // le filtre et son <svg> rendus, l'observateur avec (le style d'abord : la balise ne référence plus le
      // filtre quand il disparaît)
      var drop = function() {
        if (applied) {
          if (saved[0] === '') node.style.removeProperty('filter');
          else node.style.setProperty('filter', saved[0], saved[1]);
          applied = false;
        }
        if (holder) {
          holder.svg.remove();
          holder = null;
        }
        if (watch) watch.disconnect();
        watch = null;
        last  = '';
      };
      // la balise attend son tour : plus de filtre, cachée ; sans cela l'image nette se verrait avant le
      // premier palier
      var wait = function() {
        drop();
        if (hidden !== null) return;
        begin();
        hidden = node.style.getPropertyValue('visibility');
        node.style.setProperty('visibility', 'hidden');
      };
      // plus rien de nous sur la balise : l'image nette, sa visibilité et son attribut style d'avant
      var finish = function() {
        drop();
        appear();
        if (fresh && dom(node, 'getAttribute', 'style') === '') dom(node, 'removeAttribute', 'style');
        if (owner.get(node) === release) owner.delete(node);
        if (node._mjs_pendingFillRelease === release) node._mjs_pendingFillRelease = null;
      };
      // la balise retirée du DOM, ressuscitée ou reprise par une autre pose, ou l'effet retiré : tout part
      var release = function() {
        finish();
        shown = null;
        node._mjs_fxFilterWarn = false;
      };
      return {
        delay: opts.delay != null ? opts.delay : 0,
        duration: opts.duration != null ? opts.duration : 900,
        easing: µ.easing.resolve(opts.easing != null ? opts.easing : 'ease-out'),
        // t = 0 : la balise attend son tour ; au-dessus, le palier de t (le plus gros juste après 0) ; t = 1 : l'image nette
        tick: function(t) {
          var k = t >= 1 ? levels : t > 0 ? Math.min(levels - 1, Math.floor(t * levels)) : -1;
          if (k === shown) return;
          // une balise pas encore (ou plus) dans la page ne montre rien : le palier reste à poser
          if (k >= levels) finish();
          else if (k < 0) wait();
          else if (!show(sizes[k])) return;
          shown = k;
        },
        // l'effet arrêté en plein jeu (retiré, relancé) : la balise retrouve son style
        cleanup: release
      };
    };
    setup._isCfgFactory = true;
    return { intro: setup, outro: setup };
  };
  return make;
})();
