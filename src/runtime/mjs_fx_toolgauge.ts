// mjs_fx_toolgauge — garde de cadence des effets économes : tant qu'un effet lourd (définition marquée `heavy`) est posé, elle juge la cadence
// des images (30 images de chauffe, puis deux fenêtres de 60 images à plus de 28 ms d'affilée) et passe en économe pour le reste de la
// visite (µ._mjs_fxGoLite, mjs_fx.ts)
//   µ._mjs_fxGauge(heavy)    appelée par le moteur à chaque pose d'un effet lourd avec l'ensemble des effets lourds posés ; le premier appel
//                            installe la garde, les suivants rebranchent son écoute si le dernier effet lourd était parti
// embarquée seulement avec un effet lourd (bundler/fx-tools.ts)
// le premier effet lourd posé décide du réglage (`"effects": { "lite": "on" }` : économe d'emblée, `"off"` : jamais) et de l'économie de
// données (navigator.connection.saveData : économe d'emblée)
// aucune image au repos : une salve de 151 images à la pose du premier effet lourd (chauffe + deux fenêtres : un appareil lent qui joue seul
// est jugé sans geste, dans tous les navigateurs), puis la mesure ne s'arme qu'à un geste (pointeur, molette, défilement) ou à une image
// longue (50 ms et plus) que le navigateur signale de lui-même (PerformanceObserver `long-animation-frame`, là où il existe : Chromium) ;
// elle mesure dix images au-delà du dernier signal, puis se tait ; un onglet caché ne reçoit ni geste ni image
// les fenêtres comptées se gardent d'une salve à l'autre ; plus aucun effet lourd posé, plus de mesure : ses écouteurs et son observateur
// partent au premier signal qui suit, et reviennent avec le prochain effet lourd ; le verdict rendu (économe, ou vingt fenêtres fluides
// d'affilée), plus de signal pris en compte : ses écouteurs et son observateur partent pour de bon, la salve en cours s'achève
// une pause (250 ms et plus entre deux images) ne compte pas et ne consomme pas la salve : le verdict tombe aux images qui comptent, pauses en
// plus ; 150 pauses au plus par salve, soit 300 images : une page de moins de quatre images par seconde n'est pas jugée, elle ne reste pas sous mesure ;
// ses images longues sont alors celles de la mesure elle-même : passé ces 150 pauses, l'observateur part (un geste arme encore la mesure)

µ._mjs_fxGauge = function(heavy) {
  µ._mjs_fxGauge = function() {};
  var mode = µ._fxConf && µ._fxConf.lite;
  if (mode === 'on' || (mode !== 'off' && (navigator.connection || 0).saveData)) µ._mjs_fxGoLite();
  if (µ._mjs_fxLite || mode === 'off') return;
  var last  = 0;
  var count = 0;
  var sum   = 0;
  var bad   = 0;
  var good  = 0;
  var left  = 0;
  var skip  = 0;
  // `left` : les images de mesure à venir, dont une est toujours en attente tant qu'il n'est pas nul ; `skip` : les pauses de la salve en cours
  var tick = function(now) {
    var dt = last && now - last;
    last = now;
    // une pause (point d'arrêt) ne compte pas, les trente premières images non plus (chauffe) ; une fenêtre : les 60 suivantes
    if (heavy.size && dt > 0 && dt < 250 && ++count > 30) {
      sum += dt;
      if (count === 90) {
        var lent = sum > 1680;
        bad   = lent ? bad + 1 : 0;
        good  = lent ? 0 : good + 1;
        count = 30;
        sum   = 0;
        if (bad > 1) µ._mjs_fxGoLite();
        if (bad > 1 || good >= 20) quit();
      }
    }
    // une pause ne consomme pas la salve (elle va jusqu'à son verdict), mais 150 au plus : une page qui n'a que des pauses ne reste pas sous mesure
    if (heavy.size && (dt < 250 ? --left > 0 : ++skip < 150)) requestAnimationFrame(tick);
    else {
      // les 150 pauses épuisées : chaque image de mesure, longue, relançait une salve, la page restait sous mesure au repos
      if (skip > 149 && po) {
        po.disconnect();
        po = null;
      }
      left = last = skip = 0;
    }
  };
  // un geste ou une image longue : dix images de mesure au moins à partir du dernier signal ; le verdict rendu, plus rien ; aucun effet
  // lourd posé, plus d'écoute (elle revient avec le prochain)
  var arm = function() {
    if (!heavy.size) quit();
    else if (bad < 2 && good < 20) {
      if (!left) requestAnimationFrame(tick);
      if (left < 10) left = 10;
    }
  };
  var types = 'pointermove wheel scroll'.split(' ');
  var on    = false;
  var po    = null;
  // l'écoute des signaux : les gestes, et les images longues que le navigateur signale
  var listen = function() {
    on = true;
    types.forEach(function(type) {
      addEventListener(type, arm, { capture: true, passive: true });
    });
    try {
      if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) (po = new PerformanceObserver(arm)).observe({ type: 'long-animation-frame' });
    }
    catch {}
  };
  // plus d'écoute : le verdict rendu (pour de bon), ou plus aucun effet lourd posé
  var quit = function() {
    if (!on) return;
    on = false;
    types.forEach(function(type) {
      removeEventListener(type, arm, { capture: true });
    });
    if (po) po.disconnect();
    po = null;
  };
  // un effet lourd posé après le départ du dernier : l'écoute revient, tant que le verdict n'est pas rendu
  µ._mjs_fxGauge = function() {
    if (!on && bad < 2 && good < 20) listen();
  };
  listen();
  // la salve de la pose : 151 images, la chauffe et deux fenêtres, de quoi rendre un verdict sans geste ni signal du navigateur
  arm();
  left = 151;
};
