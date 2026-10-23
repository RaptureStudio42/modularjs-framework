// mjs_inspect — rune µinspect (suivi d'une variable dans la console) et son affichage des changements
// (µ._mjs_inspectAffiche, appelé par mjs_element.ts seulement pour une clé suivie), détachées de
// mjs_rare_runes.ts : fichier détecté (clé 'inspect'), embarqué seulement si le projet écrit µinspect

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
    return µ.warn(µ._mjs_msg('runesInspectInit', null, 'µ.inspect doit être appelé à l\'initialisation.'));
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

// au-delà de cette profondeur, clone et comparaison s'arrêtent à la référence : une chaîne très longue ne fait pas
// déborder la pile
var MJS_INSPECT_PROFONDEUR = 64;

// égalité PAR VALEUR (jamais par référence) pour le filtre µinspect($x.chemin) — un
// remplacement de $x entier ne compte comme changement QUE si la valeur au chemin diffère
// réellement, pas juste parce que le conteneur a une nouvelle identité. Valeur qui se référence (arbre avec
// `parent`) : une paire déjà en cours de comparaison est tenue pour égale tant que le reste l'est
function mjsInspectEgal(a, b, vus, prof) {
  var ka, kb, i, deja;
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  prof = prof || 0;
  if (prof > MJS_INSPECT_PROFONDEUR) return false;
  vus  = vus || new WeakMap();
  deja = vus.get(a);
  if (deja && deja.has(b)) return true;
  if (!deja) { deja = new WeakSet(); vus.set(a, deja); }
  deja.add(b);
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) { if (!mjsInspectEgal(a[i], b[i], vus, prof + 1)) return false; }
    return true;
  }
  ka = Object.keys(a);
  kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (i = 0; i < ka.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
    if (!mjsInspectEgal(a[ka[i]], b[ka[i]], vus, prof + 1)) return false;
  }
  return true;
}

// clone profond pour la MÉMOIRE d'un chemin — jamais le snapshot `oldValue` reçu par
// `_mjs_notifyMutation`, superficiel PAR DESIGN (cf. µ._mjs_snap, mjs_init.ts : clone le
// TOP-LEVEL seulement) : une mutation en place 2 niveaux ou plus sous la racine PARTAGE sa
// référence avec ce snapshot, qui se retrouve à refléter la valeur APRÈS plutôt qu'avant — la
// comparaison tomberait alors TOUJOURS égale, aucun changement jamais détecté. Copie maison,
// ISOLÉE, mémorisée PAR CHEMIN (`_mjs_inspectPathsPrev`) plutôt que pour toute la racine : coût
// proportionné aux seuls chemins réellement inspectés, jamais à tout `$x`. Valeur qui se référence : la copie se
// référence de même, au lieu de descendre sans fin.
function mjsInspectClone(v, vus, prof) {
  var out, k, i;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  prof = prof || 0;
  if (prof > MJS_INSPECT_PROFONDEUR) return v;
  vus = vus || new WeakMap();
  if (vus.has(v)) return vus.get(v);
  out = Array.isArray(v) ? [] : {};
  vus.set(v, out);
  if (Array.isArray(v)) {
    for (i = 0; i < v.length; i++) out.push(mjsInspectClone(v[i], vus, prof + 1));
    return out;
  }
  for (k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = mjsInspectClone(v[k], vus, prof + 1); }
  return out;
}

// affichage console d'une mutation inspectée — appelé par le cœur (`_mjs_notifyMutation`,
// mjs_element.ts) pour toute clé présente dans `_mjs_inspections`, que seul `µ.inspect` pose : le
// cœur n'en garde qu'un appel. `µinspect($x.chemin)` : la clé ENTIÈRE reste abonnée — seul
// l'AFFICHAGE se resserre à ses chemins, sauf si un `µinspect($x)` SANS chemin l'a emporté pour
// cette même clé (`_mjs_inspectAll`). Sans chemin : comportement historique, `$x` entier.
// `console.log` (pas `µ.log`) : explicitement demandé par l'utilisateur, affiché peu importe
// `µ.debug`. `µ._mjs_snap` déproxifie : un objet nu lisible, jamais un `Proxy { … }` opaque.
// L'outil de débogage ne casse jamais l'appli : une valeur qui lève à la lecture (getter, Proxy) est dite en console
// et la mutation suit son cours (le cœur appelle sans protection, cf. mjs_element.ts).
µ._mjs_inspectAffiche = function(el, k, oldValue) {
  try { mjsInspectAfficher(el, k, oldValue); }
  catch (e) { console.warn(`🔍 [MJS Inspect] ${k}`, e); }
};

function mjsInspectAfficher(el, k, oldValue) {
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
}
