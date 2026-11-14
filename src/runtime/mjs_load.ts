// mjs_load — `µload(url, { refresh })` : le magasin qui se charge seul. Joint au cœur seulement quand l'appli appelle µload
// (bundler/features.ts, clé `load`), avec mjs_ajax.ts, qui fait la requête.
//
// Une ADRESSE (le texte complet de l'URL, requête comprise) = une ENTRÉE partagée : la donnée, l'erreur, la requête en vol.
// L'appli reçoit une POIGNÉE (`data`, `pending`, `error`, `refresh()`) qui lit son entrée :
//   - écrite dans une dérivée d'un composant (`$membres = µload("/api/members?q=#{$q}")`), une poignée par appel écrit (le repère que
//     le compilateur pose sur chaque µload du code, cf. transpiler/load-sites.ts ; à défaut, le rang de l'appel dans la dérivée) :
//     refaite après chaque écriture du composant, la dérivée retrouve la même poignée, sans nouvelle requête ; l'adresse qui change la
//     fait viser l'entrée neuve, et `data` garde la donnée d'avant jusqu'à l'arrivée de la nouvelle — seulement pour un appel écrit
//     directement dans l'expression de la dérivée, hors de toute fonction et de toute boucle (la frappe d'une recherche) : fait dans une
//     fonction (une aide, une flèche, une fonction de rang) ou une boucle (le repère porte alors `*`), sans repère, ou fait plusieurs fois,
//     une poignée par fois, et aucune ne garde la donnée d'une autre adresse, même seule dans son calcul : un rang ne montre jamais la
//     donnée d'un autre. Un autre appel écrit (l'autre branche d'un ternaire) a sa
//     poignée : il montre l'entrée de son adresse, jamais la donnée d'un autre appel. Un calcul fini sans lever lâche les poignées des
//     appels qu'il n'a pas refaits (cf. _mjsLdBalayer) ; un calcul qui lève ne lâche rien. Une valeur du script qui lit la donnée d'un
//     appel (`$n = µload(url).data?.n or 0`) est une dérivée (analyzer/index.ts), recalculée à chaque arrivée d'une réponse qu'elle a lue ;
//   - écrite ailleurs dans le script (`$me = µload('/api/me')`, un gestionnaire) ou dans un module, une poignée partagée par adresse et
//     par règle de relecture : un autre appel de la même adresse ne change pas la règle d'un lecteur ;
//   - appelée pendant le rendu d'un composant monté — son gabarit (une liaison, à la racine comme dans un bloc : branche d'un `{if}`, d'un
//     `{key}` ou d'un `{await}`, condition, liste ou ligne d'un `{for}`), un µeffect, une aide que le gabarit appelle, son µmount —, une
//     poignée du gabarit, partagée par adresse et par règle, que le composant ne lit pas : son gabarit la MONTRE (cf. _mjsLdMontrer) —
//     prévenu à chaque arrivée d'une réponse, pour se redessiner ; l'entrée reste tant qu'il est monté et que ses rendus complets la
//     relisent : ni évincée du cache, ni oubliée, ni redemandée au redessin (une erreur reste affichée jusqu'à son départ ou à
//     `refresh()`) ; un envoi qui la touche la relit tout de suite, une fois, comme une entrée lue (cf. _mjsLdPerimer), jamais au redessin ;
//     sa requête dépassée n'est pas annulée. Hors de µmount, le développement
//     le dit et conseille une dérivée du script (`<load-dev>`, cf. _mjsLdHors) ; dans µmount, la variable qui reçoit la poignée la lit.
// Un composant LIT une poignée quand il l'obtient (appel pendant son initialisation ou le calcul d'une de ses dérivées), la range dans une
// variable, ou lit `data`/`pending`/`error` d'une poignée qui n'est pas du gabarit pendant son rendu ; il ne la lit plus quand il quitte la
// page, quand plus rien dans son état ne la tient, ou quand la dérivée qui l'appelait finit un calcul sans l'appeler. Une entrée change →
// ses lecteurs se redessinent (rendu complet, comme µStore). Une entrée que plus personne ne lit ni ne montre : sa requête en vol est
// annulée (sauf si aucun composant ne l'a jamais lue : appel d'un module, du gabarit), puis elle reste cinq minutes dans un cache de
// cinquante entrées au plus (la plus ancienne part la première) ; une entrée sans donnée part tout de suite. La mémoire est ainsi bornée
// par ce qui est lu ou affiché, plus ces cinquante entrées. Un composant parti n'est plus prévenu ni gardé.
// `refresh` : false (défaut : relue seulement après un envoi qui la touche, ou sur demande), un nombre de secondes (relue en
// fond quand elle est lue et plus vieille), 'focus' (relue au retour sur l'onglet, si elle a plus de 30 s), 'online' (relue
// au retour du réseau). Une erreur garde la donnée, sans nouvel essai ; une réponse qui n'est pas du JSON est une erreur.
// Le texte de l'erreur d'une réponse qui n'est pas du JSON est un libellé (groupe `load`), lisible en production comme en développement.
// Un `µ.ajax.post/put/patch/delete` réussi marque périmées les entrées dont le chemin est celui de l'envoi ou l'un de ses
// parents (même origine, barre finale comprise ; la racine n'est relue que par un envoi à la racine) : relues tout de suite si on
// les lit ou qu'un gabarit les montre, à leur prochaine lecture sinon ; `µload.refresh(url)` suit la même règle.
// Les morceaux entre repères ne partent que s'ils servent (bundler/index.ts) : ce que lit le rendu serveur dans une construction
// qui rend côté serveur, l'écoute de 'focus' / 'online' quand l'appli les écrit, les avertissements quand le niveau de console
// les garde, celui d'un appel écrit hors du script (et le code qui le surveille) en développement seulement, jamais en production. La
// reprise d'une page rendue par un serveur part toujours : le client ne sait pas qui a rendu sa page.

