// mjs_dynamic — <@element tag={…}> et <@module comp={…}> : balise/composant dynamiques
// (équivalents <svelte:element>/<svelte:component this={X}>). DÉTACHÉ du cœur : embarqué
// seulement si une source du projet écrit `<@element`/`<@module` (scan textuel, cf.
// bundler/index.ts) — le µeffect qui pilote la mise à jour dépend aussi de mjs_effect.ts,
// forcé par le même signal.
// deux parties qui ne se servent pas l'une de l'autre, la balise (bloc `<element-dynamique>`) et le composant (bloc
// `<module-dynamique>`) : en production, chacune quitte le cœur quand aucune unité du build ne l'appelle, sauf si `runtime`
// demande le module (`'all'`, ou `'dynamic'` dans la liste ; bundler/index.ts) ; les aides communes restent hors des deux blocs
//
// Le transpiler rend un placeholder <div mjs-el="N"> avec les enfants, et émet
// un µeffect appelant µ._updDynEl(@, 'N', tag). On localise le nœud courant (par
// marqueur la 1ʳᵉ fois, puis via la map), et si le tag change on crée le nouvel
// élément, copie les attrs, DÉPLACE les enfants (préserve leur réactivité, leurs
// node-ids), remplace le nœud, et mémorise le nouveau. tag falsy → on masque
// (Svelte ne rend rien). Même logique que `_updElement` mais repérée par marqueur.
// SÉCURITÉ — le texte des enfants déplacés dans une de ces balises s'exécute (script) ou
// charge une ressource externe (iframe/object/embed/base/link/meta/style) : <@element $tag>/
// <@module $comp> choisis par l'ÉTAT ne peuvent pas y devenir SANS acceptation explicite (4e
// argument `accept`). `accept` ABSENT → seul ce pool de 8 balises refuse ; `accept` PRÉSENT →
// liste FERMÉE, pool ou pas — seuls les noms qu'il contient sont créés (cf. µ._updDynEl/
// µ._updModule ci-dessous).
// remplacement insensible à une méthode `replaceWith` du composant (cf. mjs_element.ts)
µ._mjs_swap = µ._mjs_swap || function(cur, nn) {
  if (typeof Node !== 'function' || !(cur instanceof Node)) return cur.replaceWith(nn);
  var p = cur.parentNode;
  if (p) Node.prototype.replaceChild.call(p, nn, cur);
};

