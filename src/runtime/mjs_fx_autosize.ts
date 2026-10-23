// mjs_fx_autosize — `*autosize` : la boîte suit son contenu en douceur. Quand son contenu change (un
// bloc {if} qui s'ouvre, une liste qui s'allonge, un message d'erreur qui apparaît, une image qui
// arrive), sa taille glisse de l'ancienne à la nouvelle au lieu de sauter — ce que le CSS ne sait pas
// faire : on n'anime pas une hauteur vers `auto`. Le contenu change d'abord ; avant que l'écran ne se
// redessine, on lit la nouvelle taille et la boîte repart de l'ancienne pour la rejoindre (ce qui
// dépasse est masqué le temps du glissement). Un changement en plein glissement repart de la taille
// affichée. Sur un composant : son intérieur compte aussi. Réglages : duration (300ms), easing
// (ease), axis (height : la hauteur ; width : la largeur ; both : les deux).

// @@ dev
// l'avertissement du développement, une fois par balise : posé sur un champ (<textarea>, <input>), l'effet ne fait rien — ce qu'on y tape
// change la valeur du champ, pas son contenu. Son texte est du groupe `dev` des libellés, que le build de production n'écrit nulle part : seul
// un fichier entier le porte. Le registre des composants (`µ.instances`) n'existe qu'en développement : une construction de production qui
// embarquerait ce fichier entier reste muette
var _mjsFxAutosizeTold = typeof WeakSet === 'function' ? new WeakSet() : null;
var _mjsFxAutosizeTell = function(el) {
  if (!µ.instances) return;
  if (_mjsFxAutosizeTold) {
    if (_mjsFxAutosizeTold.has(el)) return;
    _mjsFxAutosizeTold.add(el);
  }
  µ.warn(µ._mjs_msg('dev.autosizeField', { tag: el.localName }, '*autosize : sur un <{tag}>, l\'effet ne fait rien — il fait glisser la taille d\'une boîte quand son contenu change (une balise ajoutée, un bloc qui s\'ouvre, une image qui arrive), et ce qu\'on tape dans un champ n\'en change pas le contenu. Posez *autosize sur la boîte dont le contenu change, par exemple celle qui entoure le champ et ses messages.'), el);
};
// @@

µ._mjs_fxDefs.autosize = {
  setup: function(el, s) {
    if (el.localName === 'textarea' || el.localName === 'input') _mjsFxAutosizeTell(el); // @@ dev
    var axis  = s.axis === 'width' || s.axis === 'both' ? s.axis : 'height';
    var dur   = µ._mjs_fxMs(s.duration, 300);
    var ease  = s.easing || 'ease';
    var inner = µ._mjs_fxInner(el);
    var anim  = null;
    var dead  = false;
    // la taille de mise en page, celle que les images clés écrivent : sans les transformations de la
    // balise ni de ses ancêtres (une carte réduite, un *zoom), que la boîte à l'écran compte. Une balise
    // sans taille de mise en page (un SVG, une boîte sans mise en page) : sa boîte à l'écran
    var measure = function() {
      if (el.offsetWidth > 0 || el.offsetHeight > 0) return { w: el.offsetWidth, h: el.offsetHeight };
      var r = µ._mjs_dom.getBoundingClientRect(el);
      return { w: r.width, h: r.height };
    };
    // la taille à l'écran quand rien ne glisse : le départ du prochain glissement
    var size = measure();
    var frame = function(z) {
      var k = { boxSizing: 'border-box' };
      if (axis !== 'width') k.height = z.h + 'px';
      if (axis !== 'height') k.width = z.w + 'px';
      return k;
    };
    var changed = function() {
      if (dead) return;
      // en plein glissement, la taille affichée ; sinon la dernière connue
      var from = anim ? measure() : size;
      if (anim) {
        anim.cancel();
        anim = null;
      }
      var to = measure();
      size = to;
      var dh = axis !== 'width' && Math.abs(to.h - from.h) > 0.5;
      var dw = axis !== 'height' && Math.abs(to.w - from.w) > 0.5;
      if (!(dh || dw) || !from.h && !from.w || typeof el.animate !== 'function' || µ._mjs_fxCalm()) return;
      var a = µ._mjs_animate(el, [Object.assign(frame(from), { overflow: 'hidden' }), Object.assign(frame(to), { overflow: 'hidden' })], { duration: dur, easing: ease });
      anim = a;
      a.onfinish = function() {
        if (anim !== a) return;
        anim = null;
        size = measure();
      };
    };
    // une mutation dans le calque d'un effet posé dedans (un compteur qui défile, des lettres qui
    // bougent : chaque image) : ces calques sont posés par-dessus le contenu, hors du flux — la boîte
    // n'en change pas, rien à mesurer
    var layered = function(m) {
      for (var p = m.target.nodeType === 1 ? m.target : m.target.parentNode; p && p !== el && p !== inner; p = p.parentNode) {
        if (p.nodeType === 1 && µ._mjs_dom.hasAttribute(p, 'mjs-fx-layer')) return true;
      }
      if (m.type !== 'childList') return false;
      var nodes = Array.prototype.slice.call(m.addedNodes).concat(Array.prototype.slice.call(m.removedNodes));
      return nodes.length > 0 && nodes.every(function(x) { return x.nodeType === 1 && µ._mjs_dom.hasAttribute(x, 'mjs-fx-layer'); });
    };
    // les changements du contenu (hors attribut style de la boîte, que personne ne touche ici)
    var mo = typeof MutationObserver === 'function' ? new MutationObserver(function(list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'attributes' && m.target === el && (m.attributeName === 'style' || /^mjs-fx/.test(m.attributeName))) continue;
        if (layered(m)) continue;
        changed();
        return;
      }
    }) : null;
    var opts = { childList: true, characterData: true, subtree: true, attributes: true };
    if (mo) {
      mo.observe(el, opts);
      if (inner) mo.observe(inner, opts);
    }
    // une image qui arrive change la taille sans toucher au contenu ; celle de l'intérieur d'un
    // composant ne sort pas de son shadow root (`load` n'en traverse pas la frontière)
    µ._mjs_dom.addEventListener(el, 'load', changed, true);
    if (inner) µ._mjs_dom.addEventListener(inner, 'load', changed, true);
    // une taille qui change sans lui (la fenêtre, une police) : retenue, sans glissement
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function() { if (!anim) size = measure(); }) : null;
    if (ro) ro.observe(el);
    return function() {
      dead = true;
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      µ._mjs_dom.removeEventListener(el, 'load', changed, true);
      if (inner) µ._mjs_dom.removeEventListener(inner, 'load', changed, true);
      if (anim) anim.cancel();
    };
  }
};
