// mjs_fx_backlight — `*backlight` : une lueur faite des couleurs de l'image elle-même. Sous une <img>, ou sous une
// balise à image de fond, un double de l'image, très flou, sert de halo : ce n'est pas un reflet (cf. *reflect),
// c'est un nuage de ses propres teintes, rendues plus vives qu'elle. Le double est un frère posé juste AVANT la
// balise (qui passe `relative` pour rester par-dessus) : il ne prend aucune place, n'est pas lu par les lecteurs
// d'écran (`aria-hidden`), ne capte pas les clics, suit le changement d'image (`src`, `srcset`, fond de la balise)
// et se cale sur la boîte de la balise. Cette boîte n'est relue que lorsque la balise ou son parent change de
// taille, ou que les enfants du parent changent : un ResizeObserver partagé par toutes les balises à halo les lit
// toutes d'un coup, puis les écrit toutes. Le flou et la saturation sont posés une fois, le double ne bouge jamais :
// seule son opacité s'anime. Une image pas encore chargée (`loading="lazy"` loin de l'écran) n'est pas appelée par
// le double : il attend le `load` de la balise.
// Réglages : blur (le flou du halo, en px ; 24), opacity (son opacité quand il est allumé ; 0.8), saturate (la
// vivacité de ses couleurs, 1 = celles de l'image ; 1.4), size (sa taille par rapport à l'image ; 1), x et y (son
// décalage, en px ; 0 et 12), duration (le fondu entre éteint et allumé ; 300ms), on (always : allumé tout le
// temps ; hover : pendant le survol ; view : dès que la balise est à l'écran ; click : chaque clic bascule), legend (faux ;
// vrai : tout ce qui est à côté de l'image dans son parent — une légende, un texte, un bouton — reste au-dessus de la lueur, sans rien écrire de plus).
// « Réduire les animations » : le halo apparaît sans fondu.
// `legend: true` : le parent devient un contexte d'empilement (`isolation: isolate`, écrite en ligne) et le double passe à `z-index: -1` dans ce contexte : au-dessus du
// fond du parent, sous tout ce que le parent contient et qui n'est pas posé plus bas (le texte voisin, un bouton) ; l'image, elle, reste devant la lueur. Un parent est isolé
// une seule fois pour toutes les balises qui comptent sur lui, et rendu exactement au retrait de la dernière (sa valeur d'avant, ou aucun attribut `style` s'il n'en avait pas) ;
// à la racine d'un composant (pas de parent balise) c'est l'hôte du composant qu'on isole, et un parent sans boîte (`display: contents`) cède la place à son premier ancêtre
// qui en a une. Ce que cela coûte, et c'est pourquoi `legend` est faux par défaut : le parent devient un bloc d'empilement — un enfant à z-index positif qui déborde du parent
// (un menu) ne passe plus au-dessus de ce qui suit le parent, et un mode de fusion (`mix-blend-mode`) de ses enfants ne mêle plus ce qui est derrière lui.
// Limites : la boîte du double suit la mise en page, pas les transformations de la balise (un `transform` posé sur
// elle ne le déplace pas) ; il faut que le parent ne rogne pas la lueur (`overflow: hidden`) ; le double est un élément
// positionné, donc il se peint par-dessus le texte NON positionné du parent : une légende blanche juste sous l'image,
// dans un parent à fond opaque, est lavée par la lueur — sauf avec `legend: true` (voir plus haut), ou avec le geste côté
// auteur : `position: relative` sur le texte voisin (il repasse devant le double), ou de la place sous l'image (la lueur
// déborde de la boîte de l'image d'environ trois fois le flou, plus le décalage `y`).

