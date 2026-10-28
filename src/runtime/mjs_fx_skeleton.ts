// mjs_fx_skeleton — `*skeleton` : une silhouette qui scintille en attendant le contenu (des barres
// dessinées dans la balise, dans le composant si la balise en est un). Réglages : lines (nombre de
// barres ; 3), color (le fond des barres), shine (le reflet qui passe), speed (un passage du
// reflet ; 1.4s), radius (l'arrondi des barres en px ; 7), height (sur une balise : la hauteur de la silhouette, que ses barres se
// partagent, chacune au moins 14 px ; un nombre en px ou une longueur CSS — px, %, em, rem, vw, vh ; un pourcentage sans hauteur
// écrite sur la balise ne vaut rien ; tenu par une variable, suivi sur place ; sans lui, la hauteur des barres, 14 px chacune).
// Les barres dessinées dans la balise sont muettes ; le temps qu'elles sont là, la balise dit aux lecteurs d'écran que son contenu est en route (`aria-busy="true"`, sauf une
// valeur écrite) ; de même la balise d'un composant dont le code arrive, et celle qui contient la zone d'un {await}.
// Sur un bloc `{await $x *skeleton}`, le compilateur tire la silhouette de la branche {success}
// (parser/index.ts, poseSkeleton) : une zone sans boîte (`mjs-skel-zone`) où chaque texte à venir est
// une barre (`mjs-skel` : s, m, l, title, lines, block, media) — l'effet n'y dessine rien de plus, il
// fait scintiller ces barres à ses couleurs.

// `aria-busy="true"` le temps d'une silhouette (`n` : +1 posée, -1 partie), sauf une valeur écrite ; compté : une balise
// peut en porter plusieurs (deux {await} dans le même parent)
function _mjsSkelBusy(el, n) {
  if (!el || el.nodeType !== 1) return;
  if (el._mjsSkelBusy === void 0) {
    if (n < 0 || µ._mjs_dom.getAttribute(el, 'aria-busy') !== null) return;
    el._mjsSkelBusy = 0;
  }
  el._mjsSkelBusy += n;
  if (el._mjsSkelBusy > 0) µ._mjs_dom.setAttribute(el, 'aria-busy', 'true');
  else {
    delete el._mjsSkelBusy;
    µ._mjs_dom.removeAttribute(el, 'aria-busy');
  }
}

// la forme compacte d'une silhouette (au manifeste) remise en HTML — cf. componentSkeleton, parser/index.ts :
// `[…]` trois fois de suite, `nom.classe attributs>` une balise (`/` en fin : sans contenu ; `img` : une image et
// sa boîte), `)` sa fermeture (celles de la fin sont tues), un chiffre une barre
var _MJS_SKEL_KINDS = ['s', 'm', 'l', 'title', 'lines', 'block', 'media'];
function _mjsSkelHtml(c) {
  var open = [];
  while (c.indexOf('[') >= 0) c = c.replace(/\[([^\[\]]*)\]/g, function(_, x) { return x + x + x; });
  var html = c.replace(/([^>)\d][^>]*)>|(\d)|\)/g, function(_, h, bar) {
    if (bar) {
      var k = _MJS_SKEL_KINDS[bar - 1];
      return '<i mjs-skel="' + k + '">' + (k === 'lines' ? '<i mjs-skel="line"></i><i mjs-skel="line"></i><i mjs-skel="line"></i>' : '') + '</i>';
    }
    if (!h) return '</' + open.pop() + '>';
    var vide = h.charAt(h.length - 1) === '/';
    if (vide) h = h.slice(0, -1);
    h = h.replace(/^([\w-]+)\.([^ ]+)/, function(_, n, k) { return n + ' class="' + k.split('.').join(' ') + '"'; });
    var nom = h.split(' ')[0];
    if (nom === 'img') return '<' + h + ' mjs-skel="media">';
    if (!vide) open.push(nom);
    return '<' + h + '>';
  });
  while (open.length) html += '</' + open.pop() + '>';
  return html.replace(/&#91;/g, '[').replace(/&#93;/g, ']');
}

