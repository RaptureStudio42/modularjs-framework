// mjs_i18n — µt / µ.i18n : i18n v1 SANS Proxy. Dictionnaires en objets nus,
// fusion root+fragments PAR LANGUE, registre section→composants, notification
// MANUELLE (`comp._mjs_invalidate('_awaits_')`) — pas de Proxy, pas de dispatch
// fin par clé (simplicité assumée pour cette v1). Module OPTIONNEL (`runtime:
// 'i18n'` dans mjs.config.json), CHARGÉ APRÈS mjs_store_globals.ts (ordre
// canonique géré par le bundler) : langue courante = clé store INTERNE
// CACHÉE `__mjsLang` (non-énumérable, `_storeDeclare(keys, hidden)`), lue/
// écrite en app via la rune dédiée `µlang` (µ.store.__mjsLang, sigils.ts) —
// PAS `$$lang` : la langue est de la CONFIG framework, l'espace `$$`
// applicatif n'a plus de clé réservée (cf. docs/29-i18n.md).
//
// BASCULE (swap atomique SANS placeholder intermédiaire) — une fois le
// site affiché dans une langue, une bascule GARDE l'ancienne langue affichée
// jusqu'à l'arrivée COMPLÈTE de la cible (racine embarquée + toutes les
// sections montées), puis bascule d'un coup (UNE seule vague d'invalidation).
// Jamais d'interface mi-fr mi-en, jamais de placeholder pour un composant
// déjà affiché. Cf. `__i18nEffectiveLang`/le watcher `__mjsLang` plus bas.
//
// Contrat build (posé par le bundler, considéré figé ici) :
//   µ._i18nData = { dev, default, placeholder, [timeout], persist, detect, urlParam, prefix, langs: [...], files: {lang: url} }
// Les DICTIONNAIRES ne sont plus dans le manifeste (servi sur chaque page) : un
// fichier PAR LANGUE (`files[langue]`, module à export par défaut) porte
// `{ root: {…}, sections: {section: nom compact} }`, importé une fois la langue
// DÉCIDÉE puis remis ici par `µ._i18nLang(langue, données)` — même point d'entrée
// pour le rendu serveur, qui sème toutes ses langues sans rien importer.
// L'URL d'un fragment de section se reconstitue `prefix/<langue>/<nom>.json`
// (`__i18nSectionUrl`, formule unique).
// Contrat compilateur : `_mjsThis._mjs_i18n = [section|null, overrideMode|null]` sur les composants concernés, `µt('clé')` →
// `µ.t('section.clé', vars?, mode?)`. Un module à plusieurs sections (`@i18n 'a' 'b'`) y ajoute un 3e élément, la liste des
// sections en plus (`[section, mode, ['b']]`), et un 4e argument à `µ.t`, la liste des mêmes clés dans ces sections
// (`µ.t('a.clé', vars, mode, ['b.clé'])`) ; le bloc « plusieurs sections par module », plus bas, les lit, et n'est au cœur que si un module
// en écrit
//
// 4 attentes possibles pendant le chargement des textes d'un module (`@i18nPlaceholder`, clé `placeholder` du config) :
//   'wait' (défaut) — le PREMIER rendu du composant ATTEND le fragment
//                     (µ.i18n._mjs_i18nMount retourne alors la promesse, que
//                     `µ.i18n._mjs_connect` attend en gelant le composant) : le module reste
//                     caché puis paraît d'un coup, jamais de texte brut ni de barres. Il paraît
//                     TOUJOURS : un échec (404, réseau coupé) lève l'attente comme une arrivée, et ses textes
//                     manquants paraissent en barres (en développement, '⟦clé⟧')
//   'key'           — '⟦clé⟧' TOUJOURS
//   '*skeleton'     — le module est déjà là : '' en prod, '⟦clé⟧' en dev (µ._i18nData.dev), et un
//                     texte en route, ou que l'échec de son chargement laisse sans valeur, prend en prod la place d'une barre grise
//   '*loader'       — comme 'wait', et l'effet *loader est affiché à la place du module le temps de
//                     l'attente (bloc <i18n-loader>, retiré de même)
// Une page prérendue (hôtes `mjs-ssr`) n'est jamais cachée ni habillée d'un indicateur : ses textes sont déjà dans le HTML.
// SECOURS : en 'wait', des textes toujours absents au bout de 3 s (ou de `i18n.timeout`, cf. `__i18nSecours`) (une requête qui ne répond jamais, un manifeste jamais reçu)
// ne laissent pas le module caché pour toujours : il paraît avec les barres de '*skeleton', que les vrais textes remplacent
// à leur arrivée (cf. `__i18nSecours`).
//
// µ._i18nData ABSENT (build sans i18n, test isolé) : on retombe sur un objet
// par défaut inerte (root/sections vides) — MÊME code de résolution, aucune
// branche dupliquée : toute clé rend simplement son placeholder, jamais de
// crash.
// BUG D'INTÉGRATION — objet de fallback GARDÉ EN RÉFÉRENCE (`__i18nInertFallback`) :
// sert à détecter, PLUS TARD (cf. `__i18nBoot` en bas de fichier), si `µ._i18nData`
// a fini par être REMPLACÉ par le manifest (comparaison `!==`, pas juste `!!`
// truthy — un simple flag figé au chargement du module ne suffit pas, cf. plus bas).
var __i18nInertFallback = { dev: false, default: null, placeholder: 'wait', prefix: '', langs: [], files: {} };
var __i18nReal = !!µ._i18nData;
if (!µ._i18nData) {
  µ._i18nData = __i18nInertFallback;
}

// Langues RÉELLEMENT chargées : `{langue: {root: {…}, sections: {section: nom}}}`.
// Peuplé par `µ._i18nLang` — soit depuis le fichier de langue importé par
// `__i18nLoadLang` (navigateur), soit semé en bloc par le rendu serveur avant le
// démarrage. Une langue absente d'ici n'a simplement aucun texte : toute clé
// retombe sur le placeholder ou sur la langue par défaut, jamais d'exception.
if (!µ._i18nLangs) { µ._i18nLangs = {}; }

// Chargements EN ÉCHEC (404, réseau coupé, JSON illisible), `{langue: true}` pour le fichier d'une langue et `{'langue/section': true}` pour le
// fragment d'une section : un texte que l'échec laisse sans valeur paraît en barres (`__i18nEnEchec`), jamais en vide. La marque tombe quand le
// chargement aboutit (un montage qui redemande le fragment, `µ._i18nLang` qui reçoit la langue).
var __i18nEchecs = Object.create(null);

// Point d'entrée des données d'une langue (fichier de langue, rendu serveur).
// Rejouable : un second appel remplace la table (HMR, test qui ré-évalue).
µ._i18nLang = function(lang, data) {
  if (!lang) { return; }
  delete __i18nEchecs[lang];
  µ._i18nLangs[lang] = { root: (data && data.root) || {}, sections: (data && data.sections) || {} };
  __i18nMergeRootIntoExistingDicts();  // dict déjà créé (graine ssr, langue rechargée) : backfill
};

// l'entrée propre d'une langue chargée, null sinon : une langue inconnue, choisie par la donnée, n'est jamais lue sur un
// prototype pollué — elle suit le chemin d'une langue absente
function __i18nLangOf(lang) {
  return lang && Object.prototype.hasOwnProperty.call(µ._i18nLangs, lang) ? µ._i18nLangs[lang] : null;
}
function __i18nRootOf(lang) {
  var e = __i18nLangOf(lang);
  return e ? e.root : null;
}
function __i18nSectionsOf(lang) {
  var e = __i18nLangOf(lang);
  return e ? e.sections : null;
}
// nom compact du fragment d'une section dans une table de sections, `undefined` si la table ne la porte pas : le
// premier mot d'une clé peut être n'importe quoi (`µt(donnéeVenueDuDehors)`), et `toString`, `constructor`,
// `__proto__` ne sont pas des sections — `sections[nom]` rendrait la méthode héritée d'Object
function __i18nSectionName(sections, section) {
  return sections && Object.prototype.hasOwnProperty.call(sections, section) ? sections[section] : undefined;
}
// URL d'un fragment de section — SEUL endroit qui connaisse la formule (miroir de
// `scanI18n`, bundler/index.ts) : la table ne porte que le nom compact du fragment
// (hash en prod, nom clair en dév), le préfixe est publié une fois au manifeste.
function __i18nSectionUrl(lang, nom) {
  return µ._i18nData.prefix + '/' + lang + '/' + nom + '.json';
}
// Langue SÉLECTIONNABLE ? (`?lang=`, localStorage, navigateur) — `langs` remplace ici
// l'ancien test sur `root` : les dictionnaires ne sont plus là pour répondre.
function __i18nKnownLang(code) {
  var langs = µ._i18nData.langs;
  return !!code && !!langs && langs.indexOf(code) !== -1;
}

// DÉPART DE PAGE — un fetch en vol est annulé par le NAVIGATEUR quand la page
// s'en va (rechargement, lien sortant) : la promesse rejette avec un TypeError
// générique (« Failed to fetch »), rigoureusement indistinguable d'une vraie
// panne réseau. Ce drapeau porte la distinction que l'erreur ne porte pas —
// même parti pris que mjs_ajax.ts, où un abandon VOULU est un chemin
// SILENCIEUX (`options.signal`, l.220). Tant qu'on est SUR la page, un échec
// reste crié : seul le départ fait taire.
var __i18nLeaving = false;
if (!µ._isServer && typeof addEventListener === 'function') {
  addEventListener('pagehide', function() { __i18nLeaving = true; });
}

// Dictionnaires fusionnés PAR LANGUE : `root[lang]` (embarqué au build) +
// fragments de section montés sous leur clé (`d.panier = {…}`), au fil des
// résolutions de `_ensure`. Objets nus, mutés en place, zéro Proxy.
// table SANS prototype : une langue n'y trouve que son dict — un nom hérité (`toString`, `valueOf`…) venu d'une graine écrite
// à la main n'atteint aucune fonction d'Object.prototype, et `__proto__` y est un nom comme un autre, sans contrôle à chaque traduction
if (!µ._i18nDict) { µ._i18nDict = Object.create(null); }
// une donnée du dictionnaire recopiée en tables SANS prototype, à tous les niveaux, une fois à son arrivée (racine de la
// langue, fragment de section, graine du serveur) : un chemin ne descend que dans les clés du dictionnaire —
// `constructor.name`, `toString.name` n'y trouvent rien, sans contrôle à chaque traduction. Une liste reste une liste
function __i18nNu(v) {
  var r, k, i;
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    r = [];
    for (i = 0; i < v.length; i++) r.push(__i18nNu(v[i]));
    return r;
  }
  r = Object.create(null);
  for (k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) r[k] = __i18nNu(v[k]); }
  return r;
}
µ._mjs_i18nDictOf = function(lang) {
  var d = µ._i18nDict[lang];
  if (!d) {
    d = Object.create(null);
    var r = __i18nRootOf(lang);
    if (r) {
      for (var k in r) { if (Object.prototype.hasOwnProperty.call(r, k)) d[k] = __i18nNu(r[k]); }
    }
    µ._i18nDict[lang] = d;
  }
  return d;
};