(function() {
  var P = '[mjs-fx-layer="backlight"]';
  // réglage → unité de la variable CSS posée sur le double (il est à côté de la balise, pas dedans)
  var MIRROR = { blur: 'px', opacity: '', saturate: '', size: '', x: 'px', y: 'px', duration: '' };
  // object-fit de l'image → background-size du double (fill et le reste : toute la boîte)
  var FIT = { cover: 'cover', contain: 'contain', 'scale-down': 'contain', none: 'auto' };
  // la liste d'un réglage CSS à plusieurs fonds : coupée aux virgules du premier niveau (hors parenthèses et guillemets :
  // `linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5)), url(…)` fait deux fonds)
  var split = function(v) {
    var str = String(v || '');
    var out = [];
    var at  = 0;
    var lvl = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (c === '"' || c === '\'') {
        for (i++; i < str.length && str.charAt(i) !== c; i++) if (str.charAt(i) === '\\') i++;
      }
      else if (c === '(') lvl++;
      else if (c === ')') lvl--;
      else if (c === ',' && lvl === 0) {
        out.push(str.slice(at, i).trim());
        at = i + 1;
      }
    }
    out.push(str.slice(at).trim());
    return out;
  };

  // les balises à halo : UN ResizeObserver pour toutes, UN MutationObserver par parent. Un changement relit
  // d'abord TOUTES les boîtes, puis les écrit toutes (lecture et écriture mêlées, balise après balise, refont la
  // mise en page à chaque tour d'une liste de mille cartes)
  var seen = typeof Map === 'function' ? new Map() : null;
  var mos  = typeof Map === 'function' ? new Map() : null;
  var ro   = null;
  var pass = function(list) {
    var i;
    for (i = 0; i < list.length; i++) list[i].fix();
    for (i = 0; i < list.length; i++) list[i].read();
    for (i = 0; i < list.length; i++) list[i].write();
  };
  // abonne une balise (sub : el, parent, fix, read, write) ; rend le désabonnement, ou null sans ResizeObserver
  var join = function(sub) {
    if (!seen || typeof ResizeObserver !== 'function') return null;
    var parent = sub.parent;
    var elem   = parent && parent.nodeType === 1;
    if (!ro) {
      ro = new ResizeObserver(function(entries) {
        var todo = new Set();
        for (var i = 0; i < entries.length; i++) {
          var hit = seen.get(entries[i].target) || [];
          for (var j = 0; j < hit.length; j++) todo.add(hit[j]);
        }
        pass(Array.from(todo));
      });
    }
    var watch = function(t) {
      var l = seen.get(t);
      if (!l) {
        l = [];
        seen.set(t, l);
        ro.observe(t);
      }
      l.push(sub);
    };
    var drop = function(t) {
      var l = seen.get(t);
      if (!l) return;
      var at = l.indexOf(sub);
      if (at >= 0) l.splice(at, 1);
      if (l.length === 0) {
        seen.delete(t);
        ro.unobserve(t);
      }
    };
    watch(sub.el);
    if (elem) watch(parent);
    // les enfants du parent changent (une liste réordonnée) : la même passe pour toutes les balises du parent
    var group = null;
    if (parent && typeof MutationObserver === 'function') {
      group = mos.get(parent);
      if (!group) {
        var made = { list: [], mo: null };
        made.mo  = new MutationObserver(function() { pass(made.list.slice()); });
        made.mo.observe(parent, { childList: true });
        mos.set(parent, made);
        group = made;
      }
      group.list.push(sub);
    }
    return function() {
      drop(sub.el);
      if (elem) drop(parent);
      if (group) {
        var k = group.list.indexOf(sub);
        if (k >= 0) group.list.splice(k, 1);
        if (group.list.length === 0) {
          group.mo.disconnect();
          mos.delete(parent);
        }
        group = null;
      }
      if (seen.size === 0 && ro) {
        ro.disconnect();
        ro = null;
      }
    };
  };

  // `legend` : les éléments isolés (`isolation: isolate`, en ligne), avec de quoi les rendre tels quels — le nombre de balises qui comptent dessus, la valeur d'avant
  // et son niveau d'importance, l'existence d'un attribut `style`, et si l'isolation est de nous (l'auteur l'avait peut-être écrite)
  var held = typeof Map === 'function' ? new Map() : null;
  // ce qu'on isole : le parent ; sans boîte (`display: contents`), le premier ancêtre qui en a une ; à la racine d'un composant, son hôte ; rien sans Map
  var stackOf = function(parent) {
    var p = parent;
    while (p && p.nodeType === 1 && (typeof getComputedStyle === 'function' ? getComputedStyle(p) : 0).display === 'contents') p = p.parentNode;
    if (p && p.nodeType === 11 && p.host) p = p.host;
    return held && p && p.nodeType === 1 ? p : null;
  };
  var isolate = function(host) {
    var h = held.get(host);
    if (h) {
      h.n++;
      return;
    }
    var prior = host.style.getPropertyValue('isolation');
    h = { n: 1, prior: prior, prio: host.style.getPropertyPriority('isolation'), had: µ._mjs_dom.hasAttribute(host, 'style'), own: prior !== 'isolate' };
    if (h.own) host.style.setProperty('isolation', 'isolate');
    held.set(host, h);
  };
  var release = function(host) {
    var h = held.get(host);
    if (!h) return;
    if (--h.n > 0) return;
    held.delete(host);
    if (!h.own) return;
    if (host.style.getPropertyValue('isolation') === 'isolate') {
      if (h.prior) host.style.setProperty('isolation', h.prior, h.prio);
      else host.style.removeProperty('isolation');
    }
    if (!h.had && µ._mjs_dom.getAttribute(host, 'style') === '') µ._mjs_dom.removeAttribute(host, 'style');
  };

  µ._mjs_fxDefs.backlight = {
    css: P + '{position:absolute!important;margin:0!important;right:auto!important;bottom:auto!important;box-sizing:border-box!important;left:var(--mjs-fx-backlight-l,0px)!important;top:var(--mjs-fx-backlight-t,0px)!important;width:var(--mjs-fx-backlight-w,0px)!important;height:var(--mjs-fx-backlight-h,0px)!important;pointer-events:none!important;z-index:var(--mjs-fx-backlight-z,auto);'
      + 'background-image:var(--mjs-fx-backlight-src,none);background-repeat:var(--mjs-fx-backlight-rep,no-repeat);background-size:var(--mjs-fx-backlight-fit,100% 100%);background-position:var(--mjs-fx-backlight-at,50% 50%);border-radius:var(--mjs-fx-backlight-r,0);'
      + 'filter:blur(var(--mjs-backlight-blur,24px)) saturate(var(--mjs-backlight-saturate,1.4));transform:translate(var(--mjs-backlight-x,0px),var(--mjs-backlight-y,12px)) scale(var(--mjs-backlight-size,1));opacity:0;transition:opacity var(--mjs-backlight-duration,300ms) ease}'
      + P + ':has(+ [mjs-fx-on~="backlight"]){opacity:var(--mjs-backlight-opacity,0.8)}'
      + '@media (prefers-reduced-motion:reduce){' + P + '{transition:none}}',
    vars: { blur: 'px', opacity: '', saturate: '', size: '', x: 'px', y: 'px', duration: '' },
    setup: function(el, s) {
      var parent = el.parentNode;
      if (!parent) return function() {};
      var img = el.localName === 'img';
      var base = null;
      var cur = {};
      for (var k in MIRROR) if (s[k] !== void 0) cur[k] = s[k];
      var layer = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', 'backlight');
      layer.setAttribute('aria-hidden', 'true');
      var vars = function() {
        for (var n in MIRROR) {
          if (cur[n] === void 0) layer.style.removeProperty('--mjs-backlight-' + n);
          else layer.style.setProperty('--mjs-backlight-' + n, cur[n] + MIRROR[n]);
        }
      };
      var put = function(n, v) {
        if (v === '' || v === void 0) layer.style.removeProperty('--mjs-fx-backlight-' + n);
        else layer.style.setProperty('--mjs-fx-backlight-' + n, v);
      };
      vars();
      var restore = µ._mjs_fxRelative(el);
      // l'état d'abord, le double ensuite : un halo « always » naît allumé, sans fondu à la pose
      var gate = µ._mjs_fxState(el, 'backlight', s.on || 'always');
      µ._mjs_dom.insertBefore(parent, layer, el);
      // `legend` : le parent isolé, le double sous tout ce qu'il contient (sans lui, le double reste un élément positionné au-dessus du texte voisin)
      if (s.legend === true) {
        base = stackOf(parent);
        if (base) isolate(base);
      }

      // ce que le double copie : l'image de la balise (chargée), ou le premier fond en `url(…)` de sa liste ; son
      // cadrage (object-fit et object-position, ou la taille, la place et la répétition de ce fond) et ses coins
      var warned = false;
      var pick = function() {
        var cs  = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        var url = '';
        var fit = '';
        var at  = '';
        var rep = '';
        if (img) {
          if (el.complete && el.currentSrc) url = el.currentSrc;
          fit = cs && FIT[cs.objectFit] || '100% 100%';
          at  = cs ? cs.objectPosition : '';
        }
        else if (cs) {
          var list = split(cs.backgroundImage);
          var n    = -1;
          for (var i = 0; i < list.length && n < 0; i++) if (/^url\(/.test(list[i])) n = i;
          if (n >= 0) {
            var m = /^url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*?))\s*\)$/.exec(list[n]);
            url = m ? (m[1] || m[2] || m[3] || '').replace(/\\(.)/g, '$1') : '';
            var nth = function(v) {
              var l = split(v);
              return l[n % l.length] || '';
            };
            fit = nth(cs.backgroundSize);
            at  = nth(cs.backgroundPosition);
            rep = nth(cs.backgroundRepeat);
          }
          else if (!warned) {
            warned = true;
            µ.warn(µ._mjs_msg('backlightNone', { tag: el.localName }, '*backlight : la balise <{tag}> n\'a ni image ni image de fond — le halo n\'a rien à copier'));
          }
        }
        put('src', url ? 'url("' + url.replace(/["\\\n]/g, '\\$&') + '")' : '');
        put('fit', fit);
        put('at', at);
        put('rep', rep);
        put('r', cs ? cs.borderRadius : '');
        // la balise a un z-index : le double passe juste dessous ; avec `legend` il passe sous tout ce que le parent isolé contient (-1, ou sous la balise si elle est plus basse)
        var zi = cs && /^-?\d+$/.test(cs.zIndex) ? parseInt(cs.zIndex, 10) - 1 : null;
        put('z', base ? String(zi === null ? -1 : Math.min(zi, -1)) : zi === null ? '' : String(zi));
      };
      pick();
      if (img) µ._mjs_dom.addEventListener(el, 'load', pick);
      // la classe ou un réglage de fond écrit en ligne ont changé : sans cela (une autre animation qui écrit le style de la balise
      // à chaque image), le style n'est pas relu
      var key = function() {
        var st = el.style;
        return (µ._mjs_dom.getAttribute(el, 'class') || '') + '|' + st.background + '|' + st.backgroundImage + '|' + st.backgroundSize + '|' + st.backgroundPosition + '|' + st.backgroundRepeat + '|' + st.zIndex + '|' + st.borderRadius;
      };
      var sig = key();
      var mo = !img && typeof MutationObserver === 'function' ? new MutationObserver(function() {
        var k = key();
        if (k === sig) return;
        sig = k;
        pick();
      }) : null;
      if (mo) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });

      // la boîte du double : celle de la balise dans son parent positionné, relue seulement à ce qui la change
      var box   = [0, 0, 0, 0];
      var read  = function() { box = [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight]; };
      var write = function() {
        layer.style.setProperty('--mjs-fx-backlight-l', box[0] + 'px');
        layer.style.setProperty('--mjs-fx-backlight-t', box[1] + 'px');
        layer.style.setProperty('--mjs-fx-backlight-w', box[2] + 'px');
        layer.style.setProperty('--mjs-fx-backlight-h', box[3] + 'px');
      };
      // la balise a bougé dans son parent (une liste à clé réordonnée) : le double revient juste avant elle ; sortie
      // du DOM, il part avec elle
      var fix = function() {
        var p = el.parentNode;
        if (!p) layer.remove();
        else if (el.previousSibling !== layer) µ._mjs_dom.insertBefore(p, layer, el);
      };
      var leave = join({ el: el, parent: parent, fix: fix, read: read, write: write });
      var again = function() {
        read();
        write();
      };
      // sans ResizeObserver : une lecture à la pose et à chaque redimensionnement de la fenêtre
      if (!leave) {
        again();
        window.addEventListener('resize', again);
      }
      var off = function() {
        gate();
        if (leave) leave();
        else window.removeEventListener('resize', again);
        if (mo) mo.disconnect();
        if (img) µ._mjs_dom.removeEventListener(el, 'load', pick);
        if (base) release(base);
        base = null;
        layer.remove();
        restore();
      };
      // les réglages visuels sont recopiés sur le double ; les autres (on) relancent l'effet
      off.set = function(k, v) {
        // `legend` suivi sur place : le parent s'isole ou est rendu, le double change de z-index
        if (k === 'legend') {
          if (v === true && !base) {
            base = stackOf(parent);
            if (base) isolate(base);
          }
          else if (v !== true && base) {
            release(base);
            base = null;
          }
          pick();
          return;
        }
        if (!(k in MIRROR)) return false;
        if (v === void 0) delete cur[k];
        else cur[k] = v;
        vars();
      };
      return off;
    }
  };
})();
