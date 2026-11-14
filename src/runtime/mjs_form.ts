// mjs_form — l'objet formulaire d'un composant, tiré des règles de son bloc <vars> : `µ.form(el)` (la rune `µform(@)`) rend, pour chaque
// variable et prop typée, un champ `{ error, touched, dirty }`, et pour le tout `valid`, `submitting` et `reset()`, le même objet à chaque
// appel ; `fields` les range tous, un nom gardé par l'objet compris. `error` : le message de la règle pour la valeur du champ (celui de
// `µrules`, vide si elle passe), ou celui du serveur ; `touched` : le champ quitté une fois, ou son formulaire envoyé ; `dirty` : une
// valeur autre que celle de départ, prise quand la saisie du champ est là (juste après le premier rendu, ou à l'arrivée d'un champ qu'un
// {if} ajoute) ; `valid` : aucune erreur, touchée ou non ; `submitting` : un formulaire du composant en cours d'envoi par la navigation (il
// porte `aria-busy`, posé et retiré par mjs_ujs.ts) ; `reset()` : les valeurs de départ (variables et champs), plus rien de touché ni de
// modifié, les erreurs du serveur oubliées — le `reset` d'un formulaire (bouton `type="reset"`) le fait pour ses seuls champs.
// Le champ d'une variable `$age` est la saisie nommée `age` (le nom que le serveur reçoit, `age[]` pour une liste) que le gabarit du
// composant a écrite, ou celle d'une enveloppe <@@field name="age"> qu'il a écrite : sa valeur est le texte d'une saisie de texte (ce qui
// est tapé, même quand *guard le retient hors de la variable), sinon la variable elle-même (case, liste, module du cœur — son champ caché ne
// compte pas —, variable sans champ). Un champ appartient au composant qui l'entoure de plus près (_mjsFormOwner) : celui dont l'ombre le
// contient, ou le composant léger (`mjs-light`) qui le contient, même quand son parent l'y a écrit ; l'objet ne voit ni la saisie, ni les
// erreurs des champs d'un enfant. Les erreurs d'un refus du serveur (422 : `µres.errors`, clé : le nom du champ, un texte ou une liste de
// textes) valent pour les seuls champs que le formulaire refusé a emportés — ses champs activés et nommés, quelle que soit leur valeur
// (case décochée, radio sans choix, liste vide compris), ni désactivé (même par son <fieldset>), ni saisie sans nom, ni bouton autre que
// celui qui envoie —, dans l'objet du
// propriétaire de chacun (le composant qui a écrit ce formulaire, l'enfant léger dont le champ est dans le formulaire de son parent, celui
// dont un champ est rattaché par `form="…"` au formulaire d'un autre composant), aux valeurs que l'envoi a emportées (relevées quand il
// part, à `mjs:visit`) : un champ changé depuis reprend l'erreur de sa règle. Chaque formulaire garde ses réponses : un champ lit celles de
// SON formulaire (rangées par mjs_form_answers.ts quand l'application écrit un formulaire), la réponse à un autre formulaire ne les efface
// pas, et le nouvel envoi d'un formulaire remplace le relevé de son envoi d'avant, même s'il n'emporte plus aucun champ de l'objet ; des
// erreurs qui ne répondent à aucun envoi de formulaire (la page affichée avec elles, un lien, une écriture de l'application) valent pour
// tous. `<@@field>` lit l'objet
// du propriétaire de son champ (µ._mjs_formErr) : l'erreur du serveur tout de suite, celle de la règle une fois le champ touché ; sans
// objet chez lui, ou pour un nom qu'il ne connaît pas, `µres.errors` comme toujours. L'objet ne change rien à l'existant : *guard, le
// contrôle de chaque écriture, la 422 et la remise à zéro des modules du cœur gardent leur comportement.
// Fichier détecté (clé 'form'), embarqué seulement si le projet écrit `µform` (ou `µ.form`) ; il entraîne mjs_rules.ts (les messages),
// mjs_types.ts (le contrôle), mjs_state.ts (la réactivité) et mjs_lifecycle.ts (la destruction d'un composant, qui retire ses relevés en attente et l'écoute d'un composant léger). Un nom fabriqué à l'exécution se demande par `runtime: ['form']`

