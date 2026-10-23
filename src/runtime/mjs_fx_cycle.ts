// mjs_fx_cycle — `*cycle` : des mots qui se relaient à la place du texte de la balise (« Nous créons
// des [sites · applis · logos] »). Le texte écrit dans la balise est le premier mot (il reste dans la
// page prérendue) ; `words` donne les suivants : `<span *cycle([applis, logos])>sites</span>`. Sur un
// calque posé par-dessus le texte, qui reste en place ; une balise en ligne prend la largeur du mot
// affiché. Le calque est caché aux lecteurs d'écran : un texte qu'ils sont seuls à lire donne les mots
// qui suivent celui de la balise.
// Réglages : words, style (le passage d'un mot à l'autre : slide — le nouveau mot pousse l'ancien dans
// le sens de `direction` —, flip, fade, blur, zoom ; frame — le mot en creux, qu'un cadre lumineux
// balaie et remplit — ; type — une machine à écrire, lettre à lettre, avec son curseur ; slide),
// direction (slide : up, down, left, right ; up), speed (le temps d'un mot ; frame et type : celui de
// son cadre ou de sa frappe, après `delay` ; 2.5s), duration (le relais de slide à zoom ; 500ms),
// color (frame et type : le cadre, le creux et le curseur ; #01fe87), delay (frame et type : la pause
// avant chaque mot, le cadre fermé ou la ligne vide ; 500ms), cursor (type : le curseur ; oui),
// outside (frame : le mot hors du cadre — hidden : il n'existe que dans le cadre ; hollow : en creux ;
// visible : plein, le cadre passe dessus ; hidden), on (always, hover, view, click : un tour des mots
// par clic, load : un tour à l'apparition).
// frame : le cadre vit dans la boîte du mot (marges comprises) — il ne déborde jamais sur le texte
// d'avant, et se referme jusqu'à ce que ses deux bords se touchent ; chaque mot a son propre cadre, dont
// l'animation attend `delay` puis dure `speed`.

