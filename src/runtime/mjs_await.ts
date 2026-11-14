// mjs_await — bloc `{await}` (promesse, branches `{success}`/`{error}`). Patch
// de `µ.Element.prototype`, DÉTACHÉ de mjs_element.ts (même technique que
// mjs_on.ts/mjs_flip.ts). `{await expr}...{end}` compile en `this._mjs_updAwait(...)`
// (src/generator/compile.ts), qui délègue le rendu de branche à `_mjs_updIf`
// (mjs_if.ts) — mjs_if.ts est donc TOUJOURS embarqué avec ce fichier
// (bundler/index.ts, wantsAwait force wantsIf). `_mjs_mjsPurgeAwaitMaps` purge les
// états `_mjs_awaitMap`/`_mjs_awaitStates`/`_mjs_awaitLastRender` d'un sous-arbre détruit
// pour de bon — jumeau de `_mjs_mjsPurgeNestedListCaches` (mjs_for.ts), appelé
// depuis `_mjs_mjsPurgeSubtreeState` (mjs_element.ts, cœur) SEULEMENT si
// `this._mjs_awaitMap != null` : sans ce fichier, `_mjs_awaitMap` ne se peuple jamais et
// cet appel reste naturellement hors d'atteinte, jamais un crash.

// `µ._mjs_inside` (test d'inclusion insensible à une méthode `contains` du composant) : posé par
// mjs_element.ts, toujours au cœur avant ce fichier

// rendu serveur (happy-dom : µ._isServer ; navigateur de prérendu : µ.server) : la zone de squelette que le
// compilateur pose dans une attente (`mjs-skel-zone`) n'est pas écrite dans le HTML prérendu — l'effet *skeleton,
// qui lui donne sa feuille de style, ne tourne pas là : elle y arriverait sans barres, et la page sauterait à
// l'hydratation. Une attente écrite à la main reste écrite
function _mjsAwaitPending(pendingFn) {
  if (!pendingFn || !(µ._isServer || µ.server === true)) return pendingFn;
  return function() {
    var built = pendingFn();
    var zones = built.fragment.querySelectorAll('[mjs-skel-zone]');
    for (var i = 0; i < zones.length; i++) zones[i].remove();
    return built;
  };
}

// <attente-signal>
// `µsignal` (blocs balisés `<attente-signal>`, retirés du cœur par le bundler quand aucune unité de la construction ne le lit) : la
// lecture de l'expression du bloc `id` qui le lit (sa fonction attend un paramètre) reçoit le signal d'un AbortController neuf, et celui
// de la lecture précédente du bloc est annulé — une requête dépassée s'arrête au lieu d'être seulement ignorée. Le composant qui quitte
// la page annule ses lectures en vol (`_mjs_attachments`, appelées puis vidées au départ, mjs_element.ts) ; une lecture arrivée retire
// son contrôleur (_mjsAwaitFin), il ne reste que ceux des lectures en vol
function _mjsAwaitLire(comp, id, get) {
  var ctrls = comp._mjs_awaitCtrls ??= new Map();
  ctrls.get(id)?.abort();
  var ctrl = new AbortController();
  ctrls.set(id, ctrl);
  (comp._mjs_attachments ??= new Set()).add(comp._mjs_awaitStop ??= function() {
    comp._mjs_awaitCtrls.forEach(function(c) { c.abort(); });
  });
  return get(ctrl.signal);
}

// la lecture `ctrl` est arrivée : son contrôleur n'a plus rien à annuler
function _mjsAwaitFin(comp, id, ctrl) {
  if (ctrl && comp._mjs_awaitCtrls.get(id) === ctrl) comp._mjs_awaitCtrls.delete(id);
}

