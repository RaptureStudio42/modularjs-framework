// mjs_await_derived — valeur dérivée qui attend : `$resultats = await rechercher($q)`. Le compilateur écrit
// `µ._mjs_setAwait(_mjsThis, 'resultats', async (_mjs_sig) => …, ['q'], lu)` à la place d'une dérivée (transpiler/await-derived.ts) :
// les variables qu'elle suit (toutes celles que l'expression cite, même après le premier `await`, et ce que lisent les dérivées
// ordinaires citées, jusqu'à la première valeur qui attend), et `lu` à 1 quand le composant lit son erreur. `µpending($resultats)` et
// `µfailed($resultats)` y lisent son état. Joint au cœur seulement quand une unité de la construction en écrit une
// (bundler/features.ts, clé `await_derived`) ; posé APRÈS mjs_element.ts (il enveloppe `_mjs_invalidate`).
//
// Le composant s'affiche tout de suite : la variable vaut undefined jusqu'à la première réponse. Le premier appel part une fois le
// composant entré dans la page, ses props reçues (le premier rendu demandé par sa connexion, `_awaits_`) ; une valeur qui attend et
// en cite une autre qui attend n'appelle qu'à l'arrivée de celle-ci. Ensuite, un appel quand une variable suivie est écrite (les
// écritures d'un même tour font un seul appel). Chaque appel reçoit le signal d'un AbortController neuf (`µsignal`), celui d'avant
// est annulé ; une réponse dépassée n'est jamais écrite, même sans `µsignal`. Une erreur se lit par `µfailed($x)`, la valeur d'avant
// reste ; la réponse suivante l'efface. Une réponse que la règle du <vars> refuse est un échec de la demande, dit comme toute écriture
// refusée. Une erreur que rien ne lit va à la console d'erreurs (`µ.error`), comme le plantage d'un gestionnaire, sans planter le
// composant ; en développement, le message dit quoi écrire. Le compilateur lit `$x.length`, `$x[0]`, `$x.map(…)` comme avec `?.` : avant la première
// réponse, une telle lecture rend undefined au lieu de lever (une boucle, un étalement, une décomposition lisent `[]` ou `{}`), et le
// développement dit une fois par lecture quoi écrire. Le composant qui quitte la page annule son appel en vol, et plus rien ne s'écrit ni
// ne part ; remis dans la page (déplacé, endormi puis réveillé), il refait la demande coupée, ou celle qu'une variable suivie a demandée
// pendant son absence. Script rejoué par le rechargement à chaud : la valeur affichée reste, la demande se refait une fois. Rendu
// serveur (`<wait-server>`, seulement dans une construction qui peut rendre côté serveur) : `µ._ssrAwait(1)` compte les appels en vol,
// que le rendu attend ; `µ._ssrAwait()` rend les valeurs à ranger dans `#__mjs_store` (clé `__mjsAwait`) ; une demande qui échoue n'y entre
// pas, la page servie reste en attente. Au réveil, un composant de la page servie reprend la valeur à son premier appel, sans rappeler la
// fonction ; un composant créé ensuite par le navigateur appelle

var _mjsAwHasOwn  = Object.prototype.hasOwnProperty;
// valeurs rangées par un rendu serveur : clé d'un appel → `{ v, n }`, la valeur et le nombre de composants servis qui la lisent
var _mjsAwSeed  = null;
// <wait-server>
// rendu serveur : les dérivées qui attendent, lues par µ._ssrAwait
var _mjsAwServed = [];
// </wait-server>
// <wait-dev>
// messages déjà dits : balise, variable et sorte du message
var _mjsAwTold = {};
function _mjsAwFresh(el, k, kind) {
  var c = el.localName + '|' + k + '|' + kind;
  if (_mjsAwHasOwn.call(_mjsAwTold, c)) return false;
  return _mjsAwTold[c] = true;
}
// </wait-dev>