var _mjsLdEntrees  = new Map();
var _mjsLdPartages = new Map();
var _mjsLdLibres   = new Map();
var _mjsLdPropre   = Object.prototype.hasOwnProperty;
// [composant, poignées de ses appels écrits, rang du prochain appel sans repère, tour du calcul] pendant le calcul d'une dérivée (cf.
// l'enveloppe de _mjs_setComputed) ; chaque calcul prend un tour neuf, que portent les poignées qu'il appelle
var _mjsLdCalcul   = null;
var _mjsLdTour     = 0;
// le composant dont `_mjs_invalidate` tourne, et `µ.activeComponent` à son entrée (cf. _mjsLdLecteur)
var _mjsLdQui      = null;
var _mjsLdQuiA     = null;

class MjsLoad {
  constructor(u, r) {
    this._mjs_u = u;
    // règle de relecture : false, un nombre de secondes, 'focus' ou 'online'
    this._mjs_r = r;
    // la dernière donnée montrée, gardée quand l'adresse change
    this._mjs_v = void 0;
    // les composants qui la lisent
    this._mjs_a = new Set();
    µ._mjs_rawSet.add(this);
  }

  get data() {
    var e = _mjsLdLire(this);
    if (e.d !== void 0) this._mjs_v = e.d;
    return this._mjs_v;
  }

  get pending() {
    return !!_mjsLdLire(this).c;
  }

  get error() {
    return _mjsLdLire(this).e;
  }

  refresh() {
    var e = _mjsLdEntrees.get(this._mjs_u);
    return e ? _mjsLdCharger(e, 1) : _mjsLdEntree(this._mjs_u, this).p;
  }
}

function _mjsLdNeuve(u) {
  // d : donnée · e : erreur · c : requête en vol · p : sa promesse · t : fin de la dernière requête · s : périmée · l : déjà lue · z : minuteur du cache · f : poignées
  // · o : les composants montés dont le gabarit la montre, prévenus à chaque arrivée d'une réponse (cf. _mjsLdMontrer)
  var e = { u: u, d: void 0, e: null, c: null, p: null, t: 0, s: 0, l: 0, z: 0, f: new Set(), o: new Set() };
  _mjsLdEntrees.set(u, e);
  return e;
}

// l'entrée d'une adresse, créée et demandée au besoin ; la poignée `h` la vise, et la rend lue si un composant lit la poignée. Périmée
// par un envoi quand personne ne la lisait ni ne la montrait, elle est relue à sa prochaine lecture (cf. _mjsLdPerimer)
function _mjsLdEntree(u, h) {
  var e = _mjsLdEntrees.get(u);
  if (!e) _mjsLdCharger(e = _mjsLdNeuve(u));
  else if (e.s && !e.c) _mjsLdCharger(e);
  if (h) {
    e.f.add(h);
    if (h._mjs_a.size) {
      e.l = 1;
      _mjsLdRetenir(e);
    }
  }
  return e;
}

// l'entrée sort du cache, son minuteur arrêté
function _mjsLdRetenir(e) {
  clearTimeout(e.z);
  e.z = 0;
  _mjsLdLibres.delete(e.u);
}

// `fn` jouée quand le composant `c` quitte la page (disconnectedCallback, mjs_element.ts)
function _mjsLdDepart(c, fn) {
  (c._mjs_store_unsubs || (c._mjs_store_unsubs = new Set())).add(fn);
}

