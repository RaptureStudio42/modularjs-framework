// mjs_slot_events — clic et survol du contenu glissé dans un composant : `_mjs_slotEntry` (la balise de
// notre arbre par laquelle arrive un événement né dans du contenu glissé) et `_mjs_slotOf` (le `<slot>`
// qui affiche un nœud glissé chez nous). Patch de `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même
// technique que mjs_slots.ts : ajouté APRÈS la classe, DOIT rester après mjs_element.ts dans la
// concaténation).
// DÉTECTÉ sur le code compilé (bundler/features.ts, clé `slot_events`) : seul un composant dont le gabarit
// écrit un `<slot>` peut afficher du contenu glissé, donc voir arriver à sa racine un événement dont la cible
// est hors de son arbre ; sans `<slot>` compilé dans le projet, ces deux méthodes n'ont jamais d'appel.
// Un projet dont le `<slot>` ne s'écrit que dans un script de page (que la construction ne lit pas) les
// demande par `runtime: ['slot_events']`.
if (µ.Element) {
  // la balise de NOTRE arbre par laquelle arrive un événement né dans du contenu glissé : le `<slot>`
  // qui l'affiche — dans le chemin, le nœud qui suit l'enfant direct de notre balise. `closest` : rien
  // si un gestionnaire du contenu glissé a déjà pris l'événement sans `.propagate` — le plus proche
  // gagne, comme dans un seul composant (son routeur a joué avant le nôtre : il écoute plus haut). `path` : celui
  // lu à notre racine pendant la capture, quand on route une fois la cible atteinte
  µ.Element.prototype._mjs_slotEntry = function(e, closest, path = e.composedPath()) {
    for (let i = 0, n = path.length - 1; i < n; i++) {
      if (path[i].parentNode !== this) continue;
      if (closest && e._mjs_taken !== void 0 && path.lastIndexOf(e._mjs_taken, i) !== -1) return null;
      return path[i + 1];
    }
    return null;
  };

  // le `<slot>` de notre arbre qui affiche un nœud glissé chez nous, même glissé de plus loin (rien s'il
  // est ailleurs dans la page)
  µ.Element.prototype._mjs_slotOf = function(n) {
    const slots = this._shadow.querySelectorAll('slot');
    for (let i = 0, len = slots.length; i < len; i++) {
      const shown = slots[i].assignedNodes({ flatten: true });
      for (let k = 0, kn = shown.length; k < kn; k++) {
        if (shown[k] === n || µ._mjs_inside(shown[k], n)) return slots[i];
      }
    }
    return null;
  };
}
