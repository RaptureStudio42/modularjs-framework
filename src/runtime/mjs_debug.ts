// mjs_debug.ts
var originalConnected, originalDisconnected, originalRunEffects;

µ.debugMode = false;

µ.instances = new Set();

// 4. Avertissements du développement (ce fichier ne part jamais en production : ni ce code, ni le texte du groupe `dev`)
// - une prop que le parent livre à sens unique (`dialog={$dialog}`) et que l'enfant écrit ensuite lui-même : le parent garde sa propre
//   valeur, un `{if}` qui la lit ne bouge pas. Le code de développement du parent note chaque livraison (`µ._mjs_oneWay`, cf.
//   generator/attributes) ; l'enfant écrit son état par `µ._set`. Une livraison faite avant la définition de l'enfant (registre
//   `µ._mjs_pend`) ne compte qu'une fois versée, à sa connexion : le défaut que le script de l'enfant pose à sa construction vient avant
//   toute valeur du parent et n'est jamais dit. Rien pour une prop liée à deux sens (`_mjs_binds`) ni pour une écriture qui ne change rien
//   (une liste copiée aux mêmes éléments compte pour rien : la remise à zéro d'un formulaire rend ainsi les cases de départ d'un module cœur),
//   ni quand la balise porte un gestionnaire d'événement (`@change={…}` : le parent suit par l'événement ; la livraison, notée, ne sert
//   qu'à l'avertissement suivant). Dit une fois par composant et par nom, sous la balise telle que l'auteur l'écrit (`<@@select>`,
//   `<@fenetre>`)
// - un objet reçu par une prop simple (sans `!`), ou atteint à partir de lui à toute profondeur, que l'enfant modifie (`$items.push(x)`,
//   `$items[0].nom = v`, `delete $cfg.a`, `Object.defineProperty`, une méthode qui change l'objet, une Map ou un Set, une autre variable qui
//   le garde, une fonction qui le reçoit) : la prop passe l'objet lui-même, jamais une copie, et le composant qui la passe n'est pas
//   prévenu. Dit quoi que fasse le parent ensuite (garder, lâcher, recopier, lier plus loin) et d'où qu'il prenne l'objet (son état, une
//   valeur dérivée, le magasin, `µ.state`, l'objet d'un événement). La livraison note l'objet avant qu'il ne parte (table faible par enfant :
//   objet brut → prop) ; l'enveloppe de l'enfant le marque quand elle le range à la racine, et la marque passe à ce qu'elle en lit (`_mjs_dv`,
//   posée sur l'ensemble des clés qui atteignent l'objet, cf. les accroches `<development>` de mjs_element.ts) : une lecture déjà faite ne
//   paie qu'une ou deux lectures de propriété, sans recherche. Une écriture profonde de l'enfant (`_mjs_notifyMutationAliased`, une
//   définition) parle quand la clé écrite est une prop simple dont l'objet est venu du parent (marqué, ou valeur reçue : écriture du code
//   compilé, qui ne lit pas par l'enveloppe) ; écrite par une autre variable, quand l'objet est marqué ou atteint par une prop reçue. Une prop
//   liée (`!{…}`) ne parle pas : ce que l'enfant lié modifie par elle (la clé écrite, ou une clé liée qui atteint l'objet), il le modifie pour
//   le composant qui la lie (`µ._mjs_twoWay`, noté par le code de développement de celui-ci avec sa variable liée), qui parle à sa place s'il
//   tient cette variable d'une prop simple, la chaîne de liaisons remontée, ou si l'objet modifié porte chez lui la marque d'une prop simple
//   (sa copie en surface d'une liste reçue, liée plus loin, en partage les éléments). Rien pour un objet que l'enfant a fait et garde (sa copie, un
//   objet neuf), un objet µraw (jamais prévenu), le magasin écrit par `$$` (qui prévient ses lecteurs), ni ce qu'un gestionnaire écrit dans
//   l'objet que l'enfant lui envoie (`µemit 'x', $items` : pendant l'envoi, puis, par l'enveloppe de l'enfant, plus tard). Dit une fois par
//   composant et par prop, avec le composant qui la passe et la pile d'appels de la modification, et un renvoi à la documentation
//   (« Modifier un objet reçu », docs/04-props.md) : aucun remède au cas par cas, l'objet se modifie là où il est rangé
// - une attache (`@attach`) qui rend autre chose qu'une fonction ou que rien : la valeur est ignorée, ce n'est pas un nettoyage. Dit une
//   fois par composant, balise et ligne, sous les balises telles que l'auteur les écrit
// recues : élément → { prop: 1 } (versée dans l'état), 2 (en attente de la mise à niveau de l'enfant), ou 3 (balise qui porte un gestionnaire
// d'événement : seule la modification de l'objet venu de la prop est dite)
var _mjsReceived    = new WeakMap();
var _mjsAlreadyTold = Object.create(null);
// venus : élément → WeakMap(objet brut → la prop simple par laquelle il est venu) ; liees : élément → { prop: [le composant qui la lie, sa
// variable liée] } ; envoyes : élément → WeakMap(objet brut → 1), ce qu'il a envoyé par un événement ; donneurs : élément → le composant qui
// lui passe ses props ; dits : balise → { prop: 1 }, l'objet modifié déjà dit
var _mjsReceivedObjects     = new WeakMap();
var _mjsBound     = new WeakMap();
var _mjsSent      = new WeakMap();
var _mjsProviders = new WeakMap();
var _mjsTold      = Object.create(null);
// composants qui envoient un événement, le temps que leurs gestionnaires s'exécutent ; l'élément dont le code compilé écrit en profondeur,
// le temps de l'écriture
var _mjsEmitters   = [];
var _mjsDeepWriter = null;

