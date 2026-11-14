// mjs_types_select — la liaison d'une liste du cœur (`<@@select value=!{$x}>`) à une variable de règle (bloc <vars>, mjs_types.ts) :
// chaque choix jugé comme celui d'une liste native, par les mêmes fonctions (mjs_types_bind.ts, que le garde d'un champ natif lit
// aussi ; _mjsTAt, mjs_types.ts, qui trouve l'option d'une valeur), et la valeur de la variable montrée comme une liste native la
// montre, de nouveau quand ses options changent (µ._mjs_topts). Fichier détecté (clé 'types_select') : le compilateur n'écrit
// `µ._mjs_tpick(` et `µ._mjs_tshow(` que pour une <@@select> liée à une variable de règle ; une appli dont les listes du cœur sont liées
// à des variables libres n'en paie pas un octet

// la valeur acceptée en dernier par chaque liste du cœur liée à une variable de règle, comme la garde le garde d'une liste native
var _mjsTGood = new WeakMap();

// la valeur de sa variable de règle que la liaison a montrée en dernier à chaque liste du cœur (µ._mjs_tshow), relue quand ses options
// changent (µ._mjs_topts)
var _mjsTVar = new WeakMap();

// les textes des options de la liste du cœur `n`
function _mjsTOs(n) {
  return (n._state.optionsData || []).map(o => String(o.value));
}

// les valeurs `d` de la liste à choix multiples `n` comme une liste native les lit parmi les textes de ses options `os` : chaque option
// choisie une fois, dans l'ordre des options, sous la première valeur qui la choisit (_mjsTAt : son texte exact, sinon celui qui écrit
// autrement ce nombre) — « 5 » puis « 02 » cochés quand 2 l'est donnent 2, « 02 », 5 ; une valeur qu'aucune option ne porte s'y perd,
// comme dans une liste native, sauf dans une liste qui accepte une réponse libre (`other` : son état `otherMax`, absent quand aucune
// liste de l'appli n'écrit `other`), où elle reste, après elles ; tant qu'aucune option n'est lue, les valeurs telles quelles
function _mjsTMany(n, os, d) {
  if (!os.length) return d;
  var at   = d.map(b => _mjsTAt(os, b));
  var seen = new Set();
  var t    = [];
  os.forEach(o => {
    var i = at.indexOf(o);
    if (i >= 0 && !seen.has(o)) {
      seen.add(o);
      t.push(d[i]);
    }
  });
  return n._state.otherMax ? t.concat(d.filter((b, i) => at[i] === void 0)) : t;
}

// ce que montre la liste `n` liée à une variable de règle qui vaut `v`, comme une liste native : null sur son option vide (sans option
// vide, aucun choix), à choix multiples chaque option une fois, dans l'ordre des options (µ._mjs_tsel, mjs_types.ts)
function _mjsTView(n, os, v) {
  return Array.isArray(v) ? _mjsTMany(n, os, v) : v == null ? '' : v;
}

// deux valeurs d'une liste égales, une liste de valeurs comparée valeur par valeur
function _mjsTSame(a, b) {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
}

// la liste `n` montre la valeur `v` de sa variable de règle comme une liste native la montre, posée quand elle montre autre chose
function _mjsTPut(n, os, v) {
  var t = _mjsTView(n, os, v);
  if (!_mjsTSame(t, n._state.value)) n._set('value', t);
}

// liaison d'une liste du cœur (`<@@select>`) à une variable de règle `r` qui vaut `v` : chaque choix `d` qu'annonce la liste `el` (le
// texte de son option, une liste de textes à choix multiples, lue alors comme une liste native la lit : _mjsTMany) se juge comme le
// garde juge celui d'une liste native (mjs_fx_guard.ts), par les mêmes fonctions — lu par µ._mjs_traw, contrôlé par µ._mjs_tcheck.
// Accepté, converti compris (`2.4` sous `int` qui vaut 2), la liaison l'écrit et la liste garde l'option choisie ; ramené à la borne,
// la liste montre l'option qui l'écrit, trouvée comme µ._mjs_tsel la trouve, et la variable la reçoit — sans cette option, ou quand
// la liste ramenée sort encore de la règle, il est refusé ; refusé, la variable garde sa valeur et la liste revient sur µ._mjs_tback
// (à choix multiples, sur la valeur de la variable). Rend ce que la liaison écrit, µ._mjs_TNO pour rien : aussi pour la liste que la
// liaison vient de montrer (_mjsTPut), qu'elle annonce à son tour — la variable `[2, 2, 5]`, montrée « 2 », « 5 », reste ainsi à
// `[2, 2, 5]`, comme sous une liste native. Sans règle encore (celle d'un magasin arrive avec le composant qui la pose), ou à choix
// multiples sous une règle qui n'est pas une liste, le choix passe tel quel
µ._mjs_tpick = function(el, r, d, v) {
  var many = Array.isArray(d);
  if (!r || many && !µ._mjs_tlist(r)) return d;
  var os = _mjsTOs(el);
  if (_mjsTSame(d, _mjsTView(el, os, v))) return µ._mjs_TNO;
  if (many) d = _mjsTMany(el, os, d);
  var w = µ._mjs_traw(r, d);
  var x = µ._mjs_tcheck(r, w);
  if (x.s === 2) {
    // ramené : la liste relue comme ses options la montrent (une liste native choisit l'option de chaque valeur, dans leur ordre)
    d = many ? os.filter(o => x.v.some(b => _mjsTAt(os, b) === o)) : _mjsTAt(os, x.v);
    w = d === void 0 ? d : µ._mjs_traw(r, d);
    x = d === void 0 ? { s: -1 } : µ._mjs_tcheck(r, w);
    if (x.s === 0 || x.s === 1) el._set('value', d);
  }
  if (x.s === 0 || x.s === 1) {
    _mjsTGood.set(el, w);
    return w;
  }
  // refusé : la variable garde sa valeur, que la liste montre de nouveau — une liste simple sur la dernière bonne tant qu'elle la donne
  _mjsTPut(el, os, many ? v : µ._mjs_tback(r, _mjsTGood.get(el), v, _mjsTGood.get(el)));
  return µ._mjs_TNO;
};

// la liaison d'une liste du cœur à une variable de règle lui montre la valeur `v` comme une liste native la montre (_mjsTPut) : null
// sur son option vide, à choix multiples chaque option une fois, dans leur ordre ; rend faux, la liste déjà posée
µ._mjs_tshow = function(n, v) {
  _mjsTVar.set(n, v);
  _mjsTPut(n, _mjsTOs(n), v);
  return false;
};

// les options de la liste du cœur `n` liée à une variable de règle viennent de changer (son module l'annonce : `typed`, select.mjs) : à
// choix multiples, elle montre de nouveau la valeur de sa variable parmi elles, comme une liste native qui reçoit ses options après sa
// valeur (`{for}`) — avant que la liaison ne la lui montre (registre du développement), la valeur qu'elle a reçue, retenue à leur
// première lecture ; une liste simple montre sa valeur sans ses options
µ._mjs_topts = function(n) {
  if (!_mjsTVar.has(n)) _mjsTVar.set(n, n._state.value);
  var v = _mjsTVar.get(n);
  if (Array.isArray(v)) _mjsTPut(n, _mjsTOs(n), v);
};
