// mjs_fx — le moteur des effets `*nom(réglages)`. Poser un effet sur un élément :
//   - la marque `mjs-fx="nom …"` (attribut-liste, un jeton par effet) ;
//   - les réglages visuels en variables CSS `--mjs-<effet>-<réglage>`, posées sur l'élément : elles
//     l'emportent sur les variables de thème du même nom (`$$neon-color` → `--mjs-neon-color`) ;
//   - la feuille de l'effet, adoptée UNE fois par racine (shadow root du composant qui porte la
//     balise, sinon la racine du document) ;
//   - le comportement éventuel (souris, défilement, minuteries), qui rend sa propre fonction d'arrêt.
// Le retrait défait tout, dans l'ordre inverse ; il est inscrit dans `_mjs_attachments` du
// composant (destruction du composant) et dans `el._mjs_fxOff` (nœud retiré par un bloc
// {if}/{for}, cf. mjs_destroy_hooks.ts).
// Un réglage tenu par une variable (`*neon($couleur)`) arrive avec sa règle : ramené dans sa plage
// ou écarté (valeur par défaut), avec un message en développement ; à chaque changement,
// `µ._mjs_fxSet` met à jour la variable CSS sur place, ou relance l'effet pour un réglage de
// comportement (souris, minuterie).
//
// Chaque effet vit dans son fichier (mjs_fx_<nom>.ts) et s'inscrit dans µ._mjs_fxDefs :
//   css   : sa feuille (sélecteurs `[mjs-fx~="nom"]`, animations préfixées `mjs-fx-`)
//   vars  : réglage → unité, pour les réglages qui deviennent des variables CSS
//   setup : function(el, réglages) → fonction d'arrêt (facultatif) ; son `set(k, v)` suit un réglage
//           tenu par une variable sans reposer l'effet (rend false : il ne sait pas, l'effet repart) —
//           appelé aussi pour un réglage de `vars`, que l'effet recopierait dans son code : sa variable
//           CSS suit de toute façon, son retour est alors ignoré (rendre false n'y relance rien)
// Le build n'embarque que les effets écrits dans les gabarits (bundler/features.ts). En construction
// découpée, chacun a son propre fichier (`mjs_fx_<nom>`, publié dans µ.paths), importé par les
// composants qui l'écrivent : il arrive avec eux. Un effet que la page n'a pas encore (nommé pendant
// l'exécution : `fx: $effet`) est importé ici, une fois, en arrière-plan, et se pose à son arrivée.

µ._mjs_fxDefs = µ._mjs_fxDefs || {};

// `closest`/`animate` de la balise, insensibles à une méthode du composant du même nom (cf.
// mjs_element.ts) ; les effets s'en servent aussi
µ._mjs_closest = µ._mjs_closest || function(n, sel) {
  if (typeof Element === 'function' && n instanceof Element) return Element.prototype.closest.call(n, sel);
  return n && typeof n.closest === 'function' ? n.closest(sel) : null;
};
µ._mjs_animate = µ._mjs_animate || function(n, frames, opts) {
  if (typeof Element === 'function' && n instanceof Element && typeof Element.prototype.animate === 'function') return Element.prototype.animate.call(n, frames, opts);
  return n.animate(frames, opts);
};

// les autres méthodes de nœud dont les effets se servent (µ._mjs_dom.setAttribute(el, k, v) au lieu de el.setAttribute(k, v)),
// prises au prototype : un composant qui écrit `@focus`, `@contains` ou
// `@getBoundingClientRect` masque celle de sa balise, et l'effet appelait alors le code de l'auteur. Un
// objet qui n'est pas un élément (fenêtre, document, racine d'ombre, banc de test) garde ses méthodes
var _mjsFxHtmlOnly = { focus: 1, blur: 1, click: 1 };
var _mjsFxNative = function(n, name) {
  if (typeof Element !== 'function' || !(n instanceof Element)) return null;
  if (_mjsFxHtmlOnly[name]) return typeof HTMLElement === 'function' && n instanceof HTMLElement ? HTMLElement.prototype[name] : null;
  return Element.prototype[name];
};
µ._mjs_dom = µ._mjs_dom || {};
['contains', 'focus', 'blur', 'click', 'getBoundingClientRect', 'getClientRects', 'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute',
 'addEventListener', 'removeEventListener', 'dispatchEvent', 'closest', 'matches', 'querySelector', 'querySelectorAll', 'animate', 'getAnimations',
 'remove', 'replaceWith', 'after', 'appendChild', 'insertBefore', 'cloneNode', 'scrollIntoView', 'setPointerCapture', 'releasePointerCapture', 'getRootNode'].forEach(function(name) {
  µ._mjs_dom[name] = µ._mjs_dom[name] || function(n, a, b, c) {
    var f = _mjsFxNative(n, name) || n[name];
    var k = arguments.length;
    // les arguments donnés, ni plus ni moins : `after`, `append` ou `replaceWith` font un nœud texte de chaque `undefined` en trop
    return k < 2 ? f.call(n) : k < 3 ? f.call(n, a) : k < 4 ? f.call(n, a, b) : f.call(n, a, b, c);
  };
});

// ----- le code des effets, à la demande -----
var _mjsFxLoads = {};

// l'import d'un fichier d'effet (remplacé par les tests, qui n'ont pas de chargeur de modules)
µ._mjs_fxImport = function(url) {
  return import(url);
};

// le fichier d'une clé `mjs_fx_<nom>` : importé une seule fois ; sa promesse, ou null s'il n'y en a pas
function _mjsFxLoad(key) {
  var p = µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, key) ? µ.pathOf(key) : null;
  if (!p) return null;
  var w = _mjsFxLoads[key];
  if (!w) {
    w = _mjsFxLoads[key] = µ._mjs_fxImport(p);
    w.then(null, function(e) {
      delete _mjsFxLoads[key];
      µ.error(µ._mjs_msg('fxLoad', { name: key.slice(7) }, 'effet « {name} » : son fichier ne s\'est pas chargé —'), e);
    });
  }
  return w;
}

// l'effet `name` : là (true), en route (sa promesse), ou introuvable (null) ; une définition propre à la table, jamais un nom
// hérité d'Object (`constructor`)
µ._mjs_fxNeed = function(name) {
  return Object.prototype.hasOwnProperty.call(µ._mjs_fxDefs, name) ? true : _mjsFxLoad('mjs_fx_' + name.replace(/-/g, '_'));
};

// un composant qui va être chargé (Autoloader) : ses effets partent en même temps que lui, sans
// attendre qu'il arrive pour les découvrir (µ.deps, publié par le manifeste)
µ._mjs_fxPrefetch = function(name) {
  var deps = µ.deps && µ.deps[name];
  if (!deps) return;
  for (var i = 0; i < deps.length; i++) {
    if (deps[i].slice(0, 7) === 'mjs_fx_') _mjsFxLoad(deps[i]);
  }
};

// ----- un effet en attente : son fichier n'est pas arrivé, ou le composant qui porte sa balise n'est
// pas encore défini -----
// Une attente par balise et par effet (`el._mjs_fxWait[nom]`), accrochée une seule fois. Les appels qui
// la demandent y sont rangés, un par composant, le plus récent en dernier : le bloc qui porte la balise
// repasse (même composant : ses valeurs sont mises à jour, µ._mjs_fxSet les tient à jour aussi) ; deux
// composants posent le même effet sur <@document>. À l'arrivée, l'effet est posé avec les valeurs du
// plus récent appel encore là, et chacun des autres le tient aussi : l'effet reste tant qu'un des
// composants est affiché. Un appel annulé avant l'arrivée sort de la liste ; la liste vide, rien n'est
// posé. La poignée rendue annule l'appel, ou le retire une fois l'effet posé. L'attente ne retient ni la
// balise ni ses composants (le rappel n'a qu'une référence faible vers elle) : un composant qui
// n'arrive jamais ne les garde pas en vie. Une erreur au setup de l'effet posé à l'arrivée sort par
// µ.error, comme les autres erreurs de pose

// une référence faible quand l'environnement en a, forte sinon
function _mjsFxWeak(o) {
  return typeof WeakRef === 'function' ? new WeakRef(o) : { deref: function() { return o; } };
}

// la poignée d'un appel en attente
function _mjsFxHand(g, rec) {
  return function() {
    if (rec.gone) return;
    rec.gone = true;
    var i = g.calls.indexOf(rec);
    if (i >= 0) g.calls.splice(i, 1);
    var off = rec.off;
    rec.off = rec.comp = rec.s = rec.d = rec.sp = null;
    if (off) off();
    if (g.calls.length === 0) _mjsFxEnd(g);
  };
}

// l'attente est finie, ou plus personne n'attend : elle quitte la balise, son rappel ne trouvera rien
function _mjsFxEnd(g) {
  g.step = null;
  var waits = g.el._mjs_fxWait;
  if (waits && waits[g.name] === g) delete waits[g.name];
}

// l'attente est abandonnée : ses appels n'ont plus rien à poser, et ne retiennent plus rien
function _mjsFxDrop(g) {
  var calls = g.calls.splice(0);
  for (var i = 0; i < calls.length; i++) {
    var rec = calls[i];
    rec.gone = true;
    rec.off = rec.comp = rec.s = rec.d = rec.sp = null;
  }
  _mjsFxEnd(g);
}

// l'appel (comp, s, d, sp) entre dans l'attente de `name` sur `el` ; `step` : ce qu'elle attend (`file`,
// `host`, `park`), `hook(g)` l'accroche quand c'est une attente nouvelle ; rend la poignée de l'appel
function _mjsFxWait(comp, el, name, s, d, sp, step, hook) {
  var waits = el._mjs_fxWait || (el._mjs_fxWait = {});
  var g     = waits[name] || (waits[name] = { el: el, name: name, calls: [], step: null });
  var rec   = null;
  for (var i = 0; i < g.calls.length; i++) {
    if (g.calls[i].comp === comp) {
      rec = g.calls.splice(i, 1)[0];
      break;
    }
  }
  var vals = d ? Object.assign({}, d) : d;
  if (rec) {
    rec.s  = s;
    rec.d  = vals;
    rec.sp = sp;
  }
  else {
    rec      = { comp: comp, s: s, d: vals, sp: sp, off: null, gone: false, hand: null };
    rec.hand = _mjsFxHand(g, rec);
  }
  g.calls.push(rec);
  if (g.step !== step) {
    g.step = step;
    hook(g);
  }
  return rec.hand;
}

// le rappel de l'attente : une référence faible vers elle, rien d'autre
function _mjsFxOnArrival(promise, g, step) {
  var ref = _mjsFxWeak(g);
  promise.then(function() {
    _mjsFxArrived(ref.deref(), step);
  }, function() {
    var g2 = ref.deref();
    if (g2 && g2.step === step) g2.step = null;
  });
}

// la balise est détachée pour de bon : le haut de ce qui s'est détaché avec elle est marqué mort ou mourant
// (`_mjs_dead`, `_mjs_dying`) — par un bloc ({if}, {for}…) qui l'a retirée, ou parce que c'est un composant
// que `disconnectedCallback` marque mort dès qu'il quitte le document, une page mise de côté par le cache de
// pages comprise : son effet n'est alors pas repris à sa reconnexion, c'est le rendu du composant qui le
// repose. Seule une racine qui n'est pas un composant (une `<section>` mise de côté) est reprise par
// `_mjsFxPark`
function _mjsFxGone(el) {
  var r = el;
  for (var p = r.parentNode || r.host; p; p = r.parentNode || r.host) r = p;
  return !!(r._mjs_dead || r._mjs_dying);
}

