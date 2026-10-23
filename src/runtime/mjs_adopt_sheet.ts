// mjs_adopt_sheet — `µ.adoptSheet(el, feuille)` : colle une feuille de style dans l'ombre d'un composant pendant que
// la page tourne, détaché de mjs_element.ts : fichier détecté (clé 'adopt_sheet'), embarqué seulement si le projet
// écrit `adoptSheet`. Un nom fabriqué à l'exécution (`µ['adopt' + 'Sheet']`), que la construction ne voit pas, se demande
// par `runtime: ['adopt_sheet']`.

// l'avertissement d'une balise sans ombre ne se dit qu'une fois par NOM de balise : cent composants réglés `mjs-light` qui
// appellent l'outil, ou un µeffect qui le rappelle à chaque tour, n'en font pas une rafale
var _mjsAdoptWarned = new Set();

// une balise sans ombre (composant réglé `mjs-light`, ou balise qui n'est pas un composant ModularJS) : la console dit que la
// feuille n'est pas collée et quoi écrire à la place, comme tout avertissement du framework (niveau de console, texte par
// langue : voir `µ._mjs_msg`). Rien à dire d'une valeur qui n'est pas une balise (null, un texte…), qu'il n'y a pas à nommer,
// ni d'un nom de balise personnalisée pas encore défini : son composant arrive peut-être à la demande, il aura son ombre à sa
// mise à niveau
function _mjsAdoptNoShadow(el) {
  var tag = el && el.nodeType === 1 ? el.localName : '';
  if (!tag || _mjsAdoptWarned.has(tag)) return;
  if (tag.indexOf('-') > 0 && typeof customElements !== 'undefined' && !customElements.get(tag)) return;
  _mjsAdoptWarned.add(tag);
  µ.warn(µ._mjs_msg('adoptSheetNoShadow', { tag: tag }, 'µ.adoptSheet : la feuille n\'est pas collée dans <{tag}>, car cette balise n\'a pas d\'ombre (composant réglé en mjs-light, ou balise qui n\'est pas un composant ModularJS). Écrivez ce style dans le <style> du composant, ou dans une feuille de la page : sans ombre, les feuilles de la page s\'appliquent déjà à la balise.'));
}

// l'ombre d'un composant est fermée (`_shadow`) et `_mjs_applyLayout` (mjs_element.ts) en remet à zéro les feuilles à
// chaque connexion et à chaque variante de mise en page : seules les feuilles marquées `_mjs_keep` y survivent, dans
// leur ordre, derrière celles du composant. L'outil marque la feuille et ne la colle qu'une fois par balise (le même
// objet, ou le même texte CSS) ; chaque appel rend sa propre fonction de retrait, la feuille part avec la dernière.
// `sheet` : une CSSStyleSheet, ou un texte CSS (construit ici, retrouvé par son texte). Une balise sans ombre
// (`mjs-light`, ou qui n'est pas un composant) : rien n'est collé ni marqué, la fonction rendue ne fait rien, aucune
// exception, et la console reçoit un avertissement qui dit quoi faire à la place (`_mjsAdoptNoShadow`). Une feuille que l'ombre
// refuse (une feuille non construite, d'un <style> du document, ou d'une autre fenêtre) : rien n'est collé ni marqué, la
// fonction rendue ne fait rien, aucune exception, aucun avertissement.
// la balise tient ses feuilles dans `_mjs_adopted` : WebKit jette une CSSStyleSheet que plus aucun code ne tient (une
// fonction de retrait lâchée, un texte CSS passé) et la recrée à la demande SANS la marque ni le texte posés dessus ; la
// feuille ne se retrouverait plus à la remise en page, et le même texte, redemandé, en collerait une deuxième
µ.adoptSheet = function(el, sheet) {
  var root = el instanceof µ.Element ? el._shadow : null;
  if (!root || root === el) {
    _mjsAdoptNoShadow(el);
    return function() {};
  }
  if (!root.adoptedStyleSheets || typeof CSSStyleSheet !== 'function') return function() {};
  var held  = el._mjs_adopted || [];
  var text  = typeof sheet === 'string' ? sheet : null;
  var entry = held.find(function(e) { return text === null ? e.sheet === sheet : e.text === text; });
  if (!entry) {
    try {
      if (text !== null) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
      }
      else if (!(sheet instanceof CSSStyleSheet)) return function() {};
      if (root.adoptedStyleSheets.indexOf(sheet) < 0) root.adoptedStyleSheets = root.adoptedStyleSheets.concat([sheet]);
      sheet._mjs_keep = true;
    }
    catch {
      return function() {};
    }
    el._mjs_adopted = held;
    held.push(entry = { sheet: sheet, text: text, uses: 0 });
    // une feuille collée ne change aucun nœud : qui suit les feuilles de l'original (les miroirs des copies de *marquee) l'entend ici, comme son retrait
    if (µ._mjs_sheetMoved) µ._mjs_sheetMoved(el);
  }
  entry.uses++;
  var done = false;
  return function() {
    if (done) return;
    done = true;
    if (--entry.uses > 0) return;
    var at = held.indexOf(entry);
    if (at >= 0) held.splice(at, 1);
    var now = root.adoptedStyleSheets;
    if (now.indexOf(entry.sheet) >= 0) root.adoptedStyleSheets = now.filter(function(s) { return s !== entry.sheet; });
    if (µ._mjs_sheetMoved) µ._mjs_sheetMoved(el);
  };
};
