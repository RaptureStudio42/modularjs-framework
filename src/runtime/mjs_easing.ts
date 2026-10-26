// mjs_easing — courbes d'animation, @keyframes partagés, attente de mise en page, épinglage de position et
// moteur des transitions (µ._mjs_playTransition / µ._mjs_runTransition)
// fichier simple, sans import : seuls les noms posés sur µ sortent, les aides locales portent le préfixe _tx

//COURBES : toutes définies pour t quelconque (aucun bornage), chacune est une fonction à part (empreinte du mode partagé)

var _txE = µ.easing = {};

_txE.linear = function(t) { return t; };

_txE.quadIn    = function(t) { return t * t; };
_txE.quadOut   = function(t) { return 1 - (1 - t) * (1 - t); };
_txE.quadInOut = function(t) { return t < .5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2; };

_txE.cubicIn    = function(t) { return t ** 3; };
_txE.cubicOut   = function(t) { return 1 - (1 - t) ** 3; };
_txE.cubicInOut = function(t) { return t < .5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2; };

_txE.quartIn    = function(t) { return t ** 4; };
_txE.quartOut   = function(t) { return 1 - (1 - t) ** 4; };
_txE.quartInOut = function(t) { return t < .5 ? 8 * t ** 4 : 1 - (2 - 2 * t) ** 4 / 2; };

_txE.quintIn    = function(t) { return t ** 5; };
_txE.quintOut   = function(t) { return 1 - (1 - t) ** 5; };
_txE.quintInOut = function(t) { return t < .5 ? 16 * t ** 5 : 1 - (2 - 2 * t) ** 5 / 2; };

_txE.sineIn    = function(t) { return 1 - Math.cos(t * Math.PI / 2); };
_txE.sineOut   = function(t) { return Math.sin(t * Math.PI / 2); };
_txE.sineInOut = function(t) { return (1 - Math.cos(Math.PI * t)) / 2; };

// racine d'un radicande négatif : NaN laissé tel quel
_txE.circIn    = function(t) { return 1 - Math.sqrt(1 - t * t); };
_txE.circOut   = function(t) { return Math.sqrt(1 - (t - 1) * (t - 1)); };
_txE.circInOut = function(t) { return t < .5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - (2 * t - 2) ** 2) + 1) / 2; };

_txE.expoIn    = function(t) { return t === 0 ? 0 : 2 ** (10 * (t - 1)); };
_txE.expoOut   = function(t) { return t === 1 ? 1 : 1 - 2 ** (-10 * t); };
_txE.expoInOut = function(t) {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < .5 ? 2 ** (10 * (2 * t - 1)) / 2 : (2 - 2 ** (-10 * (2 * t - 1))) / 2;
};

// recul : 1,70158 puis 1,70158 * 1,525 pour l'aller-retour
_txE.backIn    = function(t) { return t * t * (2.70158 * t - 1.70158); };
_txE.backOut   = function(t) { return (t - 1) * (t - 1) * (2.70158 * (t - 1) + 1.70158) + 1; };
_txE.backInOut = function(t) {
  var u = 2 * t;
  if (u < 1) return u * u * (3.5949095 * u - 2.5949095) / 2;
  u -= 2;
  return (u * u * (3.5949095 * u + 2.5949095) + 2) / 2;
};

// élastique : sinusoïde sous une enveloppe exponentielle, déphasée d'un quart de période
_txE.elasticIn = function(t) {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return -(2 ** (10 * (t - 1))) * Math.sin((t - 1.075) * 2 * Math.PI / .3);
};
_txE.elasticOut   = function(t) { return Math.sin(-13 * (t + 1) * Math.PI / 2) * 2 ** (-10 * t) + 1; };
_txE.elasticInOut = function(t) {
  if (t === 0) return 0;
  if (t === 1) return 1;
  var u    = 2 * t;
  var wave = Math.sin((u - 1.1125) * 2 * Math.PI / .45);
  return u < 1 ? -.5 * 2 ** (10 * (u - 1)) * wave : .5 * 2 ** (-10 * (u - 1)) * wave + 1;
};