// BUG D'INTÉGRATION (prouvé Chromium sur la page `/` fr) — backfill racine :
// un dict déjà créé par la graine SSR (`#__mjs_i18n`, lue plus bas AU CHARGEMENT du module,
// donc AVANT que le manifest ne pose `µ._i18nData` réel — même ordre que le bug ci-dessus)
// ne reçoit JAMAIS sa racine : `_mjs_i18nDictOf` ne la fusionne qu'À LA CRÉATION du dict, et à cet
// instant `µ._i18nData.root[lang]` est encore `{}` (`__i18nInertFallback`). Rejoué au boot
// (cf. `__i18nBoot`), une fois `µ._i18nData.root` réel — sans écraser une clé DÉJÀ semée
// (`hasOwnProperty` sur `d`, jamais sur `r`) ; idempotent, un second appel ne fusionne plus rien.
// La graine ne porte que les clés racine LUES par la page, en arbre partiel (`landing: {haut}` sans `landing.bas`) :
// le remplissage descend donc dans un nœud déjà présent des deux côtés pour y ajouter ce qui manque
function __i18nFill(d, r) {
  for (var k in r) {
    if (!Object.prototype.hasOwnProperty.call(r, k) || k === '__proto__') continue;
    if (!Object.prototype.hasOwnProperty.call(d, k)) { d[k] = __i18nNu(r[k]); }
    else if (d[k] && r[k] && typeof d[k] === 'object' && typeof r[k] === 'object' && !Array.isArray(d[k]) && !Array.isArray(r[k])) { __i18nFill(d[k], r[k]); }
  }
}
function __i18nMergeRootIntoExistingDicts() {
  for (var lang in µ._i18nDict) {
    if (!Object.prototype.hasOwnProperty.call(µ._i18nDict, lang)) continue;
    var d = µ._i18nDict[lang];
    var r = __i18nRootOf(lang);
    if (!r) continue;
    __i18nFill(d, r);
  }
}

// Résolution d'un chemin `a.b.c` dans le dict de LA langue donnée.
// `undefined` si un segment intermédiaire manque (jamais de throw). Le chemin suit JavaScript (`constructor.name` rend
// « Object », comme `dict.constructor.name`), sauf qu'une chaîne n'a pas de clés (`titre.0` ne rend pas sa première lettre)
function __i18nResolve(lang, cle) {
  var node = µ._mjs_i18nDictOf(lang);
  var parts = cle.split('.');
  for (var i = 0; i < parts.length && node != null; i++) {
    node = typeof node === 'string' ? undefined : node[parts[i]];
  }
  return node;
}

// Mode EFFECTIF d'un module : son override `@i18nPlaceholder`, sinon la clé
// `placeholder` du config, sinon 'wait'. UNE seule définition — le rendu du
// placeholder ET le différé du 1er rendu doivent lire la même chose : tant que
// `_mjs_mountReal` ne consultait que l'override, un config à `"placeholder": "wait"`
// ne différait RIEN (mesuré : flash de ⟦tuto.chap_…⟧ pendant
// ~60 ms), alors que la doc annonce l'inverse.
function __i18nMode(modeOverride) {
  return modeOverride || µ._i18nData.placeholder || 'wait';
}
// le premier rendu attend-il le fragment ? 'wait', et '*loader' qui montre un indicateur pendant ce temps
function __i18nWaits(mode) {
  return mode === 'wait' || mode === '*loader';
}

// Placeholder selon le mode EFFECTIF : 'key' → toujours visible, les autres → visible en dev SEULEMENT
// (µ._i18nData.dev) ; en prod, une barre grise prend la place d'un texte EN ROUTE sous '*skeleton' (sa langue ou sa section en cours de
// chargement), et d'un texte que l'ÉCHEC de son chargement laisse sans valeur sous 'wait', '*skeleton' et '*loader' ; une clé absente pour de bon, rien.
function __i18nPlaceholder(cle, modeOverride, lang) {
  var mode = __i18nMode(modeOverride);
  if (mode === 'key') return '⟦' + cle + '⟧';
  if (µ._i18nData.dev) return '⟦' + cle + '⟧';
  // un module sauvé après 3 s d'attente (cf. `__i18nSecours`) : des barres à la place de tout ce qui manque encore ; de même pour un texte que l'échec
  // de son chargement a laissé sans valeur
  var secours = mode === 'wait' && µ.activeComponent && µ.activeComponent._mjs_i18nRescue;
  if (secours || (mode === '*skeleton' && __i18nEnRoute(lang, cle)) || __i18nEnEchec(lang, cle)) {
    __i18nSkelLater();
    return __i18nSkel;
  }
  return '';
}

// SQUELETTE DES TEXTES EN ROUTE (`*skeleton`) — douze espaces de chiffre (U+2007) à la place du texte, qu'un
// surlignage CSS (Custom Highlight API, `mjs-i18n-skel`) peint en gris dans chaque composant qui
// en affiche ; repeint tant qu'il en reste (un texte arrivé remplace ses espaces : sa barre part).
// Sans cette API, les espaces seuls — la place gardée, comme le vide d'avant. Le seul réglage de *skeleton qui a un
// sens pour ces barres est `color` (un surlignage ne scintille ni ne s'arrondit) : celui du module, sinon celui du config.
var __i18nSkel = '\u2007\u2007\u2007\u2007\u2007\u2007\u2007\u2007\u2007\u2007\u2007\u2007';
// la couleur des barres d'un composant ('' : le gris d'avant)
function __i18nSkelColor(comp) {
  var info = comp && comp._mjs_i18n;
  var s = info && info[1] ? (info[1] === '*skeleton' ? info[3] : null) : (µ._i18nData.placeholder === '*skeleton' ? µ._i18nData.fx : null);
  return (s && s.color) || '';
}
// un texte en route : avant le démarrage (le fichier de la langue pas encore arrivé, tout texte
// l'est), la langue elle-même en chargement, ou la section de la clé (son premier segment) dont le
// fragment n'est pas encore arrivé
function __i18nEnRoute(lang, cle) {
  if (µ._i18nData === __i18nInertFallback) return false;
  if (!µ._mjs_i18nBooted) return true;
  if (!lang) return false;
  if (__i18nLangPromises[lang] && !__i18nLangReady(lang)) return true;
  var entry = µ._i18nCache.get(lang + '/' + String(cle).split('.')[0]);
  return !!(entry && entry.data == null);
}
// quelque chose est-il encore en route (langue, fragment) ? Sinon, une barre qui reste est un texte
// figé trop tôt (µt dans un <script>, gardé dans une variable) : plus rien ne la remplacera
function __i18nRienEnRoute() {
  if (µ._i18nData === __i18nInertFallback) return true;
  if (!µ._mjs_i18nBooted) return false;
  for (var l in __i18nLangPromises) { if (!__i18nLangReady(l)) return false; }
  var vide = true;
  µ._i18nCache.forEach(function(e) { if (e.data == null) vide = false; });
  return vide;
}
// un texte que l'échec d'un chargement laisse sans valeur : le fichier de sa langue, ou le fragment de sa section, a échoué — dans la langue affichée ou
// dans la langue par défaut, qui porte les replis (un repli qui n'a pas pu venir laisse le texte manquant tout autant)
function __i18nEnEchec(lang, cle) {
  var section = String(cle).split('.')[0];
  var langues = [lang, µ._i18nData.default];
  for (var i = 0; i < langues.length; i++) {
    var l = langues[i];
    if (l && (__i18nEchecs[l] || __i18nEchecs[l + '/' + section])) return true;
  }
  return false;
}
// un chargement est-il en échec, quel qu'il soit ?
function __i18nUnEchec() {
  for (var k in __i18nEchecs) { if (Object.prototype.hasOwnProperty.call(__i18nEchecs, k)) return true; }
  return false;
}
var __i18nSkelTimer = 0;
var __i18nSkelRoots = typeof WeakMap === 'function' ? new WeakMap() : null;
var __i18nSkelSheets = {};
// la feuille qui peint les barres d'une couleur ('' : le gris d'avant)
function __i18nSkelSheet(couleur) {
  var f = __i18nSkelSheets[couleur];
  if (!f) {
    f = __i18nSkelSheets[couleur] = new CSSStyleSheet();
    f.replaceSync('::highlight(mjs-i18n-skel){background-color:' + (couleur || 'rgba(127,127,127,.28)') + ';color:transparent}');
    f._mjs_keep = true;
  }
  return f;
}
function __i18nSkelLater() {
  if (__i18nSkelTimer || typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return;
  __i18nSkelTimer = setTimeout(__i18nSkelPaint, 0);
}
function __i18nSkelPaint() {
  __i18nSkelTimer = 0;
  var h = new window.Highlight();
  var racines = [document];
  var couleurs = [__i18nSkelColor(null)];
  var vus = [];
  var ajoute = function(c) { if (c && vus.indexOf(c) < 0) { vus.push(c); var r = c._shadow || c.shadowRoot; if (r) { racines.push(r); couleurs.push(__i18nSkelColor(c)); } } };
  if (µ._mjs_i18nComps) µ._mjs_i18nComps.forEach(ajoute);
  µ._mjs_i18nSectionComps.forEach(function(set) { set.forEach(ajoute); });
  if (µ._mjs_i18nPendingMounts) µ._mjs_i18nPendingMounts.forEach(ajoute);
  for (var i = 0; i < racines.length; i++) {
    var r = racines[i];
    var w = document.createTreeWalker(r, 4);
    var peint = false;
    for (var t = w.nextNode(); t; t = w.nextNode()) {
      var k = t.data.indexOf(__i18nSkel);
      if (k < 0) continue;
      var rg = new Range();
      rg.setStart(t, k);
      rg.setEnd(t, k + __i18nSkel.length);
      h.add(rg);
      peint = true;
    }
    if (peint && __i18nSkelRoots && r.adoptedStyleSheets && !__i18nSkelRoots.has(r)) {
      __i18nSkelRoots.set(r, couleurs[i]);
      r.adoptedStyleSheets = r.adoptedStyleSheets.concat([__i18nSkelSheet(couleurs[i])]);
    }
  }
  // peintes et repeintes toutes les 400 ms tant que quelque chose est en route (un texte arrivé remplace ses espaces : sa barre part) ; celles d'un
  // chargement en échec restent peintes sans minuterie, plus rien n'arrivera : chaque rendu qui en pose de nouvelles (`__i18nSkelLater`) les repeint
  var enRoute = !__i18nRienEnRoute();
  if (h.size > 0 && (enRoute || __i18nUnEchec())) {
    CSS.highlights.set('mjs-i18n-skel', h);
    if (enRoute) { __i18nSkelTimer = setTimeout(__i18nSkelPaint, 400); }
  }
  else CSS.highlights.delete('mjs-i18n-skel');
}

// SECOURS DE L'ATTENTE — la limite de `wait` : au bout de 3 s (ou de `µ._i18nData.timeout`, `i18n.timeout`) sans leurs textes (une requête qui ne répond jamais, un manifeste jamais
// reçu), le module gelé paraît quand même, rendu avec les barres de `*skeleton` à la place de ce qui manque ; son attente n'est pas
// annulée, les vrais textes le remplacent à leur arrivée. Une minuterie par module, défaite dès que les
// textes arrivent (ou que le module part) : rien ne reste armé. Ni sur le serveur ni sur un hôte prérendu (`mjs-ssr`, ses textes sont
// déjà là) ; `*loader` n'en a pas besoin, son indicateur reste visible. Le mode est jugé à l'échéance : avant le démarrage, le config
// n'est pas toujours connu
var __I18N_SECOURS = 3000;
function __i18nDelai() { return µ._i18nData.timeout != null ? µ._i18nData.timeout : __I18N_SECOURS; }
function __i18nSecours(comp) {
  comp._mjs_i18nTimer = 0;
  if (!comp._mjs_i18n_hold || !comp._mjs_is_mounted || comp._mjs_dead || __i18nMode(comp._mjs_i18n[1]) !== 'wait') return;
  comp._mjs_i18nRescue = true;
  comp._mjs_i18n_hold = false;
  if (µ._i18nData.dev) { µ.warn(µ._mjs_msg('i18nSecours', { ms: __i18nDelai() }, 'i18n : textes toujours absents après {ms} ms — le module paraît avec ⟦clé⟧ à la place de chaque texte absent, les textes les remplaceront à leur arrivée')); }
  comp._mjs_invalidate('_awaits_');
  // la retenue de `mjs-loading` ne tombe plus avec l'attente : après le rendu qui vient d'être planifié, comme `_dropLoading`
  queueMicrotask(function() { comp.removeAttribute('mjs-loading'); });
}

// <i18n-loader>
// L'ATTENTE `*loader` — l'effet « chargement » (mjs_fx_loader.ts) affiché À LA PLACE du module le temps que ses textes arrivent :
// le module, lui, reste caché comme en `wait` (son premier rendu est gelé et sa balise garde `mjs-loading` : le gabarit brut ne se
// peint jamais), et une balise `<span mjs-i18n-loader>` posée juste avant lui porte l'effet. Elle part à l'instant où le gel se
// lève, avant le premier rendu, ou si le module quitte la page. Rien sur le serveur, ni sur un hôte de page prérendue (`mjs-ssr` :
// ses textes sont déjà là). Les réglages sont ceux du module (`_mjs_i18n[3]`), sinon ceux du config (`µ._i18nData.fx`)
function __i18nLoaderOf(comp) {
  var info = comp._mjs_i18n;
  var own = info && info[1];
  if (own ? own !== '*loader' : µ._i18nData.placeholder !== '*loader') return null;
  return own ? (info[3] || {}) : (µ._i18nData.fx || {});
}
function __i18nLoaderOn(comp) {
  var s = __i18nLoaderOf(comp);
  var parent = comp.parentNode;
  if (!s || !parent || comp._mjs_i18nLoader || µ.server || µ._isServer || comp.hasAttribute('mjs-ssr') || typeof µ._mjs_fx !== 'function') return;
  var place = document.createElement('span');
  place.setAttribute('mjs-i18n-loader', '');
  parent.insertBefore(place, comp);
  // le composant qui porte la balise est celui dont l'ombre contient le module (aucun, au niveau du document)
  var off = µ._mjs_fx(comp.getRootNode().host || null, place, 'loader', s);
  comp._mjs_i18nLoader = function() { off(); place.remove(); };
}
function __i18nLoaderOff(comp) {
  var off = comp._mjs_i18nLoader;
  if (!off) return;
  comp._mjs_i18nLoader = null;
  off();
}
// </i18n-loader>

// Langue ACTUELLEMENT AFFICHÉE — distincte de `µ._mjs_storeRaw.__mjsLang`
// pendant une bascule en vol : mise à jour SEULEMENT au swap atomique (jamais
// à la mutation brute de la clé store, cf. le watcher plus bas). Posée au
// boot (`__i18nBoot`).
var __i18nDisplayedLang;

// LANGUE PROVISOIRE, AVANT LE DÉMARRAGE — la graine du rendu serveur porte la langue du rendu (`seed.lang`)
// et les sections qu'il a lues, avec les textes racine qu'il a lus : un composant dont les textes sont tous dans la
// graine peut se rendre tout de suite, sans attendre le fichier de langue (qui n'apporte que la racine entière et la
// table des fragments). La langue provisoire est TOUJOURS celle de la graine : tout ce qui se rend avant le démarrage l'est
// dans la langue du serveur, aucun texte ne disparaît. Si la langue voulue est autre (`?lang=`, préférence mémorisée), la page
// garde celle du serveur jusqu'à ce que les textes voulus soient là, puis passe d'un coup (la bascule du démarrage, cf. `__i18nBoot`).
// Un texte qui manque pendant cette période (clé racine, section absente de la graine) marque le composant
// qui le lit (`_mjs_i18nRedo`, ou `__i18nRedoAll` quand aucun composant n'est actif) : le démarrage le
// rend une seconde fois ; les autres ne sont pas touchés par l'arrivée du fichier de langue.
var __i18nProvLang = null;
var __i18nRedoAll = false;
function __i18nProvDecide() {
  if (__i18nProvLang || !__i18nSeedLang || µ._i18nData === __i18nInertFallback) return;
  __i18nProvLang = __i18nSeedLang;
}
// la bascule du démarrage : l'indicateur « la prochaine bascule de `__mjsLang` est celle du démarrage » (cf. `__i18nBoot`) et les modules gelés que cette bascule relâche à sa fin
var __i18nDemarrage = false;
var __i18nApres = [];
// les noms des sections de la graine, ce que le serveur a lu (qu'un module déclare la section ou non) : la bascule du démarrage les assure toutes dans la langue voulue
var __i18nSeedNoms = [];
// l'attente d'un fragment qu'un échec (déjà signalé) ne fait pas rejeter : la bascule du démarrage les attend tous
function __i18nSansEchec(p) { return p.then(null, function() {}); }

// `µ.i18n._ensure` en vol suite à une bascule NON encore résolue : tant que
// `true`, toute résolution (µ.t/__i18nResolve) reste sur `µ._mjs_i18nPrevLang`
// (l'ancienne langue affichée) — jamais un mélange, jamais un placeholder
// pour un composant déjà rendu. `_i18nSwapGen` : jeton de génération
// incrémenté à CHAQUE bascule (fr→en→fr rapide : seule la dernière gagne, cf.
// le watcher plus bas).
µ._mjs_i18nSwapPending = false;
µ._mjs_i18nPrevLang = null;
var __i18nSwapGen = 0;

// Langue EFFECTIVE pour toute résolution (`µ.t`) : la précédente pendant une
// bascule en vol, sinon celle réellement affichée.
function __i18nEffectiveLang() {
  if (µ._mjs_i18nSwapPending) return µ._mjs_i18nPrevLang;
  return __i18nDisplayedLang || (µ._mjs_i18nBooted ? undefined : __i18nProvLang);
}
// exposée pour µ._mjs_label, mjs_init.ts
µ._mjs_i18nEffectiveLang = __i18nEffectiveLang;

// dictionnaire du PROJET pour les libellés du RUNTIME (mjs_init.ts, µ._mjs_label) :
// clés racine réservées `mjs.<groupe>.<clé>` (`mjs.toast.success`, `mjs.modal.cancel`…), lues AVANT
// la table fr/en de src/runtime-labels.ts — un projet en allemand/espagnol, ou qui veut juste changer
// un mot, les surcharge sans toucher runtime-labels.ts. Langue DEMANDÉE (`µ._mjs_storeRaw.__mjsLang`) EN
// PREMIER — PAS la langue effective (en retard tant qu'un swap est en vol) : un clic « EN » doit
// changer le libellé dans le MÊME TICK, avant même que ce module n'ait fini d'assurer les fragments
// de la langue cible. AUCUN repli inter-langue sur une clé absente
// (contrairement à `µ.t`) : une langue demandée sans surcharge pour CETTE clé précise rend `undefined`
// tel quel — c'est `µ._mjs_label` qui prend alors le relais sur la table du framework (prouvé
// tests/runtime-labels-surcharge-projet.test.ts : une bascule vers l'anglais SANS override anglais ne
// doit surtout pas hériter de l'override français du projet). Jamais de placeholder, jamais de warn,
// jamais de throw — y compris quand `µ._i18nData` est le repli inerte ou quand `µ._mjs_storeRaw` n'existe
// pas (module vault absent du build).
µ._mjs_i18nLookup = function(cle) {
  var lang = (µ._mjs_storeRaw && µ._mjs_storeRaw.__mjsLang) || __i18nEffectiveLang() || µ._i18nData.default;
  if (!lang) { return undefined; }
  var node = __i18nResolve(lang, cle);
  return typeof node === 'string' ? node : undefined;
};

// Pluriel CLDR — cache par langue, repli binaire si absent.
var __i18nPluralRulesCache = {};
function __i18nPluralRulesFor(lang) {
  if (Object.prototype.hasOwnProperty.call(__i18nPluralRulesCache, lang)) { return __i18nPluralRulesCache[lang]; }
  var r = null;
  if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function') {
    try { r = new Intl.PluralRules(lang); } catch (e) { r = null; }
  }
  __i18nPluralRulesCache[lang] = r;
  return r;
}

