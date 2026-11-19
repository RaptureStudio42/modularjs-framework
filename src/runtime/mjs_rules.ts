// mjs_rules — les règles du bloc <vars> dans la langue commune des validateurs (Standard Schema v1) : `µ.rules(el)` (la rune
// `µrules(@)`) rend celles des variables et des props d'un composant, `µ.rules()` celles des stores, chacune sous la forme
// `{ '~standard': { version: 1, vendor: 'mjs', validate } }` ; l'ensemble est lui-même un schéma, celui d'un objet dont chaque champ
// passe la règle de son nom (un champ absent est refusé, comme une variable qui recevrait `undefined`). `validate(valeur)` rend
// `{ value }` — la valeur telle que la variable l'écrirait, conversions faites (`'42'` → `42`) — ou `{ issues: [{ message, path }] }` :
// une valeur refusée, hors de sa plage (la variable l'aurait ramenée à la borne ; un validateur le dit) ou, sous une règle `int`, un
// nombre non entier (la variable l'aurait arrondi), avec un message dans la langue de la page (vouvoiement ; surcharge du projet : clés
// i18n `mjs.rules.*`) et son chemin (`['tags', 2]`). Une liste ou un objet nomme chacun de ses champs refusés, pas seulement le premier.
// Un formulaire reçu (FormData, URLSearchParams) se contrôle comme l'objet de ses champs, lus le long de la règle (`_mjsRulesForm` :
// `tags` ou `tags[]` en liste, `adr.city` dans l'objet `adr`) ; une liste d'objets ou de listes, qu'un formulaire ne peut pas porter,
// y est refusée par un message qui le dit.
// La valeur reçue n'est jamais modifiée : chaque contrôle porte sur une copie, faite le long de la règle (les champs qu'elle ne déclare
// pas sont gardés tels quels).
// Le contrôle est celui de chaque écriture (`µ._mjs_tcheck`, mjs_types.ts), qui garde son comportement : ce fichier ne fait que le dire.
// Fichier détecté (clé 'rules'), embarqué seulement si le projet écrit `µrules` (ou `µ.rules`) ; un nom fabriqué à l'exécution se
// demande par `runtime: ['rules']`. Le module serveur `modularjs-framework/rules` charge ce même fichier, sans navigateur

var _mjsRulesHas = Object.prototype.hasOwnProperty;

// les messages, en clair : {r} la plage d'un nombre, {a} {b} ses bornes, {v} les valeurs permises, {s} la marque du pluriel du nombre
// cité (`s` ou rien)
var _MJS_RULES_TXT = {
  fr: {
    required: 'Ce champ est obligatoire',
    int:      'Saisissez un nombre entier{r}',
    float:    'Saisissez un nombre{r}',
    range:    ' de {a} à {b}',
    atLeast:  ' d\'au moins {a}',
    atMost:   ' d\'au plus {b}',
    text:     'Saisissez un texte',
    chars:    'Saisissez de {a} à {b} caractère{s}',
    charsMin: 'Saisissez au moins {a} caractère{s}',
    charsMax: 'Saisissez au plus {b} caractère{s}',
    format:   'Ce texte n\'a pas la forme attendue',
    bool:     'Choisissez oui ou non',
    one:      'Choisissez parmi : {v}',
    or:       'ou',
    list:     'Une liste est attendue',
    items:    'Choisissez de {a} à {b} élément{s}',
    itemsMin: 'Choisissez au moins {a} élément{s}',
    itemsMax: 'Choisissez au plus {b} élément{s}',
    object:   'Un objet est attendu',
    refused:  'Cette valeur n\'est pas permise',
    form:     'Un formulaire ne peut pas remplir ce champ (liste d\'objets ou de listes)'
  },
  en: {
    required: 'This field is required',
    int:      'Enter a whole number{r}',
    float:    'Enter a number{r}',
    range:    ' from {a} to {b}',
    atLeast:  ' of at least {a}',
    atMost:   ' of at most {b}',
    text:     'Enter some text',
    chars:    'Enter {a} to {b} character{s}',
    charsMin: 'Enter at least {a} character{s}',
    charsMax: 'Enter at most {b} character{s}',
    format:   'This text does not have the expected form',
    bool:     'Choose yes or no',
    one:      'Choose one of: {v}',
    or:       'or',
    list:     'A list is expected',
    items:    'Choose {a} to {b} item{s}',
    itemsMin: 'Choose at least {a} item{s}',
    itemsMax: 'Choose at most {b} item{s}',
    object:   'An object is expected',
    refused:  'This value is not allowed',
    form:     'A form cannot fill this field (list of objects or lists)'
  }
};