var _mjsFormHas = Object.prototype.hasOwnProperty;
// les noms du tout : une variable qui porte l'un d'eux reste suivie (`valid`, <@@field>, `fields`) mais ne se lit pas sous ce nom
var _MJS_FORM_OWN = ['valid', 'submitting', 'reset', 'fields'];
// un nom masqué, dit une fois par composant (sa balise) et par nom
var _mjsFormSaid  = {};
// les erreurs d'un refus (422), rangées avec le formulaire auquel elles répondent
var _mjsFormFrom  = new WeakMap();
// le dernier envoi tenté (`_mjsFormEv`, son événement `submit`) : les relevés à prendre à son départ, un par objet dont le formulaire porte
// des champs ou dont l'envoi d'avant a été relevé (un relevé vide remplace l'ancien), chacun marqué de son composant (`el`). L'événement
// tient son formulaire, et par lui toute la page : rien ne les garde au-delà de leur envoi — vidés à tout départ (`mjs:visit`, les relevés
// pris d'abord pour un envoi), et à la destruction d'un composant pour ses seuls relevés
var _mjsFormNext  = [];
var _mjsFormEv    = null;

// le propriétaire du nœud `n`, le composant qui l'entoure de plus près : l'hôte de l'ombre qui le contient, ou le composant léger
// (`mjs-light`) le plus proche, dont les enfants sont la vue (ceux que son parent y écrit compris) ; rien pour un nœud de la page
function _mjsFormOwner(n) {
  for (n = n && n.parentNode; n; n = n.parentNode) {
    if (n._mjs_isLight) return n;
    if (n.nodeType === 11) return n.host || null;
  }
  return null;
}

// chaque écriture d'une variable typée (mjs_types.ts) avance l'objet de son composant, une fois par tour : la valeur est alors écrite
var _mjsFormTset = µ._mjs_tset;
µ._mjs_tset = function(el, k, v) {
  if (el._mjs_formBump) el._mjs_formBump();
  return _mjsFormTset(el, k, v);
};

// un envoi de formulaire part : la navigation (mjs_ujs.ts) émet `mjs:visit` (`via: 'form'`) au départ de sa requête — chaque objet retenu
// par son écouteur `submit` (celui dont le formulaire porte des champs, ou dont l'envoi d'avant a été relevé) relève alors les valeurs des
// champs qu'il emporte ; un départ d'une autre sorte (un lien) n'en relève aucune. Tout départ vide l'attente : un envoi refusé (422), ou
// annulé avant ce départ, ne garde pas la page quittée
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('mjs:visit', function(e) {
    var w        = _mjsFormNext;
    _mjsFormNext = [];
    _mjsFormEv   = null;
    if (e.detail && e.detail.via === 'form') for (var i = 0; i < w.length; i++) w[i]();
  });
}

// la navigation dit ses refus (422) : `o`, les réglages de l'envoi (`o.form`, son formulaire, absent pour un lien) ; `b`, le corps de la
// réponse — ses erreurs sont rangées avec ce formulaire
µ._mjs_formTell = function(o, b) {
  var e = b.props && b.props.errors;
  if (o.form && e && typeof e === 'object') _mjsFormFrom.set(e, o.form);
};

function _mjsFormRaw(v) {
  return typeof µ._mjs_toRaw === 'function' ? µ._mjs_toRaw(v) : v;
}

// une copie de la valeur de départ, rendue à la remise à zéro (une liste, un objet, une date neufs)
function _mjsFormCopy(v) {
  v = _mjsFormRaw(v);
  try { return v !== null && typeof v === 'object' ? structuredClone(v) : v; }
  catch { return v; }
}

// une valeur en texte, pour la comparer
function _mjsFormKey(v) {
  try { return JSON.stringify(_mjsFormRaw(v)); }
  catch { return String(v); }
}

