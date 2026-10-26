// mjs_fx_transition — les transitions sont des effets. Sur le cycle de vie de la balise :
// `@in=*fly(up, distance: 200)` (son entrée, par un {if}/{for}/{key}), `@out=*fade` (sa sortie, qui
// attend la fin de l'effet), `@transition=*slide` (les deux) ; un effet qui se joue une fois
// (`@in=*scramble`, `@out=*shake`) y va aussi. Posée directement sur une balise, une transition se
// joue à l'arrivée à l'écran (`on: view` : la balise attend, cachée ; `once: false` la rejoue à
// chaque passage), suit le défilement (`on: scroll` : son passage à l'écran — `zone: 70% 40%`, la
// bande de l'écran où elle se joue —, ou une plage de la page, `range: 0 1000px`), se joue dès
// l'apparition (`on: load`), ou suit le survol de son parent (`on: hover` : cachée au repos, elle entre
// quand la souris arrive sur son parent et sort quand elle le quitte ; `of: '.carte'` désigne
// l'ancêtre à survoler à la place du parent ; le focus du clavier compte, au toucher un appui sur le
// parent la fait entrer et un appui ailleurs la fait sortir ; cachée, elle garde sa place, sauf *slide et
// *typewriter, dont la première image est une taille nulle : elles l'ont déjà au repos).
// Les animations vivent dans runtime/animations/<nom>.ts (µ.anim.<nom>) ; ce fichier traduit les
// réglages de l'effet (durées, directions, courbes) dans leurs options.
//
// Pour le build : les parties qui ne servent qu'à ce qu'une page écrit sont des SECTIONS MARQUÉES (`// @@ <étiquette>`, voir
// src/bundler/fx-sections.ts) : le survol (`on=hover`) et ce qui l'accompagne, le défilement (`on=scroll`), les réglages et les
// transitions neufs (`fly.rotate`, `iris.start`, `*pixelate`…). Ce que fait une transition quand on n'écrit rien d'autre reste hors
// section et part toujours ; tel quel, ce fichier porte tout.