// rendu serveur (`µ._i18nTrackRoot`, posé par les deux moteurs) : note les clés RACINE lues, celles dont le premier mot n'est pas une
// section, `{langue: {clé: true}}` ; la graine les transmet au navigateur, qui n'attend plus le fichier de langue pour elles
function __i18nNoteRoot(lang, cle) {
  if (__i18nSectionName(__i18nSectionsOf(lang), cle.split('.')[0]) !== undefined) { return; }
  var u = µ._i18nUsedRoot || (µ._i18nUsedRoot = {});
  (u[lang] || (u[lang] = {}))[cle] = true;
}
// les sections d'un module : la sienne (avec `@i18n 'a' 'b'`, les autres aussi : le bloc des plusieurs sections par module remplace cette fonction,
// d'où une variable et non une déclaration de fonction)
var __i18nSections = function(comp) { return [comp._mjs_i18n[0]]; };
// la graine porte-t-elle ce fragment (semé par le rendu serveur, ou servi en repli sous une autre langue) ?
function __i18nDansGraine(lang, section) {
  var e = lang && µ._i18nCache.get(lang + '/' + section);
  return !!e && e.data != null;
}
// composant créé avant le démarrage par le rendu d'un hôte de page prérendue (`mjs-ssr`), à quelque profondeur : la vue neuve remplace la photo du serveur, ses balises
// n'ont plus l'attribut, mais la graine porte déjà leurs textes (ceux que le serveur a lus) ; il se rend aussitôt comme son hôte, sans attendre le fichier de langue.
// Seulement si ses sections y sont toutes : un module que le serveur n'a pas rendu (dans le slot de l'hôte, créé plus tard) et dont une section n'est pas lue suit
// le chemin de son réglage, `wait` le garde caché jusqu'à ses textes ; une clé racine absente de la graine, elle, se relit au démarrage (`_mjs_i18nRedo`)
function __i18nSousHote(comp) {
  var noms = __i18nSections(comp);
  for (var i = 0; i < noms.length; i++) {
    if (noms[i] && !__i18nDansGraine(__i18nSeedLang, noms[i]) && !__i18nDansGraine(µ._i18nData.default, noms[i])) { return false; }
  }
  for (var n = comp.parentNode; n; n = n.parentNode || n.host) {
    if (n.hasAttribute && n.hasAttribute('mjs-ssr')) { return true; }
  }
  return false;
}

// `µ.t('panier.clé', {n: 3}, 'wait')` — clés DÉJÀ préfixées/résolues par le
// compilateur. Pluriel CLDR (`Intl.PluralRules`) : un nœud
// objet {one, other, …} se départage par `vars.n` selon les catégories
// COMPLÈTES de la langue (`one`/`few`/`many`/`other`, pas SEULEMENT `one` si
// `n === 1`), `other` si `n` absent/non numérique. Repli de langue — clé
// absente dans la langue courante mais présente dans le défaut
// (`µ._i18nData.default`) : la chaîne ET la catégorie de pluriel viennent
// alors de cette langue de RÉSOLUTION (`resolvedLang`), jamais de la langue
// demandée si elles diffèrent. Interpolation `%{var}` (y compris `%{n}`)
// depuis `vars`. Toute résolution qui n'aboutit pas à une chaîne (objet sans
// one/other, undefined) rend le placeholder. Lecture de la langue EFFECTIVE
// (`__i18nEffectiveLang`, jamais la brute pendant une bascule en vol) —
// la réactivité passe par le registre (`_mjs_invalidate`), pas par un abonnement
// store de l'appelant.
// clé `zero` explicite prioritaire à n=0 si présente dans le dictionnaire
µ.t = function(cle, vars, modeOverride) {
  var lang = __i18nEffectiveLang();
  var node = __i18nResolve(lang, cle);
  var resolvedLang = lang;
  var fellBack = false;
  // clé d'une section que rien n'a encore demandée : demandée ici (cf. __i18nAskSection) — arrivée
  // aussitôt (lecture disque du rendu serveur), elle se relit dans le même appel
  if (node == null && __i18nAskSection(lang, cle)) { node = __i18nResolve(lang, cle); }
  if (node == null && µ._i18nData.default && lang !== µ._i18nData.default) {
    node = __i18nResolve(µ._i18nData.default, cle);
    fellBack = node != null;
    if (fellBack) { resolvedLang = µ._i18nData.default; }
  }
  if (node != null && typeof node === 'object' && !Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, 'other')) {
    var n = vars ? vars.n : undefined;
    var cat = 'other';
    if (typeof n === 'number') {
      var rules = __i18nPluralRulesFor(resolvedLang);
      cat = rules ? rules.select(n) : (n === 1 ? 'one' : 'other');
      if (n === 0 && Object.prototype.hasOwnProperty.call(node, 'zero')) { cat = 'zero'; } // clé zero explicite façon Rails — prioritaire sur la catégorie CLDR à n=0
      if (!Object.prototype.hasOwnProperty.call(node, cat)) { cat = 'other'; }
    }
    node = node[cat];
  }
  if (typeof node !== 'string') {
    if (__i18nProvLang && !µ._mjs_i18nBooted) {
      var __c = µ.activeComponent;
      if (__c) { __c._mjs_i18nRedo = true; }
      else { __i18nRedoAll = true; }
    }
    return __i18nPlaceholder(cle, modeOverride, lang);
  }
  if (µ._i18nTrackRoot) { __i18nNoteRoot(resolvedLang, cle); }
  if (fellBack && µ._i18nData.dev) {
    var __k = lang + '|' + cle;
    if (!__i18nFallbackWarned.has(__k)) { __i18nFallbackWarned.add(__k); µ.warn(µ._mjs_msg('i18nMissing', { key: cle, lang: lang, def: µ._i18nData.default }, 'i18n : clé « {key} » absente en « {lang} », repli sur « {def} »')); }
  }
  if (vars) {
    node = node.replace(/%\{(\w+)\}/g, function(m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m;
    });
  }
  return node;
};

