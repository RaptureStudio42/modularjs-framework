// mjs_fx_reflect — `*reflect` : un reflet miroir sous une image ou un titre, qui s'estompe. Le reflet
// ne prend AUCUNE place dans la mise en page : prévoir une marge sous la balise (gap + size % de sa
// hauteur). Réglages : gap (l'écart entre la balise et son reflet, px ; 4), opacity (l'opacité du
// reflet à sa naissance, contre la balise ; 0.5), size (la part de la balise reflétée avant le fondu
// complet, % ; 50), blur (le flou du reflet, px ; 0), direction (down, up, left, right : le côté où
// tombe le reflet ; down), water (le reflet ondule comme sur l'eau ; non), speed (un cycle de
// l'onde ; 4s).
// Trois techniques, choisies à la pose selon le navigateur et les réglages :
// - `box` : `-webkit-box-reflect` (Chromium, Safari) — rien de plus dans la page, le reflet vit dans
//   le rendu de la balise (une <img> compris) ; il ne sait ni flouter ni onduler ;
// - `moz` : Firefox — une boîte posée à côté de la balise dont le fond est la balise elle-même
//   (`background: -moz-element(#id)`, un identifiant propre est posé le temps de l'effet) : elle
//   suit tout changement sans rien recopier, et accepte blur et water ;
// - `copy` : le reste (blur ou water dans Chromium, un navigateur sans les deux) — un clone
//   retourné de la balise, posé juste après elle : inerte (`aria-hidden`, `inert`, hors de l'ordre
//   de tabulation, sans identifiant ni marque d'effet), refait quand la balise change.
// Sur un composant, ou sur une balise qui en contient un (même arrivé après la pose), la copie est impossible (un
// clone ferait naître un second composant) : blur et water y sont refusés avec un avertissement là où il n'existe pas
// de -moz-element, le reflet reste simple. L'onde de water est menée par une boucle d'images (arrêtée quand le reflet
// n'est pas à l'écran et dans un onglet caché). La boîte (moz,
// copy) est un frère de la balise juste après elle : un sélecteur `+` ou `:last-child` du projet le
// voit.

var _mjsFxReflectN = 0;

// UN observateur par parent, partagé par toutes les lignes qui portent l'effet : une liste de mille lignes
// réordonnée ne coûte qu'une passe — chaque boîte ramenée à sa balise, PUIS toutes les lectures de mise en
// page, PUIS toutes les écritures (lecture et écriture mêlées, ligne après ligne, refont la mise en page mille fois).
// Le suivi des tailles (une balise ou son parent qui change de taille, la fenêtre redimensionnée) passe par la
// même passe : un seul ResizeObserver par parent, qui rappelle une fois pour toutes les lignes
var _mjsFxReflectWatch = typeof WeakMap === 'function' ? new WeakMap() : null;

function _mjsFxReflectPass(subs) {
  var list = subs.slice();
  var i;
  for (i = 0; i < list.length; i++) list[i].fix();
  for (i = 0; i < list.length; i++) list[i].read();
  for (i = 0; i < list.length; i++) list[i].write();
}

// abonne une ligne (sub : el, fix, read, write) aux changements d'enfants et de taille de son parent ; rend le
// désabonnement (le dernier débranche les observateurs), idempotent ; `.pass`, s'il existe, rejoue la passe groupée
function _mjsFxReflectJoin(parent, sub) {
  if (!_mjsFxReflectWatch || !parent || typeof MutationObserver !== 'function') return function() {};
  var w = _mjsFxReflectWatch.get(parent);
  if (!w) {
    w = { subs: [], mo: null, ro: null, win: null };
    var run = function() { _mjsFxReflectPass(w.subs); };
    w.mo = new MutationObserver(run);
    w.mo.observe(parent, { childList: true });
    if (typeof ResizeObserver === 'function') {
      w.ro = new ResizeObserver(run);
      if (parent.nodeType === 1) w.ro.observe(parent);
      w.win = run;
      window.addEventListener('resize', run);
    }
    _mjsFxReflectWatch.set(parent, w);
  }
  w.subs.push(sub);
  if (w.ro && sub.el) w.ro.observe(sub.el);
  var leave = function() {
    var at = w.subs.indexOf(sub);
    if (at < 0) return;
    w.subs.splice(at, 1);
    if (w.ro && sub.el) w.ro.unobserve(sub.el);
    // déjà parti : rien à refaire, l'entrée du parent peut être celle d'un observateur plus récent
    if (w.subs.length === 0) {
      w.mo.disconnect();
      if (w.ro) w.ro.disconnect();
      if (w.win) window.removeEventListener('resize', w.win);
      _mjsFxReflectWatch.delete(parent);
    }
  };
  if (w.ro) leave.pass = function() { _mjsFxReflectPass(w.subs); };
  return leave;
}

