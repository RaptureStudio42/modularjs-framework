// mjs_form_answers — les réponses du serveur rangées sous le formulaire qui les a reçues. La réponse à l'envoi d'un formulaire (un refus
// 422, une réponse `method: 'none'`) qui porte `errors` est rangée sous CE formulaire : les <@@field> et l'objet formulaire (`µform`) des
// champs qu'il emporte la lisent (`µ._mjs_formView`, qui reçoit le champ lui-même : son formulaire est celui de `form` — rattaché par
// `form="…"` compris, même enveloppé d'une icône ou d'un affixe —, sinon la balise form qui l'entoure), ceux d'un autre formulaire gardent
// les leurs. Un formulaire qui porte un `id` est reconnu par cet id dans le composant qui l'a écrit (l'instance qui l'entoure de plus près
// : l'hôte de son ombre, ou le composant léger ; la page à défaut), pris à l'envoi, le formulaire dans la page : recréé par un {if}, même
// quand sa réponse arrive pendant qu'il est caché, il retrouve ses réponses, et deux formulaires de même id dans une même instance n'en
// font qu'un (un id en double est déjà faux en HTML : le développement le dit). Un formulaire sans `id` a sa case à lui, rangée par son
// élément, que personne d'autre ne reprend : recréé, il repart à neuf. Rien n'est écrit dans la page (aucun attribut posé). `µres.errors`
// reste le sac commun de l'application : une page qui arrive, un lien ou une réponse sans formulaire qui porte `errors`, une écriture de
// l'application dans `µres.errors` (le sac entier, ou une clé en place, vue à la lecture qui suit) valent pour tous les formulaires.
// Tant qu'aucun formulaire n'a de réponse à lui qui diffère du sac (une page à un formulaire, toujours), chaque lecteur reçoit le sac
// `µres.errors` lui-même : il le lit comme avant, et rien de plus n'est prévenu. Un formulaire dont la réponse change sans que le sac change
// (deux succès de suite) prévient ses seuls lecteurs ; une écriture commune, ceux des formulaires qui montraient autre chose que le sac.
// Fichier détecté : il n'entre que si l'application écrit une balise form, un lecteur (<@@field>, qui écrit `µ._mjs_formView`, ou `µform`)
// et la navigation qui envoie ses formulaires (mjs_ujs.ts) ; rien n'est ajouté ailleurs. Il enveloppe à son chargement le départ d'un envoi
// (`µ._mjs_navDispatch`), le veilleur flash/error (`µ._mjs_navFlash`, qui voit chaque sac du serveur et son élément d'origine juste avant
// son entrée au magasin), l'avis des refus (`µ._mjs_formTell`, qui dit le formulaire de l'envoi refusé), `µ._mjs_resMerge` et `µ._mjs_resSet`

var _mjsAnsHas  = Object.prototype.hasOwnProperty;
// les cases : par formulaire, l'élément → son id lu en dernier et sa case ; par composant, l'instance (ou la page) → id → case. Une case :
// `a` la réponse (un sac d'erreurs, ou null), `g` la génération de cette réponse, `s` l'état que suivent les composants qui la lisent (créé
// à la première lecture), `o` les objets formulaire à rafraîchir, `k` le compte lu, `l` la dernière génération où elle a été lue
var _mjsAnsOwn  = new WeakMap();
var _mjsAnsIds  = new WeakMap();
// la génération avance à chaque écriture commune (une case d'une autre génération est vide) ; les cases lues dans celle-ci
var _mjsAnsGen  = 0;
var _mjsAnsRead = [];
// le sac juste après la dernière réponse rangée (undefined : aucune dans la génération) et son texte ; le sac d'avant la première, que
// lit un formulaire sans réponse ; le dernier sac vu par le veilleur, avec son élément d'origine
var _mjsAnsLast = void 0;
var _mjsAnsSig  = '';
var _mjsAnsBase = void 0;
var _mjsAnsPend = null;

function _mjsAnsRaw(v) {
  return typeof µ._mjs_toRaw === 'function' ? µ._mjs_toRaw(v) : v;
}

function _mjsAnsText(v) {
  try { return JSON.stringify(v); }
  catch { return String(v); }
}

