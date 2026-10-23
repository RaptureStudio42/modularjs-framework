// mjs_fx_cursors — `*cursors` : les curseurs des autres visiteurs de la page, avec leur nom, en
// direct (comme dans Figma ou Google Docs), par la connexion MJS WS de sa variable (`sock: $$sock` ;
// `@sock` du composant par défaut), avec son identité — le serveur doit avoir le paquet
// `cursorsPackage` (mjs-ws/cursors.ts, son protocole). Posé sur `<@document>` : toute la
// page ; sur une balise : ce qui se passe dedans. Chaque visiteur a sa couleur, tirée de son
// identité, et son nom (celui de son identité sur le serveur). Mêmes réglages que *follow pour ce
// qu'on montre — tout, par défaut. Sans connexion, rien ne part, et l'effet le dit en console.
// Réglages : sock (la variable de la connexion ; @sock), server (une adresse, `wss://…` : une connexion
// à lui), max (les curseurs à l'écran à la fois : ceux qui ont bougé le plus récemment ; 20), room (le salon :
// ceux qui s'y voient ; la page et sa route : il change avec elle), cursor (none, normal : la souris, pulse : la souris et une onde à
// chaque clic ; pulse), selection (le curseur de texte et la sélection — dans un texte, dans un
// champ ; oui), focus (la balise active, entourée ; oui).
// Un point se dit par le chemin de sa balise depuis la zone de l'effet (les rangs des enfants, -1
// pour entrer dans un composant) et sa place dans la boîte, en fractions : sur deux écrans de
// tailles différentes, le curseur tombe au même endroit du contenu. Rien n'est envoyé d'un champ
// mot de passe ; le texte lui-même ne part jamais, seulement des positions.