// ce que l'attente attendait est là
function _mjsFxArrived(g, step) {
  if (!g || g.step !== step) return;
  g.step = null;
  var el    = g.el;
  var name  = g.name;
  var calls = g.calls.slice();
  if (calls.length === 0) {
    _mjsFxEnd(g);
    return;
  }
  if (!el.isConnected) {
    // une balise hors du document quand son composant arrive, mise de côté (cache de pages) : l'attente
    // reprend à sa reconnexion ; retirée par un bloc, ou sans observateur pour la voir revenir, rien
    if (step === 'host' && !_mjsFxGone(el) && _mjsFxPark(g)) return;
    _mjsFxDrop(g);
    return;
  }
  // sans shadow root à l'arrivée (mise à niveau en échec), ou sans le code de l'effet, rien n'est posé
  if ((step === 'host' && !el._shadow) || (step === 'file' && !µ._mjs_fxDefs[name])) {
    _mjsFxDrop(g);
    return;
  }
  var last = calls[calls.length - 1];
  var hand = null;
  try {
    hand = µ._mjs_fx(last.comp, el, name, last.s, last.d, last.sp);
  }
  catch (e) {
    µ.error(µ._mjs_msg('fxApply', { name: name }, 'effet « {name} » : sa pose a échoué —'), e);
    _mjsFxDrop(g);
    return;
  }
  // l'effet attend autre chose (son code est là, pas son composant) : la même attente continue
  if (g.step !== null) return;
  g.calls.length = 0;
  _mjsFxEnd(g);
  var o = el._mjs_fxOff && el._mjs_fxOff[name];
  if (!o) return;
  for (var i = 0; i < calls.length; i++) {
    if (!calls[i].gone) calls[i].off = calls[i] === last ? hand : o._own(calls[i].comp);
  }
}

// ----- une balise hors du document quand son composant arrive : l'attente est mise de côté, un
// observateur du document la reprend à la reconnexion (il n'existe que tant qu'une balise est ainsi
// attendue ; les attentes y sont tenues par des références faibles) -----
var _mjsFxParked  = [];
var _mjsFxParkObs = null;

// rend false sans observateur : l'attente est alors abandonnée
function _mjsFxPark(g) {
  if (typeof MutationObserver !== 'function') return false;
  g.step = 'park';
  _mjsFxParked.push(_mjsFxWeak(g));
  if (!_mjsFxParkObs) {
    _mjsFxParkObs = new MutationObserver(_mjsFxUnpark);
    _mjsFxParkObs.observe(document, { childList: true, subtree: true });
  }
  return true;
}

function _mjsFxUnpark() {
  var wait = [];
  var back = [];
  for (var i = 0; i < _mjsFxParked.length; i++) {
    var g = _mjsFxParked[i].deref();
    if (!g || g.step !== 'park') continue;
    if (g.el.isConnected) back.push(g);
    else if (_mjsFxGone(g.el)) _mjsFxDrop(g);
    else wait.push(_mjsFxParked[i]);
  }
  _mjsFxParked = wait;
  if (wait.length === 0 && _mjsFxParkObs) {
    _mjsFxParkObs.disconnect();
    _mjsFxParkObs = null;
  }
  for (var j = 0; j < back.length; j++) _mjsFxArrived(back[j], 'park');
}

// un effet dont le code est en route : posé à son arrivée si sa balise est encore là, avec les
// dernières valeurs de ses variables
function _mjsFxLater(comp, el, name, s, d, sp) {
  var w = µ._mjs_fxNeed(name);
  if (!w || w === true) return null;
  return _mjsFxWait(comp, el, name, s, d, sp, 'file', function(g) { _mjsFxOnArrival(w, g, 'file'); });
}

// la balise d'un composant du projet dont le code n'est pas encore arrivé : son nom `mjs-<clé>` est au
// manifeste (µ.paths, ce que l'Autoloader ira chercher), le composant pas encore enregistré. Sans
// manifeste (`µ.paths` absent : un cœur chargé seul, un harnais de test), rien n'arrive à la demande ;
// une balise étrangère (autre bibliothèque, ou `mjs-` absente du manifeste) n'attend rien : elle ne
// sera peut-être jamais définie
function _mjsFxHostPending(el) {
  var n = el.localName || '';
  return n.slice(0, 4) === 'mjs-' && !!µ.paths && Object.prototype.hasOwnProperty.call(µ.paths, n.slice(4)) && !customElements.get(n);
}

// un effet posé sur un composant dont le code arrive : posé à son enregistrement, dans son shadow
// root — posé avant, un calque tombait dans la balise elle-même, sous le shadow root qu'elle prend à
// sa mise à niveau, et ne se voyait jamais. Même attente qu'un effet dont le fichier arrive
// (_mjsFxLater) : ses variables suivies en attendant (µ._mjs_fxSet), rien si la balise a été retirée
// ou si l'effet a été retiré ; une balise hors du document à l'arrivée, mise de côté par le cache de
// pages, reçoit son effet à sa reconnexion. L'enregistrement met à niveau les balises de la page
// (constructeur : le shadow root, cf. mjs_element.ts) avant que `whenDefined` ne passe : sans shadow
// root à l'arrivée (mise à niveau en échec), rien n'est posé
function _mjsFxHostLater(comp, el, name, s, d, sp) {
  return _mjsFxWait(comp, el, name, s, d, sp, 'host', function(g) { _mjsFxOnArrival(customElements.whenDefined(el.localName), g, 'host'); });
}

var _mjsFxSheets = {};
var _mjsFxRoots  = new WeakMap();

// la racine où vit l'élément : le shadow root du composant qui le porte, sinon la racine
// (document ou shadow root) où vit le composant lui-même
function _mjsFxRoot(comp) {
  var sh = comp && comp._shadow;
  if (sh && sh.nodeType === 11) return sh;
  var r = comp && comp.getRootNode ? µ._mjs_dom.getRootNode(comp) : null;
  return r && (r.nodeType === 11 || r.nodeType === 9) ? r : document;
}

// pour le calque de texte (mjs_fx_tooltext.ts)
µ._mjs_fxRoot = _mjsFxRoot;

function _mjsFxAdopt(root, name, css) {
  var done = _mjsFxRoots.get(root);
  if (!done) {
    done = {};
    _mjsFxRoots.set(root, done);
  }
  if (done[name]) return;
  done[name] = true;
  var sheet = _mjsFxSheets[name];
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sheet._mjs_keep    = true;
    _mjsFxSheets[name] = sheet;
  }
  root.adoptedStyleSheets = root.adoptedStyleSheets.concat([sheet]);
}

// la feuille d'un effet dans une racine de plus (un composant où l'effet dessine)
µ._mjs_fxAdopt = function(root, name) {
  var def = µ._mjs_fxDefs[name];
  if (def && def.css && root) _mjsFxAdopt(root, name, def.css);
};

// l'intérieur d'un composant (son shadow root), là où un effet dessine quand la balise en porte un
µ._mjs_fxInner = function(el) {
  var sh = el._shadow;
  if (sh && sh.nodeType === 11) return sh;
  return el.shadowRoot || null;
};

// une balise dont le texte n'est pas le sien : composant, image, champ, média…
µ._mjs_fxBoxy = function(el) {
  var n = el.localName || '';
  return n.indexOf('-') > 0 || /^(img|input|textarea|select|video|audio|canvas|iframe|svg|object|embed|picture|math)$/.test(n);
};

// ajoute ou retire le jeton d'un effet dans un attribut-liste (`mjs-fx`, `mjs-fx-on`,
// `mjs-fx-play`) : plusieurs effets sur la même balise ne se marchent pas dessus
function _mjsFxTokenOf(el, attr, name, add) {
  var list = (µ._mjs_dom.getAttribute(el, attr) || '').split(' ').filter(function(x) { return x !== '' && x !== name; });
  if (add) list.push(name);
  if (list.length > 0) µ._mjs_dom.setAttribute(el, attr, list.join(' '));
  else µ._mjs_dom.removeAttribute(el, attr);
}

// durée CSS (`300ms`, `1.5s`, `0`) → millisecondes ; absente → valeur par défaut
µ._mjs_fxMs = function(v, dflt) {
  if (v === void 0 || v === null || v === '') return dflt;
  var s = String(v);
  var n = parseFloat(s);
  if (!isFinite(n)) return dflt;
  return /ms$/.test(s) ? n : /s$/.test(s) ? n * 1000 : n;
};

// un calque ou un pseudo-élément absolu a besoin d'un parent positionné : `relative` posé
// seulement sur un élément `static`, rendu tel quel au retrait
µ._mjs_fxRelative = function(el) {
  // plusieurs effets sur la même balise : le dernier retiré rend la position d'origine
  if (el._mjs_fxRel) {
    el._mjs_fxRel.n++;
    return el._mjs_fxRel.off;
  }
  var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  if (!cs || cs.position !== 'static') return function() {};
  var before = el.style.position;
  el.style.position = 'relative';
  var rel = el._mjs_fxRel = { n: 1, off: function() {
    if (--rel.n > 0) return;
    el.style.position = before;
    el._mjs_fxRel = null;
  } };
  return rel.off;
};

// une balise en ligne (`<span>`, `<a>`) ne se transforme pas : `inline-block` le temps de l'effet ;
// plusieurs effets sur la même balise : le dernier retiré rend l'affichage d'origine
µ._mjs_fxMovable = function(el) {
  if (el._mjs_fxMov) {
    el._mjs_fxMov.n++;
    return el._mjs_fxMov.off;
  }
  var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  if (!cs || cs.display !== 'inline') return function() {};
  var before = el.style.display;
  el.style.display = 'inline-block';
  var mv = el._mjs_fxMov = { n: 1, off: function() {
    if (--mv.n > 0) return;
    el.style.display = before;
    el._mjs_fxMov = null;
  } };
  return mv.off;
};

// la transition d'une balise qu'un effet prolonge : celle de l'auteur (ou d'un effet qui ne passe pas
// par ici), relevée à la première pose — aucune règle d'effet ne la tient encore —, puis celle de
// chaque effet posé (`items`), écrites dans `--mjs-fx-tr` sous la marque `mjs-fx-tr`, que la feuille
// de l'effet donne à `transition`. Plusieurs effets sur la même balise : leurs transitions s'ajoutent,
// le dernier retiré rend la balise telle quelle. Appelée là où la règle qu'elle remplace aurait été lue
// pour la première fois (la lecture fige l'état de la balise, sans transition)
µ._mjs_fxTransition = function(el, name, items) {
  var t = el._mjs_fxTra;
  if (!t) {
    var cs  = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    var own = '';
    // rien à garder : aucune propriété, ou toutes les durées et tous les délais à 0. Sinon recomposée depuis ses propriétés longues
    // (Firefox rend `transition` vide quand ses listes n'ont pas la même longueur) : chaque liste courte répétée, comme le fait CSS
    if (cs && cs.transitionProperty && cs.transitionProperty !== 'none' && /[1-9]/.test(cs.transitionDuration + cs.transitionDelay)) {
      var l = [cs.transitionProperty, cs.transitionDuration, cs.transitionTimingFunction, cs.transitionDelay, cs.transitionBehavior].map(function(v) { return String(v || '').match(/(?:[^,(]|\([^)]*\))+/g) || ['']; });
      own = l[0].map(function(_, i) { return l.map(function(x) { return x[i % x.length].trim(); }).filter(function(v) { return v && v !== 'normal'; }).join(' '); }).join(',');
    }
    t = el._mjs_fxTra = { own: own, fx: {} };
  }
  var write = function() {
    var all = t.own ? [t.own] : [];
    for (var k in t.fx) all.push(t.fx[k].v);
    if (all.length > (t.own ? 1 : 0)) {
      el.style.setProperty('--mjs-fx-tr', all.join(','));
      µ._mjs_dom.setAttribute(el, 'mjs-fx-tr', '');
      return;
    }
    el.style.removeProperty('--mjs-fx-tr');
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-tr');
    el._mjs_fxTra = null;
  };
  // l'inscription de CETTE pose, reconnue par elle-même au retrait : deux poses écrivent la même valeur (une carte passée d'un
  // groupe *focus à un autre est inscrite par l'arrivée avant d'être rendue par le départ)
  var mine = t.fx[name] = { v: items };
  write();
  return function() {
    if (t.fx[name] !== mine) return;
    delete t.fx[name];
    write();
  };
};