// rebond : une parabole par morceau, contacts avec le sol en 4/11, 8/11, 9/10 et 1
_txE.bounceOut = function(t) {
  if (t < 4 / 11) return 7.5625 * t * t;
  if (t < 8 / 11) return 9.075 * t * t - 9.9 * t + 3.4;
  if (t < .9) return 4356 / 361 * t * t - 35442 / 1805 * t + 16061 / 1805;
  return 10.8 * t * t - 20.52 * t + 10.72;
};
_txE.bounceIn    = function(t) { return 1 - _txE.bounceOut(1 - t); };
_txE.bounceInOut = function(t) { return t < .5 ? (1 - _txE.bounceOut(1 - 2 * t)) / 2 : _txE.bounceOut(2 * t - 1) / 2 + .5; };

//BEZIER CSS

// x(s) ou y(s) d'une cubique de Bézier de bornes 0 et 1, points de contrôle a et b
var _txBez = function(a, b, s) {
  var r = 1 - s;
  return 3 * r * r * s * a + 3 * r * s * s * b + s * s * s;
};

// x1 et x2 dans [0, 1] (contrat CSS), sinon repli cubicOut ; abscisse résolue par 24 dichotomies
_txE.bezier = function(x1, y1, x2, y2) {
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    if (µ.debug) µ.warn('[mjs-tx] ' + µ._mjs_txt('txBezierRange', { x1: x1, y1: y1, x2: x2, y2: y2 }, 'cubic-bezier({x1}, {y1}, {x2}, {y2}) : x1/x2 hors de [0, 1] — repli cubicOut'));
    return _txE.cubicOut;
  }
  return function(t) {
    var lo = 0;
    var hi = 1;
    var mid;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    for (var i = 0; i < 24; i++) {
      mid = (lo + hi) / 2;
      if (_txBez(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return _txBez(y1, y2, (lo + hi) / 2);
  };
};

//RESOLVEUR : nom exact d'un mot-clé vers la courbe de µ.easing
var _txAlias      = { 'linear': 'linear', 'ease': 'cubicInOut', 'ease-in': 'cubicIn', 'ease-out': 'cubicOut', 'ease-in-out': 'cubicInOut' };
var _txBezierText = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/;

_txE.resolve = function(e) {
  var m;
  var n;
  if (!e) return _txE.cubicOut;
  if (typeof e === 'function') return e;
  if (typeof e === 'string') {
    m = _txBezierText.exec(e);
    if (m) {
      n = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      if (n[0] >= 0 && n[0] <= 1 && n[2] >= 0 && n[2] <= 1 && n[1] <= Infinity && n[3] <= Infinity) return _txE.bezier(n[0], n[1], n[2], n[3]);
    }
    if (Object.prototype.hasOwnProperty.call(_txAlias, e)) return _txE[_txAlias[e]];
  }
  if (µ.debug) µ.warn('[mjs-tx] ' + µ._mjs_txt('txEasingUnknown', { e: e }, 'easing inconnu « {e} » — repli cubicOut (attendu : linear, ease, ease-in, ease-out, ease-in-out, cubic-bezier(x1,y1,x2,y2), ou une fonction)'));
  return _txE.cubicOut;
};

//ANIMATION NATIVE : la méthode du prototype, insensible à un `animate` de composant qui la masquerait
µ._mjs_animate = µ._mjs_animate || function(node, frames, opts) {
  if (typeof Element === 'function' && node instanceof Element && typeof Element.prototype.animate === 'function') return Element.prototype.animate.call(node, frames, opts);
  return node.animate(frames, opts);
};

//@KEYFRAMES PARTAGES : une feuille et un registre par racine (document ou shadow root), règles comptées en références

µ.anim = µ.anim || {};

var _txRoots = new WeakMap();

// racine d'un nœud : son shadow root s'il en a un, le document sinon
var _txRootOf = function(node) {
  var root = node.getRootNode && node.getRootNode();
  return root && root.host ? root : document;
};

// enregistrement d'une racine : { sheet: feuille ou <style>, reg: nom -> { css, refs, textNode } }, créé à la demande
var _txSheetOf = function(root) {
  var rec    = _txRoots.get(root);
  var shadow = !!root.host;
  var style;
  if (rec) return rec;
  rec = { sheet: null, reg: new Map() };
  if (µ._csp) {
    rec.sheet = new CSSStyleSheet();
    rec.sheet.replaceSync('');
    if (shadow) rec.sheet._mjs_keep = true;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, rec.sheet];
  }
  else {
    style = document.createElement('style');
    if (shadow) {
      style.setAttribute('data-mjs-anim-keyframes', '');
      root.appendChild(style);
    }
    else {
      style.setAttribute('id', '_mjs_anim_keyframes');
      document.head.appendChild(style);
    }
    rec.sheet = style;
  }
  _txRoots.set(root, rec);
  return rec;
};

// texte d'une règle : images `P% { prop: valeur; … }`, P = offset * 100 sur 2 décimales
var _txRuleText = function(name, frames) {
  var parts = frames.map(function(frame) {
    var decls = Object.keys(frame).filter(function(k) { return k !== 'offset'; }).map(function(k) {
      return k.replace(/[A-Z]/g, function(c) { return '-' + c.toLowerCase(); }) + ': ' + frame[k];
    });
    return (frame.offset * 100).toFixed(2) + '% { ' + decls.join('; ') + ' }';
  });
  return '@keyframes ' + name + ' { ' + parts.join(' ') + ' }';
};

µ.anim._mjs_acquireKeyframes = function(name, builder, root) {
  var rec;
  var entry;
  var css;
  var textNode = null;
  root         = root || document;
  entry        = _txRoots.has(root) ? _txRoots.get(root).reg.get(name) : null;
  if (entry) {
    entry.refs++;
    return name;
  }
  css = _txRuleText(name, builder());
  rec = _txSheetOf(root);
  if (µ._csp) {
    rec.sheet.insertRule(css, rec.sheet.cssRules.length);
  }
  else {
    textNode = document.createTextNode(css);
    rec.sheet.appendChild(textNode);
  }
  rec.reg.set(name, { css: css, refs: 1, textNode: textNode });
  return name;
};

µ.anim._mjs_releaseKeyframes = function(name, root) {
  var rec   = _txRoots.get(root || document);
  var entry = rec && rec.reg.get(name);
  var rules;
  if (!entry) return;
  if (--entry.refs > 0) return;
  if (µ._csp) {
    rules = rec.sheet.cssRules;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].name === name) {
        rec.sheet.deleteRule(i);
        break;
      }
    }
  }
  else {
    rec.sheet.removeChild(entry.textNode);
  }
  rec.reg.delete(name);
};