function _mjsOnce(key) {
  if (_mjsAlreadyTold[key]) return false;
  _mjsAlreadyTold[key] = 1;
  return true;
}

// `mjs-core-select` → `@@select` (module cœur), `mjs-fenetre` → `@fenetre` (composant du projet)
function _mjsWrittenTag(name) {
  return name.indexOf('mjs-core-') === 0 ? '@@' + name.slice(9) : name.indexOf('mjs-') === 0 ? '@' + name.slice(4) : name;
}

// deux listes aux mêmes éléments, dans le même ordre (`liste.slice()`) : l'écriture de l'une à la place de l'autre ne change rien
function _mjsSameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function _mjsReceivedSettled(el) {
  var r = _mjsReceived.get(el);
  if (!r) return;
  for (var k in r) {
    if (r[k] === 2) r[k] = 1;
  }
}

// la prop `k` livrée à l'enfant `el` par le composant `provider`, avec sa valeur `v`, avant qu'elle ne parte (un enfant déjà défini se
// redessine aussitôt) ; `f` : 1 la balise porte un gestionnaire d'événement (cf. generator/attributes). L'objet livré est noté, et marqué si
// l'enveloppe de l'enfant l'a déjà
µ._mjs_oneWay = function(el, k, provider, v, f) {
  var r = _mjsReceived.get(el), o, m, rs;
  if (!r) {
    r = Object.create(null);
    _mjsReceived.set(el, r);
  }
  r[k] = f & 1 ? 3 : typeof el._set === 'function' ? 1 : 2;
  if (provider && _mjsProviders.get(el) !== provider) _mjsProviders.set(el, provider);
  if (v === null || typeof v !== 'object') return;
  o = µ._mjs_toRaw(v);
  if (!(m = _mjsReceivedObjects.get(el))) _mjsReceivedObjects.set(el, m = new WeakMap());
  if (!m.has(o)) m.set(o, k);
  if ((rs = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(o)) !== void 0) µ._mjs_devRead(k, rs);
};

// la prop `k` de l'enfant `el` liée à deux sens par le composant `provider`, à sa variable `cle` (`items=!{$items}` et `item=!{$items[i]}` :
// `items` ; vide pour le magasin) : ce que l'enfant modifie par elle, il le modifie pour le donneur (cf. _mjsByLink)
µ._mjs_twoWay = function(el, k, provider, key) {
  var l = _mjsBound.get(el), x;
  if (!l) _mjsBound.set(el, l = Object.create(null));
  if (!(x = l[k]) || x[0] !== provider || x[1] !== key) l[k] = [provider, key];
};

// la marque d'un objet dans l'enveloppe d'un élément (`_mjs_dv` de sa fiche, qui porte les clés qui l'y atteignent) : le nom de la prop par laquelle
// il est venu, ou { k: ce nom ou rien, e: 1 } quand l'élément l'a aussi envoyé par un événement, lui ou un objet dont il est lu
function _mjsPropOf(mq) {
  return typeof mq === 'string' ? mq : mq && mq.k;
}

