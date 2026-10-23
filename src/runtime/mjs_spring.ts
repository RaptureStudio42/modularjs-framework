// µ.spring : valeur animée par un oscillateur amorti, un pas unitaire par image
// x'' = k·(c − x) − a·x' (Euler semi-implicite : vitesse d'abord, position avec la nouvelle vitesse)
// une valeur peut être un nombre, un tableau ou un objet : chaque nombre est une feuille indépendante

const SPRING_WARN = '[µspring] ';

// bornes de réglage : stabilité du schéma k < 4 − 2a, repos atteignable (a > 0, précision > 0)
const clampDamping   = function(a) {
  if (typeof a !== 'number' || !isFinite(a)) return 0.8;
  return Math.min(1, Math.max(0.01, a));
};

const clampStiffness = function(k, damping) {
  const top = 4 - 2 * damping - 0.01;
  if (typeof k !== 'number' || !isFinite(k)) return Math.min(0.15, top);
  return Math.min(top, Math.max(0.001, k));
};

const clampPrecision = function(p) {
  return (typeof p === 'number' && isFinite(p) && p > 0) ? p : 0.01;
};

// nature d'une valeur : num, array, object ou other (texte, null, booléen, undefined)
const kindOf = function(v) {
  if (typeof v === 'number') return 'num';
  if (Array.isArray(v)) return 'array';
  if (v !== null && typeof v === 'object') return 'object';
  return 'other';
};

const hasKey = function(o, key) {
  return Object.prototype.hasOwnProperty.call(o, key);
};

// fini en profondeur : un « autre » compte pour fini
const isDeepFinite = function(v) {
  const kind = kindOf(v);
  if (kind === 'num') return isFinite(v);
  if (kind === 'other') return true;
  return Object.keys(v).every(function(key) { return isDeepFinite(v[key]); });
};

// range une clé de la valeur animée sur une copie : `__proto__` y reste une clé comme une autre — l'affectation
// `copie['__proto__'] = …` changerait le prototype de la copie au lieu d'y ranger la donnée
const putKey = function(o, key, v) {
  if (key === '__proto__') Object.defineProperty(o, key, { value: v, writable: true, enumerable: true, configurable: true });
  else o[key] = v;
};

// zéro de même forme (un « autre » donne 0)
const zerosLike = function(v) {
  const kind = kindOf(v);
  if (kind === 'array') return v.map(zerosLike);
  if (kind === 'object') {
    const out = {};
    for (const key of Object.keys(v)) putKey(out, key, zerosLike(v[key]));
    return out;
  }
  return 0;
};

// vitesse d'une sous-branche, 0 si la vitesse n'a pas cette forme
const speedAt = function(vel, key) {
  return (vel !== null && typeof vel === 'object') ? vel[key] : 0;
};

// un pas pour la valeur cur vers tgt ; rend [position, vitesse]
// run.moved : une feuille n'est pas au repos ; run.reshaped : une branche a changé de nature
const advance = function(cur, vel, tgt, p, run) {
  const ck = kindOf(cur);
  const tk = kindOf(tgt);
  if (ck === 'other') return [tgt, zerosLike(tgt)];
  if (tk !== 'other' && tk !== ck) {
    run.reshaped = true;
    return [tgt, zerosLike(tgt)];
  }
  if (ck === 'num') {
    const v  = (typeof vel === 'number') ? vel : 0;
    const nv = v + p.k * (tgt - cur) - p.a * v;
    const nx = cur + nv;
    // seuil de repos à l'échelle de la cible : près d'une très grande valeur, ou sous une précision plus fine que l'écart
    // représentable, le ressort restait près de la cible sans jamais se poser — pas k·écart arrondi à zéro (terme 1/k), ou
    // cycle d'arrondi d'un ressort raide peu amorti, 200 crans au plus mesurés (terme 1024). Valeur ordinaire : la précision.
    // Près de zéro, le plus petit écart représentable est Number.MIN_VALUE : sous 1e-320, le ressort ne se posait jamais
    const eps = Math.max(p.eps, (Math.abs(tgt) * Number.EPSILON + Number.MIN_VALUE) * (1024 + 1 / p.k));
    if (Math.abs(nv) < eps && Math.abs(tgt - nx) < eps) return [tgt, 0];
    run.moved = true;
    return [nx, nv];
  }
  const isArray = ck === 'array';
  const same    = tk === ck;
  let keys;
  if (isArray) {
    const n = Math.max(cur.length, same ? tgt.length : 0);
    keys    = [];
    for (let i = 0; i < n; i++) keys.push(i);
  }
  else {
    keys = Object.keys(cur);
    if (same) {
      for (const key of Object.keys(tgt)) if (!hasKey(cur, key)) keys.push(key);
    }
  }
  const xs = isArray ? [] : {};
  const vs = isArray ? [] : {};
  for (const key of keys) {
    const inCur = isArray ? key < cur.length : hasKey(cur, key);
    const inTgt = same && (isArray ? key < tgt.length : hasKey(tgt, key));
    if (inCur && inTgt) {
      const pair = advance(cur[key], speedAt(vel, key), tgt[key], p, run);
      putKey(xs, key, pair[0]);
      putKey(vs, key, pair[1]);
    }
    else if (inCur) {
      putKey(xs, key, cur[key]);
      putKey(vs, key, zerosLike(cur[key]));
    }
    else {
      putKey(xs, key, tgt[key]);
      putKey(vs, key, zerosLike(tgt[key]));
    }
  }
  return [xs, vs];
};

