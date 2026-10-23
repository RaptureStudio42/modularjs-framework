// mjs_fx_sprite — `*sprite` : une planche de poses animée par à-coups, comme un dessin animé (une marche,
// un battement d'ailes, une explosion). La balise montre UNE pose à la fois : un calque intérieur, aussi
// grand que la planche (une pose = la balise), glisse sous la balise qui rogne ; chaque pose est une
// position du calque, atteinte d'un bond (animation CSS `step-end` sur `translate`) — aucun script par
// image, aucune peinture : le compositeur seul déplace le calque. Une seule animation couvre planche à une
// ou plusieurs lignes, dernière ligne incomplète, aller-retour. L'image part quand la balise approche de
// l'écran. La balise garde sa taille ; sans taille, elle prend celle d'une pose (largeur de la planche
// divisée par columns), connue au chargement de l'image : `aspect-ratio` est posé alors.
// Réglages : image (la planche : toutes les poses, de gauche à droite puis de haut en bas), frames (le
// nombre de poses ; 1), columns (le nombre de poses par ligne ; non écrit : une seule ligne), speed (la
// durée d'un tour complet ; 1s), repeat (le nombre de tours, chacun un passage de la planche ; 0 = sans
// fin), direction (normal ; reverse : de la dernière pose à la première ; alternate : un tour à l'endroit,
// le suivant à l'envers), start (la pose montrée au repos, c'est-à-dire hors du mouvement ; 0), pixel (le
// dessin à gros pixels : rendu net, sans lissage ; non), on (always, hover, view, click, load : le
// mouvement tourne tant que la condition tient ; sans fin par défaut, y compris après un clic — `repeat: 1`
// pour un seul tour par clic). Un tour fini revient à la pose `start`, sauf avec `hold`.
// Plus : fps (la cadence en poses par seconde, au lieu de speed : écrits ensemble, fps l'emporte), poses
// (l'ordre des cases, [1, 2, 1, 0] ; les numéros de case de la planche, ou des colonnes d'une ligne avec rows),
// rows + row (une animation par ligne de la planche : rows lignes, row choisit la ligne, une variable la
// change sans rien reposer ; frames ou columns disent combien de poses a une ligne), animate (faux : la
// planche revient à la pose `start` et s'arrête), hold (garder la dernière pose à la fin d'un tour).
// Chaque tour fini signale l'événement `mjs:sprite-end` sur la balise (`@mjs:sprite-end={…}`) ; sans écouteur écrit par l'appli, rien
// n'est écouté ni fabriqué à chaque tour.
// Sections marquées (`// @@ …`, filtrées par le build, bundler/fx-sections.ts) : fps, poses, rows, row, animate, hold et end ne partent que
// si l'appli écrit le réglage (ou `@mjs:sprite-end` pour end) ; tel quel, le fichier porte tout.
// Hors écran (à 100 px près) et onglet caché : l'animation est en pause, `will-change` retiré ; un tour
// fini (repeat) le retire aussi. « Réduire les animations » : la pose `start`, figée.
// Sur l'écran, une pose commence toujours sur un pixel entier : la taille d'une pose du calque est arrondie
// au pixel de l'écran supérieur (relu quand la densité change), la balise rogne l'excédent — sans cela, à la
// densité 1,25 ou avec une taille décimale, la première ligne de pixels montrait la pose voisine.
// Image absente : aucune animation, un avertissement.

var _mjsFxSpriteCache = {};
var _mjsFxSpriteSubs  = [];

