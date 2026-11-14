// mjs_every — runes `µevery` (µ.every) et `µafter` (µ.after), minuteries de composant. DÉTACHÉ du cœur : embarqué
// seulement si le projet écrit l'une des deux (`µ.every(`/`µ.after(`, scan du code compilé, cf. bundler/features.ts) — à la
// différence de `µeffect`, aucune macro/directive du compilateur ne l'émet elle-même.
//
// µevery delai, [options], fn — tire une PREMIÈRE fois au départ, puis toutes les `delai` ms.
// µafter delai, [options], [fn] — UN tir après le délai ; sans fonction, rend une promesse : `await µafter 300` attend
// 300 ms ; si le composant quitte la page avant, elle rend la main à son retour, jamais s'il ne revient pas (la suite ne
// tourne pas sur un composant mort), ni au rendu serveur.
// Les deux s'écrivent PARTOUT dans un composant (<script>, gestionnaire, méthode, µeffect, µmount, après un `await`) :
// le compilateur passe le composant en tête de l'appel (`µ.every(_mjsThis, 1000, fn)`, cf. sigils.ts) et la minuterie
// suit SON composant quel que soit le moment de l'appel. Ailleurs (module, magasin), c'est le composant qui s'exécute
// à l'appel (µ.activeComponent) ; hors de tout composant actif (gestionnaire, chargement du module, après un `await`),
// la page (cf. PAGE).
// Posée pendant l'initialisation, la minuterie attend le MONTAGE, pour deux raisons :
//   • SSR — les hooks client ne jouent pas au serveur (µ._isServer) ; une minuterie posée
//     au setup, elle, tournerait DANS le rendu serveur — elle n'y part donc jamais ;
//   • le 1er tir arrive APRÈS le 1er rendu, donc un `{#key}` qui change à ce tir
//     fait jouer la transition d'entrée normalement (sans `.global`).
// Composant déjà monté (gestionnaire, µmount, µeffect) : elle part à l'appel. Au rendu serveur, le composant n'est
// jamais « monté » pour le registre, même initialisé et connecté : posée dans un µeffect ou après un `await`, elle n'y
// part pas davantage (la file du montage n'y joue pas, cf. _mjs_fireMount). Posée sur un composant déjà détruit
// (suite d'un `await` qui reprend après son retrait), elle attend son retour, comme au retrait.
// Rendue par un reffet (écrite en dernier dans un `µeffect`), la main d'arrêt n'est pas son nettoyage : marque
// `_mjs_timer`, lue par les reffets (mjs_element.ts, mjs_effect.ts, mjs_signals.ts) ; la minuterie vit la même vie où
// que soit la ligne, et qui veut l'annuler quand le reffet repart l'écrit (`arret = µafter …` puis `-> arret()`).
// `_mjs_timer` vaut 2 avec `always: true` : rendue par µmount ou par @attach (mjs_lifecycle.ts, generator/attributes),
// cette main-là n'est pas leur nettoyage non plus — le tir part après la disparition ; une autre (1 ou 3) l'est, et
// s'arrête au démontage (µmount, rejoué au retour du composant, en pose une neuve : aucun doublon). 3 : posée pendant un
// passage du µmount, d'une attache ou d'un reffet de son composant, où que soit la ligne (_mjsMarque).
// Le callback n'est PAS un effet : il ne lit aucune dépendance, ne s'abonne à rien.
// Ses écritures `$x` restent RÉACTIVES (l'écran suit) — c'est le tir qui est
// périodique, pas la réactivité.
//
// REGISTRE — chaque composant range ses minuteries vivantes dans UN Set (`_mjs_minuteries`, créé à la première pose) :
// une minuterie y entre à la pose et en sort à son arrêt définitif (tir de µafter, main d'arrêt, `times`, `while`) ; rien
// ne s'accumule sur un composant qui vit longtemps (un `µafter` relancé à chaque frappe n'y laisse rien). Le composant ne
// porte qu'UN nettoyage dans sa liste de destruction, UN rappel dans la file du montage, UN rappel de sommeil et UN de
// réveil pour `pause`, quel que soit le nombre de minuteries. File `_mjs_mount_cbs` (mjs_element.ts) et jamais
// `_mjs_hooks.mount` : la map des hooks n'a qu'UNE case par nom — s'y poser écraserait en silence le `µmount ->` de
// l'utilisateur (piège connu des deux µmount). Idem `_mjs_onSleep`/`_mjs_onAwake` pour `pause: true`.
// Un composant détruit peut revenir dans la page (le cycle de vie rejoue alors le montage) : la minuterie qui tournait
// encore repart à ce montage, là où elle en était (`times` continue son compte, `onStop` est déjà parti pour cet arrêt) ;
// finie ou arrêtée par sa main, elle reste arrêtée. Posée pendant un passage du µmount ou d'un reffet (marque 3), elle
// appartient à ce passage : arrêtée pour de bon au retrait, le passage rejoué au retour la repose — sinon, suspendue
// puis réarmée, elle doublait celle du passage rejoué. Celle d'une attache s'arrête aussi au détachement de la balise, celle
// d'un reffet quand le passage suivant commence et quand le reffet est arrêté par sa main (_mjsDuReffet). Le rechargement à chaud efface le registre avec le reste de l'instance
// (_mjsHotReset, mjs_hotswap.ts) : les minuteries de l'ancienne version ne repartent pas.
//
// NOMS — `id: 'nom'`, un seul espace de noms pour µafter et µevery : poser une minuterie sous un nom pris arrête d'abord
// l'ancienne, comme sa main d'arrêt (onStop compris, `always` aussi), puis pose la neuve, dont la main est rendue ;
// l'ancienne main, appelée après coup, ne touche plus rien. Portée : le composant (Map `noms` de son registre) ; hors
// composant (module, magasin), la page (_mjsNoms). Le nom se libère quand la minuterie sort du registre (tir de µafter,
// main d'arrêt, `times`, `while`, passage suivant d'un reffet) : à sa première minuterie nommée, le registre prend
// _mjsOublier pour `delete` — sans `id`, rien ne change. Une minuterie qui finit pendant sa pose (`times: 1` et son tir
// immédiat, `while` faux, `times: 0`) ne prend pas le nom. Le nom qui change de minuterie reste retenu (_mjsRempl) le temps
// que l'ancienne s'arrête : celle que son onStop pose sous ce nom ne part pas (ni tir ni onStop, aucune boucle). La neuve
// prend le nom en entrant au registre, avant son premier tir (_mjsInscrire) : posée sous ce nom pendant ce tir, une autre la
// remplace, la dernière gagne. Une minuterie de la page s'arrête pour de bon au retrait de son composant (marque 3), ce
// qui libère son nom : la page ne retient jamais un composant détruit. Au rendu serveur, où rien ne part, le nom est
// ignoré.
//
// PAGE — hors de tout composant actif (module ou magasin appelé par un gestionnaire, à son chargement, après un `await`),
// la minuterie vit au niveau de la page : un composant qui ne part jamais (_mjsPage), monté dès le départ, jamais
// endormi, dont les erreurs vont à la console ; au rendu serveur, jamais monté : rien ne part.
//
// COÛT — `µafter delai, fn` sans options (le cas courant) suit un chemin court : UNE fermeture (la main d'arrêt), une
// entrée dans le Set, le setTimeout natif, qui reçoit la main en argument et rappelle un tir PARTAGÉ (aucune fermeture
// par tir) ; ni tableau, ni objet, ni lecture d'options. Les options ne coûtent qu'à qui les écrit. En production, le code
// des noms (blocs `<minuteries-nommees>`) et celui de la page (`<minuteries-page>`) n'entrent au cœur que si un appel en a
// besoin (relevés appel par appel, bundler/features.ts) ; en développement, toujours.
//
// HASH D'OPTIONS — facultatif, ENTRE le délai et la fonction (`µevery 3000, pause: true, ->`) :
//   immediate: false   (µevery) pas de tir au départ : 1er tir après le délai
//   times: n           (µevery) n tirs puis arrêt automatique (0 = ne tire jamais)
//   while: -> cond     (µevery) évalué AVANT chaque tir ; faux ⇒ arrêt, sans tirer
//   pause: true        suspend à la déconnexion du DOM, reprend à la reconnexion (le délai repart de zéro)
//   onStop: ->         appelé UNE seule fois à l'arrêt, quelle qu'en soit la cause
//   always: true       (µafter) le tir part même si le composant a disparu ; la main d'arrêt l'annule toujours
//   id: 'nom'          une seule minuterie de ce nom : la poser arrête d'abord celle qui court encore (cf. NOMS)
// Toute autre clé est un AVERTISSEMENT (faute de frappe muette), et une valeur du
// mauvais type retombe sur le défaut de sa clé : la minuterie tourne quand même.

