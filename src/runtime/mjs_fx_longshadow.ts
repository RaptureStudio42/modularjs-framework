// mjs_fx_longshadow — `*longshadow` : une longue ombre portée derrière le texte, faite de copies
// décalées. Elle fuit la souris (la lampe), ou tombe dans une direction fixe. Réglages : color
// (l'ombre ; #212121), follow (pointer : l'ombre fuit le pointeur, sa longueur suit la distance ;
// fixed : une direction fixe), angle (la direction de l'ombre fixe, en degrés : 0 à droite, 90 en
// bas ; 45), length (la longueur de l'ombre fixe, la plus grande qui suit le pointeur, en px ;
// 200), fade (l'ombre s'efface en s'éloignant ; oui), light (une lampe lumineuse suit la souris
// quand elle passe près de la balise, comme la démo ; non). La lampe reste dans la zone de la
// balise : son premier ancêtre qui rogne son contenu (overflow, contain: paint, clip-path) et qui la
// contient vraiment — une balise `fixed` n'a que ce qui la retient (une transformation, un filtre, un
// confinement…), une balise `absolute` que son bloc conteneur et ceux qui le contiennent —, la fenêtre
// sans lui ; elle ne s'allume que pour un
// pointeur dans la zone, et son halo s'arrête au bord de la zone, coins arrondis suivis. « Réduire
// les animations » : l'ombre fixe, sans lampe.

// le parent d'un nœud, un shadow root traversé par son hôte
function _mjsFxLongshadowUp(n) {
  return n.parentElement || (n.parentNode && n.parentNode.host) || null;
}

// les ancêtres dont la découpe atteint vraiment une balise, du plus proche au plus lointain, les shadow
// roots traversés par leur hôte ; <html> et <body> n'en sont pas (leur overflow passe à la fenêtre) et un
// ancêtre sans boîte (display: contents) ne découpe rien. Une balise `fixed` n'est découpée que par ce qui
// la retient (une transformation, un filtre, un confinement…), une balise `absolute` par son bloc conteneur (le
// premier ancêtre positionné, ou qui la retient) et par ceux qui le contiennent — les ancêtres d'entre elle et lui
// ne la touchent pas ; la même règle, de proche en proche, pour chaque ancêtre `absolute` ou `fixed` rencontré
function _mjsFxLongshadowReach(el) {
  var out = [];
  var pos = getComputedStyle(el).position;
  for (var n = _mjsFxLongshadowUp(el); n && n !== document.body && n !== document.documentElement; n = _mjsFxLongshadowUp(n)) {
    var cs = getComputedStyle(n);
    if (cs.display === 'contents') continue;
    if ((pos === 'fixed' || pos === 'absolute') && !(µ._mjs_fxHoldsFixed(cs) || (pos === 'absolute' && cs.position !== 'static'))) continue;
    out.push(n);
    pos = cs.position;
  }
  return out;
}

// la zone de la balise : son premier ancêtre qui la contient vraiment (ci-dessus) et rogne son contenu
// — overflow autre que visible, contain qui contient paint (ou l'un de ses raccourcis, strict et
// content), clip-path. Sans zone : null, la fenêtre
function _mjsFxLongshadowZone(el) {
  var reach = _mjsFxLongshadowReach(el);
  for (var i = 0; i < reach.length; i++) {
    var cs = getComputedStyle(reach[i]);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain) || (cs.clipPath && cs.clipPath !== 'none')) return reach[i];
  }
  return null;
}

// le rectangle où la lampe peut briller, dans la fenêtre : le bord intérieur de la zone (hors
// bordure et barres de défilement, à l'échelle où la zone est vue) et ses quatre arrondis ; la
// fenêtre entière sans zone
function _mjsFxLongshadowRect(p) {
  if (!p) return { x: 0, y: 0, w: innerWidth, h: innerHeight, r: ['', '', '', ''] };
  var b  = p.getBoundingClientRect();
  var cs = getComputedStyle(p);
  var r  = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
  // une balise en ligne ou un élément SVG n'a ni clientWidth ni clientHeight : sa boîte entière
  if (!p.clientWidth && !p.clientHeight) return { x: b.left, y: b.top, w: b.width, h: b.height, r: r };
  var k = p.offsetWidth ? b.width / p.offsetWidth : 1;
  return { x: b.left + p.clientLeft * k, y: b.top + p.clientTop * k, w: p.clientWidth * k, h: p.clientHeight * k, r: r };
}