// `v` revient-il identique de JSON : null, un texte, un booléen, un nombre fini, une liste ou un objet simple de telles valeurs ; une Map,
// un Set, une Date, un objet d'une classe, une liste d'une sous-classe ou qui porte d'autres propriétés que ses éléments, undefined (que
// JSON écrit null ou omet), NaN, Infinity, une liste trouée, non
function _mjsAwFaithful(v) {
  var t = typeof v, p, i;
  if (t === 'number') return isFinite(v);
  if (t !== 'object') return t === 'string' || t === 'boolean';
  if (v === null) return true;
  if (Array.isArray(v)) {
    // une liste simple, de cette page ou d'un autre domaine : son prototype est celui des listes (une liste lui-même), et rien d'autre que
    // ses éléments (JSON ne garde qu'eux)
    if (!Array.isArray(Object.getPrototypeOf(v)) || Object.keys(v).length !== v.length) return false;
    for (i = 0; i < v.length; i++) if (!_mjsAwFaithful(v[i])) return false;
    return true;
  }
  // un objet simple, de cette page ou d'un autre domaine (une réponse lue hors de la page) : son prototype est celui des objets, ou aucun
  p = Object.getPrototypeOf(v);
  if (p && Object.getPrototypeOf(p)) return false;
  for (i in v) if (!_mjsAwFaithful(v[i])) return false;
  return true;
}

// le texte JSON de `v`, ou null s'il ne s'y écrit pas (une boucle d'objets) ou n'en revient pas identique (cf. _mjsAwFaithful)
function _mjsAwJson(v) {
  var s;
  try {
    s = JSON.stringify(v);
  }
  catch {
    return null;
  }
  return _mjsAwFaithful(v) ? s : null;
}

// la clé d'un appel : la balise, la variable, le texte JSON des valeurs que l'expression cite ; null, et rien n'est rangé ni repris (le
// navigateur appelle), si l'une d'elles ne revient pas identique de JSON, ou si ce texte passe 2 000 caractères : un résumé plus court
// pourrait tomber sur celui d'un autre état et montrer sa valeur
function _mjsAwKey(el, w) {
  var s = _mjsAwJson(((el._mjs_computedDeps && el._mjs_computedDeps[w.k]) || []).map(function(d) { return el._state[d]; }));
  return s === null || s.length > 2000 ? null : el.localName + '|' + w.k + '|' + s;
}

// page servie : les composants de la première vue d'un composant servi (`replace`), à toute profondeur, notés à l'entrée de celui-ci dans
// la page, sa vue bâtie (son réveil compris), ceux que son premier rendu bâtit dans ses blocs (`{for}`, `{if}`), à la fin de ce rendu
// (µ._mjs_awView), et ceux de la branche d'un `{await}` qu'il lit, bâtie à sa réponse (µ._mjs_awBranch) ; un composant que le navigateur
// crée ensuite (un clic, un `{if}` levé) n'y est pas
var _mjsAwSeen = new WeakSet();
function _mjsAwNote(r) {
  r.querySelectorAll('*').forEach(function(n) {
    if (n.localName.indexOf('-') < 0) return;
    _mjsAwSeen.add(n);
    if (n._shadow && n._shadow !== n) _mjsAwNote(n._shadow);
  });
}

// la valeur que le serveur a rangée pour la clé `g`, prise par un composant de la page servie : rendu par le serveur (`mjs-ssr`, même
// réveillé tard), ou bâti au navigateur par la première vue d'un tel composant (_mjsAwSeen), tant que le serveur a rendu plus de composants
// de cette clé qu'il n'en a été repris ; un composant créé ensuite par le navigateur, sous un hôte servi (un clic, un `{if}` levé) ou
// hors de la page servie, appelle
function _mjsAwTaken(el, g) {
  var e = g !== null && _mjsAwHasOwn.call(_mjsAwSeed, g) ? _mjsAwSeed[g] : null;
  if (!e || !(el.hasAttribute('mjs-ssr') || (_mjsAwSeen.has(el) && e.n > 0))) return null;
  e.n--;
  return e;
}

// l'état de la valeur change (µpending, µfailed), pas la variable : ses lecteurs et les dérivées qui la lisent se refont, les valeurs
// qui attendent et la citent ne sont pas rappelées (`_mjsAwMutes`, lu par l'enveloppe de `_mjs_invalidate`)
var _mjsAwMutes = null;
function _mjsAwWarn(el, k) {
  _mjsAwMutes = k;
  try {
    el._mjs_notifyMutation(k, el._state[k]);
  }
  finally {
    _mjsAwMutes = null;
  }
}