µ._mjs_dynTagsRefuses = ['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'style'];

// µ._mjs_dynAcceptList — normalise le 4e argument `accept` de µ._updDynEl/µ._updModule :
// `accept` passé en CHAÎNE (`'iframe'`, `'iframe
// style'`) plantait les deux fonctions, `TypeError: accept.map is not a function`, l'appelant
// n'ayant jamais promis un tableau. Tolérance : absent (null/undefined) → liste vide, sans warn ;
// chaîne → découpée sur les blancs ; tableau → inchangé (`.map` comme avant) ; tout autre type
// (nombre, booléen, objet…) → liste vide + 1 warn (mieux qu'un plantage muet).
µ._mjs_dynAcceptList = function(accept) {
  if (accept == null) return [];
  if (typeof accept === 'string') return accept.trim().split(/\s+/).filter(Boolean).map(function(a) { return a.toLowerCase(); });
  if (Array.isArray(accept)) return accept.map(function(a) { return String(a).trim().toLowerCase(); });
  µ.warn(µ._mjs_msg('dynAccept', null, '<@element>/<@module> : accept attend une liste de noms (tableau ou chaîne séparée par des espaces)'));
  return [];
};

// masque/démasque partagés entre µ._updDynEl et µ._updModule. Le
// marqueur `_mjs_mjsMasque` distingue NOTRE display:none (posé par la garde falsy) d'un display
// choisi par l'auteur : `removeProperty` ne part jamais sur un style qu'on n'a pas nous-même
// écrasé. `_mjs_mjsDisplayAvant` mémorise la valeur d'auteur AVANT l'écrasement (idempotent : un
// second masquage ne réécrit pas la mémoire) pour la restaurer telle quelle au démasquage —
// sans elle, un `style="display:flex"` masqué puis re-basculé perdait sa valeur pour de bon.
µ._mjs_dynMask = function(cur) {
  if (!cur.style) return;
  if (!cur._mjs_mjsMasque) cur._mjs_mjsDisplayAvant = cur.style.display;
  cur.style.display = 'none';
  cur._mjs_mjsMasque = true;
};
µ._mjs_dynUnmask = function(cur) {
  if (!cur.style || !cur._mjs_mjsMasque) return;
  if (cur._mjs_mjsDisplayAvant) cur.style.display = cur._mjs_mjsDisplayAvant;
  else cur.style.removeProperty('display');
  cur._mjs_mjsMasque = false;
  cur._mjs_mjsDisplayAvant = null;
};

// <element-dynamique>
// la dernière balise demandée pour chaque repère d'un composant (balise, `accept`), que reprend le repère neuf d'une branche recréée
// (µ._mjs_dynRe) ; dans une table du cœur, jamais sur le composant
var _mjs_dynArgs = new WeakMap();
// les nœuds d'un repère sortis de la page (ligne retirée, bloc refermé), par composant et par repère : des références
// faibles, que le ramasse-miettes vide quand la ligne part pour de bon
var _mjs_dynOut = new WeakMap();
function _mjsDynRef(x) {
  return typeof WeakRef === 'function' ? new WeakRef(x) : { deref: function() { return x; } };
}
µ._updDynEl = function(component, key, tag, accept, re) {
  var els  = component._mjs_dynEls || (component._mjs_dynEls = {});
  var args = _mjs_dynArgs.get(component);
  if (!args) _mjs_dynArgs.set(component, args = {});
  args[key] = [tag, accept];
  // les nœuds du repère, un par ligne quand le `<@element>` est dans un `{for}` : d'abord ceux qu'on connaît encore dans la page — un
  // bloc {if}/{key}/{await} refermé puis rouvert, une ligne retirée détachent les leurs, que le cache pointerait encore (replaceWith =
  // no-op silencieux, ou pire early-return sur tagName identique) —, puis les repères neufs, retrouvés par leur marqueur : ligne ajoutée,
  // branche recréée. `re` (µ._mjs_dynRe) : seuls les repères neufs prennent la balise, les nœuds connus ont déjà la leur
  var l = els[key] || [], vus = new Set(), curs = [], racine = component._shadow, out = _mjs_dynOut.get(component), tous, neufs, j, n, cur, autre, refus, vieux;
  if (!out) _mjs_dynOut.set(component, out = {});
  out = out[key] || (out[key] = []);
  for (j = 0; j < l.length; j++) {
    if (!l[j].isConnected) out.push(_mjsDynRef(l[j]));
    else if (!vus.has(l[j])) {
      vus.add(l[j]);
      curs.push(l[j]);
    }
  }
  neufs = curs.length;
  // les nœuds sortis de la page sont gardés sans être retenus : revenus, ils prennent la balise demandée comme un repère neuf ; partis
  // pour de bon, oubliés
  for (j = out.length - 1; j >= 0; j--) {
    n = out[j].deref();
    if (n === void 0 || vus.has(n)) out.splice(j, 1);
    else if (n.isConnected) {
      vus.add(n);
      curs.push(n);
      out.splice(j, 1);
    }
  }
  // les repères du composant lui-même : un enfant léger (`:lightDom`) rend son contenu dans la même ombre, avec ses propres repères
  // numérotés depuis zéro comme les nôtres ; les nôtres sont ceux qu'aucun hôte léger ne sépare de notre racine. À défaut, un repère
  // que nous glissons chez un enfant léger, jamais celui que l'enfant a déjà pris pour lui (même numéro)
  tous = racine.querySelectorAll('[mjs-el="' + key + '"]');
  for (j = 0; j < tous.length; j++) {
    if (vus.has(tous[j])) continue;
    n = tous[j].parentNode;
    while (n !== racine && !n._mjs_isLight) n = n.parentNode;
    if (n === racine) curs.push(tous[j]);
    else if (!autre && !(n._mjs_dynEls && n._mjs_dynEls[key] && n._mjs_dynEls[key].indexOf(tous[j]) >= 0)) autre = tous[j];
  }
  if (!curs.length && autre) curs.push(autre);
  els[key] = curs;
  // tag falsy → masquer (garde AUSSI la valeur ÉPURÉE : ' ' seul passait la garde
  // brute puis levait sur document.createElement('') — bruyant, capté par le µeffect englobant
  // seulement). UNE SEULE valeur trimmée pour la garde, la comparaison, la
  // création ET le message.
  var tagStr = (tag == null || tag === false) ? '' : String(tag).trim();
  var newTagName = tagStr.toUpperCase();
  for (j = re ? neufs : 0; j < curs.length; j++) {
    cur = curs[j];
    if (tagStr === '') {
      µ._mjs_dynMask(cur);
      continue;
    }
    // même tag qu'au placeholder : démasque seulement si NOUS avions masqué (sinon
    // un display d'auteur au premier rendu était détruit avant même d'avoir servi).
    if (cur.tagName === newTagName) {
      µ._mjs_dynUnmask(cur);
      continue;
    }
    // SÉCURITÉ — accept ABSENT : pool `µ._mjs_dynTagsRefuses` seul refuse (8 balises). accept
    // PRÉSENT (chaîne ou tableau, casse insensible) : liste FERMÉE, seuls les noms qu'elle contient
    // sont créés — pool ou pas ; une liste normalisée vide n'autorise donc plus rien. Jugée une fois pour toutes les lignes, dite une fois
    if (refus === void 0) {
      var norm = tagStr.toLowerCase();
      var hasAccept  = typeof accept === 'string' || Array.isArray(accept);
      var acceptNorm = µ._mjs_dynAcceptList(accept);
      var refusePool = !hasAccept && µ._mjs_dynTagsRefuses.indexOf(norm) !== -1;
      var refuseList = hasAccept && acceptNorm.indexOf(norm) === -1;
      if (refusePool) {
        µ.warn(µ._mjs_msg('dynRefused', { norm: norm }, '<@element>/<@module> : balise « {norm} » refusée — un élément dynamique ne peut pas devenir {norm} ; pour l\'autoriser explicitement : accept="{norm}".'));
      }
      if (refuseList) {
        µ.warn(µ._mjs_msg('dynNotListed', { norm: norm, list: acceptNorm.join(' ') }, '<@element>/<@module> : balise « {norm} » refusée — hors de la liste accept="{list}" ; quand accept est présent, seuls les noms qu\'il liste sont créés.'));
      }
      refus = refusePool || refuseList;
    }
    if (refus) continue;
    // retire NOTRE masque avant de copier les attributs vers le nouveau nœud :
    // sinon un nœud masqué puis basculé vers un autre tag hérite du display:none (la boucle copie
    // l'attribut `style` de l'ancien nœud). `_mjs_dynUnmask` ne touche RIEN si on n'a
    // jamais masqué (un display d'auteur au tout premier rendu survit donc, intact).
    µ._mjs_dynUnmask(cur);
    var nn = document.createElement(tagStr), i, a = cur.attributes;
    // `mjs-appearing` (le bouclier sans transition d'un composant, mjs_init.ts) ne suit pas : la balise neuve ne le perdrait jamais
    for (i = 0; i < a.length; i++) {
      if (a[i].name !== 'mjs-el' && a[i].name !== 'mjs-appearing') nn.setAttribute(a[i].name, a[i].value);
    }
    // `style` fait déjà partie de `cur.attributes`
    // (reflété par le DOM), donc recopié par la boucle ci-dessus ; cette ligne le rend EXPLICITE
    // plutôt que déductif, filet de sécurité pour l'état posé par un effet @style.* juste avant
    // le remplacement. `cur.style` est TOUJOURS truthy (tout
    // nœud DOM porte un CSSStyleDeclaration) : la garde ne protégeait rien, un nœud SANS aucun style
    // héritait d'un `style=""` parasite (`cssText = ''` crée l'attribut). On ne recopie désormais que
    // si l'ancien nœud portait réellement du style.
    if (cur.style && cur.style.cssText) nn.style.cssText = cur.style.cssText;
    while (cur.firstChild) nn.appendChild(cur.firstChild);
    // le routage des événements suit la balise neuve : sa table (`_mjs_ev`, posée par _mjs_registerRefs en PROP sur le nœud, jamais un
    // attribut DOM, donc jamais recopiée par la boucle d'attributs ci-dessus), lue par _mjs_bindEvents pendant la remontée de délégation.
    // Sans cette ligne, un `@click={…}` posé DIRECTEMENT sur <@element>/<@module> cessait de répondre dès le 1er remplacement de nœud
    // (distinct de la resync `_mjs_nodes` ci-dessous : deux mécanismes de liaison différents, deux résyncs différentes)
    µ._mjs_evCopy(cur, nn);
    // les index de sa ligne (`_mjs_idx_N`, posés par la mise à jour de la ligne), où un gestionnaire de la ligne retrouve son élément : sans
    // eux, un clic sur la balise neuve agissait sur la première ligne. Nommés un à un, comme pour la copie d'un *marquee
    // (mjs_fx_marquee.ts) : la production renomme ces propriétés
    nn._mjs_idx_0 = cur._mjs_idx_0;
    nn._mjs_idx_1 = cur._mjs_idx_1;
    nn._mjs_idx_2 = cur._mjs_idx_2;
    nn._mjs_idx_3 = cur._mjs_idx_3;
    // au-delà du quatrième niveau, les rangs que nomme la description de sa ligne (`ix`, posée par generator/compile.ts dans un gabarit
    // qui porte un `<@element>`), sans plafond ; rien à faire hors d'une ligne ou en deçà
    var rg = cur._mjs_ev && cur._mjs_ev._mjs_reg, r;
    if (rg && rg.ix) for (r in rg.ix) nn[r] = cur[r];
    // les clés qu'un étalement a posées sur la balise (rangées par rang) suivent la balise neuve, que la boucle ci-dessus a recopiées : une clé
    // qui quitte ensuite l'objet quitte aussi la balise neuve. Hors du bloc de la classe : il part en production quand aucune classe écrite
    // ne l'appelle (`<@element $tag {...$x}>` seul), le relevé des clés doit rester
    nn._mjs_spk = cur._mjs_spk;
    // <etale-classe>
    // sa part de la classe et la classe écrite calculée suivent aussi, pour que l'étalement qui change ou perd sa classe ne retire que ce
    // qu'il avait apporté, jamais un jeton de la classe écrite
    nn._mjs_spm = cur._mjs_spm; _mjs_clsBases.set(nn, _mjs_clsBases.get(cur));
    if (_mjs_spCk.has(cur)) _mjs_spCk.set(nn, _mjs_spCk.get(cur));
    // </etale-classe>
    // `_mjs_once_fired` (mjs_element.ts) est une
    // WeakMap<nœud, Set<clé>> : le nouveau nœud est une clé neuve, un `.once` déjà déclenché
    // repartait donc à chaque remplacement. On transfère l'entrée existante vers le nouveau nœud.
    var onceMap = component._mjs_once_fired; if (onceMap && onceMap.has(cur)) onceMap.set(nn, onceMap.get(cur));
    µ._mjs_swap(cur, nn);
    curs[j] = nn;
    (vieux || (vieux = new Map())).set(cur, nn);
    // resynchronise toute référence du composant qui pointait sur l'ancien nœud : une
    // liaison réactive (@style.*, attribut) posée sur ce <@element> compile vers `this._mjs_nodes.sN`,
    // figée sur le placeholder sans cette passe — les effets suivants écriraient pour toujours sur
    // un nœud détaché, en silence (liaison orpheline après replaceWith).
    if (component._mjs_nodes) {
      for (var k in component._mjs_nodes) { if (component._mjs_nodes[k] === cur) component._mjs_nodes[k] = nn; }
    }
  }
  // la ligne d'un `{for}` dont la balise est en tête garde ses nœuds de tête (`nodes` de son entrée, mjs_for.ts) : la balise neuve y prend
  // la place de l'ancienne, sinon la ligne retirée ou déplacée laisserait la balise neuve dans la page. De même dans les réfs de la ligne
  // (`__nodes`), que ses mises à jour relisent (generator/compile.ts) : sinon ses liaisons écrivaient sur l'ancienne balise, hors de la page
  var lc = component._mjs_list_cache, c, e, m;
  if (vieux && lc) {
    for (c in lc) {
      if (lc[c]) for (e of lc[c].values()) {
        for (m = 0; e.nodes && m < e.nodes.length; m++) if (vieux.has(e.nodes[m])) e.nodes[m] = vieux.get(e.nodes[m]);
        for (m in e.__nodes) if (vieux.has(e.__nodes[m])) e.__nodes[m] = vieux.get(e.__nodes[m]);
      }
    }
  }
};

// un bloc qui recrée son contenu l'appelle après sa passe (code généré par generator/compile.ts) : branche d'un `{if}`, `{key}`, `{await}`,
// ligne de `{for}` ajoutée ou remise. L'effet de la balise ne suit que sa variable : les repères neufs reprennent donc ici la dernière
// balise demandée, les nœuds connus encore dans la page gardent la leur
µ._mjs_dynRe = function(component) {
  var args = _mjs_dynArgs.get(component), k;
  for (k in args) µ._updDynEl(component, k, args[k][0], args[k][1], 1);
};
// </element-dynamique>

// <module-dynamique>
// ============================================================================
// <@module $comp> — composant dynamique (équivalent <svelte:component this={X}>)
// ============================================================================
// Calqué sur µ._updDynEl, mais le 3ᵉ argument désigne un COMPOSANT, pas un tag :
//   - une CHAÎNE = nom d'un composant MJS, SANS le préfixe (`'tuto-card-a'` → <mjs-tuto-card-a>)
//     ou déjà complet (`'mjs-tuto-card-a'`), cf. µ._mjs_modTag → document.createElement ;
//   - une CLASSE/constructeur → `new Comp()` en best-effort (try/catch : un
//     composant MJS est enregistré via un wrapper anonyme, donc `new` direct peut
//     lever « Illegal constructor » — d'où le filet).
// On copie les attrs fixes (class, data-*, valeurs littérales), pose les props dynamiques (`props`,
// un objet) comme sur un composant écrit en dur — valeurs TYPÉES, jamais des chaînes d'attribut —,
// DÉPLACE les enfants (light DOM → slots), remplace le nœud, et re-monte si le composant change.
// Falsy → on masque (rien rendu).
// Appelé par le code généré, dans la portée du nœud (racine, ligne de {for}, branche) : `node` est
// le nœud du gabarit — la ligne ou la branche le garde en main même une fois remplacé. Il devient la
// TÊTE : un seul lien `_mjs_modLive` (tête → nœud vivant), réécrit à chaque remplacement, jamais une
// chaîne — les anciens composants ne sont plus retenus par rien. Dans une ligne de `{for}`, `refs` (les
// refs de la ligne) donne l'entrée de liste : son `nodes` est resynchronisé, pour que retrait,
// déplacement et ancre d'insertion visent le nœud vivant. `attrs` : attributs dynamiques de la balise
// (class, style, id, data-*, aria-*). `props` : un objet (posé à chaque appel : ligne de {for}) ou une
// fonction qui le rend (appelée seulement à la création du composant : ailleurs, chaque prop a son
// propre effet, cf. µ._mjs_modSet).
// Sans `node` (appel direct), `key` désigne le repère `[mjs-mod="key"]` de l'ombre du composant.

// µ._mjs_modTag — la balise d'un nom de composant : le nom du projet est complété du préfixe
// (`tuto-card-a` → `mjs-tuto-card-a`) quand le projet le connaît — défini, ou listé au manifeste
// (`µ.paths`, clé = nom sans préfixe : un composant pas encore chargé y figure) ; sinon le nom reste
// tel quel : déjà complet (`mjs-…`), balise HTML native (`section`), élément tiers (`mon-widget`).
µ._mjs_modTag = function(nom) {
  var n = nom.toLowerCase();
  if (n.slice(0, 4) === 'mjs-') return nom;
  var connu = (µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, n)) || (typeof customElements !== 'undefined' && customElements.get('mjs-' + n));
  // une balise HTML connue reste native, même si un composant porte le même nom (`section`) : le
  // composant s'écrit alors par son nom complet (`mjs-section`)
  if (connu && n.indexOf('-') < 0 && !(document.createElement(n) instanceof HTMLUnknownElement)) return nom;
  return connu ? 'mjs-' + nom : nom;
};

