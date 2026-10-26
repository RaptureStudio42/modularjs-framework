// mjs_fx_guard — `*guard` : un champ qui refuse une valeur hors de sa règle fait « non » de la tête,
// et dit ce qui est permis. La règle : celle de la variable que le champ écrit (`<input
// value=!{$age} *guard>`, `$age int 18..120` dans le <vars> — le compilateur passe son nom,
// `_bind`), sinon les contraintes du champ lui-même (min, max, minlength, maxlength, pattern,
// required, type=email…). Pendant la frappe, une valeur hors de la règle ne part pas dans la
// variable : le champ garde ce qu'on tape, la variable sa dernière bonne valeur (sans lui, « 1 » tapé
// en route vers « 120 » était réécrit « 18 » sous les doigts). Une pause dans la frappe (`delay`) sur
// une valeur hors de la règle : le champ joue l'effet du refus et une bulle dit ce qui est permis, sans
// toucher à ce qui est tapé (on peut s'arrêter au milieu). À la sortie du champ, ou sur Entrée, une
// valeur hors de sa plage y est ramenée, une autre refusée rend la dernière bonne, avec l'effet et la
// bulle.
// Réglages : text (la bulle ; ce que la règle permet, écrit en clair), fx (l'effet du refus ; *shake
// — none : aucun), color (la bulle et le liseré du champ ; #dc2626), duration (le temps de la bulle ;
// 2s), place (bottom, top, right : sous le champ, au-dessus, à sa droite ; bottom), delay (la pause
// après la dernière frappe ; celle de la config — `"effects": { "guard": { "delay": "1s" } }` —, sinon
// 1s ; 0 : dès la frappe), silent (ni effet ni bulle : la valeur est seulement ramenée à la sortie —
// le garde d'office sous `"effects": { "guard": false }`).

// les propriétés qui déplacent un champ sans changer sa place de mise en page
var _MJS_FX_GUARD_MOVES = ['transform', 'translate', 'rotate', 'scale'];

// sous un `zoom`, certains navigateurs rendent la translation de la matrice de `transform` en pixels de l'écran (zoom
// appliqué), d'autres en pixels du repère : sondé une fois, sur un nœud posé le temps d'une lecture
var _mjsFxGuardZoomedMatrix = null;

function _mjsFxGuardMatrixZoomed() {
  if (_mjsFxGuardZoomedMatrix === null) {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;zoom:2;transform:translateX(10px);transform-origin:0 0';
    document.documentElement.appendChild(p);
    try { _mjsFxGuardZoomedMatrix = new DOMMatrix(getComputedStyle(p).transform).e === p.getBoundingClientRect().left; }
    catch { _mjsFxGuardZoomedMatrix = false; }
    p.remove();
  }
  return _mjsFxGuardZoomedMatrix;
}

// la matrice ne rend sûrement que le cas simple : un `transform-box` par défaut (view-box ; border-box pour un élément
// de mise en page), et aucun ancêtre (ombre comprise) qui se transforme ou pose une perspective
function _mjsFxGuardSure(el, cs) {
  var box = cs.getPropertyValue('transform-box');
  if (box && box !== 'view-box' && box !== 'border-box') return false;
  var a = el.parentNode || el.host;
  while (a) {
    if (a.nodeType === 1) {
      var as = getComputedStyle(a);
      if (as.getPropertyValue('perspective') !== 'none') return false;
      for (var i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) if (as.getPropertyValue(_MJS_FX_GUARD_MOVES[i]) !== 'none') return false;
    }
    a = a.parentNode || a.host;
  }
  return true;
}