// signal passé aux mains d'arrêt par le registre, jamais par l'appli (une main appelée sans lui arrête sa minuterie) ;
// second argument : 0 tir (chemin court de µafter), 1 retrait du composant, 2 montage, 3 sommeil, 4 réveil
var _mjsSignal = {};

// la minuterie (ou le registre, au retrait) attend le montage : UN rappel par composant dans la file
var _mjsAttendre = function(comp, s) {
  var q = comp._mjs_mount_cbs || (comp._mjs_mount_cbs = []);
  if (q.indexOf(s.montage) < 0) q.push(s.montage);
  comp._mjs_pendingMount = true;                                // jamais remis à false ailleurs qu'au tir du montage
};

var _mjsRegistre = function(comp) {
  var s = comp._mjs_minuteries = new Set();
  // monté ? lu une fois sur l'instance, puis tenu par le registre : vrai à chaque montage, faux à chaque retrait (le
  // registre se met dans la file du montage dès qu'il ne l'est pas). `_mjs_mounted` n'est posé que si le composant a une
  // file de montage ; un composant sans µmount, connecté et initialisé, est monté lui aussi. Jamais au rendu serveur,
  // où l'instance est connectée et initialisée mais où le montage ne joue pas ; jamais sur un composant déjà détruit
  // (`_mjs_dead`, que son retrait ait joué ou non une destruction) : il attend un retour
  s.monte = !µ._isServer && !comp._mjs_dead && !!(comp._mjs_mounted || comp._mjs_is_mounted && comp._mjs_mjsInitialized);
  // teardown DÉFINITIF (jamais à µsleep) : chaque minuterie s'arrête ; celles qui tournaient encore attendent un retour
  // du composant
  var fin = function() {
    s.monte = false;
    s.forEach(function(main) { main(_mjsSignal, 1); });
    comp._mjs_onDestroy(fin);                                   // la liste de destruction est vidée à chaque retrait
    _mjsAttendre(comp, s);
  };
  s.montage = function() {
    s.monte = true;
    s.forEach(function(main) { main(_mjsSignal, 2); });
  };
  comp._mjs_onDestroy(fin);
  if (!s.monte) _mjsAttendre(comp, s);
  return s;
};

