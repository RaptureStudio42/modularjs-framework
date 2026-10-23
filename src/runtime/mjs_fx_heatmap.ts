// mjs_fx_heatmap — `*heatmap` : où les visiteurs cliquent — ou tout autre événement (`on: mousemove`,
// `on: dblclick`…) : chaque point part, par la connexion MJS WS de sa variable (`sock: $$sock` ; `@sock`
// du composant par défaut), au serveur — qui doit avoir le paquet `heatmapPackage` (mjs-ws/heatmap.ts) —, qui en
// fait la carte, page par page, composant par composant et événement par événement, à lire sur la page
// d'admin du pont (`/heatmap`). `show: true` la dessine aussi sur la zone elle-même, en direct (les
// points de cette visite). Posé sur `<@document>` : toute la page, et chaque composant que le point
// traverse — le shadow DOM n'y fait pas obstacle : MJS descend dans ses propres composants, comme
// *cursors ; sur une balise ou un composant : lui seul, sa zone porte son nom (ou `name`). Le point : la
// place de la souris ou du doigt ; pour un événement qui n'en a pas (une touche, un champ), le centre
// de la balise qui l'a reçu ; dix par seconde au plus par effet, et pour tous les `*heatmap` d'une même connexion (le serveur
// n'en prend pas plus : un seau à jetons de ce débit — 10 par seconde, rafale de 20 moins un jeton de côté — que se partagent ceux qui ont
// des points à envoyer, à tour de rôle ; un effet lié qui n'émet pas n'en prend rien). Un point part tout de suite quand la connexion est
// ouverte, que le seau a un jeton et que la part du débit des effets en direct (4 trames par seconde, à eux tous, par défaut :
// µ._mjs_fxRate) le permet ; sinon il attend, et ceux qui le suivent le rejoignent : une trame porte plusieurs points (20 au plus, et
// sous 16 000 octets : un lot plus gros se coupe), aucun n'est jeté. Une connexion pas encore ouverte (elle est paresseuse) ou coupée :
// le premier point qui attend la fait ouvrir (si l'appli ne l'a pas fermée), le lot part quand elle est ouverte. Quand l'effet part (une
// navigation), ce qui attend ne meurt pas avec lui : il part à l'ouverture, dans les 10 secondes — la connexion de l'effet seul (`server`)
// reste ouverte jusque-là, puis se ferme. Rien d'autre ne part : ni texte, ni identité, ni cookie — l'adresse de la page (sans requête ni
// ancre ; un segment qui ressemble à un jeton ou à une donnée personnelle — un UUID, un JWT, un e-mail, un téléphone, un nombre de 6
// chiffres ou plus, un jeton hexadécimal, alphanumérique ou base64, voir `_mjsHeatmapLooks` — part remplacé par _SECRET_ID_, devant une extension
// ou après un `;` aussi, le nom du paramètre jugé seul ; la route du routeur MJS, #/…, part telle quelle), l'événement,
// le nom des zones, la place du point dans chacune et sa taille. Réglages : sock (la variable de la
// connexion ; @sock), server (une adresse, `wss://…` : une connexion à lui), name (le nom de la
// zone ; sa balise), on (le nom de l'événement, pas une adresse ; click), show (dessiner la chaleur sur la zone : true, tous les
// points de la visite ; un nombre, les plus récents ; non). Sans connexion, rien ne part ni ne se
// dessine, et l'effet le dit en console.

// les couleurs de la chaleur, une par opacité du dessin (un octet) : bleu, vert, jaune, rouge, et l'opacité rendue (de 70 à 240).
// Calculées une fois, dans une table de 256 × 4 octets, plutôt que recalculées à chaque pixel de chaque dessin
var _mjsHeatmapTone = null;
function _mjsHeatmapTones() {
  if (_mjsHeatmapTone) return _mjsHeatmapTone;
  var c = [[0, 0, 255], [0, 200, 120], [255, 220, 0], [255, 30, 30]];
  var t = new Uint8ClampedArray(1024);
  for (var v = 1; v < 256; v++) {
    var a = v / 255;
    var x = Math.min(0.999, a) * (c.length - 1);
    var i = Math.floor(x);
    var k = x - i;
    for (var j = 0; j < 3; j++) t[v * 4 + j] = Math.round(c[i][j] + (c[i + 1][j] - c[i][j]) * k);
    t[v * 4 + 3] = Math.round(70 + a * 170);
  }
  return _mjsHeatmapTone = t;
}

