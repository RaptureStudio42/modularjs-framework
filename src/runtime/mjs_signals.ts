// mjs_signals — noyau du graphe des signaux : boîtes paresseuses, dérivées relues par versions, reffets en file en deux
// temps, propriétaires. Joint au cœur seulement quand une unité du build a une valeur dérivée précise (son calcul note ses
// lectures) ou un reffet (bundler/index.ts, `wantsSignals`), avant tout fichier qui écrit ; les écritures du cœur y sont
// branchées (blocs `<signals>` : composant, magasin global, `µ.Store`, `µ.state`), retirés de tout cœur qui ne le porte pas.
// Chaque valeur dérivée précise d'un composant est un nœud (mjs_element.ts, `_mjsPrecise`) ; une valeur à l'horloge garde la
// règle de toujours, hors du graphe : un calcul qui la lit note ses racines à sa place (`_mjs_computedDeps`). Chaque reffet
// d'un composant (`µeffect`, `µeffect.before`) est un nœud mené par la passe de son composant (`µ._mjs_sigHost`) : marqué, il
// réveille son composant au lieu d'entrer dans la file, et sa passe le rejoue si une source lue à son dernier passage a vraiment
// changé (`µ._mjs_sigStale`, `µ._mjs_sigRunIn`). Sans lecture notée, aucune boîte n'existe
//
// - la valeur d'une variable reste rangée dans l'état de son propriétaire (`_state.x`) : la boîte n'en porte pas, et une
//   lecture hors calcul reste `$.x`, sans aucun coût de plus
// - une boîte `{ ver, subs, ep, state }` ne naît que pour une variable qu'un calcul en cours (dérivée, reffet) a lue ; le
//   code compilé note la lecture dans le code d'une dérivée, d'un reffet ou d'une fonction qu'ils appellent :
//   `(µ._mjs_sigCur != null && µ._mjs_sigRead(_mjsThis, 'x'), $.x)` (generator/transform-reactive.ts, `recordReads` ; une lecture
//   faite dans un rappel est notée une fois, en tête du calcul)
// - une écriture (`µ._mjs_sigWrite(propriétaire, 'x')`, une fois la valeur rangée, seulement si elle a changé) avance la
//   version de la boîte et marque ses lecteurs « à vérifier », avec leurs propres lecteurs ; rien n'est recalculé là. Un
//   rafraîchissement (`µrefresh($x)`, `µwrite`) marque les dérivées seulement : aucun reffet ne repart, celui qui
//   lit la variable elle-même prend acte de sa version, et une dérivée ainsi marquée laisse passer la prochaine vraie écriture
//   jusqu'à ses reffets (`rw`)
// - une dérivée se recalcule à sa lecture (`µ._mjs_sigGet(nœud)`), et seulement si une de ses sources a vraiment changé :
//   les sources sont revues dans l'ordre du dernier calcul, la première qui a changé arrête la vérification (une dérivée de
//   la branche quittée n'est jamais recalculée pour rien) ; chaque calcul refait la liste de ses sources ; une valeur
//   égale (`Object.is`) laisse la version en place : ses lecteurs ne recalculent rien (coupe-circuit)
// - un reffet marqué entre dans la file de son temps, avant l'écran (`µbefore`) ou après (`µeffect`) ; la passe, en
//   microtâche, joue ceux d'avant, puis l'écran (`µ._mjs_sigScreen`, posé par le runtime), puis ceux d'après, chaque temps
//   dans l'ordre de création ; `µ._mjs_sigBefore()` passe ceux d'avant tout de suite (voie synchrone d'un gestionnaire)
// - un reffet a toujours un propriétaire (composant, module, magasin, racine `µ._mjs_sigRoot`), qui le nettoie avec ses
//   dérivées et ses boîtes (`µ._mjs_sigDispose`) ; garde : les reffets d'un propriétaire qui reprennent plus de 10 000 fois
//   dans la même rafale de microtâches sont suspendus jusqu'à sa fin, avec un avertissement (règle du rendu, mjs_element.ts)
// - place de l'attente, que le runtime branchera plus tard : `pending` (relecture en vol), `abort` (annulation de la lecture
//   dépassée) ; `error` porte déjà l'exception du dernier calcul d'une dérivée qui a levé
// - champs posés sur un propriétaire, à déclarer dans sa classe pour garder sa forme : `_mjs_sigBoxes` (boîtes par nom de
//   variable ; false une fois nettoyé), `_mjs_sigNodes` (ses nœuds), `_mjs_sigBurst` et `_mjs_sigRuns` (garde). Un composant
//   retiré de la page pour de bon, ou échangé à chaud, perd ses nœuds sans mourir (`µ._mjs_sigDrop`) : ses boîtes restent
// - la file des reffets qui ne sont pas d'un composant et leurs propriétaires (blocs `<signal-queue>` : `µ._mjs_sigEffect`, la passe,
//   `µ._mjs_sigRoot`, `µ._mjs_sigDispose`) part du paquet quand aucune unité du build ne s'en sert (bundler/index.ts, SIG_QUEUE) : les
//   reffets d'un composant n'y passent pas

