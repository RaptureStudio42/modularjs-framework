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
  // valeurs par défaut des réglages, sans prototype : `$constructor` non déclaré n'y trouve rien, un réglage `__proto__` y est un nom comme un autre
  var dflt = Object.create(null);
  for (var i = 0; i < d.params.length; i++) dflt[d.params[i][0]] = d.params[i][1];
  // `$réglage` → sa variable CSS, repliée sur sa valeur par défaut
  var css = function(v) {
    return v.replace(/\$([A-Za-z_][\w-]*)/g, function(_, p) { return 'var(--mjs-' + name + '-' + p + ',' + (dflt[p] === void 0 ? '' : dflt[p]) + ')'; });
  };
  var block = function(list) { return list.map(function(x) { return x[0] + ':' + css(x[1]); }).join(';'); };
  var anim  = d.keyframes.length > 0;
  var sel   = '[mjs-fx~="' + name + '"]';
  var sheet;
  if (anim) {
    sheet = '@keyframes mjs-fx-' + name + '{' + d.keyframes.map(function(k) { return k[0] + '{' + block(k[1]) + '}'; }).join('') + '}'
      + sel + '{' + (d.decls.length ? block(d.decls) + ';' : '') + 'animation:var(--mjs-fx-' + name + '-go,mjs-fx-' + name + ') var(--mjs-' + name + '-duration,1s) var(--mjs-' + name + '-easing,ease) var(--mjs-' + name + '-delay,0s) var(--mjs-fx-' + name + '-times,infinite)}';
  }
  else {
    var props = d.decls.map(function(x) { return x[0]; }).join(',');
    sheet = sel + '{transition-property:' + props + ';transition-duration:var(--mjs-' + name + '-duration,400ms);transition-timing-function:var(--mjs-' + name + '-easing,ease);transition-delay:var(--mjs-' + name + '-delay,0s)}'
      + sel + '[mjs-fx-on~="' + name + '"]{' + block(d.decls) + '}';
  }
  sheet   += '@media (prefers-reduced-motion:reduce){' + sel + '{animation:none!important;transition:none!important}}';
  var vars = { duration: '', delay: '', easing: '' };
  for (var p in dflt) vars[p] = '';
  µ._mjs_fxDefs[name] = {
    css: sheet,
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
      var state = function(list) {
        var o = Object.create(null);
        for (var j = 0; j < list.length; j++) o[cam(list[j][0])] = val(list[j][1]);
        return o;
      };
      var opts = { duration: µ._mjs_fxMs(s.duration, anim ? 1000 : 400), delay: µ._mjs_fxMs(s.delay, 0), easing: typeof s.easing === 'string' ? s.easing : 'ease' };
      var play = function(node, direction) {
        if (typeof node.animate !== 'function' || µ._mjs_fxCalm()) return Promise.resolve();
        var st   = node._mjs_transition_state;
        var rate = 1;
        var a;
        var end;
        var t;
        // l'animation posée en cours de route (reprise d'une autre transition, retour sur ses pas) reçoit ici son heure de départ, calée
        // sur l'heure de l'image en cours : celle que le navigateur lui donnerait après coup est parfois plus tardive sur une page
        // occupée, et la balise passait alors une ou deux images en arrière de sa position (`rate` : le sens où elle joue). À une borne
        // (entrée pas encore partie, sortie finie), rien à caler : l'animation y reste jusqu'à son départ
        var pin = function() {
          var now = document.timeline ? document.timeline.currentTime : null;
          var c   = a.currentTime;
          if (now != null && c > opts.delay && c < opts.delay + opts.duration) a.startTime = now - c / rate;
        };
        // la balise remise pendant sa sortie, ou retirée pendant son entrée : l'animation en cours revient sur ses pas, depuis là où elle
        // en est ; une autre, jouée par-dessus, laisserait la balise figée à sa fin
        if (st && st.back && st.direction !== direction) return st.back();
        // une transition du moteur dans l'autre sens (une sortie `*fade` interrompue par le retour de la balise) : arrêtée là où elle en
        // est, celle-ci part de cette position, pas de son début
        if (st && st.direction !== direction) {
          t = st.tValue();
          st.abort();
        }
        if (anim) {
          var frames = [];
          d.keyframes.forEach(function(k) {
            k[0].split(/\s*,\s*/).forEach(function(step) {
              var f = state(k[1]);
              f.offset = step === 'from' ? 0 : step === 'to' ? 1 : parseFloat(step) / 100;
              frames.push(f);
            });
          });
          frames.sort(function(x, y) { return x.offset - y.offset; });
          a = µ._mjs_animate(node, frames, Object.assign(Object.create(null), opts, { direction: direction === 'in' ? 'normal' : 'reverse', fill: direction === 'in' ? 'both' : 'forwards' }));
        }
        else {
          // l'état caché : départ de l'entrée, arrivée de la sortie, l'autre bout étant l'état de la balise ; l'image est placée à son
          // bout — seule et sans place, le navigateur la met à la fin, et l'entrée se jouait à l'envers, puis sautait
          var e = state(d.decls);
          a = direction === 'in'
            ? µ._mjs_animate(node, [Object.assign(e, { offset: 0 })], Object.assign(Object.create(null), opts, { fill: 'both' }))
            : µ._mjs_animate(node, [Object.assign(e, { offset: 1 })], Object.assign(Object.create(null), opts, { fill: 'forwards' }));
        }
        if (t !== void 0) {
          a.currentTime = opts.delay + (direction === 'in' ? t : 1 - t) * opts.duration;
          pin();
        }
        // l'état de la transition, lu par le moteur (`tValue`, `abort`) et par le retour d'une sortie (`back`, cf. µ._mjs_txBack) ; une
        // sortie finie le garde, pour revenir de son image de fin
        st = node._mjs_transition_state = {
          direction: direction,
          tValue: function() {
            var p = Math.min(Math.max(((a.currentTime ?? 0) - opts.delay) / Math.max(opts.duration, 1), 0), 1);
            return direction === 'in' ? p : 1 - p;
          },
          abort: function() {
            a.cancel();
            if (node._mjs_transition_state === st) node._mjs_transition_state = null;
          },
          // retournée à une borne (entrée pas encore partie, sortie finie), l'animation serait remise à l'autre bout par le navigateur :
          // sa position d'avant lui est rendue, elle finit là où elle est ; déjà revenue à l'état naturel de la balise, elle est rendue
          back: function() {
            var c = a.currentTime;
            var p;
            st.direction = st.direction === 'in' ? 'out' : 'in';
            a.reverse();
            rate = -rate;
            if (c != null) a.currentTime = c;
            pin();
            p = a.finished.then(end, end);
            if (st.direction === 'in' && a.playState === 'finished') a.cancel();
            return p;
          }
        };
        // l'entrée, remplie des deux côtés, est rendue ici, à sa fin constatée : remplie vers l'arrière seulement, WebKit relisait la balise à
        // une position de mi-course (son dernier style calculé) entre la fin de l'animation et l'image qui la traite
        end = function() {
          if (st.direction === 'in' && node._mjs_transition_state === st) {
            node._mjs_transition_state = null;
            a.cancel();
          }
        };
        return a.finished.then(end, end);
      };
      return {
        intro: function(node) { return play(node, 'in'); },
        outro: function(node) { return play(node, 'out'); }
      };
    }
  };
};
