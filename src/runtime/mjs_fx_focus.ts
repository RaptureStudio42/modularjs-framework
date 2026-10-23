// mjs_fx_focus — `*focus` : la mise au point sur un groupe. Posé sur le PARENT, il agit sur ses enfants
// directs : quand on en survole un (ou qu'il a le focus clavier), tous les autres se floutent ou
// s'estompent, et lui seul reste net, plus grand si on le demande ; quand la souris quitte le groupe,
// tout redevient net. Une rangée de cartes, un menu de liens, une grille de vignettes.
// Tout tient dans la feuille (« le parent est survolé, cet enfant ne l'est pas ») : aucun écouteur,
// aucune minuterie. Le `setup` fait trois choses : poser une marque sur le parent quand grow n'est pas 1
// (voir plus bas), prévenir quand l'effet est posé sur un composant sans enfant glissé, et garder la
// transition propre de chaque enfant (celle de l'auteur, celle d'un effet posé sur lui, comme *lift),
// à laquelle s'ajoute celle de l'effet (µ._mjs_fxTransition) — relevée à la pose, puis pour chaque
// enfant ajouté ensuite (un observateur des seuls enfants directs), rendue au retrait. Seuls
// `filter`, `opacity` et `scale` sont animés (le compositeur les anime sans mise en page ni peinture)
// et `will-change` n'est posé que sur les AUTRES enfants, pendant le survol du parent. Dans l'espace
// entre deux enfants, le groupe reste mis au point (les autres restent flous : pas de va-et-vient en
// traversant l'écart). Les calques posés par d'autres effets (`mjs-fx-layer`) ne sont pas des enfants.
// L'enfant mis au point ne reçoit RIEN tant que grow vaut 1 (le défaut) : ni `scale`, ni `z-index`, ni
// `will-change`, car un `scale` calculé à 1 (comme un `filter` ou un `will-change: filter`) ferait de
// lui le bloc conteneur de ses descendants en position absolue ou fixe, qui sauteraient au survol. Avec
// grow différent de 1, `scale: grow` et `z-index: 1` valent sous la marque `mjs-fx-focus-grow` que le
// `setup` pose sur le parent (retirée avec l'effet, suivie sur place si grow est tenu par une
// variable) : l'enfant passe alors au-dessus de ses voisins (effectif dans une grille, un flex, ou pour
// un enfant positionné) ; quand la souris le quitte, il garde ce z-index le temps de rétrécir (une
// transition discrète, retardée de duration ; un navigateur sans `transition-behavior` le rend tout de
// suite). C'est le prix de l'agrandissement : un élément mis à l'échelle forme un
// contexte d'empilement, donc le menu déroulant qu'il contient (position: absolute, z-index: 10) reste
// dans ce contexte, de niveau 1, et passe sous une barre fixe de z-index 5 pendant le survol.
// Les AUTRES enfants, eux, ont un `filter` pendant la mise au point (même à blur: 0, un filtre neutre
// compte) : ils deviennent le bloc conteneur et le contexte d'empilement de leurs descendants en
// position absolue ou fixe (un badge ancré sur le groupe saute dans le coin de son enfant flou) — c'est
// inhérent au flou.
// Deux `*focus` imbriqués : l'intérieur repart des défauts pour ce qu'il n'écrit pas (ses enfants
// remettent à leur valeur initiale les variables que sa balise n'écrit pas) ; ce qu'il écrit vaut pour
// ses enfants, et aussi pour lui-même quand il est l'un des autres enfants de l'extérieur.
// Limites de la feuille seule : `scale` et `grow` n'agissent pas sur un enfant en ligne (`<a>`,
// `<span>` : le mettre en `inline-block`, en grille ou en flex) ; le focus clavier d'un enfant qui est
// un composant (son focus est dans son shadow root) ne se voit pas d'ici, seul le survol agit ; sur un
// composant dont les enfants vivent dans son gabarit (et non reçus par un slot), la feuille de la page
// n'atteint pas ces enfants : l'effet n'agit pas, et un avertissement le dit — posez `*focus` dans le
// gabarit du composant, sur le parent de ses enfants.
// Écran tactile : le survol n'agit que sur un appareil qui sait survoler (pas d'état collé après un
// appui) ; « réduire les animations » : le changement est immédiat, sans transition ni `will-change`.
// Réglages : blur (le flou des autres enfants, en px ; 8), opacity (leur opacité ; 1), grayscale (leur
// passage en noir et blanc, de 0 à 1 ; 0), scale (leur taille ; 1, 0.96 les fait reculer), grow (la
// taille de l'enfant survolé ; 1), duration (500ms), easing (ease).