µ.form = function(el) {
  if (el._mjs_form) return el._mjs_form;
  var T      = el._mjs_types || {};
  var S      = µ.rules(el);
  var st     = µ.state({ n: 0 });
  var root   = el._shadow || el;
  var keys   = [];
  var touch  = {};
  var f      = {};
  var fields = {};
  // le départ de chaque champ : sa variable et le texte de sa saisie, pris quand elle est là ; `sent` : par formulaire, les valeurs que
  // son dernier envoi parti a emportées ; `seen` : les erreurs du serveur vues en dernier, `at` : les valeurs auxquelles elles répondent ; `gone` : par champ,
  // celles que sa remise à zéro a écartées ; `ats` : par sac lu, les valeurs auxquelles il répond (deux champs de deux formulaires ne
  // lisent pas le même sac : chaque formulaire a ses réponses)
  var vars   = {};
  var texts  = {};
  var sent   = new WeakMap();
  var ats    = new WeakMap();
  var gone   = {};
  var queued = false;
  var seen, at, k;
  for (k in T) if (_mjsFormHas.call(T, k)) keys.push(k);
  // un changement, un seul rafraîchissement par tour : le gabarit du composant relit les variables qui portent l'objet
  // (`$form = µform(@)`), et elles seules — un rafraîchissement entier réécrirait les champs liés depuis leurs variables, effaçant la frappe
  // que *guard retient ; les <@@field> qui le lisent (un autre composant, sans champ lié) suivent `st`
  var bump = function() {
    if (queued) return;
    queued = true;
    queueMicrotask(function() {
      queued = false;
      st.n++;
      for (var k in el._state) {
        var d = Object.getOwnPropertyDescriptor(el._state, k);
        if (d && 'value' in d && (d.value === f || _mjsFormRaw(d.value) === f)) {
          // <signaux>
          // les reffets qui lisent la variable repartent, comme à son écriture (graphe des signaux, mjs_signals.ts)
          if (el._mjs_sigBoxes) µ._mjs_sigWrite(el, k);
          // </signaux>
          el._mjs_invalidate(k);
        }
      }
    });
  };
  // la saisie de texte du champ, s'il y en a une : l'élément nommé, ou celui que son enveloppe nommée (<@@field name="x">) contient, écrit
  // par ce composant (celui d'un enfant léger, posé dans son arbre, n'est pas le sien) ; un champ caché (celui qu'un module du cœur pose
  // pour l'envoi) n'en est pas une
  var input = function(k) {
    var l = root.querySelectorAll('[name="' + k + '"]');
    for (var i = 0; i < l.length; i++) {
      var c = l[i];
      if (!/^(input|select|textarea)$/.test(c.localName)) c = c.querySelector('input:not([type="hidden"]), select, textarea') || c;
      if (_mjsFormOwner(c) === el && (c.localName === 'textarea' || (c.localName === 'select' && !c.multiple) || (c.localName === 'input' && !/^(checkbox|radio|file|submit|button|reset|image|hidden)$/.test(c.type)))) return c;
    }
    return null;
  };
  // le premier contrôle du champ `k` écrit par ce composant : l'élément nommé `k`, ou `k[]` pour une liste (rattaché par `form="…"`
  // compris) ; c'est par lui que se trouve le formulaire du champ
  var home = function(k) {
    var l = root.querySelectorAll('[name="' + k + '"], [name="' + k + '[]"]');
    for (var i = 0; i < l.length; i++) if (_mjsFormOwner(l[i]) === el) return l[i];
    return null;
  };
  // le sac que lit le champ `k`, `b` étant `µres.errors` : les réponses de son formulaire quand l'application les range par formulaire
  // (mjs_form_answers.ts), le sac lui-même sinon ; l'objet est rafraîchi quand ce que montre ce formulaire change sans que le sac change
  var bag = function(k, b) {
    return µ._mjs_formView ? µ._mjs_formView(home(k), b, bump) : b;
  };
  var value = function(k) {
    var c = input(k);
    return c ? c.value : el._state[k];
  };
  // les valeurs des champs `ks` (tous par défaut), en texte
  var snap = function(ks) {
    var o = {};
    ks    = ks || keys;
    for (var i = 0; i < ks.length; i++) o[ks[i]] = _mjsFormKey(value(ks[i]));
    return o;
  };
  // le départ du champ `k` : sa variable, et le texte de sa saisie `c`
  var mark = function(k, c) {
    vars[k]  = _mjsFormCopy(el._state[k]);
    texts[k] = c ? c.value : void 0;
  };
  // la saisie du champ ; arrivée après le départ (un {if}, un module), elle le prend
  var here = function(k) {
    var c = input(k);
    if (c && texts[k] === void 0 && _mjsFormHas.call(vars, k)) mark(k, c);
    return c;
  };
  // le refus de la règle, son premier message
  var said = function(k) {
    var r = S[k]['~standard'].validate(value(k));
    return r.issues ? r.issues[0].message : '';
  };
  // l'erreur du serveur pour ce champ, s'il est du relevé de l'envoi refusé et garde la valeur envoyée : les erreurs d'un refus répondent à
  // leur formulaire, dont il faut avoir relevé l'envoi (sinon elles ne sont pas pour lui) ; celles qui ne répondent à aucun envoi, aux valeurs de cet instant
  var server = function(k) {
    var b = µ.res && µ.res.errors;
    var e = bag(k, b);
    var r = _mjsFormRaw(e);
    var a = e === b ? at : ats.get(r);
    if (e === b ? e !== seen : a === void 0 && r && typeof r === 'object') {
      var o = r && typeof r === 'object' ? _mjsFormFrom.get(r) : void 0;
      a     = o ? sent.get(o) : snap();
      if (r && typeof r === 'object') ats.set(r, a);
      if (e === b) {
        seen = e;
        at   = a;
      }
    }
    if (!e || !a || r === gone[k] || !_mjsFormHas.call(a, k) || a[k] !== _mjsFormKey(value(k))) return '';
    var x = e[k];
    if (Array.isArray(x)) x = x[0];
    return x === void 0 || x === null || x === '' ? '' : String(x);
  };
  var error = function(k) { return server(k) || said(k); };
  keys.forEach(function(k) {
    fields[k] = {
      get error() { return error(k); },
      get touched() { return !!touch[k]; },
      // le texte de la saisie, ou la variable sans saisie, comparé à son départ (rien avant qu'il soit pris)
      get dirty() {
        if (!_mjsFormHas.call(vars, k)) return false;
        var c = here(k);
        return c ? c.value !== texts[k] : _mjsFormKey(el._state[k]) !== _mjsFormKey(vars[k]);
      }
    };
    if (_MJS_FORM_OWN.indexOf(k) < 0) f[k] = fields[k];
    // un nom gardé par l'objet : le développement le dit, une fois par composant ; `fields` le lit
    else if (µ._typesMode && !_mjsFormSaid[el.localName + ' ' + k]) {
      _mjsFormSaid[el.localName + ' ' + k] = 1;
      µ.warn(µ._mjs_msg('formMasked', { p: '$' + k, k: k, at: el.localName ? ' (<' + el.localName + '>)' : '' }, '{p} : « {k} » est un nom de l\'objet formulaire (µform), qui le garde pour lui — lisez le champ de cette variable par fields : $form.fields.{k}{at}'));
    }
  });
  // les valeurs de départ des champs `ks`, plus rien de touché ; une valeur de départ que la règle refuse (un champ obligatoire encore
  // vide) revient telle quelle, et ce qui la lit la montre
  var clear = function(ks) {
    var e = µ.res && µ.res.errors;
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      if (!_mjsFormHas.call(vars, k)) continue;
      var c = here(k);
      var v = _mjsFormCopy(vars[k]);
      if (S[k]['~standard'].validate(v).issues) {
        µ._mjs_rawWrite(el)[k] = v;
        // <signaux>
        // l'écriture brute ne relance aucun reffet : ceux qui lisent la variable repartent, comme à son écriture (graphe des signaux, mjs_signals.ts)
        if (el._mjs_sigBoxes) µ._mjs_sigWrite(el, k);
        // </signaux>
        el._mjs_invalidate(k);
      }
      else el._set(k, v);
      if (c && c.value !== texts[k]) c.value = texts[k];
      touch[k] = false;
      gone[k]  = _mjsFormRaw(bag(k, e));
    }
    bump();
  };
  // modifiables (configurable, writable) : un `$form` lu dans le gabarit passe par le mandataire des mutations profondes, qui ne peut rendre
  // une propriété figée qu'à l'identique
  Object.defineProperties(f, {
    valid: {
      enumerable: true,
      configurable: true,
      get: function() {
        for (var i = 0; i < keys.length; i++) if (error(keys[i])) return false;
        return true;
      }
    },
    submitting: {
      enumerable: true,
      configurable: true,
      get: function() {
        var l = root.querySelectorAll('form[aria-busy="true"]');
        for (var i = 0; i < l.length; i++) if (_mjsFormOwner(l[i]) === el) return true;
        return false;
      }
    },
    reset: {
      configurable: true,
      writable: true,
      value: function() { clear(keys); }
    },
    fields: {
      configurable: true,
      writable: true,
      value: fields
    }
  });
  // `_mjs_formShown` : ce que <@@field> montre pour le champ `k`, undefined s'il n'est pas de l'objet — lu ici, `st.n` abonne le
  // <@@field> qui appelle à chaque changement
  el._mjs_form      = f;
  el._mjs_formBump  = bump;
  el._mjs_formShown = function(k) {
    if (keys.indexOf(k) < 0) return void 0;
    return st.n >= 0 ? server(k) || (touch[k] ? said(k) : '') : '';
  };
  // les départs, un cran après le premier rendu (une prop posée par la page n'arrive qu'à sa fin) ; un champ sans saisie à cet instant
  // prend le sien à l'arrivée de sa saisie
  setTimeout(function() {
    for (var i = 0; i < keys.length; i++) mark(keys[i], input(keys[i]));
    bump();
  });
  if (µ._isServer || typeof root.addEventListener !== 'function') return f;
  // le nom d'un champ écrit par ce composant, ramené à sa variable (`tags[]`, `adr.city`), si elle est de l'objet ; une saisie sans nom
  // prend celui de son enveloppe (<@@field name="x">)
  var named = function(t) {
    if (!t || typeof t.getAttribute !== 'function' || _mjsFormOwner(t) !== el) return null;
    var n = t.getAttribute('name');
    if (!n && typeof t.closest === 'function') {
      var w = t.closest('[name]:not(form)');
      n     = w ? w.getAttribute('name') : null;
    }
    n = n ? n.replace(/\[\]$/, '').split('.')[0] : '';
    return keys.indexOf(n) >= 0 ? n : null;
  };
  // les champs d'un formulaire : ceux que ses contrôles désignent (`elements`, un contrôle rattaché par `form="…"` compris) ; avec `go`,
  // ceux-là seuls qu'un envoi emporte, `s` étant le bouton qui envoie (un bouton image, absent de `elements`, compris) : activés (ni
  // `disabled`, ni dans un <fieldset disabled>), nommés, jamais un bouton autre que `s` — quelle que soit leur valeur (une case décochée,
  // un groupe radio sans choix, une liste vide, un champ d'une <datalist> en sont : le serveur peut les refuser). Lus sur les contrôles à
  // la capture de `submit`, sans construire de `FormData` (il jouerait l'événement `formdata` une fois de plus) : un écouteur `formdata`
  // qui retire un champ, ou un écouteur `submit` de l'appli qui en désactive un ensuite, ne change pas le compte
  var mine = function(form, go, s) {
    var o = [];
    var l = Array.from(form && form.elements || []).concat(s || []);
    for (var i = 0; i < l.length; i++) {
      var c = l[i];
      var n = named(c);
      if (n === null || o.indexOf(n) >= 0) continue;
      if (go && (!c.getAttribute('name') || c.matches(':disabled') || /^(fieldset|output|object)$/.test(c.localName) || (c !== s && /^(submit|image|reset|button)$/.test(c.type)))) continue;
      o.push(n);
    }
    return o;
  };
  root.addEventListener('focusout', function(e) {
    var n = named(e.target);
    if (n !== null && !touch[n]) {
      touch[n] = true;
      bump();
    }
  });
  root.addEventListener('input', bump);
  root.addEventListener('change', bump);
  // un envoi tenté : les champs de ce formulaire touchés, à la capture (avant la navigation, qui l'envoie à la remontée ou l'ignore) ; un
  // formulaire qui porte des champs de ce composant (qu'il l'ait écrit ou non), ou dont l'envoi d'avant a été relevé, est retenu : les
  // champs qu'il emporte (activés, nommés) sont pris à cet instant (la navigation désactive ensuite ses boutons le temps de la requête), leurs
  // valeurs relevées au départ de la requête (`mjs:visit`) — aucun champ, un relevé vide, qui remplace celui de l'envoi d'avant
  // ses relevés en attente, retirés à sa destruction (un envoi annulé, une navigation qui n'est pas partie) : l'attente ne garde ni le
  // composant détruit, ni, quand plus rien n'y reste, l'événement et son formulaire ; la file des destructions se vide à chacune (un
  // composant léger peut revenir), d'où `held` : le retrait reposé au premier relevé qui suit
  var held = false;
  var drop = function() {
    held         = false;
    _mjsFormNext = _mjsFormNext.filter(function(r) { return r.el !== el; });
    if (!_mjsFormNext.length) _mjsFormEv = null;
  };
  var sub = function(e) {
    var t  = e.target;
    var ks = mine(t);
    var go = mine(t, true, e.submitter);
    for (var i = 0; i < ks.length; i++) touch[ks[i]] = true;
    if (ks.length || sent.has(t)) {
      if (_mjsFormEv !== e) {
        _mjsFormEv   = e;
        _mjsFormNext = [];
      }
      var r = function() { sent.set(t, snap(go)); };
      r.el  = el;
      _mjsFormNext.push(r);
      if (!held && el._mjs_onDestroy) {
        held = true;
        el._mjs_onDestroy(drop);
      }
      bump();
    }
  };
  // le `reset` d'un formulaire qui porte des champs de ce composant, pour ces seuls champs, un cran après l'événement (un écouteur posé plus
  // haut peut encore l'annuler) ; un autre formulaire ne le rafraîchit pas
  var rst = function(e) {
    var ks = mine(e.target);
    if (ks.length) setTimeout(function() { if (!e.defaultPrevented) clear(ks); });
  };
  // `m` : 'addEventListener' ou 'removeEventListener'
  var hear = function(r, m) {
    r[m]('submit', sub, true);
    r[m]('reset', rst);
  };
  hear(root, 'addEventListener');
  // un composant léger écoute aussi l'arbre qui le contient, un cran après son premier rendu (il y est alors posé) : le formulaire de son
  // parent qui l'entoure emporte ses champs sans que l'envoi ni le `reset` passent par lui. Cet arbre lui survit (l'ombre du parent, la
  // page) : ses écouteurs y sont retirés à sa destruction, et reposés à son montage s'il revient dans la page (la file du montage, comme
  // µevery) ; déplacé dans un autre arbre sans être détruit, il écoute encore le premier
  if (el._mjs_isLight) {
    var again = function() {
      (el._mjs_mount_cbs ||= []).push(far);
      el._mjs_pendingMount = true;
    };
    var far = function() {
      var r = el.getRootNode();
      if (r === el) return again();
      hear(r, 'addEventListener');
      el._mjs_onDestroy(function() {
        hear(r, 'removeEventListener');
        again();
      });
    };
    setTimeout(far);
  }
  // `aria-busy` posé ou retiré par la navigation (`submitting`) ; une saisie arrivée après le départ de son champ, qui le prend
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function(l) {
      var b = false;
      for (var i = 0; i < l.length; i++) if (l[i].type === 'attributes') b = true;
      for (i = 0; i < keys.length; i++) if (texts[keys[i]] === void 0 && here(keys[i]) && texts[keys[i]] !== void 0) b = true;
      if (b) bump();
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
  }
  return f;
};

// l'erreur que <@@field> montre pour le champ `name` (`el` : l'élément enveloppé) : celle de l'objet formulaire du propriétaire du champ
// (le composant qui l'entoure de plus près), s'il en a un qui connaît ce nom — jamais celui d'un ancêtre plus haut —, sinon rien (le
// module lit alors `µres.errors`). Son reffet
// tourne hors du rendu, où une lecture de l'état partagé n'abonne personne : le module est posé le temps de la lecture sur la pile des
// composants en cours (mjs_init.ts), il est ainsi relu à chaque changement de l'objet, et désabonné à sa destruction comme pour tout état
// partagé
µ._mjs_formErr = function(el, name) {
  var p = el && el.parentNode;
  var n = _mjsFormOwner(p);
  if (n && n._mjs_formShown) {
    µ._mjs_initStack.push(p);
    try {
      return n._mjs_formShown(name);
    }
    finally {
      µ._mjs_initStack.pop();
    }
  }
};
