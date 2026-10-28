// mjs_socket — couche WebSocket réactive (protocole temps réel v1).
//
//   sock = µ.socket("wss://jeu/play", { auth: -> { token: $$session.token } })
//   sock.state / sock.latency / sock.connected / sock.lastError / sock.resumed   # réactifs
//   off = sock.on(type, (p) -> …) ; sock.send(type, p)
//   await sock.request(type, p, {timeout})
//   $$x = sock.stream(type) ; sock.unstream(type) ; $$j = sock.presence(room?) ; zone = sock.room(name)
//   sock.on('welcome', (p) -> …) ; sock.resumed   # accueil serveur + reprise ('welcome' réservé)
//   sock.on('denied', (p) -> …)                   # auth refusée, fil fermé pour de bon ('denied' réservé)
//
// Singleton par URL (référence-compté). Connexion paresseuse. `open` n'est
// atteint qu'après le handshake µ:welcome. Trames de contrôle préfixe `µ:`.

// tempête de reconnexion — durée de connexion TENUE après un
// µ:welcome avant de juger la connexion « stable » et remettre le backoff à zéro (cf. _mjs_onWelcome/
// _mjs_teardown). Sans ce délai, un serveur qui accueille PUIS coupe aussitôt (surcharge, bug, attaque)
// faisait retomber `_mjs_attempt` à 0 à CHAQUE cycle — le backoff `[500,1000,2000,5000]` n'escaladait
// alors jamais, indéfiniment (pilonnage au palier le plus court).
var MJSOCKET_STABLE_MS = 2000;
// les trames des effets en direct (volatiles et regroupées : curseurs, défilement ; points de chaleur)
// partagent la connexion de l'appli, dont le serveur borne le débit (40/s par défaut) et expulse qui
// dépasse : à elles toutes, pas plus de MJSOCKET_FX_RATE par seconde — le reste est pour l'appli ;
// `"effects": { "rate": n }` de mjs.config.json la règle (µ._fxConf, posé par le manifeste)
var MJSOCKET_FX_RATE = 4;
// un salon quitté attend la preuve de son départ, la réponse du serveur à une trame partie après son µ:leave sur la même connexion
// (cf. _mjs_sendLeave) : faute de quoi, le client envoie lui-même un µ:ping, un pour tous les départs, une fois la ligne calme depuis
// MJSOCKET_LEAVE_PING_MS (aucune trame partie) — jamais une trame de plus dans un échange suivi, une boucle rejoindre / quitter par
// exemple —, ou sans attendre dès MJSOCKET_LEAVE_BATCH départs qu'aucun µ:ping n'a suivis : une reprise de session ne les redirait
// pas tous d'un coup. Il retient au plus MJSOCKET_MAX_LEAVES départs, autant de salons qu'un client peut en tenir sur MJS-WS par
// défaut (limits.maxRoomsPerClient) — au-delà, le plus ancien est oublié
var MJSOCKET_LEAVE_PING_MS = 1000;
var MJSOCKET_LEAVE_BATCH   = 10;
var MJSOCKET_MAX_LEAVES    = 50;

// la part des effets en direct, par seconde : celle de la config, sinon MJSOCKET_FX_RATE
µ._mjs_fxRate = function() {
  var r = µ._fxConf && µ._fxConf.rate;
  return typeof r === 'number' && r >= 1 ? r : MJSOCKET_FX_RATE;
};

µ._mjs_sockets = µ._mjs_sockets || {};
// les effets en direct qui attendent que l'appli ouvre leur connexion (son `auth`, cf. µ._mjs_fxSock)
µ._mjs_sockWait = µ._mjs_sockWait || [];
// rien dans la variable de sa connexion au bout de ce délai : l'effet en direct le dit en console (ms)
µ._mjs_sockGrace = 2000;
// une propriété du composant (`@sock`) n'est suivie par rien : tant que l'effet n'a pas de connexion, il la relit
// à cet intervalle (ms)
µ._mjs_sockPoll = 250;
// le numéro de la prochaine connexion propre à un effet (sa clé dans µ._mjs_sockets)
var _mjsSockOwn = 0;
// une trame binaire reçue sans le module 'schema' : illisible, ignorée — dite une fois par page (cf. _mjs_onMessage)
var _mjsSockBinSaid = 0;

// deux `auth` qui disent la même identité : `null`, `undefined` et l'absence disent « aucune » ; deux objets se
// comparent par leurs clés (symboles compris), quel que soit l'ordre (une clé `undefined` n'est pas une clé : elle ne
// partirait pas) ; deux dates par leur instant, deux `Map` et deux `Set` par leur contenu, `NaN` est égal à `NaN` ;
// deux expressions régulières par leur source et leurs drapeaux, deux erreurs par leur nom et leur message, deux
// primitives encapsulées par leur valeur, deux `URL` par leur adresse, deux tampons, vues et tableaux typés par leurs
// octets, deux `WeakMap` ou `WeakSet` par référence seule ; deux fonctions ne se comparent que par référence — deux
// fermetures de même code peuvent porter deux identités, la prudence avertit — ; un objet circulaire n'est égal
// qu'à lui-même ; jamais d'exception (un getter ou un Proxy qui lève, une chaîne trop profonde) : « différent »,
// donc l'avertissement prudent
var _mjsSockDepth = 64;
// deux suites d'octets ou d'éléments (tampon, vue, tableau typé) : même longueur, mêmes éléments, `NaN` égal à `NaN`
var _mjsSockOctets = function(x, y) {
  if (x.length !== y.length) return false;
  for (var i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
  return true;
};
var _mjsSockSame = function(a, b, visited) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  visited = visited || [];
  if (visited.length >= _mjsSockDepth * 2) return false;
  if (visited.indexOf(a) >= 0 || visited.indexOf(b) >= 0) return false;
  visited.push(a, b);
  var ok = false;
  try {
    var tag = Object.prototype.toString.call(a);
    if (Array.isArray(a) !== Array.isArray(b)) ok = false;
    else if (!Array.isArray(a) && tag !== Object.prototype.toString.call(b)) ok = false;
    else if (a instanceof Date) ok = Object.is(a.getTime(), b.getTime());
    else if (a instanceof RegExp) ok = a.source === b.source && a.flags === b.flags;
    else if (a instanceof Error) ok = a.name === b.name && a.message === b.message;
    else if (tag === '[object Number]' || tag === '[object Boolean]' || tag === '[object String]') ok = Object.is(a.valueOf(), b.valueOf());
    else if (typeof URL !== 'undefined' && a instanceof URL) ok = a.href === b.href;
    else if (tag === '[object WeakMap]' || tag === '[object WeakSet]') ok = false;
    else if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') ok = _mjsSockOctets(new Uint8Array(a), new Uint8Array(b));
    else if (tag === '[object DataView]') ok = _mjsSockOctets(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    else if (ArrayBuffer.isView(a)) ok = _mjsSockOctets(a, b);
    else if (a instanceof Map) {
      ok = a.size === b.size;
      a.forEach(function(v, k) { if (ok) ok = b.has(k) && _mjsSockSame(v, b.get(k), visited); });
    }
    else if (a instanceof Set) {
      ok = a.size === b.size;
      a.forEach(function(v) { if (ok) ok = b.has(v); });
    }
    else if (Array.isArray(a)) {
      ok = a.length === b.length;
      for (var i = 0; ok && i < a.length; i++) ok = _mjsSockSame(a[i], b[i], visited);
    }
    else {
      var enumKeys = function(o) {
        var allKeys = Reflect.ownKeys(o);
        var out     = [];
        for (var m = 0; m < allKeys.length; m++) if (Object.prototype.propertyIsEnumerable.call(o, allKeys[m]) && o[allKeys[m]] !== void 0) out.push(allKeys[m]);
        return out;
      };
      var ka  = enumKeys(a);
      var kb  = new Set(enumKeys(b));
      ok = ka.length === kb.size;
      for (var j = 0; ok && j < ka.length; j++) ok = kb.has(ka[j]) && _mjsSockSame(a[ka[j]], b[ka[j]], visited);
    }
  }
  catch {
    ok = false;
  }
  visited.length -= 2;
  return ok;
};
var _mjsSockSameAuth = function(a, b) {
  return _mjsSockSame(a == null ? null : a, b == null ? null : b);
};

µ.socket = function(url, opts) {
  // la connexion propre d'un effet en direct (`server`) : à lui seul, jamais celle que l'appli tient ou tiendra à
  // la même adresse, ni ses options, ni son identité ; connue de µ._mjs_sockets (l'effet *offline la voit),
  // sous une clé à elle
  if (opts && opts._mjs_own) {
    var own = new MjsSocket(url, opts);
    own._mjs_key = url + '\u0000' + (++_mjsSockOwn);
    µ._mjs_sockets[own._mjs_key] = own;
    return own;
  }
  var existing = µ._mjs_sockets[url];
  if (existing && !existing._mjs_destroyed) {
    existing._mjs_refs++;
    // une autre identité demandée à une adresse déjà tenue : la connexion revient telle quelle, sous sa première
    // identité — la console le dit une fois par connexion, au lieu de se taire
    // sans option, ou sans clé `auth` : l'appel ne demande aucune identité, il reprend la connexion telle qu'elle est
    var dits = existing._mjs_warnedOpts || (existing._mjs_warnedOpts = {});
    if (opts && typeof opts === 'object' && 'auth' in opts && !_mjsSockSameAuth(existing.opts && existing.opts.auth, opts.auth) && !dits['reuse-auth']) {
      dits['reuse-auth'] = true;
      µ.warn('[µ.socket] ' + µ._mjs_txt('sockDuplicateAuth', { url: url }, '{url} : une connexion à cette adresse existe déjà avec un autre auth — elle vous revient telle quelle, sous sa première identité ; fermez-la (destroy()) avant d\'en ouvrir une autre sous une autre identité'));
    }
    return existing;
  }
  var s = new MjsSocket(url, opts || {});
  µ._mjs_sockets[url] = s;
  return s;
};

// les effets en direct qui attendent que leur connexion s'ouvre : réveillés quand une connexion s'ouvre, juste
// après (l'appli tient déjà son objet)
µ._mjs_sockWake = function() {
  if (!µ._mjs_sockWait.length) return;
  Promise.resolve().then(function() {
    µ._mjs_sockWait.slice().forEach(function(w) { w(); });
  });
};

// la route de la page change (la navigation du routeur MJS, le retour en arrière du navigateur, l'ancre) :
// `fn` est appelée ; rend de quoi ne plus l'écouter
µ._mjs_fxRoute = function(fn) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return function() {};
  var evs = ['mjs-route-changed', 'popstate', 'hashchange'];
  evs.forEach(function(e) { window.addEventListener(e, fn); });
  return function() { evs.forEach(function(e) { window.removeEventListener(e, fn); }); };
};

// la variable de la connexion d'un effet en direct quand c'est une propriété du composant (`@sock` par défaut,
// `sock: @autre`) : de quoi la relire — aucun suivi n'avertit d'une propriété qu'on pose plus tard ; rien pour
// un store ou un état (`$$sock`, `$x`), que le moteur des effets suit déjà. `el` : la balise de l'effet, `comp` :
// le composant qui l'a posé (le troisième argument du `setup`)
µ._mjs_fxVar = function(el, name, comp) {
  if (!comp || typeof comp !== 'object') return null;
  var w    = el && el._mjs_fxWritten && el._mjs_fxWritten[name] && el._mjs_fxWritten[name].sock;
  var path = w === void 0 ? ['sock'] : /^@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(w) ? w.slice(1).split('.') : null;
  if (!path) return null;
  return function() {
    var v = comp;
    for (var i = 0; v && i < path.length; i++) v = v[path[i]];
    return v;
  };
};