// états d'un nœud : propre, à vérifier (une source a peut-être changé), à calculer, nettoyé avec son propriétaire
const _MJS_SIG_CLEAN = 0;
const _MJS_SIG_CHECK = 1;
const _MJS_SIG_DIRTY = 2;
const _MJS_SIG_DEAD  = 3;
// sortes de nœud : dérivée, reffet d'avant l'écran, reffet d'après l'écran (le temps donne sa file : sorte - 1)
const _MJS_SIG_DERIVED = 0;
const _MJS_SIG_BEFORE  = 1;
const _MJS_SIG_AFTER   = 2;
// valeur d'une dérivée dont le dernier calcul a levé (l'exception est dans `error`)
const _MJS_SIG_FAILED = {};
// lecteurs d'un nœud que personne ne lit (reffet, dérivée nettoyée) : jamais rempli
const _MJS_SIG_NOBODY = Object.freeze([]);

// calcul en cours (dérivée ou reffet) : le code compilé le teste avant de noter une lecture
µ._mjs_sigCur   = null;
// propriétaire courant : celui d'une racine en cours, ou du reffet qui passe
µ._mjs_sigOwner = null;
// boîtes de clés du magasin supprimées (mjs_store_globals.ts) : tant qu'il y en a, un reffet garde celles qu'il lisait
µ._mjs_sigGone  = 0;

var _mjsSigEp    = 0;      // un numéro par calcul : une source n'est notée qu'une fois par calcul
var _mjsSigIds   = 0;      // ordre de création des nœuds, ordre de passage des reffets
var _mjsSigStack = [];     // pile du marquage, réutilisée (le marquage ne joue aucun code de l'appli)
var _mjsSigBurst = 0;      // rafale de microtâches en cours (garde des 10 000 reprises)
var _mjsSigTimer = null;   // minuterie qui clôt la rafale : elle ne passe que si la chaîne de microtâches s'arrête
// <signal-queue>
// l'écran, entre les deux temps de la file (posé par le runtime)
µ._mjs_sigScreen = null;
var _mjsSigLanes   = [[], []];   // file des reffets : avant l'écran, après l'écran
var _mjsSigPlanned = false;      // passe de la file déjà demandée
var _mjsSigBusy    = false;      // passe en cours : un appel imbriqué ne la relance pas
var _mjsSigErrors  = [];         // exceptions des reffets sans gestionnaire d'erreurs, relevées hors de la passe
// </signal-queue>


// ################################################################################################
// NŒUDS ET BOÎTES
// ################################################################################################

// nœud du graphe, même forme pour une dérivée et pour un reffet
function _mjsSigNode(owner, kind, name, f) {
  return { id: ++_mjsSigIds, kind: kind, f: f, v: void 0, ver: 0, subs: kind === _MJS_SIG_DERIVED ? [] : _MJS_SIG_NOBODY, ep: 0, deps: null, vers: null, state: _MJS_SIG_DIRTY, busy: false, queued: false, owner: owner, name: name, cleanup: null, pending: false, error: void 0, abort: null, wake: null, rw: false, keep: null };
}

// le propriétaire garde ses nœuds pour les nettoyer avec lui ; nettoyé, il n'en reçoit plus
function _mjsSigAdopt(owner, n) {
  var list = owner._mjs_sigNodes;
  if (list === false) return false;
  if (list == null) owner._mjs_sigNodes = [n];
  else list.push(n);
  return true;
}

// le calcul `t` lit `x` (boîte ou dérivée) : noté une fois par calcul, avec la version lue
function _mjsSigTrack(t, x) {
  if (x.ep === t.ep) return;
  x.ep = t.ep;
  t.deps.push(x);
  t.vers.push(x.ver);
}