µ._mjs_fxDefs.cycle = {
  css: '[mjs-fx~="cycle"] [mjs-fx-layer="text"]{white-space:nowrap}'
    + '[mjs-fx~="cycle"][mjs-fx-cycle-fit]{width:var(--mjs-fx-cycle-w,auto);white-space:nowrap;vertical-align:bottom}'
    // la transition de la largeur s'ajoute à celle de l'auteur (µ._mjs_fxTransition)
    + '[mjs-fx~="cycle"][mjs-fx-cycle-fit]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    // frame et type n'ont pas de relais : la balise suit la largeur du mot en .3s
    + '[mjs-fx~="cycle"][mjs-fx-cycle-fit][mjs-fx-cycle-style="frame"],[mjs-fx~="cycle"][mjs-fx-cycle-fit][mjs-fx-cycle-style="type"]{--mjs-fx-cycle-d:.3s}'
    // le texte des lecteurs d'écran : hors de la mise en page, rien de peint
    + '[mjs-fx-layer="words"]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'
    + '[mjs-fx-cycle-box]{position:relative;display:inline-block;overflow:hidden;vertical-align:top;perspective:400px}'
    + '[mjs-fx-cycle-word]{display:inline-block;white-space:nowrap}'
    + '[mjs-fx-cycle-word][mjs-fx-cycle-in]{animation:var(--mjs-fx-cycle-in,mjs-fx-cycle-slide-in) var(--mjs-cycle-duration,500ms) ease both}'
    + '[mjs-fx-cycle-word][mjs-fx-cycle-out]{position:absolute;left:0;top:0;animation:var(--mjs-fx-cycle-out,mjs-fx-cycle-slide-out) var(--mjs-cycle-duration,500ms) ease both}'
    + ['flip', 'fade', 'blur', 'zoom'].map(function(n) {
      return '[mjs-fx~="cycle"][mjs-fx-cycle-style="' + n + '"]{--mjs-fx-cycle-in:mjs-fx-cycle-' + n + '-in;--mjs-fx-cycle-out:mjs-fx-cycle-' + n + '-out}';
    }).join('')
    // slide : le nouveau mot arrive du côté opposé au mouvement, l'ancien part dans son sens
    + '@keyframes mjs-fx-cycle-slide-in{from{opacity:0;transform:translate(calc(var(--mjs-fx-cycle-x,0) * -100%),calc(var(--mjs-fx-cycle-y,-1) * -100%))}}'
    + '@keyframes mjs-fx-cycle-slide-out{to{opacity:0;transform:translate(calc(var(--mjs-fx-cycle-x,0) * 100%),calc(var(--mjs-fx-cycle-y,-1) * 100%))}}'
    + '@keyframes mjs-fx-cycle-flip-in{from{opacity:0;transform:rotateX(90deg)}}'
    + '@keyframes mjs-fx-cycle-flip-out{to{opacity:0;transform:rotateX(-90deg)}}'
    + '@keyframes mjs-fx-cycle-fade-in{from{opacity:0}}'
    + '@keyframes mjs-fx-cycle-fade-out{to{opacity:0}}'
    + '@keyframes mjs-fx-cycle-blur-in{from{opacity:0;filter:blur(8px)}}'
    + '@keyframes mjs-fx-cycle-blur-out{to{opacity:0;filter:blur(8px)}}'
    + '@keyframes mjs-fx-cycle-zoom-in{from{opacity:0;transform:scale(.4)}}'
    + '@keyframes mjs-fx-cycle-zoom-out{to{opacity:0;transform:scale(1.6)}}'
    // frame et type : le mot droit dans le calque, sans boîte qui le rogne (le cadre et sa lueur en débordent)
    + '[mjs-fx-layer="text"]>[mjs-fx-cycle-word]{position:relative}'
    + '[mjs-fx-cycle-sizer]{position:absolute;visibility:hidden;white-space:nowrap}'
    + '[mjs-fx~="cycle"][mjs-fx-cycle-style="frame"] [mjs-fx-cycle-word],[mjs-fx~="cycle"][mjs-fx-cycle-style="frame"] [mjs-fx-cycle-sizer]{padding:0 .18em}'
    // hors du cadre, le mot ne se voit pas ; `outside: hollow` : il s'y voit en creux, le temps que le
    // cadre est ouvert ; `outside: visible` : plein, de la couleur du texte
    + '[mjs-fx~="cycle"][mjs-fx-cycle-style="frame"] [mjs-fx-cycle-word]{-webkit-text-fill-color:transparent}'
    + '[mjs-fx~="cycle"][mjs-fx-cycle-outside="hollow"][mjs-fx-cycle-style="frame"] [mjs-fx-cycle-word]{-webkit-text-stroke:1px var(--mjs-cycle-color,#01fe87);animation:mjs-fx-cycle-stroke var(--mjs-cycle-speed,2.5s) linear var(--mjs-cycle-delay,.5s) 1 both}'
    + '[mjs-fx~="cycle"][mjs-fx-cycle-outside="visible"][mjs-fx-cycle-style="frame"] [mjs-fx-cycle-word]{-webkit-text-fill-color:currentColor}'
    + '[mjs-fx-cycle-fill]{position:absolute;top:-.11em;left:0;width:4px;height:calc(100% + .22em);box-sizing:border-box;overflow:hidden;white-space:nowrap;-webkit-text-fill-color:var(--mjs-cycle-color,#01fe87);-webkit-text-stroke:0;border:2px solid var(--mjs-cycle-color,#01fe87);border-radius:10px;filter:drop-shadow(0 0 5px var(--mjs-cycle-color,#01fe87)) drop-shadow(0 0 25px var(--mjs-cycle-color,#01fe87));animation:mjs-fx-cycle-sweep var(--mjs-cycle-speed,2.5s) linear var(--mjs-cycle-delay,.5s) 1 both}'
    + '[mjs-fx-cycle-ink]{position:absolute;top:calc(.11em - 2px);left:calc(.18em - 2px)}'
    + '[mjs-fx-cycle-caret]{display:inline-block;width:.07em;height:1em;margin-left:.06em;vertical-align:-.12em;background:var(--mjs-cycle-color,#01fe87);animation:mjs-fx-cycle-blink 1s steps(1) infinite}'
    + '@keyframes mjs-fx-cycle-sweep{0%,100%{width:4px}67%,89%{width:100%}}'
    + '@keyframes mjs-fx-cycle-stroke{0%{-webkit-text-stroke-color:transparent}17%,89%{-webkit-text-stroke-color:var(--mjs-cycle-color,#01fe87)}100%{-webkit-text-stroke-color:transparent}}'
    + '@keyframes mjs-fx-cycle-blink{50%{opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="cycle"][mjs-fx-cycle-fit]{transition:none}[mjs-fx-cycle-word][mjs-fx-cycle-in],[mjs-fx-cycle-word][mjs-fx-cycle-out]{animation:none}[mjs-fx-cycle-word][mjs-fx-cycle-out]{display:none}[mjs-fx~="cycle"][mjs-fx-cycle-style="frame"] [mjs-fx-cycle-word]{animation:none;-webkit-text-fill-color:currentColor;-webkit-text-stroke:0}[mjs-fx-cycle-fill]{display:none}[mjs-fx-cycle-caret]{animation:none}}',
  vars: { duration: '', color: '', speed: '', delay: '' },
  setup: function(el, s, comp) {
    var style = /^(flip|fade|blur|zoom|frame|type)$/.test(s.style) ? s.style : 'slide';
    var draw  = style === 'frame' || style === 'type';
    µ._mjs_dom.setAttribute(el, 'mjs-fx-cycle-style', style);
    if (draw && (s.outside === 'hollow' || s.outside === 'visible')) µ._mjs_dom.setAttribute(el, 'mjs-fx-cycle-outside', s.outside);
    if (!draw) {
      var v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.direction] || [0, -1];
      el.style.setProperty('--mjs-fx-cycle-x', String(v[0]));
      el.style.setProperty('--mjs-fx-cycle-y', String(v[1]));
    }
    var restore = µ._mjs_fxMovable(el);
    var cs      = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (cs && /^inline/.test(cs.display)) µ._mjs_dom.setAttribute(el, 'mjs-fx-cycle-fit', '');
    var tr  = µ._mjs_dom.hasAttribute(el, 'mjs-fx-cycle-fit') ? µ._mjs_fxTransition(el, 'cycle', 'width var(--mjs-fx-cycle-d,var(--mjs-cycle-duration,500ms)) ease') : function() {};
    var say = _mjsFxCycleSay(el);
    var run = draw ? _mjsFxCycleDraw(el, s, comp, style, say) : _mjsFxCycleRelay(el, s, comp, say);
    var off = function() {
      run.off();
      say(null);
      el.style.removeProperty('--mjs-fx-cycle-w');
      el.style.removeProperty('--mjs-fx-cycle-x');
      el.style.removeProperty('--mjs-fx-cycle-y');
      tr();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-cycle-fit');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-cycle-style');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-cycle-outside');
      restore();
    };
    off.set = run.set;
    return off;
  }
};