// µ._mjs_modProps — pose les props d'un <@module> sur `el`, comme le fait un composant écrit en dur :
// `_set` si le composant est défini, le registre des props en attente (µ._mjs_pend) sinon. `props` est
// un objet, ou une fonction qui le rend : les props viennent alors d'être posées à la CRÉATION, et le
// court instant où l'effet de chaque prop tournerait pour rien (`_mjs_modFresh`, les valeurs posées,
// vidé en microtâche) ne repose pas la même valeur — un littéral `{ u: $u }` aurait sinon une 2ᵉ référence au montage
µ._mjs_modProps = function(el, props) {
  if (!props) return;
  var neuf = typeof props === 'function';
  if (neuf) props = props();
  for (var k in props) {
    if (el._set) el._set(k, props[k]);
    else µ._mjs_pend(el, k, props[k]);
    µ._mjs_modGlob(el, k, props[k]);
  }
  if (neuf) {
    // les VALEURS posées à la création : l'effet d'une prop ne se tait que s'il apporte la même
    el._mjs_modFresh = props;
    queueMicrotask(function() { el._mjs_modFresh = null; });
  }
};

// même valeur, ou deux littéraux (objet, tableau) de même contenu au premier niveau
µ._mjs_modSame = function(a, b) {
  var ka, i;
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
  return true;
};