// ce que l'enveloppe lit d'un objet marqué `mq` (`rs` : les clés qui l'atteignent) prend sa marque : la prop d'abord venue reste, l'envoi
// s'ajoute ; la marque du conteneur se partage quand elle dit la même prop, et les lectures suivantes ne coûtent plus rien
µ._mjs_devRead = function(mq, rs) {
  var a = rs._mjs_dv, ka, km;
  if (mq === void 0 || a === mq) return;
  if (a === void 0) {
    rs._mjs_dv = mq;
    return;
  }
  ka = _mjsPropOf(a);
  km = _mjsPropOf(mq);
  // déjà envoyé et venu d'une prop, ou rien à ajouter
  if (typeof a === 'object' ? ka !== void 0 || km === void 0 : typeof mq !== 'object') return;
  rs._mjs_dv = typeof mq === 'object' && (ka === void 0 || ka === km) ? mq : { k: ka !== void 0 ? ka : km, e: 1 };
};

// l'enveloppe de `el` crée celle de l'objet brut `o` (`rs` : les clés qui l'atteignent) : lu d'un conteneur (`via`), il en prend la marque ;
// rangé à la racine, celle de sa livraison ou de son envoi
µ._mjs_devCreate = function(el, o, rs, via) {
  var m, k;
  if (via !== void 0) {
    if (via._mjs_dv !== void 0) µ._mjs_devRead(via._mjs_dv, rs);
    return;
  }
  if ((m = _mjsReceivedObjects.get(el)) !== void 0 && (k = m.get(o)) !== void 0) µ._mjs_devRead(k, rs);
  if ((m = _mjsSent.get(el)) !== void 0 && m.has(o)) _mjsMarkSend(rs);
};

// l'objet envoyé par un événement (`rs` : les clés qui l'atteignent) : marqué envoyé, sa prop gardée ; ce qu'on en lit l'est aussi
function _mjsMarkSend(rs) {
  var a = rs._mjs_dv;
  if (a === void 0 || typeof a !== 'object') rs._mjs_dv = { k: a, e: 1 };
}

// la valeur que l'élément `el` tient sous sa clé `c` est un objet qu'un parent lui a passé par une prop simple
function _mjsIsReceived(el, c) {
  var m = _mjsReceivedObjects.get(el);
  return m !== void 0 && el._state !== void 0 && m.has(µ._mjs_toRaw(el._state[c]));
}

// l'élément `el` modifie l'objet brut `obj` par sa clé `rootKey`. La clé écrite d'abord : liée, la modification est celle du composant qui
// la lie (cf. _mjsByLink) ; prop simple dont l'objet est venu du parent (marqué, ou valeur reçue), elle est dite. Écrit par une autre
// variable : une clé liée qui atteint l'objet fait de même, puis la marque de l'objet, puis une prop reçue qui l'atteint. Rien pendant que
// l'élément envoie un événement (écriture d'un gestionnaire, par `e.data`), ni, hors de son code compilé, pour ce qu'il a envoyé (le
// gestionnaire peut l'écrire plus tard, par son enveloppe)
function _mjsModified(el, obj, rootKey) {
  var r = _mjsReceived.get(el), l = _mjsBound.get(el), rbt = el._mjs_rootsByTarget, rs = rbt && rbt.get(obj), mq = rs && rs._mjs_dv, k, c, d, e;
  if (_mjsEmitters.indexOf(el) >= 0) return;
  if (l !== void 0 && l[rootKey] !== void 0) return _mjsByLink(l[rootKey], el, obj);
  if (r !== void 0 && r[rootKey] !== void 0 && (_mjsPropOf(mq) === rootKey || _mjsIsReceived(el, rootKey))) {
    k = rootKey;
  }
  else {
    if (l !== void 0 && rs !== void 0) {
      for (c of rs.s || [rs.r]) {
        if (l[c] !== void 0) return _mjsByLink(l[c], el, obj);
      }
    }
    if (r === void 0) return;
    if ((k = _mjsPropOf(mq)) === void 0 && rs !== void 0) {
      for (c of rs.s || [rs.r]) {
        if (r[c] !== void 0 && _mjsIsReceived(el, c)) {
          k = c;
          break;
        }
      }
    }
  }
  if (k === void 0 || ((d = _mjsTold[el.localName]) && d[k])) return;
  if (_mjsDeepWriter !== el && (typeof mq === 'object' || ((e = _mjsSent.get(el)) && e.has(obj)))) return;
  _mjsTell(el, k, null, obj);
}

