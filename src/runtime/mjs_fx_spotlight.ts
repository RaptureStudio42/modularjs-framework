// mjs_fx_spotlight — `*spotlight` : une lumière suit la souris sur la balise — un halo dedans, un
// liseré qui s'allume au bord, ou les deux (deux pseudo-éléments : `::before` pour le liseré,
// `::after` pour le halo, sous le contenu) — ou, en mode `veil`, un voile sombre posé sur tout le
// contenu et percé d'un trou de lumière : on ne lit que dans la lumière. Réglages : color (la
// lumière ; #fff — veil : la couleur du voile ; #0a0a0f), where (both : le halo et le liseré ; fill :
// le halo seul ; border : le liseré seul, comme une lampe torche ; veil : le voile percé ; both),
// size (le rayon de la lumière en px ; 200 — veil : le diamètre du disque net ; 160), fill (la force
// du halo, de 0 à 1 ; 0.25 — veil : l'opacité du voile ; 0.97), width (l'épaisseur du liseré en px ;
// 2), soft (veil : la largeur du bord qui s'efface autour du disque net, en px ; 120), smooth (le
// retard du suivi, de 0.01 à 1 : 1 colle à la souris, 0.15 la rattrape en douceur ; 1 ; une valeur
// hors de ces bornes, venue d'une variable, est ramenée dedans), on (hover : allumée au survol ;
// always : toujours, au centre quand la souris est ailleurs).
// Le mode s'écrit `where: veil` : la valeur sans nom de `*spotlight` est la couleur, `*spotlight(veil)`
// la lirait comme telle — un avertissement le dit.
// `origin` : là où la lumière se tient — pointer (le défaut) : elle suit la souris ; un point (`bottom-left`, `20% 80%`) : elle y reste, sans
// la souris, allumée d'office (`on: always`) ou le temps du survol — une lueur qui part d'un coin et déborde dans la boîte. Le halo et le liseré
// sont alors ceux du repos, posés là par leurs deux variables (en %, la place suit la taille de la balise) : rien d'autre n'écoute, rien ne tourne.
// Le voile suit toujours la souris. `glow` : la portée du halo dans la boîte, en px (sans lui, celle du liseré : 0,72 fois `size`). `every` :
// allumée, la lumière s'allume par instants, un éclat à chaque durée (« réduire les animations » : allumée sans éclat) ; sans lui, la variable de thème
// `$$spotlight-every` l'allume, à sa durée ; `$$fx-every`, la cadence commune des effets qui se répètent, ne l'allume pas. Toujours allumée (`on: always`),
// l'éclat se cale sur l'horloge commune de ces effets : ses tours partent des multiples de sa durée, comptés depuis le début de la page.
// Le halo et le liseré ne posent aucun nœud dans la balise : `:empty`, `:last-child`, `childElementCount`,
// `li:last-child` de l'auteur visent ce qu'ils visaient, et un `innerHTML` ne les emporte pas. Le liseré est
// celui d'avant : un dégradé radial sous un masque en anneau, dont la souris écrit le centre (deux
// variables, `--mjs-fx-spot-x` et `-y`, sur la balise). Au repos, le halo est celui d'avant (toute la balise, un
// dégradé radial au centre, ou là où ces deux variables le posent : rien ne tourne, rien n'écoute, le rendu est exactement le même). Pendant le survol, il
// n'est plus repeint : son pseudo-élément n'a aucune taille (ni mise en page, ni zone défilable de plus : il n'est
// qu'un point) et sa lumière, un dégradé radial en image de bordure, déborde de lui de 0,72 fois `size` tout autour ; `translate` pose ce point sous
// la souris et un `clip-path` contre-déplacé (la boîte de la balise, arrondis compris) rogne la lumière à la
// balise, sans `overflow` sur elle. Les deux changent par les images clés d'une animation
// Web terminée du pseudo-élément (elle ne promeut rien au repos) : aucune variable, la carte graphique déplace le calque
// (`will-change` ne le promeut que pendant le survol). Aucun gestionnaire d'événement ne les réécrit : un mouvement de la souris et un rayon que l'application change (`off.set`) demandent une image (une seule, quel que soit leur nombre)
// qui écrit la dernière position juste avant le dessin ; la boucle de lissage, la relecture de l'arrondi et le suivi d'une transition d'arrondi écrivent dans leur image (le début d'une transition, dans l'étape du rendu
// qui l'annonce), l'observateur de taille dans l'étape du rendu qui le rappelle, et seule la naissance de l'animation, à l'entrée de la souris, se fait dans le gestionnaire. Firefox perd le fondu d'allumage du halo
// (son opacité reste à 0 ou à mi-course, la souris dessus) quand les images clés changent plusieurs fois hors d'une image pendant ce fondu (une écriture isolée passe). Rien ne tourne souris immobile ni sortie. Sans animation Web (navigateur ancien), le halo
// n'est pas dessiné. La boucle de lissage s'arrête quand la lumière a rejoint la souris.
// Une balise sans taille intérieure (en ligne : un lien, un composant qui n'a pas de `display`) n'a rien à rogner : son halo reste celui d'avant, repeint, placé par les
// deux mêmes variables que le liseré, sans animation ni promotion. La balise cachée par `display: none` (elle ou un ancêtre) puis montrée de nouveau perd l'animation
// de son pseudo-élément sans un événement : un observateur de taille, posé le temps du survol, la repose là où la lumière était.
// L'arrondi du rognage est lu à l'entrée de la souris et relu une fois à l'image qui suit (Firefox applique `:hover` après l'événement d'entrée : l'arrondi d'un `:hover` sans transition n'y est pas encore), le halo n'étant redessiné que s'il a changé ; puis il est relu image par image tant qu'une transition de `border-radius` de la balise elle-même court (son événement `transitionrun`, écouté le temps que la lumière est là : celui d'un enfant monte jusqu'à la balise et n'est pas pris) : la boucle s'arrête avec la transition et avec la lumière. Un arrondi changé sans transition pendant le survol (une classe posée par un script), par une animation CSS ou par une transition déjà en cours à l'entrée n'est relu qu'à l'entrée suivante de la souris.
// Le voile est un calque (un `<span>`) posé dans la balise — dans le composant, sur un composant ;
// sur `<@document>`, un calque fixe qui couvre la page —, qui laisse passer les clics et rogne ce qu'il
// porte au contour arrondi de la balise ; il porte UN disque (un `<span>`, un dégradé radial peint une
// fois) que la souris déplace par `translate`, la seule écriture de chaque image, sur ce disque ; l'ombre
// portée du disque fait le voile autour, et ne dépasse pas ce qui couvre la balise (la plus grande de ses
// dimensions, relue quand elle change). Le voile lit la boîte de la balise à l'entrée de la souris (relue
// après un défilement ou un redimensionnement), jamais à chaque mouvement ; le halo et le liseré sans
// retard (`smooth: 1`, le défaut) la relisent à chaque mouvement (une carte qui bouge ou grossit au survol
// garde la lumière sous la souris), avec trois écouteurs sans options ; avec un retard, la boucle de
// lissage s'y ajoute et la boîte reste relue à chaque mouvement, jamais dans la boucle. Le voile de survol
// (`on: hover`) n'existe que pendant le survol : le calque naît à l'entrée de la souris, s'efface à la
// sortie, puis part. « Réduire les animations » : la lumière colle à la souris, sans retard ni fondu.
//
// Sections marquées (`// @@ …`, filtrées par le build, bundler/fx-sections.ts) : `where=veil` (le voile : son calque, son disque, ses règles, l'écoute de l'entourage, la page
// entière), `soft` (la variable du bord du voile, aussi posée sans voile), `smooth` (le retard : sa boucle d'images et son suivi sur place), `where=veil smooth` (le chemin de la
// lumière quand elle a un point visé, relu à l'entrée de la souris : le voile ou le retard), `on=always` (la lumière toujours allumée : son retour au centre, qui glisse quand il y a un retard, son calque et son
// observateur de taille), `where=fill` (la règle d'un halo seul que le navigateur ne sait pas animer) et `color=both,fill,border,veil` (l'avertissement du mode écrit à la place
// d'une couleur), `origin` (la lumière tenue en un point), `glow` (sa variable) et `every` (l'éclat écrit : sa variable et son attribut ; sa règle part toujours, `$$spotlight-every` l'allume aussi) ne partent que si l'appli écrit le réglage ; tel quel, le fichier porte tout. Ce que fait `*spotlight` sans rien écrire n'est dans aucune section : le halo et
// le liseré, leur feuille, leur pose, leur suivi de la souris et leur retrait.

