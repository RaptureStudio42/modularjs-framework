// mjs_fx_tooltext — les aides des effets qui travaillent le texte de leur balise (lettres, compteur, défilé, cercle…) : le calque de texte, le découpage en lettres, la place d'un nombre
//   var tx = µ._mjs_fxLayer(comp, el[, draw[, own]]);
//   comp, el   le composant qui pose l'effet, sa balise
//   draw       absent : le calque de LETTRES, partagé par les effets de lettres de la même balise (compté) ; `draw(calque, texte)` : un calque à soi
//   own        l'effet règle lui-même la place de son calque (un défilé, un cercle)
//   rend { layer, text, onBuild, off } ; sur le calque de lettres partagé, une poignée à chaque effet
//   µ._mjs_fxSplit(calque, texte)   le texte en lettres dans le calque : mots insécables, lettres numérotées, nombre total
//   µ._mjs_fxLetters(texte)         les lettres d'un texte, comme le découpage les fait (les espaces n'en sont pas)
//   µ._mjs_fxRanks(n, ordre)        le rang de chaque lettre dans l'ordre d'un réglage `order`, pour un effet de lettres en JavaScript
//   µ._mjs_fxOrderCss(nom)          la feuille du réglage `order` d'un effet de lettres en CSS
//   µ._mjs_fxNumWidth(el, nœud, valeurs, fmt)   la balise d'un nombre garde la place du plus large des nombres qu'elle affichera (un `zoom` d'un ancêtre compris)
// la feuille commune de ces calques est µ._mjs_fxDefs._text ; le moteur (mjs_fx.ts) garde ce qui sert à tous les effets : le texte propre de la balise
// (µ._mjs_fxOwnText, µ._mjs_fxOwnMutation, µ._mjs_fxOnText), la place du texte, la racine d'un composant (µ._mjs_fxRoot), les caractères perçus (µ._mjs_fxGraphemes),
// l'écriture d'un nombre (µ._mjs_fxNum : *gauge s'en sert aussi)
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts)

// feuille commune des calques de texte (lettres, compteur, défilé) ; un calque `mjs-fx-fit` suit la
// place du texte dans sa balise
µ._mjs_fxDefs._text = {
  css: '[mjs-fx-over]{-webkit-text-fill-color:transparent}'
    + '[mjs-fx-layer="text"]{position:absolute;inset:0;box-sizing:border-box;padding:inherit;pointer-events:none;-webkit-text-fill-color:currentColor;white-space:inherit}'
    + µ._mjs_fxPlaceCss(function(a) { return a + '>[mjs-fx-fit]'; })
    + '[mjs-fx-word]{display:inline-block;white-space:nowrap}'
    + '[mjs-fx-letter]{display:inline-block;white-space:pre}'
    + '[mjs-fx-wait] [mjs-fx-layer="text"]{opacity:0}'
};

// calque de texte posé par-dessus la balise : le texte d'origine reste en place, invisible — il
// garde la mise en page, la lecture d'écran et la réactivité (un `{$titre}` continue d'écrire
// dans son nœud) ; le calque est reconstruit à chaque changement du texte, et remis dans la balise
// quand un script la réécrit (`textContent`, `innerHTML`, `innerHTML +=` emportent le calque avec le
// texte) : l'effet repart sur le texte neuf, comme pour un texte changé par `{$x}`. Sans `draw`, le calque
// porte les LETTRES, partagé par les effets de lettres d'une même balise (compté) ; avec
// `draw(calque, texte)`, un calque à soi (compteur, défilé). `onBuild(f)` : prévenu à chaque
// reconstruction. Le calque se range comme le texte de la balise (centré dans une grille, un flex,
// un bouton… cf. µ._mjs_fxPlace), sauf `own` : l'effet règle lui-même sa place (un défilé, un
// cercle). Rend { layer, text, onBuild, off } ; sur le calque de lettres partagé, une poignée à
// chaque effet, dont les abonnés partent avec lui (cf. _mjsFxLayerHand).
µ._mjs_fxLayer = function(comp, el, draw, own) {
  var shared = !draw;
  var st = shared ? el._mjs_fxTx : null;
  if (st) {
    st.n++;
    return _mjsFxLayerHand(st);
  }
  µ._mjs_fxAdopt(µ._mjs_fxRoot(comp), '_text');
  var layer = document.createElement('span');
  layer.setAttribute('mjs-fx-layer', 'text');
  layer.setAttribute('aria-hidden', 'true');
  if (!own) layer.setAttribute('mjs-fx-fit', '');

  // la marque du calque vivant : la copie figée qu'une relecture du HTML en laisse ne l'a pas
  layer._mjs_fxLive = true;

  var place = null;
  var subs = [];
  st = { n: 1, layer: layer };
  // rend le désabonnement
  st.onBuild = function(f) {
    subs.push(f);
    return function() {
      var i = subs.indexOf(f);
      if (i >= 0) subs.splice(i, 1);
    };
  };
  st.build = function() {
    var txt = µ._mjs_fxOwnText(el);
    // le texte d'origine, lu par les effets (jamais les lettres, qu'un effet peut brouiller)
    st.text = txt;
    layer.textContent = '';
    if (draw) draw(layer, txt);
    // un <br> de la balise, lu à part (U+2028) : un saut de ligne dans le calque de lettres, pas l'espace d'un \n de mise en forme
    else µ._mjs_fxSplit(layer, µ._mjs_fxOwnText(el, '\u2028'));
    if (place) place.again();
    for (var i = 0; i < subs.length; i++) subs[i](txt);
  };
  if (shared) el._mjs_fxTx = st;
  st.build();
  el._mjs_fxOverN = (el._mjs_fxOverN || 0) + 1;
  µ._mjs_dom.setAttribute(el, 'mjs-fx-over', '');
  var restore = µ._mjs_fxRelative(el);
  if (!own) place = µ._mjs_fxPlace(el);
  µ._mjs_dom.appendChild(el, layer);
  var mo = typeof MutationObserver === 'function' ? new MutationObserver(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (µ._mjs_fxOwnMutation(el, list[i])) {
        if (layer.parentNode !== el) _mjsFxLayerBack(el, layer);
        st.build();
        return;
      }
    }
  }) : null;
  if (mo) mo.observe(el, { childList: true, characterData: true, subtree: true });
  st.off = function() {
    if (--st.n > 0) return;
    if (mo) mo.disconnect();
    layer.remove();
    if (--el._mjs_fxOverN === 0) µ._mjs_dom.removeAttribute(el, 'mjs-fx-over');
    if (place) place.off();
    restore();
    if (shared) el._mjs_fxTx = null;
  };
  return shared ? _mjsFxLayerHand(st) : st;
};

