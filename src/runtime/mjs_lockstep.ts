// mjs_lockstep — lockstep déterministe CÔTÉ CLIENT (« netcode »), posé PAR-DESSUS
// sock.game() (src/mjs-server/, mode def.mode:'lockstep' — cf. mjs-server/lockstep.ts pour le contrat
// serveur complet). Module 'schema' (AUCUNE dépendance dure à MjsSocket, cf. mjs_interp.ts en tête de
// fichier pour le patron) — mais INERTE (µ.lockstep jamais défini) sans µ.random (module 'det', cf.
// mjs_det.ts) : garde `typeof µ.random === 'function'` ci-dessous, jamais un crash au chargement.
//
//   partie = sock.game('rts', { code: true })     # def.mode:'lockstep' côté serveur
//   $etat  = µ.lockstep(partie, {
//     etat0:     function() { return { unites: {} }; },
//     appliquer: function(etat, ordre) { ... },    # ordre = {joueur, coup, p} — MÊME forme que
//                                                   # l'ordre en file côté serveur, cf. lockstep.ts
//     chaque: 60                                    # hash FNV toutes les 60 ticks — défaut 60
//   });
//   partie.move('bouger', { dx: 1, dy: 0 })   # émet l'ORDRE — INCHANGÉ (µ.lockstep n'enveloppe PAS
//                                              # .move, contrairement à µ.predict : tous les clients,
//                                              # ÉMETTEUR compris, attendent le retour µgame:orders)
//   {$etat.unites[...]}    # store réactif — le jeu rend dessus
//   $etat.rng.next()       # RNG PARTAGÉ (mulberry32, graine du serveur, cf. mjs_det.ts µ.random) —
//                          # closure sur `$etat` DANS `appliquer` (assigné avant tout événement
//                          # réseau, cf. boucle événementielle JS — jamais `null` à l'usage réel)
//   $etat.stop()
//
// ORDONNANCEMENT — µgame:orders arrive TICK PAR TICK (cf. mjs-server/lockstep.ts _diffuserOrdresTick) :
// tamponné par numéro de tick, appliqué en SÉQUENCE STRICTE (jamais un saut, cf. _mjlockstepDrainer)
// — un tick en avance sur `prochainTick` est mis en réserve jusqu'à ce que les précédents comblent le
// trou (réordre théorique seulement, WebSocket livre en ordre sur UNE connexion continue).
//
// RÉINITIALISATION — 'start' (1re assise) ET 'state' (résync après reconnexion, cf. mjs_game.ts
// _mjs_onResyncResolved) portent TOUS DEUX `{seed, journal}` (cf. mjs-server/game.ts::_infoMode) : MÊME
// traitement pour les deux (_mjlockstepReset) — repart de `etat0()`, ou de l'instantané `snapshot` que le
// serveur a gardé (cf. INSTANTANÉS ci-dessous), REJOUE le journal reçu (déjà connu ou manqué pendant la
// coupure), puis reprend le direct au tick suivant.
//
// INSTANTANÉS — quand le serveur les accepte (mjs-server lockstepJournal.snapshotEvery), 'start'/'state' portent
// aussi `snapshotEvery` (cadence en ticks) et `snapshotMax` (taille permise d'une proposition, en octets du JSON) :
// à chaque tick de la cadence reçu EN DIRECT (jamais pendant le rejeu d'un resync : ticks déjà certifiés ou
// périmés), le client propose `{tick, state, rng}` (µgame:snapshot, cf. partie._snapshot) — l'état à la fin du
// tick et celui du générateur partagé. Le serveur ne le garde que si au moins deux sièges et la majorité des
// sièges proposent le même, puis le renvoie au resync (`snapshot`) avec les seuls ordres qui le suivent : l'état
// repart d'une COPIE JSON de `snapshot.state` (d'où un état fait de JSON pur : objets, tableaux, nombres finis,
// chaînes, booléens, null) et le générateur de `snapshot.rng`. Une proposition plus grosse que `snapshotMax` n'est
// pas envoyée (MJS-WS couperait la connexion sur une trame trop grosse) : signalée une fois (µ.error), la partie
// continue sans instantané, son journal n'est pas coupé.
//
// JOURNAL TRONQUÉ — `def.lockstepJournal.maxTicks` CÔTÉ SERVEUR (mjs-server/lockstep.ts)
// borne le journal en anneau : un client trop longtemps déconnecté (raté plus de `maxTicks` ticks) reçoit
// au resync un journal qui NE COMMENCE PLUS au tick 1 — jusqu'ici rejoué SILENCIEUSEMENT depuis `etat0()`
// comme s'il était complet, état local FAUX sans le savoir avant le prochain quorum de hash (tardif, cf.
// DIVERGENCE ci-dessous). `_mjlockstepAnomalieJournal` détecte désormais CETTE anomalie (tête tronquée
// OU trou de continuité, filet défensif) AVANT le rejeu : log (µ.error) + un événement CLIENT-LOCAL
// équivalent à une divergence (`partie.on('event', fn)`, MÊME canal que la vraie divergence serveur
// ci-dessous, raison dédiée `'journal-truncated'`) — le replay continue ENSUITE inchangé, on signale, on
// ne bloque pas (cf. _mjlockstepDispatchEvent, _mjlockstepReinit).
//
// DIVERGENCE — toutes les `chaque` ticks, hash FNV-1a de `JSON.stringify(etat)` envoyé en
// µgame:hash (cf. partie._hash, mjs_game.ts) ; MÊME algorithme que deterministicSeed côté serveur
// (mjs-server/lockstep.ts), usage différent (état, pas id). Piège connu : l'ordre d'insertion des clés
// d'un objet JS influence JSON.stringify — si `appliquer` construit ses objets dans un ordre
// DÉPENDANT DES DONNÉES qui diffère entre clients, le hash pourrait diverger sans vraie divergence de
// jeu ; garder une construction d'objet stable (même code, même ordre partout) évite le piège.