// les composantes d'une valeur calculée (`-50% -50%`, `calc(-50% + 2px) 0px`, `0.8`) ; aucune pour `none`
µ._mjs_fxParts = function(v) {
  return v && v !== 'none' ? String(v).match(/(?:[^\s(]|\([^)]*\))+/g) || [] : [];
};

// valeur d'une variable CSS vue depuis la balise (thème compris), vide si absente
µ._mjs_fxCss = function(el, name) {
  var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return cs ? cs.getPropertyValue(name).trim() : '';
};

// la place du texte dans sa balise. Une copie du texte (calque de lettres, pseudo-élément) posée
// `inset:0` écrit en haut à gauche ; la balise, elle, peut ranger son texte ailleurs : une grille,
// un flex, une case de tableau (vertical-align), un bouton (centré en hauteur). Relue sur la
// balise : `mjs-fx-place-h` (start, center, end ; absent : toute la largeur, text-align fait le
// reste) et `mjs-fx-place-v` (center, end ; absent : en haut) ; la copie prend alors la taille de
// son texte et se range comme lui (cf. µ._mjs_fxPlaceCss)
var _MJS_FX_ALIGN = { center: 'center', 'safe center': 'center', 'unsafe center': 'center', 'space-around': 'center', 'space-evenly': 'center', end: 'end', 'flex-end': 'end', 'self-end': 'end', right: 'end', 'safe end': 'end', 'unsafe end': 'end', 'safe flex-end': 'end', 'unsafe flex-end': 'end' };
// un alignement CSS → start, center, end ; `rev` : un flex inversé (row-reverse), où flex-start
// part de l'autre bord
function _mjsFxAlign(v, rev) {
  var a = _MJS_FX_ALIGN[v] || 'start';
  if (rev && /^(normal|stretch|flex-start|space-between|flex-end|safe flex-end|unsafe flex-end)$/.test(v)) a = a === 'end' ? 'start' : 'end';
  return a;
}

// [horizontal, vertical] : '' = comme un bloc (toute la largeur ; en haut)
µ._mjs_fxPlaceOf = function(el) {
  var cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  if (!cs) return ['', ''];
  var d = cs.display || '';
  var h = '';
  var v = '';
  if (/flex$/.test(d)) {
    var fd    = cs.flexDirection || '';
    var main  = _mjsFxAlign(cs.justifyContent, /reverse$/.test(fd));
    var cross = /^(normal|stretch)$/.test(cs.alignItems || 'normal') ? '' : _mjsFxAlign(cs.alignItems, false);
    if (/^column/.test(fd)) {
      v = main;
      h = cross;
    }
    else {
      h = main;
      v = cross;
    }
  }
  else if (/grid$/.test(d)) {
    // l'alignement des cases (justify-items), sinon celui des pistes (justify-content)
    var pick = function(items, content) {
      var a = /^(normal|stretch|legacy)/.test(items || 'normal') ? '' : _mjsFxAlign(items, false);
      return a || (/^(normal|stretch|start|flex-start|left|space-between)$/.test(content || 'normal') ? '' : _mjsFxAlign(content, false));
    };
    h = pick(cs.justifyItems, cs.justifyContent);
    v = pick(cs.alignItems, cs.alignContent);
  }
  else if (d === 'table-cell') v = cs.verticalAlign === 'middle' ? 'center' : cs.verticalAlign === 'bottom' ? 'end' : '';
  else if (el.localName === 'button') v = 'center';
  return [h, v === 'start' ? '' : v];
};

// la place du texte posée sur la balise (compté : plusieurs effets de texte sur la même balise) ;
// rend { again, off } — `again` la relit (le texte a changé, la balise aussi peut-être)
µ._mjs_fxPlace = function(el) {
  var p = el._mjs_fxPl || (el._mjs_fxPl = { n: 0 });
  p.n++;
  var again = function() {
    var hv = µ._mjs_fxPlaceOf(el);
    if (hv[0]) µ._mjs_dom.setAttribute(el, 'mjs-fx-place-h', hv[0]);
    else µ._mjs_dom.removeAttribute(el, 'mjs-fx-place-h');
    if (hv[1]) µ._mjs_dom.setAttribute(el, 'mjs-fx-place-v', hv[1]);
    else µ._mjs_dom.removeAttribute(el, 'mjs-fx-place-v');
  };
  again();
  var done = false;
  return { again: again, off: function() {
    if (done) return;
    done = true;
    if (--p.n > 0) return;
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-place-h');
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-place-v');
    el._mjs_fxPl = null;
  } };
};

// CSS de la place du texte pour ses copies : `sel(a)` = le sélecteur de la copie, `a` celui de
// l'attribut posé sur la balise. Absolue `inset:0`, la copie prend la taille de son texte
// (fit-content) et des marges auto la rangent : centrée, au début, au bout
µ._mjs_fxPlaceCss = function(sel) {
  var r = function(a, decl) { return sel(a) + '{' + decl + '}'; };
  return r('[mjs-fx-place-h]', 'width:fit-content')
    + r('[mjs-fx-place-h="start"]', 'margin-right:auto')
    + r('[mjs-fx-place-h="center"]', 'margin-left:auto;margin-right:auto')
    + r('[mjs-fx-place-h="end"]', 'margin-left:auto')
    + r('[mjs-fx-place-v]', 'height:fit-content')
    + r('[mjs-fx-place-v="center"]', 'margin-top:auto;margin-bottom:auto')
    + r('[mjs-fx-place-v="end"]', 'margin-top:auto');
};

// le texte propre de la balise, hors calques des effets — aussi ceux d'un effet posé sur une balise du texte
// (`<p *stagger>Prix <b *count>42</b></p>` se lit « Prix 42 », jamais « Prix 4242 ») ; un <br>, même dans une
// balise du texte, s'y lit comme un saut de ligne (`br`, \n par défaut) : sans lui, les mots de part et d'autre se colleraient
function _mjsFxOwnText(el, br) {
  var t = '';
  for (var c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && µ._mjs_dom.hasAttribute(c, 'mjs-fx-layer')) continue;
    t += c.localName === 'br' ? br || '\n' : c.nodeType === 1 && µ._mjs_dom.querySelector(c, 'br,[mjs-fx-layer]') ? _mjsFxOwnText(c, br) : c.textContent;
  }
  return t;
}

// le texte des copies en pseudo-élément (*split, *glitch, *neon) : un <br> y est un \n, que leur
// `white-space-collapse: preserve-breaks` garde ; un \n de la mise en forme du gabarit y devient un espace (replié
// à l'écran : aucune ligne vide en tête d'un titre écrit sur plusieurs lignes), sauf dans une balise qui garde ses
// sauts de ligne (`pre`, `pre-wrap`…)
µ._mjs_fxCopyText = function(el) {
  var t = _mjsFxOwnText(el, '\u2028');
  if (!/^(?:pre|break)/.test(getComputedStyle(el).whiteSpace || '')) t = t.replace(/\n/g, ' ');
  return t.replace(/\u2028/g, '\n');
};

// le texte propre de la balise, suivi : `f(texte)` à chaque changement (pas ceux des calques) ; rend
// la fonction d'arrêt
µ._mjs_fxOnText = function(el, f) {
  if (typeof MutationObserver !== 'function') return function() {};
  var mo = new MutationObserver(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (_mjsFxOwnMutation(el, list[i])) { f(_mjsFxOwnText(el)); return; }
    }
  });
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  return function() { mo.disconnect(); };
};

µ._mjs_fxOwnText = _mjsFxOwnText;

// une mutation qui touche le texte propre de la balise (pas un calque d'effet). Un nœud qui n'est plus
// dans la balise quand la mutation arrive (un bout de calque retiré par une reconstruction, un effet
// posé dessus qui se défait) n'en est pas le texte : sans ce garde, le retrait d'un effet posé dans un
// calque relançait la reconstruction, qui effaçait l'effet suivant
function _mjsFxOwnMutation(el, m) {
  var t = m.target;
  if (t !== el) {
    for (var p = t.nodeType === 1 ? t : t.parentNode; p; p = p.parentNode) {
      if (p === el) return true;
      if (p.nodeType === 1 && µ._mjs_dom.hasAttribute(p, 'mjs-fx-layer')) return false;
    }
    return false;
  }
  var nodes = Array.prototype.slice.call(m.addedNodes).concat(Array.prototype.slice.call(m.removedNodes));
  for (var i = 0; i < nodes.length; i++) {
    if (!(nodes[i].nodeType === 1 && µ._mjs_dom.hasAttribute(nodes[i], 'mjs-fx-layer'))) return true;
  }
  return false;
}

// pour le calque de texte (mjs_fx_tooltext.ts)
µ._mjs_fxOwnMutation = _mjsFxOwnMutation;

