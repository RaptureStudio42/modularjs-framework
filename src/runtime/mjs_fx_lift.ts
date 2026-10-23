// mjs_fx_lift — `*lift` : la balise se soulève, avec son ombre (une carte, un bouton). Réglages :
// height (px ; 8), shadow (l'ombre qui s'allonge ; oui), color (la couleur de cette ombre ;
// rgba(0,0,0,.45) : une teinte légère l'adoucit, une couleur vive en fait une lueur), blur (son flou
// en px ; 30 ; 0 : une ombre dure, le dessous d'une touche), press (pendant l'appui — souris, doigt,
// Entrée ou Espace tenus — la balise redescend et son ombre se resserre, vite ; non), duration
// (250ms), easing, on (hover : au survol ; view : dès que la balise est à l'écran ; click : chaque
// clic ; always : soulevée).
// L'appui part de l'état soulevé : une balise au repos n'a rien à redescendre. Une balise désactivée
// (`:disabled`, un fieldset désactivé autour compris, ou aria-disabled="true") ne s'appuie pas. Rien
// n'écoute le document au repos : la fenêtre n'est écoutée que le temps d'un appui à la souris ou au doigt.
// L'ombre est celle de la balise (`box-shadow`, transitée avec la montée) : la porter sur un calque ne se fait qu'en changeant ce que
// l'auteur voit au repos (la balise isolée, positionnée, un `::after` pris) et ne sert à rien à une carte qui a déjà son ombre.

µ._mjs_fxDefs.lift = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  // la transition (montée, ombre) s'ajoute à celle de l'auteur (µ._mjs_fxTransition) ; l'appui la presse
  css: '[mjs-fx~="lift"]:where([mjs-fx-tr]){transition:var(--mjs-fx-tr)}'
    + '[mjs-fx~="lift"][mjs-fx-on~="lift"]{transform:translateY(calc(-1 * var(--mjs-lift-height,8px)))}'
    + '[mjs-fx~="lift"][mjs-fx-on~="lift"]:not([mjs-fx-lift-flat]){box-shadow:0 18px var(--mjs-lift-blur,30px) var(--mjs-lift-color,rgba(0,0,0,.45))}'
    + '[mjs-fx~="lift"][mjs-fx-on~="lift"][mjs-fx-lift-press]{transform:translateY(0);--mjs-fx-lift-d:80ms}'
    + '[mjs-fx~="lift"][mjs-fx-on~="lift"][mjs-fx-lift-press]:not([mjs-fx-lift-flat]){box-shadow:0 4px calc(var(--mjs-lift-blur,30px) * .25) var(--mjs-lift-color,rgba(0,0,0,.45))}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="lift"][mjs-fx~="lift"]{transition:none}[mjs-fx~="lift"][mjs-fx-on~="lift"][mjs-fx-on~="lift"]{transform:none}}',
  vars: { height: 'px', duration: '', easing: '', color: '', blur: 'px' },
  setup: function(el, s) {
    var d       = 'var(--mjs-fx-lift-d,var(--mjs-lift-duration,250ms)) var(--mjs-lift-easing,ease)';
    var tr      = µ._mjs_fxTransition(el, 'lift', 'transform ' + d + ',box-shadow ' + d);
    var restore = µ._mjs_fxMovable(el);
    if (s.shadow === false) µ._mjs_dom.setAttribute(el, 'mjs-fx-lift-flat', '');
    var gate  = µ._mjs_fxState(el, 'lift', s.on);
    var undo  = [];
    var ptr   = false;
    var key   = false;
    var shown = false;
    // l'attribut de l'appui, posé tant que le pointeur ou une touche le tient
    var draw = function() {
      var yes = ptr || key;
      if (yes === shown) return;
      shown = yes;
      if (yes) µ._mjs_dom.setAttribute(el, 'mjs-fx-lift-press', '');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-lift-press');
    };
    if (s.press) {
      var on2 = function(ev, f) {
        µ._mjs_dom.addEventListener(el, ev, f, { passive: true });
        undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
      };
      // une balise désactivée ne s'appuie pas, souris, doigt ou clavier : l'état est relu à chaque appui
      var disabled = function() {
        return µ._mjs_dom.matches(el, ':disabled') || µ._mjs_dom.getAttribute(el, 'aria-disabled') === 'true';
      };
      // un champ de saisie garde ses espaces : taper dedans n'appuie pas la balise
      var typing = function(t) {
        return !!t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|image|range|color|file)$/.test(t.type)));
      };
      // souris et doigt : le pointeur appuyé sur la balise jusqu'à son relâchement (même ailleurs dans la
      // fenêtre), son annulation (le doigt part faire défiler) ou sa sortie de la balise
      var up = function() {
        ptr = false;
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        draw();
      };
      undo.push(function() {
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      });
      on2('pointerdown', function(e) {
        if (!e.isPrimary || e.button !== 0 || disabled()) return;
        ptr = true;
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        draw();
      });
      on2('pointerleave', up);
      // clavier : Entrée ou Espace tenus, jusqu'à leur relâchement ou à la perte du focus (un relâchement
      // qui arrive ailleurs ne laisserait jamais la balise redescendue)
      on2('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (disabled() || typing(typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target)) return;
        key = true;
        draw();
      });
      on2('keyup', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        key = false;
        draw();
      });
      on2('focusout', function() {
        if (!key) return;
        key = false;
        draw();
      });
    }
    return function() {
      for (var i = 0; i < undo.length; i++) undo[i]();
      ptr = false;
      key = false;
      draw();
      gate();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-lift-flat');
      restore();
      tr();
    };
  }
};