// les mots pour les lecteurs d'écran : le calque leur est caché, le texte de la balise ne dit que le
// premier ; les suivants vont dans un texte qu'ils sont seuls à lire, marqué comme un calque (le texte
// propre de la balise n'en change pas, sa mise à jour ne relance rien), rangé avant le calque de texte,
// qui reste le dernier enfant de la balise. `say(mots, premier, calque)` — premier : le mot écrit dans la
// balise, déjà lu ; `say(null)` le retire. La copie figée qu'une relecture du HTML laisse (`innerHTML +=`)
// part
function _mjsFxCycleSay(el) {
  var said = null;
  return function(list, first, layer) {
    for (var c = el.firstChild, n; c; c = n) {
      n = c.nextSibling;
      if (c !== said && c.nodeType === 1 && µ._mjs_dom.getAttribute(c, 'mjs-fx-layer') === 'words') µ._mjs_dom.remove(c);
    }
    var rest = !list ? [] : first ? list.slice(1) : list;
    if (rest.length === 0) {
      if (said) µ._mjs_dom.remove(said);
      said = null;
      return;
    }
    if (!said) {
      said = document.createElement('span');
      said.setAttribute('mjs-fx-layer', 'words');
    }
    said.textContent = (first ? ', ' : '') + rest.join(', ');
    if (said.parentNode !== el) µ._mjs_dom.insertBefore(el, said, layer && layer.parentNode === el ? layer : null);
  };
}