// un nombre écrit dans une balise (*count, *delta) : `parse` le lit dans le texte (`12480`, `3.5`,
// `-2 €` ; null si ce n'en est pas un, le nombre de décimales retenu dans `dec`), `fmt` l'écrit avec
// ses séparateurs — réglages separator (des milliers ; une espace, qui devient l'espace fine
// insécable : elle ne coupe jamais le nombre), decimal (une virgule), prefix, suffix ; `curve` : la
// courbe du réglage easing (ease-out)
var _MJS_FX_CURVES = { linear: function(k) { return k; }, 'ease-in': function(k) { return k * k * k; }, 'ease-out': function(k) { return 1 - Math.pow(1 - k, 3); }, 'ease-in-out': function(k) { return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }, ease: function(k) { return 1 - Math.pow(1 - k, 2); } };
µ._mjs_fxNum = function(s) {
  var sep = s.separator === void 0 ? ' ' : s.separator;
  var dot = s.decimal === void 0 ? ',' : s.decimal;
  var num = { dec: 0, curve: _MJS_FX_CURVES[s.easing] || _MJS_FX_CURVES['ease-out'] };
  num.parse = function(txt) {
    // écrit sans séparateur (`12480.5`), il se lit tel quel ; écrit avec la marque des décimales de
    // l'effet (une virgule), il se lit avec ses séparateurs : milliers retirés (une espace : toute
    // espace, fine insécable comprise), décimales en point — « 1 234,5 » vaut 1234.5, pas 12345 ;
    // sans elle, un séparateur entre deux groupes de chiffres (« 12 480 », « 1,234 ») est retiré aussi.
    // Le premier nombre seul compte (« 3/10 » vaut 3) ; le signe moins typographique (−) vaut un tiret
    var t = txt.replace(/[\u2212\ufe63\uff0d]/g, '-');
    if (dot && dot !== '.' && t.indexOf(dot) >= 0) {
      t = sep === ' ' ? t.replace(/\s/g, '') : sep ? t.split(sep).join('') : t;
      t = t.split(dot).join('.');
    }
    else if (sep && sep !== '.') t = t.replace(new RegExp('(\\d)' + (sep === ' ' ? '\\s' : sep.replace(/\W/g, '\\$&')) + '(?=\\d{3}(?!\\d))', 'g'), '$1');
    var c = (/-?(?:\d+\.?\d*|\.\d+)/.exec(t) || [''])[0];
    var m = /\.(\d+)/.exec(c);
    num.dec = m ? m[1].length : 0;
    var n = parseFloat(c);
    return isFinite(n) ? n : null;
  };
  // le signe suit la valeur arrondie : -0,3 s'écrit 0, jamais -0
  num.fmt = function(v) {
    var a   = Math.abs(v).toFixed(num.dec);
    var t   = a.split('.');
    var ent = t[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep === ' ' ? ' ' : sep);
    return (s.prefix || '') + (v < 0 && /[1-9]/.test(a) ? '-' : '') + ent + (t[1] ? dot + t[1] : '') + (s.suffix || '');
  };
  return num;
};

// « réduire les animations » demandé par le système : les effets en JavaScript ne bougent pas
µ._mjs_fxCalm = function() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
};

// le texte en caractères perçus (graphèmes) : un drapeau, une famille d'emojis, un emoji à teinte de
// peau, une lettre et son accent décomposé restent entiers (`Intl.Segmenter`) ; sans lui, par point de
// code — un emoji simple n'est jamais coupé en deux
var _mjsFxSegOf = null;
var _mjsFxSeg   = null;
µ._mjs_fxGraphemes = function(txt) {
  var C = typeof Intl === 'object' && Intl ? Intl.Segmenter : void 0;
  if (typeof C !== 'function') return Array.from(txt);
  if (_mjsFxSegOf !== C) {
    _mjsFxSegOf = C;
    _mjsFxSeg   = new C(void 0, { granularity: 'grapheme' });
  }
  return Array.from(_mjsFxSeg.segment(txt), function(x) { return x.segment; });
};

// la direction d'un mouvement en degrés (0 = vers le haut, 90 = vers la droite, comme un dégradé
// CSS) : un mot, un angle ; `dflt` sinon
var _MJS_FX_DIRS = { up: 0, 'up-right': 45, right: 90, 'down-right': 135, down: 180, 'down-left': 225, left: 270, 'up-left': 315 };
µ._mjs_fxDeg = function(v, dflt) {
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(_MJS_FX_DIRS, v)) return _MJS_FX_DIRS[v];
  var n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? ((n % 360) + 360) % 360 : dflt;
};

// le pas unitaire d'une direction à l'écran (y vers le bas) : up → { x: 0, y: -1 } ; arrondi à 4
// décimales (le zéro reste un zéro)
µ._mjs_fxVec = function(deg) {
  var r = deg * Math.PI / 180;
  var x = Math.round(Math.sin(r) * 1e4) / 1e4;
  var y = Math.round(-Math.cos(r) * 1e4) / 1e4;
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
};

// un point d'origine en fractions { x, y } (0..1 dans la balise) : un mot, `x% y%` ; null pour
// `pointer` (l'effet suit la souris) ; `dflt` sinon
var _MJS_FX_POINTS = { center: [.5, .5], top: [.5, 0], bottom: [.5, 1], left: [0, .5], right: [1, .5], 'top-left': [0, 0], 'top-right': [1, 0], 'bottom-left': [0, 1], 'bottom-right': [1, 1] };
µ._mjs_fxPoint = function(v, dflt) {
  if (v === 'pointer') return null;
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(_MJS_FX_POINTS, v)) return { x: _MJS_FX_POINTS[v][0], y: _MJS_FX_POINTS[v][1] };
  var m = /^(-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%$/.exec(String(v));
  if (m) return { x: parseFloat(m[1]) / 100, y: parseFloat(m[2]) / 100 };
  return dflt === void 0 ? { x: .5, y: .5 } : dflt;
};

// la balise est-elle loin de l'écran (plus de 200 px) ou pas encore mise en page (sans taille : le
// composant n'est pas montré avant la fin de son premier rendu) : ce qui n'a pas à se préparer ni
// à charger son image tant qu'elle n'approche pas
µ._mjs_fxFar = function(el) {
  var r = µ._mjs_dom.getBoundingClientRect(el);
  return !(r.width > 0 || r.height > 0) || r.bottom < -200 || r.top > (innerHeight || 0) + 200 || r.right < -200 || r.left > (innerWidth || 0) + 200;
};

// le même critère pour une image à charger : sans moteur de mise en page (happy-dom : tout y mesure
// zéro), rien ne se diffère
µ._mjs_fxFarImage = function(el) {
  return document.documentElement.clientWidth > 0 && µ._mjs_fxFar(el);
};

