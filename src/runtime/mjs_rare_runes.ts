// mjs_rare_runes — runes minuscules PEU utilisées (µraw, µsnap, µimport), regroupées dans un seul
// fichier détecté (clé 'rare_runes', cf. bundler/index.ts) : le bundle les embarque TOUTES dès
// qu'UNE SEULE est utilisée dans le projet. µinspect (mjs_inspect.ts) et µplay (mjs_play.ts), plus
// lourdes, ont chacune leur fichier et leur signal : écrire µraw ne les tire plus.
// µminmax n'existe plus : les types du bloc <vars> le remplacent (mjs_types.ts).

µ.raw = function(target) {
  if (target !== null && typeof target === 'object') {
    // Marqueur dans µ._mjs_rawSet (cf. mjs_init.ts) — pas de prop string sur
    // l'objet user (mangle-safe + sans pollution `for...in`/`Object.keys`).
    µ._mjs_rawSet.add(target);
  }
  return target;
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
  if (!url) throw new Error(µ._mjs_txt('importEmptyPath', null, 'µimport : chemin vide — asset non résolu au build'));
  return import(url);
};