// la connexion d'un effet en direct (*follow, *cursors, *react, *heatmap) : celle de sa variable (`sock`,
// `@sock` du composant par défaut), tenue sans la retenir — l'appli la ferme (`destroy()`, à la
// déconnexion d'un utilisateur) : elle se ferme vraiment et l'effet s'en détache ; une autre connexion
// dans la variable relance l'effet (µ._mjs_fxSet). Une propriété du composant (`@sock`), qu'aucun suivi n'avertit,
// est relue (`more.read`, cf. µ._mjs_fxVar) tant que l'effet n'a pas de connexion : posée plus tard (après une
// connexion de l'utilisateur, après un `await`), ou à la place de celle que l'appli a fermée, elle est prise aussi.
// Avec un `auth` et pas encore ouverte, l'effet attend que l'appli l'ouvre (il ne l'ouvre pas sans l'identité).
// `server` écrit (et pas de `sock`) : sa connexion à lui seul — jamais celle que l'appli tient ou tiendra à la même
// adresse, ni son identité —, fermée avec l'effet. Rien dans la variable (ou autre chose qu'une connexion) : rien
// ne part, et l'effet le dit en console (`msg`) après µ._mjs_sockGrace. `link(sock)` pose ce qui vit sur la
// connexion (salon, écoutes) et rend de quoi le défaire ; `more.room` rend le nom du salon de la page : quand la
// route change, ce que `link` a posé est défait puis refait (la connexion reste ; l'effet relit son salon) ; rend
// de quoi renoncer
µ._mjs_fxSock = function(given, server, msg, link, more) {
  more = more || {};
  var done     = false;
  var sock     = null;
  var undo     = null;
  var wait     = null;
  var awaited  = null;
  var timer    = 0;
  var watch    = 0;
  var roomName = null;
  var route    = null;
  var usable   = function(k) { return !!k && typeof k === 'object' && typeof k.room === 'function' && !k._mjs_destroyed; };
  var prete    = function(k) { return !k._mjs_destroyed && (k.state === 'open' || !k.opts || k.opts.auth === void 0); };
  var bind     = function(k) {
    sock  = k;
    roomName = more.room ? more.room() : null;
    undo  = link(k);
  };
  var defait = function() {
    var u = undo;
    undo = null;
    sock = null;
    if (typeof u === 'function') u();
  };
  // la route change : le salon change, la connexion reste — l'effet quitte l'ancien salon et rejoint le nouveau, un
  // microtour plus tard : le routeur dit « la route change » AVANT d'injecter la vue suivante, et l'effet d'une vue que
  // la navigation retire ne rejoint pas le salon d'après pour le quitter aussitôt (un faux arrivant chez les autres) ;
  // plusieurs événements d'une même navigation (popstate, hashchange) : le premier refait le lien, les autres trouvent
  // le salon déjà refait
  if (more.room) {
    var rebind = function() {
      if (done || !sock || more.room() === roomName) return;
      var u = undo;
      undo = null;
      if (typeof u === 'function') u();
      bind(sock);
    };
    route = µ._mjs_fxRoute(function() {
      Promise.resolve().then(function() {
        // sous une View Transition, la vue sortante reste en place (et son effet vivant) jusqu'à la fin du rappel
        // qui permute les vues : on attend cette permutation — celle que le routeur a lancée, `activeViewTransition`
        // est déjà vide quand la transition est sautée —, et une vue retirée ne relie plus rien ; si le rappel
        // lève, les vues n'ont pas été permutées : la vue toujours affichée garde son effet dans son salon, et la
        // transition rejetée est oubliée — un événement d'historique seul ne l'attendrait plus jamais
        var t = µ._mjs_vtLast;
        if (t && t.updateCallbackDone && typeof t.updateCallbackDone.then === 'function') t.updateCallbackDone.then(rebind, function() { if (µ._mjs_vtLast === t) µ._mjs_vtLast = null; });
        else rebind();
      });
    });
  }
  var k0 = usable(given) ? given : null;
  if (!k0 && !given && server) {
    var own = µ.socket(server, { _mjs_own: true });
    bind(own);
    return function() {
      if (done) return;
      done = true;
      if (route) route();
      defait();
      own.destroy();
    };
  }
  var lache = function() {
    if (timer) clearTimeout(timer);
    timer = 0;
    var i = wait ? µ._mjs_sockWait.indexOf(wait) : -1;
    if (i >= 0) µ._mjs_sockWait.splice(i, 1);
    wait  = null;
    awaited = null;
  };
  var stopWatch = function() {
    if (watch) clearInterval(watch);
    watch = 0;
  };
  // détruite par l'appli : l'effet s'en détache, et relit sa variable (une autre connexion peut y arriver)
  var perdue = function() {
    defait();
    startWatch();
  };
  var branche = function(k) {
    lache();
    stopWatch();
    (k._mjs_fxDrops || (k._mjs_fxDrops = [])).push(perdue);
    bind(k);
  };
  // une connexion dans la variable : branchée tout de suite, ou à son ouverture si elle a un `auth` (l'appli l'ouvre)
  var adopt = function(k) {
    if (prete(k)) branche(k);
    else {
      awaited = k;
      wait  = function() {
        if (done || !prete(k)) return;
        branche(k);
      };
      µ._mjs_sockWait.push(wait);
    }
  };
  // la variable relue, tant que rien n'est branché : une connexion y est arrivée, ou une autre que celle qu'on attend
  var reread = function() {
    if (done || sock) return;
    var v;
    try {
      v = more.read();
    }
    catch {
      return;
    }
    if (!usable(v) || v === awaited) return;
    lache();
    adopt(v);
  };
  var startWatch = function() {
    if (done || watch || sock || typeof more.read !== 'function') return;
    watch = setInterval(reread, µ._mjs_sockPoll);
  };
  if (k0) adopt(k0);
  else {
    timer = setTimeout(function() {
      timer = 0;
      µ.error(msg);
    }, µ._mjs_sockGrace);
  }
  startWatch();
  return function() {
    if (done) return;
    done = true;
    if (route) route();
    lache();
    stopWatch();
    var d = sock && sock._mjs_fxDrops;
    var i = d ? d.indexOf(perdue) : -1;
    if (i >= 0) d.splice(i, 1);
    defait();
  };
};

// un effet en direct sur cette connexion : ses messages (`prefix`) demandent un paquet côté serveur —
// s'il manque, le serveur répond « type inconnu », et l'effet le dit une fois en console au lieu de ne
// rien faire (cf. _mjs_fxMissing). `invoke` : ce qui s'écrit dans `app.use(…)` quand ce n'est pas `paquet()` —
// heatmapPackage refuse de démarrer sans ses origines
µ._mjs_fxPackage = function(sock, prefix, effet, paquet, invoke) {
  var p = sock._mjs_fxPackages || (sock._mjs_fxPackages = {});
  if (!p[prefix]) p[prefix] = { effet: effet, paquet: paquet, invoke: invoke || paquet + '()', dit: false };
};

// le salon d'un effet en direct : `room` écrit ; sinon la page — son chemin et sa route (`#/…` du
// routeur MJS, sans ancre ni requête) : deux routes ne se mêlent pas
µ._mjs_fxRoomName = function(s) {
  if (s.room) return s.room;
  var h = location.hash || '';
  return location.pathname + (/^#\//.test(h) ? h.replace(/^(#[^?#]*).*$/, '$1') : '');
};

// le salon d'un effet en direct sur une connexion partagée : plusieurs effets de la page peuvent tenir
// le même (deux zones *follow, une scène *react et celle de la page), l'appli aussi — room() compte ses
// poignées, le salon est quitté au départ de la dernière
µ._mjs_fxRoom = function(sock, name) {
  return sock.room(name);
};

function MjsSocket(url, opts) {
  var k;
  this.url = url;
  // les options propres de l'appelant, lues une fois, sans prototype : un `protocols` ou un `auth` hérité ne part pas au
  // serveur
  this.opts = Object.create(null);
  for (k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) { this.opts[k] = opts[k]; } }
  this._mjs_refs = 1;
  this._mjs_destroyed = false;
  // état réactif (un seul store interne, exposé via getters)
  // resumed : true si le dernier µ:welcome clôt une reprise de session réussie, false pour un accueil neuf — MàJ par _mjs_onWelcome à chaque welcome
  this._mjs_st = µ.state({ state: 'closed', latency: null, lastError: null, resumed: false });
  this._mjs_ws = null;
  this._mjs_helloSent = false;      // µ:hello parti sur le fil courant — avant lui, rien d'autre ne part (cf. _mjs_rawSend)
  this._mjs_wantOpen = false;       // true = on veut être connecté (≠ close volontaire)
  this._mjs_closedByApp = false;    // close() de l'appli : le runtime ne rouvre plus rien de lui-même (cf. _mjs_reopen), seul connect() reprend la main
  this._mjs_session = null;         // {id, key} du dernier µ:welcome (serveur MJS-WS avec reprise) — rejoué au prochain µ:hello, purgé sur µ:bye/µ:denied
  // registres par nom de salon, de flux ou de type, sans prototype : un nom comme `toString`, `constructor` ou `__proto__`
  // n'y trouve rien d'hérité (salon rejoint, flux reçu ; une trame du serveur ainsi nommée n'écrit pas sur Object.prototype)
  this._mjs_handlers = Object.create(null);   // type -> [fn]
  this._mjs_subs = Object.create(null);       // type -> true (liste resub envoyée au serveur)
  this._mjs_rooms = Object.create(null);      // name -> {n: poignées qui le tiennent} (re-join auto, cf. room())
  this._mjs_presence = Object.create(null);   // room(key) -> store réactif
  this._mjs_streams = Object.create(null);    // type -> { store, lastSeq }
  // flux quittés (unstream, refus du serveur) : type -> fil où son µ:unsub-stream est parti, null s'il n'a pas pu partir
  // (hors ligne) — ses trames ne vont plus à personne ; vidé à un accueil neuf, qui n'a plus aucun abonnement
  this._mjs_unsubs = Object.create(null);
  // salons quittés (leave() de leur dernière poignée) dont le départ n'est pas encore sûr : nom -> { ws: fil où son µ:leave est parti,
  // null s'il n'a pas pu partir, pings: µ:ping partis avant lui sur ce fil, req: numéro de la dernière requête d'avant lui, n: rang du
  // départ } — redit à la reprise de session, qui garde ses salons, jusqu'à la preuve que le serveur l'a traité (cf. _mjs_sendLeave)
  this._mjs_roomLeaves = Object.create(null);
  this._mjs_leaveSeq   = 0;      // rang du dernier départ retenu
  this._mjs_leaveTimer = null;   // µ:ping de preuve en attente (cf. _mjs_leavePing)
  this._mjs_pings  = 0;   // µ:ping (battements et preuves de départ) partis sur le fil courant
  this._mjs_pongs  = 0;   // leurs réponses (µ:pong) reçues sur ce fil
  this._mjs_sentAt = 0;   // instant de la dernière trame partie (cf. _mjs_leavePing)
  this._mjs_reqs = Object.create(null);   // id -> { resolve, reject, timer } ; sans prototype : un µ:ack d'id `toString` n'y trouve rien
  this._mjs_reqSeq = 0;
  this._mjs_queue = [];             // [{type, payload}] hors-ligne
  this._mjs_queueOverflowWarned = false;   // débordement de _mjs_queue déjà signalé — remis à false au prochain welcome (file vidée)
  this._mjs_pendingOpenReqs = [];   // [{id, type, payload}] request({waitForOpen:true}) en attente d'ouverture
  this._mjs_attempt = 0;
  this._mjs_abandoned     = false;  // true après close() volontaire ou reconnexion épuisée/désactivée — cf. close()/_mjs_scheduleReconnect/_mjs_ensure
  this._mjs_abandonWarned = false;  // un seul avertissement par épisode d'abandon (send() pendant l'abandon)
  this._mjs_stableTimer = null;     // minuteur MJSOCKET_STABLE_MS posé par _mjs_onWelcome, annulé par _mjs_teardown
  this._mjs_reconnectTimer = null;
  this._mjs_hbTimer = null;
  // était un slot UNIQUE (`_hbWatchdog`) :
  // vu ci-dessous (_mjs_startHeartbeat), plusieurs watchdogs sont légitimement EN
  // VOL simultanément dès que l'intervalle < 2×intervalle (la config par
  // défaut !) — un slot unique perdait la référence de l'ancien à chaque
  // nouveau ping, le laissant tourner en fantôme. Tableau de TOUS les
  // watchdogs en attente ; un pong reçu les invalide TOUS (la preuve de vie
  // la plus récente rend caduques toutes les échéances antérieures).
  this._mjs_hbWatchdogs = [];
  this._mjs_coalesce = Object.create(null);     // type -> { payload, scheduled }
  this._mjs_cooldownAt = Object.create(null);   // type -> timestamp dernier envoi
  this._mjs_debounce = Object.create(null);     // type -> { payload, timer }
  this._mjs_warnedOpts = {};        // option -> true, un seul µ.warn par option invalide
}

MjsSocket.prototype._mjs_now = function() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
};

// un jeton de la part des effets : false quand elle est épuisée (elle se refait à MJSOCKET_FX_RATE par seconde)
// le serveur ne connaît pas un type de message : celui d'un effet en direct, dont le paquet manque
// côté serveur — dit une fois par connexion et par paquet
MjsSocket.prototype._mjs_fxMissing = function(type) {
  var p = this._mjs_fxPackages;
  if (!p) return;
  for (var prefix in p) {
    if (type.indexOf(prefix) !== 0 || p[prefix].dit) continue;
    p[prefix].dit = true;
    µ.error(µ._mjs_msg('socketPackage', { effet: p[prefix].effet, type: type, paquet: p[prefix].paquet, invoke: p[prefix].invoke }, '{effet} : le serveur MJS WS ne connaît pas « {type} » — il lui manque le paquet {paquet} : ajoutez app.use({invoke}) côté serveur ; en attendant, rien ne part'));
  }
};

MjsSocket.prototype._mjs_fxToken = function() {
  var now  = this._mjs_now();
  var rate = µ._mjs_fxRate();
  var b    = this._mjs_fxBucket || (this._mjs_fxBucket = { n: rate, at: now });
  b.n  = Math.min(rate, b.n + (now - b.at) * rate / 1000);
  b.at = now;
  if (b.n < 1) return false;
  b.n--;
  return true;
};

// --- propriétés réactives ---
Object.defineProperty(MjsSocket.prototype, 'state',     { get: function() { return this._mjs_st.state; } });
Object.defineProperty(MjsSocket.prototype, 'latency',   { get: function() { return this._mjs_st.latency; } });
Object.defineProperty(MjsSocket.prototype, 'connected', { get: function() { return this._mjs_st.state === 'open'; } });
Object.defineProperty(MjsSocket.prototype, 'lastError', { get: function() { return this._mjs_st.lastError; } });
Object.defineProperty(MjsSocket.prototype, 'resumed',   { get: function() { return this._mjs_st.resumed; } });

MjsSocket.prototype._mjs_setState = function(s) { this._mjs_st.state = s; };

// --- ouverture / handshake ---
MjsSocket.prototype.connect = function() {
  if (this._mjs_destroyed || this._mjs_ws || this.state === 'open') { return this; }
  // reconnexion explicite : sort d'un abandon éventuel (cf. _mjs_scheduleReconnect/_mjs_ensure),
  // compteur d'essais remis à zéro — un appel PUBLIC repart toujours à froid.
  this._mjs_abandoned     = false;
  this._mjs_abandonWarned = false;
  this._mjs_attempt       = 0;
  this._mjs_wantOpen      = true;
  this._mjs_closedByApp   = false;
  this._mjs_open();
  return this;
};

