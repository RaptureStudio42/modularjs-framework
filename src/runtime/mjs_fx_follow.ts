// mjs_fx_follow — `*follow` : l'écran du public suit le défilement du présentateur (un cours, une démo,
// une réunion), par la connexion MJS WS de sa variable (`sock: $$sock` ; `@sock` du composant par
// défaut) — le serveur doit avoir le paquet `followPackage` (mjs-ws/follow.ts, son protocole). Posé sur une balise qui défile (overflow) : elle ; sur
// `<@document>` : la page. Qui mène (`lead` à vrai ; une variable, `lead: $presentateur`, se bascule
// en direct) envoie la balise en haut de sa zone visible et où son haut est coupé ; le public y défile
// en douceur — sur un écran d'une autre taille, au même endroit du contenu, comme *cursors — et la
// partie montrée (l'enfant de la zone qui la porte) s'éclaire un instant. Un retardataire arrive à la
// dernière position. Ceux qui suivent voient aussi, de celui qui mène, avec son nom, dans un seul sens
// (comme *cursors) : sa souris (cursor: normal ; pulse : une onde bat à chaque clic), sa sélection
// (selection), la balise active, entourée (focus) — tout, par défaut. Sans connexion, rien ne suit, et
// l'effet le dit en console. Réglages : sock (la variable de la connexion ; @sock), server (une adresse,
// `wss://…` : une connexion à lui), room (le salon ; la page et sa route : il change avec elle), lead (mène ; non), ease (la douceur du suivi : la part du
// chemin faite à chaque image, 1 = d'un coup ; 0.12), glow (la couleur de la partie montrée ;
// rgba(88,166,255,.18) — none : rien), cursor (none, normal, pulse ; pulse), selection (oui), focus
// (oui).