// un appel au tour suivant, un seul pour les écritures du même tour ; parti de la page entre-temps, l'appel attend son retour
function _mjsAwSchedule(el, w) {
  if (w.s) return;
  w.s = 1;
  queueMicrotask(function() {
    if (!w.s) return;
    w.s = 0;
    if (el._mjs_is_mounted) _mjsAwCall(el, w);
    else w.d = 1;
  });
}

// l'échec d'une demande : la valeur d'avant reste, µfailed($x) le lit ; une erreur que rien ne lit (aucun µfailed($x) dans le composant)
// va à la console d'erreurs, comme le plantage d'un gestionnaire (_mjs_catchError), sans planter le composant ; en développement, le
// premier message dit quoi écrire
function _mjsAwFailure(el, w, err) {
  var m;
  w.e = err;
  if (!w.read) {
    m = '<' + el.localName + '> $' + w.k + ' :';
    // <wait-dev>
    // le premier message, lu dans les arguments de son µ.error : un message du développement seul (la production retire ce bloc,
    // l'appel court reste)
    if (_mjsAwFresh(el, w.k, 'e')) µ.error(µ._mjs_msg('awaitedUnread', { tag: el.localName, name: '$' + w.k, msg: String(err && err.message || err) }, '<{tag}> : la demande de {name} a échoué ({msg}) et rien ne lit cette erreur : la valeur d\'avant reste à l\'écran. Lisez-la avec µfailed({name}) pour la montrer.'), err);
    else
    // </wait-dev>
    µ.error(m, err);
  }
  _mjsAwWarn(el, w.k);
  // jamais arrivée : les valeurs qui la citent n'appelleront pas avant son arrivée (cf. _mjsAwCall), elles suivent son échec
  if (!w.ok) _mjsAwTrack(el, w.k, err);
}

// la valeur `k` de `el`, jamais arrivée, a échoué : chaque valeur qui la cite et l'attendait, ou suit déjà un de ses échecs, n'attend plus
// et prend cette erreur (µfailed), sans message de plus, à toute profondeur ; l'arrivée de `k` la relance (l'enveloppe de `_mjs_invalidate`)
function _mjsAwTrack(el, k, err) {
  var t = el._mjs_aw, x, w;
  for (x in t) {
    w = t[x];
    if (w.ok || !(w.p || w.e) || w.t.indexOf(k) < 0) continue;
    w.p = 0;
    w.e = err;
    _mjsAwWarn(el, x);
    _mjsAwTrack(el, x, err);
  }
}

// l'erreur d'une réponse que la règle du <vars> refuse (la console a déjà dit le refus, mjs_types.ts) ; son message nomme la variable,
// et en développement dit la valeur refusée
function _mjsAwReject(el, k, v) {
  var m = '$' + k;
  // <wait-dev>
  try {
    m = JSON.stringify(v);
  }
  catch {
    m = String(v);
  }
  m = µ._mjs_msg('awaitedRefused', { tag: el.localName, name: '$' + k, v: m }, '{name} refuse {v} (<{tag}>) : la réponse de la demande ne suit pas la règle du <vars>, la valeur d\'avant reste.');
  // </wait-dev>
  return new Error(m);
}

