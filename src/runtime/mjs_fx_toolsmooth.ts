// mjs_fx_toolsmooth — le réglage « retard » (`smooth`) d'un suivi, ramené entre 0.01 et 1 : un 0 ou un négatif ne rattraperait jamais la cible
//   µ._mjs_fxLagSetting(v, absent)    1 = collé à la cible ; `absent` quand ce n'est pas un nombre (rien, null, '', texte)
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxLagSetting = function(v, absent) {
  var n = +v;
  return v == null || v === '' || isNaN(n) ? absent : Math.min(1, Math.max(0.01, n));
};