// Registre section→composants (`Map<section, Set<comp>>`), composants i18n
// SANS distinction de section (notifiés en bloc à chaque bascule de langue —
// leurs clés racine changent immédiatement), et cache-singleton des fragments
// en vol/résolus (`Map<'lang/section', {promise, data}>`) — une SEULE requête
// par (langue, section) même si N modules la demandent.
if (!µ._mjs_i18nSectionComps) { µ._mjs_i18nSectionComps = new Map(); }
if (!µ._mjs_i18nComps) { µ._mjs_i18nComps = new Set(); }
if (!µ._i18nCache) { µ._i18nCache = new Map(); }
// file d'attente des composants montés AVANT que
// `__i18nBoot()` n'ait tourné (cf. `_mjs_i18nMount`/`__i18nBoot` plus bas).
if (!µ._mjs_i18nPendingMounts) { µ._mjs_i18nPendingMounts = new Set(); }

// graine ssr : sème dans la page les sections i18n consultées au rendu (balise `#__mjs_i18n`, même canal que `#__mjs_store`, cf mjs_store_globals.ts)
// relue ici au boot, avant tout montage (aucun composant abonné) : reproduit le chemin de succès du fetch de `_ensure` plus bas (cache + dict), sans notifier
// amorce best-effort : une graine absente ou malformée n'interrompt jamais le boot ; l'élément n'est jamais retiré du dom (inerte une fois lu)
// CORRECTIF — `sections` est désormais indexée PAR LANGUE puis par section
// (`{lang:{section:…}}`) : une section servie en REPLI (langue par défaut, traduction manquante
// dans la langue affichée) sort sous la clé de SA propre langue, pas sous `__i18nSeed.lang` (la
// langue affichée) — sans ce double niveau, `_ensure(defLang, section)` (repli, cf. plus bas) ne
// retrouvait jamais son entrée dans la graine et refetchait ce que le serveur avait déjà résolu.
// UNE fonction pour les deux moments : le démarrage (document de la page) et chaque échange de page
// par un lien interne (document REÇU, cf. `µ._mjs_navI18nSeed`) — sans quoi les sections de la page
// d'arrivée, déjà dans son HTML, étaient redemandées une à une par requête. Une entrée DÉJÀ au cache
// n'est jamais remplacée : sa donnée (ou la requête en vol qui la portera) sert déjà des composants
// affichés, et une graine d'un autre déploiement (onglet resté ouvert) ne doit pas mêler deux
// versions de textes dans une même session. Une section se range sous SA langue : la graine d'une
// langue autre que l'affichée n'entre jamais dans le cache de la langue affichée. Noms de langue ou de
// section du prototype, donnée qui n'est pas un objet : ignorés (le cache ne sert que des objets).
function __i18nSeedFrom(doc) {
  try {
    var el = doc && doc.getElementById && doc.getElementById('__mjs_i18n');
    if (!el) return;
    var seed = JSON.parse(el.textContent);
    if (!seed || typeof seed.lang !== 'string' || !seed.sections || typeof seed.sections !== 'object') return null;
    var interdit = ['__proto__', 'constructor', 'prototype'];
    for (var lang in seed.sections) {
      if (!Object.prototype.hasOwnProperty.call(seed.sections, lang) || interdit.indexOf(lang) !== -1) continue;
      var parLangue = seed.sections[lang];
      if (!parLangue || typeof parLangue !== 'object') continue;
      for (var section in parLangue) {
        if (!Object.prototype.hasOwnProperty.call(parLangue, section) || interdit.indexOf(section) !== -1) continue;
        var data = parLangue[section];
        var cle = lang + '/' + section;
        if (!data || typeof data !== 'object' || Array.isArray(data) || µ._i18nCache.has(cle)) continue;
        data = __i18nNu(data);
        µ._i18nCache.set(cle, { promise: Promise.resolve(data), data: data });
        µ._mjs_i18nDictOf(lang)[section] = data;
        if (__i18nSeedNoms.indexOf(section) === -1) { __i18nSeedNoms.push(section); }
      }
    }
    // clés racine lues par la page (arbre partiel par langue) : rangées dans le dictionnaire de leur langue, sans remplacer l'existant
    var racine = seed.root;
    if (racine && typeof racine === 'object') {
      for (var rl in racine) {
        if (Object.prototype.hasOwnProperty.call(racine, rl) && interdit.indexOf(rl) === -1 && racine[rl] && typeof racine[rl] === 'object') { __i18nFill(µ._mjs_i18nDictOf(rl), racine[rl]); }
      }
    }
    return seed.lang;
  } catch (e) { /* graine best-effort */ }
  return null;
}
// langue du rendu serveur de la page de départ (graine lue ici, avant tout montage) : base de la langue provisoire
var __i18nSeedLang = __i18nSeedFrom(typeof document !== 'undefined' ? document : null);
// échange de page (mjs_ujs.ts, juste avant l'application de la tête) : sème le cache avec la graine du
// document reçu, AVANT le montage des composants de la page d'arrivée ; UJS ne l'appelle que si elle existe
µ._mjs_navI18nSeed = function(doc) { __i18nSeedFrom(doc); };

// Zombie silencieux — averti UNE SEULE fois si `µ._i18nData`
// n'est jamais posé pour de vrai (contrat manifest cassé) : `__i18nBoot` ne
// booterait alors JAMAIS, la file `_mjs_i18nPendingMounts` resterait pleine à vie
// sans aucun diagnostic. Vérifié en microtâche DIFFÉRÉE (après le rattrapage
// de `__i18nBoot`, cf. son propre `queueMicrotask` en fin de fichier — enfilé
// AVANT celui-ci, FIFO garanti).
var __i18nZombieWarned = false;
var __i18nZombieCheckScheduled = false;
function __i18nCheckZombie() {
  if (__i18nZombieWarned || µ._mjs_i18nBooted) return;
  // `µ._mjs_i18nBooted` seul ne suffit plus : le démarrage attend désormais le FICHIER de
  // la langue (un aller-retour réseau), et cette vérification tombe, elle, dès la
  // microtâche suivante — elle criait donc au contrat cassé dans le cas NORMAL. Seule
  // l'absence du manifeste lui-même (ce que le message dit) reste un zombie.
  if (µ._i18nData !== __i18nInertFallback) return;
  if (!µ._mjs_i18nPendingMounts || µ._mjs_i18nPendingMounts.size === 0) return;
  __i18nZombieWarned = true;
  µ.warn(µ._mjs_msg('i18nNoData', null, 'i18n : µ._i18nData jamais reçu, composants i18n en placeholder'));
  // l'attente ne dure pas toujours : les modules retenus avant le démarrage paraissent avec leurs repères
  µ._mjs_i18nPendingMounts.forEach(function(comp) {
    var resolve = comp._mjs_i18nBootWaitResolve;
    comp._mjs_i18nBootWaitResolve = null;
    comp._mjs_i18nBootWaitPromise = null;
    if (resolve) { resolve(null); }
  });
}

// Repli clé manquante (cf. µ.t) — dédup par couple (langue, clé).
var __i18nFallbackWarned = new Set();