// le composant qui lit ce qu'il appelle : celui qui calcule une dérivée, sinon celui dont la passe tourne — la passe d'une variable, que le
// cœur joue sans `µ.activeComponent` (cf. l'enveloppe de _mjs_invalidate) —, tant qu'un autre n'a pas pris la main (initialisation d'un
// enfant), sinon `µ.activeComponent`
function _mjsLdLecteur() {
  var a = µ.activeComponent;
  return µ._mjs_computing || (_mjsLdQui && _mjsLdQuiA === a ? _mjsLdQui : a);
}

// le composant `c` lit la poignée `h` ; poignée du gabarit, il ne la lit pas : son gabarit la montre (cf. _mjsLdMontrer). L'entrée de son
// adresse, créée et demandée au besoin
function _mjsLdVoir(c, h) {
  var e;
  if (c && !h._mjs_g) _mjsLdAbonner(c, h);
  e = _mjsLdEntree(h._mjs_u, h);
  if (c && h._mjs_g) _mjsLdMontrer(c, e);
  return e;
}

// le gabarit du composant monté `c` montre l'entrée `e` : prévenu à chaque arrivée d'une réponse, pour se redessiner, il la garde — ni
// évincée du cache, ni oubliée, ni redemandée au redessin (une erreur reste affichée), relue tout de suite par un envoi qui la touche —
// jusqu'à son départ, ou jusqu'à un rendu complet qui ne la relit pas (cf. _mjsLdClore)
function _mjsLdMontrer(c, e) {
  var g = c._mjs_ldG;
  if (!g) {
    g = c._mjs_ldG = new Set();
    // le composant quitte la page : les entrées qu'il montrait le lâchent
    _mjsLdDepart(c, function() {
      c._mjs_ldG = c._mjs_ldN = null;
      g.forEach(function(x) { _mjsLdCacher(c, x); });
    });
  }
  g.add(e);
  if (c._mjs_ldN) c._mjs_ldN.add(e);
  e.o.add(c);
  _mjsLdRetenir(e);
}

// le gabarit du composant `c` ne montre plus l'entrée `e`
function _mjsLdCacher(c, e) {
  e.o.delete(c);
  if (!_mjsLdGardee(e)) _mjsLdPlusLue(e);
}

// un rendu complet du composant `c` est passé : les entrées que son gabarit n'y a pas relues, il ne les montre plus. Pendant le gel des
// traductions, le rendu attend : rien n'est lâché
function _mjsLdClore(c) {
  var g = c._mjs_ldG, n = c._mjs_ldN;
  c._mjs_ldN = null;
  if (!g || !n || c._mjs_i18n_hold) return;
  g.forEach(function(e) {
    if (n.has(e)) return;
    g.delete(e);
    _mjsLdCacher(c, e);
  });
}

// lecture de `data`/`pending`/`error` : le composant qui se rend ou se calcule la voit ; règle d'un nombre de secondes
function _mjsLdLire(h) {
  var r = h._mjs_r, e = _mjsLdVoir(_mjsLdLecteur(), h);
  if (typeof r === 'number' && !e.c && e.t && Date.now() - e.t > r * 1000) _mjsLdCharger(e);
  return e;
}

// une requête pour l'entrée ; celle déjà en vol sert, sauf `force` (relecture demandée, envoi réussi) qui l'annule et repart
function _mjsLdCharger(e, force) {
  var ctrl, fin;
  if (e.c) {
    if (!force) return e.p;
    e.c.abort();
  }
  ctrl = e.c = new AbortController();
  e.s = 0;
  // la réponse de cette requête, si aucune autre ne l'a dépassée : la donnée, ou l'erreur (la donnée d'avant reste)
  fin = function(err, d) {
    if (e.c !== ctrl) return;
    if (err) {
      // <load-serveur>
      // rendu serveur : un échec ne s'écrit jamais dans la page, qui part en attente (`pending` reste vrai) ; le client refait la requête
      if (µ._isServer || µ.server === true) {
        e.w = 1;
        return;
      }
      // </load-serveur>
      e.e = err;
      return;
    }
    e.d = d;
    e.e = null;
  };
  e.p = µ.ajax.get(e.u, function(json, url, schema, nav) {
    // une réponse qui n'est pas du JSON (page de connexion, adresse qui ne mène pas à l'API) : une erreur, jamais une donnée
    if (json != null && !/application\/json/.test(nav && nav.type)) fin(Object.assign(new Error(µ._mjs_txt('load.notJson', { url: e.u }, 'µload : la réponse de {url} n\'est pas du JSON.')), { body: json, url: url }));
    else fin(null, json);
  }, fin, void 0, void 0, ctrl.signal).then(function() {
    if (e.c !== ctrl) return;
    // <load-serveur>
    if (e.w) return;
    // </load-serveur>
    e.c = e.p = null;
    e.t = Date.now();
    _mjsLdPrevenir(e, 1);
    if (!_mjsLdGardee(e)) _mjsLdPlusLue(e);
  });
  _mjsLdPrevenir(e);
  return e.p;
}

