// mjs_play — rune µplay (joue une classe d'animation sur un nœud, résolue à la fin), détachée de
// mjs_rare_runes.ts : fichier détecté (clé 'play'), embarqué seulement si le projet écrit µplay

// Délai de repli quand la durée de l'animation ne se lit pas (pas de getComputedStyle) ou qu'elle est sans
// fin — même ordre de grandeur que le filet de la destruction groupée (mjs_destroy_hooks.ts, "Transition
// exceeds 2000ms"), même risque : un `animationend`/`animationcancel` qui ne part jamais laisserait la
// promesse pendante pour toujours (cf. µ._mjs_vtCurtainRun, mjs_vt_presets.ts, même doctrine « filet
// setTimeout plutôt que dépendance totale à un event qui peut ne jamais partir »).
var MJS_PLAY_FALLBACK_MS = 2000;

// durée (ms) des animations CSS posées sur le nœud : la plus longue de délai + durée × répétitions (les
// listes plus courtes que `animation-name` se répètent, comme en CSS), Infinity pour une animation sans
// fin, 0 sans animation (classe sans keyframe, `animation: none` du mouvement réduit)
var _mjsPlayMs = function(cs) {
  var l = function(p) { return String(cs[p] || '').split(','); };
  var noms = l('animationName'), durs = l('animationDuration'), dels = l('animationDelay'), reps = l('animationIterationCount');
  var ms = function(t) { return parseFloat(t) * (/ms\s*$/.test(t) ? 1 : 1000) || 0; };
  var max = 0, i, n;
  for (i = 0; i < noms.length; i++) {
    if (!noms[i].trim() || noms[i].trim() === 'none') continue;
    n = reps[i % reps.length].trim();
    max = Math.max(max, ms(dels[i % dels.length]) + (ms(durs[i % durs.length]) * (n === 'infinite' ? Infinity : parseFloat(n)) || 0));
  }
  return max;
};

µ.play = function(node, animationClass) {
  return new Promise(function(resolve) {
    var cleanup, fallbackId, t, avant, lancees, fini;
    if (!(node && animationClass)) {
      return resolve();
    }
    // une seule fois : une fin d'animation après le filet (ou l'inverse) ne retire pas la classe d'un µplay suivant
    cleanup = function(e) {
      if ((e && e.target !== node) || fini) {
        return;
      }
      fini = true;
      clearTimeout(fallbackId);
      node.classList.remove(animationClass);
      node.removeEventListener('animationend', cleanup);
      node.removeEventListener('animationcancel', cleanup);
      return resolve();
    };
    node.classList.remove(animationClass);
    void node.offsetWidth;
    // animations déjà en cours dans le nœud et ses enfants (un indicateur qui tourne sans fin) : pas celles de la classe
    avant = node.getAnimations ? node.getAnimations({ subtree: true }) : null;
    node.classList.add(animationClass);
    // la promesse suit la vraie fin de l'animation : le filet n'arrive qu'après sa durée (délai et
    // répétitions compris, plus une marge), jamais en pleine animation ; rien à jouer (classe sans
    // keyframe, mouvement réduit) : la main est rendue tout de suite
    if (avant) {
      // les animations que la classe lance, sur le nœud, ses pseudo-éléments (`.classe::after`) et ses enfants
      // (`.classe .icone`), mesurées par le navigateur : la promesse attend la fin de toutes
      lancees = node.getAnimations({ subtree: true }).filter(function(a) { return a.animationName && avant.indexOf(a) < 0; });
      t = 0;
      lancees.forEach(function(a) { t = Math.max(t, a.effect ? a.effect.getComputedTiming().endTime : 0); });
      if (t > 0 && t < Infinity) Promise.all(lancees.map(function(a) { return a.finished; })).then(function() { cleanup(); }, function() { cleanup(); });
    }
    else {
      // sans `getAnimations` : la fin de l'animation du nœud (ou de son pseudo-élément), durée lue sur le nœud
      node.addEventListener('animationend', cleanup);
      node.addEventListener('animationcancel', cleanup);
      t = typeof getComputedStyle === 'function' ? _mjsPlayMs(getComputedStyle(node)) : Infinity;
    }
    if (!(t > 0)) return cleanup();
    fallbackId = setTimeout(cleanup, t === Infinity ? MJS_PLAY_FALLBACK_MS : t + 100);
  });
};