if (typeof µ.random === 'function') {

// FNV-1a 32 bits — MÊME algorithme que mjs-server/lockstep.ts::deterministicSeed (cf. tête de fichier)
function _mjlockstepFnv(str) {
  var h = 0x811c9dc5, i;
  for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

function _mjlockstepAnnounceHash(st, tick) {
  st.game._hash(tick, _mjlockstepFnv(JSON.stringify(st.state)));
}

// générateur partagé SUIVI — mulberry32 (µ.random, mjs_det.ts) n'a pour état qu'un entier de 32 bits qui avance du même pas
// à chaque tirage (next() comme int()) : `st.rngState` le tient à jour, l'instantané le porte, et µ.random(rngState) repart
// exactement de là (cf. tête de fichier « INSTANTANÉS » ; tests/socket-lockstep-instantanes.test.ts garde l'accord avec mjs_det.ts)
var MJLOCKSTEP_RNG_STEP = 0x6D2B79F5;

function _mjlockstepRng(st, a) {
  var rng = µ.random(a);
  st.rngState = a >>> 0;
  return {
    next: function() { st.rngState = (st.rngState + MJLOCKSTEP_RNG_STEP) >>> 0; return rng.next(); },
    int: function(min, max) { st.rngState = (st.rngState + MJLOCKSTEP_RNG_STEP) >>> 0; return rng.int(min, max); }
  };
}

// propose l'instantané du tick au serveur — jamais au-delà de `snapshotMax` : une trame plus grosse que la limite du serveur lui
// ferait couper la connexion ; un état trop gros est signalé une fois et n'est pas proposé (cf. tête de fichier « INSTANTANÉS »)
function _mjlockstepProposeSnapshot(st, tick) {
  var size = new TextEncoder().encode(JSON.stringify({ tick: tick, state: st.state, rng: st.rngState })).length;
  if (size > st.snapMax) {
    if (!st.snapWarned) {
      st.snapWarned = true;
      µ.error('[µ.lockstep] ' + µ._mjs_txt('lockstepSnapshotTooBig', { size: size, tick: tick, max: st.snapMax }, 'instantané de {size} octets au tick {tick}, au-delà des {max} octets permis par le serveur (limits.maxPayload, lockstepJournal.maxBytes) — non proposé, le journal de la partie n\'est pas coupé'));
    }
    return;
  }
  st.game._snapshot(tick, st.state, st.rngState);
}

// reprises de l'état demandées après un apply() qui lève en direct : au plus MJLOCKSTEP_RESYNC_MAX par MJLOCKSTEP_RESYNC_WINDOW ms
var MJLOCKSTEP_RESYNC_MAX    = 3;
var MJLOCKSTEP_RESYNC_WINDOW = 60000;

// un apply() qui lève (un défaut du jeu) laisse son ordre à mi-chemin : l'état local n'est plus sûr. L'erreur est dite (µ.error, la
// première fois), la suite du tick est jouée — jamais un tick perdu ni une partie figée — et, en direct, l'état est repris du serveur
// (µgame:resync : état initial ou instantané, puis le journal rejoué, cf. _mjlockstepReset), cf. _mjlockstepResync ; d'ici là, ni hash
// ni instantané : un état faux n'est ni comparé ni proposé. Au rejeu, rien ne dit qu'il lève chez tous au même ordre (un défaut propre
// à ce joueur lève là aussi) : une reprise de plus rejouerait le même défaut, aucune n'est demandée — le rejeu est dit et la partie
// signalée, une fois (cf. _mjlockstepReset) ; un défaut du direct plus tard demande sa reprise comme le premier
function _mjlockstepApply(st, tick, order, live) {
  try { st.apply(st.state, order); }
  catch (e) {
    if (!st.applyWarned) {
      st.applyWarned = true;
      µ.error('[µ.lockstep] ' + µ._mjs_txt('lockstepApplyThrew', { tick: tick }, 'apply() a levé une erreur au tick {tick} : l\'ordre n\'est appliqué qu\'en partie et l\'état local de la partie n\'est plus sûr — corrigez apply(), qui doit appliquer chaque ordre sans lever d\'erreur'), e);
    }
    if (live) {
      st.suspect = true;
      _mjlockstepResync(st, tick);
    }
    else if (st.replayFault === null) { st.replayFault = tick; }
  }
}

// reprise de l'état faux (cf. _mjlockstepApply) : une à la fois (une demande en vol couvre les ticks reçus avant sa réponse, que le
// serveur a déjà fermés), au plus MJLOCKSTEP_RESYNC_MAX par MJLOCKSTEP_RESYNC_WINDOW ms — sans quoi un apply() qui lève à chaque ordre
// en demanderait une par tick. Au-delà, l'erreur est dite et la partie signalée (événement 'divergence', raison 'apply-threw'), une fois
// par attente : la reprise part dès que la fenêtre le permet, relue à chaque tick reçu (cf. _mjlockstepOnOrders)
function _mjlockstepResync(st, tick) {
  var now = Date.now(), times = st.resyncTimes, done, p;
  if (st.resyncing || !st.game._resync) { return; }
  if (times.length >= MJLOCKSTEP_RESYNC_MAX && now - times[0] < MJLOCKSTEP_RESYNC_WINDOW) {
    if (!st.limitSaid) {
      st.limitSaid = true;
      µ.error('[µ.lockstep] ' + µ._mjs_txt('lockstepResyncLimit', { tick: tick, max: MJLOCKSTEP_RESYNC_MAX, s: MJLOCKSTEP_RESYNC_WINDOW / 1000, wait: Math.ceil((times[0] + MJLOCKSTEP_RESYNC_WINDOW - now) / 1000) }, 'apply() a levé une erreur au tick {tick} alors que {max} reprises de l\'état en {s} s ont déjà été demandées : l\'état local de la partie reste faux jusqu\'à la prochaine reprise, dans {wait} s au plus — la partie le signale (événement \'divergence\', raison \'apply-threw\') ; corrigez apply(), qui doit appliquer chaque ordre sans lever d\'erreur'));
      _mjlockstepDispatchEvent(st, 'divergence', { tick: tick, reason: 'apply-threw' });
    }
    return;
  }
  times.push(now);
  if (times.length > MJLOCKSTEP_RESYNC_MAX) { times.shift(); }
  st.limitSaid = false;
  st.resyncing = true;
  done = function() { st.resyncing = false; };
  p = st.game._resync();
  if (p && typeof p.then === 'function') { p.then(done, done); }
  else { done(); }
}

// applique CHAQUE ordre du tick (dans l'ordre du tableau — MÊME ordre pour tous, cf. tête de fichier),
// avance `prochainTick`, annonce le hash toutes les `chaque` ticks (0 = jamais) ; EN DIRECT (`live`), propose
// l'instantané aux ticks de la cadence du serveur — ni l'un ni l'autre tant qu'un état faux attend sa reprise (cf. _mjlockstepApply)
function _mjlockstepReplayTick(st, tick, orders, live) {
  var i;
  for (i = 0; i < orders.length; i++) { _mjlockstepApply(st, tick, orders[i], live); }
  st.nextTick = tick + 1;
  if (st.suspect) { return; }
  if (st.every > 0 && tick % st.every === 0) { _mjlockstepAnnounceHash(st, tick); }
  if (live && st.snapEvery > 0 && tick % st.snapEvery === 0) { _mjlockstepProposeSnapshot(st, tick); }
}

// draine le tampon — applique tout tick CONSÉCUTIF déjà arrivé, jamais de saut (cf. tête de fichier)
function _mjlockstepDrain(st) {
  var group;
  while ((group = st.buffer[st.nextTick]) !== undefined) {
    delete st.buffer[st.nextTick];
    _mjlockstepReplayTick(st, group.tick, group.orders, true);
  }
}

// µgame:orders EN DIRECT — tick déjà couvert (résync/doublon) → ignoré ; sinon tamponné + drainage
function _mjlockstepOnOrders(st, frame) {
  if (typeof frame.tick !== 'number' || !frame.orders) { return; }
  if (frame.tick < st.nextTick) { return; }
  st.buffer[frame.tick] = frame;
  _mjlockstepDrain(st);
  // un état faux dont la reprise attend la fenêtre, ou dont la demande n'a pas abouti : relue à chaque tick (cf. _mjlockstepResync)
  if (st.suspect) { _mjlockstepResync(st, st.nextTick - 1); }
  _mjlockstepPublish(st);
}

// republie l'état sur le store réactif — réassignation PAR CLÉ RACINE (même stratégie que
// mjs_predict.ts::_mjpredictPublier) : `appliquer` mute `st.etat` EN PLACE, republier RECOPIE ses
// clés vers le store, où µ.state() observe chaque écriture (jamais un remplacement de RÉFÉRENCE de
// `st.etat` lui-même — le jeu garde la même identité d'objet d'un tick à l'autre). Retire D'ABORD
// les clés du store qui ne sont PLUS dans l'état (même garde que mjs_game.ts::_syncGameStore et
// mjs_optimistic.ts::_mjoptPublier) : sans ça, une clé racine supprimée par `appliquer` restait
// fantôme dans la vue publique, jamais effacée puisque la boucle ne visite QUE les clés présentes.
function _mjlockstepPublish(st) {
  var k;
  for (k in st.store) { if (!(k in st.state)) { delete st.store[k]; } }
  for (k in st.state) { st.store[k] = st.state[k]; }
}

// continuité du journal reçu au resync (cf. tête de fichier « JOURNAL TRONQUÉ ») — deux
// anomalies possibles : (a) `journal[0].tick > first` (tête tronquée, cf. lockstepJournal.maxTicks côté
// serveur ; `first` = 1, ou le tick qui suit l'instantané reçu) ; (b) trou entre deux entrées consécutives (tick n → tick n+2 — jamais produit par le vrai
// serveur, closeTick incrémente TOUJOURS de 1, cf. mjs-server/lockstep.ts — filet défensif). Journal
// VIDE = partie neuve, RAS (aucune anomalie, chemin nominal INCHANGÉ).
function _mjlockstepJournalAnomaly(journal, first) {
  var i;
  if (journal.length === 0) { return null; }
  if (journal[0].tick > first) { return { tick: journal[0].tick, expected: first }; }
  for (i = 1; i < journal.length; i++) {
    if (journal[i].tick !== journal[i - 1].tick + 1) { return { tick: journal[i].tick, expected: journal[i - 1].tick + 1 }; }
  }
  return null;
}

// notifie l'appli EXACTEMENT comme une divergence SERVEUR (même canal `partie.on('event', fn)`, cf.
// mjs_game.ts::_dispatchGame) — CLIENT-LOCAL, jamais émis sur le réseau. Réimplémenté ICI (jamais un
// appel direct à _dispatchGame, PRIVÉE au scope de mjs_game.ts) via `partie._mjs_handlers`, la structure
// MÊME que `.on()` alimente et que _dispatchGame lit — aucun nouveau système d'événements.
function _mjlockstepDispatchEvent(st, type, p) {
  var hs = st.game._mjs_handlers && st.game._mjs_handlers['event'], copy, i;
  if (!hs) { return; }
  copy = hs.slice();
  for (i = 0; i < copy.length; i++) { try { copy[i]({ game: st.game._mjs_gameId, type: type, p: p }); } catch (e) { µ.error('[µ.lockstep] event handler', e); } }
}

// réinitialisation COMPLÈTE — 'start' (1re assise) ET 'state' (résync), cf. tête de fichier :
// `frame.seed` absent (typeof !== 'number') = partie PAS en mode lockstep côté serveur (def.mode
// oublié/mal réglé) — signalé (µ.error) puis INERTE, jamais un throw qui casserait l'appelant.
function _mjlockstepReset(st, frame) {
  var i, g, journal, anomaly, snap = frame.snapshot;
  if (typeof frame.seed !== 'number') {
    µ.error('[µ.lockstep] ' + µ._mjs_txt('lockstepNotLockstep', { game: (frame.game || '?') }, 'partie \'{game}\' n\'est pas en mode lockstep côté serveur (def.mode) — µ.lockstep restera inerte'));
    return;
  }
  st.seed = frame.seed;
  st.suspect = false;   // repris du serveur (cf. _mjlockstepApply)
  st.limitSaid = false;
  st.snapEvery = typeof frame.snapshotEvery === 'number' ? frame.snapshotEvery : 0;
  st.snapMax = typeof frame.snapshotMax === 'number' ? frame.snapshotMax : 0;
  st.buffer = {};
  if (snap && typeof snap.tick === 'number') {
    // instantané gardé par le serveur : l'état (copié, la trame reste à l'appli) et le générateur à la fin de son tick
    st.state = JSON.parse(JSON.stringify(snap.state));
    st.rng = _mjlockstepRng(st, snap.rng);
    st.nextTick = snap.tick + 1;
  }
  else {
    st.state = st.state0();
    st.rng = _mjlockstepRng(st, frame.seed);
    st.nextTick = 1;
  }
  journal = frame.journal || [];
  anomaly = _mjlockstepJournalAnomaly(journal, st.nextTick);
  if (anomaly) {
    µ.error('[µ.lockstep] ' + µ._mjs_txt('lockstepJournalTruncated', { tick: anomaly.tick, expected: anomaly.expected }, 'journal tronqué au resync (tick {tick} reçu, tick {expected} attendu) — resync déterministe impossible, état local potentiellement faux'));
    _mjlockstepDispatchEvent(st, 'divergence', { tick: anomaly.tick, expected: anomaly.expected, reason: 'journal-truncated' });
  }
  st.replayFault = null;
  for (i = 0; i < journal.length; i++) { g = journal[i]; _mjlockstepReplayTick(st, g.tick, g.orders, false); }
  _mjlockstepPublish(st);
  // un rejeu qui lève ne répare rien : l'état garde un ordre appliqué en partie, que les autres joueurs n'ont peut-être pas — dit et
  // signalé (événement 'divergence', raison 'apply-threw') une fois, puis de nouveau seulement après un rejeu qui passe sans lever
  if (st.replayFault === null) { st.replaySaid = false; }
  else if (!st.replaySaid) {
    st.replaySaid = true;
    µ.error('[µ.lockstep] ' + µ._mjs_txt('lockstepReplayThrew', { tick: st.replayFault }, 'apply() a levé une erreur au tick {tick} pendant le rejeu de la reprise : la reprise ne rend pas l\'état local de la partie sûr, il diffère de celui des autres joueurs si apply() ne lève pas chez eux — la partie le signale (événement \'divergence\', raison \'apply-threw\') ; corrigez apply(), qui doit appliquer chaque ordre sans lever d\'erreur'));
    _mjlockstepDispatchEvent(st, 'divergence', { tick: st.replayFault, reason: 'apply-threw' });
  }
}

// --- entrée publique -----------------------------------------------------------------------------

µ.lockstep = function(game, opts) {
  opts = opts || {};
  var state0     = typeof opts.state0 === 'function' ? opts.state0 : function() { return {}; };
  var apply = typeof opts.apply === 'function' ? opts.apply : function() {};
  var every    = opts.every != null ? opts.every : 60;
  var st = {
    game: game, state0: state0, apply: apply, every: every,
    state: state0(), seed: null, rng: null, rngState: 0, buffer: {}, nextTick: 1, store: µ.state({}),
    snapEvery: 0, snapMax: 0, snapWarned: false, applyWarned: false, suspect: false, resyncing: false, resyncTimes: [], limitSaid: false,
    replayFault: null, replaySaid: false
  };

  _mjlockstepPublish(st);   // amorce le store avec l'état LOCAL initial — pas d'attente du réseau

  var offOrders = game.on('orders', function(frame) { _mjlockstepOnOrders(st, frame); });
  var offStart  = game.on('start',  function(frame) { _mjlockstepReset(st, frame); });
  var offState  = game.on('state',  function(frame) { _mjlockstepReset(st, frame); });

  Object.defineProperty(st.store, 'stop', {
    value: function() { offOrders(); offStart(); offState(); },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(st.store, 'rng', {
    get: function() { return st.rng; },
    enumerable: false,
    configurable: true
  });
  return st.store;
};

}
