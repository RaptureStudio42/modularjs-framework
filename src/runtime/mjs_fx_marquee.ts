// mjs_fx_marquee — `*marquee` : le contenu de la balise défile sans fin, en boucle continue.
// TEXTE (une balise dont le contenu est du texte : du texte nu, avec ou sans balises en ligne dedans — `<b>`,
// `<a>`, `<span>`, `<br>`, `<code>`… — et ni `drag`, ni `on: scroll`, ni `axis: both`) : le texte défile sur un
// calque posé par-dessus le texte, qui reste en place (et donne la hauteur). Dans le calque, une piste
// porte deux copies du texte et défile d'une copie par tour : la marge intérieure de la balise reste au
// calque, le tour ne la compte pas (la seconde copie finit là où la première partait). Une balise en
// ligne passe en `inline-block` le temps de l'effet : le défilé reste dans sa boîte. « Réduire les
// animations » : la piste ne bouge plus, seule la première copie du texte reste. Au repos (`on` autre
// que always, ou un tour fini) : seule la première copie se voit, la seconde n'apparaît que pendant le
// défilement.
// ENFANTS : une balise qui n'a QUE des éléments pour enfants (des images, des cartes : aucun texte nu qui ne
// soit blanc) fait défiler ces enfants-là, les vrais (leurs clics, leurs liaisons restent), rangés par une
// piste dans la balise : une ligne, une colonne, ou des lignes qui reviennent à la ligne (`axis: both`),
// séparés par `gap`. Ils sont recopiés autant de fois qu'il faut pour couvrir la balise plus un tour (un de
// plus quand la main s'ajoute à la dérive : la piste va alors jusqu'à deux tours) ; une balise sans rien à
// recopier n'a pas de copie. Les copies sont de vraies copies, qu'on touche comme
// l'original : la copie d'un composant ModularJS est son miroir vivant (mjs_clone.ts : une instance qui partage l'état de l'original, montée et scriptée, qui se
// dessine elle-même) ; le reste est recopié balise par balise et suit, une fois par image, ce qui change dans les nœuds d'origine, les feuilles collées par
// µ.adoptSheet dans l'ombre d'un composant (même avant la première piste), la saisie dans un champ, un bouton radio que le choix d'un autre décoche et la remise à
// zéro d'un formulaire. Une balise recopiée porte les identifiants de routage de l'original : le composant qui l'a écrite y joue les mêmes gestionnaires, sur la
// copie ; la saisie dans un champ recopié est rendue à l'original. Rien n'y est fermé (ni `inert`, ni `aria-hidden`) : la tabulation, la lecture d'écran, le
// survol, la sélection y passent. Sans marque d'effet, sans gestionnaire en ligne ni zone éditable ; un identifiant cité dans la bande y est propre à chaque copie
// (ses références le suivent), un autre n'y est pas ; un champ que son formulaire n'accompagne pas dans la copie n'a ni nom ni obligation, et le miroir d'un
// composant associé au formulaire en sort (ni l'un ni l'autre ne part deux fois avec le formulaire de l'original) ; elles suivent aussi l'ajout et le retrait des enfants. La grille ou le flex de la balise ne s'applique plus à eux (la piste les range) ; la balise garde
// sa taille : la piste déborde, la balise la rogne. Du texte nu dans la balise en fait un texte, balises en
// ligne dedans ou non : il garde le calque, sauf si on lui demande `drag`, `on: scroll` ou `axis: both` (il
// passe alors par la piste). Ce que la balise reçoit après la pose (un script ajoute des balises, ou du texte, à côté de la piste) rejoint la piste,
// avant ses enfants si cela arrive avant elle, après sinon : la piste ne se refait pas, ses copies se recalculent. Vidée d'un coup (`innerHTML`, `replaceChildren`, `textContent`), la balise perd sa piste
// avec ses enfants : elle se remonte avec ce qu'elle contient alors, comme si elle l'avait eu à la pose (des balises défilent, un texte passe par la piste ou reprend le calque, rien : une piste vide prête à recevoir).
// Une balise relue puis réécrite (`innerHTML +=`) reçoit un clone de sa piste : il est défait, ses enfants d'origine reprennent leur place avant la remontée, ses copies partent. Ce que d'autres effets posent dans la balise (leur calque `mjs-fx-layer`, la toile de *heatmap, la goutte de *goo, la scène de *react, la bande et le voile de *offline, le squelette d'attente d'un composant vide) reste à sa place, hors de la piste. Un texte réécrit sur le calque (`unit: child`) retrouve son calque.
// La piste se déplace par UNE `translate`. Sans rien pour la commander, c'est l'animation CSS
// d'aujourd'hui (un tour par `speed`, au compositeur) ; `drag` et `on: scroll` y ajoutent un décalage
// tenu par une seule boucle, qui ne tourne que pendant le geste, l'élan ou le défilement et se ramène
// dans ]-tour, 0] par un modulo (la copie suivante est alors exactement à la place de la première : aucun
// saut à la couture). Hors écran, rien ne tourne : le défilement n'est plus écouté, la dérive est
// suspendue. « Réduire les animations » : ni dérive ni élan ; `drag` et `on: scroll` restent (c'est le
// lecteur qui commande).
// Réglages : speed (un tour ; 12s — avec `on: scroll`, un rapport : un tour pour 100 px de défilement
// par seconde de `speed`, 12s = 1 200 px), direction (left, right, up, down : le sens du défilé, ou
// celui de la piste quand la page descend ; left — up et down font monter ou descendre les lignes dans
// la hauteur de la balise), gap (espace entre deux enfants, et entre deux passages, en px ; 32), pause
// (s'arrête au survol), on (always, hover, view, click, load, scroll : la piste avance avec le
// défilement de la page, et recule quand on remonte), drag (on tire la piste à la souris ou au doigt :
// elle garde son élan puis reprend son allure ; un clic de moins de 5 px reste un clic sur l'enfant
// visé ; false), axis (auto : le sens de `direction` ; both : une nappe sans bord dans les deux sens, le
// contenu répété en damier, qui ne bouge que tirée ou, au défilement, en hauteur ; `drag` y est mis
// d'office ; auto), reverse (avec `on: scroll` : va dans l'autre sens que `direction` ; false).

// Sections marquées (`// @@ …`, filtrées par le build, bundler/fx-sections.ts) : `drag` (la main), `axis: both` (la nappe), `on: scroll` (le
// défilement), `reverse`, `direction: up | down`, `pause` et `gap` ne partent que si l'appli écrit le réglage ; tel quel, le fichier porte tout.
// Le mode « balises » (la piste des enfants : copies, mesures, observateurs, et leurs règles CSS) ne part que si une pose de l'appli le demande :
// par `unit: child` (le compilateur l'écrit lui-même quand la balise peut recevoir des balises : des éléments seuls pour enfants, `{for}`, `<slot>`, un
// composant, du HTML inséré tel quel ; une balise qu'un script remplira l'écrit à la main), ou par un réglage qui s'appuie sur la piste (`drag`,
// `axis: both`, `on: scroll`) : ces sections portent l'étiquette `unit=child drag=true axis=both on=scroll`. Ce que fait `*marquee` sans rien écrire
// sur un texte, c'est le texte et ses deux copies et la dérive suspendue hors de l'écran, rien d'autre. Un script qui remplit de balises une balise qui
// ne les demande pas ne fait rien défiler en production ; le développement le dit, une fois par balise (section `dev` : aucun réglage ne porte ce
// nom, aucune page ne la demande, seul le fichier entier du développement l'embarque). Les drapeaux `both`, `hand`, `scroll` et `needs` se déclarent dans la plus
// large des sections de la main, du défilement et de la nappe.