// ce que `modified` change par une prop liée, l'objet brut `obj`, dans ce que tient `x` = [le composant qui la lie, sa variable liée] : ce
// composant le modifie, et parle à sa place s'il tient cette variable d'une prop simple dont l'objet est venu de son parent, ou si l'objet
// porte chez lui la marque d'une prop simple (une copie en surface de la liste reçue, liée plus loin, en partage les éléments) ; s'il tient
// la variable d'une prop liée à son tour, la chaîne se remonte
function _mjsByLink(x, modified, obj) {
  var n = 0, c, k, l, r, d, rs;
  while (n++ < 64) {
    c = x[0];
    k = x[1];
    if ((l = _mjsBound.get(c)) !== void 0 && l[k] !== void 0) {
      x = l[k];
      continue;
    }
    if ((r = _mjsReceived.get(c)) === void 0) return;
    if (r[k] === void 0 || !_mjsIsReceived(c, k)) {
      rs = c._mjs_rootsByTarget && c._mjs_rootsByTarget.get(obj);
      if ((k = _mjsPropOf(rs && rs._mjs_dv)) === void 0 || r[k] === void 0) return;
    }
    if (!((d = _mjsTold[c.localName]) && d[k])) _mjsTell(c, k, modified, obj);
    return;
  }
}

// l'objet venu de la prop `k` de l'élément `el`, modifié par lui, ou par `par`, un composant qui lui est lié : dit une fois par composant et
// par prop, avec le composant qui la passe, la pile d'appels de cette modification (prise avant l'appel) et le renvoi à la documentation
function _mjsTell(el, k, by, obj) {
  var x = _mjsProviders.get(el) || (el.getRootNode && el.getRootNode().host), stack = new Error(), v;
  (_mjsTold[el.localName] || (_mjsTold[el.localName] = Object.create(null)))[k] = 1;
  v = { tag: _mjsWrittenTag(el.localName), prop: k, parent: _mjsWrittenTag((x && x.localName) || '?') };
  // avec l'enveloppe, l'écran suit quand le registre des détenteurs connaît le parent comme détenteur de l'objet modifié (mjs_element.ts) :
  // la manière seule est déconseillée ; sinon (ligne du magasin `$$` lue sans variable `$`, objet lu à travers un objet gelé), et sans
  // l'enveloppe, le parent n'en est pas prévenu
  // <wrapper>
  var suit = x != null && obj !== void 0 && µ._mjs_claimKnown !== void 0 && µ._mjs_claimKnown(x, obj);
  // </wrapper>
  if (by) {
    v.by = _mjsWrittenTag(by.localName);
    // <wrapper>
    if (suit) µ.warn(µ._mjs_msg('dev.propMutatedBound', v, '<{by}>, lié à <{tag}>, modifie un objet que <{parent}> a passé à <{tag}> par sa prop « {prop} » : l\'écran suit, mais préférez demander la modification à <{parent}> par un événement ou par une de ses méthodes. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).'), stack);
    else µ.warn(µ._mjs_msg('dev.propMutatedBoundUnseen', v, '<{by}>, lié à <{tag}>, modifie un objet que <{parent}> a passé à <{tag}> par sa prop « {prop} » : <{parent}> n\'en est pas prévenu. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).'), stack);
    // </wrapper>
    // <no-wrapper>
    // µ.warn(µ._mjs_msg('dev.propMutatedBoundNoProxy', v, '<{by}>, lié à <{tag}>, modifie un objet que <{parent}> a passé à <{tag}> par sa prop « {prop} » : <{parent}> n\'en est pas prévenu, son écran ne suit pas (réglage « proxy » à false). Demandez la modification à <{parent}> par un événement, ou faites-lui signaler le changement par µrefresh sur sa variable qui tient l\'objet. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).'), stack);
    // </no-wrapper>
  }
  // <wrapper>
  else if (suit) µ.warn(µ._mjs_msg('dev.propMutated', v, '<{tag}> modifie un objet que <{parent}> lui a passé par sa prop « {prop} » : l\'écran suit, mais préférez demander la modification à <{parent}> par un événement ou par une de ses méthodes. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).'), stack);
  else µ.warn(µ._mjs_msg('dev.propMutatedUnseen', v, '<{tag}> modifie un objet que <{parent}> lui a passé par sa prop « {prop} » : <{parent}> n\'en est pas prévenu. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).'), stack);
  // </wrapper>
  // <no-wrapper>
  // else µ.warn(µ._mjs_msg('dev.propMutatedNoProxy', v, '<{tag}> modifie un objet que <{parent}> lui a passé par sa prop « {prop} » : <{parent}> n\'en est pas prévenu, son écran ne suit pas (réglage « proxy » à false). Demandez la modification à <{parent}> par un événement, ou faites-lui signaler le changement par µrefresh sur sa variable qui tient l\'objet. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).'), stack);
  // </no-wrapper>
}

