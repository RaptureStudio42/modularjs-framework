// mjs_effect — rune `µeffect` (µ.effect), effet réactif générique. DÉTACHÉ du cœur :
// embarqué si le projet écrit `µeffect`/`µ.effect` DIRECTEMENT, mais aussi si l'une des
// syntaxes qui s'appuient dessus EN SILENCE est présente (aucune ne laisse le mot « effect »
// dans le source du projet — le signal doit donc les couvrir explicitement, cf.
// bundler/index.ts, scanRuntimeFeatures) :
//   - `@persist` (transpiler/directives.ts) compile en un `µ.effect` dont le rappel écrit `backend.setItem(...)` sous un `try` (le navigateur peut refuser le stockage) ;
//   - `µdebug $x` (transpiler/index.ts) compile en `µ.effect => µ.log(...); debugger` ;
//   - `<@head>` à contenu, les liaisons class/style de `<@body>`/`<@html>`, `<@element>`/
//     `<@module>`, et les liaisons two-way `scrollX`/`scrollY` de `<@window>` (transpiler/
//     macros.ts) émettent chacun leur propre `µeffect =>` autour de l'appel runtime.
// `_mjs_runEffectsV2` (mjs_element.ts, cœur) ne fait qu'ITÉRER `comp._mjs_effects` — un composant qui
// n'a jamais appelé `µ.effect` a un tableau vide/absent, elle ne dépend donc pas de ce fichier.
//
// Cache de RegExp par var name (var names sont stables dans le projet).
// Évite alloc + compilation regex × N vars × M effects par composant.
µ._mjs_effectVarRegexCache ||= {};

