// mjs_modal — µ.modal.fire(options) : modale maison inspirée de SweetAlert2 (API et forme du
// résultat familières), 100% implémentée en interne, ZÉRO dépendance externe. Remplace l'ancien
// point d'accroche 'sweetalert2' de µ.confirm (mjs_ujs.ts, qui lisait window.Swal) — µ.modal
// reste utilisable DIRECTEMENT par une appli, indépendamment de @confirm.
//
// Contrat : µ.modal.fire(options) → Promise<{isConfirmed, isDenied, isDismissed, value, dismiss}>
// (jamais de rejet — toute fermeture, quelle qu'en soit la cause, RÉSOUT la promesse). Vocabulaire
// de `dismiss` : undefined (confirmé/refusé — pas une fermeture passive), 'cancel', 'backdrop',
// 'esc', 'timer', 'close' (µ.modal.close(), fermeture programmatique globale). Un appel MALFORMÉ,
// lui, lève SYNCHRONEMENT avant que la promesse n'existe (cf. __modalNormalize plus bas) : une
// erreur de programmation reste bruyante et pointe l'appelant, sans jamais se déguiser en
// « l'utilisateur a annulé ».
//
// Périmètre v1 : title/text/html, 5 icônes (SVG inline,
// pas d'image externe), 2-3 boutons (confirm/deny/cancel), timer (dismiss:'timer'),
// allowOutsideClick/allowEscapeKey (défaut true), customClass (zéro style inline), focus trap
// (Tab/Shift+Tab bouclent DANS la modale) + retour de focus à la fermeture, inputs
// text/textarea/select/checkbox + inputValidator/preConfirm.
//
// « µmodal complet » : `showConfirmButton`
// (défaut true, bouton confirm optionnel — focus de repli sur la boîte elle-même, tabindex="-1",
// si zéro bouton) ; 4 raccourcis µ.modal.success/error/info/warn(arg) ; sucre global µmodal →
// µ.modal (sigils.ts, MU_SHORT_GLOBALS) ; µ.modal.notify(message, opts) — toast empilé en
// haut-droite (div.mjs-toasts), carte à 3 colonnes (icône, titre +
// message, croix), dégradé de couleur et barre de vie en haut, fermeture au clic sur
// ×, au clic sur le toast entier s'il est cliquable (opts.href/opts.onClick) ou auto-retrait ; µ.modal.wait(arg) — modale
// d'attente (spinner, zéro bouton) ; µ.modal.close(result) — fermeture programmatique GLOBALE de
// la modale courante ; couche sonore opt-in (µ.config.modalSound, mjs_init.ts) — signatures
// WebAudio embarquées ou fichier par type, jamais bruyante en cas d'échec (politique autoplay).
//
// µ.config.notifyMax (mjs_init.ts, défaut 5,
// false/0/Infinity = illimité) plafonne les toasts AFFICHÉS simultanément — façon « succès
// Steam », au-delà mis EN FILE FIFO, ZÉRO éviction (un toast affiché n'est jamais chassé, le
// suivant démarre sa durée de vie PLEINE quand une place se libère) ; µ.sound(type, override) —
// signatures sonores de la couche modale rendues PUBLIQUES, utilisables PARTOUT dans l'app, joue
// TOUJOURS (le gate µ.config.modalSound=false ne s'applique qu'aux sons automatiques des
// modales/toasts) ; sucre µsound → µ.sound (sigils.ts, MU_SHORT_GLOBALS).
//
// le plafond effectif est le PLUS BAS des deux — notifyMax et « ce qui tient à l'écran ».
// La place disponible est mesurée à chaque affichage réel (__toastRoom/__toastFits) : un toast
// qui ferait sortir la pile de la fenêtre RESTE en file au lieu de déborder, et apparaît quand
// une place se libère. Zéro éviction inchangé — le refusé n'est jamais perdu, jamais chassé.
//
// HORS PÉRIMÈTRE : inputs file/range/radio, Swal.mixin,
// queue multi-étapes, empilement de plusieurs MODALES simultanées (le toast, lui, s'empile
// nativement), RTL auto.
//
// Pattern CSS — ZÉRO style inline sur le DOM (règle nº1 MJS) : feuille adoptée dédiée, MÊME
// patron que µ._mjs_shield/µ._mjs_systemSheet (mjs_init.ts:24-47). Classes préfixées `mjs-modal-*`
// (cohérent avec `.mjs-fatal-error`/`.mjs-error`, mjs_init.ts:44-45). La modale (backdrop + boîte)
// est ajoutée à document.body, et non à l'intérieur d'un composant : c'est un élément d'UI framework
// GLOBAL, comme window.confirm/SweetAlert2, pas un composant applicatif. Pendant un plein écran
// (API Fullscreen), le corps n'est pas affiché : elle se pose alors dans l'élément en plein écran,
// ou dans son ombre quand il en a une (cf. __modalHost), et reprend sa place dans le corps à la sortie.
µ._mjs_modalSheet = new CSSStyleSheet();

µ._mjs_modalSheet.replaceSync(`:where(.mjs-modal-backdrop){position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;background:var(--mjs-modal-backdrop, rgba(0,0,0,.55));z-index:100000;animation:mjs-modal-fade .15s ease-out}
:where(.mjs-modal-box){box-sizing:border-box;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;margin:auto;padding:28px 24px 24px;background:var(--mjs-modal-bg, var(--mjs-surface));color:var(--mjs-modal-fg, var(--mjs-fg));border-radius:var(--mjs-modal-radius, 8px);box-shadow:var(--mjs-modal-shadow, 0 10px 40px var(--mjs-shadow, rgba(0,0,0,.25)));text-align:center;animation:mjs-modal-pop .15s ease-out;outline:none}
:where(.mjs-modal-icon){width:56px;height:56px;margin:0 auto 12px;color:var(--mjs-modal-icon-question, #6b7280)}
:where(.mjs-modal-icon svg){display:block;width:100%;height:100%}
:where(.mjs-modal-icon-success){color:var(--mjs-modal-icon-success, #2e9e5b)}
:where(.mjs-modal-icon-error){color:var(--mjs-modal-icon-error, #d64545)}
:where(.mjs-modal-icon-warning){color:var(--mjs-modal-icon-warning, #e0a020)}
:where(.mjs-modal-icon-info){color:var(--mjs-modal-icon-info, #3085d6)}
:where(.mjs-modal-icon-question){color:var(--mjs-modal-icon-question, #6b7280)}
:where(.mjs-modal-title){margin:0 0 8px;font-size:1.25em;font-weight:600;line-height:1.3}
:where(.mjs-modal-content){margin:0 0 14px;font-size:1em;line-height:1.4;color:var(--mjs-modal-muted, var(--mjs-fg-muted, #444))}
:where(.mjs-modal-input-container){margin:0 0 14px;text-align:left}
:where(.mjs-modal-input){box-sizing:border-box;width:100%;padding:8px 10px;background-color:var(--mjs-modal-input-bg, var(--mjs-surface, transparent));color:var(--mjs-modal-input-fg, var(--mjs-fg, inherit));border:1px solid var(--mjs-modal-border, var(--mjs-border, #d0d0d0));border-radius:var(--mjs-modal-btn-radius, 4px);font:inherit}
:where(.mjs-modal-textarea){min-height:80px;resize:vertical}
:where(.mjs-modal-checkbox){width:auto}
:where(.mjs-modal-validation-message){margin:0 0 14px;padding:8px 10px;border-radius:var(--mjs-modal-btn-radius, 4px);background:var(--mjs-modal-error-bg, color-mix(in srgb, var(--mjs-modal-icon-error, #d64545) 14%, transparent));color:var(--mjs-modal-error-fg, var(--mjs-modal-icon-error, #d64545));font-size:.9em;text-align:left}
:where(.mjs-modal-actions){display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
:where(.mjs-modal-btn){border:0;border-radius:var(--mjs-modal-btn-radius, 4px);padding:10px 20px;font:inherit;font-weight:600;cursor:pointer}
:where(.mjs-modal-btn:disabled){cursor:default;opacity:.6}
:where(.mjs-modal-confirm){background:var(--mjs-modal-confirm-bg, #3085d6);color:var(--mjs-modal-confirm-fg, #fff)}
:where(.mjs-modal-deny){background:var(--mjs-modal-deny-bg, #e0a020);color:var(--mjs-modal-deny-fg, #fff)}
:where(.mjs-modal-cancel){background:var(--mjs-modal-cancel-bg, var(--mjs-hover, #e8e8e8));color:var(--mjs-modal-cancel-fg, var(--mjs-fg, #333))}
@keyframes mjs-modal-fade{from{opacity:0}to{opacity:1}}
@keyframes mjs-modal-pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
:where(.mjs-modal-spinner){width:40px;height:40px;margin:0 auto 12px;border:4px solid var(--mjs-modal-spinner-track, var(--mjs-border, #e0e0e0));border-top-color:var(--mjs-modal-spinner-fg, var(--mjs-modal-confirm-bg, #3085d6));border-radius:50%;animation:mjs-modal-spin .8s linear infinite}
@keyframes mjs-modal-spin{to{transform:rotate(360deg)}}
:where(.mjs-toasts){position:fixed;z-index:100001;display:flex;gap:8px;width:min(var(--mjs-toast-width, 400px), calc(100vw - 32px))}
:where(.mjs-toasts-top-right){top:16px;right:16px;flex-direction:column}
:where(.mjs-toasts-top-left){top:16px;left:16px;flex-direction:column;--mjs-toast-from:-100%}
:where(.mjs-toasts-bottom-right){bottom:16px;right:16px;flex-direction:column-reverse}
:where(.mjs-toasts-bottom-left){bottom:16px;left:16px;flex-direction:column-reverse;--mjs-toast-from:-100%}
:where(.mjs-toasts-quarter-top-right){top:25%;right:16px;flex-direction:column}
:where(.mjs-toasts-quarter-top-left){top:25%;left:16px;flex-direction:column;--mjs-toast-from:-100%}
:where(.mjs-toasts-quarter-bottom-right){bottom:25%;right:16px;flex-direction:column-reverse}
:where(.mjs-toasts-quarter-bottom-left){bottom:25%;left:16px;flex-direction:column-reverse;--mjs-toast-from:-100%}
:where(.mjs-toasts-custom){top:var(--mjs-toasts-top, auto);right:var(--mjs-toasts-right, auto);bottom:var(--mjs-toasts-bottom, auto);left:var(--mjs-toasts-left, auto);flex-direction:column}
:where(.mjs-toasts-flow-down){flex-direction:column}
:where(.mjs-toasts-flow-up){flex-direction:column-reverse}
:where(.mjs-toast){position:relative;overflow:hidden;display:grid;grid-template-columns:var(--mjs-toast-cols, 70px 1fr 70px);align-items:center;padding:var(--mjs-toast-padding, 10px);border-radius:var(--mjs-toast-radius, 5px);color:var(--mjs-toast-fg, #fff);--mjs-toast-color:var(--mjs-toast-border, var(--mjs-modal-border, var(--mjs-border)));background:var(--mjs-toast-bg, linear-gradient(to right, color-mix(in srgb, var(--mjs-toast-color) 80%, transparent), var(--mjs-toast-bg-base, #22242F) 25%));box-shadow:var(--mjs-toast-shadow, 0 10px 30px -8px var(--mjs-shadow), 0 2px 8px -4px var(--mjs-shadow));animation:mjs-toast-entree var(--mjs-toast-entree-duree, .3s) ease forwards}
:where(.mjs-toast-icon){display:flex;align-items:center;justify-content:center;color:var(--mjs-toast-color)}
:where(.mjs-toast-icon svg, .mjs-toast-icon img){width:var(--mjs-toast-icon-size, 28px);height:var(--mjs-toast-icon-size, 28px);object-fit:contain}
:where(.mjs-toast-no-icon .mjs-toast-content){grid-column:1 / span 2}
:where(.mjs-toast-content){min-width:0}
:where(.mjs-toast-title){font-size:var(--mjs-toast-title-size, x-large);font-weight:bold;line-height:1.2}
:where(.mjs-toast-message){display:block;opacity:.6;font-size:.95em;line-height:1.4;word-break:break-word}
:where(.mjs-toast-close){justify-self:center;border:0;background:transparent;color:inherit;cursor:pointer;font-size:1.4em;line-height:1;padding:4px;opacity:.6}
:where(.mjs-toast-close:hover){opacity:1}
:where(.mjs-toast-action){position:absolute!important;top:0!important;left:0!important;box-sizing:border-box!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;border-radius:inherit!important;background:transparent!important;color:inherit!important;font:inherit!important;appearance:none!important;cursor:pointer;outline-offset:-4px!important}
:where(.mjs-toast-action:hover){background:var(--mjs-toast-hover-bg, color-mix(in srgb, var(--mjs-toast-fg, #fff) 10%, transparent))!important}
:where(.mjs-toast-action:active){background:var(--mjs-toast-active-bg, color-mix(in srgb, var(--mjs-toast-fg, #fff) 18%, transparent))!important}
:where(.mjs-toast-action:focus-visible){outline:2px solid var(--mjs-toast-focus, var(--mjs-toast-fg, #fff))!important}
:where(.mjs-toast-action ~ .mjs-toast-close){position:relative}
:where(.mjs-toast-action ~ .mjs-toast-barre){pointer-events:none}
:where(.mjs-toast-barre){position:absolute;left:0;top:0;height:3px;background:var(--mjs-toast-color);box-shadow:0 0 10px var(--mjs-toast-color);animation:mjs-toast-vie var(--mjs-toast-duration, 4000ms) linear forwards}
:where(.mjs-toast-paused .mjs-toast-barre){animation-play-state:paused}
:where(.mjs-toast-swipe){touch-action:pan-y}
:where(.mjs-toast-dragging){translate:var(--mjs-toast-dx, 0) 0;-webkit-user-select:none;user-select:none}
:where(.mjs-toast-sliding){translate:var(--mjs-toast-dx, 0) 0;transition:translate .2s ease}
:where(.mjs-toast-success){--mjs-toast-color:var(--mjs-toast-success, var(--mjs-modal-icon-success, #2e9e5b))}
:where(.mjs-toast-error){--mjs-toast-color:var(--mjs-toast-error, var(--mjs-modal-icon-error, #d64545))}
:where(.mjs-toast-warning){--mjs-toast-color:var(--mjs-toast-warning, var(--mjs-modal-icon-warning, #e0a020))}
:where(.mjs-toast-info){--mjs-toast-color:var(--mjs-toast-info, var(--mjs-modal-icon-info, #3085d6))}
@keyframes mjs-toast-vie{from{width:100%}to{width:0%}}
@keyframes mjs-toast-entree{0%{transform:translateX(var(--mjs-toast-from, 100%))}40%{transform:translateX(calc(var(--mjs-toast-from, 100%) * -.05))}100%{transform:translateX(0)}}`);