// ce que l'élément envoie par un événement (`data`, et ce que range l'objet ou la liste qu'il fait pour l'envoi : `{ liste: $items }`,
// `[...$items]`, un niveau) : noté et marqué envoyé (cf. _mjsModified)
function _mjsSendData(el, data) {
  var e, o, ks, i, x;
  if (data === null || typeof data !== 'object') return;
  if (!(e = _mjsSent.get(el))) _mjsSent.set(el, e = new WeakMap());
  _mjsSend(el, e, o = µ._mjs_toRaw(data));
  if (o !== data || !(Array.isArray(o) || Object.prototype.toString.call(o) === '[object Object]')) return;
  ks = Object.keys(o);
  for (i = 0; i < ks.length; i++) {
    if ((x = o[ks[i]]) !== null && typeof x === 'object') _mjsSend(el, e, µ._mjs_toRaw(x));
  }
}

function _mjsSend(el, e, o) {
  var rs;
  e.set(o, 1);
  if ((rs = el._mjs_rootsByTarget && el._mjs_rootsByTarget.get(o)) !== void 0) _mjsMarkSend(rs);
}

// une définition (`Object.defineProperty`) de la propriété `p` sur l'objet brut `obj`, par l'enveloppe de `el` (clé `rootKey`) : dite comme
// une écriture. Une clé interne du moteur (`_mjsId`, le tatouage qu'une liste sans clé pose sur ses lignes, mjs_for.ts) n'en est pas une
µ._mjs_devDefined = function(el, obj, rootKey, p) {
  if ((_mjsReceived.has(el) || _mjsBound.has(el)) && !(typeof p === 'string' && p.indexOf('_mjs') === 0)) _mjsModified(el, obj, rootKey);
};

// l'élément écrit sa prop `k` : dit si c'est une prop à sens unique et une autre valeur que la sienne — le même objet, rendu par l'écho de
// la liaison d'un enfant qui vient de le modifier (une enveloppe d'un côté, l'objet brut de l'autre), n'en est pas une
var _mjsSetBase = µ._set;
// <precision>
µ._set = function(el, k, v, c) {
// </precision>
// <clock>
// µ._set = function(el, k, v) {
// </clock>
  var r = _mjsReceived.get(el);
  if (r && r[k] === 1 && !(el._mjs_binds && el._mjs_binds.has(k)) && el._state && µ._mjs_toRaw(el._state[k]) !== µ._mjs_toRaw(v) && !_mjsSameList(el._state[k], v) && _mjsOnce('p ' + el.localName + ' ' + k)) {
    µ.warn(µ._mjs_msg('dev.propOneWay', { tag: _mjsWrittenTag(el.localName), prop: k }, '<{tag}> écrit sa prop « {prop} » : cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement. Le parent garde sa propre valeur, il ne voit pas ce changement.'));
  }
  // <precision>
  return _mjsSetBase(el, k, v, c);
  // </precision>
  // <clock>
  // return _mjsSetBase(el, k, v);
  // </clock>
};

// aides d'écriture profonde (mjs_deep.ts, avant ce fichier dans le runtime ; absentes d'une appli qui n'écrit jamais en profondeur) :
// l'élément dont le code compilé écrit, le temps de l'écriture (cf. _mjsModified)
// trois lectures écrites en toutes lettres : un nom calculé sur µ ferait garder tous les modules optionnels à la construction
var _mjsWrapDeep = function(f) {
  return function(el) {
    var a = _mjsDeepWriter;
    _mjsDeepWriter = el;
    try {
      return f.apply(this, arguments);
    }
    finally {
      _mjsDeepWriter = a;
    }
  };
};
if (µ._mjs_deepSet)    µ._mjs_deepSet    = _mjsWrapDeep(µ._mjs_deepSet);
if (µ._mjs_deepCall)   µ._mjs_deepCall   = _mjsWrapDeep(µ._mjs_deepCall);
if (µ._mjs_deepDelete) µ._mjs_deepDelete = _mjsWrapDeep(µ._mjs_deepDelete);

