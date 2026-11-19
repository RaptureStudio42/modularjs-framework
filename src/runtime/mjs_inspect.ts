// mjs_inspect — rune µinspect (suivi d'une variable dans la console) et son affichage des changements
// (µ._mjs_inspectShow, appelé par mjs_element.ts seulement pour une clé suivie), détachées de
// mjs_rare_runes.ts : fichier détecté (clé 'inspect'), embarqué seulement si le projet écrit µinspect

// `chemin` (optionnel, cf. sigils.ts flatInspectPath) FILTRE juste l'affichage console —
// la clé entière reste TOUJOURS abonnée dans `_mjs_inspections` (`.has(clé)`, lu tel quel par
// mjs_element.ts/mjs_deep.ts pour décider si un snapshot vaut la peine d'être pris). Les chemins
// eux-mêmes sont rangés À PART, par clé, dans `_mjs_inspectPaths` :
// `µinspect($x.foo)` SUIT $x entier (comme `µinspect($x)`), juste une portée de sortie plus
// étroite. Un appel SANS chemin sur une clé déjà bornée à des chemins l'emporte TOUJOURS (affiche
// tout) — posé dans `_mjs_inspectAll`, jamais retiré : un `µinspect($x.foo)` qui arriverait
// APRÈS, sur la même clé, ne doit pas réduire à nouveau la portée.
µ.inspect = function(key, path) {
  var comp, paths;
  comp = µ.activeComponent;
  if (!comp) {
    return µ.warn(µ._mjs_msg('runesInspectInit', null, 'µ.inspect doit être appelé à l\'initialisation.'));
  }
  if (comp._mjs_inspections == null) {
    comp._mjs_inspections = new Set();
  }
  comp._mjs_inspections.add(key);
  if (!path) {
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
  paths = comp._mjs_inspectPaths.get(key);
  if (!paths) {
    paths = new Set();
    comp._mjs_inspectPaths.set(key, paths);
  }
  paths.add(path);
  return comp._mjs_inspections;
};

// résolution d'un chemin PLAT ('a.b.0', jamais un accès calculé — cf. sigils.ts
// flatInspectPath, seule source qui alimente ce chemin) dans une valeur : simple indexation
// chaînée, `undefined` dès que le conteneur intermédiaire manque.
function mjsInspectResolve(value, path) {
  var segs, cur, i;
  segs = path.split('.');
  cur  = value;
  for (i = 0; i < segs.length; i++) {
    if (cur == null) return void 0;
    cur = cur[segs[i]];
  }
  return cur;
}

// au-delà de cette profondeur, clone et comparaison s'arrêtent à la référence : une chaîne très longue ne fait pas
// déborder la pile
var MJS_INSPECT_DEPTH = 64;

// égalité PAR VALEUR (jamais par référence) pour le filtre µinspect($x.chemin) — un
// remplacement de $x entier ne compte comme changement QUE si la valeur au chemin diffère
// réellement, pas juste parce que le conteneur a une nouvelle identité. Valeur qui se référence (arbre avec
// `parent`) : une paire déjà en cours de comparaison est tenue pour égale tant que le reste l'est
function mjsInspectEqual(a, b, seen, depth) {
  var ka, kb, i, already;
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  depth = depth || 0;
  if (depth > MJS_INSPECT_DEPTH) return false;
  seen    = seen || new WeakMap();
  already = seen.get(a);
  if (already && already.has(b)) return true;
  if (!already) { already = new WeakSet(); seen.set(a, already); }
  already.add(b);
  // Map et Set : leurs entrées, dans l'ordre (leurs clés propres sont vides, un changement n'y serait jamais vu)
  if (a instanceof Map || a instanceof Set || b instanceof Map || b instanceof Set) {
    a = µ._mjs_toRaw(a);
    b = µ._mjs_toRaw(b);
    if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b) || a.size !== b.size) return false;
    ka = Array.from(a);
    kb = Array.from(b);
    for (i = 0; i < ka.length; i++) { if (!mjsInspectEqual(ka[i], kb[i], seen, depth + 1)) return false; }
    return true;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) { if (!mjsInspectEqual(a[i], b[i], seen, depth + 1)) return false; }
    return true;
  }
  ka = Object.keys(a);
  kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (i = 0; i < ka.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
    if (!mjsInspectEqual(a[ka[i]], b[ka[i]], seen, depth + 1)) return false;
  }
  return true;
}

