// mjs_form_associated — le socle des composants associés au formulaire, écrit UNE seule fois pour tous ceux qui le déclarent (`@formAssociated`,
// directive racine : la case, l'interrupteur, le radio, le nombre, le bouton rotatif, la jauge, la liste et l'éditeur du cœur, un composant de
// l'application). Fichier détecté (clé 'form_associated') : le compilateur écrit `µ._mjs_formClass(` LITTÉRALEMENT, juste avant l'enregistrement
// de la balise d'un composant déclaré — une application sans aucun composant déclaré n'en paie pas un octet
//
// le navigateur voit alors la balise du composant comme un champ de son formulaire (ElementInternals) : `form.elements`, `checkValidity()`,
// `reportValidity()`, `setCustomValidity()` et la bulle de l'envoi, `:invalid` / `:valid`, `<label for>`, `<fieldset disabled>`. La valeur
// envoyée ne passe pas par ici : un module du cœur garde le champ caché posé dans sa balise (une page rendue par le serveur s'envoie sans
// JavaScript) et ne dit donc rien par `setFormValue` — jamais deux fois la même paire. Un navigateur sans `attachInternals`, comme le rendu
// serveur : rien n'est posé, le composant reste ce qu'il était (repli silencieux)

// la classe d'un composant `@formAssociated`, avant son enregistrement (µ._def) : le navigateur lit `formAssociated` et les rappels du
// formulaire (sur le prototype) au moment de `customElements.define`. Posés ici : `internals` (les ElementInternals de l'instance, pris au
// premier usage), ce qu'un champ natif montre à la page (`form`, `validity`, `validationMessage`, `willValidate`, `checkValidity()`,
// `reportValidity()`, `setCustomValidity()`) et l'état désactivé que le navigateur donne au composant (un `<fieldset disabled>` autour de lui,
// son attribut `disabled`), dans `$formDisabled` ; aucun rappel de remise à zéro : celle des modules du cœur passe par µ._mjs_formReset
// (mjs_form_reset.ts), au même moment qu'avant
//
// `disabled="false"` laisse le composant actif : le navigateur tient pour désactivé un élément du formulaire qui porte `disabled`, quelle que
// soit sa valeur — « false » (la casse ne compte pas) est donc ôté de la balise, à la mise à niveau comme posé plus tard, et la prop `disabled`
// passe à faux, comme si l'attribut avait été lu ; `disabled`, `disabled=""`, `disabled="disabled"` et `disabled={$x}` gardent leur sens. Même
// règle pour `required` (« false », toute casse, ôté et tenu pour faux ; toute autre valeur, vide comprise, vraie — la liste, qui le lit à
// l'usage sans le déclarer, ne voit donc jamais « false »), et pour `readonly` chez un composant qui le lit (le navigateur ne valide plus un
// élément qui porte `readonly`). La case, l'interrupteur, le radio, le bouton rotatif et la jauge, qui ne le lisent pas, le gardent (sauf
// « false ») comme leur champ natif : hors de la validation, leur maniement inchangé ; la liste l'ignore comme `<select>` : ôté de sa
// balise, quelle que soit sa valeur, elle reste validée ; un composant de l'application qui ne le lit pas garde la règle du navigateur.
// `disabled`, `readonly` et `required` ôtés par la page rendent fausse la prop qu'ils avaient posée : le module redevient actif, modifiable,
// facultatif, comme le champ natif ; `readonly={…}` lié sur un module du cœur qui ne le lit pas est écrit sur sa balise, comme l'attribut
µ._mjs_formClass = function(C) {
  var P = C.prototype;
  if (typeof HTMLElement === 'undefined' || !HTMLElement.prototype.attachInternals) return;
  C.formAssociated     = true;
  C.observedAttributes = ['disabled', 'readonly', 'required', 'aria-label', 'aria-labelledby'];
  Object.defineProperty(P, 'internals', {
    configurable: true,
    get: function() {
      var i = this.attachInternals();
      Object.defineProperty(this, 'internals', { value: i, configurable: true });
      return i;
    }
  });
  ['form', 'validity', 'validationMessage', 'willValidate'].forEach(function(k) {
    Object.defineProperty(P, k, { configurable: true, get: function() { return this.internals[k]; } });
  });
  P.checkValidity        = function() { return this.internals.checkValidity(); };
  P.reportValidity       = function() { return this.internals.reportValidity(); };
  P.setCustomValidity    = function(msg) {
    var i = this.internals, k, f = {};
    // un composant de l'application dit sa validité lui-même (`internals.setValidity`) : celle qu'il a écrite en dernier est gardée sous le
    // message de la page, reprise chaque fois que `internals` ne porte plus ce message (le composant a écrit depuis, son `customError` compris)
    if (!this._mjs_mod && !(i.validity.customError && i.validationMessage === this._mjs_custom)) {
      for (k in i.validity) if (k !== 'valid' && i.validity[k] === true) f[k] = true;
      this._mjs_v = i.validity.valid ? null : { f: f, m: i.validationMessage || ' ' };
    }
    this._mjs_custom = String(msg);
    _mjsFormPut(this);
  };
  P.formDisabledCallback = function(off) { this._set('formDisabled', off && this.matches(':disabled')); }; // WebKit, à la mise à niveau, dit « désactivé » après le retrait de « false »

  // la prop `label` posée, changée ou ôtée après le montage refait le nom du champ de l'ombre : elle passe devant ses étiquettes, comme un
  // `aria-label` sur un champ natif ; la prop `readonly` d'un module du cœur qui ne la déclare pas (la case, l'interrupteur, le radio, le
  // bouton rotatif, la jauge ; la liste l'ôte) va sur sa balise, comme l'attribut écrit : vraie, le navigateur le sort de la validation ; `null`,
  // `undefined`, `false` ou « false » (toute casse), elle est ôtée ; déjà posé, l'attribut n'est pas réécrit (la lecture des attributs le
  // relit aussitôt en prop, et le réécrire la relancerait sans fin)
  var set = P._set;
  P._set = function(k, v) {
    var r;
    if (k === 'readonly' && this.localName.indexOf('mjs-core-') === 0 && !(this._mjs_var_bits && k in this._mjs_var_bits)) {
      if (v == null || v === false || String(v).toLowerCase() === 'false') this.removeAttribute(k);
      else if (!this.hasAttribute(k)) this.setAttribute(k, '');
      return true;
    }
    r = set.call(this, k, v);
    if (k === 'label' && this._mjs_n) _mjsFormName(this);
    return r;
  };

  // le nom posé sur la balise suit jusqu'au champ de l'ombre ; `readonly` ôté de la liste ; « false » ôté ; `disabled`, `readonly` et `required`
  // ôtés par la page rendent fausse leur prop, que la lecture des attributs ne remet pas
  P.attributeChangedCallback = function(n, was, v) {
    var mine;
    if (n.indexOf('aria-') === 0) {
      _mjsFormName(this);
      return;
    }
    mine = n in this._state;
    if (v === null) {
      if (mine && this._state[n] !== false) this._set(n, false);
      return;
    }
    if (n === 'readonly' && !mine) {
      if (this.localName === 'mjs-core-select') {
        this.removeAttribute(n);
        return;
      }
      if (this.localName.indexOf('mjs-core-') !== 0) return;
    }
    if (v.toLowerCase() !== 'false') return;
    this.removeAttribute(n);
    if (mine && this._state[n] !== false) this._set(n, false); // déjà lu par la prop : « false » la rend fausse, la lecture des attributs ne le verra plus
  };
};