// une exception dans le code utilisateur tuerait la minuterie en silence : on la route vers la frontière d'erreur du
// composant, comme le fait _mjs_runEffectsV2 — sauf sur un composant déjà mort ou crashé, où la frontière n'a plus de sens
var _mjsErreur = function(comp, rune, err) {
  if (typeof comp._mjs_catchError === 'function' && !comp._mjs_has_crashed && !comp._mjs_dead) comp._mjs_catchError(err);
  else µ.warn(µ._mjs_msg('everyError', { rune: rune }, '{rune} :'), err);
};

// Un corps ASYNC (`µevery 3000, -> $x = await sonder()`) rend une promesse : le try/catch qui l'entoure est SYNCHRONE et
// ne voit rien de ce qui rejette APRÈS le premier `await`. Sans ce raccord, l'échec ne partait vers aucune frontière
// d'erreur, `_mjs_has_crashed` restait faux, le timer rejouait indéfiniment — et chaque rejet devenait un
// unhandledRejection (fatal sous Node). Trouvé sur l'exemple vedette de la doc lui-même.
var _mjsAppeler = function(comp, rune, f) {
  try {
    var res = f.call(comp);
    if (res && typeof res.then === 'function') res.then(null, function(err) { _mjsErreur(comp, rune, err); });
  }
  catch (err) { _mjsErreur(comp, rune, err); }
};

// tir partagé du chemin court : le setTimeout natif lui passe la main d'arrêt, qui porte tout le reste
var _mjsTir = function(main) { main(_mjsSignal, 0); };

// arrête les minuteries d'une liste de passage (main appelée sans le signal : arrêt définitif) et la vide
var _mjsArreterTout = function(l) {
  var m;
  while ((m = l.pop()) != null) m();
};

