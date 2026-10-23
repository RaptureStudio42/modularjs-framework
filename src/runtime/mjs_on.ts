// mjs_on — rune `µon` (délégation d'événement manuelle, hors template). Patch de
// `µ.Element.prototype._mjs_on`, DÉTACHÉ de mjs_element.ts (même technique que
// mjs_flip.ts/mjs_title.ts : ajouté APRÈS la classe, DOIT rester après mjs_element.ts
// dans la concaténation). `µon 'evt', selecteur, handler` compile en `@_mjs_on(...)`
// (transpiler/index.ts, `µ\.?\s*on\b` → `@_mjs_on`) — un composant qui n'écrit jamais
// `µon`/`µ.on` n'appelle donc jamais cette méthode, elle peut manquer sans risque.
// `closest` de la balise, insensible à une méthode du composant du même nom (cf. mjs_element.ts)
µ._mjs_closest = µ._mjs_closest || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.closest.call(n, sel);
  return n && typeof n.closest === 'function' ? n.closest(sel) : null;
};
if (µ.Element) {
  µ.Element.prototype._mjs_on = function(eventName, selectorOrHandler, handlerOrNone) {
    var comp = this, handler, off, root, selector, wrapper;
    if (typeof selectorOrHandler === 'function') {
      handler = selectorOrHandler;
      selector = null;
    } else {
      selector = selectorOrHandler;
      handler = handlerOrNone;
    }
    wrapper = (e) => {
      var delegatedTarget, realTarget;
      if (!selector) {
        return handler.call(this, e);
      } else {
        realTarget = (typeof µ.realTarget === "function" ? µ.realTarget(e) : void 0) || (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target);
        delegatedTarget = µ._mjs_closest(realTarget, selector);
        // la remontée s'arrête à l'hôte : depuis un contenu glissé dans un <slot>, `closest` sortait du composant et
        // livrait un élément de la page qui l'entoure. L'ombre et l'hôte (contenu glissé compris) restent visés
        if (delegatedTarget && !µ._mjs_inside(root, delegatedTarget) && !µ._mjs_inside(this, delegatedTarget)) delegatedTarget = null;
        if (delegatedTarget) {
          // Expose l'élément matché via `e.currentTarget` (sémantique DOM
          // standard / parité Svelte-React) EN PLUS du 2e argument. Sans ça,
          // sur un event délégué (qui bubble), `e.currentTarget` = la racine de
          // délégation (shadow root) → `e.currentTarget.getBoundingClientRect()`
          // échoue. Cas vécu : seek slider de l'audio-player.
          try {
            Object.defineProperty(e, 'currentTarget', { value: delegatedTarget, configurable: true });
          } catch (_err) { /* event read-only strict : on se rabat sur le 2e arg */ }
          try {
            return handler.call(this, e, delegatedTarget);
          } finally {
            // Restaure le getter natif : l'event POURSUIT sa propagation et un
            // listener tiers (analytics, lib externe) lisait notre valeur figée.
            try { delete e.currentTarget; } catch (_e2) { /* read-only */ }
          }
        }
      }
    };
    root = this._shadow || this;
    // rendue à l'appelant : retire toujours l'écouteur, et son inscription de retrait à la destruction s'il en a une (la
    // liste, prise par la destruction avant d'être jouée, n'est plus là pendant qu'elle joue) ; un deuxième appel ne fait
    // rien ; marquée du passage du gestionnaire du gabarit en cours (mjs_element.ts, mjs_boundary.ts) : rendue par lui
    // (`@click={$brancher()}`), le routeur ne l'appelle pas, l'écouteur qu'il vient de poser reste
    off = function() {
      var cbs = comp._mjs_destroy_cbs, i = cbs ? cbs.indexOf(off) : -1;
      if (i > -1) cbs.splice(i, 1);
      root.removeEventListener(eventName, wrapper);
    };
    off._mjs_born = µ._mjs_evPass;
    // posé pendant un montage (µmount, rejoué à chaque retour du composant dans la page) : retiré à sa destruction,
    // sinon le gestionnaire s'empilait à chaque retour ; posé par le script du composant, il reste
    if (this._mjs_mounted) this._mjs_onDestroy(off);
    root.addEventListener(eventName, wrapper);
    return off;
  };
}