// `precomputedVars` (2e paramètre,
// optionnel) est injecté par le compilateur (generator/effect-deps.ts) : liste
// des `$.xxx` lus dans `fn`, calculée en AST AVANT toute minification. Avant
// ce fix, la SEULE source était le scan runtime ci-dessous (`fn.toString()` +
// regex `$.<var>` littérale) — cassé dès que le code est minifié : esbuild
// renomme le PARAMÈTRE local `$` (`function($){}` → `function(n){}`, vérifié
// empiriquement) sans toucher aux noms de PROPRIÉTÉ, donc le texte minifié
// contient `n.count`, jamais `$.count` — la regex ne matchait plus RIEN.
// `staticVars` restait alors TOUJOURS vide en prod → chaque effect basculait
// sur le mode fail-open "pas de deps connues → fire à CHAQUE mutation" (cf.
// _mjs_runEffectsV2, mjs_element.ts) — silencieux, pas un crash, mais défait tout
// l'intérêt du dispatch V2 par var. Le scan `fn.toString()` reste le FALLBACK
// pour un `µ.effect` appelé hors pipeline compilateur (code runtime écrit à
// la main, sans 2e argument).
µ.effect = function(fn, precomputedVars) {
  var comp, fnStr, key, staticVars, rxCache;
  comp = µ.activeComponent;
  // <reffet-racine>
  // pendant une racine (`µeffect.root`, plus bas) : le reffet est à elle
  if (_mjsRacine) return _mjsRacineAdopte(_mjsRacine, fn, precomputedVars);
  if (_mjsRacineC) comp = _mjsRacineC;
  // </reffet-racine>
  // <reffet-magasin>
  // premier niveau d'un module (fichier d'un magasin compris), pendant qu'il s'exécute : le reffet appartient au module (plus bas). Le
  // corps d'un reffet de module (son abonné, `_mjs_mag`) n'est plus ce premier niveau : pas de propriétaire, refusé comme ailleurs
  if (comp && comp._mjs_mag) comp = null;
  else if (!comp && _mjsMagasin) return _mjsReffetMagasin(_mjsMagasin, fn, precomputedVars);
  // </reffet-magasin>
  if (!comp) {
    return µ.warn(µ._mjs_msg('effectInit', null, 'µeffect s\'écrit au premier niveau du <script> d\'un composant, ou au premier niveau d\'un module (fichier .civet ou .coffee, fichier d\'un magasin compris) : dans une fonction appelée plus tard, il n\'a pas de propriétaire et ne tourne pas. Écrivez-le au premier niveau, et faites-lui lire ce qui doit le relancer ; pour un reffet lancé à la demande (à l\'ouverture d\'un panneau, par exemple), écrivez-le dans µeffect.root -> …, qui rend la fonction qui l\'arrête.'));
  }
  comp._mjs_effects ??= [];
  // V2 — dispatch direct sans bitmask : on collecte la LISTE des state vars
  // lues par l'effect (scan statique de la source de fn) au lieu d'un mask.
  // Le runtime (`_mjs_runEffectsV2`) filtre par intersection avec `_mjs_lastMutedVars`.
  // Plus de limite 31 vars : un array peut contenir des centaines de noms.
  if (precomputedVars != null) {
    staticVars = precomputedVars;
  } else {
    staticVars = [];
    fnStr = fn.toString();
    rxCache = µ._mjs_effectVarRegexCache;
    if (comp._mjs_var_bits) {
      for (key in comp._mjs_var_bits) {
        var rx = rxCache[key];
        if (!rx) {
          rx = rxCache[key] = new RegExp("(?:[^a-zA-Z0-9_$]|^)\\$\\." + key + "\\b");
        }
        if (rx.test(fnStr)) {
          staticVars.push(key);
        }
      }
    }
  }
  // `_mjs_varHasUserEffect`
  // (mjs_element.ts) MÉMOÏSE `_mjs_userEffectVars` au 1er `_set` post-mount et ne le
  // recalcule JAMAIS. Un `µ.effect` enregistré APRÈS (hook `µmount`, où
  // `µ.activeComponent` est posé par le batch ; ou effet créé depuis un autre
  // effet) n'entrait donc jamais dans l'index → l'ultra fast-path no-op de
  // `_mjs_invalidate` concluait « aucun effet ne lit k » et l'effet ne se déclenchait
  // JAMAIS. On invalide le cache à chaque push : il sera reconstruit (incluant le
  // nouvel effet) au prochain `_mjs_varHasUserEffect`.
  // 3ᵉ morsure — expansion computeds chaînés : un effet qui ne
  // lit qu'un dérivé (`$c` où c ← b ← a) ne se re-déclenchait JAMAIS quand une racine
  // mutait (_mjs_runEffectsV2 compare la clé muée aux staticVars LITTÉRALES). Le compilateur
  // émet `_mjs_computedDeps` (closure transitive — dérivés de dérivés déjà aplatis par
  // l'analyzer) ; on étend ICI, à l'enregistrement : zéro coût dans les chemins chauds.
  // Couvre les deux branches (precomputedVars ET scan fallback) ; copie avant ajout —
  // le literal precomputedVars du code compilé ne doit pas être muté en place.
  var cdeps = comp._mjs_computedDeps;
  if (cdeps && staticVars.length > 0) {
    var expanded = null;
    for (var si = 0; si < staticVars.length; si++) {
      var roots = cdeps[staticVars[si]];
      if (roots) {
        if (expanded == null) expanded = new Set(staticVars);
        for (var ri = 0; ri < roots.length; ri++) expanded.add(roots[ri]);
      }
    }
    if (expanded != null) staticVars = Array.from(expanded);
  }
  comp._mjs_userEffectVars = void 0;
  var rec = {
    staticVars,
    fn,
    cleanup: null
  };
  // <reffet-avant>
  if (_mjsBefore) rec.before = comp._mjs_before = 1;
  // </reffet-avant>
  // graphe des signaux (mjs_signals.ts, toujours joint avec un reffet) : le reffet est un nœud mené par la passe de son composant, qui
  // le rejoue quand une variable ou une clé du magasin lue à son dernier passage a vraiment changé (lectures notées par le compilateur,
  // dans le reffet et les fonctions qu'il appelle ; celles du magasin par `µ.store`, mjs_store_globals.ts). Le relevé de la construction
  // garde ce que le graphe ne note pas (`res`) : les règles fines du magasin et ce que le reffet lit après coup ;
  // il sert seul tant que le reffet n'a rien noté (code écrit à la main, lecture par une clé calculée `$[k]`)
  if (µ._mjs_sigHost) {
    rec.n   = µ._mjs_sigHost(comp, rec.before, _mjsEffWake);
    rec.res = _mjsHorsGraphe(staticVars, comp._mjs_computedDeps, rec);
    rec.fn  = function() {
      return µ._mjs_sigRunIn(rec.n, fn, this);
    };
  }
  comp._mjs_effects.push(rec);
  // rendue à l'appelant : retire le reffet. Le tableau est remplacé, jamais modifié en place : un passage en cours
  // (_mjs_runEffectsV2, mjs_element.ts) finit le sien sans sauter ni rejouer un autre reffet, et y croise celui-ci sans
  // le jouer (`fn` effacé). Son nettoyage joue une fois ; un deuxième appel ne fait rien ; appelée après la destruction,
  // elle ne rejoue pas le nettoyage, déjà joué, et le reffet ne repart pas quand le composant revient dans la page
  return function() {
    var c = rec.cleanup;
    if (!rec.fn) return;
    rec.fn = rec.cleanup = null;
    if (rec.n) µ._mjs_sigDrop(comp, rec.n);
    comp._mjs_effects = comp._mjs_effects.filter(function(x) { return x !== rec; });
    comp._mjs_userEffectVars = void 0;
    if (c) c.call(rec);
  };
};
// un reffet de composant marqué par le graphe réveille son composant (passe en microtâche des reffets, mjs_element.ts) ; un reffet
// d'avant l'écran marqué pendant le tour des reffets d'avant de son composant prend acte, comme le relevé : les écritures de ce tour
// entrent dans le passage en cours et ne relancent aucun reffet d'avant (kind 1, mjs_signals.ts)
function _mjsEffWake(n) {
  if (n.kind === 1 && n.owner._mjs_beforeIn) µ._mjs_sigAck(n);
  else n.owner._mjs_effWake();
}

