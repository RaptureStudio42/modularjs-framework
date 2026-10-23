// mjs_fx_gradient — `*gradient` : un fond qui défile dans les lettres (ou sur toute la balise) — un dégradé de couleurs,
// une image ou un motif. Le texte n'est pas réécrit (`background-clip: text`) : il reste sélectionnable et lu comme avant ;
// sans `background-clip: text`, il garde sa couleur. Réglages : colors (principal : la liste des couleurs), speed (un tour
// du fond ; 4s), direction (le sens du défilé : un mot — right, down, up-left… — ou un angle, 90 = vers la droite, 180 =
// vers le bas ; right), angle (l'angle des bandes du dégradé, ou des rayures du motif, en degrés ; celui de direction),
// where (text, box : les lettres, ou le fond de la balise), image (une image dans les lettres : une adresse, un fichier ;
// aucune), size (la taille du fond par rapport à la balise, en % ; 200), pattern (none ; stripes : des rayures, dots : des
// pois, waves : des vagues, checks : un damier), outline (la couleur d'un contour autour des lettres ; celle du texte),
// width (l'épaisseur du contour en px, 0 = aucun ; 0), animate (non : un fond fixe), on (always, hover, view, click,
// load). La liste se règle aussi par thème : `$$gradient-colors: red, gold, #0ff`.
//
// Trois fonds. Le dégradé seul (ni image, ni motif, ni size, ni angle) glisse dans le sens de direction, ses bandes
// perpendiculaires au défilé. Une image, size ou angle : le fond est une tuile de size % sur l'axe du défilé (droite,
// gauche, haut, bas ; une autre direction prend l'axe le plus proche) — un dégradé dont les bandes sont perpendiculaires
// au défilé boucle sans couture, une image ou un dégradé de biais va et vient d'un bord à l'autre ; une image
// introuvable : le dégradé prend sa place. Un motif (une image l'emporte sur lui) avance d'environ 120 px dans le sens
// de angle.

