// mjs_fx_toollabel — le libellé d'un effet dans la langue de la page (*guard, *offline, *loader, *spoiler, *flipcard)
//   µ._mjs_fxLabel(k)        le libellé `mjs.fx.<k>` : celui du projet (clés i18n `mjs.fx.*`), sinon celui du framework (fr, en),
//                            le français à défaut
//   µ._mjs_fxLabelKeep(fn)   écrit des libellés par `fn`, aussitôt : lus sans le fichier de la langue (réseau lent), `fn` les
//                            récrit à son arrivée s'il les surcharge (µ._mjs_labelKeep, mjs_i18n.ts) ; sans module i18n, `fn` seule
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxLabel = function(k) {
  var v = typeof µ._mjs_label === 'function' ? µ._mjs_label('fx', k) : void 0;
  if (v !== void 0) return v;
  var all = µ._runtimeLabels || {};
  var t = all[typeof µ._mjs_labelLang === 'function' ? µ._mjs_labelLang() : µ._runtimeLabelsLang] || all.fr || {};
  return t.fx ? t.fx[k] : '';
};

µ._mjs_fxLabelKeep = function(fn) {
  if (µ._mjs_labelKeep) µ._mjs_labelKeep(fn);
  else fn();
};