// un appel de la fonction ; le premier peut reprendre la valeur d'une page servie
function _mjsAwCall(el, w) {
  var t = el._mjs_aw, awaited = w.p, i, x, n, c, p, g;
  w.s = 0;
  // une valeur qui attend, citée, n'est pas encore arrivée : son arrivée relance celle-ci
  for (i = 0; i < w.t.length; i++) {
    x = w.t[i];
    if (x !== w.k && t[x] && !t[x].ok) return;
  }
  n = ++w.n;
  if (w.c) w.c.abort();
  w.c = null;
  if (n === 1 && _mjsAwSeed) {
    g = _mjsAwKey(el, w);
    x = _mjsAwTaken(el, g);
    if (x) {
      w.p  = 0;
      w.ok = 1;
      // chaque composant reçoit sa copie de la valeur, comme d'un appel
      µ._set(el, w.k, JSON.parse(JSON.stringify(x.v)));
      return;
    }
  }
  c = w.c = new AbortController();
  w.p = 1;
  (el._mjs_attachments ??= new Set()).add(el._mjs_awStop ??= function() { _mjsAwStop(el); });
  try {
    p = Promise.resolve(w.f.call(el._state, c.signal));
  }
  catch (err) {
    p = Promise.reject(err);
  }
  // suivie tant qu'elle est en vol, comme un chargement du runtime : un départ de la page est alors annoncé (cf. µ._mjs_loadFailed)
  if (µ._mjs_loading) p = µ._mjs_loading(p);
  // <wait-server>
  if (µ._isServer || µ.server === true) {
    w.g  = g === void 0 ? _mjsAwKey(el, w) : g;
    w.el = el;
    w.w  = w.m = 0;
    if (_mjsAwServed.indexOf(w) < 0) _mjsAwServed.push(w);
  }
  // </wait-server>
  if (!awaited) _mjsAwWarn(el, w.k);
  p.then(function(v) {
    // dépassée par un appel plus neuf, ou composant parti : jamais écrite
    if (n !== w.n) return;
    var before = el._state[w.k], first = !w.ok, T = el._mjs_types, rejection = null;
    w.c  = null;
    w.p  = 0;
    w.e  = null;
    w.ok = 1;
    // une réponse que la règle du <vars> refuse : un échec de la demande, rien n'est écrit ; levé en mode dur, le refus est l'erreur
    try {
      if (µ._set(el, w.k, v) === false && T && _mjsAwHasOwn.call(T, w.k)) rejection = _mjsAwReject(el, w.k, v);
    }
    catch (err) {
      rejection = err;
    }
    if (rejection) {
      w.ok = first ? 0 : 1;
      return _mjsAwFailure(el, w, rejection);
    }
    // même valeur à l'écran (la réponse, ou ce que la règle du <vars> en garde : 300 ramené à 100) : `_set` n'a prévenu personne ; ses
    // lecteurs revoient l'attente finie ; à la première réponse, les valeurs qui la citent l'apprennent aussi
    v = el._state[w.k];
    if (before === v) {
      if (first) el._mjs_notifyMutation(w.k, v);
      else _mjsAwWarn(el, w.k);
    }
    // <derived-check>
    // première réponse : les valeurs dérivées à règle du composant, que le contrôle n'a pas jugées pendant l'attente (mjs_element.ts)
    if (first && µ._mjs_tderivedAll !== void 0) µ._mjs_tderivedAll(el);
    // </derived-check>
  }, function(err) {
    if (n !== w.n) return;
    // <wait-server>
    // rendu serveur : un échec ne s'écrit jamais dans la page, qui reste en attente (`µpending` vrai, rien n'est rangé) ; le navigateur
    // refait la demande à son réveil. En développement, le rendu le dit dans ses avertissements, que le serveur écrit dans sa console
    // (`µ._ssrAwait(2)`)
    if (µ._isServer || µ.server === true) {
      w.w = 1;
      // <wait-dev>
      w.m = String(err && err.message || err);
      // </wait-dev>
      return;
    }
    // </wait-server>
    w.c = null;
    w.p = 0;
    // une demande annulée volontairement (`AbortError`) n'est pas un échec : l'attente finit, rien ne s'écrit
    if (err && err.name === 'AbortError') return _mjsAwWarn(el, w.k);
    // l'échec, dit par l'aide du cœur (mjs_init.ts) comme celui d'un chargement : aussitôt ; plus tard si un départ de la page est annoncé
    // et que la page reste ; jamais si elle s'en va (la demande coupée par le départ n'est pas une panne). Une demande plus neuve passée
    // entre-temps l'emporte
    var tell = function() { if (n === w.n) _mjsAwFailure(el, w, err); };
    µ._mjs_loadFailed ? µ._mjs_loadFailed(err, tell) : tell();
  });
}

