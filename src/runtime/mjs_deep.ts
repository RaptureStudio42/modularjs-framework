// mjs_deep — mutations PROFONDES d'un état : `µ._mjs_deepSet` (`$o.x = v`), `µ._mjs_deepCall`
// (`$liste.push(v)`), `µ._mjs_deepDelete` (`delete $o.x`) et `µ._mjs_makeDeepProxy` (enveloppe rendue
// au point de FUITE d'un chemin, et rune `µproxy`). DÉTACHÉES de mjs_init.ts : le suiveur de
// chemins (generator/path-tracker.ts) et le transpileur émettent ces quatre appels LITTÉRALEMENT,
// et eux seuls les appellent — un projet qui ne mute jamais en profondeur ne les a jamais
// appelées (bundler/features.ts, clé `deep`).
//
// Une clé qui vaut `__proto__`, `constructor` ou `prototype` est refusée, à n'importe quel rang du chemin, et rien ne
// s'écrit dans un prototype ni dans une fonction du navigateur (cf. _mjsDeepRefus). Les briques qu'elles partagent avec le reste du cœur — `µ._mjs_toRaw`, `µ._mjs_rawSet`,
// `µ._mjs_snap`, `el._set`/`el._mjs_notifyMutation`, `el._mjs_wrapDeep` — restent où elles sont : le filet
// `_mjs_wrapDeep` (mjs_element.ts) couvre les mutations qui échappent au suivi statique, avec ou sans
// ce fichier.

// nom réservé (CWE-1321) : une clé qui vaut `__proto__`, `constructor` ou `prototype`, à n'importe quel rang du chemin
// (variable comprise), ou le nom de la méthode appelée, est refusée — rien n'est écrit, un avertissement nomme le segment.
// Une clé objet (`['__proto__']`, objet dont `toString` rend le nom) est convertie une fois, comme JavaScript la
// convertit, et rangée convertie dans le chemin : la comparaison, la règle des types, la navigation et l'écriture voient
// la même clé. Un indice ou un symbole n'est jamais un nom réservé. Le contrôle, payé par toute écriture profonde, vit
// dans deux petites fonctions communes aux aides (`_mjsDeepChemin`, `_mjsDeepInterdit`, plus bas) : seul le refus appelle
// celle-ci. L'objet atteint au bout du chemin passe le même refus : rangé dans l'état par une lecture
// (`$loc.p = $$o[k]`), il est là où JavaScript mène — un prototype (`Object.prototype`, où mène `__proto__` : l'objet que range
// son propre constructeur) ou une fonction du navigateur (`Object`, où mène `constructor`, cf. _mjsNatif, mjs_init.ts) ne reçoit
// rien ; l'avertissement d'un prototype nomme le segment qui y mène, celui d'une fonction du navigateur explique le piège
// (cf. _mjsDeepNavAvis). Une fonction de l'appli reçoit l'écriture (`$format.appels = 0`) ; un objet absent garde l'erreur
// de JavaScript
function _mjsDeepRefus(k) {
  µ.warn(µ._mjs_msg('initPath', { seg: k }, 'chemin d\'état refusé (segment « {seg} ») — mutation ignorée.'));
}

// tête de chaque aide : clé objet convertie une fois et rangée convertie, nom réservé refusé ; rend `false` au refus.
// Hors des aides, comme `_mjsDeepInterdit` : V8 ne fond une aide dans la boucle qui l'appelle (ni appel, ni tableau du
// chemin fabriqué à chaque tour) qu'au-dessous de 460 octets de bytecode, et `µ._mjs_deepSet` les dépassait avec ses
// gardes en ligne (1 000 000 d'écritures `$o.a.b.c = i` : 25 % plus lentes)
function _mjsDeepChemin(path) {
  var i, k;
  for (i = 0; i < path.length; i++) {
    k = path[i];
    if (typeof k === 'object' || typeof k === 'function') path[i] = k = String(k);
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') { _mjsDeepRefus(k); return false; }
  }
  return true;
}

// objet atteint au bout du chemin, écrit ou modifié : ni un prototype ni une fonction du navigateur ; rend `true` au refus. Le
// prototype d'abord : `Function.prototype` est aussi une fonction du navigateur. Une fonction du navigateur se refuse sans
// avertissement ici : l'aide qui appelle le donne, en développement, avec le chemin qu'elle seule connaît (cf. _mjsDeepNavAvis)
function _mjsDeepInterdit(o) {
  var c;
  if (o != null && (c = o.constructor) && c.prototype === o) { _mjsDeepRefus('__proto__'); return true; }
  return typeof o === 'function' && _mjsNatif(o);
}

// avertissement d'une écriture refusée dans une fonction du navigateur, appelé par les aides en développement seulement (bloc
// retiré de la production, chemin compris) : rien pour un prototype, déjà nommé par _mjsDeepInterdit. `m` : la méthode appelée,
// rien quand le dernier segment du chemin est la clé écrite ou supprimée
function _mjsDeepNavAvis(o, path, m) {
  if (typeof o === 'function') µ.warn(µ._mjs_msg('initFn', _mjsDeepNavVars(o, path, m), '{path} : {fn} contient la fonction {name} du navigateur, sans doute amenée par une clé venue de l\'extérieur (adresse, formulaire, données reçues) ; rien n\'est écrit. Vérifiez cette clé.'));
}

// le chemin écrit (`$serie.values`, un indice entre crochets, la méthode appelée suivie de `(…)`, un symbole par son texte :
// `Symbol(s)`), la variable qui tient la fonction (`$serie`) et son nom (`Object`)
function _mjsDeepNavVars(o, path, m) {
  var ecrit = (s) => ('$' + s.map(String).join('.')).replace(/\.(\d+)(?=\.|$)/g, '[$1]');
  return { path: ecrit(path) + (m === void 0 ? '' : '.' + String(m) + '(…)'), fn: ecrit(m === void 0 ? path.slice(0, -1) : path), name: o.name };
}