// les lecteurs de l'entrée se redessinent, chacun une fois ; à l'arrivée d'une réponse (`fin`), aussi les composants dont le gabarit la
// montre (cf. _mjsLdMontrer)
function _mjsLdPrevenir(e, fin) {
  var vus = new Set(), voir = function(c) {
    if (vus.has(c)) return;
    vus.add(c);
    if (typeof c._mjs_invalidate === 'function') c._mjs_invalidate('_awaits_');
  };
  e.f.forEach(function(h) { h._mjs_a.forEach(voir); });
  if (fin) e.o.forEach(voir);
}

function _mjsLdLue(e) {
  for (var h of e.f) {
    if (h._mjs_a.size) return true;
  }
  return false;
}

// lue par un composant, ou montrée par le gabarit d'un composant monté
function _mjsLdGardee(e) {
  return _mjsLdLue(e) || e.o.size > 0;
}

function _mjsLdAbonner(c, h) {
  var t = c._mjs_ldH;
  if (!t) {
    t = c._mjs_ldH = new Set();
    // le composant quitte la page : il lâche tout ce qu'il lisait
    _mjsLdDepart(c, function() {
      c._mjs_ldH = null;
      t.forEach(function(x) { _mjsLdLacher(c, x); });
    });
  }
  if (t.has(h)) return;
  t.add(h);
  h._mjs_a.add(c);
}

function _mjsLdLacher(c, h) {
  var e = _mjsLdEntrees.get(h._mjs_u);
  if (c._mjs_ldH) c._mjs_ldH.delete(h);
  h._mjs_a.delete(c);
  if (e && !h._mjs_a.size) _mjsLdPlusLue(e);
}

// une entrée a peut-être perdu son dernier lecteur, ou le dernier gabarit qui la montrait : vu au tour suivant (un composant qui en
// remplace un autre la reprend avant)
function _mjsLdPlusLue(e) {
  setTimeout(function() {
    if (_mjsLdEntrees.get(e.u) === e && !_mjsLdGardee(e)) _mjsLdDelaisser(e);
  }, 0);
}

function _mjsLdDelaisser(e) {
  if (e.c) {
    // jamais lue (appel d'un module, ses lecteurs ne sont pas encore là ; appel du gabarit) : la requête continue, revue à son arrivée
    if (!e.l) return;
    // requête dépassée que plus personne ne lit : annulée
    e.c.abort();
    e.c = e.p = null;
  }
  if (e.d === void 0) {
    _mjsLdOublier(e);
    return;
  }
  if (_mjsLdLibres.has(e.u)) return;
  _mjsLdLibres.set(e.u, e);
  if (_mjsLdLibres.size > 50) _mjsLdOublier(_mjsLdLibres.values().next().value);
  if (!µ._isServer) e.z = setTimeout(function() { _mjsLdOublier(e); }, 300000);
}

function _mjsLdOublier(e) {
  _mjsLdRetenir(e);
  if (_mjsLdEntrees.get(e.u) !== e) return;
  _mjsLdEntrees.delete(e.u);
  // les poignées partagées de l'adresse que plus personne ne lit partent avec elle
  e.f.forEach(function(h) {
    if (!h._mjs_a.size && _mjsLdPartages.get(h._mjs_k) === h) _mjsLdPartages.delete(h._mjs_k);
  });
}

// le composant tient-il encore la poignée dans son état (une variable, ou la valeur gardée d'une dérivée autre que `sauf`, celle qui se
// calcule) ?
function _mjsLdTient(c, h, sauf) {
  var st = c._state, cs = c._mjs_computeds, k, d;
  for (k in st) {
    d = Object.getOwnPropertyDescriptor(st, k);
    if (d && d.value === h) return true;
  }
  if (cs) {
    for (k in cs) {
      if (k !== sauf && cs[k] && cs[k]._mjs_cached === h) return true;
    }
  }
  return false;
}

// un calcul de la dérivée `sauf` fini sans lever : les poignées des appels qu'il n'a pas refaits, et `o`, celle que sa valeur d'avant
// tenait, sont lâchées si rien d'autre dans l'état ne les tient — leur requête en vol annulée, leur adresse plus relue après un envoi
// (cf. _mjsLdLacher). La poignée d'un appel écrit reste à la dérivée, sans sa donnée d'avant : un retour sur l'appel repart de l'entrée
// de son adresse (sa donnée si le cache la garde, sinon l'attente)
function _mjsLdBalayer(s, sauf, o) {
  var t = s[1], n;
  for (n in t) {
    if (_mjsLdQuitter(s, t[n], sauf)) t[n]._mjs_v = void 0;
  }
  if (o) _mjsLdQuitter(s, o, sauf);
}

