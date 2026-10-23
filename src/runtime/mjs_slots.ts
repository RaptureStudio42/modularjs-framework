// mjs_slots — slots indexés : `_mjs_injectSlots()` pose `slot="N"` sur chaque enfant sans attribut
// d'un composant qui projette ses enfants un par un (`{for i, t in $tabs} <@slot {i}/> {end}`).
// Patch de `µ.Element.prototype._mjs_injectSlots`, DÉTACHÉ de mjs_element.ts (même technique que
// mjs_on.ts : ajouté APRÈS la classe, DOIT rester après mjs_element.ts dans la concaténation).
// DÉTECTÉ sur le code compilé (bundler/features.ts, clé `slots`) : le constructeur compilé
// n'émet `this._mjs_has_dynamic_slots = true; this._mjs_injectSlots();` que si le composant écrit
// `<@slot` (transpiler/template.ts, `[[DYNAMIC_SLOTS_LINE]]`) — sans lui, la méthode ne faisait
// déjà rien (drapeau faux, retour immédiat), elle peut donc manquer sans risque.
if (µ.Element) {
  // nom d'un slot indexé : un entier en chiffres, celui que pose `<@slot {i}/>` dans un {for}
  var MJS_SLOT_INDEX = /^\d+$/;

  // le rangement se décide sur les slots RÉELLEMENT rendus : un slot écrit dans un bloc ({if}/{else},
  // {for}) n'existe qu'une fois le bloc rendu, le constructeur n'en voit aucun — d'où l'appel répété
  // après chaque rendu structurel (plus bas, `_mjs_slotsRendered` posé)
  //   - un slot par défaut rendu : aucun index, les enfants sans `slot=` y vont nativement
  //   - des slots indexés rendus, sans slot par défaut : `slot="N"` sur chaque enfant sans attribut
  //   - ni l'un ni l'autre (bloc encore fermé) : rien — un index posé trop tôt cachait l'enfant au
  //     slot par défaut rendu ensuite
  // seuls les index posés ici (`_mjs_slotIdx`) sont renumérotés ou retirés, un `slot=` d'auteur jamais
  // mode léger : aucun shadow, aucun slot — ses enfants sont son propre contenu, jamais indexés
  µ.Element.prototype._mjs_injectSlots = function() {
    var byDefault, indexed, named, i, kids, node, own, childIndex;
    if (!this._mjs_has_dynamic_slots || this._mjs_slotsFixed || this._mjs_isLight) return;
    byDefault = !!this._shadow.querySelector('slot:not([name])');
    // slot par défaut vu avant tout rendu, donc hors de tout bloc : il ne partira plus
    if (byDefault && !this._mjs_slotsRendered) {
      this._mjs_slotsFixed = true;
      return;
    }
    indexed = false;
    if (!byDefault) {
      named = this._shadow.querySelectorAll('slot[name]');
      for (i = 0; i < named.length && !indexed; i++) indexed = MJS_SLOT_INDEX.test(named[i].getAttribute('name'));
    }
    kids       = this.children;
    childIndex = 0;
    for (i = 0; i < kids.length; i++) {
      node = kids[i];
      own  = node._mjs_slotIdx !== void 0 && node.getAttribute('slot') === node._mjs_slotIdx;
      if (!own && node.hasAttribute('slot')) continue;
      if (!indexed) {
        if (own) {
          node.removeAttribute('slot');
          node._mjs_slotIdx = void 0;
        }
        continue;
      }
      if (!own || node._mjs_slotIdx !== String(childIndex)) {
        node.setAttribute('slot', String(childIndex));
        node._mjs_slotIdx = String(childIndex);
      }
      childIndex++;
    }
  };

  // chaque rendu structurel peut ouvrir ou fermer le bloc qui porte les slots : le rangement suit —
  // jamais au milieu d'un rendu réentrant (bloc à moitié posé), la passe englobante s'en charge
  var MJS_RENDER_STRUCT = µ.Element.prototype._mjs_safeRenderStruct;
  µ.Element.prototype._mjs_safeRenderStruct = function() {
    MJS_RENDER_STRUCT.call(this);
    if (this._mjs_has_dynamic_slots && !this._mjs_inRenderStruct) {
      this._mjs_slotsRendered = true;
      this._mjs_injectSlots();
    }
  };
}