// dépendances du relevé que le graphe ne note pas : marque « au montage seulement » (`!`), énumération du magasin (`$$*`), clé que le
// reffet écrit lui-même pendant son passage (`$$x!` : seule une écriture faite hors de tout reffet le relance ; le graphe ne la note
// pas, `bang`), variable ou clé lue après coup (`~x`, `~$$x` : après un `await`, dans un rappel, une minuterie, une promesse ; le graphe
// ne voit que le passage), avec les racines d'une valeur dérivée
function _mjsHorsGraphe(sv, cdeps, rec) {
  var res = [], i, d, c, r;
  for (i = 0; i < sv.length; i++) {
    d = sv[i];
    c = d.charCodeAt(0);
    if (c === 126) {
      d = d.slice(1);
      res.push(d);
      if (cdeps && (r = cdeps[d])) res.push.apply(res, r);
    }
    else if (c === 33 || d === '$$*') res.push(d);
    else if (c === 36 && d.charCodeAt(d.length - 1) === 33) {
      res.push(d);
      (rec.bang ||= []).push(d.slice(2, -1));
    }
    // clé lue que le reffet n'écrit pas lui-même : une écriture faite pendant son passage par un code que le compilateur ne voit pas
    // la laisse parmi ses sources (`keep`, µ._mjs_sigWrite)
    else if (c === 36 && d.charCodeAt(1) === 36) (rec.n.keep ||= []).push(d.slice(2));
  }
  return res;
}
// <reffet-avant>

// `µeffect.before ->` (sucre universel : `µ.effect.before`) : le reffet d'avant l'écran. Même enregistrement que `µ.effect`, marqué
// `before` : le cœur le joue juste avant les blocs et les liaisons de son composant (`_mjs_runBefore`, mjs_element.ts), jamais avec
// les autres reffets. Au premier niveau du fichier d'un magasin, c'est un reffet du magasin comme un autre : il n'a pas d'écran
var _mjsBefore = 0;
µ.effect.before = function(fn, precomputedVars) {
  _mjsBefore = 1;
  try { return µ.effect(fn, precomputedVars); }
  finally { _mjsBefore = 0; }
};
// </reffet-avant>
// <reffet-magasin>

