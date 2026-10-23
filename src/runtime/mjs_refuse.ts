// mjs_refuse — champ nombre lié dont la saisie est refusée, détaché de mjs_init.ts : fichier détecté
// (clé 'refuse'), embarqué seulement si un gabarit écrit un champ `value=!{$x}` dont le type peut être
// `number` (le gestionnaire de saisie émis par le compilateur appelle alors µ._mjs_refuse)

// Champ nombre lié (`<input type="number" value=!{$n}>`) dont la saisie est refusée par le navigateur
// (`validity.badInput` : `value` vaut '', la variable garde son ancienne valeur, le champ affiche pourtant
// la saisie) : le gestionnaire de saisie le retient ici, par nom de variable. Une écriture du code qui
// ne change rien (`$n = 3` quand `$n` vaut déjà 3) ne déclenche aucun effet ; `_set` rappelle alors
// `_mjs_refuseRetablir`, qui remplace la saisie refusée par la valeur de la variable — sauf si la
// personne tape dans ce champ (il a le focus, lu sur sa racine : shadow DOM), sa frappe reste.
µ._mjs_refuse = function(c, k, el) {
  var m = c._mjs_refuses || (c._mjs_refuses = new Map());
  var l = m.get(k);
  if (!l) m.set(k, l = []);
  if (l.indexOf(el) < 0) l.push(el);
};

µ._mjs_refuseRetablir = function(c, k, v) {
  var l = c._mjs_refuses.get(k);
  if (!l) return;
  for (var i = l.length - 1; i >= 0; i--) {
    var el = l[i];
    if (!el.isConnected || !el.validity || !el.validity.badInput) { l.splice(i, 1); continue; }
    if (el.getRootNode().activeElement === el) continue;
    el.value = v == null ? '' : v;
    l.splice(i, 1);
  }
};