// µ._mjs_modSet — une prop dont une variable a changé (un effet par prop, comme sur un composant écrit
// en dur) : rien tant que le composant n'existe pas, rien si la prop vient d'être posée à la création
µ._mjs_modSet = function(el, k, v) {
  // dans une branche {await}, le nœud connu de l'effet est la TÊTE : la prop va au composant vivant
  if (el._mjs_modLive) el = el._mjs_modLive;
  if (!el._mjs_modOrig) return;
  var f = el._mjs_modFresh;
  // posée à la création avec cette même valeur : rien à refaire ; une valeur écrite depuis (dans le même
  // tour, par un µmount) est bien posée
  if (f && k in f && µ._mjs_modSame(f[k], v)) return;
  if (el._set) el._set(k, v);
  else µ._mjs_pend(el, k, v);
  µ._mjs_modGlob(el, k, v);
};

// µ._mjs_modGlob — un attribut global que le navigateur lit sur la balise (`title`, `role`, `hidden`, `tabindex`, `lang`, `dir`,
// `slot`) se pose AUSSI sur la balise d'un composant `mjs-…`, en plus de sa prop, comme sur un composant écrit en dur (même liste
// et même règle, cf. logiqueComposant, generator/attributes/index.ts ; `id` et `class` sont des attributs de la balise, cf.
// µ._mjs_modAttrs) — sauf quand le composant déclare lui-même une prop de ce nom (`_mjs_var_bits`, nom comparé sans la casse) :
// il la garde pour lui, sans attribut. Un composant pas encore défini (chargé à la demande) ne dit pas ses props : l'attribut
// attend sa définition, une seule attente par balise (`_mjs_haw`), et c'est la dernière valeur écrite (`_mjs_ha`, sous le nom écrit, `_mjs_hk`)
// qui se pose
µ._mjs_modGlob = function(el, k, v) {
  var nom = k.toLowerCase();
  if (!/^(?:title|role|hidden|tabindex|lang|dir|slot)$/.test(nom) || el.localName.slice(0, 4) !== 'mjs-') return;
  (el._mjs_ha || (el._mjs_ha = Object.create(null)))[nom] = v;
  (el._mjs_hk || (el._mjs_hk = Object.create(null)))[nom] = k;
  var pose = function(x) {
    var d = el._mjs_var_bits && Object.keys(el._mjs_var_bits).find(function(y) { return y.toLowerCase() === x; });
    if (!d) µ._mjs_updAttrNode(el, x, el._mjs_ha[x], 1);
    else if (d !== el._mjs_hk[x]) el._set(d, el._mjs_ha[x]);
  };
  if (el._mjs_var_bits) pose(nom);
  else if (!el._mjs_haw) {
    el._mjs_haw = 1;
    customElements.whenDefined(el.localName).then(function() { el._mjs_haw = 0; for (var x in el._mjs_ha) pose(x); });
  }
};