// l'enfant mis au point autrement que par le survol : celui qui a le focus visible, ou qui en contient
// un (`:has` dans un `:is`, forme tolérante : un navigateur sans `:has` garde le reste de la règle)
var _mjsFxFocusAt = ':focus-visible,:is(:focus-within:has(:focus-visible))';

// l'allure des autres enfants, celle de l'enfant mis au point (seulement sous la marque de grow du
// parent), et le CSS entier
var _mjsFxFocusLook = 'filter:blur(var(--mjs-focus-blur,8px)) grayscale(var(--mjs-focus-grayscale,0));opacity:var(--mjs-focus-opacity,1);scale:var(--mjs-focus-scale,1)';
var _mjsFxFocusUp   = 'scale:var(--mjs-focus-grow,1);z-index:1;--mjs-fx-focus-z:0s';

var _mjsFxFocusCss = function() {
  var p      = '[mjs-fx~="focus"]';
  var grows  = p + '[mjs-fx-focus-grow]';
  var kids   = p + ' > [mjs-fx-tr]:not([mjs-fx-layer])';
  var others = ' > :not([mjs-fx-layer],:hover,' + _mjsFxFocusAt + ')';
  var drift  = '{will-change:filter,opacity}';
  // au repos : les enfants n'ont que leur transition, rien d'autre ne les distingue — la leur, puis celle
  // de l'effet (le `setup` l'écrit, par les relais --mjs-fx-focus-d et -e : le style d'un enfant ne cite
  // jamais un réglage, que la remise à zéro d'un *focus intérieur lit dans son attribut) ; sous la marque
  // de grow, le z-index de l'enfant qui rétrécit se garde
  var css    = kids + '{--mjs-fx-focus-d:var(--mjs-focus-duration,500ms);--mjs-fx-focus-e:var(--mjs-focus-easing,ease);transition:var(--mjs-fx-tr)}'
    + grows + ' > [mjs-fx-tr]:not([mjs-fx-layer]){transition-behavior:allow-discrete}'
    // le parent survolé (appareil à survol) : les autres se défont, le survolé ou celui qui a le focus grandit
    + '@media (hover:hover){'
    + p + ':hover' + others + '{' + _mjsFxFocusLook + '}'
    + grows + ':hover > :is(:hover,' + _mjsFxFocusAt + '):not([mjs-fx-layer]){' + _mjsFxFocusUp + '}'
    + '}'
    // le focus visible dans le parent (clavier), sans survol
    + p + ':has(:focus-visible)' + others + '{' + _mjsFxFocusLook + '}'
    + grows + ':has(:focus-visible) > :is(' + _mjsFxFocusAt + '):not([mjs-fx-layer]){' + _mjsFxFocusUp + '}'
    // les autres enfants ne sont promus que pendant que le groupe est mis au point (l'enfant mis au point
    // ne l'est pas : un will-change: filter en ferait le bloc conteneur de ses descendants absolus)
    + '@media (hover:hover) and (prefers-reduced-motion:no-preference){' + p + ':hover' + others + drift + '}'
    + '@media (prefers-reduced-motion:no-preference){' + p + ':has(:focus-visible)' + others + drift + '}'
    + '@media (prefers-reduced-motion:reduce){' + kids + '{transition:none}}';
  // un *focus dans un autre : les variables CSS passent de parent en enfant, donc l'intérieur recevrait
  // les réglages de l'extérieur pour tout ce qu'il n'écrit pas. Ses ENFANTS repartent des défauts pour
  // chaque réglage absent de sa propre balise (le moteur l'écrit dans son `style`, d'où le sélecteur) ;
  // lui-même garde ce qu'il reçoit, car il est aussi un enfant de l'extérieur et en prend l'allure.
  // grow n'a pas de règle : il ne vaut que sous la marque du parent lui-même, donc jamais hérité
  ['blur', 'opacity', 'grayscale', 'scale', 'duration', 'easing'].forEach(function(k) {
    css += p + ' ' + p + ':not([style*="--mjs-focus-' + k + '"]) > *{--mjs-focus-' + k + ':initial}';
  });
  return css;
};