// REFFET D'UN MODULE — `µeffect` au premier niveau d'un module (fichier .civet ou .coffee, fichier qui déclare un
// magasin compris, `<script module>` d'un composant) : le compilateur encadre ce code de `µ._mjs_magOpen(nom)` et `µ._mjs_magClose()`
// (bundler/index.ts, compileScriptModuleCold ; transpiler/index.ts). Le module est son propriétaire : le reffet vit avec la page, sans
// aucun composant. Il reste hors du graphe des signaux : ses sources (`µ$$x` en entier, un `µStore` prévenu en microtâche, les clés
// `$$x`) le préviennent par abonnement, avec la règle exacte de sa propre écriture (`µ._mjs_magW`) ; mené par la file du graphe, il ne
// suivrait que les clés `$$x`, le graphe ne notant ni un `µ$$x` ni un `µStore` :
// - un abonné par passage (`_mjs_mag` : son reffet) tient la place du composant actif : `µ$$x` (µ.state), un `µStore` ou une clé
//   `$$x` qu'il lit le préviennent comme un composant (`_mjs_invalidate`) ; un passage réussi remplace les abonnements d'avant, un
//   passage qui lève garde ceux de son dernier passage réussi, et le reffet repart au changement suivant
// - il passe une fois à la création (microtâche, le fichier fini), puis une fois par rafale d'écritures de ce qu'il a lu ; sa
//   propre écriture, pendant son passage, ne le relance pas : `µ._mjs_magW` le désigne le temps du passage ; prévenu sur-le-champ
//   (µ.state, clé `$$x`), il s'ignore, prévenu en microtâche (µStore, mjs_store.ts), il est noté auteur de la clé et sauté s'il en
//   est le seul auteur de la passe ; garde des 10 000 passages par rafale, comme un composant
// - un module ne finit pas pendant la vie de la page : seul son fichier réexécuté (rechargement à chaud) nettoie d'abord les
//   reffets de sa vie d'avant (nettoyage joué, abonnements défaits), et les racines ouvertes à son premier niveau ; un `µStore` créé
//   à son premier niveau arrête ses reffets quand on le jette (`destroy()`, mjs_store.ts)
var _mjsMagasin = null;
µ._mjs_storeOwners ||= new Map();
µ._mjs_magOpen = function(id) {
  var avant = µ._mjs_storeOwners.get(id), m = { id: id, effs: [] };
  if (avant) avant.effs.forEach(function(s) { s.stop(); });
  µ._mjs_storeOwners.set(id, _mjsMagasin = m);
  // un fichier qui lève avant sa fin n'atteint pas `µ._mjs_magClose()` : fermé quand même à la fin de la tâche en cours, un reffet
  // écrit ensuite n'y est jamais adopté
  queueMicrotask(function() {
    if (_mjsMagasin === m) _mjsMagasin = null;
  });
};
µ._mjs_magClose = function() {
  _mjsMagasin = null;
};

