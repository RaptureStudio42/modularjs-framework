// mjs_fx_shared — `*shared(clé)` : l'élément partagé d'une transition de page. Deux balises qui portent
// la même clé de part et d'autre d'une navigation (la vignette d'un produit dans la liste, sa photo dans
// la page du produit) reçoivent le même nom de transition (`view-transition-name`, posé en style sur la
// balise : la couche de lévitation du routeur la trouve même dans un shadow root, cf. mjs_vt_presets.ts)
// — le navigateur fait glisser et grandir l'une jusqu'à la place de l'autre. Réglages : key (un nombre
// ou un mot, fixe ou variable : `*shared(p.id)`), group (deux éléments de la même fiche : la photo, le
// titre — `*shared(p.id, group: titre)`). Le nom : `mjs-<group|shared>-<clé>`, un caractère hors de
// [A-Za-z0-9-] écrit `_` et son code (un nom CSS toujours valide, jamais deux clés sur le même nom).

µ._mjs_fxSharedName = function(key, group) {
  var clean = function(v) { return String(v).replace(/[^A-Za-z0-9-]/g, function(c) { return '_' + c.charCodeAt(0).toString(16); }); };
  return 'mjs-' + (group ? clean(group) : 'shared') + '-' + clean(key);
};

µ._mjs_fxDefs.shared = {
  setup: function(el, s) {
    if (s.key === void 0 || s.key === null || s.key === '') return null;
    var name = µ._mjs_fxSharedName(s.key, s.group);
    el.style.setProperty('view-transition-name', name);
    return function() {
      if (el.style.getPropertyValue('view-transition-name') === name) el.style.removeProperty('view-transition-name');
    };
  }
};