// le texte `k` dans la langue de la page : celui du projet (`mjs.rules.<k>`), sinon celui d'ici — langue inconnue : celle du
// build, sinon l'anglais ; `o.c` : le nombre cité, dont `{s}` marque le pluriel (à partir de 2 en français, hors 1 ailleurs)
function _mjsRulesTxt(k, o) {
  var l = typeof µ._mjs_labelLang === 'function' ? µ._mjs_labelLang() : '';
  var t = typeof µ._mjs_label === 'function' ? µ._mjs_label('rules', k) : void 0;
  if (typeof t !== 'string') {
    l = _MJS_RULES_TXT[l] ? l : _MJS_RULES_TXT[µ._runtimeLabelsLang] ? µ._runtimeLabelsLang : 'en';
    t = _MJS_RULES_TXT[l][k];
  }
  if (o && o.c !== void 0) o.s = (l === 'fr' ? o.c >= 2 : o.c !== 1) ? 's' : '';
  return String(t).replace(/\{(\w+)\}/g, function(m, n) { return o && o[n] !== void 0 ? o[n] : m; });
}

// le message `k` d'une plage (`k` : celui des deux bornes, suivi de `Min` ou `Max` pour une seule ; le nombre cité est la borne
// haute, sinon la basse ; aucune borne : la valeur n'est pas permise) ; `k === ''` : la plage d'un nombre
function _mjsRulesRange(r, k) {
  var o = { a: r.a, b: r.b };
  if (k !== '') {
    if (r.a === void 0 && r.b === void 0) return _mjsRulesTxt('refused');
    o.c = r.b !== void 0 ? r.b : r.a;
    return _mjsRulesTxt(r.a !== void 0 && r.b !== void 0 ? k : r.a !== void 0 ? k + 'Min' : k + 'Max', o);
  }
  return r.a !== void 0 && r.b !== void 0 ? _mjsRulesTxt('range', o) : r.a !== void 0 ? _mjsRulesTxt('atLeast', o) : r.b !== void 0 ? _mjsRulesTxt('atMost', o) : '';
}