// adoptée dans l'ombre d'un composant (plein écran, cf. __modalAdoptSheet), elle reste quand ce composant repose ses feuilles
// (variante de mise en page, reconnexion — cf. _mjs_applyLayout) : sans la marque, la modale ouverte ou le conteneur des
// notifications perdait toute sa mise en forme. Tenue par µ, donc jamais jetée par le navigateur
µ._mjs_modalSheet._mjs_keep = true;

document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_modalSheet];

// Libellés par défaut (fr/en) des boutons — cf. src/runtime-labels.ts (bundler) : µ._runtimeLabels
// posé INCONDITIONNELLEMENT par le manifest (writeManifest, bundler/index.ts), dans TOUS les
// builds (contrairement à µ._i18nData, module i18n optionnel), en
// TOUTES langues (`{ fr: {…}, en: {…} }`) — le choix de la langue AFFICHÉE se fait ICI, à chaque
// appel, via µ._mjs_label (mjs_init.ts), jamais figé au build. Absent (vieux manifest, usage
// standalone hors bundler complet — scénario défensif, même esprit que le fallback inerte de
// mjs_i18n.ts:39-43) → repli statique codé en dur, jamais un crash faute de manifest.
var __modalLabelsFallback = { ok: 'OK', cancel: 'Annuler', deny: 'Non' };
function __modalLabel(key) {
  return (typeof µ._mjs_label === 'function' && µ._mjs_label('modal', key)) || __modalLabelsFallback[key];
}

// même mécanisme pour le titre par défaut des toasts (fr/en, cf. src/runtime-labels.ts, groupe
// toast) — clé absente (vieux manifest) → repli statique fr, même esprit que __modalLabel ci-dessus
var __toastTitlesFallback = { success: 'Succès', error: 'Erreur', warning: 'Attention', info: 'Info' };
function __toastTitle(type) {
  return (typeof µ._mjs_label === 'function' && µ._mjs_label('toast', type)) || __toastTitlesFallback[type];
}

// écrit des libellés par défaut (boutons de la modale, titre d'un toast) par `fn`, aussitôt : lus sans le fichier de la langue (réseau
// lent), `fn` les récrit à son arrivée s'il les surcharge, la modale encore ouverte, le toast encore là (µ._mjs_labelKeep,
// mjs_i18n.ts) ; sans module i18n, `fn` seule
function __modalKeep(fn) {
  if (µ._mjs_labelKeep) { µ._mjs_labelKeep(fn); }
  else { fn(); }
}

// Icônes 5 états — SVG inline (pas d'image externe), colorées via currentColor + la classe
// mjs-modal-icon-<nom> (feuille ci-dessus). aria-hidden : décoratif, le sens vient du title/text.
var __modalIcons = {
  success:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-7"/></svg>',
  error:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>',
  warning:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5L22 20.5H2z"/><path d="M12 9.5v5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor" stroke="none"/></svg>',
  info:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 11v5.5"/><circle cx="12" cy="7.5" r=".6" fill="currentColor" stroke="none"/></svg>',
  question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.3 9.5a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.2 1-1.2 2.1"/><circle cx="12" cy="16.8" r=".6" fill="currentColor" stroke="none"/></svg>',
};

// Éléments focusables DANS la boîte — la boîte est construite en LIGHT DOM (des div, des boutons, des
// champs : posée dans le corps ou, en plein écran, dans l'élément en plein écran ou son ombre, cf.
// __modalHost) : pas besoin du walker récursif shadow-aware µ._mjs_deepFind (mjs_ujs.ts) qui traverse aussi
// les `_shadow` de composants — un querySelectorAll suffit. Un composant du `html` n'y est vu que par sa
// balise, quand elle porte un `tabindex` : son ombre n'est pas parcourue.
var __MODAL_FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
function __modalFocusable(box) {
  var list = box.querySelectorAll(__MODAL_FOCUSABLE_SEL);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (!list[i].disabled) { out.push(list[i]); }
  }
  return out;
}

// plein écran (API Fullscreen) : le navigateur n'affiche plus que l'élément plein écran et sa
// descendance — posée dans le corps, la modale restait invisible derrière lui. Elle se pose donc DANS
// cet élément. `document.fullscreenElement` ne rend que l'hôte de premier niveau d'un élément qui vit
// dans une ombre : on descend d'ombre en ombre (ombre MJS fermée, lue par `_shadow` ; ombre ouverte,
// par `shadowRoot`). Un hôte lui-même en plein écran n'affiche pas ses enfants directs : la modale va
// dans son ombre. Le corps reste l'hôte hors plein écran, quand l'élément contient déjà le corps
// (<html>) ou quand il n'affiche aucun enfant (vidéo, image, canevas…)
// `contains` (et `focus`, cf. __modalRestoreFocus) se prennent au prototype : un composant peut définir `@contains`
// ou `@focus` pour son propre usage (noms naturels, laissés libres), et sa méthode masque celle de sa balise —
// l'élément en plein écran comme l'élément qui avait le focus sont souvent la balise d'un composant
var __MODAL_NO_CHILDREN = { VIDEO: 1, AUDIO: 1, CANVAS: 1, IMG: 1, IFRAME: 1, EMBED: 1, OBJECT: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1 };

// ombre d'un hôte, ouverte ou fermée — jamais l'élément lui-même (composant léger : `_shadow` = lui)
function __modalShadowOf(el) {
  var root = el.shadowRoot || el._shadow;
  return root && root !== el && root.nodeType === 11 ? root : null;
}

function __modalHost() {
  var el = document.fullscreenElement, root;
  if (!el || Node.prototype.contains.call(el, document.body)) { return document.body; }
  while ((root = __modalShadowOf(el))) {
    if (!root.fullscreenElement || root.fullscreenElement === el) { return root; }
    el = root.fullscreenElement;
  }
  if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || __MODAL_NO_CHILDREN[el.tagName]) { return document.body; }
  return el;
}

// le focus rendu à l'élément qui l'avait. Sur la balise d'un composant (c'est elle que `document.activeElement` rend
// quand le focus est dans son ombre) : le `focus` du prototype, la méthode `@focus` du composant masquerait celui de
// sa balise. Tout autre élément — HTML, SVG, balise d'une autre bibliothèque — garde le sien : celui d'un SVG n'est
// pas celui d'un élément HTML (« Illegal invocation »), et une balise d'une autre bibliothèque peut le redéfinir.
// `options` : celles de `focus()` ; par défaut la page ne défile pas (`preventScroll`), le piège de Tab donne `{}` pour
// que l'élément atteint se voie
function __modalRestoreFocus(el, options) {
  options = options || { preventScroll: true };
  if (typeof µ.Element === 'function' && el instanceof µ.Element) { HTMLElement.prototype.focus.call(el, options); }
  else if (typeof el.focus === 'function') { el.focus(options); }
}

// l'élément qui a le focus, le plus profond : `document.activeElement` ne rend que l'hôte quand le focus est dans une
// ombre, et la balise d'un composant n'est en général pas focalisable — le focus ne pourrait pas lui revenir, il
// tomberait sur le corps. On descend d'ombre en ombre tant qu'une ombre porte un élément actif
function __modalActiveDeep() {
  var el = document.activeElement, root;
  while (el && (root = __modalShadowOf(el)) && root.activeElement) { el = root.activeElement; }
  return el;
}

// posée dans une ombre, la modale n'y voit pas les feuilles du document : la sienne y est adoptée
// (règles `:where(.mjs-modal-*)` seules, laissée en place après la fermeture, sans effet sur le reste)
function __modalAdoptSheet(host) {
  var root = host.nodeType === 11 ? host : host.getRootNode();
  if (root === document || !root.adoptedStyleSheets || root.adoptedStyleSheets.indexOf(µ._mjs_modalSheet) !== -1) { return; }
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, µ._mjs_modalSheet];
}

// Ajoute les classes d'un `customClass.<clé>` (chaîne, éventuellement plusieurs classes séparées
// par des espaces — même convention que `className`/`class=`) — zéro style inline, cf. en-tête.
function __modalApplyClass(el, extra) {
  if (!extra) { return; }
  var parts = String(extra).split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) { el.classList.add(parts[i]); }
  }
}

// Construit l'input demandé (text/textarea/select/checkbox — file/range/radio hors périmètre v1,
// cf. en-tête). Reçoit des options DÉJÀ normalisées (__modalNormalize) : `input` est forcément
// l'un des 4 types connus, `inputValue`/`inputPlaceholder` sont du texte (ou un booléen pour
// checkbox), et `inputOptions` est un tableau de paires [valeur, libellé] toutes deux en texte —
// plus aucune valeur hostile ne peut arriver jusqu'ici, donc plus rien à détecter ni à défendre.
function __modalBuildInput(options) {
  var el, i, opts, optEl;
  if (options.input === 'textarea') {
    el = document.createElement('textarea');
    el.className = 'mjs-modal-input mjs-modal-textarea';
    if (options.inputValue != null) { el.value = options.inputValue; }
  } else if (options.input === 'select') {
    el = document.createElement('select');
    el.className = 'mjs-modal-input mjs-modal-select';
    opts = options.inputOptions || [];
    for (i = 0; i < opts.length; i++) {
      optEl = document.createElement('option');
      optEl.value = opts[i][0];
      optEl.textContent = opts[i][1];
      el.appendChild(optEl);
    }
    if (options.inputValue != null) { el.value = options.inputValue; }
  } else if (options.input === 'checkbox') {
    el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'mjs-modal-input mjs-modal-checkbox';
    el.checked = !!options.inputValue;
  } else {
    el = document.createElement('input');
    el.type = 'text';
    el.className = 'mjs-modal-input mjs-modal-text';
    if (options.inputValue != null) { el.value = options.inputValue; }
  }
  if (options.inputPlaceholder && 'placeholder' in el) { el.placeholder = options.inputPlaceholder; }
  return el;
}

// Valeur courante de l'input — booléen pour checkbox, chaîne sinon (même convention que
// SweetAlert2 : `result.value` est le type natif de l'input, pas toujours une chaîne).
function __modalInputValue(inputEl, type) {
  if (!inputEl) { return void 0; }
  if (type === 'checkbox') { return inputEl.checked; }
  return inputEl.value;
}

// ============================================================================
// __modalNormalize — le garde-barrière des options (contrat « jamais de rejet »)
// ============================================================================
// Tout le corps de fire() vit dans l'executor de `new Promise(...)` : la moindre exception qui y
// part est convertie en REJET par le constructeur de Promise. Un try/catch ne suffirait pas — il
// faudrait alors inventer une valeur de résolution, et une faute de frappe dans les options
// deviendrait une modale « annulée toute seule », muette. La parade est en amont : rien
// d'hostile n'entre.
//   1. Un appel malformé LÈVE ICI, en synchrone, avant même que la promesse n'existe — la pile
//      pointe l'appelant, pas les entrailles du runtime.
//   2. fire() ne travaille ensuite que sur une COPIE normalisée : chaînes, booléens, nombres,
//      tableaux et fonctions déjà extraits. Un getter piégé, un Symbol, un `toString` qui
//      explose, un Proxy hostile : chaque valeur n'est lue QU'UNE FOIS, ici, sous protection —
//      d'où l'importance de recopier plutôt que de simplement valider (un getter peut très bien
//      renvoyer une valeur saine à la vérification et une bombe à la seconde lecture).
// Doctrine de sévérité, alignée sur le reste du runtime : on LÈVE sur un TYPE faux (erreur de
// programmation, non récupérable) ; on AVERTIT et on retombe sur le défaut pour une VALEUR
// inconnue d'un type juste (`icon: 'succes'` mal orthographié) — la tolérance déjà documentée
// pour `input`. Plus rien n'est avalé en silence.
var __MODAL_TEXT_KEYS  = ['title', 'text', 'html', 'confirmButtonText', 'denyButtonText', 'cancelButtonText', 'inputPlaceholder'];
// `spinner` : booléen interne (posé par µ.modal.wait, mais utilisable directement) — insère
// .mjs-modal-spinner dans la boîte, cf. fire() plus bas.
var __MODAL_BOOL_KEYS  = ['showDenyButton', 'showCancelButton', 'showConfirmButton', 'allowOutsideClick', 'allowEscapeKey', 'spinner'];
var __MODAL_FN_KEYS    = ['inputValidator', 'preConfirm'];
var __MODAL_CLASS_KEYS = ['backdrop', 'box', 'icon', 'title', 'htmlContainer', 'input', 'validationMessage', 'actions', 'confirmButton', 'denyButton', 'cancelButton'];
var __MODAL_INPUTS     = ['text', 'textarea', 'select', 'checkbox'];