µ._mjs_fxDefs.gradient = {
  image: true,
  css: '[mjs-fx~="gradient"]{background-image:var(--mjs-fx-gradient);background-size:var(--mjs-fx-gradient-size,300% 300%);background-position:var(--mjs-fx-gradient-from,0% 0%);animation:var(--mjs-fx-gradient-go,mjs-fx-gradient) var(--mjs-gradient-speed,4s) var(--mjs-fx-gradient-ease,linear) 0s var(--mjs-fx-gradient-times,infinite) var(--mjs-fx-gradient-way,normal)}'
    + '@supports ((-webkit-background-clip:text) or (background-clip:text)){[mjs-fx~="gradient"]:not([mjs-fx-gradient-where="box"]){-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;-webkit-text-stroke:var(--mjs-gradient-width,0px) var(--mjs-gradient-outline,currentColor)}}'
    + '[mjs-fx~="gradient"][mjs-fx-gradient-still]{animation:none}'
    + '@keyframes mjs-fx-gradient{from{background-position:var(--mjs-fx-gradient-from,0% 0%)}to{background-position:var(--mjs-fx-gradient-to,0% 0%)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="gradient"][mjs-fx~="gradient"]{animation:none}}',
  vars: { speed: '', width: 'px', outline: '' },
  setup: function(el, s) {
    var list  = s.colors || µ._mjs_fxList(el, '--mjs-gradient-colors') || ['#22d3ee', '#ff4fa3', '#facc15'];
    var deg   = µ._mjs_fxDeg(s.direction, 90);
    var url   = µ._mjs_fxImage(s.image, el);
    var put   = function(k, v) { el.style.setProperty('--mjs-fx-gradient' + k, v); };
    var probe = null;
    if (url === '' && /^(stripes|dots|waves|checks)$/.test(s.pattern)) {
      var c1 = list[1] || list[0];
      var c2 = list[2] || c1;
      var a  = typeof s.angle === 'number' ? s.angle : deg;
      var r  = a * Math.PI / 180;
      var px = function(v) { return (+v.toFixed(3)) + 'px'; };
      // le motif avance d'un nombre entier de tuiles : la boucle se raccorde
      var pas = function(w, h) {
        var ux = Math.round(Math.sin(r));
        var uy = Math.round(-Math.cos(r));
        var k  = Math.max(1, Math.round(120 / Math.max(w, h)));
        return [ux * w * k, uy * h * k];
      };
      var img, size, from, to, w, h, d;
      if (s.pattern === 'dots') {
        w    = 14;
        d    = pas(w, w);
        img  = 'radial-gradient(circle,' + list[0] + ' 0 3px,transparent 3.5px),radial-gradient(circle,' + c1 + ' 0 3px,transparent 3.5px),linear-gradient(' + c2 + ',' + c2 + ')';
        size = '14px 14px,14px 14px,100% 100%';
        from = '0px 0px,7px 7px,0px 0px';
        to   = px(d[0]) + ' ' + px(d[1]) + ',' + px(d[0] + 7) + ' ' + px(d[1] + 7) + ',0px 0px';
      }
      else if (s.pattern === 'checks') {
        w    = 16;
        d    = pas(w, w);
        img  = 'conic-gradient(' + list[0] + ' 25%,' + c1 + ' 0 50%,' + list[0] + ' 0 75%,' + c1 + ' 0)';
        size = '16px 16px';
        from = '0px 0px';
        to   = px(d[0]) + ' ' + px(d[1]);
      }
      else if (s.pattern === 'waves') {
        d    = pas(16, 20);
        img  = 'radial-gradient(circle at 100% 50%,transparent 20%,' + list[0] + ' 21% 34%,transparent 35%),radial-gradient(circle at 0% 50%,transparent 20%,' + c2 + ' 21% 34%,transparent 35%),linear-gradient(' + c1 + ',' + c1 + ')';
        size = '16px 20px,16px 20px,100% 100%';
        from = '0px 0px,0px -10px,0px 0px';
        to   = px(d[0]) + ' ' + px(d[1]) + ',' + px(d[0]) + ' ' + px(d[1] - 10) + ',0px 0px';
      }
      else {
        // rayures : une tuile qui tient deux périodes pile à n'importe quel angle — les tuiles se raccordent, et avancer
        // d'une tuile décale les rayures d'une période
        var band = 6;
        var per  = band * list.length;
        var sx   = Math.abs(Math.sin(r));
        var cy   = Math.abs(Math.cos(r));
        w    = sx > 0.01 ? per / sx : per;
        h    = cy > 0.01 ? per / cy : per;
        var k = Math.max(1, Math.round(120 / per));
        img  = 'repeating-linear-gradient(' + a + 'deg,' + list.map(function(x, i) { return x + ' ' + (i * band) + 'px ' + ((i + 1) * band) + 'px'; }).join(',') + ')';
        size = px(w) + ' ' + px(h);
        from = '0px 0px';
        to   = sx > 0.01 ? px(w * k) + ' 0px' : '0px ' + px(h * k);
      }
      put('', img);
      put('-size', size);
      put('-from', from);
      put('-to', to);
    }
    else if (url !== '' || typeof s.size === 'number' || typeof s.angle === 'number') {
      var tsize = typeof s.size === 'number' ? s.size : 200;
      var dir   = ['up', 'right', 'down', 'left'][Math.round(deg / 90) % 4];
      var horiz = dir === 'left' || dir === 'right';
      var ta    = typeof s.angle === 'number' ? µ._mjs_fxDeg(s.angle, deg) : deg;
      var gradient = 'linear-gradient(' + ta + 'deg,' + list.concat([list[0]]).join(',') + ')';
      var pose = function(image) {
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-gradient-flow');
        // le fond : l'image, ou le dégradé ; sa tuile fait `size` % de la balise sur l'axe du défilé
        var tile = image ? 'auto' : '100%';
        put('', image ? 'url("' + url.replace(/["\\\n]/g, '\\$&') + '")' : gradient);
        put('-size', horiz ? tsize + '% ' + tile : tile + ' ' + tsize + '%');
        // un dégradé dont les bandes sont perpendiculaires au défilé se raccorde d'une tuile à l'autre : il boucle ;
        // sinon (une image, un angle de biais) le fond va et vient, sans que le bord d'une tuile ne paraisse jamais
        var seam = !image && (horiz ? (ta === 90 || ta === 270) : (ta === 0 || ta === 180));
        var sign = dir === 'left' || dir === 'up' ? 1 : -1;
        var tfrom, tto;
        if (seam) {
          // un tour = une tuile : en % de la place libre (balise moins tuile), size / (size - 1)
          var big  = Math.max(tsize, 101) / 100;
          var turn = Math.round(big / (big - 1) * 10000) / 100;
          tfrom = 0;
          tto   = sign * turn;
        }
        else {
          µ._mjs_dom.setAttribute(el, 'mjs-fx-gradient-flow', 'swing');
          tfrom = sign > 0 ? 0 : 100;
          tto   = sign > 0 ? 100 : 0;
        }
        put('-from', horiz ? tfrom + '% ' + (seam ? '0%' : '50%') : (seam ? '0% ' : '50% ') + tfrom + '%');
        put('-to', horiz ? tto + '% ' + (seam ? '0%' : '50%') : (seam ? '0% ' : '50% ') + tto + '%');
        put('-ease', seam ? 'linear' : 'ease-in-out');
        if (seam) el.style.removeProperty('--mjs-fx-gradient-way');
        else put('-way', 'alternate');
      };
      pose(url !== '');
      if (url !== '' && typeof Image === 'function') {
        probe = new Image();
        probe.onerror = function() {
          µ.warn(µ._mjs_msg('gradientImage', { url: url }, '*gradient : l\'image {url} est introuvable, le dégradé la remplace'));
          pose(false);
        };
        probe.src = url;
      }
    }
    else {
      // deux tours de couleurs dans une image trois fois plus grande que la balise : glisser de 75 % sur les axes du
      // dégradé la fait avancer d'un tour pile — la boucle ne saute jamais
      put('', 'linear-gradient(' + deg + 'deg,' + list.concat(list, [list[0]]).join(',') + ')');
      var gr = deg * Math.PI / 180;
      var dx = Math.sin(gr);
      var dy = -Math.cos(gr);
      // l'image avance dans le sens du dégradé : sa position en % décroît quand elle va vers la droite ou vers le bas
      put('-from', (dx > 1e-6 ? '75%' : '0%') + ' ' + (dy > 1e-6 ? '75%' : '0%'));
      put('-to', (dx < -1e-6 ? '75%' : '0%') + ' ' + (dy < -1e-6 ? '75%' : '0%'));
    }
    if (s.where === 'box') µ._mjs_dom.setAttribute(el, 'mjs-fx-gradient-where', 'box');
    if (s.animate === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-gradient-still', '');
    var gate = µ._mjs_fxLoop(el, 'gradient', s.on);
    return function() {
      gate();
      if (probe) {
        probe.onerror = null;
        probe = null;
      }
      ['', '-size', '-from', '-to', '-ease', '-way'].forEach(function(k) { el.style.removeProperty('--mjs-fx-gradient' + k); });
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gradient-where');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gradient-still');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gradient-flow');
    };
  }
};
