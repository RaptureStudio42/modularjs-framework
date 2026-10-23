// mjs_theme — thème clair/sombre EMBARQUÉ du framework (`µ._mjs_themeSheet`, 8 variables
// `--mjs-surface`/`--mjs-fg`/`--mjs-fg-muted`/`--mjs-border`/`--mjs-hover`/`--mjs-selected`/
// `--mjs-accent`/`--mjs-shadow`) + thèmes de l'APPLICATION (`µ._mjs_themeAppSheet`/`µ._themeAdopt`,
// fichiers `*.theme.mjs`) — DÉTACHÉ de mjs_init.ts : le cœur ne FORCE jamais le thème, il le
// sert s'il est là (même doctrine que `mjs_title.ts`).
//
// DÉTECTÉ, jamais embarqué d'office (bundler/index.ts, resolveRuntimeFiles/wantsTheme) :
//   - le CSS compilé d'une source contient l'une des 8 variables ci-dessus (`var(--mjs-x)` écrit
//     en dur, ou `$$x` — réécrit en texte `var(--mjs-x)` AVANT la compilation JS, cf.
//     transpiler/index.ts rewriteStyleVars — aucun signal séparé nécessaire pour `$$`) ;
//   - le JS compilé contient `__mjsTheme` (rune `µtheme`, cf. sigils.ts MU_THEME_OUT) ;
//   - le projet a au moins un fichier `*.theme.mjs` ;
//   - un consommateur du framework est sélectionné — VÉRIFIÉ par grep `var\(--mjs-` dans
//     src/runtime/*.ts (pas déduit du seul nom du fichier) : mjs_modal.ts (--mjs-border/fg/
//     fg-muted/hover/shadow/surface) et mjs_title.ts (--mjs-border) lisent RÉELLEMENT une
//     variable canonique — mjs_page_cache.ts/mjs_vt_presets.ts/mjs_devpanel.ts ont chacun leur
//     PROPRE espace `--mjs-<module>-*` et n'en lisent aucune, écartés ;
//   - une page hors construction pose `theme="…"`/lit `var(--mjs-…)` (indétectable) :
//     `runtime: ['theme']` la force, comme `title`.
//
// Position dans l'ordre CANONIQUE (bundler/index.ts) : juste après `mjs_init.ts`, sa position
// d'origine (le bloc vivait en fin de mjs_init.ts, avant le reste du fichier).

// Variables de thème clair/sombre (µtheme, cf. mjs_store_globals.ts __mjsTheme) — custom properties
// GLOBALES consommées par le CSS du framework (toast/modal/tooltip) et par les modules cœur : elles
// traversent les shadow trees PAR HÉRITAGE (pas de re-déclaration par composant). Bascule via
// l'attribut `data-mjs-theme` posé sur <html> — canal CSS unique (cf. µ._mjs_themeApply côté boot,
// mjs_store_globals.ts) : cette feuille ne fait QUE consommer l'attribut, aucune détection ici
// (media query, OS…), tout ça vit dans le boot JS.
µ._mjs_themeSheet = new CSSStyleSheet();

// thèmes imbriqués (mesuré au navigateur, Firefox 1532 et Chromium 1228, résultats
// identiques) : le `:root` disparaît du jeu sombre, sinon une section marquée sombre à
// l'intérieur d'une page claire (ou l'inverse) resterait bloquée à la racine — `:where()` garde
// une spécificité nulle, donc l'imbrication se fait à volonté, et l'héritage des custom
// properties traverse les frontières shadow. Le jeu clair garde `:root` (c'est le défaut sans
// attribut) et gagne les deux mêmes sélecteurs que le sombre. Deux attributs par jeu :
// `data-mjs-theme` = canal posé par la rune µtheme sur <html> (cf. mjs_store_globals.ts) ;
// `theme` = ce que l'auteur d'une page écrit à la main sur une section pour la déclarer dans un
// jeu différent de celui du document.
µ._mjs_themeSheet.replaceSync(`:where(:root),:where([data-mjs-theme='light']),:where([theme='light']){--mjs-surface:#fff;--mjs-fg:#222;--mjs-fg-muted:#666;--mjs-border:#d0d0d0;--mjs-hover:#f2f2f2;--mjs-selected:#e6f0ff;--mjs-accent:#3b82f6;--mjs-shadow:rgba(0,0,0,.18)}
:where([data-mjs-theme='dark']),:where([theme='dark']){--mjs-surface:#232936;--mjs-fg:#e8eaed;--mjs-fg-muted:#9aa3af;--mjs-border:#3a4150;--mjs-hover:#2c3442;--mjs-selected:#2c3e5d;--mjs-accent:#3b82f6;--mjs-shadow:rgba(0,0,0,.55)}`);