// le formulaire de `n` : lui-même, ou celui qui emporte ce champ (`form` d'un champ natif ou associé, rattaché par `form="…"` compris),
// sinon la balise form qui l'entoure
function _mjsAnsFormOf(n) {
  if (n.localName === 'form') return n;
  return n.form !== void 0 ? n.form : n.closest ? n.closest('form') : null;
}

// la case du formulaire `f` : celle de son id dans le composant qui l'entoure (pris à la première recherche, à l'envoi au plus tard, le
// formulaire dans la page), la sienne sans id
function _mjsAnsBox(f) {
  var id = f.getAttribute('id') || '';
  var c  = _mjsAnsOwn.get(f);
  if (c && c.id === id) return c.b;
  var b = { g: -1 };
  if (id) {
    var o = f.parentNode;
    while (o && !o._mjs_isLight && o.nodeType !== 11) o = o.parentNode;
    o     = o ? o.host || o : document;
    var m = _mjsAnsIds.get(o);
    if (!m) _mjsAnsIds.set(o, m = new Map());
    if (m.has(id)) b = m.get(id);
    else m.set(id, b);
    // <formulaires-avis>
    // deux formulaires présents ensemble au même id dans un composant : un seul formulaire pour le framework, dit en développement
    if (b.f && b.f !== f && b.f.isConnected && f.isConnected) µ.warn(µ._mjs_msg('dev.formIdTwice', { id: id }, 'deux formulaires de ce composant portent l\'id « {id} » : le framework les tient pour un seul formulaire, qui partage ses réponses. Donnez-leur des id distincts, ou aucun id.'));
    b.f = f;
    // </formulaires-avis>
  }
  _mjsAnsOwn.set(f, { id: id, b: b });
  return b;
}

// les lecteurs de la case `b` prévenus : les composants abonnés à son état, les objets formulaire par leur rafraîchissement
function _mjsAnsTell(b) {
  var o = b.o || [];
  b.o   = [];
  if (b.s) b.s.n++;
  for (var i = 0; i < o.length; i++) o[i]();
}

// une écriture commune : la génération suivante ; parmi les cases lues dans celle qui finit, celles qui montraient autre chose que le sac
// sont prévenues (sauf `k`, celle du lecteur qui a vu l'écriture : il rend lui-même le sac)
function _mjsAnsCommon(k) {
  var l = _mjsAnsRead;
  var w = _mjsAnsLast;
  var g = _mjsAnsGen++;
  _mjsAnsRead = [];
  _mjsAnsLast = void 0;
  for (var i = 0; i < l.length; i++) {
    if (w !== void 0 && l[i] !== k && (l[i].g === g ? l[i].a : _mjsAnsBase) !== w) _mjsAnsTell(l[i]);
    else l[i].o = [];
  }
}

// la réponse `p` (un sac de props qui porte `errors`) à l'envoi du formulaire `f` : rangée sous lui AVANT d'entrer au magasin (un lecteur
// qui repasse aussitôt la trouve rangée) ; ses lecteurs prévenus si ce qu'il montre change sans que le sac change (deux succès de suite)
function _mjsAnsPut(f, p) {
  var r = _mjsAnsRaw(µ.res && µ.res.errors);
  if (_mjsAnsLast !== void 0 && (r !== _mjsAnsLast || _mjsAnsText(r) !== _mjsAnsSig)) _mjsAnsCommon();
  if (_mjsAnsLast === void 0) _mjsAnsBase = r;
  var b = _mjsAnsBox(f);
  var v = b.g === _mjsAnsGen ? b.a : _mjsAnsBase;
  var a = _mjsAnsRaw(p.errors);
  b.a         = a;
  b.g         = _mjsAnsGen;
  _mjsAnsLast = a;
  _mjsAnsSig  = _mjsAnsText(a);
  _mjsAnsMerge(p);
  if (r === a && v !== a) _mjsAnsTell(b);
}

