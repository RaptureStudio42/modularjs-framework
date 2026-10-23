// mjs_fx_pixels — `*pixels(mode)` : la balise se découpe en carreaux (dans un calque posé DANS la
// balise, sous son contenu ; dans le composant si la balise en est un). Les modes :
//   fill    : des carreaux de couleur la remplissent un à un, dans le désordre
//   explode : une nappe de carreaux de couleur couvre la balise, et vole en éclats
//   strip   : un rideau de fines barres qui montent et descendent, une sur deux (le bouton Netflix)
//   mosaic  : l'image de la balise se découpe, ses carreaux tournoient, puis elle se recompose
//   swap    : l'image de la balise laisse place à une autre, carreau par carreau
// L'image de mosaic et swap est le fond de la balise (`background-image`), sinon la première
// `<img>` qu'elle contient. Réglages : mode (fill), color (les carreaux ; #ff5722), size (un
// carreau, en px ; celui du mode), spread (explode : la distance des éclats en px ; 60), duration
// (un carreau ; celle du mode — mosaic : un tour complet), stagger (l'écart au hasard entre les
// carreaux ; celui du mode), image (swap : la seconde image), cover (les carreaux passent sur le
// contenu), on (hover, view, click, always — mosaic tourne tant que l'effet est actif).

(function() {
  var T  = '[mjs-fx-layer="pixels"]';
  var M  = function(m) { return T + '[mjs-fx-pixels="' + m + '"]'; };
  // des carreaux qui viennent de naître attendent (`mjs-fx-pixels-wait`) : l'état actif ne les joue qu'une fois leur départ noté au repos
  var A  = ':not([mjs-fx-pixels-wait])';
  // l'état actif, sur la balise ; dans un composant, le calque vit dans son shadow root (`:host`)
  var ON = function(m, sub, body) { return '[mjs-fx-on~="pixels"] > ' + M(m) + A + sub + '{' + body + '}:host([mjs-fx-on~="pixels"]) > ' + M(m) + A + sub + '{' + body + '}'; };
  µ._mjs_fxDefs.pixels = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    css: '[mjs-fx~="pixels"]{isolation:isolate}'
      + T + '{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;border-radius:inherit}'
      + T + '[mjs-fx-pixels-cover]{z-index:1}'
      + T + ' i{position:absolute;display:block;box-sizing:border-box}'
      // fill : les carreaux apparaissent chacun après son attente
      + M('fill') + ' i{background:var(--mjs-fx-pixels-c);border:1px solid rgba(0,0,0,.25);opacity:0;transition:opacity var(--mjs-fx-pixels-t) ease}'
      + ON('fill', ' i', 'opacity:1')
      // explode : la nappe part en éclats
      + M('explode') + ' i{background:var(--mjs-fx-pixels-c);border:1px solid rgba(0,0,0,.25);transition:opacity var(--mjs-fx-pixels-t) ease,transform var(--mjs-fx-pixels-t) ease}'
      + ON('explode', ' i', 'opacity:0;transform:translate(var(--tx),var(--ty))')
      // strip : une barre sur deux part de l'autre bord ; le fond plein glisse dessous quand toutes sont montées
      + M('strip') + ' i{top:0;height:100%;background:var(--mjs-fx-pixels-c);transform:scaleY(0);transform-origin:bottom;transition:transform var(--mjs-fx-pixels-t) ease-in-out}'
      + M('strip') + ' i:nth-child(even){transform-origin:top}'
      + ON('strip', ' i', 'transform:scaleY(1);transform-origin:top')
      + ON('strip', ' i:nth-child(even)', 'transform-origin:bottom')
      + M('strip') + ' b{position:absolute;inset:0;background:var(--mjs-fx-pixels-c);opacity:0;transition:opacity 0s}'
      + ON('strip', ' b', 'opacity:1;transition:opacity 0s var(--mjs-fx-pixels-all)')
      // swap : la première image s'efface d'un bloc, chaque carreau de la seconde bascule après son attente
      + M('swap') + ' i{background-image:var(--mjs-fx-pixels-img);background-size:var(--mjs-fx-pixels-w) var(--mjs-fx-pixels-h);background-repeat:no-repeat}'
      + M('swap') + ' i[mjs-fx-p="a"]{opacity:1;transition:opacity var(--mjs-fx-pixels-t)}'
      + M('swap') + ' i[mjs-fx-p="b"]{background-image:var(--mjs-fx-pixels-img2);opacity:0;transition-property:opacity;transition-duration:0s}'
      + ON('swap', ' i[mjs-fx-p="a"]', 'opacity:0')
      + ON('swap', ' i[mjs-fx-p="b"]', 'opacity:1')
      // mosaic : chaque carreau montre sa part de l'image et suit le tour de la démo, en un seul transform
      + M('mosaic') + ' i{background-image:var(--mjs-fx-pixels-img);background-size:var(--mjs-fx-pixels-w) var(--mjs-fx-pixels-h);background-repeat:no-repeat;transform-origin:var(--mjs-fx-pixels-half) var(--mjs-fx-pixels-half)}'
      + ON('mosaic', ' i', 'animation:mjs-fx-pixels-mosaic var(--mjs-fx-pixels-t) linear infinite')
      + '@keyframes mjs-fx-pixels-mosaic{0%,10%{transform:translate(0px) rotate(0deg) scale(1) translate(0px)}20%,30%{transform:translate(0px) rotate(0deg) scale(.5) translate(0px)}40%{transform:translate(calc(250px - var(--mjs-fx-pixels-half))) rotate(360deg) scale(.5) translate(calc(var(--mjs-fx-pixels-half) - 100px))}70%{transform:translate(calc(-250px - var(--mjs-fx-pixels-half))) rotate(720deg) scale(.5) translate(calc(var(--mjs-fx-pixels-half) + 100px))}90%{transform:translate(0px) rotate(0deg) scale(2.5) translate(0px)}100%{transform:translate(0px) rotate(0deg) scale(1) translate(0px)}}'
      // « réduire les animations » : aucune transition ; l'attribut répété l'emporte sur la spécificité des règles de chaque mode (swap, la plus haute)
      + '@media (prefers-reduced-motion:reduce){' + T + '[mjs-fx-pixels][mjs-fx-pixels][mjs-fx-pixels] i{transition:none}' + ON('explode', ' i', 'transform:none') + ON('mosaic', ' i', 'animation:none') + ON('strip', ' b', 'transition:none') + '}',
    vars: {},
    setup: function(el, s) {
      var mode    = /^(fill|explode|strip|mosaic|swap)$/.test(s.mode) ? s.mode : 'fill';
      var size    = s.size || { fill: 10, explode: 20, strip: 2, mosaic: 10, swap: 20 }[mode];
      var dur     = s.duration || { fill: '.5s', explode: '.5s', strip: '.2s', mosaic: '10s', swap: '.5s' }[mode];
      var spread  = µ._mjs_fxMs(s.stagger, { fill: 1000, explode: 500, strip: 1000, mosaic: 1000, swap: 800 }[mode]);
      var reach   = s.spread === void 0 ? 60 : s.spread;
      var host    = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'pixels');
      var restore = µ._mjs_fxRelative(el);
      var layer   = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', 'pixels');
      layer.setAttribute('mjs-fx-pixels', mode);
      layer.setAttribute('aria-hidden', 'true');
      if (s.cover) layer.setAttribute('mjs-fx-pixels-cover', '');
      layer.style.setProperty('--mjs-fx-pixels-c', s.color || '#ff5722');
      layer.style.setProperty('--mjs-fx-pixels-t', dur);
      layer.style.setProperty('--mjs-fx-pixels-all', ((µ._mjs_fxMs(dur, 200) + spread) / 1000) + 's');
      layer.style.setProperty('--mjs-fx-pixels-half', (size / 2) + 'px');
      // l'image : le fond de la balise, sinon sa première <img> — cachée le temps de l'effet
      var hidden = [];
      if (mode === 'mosaic' || mode === 'swap') {
        var cs  = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        var img = cs && cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : '';
        if (!img) {
          var pic = µ._mjs_dom.querySelector(el, 'img');
          if (pic && (pic.currentSrc || pic.src)) {
            img = 'url("' + (pic.currentSrc || pic.src) + '")';
            hidden.push([pic, 'visibility', pic.style.visibility]);
            pic.style.visibility = 'hidden';
          }
        }
        else {
          hidden.push([el, 'backgroundImage', el.style.backgroundImage]);
          el.style.backgroundImage = 'none';
        }
        layer.style.setProperty('--mjs-fx-pixels-img', img || 'linear-gradient(' + (s.color || '#ff5722') + ',' + (s.color || '#ff5722') + ')');
        // une adresse (ou ce que le build pose pour un chemin de fichier : son adresse, ou { src, srcset }), ou une image CSS toute faite (`url(…)`, un dégradé)
        var second = µ._mjs_fxImage(s.image, el);
        if (second) layer.style.setProperty('--mjs-fx-pixels-img2', /^(url|(repeating-)?(linear|radial|conic)-gradient)\(/.test(second) ? second : 'url("' + second.replace(/"/g, '%22') + '")');
      }
      µ._mjs_dom.insertBefore(host, layer, host.firstChild);
      // la taille des carreaux posés (cf. le ResizeObserver plus bas)
      var built = '';
      var make = function() {
        layer.textContent = '';
        var W = layer.clientWidth;
        var H = layer.clientHeight;
        built = W + 'x' + H;
        if (!W || !H) return;
        layer.style.setProperty('--mjs-fx-pixels-w', W + 'px');
        layer.style.setProperty('--mjs-fx-pixels-h', H + 'px');
        var t = size;
        // pas plus de 4000 carreaux : au-delà, ils grandissent
        while ((mode === 'strip' ? W / t : (W / t) * (H / t)) > 4000) t *= 1.5;
        var wait = function(c) { c.style[mode === 'mosaic' ? 'animationDelay' : 'transitionDelay'] = (Math.random() * spread / 1000).toFixed(3) + 's'; };
        if (mode === 'strip') {
          layer.appendChild(document.createElement('b'));
          for (var x = 0; x < W; x += t) {
            var bar = document.createElement('i');
            bar.style.left  = x + 'px';
            bar.style.width = t + 'px';
            wait(bar);
            layer.appendChild(bar);
          }
          return;
        }
        // les carreaux chevauchent leur voisin d'un demi-pixel : aucune couture à un zoom non entier
        for (var y = 0; y < H; y += t) {
          for (var x2 = 0; x2 < W; x2 += t) {
            var parts = mode === 'swap' ? ['a', 'b'] : [''];
            for (var p = 0; p < parts.length; p++) {
              var c = document.createElement('i');
              c.style.left   = x2 + 'px';
              c.style.top    = y + 'px';
              c.style.width  = (t + (mode === 'mosaic' || mode === 'swap' ? 0.6 : 0)) + 'px';
              c.style.height = (t + (mode === 'mosaic' || mode === 'swap' ? 0.6 : 0)) + 'px';
              if (parts[p]) c.setAttribute('mjs-fx-p', parts[p]);
              if (mode === 'mosaic' || mode === 'swap') c.style.backgroundPosition = (-x2) + 'px ' + (-y) + 'px';
              if (mode === 'explode') {
                c.style.setProperty('--tx', ((Math.random() - 0.5) * reach).toFixed(1) + 'px');
                c.style.setProperty('--ty', ((Math.random() - 0.5) * reach).toFixed(1) + 'px');
              }
              if (mode !== 'swap' || parts[p] === 'b') wait(c);
              layer.appendChild(c);
            }
          }
        }
      };
      // des carreaux nés pendant l'état actif naîtraient pleins, sans leur arrivée un à un. Les premiers
      // (la balise vient d'être posée, ou montrée après avoir été cachée) sont donc posés au repos, le
      // navigateur en note le départ, puis l'état actif les joue. « Réduire les animations » : pleins d'emblée
      var build = function() {
        var fresh = !layer.firstChild && !µ._mjs_fxCalm();
        if (fresh) layer.setAttribute('mjs-fx-pixels-wait', '');
        make();
        if (!fresh) return;
        if (layer.firstChild) void layer.offsetWidth;
        layer.removeAttribute('mjs-fx-pixels-wait');
      };
      build();
      // une notification sans changement de taille (la première arrive toujours, juste après
      // l'observation ; une taille revenue à la sienne) ne recrée rien : recréés pendant l'état actif,
      // les carreaux naîtraient pleins, sans leur arrivée un à un
      var timer = null;
      var ro    = typeof ResizeObserver === 'function' ? new ResizeObserver(function() {
        clearTimeout(timer);
        if (layer.clientWidth + 'x' + layer.clientHeight !== built) timer = setTimeout(build, 150);
      }) : null;
      if (ro) ro.observe(el);
      var gate = µ._mjs_fxState(el, 'pixels', s.on);
      return function() {
        gate();
        if (ro) ro.disconnect();
        clearTimeout(timer);
        layer.remove();
        for (var i = 0; i < hidden.length; i++) hidden[i][0].style[hidden[i][1]] = hidden[i][2];
        restore();
      };
    }
  };
})();