// la poignée que le calcul `s` n'a pas reprise, que son composant lit encore et ne tient pas ailleurs : lâchée
function _mjsLdQuitter(s, h, sauf) {
  if (h._mjs_e === s[3] || !h._mjs_a.has(s[0]) || _mjsLdTient(s[0], h, sauf)) return 0;
  _mjsLdLacher(s[0], h);
  return 1;
}

// <load-avis>
// un avertissement par texte : une dérivée refaite après chaque écriture ne le répète pas
var _mjsLdDits = new Set();
function _mjsLdNeuf(t) {
  return !_mjsLdDits.has(t) && !!_mjsLdDits.add(t);
}
// le texte d'une valeur reçue, sans jamais lever (un objet sans prototype n'en a pas)
function _mjsLdTexte(v) {
  try { return typeof v === 'string' ? '\'' + v + '\'' : String(v); }
  catch { return typeof v; }
}
// </load-avis>

// la règle de relecture : false (jamais seule), un nombre de secondes, 'focus' ou 'online' ; des options mal écrites (une valeur
// à la place de l'objet, une option inconnue, une règle inconnue) avertissent et comptent pour false
function _mjsLdRegle(o) {
  var r = false, k;
  if (o == null) return r;
  if (typeof o !== 'object') {
    // <load-avis>
    var vt = _mjsLdTexte(o);
    if (_mjsLdNeuf('a' + vt)) µ.warn(µ._mjs_msg('loadArgs', { v: vt }, 'µload : les options s\'écrivent en objet — écrivez µload(url, { refresh: {v} }). Valeur ignorée : la donnée n\'est relue que sur demande.'));
    // </load-avis>
    return r;
  }
  for (k in o) {
    if (!_mjsLdPropre.call(o, k)) continue;
    if (k !== 'refresh') {
      // <load-avis>
      if (_mjsLdNeuf('o' + k)) µ.warn(µ._mjs_msg('loadOption', { opt: k }, 'µload : option « {opt} » inconnue — la seule option est refresh.'));
      // </load-avis>
      continue;
    }
    r = o.refresh;
    if (!(r === false || r === 'focus' || r === 'online' || (typeof r === 'number' && r > 0))) {
      // <load-avis>
      var rt = _mjsLdTexte(r);
      if (_mjsLdNeuf('r' + rt)) µ.warn(µ._mjs_msg('loadRefresh', { v: rt }, 'µload : refresh « {v} » inconnu — écrivez false, un nombre de secondes, \'focus\' ou \'online\'. La donnée n\'est relue que sur demande.'));
      // </load-avis>
      r = false;
    }
  }
  return r;
}

// <load-revoir>
var _mjsLdEcoute = 0;
function _mjsLdRevoir(regle) {
  _mjsLdEntrees.forEach(function(e) {
    if (e.c || (regle === 'focus' && Date.now() - e.t <= 30000)) return;
    for (var h of e.f) {
      if (h._mjs_r === regle && h._mjs_a.size) {
        _mjsLdCharger(e);
        return;
      }
    }
  });
}

function _mjsLdEcouter() {
  var vu;
  if (_mjsLdEcoute || typeof window === 'undefined' || µ._isServer) return;
  _mjsLdEcoute = 1;
  vu = function() {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') _mjsLdRevoir('focus');
  };
  window.addEventListener('focus', vu);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', vu);
  window.addEventListener('online', function() { _mjsLdRevoir('online'); });
}
// </load-revoir>

function _mjsLdChemin(u) {
  try { return new URL(String(u), (typeof document !== 'undefined' && document.baseURI) || location.href); }
  catch { return null; }
}

// les entrées dont le chemin est celui de `url` ou l'un de ses parents, même origine, barre finale comprise (`/api/me/` est
// `/api/me`) ; la racine n'est le parent d'aucun chemin, seul un envoi à `/` la relit. Relues tout de suite, une fois, si on les lit ou
// qu'un gabarit les montre — un bloc fermé dont le gabarit n'a pas encore lâché l'adresse compris (cf. _mjsLdClore) : rouvert, il montre
// la donnée fraîche —, périmées sinon, relues à leur prochaine lecture (cf. _mjsLdEntree)
function _mjsLdPerimer(url) {
  var cible = _mjsLdChemin(url), p = [], a;
  if (cible) {
    a = cible.pathname.replace(/\/+$/, '');
    _mjsLdEntrees.forEach(function(e) {
      var k = _mjsLdChemin(e.u), b;
      if (!k || k.origin !== cible.origin) return;
      b = k.pathname.replace(/\/+$/, '');
      if (a !== b && !(b && a.lastIndexOf(b + '/', 0) === 0)) return;
      if (_mjsLdGardee(e)) p.push(_mjsLdCharger(e, 1));
      else e.s = 1;
    });
  }
  return Promise.all(p).then(function() {});
}

