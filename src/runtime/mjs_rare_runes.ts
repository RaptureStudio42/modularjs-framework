// mjs_rare_runes — runes PEU utilisées, regroupées dans un seul fichier détecté (µplay,
// µminmax, µinspect, µraw, µsnap, µimport) : chacune est minuscule, aucune ne dépend des
// autres, mais les séparer en 6 fichiers n'apporterait rien — le bundle les embarque TOUS
// dès qu'UNE SEULE est utilisée dans le projet (cf. bundler/index.ts, scanRuntimeFeatures,
// clé détectée 'rare_runes'). Rapatriées ici depuis mjs_runes.ts (µplay/µminmax/µraw/
// µinspect) et mjs_init.ts (µsnap/µ._mjs_import) — zéro changement de comportement.

µ.raw = function(target) {
  if (target !== null && typeof target === 'object') {
    // Marqueur dans µ._mjs_rawSet (cf. mjs_init.ts) — pas de prop string sur
    // l'objet user (mangle-safe + sans pollution `for...in`/`Object.keys`).
    µ._mjs_rawSet.add(target);
  }
  return target;
};

// dédup des avertissements « bornes inversées », PAR COMPOSANT ET PAR
// VARIABLE (WeakMap instance → Set des clés déjà averties) — pas globalement
// par couple (min,max) : deux `$vars`/composants DIFFÉRENTS qui partagent la
// même paire fautive (100, 0) sont deux fautes DISTINCTES, chacune doit
// avertir ; seule une RÉPÉTITION sur la même variable du même composant est
// du bruit. WeakMap : un composant détruit part avec ses entrées.
const MJS_MINMAX_WARNED = new WeakMap();

µ.minmax = function(instance, key, min, max) {
  var clamped, currentVal;
  // `µminmax($x.volume, 0, 10)` : clé en tableau ['x', 'volume'] (sigils.ts, cleMinmaxChemin)
  if (Array.isArray(key)) return µ._mjs_minmaxChemin(instance, key, min, max);
  if (instance._mjs_limits == null) {
    instance._mjs_limits = {};
  }
  instance._mjs_limits[key] = {min, max};
  // `µminmax $v, 100, 0` (bornes inversées, faute de frappe
  // plausible sur l'ordre min/max) clampait tout au max en silence — le
  // clamp reste inchangé ci-dessous, seul l'avertissement est nouveau.
  if (min !== null && max !== null && min > max) {
    let _warned = MJS_MINMAX_WARNED.get(instance);
    if (!_warned) {
      _warned = new Set();
      MJS_MINMAX_WARNED.set(instance, _warned);
    }
    if (!_warned.has(key)) {
      _warned.add(key);
      µ.warn('[ModularJS] µminmax : bornes inversées (min '+ min +' > max '+ max +') sur `'+ key +'`');
    }
  }
  // V2 : la propriété `.$` (proxy V1) n'existe plus sur les instances —
  // `instance.$[key]` jetait TypeError au premier µminmax. L'état vit dans
  // `_state`, l'écriture clampée passe par `µ._set` (invalidation comprise).
  currentVal = instance._state ? instance._state[key] : void 0;
  if (currentVal && µ._mjs_interpolatorSet.has(currentVal)) {
    currentVal.min = min;
    currentVal.max = max;
    return currentVal.value = currentVal.target;
  } else if (typeof currentVal === 'number') {
    clamped = currentVal;
    if (min !== null) {
      clamped = Math.max(min, clamped);
    }
    if (max !== null) {
      clamped = Math.min(max, clamped);
    }
    if (clamped !== currentVal) {
      return µ._set(instance, key, clamped);
    }
  }
};