µ._mjs_fxDefs.cursors = {
  css: '[mjs-fx-cursors-layer]{position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden}'
    + '[mjs-fx-cursor]{position:absolute;left:0;top:0;color:var(--c);transition:transform var(--mjs-fx-cursor-glide,.25s) linear}'
    + '[mjs-fx-cursor] svg{display:block;width:18px;height:18px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}'
    + '[mjs-fx-cursors-layer] b{position:absolute;padding:2px 6px;border-radius:4px;background:var(--c);color:#fff;font:600 11px/1.3 system-ui,sans-serif;white-space:nowrap}'
    + '[mjs-fx-cursor] b{left:14px;top:16px}'
    + '[mjs-fx-cursor-caret]{position:absolute;width:2px;background:var(--c)}'
    + '[mjs-fx-cursor-caret] b{left:0;bottom:100%;border-radius:4px 4px 4px 0}'
    + '[mjs-fx-cursor-sel]{position:absolute;background:var(--c);opacity:.22;border-radius:2px}'
    + '[mjs-fx-cursor-field]{position:absolute;box-sizing:border-box;border:2px solid var(--c);border-radius:4px}'
    + '[mjs-fx-cursor-focus]{position:absolute;box-sizing:border-box;border:2px solid var(--c);border-radius:6px;box-shadow:0 0 0 4px var(--c2)}'
    + '[mjs-fx-cursor-pulse]{position:absolute;width:40px;height:40px;margin:-20px 0 0 -20px;box-sizing:border-box;border:3px solid var(--c);border-radius:50%;background:var(--c2);animation:mjs-fx-cursor-pulse .7s ease-out forwards}'
    + '@keyframes mjs-fx-cursor-pulse{from{transform:scale(.25);opacity:1}to{transform:scale(1.6);opacity:0}}'
    + '@keyframes mjs-fx-cursor-fade{from{opacity:1}to{opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-cursor]{transition:none}[mjs-fx-cursor-pulse]{animation-name:mjs-fx-cursor-fade}}',
  setup: function(el, s, comp) {
    if (typeof µ._mjs_fxSock !== 'function') {
      µ.error(µ._mjs_msg('cursorsNoCore', null, '*cursors : le module socket manque au cœur (réglage runtime)'));
      return function() {};
    }
    var zone   = el === document.documentElement ? document.body : el;
    var nom    = µ._mjs_fxRoomName(s);
    var sock   = null;
    var salon  = null;
    var gens   = {};
    var moi    = null;
    var cursor = s.cursor === void 0 ? 'pulse' : s.cursor;
    var select = s.selection !== false;
    var active = s.focus !== false;
    // ce qu'on fait et ce qu'on montre des autres : regroupé, dans la part du débit des effets en direct
    // (4 fois par seconde par défaut) ; quand ce qu'on montre change, la trousse reste (les curseurs des
    // autres restent à l'écran), seuls ses réglages changent ; rien n'est posé si rien n'est montré
    var kit   = null;
    var envoi = function(st) { if (sock) sock.send('cursors:move', { room: nom, p: st.p, t: st.t, f: st.f, c: st.c }, { coalesce: 50, volatile: true, key: nom }); };
    var arme  = function() {
      var want = { pointer: cursor === 'normal' || cursor === 'pulse', pulse: cursor === 'pulse', text: select, focus: active };
      if (kit) kit.retune(want, envoi);
      else if (want.pointer || want.text || want.focus) kit = µ._mjs_fxCursorKit(zone, want, envoi);
    };
    arme();
    // au plus `max` curseurs à l'écran : ceux qui ont bougé le plus récemment — un nouveau prend la
    // place de celui qui a bougé le moins récemment
    var max     = typeof s.max === 'number' && s.max >= 1 ? s.max : 20;
    // par identité, sans prototype : une identité `__proto__` ou `constructor` y reste une clé comme une autre
    var recents = Object.create(null);
    var borne   = function(garde) {
      if (!kit) return;
      var ids = kit.ids();
      while (ids.length > max || (garde && ids.length >= max && ids.indexOf(garde) < 0)) { // eslint-disable-line no-unmodified-loop-condition -- le paramètre garde (l'id à épargner) est invariant par construction : la sortie se fait par ids, relu à chaque tour
        var vieux = null;
        for (var i = 0; i < ids.length; i++) {
          if (ids[i] !== garde && (vieux === null || (recents[ids[i]] || 0) < (recents[vieux] || 0))) vieux = ids[i];
        }
        if (vieux === null) break;
        kit.drop(vieux);
        delete recents[vieux];
        ids = kit.ids();
      }
    };
    // un visiteur absent de la présence du salon (elle refuse `__proto__`, `constructor`, `prototype`) n'est pas dessiné : le
    // balayage l'ôterait chaque seconde, il clignoterait
    var onMove = function(m) {
      if (!kit || !m || m.room !== nom || !m.from || typeof m.from.id !== 'string' || m.from.id === moi || !Object.prototype.hasOwnProperty.call(gens, m.from.id)) return;
      borne(m.from.id);
      recents[m.from.id] = Date.now();
      kit.paint(m.from.id, m.from, m.p, m.t, m.f, m.c);
    };
    // dans un salon de beaucoup de visiteurs, le serveur regroupe les positions : une trame par quart
    // de seconde, nos `max` plus récentes (la plus récente en tête)
    var onMoves = function(m) {
      if (!m || m.room !== nom || !Array.isArray(m.list)) return;
      for (var i = m.list.length - 1; i >= 0; i--) onMove(m.list[i]);
    };
    // la connexion de sa variable (ou celle de `server`) : le salon, soi (ne pas se montrer — redemandé
    // à chaque reconnexion et à chaque changement de route), les autres ; la route change : le salon quitté,
    // celui de la nouvelle page rejoint, la trousse reste (sans les curseurs de l'ancien salon)
    var unlink = µ._mjs_fxSock(s.sock, s.server, _mjsCursorsNoSock(), function(k) {
      sock  = k;
      nom   = µ._mjs_fxRoomName(s);
      µ._mjs_fxPackage(sock, 'cursors:', '*cursors', 'cursorsPackage');
      salon = µ._mjs_fxRoom(sock, 'cursors:' + nom);
      gens  = salon.presence();
      var soi      = function() { sock.request('cursors:me', { max: max }, { waitForOpen: true }).then(function(r) { moi = r && r.id; }, function() {}); };
      var offMove  = sock.on('cursors:move', onMove);
      var offMoves = sock.on('cursors:moves', onMoves);
      var offHi    = sock.on('welcome', soi);
      // une connexion qui s'ouvre : son `welcome` demande déjà — une seule demande à la première ouverture
      if (k.state !== 'connecting' && k.state !== 'reconnecting') soi();
      return function() {
        offMove();
        offMoves();
        offHi();
        salon.leave();
        sock    = null;
        salon   = null;
        gens    = {};
        recents = Object.create(null);
        if (kit) kit.ids().forEach(function(id) { kit.drop(id); });
      };
    }, { read: µ._mjs_fxVar(el, 'cursors', comp), room: s.room ? null : function() { return µ._mjs_fxRoomName(s); } });
    // un visiteur parti (la présence du salon) : son curseur aussi
    var sweep = setInterval(function() {
      if (sock && kit) kit.ids().forEach(function(id) {
        if (Object.prototype.hasOwnProperty.call(gens, id)) return;
        kit.drop(id);
        delete recents[id];
      });
    }, 1000);
    var stop = function() {
      unlink();
      clearInterval(sweep);
      if (kit) kit.destroy();
      kit = null;
    };
    // `cursor`, `selection`, `focus` tenus par une variable : ce qu'on montre change, l'effet reste
    // (même salon) ; une variable vide, le défaut
    stop.set = function(k, v) {
      if (k === 'max') {
        max = typeof v === 'number' && v >= 1 ? v : 20;
        borne(null);
        if (sock) sock.request('cursors:me', { max: max }, { waitForOpen: true }).then(function() {}, function() {});
        return;
      }
      if (k === 'cursor') cursor = v === void 0 ? 'pulse' : v;
      else if (k === 'selection') select = v !== false;
      else if (k === 'focus') active = v !== false;
      else return false;
      arme();
    };
    return stop;
  }
};