document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_themeSheet];

// THÈME EN CERCLE — une bascule de thème qui suit un clic (ou Entrée, Espace sur l'élément actif) se
// propage en cercle depuis ce point, par une transition de vue (View Transitions) : l'ancien thème
// reste en photo, le nouveau s'ouvre par-dessus en 500 ms. D'un coup sinon : bascule venue du
// système ou du code (aucun geste depuis 1,5 s), navigateur sans View Transitions, « réduire les
// animations », ou `"effects": { "theme": "none" }` (µ._fxConf, posé par le manifeste). Ses deux
// règles ne valent que sous l'attribut `mjs-theme-circle`, posé le temps du cercle : les transitions
// de page (@viewTransition) ne changent pas.
// (un navigateur sans View Transitions refuse le sélecteur : la règle n'y sert à rien)
try {
  µ._mjs_themeSheet.insertRule(':root[mjs-theme-circle]::view-transition-old(root),:root[mjs-theme-circle]::view-transition-new(root){animation:none;mix-blend-mode:normal}', µ._mjs_themeSheet.cssRules.length);
}
catch (e) { /* sélecteur inconnu */ }
var _mjsThemeGeste = null;
document.addEventListener('pointerdown', function(e) { _mjsThemeGeste = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') { return; }
  // l'élément actif, jusque dans les composants (shadow root fermé : `_shadow`) ; mesuré seulement si
  // le thème bascule (µ._mjs_themeSwap) : taper des espaces dans un champ ne force aucune mise en page
  var a = document.activeElement;
  for (var sh = a && (a.shadowRoot || a._shadow); sh && sh.activeElement; sh = a.shadowRoot || a._shadow) { a = sh.activeElement; }
  if (!a || !a.getBoundingClientRect) { return; }
  _mjsThemeGeste = { el: a, t: Date.now() };
}, true);
µ._mjs_themeSwap = function(value, set) {
  var html = document.documentElement;
  var g    = _mjsThemeGeste;
  _mjsThemeGeste = null;
  var rond = !!g && Date.now() - g.t <= 1500 && !(µ._fxConf && µ._fxConf.theme === 'none') && typeof document.startViewTransition === 'function' && html.dataset.mjsTheme !== value;
  // (le système n'est interrogé qu'en dernier : le boot ne le consulte pas)
  if (!rond || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    set();
    return;
  }
  // une touche : le centre de l'élément actif, mesuré maintenant
  if (g.el) {
    var b = g.el.getBoundingClientRect();
    g = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  // le rayon qui atteint le coin le plus loin du point
  var r   = Math.ceil(Math.hypot(Math.max(g.x, window.innerWidth - g.x), Math.max(g.y, window.innerHeight - g.y)));
  var at  = ' at ' + Math.round(g.x) + 'px ' + Math.round(g.y) + 'px)';
  var fin = function() { html.removeAttribute('mjs-theme-circle'); };
  html.setAttribute('mjs-theme-circle', '');
  var vt;
  try {
    vt = document.startViewTransition(set);
  }
  catch (e) {
    fin();
    set();
    return;
  }
  vt.ready.then(function() {
    html.animate({ clipPath: ['circle(0px' + at, 'circle(' + r + 'px' + at] }, { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' });
  }, function() {});
  vt.finished.then(fin, fin);
};

// Thèmes de l'APPLICATION (fichiers `*.theme.mjs`) — leur CSS agrégé arrive par le manifeste
// dans `µ._themeCss`, sur sa propre feuille : les variables du framework ci-dessus restent lisibles
// tels quels, et un thème d'app qui redéclare l'un d'eux le recouvre simplement (le manifeste
// est adopté APRÈS). Appelable dans les deux sens — le manifeste appelle cette fonction s'il
// arrive après le runtime, et le runtime l'appelle au boot si le manifeste est déjà passé : plus
// aucun ordre de chargement à garantir, ni de course à perdre.
// La feuille existe DÈS LE BOOT, même vide : chaque Shadow DOM l'adopte au montage
// (mjs_element.ts, `_mjs_applyLayout`) et c'est la MÊME instance partout — quand le manifeste
// arrive et la remplit, tous les composants déjà montés suivent, sans un seul re-parcours
// de l'arbre. La créer paresseusement laissait sans thème tout composant monté avant elle.
µ._mjs_themeAppSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_themeAppSheet];

µ._themeAdopt = function() {
  if (!µ._themeCss) { return; }
  µ._mjs_themeAppSheet.replaceSync(µ._themeCss);
};
µ._themeAdopt();