// `deps` : liste du compilateur (generator/effect-deps.ts) ; seules ses clés `$$x` servent, abonnées une fois pour toutes —
// µ.state et µStore notent, eux, chaque lecture du passage
function _mjsReffetMagasin(m, fn, deps) {
  var prevu = false, rafale = 0, tours = 0, cles = [], ab = null, s;
  if (deps) for (var i = 0; i < deps.length; i++) if (deps[i].charCodeAt(0) === 36 && deps[i].charCodeAt(1) === 36) cles.push(deps[i].slice(2).replace(/!$/, ''));
  // les abonnements d'un passage, que porte son abonné : défaits quand un passage suivant réussit, ou quand le reffet est retiré
  function desabonne(o) {
    if (!o) return;
    if (o._mjs_store_unsubs) o._mjs_store_unsubs.forEach(function(f) { f(); });
    if (o._mjs_univ_targets) µ._mjs_cleanupUniversalDeps(o);
  }
  function passe() {
    var c = s.cleanup, e = µ._mjs_mtT ||= setTimeout(function() { µ._mjs_mtT = 0; }), ok = false, o;
    prevu = false;
    if (!s.fn) return;
    if (rafale !== e) {
      rafale = e;
      tours  = 0;
    }
    if (++tours > 10000) {
      if (tours === 10001) µ.warn(µ._mjs_msg('elLoop', { tag: m.id }, 'Boucle réactive détectée sur <{tag}> : plus de 10 000 rendus dans la même rafale de microtasks. Un effet mute probablement sa propre dépendance ($x = $x + … dans un µeffect ?). Effets suspendus pour garder la page vivante.'));
      return;
    }
    s.cleanup = null;
    try {
      if (c) c.call(s);
    } catch (err) { µ.warn('Cleanup error:', err); }
    // un abonné neuf tient la place du composant actif : ce que lit ce passage s'abonne à lui seul
    µ.activeComponent = o = { _mjs_mag: s, _mjs_invalidate: s._mjs_invalidate };
    µ._mjs_magW       = s;
    try {
      var r = s.fn();
      ok = true;
      if (typeof r === 'function' && !r._mjs_timer) {   // main d'arrêt de µafter / µevery rendue : pas un nettoyage (mjs_every.ts)
        if (s.fn) s.cleanup = r;
        else r.call(s);
      }
    } catch (err) {
      µ.error('Crash intercepted in ' + m.id + ':', err);
    } finally {
      µ.activeComponent = µ._mjs_magW = null;
    }
    // passage réussi : ses lectures remplacent celles d'avant. Passage qui lève : il garde les abonnements de son dernier passage réussi
    // (s'il n'en a eu aucun, ce qu'il a lu avant l'erreur) et repart au changement suivant
    if (s.fn && (ok || !ab)) {
      desabonne(ab);
      ab = o;
    }
    else desabonne(o);
  }
  s = {
    fn: fn,
    cleanup: null,
    _mjs_invalidate: function() {
      if (!s.fn || µ._mjs_magW === s || prevu) return;
      prevu = true;
      queueMicrotask(passe);
    },
    // rendue à l'appelant, jouée aussi quand le fichier repart : le nettoyage joue une fois, un deuxième appel ne fait rien
    stop: function() {
      var c = s.cleanup;
      if (!s.fn) return;
      s.fn = s.cleanup = null;
      desabonne(ab);
      ab = null;
      if (cles.length) µ._mjs_storeUnsubscribe(s);
      if (c) c.call(s);
    }
  };
  m.effs.push(s);
  if (cles.length) µ._mjs_storeSubscribe(s, cles);
  s._mjs_invalidate();
  return s.stop;
}
// </reffet-magasin>
// <reffet-racine>

// RACINE — `µeffect.root -> …` (sucre universel : `µ.effect.root`) : les reffets écrits pendant `fn`, dans une fonction qu'elle appelle
// comprise, sont à la racine ; la fonction rendue les arrête tous (nettoyage joué une fois ; un deuxième appel ne fait rien) :
// - dans le `<script>` d'un composant et dans les gestionnaires de son gabarit, le compilateur passe le composant (`comp`,
//   generator/effect-deps.ts) : ses reffets sont ceux du composant, menés par sa passe, et finissent avec lui ; nés après son montage,
//   leur premier passage part en microtâche
// - ailleurs (module, fichier d'un magasin, `<script module>`, fichier `.js` importé), chacun est mené comme le reffet d'un module
//   (blocs `<reffet-magasin>`, que le cœur de production ne garde qu'avec une telle racine ou un reffet de module, bundler/features.ts)
// - une racine ouverte pendant une autre s'arrête avec elle ; ouverte au premier niveau d'un module, avec la vie de ce module
// - côté serveur, `fn` passe et aucun de ses reffets ne tourne
var _mjsRacine = null, _mjsRacineC = null;
µ.effect.root = function(fn, comp) {
  var avant = _mjsRacine, r = { id: 'µeffect.root', effs: [], c: comp || (avant ? avant.c : null), neufs: null }, off;
  off = r.stop = function() {
    var l = r.effs, i;
    r.effs = [];
    for (i = 0; i < l.length; i++) l[i].stop();
  };
  // marquée du passage du gestionnaire du gabarit en cours, comme le retrait de `µon` (mjs_on.ts) et la main d'arrêt de `µafter`
  // (mjs_every.ts) : rendue par lui (`@click={µeffect.root -> …}`, `@click={@ouvrir()}`), le routeur ne l'appelle pas et la racine
  // reste ouverte ; rangée puis rendue par un clic suivant, elle l'arrête
  off._mjs_born = µ._mjs_evPass;
  if (avant) avant.effs.push(r);
  // <reffet-magasin>
  else if (_mjsMagasin) _mjsMagasin.effs.push(r);
  // </reffet-magasin>
  _mjsRacine = r;
  try {
    fn();
  }
  finally {
    _mjsRacine = avant;
  }
  // nés pendant le montage du composant (son `<script>`, son premier rendu), ils passent avec ses autres reffets
  if (r.neufs && !r.c._mjs_initial_render) queueMicrotask(_mjsRacinePremier.bind(null, r.c, r.neufs));
  r.neufs = null;
  return r.stop;
};

