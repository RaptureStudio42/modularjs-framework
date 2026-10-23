// mjs_form_reset — la remise à zéro d'un formulaire, écrite UNE seule fois pour les modules de saisie du cœur (case, interrupteur,
// radio, nombre, jauge, bouton rotatif, liste, champ, éditeur). Chacun recopiait le même bloc (prendre l'état de départ, écouter le
// `reset` du formulaire où il EST, le rendre une fois l'événement passé) : un formulaire à trois modules posait trois écouteurs. Fichier
// détecté (clé 'form_reset') : le module appelle `µ._mjs_formReset(` LITTÉRALEMENT, une application sans module de saisie n'en paie pas
// un octet, et le fichier part dès qu'un seul module est employé, quelle que soit la sélection `runtime` (il ne dépend pas de mjs_ujs.ts).
//
// Un formulaire reçoit UN écouteur du `reset`, posé à l'arrivée de son premier module et retiré au départ du dernier : le formulaire porte
// lui-même l'ensemble de ses modules. L'écoute se pose sur le formulaire, jamais sur `document` : l'événement `reset` remonte mais ne
// traverse pas une ombre, et un formulaire posé dans l'ombre d'un composant ne serait pas vu d'en haut. Chaque module est suivi à sa
// connexion (`_mjs_onAwake`, mjs_lifecycle.ts) : déplacé dans un autre formulaire il le rejoint, retiré de la page il quitte le sien.

// les modules de chaque formulaire, gardés hors de lui : lue sur un <form>, une propriété (même une donnée posée dessus) est d'abord
// cherchée parmi les champs du formulaire, liste que le navigateur refait après l'arrivée de chaque champ associé — une lecture par
// module montait mille cases en un temps qui croissait comme le carré de leur nombre
var _mjsResetSets = new WeakMap();

// l'écouteur du `reset`, le même pour tous les formulaires : un cran après l'événement — un écouteur de remontée posé après le nôtre
// (sur un ancêtre, sur `document`) peut l'annuler encore, `defaultPrevented` se lit donc une fois l'événement passé —, chaque module
// resté dans le formulaire reprend son état de départ ; un module parti entre-temps n'y est plus. Un `reset` lancé par un élément du
// formulaire remonte jusqu'ici sans être celui du formulaire : ignoré, comme le fait un champ natif
function _mjsResetOn(e) {
  if (e.target !== e.currentTarget) return;
  setTimeout(form => {
    if (!e.defaultPrevented) _mjsResetSets.get(form)?.forEach(m => m._mjs_reset?.());
  }, 0, e.target);
}

// `el` : le module (appelé à son montage) ; `start()` : lu UN cran après le montage — une prop posée par la page n'arrive qu'à la fin de
// son premier rendu — il garde l'état de départ et rend la fonction qui le remet au module, sans rien annoncer (aucun `change`, le
// formulaire dit lui-même son `reset`) ; `formOf()` : le formulaire à suivre quand ce n'est pas le plus proche ancêtre du module ; sans lui,
// un élément associé au formulaire qui porte `form="id"` suit le formulaire visé, celui que le navigateur lui donne (où qu'il soit)
µ._mjs_formReset = function(el, start, formOf) {
  var form, set;
  function follow() {
    var next = el.isConnected && (formOf ? formOf() : (el.hasAttribute('form') && 'internals' in el) ? el.form : el.closest('form'));
    if (next === form) return;
    if (form) {
      set.delete(el);
      if (!set.size) form.removeEventListener('reset', _mjsResetOn);
    }
    form = next;
    if (!form) return;
    set = _mjsResetSets.get(form);
    if (!set) _mjsResetSets.set(form, set = new Set());
    set.add(el);
    if (set.size === 1) form.addEventListener('reset', _mjsResetOn);
  }
  setTimeout(() => (el._mjs_reset = start()));
  follow();
  el._mjs_onAwake(follow);
  el._mjs_onSleep(follow);
};
