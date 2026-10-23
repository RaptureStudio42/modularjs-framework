// mjs_fx_gauge — `*gauge` : un nombre se remplit comme une jauge, dans sa plage. La valeur : le
// nombre écrit dans la balise (`<span *gauge>{$volume}</span>`), ou le réglage `value` ; la plage :
// `min` et `max` écrits, sinon celle de la variable dans le bloc <vars> (`$volume int 0..100` — le
// compilateur passe son nom, `_bind`), sinon 0 à 100. La jauge est un calque sous le contenu de la
// balise (dans le composant, sur un composant). Réglages : color (la jauge ; #58a6ff), colors (la
// couleur suit la valeur, du bas au haut de la plage : [#22c55e, #eab308, #dc2626]), track (la
// partie vide ; rien), style (fill : la balise se remplit derrière son texte ; line : un trait le
// long de son bord ; ring : un anneau ; fill), direction (right, left, up, down ; right — ring :
// right et up tournent dans le sens des aiguilles), thickness (line, ring : l'épaisseur en px ; 4),
// opacity (fill : la force du remplissage ; 0.35), duration (le glissement d'une valeur à l'autre ;
// 300ms), easing (ease), value, min, max.

µ._mjs_fxDefs.gauge = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  css: '[mjs-fx~="gauge"]{isolation:isolate}'
    + '[mjs-fx-layer="gauge"]{position:absolute;inset:0;z-index:-1;border-radius:inherit;overflow:hidden;pointer-events:none;background:var(--mjs-gauge-track,transparent);transition:--mjs-fx-gauge-p var(--mjs-gauge-duration,300ms) var(--mjs-gauge-easing,ease)}'
    + '[mjs-fx-layer="gauge"] i{position:absolute;inset:0;display:block;background:var(--mjs-fx-gauge-c,var(--mjs-gauge-color,#58a6ff));opacity:var(--mjs-gauge-opacity,0.35);transform-origin:left center;transform:scaleX(var(--mjs-fx-gauge-p,0));transition:transform var(--mjs-gauge-duration,300ms) var(--mjs-gauge-easing,ease),background-color var(--mjs-gauge-duration,300ms)}'
    // le style et le sens, lus sur le calque (cf. setup)
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-dir="left"] i{transform-origin:right center}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-dir="up"] i{transform-origin:center bottom;transform:scaleY(var(--mjs-fx-gauge-p,0))}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-dir="down"] i{transform-origin:center top;transform:scaleY(var(--mjs-fx-gauge-p,0))}'
    // line : un trait le long du bord (en bas ; à gauche pour up et down), la partie vide dessous
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"]{background:none}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"]::before{content:"";position:absolute;left:0;right:0;bottom:0;height:var(--mjs-gauge-thickness,4px);background:var(--mjs-gauge-track,transparent)}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"] i{top:auto;height:var(--mjs-gauge-thickness,4px);opacity:1}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"][mjs-fx-gauge-dir="up"]::before,[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"][mjs-fx-gauge-dir="down"]::before{top:0;right:auto;width:var(--mjs-gauge-thickness,4px);height:auto}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"][mjs-fx-gauge-dir="up"] i,[mjs-fx-layer="gauge"][mjs-fx-gauge-style="line"][mjs-fx-gauge-dir="down"] i{top:0;right:auto;width:var(--mjs-gauge-thickness,4px);height:auto}'
    // ring : un anneau, la part de la valeur dans la couleur de la jauge, le reste dans celle du vide
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="ring"]{border-radius:50%;background:conic-gradient(var(--mjs-fx-gauge-c,var(--mjs-gauge-color,#58a6ff)) calc(var(--mjs-fx-gauge-p,0) * 360deg),var(--mjs-gauge-track,rgba(127,127,127,.2)) 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--mjs-gauge-thickness,4px)),#000 calc(100% - var(--mjs-gauge-thickness,4px) + .5px));mask:radial-gradient(farthest-side,transparent calc(100% - var(--mjs-gauge-thickness,4px)),#000 calc(100% - var(--mjs-gauge-thickness,4px) + .5px))}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="ring"][mjs-fx-gauge-dir="left"],[mjs-fx-layer="gauge"][mjs-fx-gauge-style="ring"][mjs-fx-gauge-dir="down"]{transform:scaleX(-1)}'
    + '[mjs-fx-layer="gauge"][mjs-fx-gauge-style="ring"] i{display:none}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="gauge"],[mjs-fx-layer="gauge"] i{transition:none}}',
  vars: { color: '', track: '', thickness: 'px', opacity: '', duration: '', easing: '' },
  setup: function(el, s, comp) {
    // la part animée : une propriété déclarée (CSS.registerProperty), sans quoi un anneau saute d'une
    // valeur à l'autre au lieu de glisser
    if (!µ._mjs_fxGaugeProp && typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function') {
      µ._mjs_fxGaugeProp = true;
      try {
        CSS.registerProperty({ name: '--mjs-fx-gauge-p', syntax: '<number>', inherits: true, initialValue: '0' });
      }
      catch (e) {}
    }
    var host = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'gauge');
    // la règle de la variable liée : ses bornes font la plage
    var rule = null;
    var b    = s._bind;
    if (typeof b === 'string') rule = b.slice(0, 2) === '$$' ? µ._mjs_storeRules && µ._mjs_storeRules[b.slice(2)] : comp && comp._mjs_types && comp._mjs_types[b.slice(1)];
    var lo   = typeof s.min === 'number' ? s.min : rule && typeof rule.a === 'number' ? rule.a : 0;
    var hi   = typeof s.max === 'number' ? s.max : rule && typeof rule.b === 'number' ? rule.b : 100;
    var num  = µ._mjs_fxNum({});
    var cur  = typeof s.value === 'number' ? s.value : null;
    var look = s.style === 'line' || s.style === 'ring' ? s.style : 'fill';
    var dir  = /^(left|up|down)$/.test(s.direction) ? s.direction : 'right';
    µ._mjs_dom.setAttribute(el, 'mjs-fx-gauge-style', look);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-gauge-dir', dir);
    var restore = µ._mjs_fxRelative(el);
    var layer = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'gauge');
    layer.setAttribute('aria-hidden', 'true');
    // le style et le sens aussi sur le calque, où la feuille les lit : sur un composant, le calque vit
    // dans son shadow root, d'où les attributs de la balise ne se voient pas
    layer.setAttribute('mjs-fx-gauge-style', look);
    layer.setAttribute('mjs-fx-gauge-dir', dir);
    layer.appendChild(document.createElement('i'));
    µ._mjs_dom.insertBefore(host, layer, host.firstChild);
    // la couleur à la part k de la plage, le long de la liste `colors`
    var tint = function(k) {
      var c = s.colors;
      if (!Array.isArray(c) || c.length === 0) return null;
      if (c.length === 1) return c[0];
      var x = k * (c.length - 1);
      var i = Math.min(c.length - 2, Math.floor(x));
      var t = Math.round((x - i) * 1000) / 10;
      return 'color-mix(in srgb, ' + c[i + 1] + ' ' + t + '%, ' + c[i] + ')';
    };
    var paint = function(v) {
      if (v === null || !isFinite(v)) return;
      var k = hi > lo ? (v - lo) / (hi - lo) : 0;
      k = k < 0 ? 0 : k > 1 ? 1 : Math.round(k * 10000) / 10000;
      layer.style.setProperty('--mjs-fx-gauge-p', String(k));
      var c = tint(k);
      if (c) layer.style.setProperty('--mjs-fx-gauge-c', c);
    };
    // la valeur : `value`, sinon le nombre écrit dans la balise, suivi
    var read = function(txt) { if (cur === null) paint(num.parse(txt)); };
    read(µ._mjs_fxOwnText(el));
    if (cur !== null) paint(cur);
    var watch = µ._mjs_fxOnText(el, read);
    var stop = function() {
      watch();
      layer.remove();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gauge-style');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-gauge-dir');
      restore();
    };
    // `value` tenu par une variable : la jauge glisse, sans être reposée
    stop.set = function(k, v) {
      if (k !== 'value') return false;
      cur = typeof v === 'number' ? v : null;
      if (cur !== null) paint(cur);
      else read(µ._mjs_fxOwnText(el));
    };
    return stop;
  }
};