// époques d'une écriture profonde faite (cf. `_set`, mjs_element.ts) : celle de la racine, que compare une liaison à deux sens, si
// elle est marquée partagée — tenue par deux composants (`µ._mjs_partages`, cf. _mjsTenu) ; celle de l'objet écrit, sous la racine, dès qu'un composant le
// tient (`µ._mjs_tenus`) — l'enfant à qui le parent repose le même objet (`item={r}` d'une ligne, `item={$o.p}`) y voit une
// mutation, pas un écho, comme après une écriture par l'enveloppe (_mjsMutated, mjs_element.ts). L'objet écrit avance sans
// `µ._mjs_bumpEpoch` : l'écriture est déjà comptée une fois pour les lignes propres, par la racine, ici même ou par _mjsFineCompte. Appelée
// seulement quand il peut y avoir une époque à faire avancer, garde en ligne chez l'appelant (`µ._mjs_partage || o !== root &&
// o !== µ._mjs_nonTenu && _mjsDeepTenu(o)`, cf. _mjsDeepTenu) : une appli sans objet partagé ni objet tenu sous la racine ne paie ni l'appel
// ni une seconde recherche, et la boucle qui écrit garde `µ._mjs_deepSet` fondue (cf. _mjsDeepChemin). Dès qu'un objet de la page a été marqué (`µ._mjs_partage`), la
// garde passe toujours : la racine est cherchée dans le carnet des objets marqués — la seule lecture de plus par écriture —, et l'objet
// écrit parmi les objets tenus, comme la garde le fait avant ; les autres objets de la page n'avancent pas. Racine non marquée :
// l'écriture est comptée ici pour les lignes propres, comme `µ._mjs_bumpEpoch` le fait pour la racine marquée (cf. _mjsFineCompte)
// objet écrit sous la racine : un composant le tient-il (`µ._mjs_tenus`) ? La réponse « tenu par personne » se retient pour le dernier
// objet cherché (`µ._mjs_nonTenu`, comparé en ligne par l'appelant, qui n'appelle cette fonction que pour un autre objet) : une boucle qui
// écrit le même objet le cherche une fois par tour, pas à chaque écriture (une recherche par écriture, que la 3.1 ne faisait pas). Seule
// une réponse négative se retient, et elle ne vaut que tant que l'objet n'est pas tenu : _mjsTenu (mjs_element.ts), seul à remplir la
// table, l'oublie quand il y range l'objet retenu ; oubliée aussi à la fin du tour, avec la racine (cf. _mjsRacOubli)
µ._mjs_nonTenu = void 0;
function _mjsDeepTenu(o) {
  if (µ._mjs_tenus.has(o)) return true;
  µ._mjs_nonTenu = o;
  return false;
}
function _mjsDeepEpoque(el, topKey, root, o) {
  var t;
  if (µ._mjs_partage) {
    // racine marquée, ou rangée d'abord par un AUTRE composant que l'écrivain, qui l'atteint sans l'avoir rangée lui-même (valeur dérivée
    // `$sel = $rows.find(…)`, puis `$sel.label = v`) : elle avance, celui qui la tient y voit une mutation quand elle lui est redonnée
    if (µ._mjs_partages.has(root) || (t = µ._mjs_tenus.get(root)) !== void 0 && t !== el._mjs_wr) (el._mjs_bindEpochs || (el._mjs_bindEpochs = {}))[topKey] = µ._mjs_bumpEpoch(root);
    // <fin>
    else µ._mjs_extW++;
    // </fin>
    if (o === root || !µ._mjs_tenus.has(o)) return;
  }
  _mjsDeepEpoqueObjet(el, topKey, o);
}
// l'objet écrit avance. Les autres variables de l'écrivain qui le tiennent elles-mêmes (`$sel = $rows[0]`, prop `first={$rows[0]}`) sont
// prévenues par cette écriture (`_mjs_notifyMutationAliased`, toutes les clés qui atteignent l'objet) : leur époque suit, et l'objet que
// le parent leur repose tel quel, ou que le code leur réécrit, reste un écho — l'écrivain ne repasse pas une seconde fois
function _mjsDeepEpoqueObjet(el, k, o) {
  var e  = (µ._mjs_epochs.get(o) || 0) + 1, c;
  var rs = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(o);
  µ._mjs_epochs.set(o, e);
  // les clés de sa fiche (cf. `_mjs_wrapDeep`, mjs_element.ts) : une seule (`r`) dans le cas courant, sans rien parcourir
  if (rs === void 0) return;
  if (rs.s === void 0) _mjsDeepEpoqueCle(el, rs.r, k, o, e);
  else for (c of rs.s) _mjsDeepEpoqueCle(el, c, k, o, e);
}
function _mjsDeepEpoqueCle(el, c, k, o, e) {
  if (c !== k && µ._mjs_toRaw(el._state[c]) === o) (el._mjs_bindEpochs || (el._mjs_bindEpochs = {}))[c] = e;
}
// <milieu>
// objets du MILIEU d'un chemin écrit, entre la racine et l'objet écrit ou modifié (rang `n` dans le chemin, exclu) : un enfant à qui le
// parent passe l'un d'eux (`item={$o.a.b}`, puis `$o.a.b.c.d = v` chez le parent) le reçoit de nouveau tel quel, et n'y verrait qu'un
// écho si son époque n'avançait pas. Chacun avance quand un composant le tient (`µ._mjs_tenus`, tenue à jour par toute affectation : un
// objet marqué partagé y est aussi), les autres jamais. Sans `µ._mjs_bumpEpoch`, comme l'objet
// écrit (cf. _mjsDeepEpoque). Appelée seulement quand un composant peut tenir un objet lu dans l'état (`µ._mjs_milieu`, mjs_element.ts),
// pour un chemin qui a un objet du milieu : une appli dont aucun composant ne tient d'objet de l'état n'en paie rien. Le chemin est
// renavigué depuis la racine : l'aide qui écrit n'en garde rien (cf. _mjsDeepChemin, budget de V8)
function _mjsDeepMilieu(root, path, n) {
  var x = root, i;
  for (i = 1; i < n; i++) {
    x = x[path[i]];
    if (µ._mjs_tenus.has(x)) µ._mjs_epochs.set(x, (µ._mjs_epochs.get(x) || 0) + 1);
  }
}
// l'objet `x` qu'une écriture compilée vient de retirer du conteneur `c` (valeur remplacée ou supprimée, élément sorti d'une liste ou
// d'une collection) : son lien vers ce conteneur devient douteux (cf. µ._mjs_sorti, mjs_element.ts) — une recherche de fiche, rien n'est
// parcouru. Appelée seulement quand un composant peut tenir un objet lu dans l'état (µ._mjs_milieu)
function _mjsDeepSorti(el, c, x) {
  // <enveloppe>
  var m = el._mjs_rootsByTarget, f = x != null && typeof x === 'object' && m !== void 0 ? m.get(c) : void 0;
  if (f !== void 0 && f.v != null) µ._mjs_sorti(m, f.v, c, x);
  // </enveloppe>
}
// <enveloppe>
// ce qu'une méthode compilée vient de sortir de la liste ou de la collection `o` : les éléments que rendent `splice`, `pop` et `shift` ;
// la valeur d'une `Map` remplacée par `set` ou retirée par `delete` (`sv`, lue avant l'appel), la clé d'une `Map` ou l'élément d'un `Set`
// retirés (`k`). Les méthodes qui ne rendent pas ce qu'elles retirent (`fill`, `copyWithin`, `clear`) ne marquent rien
function _mjsDeepSortis(el, o, m, r, sv, k) {
  var i;
  if (!Array.isArray(o)) {
    _mjsDeepSorti(el, o, sv);
    if (m === 'delete') _mjsDeepSorti(el, o, k);
  }
  else if (m === 'pop' || m === 'shift') _mjsDeepSorti(el, o, r);
  else if (m === 'splice' && Array.isArray(r)) for (i = 0; i < r.length; i++) _mjsDeepSorti(el, o, r[i]);
}
// </enveloppe>
// </milieu>

// racine d'une écriture profonde : l'objet brut que tient l'enveloppe rangée dans l'état (`µ._mjs_toRaw`, qui passe par le
// piège de l'enveloppe). Une enveloppe garde la même cible toute sa vie : la dernière déballée se retient le temps du tour,
// oubliée à la microtâche suivante (rien n'est retenu au-delà) — une boucle d'écritures ne repasse pas par le piège à chaque
// écriture. La première du tour passe par `_mjsRacNeuve`, hors de l'aide : fondue dans la boucle qui écrit, elle n'y pèse que sa
// voie rapide (cf. _mjsDeepChemin, budget de V8)
let _mjsRacEnv, _mjsRacBrut, _mjsRacTour = 0;
function _mjsRacOubli() {
  _mjsRacEnv  = _mjsRacBrut = µ._mjs_nonTenu = void 0;
  _mjsRacTour = 0;
}
function _mjsDeepRacine(o) {
  return _mjsRacTour && o === _mjsRacEnv ? _mjsRacBrut : _mjsRacNeuve(o);
}
function _mjsRacNeuve(o) {
  if (!_mjsRacTour) {
    _mjsRacTour = 1;
    queueMicrotask(_mjsRacOubli);
  }
  _mjsRacEnv = o;
  return _mjsRacBrut = µ._mjs_toRaw(o);
}

