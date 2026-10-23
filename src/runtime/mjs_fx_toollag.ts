// mjs_fx_toollag — le retard d'un suivi (une valeur qui rattrape sa cible), le même à toute cadence d'écran
//   µ._mjs_fxLag(smooth, now, last)   la part de l'écart rattrapée depuis l'image `last` (ms, 0 à la première) : `smooth` est la part rattrapée
//                                     par image à 60 images par seconde ; le temps écoulé est plafonné à 100 ms, une première image vaut 60 Hz
// le réglage « retard » lui-même : mjs_fx_toolsmooth.ts ; embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxLag = function(smooth, now, last) {
  return smooth >= 1 ? 1 : 1 - Math.pow(1 - smooth, (last ? Math.min(now - last, 100) : 16.667) / 16.667);
};