MjsSocket.prototype._mjs_ensure = function() {
  // connexion paresseuse : au 1er on/send/request/stream.
  // pendant `reconnecting`, un
  // `_mjs_reconnectTimer` respecte DÉJÀ le backoff : ne pas le court-circuiter.
  // `connect()` (appel PUBLIC explicite) passe par `_mjs_open()` qui ANNULE ce timer
  // et rouvre IMMÉDIATEMENT — un émetteur continu (position coalescée ~20/s)
  // transformerait alors le backoff [500,1000,2000,5000] en ~20 tentatives/s
  // vers un serveur déjà en difficulté. On respecte la reconnexion programmée ;
  // les messages émis entre-temps alimentent `_mjs_queue` et repartent au welcome.
  // connexion ABANDONNÉE (close() volontaire, essais épuisés ou reconnect.enabled:false, cf.
  // close()/_mjs_scheduleReconnect) : plus aucune réouverture implicite tant qu'un connect() explicite
  // n'a pas repris la main — sinon CHAQUE send()/on()/request()/stream() ultérieur rouvrait une
  // connexion brute, hors de tout backoff/plafond (un client qu'on a voulu arrêter pouvait marteler
  // le serveur).
  if (this._mjs_abandoned) { return; }
  if (!this._mjs_ws && this.state !== 'open' && !this._mjs_destroyed && !this._mjs_reconnectTimer) { this.connect(); }
};

MjsSocket.prototype._mjs_open = function() {
  var self = this;
  // Un timer de reconnexion est peut-être en attente (on rouvre via connect() ou
  // le watchdog) : l'annuler, sinon il rappellerait _mjs_open → 2e connexion empilée.
  if (this._mjs_reconnectTimer) { clearTimeout(this._mjs_reconnectTimer); this._mjs_reconnectTimer = null; }
  // Garde anti-double-socket : une connexion vit déjà → on ne la double pas.
  if (this._mjs_ws) { return; }
  if (this.state !== 'reconnecting') { this._mjs_setState('connecting'); }
  var ws;
  try { ws = new WebSocket(this.url, this.opts.protocols); }
  catch (e) {
    // le CONSTRUCTEUR qui jette =
    // URL syntaxiquement invalide : erreur DÉTERMINISTE, jamais un aléa réseau.
    // L'ancien `_mjs_onClose({code:1006})` enclenchait le cycle de reconnexion
    // standard → boucle INFINIE (plafond 5 s) sur une opération qui ne peut
    // JAMAIS réussir. On abandonne (bug de dev, signalé) au lieu de réessayer — verrou d'abandon
    // compris, sinon le prochain send()/on() retenterait la même adresse via _mjs_ensure().
    this._mjs_wantOpen = false;
    this._mjs_abandoned = true;
    this._mjs_st.lastError = { code: 'badurl', message: String((e && e.message) || e) };
    µ.error('[µ.socket] ' + µ._mjs_txt('sockBadUrl', { url: this.url }, 'URL invalide, connexion abandonnée : {url}'), e);
    this._mjs_setState('closed');
    return;
  }
  this._mjs_ws = ws;
  // µschema (mjs_schema.ts) — extension MINIME : ArrayBuffer plutôt que Blob
  // pour les trames binaires entrantes (accès synchrone aux octets, cf. µ._mjs_mjschemaOnBinary plus bas
  // dans _mjs_onMessage) — sans incidence sur le texte JSON existant (readyState/onmessage inchangés pour
  // toute trame string).
  ws.binaryType = 'arraybuffer';
  ws.onopen    = function()   { self._mjs_onOpen(); };
  ws.onmessage = function(ev) { self._mjs_onMessage(ev); };
  ws.onclose   = function(ev) { self._mjs_onClose(ev || {}); };
  ws.onerror   = function(ev) { self._mjs_st.lastError = { code: 'ws', message: 'erreur socket' }; };
};

MjsSocket.prototype._mjs_onOpen = function() {
  var self = this;
  var ws   = this._mjs_ws;
  var hello = function(auth) {
    // un jeton arrivé après la chute de ce fil ne part pas sur le suivant, qui envoie son propre µ:hello
    if (self._mjs_ws !== ws) { return; }
    var p = {
      auth: auth, protocol: 1,
      resub: Object.keys(self._mjs_subs),
      rooms: Object.keys(self._mjs_rooms)
    };
    // reprise de session (serveur MJS-WS opt-in) : {id, key} du dernier µ:welcome —
    // la clé prouve « même session », l'auth ci-dessus reste re-vérifiée par le serveur.
    // Jamais posé face à un serveur sans reprise (_mjs_session reste null) : clé ABSENTE du JSON.
    if (self._mjs_session) { p.session = self._mjs_session; }
    // µschema (mjs_schema.ts) — extension MINIME : hash du registre CLIENT
    // COURANT (même vide — cf. µ._mjs_mjschemaHelloHash, un hash ABSENT ferait taire le serveur pour de
    // bon, cf. mjs-ws/core.ts::pushSchemaIfMismatch) — permet au serveur de détecter un désaccord et
    // pousser µ:schema en retour.
    if (µ._mjs_mjschemaHelloHash) { p.schemaHash = µ._mjs_mjschemaHelloHash(); }
    if (self._mjs_rawSend({ t: 'µ:hello', p: p })) { self._mjs_helloSent = true; }
  };
  var a = this.opts.auth;
  if (typeof a === 'function') {
    var r;
    try { r = a(); } catch { r = undefined; }
    if (r && typeof r.then === 'function') { r.then(hello, function() { hello(undefined); }); }
    else { hello(r); }
  } else { hello(a); }
  // on reste 'connecting' jusqu'au µ:welcome
};

MjsSocket.prototype._mjs_onWelcome = function(msg) {
  // reprise de session (MJS-WS, opt-in serveur) : le µ:welcome porte session {id, key}
  // — clé TOURNÉE à chaque welcome, on garde toujours la plus récente. Serveur sans reprise :
  // champ absent, _mjs_session reste null, le hello n'en parlera jamais. Rien d'autre ne change.
  if (msg.p && msg.p.session) { this._mjs_session = msg.p.session; }
  // sock.resumed (public, cf. constructeur) : reflète CE welcome — jamais true face à un
  // serveur sans reprise (`msg.p.resumed` absent → strictement !== true → false).
  this._mjs_st.resumed = (msg.p && msg.p.resumed) === true;
  // tempête de reconnexion — un serveur qui accueille PUIS coupe aussitôt ne doit jamais
  // faire retomber le backoff au palier minimal à CHAQUE cycle : `_mjs_attempt` n'est remis à zéro
  // qu'après MJSOCKET_STABLE_MS de connexion TENUE depuis CE welcome, jamais au welcome brut —
  // le minuteur est annulé par _mjs_teardown() si la connexion tombe avant (cf. son commentaire).
  if (this._mjs_stableTimer) { clearTimeout(this._mjs_stableTimer); }
  var __self = this;
  this._mjs_stableTimer = setTimeout(function() { __self._mjs_attempt = 0; __self._mjs_stableTimer = null; }, MJSOCKET_STABLE_MS);
  this._mjs_setState('open');
  this._mjs_st.lastError = null;
  this._mjs_startHeartbeat();
  // les effets en direct qui attendaient que l'appli ouvre sa connexion
  µ._mjs_sockWake();
  // abonnements stream/presence/room
  // perdus en connexion PARESSEUSE : `stream()`/`presence()`/`room()`
  // envoient leur message dédié (`µ:sub-stream`/`µ:sub-presence`/`µ:join`)
  // IMMÉDIATEMENT via `_mjs_rawSend()`, qui échoue SILENCIEUSEMENT si le WebSocket
  // n'est pas encore 'open' (`readyState !== 1`) — le cas le PLUS courant :
  // le 1er appel à l'un de ces 3 crée le socket via `_mjs_ensure()`/`connect()`,
  // qui reste 'connecting' pendant tout le round-trip réseau + handshake
  // µ:hello/µ:welcome. Contrairement à `send()` (dont les envois ratés sont
  // mis en `_mjs_queue` et rejoués ici, juste en dessous), ces 3 messages
  // dédiés n'avaient AUCUN filet — silencieusement perdus, jamais rejoués.
  // Le `µ:hello` (envoyé dans `_mjs_onOpen`, avant ce welcome) transmet bien
  // `resub`/`rooms` en NOMS, mais ce sont des champs d'INTENTION générique
  // — les messages dédiés ci-dessous restent la voie EXPLICITE que le
  // serveur attend réellement (la MÊME que le tout premier abonnement),
  // donc la plus fiable pour re-livrer l'état après CHAQUE (re)connexion,
  // pas seulement la première.
  // un stream déjà entamé
  // (`lastSeq > 0`) qui se RE-abonne après une reconnexion envoyait le MÊME
  // `µ:sub-stream` qu'un tout premier abonnement — aucune indication au
  // serveur de « je suis déjà à la séquence N ». Les deltas survenus PENDANT
  // la déconnexion sont donc soit reperdus (si le serveur reprend le flux
  // "à partir de maintenant"), soit re-livrés en double (si le serveur
  // renvoie tout depuis le début) — comportement dépendant du serveur, dans
  // les deux cas incohérent avec le contrat déjà établi par `_mjs_onStreamDelta`
  // (détection de trou EN COURS DE FLUX, qui envoie déjà `µ:resync` avec
  // `from: lastSeq`, cf. plus bas). Fix : même message, même contrat, à la
  // reconnexion — un stream qui a déjà vu au moins un delta redemande
  // EXPLICITEMENT la suite depuis sa dernière séquence connue ; seul un
  // stream JAMAIS entamé (lastSeq encore à 0) garde le `µ:sub-stream` nu
  // (rien à resynchroniser). `resyncing = true` posé ici aussi : évite un
  // 2e `µ:resync` redondant si le tout premier delta post-reconnexion
  // ressemble par ailleurs à un trou (même garde anti-rafale que le chemin
  // existant).
  // flux quittés : une session reprise garde ses abonnements, le désabonnement qui n'a pas pu partir (unstream() hors ligne)
  // part ici, avant tout le reste ; un accueil neuf n'en a plus aucun, rien à défaire
  if (!this._mjs_st.resumed) { this._mjs_unsubs = Object.create(null); }
  for (var __uq in this._mjs_unsubs) {
    if (this._mjs_unsubs[__uq] === null) { this._mjs_sendUnsub(__uq); }
  }
  // salons quittés dont le départ n'est pas encore sûr : une session reprise les garde — leur départ repart ici, une fois, avant les
  // re-joins, suivi d'un µ:ping dont la réponse le prouve (cf. _mjs_sendLeave) sans attendre un battement : une reprise de plus, avant
  // lui, le redirait encore ; un accueil neuf n'en a plus aucun
  if (!this._mjs_st.resumed) { this._mjs_roomLeaves = Object.create(null); }
  var __lvs = Object.keys(this._mjs_roomLeaves);
  for (var __lv = 0; __lv < __lvs.length; __lv++) { this._mjs_sendLeave(__lvs[__lv]); }
  if (__lvs.length) { this._mjs_beat(true); }
  // les salons D'ABORD : un flux réservé à un salon (`room`) ou gardé par l'appartenance, demandé avant le µ:join, serait
  // refusé sur-le-champ (lu hors du salon) — à la première connexion (paresseuse) comme à chaque reconnexion. Chaque re-join
  // peut LUI AUSSI être refusé par la garde (permissions changées entre-temps) : le refus nomme son salon, cf. _mjs_onJoinDenied
  for (var __rm in this._mjs_rooms) { this._mjs_sendJoin(__rm); }
  for (var __st in this._mjs_streams) {
    var __stObj = this._mjs_streams[__st];
    if (__stObj.lastSeq) {
      __stObj.resyncing = true;
      this._mjs_rawSend({ t: 'µ:resync', p: { stream: __st, from: __stObj.lastSeq } });
    } else {
      this._mjs_rawSend({ t: 'µ:sub-stream', p: { stream: __st } });
    }
  }
  for (var __pk in this._mjs_presence) { this._mjs_rawSend({ t: 'µ:sub-presence', p: { room: __pk || undefined } }); }
  // vider la file hors-ligne — `_mjs_queueOverflowWarned` repart à false : un débordement
  // futur (nouvelle connexion) redevient un épisode NEUF, à signaler à nouveau une seule fois.
  var q = this._mjs_queue; this._mjs_queue = []; this._mjs_queueOverflowWarned = false;
  for (var i = 0; i < q.length; i++) { this._mjs_rawSend({ t: q[i].type, p: q[i].payload }); }
  // envoie enfin pour de VRAI les
  // request({waitForOpen:true}) émises avant que la connexion ne soit prête
  // (cf. request()) : avant ce fix, rien ne les relayait ici, contrairement
  // à la file `_mjs_queue` de send() juste au-dessus — elles finissaient
  // TOUJOURS par expirer sur leur propre timeout, jamais transmises.
  var pend = this._mjs_pendingOpenReqs; this._mjs_pendingOpenReqs = [];
  for (var __pi = 0; __pi < pend.length; __pi++) {
    var __pr = pend[__pi];
    if (this._mjs_reqs[__pr.id]) { this._mjs_rawSend({ t: __pr.type, p: __pr.payload, id: __pr.id }); }
  }
  // 'welcome' = nom d'événement RÉSERVÉ côté client : `on('welcome', cb)` réutilise le MÊME
  // registre/`_mjs_dispatch` que n'importe quel autre type pub/sub (pas de canal parallèle) — un
  // message applicatif serveur littéralement nommé `welcome` déclencherait donc les MÊMES
  // handlers. Charge = copie SUPERFICIELLE de `msg.p` SANS `session` (plomberie interne de la
  // reprise, id+clé n'ont rien à faire dans les mains de l'appli) ; `resumed` (posé ci-dessus
  // sur `this._mjs_st.resumed`) passe tel quel, comme tout autre champ ajouté par `welcome()` serveur.
  // Dispatché EN DERNIER : l'appli ne doit voir qu'un socket déjà opérationnel (session posée,
  // état 'open', heartbeat démarré, re-abonnements + rejeu de file + rejeu waitForOpen faits
  // ci-dessus). `_mjs_dispatch` protège déjà chaque handler individuellement (try/catch) : un
  // handler qui throw ne casse jamais la suite.
  var __wp = {};
  if (msg.p) { for (var __wk in msg.p) { if (__wk !== 'session') { _mjs_putOwn(__wp, __wk, msg.p[__wk]); } } }
  this._mjs_dispatch('welcome', { t: 'welcome', p: __wp });
};

