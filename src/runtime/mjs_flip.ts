// mjs_flip.coffee
var originalReconcileList;

// `animate` de la balise, insensible à une méthode du composant du même nom (cf. mjs_element.ts)
µ._mjs_animate = µ._mjs_animate || function(n, frames, opts) {
  if (typeof Element === 'function' && n instanceof Element && typeof Element.prototype.animate === 'function') return Element.prototype.animate.call(n, frames, opts);
  return n.animate(frames, opts);
};

if (µ.Element) {
  originalReconcileList = µ.Element.prototype._mjs_reconcileList;
  // clés `by` que plusieurs éléments de la collection portent : la réconciliation (mjs_for.ts) ne rend que le premier de chacune, la ligne qui porte
  // la clé change d'élément d'une passe à l'autre et son identité n'est pas sûre ; les clés se comparent en chaîne, une clé absente est ignorée
  const duplicateKeys = function(items, keyAttr) {
    const seen = new Set(), dups = new Set();
    items.forEach(function(item) {
      var key = item?.[keyAttr];
      if (key != null) {
        (seen.has(key = String(key)) ? dups : seen).add(key);
      }
    });
    return dups;
  };
  // relevé des balises `mjs-flip` d'une liste, chacune avec son identifiant : [nœud, identifiant]
  // identifiant = étiquette `mjs-key` posée par le compilateur (clé du `by` du `{for}`, précédée de celle des lignes qui l'enveloppent dans une
  // liste imbriquée, suivie de la place de la balise quand la ligne porte plusieurs balises @flip) ; sans étiquette, le nœud lui-même
  // les lignes dont la clé est dans `skip` (clés en double) n'y figurent pas
  // relevé VIVANT des nœuds de la ligne : un `{if}` à sa racine insère son contenu entre ses deux marqueurs, absent de `entry.nodes`
  const flipNodesOf = function(self, cacheId, skip) {
    const found = [];
    if (self._mjs_list_cache && self._mjs_list_cache[cacheId]) {
      self._mjs_list_cache[cacheId].forEach((entry, key) => {
        if (skip && skip.has(key)) {
          return;
        }
        self._mjs_liveEntryNodes(entry.nodes).forEach(function(n) {
          if (n.nodeType === 1) {
            if (n.hasAttribute('mjs-flip')) {
              found.push([n, n.getAttribute('mjs-key') || n]);
            }
            n.querySelectorAll('[mjs-flip]').forEach(function(child) {
              found.push([child, child.getAttribute('mjs-key') || child]);
            });
          }
        });
      });
    }
    return found;
  };
  // Alignement strict sur la nouvelle signature de réconciliation latérale
  µ.Element.prototype._mjs_reconcileList = function(cacheId, startNode, endNode, childMode, col, tplFn, keyFn, updateFn, keyAttr) {
    var flipNodes, rects, result;
    // Flag posé au compile-time (`static _mjs_hasFlip`, cf. template.ts) quand
    // le composant déclare `@flip`. Avant, le code lisait `this._has_flip` qui
    // n'était JAMAIS assigné → le wrapper FLIP ne s'activait jamais (`@flip`
    // inerte). On lit désormais le static réellement émis.
    if (!this.constructor._mjs_hasFlip) {
      return originalReconcileList.apply(this, arguments);
    }
    // Garde PAR LISTE (cacheId), PAS par composant. Un composant avec 2 listes
    // animées (ex. todo + done) doit pouvoir FLIP-er les DEUX dans le même tick.
    // Avant : un booléen unique `_is_flipping` → seule la 1ʳᵉ liste réconciliée
    // était animée, la 2ᵈ sautait → asymétrie coche/décoche (le trou se ferme en
    // glissant d'un côté, snap de l'autre, selon l'ordre de rendu des `{for}`).
    if (this._mjs_flipping_cids == null) {
      this._mjs_flipping_cids = new Set();
    }
    if (this._mjs_flipping_cids.has(cacheId)) {
      return originalReconcileList.apply(this, arguments);
    }
    this._mjs_flipping_cids.add(cacheId);
    flipNodes = flipNodesOf(this, cacheId);
    // 1. FIRST (Mesure)
    rects = new Map();
    flipNodes.forEach(function(p) {
      return rects.set(p[1], {
        rect: p[0].getBoundingClientRect(),
        parent: p[0].parentNode
      });
    });
    // 2. MUTATION (Application de la réconciliation)
    try {
      result = originalReconcileList.apply(this, arguments);
    } catch (err) {
      // Sans cette purge, une exception de réconciliation laissait le cacheId
      // dans le Set → la garde court-circuitait toutes les passes suivantes :
      // FLIP définitivement désactivé pour cette liste.
      this._mjs_flipping_cids.delete(cacheId);
      throw err;
    }
    // 3. MICRO-TICK & PLAY
    Promise.resolve().then(() => {
      var cache, dups, items, newFlipNodes;
      this._mjs_flipping_cids.delete(cacheId);
      // moins de lignes que d'éléments : des clés en double, dont les lignes ne glissent pas (leur identité n'est pas sûre)
      cache = this._mjs_list_cache?.[cacheId];
      items = col && (Array.isArray(col) ? col : Object.values(col));
      dups = cache && items && items.length !== cache.size ? duplicateKeys(items, keyAttr) : null;
      // même relevé vivant qu'avant la mutation
      newFlipNodes = flipNodesOf(this, cacheId, dups);
      // Liste CIBLE vs SOURCE. Si cette liste a GAGNÉ un node ce tick (un
      // arrivant via @in : présent dans newFlipNodes mais SANS position
      // antérieure dans `rects`), c'est la colonne CIBLE → le trou d'accueil
      // doit s'ouvrir IMMÉDIATEMENT (delay=0) pour que l'élément en cours de
      // crossfade ait un emplacement où atterrir. Sinon (liste SOURCE qui PERD
      // un node), la fermeture du trou reste différée (`mjs-flip-delay`) le
      // temps que le crossfade se termine.
      var listGained = newFlipNodes.some(function(p) {
        return !rects.get(p[1]);
      });
      // PERF — 3 PASSES pour ne forcer qu'UN SEUL reflow au lieu
      // d'un par nœud. Avant, par nœud : cancel (écriture) → getBoundingClientRect
      // (lecture sur layout sale → reflow) → animate (écriture), entrelacés → ~n
      // recalculs de layout sur n éléments réordonnés. On sépare : (1) cancel de
      // TOUS les mjs-flip en vol, (2) mesure de TOUS les newRect (un reflow), (3)
      // deltas + animate. Bonus correction : la mesure de nᵢ n'est plus polluée
      // par le transform encore actif d'un voisin nⱼ.
      //
      // le cancel des FLIP précédents
      // encore en vol reste AVANT toute mesure : `getBoundingClientRect()`
      // reflète le `transform` CSS actif, un ancien `mjs-flip` non annulé
      // contaminerait `newRect` de son décalage résiduel → `deltaX/deltaY` faux
      // → saut visuel au redémarrage de l'anim interrompue. La passe 1 le
      // garantit désormais pour TOUS les nœuds avant la moindre lecture.

      // PASSE 1 — annuler TOUS les mjs-flip encore en vol.
      newFlipNodes.forEach(function(p) {
        if (typeof p[0].getAnimations === "function") {
          p[0].getAnimations().forEach(function(a) {
            if (a.id === 'mjs-flip') {
              return a.cancel();
            }
          });
        }
      });
      // PASSE 2 — mesurer TOUS les newRect (un seul reflow pour l'ensemble).
      var measures = [];
      newFlipNodes.forEach(function(p) {
        var n, oldData;
        n = p[0];
        oldData = rects.get(p[1]);
        if (!oldData) {
          return;
        }
        if (oldData.parent !== n.parentNode) {
          return;
        }
        return measures.push({
          n: n,
          oldRect: oldData.rect,
          newRect: n.getBoundingClientRect()
        });
      });
      // PASSE 3 — deltas + animate (écritures groupées).
      return measures.forEach(function(m) {
        var deltaX, deltaY, duration, flipDelay, flipEasing, n, newRect, oldRect, frames, opts;
        n = m.n;
        oldRect = m.oldRect;
        newRect = m.newRect;
        deltaX = oldRect.left - newRect.left;
        deltaY = oldRect.top - newRect.top;
        if (deltaX !== 0 || deltaY !== 0) {
          duration = parseInt(n.getAttribute('mjs-flip'));
          // durée négative (liaison calculée) : refusée par animate(), la durée par défaut la remplace
          if (isNaN(duration) || duration < 0) {
            duration = 200;
          }
          flipDelay = listGained ? 0 : parseInt(n.getAttribute('mjs-flip-delay'));
          if (isNaN(flipDelay)) {
            flipDelay = 0;
          }
          flipEasing = n.getAttribute('mjs-flip-easing') || 'cubic-bezier(0.25, 1, 0.5, 1)';
          frames = [
            {
              transform: `translate(${deltaX}px, ${deltaY}px)`
            },
            {
              transform: 'translate(0px, 0px)'
            }
          ];
          opts = {
            duration: duration,
            delay: flipDelay,
            // `backwards` : pendant le délai, l'élément reste au 1er keyframe
            // (translate(delta) = son ANCIENNE position) au lieu de sauter à la
            // nouvelle. C'est ce qui rend la fermeture du trou SÉQUENTIELLE
            // (attend la fin du crossfade avant de glisser).
            fill: 'backwards',
            easing: flipEasing,
            id: 'mjs-flip'
          };
          // courbe que le navigateur refuse (pas une valeur CSS : le nom d'une courbe de µ.easing, une faute de frappe) :
          // la ligne glisse avec la courbe par défaut. L'erreur levée ici arrêtait toute la liste, en rejet non rattrapé
          try {
            return µ._mjs_animate(n, frames, opts);
          }
          catch {
            opts.easing = 'cubic-bezier(0.25, 1, 0.5, 1)';
            return µ._mjs_animate(n, frames, opts);
          }
        }
      });
    });
    return result;
  };
}