// µ._mjs_modAttrs — attributs dynamiques de la balise du composant (valeurs d'attribut, jamais des props)
µ._mjs_modAttrs = function(el, attrs) {
  if (!attrs) return;
  for (var k in attrs) µ._mjs_updAttrNode(el, k, attrs[k]);
};

// µ._mjs_modKeep — `cur` porte déjà le composant voulu : démasqué, il garde son état, et ses props suivent — un objet à chaque appel, une
// fonction seulement à la création. Le composant qu'une page rendue au serveur garde à la reprise (`markers`, `positional`) a été créé par
// le serveur : il a déjà la bonne balise, sans le repère `mjs-mod` du gabarit ni tête. Ses props se posent alors comme à une création, et
// il devient sa propre tête, pour que l'effet de chaque prop l'atteigne ensuite (µ._mjs_modSet)
µ._mjs_modKeep = function(cur, props, attrs) {
  µ._mjs_dynUnmask(cur);
  if (typeof props !== 'function') µ._mjs_modProps(cur, props);
  // <reprise-serveur>
  else if (!cur._mjs_modOrig && !cur.hasAttribute('mjs-mod')) {
    cur._mjs_modOrig = cur;
    µ._mjs_modProps(cur, props);
  }
  // </reprise-serveur>
  µ._mjs_modAttrs(cur, attrs);
};