// copie de `v` le long de la règle `r` : une liste, un objet simple neufs à chaque niveau qu'elle déclare, le reste tel quel — le
// contrôle écrit ses conversions sur place, jamais dans la valeur reçue. Les clés `__proto__`, `constructor`, `prototype` d'une donnée
// reçue (JSON) sont laissées, comme partout ailleurs
function _mjsRulesCopy(r, v) {
  v = typeof µ._mjs_toRaw === 'function' ? µ._mjs_toRaw(v) : v;
  var c, k, i;
  if (r.t === 'u') {
    for (i = 0; i < r.u.length; i++) v = _mjsRulesCopy(r.u[i], v);
    return v;
  }
  if (r.t === 'a' && Array.isArray(v)) {
    c = [];
    for (i = 0; i < v.length; i++) c[i] = _mjsRulesCopy(r.e, v[i]);
    return c;
  }
  if (r.t !== 'o' || v === null || typeof v !== 'object' || Array.isArray(v)) return v;
  c = {};
  for (k in v) if (_mjsRulesHas.call(v, k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') c[k] = _mjsRulesHas.call(r.f, k) ? _mjsRulesCopy(r.f[k], v[k]) : v[k];
  return c;
}

// la règle accepte null (`int 1..10 | null`, `'a' | 'b' | null`)
function _mjsRulesNull(r) {
  if (r.t === 'l') return r.v.indexOf(null) >= 0;
  if (r.t === 'u') for (var i = 0; i < r.u.length; i++) if (_mjsRulesNull(r.u[i])) return true;
  return false;
}

// la règle de type `t` : `r` elle-même ou l'une des règles d'un choix, sinon undefined
function _mjsRulesPick(r, t) {
  if (r.t === 'u') for (var i = 0; i < r.u.length; i++) if (r.u[i].t === t) return r.u[i];
  return r.t === t ? r : void 0;
}

// un nombre non entier sous une règle int, que le contrôle de chaque écriture arrondit : un validateur le refuse. Dans un choix, seule
// compte la règle que ce contrôle retient (une valeur exacte d'abord, sinon la première qui sait la convertir ou la ramener)
function _mjsRulesFrac(r, v) {
  var i, k, s, c = -1;
  v = typeof µ._mjs_toRaw === 'function' ? µ._mjs_toRaw(v) : v;
  if (r.t === 'i') {
    if (typeof v === 'string') v = +v.trim();
    return typeof v === 'number' && isFinite(v) && v % 1 !== 0;
  }
  if (r.t === 'a') {
    if (Array.isArray(v)) for (i = 0; i < v.length; i++) if (_mjsRulesFrac(r.e, v[i])) return true;
    return false;
  }
  if (r.t === 'o') {
    if (v !== null && typeof v === 'object') for (k in r.f) if (_mjsRulesHas.call(r.f, k) && _mjsRulesFrac(r.f[k], v[k])) return true;
    return false;
  }
  if (r.t !== 'u') return false;
  for (i = 0; i < r.u.length; i++) {
    s = µ._mjs_tcheck(r.u[i], _mjsRulesCopy(r.u[i], v)).s;
    if (s === 0) { c = i; break; }
    if (s > 0 && c < 0) c = i;
  }
  return c >= 0 && _mjsRulesFrac(r.u[c], v);
}

// statut du contrôle de `v` par `r` (0 telle quelle, 1 convertie, 2 ramenée, -1 refusée), sur une copie ; un nombre non entier sous
// une règle int est refusé
function _mjsRulesStatus(r, v) {
  var s = µ._mjs_tcheck(r, _mjsRulesCopy(r, v)).s;
  return (s === 0 || s === 1) && _mjsRulesFrac(r, v) ? -1 : s;
}

// le message d'une valeur `v` que la règle `r` refuse ou ramène, à son niveau (ses champs et ses éléments ont été vus avant) ; une
// valeur vide n'est obligatoire que si la règle refuse null (`none` : elle l'accepte, par le choix qui la contient)
function _mjsRulesSaid(r, v, none) {
  var l;
  if (!none && !_mjsRulesNull(r) && (v === void 0 || v === null || v === '' || (Array.isArray(v) && v.length === 0))) return _mjsRulesTxt('required');
  // passée sans ses interdits : c'est un interdit qui la refuse
  if (r.n !== void 0) {
    var s = _mjsRulesStatus(Object.assign({}, r, { n: void 0 }), v);
    if (s === 0 || s === 1) return _mjsRulesTxt('refused');
  }
  switch (r.t) {
    case 'i': return _mjsRulesTxt('int', { r: _mjsRulesRange(r, '') });
    case 'f': return _mjsRulesTxt('float', { r: _mjsRulesRange(r, '') });
    case 's':
      if (typeof v === 'object' || typeof v === 'function') return _mjsRulesTxt('text');
      var n = Array.from(String(v)).length;
      return (r.a !== void 0 && n < r.a) || (r.b !== void 0 && n > r.b) ? _mjsRulesRange(r, 'chars') : _mjsRulesTxt('format');
    case 'b': return _mjsRulesTxt('bool');
    case 'l':
      // null n'est jamais proposé comme un choix
      l = r.v.filter(function(x) { return x !== null; });
      if (l.length > 0) return _mjsRulesTxt('one', { v: l.slice(0, -1).map(String).join(', ') + (l.length > 1 ? ' ' + _mjsRulesTxt('or') + ' ' : '') + String(l[l.length - 1]) });
      break;
    case 'a': return Array.isArray(v) ? _mjsRulesRange(r, 'items') : _mjsRulesTxt('list');
    case 'o': return _mjsRulesTxt('object');
    case 'u':
      // une règle ou null : le message de cette règle
      l = r.u.filter(function(x) { return !(x.t === 'l' && x.v.length === 1 && x.v[0] === null); });
      if (l.length === 1) return _mjsRulesSaid(l[0], v, true);
  }
  return _mjsRulesTxt('refused');
}

// les refus de `v` sous `r`, au plus profond : chaque champ et chaque élément refusés d'un objet ou d'une liste ont le leur ; un
// conteneur n'a le sien que si aucun de ses champs ne l'explique (pas un objet, nombre d'éléments hors plage). Une règle ou null
// (`int[] | null`) : la valeur se lit sous cette règle, jusque dans ses éléments, null y restant permis (`none`)
function _mjsRulesWalk(r, v, path, out, none) {
  var s = _mjsRulesStatus(r, v);
  if (s === 0 || s === 1) return;
  var n = out.length, k, i, l;
  v = typeof µ._mjs_toRaw === 'function' ? µ._mjs_toRaw(v) : v;
  if (r.t === 'u') {
    l = r.u.filter(function(x) { return !(x.t === 'l' && x.v.length === 1 && x.v[0] === null); });
    if (l.length === 1 && l.length < r.u.length) return _mjsRulesWalk(l[0], v, path, out, true);
  }
  if (r.t === 'o' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
    for (k in r.f) {
      if (!_mjsRulesHas.call(r.f, k)) continue;
      if (v[k] === void 0 && r.o !== void 0 && r.o.indexOf(k) >= 0) continue;
      _mjsRulesWalk(r.f[k], v[k], path.concat(k), out);
    }
  }
  else if (r.t === 'a' && Array.isArray(v) && (r.a === void 0 || v.length >= r.a) && (r.b === void 0 || v.length <= r.b)) {
    for (i = 0; i < v.length; i++) _mjsRulesWalk(r.e, v[i], path.concat(i), out);
  }
  if (out.length === n) out.push({ message: _mjsRulesSaid(r, v, none), path: path });
}

// un formulaire reçu (`e` : ses champs en paires [nom, valeur], dans l'ordre) en objet, lu le long des champs de la règle : un champ
// de liste prend toutes ses valeurs, sous son nom ou suivi de `[]` (`tags[]`) ; une case à cocher (règle bool) absente vaut false,
// cochée (`on`, `true`, `1`) true ; un champ objet prend ses champs nommés après un point (`adr.city`, à toute profondeur) ; un champ
// vide ou absent d'une règle qui accepte null vaut null, liste (chacune de ses valeurs vide) et case à cocher comprises ; tout autre
// champ, sa dernière valeur (le texte d'un nombre est converti par
// le contrôle), y compris ceux que la règle ne déclare pas (un fichier reçu reste un fichier)
function _mjsRulesForm(r, e) {
  var o = {}, k, x, l, c, v, i, n, a, b;
  for (i = 0; i < e.length; i++) if (e[i][0] !== '__proto__' && e[i][0] !== 'constructor' && e[i][0] !== 'prototype') o[e[i][0]] = e[i][1];
  for (k in r.f) {
    if (!_mjsRulesHas.call(r.f, k)) continue;
    x = r.f[k];
    l = [];
    c = [];
    for (i = 0; i < e.length; i++) {
      n = e[i][0];
      if (n === k || n === k + '[]') l.push(e[i][1]);
      else if (n.length > k.length + 1 && n.slice(0, k.length + 1) === k + '.') c.push([n.slice(k.length + 1), e[i][1]]);
    }
    v = l[l.length - 1];
    a = _mjsRulesPick(x, 'a');
    b = _mjsRulesPick(x, 'o');
    if (_mjsRulesNull(x) && c.length === 0 && (a ? l.join('') === '' : v === void 0 || v === '')) {
      o[k] = null;
      if (a) delete o[k + '[]'];
    }
    else if (a) {
      o[k] = l;
      delete o[k + '[]'];
    }
    else if (_mjsRulesPick(x, 'b')) o[k] = v === void 0 || v === 'off' || v === 'false' || v === '0' ? false : v === 'on' || v === 'true' || v === '1' ? true : v;
    else if (b && c.length > 0) {
      o[k] = _mjsRulesForm(b, c);
      for (i = 0; i < c.length; i++) delete o[k + '.' + c[i][0]];
    }
  }
  return o;
}

// les champs qu'un formulaire ne peut pas remplir, à toute profondeur de ses objets : une liste d'objets ou de listes
function _mjsRulesUnfit(r, path, bad) {
  var k, a, b;
  for (k in r.f) {
    if (!_mjsRulesHas.call(r.f, k)) continue;
    a = _mjsRulesPick(r.f[k], 'a');
    b = _mjsRulesPick(r.f[k], 'o');
    if (a && (_mjsRulesPick(a.e, 'o') || _mjsRulesPick(a.e, 'a'))) bad.push(path.concat(k));
    else if (b) _mjsRulesUnfit(b, path.concat(k), bad);
  }
  return bad;
}

// `validate` d'une règle : la valeur convertie, ou ses refus ; un formulaire reçu se lit d'abord en objet — un champ qu'il ne peut pas
// remplir (liste d'objets ou de listes) est alors seul refusé, par un message qui le dit
function _mjsRulesValidate(r, v) {
  var e = [], bad;
  if (r.t === 'o' && v !== null && typeof v === 'object' && typeof v.getAll === 'function' && typeof v.forEach === 'function') {
    bad = _mjsRulesUnfit(r, [], []);
    if (bad.length > 0) return { issues: bad.map(function(p) { return { message: _mjsRulesTxt('form'), path: p }; }) };
    v.forEach(function(w, n) { e.push([n, w]); });
    v = _mjsRulesForm(r, e);
  }
  var x = µ._mjs_tcheck(r, _mjsRulesCopy(r, v));
  if ((x.s === 0 || x.s === 1) && !_mjsRulesFrac(r, v)) return { value: x.v };
  var out = [];
  _mjsRulesWalk(r, v, [], out);
  return { issues: out };
}

function _mjsRulesSchema(r) {
  return { '~standard': { version: 1, vendor: 'mjs', validate: function(v) { return _mjsRulesValidate(r, v); } } };
}

// les règles d'un composant (ses variables et ses props), ou celles des stores sans composant, relues à chaque appel (celle d'un
// store arrive avec le composant qui la pose) : un schéma par règle, et celui de l'objet qui les réunit
µ.rules = function(el) {
  var T   = (el ? el._mjs_types : µ._mjs_storeRules) || {};
  var out = {};
  var f   = {};
  for (var k in T) {
    if (!_mjsRulesHas.call(T, k)) continue;
    f[k]   = T[k];
    out[k] = _mjsRulesSchema(T[k]);
  }
  out['~standard'] = _mjsRulesSchema({ t: 'o', f: f })['~standard'];
  return out;
};
