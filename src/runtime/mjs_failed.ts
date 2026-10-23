// mjs_failed — frontière d'erreur `<@failed>` : rendu du repli, propagation vers l'ancêtre qui en
// porte un, limite de réessai, et reset(). `_mjs_catchError` (mjs_element.ts, cœur) délègue ici par
// `_mjs_runBoundary` quand la méthode existe. DÉTACHÉ du cœur : embarqué seulement si le code
// compilé d'une source pose un repli — balise `<@failed>` (`this._mjs_fallback = …`) ou rune nue
// `µfailed` (`_mjs_hook('failed', …)`, mjs_lifecycle.ts), cf. bundler/features.ts. Ce sont les deux
// SEULS écrivains de `_mjs_fallback` : sans eux aucun composant n'a de repli, `_mjs_catchError` n'a rien
// à rendre ni d'ancêtre à trouver et passe directement au panneau fatal.
//
// reset() : l'init (état) d'un composant tourne dans son CONSTRUCTEUR → pas ré-exécutable
// en place. Pour « réinitialiser » (façon svelte:boundary reset), on remplace
// l'élément crashé par une instance FRAÎCHE (même tag + mêmes attrs/props) qui
// se monte proprement avec un état neuf.
// remplacement insensible à une méthode `replaceWith` du composant (cf. mjs_element.ts)
µ._mjs_swap = µ._mjs_swap || function(cur, nn) {
  if (typeof Node !== 'function' || !(cur instanceof Node)) return cur.replaceWith(nn);
  var p = cur.parentNode;
  if (p) Node.prototype.replaceChild.call(p, nn, cur);
};

// remontée d'un nœud vers ses ancêtres, ombres traversées (`getRootNode().host`), quelle que soit la profondeur :
// `trouve(n)` rend vrai pour s'arrêter sur `n`. Un nœud déjà vu arrête la remontée — garde contre une boucle,
// qu'un arbre DOM n'a pas, mais qu'un `host` posé à la main pourrait faire
µ._mjs_climb = function(node, trouve) {
  var seen = new Set();
  while (node && !seen.has(node)) {
    seen.add(node);
    node = node.parentNode || (node.getRootNode ? node.getRootNode().host : null);
    if (node && trouve(node)) return node;
  }
  return null;
};

// geste de l'utilisateur : le dernier événement de confiance (clic, touche, pointeur, toucher) vu à la capture sur window,
// avant les écouteurs de la page. Sa distribution finie, son `eventPhase` retombe à 0 : un `reset` appelé plus tard (une
// minuterie, la relance d'un repli) n'est jamais pris pour un geste. `navigator.userActivation.isActive` ne le dit pas : il
// reste vrai quelques secondes après n'importe quel clic dans la page
var _failedGeste = null;
if (typeof window !== 'undefined' && window.addEventListener) {
  ['click', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchend'].forEach(function(t) {
    window.addEventListener(t, function(e) { if (e.isTrusted) _failedGeste = e; }, true);
  });
}
var _failedEnCours = function(e) {
  return !!e && e.isTrusted === true && e.eventPhase > 0;
};