// l'adresse d'une image donnée en réglage : une adresse, ou ce que rend `µimage('…')` — { src, srcset } :
// la plus petite variante qui couvre la largeur de la balise à l'écran (× la densité de l'écran) — l'image
// cadrée en `cover` dans une balise plus haute qu'elle, ses dimensions connues (µimage les donne) : la
// largeur qu'elle y prend ; quand aucune ne la couvre, l'image d'origine (`src`), jamais une variante plus petite agrandie ; la
// plus grande variante seulement sans image d'origine ; une balise pas encore mise en page (largeur 0) :
// la largeur de la fenêtre fait foi ; '' sans image
µ._mjs_fxImage = function(v, el) {
  if (v == null || v === '') return '';
  if (typeof v !== 'object') return String(v);
  var src = v.src ? String(v.src) : '';
  if (!v.srcset) return src;
  var box  = el && el.getBoundingClientRect ? µ._mjs_dom.getBoundingClientRect(el) : null;
  var wide = box ? box.width : 0;
  if (!(wide > 0)) wide = typeof innerWidth === 'number' ? innerWidth : 0;
  else if (v.width > 0 && v.height > 0 && box.height > 0) wide = Math.max(wide, box.height * v.width / v.height);
  var need = wide * (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  var best = '';
  var bw   = Infinity;
  var top  = '';
  var tw   = 0;
  String(v.srcset).split(',').forEach(function(part) {
    var m = /^\s*(\S+)\s+(\d+)w\s*$/.exec(part);
    if (!m) return;
    if (+m[2] > tw) {
      top = m[1];
      tw  = +m[2];
    }
    if (+m[2] >= need && +m[2] < bw) {
      best = m[1];
      bw   = +m[2];
    }
  });
  return best || src || top;
};

// LA RÉUSSITE ET L'ÉCHEC (`on: success`, `on: error`) : la fin de l'action d'une balise — une
// promesse rendue par un de ses gestionnaires (routeur d'événements, mjs_element.ts :
// `el._mjs_fxResult`), ou l'envoi du formulaire qui la porte (mjs_ujs.ts : µ._mjs_fxTell) ; `fn`
// est appelée à chaque fin du côté attendu, rend la fonction d'arrêt
µ._mjs_fxOnResult = function(el, on, fn) {
  var ev   = 'mjs:' + on;
  var form = µ._mjs_closest(el, 'form');
  var done = false;
  // la balise dit la fin de ses actions tant qu'un effet l'attend (compté : plusieurs effets)
  el._mjs_fxResult  = µ._mjs_fxResult;
  el._mjs_fxResultN = (el._mjs_fxResultN || 0) + 1;
  µ._mjs_dom.addEventListener(el, ev, fn);
  if (form && form !== el) µ._mjs_dom.addEventListener(form, ev, fn);
  return function() {
    if (done) return;
    done = true;
    µ._mjs_dom.removeEventListener(el, ev, fn);
    if (form && form !== el) µ._mjs_dom.removeEventListener(form, ev, fn);
    if (--el._mjs_fxResultN === 0) el._mjs_fxResult = null;
  };
};
// la fin d'une action, dite à sa balise : `mjs:success` ou `mjs:error`, la valeur (ou l'erreur) en
// `data`
µ._mjs_fxTell = function(el, ok, data) {
  if (!el || typeof el.dispatchEvent !== 'function') return;
  var ev = new CustomEvent(ok ? 'mjs:success' : 'mjs:error');
  Object.defineProperty(ev, 'data', { value: data, enumerable: true });
  µ._mjs_dom.dispatchEvent(el, ev);
};
// la promesse rendue par un gestionnaire de la balise (`this`) : réussie si elle tient parole sans
// `ok: false` (une réponse `fetch` en erreur, un µ.optimistic refusé), en échec sinon — une promesse
// rejetée le reste pour la suite (l'erreur non traitée se voit comme avant)
µ._mjs_fxResult = function(p) {
  var el = this;
  p.then(function(v) {
    µ._mjs_fxTell(el, !(v && typeof v === 'object' && v.ok === false), v);
  }, function(err) {
    µ._mjs_fxTell(el, false, err);
    throw err;
  });
};

// À L'ÉCRAN — une balise est vue quand la part `part` d'elle-même est à l'écran, ou, plus grande que ce
// qu'elle peut y montrer, quand elle en montre cette part : une balise de cinq écrans ne montre jamais
// 20 % d'elle-même, une bande de 2 400 px sur un écran de 390 non plus, un article de 3 000 px dans une
// zone de 150 px qui défile non plus. Ce qu'une balise peut montrer à la fois : sa largeur et sa hauteur,
// au plus celles de l'écran, ou du conteneur qui rogne ce qui dépasse (`overflow` autre que visible) —
// la part visible se mesure à cette surface-là, pas à la hauteur de l'écran. Une balise qui tient dans
// l'écran et que seul son bord coupe est jugée sur elle-même, sans rien lire de ses ancêtres (le cas
// ordinaire : lire un style force le navigateur à recalculer ce que l'effet de la balise d'avant vient
// de changer) : un conteneur plus petit qu'elle ne la borne donc qu'à partir du moment où son propre
// bord est à l'écran, à peine entré il ne compte pas encore. `µ._mjs_fxSteps(part)` : les seuils de son
// observateur, en paliers jusqu'à `part`, pour qu'il prévienne au fil du défilement même sur une très
// haute balise
var _MJS_FX_STEPS = [0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2];
µ._mjs_fxSteps = function(part) {
  return _MJS_FX_STEPS.filter(function(x) { return x < part; }).concat([part]);
};

// [largeur, hauteur] que la balise peut montrer à la fois : celles de l'écran (`w`, `h`), rétrécies par
// chaque ancêtre qui la rogne VRAIMENT (`overflow` autre que visible), à son rectangle à l'écran — pas à
// `clientHeight`, qu'un `zoom` ou une transformation ne suivent pas. On remonte la chaîne du rognage :
// le parent, le `<slot>` où un contenu est glissé, l'hôte au sortir d'un shadow root. Une balise fixe ou
// absolue n'est rognée que par son bloc englobant et ce qui l'entoure : l'ancêtre qui ne la contient pas
// (un `overflow: hidden` sans position, pour une balise fixe) ne la rogne pas, il ne réduit rien
function _mjsFxRoom(el, w, h) {
  if (typeof getComputedStyle !== 'function') return [w, h];
  // la position de ce que l'on suit : la balise d'abord, puis chaque ancêtre qui la contient
  var pos = _mjsFxBox(el).pos;
  for (var n = _mjsFxUp(el); n; n = _mjsFxUp(n)) {
    if (n.nodeType !== 1) continue;
    var b = _mjsFxBox(n);
    if (pos === 'fixed' || pos === 'absolute') {
      if (b.fix === null) b.fix = _mjsFxHoldsFixed(b.cs);
      if (!(b.fix || (pos === 'absolute' && b.pos !== 'static'))) continue;
    }
    pos = b.pos;
    if (!b.ox && !b.oy) continue;
    var r = b.rect || (b.rect = µ._mjs_dom.getBoundingClientRect(n));
    if (b.ox && r.width > 0) w = Math.min(w, r.width);
    if (b.oy && r.height > 0) h = Math.min(h, r.height);
  }
  return [w, h];
}

// le nœud qui entoure `n` pour le rognage : l'hôte d'un shadow root, le `<slot>` où `n` est glissé, sinon
// son parent. `assignedSlot` ne dit rien d'un shadow root fermé (celui des composants, par défaut) : le
// composant qui l'a, lui, sait quel slot affiche le nœud
function _mjsFxUp(n) {
  if (n.nodeType === 11) return n.host || null;
  var p    = n.parentNode;
  var slot = n.assignedSlot || (p && p._shadow && typeof p._mjs_slotOf === 'function' ? p._mjs_slotOf(n) : null);
  return slot || p;
}

// ce que le rognage lit d'un nœud, UNE fois par image : une page de mille balises qui défile les
// interroge toutes, et chacune remonte ses ancêtres, souvent les mêmes ; relire leur style à chaque balise
// ralentit le défilement. La mémoire est vidée à l'image suivante, quand la mise en page a pu bouger
var _mjsFxBoxes = null;

function _mjsFxBox(n) {
  var boxes = _mjsFxBoxes;
  if (!boxes && typeof requestAnimationFrame === 'function') {
    boxes = _mjsFxBoxes = new WeakMap();
    requestAnimationFrame(function() { _mjsFxBoxes = null; });
  }
  var b = boxes && boxes.get(n);
  if (b) return b;
  var cs = getComputedStyle(n);
  b = { cs: cs, pos: cs.position, ox: cs.overflowX !== 'visible', oy: cs.overflowY !== 'visible', fix: null, rect: null };
  if (boxes) boxes.set(n, b);
  return b;
}

// un ancêtre devient le bloc englobant des balises fixes (et celui des absolues) : transformation (`transform`,
// mais aussi `translate`, `rotate`, `scale` et `offset-path`, leur valeur neutre comprise), perspective, filtre,
// filtre de fond, `transform-style` autre que `flat`, `content-visibility` autre que `visible`, confinement de la mise en
// page ou du dessin, `will-change` de ces propriétés (`contain` compris) — pas `offset-rotate`,
// qui ne retient rien. `container-type` n'en est pas : mesuré dans Chromium, Firefox et WebKit, une balise fixe ou
// absolue sous un conteneur de requêtes reste à la fenêtre ou à la page. Le rognage du moteur s'en sert : elle reste ici, et
// *cursors et *longshadow, livrés seuls, l'appellent par µ._mjs_fxHoldsFixed
function _mjsFxHoldsFixed(cs) {
  return (cs.transform || 'none') !== 'none' || (cs.translate || 'none') !== 'none' || (cs.rotate || 'none') !== 'none' || (cs.scale || 'none') !== 'none' || (cs.offsetPath || 'none') !== 'none' || (cs.perspective || 'none') !== 'none' || (cs.filter || 'none') !== 'none' || (cs.backdropFilter || 'none') !== 'none' || (cs.transformStyle || 'flat') !== 'flat' || (cs.contentVisibility || 'visible') !== 'visible' || /layout|paint|strict|content/.test(cs.contain || '') || /transform|translate|scale|offset-path|perspective|filter|contain(?![-\w])|(^|[^-])rotate/.test(cs.willChange || '');
}
µ._mjs_fxHoldsFixed = _mjsFxHoldsFixed;

µ._mjs_fxSeen = function(entry, part) {
  if (!entry.isIntersecting) return false;
  // sans part connue (entrée incomplète) : vue dès qu'elle croise l'écran
  if (!(entry.intersectionRatio < part)) return true;
  var r = entry.intersectionRect;
  var b = entry.boundingClientRect;
  var v = entry.rootBounds;
  var h = v ? v.height : window.innerHeight || 0;
  // sans la boîte de la balise (entrée incomplète) : la part de la hauteur de l'écran qu'elle couvre
  if (!r || !b || !(b.width > 0) || !(b.height > 0)) return !!r && h > 0 && r.height >= part * h;
  var w  = v && v.width > 0 ? v.width : window.innerWidth || 0;
  var cw = Math.min(b.width, w);
  var ch = Math.min(b.height, h);
  if (cw > 0 && ch > 0 && r.width * r.height >= part * cw * ch) return true;
  // une balise qui tient dans l'écran et que seul son bord coupe (ce qu'elle montre est tout ce que l'écran
  // en laisse) est jugée sur elle-même : ses ancêtres ne sont pas lus
  var vl = v ? v.left : 0;
  var vt = v ? v.top : 0;
  var sx = Math.min(b.right, vl + w) - Math.max(b.left, vl);
  var sy = Math.min(b.bottom, vt + h) - Math.max(b.top, vt);
  if (b.width <= w + 1 && b.height <= h + 1 && r.width >= sx - 1 && r.height >= sy - 1) return false;
  // la balise est peut-être plus grande que le conteneur qui la rogne : il borne ce qu'elle peut montrer
  var room = entry.target ? _mjsFxRoom(entry.target, w, h) : [w, h];
  cw = Math.min(b.width, room[0]);
  ch = Math.min(b.height, room[1]);
  return cw > 0 && ch > 0 && r.width * r.height >= part * cw * ch;
};

// déclencheur d'un effet qui se JOUE : 'view' (à l'entrée à l'écran, une fois — sans
// IntersectionObserver, tout de suite), 'hover', 'click', 'load', 'success', 'error' ; rend la
// fonction d'arrêt
µ._mjs_fxWhen = function(el, on, play) {
  on = on || 'view';
  if (on === 'load') {
    play();
    return function() {};
  }
  if (on === 'success' || on === 'error') return µ._mjs_fxOnResult(el, on, function() { play(); });
  if (on === 'hover' || on === 'click') {
    var ev = on === 'hover' ? 'pointerenter' : 'click';
    µ._mjs_dom.addEventListener(el, ev, play);
    return function() { µ._mjs_dom.removeEventListener(el, ev, play); };
  }
  if (typeof IntersectionObserver !== 'function') {
    play();
    return function() {};
  }
  µ._mjs_dom.setAttribute(el, 'mjs-fx-wait', '');
  var io = new IntersectionObserver(function(entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!µ._mjs_fxSeen(entries[i], 0.2)) continue;
      io.disconnect();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-wait');
      play();
      return;
    }
  }, { threshold: µ._mjs_fxSteps(0.2) });
  io.observe(el);
  return function() {
    io.disconnect();
    µ._mjs_dom.removeAttribute(el, 'mjs-fx-wait');
  };
};

// déclencheur commun d'un effet qui BOUCLE : always (tout le temps), hover (pendant le survol), view
// (tant que la balise est à l'écran), click (un cycle par clic), load (un cycle à l'apparition).
// L'effet écrit son animation `var(--mjs-fx-<nom>-go, <son animation>)` … `var(--mjs-fx-<nom>-times,
// infinite)` : le moteur la coupe (`none`, la balise revient au repos) ou la relance.
µ._mjs_fxLoop = function(el, name, on) {
  var go    = '--mjs-fx-' + name + '-go';
  var times = '--mjs-fx-' + name + '-times';
  if (!on || on === 'always') return function() {};
  var stop = function() { el.style.setProperty(go, 'none'); };
  var run  = function() { el.style.removeProperty(go); };
  var once = function() {
    el.style.setProperty(go, 'none');
    void el.offsetWidth;
    el.style.removeProperty(go);
  };
  var undo = [];
  var on2  = function(ev, f) {
    µ._mjs_dom.addEventListener(el, ev, f);
    undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
  };
  if (on === 'hover') {
    stop();
    on2('pointerenter', run);
    on2('pointerleave', stop);
  }
  else if (on === 'view') {
    if (typeof IntersectionObserver === 'function') {
      stop();
      var io = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) (µ._mjs_fxSeen(entries[i], 0.1) ? run : stop)();
      }, { threshold: µ._mjs_fxSteps(0.1) });
      io.observe(el);
      undo.push(function() { io.disconnect(); });
    }
  }
  else {
    el.style.setProperty(times, '1');
    if (on === 'click') {
      stop();
      on2('click', once);
    }
    else if (on === 'success' || on === 'error') {
      stop();
      undo.push(µ._mjs_fxOnResult(el, on, once));
    }
  }
  return function() {
    for (var i = 0; i < undo.length; i++) undo[i]();
    el.style.removeProperty(go);
    el.style.removeProperty(times);
  };
};

// déclencheur commun d'un effet À ÉTAT (actif ou au repos) : hover (pendant le survol), view (dès
// que la balise est à l'écran), click (chaque clic bascule), always (tout le temps), rest (au repos,
// éteint pendant le survol). Actif = le
// jeton `<nom>` dans l'attribut `mjs-fx-on` ; l'effet écrit son état actif
// `[mjs-fx~="<nom>"][mjs-fx-on~="<nom>"]`.
µ._mjs_fxState = function(el, name, on) {
  var set = function(yes) { _mjsFxTokenOf(el, 'mjs-fx-on', name, yes); };
  var undo = [];
  var on2  = function(ev, f) {
    µ._mjs_dom.addEventListener(el, ev, f);
    undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
  };
  on = on || 'hover';
  if (on === 'always' || on === 'load') set(true);
  else if (on === 'hover') {
    on2('pointerenter', function() { set(true); });
    on2('pointerleave', function() { set(false); });
  }
  else if (on === 'rest') {
    set(true);
    on2('pointerenter', function() { set(false); });
    on2('pointerleave', function() { set(true); });
  }
  else if (on === 'click') on2('click', function() { set(!(µ._mjs_dom.getAttribute(el, 'mjs-fx-on') || '').split(' ').includes(name)); });
  else if (on === 'view') {
    if (typeof IntersectionObserver !== 'function') set(true);
    else {
      var io = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!µ._mjs_fxSeen(entries[i], 0.2)) continue;
          io.disconnect();
          set(true);
          return;
        }
      }, { threshold: µ._mjs_fxSteps(0.2) });
      io.observe(el);
      undo.push(function() { io.disconnect(); });
    }
  }
  return function() {
    for (var i = 0; i < undo.length; i++) undo[i]();
    set(false);
  };
};