// minuterie posée pendant un passage d'un reffet : elle appartient à ce passage, arrêtée comme un nettoyage quand le passage
// suivant commence, à l'arrêt du reffet par sa main et à la destruction du composant — que le passage rende un nettoyage ou
// non, quel que soit son rang. À la première, le nettoyage du reffet (`cleanup`, que ces trois moments lisent, effacent puis
// jouent : mjs_element.ts, mjs_effect.ts, mjs_signals.ts) devient un accesseur : tant qu'une minuterie d'un passage est
// rangée, il rend une fonction qui les arrête puis joue le nettoyage rendu ; sinon ce nettoyage, tel quel (ou rien)
var _mjsDuReffet = function(e, main) {
  var l = e._mjs_mt;
  if (l == null) {
    var c = e.cleanup;
    l = e._mjs_mt = [];
    Object.defineProperty(e, 'cleanup', {
      configurable: true,
      get: function() {
        var f = c;
        if (l.length === 0) return f;
        return function() {
          _mjsArreterTout(l);
          if (f) return f.apply(this, arguments);
        };
      },
      set: function(v) { c = v; }
    });
  }
  l.push(main);
};

// marque d'une minuterie sans `always` : 3 si elle est posée pendant un passage — d'une attache (µ._mjs_attPass, la
// balise, generator/attributes), d'un reffet de son composant (µ._mjs_effRun, mjs_element.ts ; µ._mjs_sigCur,
// mjs_signals.ts) ou du µmount (µ._mjs_mountPass, mjs_lifecycle.ts) : ce passage, rejoué au retour du composant, la
// repose ; l'attache et le reffet l'arrêtent aussi d'eux-mêmes (détachement ; passage suivant, arrêt du reffet par sa main). 1 ailleurs (gestionnaire,
// méthode, racine du <script>)
var _mjsMarque = function(comp, main) {
  var a = µ._mjs_attPass, e = µ._mjs_effRun, l = comp._mjs_effects;
  if (a != null) (a._mjs_mt || (a._mjs_mt = [])).push(main);
  else if (e != null && l != null && l.indexOf(e) >= 0) _mjsDuReffet(e, main);
  else if (µ._mjs_sigCur != null && µ._mjs_sigOwner === comp) _mjsDuReffet(µ._mjs_sigCur, main);
  else if (µ._mjs_mountPass !== comp) return 1;
  return 3;
};

// fin d'une attache qui a posé des minuteries pendant sa partie synchrone (generator/attributes) : son nettoyage les
// arrête, puis joue celui que l'attache rend (sauf la main d'un `always: true`, marque 2, qui n'en est pas un)
µ._mjs_attStop = function(n, c) {
  var l = n._mjs_mt;
  n._mjs_mt = null;
  return function() {
    _mjsArreterTout(l);
    if (typeof c === 'function' && c._mjs_timer !== 2) return c.apply(this, arguments);
  };
};

// chemin court : `µafter delai, fn` sans options, sur un composant et son registre
var _mjsApres = function(comp, s, delay, fn) {
  var id   = null;
  var fini = false;
  var main = function(m, k) {
    if (m === _mjsSignal) {
      if (k === 0) {                                            // tir
        id = null; fini = true; s.delete(main);
        if (!comp._mjs_has_crashed) _mjsAppeler(comp, 'µafter', fn);   // composant CRASHÉ (frontière d'erreur) : rien ne part
      }
      else if (k === 1) {                                       // retrait : attend un retour du composant…
        if (id != null) { clearTimeout(id); id = null; }
        if (main._mjs_timer === 3) { fini = true; s.delete(main); }   // …sauf posée par un passage, qui la reposera
      }
      else if (k === 2 && id == null) id = setTimeout(_mjsTir, delay, main);   // montage
      return;
    }
    if (fini) return;                                           // main appelée après le tir, ou deux fois
    fini = true; s.delete(main);
    if (id != null) { clearTimeout(id); id = null; }
  };
  // marquée du passage du gestionnaire du gabarit en cours, comme le retrait de `µon` (mjs_on.ts) : une fonction qui
  // finit par `µafter …` rend sa main d'arrêt (retour implicite de CoffeeScript et de Civet) ; rendue ainsi par le
  // gestionnaire (`@click={tard(e)}`), le routeur ne la prend pas pour un gestionnaire et la minuterie part ; rangée
  // puis donnée à un clic suivant (`@click={annuler}`), elle l'arrête ; marquée aussi comme minuterie : rendue par un
  // reffet, elle n'est pas son nettoyage
  main._mjs_born  = µ._mjs_evPass;
  main._mjs_timer = _mjsMarque(comp, main);
  s.add(main);
  if (s.monte) id = setTimeout(_mjsTir, delay, main);           // déjà monté (gestionnaire, µmount, µeffect) : part à l'appel
  return main;                                                  // sinon le registre attend le montage dans sa file
};

