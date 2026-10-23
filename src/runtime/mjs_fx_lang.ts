// mjs_fx_lang — `*lang` : au changement de langue, les textes traduits se brouillent puis se
// recomposent, au lieu de sauter d'un coup. Posé sur `<@document>` : toute la page ; sur une balise
// (un composant compris) : les textes qu'elle contient. MJS prévient l'effet juste avant la bascule
// (µ._mjs_i18nSwapHooks, mjs_i18n.ts) : il regarde alors les composants traduits de sa zone, relève
// chaque texte que la bascule change (l'ancien, le nouveau) et l'anime ; le reste de la page n'est
// pas touché. Réglages : style (scramble : les lettres se brouillent et se posent de gauche à
// droite ; type : l'ancien texte s'efface lettre à lettre, le nouveau se tape), duration (600ms),
// chars (les caractères du brouillage).

µ._mjs_fxDefs.lang = {
  setup: function(el, s) {
    var style = s.style === 'type' ? 'type' : 'scramble';
    var dur   = µ._mjs_fxMs(s.duration, 600);
    // les caractères du brouillage, entiers (un émoji n'est jamais coupé en deux)
    var pool  = Array.from(s.chars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?');
    var page  = el === document.documentElement;
    var own   = new WeakMap();
    var live  = new Map();
    var mos   = [];
    var raf   = 0;
    var timer = null;
    // `n` dans `top`, à travers les composants
    var within = function(n, top) {
      for (var p = n; p; p = p.parentNode || p.host) if (p === top) return true;
      return false;
    };
    // une image de l'animation : k de 0 à 1
    var frame = function(a, k) {
      if (k >= 1) return a.to;
      if (style === 'type') {
        if (k < .45) return a.from.slice(0, Math.ceil(a.from.length * (1 - k / .45))).join('');
        return a.chars.slice(0, Math.ceil(a.chars.length * (k - .45) / .55)).join('');
      }
      var out = '';
      for (var i = 0; i < a.chars.length; i++) {
        var c = a.chars[i];
        out += k >= a.ranks[i] || /\s/.test(c) ? c : pool[Math.floor(Math.random() * pool.length)];
      }
      return out;
    };
    var write = function(node, a, k) {
      var txt = frame(a, k);
      own.set(node, txt);
      node.data = txt;
    };
    var tick = function(now) {
      raf = 0;
      live.forEach(function(a, node) {
        // réécrit entre-temps par l'appli : on la laisse faire
        if (node.data !== own.get(node)) { live.delete(node); return; }
        var k = Math.min(1, (now - a.t0) / dur);
        write(node, a, k);
        if (k >= 1) live.delete(node);
      });
      if (live.size > 0) raf = requestAnimationFrame(tick);
    };
    // un texte que la bascule vient de changer : la première image tout de suite (avant que l'écran ne
    // montre le nouveau texte), les suivantes à chaque image
    var start = function(node, from) {
      var to = node.data;
      if (from === to || µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') return;
      var chars = Array.from(to);
      var ranks = chars.map(function(_, i) { return (chars.length > 1 ? i / (chars.length - 1) : 0) * .6 + Math.random() * .4; });
      var a = { from: Array.from(from || ''), to: to, chars: chars, ranks: ranks, t0: typeof performance !== 'undefined' ? performance.now() : Date.now() };
      live.set(node, a);
      write(node, a, 0);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    var unwatch = function() {
      clearTimeout(timer);
      for (var i = 0; i < mos.length; i++) mos[i].disconnect();
      mos = [];
    };
    // la bascule arrive : les composants traduits de la zone sont regardés le temps de la vague
    var hook = function() {
      unwatch();
      if (typeof MutationObserver !== 'function' || !µ._mjs_i18nComps) return;
      µ._mjs_i18nComps.forEach(function(comp) {
        if (!page && !within(comp, el) && !within(el, comp)) return;
        var mo = new MutationObserver(function(list) {
          var first = new Map();
          for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.type !== 'characterData' || own.get(m.target) === m.target.data) continue;
            if (!page && !within(m.target, el)) continue;
            if (!first.has(m.target)) first.set(m.target, m.oldValue);
          }
          first.forEach(function(from, node) { start(node, from); });
        });
        mo.observe(comp._shadow || comp.shadowRoot || comp, { characterData: true, characterDataOldValue: true, subtree: true });
        mos.push(mo);
      });
      // la vague passée, on cesse de regarder
      timer = setTimeout(unwatch, 400);
    };
    (µ._mjs_i18nSwapHooks || (µ._mjs_i18nSwapHooks = new Set())).add(hook);
    return function() {
      µ._mjs_i18nSwapHooks.delete(hook);
      unwatch();
      if (raf) cancelAnimationFrame(raf);
      // un texte en plein brouillage retrouve sa vraie valeur
      live.forEach(function(a, node) { if (node.data === own.get(node)) node.data = a.to; });
      live.clear();
    };
  }
};