var _mjsCursorsNoSock = function() { return µ._mjs_msg('cursorsNoSock', null, '*cursors n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec cursorsPackage côté serveur ; une connexion posée plus tard dans la variable le relance'); };

// le parent d'un nœud, un shadow root traversé par son hôte
function _mjsCursorsUp(n) {
  return n.parentElement || (n.parentNode && n.parentNode.host) || null;
}

// les ancêtres dont la découpe atteint vraiment une balise, du plus proche au plus lointain, les shadow
// roots traversés par leur hôte ; <html> et <body> n'en sont pas (leur overflow passe à la fenêtre) et un
// ancêtre sans boîte (display: contents) ne découpe rien. Une balise `fixed` n'est découpée que par ce qui
// la retient (une transformation, un filtre, un confinement…), une balise `absolute` par son bloc conteneur (le
// premier ancêtre positionné, ou qui la retient) et par ceux qui le contiennent — les ancêtres d'entre elle et lui
// ne la touchent pas ; la même règle, de proche en proche, pour chaque ancêtre `absolute` ou `fixed` rencontré
function _mjsCursorsReach(el) {
  var out = [];
  var pos = getComputedStyle(el).position;
  for (var n = _mjsCursorsUp(el); n && n !== document.body && n !== document.documentElement; n = _mjsCursorsUp(n)) {
    var cs = getComputedStyle(n);
    if (cs.display === 'contents') continue;
    if ((pos === 'fixed' || pos === 'absolute') && !(µ._mjs_fxHoldsFixed(cs) || (pos === 'absolute' && cs.position !== 'static'))) continue;
    out.push(n);
    pos = cs.position;
  }
  return out;
}