µ._mjs_fxDefs.focus = {
  css: _mjsFxFocusCss(),
  vars: { blur: 'px', opacity: '', grayscale: '', scale: '', grow: '', duration: '', easing: '' },
  // la seule chose que la feuille ne sait pas lire : si grow vaut 1 (le défaut) ou autre chose. Un
  // `scale` calculé à 1 ferait de l'enfant mis au point le bloc conteneur de ses descendants en
  // position absolue : le parent porte donc une marque quand grow n'est pas 1, et l'enfant mis au point
  // ne reçoit son scale et son z-index que sous cette marque
  setup: function(el, s) {
    // un composant qui n'a reçu aucun enfant (pas même le repère d'un bloc {for} ou {if}) garde les siens dans son
    // gabarit, que la feuille de la page n'atteint pas : l'effet ne ferait rien, sans le dire
    if (el._shadow && !el.firstChild) µ.warn(µ._mjs_msg('focusHost', { tag: el.localName }, '*focus : le composant <{tag}> n\'a aucun enfant glissé — ses enfants vivent dans son gabarit, où *focus ne les atteint pas. Posez *focus dans le gabarit du composant, sur le parent de ses enfants.'), el);
    var up   = function(g) { return g !== void 0 && g !== null && Number(g) !== 1; };
    var mark = function(g) {
      if (up(g)) µ._mjs_dom.setAttribute(el, 'mjs-fx-focus-grow', '');
      else µ._mjs_dom.removeAttribute(el, 'mjs-fx-focus-grow');
    };
    var grow = s.grow;
    mark(grow);
    // la transition de l'effet, ajoutée à celle de chaque enfant ; avec grow, le z-index de l'enfant qui
    // rétrécit tient le temps du retour (sans délai à l'aller : `--mjs-fx-focus-z` de l'enfant mis au point)
    var d     = 'var(--mjs-fx-focus-d) var(--mjs-fx-focus-e)';
    var items = function() { return 'filter ' + d + ',opacity ' + d + ',scale ' + d + (up(grow) ? ',z-index 0s var(--mjs-fx-focus-z,var(--mjs-fx-focus-d))' : ''); };
    var kids  = new Map();
    var take  = function(c) {
      if (c.nodeType === 1 && c.parentNode === el && !µ._mjs_dom.hasAttribute(c, 'mjs-fx-layer')) kids.set(c, µ._mjs_fxTransition(c, 'focus', items()));
    };
    for (var i = 0; i < el.children.length; i++) take(el.children[i]);
    var mo = typeof MutationObserver === 'function' ? new MutationObserver(function(list) {
      list.forEach(function(m) {
        m.removedNodes.forEach(function(c) {
          if (!kids.has(c) || c.parentNode === el) return;
          kids.get(c)();
          kids.delete(c);
        });
        m.addedNodes.forEach(function(c) { if (!kids.has(c)) take(c); });
      });
    }) : null;
    if (mo) mo.observe(el, { childList: true });
    var off = function() {
      if (mo) mo.disconnect();
      kids.forEach(function(back) { back(); });
      kids.clear();
      µ._mjs_dom.removeAttribute(el, 'mjs-fx-focus-grow');
    };
    // un réglage tenu par une variable : la marque et la transition des enfants suivent sur place, sans reposer l'effet
    off.set = function(k, v) {
      if (k !== 'grow') return;
      grow = v;
      mark(v);
      kids.forEach(function(_, c) { take(c); });
    };
    return off;
  }
};