MjsSocket.prototype._mjs_onDenied = function(msg) {
  this._mjs_st.lastError = (msg.p) || { message: 'denied' };
  this._mjs_wantOpen = false;          // auth invalide → inutile de réessayer
  // même garde que close() volontaire (cf. son commentaire) : _mjs_ensure() ne teste que ce
  // drapeau, un send()/on()/request()/stream() après ce refus rouvrirait sinon une connexion brute
  // alors que `_mjs_wantOpen = false` ci-dessus dit déjà « fin définitive ». Seul un connect()
  // explicite (qui le remet à false) reprend la main.
  this._mjs_abandoned = true;
  this._mjs_session = null;            // fin définitive — une session ne survit jamais à un refus
  // Annule un reconnect éventuellement programmé : on abandonne définitivement.
  if (this._mjs_reconnectTimer) { clearTimeout(this._mjs_reconnectTimer); this._mjs_reconnectTimer = null; }
  // une requête qui attendait l'ouverture n'est jamais partie : rejetée avec la raison du refus (`denied`), pas « connexion
  // fermée », et jamais envoyée sous une autre identité (la création et la connexion d'un compte repartent d'elles-mêmes sur
  // la connexion invitée qui suit, cf. mjs_accounts.ts)
  var refus = this._mjs_st.lastError, pend = this._mjs_pendingOpenReqs;
  var pourquoi = (refus && typeof refus.message === 'string') ? refus.message : 'denied';
  this._mjs_pendingOpenReqs = [];
  for (var __pi = 0; __pi < pend.length; __pi++) {
    var __r = this._mjs_reqs[pend[__pi].id];
    if (!__r) { continue; }
    delete this._mjs_reqs[pend[__pi].id];
    if (__r.timer) { clearTimeout(__r.timer); }
    try { __r.reject({ code: 'denied', message: pourquoi }); } catch {}
  }
  this._mjs_teardown(true);           // fin définitive
  // la file hors ligne appartient à l'identité refusée : un connect() suivant, peut-être sous une autre identité, n'en
  // envoie rien (même règle à l'adieu du serveur et à la session exclusive perdue, cf. µ:bye et _mjs_onClose), pas plus que
  // de ses envois différés encore en attente — et le dit
  var perdus = this._mjs_queue.length + this._mjs_cancelPending();
  if (perdus) { µ.warn('[µ.socket] ' + µ._mjs_txt('sockQueueDenied', { n: perdus }, 'file hors ligne vidée ({n} en attente) : le serveur a refusé l\'identité pour laquelle ces messages ont été écrits, ils ne partent sous aucune autre — renvoyez-les une fois reconnecté si besoin')); }
  this._mjs_queue = [];
  this._mjs_queueOverflowWarned = false;
  this._mjs_setState('closed');
  // 'denied' = 2e nom d'événement RÉSERVÉ côté client, exactement comme 'welcome' juste au-dessus
  // (même registre, même `_mjs_dispatch`, même réserve : un message applicatif serveur littéralement
  // nommé `denied` déclencherait les mêmes handlers).
  //
  // famille « garde muette » — sans lui, le refus était SANS VOIX : les trois
  // lignes du dessus ferment le fil DÉFINITIVEMENT (plus de `_mjs_wantOpen`, minuteur de reconnexion
  // annulé) et rien ne le disait à l'appli, alors que l'en-tête de `refresh()` lui confie justement
  // le soin de décider quand renouveler son jeton. Il ne lui restait que `state`, dont la lecture
  // ne s'abonne PAS depuis tous les chemins d'effet (`_mjs_runEffectsV2` est appelé sans
  // `µ.activeComponent` sur le chemin rapide de `_mjs_invalidate`, mjs_element.ts) : un rattrapage
  // bâti dessus pouvait ne jamais se déclencher, sans un mot. Un signal qui part toujours vaut
  // mieux qu'un état qu'on observe parfois.
  //
  // Dispatché EN DERNIER, pour la même raison que 'welcome' : le socket est déjà au repos quand le
  // handler tourne, donc un `sock.connect()` appelé depuis là rouvre pour de bon. `_mjs_dispatch`
  // protège chaque handler (try/catch) — un handler qui jette ne casse rien.
  this._mjs_dispatch('denied', { t: 'denied', p: this._mjs_st.lastError });
};

MjsSocket.prototype._mjs_onMessage = function(ev) {
  var msg;
  // µschema (mjs_schema.ts) — extension MINIME : une trame BINAIRE (jamais du
  // JSON valide, cf. binaryType posé dans _mjs_open) ne passe JAMAIS par JSON.parse — décodée par le hook
  // µ._mjs_mjschemaOnBinary si le module 'schema' est chargé, sinon ignorée. Un serveur MJS-WS qui déclare un
  // schéma (`app.schema`) encode en binaire sans regarder ce que la page sait lire : sans le module, le message
  // n'arrive jamais — un avertissement le dit, une fois, avec le module à ajouter
  if (ev.data && typeof ev.data !== 'string') {
    if (µ._mjs_mjschemaOnBinary) { µ._mjs_mjschemaOnBinary(this, ev.data); }
    else if (!_mjsSockBinSaid++) { µ.warn('[µ.socket] ' + µ._mjs_txt('sockBinaryNoSchema', null, 'trame binaire reçue et ignorée : sans le module \'schema\', le cœur ne sait pas la lire (un serveur MJS-WS encode en binaire les messages dont il déclare le schéma, app.schema) — ajoutez "schema" à la liste "runtime" de mjs.config.json, ou écrivez "runtime": "all"')); }
    return;
  }
  try { msg = (this.opts.parse || JSON.parse)(ev.data); } catch { return; }
  // JSON.parse('null')/('42')/('"x"') renvoie une valeur non-objet → `msg.t`
  // lèverait (null.t) ou serait undefined : on jette proprement le message.
  if (!msg || typeof msg !== 'object') { return; }
  switch (msg.t) {
    case 'µ:welcome': return this._mjs_onWelcome(msg);
    case 'µ:denied':  return this._mjs_onDenied(msg);
    case 'µ:pong':
      // `msg.p.ts` absent/non-numérique
      // (trame malformée ou serveur qui echo autre chose que le `ts` reçu)
      // produisait un `NaN`/négatif propagé TEL QUEL dans `latency`, un champ
      // RÉACTIF exposé au développeur (`sock.latency`) — un "ping: NaNms"
      // affiché à l'écran. Le `_mjs_petWatchdog()` reste, lui, INCONDITIONNEL :
      // recevoir NE SERAIT-CE QU'un pong malformé prouve déjà que la
      // connexion est vivante (le but même du watchdog), indépendamment de
      // la qualité de son contenu.
      // typer `ts` À LA SOURCE :
      // `msg.p = null` faisait `now - null === now` (positif → assigné à vie),
      // et `ts: true` → `now - 1` — `sock.latency` (champ réactif exposé)
      // affichait alors le temps écoulé depuis le chargement de la page. On
      // n'accepte QU'un `ts` numérique. `_mjs_petWatchdog()` reste INCONDITIONNEL :
      // un pong même malformé prouve que la connexion est vivante.
      var __ts = msg.p && msg.p.ts;
      if (typeof __ts === 'number') {
        var __lat = this._mjs_now() - __ts;
        if (isFinite(__lat) && __lat >= 0) { this._mjs_st.latency = __lat; }
      }
      this._mjs_petWatchdog();
      // la réponse à un µ:ping (battement ou preuve) parti après un µ:leave sur ce fil : le serveur, qui traite les trames d'une
      // connexion dans l'ordre, a traité ce départ (cf. _mjs_sendLeave)
      this._mjs_pongs++;
      for (var __lp in this._mjs_roomLeaves) {
        var __lr = this._mjs_roomLeaves[__lp];
        if (__lr.ws === this._mjs_ws && __lr.pings < this._mjs_pongs) { delete this._mjs_roomLeaves[__lp]; }
      }
      return;
    case 'µ:ack':     return this._mjs_onAck(msg);
    case 'µ:error':
      this._mjs_st.lastError = msg.p || { message: 'error' };
      if (msg.p && typeof msg.p.type === 'string') this._mjs_fxMissing(msg.p.type);
      // seul le refus d'entrée nomme son salon : toute autre erreur (message de chat trop long, débit…) n'en fait
      // oublier aucun
      else if (msg.p && msg.p.code === 'join-denied' && typeof msg.p.room === 'string') this._mjs_onJoinDenied(msg.p.room);
      // le refus d'un flux le nomme : ce flux seul est oublié
      else if (msg.p && msg.p.code === 'stream-denied' && typeof msg.p.stream === 'string') this._mjs_onStreamDenied(msg.p.stream);
      return;
    case 'µ:presence':return this._mjs_onPresence(msg);
    case 'µ:left':    return this._mjs_onLeft(msg);
    // µschema (mjs_schema.ts) — extension MINIME : remplace le registre
    // CLIENT, cf. µ._mjs_mjschemaOnPush (absent si le module 'schema' n'est pas chargé → no-op, trame
    // ignorée comme n'importe quel autre type µ: inconnu l'aurait été avant l'ajout de µschema).
    case 'µ:schema':  if (µ._mjs_mjschemaOnPush) { µ._mjs_mjschemaOnPush(this, msg); } return;
    case 'µ:bye':     this._mjs_st.lastError = msg.p || null; this._mjs_wantOpen = false; this._mjs_abandoned = true; this._mjs_session = null; if (this._mjs_reconnectTimer) { clearTimeout(this._mjs_reconnectTimer); this._mjs_reconnectTimer = null; } this._mjs_teardown(true); this._mjs_pendingOpenReqs = []; this._mjs_cancelPending(); this._mjs_queue = []; this._mjs_queueOverflowWarned = false; this._mjs_setState('closed'); return;
  }
  // delta de stream ? (ne tombe PAS aussi dans les handlers pub/sub)
  if (this._mjs_streams[msg.t]) { return this._mjs_onStreamDelta(msg.t, msg); }
  // pub/sub
  this._mjs_dispatch(msg.t, msg);
};

MjsSocket.prototype._mjs_onClose = function(ev) {
  this._mjs_teardown();
  if (ev && ev._err) { this._mjs_st.lastError = { code: 'ws', message: String(ev._err && ev._err.message || ev._err) }; }
  // session exclusive par identité (serveur MJS-WS opt-in, mjs-ws/core.ts, DEUX modes) — codes
  // 4003 ('replace' : CE client a été REMPLACÉ par une connexion neuve de la MÊME identité) et
  // 4004 ('refuse' : CE hello a été REFUSÉ, une session vivante de la MÊME identité existait déjà)
  // sont TOUS DEUX TERMINAUX même si la trame applicative (`µ:bye`/`µ:denied`) s'est perdue en
  // route (leurs handlers respectifs l'auraient déjà fait, cf. _mjs_onDenied plus haut / le cas
  // 'µ:bye' de _mjs_onMessage) — SANS ce filet, `_mjs_wantOpen` resterait vrai et la ligne du dessous
  // reconnecterait aussitôt : le serveur re-refuserait/re-remplacerait de la même façon →
  // ping-pong infini entre les deux onglets. `lastError` : préserve la charge de la trame
  // applicative si déjà reçue, sinon repli DISTINCT par code (replaced/refused).
  if (ev && (ev.code === 4003 || ev.code === 4004)) {
    // abandon, pas seulement fin de reconnexion : un send()/on() rouvrirait sinon via _mjs_ensure()
    // et remplacerait à son tour l'autre onglet — même ping-pong, au rythme de l'application
    this._mjs_wantOpen = false;
    this._mjs_abandoned = true;
    this._mjs_session = null;
    this._mjs_cancelPending();
    this._mjs_queue = [];
    this._mjs_queueOverflowWarned = false;
    if (!this._mjs_st.lastError) { this._mjs_st.lastError = { code: ev.code === 4003 ? 'replaced' : 'refused' }; }
  }
  if (this._mjs_wantOpen && !this._mjs_destroyed) { this._mjs_scheduleReconnect(); }
  else { this._mjs_setState('closed'); }
};