// la validité dite au formulaire : celle du module (`_mjs_v` : ses défauts et son message) et, par-dessus, le message posé par la page
// (`setCustomValidity`, gardé tant qu'il n'est pas remis à '' : un geste du module ne l'efface pas) ; la bulle s'accroche au champ que le module
// a donné (`_mjs_a`). Un composant de l'application qui pose lui-même sa validité retrouve la dernière qu'il a écrite quand le message de la
// page est levé ; posée pendant que ce message tient, elle le remplace. Un composant valide que personne n'a dit invalide ne dit rien au navigateur : le montage de mille cases ne lui écrit rien
function _mjsFormPut(el) {
  var v = el._mjs_v, c = el._mjs_custom, f = {}, k;
  if (!v && !c) {
    if (el._mjs_said) el.internals.setValidity({});
    el._mjs_said = false;
    return;
  }
  if (v) for (k in v.f) f[k] = true;
  if (c) f.customError = true;
  el._mjs_said = true;
  el.internals.setValidity(f, c || v.m, el._mjs_a);
}

// la validité d'un champ du composant, dite au formulaire : `missing` (calculé par le module, d'après son état) le dit manquant ; le message
// est celui que le navigateur donne à la case native de son ombre (obligatoire le temps de le lire), et la bulle s'y accroche — ou à `anchor`,
// un élément de l'ombre, quand le message se lit sur un champ natif jetable (la liste lit celui d'un <select> hors de la page et accroche la
// bulle à son bouton). Sans le socle (navigateur sans attachInternals), rien
µ._mjs_formValid = function(el, input, missing, anchor) {
  var was, msg;
  if (!input || !('internals' in el)) return;
  el._mjs_mod = true;
  el._mjs_a   = anchor || input;
  if (!missing) {
    if (el._mjs_v) { el._mjs_v = null; _mjsFormPut(el); }
    return;
  }
  was = input.required;
  input.required = true;
  msg = input.validationMessage;
  input.required = was;
  el._mjs_v = { f: { valueMissing: true }, m: msg || ' ' };
  _mjsFormPut(el);
};