// le premier composant (élément personnalisé) du contenu de la balise, '' sans composant
function _mjsFxReflectInner(el) {
  var all = el.getElementsByTagName ? el.getElementsByTagName('*') : [];
  for (var i = 0; i < all.length; i++) if ((all[i].localName || '').indexOf('-') > 0) return all[i].localName;
  return '';
}

// blur et water refusés : sur un composant, ou sur une balise qui en contient un (`inner`)
function _mjsFxReflectWarn(el, inner) {
  if (inner) return µ._mjs_msg('reflectBlurInside', { tag: el.localName, inner: inner }, '*reflect : <{tag}> contient un composant (<{inner}>), qu\'une copie ferait naître une seconde fois : blur et water ne sont pas possibles dans votre navigateur — le reflet reste simple');
  return µ._mjs_msg('reflectBlur', { tag: el.localName }, '*reflect : sur un composant (<{tag}>), blur et water ne sont pas possibles dans votre navigateur — le reflet reste simple');
}

var _MJS_FX_REFLECT_SENS = [['down', 'below', 'bottom'], ['up', 'above', 'top'], ['left', 'left', 'left'], ['right', 'right', 'right']];

// le fondu : opaque contre la balise, transparent après `size` % ; le même dégradé sert au reflet
// natif et à la copie (le masque se pose avant le retournement)
function _mjsFxReflectFade(to) {
  return 'linear-gradient(to ' + to + ',transparent calc(100% - var(--mjs-reflect-size,50%)),rgba(255,255,255,var(--mjs-reflect-opacity,0.5)))';
}

function _mjsFxReflectCss() {
  var css = '';
  for (var i = 0; i < _MJS_FX_REFLECT_SENS.length; i++) {
    var d = _MJS_FX_REFLECT_SENS[i];
    var f = _mjsFxReflectFade(d[2]);
    css += '[mjs-fx-reflect-mode="box"][mjs-fx-reflect-dir="' + d[0] + '"]{-webkit-box-reflect:' + d[1] + ' var(--mjs-reflect-gap,4px) ' + f + '}';
    css += '[mjs-fx-layer="reflect"][mjs-fx-reflect-dir="' + d[0] + '"]{-webkit-mask-image:' + f + ';mask-image:' + f + '}';
  }
  var x = 'var(--mjs-fx-reflect-x,0px)';
  var y = 'var(--mjs-fx-reflect-y,0px)';
  var w = 'var(--mjs-fx-reflect-w,0px)';
  var h = 'var(--mjs-fx-reflect-h,0px)';
  var g = 'var(--mjs-reflect-gap,4px)';
  return css
    + '[mjs-fx-layer="reflect"]{position:absolute!important;margin:0!important;right:auto!important;bottom:auto!important;box-sizing:border-box!important;width:' + w + '!important;height:' + h + '!important;left:' + x + '!important;top:' + y + '!important;pointer-events:none!important;transform-origin:50% 50%;transform:scaleY(-1)!important;filter:blur(var(--mjs-reflect-blur,0px));background:var(--mjs-fx-reflect-src,none) no-repeat 0 0/100% 100%}'
    + '[mjs-fx-layer="reflect"][mjs-fx-reflect-water]{filter:blur(var(--mjs-reflect-blur,0px)) var(--mjs-fx-reflect-water)}'
    + '[mjs-fx-layer="reflect"][mjs-fx-reflect-dir="down"]{top:calc(' + y + ' + ' + h + ' + ' + g + ')!important}'
    + '[mjs-fx-layer="reflect"][mjs-fx-reflect-dir="up"]{top:calc(' + y + ' - ' + h + ' - ' + g + ')!important}'
    + '[mjs-fx-layer="reflect"][mjs-fx-reflect-dir="left"]{left:calc(' + x + ' - ' + w + ' - ' + g + ')!important;transform:scaleX(-1)!important}'
    + '[mjs-fx-layer="reflect"][mjs-fx-reflect-dir="right"]{left:calc(' + x + ' + ' + w + ' + ' + g + ')!important;transform:scaleX(-1)!important}'
    + '[mjs-fx-layer="reflect-filter"]{position:absolute;width:0;height:0;overflow:hidden;pointer-events:none}'
    // mouvement réduit : l'eau ne bouge pas (l'onde reste figée, le filtre n'a plus d'animation, cf. setup)
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-layer="reflect"]{transition:none}}';
}