MjsSocket.prototype._mjs_teardown = function(final, unknown) {
  // une connexion qui tombe AVANT d'être jugée stable ne doit jamais réinitialiser le
  // backoff en douce — annule le minuteur de stabilité posé par _mjs_onWelcome, sur TOUTE fin de vie
  // de la connexion (reconnexion, fermeture volontaire, denied, µ:bye — seul choke point commun).
  if (this._mjs_stableTimer) { clearTimeout(this._mjs_stableTimer); this._mjs_stableTimer = null; }
  if (this._mjs_ws) {
    this._mjs_ws.onopen = this._mjs_ws.onmessage = this._mjs_ws.onclose = this._mjs_ws.onerror = null;
    try { this._mjs_ws.close(); } catch {}
    this._mjs_ws = null;
  }
  this._mjs_stopHeartbeat();
  // le prochain fil repart sans µ:hello : rien ne part avant le sien ; ses µ:ping se comptent à partir de zéro, la preuve d'un départ
  // attendue sur ce fil ne part plus (cf. _mjs_sendLeave)
  this._mjs_helloSent = false;
  this._mjs_pings     = 0;
  this._mjs_pongs     = 0;
  if (this._mjs_leaveTimer) { clearTimeout(this._mjs_leaveTimer); this._mjs_leaveTimer = null; }
  // teardown incomplet : les request()
  // en attente d'un `µ:ack` sur ce socket ne seront JAMAIS ack'ées (le serveur
  // ne reverra jamais leur id, et une reconnexion = nouvelle poignée de main
  // sans mémoire des ids précédents) → on les rejette ici, plus vite et plus
  // exactement que leur timeout individuel.
  // EXCEPTION : une requête
  // `waitForOpen` encore dans `_mjs_pendingOpenReqs` n'a JAMAIS été transmise sur
  // ce socket (inscrite dans `_mjs_reqs` dès `request()`, mais en attente
  // d'ouverture). Un simple échec de TENTATIVE (`_mjs_onClose`, `final` absent) ne
  // doit PAS la rejeter : son timeout individuel reste l'arbitre et `_mjs_onWelcome`
  // la renverra après reconnexion (le fix `waitForOpen` redevenait sinon
  // inopérant dès qu'UNE tentative échouait). Seule une fin de vie DÉFINITIVE
  // (`final` : close/destroy/denied/bye) rejette TOUT.
  // `unknown` : reconnexion voulue par le runtime (cf. _mjs_reopen) — une requête déjà partie a pu être servie, son
  // résultat est inconnu ; jamais « connexion fermée », que l'appli prendrait pour une requête à rejouer
  var spared = {};
  if (!final && this._mjs_pendingOpenReqs) {
    for (var __pi = 0; __pi < this._mjs_pendingOpenReqs.length; __pi++) { spared[this._mjs_pendingOpenReqs[__pi].id] = true; }
  }
  var reqs = this._mjs_reqs;
  this._mjs_reqs = Object.create(null);
  for (var __id in reqs) {
    if (spared[__id]) { this._mjs_reqs[__id] = reqs[__id]; continue; } // épargnée : ré-inscrite pour _mjs_onWelcome
    var __r = reqs[__id];
    if (__r.timer) { clearTimeout(__r.timer); }
    try { __r.reject(unknown ? { code: 'unknown', message: 'connexion renouvelée après l\'envoi : le serveur a pu servir la requête, sa réponse est perdue' } : { code: 'closed', message: 'connexion fermée avant réponse du serveur' }); } catch {}
  }
};

MjsSocket.prototype._mjs_scheduleReconnect = function() {
  var rc = this.opts.reconnect || {};
  // reconnexion désactivée ou essais épuisés = ABANDON (cf. _mjs_ensure/send()) : `_mjs_wantOpen`
  // redescend, on ne veut plus être connecté tant que personne ne le redemande explicitement.
  if (rc.enabled === false) { this._mjs_wantOpen = false; this._mjs_abandoned = true; this._mjs_setState('closed'); return; }
  var max = (rc.retries != null) ? rc.retries : Infinity;
  if (this._mjs_attempt >= max) { this._mjs_wantOpen = false; this._mjs_abandoned = true; this._mjs_setState('closed'); return; }
  var backoff = rc.backoff || [500, 1000, 2000, 5000];
  var base = backoff[Math.min(this._mjs_attempt, backoff.length - 1)];
  var jitter = (rc.jitter != null) ? rc.jitter : 0.3;
  var delay = base * (1 + (Math.random() * 2 - 1) * jitter);
  if (delay < 0) { delay = 0; }
  this._mjs_attempt++;
  this._mjs_setState('reconnecting');
  var self = this;
  this._mjs_reconnectTimer = setTimeout(function() { self._mjs_open(); }, delay);
};

// --- envoi bas niveau ---
MjsSocket.prototype._mjs_rawSend = function(obj) {
  // avant le µ:hello, rien d'autre ne part : le serveur refuserait la connexion pour de bon (« µ:hello attendu en
  // premier message ») — un salon, un flux ou une présence demandés pendant l'attente d'un `auth` asynchrone
  // partent au welcome, qui les rejoue tous
  if (!this._mjs_helloSent && obj.t !== 'µ:hello') { return false; }
  if (this._mjs_ws && this._mjs_ws.readyState === 1) {
    try {
      // µschema (mjs_schema.ts) — extension MINIME : un frame ADMISSIBLE
      // (type schématisé, pas de coupe-circuit binary:false, jamais un id/seq, jamais une trame µ:
      // de contrôle, cf. µ._mjs_mjschemaEncode) part en BINAIRE ; sinon comportement HISTORIQUE inchangé
      // (JSON) — même choke point unique que sendRaw côté serveur (mjs-ws/core.ts).
      var __bin = µ._mjs_mjschemaEncode ? µ._mjs_mjschemaEncode(this, obj) : null;
      this._mjs_ws.send(__bin || (this.opts.serialize || JSON.stringify)(obj));
      this._mjs_sentAt = this._mjs_now();
      return true;
    }
    catch { return false; }
  }
  return false;
};

// --- pub/sub ---
// `opts.owner` : dé-abonnement automatique à la destruction du owner —
// MÊME mécanisme que `µ.smooth` (mjs_smooth.ts), un appelant de plus de `_mjs_onDestroy`
// (mjs_element.ts), pas de nouveau canal. Sans owner, comportement inchangé.
MjsSocket.prototype.on = function(type, handler, opts) {
  this._mjs_ensure();
  (this._mjs_handlers[type] || (this._mjs_handlers[type] = [])).push(handler);
  this._mjs_subs[type] = true;
  var self = this;
  var unsub = function() { self.off(type, handler); };
  if (opts && opts.owner && typeof opts.owner._mjs_onDestroy === 'function') { opts.owner._mjs_onDestroy(unsub); }
  return unsub;
};

MjsSocket.prototype.off = function(type, handler) {
  var hs = this._mjs_handlers[type];
  if (!hs) { return; }
  if (handler) {
    var i = hs.indexOf(handler);
    if (i >= 0) { hs.splice(i, 1); }
  } else { hs.length = 0; }
  if (hs.length === 0) { delete this._mjs_handlers[type]; delete this._mjs_subs[type]; }
};

MjsSocket.prototype._mjs_dispatch = function(type, msg) {
  // un delta de flux (sock.stream(type)) peut arriver ICI par un chemin qui ignore le test déjà
  // fait dans _mjs_onMessage côté TEXTE (ex. µschema binaire, cf. mjs_schema.ts::_mjs_mjschemaOnBinary,
  // qui appelle _mjs_dispatch directement, sans jamais passer par _mjs_onMessage) — même contrat que
  // le texte : un type abonné en stream() n'est JAMAIS un message pub/sub ordinaire.
  if (this._mjs_streams[type]) { this._mjs_onStreamDelta(type, msg); return; }
  // trame d'un flux quitté (en vol, rejouée par une reprise, ou poussée par un serveur que le désabonnement n'a pas atteint) :
  // à personne, ni au magasin ni aux écouteurs on(type) ; le désabonnement repart, une fois par fil
  if (type in this._mjs_unsubs) {
    if (this._mjs_unsubs[type] !== this._mjs_ws) { this._mjs_sendUnsub(type); }
    return;
  }
  var hs = this._mjs_handlers[type];
  if (!hs) { return; }
  var copy = hs.slice();
  for (var i = 0; i < copy.length; i++) {
    try { copy[i](msg.p, msg); } catch (e) { µ.error('[µ.socket] handler', e); }
  }
};

// --- envoi applicatif (+ anti-spam) ---
// normalise `debounce`/`coalesce` : `true`→défaut du socket ; nombre ou
// chaîne numérique non vide (`'300'`, `' 45 '`)→clampée ≥0 (négatif ramené à 0, aucun
// TimeoutNegativeWarning) ; `false`/`null`/absent→null (option absente, silence total) ;
// toute autre valeur (`'abc'`, objet)→null + UN SEUL `µ.warn` par socket et par option
// (clé `this._mjs_warnedOpts`) — avant ce correctif une chaîne perdait l'anti-rebond EN
// SILENCE (retombait tout droit sur _mjs_sendNow), même travers falsy que l'ancien `debounce: 0`
MjsSocket.prototype._mjs_normWait = function(value, defaultMs, name) {
  if (value === true) { return defaultMs; }
  if (value === false || value == null) { return null; }
  var n = value;
  if (typeof n === 'string') { n = n.trim(); n = (n === '') ? NaN : Number(n); }
  if (typeof n === 'number' && !isNaN(n)) { return (n < 0) ? 0 : n; }
  if (!this._mjs_warnedOpts[name]) {
    this._mjs_warnedOpts[name] = true;
    µ.warn('[µ.socket] ' + µ._mjs_txt('sockOptionInvalid', { name: name, value: JSON.stringify(value) }, 'option {name} ignorée : valeur invalide {value}'));
  }
  return null;
};

MjsSocket.prototype.send = function(type, payload, opts) {
  // connexion abandonnée (close() volontaire ou reconnexion épuisée/désactivée, cf.
  // close()/_mjs_scheduleReconnect) : message écarté plutôt qu'empilé dans une file hors-ligne qui
  // ne sera plus jamais rejouée tant que connect() n'a pas repris la main — un seul avertissement
  // par socket, pas un par message (choix conservateur ; alternative envisagée : file d'attente
  // bornée, rejouée à la prochaine reconnexion explicite).
  if (this._mjs_abandoned) {
    if (!this._mjs_abandonWarned) {
      this._mjs_abandonWarned = true;
      µ.warn('[µ.socket] ' + µ._mjs_txt('sockSendDropped', { url: this.url }, 'envoi ignoré : connexion abandonnée (close() volontaire, essais épuisés ou reconnect.enabled:false) — appelez connect() pour reprendre : {url}'));
    }
    return false;
  }
  this._mjs_ensure();
  // même normalisation que debounce/coalesce (_mjs_normWait) — AVANT ce correctif, une valeur
  // non numérique ('abc') comparait (now-last) < NaN, TOUJOURS faux : le cooldown se désactivait
  // en silence. `_mjs_normWait` clampe ≥0 et avertit UNE fois sur une valeur vraiment invalide.
  var cd = this._mjs_normWait(opts && opts.cooldown, 0, 'cooldown');
  if (cd != null && cd > 0) {
    var last = this._mjs_cooldownAt[type];
    var now = this._mjs_now();
    // 1er envoi (last indéfini) → toujours autorisé ; sinon au plus 1/cooldown ms
    if (last != null && (now - last) < cd) { return false; }   // trop tôt → on jette
    this._mjs_cooldownAt[type] = now;
  }
  // ordre inchangé cooldown → debounce → coalesce ; _mjs_normWait rend toujours soit null
  // (option absente ou invalide) soit un nombre déjà clampé ≥0
  // `volatile` : une trame qui ne vaut que maintenant (une position, un émoji) — jamais mise en file hors
  // ligne ; `key` : regroupée à part des autres trames du même type (un salon, une zone)
  var vol = !!(opts && opts.volatile);
  var key = opts && opts.key != null ? type + '\u0000' + opts.key : type;
  var db = this._mjs_normWait(opts && opts.debounce, this.opts.debounceMs || 200, 'debounce');
  if (db != null) { return this._mjs_debounceSend(type, payload, db, key, vol); }   // attend le silence, coalesce ignoré si présent
  var co = this._mjs_normWait(opts && opts.coalesce, this.opts.coalesceMs || 50, 'coalesce');
  if (co != null) { return this._mjs_coalesceSend(type, payload, co, key, vol); }   // garde la dernière, coalesce:0 = tour de boucle suivant
  return this._mjs_sendNow(type, payload, vol);
};

// sucre — envoi scopé à UN SALON SANS le rejoindre (aucun `µ:join`), contrairement à
// room(name).send() qui joint d'abord (cf. room() plus bas) : utile pour un envoi ponctuel où
// l'abonnement au salon ne sert à rien. Simple préfixe, délègue à send() (mêmes opts cooldown/coalesce).
MjsSocket.prototype.sendTo = function(room, type, payload, opts) {
  return this.send(room + '/' + type, payload, opts);
};