µ._mjs_fxDefs.guard = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  css: '[mjs-fx-guard-no]{outline:2px solid var(--mjs-guard-color,#dc2626);outline-offset:1px}'
    + '[mjs-fx-guard-tip]{position:absolute;z-index:10;max-width:280px;padding:4px 9px;border-radius:6px;background:var(--mjs-guard-color,#dc2626);color:#fff;font:600 12px/1.35 system-ui,sans-serif;white-space:normal;pointer-events:none;animation:mjs-fx-guard-in .18s ease-out}'
    + '@keyframes mjs-fx-guard-in{from{opacity:0;transform:translateY(-3px)}}'
    + '@media (prefers-reduced-motion:reduce){[mjs-fx-guard-tip]{animation:none}}',
  vars: { color: '' },
  setup: function(el, s, comp) {
    var b    = s._bind;
    // la règle de la variable liée, relue à chaque contrôle : celle d'un store arrive avec le
    // composant qui la pose, parfois après ce champ
    var ruleOf = function() {
      if (typeof b !== 'string') return null;
      return (b.slice(0, 2) === '$$' ? µ._mjs_storeRules && µ._mjs_storeRules[b.slice(2)] : comp && comp._mjs_types && comp._mjs_types[b.slice(1)]) || null;
    };
    var good  = null;
    var tip   = null;
    var wait  = null;
    var shook = null;
    var idle  = null;
    var moved = null;
    // la pause après la dernière frappe : la sienne, celle de la config, sinon une seconde
    var conf  = µ._fxConf && µ._fxConf.guard;
    var pause = µ._mjs_fxMs(s.delay, conf && typeof conf === 'object' ? µ._mjs_fxMs(conf.delay, 1000) : 1000);
    var raw  = function() { return el.type === 'checkbox' ? el.checked : el.value; };
    // la dernière bonne valeur, gardée et rendue : l'état coché d'une case à cocher, pas sa valeur
    var keep = function() { good = raw(); };
    var back = function() {
      if (el.type === 'checkbox') el.checked = good;
      else el.value = good;
    };
    // la valeur que la liaison écrirait : un nombre pour un champ nombre
    var typed = function(v) { return /^(number|range)$/.test(el.type) && v !== '' ? Number(v) : v; };
    // { s, v, m } : s — 0 bonne, 2 ramenée (v : la borne), -1 refusée ; m — ce qui est permis, lu
    // AVANT la correction (un champ corrigé n'a plus de message)
    var check = function() {
      var v    = raw();
      var rule = ruleOf();
      if (rule && typeof µ._mjs_tcheck === 'function') {
        var x = µ._mjs_tcheck(rule, typed(v));
        return { s: x.s === 1 ? 0 : x.s, v: x.v, m: x.s < 0 || x.s === 2 ? said(rule) : '' };
      }
      if (typeof el.checkValidity !== 'function' || el.checkValidity()) return { s: 0 };
      var m = el.validationMessage || L('invalid');
      var n = parseFloat(v);
      if (/^(number|range)$/.test(el.type) && isFinite(n)) {
        if (el.min !== '' && n < +el.min) return { s: 2, v: +el.min, m: m };
        if (el.max !== '' && n > +el.max) return { s: 2, v: +el.max, m: m };
      }
      return { s: -1, m: m };
    };
    // ce que la règle permet, en clair (fr, en ; surcharge du projet : clés i18n `mjs.fx.*`)
    var L = µ._mjs_fxLabel;
    var put = function(txt, o) { return String(txt).replace(/\{(\w+)\}/g, function(_, k) { return o[k]; }); };
    var said = function(r) {
      var out = '';
      if ((r.t === 'i' || r.t === 'f') && (r.a !== void 0 || r.b !== void 0)) out = put(L(r.a !== void 0 && r.b !== void 0 ? 'range' : r.a !== void 0 ? 'atLeast' : 'atMost'), r);
      else if (r.t === 's' && (r.a !== void 0 || r.b !== void 0)) out = put(L(r.a !== void 0 && r.b !== void 0 ? 'chars' : r.a !== void 0 ? 'charsMin' : 'charsMax'), r);
      else if (r.t === 'l') out = r.v.slice(0, -1).map(String).join(', ') + (r.v.length > 1 ? ' ' + L('or') + ' ' : '') + String(r.v[r.v.length - 1]);
      else out = r.d || L('invalid');
      if (Array.isArray(r.n) && r.n.length > 0) out += ' — ' + L('except') + ' ' + r.n.map(function(x) { return x !== null && typeof x === 'object' ? put(L('range'), x) : String(x); }).join(', ');
      return out;
    };
    var hide = function() {
      clearTimeout(wait);
      if (moved) moved.disconnect();
      moved = null;
      if (tip) tip.remove();
      tip = null;
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-guard-no');
    };
    // la boîte du champ AU REPOS, en pixels de son repère, sans jamais écrire dans son style ni ses attributs (une transition
    // ou une animation de l'auteur en cours serait annulée, son observateur de mutations en verrait la trace) : sa boîte à
    // l'écran, ramenée avant ses transformations (translate, rotate, scale, transform, autour de transform-origin)
    // par la matrice qu'elles composent ; `cs` : ses styles calculés, `r` : sa boîte à l'écran, `z` : la taille d'un pixel de
    // son repère à l'écran. Rend { x, y, w, h } : l'angle haut gauche à l'écran (en pixels de l'écran) et la taille (en pixels
    // du repère) ; sans transformation, la boîte lue telle quelle
    //
    // limite : quand la matrice ne suffit pas (3D, `perspective()` ou `perspective` sur un ancêtre, `transform-box` autre que celui
    // par défaut, ancêtre transformé), le champ est mesuré avec ses transformations neutralisées le temps d'une lecture : une
    // transition ou une animation de l'auteur sur ces propriétés y est interrompue. `offset-path` n'est pas rendu
    var neutral = function(z) {
      var keep = [];
      var i;
      for (i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) keep.push([el.style.getPropertyValue(_MJS_FX_GUARD_MOVES[i]), el.style.getPropertyPriority(_MJS_FX_GUARD_MOVES[i])]);
      for (i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) el.style.setProperty(_MJS_FX_GUARD_MOVES[i], 'none', 'important');
      var n = µ._mjs_dom.getBoundingClientRect(el);
      for (i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) {
        if (keep[i][0] === '') el.style.removeProperty(_MJS_FX_GUARD_MOVES[i]);
        else el.style.setProperty(_MJS_FX_GUARD_MOVES[i], keep[i][0], keep[i][1]);
      }
      return { x: n.left, y: n.top, w: n.width / z, h: n.height / z };
    };
    var rest = function(cs, r, z) {
      var plain = { x: r.left, y: r.top, w: r.width / z, h: r.height / z };
      var moved = false;
      for (var i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) if (cs.getPropertyValue(_MJS_FX_GUARD_MOVES[i]) !== 'none') moved = true;
      if (!moved) return plain;
      if (typeof DOMMatrix !== 'function' || !_mjsFxGuardSure(el, cs)) return neutral(z);
      var w = parseFloat(cs.width);
      var h = parseFloat(cs.height);
      if (isNaN(w) || isNaN(h)) return neutral(z);
      if (cs.boxSizing !== 'border-box') {
        w += parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
        h += parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      }
      try {
        // l'ordre de composition du navigateur : translate, rotate, scale, puis transform
        var list = '';
        var tr = cs.getPropertyValue('translate');
        if (tr !== 'none') {
          var tv = tr.split(/\s+/).map(function(t, k) { return t.slice(-1) === '%' ? parseFloat(t) * (k === 0 ? w : h) / 100 : parseFloat(t); });
          if (tv.length > 2) return neutral(z);
          list += 'translate(' + tv[0] + 'px,' + (tv[1] || 0) + 'px) ';
        }
        var ro = cs.getPropertyValue('rotate');
        if (ro !== 'none') {
          var rv = ro.split(/\s+/);
          if (rv.length > 1) return neutral(z);
          list += rv.length > 1 ? 'rotate3d(' + rv[0] + ',' + rv[1] + ',' + rv[2] + ',' + rv[3] + ') ' : 'rotate(' + rv[0] + ') ';
        }
        var sc = cs.getPropertyValue('scale');
        if (sc !== 'none') {
          var sv = sc.split(/\s+/);
          if (sv.length > 2) return neutral(z);
          list += 'scale(' + sv[0] + ',' + (sv[1] || sv[0]) + ') ';
        }
        var m  = new DOMMatrix(list);
        var tf = cs.getPropertyValue('transform');
        if (tf !== 'none') {
          var tm = new DOMMatrix(tf);
          if (z !== 1 && _mjsFxGuardMatrixZoomed()) {
            tm.e /= z;
            tm.f /= z;
          }
          m = m.multiply(tm);
        }
        if (!m.is2D) return neutral(z);
        var o  = cs.getPropertyValue('transform-origin').split(/\s+/);
        var ox = parseFloat(o[0]);
        var oy = parseFloat(o[1]);
        var lo = 1 / 0;
        var to = 1 / 0;
        for (var c = 0; c < 4; c++) {
          var p = m.transformPoint(new DOMPoint((c % 2 ? w : 0) - ox, (c > 1 ? h : 0) - oy));
          if (p.x < lo) lo = p.x;
          if (p.y < to) to = p.y;
        }
        return { x: r.left - (ox + lo) * z, y: r.top - (oy + to) * z, w: w, h: h };
      }
      catch { return neutral(z); }
    };
    // la bulle : à côté du champ, dans le même parent ; placée au sous-pixel près dans le repère de son bloc conteneur
    // (sa boîte, bordure retirée, défilement compris ; la page, sans ancêtre positionné), en pixels de ce repère.
    // UNE seule mise en page forcée : toutes les écritures (la bulle à l'origine, sans l'animation d'entrée qui la fait
    // glisser de quelques pixels) avant toutes les lectures (la boîte du champ, celle de la bulle) ; la bulle à l'origine
    // donne l'origine du repère, sa largeur à l'écran contre celle de son style donne la taille d'un pixel (1, sauf sous un `zoom`)
    var lay = function() {
      for (var i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) tip.style.setProperty(_MJS_FX_GUARD_MOVES[i], 'none', 'important');
      tip.style.left = '0px';
      tip.style.top  = '0px';
      var r  = µ._mjs_dom.getBoundingClientRect(el);
      var a  = tip.getBoundingClientRect();
      var ts = getComputedStyle(tip);
      var tw = parseFloat(ts.width);
      if (ts.boxSizing !== 'border-box') tw += parseFloat(ts.paddingLeft) + parseFloat(ts.paddingRight) + parseFloat(ts.borderLeftWidth) + parseFloat(ts.borderRightWidth);
      var z  = a.width / tw || 1;
      var f  = rest(getComputedStyle(el), r, z);
      for (i = 0; i < _MJS_FX_GUARD_MOVES.length; i++) tip.style.removeProperty(_MJS_FX_GUARD_MOVES[i]);
      var x = (f.x - a.left) / z;
      var y = (f.y - a.top) / z;
      var w = f.w;
      var h = f.h;
      if (s.place === 'top') y -= a.height / z + 6;
      else if (s.place === 'right') {
        x += w + 8;
        y += (h - a.height / z) / 2;
      }
      else y += h + 6;
      tip.style.left = Math.round(x * 100) / 100 + 'px';
      tip.style.top  = Math.round(y * 100) / 100 + 'px';
    };
    // le champ bouge dans son parent (une ligne de liste à clé réordonnée) : la liste ne déplace que les nœuds de
    // la ligne, la bulle restait derrière les autres lignes, à l'ancienne place de son champ, sous un autre. Chaque
    // ajout ou retrait d'enfant du parent la ramène juste après son champ et la replace. D'autres frères d'effet
    // (la boîte de *reflect) peuvent s'être glissés entre les deux : ils comptent pour rien, deux effets sur la
    // même balise ne se disputent jamais la place
    var follow = function() {
      if (!tip || !el.parentNode) return;
      var n = el.nextSibling;
      while (n && n !== tip && n.nodeType === 1 && (µ._mjs_dom.hasAttribute(n, 'mjs-fx-layer') || µ._mjs_dom.hasAttribute(n, 'mjs-fx-guard-tip'))) n = n.nextSibling;
      if (n !== tip) µ._mjs_dom.insertBefore(el.parentNode, tip, el.nextSibling);
      lay();
    };
    var show = function(msg) {
      hide();
      tip = document.createElement('span');
      tip.setAttribute('mjs-fx-guard-tip', '');
      tip.setAttribute('role', 'status');
      tip.textContent = typeof s.text === 'string' && s.text !== '' ? s.text : msg;
      µ._mjs_dom.insertBefore(el.parentNode, tip, el.nextSibling);
      lay();
      µ._mjs_dom.setAttribute(el, 'mjs-fx-guard-no', '');
      if (typeof MutationObserver === 'function') {
        moved = new MutationObserver(follow);
        moved.observe(el.parentNode, { childList: true });
      }
      wait = setTimeout(hide, µ._mjs_fxMs(s.duration, 2000));
    };
    // l'effet du refus, rejoué à chaque fois
    var play = function() {
      if (shook) shook();
      shook = null;
      var fx = s.fx;
      if (fx === 'none' || !fx || typeof fx !== 'object' || !µ._mjs_fxDefs[fx.fx]) return;
      shook = µ._mjs_fxOnce(comp, el, fx);
    };
    var refuse = function(x, fix) {
      if (fix) {
        if (x.s === 2) {
          // ramenée : la borne dans le champ, et dans la variable (la liaison l'écrit)
          el.value = String(x.v);
          µ._mjs_dom.dispatchEvent(el, new Event('input', { bubbles: true, composed: true }));
        }
        else if (good !== null) back();
      }
      if (s.silent === true) return;
      // la bulle se place sur le champ au repos, avant qu'il ne tremble
      show(x.m);
      play();
    };
    // une frappe, un contrôle : le routeur (qui retient la frappe) et l'écouteur du champ (qui la
    // juge) lisent celui de l'événement en cours
    var seen = null;
    var once = function(e) {
      if (!seen || seen.e !== e) seen = { e: e, x: check() };
      return seen.x;
    };
    // hors de la règle, la frappe ne part pas dans la variable : l'événement est retenu avant les
    // liaisons du composant (qui l'écoutent sur sa racine, avant le champ)
    el._mjs_hold = function(e) { return e.type === 'input' && once(e).s !== 0; };
    // hors de la règle : prévenu après la pause, jamais corrigé pendant la frappe (on s'arrête parfois
    // au milieu d'un nombre) — la correction attend la sortie du champ
    var onInput = function(e) {
      clearTimeout(idle);
      var x = once(e);
      if (x.s === 0) {
        keep();
        hide();
        return;
      }
      if (s.silent === true) return;
      if (pause <= 0) refuse(x, false);
      else {
        idle = setTimeout(function() {
          var y = check();
          if (y.s !== 0) refuse(y, false);
        }, pause);
      }
    };
    var onChange = function() {
      clearTimeout(idle);
      var x = check();
      if (x.s !== 0) refuse(x, true);
    };
    var onKey = function(e) { if (e.key === 'Enter') onChange(); };
    // la dernière bonne valeur : celle du champ une fois rendu (la liaison l'écrit avant ou après la pose)
    var first = setTimeout(function() { if (good === null && check().s === 0) keep(); }, 0);
    µ._mjs_dom.addEventListener(el, 'input', onInput);
    µ._mjs_dom.addEventListener(el, 'change', onChange);
    µ._mjs_dom.addEventListener(el, 'keydown', onKey);
    return function() {
      el._mjs_hold = null;
      clearTimeout(first);
      clearTimeout(idle);
      µ._mjs_dom.removeEventListener(el, 'input', onInput);
      µ._mjs_dom.removeEventListener(el, 'change', onChange);
      µ._mjs_dom.removeEventListener(el, 'keydown', onKey);
      if (shook) shook();
      hide();
    };
  }
};