µ.i18n = {
  // `_mjs_i18nMount(comp)` : lit `comp._mjs_i18n = [section, override]`. Si le boot
  // (`__i18nBoot`, cf. plus bas) n'a PAS ENCORE tourné, la vraie langue
  // (`µlang`) n'est pas fiable — enregistrer/assurer maintenant fetcherait
  // avec `lang === undefined` (placeholder à vie, 0 fetch,
  // sans que la bascule ultérieure de langue ne rattrape jamais ce composant
  // puisque `_mjs_storeWatch` n'écoute que les CHANGEMENTS futurs). On se contente
  // donc de mettre le composant en FILE : `__i18nBoot()` rejoue `_mjs_mountReal`
  // pour chacun, une fois `µlang` posée pour de vrai. Mode 'wait' avant boot :
  // la promesse retournée est chaînée boot→ensure (résout toujours l'appelant,
  // `_mjs_connect` ci-dessous).
  _mjs_i18nMount: function(comp) {
    var info = comp._mjs_i18n;
    if (!info) return null;
    if (!µ._mjs_i18nBooted) {
      __i18nProvDecide();
      if (__i18nProvLang) { comp._mjs_i18nProv = __i18nProvLang; }
      µ._mjs_i18nPendingMounts.add(comp);
      if (!__i18nZombieCheckScheduled) {
        __i18nZombieCheckScheduled = true;
        queueMicrotask(__i18nCheckZombie);
      }
      // un hôte de page prérendue (`mjs-ssr`) n'attend rien : il se rend aussitôt avec la graine, et `__i18nBoot` le réinvalide
      // pour les textes qu'elle ne porte pas (clé racine, section non lue par le serveur)
      // de même un composant créé par le rendu d'un tel hôte (cf. `__i18nSousHote`)
      if (__i18nSousHote(comp)) { return null; }
      if (__i18nWaits(__i18nMode(info[1])) && !comp.hasAttribute('mjs-ssr')) {
        if (!comp._mjs_i18nBootWaitPromise) {
          comp._mjs_i18nBootWaitPromise = new Promise(function(resolve) { comp._mjs_i18nBootWaitResolve = resolve; });
        }
        return comp._mjs_i18nBootWaitPromise;
      }
      return null;
    }
    return µ.i18n._mjs_mountReal(comp);
  },
  // `_mjs_connect(comp)` : appelé par connectedCallback (mjs_element.ts) à CHAQUE connexion d'un
  // composant i18n. `_mjs_i18nMount` enregistre le composant et retourne la promesse du fragment
  // SEULEMENT en mode 'wait' avec fragment pas encore arrivé — signal pour différer le PREMIER
  // rendu, déjà planifié par connectedCallback (`_mjs_invalidate('_awaits_')`) : on annule ce rendu
  // vide programmé (`_mjs_pending_full`/`_mjs_pending`), la résolution du fragment ré-invalidera pour de
  // vrai. Composant déconnecté avant résolution → aucun rendu.
  _mjs_connect: function(comp) {
    var wait = µ.i18n._mjs_i18nMount(comp);
    // un hôte de page prérendue (`mjs-ssr`) ne gèle jamais : le constructeur a déjà remplacé son HTML par le gabarit
    // vide, le geler le laisserait vide (ou en barres) jusqu'à l'arrivée du fichier de langue
    if (!wait || comp.hasAttribute('mjs-ssr')) return;
    comp._mjs_pending_full = false;
    if (comp._mjs_pending) { comp._mjs_pending.clear(); }
    // GEL, et pas seulement annulation du rendu programmé : n'importe quelle
    // écriture d'état survenant avant l'arrivée du fragment repeindrait sinon
    // la page en placeholders (une coquille qui écrit son état quelques
    // millisecondes après son montage faisait clignoter ses clés ⟦…⟧). Cf. la
    // garde `_mjs_i18n_hold` dans `_mjs_invalidate` (mjs_element.ts).
    comp._mjs_i18n_hold = true;
    // le module reste CACHÉ (`[mjs-loading]`) tant que le gel tient : l'attente rejoint la retenue que
    // connectedCallback lit juste après (`_mjs_cssPending`, celle des feuilles paresseuses), sinon le navigateur
    // peint le gabarit brut (liaisons vides) le temps de l'attente. Exception : le rendu serveur (la capture ne doit rien porter de masqué)
    if (!µ.server && !µ._isServer) { comp._mjs_cssPending = comp._mjs_cssPending ? Promise.all([comp._mjs_cssPending, wait]) : wait; }
    // <i18n-loader-appel>
    __i18nLoaderOn(comp);
    // </i18n-loader-appel>
    if (!µ.server && !µ._isServer && __i18nMode(comp._mjs_i18n[1]) === 'wait') { comp._mjs_i18nTimer = setTimeout(function() { __i18nSecours(comp); }, __i18nDelai()); }
    wait.then(function() {
      comp._mjs_i18n_hold = false;                          // levé AVANT toute sortie : un composant démonté entre-temps ne doit pas rester gelé à vie
      if (comp._mjs_i18nTimer) { clearTimeout(comp._mjs_i18nTimer); comp._mjs_i18nTimer = 0; }
      comp._mjs_i18nRescue = false;
      // <i18n-loader-appel>
      __i18nLoaderOff(comp);
      // </i18n-loader-appel>
      if (!comp._mjs_is_mounted || comp._mjs_dead) return;
      comp._mjs_invalidate('_awaits_');
    });
  },
  // `_mjs_mountReal(comp)` : VRAIE logique de montage (enregistre le composant,
  // déclenche `_ensure` si le fragment (langue courante, section) n'est pas
  // en cache). Retourne la PROMESSE du fragment SEULEMENT en mode 'wait' avec
  // fragment pas encore là (signal de différé pour mjs_element.ts) — `null`
  // sinon. Appelée directement une fois le boot passé, ou rejouée par
  // `__i18nBoot()` pour la file d'attente. La
  // promesse `pending` reçoit systématiquement un `.catch` muet (l'échec est
  // DÉJÀ loggé par `µ.error` dans `_ensure`, jamais d'unhandled rejection ici)
  // ; celle éventuellement RETOURNÉE (mode 'wait') RÉSOUT toujours, même sur
  // échec réseau — le composant se rend avec les placeholders plutôt que de
  // rester blanc à vie. Langue EFFECTIVE : un composant monté PENDANT
  // une bascule en vol rend dans l'ANCIENNE langue (comme tous les autres),
  // puis swap avec eux au swap atomique.
  _mjs_mountReal: function(comp) {
    var info = comp._mjs_i18n;
    var section = info[0], override = info[1];
    µ._mjs_i18nComps.add(comp);
    if (!section) return null;
    var set = µ._mjs_i18nSectionComps.get(section);
    if (!set) { set = new Set(); µ._mjs_i18nSectionComps.set(section, set); }
    set.add(comp);
    var lang = __i18nEffectiveLang();
    var entry = µ._i18nCache.get(lang + '/' + section);
    var pending = entry ? (entry.data == null ? entry.promise : null) : µ.i18n._ensure(lang, section);
    if (pending) { pending.catch(function() {}); }
    if (__i18nWaits(__i18nMode(override)) && pending) {
      return pending.then(function(v) { return v; }, function() { return null; });
    }
    return null;
  },
  // `_mjs_unmount(comp)` : désenregistre partout (registre global + toutes les
  // sections — un composant est dans la section de son `@i18n` et, s'il en écrit
  // plusieurs, dans chacune des autres : le balayage de toutes reste bon marché
  // en v1) — y compris de la file d'attente pré-boot (cas du
  // démontage AVANT que `__i18nBoot()` n'ait rejoué son montage réel).
  _mjs_unmount: function(comp) {
    if (comp._mjs_i18nTimer) { clearTimeout(comp._mjs_i18nTimer); comp._mjs_i18nTimer = 0; }
    // <i18n-loader-appel>
    __i18nLoaderOff(comp);
    // </i18n-loader-appel>
    µ._mjs_i18nComps.delete(comp);
    µ._mjs_i18nSectionComps.forEach(function(set) { set.delete(comp); });
    µ._mjs_i18nPendingMounts.delete(comp);
  },
  // `_ensure(lang, section)` : cache-singleton — déjà résolu ou en vol →
  // MÊME promesse (dédoublonnage), sinon fetch → JSON → monte dans le dict
  // + notifie les composants de la section. SSR / pas de `fetch` global /
  // chemin inconnu : pas de requête (LIMITATION v1 assumée), promesse
  // résolue à `null` SANS mise en cache (un montage suivant côté client
  // retentera). Échec réseau : `µ.error`, entrée RETIRÉE du cache (un
  // prochain montage retente), les composants restent sur placeholder.
  //
  // Repli de section —
  // `sections[lang][section]` absent (langue partiellement traduite OU
  // fragment rejeté par le contrôle d'empreinte, cf. docs §8) : on sert le
  // fragment de `µ._i18nData.default` PLUTÔT que de laisser le composant en
  // placeholder à vie. Délégation vers `_ensure(default, section)` — MÊME
  // cache-singleton que si un composant demandait directement le défaut,
  // donc UN SEUL fetch réseau même si plusieurs langues/composants replient
  // sur la même section. `µ.t` fait déjà le même repli au niveau clé
  // (`µ._i18nData.default`) : une fois le fragment par défaut dans
  // `µ._mjs_i18nDictOf(default)`, `µ.t` le retrouve tout seul — ce qui manquait
  // ici, c'est juste de FETCHER ce fragment et de notifier les composants de
  // `lang` une fois arrivé (sinon 0 fetch, 0 notification, placeholder à vie).
  _ensure: function(lang, section) {
    var key = lang + '/' + section;
    var entry = µ._i18nCache.get(key);
    if (entry) { return entry.promise; }
    // table de CETTE langue (fichier de langue chargé au démarrage) : nom compact du
    // fragment, l'URL se reconstitue ici — un seul endroit, cf. __i18nSectionUrl.
    var sections = __i18nSectionsOf(lang);
    var nom = __i18nSectionName(sections, section);
    var path = nom ? __i18nSectionUrl(lang, nom) : null;
    if (!path) {
      var defLang = µ._i18nData.default;
      var defSections = (defLang && defLang !== lang) ? __i18nSectionsOf(defLang) : null;
      var defPath = __i18nSectionName(defSections, section);
      if (defPath) {
        // fragment par défaut DÉJÀ là (graine du rendu serveur, cache) : la langue demandée le sert tout de suite, sous
        // son propre nom comme le fait la voie asynchrone — mais sans vague d'invalidation, personne n'attend rien
        // (la lecture de `µ.t` retombe sur le dictionnaire par défaut, déjà peuplé)
        var defEntry = µ._i18nCache.get(defLang + '/' + section);
        if (defEntry && defEntry.data != null) {
          µ._i18nCache.set(key, { promise: Promise.resolve(defEntry.data), data: defEntry.data });
          return µ._i18nCache.get(key).promise;
        }
        var fallbackPromise = µ.i18n._ensure(defLang, section).then(function(json) {
          if (!µ._mjs_i18nSwapPending && lang === __i18nEffectiveLang()) {
            var set = µ._mjs_i18nSectionComps.get(section);
            if (set) { set.forEach(function(c) { c._mjs_invalidate('_awaits_'); }); }
            if (__i18nAskedSections.has(section)) { __i18nWakeReaders(section); }
          }
          return json;
        });
        µ._i18nCache.set(key, { promise: fallbackPromise, data: null });
        fallbackPromise.then(function(json) {
          var e = µ._i18nCache.get(key);
          if (e) { e.data = json; }
        }, function() {
          µ._i18nCache.delete(key); // échec déjà loggé par le fetch de `defLang` — un montage suivant retentera
        });
        return fallbackPromise;
      }
    }
    if (!path || µ._isServer || typeof fetch !== 'function') {
      // couple effectif (lang, section) trouvé mais pas de fetch réel (SSR/pas de fetch) : marqué CONSULTÉ pour le prérendu (cf µ._i18nUsed, renderToString.ts/render-browser.ts)
      if (path) {
        µ._i18nUsed = µ._i18nUsed || {}; µ._i18nUsed[lang + '/' + section] = true;
        // lecture disque PARESSEUSE, SSR happy-dom — plus de préchargement de TOUTES
        // les sections avant montage (renderToString.ts) : `µ._i18nLoadSync` (crochet Node posé
        // AVANT l'eval sur CE couple SEULEMENT) lit le fragment sur disque de façon SYNCHRONE
        // (pas de fetch, rien à attendre) — même position en cache/dict que le fetch client
        // ci-dessous, `µ.t` le retrouve dès ce même tick.
        if (µ._isServer && typeof µ._i18nLoadSync === 'function' && !µ._i18nCache.get(key)) {
          var syncData = µ._i18nLoadSync(lang, section);
          if (syncData != null) {
            syncData = __i18nNu(syncData);
            µ._mjs_i18nDictOf(lang)[section] = syncData;
            µ._i18nCache.set(key, { promise: Promise.resolve(syncData), data: syncData });
            return Promise.resolve(syncData);
          }
        }
      }
      return Promise.resolve(null);
    }
    var promise = fetch(path).then(function(res) {
      if (!res || !res.ok) { throw new Error(µ._mjs_txt('i18nHttp', { status: (res && res.status), path: path }, 'i18n : HTTP {status} sur {path}')); }
      return res.json();
    }).then(function(json) {
      json = __i18nNu(json);
      µ._mjs_i18nDictOf(lang)[section] = json;
      delete __i18nEchecs[key];
      var e = µ._i18nCache.get(key);
      if (e) { e.data = json; }
      // swap atomique — PENDANT une bascule en vol, ne PAS notifier ici
      // section par section : le watcher `__mjsLang` (cf. plus bas) invalide
      // TOUS les composants i18n en UNE SEULE vague, une fois TOUTES les
      // sections cibles arrivées (jamais de notification prématurée pendant
      // un swap — un composant monté hors swap, lui, continue d'être notifié
      // normalement, ICI, dès son fragment prêt).
      // GARDE DE PERTINENCE — un fragment peut
      // arriver ICI pour une langue qui n'est PLUS la langue effective : un
      // composant 'wait' monté en `lang` A, dont le fetch traîne, alors
      // qu'une bascule A→B COMPLÈTE entre-temps (elle, notifie déjà tous les
      // composants via la vague atomique ci-dessous) — ce fragment retardataire
      // peuple quand même le dictionnaire/cache (`µ._mjs_i18nDictOf`/`e.data`
      // ci-dessus, TOUJOURS utile pour un futur retour vers `lang`), mais ne
      // doit PLUS rien invalider : les composants affichent déjà `lang`
      // effective (B), une notification ici les ferait juste se re-rendre à
      // l'identique (ils lisent `__i18nEffectiveLang()`, PAS `lang` figé
      // dans cette closure). `!µ._mjs_i18nSwapPending` seul ne suffit plus : au
      // moment de CE `.then`, un swap peut avoir COMPLÈTEMENT abouti (donc
      // retombé à `false`) vers une AUTRE langue que `lang`.
      if (!µ._mjs_i18nSwapPending && lang === __i18nEffectiveLang()) {
        var set = µ._mjs_i18nSectionComps.get(section);
        if (set) { set.forEach(function(c) { c._mjs_invalidate('_awaits_'); }); }
        // les lecteurs de la section qui ne la déclarent pas (cf. __i18nAskSection), quelle que soit la voie par
        // laquelle elle arrive : leur propre demande, un module qui la déclare, une reprise après une panne
        if (__i18nAskedSections.has(section)) { __i18nWakeReaders(section); }
      }
      return json;
    }).catch(function(err) {
      if (!__i18nLeaving) {
        µ.error(µ._mjs_msg('i18nLoadSection', { section: section, lang: lang, reason: (err && err.message ? err.message : err) }, 'i18n : échec de chargement de « {section} » ({lang}) — {reason}'));
        __i18nEchecs[key] = true;
      }
      µ._i18nCache.delete(key);
      throw err;
    });
    µ._i18nCache.set(key, { promise: promise, data: null });
    return promise;
  }
};

