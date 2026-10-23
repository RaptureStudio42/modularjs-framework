// mjs_fx_toolkeep — le décor d'un effet revient quand un script réécrit le contenu de la balise : `textContent =`, `innerHTML =`, `replaceChildren(…)`,
// `innerHTML +=` emportent avec le texte les calques que l'effet avait posés dans la balise, et l'effet restait sans décor (la toile de *scratch* partait et le
// secret se dévoilait, le texte de *spoiler* restait transparent sans rien devant, les barres de *skeleton* disparaissaient)
//   var stop = µ._mjs_fxKeep(def, el, name, s, comp);
//   def, el, name, s, comp   la définition de l'effet, sa balise, son nom, ses réglages, le composant qui le pose ; rend l'arrêt de l'effet (celui de def.setup, `set` compris)
// appelée par le moteur (mjs_fx.ts) à la place de def.setup ; un effet qui ne déclare pas `decor: true` dans sa définition passe tel quel
// un effet à décor déclare `decor: true` ; ses calques sont des enfants de la balise marqués `mjs-fx-layer="<nom>"`, ou `"<nom>-…"` (behind-bg, crt-tint)
// la reprise : un observateur des enfants de la balise (la balise seule, pas son sous-arbre) ; quand un lot de changements retire un calque de l'effet pour de bon et touche aussi
// autre chose que ses calques (le texte, des balises du script : une écriture de script), le moteur défait l'effet puis le repose avec ses réglages, au plus une fois par lot
// (dix écritures dans la même tâche, une seule pose) ; l'effet qui retire lui-même un de ses calques (un bandeau qui s'en va) ne touche que ses calques : rien ne repart ;
// un calque posé puis retiré dans le même lot (une sonde de mesure) n'était pas là avant : il ne compte pas
// le décor perdu reste dû : un lot qui ne retire que des calques et les emporte tous (`innerHTML = ''` sur une balise qui n'avait que le décor) ne dit pas si c'est le script ou l'effet,
// il n'est pas reposé tout de suite ; la première écriture qui suit, même si elle ne retire rien (`append`), repose l'effet, quel que soit le temps écoulé (un effet qui n'ôte qu'une
// partie de ses calques, la teinte de *crt*, ne doit rien : il lui en reste) ; il arrive qu'une repose soit due sans écriture qui suive : le décor manque jusque-là
// les copies figées de calques qu'une relecture du HTML laisse (`innerHTML +=`) partent avant chaque pose ; une balise qui n'a rien posé n'a rien à reposer
// garde : au plus 20 reprises par tâche et par balise (un script qui réécrit à chaque changement des enfants tourne de rappel en rappel sans quitter la tâche : à la vingt et unième,
// la repose est refusée et reste due) ; la coupure n'est jamais définitive : le compte repart de zéro à la tâche suivante, annoncée par un message à soi-même (MessageChannel), que le
// bridage des minuteries d'un onglet caché ne retarde pas, et la prochaine écriture après une pause repose l'effet ; des écritures dans des tâches distinctes ne sont donc jamais coupées
// conséquence d'une boucle sans fin : le décor manque (le texte de *spoiler* reste transparent sans rien devant) jusqu'à la prochaine écriture après une pause, jamais une page figée
// rien ne tourne au repos : l'observateur n'est rappelé qu'à une écriture, il est débranché au retrait de l'effet
// embarquée seulement avec un effet à décor (bundler/fx-tools.ts)

µ._mjs_fxKeep = function(def, el, name, s, comp) {
  if (!def.decor || typeof MutationObserver !== 'function' || typeof MessageChannel !== 'function') return def.setup(el, s, comp);
  var mine = function(n) {
    var v = n.nodeType === 1 && µ._mjs_dom.getAttribute(n, 'mjs-fx-layer');
    return !!v && (v === name || v.indexOf(name + '-') === 0);
  };
  var kept = function() {
    for (var c = el.firstChild; c; c = c.nextSibling) if (mine(c)) return true;
    return false;
  };
  for (var c = el.firstChild, next; c; c = next) {
    next = c.nextSibling;
    if (mine(c)) µ._mjs_dom.remove(c);
  }
  var stop = def.setup(el, s, comp);
  var owed = false;
  var again = function() {
    var off = el._mjs_fxOff && el._mjs_fxOff[name];
    if (!off) return true;
    if (!el._mjs_fxKeepN) {
      el._mjs_fxKeepN = 0;
      var tick = new MessageChannel();
      tick.port1.onmessage = function() {
        tick.port1.close();
        el._mjs_fxKeepN = null;
      };
      tick.port2.postMessage(0);
    }
    if (++el._mjs_fxKeepN > 20) return false;
    // la relance du moteur : l'effet reprend sa place parmi ceux de la balise
    µ._mjs_fxRestart(el, name, off, off._s);
    return true;
  };
  var mo = new MutationObserver(function(list) {
    var lost  = false;
    var other = false;
    var born  = [];
    for (var i = 0; i < list.length; i++) {
      var gone  = list[i].removedNodes;
      var added = list[i].addedNodes;
      for (var j = 0; j < gone.length; j++) {
        if (!mine(gone[j])) other = true;
        else if (gone[j].parentNode !== el && born.indexOf(gone[j]) < 0) lost = true;
      }
      for (j = 0; j < added.length; j++) {
        if (mine(added[j])) born.push(added[j]);
        else other = true;
      }
    }
    if ((lost || owed) && other) {
      if (!again()) owed = true;
    }
    else if (kept()) owed = false;
    else if (lost) owed = true;
  });
  mo.observe(el, { childList: true });
  var end = function() {
    mo.disconnect();
    if (typeof stop === 'function') stop();
  };
  if (stop && typeof stop.set === 'function') end.set = stop.set;
  return end;
};