// un reffet écrit pendant la racine `r` : celui de son composant (enregistré comme au premier niveau du `<script>`), sinon mené comme le
// reffet d'un module
function _mjsRacineAdopte(r, fn, deps) {
  var c = r.c, arret;
  if (µ._isServer || µ.server === true) return function() {};
  // <reffet-magasin>
  if (!c) return _mjsReffetMagasin(r, fn, deps);
  // </reffet-magasin>
  _mjsRacine  = null;
  _mjsRacineC = c;
  try {
    arret = µ.effect(fn, deps);
  }
  finally {
    _mjsRacine  = r;
    _mjsRacineC = null;
  }
  r.effs.push({ stop: arret });
  (r.neufs ||= []).push(c._mjs_effects[c._mjs_effects.length - 1]);
  return arret;
}

// premier passage des reffets d'une racine dans un composant monté, ceux d'avant l'écran d'abord, comme une passe du composant
// (_mjs_runEffectsV2, mjs_element.ts) ; un reffet qu'une passe a déjà pris (sources notées), retiré, ou d'un composant qui n'est pas
// dans la page attend sa passe. Le composant est le composant actif le temps du passage, comme dans sa passe : un `µStore` et un `µ$$x`
// lus l'abonnent (mjs_store.ts, mjs_runes.ts), le reffet repart à leur écriture comme un reffet du premier niveau
function _mjsRacinePremier(c, l) {
  var prev = µ._mjs_effRun, ie = µ._mjs_inEffect, i, e, res;
  if (!c._mjs_is_mounted || c._mjs_has_crashed) return;
  l.sort(function(x, y) { return (y.before | 0) - (x.before | 0); });
  µ._mjs_inEffect   = true;
  µ.activeComponent = c;
  try {
    for (i = 0; i < l.length; i++) {
      e = l[i];
      if (!e.fn || (e.n && e.n.deps !== null)) continue;
      µ._mjs_effRun = e;
      try {
        res = e.fn();
        if (typeof res === 'function' && !res._mjs_timer) {   // main d'arrêt de µafter / µevery rendue : pas un nettoyage (mjs_every.ts)
          if (e.fn) e.cleanup = res;
          else res.call(e);
        }
      } catch (err) {
        if (typeof c._mjs_catchError === 'function') c._mjs_catchError(err);
      }
    }
  }
  finally {
    µ.activeComponent = null;
    µ._mjs_effRun     = prev;
    µ._mjs_inEffect   = ie;
  }
}
// <magasin-fin>

// propriétaire d'un `µStore` créé maintenant (mjs_store.ts), dont les reffets s'arrêtent quand on le jette : la racine en cours, dans un
// cœur sans reffet de module (le bloc suivant, gardé avec lui, pose celui qui dit aussi le module)
µ._mjs_proprio = function() {
  return _mjsRacine;
};
// </magasin-fin>
// </reffet-racine>
// <reffet-magasin>
// <magasin-fin>

// propriétaire d'un `µStore` créé maintenant (mjs_store.ts), dont les reffets s'arrêtent quand on le jette : la racine en cours,
// sinon le module dont le premier niveau s'exécute ; la racine déclarée ici aussi pour un cœur qui n'en a pas (bloc retiré)
// eslint-disable-next-line no-redeclare
var _mjsRacine;
µ._mjs_proprio = function() {
  return _mjsRacine || _mjsMagasin || null;
};
// </magasin-fin>
// </reffet-magasin>