// @@ unit=child drag=true axis=both on=scroll
var _MJS_FX_MARQUEE_BOX  = '[mjs-fx~="marquee"][mjs-fx-marquee-strip]';
var _MJS_FX_MARQUEE_RUN  = _MJS_FX_MARQUEE_BOX + ' > [mjs-fx-marquee-run]';
var _MJS_FX_MARQUEE_COPY = _MJS_FX_MARQUEE_RUN + ' > [mjs-fx-marquee-copy]';
// @@

// @@ drag=true axis=both on=scroll
// la position `u` d'un décalage (px, positif vers la droite ou le bas), ramenée dans ]-tour, 0] : la
// piste porte des copies à 0, tour, 2 tours… — à -tour, elle est exactement où elle était à 0
function _mjsFxMarqueeWrap(u, tour) {
  if (!(tour > 0)) return 0;
  var m = u % tour;
  if (m > 0) m -= tour;
  return m === 0 ? 0 : m;
}
// @@

// @@ unit=child drag=true axis=both on=scroll
// ce que d'autres effets posent dans leur balise : leur calque (`mjs-fx-layer`, celui de presque tous), la toile de *heatmap, la goutte de *goo, la scène de *react, la bande et le voile de *offline, le squelette d'attente d'un composant vide
var _MJS_FX_MARQUEE_APART = '[mjs-fx-layer],[mjs-fx-heatmap-layer],[mjs-fx-goo-drop],[mjs-fx-react-stage],[mjs-fx-offline-band],[mjs-fx-offline-veil],[mjs-skel-zone]';

// les nœuds propres de la balise : tous, sauf ce que d'autres effets y posent
function _mjsFxMarqueeOwn(el) {
  var out = [];
  for (var c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && µ._mjs_dom.matches(c, _MJS_FX_MARQUEE_APART)) continue;
    out.push(c);
  }
  return out;
}

// ce qui se recopie : les nœuds sauf un commentaire ou un texte blanc ; une balise qui n'en a pas n'a rien à défiler
function _mjsFxMarqueeKept(nodes) {
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeType === 8 || (nodes[i].nodeType === 3 && nodes[i].textContent.trim() === '')) continue;
    out.push(nodes[i]);
  }
  return out;
}

// des enfants à défiler : des éléments et rien d'autre (aucun texte nu qui ne soit blanc) ; un texte avec ses balises en ligne reste un texte
function _mjsFxMarqueeKids(nodes) {
  var kept = _mjsFxMarqueeKept(nodes);
  for (var i = 0; i < kept.length; i++) {
    if (kept[i].nodeType !== 1) return false;
  }
  return kept.length > 0;
}

// un nœud change de parent sans être déconnecté quand le navigateur sait le déplacer (`moveBefore` : un
// composant enfant garde son état), sinon par `insertBefore`
function _mjsFxMarqueeMove(parent, node, before) {
  if (typeof parent.moveBefore === 'function') {
    try {
      parent.moveBefore(node, before);
      return;
    }
    catch {}
  }
  µ._mjs_dom.insertBefore(parent, node, before);
}

// `innerHTML +=` relit la balise (la piste et ses copies comprises) puis la réécrit : elle reçoit un clone de sa piste, que la piste neuve rangerait tel quel (ses balises empilées, rognées). Un clone de piste n'est qu'une
// enveloppe, reconnue à la marque que l'effet pose sur sa piste : ses enfants d'origine reprennent sa place dans la balise, dans l'ordre, ses copies partent avec elle
function _mjsFxMarqueeUnwrap(el) {
  Array.prototype.slice.call(el.children).forEach(function(run) {
    if (!µ._mjs_dom.hasAttribute(run, 'mjs-fx-marquee-run')) return;
    Array.prototype.slice.call(run.childNodes).forEach(function(n) {
      if (!(n.nodeType === 1 && µ._mjs_dom.hasAttribute(n, 'mjs-fx-marquee-copy'))) _mjsFxMarqueeMove(el, n, run);
    });
    µ._mjs_dom.remove(run);
  });
}

// ce que suit l'observateur des enfants d'origine : leurs nœuds, leur texte et leurs attributs (pas l'ombre d'un composant : son miroir se dessine lui-même)
var _MJS_FX_MARQUEE_WATCH = { childList: true, characterData: true, subtree: true, attributes: true };

// une feuille collée par µ.adoptSheet dans l'ombre d'un original, ou retirée, ne change aucun nœud : l'outil (mjs_adopt_sheet.ts) le dit ici, à chaque
// fois, et la bande qui tient la balise le suit ; posé au chargement, il entend aussi une feuille collée avant la première piste puis retirée
µ._mjs_sheetMoved = function(el) {
  for (var n = el; n; n = n.parentNode || n.host) {
    if (n._mjs_mqTouch) return n._mjs_mqTouch(el);
  }
};

// ce qu'un miroir montre d'un nœud d'origine : le texte et les éléments ; ni un commentaire, ni le calque d'un autre effet, ni un composant dont le module
// n'est pas encore arrivé (sa copie deviendrait à sa définition une instance à part, sans l'état de l'original : son miroir vient avec lui)
function _mjsFxMarqueeShown(n) {
  if (n.nodeType === 3) return true;
  if (n.nodeType !== 1 || µ._mjs_dom.hasAttribute(n, 'mjs-fx-layer')) return false;
  return !(n.localName.slice(0, 4) === 'mjs-' && window.customElements && !window.customElements.get(n.localName));
}

// les attributs qui citent une autre balise par son identifiant : l'étiquette d'un champ, le formulaire et la liste de choix d'un champ, les titres d'une case
// de tableau, les liens de l'accessibilité
var _MJS_FX_MARQUEE_REFS = ['for', 'form', 'list', 'headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto'];

// les identifiants que les enfants d'origine se citent entre eux (un `<label for>` et son champ, un champ et sa description…), relus à chaque mise à jour des
// copies : dans une copie, chacun devient propre à la copie (`<id>-mjs-copy-<rang de la copie>`, unique dans la page) et les références de la copie le
// suivent — l'étiquette d'une copie nomme et sert le champ de sa copie ; un identifiant que rien ne cite n'est pas recopié, une référence à une balise hors de
// la bande reste telle quelle
function _mjsFxMarqueeIds(src) {
  var has   = Object.create(null);
  var cited = Object.create(null);
  var ids   = Object.create(null);
  var sel   = '[id],[' + _MJS_FX_MARQUEE_REFS.join('],[') + ']';
  var all, i, j, k, w, t, v;
  for (i = 0; i < src.length; i++) {
    if (src[i].nodeType !== 1) continue;
    all = [src[i]].concat(Array.prototype.slice.call(µ._mjs_dom.querySelectorAll(src[i], sel)));
    for (j = 0; j < all.length; j++) {
      v = µ._mjs_dom.getAttribute(all[j], 'id');
      if (v) has[v] = true;
      for (k = 0; k < _MJS_FX_MARQUEE_REFS.length; k++) {
        t = (µ._mjs_dom.getAttribute(all[j], _MJS_FX_MARQUEE_REFS[k]) || '').split(/\s+/);
        for (w = 0; w < t.length; w++) {
          if (t[w]) cited[t[w]] = true;
        }
      }
    }
  }
  for (v in cited) {
    if (has[v]) ids[v] = true;
  }
  return ids;
}

