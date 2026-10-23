// mjs_fx_mesh — `*mesh` : un fond de grandes taches de couleur floues qui dérivent lentement, au
// fond de la balise, sous son contenu (un calque, dans le composant si la balise en est un). Tout se
// joue en CSS : chaque tache dérive sur deux axes, à deux durées différentes, des nombres premiers
// entre eux (le rapport des deux durées ne se répète pas à l'œil). Réglages : style (principal :
// boreal, sunset, ocean, neon, candy, forest : six couleurs chacune, la première est le fond ;
// boreal), drift (spots : chaque tache dérive à son rythme ; sweep : tout le fond glisse d'un bord à
// l'autre et revient, des taches rondes à des places fixes qui s'effacent vers l'extérieur, le flou
// coupé au bord de la balise ; spots), colors (ses propres couleurs, au lieu de celles de la
// palette), background (la couleur sous les taches ; celle de la palette), count (le nombre de
// taches, de 2 à 8 ; 5 — sweep : une tache par couleur sans count écrit), size (la taille d'une tache
// en % de la balise ; 60), blur (le flou en px ; 60), speed (la durée d'un cycle de dérive ; 20s),
// opacity (de 0 à 1 ; 1), mouse (spots : les taches s'écartent doucement de la souris ; non), on
// (always, hover, view, click, load ; always). Seul `mouse` écoute la souris ; aucune boucle
// JavaScript sinon. Effets économes : suivi (le flou des taches qui dérivent se repeint à chaque image) ; la page économe
// arrête les taches, qui restent à l'écran.

var _mjsFxMeshPalettes = {
  boreal: ['#06121f', '#00e5a0', '#1f6feb', '#7c4dff', '#00b8d4', '#39ff88'],
  sunset: ['#1a0b1e', '#ff5e62', '#ff9966', '#f72585', '#7209b7', '#ffd166'],
  ocean:  ['#03121f', '#0077b6', '#00b4d8', '#90e0ef', '#023e8a', '#48cae4'],
  neon:   ['#0a0014', '#ff00e5', '#00f0ff', '#fffb00', '#7a00ff', '#00ff85'],
  candy:  ['#1d0b2b', '#ff6ec7', '#ffb3e6', '#7df9ff', '#b388ff', '#ffe066'],
  forest: ['#06130b', '#14532d', '#22c55e', '#84cc16', '#0f766e', '#ca8a04']
};

// des durées premières, rangées pour que deux voisines ne se suivent pas : 16 pour 8 taches × 2 axes
var _mjsFxMeshPrimes = [41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107];
var _mjsFxMeshOrder  = [0, 9, 4, 13, 2, 11, 6, 15, 1, 8, 5, 12, 3, 10, 7, 14];