// lecture notée de la variable `k` de `owner` par le calcul en cours ; sa boîte naît là, à la première
µ._mjs_sigRead = function(owner, k) {
  var t = µ._mjs_sigCur, boxes, b;
  // un reffet de composant ne note, des variables de composant, que celles du sien : une fonction d'un autre composant appelée pendant
  // son passage (méthode d'un enfant) lit pour ce composant-là, comme le relevé de la construction ; une clé du magasin (propriétaire
  // partagé, pas un élément) se note, qui que soit le lecteur
  if (t === null || (t.wake !== null && t.owner !== owner && owner.nodeType)) return;
  boxes = owner._mjs_sigBoxes;
  if (!boxes) {
    // propriétaire nettoyé : plus aucune boîte
    if (boxes === false) return;
    boxes = owner._mjs_sigBoxes = {};
  }
  b = boxes[k];
  // absente, ou membre hérité d'Object.prototype (`constructor`, `toString`…) : la boîte naît, en propre ; `__proto__` jamais
  if (b === undefined || b.subs === undefined) {
    if (k === '__proto__') return;
    b = boxes[k] = { ver: 0, subs: [], ep: 0, state: _MJS_SIG_CLEAN };
  }
  // déjà notée pendant ce calcul, ses racines comprises (deux dérivées qui se lisent n'y tournent pas en rond)
  if (b.ep === t.ep) return;
  _mjsSigTrack(t, b);
  // valeur dérivée à l'horloge (hors du graphe) : ses racines sont notées avec elle, le calcul repart à leur écriture ; une
  // racine du magasin (`$$x`) l'est dans les boîtes du magasin (mjs_store_globals.ts)
  var cs = owner._mjs_computeds, v, r, i;
  // <reffets-state>
  // valeur dérivée servie à l'horloge, dans un composant dont une valeur dérivée lit un état partagé : elle a pu être refaite avant ce
  // passage, sans que le reffet voie l'état — dans le doute, il passe au prochain rendu demandé par un état partagé (cf. µ._mjs_uRead)
  if (cs != null && t.wake !== null && (v = cs[k]) != null && (v._mjs_n == null || v._mjs_src === null) && _mjsUDeriv.has(cs)) t.uh = t.ep;
  // </reffets-state>
  if (cs == null || (v = cs[k]) == null || v._mjs_n != null || (r = owner._mjs_computedDeps) == null || (r = r[k]) == null) return;
  for (i = 0; i < r.length; i++) {
    if (r[i].charCodeAt(0) !== 36) µ._mjs_sigRead(owner, r[i]);
    else if (r[i].charCodeAt(1) === 36 && µ._mjs_storeSig) µ._mjs_sigRead(µ._mjs_storeSig, r[i].slice(2));
  }
};

// la variable `k` de `owner` vient de changer : sa boîte, si elle en a une en propre, avance et marque ses lecteurs ; `rw` :
// un rafraîchissement (`µrefresh($x)`, `µwrite`), qui ne relance aucun reffet
µ._mjs_sigWrite = function(owner, k, rw) {
  var boxes = owner._mjs_sigBoxes, t = µ._mjs_sigCur, b, j;
  if (!boxes) return;
  b = boxes[k];
  if (b === undefined || b.subs === undefined) return;
  // clé partagée (magasin) écrite par un reffet pendant son passage : elle sort des sources de ce passage, et n'y entre plus d'ici sa
  // fin ; sa propre écriture ne le relance pas, son relevé garde la règle fine (`$$x!`, cumul : generator/effect-deps.ts). Une clé que
  // le compilateur sait lue sans être écrite par le reffet (`keep`, mjs_effect.ts) reste une source : l'écriture vient d'un code qu'il
  // ne voit pas (aide d'un module, méthode d'un autre composant), qui le relance comme une écriture venue d'ailleurs
  if (t !== null && t.wake !== null && !owner.nodeType && (t.keep === null || t.keep.indexOf(k) < 0)) {
    if (b.ep !== t.ep) b.ep = t.ep;
    else if ((j = t.deps.indexOf(b)) >= 0) {
      t.deps.splice(j, 1);
      t.vers.splice(j, 1);
    }
  }
  b.ver++;
  // rafraîchissement écrit par le reffet qui passe (`µrefresh($x)` dans son code) : il prend acte de la version d'une source
  // lue dans ce passage, comme ses lecteurs propres (_mjsSigMark), sinon la fin du passage la verrait changée et le relancerait sans fin ;
  // une vraie écriture de cette source faite plus tôt dans le même passage le relance toujours. Chacune de ses places parmi les sources :
  // une dérivée calculée pendant le passage a pu relire la source après lui (`b.ep` est alors le sien), puis le reffet la noter de nouveau
  if (rw && t !== null && t.kind !== _MJS_SIG_DERIVED) for (j = 0; j < t.deps.length; j++) if (t.deps[j] === b && t.vers[j] === b.ver - 1) t.vers[j] = b.ver;
  if (b.subs.length !== 0) _mjsSigMark(b, !!rw);
};
// <reffets-state>

// LECTURE D'UN ÉTAT PARTAGÉ (`µ.state`, contexte `§§x`, `µStore` : clé `k` de `owner`, le propriétaire de ses boîtes) pendant le passage d'un
// reffet de composant : rangée à part de ses sources (`u` les boîtes lues, `uv` leur version, `ue` le passage qui les a notées), elle ne le
// réveille pas et ne change pas sa règle — un reffet qui ne lit qu'un état partagé passe encore à chaque mise à jour. Son composant, prévenu
// par l'état, la regarde quand il se redessine pour cet état seul (_mjsUGo, mjs_element.ts). La boîte naît à la première lecture ; les
// écritures de l'état l'avancent déjà (blocs `<signals>` de mjs_state.ts et de mjs_store.ts, avis de mjs_runes.ts). Lue par le calcul d'une
// valeur dérivée pendant le passage, elle est notée pour le reffet qui passe ; un gestionnaire déclenché pendant le passage lit pour lui seul.
// Une valeur dérivée dont le calcul lit un état partagé marque la table des valeurs dérivées de son composant (`_mjsUDeriv`), que ses
// miroirs partagent : le reffet d'un miroir qui lit une valeur refaite par l'original est dans le même doute (cf. µ._mjs_sigRead)
var _mjsUDeriv = new WeakSet();
µ._mjs_uRead = function(owner, k) {
  var t = µ._mjs_sigCur, c = µ._mjs_computing, e, boxes, b;
  if (c != null && c._mjs_computeds != null) _mjsUDeriv.add(c._mjs_computeds);
  if (t !== null && t.wake === null) t = (e = µ._mjs_effRun) != null && e.n !== undefined ? e.n : null;
  if (t === null) return;
  if (t.ue !== t.ep) {
    t.ue = t.ep;
    t.u  = [];
    t.uv = [];
  }
  boxes = owner._mjs_sigBoxes;
  // propriétaire nettoyé, ou `__proto__` (jamais une boîte) : lecture qui ne peut pas être notée, le reffet est dans le doute pour ce passage
  if (boxes === false || k === '__proto__') {
    t.uh = t.ep;
    return;
  }
  if (!boxes) boxes = owner._mjs_sigBoxes = {};
  b = boxes[k];
  if (b === undefined || b.subs === undefined) b = boxes[k] = { ver: 0, subs: [], ep: 0, state: _MJS_SIG_CLEAN };
  if (t.u.indexOf(b) < 0) {
    t.u.push(b);
    t.uv.push(b.ver);
  }
};
// </reffets-state>