// les racines où écouter le défilement : le document, et chaque shadow root de la balise à la page (un
// `scroll` ne sort pas de son shadow root)
function _mjsFxLongshadowRoots(el) {
  var out = [document];
  for (var r = µ._mjs_dom.getRootNode(el); r && r.host; r = µ._mjs_dom.getRootNode(r.host)) out.push(r);
  return out;
}

µ._mjs_fxDefs.longshadow = {
  css: '[mjs-fx~="longshadow"]{text-shadow:var(--mjs-fx-longshadow,none)}'
    + '[mjs-fx-longshadow-window]{position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;z-index:2147483646}'
    + '[mjs-fx-longshadow-light]{position:absolute;left:0;top:0;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:#fff;box-shadow:0 0 15px #fff,0 0 50px #fff,0 0 100px #fff,0 0 200px #fff;pointer-events:none}',
  vars: {},
  setup: function(el, s) {
    var N   = 200;
    // longueur visible : avec l'effacement, seule la première moitié des copies se voit
    var tot = (s.length === void 0 ? 200 : s.length) * (s.fade === false ? 1 : 2);
    var rgb = null;
    var a0  = 1;
    // la couleur en rouge, vert, bleu et sa transparence, pour doser celle de chaque copie : lue DANS
    // la balise (currentColor, une variable du composant s'y résolvent), par une sonde marquée calque
    // que les effets de texte ne prennent pas pour du texte
    var probe = document.createElement('span');
    probe.setAttribute('mjs-fx-layer', 'probe');
    probe.style.color = s.color || '#212121';
    var read = typeof getComputedStyle === 'function';
    // un repère que la balise pose et que seule une sonde de l'arbre aplati hérite : un composant sans
    // <slot> n'affiche pas ses enfants clairs, la sonde y lirait la couleur par défaut, noire — et la
    // boîte ne dit rien, la page n'étant pas encore affichée à la pose. Dans le shadow root du composant,
    // elle hérite de la balise comme son texte ; sans shadow root à notre portée, la couleur reste à CSS
    // (color-mix, plus bas)
    el.style.setProperty('--mjs-fx-longshadow-in', '1');
    µ._mjs_dom.appendChild(el, probe);
    if (read && getComputedStyle(probe).getPropertyValue('--mjs-fx-longshadow-in').trim() !== '1') {
      var inner = µ._mjs_fxInner(el);
      if (inner) inner.appendChild(probe);
      else read = false;
    }
    el.style.removeProperty('--mjs-fx-longshadow-in');
    var m = read ? /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+)(%?))?/.exec(getComputedStyle(probe).color) : null;
    probe.remove();
    if (m) {
      rgb = m[1] + ',' + m[2] + ',' + m[3];
      if (m[4] !== void 0) a0 = parseFloat(m[4]) / (m[5] ? 100 : 1);
    }
    var tint = function(a) { return rgb ? 'rgba(' + rgb + ',' + (a * a0).toFixed(3) + ')' : 'color-mix(in srgb,' + (s.color || '#212121') + ' ' + Math.round(a * 100) + '%,transparent)'; };
    var paint = function(dx, dy) {
      var out = [];
      for (var i = 0; i < N; i++) {
        var a = s.fade === false ? 1 : Math.max(0, 1 - i / (N / 2));
        if (a === 0) break;
        out.push((dx * i / N).toFixed(1) + 'px ' + (dy * i / N).toFixed(1) + 'px 0 ' + tint(a));
      }
      el.style.setProperty('--mjs-fx-longshadow', out.join(','));
    };
    // une direction fixe : réglée (`follow: fixed`), ou « réduire les animations » (l'ombre ne suit
    // pas la souris, pas de lampe)
    if (s.follow === 'fixed' || µ._mjs_fxCalm()) {
      var r = (typeof s.angle === 'number' ? s.angle : 45) * Math.PI / 180;
      paint(Math.cos(r) * tot, Math.sin(r) * tot);
      return function() { el.style.removeProperty('--mjs-fx-longshadow'); };
    }
    var pane   = null;
    var lamp   = null;
    var roots  = [];
    var frame  = 0;
    var last   = null;
    var seen   = true;
    var drawn  = '';
    var placed = '';
    // la lampe vit dans une fenêtre fixe, rognée comme la zone de la balise et calée sur elle : son
    // halo ne passe pas sur la carte voisine
    if (s.light) {
      µ._mjs_fxAdopt(document, 'longshadow');
      pane = document.createElement('span');
      pane.setAttribute('mjs-fx-longshadow-window', '');
      pane.setAttribute('aria-hidden', 'true');
      pane.style.display = 'none';
      lamp = document.createElement('span');
      lamp.setAttribute('mjs-fx-longshadow-light', '');
      pane.appendChild(lamp);
      document.body.appendChild(pane);
    }
    var draw = function() {
      frame = 0;
      var e = last;
      var b = µ._mjs_dom.getBoundingClientRect(el);
      // la lampe s'allume à moins de `tot` du bord de la balise, et seulement si le pointeur est dans sa
      // zone ; mesurée avant toute écriture, qui forcerait un second calcul de style
      var z = null;
      if (lamp && e.clientX > b.left - tot && e.clientX < b.right + tot && e.clientY > b.top - tot && e.clientY < b.bottom + tot) {
        z = _mjsFxLongshadowRect(_mjsFxLongshadowZone(el));
        if (e.clientX < z.x || e.clientX >= z.x + z.w || e.clientY < z.y || e.clientY >= z.y + z.h) z = null;
      }
      var dx = e.clientX - b.left - b.width / 2;
      var dy = e.clientY - b.top - b.height / 2;
      // l'ombre fuit la lampe : aussi longue que la distance, sans dépasser `length`
      var d = Math.hypot(dx, dy);
      if (d > tot) {
        dx *= tot / d;
        dy *= tot / d;
      }
      // la même ombre qu'à l'image d'avant (au dixième de pixel) n'est pas repeinte
      var key = dx.toFixed(1) + ' ' + dy.toFixed(1);
      if (key !== drawn) {
        drawn = key;
        paint(-dx, -dy);
      }
      if (!lamp) return;
      pane.style.display = z ? '' : 'none';
      if (!z) return;
      // la fenêtre suit le rectangle de la zone (qui bouge avec le défilement), la lampe le pointeur
      var at = z.x + ' ' + z.y + ' ' + z.w + ' ' + z.h + ' ' + z.r.join(' ');
      if (at !== placed) {
        placed = at;
        pane.style.left                    = z.x + 'px';
        pane.style.top                     = z.y + 'px';
        pane.style.width                   = z.w + 'px';
        pane.style.height                  = z.h + 'px';
        pane.style.borderTopLeftRadius     = z.r[0];
        pane.style.borderTopRightRadius    = z.r[1];
        pane.style.borderBottomRightRadius = z.r[2];
        pane.style.borderBottomLeftRadius  = z.r[3];
      }
      lamp.style.transform = 'translate(' + (e.clientX - z.x) + 'px,' + (e.clientY - z.y) + 'px)';
    };
    var ask = function() {
      if (!frame) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0);
    };
    // hors de l'écran (élargi de la longueur de l'ombre, jusqu'où la lampe s'allume) : rien n'est
    // peint ; le dernier point du pointeur attend le retour de la balise
    var move = function(e) {
      last = e;
      if (seen) ask();
    };
    // la page ou un conteneur qui défile déplace la zone sous un pointeur immobile : la lampe est redessinée
    var scrolled = function() {
      if (seen && last) ask();
    };
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(en) {
      seen = en[en.length - 1].isIntersecting;
      if (seen && last) ask();
      else if (!seen && pane) pane.style.display = 'none';
    }, { rootMargin: tot + 'px' }) : null;
    if (io) io.observe(el);
    document.addEventListener('pointermove', move);
    if (lamp) {
      roots = _mjsFxLongshadowRoots(el);
      for (var i = 0; i < roots.length; i++) µ._mjs_dom.addEventListener(roots[i], 'scroll', scrolled, { capture: true, passive: true });
    }
    return function() {
      document.removeEventListener('pointermove', move);
      for (var i = 0; i < roots.length; i++) µ._mjs_dom.removeEventListener(roots[i], 'scroll', scrolled, { capture: true });
      if (io) io.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      if (pane) pane.remove();
      el.style.removeProperty('--mjs-fx-longshadow');
    };
  }
};
