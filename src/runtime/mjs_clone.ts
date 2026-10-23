// mjs_clone — `µ.clone(el)` (la rune `µclone el`) : une balise NEUVE du même composant, pas encore dans la page, qui monte avec une COPIE
// des données de l'état de l'original au moment de l'appel (ses variables `$`, ses props), puis vit seule. `µ.clone(el, { mirror: true })`
// (`µclone el, mirror: true`) : son MIROIR VIVANT, qui partage l'état de l'original (cf. `_mjsMirror`). Fichier détecté (clé 'clone'), embarqué
// seulement si le projet écrit `clone` ; un nom fabriqué à l'exécution (`µ['clo' + 'ne']`), que la construction ne voit pas, se demande
// par `runtime: ['clone']`.
// rien au cœur : l'état copié rejoint le registre des props retenues jusqu'au montage (µ._mjs_pending, mjs_init.ts), que la connexion
// verse dans l'état par `_set`, clé par clé, avant le premier rendu — le chemin des props qu'un parent pose sur un enfant pas encore
// monté. La copie a son script, ses reffets, son µmount, ses écouteurs ; le magasin `$$`, global, reste celui de tous

// copie PROFONDE d'une DONNÉE : valeur simple, objet simple (prototype d'Object, ou aucun), liste, Map (clés comprises), Set, Date ; une
// donnée tenue deux fois, ou qui se contient, n'est copiée qu'une fois (`vu` : les copies des variables déjà déposées, `neuf` : celles
// de la variable en cours). Une valeur lue par l'enveloppe réactive de l'original est copiée depuis son brut ; les clés `__proto__`,
// `constructor`, `prototype` d'une donnée reçue (JSON) sont laissées, comme partout ailleurs. Tout le reste — fonction, instance de
// classe (un ressort µspring compris), élément du DOM, promesse —, à quelque profondeur que ce soit, n'est pas une donnée : levée de
// `_mjsCloneNo`, la variable n'est pas déposée et la copie garde la valeur que son propre script lui donne. Recopiée telle quelle, une
// fonction de l'original (`$valider = -> $n++`) remplacerait celle de la copie et la relierait à l'original
var _mjsCloneNo = {};

function _mjsCloneData(v, vu, neuf) {
  v = µ._mjs_toRaw(v);
  if (typeof v === 'function') throw _mjsCloneNo;
  if (v === null || typeof v !== 'object') return v;
  var c = vu.get(v) || neuf.get(v), p;
  if (c) return c;
  if (Array.isArray(v)) {
    neuf.set(v, c = []);
    for (var i = 0; i < v.length; i++) c[i] = _mjsCloneData(v[i], vu, neuf);
  }
  else if (v instanceof Map) {
    neuf.set(v, c = new Map());
    v.forEach(function(x, k) { c.set(_mjsCloneData(k, vu, neuf), _mjsCloneData(x, vu, neuf)); });
  }
  else if (v instanceof Set) {
    neuf.set(v, c = new Set());
    v.forEach(function(x) { c.add(_mjsCloneData(x, vu, neuf)); });
  }
  else if (v instanceof Date) c = new Date(v.getTime());
  else if ((p = Object.getPrototypeOf(v)) === Object.prototype || p === null) {
    neuf.set(v, c = Object.create(p));
    Object.keys(v).forEach(function(k) { if (µ._mjs_safeKey(k)) c[k] = _mjsCloneData(v[k], vu, neuf); });
  }
  else throw _mjsCloneNo;
  return c;
}