// slide, flip, fade, blur, zoom : toutes les `speed`, l'ancien mot part (retiré à la fin du relais) et
// le nouveau arrive
function _mjsFxCycleRelay(el, s, comp, say) {
  var S     = Math.max(200, µ._mjs_fxMs(s.speed, 2500));
  var D     = Math.max(0, µ._mjs_fxMs(s.duration, 500));
  var list  = [];
  var i     = 0;
  var timer = null;
  var box   = null;
  // le relais demandé (start) : il part dès qu'il y a deux mots, même arrivés après
  var going = false;
  // le mot k : l'ancien part, le nouveau arrive ; la balise en ligne prend sa largeur
  var show = function(k, anim) {
    if (!box) return;
    var old = box.querySelector('[mjs-fx-cycle-word]:not([mjs-fx-cycle-out])');
    if (old) {
      if (anim) {
        old.setAttribute('mjs-fx-cycle-out', '');
        old.removeAttribute('mjs-fx-cycle-in');
        setTimeout(function() { old.remove(); }, D + 50);
      }
      else old.remove();
    }
    var w = document.createElement('span');
    w.setAttribute('mjs-fx-cycle-word', '');
    if (anim) w.setAttribute('mjs-fx-cycle-in', '');
    w.textContent = list[k] || '';
    box.appendChild(w);
    if (µ._mjs_dom.hasAttribute(el, 'mjs-fx-cycle-fit') && w.offsetWidth > 0) el.style.setProperty('--mjs-fx-cycle-w', w.offsetWidth + 'px');
  };
  var next = function() {
    i = (i + 1) % Math.max(1, list.length);
    show(i, true);
  };
  var start = function() {
    going = true;
    if (timer || list.length < 2) return;
    timer = setInterval(next, S);
  };
  var stop = function() {
    going = false;
    clearInterval(timer);
    timer = null;
    i = 0;
    show(0, false);
  };
  var tx = µ._mjs_fxLayer(comp, el, function(layer, txt) {
    var first = txt.trim();
    list = (first ? [first] : []).concat(s.words || []);
    say(list, first, layer);
    box  = document.createElement('span');
    box.setAttribute('mjs-fx-cycle-box', '');
    layer.appendChild(box);
    show(i < list.length ? i : 0, false);
    // le texte arrivé après la pose (une variable, une traduction en route) fait enfin deux mots
    if (going && !timer && list.length >= 2) timer = setInterval(next, S);
  });
  var gate = µ._mjs_fxRun(el, s.on, start, stop, S * Math.max(1, list.length));
  return {
    off: function() {
      gate();
      clearInterval(timer);
      tx.off();
    },
    // la durée du relais tenue par une variable : la feuille la lit, le départ de l'ancien mot aussi ; la
    // cadence : les mots repartent du premier, à la nouvelle (les autres réglages : l'effet repart)
    set: function(k, v) {
      if (k === 'duration') {
        D = Math.max(0, µ._mjs_fxMs(v, 500));
        return;
      }
      if (k !== 'speed') return false;
      S = Math.max(200, µ._mjs_fxMs(v, 2500));
      if (!timer) return;
      clearInterval(timer);
      i     = 0;
      show(0, false);
      timer = setInterval(next, S);
    }
  };
}

