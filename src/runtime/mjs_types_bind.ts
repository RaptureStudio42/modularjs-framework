// mjs_types_bind — la liaison d'un champ à une variable de règle (bloc <vars>, mjs_types.ts) : la valeur qu'elle écrit, lue du choix
// d'une liste (µ._mjs_traw), et ce que le champ rend après un refus (µ._mjs_tback). Deux lecteurs, qui jugent ainsi un choix par les
// mêmes fonctions : le garde d'un champ natif (`*guard`, mjs_fx_guard.ts) et la liaison d'une liste du cœur à une variable de règle
// (mjs_types_select.ts). Joint au cœur avec la seconde, ou avec le garde quand l'appli a des types (un champ natif lié à une variable
// de règle le reçoit d'office ; sans règle, le garde ne l'appelle pas) : une appli qui a des types sans aucun champ lié à une variable
// de règle n'en paie pas un octet (bundler/index.ts)

// la valeur qu'écrit la liaison d'une liste liée à une variable de règle `r`, lue du texte `v` de son choix (une liste de textes à
// choix multiples) : l'option vide vaut null quand la règle refuse le texte vide mais accepte null (µ._mjs_tnul), aucun choix aussi
// sous une règle de liste qui accepte null (µ._mjs_tlist) — le garde d'une liste native (mjs_fx_guard.ts) et la liaison d'une liste
// du cœur (µ._mjs_tpick) la lisent ainsi
µ._mjs_traw = function(r, v) {
  return Array.isArray(v) ? (v.length === 0 && µ._mjs_tlist(r) > 1 ? null : v) : v === '' && µ._mjs_tnul(r) ? null : v;
};

// ce qu'un champ lié rend après un refus : la valeur acceptée en dernier `t`, telle qu'il la lisait (le texte `02`), tant qu'elle
// donne encore la valeur `v` de la variable de règle `r` (`n` : `t` comme la liaison l'écrit, un nombre pour un champ nombre), sinon
// `v` — le garde d'un champ natif (mjs_fx_guard.ts) et la liaison d'une liste du cœur (µ._mjs_tpick) rendent ainsi
µ._mjs_tback = function(r, t, v, n) {
  var x = t == null ? null : µ._mjs_tcheck(r, n);
  return x && x.s >= 0 && x.s < 2 && x.v === v ? t : v;
};
