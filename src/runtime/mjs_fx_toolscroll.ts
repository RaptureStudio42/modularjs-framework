// mjs_fx_toolscroll — l'avancée (0 → 1) d'une balise au défilement : la page, le conteneur qui défile autour d'elle, les shadow roots
//   var off = µ._mjs_fxScroll(el, f, zone);
//   f(p)      appelée dans l'image d'animation qui suit un défilement ou un redimensionnement, avec l'avancée `p` de la balise dans la zone
//             visible (µ._mjs_fxAdvance du moteur : sans bande, 0 quand son haut touche le bas de la zone et 1 quand son milieu en atteint
//             le milieu ; avec `zone` ('70% 40%', µ._mjs_fxZone du moteur), 0 à la première hauteur et 1 à la seconde) ; une balise
//             collante se lit sur sa section (µ._mjs_fxStuck du moteur)
//   off()     rend les écouteurs et annule l'image demandée
// embarqué seulement avec un effet qui s'en sert (bundler/fx-tools.ts), avec les outils fx_toolup (µ._mjs_fxParent, µ._mjs_fxWithin) et
// fx_toolroots (µ._mjs_fxRoots) ; µ._mjs_fxZone, µ._mjs_fxAdvance et µ._mjs_fxStuck restent au moteur (*travel et les transitions au
// défilement lisent les deux premiers)

// l'avancée de la balise dans la zone visible (cf. µ._mjs_fxAdvance, `zone` : la bande écrite),
// suivie au défilement (la page, et le conteneur qui défile autour d'elle) ; `f(p)` à chaque image
// qui bouge. Une balise collante (elle, ou un parent entre elle et le conteneur) se lit sur la
// section qui la porte (cf. µ._mjs_fxStuck ; `zone` n'y compte pas). Les lectures de mise en page se
// font dans l'événement de défilement, qui précède les images d'animation : le style est encore
// propre, et personne n'a écrit avant elles (lues dans une image d'animation, derrière l'écriture d'un
// effet, elles forceraient un recalcul de style à chaque image) ; `f` est appelé dans l'image
// d'animation qui suit. Conteneur et balise collante sont cherchés au début de chaque geste (aucune
// lecture depuis 100 ms), pas à chaque image : chaque ancêtre coûte un
// style calculé et deux lectures de mise en page. Pas une fois pour toutes : posé avant d'avoir sa
// taille (sa feuille pas encore là), le conteneur ne défile pas encore : un élément qui défile,
// ancêtre de la balise et pas le conteneur connu, fait donc chercher de nouveau (un geste enchaîné ne
// laisse jamais 100 ms), une seule fois par élément (`seen` : des ancêtres qui ne défilent qu'en largeur,
// même imbriqués et chacun leur tour, ne font pas chercher à chaque événement), comme un redimensionnement.
// Limite : une balise qui devient collante au milieu d'un geste continu n'est vue qu'à la pause suivante
// (aucun événement ne le dit, et la chercher à chaque événement coûterait un style calculé par événement).
// Un défilement ne sort jamais d'un shadow root : on l'écoute en capture sur chaque racine entre la balise
// et la page. Rend la fonction d'arrêt
µ._mjs_fxScroll = function(el, f, zone) {
  var z     = µ._mjs_fxZone(zone);
  var roots = µ._mjs_fxRoots(el);
  var up    = µ._mjs_fxParent;
  var raf   = 0;
  var q     = null;
  var st    = null;
  var at    = -1e9;
  var p     = null;
  var seen  = [];
  var read = function() {
    var now = Date.now();
    // le conteneur qui défile autour de la balise, et la première balise collante en chemin
    if (now - at > 100) {
      q  = null;
      st = null;
      if (typeof getComputedStyle === 'function') {
        for (var n = el; n && n.nodeType === 1; n = up(n)) {
          var cs = getComputedStyle(n);
          if (!st && cs.position === 'sticky') st = n;
          if (n !== el && /(auto|scroll)/.test(cs.overflowY || '') && n.scrollHeight > n.clientHeight) {
            q = n;
            break;
          }
        }
      }
    }
    at = now;
    var box = q ? µ._mjs_dom.getBoundingClientRect(q) : { top: 0, height: window.innerHeight || 1 };
    var sec = st && st !== q ? up(st) : null;
    var v   = sec && sec.nodeType === 1 ? µ._mjs_fxStuck(µ._mjs_dom.getBoundingClientRect(sec), box) : null;
    if (v === null) v = µ._mjs_fxAdvance(µ._mjs_dom.getBoundingClientRect(el), box, z);
    p = Math.round(v * 1000) / 1000;
  };
  var emit = function() {
    raf = 0;
    if (p === null) read();
    f(p);
  };
  var ask = function(e) {
    var t     = e.target;
    var again = e.type === 'resize' || (t.nodeType === 1 && t !== q && seen.indexOf(t) < 0 && µ._mjs_fxWithin(t, el));
    if (again) {
      at = -1e9;
      if (t.nodeType === 1) seen.push(t);
    }
    if (raf && !again) return;
    read();
    if (!raf) raf = requestAnimationFrame(emit);
  };
  for (var i = 0; i < roots.length; i++) µ._mjs_dom.addEventListener(roots[i], 'scroll', ask, { capture: true, passive: true });
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', ask);
  // la première lecture attend l'image d'animation (la page se monte encore) ; les suivantes, l'événement de défilement
  raf = requestAnimationFrame(emit);
  return function() {
    if (raf) cancelAnimationFrame(raf);
    for (var j = 0; j < roots.length; j++) µ._mjs_dom.removeEventListener(roots[j], 'scroll', ask, { capture: true });
    window.removeEventListener('scroll', ask);
    window.removeEventListener('resize', ask);
  };
};