// </attente-signal>
if (µ.Element) {
  // jumeau await de `_mjs_mjsPurgeNestedListCaches`.
  // `_mjs_awaitMap`/`_mjs_awaitStates`/`_mjs_awaitLastRender` (indexées par id de bloc
  // {await}) n'étaient purgées QUE lorsque `_mjs_updAwait` était rappelé avec une
  // promesse falsy. Un bloc {await} vivant dans une branche {if}/{key} qui se
  // ferme ne revoit jamais `_mjs_updAwait` → l'entrée (dont `state.data`, parfois
  // volumineux) survit jusqu'à la destruction du composant. On purge donc, à la
  // mort DÉFINITIVE du sous-arbre, toute entrée dont l'ancre `s-<id>` y vit.
  µ.Element.prototype._mjs_mjsPurgeAwaitMaps = function(root) {
    const m = this._mjs_awaitMap;
    if (m == null || m.size === 0) return;
    const nodes = this._mjs_nodes;
    if (nodes == null) return;
    let ids = null;
    for (const id of m.keys()) {
      const anchor = nodes['s-' + id];
      if (anchor && (anchor === root || (root.contains && µ._mjs_inside(root, anchor)))) {
        (ids || (ids = [])).push(id);
      }
    }
    if (ids) {
      for (let i = 0, n = ids.length; i < n; i++) {
        const id = ids[i];
        m.delete(id);
        if (this._mjs_awaitStates) this._mjs_awaitStates.delete(id);
        if (this._mjs_awaitLastRender) this._mjs_awaitLastRender.delete(id);
        // <attente-signal>
        // le bloc quitte la page : sa lecture en vol est annulée, comme celles d'un composant qui part
        const c = this._mjs_awaitCtrls?.get(id);
        if (c) {
          c.abort();
          this._mjs_awaitCtrls.delete(id);
        }
        // </attente-signal>
      }
    }
  };

  // _mjs_updAwait : pendingFn/successFn/errorFn retournent {fragment, refs}.
  // Pour comparer le rendu précédent, on utilise une simple sentinelle de statut.
  // `get` lit l'expression du bloc ; `vars` : les variables qu'elle cite (absent : aucune)
  µ.Element.prototype._mjs_updAwait = function(id, get, pendingFn, successFn, errorFn, vars) {
    var childMode, e, i, n, nodes, promise, s, state, t;
    // <attente-gardee>
    // `{await.keep}` (7e argument, posé par le compilateur ; blocs balisés `<attente-gardee>`, retirés du cœur quand aucune unité de la
    // construction n'en écrit) : pendant une relecture, la branche {success} affichée reste avec sa valeur, puis se met à jour sur place
    var garde, servi, keep = arguments[6];
    // </attente-gardee>
    // <attente-signal>
    var coupee, ctrl;
    // </attente-signal>
    s = this._mjs_nodes['s-' + id];
    e = this._mjs_nodes['e-' + id];
    if (!(s && e)) {
      return;
    }
    childMode = s.parentNode && s.parentNode.getAttribute
      ? s.parentNode.getAttribute('mjs-childtransition')
      : null;
    this._mjs_awaitMap ??= new Map();
    this._mjs_awaitStates ??= new Map();
    this._mjs_awaitLastRender ??= new Map();
    // l'expression n'est relue qu'au premier rendu du bloc et quand une variable qu'elle cite a été écrite depuis la
    // dernière passe (`_mjs_chgd`, cf. `_mjs_chg` de mjs_for.ts) : relue à chaque passe, un appel (`{await charger()}`)
    // rendait une promesse neuve à chaque rendu, et sa résolution, qui rend, en relançait une autre, sans fin. Une
    // expression qui lit un contexte `§§` ou un état partagé (`µ.state`) cite aussi `_u`, écrit quand l'un de ceux que
    // le composant lit change (µ._mjs_notifyUniversalChange, mjs_runes.ts)
    // <attente-signal>
    // l'expression qui lit `µsignal` reçoit le signal d'une lecture neuve (cf. _mjsAwaitLire). La lecture qu'un départ de la page a coupée
    // est refaite au retour du composant : sa promesse est oubliée le temps de relire l'expression, et remise si elle ne rend rien (le
    // contenu part alors, comme pour toute valeur vide)
    if (get.length) get = _mjsAwaitLire.bind(null, this, id, get);
    if (this._mjs_awaitCtrls?.get(id)?.signal.aborted) {
      coupee = this._mjs_awaitMap.get(id);
      this._mjs_awaitMap.delete(id);
    }
    // </attente-signal>
    promise = this._mjs_awaitMap.has(id) && !vars?.some((v) => this._mjs_chgd?.has(v)) ? this._mjs_awaitMap.get(id) : get();
    // <attente-signal>
    if (coupee && !promise) this._mjs_awaitMap.set(id, coupee);
    ctrl = this._mjs_awaitCtrls?.get(id);
    // </attente-signal>
    // <attente-gardee>
    // reprise d'une page servie (mjs_hydrate.ts) : ce que le serveur a rendu du bloc part à sa première lecture, comme le contenu des
    // autres blocs ; sous `{await.keep}`, il reste à l'écran jusqu'à l'arrivée de cette lecture, que la branche du navigateur remplace
    if (s._mjs_srv === 2) {
      s._mjs_srv = 0;
      servi = keep && !!promise;
      if (!servi) {
        while (s.nextSibling !== e) {
          s.parentNode.removeChild(s.nextSibling);
        }
      }
    }
    // </attente-gardee>
    if (!promise) {
      if (this._mjs_awaitMap.get(id)) {
        this._mjs_awaitStates.delete(id);
        this._mjs_awaitLastRender.delete(id);
        // la liste des nœuds entre les ancres est figée AVANT de détruire : le nettoyage d'une balise peut retirer
        // un frère qu'un effet avait posé à côté d'elle (le calque de *reflect en mode moz, la bulle de *guard) ;
        // la marche, qui lisait le suivant avant de détruire, s'arrêtait là et les balises d'après restaient dans
        // la page, effets actifs. Les nœuds déjà détachés sont sautés
        nodes = [];
        for (n = s.nextSibling; n && n !== e; n = n.nextSibling) {
          nodes.push(n);
        }
        for (i = 0; i < nodes.length; i++) {
          t = nodes[i];
          if (!t.parentNode) {
            continue;
          }
          this._mjs_destroyNodeAndChildren(t, childMode === 'all' || childMode === 'out' || childMode === 'transition');
        }
      }
      // valeur vide retenue aussi : comme une promesse, elle n'est relue que quand une variable de l'expression change
      this._mjs_awaitMap.set(id, promise);
      return;
    }
    if (this._mjs_awaitMap.get(id) !== promise) {
      // <attente-gardee>
      // relecture sous la branche {success} affichée : la branche reste, son état garde sa valeur pour elle
      garde = keep && this._mjs_awaitLastRender.get(id) === 'success' && this._mjs_awaitStates.get(id);
      // </attente-gardee>
      this._mjs_awaitMap.set(id, promise);
      state = {
        status: 'pending',
        data: null,
        error: null,
        unhandled: false
      };
      // <attente-gardee>
      state = garde || state;
      // </attente-gardee>
      // <attente-en-cours>
      // `µpending` (blocs balisés `<attente-en-cours>`, retirés du cœur quand aucune unité de la construction ne le lit) : vrai tant que
      // la lecture est en vol
      state.pending = true;
      // </attente-en-cours>
      this._mjs_awaitStates.set(id, state);
      this._mjs_awaitLastRender.set(id, 'pending');
      // <attente-gardee>
      // ce qui est à l'écran reste, l'attente n'est pas rendue : la branche {success} d'une relecture gardée (`µpending` passe à vrai),
      // le contenu servi d'une page reprise
      if (garde) {
        this._mjs_awaitLastRender.set(id, 'success');
        // <attente-en-cours>
        this._mjs_invalidate('~' + id + 'p');
        // </attente-en-cours>
      }
      if (!garde && !servi) {
      // </attente-gardee>
      this._mjs_updIf(id, _mjsAwaitPending(pendingFn) || null);
      // <attente-gardee>
      }
      // </attente-gardee>
      // `Promise.resolve` : une valeur qui n'est pas une promesse (donnée déjà là, en cache) est le résultat, comme
      // pour `await` en JavaScript — la branche {success} l'affiche à la microtâche suivante, avant tout affichage à
      // l'écran (`.then` appelé sur un nombre faisait tomber le composant). Une promesse reste elle-même
      return Promise.resolve(promise).then((data) => {
        if (this._mjs_awaitMap.get(id) !== promise) {
          return;
        }
        // <attente-signal>
        _mjsAwaitFin(this, id, ctrl);
        // </attente-signal>
        // <attente-en-cours>
        state.pending = false;
        // </attente-en-cours>
        state.status = 'success';
        state.data = data;
        // <attente-gardee>
        // relecture gardée : la branche se met à jour sur place — ses liaisons qui lisent la valeur suivent `~<id>`, `µpending` `~<id>p`
        if (garde && this._mjs_awaitLastRender.get(id) === 'success') {
          this._mjs_invalidate('~' + id);
          // <attente-en-cours>
          this._mjs_invalidate('~' + id + 'p');
          // </attente-en-cours>
          return;
        }
        // </attente-gardee>
        return this._mjs_invalidate('_awaits_');
      }, (error) => {
        // <attente-signal>
        // le rejet d'une lecture annulée (lecture dépassée, composant parti de la page) n'ouvre jamais {error}
        if (ctrl?.signal.aborted) {
          return;
        }
        // </attente-signal>
        if (this._mjs_awaitMap.get(id) !== promise) {
          return;
        }
        // <attente-signal>
        _mjsAwaitFin(this, id, ctrl);
        // </attente-signal>
        // <attente-en-cours>
        state.pending = false;
        // </attente-en-cours>
        state.status = 'error';
        state.error = error;
        // rejet consommé par une branche {error} ? le SSR (renderToString.ts) n'avertit que si non
        state.unhandled = !errorFn;
        // sans branche {error}, rien n'affiche l'erreur : une trace de développement la montre, plutôt qu'un contenu
        // qui disparaît sans un mot ; le build de production la retire, comme les autres traces
        if (!errorFn) {
          µ._mjs_logger()?.('[ModularJS] ' + µ._mjs_txt('awaitUnhandled', { tag: this.localName }, '{await} rejeté dans <{tag}> sans branche {error} pour l\'afficher — le bloc reste vide. Ajoutez {error err}…{end} pour montrer l\'erreur.'), error);
        }
        return this._mjs_invalidate('_awaits_');
      });
    } else {
      state = this._mjs_awaitStates.get(id);
      if (state) {
        var targetFn = null;
        var targetKey = state.status;
        if (state.status === 'pending' && pendingFn) {
          targetFn = _mjsAwaitPending(pendingFn);
        } else if (state.status === 'success' && successFn) {
          // Réutilise la closure : capture data dans une fn 0-arg.
          var __data = state.data;
          targetFn = function() { return successFn(__data); };
          targetKey = 'success';
        } else if (state.status === 'error' && errorFn) {
          var __err = state.error;
          targetFn = function() { return errorFn(__err); };
          targetKey = 'error';
        }
        if (targetKey !== this._mjs_awaitLastRender.get(id)) {
          this._mjs_awaitLastRender.set(id, targetKey);
          return this._mjs_updIf(id, targetFn);
        }
      }
    }
  };
  // <attente-gardee>
  // marque de `{await.keep}` dans ce cœur : un composant construit pour le développement la cherche et dit l'option qui manque (cf. compileAwait)
  µ._mjs_awaitHasKeep = 1;
  // </attente-gardee>
  // <attente-en-cours>
  // marque de `µpending`, de même
  µ._mjs_awaitHasPending = 1;
  // </attente-en-cours>
  // <attente-signal>
  // marque de `µsignal`, de même
  µ._mjs_awaitHasSignal = 1;
  // </attente-signal>
}