// ce que lit un lecteur du champ `n` (ou du formulaire `n`) dans `e`, le sac `µres.errors` qu'il vient de lire : le sac lui-même tant
// qu'aucune réponse rangée ne distingue son formulaire, sinon la réponse de ce formulaire (le sac d'avant la première réponse, s'il n'en
// a pas reçu). `w` : qui prévenir quand ce que montre ce formulaire change sans que le sac change — un composant (<@@field>), abonné à
// l'état de la case le temps de la lecture (un reffet tourne hors du rendu : la pile des composants en cours, mjs_init.ts), ou le
// rafraîchissement d'un objet formulaire. Un sac changé depuis la dernière réponse rangée (un autre objet, ou le même écrit en place) est
// une écriture de l'application : commune
µ._mjs_formView = function(n, e, w) {
  if (!n || _mjsAnsLast === void 0) return e;
  var f = _mjsAnsFormOf(n);
  if (!f) return e;
  var b = _mjsAnsBox(f);
  if (b.l !== _mjsAnsGen) {
    b.l = _mjsAnsGen;
    b.o = [];
    _mjsAnsRead.push(b);
  }
  if (typeof w === 'function') {
    if (b.o.indexOf(w) < 0) b.o.push(w);
  }
  else if (w) {
    if (!b.s) b.s = µ.state({ n: 0 });
    µ._mjs_initStack.push(w);
    try { b.k = b.s.n; }
    finally { µ._mjs_initStack.pop(); }
  }
  var v = b.g === _mjsAnsGen ? b.a : _mjsAnsBase;
  if (v === _mjsAnsLast) return e;
  var r = _mjsAnsRaw(e);
  if (r !== _mjsAnsLast || _mjsAnsText(r) !== _mjsAnsSig) {
    _mjsAnsCommon(b);
    return e;
  }
  return v;
};

// l'envoi d'un formulaire part : sa case se prend maintenant, le formulaire dans la page (sa réponse peut arriver quand un {if} l'a
// retiré : elle va à la case de son id dans son composant, que le formulaire remontré retrouve)
var _mjsAnsSend = µ._mjs_navDispatch;
if (typeof _mjsAnsSend === 'function') {
  µ._mjs_navDispatch = function(url, method, payload, opts) {
    if (opts && opts.form) _mjsAnsBox(opts.form);
    return _mjsAnsSend.apply(this, arguments);
  };
}

// le veilleur flash/error voit chaque sac du serveur avec son élément d'origine (le bouton qui envoie, le formulaire, le lien), juste
// avant son entrée au magasin ; l'avis d'un refus (422) dit, lui, le formulaire de l'envoi, même retiré de la page entre-temps
var _mjsAnsFlash = µ._mjs_navFlash;
if (typeof _mjsAnsFlash === 'function') {
  µ._mjs_navFlash = function(p, el) {
    _mjsAnsPend = [p, el];
    return _mjsAnsFlash(p, el);
  };
}
var _mjsAnsTold = µ._mjs_formTell;
µ._mjs_formTell = function(o, b) {
  if (o && o.form && b && b.props) _mjsAnsPend = [b.props, o.form];
  if (typeof _mjsAnsTold === 'function') _mjsAnsTold(o, b);
};

// un sac qui ne change pas de page : la réponse à l'envoi d'un formulaire est rangée sous lui ; un autre sac qui porte `errors` (un lien,
// une réponse sans formulaire) est une écriture commune, comme une page qui arrive
var _mjsAnsMerge = µ._mjs_resMerge;
if (typeof _mjsAnsMerge === 'function') {
  µ._mjs_resMerge = function(p) {
    var w       = _mjsAnsPend;
    _mjsAnsPend = null;
    if (!p || !_mjsAnsHas.call(p, 'errors')) return _mjsAnsMerge(p);
    var o = w && w[0] === p ? w[1] : null;
    var f = o && (o.localName === 'form' ? o : o.form);
    if (f) return _mjsAnsPut(f, p);
    _mjsAnsMerge(p);
    _mjsAnsCommon();
  };
}
var _mjsAnsSet = µ._mjs_resSet;
if (typeof _mjsAnsSet === 'function') {
  µ._mjs_resSet = function(p) {
    _mjsAnsPend = null;
    _mjsAnsSet(p);
    _mjsAnsCommon();
  };
}
