// mjs_fx_pointer — `*pointer(style)` : le curseur de celui qui regarde. Un disque suit la souris avec un
// léger retard, grossit sur ce qui se clique (un lien, un bouton, un champ, une balise à `data-pointer`),
// et selon le réglage inverse les couleurs dessous, floute, passe en noir et blanc, ou porte un mot.
// Posé sur `<@document>`, il suit la souris dans toute la page ; posé sur une balise, seulement au-dessus
// d'elle. Il vit dans un calque posé dans le document, qui ne gêne jamais la souris : un élément par pièce
// du curseur, chacun fixe (le mode de fusion d'un enfant d'un calque fixe ne verrait pas la page) et
// déplacé par `translate` — le JavaScript n'écrit que la position ; la taille, la forme et le
// grossissement passent par des variables CSS, `scale` et des transitions CSS. Rien ne tourne quand la
// souris ne bouge pas : une seule boucle de lissage, qui s'arrête quand le disque a rejoint la souris
// (moins de 0,1 px d'écart) ; ce qui est sous la souris se relit à l'image où la souris a bougé (jamais
// au repos), avant les écritures de l'image : la cible du dernier mouvement, et, quand c'est la balise d'un
// composant (son ombre est fermée), un test de pointage de racine en racine ; aucune boîte n'est lue. Un
// écran sans souris (`hover: none`) : rien n'est posé ; la souris sort de la fenêtre (ou de la balise) :
// le disque s'efface ; « réduire les animations » : le disque suit sans retard ni grossissement animé.
// `outside` : un voile — un calque qui filtre (backdrop-filter) tout ce qu'il recouvre, laisse passer la
// souris, et que perce un trou (un masque en dégradé radial, bord adouci sur 6 px) — remplace la lentille :
// le disque ne filtre plus, il est le trou. Sur <@document> le voile est fixe et couvre la fenêtre ; sur une
// balise, il est un enfant de la balise (dans son shadow root si c'est un composant), qui prend `position:
// relative` le temps de l'effet si elle n'en a pas : il défile, est rogné et arrondi comme elle. Par image, le
// JavaScript n'écrit que la position du trou (deux variables du voile) en plus de celle du disque, dans la même
// boucle ; la boîte de la balise est lue une fois à l'entrée de la souris et relue seulement après un
// défilement, un redimensionnement ou un changement de taille (une seule image alors : le trou reste sous
// la souris). Le rayon du trou suit `size`, `grow` et `press` par une transition CSS (propriété enregistrée,
// comme le disque et son `scale`) ; sans cette propriété (navigateur ancien) il change d'un coup. Les autres
// styles ignorent `outside`.
// `soft` (lentille, px, 0 = bord franc) : un bord progressif entre la zone filtrée et la zone nette. Avec `outside`, le
// masque du voile est un dégradé qui part transparent au rayon du trou et finit opaque `soft` plus loin (propriété
// enregistrée --mjs-fx-pointer-e, qui joue le grossissement et l'appui comme le rayon) ; sans `outside`, le disque
// s'agrandit de `soft` de chaque côté et un masque en dégradé radial fond le filtre vers l'extérieur. Même masque, même
// variables : le JavaScript n'écrit rien de plus par image. La largeur se mesure à la taille de repos et grossit avec le disque.
// Les styles :
//   disc : un disque plein
//   ring : un anneau
//   dot  : un point collé à la souris et un anneau qui la suit avec plus de retard
//   lens : une lentille qui applique `filter` à ce qu'elle recouvre (backdrop-filter)
// Réglages : style (disc), color (la couleur ; #fff), size (le diamètre, en px ; 36), blend (le mode de
// fusion du disque avec la page — difference, normal, exclusion, screen, multiply, overlay ; difference :
// un disque blanc inverse ce qu'il recouvre), filter (lens : ce que la lentille fait au dessous —
// grayscale, invert, blur, saturate, sepia, hue ; grayscale), outside (lens : le filtre s'applique
// PARTOUT SAUF dans le disque, qui reste net et suit la souris — même retard, même grossissement sur ce
// qui se clique, même resserrement à l'appui ; sur <@document> toute la page, sur une balise cette balise
// seulement ; non), soft (le bord progressif de la lentille, en px ; 0), grow (le grossissement sur ce qui se clique ; 2.2), smooth (le retard : 1 = collé à la souris ; 0.18), hide (cache le curseur du système au-
// dessus de la zone, sauf sur un champ de saisie ; non), text (sur une balise à `data-pointer="mot"`, le
// disque montre le mot, écrit par `textContent` ; oui), press (la taille pendant l'appui, comme part de
// la taille de repos ; 0.8), zindex (2147483000).
// La couche du dessus (une boîte de dialogue modale, un popover ouvert, une partie de la page en plein écran) passe au-dessus de
// tout z-index : le disque n'y paraît pas. Il s'y éteint, et le curseur du système y reste visible, même avec `hide`. Posé DANS
// l'une d'elles (une zone dans une boîte de dialogue ouverte par `showModal()`), il y vit : son calque y est mis à l'entrée de la
// souris, et le disque s'y voit ; avec `hide`, le curseur du système y est caché aussi, liens compris.