// une source a changé : ses lecteurs passent « à vérifier », avec leurs propres lecteurs, et un reffet marqué entre dans
// la file (ou réveille son composant, qui le mène) ; rien n'est recalculé ici. Un lecteur qui n'est pas propre a déjà été
// marqué avec les siens : on s'y arrête, sauf une dérivée marquée par un rafraîchissement, qui n'a pas marqué ses reffets ;
// un reffet mené par son composant et déjà marqué le réveille encore (sa passe a pu être suspendue par la garde). Les
// lecteurs directs sont vus sans la pile, qui ne sert qu'aux dérivées lues à leur tour
function _mjsSigMark(src, rw) {
  var subs = src.subs, stack = _mjsSigStack, top = 0, direct = true, n, i, j;
  for (;;) {
    for (i = 0; i < subs.length; i++) {
      n = subs[i];
      if (n.kind !== _MJS_SIG_DERIVED) {
        // rafraîchissement : aucun reffet ne repart ; celui qui lit la variable elle-même prend acte de sa version (`j` : sa place
        // parmi les sources du reffet, jamais l'indice de la boucle, qui reprendrait sans fin sur deux lecteurs)
        if (rw) {
          if (direct && n.state === _MJS_SIG_CLEAN && (j = n.deps.indexOf(src)) >= 0) n.vers[j] = src.ver;
          continue;
        }
        if (n.state === _MJS_SIG_CLEAN) n.state = _MJS_SIG_CHECK;
        else if (n.wake === null || n.state === _MJS_SIG_DEAD) continue;
        if (n.wake !== null) n.wake(n);
        // <signal-queue>
        else _mjsSigQueue(n);
        // </signal-queue>
        continue;
      }
      if (n.state === _MJS_SIG_CLEAN) {
        n.state = _MJS_SIG_CHECK;
        n.rw    = rw;
      }
      else if (rw || !n.rw) continue;
      else n.rw = false;
      if (n.subs.length !== 0) stack[top++] = n;
    }
    if (top === 0) return;
    direct     = false;
    subs       = stack[--top].subs;
    stack[top] = null;
  }
}

// inscription d'un nœud auprès des sources de son dernier calcul ; mêmes sources dans le même ordre : rien ne bouge. Une
// dérivée nettoyée pendant ce calcul (son composant a quitté la page pour de bon) ne prend plus de lecteur
function _mjsSigLink(n, old) {
  var deps = n.deps, i = 0;
  if (old !== null) {
    if (old.length === deps.length) {
      while (i < deps.length && old[i] === deps[i]) i++;
      if (i === deps.length) return;
    }
    for (i = 0; i < old.length; i++) _mjsSigLeave(old[i], n);
  }
  for (i = 0; i < deps.length; i++) if (deps[i].state !== _MJS_SIG_DEAD) deps[i].subs.push(n);
}

// `n` quitte les lecteurs de `x` (leur ordre est sans importance : le dernier prend sa place)
function _mjsSigLeave(x, n) {
  var subs = x.subs, i = subs.indexOf(n);
  if (i < 0) return;
  subs[i] = subs[subs.length - 1];
  subs.pop();
}

// fin d'un calcul : inscription auprès des sources lues (les anciennes quittées), puis l'état du nœud ; une source changée
// pendant le calcul le laisse « à vérifier ». Rend vrai si le nœud a été nettoyé pendant son calcul : il quitte alors les
// sources du calcul précédent, celles de ce calcul ne l'ont jamais inscrit
function _mjsSigSettle(n, old) {
  var deps = n.deps, vers = n.vers, i;
  if (n.state === _MJS_SIG_DEAD) {
    if (old !== null) for (i = 0; i < old.length; i++) _mjsSigLeave(old[i], n);
    n.deps = n.vers = null;
    return true;
  }
  _mjsSigLink(n, old);
  n.state = _MJS_SIG_CLEAN;
  for (i = 0; i < deps.length; i++) {
    // une dérivée que seul un rafraîchissement a marquée (`rw` : `µrefresh($x)` écrit par le reffet qui passe) se refait à
    // sa prochaine lecture sans relancer le reffet, même quand elle rend un objet neuf
    if (deps[i].ver !== vers[i] || (deps[i].state === _MJS_SIG_CHECK && (n.kind === _MJS_SIG_DERIVED || !deps[i].rw))) {
      n.state = _MJS_SIG_CHECK;
      break;
    }
  }
  return false;
}