// <fin>
// mise à jour fine, champ par champ : `fv` est l'entrée de la variable écrite dans la table que le compilateur pose quand un de ses
// champs est écrit par un chemin compilé et que tous les lecteurs du gabarit lisent des champs nommés (`_mjs_fine`,
// transpiler/index.ts) — `f` : champ → liaisons du composant ; `r` : listes `{for}` de la variable, champ de l'élément → masque des
// liaisons de la ligne (-1 : le champ de la clé). Appelée après l'écriture, la garde d'égalité, la règle des types et l'époque de
// partage ; `o` : l'objet écrit, `root` : la racine brute. Seul le champ de la racine (`$o.f7`) ou d'une ligne (`$data[i].label`) est
// servi : un objet plus profond peut être tenu ailleurs dans la même variable (`$o.p = $o.a`), sous un autre champ. Rend vrai quand
// l'écriture est servie : seules les liaisons qui
// lisent le champ écrit repassent — la ligne qui montre l'objet, rappelée avec le masque du champ à la microtâche (l'heure des blocs) ;
// les liaisons d'un champ hors liste tout de suite, ou à la sortie d'une boucle qui écrit l'état (l'heure des textes) — et les valeurs
// dérivées comme le graphe des signaux avancent comme sur le chemin ordinaire. Rend faux, la variable entière est alors prévenue comme
// avant : chemin d'un seul nom ou plus profond, élément d'une liste remplacé ou retiré (structure), liste lue aussi hors de ses lignes,
// champ de la clé, liste pas encore rendue ou partie avec son bloc, ligne absente, hors du document, qui montre un autre objet ou dont
// l'objet revient plus loin dans une liste sans clé (`#1`, mjs_for.ts), objet tenu par une autre
// variable, parent lié, `µinspect`, reffet de la file des composants ou d'avant l'écran, rendu en attente ou en cours, composant non
// monté, tombé ou gelé par sa traduction, composant qui a un miroir (`µclone el, mirror: true`, mjs_clone.ts : chaque instance du groupe
// est prévenue par le chemin ordinaire), objet à accesseurs (cf. _mjsFineAcces). Un champ de la racine sans liaison à lui rejoue les
// liaisons qui lisent sous un champ (`d`, transpiler/index.ts) : l'objet atteint peut être la racine elle-même (`$o.self = $o`)
var _mjsFineOwn = Object.prototype.hasOwnProperty;
// objet dont un champ peut en lire ou en écrire un autre : instance d'une classe (ses accesseurs sont sur son prototype) ou objet qui a
// un accesseur à lui (`get total()`, `set x(v)`) — la variable entière est prévenue. Un objet ordinaire venu d'un autre domaine (cadre,
// fenêtre) a pour prototype l'`Object.prototype` de ce domaine : reconnu à son propre prototype, nul
function _mjsFineAcces(o) {
  var p = Object.getPrototypeOf(o), d, c;
  if (p !== null && Object.getPrototypeOf(p) !== null) return true;
  d = Object.getOwnPropertyDescriptors(o);
  for (c in d) if (d[c].get !== void 0 || d[c].set !== void 0) return true;
  return false;
}
function _mjsFineSet(el, fv, path, o, root, ins) {
  var k = path[0], r = fv.r, f = fv.f, roots, ens, fns, t, m, i, ord, en, n0, row, cle, cache;
  if (path.length !== (r === void 0 ? 2 : 3) || r === void 0 && f === void 0 || !el._mjs_is_mounted || el._mjs_has_crashed || el._mjs_i18n_hold || el._mjs_render_scheduled || el._mjs_inRenderStruct || µ._mjs_inEffect || el._mjs_before || el._mjs_pendingMount) return false;
  if (ins && ins.has(k) || el._mjs_binds && el._mjs_binds.has(k) || el._mjs_twins !== void 0 || el._mjs_effects && el._mjs_effects.length && el._mjs_varHasUserEffect(k)) return false;
  roots = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(o);
  if (roots && (roots.s !== void 0 || roots.r !== k) || _mjsFineAcces(o)) return false;
  if (r === void 0) {
    fns = _mjsFineOwn.call(f, path[1]) ? f[path[1]] : fv.d;
  }
  else {
    if (f !== void 0) return false;
    row = root[path[1]];
    for (i = 0; i < r.length; i++) {
      t = r[i];
      if (!_mjsFineOwn.call(t[1], path[2])) continue;
      m = t[1][path[2]];
      if (m === -1) return false;
      ord   = el._mjs_list_order && el._mjs_list_order[t[0]];
      cle   = ord && _mjsFineOwn.call(ord, path[1]) ? ord[path[1]] : void 0;
      cache = el._mjs_list_cache[t[0]];
      en    = cle !== void 0 ? cache.get(cle) : void 0;
      n0    = en && en.nodes[0];
      if (!en || !en._mjs_updFn || !n0 || !n0.isConnected || µ._mjs_toRaw(en._mjs_it) !== row || cache.has(cle + '#1') || typeof cle === 'string' && cle.indexOf('#') !== -1) return false;
      (ens || (ens = [])).push(en, m);
    }
  }
  // <developpement>
  // développement : un objet reçu par une prop que l'enfant modifie est dit comme sur le chemin ordinaire ; le champ écrit d'une ligne
  // est noté à sa nouvelle valeur pour la comparaison des lignes propres (mjs_debug.ts)
  if (µ._mjs_devModifie !== void 0) µ._mjs_devModifie(el, o, k);
  if (ens !== void 0 && µ._mjs_devFineVu !== void 0) µ._mjs_devFineVu(el, r, path, o);
  // </developpement>
  el._mjs_fineNote(k);
  // <familles>
  // écriture servie champ par champ, sans passer par _mjs_notifyMutationAliased : l'état dont la variable tient l'objet est prévenu ici (cf. _mjsFil, mjs_element.ts)
  if (µ._mjs_fil) µ._mjs_filEcrit(el, o, k);
  // </familles>
  if (ens !== void 0) {
    for (i = 0; i < ens.length; i += 2) _mjsFineRow(el, ens[i], ens[i + 1]);
  }
  else if (fns !== void 0) {
    // <boucles>
    if (µ._mjs_lq) {
      µ._mjs_lqFine(el, fns, k);
      return true;
    }
    // </boucles>
    µ._mjs_fineRun(el, fns);
  }
  return true;
}