// les attributs d'une copie : ceux de l'original, sauf ce qui ne peut pas être deux fois dans la page ou y ferait de soi-même deux fois la même chose — ni
// marque d'effet, ni gestionnaire en ligne (`onclick`…, ceux d'une animation SVG aussi : `onbegin`, `onend`, `onrepeat` ; un vrai : `online` reste), ni zone
// éditable (ce qu'on y écrirait ne serait pas rendu à l'original), ni focus pris de lui-même (`autofocus`, `accesskey`). Un identifiant cité dans la bande
// (cf. `_mjsFxMarqueeIds` : `run._mjs_mqIds`, et `run._mjs_mqN` le rang de la copie qu'on met à jour) y est propre à la copie, et les références de la copie le
// suivent ; un autre n'y est pas. Un champ que son formulaire n'accompagne pas dans la copie (la bande est dans le formulaire ; un bouton radio sans
// formulaire serait du groupe de l'original ; un formulaire de la bande qui le contient ou qu'il désigne par `form` l'accompagne) n'a ni nom, ni formulaire
// désigné, ni obligation : il ne part pas avec le formulaire de l'original et ne le retient pas. Le miroir d'un composant associé au formulaire
// (`@formAssociated`, les modules de saisie du cœur) garde son nom et son obligation, des props de l'état commun, et en sort par `form=""`, qui ne désigne
// aucun formulaire : le champ caché d'un module du cœur le reprend de sa balise (µ._mjs_formField). Le reste garde ses attributs : un formulaire recopié et
// ses champs (un vrai formulaire), un bouton, un lien et sa confirmation (`mjs-confirm`, `mjs-method`), une icône lue par son `name`, un `<slot name>` (la
// copie, posée après l'original, ne reçoit rien)
function _mjsFxMarqueeAttrs(m, o, run) {
  var want  = Object.create(null);
  var names = typeof o.getAttributeNames === 'function' ? o.getAttributeNames() : [];
  var ids   = run._mjs_mqIds;
  var tail  = '-mjs-copy-' + run._mjs_mqN;
  var face  = o.constructor.formAssociated === true;
  var f     = µ._mjs_dom.getAttribute(o, 'form');
  var lone  = (face || (/^(?:input|select|textarea)$/.test(o.localName) && !/^(?:submit|image|reset|button)$/.test(o.type))) && (o.form ? !(µ._mjs_dom.contains(run, o.form) && (µ._mjs_dom.contains(o.form, o) || (f !== null && ids[f] === true))) : o.type === 'radio');
  var j, a, v;
  for (j = 0; j < names.length; j++) {
    a = names[j];
    v = µ._mjs_dom.getAttribute(o, a);
    if ((a === 'id' && ids[v] !== true) || a === 'contenteditable' || a === 'autofocus' || a === 'accesskey' || a.slice(0, 6) === 'mjs-fx' || (a.slice(0, 2) === 'on' && (a in document.documentElement || /^on(?:begin|end|repeat)$/.test(a))) || (lone && (a === 'form' || (!face && (a === 'name' || a === 'required'))))) continue;
    if (a === 'id') v += tail;
    else if (_MJS_FX_MARQUEE_REFS.indexOf(a) >= 0) v = v.replace(/\S+/g, function(x) { return ids[x] === true ? x + tail : x; });
    want[a] = v;
  }
  if (lone && face) want.form = '';
  names = m.getAttributeNames();
  for (j = 0; j < names.length; j++) {
    if (!(names[j] in want)) µ._mjs_dom.removeAttribute(m, names[j]);
  }
  for (a in want) {
    if (µ._mjs_dom.getAttribute(m, a) !== want[a]) µ._mjs_dom.setAttribute(m, a, want[a]);
  }
}

// la copie d'un nœud d'origine : d'un composant ModularJS, son miroir vivant (sa balise seule : son contenu glissé est recopié ici, un composant glissé y est
// lui aussi un miroir) ; du reste, sa balise. Elle connaît l'original
function _mjsFxMarqueeMirror(o, run) {
  var m = o instanceof µ.Element ? µ._mjs_mirrorOf(o, true) : µ._mjs_dom.cloneNode(o, false);
  m._mjs_mq = o;
  _mjsFxMarqueePatch(m, o, run);
  return m;
}

// la copie montre ce que montre l'original : son texte, ses attributs, ses enfants, la valeur d'un champ ; elle porte ses identifiants de routage (`_mjs_ids`,
// `_mjs_eo` : le composant qui a écrit la balise y joue ses gestionnaires) et, dans une liste, le rang de sa ligne (`_mjs_idx_<n>`, que lit le gestionnaire ;
// quatre listes imbriquées au plus) — des noms que la construction de production raccourcit, écrits ici en toutes lettres.
// Un miroir se dessine lui-même : il prend les feuilles collées par µ.adoptSheet dans l'ombre de l'original (marquées `_mjs_keep`) à la place des siennes ;
// un composant léger (`mjs-light`) se dessine dans ses enfants, rien à y recopier
function _mjsFxMarqueePatch(m, o, run) {
  if (o.nodeType !== 1) {
    if (m.data !== o.data) m.data = o.data;
    return;
  }
  _mjsFxMarqueeAttrs(m, o, run);
  m._mjs_ids   = o._mjs_ids;
  m._mjs_eo    = o._mjs_eo;
  m._mjs_idx_0 = o._mjs_idx_0;
  m._mjs_idx_1 = o._mjs_idx_1;
  m._mjs_idx_2 = o._mjs_idx_2;
  m._mjs_idx_3 = o._mjs_idx_3;
  var r = o instanceof µ.Element ? o._shadow : null;
  if (r && r !== o) {
    var had = m._shadow && m._shadow.adoptedStyleSheets;
    var got = r.adoptedStyleSheets;
    if (had && got) {
      var want = had.filter(function(x) { return !x._mjs_keep; }).concat(got.filter(function(x) { return x._mjs_keep; }));
      if (want.length !== had.length || want.some(function(x, i) { return x !== had[i]; })) m._shadow.adoptedStyleSheets = want;
    }
  }
  if (r !== o) _mjsFxMarqueeSync(m, o.childNodes, run);
  if (/^(?:input|select|textarea)$/.test(o.localName) && o.type !== 'file') _mjsFxMarqueeValue(m, o);
}

// la valeur d'un champ passe à un autre (de l'original à sa copie, du champ saisi dans une copie à l'original) : celle d'une liste à choix multiples option
// par option, puis la case cochée
function _mjsFxMarqueeValue(to, from) {
  if (from.multiple && from.options) {
    for (var i = 0; i < from.options.length; i++) {
      if (to.options[i] && to.options[i].selected !== from.options[i].selected) to.options[i].selected = from.options[i].selected;
    }
  }
  else if (to.value !== from.value) to.value = from.value;
  if (to.checked !== from.checked) to.checked = from.checked;
}

// les enfants d'une copie suivent ceux de l'original, dans l'ordre : une copie déjà là se met à jour, un nœud neuf reçoit la sienne, ce qui n'a plus
// d'original part
function _mjsFxMarqueeSync(parent, nodes, run) {
  var at = parent.firstChild;
  var o, gone;
  for (var i = 0; i < nodes.length; i++) {
    o = nodes[i];
    if (!_mjsFxMarqueeShown(o)) continue;
    while (at && at._mjs_mq !== o && at._mjs_mq && at._mjs_mq.parentNode !== o.parentNode) {
      gone = at;
      at   = at.nextSibling;
      µ._mjs_dom.remove(gone);
    }
    if (at && at._mjs_mq === o) {
      _mjsFxMarqueePatch(at, o, run);
      at = at.nextSibling;
    }
    else µ._mjs_dom.insertBefore(parent, _mjsFxMarqueeMirror(o, run), at);
  }
  while (at) {
    gone = at;
    at   = at.nextSibling;
    µ._mjs_dom.remove(gone);
  }
}