// <i18n-paquets>
// PLUSIEURS SECTIONS PAR MODULE — `@i18n 'accueil' 'onglets-admin'`. Bloc retiré du cœur par le build (bundleRuntime) tant qu'aucune unité
// ne l'écrit : le cœur d'une appli dont aucun module n'écrit plusieurs sections reste identique, à l'octet, à celui d'avant ce bloc.
// Le compilateur pose `_mjs_i18n = [section, mode, [sections en plus]]` et passe, en 4e argument de `µ.t`, la même clé relative pour
// chaque section en plus (`µ.t('accueil.titre', vars, mode, ['onglets-admin.titre'])`). Presque rien d'autre ne change : le registre
// section→composants reçoit le module sous CHACUNE de ses sections, donc la bascule de langue (qui assure toutes les sections du registre),
// l'arrivée d'un fragment (qui prévient le registre) et le cache-singleton servent les sections en plus sans code de plus ; un enfant qui
// déclare l'une d'elles la trouve au cache, sans seconde requête ni seconde attente. Restent la lecture d'une section non déclarée
// (`__i18nAskSection`) : elle apprend que les sections en plus sont déclarées elles aussi, par une ligne à elle dans la fonction, balisée de
// même et retirée du cœur dans les mêmes conditions ; et le rejeu du démarrage (`__i18nBoot`) : il apprend qu'une section en plus encore en
// route compte comme la première (`__i18nPaquetsVol`, plus bas), par une ligne balisée de même.
(function() {
  var mountReal = µ.i18n._mjs_mountReal;
  // les sections d'un module pour la reprise des textes d'une page rendue : la sienne, puis les autres
  __i18nSections = function(comp) { return [comp._mjs_i18n[0]].concat(comp._mjs_i18n[2] || []); };
  // montage : la section du module comme avant, puis chacune des autres, demandées dans la même passe (requêtes parallèles) ; en mode
  // 'wait' l'attente est celle de TOUTES (chaque promesse résout toujours, même sur échec : le module se rend alors avec ses repères
  // plutôt que de rester blanc)
  µ.i18n._mjs_mountReal = function(comp) {
    var info = comp._mjs_i18n;
    var more = info && info[2];
    var first = mountReal.call(this, comp);
    if (!more) { return first; }
    var lang = __i18nEffectiveLang();
    var waits = first ? [first] : [];
    for (var i = 0; i < more.length; i++) {
      var section = more[i];
      var set = µ._mjs_i18nSectionComps.get(section);
      if (!set) { set = new Set(); µ._mjs_i18nSectionComps.set(section, set); }
      set.add(comp);
      var entry = µ._i18nCache.get(lang + '/' + section);
      var pending = entry ? (entry.data == null ? entry.promise : null) : µ.i18n._ensure(lang, section);
      if (pending) {
        pending.catch(function() {});
        waits.push(pending.then(function(v) { return v; }, function() { return null; }));
      }
    }
    return __i18nWaits(__i18nMode(info[1])) && waits.length > 0 ? Promise.all(waits) : null;
  };
  // lecture : la clé de la première section qui porte le texte (langue affichée, puis langue par défaut : le repli de langue reste celui de
  // chaque section) ; à défaut, celle de la première dont le fragment est encore en route ou a échoué (les repères « en route » et « en
  // échec » doivent la voir) ; à défaut, la première : le repère d'une clé absente de toutes nomme la section du module
  function pick(cle, more) {
    var lang = __i18nEffectiveLang();
    var def = µ._i18nData.default;
    var cles = [cle].concat(more);
    var i;
    if (!lang) { return cle; }
    for (i = 0; i < cles.length; i++) {
      if (__i18nResolve(lang, cles[i]) != null || (def && def !== lang && __i18nResolve(def, cles[i]) != null)) { return cles[i]; }
    }
    for (i = 0; i < cles.length; i++) {
      var e = µ._i18nCache.get(lang + '/' + cles[i].split('.')[0]);
      if ((e && e.data == null) || __i18nEnEchec(lang, cles[i])) { return cles[i]; }
    }
    return cle;
  }
  var t = µ.t;
  µ.t = function(cle, vars, modeOverride, more) {
    return t(more ? pick(cle, more) : cle, vars, modeOverride);
  };
})();

// rejeu du démarrage (`__i18nBoot`) : le fragment « en vol » d'un module est celui de la première de ses sections encore en route, pas
// seulement de la première écrite. Sa première déjà là (semée par le rendu serveur) et une autre en route : l'arrivée de celle-ci rendra le
// module, un rendu de plus n'afficherait que les mêmes repères
function __i18nPaquetsVol(comp, vol) {
  var more = comp._mjs_i18n && comp._mjs_i18n[2];
  var lang, entry;
  if (!more || (vol && vol.data == null)) { return vol; }
  lang = __i18nEffectiveLang();
  for (var i = 0; i < more.length; i++) {
    entry = µ._i18nCache.get(lang + '/' + more[i]);
    if (entry && entry.data == null) { return entry; }
  }
  return vol;
}
// </i18n-paquets>

// SECTION LUE SANS ÊTRE DÉCLARÉE — clé dont le premier mot est une section du dictionnaire, lue
// depuis un module qui ne la déclare pas (`µt('format.locale')` sans `@i18n`, `µt('/format.locale')`
// sous un autre `@i18n`, clé calculée) : rien ne demandait la section, le texte restait vide (⟦clé⟧
// en dev) tant qu'un autre module ne l'avait pas chargée, et son lecteur n'était jamais prévenu de
// l'arrivée. La lecture la demande donc elle-même (même cache-singleton que `_ensure` : une seule
// requête). À l'arrivée, les composants i18n qui ne la déclarent pas se rendent à nouveau — on ne
// sait pas lesquels l'ont lue, une vague par langue et par section ; ceux qui la déclarent sont déjà
// prévenus par `_ensure`, et leur propre lecture pendant l'attente ne déclenche rien de plus. Retenue
// pour les bascules (`__i18nAskedSections`, lue par le watcher de `µlang`) : servie dans la langue
// cible au swap atomique, jamais un texte en attente. Un échec (déjà crié par `_ensure`) est oublié UNE
// fois : la lecture suivante la redemande (un lecteur monté ou rendu après la panne) ; s'il se répète, elle
// n'est plus redemandée à chaque rendu — pas de rafale de requêtes pour un composant qui se rend souvent —
// avant une bascule de langue ou le chargement par un module qui la déclare, qui préviennent les lecteurs
// à l'arrivée (`__i18nWakeReaders`, appelé par `_ensure`). Rend `true` si la section est demandée, `false`
// si la clé manque pour de bon (pas une section, ou section arrivée sans elle)
var __i18nAsked = {};
var __i18nRetried = {};
var __i18nAskedSections = new Set();
// les composants i18n qui ne déclarent pas la section se rendent à nouveau : on ne sait pas lesquels l'ont lue
function __i18nWakeReaders(section) {
  var declared = µ._mjs_i18nSectionComps.get(section);
  µ._mjs_i18nComps.forEach(function(c) {
    if (!declared || !declared.has(c)) { c._mjs_invalidate('_awaits_'); }
  });
}
function __i18nAskSection(lang, cle) {
  var section, own, def, defs, key, entry, comp, promise;
  if (!µ._mjs_i18nBooted || !lang) return false;
  section = String(cle).split('.')[0];
  own = __i18nSectionsOf(lang);
  def = µ._i18nData.default;
  defs = def && def !== lang ? __i18nSectionsOf(def) : null;
  if (!__i18nSectionName(own, section) && !__i18nSectionName(defs, section)) return false;
  key = lang + '/' + section;
  entry = µ._i18nCache.get(key);
  if (entry && entry.data != null) return false;
  comp = µ.activeComponent;
  if (comp && comp._mjs_i18n && comp._mjs_i18n[0] === section) return false; // module qui la déclare : rien de neuf ici
  // <i18n-paquets-lecture>
  if (comp && comp._mjs_i18n && comp._mjs_i18n[2] && comp._mjs_i18n[2].indexOf(section) !== -1) return false; // une section en plus : la sienne aussi
  // </i18n-paquets-lecture>
  if (__i18nAsked[key]) return true;
  __i18nAsked[key] = true;
  __i18nAskedSections.add(section);
  promise = entry ? entry.promise : µ.i18n._ensure(lang, section);
  if (µ._isServer) return true; // rendu serveur : lecture disque synchrone, relue par l'appelant
  promise.then(null, function() {
    if (__i18nRetried[key]) return;
    __i18nRetried[key] = true;
    delete __i18nAsked[key];
  });
  return true;
}

// Détection/persistance de la langue initiale — trois
// capacités INDÉPENDANTES, désactivées par défaut (`µ._i18nData.urlParam`/
// `.persist`/`.detect`). Priorité au boot : URL (`?lang=`) > localStorage
// (persist) > navigateur (detect) > `default`. Une page rendue par le serveur qui a posé sa langue dans
// le store intercale celle-ci après le localStorage quand elle porte sa graine (cf. `__i18nWantedLang`). `µ._isServer` vérifié EN
// PREMIER (SSR happy-dom peut exposer un faux `location`/`localStorage`/
// `navigator`) ; chaque accès en `try` (URL malformée, quota/sandbox/
// navigation privée : ignoré, jamais un crash de boot).
var __I18N_STORAGE_KEY = '__mjsLang';
// Langue portée par l'URL (`?lang=xx`) si `urlParam` actif ET la valeur connue —
// sinon `null`. Extrait à part car lu à DEUX endroits : la détection initiale
// (page cliente sans hydratation, `__mjsLang` absent) ET l'override du boot SSR
// (la valeur prérendue vaut TOUJOURS le défaut, l'URL doit primer — cf. __i18nBoot).
function __i18nUrlLang() {
  if (!µ._isServer && µ._i18nData.urlParam && typeof location !== 'undefined' && location.search) {
    try {
      var fromUrl = new URLSearchParams(location.search).get('lang');
      if (__i18nKnownLang(fromUrl)) { return fromUrl; }
    } catch (e) { /* URL malformée / API absente : ignoré */ }
  }
  return null;
}
// Langue MÉMORISÉE du visiteur (`persist` actif, valeur connue), sinon `null` : lue par la détection initiale et par le choix d'une page rendue
// par le serveur (cf. `__i18nWantedLang`).
function __i18nSavedLang() {
  if (!µ._isServer && µ._i18nData.persist) {
    // `typeof localStorage` DANS le try : sur une origine opaque
    // (sandbox/file:///data:), l'identifiant lui-même est un ACCESSEUR qui lève
    // (SecurityError), pas seulement `.getItem()` — le garder devant le try (comme
    // avant) laissait le boot i18n crasher tout entier, non rattrapé.
    try {
      if (typeof localStorage !== 'undefined') {
        var saved = localStorage.getItem(__I18N_STORAGE_KEY);
        if (__i18nKnownLang(saved)) { return saved; }
      }
    } catch (e) { /* quota/sandbox/navigation privée/typeof sur origine opaque : ignoré */ }
  }
  return null;
}
function __i18nDetectInitialLang() {
  // URL `?lang=xx` — PRIORITAIRE : une langue portée par l'URL gagne sur un
  // choix mémorisé/deviné (un lien partagé `?lang=en` s'ouvre en anglais).
  var fromUrl = __i18nUrlLang();
  if (fromUrl) { return fromUrl; }
  var saved = __i18nSavedLang();
  if (saved) { return saved; }
  if (!µ._isServer && µ._i18nData.detect && typeof navigator !== 'undefined' && navigator.language) {
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    for (var i = 0; i < langs.length; i++) {
      var code = langs[i];
      if (__i18nKnownLang(code)) { return code; }
      var primary = code.split('-')[0];
      if (__i18nKnownLang(primary)) { return primary; }
    }
  }
  return µ._i18nData.default;
}