// ################################################################################################
// DÉRIVÉES
// ################################################################################################

// dérivée de `owner` (sinon du propriétaire courant ; `name`, symbole compris, sert aux messages : '$total'), calculée à
// sa première lecture
µ._mjs_sigDerived = function(owner, name, f) {
  var n;
  if (owner == null) owner = µ._mjs_sigOwner;
  n = _mjsSigNode(owner, _MJS_SIG_DERIVED, name, f);
  if (owner != null && !_mjsSigAdopt(owner, n)) n.state = _MJS_SIG_DEAD;
  return n;
};

// lecture d'une dérivée : relue si elle est marquée, notée si un calcul est en cours ; un calcul qui a levé relève son
// exception à chaque lecture, jusqu'au changement d'une source
µ._mjs_sigGet = function(n) {
  var t = µ._mjs_sigCur, s = n.state;
  if (s !== _MJS_SIG_CLEAN) {
    if (n.busy) return _mjsSigCycle(n);
    if (s !== _MJS_SIG_DEAD) _mjsSigFresh(n);
  }
  // un reffet de composant ne suit que les valeurs dérivées de son composant (même règle que ses lectures, µ._mjs_sigRead)
  if (t !== null && s !== _MJS_SIG_DEAD && (t.wake === null || t.owner === n.owner)) _mjsSigTrack(t, n);
  if (n.v === _MJS_SIG_FAILED) throw n.error;
  return n.v;
};

// cycle : la dérivée se lit pendant son propre calcul, directement ou par d'autres dérivées
function _mjsSigCycle(n) {
  µ.warn(µ._mjs_msg('sigCycle', { k: n.name }, 'Cycle réactif : la dérivée « {k} » se lit elle-même, directement ou par d\'autres dérivées ; cette lecture rend undefined. Retirez de son calcul la lecture qui revient à elle.'));
  return void 0;
}

// relecture d'une dérivée marquée : recalculée seulement si une source a vraiment changé depuis son dernier calcul
function _mjsSigFresh(n) {
  if (n.state === _MJS_SIG_CHECK && _mjsSigSame(n)) {
    if (n.state === _MJS_SIG_CHECK) n.state = _MJS_SIG_CLEAN;
  }
  else if (n.state !== _MJS_SIG_DEAD) _mjsSigCompute(n);
}

// aucune source n'a changé depuis le dernier calcul : elles sont revues dans l'ordre où le calcul les a lues, une dérivée
// vérifiée d'abord, et la première qui a changé arrête tout
function _mjsSigSame(n) {
  var deps = n.deps, vers = n.vers, i, x;
  for (i = 0; i < deps.length; i++) {
    x = deps[i];
    if (x.state === _MJS_SIG_CHECK || x.state === _MJS_SIG_DIRTY) {
      // cycle : la lecture qui suit le dira
      if (x.busy) return false;
      _mjsSigFresh(x);
    }
    if (x.ver !== vers[i]) return false;
  }
  return true;
}

// calcul d'une dérivée, sources notées à neuf ; une exception devient sa valeur ; même valeur : la version ne bouge pas
function _mjsSigCompute(n) {
  var old = n.deps, before = µ._mjs_sigCur, ok = true, v;
  n.deps        = [];
  n.vers        = [];
  n.ep          = ++_mjsSigEp;
  n.busy        = true;
  µ._mjs_sigCur = n;
  try {
    v = n.f();
  }
  catch (err) {
    ok = false;
    v  = err;
  }
  n.busy        = false;
  µ._mjs_sigCur = before;
  if (_mjsSigSettle(n, old)) return;
  if (!ok) {
    n.error = v;
    n.v     = _MJS_SIG_FAILED;
    n.ver++;
  }
  else if (!Object.is(v, n.v)) {
    n.error = void 0;
    n.v     = v;
    n.ver++;
  }
}


// ################################################################################################
// REFFETS, FILE EN DEUX TEMPS
// ################################################################################################

// <signals-free-handler>
// gestionnaire d'un `<@window>`, `<@document>`… (transpiler/macros.ts) : il tourne hors du calcul en cours, comme un gestionnaire du
// gabarit (mjs_element.ts) et un `µon` (mjs_on.ts) ; déclenché pendant le passage d'un reffet (`window.dispatchEvent`), de son composant
// ou d'un autre, ses lectures sont les siennes, jamais celles du reffet (sinon un gestionnaire qui cumule le relançait sans fin)
µ._mjs_sigFree = function(f) {
  return function() {
    var t = µ._mjs_sigCur;
    µ._mjs_sigCur = null;
    try {
      return f.apply(this, arguments);
    }
    finally {
      µ._mjs_sigCur = t;
    }
  };
};
// </signals-free-handler>