// `site` : le repère de l'appel écrit, posé par le compilateur (transpiler/load-sites.ts), précédé de `*` quand l'appel n'est pas écrit
// directement dans l'expression d'une dérivée (une fonction, une boucle)
µ.load = function(url, opts, site) {
  var u = String(url), r = _mjsLdRegle(opts), s = _mjsLdCalcul, c, t, n, h, i, avant, g;
  if (s) {
    // la poignée de cet appel écrit (le même appel fait plusieurs fois dans un calcul : une par fois ; sans repère, son rang parmi les
    // appels sans repère) ; elle suit l'adresse quand elle change
    c = s[0];
    t = s[1];
    site = site || s[2]++;
    for (i = 0; (h = t[n = site + (i ? '#' + i : '')]) && h._mjs_e === s[3]; i++);
    if (!h) {
      h = t[n] = new MjsLoad(u, r);
      // le même appel fait une deuxième fois dans un calcul (une boucle, un `map`) : la poignée de la première fois ne montre plus la
      // donnée d'une autre adresse (cf. plus bas)
      if (i === 1) t[site]._mjs_v = void 0;
    }
    else if (h._mjs_u !== u) {
      avant = _mjsLdEntrees.get(h._mjs_u);
      h._mjs_u = u;
      // écrit directement dans l'expression de la dérivée (la frappe d'une recherche), l'appel garde sa donnée d'avant jusqu'à l'arrivée de
      // la nouvelle ; fait dans une fonction ou une boucle (repère `*`), sans repère, ou plusieurs fois, il n'en garde aucune, même seul dans
      // son calcul : il ne montre jamais la donnée d'une autre adresse
      if (t[site + '#1'] || typeof site !== 'string' || site[0] === '*') h._mjs_v = void 0;
      if (avant) {
        avant.f.delete(h);
        _mjsLdPlusLue(avant);
      }
      // ses autres lecteurs (un enfant qui la reçoit) se redessinent sur l'adresse neuve
      h._mjs_a.forEach(function(x) {
        if (x !== c && typeof x._mjs_invalidate === 'function') x._mjs_invalidate('_awaits_');
      });
    }
    h._mjs_r = r;
    h._mjs_e = s[3];
  }
  else {
    // ailleurs : une poignée partagée par adresse et par règle, chaque appel garde la sienne ; pendant le rendu d'un composant monté, à
    // part, une poignée du gabarit, que le composant ne lit pas (cf. _mjsLdVoir)
    c = _mjsLdLecteur();
    // <load-dev>
    _mjsLdHors(u);
    // </load-dev>
    g = c && c._mjs_is_mounted ? 'g' : '';
    n = g + r + ' ' + u;
    h = _mjsLdPartages.get(n);
    if (!h) {
      _mjsLdPartages.set(n, h = new MjsLoad(u, r));
      h._mjs_k = n;
      h._mjs_g = g;
    }
  }
  _mjsLdVoir(c, h);
  // <load-revoir>
  if (r === 'focus' || r === 'online') _mjsLdEcouter();
  // </load-revoir>
  return h;
};

µ.load.refresh = _mjsLdPerimer;

// un envoi réussi périme les entrées de même chemin (après le rappel de l'appelant, même s'il lève)
if (µ.ajax) {
  ['post', 'put', 'patch', 'delete'].forEach(function(m) {
    var f = µ.ajax[m], i = m === 'delete' ? 1 : 2;
    if (typeof f !== 'function') return;
    µ.ajax[m] = function() {
      var a = Array.prototype.slice.call(arguments), url = a[0], ok = a[i] || µ.ajax.success;
      a[i] = function() {
        try { return ok.apply(this, arguments); }
        finally { _mjsLdPerimer(url); }
      };
      return f.apply(this, a);
    };
  });
}

