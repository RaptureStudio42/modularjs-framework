// mjs_fx_flipcard — `*flipcard` : une carte à deux faces qui se retourne en 3D. La balise porte DEUX
// enfants : le premier est le recto, le second le verso (`<div *flipcard><div>recto</div><div>verso</div></div>`) ;
// moins de deux, un avertissement en console et rien d'autre. Les deux faces prennent la même place
// (la plus grande des deux : la balise devient une grille d'une case) ; la face cachée porte `inert`,
// qui bascule avec la carte (pas cliquable, ni lue, ni atteinte au clavier). Au clavier, avec `on:
// hover` et `on: click`, l'effet place dans la carte une commande à elle, son premier enfant (un `<button>`
// marqué calque : ce n'est pas une face), que Tab atteint avant le contenu : « Retourner la carte » dans la
// langue de la page (fx_toollabel), pressée quand le verso est montré (`aria-pressed`), cachée hors du
// focus, retirée avec l'effet. La carte ne se dit jamais bouton : elle porte souvent des contrôles (le lien
// du recto, le bouton du verso), qu'un bouton ne peut contenir. Une balise focalisable d'elle-même, ou qui
// a déjà un tabindex, n'en reçoit pas : elle répond elle-même. Réglages : axis (y : la
// carte tourne autour de la verticale ; x : autour de l'horizontale ; y), on (hover : retournée au
// survol, et quand sa commande reçoit le focus au clavier, remise quand elle le perd ; Entrée et Espace
// la basculent — un lien ou un bouton garde son action —, Échap la remet ; tant que le focus est dans
// le verso retourné, elle ne revient pas ; click : chaque clic retourne, Entrée et Espace aussi — un clic
// sur un lien, un bouton, un champ ou une étiquette de la carte (même dans un composant) garde son action et ne la
// retourne pas, un clic sur l'une des deux faces la retourne, même si elle porte un tabindex ;
// view : se retourne à l'arrivée à l'écran ; none : seul `flipped` commande ; hover), flipped (l'état,
// à tenir par une variable : vrai = le verso ; false), reverse (tourne dans l'autre sens ; false),
// perspective (en px ; 1000), duration (600ms), easing (une courbe CSS, cubic-bezier(…) ou une courbe
// de µeasing comme bounce-out ; ease), shadow (une ombre sous la carte, qui suit sa forme ; true),
// radius (en px, l'arrondi des deux faces ; celui des faces).
// « Réduire les animations » : le changement de face est immédiat.

