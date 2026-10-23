// mjs_fx_flash — `*flash` : la balise s'éclaire un instant, puis revient — le clignotement de µconsole
// quand il montre les mises à jour, en effet à part entière. Par défaut, à chaque changement de son
// contenu (`<td *flash>{$prix}</td>` : le prix réécrit, la case s'éclaire) ; `on` : change, load (une
// fois, à l'apparition), click, hover, view. Réglages : color (#facc15), duration (600ms), style
// (outline : un contour ; fill : un fond ; glow : un halo ; outline), on (change).
// L'éclair lui-même (µ._mjs_fxFlash) ne dépend pas du moteur des effets : le cœur de développement
// l'embarque seul pour µconsole, même dans une appli sans effet ; l'effet `*flash` s'inscrit au
// moteur quand il est là.

µ._mjs_fxFlash = function(el, s) {
  if (typeof el.animate !== 'function') return null;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  var c = s.color || '#facc15';
  var d = s.duration;
  d = typeof d === 'number' ? d : /ms$/.test(String(d)) ? parseFloat(d) : /s$/.test(String(d)) ? parseFloat(d) * 1000 : 600;
  var kf = s.style === 'fill'
    ? [{ backgroundColor: 'color-mix(in srgb, ' + c + ' 45%, transparent)', offset: 0 }]
    : s.style === 'glow'
    ? [{ boxShadow: '0 0 0 3px ' + c + ', 0 0 18px ' + c }, { boxShadow: '0 0 0 3px transparent, 0 0 18px transparent' }]
    : [{ outline: '2px solid ' + c, outlineOffset: '1px' }, { outline: '2px solid transparent', outlineOffset: '1px' }];
  // un éclair en cours sur la même balise repart de zéro
  if (el._mjs_flashAnim) {
    try {
      el._mjs_flashAnim.cancel();
    }
    catch (e) {}
  }
  var a = µ._mjs_animate(el, kf, { duration: isFinite(d) ? d : 600, easing: 'ease-out' });
  el._mjs_flashAnim = a;
  return a;
};

if (µ._mjs_fxDefs) {
  µ._mjs_fxDefs.flash = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
    setup: function(el, s) {
      var play = function() { µ._mjs_fxFlash(el, s); };
      if (s.on && s.on !== 'change') return µ._mjs_fxWhen(el, s.on, play);
      // le contenu suivi une fois le rendu fini : son premier texte n'est pas un changement
      var stop = null;
      var arm  = setTimeout(function() { stop = µ._mjs_fxOnText(el, play); }, 0);
      return function() {
        clearTimeout(arm);
        if (stop) stop();
      };
    }
  };
}