function __modalErr(msg) {
  return new TypeError('[ModularJS] µ.modal.fire — ' + msg);
}

// Raison lisible d'une exception, sans jamais lever à son tour (l'objet levé peut être
// n'importe quoi, y compris un piège dont le `message` ou le `toString` explose aussi).
function __modalReason(e) {
  try { return (e && e.message) ? String(e.message) : String(e); } catch { return 'raison non affichable'; }
}

// Lecture d'une option PROPRE de l'appelant : une option qu'il n'a pas donnée vaut l'absence d'option, jamais la valeur
// d'un prototype — un `Object.prototype.html` posé par une clé venue de données devenait le HTML de toute modale, et
// son script tournait. `herite` : la lecture suit le prototype (les méthodes d'une Map, qui vivent sur Map.prototype).
// Un getter (ou un trap de Proxy) qui lève devient une erreur claire, nommant la clé fautive, au lieu d'une pile opaque
// venue du fond du runtime.
function __modalPick(obj, key, where, herite) {
  try { return (herite || Object.prototype.hasOwnProperty.call(obj, key)) ? obj[key] : void 0; }
  catch (e) { throw __modalErr(µ._mjs_txt('modalRead', { where: where, reason: __modalReason(e) }, 'la lecture de `{where}` a échoué : {reason}.')); }
}

// Conversion en texte. `String()` accepterait un Symbol ou une fonction — deux valeurs qui
// n'ont aucun sens ici et trahissent une erreur d'appel : on les refuse explicitement.
function __modalText(v, key) {
  if (typeof v === 'string') { return v; }
  if (typeof v === 'symbol' || typeof v === 'function') {
    throw __modalErr(µ._mjs_txt('modalWantsText', { key: key, type: typeof v }, '`{key}` attend du texte, reçu {type}.'));
  }
  try { return String(v); }
  catch (e) { throw __modalErr(µ._mjs_txt('modalNotText', { key: key, reason: __modalReason(e) }, '`{key}` n\'a pas pu être converti en texte : {reason}.'));  }
}

// inputOptions → tableau de paires [valeur, libellé], toutes deux en texte. Objet simple OU Map,
// y compris une Map d'un AUTRE réalm (iframe, sandbox de test) : la détection reste du
// duck-typing — `instanceof Map` échouerait — mais elle exige les trois signes à la fois, dont
// `Symbol.iterator`, symbole bien connu STABLE entre réalms. Un objet qui imite les trois sans
// être parcourable est désormais une ERREUR nommée, plus un rejet de promesse silencieux.
function __modalPairs(src, key) {
  var isMapLike, keys, out = [], i, k, label;
  isMapLike = typeof __modalPick(src, 'get', key + '.get', true) === 'function'
    && typeof __modalPick(src, 'keys', key + '.keys', true) === 'function'
    && typeof __modalPick(src, Symbol.iterator, key + '[Symbol.iterator]', true) === 'function';
  if (isMapLike) {
    try { keys = Array.from(src.keys()); }
    catch (e) { throw __modalErr(µ._mjs_txt('modalMapKeys', { key: key, reason: __modalReason(e) }, '`{key}` ressemble à une Map mais son `keys()` n\'est pas parcourable : {reason}.')); }
  } else {
    try { keys = Object.keys(src); }
    catch (e) { throw __modalErr(µ._mjs_txt('modalNotIterable', { key: key, reason: __modalReason(e) }, '`{key}` n\'a pas pu être parcouru : {reason}.')); }
  }
  for (i = 0; i < keys.length; i++) {
    k = keys[i];
    if (isMapLike) {
      try { label = src.get(k); }
      catch (e) { throw __modalErr(µ._mjs_txt('modalGetFailed', { key: key, reason: __modalReason(e) }, '`{key}.get()` a échoué : {reason}.')); }
    } else {
      label = __modalPick(src, k, key + '.' + String(k));
    }
    out.push([__modalText(k, key + ' (clé)'), __modalText(label, key + ' (libellé)')]);
  }
  return out;
}

// copie sans prototype : fire() n'y lit que ce que l'appelant a donné
function __modalNormalize(raw) {
  var o = Object.create(null), i, k, v, cc, ccOut;

  if (raw == null) { return o; }
  if (typeof raw !== 'object' && typeof raw !== 'function') {
    throw __modalErr(µ._mjs_txt('modalOptsObject', { type: typeof raw }, 'les options doivent être un objet, reçu {type}.'));
  }

  for (i = 0; i < __MODAL_TEXT_KEYS.length; i++) {
    k = __MODAL_TEXT_KEYS[i];
    v = __modalPick(raw, k, k);
    if (v != null) { o[k] = __modalText(v, k); }
  }

  // `!!` sur tout ce qui est fourni : `showCancelButton: 0` reste faux, comme avant.
  for (i = 0; i < __MODAL_BOOL_KEYS.length; i++) {
    k = __MODAL_BOOL_KEYS[i];
    v = __modalPick(raw, k, k);
    if (v !== void 0) { o[k] = !!v; }
  }

  for (i = 0; i < __MODAL_FN_KEYS.length; i++) {
    k = __MODAL_FN_KEYS[i];
    v = __modalPick(raw, k, k);
    if (v == null) { continue; }
    if (typeof v !== 'function') { throw __modalErr(µ._mjs_txt('modalWantsFn', { key: k, type: typeof v }, '`{key}` doit être une fonction, reçu {type}.')); }
    o[k] = v;
  }

  v = __modalPick(raw, 'icon', 'icon');
  if (v != null) {
    if (typeof v !== 'string') { throw __modalErr(µ._mjs_txt('modalIconString', { type: typeof v }, '`icon` doit être une chaîne, reçu {type}.')); }
    if (Object.prototype.hasOwnProperty.call(__modalIcons, v)) { o.icon = v; }
    else { µ.warn(µ._mjs_msg('modalUnknownIcon', { v: v, list: Object.keys(__modalIcons).join(', ') }, 'µ.modal.fire — icône inconnue « {v} », ignorée (attendu : {list}).')); }
  }

  v = __modalPick(raw, 'input', 'input');
  if (v != null) {
    if (typeof v !== 'string') { throw __modalErr(µ._mjs_txt('modalInputString', { type: typeof v }, '`input` doit être une chaîne, reçu {type}.')); }
    if (__MODAL_INPUTS.indexOf(v) !== -1) { o.input = v; }
    else {
      µ.warn(µ._mjs_msg('modalUnknownInput', { v: v, list: __MODAL_INPUTS.join(', ') }, 'µ.modal.fire — type d\'input inconnu « {v} », repli sur « text » (attendu : {list}).'));
      o.input = 'text';
    }
  }

  // Après le bloc `input` : le type est connu, donc on sait si la valeur est un booléen ou du texte.
  v = __modalPick(raw, 'inputValue', 'inputValue');
  if (v != null) { o.inputValue = o.input === 'checkbox' ? !!v : __modalText(v, 'inputValue'); }

  v = __modalPick(raw, 'inputOptions', 'inputOptions');
  if (v != null) {
    if (typeof v !== 'object' && typeof v !== 'function') {
      throw __modalErr(µ._mjs_txt('modalInputOptions', { type: typeof v }, '`inputOptions` doit être un objet ou une Map, reçu {type}.'));
    }
    o.inputOptions = __modalPairs(v, 'inputOptions');
  }

  // `timer` non fini (NaN, Infinity) ou d'un autre type = erreur ; une valeur ≤ 0 reste ignorée
  // en silence, comme avant (pas de minuterie, pas de message).
  v = __modalPick(raw, 'timer', 'timer');
  if (v != null) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw __modalErr(µ._mjs_txt('modalTimer', { got: (typeof v === 'number' ? String(v) : typeof v) }, '`timer` doit être un nombre de millisecondes, reçu {got}.'));
    }
    if (v > 0) { o.timer = v; }
  }

  cc = __modalPick(raw, 'customClass', 'customClass');
  if (cc != null) {
    if (typeof cc !== 'object' && typeof cc !== 'function') {
      throw __modalErr(µ._mjs_txt('modalCustomClass', { type: typeof cc }, '`customClass` doit être un objet, reçu {type}.'));
    }
    ccOut = Object.create(null);
    for (i = 0; i < __MODAL_CLASS_KEYS.length; i++) {
      k = __MODAL_CLASS_KEYS[i];
      v = __modalPick(cc, k, 'customClass.' + k);
      if (v != null) { ccOut[k] = __modalText(v, 'customClass.' + k); }
    }
    o.customClass = ccOut;
  }

  // `sound` : override PAR APPEL de la couche sonore (__modalSound plus bas) — `false` (silence),
  // ou une chaîne (fichier '/'|'.'|'http' ou nom de signature embarquée). Type juste (booléen ou
  // chaîne) mais valeur incomprise (ex. 'succes' mal orthographié) : tolérée ici, __modalSound
  // retombe alors sur µ.config.modalSound, jamais un throw pour un son qui ne joue simplement pas.
  v = __modalPick(raw, 'sound', 'sound');
  if (v != null) {
    if (typeof v !== 'string' && typeof v !== 'boolean') {
      throw __modalErr(µ._mjs_txt('modalSoundType', { type: typeof v }, '`sound` doit être un booléen ou une chaîne, reçu {type}.'));
    }
    o.sound = v;
  }

  return o;
}

// ============================================================================
// __modalSound — couche sonore OPT-IN (µ.config.modalSound, mjs_init.ts)
// ============================================================================
// Jouée par fire() à l'ouverture (icône success/error/warning/info — question/aucune = silence)
// et par notify() (la signature de SON type — success/warning/info/error —, repli
// 'notify' si le type n'a pas de signature connue). `sound` d'un appel PRÉCIS prime
// toujours sur µ.config.modalSound (global). Politique autoplay : TOUT le chemin son est sous
// try/catch muet — jamais une erreur, jamais un warning pour un simple son qui ne joue pas
// (AudioContext absent, geste utilisateur manquant, fichier introuvable...).
var __MODAL_SOUND_NAMES = { success: 1, error: 1, warning: 1, info: 1, notify: 1 };
var __modalAudioCtx = null;

// constructeur AudioContext disponible (préfixé webkit ou non) — `typeof` : jamais de
// ReferenceError sur un global absent, contrairement à une référence nue.
function __modalAudioCtor() {
  if (typeof AudioContext !== 'undefined') { return AudioContext; }
  if (typeof webkitAudioContext !== 'undefined') { return webkitAudioContext; }
  return null;
}

// fichier audio (override chemin, ou µ.config.modalSound = {type: url}) — `.play()` peut REJETER
// (politique autoplay des navigateurs) : catch explicite en plus du try englobant, ce rejet est
// ASYNCHRONE et échapperait sinon au try/catch synchrone de __modalSound.
function __modalPlayFile(url) {
  var p;
  try {
    p = new Audio(url).play();
    if (p && typeof p.catch === 'function') { p.catch(function() {}); }
  } catch { /* politique autoplay : jamais bruyant */ }
}