// une courbe → une fonction de temps CSS : un mot ou cubic-bezier(…) tels quels, une courbe de µeasing
// échantillonnée en linear(…) ; ease si on ne la connaît pas
function _mjsFxFlipEase(v) {
  if (v === void 0 || v === null || v === '') return 'ease';
  v = String(v);
  if (/^(?:linear|ease|ease-in|ease-out|ease-in-out)$/.test(v) || /^cubic-bezier\(/.test(v)) return v;
  var f = µ.easing && µ.easing[v.replace(/-(\w)/g, function(_, c) { return c.toUpperCase(); })];
  if (typeof f !== 'function') return 'ease';
  var pts = [];
  for (var i = 0; i <= 24; i++) pts.push(Math.round(f(i / 24) * 10000) / 10000);
  return 'linear(' + pts.join(',') + ')';
}

µ._mjs_fxDefs.flipcard = {
  css: '[mjs-fx~="flipcard"]{display:grid}'
    + '[mjs-fx~="flipcard"] > [mjs-fx-flipcard-face]{grid-area:1/1;backface-visibility:hidden;-webkit-backface-visibility:hidden;transition:transform var(--mjs-flipcard-duration,600ms) var(--mjs-fx-flipcard-ease,ease)}'
    + '[mjs-fx~="flipcard"] > [mjs-fx-flipcard-face="front"]{transform:perspective(var(--mjs-flipcard-perspective,1000px)) rotateY(calc(var(--mjs-fx-flipcard-t,0) * var(--mjs-fx-flipcard-s,1) * -180deg))}'
    + '[mjs-fx~="flipcard"] > [mjs-fx-flipcard-face="back"]{transform:perspective(var(--mjs-flipcard-perspective,1000px)) rotateY(calc((1 - var(--mjs-fx-flipcard-t,0)) * var(--mjs-fx-flipcard-s,1) * 180deg))}'
    + '[mjs-fx~="flipcard"][mjs-fx-flipcard-x] > [mjs-fx-flipcard-face="front"]{transform:perspective(var(--mjs-flipcard-perspective,1000px)) rotateX(calc(var(--mjs-fx-flipcard-t,0) * var(--mjs-fx-flipcard-s,1) * 180deg))}'
    + '[mjs-fx~="flipcard"][mjs-fx-flipcard-x] > [mjs-fx-flipcard-face="back"]{transform:perspective(var(--mjs-flipcard-perspective,1000px)) rotateX(calc((1 - var(--mjs-fx-flipcard-t,0)) * var(--mjs-fx-flipcard-s,1) * -180deg))}'
    + '[mjs-fx~="flipcard"][mjs-fx-flipcard-still] > [mjs-fx-flipcard-face]{transition:none}'
    + '[mjs-fx~="flipcard"][mjs-fx-flipcard-shadow]{filter:drop-shadow(0 10px 18px rgba(0,0,0,.35))}'
    + '[mjs-fx~="flipcard"][mjs-fx-flipcard-radius] > [mjs-fx-flipcard-face]{border-radius:var(--mjs-flipcard-radius)}'
    // la commande du clavier : dans la case des faces, en haut à droite, au-dessus d'elles ; cachée hors du focus
    + '[mjs-fx~="flipcard"] > [mjs-fx-flipcard-turn]{grid-area:1/1;align-self:start;justify-self:end;z-index:1;margin:4px;white-space:nowrap}'
    + '[mjs-fx~="flipcard"] > [mjs-fx-flipcard-turn]:not(:focus){width:1px;height:1px;margin:0;padding:0;border:0;overflow:hidden;clip-path:inset(50%)}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="flipcard"] > [mjs-fx-flipcard-face]{transition:none}}',
  vars: { perspective: 'px', duration: '', radius: 'px' },
  setup: function(el, s) {
    // les deux faces : les deux premiers enfants (un calque d'un autre effet n'en est pas un)
    var kids = function() {
      return Array.prototype.filter.call(el.children, function(c) { return !µ._mjs_dom.hasAttribute(c, 'mjs-fx-layer'); });
    };
    if (kids().length < 2) {
      µ.warn(µ._mjs_msg('flipcard', null, '*flipcard : la balise doit porter deux enfants — le premier est le recto, le second le verso. Ajoutez-lui le verso.'), el);
      return function() {};
    }
    var base   = !!s.flipped;
    var active = false;
    var hov    = false;
    var kb     = false;
    var held   = false;
    // retournée par le focus de sa commande, sans activation depuis
    var fresh  = false;
    var cmd    = null;
    var faces  = [];
    var hold   = function(f, yes) {
      if (!f) return;
      if (yes) {
        if (!µ._mjs_dom.hasAttribute(f, 'inert')) {
          µ._mjs_dom.setAttribute(f, 'inert', '');
          f._mjs_fxFlipInert = true;
        }
      }
      else if (f._mjs_fxFlipInert) {
        µ._mjs_dom.removeAttribute(f, 'inert');
        f._mjs_fxFlipInert = false;
      }
    };
    var apply = function() {
      var shown = base !== (active || hov || kb || held);
      el.style.setProperty('--mjs-fx-flipcard-t', shown ? '1' : '0');
      hold(faces[0], shown);
      hold(faces[1], !shown);
      if (cmd) µ._mjs_dom.setAttribute(cmd, 'aria-pressed', shown ? 'true' : 'false');
    };
    var mark = function() {
      var list = kids();
      for (var i = 0; i < faces.length; i++) {
        if (list.indexOf(faces[i]) !== i) {
          hold(faces[i], false);
          µ._mjs_dom.removeAttribute(faces[i], 'mjs-fx-flipcard-face');
        }
      }
      faces = list.slice(0, 2);
      if (faces.length > 0) µ._mjs_dom.setAttribute(faces[0], 'mjs-fx-flipcard-face', 'front');
      if (faces.length > 1) µ._mjs_dom.setAttribute(faces[1], 'mjs-fx-flipcard-face', 'back');
      apply();
    };
    if (s.axis === 'x') µ._mjs_dom.setAttribute(el, 'mjs-fx-flipcard-x', '');
    if (s.shadow !== false) µ._mjs_dom.setAttribute(el, 'mjs-fx-flipcard-shadow', '');
    if (s.radius !== void 0) µ._mjs_dom.setAttribute(el, 'mjs-fx-flipcard-radius', '');
    if (s.reverse) el.style.setProperty('--mjs-fx-flipcard-s', '-1');
    el.style.setProperty('--mjs-fx-flipcard-ease', _mjsFxFlipEase(s.easing));
    // posée d'emblée sur la bonne face, sans la faire tourner
    µ._mjs_dom.setAttribute(el, 'mjs-fx-flipcard-still', '');
    mark();
    var frame = requestAnimationFrame(function() {
      frame = requestAnimationFrame(function() {
        frame = 0;
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-flipcard-still');
      });
    });
    var undo = [];
    var on2  = function(ev, f) {
      µ._mjs_dom.addEventListener(el, ev, f);
      undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
    };
    var on     = s.on || 'hover';
    var native = /^(?:button|input|select|summary|textarea)$/.test(el.localName) || (el.localName === 'a' && µ._mjs_dom.hasAttribute(el, 'href'));
    // Tab doit atteindre la carte : sa commande, le premier de ses enfants ; jamais sur une balise focalisable d'elle-même ou qui a déjà
    // un tabindex. Un script qui réécrit le contenu de la carte l'emporte : elle revient avec les faces relues
    if ((on === 'hover' || on === 'click') && !native && !µ._mjs_dom.hasAttribute(el, 'tabindex')) {
      cmd = document.createElement('button');
      cmd.type = 'button';
      µ._mjs_dom.setAttribute(cmd, 'mjs-fx-layer', 'flipcard');
      µ._mjs_dom.setAttribute(cmd, 'mjs-fx-flipcard-turn', '');
      // son libellé : récrit à l'arrivée du fichier de la langue s'il le surcharge
      µ._mjs_fxLabelKeep(function() {
        if (cmd) cmd.textContent = µ._mjs_fxLabel('flip');
      });
      apply();
    }
    var key = cmd || el;
    var put = function() {
      if (cmd && cmd.parentNode !== el) µ._mjs_dom.insertBefore(el, cmd, el.firstChild);
    };
    put();
    // le focus pris au clavier retourne la carte ; un clic de souris qui donne le focus ne la retient pas
    var visible = function() {
      try {
        return µ._mjs_dom.matches(key, ':focus-visible');
      }
      catch {
        return true;
      }
    };
    if (on === 'hover') {
      on2('pointerenter', function() {
        hov = true;
        apply();
      });
      on2('pointerleave', function() {
        hov = false;
        apply();
      });
      on2('focusin', function(e) {
        if (faces[1] && µ._mjs_dom.contains(faces[1], e.target)) held = true;
        else if (e.target === key && visible()) {
          fresh = !kb;
          kb    = true;
        }
        apply();
      });
      on2('focusout', function(e) {
        var to = e.relatedTarget;
        held = !!(to && faces[1] && µ._mjs_dom.contains(faces[1], to));
        if (e.target === key && to !== key) {
          kb    = false;
          fresh = false;
        }
        else if (to === key && faces[1] && µ._mjs_dom.contains(faces[1], e.target)) kb = true;
        apply();
      });
      // la commande pressée (Entrée, Espace, un lecteur d'écran) bascule la carte ; un lecteur d'écran la focalise avant de la cliquer :
      // le clic qui suit le focus qui a retourné la carte la laisse retournée, le suivant la remet
      on2('click', function(e) {
        if (!cmd || e.target !== cmd) return;
        if (fresh) {
          fresh = false;
          return;
        }
        kb = !kb;
        apply();
      });
      on2('keydown', function(e) {
        // une touche : Entrée et Espace sur la commande la basculent, comme avant
        fresh = false;
        if (e.key === 'Escape') {
          if (!kb && !held) return;
          held = false;
          if (µ._mjs_dom.contains(el, e.target) && e.target !== key) µ._mjs_dom.focus(key);
          kb    = false;
          fresh = false;
          apply();
          return;
        }
        // un lien ou un bouton garde son action : c'est le focus qui le retourne
        if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ') || el.tabIndex < 0 || native) return;
        e.preventDefault();
        kb = !kb;
        apply();
      });
    }
    else if (on === 'click') {
      // un clic venu d'un lien, d'un bouton, d'un champ de la carte garde son action : elle ne se retourne pas (un clic
      // dans un champ du verso la remettait au recto, verso inerte sous la frappe ; Entrée sur un bouton aussi, son
      // clic remonte jusqu'à elle). Le chemin du clic est lu jusqu'à la carte, à travers les composants (`composedPath`) ;
      // un composant à ombre fermée n'y montre que lui-même : au clic de la souris, ce qui est sous elle dans son ombre est
      // lu (`elementFromPoint`, composants imbriqués compris — Safari ne donne pas le focus à un bouton cliqué), et il
      // compte quand il a pris le focus (Entrée sur son bouton, son champ). Les deux
      // faces ne sont pas des contrôles, même avec un tabindex, ni un élément à tabindex négatif (un titre qui reçoit le
      // focus par script, et que le clic focalise aussi) : un clic sur eux retourne la carte
      var ctrl = 'a[href],button,input,select,textarea,label,summary,[contenteditable],[tabindex]:not([tabindex^="-"])';
      var under = function(host, x, y) {
        var r   = host._shadow;
        var hit = r && typeof r.elementFromPoint === 'function' ? r.elementFromPoint(x, y) : null;
        for (var m = hit && r.contains(hit) ? hit : null; m && m !== r; m = m.parentNode) {
          if (µ._mjs_dom.matches(m, ctrl)) return true;
          if (m === hit && m._shadow && under(m, x, y)) return true;
        }
        return false;
      };
      var control = function(e) {
        var path = e.composedPath ? e.composedPath() : [e.target];
        var root = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
        for (var i = 0; i < path.length && path[i] !== el; i++) {
          var n = path[i];
          if (n.nodeType !== 1) continue;
          if (i === 0 && n._shadow && e.detail > 0 && under(n, e.clientX, e.clientY)) return true;
          if (faces.indexOf(n) >= 0) continue;
          if (µ._mjs_dom.matches(n, ctrl)) return true;
          if (n === root.activeElement && !µ._mjs_dom.matches(n, '[tabindex^="-"]')) return true;
        }
        return false;
      };
      // la commande est un bouton de la carte, pas une face : son clic la retourne
      var toggle = function(e) {
        if (e && e.type === 'click' && e.target !== cmd && control(e)) return;
        active = !active;
        apply();
      };
      on2('click', toggle);
      // au clavier : Entrée et Espace, si la balise ne répond pas déjà d'elle-même
      on2('keydown', function(e) {
        if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
        if (el.tabIndex < 0 || native) return;
        e.preventDefault();
        toggle();
      });
    }
    else if (on === 'view') {
      undo.push(µ._mjs_fxWhen(el, 'view', function() {
        active = true;
        apply();
      }));
    }
    // un enfant qui arrive ou part (un bloc {if}, une liste) : les faces sont relues
    var mo = typeof MutationObserver === 'function' ? new MutationObserver(function() {
      put();
      if (kids().length >= 2) mark();
    }) : null;
    if (mo) mo.observe(el, { childList: true });
    var off = function() {
      if (mo) mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (var i = 0; i < undo.length; i++) undo[i]();
      for (var j = 0; j < faces.length; j++) {
        hold(faces[j], false);
        µ._mjs_dom.removeAttribute(faces[j], 'mjs-fx-flipcard-face');
      }
      if (cmd) µ._mjs_dom.remove(cmd);
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-flipcard-x');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-flipcard-shadow');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-flipcard-radius');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-flipcard-still');
      el.style.removeProperty('--mjs-fx-flipcard-t');
      el.style.removeProperty('--mjs-fx-flipcard-s');
      el.style.removeProperty('--mjs-fx-flipcard-ease');
    };
    // `flipped` tenu par une variable : la carte va à la face demandée, sans reposer l'effet ; l'arrondi
    // et la courbe suivent aussi sur place
    off.set = function(k, v) {
      if (k === 'flipped') {
        base   = !!v;
        active = false;
        apply();
      }
      else if (k === 'easing') el.style.setProperty('--mjs-fx-flipcard-ease', _mjsFxFlipEase(v));
      else if (k === 'radius') {
        if (v === void 0) µ._mjs_dom.removeAttribute(el, 'mjs-fx-flipcard-radius');
        else µ._mjs_dom.setAttribute(el, 'mjs-fx-flipcard-radius', '');
      }
      else if (k !== 'perspective' && k !== 'duration') return false;
    };
    return off;
  }
};