// µminmax sur une PROPRIÉTÉ (`µminmax($x.volume, 0, 10)`) — la règle vit sur CE composant
// seulement. Tout changement de `$x` qu'il fait passe par son point de passage unique,
// `_mjs_notifyMutation` : écriture compilée (`$x.volume += 20`, `$x[cle] = v`, liaison d'un
// champ), écriture par le filet d'un objet parti dans une fonction (`regler($x)`), remplacement
// entier (`$x = autre`). Ce point de passage est surchargé sur l'INSTANCE, jamais sur le
// prototype : un composant sans règle garde la méthode commune, sans le moindre test en plus. La
// valeur est rebornée SUR PLACE, dans l'objet lui-même, avant la notification — l'écran ne voit
// jamais la valeur hors bornes. Un composant ENFANT qui reçoit l'objet le surveille avec son
// propre point de passage : ses écritures ne sont pas bornées par la règle du parent (doc 03).
µ._mjs_minmaxChemin = function(instance, cle, min, max) {
  var racine = cle[0];
  var chemin = cle.slice(1);
  var regles = instance._mjs_limitesChemins || (instance._mjs_limitesChemins = {});
  var liste  = regles[racine] || (regles[racine] = []);
  var texte  = cle.join('.');
  // même règle qu'une variable : bornes inversées signalées une fois par chemin et par composant
  if (min !== null && max !== null && min > max) {
    var averties = MJS_MINMAX_WARNED.get(instance);
    if (!averties) { averties = new Set(); MJS_MINMAX_WARNED.set(instance, averties); }
    if (!averties.has(texte)) {
      averties.add(texte);
      µ.warn('[ModularJS] µminmax : bornes inversées (min '+ min +' > max '+ max +') sur `'+ texte +'`');
    }
  }
  // un second µminmax sur le même chemin REMPLACE la règle, jamais une seconde règle en plus
  var i = 0;
  while (i < liste.length && liste[i].texte !== texte) i++;
  liste[i] = { chemin: chemin, texte: texte, min: min, max: max };
  if (!instance._mjs_minmaxBranche) {
    instance._mjs_minmaxBranche = true;
    var commun = instance._mjs_notifyMutation;
    instance._mjs_notifyMutation = function(k, oldValue) {
      var l = this._mjs_limitesChemins[k];
      if (l) µ._mjs_borneChemins(this, k, l);
      return commun.call(this, k, oldValue);
    };
  }
  // la valeur actuelle est bornée tout de suite, et l'écran prévenu
  if (µ._mjs_borneChemins(instance, racine, liste)) instance._mjs_notifyMutation(racine);
};

// borne SUR PLACE, dans l'objet brut de `el._state[k]`, chaque chemin réglé qui mène à un nombre
// (un chemin absent, ou qui mène à autre chose qu'un nombre, est laissé tel quel). Rend `true`
// si une valeur a changé — l'époque de l'objet avance alors : un pair lié en deux sens (`=!{}`)
// verra une vraie mutation, jamais un écho à ignorer
µ._mjs_borneChemins = function(el, k, regles) {
  var brut = µ._mjs_toRaw(el._state ? el._state[k] : void 0);
  if (brut === null || typeof brut !== 'object') return false;
  var change = false;
  for (var i = 0; i < regles.length; i++) {
    var r = regles[i];
    var o = brut;
    for (var j = 0; j < r.chemin.length - 1 && o !== null && typeof o === 'object'; j++) o = µ._mjs_toRaw(o[r.chemin[j]]);
    if (o === null || typeof o !== 'object') continue;
    var prop = r.chemin[r.chemin.length - 1];
    var v    = o[prop];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    var b = v;
    if (r.min !== null) b = Math.max(r.min, b);
    if (r.max !== null) b = Math.min(r.max, b);
    if (b !== v) { o[prop] = b; change = true; }
  }
  if (change && !µ._mjs_rawSet.has(brut)) (el._mjs_bindEpochs || (el._mjs_bindEpochs = {}))[k] = µ._mjs_bumpEpoch(brut);
  return change;
};

// Délai de repli maximum avant résolution forcée — même ordre de grandeur que
// le filet de la destruction groupée (mjs_destroy_hooks.ts, "Transition
// exceeds 2000ms"), même risque : une classe CSS sans keyframe associée, ou
// un mouvement réduit qui désactive l'animation, ne déclenche jamais
// `animationend`/`animationcancel` → sans ce filet, la promesse ne se termine
// JAMAIS (cf. µ._mjs_vtCurtainRun, mjs_vt_presets.ts, même doctrine « filet
// setTimeout plutôt que dépendance totale à un event qui peut ne jamais partir »).
var MJS_PLAY_FALLBACK_MS = 2000;