// la variable qui reçoit une poignée la lit ; celle qui la remplace la lâche, si rien d'autre dans l'état ne la tient
var __mjsLdProto = µ.Element.prototype, __mjsLdSet = __mjsLdProto._set, __mjsLdCalc = __mjsLdProto._mjs_setComputed;
// <precision>
__mjsLdProto._set = function(k, v, code) {
  var t = this._mjs_ldH, d = t && t.size && this._state ? Object.getOwnPropertyDescriptor(this._state, k) : void 0, o = d && d.value, r = __mjsLdSet.call(this, k, v, code);
// </precision>
// <horloge>
// __mjsLdProto._set = function(k, v) {
  // var t = this._mjs_ldH, d = t && t.size && this._state ? Object.getOwnPropertyDescriptor(this._state, k) : void 0, o = d && d.value, r = __mjsLdSet.call(this, k, v);
// </horloge>
  if (v instanceof MjsLoad) {
    _mjsLdAbonner(this, v);
    _mjsLdEntree(v._mjs_u, v);
  }
  if (o instanceof MjsLoad && o !== v && !_mjsLdTient(this, o)) _mjsLdLacher(this, o);
  return r;
};
// une dérivée qui se calcule le dit à µload, avec la table des poignées de ses appels écrits (le module des dérivées n'est là que si
// l'appli en a) ; son calcul fini sans lever lâche ce qu'elle n'appelle plus, et la poignée que sa valeur d'avant tenait (cf. _mjsLdBalayer)
if (__mjsLdCalc) {
  __mjsLdProto._mjs_setComputed = function(k, fn) {
    var c = this, s = [c, {}, 0, 0];
    return __mjsLdCalc.call(this, k, function() {
      var avant = _mjsLdCalcul, v, o;
      _mjsLdCalcul = s;
      s[2] = 0;
      s[3] = ++_mjsLdTour;
      try {
        v = fn.call(this);
        o = c._mjs_computeds && c._mjs_computeds[k];
        o = o && o._mjs_cached;
        _mjsLdBalayer(s, k, o !== v && o instanceof MjsLoad && o);
        return v;
      }
      finally { _mjsLdCalcul = avant; }
    });
  };
}

// <load-dev>
// développement : µload appelé dans le gabarit (une liaison, à la racine comme dans un bloc ; la passe des blocs : branche d'un `{if}`, d'un
// `{key}` ou d'un `{await}`, condition, liste d'un `{for}`), dans une ligne de `{for}` (aussi nichée), pendant qu'un composant joue ses
// µeffect ou dans une aide que le gabarit appelle : l'appel n'est pas suivi — le composant ne lit pas ses adresses, ses requêtes dépassées
// ne sont pas annulées, une adresse qui change ne garde pas la donnée d'avant (cf. _mjsLdVoir). Le lieu est noté pendant que ces passes tournent,
// l'appel avertit, une fois par lieu et par composant, et conseille une dérivée du script. Ce que fait un autre composant pendant ces passes
// (initialisation d'un enfant créé par elles, son µmount) n'est pas visé
var _mjsLdLieu = null, _mjsLdVeille = 0;
function _mjsLdDans(lieu, c, fn, self, args) {
  var avant = _mjsLdLieu;
  _mjsLdLieu = lieu ? [lieu, c] : null;
  try { return fn.apply(self, args); }
  finally { _mjsLdLieu = avant; }
}

function _mjsLdHors(u) {
  var a = µ.activeComponent, l = _mjsLdLieu, tag;
  if (!l || (a && (a !== l[1] || !a._mjs_is_mounted))) return;
  tag = '<' + ((l[1] && l[1].localName) || '?') + '>';
  if (_mjsLdNeuf(l[0] + tag)) µ.warn(µ._mjs_msg('loadPlace', { url: u, tag: tag, lieu: l[0] === 'b' ? µ._mjs_txt('loadPlaceTemplate', null, 'le gabarit') : l[0] === 'e' ? µ._mjs_txt('loadPlaceEffect', null, 'un µeffect') : l[0] === 'f' ? µ._mjs_txt('loadPlaceFor', null, 'une ligne de {for}') : µ._mjs_txt('loadPlaceHelper', null, 'une aide appelée par le gabarit') }, 'µload("{url}") appelé dans {lieu} de {tag} : ici, l\'appel n\'est pas suivi — ses requêtes dépassées ne sont pas annulées. Écrivez l\'appel dans une dérivée du script ($membres = µload(…), l\'adresse peut lire des $), puis lisez-la dans le gabarit ; pour une ligne de {for}, dans le script d\'un composant enfant.'));
}