// <signal-queue>
// reffet de `owner` (sinon du propriétaire courant), avant l'écran si `before` ; refusé sans propriétaire, avec
// l'avertissement d'aujourd'hui (mjs_effect.ts) ; son premier passage part à la prochaine passe de la file
µ._mjs_sigEffect = function(owner, f, before) {
  var n;
  if (owner == null) owner = µ._mjs_sigOwner;
  if (owner == null || owner._mjs_sigNodes === false) {
    µ.warn(µ._mjs_msg('effectInit', null, 'µeffect s\'écrit au premier niveau du <script> d\'un composant, ou au premier niveau d\'un module (fichier .civet ou .coffee, fichier d\'un magasin compris) : dans une fonction appelée plus tard, il n\'a pas de propriétaire et ne tourne pas. Écrivez-le au premier niveau, et faites-lui lire ce qui doit le relancer ; pour un reffet lancé à la demande (à l\'ouverture d\'un panneau, par exemple), écrivez-le dans µeffect.root -> …, qui rend la fonction qui l\'arrête.'));
    return null;
  }
  n = _mjsSigNode(owner, before ? _MJS_SIG_BEFORE : _MJS_SIG_AFTER, '', f);
  _mjsSigAdopt(owner, n);
  _mjsSigQueue(n);
  return n;
};
// </signal-queue>

// reffet d'un composant, mené par la passe de son composant (mjs_element.ts) : marqué, il appelle `wake` au lieu d'entrer
// dans la file ; jamais passé, il passe à la première passe qui le regarde
µ._mjs_sigHost = function(owner, before, wake) {
  var n = _mjsSigNode(owner, before ? _MJS_SIG_BEFORE : _MJS_SIG_AFTER, '', null);
  n.wake = wake;
  if (!_mjsSigAdopt(owner, n)) n.state = _MJS_SIG_DEAD;
  return n;
};

// un reffet mené par son composant doit-il repartir ? jamais passé, ou une source lue à son dernier passage a vraiment changé
// (revue dans l'ordre de ses lectures, une dérivée vérifiée d'abord : une dérivée refaite à l'identique ne compte pas)
µ._mjs_sigStale = function(n) {
  if (n.state === _MJS_SIG_CLEAN || n.state === _MJS_SIG_DEAD) return false;
  if (n.state === _MJS_SIG_CHECK && _mjsSigSame(n)) {
    if (n.state === _MJS_SIG_CHECK) n.state = _MJS_SIG_CLEAN;
    return false;
  }
  return n.state !== _MJS_SIG_DEAD;
};

// passage d'un reffet mené par son composant : son code, sources notées à neuf (celles d'un passage qui lève : ce qu'il a lu
// avant l'erreur) ; une source qu'il change lui-même le réveille, comme une écriture venue d'ailleurs
µ._mjs_sigRunIn = function(n, f, self) {
  var old = n.deps, before = µ._mjs_sigCur, owner = µ._mjs_sigOwner;
  // reffet sorti du graphe (composant revenu dans la page après en être sorti pour de bon) : il suit son relevé
  if (n.state === _MJS_SIG_DEAD) return f.call(self);
  n.deps          = [];
  n.vers          = [];
  n.ep            = ++_mjsSigEp;
  n.busy          = true;
  µ._mjs_sigCur   = n;
  µ._mjs_sigOwner = n.owner;
  try {
    return f.call(self);
  }
  finally {
    n.busy          = false;
    µ._mjs_sigCur   = before;
    µ._mjs_sigOwner = owner;
    // clé du magasin supprimée qu'il lisait (`gone`) : sa lecture sans accesseur n'est pas notée, elle reste une source jusqu'à son retour
    if (µ._mjs_sigGone !== 0 && old !== null) for (var i = 0; i < old.length; i++) if (old[i].gone) _mjsSigTrack(n, old[i]);
    if (!_mjsSigSettle(n, old) && n.state === _MJS_SIG_CHECK) {
      // un reffet d'avant l'écran ne repart pas sur ses propres écritures (elles entrent dans le passage en cours, mjs_element.ts)
      if (n.kind === _MJS_SIG_BEFORE) µ._mjs_sigAck(n);
      else n.wake(n);
    }
  }
};

// le reffet prend acte de la version de chacune de ses sources, sans passer : ce qui a changé ne le relance pas
µ._mjs_sigAck = function(n) {
  var deps = n.deps, i;
  if (n.state === _MJS_SIG_DEAD || deps === null) return;
  for (i = 0; i < deps.length; i++) n.vers[i] = deps[i].ver;
  n.state = _MJS_SIG_CLEAN;
};

// <signal-queue>
// un reffet entre dans la file de son temps ; la passe est demandée une fois, en microtâche
function _mjsSigQueue(n) {
  if (n.queued) return;
  n.queued = true;
  _mjsSigLanes[n.kind - 1].push(n);
  if (_mjsSigPlanned) return;
  _mjsSigPlanned = true;
  queueMicrotask(_mjsSigPass);
}

