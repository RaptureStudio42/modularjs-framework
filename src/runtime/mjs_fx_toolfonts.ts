// mjs_fx_toolfonts — reprendre une mesure à la fin de chaque chargement de police (*weight, *delta, *annotate)
//   var off = µ._mjs_fxOnFonts(f);
//   f()   appelée une fois à la fin de chaque chargement : `loading` (un chargement commence) arme l'attente ; la fin se dit par `ready`
//         (neuf à cet instant) et par `loadingdone` — WebKit n'émet que `loading` puis `ready`, Chromium résout `ready` après
//         `loadingdone`, Firefox avant. Le premier signal appelle `f` ; le second, son jumeau, non. Une police déjà en route à la pose
//         (son `loading` parti avant) est attendue de même
//   off() le retrait : plus aucun appel ensuite
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxOnFonts = function(f) {
  var fonts   = typeof document !== 'undefined' && document.fonts && typeof document.fonts === 'object' ? document.fonts : null;
  var waiting = false;
  var twin    = false;
  var dead    = false;
  var byReady = function() {
    if (!waiting || dead) return;
    waiting = false;
    twin    = true;
    f();
  };
  var byDone = function() {
    var paired = twin;
    twin       = false;
    waiting    = false;
    if (!paired && !dead) f();
  };
  var loading = function() {
    waiting = true;
    twin    = false;
    if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(byReady);
  };
  if (fonts && typeof fonts.addEventListener === 'function') {
    fonts.addEventListener('loading', loading);
    fonts.addEventListener('loadingdone', byDone);
  }
  if (fonts && fonts.status === 'loading') loading();
  return function() {
    dead = true;
    if (fonts && typeof fonts.removeEventListener === 'function') {
      fonts.removeEventListener('loading', loading);
      fonts.removeEventListener('loadingdone', byDone);
    }
  };
};
