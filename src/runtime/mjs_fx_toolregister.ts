// mjs_fx_toolregister — une variable CSS enregistrée SANS héritage : l'écrire ne relit que l'élément qui la porte, pas tout son contenu (les
// variables qu'un effet réécrit à chaque image) ; sans CSS.registerProperty, ou déjà enregistrée : rien ne se passe, la variable reste héritée
//   µ._mjs_fxRegister(name, syntax, initial)    `--mjs-fx-pile-d`, '<number>', '0'
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

µ._mjs_fxRegister = function(name, syntax, initial) {
  try {
    CSS.registerProperty({ name: name, syntax: syntax, inherits: false, initialValue: initial });
  }
  catch {}
};