// la validité d'un champ natif de même sorte, recopiée : `probe`, hors de la page, porte les règles du module (le nombre, celles d'un
// `<input type="number">` : obligatoire, bornes, pas, et sa valeur) ; ses défauts et le message que le navigateur lui donne passent au
// formulaire, la bulle s'accroche à `input`, le champ de l'ombre. Sans `probe` (module désactivé), valide ; sans le socle, rien
µ._mjs_formNative = function(el, input, probe) {
  var v, k, flags = {};
  if (!input || !('internals' in el)) return;
  el._mjs_mod = true;
  el._mjs_a   = input;
  v = probe && probe.validity;
  if (!v || v.valid) {
    if (el._mjs_v) { el._mjs_v = null; _mjsFormPut(el); }
    return;
  }
  for (k in v) if (k !== 'valid' && v[k] === true) flags[k] = true;
  el._mjs_v = { f: flags, m: probe.validationMessage || ' ' };
  _mjsFormPut(el);
};

// une `<label for>` qui vise le composant (comme un `click()` de la page sur sa balise) lui envoie un clic qui ne passe pas par son ombre : il
// va à la case native, comme le clic sur l'étiquette d'une case native ; un clic né dans l'ombre (la case, son libellé) y a déjà fait son effet ;
// `focus` : le champ de l'ombre prend le focus au lieu du clic, comme sous l'étiquette d'un champ nombre ou d'une glissière natifs. Le nom
// de la balise passe au champ de l'ombre (`input`, gardé dans `_mjs_n`), celui que lit un lecteur d'écran
µ._mjs_formLabel = function(el, input, focus) {
  var inner = null;
  if (!input || !('internals' in el)) return;
  if (el._shadow !== el) el._shadow.addEventListener('click', function(e) { inner = e; });
  el.addEventListener('click', function(e) {
    if (e !== inner && e.target === el) input[focus ? 'focus' : 'click']();
  });
  if (!('ariaLabelledByElements' in input)) return;
  el._mjs_n = input;
  _mjsFormName(el);
};

// le nom du champ de l'ombre, cité par lui (`ariaLabelledByElements`, qui suit le texte cité) : le nom que porte la balise, quand elle en
// porte un — les éléments que cite son `aria-labelledby`, ou la balise elle-même pour son `aria-label` —, suivi quand la page le pose, le
// change ou l'ôte (un `<@@field>` autour du module compris), et quand un élément cité paraît après le montage ; sinon ses étiquettes (`<label for>`, `<label>` autour d'elle), cherchées
// seulement pour une balise qui peut en avoir (un `id`, une étiquette autour d'elle), puis celle du champ s'il en a une (le libellé écrit
// dans la case) — rien quand la prop `label` le nomme. `_mjs_l` : ce qui a été cité, pour le retirer quand plus rien ne nomme la balise
function _mjsFormName(el) {
  var input = el._mjs_n, s = el._state, refs = null, wait = false;
  if (!input) return;
  if (el.hasAttribute('aria-labelledby')) {
    refs = el.ariaLabelledByElements;
    wait = el.isConnected && (refs ? refs.length : 0) < el.getAttribute('aria-labelledby').split(/\s+/).filter(Boolean).length;
  }
  else if (el.hasAttribute('aria-label')) refs = [el];
  else if ((el.id || el.closest('label')) && !(s && s.label != null && s.label !== '')) {
    refs = Array.prototype.slice.call(el.internals.labels);
    if (refs.length) refs = refs.concat(Array.prototype.slice.call(input.labels || []));
  }
  if (wait !== !!el._mjs_w) _mjsFormWait(el, wait);
  if (refs || el._mjs_l) input.ariaLabelledByElements = el._mjs_l = refs && refs.length ? refs : null;
}

// un élément cité par `aria-labelledby` qui manque encore (affiché plus tard, dans un {if}) : la racine de la balise est guettée le temps qu'il
// paraisse, comme le fait la liste — tant qu'aucun ne manque, rien n'est guetté ; la balise partie de la page, le guet cesse
function _mjsFormWait(el, on) {
  if (el._mjs_w) el._mjs_w.disconnect();
  el._mjs_w = null;
  if (!on) return;
  el._mjs_w = new MutationObserver(function() { _mjsFormName(el); });
  el._mjs_w.observe(el.getRootNode(), { childList: true, subtree: true });
}

// le champ caché d'un module part avec le formulaire de sa balise : `form="id"`, quand la balise le porte, lui est recopié (un champ natif
// ainsi lié part avec ce formulaire, où qu'il soit dans la page, et `reset()` du formulaire le suit), retiré quand elle ne le porte plus ;
// vaut aussi sans attachInternals (rendu serveur, page envoyée sans JavaScript). Rend le champ
µ._mjs_formField = function(input) {
  var host = input.parentNode, f = host && host.getAttribute ? host.getAttribute('form') : null;
  if (f !== input.getAttribute('form')) {
    if (f === null) input.removeAttribute('form');
    else input.setAttribute('form', f);
  }
  return input;
};