// le composant quitte la page : ses appels en vol sont annulés, leurs réponses ne s'écriront pas ; un appel coupé ou prévu repart au
// retour du composant dans la page (`w.d`), comme une lecture coupée d'un {await}
function _mjsAwStop(el) {
  var t = el._mjs_aw, x, w;
  for (x in t) {
    w = t[x];
    if (w.c || w.s) w.d = 1;
    w.n++;
    w.s = 0;
    w.p = 0;
    if (w.c) w.c.abort();
    w.c = null;
  }
}

// la dérivée `k` du composant `el` attend la promesse que rend `f` (qui reçoit le signal de l'appel) ; `t` : les variables suivies ;
// `lu` : le composant lit son erreur. Aucun appel avant l'entrée du composant dans la page, ses props reçues
µ._mjs_setAwait = function(el, k, f, t, read) {
  var a = el._mjs_aw ??= {}, w = a[k];
  // script rejoué par le rechargement à chaud (la valeur affichée reste dans l'état) : l'appel de l'ancien code est coupé, sa réponse ne
  // s'écrira pas, la demande se refait une fois avec le nouveau
  if (w) {
    w.n++;
    w.s = 0;
    if (w.c) w.c.abort();
  }
  w = a[k] = { k: k, f: f, t: t || [], read: read, n: 0, c: null, p: 1, e: null, s: 0, g: null, el: null, ok: 0, d: 1 };
  if (el._mjs_is_mounted) {
    w.d = 0;
    _mjsAwSchedule(el, w);
  }
};

// `µpending($x)` : vrai tant que la valeur attend une réponse (avant la première, puis pendant chaque appel) ; `µfailed($x)` : l'erreur
// de son dernier appel, sinon null
µ._mjs_awPending = function(el, k) {
  var w = el._mjs_aw && el._mjs_aw[k];
  return !!(w && w.p);
};
µ._mjs_awFailed = function(el, k) {
  var w = el._mjs_aw && el._mjs_aw[k];
  return w ? w.e : null;
};

// la connexion demande le premier rendu (`_awaits_`), props reçues : le premier appel part, ou celui qui attendait le retour du composant
// dans la page ; ensuite, une variable suivie est écrite — hors de la page, l'appel attend son retour
var __mjsAwProto = µ.Element.prototype, __mjsAwInv = __mjsAwProto._mjs_invalidate;
__mjsAwProto._mjs_invalidate = function(k) {
  var r = __mjsAwInv.apply(this, arguments), t = this._mjs_aw, x, w;
  // page servie : un composant servi, ou de la première vue d'un tel composant, note la sienne en entrant dans la page, une fois (avant la
  // fin de son premier rendu) ; une invalidation `_awaits_` qui vient ensuite (état de module, µ.Store, µload, langue) ne la reparcourt pas
  if (k === '_awaits_' && _mjsAwSeed && this._mjs_initial_render !== false && this._shadow && (this.hasAttribute('mjs-ssr') || _mjsAwSeen.has(this))) _mjsAwNote(this._shadow);
  if (k === _mjsAwMutes) return r;
  for (x in t) {
    w = t[x];
    if (w.d) {
      if (k !== '_awaits_' || !this._mjs_is_mounted) continue;
      w.d = 0;
    }
    else if (w.t.indexOf(k) < 0) continue;
    else if (!this._mjs_is_mounted) {
      w.d = 1;
      continue;
    }
    _mjsAwSchedule(this, w);
  }
  return r;
};

// page servie : les composants que le premier rendu d'un composant servi, ou de la première vue d'un tel composant, bâtit dans ses blocs
// (`{for}`, `{if}`) n'existent pas encore à son entrée dans la page ; la fin de ce rendu les note (mjs_element.ts), avant leur premier appel
µ._mjs_awView = function(el) {
  if (_mjsAwSeed && el._shadow && (el.hasAttribute('mjs-ssr') || _mjsAwSeen.has(el))) _mjsAwNote(el._shadow);
};
// <wait-branch>
// la branche `b` d'un `{await}` lu par ce premier rendu, bâtie au rendu qui suit sa réponse (mjs_await.ts) : ses composants, à toute
// profondeur, sont notés avant d'entrer dans la page, eux seuls ; un composant qu'une écriture faite avec la réponse bâtit dans ce même
// rendu, hors de la branche, ou que le navigateur bâtit ensuite (un clic, une relecture), appelle. Retirée sans bloc `{await}` dans la
// construction (mjs_await.ts, seul à l'appeler)
µ._mjs_awBranch = (el, b) => (_mjsAwSeed && (el.hasAttribute('mjs-ssr') || _mjsAwSeen.has(el)) && _mjsAwNote(b.fragment), b);
// </wait-branch>