// signature WebAudio embarquée — recette EXACTE actée : oscillateur + gain par note,
// enveloppe exponentielle vol→quasi-zéro, AudioContext lazy réutilisé entre appels.
function __modalPlaySignature(name) {
  var Ctor, ctx;
  try {
    if (!__modalAudioCtx) {
      Ctor = __modalAudioCtor();
      if (!Ctor) { return; }
      __modalAudioCtx = new Ctor();
    }
    ctx = __modalAudioCtx;
    function note(freq, t0, dur, forme, vol) {
      var osc, gain, t;
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = forme || 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      t = ctx.currentTime + t0;
      gain.gain.setValueAtTime(vol || 0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }
    if (name === 'success') { note(587, 0, 0.1); note(880, 0.1, 0.14); }
    else if (name === 'error') { note(160, 0, 0.24, 'sawtooth', 0.045); }
    else if (name === 'warning') { note(440, 0, 0.09, 'square', 0.03); note(440, 0.13, 0.09, 'square', 0.03); }
    else if (name === 'info') { note(660, 0, 0.1); }
    else if (name === 'notify') { note(880, 0, 0.06, 'sine', 0.04); }
  } catch { /* politique autoplay : jamais bruyant */ }
}

// résout un override explicite (false=silence assumé, chaîne fichier '/'|'.'|'http'=fichier
// TEL QUEL, nom de signature connu=cette signature) — true si CONSOMMÉ (rien de plus à jouer),
// false si l'appelant retombe sur sa propre source. PARTAGÉE par __modalSound (sons automatiques,
// gate ci-dessous) ET µ.sound (appel public, plus bas) — une seule recette, jamais dupliquée.
function __modalPlayOverride(override) {
  var url;
  if (override === false) { return true; }
  if (typeof override !== 'string') { return false; }
  if (override[0] === '/' || override[0] === '.' || override.indexOf('http') === 0) { __modalPlayFile(override); return true; }
  if (__MODAL_SOUND_NAMES[override]) { __modalPlaySignature(override); return true; }
  // chemin relatif SANS préfixe reconnu (ex. 'sons/ok.mp3') : ni fichier ni signature au sens
  // ci-dessus — résolu contre document.baseURI plutôt qu'ignoré en silence ;
  // résolution impossible = avertissement explicite, jamais un repli muet sur une AUTRE source.
  try { url = new URL(override, document.baseURI).href; }
  catch (e) { µ.warn(µ._mjs_msg('modalSoundPath', { path: override, reason: __modalReason(e) }, 'µ.sound — chemin « {path} » non résoluble, aucun son : {reason}.')); return true; }
  __modalPlayFile(url);
  return true;
}

// lecture EFFECTIVE pour un type, SANS aucun gate — mapping fichier de µ.config.modalSound
// OBJET pour ce type s'il existe, sinon la signature WebAudio. Extraite pour que µ.sound (appel
// public, plus bas) réutilise la MÊME recette que __modalSound, sans son gate.
function __modalPlayForType(type, config) {
  if (config && typeof config === 'object' && config[type]) { __modalPlayFile(config[type]); }
  else { __modalPlaySignature(type); }
}

function __modalSound(type, override) {
  var config;
  try {
    // — override:true PAR APPEL : contourne le GATE, joue quand même la signature du type
    // demandé (fichier de µ.config.modalSound objet pour ce type s'il existe, sinon signature
    // WebAudio) — exactement comme un override chaîne ('success', etc.) le fait déjà plus bas.
    if (override === true) { __modalPlayForType(type, µ.config && µ.config.modalSound); return; }
    if (__modalPlayOverride(override)) { return; }
    config = µ.config && µ.config.modalSound;
    if (!config) { return; } // GATE — sons automatiques seulement, µ.sound public le contourne
    __modalPlayForType(type, config);
  } catch { /* politique autoplay : jamais bruyant */ }
}

// ============================================================================
// µ.sound — appel PUBLIC, utilisable PARTOUT dans l'app
// ============================================================================
// Joue TOUJOURS quand on l'appelle explicitement — le gate µ.config.modalSound=false NE
// S'APPLIQUE PAS ici (il ne gate que les sons AUTOMATIQUES des modales/toasts, __modalSound
// ci-dessus). Source du son : `override` s'il est fourni (même résolution que __modalSound, cf.
// __modalPlayOverride) ; sinon le mapping fichier de µ.config.modalSound OBJET pour ce type s'il
// existe ; sinon la signature WebAudio du type (__modalPlayForType, PARTAGÉE avec __modalSound —
// aucune recette dupliquée). Type inconnu (override absent/non consommé) → µ.warn, aucun son.
// Vit dans mjs_modal.ts comme µ.modal : ABSENT si l'app exclut le module 'modal' du tree-shake
// (ASSUMÉ). Sucre µsound → µ.sound (sigils.ts, MU_SHORT_GLOBALS).
µ.sound = function(type, override) {
  type = type === void 0 ? 'notify' : type;
  try {
    if (__modalPlayOverride(override)) { return; }
    if (!__MODAL_SOUND_NAMES[type]) {
      µ.warn(µ._mjs_msg('modalSoundUnknown', { type: type, list: Object.keys(__MODAL_SOUND_NAMES).join(', ') }, 'µ.sound — type inconnu « {type} », aucun son (attendu : {list}).'));
      return;
    }
    __modalPlayForType(type, µ.config && µ.config.modalSound);
  } catch { /* politique autoplay : jamais bruyant */ }
};

// fusionne src PAR-DESSUS target (src gagne) — clés énumérables propres seulement
function __modalAssign(target, src) {
  var k;
  if (src != null && typeof src === 'object') {
    for (k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) { target[k] = src[k]; } }
  }
  return target;
}

// arg chaîne → {text: arg} fusionné sur les défauts ; arg objet → fusionné PAR-DESSUS (l'objet
// gagne) — même convention pour les 4 raccourcis (success/error/info/warn) et µ.modal.wait.
function __modalMerge(defaults, arg) {
  var out = __modalAssign({}, defaults);
  if (typeof arg === 'string') { out.text = arg; } else { __modalAssign(out, arg); }
  return out;
}

// fabrique des 4 raccourcis success/error/info/warn — chacun rend la promesse de fire() telle quelle.
function __modalShortcut(defaults) {
  return function(arg) { return µ.modal.fire(__modalMerge(defaults, arg)); };
}

// conteneur pile des toasts — créé au premier µ.modal.notify(), RÉUTILISÉ ensuite (jamais recréé,
// jamais retiré même vide).
var __TOAST_TYPES = { success: 1, error: 1, warning: 1, info: 1 };

// `document.body` est NUL tant que le corps n'est pas parsé — un µ.modal.notify() appelé depuis un
// script du <head> (non différé) plantait dessus. On retombe alors sur <html>, et on CHERCHE depuis
// <html> dans tous les cas : sinon un conteneur posé avant l'apparition du corps resterait invisible
// à l'appel suivant, qui en créerait un second.
// Plein écran : le conteneur se pose là où se pose la modale (cf. __modalHost), sinon il reste invisible
// derrière l'élément, et il suit l'entrée ou la sortie avec ses toasts (__toastFollow). Retenu tant qu'il
// est dans la page : dans une ombre, la recherche depuis <html> ne le verrait pas et en créerait un second
var __toastBox = null;

// repère laissé dans le corps tant que le conteneur vit hors de lui (plein écran) : une navigation qui remplace le corps
// l'emporte avec le reste de la page, un élément plein écran que l'appli retire non (cf. __toastGone)
var __toastMark = null;

// toast (élément) → son enregistrement : le conteneur ne garde que des éléments, __toastRelire en retrouve l'état de pause
var __toastRecs = new WeakMap();

function __toastEnsureContainer() {
  var racine = document.documentElement || document.body;
  var el = __toastBox || racine.querySelector('.mjs-toasts'); // retenu hors de la page : sorti avec un élément retiré, il y revient (cf. __toastGone)
  if (!el) {
    el = document.createElement('div');
    el.className = 'mjs-toasts';
  }
  if (!__toastBox) { document.addEventListener('fullscreenchange', __toastFollow, true); } // en capture : avant l'écouteur de l'appli qui retirerait l'élément plein écran
  __toastBox = el;
  __toastPlace(el);
  return el;
}

function __toastPlace(el) {
  var host = __modalHost() || document.documentElement;
  var body = document.body;
  if (host === body || !body) {
    if (__toastMark && __toastMark.parentNode) { __toastMark.parentNode.removeChild(__toastMark); }
    __toastMark = null;
  } else if (!__toastMark || __toastMark.parentNode !== body) {
    __toastMark = document.createComment('mjs-toasts');
    body.appendChild(__toastMark);
  }
  if (el.parentNode === host) { return; }
  __modalAdoptSheet(host);
  host.appendChild(el);
  __toastRelire(el);
}

function __toastFollow() {
  __toastGone();
  if (__toastBox) { __toastPlace(__toastBox); }
}

// conteneur sorti de la page (navigation qui remplace le corps, y compris pendant un plein écran : il reste alors dans l'élément
// plein écran détaché) : ses toasts sont partis sans passer par __toastRemove. Leurs places se libèrent, la file repart, et il
// n'est plus jamais rattaché — un fullscreenchange ramenait sinon les anciens toasts. À la sortie ordinaire du plein écran,
// __toastFollow (écouteur en capture) le ramène dans le corps avant que l'appli ne retire son élément ; sorti avec un élément
// plein écran que l'appli a retiré sans navigation (son repère est encore dans le corps), il y revient avec ses toasts
function __toastGone() {
  var box = __toastBox;
  if (!box || box.isConnected) { return; }
  if (box.parentNode && __toastMark && __toastMark.isConnected) { return; }
  __toastBox = null;
  Array.prototype.slice.call(box.children).forEach(function(t) {
    var rec = __toastRecs.get(t);
    if (rec) { __toastRemove(rec); }
  });
}

// file FIFO des toasts EN ATTENTE (plafond µ.config.notifyMax, mjs_init.ts) — façon
// « succès Steam » : ZÉRO éviction, un toast déjà affiché n'est JAMAIS chassé ; le suivant
// démarre sa durée de vie PLEINE seulement quand une place se libère (__toastDrain plus bas).
// Compteur séparé du DOM — incrémenté/décrémenté par les DEUX seuls chemins qui affichent/
// retirent un toast, __toastDisplay et __toastRemove.
var __toastQueue = [];
var __toastVisibleCount = 0;

// plafond NUMÉRIQUE courant — RELU à chaque affichage (changement à chaud respecté au PROCHAIN
// affichage, jamais rétroactif sur ceux déjà affichés/en file). false/0/Infinity = illimité au
// sens numérique : la place à l'écran (__toastFits) borne quand même la pile.
function __toastMax() {
  var v = µ.config && µ.config.notifyMax;
  if (v === false || v === 0 || v === Infinity) { return Infinity; }
  if (typeof v === 'number' && v > 0) { return v; }
  return 5; // clé absente/valeur incomprise — même défaut que µ.config.notifyMax (mjs_init.ts)
}

// durée par défaut — µ.config.notifyDuration (mjs_init.ts), repli 4000 si absente/invalide.
// `opts.duration` d'un appel précis prime toujours (testé AVANT ceci, cf. notify()).
function __toastDefaultDuration() {
  var v = µ.config && µ.config.notifyDuration;
  return typeof v === 'number' && v >= 0 ? v : 4000;
}

// option booléenne d'un toast (pause, swipe) : celle de l'appel quand c'est un booléen, sinon le réglage global
// µ.config.<name> (mjs_init.ts) s'il en est un, sinon true. Toute autre valeur vaut l'absence d'option, sans avertissement
function __toastFlag(own, name) {
  var v = µ.config && µ.config[name];
  if (typeof own === 'boolean') { return own; }
  return typeof v === 'boolean' ? v : true;
}

// 8 préréglages connus (µ.config.notifyPosition, mjs_init.ts) — les 4 coins + leurs variantes
// 'quarter-*' ancrées à 25% du bord haut/bas (feuille : µ._mjs_modalSheet, classes mjs-toasts-<nom>).
var __TOAST_POSITIONS = { 'top-right': 1, 'top-left': 1, 'bottom-right': 1, 'bottom-left': 1, 'quarter-top-right': 1, 'quarter-top-left': 1, 'quarter-bottom-right': 1, 'quarter-bottom-left': 1 };

// marge de garde entre la pile et le bord OPPOSÉ de la fenêtre — même respiration que les 16px
// d'ancrage des préréglages (feuille µ._mjs_modalSheet).
var __TOAST_MARGE = 16;

// position courante — RELUE à chaque affichage réel (même stratégie que __toastMax) : préréglage
// connu → son nom ; objet de longueurs CSS {top,right,bottom,left} → 'custom' (les valeurs sont
// posées en custom properties par __toastApplyPosition) ; valeur inconnue → warn + repli 'top-right'.
function __toastPosition() {
  var v = µ.config && µ.config.notifyPosition;
  if (typeof v === 'string' && __TOAST_POSITIONS[v]) { return v; }
  if (v && typeof v === 'object') { return 'custom'; }
  if (v !== void 0) { µ.warn(µ._mjs_msg('modalNotifyPos', { v: v }, 'µ.config.notifyPosition : valeur invalide (« {v} ») — repli \'top-right\'.')); }
  return 'top-right';
}

// sens du FLUX (µ.config.notifyFlow) — l'ordre d'empilement, à ne pas confondre avec le sens
// de croissance (celui-là est dicté par l'ANCRAGE, cf. __toastGrowsUp) : 'up' = le nouveau toast
// arrive AU-DESSUS des précédents, 'down' = en dessous, 'auto' (défaut) = ce que dit le préréglage.
// Comme notifyMax et notifyPosition : relu à chaque affichage réel, valeur inconnue → warn + 'auto'.
function __toastFlow() {
  var v = µ.config && µ.config.notifyFlow;
  if (v === 'up' || v === 'down' || v === 'auto') { return v; }
  if (v !== void 0) { µ.warn(µ._mjs_msg('modalNotifyFlow', { v: v }, 'µ.config.notifyFlow : valeur invalide (« {v} ») — repli \'auto\'.')); }
  return 'auto';
}

// applique la classe de position sur le CONTENEUR PARTAGÉ (jamais recréé, cf. __toastEnsureContainer)
// — une seule classe mjs-toasts-<préréglage> à la fois (l'ancienne retirée avant la nouvelle), ou
// mjs-toasts-custom + les 4 custom properties --mjs-toasts-{top,right,bottom,left} (setProperty,
// jamais de style littéral en dur — règle nº1 MJS) ; une clé ABSENTE de l'objet courant retire sa
// custom property (removeProperty), sinon une ancienne valeur pourrait traîner d'un appel précédent.
function __toastApplyPosition(el) {
  var pos = __toastPosition();
  var flow = __toastFlow();
  var cls = el.className.split(' ').filter(function(c) { return c.indexOf('mjs-toasts-') !== 0; });
  cls.push('mjs-toasts-' + pos);
  if (flow !== 'auto') { cls.push('mjs-toasts-flow-' + flow); } // 'auto' : rien posé, le préréglage décide
  el.className = cls.join(' ');
  if (pos === 'custom') {
    var v = µ.config.notifyPosition;
    ['top', 'right', 'bottom', 'left'].forEach(function(side) {
      if (typeof v[side] === 'string' && v[side]) { el.style.setProperty('--mjs-toasts-' + side, v[side]); }
      else { el.style.removeProperty('--mjs-toasts-' + side); }
    });
  }
}

