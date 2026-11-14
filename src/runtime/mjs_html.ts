// mjs_html — interpolation brute `{{expr}}` : `_mjs_updHtml(id, val)` remplace le contenu du nœud
// porteur par le HTML de la valeur. Patch de `µ.Element.prototype._mjs_updHtml`, DÉTACHÉ de
// mjs_element.ts (même technique que mjs_on.ts : ajouté APRÈS la classe, DOIT rester après
// mjs_element.ts dans la concaténation). DÉTECTÉ sur le code compilé (bundler/features.ts, clé
// `html`) : le générateur émet l'appel littéral `this._mjs_updHtml('tN', …)` pour chaque `{{…}}` du
// composant hors {for}/{await} — racine, {if}/{else}, {key}, contenu de <@slot>, contenu passé à
// un enfant, partiel <@include>. Dans un {for}, une branche ou une liaison `@html`, la ligne émise
// appelle `µ._mjs_rawHtml` (ci-dessous). Un composant qui n'émet ni l'un ni l'autre appel n'a donc
// jamais besoin de ce fichier, il peut manquer sans risque.
// HTML d'auteur (`{{…}}`, `@html`) : écrit tel quel, JAMAIS par la politique Trusted Types `mjs` du cœur (elle laisserait passer
// n'importe quelle donnée). Une page qui exige Trusted Types le fait passer par SA politique `default` ; sans elle, le navigateur
// refuse : le contenu reste vide, le reste du composant s'affiche, et le message dit quoi faire
µ._mjs_rawHtml = function(node, html) {
  try {
    node.innerHTML = html;
  }
  catch (e) {
    if (!(e instanceof TypeError) || !window.trustedTypes) throw e;
    node.textContent = '';
    µ.error(µ._mjs_msg('htmlTrusted', null, 'HTML brut ({{…}}, :html) refusé par la politique de sécurité de la page (Trusted Types) : le framework ne le fait jamais passer par sa politique « mjs ». Posez une politique qui l\'assainit, trustedTypes.createPolicy(\'default\', { createHTML: … }), avant le script de l\'appli, ou affichez la valeur en texte avec {…}.'), e);
  }
};

if (µ.Element) {
  // rejet d'une destruction lancée sans être attendue : même prise que mjs_if.ts (`_mjsIfDestroyErr`), une seule
  // fonction, posée seulement sur une promesse qui peut rejeter — jamais sur la promesse résolue partagée du chemin rapide
  var _mjsHtmlDestroyErr = function(err) {
    return µ.error(µ._mjs_msg('htmlDestroy', null, 'destruction de contenu {@html} en erreur :'), err);
  };

  µ.Element.prototype._mjs_updHtml = function(id, val) {
    // Skip String() si déjà string + skip Array.from alloc.
    // Snapshot childNodes via firstChild/nextSibling pour éviter live-list mutations
    // pendant l'iteration.
    const node = this._mjs_nodes[id];
    if (!node) return;
    // null et undefined n'affichent rien, comme `{…}`
    const strVal = typeof val === 'string' ? val : val == null ? '' : String(val);
    if (node._mjs_h === strVal) return;
    // Snapshot children avant destroy (destroy mute la live list).
    let __c = node.firstChild;
    const __children = [];
    while (__c) { __children.push(__c); __c = __c.nextSibling; }
    for (let __ci = 0, __cln = __children.length; __ci < __cln; __ci++) {
      // jamais attendue ici : un rejet resterait sinon non géré (cf. `_mjsHtmlDestroyErr`)
      const __d = this._mjs_destroyNodeAndChildren(__children[__ci]);
      if (__d !== MJS_RESOLVED_DESTROY) __d.catch(_mjsHtmlDestroyErr);
    }
    µ._mjs_rawHtml(node, strVal);
    node._mjs_h = strVal;
  };
}