// un nœud d'origine a changé : dans une copie, la copie de ce nœud se met à jour, ou celle de son plus proche parent qui en a une (un nœud neuf y reçoit la
// sienne), ou la copie entière (`src` : les enfants d'origine) ; un nœud sorti de la bande, pris dans une copie ou dans une ombre, ne compte pas
function _mjsFxMarqueeReach(copy, o, run, src) {
  var path = [];
  var n, c;
  for (n = o; n !== run; n = n.parentNode) {
    if (!n || (n.nodeType === 1 && µ._mjs_dom.hasAttribute(n, 'mjs-fx-marquee-copy'))) return;
    path.push(n);
  }
  var m  = copy;
  var at = null;
  for (var i = path.length - 1; i >= 0; i--) {
    c = m.firstChild;
    while (c && c._mjs_mq !== path[i]) c = c.nextSibling;
    if (!c) break;
    m  = c;
    at = path[i];
  }
  if (at) _mjsFxMarqueePatch(m, at, run);
  else _mjsFxMarqueeSync(copy, src, run);
}

// un changement des enfants d'origine (pas une copie qu'on pose ou qu'on retire)
function _mjsFxMarqueeOwnChange(run, rec) {
  var t = rec.target;
  if (t === run) {
    var nodes = Array.prototype.slice.call(rec.addedNodes).concat(Array.prototype.slice.call(rec.removedNodes));
    for (var i = 0; i < nodes.length; i++) {
      if (!(nodes[i].nodeType === 1 && µ._mjs_dom.hasAttribute(nodes[i], 'mjs-fx-marquee-copy'))) return true;
    }
    return false;
  }
  for (var p = t.nodeType === 1 ? t : t.parentNode; p && p !== run; p = p.parentNode) {
    if (p.nodeType === 1 && µ._mjs_dom.hasAttribute(p, 'mjs-fx-marquee-copy')) return false;
  }
  return true;
}
// @@

// hors de l'écran (à 100 px près) la dérive CSS est suspendue (l'attribut `mjs-fx-marquee-away`) et reprend à l'écran ; `enter` et `leave` :
// ce que le mode y ajoute
function _mjsFxMarqueeAway(el, enter, leave) {
  return µ._mjs_fxRun(el, 'always', function() {
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-away');
    if (enter) enter();
  }, function() {
    µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-away', '');
    if (leave) leave();
  });
}

// @@ dev
// l'avertissement du développement, une fois par balise : le gabarit ne prévoyait pas de balises dans cette balise (le compilateur n'a pas écrit
// `unit: child`), un script lui en a donné, avant la pose ou après, et la production n'enverrait pas le défilé des balises. Son texte est du groupe `dev` des libellés,
// que le build de production n'écrit nulle part (ni au manifeste ni dans les messages) : seul un fichier entier le porte. Le registre des composants (`µ.instances`)
// n'existe qu'en développement : une construction de production qui embarquerait ce fichier entier reste muette. Le composant est nommé par sa balise
// et par le fichier que le manifeste connaît
var _mjsFxMarqueeTold = typeof WeakSet === 'function' ? new WeakSet() : null;
function _mjsFxMarqueeTell(el, comp) {
  if (!µ.instances) return;
  if (_mjsFxMarqueeTold) {
    if (_mjsFxMarqueeTold.has(el)) return;
    _mjsFxMarqueeTold.add(el);
  }
  var tag   = comp && comp.localName ? comp.localName : '';
  var file  = tag && typeof µ.pathOf === 'function' ? µ.pathOf(tag.replace(/^mjs-/, '')) : '';
  var where = tag ? ' [<' + tag + '>' + (file ? ' ' + file : '') + ']' : '';
  µ.warn(µ._mjs_msg('dev.marqueeKids', { where: where }, '*marquee{where} : cette balise fait défiler des balises que le compilateur n\'a pas vues dans le gabarit (un script les a ajoutées, le plus souvent). En production, le défilé des balises n\'est envoyé que si une pose de l\'application le demande : celle-ci ne le demande pas, ces balises ne défileront pas à moins qu\'une autre pose ne le fasse envoyer. Écrivez *marquee(unit: child) pour le demander.'), el);
}
// @@

