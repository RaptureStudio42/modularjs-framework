// mjs_fx_toolcolor — une couleur CSS telle que le navigateur la voit SUR une balise (*blend, *filter)
//   µ._mjs_fxColorOn(el, c)   la couleur `c` lue sur `el` : var(), currentColor, color-mix()… résolus avec ses propres valeurs (une
//                             variable posée sur l'image elle-même, que ne verrait pas une sonde du parent) ; '' sans lecture
// La balise prête `caret-color` (sans effet sur elle) le temps d'une lecture, en `!important` et sans transition : une feuille de
// l'auteur ne fausse pas la lecture. Ses valeurs d'origine sont remises aussitôt, chaque propriété de `transition` à part (le raccourci
// relu vaut '' dès qu'une seule est écrite en ligne, et le retirer emporterait celle de l'auteur), et relues avant la transition : rien
// ne s'anime
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

var _MJS_FX_COLOR_TRANSITION = ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior'];

µ._mjs_fxColorOn = function(el, c) {
  if (typeof getComputedStyle !== 'function' || !el.style) return '';
  var st    = el.style;
  var caret = [st.getPropertyValue('caret-color'), st.getPropertyPriority('caret-color')];
  var trans = [];
  for (var i = 0; i < _MJS_FX_COLOR_TRANSITION.length; i++) trans.push([_MJS_FX_COLOR_TRANSITION[i], st.getPropertyValue(_MJS_FX_COLOR_TRANSITION[i]), st.getPropertyPriority(_MJS_FX_COLOR_TRANSITION[i])]);
  st.setProperty('transition', 'none', 'important');
  st.setProperty('caret-color', String(c), 'important');
  var seen = getComputedStyle(el).caretColor;
  if (caret[0]) st.setProperty('caret-color', caret[0], caret[1]);
  else st.removeProperty('caret-color');
  void getComputedStyle(el).caretColor;
  for (var j = 0; j < trans.length; j++) {
    if (trans[j][1]) st.setProperty(trans[j][0], trans[j][1], trans[j][2]);
    else st.removeProperty(trans[j][0]);
  }
  return seen || '';
};