// la couche du dessus, que le disque ne dépasse pas (`:where` : un navigateur qui ne connaît pas l'un des mots garde les autres)
var _MJS_FX_POINTER_TOP = ':where(dialog:modal,:popover-open,:fullscreen:not(html,body))';

µ._mjs_fxDefs.pointer = {
  css: '[mjs-fx-pointer-layer]{display:contents}'
    + '[mjs-fx-pointer-layer] > *{position:fixed;left:0;top:0;box-sizing:border-box;pointer-events:none;z-index:var(--mjs-pointer-zindex,2147483000);opacity:0;visibility:hidden;transition:opacity .2s,visibility 0s .2s,scale .25s cubic-bezier(.2,.8,.2,1)}'
    + '[mjs-fx-pointer-layer][mjs-fx-pointer-on] > *{opacity:1;visibility:visible;transition:opacity .2s,visibility 0s,scale .25s cubic-bezier(.2,.8,.2,1)}'
    + '[mjs-fx-pointer-layer][mjs-fx-pointer-live] > *{will-change:translate}'
    + '[mjs-fx-pointer-layer][mjs-fx-pointer-hot]{--mjs-fx-pointer-g:var(--mjs-pointer-grow,2.2)}'
    + '[mjs-fx-pointer-layer][mjs-fx-pointer-down]{--mjs-fx-pointer-p:var(--mjs-pointer-press,.8)}'
    + '[mjs-fx-pointer-layer] > i{display:grid;place-items:center;font-style:normal;width:var(--mjs-pointer-size,36px);height:var(--mjs-pointer-size,36px);margin:calc(var(--mjs-pointer-size,36px) / -2) 0 0 calc(var(--mjs-pointer-size,36px) / -2);border-radius:50%;mix-blend-mode:var(--mjs-pointer-blend,difference);scale:calc(var(--mjs-fx-pointer-g,1) * var(--mjs-fx-pointer-p,1))}'
    + '[mjs-fx-pointer-layer="disc"] > i{background:var(--mjs-pointer-color,#fff)}'
    + '[mjs-fx-pointer-layer="ring"] > i,[mjs-fx-pointer-layer="dot"] > i{border:2px solid var(--mjs-pointer-color,#fff)}'
    + '[mjs-fx-pointer-layer="lens"] > i{mix-blend-mode:normal;-webkit-backdrop-filter:var(--mjs-fx-pointer-bf,grayscale(1));backdrop-filter:var(--mjs-fx-pointer-bf,grayscale(1));box-shadow:inset 0 0 0 1px var(--mjs-pointer-color,#fff);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--mjs-pointer-color,#fff) 40%,transparent)}'
    + '[mjs-fx-pointer-layer="lens"][mjs-fx-pointer-out] > i{-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none}'
    + '[mjs-fx-layer="pointer"]{position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:var(--mjs-pointer-zindex,2147483000);--mjs-fx-pointer-r:calc(var(--mjs-pointer-size,36px) / 2 * var(--mjs-fx-pointer-g,1) * var(--mjs-fx-pointer-p,1));-webkit-backdrop-filter:var(--mjs-fx-pointer-bf,grayscale(1));backdrop-filter:var(--mjs-fx-pointer-bf,grayscale(1));-webkit-mask-image:radial-gradient(circle at var(--mjs-fx-pointer-x,50%) var(--mjs-fx-pointer-y,50%),transparent calc(var(--mjs-fx-pointer-r) - 3px),#000 calc(var(--mjs-fx-pointer-r) + 3px));mask-image:radial-gradient(circle at var(--mjs-fx-pointer-x,50%) var(--mjs-fx-pointer-y,50%),transparent calc(var(--mjs-fx-pointer-r) - 3px),#000 calc(var(--mjs-fx-pointer-r) + 3px));opacity:0;visibility:hidden;transition:opacity .2s,visibility 0s .2s,--mjs-fx-pointer-r .25s cubic-bezier(.2,.8,.2,1),--mjs-fx-pointer-e .25s cubic-bezier(.2,.8,.2,1)}'
    + '[mjs-fx-layer="pointer"][mjs-fx-pointer-doc]{position:fixed;border-radius:0}'
    + '[mjs-fx-layer="pointer"][mjs-fx-pointer-on]{opacity:1;visibility:visible;transition:opacity .2s,visibility 0s,--mjs-fx-pointer-r .25s cubic-bezier(.2,.8,.2,1),--mjs-fx-pointer-e .25s cubic-bezier(.2,.8,.2,1)}'
    + '[mjs-fx-layer="pointer"][mjs-fx-pointer-hot]{--mjs-fx-pointer-g:var(--mjs-pointer-grow,2.2)}'
    + '[mjs-fx-layer="pointer"][mjs-fx-pointer-down]{--mjs-fx-pointer-p:var(--mjs-pointer-press,.8)}'
    + '[mjs-fx-pointer-layer] > u{width:calc(var(--mjs-pointer-size,36px) / 6);height:calc(var(--mjs-pointer-size,36px) / 6);margin:calc(var(--mjs-pointer-size,36px) / -12) 0 0 calc(var(--mjs-pointer-size,36px) / -12);border-radius:50%;background:var(--mjs-pointer-color,#fff);mix-blend-mode:var(--mjs-pointer-blend,difference)}'
    + '[mjs-fx-pointer-layer][mjs-fx-pointer-word] > u{opacity:0}'
    + '[mjs-fx-pointer-layer] > i > b{color:var(--mjs-pointer-color,#fff);font-weight:600;font-size:calc(var(--mjs-pointer-size,36px) * .2);line-height:1;white-space:nowrap;opacity:0;transition:opacity .2s}'
    + '[mjs-fx-pointer-layer="disc"] > i > b{color:#000;color:oklch(from var(--mjs-pointer-color,#fff) clamp(0,(.62 - l) * 1000,1) 0 0)}'
    + '[mjs-fx-pointer-layer="lens"] > i > b{text-shadow:0 0 .4em rgba(0,0,0,.45)}'
    + '[mjs-fx-pointer-layer][mjs-fx-pointer-word] > i > b{opacity:1}'
    // la couche du dessus qui garde le curseur du système : celle ouverte DANS la zone, pas celle où la zone vit (ses liens le cachent aussi)
    + '[mjs-fx-pointer-hide],[mjs-fx-pointer-hide] :not(input,textarea,[contenteditable],[contenteditable] *,[mjs-fx-pointer-hide] ' + _MJS_FX_POINTER_TOP + ',[mjs-fx-pointer-hide] ' + _MJS_FX_POINTER_TOP + ' *){cursor:none!important}'
    // une zone qui vit DANS une couche du dessus y cache le curseur, liens compris, même quand <@document> cache aussi le sien (la couche,
    // ouverte dans la page, le rendait à toute la couche)
    + _MJS_FX_POINTER_TOP + ' [mjs-fx-pointer-hide] :not(input,textarea,[contenteditable],[contenteditable] *,' + _MJS_FX_POINTER_TOP + ' [mjs-fx-pointer-hide] ' + _MJS_FX_POINTER_TOP + ',' + _MJS_FX_POINTER_TOP + ' [mjs-fx-pointer-hide] ' + _MJS_FX_POINTER_TOP + ' *){cursor:none!important}'
    + ':where([mjs-fx-pointer-hide] [contenteditable]),:where([mjs-fx-pointer-hide]) ' + _MJS_FX_POINTER_TOP + '{cursor:auto}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-pointer-layer] > *,[mjs-fx-pointer-layer][mjs-fx-pointer-on] > *,[mjs-fx-pointer-layer] > i > b,[mjs-fx-layer="pointer"],[mjs-fx-layer="pointer"][mjs-fx-pointer-on]{transition:none}}',
  vars: { color: '', size: 'px', soft: 'px', blend: '', grow: '', press: '', zindex: '' },
  setup: function(el, s) {
    // un écran sans souris : rien à poser
    if (typeof matchMedia === 'function' && matchMedia('(hover: none)').matches) return function() {};
    var vars   = µ._mjs_fxDefs.pointer.vars;
    var clic   = 'a[href], button, input, select, textarea, summary, label, [role="button"], [data-pointer]';
    var lens   = { grayscale: 'grayscale(1)', invert: 'invert(1)', blur: 'blur(6px)', saturate: 'saturate(2.5)', sepia: 'sepia(1)', hue: 'hue-rotate(160deg)' };
    var style  = /^(disc|ring|dot|lens)$/.test(s.style) ? s.style : 'disc';
    // le filtre inverse ne vaut que pour la lentille
    var outside = style === 'lens' && !!s.outside;
    var calm   = µ._mjs_fxCalm();
    var page   = el === document.documentElement;
    // le retard : 1 = collé à la souris (aussi quand l'utilisateur demande moins d'animations)
    var lag    = function(v) { return calm ? 1 : v > 0 ? Math.min(1, Math.max(0.01, v)) : 0.18; };
    var smooth = lag(s.smooth);
    var hide   = !!s.hide;
    var text   = s.text !== false;
    µ._mjs_fxAdopt(document, 'pointer');
    // le rayon du trou est une longueur enregistrée (sans héritage) : sa transition CSS joue le grossissement et l'appui
    if (outside) {
      µ._mjs_fxRegister('--mjs-fx-pointer-r', '<length>', '18px');
      µ._mjs_fxRegister('--mjs-fx-pointer-e', '<length>', '0px'); // @@ soft
    }
    // le calque : un enfant par pièce (le disque ou l'anneau, le point du style dot), le mot dans le disque
    var layer = document.createElement('span');
    layer.setAttribute('mjs-fx-pointer-layer', style);
    layer.setAttribute('aria-hidden', 'true');
    var body  = document.createElement('i');
    var label = document.createElement('b');
    var dot   = style === 'dot' ? document.createElement('u') : null;
    body.appendChild(label);
    layer.appendChild(body);
    if (dot) layer.appendChild(dot);
    // le voile du filtre inverse : un enfant de la balise (de son shadow root pour un composant), ou un calque fixe de la page
    var veil    = null;
    var restore = function() {};
    if (outside) {
      veil = document.createElement('span');
      veil.setAttribute('mjs-fx-layer', 'pointer');
      veil.setAttribute('aria-hidden', 'true');
      layer.setAttribute('mjs-fx-pointer-out', '');
      if (page) veil.setAttribute('mjs-fx-pointer-doc', '');
      else {
        var inner = µ._mjs_fxInner(el);
        if (inner) µ._mjs_fxAdopt(inner, 'pointer');
        restore = µ._mjs_fxRelative(el);
        µ._mjs_dom.appendChild(inner || el, veil);
      }
    }
    // les réglages visuels sur le calque (le calque n'est pas dans la balise) : l'écrit d'abord, sinon le
    // thème vu depuis la balise ; sur <@document>, le calque hérite de la page
    var mirror = function(k, v) {
      var prop = '--mjs-pointer-' + k;
      if (v === void 0 || v === null || v === '') layer.style.removeProperty(prop);
      else layer.style.setProperty(prop, v + vars[k]);
    };
    for (var k in vars) {
      var themed = s[k] === void 0 && !page ? µ._mjs_fxCss(el, '--mjs-pointer-' + k) : '';
      if (themed) layer.style.setProperty('--mjs-pointer-' + k, themed);
      else mirror(k, s[k]);
    }
    var filter = function(v) {
      layer.style.setProperty('--mjs-fx-pointer-bf', lens[v] || lens.grayscale);
      if (veil) veil.style.setProperty('--mjs-fx-pointer-bf', lens[v] || lens.grayscale);
    };
    if (style === 'lens') filter(s.filter);
    var mark = function(node, name, yes) {
      if (yes) node.setAttribute(name, '');
      else node.removeAttribute(name);
    };
    // les marques d'état vont au calque, et au voile (qui n'en est pas l'enfant) sauf celle de la couche
    var flag = function(name, yes) {
      mark(layer, name, yes);
      if (veil && name !== 'mjs-fx-pointer-live') mark(veil, name, yes);
    };
    // @@ soft
    // le bord progressif (`soft` > 0, lentille seulement) : une marque, les largeurs sont des variables CSS
    var soften = function(v) { flag('mjs-fx-pointer-soft', style === 'lens' && +v > 0); };
    soften(s.soft);
    // @@
    // la position : la souris (tx, ty), le disque (cx, cy), qui la rejoint par une seule boucle
    var tx    = 0;
    var ty    = 0;
    var cx    = 0;
    var cy    = 0;
    var last  = 0;
    var frame = 0;
    var shown = false;
    var moved = false;
    var tg    = null;
    // le repère des pièces fixes : la fenêtre, ou le bloc contenant que crée la couche du dessus qui porte le calque quand elle a un
    // `transform` (une boîte de dialogue centrée par `translate(-50%, -50%)`), un `filter`, un `contain`… — (ox, oy), son coin à l'écran
    var ox    = 0;
    var oy    = 0;
    var put   = function(n, x, y) { n.style.translate = (x - ox).toFixed(1) + 'px ' + (y - oy).toFixed(1) + 'px'; };
    // la boîte de la balise à l'écran, lue à l'entrée de la souris (le trou est dans le repère du voile, qui est celui de la balise) ;
    // la bordure se lit avec elle, pour que l'image d'animation ne lise rien
    var box = null;
    var measure = function() {
      box    = µ._mjs_fxBox(el);
      box.bl = el.clientLeft;
      box.bt = el.clientTop;
      // une balise qui défile emporte le voile avec son contenu : il est ramené sur ce qu'elle montre (le trou, dans son repère, suit)
      veil.style.translate = el.scrollLeft || el.scrollTop ? el.scrollLeft + 'px ' + el.scrollTop + 'px' : '';
    };
    // le trou sous le disque : sa position est écrite dans deux variables du voile, la bordure de la balise déduite, l'échelle défaite
    var hole = function() {
      var x = cx;
      var y = cy;
      if (!page) {
        if (!box) measure();
        x = (cx - box.l) / box.sx - box.bl;
        y = (cy - box.t) / box.sy - box.bt;
      }
      veil.style.setProperty('--mjs-fx-pointer-x', x.toFixed(1) + 'px');
      veil.style.setProperty('--mjs-fx-pointer-y', y.toFixed(1) + 'px');
    };
    var paint = function() {
      put(body, cx, cy);
      if (dot) put(dot, tx, ty);
      if (veil) hole();
    };
    // à chaque image : le disque fait sa part du chemin (comptée en temps, pas en images : même retard
    // sur un écran à 60 ou à 144 Hz) ; arrivé, la boucle s'arrête et le disque quitte sa couche
    var step = function(now) {
      frame = 0;
      if (moved) probe();
      var a = µ._mjs_fxLag(smooth, now, last);
      last = now;
      cx += (tx - cx) * a;
      cy += (ty - cy) * a;
      var done = Math.abs(tx - cx) < 0.1 && Math.abs(ty - cy) < 0.1;
      if (done) {
        cx = tx;
        cy = ty;
      }
      paint();
      if (done) {
        last = 0;
        flag('mjs-fx-pointer-live', false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    var wake = function() {
      if (typeof requestAnimationFrame !== 'function') {
        if (moved) probe();
        cx = tx;
        cy = ty;
        paint();
        return;
      }
      flag('mjs-fx-pointer-live', true);
      frame = requestAnimationFrame(step);
    };
    // le voile d'une balise surveille son entourage pendant le survol seulement : un défilement, un redimensionnement ou un changement de
    // taille de la balise rendent la boîte lue périmée ; la boucle repart alors pour une image, qui relit la boîte et pose le trou
    var watching = null;
    var stale = function() {
      box = null;
      if (shown && !frame) wake();
    };
    var watch = function() {
      if (veil && !page && !watching) watching = µ._mjs_fxWatch(el, stale);
    };
    var unwatch = function() {
      if (watching) watching();
      watching = null;
    };
    // l'état : sur ce qui se clique, appuyé, le mot montré — le DOM n'est touché qu'au changement
    var isHot   = false;
    var isDown  = false;
    var word    = '';
    var deepest = null;
    var hitEl   = null;
    var setHot = function(yes) {
      if (yes === isHot) return;
      isHot = yes;
      flag('mjs-fx-pointer-hot', yes);
    };
    var setDown = function(yes) {
      if (yes === isDown) return;
      isDown = yes;
      flag('mjs-fx-pointer-down', yes);
    };
    var setWord = function(w) {
      if (w === word) return;
      word = w;
      label.textContent = w;
      flag('mjs-fx-pointer-word', w !== '');
    };
    // sous la souris, la couche du dessus : le disque (et le voile) s'éteignent, ils y seraient cachés
    var isTop = false;
    var setTop = function(yes) {
      if (yes === isTop) return;
      isTop = yes;
      flag('mjs-fx-pointer-on', shown && !yes);
    };
    var onTop = function(n) {
      try {
        return µ._mjs_dom.matches(n, _MJS_FX_POINTER_TOP);
      }
      catch {
        return false;
      }
    };
    // la couche du dessus qui porte la zone (une boîte de dialogue modale, un popover ouvert, le plein écran) : le calque y
    // vit, sinon le disque passerait dessous ; relue à chaque entrée de la souris (la boîte s'ouvre souvent après la pose)
    var home0  = null;
    var spot   = null;
    // le coin du bloc contenant, lu sur une pièce vide posée en (0, 0), tant que le calque vit dans une couche du dessus : relu à chaque
    // entrée et à chaque image où la souris bouge (la boîte peut bouger : une animation d'ouverture, un redimensionnement)
    var origin = function() {
      ox = 0;
      oy = 0;
      if (!home0) return;
      if (!spot) spot = layer.appendChild(document.createElement('s'));
      var r = µ._mjs_dom.getBoundingClientRect(spot);
      ox = r.left;
      oy = r.top;
    };
    var home   = function() {
      var h = null;
      for (var n = page ? null : el; n && n.nodeType === 1; n = µ._mjs_fxParent(n)) {
        if (onTop(n)) {
          h = n;
          break;
        }
      }
      home0 = h;
      // une couche du dessus qui est un composant : le calque dans son ombre (dans la balise, il ne serait pas rendu)
      var inner = h ? µ._mjs_fxInner(h) : null;
      var at    = inner || h || document.body || document.documentElement;
      if (layer.parentNode !== at) {
        if (h) µ._mjs_fxAdopt(inner || h.getRootNode(), 'pointer');
        µ._mjs_dom.appendChild(at, layer);
      }
      origin();
    };
    // le curseur du système caché : la feuille de la balise suffit dans sa racine ; dans l'ombre des
    // composants que la souris traverse, une feuille posée dans chaque racine rencontrée
    var covered = new Set();
    var cover   = null;
    var cover1  = function(root) {
      if (covered.has(root)) return;
      covered.add(root);
      if (!cover) {
        cover = new CSSStyleSheet();
        cover.replaceSync('*:not(input,textarea,[contenteditable],[contenteditable] *,' + _MJS_FX_POINTER_TOP + ',' + _MJS_FX_POINTER_TOP + ' *){cursor:none!important}:where([contenteditable]),' + _MJS_FX_POINTER_TOP + '{cursor:auto}');
        cover._mjs_keep = true;
      }
      root.adoptedStyleSheets = root.adoptedStyleSheets.concat([cover]);
    };
    // une racine sous la couche du dessus : le curseur du système y reste visible (la feuille de la racine ne voit pas, à travers la
    // frontière de l'ombre, la boîte de dialogue qui porte son hôte)
    var uncover1 = function(root) {
      if (covered.delete(root)) root.adoptedStyleSheets = root.adoptedStyleSheets.filter(function(x) { return x !== cover; });
    };
    var uncover = function() {
      covered.forEach(function(root) { root.adoptedStyleSheets = root.adoptedStyleSheets.filter(function(x) { return x !== cover; }); });
      covered.clear();
    };
    if (hide) µ._mjs_dom.setAttribute(el, 'mjs-fx-pointer-hide', '');
    var move = function(e) {
      if (e.pointerType === 'touch') return;
      // la cible du mouvement, lue pendant l'envoi (le chemin n'existe plus après) : l'élément réel tant qu'il
      // n'est pas dans l'ombre fermée d'un composant, sinon sa balise
      tg    = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
      tx    = e.clientX;
      ty    = e.clientY;
      moved = true;
      // la première position, ou celle d'après une sortie : le disque apparaît sous la souris, sans voyage
      if (!shown) {
        shown = true;
        cx    = tx;
        cy    = ty;
        box   = null;
        home();
        paint();
        flag('mjs-fx-pointer-on', true);
        watch();
      }
      if (!frame) wake();
    };
    // la balise sous la souris : la plus proche qui se clique, en remontant d'une racine d'ombre à son hôte.
    // Un composant garde son ombre fermée : la cible d'un événement n'est que sa balise, et un mouvement
    // dedans ne dit rien dehors — l'élément réel se lit au point, ombre après ombre (seulement quand la cible
    // est la balise d'un composant : ailleurs, la cible est déjà l'élément réel et rien n'est testé). Les
    // racines traversées reçoivent la feuille qui cache le curseur du système, sauf sous la couche du dessus, où elles la perdent
    var probe = function() {
      moved = false;
      if (home0) origin();
      var n = tg || (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(tx, ty) : null);
      for (var i = 0; n && i < 32; i++) {
        var r = n._shadow || n.shadowRoot;
        var f = r && typeof r.elementFromPoint === 'function' ? r.elementFromPoint(tx, ty) : null;
        if (!f || f === n) break;
        n = f;
      }
      // le même élément : seul son mot peut avoir changé (un `data-pointer` réécrit sous la souris)
      if (n === deepest) {
        if (hitEl) setWord(text ? µ._mjs_dom.getAttribute(hitEl, 'data-pointer') || '' : '');
        return;
      }
      deepest = n;
      var hit   = null;
      var zone  = false;
      var top   = false;
      var roots = [];
      for (; n && n.nodeType === 1; n = µ._mjs_fxParent(n)) {
        if (hide && n.parentNode && n.parentNode.nodeType === 11) roots.push(n.parentNode);
        if (!hit && µ._mjs_dom.matches(n, clic)) hit = n;
        // la couche du dessus où vit le calque ne l'éteint pas
        if (!top && n !== home0 && onTop(n)) top = true;
        if (n === el) {
          zone = true;
          break;
        }
      }
      // les racines traversées : couvertes, ou découvertes sous la couche du dessus
      for (var j = 0; j < roots.length; j++) (top ? uncover1 : cover1)(roots[j]);
      if (!zone) hit = null;
      hitEl = hit;
      setHot(!!hit);
      setWord(hit && text ? µ._mjs_dom.getAttribute(hit, 'data-pointer') || '' : '');
      setTop(top);
    };
    // le bouton principal seulement : un clic droit ouvre un menu, et le relâchement n'arrive pas toujours
    var down = function(e) { if (e.pointerType !== 'touch' && !e.button) setDown(true); };
    var up   = function() { setDown(false); };
    // la souris sort : le disque s'efface, la boucle s'arrête, l'état revient au repos
    var leave = function() {
      if (!shown) return;
      shown = false;
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame   = 0;
      last    = 0;
      moved   = false;
      tg      = null;
      deepest = null;
      hitEl   = null;
      flag('mjs-fx-pointer-live', false);
      flag('mjs-fx-pointer-on', false);
      unwatch();
      box = null;
      setHot(false);
      setDown(false);
      setWord('');
      isTop = false;
    };
    var undo = [];
    var on2  = function(target, type, f, capture) {
      var opts = { capture: !!capture, passive: true };
      µ._mjs_dom.addEventListener(target, type, f, opts);
      undo.push(function() { µ._mjs_dom.removeEventListener(target, type, f, opts); });
    };
    on2(el, 'pointermove', move, true);
    on2(el, 'pointerdown', down, true);
    on2(el, 'pointerup', up, true);
    on2(el, 'pointercancel', up, true);
    on2(el, 'pointerleave', leave, false);
    on2(window, 'blur', up, false);
    if (veil && page) (document.body || document.documentElement).appendChild(veil);
    (document.body || document.documentElement).appendChild(layer);
    var off = function() {
      for (var i = 0; i < undo.length; i++) undo[i]();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
      uncover();
      unwatch();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-pointer-hide');
      if (veil) veil.remove();
      restore();
      layer.remove();
    };
    // les réglages tenus par une variable se suivent sur place ; le style change la forme du calque :
    // l'effet repart (rend false)
    off.set = function(k, v) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        mirror(k, v);
        if (k === 'soft') soften(v); // @@ soft
      }
      else if (k === 'smooth') smooth = lag(v);
      else if (k === 'filter') filter(v);
      else if (k === 'text') {
        text    = v !== false;
        deepest = null;
        if (!text) setWord('');
      }
      else if (k === 'hide') {
        hide    = !!v;
        deepest = null;
        if (hide) µ._mjs_dom.setAttribute(el, 'mjs-fx-pointer-hide', '');
        else {
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-pointer-hide');
          uncover();
        }
      }
      else return false;
    };
    return off;
  }
};

// le bord progressif de la lentille (`soft`) : ses règles ne partent que dans une appli qui écrit `soft`. Firefox applique le masque
// d'un élément à backdrop-filter deux fois (la part de filtre est le carré de l'opacité du masque : mi-bord à 0,75 de netteté au lieu
// de 0,5) ; son bloc `@supports` donne à ce seul moteur (propriété `-moz-orient`, que lui seul comprend) un dégradé corrigé : avec le
// voile, un point de transition à un quart du bord (opacité = racine de la position) ; sans le voile, des paliers sur la racine de ce qui reste.
// @@ soft
µ._mjs_fxDefs.pointer.css += (function() {
  var mask   = function(g) { return '-webkit-mask-image:' + g + ';mask-image:' + g; };
  var size   = 'var(--mjs-pointer-size,36px)';
  var soft   = 'var(--mjs-pointer-soft,0px)';
  var radius = 'var(--mjs-fx-pointer-r)';
  var edge   = 'var(--mjs-fx-pointer-e)';
  var heart  = 'calc(' + size + ' / 2)';
  var hole   = 'circle at var(--mjs-fx-pointer-x,50%) var(--mjs-fx-pointer-y,50%),transparent ' + radius;
  var veil   = '[mjs-fx-layer="pointer"][mjs-fx-pointer-soft]';
  var lens   = '[mjs-fx-pointer-layer="lens"][mjs-fx-pointer-soft]:not([mjs-fx-pointer-out]) > i';
  var steps  = [[.25, .87], [.5, .71], [.75, .5], [.9, .32]].map(function(p) { return ',rgba(0,0,0,' + p[1] + ') calc(' + heart + ' + ' + soft + ' * ' + p[0] + ')'; }).join('');
  return veil + '{--mjs-fx-pointer-e:calc(' + soft + ' * var(--mjs-fx-pointer-g,1) * var(--mjs-fx-pointer-p,1));' + mask('radial-gradient(' + hole + ',#000 calc(' + radius + ' + ' + edge + '))') + '}'
    + lens + '{width:calc(' + size + ' + 2 * ' + soft + ');height:calc(' + size + ' + 2 * ' + soft + ');margin:calc(' + size + ' / -2 - ' + soft + ') 0 0 calc(' + size + ' / -2 - ' + soft + ');box-shadow:none;' + mask('radial-gradient(circle closest-side,#000 ' + heart + ',transparent calc(' + heart + ' + ' + soft + '))') + '}'
    + '@supports (-moz-orient:vertical){'
    + veil + '{' + mask('radial-gradient(' + hole + ',calc(' + radius + ' + ' + edge + ' / 4),#000 calc(' + radius + ' + ' + edge + '))') + '}'
    + lens + '{' + mask('radial-gradient(circle closest-side,#000 ' + heart + steps + ',transparent calc(' + heart + ' + ' + soft + '))') + '}'
    + '}';
})();
// @@