// Init store + bascule de langue — SEULEMENT si `µ._i18nData` a fini par être
// RÉEL (comparaison de référence contre `__i18nInertFallback`, pas un simple
// flag figé au chargement — cf. le correctif ci-dessous). Idempotent
// (`µ._mjs_i18nBooted`) : rejouer ce fichier (HMR/tests qui ré-évaluent la même
// instance `µ`) n'empile pas un 2e watcher.
//
// BUG D'INTÉGRATION — CORRIGÉ : l'ancien code gardait
// `__i18nReal` figé SYNCHRONE au chargement de CE fichier. Or en usage RÉEL,
// `mjs_i18n.ts` est concaténé dans `mjs_core-*.js`, et le manifest de build
// (`bundle.js`) fait `import { µ } from 'mjs_core-*.js'; µ._i18nData = {...};`
// — l'import ES s'exécute TOUJOURS intégralement AVANT la suite du fichier
// importeur (spec ES modules), donc ce module voit FORCÉMENT `µ._i18nData`
// absent/inerte à SON PROPRE chargement ; la vraie donnée n'arrive qu'une
// ligne plus tard, dans le manifest. Résultat AVANT correctif : `__i18nReal`
// restait `false` à VIE, `µlang` n'était jamais initialisée et la bascule de
// langue n'était jamais câblée, dans TOUT build réel (repro : tests/i18n-
// e2e.test.ts, cas a/c). `__i18nBoot` est rejouable : un essai SYNCHRONE tout
// de suite (couvre le cas où `µ._i18nData` était déjà réel AVANT le chargement
// de ce module — scénario des tests unitaires), puis un `queueMicrotask`
// de rattrapage — s'exécute après la fin du script synchrone courant (import
// + assignation manifest inclus), mais TOUJOURS avant le premier rendu d'un
// composant i18n (son `_mjs_invalidate('_awaits_')` initial est LUI-MÊME
// asynchrone, cf. mjs_element.ts) — SAUF un cas :
// un composant PRÉSENT AU PARSE (markup statique/SSR
// hydraté) subit l'upgrade `customElements` SYNCHRONE pendant l'eval du
// core, donc SON `_mjs_i18nMount` (mjs_element.ts) tourne AVANT même ce
// `queueMicrotask` de rattrapage — cf. `_mjs_i18nMount`/`_mjs_i18nPendingMounts` plus
// haut : ces composants sont mis en FILE plutôt que montés avec une langue
// bidon, et REJOUÉS ci-dessous une fois `µlang` posée pour de vrai.
//
// CASCADE DE MODULES — 2e correctif : le manifest n'importe plus le cœur
// STATIQUEMENT (`import()` dynamique dans un `.then()`, cf. writeManifest,
// bundler/index.ts) — `µ._i18nData = {...};` n'arrive donc plus dans le MÊME
// script SYNCHRONE que le chargement de ce fichier, mais sur un TOUR DE
// MICROTÂCHES ultérieur (celui de la promesse `import()`), APRÈS le seul
// `queueMicrotask(__i18nBoot)` de rattrapage ci-dessous (posé, lui, PENDANT
// l'évaluation synchrone du cœur — donc AVANT). Ce rattrapage tombait alors
// TOUJOURS trop tôt, `µ._mjs_i18nBooted` ne devenait plus jamais vrai (placeholder
// à vie, repro : rendu Chromium réel, tests/render-browser.test.ts, mode
// `@i18nPlaceholder wait`). Fix : `µ._i18nRecheck` (alias de `__i18nBoot`,
// posé plus bas) — le manifest l'appelle EXPLICITEMENT juste après avoir posé
// `µ._i18nData` (même patron que `µ._themeAdopt`, déjà ici pour `µ._themeCss`),
// au lieu de compter sur un timing de microtâche implicite qui ne tient plus.
// CHARGEMENT D'UNE LANGUE — `files[langue]` est un module à export par défaut
// (`{root, sections}`), importé UNE fois par langue (promesse mémoïsée, plusieurs
// demandes simultanées n'en font qu'un). Échec (404, bundle périmé, réseau) : crié
// UNE fois puis langue enregistrée VIDE — le démarrage ne doit jamais rester gelé,
// les clés retombent sur le défaut (µ.t) ou sur le placeholder. Pendant une bascule
// (`strict`), l'échec rejette au contraire : la bascule est annulée comme pour une
// section, et la langue n'est retenue ni vide ni en cours — la demande suivante la
// recharge (réseau revenu). Une langue restée vide après un échec au démarrage est
// rechargée de même à la première bascule vers elle. `µ._i18nImport`
// permet à un hôte sans ESM (harnais de test) de servir ces fichiers autrement ;
// sinon `import()` natif, comme l'Autoloader pour un composant.
var __i18nLangPromises = Object.create(null);
function __i18nLangReady(lang) {
  return !!__i18nLangOf(lang);
}
function __i18nLoadLang(lang, strict) {
  if (!lang) { return Promise.resolve(null); }
  if (__i18nLangReady(lang) && !(strict && __i18nEchecs[lang])) { return Promise.resolve(µ._i18nLangs[lang]); }
  if (__i18nLangPromises[lang]) { return __i18nLangPromises[lang]; }
  // le fichier propre de la langue : aucun pour une langue inconnue, jamais une adresse héritée
  var files = µ._i18nData.files;
  var url = files && Object.prototype.hasOwnProperty.call(files, lang) ? files[lang] : null;
  var p;
  if (!url) {
    µ._i18nLang(lang, null);
    p = Promise.resolve(µ._i18nLangs[lang]);
  } else {
    var charger = (typeof µ._i18nImport === 'function') ? µ._i18nImport(url) : import(url);
    p = Promise.resolve(charger).then(function(mod) {
      µ._i18nLang(lang, (mod && mod.default) || mod);
      return µ._i18nLangs[lang];
    }, function(err) {
      if (!__i18nLeaving) { µ.error(µ._mjs_msg('i18nLoadLang', { lang: lang, url: url, reason: (err && err.message ? err.message : err) }, 'i18n : échec de chargement de la langue « {lang} » ({url}) — {reason}')); }
      delete __i18nLangPromises[lang]; // langue rechargée à la bascule suivante
      if (strict) { throw err; } // bascule annulée
      µ._i18nLang(lang, null); // langue vide : repli sur le défaut, jamais de gel
      if (!__i18nLeaving) { __i18nEchecs[lang] = true; } // ce que le défaut ne porte pas paraît en barres
      return µ._i18nLangs[lang];
    });
  }
  __i18nLangPromises[lang] = p;
  return p;
}

// Langue VOULUE au démarrage. Page dont le serveur a posé la langue dans le store (`__mjsLang` hydraté) : l'URL (`?lang=`) d'abord, puis la langue
// MÉMORISÉE du visiteur — quand la page porte sa graine, la bascule du démarrage (cf. `__i18nBoot`) la fait passer de la langue du serveur à la sienne ;
// sans graine rien ne la porterait, la langue posée garde la main — puis celle du rendu ; sinon la détection complète (URL, mémoire, navigateur, défaut).
function __i18nWantedLang() {
  if (µ._mjs_storeRaw && µ._mjs_storeRaw.__mjsLang !== undefined) {
    return __i18nUrlLang() || (__i18nSeedLang && __i18nSavedLang()) || µ._mjs_storeRaw.__mjsLang;
  }
  return __i18nDetectInitialLang();
}

var __i18nBootLoading = false;

