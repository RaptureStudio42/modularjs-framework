// animations/typewriter.ts — le texte de la balise s'écrit lettre après lettre, et s'efface de même à la sortie
// animation à « tick » : elle n'écrit aucun style, la transition appelle tick(t) à chaque image, t allant de l'état courant vers 1 (entrée)
// ou 0 (sortie) ; interrompue puis relancée, elle repart du t où elle en était, pas de zéro — c'est pourquoi l'entrée et la sortie sont la
// même fonction, marquée _isCfgFactory : la transition l'appelle, abandonne l'animation en cours et garde la continuité
// la balise ne porte qu'un nœud texte à contenu : les blancs d'indentation voisins sont tolérés et jamais touchés, mais un sous-élément
// (<b>) ou plusieurs textes à contenu (« Bonjour {$nom} » : l'interpolation est un nœud à part, que sa liaison réécrit à chaque
// changement) sont refusés par une erreur, le tick ne sait pas les restituer
// le texte d'origine est gardé sur la balise (_mjs_text_cache, blancs de début et de fin compris : une mise en page peut en dépendre) pour
// que la sortie sache quoi effacer après que l'entrée a tronqué le nœud ; gardé une fois, sauf si la liaison du texte l'a réécrit depuis la
// dernière écriture du tick (_mjs_text_last) : le texte du nœud est alors le texte courant
// reread : qui pose l'effet (on: view rejoué, on: hover) refait ce réglage à chaque entrée qui part du repos, pour qu'elle relise le texte
// options : speed (30 ms par caractère), duration (le nombre de caractères × speed), delay (0), easing (linear)
(function(opts = {}) {
  var speed = opts.speed ?? 30;
  var setup = function(node) {
    var kids  = Array.from(node.childNodes);
    var texts = kids.filter(function(c) { return c.nodeType === 3; });
    var real  = texts.filter(function(c) { return c.textContent.trim() !== ''; });
    var text, full;
    if (kids.some(function(c) { return c.nodeType === 1; }) || texts.length === 0 || real.length > 1) throw new Error(µ._mjs_txt('typewriterOneText', null, '*typewriter exige un unique nœud texte'));
    text = real[0] || texts[0];
    if (node._mjs_text_cache == null || (node._mjs_text_last != null && text.textContent !== node._mjs_text_last)) node._mjs_text_cache = text.textContent;
    full = node._mjs_text_cache;
    return {
      duration: opts.duration ?? full.length * speed,
      reread: true,
      delay: opts.delay ?? 0,
      easing: opts.easing || 'linear',
      // le nombre de caractères visibles, borné : la transition peut passer un t hors de [0, 1] une image (slice d'un négatif couperait depuis la fin)
      tick: function(t) {
        var charsCount = Math.max(0, Math.min(full.length, Math.round(full.length * t)));
        node._mjs_text_last = full.slice(0, charsCount);
        return text.textContent = node._mjs_text_last;
      }
    };
  };
  setup._isCfgFactory = true;
  return {
    intro: setup,
    outro: setup
  };
});