// ligne en attente de la microtâche, l'heure à laquelle la passe de sa liste l'aurait mise à jour : une fois par ligne, masques cumulés
function _mjsFineRow(el, en, m) {
  var q = el._mjs_fq;
  if (!q) {
    q = el._mjs_fq = new Map();
    queueMicrotask(function() { _mjsFineRows(el); });
  }
  q.set(en, q.has(en) ? q.get(en) | m : m);
}
function _mjsFineRows(el) {
  var q = el._mjs_fq, avant = µ._mjs_inEffect;
  el._mjs_fq = null;
  if (el._mjs_has_crashed || !el._mjs_is_mounted) {
    _mjsFineSales(el);
    return;
  }
  µ._mjs_inEffect = true;
  try {
    q.forEach(function(m, en) {
      if (!el._mjs_has_crashed) en._mjs_updFn(en._mjs_it, en._mjs_ix, m);
    });
  } catch (e) {
    _mjsFineSales(el);
    el._mjs_catchError(e);
  } finally {
    µ._mjs_inEffect = avant;
  }
}
// lignes en attente qui ne passeront pas (composant retiré ou tombé avant la microtâche, ligne qui lève) : toutes les listes du
// composant sont salies (lignes propres, mjs_for.ts), leur prochaine passe — la remise du composant dans la page — relit chaque ligne
function _mjsFineSales(el) {
  var fi = el._mjs_fineIds, id;
  if (fi !== void 0) for (id in fi) fi[id] = 1;
}
// changement de structure compilé d'une variable qui a ses listes `{for}` dans la table (élément remplacé, méthode de la liste
// elle-même) : `o`, l'objet modifié, est la valeur de la variable, tenue par elle seule, et le composant n'a pas de miroir — vrai : la
// variable est prévenue avec `rw` à 0, ses listes restent propres (mjs_element.ts, mjs_for.ts). Sinon chemin ordinaire : une autre
// variable qui tient l'objet peut le montrer dans une ligne, un miroir a ses propres listes
function _mjsFineStruct(el, k, o) {
  var fine = el._mjs_fine, roots;
  if (fine === void 0 || !_mjsFineOwn.call(fine, k) || fine[k].r === void 0 || el._mjs_twins !== void 0) return false;
  roots = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(o);
  return roots === void 0 || roots.s === void 0 && roots.r === k;
}
// lignes propres (mjs_for.ts) : écriture profonde compilée de ce composant — l'objet écrit peut être montré par une liste propre d'un autre
// composant, qui relira toutes ses lignes ; les listes de ce composant restent propres, ses écritures y passent déjà (cf. µ._mjs_extW,
// mjs_init.ts : dès qu'un objet de la page est marqué partagé, _mjsDeepEpoque compte déjà l'écriture). Compteurs tenus seulement quand une liste aux lignes propres
// existe dans la page pour les lire (`µ._mjs_fineL`, levé par sa première passe, `_mjs_propre`) : avant elle, aucune marque à comparer,
// et sa première passe relit toutes ses lignes ; l'appelant garde l'appel (`if (µ._mjs_fineL) _mjsFineCompte(el)`)
function _mjsFineCompte(el) {
  if (!µ._mjs_partage) µ._mjs_extW++;
  el._mjs_selfW = (el._mjs_selfW || 0) + 1;
}
// <sans-enveloppe>
// // sans enveloppe (réglage `proxy: false`), un objet n'est connu que des variables qui le tiennent elles-mêmes (`_mjs_wrapDeep`,
// // mjs_element.ts) : écrit par une variable du composant, il peut être montré par une ligne d'une liste d'une autre (`$sel = $data[3]`
// // puis `$sel.label = v`, `$favs = [$data[3]]`), que rien ne prévient. Les listes des autres variables sont salies, leur prochaine passe
// // relit chaque ligne ; celles de `k` restent propres (écriture servie champ par champ, changement de structure, ou `k` prévenue)
// function _mjsFineAutres(el, k) {
//   var fi = el._mjs_fineIds, fine = el._mjs_fine, v, r, i;
//   if (fi === void 0) return;
//   for (v in fine) {
//     if (v !== k && (r = fine[v].r) !== void 0) for (i = 0; i < r.length; i++) fi[r[i][0]] = 1;
//   }
// }
// </sans-enveloppe>
// suites d'une écriture faite par `µ._mjs_deepSet`, hors de l'aide pour qu'elle reste fondue dans la boucle qui l'appelle (cf.
// _mjsDeepChemin) : époques (cf. _mjsDeepEpoque), mise à jour fine, comptes des lignes propres (cf. _mjsFineCompte). Chemin de deux ou
// trois segments, qui peut être servi champ par champ : rend vrai quand l'écriture est servie
// <sans-milieu>
// function _mjsDeepSuite(el, path, o, root, snap) {
// </sans-milieu>
// <milieu>
// et la valeur d'avant (`av`), quand un composant peut tenir un objet lu dans l'état
function _mjsDeepSuite(el, path, o, root, snap, av) {
// </milieu>
  // <milieu>
  // <enveloppe>
  // l'objet remplacé sort de ce conteneur (cf. _mjsDeepSorti)
  if (µ._mjs_milieu && av !== null && typeof av === 'object') _mjsDeepSorti(el, o, av);
  // </enveloppe>
  // </milieu>
  if (µ._mjs_partage || o !== root && o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepEpoque(el, path[0], root, o);
  return _mjsFineEcrite(el, path, o, root, el._mjs_inspections, snap);
}
// chemin plus long, jamais servi : appelée par l'aide seulement pour un objet partagé, une liste aux lignes propres dans la page ou un
// objet écrit tenu par un composant (sa garde ne regarde pas la racine, qu'un tel chemin n'atteint que dans un objet qui se contient)
// <sans-milieu>
// function _mjsDeepLong(el, k, o, root) {
// </sans-milieu>
// <milieu>
// et, quand un composant peut tenir un objet lu dans l'état (`µ._mjs_milieu`), pour les objets du milieu du chemin (cf. _mjsDeepMilieu)
function _mjsDeepLong(el, k, o, root, path, av) {
// </milieu>
  if (µ._mjs_partage || o !== root && o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepEpoque(el, k, root, o);
  // <milieu>
  if (µ._mjs_milieu) _mjsDeepMilieu(root, path, path.length - 2);
  // <enveloppe>
  // l'objet remplacé sort de ce conteneur (cf. _mjsDeepSorti)
  if (µ._mjs_milieu && av !== null && typeof av === 'object') _mjsDeepSorti(el, o, av);
  // </enveloppe>
  // </milieu>
  if (µ._mjs_fineL) _mjsFineCompte(el);
  // <sans-enveloppe>
  // _mjsFineAutres(el, k);
  // </sans-enveloppe>
}
// le bloc fin d'une écriture de deux ou trois segments (cf. _mjsDeepSuite) : rend vrai quand l'écriture est servie, champ par champ ou en
// changement de structure
function _mjsFineEcrite(el, path, o, root, ins, snap) {
  var fine = el._mjs_fine, k = path[0];
  if (µ._mjs_fineL) _mjsFineCompte(el);
  // <sans-enveloppe>
  // _mjsFineAutres(el, k);
  // </sans-enveloppe>
  if (fine === void 0) return false;
  if (_mjsFineOwn.call(fine, k) && _mjsFineSet(el, fine[k], path, o, root, ins)) return true;
  if (path.length !== 2 || !_mjsFineStruct(el, k, o)) return false;
  el._mjs_notifyMutationAliased(o, k, snap, 0);
  return true;
}
// </fin>

// copie de la variable avant l'écriture, pour µinspect, seulement s'il la suit ; hors de `µ._mjs_deepSet`, qui garde ainsi sa place sous
// la limite de fusion de V8 (cf. _mjsDeepChemin) — avec la valeur d'avant qu'elle retient pour les liens (bloc `milieu`) ou sans — et
// laisse à la notification, fondue après elle dans la boucle qui écrit, assez du budget que V8 partage entre les fonctions fondues dans
// une même boucle (sans le bloc `milieu`, la copie en ligne le portait à sa limite exacte) : un composant que µinspect ne suit pas n'en paie
// qu'une lecture
function _mjsDeepSnap(el, k) {
  return el._mjs_inspections.has(k) ? µ._mjs_snap(el._state[k]) : void 0;
}

// `µ._mjs_deepSet(el, ['box', 'width'], 200)` : assigne sans Proxy, navigue
// le chemin et notifie la mutation à la clé top-level. Le compilateur
// génère cet appel pour tous les `$.X.Y... = Z` dont l'alias est trackable.
// Rend la valeur AFFECTÉE (sémantique JS d'une assignation), pas le retour de
// la notification — un appelant qui utilise `$.obj.x = v` comme VALEUR (return,
// affectation en chaîne, argument…) doit lire exactement ce qui a été écrit.
µ._mjs_deepSet = function(el, path, value) {
  var i, o, topKey, isRaw, root;
  if (!_mjsDeepChemin(path)) return value;
  topKey = path[0];
  if (path.length === 1) {
    el._set(topKey, value);
    return value;
  }
  // Naviguer sur la cible BRUTE : muter via le Proxy re-déclencherait le set
  // trap → double notification (avec la notif explicite ci-dessous).
  o = _mjsDeepRacine(el._state[topKey]);
  // racine (avant navigation) : c'est TOUJOURS elle qui porte l'« époque » de
  // mutation comparée par `_set` côté two-way (`=!{}`) — peu importe la
  // profondeur réellement mutée, cf. bump plus bas.
  root = o;
  // racine marquée µ.raw : mêmes sémantiques que `_mjs_wrapDeep`
  // (mjs_element.ts) — la mutation s'écrit, mais ne notifie JAMAIS.
  isRaw = µ._mjs_rawSet.has(o);
  i = 1;
  while (i < path.length - 1) {
    o = o[path[i]];
    i++;
  }
  // objet écrit : ni un prototype ni une fonction du navigateur (cf. _mjsDeepRefus)
  if (_mjsDeepInterdit(o)) {
    // <developpement>
    _mjsDeepNavAvis(o, path);
    // </developpement>
    return value;
  }
  // clé déjà convertie en tête de l'aide : la règle des types, la comparaison et l'écriture voient la même clé
  var __last = path[path.length - 1];
  // Déballe la VALEUR écrite (pas seulement `o`, le conteneur navigué ci-dessus) : un pair peut
  // renvoyer un objet doublement enveloppé (écho de liaison) — même logique que `_set`, éléments d'une
  // liste compris (`$o.items = $o.items.filter(…)`). Une primitive, que `µ._mjs_rawIn` rendrait telle quelle, passe sans
  // l'appel : il pèserait dans le budget d'inlining de V8 (cf. _mjsDeepChemin)
  if (value !== null && typeof value === 'object') value = µ._mjs_rawIn(value);
  // types (mjs_types.ts) : un champ ou un élément sous une valeur typée passe la règle de son
  // conteneur — clé calculée comprise (`$x[cle] = v`), contrôlée ici, à l'écriture. Valeur rendue :
  // celle écrite par le code (sémantique d'une affectation), même convertie, ramenée ou refusée
  var __ecrite = value;
  var __treg = el._mjs_treg;
  if (__treg !== void 0 && __treg.has(o)) {
    value = µ._mjs_tdeep(el, __treg, o, __last, value);
    if (value === µ._mjs_TNO) return __ecrite;
  }
  if (isRaw) {
    o[__last] = value;
    return __ecrite;
  }
  // Garde d'égalité : `$obj.x = mêmeValeur` ne doit pas forcer un re-render. Snapshot pour µ.inspect (seulement si activé pour cette
  // top-key)
  // <sans-milieu>
  // if (o[__last] === value) return __ecrite;
  // var __snap = el._mjs_inspections ? _mjsDeepSnap(el, topKey) : void 0;
  // </sans-milieu>
  // <milieu>
  // la valeur d'avant, lue une fois, passe aux suites de l'écriture : objet, il sort de ce conteneur (cf. _mjsDeepSorti) ; la copie pour
  // µinspect se fait hors de l'aide (cf. _mjsDeepSnap)
  var __av = o[__last];
  if (__av === value) return __ecrite;
  var __snap = el._mjs_inspections ? _mjsDeepSnap(el, topKey) : void 0;
  // </milieu>
  o[__last] = value;
  // Même geste que le set trap du Proxy filet (_mjs_wrapDeep, mjs_element.ts) :
  // le CÔTÉ MUTANT enregistre SA PROPRE époque tout de suite, sur la RACINE —
  // sans ça, un enfant lié en two-way (`obj=!{$obj}`) qui mute profondément
  // l'objet partagé ne fait jamais avancer l'époque que le parent compare dans
  // `_set` pour distinguer un écho d'une mutation réelle : le parent croit
  // recevoir un écho et ne se redessine jamais, quelle que soit la profondeur.
  // Tant qu'aucun objet de l'état n'est tenu par deux composants (`µ._mjs_partage`, posé par `_set`, mjs_element.ts),
  // personne ne compare d'époque : l'écriture s'en dispense (une recherche et une écriture dans une WeakMap de moins) ; l'objet
  // écrit sous la racine, cherché parmi les objets tenus, n'avance que si un composant le tient (cf. _mjsDeepEpoque)
  // <fin>
  // suite de l'écriture, hors de l'aide (cf. _mjsDeepSuite) : époques, mise à jour fine, comptes des lignes propres. Seul un chemin de
  // deux ou trois segments peut être servi champ par champ et passe son tableau ; un chemin plus long (`$o.a.b.c`) ne le passe jamais —
  // la boucle qui écrit n'en fabrique alors aucun — et une appli sans objet partagé, sans liste aux lignes propres, dont l'objet écrit
  // n'est tenu par personne, n'y paie qu'une comparaison avec la dernière réponse retenue : l'objet est cherché parmi les objets tenus une
  // fois par tour (cf. _mjsDeepTenu)
  if (path.length < 4) {
    // <sans-milieu>
    // if (_mjsDeepSuite(el, path, o, root, __snap)) return __ecrite;
    // </sans-milieu>
    // <milieu>
    if (_mjsDeepSuite(el, path, o, root, __snap, __av)) return __ecrite;
    // </milieu>
  }
  // <sans-milieu>
  // else if (µ._mjs_partage || µ._mjs_fineL || o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepLong(el, topKey, o, root);
  // </sans-milieu>
  // <milieu>
  // `µ._mjs_milieu` vaut `µ._mjs_partage` ou plus : un composant peut tenir un objet du milieu du chemin (cf. _mjsDeepMilieu)
  else if (µ._mjs_milieu || µ._mjs_fineL || o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepLong(el, topKey, o, root, path, __av);
  // </milieu>
  // </fin>
  // <sans-fin>
  // if (µ._mjs_partage || o !== root && o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepEpoque(el, topKey, root, o);
  // // <milieu>
  // if (µ._mjs_milieu && path.length > 3) _mjsDeepMilieu(root, path, path.length - 2);
  // if (µ._mjs_milieu && __av !== null && typeof __av === 'object') _mjsDeepSorti(el, o, __av);
  // // </milieu>
  // </sans-fin>
  // prévient toutes les variables qui atteignent l'objet écrit, pas seulement `topKey` : après
  // `$sel = it ; $sel.n = 'Z'`, la liste `$items` qui affiche le même objet se redessine aussi
  // (même geste que l'enveloppe ; idem pour `_mjs_deepCall` et `_mjs_deepDelete` plus bas)
  el._mjs_notifyMutationAliased(o, topKey, __snap);
  return __ecrite;
};

// `µ._mjs_deepCall(el, ['list'], 'push', [item])` : appelle une méthode mutative
// sur un sous-objet et notifie la mutation à la clé top-level.
µ._mjs_deepCall = function(el, path, methodName, args) {
  var i, o, a, result, topKey, isRaw, root;
  if (!_mjsDeepChemin(path)) return void 0;
  if (methodName === '__proto__' || methodName === 'constructor' || methodName === 'prototype') { _mjsDeepRefus(methodName); return void 0; }
  topKey = path[0];
  // Naviguer + appeler sur la cible BRUTE : appeler la méthode mutative via le
  // Proxy re-déclencherait le set trap (index + length) → notifs multiples, en
  // plus de la notif explicite ci-dessous.
  o = _mjsDeepRacine(el._state[topKey]);
  root = o; // racine (avant navigation) — cf. commentaire epoch de _mjs_deepSet
  // racine marquée µ.raw : mêmes sémantiques que `_mjs_wrapDeep`
  // (mjs_element.ts) — la méthode s'appelle, mais ne notifie JAMAIS.
  isRaw = µ._mjs_rawSet.has(o);
  i = 1;
  while (i < path.length) {
    o = o[path[i]];
    i++;
  }
  // objet modifié : ni un prototype ni une fonction du navigateur (cf. _mjsDeepRefus)
  if (_mjsDeepInterdit(o)) {
    // <developpement>
    _mjsDeepNavAvis(o, path, methodName);
    // </developpement>
    return void 0;
  }
  // Déballe aussi chaque ARGUMENT (ex. `arr.push($objEnveloppé)`) — pas seulement `o` ci-dessus. Sur place : le code
  // compilé écrit la liste des arguments en littéral, neuve à chaque appel ; une valeur qui n'est pas un objet passe telle
  // quelle (`µ._mjs_toRaw` la rendrait telle quelle), sans appel ni liste ni fonction fabriquées à chaque écriture
  // <enveloppe-aides>
  // <collections>
  // clé d'une `Map`, d'une `WeakMap`, élément d'un `Set`, d'un `WeakSet` (`$m.set($rows[0], 1)`, `$m.delete(k)`, `$s.add($rows[0])`) :
  // celle que la collection range pour cet objet, sous la forme donnée, brute ou enveloppée, une seule entrée (cf. µ._mjs_keyIn, mjs_init.ts)
  var key = args[0];
  // </collections>
  // </enveloppe-aides>
  for (i = 0; i < args.length; i++) {
    a = args[i];
    if (a !== null && typeof a === 'object') args[i] = µ._mjs_toRaw(a);
  }
  // <enveloppe-aides>
  // <collections>
  if (key !== null && typeof key === 'object' && !Array.isArray(o) && (o instanceof Map || o instanceof Set || o instanceof WeakMap || o instanceof WeakSet)) args[0] = µ._mjs_keyIn(o, key);
  // clé retirée, collection vidée : l'index de la collection l'oublie (cf. µ._mjs_keyDrop, mjs_init.ts)
  if (methodName === 'delete' || methodName === 'clear') µ._mjs_keyDrop(o, methodName === 'clear', args[0]);
  // </collections>
  // </enveloppe-aides>
  // types (mjs_types.ts) : une liste typée modifiée par une méthode (push, splice, sort…) fait
  // contrôler ce qu'elle a changé ; refusée, la méthode est défaite, et personne n'est prévenu
  var __treg = el._mjs_treg;
  var __avant = (__treg !== void 0 && Array.isArray(o) && __treg.has(o)) ? µ._mjs_tbefore(o, methodName) : void 0;
  if (isRaw) {
    result = o[methodName].apply(o, args);
    if (__avant !== void 0) µ._mjs_tafter(el, __treg, o, __avant, methodName, args, result);
    return result;
  }
  // Snapshot pour µ.inspect (seulement si activé pour cette top-key).
  var __ins = el._mjs_inspections;
  var __snap = (__ins && __ins.has(topKey)) ? µ._mjs_snap(el._state[topKey]) : void 0;
  // <milieu>
  // <enveloppe>
  // valeur d'une `Map` que la méthode remplace ou retire (cf. _mjsDeepSortis) : lue avant l'appel
  var __sv = µ._mjs_milieu && (methodName === 'set' || methodName === 'delete') && o instanceof Map ? Map.prototype.get.call(o, args[0]) : void 0;
  // </enveloppe>
  // </milieu>
  result = o[methodName].apply(o, args);
  if (__avant !== void 0 && !µ._mjs_tafter(el, __treg, o, __avant, methodName, args, result)) return result;
  // <milieu>
  // <enveloppe>
  // ce que la méthode a sorti de la liste ou de la collection (cf. _mjsDeepSortis)
  if (µ._mjs_milieu) _mjsDeepSortis(el, o, methodName, result, __sv === args[1] ? void 0 : __sv, args[0]);
  // </enveloppe>
  // </milieu>
  // même geste que _mjs_deepSet : fait avancer l'époque AVANT de notifier, pour
  // que le two-way (mjs-bind:X) distingue un écho d'une mutation réelle — si un objet de l'état est tenu par deux composants
  if (µ._mjs_partage || o !== root && o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepEpoque(el, topKey, root, o);
  // <milieu>
  // objets du milieu du chemin, entre la racine et la liste modifiée (`$o.a.l.push(v)` : `$o.a`), cf. _mjsDeepMilieu
  if (µ._mjs_milieu && path.length > 2) _mjsDeepMilieu(root, path, path.length - 1);
  // </milieu>
  // <fin>
  if (µ._mjs_fineL) _mjsFineCompte(el);
  // <sans-enveloppe>
  // _mjsFineAutres(el, topKey);
  // </sans-enveloppe>
  // </fin>
  // <fin>
  // méthode de la liste elle-même (`$data.splice(i, 1)`, `push`, `sort`…) : changement de structure (cf. _mjsFineStruct)
  if (path.length === 1 && _mjsFineStruct(el, topKey, o)) {
    el._mjs_notifyMutationAliased(o, topKey, __snap, 0);
    return result;
  }
  // </fin>
  el._mjs_notifyMutationAliased(o, topKey, __snap);
  return result;
};

// `µ._mjs_deepDelete(el, ['obj', 'clé'])` : supprime une sous-propriété
// (`delete $.obj.clé`) et notifie la mutation à la clé top-level. Calqué sur
// µ._mjs_deepSet — navigue la cible BRUTE (µ._mjs_RAW) pour ne pas repasser par le Proxy
// (qui re-notifierait). Émis par le visiteur UnaryExpression du path-tracker
// (cf. generator/path-tracker.ts) : `delete $.x.y` → `µ._mjs_deepDelete(_mjsThis, […])`.
// Le trap `deleteProperty` de `_mjs_wrapDeep` couvre en plus les delete ÉCHAPPÉS
// (via alias/param non tracé statiquement), en miroir du trap `set`.
// Rend `true` (résultat d'un `delete` réussi, sémantique JS), jamais le retour
// de la notification — même raison que `_mjs_deepSet`.
µ._mjs_deepDelete = function(el, path) {
  var i, o, topKey, isRaw, root;
  if (!_mjsDeepChemin(path)) return false;
  topKey = path[0];
  if (path.length === 1) {
    // `delete $.x` : on retire la clé racine de l'état puis on notifie.
    delete el._state[topKey];
    el._mjs_notifyMutation(topKey);
    return true;
  }
  o = _mjsDeepRacine(el._state[topKey]);
  root = o; // racine (avant navigation) — cf. commentaire epoch de _mjs_deepSet
  // racine marquée µ.raw : mêmes sémantiques que `_mjs_wrapDeep`
  // (mjs_element.ts) — la suppression s'écrit, mais ne notifie JAMAIS.
  isRaw = µ._mjs_rawSet.has(o);
  for (i = 1; i < path.length - 1; i++) { o = o[path[i]]; }
  // objet modifié : ni un prototype ni une fonction du navigateur (cf. _mjsDeepRefus)
  if (_mjsDeepInterdit(o)) {
    // <developpement>
    _mjsDeepNavAvis(o, path);
    // </developpement>
    return false;
  }
  // types : un champ obligatoire d'un objet typé ne se supprime pas (clé déjà convertie en tête de l'aide)
  var __cle = path[path.length - 1];
  var __treg = el._mjs_treg;
  if (__treg !== void 0 && !µ._mjs_tdelete(el, __treg, o, __cle)) return false;
  if (isRaw) {
    delete o[__cle];
    return true;
  }
  // <milieu>
  // <enveloppe>
  // l'objet supprimé sort de ce conteneur (cf. _mjsDeepSorti) : lu avant, sans appeler d'accesseur ; objet absent : l'erreur de JavaScript, plus bas
  var __av = µ._mjs_milieu && Object(o) === o ? Reflect.getOwnPropertyDescriptor(o, __cle) : void 0;
  // </enveloppe>
  // </milieu>
  delete o[__cle];
  // <milieu>
  // <enveloppe>
  if (__av !== void 0) _mjsDeepSorti(el, o, __av.value);
  // </enveloppe>
  // </milieu>
  // même geste que _mjs_deepSet : fait avancer l'époque AVANT de notifier, pour
  // que le two-way (mjs-bind:X) distingue un écho d'une mutation réelle — si un objet de l'état est tenu par deux composants
  if (µ._mjs_partage || o !== root && o !== µ._mjs_nonTenu && _mjsDeepTenu(o)) _mjsDeepEpoque(el, topKey, root, o);
  // <milieu>
  // objets du milieu du chemin (`delete $o.a.b.c` : `$o.a`), cf. _mjsDeepMilieu
  if (µ._mjs_milieu && path.length > 3) _mjsDeepMilieu(root, path, path.length - 2);
  // </milieu>
  // <fin>
  if (µ._mjs_fineL) _mjsFineCompte(el);
  // <sans-enveloppe>
  // _mjsFineAutres(el, topKey);
  // </sans-enveloppe>
  // </fin>
  // <fin>
  // champ supprimé (`delete $o.f7`, `delete $data[i].note`) : ses seules liaisons ; un élément de la liste, structure
  var __fine = el._mjs_fine;
  if (__fine !== void 0 && _mjsFineOwn.call(__fine, topKey) && _mjsFineSet(el, __fine[topKey], path, o, root, el._mjs_inspections)) return true;
  // </fin>
  el._mjs_notifyMutationAliased(o, topKey);
  return true;
};

// <garde>
// aides gardées (jusqu'à µ._mjs_deepSur) : seulement pour l'appli dont le code compilé les appelle, toujours en développement (bundler,
// clé `garde`) — une appli qui n'écrit que par des chemins compilés n'en porte rien
// écriture par un objet de l'état que le compilateur ne suit pas, avec le réglage `proxy: false` (élément trouvé `$l.find(f)`, élément
// d'une copie `$l.filter(f)[0]`, nom qui en tient une partie, clé qui agit, valeur attendue — generator/path-tracker.ts), ou ce que
// l'enveloppe ne garde pas (`Object.getPrototypeOf($o).x = v`, élément du rappel de `sort`) : elle va à l'objet comme en JavaScript et ne
// prévient personne (la construction l'a signalée, avec le réglage). La clé écrite
// passe le refus d'un nom réservé, l'objet celui d'un prototype ou d'une fonction du navigateur, comme par un chemin (cf. _mjsDeepRefus) :
// `$l.find(f)[k].x = v`, `k` venu de l'extérieur (`constructor`, `__proto__`), n'écrit ni dans `Object` ni dans `Object.prototype`.
// `r` : la variable de l'état, nommée par l'avertissement d'une fonction du navigateur (`$l.….x`) ; `s` : le nom réservé écrit dans le
// code avant l'objet (`$l.find(f).constructor.prototype.x = v`), que nomme le refus d'un prototype. L'écriture est celle de JavaScript,
// toujours faite (le `set` d'une classe de l'appli appelé à valeur égale, `-0` écrit sur `0`) ; objet absent : l'erreur de JavaScript.
// Rendent la valeur écrite par le code, le retour de la méthode, `true` pour une suppression faite. Refus : 1 nom réservé, prototype
// ou objet gelé d'un refus (déjà dits), 2 fonction du navigateur (dite par l'aide, en développement)
function _mjsDeepOnRefus(o, k, s) {
  var c;
  if (o === _mjsDeepGele) return 1;
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') { _mjsDeepRefus(k); return 1; }
  if ((c = o.constructor) && c.prototype === o) { _mjsDeepRefus(s || '__proto__'); return 1; }
  return typeof o === 'function' && _mjsNatif(o) ? 2 : 0;
}
µ._mjs_deepSetOn = function(r, o, k, v, s) {
  if (o == null) return o[k] = v;
  if (typeof k === 'object' || typeof k === 'function') k = String(k);
  if (_mjsDeepOnRefus(o, k, s)) {
    // <developpement>
    _mjsDeepNavAvis(o, [r, '…', k]);
    // </developpement>
    return v;
  }
  o[k] = v;
  return v;
};
µ._mjs_deepCallOn = function(r, o, m, args, s) {
  if (o != null && _mjsDeepOnRefus(o, void 0, s)) {
    // <developpement>
    _mjsDeepNavAvis(o, [r, '…'], m);
    // </developpement>
    return void 0;
  }
  return o[m].apply(o, args);
};
µ._mjs_deepDeleteOn = function(r, o, k, s) {
  if (o == null) return delete o[k];
  if (typeof k === 'object' || typeof k === 'function') k = String(k);
  if (_mjsDeepOnRefus(o, k, s)) {
    // <developpement>
    _mjsDeepNavAvis(o, [r, '…', k]);
    // </developpement>
    return false;
  }
  return delete o[k];
};
// objet gelé que reçoit une écriture refusée hors d'une aide (cf. µ._mjs_deepSur, µ._mjs_deepCle) : elle échoue comme par l'enveloppe
// (`Object.assign`, `Object.defineProperty` : TypeError ; `Reflect.set` : `false`), les aides gardées n'y écrivent rien
var _mjsDeepGele = Object.freeze({});
// clé calculée de la chaîne d'une écriture gardée (`$l.find(f)[k].x = v`, `?.[k]` compris, path-tracker.ts) : la valeur lue, comme
// JavaScript la lit ; une clé réservée (`constructor`, `__proto__`, `prototype`) que l'objet n'a pas en propre est refusée, comme par
// l'enveloppe et le chemin compilé — même quand elle mène à une classe de l'appli —, l'écriture reçoit l'objet gelé
µ._mjs_deepCle = function(o, k) {
  if (typeof k === 'object' || typeof k === 'function') k = String(k);
  if ((k === '__proto__' || k === 'constructor' || k === 'prototype') && o != null && !Object.prototype.hasOwnProperty.call(o, k)) { _mjsDeepRefus(k); return _mjsDeepGele; }
  return o[k];
};
// clé calculée d'un motif qui lit une partie de l'état (`const { [k]: c } = $l.find(f)`, path-tracker.ts) : µ._mjs_deepNom la convertit
// une fois, comme JavaScript la convertit, dans un nom posé par la passe ; le motif lit la valeur une fois (dans un autre nom), puis une
// clé absente (µ._mjs_deepNomA) dont la valeur par défaut est celle de µ._mjs_deepNomLu, qui juge la valeur lue avec sa clé — une clé
// réservée qui mène à une fonction (`constructor` hérité : une classe de l'appli, `Object`) ou à un prototype (`__proto__`, `prototype`)
// est refusée, comme par l'enveloppe, et `c` vaut `undefined` ; un champ de données de ce nom (`{ constructor: 'Renault' }`) est lu.
// Aucune case partagée : un accesseur lu par le motif peut en lire un autre, ou rattraper son erreur, sans rien laisser derrière lui.
// Motif d'affectation (`({ [k]: c } = $l.find(f))`, `c` n'y est pas un nom à poser) : `µ._mjs_deepNom(k, 1)` rend un cadre neuf, qui
// tient la clé et juge la valeur qu'il reçoit (`.v`), relue aussitôt dans µ._mjs_deepNomV
µ._mjs_deepNom = function(k, c) {
  if (typeof k === 'object' || typeof k === 'function') k = String(k);
  return c ? { k: k, set v(v) { µ._mjs_deepNomV = µ._mjs_deepNomLu(v, this.k); } } : k;
};
µ._mjs_deepNomLu = function(v, k) {
  var c;
  if (k === 'constructor' ? typeof v === 'function' : (k === '__proto__' || k === 'prototype') && v != null && (c = v.constructor) && c.prototype === v) { _mjsDeepRefus(k); return void 0; }
  return v;
};
µ._mjs_deepNomA = Symbol();
// valeur d'une méthode qui rend la collection même (`sort`, `reverse`, `fill`, `copyWithin`, `set` d'une Map, `add` d'un Set), avec
// l'enveloppe, en tête de la chaîne d'une écriture (`$l.sort(f)[0].x = v`, path-tracker.ts) : relue par l'enveloppe du composant, l'écran
// suit l'écriture ; ailleurs, la valeur de ces méthodes reste brute. Une valeur qui n'est pas un objet, ou marquée par `µraw` : telle quelle
µ._mjs_deepMeme = function(el, r, k) {
  // <milieu>
  // <enveloppe>
  // collection rangée plus bas que la variable, enveloppée ici sans passer par son conteneur : si aucune lecture n'a posé ses liens, sa
  // fiche n'est pas sûre — une écriture par un nom faite dessous redit la variable au lieu de remonter (cf. _mjsLie, mjs_element.ts)
  var x, f;
  if (r !== null && typeof r === 'object') {
    x = el._mjs_wrapDeep(r, k);
    f = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(r);
    if (f !== void 0 && f.a === void 0 && µ._mjs_toRaw(el._state[k]) !== r) f.a = null;
    return x;
  }
  // </enveloppe>
  // </milieu>
  return r !== null && typeof r === 'object' ? el._mjs_wrapDeep(r, k) : r;
};
// premier argument d'une fonction qui modifie l'objet qu'elle reçoit (`Object.assign(o, …)`, `Object.defineProperty`, `Reflect.set`…),
// pris dans l'état (réglage `proxy: false`) ou dans le magasin (`r` : `$` devant sa clé), ou objet d'une écriture relue avec `yield`
// (path-tracker.ts) : un prototype ou une fonction du navigateur (`$l.find(f).constructor`) est refusé comme ci-dessus, la fonction
// reçoit alors l'objet gelé
µ._mjs_deepSur = function(r, o, s) {
  if (o === null || (typeof o !== 'object' && typeof o !== 'function') || !_mjsDeepOnRefus(o, void 0, s)) return o;
  // <developpement>
  // `constructor` écrit dans le code : l'avertissement du magasin pour ce cas (mjs_store_globals.ts) ; sinon celui d'une clé venue de l'extérieur
  if (typeof o === 'function') µ.warn(s === 'constructor' ? µ._mjs_msg('initFnCtor', { path: '$' + r + '.…', name: o.name }, '{path} : `constructor`, écrit dans le code, mène à la fonction {name} du navigateur, que partage toute la page ; rien n\'est écrit. Écrivez dans l\'objet lui-même, sans `constructor`.') : µ._mjs_msg('initFn', { path: '$' + r + '.…', fn: '$' + r + '.…', name: o.name }, '{path} : {fn} contient la fonction {name} du navigateur, sans doute amenée par une clé venue de l\'extérieur (adresse, formulaire, données reçues) ; rien n\'est écrit. Vérifiez cette clé.'));
  // </developpement>
  return _mjsDeepGele;
};
// </garde>

// `$` lu comme une valeur, et non comme `$.x` ou `$[k]` (`Object.assign($, …)`, `Reflect.set($, k, v)`, `const s = $`, `f($)`,
// la tête d'une boucle `for ($x of l)`) : le compilateur le rend par `µ._mjs_makeDeepProxy(_mjsThis, [])` (transform-reactive.ts),
// l'état du composant enveloppé. Une écriture par l'enveloppe passe par `_set`, comme `$x = v` ; une suppression par
// `µ._mjs_deepDelete`, comme `delete $x` ; une définition (`Object.defineProperty`) prévient la variable : les valeurs dérivées qui
// la lisent se recalculent, l'écran suit. Sous un nom réservé (`__proto__`, `constructor`, `prototype`), la définition pose une
// propriété propre de l'état, comme sur un objet ordinaire (aucun prototype n'est touché), sans prévenir de variable. Une seule
// enveloppe par composant (`$ === $` reste vrai), qui se déballe comme les autres (`µ._mjs_toRaw`) ; une lecture rend ce que rend l'état
function _mjsStateProxy(el) {
  return el._mjs_stateProxy ||= new Proxy(el._state, {
    get(t, k) {
      return k === µ._mjs_RAW ? t : t[k];
    },
    set(t, k, v) {
      // <precision>
      // écrit par le code du composant (`code`), comme par `µ._set` (mjs_init.ts)
      el._set(k, v, 1);
      // </precision>
      // <horloge>
      // el._set(k, v);
      // </horloge>
      return true;
    },
    deleteProperty(t, k) {
      µ._mjs_deepDelete(el, [k]);
      return true;
    },
    defineProperty(t, k, d) {
      if (!Reflect.defineProperty(t, k, d)) return false;
      if (µ._mjs_safeKey(k)) el._mjs_notifyMutation(k);
      return true;
    }
  });
}

// `µ._mjs_makeDeepProxy(el, path)` : alias public pour _mjs_wrapDeep, utilisé
// au point d'escape détecté par le compilateur (function call externe,
// storage non-tracké, etc.). Un nom réservé du chemin est refusé comme dans les trois aides (cf. _mjsDeepRefus) :
// rien n'est enveloppé, `undefined` est rendu — sans quoi l'enveloppe d'un prototype (atteint par un objet gelé de
// l'état, que l'état enveloppé rend brut) ferait écrire dans ce prototype tout code qui la reçoit
µ._mjs_makeDeepProxy = function(el, path) {
  var i, o, topKey;
  // chemin vide : l'état lui-même (cf. _mjsStateProxy)
  if (!path.length) return _mjsStateProxy(el);
  if (!_mjsDeepChemin(path)) return void 0;
  topKey = path[0];
  o = el._state[topKey];
  i = 1;
  while (i < path.length) {
    o = o[path[i]];
    i++;
  }
  // <milieu>
  // <enveloppe>
  // objet atteint sans passer par l'enveloppe de son conteneur (chemin qui traverse un objet gelé, rendu brut) : liens manquants, fiche
  // pas sûre (cf. µ._mjs_deepMeme)
  var x, f;
  if (path.length > 1 && o !== null && typeof o === 'object') {
    x = el._mjs_wrapDeep(o, topKey);
    f = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(µ._mjs_toRaw(o));
    if (f !== void 0 && f.a === void 0) f.a = null;
    return x;
  }
  // </enveloppe>
  // </milieu>
  return el._mjs_wrapDeep(o, topKey);
};