µ._mjs_fxDefs.follow = {
  setup: function(el, s, comp) {
    if (typeof µ._mjs_fxSock !== 'function') {
      µ.error(µ._mjs_msg('followNoCore', null, '*follow : le module socket manque au cœur (réglage runtime)'));
      return function() {};
    }
    var page     = el === document.documentElement;
    var zone     = page ? document.body : el;
    var name     = µ._mjs_fxRoomName(s);
    var sock     = null;
    var room     = null;
    var peers     = {};
    var lead     = s.lead === true;
    var ease     = typeof s.ease === 'number' && s.ease > 0 ? Math.min(1, s.ease) : 0.12;
    var targetEl = null;
    var raf      = 0;
    var shown    = null;
    var sent     = 0;
    var top      = function() { return page ? window.scrollY : el.scrollTop; };
    // chaque pas est instantané : sous `scroll-behavior: smooth` (souvent posé sur <html>), un pas lissé relancerait son animation à chaque image
    var setTop = function(v) {
      if (page) window.scrollTo({ left: window.scrollX, top: v, behavior: 'instant' });
      else el.scrollTo({ top: v, behavior: 'instant' });
    };
    var view = function() { return page ? 0 : µ._mjs_dom.getBoundingClientRect(el).top; };
    // un chemin depuis la zone (rangs des enfants, -1 pour entrer dans un composant) et retour
    var pathOf = function(n) {
      var out = [];
      for (var i = 0; n && n !== zone && i < 64; i++) {
        var p = n.parentNode;
        if (!p) return null;
        out.push(Array.prototype.indexOf.call(p.childNodes, n));
        if (p.nodeType === 11) {
          out.push(-1);
          n = p.host;
        }
        else n = p;
      }
      return n === zone ? out.reverse() : null;
    };
    var nodeAt = function(path) {
      var n = zone;
      for (var i = 0; n && i < path.length; i++) n = path[i] === -1 ? µ._mjs_shadowOf(n) : n.childNodes[path[i]];
      return n && n.nodeType === 1 ? n : null;
    };
    // posée par-dessus le contenu (un en-tête fixe, une barre collante) : elle ne défile pas avec lui ;
    // `seul` : la balise elle-même, sinon elle et ses parents jusqu'à la zone
    var floats = function(e, alone) {
      if (typeof getComputedStyle !== 'function') return false;
      for (var n = e; n && n !== zone && n.nodeType === 1; n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode) {
        var pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
        if (alone) break;
      }
      return false;
    };
    // la balise qui passe sous la ligne y, cherchée dans le contenu par la place de chacun (jusque dans
    // les composants et ce qu'un `<slot>` y montre), sans ce qui flotte : on descend tant qu'un enfant coupe la ligne ; un enfant qui
    // commence plus bas (sa marge coupe la ligne) laisse son parent, sauf au premier rang — la balise
    // qui suit l'espace, un peu au-dessus d'elle
    var under = function(y) {
      var n    = zone;
      var seen = new Map();
      for (var d = 0; d < 32; d++) {
        var hit   = null;
        var start = 0;
        seen.set(n, true);
        for (var k = (µ._mjs_shadowOf(n) || n).firstElementChild; k && !hit; k = k.nextElementSibling) {
          // un `<slot>` cède sa place aux balises qu'il montre (celles qu'il reçoit, sinon son contenu de repli) qu'un chemin depuis la
          // zone atteint, et la garde s'il n'en montre aucune. Une balise a le sort de son parent : chaque balise traversée (ce qu'un slot
          // de son ombre reçoit) et le slot (son repli) sont atteints ; un autre parent est demandé une fois pour tout le parcours : des
          // milliers de slots ou de balises glissées restent un seul parcours
          var g    = [];
          var kids = [];
          if (k.localName === 'slot' && k.assignedElements) {
            g = k.assignedElements({ flatten: true });
            seen.set(k, true);
          }
          for (var j = 0; j < g.length; j++) {
            var p = g[j].parentNode;
            if (!seen.has(p)) seen.set(p, !!pathOf(g[j]));
            if (seen.get(p)) kids.push(g[j]);
          }
          if (!kids.length) kids.push(k);
          for (var m = 0; m < kids.length && !hit; m++) {
            var b = µ._mjs_dom.getBoundingClientRect(kids[m]);
            if (b.bottom > y && (b.width > 0 || b.height > 0) && !floats(kids[m], true)) {
              hit   = kids[m];
              start = b.top;
            }
          }
        }
        if (!hit) break;
        if (start > y) return n === zone ? hit : n;
        n = hit;
      }
      return n === zone ? zone.firstElementChild : n;
    };
    // la balise en haut de la zone visible, jusque dans les composants ; le haut dans un espace entre
    // deux balises (une marge), ou sous une balise qui flotte : la première qui passe sous le haut
    var anchor = function() {
      var r = page ? { left: 0, top: 0, width: window.innerWidth } : µ._mjs_dom.getBoundingClientRect(el);
      var x = r.left + r.width / 2;
      var y = r.top + 2;
      var e = µ._mjs_elementAt(x, y, zone.getRootNode ? µ._mjs_dom.getRootNode(zone) : document);
      return e && e !== zone && pathOf(e) && !floats(e) ? e : under(y);
    };
    // mène : la position part au salon, au plus une fois par image
    var send = function() {
      sent = 0;
      if (!lead || !sock) return;
      var a = anchor();
      var path = a ? pathOf(a) : null;
      if (!path) return;
      var b = µ._mjs_dom.getBoundingClientRect(a);
      // où le haut coupe la balise, en fraction de sa hauteur ; négatif : il tombe dans l'espace qui la précède
      var y = b.height > 0 ? (view() - b.top) / b.height : 0;
      sock.send('follow:at', { room: name, a: path, y: Math.max(-1, Math.min(1, Math.round(y * 10000) / 10000)) }, { coalesce: 60, volatile: true, key: name });
    };
    var onScroll = function() {
      if (lead && !sent) sent = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(send) : (send(), 0);
    };
    // suit : la position reçue devient une cible de défilement, rejointe en douceur ; `seen` : la position
    // à l'image d'avant, `since` : l'heure où elle a cessé de bouger
    var seen  = null;
    var since = 0;
    var glide = function() {
      raf = 0;
      if (targetEl === null) return;
      var before = top();
      var d      = targetEl - before;
      if (Math.abs(d) < 0.5) {
        setTop(targetEl);
        targetEl = null;
        return;
      }
      // la position ne bouge plus depuis une demi-seconde (le bout de la zone, une cible hors d'atteinte ; un
      // défilement en douceur du navigateur, lui, avance toujours) : on s'arrête ; l'heure vient d'une
      // horloge qui ne recule ni ne saute (une heure murale corrigée en route fausserait la demi-seconde)
      var tick = performance.now();
      if (before !== seen) {
        seen    = before;
        since = tick;
      }
      else if (tick - since > 500) {
        targetEl = null;
        return;
      }
      // le navigateur arrondit la position : un pas de moins d'un pixel ne bougerait rien, on avance d'un pixel au moins
      var stepPx = d * ease;
      if (Math.abs(stepPx) < 1) stepPx = Math.abs(d) < 1 ? d : d < 0 ? -1 : 1;
      setTop(before + stepPx);
      raf = requestAnimationFrame(glide);
    };
    // la partie montrée : l'enfant de la zone qui porte la balise, éclairé un instant
    var glow = function(a) {
      // sans animation native (un harnais de test), rien ne s'éclaire
      if (typeof Element !== 'function' || typeof Element.prototype.animate !== 'function') return;
      var part = a;
      while (part && part.parentNode && part.parentNode !== zone) part = part.parentNode.nodeType === 11 ? part.parentNode.host : part.parentNode;
      if (!part || part === shown || s.glow === 'none' || part.nodeType !== 1 || µ._mjs_fxCalm()) return;
      shown = part;
      µ._mjs_animate(part, [{ backgroundColor: s.glow || 'rgba(88,166,255,.18)', offset: 0 }], { duration: 1400, easing: 'ease-out' });
    };
    var go = function(m) {
      if (lead || !m || !Array.isArray(m.a)) return;
      var a = nodeAt(m.a);
      if (!a) return;
      var b    = µ._mjs_dom.getBoundingClientRect(a);
      targetEl = top() + (b.top - view()) + (typeof m.y === 'number' ? m.y : 0) * b.height;
      seen     = null;
      glow(a);
      if (ease >= 1 || µ._mjs_fxCalm() || typeof requestAnimationFrame !== 'function') {
        setTop(targetEl);
        targetEl = null;
      }
      else if (!raf) raf = requestAnimationFrame(glide);
    };
    // la souris (cursor), la sélection (selection) et la balise active (focus) de celui qui mène, par
    // la trousse de *cursors — qui mène les envoie, qui suit les dessine ; tout, par défaut
    var cursor     = s.cursor === void 0 ? 'pulse' : s.cursor;
    var select     = s.selection !== false;
    var active     = s.focus !== false;
    var kit        = null;
    var sendCursor = function(st) { if (sock) sock.send('follow:cursor', { room: name, p: st.p, t: st.t, f: st.f, c: st.c }, { coalesce: 50, volatile: true, key: name }); };
    var arm        = function() {
      var want = { pointer: cursor === 'normal' || cursor === 'pulse', pulse: cursor === 'pulse', text: select, focus: active };
      // la trousse reste quand ce qu'on montre ou le rôle change : les curseurs des autres restent à l'écran
      if (kit) kit.retune(want, lead ? sendCursor : null);
      else if ((want.pointer || want.text || want.focus) && typeof µ._mjs_fxCursorKit === 'function') kit = µ._mjs_fxCursorKit(zone, want, lead ? sendCursor : null);
    };
    arm();
    // la connexion de sa variable (ou celle de `server`) : le salon, les positions, la souris de qui
    // mène, et, pour un retardataire comme après une reconnexion ou un changement de route, la dernière
    // position du salon ; la route change : le salon quitté, celui de la nouvelle page rejoint, la trousse reste
    var unlink = µ._mjs_fxSock(s.sock, s.server, _mjsFollowNoSock(), function(k) {
      sock = k;
      name = µ._mjs_fxRoomName(s);
      // followPackage() seul : personne ne mène — le conseil dit qui peut mener
      µ._mjs_fxPackage(sock, 'follow:', '*follow', 'followPackage', 'followPackage({ canLead: (client) => … })');
      room      = µ._mjs_fxRoom(sock, 'follow:' + name);
      peers      = room.presence();
      var last  = function() { sock.request('follow:last', { room: name }, { waitForOpen: true }).then(function(m) { if (m) go(m); }, function() {}); };
      var offAt = sock.on('follow:at', function(m) { if (m && m.room === name) go(m); });
      // qui mène, absent de la présence du salon (elle refuse `__proto__`, `constructor`, `prototype`) : pas dessiné, le balayage
      // l'ôterait chaque seconde
      var offCur  = sock.on('follow:cursor', function(m) {
        if (lead || !kit || !m || m.room !== name || !m.from || typeof m.from.id !== 'string' || !Object.prototype.hasOwnProperty.call(peers, m.from.id)) return;
        kit.paint(m.from.id, m.from, m.p, m.t, m.f, m.c);
      });
      var offHi   = sock.on('welcome', last);
      // une connexion qui s'ouvre : son `welcome` demande déjà — une seule demande à la première ouverture
      // l'état lu sans le faire suivre (cf. `_mjs_stRaw`, mjs_socket.ts) ; une connexion simulée : son `state`
      var at = (k._mjs_stRaw || k).state;
      if (at !== 'connecting' && at !== 'reconnecting') last();
      return function() {
        offAt();
        offCur();
        offHi();
        room.leave();
        sock     = null;
        room     = null;
        peers     = {};
        targetEl = null;
        if (kit) kit.ids().forEach(function(id) { kit.drop(id); });
      };
    }, { read: µ._mjs_fxVar(el, 'follow', comp), room: s.room ? null : function() { return µ._mjs_fxRoomName(s); } });
    // celui qui mène parti (la présence du salon) : sa souris, sa sélection, sa balise active aussi
    var sweep = setInterval(function() {
      if (sock && kit) kit.ids().forEach(function(id) { if (!Object.prototype.hasOwnProperty.call(peers, id)) kit.drop(id); });
    }, 1000);
    var target = page ? window : el;
    µ._mjs_dom.addEventListener(target, 'scroll', onScroll, { passive: true });
    var stop = function() {
      unlink();
      clearInterval(sweep);
      µ._mjs_dom.removeEventListener(target, 'scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (sent && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(sent);
      if (kit) kit.destroy();
      kit = null;
    };
    // `lead`, `cursor`, `selection`, `focus` tenus par une variable : le rôle ou ce qu'on montre
    // change, l'effet reste (même salon) ; une variable vide, le défaut
    stop.set = function(k, v) {
      if (k === 'cursor') cursor = v === void 0 ? 'pulse' : v;
      else if (k === 'selection') select = v !== false;
      else if (k === 'focus') active = v !== false;
      else if (k === 'lead') {
        lead     = v === true;
        targetEl = null;
      }
      else return false;
      arm();
      // devenu celui qui mène : il ne voit plus la souris d'un autre, celle de l'ancien meneur s'efface
      if (k === 'lead' && lead) {
        if (kit) kit.ids().forEach(function(id) { kit.drop(id); });
        onScroll();
      }
    };
    return stop;
  }
};

var _mjsFollowNoSock = function() { return µ._mjs_msg('followNoSock', null, '*follow n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne suit — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec followPackage côté serveur ; une connexion posée plus tard dans la variable le relance'); };