// chemin des options (et de µevery)
var _mjsMinuterie = function(comp, delay, opts, fn, une) {
  var rune = une ? 'µafter' : 'µevery';
  if (opts != null && (typeof opts !== 'object' || Array.isArray(opts))) {
    µ.warn(µ._mjs_msg('everyHash', { rune: rune }, '{rune} : le 2e argument est un hash d\'options (« {rune} 3000, pause: true, -> ») — reçu :'), opts);
    opts = null;
  }
  var CLES = une ? ['pause', 'onStop', 'always'] : ['immediate', 'times', 'while', 'pause', 'onStop'];
  // <minuteries-nommees>
  CLES.push('id');
  // </minuteries-nommees>
  var lire = function(cle, type, defaut) {
    if (opts == null || opts[cle] == null || CLES.indexOf(cle) < 0) return defaut;   // option de l'autre rune : déjà signalée inconnue
    if (typeof opts[cle] !== type) {
      µ.warn(µ._mjs_msg('everyOptType', { rune: rune, opt: cle, type: type }, '{rune} : option « {opt} » attendue de type {type}, reçu : '), opts[cle], µ._mjs_txt('everyIgnored', null, '— option ignorée.'));
      return defaut;
    }
    return opts[cle];
  };
  if (opts != null) {
    for (var cle in opts) {
      if (!Object.prototype.hasOwnProperty.call(opts, cle)) continue;   // jamais les clés HÉRITÉES : un objet fabriqué sur un prototype porteur ferait un faux « option inconnue »
      if (CLES.indexOf(cle) < 0) µ.warn(µ._mjs_msg('everyUnknownOpt', { rune: rune, opt: cle, list: CLES.join(', ') }, '{rune} : option inconnue « {opt} ». Options reconnues : {list}.'));
    }
  }
  var always    = lire('always', 'boolean', false);
  var immediate = lire('immediate', 'boolean', !une);
  var pause     = !always && lire('pause', 'boolean', false);   // `always` l'emporte : en pause sur une page évincée, le tir ne partirait jamais
  var whileFn   = lire('while', 'function', null);
  var onStop    = lire('onStop', 'function', null);
  var limite    = une ? 1 : lire('times', 'number', null);
  if (limite != null && !(limite >= 0)) {
    µ.warn(µ._mjs_msg('everyTimes', null, 'µevery : option « times » attendue ≥ 0, reçu :'), limite, µ._mjs_txt('everyIgnored', null, '— option ignorée.'));
    limite = null;
  }
  if (une && !always && !pause && !onStop) return _mjsApres(comp, comp._mjs_minuteries || _mjsRegistre(comp), delay, fn);   // options toutes à leur défaut
  var s       = comp._mjs_minuteries || _mjsRegistre(comp);
  var id      = null;
  var arrete  = false;
  var enPause = false;
  var tirs    = 0;
  var armer   = function() { id = une ? setTimeout(tick, delay) : setInterval(tick, delay); };
  var couper  = function() { if (id != null) { clearInterval(id); id = null; } };   // clearInterval coupe aussi un setTimeout
  var stop = function() {
    if (arrete) return;                                         // `arreter()` puis démontage : onStop ne part qu'UNE fois
    arrete = true;
    couper();
    s.delete(main);
    if (onStop) _mjsAppeler(comp, rune, onStop);
  };
  var tick = function() {
    if (une) id = null;                                         // tir unique : plus rien à couper
    // composant CRASHÉ (frontière d'erreur) : on coupe pour de bon. Sans ça, un tick qui échoue rejoue son erreur à
    // chaque période (39 fois en 200 ms, mesuré) et un µevery sain continue de travailler pour un composant mort —
    // alors que tout le reste du runtime s'arrête sur `_mjs_has_crashed`.
    if (comp._mjs_has_crashed && !always) return stop();
    if (whileFn) {
      var suite;
      try { suite = whileFn.call(comp); }
      catch (err) { _mjsErreur(comp, rune, err); return stop(); }   // condition qui jette = condition qu'on ne sait pas lire : on arrête
      // une condition ASYNC rend une promesse, TOUJOURS vraie : la boucle ne
      // s'arrêterait jamais, en silence. On le dit et on arrête.
      if (suite && typeof suite.then === 'function') {
        suite.then(null, function() {});
        µ.warn(µ._mjs_msg('everyWhileAsync', null, 'µevery : l\'option « while » doit rendre un booléen SYNCHRONE — une fonction async rend une promesse, toujours vraie, et la répétition ne s\'arrêterait jamais. Arrêt.'));
        return stop();
      }
      if (!suite) return stop();
    }
    _mjsAppeler(comp, rune, fn);
    tirs++;                                                     // un tir raté reste un tir : sinon `times: 3` sur une fonction qui jette boucle sans fin
    if (limite != null && tirs >= limite) stop();
  };
  var demarre = function() {
    if (arrete || id != null || enPause || comp._mjs_dead && !always) return;   // déjà partie, ou détruit entre la pose et le montage
    if (limite != null && tirs >= limite) return stop();        // `times: 0`
    if (immediate) tick();
    if (arrete) return;                                         // le 1er tir a pu tout arrêter (`times: 1`, `while` faux) : pas d'intervalle à poser
    armer();
  };
  var main = function(m, k) {
    if (m !== _mjsSignal) return stop();                        // main d'arrêt : `arreter = µevery 1000, ->` puis `arreter()`
    if (k === 1) {
      // retrait du composant (`always` : le départ du composant ne l'arrête pas) ; l'arrêt de ce montage-ci appelle
      // onStop, et la minuterie repartira si le composant revient
      if (arrete || always) return;
      if (main._mjs_timer === 3) return stop();                 // posée par un passage du µmount ou d'un reffet : il la reposera
      arrete = true;                                            // la main d'arrêt appelée par onStop ne double pas l'appel
      couper();
      if (onStop) _mjsAppeler(comp, rune, onStop);
      arrete = false; enPause = false;                          // `enPause` levé : la reprise de µawake ne double pas celle du montage
    }
    else if (k === 2) demarre();
    // suspension à la déconnexion du DOM — c'est ce qui manquait à l'hibernation du pageCache (page parquée, timer qui
    // continuait de tourner hors écran) ; on REPREND au réveil : pas de tir de reprise, la fraction de période déjà
    // écoulée est perdue
    else if (k === 3) { if (pause && !arrete && id != null) { couper(); enPause = true; } }
    else if (k === 4 && pause && !arrete && enPause) { enPause = false; armer(); }
  };
  if (pause && !s.pause) {
    s.pause = true;
    comp._mjs_onSleep(function() { s.forEach(function(m) { m(_mjsSignal, 3); }); });
    comp._mjs_onAwake(function() { s.forEach(function(m) { m(_mjsSignal, 4); }); });
  }
  main._mjs_born  = µ._mjs_evPass;                              // mêmes marques que le chemin court (_mjsApres)
  main._mjs_timer = always ? 2 : _mjsMarque(comp, main);              // 2 : ni µmount ni @attach ne la prennent pour leur nettoyage
  s.add(main);
  // <minuteries-nommees>
  if (_mjsNomme) _mjsInscrire(main);                            // son nom, avant son premier tir (cf. NOMS)
  // </minuteries-nommees>
  if (s.monte || always && comp._mjs_dead && !µ._isServer) demarre();
  return main;
};