// copie PROFONDE, isolée de l'état réel et déballée de ses enveloppes (`µ._mjs_toRaw`) : valeur d'avant d'une écriture
// (`µ._mjs_snap` ci-dessous), mémoire d'un chemin (`_mjs_inspectPathsPrev`), affichage. Valeur qui se référence : la copie se
// référence de même, au lieu de descendre sans fin. `vus` reçu déjà garni (cf. mjsInspectBefore) : un objet qui y est prend la
// copie qu'on y a mise
function mjsInspectClone(v, seen, depth) {
  var out, k, i;
  if (v === null || typeof v !== 'object') return v;
  v    = µ._mjs_toRaw(v);
  depth = depth || 0;
  if (depth > MJS_INSPECT_DEPTH) return v;
  seen = seen || new WeakMap();
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof Map || v instanceof Set) {
    out = v instanceof Map ? new Map() : new Set();
    seen.set(v, out);
    v.forEach(function(x, key) {
      if (out instanceof Map) out.set(key, mjsInspectClone(x, seen, depth + 1));
      else out.add(mjsInspectClone(x, seen, depth + 1));
    });
    return out;
  }
  // objet à état interne (erreur, élément de la page, RegExp, tableau typé, Promise…) : montré tel quel, une copie de ses seuls champs le
  // rendrait vide ; l'erreur d'un accesseur qui lève (cf. mjsInspectLire) s'y lit avec son message
  if (!Array.isArray(v) && Object.prototype.toString.call(v) !== '[object Object]') return v;
  out = Array.isArray(v) ? [] : {};
  seen.set(v, out);
  if (Array.isArray(v)) {
    for (i = 0; i < v.length; i++) out.push(mjsInspectRead(v, i, seen, depth));
    return out;
  }
  for (k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = mjsInspectRead(v, k, seen, depth); }
  return out;
}

// une propriété qui lève à la lecture (accesseur, enveloppe révoquée) : son erreur prend sa place dans la copie, le reste est copié
function mjsInspectRead(v, k, seen, depth) {
  try { return mjsInspectClone(v[k], seen, depth + 1); }
  catch (e) { return e; }
}

// valeur d'avant d'une écriture : le cœur (mjs_element.ts, mjs_deep.ts) appelle `µ._mjs_snap` juste AVANT d'écrire, et seulement
// pour une variable que µinspect suit. Sa copie superficielle (mjs_init.ts) partage avec l'état réel tout objet à deux niveaux ou
// plus sous la racine, que l'écriture change en place : « From » montrait déjà la valeur d'après. Ici une copie profonde, retenue
// avec l'objet copié (cf. mjsInspectBefore) ; une valeur qui lève à la lecture est dite en console, l'écriture suit son cours
var mjsInspectSources = new WeakMap();
µ._mjs_snap = function(v) {
  var c;
  try { c = mjsInspectClone(v); }
  catch (e) {
    console.warn('🔍 [MJS Inspect]', e);
    return void 0;
  }
  if (c !== null && typeof c === 'object') mjsInspectSources.set(c, µ._mjs_toRaw(v));
  return c;
};