// extrêmes verticaux de la pile — premier et dernier toast du DOM, c'est-à-dire ses deux bouts
// quel que soit le sens de croissance ET le flex-direction (un flux inversé échange l'ordre visuel,
// jamais le fait que les extrêmes soient aux deux bouts de la liste).
function __toastBounds(container) {
  var a = container.firstElementChild.getBoundingClientRect();
  var b = container.lastElementChild.getBoundingClientRect();
  return { haut: Math.min(a.top, b.top), bas: Math.max(a.bottom, b.bottom) };
}

// essai d'insertion RÉEL : le toast est ajouté puis la pile MESURÉE, et il est retiré
// aussitôt si elle sort de la fenêtre — le tout dans la MÊME tâche, avant le moindre repaint :
// rien ne clignote, le refus est invisible. Le plafond effectif devient donc « ce qui tient à
// l'écran », sans trahir la règle « zéro éviction » — le refusé RESTE en file, jamais perdu.
//
// On mesure les TOASTS eux-mêmes et surtout PAS le conteneur : un placement libre qui pose `top`
// ET `bottom` lui donne une hauteur imposée par la fenêtre, constante que son contenu déborde ou
// non — la boîte ment (offsetHeight comme scrollHeight, plancher à la hauteur de boîte), les
// toasts non.
//
// Et le bord contrôlé n'est pas DÉDUIT de l'ancrage : il est CONSTATÉ. On mesure avant et
// après l'ajout, et on juge le ou les bords qui ont réellement BOUGÉ. Déduire était faux dès que
// µ.config.notifyFlow inverse le flux d'un conteneur à double ancrage : la pile grandissait alors
// vers le haut pendant que le calcul surveillait le bas, et rien n'était jamais refusé. Constater
// est exact dans toutes les combinaisons ancrage × flux, sans rien savoir du CSS. Le bord qui NE
// bouge pas n'est jamais jugé : un point d'ancrage volontairement hors écran reste un choix de
// l'application, pas une erreur à corriger.
//
// Deux garde-fous : un toast SEUL n'est jamais refusé (mieux vaut un toast qui dépasse qu'un
// écran vide — et si le point d'ancrage lui-même est hors de l'écran, aucun calcul ne rattrape
// ça) ; une pile mesurée à hauteur nulle = aucun moteur de mise en page (happy-dom, SSR), on
// laisse alors passer plutôt que de refuser sur une mesure qui ne veut rien dire.
// `!container.firstElementChild` n'est PAS redondant avec le compteur : le conteneur vit dans
// document.body, une navigation qui remplace le corps de la page peut donc l'emporter avec ses
// toasts sans que __toastRemove soit passé — le compteur dit alors « 3 affichés » sur un conteneur
// vide. Sans cette garde, la mesure planterait sur un firstElementChild nul.
function __toastFits(container, el) {
  var vh, avant, apres, ok;
  if (__toastVisibleCount === 0 || !container.firstElementChild || typeof window === 'undefined' || typeof el.getBoundingClientRect !== 'function') { container.appendChild(el); return true; }
  vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
  avant = __toastBounds(container);
  container.appendChild(el);
  apres = __toastBounds(container);
  if (!vh || apres.bas - apres.haut <= 0) { return true; }
  ok = true;
  if (apres.bas > avant.bas) { ok = apres.bas <= vh - __TOAST_MARGE; }             // la pile s'est allongée vers le BAS
  if (ok && apres.haut < avant.haut) { ok = apres.haut >= __TOAST_MARGE; }         // … et/ou vers le HAUT
  if (ok) { return true; }
  container.removeChild(el);
  return false;
}

// affichage RÉEL d'un toast (immédiat si une place est libre, ou dépilé par __toastDrain) — pose
// la barre de vie + son timer SEULEMENT ici : un toast dépilé de la file démarre SA durée pleine,
// jamais un reliquat. Le son, lui aussi, ne joue qu'à l'affichage (jamais pour un toast encore en
// file, invisible). Position (re)posée ICI aussi, à CHAQUE affichage réel — un changement à chaud
// de µ.config.notifyPosition déplace le conteneur COURANT (donc les toasts déjà affichés avec).
function __toastDisplay(rec) {
  var barreEl, container;
  container = __toastEnsureContainer();
  __toastApplyPosition(container);
  if (!__toastFits(container, rec.el)) { return false; } // plus la place à l'écran : il RESTE en file
  rec.displayed = true;
  __toastVisibleCount++;
  __modalSound(__MODAL_SOUND_NAMES[rec.type] && rec.type !== 'notify' ? rec.type : 'notify', rec.sound); // signature du type, repli ping notify
  if (rec.duration > 0) {
    barreEl = document.createElement('i');
    barreEl.className = 'mjs-toast-barre';
    barreEl.style.setProperty('--mjs-toast-duration', rec.duration + 'ms');
    rec.el.appendChild(barreEl);
    rec.left = rec.duration;
    rec.since = Date.now();
    rec.timerId = setTimeout(function() { __toastRemove(rec); }, rec.duration);
  }
  return true;
}

// pause du décompte : minuteur ET barre de vie figés tant qu'un motif de tenue est actif — 1 le pointeur (souris, stylet)
// survole le toast, 2 le focus est dans le toast. L'arrêt retranche le temps écoulé de `left`, la reprise repose le minuteur
// sur ce qui RESTE (jamais la durée pleine) ; la barre, elle, se fige par la marque mjs-toast-paused (animation-play-state,
// feuille ci-dessus) et repart là où elle en était. Seule la transition « libre » ↔ « tenu » agit : un motif de plus ou de moins
// pendant qu'un autre tient ne change rien. Toast permanent (duration 0) ou pas encore affiché : rien à figer
function __toastHold(rec, bit, on) {
  var held = rec.holds > 0;
  rec.holds = on ? rec.holds | bit : rec.holds & ~bit;
  if (rec.removed || !rec.displayed || !rec.duration || (rec.holds > 0) === held) { return; }
  if (held) {
    rec.since = Date.now();
    rec.timerId = setTimeout(function() { __toastRemove(rec); }, rec.left);
  }
  else {
    rec.left -= Date.now() - rec.since;
    clearTimeout(rec.timerId);
    rec.timerId = null;
  }
  rec.el.classList.toggle('mjs-toast-paused', !held);
}

// écouteur posé sur le toast : retiré à sa fermeture (rec.off, cf. __toastRemove), affiché ou resté en file — aucune fuite
function __toastOn(rec, type, fn, capture) {
  rec.el.addEventListener(type, fn, capture);
  rec.off.push(function() { rec.el.removeEventListener(type, fn, capture); });
}

// survol (pointerenter/pointerleave, ni l'un ni l'autre ne remonte) et focus (focusin/focusout, qui remontent : la croix et la
// couverture d'un toast cliquable les font remonter jusqu'ici). Le doigt ne survole rien : un pointeur « touch » est ignoré.
// Un focus qui passe d'un bouton du toast à un autre (focusout, relatedTarget dans le toast) ne relâche pas la tenue
function __toastBindPause(rec) {
  __toastOn(rec, 'pointerenter', function(e) { if (e.pointerType !== 'touch') { __toastHold(rec, 1, true); } });
  __toastOn(rec, 'pointerleave', function(e) { if (e.pointerType !== 'touch') { __toastHold(rec, 1, false); } });
  __toastOn(rec, 'focusin', function() { __toastHold(rec, 2, true); });
  __toastOn(rec, 'focusout', function(e) { if (!(e.relatedTarget && rec.el.contains(e.relatedTarget))) { __toastHold(rec, 2, false); } });
}

// le conteneur vient de changer de parent (plein écran) : le navigateur oublie le survol et le focus de ses toasts, et Firefox et WebKit
// n'envoient alors ni pointerleave ni focusout — la tenue posée avant resterait pour toujours, le toast ne se fermerait plus. On relit donc
// l'état réel de chaque toast, enfant du conteneur : encore survolé (:hover), focus encore dedans ; sinon la tenue est relâchée
function __toastRelire(box) {
  Array.prototype.forEach.call(box.children, function(el) {
    var rec = __toastRecs.get(el);
    if (!rec) { return; }
    if (!el.matches(':hover')) { __toastHold(rec, 1, false); }
    if (!__toastFocused(rec)) { __toastHold(rec, 2, false); }
  });
}

// le focus est dans le toast : on part de l'élément actif le plus profond (d'ombre en ombre, cf. __modalActiveDeep) et on remonte, en
// sortant d'une ombre par son hôte
function __toastFocused(rec) {
  var n = __modalActiveDeep();
  while (n && n !== rec.el) { n = n.parentNode || n.host; }
  return !!n;
}

// glisser pour fermer — les seuils au même endroit : start = px avant qu'un geste soit un glisser (en deçà, un clic) ; dist = px
// de glisse qui suffisent (ou `part` de la largeur du toast s'il est plus étroit) ; speed = px/ms d'un lancer, valable à partir de
// `min` px ; slide = ms de la sortie et du retour (la durée de la transition de .mjs-toast-sliding, feuille ci-dessus)
var __TOAST_SWIPE = { start: 8, dist: 80, part: .35, speed: .5, min: 24, slide: 200 };

// côtés par où un toast peut sortir, lus sur la pile à l'instant du glisser : -1 la gauche seule, 1 la droite seule, 0 les deux. Un
// préréglage dit son côté dans son nom. Une position libre, par les longueurs que l'application a posées (--mjs-toasts-left et
// --mjs-toasts-right, lues APRÈS résolution de var() ; `auto` ou rien = non posée) : les deux posées ou aucune, la pile est étirée,
// centrée ou sans ancre à gauche ou à droite, les deux sens. Une seule posée, la GÉOMÉTRIE réelle de la pile tranche (un translate la
// déplace de son ancre : `left: 50%` et translateX(-50%) la centrent) : son milieu dans le tiers central de la fenêtre, les deux sens ;
// sinon le bord le plus proche
function __toastSide(box) {
  var m = /\bmjs-toasts-(?:quarter-)?(?:top|bottom)-(left|right)\b/.exec(box.className), cs, set, r, w, c;
  if (m) { return m[1] === 'left' ? -1 : 1; }
  cs = getComputedStyle(box);
  set = ['left', 'right'].map(function(side) { var v = cs.getPropertyValue('--mjs-toasts-' + side).trim(); return v !== '' && v !== 'auto'; });
  if (set[0] === set[1]) { return 0; }
  r = box.getBoundingClientRect();
  w = window.innerWidth;
  c = (r.left + r.right) / 2;
  return Math.abs(c - w / 2) <= w / 6 ? 0 : c < w / 2 ? -1 : 1;
}

// préférence « moins d'animations » : le toast suit le pointeur, mais la sortie et le retour ne se jouent pas
function __toastStill() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// fait glisser le toast jusqu'à `to` px (--mjs-toast-dx, transition de .mjs-toast-sliding) puis appelle `then` ; sans animation,
// `then` part tout de suite. Marge de 50 ms sur la transition : le retrait ne précède jamais l'image finale
function __toastSlide(rec, to, then) {
  rec.el.classList.remove('mjs-toast-dragging');
  if (__toastStill()) { then(); return; }
  rec.el.classList.add('mjs-toast-sliding');
  rec.el.style.setProperty('--mjs-toast-dx', to + 'px');
  rec.slideTimer = setTimeout(then, __TOAST_SWIPE.slide + 50);
}

// prise : sur le texte et l'icône, la souris et le stylet retiennent pointerdown — ni sélection de texte ni glisser natif d'une image
// pendant qu'on tire ; les compatibilités (mousedown…) ne partent pas, le clic, lui, part. Pas sur un bouton ni un lien (la croix, la
// couverture, ceux de la page) : ils ne lancent aucune sélection, et gardent leur focus et leur :active (Firefox perd :active quand
// pointerdown est retenu) ; le lien de la couverture n'est pas déplaçable en natif (draggable, cf. __toastAction). Le doigt garde son
// pointerdown : le défilement vertical reste au navigateur (touch-action: pan-y). Un seul pointeur à la fois, le premier bouton seulement,
// jamais un doigt non primaire. Seul un glisser en cours (rec.drag.on) refuse un nouvel appui : un appui jamais devenu glisser (sorti du
// toast avant `start` px, relâché dehors — le lâcher ne lui est jamais parvenu) n'est pas un geste, le nouvel appui le remplace ; et il
// est oublié dès que le pointeur sort (cf. __toastBindSwipe), pour qu'un geste venu d'ailleurs ne le trouve pas en travers du toast
function __toastDown(rec, e) {
  if ((rec.drag && rec.drag.on) || rec.leaving || e.button || e.isPrimary === false) { return; }
  if (e.pointerType !== 'touch' && !e.target.closest('button, a')) { e.preventDefault(); }
  rec.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, dx: 0, side: 0, trail: [] };
}

