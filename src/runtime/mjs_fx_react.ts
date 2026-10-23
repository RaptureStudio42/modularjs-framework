// mjs_fx_react — `*react(❤)` : un clic sur la balise fait partir l'émoji chez tous les visiteurs de la
// page, comme pendant un direct, par la connexion MJS WS de sa scène (`sock: $$sock` ; `@sock` du
// composant par défaut) — le serveur doit avoir le paquet `reactionsPackage` (mjs-ws/reactions.ts,
// son protocole) ; sans connexion, rien ne part, et l'effet le dit en console. Les émojis volent sur une scène : celle de la balise la plus proche qui en
// porte une (`*react(stage: true)` : dans sa boîte), sinon celle de la page (`<@document *react(…)>` :
// tout l'écran) ; un bouton sans scène autour en pose une sur la page, avec ses réglages. La scène
// tient la connexion et le débit. Réglages : emoji (l'émoji ; le texte de la balise), count (combien
// par clic ; 1), stage (la balise est une scène ; non), sock (la variable de la connexion ; @sock),
// server (une adresse, `wss://…` : une connexion à elle), room (le salon : ceux qui se voient ; la page et sa route : il change avec elle), rate (les émojis envoyés par seconde, au plus ; 5, jusqu'à 10 — le serveur a sa
// propre limite, `rateLimit`), direction (où ils vont : up, down, left, right, une diagonale ou un angle ; up
// — ils partent du bord opposé), gravity (la force qui les tire : positive, ils accélèrent, comme une
// chute ; négative, ils freinent, comme lancés ; 0, vitesse constante ; -1), size (la taille d'un
// émoji, en px ; 32), duration (leur trajet ; 2.5s), spread (leur dérive de côté, en px ; 60), height
// (la longueur du trajet, en % de la scène ; 60), max (les émojis à l'écran à la fois ; 40).
// « Réduire les animations » : l'émoji ne vole pas, il apparaît puis s'efface sur place.

µ._mjs_fxDefs.react = {
  css: '[mjs-fx-react-stage]{position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:hidden}'
    + '[mjs-fx-react-stage="zone"]{position:absolute}'
    + '[mjs-fx-react-emoji]{position:absolute;font-size:var(--mjs-react-size,32px);line-height:1;animation:mjs-fx-react var(--mjs-react-duration,2.5s) var(--mjs-fx-react-ease,ease-out) forwards}'
    + '@keyframes mjs-fx-react{0%{transform:translate(-50%,-50%) scale(.6);opacity:0}15%{opacity:1;transform:translate(-50%,-50%) translate(calc(var(--dx,0px) * .05),calc(var(--dy,-300px) * .05)) scale(1.1)}100%{transform:translate(-50%,-50%) translate(var(--dx,0px),var(--dy,-300px)) scale(.9);opacity:0}}'
    + '@keyframes mjs-fx-react-calm{0%,100%{opacity:0}20%,70%{opacity:1}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-react-emoji]{animation-name:mjs-fx-react-calm;transform:translate(-50%,-50%)}}',
  vars: { size: 'px', duration: '' },
  setup: function(el, s, comp) {
    var page = el === document.documentElement;
    if (page || s.stage === true) {
      // la scène de la page arrive après celle qu'un bouton avait posée d'office : celle-ci part (les deux écoutaient la
      // connexion, chaque émoji reçu volait deux fois) ; les boutons trouvent désormais celle de <@document>
      var prior = µ._mjs_fxReactPage;
      var moved = [];
      // une zone posée autour de boutons qui avaient pris la scène d'office : ils passent à la zone, et la scène
      // d'office part quand plus aucun bouton ne s'en sert (sinon chaque émoji reçu volerait dans les deux)
      if (prior && !page) {
        prior.users.forEach(function(u) {
          for (var n = u.el; n; n = n.parentNode || n.host) {
            if (n === el) {
              prior.users.delete(u);
              moved.push(u);
              return;
            }
          }
        });
      }
      if (prior && (page || prior.users.size === 0)) {
        if (page) prior.users.forEach(function(u) { moved.push(u); });
        µ._mjs_fxReactPage = null;
        prior.destroy();
      }
      var own = _mjsReactStage(page ? null : el, s, false, el, comp);
      el._mjs_fxReactStage = own;
      moved.forEach(function(u) {
        own.users.add(u);
        u.st = own;
      });
      // la scène repart : ses boutons en retrouvent une, la page au besoin, sans attendre leur prochain clic (sinon les
      // émojis des autres ne volaient plus chez eux) ; au tour suivant, une scène reposée aussitôt les reprend
      var stop = function() {
        if (el._mjs_fxReactStage === own) el._mjs_fxReactStage = null;
        own.destroy();
        own.users.forEach(function(u) { u.again(); });
      };
      stop.set = own.set;
      return stop;
    }
    var me = { el: el };
    // aucune scène autour : celle de la page, avec les réglages du premier bouton, posée dès le bouton
    // (un visiteur qui n'a pas cliqué voit monter les émojis des autres) et gardée tant qu'un bouton
    // qui s'en sert est là ; le bouton est inscrit à la scène qu'il prend (elle le prévient quand elle repart)
    var rejoint = function() {
      var st = _mjsReactFind(el);
      if (!st) st = µ._mjs_fxReactPage = _mjsReactStage(null, s, true, el, comp);
      st.users.add(me);
      me.st = st;
      return st;
    };
    // après les scènes posées dans le même rendu (<@document *react>, une zone autour)
    var attente = setTimeout(rejoint, 0);
    me.again = function() {
      clearTimeout(attente);
      attente = setTimeout(rejoint, 0);
    };
    var onClick = function() {
      var stage = rejoint();
      var e = s.emoji || (el.textContent || '').trim();
      if (!e) return;
      for (var i = 0; i < (s.count || 1); i++) stage.send(e);
    };
    µ._mjs_dom.addEventListener(el, 'click', onClick);
    var off = function() {
      clearTimeout(attente);
      µ._mjs_dom.removeEventListener(el, 'click', onClick);
      var lazy = µ._mjs_fxReactPage;
      if (lazy && lazy.users.delete(me) && lazy.users.size === 0) {
        µ._mjs_fxReactPage = null;
        lazy.destroy();
      }
      if (me.st) me.st.users.delete(me);
    };
    // l'émoji et leur nombre se lisent au clic : rien à reposer
    off.set = function(k, v) {
      if (k !== 'emoji' && k !== 'count') return false;
      s[k] = v;
    };
    return off;
  }
};

