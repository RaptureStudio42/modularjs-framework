// mjs_element_at — l'élément le plus profond sous un point de la fenêtre (`µ.elementAt`, et `µ._mjs_elementAt`
// qui part d'une racine donnée), détaché de mjs_element.ts : fichier détecté (clé 'element_at'), embarqué
// seulement si le projet écrit `µ.elementAt(` ou se sert d'un des trois effets en direct qui l'appellent
// (*follow, *heatmap, *cursors : mjs_fx_follow.ts, mjs_fx_heatmap.ts, mjs_fx_cursors.ts). Un projet qui ne
// l'appelle que depuis un script de page (que la construction ne lit pas) le demande par
// `runtime: ['element_at']`.

// l'élément le plus profond sous un point de la fenêtre (`clientX`, `clientY`), jusque dans les composants :
// `elementFromPoint` s'arrête à la balise d'un composant, on redemande à son ombre (fermée : `_shadow`),
// d'ombre en ombre ; `null` hors de la fenêtre. `root` : d'où partir (les effets en direct, la racine de
// leur zone) ; µ.elementAt, la page. Une coordonnée qui n'est pas un nombre fini (NaN, Infinity, undefined,
// null, une chaîne : une mesure ratée, jamais convertie) ne désigne aucun point, pas plus qu'un nombre que le
// navigateur ne sait pas lire (Firefox refuse tout ce qui dépasse un flottant simple, comme 1e39) : il lève une
// TypeError, ici `null`
µ._mjs_elementAt = function(x, y, root) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  var e;
  try { e = root && root.elementFromPoint ? root.elementFromPoint(x, y) : null; }
  catch (err) { if (err && err.name === 'TypeError') return null; throw err; }
  for (var i = 0; e && i < 32; i++) {
    var sh = e._shadow || e.shadowRoot;
    var f  = sh && sh.elementFromPoint ? sh.elementFromPoint(x, y) : null;
    if (!f || f === e) break;
    e = f;
  }
  return e || null;
};
µ.elementAt = function(x, y) {
  return typeof document === 'undefined' ? null : µ._mjs_elementAt(x, y, document);
};