// paramètre `room` mort retiré : aucun
// des 2 appelants (send(), _mjs_coalesceSend()) ne le passait jamais — le
// scoping par salon se fait par PRÉFIXE de type (`room(name)` renvoie un
// proxy dont `send` délègue à `self.send(name + '/' + type, ...)`), pas par
// un champ `room` sur le message. Code mort depuis une itération de design
// antérieure, jamais atteint.
MjsSocket.prototype._mjs_sendNow = function(type, payload, volatile) {
  var obj = { t: type, p: payload };
  if (this.state === 'open') { return this._mjs_rawSend(obj); }
  // périmée dans une seconde : elle ne chasse pas les messages de l'appli de la file, et n'est pas
  // rejouée d'un coup à la reconnexion (le serveur expulserait pour débit)
  if (volatile) { return false; }
  if (this.opts.queueOffline !== false) {
    this._mjs_queue.push({ type: type, payload: payload });
    var maxQ = this.opts.maxQueue || 1000;
    if (this._mjs_queue.length > maxQ) {
      this._mjs_queue.shift();
      // débordement continu → averti UNE SEULE fois (pas par message perdu), lastError
      // réactif renseigné ; remis à zéro au prochain welcome (file vidée, cf. _mjs_onWelcome) — le
      // contrat FIFO borné ne change pas, seul le SIGNAL de la perte apparaît désormais.
      if (!this._mjs_queueOverflowWarned) {
        this._mjs_queueOverflowWarned = true;
        this._mjs_st.lastError = { code: 'queue-overflow', message: 'file hors-ligne pleine (maxQueue=' + maxQ + ') — message le plus ancien perdu' };
        µ.warn('[µ.socket] ' + µ._mjs_txt('sockQueueFull', { maxQ: maxQ }, 'file hors-ligne pleine (maxQueue={maxQ}) — message le plus ancien perdu'));
      }
    }
  }
  return false;
};

MjsSocket.prototype._mjs_coalesceSend = function(type, payload, interval, key, volatile) {
  // intervalle en MILLISECONDES, homogène avec cooldown (l'ancienne unité Hz est morte) ;
  // `true` retombe sur le défaut opts.coalesceMs (50 ms ≈ 20 trames/s) ; une case par clé (le type,
  // ou le type et la clé donnée à send)
  var ms   = (typeof interval === 'number') ? interval : (this.opts.coalesceMs || 50);
  var k    = key || type;
  var slot = this._mjs_coalesce[k] || (this._mjs_coalesce[k] = { payload: null, scheduled: false, timer: null });
  slot.payload  = payload;
  slot.volatile = !!volatile;
  if (!slot.scheduled) {
    slot.scheduled = true;
    var self = this;
    var maxBuf = this.opts.maxBuffered || 65536;
    // id du timer CONSERVÉ (`slot.timer`)
    // pour l'annuler depuis destroy() (sinon _mjs_sendNow() sur socket mort → _mjs_queue
    // orpheline + `self` maintenu vivant par la closure).
    // DURCISSEMENT — contre-pression : sur
    // lien saturé, `bufferedAmount` du navigateur enfle sans limite. Pour des
    // données « dernière position » on préfère SAUTER des trames (le slot garde
    // déjà la dernière valeur, la sémantique coalesce s'y prête) : à l'échéance,
    // si le buffer déborde encore, on retente plus tard SANS envoyer.
    // NB (« leading edge ») : DIFFÉRÉ / PERF-À-BENCHER — un envoi immédiat
    // de la 1ʳᵉ trame dépendait d'un delta de wall-clock (`_mjs_now()`) entre deux
    // `send()` synchrones, non déterministe sous les harnais de timers factices
    // (une pause GC > intervalle faisait repartir la tête). À réintroduire avec
    // une horloge injectable.
    var tick = function() {
      if (self._mjs_ws && self._mjs_ws.bufferedAmount > maxBuf) { slot.timer = setTimeout(tick, ms); return; }
      // une trame d'effet au-delà de la part des effets : retenue, sa dernière valeur partira
      if (slot.volatile && self.state === 'open' && !self._mjs_fxToken()) { slot.timer = setTimeout(tick, ms); return; }
      slot.scheduled = false;
      slot.timer = null;
      // parti : la case n'a plus rien à garder (un salon de plus visité ne laisse pas une case de plus à vie)
      if (self._mjs_coalesce[k] === slot) delete self._mjs_coalesce[k];
      self._mjs_sendNow(type, slot.payload, slot.volatile);
    };
    slot.timer = setTimeout(tick, ms);
  }
  return true;
};

MjsSocket.prototype._mjs_debounceSend = function(type, payload, wait, key, volatile) {
  // silence de `ms` sur ce type avant émission — contrairement à coalesce (cadence fixe même
  // sous activité continue), ici rien ne part tant que les envois s'enchaînent plus vite que
  // `ms` : chaque nouvel envoi remplace la charge en attente ET remet la minuterie à zéro ;
  // seule la DERNIÈRE charge part, à la première pause de silence — cas du champ de recherche
  // ou du curseur qu'on relâche. `true` retombe sur le défaut opts.debounceMs (200 ms). Même
  // contre-pression que coalesce : bufferedAmount > maxBuf → réessai après `ms`, sans reset
  // de charge.
  // fermeture RÉUTILISÉE (même idée que _mjs_coalesceSend juste au-dessus) : un debounce doit de
  // toute façon relancer setTimeout à CHAQUE appel (c'est le sens même du debounce), mais la
  // FONCTION `tick` elle-même n'a pas besoin d'être réallouée à chaque fois — posée UNE FOIS sur le
  // slot, elle relit `ms`/`maxBuf` DEPUIS le slot (dernier appel gagne), donc un comportement
  // identique à la fermeture recréée à chaque appel, sans son coût d'allocation tant que les envois s'enchaînent (la case
  // part avec le message : elle se refait après un silence).
  var self = this;
  var k    = key || type;
  var slot = this._mjs_debounce[k];
  if (!slot) {
    slot = this._mjs_debounce[k] = { payload: null, timer: null, ms: 0, maxBuf: 0 };
    slot.tick = function() {
      if (self._mjs_ws && self._mjs_ws.bufferedAmount > slot.maxBuf) { slot.timer = setTimeout(slot.tick, slot.ms); return; }
      slot.timer = null;
      // parti : la case n'a plus rien à garder (un salon de plus visité ne laisse pas une case de plus à vie)
      if (self._mjs_debounce[k] === slot) delete self._mjs_debounce[k];
      self._mjs_sendNow(type, slot.payload, slot.volatile);
    };
  }
  slot.volatile = !!volatile;
  slot.ms      = (typeof wait === 'number') ? wait : (this.opts.debounceMs || 200);
  slot.maxBuf  = this.opts.maxBuffered || 65536;
  slot.payload = payload;
  if (slot.timer) { clearTimeout(slot.timer); }   // chaque envoi remet le silence à zéro
  slot.timer = setTimeout(slot.tick, slot.ms);
  return true;
};

// --- heartbeat (placeholder enrichi en 2b) ---
MjsSocket.prototype._mjs_startHeartbeat = function() {
  var ms = this._mjs_hbMs = (this.opts.heartbeat != null) ? this.opts.heartbeat : 15000;
  if (!ms) { return; }
  var self = this;
  this._mjs_stopHeartbeat();
  this._mjs_hbTimer = setInterval(function() { self._mjs_beat(); }, ms);
};
// un battement : le µ:ping, compté s'il part, et sa garde — sans µ:pong d'ici deux périodes, la connexion est morte. `early` : le
// µ:ping de preuve d'un départ (cf. _mjs_leavePing), marqué, dont le serveur ne relève aucun écart entre battements ; parti, le
// battement repart de lui, une période plus tard. Sans battement, il part seul, sans garde
MjsSocket.prototype._mjs_beat = function(early) {
  var self = this, ms = this._mjs_hbMs, wd;
  var sent = this._mjs_rawSend({ t: 'µ:ping', p: early ? { ts: this._mjs_now(), early: true } : { ts: this._mjs_now() } });
  if (sent) { this._mjs_pings++; }
  if (!this._mjs_hbTimer || (early && !sent)) { return; }
  if (early) {
    clearInterval(this._mjs_hbTimer);
    this._mjs_hbTimer = setInterval(function() { self._mjs_beat(); }, ms);
  }
  // AVANT : slot UNIQUE `_hbWatchdog`
  // réassigné à CHAQUE tick, écrasant la RÉFÉRENCE JS sans `clearTimeout`
  // du précédent — le timer natif du cycle d'AVANT continuait de courir en
  // fantôme (orphelin) jusqu'à son propre terme. Comme l'intervalle par
  // défaut (`ms`) est plus COURT que le délai du watchdog (`ms*2`), un
  // 2ᵉ (voire 3ᵉ) ping part TOUJOURS avant l'échéance du 1ᵉʳ watchdog — un
  // `µ:pong` reçu entre-temps n'annulait que le watchdog COURANT
  // (`_mjs_petWatchdog`), jamais le(s) fantôme(s) plus ancien(s) : ils finissaient
  // par fermer une connexion PARFAITEMENT SAINE à leur échéance, malgré un
  // pong reçu depuis. Fix : TOUS les watchdogs en vol sont trackés (tableau,
  // pas un slot) ; `_mjs_petWatchdog` (tout pong) les efface TOUS d'un coup — la
  // preuve de vie la plus récente rend caduques toutes les échéances
  // antérieures, pas seulement la plus proche. (Un simple "clear l'ancien
  // avant de poser le nouveau", essayé puis abandonné : ça désactive
  // ENTIÈREMENT la détection de connexion morte dès que l'intervalle < délai
  // du watchdog, soit la config par défaut — le watchdog n'a alors JAMAIS le
  // temps d'atteindre son échéance avant d'être supplanté par le suivant.)
  wd = setTimeout(function() {
    // pas de pong → connexion morte → on relance
    if (self._mjs_ws) { self._mjs_onClose({ code: 4000 }); }
  }, ms * 2);
  this._mjs_hbWatchdogs.push(wd);
};
MjsSocket.prototype._mjs_stopHeartbeat = function() {
  if (this._mjs_hbTimer) { clearInterval(this._mjs_hbTimer); this._mjs_hbTimer = null; }
  this._mjs_clearWatchdogs();
};
// Efface TOUS les watchdogs actuellement en vol (pas seulement le dernier) —
// cf. commentaire dans _mjs_beat.
MjsSocket.prototype._mjs_clearWatchdogs = function() {
  var wds = this._mjs_hbWatchdogs;
  if (wds) { for (var i = 0; i < wds.length; i++) { clearTimeout(wds[i]); } }
  this._mjs_hbWatchdogs = [];
};
MjsSocket.prototype._mjs_petWatchdog = function() {
  this._mjs_clearWatchdogs();
};

// --- placeholders remplis dans les sous-briques suivantes ---
MjsSocket.prototype._mjs_onAck = function(msg) {
  var r = this._mjs_reqs[msg.id], k;
  // la réponse à une requête partie après un µ:leave sur ce fil prouve le départ, comme un µ:pong (cf. _mjs_sendLeave) — celle d'une
  // requête que le client n'attend plus (délai passé) aussi
  for (k in this._mjs_roomLeaves) {
    if (this._mjs_roomLeaves[k].ws === this._mjs_ws && this._mjs_roomLeaves[k].req < msg.id) { delete this._mjs_roomLeaves[k]; }
  }
  if (!r) { return; }
  delete this._mjs_reqs[msg.id];
  if (r.timer) { clearTimeout(r.timer); }
  if (msg.e) { r.reject(msg.p); } else { r.resolve(msg.p); }
};

MjsSocket.prototype.request = function(type, payload, opts) {
  this._mjs_ensure();
  opts = opts || {};
  var self = this;
  var id = ++this._mjs_reqSeq;
  return new Promise(function(resolve, reject) {
    if (self.state !== 'open' && !opts.waitForOpen) {
      reject({ code: 'offline', message: 'socket non connecté' });
      return;
    }
    var timeoutMs = (opts.timeout != null) ? opts.timeout : (self.opts.timeout || 5000);
    var pending = { id: id, type: type, payload: payload };
    var timer = setTimeout(function() {
      delete self._mjs_reqs[id];
      // purge le rendez-vous
      // _mjs_pendingOpenReqs : sans ça, un `_mjs_onWelcome` ULTÉRIEUR (reconnexion
      // après ce timeout) renverrait quand même la requête, alors que
      // l'appelant a déjà reçu le rejet et abandonné.
      var pi = self._mjs_pendingOpenReqs.indexOf(pending);
      if (pi !== -1) { self._mjs_pendingOpenReqs.splice(pi, 1); }
      reject({ code: 'timeout', message: 'request timeout' });
    }, timeoutMs);
    self._mjs_reqs[id] = { resolve: resolve, reject: reject, timer: timer };
    if (self.state === 'open') {
      self._mjs_rawSend({ t: type, p: payload, id: id });
    } else {
      // `waitForOpen: true` hors-ligne :
      // AVANT, `_mjs_rawSend()` partait ICI inconditionnellement — silencieusement
      // jeté par `_mjs_rawSend` (readyState !== 1, cf. plus haut), sans AUCUN filet
      // de rattrapage à l'ouverture. La requête n'était donc JAMAIS
      // réellement transmise : seul le timeout ci-dessus finissait par
      // rejeter, TOUJOURS, même si la connexion s'ouvrait 100ms plus tard —
      // l'option ne changeait rien d'observable pour l'appelant à part
      // retarder un échec devenu inévitable. On diffère maintenant l'envoi
      // RÉEL jusqu'à `_mjs_onWelcome` (même relais que la file `_mjs_queue` de
      // send() juste au-dessus dans ce fichier) ; le timeout reste le filet
      // de sécurité si la connexion n'aboutit jamais.
      self._mjs_pendingOpenReqs.push(pending);
    }
  });
};