// les liaisons du gabarit, enveloppées avant la première passe du composant (ses liaisons posées), gardent leur tour ordinaire : celle qui
// écrit µload note le gabarit, une autre une aide que le gabarit appelle (la liaison ne montre pas l'appel)
function _mjsLdEnvelopper(c) {
  var m = new Map(), l = c._mjs_effectsByVar, k;
  var w = function(fn) {
    var x = m.get(fn), lieu;
    if (!x && typeof fn === 'function') {
      lieu = /\.load\(/.test(String(fn)) ? 'b' : 'a';
      m.set(fn, x = function() { return _mjsLdDans(lieu, c, fn, this, arguments); });
    }
    return x || fn;
  };
  c._mjs_ldW = 1;
  c._mjs_effectsAll = c._mjs_effectsAll.map(w);
  if (l) {
    for (k in l) {
      if (Array.isArray(l[k])) l[k] = l[k].map(w);
    }
  }
}

// les passes notées, posées au premier rendu : les modules des listes (mjs_for.ts, mjs_for_nested.ts) et du montage (mjs_lifecycle.ts)
// arrivent après celui-ci ; le µmount d'un composant ne l'est pas, même quand il tourne pendant la passe de son parent
// chaque passe se lit et se remplace par son champ (accès pointé), que le minifieur raccourcit comme partout ailleurs : cherchée par le
// texte de son nom, elle n'était plus trouvée dans le code minifié
function _mjsLdVeiller() {
  var P = __mjsLdProto;
  _mjsLdVeille = 1;
  if (typeof P._mjs_safeRenderStruct === 'function') P._mjs_safeRenderStruct = _mjsLdPasse('b', P._mjs_safeRenderStruct);
  if (typeof P._mjs_runEffectsV2 === 'function') P._mjs_runEffectsV2 = _mjsLdPasse('e', P._mjs_runEffectsV2);
  if (typeof P._mjs_updFor === 'function') P._mjs_updFor = _mjsLdPasse('f', P._mjs_updFor);
  if (typeof P._mjs_updList === 'function') P._mjs_updList = _mjsLdPasse('f', P._mjs_updList);
  if (typeof P._mjs_fireMount === 'function') P._mjs_fireMount = _mjsLdPasse('', P._mjs_fireMount);
}

// la passe `f` enveloppée : elle note son lieu `lieu` pendant qu'elle tourne (cf. _mjsLdDans)
function _mjsLdPasse(lieu, f) {
  return function() { return _mjsLdDans(lieu, this, f, this, arguments); };
}

// </load-dev>

// le composant qui se redessine est noté (cf. _mjsLdLecteur) ; en développement, à son premier passage, ses liaisons enveloppées et les
// passes notées. Un rendu complet demandé à un composant dont le gabarit montre des entrées : ce qu'il relit est noté, et revu après ce
// rendu, que le cœur joue dans une microtâche déjà en file (cf. _mjsLdClore)
var __mjsLdInv = __mjsLdProto._mjs_invalidate;
__mjsLdProto._mjs_invalidate = function(k) {
  var q = _mjsLdQui, a = _mjsLdQuiA, c = this;
  // <load-dev>
  if (!this._mjs_ldW && Array.isArray(this._mjs_effectsAll)) _mjsLdEnvelopper(this);
  if (!_mjsLdVeille) _mjsLdVeiller();
  // </load-dev>
  _mjsLdQui  = this;
  _mjsLdQuiA = µ.activeComponent;
  try { return __mjsLdInv.apply(this, arguments); }
  finally {
    _mjsLdQui  = q;
    _mjsLdQuiA = a;
    if (k === '_awaits_' && c._mjs_ldG && !c._mjs_ldN) {
      c._mjs_ldN = new Set();
      queueMicrotask(function() { _mjsLdClore(c); });
    }
  }
};

// <load-serveur>
// rendu serveur (nom long, lu par le serveur hors de ce bundle) : `µ._ssrLoad(1)` rend les adresses dont la requête est en vol, que le
// rendu attend (et nomme quand il dure trop) ; `µ._ssrLoad()` les données à ranger dans `#__mjs_store`, clé `__mjsLoad` (adresse → donnée)
µ._ssrLoad = function(vol) {
  var d = vol ? [] : null;
  _mjsLdEntrees.forEach(function(e) {
    if (vol) {
      if (e.c && !e.w) d.push(e.u);
    }
    else if (e.d !== void 0) (d || (d = {}))[e.u] = e.d;
  });
  return d;
};
// </load-serveur>

// reprise : la donnée rangée par un rendu serveur dans `#__mjs_store` (clé `__mjsLoad`) entre au cache, sans requête, dans tout client
// (la page peut venir d'un serveur qui rend par l'API, ce que la construction du client ignore) ; le magasin `$$` (mjs_store_globals.ts),
// qui lit la même balise au démarrage, ne la garde pas
try {
  var __mjsLdBalise = typeof document !== 'undefined' && document.getElementById ? document.getElementById('__mjs_store') : null;
  var __mjsLdGraine = __mjsLdBalise && __mjsLdBalise.textContent ? JSON.parse(__mjsLdBalise.textContent).__mjsLoad : null;
  if (__mjsLdGraine && typeof __mjsLdGraine === 'object') {
    for (var __mjsLdU in __mjsLdGraine) {
      if (!_mjsLdPropre.call(__mjsLdGraine, __mjsLdU)) continue;
      var __mjsLdE = _mjsLdNeuve(__mjsLdU);
      __mjsLdE.d = __mjsLdGraine[__mjsLdU];
      __mjsLdE.t = Date.now();
      _mjsLdPlusLue(__mjsLdE);
    }
  }
  if (µ._mjs_storeRaw && _mjsLdPropre.call(µ._mjs_storeRaw, '__mjsLoad') && µ._mjs_storeDelete) µ._mjs_storeDelete('__mjsLoad');
}
catch {
  // reprise au mieux : une balise illisible ne casse jamais le démarrage
}
