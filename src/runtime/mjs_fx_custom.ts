// mjs_fx_custom — les effets CSS de l'appli, écrits dans un fichier `*.effects.mjs` :
//   *halo(color: #0ff, size: 12px) =
//     box-shadow: 0 0 $size $color
// Chaque composant qui en pose un appelle µ._mjs_fxCustom(nom, définition) avant l'effet : la
// feuille n'est construite qu'une fois. Chaque réglage est une variable CSS `--mjs-<nom>-<réglage>`
// (donc aussi une variable de thème : `$$halo-color`), repliée sur sa valeur par défaut.
// Sans @keyframes, les déclarations s'appliquent quand l'effet est actif (`on` : always par
// défaut, hover, click, view, load), avec une transition de `duration` sur les propriétés qu'elles
// touchent ; avec @keyframes, c'est une animation (`on` : always, en boucle ; hover, view : tant que ;
// click, load : un tour). Sur le cycle de vie (`@in=*halo`, `@out`, `@transition`) : sans
// @keyframes, les déclarations sont l'état caché (la balise entre en partant d'elles, sort en y
// allant) ; avec, l'animation se joue une fois (à l'envers pour la sortie).

µ._mjs_fxCustom = function(name, d) {
  if (µ._mjs_fxDefs[name]) return;
  var dflt = {};
  for (var i = 0; i < d.params.length; i++) dflt[d.params[i][0]] = d.params[i][1];
  // `$réglage` → sa variable CSS, repliée sur sa valeur par défaut
  var css = function(v) {
    return v.replace(/\$([A-Za-z_][\w-]*)/g, function(_, p) { return 'var(--mjs-' + name + '-' + p + ',' + (dflt[p] === void 0 ? '' : dflt[p]) + ')'; });
  };
  var bloc = function(list) { return list.map(function(x) { return x[0] + ':' + css(x[1]); }).join(';'); };
  var anim = d.keyframes.length > 0;
  var sel  = '[mjs-fx~="' + name + '"]';
  var feuille;
  if (anim) {
    feuille = '@keyframes mjs-fx-' + name + '{' + d.keyframes.map(function(k) { return k[0] + '{' + bloc(k[1]) + '}'; }).join('') + '}'
      + sel + '{' + (d.decls.length ? bloc(d.decls) + ';' : '') + 'animation:var(--mjs-fx-' + name + '-go,mjs-fx-' + name + ') var(--mjs-' + name + '-duration,1s) var(--mjs-' + name + '-easing,ease) var(--mjs-' + name + '-delay,0s) var(--mjs-fx-' + name + '-times,infinite)}';
  }
  else {
    var props = d.decls.map(function(x) { return x[0]; }).join(',');
    feuille = sel + '{transition-property:' + props + ';transition-duration:var(--mjs-' + name + '-duration,400ms);transition-timing-function:var(--mjs-' + name + '-easing,ease);transition-delay:var(--mjs-' + name + '-delay,0s)}'
      + sel + '[mjs-fx-on~="' + name + '"]{' + bloc(d.decls) + '}';
  }
  feuille += '@media (prefers-reduced-motion:reduce){' + sel + '{animation:none!important;transition:none!important}}';
  var vars = { duration: '', delay: '', easing: '' };
  for (var p in dflt) vars[p] = '';
  µ._mjs_fxDefs[name] = {
    css: feuille,
    vars: vars,
    // ses réglages et leur défaut, une animation ou non : relus par l'onglet « Effets » du panneau
    params: d.params,
    anim: anim,
    setup: function(el, s) {
      return anim ? µ._mjs_fxLoop(el, name, s.on || 'always') : µ._mjs_fxState(el, name, s.on || 'always');
    },
    // sur le cycle de vie : la paire { intro, outro }, réglages lus à la pose
    life: function(s) {
      var val = function(v) {
        return v.replace(/\$([A-Za-z_][\w-]*)/g, function(_, q) { return s[q] !== void 0 ? String(s[q]) : (dflt[q] === void 0 ? '' : dflt[q]); });
      };
      var cam = function(q) { return q.replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); }); };
      // images et options de l'animation sans prototype : le navigateur y lit aussi les membres absents (composite, iterations…)
      var etat = function(list) {
        var o = Object.create(null);
        for (var j = 0; j < list.length; j++) o[cam(list[j][0])] = val(list[j][1]);
        return o;
      };
      var opts = { duration: µ._mjs_fxMs(s.duration, anim ? 1000 : 400), delay: µ._mjs_fxMs(s.delay, 0), easing: typeof s.easing === 'string' ? s.easing : 'ease' };
      var jouer = function(node, sens) {
        if (typeof node.animate !== 'function' || µ._mjs_fxCalm()) return Promise.resolve();
        var a;
        if (anim) {
          var frames = [];
          d.keyframes.forEach(function(k) {
            k[0].split(/\s*,\s*/).forEach(function(etape) {
              var f = etat(k[1]);
              f.offset = etape === 'from' ? 0 : etape === 'to' ? 1 : parseFloat(etape) / 100;
              frames.push(f);
            });
          });
          frames.sort(function(x, y) { return x.offset - y.offset; });
          a = µ._mjs_animate(node, frames, Object.assign(Object.create(null), opts, { direction: sens === 'in' ? 'normal' : 'reverse', fill: sens === 'in' ? 'backwards' : 'forwards' }));
        }
        else {
          // l'état caché : départ implicite de l'entrée, arrivée implicite de la sortie
          var e = etat(d.decls);
          a = sens === 'in'
            ? µ._mjs_animate(node, [e], Object.assign(Object.create(null), opts, { fill: 'backwards' }))
            : µ._mjs_animate(node, [Object.assign(e, { offset: 1 })], Object.assign(Object.create(null), opts, { fill: 'forwards' }));
        }
        return a.finished.then(function() {}, function() {});
      };
      return {
        intro: function(node) { return jouer(node, 'in'); },
        outro: function(node) { return jouer(node, 'out'); }
      };
    }
  };
};