µ._mjs_resetComponent = function(comp, voulu) {
  var fresh = document.createElement(comp.tagName.toLowerCase());
  var attrs = comp.attributes, i, a, k, nodes, effs;
  for (i = 0; i < attrs.length; i++) {
    a = attrs[i];
    if (a.name === 'mjs-loading' || a.name === 'mjs-error') continue;
    if (a.name === 'class') {
      var c = a.value.replace(/\bmjs-error\b/g, '').trim();
      if (c) fresh.setAttribute('class', c);
      continue;
    }
    fresh.setAttribute(a.name, a.value);
  }
  // les événements que le parent écoute sur la balise (`@ping={…}`, liaison à double sens) : son routage lit ces
  // marques sur le nœud (cf. `_mjs_registerRefs`, mjs_element.ts)
  if (comp._mjs_ids) {
    fresh._mjs_ids = comp._mjs_ids;
    fresh._mjs_eo = comp._mjs_eo;
  }
  // le composant dont le gabarit a écrit la balise la désigne dans ses nœuds : il désigne désormais la neuve, et lui
  // repose ses props (objets, tableaux, que les attributs ne portent pas) en rejouant ses liaisons, AVANT son premier
  // rendu. Sans quoi la neuve gardait son état par défaut, et le parent écrivait dans l'ancienne, détachée, qu'il
  // retenait. Limite : la balise d'une ligne de {for} du parent garde sa référence dans la ligne
  var owner = µ._mjs_climb(comp, function(n) {
    var ns = n._mjs_nodes, j;
    if (ns) for (j in ns) if (ns[j] === comp) return true;
  });
  if (owner) {
    nodes = owner._mjs_nodes;
    for (k in nodes) {
      if (nodes[k] === comp) nodes[k] = fresh;
    }
    effs = owner._mjs_effectsAll;
    if (effs && !owner._mjs_has_crashed) {
      µ.activeComponent = owner;
      try {
        for (i = 0; i < effs.length; i++) effs[i].call(owner);
      } catch (err) {
        owner._mjs_catchError(err);
      } finally {
        µ.activeComponent = null;
      }
    }
  }
  // Transfert du light-DOM (enfants slottés) : sans lui, un
  // `<my-card><p>…</p></my-card>` ressuscitait VIDE après un reset de
  // boundary. Les nœuds sont DÉPLACÉS (pas clonés) — listeners préservés.
  while (comp.firstChild) {
    fresh.appendChild(comp.firstChild);
  }
  µ._mjs_swap(comp, fresh);
  // rétablissement VOULU (`voulu` : reset appelé pendant la distribution d'un geste de l'utilisateur, un clic sur « réessayer ») : l'instance
  // neuve qui vit deux secondes sans replanter voit ses réessais repartir de zéro — un plantage plus tard (une autre
  // action, des heures après) retrouve un reset qui marche. Une relance hors geste (le repli qui rappelle `reset` seul,
  // `setTimeout(reset, 10)`) ne remet jamais le compte à zéro : la limite arrête une erreur qui revient, quelle que soit
  // sa période
  if (voulu) {
    setTimeout(function() {
      if (fresh.isConnected && fresh._mjs_initial_render === false && !fresh._mjs_has_crashed) fresh.removeAttribute('mjs-retry-used');
    }, 2000);
  }
};