µ._mjs_fxDefs.marquee = {
  css: '[mjs-fx~="marquee"]{overflow:hidden;white-space:nowrap}'
    + '[mjs-fx~="marquee"] [mjs-fx-marquee-track]{display:flex;width:max-content;animation:var(--mjs-fx-marquee-go,mjs-fx-marquee) var(--mjs-marquee-speed,12s) linear 0s var(--mjs-fx-marquee-times,infinite) var(--mjs-fx-marquee-dir,normal)}'
    + '[mjs-fx~="marquee"] [mjs-fx-marquee-track] > span{padding-right:var(--mjs-marquee-gap,32px)}'
    // au repos (pas d'animation : `on: hover | view | click`, un tour fini) seule la première copie se voit : la seconde, transparente, n'est montrée que
    // par sa propre animation, calée sur celle de la piste (la piste ne porte que `transform`, que le navigateur anime sans le fil principal)
    + '[mjs-fx~="marquee"] [mjs-fx-marquee-track] > span + span{opacity:0;animation:var(--mjs-fx-marquee-go,mjs-fx-marquee-copy) var(--mjs-marquee-speed,12s) linear 0s var(--mjs-fx-marquee-times,infinite)}'
    // @@ direction=up,down
    + '[mjs-fx~="marquee"][mjs-fx-marquee-axis="y"] [mjs-fx-marquee-track]{flex-direction:column;width:auto;animation-name:var(--mjs-fx-marquee-go,mjs-fx-marquee-y)}'
    + '[mjs-fx~="marquee"][mjs-fx-marquee-axis="y"] [mjs-fx-marquee-track] > span{padding-right:0;padding-bottom:var(--mjs-marquee-gap,32px)}'
    // @@
    + '[mjs-fx~="marquee"][mjs-fx-marquee-pause]:hover [mjs-fx-marquee-track]{animation-play-state:paused}' // @@ pause
    + '[mjs-fx~="marquee"][mjs-fx-marquee-away] [mjs-fx-marquee-track],[mjs-fx~="marquee"][mjs-fx-marquee-away] [mjs-fx-marquee-track] > span + span{animation-play-state:paused}'
    + '@keyframes mjs-fx-marquee{to{transform:translateX(-50%)}}'
    + '@keyframes mjs-fx-marquee-y{to{transform:translateY(-50%)}}' // @@ direction=up,down
    + '@keyframes mjs-fx-marquee-copy{from,to{opacity:1}}'
    // @@ unit=child drag=true axis=both on=scroll
    // la piste des enfants : une ligne (une colonne pour up et down, des lignes qui reviennent à la ligne pour both) des vrais enfants, les
    // copies posées par-dessus, chacune décalée d'un tour (`translate` posé une fois) ; sa dérive est l'animation d'un tour (la taille du tour
    // est lue une fois et tenue dans `--mjs-fx-marquee-tour`) ; le texte des enfants reprend son retour à la ligne
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-strip="kids"]{white-space:normal}'
    + _MJS_FX_MARQUEE_RUN + ',' + _MJS_FX_MARQUEE_COPY + '{display:flex;gap:var(--mjs-marquee-gap,32px);align-items:center}'
    + _MJS_FX_MARQUEE_RUN + '{position:relative;flex:none;width:max-content;animation:var(--mjs-fx-marquee-go,mjs-fx-marquee-run) var(--mjs-marquee-speed,12s) linear 0s var(--mjs-fx-marquee-times,infinite) var(--mjs-fx-marquee-dir,normal)}'
    + _MJS_FX_MARQUEE_RUN + ' > *{flex:none}'
    + _MJS_FX_MARQUEE_COPY + '{position:absolute;top:0;left:0;width:100%}'
    // @@ direction=up,down
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-axis="y"] > [mjs-fx-marquee-run],' + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-axis="y"] > [mjs-fx-marquee-run] > [mjs-fx-marquee-copy]{flex-direction:column;align-items:stretch}'
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-axis="y"] > [mjs-fx-marquee-run]{width:auto;animation-name:var(--mjs-fx-marquee-go,mjs-fx-marquee-run-y)}'
    // @@
    // @@ axis=both
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-axis="both"] > [mjs-fx-marquee-run],' + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-axis="both"] > [mjs-fx-marquee-run] > [mjs-fx-marquee-copy]{flex-wrap:wrap}'
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-axis="both"] > [mjs-fx-marquee-run]{width:auto}'
    // @@
    // @@ on=scroll axis=both
    // la piste que le lecteur seul commande (défilement, nappe) n'a pas de dérive
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-still] > [mjs-fx-marquee-run]{animation:none}'
    // @@
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-away] > [mjs-fx-marquee-run]{animation-play-state:paused}'
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-pause]:hover > [mjs-fx-marquee-run]{animation-play-state:paused}' // @@ pause
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-held] > [mjs-fx-marquee-run]{animation-play-state:paused}' // @@ drag=true axis=both
    // @@ drag=true axis=both
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-drag]{cursor:grab;touch-action:pan-y;-webkit-user-select:none;user-select:none}'
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-drag][mjs-fx-marquee-axis="y"]{touch-action:pan-x}' // @@ direction=up,down
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-drag][mjs-fx-marquee-axis="both"]{touch-action:none}' // @@ axis=both
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-drag][mjs-fx-marquee-held]{cursor:grabbing}'
    // @@
    + '@keyframes mjs-fx-marquee-run{to{transform:translateX(calc(-1 * var(--mjs-fx-marquee-tour,0px)))}}'
    + '@keyframes mjs-fx-marquee-run-y{to{transform:translateY(calc(-1 * var(--mjs-fx-marquee-tour,0px)))}}' // @@ direction=up,down
    // @@
    // « réduire les animations » : la piste ne bouge plus, la seconde copie du texte (celle que le défilé amenait) est cachée ; les copies des
    // enfants aussi, sauf si le lecteur commande la piste (`drag`, `on: scroll`) : elles bouchent la couture
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="marquee"] [mjs-fx-marquee-track][mjs-fx-marquee-track]{animation:none}[mjs-fx~="marquee"] [mjs-fx-marquee-track] > span + span{display:none}'
    // @@ unit=child drag=true axis=both on=scroll
    + _MJS_FX_MARQUEE_BOX + '[mjs-fx-marquee-strip] > [mjs-fx-marquee-run][mjs-fx-marquee-run]{animation:none}'
    + '[mjs-fx~="marquee"]:not([mjs-fx-marquee-drive]) > [mjs-fx-marquee-run] > [mjs-fx-marquee-copy]{display:none}'
    // @@
    + '}',
  vars: { speed: '', gap: 'px' },
  setup: function(el, s, comp) {
    var vertical = s.direction === 'up' || s.direction === 'down'; // @@ unit=child drag=true axis=both on=scroll direction=up,down
    var ax       = !vertical; // @@ unit=child drag=true axis=both on=scroll
    var ay       = vertical; // @@ unit=child drag=true axis=both on=scroll
    var needs    = false; // @@ unit=child drag=true axis=both on=scroll
    var extra    = 0; // @@ unit=child drag=true axis=both on=scroll
    var stopMode = null;
    var ctl; // @@ drag=true axis=both on=scroll gap
    // @@ drag=true axis=both on=scroll
    var both     = s.axis === 'both';
    var hand     = s.drag === true || both;
    var scroll   = s.on === 'scroll';
    // la main (jusqu'à -1 tour) s'ajoute à la dérive CSS (jusqu'à -1 tour) : la piste va jusqu'à -2 tours, un tour de plus à couvrir
    needs        = hand || scroll;
    extra        = hand && !scroll && !both ? 1 : 0;
    ax           = !vertical || both;
    ay           = vertical || both;
    // @@
    var speedMs  = µ._mjs_fxMs(s.speed, 12000); // @@ on=scroll
    var rev      = s.reverse === true; // @@ on=scroll
    if (s.direction === 'right' || s.direction === 'down') el.style.setProperty('--mjs-fx-marquee-dir', 'reverse');
    if (vertical) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-axis', 'y'); // @@ direction=up,down
    if (both) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-axis', 'both'); // @@ axis=both
    if (s.pause) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-pause', ''); // @@ pause
    var inline = µ._mjs_fxMovable(el);
    var kids   = function() { return _mjsFxMarqueeKids(_mjsFxMarqueeOwn(el)); }; // @@ unit=child drag=true axis=both on=scroll
    var mount;
    var swap; // @@ unit=child drag=true axis=both on=scroll

    // le texte seul : le calque et sa piste de deux copies — rien n'a changé
    var layerSetup = function() {
      var tx = µ._mjs_fxLayer(comp, el, function(l, txt) {
        // la piste : les deux copies et rien d'autre, sa moitié (-50 %) vaut une copie et son écart
        var track = document.createElement('span');
        track.setAttribute('mjs-fx-marquee-track', '');
        for (var i = 0; i < 2; i++) {
          var part = document.createElement('span');
          part.textContent = txt.trim();
          track.appendChild(part);
        }
        l.appendChild(track);
      }, true);
      // @@ unit=child drag=true axis=both on=scroll
      // des enfants qui arrivent après la pose (une liste qui se remplit) : la balise passe à la piste. Un texte réécrit par un script (`textContent`, `innerHTML`, `innerHTML +=`) emporte le calque avec le reste, ou n'en laisse qu'une copie
      // relue, figée : le calque revient (le moteur a déjà refait son contenu avec le texte neuf), sa copie part ; ce qui y est reconnu : un calque qui porte la piste du texte
      var mo = typeof MutationObserver === 'function' ? new MutationObserver(function() {
        if (kids()) return swap();
        if (tx.layer.parentNode === el) return;
        Array.prototype.slice.call(el.children).forEach(function(c) {
          if (µ._mjs_dom.matches(c, '[mjs-fx-layer]') && µ._mjs_dom.querySelector(c, '[mjs-fx-marquee-track]')) µ._mjs_dom.remove(c);
        });
        µ._mjs_dom.appendChild(el, tx.layer);
      }) : null;
      if (mo) mo.observe(el, { childList: true });
      // @@
      var seen = _mjsFxMarqueeAway(el);
      return function() {
        seen();
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-away');
        if (mo) mo.disconnect(); // @@ unit=child drag=true axis=both on=scroll
        tx.off();
      };
    };

    // @@ unit=child drag=true axis=both on=scroll
    // la piste des enfants : les vrais enfants dans une piste, des copies décalées d'un tour
    var stripSetup = function() {
      var own     = _mjsFxMarqueeOwn(el);
      var run     = document.createElement('span');
      var copies  = [];
      // taille du contenu (lue une fois, puis à chaque changement de taille), tour (contenu + gap), copies posées sur chaque axe
      var wx      = 0;
      var wy      = 0;
      var tx      = 0;
      var ty      = 0;
      var cx      = -1;
      var cy      = -1;
      var later   = 0;
      var dirty   = 0;
      var touched = [];
      var all     = false;
      var arrive, depart;
      // @@ drag=true axis=both on=scroll
      // décalage de la main (px), position écrite, boucle d'une image à la fois (rendez-vous, minuterie de repos, calque promu)
      var ux      = 0;
      var uy      = 0;
      var shown   = '';
      var lit     = false;
      var busy    = false;
      var raf     = 0;
      var rest    = 0;
      var g       = null;
      var frame;
      // @@
      // @@ drag=true axis=both
      // élan (px par image à 60 Hz)
      var vx      = 0;
      var vy      = 0;
      var swallow = false;
      var last    = 0;
      // @@
      var hooked  = false; // @@ on=scroll
      run.setAttribute('mjs-fx-marquee-run', '');
      µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-strip', _mjsFxMarqueeKids(own) ? 'kids' : 'text');
      if (hand) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-drag', ''); // @@ drag=true axis=both
      if (scroll || both) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-still', ''); // @@ on=scroll axis=both
      if (needs) µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-drive', ''); // @@ drag=true axis=both on=scroll
      _mjsFxMarqueeMove(el, run, own.length > 0 ? own[0] : null);
      for (var i = 0; i < own.length; i++) _mjsFxMarqueeMove(run, own[i], null);
      wx = run.offsetWidth;
      wy = run.offsetHeight;

      var originals = function() {
        var out = [];
        for (var c = run.firstChild; c; c = c.nextSibling) {
          if (!(c.nodeType === 1 && µ._mjs_dom.hasAttribute(c, 'mjs-fx-marquee-copy'))) out.push(c);
        }
        return out;
      };

      // @@ on=scroll
      // le défilement de la page et des conteneurs qui la portent (la balise peut défiler dans une boîte), lu à la demande
      var bars  = [];
      var roots = [];
      if (scroll) {
        for (var n = µ._mjs_fxParent(el); n && n.nodeType === 1; n = µ._mjs_fxParent(n)) {
          if (n === document.documentElement) continue;
          var cs = typeof getComputedStyle === 'function' ? getComputedStyle(n) : null;
          if (cs && /(auto|scroll|overlay|hidden)/.test(cs.overflowY || '')) bars.push(n);
        }
        roots = µ._mjs_fxRoots(el);
      }
      // ce défilement est lu ici, à l'arrivée, à la remesure et à l'évènement de défilement : jamais dans une image d'animation
      var offset = 0;
      var look   = function() {
        offset = window.pageYOffset || 0;
        for (var k = 0; k < bars.length; k++) offset += bars[k].scrollTop;
      };
      // @@

      // @@ drag=true axis=both on=scroll
      // la position : le décalage de la main, plus, au défilement, les tours que la page a fait faire (un tour pour 100 px par seconde de `speed`)
      var place = function() {
        var sc = 0;
        if (scroll) sc = (s.direction === 'right' || s.direction === 'down' ? 1 : -1) * (rev ? -1 : 1) * offset / (Math.max(1, speedMs) / 10); // @@ on=scroll
        ux = ax ? _mjsFxMarqueeWrap(ux, tx) : 0;
        uy = ay ? _mjsFxMarqueeWrap(uy, ty) : 0;
        var x = ax ? _mjsFxMarqueeWrap(ux + (ay ? 0 : sc * tx), tx) : 0;
        var y = ay ? _mjsFxMarqueeWrap(uy + sc * ty, ty) : 0;
        var t = x.toFixed(2) + 'px ' + y.toFixed(2) + 'px';
        if (t === shown) return;
        shown = t;
        run.style.translate = t;
      };
      // @@

      // les copies : ce qu'il faut pour couvrir la balise plus un tour, pas plus ; refaites quand un tour ou la balise change
      var build = function(force) {
        var cs  = typeof getComputedStyle === 'function' ? getComputedStyle(run) : null;
        var otx = tx;
        var oty = ty;
        // @@ axis=both
        // la nappe : les lignes se rangent à la largeur de la balise, mais le tour est la largeur des lignes (la plus avancée des bordures
        // droites), pas celle de la balise — sinon un vide reste à chaque couture
        if (both) {
          var ext = 0;
          run.style.width = '';
          for (var q = run.firstChild; q; q = q.nextSibling) {
            if (q.nodeType === 1 && !µ._mjs_dom.hasAttribute(q, 'mjs-fx-marquee-copy')) ext = Math.max(ext, q.offsetLeft + q.offsetWidth);
          }
          if (ext > 0) {
            run.style.width = ext + 'px';
            wx = ext;
            wy = run.offsetHeight;
          }
        }
        // @@
        tx = ax ? wx + (cs ? parseFloat(cs.columnGap) || 0 : 0) : 0;
        ty = ay ? wy + (cs ? parseFloat(cs.rowGap) || 0 : 0) : 0;
        // rien à défiler (une balise vide, une liste vide) ou rien à couvrir (une balise sans taille, cachée) : rien n'est posé
        var src  = _mjsFxMarqueeKept(originals());
        var need = function(box, tour) { return src.length > 0 && tour > 0 && box > 0 ? Math.min(40, Math.ceil(box / tour) + extra) : 0; };
        var nx   = need(el.clientWidth, tx);
        var ny   = need(el.clientHeight, ty);
        // @@ axis=both
        // une nappe : pas plus d'une centaine de copies
        while ((nx + 1) * (ny + 1) > 120 && nx + ny > 0) {
          if (nx >= ny) nx--;
          else ny--;
        }
        // @@
        if (!force && tx === otx && ty === oty && nx === cx && ny === cy) return;
        cx = nx;
        cy = ny;
        // les copies déjà là restent, leurs miroirs avec elles (rien n'est remonté) : à leur nouvelle place, revues entières si les enfants d'origine ont changé
        // (`force`) ou si le tour change (ce qui n'a changé aucun nœud, la valeur d'un champ posée par un script, les rejoint) ; il en vient ou il en part selon
        // le compte (les miroirs d'une copie qui part, sortis de la page, quittent le groupe de leur original). L'observateur suit la bande : le reprendre ne perd
        // rien de ce qu'il a vu
        if (mo) mo.observe(run, _MJS_FX_MARQUEE_WATCH);
        if (force) run._mjs_mqIds = _mjsFxMarqueeIds(src);
        var frag = document.createDocumentFragment();
        var k    = 0;
        var copy;
        for (var a = 0; a <= nx; a++) {
          for (var b = 0; b <= ny; b++) {
            if (a + b === 0) continue;
            copy = copies[k++];
            run._mjs_mqN = k;
            if (!copy) {
              // une copie : les enfants d'origine recopiés, qu'on touche comme eux
              copy = document.createElement('span');
              copy.setAttribute('mjs-fx-marquee-copy', '');
              _mjsFxMarqueeSync(copy, src, run);
              copies.push(copy);
              frag.appendChild(copy);
            }
            else if (force || tx !== otx || ty !== oty) _mjsFxMarqueeSync(copy, src, run);
            copy.style.translate = (a * tx).toFixed(2) + 'px ' + (b * ty).toFixed(2) + 'px';
          }
        }
        while (copies.length > k) µ._mjs_dom.remove(copies.pop());
        if (frag.firstChild) µ._mjs_dom.appendChild(run, frag);
        run.style.setProperty('--mjs-fx-marquee-tour', (vertical ? ty : tx).toFixed(2) + 'px');
        if (scroll) look(); // @@ on=scroll
        if (needs) place(); // @@ drag=true axis=both on=scroll
      };

      // @@ drag=true axis=both on=scroll
      // la boucle : un seul rendez-vous par image, qui s'arrête dès que la piste ne bouge plus ; `will-change` le temps du mouvement seulement
      var settle = function() {
        if (busy || g || raf) {
          busy = false;
          rest = setTimeout(settle, 400);
          return;
        }
        lit  = false;
        rest = 0;
        run.style.willChange = '';
      };
      var ask = function() {
        busy = true;
        if (!lit) {
          lit  = true;
          run.style.willChange = 'translate';
          rest = setTimeout(settle, 400);
        }
        if (raf) return;
        if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
        else frame(0);
      };
      frame = function(now) {
        raf = 0;
        // @@ drag=true axis=both
        var f  = last ? Math.min(4, (now - last) / 16.667) : 1;
        var go = false;
        last = now;
        // l'élan : × 0,95 par image, seulement une fois la main levée
        if (!(g && g.on)) {
          if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) {
            var k = Math.pow(0.95, f);
            ux += vx * f;
            uy += vy * f;
            vx *= k;
            vy *= k;
            go = true;
          }
          else {
            vx = 0;
            vy = 0;
          }
        }
        // @@
        place();
        // @@ drag=true axis=both
        if (go && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
        else last = 0;
        // @@
      };
      // @@

      // @@ drag=true axis=both
      // la main : `pointerdown` seul écoute au repos ; le reste n'écoute que le temps du geste. La piste n'est saisie qu'au-delà de 5 px :
      // en deçà, c'est un clic, et il va à l'enfant visé
      var move = function(e) {
        if (!g || e.pointerId !== g.id) return;
        var dx = e.clientX - g.mx;
        var dy = e.clientY - g.my;
        g.mx = e.clientX;
        g.my = e.clientY;
        if (!g.on) {
          var mx   = ax ? e.clientX - g.x : 0;
          var my   = ay ? e.clientY - g.y : 0;
          var dist = Math.sqrt(mx * mx + my * my);
          if (dist < 5) return;
          g.on = true;
          // la piste n'a pas bougé jusque-là : elle rattrape la main, à 5 px près (le seuil entre un clic et un geste)
          dx   = mx * (dist - 5) / dist;
          dy   = my * (dist - 5) / dist;
          vx   = 0;
          vy   = 0;
          try {
            µ._mjs_dom.setPointerCapture(el, e.pointerId);
          }
          catch {}
          µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-held', '');
        }
        // un mouvement sans déplacement (un navigateur en envoie un juste avant de lâcher) ne compte pas : l'arrêt se mesure depuis le dernier vrai mouvement
        if (!(ax && dx) && !(ay && dy)) return;
        var dt = Math.max(1, e.timeStamp - g.t);
        g.t = e.timeStamp;
        if (ax) {
          ux += dx;
          vx  = vx * 0.6 + dx / dt * 16.667 * 0.4;
        }
        if (ay) {
          uy += dy;
          vy  = vy * 0.6 + dy / dt * 16.667 * 0.4;
        }
        ask();
      };
      var end = function(e) {
        if (!g || (e && e.pointerId !== g.id)) return;
        var was  = g.on;
        var idle = e ? e.timeStamp - g.t : 1000;
        g = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('lostpointercapture', end);
        if (!was) return;
        // la capture se rend d'elle-même au relâchement ; la rendre ici ferait arriver, après le geste suivant, un lostpointercapture qui le finirait
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-held');
        // le clic qui suit un geste n'est pas un clic ; la main restée immobile avant de lâcher ne lance rien, ni « réduire les animations »
        swallow = true;
        setTimeout(function() { swallow = false; }, 0);
        if (idle > 90 || µ._mjs_fxCalm()) {
          vx = 0;
          vy = 0;
        }
        ask();
      };
      var down = function(e) {
        if (e.button > 0 || e.isPrimary === false) return;
        // un geste resté ouvert (relâché hors de la fenêtre) est fini ; presser la piste arrête son élan
        if (g) end(null);
        swallow = false;
        vx = 0;
        vy = 0;
        g = { id: e.pointerId, x: e.clientX, y: e.clientY, mx: e.clientX, my: e.clientY, t: e.timeStamp, on: false };
        window.addEventListener('pointermove', move, { passive: true });
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        window.addEventListener('lostpointercapture', end);
      };
      // le clic qui suit un geste n'est pas un clic : il est retenu, où qu'il tombe
      var click = function(e) {
        if (!swallow) return;
        swallow = false;
        e.preventDefault();
        e.stopPropagation();
      };
      var ghost = function(e) { e.preventDefault(); };
      if (hand) {
        µ._mjs_dom.addEventListener(el, 'pointerdown', down, { passive: true });
        µ._mjs_dom.addEventListener(el, 'dragstart', ghost);
        µ._mjs_dom.addEventListener(el, 'click', click, { capture: true });
      }
      // @@

      // @@ on=scroll
      // le défilement n'est écouté que tant que la balise est à l'écran (à 100 px près) ; à son retour il se relit et la piste se pose d'un coup,
      // sans calque promu : seul un défilement la met en mouvement. Un écouteur en capture par racine : le document reçoit aussi le défilement de la page, un écouteur de la fenêtre le lirait une seconde fois
      var onScroll = function() {
        look();
        ask();
      };
      var attach = function() {
        if (hooked) return;
        hooked = true;
        for (var m = 0; m < roots.length; m++) µ._mjs_dom.addEventListener(roots[m], 'scroll', onScroll, { capture: true, passive: true });
        look();
        place();
      };
      var detach = function() {
        if (!hooked) return;
        hooked = false;
        for (var m = 0; m < roots.length; m++) µ._mjs_dom.removeEventListener(roots[m], 'scroll', onScroll, { capture: true });
      };
      // @@

      // la taille du contenu et de la balise : lue ici, pas à chaque image ; une image qui arrive fait grandir la piste, l'observateur le voit
      var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function(entries) {
        for (var m = 0; m < entries.length; m++) {
          if (entries[m].target !== run) continue;
          wx = entries[m].contentRect.width;
          wy = entries[m].contentRect.height;
        }
        build(false);
      }) : null;
      // un changement dans un enfant d'origine (son texte, ses attributs, ses nœuds, une feuille collée, une saisie) : les copies des nœuds touchés le suivent,
      // une fois par image ; un élément parti (ou trop de nœuds touchés) : toutes les copies se revoient ; un enfant qui arrive ou qui part : les copies se refont
      var mirror = function() {
        var list = touched;
        var full = all;
        var src  = _mjsFxMarqueeKept(originals());
        var was  = Object.keys(run._mjs_mqIds).join(' ');
        dirty   = 0;
        touched = [];
        all     = false;
        // un identifiant cité de plus ou de moins dans la bande : toutes les copies se revoient
        run._mjs_mqIds = _mjsFxMarqueeIds(src);
        if (Object.keys(run._mjs_mqIds).join(' ') !== was) full = true;
        // la piste a pu changer de taille (un composant arrivé se dessine) : le compte des copies se revoit d'abord, sans quoi chaque copie de trop
        // monterait ses miroirs pour rien avant que l'observateur des tailles ne la retire. Sa taille de mise en page, comme à la pose : celle de sa boîte à
        // l'écran compte la transformation d'un ancêtre (`scale`, une rotation), que l'observateur des tailles ne voit pas
        wx = run.offsetWidth;
        wy = run.offsetHeight;
        build(false);
        for (var m = 0; m < copies.length; m++) {
          run._mjs_mqN = m + 1;
          if (full) _mjsFxMarqueeSync(copies[m], src, run);
          else {
            for (var k = 0; k < list.length; k++) _mjsFxMarqueeReach(copies[m], list[k], run, src);
          }
        }
      };
      var touch = function(t) {
        if (!all && touched[touched.length - 1] !== t) {
          touched.push(t);
          if (touched.length > 200) all = true;
        }
        if (!dirty) dirty = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(mirror) : setTimeout(mirror, 16);
      };
      var mo = typeof MutationObserver === 'function' ? new MutationObserver(function(list) {
        var own = false;
        var r;
        for (var m = 0; m < list.length; m++) {
          r = list[m];
          if (!_mjsFxMarqueeOwnChange(run, r)) continue;
          if (r.target === run) {
            own = true;
            break;
          }
          for (var k = 0; k < r.removedNodes.length; k++) {
            if (r.removedNodes[k].nodeType === 1) all = true;
          }
          touch(r.target);
        }
        if (!own) return;
        var now = originals();
        // plus un seul enfant, rien d'autre que du texte à défiler : le texte reprend le calque
        if (!needs && !_mjsFxMarqueeKids(now)) {
          swap();
          return;
        }
        µ._mjs_dom.setAttribute(el, 'mjs-fx-marquee-strip', _mjsFxMarqueeKids(now) ? 'kids' : 'text');
        build(true);
      }) : null;
      // ce que la balise reçoit après la pose (un script ajoute des balises, ou du texte, à côté de la piste) rejoint la piste : avant ses enfants si cela arrive avant elle, après sinon ; une piste sortie de la balise (vidée d'un coup) a emporté ses enfants : la balise se remonte avec ce qu'elle contient maintenant
      var adopt = typeof MutationObserver === 'function' ? new MutationObserver(function() {
        if (run.parentNode !== el) return swap();
        var head  = run.firstChild;
        var nodes = _mjsFxMarqueeOwn(el);
        var after = false;
        for (var m = 0; m < nodes.length; m++) {
          if (nodes[m] === run) after = true;
          else _mjsFxMarqueeMove(run, nodes[m], after ? null : head);
        }
      }) : null;
      // la saisie dans un champ ne change aucun nœud : le champ d'origine touché (ou le composant qui le tient) gagne ses copies ; tapée dans une copie, la
      // valeur (la case cochée, les options d'une liste à choix multiples) est d'abord rendue à l'original. Un bouton radio choisi décoche les autres de son groupe sans rien dire : toutes les copies se
      // revoient. Une remise à zéro (`form.reset()`, un bouton `type="reset"`) ne dit rien aux champs : un formulaire de la balise, ou qui la tient, remis à
      // zéro, toutes les copies se revoient (écouté sur la racine de la balise : l'événement d'un formulaire qui la tient ne passe pas par elle) ; celui d'une
      // copie remet l'original à zéro. Une feuille collée par µ.adoptSheet passe par la piste
      var typed = function(e) {
        var t = e.target;
        var o = t._mjs_mq;
        if (o && /^(?:input|select|textarea)$/.test(o.localName) && o.type !== 'file') {
          _mjsFxMarqueeValue(o, t);
          t = o;
        }
        touch(t.type === 'radio' ? run : t);
      };
      var root  = µ._mjs_dom.getRootNode(el);
      var reset = function(e) {
        var o = e.target._mjs_mq;
        if (o && o.isConnected && typeof o.reset === 'function') o.reset();
        else if (µ._mjs_dom.contains(e.target, el) || µ._mjs_dom.contains(el, e.target)) touch(run);
      };
      µ._mjs_dom.addEventListener(el, 'input', typed, { capture: true });
      µ._mjs_dom.addEventListener(root, 'reset', reset, { capture: true });
      run._mjs_mqTouch = touch;
      build(true);
      if (ro) {
        ro.observe(run);
        ro.observe(el);
      }
      if (adopt) adopt.observe(el, { childList: true });
      ctl = {}; // @@ drag=true axis=both on=scroll gap
      ctl.move = function() { if (needs) ask(); }; // @@ drag=true axis=both on=scroll
      // @@ gap
      // `gap` vient de changer : sa variable CSS est posée juste après, la taille se relit à l'image suivante
      ctl.measure = function() {
        if (later || typeof requestAnimationFrame !== 'function') return;
        later = requestAnimationFrame(function() {
          later = 0;
          wx = run.offsetWidth;
          wy = run.offsetHeight;
          build(true);
        });
      };
      // @@
      // @@ on=scroll
      if (scroll) {
        arrive = attach;
        depart = detach;
      }
      // @@
      var seen = _mjsFxMarqueeAway(el, arrive, depart);

      return function() {
        seen();
        detach(); // @@ on=scroll
        ctl = null; // @@ drag=true axis=both on=scroll gap
        // @@ drag=true axis=both on=scroll
        clearTimeout(rest);
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        // @@
        if (later && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(later);
        if (dirty) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(dirty);
          clearTimeout(dirty);
        }
        µ._mjs_dom.removeEventListener(el, 'input', typed, { capture: true });
        µ._mjs_dom.removeEventListener(root, 'reset', reset, { capture: true });
        run._mjs_mqTouch = null;
        if (ro) ro.disconnect();
        if (mo) mo.disconnect();
        if (adopt) adopt.disconnect();
        // @@ drag=true axis=both
        if (g) {
          if (g.on) {
            try {
              µ._mjs_dom.releasePointerCapture(el, g.id);
            }
            catch {}
          }
          g = null;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          window.removeEventListener('lostpointercapture', end);
        }
        if (hand) {
          µ._mjs_dom.removeEventListener(el, 'pointerdown', down, { passive: true });
          µ._mjs_dom.removeEventListener(el, 'dragstart', ghost);
          µ._mjs_dom.removeEventListener(el, 'click', click, { capture: true });
        }
        // @@
        // les enfants reprennent leur place, la piste et ses copies partent ; une piste sortie de la balise (vidée d'un coup) a perdu ses enfants avec elle, le script les a retirés : rien à rendre
        if (run.parentNode === el) {
          var back = originals();
          for (var m = 0; m < back.length; m++) _mjsFxMarqueeMove(el, back[m], run);
          µ._mjs_dom.remove(run);
        }
        ['strip', 'away'].forEach(function(k) { µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-' + k); });
        ['drag', 'still', 'drive', 'held'].forEach(function(k) { µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-' + k); }); // @@ drag=true axis=both on=scroll
      };
    };
    // @@

    // la balise est un texte, ou des enfants : le texte seul garde son calque, sauf si on lui demande la main, le défilement ou la nappe. Le choix de
    // la piste est une ligne de section, ôtée avec elle (l'affectation tient sur trois lignes pour cela) : sans piste, c'est le calque du texte, toujours
    mount = function() {
      stopMode =
      // @@ unit=child drag=true axis=both on=scroll
      needs || kids() ? stripSetup() :
      // @@
      layerSetup();
    };
    // @@ unit=child drag=true axis=both on=scroll
    // un changement de mode : des balises arrivent dans une balise qui n'en avait pas à la pose (un script les ajoute), ou la balise n'en a plus, ou la balise vidée d'un coup se remonte avec son nouveau contenu. Une pose qui ne
    // demande rien (`s.unit` absent : ni `child`, ni une variable valant `auto` ou `child`, dont le build garde le mode) n'aurait pas le défilé des balises en
    // production : le développement le dit ; celles que le gabarit écrit, le compilateur les voit et écrit `unit: child`
    swap = function() {
      stopMode();
      _mjsFxMarqueeUnwrap(el);
      // @@ dev
      if (!needs && s.unit === void 0 && kids()) _mjsFxMarqueeTell(el, comp);
      // @@
      mount();
    };
    // @@
    mount();
    // @@ dev
    // des balises déjà là à la pose, que le compilateur n'a pas vues dans le gabarit (un `@attach` les a ajoutées avant) : même avertissement, même condition
    if (!needs && s.unit === void 0 && kids()) _mjsFxMarqueeTell(el, comp);
    // @@
    var mode = s.on;
    if (scroll) mode = 'always'; // @@ on=scroll
    var gate = µ._mjs_fxLoop(el, 'marquee', mode);
    var off  = function() {
      gate();
      stopMode();
      el.style.removeProperty('--mjs-fx-marquee-dir');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-pause'); // @@ pause
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-marquee-axis'); // @@ direction=up,down axis=both
      inline();
    };
    // @@ gap reverse on=scroll
    // un réglage suivi sans reposer l'effet : la vitesse (le rapport au défilement), le sens inverse, l'espace (la taille d'un tour est relue) ;
    // les autres (sens, main, nappe, déclencheur) exigent de le reposer
    off.set = function(k, v) {
      // @@ on=scroll
      if (k === 'speed') {
        speedMs = µ._mjs_fxMs(v, 12000);
        if (ctl) ctl.move();
        return true;
      }
      // @@
      // @@ reverse
      if (k === 'reverse') {
        rev = v === true; // @@ on=scroll
        if (ctl) ctl.move(); // @@ on=scroll
        return true;
      }
      // @@
      // @@ gap
      if (k === 'gap') {
        if (ctl) ctl.measure();
        return true;
      }
      // @@
      return false;
    };
    // @@
    return off;
  }
};