// le glisser commence au premier mouvement de `start` px, à condition qu'il soit plutôt horizontal (un geste d'abord vertical est un
// défilement). Le pointeur est alors capturé : les mouvements suivent, hors du toast et de la fenêtre. Le toast suit, dans les sens
// permis seulement ; minuteur et barre figés (motif 4, même mécanisme que la pause, quelle que soit l'option pause : un toast qu'on
// tient ne se ferme pas sous le doigt). `trail` garde les 100 dernières ms de mouvement pour le lancer. La souris et le stylet sans
// bouton enfoncé : le lâcher s'est perdu (relâché hors du toast avant la capture, ou hors de la fenêtre), le geste finit comme un pointercancel
function __toastMove(rec, e) {
  var d = rec.drag, dx, dy, f;
  if (!d || e.pointerId !== d.id) { return; }
  if (!e.buttons && e.pointerType !== 'touch') { __toastEnd(rec, e); return; }
  dx = e.clientX - d.x;
  dy = e.clientY - d.y;
  if (!d.on) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < __TOAST_SWIPE.start) { return; }
    if (Math.abs(dy) > Math.abs(dx)) { rec.drag = null; return; }
    d.on = true;
    d.side = __toastSide(rec.el.parentNode);
    clearTimeout(rec.slideTimer); // un retour en cours est repris en main
    f = rec.el.getRootNode().activeElement; // le bouton pressé a pris le focus : il le rend, sinon la pause du focus tiendrait le toast après son retour
    if (f && rec.el.contains(f) && typeof f.blur === 'function') { f.blur(); }
    try { rec.el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà fini : le geste continue sans capture */ }
    rec.el.classList.remove('mjs-toast-sliding');
    rec.el.classList.add('mjs-toast-dragging');
    __toastHold(rec, 4, true);
  }
  d.dx = d.side * dx < 0 ? 0 : dx;
  rec.el.style.setProperty('--mjs-toast-dx', d.dx + 'px');
  d.trail.push([e.clientX, e.timeStamp]);
  while (e.timeStamp - d.trail[0][1] > 100) { d.trail.shift(); }
}

// lâcher (pointerup), ou geste repris par le navigateur (pointercancel, lostpointercapture) ou perdu (un déplacement sans bouton enfoncé,
// cf. __toastMove) : jamais une fermeture ; la lostpointercapture d'un ENFANT du toast, qui remonte jusqu'ici, n'est que la capture
// implicite du doigt cédant la place à la nôtre. Un geste resté
// sous `start` px était un clic : rien à faire. Sinon le clic qui suit le lâcher est avalé (rec.eat, cf. __toastBindSwipe), puis :
// au-delà de la distance dans un sens permis, ou lancé assez vite sur assez de chemin, le toast sort et se ferme par __toastRemove
// — le chemin de la croix ; sinon il revient à sa place et le décompte repart
function __toastEnd(rec, e) {
  var d = rec.drag, S = __TOAST_SWIPE, tr, w, v, dir, box;
  if (!d || e.pointerId !== d.id || (e.type === 'lostpointercapture' && e.target !== rec.el)) { return; }
  rec.drag = null;
  if (!d.on) { return; }
  rec.eat = e.timeStamp + 50;
  dir = d.dx > 0 ? 1 : -1;
  tr = d.trail;
  w = rec.el.offsetWidth;
  v = e.timeStamp - tr[tr.length - 1][1] < 100 ? (tr[tr.length - 1][0] - tr[0][0]) / Math.max(tr[tr.length - 1][1] - tr[0][1], 1) : 0;
  if (e.type === 'pointerup' && d.dx && (Math.abs(d.dx) >= Math.min(S.dist, w ? w * S.part : S.dist) || (Math.abs(d.dx) >= S.min && v * dir >= S.speed))) {
    rec.leaving = true;
    box = rec.el.getBoundingClientRect(); // le rectangle porte déjà le décalage : on le retranche pour retrouver la place au repos
    __toastSlide(rec, dir > 0 ? window.innerWidth - box.left + d.dx + 32 : d.dx - box.right - 32, function() { __toastRemove(rec); });
  }
  else {
    __toastHold(rec, 4, false);
    __toastSlide(rec, 0, function() { rec.el.classList.remove('mjs-toast-sliding'); rec.el.removeAttribute('style'); });
  }
}

// écouteurs du glisser : prise, mouvement, sortie, fin. Le pointeur qui sort du toast avant d'avoir commencé à le tirer abandonne son
// appui : le lâcher qui suivrait, dehors, ne reviendra pas ici, et un autre appui, parti de la page, traîné ensuite par-dessus le toast,
// reprendrait sinon l'ancien point de départ. Le clic qui suit un vrai glisser (rec.eat : instant limite sur l'horloge des
// événements, aucun minuteur) est coupé en phase de capture, avant la couverture, la croix ou le lien — un seul clic, jamais le suivant
function __toastBindSwipe(rec) {
  rec.el.classList.add('mjs-toast-swipe');
  __toastOn(rec, 'pointerdown', function(e) { __toastDown(rec, e); });
  __toastOn(rec, 'pointermove', function(e) { __toastMove(rec, e); });
  __toastOn(rec, 'pointerleave', function(e) { var d = rec.drag; if (d && !d.on && e.pointerId === d.id) { rec.drag = null; } });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function(type) { __toastOn(rec, type, function(e) { __toastEnd(rec, e); }); });
  __toastOn(rec, 'click', function(e) { if (e.timeStamp < rec.eat) { rec.eat = 0; e.stopPropagation(); e.preventDefault(); } }, true);
}

// chemin UNIQUE de retrait — timer de vie, croix (.mjs-toast-close), poignée .close() ET clic sur un
// toast cliquable (.mjs-toast-action, cf. __toastAction) y convergent tous les quatre. Toast encore EN FILE
// (jamais affiché) : simple retrait de la file, rien à drainer. Toast AFFICHÉ : retiré du DOM, la place libérée DRAINE la file.
function __toastRemove(rec) {
  var idx;
  if (rec.removed) { return; }
  rec.removed = true;
  if (rec.timerId != null) { clearTimeout(rec.timerId); rec.timerId = null; }
  rec.off.forEach(function(f) { f(); });
  rec.off.length = 0;
  if (!rec.displayed) {
    idx = __toastQueue.indexOf(rec);
    if (idx !== -1) { __toastQueue.splice(idx, 1); }
    return;
  }
  if (rec.el.parentNode) { rec.el.parentNode.removeChild(rec.el); }
  __toastVisibleCount--;
  __toastDrain();
}

// icône en texte qui commence par `<svg` : analysée dans un <template> (inerte : aucun script lancé, aucune image chargée),
// retenue seulement si elle n'est qu'UN <svg>, rien avant ni après, puis réduite au dessin d'une icône. Éléments permis (liste
// ci-dessous) : formes, groupes, textes, dégradés, découpes, masques, `<use>` ; tout autre part avec son contenu — script,
// style, foreignObject, image, filtres, animations, élément HTML glissé dans desc ou title. Attributs retirés : on*, style,
// toute adresse hors du SVG lui-même (href ou xlink:href qui ne commence pas par `#`, et celui d'un lien `<a>`, qui reste un
// simple groupe), toute valeur en javascript: ou vbscript:, avec url( hors `#nom`, @import ou une barre oblique inverse
// (échappement CSS). Une adresse d'avatar fournie par un utilisateur qui commencerait par `<svg` ne lance donc aucun code,
// ne pose aucune règle de style sur la page et ne prévient aucun tiers. null = refusée
var __TOAST_SVG_TAGS = /^(svg|g|a|path|circle|ellipse|line|polyline|polygon|rect|text|tspan|defs|symbol|use|title|desc|lineargradient|radialgradient|stop|clippath|mask)$/i;