var _mjsReactNoServer = function() { return µ._mjs_msg('reactNoSock', null, '*react n\'a pas de connexion MJS WS : la variable de sa scène (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec reactionsPackage côté serveur ; une connexion posée plus tard dans la variable la relance'); };

// la scène la plus proche d'une balise : une balise ancêtre qui en porte une (à travers les composants),
// puis celle de la page, posée d'office par un bouton
function _mjsReactFind(el) {
  for (var n = el; n; n = n.parentNode || n.host) {
    if (n._mjs_fxReactStage) return n._mjs_fxReactStage;
  }
  return µ._mjs_fxReactPage || null;
}

// la courbe du trajet d'après la gravité : positive, il accélère (ease-in, plus marqué avec la force) ;
// négative, il freine (ease-out) ; 0, vitesse constante
function _mjsReactEase(g) {
  if (!g) return 'linear';
  var t = Math.min(1, Math.abs(g) / 3);
  return g > 0
    ? 'cubic-bezier(' + (0.42 + 0.4 * t).toFixed(2) + ',0,1,' + (1 - 0.6 * t).toFixed(2) + ')'
    : 'cubic-bezier(0,' + (0.6 * t).toFixed(2) + ',' + (0.58 - 0.4 * t).toFixed(2) + ',1)';
}