µ._mjs_attachNotFn = function(el, node, v, line) {
  var tag  = (el && el.localName) || '?';
  var name = (node && node.localName) || '?';
  if (!_mjsOnce('a ' + tag + ' ' + name + ' ' + line)) return;
  µ.warn(µ._mjs_msg('dev.attachNotFn', { tag: _mjsWrittenTag(tag), node: _mjsWrittenTag(name), line: line, type: typeof v }, '<{tag}> : le :attach de <{node}> (ligne {line}) a rendu une valeur de type {type}, pas une fonction : elle est ignorée. Rendez une fonction de nettoyage, appelée quand la balise disparaît, ou rien.'));
};

// une liste qui voit deux clés de types différents qui s'écrivent pareil (`1` et `'1'`, `true` et `'true'`, `1n` et `1`), dans un rendu
// (`keys`) ou d'un rendu au suivant (`old`) : deux clés distinctes, la ligne est refaite au lieu d'être déplacée. Dit une fois par composant
// et par liste (`id`), avec les deux écritures de la clé ; une liste dont toutes les clés ont le même type ne paie qu'un passage sur ses clés
µ._mjs_devKeys = function(el, id, keys, old) {
  var n = keys.length + old.length, t, seen, i, k, a, tag;
  for (i = 0; i < n; i++) {
    k = typeof (i < keys.length ? keys[i] : old[i - keys.length]);
    if (i === 0) t = k;
    else if (k !== t) break;
  }
  if (i >= n) return;
  // une clé écrite comme dans le code : un texte entre apostrophes, un bigint suivi de `n`
  var written = function(x) { return typeof x === 'string' ? '\'' + x + '\'' : typeof x === 'bigint' ? x + 'n' : String(x); };
  seen = new Map();
  for (i = 0; i < n; i++) {
    k = i < keys.length ? keys[i] : old[i - keys.length];
    a = seen.get(String(k));
    if (a === void 0) {
      seen.set(String(k), k);
      continue;
    }
    if (typeof a === typeof k) continue;
    tag = el.localName;
    if (!_mjsOnce('k ' + tag + ' ' + id)) return;
    a = written(a);
    k = written(k);
    µ.warn(µ._mjs_msg('dev.forKeyTypes', { tag: _mjsWrittenTag(tag), a: a, b: k, id: id }, '{for} : une liste de <{tag}> reçoit la même clé sous deux types, {a} et {b} : ce sont deux clés différentes, sa ligne est refaite au lieu d\'être déplacée. Donnez à toutes les clés de la liste le même type : des nombres partout, ou des textes partout. (cacheId: {id})'));
    return;
  }
};