µ._mjs_fxDefs.spotlight = {
  // réglage `radius` : l'arrondi posé par le cœur (mjs_fx.ts)
  radius: true,
  css: '[mjs-fx~="spotlight"]{isolation:isolate}'
    // le halo au repos : celui d'avant, toute la balise et un dégradé radial (effacé à `glow`, sinon à 72 % du rayon `size`) au centre, ou là où les deux variables le posent
    + '[mjs-fx~="spotlight"]::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;background:radial-gradient(circle var(--mjs-spotlight-glow,calc(var(--mjs-spotlight-size,200px) * .72)) at var(--mjs-fx-spot-x,50%) var(--mjs-fx-spot-y,50%),color-mix(in srgb,var(--mjs-spotlight-color,#fff) calc(var(--mjs-spotlight-fill,.25) * 100%),transparent) 0%,transparent);opacity:0;transition:opacity .3s ease}'
    // le halo pendant le survol : un point sans taille, dont l'image de bordure (le même dégradé) déborde de `glow` (sinon de 0,72 fois `size`) tout autour ; promu
    + '[mjs-fx~="spotlight"][mjs-fx-live]::after{inset:auto;left:0;top:0;width:0;height:0;border-radius:0;background:none;border:0 solid;border-image:radial-gradient(circle closest-side,color-mix(in srgb,var(--mjs-spotlight-color,#fff) calc(var(--mjs-spotlight-fill,.25) * 100%),transparent) 0%,transparent 100%) 0 fill / 0 / var(--mjs-spotlight-glow,calc(var(--mjs-spotlight-size,200px) * .72));will-change:transform}'
    // le liseré : le dégradé radial sous un masque en anneau, par-dessus le contenu
    + '[mjs-fx~="spotlight"]::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-sizing:border-box;padding:var(--mjs-spotlight-width,2px);background:radial-gradient(circle var(--mjs-spotlight-size,200px) at var(--mjs-fx-spot-x,50%) var(--mjs-fx-spot-y,50%),var(--mjs-spotlight-color,#fff) 0%,transparent 72%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);opacity:0;transition:opacity .3s ease}'
    + '[mjs-fx~="spotlight"][mjs-fx-spot-where="border"]::after{display:none}'
    + '[mjs-fx~="spotlight"][mjs-fx-spot-where="fill"]::before{display:none}' // @@ where=fill
    // le voile (un calque) : aucun pseudo-élément
    + '[mjs-fx~="spotlight"][mjs-fx-spot-where="veil"]::before,[mjs-fx~="spotlight"][mjs-fx-spot-where="veil"]::after{display:none}' // @@ where=veil
    // un halo seul que le navigateur ne sait pas animer : aucun pseudo-élément
    + '[mjs-fx~="spotlight"][mjs-fx-spot-where="none"]::before,[mjs-fx~="spotlight"][mjs-fx-spot-where="none"]::after{display:none}' // @@ where=fill
    + '[mjs-fx~="spotlight"][mjs-fx-spot-on]::after{opacity:1}'
    + '[mjs-fx~="spotlight"][mjs-fx-spot-on]::before{opacity:1}'
    // l'éclat : allumée, la lumière s'allume par instants — un éclat, puis plus rien jusqu'au suivant. Sa durée : `every` écrit sur la balise (sa
    // variable, posée sur elle), sinon la variable de thème `$$spotlight-every` ; sans l'une ni l'autre, la déclaration ne vaut rien et la lumière
    // reste allumée sans éclat : la cadence commune `$$fx-every` n'allume rien. La règle part toujours, la variable de thème pouvant venir d'une
    // feuille que la construction ne lit pas. Avec « réduire les animations », allumée sans éclat
    + '@media (prefers-reduced-motion:no-preference){[mjs-fx~="spotlight"][mjs-fx-spot-on]::after,[mjs-fx~="spotlight"][mjs-fx-spot-on]::before{animation:mjs-fx-spot-flash var(--mjs-spotlight-every) ease-out infinite}}'
    + '@keyframes mjs-fx-spot-flash{0%,55%,100%{opacity:0}12%{opacity:1}}'
    // @@ where=veil
    // le calque du voile : immobile, allumé par un attribut (le fondu dure 0,3 s ; éteint, il ne peint rien), rogné au contour arrondi de la balise
    + '[mjs-fx-layer="spotlight"]{position:absolute;inset:0;border-radius:inherit;pointer-events:none;contain:strict;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility 0s .3s}'
    + '[mjs-fx-layer="spotlight"][mjs-fx-veil-on]{opacity:1;visibility:visible;transition:opacity .3s ease,visibility 0s}'
    + '[mjs-fx-layer="spotlight"][mjs-fx-veil-doc]{position:fixed}'
    // le disque : au centre du calque (la souris le déplace par `translate`), promu seulement pendant que la souris est dessus
    + '[mjs-fx-layer="spotlight"]>span{position:absolute;left:50%;top:50%}'
    + '[mjs-fx-layer="spotlight"][mjs-fx-live]>span{will-change:transform}'
    // le voile : le calque a ses propres variables (la couleur, l'opacité et le diamètre écrits sur la balise, ou posés par un thème, sinon les valeurs du voile) ;
    // le disque est le trou (net sur `size`, puis le voile revient sur `soft`) et son ombre portée fait le voile tout autour, sur l'étendue que le script écrit (`--mjs-fx-veil-r`)
    + '[mjs-fx-lamp="veil"]{--mjs-fx-veil-c:var(--mjs-spotlight-color);--mjs-fx-veil-f:var(--mjs-spotlight-fill);--mjs-fx-veil-d:var(--mjs-spotlight-size);z-index:2147482999}'
    + '[mjs-fx-lamp="veil"]>span{width:calc(var(--mjs-fx-veil-d,160px) + 2 * var(--mjs-spotlight-soft,120px));height:calc(var(--mjs-fx-veil-d,160px) + 2 * var(--mjs-spotlight-soft,120px));margin:calc(var(--mjs-fx-veil-d,160px) / -2 - var(--mjs-spotlight-soft,120px)) 0 0 calc(var(--mjs-fx-veil-d,160px) / -2 - var(--mjs-spotlight-soft,120px));background:radial-gradient(circle closest-side,transparent calc(var(--mjs-fx-veil-d,160px) / 2),color-mix(in srgb,var(--mjs-fx-veil-c,#0a0a0f) calc(var(--mjs-fx-veil-f,.97) * 100%),transparent) 100%);box-shadow:0 0 0 var(--mjs-fx-veil-r,1000px) color-mix(in srgb,var(--mjs-fx-veil-c,#0a0a0f) calc(var(--mjs-fx-veil-f,.97) * 100%),transparent)}'
    // @@
    + '@media (prefers-reduced-motion:reduce){[mjs-fx~="spotlight"]::after,[mjs-fx~="spotlight"]::before'
    + ',[mjs-fx-layer="spotlight"],[mjs-fx-layer="spotlight"][mjs-fx-veil-on]' // @@ where=veil
    + '{transition:none}}',
  vars: {
    color: '',
    size: 'px',
    fill: '',
    width: 'px',
    glow: 'px', // @@ glow
    every: '', // @@ every
    soft: 'px' // @@ where=veil soft
  },
  setup: function(el, s) {
    var veil    = s.where === 'veil'; // @@ where=veil
    var page    = veil && el === document.documentElement; // @@ where=veil
    var always  = s.on === 'always'; // @@ on=always
    var smooth  = µ._mjs_fxCalm() ? 1 : µ._mjs_fxLagSetting(s.smooth, 1); // @@ smooth
    var restore =
      page ? function() {} : // @@ where=veil
      µ._mjs_fxRelative(el);
    // le halo demande l'animation Web des pseudo-éléments ; le voile, un calque posé dans la balise (dans son shadow root si c'est un composant, qui adopte la feuille)
    var halo    = s.where !== 'border' && typeof Element === 'function' && typeof Element.prototype.animate === 'function';
    var rim     = s.where !== 'fill';
    var root    = veil ? (page ? document : µ._mjs_fxInner(el)) : null; // @@ where=veil
    var lamps   = []; // @@ where=veil
    var lamp    = null;
    // @@ where=veil
    var ro      = null; // @@ on=always
    // @@
    var radii   = ['0px', '0px'];
    var flow    = false;
    var eye     = null;
    var morph   = 0;
    var beam    = 0;
    var inside  = false;
    var home    = false; // @@ on=always
    // @@ smooth
    var known   = false; // @@ on=always
    // @@
    var box     = null; // @@ where=veil smooth
    var frame   = 0; // @@ smooth
    var last    = 0; // @@ smooth
    var gone    = 0;
    var wd      = 0;
    var ht      = 0;
    var tx      = 0; // @@ where=veil smooth
    var ty      = 0; // @@ where=veil smooth
    var gx      = 0;
    var gy      = 0;
    var cx      = 0; // @@ where=veil
    var cy      = 0; // @@ where=veil
    var seeing  = null; // @@ where=veil
    // `*spotlight(veil)` : la valeur sans nom est la couleur, le mode s'écrit `where: veil` ; rien ne se verrait
    if (/^(both|fill|border|veil)$/.test(s.color)) µ.warn(µ._mjs_msg('spotlightWhere', { word: s.color }, '*spotlight : « {word} » est lu comme une couleur, non comme un mode — écrivez *spotlight(where: {word}).'), el); // @@ color=both,fill,border,veil
    if (root) µ._mjs_fxAdopt(root, 'spotlight'); // @@ where=veil
    // ce que la feuille montre : rien de plus que le halo ou le liseré demandés (et possibles), ou le voile
    var shown = halo && rim ? '' : halo ? 'fill' : rim ? 'border' : 'none';
    // @@ where=veil
    if (veil) {
      halo  = rim = false;
      shown = 'veil';
    }
    // @@
    if (shown) µ._mjs_dom.setAttribute(el, 'mjs-fx-spot-where', shown);
    if (s.every) µ._mjs_dom.setAttribute(el, 'mjs-fx-spot-every', ''); // @@ every
    // @@ where=veil
    // le calque du voile, avec son disque ; la lumière est au centre du calque tant que le disque n'a pas de `translate`
    var born = function() {
      if (!veil || lamps.length) return;
      var layer = document.createElement('span');
      layer.setAttribute('mjs-fx-layer', 'spotlight');
      layer.setAttribute('mjs-fx-lamp', 'veil');
      layer.setAttribute('aria-hidden', 'true');
      if (page) layer.setAttribute('mjs-fx-veil-doc', '');
      layer.appendChild(document.createElement('span'));
      µ._mjs_dom.appendChild(page ? document.body : root || el, layer);
      lamps.push(layer);
      if (page) size();
    };
    var drop = function() {
      clearTimeout(gone);
      gone = 0;
      lamps.forEach(function(layer) { layer.remove(); });
      lamps = [];
    };
    // l'étendue de l'ombre du voile (`--mjs-fx-veil-r`, sur le calque) : la plus grande dimension de ce qu'il couvre ; écrite seulement quand elle change, jamais à chaque mouvement de la souris
    var reach = function() {
      var far = Math.max(wd, ht) + 'px';
      lamps.forEach(function(layer) { if (layer.style.getPropertyValue('--mjs-fx-veil-r') !== far) layer.style.setProperty('--mjs-fx-veil-r', far); });
    };
    // @@
    // le calque d'un survol part une fois effacé (le fondu dure 0,3 s) ; une nouvelle entrée pendant ce temps le reprend
    // le halo de survol redevient celui d'avant : plus promu, son animation défaite
    var rest = function() {
      flag('mjs-fx-live', false);
      renew();
      if (eye) eye.disconnect();
      eye = null;
      if (morph) cancelAnimationFrame(morph);
      µ._mjs_dom.removeEventListener(el, 'transitionrun', follow);
    };
    var fade = function() {
      // @@ where=veil
      if (veil) {
        if (!lamps.length) return;
        return µ._mjs_fxCalm() ? drop() : void (gone = setTimeout(drop, 400));
      }
      // @@
      return µ._mjs_fxCalm() ? rest() : void (gone = setTimeout(rest, 400));
    };
    // un attribut posé ou retiré sur la balise (halo, liseré) ou sur le calque (voile) : allumé (opacité), ou promu (`will-change`, le temps du survol)
    var flag = function(name, on) {
      var nodes = [el];
      if (veil) nodes = lamps; // @@ where=veil
      nodes.forEach(function(node) {
        if (on) µ._mjs_dom.setAttribute(node, name, '');
        else µ._mjs_dom.removeAttribute(node, name);
      });
    };
    // @@ on=always
    // l'éclat de la lumière toujours allumée se cale sur l'horloge commune des effets qui se répètent : ses tours partent des multiples de sa
    // durée, comptés depuis le début de la page (repris à chaque départ de son animation)
    var beat = function(e) {
      if (e.animationName !== 'mjs-fx-spot-flash' || typeof el.getAnimations !== 'function') return;
      µ._mjs_dom.getAnimations(el, { subtree: true }).forEach(function(a) { if (a.animationName === 'mjs-fx-spot-flash') a.startTime = 0; });
    };
    if (always) µ._mjs_dom.addEventListener(el, 'animationstart', beat);
    // @@
    var light = function(on) {
      var name = 'mjs-fx-spot-on';
      if (veil) name = 'mjs-fx-veil-on'; // @@ where=veil
      flag(name, on);
    };
    // l'intérieur de la balise (le cadre des lumières, `inset: 0`), son centre, et l'étendue de l'ombre du voile : de quoi couvrir la balise de n'importe quel point
    var size = function() {
      var node = el;
      if (page) node = document.documentElement; // @@ where=veil
      wd =
        flow ? el.offsetWidth : // @@ smooth
        node.clientWidth;
      ht =
        flow ? el.offsetHeight : // @@ smooth
        node.clientHeight;
      // @@ where=veil
      cx = wd / 2;
      cy = ht / 2;
      reach();
      // la lumière qui rentre au centre en glissant vise le centre d'aujourd'hui, non celui de la sortie
      tx = inside ? tx : cx;
      ty = inside ? ty : cy;
      // @@
    };
    // l'arrondi de la balise, tel que `border-radius: inherit` le donnait au halo : le raccourci du style calculé, ses rayons horizontaux puis verticaux
    var rounding = function() {
      radii    = (getComputedStyle(el).borderRadius || '0px').split(' / ');
      radii[1] = radii[1] || radii[0];
    };
    // l'arrondi du rognage du halo, en px (un pourcentage se compte sur l'intérieur de la balise) ; rien sans arrondi
    var cut = function() {
      var r = radii.map(function(v, j) { return v.replace(/[\d.]+%/g, function(m) { return parseFloat(m) * (j ? ht : wd) / 100 + 'px'; }); });
      return /[1-9]/.test(r) ? ' round ' + r[0] + ' / ' + r[1] : '';
    };
    // l'animation d'un pseudo-élément ne survit pas à `display: none` de la balise (le pseudo-élément est défait puis refait) : une neuve à chaque entrée
    // de la souris, défaite à la sortie avec l'image que le dernier mouvement a demandée
    var renew = function() {
      cancelAnimationFrame(beam);
      beam = 0;
      if (lamp) lamp.cancel();
      lamp = null;
    };
    // la balise cachée puis montrée de nouveau (`display: none`, d'elle ou d'un ancêtre) perd l'animation de son pseudo-élément, sans un événement : sa taille change
    // deux fois, le halo est reposé là où la souris l'a laissé
    var recover = function() {
      if (!inside) return;
      renew();
      if (el.clientWidth && el.clientHeight) {
        size();
        paint();
      }
    };
    var gaze = function() {
      if (typeof ResizeObserver !== 'function') return;
      if (eye) eye.disconnect();
      var first = true;
      eye = new ResizeObserver(function() {
        if (first) first = false;
        else recover();
      });
      eye.observe(el);
    };
    // l'arrondi de la balise change par une transition (la sienne : celle d'un enfant monte jusqu'ici, ce n'est pas la même) : le rognage le suit image par image, tant que la transition dure, et la lumière avec lui ;
    // `rest` défait l'écouteur et l'image demandée avec elle. La lumière n'est pas forcément posée : toujours allumée avec un retard, elle ne l'est qu'à la première image de sa boucle, et Firefox et WebKit annoncent la transition avant cette image
    var follow = function(e) {
      if (e.target && (e.target !== el || !/radius/.test(e.propertyName))) return;
      cancelAnimationFrame(morph);
      morph = µ._mjs_dom.getAnimations(el).some(function(a) { return /radius/.test(a.transitionProperty); }) ? requestAnimationFrame(follow) : 0;
      rounding();
      paint();
    };
    // Firefox applique `:hover` après l'événement d'entrée de la souris : l'arrondi lu à l'entrée peut être celui d'avant le survol ; relu une fois à l'image qui suit, le halo n'est redessiné que s'il a changé
    var settle = function() {
      var was = radii + '';
      rounding();
      if (radii + '' !== was) paint();
    };
    // le halo posé sous la souris : le point (`translate`) et le rognage à la balise (`clip-path`, contre-déplacé), images clés d'une animation terminée ;
    // un mouvement de la souris (`soon`) demande l'image qui les écrit, une seule : la dernière position gagne
    var shine = function(x, y, soon) {
      if (soon && lamp) return void (beam = beam || requestAnimationFrame(flush));
      var f = { translate: x.toFixed(1) + 'px ' + y.toFixed(1) + 'px', clipPath: 'inset(' + (-y).toFixed(1) + 'px ' + (x - wd).toFixed(1) + 'px ' + (y - ht).toFixed(1) + 'px ' + (-x).toFixed(1) + 'px' + cut() + ')' };
      if (lamp) lamp.effect.setKeyframes([f, f]);
      else {
        lamp = µ._mjs_animate(el, [f, f], { duration: 1, fill: 'both', pseudoElement: '::after' });
        lamp.finish();
      }
    };
    // l'image demandée par les mouvements : le halo est posé là où la lumière est maintenant
    var flush = function() {
      beam = 0;
      if (lamp) shine(gx, gy);
    };
    // @@ where=veil smooth
    // la boîte de la balise : lue à l'entrée de la souris pour le voile (relue seulement après un défilement ou un redimensionnement),
    // à chaque mouvement pour le halo et le liseré
    var measure = function() {
      if (veil && box) return; // @@ where=veil
      box    = µ._mjs_fxBox(el);
      box.bl = el.clientLeft;
      box.bt = el.clientTop;
      size();
    };
    var stale = function() { box = null; }; // @@ where=veil
    // le point du pointeur dans le repère des lumières (le cadre `inset:0` de la balise) : bordure déduite, mise à l'échelle défaite
    var aim = function(e) {
      // @@ where=veil
      if (page) {
        tx = e.clientX;
        ty = e.clientY;
        wd = document.documentElement.clientWidth;
        ht = document.documentElement.clientHeight;
        cx = wd / 2;
        cy = ht / 2;
        reach();
        return;
      }
      // @@
      measure();
      tx = (e.clientX - box.l) / box.sx - box.bl;
      ty = (e.clientY - box.t) / box.sy - box.bt;
    };
    // @@
    // la seule écriture de chaque image : le `translate` du disque du voile (le décalage du centre du calque), sur ce disque ; pour le halo et le liseré, la
    // place du halo (images clés du pseudo-élément) et les deux variables du liseré (sur la balise, comme avant)
    var paint = function(soon) {
      // @@ on=always
      // la lumière est revenue au centre : le voile et le liseré perdent leur position (la feuille y met la lumière), le halo est posé au centre
      if (home) {
        // @@ where=veil
        if (veil) {
          lamps.forEach(function(layer) { layer.firstChild.style.removeProperty('translate'); });
          return;
        }
        // @@
        if (rim || flow) {
          el.style.removeProperty('--mjs-fx-spot-x');
          el.style.removeProperty('--mjs-fx-spot-y');
        }
        if (halo && !flow) renew();
        return;
      }
      // @@
      // @@ where=veil
      if (veil) {
        var at = (gx - cx).toFixed(1) + 'px ' + (gy - cy).toFixed(1) + 'px';
        lamps.forEach(function(layer) { layer.firstChild.style.setProperty('translate', at); });
        return;
      }
      // @@
      if (rim || flow) {
        el.style.setProperty('--mjs-fx-spot-x', gx.toFixed(1) + 'px');
        el.style.setProperty('--mjs-fx-spot-y', gy.toFixed(1) + 'px');
      }
      if (halo && !flow) shine(gx, gy, soon);
    };
    // @@ smooth
    // le pas du lissage : le retard de `smooth` à 60 images par seconde, le même à toute cadence ; la boucle s'arrête d'elle-même
    var tick = function(now) {
      frame = 0;
      var k = µ._mjs_fxLag(smooth, now, last);
      last  = now;
      gx   += (tx - gx) * k;
      gy   += (ty - gy) * k;
      var end = Math.abs(tx - gx) < 0.1 && Math.abs(ty - gy) < 0.1;
      if (end) {
        gx   = tx;
        gy   = ty;
        last = 0;
        // @@ on=always
        // elle est rentrée au centre : elle n'est plus promue, le dessin qui suit retire ses positions
        if (!inside) {
          rest();
          home = true;
          // elle est chez elle, la feuille la pose au centre : elle n'a plus de place à elle, la prochaine entrée repart du centre d'alors
          known = false;
        }
        // @@
      }
      paint();
      if (!end) frame = requestAnimationFrame(tick);
    };
    var stop = function() {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
      last  = 0;
    };
    // @@
    // @@ where=veil smooth
    // rien à rattraper : rien ne tourne (la boucle ne naît que d'un écart entre la lumière et la souris)
    var go = function() {
      if (smooth >= 1 || typeof requestAnimationFrame !== 'function') { // @@ smooth
        gx = tx;
        gy = ty;
        paint();
      } // @@ smooth
      // @@ smooth
      else if (gx !== tx || gy !== ty) {
        if (!frame) frame = requestAnimationFrame(tick);
      }
      else if (home) paint(); // @@ on=always
      // @@
    };
    // @@
    // @@ where=veil
    // le voile surveille son entourage pendant le survol : le halo et le liseré relisent la boîte à chaque mouvement, ils n'ont rien à surveiller
    var watch = function() {
      if (!page && veil) seeing = µ._mjs_fxWatch(el, stale);
    };
    var unwatch = function() {
      if (seeing) seeing();
      seeing = null;
    };
    // @@
    // @@ where=veil smooth
    // halo et liseré sans retard : le chemin d'avant, tel quel — la boîte relue à chaque mouvement, les mêmes écritures
    var plain = function() {
      if (veil) return false; // @@ where=veil
      if (smooth < 1) return false; // @@ smooth
      return true;
    };
    // @@
    var trace = function(e) {
      var b = µ._mjs_fxBox(el);
      wd    = el.clientWidth;
      ht    = el.clientHeight;
      cx    = wd / 2; // @@ where=veil
      cy    = ht / 2; // @@ where=veil
      // où la lumière est : un retard posé en cours de survol part de là
      gx    = (e.clientX - b.l) / b.sx - el.clientLeft;
      gy    = (e.clientY - b.t) / b.sy - el.clientTop;
      // @@ smooth
      known = true; // @@ on=always
      // @@
      paint(true);
    };
    // la lumière s'allume : un calque neuf du voile se montre en fondu (son état éteint est lu une fois avant qu'on l'allume) ; le halo prend l'arrondi de la balise
    var arrive = function() {
      clearTimeout(gone);
      gone = 0;
      // @@ where=veil
      var fresh = veil && !lamps.length;
      born();
      if (fresh) void getComputedStyle(lamps[0]).opacity;
      // @@
      if (!veil) { // @@ where=veil
        renew();
        // une balise sans taille intérieure (en ligne : un lien, un composant) n'a rien à rogner : son halo est celui d'avant, repeint, sa place écrite par deux variables
        flow = halo && !(el.clientWidth && el.clientHeight);
        if (halo && !flow) {
          rounding();
          gaze();
          µ._mjs_dom.addEventListener(el, 'transitionrun', follow);
          morph = requestAnimationFrame(settle);
        }
      } // @@ where=veil
      if (!flow) flag('mjs-fx-live', true);
    };
    var enter = function(e) {
      if (plain()) { // @@ where=veil smooth
        inside = true;
        home   = false; // @@ on=always
        arrive();
        light(true);
        return trace(e);
      } // @@ where=veil smooth
      // @@ where=veil smooth
      inside = true;
      home   = false; // @@ on=always
      box    = null;
      arrive();
      watch(); // @@ where=veil
      light(true);
      aim(e);
      // @@ smooth
      // survol : la lumière naît sous la souris, posée tout de suite à sa place (elle n'attend pas la première image de la boucle)
      // @@ on=always
      if (always) {
        // toujours allumée : elle part de là où elle est (le centre d'aujourd'hui, la première fois et quand elle est rentrée au repos)
        if (smooth < 1 && !known) {
          gx = wd / 2;
          gy = ht / 2;
          paint();
        }
        known = true;
        go();
        return;
      }
      // @@
      if (smooth < 1) {
        gx = tx;
        gy = ty;
        paint();
      }
      // @@
      go();
      // @@
    };
    var move = trace;
    // @@ where=veil smooth
    move = function(e) {
      if (plain()) return trace(e);
      if (!inside) return enter(e);
      aim(e);
      go();
    };
    // @@
    var leave = function() {
      if (plain()) { // @@ where=veil smooth
        stop(); // @@ smooth
        inside = false;
        // @@ on=always
        if (always) {
          known = false; // @@ smooth
          rest();
          home = true;
          paint();
          return;
        }
        // @@
        light(false);
        fade();
        return; // @@ where=veil smooth
      } // @@ where=veil smooth
      // @@ where=veil smooth
      if (!inside) return;
      inside = false;
      unwatch(); // @@ where=veil
      box = null;
      // @@ on=always
      if (always) {
        // elle rentre au centre : en glissant s'il y a un retard (allumée et promue jusqu'à son arrivée, voir `tick`), d'un coup sinon
        tx   = wd / 2;
        ty   = ht / 2;
        home = true;
        // @@ smooth
        // rentrée d'un coup, la lumière n'a plus de place à elle : la prochaine entrée repart du centre d'alors (la taille a pu changer entre-temps)
        if (smooth < 1 && typeof requestAnimationFrame === 'function' && (gx !== tx || gy !== ty)) home = false;
        else known = false;
        // @@
        if (home) rest();
        go();
        return;
      }
      // @@
      if (veil) rest(); // @@ where=veil
      stop(); // @@ smooth
      light(false);
      fade();
      // @@
    };
    // @@ origin
    // la lumière tenue en un point (`origin`) : le halo et le liseré du repos, posés là, allumés d'office ou le temps du survol ; le voile suit toujours la souris
    var spot = s.where !== 'veil' && µ._mjs_fxPoint(s.origin, null);
    if (spot) {
      el.style.setProperty('--mjs-fx-spot-x', spot.x * 100 + '%');
      el.style.setProperty('--mjs-fx-spot-y', spot.y * 100 + '%');
      var lit = function() { light(true); };
      var dim = function() { light(false); };
      if (s.on !== 'always') {
        µ._mjs_dom.addEventListener(el, 'pointerenter', lit);
        µ._mjs_dom.addEventListener(el, 'pointerleave', dim);
      }
      else lit();
      var back = function() {
        µ._mjs_dom.removeEventListener(el, 'pointerenter', lit);
        µ._mjs_dom.removeEventListener(el, 'pointerleave', dim);
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-spot-on');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-spot-where');
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-spot-every'); // @@ every
        µ._mjs_dom.removeEventListener(el, 'animationstart', beat); // @@ on=always
        el.style.removeProperty('--mjs-fx-spot-x');
        el.style.removeProperty('--mjs-fx-spot-y');
        restore();
      };
      // @@ every=*
      // l'éclat tenu par une variable suit sur place ; tout autre réglage de comportement relance l'effet
      back.set = function(k, v) {
        if (k !== 'every') return false;
        µ._mjs_dom[v ? 'setAttribute' : 'removeAttribute'](el, 'mjs-fx-spot-every', '');
      };
      // @@
      return back;
    }
    // @@
    // le voile écoute en passif ; le halo et le liseré, comme avant, sans options
    var opts;
    if (veil) opts = { passive: true }; // @@ where=veil
    µ._mjs_dom.addEventListener(el, 'pointerenter', enter, opts);
    µ._mjs_dom.addEventListener(el, 'pointermove', move, opts);
    µ._mjs_dom.addEventListener(el, 'pointerleave', leave, opts);
    // toujours allumé : la balise s'allume d'office (le halo et le liseré d'avant) ; le calque du voile est là dès la pose, et son ombre suit la taille de la balise
    // @@ on=always
    if (always) {
      born(); // @@ where=veil
      light(true);
      // @@ where=veil
      if (veil) {
        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(size);
          ro.observe(page ? document.documentElement : el);
        }
        else size();
      }
      // @@
    }
    // @@
    var off = function() {
      µ._mjs_dom.removeEventListener(el, 'pointerenter', enter);
      µ._mjs_dom.removeEventListener(el, 'pointermove', move);
      µ._mjs_dom.removeEventListener(el, 'pointerleave', leave);
      unwatch(); // @@ where=veil
      stop(); // @@ smooth
      clearTimeout(gone);
      drop(); // @@ where=veil
      // @@ where=veil
      if (ro) ro.disconnect(); // @@ on=always
      // @@
      rest();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-spot-on');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-spot-where');
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-spot-every'); // @@ every
      µ._mjs_dom.removeEventListener(el, 'animationstart', beat); // @@ on=always
      el.style.removeProperty('--mjs-fx-spot-x');
      el.style.removeProperty('--mjs-fx-spot-y');
      restore();
    };
    // le retard, l'arrondi et l'éclat tenus par une variable : suivis sur place (le retard ramené entre 0.01 et 1 ; l'arrondi du halo relu, le halo redessiné à l'image qui suit et non dans le gestionnaire de l'application ;
    // la marque de l'éclat posée ou retirée) ; les réglages visuels sont lus par la feuille, `where` et `on` relancent l'effet. Sans retard, arrondi ni éclat tenus par une variable, le cœur n'a
    // rien à demander : `set` n'existe pas (le cœur relance l'effet pour `where` et `on`, et suit lui-même les variables de la feuille)
    // @@ smooth=* radius=* every=*
    off.set = function(k, v) {
      // @@ every=*
      if (k === 'every') {
        µ._mjs_dom[v ? 'setAttribute' : 'removeAttribute'](el, 'mjs-fx-spot-every', '');
        return true;
      }
      // @@
      // @@ smooth=*
      if (k === 'smooth') {
        smooth = µ._mjs_fxCalm() ? 1 : µ._mjs_fxLagSetting(v, 1);
        return true;
      }
      // @@
      // @@ radius=*
      if (k === 'radius' && halo) {
        rounding();
        if (inside) paint(true);
        return true;
      }
      // @@
      if (k === 'soft') return true; // @@ where=veil
      return k === 'color' || k === 'size' || k === 'fill' || k === 'width' || k === 'radius';
    };
    // @@
    return off;
  }
};