function _mjsSigPass() {
  _mjsSigPlanned = false;
  µ._mjs_sigFlush();
}

// passe de la file : les reffets d'avant l'écran, l'écran, puis ceux d'après ; ce qu'ils remettent en file repasse au tour
// suivant, jusqu'à la file vide (la garde des 10 000 reprises borne une boucle sans fin)
µ._mjs_sigFlush = function() {
  if (_mjsSigBusy) return;
  _mjsSigBusy = true;
  try {
    while (_mjsSigLanes[0].length !== 0 || _mjsSigLanes[1].length !== 0) {
      _mjsSigLane(0);
      if (µ._mjs_sigScreen !== null) µ._mjs_sigScreen();
      _mjsSigLane(1);
    }
  }
  finally {
    _mjsSigBusy = false;
    _mjsSigReport();
  }
};

// voie synchrone : les reffets d'avant l'écran tout de suite, juste avant les liaisons ; ceux d'après restent en file
µ._mjs_sigBefore = function() {
  if (_mjsSigBusy) return;
  _mjsSigBusy = true;
  try {
    while (_mjsSigLanes[0].length !== 0) _mjsSigLane(0);
  }
  finally {
    _mjsSigBusy = false;
    _mjsSigReport();
  }
};

// un temps de la file, dans l'ordre de création ; ce que ses reffets remettent en file attend le tour suivant
function _mjsSigLane(i) {
  var list = _mjsSigLanes[i], j, n;
  if (list.length === 0) return;
  _mjsSigLanes[i] = [];
  if (list.length > 1) list.sort(_mjsSigOrder);
  for (j = 0; j < list.length; j++) {
    n        = list[j];
    n.queued = false;
    _mjsSigRun(n);
  }
}

function _mjsSigOrder(a, b) {
  return a.id - b.id;
}

// passage d'un reffet de la file : rien si ses sources n'ont pas bougé ; sinon son nettoyage, puis son code, sources
// notées à neuf ; la fonction qu'il rend est son prochain nettoyage ; une source qu'il change lui-même le remet en file
function _mjsSigRun(n) {
  var c = n.cleanup, old, before, owner, r, ok = true;
  if (n.state === _MJS_SIG_DEAD || n.state === _MJS_SIG_CLEAN) return;
  if (n.state === _MJS_SIG_CHECK && _mjsSigSame(n)) {
    if (n.state === _MJS_SIG_CHECK) n.state = _MJS_SIG_CLEAN;
    return;
  }
  if (n.state === _MJS_SIG_DEAD) return;
  // propriétaire suspendu jusqu'à la fin de la rafale : la prochaine écriture remet le reffet en file, et ses versions
  // diront qu'il est en retard
  if (!_mjsSigCount(n.owner)) {
    n.state = _MJS_SIG_CLEAN;
    return;
  }
  if (c !== null) {
    n.cleanup = null;
    _mjsSigCleanup(c);
    // nettoyage qui a nettoyé le propriétaire
    if (n.state === _MJS_SIG_DEAD) return;
  }
  old             = n.deps;
  before          = µ._mjs_sigCur;
  owner           = µ._mjs_sigOwner;
  n.deps          = [];
  n.vers          = [];
  n.ep            = ++_mjsSigEp;
  n.busy          = true;
  µ._mjs_sigCur   = n;
  µ._mjs_sigOwner = n.owner;
  try {
    r = n.f();
  }
  catch (err) {
    ok = false;
    r  = err;
  }
  n.busy          = false;
  µ._mjs_sigCur   = before;
  µ._mjs_sigOwner = owner;
  if (_mjsSigSettle(n, old)) {
    // propriétaire nettoyé pendant le passage : ce que le reffet vient de rendre joue aussitôt
    if (!ok) _mjsSigFail(n.owner, r);
    else if (typeof r === 'function' && !r._mjs_timer) _mjsSigCleanup(r);
    return;
  }
  if (!ok) _mjsSigFail(n.owner, r);
  else if (typeof r === 'function' && !r._mjs_timer) n.cleanup = r;   // main d'arrêt de µafter / µevery rendue : pas un nettoyage (mjs_every.ts)
  if (n.state === _MJS_SIG_CHECK) _mjsSigQueue(n);
}

// nettoyage d'un reffet : une exception n'arrête rien, elle est signalée comme aujourd'hui (_mjs_runEffectsV2)
function _mjsSigCleanup(c) {
  try {
    c();
  }
  catch (err) {
    µ.warn('Cleanup error:', err);
  }
}

// exception d'un reffet : au gestionnaire d'erreurs de son propriétaire (frontière d'erreur d'un composant), sinon
// relevée hors de la passe ; les autres reffets passent
function _mjsSigFail(owner, err) {
  if (typeof owner._mjs_catchError === 'function') owner._mjs_catchError(err);
  else _mjsSigErrors.push(err);
}