// déclencheur commun d'un effet animé en JAVASCRIPT (minuterie) : mêmes mots que µ._mjs_fxLoop ;
// `start`/`stop` lancent et arrêtent l'animation, `cycle` (ms) = la durée d'un cycle, pour click et
// load (un cycle, puis arrêt)
µ._mjs_fxRun = function(el, on, start, stop, cycle) {
  var undo = [];
  var t    = null;
  var on2  = function(ev, f) {
    µ._mjs_dom.addEventListener(el, ev, f);
    undo.push(function() { µ._mjs_dom.removeEventListener(el, ev, f); });
  };
  var once = function() {
    start();
    clearTimeout(t);
    t = setTimeout(stop, cycle);
  };
  on = on || 'always';
  if (on === 'always') {
    start();
    // tout le temps qu'elle est à l'écran (à 100 px près) : hors de l'écran, la minuterie se repose,
    // elle repart à son retour — sans observateur, ou tant qu'il n'a rien dit, elle tourne
    if (typeof IntersectionObserver === 'function') {
      var there = true;
      var near  = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          var yes = entries[i].isIntersecting;
          if (yes === there) continue;
          there = yes;
          (yes ? start : stop)();
        }
      }, { rootMargin: '100px' });
      near.observe(el);
      undo.push(function() { near.disconnect(); });
    }
  }
  else if (on === 'hover') {
    on2('pointerenter', start);
    on2('pointerleave', stop);
  }
  else if (on === 'view') {
    if (typeof IntersectionObserver !== 'function') start();
    else {
      // lancée à l'arrivée, arrêtée au départ, une fois chacun (l'observateur prévient à chaque palier)
      var shown = false;
      var io = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          var yes = µ._mjs_fxSeen(entries[i], 0.1);
          if (yes === shown) continue;
          shown = yes;
          (yes ? start : stop)();
        }
      }, { threshold: µ._mjs_fxSteps(0.1) });
      io.observe(el);
      undo.push(function() { io.disconnect(); });
    }
  }
  else if (on === 'click') on2('click', once);
  else if (on === 'success' || on === 'error') undo.push(µ._mjs_fxOnResult(el, on, once));
  else once();
  return function() {
    clearTimeout(t);
    for (var i = 0; i < undo.length; i++) undo[i]();
    stop();
  };
};

// la bande `zone` d'un effet au défilement (`70% 40%`, `bottom center`) : deux hauteurs de la zone
// visible, en fractions (0 en haut, 1 en bas) ; null sans bande, ou pour une bande vide
var _MJS_FX_HEIGHTS = { top: 0, center: .5, bottom: 1 };
µ._mjs_fxZone = function(v) {
  var b = typeof v === 'string' ? v.trim().split(/\s+/) : [];
  if (b.length !== 2) return null;
  var h = function(x) { return Object.prototype.hasOwnProperty.call(_MJS_FX_HEIGHTS, x) ? _MJS_FX_HEIGHTS[x] : /%$/.test(x) ? parseFloat(x) / 100 : NaN; };
  var z = [h(b[0]), h(b[1])];
  return isFinite(z[0]) && isFinite(z[1]) && z[0] !== z[1] ? z : null;
};

// l'avancée (0 → 1) d'une balise dans la zone visible, `r` sa boîte, `box` celle de la zone : avec
// une bande `z`, 0 quand le haut de la balise passe la première hauteur, 1 à la seconde ; sans
// bande, 0 quand son haut touche le bas de la zone, 1 quand son milieu en atteint le milieu
µ._mjs_fxAdvance = function(r, box, z) {
  var p = z ? (z[0] * box.height - (r.top - box.top)) / ((z[0] - z[1]) * box.height) : (box.top + box.height - r.top) / Math.max(1, box.height / 2 + r.height / 2);
  return p < 0 ? 0 : p > 1 ? 1 : p;
};

// l'avancée (0 → 1) d'une balise COLLANTE (position: sticky) : elle ne bouge plus à l'écran, sa
// section si — `r` la boîte de son parent, `box` celle de la zone visible : 0 quand le haut du parent
// atteint le haut de la zone, 1 quand son bas en atteint le bas (un texte qui se révèle mot à mot :
// une section de 200vh, le texte collé dedans) ; null si le parent n'est pas plus haut que la zone
µ._mjs_fxStuck = function(r, box) {
  var course = r.height - box.height;
  if (!(course > 0)) return null;
  var p = (box.top - r.top) / course;
  return p < 0 ? 0 : p > 1 ? 1 : p;
};

// une liste de couleurs posée par un thème (`$$rainbow-colors: red, gold, #0ff`), vue depuis la
// balise ; null si absente
µ._mjs_fxList = function(el, name) {
  var v = µ._mjs_fxCss(el, name);
  if (!v) return null;
  var list = v.split(/,(?![^(]*\))/).map(function(x) { return x.trim(); }).filter(Boolean);
  return list.length > 0 ? list : null;
};

// rejoue les animations CSS d'un effet : son jeton retiré de l'attribut-liste `mjs-fx-play` puis
// reposé ; `off` : retiré seulement (retrait de l'effet)
µ._mjs_fxPlay = function(el, name, off) {
  _mjsFxTokenOf(el, 'mjs-fx-play', name, false);
  if (off) return;
  void el.offsetWidth;
  _mjsFxTokenOf(el, 'mjs-fx-play', name, true);
};

// une couleur, une liste de couleurs, une valeur CSS tenue par une variable peut venir d'une donnée de l'utilisateur : elle ne
// charge jamais une adresse — ni `url(`, `image(`, `image-set(`, `src(`, `cross-fade(` ou `@import`, ni échappement (`\`, qui
// écrirait `url(` autrement), ni fin de déclaration ou de bloc (`;`, `{`, `}`) ; ses parenthèses s'équilibrent, sans quoi une
// parenthèse fermante en trop sortirait de la fonction où l'effet la pose (`drop-shadow(…)`, un dégradé) pour en ajouter une
function _mjsFxSafe(x) {
  if (/[;{}\\]|@import|(?:url|image|image-set|src|cross-fade)\(/i.test(x)) return false;
  var d = 0;
  for (var i = 0; i < x.length; i++) {
    if (x[i] === '(') d++;
    else if (x[i] === ')' && --d < 0) return false;
  }
  return d === 0;
}

// règle d'un réglage tenu par une variable : ['i'|'f', min, max, texte], ['l', valeurs, texte],
// ['o', pointer permis, texte], ['b'|'t'|'c'|'s'|'p'|'k'|'w'|'d'|'e'|'x', texte], ['s'|'p', min, max, texte] (un texte borné en
// longueur, comptée en caractères comme à la compilation : hors bornes, écarté) → [valeur, état] (0 bonne,
// 1 ramenée, -1 écartée) ; `s` va dans le CSS (cf. _mjsFxSafe), `p` est un texte de la page (un textContent,
// une toile, un sélecteur, une adresse donnée exprès) : il passe tel quel, « Bravo :) » compris (cf. specOf
// d'effects/catalog.ts, qui choisit la lettre)
µ._mjs_fxNorm = function(v, sp) {
  if (v === void 0 || v === null || v === '') return [void 0, 0];
  switch (sp[0]) {
    case 'i':
    case 'f': {
      var n = typeof v === 'number' ? v : parseFloat(v);
      if (!isFinite(n)) return [void 0, -1];
      var m = sp[0] === 'i' ? Math.round(n) : n;
      if (sp[1] !== null && m < sp[1]) m = sp[1];
      if (sp[2] !== null && m > sp[2]) m = sp[2];
      return [m, m === n ? 0 : 1];
    }
    case 'b':
      return [v === 'false' ? false : !!v, 0];
    case 't':
      return typeof v === 'number' ? [v + 'ms', 0] : /^(?:0|\d*\.?\d+(?:ms|s))$/.test(String(v)) ? [String(v), 0] : [void 0, -1];
    case 'c':
    case 's':
    case 'p': {
      var len = Array.from(String(v)).length;
      if (sp.length > 3 && ((sp[1] !== null && len < sp[1]) || (sp[2] !== null && len > sp[2]))) return [void 0, -1];
      return sp[0] === 'p' || _mjsFxSafe(String(v)) ? [String(v), 0] : [void 0, -1];
    }
    case 'l':
      return sp[1].indexOf(v) >= 0 ? [v, 0] : [void 0, -1];
    case 'k': {
      // une liste : un tableau ou un texte à virgules ; un objet n'en est pas une, « semblable à une liste » compris (`{ 0: …, length: 1 }`)
      if (typeof v === 'object' && !Array.isArray(v)) return [void 0, -1];
      var list = Array.isArray(v) ? v.map(String) : String(v).split(/,(?![^(]*\))/).map(function(x) { return x.trim(); });
      return list.length > 0 && list.every(function(x) { return x !== '' && _mjsFxSafe(x); }) ? [list, 0] : [void 0, -1];
    }
    case 'w': {
      var mots = Array.isArray(v) ? v.map(String) : [String(v)];
      return mots.length > 0 && mots.every(function(x) { return x !== ''; }) ? [mots, 0] : [void 0, -1];
    }
    // une direction : un mot, un angle ramené dans 0..360
    case 'd': {
      if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(_MJS_FX_DIRS, v)) return [v, 0];
      var a = typeof v === 'number' ? v : /^-?\d+(?:\.\d+)?$/.test(String(v)) ? parseFloat(v) : NaN;
      if (!isFinite(a)) return [void 0, -1];
      var b = ((a % 360) + 360) % 360;
      return [b, b === a ? 0 : 1];
    }
    // un effet nommé par une variable (`fx: $effet`) : '*scramble', 'scramble', none — un effet du cœur,
    // ses réglages par défaut
    case 'e': {
      if (v === 'none') return ['none', 0];
      // donné en objet `{ fx, s }` : une copie, marquée (ses textes et ses listes passeront le filtre des valeurs CSS, hors textes de
      // la page, cf. µ._mjs_fxOnce) ; son nom passe la même vérification qu'un nom seul
      var obj = !!v && typeof v === 'object' && typeof v.fx === 'string';
      var nom = /^\*?([a-z][a-z0-9-]*)$/.exec(obj ? v.fx : String(v));
      // seul un effet qui se joue une fois se nomme : la table des plages (émise dès qu'une page nomme un effet par une variable, sans
      // prototype) a une entrée pour chacun de ceux du cœur, la définition d'un effet CSS de l'appli porte ses réglages (`params`) ; un effet
      // continu (`magnet`, `particles`) est écarté, son fichier n'est pas demandé
      var t = µ._mjs_fxRanges;
      if (!nom || (t && !(nom[1] in t) && !(µ._mjs_fxDefs[nom[1]] || 0).params)) return [void 0, -1];
      // un effet de l'appli (sa définition, ou son fichier au manifeste) ; celui dont le code n'est pas encore là : son fichier part tout de suite
      if (!(nom[1] === 'count' || µ._mjs_fxNeed(nom[1]))) return [void 0, -1];
      // ses réglages : les siens seulement, jamais un `s` lu sur un prototype pollué
      return [obj ? { fx: nom[1], s: Object.prototype.hasOwnProperty.call(v, 's') ? v.s : void 0, byVar: true } : { fx: nom[1], s: {} }, 0];
    }
    // un point : un mot, `x% y%`, pointer si l'effet le suit (sp[1])
    case 'o':
      return (v === 'pointer' && sp[1]) || (typeof v === 'string' && Object.prototype.hasOwnProperty.call(_MJS_FX_POINTS, v)) || /^-?\d+(?:\.\d+)?% -?\d+(?:\.\d+)?%$/.test(String(v)) ? [String(v), 0] : [void 0, -1];
  }
  return [v, 0];
};

