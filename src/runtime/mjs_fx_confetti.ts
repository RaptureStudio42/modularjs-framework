// mjs_fx_confetti — `*confetti` : une gerbe de confettis part de la balise (du point cliqué pour un
// clic). Les confettis volent dans toute la page (posés dans le document) et disparaissent seuls.
// Réglages : count (nombre ; 40), on (view, hover, click, load ; click), colors (les couleurs ; aussi
// par thème : `$$confetti-colors`), direction (le sens de la gerbe : un mot ou un angle ; up), spread
// (son ouverture en degrés ; 360 = dans tous les sens), power (la distance de vol en px ; 140).

µ._mjs_fxDefs.confetti = {
  css: '[mjs-fx-confetto]{position:fixed;width:8px;height:12px;border-radius:2px;pointer-events:none;z-index:2147483647;animation:mjs-fx-confetti 1.2s ease-out forwards}'
    + '@keyframes mjs-fx-confetti{to{transform:translate(var(--dx),var(--dy)) rotate(var(--rot));opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-confetto]{display:none}}',
  vars: {},
  // le vol des confettis (une sortie `@out=*confetti` l'attend)
  span: function() { return 1200; },
  setup: function(el, s) {
    µ._mjs_fxAdopt(document, 'confetti');
    var pieces = [];
    var burst = function(e) {
      if (µ._mjs_fxCalm()) return;
      var r      = µ._mjs_dom.getBoundingClientRect(el);
      // le point cliqué ; un clic venu du clavier (Entrée, Espace) n'en a pas (detail 0, point en 0, 0) :
      // le milieu de la balise
      var at     = e && e.type === 'click' && e.detail > 0;
      var x      = at ? e.clientX : r.left + r.width / 2;
      var y      = at ? e.clientY : r.top + r.height / 2;
      var pal    = s.colors || µ._mjs_fxList(el, '--mjs-confetti-colors') || ['#ff4fa3', '#22d3ee', '#facc15', '#7c3aed'];
      var spread = (s.spread === void 0 ? 360 : s.spread) * Math.PI / 180;
      // l'angle du milieu de la gerbe, compté comme à l'écran (0 = vers la droite, y vers le bas)
      var axis   = (µ._mjs_fxDeg(s.direction, 0) - 90) * Math.PI / 180;
      var power  = s.power === void 0 ? 140 : s.power;
      var lot    = [];
      for (var i = 0; i < µ._mjs_fxCount(s.count || 40); i++) {
        var p = document.createElement('span');
        p.setAttribute('mjs-fx-confetto', '');
        p.setAttribute('aria-hidden', 'true');
        var a = axis + (Math.random() - 0.5) * spread;
        var d = power * (0.43 + Math.random());
        p.style.left       = x + 'px';
        p.style.top        = y + 'px';
        p.style.background = pal[i % pal.length];
        p.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
        p.style.setProperty('--dy', (Math.sin(a) * d + 80).toFixed(1) + 'px');
        p.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
        p.addEventListener('animationend', function() { this.remove(); });
        document.body.appendChild(p);
        lot.push(p);
      }
      pieces = pieces.concat(lot);
      // filet : sans fin d'animation (onglet caché…), les confettis de cette gerbe partent quand même,
      // pas ceux des gerbes suivantes, encore en vol
      setTimeout(function() {
        for (var j = 0; j < lot.length; j++) lot[j].remove();
        pieces = pieces.filter(function(q) { return lot.indexOf(q) < 0; });
      }, 2000);
    };
    var stop = µ._mjs_fxWhen(el, s.on || 'click', burst);
    return function() {
      stop();
      for (var j = 0; j < pieces.length; j++) pieces[j].remove();
    };
  }
};