//ATTENTE DE MISE EN PAGE : fn jamais appelée sur un nœud détaché ; au 1er appel toujours différée d'une micro-tâche
// (le nœud peut naître dans un fragment inséré juste après ; les effets du même lot remplissent le contenu avant la peinture)
µ._mjs_whenLayouted = function(node, fn, attempts=0) {
  if (attempts >= 30) {
    if (node.isConnected) fn();
    return;
  }
  if (attempts === 0 && typeof queueMicrotask === 'function') {
    queueMicrotask(function() {
      if (node.isConnected) fn();
      else requestAnimationFrame(function() { µ._mjs_whenLayouted(node, fn, 1); });
    });
    return;
  }
  if (node.isConnected) fn();
  else requestAnimationFrame(function() { µ._mjs_whenLayouted(node, fn, attempts + 1); });
};

// Moteur des transitions : aiguillage, modes css / tick / partagé

var _txCount = 0;

// empreinte déterministe (base 36) d'un texte
var _txHash = function(text) {
  var h = 5381;
  for (var i = 0; i < text.length; i++) h = (h * 33 ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

// nombre d'images : 60 par défaut, au moins 1, jamais NaN ni infini
var _txSteps = function(steps) {
  if (steps == null) return 60;
  steps = Number(steps);
  if (!isFinite(steps)) return 60;
  return steps < 1 ? 1 : steps;
};

// annulation d'une animation, erreur ignorée (signalée en debug)
var _txCancel = function(anim) {
  try {
    anim.cancel();
  }
  catch (err) {
    if (µ.debug) µ.warn('[mjs-tx] cancel failed', err);
  }
};

// fin d'une animation css partagée : un seul @keyframes pour N nœuds ; rend une promesse sans valeur
µ.anim._mjs_runShared = function(node, name, builder, opts) {
  var root = _txRootOf(node);
  var dur;
  var delay;
  var ease;
  var fill;
  var before;
  var state;
  var settled = false;
  var stamp;
  µ.anim._mjs_acquireKeyframes(name, builder, root);
  dur                  = opts.duration ?? 400;
  delay                = opts.delay ?? 0;
  ease                 = opts.cssEasing ?? 'linear';
  fill                 = opts.fill ?? 'forwards';
  before               = node.style.animation;
  node.style.animation = name + ' ' + dur + 'ms ' + ease + ' ' + delay + 'ms ' + fill;
  stamp                = performance.now();
  return new Promise(function(resolve) {
    var settle = function() {
      if (settled) return;
      settled = true;
      node.removeEventListener('animationend', onEnd);
      node.removeEventListener('animationcancel', onEnd);
      µ.anim._mjs_releaseKeyframes(name, root);
      if (node._mjs_transition_state === state) node._mjs_transition_state = null;
      resolve();
    };
    // les évènements d'animation remontent des descendants, et le remplacement de style.animation émet un animationcancel de l'ancienne
    var onEnd = function(ev) {
      if (ev.target !== node) return;
      if (ev.animationName && ev.animationName !== name) return;
      node.style.animation = before;
      settle();
    };
    state = {
      aborted: false,
      direction: opts.direction,
      tValue: function() {
        var p = Math.min(Math.max((performance.now() - stamp - delay) / Math.max(dur, 1e-6), 0), 1);
        return opts.direction === 'in' ? p : 1 - p;
      },
      // écouteurs retirés AVANT que l'appelant n'écrive sa propre valeur de style.animation
      abort: function() {
        state.aborted = true;
        settle();
      }
    };
    node._mjs_transition_state = state;
    node.addEventListener('animationend', onEnd);
    node.addEventListener('animationcancel', onEnd);
  });
};

// mode partagé : repart de zéro (pas de reprise à mi-course), nom du @keyframes dérivé de l'empreinte
var _txRunShared = function(node, cfg, direction, txId) {
  var ease   = µ.easing.resolve(cfg.easing);
  var steps  = _txSteps(cfg.steps);
  var frames = [];
  var name;
  var p;
  var t;
  try {
    // l'empreinte est celle des images clés elles-mêmes : un échantillon du css ou le texte de la courbe (le même pour
    // toutes les cubic-bezier()) donnait le même @keyframes à deux transitions jouées ensemble — entrées par la gauche et
    // par la droite, courbes différentes —, et la seconde jouait celles de la première
    for (var i = 0; i <= steps; i++) {
      p = i / steps;
      t = ease(direction === 'in' ? p : 1 - p);
      frames.push({ ...cfg.css(t, 1 - t), offset: p });
    }
    name = '_kf_' + _txHash(JSON.stringify(frames));
    return µ.anim._mjs_runShared(node, name, function() { return frames; }, { duration: cfg.duration, delay: cfg.delay, direction: direction });
  }
  catch (err) {
    µ.warn('[mjs-tx] ' + µ._mjs_txt('txCssSharedThrew', { direction: direction, txId: txId }, 'cfg.css() a levé (transition partagée {direction} #{txId}) — transition close proprement :'), err);
    return Promise.resolve(direction);
  }
};

// mode tick : cfg.tick(t, u) à chaque image, état annulable, résolu une seule fois
var _txRunTick = function(node, cfg, t1, t2, direction, txId) {
  var delta = t2 - t1;
  var dur;
  var delay;
  var ease;
  if (Math.abs(delta) < 1e-4) return Promise.resolve();
  dur   = Math.abs(delta) * (cfg.duration ?? 400);
  delay = Math.max(cfg.delay ?? 0, 0);
  ease  = µ.easing.resolve(cfg.easing);
  return new Promise(function(resolve) {
    var done     = false;
    var raf      = null;
    var running  = false;
    var progress = 0;
    var origin   = performance.now();
    var state;
    var finish = function() {
      if (done) return;
      done = true;
      if (raf !== null) {
        try {
          cancelAnimationFrame(raf);
        }
        catch {}
        raf = null;
      }
      if (node._mjs_transition_state === state) node._mjs_transition_state = null;
      resolve(direction);
    };
    // une erreur de tick ferme la transition, sans nouvelle tentative
    var tick = function(t) {
      try {
        cfg.tick(t, 1 - t);
        return true;
      }
      catch (err) {
        µ.warn('[mjs-tx] ' + µ._mjs_txt('txTickThrew', { direction: direction, txId: txId }, 'cfg.tick() a levé (transition {direction} #{txId}) — transition close proprement :'), err);
        finish();
        return false;
      }
    };
    var frame = function(now) {
      var elapsed = now - origin - delay;
      raf         = null;
      if (state.aborted) return finish();
      if (elapsed < 0) {
        if (tick(t1)) raf = requestAnimationFrame(frame);
        return;
      }
      running  = true;
      progress = Math.min(elapsed / Math.max(dur, 1e-6), 1);
      if (!tick(t1 + delta * ease(progress))) return;
      if (progress < 1) raf = requestAnimationFrame(frame);
      else finish();
    };
    state = {
      aborted: false,
      direction: direction,
      tValue: function() { return running ? t1 + delta * ease(progress) : t1; },
      abort: function() {
        state.aborted = true;
        finish();
      }
    };
    node._mjs_transition_state = state;
    raf                        = requestAnimationFrame(frame);
  });
};

// mode css : images clés reconstruites depuis la position courante t1 vers la cible t2 (durée proportionnelle à la distance)
var _txRunCss = function(node, cfg, t1, t2, direction, txId) {
  var delta = t2 - t1;
  var dur;
  var delay;
  var ease;
  var steps;
  var start;
  var frames = [];
  var state;
  var p;
  var t;
  if (Math.abs(delta) < 1e-4) return Promise.resolve();
  dur   = Math.abs(delta) * (cfg.duration ?? 400);
  delay = Math.max(cfg.delay ?? 0, 0);
  ease  = µ.easing.resolve(cfg.easing);
  steps = _txSteps(cfg.steps);
  try {
    start = cfg.css(t1, 1 - t1);
    for (var i = 0; i <= steps; i++) {
      p = i / steps;
      t = t1 + delta * ease(p);
      frames.push({ ...cfg.css(t, 1 - t), offset: p });
    }
  }
  catch (err) {
    // aucune animation créée à ce stade : le nœud garde son état naturel
    µ.warn('[mjs-tx] ' + µ._mjs_txt('txCssThrew', { direction: direction, txId: txId }, 'cfg.css() a levé (transition {direction} #{txId}) — transition close proprement :'), err);
    return Promise.resolve(direction);
  }
  state = {
    direction: direction,
    t1: t1,
    delta: delta,
    easing: ease,
    aborted: false,
    inDelay: true,
    anim: null,
    // position visuelle : t1 pendant l'attente ou après annulation, sinon lue sur la progression de la vraie animation
    tValue: function() {
      if (state.aborted || state.inDelay || !state.anim) return t1;
      return t1 + delta * ease(state.anim.effect?.getComputedTiming?.()?.progress ?? 1);
    },
    abort: function() {
      state.aborted = true;
      if (state.anim) {
        _txCancel(state.anim);
        state.anim = null;
      }
      if (node._mjs_transition_state === state) node._mjs_transition_state = null;
    }
  };
  node._mjs_transition_state = state;
  return new Promise(function(resolve) {
    // anti-flash : animation d'attente (durée = retard) qui épingle l'image de départ avant la première peinture
    var wait   = µ._mjs_animate(node, [start, start], { duration: delay, fill: 'forwards' });
    state.anim = wait;
    wait.finished.then(function() {
      var real;
      if (state.aborted) return resolve(direction);
      _txCancel(wait);
      state.inDelay = false;
      real          = µ._mjs_animate(node, frames, { duration: dur, fill: 'forwards' });
      state.anim    = real;
      real.finished.then(function() {
        if (state.aborted) return;
        node._mjs_transition_state = null;
        if (direction === 'out') {
          // remplissage gardé : le groupe de destruction libère tous ses membres ensemble
          node._mjs_pendingFillRelease = function() {
            _txCancel(real);
            node._mjs_pendingFillRelease = null;
          };
        }
        else {
          _txCancel(real);
        }
        resolve(direction);
      }, function() { resolve(direction); });
    }, function() { resolve(direction); });
  });
};

µ._mjs_runTransition = function(node, ref, direction) {
  var t2 = direction === 'in' ? 1 : 0;
  var prev;
  var t1;
  var cfg;
  var cache;
  var txId;
  if (!ref) return Promise.resolve();
  node._mjs_tx_id = node._mjs_tx_id || ++_txCount;
  txId            = node._mjs_tx_id;
  // position courante lue AVANT l'annulation ; l'annulation libère le remplissage, le nœud retrouve ses dimensions pour la fabrique
  prev = node._mjs_transition_state;
  if (prev) {
    t1 = prev.tValue();
    prev.abort();
  }
  else {
    t1 = direction === 'in' ? 0 : 1;
  }
  if (typeof ref === 'function') {
    // une cfg à tick est gardée par fabrique (son état capturé ne se refait pas) ; une cfg à css est refaite à chaque fois
    cache = node._mjs_tick_cfgs = node._mjs_tick_cfgs || new Map();
    if (cache.has(ref)) {
      cfg = cache.get(ref);
    }
    else {
      try {
        cfg = ref(node);
      }
      catch (err) {
        µ.warn('[mjs-tx] ' + µ._mjs_txt('txSetupThrew', { direction: direction, txId: txId }, 'setup() a levé (transition {direction} #{txId}) — transition close proprement :'), err);
        return Promise.resolve(direction);
      }
      if (cfg && typeof cfg.tick === 'function') cache.set(ref, cfg);
    }
  }
  else {
    cfg = ref;
  }
  if (!cfg) return Promise.resolve();
  if (typeof cfg.tick === 'function') return _txRunTick(node, cfg, t1, t2, direction, txId);
  if (!cfg.css) return Promise.resolve();
  if (node._mjs_anim_mode === 'shared') return _txRunShared(node, cfg, direction, txId);
  return _txRunCss(node, cfg, t1, t2, direction, txId);
};

// aiguillage d'une référence de transition : fabrique, ancienne forme (fonction), ou cfg
µ._mjs_playTransition = function(node, ref, direction) {
  var res;
  if (!ref) return Promise.resolve();
  if (µ.debug) µ.log('[mjs-tx] play', direction);
  if (typeof ref === 'function') {
    if (ref._isCfgFactory) return µ._mjs_runTransition(node, ref, direction);
    try {
      res = ref(node);
    }
    catch (err) {
      if (µ.debug) µ.warn('[mjs-tx] legacy transition threw', err);
      return Promise.resolve();
    }
    if (res instanceof Promise) return res;
    if (res && res.css) return µ._mjs_runTransition(node, res, direction);
    return Promise.resolve();
  }
  if (ref.css) return µ._mjs_runTransition(node, ref, direction);
  return Promise.resolve();
};

//EPINGLAGE : fige un nœud sortant d'une liste là où il était, avant que la remise en ordre ne le déplace
// left/top et margin 0, jamais un transform (le fondu croisé anime le transform)
µ._mjs_fixPosition = function(node, targetRect) {
  var style;
  var width;
  var height;
  var rect;
  var anchor;
  var left;
  var top;
  if (!node || node.nodeType !== 1 || !node.style) return;
  style = window.getComputedStyle(node);
  if (style.position === 'absolute' || style.position === 'fixed') return;
  width               = style.width;
  height              = style.height;
  rect                = targetRect || node.getBoundingClientRect();
  node.style.position = 'absolute';
  node.style.margin   = '0';
  node.style.width    = width;
  node.style.height   = height;
  anchor              = node.offsetParent;
  if (!targetRect && anchor) {
    // boîte de mise en page : insensible aux transformations, déjà relative au bord de remplissage de l'ancre
    left = node.offsetLeft;
    top  = node.offsetTop;
  }
  else {
    var origin = anchor ? anchor.getBoundingClientRect() : { left: 0, top: 0 };
    left       = rect.left - origin.left - (anchor ? anchor.clientLeft : 0);
    top        = rect.top - origin.top - (anchor ? anchor.clientTop : 0);
  }
  node.style.left    = left + 'px';
  node.style.top     = top + 'px';
  node._mjs_posFixed = true;
};

// retrait : le style en ligne retombe sur la feuille de style ou la prochaine liaison dynamique
µ._mjs_unfixPosition = function(node) {
  if (!node || !node._mjs_posFixed || !node.style) return;
  ['position', 'margin', 'width', 'height', 'left', 'top'].forEach(function(prop) { node.style.removeProperty(prop); });
  node._mjs_posFixed = false;
};