// la silhouette d'un composant dont le code arrive : tirée de son HTML au build (`µ._skels`, au
// manifeste, en forme compacte — clé `effects.skeleton` ∋ 'components' pour un composant qui attend un
// contenu, ou `*skeleton` écrit sur sa balise), posée dans sa balise encore inconnue (sans contenu à
// elle), marquée `mjs-skel-host` (le bouclier du cœur, qui cache une balise inconnue, l'épargne) ;
// `µ._def` retire l'une et l'autre juste avant d'enregistrer le composant (µ._mjs_skelOff). Rend la
// zone posée, ou null. Seule une clé propre de la table a une silhouette : un nom posé par un
// prototype pollué n'en a pas (son texte serait du HTML posé dans la page)
var _mjsSkels = {};
// une silhouette ne paraît qu'une fois en place ce qui la précède : un composant du manifeste encore attendu, sans
// silhouette (rendu dès que son code arrive), placé avant elle — dans sa racine ou dans celles qui la contiennent —
// la pousserait en arrivant ; elle est retenue, et µ._mjs_skelOff la relance à chaque composant qui arrive. Une balise du
// même composant ne la retient pas : elles arrivent ensemble, d'un seul enregistrement
var _mjsSkelLater = [];
function _mjsSkelHeld(el) {
  var pending = µ.Autoloader && µ.Autoloader._mjs_pending;
  if (!pending || !pending.size) return false;
  for (var n = el, r; n; n = r.host) {
    r = n.getRootNode ? µ._mjs_dom.getRootNode(n) : document;
    if (!r || !r.querySelectorAll) return false;
    var avant = r.querySelectorAll(':not(:defined)');
    for (var i = 0; i < avant.length; i++) {
      var b = avant[i];
      if (b === n || (b.compareDocumentPosition(n) & 2)) break;
      if (b.localName !== el.localName && pending.has(b.localName) && !b.contains(n) && !µ._mjs_dom.hasAttribute(b, 'mjs-skel-host')) return true;
    }
  }
  return false;
}
function _mjsSkelRetry() {
  var l = _mjsSkelLater;
  _mjsSkelLater = [];
  for (var i = 0; i < l.length; i++) if (l[i].isConnected) µ._mjs_skelShow(l[i]);
}
µ._mjs_skelShow = function(el) {
  var tag  = el.localName;
  var forme = tag.indexOf('mjs-') === 0 && µ._skels && Object.prototype.hasOwnProperty.call(µ._skels, tag.slice(4)) ? µ._skels[tag.slice(4)] : null;
  if (!forme || el.firstChild || (typeof customElements !== 'undefined' && customElements.get(tag))) return null;
  if (_mjsSkelHeld(el)) {
    if (_mjsSkelLater.indexOf(el) < 0) _mjsSkelLater.push(el);
    return null;
  }
  var r = el.getRootNode ? µ._mjs_dom.getRootNode(el) : document;
  µ._mjs_fxAdopt(r && (r.nodeType === 11 || r.nodeType === 9) ? r : document, 'skeleton');
  var zone = document.createElement('div');
  zone.setAttribute('mjs-skel-zone', '');
  zone.setAttribute('aria-hidden', 'true');
  var t = document.createElement('template');
  // rangée en HTML entier (le manifeste d'avant la forme compacte, qui ne commence jamais par `<`) : lue telle quelle
  t.innerHTML = forme.charAt(0) === '<' ? forme : _mjsSkelHtml(forme);
  zone.appendChild(t.content);
  µ._mjs_dom.setAttribute(el, 'mjs-skel-host', '');
  µ._mjs_dom.appendChild(el, zone);
  _mjsSkelBusy(el, 1);
  (_mjsSkels[tag] || (_mjsSkels[tag] = [])).push(zone);
  return zone;
};
// la zone défaite (effet retiré, code arrivé) quitte aussi le registre : une balise retirée avant
// l'arrivée de son code n'y reste pas retenue
function _mjsSkelDrop(zone) {
  if (zone.parentNode) {
    µ._mjs_dom.removeAttribute(zone.parentNode, 'mjs-skel-host');
    _mjsSkelBusy(zone.parentNode, -1);
  }
  zone.remove();
  for (var tag in _mjsSkels) {
    var l = _mjsSkels[tag];
    var i = l.indexOf(zone);
    if (i < 0) continue;
    l.splice(i, 1);
    if (l.length === 0) delete _mjsSkels[tag];
    return;
  }
}
µ._mjs_skelOff = function(tag) {
  var l = _mjsSkels[tag];
  // une silhouette retenue par ce composant : relancée une fois celui-ci enregistré (et rendu)
  if (_mjsSkelLater.length) Promise.resolve().then(_mjsSkelRetry);
  if (!l) return;
  delete _mjsSkels[tag];
  for (var i = 0; i < l.length; i++) _mjsSkelDrop(l[i]);
};

