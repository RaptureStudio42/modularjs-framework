// mjs_fx_shine — `*shine` : un reflet de lumière traverse la balise (un pseudo-élément `::after`), ou
// balaie ses lettres (`where: text` : le texte prend la couleur `ink` et le reflet passe dedans, un
// texte « en chargement »).
// Réglages : color (le reflet ; blanc translucide), where (box : la balise ; text : ses lettres ;
// box), ink (text : la couleur du texte ; gris), direction (le sens du passage : un mot ou un
// angle, 90 = vers la droite ; 105 : vers la droite, un peu penché ; le reflet est une bande
// perpendiculaire à son chemin), width (la largeur du reflet, en % de la balise ; 30), duration (un
// passage ; 700ms), on
// (hover : un passage à chaque survol ; always : un passage toutes les `every` ; view : pareil, tant
// que la balise est à l'écran ; click : un passage par clic ; load : un passage à l'apparition ;
// success, error : un passage quand l'envoi réussit, ou échoue),
// every (entre deux passages, pour always et view, calés sur l'horloge commune des effets qui se
// répètent ; sans lui, la variable de thème `$$mjs-fx-every`, sinon 3s ; hover, écrit : les passages se
// suivent ainsi pendant le survol).

µ._mjs_fxDefs.shine = {
  css: '[mjs-fx~="shine"]:not(:where([mjs-fx-shine-text])){overflow:hidden}'
    + '[mjs-fx~="shine"]:not(:where([mjs-fx-shine-text]))::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(var(--mjs-fx-shine-a,105deg),transparent calc(50% - var(--mjs-shine-width,30%) / 2),var(--mjs-shine-color,rgba(255,255,255,.55)) 50%,transparent calc(50% + var(--mjs-shine-width,30%) / 2));transform:translate(var(--mjs-fx-shine-fx,-116%),var(--mjs-fx-shine-fy,-31%))}'
    + '[mjs-fx~="shine"][mjs-fx-play~="shine"]:not(:where([mjs-fx-shine-text]))::after{animation:mjs-fx-shine var(--mjs-shine-duration,700ms) ease both}'
    + '@keyframes mjs-fx-shine{from{transform:translate(var(--mjs-fx-shine-fx,-116%),var(--mjs-fx-shine-fy,-31%))}to{transform:translate(var(--mjs-fx-shine-tx,116%),var(--mjs-fx-shine-ty,31%))}}'
    // where: text — deux fonds découpés par les lettres : la bande au milieu d'une image 2,5 fois plus grande que la balise
    // (sa largeur, en % de la balise, rapportée à l'image), puis la couleur du texte
    + '[mjs-fx~="shine"]:where([mjs-fx-shine-text]){background-image:linear-gradient(var(--mjs-fx-shine-a,105deg),transparent calc(50% - var(--mjs-shine-width,30%) / 5),var(--mjs-shine-color,rgba(255,255,255,.55)) 50%,transparent calc(50% + var(--mjs-shine-width,30%) / 5)),linear-gradient(var(--mjs-shine-ink,#6e7681),var(--mjs-shine-ink,#6e7681));background-repeat:no-repeat;background-size:250% 250%,100% 100%;background-position:var(--mjs-fx-shine-from,150% 50%),0 0;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}'
    + '[mjs-fx~="shine"][mjs-fx-play~="shine"]:where([mjs-fx-shine-text]){animation:mjs-fx-shine-text var(--mjs-shine-duration,700ms) linear both}'
    + '@keyframes mjs-fx-shine-text{from{background-position:var(--mjs-fx-shine-from,150% 50%),0 0}to{background-position:var(--mjs-fx-shine-to,-50% 50%),0 0}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="shine"]::after{display:none}[mjs-fx~="shine"][mjs-fx-shine-text][mjs-fx-shine-text]{animation:none}}',
  vars: { color: '', ink: '', width: '%', duration: '' },
  setup: function(el, s) {
    var text    = s.where === 'text';
    var restore = function() {};
    var inline  = function() {};
    var a       = µ._mjs_fxDeg(s.direction, 105);
    var v       = µ._mjs_fxVec(a);
    var keys;
    el.style.setProperty('--mjs-fx-shine-a', a + 'deg');
    if (text) {
      // la bande, au milieu d'une image 2,5 fois plus grande que la balise, part d'un côté de la balise
      // et sort par l'autre : sa position glisse de 50 % ± 100 % sur chaque axe, dans le sens du chemin
      var pos = function(k) { return Math.round((50 + 100 * k * v.x) * 10) / 10 + '% ' + Math.round((50 + 100 * k * v.y) * 10) / 10 + '%'; };
      µ._mjs_dom.setAttribute(el, 'mjs-fx-shine-text', '');
      el.style.setProperty('--mjs-fx-shine-from', pos(1));
      el.style.setProperty('--mjs-fx-shine-to', pos(-1));
      keys = ['--mjs-fx-shine-a', '--mjs-fx-shine-from', '--mjs-fx-shine-to'];
    }
    else {
      restore = µ._mjs_fxRelative(el);
      // une balise en ligne ne rogne pas ce qui la déborde : sans `inline-block`, la bande au repos se
      // verrait à côté d'elle
      inline = µ._mjs_fxMovable(el);
      // la bande traverse la balise dans le sens du chemin : ±120 % de la balise sur chaque axe
      var k = function(x) { return Math.round(120 * x * 10) / 10 + '%'; };
      el.style.setProperty('--mjs-fx-shine-fx', k(-v.x));
      el.style.setProperty('--mjs-fx-shine-fy', k(-v.y));
      el.style.setProperty('--mjs-fx-shine-tx', k(v.x));
      el.style.setProperty('--mjs-fx-shine-ty', k(v.y));
      keys = ['--mjs-fx-shine-a', '--mjs-fx-shine-fx', '--mjs-fx-shine-fy', '--mjs-fx-shine-tx', '--mjs-fx-shine-ty'];
    }
    var on    = s.on || 'hover';
    var pass  = function() { µ._mjs_fxPlay(el, 'shine'); };
    var timer = null;
    // hover avec `every` écrit : les passages se suivent pendant le survol, le premier à l'entrée de la souris, la souris qui sort
    // coupe celui en cours ; always, view : le premier tout de suite (à la pose, à l'arrivée à l'écran), les suivants calés sur l'horloge
    // commune des effets qui se répètent, un tour entier au moins après lui (la cadence relue à chaque passage)
    var hold  = on === 'hover' && s.every !== void 0;
    var every = function() { return Math.max(100, µ._mjs_fxEvery(el, s.every, 3000)); };
    var stop;
    if (on === 'always' || on === 'view' || hold) {
      stop = µ._mjs_fxRun(el, on, function() {
        if (timer) return;
        pass();
        if (!hold) {
          timer = µ._mjs_fxBeat(every, pass, every());
          return;
        }
        var loop = setInterval(pass, every());
        timer = function() { clearInterval(loop); };
      }, function() {
        if (timer) timer();
        timer = null;
        if (hold) µ._mjs_fxPlay(el, 'shine', true);
      });
    }
    else stop = µ._mjs_fxWhen(el, on, pass);
    return function() {
      stop();
      if (timer) timer();
      µ._mjs_fxPlay(el, 'shine', true);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-shine-text');
      keys.forEach(function(p) { el.style.removeProperty(p); });
      restore();
      inline();
    };
  }
};