µ._mjs_fxDefs.reflect = {
  css: _mjsFxReflectCss(),
  vars: { gap: 'px', opacity: '', size: '%' },
  setup: function(el, s) {
    var dir   = /^(up|left|right)$/.test(s.direction) ? s.direction : 'down';
    var blur  = typeof s.blur === 'number' && s.blur > 0 ? s.blur : 0;
    var water = s.water === true;
    var host  = (el.localName || '').indexOf('-') > 0 || !!el._shadow;
    // un composant dans la balise : sa copie le ferait naître une seconde fois (constructeur et connectedCallback
    // relancés, puis encore à chaque changement du contenu) — la balise ne se copie pas plus qu'un composant
    var inner = host ? '' : _mjsFxReflectInner(el);
    var whole = host || inner !== '';
    var sup   = function(a, b) { try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports(a, b); } catch { return false; } };
    var natif = sup('-webkit-box-reflect', 'below 0');
    var moz   = sup('background', '-moz-element(#a)');
    var fancy = blur > 0 || water;
    var mode;
    if (!fancy) mode = natif ? 'box' : moz ? 'moz' : whole ? '' : 'copy';
    else if (moz) mode = 'moz';
    else if (whole) {
      mode = natif ? 'box' : '';
      µ.warn(_mjsFxReflectWarn(el, inner));
    }
    else mode = 'copy';
    if (mode === '') {
      if (!fancy) µ.warn(µ._mjs_msg('reflectNone', { tag: inner || el.localName }, '*reflect : votre navigateur n\'a ni reflet natif ni -moz-element, et un composant (<{tag}>) ne se copie pas — aucun reflet'));
      return function() {};
    }
    µ._mjs_dom.setAttribute(el, 'mjs-fx-reflect-mode', mode);
    µ._mjs_dom.setAttribute(el, 'mjs-fx-reflect-dir', dir);
    if (mode === 'box') {
      return function() {
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-reflect-mode');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-reflect-dir');
      };
    }
    var parent = el.parentNode;
    var id     = '';
    var gotId  = false;
    var box    = null;
    var svg    = null;
    var filter = '';
    var wave   = null;
    var mirror = { gap: 'px', opacity: '', size: '%' };
    var cur    = {};
    for (var k in mirror) if (s[k] !== void 0) cur[k] = s[k];
    // les réglages visuels recopiés sur la boîte : elle est à côté de la balise, pas dedans
    var vars = function(b) {
      for (var n in mirror) {
        if (cur[n] === void 0) b.style.removeProperty('--mjs-reflect-' + n);
        else b.style.setProperty('--mjs-reflect-' + n, cur[n] + mirror[n]);
      }
      if (blur) b.style.setProperty('--mjs-reflect-blur', blur + 'px');
    };
    if (water) {
      var ns = 'http://www.w3.org/2000/svg';
      var mk = function(tag, at) {
        var n = document.createElementNS(ns, tag);
        for (var a in at) µ._mjs_dom.setAttribute(n, a, at[a]);
        return n;
      };
      filter = 'mjs-fx-reflect-' + (++_mjsFxReflectN);
      svg = mk('svg', { 'aria-hidden': 'true', width: '0', height: '0', 'mjs-fx-layer': 'reflect-filter' });
      var f    = mk('filter', { id: filter, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' });
      var vert = dir === 'up' || dir === 'down';
      var lo   = vert ? [0.004, 0.04] : [0.04, 0.004];
      var hi   = vert ? [0.008, 0.07] : [0.07, 0.008];
      var turb = mk('feTurbulence', { type: 'fractalNoise', baseFrequency: lo.join(' '), numOctaves: '1', seed: '3', result: 'n' });
      f.appendChild(turb);
      f.appendChild(mk('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'n', scale: '12', xChannelSelector: 'R', yChannelSelector: 'G' }));
      svg.appendChild(f);
      // l'onde : un aller-retour de lo à hi en `speed`, mené par une boucle d'images — une animation SMIL dans le filtre
      // (`<animate>`) restait souvent figée dans Chromium, sa valeur jamais appliquée, l'horloge du svg pourtant en marche.
      // Arrêtée quand le reflet n'est pas à l'écran et dans un onglet caché ; aucune sous « réduire les animations »
      var period = µ._mjs_fxMs(s.speed, 4000);
      if (period > 0 && !µ._mjs_fxCalm() && typeof requestAnimationFrame === 'function') {
        var raf  = 0;
        var seen = true;
        var tick = function(now) {
          raf = 0;
          if (!seen || document.hidden) return;
          var t = (now % period) / period;
          var k = t < 0.5 ? 2 * t : 2 - 2 * t;
          turb.setAttribute('baseFrequency', (lo[0] + (hi[0] - lo[0]) * k).toFixed(5) + ' ' + (lo[1] + (hi[1] - lo[1]) * k).toFixed(5));
          raf = requestAnimationFrame(tick);
        };
        var wake = function() { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(tick); };
        var io   = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function(e) {
          seen = e[e.length - 1].isIntersecting;
          wake();
        }) : null;
        wave = {
          // la boîte suivie à l'écran : elle est refaite à chaque copie
          watch: function(b) {
            if (!io) return;
            io.disconnect();
            io.observe(b);
          },
          stop: function() {
            if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
            raf = 0;
            if (io) io.disconnect();
            document.removeEventListener('visibilitychange', wake);
          }
        };
        document.addEventListener('visibilitychange', wake);
        wake();
      }
    }
    // la place de la boîte : celle de la balise dans son parent positionné
    var m = [0, 0, 0, 0];
    var read = function() {
      m = [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight];
    };
    var write = function() {
      if (!box) return;
      box.style.setProperty('--mjs-fx-reflect-x', m[0] + 'px');
      box.style.setProperty('--mjs-fx-reflect-y', m[1] + 'px');
      box.style.setProperty('--mjs-fx-reflect-w', m[2] + 'px');
      box.style.setProperty('--mjs-fx-reflect-h', m[3] + 'px');
    };
    var place = function() {
      if (!box) return;
      read();
      write();
    };
    // la copie : le clone de la balise, sans identifiant ni marque d'effet, inerte
    var strip = function(n) {
      var at = n.attributes;
      for (var i = at.length - 1; i >= 0; i--) {
        var nm = at[i].name;
        if (nm === 'id' || nm.indexOf('mjs-fx') === 0) µ._mjs_dom.removeAttribute(n, nm);
      }
      if (/^(a|button|input|select|textarea|summary)$/.test(n.localName) || µ._mjs_dom.hasAttribute(n, 'tabindex') || µ._mjs_dom.hasAttribute(n, 'contenteditable')) µ._mjs_dom.setAttribute(n, 'tabindex', '-1');
    };
    var make = function() {
      var b;
      if (mode === 'moz') {
        b = document.createElement('div');
        // l'identifiant de l'auteur échappé : `#2024-photo` ou `#user.avatar` ne sont pas des identifiants CSS
        b.style.setProperty('--mjs-fx-reflect-src', '-moz-element(#' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id) + ')');
      }
      else {
        b = µ._mjs_dom.cloneNode(el, true);
        strip(b);
        var all = b.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) strip(all[i]);
      }
      b.setAttribute('mjs-fx-layer', 'reflect');
      b.setAttribute('mjs-fx-reflect-dir', dir);
      b.setAttribute('aria-hidden', 'true');
      b.setAttribute('inert', '');
      if (mode === 'copy') b.setAttribute('tabindex', '-1');
      if (water) {
        b.setAttribute('mjs-fx-reflect-water', '');
        b.style.setProperty('--mjs-fx-reflect-water', 'url(#' + filter + ')');
      }
      vars(b);
      return b;
    };
    if (mode === 'moz') {
      id = µ._mjs_dom.getAttribute(el, 'id') || '';
      if (!id) {
        id = 'mjs-fx-reflect-' + (++_mjsFxReflectN);
        µ._mjs_dom.setAttribute(el, 'id', id);
        gotId = true;
      }
    }
    // la première pose ne mesure rien : la passe groupée du parent le fait pour toutes les lignes d'un coup (mesurer
    // ici, juste après l'insertion, ferait refaire la mise en page de toute la liste à chaque ligne)
    var mount = function(first) {
      var b = make();
      if (box) box.replaceWith(b);
      else µ._mjs_dom.after(el, b);
      box = b;
      if (wave) wave.watch(b);
      if (!first) place();
    };
    mount(true);
    if (svg) box.after(svg);
    // la balise bouge dans son parent sans changer de taille (une ligne de liste à clé réordonnée) : ni la
    // taille de la balise ni celle du parent ne changent, rien n'appelle `place`, et la liste ne déplace que les
    // nœuds de la ligne — la boîte restait derrière les autres lignes, à l'ancienne place de sa balise, et le
    // reflet s'affichait sous une autre ligne. Chaque ajout ou retrait d'enfant du parent la ramène juste après
    // sa balise et la replace. D'autres frères d'effet (la bulle de *guard) peuvent s'être glissés entre les
    // deux : ils comptent pour rien, deux effets sur la même balise ne se disputent jamais la place
    var fix = function() {
      if (!box) return;
      // la balise a quitté le DOM (retirée à la main) : sa boîte ne reste pas orpheline ; elle revient avec la
      // balise si celle-ci est remise dans son parent
      if (!el.parentNode) {
        box.remove();
        if (svg) svg.remove();
        return;
      }
      var n = el.nextSibling;
      while (n && n !== box && n.nodeType === 1 && (µ._mjs_dom.hasAttribute(n, 'mjs-fx-layer') || µ._mjs_dom.hasAttribute(n, 'mjs-fx-guard-tip'))) n = n.nextSibling;
      if (n !== box) {
        µ._mjs_dom.after(el, box);
        if (svg) box.after(svg);
      }
    };
    var leave = _mjsFxReflectJoin(parent, {
      el: el,
      fix: fix,
      read: function() { if (box && el.parentNode) read(); },
      write: function() { if (box && el.parentNode) write(); }
    });
    // la copie suit la balise : son contenu, son adresse, sa classe
    var queued = false;
    var mo = mode === 'copy' && typeof MutationObserver === 'function' ? new MutationObserver(function() {
      if (queued) return;
      queued = true;
      Promise.resolve().then(function() {
        queued = false;
        if (!box) return;
        // un composant arrivé dans la balise : la copie s'arrête (elle le ferait naître une seconde fois), le reflet
        // reste simple là où le navigateur en a un
        var late = _mjsFxReflectInner(el);
        if (late === '') {
          mount();
          return;
        }
        stop();
        µ.warn(_mjsFxReflectWarn(el, late));
        if (natif) {
          µ._mjs_dom.setAttribute(el, 'mjs-fx-reflect-mode', 'box');
          µ._mjs_dom.setAttribute(el, 'mjs-fx-reflect-dir', dir);
        }
      });
    }) : null;
    if (mo) mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'class', 'alt', 'width', 'height'] });
    // les tailles (la balise, son parent, la fenêtre) sont suivies par l'observateur partagé, dont le premier rappel
    // place aussi la boîte ; sans lui (navigateur sans ResizeObserver), chaque ligne se place elle-même
    var shared = typeof leave.pass === 'function';
    var again  = shared ? leave.pass : place;
    if (!shared) {
      place();
      window.addEventListener('resize', place);
    }
    µ._mjs_dom.addEventListener(el, 'load', again);
    var stop = function() {
      if (mo) mo.disconnect();
      if (wave) wave.stop();
      leave();
      if (!shared) window.removeEventListener('resize', place);
      µ._mjs_dom.removeEventListener(el, 'load', again);
      if (box) box.remove();
      if (svg) svg.remove();
      box = null;
      if (gotId) µ._mjs_dom.removeAttribute(el, 'id');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-reflect-mode');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-reflect-dir');
    };
    // gap, opacity, size : suivis sur place ; les autres réglages relancent l'effet
    stop.set = function(k, v) {
      if (!(k in mirror)) return false;
      if (v === void 0) delete cur[k];
      else cur[k] = v;
      if (box) vars(box);
    };
    return stop;
  }
};
