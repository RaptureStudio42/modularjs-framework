// mjs_fx_peel — `*peel` : un coin de page qui se soulève. Un calque posé au-dessus du contenu (dans
// le composant si la balise en est un), qui ne capte pas les clics — le contenu reste cliquable hors
// du coin : un triangle de découpe (`clip-path`) montre le dessous à la place du coin, et le dos de la
// page, un triangle replié de l'autre côté du pli, le recouvre. Réglages : corner (le coin : top-right,
// top-left, bottom-right, bottom-left ; top-right), size (la taille du coin soulevé au repos, en px ;
// 40), grow (sa taille quand l'effet est actif, en px ; 90), on (hover ; view : dès l'arrivée à
// l'écran ; click : chaque clic bascule ; always : toujours soulevé), color (le dos de la page ;
// #f5f5f5), under (ce qu'on voit dessous ; #111827), image (une image dessous à la place de la
// couleur), shadow (l'ombre du pli ; true), duration (300ms), easing (ease). « Réduire les animations » :
// le coin change de taille sans transition.

// par coin : le triangle du dessous (taille x), la place du dos de la page et son triangle, la direction
// de l'ombrage (vers le pli)
var _MJS_FX_PEELS = {
  'top-right': { under: function(x) { return 'polygon(calc(100% - ' + x + ') 0,100% 0,100% ' + x + ')'; }, side: 'top:0;right:0', flap: 'polygon(0 0,100% 100%,0 100%)', angle: '45deg' },
  'top-left': { under: function(x) { return 'polygon(0 0,' + x + ' 0,0 ' + x + ')'; }, side: 'top:0;left:0', flap: 'polygon(100% 0,0 100%,100% 100%)', angle: '315deg' },
  'bottom-right': { under: function(x) { return 'polygon(100% 100%,calc(100% - ' + x + ') 100%,100% calc(100% - ' + x + '))'; }, side: 'bottom:0;right:0', flap: 'polygon(0 0,100% 0,0 100%)', angle: '135deg' },
  'bottom-left': { under: function(x) { return 'polygon(0 100%,' + x + ' 100%,0 calc(100% - ' + x + '))'; }, side: 'bottom:0;left:0', flap: 'polygon(0 0,100% 100%,100% 0)', angle: '225deg' }
};

var _mjsFxPeelRest = 'var(--mjs-peel-size,40px)';
var _mjsFxPeelUp   = 'var(--mjs-peel-grow,90px)';
var _mjsFxPeelTime = 'var(--mjs-peel-duration,300ms) var(--mjs-peel-easing,ease)';

var _mjsFxPeelCss = function() {
  var css = '[mjs-fx-layer="peel"]{position:absolute;inset:0;pointer-events:none}'
    + '[mjs-fx-layer="peel"][mjs-fx-peel-shadow]{filter:drop-shadow(-2px 3px 5px rgba(0,0,0,.4))}'
    + '[mjs-fx-layer="peel"] i,[mjs-fx-layer="peel"] b{position:absolute;display:block}'
    + '[mjs-fx-layer="peel"] i{inset:0;background:var(--mjs-peel-under,#111827);transition:clip-path ' + _mjsFxPeelTime + '}'
    + '[mjs-fx-layer="peel"][mjs-fx-peel-image] i{background:var(--mjs-fx-peel-img) center/cover no-repeat,var(--mjs-peel-under,#111827)}'
    + '[mjs-fx-layer="peel"] b{width:' + _mjsFxPeelRest + ';height:' + _mjsFxPeelRest + ';transition:width ' + _mjsFxPeelTime + ',height ' + _mjsFxPeelTime + '}';
  var on = '[mjs-fx-on~="peel"] > [mjs-fx-layer="peel"]';
  var up = ':host([mjs-fx-on~="peel"]) > [mjs-fx-layer="peel"]';
  for (var c in _MJS_FX_PEELS) {
    var p   = _MJS_FX_PEELS[c];
    var sel = '[mjs-fx-layer="peel"][mjs-fx-peel-corner="' + c + '"]';
    css += sel + ' i{clip-path:' + p.under(_mjsFxPeelRest) + '}'
      + sel + ' b{' + p.side + ';clip-path:' + p.flap + ';background:linear-gradient(' + p.angle + ',transparent 20%,rgba(0,0,0,.25) 50%),var(--mjs-peel-color,#f5f5f5)}';
    // actif : le coin grandit (les deux formes de sélecteur : balise dans un composant, ou composant lui-même)
    var tag = '[mjs-fx-peel-corner="' + c + '"]';
    css += on + tag + ' i,' + up + tag + ' i{clip-path:' + p.under(_mjsFxPeelUp) + '}'
      + on + tag + ' b,' + up + tag + ' b{width:' + _mjsFxPeelUp + ';height:' + _mjsFxPeelUp + '}';
  }
  css += '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="peel"] i,[mjs-fx-layer="peel"] b{transition:none}}';
  return css;
};

µ._mjs_fxDefs.peel = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  image: true,
  css: _mjsFxPeelCss(),
  vars: { size: 'px', grow: 'px', color: '', under: '', duration: '', easing: '' },
  setup: function(el, s) {
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'peel');
    var restore = µ._mjs_fxRelative(el);
    var layer   = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'peel');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('mjs-fx-peel-corner', _MJS_FX_PEELS[s.corner] ? s.corner : 'top-right');
    if (s.shadow !== false) layer.setAttribute('mjs-fx-peel-shadow', '');
    var img = µ._mjs_fxImage(s.image, el);
    if (img) {
      layer.setAttribute('mjs-fx-peel-image', '');
      layer.style.setProperty('--mjs-fx-peel-img', 'url(' + JSON.stringify(img) + ')');
    }
    layer.appendChild(document.createElement('i'));
    layer.appendChild(document.createElement('b'));
    µ._mjs_dom.appendChild(host, layer);
    var gate = µ._mjs_fxState(el, 'peel', s.on);
    return function() {
      gate();
      layer.remove();
      restore();
    };
  }
};
