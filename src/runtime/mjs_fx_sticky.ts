// mjs_fx_sticky — `*sticky` : une barre qui se fige en haut de l'écran après un seuil de défilement,
// revient en glissant depuis le dessus, et peut se cacher quand on descend. Réglages : offset (le
// défilement en px, compté depuis l'endroit où la balise toucherait le haut, après lequel elle se
// fige — pour une barre posée en haut de la page, le défilement de la page : `*sticky(500)` ; 0 : dès
// qu'elle touche le haut ; 0), hide (figée, elle se cache dès qu'on descend de plus de 8 px et revient
// dès qu'on remonte de plus de 8 px, ou quand le clavier entre dedans ; tant qu'un focus clavier visible
// ou un champ de saisie a le focus dans la barre, elle ne se cache pas, mais le focus qu'un clic de souris
// laisse sur un lien ou un bouton ne la retient pas ; non), top (l'écart avec le haut de l'écran, ou du
// conteneur qui défile, en px ; 0), duration (le glissement ; 400ms), easing (sa courbe ; ease), zindex
// (1000).
// Figée, la balise passe en position fixe et un tenant-lieu reprend sa place dans la page : rien ne
// saute. Il occupe exactement la place que la balise occupait, lue avant la figeaison : sa hauteur, ses
// marges, celles de ses enfants qui sortent d'elle par fusion de marges (`<header><h1>`, `<nav><ul>`) et
// la marge haute du frère qui la suit. Il se pose juste après la balise, qui garde son rang parmi ses
// frères (`:first-child`, `:nth-child`) ; en contrepartie, tant qu'elle est figée, le rang des frères qui
// la suivent décale d'un cran et un sélecteur `barre + frère` ne vise plus ce frère (le tenant-lieu a
// repris sa marge haute, pour que rien ne bouge). Une balise en ligne, ou un composant en ligne, laisse
// un tenant-lieu calé en haut de sa ligne. Son état se lit dans `mjs-fx-on~="sticky"` (l'habillage figé
// est à l'auteur : fond, ombre, taille de police…) ; cachée, elle porte `mjs-fx-sticky="hidden"` (hors de
// l'écran, sans ombre qui dépasse, mais toujours atteignable au clavier). Elle revient en glissant depuis
// l'endroit où elle se trouvait à l'écran, au plus d'une hauteur au-dessus de la ligne du haut : posée en
// haut de la page avec `offset: 0`, elle se fige sans que l'œil voie un saut. Le retour sous le seuil la
// rend à sa place d'un coup (un glissement de retour encore en cours est annulé : elle ne reste pas décalée,
// ce qui la ferait se figer de nouveau aussitôt). À l'impression rien n'est fixe : la balise retrouve sa
// place dans la page et le tenant-lieu s'efface (une barre fixe se répéterait en haut de chaque page et
// cacherait du texte).
// Une ancre (`#titre`, scrollIntoView, le focus qui défile) ne doit pas arriver sous la barre : tant
// qu'elle est figée et visible, le conteneur qui défile (la page, ou la boîte) réserve sa hauteur plus
// `top` en `scroll-padding-top`, la valeur de l'auteur lui étant rendue ensuite (un conteneur n'a qu'une
// barre à la fois pour le faire). La réserve change sans que la page bouge : WebKit recale le défilement de la
// valeur dont `scroll-padding-top` change, l'ancrage de défilement du conteneur (`overflow-anchor`) est donc
// coupé en ligne le temps de chaque changement, puis rendu comme l'auteur l'avait.
// Le seuil est suivi par un IntersectionObserver sur la balise (son tenant-lieu une fois figée), dont la
// marge d'observation porte `offset`, `top` et la hauteur : aucun écouteur de défilement. Le sens du
// défilement (hide) et, dans un conteneur qui défile, la place de ce conteneur à l'écran sont suivis par
// des écouteurs de défilement posés sur les racines de la balise (un défilement ne sort pas d'une ombre) et sur
// la fenêtre redimensionnée, seulement pendant que la balise est figée, dans l'événement de défilement et
// jamais dans une image d'animation : la position de défilement est la donnée de l'événement, son maximum se
// garde (relu si la position le dépasse, ou au redimensionnement) et la place du conteneur est relue à chaque
// événement qui peut la déplacer — son propre défilement (la mise en page peut bouger au-dessus de lui pendant
// le geste : une image qui se charge), celui de la page ou de ce qui le contient, la fenêtre redimensionnée —,
// pas pour un autre élément ; la position lue est
// bornée entre 0 et le maximum (le rebond d'un défilement tactile ne passe pas pour une remontée). Les
// variables que la balise figée pose sur elle-même (--mjs-fx-sticky-x, -y, -w, -from) sont enregistrées sans
// héritage : une écriture ne relit que la balise, pas ses descendants. Dans
// un conteneur (overflow auto ou scroll dont le contenu déborde, trouvé à travers les shadow roots,
// reconnu à la mesure et relu quand elle change), la balise se fige en haut de CE conteneur et reste
// découpée à son bord. « Réduire les animations » : elle se fige et se cache sans glisser. Figée
// (`mjs-fx-sticky-pin`), la balise garde pour elle `position`, `top`, `left`, `width`, `margin`,
// `z-index`, `animation` et `transition` ; sa colonne et sa largeur sont celles qu'elle avait dans la
// page, relues quand la fenêtre ou son conteneur change de taille.
// Limites : une balise déjà fixe n'est pas touchée ; un ancêtre transformé, filtré ou en `contain` devient
// le repère d'une balise fixe, qui s'y fige au lieu de la fenêtre ; un conteneur qui défile n'est reconnu
// qu'une fois sa mise en page faite ; deux barres figées au même endroit se recouvrent (aucun empilement :
// donnez un `top` à la seconde) ; une barre plus haute que l'écran le couvre en entier tant qu'elle est
// figée (limitez sa hauteur) ; le tenant-lieu garde la hauteur de la barre à sa figeaison, il ne suit pas
// un menu qui s'ouvre ensuite ; un enfant sans hauteur en tête ou en queue de barre coupe la lecture de
// ses marges fusionnées.