// le calque qu'un script a emporté en réécrivant la balise revient, en dernier. Une relecture du HTML
// (`innerHTML +=`) en a laissé une copie figée, qui n'a pas la marque du calque vivant : elle part d'abord,
// sinon deux calques se superposeraient (les calques d'un autre effet de la même balise, vivants, restent)
function _mjsFxLayerBack(el, layer) {
  for (var c = el.firstChild, next; c; c = next) {
    next = c.nextSibling;
    if (c.nodeType === 1 && !c._mjs_fxLive && µ._mjs_dom.getAttribute(c, 'mjs-fx-layer') === 'text') µ._mjs_dom.remove(c);
  }
  µ._mjs_dom.appendChild(el, layer);
}

// la poignée d'un effet sur le calque de lettres partagé : ses abonnés partent à son arrêt — sinon,
// tant qu'un autre effet garde le calque, ils seraient encore prévenus de chaque reconstruction
function _mjsFxLayerHand(st) {
  var mine = [];
  var done = false;
  return {
    layer: st.layer,
    get text() { return st.text; },
    onBuild: function(f) { mine.push(st.onBuild(f)); },
    off: function() {
      if (done) return;
      done = true;
      for (var i = 0; i < mine.length; i++) mine[i]();
      st.off();
    }
  };
}

// la balise d'un nombre (*count, *delta) garde la place du plus large des nombres `vals`, écrits
// tour à tour par `fmt` dans `node` (son texte remis ensuite) : un minimum de largeur en em, qui
// suit la taille du texte — sans lui, elle n'a que la largeur du nombre brut (`12480`), et
// séparateurs, préfixe et suffixe débordent sur la suite. `base` : la largeur minimale écrite en ligne sur la balise avant l'effet
µ._mjs_fxNumWidth = function(el, node, vals, fmt, base) {
  if (typeof getComputedStyle !== 'function' || typeof document.createRange !== 'function') return;
  var keep = node.textContent;
  var r    = document.createRange();
  var w    = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i] === null || vals[i] === void 0) continue;
    node.textContent = fmt(vals[i]);
    r.selectNodeContents(node);
    w = Math.max(w, µ._mjs_dom.getBoundingClientRect(r).width);
  }
  node.textContent = keep;
  if (!w) return;
  var cs  = getComputedStyle(el);
  var ext = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
  var bb  = cs.boxSizing === 'border-box';
  // un ancêtre en `zoom` (ou en `transform: scale`) : le texte est mesuré dans le repère de la fenêtre, la taille du texte (em) se lit dans celui de la mise en page ;
  // k, le rapport des deux, est celui de la boîte de la balise (sa largeur dans la fenêtre, sa largeur calculée dans la mise en page, marges internes et bordures comprises)
  var lay = parseFloat(cs.width) + (bb ? 0 : ext);
  var k   = (lay > 0 && µ._mjs_dom.getBoundingClientRect(el).width / lay) || 1;
  if (Math.abs(k - 1) < .001) k = 1;
  var em  = (Math.ceil(w / k) / (parseFloat(cs.fontSize) || 16)).toFixed(4);
  var pad = bb ? ext : 0;
  var want = pad ? 'calc(' + em + 'em + ' + pad + 'px)' : em + 'em';
  // la largeur minimale que la page donne déjà à la balise (sa feuille, son style d'origine `base`) : la place réservée ne descend
  // jamais sous elle (une colonne de chiffres alignés, une carte de statistiques garde sa largeur)
  el.style.minWidth = base || '';
  var floor = getComputedStyle(el).minWidth;
  // une longueur ou une part (pas auto, ni un mot comme min-content, que max() ne prend pas)
  el.style.minWidth = /^[\d.]/.test(floor) && floor !== '0px' ? 'max(' + floor + ', ' + want + ')' : want;
};