// frame et type : une horloge mène les mots, chacun dure delay + speed — frame : le cadre s'ouvre sur le
// mot puis se referme ; type : le mot tapé, gardé entier, puis effacé
function _mjsFxCycleDraw(el, s, comp, style, say) {
  var S     = Math.max(300, µ._mjs_fxMs(s.speed, 2500));
  var D     = Math.max(0, µ._mjs_fxMs(s.delay, 500));
  var T     = S + D;
  var list  = [];
  var shown = -1;
  var t0    = 0;
  var timer = null;
  var layer = null;
  var word  = null;
  // type : le texte tapé du mot (un seul nœud, devant le curseur) et son nombre de lettres
  var typed = null;
  var count = -1;
  // la largeur du mot entier : la balise en ligne s'y ajuste
  var fit = function(txt) {
    if (!µ._mjs_dom.hasAttribute(el, 'mjs-fx-cycle-fit') || !layer) return;
    var m = document.createElement('span');
    m.setAttribute('mjs-fx-cycle-sizer', '');
    m.textContent = txt;
    layer.appendChild(m);
    var w = m.offsetWidth;
    m.remove();
    if (w > 0) el.style.setProperty('--mjs-fx-cycle-w', (w + (style === 'type' ? Math.ceil(w * 0.02) + 4 : 0)) + 'px');
  };
  // le mot i, rendu entier (frame) ou tapé jusqu'à n lettres (type)
  var render = function(i, n) {
    if (!layer) return;
    var txt = list[i] || '';
    if (i !== shown) {
      shown = i;
      count = -1;
      layer.textContent = '';
      word = document.createElement('span');
      word.setAttribute('mjs-fx-cycle-word', '');
      layer.appendChild(word);
      fit(txt);
      if (style === 'frame') {
        word.textContent = txt;
        if (!µ._mjs_fxCalm()) {
          // le cadre, et dedans le mot plein, calé sur le mot en creux : le cadre qui s'ouvre le découvre
          var fill = document.createElement('span');
          fill.setAttribute('mjs-fx-cycle-fill', '');
          var ink = document.createElement('span');
          ink.setAttribute('mjs-fx-cycle-ink', '');
          ink.textContent = txt;
          fill.appendChild(ink);
          word.appendChild(fill);
        }
      }
      else {
        // le texte tapé puis le curseur, gardés tout le mot : le curseur clignote
        typed = document.createTextNode('');
        word.appendChild(typed);
        if (s.cursor !== false) {
          var caret = document.createElement('span');
          caret.setAttribute('mjs-fx-cycle-caret', '');
          word.appendChild(caret);
        }
      }
    }
    if (style === 'type') {
      var chars = µ._mjs_fxGraphemes(txt);
      var k     = n === void 0 ? chars.length : n;
      // rien à réécrire tant que le nombre de lettres ne change pas
      if (k === count) return;
      count = k;
      // un normalize() de la page retire le nœud de texte tant qu'il est vide : il revient devant le curseur
      if (!typed.parentNode) word.insertBefore(typed, word.firstChild);
      typed.data = chars.slice(0, k).join('');
    }
  };
  // l'horloge : un mot dure delay + speed ; le mot du moment, et pour type le nombre de lettres
  // (la pause : ligne vide ; puis 45 % frappe, 33 % mot entier, 22 % effacement)
  var tick = function() {
    var el2 = Date.now() - t0;
    var i   = Math.floor(el2 / T) % Math.max(1, list.length);
    if (style === 'frame' || µ._mjs_fxCalm()) {
      render(i);
      return;
    }
    var t   = el2 % T - D;
    var k   = t / S;
    var len = µ._mjs_fxGraphemes(list[i] || '').length;
    var n   = t < 0 ? 0 : k < .45 ? Math.ceil(k / .45 * len) : k < .78 ? len : Math.ceil((1 - k) / .22 * len);
    render(i, n);
  };
  var start = function() {
    if (timer) return;
    t0    = Date.now();
    shown = -1;
    tick();
    timer = setInterval(tick, style === 'type' ? 40 : 100);
  };
  var stop = function() {
    clearInterval(timer);
    timer = null;
    shown = -1;
    render(0);
  };
  var tx = µ._mjs_fxLayer(comp, el, function(l, txt) {
    layer = l;
    var first = txt.trim();
    list  = (first ? [first] : []).concat(s.words || []);
    say(list, first, l);
    shown = -1;
    if (timer) tick();
    else render(0);
  });
  var gate = µ._mjs_fxRun(el, s.on, start, stop, T * Math.max(1, list.length));
  return {
    off: function() {
      gate();
      clearInterval(timer);
      tx.off();
    },
    // la vitesse ou l'attente tenues par une variable : leur variable CSS suit (le moteur), l'horloge des
    // mots aussi — le mot en cours garde son début, il dure désormais delay + speed, comme son cadre
    // (animé en CSS, qui prend la nouvelle durée au même instant)
    set: function(k, v) {
      if (k !== 'speed' && k !== 'delay') return false;
      var n  = timer ? Math.floor((Date.now() - t0) / T) : 0;
      var at = t0 + n * T;
      if (k === 'speed') S = Math.max(300, µ._mjs_fxMs(v, 2500));
      else D = Math.max(0, µ._mjs_fxMs(v, 500));
      T = S + D;
      if (!timer) return;
      t0 = at - n * T;
      tick();
    }
  };
}