// <fine-grained>
// lignes propres (mise à jour fine, mjs_for.ts) : ce que montre chaque ligne d'une liste qui a sa table — les champs que lisent ses
// liaisons (`_mjs_fine`, transpiler/index.ts) — relevé à chaque passe de la liste et à chaque écriture servie champ par champ. Une passe
// sur une liste propre compare les lignes qu'elle va sauter : un objet changé hors de MJS est dit, une fois par liste et par composant.
// L'écran reste celui de la production : la ligne garde l'ancienne valeur jusqu'à `µrefresh`
var _mjsSeenRows = new WeakMap();
// la liste `id` du composant : le nom de sa variable et les champs que lisent ses lignes ; rien pour une liste sans table
function _mjsFineList(el, id) {
  var t = el._mjs_fine, k, r, i;
  if (!t) return null;
  for (k in t) {
    r = t[k].r;
    if (r) for (i = 0; i < r.length; i++) if (r[i][0] === id) return { k: k, fields: Object.keys(r[i][1]) };
  }
  return null;
}
// valeurs que montre la ligne d'un objet : ses champs lus, sur l'objet brut ; rien pour une valeur simple
function _mjsSeenRow(it, fields) {
  var o, v, i;
  if (it === null || typeof it !== 'object') return null;
  o = µ._mjs_toRaw(it);
  v = new Array(fields.length);
  for (i = 0; i < fields.length; i++) v[i] = o[fields[i]];
  return v;
}
// `raw` à 2 : passe sur une liste propre (cf. _mjs_skipRow) ; `byKey` : liste à clé (`by`, clés d'une Map), sinon la ligne se nomme par
// son rang
µ._mjs_devClean = function(el, id, raw, cache, keys, items, isArray, keysArr, byKey) {
  var info = _mjsFineList(el, id), seen, before, fresh, i, j, ent, it, v, a, ix, tag;
  if (!info) return;
  seen = _mjsSeenRows.get(el);
  if (!seen) _mjsSeenRows.set(el, seen = {});
  before = raw === 2 ? seen[id] : void 0;
  fresh  = new Map();
  for (i = 0; i < keys.length; i++) {
    if (fresh.has(keys[i])) continue;
    it = items[i];
    v  = _mjsSeenRow(it, info.fields);
    fresh.set(keys[i], v);
    if (!before || !v || !(a = before.get(keys[i]))) continue;
    // ligne que la passe va sauter : pure, posée avant cette passe, même objet, même index si elle le lit
    ent = cache.get(keys[i]);
    ix = isArray ? i : keysArr[i];
    if (!ent || !ent._mjs_p || ent._mjs_init || ent._mjs_it !== it || ent._mjs_p === 1 && ent._mjs_ix !== ix) continue;
    for (j = 0; j < v.length; j++) if (!Object.is(a[j], v[j])) break;
    if (j === v.length) continue;
    tag = el.localName;
    if (_mjsOnce('p ' + tag + ' ' + id)) {
      if (byKey) µ.warn(µ._mjs_msg('dev.forRowChanged', { tag: _mjsWrittenTag(tag), key: String(keys[i]), list: '$' + info.k }, '<{tag}> : la ligne de clé {key} de {list} a changé sans passer par MJS : écrivez µrefresh({list}) après ce changement. La liste ne relit que les lignes qui changent d\'objet ; un objet modifié hors de MJS (variable ordinaire, objet gardé avant son ajout) garde son ancienne valeur à l\'écran.'));
      else µ.warn(µ._mjs_msg('dev.forRowChangedAt', { tag: _mjsWrittenTag(tag), at: String(ix), list: '$' + info.k }, '<{tag}> : la ligne {list}[{at}] a changé sans passer par MJS : écrivez µrefresh({list}) après ce changement. La liste ne relit que les lignes qui changent d\'objet ; un objet modifié hors de MJS (variable ordinaire, objet gardé avant son ajout) garde son ancienne valeur à l\'écran.'));
    }
    before = void 0;
  }
  seen[id] = fresh;
};
// écriture servie champ par champ (mjs_deep.ts) : le champ écrit, sur la ligne de chaque liste qui montre l'objet
µ._mjs_devFineSeen = function(el, r, path, o) {
  var seen = _mjsSeenRows.get(el), i, l, ord, v, j;
  if (!seen) return;
  for (i = 0; i < r.length; i++) {
    l   = seen[r[i][0]];
    ord = el._mjs_list_order && el._mjs_list_order[r[i][0]];
    v   = l && ord && l.get(ord[path[1]]);
    j   = Object.keys(r[i][1]).indexOf(String(path[2]));
    if (v && j !== -1) v[j] = o[path[2]];
  }
};
// </fine-grained>

if (µ.debug) console.log("🧪 [ModularJS] Introspection module armed. Type 'µ.debugMode = true' for visual telemetry.");