// valeur d'une variable passée par sa règle ; message en développement si elle est ramenée ou
// écartée (même réglage que les types : `µ._typesMode`)
function _mjsFxValue(el, name, k, v, sp) {
  if (!sp) return v;
  var r = µ._mjs_fxNorm(v, sp);
  // l'avis est du développement : le réglage des types n'existe pas en production, il ne s'y écrirait jamais
  // @@ dev
  var mode = µ._typesMode;
  if (r[1] !== 0 && (mode === 'warn' || mode === 'error')) {
    var ou  = el && el.localName ? ' (<' + el.localName + '>)' : '';
    // un objet en forme courte (le nom de l'effet qu'il porte), jamais [object Object]
    var vu  = typeof v === 'string' ? "'" + v + "'" : v && typeof v === 'object' && !Array.isArray(v) ? '{ ' + (typeof v.fx === 'string' ? "fx: '" + v.fx + "', " : '') + '… }' : String(v);
    var reg = sp[sp.length - 1];
    µ.warn(r[1] === 1
      ? µ._mjs_msg('fxBrought', { name: name, k: k, vu: vu, to: r[0], reg: reg, at: ou }, '*{name} : {k} = {vu} ramené à {to} — permis : {reg}{at}')
      : µ._mjs_msg('fxRefused', { name: name, k: k, vu: vu, reg: reg, at: ou }, '*{name} : {k} = {vu} refusé, valeur par défaut — permis : {reg}{at}'));
  }
  // @@
  return r[0];
}

// @@ dev
// une valeur de la variable de thème `$$mjs-fx-every` que la règle de `every` refuse (cf. µ._mjs_fxEvery, mjs_fx_toolbeat.ts) : dite une fois par
// valeur, en développement seulement (même réglage que les types : `µ._typesMode`) ; la production n'a pas cette fonction
var _mjsFxEveryWarned = {};
µ._mjs_fxEveryWarn = function(el, v) {
  var mode = µ._typesMode;
  if (!(mode === 'warn' || mode === 'error') || Object.prototype.hasOwnProperty.call(_mjsFxEveryWarned, v)) return;
  _mjsFxEveryWarned[v] = true;
  µ.warn(µ._mjs_msg('fxEveryRefused', { vu: "'" + v + "'", at: el && el.localName ? ' (<' + el.localName + '>)' : '' }, 'la variable de thème $$mjs-fx-every vaut {vu}, une valeur refusée : chaque effet garde sa cadence par défaut — permis : une durée (300ms, 1.5s, 0){at}'));
};
// @@

// valeur d'un réglage dans une variable CSS : une liste devient `a, b, c`
function _mjsFxCssValue(v) {
  return Array.isArray(v) ? v.join(', ') : String(v);
}

// les réglages d'un effet : les valeurs fixes, et celles des variables passées par leur règle. Un objet sans
// prototype, fait des seules clés propres : un réglage que la page n'a pas écrit reste absent, jamais lu sur un
// prototype pollué (une image, une valeur CSS, une adresse d'un tiers)
µ._mjs_fxSettings = function(el, name, s, d, sp) {
  var own = Object.prototype.hasOwnProperty;
  var all = Object.create(null);
  for (var f in s) if (own.call(s, f)) all[f] = s[f];
  for (var k0 in d) {
    if (!own.call(d, k0)) continue;
    var v0 = _mjsFxValue(el, name, k0, d[k0], sp && sp[k0]);
    if (v0 !== void 0) all[k0] = v0;
  }
  return all;
};

// un effet imbriqué `{ fx, s }` (le `fx` de *delta, *guard, *offline), joué une fois sur `el`. Venu d'une variable
// (marqué par la règle `e`), tous ses réglages en texte ou en liste passent le filtre des valeurs CSS (cf. _mjsFxSafe :
// une adresse est écartée, avec un avis en développement), quelle que soit la voie qui les mène au CSS — une variable
// CSS de l'effet, un style ou une feuille posés par son code (les `colors` de *gradient) ; seul un texte de la page
// passe tel quel. Les règles se lisent quand la définition de l'effet est là (son fichier peut arriver après) ; un nombre, un texte borné
// en longueur prennent la plage du catalogue (µ._mjs_fxRanges), comme écrits par une variable sur la balise
µ._mjs_fxOnce = function(comp, el, fx) {
  var own = Object.prototype.hasOwnProperty;
  var s   = own.call(fx, 's') ? fx.s : null;
  var d   = Object.create(null);
  for (var k in s) if (k !== 'on' && own.call(s, k)) d[k] = s[k];
  return µ._mjs_fx(comp, el, fx.fx, { on: 'load' }, d, fx.byVar ? _mjsFxCssRules : null);
};

// les réglages d'un effet du cœur qui ne vont jamais dans le CSS : un texte écrit par `textContent` ou dans une toile, un
// sélecteur, un nom, une adresse donnée exprès (les lettres `p` et `w` de specOf, effects/catalog.ts)
var _MJS_FX_PAGE_TEXT = /^(?:chars|d|decimal|emoji|frames|from|group|images|name|of|on|poses|prefix|room|separator|server|suffix|text|to|viewbox|words)$/;

// les réglages d'image d'un effet du cœur (la règle `image` de specOf, lettre `x`) : une adresse, `data:` comprise, ou l'objet que rend
// µimage — l'effet la lit par µ._mjs_fxImage et la pose entre guillemets
var _MJS_FX_IMAGE = /^(?:back|image|logo|mask)$/;

// les règles des réglages `d` d'un effet imbriqué venu d'une variable : une valeur CSS (une liste : chacune) pour ses
// variables CSS et pour tout autre texte ou objet, hors des textes de la page — un objet qui n'est pas un tableau (« semblable à une
// liste », du JSON que l'effet lirait par index) est écarté ; une image prend la voie de l'image, comme écrite en réglage ; un effet
// dans l'effet (`fx`) prend la règle `e`, qui le marque à son tour ; un nombre, un booléen, une connexion (`sock`) : aucune. Un réglage
// que la table des plages du catalogue connaît pour l'effet `name` (un nombre borné, un texte borné en longueur : émise par le constructeur
// quand une page nomme un effet par une variable, ses objets sans prototype : `constructor` n'y est jamais une plage) prend sa règle, celle
// qu'il recevrait écrit par une variable sur la balise
function _mjsFxCssRules(def, d, name) {
  var sp = {};
  var r  = µ._mjs_fxRanges && µ._mjs_fxRanges[name];
  for (var k in d) {
    var v   = d[k];
    var css = !!def.vars && Object.prototype.hasOwnProperty.call(def.vars, k);
    if (r && r[k]) sp[k] = r[k];
    else if (!css && k === 'fx') sp[k] = ['e', 'effet'];
    else if (!css && _MJS_FX_IMAGE.test(k)) sp[k] = ['x', 'image'];
    else if (css ? typeof v !== 'number' && typeof v !== 'boolean' : !_MJS_FX_PAGE_TEXT.test(k) && (typeof v === 'string' || (v !== null && typeof v === 'object' && k !== 'sock'))) sp[k] = [typeof v === 'string' ? 's' : 'k', 'css'];
  }
  return sp;
}

// ------------------------------------------------------------------------------------------------
// EFFETS ÉCONOMES — sur un appareil qui peine (vieux téléphone, économie d'énergie), les effets lourds
// se calment d'eux-mêmes : le tiers de leurs particules (µ._mjs_fxCount), leurs fonds animés à
// l'arrêt (`--mjs-fx-lite-play: paused` sur <html>, qui traverse les shadow roots par héritage).
// La mesure : tant qu'un effet lourd (définition marquée `heavy`) est posé, la cadence des images —
// deux fenêtres de 60 images à plus de 28 ms (moins de ~36 images par seconde) : économe pour le
// reste de la visite, et les effets qui comptent leurs particules à la pose (`liteRestart`)
// repartent. La mesure est celle de mjs_fx_toolgauge.ts, que seuls les effets lourds embarquent : une salve
// d'images à la pose du premier effet lourd, puis pendant que la page travaille (un geste, une image longue)
// et jamais au repos. Données économisées (navigator.connection.saveData) : économe d'emblée.
// `"effects": { "lite": "on" }` : toujours ; `"off"` : jamais (µ._fxConf, posé par le manifeste).
// ------------------------------------------------------------------------------------------------
µ._mjs_fxLite = false;

var _mjsFxHeavy = new Set();

// un nombre de particules, réduit au tiers en économe
µ._mjs_fxCount = function(n) {
  return µ._mjs_fxLite ? Math.max(1, Math.ceil(n / 3)) : n;
};

// relance d'un effet (réglage de comportement, effets économes, décor remis par mjs_fx_toolkeep.ts) : retiré, puis reposé avec
// les réglages `s` pour chacun des composants qui l'avaient posé — deux composants qui écrivent le même effet sur <@document> le
// gardent tous deux. Il reprend sa place parmi les effets de la balise : son rang dans `mjs-fx`, ses calques (enfants de la balise
// marqués `mjs-fx-layer`) devant ceux des effets posés après lui — reposé en dernier, son calque passait devant les leurs à l'écran
function _mjsFxRestart(el, name, off, s) {
  var comps = off._comps();
  var list  = (µ._mjs_dom.getAttribute(el, 'mjs-fx') || '').split(' ');
  var rank  = list.indexOf(name);
  var later = rank < 0 ? [] : list.slice(rank + 1);
  // le premier calque d'un effet posé après lui
  var next = null;
  for (var c = el.firstChild; c && !next && later.length > 0; c = c.nextSibling) if (_mjsFxLayerOf(c, later)) next = c;
  off();
  for (var i = 0; i < comps.length; i++) µ._mjs_fx(comps[i], el, name, s);
  var now = (µ._mjs_dom.getAttribute(el, 'mjs-fx') || '').split(' ');
  var at  = now.indexOf(name);
  if (rank >= 0 && at > rank) {
    now.splice(at, 1);
    now.splice(rank, 0, name);
    µ._mjs_dom.setAttribute(el, 'mjs-fx', now.join(' '));
  }
  if (!next || next.parentNode !== el) return;
  var mine = [];
  for (c = next.nextSibling; c; c = c.nextSibling) if (_mjsFxLayerOf(c, [name])) mine.push(c);
  for (i = 0; i < mine.length; i++) µ._mjs_dom.insertBefore(el, mine[i], next);
}
µ._mjs_fxRestart = _mjsFxRestart;

// un enfant de la balise est-il un calque de l'un des effets `names` (`mjs-fx-layer="<nom>"`, ou `"<nom>-…"`) ?
function _mjsFxLayerOf(c, names) {
  var v = c.nodeType === 1 && µ._mjs_dom.getAttribute(c, 'mjs-fx-layer');
  if (!v) return false;
  for (var i = 0; i < names.length; i++) if (v === names[i] || v.indexOf(names[i] + '-') === 0) return true;
  return false;
}

// la pose d'un effet : par l'outil qui remet son décor quand un script réécrit la balise (mjs_fx_toolkeep.ts), s'il est là
function _mjsFxPlant(def, el, name, s, comp) {
  return µ._mjs_fxKeep ? µ._mjs_fxKeep(def, el, name, s, comp) : def.setup(el, s, comp);
}