// la trousse des curseurs d'une zone, partagée par *cursors et *follow : ce qu'on y montre (écouté si
// `envoi` est donné, rappelé à chaque changement avec { p, t, f, c }), et le dessin de ceux des
// autres (paint, drop). `want` : pointer (la souris, p), pulse (une onde à chaque clic : c, le compte
// des clics), text (la sélection, t), focus (la balise active, f). `retune(want, envoi)` : ce qu'on
// montre ou le rôle change — les curseurs des autres restent à l'écran, le compte des clics aussi, et ce
// qu'on cesse de partager repart « à vide » (p, t, f nuls) pour ne rien laisser de figé chez eux
µ._mjs_fxCursorKit = function(zone, want, envoi) {
  µ._mjs_fxAdopt(document, 'cursors');
  var sender = envoi;
  // les autres, par identité, sans prototype : une identité `__proto__` ou `constructor` (un pseudo choisi par le visiteur) y est
  // une clé comme une autre, elle ne touche ni aux objets de la page ni à la fonction Object
  var peers  = Object.create(null);
  var ptr    = null;
  var txt    = null;
  var foc    = null;
  var clicks = 0;
  var raf    = 0;
  // à repeindre à la prochaine image : les autres dont un message est arrivé (dirty) ; tous (all) après un défilement, un
  // redimensionnement, un changement de ce qu'on montre — et au plus une fois par seconde (full : le dernier), une page qui change sous
  // un curseur immobile le recale
  var dirty  = Object.create(null);
  var all    = false;
  var full   = 0;
  var layer  = document.createElement('div');
  layer.setAttribute('mjs-fx-cursors-layer', '');
  layer.setAttribute('aria-hidden', 'true');
  // la souris d'un autre glisse d'une position reçue à la suivante, au rythme de la part du débit des
  // effets en direct (4 positions par seconde par défaut : 250 ms)
  layer.style.setProperty('--mjs-fx-cursor-glide', Math.round(1000 / (typeof µ._mjs_fxRate === 'function' ? µ._mjs_fxRate() : 4)) + 'ms');
  document.body.appendChild(layer);

  // ---- les positions : chemins depuis la zone
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
    for (var i = 0; n && i < path.length; i++) n = path[i] === -1 ? n._shadow || n.shadowRoot : n.childNodes[path[i]];
    return n || null;
  };
  // la balise la plus profonde sous un point, jusque dans les composants (µ.elementAt)
  var deep = function(x, y) { return µ.elementAt(x, y); };
  var frac = function(v) { return v < 0 ? 0 : v > 1 ? 1 : Math.round(v * 10000) / 10000; };

  // ---- envoyer : le pointeur, le texte, la balise active et les clics ensemble, regroupés (la part du
  // débit des effets en direct : 4 fois par seconde par défaut)
  var send = function() { if (sender) sender({ p: ptr, t: txt, f: foc, c: clicks }); };
  var last = null;
  var onPointer = function(e) {
    if (!want.pointer) return;
    last = { clientX: e.clientX, clientY: e.clientY };
    var t = deep(e.clientX, e.clientY);
    var a = t && t.getBoundingClientRect ? pathOf(t) : null;
    if (!a) {
      if (ptr) { ptr = null; send(); }
      return;
    }
    var r = µ._mjs_dom.getBoundingClientRect(t);
    ptr = { a: a, x: frac(r.width ? (e.clientX - r.left) / r.width : 0), y: frac(r.height ? (e.clientY - r.top) / r.height : 0) };
    send();
  };
  // un clic dans la zone : compté, avec la place de la souris — chez qui suit, une onde
  var onDown = function(e) {
    if (!want.pulse) return;
    onPointer(e);
    if (!ptr) return;
    clicks++;
    send();
  };
  // la souris sort de la fenêtre
  var onOut = function(e) {
    if (e.relatedTarget || !ptr) return;
    ptr = null;
    last = null;
    send();
  };
  // la page défile sous une souris immobile : ce qu'elle montre a changé
  var onScrolled = function() { if (last && ptr) onPointer(last); };
  // la balise active, jusque dans les composants
  var active = function() {
    var a = document.activeElement;
    for (var sh = a && (a._shadow || a.shadowRoot); sh && sh.activeElement; sh = a._shadow || a.shadowRoot) a = sh.activeElement;
    return a;
  };
  var onFocus = function() {
    if (!want.focus) return;
    var a = active();
    // un champ mot de passe ne livre rien, pas même sa place
    var f = a && a !== document.body && a !== document.documentElement && !(a.localName === 'input' && a.type === 'password') ? pathOf(a) : null;
    if (JSON.stringify(f) === JSON.stringify(foc)) return;
    foc = f;
    send();
  };
  // la sélection de la page, jusque dans les composants : sans la liste de leurs shadow roots, un
  // bout de sélection qui y entre s'arrête à la balise du composant — on descend alors dans le
  // sien, et on redemande (un niveau par tour)
  var composed = function(sel) {
    var roots = [];
    for (var tour = 0; tour < 8; tour++) {
      var r = null;
      try {
        r = sel.getComposedRanges({ shadowRoots: roots })[0];
      }
      catch (e) {
        try { r = sel.getComposedRanges.apply(sel, roots)[0]; } catch (e2) { return null; }
      }
      if (!r) return null;
      var plus = false;
      var ends = [[r.startContainer, r.startOffset, 0], [r.endContainer, r.endOffset, -1]];
      for (var i = 0; i < 2; i++) {
        var c  = ends[i][0];
        var h  = c.nodeType === 1 || c.nodeType === 11 ? c.childNodes[ends[i][1] + ends[i][2]] : null;
        var sh = h && (h._shadow || h.shadowRoot);
        if (sh && roots.indexOf(sh) < 0) {
          roots.push(sh);
          plus = true;
        }
      }
      if (!plus) return r;
    }
    return null;
  };
  // le texte : le champ actif (sa sélection), sinon la sélection de la page — un simple curseur
  // de texte hors d'une zone modifiable ne compte pas
  var readText = function() {
    var a = active();
    if (a && (a.localName === 'textarea' || (a.localName === 'input' && /^(text|search|email|url|tel|number|)$/.test(a.type || ''))) && typeof a.selectionStart === 'number') {
      var fa = pathOf(a);
      return fa ? { k: 'f', a: fa, s: a.selectionStart, e: a.selectionEnd } : null;
    }
    var sel = document.getSelection ? document.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return null;
    var r = typeof sel.getComposedRanges === 'function' ? composed(sel) : null;
    if (!r) r = sel.getRangeAt(0);
    if (!r) return null;
    if (r.collapsed) {
      var host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
      if (!host || !host.isContentEditable) return null;
    }
    var sa = pathOf(r.startContainer);
    var sb = pathOf(r.endContainer);
    if (!sa || !sb) return null;
    // b : là où est le curseur de texte (la fin, sauf sélection faite à reculons)
    return sel.direction === 'backward' ? { k: 'r', a: sb, ao: r.endOffset, b: sa, bo: r.startOffset } : { k: 'r', a: sa, ao: r.startOffset, b: sb, bo: r.endOffset };
  };
  var onText = function() {
    if (!want.text) return;
    var t = readText();
    if (JSON.stringify(t) === JSON.stringify(txt)) return;
    txt = t;
    send();
  };

  // ---- recevoir, dessiner
  var colorOf = function(id, alpha) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ' 75% 45%' + (alpha ? ' / ' + alpha : '') + ')';
  };
  var box = function(d, attr, x, y, w, h) {
    var b = document.createElement('i');
    b.setAttribute(attr, '');
    b.style.left   = Math.round(x) + 'px';
    b.style.top    = Math.round(y) + 'px';
    if (w !== null) b.style.width = Math.round(w) + 'px';
    b.style.height = Math.round(h) + 'px';
    d.marks.push(b);
    d.wrap.appendChild(b);
    return b;
  };
  // le point d'un rang dans un texte
  var caretAt = function(n, off) {
    var r = document.createRange();
    try {
      if (n.nodeType === 3) {
        var o = Math.min(off, n.length);
        r.setStart(n, o > 0 ? o - 1 : 0);
        r.setEnd(n, o > 0 ? o : Math.min(1, n.length));
        var q = µ._mjs_dom.getBoundingClientRect(r);
        return { x: o > 0 ? q.right : q.left, y: q.top, h: q.height };
      }
      var c = n.childNodes[Math.min(off, n.childNodes.length - 1)] || n;
      var z = (c.nodeType === 1 ? c : n).getBoundingClientRect();
      return { x: z.left, y: z.top, h: z.height };
    }
    catch (e) {
      return null;
    }
  };
  // le point d'un rang dans un champ : un double invisible du champ (même police, mêmes marges), le
  // texte jusqu'au rang, puis un repère
  var FIELD = ['boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize'];
  var caretInField = function(f, pos) {
    var cs = getComputedStyle(f);
    var m  = document.createElement('div');
    for (var i = 0; i < FIELD.length; i++) m.style[FIELD[i]] = cs[FIELD[i]];
    m.style.position   = 'absolute';
    m.style.visibility = 'hidden';
    m.style.overflow   = 'hidden';
    m.style.whiteSpace = f.localName === 'textarea' ? 'pre-wrap' : 'pre';
    m.textContent = String(f.value).slice(0, pos);
    var mark = document.createElement('span');
    mark.textContent = String(f.value).slice(pos) || '.';
    m.appendChild(mark);
    layer.appendChild(m);
    var fr = µ._mjs_dom.getBoundingClientRect(f);
    var x  = fr.left + (parseFloat(cs.borderLeftWidth) || 0) + mark.offsetLeft - f.scrollLeft;
    var y  = fr.top + (parseFloat(cs.borderTopWidth) || 0) + mark.offsetTop - f.scrollTop;
    var h  = mark.offsetHeight || parseFloat(cs.fontSize) * 1.2;
    m.remove();
    return { x: x, y: y, h: h };
  };
  // une onde, là où a cliqué celui qu'on voit : elle s'en va seule
  var pulse = function(d, x, y) {
    var o = document.createElement('i');
    o.setAttribute('mjs-fx-cursor-pulse', '');
    o.style.left = x + 'px';
    o.style.top  = y + 'px';
    d.wrap.appendChild(o);
    setTimeout(function() { o.remove(); }, 750);
  };
  var paint = function(id, pr) {
    var d = pr.dom;
    if (!d) {
      d = pr.dom = { wrap: document.createElement('div'), cur: document.createElement('div'), marks: [] };
      d.wrap.style.setProperty('--c', colorOf(id));
      d.wrap.style.setProperty('--c2', colorOf(id, 0.25));
      d.cur.setAttribute('mjs-fx-cursor', '');
      d.cur.innerHTML = '<svg viewBox="0 0 18 18"><path d="M2 1.5l6 15 2.4-6.1 6.1-2.4z" fill="currentColor" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg><b></b>';
      d.wrap.appendChild(d.cur);
      layer.appendChild(d.wrap);
    }
    var name = pr.from.name || id;
    d.cur.lastChild.textContent = name;
    // la souris
    var n = pr.p && want.pointer ? nodeAt(pr.p.a) : null;
    var x = 0;
    var y = 0;
    if (n && n.getBoundingClientRect) {
      var r = µ._mjs_dom.getBoundingClientRect(n);
      x = Math.round(r.left + pr.p.x * r.width);
      y = Math.round(r.top + pr.p.y * r.height);
      d.cur.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      d.cur.hidden = false;
    }
    else d.cur.hidden = true;
    // un clic : l'onde, sous la souris
    if (pr.beat) {
      pr.beat = false;
      if (want.pulse && !d.cur.hidden) pulse(d, x, y);
    }
    // le texte et la balise active : leurs marques refaites
    for (var i = 0; i < d.marks.length; i++) d.marks[i].remove();
    d.marks = [];
    // la balise active : un anneau autour d'elle, à l'arrondi de ses coins
    var fo = want.focus && pr.f ? nodeAt(pr.f) : null;
    if (fo && fo.nodeType === 1 && fo.getBoundingClientRect) {
      var q = µ._mjs_dom.getBoundingClientRect(fo);
      if (q.width || q.height) {
        var ring = box(d, 'mjs-fx-cursor-focus', q.left - 3, q.top - 3, q.width + 6, q.height + 6);
        var arc  = parseFloat(getComputedStyle(fo).borderTopLeftRadius);
        if (arc > 0) ring.style.borderRadius = Math.round(arc + 3) + 'px';
      }
    }
    else fo = null;
    // le texte : ses bandes, son curseur et le nom
    var t = want.text ? pr.t : null;
    if (!t) return;
    var c = null;
    if (t.k === 'f') {
      var f = nodeAt(t.a);
      if (!f || !f.getBoundingClientRect || typeof f.value !== 'string') return;
      // le champ entouré, sauf si l'anneau de la balise active l'entoure déjà
      if (f !== fo) {
        var fr = µ._mjs_dom.getBoundingClientRect(f);
        box(d, 'mjs-fx-cursor-field', fr.left, fr.top, fr.width, fr.height);
      }
      c = caretInField(f, Math.min(t.e, f.value.length));
    }
    else {
      var a = nodeAt(t.a);
      var b = nodeAt(t.b);
      if (!a || !b) return;
      var len = function(x) { return x.nodeType === 3 ? x.length : x.childNodes.length; };
      var rg  = document.createRange();
      try {
        rg.setStart(a, Math.min(t.ao, len(a)));
        rg.setEnd(b, Math.min(t.bo, len(b)));
        // une sélection faite à reculons : le début est après la fin
        if (rg.collapsed && (a !== b || t.ao !== t.bo)) {
          rg.setStart(b, Math.min(t.bo, len(b)));
          rg.setEnd(a, Math.min(t.ao, len(a)));
        }
        var rs = rg.getClientRects();
        for (var k = 0; k < rs.length && k < 32; k++) if (rs[k].width > 0) box(d, 'mjs-fx-cursor-sel', rs[k].left, rs[k].top, rs[k].width, rs[k].height);
      }
      catch (e) { /* une page qui a changé depuis : les bandes attendront */ }
      c = caretAt(b, t.bo);
    }
    if (!c) return;
    var caret = box(d, 'mjs-fx-cursor-caret', c.x, c.y, null, c.h || 16);
    var label = document.createElement('b');
    label.textContent = name;
    caret.appendChild(label);
  };
  // une zone qui découpe son contenu (une balise qui défile), ou posée dans une qui la contient et qui
  // découpe : ce qu'on y dessine aussi — rien ne déborde de leur boîte visible commune (une balise sortie
  // de la vue en défilant) ; seuls comptent les parents qui contiennent vraiment la zone (une zone fixe ou
  // absolue peut leur échapper) ; le calque mesure la fenêtre sans ses barres de défilement (clientWidth,
  // clientHeight)
  var clip = function() {
    if (zone === document.body || typeof getComputedStyle !== 'function') return;
    var visible = null;
    var chain   = [zone].concat(_mjsCursorsReach(zone));
    for (var i = 0; i < chain.length; i++) {
      var cs = getComputedStyle(chain[i]);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      var z = µ._mjs_dom.getBoundingClientRect(chain[i]);
      visible = visible ? { top: Math.max(visible.top, z.top), right: Math.min(visible.right, z.right), bottom: Math.min(visible.bottom, z.bottom), left: Math.max(visible.left, z.left) } : { top: z.top, right: z.right, bottom: z.bottom, left: z.left };
    }
    if (!visible) {
      layer.style.clipPath = '';
      return;
    }
    var docEl = document.documentElement;
    var v     = [visible.top, (docEl.clientWidth || window.innerWidth) - visible.right, (docEl.clientHeight || window.innerHeight) - visible.bottom, visible.left].map(function(x) { return Math.max(0, Math.round(x)) + 'px'; });
    layer.style.clipPath = 'inset(' + v.join(' ') + ')';
  };
  var draw = function(now) {
    raf = 0;
    clip();
    if (!(now - full < 1000)) all = true;
    if (all) full = now;
    for (var id in peers) {
      if (all || dirty[id]) paint(id, peers[id]);
    }
    dirty = Object.create(null);
    all   = false;
  };
  // un identifiant : ce curseur ; rien (ou l'évènement d'un redimensionnement) : tous
  var ask = function(id) {
    if (typeof id === 'string') dirty[id] = true;
    else all = true;
    if (!raf) raf = requestAnimationFrame(draw);
  };
  // un défilement ne sort pas du composant où il a lieu : chaque racine de composant, de la zone au
  // document (lui, par la fenêtre)
  var roots = [];
  for (var rt = zone.getRootNode ? µ._mjs_dom.getRootNode(zone) : document; rt && rt !== document && roots.indexOf(rt) < 0; rt = rt.host && rt.host.getRootNode ? µ._mjs_dom.getRootNode(rt.host) : null) roots.push(rt);
  var onScroll = function() {
    ask();
    if (sender) onScrolled();
  };
  var drop = function(id) {
    var pr = peers[id];
    if (pr && pr.dom) pr.dom.wrap.remove();
    delete peers[id];
  };
  var capture = { capture: true, passive: true };
  var textes  = ['input', 'keyup', 'pointerup', 'focusin', 'focusout'];
  var actifs  = ['focusin', 'focusout'];
  // les écouteurs de qui partage : posés tant qu'il y a un envoi
  var listening = false;
  var attach    = function() {
    if (listening || !sender) return;
    listening = true;
    document.addEventListener('pointermove', onPointer, capture);
    document.addEventListener('pointerdown', onDown, capture);
    document.addEventListener('mouseout', onOut, capture);
    document.addEventListener('selectionchange', onText);
    textes.forEach(function(ev) { document.addEventListener(ev, onText, capture); });
    actifs.forEach(function(ev) { document.addEventListener(ev, onFocus, capture); });
  };
  var detach = function() {
    if (!listening) return;
    listening = false;
    document.removeEventListener('pointermove', onPointer, capture);
    document.removeEventListener('pointerdown', onDown, capture);
    document.removeEventListener('mouseout', onOut, capture);
    document.removeEventListener('selectionchange', onText);
    textes.forEach(function(ev) { document.removeEventListener(ev, onText, capture); });
    actifs.forEach(function(ev) { document.removeEventListener(ev, onFocus, capture); });
  };
  attach();
  roots.forEach(function(r) { µ._mjs_dom.addEventListener(r, 'scroll', onScroll, capture); });
  window.addEventListener('scroll', onScroll, capture);
  window.addEventListener('resize', ask);
  // et dans les composants de la page (un panneau qui défile) : relayé par le cœur
  if (µ._mjs_scrollSubs) µ._mjs_scrollSubs.add(onScroll);
  return {
    paint: function(id, from, p, t, f, c) {
      var pr = peers[id] || (peers[id] = { dom: null, c: null });
      pr.from = from;
      pr.p    = p || null;
      pr.t    = t || null;
      pr.f    = f || null;
      // un clic : le compte a monté depuis le message d'avant — le premier ne fait que le noter, les
      // clics d'avant l'arrivée ne battent pas
      if (typeof c === 'number') {
        if (pr.c !== null && c > pr.c) pr.beat = true;
        pr.c = c;
      }
      ask(id);
    },
    drop: drop,
    ids: function() { return Object.keys(peers); },
    retune: function(w, e) {
      // ce qui cesse d'être partagé part « à vide », par l'ancien envoi : rien de figé chez les autres
      if (sender) {
        var cleared = false;
        if (ptr && !(e && w.pointer)) { ptr = null; cleared = true; }
        if (txt && !(e && w.text)) { txt = null; cleared = true; }
        if (foc && !(e && w.focus)) { foc = null; cleared = true; }
        if (cleared) send();
      }
      want     = w;
      sender = e || null;
      if (sender) attach();
      else detach();
      ask();
    },
    destroy: function() {
      if (raf) cancelAnimationFrame(raf);
      detach();
      roots.forEach(function(r) { µ._mjs_dom.removeEventListener(r, 'scroll', onScroll, capture); });
      window.removeEventListener('scroll', onScroll, capture);
      window.removeEventListener('resize', ask);
      if (µ._mjs_scrollSubs) µ._mjs_scrollSubs.delete(onScroll);
      layer.remove();
    }
  };
};
