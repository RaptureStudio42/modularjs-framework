// mjs_fx_toolbeat — la cadence des effets qui se répètent (*shine, *attention, *glitch, *annotate)
//   µ._mjs_fxEvery(el, v, dflt)
//         la cadence en ms : le réglage `every` écrit sur la balise (`v`), sinon la variable de thème commune `$$fx-every`
//         (`--mjs-fx-every`, lue sur la balise : posée par un `<theme>` ou un `<style>` plus haut), sinon le défaut de l'effet. La
//         variable passe la règle de `every` écrit sur la balise (une durée : 300ms, 1.5s, 0) : une valeur qu'elle refuse est ignorée,
//         l'effet garde son défaut, et le développement le dit une fois par valeur
//   var stop = µ._mjs_fxBeat(ms, f, wait)
//         l'horloge commune : `f(p)` à chaque multiple de la cadence compté depuis le début de la page — deux effets de même rythme,
//         posés à des moments différents, passent ensemble. `ms` : la cadence, ou une fonction qui la rend, relue à chaque tour (un
//         thème qui change en cours de route vaut dès le tour suivant ; `p` : la cadence relue) ; `wait` (ms) : le premier tour tombe
//         sur le premier multiple qui suit cette attente
//   stop() l'arrêt : plus aucun appel ensuite
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxEvery = function(el, v, dflt) {
  if (v !== void 0 && v !== null && v !== '') return µ._mjs_fxMs(v, dflt);
  var css = µ._mjs_fxCss(el, '--mjs-fx-every');
  // la règle de `every` tenu par une variable (la même qu'à la construction) : `-1s`, `2` sans unité, `abc` sont refusés
  if (µ._mjs_fxNorm(css, ['t'])[1] === 0) return µ._mjs_fxMs(css, dflt);
  // l'avis, une fois par valeur, est du développement (cf. µ._mjs_fxEveryWarn, mjs_fx.ts) : la production n'a pas la fonction
  if (µ._mjs_fxEveryWarn) µ._mjs_fxEveryWarn(el, css);
  return dflt;
};

µ._mjs_fxBeat = function(ms, f, wait) {
  var dead = false;
  var t    = null;
  var now  = function() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); };
  var pace = typeof ms === 'function' ? ms : function() { return ms; };
  // le premier tour après `from`, à la cadence `p` (1 ms au moins) ; compté sur l'horloge, une minuterie un peu en avance ou en retard ne
  // décale pas le suivant
  var next = function(from, p) {
    var step = Math.max(1, Math.round(p));
    var due  = (Math.floor(from / step) + 1) * step;
    t = setTimeout(function() {
      var q = pace();
      f(q);
      if (!dead) next(Math.max(due, now()), q);
    }, Math.max(0, due - now()));
  };
  next(now() + (wait || 0), pace());
  return function() {
    dead = true;
    clearTimeout(t);
  };
};
