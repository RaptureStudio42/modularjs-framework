// mjs_boundary — entrée/sortie de survol (`@pointerenter`, `@pointerleave`, `@mouseenter`, `@mouseleave`) : la
// table des jumeaux qui remontent (`_mjs_boundaryEvents`) et le routeur (`_mjs_routeBoundary`). Patch de
// `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même technique que mjs_slot_events.ts : ajouté APRÈS la
// classe, DOIT rester après mjs_element.ts dans la concaténation).
// DÉTECTÉ sur le code compilé (bundler/features.ts, clé `boundary`) : seul un gabarit qui écrit un de ces quatre
// événements en a besoin. Absent, `_mjs_bindEvents` ne voit aucune table et route l'événement comme un autre
// (celui qu'un code fabrique par `dispatchEvent`), sans rien lever. Un projet dont ces événements ne s'écrivent que
// dans un script de page que la construction ne lit pas les demande par `runtime: ['boundary']`.
if (µ.Element) {
  // ces événements ne remontent pas, et Chromium ne les fabrique même pas quand seule une racine de shadow les
  // écoute (l'écouteur unique de `_mjs_bindEvents`) — mesuré au navigateur ; ils se lisent sur leur jumeau qui remonte
  µ.Element.prototype._mjs_boundaryEvents = {
    pointerenter: 'pointerover',
    pointerleave: 'pointerout',
    mouseenter:   'mouseover',
    mouseleave:   'mouseout'
  };

  // entrée/sortie de survol (`@pointerenter`, `@mouseleave`…), lue sur le jumeau qui remonte
  // (`pointerover`/`pointerout`…) : chaque nœud du chemin qui porte un gestionnaire le reçoit quand le
  // pointeur vient de l'extérieur de lui ou y part (`relatedTarget` hors du nœud) — passer d'un de ses
  // enfants à l'autre ne compte pas. Comme le navigateur : un événement à son nom par nœud, qui en est
  // la cible, l'entrée du plus englobant au plus profond, la sortie à l'inverse
  µ.Element.prototype._mjs_routeBoundary = function(evt, map, e) {
    const root = this._shadow;
    const hits = [];
    let rel    = e.relatedTarget;
    let t      = e.target;
    // contenu glissé (cf. `_mjs_bindEvents`) : le pointeur entre chez nous par le slot qui l'affiche, et
    // n'en sort pas en passant d'une balise glissée à l'autre, ni de l'une d'elles à notre cadre
    if (root !== this) {
      // sans `<slot>` dans le projet la brique n'est pas embarquée (mjs_slot_events.ts) : rien n'est glissé
      // chez nous, un pointeur qui vient de la page vient donc de l'extérieur
      if (t && t.getRootNode() !== root) t = this._mjs_slotEntry?.(e, false);
      if (rel && rel.getRootNode() !== root) rel = this._mjs_slotOf?.(rel);
    }
    while (t && t !== root) {
      const ids = t._mjs_eo === this ? t._mjs_ids : void 0; // nos nœuds seuls, cf. `_mjs_bindEvents`
      if (ids) {
        for (let i = 0, len = ids.length; i < len; i++) {
          if (map[ids[i]] !== void 0) {
            if (!rel || !µ._mjs_inside(t, rel)) hits.push(t, ids[i]);
            break;
          }
        }
      }
      t = t.parentNode;
      if (t && t.nodeType === 11) break;
    }
    const entering = evt === 'pointerenter' || evt === 'mouseenter';
    const __inline = this._mjs_inline;
    for (let h = 0, hn = hits.length; h < hn; h += 2) {
      const at   = entering ? hn - 2 - h : h;
      const node = hits[at];
      const id   = hits[at + 1];
      const slot = map[id];
      const list = (typeof slot === 'number' || typeof slot[0] === 'number') ? null : slot;
      for (let k = 0, nh = list ? list.length : 1; k < nh; k++) {
        const one   = list ? list[k] : slot;
        const fnIdx = typeof one === 'number' ? one : one[0];
        const fn    = __inline[fnIdx];
        if (typeof fn !== 'function') continue;
        // `.once` par nœud, même clé que le routeur principal
        if (typeof one !== 'number' && ((one[1] | 0) & 2) !== 0) {
          const onceKey = evt + ':' + (list ? id + '#' + k : id);
          if (!this._mjs_once_fired) this._mjs_once_fired = new WeakMap();
          let __fired = this._mjs_once_fired.get(node);
          if (__fired && __fired.has(onceKey)) continue;
          if (!__fired) { __fired = new Set(); this._mjs_once_fired.set(node, __fired); }
          __fired.add(onceKey);
        }
        const ev = new e.constructor(evt, e);
        Object.defineProperty(ev, 'target', { value: node, configurable: true });
        Object.defineProperty(ev, 'currentTarget', { value: node, configurable: true });
        // passage de ce gestionnaire, comme au routeur principal (mjs_element.ts) : rendu à sa fin même s'il lève ; la
        // fonction de retrait d'un `µon` née pendant ce passage (mjs_on.ts), qu'il rend, n'est pas appelée
        var __prev = µ._mjs_evPass, __pass = µ._mjs_evPass = {};
        try {
          const result = fn.call(this, ev, node);
          if (typeof result === 'function' && result._mjs_born !== __pass) result.call(this, ev, node);
          else if (result && node._mjs_fxResult && typeof result.then === 'function') node._mjs_fxResult(result);
        } finally {
          µ._mjs_evPass = __prev;
        }
      }
    }
  };
}