// valeur d'avant de la variable `k` ENTIÈRE : la copie reçue est celle de sa racine (écriture compilée `$o.a.b = v`, méthode
// `$o.a.l.push(x)`), ou celle du seul objet écrit quand l'écriture passe par un nom (`t = $o.a ; t.b = 2`, pièges de l'enveloppe,
// mjs_element.ts) : la racine d'avant est alors celle d'aujourd'hui, où cet objet reprend sa copie d'avant l'écriture
function mjsInspectBefore(el, k, oldValue) {
  var src = mjsInspectSources.get(oldValue), root;
  if (src === void 0 || src === (root = µ._mjs_toRaw(el._state[k]))) return oldValue;
  return mjsInspectClone(root, new WeakMap([[src, oldValue]]));
}

// affichage console d'une mutation inspectée — appelé par le cœur (`_mjs_notifyMutation`,
// mjs_element.ts) pour toute clé présente dans `_mjs_inspections`, que seul `µ.inspect` pose : le
// cœur n'en garde qu'un appel. `µinspect($x.chemin)` : la clé ENTIÈRE reste abonnée — seul
// l'AFFICHAGE se resserre à ses chemins, sauf si un `µinspect($x)` SANS chemin l'a emporté pour
// cette même clé (`_mjs_inspectAll`). Sans chemin : comportement historique, `$x` entier.
// `console.log` (pas `µ.log`) : explicitement demandé par l'utilisateur, affiché peu importe
// `µ.debug`. Valeurs copiées en profondeur (mjsInspectClone) : un objet nu lisible, jamais un `Proxy { … }` opaque, gardé tel
// qu'au moment du changement.
// L'outil de débogage ne casse jamais l'appli : une valeur qui lève à la lecture (getter, Proxy) est dite en console
// et la mutation suit son cours (le cœur appelle sans protection, cf. mjs_element.ts).
µ._mjs_inspectShow = function(el, k, oldValue) {
  try { mjsInspectShow(el, k, oldValue); }
  catch (e) { console.warn(`🔍 [MJS Inspect] ${k}`, e); }
};

function mjsInspectShow(el, k, oldValue) {
  var all, paths, prev, from, to;
  all      = el._mjs_inspectAll;
  paths    = (!all || !all.has(k)) && el._mjs_inspectPaths && el._mjs_inspectPaths.get(k);
  oldValue = mjsInspectBefore(el, k, oldValue);
  if (!paths || paths.size === 0) {
    // copies faites AVANT d'ouvrir le groupe : une valeur qui lève ne laisse jamais un groupe ouvert dans la console
    from = oldValue !== void 0 ? mjsInspectClone(oldValue) : void 0;
    to   = mjsInspectClone(el._state[k]);
    console.group(`🔍 [MJS Inspect] ${k}`);
    if (oldValue !== void 0) {
      console.log("%cFrom :", "color: #888", from);
    }
    console.log("%cTo   :", "color: #2ecc71; font-weight: bold", to);
    console.groupEnd();
    return;
  }
  if (el._mjs_inspectPathsPrev == null) el._mjs_inspectPathsPrev = new Map();
  prev = el._mjs_inspectPathsPrev.get(k);
  if (!prev) {
    prev = new Map();
    el._mjs_inspectPathsPrev.set(k, prev);
  }
  paths.forEach(function(path) {
    var after, before;
    after  = mjsInspectResolve(el._state[k], path);
    // la mémoire du chemin ; à sa première écriture, sa valeur dans la copie d'avant de la variable (profonde, prise avant
    // l'écriture)
    before = prev.has(path) ? prev.get(path) : mjsInspectResolve(oldValue, path);
    if (!mjsInspectEqual(before, after)) {
      from = before !== void 0 ? mjsInspectClone(before) : void 0;
      to   = mjsInspectClone(after);
      console.group(`🔍 [MJS Inspect] ${k}.${path}`);
      if (before !== void 0) {
        console.log("%cFrom :", "color: #888", from);
      }
      console.log("%cTo   :", "color: #2ecc71; font-weight: bold", to);
      console.groupEnd();
    }
    prev.set(path, mjsInspectClone(after));
  });
}