µ._mjs_fxDefs.sticky = {
  css: '[mjs-fx-seat="sticky"]{visibility:hidden;pointer-events:none;box-sizing:border-box;max-width:100%;flex:none}'
    // à l'impression, rien de fixe : la barre garde sa place dans la page (une barre fixe se répéterait en haut de chaque page et cacherait du texte) et le tenant-lieu s'efface
    + '@media print{[mjs-fx-seat="sticky"]{display:none!important}}'
    + '@media not print{'
    // figée : fixe, à la place que le tenant-lieu a laissée (colonne et largeur lues sur la balise à sa place)
    + '[mjs-fx~="sticky"][mjs-fx-sticky-pin]{position:fixed!important;top:var(--mjs-fx-sticky-y,var(--mjs-sticky-top,0px))!important;left:var(--mjs-fx-sticky-x,0px)!important;right:auto!important;bottom:auto!important;width:var(--mjs-fx-sticky-w,auto)!important;margin:0!important;box-sizing:border-box!important;z-index:var(--mjs-sticky-zindex,1000)}'
    + '[mjs-fx~="sticky"][mjs-fx-on~="sticky"]{animation:mjs-fx-sticky-in var(--mjs-sticky-duration,400ms) var(--mjs-sticky-easing,ease);transition:translate var(--mjs-sticky-duration,400ms) var(--mjs-sticky-easing,ease),clip-path var(--mjs-sticky-duration,400ms) var(--mjs-sticky-easing,ease),opacity 0s}'
    // cachée : hors de l'écran, puis transparente (l'ombre qui dépasse) une fois partie ; visible, tout de suite
    + '[mjs-fx~="sticky"][mjs-fx-on~="sticky"][mjs-fx-sticky="hidden"]{translate:0 calc(-100% - var(--mjs-sticky-top,0px));opacity:0;transition:translate var(--mjs-sticky-duration,400ms) var(--mjs-sticky-easing,ease),clip-path var(--mjs-sticky-duration,400ms) var(--mjs-sticky-easing,ease),opacity 0s linear var(--mjs-sticky-duration,400ms)}'
    // dans un conteneur qui défile : découpée à son bord haut (la balise fixe n'est pas rognée par lui)
    + '[mjs-fx~="sticky"][mjs-fx-on~="sticky"][mjs-fx-sticky-box]{clip-path:inset(calc(-1 * var(--mjs-sticky-top,0px)) -200vmax -200vmax -200vmax);animation-name:mjs-fx-sticky-in-box}'
    + '[mjs-fx~="sticky"][mjs-fx-on~="sticky"][mjs-fx-sticky-box][mjs-fx-sticky="hidden"]{clip-path:inset(100% -200vmax -200vmax -200vmax)}'
    + '}'
    + '@keyframes mjs-fx-sticky-in{from{translate:0 var(--mjs-fx-sticky-from,0px)}}'
    + '@keyframes mjs-fx-sticky-in-box{from{translate:0 var(--mjs-fx-sticky-from,0px);clip-path:inset(calc(-1 * var(--mjs-fx-sticky-from,0px) - var(--mjs-sticky-top,0px)) -200vmax -200vmax -200vmax)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="sticky"]{animation:none!important;transition:none!important}}',
  vars: { top: 'px', duration: '', easing: '', zindex: '' },
  setup: function(el, s) {
    if (typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') return function() {};
    var dom      = µ._mjs_dom;
    var offset   = s.offset === void 0 ? 0 : s.offset;
    var inset    = s.top === void 0 ? 0 : s.top;
    var hide     = !!s.hide;
    // les variables posées sur la balise figée, sans héritage : une écriture ne relit que la balise, pas ses descendants
    ['x', 'y', 'w', 'from'].forEach(function(k) { µ._mjs_fxRegister('--mjs-fx-sticky-' + k, '*'); });
    // le conteneur qui défile autour de la balise (null : la page), le tenant-lieu et son parent, les observateurs
    var port     = null;
    var seat     = null;
    var holder   = null;
    var io       = null;
    var ro       = null;
    var unscroll = null;
    var stuck    = false;
    var hidden   = false;
    var rested   = false;
    var fresh    = false;
    var height   = 0;
    var last     = 0;
    var way      = 0;
    var anchor   = 0;
    var seen     = NaN;
    var room     = 0;
    var shelf    = null;
    var shelfOld = '';
    var shelfPri = '';
    var range    = 0;
    // le jeton `sticky` de `mjs-fx-on` : l'état figé, que la feuille de l'auteur peut cibler
    var token = function(yes) {
      var list = (dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').filter(function(x) { return x !== '' && x !== 'sticky'; });
      if (yes) list.push('sticky');
      if (list.length > 0) dom.setAttribute(el, 'mjs-fx-on', list.join(' '));
      else dom.removeAttribute(el, 'mjs-fx-on');
    };
    var put = function(k, v) { el.style.setProperty('--mjs-fx-sticky-' + k, v); };
    // le conteneur le plus proche qui défile vraiment, la page exceptée ; relu aux mesures, car à la pose la
    // mise en page n'est pas faite, et un conteneur peut se mettre à défiler plus tard
    var find = function() {
      if (typeof getComputedStyle !== 'function') return null;
      for (var n = µ._mjs_fxParent(el); n && n.nodeType === 1 && n !== document.documentElement; n = µ._mjs_fxParent(n)) {
        if (/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY || '') && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    };
    // la position de défilement, bornée entre 0 et le maximum : le rebond d'un défilement tactile dépasse un bord puis revient, sans que ce soit un mouvement.
    // Le maximum se garde : il ne se relit que si la position le dépasse (ou au redimensionnement), jamais à chaque événement
    var here = function() {
      var box = port || document.scrollingElement || document.documentElement;
      var y   = port ? port.scrollTop : window.scrollY || document.documentElement.scrollTop || 0;
      if (y > range) range = box.scrollHeight - box.clientHeight;
      return Math.max(0, range > 0 ? Math.min(y, range) : y);
    };
    // la ligne où la balise se fige, à l'écran : `top` sous le haut de l'écran ou du conteneur
    var line = function() { return port ? dom.getBoundingClientRect(port).top + port.clientTop + inset : inset; };
    // dans un conteneur, la ligne suit le conteneur quand la page défile : posée si elle a bougé
    var follow = function() {
      var y = line();
      if (Math.abs(y - seen) < 0.5) return;
      seen = y;
      put('y', y + 'px');
    };
    // dans un conteneur : la ligne est relue (le conteneur ou `top` a changé)
    var repin = function() {
      if (!port) return;
      seen = NaN;
      follow();
    };
    // la réserve change sans que la page bouge : WebKit recale le défilement de la valeur dont `scroll-padding-top` change (son ancrage de
    // défilement compte les positions depuis cette réserve), d'où un saut de la hauteur de la barre à chaque masquage et retour et, pour une
    // barre flottante ou en ligne, une barre qui se fige puis se rend en boucle ; l'ancrage est coupé en ligne le temps d'une mise en page
    // forcée, puis rendu tel que l'auteur l'avait (sa valeur en ligne, ou rien)
    var pad = function(box, value, priority) {
      var st = box.style;
      if (st.getPropertyValue('scroll-padding-top') === value) return;
      var old = st.getPropertyValue('overflow-anchor');
      var pri = st.getPropertyPriority('overflow-anchor');
      st.setProperty('overflow-anchor', 'none', 'important');
      if (value) st.setProperty('scroll-padding-top', value, priority);
      else st.removeProperty('scroll-padding-top');
      dom.getBoundingClientRect(box);
      if (old) st.setProperty('overflow-anchor', old, pri);
      else st.removeProperty('overflow-anchor');
    };
    // une ancre (#titre), le focus ou scrollIntoView arriveraient sous la barre : tant qu'elle est figée et visible, le
    // conteneur qui défile (la page : <html>) réserve sa hauteur plus `top` en scroll-padding-top ; la valeur qu'il avait,
    // posée en ligne par l'auteur, lui est rendue ensuite. Un conteneur n'a qu'une barre à la fois pour réserver
    var shelve = function() {
      var box = port || document.documentElement;
      var on  = stuck && !hidden;
      if (shelf && (!on || shelf !== box)) {
        pad(shelf, shelfOld, shelfPri);
        delete shelf._mjs_fxShelf;
        shelf = null;
      }
      if (!on || (!shelf && box._mjs_fxShelf)) return;
      if (!shelf) {
        shelf              = box;
        shelf._mjs_fxShelf = true;
        shelfOld           = shelf.style.getPropertyValue('scroll-padding-top');
        shelfPri           = shelf.style.getPropertyPriority('scroll-padding-top');
      }
      pad(shelf, (room + inset) + 'px', '');
    };
    // le clavier est dans la barre : un focus visible (une touche Tab y a mené un lien, un bouton) ou un champ où
    // l'on saisit ou choisit (recherche, liste, texte modifiable) l'y retient. Le focus qu'un clic de souris laisse
    // sur un lien, un bouton ou une case à cocher ne compte pas : la barre se cache malgré lui
    var visible = typeof CSS === 'object' && typeof CSS.supports === 'function' && CSS.supports('selector(:focus-visible)');
    var within = function() {
      if (!dom.matches(el, ':focus-within')) return false;
      // la balise qui a le focus, jusque dans les composants
      var a = document.activeElement;
      for (var sh = a && (a._shadow || a.shadowRoot); sh && sh.activeElement; sh = a._shadow || a.shadowRoot) a = sh.activeElement;
      if (!a) return false;
      return !visible || dom.matches(a, ':focus-visible') || a.isContentEditable === true || /^(textarea|select)$/.test(a.localName) || (a.localName === 'input' && !/^(button|submit|reset|image|checkbox|radio|range|color|file)$/.test(a.type));
    };
    var conceal = function() {
      if (hidden || within()) return;
      hidden = true;
      dom.setAttribute(el, 'mjs-fx-sticky', 'hidden');
      shelve();
    };
    var reveal = function() {
      if (!hidden) return;
      hidden = false;
      dom.removeAttribute(el, 'mjs-fx-sticky');
      shelve();
    };
    // un événement de défilement (ou de redimensionnement de la fenêtre) pendant que la balise est figée : sa ligne dans un
    // conteneur, son sens avec `hide`. La ligne du conteneur est relue à chaque événement qui peut la déplacer : le défilement
    // du conteneur lui-même (la mise en page peut bouger au-dessus de lui pendant le geste, une image qui se charge), celui de
    // la page ou de ce qui le contient, la fenêtre redimensionnée ; pas pour un autre élément. Le sens est celui du conteneur
    // (la page sans conteneur). Un va-et-vient de moins de 8 px ne compte pas : le sens ne change qu'une fois l'élan pris
    var tick = function(e) {
      var t      = e.target;
      var resize = e.type === 'resize';
      if (port && (resize || t === port || t.nodeType === 9 || µ._mjs_fxWithin(t, port))) follow();
      if (!hide || resize || t !== (port || document)) return;
      var now = here();
      var d   = now - last;
      if (d === 0) return;
      var w = d > 0 ? 1 : -1;
      if (w !== way) {
        way    = w;
        anchor = last;
      }
      last = now;
      if ((now - anchor) * way > 8) (way > 0 ? conceal : reveal)();
    };
    var focused = function() {
      reveal();
      way    = 0;
      last   = anchor = here();
    };
    // la colonne et la largeur de la balise figée sont celles qu'elle aurait à sa place : relues quand la
    // fenêtre ou son conteneur change de taille, la balise revenue un instant dans la page — le tenant-lieu
    // caché pour que la page ne se décale pas, sans rien peindre entre-temps
    var again = function() {
      if (!stuck) return;
      range = 0;
      var shown = seat.style.display;
      seat.style.display = 'none';
      dom.removeAttribute(el, 'mjs-fx-sticky-pin');
      var r = dom.getBoundingClientRect(el);
      seat.style.display = shown;
      put('x', r.left + 'px');
      put('w', r.width + 'px');
      dom.setAttribute(el, 'mjs-fx-sticky-pin', '');
    };
    // les écoutes d'une balise figée, et seulement elles : la fenêtre redimensionnée, le défilement quand la
    // balise en a l'usage (le sens, ou la ligne du conteneur), le clavier qui entre dans une barre cachée
    var listen = function(on) {
      if (on !== rested) {
        rested = on;
        if (on) window.addEventListener('resize', again);
        else window.removeEventListener('resize', again);
      }
      var scroll = on && (hide || port);
      if (scroll && !unscroll) {
        way    = 0;
        range  = 0;
        last   = anchor = here();
        // la surveillance du cœur : le défilement de chaque racine de la balise (il ne sort pas d'une ombre) et la fenêtre redimensionnée,
        // sans celle de la taille de la balise, que l'effet suit déjà par son propre observateur
        unscroll = µ._mjs_fxWatch(el, tick, true);
      }
      else if (!scroll && unscroll) {
        unscroll();
        unscroll = null;
      }
      dom.removeEventListener(el, 'focusin', focused);
      if (on && hide) dom.addEventListener(el, 'focusin', focused);
    };
    // un nœud dans le flux : ni caché, ni flottant, ni positionné hors du flux
    var flows = function(c) { return c.display !== 'none' && c.float === 'none' && c.position !== 'absolute' && c.position !== 'fixed'; };
    // la marge d'un bord de la boîte `box` (le haut, ou le bas) : la sienne et celles de ses enfants du bord qui
    // en sortent, fusionnées (la plus grande des positives et la plus petite des négatives). Un enfant sort quand
    // rien ne le retient — ni bordure, ni remplissage, ni ligne de texte, ni contexte de mise en page —, ce que la
    // mise en page dit elle-même : son bord est alors celui de la boîte, et on s'y fie plutôt que de refaire les
    // règles (`<header><h1>`, `<nav><ul>` : le titre ou la liste laissent leurs marges à la barre)
    var spill = function(box, cs, r, top) {
      var side = top ? 'marginTop' : 'marginBottom';
      var edge = top ? 'top' : 'bottom';
      var pos  = 0;
      var neg  = 0;
      var take = function(c) {
        var m = parseFloat(c[side]) || 0;
        if (m > pos) pos = m;
        if (m < neg) neg = m;
      };
      take(cs);
      while (/^(block|list-item)$/.test(cs.display) && flows(cs)) {
        var root = box._shadow || box.shadowRoot || box;
        var kid  = top ? root.firstElementChild : root.lastElementChild;
        var kc   = kid && getComputedStyle(kid);
        while (kid && !flows(kc)) {
          kid = top ? kid.nextElementSibling : kid.previousElementSibling;
          kc  = kid && getComputedStyle(kid);
        }
        if (!kid || !/^(block|list-item|flow-root|flex|grid|table)$/.test(kc.display)) break;
        var kr = dom.getBoundingClientRect(kid);
        if (Math.abs(kr[edge] - r[edge]) > 0.01) break;
        take(kc);
        box = kid;
        cs  = kc;
        r   = kr;
      }
      return pos + neg;
    };
    // la marge haute du frère qui suit la barre dans le flux, que sa marge basse rejoint par fusion : une règle
    // « barre + frère » ne le vise plus une fois le tenant-lieu posé entre eux, qui reprend alors cette marge
    var follower = function(cs) {
      var p = µ._mjs_fxParent(el);
      if (!flows(cs) || !/^(block|list-item|flow-root|flex|grid|table)$/.test(cs.display) || !p || p.nodeType !== 1 || /(flex|grid)/.test(getComputedStyle(p).display)) return 0;
      for (var n = el.nextSibling; n; n = n.nextSibling) {
        if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return 0;
        if (n.nodeType !== 1) continue;
        var c = getComputedStyle(n);
        if (!flows(c)) continue;
        return /^(block|list-item|flow-root|flex|grid|table)$/.test(c.display) ? spill(n, c, dom.getBoundingClientRect(n), true) : 0;
      }
      return 0;
    };
    // le tenant-lieu : une boîte vide de la taille de la balise, à la même place dans la mise en page (pas
    // encore posée : elle ne doit jamais coexister avec la balise dans la page, le navigateur recalerait
    // le défilement de sa hauteur). Ses marges haute et basse sont celles que la balise tient dans le flux,
    // marges de ses enfants fusionnées à travers elle comprises : lues ici, avant toute écriture
    var sit = function(r, cs) {
      var box = document.createElement('div');
      box.setAttribute('mjs-fx-seat', 'sticky');
      box.setAttribute('aria-hidden', 'true');
      var slot = dom.getAttribute(el, 'slot');
      if (slot) box.setAttribute('slot', slot);
      var st    = box.style;
      var below = spill(el, cs, r, false);
      var next  = follower(cs);
      st.display      = /^inline/.test(cs.display) ? 'inline-block' : 'block';
      // en ligne, calé en haut de la ligne : sur la ligne de base, il la ferait grandir de la descente des lettres
      if (/^inline/.test(cs.display)) st.verticalAlign = 'top';
      st.width        = r.width + 'px';
      st.height       = r.height + 'px';
      st.marginTop    = spill(el, cs, r, true) + 'px';
      st.marginBottom = (below >= 0 && next > below ? next : below) + 'px';
      ['marginRight', 'marginLeft', 'order', 'alignSelf', 'justifySelf', 'gridColumnStart', 'gridColumnEnd', 'gridRowStart', 'gridRowEnd', 'float', 'clear'].forEach(function(k) { st[k] = cs[k]; });
      if (/^(absolute|relative)$/.test(cs.position)) {
        st.position = cs.position;
        st.top      = cs.top;
        st.right    = cs.right;
        st.bottom   = cs.bottom;
        st.left     = cs.left;
      }
      return box;
    };
    // la marge du repère : le seuil, en pixels de défilement, est `offset - top`, la balise est jugée par son
    // bord bas (sa hauteur s'en retranche)
    var margin = function() { return Math.round((offset - inset - height) * 100) / 100 + 'px 0px 0px 0px'; };
    var watch = function() {
      if (io) io.disconnect();
      fresh = true;
      io = new IntersectionObserver(look, { root: port, rootMargin: margin(), threshold: 0 });
      io.observe(stuck ? seat : el);
    };
    // le repère a changé d'état : sorti par le haut, la balise se fige ; revenu, elle reprend sa place
    var look = function(entries) {
      var e = entries[entries.length - 1];
      // un conteneur qui défile depuis la pose : l'observateur repart de lui
      if (fresh) {
        fresh = false;
        var p = find();
        if (p !== port) {
          port = p;
          watch();
          return;
        }
      }
      var rb = e.rootBounds;
      if (!e.isIntersecting && e.boundingClientRect.bottom < (rb ? rb.top : 0)) stick();
      else unstick();
    };
    var stick = function() {
      if (stuck || !el.parentNode) return;
      var cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      var r = dom.getBoundingClientRect(el);
      // une balise qui n'est pas affichée n'a rien à figer : l'observateur reprend quand elle prend sa taille
      if (!r.width && !r.height) return;
      seat  = sit(r, cs);
      stuck = true;
      // d'où la balise revient : de sa place à l'écran, au plus d'une hauteur au-dessus de la ligne
      put('from', Math.min(0, Math.max(r.top - line(), -(r.height + inset))) + 'px');
      put('x', r.left + 'px');
      put('w', r.width + 'px');
      if (port) {
        dom.setAttribute(el, 'mjs-fx-sticky-box', '');
        repin();
      }
      // le tenant-lieu prend la place (juste après la balise, qui garde son rang parmi ses frères) et la balise sort de la page dans le même geste, sans mesure entre les deux
      dom.insertBefore(el.parentNode, seat, el.nextSibling);
      dom.setAttribute(el, 'mjs-fx-sticky-pin', '');
      token(true);
      io.unobserve(el);
      io.observe(seat);
      ro.unobserve(el);
      holder = µ._mjs_fxParent(seat);
      ro.observe(holder);
      listen(true);
      room = dom.getBoundingClientRect(el).height;
      shelve();
    };
    // le glissement de retour encore en cours ne suit pas la barre rendue à sa place : sa transition finit à la valeur de repos, donc
    // elle survit à la perte de la règle qui la porte et garde la barre décalée dans la page, au-dessus de sa ligne, d'où une
    // figeaison aussitôt (le repère la voit sortie), puis un retour, en boucle. Sont coupées les transitions de `translate` de
    // l'effet, qui se reconnaissent à leurs valeurs en pour-cent de la hauteur de la barre (`-100%` caché, ou l'avancement d'une glissade
    // renversée par le navigateur) ; celle de l'auteur, en pixels, continue. L'animation d'entrée et le rognage de l'effet meurent avec leur règle
    var settle = function() {
      if (typeof Element !== 'function' || typeof Element.prototype.getAnimations !== 'function') return;
      dom.getAnimations(el).forEach(function(a) {
        if (a.transitionProperty === 'translate' && a.effect.getKeyframes().some(function(k) { return /%/.test(k.translate); })) a.cancel();
      });
    };
    // `gone` : le retrait de l'effet, les observateurs sont déjà défaits
    var unstick = function(gone) {
      if (!stuck) return;
      stuck = false;
      listen(false);
      hidden = false;
      shelve();
      token(false);
      ['mjs-fx-sticky-pin', 'mjs-fx-sticky', 'mjs-fx-sticky-box'].forEach(function(a) { dom.removeAttribute(el, a); });
      ['x', 'y', 'w', 'from'].forEach(function(k) { el.style.removeProperty('--mjs-fx-sticky-' + k); });
      settle();
      if (!gone) {
        io.unobserve(seat);
        io.observe(el);
        ro.unobserve(holder);
        ro.observe(el);
      }
      dom.remove(seat);
      seat   = null;
      holder = null;
    };
    // la balise a changé de taille : la marge du repère repart de la hauteur et du conteneur d'aujourd'hui ;
    // figée, c'est son conteneur qui change de taille : sa colonne et sa largeur sont relues
    var measure = function() {
      if (stuck) {
        again();
        return;
      }
      var h = dom.getBoundingClientRect(el).height;
      var p = find();
      if (h === height && p === port && io) return;
      height = h;
      port   = p;
      watch();
    };
    ro = new ResizeObserver(measure);
    ro.observe(el);
    var off = function() {
      if (io) io.disconnect();
      ro.disconnect();
      io = null;
      unstick(true);
    };
    // offset, top et hide suivis sur place ; duration, easing et zindex sont des variables CSS
    off.set = function(k, v) {
      if (k === 'hide') {
        hide = !!v;
        if (stuck) {
          if (!hide) reveal();
          listen(true);
        }
        return;
      }
      if (k === 'offset') offset = v === void 0 ? 0 : v;
      else if (k === 'top') inset = v === void 0 ? 0 : v;
      else if (k === 'duration' || k === 'easing' || k === 'zindex') return;
      else return false;
      if (io) watch();
      if (stuck) {
        repin();
        shelve();
      }
    };
    return off;
  }
};