if (µ.Element) {
  // objets venus des props : l'écriture profonde de l'élément, ce qu'il envoie par un événement (`_mjs_emit`, mjs_emit.ts, avant ce fichier
  // dans le runtime ; une appli qui n'envoie aucun événement ne l'a pas). Ce qu'il lit est marqué par les accroches `<development>` de
  // mjs_element.ts
  var _mjsChangeBase = µ.Element.prototype._mjs_notifyMutationAliased;
  // <redraw>
  // `rw` : `µrefresh($x)`, qui redessine seulement (mjs_element.ts) — il ne change pas l'objet
  µ.Element.prototype._mjs_notifyMutationAliased = function(obj, rootKey, oldValue, rw) {
    if (!rw && (_mjsReceived.has(this) || _mjsBound.has(this))) _mjsModified(this, obj, rootKey);
    return _mjsChangeBase.call(this, obj, rootKey, oldValue, rw);
  // </redraw>
  // <no-redraw>
  // µ.Element.prototype._mjs_notifyMutationAliased = function(obj, rootKey, oldValue) {
    // if (_mjsReceived.has(this) || _mjsBound.has(this)) _mjsModified(this, obj, rootKey);
    // return _mjsChangeBase.call(this, obj, rootKey, oldValue);
  // </no-redraw>
  };
  // <fine-grained>
  // une écriture servie champ par champ (mise à jour fine, mjs_deep.ts) ne passe pas par ce qui précède : même règle
  µ._mjs_devModified = function(el, obj, rootKey) {
    if (_mjsReceived.has(el) || _mjsBound.has(el)) _mjsModified(el, obj, rootKey);
  };
  // </fine-grained>
  var _mjsEmitBase = µ.Element.prototype._mjs_emit;
  if (_mjsEmitBase) µ.Element.prototype._mjs_emit = function(name, data) {
    if (_mjsReceived.has(this)) _mjsSendData(this, data);
    _mjsEmitters.push(this);
    try {
      return _mjsEmitBase.apply(this, arguments);
    }
    finally {
      _mjsEmitters.pop();
    }
  };
  // 1. Global Registry (Tracks births and deaths)
  originalConnected = µ.Element.prototype.connectedCallback;
  µ.Element.prototype.connectedCallback = function() {
    // un miroir (µclone, copies de *marquee) est une instance : il entre au registre comme les autres
    µ.instances.add(this);
    if (originalConnected) {
      var ret = originalConnected.apply(this, arguments);
      _mjsReceivedSettled(this);
      return ret;
    }
  };
  originalDisconnected = µ.Element.prototype.disconnectedCallback;
  µ.Element.prototype.disconnectedCallback = function() {
    µ.instances.delete(this);
    if (originalDisconnected) {
      return originalDisconnected.apply(this, arguments);
    }
  };
  // 2. Visual Telemetry (Render highlighting)
  // V2 : la méthode vivante est `_mjs_runEffectsV2` (`_runEffects` legacy retirée)
  // — sans cette migration, originalRunEffects était undefined et le wrapper
  // aurait posé un _runEffects mort.
  originalRunEffects = µ.Element.prototype._mjs_runEffectsV2;
  µ.Element.prototype._mjs_runEffectsV2 = function(d, full) {
    var el = this;
    if (µ.debugMode && !this._mjs_has_crashed) {
      // le style du composant n'est lu qu'au premier rendu d'un clignotement : un 2e rendu rapproché ne prend pas le
      // vert pour l'original ; un seul minuteur par composant, réarmé à chaque rendu
      if (!el._mjs_dbgPrev) el._mjs_dbgPrev = { outline: el.style.outline, transition: el.style.transition };
      clearTimeout(el._mjs_dbgTimer);
      el.style.transition = 'none';
      el.style.outline = '2px solid rgba(0, 255, 0, 0.9)';
      el._mjs_dbgTimer = setTimeout(() => {
        el.style.transition = 'outline 0.3s ease-out';
        el.style.outline = el._mjs_dbgPrev.outline;
        el._mjs_dbgTimer = setTimeout(() => {
          el.style.transition = el._mjs_dbgPrev.transition;
          el._mjs_dbgPrev = null;
        }, 300);
      }, 50);
    }
    return originalRunEffects.call(this, d, full);
  };
}

// 3. Custom Chrome Formatters — push (pas d'écrasement : d'autres libs
// — immutable.js, etc. — posent aussi leurs formatters).
(window.devtoolsFormatters || (window.devtoolsFormatters = [])).push(
  {
    header: function(obj) {
      var ref;
      if (obj instanceof HTMLElement && ((ref = obj.tagName) != null ? ref.startsWith('MJS-') : void 0)) {
        return [
          "div",
          {
            style: "color: #e36209; font-weight: bold; background: #fff0f0; padding: 2px 5px; border-radius: 3px;"
          },
          `<${obj.tagName.toLowerCase()}>`
        ];
      }
      return null;
    },
    hasBody: function() {
      return true;
    },
    body: function(obj) {
      return [
        "div",
        {
          style: "padding: 5px 0 5px 20px; background: #f8f9fa; border-left: 3px solid #e36209;"
        },
        [
          "div",
          {},
          [
            "span",
            {
              style: "color: #6f42c1; font-weight: bold;"
            },
            "🧠 Reactive State (@_state): "
          ],
          [
            "object",
            {
              object: obj._state
            }
          ]
        ],
        [
          "div",
          {},
          [
            "span",
            {
              style: "color: #005cc5; font-weight: bold;"
            },
            "🏷️ DOM Nodes (@_mjs_nodes): "
          ],
          [
            "object",
            {
              object: obj._mjs_nodes
            }
          ]
        ],
        [
          "div",
          {},
          [
            "span",
            {
              style: "color: #22863a; font-weight: bold;"
            },
            "🧩 Props & Masks (@_mjs_var_bits): "
          ],
          [
            "object",
            {
              object: obj._mjs_var_bits
            }
          ]
        ]
      ];
    }
  }
);