µ._mjs_fxDefs.mesh = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  // effets économes : suivi, ses taches arrêtées en économe
  heavy: true,
  css: '[mjs-fx~="mesh"]{isolation:isolate}'
    + '[mjs-fx-layer="mesh"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;border-radius:inherit;background:var(--mjs-mesh-background,var(--mjs-fx-mesh-bg,#000));opacity:var(--mjs-mesh-opacity,1)}'
    + '[mjs-fx-layer="mesh"] u{position:absolute;inset:calc(var(--mjs-mesh-blur,60px) * -1);filter:blur(var(--mjs-mesh-blur,60px)) saturate(1.25);text-decoration:none}'
    + '[mjs-fx-layer="mesh"] i{position:absolute;left:var(--mjs-fx-mesh-x);top:var(--mjs-fx-mesh-y);width:var(--mjs-mesh-size,60%);height:var(--mjs-mesh-size,60%);translate:calc(-50% + var(--mjs-fx-mesh-ox,0px)) calc(-50% + var(--mjs-fx-mesh-oy,0px));transition:translate 1.6s ease-out}'
    + '[mjs-fx-layer="mesh"] b{position:absolute;inset:0;border-radius:50%;background:radial-gradient(closest-side,var(--mjs-fx-mesh-c) 0,var(--mjs-fx-mesh-c) 38%,transparent 100%);'
    + 'animation:var(--mjs-fx-mesh-go,mjs-fx-mesh-x) calc(var(--mjs-mesh-speed,20s) * var(--mjs-fx-mesh-px) / 73) ease-in-out calc(var(--mjs-mesh-speed,20s) * var(--mjs-fx-mesh-px) / 73 * var(--mjs-fx-mesh-wx)) var(--mjs-fx-mesh-times,infinite) alternate,'
    + 'var(--mjs-fx-mesh-go,mjs-fx-mesh-y) calc(var(--mjs-mesh-speed,20s) * var(--mjs-fx-mesh-py) / 73) ease-in-out calc(var(--mjs-mesh-speed,20s) * var(--mjs-fx-mesh-py) / 73 * var(--mjs-fx-mesh-wy)) var(--mjs-fx-mesh-times,infinite) alternate;'
    + 'animation-play-state:var(--mjs-fx-lite-play,running)}'
    + '@keyframes mjs-fx-mesh-x{from{transform:translateX(calc(var(--mjs-fx-mesh-ax) * -1))}to{transform:translateX(var(--mjs-fx-mesh-ax))}}'
    + '@keyframes mjs-fx-mesh-y{from{translate:0 calc(var(--mjs-fx-mesh-ay) * -1)}to{translate:0 var(--mjs-fx-mesh-ay)}}'
    // drift: sweep — une image deux fois plus grande que la balise glisse d'un bord à l'autre, sous un flou coupé à son arrondi
    // (par l'image seule : rognée deux fois, une balise arrondie se dessinerait autrement)
    + '[mjs-fx-layer="mesh"][mjs-fx-mesh-sweep]{overflow:visible}'
    + '[mjs-fx-layer="mesh"][mjs-fx-mesh-sweep] u{inset:0;background:var(--mjs-fx-mesh-sweep);background-size:200% 200%;filter:blur(var(--mjs-mesh-blur,60px));clip-path:inset(0 round var(--mjs-fx-mesh-r,0));animation:var(--mjs-fx-mesh-go,mjs-fx-mesh-sweep) var(--mjs-mesh-speed,20s) linear 0s var(--mjs-fx-mesh-times,infinite);animation-play-state:var(--mjs-fx-lite-play,running)}'
    + '@keyframes mjs-fx-mesh-sweep{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="mesh"] b,[mjs-fx-layer="mesh"][mjs-fx-mesh-sweep] u{animation:none}}',
  vars: { background: '', size: '%', blur: 'px', speed: '', opacity: '' },
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'mesh');
    var restore = µ._mjs_fxRelative(el);
    var name    = _mjsFxMeshPalettes.hasOwnProperty(s.style) ? s.style : 'boreal';
    var palette = _mjsFxMeshPalettes[name];
    var colors  = s.colors || µ._mjs_fxList(el, '--mjs-mesh-colors') || palette.slice(1);
    var sweep   = s.drift === 'sweep';
    var count   = sweep && !s.count ? colors.length : Math.min(8, Math.max(2, Math.round(s.count || 5)));
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'mesh');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.setProperty('--mjs-fx-mesh-bg', palette[0]);
    var field = document.createElement('u');
    var spots = [];
    var frac  = function(n) { return n - Math.floor(n); };
    if (sweep) {
      // des taches rondes à des places fixes, chacune s'efface jusqu'à `size` ; le flou coupé à l'arrondi de la balise (px, %,
      // ellipses), sans quoi il déborde dans ses coins
      var at    = ['10% 20%', '90% 80%', '80% 15%', '15% 85%', '50% 50%', '55% 10%'];
      var paint = [];
      var round = typeof getComputedStyle === 'function' ? getComputedStyle(el).borderRadius : '';
      if (round && !/^0(px)?$/.test(round)) field.style.setProperty('--mjs-fx-mesh-r', round);
      for (var j = 0; j < count; j++) paint.push('radial-gradient(circle at ' + at[j % at.length] + ',' + colors[j % colors.length] + ',transparent var(--mjs-mesh-size,60%))');
      layer.setAttribute('mjs-fx-mesh-sweep', '');
      field.style.setProperty('--mjs-fx-mesh-sweep', paint.join(','));
    }
    else {
      for (var i = 0; i < count; i++) {
        var spot  = document.createElement('i');
        var inner = document.createElement('b');
        // la place de départ : suite à faible discrépance (le nombre d'or), jamais en grappe
        var x = Math.round((12 + frac(0.1 + i * 0.618034) * 76) * 10) / 10;
        var y = Math.round((12 + frac(0.3 + i * 0.381966) * 76) * 10) / 10;
        spot.style.setProperty('--mjs-fx-mesh-x', x + '%');
        spot.style.setProperty('--mjs-fx-mesh-y', y + '%');
        spot.style.setProperty('--mjs-fx-mesh-c', colors[i % colors.length]);
        inner.style.setProperty('--mjs-fx-mesh-px', _mjsFxMeshPrimes[_mjsFxMeshOrder[2 * i]]);
        inner.style.setProperty('--mjs-fx-mesh-py', _mjsFxMeshPrimes[_mjsFxMeshOrder[2 * i + 1]]);
        // la phase de départ : chaque tache est déjà à un point différent de sa course
        inner.style.setProperty('--mjs-fx-mesh-wx', (-frac(0.2 + i * 0.754877)).toFixed(3));
        inner.style.setProperty('--mjs-fx-mesh-wy', (-frac(0.6 + i * 0.569840)).toFixed(3));
        inner.style.setProperty('--mjs-fx-mesh-ax', Math.round(30 + frac(i * 0.7 + 0.15) * 45) + '%');
        inner.style.setProperty('--mjs-fx-mesh-ay', Math.round(30 + frac(i * 0.45 + 0.4) * 45) + '%');
        spot.appendChild(inner);
        field.appendChild(spot);
        spots.push({ el: spot, x: x, y: y });
      }
    }
    layer.appendChild(field);
    µ._mjs_dom.insertBefore(host, layer, host.firstChild);
    var undo = [];
    // la souris : les taches s'écartent doucement (leur place de départ fait foi, la dérive ne compte pas)
    if (s.mouse === true && !sweep && !µ._mjs_fxCalm()) {
      var move = function(e) {
        var r = layer.getBoundingClientRect();
        var W = r.width;
        var H = r.height;
        var reach = 0.55 * Math.max(W, H);
        if (!(reach > 0)) return;
        var px = e.clientX - r.left;
        var py = e.clientY - r.top;
        for (var k = 0; k < spots.length; k++) {
          var dx = spots[k].x / 100 * W - px;
          var dy = spots[k].y / 100 * H - py;
          var d  = Math.sqrt(dx * dx + dy * dy) || 1;
          var push = Math.max(0, 1 - d / reach) * 0.3 * Math.max(W, H);
          spots[k].el.style.setProperty('--mjs-fx-mesh-ox', (dx / d * push).toFixed(1) + 'px');
          spots[k].el.style.setProperty('--mjs-fx-mesh-oy', (dy / d * push).toFixed(1) + 'px');
        }
      };
      var leave = function() {
        for (var k = 0; k < spots.length; k++) {
          spots[k].el.style.setProperty('--mjs-fx-mesh-ox', '0px');
          spots[k].el.style.setProperty('--mjs-fx-mesh-oy', '0px');
        }
      };
      µ._mjs_dom.addEventListener(el, 'pointermove', move);
      µ._mjs_dom.addEventListener(el, 'pointerleave', leave);
      undo.push(function() {
        µ._mjs_dom.removeEventListener(el, 'pointermove', move);
        µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      });
    }
    var gate = µ._mjs_fxLoop(el, 'mesh', s.on);
    return function() {
      gate();
      for (var u = 0; u < undo.length; u++) undo[u]();
      layer.remove();
      restore();
    };
  }
};