// une courbe : un mot CSS, `cubic-bezier(…)`, ou une courbe de µeasing écrite en kebab (bounce-out
// → µ.easing.bounceOut)
function _mjsFxCurve(v) {
  if (typeof v !== 'string' || v === '') return void 0;
  if (/^(?:linear|ease|ease-in|ease-out|ease-in-out)$/.test(v) || /^cubic-bezier\(/.test(v)) return v;
  var nom = v.replace(/-(\w)/g, function(_, c) { return c.toUpperCase(); });
  return µ.easing && typeof µ.easing[nom] === 'function' ? µ.easing[nom] : void 0;
}

// les réglages d'une transition → les options de son animation
µ._mjs_fxAnimOpts = function(name, s) {
  var o = {};
  var p;
  if (s.duration !== void 0) o.duration = µ._mjs_fxMs(s.duration);
  if (s.delay !== void 0) o.delay = µ._mjs_fxMs(s.delay, 0);
  var e = _mjsFxCurve(s.easing);
  if (e) o.easing = e;
  switch (name) {
    case 'fly': {
      // la balise arrive en allant vers `direction` : elle part de l'autre côté, à `distance`
      var v = µ._mjs_fxVec(µ._mjs_fxDeg(s.direction, 0));
      // une distance qui ne se lit pas, ou d'une unité hors px, %, em, rem, vw, vh, vaut 40 : le pont la refuse, la lecture reste celle de l'animation
      var l = µ._mjs_animLen(/^-?\d*\.?\d+(px|%|r?em|v[wh])?$/.test(s.distance) ? s.distance : 40);
      o.x = Math.round(-v.x * l[0] * 100) / 100 + l[1];
      o.y = Math.round(-v.y * l[0] * 100) / 100 + l[1];
      if (s.opacity !== void 0) o.opacity = s.opacity;
      if (s.blur !== void 0) o.blur = s.blur;
      if (s.skew !== void 0) o.skew = s.skew;
      if (s.rotate !== void 0) o.rotate = s.rotate; // @@ fly.rotate
      break;
    }
    case 'scale':
    case 'rotate':
      if (s.start !== void 0) o.start = s.start;
      if (s.opacity !== void 0) o.opacity = s.opacity;
      if (s.angle !== void 0) o.angle = s.angle;
      if (s.axis) o.axis = s.axis;
      if (s.origin !== void 0) {
        p = µ._mjs_fxPoint(s.origin);
        o.origin = p.x * 100 + '% ' + p.y * 100 + '%';
      }
      break;
    case 'blur':
      if (s.amount !== void 0) o.amount = s.amount;
      if (s.opacity !== void 0) o.opacity = s.opacity;
      break;
    case 'slide':
      if (s.axis) o.axis = s.axis;
      break;
    case 'draw':
      // speed en px par seconde ; l'animation compte en px par ms
      if (s.speed !== void 0) o.speed = s.speed / 1000;
      break;
    case 'iris':
    case 'wheel':
      // `pointer` : le point où la souris a cliqué ou survolé en dernier, lu par l'animation à son jeu
      // @@ iris.origin=pointer
      if (s.origin === 'pointer') o.origin = 'pointer';
      else
      // @@
      if (s.origin !== void 0) {
        p = µ._mjs_fxPoint(s.origin);
        o.origin = [p.x, p.y];
      }
      if (s.shape) o.shape = s.shape;
      if (s.spokes !== void 0) o.spokes = s.spokes;
      if (s.reverse !== void 0) o.reverse = s.reverse;
      if (s.start !== void 0) o.start = s.start; // @@ iris.start
      if (s.angle !== void 0) o.angle = s.angle; // @@ iris.angle
      break;
    case 'swipe':
      o.angle = µ._mjs_fxDeg(s.direction, 90);
      break;
    case 'bars':
      if (s.count !== void 0) o.count = s.count;
      if (s.direction) o.dir = s.direction;
      break;
    case 'volet':
    case 'reveal':
    case 'flip':
    case 'cube':
    case 'turn':
      if (s.direction) o.dir = s.direction;
      break;
    case 'blocks':
      if (s.cols !== void 0) o.cols = s.cols;
      if (s.rows !== void 0) o.rows = s.rows;
      if (s.order !== void 0) o.order = s.order; // @@ blocks.order
      if (s.seed !== void 0) o.seed = s.seed; // @@ blocks.seed
      break;
    case 'typewriter':
      if (s.speed !== void 0) o.speed = s.speed;
      break;
    case 'shatter':
      if (s.size !== void 0) o.size = s.size;
      if (s.spread !== void 0) o.spread = s.spread;
      if (s.rotate !== void 0) o.rotate = s.rotate;
      break;
    // @@ pixelate.size pixelate.steps
    case 'pixelate':
      if (s.size !== void 0) o.size = s.size;
      if (s.steps !== void 0) o.steps = s.steps;
      break;
    // @@
    case 'ink':
      if (s.style !== void 0) o.style = s.style;
      if (s.image !== void 0) o.image = s.image;
      if (s.soft !== void 0) o.soft = s.soft;
      if (s.count !== void 0) o.count = s.count;
      if (s.seed !== void 0) o.seed = s.seed;
      if (s.invert !== void 0) o.invert = s.invert;
      if (s.direction !== void 0) o.angle = µ._mjs_fxDeg(s.direction, void 0);
      if (s.origin !== void 0) {
        p = µ._mjs_fxPoint(s.origin);
        o.origin = [p.x, p.y];
      }
      break;
  }
  return o;
};

// *crossfade : une paire par groupe (`group`, la page entière par défaut), créée à la première
// pose ; la balise qui sort vole vers celle qui entre avec la même clé ; sans homologue, `fallback`. Les réglages
// du groupe sont ceux de sa première pose : en développement, une pose suivante qui en écrit d'autres est signalée
// (une fois par groupe ; section du développement, jamais en production)
var _mjsFxXf = {};
function _mjsFxCrossfade(s) {
  var g = 'mjsxf-' + (s.group || 'page');
  if (!µ.anim || typeof µ.anim.crossfade !== 'function') return null;
  if (!_mjsFxXf[g]) {
    var fb = s.fallback === 'none' ? null : function(node) {
      var cs = window.getComputedStyle(node);
      var tf = cs.transform === 'none' ? '' : cs.transform;
      return {
        duration: µ._mjs_fxMs(s.duration, 400),
        easing: µ.easing.cubicOut,
        css: s.fallback === 'fade'
          ? function(t) { return { opacity: t }; }
          : function(t) { return { transform: (tf + ' scale(' + t + ')').trim(), opacity: t, transformOrigin: 'center' }; }
      };
    };
    µ.anim.crossfade(g, {
      duration: s.duration !== void 0 ? µ._mjs_fxMs(s.duration) : void 0,
      delay: s.delay !== void 0 ? µ._mjs_fxMs(s.delay, 0) : void 0,
      easing: _mjsFxCurve(s.easing),
      fallback: fb
    });
    _mjsFxXf[g] = { s: s };
  }
  // @@ dev
  else if (µ.instances && _mjsFxXf[g].s) {
    var first = _mjsFxXf[g].s;
    var other = ['duration', 'delay', 'easing', 'fallback'].filter(function(k) { return s[k] !== void 0 && String(s[k]) !== String(first[k]); });
    if (other.length > 0) {
      _mjsFxXf[g].s = null;
      µ.warn(µ._mjs_msg('dev.crossfadeGroup', { group: s.group || 'page', keys: other.join(', ') }, '*crossfade : le groupe « {group} » garde les réglages de sa première pose ; une pose suivante écrit d\'autres valeurs pour {keys}, qui ne comptent pas. Donnez les mêmes réglages à toutes les poses du groupe, ou placez celle-ci dans un autre groupe (group).'));
    }
  }
  // @@
  return { intro: µ.anim[g + 'Receive']({ key: s.key }).intro, outro: µ.anim[g + 'Send']({ key: s.key }).outro };
}

// la paire de durée 0 de « réduire les animations » : la balise entre et sort tout de suite, sans
// animation, et ses événements (`@introstart`, `@introend`, `@outrostart`, `@outroend`) partent comme
// pour une transition qui joue — une appli qui enchaîne son état sur `@outroend` ne reste pas en plan
function _mjsFxStill() {
  var settled = function() { return Promise.resolve(); };
  return { intro: settled, outro: settled };
}

// la paire { intro, outro } d'une transition, pour `@in`/`@out`/`@transition` ; « réduire les
// animations » demandé par le système : une paire de durée 0 (comme une transition posée directement,
// qui ne joue pas non plus, cf. _mjsFxAppear)
µ._mjs_fxAnim = function(comp, el, name, s, d, sp) {
  if (µ._mjs_fxCalm()) return _mjsFxStill();
  s = µ._mjs_fxSettings(el, name, s, d, sp);
  // un effet CSS de l'appli (fichier *.effects.mjs) : sa paire à lui
  var def = µ._mjs_fxDefs[name];
  if (def && typeof def.life === 'function') return def.life(s);
  if (name === 'crossfade') return _mjsFxCrossfade(s);
  var make = µ.anim && µ.anim[name];
  return typeof make === 'function' ? make(µ._mjs_fxAnimOpts(name, s)) : null;
};

// une transition créée par `µanim.create 'nom'` : ses réglages, déjà traduits à la compilation ;
// une paire de durée 0 en mouvement réduit
µ._mjs_fxAnimCustom = function(name, o) {
  if (µ._mjs_fxCalm()) return _mjsFxStill();
  var make = µ.anim && µ.anim[name];
  if (typeof make === 'function') return make(o);
  µ.warn(µ._mjs_msg('transitionNone', { name: name }, '*{name} : aucune transition de ce nom — µanim.create \'{name}\' n\'a pas été appelé.'));
  return null;
};

// un effet qui se joue une fois, sur le cycle de vie : posé à l'entrée ; à la sortie, rejoué, et la
// balise attend la fin de son jeu (ses animations finies, ou la durée que l'effet annonce)
µ._mjs_fxLife = function(comp, el, name, s, d, sp) {
  var all = µ._mjs_fxSettings(el, name, s, d, sp);
  var o   = {};
  for (var k in all) o[k] = all[k];
  o.on = 'load';
  var pose = function(node) {
    var off = node._mjs_fxOff && node._mjs_fxOff[name];
    if (off) off();
    µ._mjs_fx(comp, node, name, o);
  };
  return {
    intro: function(node) {
      pose(node);
      return Promise.resolve();
    },
    outro: function(node) {
      pose(node);
      return _mjsFxDone(node, name, o);
    }
  };
};

// la fin du jeu d'un effet : ses animations CSS finies, et la durée annoncée par l'effet
// (`span`), pour un effet mené en JavaScript ; jamais plus de 10 s
function _mjsFxDone(node, name, s) {
  var def   = µ._mjs_fxDefs[name];
  var ms    = def && typeof def.span === 'function' ? def.span(node, s) : 0;
  var anims = typeof node.getAnimations === 'function' ? µ._mjs_dom.getAnimations(node, { subtree: true }).filter(function(a) {
    var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    return t && isFinite(t.endTime);
  }) : [];
  return new Promise(function(res) {
    var cap   = setTimeout(res, 10000);
    var waits = anims.map(function(a) { return a.finished.catch(function() {}); });
    if (ms > 0) waits.push(new Promise(function(r) { setTimeout(r, ms); }));
    Promise.all(waits).then(function() {
      clearTimeout(cap);
      res();
    });
  });
}

// la balise tenue dans l'état de départ de son entrée (cachée), jusqu'à ce qu'elle joue : la
// transition repartira de là (t = 0) et relâchera la tenue
function _mjsFxHold(el, factory, watched) {
  var cfg;
  try {
    cfg = factory(el);
  }
  catch {
    return;
  }
  if (!cfg) return;
  if (typeof cfg.tick === 'function') {
    (el._mjs_tick_cfgs || (el._mjs_tick_cfgs = new Map())).set(factory, cfg);
    cfg.tick(0, 1);
    el._mjs_transition_state = { tValue: function() { return 0; }, abort: function() { if (el._mjs_transition_state === this) el._mjs_transition_state = null; } };
    return;
  }
  if (!cfg.css || typeof el.animate !== 'function') return;
  var f0   = cfg.css(0, 1);
  // tenue sous un observateur de visibilité (`watched`, on: view) : une première image découpée (*iris, *volet, *bars,
  // *blocks) ou déplacée (*fly, *scale, *volet…) se tient par la seule opacité — l'observateur juge la balise à sa place :
  // Chromium compte la découpe de la balise elle-même dans ce qu'il voit, une découpe d'aire nulle ne serait jamais « vue » ;
  // une translation sortirait de l'écran la boîte observée d'une balise posée tout en haut, ou la sortirait d'un parent qui
  // rogne (`overflow: hidden`) : jamais vue, elle restait invisible pour toujours. Rien ne se voit davantage : la balise attend
  // invisible, à sa place, et son entrée repart de sa première image. Les clics passent à ce qui est dessous, comme avec la
  // découpe (pointer-events: none le temps de la tenue : la valeur de l'auteur revient d'elle-même quand la tenue est défaite)
  var move = watched && f0 && !!f0.transform;
  var clip = move || (watched && f0 && f0.clipPath);
  if (clip) f0 = { opacity: 0, pointerEvents: 'none' };
  var hold = µ._mjs_animate(el, [f0, f0], { duration: 0, fill: 'forwards' });
  el._mjs_transition_state = {
    tValue: function() { return 0; },
    abort: function() {
      try {
        hold.cancel();
      }
      catch {}
      if (el._mjs_transition_state === this) el._mjs_transition_state = null;
    }
  };
  return move ? 'move' : clip ? 'clip' : '';
}

// les réglages image par image d'une paire oubliés (une relance, un réglage changé en refont
// d'autres) ; `clean` : ce qu'ils ont posé hors de la balise défait (`cleanup` : le calque de *shatter)
function _mjsFxForget(el, pair, clean) {
  var cfgs = el._mjs_tick_cfgs;
  if (!cfgs) return;
  [pair.intro, pair.outro].forEach(function(f) {
    var cfg = f ? cfgs.get(f) : null;
    if (!cfg) return;
    cfgs.delete(f);
    if (clean && typeof cfg.cleanup === 'function') cfg.cleanup();
  });
}

// arrêt d'une transition posée directement (effet retiré, relancé) : son jeu en cours coupé, ses
// réglages image par image oubliés et défaits
function _mjsFxStop(el, pair) {
  var st = el._mjs_transition_state;
  if (st && typeof st.abort === 'function') st.abort();
  _mjsFxForget(el, pair, true);
}

// @@ on=scroll
// le conteneur qui défile autour de la balise (frontières des composants franchies), sinon null :
// la page
function _mjsFxScroller(el) {
  for (var n = el.parentNode || el.host; n && n.nodeType !== 9; n = n.parentNode || n.host) {
    if (n.nodeType !== 1) continue;
    var cs = window.getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY || '') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

// l'animation d'entrée, pilotée par le défilement de la page, ou du conteneur qui défile autour de
// la balise : `range` (deux positions de défilement, en px ou en vh), sinon le passage de la balise
// dans la zone visible (cf. µ._mjs_fxAdvance) — entre les deux hauteurs de sa bande `zone`, ou, sans
// elle, 0 quand son haut touche le bas de la zone, 1 quand son milieu en atteint le milieu
function _mjsFxScrub(el, factory, s) {
  var cfg;
  try {
    cfg = factory(el);
  }
  catch {
    return null;
  }
  if (!cfg) return null;
  var anim = null;
  // les images clés d'une animation de `c`, en pause : le défilement les parcourt
  var keys = function(c) {
    var frames = [];
    for (var i = 0; i <= 60; i++) {
      var t = i / 60;
      var f = c.css(t, 1 - t);
      f.offset = t;
      frames.push(f);
    }
    var a = µ._mjs_animate(el, frames, { duration: 1000, fill: 'both' });
    a.pause();
    return a;
  };
  if (cfg.css && typeof el.animate === 'function') anim = keys(cfg);
  else if (typeof cfg.tick !== 'function') return null;
  // le conteneur qui défile : cherché à la pose, puis après la mise en page (son contenu peut
  // s'allonger), et à chaque redimensionnement ; son défilement est écouté sur lui-même (celui d'un
  // conteneur ne traverse pas l'ombre d'un composant)
  var port  = null;
  var range = null;
  var zone  = µ._mjs_fxZone(s.zone);
  var raf   = 0;
  var ask = function() { if (!raf) raf = requestAnimationFrame(update); };
  var bind = function() {
    var p = _mjsFxScroller(el);
    if (p !== port) {
      if (port) µ._mjs_dom.removeEventListener(port, 'scroll', ask);
      port = p;
      if (port) µ._mjs_dom.addEventListener(port, 'scroll', ask, { passive: true });
    }
    // deux bornes (la forme vérifiée à la compilation) ; une plage tenue par une variable et
    // malformée n'en est pas une : le passage à l'écran, comme sans plage
    var bouts = s.range ? /^(-?\d*\.?\d+(?:px|vh)?) (-?\d*\.?\d+(?:px|vh)?)$/.exec(String(s.range)) : null;
    if (bouts) {
      var px = function(x) { return /vh$/.test(x) ? parseFloat(x) * (port ? port.clientHeight : window.innerHeight) / 100 : parseFloat(x); };
      range = [px(bouts[1]), px(bouts[2])];
    }
  };
  var update = function() {
    raf = 0;
    if (port && !port.isConnected) bind();
    var p;
    if (range) p = ((port ? port.scrollTop : window.scrollY) - range[0]) / Math.max(1, range[1] - range[0]);
    else {
      var box = port ? µ._mjs_dom.getBoundingClientRect(port) : { top: 0, height: window.innerHeight || 1 };
      p = µ._mjs_fxAdvance(µ._mjs_dom.getBoundingClientRect(el), box, zone);
    }
    if (!isFinite(p)) return;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    if (anim) anim.currentTime = p * 1000;
    else cfg.tick(p, 1 - p);
  };
  var resize = function() {
    bind();
    ask();
  };
  // des images clés qui dépendent de la boîte de la balise (`cfg.measured` : un polygone tourné en pixels, un point de
  // la souris pris dans la boîte) : refaites quand elle change de taille — l'observateur le dit d'abord après la
  // mise en page, la balise n'avait pas de boîte à la pose ; sans changement de taille, rien n'est refait
  var watch = null;
  var built = el.offsetWidth + 'x' + el.offsetHeight;
  if (anim && cfg.measured && typeof ResizeObserver === 'function') {
    watch = new ResizeObserver(function() {
      var size = el.offsetWidth + 'x' + el.offsetHeight;
      if (size === built) return;
      built = size;
      var next = null;
      try {
        next = factory(el);
      }
      catch {
        return;
      }
      if (!next || !next.css) return;
      var at = anim.currentTime;
      anim.cancel();
      cfg  = next;
      anim = keys(next);
      anim.currentTime = at;
      ask();
    });
    watch.observe(el);
  }
  bind();
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', resize);
  var first = requestAnimationFrame(function() {
    first = 0;
    bind();
    update();
  });
  update();
  return function() {
    window.removeEventListener('scroll', ask);
    window.removeEventListener('resize', resize);
    if (watch) watch.disconnect();
    if (port) µ._mjs_dom.removeEventListener(port, 'scroll', ask);
    if (raf) cancelAnimationFrame(raf);
    if (first) cancelAnimationFrame(first);
    if (anim) {
      try {
        anim.cancel();
      }
      catch {}
    }
    else if (typeof cfg.cleanup === 'function') cfg.cleanup();
  };
}
// @@

// @@ on=hover
// le parent d'un nœud, la frontière d'un composant franchie (à la racine de son ombre, c'est son
// hôte) ; null au sommet
function _mjsFxHoverUp(n) {
  var p = n.parentNode;
  return p && p.nodeType === 11 ? p.host || null : p;
}

// le parent dont le survol commande la balise : le plus proche ancêtre qui vérifie `sel` (réglage
// `of`), sinon son parent direct ; un sélecteur qui ne trouve personne, ou illisible, est dit
function _mjsFxHoverParent(el, name, sel) {
  var direct = _mjsFxHoverUp(el);
  if (typeof sel !== 'string' || sel === '' || !direct) return direct;
  try {
    for (var n = direct; n && n.nodeType === 1; n = _mjsFxHoverUp(n)) {
      if (µ._mjs_dom.matches(n, sel)) return n;
    }
  }
  catch {}
  µ.warn(µ._mjs_msg('hoverOf', { name: name, of: sel }, '*{name} : aucun ancêtre de la balise ne vérifie « {of} » (réglage of) : son parent direct commande le survol. Vérifiez ce sélecteur.'));
  return direct;
}

// la racine qui adopte la feuille de la balise : l'ombre du composant qui la porte, sinon sa racine
function _mjsFxHoverRoot(el, comp) {
  var sh = comp && comp._shadow;
  if (sh && sh.nodeType === 11) return sh;
  var r = µ._mjs_dom.getRootNode(el);
  return r && r.adoptedStyleSheets ? r : document;
}

// les écouteurs d'un parent, un seul jeu pour toutes les balises qui le suivent (celles qui le désignent par `of` comprises) :
// posé avec la première, retiré avec la dernière. Pointeur : arrivée et départ ; focus : entrée et sortie. Le jeu garde l'état
// du parent (souris dedans, focus dedans, appui du doigt), que chaque balise relit à chaque événement. Ceux de l'appui, un
// `pointerdown` sur le parent et un sur la page, n'existent que tant qu'il tient les balises ouvertes
var _mjsFxHoverSets = new WeakMap();

function _mjsFxHoverOpen(parent) {
  var set   = { parent: parent, subs: [], hov: false, foc: false, tap: false, close: null };
  var undo  = [];
  var mark  = null;
  var tapOn = false;
  // chaque balise relit l'état du parent
  var tell = function() {
    var subs = set.subs.slice();
    for (var i = 0; i < subs.length; i++) subs[i]();
  };
  var on2 = function(ev, f) {
    µ._mjs_dom.addEventListener(parent, ev, f, { passive: true });
    undo.push(function() { µ._mjs_dom.removeEventListener(parent, ev, f); });
  };
  var asked = function(sel) {
    try {
      return µ._mjs_dom.matches(parent, sel);
    }
    catch {
      return false;
    }
  };
  // l'appui du doigt : dedans (noté sur le parent) ou ailleurs (vu par la page) ; le même événement
  // passe par les deux, l'appui ailleurs est celui que le parent n'a pas noté
  var noteDown = function(e) { mark = e; };
  var away = function(e) {
    if (e === mark) return;
    set.tap = false;
    listenTap(false);
    tell();
  };
  var listenTap = function(yes) {
    if (yes === tapOn) return;
    tapOn = yes;
    var doc = parent.ownerDocument || document;
    var f   = yes ? µ._mjs_dom.addEventListener : µ._mjs_dom.removeEventListener;
    f(parent, 'pointerdown', noteDown, { passive: true });
    f(doc, 'pointerdown', away, { passive: true });
    if (!yes) mark = null;
  };
  on2('pointerenter', function(e) {
    if (e.pointerType === 'touch') {
      set.tap = true;
      listenTap(true);
    }
    else set.hov = true;
    tell();
  });
  on2('pointerleave', function(e) {
    // le doigt levé n'est pas une sortie (seul un appui ailleurs referme), et il ne retire pas la souris : sur un appareil à
    // souris et à écran tactile, les deux peuvent être dans le parent en même temps
    if (e.pointerType === 'touch') return;
    set.hov = false;
    tell();
  });
  on2('focusin', function() {
    set.foc = true;
    tell();
  });
  on2('focusout', function(e) {
    // le focus qui passe d'une balise du parent à une autre ne sort pas
    var to = e.relatedTarget;
    if (to && µ._mjs_dom.contains(parent, to)) return;
    set.foc = false;
    tell();
  });
  // déjà survolé, ou le focus déjà dedans, quand la première balise se pose (un bloc `{if}` qui s'ouvre sous la souris)
  set.hov = asked(':hover');
  set.foc = asked(':focus-within');
  set.close = function() {
    for (var i = 0; i < undo.length; i++) undo[i]();
    listenTap(false);
  };
  return set;
}

// la balise rejoint le jeu de son parent (créé par la première)
function _mjsFxHoverJoin(parent, sync) {
  var set = _mjsFxHoverSets.get(parent);
  if (!set) {
    set = _mjsFxHoverOpen(parent);
    _mjsFxHoverSets.set(parent, set);
  }
  set.subs.push(sync);
  return set;
}

// la balise quitte le jeu de son parent ; le jeu part avec la dernière
function _mjsFxHoverLeave(set, sync) {
  var i = set.subs.indexOf(sync);
  if (i >= 0) set.subs.splice(i, 1);
  if (set.subs.length > 0) return;
  set.close();
  _mjsFxHoverSets.delete(set.parent);
}

// @@
// @@ *typewriter
// le texte d'un *typewriter lié a pu changer depuis son dernier jeu : son réglage image par image, que le moteur retient, est
// oublié et refait à la prochaine entrée ; les autres transitions menées image par image gardent le leur (la pixellisation,
// l'éclatement y portent leur état)
function _mjsFxReread(el, pair) {
  var cfgs = el._mjs_tick_cfgs;
  if (!cfgs) return;
  [pair.intro, pair.outro].forEach(function(f) {
    var cfg = f ? cfgs.get(f) : null;
    if (cfg && cfg.reread) cfgs.delete(f);
  });
}
// @@

// @@ on=hover
// @@ *typewriter
// la balise passe d'un coup (« réduire les animations » demandé après la pose) : un *typewriter tenu au texte vide retrouve son
// texte entier, relu dans la balise (sa liaison a pu le réécrire) ; les autres transitions menées image par image n'y sont pas touchées
function _mjsFxFinish(el, pair) {
  var cfgs = el._mjs_tick_cfgs;
  var cfg  = cfgs ? cfgs.get(pair.intro) : null;
  if (!cfg || !cfg.reread) return;
  cfgs.delete(pair.intro);
  try {
    cfg = pair.intro(el);
  }
  catch {
    return;
  }
  if (cfg && typeof cfg.tick === 'function') cfg.tick(1, 0);
}
// @@

// `on: hover` : la balise, cachée au repos, joue son entrée quand la souris arrive sur son parent et
// sa sortie quand elle le quitte — la transition de chaque nom, à l'envers pour sortir, avec ses
// réglages ; un retournement en cours de route repart de l'état courant (µ._mjs_runTransition lit
// l'avancée de celle qu'il interrompt). Le focus du clavier compte comme la souris ; au toucher, un
// appui sur le parent la fait entrer et un appui ailleurs la fait sortir (le doigt levé n'est pas
// une sortie). Rien ne tourne au repos : un jeu de quatre écouteurs passifs sur le parent, partagé par
// toutes les balises qui le suivent (pointeur : arrivée et départ ; focus : entrée et sortie), ni boucle ni
// observateur ; ceux de l'appui n'existent que tant qu'il tient les balises ouvertes. Cachée, la
// balise garde sa place : `visibility` (marque `mjs-fx-hover="rest"`), donc plus de clic ni de
// lecture d'écran — sauf *slide et *typewriter, dont la première image n'a pas la taille de la balise
// (une hauteur nulle, un texte vide) : au repos elles ont déjà cette première image et ne gardent
// pas leur place, sans quoi ce qui les suit sauterait à la première image de l'entrée (*slide :
// la feuille de repos reproduit sa première image, marque `mjs-fx-fold` ; *typewriter : son texte
// est vidé dès la pose, sans animation tenue). « Réduire les animations » : elle apparaît et
// disparaît d'un coup. Limite : le parent est celui de la pose, la balise déplacée ensuite sous un autre
// parent reste attachée au premier (rien ne la surveille : ni observateur ni boucle)
function _mjsFxHover(el, name, make, cur, comp) {
  var pair = make(µ._mjs_fxAnimOpts(name, cur));
  if (!pair || !pair.intro) return null;
  µ._mjs_fxAdopt(_mjsFxHoverRoot(el, comp), '_hover');
  var set   = null;
  var dead  = false;
  var shown = false;
  var idle  = true;
  var seq   = 0;
  // pas d'animations Web, ou « réduire les animations » : tout se fait d'un coup
  var instant = function() { return µ._mjs_fxCalm() || typeof el.animate !== 'function'; };
  // la tenue d'une sortie finie (son dernier état), rendue : sans elle, l'entrée suivante lirait la balise
  // encore cachée
  var release = function() {
    if (typeof el._mjs_pendingFillRelease === 'function') el._mjs_pendingFillRelease();
  };
  // le jeu en cours coupé, ce qu'il a posé rendu
  var cut = function() {
    _mjsFxStop(el, pair);
    release();
  };
  // au repos : cachée, sa place gardée — sauf *slide, qui a déjà sa première image (la feuille la lui donne)
  var rest = function() {
    µ._mjs_dom.setAttribute(el, 'mjs-fx-hover', 'rest');
    if (name === 'slide') µ._mjs_dom.setAttribute(el, 'mjs-fx-fold', cur.axis === 'x' ? 'x' : 'y');
    idle = true;
    release();
  };
  var unmark = function() {
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-hover');
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-fold');
  };
  var go = function(want) {
    var n    = ++seq;
    var calm = instant();
    if (want) {
      release();
      unmark();
      // d'un coup : un *typewriter tenu au texte vide le retrouve entier ; sinon l'entrée qui part du repos relit tout (le texte
      // d'un *typewriter lié a pu changer depuis son dernier jeu)
      // @@ *typewriter
      if (calm) _mjsFxFinish(el, pair);
      else if (idle) _mjsFxReread(el, pair);
      // @@
      idle = false;
    }
    if (calm) {
      cut();
      if (!want) rest();
      return;
    }
    // la sortie finie sans qu'un autre jeu l'ait relayée : la balise retourne se cacher
    µ._mjs_playTransition(el, want ? pair.intro : pair.outro || pair.intro, want ? 'in' : 'out').then(function() {
      if (!want && n === seq) rest();
    });
  };
  // l'état voulu : la souris, le focus ou un appui tient le parent
  var sync = function() {
    var want = set.hov || set.foc || set.tap;
    if (want === shown) return;
    shown = want;
    go(want);
  };
  // le parent n'est connu qu'une fois la balise dans la page : celui d'une balise à la racine d'un composant,
  // d'un bloc qui s'ouvre, n'existe pas encore à la pose
  var wire = function() {
    var parent = _mjsFxHoverParent(el, name, cur.of);
    if (!parent) {
      unmark();
      return;
    }
    set   = _mjsFxHoverJoin(parent, sync);
    shown = set.hov || set.foc || set.tap;
    if (shown) go(true);
  };
  // cachée d'emblée, avant la première image
  rest();
  if (el.isConnected) wire();
  else µ._mjs_whenLayouted(el, function() { if (!dead) wire(); });
  // *typewriter : son texte vide dès le repos, la première image de son entrée ; une fois le texte posé dans la balise
  // @@ *typewriter
  if (name === 'typewriter') {
    µ._mjs_whenLayouted(el, function() {
      if (!dead && !shown && !instant() && !el._mjs_transition_state) _mjsFxHold(el, pair.intro);
    });
  }
  // @@
  var stop = function() {
    dead = true;
    seq++;
    if (set) _mjsFxHoverLeave(set, sync);
    unmark();
    cut();
  };
  // un réglage tenu par une variable : ses prochains jeux le prennent, sans rejouer ; le parent changé
  // (on, of), l'effet repart ; once, range et zone ne disent rien au survol
  stop.set = function(k, v) {
    if (k === 'on' || k === 'of') return false;
    if (k === 'once' || k === 'range' || k === 'zone') return true;
    var next = Object.assign(Object.create(null), cur);
    if (v === void 0) delete next[k];
    else next[k] = v;
    var fresh = make(µ._mjs_fxAnimOpts(name, next));
    if (!fresh || !fresh.intro) return false;
    _mjsFxForget(el, pair, false);
    cur  = next;
    pair = fresh;
    // l'axe de *slide a changé : au repos, la balise reprend la première image du nouvel axe
    if (k === 'axis' && name === 'slide' && set && !shown) rest();
    return true;
  };
  return stop;
}
// @@

// une transition posée directement sur une balise
function _mjsFxAppear(el, name, s, comp) {
  var make = µ.anim && µ.anim[name];
  if (typeof make !== 'function') return null;
  // au survol : cachée au repos, elle suit celui de son parent (d'un coup, quand les animations sont réduites) ; once, range et zone
  // n'y disent rien : un avertissement, une fois à la pose
  // @@ on=hover
  if (s.on === 'hover') {
    var mute = ['once', 'range', 'zone'].filter(function(k) { return s[k] !== void 0; });
    if (mute.length > 0) µ.warn(µ._mjs_msg('hoverIgnored', { name: name, list: mute.join(', ') }, '*{name} : au survol (on: hover), les réglages suivants ne servent à rien : {list}. Retirez-les.'));
    return _mjsFxHover(el, name, make, Object.assign(Object.create(null), s), comp);
  }
  // @@
  // `of` désigne le parent du survol : sans on: hover, il ne sert à rien
  // @@ of
  if (s.of !== void 0) µ.warn(µ._mjs_msg('hoverOfAlone', { name: name }, '*{name} : le réglage of ne sert qu\'avec on: hover — il est ignoré ici. Retirez-le, ou ajoutez on: hover.'));
  // @@
  // réduire les animations, ou pas d'animations Web : la balise reste à sa place, visible
  if (µ._mjs_fxCalm() || typeof el.animate !== 'function') return null;
  // recopiés sans prototype, comme reçus : un réglage que la page n'a pas écrit reste absent
  var cur  = Object.assign(Object.create(null), s);
  var pair = make(µ._mjs_fxAnimOpts(name, cur));
  if (!pair || !pair.intro) return null;
  var on = cur.on || 'view';
  if (on === 'scroll') return _mjsFxScrub(el, pair.intro, cur); // @@ on=scroll
  // tenue cachée dans l'état de départ de son entrée, en attendant de jouer ; `watched` : sous l'observateur de visibilité ;
  // `clipped` : tenue par l'opacité au lieu de sa première image, découpée ou déplacée (voir _mjsFxHold), `moved` : déplacée ; `kept` : la dernière sortie, dont la dernière
  // image, une fois finie, reste gardée sans état (cf. µ._mjs_runTransition)
  var held    = false;
  var watched = false;
  var clipped = false;
  var moved   = false;
  var dead    = false;
  var kept    = null;
  var hold = function() {
    var how = _mjsFxHold(el, pair.intro, watched);
    if (how) clipped = true;
    if (how === 'move') moved = true;
    held = true;
  };
  // la dernière image gardée d'une sortie finie défaite : la balise est de nouveau telle que l'auteur l'a écrite
  var release = function() {
    if (kept && typeof kept.abort === 'function') kept.abort();
    kept = null;
  };
  var play = function(dir) {
    // l'entrée qui part du repos (tenue, ou finie) relit tout : le texte d'un *typewriter lié a pu changer depuis son dernier jeu
    if (dir === 'in' && (held || !el._mjs_transition_state)) _mjsFxReread(el, pair); // @@ *typewriter
    // la sortie finie est défaite avant l'entrée, sinon sa dernière image reparaît quand l'entrée finit, quelle que soit la
    // transition ; une sortie encore en cours est reprise par la transition, d'où elle en est
    if (dir === 'in') {
      if (kept === el._mjs_transition_state) kept = null;
      release();
    }
    held = false;
    return µ._mjs_playTransition(el, dir === 'out' ? pair.outro || pair.intro : pair.intro, dir);
  };
  var stop;
  // à la réussite (ou à l'échec) de l'action de la balise : cachée d'ici là, elle arrive à chaque fois
  if (on === 'success' || on === 'error') {
    hold();
    var gone = µ._mjs_fxOnResult(el, on, function() { play('in'); });
    stop = function() {
      gone();
      _mjsFxStop(el, pair);
    };
  }
  else if (on === 'load' || typeof IntersectionObserver !== 'function') {
    play('in');
    stop = function() { _mjsFxStop(el, pair); };
  }
  else {
    watched = true;
    hold();
    var shown = false;
    var busy  = false;
    // vue quand 15 % d'elle, ou 15 % de l'écran pour une balise plus haute que lui, est à l'écran
    // (µ._mjs_fxSeen) : tenue cachée, une très haute balise resterait sinon invisible
    var io = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].target !== el) continue;
        // `busy` : une balise tenue par l'opacité est jugée à sa place, jamais pendant qu'elle bouge. Son entrée part d'une découpe
        // d'aire nulle (que Chromium compte dans ce que voit l'observateur) ou d'une boîte déplacée ; la sortie d'une balise déplacée
        // (`moved`) la ramène vers l'écran quand elle est juste au-delà d'un bord (*fly sorti par le haut redescend de 40 px ; *volet
        // aussi sous Firefox, qui ne compte pas la découpe) : l'observateur qui l'entendait la faisait rentrer, ressortir, et ainsi
        // sans fin. Tant qu'une entrée, ou la sortie d'une balise déplacée, joue il est sourd ; elle finie, la balise est à sa place
        // (entière, ou tenue de nouveau) et il est interrogé de nouveau. La sortie d'une découpe seule (*iris, *bars) reste écoutée :
        // un retour à l'écran la reprend d'où elle en est
        if (busy) continue;
        var seen = µ._mjs_fxSeen(entries[i], 0.15);
        if (seen && !shown) {
          shown = true;
          var coming = play('in');
          if (cur.once !== false) io.disconnect();
          else if (clipped && coming && typeof coming.then === 'function') {
            busy = true;
            coming.then(function() {
              busy = false;
              if (dead) return;
              io.unobserve(el);
              io.observe(el);
            });
          }
        }
        else if (!entries[i].isIntersecting && shown && cur.once === false) {
          shown = false;
          var left  = play('out');
          var going = el._mjs_transition_state;
          kept = going;
          // une sortie découpée ou déplacée finit d'aire nulle, ou ailleurs qu'à sa place : finie, sa dernière image (gardée
          // sans état, cf. µ._mjs_runTransition) est défaite et la balise tenue de nouveau comme avant sa première entrée ;
          // déplacée, l'observateur, sourd pendant la sortie, est réinterrogé
          if (clipped && left && typeof left.then === 'function') {
            if (moved) busy = true;
            left.then(function() {
              if (moved) busy = false;
              if (dead || shown) return;
              if (going && typeof going.abort === 'function') going.abort();
              if (kept === going) kept = null;
              hold();
              if (moved) {
                io.unobserve(el);
                io.observe(el);
              }
            });
          }
        }
      }
    }, { threshold: µ._mjs_fxSteps(0.15) });
    io.observe(el);
    stop = function() {
      dead = true;
      io.disconnect();
      _mjsFxStop(el, pair);
      release();
    };
  }
  // un réglage de l'animation tenu par une variable (durée, distance…) : ses prochains jeux le
  // prennent, sans rejouer l'entrée — tenue, la balise l'est de nouveau dans le nouvel état de départ ;
  // le déclencheur changé (on, once, range, zone), l'effet repart
  stop.set = function(k, v) {
    if (k === 'on' || k === 'once' || k === 'range' || k === 'zone') return false;
    var next = Object.assign(Object.create(null), cur);
    if (v === void 0) delete next[k];
    else next[k] = v;
    var fresh = make(µ._mjs_fxAnimOpts(name, next));
    if (!fresh || !fresh.intro) return false;
    if (held) _mjsFxStop(el, pair);
    else _mjsFxForget(el, pair, false);
    cur  = next;
    pair = fresh;
    if (held) hold();
    return true;
  };
  return stop;
}