µ.play = function(node, animationClass) {
  return new Promise(function(resolve) {
    var cleanup, fallbackId;
    if (!(node && animationClass)) {
      return resolve();
    }
    cleanup = function(e) {
      if (e && e.target !== node) {
        return;
      }
      clearTimeout(fallbackId);
      node.classList.remove(animationClass);
      node.removeEventListener('animationend', cleanup);
      node.removeEventListener('animationcancel', cleanup);
      return resolve();
    };
    node.classList.remove(animationClass);
    void node.offsetWidth;
    node.addEventListener('animationend', cleanup);
    node.addEventListener('animationcancel', cleanup);
    fallbackId = setTimeout(cleanup, MJS_PLAY_FALLBACK_MS);
    return node.classList.add(animationClass);
  });
};

// `chemin` (optionnel, cf. sigils.ts cheminInspectPlat) FILTRE juste l'affichage console —
// la clé entière reste TOUJOURS abonnée dans `_mjs_inspections` (`.has(clé)`, lu tel quel par
// mjs_element.ts/mjs_deep.ts pour décider si un snapshot vaut la peine d'être pris). Les chemins
// eux-mêmes sont rangés À PART, par clé, dans `_mjs_inspectPaths` :
// `µinspect($x.foo)` SUIT $x entier (comme `µinspect($x)`), juste une portée de sortie plus
// étroite. Un appel SANS chemin sur une clé déjà bornée à des chemins l'emporte TOUJOURS (affiche
// tout) — posé dans `_mjs_inspectAll`, jamais retiré : un `µinspect($x.foo)` qui arriverait
// APRÈS, sur la même clé, ne doit pas réduire à nouveau la portée.
µ.inspect = function(key, chemin) {
  var comp, chemins;
  comp = µ.activeComponent;
  if (!comp) {
    return µ.warn("[ModularJS] µ.inspect doit être appelé à l'initialisation.");
  }
  if (comp._mjs_inspections == null) {
    comp._mjs_inspections = new Set();
  }
  comp._mjs_inspections.add(key);
  if (!chemin) {
    if (comp._mjs_inspectAll == null) {
      comp._mjs_inspectAll = new Set();
    }
    comp._mjs_inspectAll.add(key);
    return comp._mjs_inspections;
  }
  if (comp._mjs_inspectAll && comp._mjs_inspectAll.has(key)) {
    // mode "tout" déjà acquis pour cette clé (posé avant ou après peu importe) : un chemin
    // supplémentaire n'y changerait rien, inutile de le ranger.
    return comp._mjs_inspections;
  }
  if (comp._mjs_inspectPaths == null) {
    comp._mjs_inspectPaths = new Map();
  }
  chemins = comp._mjs_inspectPaths.get(key);
  if (!chemins) {
    chemins = new Set();
    comp._mjs_inspectPaths.set(key, chemins);
  }
  chemins.add(chemin);
  return comp._mjs_inspections;
};

// résolution d'un chemin PLAT ('a.b.0', jamais un accès calculé — cf. sigils.ts
// cheminInspectPlat, seule source qui alimente ce chemin) dans une valeur : simple indexation
// chaînée, `undefined` dès que le conteneur intermédiaire manque.
function mjsInspectResoudre(valeur, chemin) {
  var segs, cur, i;
  segs = chemin.split('.');
  cur  = valeur;
  for (i = 0; i < segs.length; i++) {
    if (cur == null) return void 0;
    cur = cur[segs[i]];
  }
  return cur;
}