// une scène : dans la boîte de `host`, ou toute la page (host nul), reliée à la connexion de sa
// variable (ou à celle de `server`) ; sans elle, rien ne part. `own` : posée par un bouton, la scène porte
// elle-même la taille et la durée de ses émojis (sinon, la balise qui la pose les a en variables CSS,
// et les change sur place) ; `el` et `comp` : la balise de l'effet et son composant (la variable de la connexion, relue)
function _mjsReactStage(host, s, own, el, comp) {
  if (typeof µ._mjs_fxSock !== 'function') {
    µ.error(µ._mjs_msg('reactNoCore', null, '*react : le module socket manque au cœur (réglage runtime)'));
    return { users: new Set(), send: function() {}, set: function() {}, destroy: function() {} };
  }
  var page  = !host;
  var nom   = µ._mjs_fxRoomName(s);
  var sock  = null;
  var salon = null;
  if (page) µ._mjs_fxAdopt(document, 'react');
  var restore = page ? function() {} : µ._mjs_fxRelative(host);
  var stage = document.createElement('div');
  stage.setAttribute('mjs-fx-react-stage', page ? 'page' : 'zone');
  stage.setAttribute('aria-hidden', 'true');
  if (own && s.size !== void 0) stage.style.setProperty('--mjs-react-size', s.size + 'px');
  if (own && s.duration !== void 0) stage.style.setProperty('--mjs-react-duration', µ._mjs_fxMs(s.duration, 2500) + 'ms');
  (page ? document.body : host).appendChild(stage);
  var sent = [];
  // un émoji qui part du bord opposé à sa direction, au hasard le long de ce bord (`pres` : près du
  // milieu — celui qu'on vient d'envoyer), et file vers sa direction
  var fly = function(e, pres) {
    while (stage.childNodes.length >= (s.max || 40)) stage.firstChild.remove();
    var i = document.createElement('span');
    i.setAttribute('mjs-fx-react-emoji', '');
    i.textContent = e;
    var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 0));
    var p = { x: -v.y, y: v.x };
    var r = (Math.random() * 2 - 1) * (pres ? 10 : 42);
    var w = stage.clientWidth || (page ? window.innerWidth : 300);
    var h = stage.clientHeight || (page ? window.innerHeight : 300);
    var long = (Math.abs(v.x) * w + Math.abs(v.y) * h) * (s.height || 60) / 100;
    var cote = (Math.random() * 2 - 1) * (s.spread === void 0 ? 60 : s.spread);
    i.style.left = (50 - v.x * 47 + p.x * r).toFixed(1) + '%';
    i.style.top  = (50 - v.y * 47 + p.y * r).toFixed(1) + '%';
    i.style.setProperty('--dx', Math.round(v.x * long + p.x * cote) + 'px');
    i.style.setProperty('--dy', Math.round(v.y * long + p.y * cote) + 'px');
    i.style.setProperty('--mjs-fx-react-ease', _mjsReactEase(s.gravity === void 0 ? -1 : s.gravity));
    stage.appendChild(i);
    // arrivé, il s'en va ; filet large : sa durée a pu changer depuis la pose (variable CSS suivie)
    i.addEventListener('animationend', function() { i.remove(); });
    setTimeout(function() { i.remove(); }, µ._mjs_fxMs(s.duration, 2500) * 4 + 100);
  };
  var unlink = µ._mjs_fxSock(s.sock, s.server, _mjsReactNoServer(), function(k) {
    sock  = k;
    nom   = µ._mjs_fxRoomName(s);
    µ._mjs_fxPackage(sock, 'reactions:', '*react', 'reactionsPackage');
    salon = µ._mjs_fxRoom(sock, 'reactions:' + nom);
    var offFly = sock.on('reactions:send', function(m) {
      if (m && m.room === nom && typeof m.e === 'string') fly(m.e, false);
    });
    return function() {
      offFly();
      salon.leave();
      sock  = null;
      salon = null;
    };
  }, { read: µ._mjs_fxVar(el, 'react', comp), room: s.room ? null : function() { return µ._mjs_fxRoomName(s); } });
  return {
    users: new Set(),
    // l'émoji part au salon et vole tout de suite ici ; au-delà de `rate` par seconde, il ne part pas ;
    // sans connexion, rien
    send: function(e) {
      if (!sock) return;
      var now = Date.now();
      while (sent.length && now - sent[0] >= 1000) sent.shift();
      if (sent.length >= (s.rate || 5)) return;
      sent.push(now);
      sock.send('reactions:send', { room: nom, e: e }, { volatile: true });
      fly(e, true);
    },
    // un réglage de l'allure change sur place ; le serveur, le salon ou la scène : reposée
    set: function(k, v) {
      if (k === 'sock' || k === 'server' || k === 'room' || k === 'stage') return false;
      s[k] = v;
    },
    destroy: function() {
      unlink();
      stage.remove();
      restore();
    }
  };
}