// fin d'une passe : chaque exception sans gestionnaire part seule, en microtâche (aucune n'est tue)
function _mjsSigReport() {
  var list = _mjsSigErrors, i;
  if (list.length === 0) return;
  _mjsSigErrors = [];
  for (i = 0; i < list.length; i++) _mjsSigRaise(list[i]);
}

function _mjsSigRaise(err) {
  queueMicrotask(function() {
    throw err;
  });
}
// </signal-queue>

// garde des 10 000 reprises : les reffets d'un propriétaire qui reprennent sans fin dans la même rafale de microtâches
// sont suspendus jusqu'à sa fin, avec un avertissement (une fois par rafale) ; l'écran, lui, continue
function _mjsSigCount(owner) {
  var c;
  if (_mjsSigTimer === null) _mjsSigTimer = setTimeout(_mjsSigBurstEnd, 0);
  if (owner._mjs_sigBurst !== _mjsSigBurst) {
    owner._mjs_sigBurst = _mjsSigBurst;
    owner._mjs_sigRuns  = 0;
  }
  c = ++owner._mjs_sigRuns;
  if (c <= 10000) return true;
  if (c === 10001) µ.warn(µ._mjs_msg('sigLoop', { owner: _mjsSigName(owner) }, 'Boucle réactive détectée sur {owner} : ses reffets ont repris plus de 10 000 fois dans la même rafale de microtâches. Un reffet écrit sans doute une valeur qu\'il lit ($x = $x + 1 dans un µeffect ?). Ses reffets sont suspendus jusqu\'à la fin de la rafale pour garder la page vivante : vérifiez ce que chacun écrit.'));
  return false;
}

// garde de la passe d'un composant réveillé par le graphe (mjs_element.ts) : la même, par propriétaire
µ._mjs_sigGuard = _mjsSigCount;

function _mjsSigBurstEnd() {
  _mjsSigTimer = null;
  _mjsSigBurst++;
}

// nom d'un propriétaire dans un message : la balise d'un composant, sinon le nom que le runtime lui donne
function _mjsSigName(owner) {
  return owner.tagName ? '<' + String(owner.tagName).toLowerCase() + '>' : (owner._mjs_sigName || '?');
}


// ################################################################################################
// PROPRIÉTAIRES
// ################################################################################################

// <signal-queue>
// racine explicite : propriétaire des reffets et des dérivées créés pendant `fn` sans autre propriétaire ; rend sa
// fonction de fin
µ._mjs_sigRoot = function(fn) {
  var root = { _mjs_sigNodes: null, _mjs_sigBoxes: null }, before = µ._mjs_sigOwner;
  µ._mjs_sigOwner = root;
  try {
    fn();
  }
  finally {
    µ._mjs_sigOwner = before;
  }
  return function() {
    µ._mjs_sigDispose(root);
  };
};

// fin d'un propriétaire : ses nœuds quittent leurs sources et ne jouent plus, le nettoyage de chaque reffet passe une
// fois, ses boîtes se libèrent ; il ne reçoit plus ni boîte ni reffet
µ._mjs_sigDispose = function(owner) {
  var nodes = owner._mjs_sigNodes, boxes = owner._mjs_sigBoxes, i, n, c;
  owner._mjs_sigNodes = false;
  owner._mjs_sigBoxes = false;
  if (boxes) for (const k of Object.keys(boxes)) boxes[k].subs = [];
  if (!nodes) return;
  for (i = 0; i < nodes.length; i++) {
    n         = nodes[i];
    c         = n.cleanup;
    n.cleanup = null;
    _mjsSigCut(n);
    if (c !== null) _mjsSigCleanup(c);
  }
};
// </signal-queue>

// nœuds d'un propriétaire qui reste en vie : le nœud `which`, ses reffets (`which` = 1) ou tous ses nœuds quittent leurs sources
// et ne jouent plus, sans nettoyage (celui d'un reffet de composant est à son composant) ; ses boîtes restent, celles qu'il partage
// avec ses miroirs comprises. Reffet retiré, composant retiré de la page pour de bon (ses reffets), échangé à chaud (tous : ils
// renaissent avec le nouveau code)
µ._mjs_sigDrop = function(owner, which) {
  var list = owner._mjs_sigNodes, keep = null, i, n;
  if (!list) return;
  for (i = 0; i < list.length; i++) {
    n = list[i];
    if (which === void 0 || which === n || (which === 1 && n.kind !== _MJS_SIG_DERIVED)) _mjsSigCut(n);
    else (keep ||= []).push(n);
  }
  owner._mjs_sigNodes = keep;
};

// un nœud nettoyé : il ne joue plus, ne se recalcule plus, quitte ses sources ; en plein calcul, il est encore inscrit
// auprès des sources du calcul précédent, que la fin du calcul retire (_mjsSigSettle)
function _mjsSigCut(n) {
  var deps = n.deps, i;
  n.state = _MJS_SIG_DEAD;
  n.subs  = _MJS_SIG_NOBODY;
  if (n.busy || deps === null) return;
  for (i = 0; i < deps.length; i++) _mjsSigLeave(deps[i], n);
  n.deps = n.vers = null;
}