// formes incompatibles entre deux composites de même genre (longueurs ou clés différentes)
const shapeMismatch = function(cur, tgt) {
  if (Array.isArray(cur) && Array.isArray(tgt)) return cur.length !== tgt.length;
  if (kindOf(cur) === 'object' && kindOf(tgt) === 'object') {
    const ck = Object.keys(cur);
    return ck.length !== Object.keys(tgt).length || ck.some(function(key) { return !hasKey(tgt, key); });
  }
  return false;
};

const warnSpring = function(text) {
  µ.warn(SPRING_WARN + text);
};

class Spring {
  constructor(value, stiffness = 0.15, damping = 0.8, min = null, max = null) {
    this.current           = value;
    this.target            = value;
    this.velocity          = zerosLike(value);
    this.min               = min;
    this.max               = max;
    this._mjs_invalidators = new Map();
    this._mjs_precision    = 0.01;
    // l'amortissement d'abord : il fixe la borne de la raideur
    this._mjs_damping   = clampDamping(damping);
    this._mjs_stiffness = clampStiffness(stiffness, this._mjs_damping);
    µ._mjs_interpolatorSet.add(this);
  }

  get value() { return this.target; }

  set value(v) {
    if (!isDeepFinite(v)) return;
    if (typeof v === 'number') {
      if (this.min !== null) v = Math.max(this.min, v);
      if (this.max !== null) v = Math.min(this.max, v);
      if (typeof this.current !== 'number') {
        warnSpring(µ._mjs_txt('springShapeToNumber', null, 'la cible change de forme (objet/tableau → nombre) — le ressort redémarre à zéro sur la nouvelle forme.'));
        this.current  = 0;
        this.velocity = 0;
      }
      else if (v === this.target) return;
    }
    else {
      const curIsArray = Array.isArray(this.current);
      if (typeof this.current === 'number') {
        warnSpring(µ._mjs_txt('springShapeToObject', null, 'la cible change de forme (nombre → objet/tableau) — le ressort redémarre à zéro sur la nouvelle forme.'));
        this.current  = zerosLike(v);
        this.velocity = zerosLike(v);
      }
      else if (curIsArray !== Array.isArray(v)) {
        warnSpring(µ._mjs_txt('springContainerKind', null, 'la cible change de nature de conteneur (objet <-> tableau) — le ressort redémarre à zéro sur la nouvelle forme.'));
        this.current  = zerosLike(v);
        this.velocity = zerosLike(v);
      }
      else if (shapeMismatch(this.current, v)) warnSpring(µ._mjs_txt('springShapeMismatch', null, 'la cible n\'a pas la même forme que la valeur courante (clés ou longueur différentes) — chaque axe est traité indépendamment : absent de la cible => figé à sa valeur courante, absent de current => apparaît sans animer.'));
    }
    this.target = v;
    µ.Ticker.add(this);
  }

  get stiffness() { return this._mjs_stiffness; }

  set stiffness(k) {
    this._mjs_stiffness = clampStiffness(k, this._mjs_damping);
    this._mjs_notify();
  }

  get damping() { return this._mjs_damping; }

  set damping(a) {
    this._mjs_damping   = clampDamping(a);
    this._mjs_stiffness = clampStiffness(this._mjs_stiffness, this._mjs_damping);
    this._mjs_notify();
  }

  get precision() { return clampPrecision(this._mjs_precision); }

  set precision(p) { this._mjs_precision = clampPrecision(p); }

  _mjs_attachInvalidator(owner, fn) {
    this._mjs_invalidators.set(owner, fn);
    return fn;
  }

  // abonnés dans l'ordre d'insertion ; un propriétaire mort est retiré sans appel
  _mjs_notify() {
    for (const [owner, fn] of this._mjs_invalidators) {
      if (owner && owner._mjs_dead) {
        this._mjs_invalidators.delete(owner);
        continue;
      }
      fn();
    }
  }

  // une image (le temps réel n'intervient pas) ; true tant que le ressort bouge
  _mjs_step() {
    const run  = { moved: false, reshaped: false };
    const p    = { k: this._mjs_stiffness, a: this._mjs_damping, eps: this.precision };
    const next = advance(this.current, this.velocity, this.target, p, run);
    if (run.reshaped) warnSpring(µ._mjs_txt('springNestedShape', null, 'une valeur imbriquée change de forme (objet/tableau/nombre) — cette branche saute directement à la nouvelle valeur.'));
    // divergence : on se fige sur la cible
    if (!isDeepFinite(next[0]) || !isDeepFinite(next[1])) {
      this.current  = this.target;
      this.velocity = zerosLike(this.target);
      this._mjs_notify();
      return false;
    }
    this.current  = next[0];
    this.velocity = next[1];
    if (typeof this.current === 'number') {
      if (this.min !== null && this.current < this.min) {
        this.current  = this.min;
        this.velocity = 0;
      }
      if (this.max !== null && this.current > this.max) {
        this.current  = this.max;
        this.velocity = 0;
      }
    }
    // repos : current vaut déjà la cible, clés figées comprises, donc pas de recopie
    if (!run.moved) this.velocity = zerosLike(this.current);
    this._mjs_notify();
    return run.moved;
  }
}

µ.spring = function(value, stiffness, damping, min, max) {
  return new Spring(value, stiffness, damping, min, max);
};