// `el` : un composant MJS, monté ou non. La balise rendue porte ses attributs et le contenu glissé entre ses balises, comme
// `cloneNode(true)` (un `id` compris) ; un composant léger (`mjs-light`), dont les enfants sont sa propre vue, ne copie que sa balise.
// Seules les DONNÉES de l'état sont copiées (cf. `_mjsCloneData`) ; un dérivé ne l'est pas : la copie le recalcule depuis ses variables. Un composant pas encore monté (une copie pas encore posée,
// un enfant qui attend les props de son parent, une balise dont la page a posé une prop en propriété, `el.titre = 'X'`) : ce qui l'attend à
// son montage fait partie de son état, dans l'ordre où le montage le verse. Une balise qui n'est pas un composant (balise ordinaire,
// composant pas encore défini, autre chose qu'une balise) : erreur, plutôt qu'une copie sans état. `opts` : `{ mirror: true }` rend le miroir
// vivant ; toute autre option, ou autre chose qu'un objet, est une erreur
µ.clone = function(el, opts) {
  if (!(el instanceof µ.Element)) throw new Error(µ._mjs_msg('cloneNotComponent', { tag: el && el.localName ? '<' + el.localName + '>' : String(el) }, 'µclone : {tag} n\'est pas un composant MJS, ou sa définition n\'est pas encore chargée — aucun état à copier. Pour copier une balise ordinaire, écrivez el.cloneNode(true).'));
  var bad = opts == null ? null : typeof opts !== 'object' ? String(opts) : Object.keys(opts).filter(function(k) { return k !== 'mirror'; })[0];
  if (bad != null) throw new Error(µ._mjs_msg('cloneOption', { opt: bad }, 'µclone : option « {opt} » inconnue — la seule option est mirror : µclone el, mirror: true rend un miroir vivant, qui partage l\'état de l\'original.'));
  if (opts && opts.mirror) return _mjsMirror(el);
  var vu = new Map(), state = el._state, pend = µ._mjs_pending.get(el), sm = el._mjs_state_methods, seed = Object.create(null), d, k;
  // une variable est déposée entière ou pas du tout : ses copies ne rejoignent `vu` qu'une fois la variable copiée jusqu'au bout. Une valeur
  // en attente qui n'est pas une donnée retire aussi celle de l'état, plus ancienne
  var put = function(k, v) {
    var neuf = new Map();
    try {
      seed[k] = _mjsCloneData(v, vu, neuf);
      neuf.forEach(function(c, o) { vu.set(o, c); });
    }
    catch (e) {
      if (e !== _mjsCloneNo) throw e;
      delete seed[k];
    }
  };
  for (k in state) {
    d = Object.getOwnPropertyDescriptor(state, k);
    if (d && 'value' in d) put(k, d.value);
  }
  for (k in pend) put(k, pend[k]);
  // prop posée en propriété sur la balise : son montage la verse après le registre (connectedCallback), sauf la fonction d'une méthode
  // homonyme d'une variable ; monté, l'original l'a déjà versée dans son état, et ne lit pas une propriété écrite depuis
  if (!el._mjs_is_mounted) {
    for (k in el._mjs_var_bits) {
      if (el.hasOwnProperty(k) && !(sm && sm[k] && typeof el[k] === 'function')) put(k, el[k]);
    }
  }
  var copy = el.cloneNode(!el._mjs_isLight);
  µ._mjs_pending.set(copy, seed);
  return copy;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// MIROIR VIVANT — `µ.clone(el, { mirror: true })` : une balise neuve du même composant dont les variables `$` SONT celles de l'original, le
// même objet d'état. Une écriture faite par n'importe laquelle des instances (gestionnaire, script, reffet, saisie liée) redessine toutes
// celles qui le partagent. L'original et ses miroirs forment un GROUPE (`el._mjs_twins`) : `s` l'état commun, `m` les instances présentes
// dans la page (entrées à leur connexion, sorties à leur déconnexion : le groupe ne retient aucune balise retirée), `h` la MAISON, une
// instance du groupe qui enveloppe les objets de l'état (une seule enveloppe par objet, quelle que soit l'instance qui écrit) et porte les
// lecteurs des dérivés. Le DOM, l'ombre, les références `@@x`, les écouteurs, les feuilles, le script et le cycle de vie restent à chaque
// instance ; un composant rendu dans le gabarit d'un miroir est une instance neuve, qui reçoit ses props du rendu du miroir.
// rien au cœur : le miroir se construit par le crochet du constructeur (`µ._mjs_mirror`, mjs_element.ts), et seules les instances d'un
// groupe remplacent, à leur nom, les méthodes qui préviennent d'une écriture — un composant sans miroir garde celles du prototype
// ---------------------------------------------------------------------------------------------------------------------------------------------

// `@@isMirror` dans le composant, `isMirror` de l'extérieur : faux, sauf sur un miroir
if (µ.Element) µ.Element.prototype.isMirror = false;

// le groupe d'un original, à son premier miroir : il y entre s'il est dans la page, et en est la maison — les objets de son état sont déjà
// ses enveloppes, ses dérivés ses lecteurs
function _mjsTwinStart(el) {
  var g = { s: el._state, m: [], h: el };
  _mjsTwinAdd(g, el);
  if (el._mjs_is_mounted) _mjsTwinIn(g, el);
  return g;
}

// une instance rejoint le groupe : elle remplace, à son nom, ce qui prévient d'une écriture (les autres instances présentes le sont aussi),
// ce qui enveloppe un objet (la maison le fait pour toutes) et ce qui suit sa présence dans la page
function _mjsTwinAdd(g, el) {
  el._mjs_twins = g;
  // l'écriture prend le chemin qui prévient : le raccourci de `_set` (composant sans liaison ni dérivé) ne préviendrait que l'instance qui écrit
  el._mjs_binds ||= new Set();
  el._mjs_notifyMutation = _mjsTwinNotify;
  el._mjs_notifyMutationAliased = _mjsTwinAliased;
  el._mjs_wrapDeep = _mjsTwinWrap;
  el._mjs_lifeRun = _mjsTwinLife;
  // dérivés : un seul lecteur par nom dans l'état commun, donc un seul cache — les fiches de la maison, que chaque instance périme (écriture,
  // magasin `$$`, rendu complet) avant de les relire
  if (g.h._mjs_computeds) {
    el._mjs_computeds    = g.h._mjs_computeds;
    el._mjs_computedKeys = g.h._mjs_computedKeys;
  }
  // valeurs typées (bloc <vars>, mjs_types.ts) : les objets contrôlés sont inscrits à un seul registre, celui du groupe
  if (el._mjs_types) el._mjs_treg = g.t ||= g.h._mjs_treg || new WeakMap();
}

// une écriture dans l'état commun, sous n'importe quelle instance : elle-même d'abord, puis chaque autre instance présente — ses dérivés, son
// rendu, la liaison vers son parent ; la valeur d'avant est la même pour toutes. Les présentes sont recopiées avant la boucle : un rendu peut
// en retirer une
function _mjsTwinNotify(k, old) {
  var P = µ.Element.prototype, m = this._mjs_twins.m, i;
  P._mjs_notifyMutation.call(this, k, old);
  if (m.length > 1 || (m.length === 1 && m[0] !== this)) {
    m = m.slice();
    for (i = 0; i < m.length; i++) {
      if (m[i] !== this && m[i]._mjs_twinIn) P._mjs_notifyMutation.call(m[i], k, old);
    }
  }
}

// objet atteint par plusieurs variables (`$a = obj ; $b = obj`) : la maison sait lesquelles (cf. `_mjs_wrapDeep`), elle les prévient toutes
function _mjsTwinAliased(o, k, old) {
  return µ.Element.prototype._mjs_notifyMutationAliased.call(this._mjs_twins.h, o, k, old);
}

// un objet rangé dans l'état est enveloppé par la maison : une seule enveloppe par objet pour tout le groupe, et l'état ne retient pas
// l'instance qui l'a écrit
function _mjsTwinWrap(t, k, via) {
  return µ.Element.prototype._mjs_wrapDeep.call(this._mjs_twins.h, t, k, via);
}

// présence dans la page : une instance entre dans le groupe à sa connexion, avant son µawake (qui peut déjà écrire dans l'état commun), et en
// sort à sa déconnexion, après son µsleep
function _mjsTwinLife(name, cbs) {
  var g = this._mjs_twins, r;
  if (name === 'awake') _mjsTwinIn(g, this);
  r = µ.Element.prototype._mjs_lifeRun.call(this, name, cbs);
  if (name === 'sleep') _mjsTwinOut(g, this);
  return r;
}

function _mjsTwinIn(g, el) {
  if (el._mjs_twinIn) return;
  el._mjs_twinIn = true;
  g.m.push(el);
  // tout le groupe avait quitté la page : la première instance revenue devient la maison
  if (g.h !== el && !g.h._mjs_twinIn) _mjsTwinHome(g, el);
}

function _mjsTwinOut(g, el) {
  if (!el._mjs_twinIn) return;
  el._mjs_twinIn = false;
  g.m.splice(g.m.indexOf(el), 1);
  if (g.h === el) {
    if (g.m.length) _mjsTwinHome(g, g.m[0]);
  }
  else _mjsTwinHome(g, g.h, true);
}

// la maison change (la sienne a quitté la page) : la nouvelle enveloppe les objets de l'état et repose à son nom les lecteurs des dérivés —
// ceux de l'ancienne liraient son cache, qu'aucune écriture ne périme plus. Un ressort (µspring, µinterpolate) prévient la maison : il oublie
// une instance retirée, celle qui l'a écrit comprise (`ressorts` : eux seuls, quand une autre instance part)
function _mjsTwinHome(g, H, ressorts) {
  var P = µ.Element.prototype, s = g.s, cs = H._mjs_computeds;
  g.h = H;
  Object.keys(s).forEach(function(k) {
    var d = Object.getOwnPropertyDescriptor(s, k), v = d.value;
    if (v && µ._mjs_interpolatorSet.has(v)) v._mjs_attachInvalidator(H, function() { return H._mjs_notifyMutation(k); });
    else if (ressorts) return;
    else if (d.get) {
      if (cs && cs[k]) {
        delete s[k];
        P._mjs_setComputed.call(H, k, cs[k].f);
      }
    }
    else if (v !== null && typeof v === 'object' && !(v._mjs_c && typeof v.f === 'function')) s[k] = P._mjs_wrapDeep.call(H, µ._mjs_toRaw(v), k);
  });
}

// le miroir : construit par `cloneNode` (attributs et contenu glissé recopiés, comme la copie), son état est l'état commun DÈS son
// constructeur, avant que son script ne le lise (`const $ = this._state`, code généré). Pendant sa construction, son script tourne sans rien
// écrire dans l'état commun : ni ses valeurs de départ (`$n = 0`), ni ce qu'il fait au premier niveau sur une liste ou un objet
// (`$l.push 1`, mjs_deep.ts, chargé si le projet en écrit), ni ses dérivés (leur lecteur est déjà posé) ; ses méthodes, ses reffets, ses
// crochets de cycle de vie sont les siens et jouent comme dans tout composant. `bare` : sa balise seule, sans le contenu glissé (la copie d'un
// composant de *marquee, qui recopie elle-même ce contenu, mjs_fx_marquee.ts)
function _mjsMirror(el, bare) {
  var g = el._mjs_twins || _mjsTwinStart(el), hook = µ._mjs_mirror, ds = µ._mjs_deepSet, dc = µ._mjs_deepCall, dd = µ._mjs_deepDelete, copy;
  // crochet du constructeur : la première balise du même nom construite par `cloneNode` est la copie (un composant glissé entre ses balises
  // vient après elle)
  µ._mjs_mirror = function(c) {
    if (c.localName !== el.localName) return;
    µ._mjs_mirror = hook;
    c._mjs_twinNew = true;
    Object.defineProperty(c, '_state', { configurable: true, get: function() { return g.s; }, set: function() {} });
    c._set = _mjsMirrorSet;
    c._mjs_setComputed = _mjsMirrorComputed;
  };
  if (ds) µ._mjs_deepSet = function(e, p, v) { return e._mjs_twinNew ? v : ds(e, p, v); };
  if (dc) µ._mjs_deepCall = function(e, p, f, a) { return e._mjs_twinNew ? void 0 : dc(e, p, f, a); };
  if (dd) µ._mjs_deepDelete = function(e, p) { return e._mjs_twinNew ? true : dd(e, p); };
  try {
    copy = el.cloneNode(!bare && !el._mjs_isLight);
  }
  finally {
    µ._mjs_mirror = hook;
    if (ds) µ._mjs_deepSet = ds;
    if (dc) µ._mjs_deepCall = dc;
    if (dd) µ._mjs_deepDelete = dd;
  }
  // construit : l'état redevient une simple propriété, ses dérivés à venir passent par le prototype
  Object.defineProperty(copy, '_state', { configurable: true, enumerable: true, writable: true, value: g.s });
  copy._mjs_twinNew = false;
  delete copy._mjs_setComputed;
  // non configurable : la reprise des props posées en propriétés (connectedCallback) ne l'ôte pas
  Object.defineProperty(copy, 'isMirror', { value: true, enumerable: true });
  _mjsTwinAdd(g, copy);
  return copy;
}

µ._mjs_mirrorOf = _mjsMirror;

// écriture d'un miroir : rien n'entre dans l'état commun pendant sa construction (son script) ni pendant sa connexion avant son entrée dans le
// groupe — ses attributs, recopiés de l'original et relus en props, le remettraient à leur valeur de départ ; ensuite, comme toute instance
function _mjsMirrorSet(k, v) {
  if (this._mjs_twinNew || (this.isConnected && !this._mjs_twinIn)) return true;
  return µ.Element.prototype._set.call(this, k, v);
}

// dérivé déclaré par le script d'un miroir : son lecteur et sa fiche sont déjà ceux du groupe (cf. `_mjsTwinAdd`) ; une valeur que l'original
// a mise à sa place (`$total = 5`) reste
function _mjsMirrorComputed() {
  return true;
}