// les rangs d'une ligne de `{for}` (`_mjs_idx_N`), que sa mise à jour pose sur la tête du repère (`node`), suivent le composant vivant, où
// un gestionnaire de la ligne retrouve son élément : les quatre premiers nommés ici, les suivants par la description de la ligne (`ix`)
function _mjsModRangs(de, a) {
  var rg = de._mjs_ev && de._mjs_ev._mjs_reg, r;
  a._mjs_idx_0 = de._mjs_idx_0;
  a._mjs_idx_1 = de._mjs_idx_1;
  a._mjs_idx_2 = de._mjs_idx_2;
  a._mjs_idx_3 = de._mjs_idx_3;
  if (rg && rg.ix) for (r in rg.ix) a[r] = de[r];
}
µ._updModule = function(component, key, Comp, accept, props, node, attrs, refs) {
  var cur = node;
  if (cur && cur._mjs_modLive) cur = cur._mjs_modLive;
  // dans une ligne, la tête a reçu les rangs de cette passe (ligne déplacée, liste refaite) : le composant vivant les reprend
  if (refs && cur !== node) _mjsModRangs(node, cur);
  if (!cur) {
    component._mjs_mods || (component._mjs_mods = {});
    cur = component._mjs_mods[key];
    if (cur && !cur.isConnected) {
      delete component._mjs_mods[key];
      cur = null;
    }
    if (!cur) {
      cur = component._shadow.querySelector('[mjs-mod="' + key + '"]');
      if (!cur) return;
      component._mjs_mods[key] = cur;
    }
  }
  if (Comp == null || Comp === false || Comp === '') {
    µ._mjs_dynMask(cur);
    return;
  }
  var nn = null;
  if (typeof Comp === 'string') {
    // cf. commentaire jumeau sur µ._updDynEl ci-dessus : une SEULE valeur trimmée
    // pour la comparaison, la création ET le message.
    var compStr = Comp.trim();
    // épurée VIDE (espaces seuls) : même garde que la forme falsy brute, sinon
    // document.createElement('') lève plus loin.
    if (compStr === '') {
      µ._mjs_dynMask(cur);
      return;
    }
    // Déjà monté sur ce tag ? → ne pas recréer (préserve l'état du composant), les props suivent.
    var balise = µ._mjs_modTag(compStr);
    if (cur.tagName === balise.toUpperCase()) return µ._mjs_modKeep(cur, props, attrs);
    // SÉCURITÉ — même garde que µ._updDynEl : accept ABSENT → pool `µ._mjs_dynTagsRefuses` seul
    // refuse ; accept PRÉSENT → liste FERMÉE, seuls les noms qu'elle contient sont créés, pool ou
    // pas.
    var norm = compStr.toLowerCase();
    var hasAccept  = typeof accept === 'string' || Array.isArray(accept);
    var acceptNorm = µ._mjs_dynAcceptList(accept);
    var refusePool = !hasAccept && µ._mjs_dynTagsRefuses.indexOf(norm) !== -1;
    // le nom tapé OU la balise créée : `accept="tuto-ca"` et `accept="mjs-tuto-ca"` valent la même chose
    var tag        = balise.toLowerCase();
    var refuseList = hasAccept && acceptNorm.indexOf(norm) === -1 && acceptNorm.indexOf(tag) === -1 && !(tag.slice(0, 4) === 'mjs-' && acceptNorm.indexOf(tag.slice(4)) !== -1);
    if (refusePool) {
      return µ.warn(µ._mjs_msg('dynRefused', { norm: norm }, '<@element>/<@module> : balise « {norm} » refusée — un élément dynamique ne peut pas devenir {norm} ; pour l\'autoriser explicitement : accept="{norm}".'));
    }
    if (refuseList) {
      return µ.warn(µ._mjs_msg('dynNotListed', { norm: norm, list: acceptNorm.join(' ') }, '<@element>/<@module> : balise « {norm} » refusée — hors de la liste accept="{list}" ; quand accept est présent, seuls les noms qu\'il liste sont créés.'));
    }
    nn = document.createElement(balise);
  } else if (typeof Comp === 'function') {
    // Déjà cette classe ? → ne pas recréer.
    if (cur.constructor === Comp) return µ._mjs_modKeep(cur, props, attrs);
    try { nn = new Comp(); }
    catch {
      return µ.warn(µ._mjs_msg('dynInstance', null, '<@module> : impossible d\'instancier le composant. Passez le NOM de tag (chaîne kebab du custom element) plutôt que la classe.'));
    }
  } else {
    return;
  }
  // cf. commentaire jumeau sur µ._updDynEl ci-dessus : retire NOTRE masque avant
  // de copier les attributs, qu'il s'agisse d'un tag ou d'une classe. Seulement si
  // NOUS avions masqué.
  µ._mjs_dynUnmask(cur);
  var i, a = cur.attributes, ha = cur._mjs_ha;
  for (i = 0; i < a.length; i++) {
    // un attribut global posé par sa prop (µ._mjs_modGlob) ne suit pas : il se repose selon le composant neuf, qui peut garder la prop pour lui
    if (a[i].name !== 'mjs-mod' && !(ha && a[i].name in ha)) nn.setAttribute(a[i].name, a[i].value);
  }
  // <etale-classe>
  // la classe qu'un étalement pose sur le composant (µ._mjs_spCls) et les autres clés qu'il y pose comme attributs viennent de suivre avec
  // les attributs : sa part de la classe et ses relevés aussi, pour que l'étalement qui change ou perd une clé ne retire, sur le composant
  // neuf, que ce qu'il avait apporté, et qu'une clé qui quitte l'objet quitte le composant neuf
  if (_mjs_spCk.has(cur)) _mjs_spCk.set(nn, _mjs_spCk.get(cur));
  nn._mjs_spm = cur._mjs_spm;
  nn._mjs_spk = cur._mjs_spk;
  // </etale-classe>
  // cf. commentaire jumeau sur µ._updDynEl ci-dessus : filet explicite pour `style`.
  // cf. commentaire jumeau sur µ._updDynEl ci-dessus : garde `cssText` non vide (régression,
  // `style=""` parasite).
  if (cur.style && cur.style.cssText) nn.style.cssText = cur.style.cssText;
  µ._mjs_modAttrs(nn, attrs);
  µ._mjs_modProps(nn, props);
  while (cur.firstChild) nn.appendChild(cur.firstChild);
  // cf. commentaire jumeau sur µ._updDynEl ci-dessus : le routage des événements suit la balise neuve
  µ._mjs_evCopy(cur, nn);
  // et les rangs de sa ligne, pris sur la tête (cf. _mjsModRangs) : sans eux, un clic sur le composant neuf agissait sur la première ligne
  if (refs && node) _mjsModRangs(node, nn);
  // cf. commentaire jumeau sur µ._updDynEl ci-dessus : transfère l'entrée `.once` déjà
  // déclenchée vers le nouveau nœud.
  var onceMap = component._mjs_once_fired; if (onceMap && onceMap.has(cur)) onceMap.set(nn, onceMap.get(cur));
  µ._mjs_swap(cur, nn);
  if (component._mjs_mods) component._mjs_mods[key] = nn;
  var tete = cur._mjs_modOrig || cur;
  tete._mjs_modLive = nn;
  nn._mjs_modOrig   = tete;
  var ent = refs && refs._mjs_en, ns = ent && ent.nodes;
  if (ns) {
    for (var j = 0; j < ns.length; j++) { if (ns[j] === cur) ns[j] = nn; }
  }
  // cf. commentaire jumeau sur µ._updDynEl ci-dessus : resynchronise `component._mjs_nodes`
  // vers le nouveau nœud.
  if (component._mjs_nodes) {
    for (var k in component._mjs_nodes) { if (component._mjs_nodes[k] === cur) component._mjs_nodes[k] = nn; }
  }
};
// </module-dynamique>