function __i18nBoot() {
  if (µ._mjs_i18nBooted) return;
  if (µ._i18nData === __i18nInertFallback) return; // toujours pas de données réelles
  // Langue DÉCIDÉE d'abord, fichiers ENSUITE : la langue affichée et — quand elle
  // diffère — celle par DÉFAUT (porteuse des replis de clé et de section, cf. `µ.t` et
  // `_ensure`). Tant qu'ils ne sont pas là, on ne démarre pas : les composants déjà
  // montés attendent dans `_mjs_i18nPendingMounts` (cf. `_mjs_i18nMount`), rejoués plus bas.
  var lang = __i18nWantedLang();
  var defLang = µ._i18nData.default;
  if (!__i18nLangReady(lang) || (defLang && defLang !== lang && !__i18nLangReady(defLang))) {
    if (!__i18nBootLoading) {
      __i18nBootLoading = true;
      var attentes = [__i18nLoadLang(lang)];
      if (defLang && defLang !== lang) { attentes.push(__i18nLoadLang(defLang)); }
      Promise.all(attentes).then(function() { __i18nBootLoading = false; __i18nBoot(); });
    }
    return;
  }
  µ._mjs_i18nBooted = true;
  __i18nMergeRootIntoExistingDicts(); // racine réelle enfin disponible, backfill des dicts semés trop tôt
  // Clé store CACHÉE (non-énumérable, cf. mjs_store_globals.ts) — déclarée
  // AVANT toute écriture, sinon un `µ._storeSet` implicite la déclarerait
  // ÉNUMÉRABLE (auto-déclaration de `_storeSet` sur clé absente).
  if (µ._mjs_storeRaw && µ._mjs_storeRaw.__mjsLang === undefined) {
    if (typeof µ._storeDeclare === 'function') { µ._storeDeclare(['__mjsLang'], true); }
    if (typeof µ._storeSet === 'function') { µ._storeSet('__mjsLang', lang); }
    else { µ._mjs_storeRaw.__mjsLang = lang; }
  } else if (µ._mjs_storeRaw && µ._mjs_storeRaw.__mjsLang !== undefined) {
    // Page SSR — `mjs_store_globals.ts` a DÉJÀ réhydraté `__mjsLang` depuis
    // `<script id="__mjs_store">`, la langue du rendu. Sans cet override, la garde
    // `=== undefined` ci-dessus saute et ni `?lang=` ni la langue mémorisée ne seraient
    // JAMAIS relus : un rechargement de `?lang=en` retomberait sur la langue du rendu. La langue
    // voulue (`lang`, cf. `__i18nWantedLang`) PRIME sur la valeur figée du prérendu : l'URL, puis
    // la mémoire du visiteur si la page porte sa graine ; sinon c'est celle du rendu → aucun
    // changement. Clé déjà déclarée (par l'hydratation) → `_storeSet` se contente de mettre à jour
    // la valeur ; aucun guetteur de `µlang` n'est encore inscrit, la bascule vient plus bas.
    if (lang !== µ._mjs_storeRaw.__mjsLang) {
      if (typeof µ._storeSet === 'function') { µ._storeSet('__mjsLang', lang); }
      else { µ._mjs_storeRaw.__mjsLang = lang; }
    }
  }
  __i18nDisplayedLang = µ._mjs_storeRaw ? µ._mjs_storeRaw.__mjsLang : undefined;
  if (typeof µ._mjs_storeWatch === 'function') {
    // Bascule SANS placeholder (swap atomique) — l'ancienne langue reste
    // affichée (`__i18nEffectiveLang`) jusqu'à l'arrivée COMPLÈTE de la
    // cible (racine déjà embarquée, zéro fetch ; sections déjà en cache pour
    // la cible : zéro fetch non plus) puis UNE SEULE vague d'invalidation.
    // Jeton de génération (`__i18nSwapGen`) : une bascule fr→en→fr rapide ne
    // laisse gagner que la DERNIÈRE (les résolutions périmées se taisent à
    // leur retour, `myGen !== __i18nSwapGen`). Échec d'un fetch : REVERT
    // (`µ._storeSet` vers l'ancienne langue, redéclenche ce watcher — cette
    // langue est déjà entièrement en cache, le swap-retour est immédiat) —
    // l'affichage n'a jamais bougé.
    // Pas de garde « prevLang === newLang » ici : le jeton de génération SEUL
    // arbitre — nécessaire pour fr→en→fr rapide (le retour vers `prevLang`
    // pendant que fr→en est encore en vol DOIT annuler ce vol, pas être
    // ignoré comme un no-op, cf. cas (e) des tests). `µ._storeSet` a déjà
    // filtré en amont l'unique vrai no-op (nouvelle valeur === valeur BRUTE
    // actuelle, identique bascule en cours ou non).
    µ._mjs_storeWatch('__mjsLang', function(newLang) {
      var prevLang = µ._mjs_i18nSwapPending ? µ._mjs_i18nPrevLang : __i18nDisplayedLang;
      var myGen = ++__i18nSwapGen;
      µ._mjs_i18nSwapPending = true;
      µ._mjs_i18nPrevLang = prevLang;
      var demarrage = __i18nDemarrage;
      __i18nDemarrage = false;

      // Sections à assurer : relevées TOUT DE SUITE (liste figée à l'instant de la
      // bascule, comme avant) ; leur chargement, lui, attend le FICHIER de la langue
      // cible — sans sa table, `_ensure` ne saurait même pas quel fragment demander.
      // Langue déjà chargée (retour vers une langue déjà vue) : promesse immédiate,
      // aucun aller-retour réseau.
      var aAssurer = [];
      µ._mjs_i18nSectionComps.forEach(function(set, section) {
        if (set.size > 0) { aAssurer.push(section); }
      });
      // sections lues sans déclaration (cf. __i18nAskSection) : assurées elles aussi dans la langue cible
      __i18nAskedSections.forEach(function(section) {
        if (aAssurer.indexOf(section) === -1) { aAssurer.push(section); }
      });
      // au démarrage, la graine nomme ce que le serveur a lu, qu'un module déclare la section ou non (`µt('/extra.nom')`) : la page en a besoin dans la langue voulue
      if (demarrage) {
        __i18nSeedNoms.forEach(function(section) {
          if (aAssurer.indexOf(section) === -1) { aAssurer.push(section); }
        });
      }
      var pret = __i18nLoadLang(newLang, !demarrage).then(function() {
        var toEnsure = [];
        for (var i = 0; i < aAssurer.length; i++) {
          var section = aAssurer[i];
          var entry = µ._i18nCache.get(newLang + '/' + section);
          if (!entry || entry.data == null) { toEnsure.push(µ.i18n._ensure(newLang, section)); }
        }
        // au démarrage la bascule attend TOUS ses fragments, réussis ou en échec : le premier qui échoue (déjà signalé) ne la clôt pas pendant que les autres sont en vol
        if (demarrage) { toEnsure = toEnsure.map(__i18nSansEchec); }
        return Promise.all(toEnsure);
      });
      if (demarrage) {
        // un module monté pendant l'attente (créé par un hôte, une minuterie) a sa section à assurer lui aussi avant la vague
        var vues = {};
        var rassurer = function() {
          var reste = [];
          µ._mjs_i18nSectionComps.forEach(function(set, section) {
            if (set.size > 0 && !vues[section] && aAssurer.indexOf(section) === -1) { vues[section] = true; reste.push(µ.i18n._ensure(newLang, section)); }
          });
          return reste.length ? Promise.all(reste.map(__i18nSansEchec)).then(rassurer) : null;
        };
        // au démarrage la bascule va toujours au bout : un fragment qui échoue est attendu comme les autres (son module garde le texte de la langue par défaut), et rien ne revient en arrière
        pret = pret.then(rassurer).then(null, function() {});
      }

      pret.then(function() {
        if (myGen !== __i18nSwapGen) return; // bascule périmée, une plus récente a pris le relais
        µ._mjs_i18nSwapPending = false;
        µ._mjs_i18nPrevLang = null;
        __i18nDisplayedLang = newLang;
        // les modules gelés depuis le démarrage se rendent dans la langue voulue ; celle du démarrage ne se voit pas comme un changement : ni crochets
        // (`*lang`), ni mémoire de la langue, ni adresse (la page n'a rien demandé de plus que son adresse)
        __i18nApres.splice(0).forEach(function(r) { r(); });
        if (demarrage) {
          µ._mjs_i18nComps.forEach(function(comp) { comp._mjs_invalidate('_awaits_'); });
          return;
        }
        // une bascule qui se voit (effet *lang) : ses crochets sont prévenus AVANT la vague, ils
        // regardent ce qu'elle change
        if (µ._mjs_i18nSwapHooks) {
          µ._mjs_i18nSwapHooks.forEach(function(h) {
            // retour à la langue d'avant avant que la bascule ait abouti (un clic ramène `µlang` à la langue de la graine pendant celle du démarrage) : rien ne change à l'écran, aucun crochet
            if (newLang === prevLang) { return; }
            try { h(newLang, prevLang); } catch (e) { µ.error(µ._mjs_msg('i18nHook', null, 'i18n : crochet de bascule en erreur :'), e); }
          });
        }
        µ._mjs_i18nComps.forEach(function(comp) { comp._mjs_invalidate('_awaits_'); }); // swap ATOMIQUE
        // Persistance — mémorise la langue CIBLE une fois le swap complet.
        // `typeof localStorage` DANS le try (même motif qu'en tête de fichier,
        // __i18nDetectInitialLang) : sans ça, une origine opaque faisait avorter le reste de
        // ce `.then()` (bloc `?lang=` ci-dessous jamais atteint) en unhandled rejection.
        if (!µ._isServer && µ._i18nData.persist) {
          try {
            if (typeof localStorage !== 'undefined') { localStorage.setItem(__I18N_STORAGE_KEY, newLang); }
          } catch (e) { /* quota/sandbox/typeof sur origine opaque : ignoré */ }
        }
        // URL `?lang=` (urlParam) — reflète la langue CIBLE ;
        // retirée si c'est la langue par défaut (URL canonique propre). Ne touche
        // jamais le DOM (`replaceState`) : compatible SSR render-then-replace.
        if (!µ._isServer && µ._i18nData.urlParam && typeof location !== 'undefined' && typeof history !== 'undefined' && history.replaceState) {
          try {
            var url = new URL(location.href);
            if (newLang === µ._i18nData.default) { url.searchParams.delete('lang'); }
            else { url.searchParams.set('lang', newLang); }
            history.replaceState(history.state, '', url.pathname + url.search + url.hash);
          } catch (e) { /* ignoré */ }
        }
      }, function() {
        if (myGen !== __i18nSwapGen) return; // idem : ne pas écraser une bascule plus récente
        µ._mjs_i18nSwapPending = false;
        µ._mjs_i18nPrevLang = null;
        µ._storeSet('__mjsLang', prevLang); // REVERT — déjà en cache, swap-retour immédiat
      });
    });
  }
  // le guetteur de `µlang` que ce démarrage vient d'inscrire, le dernier du magasin (ceux de l'application, inscrits avant lui, ont déjà vu la langue
  // voulue) : la bascule du démarrage l'appelle tout droit, sans repasser par `µ._storeSet` qui la ferait voir une seconde fois aux autres
  var guetteur = null;
  var inscrits = typeof µ._mjs_storeWatch === 'function' && µ._mjs_storeWatchers && µ._mjs_storeWatchers.get('__mjsLang');
  if (inscrits) { inscrits.forEach(function(f) { guetteur = f; }); }
  // page rendue dans une autre langue que la voulue : elle garde celle de la graine, la bascule du démarrage (celle du guetteur de `µlang`, déclenchée
  // plus bas, une fois les modules inscrits) la fait passer d'un coup quand les textes voulus sont là
  var voulue = __i18nDisplayedLang;
  var depart = !!__i18nSeedLang && !!voulue && voulue !== __i18nSeedLang && !!guetteur;
  if (depart) { __i18nDisplayedLang = __i18nSeedLang; }
  // Rejoue la VRAIE logique de montage pour chaque
  // composant mis en file AVANT ce boot (registre + `_ensure` + notification
  // à l'arrivée, cf. `_mjs_mountReal`). Un composant en mode 'wait' avait reçu une
  // promesse "d'attente de boot" (`_mjs_i18nBootWaitPromise`) : on la résout ICI
  // avec le résultat RÉEL de `_mjs_mountReal` (elle-même sûre).
  if (µ._mjs_i18nPendingMounts.size > 0) {
    var toMount = µ._mjs_i18nPendingMounts;
    µ._mjs_i18nPendingMounts = new Set();
    toMount.forEach(function(comp) {
      // un module gelé n'était pas dans la photo du serveur : il s'inscrit pour la langue voulue (ses fragments partent avec ceux de la bascule) et ne paraît qu'à la fin de celle-ci
      var gele = depart && !!comp._mjs_i18nBootWaitResolve;
      if (gele) { __i18nDisplayedLang = voulue; }
      var p = µ.i18n._mjs_mountReal(comp);
      if (gele) {
        __i18nDisplayedLang = __i18nSeedLang;
        p = new Promise(function(r) { __i18nApres.push(r); });
      }
      var resolve = comp._mjs_i18nBootWaitResolve;
      if (resolve) {
        comp._mjs_i18nBootWaitResolve = null;
        comp._mjs_i18nBootWaitPromise = null;
        // le config est connu depuis le démarrage seulement : l'indicateur d'un module monté avant lui paraît ici
        // <i18n-loader-appel>
        if (p) { __i18nLoaderOn(comp); }
        // </i18n-loader-appel>
        if (p) { p.then(resolve, function() { resolve(null); }); } else { resolve(null); }
      } else {
        // 'key'/'*skeleton' — ce composant s'est rendu EN PLACEHOLDER pendant l'attente du
        // fichier de langue (le démarrage n'est plus synchrone) : sans cette
        // réinvalidation, une clé RACINE resterait vide à vie (aucune section à
        // attendre, donc aucune notification à venir de `_ensure`). Sauf quand la section du
        // composant est EN VOL : l'arrivée du fragment le rendra (`_ensure`), un rendu de plus
        // ici n'afficherait que le même placeholder (3 rendus au lieu de 2 au montage à froid).
        var section = comp._mjs_i18n && comp._mjs_i18n[0];
        var vol = section ? µ._i18nCache.get(__i18nEffectiveLang() + '/' + section) : null;
        // <i18n-paquets-demarrage>
        vol = __i18nPaquetsVol(comp, vol);
        // </i18n-paquets-demarrage>
        // rendu avec la graine dans la langue qui s'est confirmée, et rien n'a manqué : il est déjà juste
        var graineSuffit = comp._mjs_i18nProv && comp._mjs_i18nProv === __i18nDisplayedLang && !comp._mjs_i18nRedo && !__i18nRedoAll;
        if (!graineSuffit) {
          // fragment en vol qui ÉCHOUE : personne ne préviendrait ce composant, ses autres textes (clé
          // racine, autre section) resteraient en attente — il est alors rendu à l'échec
          if (vol && vol.data == null) { vol.promise.catch(function() { if (comp.isConnected) { comp._mjs_invalidate('_awaits_'); } }); }
          else { comp._mjs_invalidate('_awaits_'); }
        }
        comp._mjs_i18nProv = null;
        comp._mjs_i18nRedo = false;
      }
    });
    __i18nRedoAll = false;
  }
  if (depart) {
    // le guetteur voit la langue de la graine passer à la voulue, comme à un clic sur `µlang`
    __i18nDemarrage = true;
    guetteur(voulue);
  }
}
__i18nBoot();
if (!µ._mjs_i18nBooted) { queueMicrotask(__i18nBoot); }
// cascade de modules — cf. le bandeau détaillé au-dessus de `__i18nBoot` : le
// manifest (writeManifest, bundler/index.ts) appelle CE hook explicitement,
// juste après avoir posé `µ._i18nData`, pour un rattrapage qui ne dépend plus
// d'un timing de microtâche implicite. Idempotent (garde `µ._mjs_i18nBooted` en
// tête de `__i18nBoot`) — un appel de trop (double manifest exécuté, HMR) ne
// fait rien de plus qu'un `return` immédiat.
µ._i18nRecheck = __i18nBoot;
