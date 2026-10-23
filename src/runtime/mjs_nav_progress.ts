// mjs_nav_progress — la barre de navigation : un trait de lumière qui court en haut de la page quand
// une navigation dure — un lien ou un formulaire (mjs_ujs.ts), une page du routeur dont le composant
// arrive (mjs_router.ts). Une navigation plus rapide que le seuil (cache, réseau local) n'affiche
// RIEN — un clignotement de quelques dizaines de ms est pire que son absence.
// `µ.config.navProgress` (mjs_init.ts) : `true` (défaut) = seuil 500ms ; un NOMBRE = ce seuil en ms ;
// `{ delay, place }` (place : `top`, défaut, ou `bottom`) ; `false` = rien d'inséré, rien qui tourne.
// L'allure : une feuille adoptée à la première barre, sélecteurs en `:where(…)` (spécificité nulle :
// une règle de l'appli sur `.mjs-nav-progress` l'emporte toujours), réglée par les variables
// `--mjs-nav-progress-color` (#58a6ff), `-height` (3px), `-speed` (1.2s), `-zindex` — aussi en
// variables de thème, `$$nav-progress-color`. Aucun style posé en JS.
// Timer + élément GLOBAUX, pas un par navigation (même régime que `µ.nav.active`, un booléen partagé,
// pas un compteur) : deux navigations qui s'enchaînent (la 2e abandonne la 1re, cf. `_mjs_abortStaleNav`
// de mjs_ujs.ts) ne doivent jamais empiler deux timers ni deux éléments — `_mjs_navProgressStart` ne
// fait rien si l'un des deux existe déjà.
µ._mjs_navProgressTimer = null;
µ._mjs_navProgressEl = null;
µ._mjs_navProgressSheet = null;
// le réglage lu à chaque navigation : absent = allumée (le défaut de mjs_init.ts)
µ._mjs_navProgressConf = function() {
  var cfg = µ.config ? µ.config.navProgress : void 0;
  if (cfg === void 0 || cfg === true) return { delay: 500, place: 'top' };
  if (typeof cfg === 'number') return cfg >= 0 ? { delay: cfg, place: 'top' } : null;
  if (cfg && typeof cfg === 'object') return { delay: typeof cfg.delay === 'number' ? cfg.delay : 500, place: cfg.place === 'bottom' ? 'bottom' : 'top' };
  return null;
};
// le trait de lumière : un reflet qui court le long du bord, avec sa lueur ; immobile et plein pour
// « réduire les animations »
µ._mjs_navProgressCss = ':where(.mjs-nav-progress){position:fixed;left:0;right:0;top:0;height:var(--mjs-nav-progress-height, 3px);z-index:var(--mjs-nav-progress-zindex, 2147483000);pointer-events:none;clip-path:inset(-12px 0);background:color-mix(in srgb, var(--mjs-nav-progress-color, #58a6ff) 18%, transparent);animation:mjs-nav-progress-in .25s ease-out both}'
  + ':where(.mjs-nav-progress[data-place="bottom"]){top:auto;bottom:0}'
  + ':where(.mjs-nav-progress)::before{content:"";position:absolute;top:0;bottom:0;left:0;width:35%;background:linear-gradient(90deg, transparent, var(--mjs-nav-progress-color, #58a6ff) 70%, #fff);box-shadow:0 0 10px var(--mjs-nav-progress-color, #58a6ff), 0 0 3px var(--mjs-nav-progress-color, #58a6ff);animation:mjs-nav-progress-run var(--mjs-nav-progress-speed, 1.2s) cubic-bezier(.4, 0, .2, 1) infinite}'
  + '@keyframes mjs-nav-progress-in{from{opacity:0}}'
  + '@keyframes mjs-nav-progress-run{from{transform:translateX(-100%)}to{transform:translateX(290%)}}'
  + '@media (prefers-reduced-motion:reduce){:where(.mjs-nav-progress){animation:none}:where(.mjs-nav-progress)::before{width:100%;animation:none;background:var(--mjs-nav-progress-color, #58a6ff)}}';
µ._mjs_navProgressStart = function() {
  var conf = µ._mjs_navProgressConf();
  if (!conf) { return; }
  if (µ._mjs_navProgressTimer || µ._mjs_navProgressEl) { return; } // déjà armé ou déjà affiché : rien à empiler
  µ._mjs_navProgressTimer = setTimeout(function() {
    µ._mjs_navProgressTimer = null;
    // la feuille, une fois, à la première barre (une appli où rien ne traîne n'en paie rien)
    if (!µ._mjs_navProgressSheet && typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets) {
      µ._mjs_navProgressSheet = new CSSStyleSheet();
      µ._mjs_navProgressSheet.replaceSync(µ._mjs_navProgressCss);
      µ._mjs_navProgressSheet._mjs_keep = true;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, µ._mjs_navProgressSheet];
    }
    µ._mjs_navProgressEl = document.createElement('div');
    µ._mjs_navProgressEl.className = 'mjs-nav-progress';
    µ._mjs_navProgressEl.setAttribute('role', 'progressbar');
    µ._mjs_navProgressEl.setAttribute('aria-hidden', 'true');
    if (conf.place === 'bottom') { µ._mjs_navProgressEl.setAttribute('data-place', 'bottom'); }
    document.body.appendChild(µ._mjs_navProgressEl);
  }, conf.delay);
};
// Appelée à CHAQUE fin de navigation (succès, échec, abandon, repli natif — partout où
// `µ.nav.active` repasse à `false` ; côté routeur, quand les composants de la page sont arrivés, ou
// que l'autoloader renonce à l'un d'eux) : annule le timer s'il n'a pas encore sonné, retire
// l'élément s'il a eu le temps d'apparaître. Idempotente (aucun des deux n'existe forcément).
µ._mjs_navProgressStop = function() {
  if (µ._mjs_navProgressTimer) { clearTimeout(µ._mjs_navProgressTimer); µ._mjs_navProgressTimer = null; }
  if (µ._mjs_navProgressEl) {
    if (µ._mjs_navProgressEl.parentNode) { µ._mjs_navProgressEl.parentNode.removeChild(µ._mjs_navProgressEl); }
    µ._mjs_navProgressEl = null;
  }
};