// les lettres d'un texte, comme le calque de lettres les fait (µ._mjs_fxSplit) : chaque mot en caractères
// perçus, sans les espaces — une espace suivie d'un signe combinant n'est pas un caractère, le signe en est un
µ._mjs_fxLetters = function(txt) {
  var out   = [];
  var parts = txt.split(/(\s+)/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '' || /^\s+$/.test(parts[i])) continue;
    out = out.concat(µ._mjs_fxGraphemes(parts[i]));
  }
  return out;
};

// le texte en lettres dans le calque : mots insécables, lettres numérotées (`--i`), nombre total
// (`--n` sur le calque) ; une lettre par caractère perçu (cf. µ._mjs_fxGraphemes)
µ._mjs_fxSplit = function(layer, txt) {
  var n = 0;
  var letters = [];
  var parts = txt.split(/(\s+)/);
  for (var w = 0; w < parts.length; w++) {
    var part = parts[w];
    if (part === '') continue;
    if (/^\s+$/.test(part)) {
      // U+2028 (un <br> de la balise, cf. µ._mjs_fxLayer) : un <br> dans le calque
      var bits = part.split('\u2028');
      for (var b = 0; b < bits.length; b++) {
        if (b > 0) layer.appendChild(document.createElement('br'));
        if (bits[b]) layer.appendChild(document.createTextNode(bits[b]));
      }
      continue;
    }
    var word = document.createElement('span');
    word.setAttribute('mjs-fx-word', '');
    var chars = µ._mjs_fxGraphemes(part);
    for (var i = 0; i < chars.length; i++) {
      var l = document.createElement('span');
      l.setAttribute('mjs-fx-letter', '');
      n++;
      l.textContent = chars[i];
      letters.push(l);
      word.appendChild(l);
    }
    layer.appendChild(word);
  }
  // le rang de chaque lettre dans cinq ordres de parcours (réglage `direction` des effets de
  // lettres) : --i de gauche à droite, --ri de droite à gauche, --ci du centre vers les bords, --ei
  // des bords vers le centre, --xi au hasard
  var mid  = (n - 1) / 2;
  var tire = letters.map(function(_, j) { return j; });
  for (var k = tire.length - 1; k > 0; k--) {
    var r = Math.floor(Math.random() * (k + 1));
    var t = tire[k];
    tire[k] = tire[r];
    tire[r] = t;
  }
  for (var j = 0; j < letters.length; j++) {
    var st = letters[j].style;
    st.setProperty('--i', String(j));
    st.setProperty('--ri', String(n - 1 - j));
    st.setProperty('--ci', String(Math.round(Math.abs(j - mid))));
    st.setProperty('--ei', String(Math.round(mid - Math.abs(j - mid))));
    st.setProperty('--xi', String(tire[j]));
  }
  layer.style.setProperty('--n', String(n));
};

// CSS du réglage `order` d'un effet de lettres (attribut `mjs-fx-<nom>-order`) : `--mjs-fx-<nom>-k`
// prend le rang voulu (cf. µ._mjs_fxSplit), l'effet s'en sert pour décaler ses lettres
µ._mjs_fxOrderCss = function(name) {
  var at = '[mjs-fx~="' + name + '"] [mjs-fx-letter]';
  var by = function(order, v) { return '[mjs-fx~="' + name + '"][mjs-fx-' + name + '-order="' + order + '"] [mjs-fx-letter]{--mjs-fx-' + name + '-k:var(' + v + ')}'; };
  return at + '{--mjs-fx-' + name + '-k:var(--i)}' + by('left', '--ri') + by('center', '--ci') + by('edges', '--ei') + by('random', '--xi');
};

// le rang de chaque lettre dans l'ordre `order` (right, left, center, edges, random), pour un effet
// de lettres en JavaScript : n rangs, le premier servi au rang 0
µ._mjs_fxRanks = function(n, order) {
  var mid = (n - 1) / 2;
  var out = [];
  for (var j = 0; j < n; j++) {
    out.push(order === 'left' ? n - 1 - j : order === 'center' ? Math.round(Math.abs(j - mid)) : order === 'edges' ? Math.round(mid - Math.abs(j - mid)) : j);
  }
  if (order === 'random') {
    for (var k = out.length - 1; k > 0; k--) {
      var r = Math.floor(Math.random() * (k + 1));
      var t = out[k];
      out[k] = out[r];
      out[r] = t;
    }
  }
  return out;
};