µ._mjs_fxGoLite = function() {
  if (µ._mjs_fxLite) return;
  µ._mjs_fxLite = true;
  var html = document.documentElement;
  html.setAttribute('mjs-fx-lite', '');
  html.style.setProperty('--mjs-fx-lite-play', 'paused');
  // les effets qui ont compté leurs particules à la pose repartent, en version calme
  Array.from(_mjsFxHeavy).forEach(function(p) {
    var o = p.el._mjs_fxOff && p.el._mjs_fxOff[p.name];
    if (!o || !µ._mjs_fxDefs[p.name].liteRestart) return;
    _mjsFxRestart(p.el, p.name, o, o._s);
  });
};

µ._mjs_fx = function(comp, el, name, s, d, sp) {
  // rendu serveur (happy-dom : µ._isServer ; navigateur de prérendu : µ.server) : aucun effet — sa
  // feuille est adoptée, jamais sérialisée, ses marques et ses calques partiraient sans elle dans le
  // HTML prérendu ; il se pose au premier rendu du navigateur
  if (µ._isServer || µ.server === true) return function() {};
  var def = µ._mjs_fxDefs[name];
  if (!def) return _mjsFxLater(comp, el, name, s, d, sp);
  // la balise d'un composant dont le code n'est pas encore arrivé : l'effet attend son enregistrement
  // (*skeleton, lui, se pose justement avant : la silhouette du composant tant que son code arrive)
  if (!el._shadow && name !== 'skeleton' && _mjsFxHostPending(el)) return _mjsFxHostLater(comp, el, name, s, d, sp);
  // même nœud déjà habillé : par le même composant (re-rendu d'un bloc parent), rien ne repart de
  // zéro ; par un autre (deux composants qui posent le même effet sur <@document>), le premier posé
  // l'emporte et reste tant qu'un des deux est affiché
  var offs = el._mjs_fxOff;
  if (offs && offs[name]) return offs[name]._own(comp);
  // les règles d'un effet imbriqué venu d'une variable (cf. µ._mjs_fxOnce) : lues sur sa définition, enfin là
  if (typeof sp === 'function') sp = sp(def, d, name);
  s = µ._mjs_fxSettings(el, name, s, d, sp);
  // la connexion d'un effet en direct écrite par sa variable (`sock: $$sock`) : gardée pour le panneau
  // d'inspection, qui l'écrit ainsi (cf. mjs_devpanel)
  if (sp) {
    for (var kv in sp) {
      if (!sp[kv] || sp[kv][0] !== 'v' || !sp[kv][1]) continue;
      var w = el._mjs_fxWritten || (el._mjs_fxWritten = {});
      (w[name] || (w[name] = {}))[kv] = sp[kv][1];
    }
  }
  if (def.css) _mjsFxAdopt(_mjsFxRoot(comp), name, def.css);
  _mjsFxTokenOf(el, 'mjs-fx', name, true);
  var props = [];
  if (def.vars) {
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(def.vars, k)) continue;
      var prop = '--mjs-' + name + '-' + k;
      el.style.setProperty(prop, _mjsFxCssValue(s[k]) + def.vars[k]);
      props.push(prop);
    }
  }
  // l'arrondi d'un effet à cadre (`radius`) : la balise le prend tant que l'effet est posé, le cadre
  // le suit ; l'arrondi d'avant est rendu au retrait
  var r0 = null;
  if (def.radius && s.radius !== void 0) {
    r0 = el.style.borderRadius;
    el.style.borderRadius = s.radius + 'px';
  }
  // un effet lourd : suivi par les effets économes (décidés AVANT la pose : il compte ses particules)
  var pose = def.heavy ? { el: el, name: name } : null;
  if (pose) {
    _mjsFxHeavy.add(pose);
    if (µ._mjs_fxGauge) µ._mjs_fxGauge(_mjsFxHeavy);
  }
  var stop = null;
  var wake = null;
  // un effet à image dont la balise est loin de l'écran, ou pas encore mise en page : il se pose (et
  // l'image part) à l'image suivante si elle est alors proche, sinon à son approche
  if (def.image && s.image != null && s.image !== '' && typeof IntersectionObserver === 'function' && typeof requestAnimationFrame === 'function' && µ._mjs_fxFarImage(el)) {
    var io  = null;
    var raf = 0;
    var go  = function() {
      wake();
      // une pose qui lève ne laisse rien derrière elle, comme la pose directe : l'effet est retiré ; l'erreur, que personne
      // n'attend dans ce rappel, sort par µ.error (comme une pose qui échoue à l'arrivée de son fichier)
      try {
        stop = _mjsFxPlant(def, el, name, off._s, comp);
      }
      catch (e) {
        off();
        µ.error(µ._mjs_msg('fxApply', { name: name }, 'effet « {name} » : sa pose a échoué —'), e);
        return;
      }
      off._hot = stop && typeof stop.set === 'function' ? stop.set : null;
    };
    raf = requestAnimationFrame(function() {
      raf = 0;
      if (!µ._mjs_fxFarImage(el)) return go();
      io = new IntersectionObserver(function(entries) {
        if (entries.some(function(e) { return e.isIntersecting; })) go();
      }, { rootMargin: '200px' });
      io.observe(el);
    });
    wake = function() {
      if (raf) cancelAnimationFrame(raf);
      if (io) io.disconnect();
      wake = null;
    };
  }
  else {
    // une pose qui lève ne laisse rien derrière elle (aucun retrait ne serait inscrit pour le défaire) ; l'erreur remonte
    try {
      stop = def.setup ? _mjsFxPlant(def, el, name, s, comp) : null;
    }
    catch (e) {
      if (pose) _mjsFxHeavy.delete(pose);
      for (var j = 0; j < props.length; j++) el.style.removeProperty(props[j]);
      if (r0 !== null) el.style.borderRadius = r0;
      _mjsFxTokenOf(el, 'mjs-fx', name, false);
      throw e;
    }
  }
  var done = false;
  // la poignée de chaque composant qui a posé l'effet : la sienne rendue, l'effet part avec la
  // dernière (un composant détruit, un sommeil) ; `off` lui-même retire tout, tout de suite (nœud
  // retiré par un bloc, relance par µ._mjs_fxSet)
  var hands = new Map();
  var off = function() {
    if (done) return;
    done = true;
    if (wake) wake();
    if (typeof stop === 'function') stop();
    if (pose) _mjsFxHeavy.delete(pose);
    for (var i = 0; i < props.length; i++) el.style.removeProperty(props[i]);
    if (off._r0 !== null) el.style.borderRadius = off._r0;
    _mjsFxTokenOf(el, 'mjs-fx', name, false);
    var o = el._mjs_fxOff;
    if (o && o[name] === off) {
      delete o[name];
      if (Object.keys(o).length === 0) el._mjs_fxOff = null;
    }
    hands.forEach(function(h, c) { if (c && c._mjs_attachments) c._mjs_attachments.delete(h); });
    hands.clear();
  };
  off._own = function(c) {
    var h = hands.get(c);
    if (h) return h;
    h = function() {
      if (!hands.has(c)) return;
      hands.delete(c);
      if (c && c._mjs_attachments) c._mjs_attachments.delete(h);
      if (hands.size === 0) off();
    };
    hands.set(c, h);
    if (c) (c._mjs_attachments || (c._mjs_attachments = new Set())).add(h);
    return h;
  };
  // réglages courants, composant et variables CSS posées : relus par µ._mjs_fxSet ; `stop.set(k, v)`,
  // si l'effet en a un, suit un réglage de comportement sans le reposer (rend false : il ne sait pas)
  off._s = s;
  off._c = comp;
  off._comps = function() { return Array.from(hands.keys()); };
  off._p = props;
  off._r0 = r0;
  off._hot = stop && typeof stop.set === 'function' ? stop.set : null;
  (el._mjs_fxOff || (el._mjs_fxOff = {}))[name] = off;
  return off._own(comp);
};

// une variable d'un réglage a changé : variable CSS mise à jour sur place ; un réglage de
// comportement (souris, minuterie…) relance l'effet avec ses nouveaux réglages
µ._mjs_fxSet = function(el, name, d, sp) {
  var o   = el._mjs_fxOff;
  var off = o && o[name];
  if (!off) {
    // en attente (son fichier arrive, son composant aussi) : ses variables suivies en attendant, sur
    // le plus récent appel, celui qui posera l'effet
    var w = el._mjs_fxWait && el._mjs_fxWait[name];
    var l = w && w.calls.length > 0 ? w.calls[w.calls.length - 1] : null;
    if (l && d) l.d = Object.assign(l.d || {}, d);
    return;
  }
  var def     = µ._mjs_fxDefs[name];
  var vars    = def.vars || {};
  var cur     = off._s;
  var next    = Object.create(null);
  var restart = false;
  var changed = [];
  var k;
  // clés propres seules, sans prototype (cf. µ._mjs_fxSettings)
  for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
  for (k in d) {
    if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
    var v = _mjsFxValue(el, name, k, d[k], sp && sp[k]);
    // une liste, un effet nommé par une variable (`{ fx, s }`, un objet neuf à chaque passage) se
    // comparent par leur contenu ; une connexion (`sock`), par elle-même
    var parValeur = sp && sp[k] && sp[k][0] === 'v';
    if (v === next[k] || (!parValeur && v !== null && typeof v === 'object' && JSON.stringify(v) === JSON.stringify(next[k]))) continue;
    if (v === void 0) delete next[k];
    else next[k] = v;
    changed.push(k);
    if (k === 'radius' && def.radius) continue;
    // un réglage visuel : sa variable CSS suit sur place, et l'effet qui le recopie dans son code
    // (une durée de minuterie, une couleur de canevas) en est prévenu par son `set`
    if (Object.prototype.hasOwnProperty.call(vars, k)) {
      if (off._hot) off._hot(k, v);
    }
    else if (!(off._hot && off._hot(k, v) !== false)) restart = true;
  }
  if (changed.length === 0) return;
  if (restart) {
    _mjsFxRestart(el, name, off, next);
    return;
  }
  for (var i = 0; i < changed.length; i++) {
    k = changed[i];
    // l'arrondi change sur place ; l'effet qui en dépend le suit par son `set`
    if (k === 'radius' && def.radius) {
      if (off._r0 === null) off._r0 = el.style.borderRadius;
      if (k in next) el.style.borderRadius = next[k] + 'px';
      else {
        el.style.borderRadius = off._r0;
        off._r0 = null;
      }
      if (off._hot) off._hot(k, next[k]);
      continue;
    }
    // un réglage de comportement suivi par l'effet (son `set`) n'a pas de variable CSS
    if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
    var prop = '--mjs-' + name + '-' + k;
    if (k in next) {
      el.style.setProperty(prop, _mjsFxCssValue(next[k]) + vars[k]);
      if (off._p.indexOf(prop) < 0) off._p.push(prop);
    }
    else el.style.removeProperty(prop);
  }
  off._s = next;
};

// nœud retiré par un bloc {if}/{for} (mjs_destroy_hooks.ts) : ses effets sont défaits, et ceux qui
// attendent leur fichier ou leur composant n'attendent plus
µ._mjs_fxClear = function(el) {
  var waits = el._mjs_fxWait;
  if (waits) {
    el._mjs_fxWait = null;
    for (var n in waits) _mjsFxDrop(waits[n]);
  }
  var o = el._mjs_fxOff;
  if (!o) return;
  for (var k in o) {
    try {
      o[k]();
    }
    catch (e) {
      µ.error(µ._mjs_msg('fxRemove', null, 'retrait d\'effet en erreur :'), e);
    }
  }
};