function __toastSvg(text) {
  var t = document.createElement('template'), svg, els, i, j, el, a, v;
  t.innerHTML = text.trim();
  svg = t.content.firstChild;
  if (t.content.childNodes.length !== 1 || svg.nodeName.toLowerCase() !== 'svg') { return null; }
  els = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
  for (i = 0; i < els.length; i++) {
    el = els[i];
    if (el.namespaceURI !== svg.namespaceURI || !__TOAST_SVG_TAGS.test(el.localName)) { el.remove(); continue; }
    for (j = el.attributes.length - 1; j >= 0; j--) {
      a = el.attributes[j];
      v = a.value.replace(µ._mjs_ctrlCharRe, '');
      if (/^(on|style$)/i.test(a.name) || (a.localName === 'href' && (el.localName === 'a' || v.charAt(0) !== '#')) || /(java|vb)script:|url\((?!['"]?#)|@import|\\/i.test(v)) { el.removeAttributeNode(a); }
    }
  }
  return svg;
}

// dernier clic AU POINTEUR (souris, doigt, stylet) qui a fermé un toast cliquable : { t: instant de l'événement, x, y: point
// cliqué }. Ce clic fait remonter le toast suivant sous le pointeur, et le second clic d'un double clic le déclencherait à
// son tour : pendant 400 ms, un toast dont la boîte contient ce point ignore donc le clic au pointeur (activation retenue
// par preventDefault : ni fn ni lien). Le clavier et .click() n'ont pas de pointerType : ils n'arment rien, jamais retenus
var __toastLastClick = null;

// élément d'action d'un toast cliquable : un lien (`opts.href`, adresse passée au filtre des adresses du framework) ou, à
// défaut, un bouton (`opts.onClick`) ; null quand aucune des deux options n'est exploitable (autre type, adresse vide ou
// refusée) : le toast reste alors ordinaire. Élément VIDE posé par-dessus tout le toast (.mjs-toast-action), jamais le toast
// lui-même : un lien ne contient pas de bouton, et la croix doit rester à part. `fn` passe la première, avec l'événement (son
// preventDefault() retient le lien) ; le toast se ferme ensuite quoi qu'il arrive — une erreur de fn remonte sans le retenir.
// Structure (position, taille, fond, bordure, remplissage, marge, police, couleur, apparence) et états en !important dans la
// feuille : une règle de balise de l'appli (`button{…}`, `a:hover{…}`) ne doit ni peindre un aplat sur le message ni déplacer
// la couverture ; l'appli règle ses états par variables (--mjs-toast-hover-bg, --mjs-toast-active-bg, --mjs-toast-focus)
function __toastAction(rec, opts, titleEl, msgEl) {
  var el, fn;
  fn = typeof opts.onClick === 'function' ? opts.onClick : null;
  el = null;
  if (typeof opts.href === 'string' && opts.href.trim()) { // espaces seuls : comme une chaîne vide
    el = document.createElement('a');
    µ._mjs_safeAttr(el, 'href', opts.href);
    if (!el.hasAttribute('href')) { el = null; } // adresse refusée : comme sans href
    else { el.setAttribute('draggable', 'false'); } // un lien se tire : pas de glisser natif de l'adresse, le toast glisse à la place
  }
  if (!el && fn) {
    el = document.createElement('button');
    el.type = 'button';
  }
  if (!el) { return null; }
  el.className = 'mjs-toast-action';
  el.setAttribute('aria-label', (titleEl ? titleEl.textContent + ' ' : '') + msgEl.textContent); // nom accessible : le titre suivi du message
  el.addEventListener('click', function(e) {
    var box, last;
    if (rec.removed) { return; }
    if (e.pointerType) {
      last = __toastLastClick;
      if (last && e.timeStamp - last.t < 400) { // dans le délai d'un double clic
        box = el.getBoundingClientRect();
        if (last.x >= box.left && last.x <= box.right && last.y >= box.top && last.y <= box.bottom) { e.preventDefault(); return; } // ce toast a pris la place du précédent
      }
      __toastLastClick = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    }
    try { if (fn) { fn(e); } }
    finally { __toastRemove(rec); }
  });
  return el;
}

// fait avancer la file tant qu'une place est libre — plafond RELU à chaque tour (un changement à
// chaud pendant le drain profite immédiatement des places supplémentaires).
function __toastDrain() {
  __toastGone();
  while (__toastVisibleCount < __toastMax() && __toastQueue.length > 0) {
    if (!__toastDisplay(__toastQueue[0])) { return; } // refusé faute de PLACE À L'ÉCRAN : la file attend
    __toastQueue.shift();
  }
}

// une fenêtre qui s'agrandit LIBÈRE de la place : la file doit repartir sans attendre qu'un toast
// expire, sinon une pile de permanents (duration:0) la bloque pour toujours. Écouteur posé
// UNE seule fois, à la première mise en file — jamais au chargement du module, jamais côté serveur.
// Le garde `__toastQueue.length` rend l'écouteur gratuit tant qu'il n'y a rien en attente.
var __toastResizeOn = false;

function __toastWatchResize() {
  if (__toastResizeOn || typeof window === 'undefined' || !window.addEventListener) { return; }
  __toastResizeOn = true;
  window.addEventListener('resize', function() { if (__toastQueue.length > 0) { __toastDrain(); } });
}

var __modalUidSeq = 0;

// closure de fermeture de la modale COURANTE (une seule à la fois, cf. en-tête — empilement hors
// périmètre) — posée à l'ouverture de fire(), nettoyée à la fermeture ; consommée par
// µ.modal.close() (fermeture programmatique globale).
var __modalCurrentClose = null;

// résultat d'une fermeture programmatique — `result` fusionné PAR-DESSUS (les clés fournies
// gagnent). Factorisé : µ.modal.close() et la poignée rendue par µ.modal.wait() doivent résoudre
// EXACTEMENT le même objet.
function __modalDismissResult(result) {
  return __modalAssign({ isConfirmed: false, isDenied: false, isDismissed: true, value: void 0, dismiss: 'close' }, result);
}

µ.modal = {
  fire: function(options) {
    // Les deux vérifications SYNCHRONES, hors promesse (cf. __modalNormalize ci-dessus).
    // `document.body` absent = script exécuté dans le `<head>` avant le corps : la modale n'a
    // nulle part où s'afficher, autant le dire tout de suite plutôt que rejeter plus tard.
    options = __modalNormalize(options);
    if (!document.body) {
      throw __modalErr(µ._mjs_txt('modalNoBody', null, '`document.body` est absent — une modale ne peut pas être affichée à ce moment du chargement.'));
    }
    return new Promise(function(resolve) {
      var uid, previouslyFocused, closed, confirming, timerId, allowOutsideClick, allowEscapeKey,
        backdrop, box, iconEl, spinnerEl, titleEl, contentEl, inputEl, inputWrap, validationEl, actionsEl,
        confirmBtn, denyBtn, cancelBtn, focusTarget, host;

      // une seule modale ouverte à la fois (cf. en-tête, empilement de MODALES hors périmètre) —
      // un fire() qui arrive PAR-DESSUS une modale déjà ouverte la FERME d'abord, même résultat
      // que µ.modal.close() (résout sa promesse, retire son DOM) : jamais une promesse orpheline,
      // jamais deux boîtes empilées.
      if (__modalCurrentClose) { __modalCurrentClose(__modalDismissResult()); }

      uid = ++__modalUidSeq;
      previouslyFocused = __modalActiveDeep();
      closed = false;
      confirming = false;
      timerId = null;
      // défaut true pour les deux : SEULE la valeur explicite `false` désactive.
      allowOutsideClick = options.allowOutsideClick !== false;
      allowEscapeKey = options.allowEscapeKey !== false;

      backdrop = document.createElement('div');
      backdrop.className = 'mjs-modal-backdrop';
      __modalApplyClass(backdrop, options.customClass && options.customClass.backdrop);

      box = document.createElement('div');
      box.className = 'mjs-modal-box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      // repli du focus initial si zéro bouton/input (showConfirmButton:false sans deny/cancel,
      // µ.modal.wait) : la boîte elle-même devient focusable SANS entrer dans le focus trap
      // (exclue par __MODAL_FOCUSABLE_SEL, qui écarte tabindex="-1") — cf. focusTarget plus bas.
      box.setAttribute('tabindex', '-1');
      __modalApplyClass(box, options.customClass && options.customClass.box);

      if (options.icon && __modalIcons[options.icon]) {
        iconEl = document.createElement('div');
        iconEl.className = 'mjs-modal-icon mjs-modal-icon-' + options.icon;
        iconEl.setAttribute('aria-hidden', 'true');
        __modalApplyClass(iconEl, options.customClass && options.customClass.icon);
        iconEl.innerHTML = __modalIcons[options.icon];
        box.appendChild(iconEl);
      }

      // spinner (µ.modal.wait) — pas un des 5 icônes SVG, animation CSS dans µ._mjs_modalSheet.
      if (options.spinner) {
        spinnerEl = document.createElement('div');
        spinnerEl.className = 'mjs-modal-spinner';
        spinnerEl.setAttribute('aria-hidden', 'true');
        box.appendChild(spinnerEl);
      }

      if (options.title) {
        titleEl = document.createElement('h2');
        titleEl.className = 'mjs-modal-title';
        titleEl.id = 'mjs-modal-title-' + uid;
        __modalApplyClass(titleEl, options.customClass && options.customClass.title);
        titleEl.textContent = options.title;
        box.appendChild(titleEl);
        box.setAttribute('aria-labelledby', titleEl.id);
      }

      if (options.html != null || options.text != null) {
        contentEl = document.createElement('div');
        contentEl.className = 'mjs-modal-content';
        contentEl.id = 'mjs-modal-content-' + uid;
        __modalApplyClass(contentEl, options.customClass && options.customClass.htmlContainer);
        // `html` = contenu de confiance (option EXPLICITE, même contrat que @html côté template) ;
        // `text` = texte brut, jamais interprété (textContent échappe nativement).
        if (options.html != null) { contentEl.innerHTML = options.html; } else { contentEl.textContent = options.text; }
        box.appendChild(contentEl);
        box.setAttribute('aria-describedby', contentEl.id);
      }

      if (options.input) {
        inputEl = __modalBuildInput(options);
        inputWrap = document.createElement('div');
        inputWrap.className = 'mjs-modal-input-container';
        __modalApplyClass(inputWrap, options.customClass && options.customClass.input);
        inputWrap.appendChild(inputEl);
        box.appendChild(inputWrap);
      }

      validationEl = document.createElement('div');
      validationEl.className = 'mjs-modal-validation-message';
      validationEl.setAttribute('role', 'alert');
      __modalApplyClass(validationEl, options.customClass && options.customClass.validationMessage);
      validationEl.hidden = true;
      box.appendChild(validationEl);

      actionsEl = document.createElement('div');
      actionsEl.className = 'mjs-modal-actions';
      __modalApplyClass(actionsEl, options.customClass && options.customClass.actions);

      // défaut true : SEULE la valeur explicite `false` retire le bouton (même garde que
      // allowOutsideClick/allowEscapeKey plus haut).
      if (options.showConfirmButton !== false) {
        confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'mjs-modal-btn mjs-modal-confirm';
        __modalApplyClass(confirmBtn, options.customClass && options.customClass.confirmButton);
        actionsEl.appendChild(confirmBtn);
      }

      if (options.showDenyButton) {
        denyBtn = document.createElement('button');
        denyBtn.type = 'button';
        denyBtn.className = 'mjs-modal-btn mjs-modal-deny';
        __modalApplyClass(denyBtn, options.customClass && options.customClass.denyButton);
        actionsEl.appendChild(denyBtn);
      }

      if (options.showCancelButton) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'mjs-modal-btn mjs-modal-cancel';
        __modalApplyClass(cancelBtn, options.customClass && options.customClass.cancelButton);
        actionsEl.appendChild(cancelBtn);
      }

      // les textes des boutons : celui de l'appelant, sinon le libellé par défaut, récrit à l'arrivée du fichier de la langue
      __modalKeep(function() {
        if (confirmBtn) { confirmBtn.textContent = options.confirmButtonText || __modalLabel('ok'); }
        if (denyBtn) { denyBtn.textContent = options.denyButtonText || __modalLabel('deny'); }
        if (cancelBtn) { cancelBtn.textContent = options.cancelButtonText || __modalLabel('cancel'); }
      });

      box.appendChild(actionsEl);
      backdrop.appendChild(box);

      // boutons grisés = une confirmation attend sa réponse (inputValidator, preConfirm) : Échap et le clic sur le
      // fond sont alors ignorés (cf. onKeydown, onBackdropClick). Fermer maintenant résoudrait « annulée » alors
      // que le preConfirm va peut-être aboutir — l'écriture faite, l'appelant croyant l'inverse. Les fermetures
      // décidées par le code (µ.modal.close(), un autre fire(), le timer) restent possibles
      function setButtonsDisabled(disabled) {
        confirming = disabled;
        if (confirmBtn) { confirmBtn.disabled = disabled; }
        if (denyBtn) { denyBtn.disabled = disabled; }
        if (cancelBtn) { cancelBtn.disabled = disabled; }
      }

      function cleanup() {
        if (timerId != null) { clearTimeout(timerId); timerId = null; }
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('mjs:load', onGone);
        backdrop.removeEventListener('click', onBackdropClick);
        if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
        if (mark) { mark.remove(); }
        if (previouslyFocused) { __modalRestoreFocus(previouslyFocused); }
      }

      function close(result) {
        if (closed) { return; }
        closed = true;
        // ne remet la référence GLOBALE à null que si elle pointe ENCORE sur cette
        // modale : une autre ouverte par-dessus l'a peut-être remplacée, et l'effacer rendrait
        // µ.modal.close() muet pour celle qui est réellement à l'écran.
        if (__modalCurrentClose === close) { __modalCurrentClose = null; }
        cleanup();
        resolve(result);
      }

      // exposé pour µ.modal.close() — fermeture programmatique GLOBALE de CETTE modale (une
      // seule ouverte à la fois, cf. en-tête). `close` est hissée (déclaration de fonction) :
      // l'affectation peut se faire ici, avant même sa définition textuelle plus haut.
      __modalCurrentClose = close;

      function showValidationError(message) {
        validationEl.textContent = message;
        validationEl.hidden = false;
      }

      // Confirm : inputValidator (message d'erreur si non-null, bloque) PUIS preConfirm (peut
      // annuler en renvoyant `false`, ou transformer la valeur finale). Un rejet/throw des deux
      // hooks NE FERME PAS la modale (jamais une saisie utilisateur perdue en silence) : affiché
      // dans le même bandeau que les erreurs de validation, tracé via µ.error.
      function onConfirm() {
        var value, validator, preConfirm;
        value = __modalInputValue(inputEl, options.input);
        validator = typeof options.inputValidator === 'function' ? options.inputValidator : null;
        preConfirm = typeof options.preConfirm === 'function' ? options.preConfirm : null;
        validationEl.hidden = true;
        setButtonsDisabled(true);
        // `.then(() => …)` PLUTÔT QUE `Promise.resolve(validator(value))` : ce dernier appelle
        // validator/preConfirm AVANT même de créer la promesse — un throw synchrone en sortait
        // directement (hors de tout .then), donc jamais rattrapé par le second argument
        // ci-dessous. Boutons bloqués à vie, promesse de fire() jamais résolue. Différer l'appel
        // DANS le .then() ramène un throw synchrone au même chemin qu'un rejet de promesse.
        Promise.resolve().then(function() { return validator ? validator(value) : null; }).then(function(err) {
          if (err) {
            setButtonsDisabled(false);
            showValidationError(err);
            return;
          }
          if (!preConfirm) {
            setButtonsDisabled(false);
            close({ isConfirmed: true, isDenied: false, isDismissed: false, value: value, dismiss: void 0 });
            return;
          }
          Promise.resolve().then(function() { return preConfirm(value); }).then(function(preResult) {
            setButtonsDisabled(false);
            if (preResult === false) { return; } // annulé par preConfirm : reste ouverte, aucun message imposé
            close({ isConfirmed: true, isDenied: false, isDismissed: false, value: preResult !== void 0 ? preResult : value, dismiss: void 0 });
          }, function(preErr) {
            setButtonsDisabled(false);
            µ.error(µ._mjs_msg('modalPreConfirm', null, 'µ.modal : preConfirm en échec —'), preErr);
            showValidationError(preErr && preErr.message ? preErr.message : String(preErr));
          });
        }, function(valErr) {
          setButtonsDisabled(false);
          µ.error(µ._mjs_msg('modalValidator', null, 'µ.modal : inputValidator en échec —'), valErr);
          showValidationError(valErr && valErr.message ? valErr.message : String(valErr));
        });
      }

      function onDeny() {
        close({ isConfirmed: false, isDenied: true, isDismissed: false, value: void 0, dismiss: void 0 });
      }

      function onCancel() {
        close({ isConfirmed: false, isDenied: false, isDismissed: true, value: void 0, dismiss: 'cancel' });
      }

      // le clic sur le fond ne ferme que si l'appui y était aussi : sélectionner le texte d'un champ et relâcher à côté
      // de la boîte envoie le clic au fond (ancêtre commun de l'appui et du lâcher), la saisie était perdue. Un clic sans
      // appui (click() du code) ferme comme avant
      var downInBox = false;

      function onBackdropClick(e) {
        var fromBox = downInBox;
        downInBox = false;
        if (e.target !== backdrop || fromBox || !allowOutsideClick || confirming) { return; }
        close({ isConfirmed: false, isDenied: false, isDismissed: true, value: void 0, dismiss: 'backdrop' });
      }

      // modale partie avec le corps de la page (navigation UJS qui le remplace) : fermée comme par µ.modal.close(), à
      // l'arrivée de la page (mjs:load) ou à la première touche. Son piège du focus avalait sinon chaque Tab de la
      // nouvelle page, et sa promesse ne se résolvait jamais
      function onGone() {
        if (backdrop.isConnected) { return false; }
        previouslyFocused = null; // focus laissé à la nouvelle page
        close(__modalDismissResult());
        return true;
      }

      // Focus trap (Tab/Shift+Tab bouclent DANS la boîte) + Échap (si autorisée). Posé sur
      // `document` en capture, retiré dans cleanup() — une seule modale à la fois en v1
      // (empilement hors périmètre, cf. en-tête), pas besoin d'un registre de handlers actifs.
      // Échap qui ferme s'arrête à la modale : un tiroir ou un menu en dessous ne se ferme pas avec elle
      function onKeydown(e) {
        var focusable, first, last, active, activeInBox;
        if (onGone()) { return; }
        if (e.key === 'Escape' || e.key === 'Esc') {
          if (allowEscapeKey && !confirming) {
            e.preventDefault();
            e.stopPropagation();
            close({ isConfirmed: false, isDenied: false, isDismissed: true, value: void 0, dismiss: 'esc' });
          }
          return;
        }
        if (e.key !== 'Tab') { return; }
        focusable = __modalFocusable(box);
        if (focusable.length === 0) { e.preventDefault(); return; }
        first = focusable[0];
        last = focusable[focusable.length - 1];
        // lu dans la racine de la boîte : posée dans une ombre (plein écran), `document.activeElement`
        // n'en rendrait que l'hôte, et chaque Tab ramènerait au premier bouton
        active = box.getRootNode().activeElement;
        activeInBox = box.contains(active);
        if (e.shiftKey) {
          if (!activeInBox || active === first) { e.preventDefault(); __modalRestoreFocus(last, {}); }
        } else {
          if (!activeInBox || active === last) { e.preventDefault(); __modalRestoreFocus(first, {}); }
        }
      }

      // repère laissé dans le corps tant que la modale vit hors de lui (plein écran) : une page remplacée l'emporte avec le
      // reste, un élément plein écran que l'appli retire, non (même règle que les toasts, cf. __toastMark)
      var mark = null;
      function place(next) {
        __modalAdoptSheet(next);
        next.appendChild(backdrop);
        if (mark) { mark.remove(); }
        mark = next === document.body ? null : document.body.appendChild(document.createComment('mjs-modal'));
      }

      // entrée ou sortie du plein écran pendant l'ouverture : la modale suit l'hôte du moment — restée
      // dans un élément que l'appli retire à la sortie, elle disparaissait sans jamais se fermer.
      // Déplacée, elle perd le focus : rendu à l'élément de la boîte qui l'avait, sinon au focus initial
      function onFullscreenChange() {
        var next = __modalHost(), active;
        // partie avec la page (son <body>, ou l'élément plein écran qu'elle emportait) : jamais ramenée dans la suivante
        if (!backdrop.isConnected && !(mark && mark.isConnected)) { onGone(); return; }
        if (next === backdrop.parentNode) { return; }
        active = box.getRootNode().activeElement;
        place(next);
        __modalRestoreFocus(active && box.contains(active) ? active : focusTarget);
      }

      document.addEventListener('keydown', onKeydown, true);
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('mjs:load', onGone);
      backdrop.addEventListener('pointerdown', function(e) { downInBox = e.target !== backdrop; });
      backdrop.addEventListener('click', onBackdropClick);
      if (confirmBtn) { confirmBtn.addEventListener('click', onConfirm); }
      if (denyBtn) { denyBtn.addEventListener('click', onDeny); }
      if (cancelBtn) { cancelBtn.addEventListener('click', onCancel); }

      if (typeof options.timer === 'number' && options.timer > 0) {
        timerId = setTimeout(function() {
          close({ isConfirmed: false, isDenied: false, isDismissed: true, value: void 0, dismiss: 'timer' });
        }, options.timer);
      }

      // son à l'OUVERTURE, selon l'icône (question/aucune icône = silence) — opts.sound par appel
      // l'emporte sur µ.config.modalSound (cf. __modalSound).
      if (options.icon && options.icon !== 'question') { __modalSound(options.icon, options.sound); }

      // le corps, ou l'élément en plein écran (cf. __modalHost)
      host = __modalHost();
      place(host);

      // Focus initial : l'input (l'utilisateur doit pouvoir taper tout de suite) sinon le bouton
      // confirm (comportement SweetAlert2 par défaut) sinon la boîte elle-même (showConfirmButton:
      // false sans deny/cancel, µ.modal.wait — tabindex="-1" posé plus haut) — mémorisé AVANT
      // (previouslyFocused, plus haut) pour le retour de focus à la fermeture, `{preventScroll:true}`
      // dans les trois cas.
      focusTarget = inputEl || confirmBtn || box;
      focusTarget.focus({ preventScroll: true });
    });
  },

  // 4 raccourcis — arg chaîne = {text: arg} ; arg objet = fusionné PAR-DESSUS les défauts
  // (l'objet gagne) — cf. __modalMerge. Chacun rend la promesse de fire() telle quelle.
  success: __modalShortcut({ icon: 'success', timer: 2000, showConfirmButton: false }),
  error: __modalShortcut({ icon: 'error' }),
  info: __modalShortcut({ icon: 'info', timer: 2000, showConfirmButton: false }),
  warn: __modalShortcut({ icon: 'warning', timer: 2000, showConfirmButton: false }),

  // modale d'attente — spinner, zéro bouton, fermeture réservée au code appelant
  // (allowOutsideClick/allowEscapeKey false, pas de timer) : seule µ.modal.close() (ou le
  // close() rendu ici, équivalent) la ferme.
  wait: function(arg) {
    µ.modal.fire(__modalMerge({ title: 'Veuillez patienter…', spinner: true, showConfirmButton: false, allowOutsideClick: false, allowEscapeKey: false }, arg));
    // poignée liée à CETTE modale, jamais à « la modale courante » : entre l'ouverture du
    // spinner et sa fermeture, un µ.modal.success() de progression écrasait __modalCurrentClose,
    // et ce close() fermait alors la MAUVAISE. Le spinner restait à vie — keydown global jamais
    // retiré, promesse jamais résolue, focus jamais rendu. `fire()` pose la closure de façon
    // SYNCHRONE (l'exécuteur de la promesse tourne à l'appel), donc on la capture ici même.
    var propre = __modalCurrentClose;
    return { close: function() { if (propre) { var f = propre; propre = null; f(__modalDismissResult()); } } };
  },

  // toast — empilé au préréglage µ.config.notifyPosition (défaut 'top-right' ; .mjs-toasts,
  // créé au 1er AFFICHAGE puis RÉUTILISÉ), plafonné par µ.config.notifyMax (façon « succès
  // Steam ») : au-delà, mis EN FILE FIFO (__toastQueue) plutôt qu'affiché tout de suite — zéro
  // éviction, jamais un toast affiché n'est chassé. La poignée rendue est valide DÈS L'APPEL,
  // affiché ou pas : fermer un toast encore en file le retire simplement de la file
  // (__toastRemove), il ne s'affichera jamais. Carte à 3 colonnes : icône (i.mjs-toast-icon, un des __modalIcons ou
  // `opts.icon`, cf. plus bas), contenu (div.mjs-toast-content > titre optionnel + message), croix. Titre par défaut par type
  // (__toastTitle/__toastTitlesFallback, même mécanisme que __modalLabel) ; `opts.title` prime,
  // une valeur FAUSSE (false/''/null) supprime l'élément titre — toast compact, une seule ligne.
  // `opts.href` (chaîne) ou `opts.onClick` (fonction) rendent le TOAST ENTIER cliquable : un lien, ou un bouton à
  // défaut de lien, vide et posé par-dessus (__toastAction) ; la croix reste à part, au-dessus. Ensemble : le lien, avec
  // onClick appelée d'abord. `opts.pause` (booléen ; défaut µ.config.notifyPause, true) fige le décompte — minuteur et barre —
  // tant que le pointeur survole le toast ou que le focus y est, et le reprend avec le temps RESTANT (__toastHold) ; une valeur
  // non booléenne vaut l'absence d'option. `opts.swipe` (booléen ; défaut µ.config.notifySwipe, true) permet de TIRER le toast à
  // l'horizontale pour le fermer (__toastMove/__toastEnd) : sortie en glissant au-delà d'un seuil dans le sens que permet la place
  // de la pile (__toastSide), retour sinon ; même chemin de fermeture que la croix. Message en textContent (jamais innerHTML) — la barre de vie porte sa durée via
  // --mjs-toast-duration, posée seulement à l'affichage RÉEL (__toastDisplay), et le toast qu'on tire son décalage via --mjs-toast-dx,
  // posée sur le toast (attribut style) le temps du geste puis retirée avec lui (setProperty : seul canal de valeur dynamique
  // autorisé, zéro style inline sinon).
  notify: function(message, opts) {
    var type, duration, title, icon, rec, iconEl, img, contentEl, titleEl, msgEl, actionEl, closeBtn;
    // les options propres de l'appelant, sans prototype : un `href` ou un `icon` hérité ne fait pas de chaque toast un lien
    // ou l'image d'un tiers
    opts = __modalAssign(Object.create(null), opts);
    // un type connu (clé propre de la table) : un nom posé par un prototype pollué vaut l'absence de type
    type = Object.prototype.hasOwnProperty.call(__TOAST_TYPES, opts.type) && __TOAST_TYPES[opts.type] ? opts.type : 'info';
    icon = opts.icon;
    // duration:0 (permanent) OCCUPE SA PLACE indéfiniment — ASSUMÉ (seuls la croix, close(), le clic
    // sur un toast cliquable ou le glisser la libèrent). opts.duration (nombre ≥0, 0 compris) PRIME sur µ.config.notifyDuration.
    duration = typeof opts.duration === 'number' && opts.duration >= 0 ? opts.duration : __toastDefaultDuration();
    // `opts.title` prime ; absent (undefined) → titre par défaut du type, écrit plus bas ; valeur FAUSSE
    // (false/''/null) → aucun élément titre émis plus bas.
    title = opts.title;

    rec = { type: type, duration: duration, sound: opts.sound, displayed: false, removed: false, timerId: null, left: 0, since: 0, holds: 0, off: [], pause: __toastFlag(opts.pause, 'notifyPause'), swipe: __toastFlag(opts.swipe, 'notifySwipe'), drag: null, leaving: false, eat: 0, slideTimer: null };

    rec.el = document.createElement('div');
    __toastRecs.set(rec.el, rec);
    rec.el.className = 'mjs-toast mjs-toast-' + type + (icon === false ? ' mjs-toast-no-icon' : '');
    if (type === 'error') { rec.el.setAttribute('role', 'alert'); }
    else { rec.el.setAttribute('role', 'status'); rec.el.setAttribute('aria-live', 'polite'); }

    // icône — par défaut celle du TYPE, même jeu de SVG que la modale (__modalIcons : chaîne constante du
    // framework). `opts.icon` la remplace : une chaîne SVG (`<svg…`, un seul <svg>, nettoyé par __toastSvg — refusée,
    // l'icône du type reste), toute AUTRE chaîne est une adresse d'image
    // (<img alt="">, jamais analysée comme du HTML ; l'adresse passe par µ._mjs_safeAttr, le filtre des adresses
    // du framework : javascript:/vbscript:/file: refusés, l'image reste alors sans `src`), un élément du
    // document (posé tel quel) ; `false` = aucune icône (classe mjs-toast-no-icon : le contenu prend la place de
    // la case). Toute autre valeur vaut l'absence d'option.
    if (icon !== false) {
      iconEl = document.createElement('i');
      iconEl.className = 'mjs-toast-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      if (typeof icon === 'string' && /^\s*<svg/i.test(icon)) { icon = __toastSvg(icon); }
      if (typeof icon === 'string' && icon) {
        img = document.createElement('img');
        img.setAttribute('alt', '');
        µ._mjs_safeAttr(img, 'src', icon);
        iconEl.appendChild(img);
      }
      else if (icon && icon.nodeType === 1) { iconEl.appendChild(icon); }
      else { iconEl.innerHTML = Object.prototype.hasOwnProperty.call(__modalIcons, type) ? __modalIcons[type] : ''; }
      rec.el.appendChild(iconEl);
    }

    contentEl = document.createElement('div');
    contentEl.className = 'mjs-toast-content';

    if (title || title === void 0) {
      titleEl = document.createElement('div');
      titleEl.className = 'mjs-toast-title';
      // titre par défaut du type : récrit à l'arrivée du fichier de la langue, le toast encore là, avec le nom accessible de
      // l'action, qui le reprend
      if (title === void 0) {
        __modalKeep(function() {
          titleEl.textContent = __toastTitle(type);
          if (actionEl) { actionEl.setAttribute('aria-label', titleEl.textContent + ' ' + msgEl.textContent); }
        });
      }
      else { titleEl.textContent = title; }
      contentEl.appendChild(titleEl);
    }

    msgEl = document.createElement('span');
    msgEl.className = 'mjs-toast-message';
    msgEl.textContent = message;
    contentEl.appendChild(msgEl);
    rec.el.appendChild(contentEl);

    // toast cliquable (opts.href ou opts.onClick) : l'élément d'action passe AVANT la croix — ordre de Tab, et la croix
    // le recouvre (cf. .mjs-toast-action ~ .mjs-toast-close)
    actionEl = __toastAction(rec, opts, titleEl, msgEl);
    if (actionEl) { rec.el.appendChild(actionEl); }

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mjs-toast-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function() { __toastRemove(rec); });
    rec.el.appendChild(closeBtn);

    // pause au survol et au focus : un toast permanent n'a rien à figer, il ne pose donc aucun écouteur
    if (rec.pause && duration > 0) { __toastBindPause(rec); }

    // glisser pour fermer : sur tout toast, permanent compris — c'est même lui qui en a le plus besoin
    if (rec.swipe) { __toastBindSwipe(rec); }

    // plafond LU ICI, au moment de l'affichage (pas à la création de la file) — un changement à
    // chaud de notifyMax profite au PROCHAIN toast qui se présente. __toastDisplay peut à son
    // tour REFUSER faute de place à l'écran : le toast rejoint alors la file, comme s'il
    // avait buté sur le plafond numérique. Des toasts partis avec le corps de la page rendent d'abord leurs places (__toastGone).
    __toastGone();
    if (__toastVisibleCount >= __toastMax() || !__toastDisplay(rec)) { __toastQueue.push(rec); __toastWatchResize(); }

    return { close: function() { __toastRemove(rec); } };
  },

  // fermeture programmatique GLOBALE de la modale COURANTE (cf. __modalCurrentClose, une seule
  // ouverte à la fois) — sans modale ouverte : no-op silencieux. `result` fusionné PAR-DESSUS le
  // résultat par défaut (les clés fournies gagnent).
  close: function(result) {
    if (!__modalCurrentClose) { return; }
    __modalCurrentClose(__modalDismissResult(result));
  }
};