µ._mjs_fxDefs.skeleton = {
  // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
  decor: true,
  css: '[mjs-fx-layer="skeleton"]{display:grid;gap:10px;width:100%;pointer-events:none}'
    + '[mjs-fx-layer="skeleton"] i,[mjs-skel-zone] i[mjs-skel],[mjs-skel-zone] img[mjs-skel]{border-radius:var(--mjs-skeleton-radius,7px);background:linear-gradient(90deg,var(--mjs-skeleton-color,#21262d) 25%,var(--mjs-skeleton-shine,#30363d) 50%,var(--mjs-skeleton-color,#21262d) 75%);background-size:200% 100%;animation:mjs-fx-skeleton var(--mjs-skeleton-speed,1.4s) ease infinite}'
    + '[mjs-fx-layer="skeleton"] i{display:block;height:14px}'
    + '[mjs-fx-layer="skeleton"] i:nth-child(3n+2){width:80%}'
    + '[mjs-fx-layer="skeleton"] i:nth-child(3n){width:60%}'
    // une hauteur écrite (`height`) : les barres se la partagent, chacune au moins la hauteur d'une barre
    + '[mjs-fx-layer="skeleton"][mjs-skel-height]{grid-auto-rows:1fr}'
    + '[mjs-fx-layer="skeleton"][mjs-skel-height] i{height:auto;min-height:14px}'
    // la silhouette d'un {await} : les barres suivent le texte qu'elles remplacent (même poids de
    // sélecteur pour chaque sorte : la sorte l'emporte toujours sur la barre de base)
    + '[mjs-skel-zone]{display:contents}'
    + '[mjs-skel-zone] i[mjs-skel]{display:inline-block;vertical-align:middle;height:.9em;max-width:100%}'
    + '[mjs-skel-zone] i[mjs-skel="s"]{width:3em}'
    + '[mjs-skel-zone] i[mjs-skel="m"]{width:8em}'
    + '[mjs-skel-zone] i[mjs-skel="l"]{width:16em}'
    + '[mjs-skel-zone] i[mjs-skel="title"]{width:60%;height:1em}'
    + '[mjs-skel-zone] i[mjs-skel="lines"]{display:grid;gap:.55em;width:100%;height:auto;background:none;animation:none}'
    + '[mjs-skel-zone] i[mjs-skel="line"]{display:block;width:100%}'
    + '[mjs-skel-zone] i[mjs-skel="line"]:last-child{width:60%}'
    + '[mjs-skel-zone] i[mjs-skel="block"]{display:block;width:100%;height:4em}'
    + '[mjs-skel-zone] i[mjs-skel="media"]{width:6em;height:4em}'
    + '[mjs-skel-zone] img[mjs-skel]{min-width:3em;min-height:3em}'
    + '@keyframes mjs-fx-skeleton{from{background-position:200% 0}to{background-position:-200% 0}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="skeleton"] i,[mjs-skel-zone] i[mjs-skel],[mjs-skel-zone] img[mjs-skel]{animation:none}}',
  vars: { color: '', shine: '', speed: '', radius: 'px' },
  setup: function(el, s) {
    // la zone d'un {await} : ses barres sont déjà là ; la balise qui la contient (l'hôte, au premier niveau d'un composant) est
    // occupée, lue une fois la zone dans la page (elle est construite à part, puis insérée)
    if (µ._mjs_dom.hasAttribute(el, 'mjs-skel-zone')) {
      var box  = null;
      var gone = false;
      var take = function() {
        if (gone) return;
        box = el.parentNode && el.parentNode.nodeType === 11 ? el.parentNode.host : el.parentNode;
        _mjsSkelBusy(box, 1);
      };
      if (el.isConnected) take();
      else Promise.resolve().then(take);
      return function() {
        gone = true;
        _mjsSkelBusy(box, -1);
      };
    }
    // sur la balise d'un composant : la silhouette de son HTML tant que son code arrive, rien une fois
    // qu'il est là (cf. µ._mjs_skelShow)
    if (el.localName.indexOf('-') > 0) {
      var zone = µ._mjs_skelShow(el);
      return function() { if (zone) _mjsSkelDrop(zone); };
    }
    var host  = µ._mjs_fxInner(el) || el;
    if (host !== el) µ._mjs_fxAdopt(host, 'skeleton');
    var layer = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'skeleton');
    layer.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < (s.lines || 3); i++) layer.appendChild(document.createElement('i'));
    // la hauteur de la silhouette : un nombre en px, une longueur CSS telle quelle (une valeur que le navigateur refuse ne pose rien)
    var tall = function(v) {
      var h = v === void 0 || v === null ? '' : String(v);
      if (/^\d*\.?\d+$/.test(h)) h += 'px';
      layer.style.height = '';
      if (h) layer.style.height = h;
      µ._mjs_dom[layer.style.height ? 'setAttribute' : 'removeAttribute'](layer, 'mjs-skel-height', '');
    };
    tall(s.height);
    µ._mjs_dom.appendChild(host, layer);
    _mjsSkelBusy(el, 1);
    var stop = function() {
      layer.remove();
      _mjsSkelBusy(el, -1);
    };
    // la hauteur tenue par une variable suit sur place ; tout autre réglage de comportement relance l'effet
    stop.set = function(k, v) {
      if (k !== 'height') return false;
      tall(v);
    };
    return stop;
  }
};