µ._mjs_fxDefs.heatmap = {
  css: '[mjs-fx-heatmap-layer]{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483644}'
    + '[mjs-fx-heatmap-layer="page"]{position:fixed}',
  setup: function(el, s, comp) {
    var page = el === document.documentElement;
    var on   = s.on === undefined || s.on === null || s.on === '' ? 'click' : s.on;
    // un nom d'événement (`click`, `mousemove`…) : le serveur n'en prend pas d'autre — une adresse s'écrit avec `server`
    if (typeof on !== 'string' || !_mjsHeatmapEvent.test(on)) {
      µ.error(µ._mjs_msg('heatmapEvent', { name: String(on), hint: (/^wss?:|\//i.test(String(on)) ? µ._mjs_txt('heatmapServerHint', { on: on }, ' — pour l\'adresse d\'un serveur, écrivez server: \'{on}\'') : '') }, '*heatmap : « {name} » n\'est pas un nom d\'événement valide (en minuscules : click, mousemove, dblclick…){hint}'));
      return function() {};
    }
    if (typeof µ._mjs_fxSock !== 'function') {
      µ.error(µ._mjs_msg('heatmapNoCore', null, '*heatmap : le module socket manque au cœur (réglage runtime)'));
      return function() {};
    }
    var sock = null;
    var last = 0;
    // un nom de zone : minuscules, lettres, chiffres, . _ # -
    var clean = function(n) {
      var c = String(n).toLowerCase().replace(/[^a-z0-9._#-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 120);
      return c || 'zone';
    };
    var frac = function(v) { return v < 0 ? 0 : v > 1 ? 1 : Math.round(v * 10000) / 10000; };
    var box  = function(nom, r, x, y) { return [nom, frac(r.width ? (x - r.left) / r.width : 0), frac(r.height ? (y - r.top) / r.height : 0), Math.round(r.width), Math.round(r.height)]; };
    // la balise la plus profonde sous le point, jusque dans les composants (µ.elementAt)
    var deep = function(x, y, fallback) { return µ.elementAt(x, y) || fallback; };
    // la place du point : la souris, le doigt ; sinon le centre de la balise qui a reçu l'événement
    var at = function(ev, t0) {
      if (typeof ev.clientX === 'number' && (ev.clientX || ev.clientY || ev.detail > 0 || ev.pointerType)) return [ev.clientX, ev.clientY];
      if (!t0 || typeof t0.getBoundingClientRect !== 'function') return null;
      var b = t0.getBoundingClientRect();
      return [b.left + b.width / 2, b.top + b.height / 2];
    };

    // la chaleur dessinée sur la zone : les points de cette visite (en px de la page, ou en fractions
    // de la zone) — tous (`show: true`), ou les N plus récents (`show: N`, une variable le change sur
    // place) ; le calque vient et part avec `show`
    var layer = null;
    var pts   = [];
    var raf   = 0;
    var ro    = null;
    var restore = function() {};
    var host  = page ? document.body : µ._mjs_fxInner(el) || el;
    var combien = function() {
      if (typeof s.show === 'number' && s.show > 0) return Math.min(pts.length, Math.floor(s.show));
      return s.show === true ? pts.length : 0;
    };
    var montre = function() {
      if (!s.show) {
        if (!layer) return;
        if (ro) ro.disconnect();
        ro = null;
        if (page) {
          window.removeEventListener('scroll', redraw);
          window.removeEventListener('resize', redraw);
          if (µ._mjs_scrollSubs) µ._mjs_scrollSubs.delete(redraw);
        }
        layer.remove();
        layer = null;
        restore();
        restore = function() {};
        return;
      }
      if (!layer) {
        if (page) µ._mjs_fxAdopt(document, 'heatmap');
        else {
          restore = µ._mjs_fxRelative(el);
          if (host !== el) µ._mjs_fxAdopt(host, 'heatmap');
        }
        layer = document.createElement('canvas');
        layer.setAttribute('mjs-fx-heatmap-layer', page ? 'page' : 'zone');
        layer.setAttribute('aria-hidden', 'true');
        µ._mjs_dom.appendChild(host, layer);
        if (page) {
          window.addEventListener('scroll', redraw, { passive: true });
          window.addEventListener('resize', redraw);
          // un panneau qui défile dans un composant : relayé par le cœur
          if (µ._mjs_scrollSubs) µ._mjs_scrollSubs.add(redraw);
        }
        else if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(redraw);
          ro.observe(el);
        }
      }
      layer.setAttribute('mjs-fx-heatmap-n', String(combien()));
      redraw();
    };
    var draw = function() {
      raf = 0;
      var w = page ? window.innerWidth : el.clientWidth;
      var h = page ? window.innerHeight : el.clientHeight;
      if (layer.width !== w) layer.width = w;
      if (layer.height !== h) layer.height = h;
      var g = typeof layer.getContext === 'function' ? layer.getContext('2d', { willReadFrequently: true }) : null;
      if (!g || !w || !h) return;
      g.clearRect(0, 0, w, h);
      var r  = Math.max(24, Math.round(Math.max(w, h) / 30));
      var sx = page ? window.scrollX : 0;
      var sy = page ? window.scrollY : 0;
      for (var i = pts.length - combien(); i < pts.length; i++) {
        var x = page ? pts[i][0] - sx : pts[i][0] * w;
        var y = page ? pts[i][1] - sy : pts[i][1] * h;
        if (x < -r || y < -r || x > w + r || y > h + r) continue;
        var d = g.createRadialGradient(x, y, 0, x, y, r);
        d.addColorStop(0, 'rgba(0,0,0,0.22)');
        d.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = d;
        g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      var img = g.getImageData(0, 0, w, h);
      var px  = img.data;
      var hue = _mjsHeatmapTones();
      for (var j = 0; j < px.length; j += 4) {
        var o = px[j + 3] * 4;
        if (!o) continue;
        px[j]     = hue[o];
        px[j + 1] = hue[o + 1];
        px[j + 2] = hue[o + 2];
        px[j + 3] = hue[o + 3];
      }
      g.putImageData(img, 0, 0);
    };
    var redraw = function() {
      if (layer && !raf) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0);
    };
    // la connexion de sa variable (ou celle de `server`) : les points partent, la chaleur se dessine. `out` : les points de cet effet qui
    // attendent leur trame sur cette connexion (cf. _mjsHeatmapOut)
    var out    = null;
    var unlink = µ._mjs_fxSock(s.sock, s.server, _mjsHeatmapNoSock(), function(k) {
      sock = k;
      out  = _mjsHeatmapOut(k);
      µ._mjs_fxPackage(sock, 'heatmap:', '*heatmap', 'heatmapPackage', 'heatmapPackage({ origins: [\'https://monsite.fr\'] })');
      montre();
      return function() {
        // l'effet part, ou la connexion : ce qui attend ne meurt pas avec lui, il part à l'ouverture (borné dans le temps)
        var left = out;
        out  = null;
        sock = null;
        left.leave();
      };
    }, { read: µ._mjs_fxVar(el, 'heatmap', comp) });

    var onEvent = function(ev) {
      if (!sock) return;
      var now = Date.now();
      if (now - last < 100) return;
      var t0 = ev.composedPath ? ev.composedPath()[0] : ev.target;
      var p  = at(ev, t0);
      if (!p) return;
      last = now;
      var x = p[0];
      var y = p[1];
      var z = [];
      if (page) {
        var d  = document.documentElement;
        var pw = Math.max(d.scrollWidth, d.clientWidth);
        var ph = Math.max(d.scrollHeight, d.clientHeight);
        z.push(['document', frac(pw ? (x + window.scrollX) / pw : 0), frac(ph ? (y + window.scrollY) / ph : 0), Math.round(pw), Math.round(ph)]);
        // les composants traversés, du plus large au plus fin
        var chain = [];
        for (var n = deep(x, y, t0); n && n !== d; n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode) {
          if (n.nodeType === 1 && n.localName.indexOf('mjs-') === 0) chain.unshift(n);
        }
        for (var i = 0; i < chain.length && z.length < 8; i++) z.push(box(clean(chain[i].localName), µ._mjs_dom.getBoundingClientRect(chain[i]), x, y));
      }
      else z.push(box(clean(s.name || el.localName), µ._mjs_dom.getBoundingClientRect(el), x, y));
      // le point rejoint les points qui attendent leur trame : il part tout de suite si la connexion est ouverte, que le seau de points de la
      // connexion et la part du débit des effets en direct le permettent, sinon il attend son tour avec les suivants plutôt que d'être jeté
      // (un clic juste après le défilement d'un *follow arrive). Il part avec l'adresse de la page et sa route, sans requête ni ancre, ni jeton
      // ni identifiant — si le serveur la prendrait (2 000 caractères au plus : une trame qui en porte de plus longues pourrait dépasser son
      // maxPayload, et il expulserait la connexion). Le pas des points d'un effet : 100 ms, dix par seconde au plus ; entre les effets d'une
      // connexion, le seau partagé décide (le dessin local, `show`, n'en dépend pas)
      var url = _mjsHeatmapUrl();
      if (url.length <= 2000) out.add({ url: url, ev: on, z: z });
      pts.push(page ? [x + window.scrollX, y + window.scrollY] : [z[0][1], z[0][2]]);
      // une longue visite : les plus anciens points s'oublient (le dessin ne montre que les plus récents)
      if (pts.length > 20000) pts.splice(0, pts.length - 20000);
      if (layer) {
        layer.setAttribute('mjs-fx-heatmap-n', String(combien()));
        redraw();
      }
    };
    var target = page ? document : el;
    µ._mjs_dom.addEventListener(target, on, onEvent, { capture: true, passive: true });
    var stop = function() {
      unlink();
      µ._mjs_dom.removeEventListener(target, on, onEvent, { capture: true });
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      s.show = false;
      montre();
    };
    // `show` tenu par une variable : le calque suit sans reposer l'effet (ni reperdre les points)
    stop.set = function(k, v) {
      if (k !== 'show') return false;
      s.show = v;
      if (sock) montre();
    };
    return stop;
  }
};

// un nom d'événement que le serveur prend (minuscules, chiffres, : _ -)
var _mjsHeatmapEvent = /^[a-z][a-z0-9:_-]{0,39}$/;

// la trame d'un lot : 16 000 octets de points au plus — le serveur expulse la connexion au-delà de son maxPayload (65 536 par défaut)
var _mjsHeatmapFrame = 16000;

// le débit de points du serveur, par connexion (`rateLimit` de heatmapPackage : 10 par seconde, rafale de 20) — le client ne le connaît pas
// (aucun message ne le lui annonce) : il suppose les valeurs par défaut
var _mjsHeatmapRate  = 10;
var _mjsHeatmapBurst = 20;

// ce qui attend encore quand l'effet est parti (une navigation) part, ou s'abandonne, dans ce délai (ms)
var _mjsHeatmapLinger = 10000;

// la connexion de l'effet seul, retenue pour un dernier envoi, ne se ferme pas dans le tour de l'envoi : le serveur traite la trame avant la
// fermeture (ms)
var _mjsHeatmapGrace = 300;

// la part de points d'une connexion : UN seau à jetons de ce débit, que se partagent tous les `*heatmap` de la connexion — seuls ceux qui
// ont des points à envoyer y puisent, à tour de rôle (`line` : celui qui attend depuis le plus longtemps passe d'abord, puis retourne au
// bout de la file). Un lot ne dépasse jamais ce que le serveur prend : après une coupure, N effets qui gardaient chacun 20 points ne
// reviennent pas d'un coup sur son seau de 20
var _mjsHeatmapShare = function(k) {
  return k._mjs_fxHeatShare || (k._mjs_fxHeatShare = { n: _mjsHeatmapBurst, at: Date.now(), line: [] });
};

// combien de points peuvent partir maintenant : le seau se remplit en continu, un jeton reste de côté (l'horloge et le réseau ne sont pas
// ceux du serveur : sans cette marge, deux trames rapprochées par le réseau suffisent à lui faire jeter un point)
var _mjsHeatmapRoom = function(share) {
  var now   = Date.now();
  share.n   = Math.min(_mjsHeatmapBurst, share.n + Math.max(0, now - share.at) * _mjsHeatmapRate / 1000);
  share.at  = now;
  return Math.max(0, Math.floor(share.n - 1));
};

// une connexion qui annonce un état autre que `open` : fermée (paresseuse, ou fermée par l'appli), en train de s'ouvrir, coupée
var _mjsHeatmapWaiting = function(k) {
  return typeof k.state === 'string' && k.state !== 'open';
};

// un lien saturé : ce que le navigateur n'a pas encore envoyé dépasse la borne de la connexion — rien de plus n'y part
var _mjsHeatmapBusy = function(k) {
  var w = k._mjs_ws;
  return !!(w && w.bufferedAmount > (k.opts && k.opts.maxBuffered || 65536));
};

// les points d'un effet qui attendent leur trame, pour UNE connexion : un seul part tel quel (la trame d'avant), plusieurs partent d'un
// trait dans `{ pts: [...] }` — 20 au plus, les plus anciens s'oublient, et sous la borne d'une trame (le serveur expulse au-delà de son
// maxPayload : un lot plus gros se coupe). Une connexion pas encore ouverte (elle est paresseuse : le premier point la fait ouvrir) ou
// coupée, un lien saturé, la part des effets en direct ou le seau de points de la connexion épuisés, un autre effet qui attend depuis plus
// longtemps : le lot attend son tour, jamais jeté. `leave` : l'effet part (ou sa connexion) — ce qui attend part quand la connexion est
// ouverte, dans le délai `_mjsHeatmapLinger` ; la connexion de l'effet seul (`server`), que l'effet détruit juste après, reste ouverte
// d'une référence de plus jusque-là (le compte de références de µ.socket), puis se ferme
var _mjsHeatmapOut = function(k) {
  var share   = _mjsHeatmapShare(k);
  var out     = { chunk: [], wait: 0, until: 0, held: false };
  var unqueue = function() {
    var i = share.line.indexOf(out);
    if (i >= 0) share.line.splice(i, 1);
  };
  // plus rien à envoyer, ou plus pour longtemps : hors de la file, plus de minuteur, la connexion retenue est lâchée
  var end = function() {
    unqueue();
    if (out.wait) clearTimeout(out.wait);
    out.wait = 0;
    if (out.held) {
      out.held = false;
      if (!k._mjs_destroyed) k.destroy();
    }
  };
  // `forced` : au départ de l'effet — la part des effets en direct et le lien saturé ne retiennent pas ce dernier envoi (le seau de points,
  // lui, vaut toujours : c'est le débit du serveur)
  out.flush = function(forced) {
    out.wait = 0;
    if (!out.chunk.length) {
      end();
      return;
    }
    if (k._mjs_destroyed) {
      out.chunk = [];
      end();
      return;
    }
    // la connexion n'est pas ouverte (paresseuse, coupée, en train de s'ouvrir) : un point qui attend la fait ouvrir — `_mjs_ensure`, jamais
    // `connect()` : il respecte le recul de la connexion et son abandon
    if (_mjsHeatmapWaiting(k) && typeof k._mjs_ensure === 'function') k._mjs_ensure();
    // fermée pour de bon (l'appli l'a voulu) : rien ne la rouvrira — un effet encore là garde le lot jusqu'au point suivant, sans minuteur
    // qui tourne à vide ; un effet parti y renonce
    if (k.state === 'closed') {
      if (out.until) out.chunk = [];
      end();
      return;
    }
    // l'effet est parti depuis trop longtemps : ce qui attend s'abandonne
    if (out.until && Date.now() > out.until) {
      out.chunk = [];
      end();
      return;
    }
    var line = share.line;
    if (line.indexOf(out) < 0) line.push(out);
    var room = _mjsHeatmapRoom(share);
    if (line[0] !== out || _mjsHeatmapWaiting(k) || room < 1 || (!forced && (_mjsHeatmapBusy(k) || (typeof k._mjs_fxToken === 'function' && !k._mjs_fxToken())))) {
      out.wait = setTimeout(out.flush, 100);
      return;
    }
    var n    = 0;
    var size = 0;
    while (n < out.chunk.length && n < room) {
      var w = JSON.stringify(out.chunk[n]).length + 1;
      if (n && size + w > _mjsHeatmapFrame) break;
      size += w;
      n++;
    }
    var batch = out.chunk.splice(0, n);
    share.n -= n;
    k.send('heatmap:point', batch.length === 1 ? batch[0] : { pts: batch }, { volatile: true });
    // les autres effets qui attendent passent devant
    if (line.length > 1) line.push(line.shift());
    if (!out.chunk.length) {
      // le dernier envoi : la connexion retenue se ferme après un court délai, pas dans le même tour
      if (out.held) {
        unqueue();
        out.wait = setTimeout(end, _mjsHeatmapGrace);
      }
      else end();
      return;
    }
    // ce qui ne tenait pas dans la trame suit, à la trame d'après
    if (forced && line[0] === out) out.flush(true);
    else out.wait = setTimeout(out.flush, 100);
  };
  out.add = function(point) {
    out.chunk.push(point);
    if (out.chunk.length > 20) out.chunk.shift();
    if (!out.wait) out.flush();
  };
  out.leave = function() {
    if (out.until) return;
    if (out.wait) clearTimeout(out.wait);
    out.wait = 0;
    if (!out.chunk.length || k._mjs_destroyed) {
      out.chunk = [];
      end();
      return;
    }
    out.until = Date.now() + _mjsHeatmapLinger;
    if (k.opts && k.opts._mjs_own && typeof k._mjs_refs === 'number') {
      k._mjs_refs++;
      out.held = true;
    }
    out.flush(true);
  };
  return out;
};

// un texte (un segment de chemin, déjà décodé) qui ressemble à un jeton ou à une donnée personnelle : un UUID (avec ou sans tirets, entre
// accolades), un JWT (`eyJ…`, trois à cinq parties base64url, ou trois parties de 8 caractères au moins), un e-mail, un nombre de 6 chiffres
// ou plus (un téléphone : `+33612345678`, `06 12 34 56 78`), 8 caractères hexadécimaux ou plus mêlant lettres et chiffres (un jeton court :
// `5f3a9c2e` ; de 9 à 11 caractères, un mot écrit en hexadécimal — `added2023`, `face2face` — se lit, il reste en clair), 16 caractères
// alphanumériques ou plus mêlant lettres et chiffres (un jeton, une empreinte), ou 20 caractères ou plus de l'alphabet base64 (`A-Za-z0-9+/=_-`)
// mêlant minuscules, majuscules et chiffres, avec au moins une bosse (`aB`) ou un voisinage lettre-chiffre (`a1`). Ces deux derniers restent en
// clair quand 90 % du texte se lit : des mots prononçables (`Samsung_Galaxy_S23_Ultra`, `bootstrap5components`), des dates compactes
// (`20241003T101500Z`, `IMG20241003123456`, `DSC20241003123456`). Un slug (`top-10-des-meilleurs-outils`), une date, `v2`, un numéro court, un code court restent en
// clair. Enfin, 16 caractères ou plus faits de lettres, de chiffres, de `-` et de `_`, quels que soient ces caractères (sans chiffre, en
// minuscules seules, avec un tiret) : un jeton, sauf quand ils se lisent comme des mots (`_mjsHeatmapPlain`), et une clé de groupes de même longueur, même courte (`_mjsHeatmapKey`). La MÊME règle que le serveur
// (mjs-ws/heatmap.ts, `looksLikeToken`), qui ne croit pas le client
var _mjsHeatmapReadRe = /[A-Z]{2,4}(?=\d{4})|([a-z]?[A-Z][a-z]{2,}|[a-z]{5,}|[A-Z]{2,})(\d{0,3})|\d{4,}[A-Z]?|(?:^|[-_])[A-Z]\d{1,3}(?![A-Za-z\d])|[-_.]/g;

// un mot prononçable : des voyelles (un quart au moins), jamais 6 consonnes de suite, pas de lettres rares en foule
var _mjsHeatmapIsWord = function(w) {
  var v = (w.match(/[aeiouy]/gi) || []).length;
  return v > 0 && v * 4 >= w.length && !/[^aeiouy]{6}/i.test(w) && (w.length < 8 || (w.match(/[jqxz]/gi) || []).length * 6 <= w.length);
};

var _mjsHeatmapReadable = function(s) {
  var n = 0;
  s.replace(_mjsHeatmapReadRe, function(m, w) {
    if (!w || _mjsHeatmapIsWord(w)) n += m.length;
    return m;
  });
  return n * 10 >= s.length * 9;
};

// les lettres qui en suivent chacune dans les mots (dictionnaires français et anglais, plus `lw` : always, railway, tailwind) : une paire
// absente d'ici (`qx`, `zk`, `wj`…) n'est dans aucun mot courant — un jeton tiré au hasard en a presque toujours une
var _mjsHeatmapPairs = {
  a: 'abcdefghijklmnopqrstuvwxyz',
  b: 'abdeijlmorstuvy',
  c: 'acehikloqrstuy',
  d: 'abcdefghijlmnoprstuvwy',
  e: 'abcdefghijklmnopqrstuvwxyz',
  f: 'aefilorstuy',
  g: 'aeghilmnorstuy',
  h: 'abefilmnorstuwy',
  i: 'abcdefgiklmnopqrstuvxz',
  j: 'aeiou',
  k: 'abehilmnorsuwy',
  l: 'abcdefghiklmnopqrstuvwy',
  m: 'abcefilmnopsuy',
  n: 'abcdefghijklmnopqrstuvwyz',
  o: 'abcdefghiklmnopqrstuvwxyz',
  p: 'abehilmoprstuy',
  q: 'u',
  r: 'abcdefghijklmnopqrstuvwy',
  s: 'abcdefghiklmnopqrstuwy',
  t: 'abcefghilmnoprstuwyz',
  u: 'abcdefgiklmnopqrstvxyz',
  v: 'aeioru',
  w: 'abdehiklnors',
  x: 'acehioptuy',
  y: 'abcdegilmnoprstuw',
  z: 'aeiloyz'
};

// un mot (lettres seules) qui se prononce : une voyelle, jamais 6 consonnes de suite, chaque paire de lettres dans `_mjsHeatmapPairs`
var _mjsHeatmapSays = function(w) {
  w = w.toLowerCase();
  if (!/[aeiouy]/.test(w) || /[^aeiouy]{6}/.test(w)) return false;
  for (var i = 1; i < w.length; i++) if (_mjsHeatmapPairs[w[i - 1]].indexOf(w[i]) < 0) return false;
  return true;
};

// un texte de lettres, chiffres, `-` et `_` qui se lit : découpé en nombres, séparateurs et mots (minuscules, une capitale puis des
// minuscules, ou capitales), chaque mot de 3 lettres et plus se prononce (des capitales : en morceau entier ou devant un nombre) ; un mot
// plus court est un morceau entier entre deux séparateurs (`de`, `OLED` ; une lettre seule : une voyelle), touche un nombre
// (`S23`, `IMG2024…`, `256gb`, le `T` d'une date) ou ouvre un mot à capitale (`iPhone`) ; deux mots ou nombres au moins, 31 pour 100
// caractères au plus. Un morceau court qui ne se prononce pas est un sigle (`php`, `vs`, `IMG`, `json`) : les sigles font moins d'un
// cinquième du texte, et un sigle de 4 lettres veut un mot de 5 lettres ou plus, ou un nombre, dans le texte — des groupes de lettres
// tirées au hasard (`xxxx-xxxx-xxxx-xxxx`, une clé de licence) ne se lisent pas. Un mot d'un slug — des mots en minuscules et des nombres séparés par `-` : `github-actions-workflow`,
// `postgresql-performance-tips` — se lit aussi quand ses paires de lettres manquent à la table (un nom de marque, un mot composé, un
// mot rare), un seul par slug : 10 lettres au plus, une voyelle, jamais 5 consonnes de suite, une seule paire hors table (deux pour un
// mot de 6 lettres au plus : `nextjs`). Au-delà, un morceau tiré au hasard ne s'en distingue plus (`invite-…`, `xxxxx-xxxxx-…`) ; `_`
// lie les morceaux d'un identifiant (`tok_…`), pas les mots d'un slug. Un seul mot de 16 lettres et plus, un séparateur en tête, en fin
// ou doublé ne se lisent pas : un jeton de lettres ne s'en distingue pas
var _mjsHeatmapWordsRe = /\d+|[-_]|[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g;

// les paires de lettres d'un mot en minuscules absentes de `_mjsHeatmapPairs`
var _mjsHeatmapGaps = function(w) {
  var n = 0;
  for (var i = 1; i < w.length; i++) if (_mjsHeatmapPairs[w[i - 1]].indexOf(w[i]) < 0) n++;
  return n;
};

var _mjsHeatmapPlain = function(s) {
  if (/^[-_]|[-_]$|[-_]{2}/.test(s)) return false;
  // un slug : des mots en minuscules et des nombres, séparés par `-` ; il peut porter un mot hors table
  var slug  = /^(?:[a-z]+|\d+)(?:-(?:[a-z]+|\d+))+$/.test(s);
  var t     = s.match(_mjsHeatmapWordsRe) || [];
  // un mot de 5 lettres ou plus, ou un nombre : un sigle de 4 lettres peut l'accompagner
  var long  = /\d|[A-Za-z]{5}/.test(s);
  var words = 0;
  // les lettres des sigles
  var sigle = 0;
  for (var i = 0; i < t.length; i++) {
    var w = t[i];
    if (w === '-' || w === '_') continue;
    words++;
    if (/^\d/.test(w)) continue;
    var a  = t[i - 1] || '-';
    var b  = t[i + 1] || '-';
    var sa = a === '-' || a === '_';
    var sb = b === '-' || b === '_';
    var da = /^\d/.test(a);
    var db = /^\d/.test(b);
    if (sa && sb && w.length <= 4 && (w.length > 1 || /[aeiouy]/i.test(w))) {
      if (w.length > 1 && !_mjsHeatmapSays(w)) {
        if (w.length > 3 && !long) return false;
        sigle += w.length;
      }
      continue;
    }
    if ((sa && db && w.length <= 3) || (da && sb && w.length <= 2) || (/^\d{4}/.test(a) && /^\d{4}/.test(b) && w.length === 1)) continue;
    if (w.length === 1 && /^[a-z]$/.test(w) && sa && /^[A-Z][a-z]{2}/.test(b)) continue;
    if (w.length >= 3 && (!/^[A-Z]{2}/.test(w) || (sa && (sb || db))) && _mjsHeatmapSays(w)) continue;
    if (slug && w.length <= 10 && /[aeiouy]/.test(w) && !/[^aeiouy]{5}/.test(w) && _mjsHeatmapGaps(w) <= (w.length <= 6 ? 2 : 1)) {
      slug = false;
      continue;
    }
    return false;
  }
  return words >= 2 && words * 100 <= s.length * 31 && sigle * 5 < s.length;
};

// une clé : trois groupes ou plus de 4 à 6 lettres ou chiffres, tous de la même longueur, séparés par `-` ou `_`, au bout du texte, seule ou
// derrière des mots (`xxxxx-xxxxx-xxxxx`, `XXXX_XXXX_XXXX_XXXX`, `key-xxxxx-xxxxx-xxxxx`, `order-1234-5678-9012`) ; capitales et minuscules se
// valent. Elle se masque quand un groupe porte un chiffre, quelle que soit sa longueur (`1234-5678-9012`, 14 caractères) ; de lettres, elle ne
// se lit qu'en quatre groupes ou plus, chacun un mot qui se prononce, à deux voyelles au moins (`salut-monde-pomme-poire`) : trois groupes
// tirés au hasard se prononcent trop souvent (près de 7 pour 100 pour 3 × 5 lettres), trois mots de même longueur au bout d'un slug se
// masquent donc même quand ils se lisent (`react-hooks-guide`, `the-black-white-photo`). Trois groupes de 4 lettres seuls (14 caractères,
// sous les 16 des jetons à séparateurs) se lisent comme un slug, chaque mot prononçable : `best-food-ever` reste, `html-form-tips` se masque
var _mjsHeatmapKey = function(s) {
  var g = s.split(/[-_]/);
  var n = g[g.length - 1].length;
  var i = g.length;
  while (i > 0 && g[i - 1].length === n && /^[A-Za-z\d]{4,6}$/.test(g[i - 1])) i--;
  var k = g.slice(i);
  if (k.length < 3) return false;
  if (/\d/.test(k.join(''))) return true;
  if (k.length > 3) return !k.every(function(w) { return _mjsHeatmapSays(w) && /[aeiouy].*[aeiouy]/i.test(w); });
  return s.length >= 16 || !_mjsHeatmapPlain(s);
};

// un numéro écrit en groupes : 6 chiffres ou plus séparés par `-`, `.` ou des espaces, `+` en tête permis (`555-123-4567`, `06.12.34.56.78`,
// `+33-6-12-34-56-78`) ; une date reste en clair : `AAAA-MM-JJ`, `AAAA-MM`, `JJ-MM-AAAA` (ou `MM-JJ-AAAA`), une année de 1900 à 2099
var _mjsHeatmapDateRe = /^(?:(?:19|20)\d\d([-. ])(?:0?[1-9]|1[0-2])(?:\1(?:0?[1-9]|[12]\d|3[01]))?|(?:0?[1-9]|[12]\d|3[01])([-. ])(?:0?[1-9]|[12]\d|3[01])\2(?:19|20)\d\d)$/;
var _mjsHeatmapPhone = function(s) {
  return /^\+?\d+(?:[-. ]+\d+)+$/.test(s) && s.replace(/\D/g, '').length >= 6 && !_mjsHeatmapDateRe.test(s);
};

// un code court tiré au hasard, de groupes de longueurs inégales : trois groupes ou plus de 3 à 6 lettres ou chiffres séparés par `-` ou `_`,
// une lettre collée à un chiffre, un texte qui ne se lit pas (`A7K2-9QXB4M-P3Z`, `c6h-suf-px7-hnh`) ; un slug qui porte un nombre se lit
// (`ps5-pro-review`, `rtx-4090-test`)
var _mjsHeatmapCode = function(s) {
  return /^[A-Za-z\d]{3,6}(?:[-_][A-Za-z\d]{3,6}){2,}$/.test(s) && /[A-Za-z]\d|\d[A-Za-z]/.test(s) && !_mjsHeatmapPlain(s);
};

var _mjsHeatmapLooks = function(s) {
  if (/^[{(]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[})]?$/i.test(s)) return true;
  if (/^eyJ[\w-]*(?:\.[\w-]*){2,4}$/.test(s)) return true;
  if (/^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/.test(s)) return true;
  if (/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(s)) return true;
  if (/^\+?\d{6,}$/.test(s.replace(/ /g, ''))) return true;
  if (_mjsHeatmapPhone(s)) return true;
  if (/^[0-9a-f]{8,}$/i.test(s) && /[a-f]/i.test(s) && /\d/.test(s) && (s.length < 9 || s.length > 11 || !/^[a-f]{4,}\d{1,4}(?:[a-f]{4,})?$/i.test(s))) return true;
  if (/^[a-z\d]{16,}$/i.test(s) && /[a-z]/i.test(s) && /\d/.test(s) && !_mjsHeatmapReadable(s)) return true;
  if (_mjsHeatmapKey(s)) return true;
  if (_mjsHeatmapCode(s)) return true;
  if (/^[\w-]{16,}$/.test(s) && !_mjsHeatmapPlain(s)) return true;
  return /^[\w+/=-]{20,}$/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]/.test(s) && !_mjsHeatmapReadable(s);
};

// les suites `%XX` décodées, une par une : un `%` mal formé ne gâte pas le reste
var _mjsHeatmapRuns = function(s) {
  return s.replace(/(?:%[0-9a-f]{2})+/gi, function(run) {
    try {
      return decodeURIComponent(run);
    }
    catch (e) {
      return run;
    }
  });
};

// le segment tel qu'écrit dans l'adresse, puis décodé jusqu'à trois fois (`%2540` est un `@` encodé deux fois)
var _mjsHeatmapToken = function(seg) {
  var s = seg;
  for (var i = 0; i < 4; i++) {
    if (_mjsHeatmapLooks(s)) return true;
    var d = s.indexOf('%') < 0 ? s : _mjsHeatmapRuns(s);
    if (d === s) return false;
    s = d;
  }
  return false;
};

// une partie de segment qui est un jeton : `_SECRET_ID_` ; « <jeton>.pdf » garde son extension (`_SECRET_ID_.pdf`) ; sinon null
var _mjsHeatmapWhole = function(p) {
  if (_mjsHeatmapToken(p)) return '_SECRET_ID_';
  var m = /^(.+)\.([A-Za-z0-9]{1,5})$/.exec(p);
  return m && _mjsHeatmapToken(m[1]) ? '_SECRET_ID_.' + m[2] : null;
};

// une partie `nom=valeur` (`;jsessionid=…`) : le nom jugé comme un segment, toujours (`<jeton>.pdf` : `_SECRET_ID_.pdf`) ; une valeur
// jeton part masquée, une valeur déjà masquée (`_SECRET_ID_`, `_SECRET_ID_.pdf`) reste, la partie n'est pas rejugée ; une valeur en
// clair : la partie telle qu'elle partirait, nom masqué, est jugée entière (un base64 coupé par un `=`), la partie écrite pour un `=` de
// remplissage seul (`…sT12=`, `…==`) — rien ne bouge au second passage, le serveur garde ce que le navigateur envoie
var _mjsHeatmapMaskPart = function(p) {
  var i = p.indexOf('=');
  if (i < 1) return _mjsHeatmapWhole(p) || p;
  var value = p.slice(i + 1);
  var name  = _mjsHeatmapWhole(p.slice(0, i)) || p.slice(0, i);
  var mask  = /^_SECRET_ID_(?:\.[A-Za-z0-9]{1,5})?$/.test(value) ? value : _mjsHeatmapWhole(value);
  if (mask !== null) return name + '=' + mask;
  return _mjsHeatmapWhole(/^=*$/.test(value) ? p : name + '=' + value) || name + '=' + value;
};

// un segment : chaque partie séparée par `;` (le nom, puis ses paramètres `;jsessionid=…`) a son jugement
var _mjsHeatmapSegment = function(seg) {
  return seg.split(';').map(_mjsHeatmapMaskPart).join(';');
};

var _mjsHeatmapSegments = function(pathStr) {
  return pathStr.split('/').map(_mjsHeatmapSegment).join('/');
};

// l'adresse de la page : l'origine, le chemin, et la route du routeur MJS (`#/…`, sans requête ni ancre) — telle quelle, jamais
// sous son motif (`/blog/:slug` fusionnerait tous les articles) ; un jeton ou une donnée personnelle part remplacé par _SECRET_ID_
var _mjsHeatmapUrl = function() {
  var h     = location.hash || '';
  var route = '';
  if (/^#\//.test(h)) route = '#' + _mjsHeatmapSegments(h.replace(/^(#[^?#]*).*$/, '$1').slice(1));
  return location.origin + _mjsHeatmapSegments(location.pathname) + route;
};

var _mjsHeatmapNoSock = function() { return µ._mjs_msg('heatmapNoSock', null, '*heatmap n\'a pas de connexion MJS WS : sa variable (sock ; @sock par défaut) est vide, rien ne part — ouvrez-la (@sock = µsocket \'wss://…\', ou un store : sock: $$sock), avec heatmapPackage côté serveur ; une connexion posée plus tard dans la variable le relance'); };