// Patch de `µ.Element.prototype` (même technique que mjs_on.ts) : DOIT rester APRÈS mjs_element.ts
// dans la concaténation.
if (µ.Element) {
  // Remonte vers la boundary ancêtre la plus proche (composant ayant un
  // `_mjs_fallback`), en traversant les shadow roots via getRootNode().host, quelle que soit la profondeur
  // (une borne de 50 nœuds, chaque balise comptée, manquait une frontière posée plus haut dans un arbre profond)
  µ.Element.prototype._mjs_findBoundary = function() {
    return µ._mjs_climb(this, function(node) {
      return typeof node._mjs_catchError === 'function' && typeof node._mjs_fallback === 'function';
    });
  };

  // `_mjs_runBoundary(err)` : suite de `_mjs_catchError` une fois le crash noté (log, `_mjs_has_crashed`,
  // classe `mjs-error`). Rend `true` quand le crash est pris en charge — remonté à l'ancêtre, ou
  // repli propre affiché — et `false` quand il faut le panneau fatal : ni repli ni ancêtre, ou
  // repli qui jette à son tour.
  µ.Element.prototype._mjs_runBoundary = function(err) {
    // Propagation : sans fallback propre, l'erreur REMONTE vers la boundary
    // ancêtre la plus proche (errors bubble, comme React/Svelte). Permet à un
    // parent (`<@failed>`) de contenir le crash d'un composant enfant.
    if (typeof this._mjs_fallback !== 'function') {
      var anc = this._mjs_findBoundary();
      if (anc) {
        this._shadow.innerHTML = "";
        anc._mjs_catchError(err);
        return true;
      }
      return false;
    }
    this._shadow.innerHTML = "";
    var self = this;
    // limite de réessai
    // (`<@failed retry="N">`, défaut 1, posée par le compilateur dans
    // `_mjs_failedRetry`/`_mjs_failedRetryMsg`, cf. transpiler/macros.ts).
    // Le compte de tentatives DÉJÀ consommées vit sur un ATTRIBUT DOM
    // (`mjs-retry-used`), PAS sur `this`/`_state` : `µ._mjs_resetComponent`
    // remplace `self` par une instance FRAÎCHE (nouveau constructeur, tout
    // l'état ré-initialisé à zéro) — un compteur posé sur l'instance ne
    // survivrait à AUCUN reset (il ne compterait plus rien, la boucle
    // resterait infinie). Les ATTRIBUTS, eux, sont EXPLICITEMENT recopiés
    // de l'ancien nœud vers le neuf par `_mjs_resetComponent` (boucle
    // `fresh.setAttribute(...)`, ci-dessus) : c'est le seul support qui
    // traverse le remplacement — la même astuce que `mjs-loading`/`mjs-error`
    // déjà portés par cette recopie.
    var retryLimit = typeof this._mjs_failedRetry === 'number' ? this._mjs_failedRetry : 1;
    var retryUsed = parseInt(self.getAttribute('mjs-retry-used'), 10) || 0;
    var reset;
    if (retryUsed < retryLimit) {
      reset = function(ev) {
        self.setAttribute('mjs-retry-used', String(retryUsed + 1));
        // voulu : appelé pendant la distribution d'un geste de l'utilisateur — l'événement reçu par un reset posé en écouteur
        // (`@click=reset`), ou celui vu à la capture —, jamais après : seul un reset voulu peut faire repartir le compte de zéro
        return µ._mjs_resetComponent(self, _failedEnCours(ev) || _failedEnCours(_failedGeste));
      };
    }
    else {
      // Limite atteinte : le fallback s'affiche quand même (avec l'erreur),
      // mais `reset` devient un no-op — plus aucune construction, donc plus
      // aucun crash qui rappellerait `_mjs_catchError` en boucle.
      µ.error(this._mjs_failedRetryMsg || (µ._mjs_msg('failedLimit', { limit: retryLimit }, '<@failed> : limite de réessai atteinte ({limit}) — abandon.')));
      reset = function() {};
    }
    // valeur jetée vide (`throw null`, promesse rejetée sans raison) : le repli reçoit une Error qui la nomme — sinon
    // `{err.message}`, la forme documentée, faisait échouer le repli entier (bandeau fatal, plus de reset)
    if (err == null) err = new Error(String(err));
    try {
      var out = this._mjs_fallback(err, reset);
      if (out instanceof Node) {
        // <@failed> compilé : le builder retourne un conteneur dont le DOM a
        // déjà ses events câblés (`@click=reset` = vrai listener). On en déverse
        // les enfants dans le shadow (les listeners suivent les nœuds).
        while (out.firstChild) {
          this._shadow.appendChild(out.firstChild);
        }
      }
      else {
        // back-compat : `@failed (err, reset) -> "html"` (fallback en string).
        // Là un `@click` n'est pas compilé → le bouton reset porte `mjs-reset`.
        this._shadow.innerHTML = String(out);
        var triggers = this._shadow.querySelectorAll('[mjs-reset]');
        for (var i = 0; i < triggers.length; i++) {
          triggers[i].addEventListener('click', reset);
        }
      }
      return true;
    } catch (__fbErr) {
      // le fallback `<@failed>`/`µfailed`
      // reçoit un `err` arbitraire et peut lui-même jeter : sans filet,
      // l'exception s'échappait de `_mjs_catchError` (souvent depuis un microtask
      // de rendu, shadow déjà vidé) → aucun message fatal affiché. On log et
      // on RETOMBE sur l'overlay `.mjs-fatal-error` de `_mjs_catchError`.
      µ.error(µ._mjs_msg('failedFallback', null, 'fallback @failed en erreur :'), __fbErr);
      this._shadow.innerHTML = "";
      return false;
    }
  };
}