// <minuteries-nommees>
// noms de la page : `id:` d'une minuterie posée par un module ou un magasin (rien en tête de l'appel)
var _mjsNoms = new Map();

// `delete` d'un registre qui a porté une minuterie nommée : celle qui en sort pour de bon libère son nom, s'il la désigne
// encore (une neuve du même nom l'a peut-être déjà repris)
var _mjsOublier = function(m) {
  var n = m._mjs_noms;
  if (n && n.get(m._mjs_nom) === m) n.delete(m._mjs_nom);
  return Set.prototype.delete.call(this, m);
};

// main d'un nom qui change de minuterie (cf. NOMS) : le nom la tient le temps que l'ancienne s'arrête ; elle est rendue, et
// ne fait rien, à qui pose sous ce nom pendant ce temps
var _mjsRempl = function() {};

// [noms, nom] de la minuterie en cours de pose : elle le prend en entrant au registre, avant son premier tir (cf. NOMS)
var _mjsNomme    = null;
var _mjsInscrire = function(m) {
  var n       = _mjsNomme;
  _mjsNomme   = null;
  m._mjs_nom  = n[1];
  m._mjs_noms = n[0];
  n[0].set(n[1], m);
  if (n[0] === _mjsNoms) m._mjs_timer |= 2;                     // page : 1 devient 3, arrêtée pour de bon au retrait de son composant (2, `always`, et 3 restent)
};
// </minuteries-nommees>

