// mjs_fx_crt — `*crt` : un vieil écran cathodique. Un calque par-dessus le contenu (dans le
// composant si la balise en est un), qui ne capte pas les clics : lignes de balayage, bande claire
// qui descend l'écran, scintillement, bords assombris, teinte de phosphore, halo sur le texte, coins
// bombés. Réglages : lines (le pas des lignes de balayage en px ; 3), opacity (leur noirceur, de 0 à
// 1 ; 0.35), flicker (le scintillement, de 0 à 1 ; 0.4), roll (une bande claire descend l'écran ;
// vrai), speed (la durée d'une descente de la bande ; 6s), vignette (les bords assombris, de 0 à 1 ;
// 0.5), tint (une teinte de phosphore par-dessus ; aucune), glow (un halo sur le texte de la balise,
// de 0 à 1 ; 0.3), radius (l'arrondi des coins en px ; 18), on (always, hover, view, click, load :
// la bande et le scintillement). « Réduire les animations » : lignes et bords fixes, ni
// scintillement ni bande.

(function() {
  var P = '[mjs-fx-layer="crt"]';
  µ._mjs_fxDefs.crt = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
    radius: true,
    css: '[mjs-fx~="crt"]{isolation:isolate}'
      + '[mjs-fx~="crt"]:not([mjs-fx-crt-flat]){text-shadow:0 0 calc(var(--mjs-crt-glow,.3) * 14px) currentColor}'
      + P + ',[mjs-fx-layer="crt-tint"]{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647;border-radius:inherit}'
      + '[mjs-fx-layer="crt-tint"]{background:var(--mjs-crt-tint,transparent);mix-blend-mode:color;opacity:.55}'
      + P + ' i{position:absolute;display:block;left:0;right:0;top:0;bottom:0}'
      + P + ' .mjs-fx-crt-lines{background:repeating-linear-gradient(to bottom,rgba(0,0,0,var(--mjs-crt-opacity,.35)) 0,rgba(0,0,0,var(--mjs-crt-opacity,.35)) calc(var(--mjs-crt-lines,3px) / 3),transparent calc(var(--mjs-crt-lines,3px) / 3),transparent var(--mjs-crt-lines,3px))}'
      + P + ' .mjs-fx-crt-vignette{background:radial-gradient(ellipse at center,transparent 45%,#000 100%);opacity:calc(var(--mjs-crt-vignette,.5) * 1.6)}'
      + P + ' .mjs-fx-crt-flick{background:#000;opacity:0;animation:var(--mjs-fx-crt-go,mjs-fx-crt-flick) .8s steps(1) 0s var(--mjs-fx-crt-times,infinite);animation-play-state:var(--mjs-fx-lite-play,running)}'
      + P + ' .mjs-fx-crt-roll{bottom:auto;height:34%;background:linear-gradient(transparent,rgba(255,255,255,.07),transparent);animation:var(--mjs-fx-crt-go,mjs-fx-crt-roll) var(--mjs-crt-speed,6s) linear 0s var(--mjs-fx-crt-times,infinite);animation-play-state:var(--mjs-fx-lite-play,running)}'
      + '@keyframes mjs-fx-crt-flick{0%{opacity:0}12%{opacity:calc(var(--mjs-crt-flicker,.4) * .3)}15%{opacity:0}44%{opacity:calc(var(--mjs-crt-flicker,.4) * .15)}47%{opacity:0}71%{opacity:calc(var(--mjs-crt-flicker,.4) * .25)}74%{opacity:0}}'
      + '@keyframes mjs-fx-crt-roll{from{transform:translateY(-100%)}to{transform:translateY(300%)}}'
      + '@media (prefers-reduced-motion:reduce){' + P + ' .mjs-fx-crt-flick,' + P + ' .mjs-fx-crt-roll{animation:none;display:none}}',
    vars: { lines: 'px', opacity: '', flicker: '', speed: '', vignette: '', tint: '', glow: '' },
    // effets économes : suivi (la bande et le scintillement tournent sans fin)
    heavy: true,
    setup: function(el, s) {
      var host = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'crt');
      var restore = µ._mjs_fxRelative(el);
      // les coins bombés : 18px tant que l'arrondi n'est pas écrit (écrit, le cœur le pose)
      var corner = el.style.borderRadius;
      if (s.radius === void 0) el.style.borderRadius = '18px';
      if (s.glow === 0) µ._mjs_dom.setAttribute(el, 'mjs-fx-crt-flat', '');
      var layer = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', 'crt');
      layer.setAttribute('aria-hidden', 'true');
      var parts = ['lines', 'vignette', 'flick'];
      if (s.roll !== false) parts.push('roll');
      for (var i = 0; i < parts.length; i++) {
        var part = document.createElement('i');
        part.className = 'mjs-fx-crt-' + parts[i];
        layer.appendChild(part);
      }
      µ._mjs_dom.appendChild(host, layer);
      // la teinte : un calque à part (un mélange de couleurs ne traverse pas le calque des lignes)
      var tint = null;
      var setTint = function(on) {
        if (on && !tint) {
          tint = document.createElement('span');
          tint.setAttribute('mjs-fx-layer', 'crt-tint');
          tint.setAttribute('aria-hidden', 'true');
          µ._mjs_dom.appendChild(host, tint);
        }
        else if (!on && tint) {
          tint.remove();
          tint = null;
        }
      };
      setTint(s.tint !== void 0 && s.tint !== null && s.tint !== '');
      var gate = µ._mjs_fxLoop(el, 'crt', s.on);
      var off  = function() {
        gate();
        layer.remove();
        setTint(false);
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-crt-flat');
        if (s.radius === void 0) el.style.borderRadius = corner;
        restore();
      };
      off.set = function(k, v) {
        if (k === 'tint') setTint(v !== void 0 && v !== null && v !== '');
        else if (k === 'glow') {
          if (v === 0) µ._mjs_dom.setAttribute(el, 'mjs-fx-crt-flat', '');
          else µ._mjs_dom.removeAttribute(el, 'mjs-fx-crt-flat');
        }
        else if (k !== 'lines' && k !== 'opacity' && k !== 'flicker' && k !== 'speed' && k !== 'vignette') return false;
      };
      return off;
    }
  };
})();