[
  'fade', 'fly', 'slide', 'scale', 'rotate', 'blur', 'draw', 'iris', 'wheel', 'volet', 'reveal', 'flip', 'cube', 'turn', 'swipe', 'bars', 'blocks', 'shatter',
  'pixelate', // @@ *pixelate
  'ink', 'typewriter'
].forEach(function(n) {
  µ._mjs_fxDefs[n] = { css: '', vars: {}, setup: function(el, s, comp) { return _mjsFxAppear(el, n, s, comp); } };
});

// @@ on=hover
// la feuille commune de `on: hover`, adoptée à la première pose : la balise au repos est cachée sans quitter
// la mise en page ; *slide (marque `mjs-fx-fold`, l'axe de son glissement) y a déjà sa première image : la taille nulle
// qu'elle prend à la première image de son entrée (hauteur, marges, remplissage et bordures de l'axe)
µ._mjs_fxDefs._hover = { css: '[mjs-fx-hover="rest"]{visibility:hidden!important}'
  + '[mjs-fx-hover="rest"][mjs-fx-fold="y"]{height:0!important;min-height:0!important;padding-top:0!important;padding-bottom:0!important;margin-top:0!important;margin-bottom:0!important;border-top-width:0!important;border-bottom-width:0!important;overflow:hidden!important}'
  + '[mjs-fx-hover="rest"][mjs-fx-fold="x"]{width:0!important;min-width:0!important;padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important;border-left-width:0!important;border-right-width:0!important;overflow:hidden!important}' };
// @@