// --- rafraîchissement du jeton EN VOL (cf. mjs-ws/core.ts µ:refresh) ---
// Accepte le MÊME contrat que l'option `auth` du constructeur (valeur directe, fonction sync,
// ou fonction async) — PAS de re-tentative automatique ni de timer : c'est à l'appli de décider
// QUAND rafraîchir (ex. un peu avant l'échéance connue du jeton courant). `refresh` n'est PAS
// un nom d'événement réservé côté on() (contrairement à 'welcome') — seule cette méthode existe.
MjsSocket.prototype.refresh = function(a) {
  this._mjs_ensure();
  var self = this;
  return new Promise(function(resolve, reject) {
    var send = function(authValue) { self.request('µ:refresh', { auth: authValue }).then(resolve, reject); };
    if (typeof a === 'function') {
      var r;
      try { r = a(); } catch (e) { reject(e); return; }
      if (r && typeof r.then === 'function') { r.then(send, reject); }
      else { send(r); }
    } else { send(a); }
  });
};

// --- 2c : stream réactif (deltas + numéros de séquence + resync) ---
MjsSocket.prototype.stream = function(type, opts) {
  this._mjs_ensure();
  opts = opts || {};
  var ex = this._mjs_streams[type];
  if (ex) { return ex.store; }
  var store = µ.state({});
  delete this._mjs_unsubs[type];
  this._mjs_streams[type] = { store: store, lastSeq: 0, resyncing: false };
  this._mjs_subs['stream:' + type] = true;
  this._mjs_rawSend({ t: 'µ:sub-stream', p: { stream: type } });
  return store;
};

// le symétrique de stream() : le socket cesse de suivre le flux — µ:unsub-stream part si la connexion est ouverte, sinon au
// welcome d'une session reprise, et rien n'est redemandé à la reconnexion. Le magasin, partagé par tous ceux qui l'ont reçu
// de stream(), garde son dernier état sans plus rien recevoir, et aucune trame du flux n'atteint plus les écouteurs ; un
// stream() ensuite repart d'un magasin neuf. Un type qui n'est pas suivi : rien, pas même une connexion ouverte
MjsSocket.prototype.unstream = function(type) {
  if (!this._mjs_streams[type]) { return; }
  delete this._mjs_streams[type];
  delete this._mjs_subs['stream:' + type];
  this._mjs_sendUnsub(type);
};

// µ:unsub-stream d'un flux quitté : le fil où il est parti est retenu, null s'il n'a pas pu partir (cf. _mjs_onWelcome)
MjsSocket.prototype._mjs_sendUnsub = function(type) {
  this._mjs_unsubs[type] = this._mjs_rawSend({ t: 'µ:unsub-stream', p: { stream: type } }) ? this._mjs_ws : null;
};

// µ:leave d'un salon quitté, retenu jusqu'à la preuve que le serveur l'a traité : le fil où il est parti, le nombre de µ:ping partis
// avant lui sur ce fil et le numéro de la dernière requête d'avant lui. Le serveur traite les trames d'une connexion dans l'ordre et
// ne rejoue jamais un µ:pong ni un µ:ack d'une autre connexion : la réponse à une trame partie après lui sur le même fil le prouve —
// le µ:pong d'un µ:ping (un battement, ou celui que le client envoie lui-même, cf. _mjs_leavePing), le µ:ack d'une requête (cf.
// _mjs_onAck) —, un accueil neuf n'a plus aucun salon, un room() du même salon l'annule.
// D'ici là, une reprise de session le redit (cf. _mjs_onWelcome), sans effet sur un serveur qui l'avait reçu. Au plus
// MJSOCKET_MAX_LEAVES départs retenus : au-delà, le plus ancien est oublié. Le µ:ping de preuve part une fois la ligne calme (cf.
// _mjs_leavePing), ou aussitôt quand MJSOCKET_LEAVE_BATCH départs partis sur ce fil n'ont été suivis d'aucun µ:ping
MjsSocket.prototype._mjs_sendLeave = function(name) {
  var sent = this._mjs_rawSend({ t: 'µ:leave', p: { room: name } }), leaves = this._mjs_roomLeaves, n = 0, wait = 0, old = null, k, l;
  leaves[name] = { ws: sent ? this._mjs_ws : null, pings: this._mjs_pings, req: this._mjs_reqSeq, n: ++this._mjs_leaveSeq };
  for (k in leaves) {
    l = leaves[k];
    n++;
    if (old === null || l.n < leaves[old].n) { old = k; }
    if (l.ws && l.ws === this._mjs_ws && l.pings === this._mjs_pings) { wait++; }
  }
  if (n > MJSOCKET_MAX_LEAVES) { delete leaves[old]; }
  if (!sent) { return; }
  if (wait >= MJSOCKET_LEAVE_BATCH) { this._mjs_beat(true); }
  else { this._mjs_leavePing(); }
};

// la preuve des départs partis sur ce fil qu'aucune réponse du serveur n'a encore prouvés : un µ:ping, un seul pour tous, une fois la
// ligne calme depuis MJSOCKET_LEAVE_PING_MS (aucune trame partie) — un échange suivi (une boucle rejoindre / quitter) n'en reçoit
// pas une trame de plus, ni le limiteur du serveur une rafale ; aucun si un µ:ping est parti après eux, sa réponse les prouve. Marqué
// (cf. _mjs_beat) : le serveur n'en relève aucun écart entre battements, le battement repart de lui
MjsSocket.prototype._mjs_leavePing = function(wait) {
  if (this._mjs_leaveTimer) { return; }
  var self = this;
  this._mjs_leaveTimer = setTimeout(function() {
    var calm = self._mjs_now() - self._mjs_sentAt, k, l;
    self._mjs_leaveTimer = null;
    for (k in self._mjs_roomLeaves) {
      l = self._mjs_roomLeaves[k];
      if (l.ws && l.ws === self._mjs_ws && l.pings === self._mjs_pings) {
        if (calm < MJSOCKET_LEAVE_PING_MS) { self._mjs_leavePing(MJSOCKET_LEAVE_PING_MS - calm); }
        else { self._mjs_beat(true); }
        return;
      }
    }
  }, wait || MJSOCKET_LEAVE_PING_MS);
};

// le serveur refuse un flux (`µ:error { code: 'stream-denied', stream }`) et l'a déjà désabonné : ce flux seul est oublié,
// plus redemandé au welcome suivant (aucun nouvel essai de lui-même) — l'appli peut rappeler sock.stream(name), qui repart
// d'un magasin neuf ; une trame de ce flux qui arrive encore ne va à personne
MjsSocket.prototype._mjs_onStreamDenied = function(name) {
  if (!this._mjs_streams[name]) { return; }
  delete this._mjs_streams[name];
  delete this._mjs_subs['stream:' + name];
  this._mjs_unsubs[name] = this._mjs_ws;
};

MjsSocket.prototype._mjs_onStreamDelta = function(type, msg) {
  var st = this._mjs_streams[type];
  if (!st) { return; }
  var p = msg.p || {};
  var seq = msg.seq;
  // un `reset` est
  // un remplacement d'état COMPLET : ni doublon, ni trou. Il est accepté quelle
  // que soit la seq (serveur REDÉMARRÉ, compteur reparti de zéro, ex. seq=1
  // alors que le client était à 500) — Y COMPRIS SANS seq (`seq: undefined`,
  // snapshot non numéroté). AVANT, ce dernier cas sautait tout le bloc gardé
  // `if (seq != null)` : les valeurs étaient bien appliquées, mais `lastSeq`
  // restait HAUT → TOUS les deltas suivants (seq 1,2,3…) retombaient ensuite
  // dans la garde anti-doublon → flux figé à vie (le symptôme même que le fix
  // du reset numéroté corrigeait). On remet le compteur (à `seq` s'il existe,
  // sinon 0) puis on applique.
  if (p.op === 'reset') {
    st.resyncing = false;
    st.lastSeq = (seq != null) ? seq : 0;
    st.seqKnown = (seq != null);
    this._mjs_applyDelta(st.store, p);
    return;
  }
  if (seq != null) {
    // Delta périmé/dupliqué (retransmission, arrivée hors-ordre) : seq déjà vu →
    // on l'ignore. Sinon on le ré-appliquait ET on faisait RECULER lastSeq.
    if (st.lastSeq && seq <= st.lastSeq) { return; }
    // Détection de trou : on a sauté des numéros → on redemande depuis le dernier
    // vu. Flag anti-rafale : tant que le trou n'est pas comblé, ne PAS ré-émettre
    // un resync à chaque delta en avance (le serveur peut en pousser plusieurs).
    // Dès 0 aussi après un état complet numéroté (flux encore vide, `reset` à 0) :
    // un delta qui en saute un est un trou comme un autre.
    if ((st.lastSeq || st.seqKnown) && seq > st.lastSeq + 1) {
      if (!st.resyncing) {
        st.resyncing = true;
        this._mjs_rawSend({ t: 'µ:resync', p: { stream: type, from: st.lastSeq } });
      }
      return;
    }
    // Séquence contiguë : le trou éventuel est comblé.
    st.resyncing = false;
    st.lastSeq = seq;
  }
  this._mjs_applyDelta(st.store, p);
};

// Garde anti-pollution locale (indépendante de mjs_init : le socket peut être
// chargé/testé isolément). Bloque __proto__/constructor/prototype sur un segment de
// chemin réseau écrit dans une vue ORDINAIRE, sans état réactif pour la garder (_applyDeltaOps, mjs_game.ts).
function _mjs_safeKey(k) {
  return k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
}
// range une clé venue du réseau sur une copie ordinaire : `__proto__` y reste une clé comme une autre — l'affectation
// `copie['__proto__'] = …` changerait le prototype de la copie au lieu d'y ranger la donnée
function _mjs_putOwn(o, k, v) {
  if (k === '__proto__') { Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); }
  else { o[k] = v; }
}
// clé de premier niveau d'un magasin de présence ou de flux (un pair, une clé du flux) : écrite telle quelle, ces magasins sont
// des états réactifs (µ.state) qui refusent eux-mêmes __proto__, constructor et prototype — le seul contrôle, au plus près de
// l'état (une trace le dit pendant le développement, une fois par nom)
MjsSocket.prototype._mjs_applyDelta = function(store, p) {
  var k, cur, merged, a, b;
  switch (p.op) {
    case 'reset':
      for (k in store) { delete store[k]; }
      var vals = p.values || {};
      for (k in vals) { store[k] = vals[k]; }
      break;
    case 'add':
      store[p.key] = p.value;
      break;
    case 'update':
      // les champs de l'entrée sont des données, gardés tous comme ceux d'un 'add', ces trois noms compris
      cur = store[p.key] || {};
      merged = {};
      for (a in cur) { _mjs_putOwn(merged, a, cur[a]); }
      var patch = p.patch || {};
      for (b in patch) { _mjs_putOwn(merged, b, patch[b]); }
      store[p.key] = merged;
      break;
    case 'remove':
      delete store[p.key];
      break;
  }
};

// --- 2d : presence + rooms + kick serveur ---
MjsSocket.prototype.presence = function(room) {
  this._mjs_ensure();
  var key = room || '';
  var ex = this._mjs_presence[key];
  if (ex) { return ex; }
  var store = µ.state({});
  this._mjs_presence[key] = store;
  this._mjs_subs['presence:' + key] = true;
  this._mjs_rawSend({ t: 'µ:sub-presence', p: { room: room } });
  return store;
};

MjsSocket.prototype._mjs_onPresence = function(msg) {
  var p = msg.p || {};
  var store = this._mjs_presence[p.room || ''];
  if (!store) { return; }
  var id, peers;
  switch (p.op) {
    case 'reset':
      for (id in store) { delete store[id]; }
      peers = p.peers || {};
      for (id in peers) { store[id] = peers[id]; }
      break;
    case 'join':  store[p.id] = p.meta; break;
    case 'leave': delete store[p.id]; break;
  }
};

// purge COMPLÈTE d'un
// salon, appelée par leave() (client) ET _mjs_onLeft (kick serveur). Le proxy
// room() ne garde que les désabonnements de ses propres écoutes : handlers, streams,
// présence et callback onLeft vivent tous sur le SOCKET PARTAGÉ. L'ancien
// leave() ne retirait QUE les handlers `name/…` — streams (`_mjs_streams['name/type']`
// + `_mjs_subs`), présence (`_mjs_presence[name]` + `_mjs_subs`) et `_mjs_onLeftCb[name]`
// restaient référencés à vie ET RÉ-ABONNÉS à chaque reconnexion (_mjs_onWelcome)
// pour un salon pourtant quitté. On purge tout ici.
MjsSocket.prototype._mjs_purgeRoom = function(name) {
  var prefix = name + '/', __k;
  // handlers + subs pub/sub namespacés (réutilise off() : sa propre logique de nettoyage)
  for (__k in this._mjs_handlers) { if (__k.indexOf(prefix) === 0) { this.off(__k); } }
  // streams du salon : _mjs_streams['name/type'] + _mjs_subs['stream:name/type']
  for (__k in this._mjs_streams) {
    if (__k.indexOf(prefix) === 0) { delete this._mjs_streams[__k]; delete this._mjs_subs['stream:' + __k]; }
  }
  // présence du salon : _mjs_presence[name] + _mjs_subs['presence:name']
  if (this._mjs_presence[name]) { delete this._mjs_presence[name]; delete this._mjs_subs['presence:' + name]; }
  // callback onLeft du salon
  if (this._mjs_onLeftCb) { delete this._mjs_onLeftCb[name]; }
};

// join optimiste : µ:join part tout de suite (un appel avant l'ouverture est un no-op réseau, le welcome rejoint tous
// les salons de _mjs_rooms) ; le serveur n'accuse pas un join accepté, et son refus nomme le salon
MjsSocket.prototype._mjs_sendJoin = function(name) {
  this._mjs_rawSend({ t: 'µ:join', p: { room: name } });
};

