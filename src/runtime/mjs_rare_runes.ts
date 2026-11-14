// mjs_rare_runes — runes minuscules PEU utilisées (µraw, µsnap, µimport), regroupées dans un seul
// fichier détecté (clé 'rare_runes', cf. bundler/index.ts) : le bundle les embarque TOUTES dès
// qu'UNE SEULE est utilisée dans le projet. µinspect (mjs_inspect.ts) et µplay (mjs_play.ts), plus
// lourdes, ont chacune leur fichier et leur signal : écrire µraw ne les tire plus.
// µminmax n'existe plus : les types du bloc <vars> le remplacent (mjs_types.ts).

// <sans-lignes-brutes>
// µ.raw = function(target) {
// </sans-lignes-brutes>
// <lignes-brutes>
// `µraw(liste, true)` : la liste est marquée, et notée « toutes ses lignes sont brutes » (µ._mjs_rawRows, mjs_init.ts) sans qu'aucune ligne soit
// marquée ni lue. `true` seul compte : l'indice que `map` donne en second argument (`listes.map(µraw)`) ne note rien
µ.raw = function(target, rows) {
// </lignes-brutes>
  if (target !== null && typeof target === 'object') {
    // <faibles>
    // enveloppe d'une `WeakMap`, d'un `WeakSet` de l'état (`µraw($vus)`, `µraw(st.vus)`) : la vraie collection, qu'exigent ses méthodes
    // natives (`WeakMap.prototype.get.call(µraw($vus), k)`, une bibliothèque), rendue sans être marquée — `$vus` garde son enveloppe,
    // et ses écritures redessinent. Lue dans le carnet de ces enveloppes (µ._mjs_weakRaw, mjs_init.ts) : rien n'est lu sur l'objet
    // reçu, un Proxy de la page qui refuse une lecture se range comme tout objet. Bloc gardé pour l'appli qui nomme `WeakMap` ou
    // `WeakSet` : sans lui, la fonction est celle d'avant, à l'octet. La collection rendue s'y note à son tour : `µraw(µraw($vus))` la
    // rend telle quelle, sans la marquer
    const r = µ._mjs_weakRaw.get(target);
    if (r !== void 0) {
      µ._mjs_weakRaw.set(r, r);
      return r;
    }
    // </faibles>
    // <lignes-brutes>
    if (rows === true) µ._mjs_rawRows.add(target);
    // </lignes-brutes>
    // Marqueur dans µ._mjs_rawSet (cf. mjs_init.ts) — pas de prop string sur
    // l'objet user (mangle-safe + sans pollution `for...in`/`Object.keys`).
    µ._mjs_rawSet.add(target);
    // <precision>
    // <derivees>
    // objet devenu brut : une valeur précise d'un composant qui le tient doute (mjs_element.ts)
    µ._mjs_mefiance?.(target);
    // </derivees>
    // </precision>
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