// <minuteries-page>
// la page (cf. PAGE) : jamais détruite ni endormie, montée dès le départ ; au rendu serveur, le registre ne la croit jamais
// montée (_mjsRegistre)
var _mjsRien = function() {};
var _mjsPage = { _mjs_onDestroy: _mjsRien, _mjs_onSleep: _mjsRien, _mjs_onAwake: _mjsRien, _mjs_mounted: true };
// </minuteries-page>

// <minuteries-avis>
// développement seulement (retiré en production) : ce que le cœur de production garderait — 1, le niveau de la page
// (`<minuteries-vu-page>`) ; 2, le code des noms (`<minuteries-vu-id>`), chacun retiré quand le relevé n'en a pas besoin.
// Une minuterie qu'il ne servirait pas (appel que la construction ne voit pas : script de public/, script extérieur…) part
// ici, mais en production ne partirait pas, ou y perdrait son nom : averti, une fois par sorte (bits 4 et 8)
var _mjsVu = 0;
// <minuteries-vu-page>
_mjsVu |= 1;
// </minuteries-vu-page>
// <minuteries-vu-id>
_mjsVu |= 2;
// </minuteries-vu-id>
// </minuteries-avis>

var _mjsEntree = function(une, c, d, o, f) {
  // composant en tête (code compilé d'un composant) ; sinon celui qui s'exécute à l'appel (module, magasin), à défaut la
  // page, et un nom (`id:`) vaut pour la page
  if (!(c && typeof c._mjs_onDestroy === 'function')) {
    f = o; o = d; d = c; c = µ.activeComponent;
    // <minuteries-avis>
    var hors = !c;
    // </minuteries-avis>
    // <minuteries-page>
    c ||= _mjsPage;
    // </minuteries-page>
    // <minuteries-nommees>
    var noms = _mjsNoms;
    // </minuteries-nommees>
  }
  // signature souple : le hash est au MILIEU, donc absent ⇒ `o` porte la fonction
  if (typeof o === 'function' && f == null) { f = o; o = null; }
  if (!c) {
    return µ.warn(µ._mjs_msg('everyInit', { rune: une ? 'µafter' : 'µevery' }, '{rune} suit un composant : appelé hors de tout composant (module, magasin), il ne fait rien — écrivez setTimeout ou setInterval dans ce code.'));
  }
  // µafter sans fonction : une promesse, tenue au tir — au retour du composant s'il a quitté la page, jamais s'il ne
  // revient pas, ni au rendu serveur
  var promesse = null;
  if (une && f == null && typeof d === 'number') promesse = new Promise(function(tenir) { f = tenir; });
  if (typeof f !== 'function' || typeof d !== 'number' || !(d >= 0)) {
    return µ.warn(µ._mjs_msg('everySyntax', { rune: une ? 'µafter' : 'µevery' }, '{rune} s\'écrit « {rune} 2500, -> » : un délai en millisecondes, puis la fonction.'));
  }
  // au-delà de 2³¹−1 ms (24,8 jours, `Infinity` compris), le navigateur ramène le délai à 0 (Node à 1 ms) : la
  // fonction tournerait en boucle — le délai est borné à cette limite
  if (d > 2147483647) d = 2147483647;
  // <minuteries-avis>
  // l'avis vrai de cet appel : hors de tout composant sans le niveau de la page, il ne ferait rien (1, seul avis : son `id`
  // n'y change rien) ; sinon, nommé sans le code des noms, son `id` serait ignoré (2) — un `id` que les noms prennent, une
  // chaîne non vide (cf. plus bas) : tout autre est ignoré dès maintenant, et signalé. Chaque sorte part une fois, sur le
  // premier appel qu'elle concerne, retenue dans les bits du haut de `_mjsVu` (4, 8) sans toucher à ce que le relevé a vu
  var manque = µ._isServer ? 0 : hors && !(_mjsVu & 1) ? 1 : typeof (o || 0).id === 'string' && o.id && !(_mjsVu & 2) ? 2 : 0;
  if (manque && !(_mjsVu & manque << 2)) {
    _mjsVu |= manque << 2;
    if (manque & 1) µ.warn(µ._mjs_msg('everyUnseen', { rune: une ? 'µafter' : 'µevery' }, '{rune} hors de tout composant : en production, cet appel ne ferait rien — la construction ne le voit pas (script de public/, script extérieur, accès entièrement calculé comme window[k], code exécuté depuis un texte…).'));
    else µ.warn(µ._mjs_msg('everyUnseenId', { rune: une ? 'µafter' : 'µevery' }, '{rune} : en production, l\'option « id » de cet appel serait ignorée — la construction ne le voit pas (script de public/, script extérieur, accès entièrement calculé comme window[k], code exécuté depuis un texte…).'));
  }
  // </minuteries-avis>
  // <minuteries-nommees>
  // `id: 'nom'` : la minuterie de ce nom qui court encore s'arrête d'abord, comme par sa main d'arrêt (cf. NOMS) ; ignoré au
  // rendu serveur, où rien ne part
  var nom = (o || 0).id;
  var s   = c._mjs_minuteries || _mjsRegistre(c);
  if (nom != null && (typeof nom !== 'string' || !nom)) {
    µ.warn(µ._mjs_msg('everyId', { rune: une ? 'µafter' : 'µevery' }, '{rune} : l\'option « id » attend un nom, une chaîne non vide (« {rune} 2000, id: \'sauver\', -> ») — option ignorée, reçu :'), nom);
    nom = null;
  }
  noms = nom && !µ._isServer && (noms || s.noms || (s.noms = new Map()));
  var avant = noms && noms.get(nom);
  // posée sous ce nom par l'onStop de l'ancienne, pendant qu'elle s'arrête : elle ne part pas (ni tir ni onStop), une seule
  // vit, la neuve
  if (avant === _mjsRempl) return promesse || avant;
  if (avant) {
    noms.set(nom, _mjsRempl);                                   // retenu le temps que l'ancienne s'arrête, pas plus
    avant();
    noms.delete(nom);
  }
  if (noms) {
    _mjsNomme = [noms, nom];                                    // pris par la neuve à son entrée au registre (_mjsInscrire)
    s.delete  = _mjsOublier;
  }
  // </minuteries-nommees>
  var main = une && o == null ? _mjsApres(c, c._mjs_minuteries || _mjsRegistre(c), d, f) : _mjsMinuterie(c, d, o, f, une);
  // <minuteries-nommees>
  // chemin court (_mjsApres, aucun tir pendant la pose) : le nom se prend ici ; finie pendant sa pose (`times: 1` et son tir
  // immédiat, `while` faux, `times: 0`), la neuve ne le prend pas
  if (_mjsNomme) {
    if (s.has(main)) _mjsInscrire(main);
    _mjsNomme = null;
  }
  // </minuteries-nommees>
  return promesse || main;
};
µ.every = function(c, d, o, f) { return _mjsEntree(false, c, d, o, f); };
// chemin le plus court : composant qui a déjà son registre, `µafter delai, fn` — une seule lecture sur l'instance
µ.after = function(c, d, o, f) {
  var s = c != null && c._mjs_minuteries;
  if (s && typeof o === 'function' && f === undefined && typeof d === 'number' && d >= 0 && d <= 2147483647) return _mjsApres(c, s, d, o);
  return _mjsEntree(true, c, d, o, f);
};