// un entier du réglage, ramené dans sa plage ; `dflt` sinon
function _mjsFxSpriteInt(v, dflt, min, max) {
  var n = Math.round(Number(v));
  return isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

// un pourcentage court (4 décimales : un millième de pixel sur une planche de mille poses)
function _mjsFxSpriteNum(n) {
  return String(Math.round(n * 1e4) / 1e4);
}

// la place du calque pour la pose `k` : en pourcentage du calque (columns poses de large, rows de haut)
function _mjsFxSpriteAt(k, columns, rows) {
  return _mjsFxSpriteNum(-(k % columns) / columns * 100) + '% ' + _mjsFxSpriteNum(-Math.floor(k / columns) / rows * 100) + '%';
}

// le nombre de tours en valeur CSS : 0 (ou rien) = sans fin
function _mjsFxSpriteCount(v) {
  var n = Math.round(Number(v));
  return n > 0 ? String(n) : 'infinite';
}

// @@ poses
// les numéros de case du réglage `poses` (une liste de mots, ou un seul) : des entiers de 0 à 999 ; une entrée
// qui n'en est pas un est écartée avec un avertissement ; rien de valable : null (l'ordre de lecture)
function _mjsFxSpritePoses(v) {
  if (v === void 0 || v === null) return null;
  var list = Array.isArray(v) ? v : [v];
  var out  = [];
  for (var i = 0; i < list.length && out.length < 1000; i++) {
    var txt = String(list[i]).trim();
    if (/^\d+$/.test(txt)) out.push(Math.min(999, Number(txt)));
    else µ.warn(µ._mjs_msg('spritePoses', { valeur: txt }, '*sprite : poses : « {valeur} » n\'est pas un numéro de case — écarté'));
  }
  return out.length > 0 ? out : null;
}
// @@

// @@ poses rows
// la planche décrite par les réglages : columns (poses par ligne du calque), grid (lignes du calque), list (les
// cases jouées, dans l'ordre), cap (le nombre de cases permises à `poses` et `start`), row (la ligne montrée
// avec rows, -1 sinon), plain (l'ordre de lecture, sans poses)
function _mjsFxSpriteModel(s) {
  var poses = null;
  var top   = 0;
  // @@ poses
  poses = _mjsFxSpritePoses(s.poses);
  top   = poses ? Math.max.apply(null, poses) + 1 : 0;
  // @@
  var fr    = s.frames === void 0 ? 0 : _mjsFxSpriteInt(s.frames, 1, 1, 1000);
  var co    = s.columns === void 0 ? 0 : _mjsFxSpriteInt(s.columns, 1, 1, 1000);
  var m     = { plain: !poses, row: -1 };
  var n     = fr || top || 1;
  m.columns = co || n;
  m.grid    = Math.ceil(n / m.columns);
  m.cap     = n;
  // @@ rows
  if (s.rows !== void 0) {
    m.columns = co || fr || top || 1;
    m.grid    = _mjsFxSpriteInt(s.rows, 1, 1, 1000);
    m.row     = Math.min(_mjsFxSpriteInt(s.row, 0, 0, 999), m.grid - 1);
    m.cap     = m.columns;
    n         = Math.min(fr || m.columns, m.columns);
  }
  // @@
  m.list = [];
  for (var i = 0; i < n; i++) m.list.push(i);
  // @@ poses
  if (poses) {
    m.list = [];
    for (var j = 0; j < poses.length; j++) m.list.push(Math.min(poses[j], m.cap - 1));
  }
  // @@
  return m;
}
// @@

// les images clés d'une suite de cases sur `columns` colonnes (`grid` lignes au calque) : une par entrée,
// chacune tenue jusqu'à la suivante (`step-end`) ; la dernière tenue aussi à 100 %, pour que le sens inverse
// commence sur la dernière
function _mjsFxSpriteKeyframes(name, list, columns, grid) {
  var css = '@keyframes ' + name + '{';
  for (var i = 0; i < list.length; i++) css += String(+(i / list.length * 100).toFixed(5)) + '%{translate:' + _mjsFxSpriteAt(list[i], columns, grid) + '}';
  return css + '100%{translate:' + _mjsFxSpriteAt(list[list.length - 1], columns, grid) + '}}';
}

// les images clés d'une planche, adoptées une fois par racine (shadow root du composant, ou document) ;
// rend leur nom. Chaque balise qui s'en sert est comptée : la feuille repart avec la dernière (cf. _mjsFxSpriteDrop)
function _mjsFxSpriteKeys(root, m, columns, grid) {
  var name = 'mjs-fx-sprite-' + m.list.length + '-' + columns;
  if (!m.plain) name = 'mjs-fx-sprite-p' + m.list.join('_') + '-' + columns + '-' + grid; // @@ poses
  var item = _mjsFxSpriteCache[name];
  if (!item) {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(_mjsFxSpriteKeyframes(name, m.list, columns, grid));
    sheet._mjs_keep = true;
    item = _mjsFxSpriteCache[name] = { sheet: sheet, roots: [] };
  }
  item.roots.push(root);
  if (root.adoptedStyleSheets.indexOf(item.sheet) < 0) root.adoptedStyleSheets = root.adoptedStyleSheets.concat([item.sheet]);
  return name;
}

// une balise de moins pour la feuille : elle quitte la racine avec la dernière balise qui s'en servait là,
// et le cache avec la dernière de toutes les racines
function _mjsFxSpriteDrop(root, name) {
  var item = _mjsFxSpriteCache[name];
  var i    = item ? item.roots.indexOf(root) : -1;
  if (i < 0) return;
  item.roots.splice(i, 1);
  if (item.roots.indexOf(root) < 0) root.adoptedStyleSheets = root.adoptedStyleSheets.filter(function(f) { return f !== item.sheet; });
  if (item.roots.length === 0) delete _mjsFxSpriteCache[name];
}

// la racine où vit la balise : celle où le moteur a adopté la feuille de l'effet
function _mjsFxSpriteRoot(comp) {
  var sh = comp && comp._shadow;
  if (sh && sh.nodeType === 11) return sh;
  var r = comp && comp.getRootNode ? µ._mjs_dom.getRootNode(comp) : null;
  return r && (r.nodeType === 11 || r.nodeType === 9) ? r : document;
}

// un seul écouteur de visibilité pour tous les sprites : posé avec le premier, retiré avec le dernier
function _mjsFxSpriteVisible() {
  for (var i = 0; i < _mjsFxSpriteSubs.length; i++) _mjsFxSpriteSubs[i]();
}

function _mjsFxSpriteWatch(f) {
  if (_mjsFxSpriteSubs.length === 0) document.addEventListener('visibilitychange', _mjsFxSpriteVisible, { passive: true });
  _mjsFxSpriteSubs.push(f);
  return function() {
    var i = _mjsFxSpriteSubs.indexOf(f);
    if (i < 0) return;
    _mjsFxSpriteSubs.splice(i, 1);
    if (_mjsFxSpriteSubs.length === 0) document.removeEventListener('visibilitychange', _mjsFxSpriteVisible);
  };
}

// un pixel de l'écran, en pixels CSS (0.8px à la densité 1,25)
function _mjsFxSpritePx() {
  var d = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return String(+(1 / d).toFixed(6)) + 'px';
}

// un seul écouteur de densité pour tous les sprites (zoom de la page, fenêtre passée sur un autre écran) : une
// requête ne prévient que d'un changement de la densité qu'elle a lue, elle est donc refaite à chaque changement
var _mjsFxSpriteDense = [];
var _mjsFxSpriteQuery = null;

function _mjsFxSpriteDenseArm() {
  if (_mjsFxSpriteQuery) _mjsFxSpriteQuery.removeEventListener('change', _mjsFxSpriteDenseTick);
  _mjsFxSpriteQuery = typeof matchMedia === 'function' && typeof devicePixelRatio === 'number' ? matchMedia('(resolution: ' + devicePixelRatio + 'dppx)') : null;
  if (_mjsFxSpriteQuery && typeof _mjsFxSpriteQuery.addEventListener === 'function') _mjsFxSpriteQuery.addEventListener('change', _mjsFxSpriteDenseTick);
}

function _mjsFxSpriteDenseTick() {
  _mjsFxSpriteDenseArm();
  for (var i = 0; i < _mjsFxSpriteDense.length; i++) _mjsFxSpriteDense[i]();
}

function _mjsFxSpriteDensity(f) {
  if (_mjsFxSpriteDense.length === 0) _mjsFxSpriteDenseArm();
  _mjsFxSpriteDense.push(f);
  return function() {
    var i = _mjsFxSpriteDense.indexOf(f);
    if (i < 0) return;
    _mjsFxSpriteDense.splice(i, 1);
    if (_mjsFxSpriteDense.length === 0 && _mjsFxSpriteQuery) {
      _mjsFxSpriteQuery.removeEventListener('change', _mjsFxSpriteDenseTick);
      _mjsFxSpriteQuery = null;
    }
  };
}

µ._mjs_fxDefs.sprite = {
  image: true,
  css: '[mjs-fx~="sprite"][mjs-fx-sprite-clip]{overflow:hidden;overflow:clip}'
    // une balise sans taille prend celle d'une pose ; `:where` : la taille que l'auteur lui donne l'emporte toujours
    + ':where([mjs-fx~="sprite"][mjs-fx-sprite-sized]){width:var(--mjs-fx-sprite-w);max-width:100%;aspect-ratio:var(--mjs-fx-sprite-ratio)}'
    + '[mjs-fx-layer="sprite"]{position:absolute;top:0;left:0;margin:0;max-width:none;width:calc(var(--mjs-fx-sprite-c,1) * 100%);height:calc(var(--mjs-fx-sprite-r,1) * 100%);pointer-events:none;background:var(--mjs-fx-sprite-img) 0 0/100% 100% no-repeat;translate:var(--mjs-fx-sprite-at,0 0);will-change:var(--mjs-fx-sprite-go,var(--mjs-fx-sprite-wc,translate));animation:var(--mjs-fx-sprite-go,var(--mjs-fx-sprite-name,none)) var(--mjs-sprite-speed,1s) step-end 0s var(--mjs-fx-sprite-count,infinite) var(--mjs-sprite-direction,normal);animation-play-state:var(--mjs-fx-sprite-play,running)}'
    + '[mjs-fx-layer="sprite"][mjs-fx-sprite-pixel]{image-rendering:crisp-edges;image-rendering:pixelated}'
    // fps : la durée d'un tour posée sur le calque passe devant speed
    + '[mjs-fx-layer="sprite"]{animation-duration:var(--mjs-fx-sprite-dur,var(--mjs-sprite-speed,1s))}' // @@ fps
    // rows : la ligne montrée décale le calque vers le haut (d'une pose arrondie au pixel de l'écran quand il y a plusieurs poses)
    + '[mjs-fx-layer="sprite"]{top:calc(var(--mjs-fx-sprite-row,0) * -100%)}' // @@ rows
    + '@supports (width:round(up,10px,1px)){[mjs-fx-layer="sprite"][mjs-fx-sprite-snap]{top:calc(var(--mjs-fx-sprite-row,0) * -1 * round(up,calc(100% - 0.01px),var(--mjs-fx-sprite-px,1px)))}}' // @@ rows
    // hold : la dernière pose reste à la fin d'un tour
    + '[mjs-fx-layer="sprite"][mjs-fx-sprite-hold]{animation-fill-mode:forwards}' // @@ hold
    // la taille d'une pose arrondie au pixel de l'écran supérieur (0.01px de marge pour l'erreur de calcul) ; sans `round()`, la taille de la balise
    + '@supports (width:round(up,10px,1px)){[mjs-fx-layer="sprite"][mjs-fx-sprite-snap]{width:calc(var(--mjs-fx-sprite-c,1) * round(up,calc(100% - 0.01px),var(--mjs-fx-sprite-px,1px)));height:calc(var(--mjs-fx-sprite-r,1) * round(up,calc(100% - 0.01px),var(--mjs-fx-sprite-px,1px)))}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="sprite"]{animation:none;will-change:auto}}',
  vars: { speed: '', direction: '' },
  setup: function(el, s, comp) {
    var frames  = _mjsFxSpriteInt(s.frames, 1, 1, 1000);
    var columns = s.columns === void 0 ? frames : _mjsFxSpriteInt(s.columns, frames, 1, 1000);
    var rows    = Math.ceil(frames / columns);
    var m       = { cap: frames, list: [] };
    for (var k = 0; k < frames; k++) m.list.push(k);
    // @@ poses rows
    m       = _mjsFxSpriteModel(s);
    columns = m.columns;
    rows    = m.grid;
    // @@
    // @@ row
    // row: 0 sans rows est la première (et seule) ligne : rien à dire, le catalogue pose ce défaut
    if (s.rows === void 0 && s.row !== void 0 && _mjsFxSpriteInt(s.row, 0, 0, 999) > 0) µ.warn(µ._mjs_msg('spriteRow', null, '*sprite : row sans rows — row est ignoré'));
    // @@
    var start   = Math.min(_mjsFxSpriteInt(s.start, 0, 0, 999), m.cap - 1);
    // la variante d'une image à plusieurs tailles se choisit sur la largeur de la planche entière, pas d'une pose
    var url = µ._mjs_fxImage(s.image, { getBoundingClientRect: function() { return { width: µ._mjs_dom.getBoundingClientRect(el).width * columns }; } });
    if (!url) return function() {};
    // la balise d'un composant : le calque est dans le composant, les images clés aussi
    var inner = µ._mjs_fxInner(el);
    var host  = inner || el;
    if (inner) µ._mjs_fxAdopt(inner, 'sprite');
    var root  = inner || _mjsFxSpriteRoot(comp);
    var name  = m.list.length > 1 ? _mjsFxSpriteKeys(root, m, columns, rows) : '';
    var unbox = µ._mjs_fxMovable(el);
    var unpos = µ._mjs_fxRelative(el);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-sprite-clip', '');
    var layer = document.createElement('span');
    layer.setAttribute('mjs-fx-layer', 'sprite');
    layer.setAttribute('aria-hidden', 'true');
    if (s.pixel) layer.setAttribute('mjs-fx-sprite-pixel', '');
    if (s.hold) layer.setAttribute('mjs-fx-sprite-hold', ''); // @@ hold
    var st = layer.style;
    // plusieurs poses : chacune commence sur un pixel entier de l'écran, relu quand la densité change
    var unpx = function() {};
    if (name) {
      layer.setAttribute('mjs-fx-sprite-snap', '');
      st.setProperty('--mjs-fx-sprite-px', _mjsFxSpritePx());
      unpx = _mjsFxSpriteDensity(function() { st.setProperty('--mjs-fx-sprite-px', _mjsFxSpritePx()); });
    }
    st.setProperty('--mjs-fx-sprite-img', 'url(' + JSON.stringify(url) + ')');
    st.setProperty('--mjs-fx-sprite-c', String(columns));
    st.setProperty('--mjs-fx-sprite-r', String(rows));
    st.setProperty('--mjs-fx-sprite-at', _mjsFxSpriteAt(start, columns, rows));
    st.setProperty('--mjs-fx-sprite-count', _mjsFxSpriteCount(s.repeat));
    if (m.row >= 0) st.setProperty('--mjs-fx-sprite-row', String(m.row)); // @@ rows
    // @@ fps
    // la cadence : la durée d'un tour est le nombre d'entrées ÷ fps ; sans fps, speed (variable CSS de la balise)
    var now  = { fps: s.fps, speed: s.speed };
    var rate = function() {
      var f = Number(now.fps);
      if (name && f > 0 && isFinite(f)) st.setProperty('--mjs-fx-sprite-dur', _mjsFxSpriteNum(m.list.length / f) + 's');
      else st.removeProperty('--mjs-fx-sprite-dur');
    };
    var clash = function() {
      µ.warn(µ._mjs_msg('spriteFps', null, '*sprite : fps et speed sont écrits tous les deux — fps l\'emporte'));
    };
    rate();
    if (now.fps !== void 0 && now.speed !== void 0) clash();
    // @@
    // une seule pose : rien à animer, rien à promouvoir
    if (name) st.setProperty('--mjs-fx-sprite-name', name);
    else st.setProperty('--mjs-fx-sprite-wc', 'auto');
    µ._mjs_dom.appendChild(host, layer);
    var gate = µ._mjs_fxLoop(el, 'sprite', s.on);
    // hors écran ou onglet caché : en pause (`view` s'arrête déjà de lui-même hors écran) ; en pause ou le dernier
    // tour fini : plus de will-change
    var out   = false;
    var done  = false;
    // à l'arrêt : l'image est absente, ou animate est faux ; la planche reste sur la pose start
    var lost  = false; // @@ animate
    var idle  = false; // @@ animate
    idle = s.animate === false; // @@ animate
    var pause = function() {
      var still = out || document.hidden;
      if (still) st.setProperty('--mjs-fx-sprite-play', 'paused');
      else st.removeProperty('--mjs-fx-sprite-play');
      if (still || done) st.setProperty('--mjs-fx-sprite-wc', 'auto');
      else if (name) st.removeProperty('--mjs-fx-sprite-wc');
      // @@ animate
      if (lost || idle) {
        st.setProperty('--mjs-fx-sprite-go', 'none');
        st.setProperty('--mjs-fx-sprite-wc', 'auto');
      }
      else st.removeProperty('--mjs-fx-sprite-go');
      // @@
    };
    // @@ end
    // chaque tour fini est annoncé à l'auteur : un événement sur la balise, fabriqué seulement si l'appli écoute `mjs:sprite-end`
    var signal  = function() {
      µ._mjs_dom.dispatchEvent(el, new CustomEvent('mjs:sprite-end', { bubbles: true, composed: true }));
    };
    // @@
    var ended   = function() {
      done = true;
      pause();
      signal(); // @@ end
    };
    var started = function() {
      done = false;
      pause();
    };
    if (name) {
      layer.addEventListener('animationend', ended, { passive: true });
      layer.addEventListener('animationstart', started, { passive: true });
      layer.addEventListener('animationiteration', signal, { passive: true }); // @@ end
    }
    var seen = null;
    var enter = function() {
      if (!out) return;
      out = false;
      pause();
    };
    var leave = function() {
      if (out) return;
      out = true;
      pause();
    };
    if (name && s.on !== 'view' && typeof IntersectionObserver === 'function') seen = µ._mjs_fxVisible(el, '100px', enter, leave);
    var unwatch = name ? _mjsFxSpriteWatch(pause) : function() {};
    if (name) pause();
    if (idle) pause(); // @@ animate
    // la taille d'une pose, connue quand l'image est là
    var probe = null;
    if (typeof Image === 'function') {
      probe = new Image();
      probe.onload = function() {
        if (!probe.naturalWidth || !probe.naturalHeight) return;
        var w  = probe.naturalWidth / columns;
        var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        // une hauteur donnée (par l'auteur ou la mise en page) : la largeur en découle par le rapport d'une pose, la pose n'est pas étirée
        el.style.setProperty('--mjs-fx-sprite-w', cs && parseFloat(cs.height) > 0 ? 'auto' : _mjsFxSpriteNum(w) + 'px');
        el.style.setProperty('--mjs-fx-sprite-ratio', _mjsFxSpriteNum(w) + ' / ' + _mjsFxSpriteNum(probe.naturalHeight / rows));
        µ._mjs_dom.setAttribute(el, 'mjs-fx-sprite-sized', '');
      };
      // sans image, la planche ne défile pas pour rien
      probe.onerror = function() {
        st.setProperty('--mjs-fx-sprite-go', 'none');
        lost = true; // @@ animate
        pause(); // @@ animate
        µ.warn(µ._mjs_msg('spriteImage', { url: url.length > 80 ? url.slice(0, 77) + '…' : url }, '*sprite : l\'image {url} est introuvable — la planche n\'est pas animée'));
      };
      probe.src = url;
    }
    var off = function() {
      gate();
      unwatch();
      if (seen) seen();
      if (probe) probe.onload = probe.onerror = null;
      layer.removeEventListener('animationend', ended);
      layer.removeEventListener('animationstart', started);
      layer.removeEventListener('animationiteration', signal); // @@ end
      unpx();
      layer.remove();
      if (name) _mjsFxSpriteDrop(root, name);
      el.style.removeProperty('--mjs-fx-sprite-w');
      el.style.removeProperty('--mjs-fx-sprite-ratio');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-sprite-sized');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-sprite-clip');
      unpos();
      unbox();
    };
    // la vitesse et le sens suivent d'eux-mêmes (variables CSS) ; le nombre de tours, la cadence, la ligne, l'arrêt et
    // la dernière pose gardée se relisent ; le reste repose l'effet
    off.set = function(k, v) {
      if (k === 'repeat') st.setProperty('--mjs-fx-sprite-count', _mjsFxSpriteCount(v));
      // @@ fps
      else if (k === 'fps' || k === 'speed') {
        var before = now.fps !== void 0 && now.speed !== void 0;
        now[k] = v;
        rate();
        if (!before && now.fps !== void 0 && now.speed !== void 0) clash();
      }
      // @@
      // @@ rows row
      else if (k === 'row') {
        if (m.row >= 0) st.setProperty('--mjs-fx-sprite-row', String(Math.min(_mjsFxSpriteInt(v, 0, 0, 999), rows - 1)));
      }
      // @@
      // @@ animate
      else if (k === 'animate') {
        idle = v === false;
        pause();
      }
      // @@
      // @@ hold
      else if (k === 'hold') {
        if (v) layer.setAttribute('mjs-fx-sprite-hold', '');
        else layer.removeAttribute('mjs-fx-sprite-hold');
      }
      // @@
      else return k === 'direction' || k === 'speed';
      return true;
    };
    return off;
  }
};