// le serveur refuse l'entrée d'un salon (`µ:error { code: 'join-denied', room }`) : ce salon sort de _mjs_rooms, plus
// jamais re-tenté au welcome suivant — l'appli peut rappeler sock.room(name) ; jamais les autres salons, ni
// presence/stream (aucun appel à _mjs_purgeRoom ici)
MjsSocket.prototype._mjs_onJoinDenied = function(name) {
  if (this._mjs_rooms[name]) { delete this._mjs_rooms[name]; }
};

MjsSocket.prototype.room = function(name) {
  this._mjs_ensure();
  // join en double : room(name) appelé
  // 2 FOIS pour LE MÊME nom (2 composants distincts qui rejoignent le même
  // salon, ou un composant qui re-render et rappelle room() sans garder sa
  // référence) renvoyait TOUJOURS un `µ:join` au serveur, même déjà membre —
  // gaspillage réseau au mieux, double comptage côté serveur (présence,
  // membres) au pire, selon l'implémentation. `_mjs_rooms[name]` sert DÉJÀ de
  // registre d'appartenance (relu par _mjs_onWelcome pour le re-join auto après
  // reconnexion) : on s'en sert aussi comme garde ici. Le proxy retourné
  // reste un NOUVEL objet à chaque appel (comportement inchangé).
  // Plusieurs poignées du même salon (une discussion et un autre composant, deux halls du même nom, un
  // effet en direct et l'appli) : `_mjs_rooms[name]` compte ses poignées — le départ de l'une ne retire
  // que ses propres écoutes, le salon n'est quitté qu'au départ de la dernière. Un salon perdu entre-temps
  // (exclusion, entrée refusée) repart d'un compte neuf : une poignée d'avant n'y décompte plus rien.
  var held = this._mjs_rooms[name];
  if (!held) {
    delete this._mjs_roomLeaves[name];   // rejoint : un départ encore retenu n'a plus lieu d'être
    held = this._mjs_rooms[name] = { n: 0 };
    this._mjs_sendJoin(name);   // join optimiste, cf. _mjs_sendJoin/_mjs_onJoinDenied
  }
  held.n++;
  var self = this;
  var prefix = name + '/';
  var mine = [], gone = false, myLeft;   // désabonnements des écoutes de CETTE poignée, départ fait, son rappel d'exclusion
  // chaque poignée pose son rappel d'exclusion dans la liste du salon (`_mjs_onLeftCb[name]`) et n'en retire que le sien
  var dropLeft = function() {
    var l = self._mjs_onLeftCb && self._mjs_onLeftCb[name], i = l ? l.indexOf(myLeft) : -1;
    if (i !== -1) { l.splice(i, 1); }
  };
  // une poignée partie (leave() fait, souvent à la destruction de son composant) n'inscrit ni n'envoie plus rien : un on(), un
  // onLeft(), un stream() ou un presence() tardif s'accrocherait au salon d'une autre poignée, ou à celui rejoint plus tard (et
  // reviendrait à chaque reconnexion), un send() ou un request() partirait en son nom ; le développement le dit
  var late = function(fn) {
    µ._mjs_logger()?.('[µ.socket] ' + µ._mjs_txt('sockHandleGone', { fn: fn, room: name }, '{fn}() sur une poignée du salon « {room} » déjà partie (leave()) : rien n\'est inscrit ni envoyé — pour reprendre ce salon, prenez une poignée neuve avec sock.room()'));
  };
  return {
    on:       function(type, h) {
      if (gone) { late('on'); return function() {}; }
      var off = self.on(prefix + type, h);
      var un  = function() { var i = mine.indexOf(un); if (i !== -1) { mine.splice(i, 1); off(); } };
      mine.push(un);
      return un;
    },
    send:     function(type, p, opts) {
      if (gone) { late('send'); return false; }
      return self.send(prefix + type, p, opts);
    },
    request:  function(type, p, opts) {
      if (gone) { late('request'); return Promise.reject({ code: 'left', message: 'poignée du salon « ' + name + ' » déjà partie (leave()) : requête non envoyée' }); }
      return self.request(prefix + type, p, opts);
    },
    // partie : un magasin qui ne reçoit rien, aucun abonnement
    stream:   function(type, opts) {
      if (gone) { late('stream'); return µ.state({}); }
      return self.stream(prefix + type, opts);
    },
    // partie : rien, ses flux sont oubliés avec le salon, ou tenus par une autre poignée qui le garde
    unstream: function(type) {
      if (gone) { return; }
      self.unstream(prefix + type);
    },
    presence: function() {
      if (gone) { late('presence'); return µ.state({}); }
      return self.presence(name);
    },
    // registre sans prototype : un salon nommé `toString` ou `constructor` n'y trouve pas de méthode héritée
    onLeft:   function(fn) {
      if (gone) { late('onLeft'); return; }
      var c = self._mjs_onLeftCb || (self._mjs_onLeftCb = Object.create(null));
      dropLeft();
      (c[name] || (c[name] = [])).push(myLeft = fn);
    },
    // un 2e leave() de la même poignée (ex. double cleanup @destroy) ne décompte rien
    leave:    function() {
      if (gone) { return; }
      gone = true;
      while (mine.length) { mine[0](); }
      dropLeft();
      if (self._mjs_rooms[name] !== held || --held.n > 0) { return; }
      delete self._mjs_rooms[name];
      // retenu jusqu'à la preuve que le serveur l'a traité : une session reprise garde ses salons, le départ y repart (cf. _mjs_sendLeave)
      self._mjs_sendLeave(name);
      // purge
      // COMPLÈTE du salon (handlers, streams, présence, onLeft), pas seulement
      // les handlers : sinon fuite mémoire (closures/stores retenus à vie sur
      // le socket partagé) ET ré-abonnement du salon QUITTÉ à chaque
      // reconnexion (_mjs_onWelcome ré-émet µ:sub-stream/µ:sub-presence). Cf.
      // _mjs_purgeRoom (partagé avec le kick serveur _mjs_onLeft).
      self._mjs_purgeRoom(name);
    }
  };
};

// une poignée de discussion ou de hall ouverte pendant qu'un composant s'exécute (initialisation, µmount, effet — fonction
// de magasin comprise : c'est le moment de l'appel qui compte) suit ce composant, comme µevery : fermée à sa destruction
// (`fermer` rend false s'il n'y a rien à fermer), rouverte s'il revient dans la page (`ouvrir`). Fermée par l'appli
// (`h._mjs_shut`), elle le reste ; ouverte hors de tout composant, rien ne change. Une partie ne suit pas le composant (cf.
// mjs_game.ts)
MjsSocket.prototype._mjs_ownHandle = function(h, fermer, ouvrir) {
  var comp = µ.activeComponent, fin;
  if (!comp || typeof comp._mjs_onDestroy !== 'function') { return; }
  fin = function() {
    comp._mjs_onDestroy(fin);
    if (h._mjs_shut || fermer() === false) { return; }
    (comp._mjs_mount_cbs || (comp._mjs_mount_cbs = [])).push(function() { if (!h._mjs_shut) { ouvrir(); } });
  };
  comp._mjs_onDestroy(fin);
};

MjsSocket.prototype._mjs_onLeft = function(msg) {
  var p = msg.p || {};
  delete this._mjs_rooms[p.room];
  // les rappels de TOUTES les poignées du salon, sur une copie : un rappel peut quitter sa poignée (leave() retire le sien)
  var cbs = (this._mjs_onLeftCb && this._mjs_onLeftCb[p.room] || []).slice(), i;
  for (i = 0; i < cbs.length; i++) { try { cbs[i](p.reason); } catch {} }
  // kick serveur symétrique au
  // leave() client : purge streams/présence/handlers du salon (APRÈS le
  // callback, qui peut vouloir lire l'état une dernière fois). Sans ça, mêmes
  // fuites qu'au leave() non purgé + ré-abonnement au prochain welcome.
  if (p.room != null) { this._mjs_purgeRoom(p.room); }
};

// --- cycle de vie ---
// fermeture volontaire = rien ne doit repartir : purge les envois `debounce`/`coalesce`
// encore EN VOL (send() avec anti-rebond/regroupement) — appelée par close() ET destroy(),
// et aux fins d'identité (refus, adieu du serveur, session exclusive perdue : comme la file, ils
// appartiennent à l'identité qui les a écrits), jamais par _mjs_teardown() (coupure réseau
// involontaire : la file hors-ligne reste le comportement voulu, cf. _mjs_teardown plus haut).
// Rend le nombre d'envois annulés, trames volatiles exclues (elles ne seraient jamais parties hors ligne)
MjsSocket.prototype._mjs_cancelPending = function() {
  var n = 0;
  var coal = this._mjs_coalesce;
  for (var __ct in coal) { if (coal[__ct].timer) { clearTimeout(coal[__ct].timer); if (!coal[__ct].volatile) { n++; } } }
  this._mjs_coalesce = Object.create(null);
  var deb = this._mjs_debounce;
  for (var __dt in deb) { if (deb[__dt].timer) { clearTimeout(deb[__dt].timer); if (!deb[__dt].volatile) { n++; } } }
  this._mjs_debounce = Object.create(null);
  return n;
};

MjsSocket.prototype.close = function(code, reason) {
  this._mjs_wantOpen = false;
  // même garde que la reconnexion abandonnée (essais épuisés/reconnect.enabled:false, cf.
  // _mjs_scheduleReconnect) : sans elle, _mjs_ensure() ne testait que ce 2e cas — un send()/on()/
  // request()/stream() après ce close() explicite rouvrait quand même une connexion brute. Seul un
  // connect() explicite (qui remet ce flag à false) reprend la main.
  this._mjs_abandoned = true;
  // le close() de l'appli gagne toujours : aucune reconnexion du runtime (élévation d'un compte, retour en invité après
  // un refus, cf. _mjs_reopen) ne rouvre ce qu'elle a fermé
  this._mjs_closedByApp = true;
  if (this._mjs_reconnectTimer) { clearTimeout(this._mjs_reconnectTimer); this._mjs_reconnectTimer = null; }
  this._mjs_teardown(true);           // fermeture volontaire = fin définitive → rejette les waitForOpen
  this._mjs_cancelPending();          // idem — un debounce/coalesce en vol ne doit pas ressusciter dans _mjs_queue après coup
  this._mjs_pendingOpenReqs = [];
  // idem pour la file hors ligne : après une déconnexion de l'appli, un connect() sous une autre identité n'envoie pas
  // les messages laissés par la précédente
  this._mjs_queue = [];
  this._mjs_queueOverflowWarned = false;
  this._mjs_setState('closed');
};

// reconnexion voulue par le runtime (élévation d'un compte, cf. mjs_accounts.ts) : le fil repart avec le nouvel `auth`
// sans rien perdre de ce que l'appli attend — file hors ligne, requêtes qui attendent l'ouverture (chat:me,
// lobby:enter…), salons et abonnements rejoués au welcome ; contrairement à close(), rien n'est abandonné — et jamais
// après un close() de l'appli, qui gagne toujours (seul son connect() reprend la main). Une requête déjà partie sur le fil
// quitté n'aura pas sa réponse : rejetée `unknown` (le serveur a pu la servir)
MjsSocket.prototype._mjs_reopen = function() {
  if (this._mjs_destroyed || this._mjs_closedByApp) { return; }
  if (this._mjs_reconnectTimer) { clearTimeout(this._mjs_reconnectTimer); this._mjs_reconnectTimer = null; }
  this._mjs_teardown(false, true);    // une requête déjà partie : résultat inconnu
  this._mjs_abandoned     = false;
  this._mjs_abandonWarned = false;
  this._mjs_attempt       = 0;
  this._mjs_wantOpen      = true;
  this._mjs_open();
};

MjsSocket.prototype.destroy = function() {
  // Ref-count : µ.socket(url) partagé incrémente _mjs_refs à chaque détenteur. On ne
  // démonte réellement qu'au DERNIER destroy() ; les autres ne font que relâcher.
  if (this._mjs_refs && --this._mjs_refs > 0) { return; }
  this.close();
  this._mjs_destroyed = true;
  var key = this._mjs_key || this.url;
  if (µ._mjs_sockets[key] === this) { delete µ._mjs_sockets[key]; }
  // les effets en direct qui s'en servaient sans la retenir s'en détachent (et attendent la suivante)
  var drops = this._mjs_fxDrops;
  this._mjs_fxDrops = null;
  if (drops) {
    drops.forEach(function(d) {
      try { d(); } catch (e) { µ.error('[µ.socket] ' + µ._mjs_txt('sockLiveEffect', null, 'effet en direct'), e); }
    });
  }
  // teardown incomplet : destroy() est
  // la fin de vie DÉFINITIVE (connect() refusera désormais tout, cf. sa garde
  // `if (this._mjs_destroyed) return`) — mais 2 restes pouvaient survivre au-delà :
  //   - un timer _mjs_coalesceSend EN VOL rappellerait _mjs_sendNow() plus tard sur
  //     ce socket mort, qui repousserait silencieusement dans _mjs_queue un
  //     message que plus AUCUN _mjs_onWelcome ne rejouera jamais (le timer
  //     maintenant `this` vivant en mémoire via sa closure jusqu'à son terme).
  //   - _mjs_queue elle-même : des messages hors-ligne en attente d'un reconnect
  //     qui, après destroy(), n'arrivera jamais — ils restaient en mémoire
  //     sans aucune chance d'être un jour rejoués.
  // La purge debounce/coalesce est extraite dans _mjs_cancelPending(), partagée avec
  // close() ci-dessus (déjà appelée une 1re fois via this.close()) — 2e appel idempotent,
  // gardé explicite pour que destroy() reste sûr même si close() cesse un jour de la faire
  this._mjs_cancelPending();
  this._mjs_queue = [];
};