// égalité PAR VALEUR (jamais par référence) pour le filtre µinspect($x.chemin) — un
// remplacement de $x entier ne compte comme changement QUE si la valeur au chemin diffère
// réellement, pas juste parce que le conteneur a une nouvelle identité.
function mjsInspectEgal(a, b) {
  var ka, kb, i;
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) { if (!mjsInspectEgal(a[i], b[i])) return false; }
    return true;
  }
  ka = Object.keys(a);
  kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (i = 0; i < ka.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
    if (!mjsInspectEgal(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}

// clone profond pour la MÉMOIRE d'un chemin — jamais le snapshot `oldValue` reçu par
// `_mjs_notifyMutation`, superficiel PAR DESIGN (cf. µ._mjs_snap, mjs_init.ts : clone le
// TOP-LEVEL seulement) : une mutation en place 2 niveaux ou plus sous la racine PARTAGE sa
// référence avec ce snapshot, qui se retrouve à refléter la valeur APRÈS plutôt qu'avant — la
// comparaison tomberait alors TOUJOURS égale, aucun changement jamais détecté. Copie maison,
// ISOLÉE, mémorisée PAR CHEMIN (`_mjs_inspectPathsPrev`) plutôt que pour toute la racine : coût
// proportionné aux seuls chemins réellement inspectés, jamais à tout `$x`.
function mjsInspectClone(v) {
  var out, k;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(mjsInspectClone);
  if (v instanceof Date) return new Date(v.getTime());
  out = {};
  for (k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = mjsInspectClone(v[k]); }
  return out;
}

// affichage console d'une mutation inspectée — appelé par le cœur (`_mjs_notifyMutation`,
// mjs_element.ts) pour toute clé présente dans `_mjs_inspections`, que seul `µ.inspect` pose : le
// cœur n'en garde qu'un appel. `µinspect($x.chemin)` : la clé ENTIÈRE reste abonnée — seul
// l'AFFICHAGE se resserre à ses chemins, sauf si un `µinspect($x)` SANS chemin l'a emporté pour
// cette même clé (`_mjs_inspectAll`). Sans chemin : comportement historique, `$x` entier.
// `console.log` (pas `µ.log`) : explicitement demandé par l'utilisateur, affiché peu importe
// `µ.debug`. `µ._mjs_snap` déproxifie : un objet nu lisible, jamais un `Proxy { … }` opaque.
µ._mjs_inspectAffiche = function(el, k, oldValue) {
  var all, chemins, prev;
  all     = el._mjs_inspectAll;
  chemins = (!all || !all.has(k)) && el._mjs_inspectPaths && el._mjs_inspectPaths.get(k);
  if (!chemins || chemins.size === 0) {
    console.group(`🔍 [MJS Inspect] ${k}`);
    if (oldValue !== void 0) {
      console.log("%cFrom :", "color: #888", µ._mjs_snap(oldValue));
    }
    console.log("%cTo   :", "color: #2ecc71; font-weight: bold", µ._mjs_snap(el._state[k]));
    console.groupEnd();
    return;
  }
  if (el._mjs_inspectPathsPrev == null) el._mjs_inspectPathsPrev = new Map();
  prev = el._mjs_inspectPathsPrev.get(k);
  if (!prev) {
    prev = new Map();
    el._mjs_inspectPathsPrev.set(k, prev);
  }
  chemins.forEach(function(chemin) {
    var after, before;
    after  = mjsInspectResoudre(el._state[k], chemin);
    // `oldValue` (l'instantané reçu) n'est fiable que pour le premier appel : clone SHALLOW, il
    // partage sa référence avec l'état réel dès 2 niveaux sous la racine (mutation en place par
    // µ._mjs_deepSet/_mjs_deepCall) — résolu EN PLACE, il donnerait la valeur D'APRÈS
    before = prev.has(chemin) ? prev.get(chemin) : mjsInspectResoudre(oldValue, chemin);
    if (!mjsInspectEgal(before, after)) {
      console.group(`🔍 [MJS Inspect] ${k}.${chemin}`);
      if (before !== void 0) {
        console.log("%cFrom :", "color: #888", µ._mjs_snap(before));
      }
      console.log("%cTo   :", "color: #2ecc71; font-weight: bold", µ._mjs_snap(after));
      console.groupEnd();
    }
    prev.set(chemin, mjsInspectClone(after));
  });
};

// Fonction identité servant de marqueur pour la désactivation snapshot `=:` :
// le lexer transforme `$var =: expr` en `$var = µ.snap(expr)`,
// et l'AST analyzer reconnaît ce marqueur pour skipper la transformation
// en computed. Au runtime, `µ.snap` retourne simplement la valeur reçue.
// `=:` (et non `:=`) pour éviter la collision avec Civet où `:=` = const.
µ.snap = function(v) {
  return v;
};

// `µ._mjs_import(url)` : chargement PARESSEUX d'un module ES, cible compilée de
// la rune `µimport('chemin.js')` (sigils.ts, rewriteMuImport) — reçoit une
// URL déjà résolue/hachée par `µasset` (empreinte connue au build). Un
// import() nu est légal ICI (src/runtime/ échappe à lintNoRawImport,
// l'autoloader en a déjà un) — mais seul CE point d'entrée doit être atteint,
// jamais `µimport` lui-même (identifiant qui n'existe qu'au compile-time).
µ._mjs_import = function(url) {
  if (!url) throw new Error('µimport : chemin vide — asset non résolu au build');
  return import(url);
};