// <wait-dev>
// lecture protégée d'une valeur qui attend (`$x.length` écrit `µ._mjs_awSeen($.x, _mjsThis, 'x', '$x.length', '($x or []).length')?.length` par le
// compilateur, en développement seulement ; en production `$.x?.length`) : encore undefined avant sa première réponse, le développement dit une
// fois par variable et par composant quoi écrire, avec le conseil de la forme lue (`conseil`) ; sans conseil (un champ qui n'est pas celui
// d'une liste, `$x.nom`), ce que rend la lecture et µpending ; la valeur est rendue telle quelle
µ._mjs_awSeen = function(v, el, k, written, tip) {
  var w = v === void 0 && el._mjs_aw && el._mjs_aw[k];
  if (w && !w.ok && _mjsAwFresh(el, k, 'l')) {
    if (tip) µ.warn(µ._mjs_msg('awaitedEarly', { tag: el.localName, name: '$' + k, written: written, tip: tip }, '<{tag}> : {written} lit {name} avant sa première réponse, quand elle vaut encore undefined. Écrivez {tip}, ou testez µpending({name}) avant de la lire.'));
    else µ.warn(µ._mjs_msg('awaitedEarlyField', { tag: el.localName, name: '$' + k, written: written }, '<{tag}> : {written} lit {name} avant sa première réponse, quand elle vaut encore undefined : la lecture rend undefined. Testez µpending({name}) pour montrer l\'attente.'));
  }
  return v;
};
// </wait-dev>

// <wait-server>
// rendu serveur (nom long, lu par le serveur hors de ce bundle) : `µ._ssrAwait(1)` le nombre d'appels en vol, que le rendu attend (une
// demande en échec n'y compte plus) ; `µ._ssrAwait()` les valeurs arrivées, par clé d'appel, avec le nombre de composants qui la lisent
// (`{ v, n }`) : celles d'un composant resté dans la page, qui reviennent identiques de JSON ; `µ._ssrAwait(2)`, en développement, les
// demandes qui ont échoué, que le rendu dit dans ses avertissements
µ._ssrAwait = function(what) {
  var d = what === 1 ? 0 : null;
  _mjsAwServed.forEach(function(w) {
    var v = w.el._state[w.k];
    if (what === 1) {
      if (w.p && !w.w) d++;
    }
    // <wait-dev>
    else if (what) {
      if (w.m) (d || (d = [])).push({ tag: w.el.localName, name: '$' + w.k, message: w.m });
    }
    // </wait-dev>
    else if (!what && !w.p && !w.e && w.g !== null && w.n > 0 && w.el.isConnected && _mjsAwJson(v) !== null) {
      v = (d || (d = {}))[w.g] || (d[w.g] = { v: v, n: 0 });
      v.n++;
    }
  });
  return d;
};
// </wait-server>

// reprise : les valeurs rangées par un rendu serveur dans `#__mjs_store` (clé `__mjsAwait`), lues une fois au démarrage et prises par les
// composants de la page servie (cf. _mjsAwTaken) ; le magasin `$$` (mjs_store_globals.ts), qui lit la même balise, ne la garde pas
try {
  var __mjsAwTag = typeof document !== 'undefined' && document.getElementById ? document.getElementById('__mjs_store') : null;
  var __mjsAwRead     = __mjsAwTag && __mjsAwTag.textContent ? JSON.parse(__mjsAwTag.textContent).__mjsAwait : null;
  if (__mjsAwRead && typeof __mjsAwRead === 'object') _mjsAwSeed = __mjsAwRead;
  if (µ._mjs_storeRaw && _mjsAwHasOwn.call(µ._mjs_storeRaw, '__mjsAwait') && µ._mjs_storeDelete) µ._mjs_storeDelete('__mjsAwait');
}
catch {
  // reprise au mieux : une balise illisible ne casse jamais le démarrage
}
