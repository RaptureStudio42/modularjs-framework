// paths.ts — générateur de fonctions createElement compile-time.
//
// Objectif : éliminer COMPLÈTEMENT le chemin parse-HTML+cloneNode+walk au
// runtime. À la place, le compilateur émet UNE fonction `__create_X(item?, index?)`
// qui appelle `document.createElement` / `createTextNode` / `appendChild` direct
// et retourne `{ fragment, refs }` où `refs` = pointeurs JS directs vers les
// nodes dynamiques (text placeholders + éléments annotés).
//
// Mini-parser HTML browser-compatible :
//   - Void tags consommés sans children
//   - Commentaires `<!--...-->` = node distinct (Node.COMMENT_NODE)
//   - Texte (y compris whitespace inter-tags) = node distinct (Node.TEXT_NODE)
//   - Attributs avec `${...}` interpolations préservés (template literal)
//   - Tags raw-text (script, style, textarea, title) : contenu consommé brut
//
// Les markers reconnus :
//   1. `<script type='mjs/marker' mjs-t='X'></script>`  → text placeholder
//   2. `<script type='mjs/marker' mjs-l-t='X'></script>` → text placeholder (loop)
//   3. `<span mjs-id='X'></span>` ou `<span mjs-l-id='X'></span>` → text placeholder
//      (binding `{html}` au root, conteneur réservé)
//   4. Élément quelconque avec `mjs-id='X'` ou `mjs-l-id='X'` → l'élément
//      lui-même, attribut retiré du DOM créé.
//
// Output :
//   - createFn : string JS de la forme `(item, index) => { ... return {fragment, refs}; }`
//     ou `() => { ... return {fragment, refs}; }` selon le besoin
//   - refIds : liste des ids exposés dans `refs` (pour debug / tests)
//
// V2 — Approche "Solid-like" : pas de parse runtime, pas de walk paths, pas de
// cache template. La fonction est JIT-inlinée par V8 après quelques exécutions.

import { t } from '../messages/index.js'
import { decodeHtmlEntities, attrSur } from './utils.js'
import { readHtmlComment } from '../mask.js'

export type NodeKind = 'text' | 'html' | 'el' | 'textslot'

export interface PathInfo {
  cleanHtml: string
  paths: Record<string, number[]>
  kinds: Record<string, NodeKind>
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// Tags dont le contenu est texte brut côté browser (pas de parsing HTML interne).
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

// `<title>` porte DEUX natures selon son contexte, et le parseur des navigateurs
// en change au passage de la frontière « foreign content » (spec HTML) :
//   - sous `<head>` : texte BRUT — le titre de l'onglet, jamais analysé ;
//   - sous `<svg>`/`<math>` : élément ORDINAIRE — le nom accessible d'un dessin,
//     dont le contenu est analysé comme n'importe quel autre.
// Le mini-parser appliquait la 1re règle partout : un jalon d'interpolation posé
// dans `<svg><title>{µt(…)}</title>` n'était jamais recensé et restait tel quel
// dans la page. Piège MUET (build vert, zéro avertissement, seul un lecteur
// d'écran le voit) — même famille que le `<tbody>` implicite ci-dessous.
// `script`/`style` restent bruts sous `<svg>` : leur contenu y est du JS/CSS.
const FOREIGN_ROOTS = new Set(['svg', 'math'])

// nature du contenu de `tag`, vu la pile d'ancêtres (`tag` lui-même déjà empilé
// ou non — sa présence en sommet est sans effet, il n'est pas une racine foreign)
function isRawTextTag(tag: string, stack: { tag: string }[]): boolean {
  if (!RAW_TEXT_TAGS.has(tag)) return false
  if (tag !== 'title') return true
  for (let k = stack.length - 1; k >= 0; k--) {
    // `<foreignObject>` (SVG) rouvre du HTML : on y retrouve le `<title>` brut
    if (stack[k].tag === 'foreignobject') return true
    if (FOREIGN_ROOTS.has(stack[k].tag)) return false
  }
  return true
}

// namespace de création pour `tagName`, vu LUI-MÊME
// et la pile d'ancêtres : `<svg>`/`<math>` engagent leur PROPRE namespace (pas
// seulement celui de leurs enfants). Le mode CLONE (`µ._mjs_cloneTpl`, runtime) est
// protégé par `_mjs_svgTagRe` et par foreignWrapTag (plus bas) — ce mode IMPÉRATIF (`generateCreateFnBodyImperative`,
// seul appelant) ne l'était pas : `document.createElement` posait un SVG en
// namespace HTML (HTMLUnknownElement, jamais affiché) dès qu'une branche
// `{await}` forçait ce mode.
export const SVG_NS  = 'http://www.w3.org/2000/svg'
export const MATH_NS = 'http://www.w3.org/1998/Math/MathML'

// éléments SVG dont le nom porte des majuscules : la table « adjust SVG tag names » du standard HTML (analyse des contenus étrangers), qui rétablit la
// casse depuis les minuscules. Le navigateur la rejoue sur tout élément SVG qu'il lit dans du HTML ; ce mode impératif nomme lui-même ses éléments
// (createElementNS) et dans l'espace de noms SVG la casse compte : `lineargradient` n'est qu'un élément inconnu, sans dégradé ni découpe ni filtre
const SVG_TAG_NAMES = new Map(['altGlyph', 'altGlyphDef', 'altGlyphItem', 'animateColor', 'animateMotion', 'animateTransform', 'clipPath', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'foreignObject', 'glyphRef', 'linearGradient', 'radialGradient', 'textPath'].map((nom): [string, string] => [nom.toLowerCase(), nom]))

// attributs des éléments SVG dont le nom porte des majuscules : la table « adjust SVG attributes » du standard HTML ; l'analyseur HTML du navigateur passe tout nom d'attribut
// en minuscules, puis rétablit la casse de ceux-là sur un élément SVG ; ce mode impératif pose lui-même ses attributs et sur un élément SVG la casse compte : un `viewbox` n'est
// qu'un attribut inconnu (le dessin n'est pas mis à l'échelle), un `gradientunits` laisse les unités par défaut du dégradé
const SVG_ATTR_NAMES = new Map(['attributeName', 'attributeType', 'baseFrequency', 'baseProfile', 'calcMode', 'clipPathUnits', 'diffuseConstant', 'edgeMode', 'filterUnits', 'glyphRef', 'gradientTransform', 'gradientUnits', 'kernelMatrix', 'kernelUnitLength', 'keyPoints', 'keySplines', 'keyTimes', 'lengthAdjust', 'limitingConeAngle', 'markerHeight', 'markerUnits', 'markerWidth', 'maskContentUnits', 'maskUnits', 'numOctaves', 'pathLength', 'patternContentUnits', 'patternTransform', 'patternUnits', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'preserveAlpha', 'preserveAspectRatio', 'primitiveUnits', 'refX', 'refY', 'repeatCount', 'repeatDur', 'requiredExtensions', 'requiredFeatures', 'specularConstant', 'specularExponent', 'spreadMethod', 'startOffset', 'stdDeviation', 'stitchTiles', 'surfaceScale', 'systemLanguage', 'tableValues', 'targetX', 'targetY', 'textLength', 'viewBox', 'viewTarget', 'xChannelSelector', 'yChannelSelector', 'zoomAndPan'].map((nom): [string, string] => [nom.toLowerCase(), nom]))

// attributs « étrangers » : la table « adjust foreign attributes » du standard HTML, nom qualifié en minuscules → espace de noms ; l'analyseur HTML les pose dans leur espace de noms
// (le `xlink:href` d'un `<use>` n'est lu que dans celui de XLink : sans lui l'icône n'apparaît pas) et `setAttribute` ne sait pas le faire, c'est `setAttributeNS` ; les autres noms
// qualifiés (`xml:base`, `xmlns:foo`…) restent des attributs sans espace de noms, comme pour l'analyseur
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_NS   = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
const FOREIGN_ATTR_NS = new Map([
  ['xlink:actuate', XLINK_NS], ['xlink:arcrole', XLINK_NS], ['xlink:href', XLINK_NS], ['xlink:role', XLINK_NS], ['xlink:show', XLINK_NS], ['xlink:title', XLINK_NS], ['xlink:type', XLINK_NS],
  ['xml:lang', XML_NS], ['xml:space', XML_NS],
  ['xmlns', XMLNS_NS], ['xmlns:xlink', XMLNS_NS]
])

// attributs MathML : la table « adjust MathML attributes » du standard HTML, qui n'a qu'une entrée
const MATH_ATTR_NAMES = new Map([['definitionurl', 'definitionURL']])

// l'attribut tel que l'analyseur HTML le poserait sur un élément de l'espace de noms `ns` (SVG_NS, MATH_NS, ou null pour un élément HTML) : son nom, avec la casse du standard,
// et son espace de noms (null = aucun) ; les attributs étrangers ne se déplacent que sur un élément SVG, HTML garde le nom écrit
export function adjustAttr(ns: string | null, attrName: string): { name: string, ns: string | null } {
  const lower = attrName.toLowerCase()
  if (ns === SVG_NS) {
    const foreignNs = FOREIGN_ATTR_NS.get(lower)
    if (foreignNs) return { name: lower, ns: foreignNs }
    return { name: SVG_ATTR_NAMES.get(lower) ?? attrName, ns: null }
  }
  if (ns === MATH_NS) return { name: MATH_ATTR_NAMES.get(lower) ?? attrName, ns: null }
  return { name: attrName, ns: null }
}

function foreignNamespace(tagName: string, stack: { tag: string }[]): string | null {
  if (tagName === 'svg') return SVG_NS
  if (tagName === 'math') return MATH_NS
  for (let k = stack.length - 1; k >= 0; k--) {
    // `<foreignObject>` (SVG) rouvre du HTML :
    // ses descendants (tant qu'aucun `<svg>`/`<math>` imbriqué ne réencapsule)
    // reprennent le namespace HTML — AVANT ce correctif la remontée de pile ne
    // s'arrêtait qu'à svg/math, jamais à foreignobject : createElementNS posait
    // un `<div>` en namespace SVG (jamais affiché). Même
    // stratégie « premier trouvé en remontant » que isRawTextTag ci-dessus (pour
    // <title>) — `foreignobject` déjà en minuscules ici (tag empilé via
    // `.toLowerCase()` par les deux marcheurs, casse insensible d'origine).
    if (stack[k].tag === 'foreignobject') return ''   // '' = HTML EXPLICITE (distinct de null = rien trouvé, cf. repli foreignNsRoot)
    if (stack[k].tag === 'svg') return SVG_NS
    if (stack[k].tag === 'math') return MATH_NS
  }
  return null
}

// tbody IMPLICITE — le parseur HTML des navigateurs enveloppe tout `<tr>` enfant
// direct d'un `<table>` dans un `<tbody>` qu'il fabrique lui-même (mode
// d'insertion « in table » du standard). Le mini-parser ci-dessous doit faire
// PAREIL : sinon les chemins de nœuds calculés ici sautent un niveau et la
// factory générée déréférence un null au montage (leçon passing-snippets du
// tuto, page morte).
// ⚠ happy-dom n'insère PAS ce tbody : la suite de tests est aveugle au cas, la
// preuve se fait sur les chemins eux-mêmes (tests/paths-tbody-implicite.test.ts).
const TABLE_SECTIONS = new Set(['thead', 'tbody', 'tfoot'])

// balises que le parseur ouvrirait AVANT `tag`, vu le parent courant
function implicitTableWrap(tag: string, parent: string): string[] {
  if (tag === 'tr' && parent === 'table') return ['tbody']
  // `<col>` posé directement dans un `<table>` : le navigateur ouvre un `<colgroup>` autour
  if (tag === 'col' && parent === 'table') return ['colgroup']
  if (tag === 'td' || tag === 'th') {
    if (parent === 'table') return ['tbody', 'tr']
    if (TABLE_SECTIONS.has(parent)) return ['tr']
  }
  return []
}

// une section explicite (<thead>/<tbody>/<tfoot>/<caption>/<colgroup>) referme
// le tbody (et le tr) que le parseur avait ouverts d'office
const TABLE_CLOSERS = new Set(['thead', 'tbody', 'tfoot', 'caption', 'colgroup'])

// un élément de FLOW CONTENT (liste HTML5 « p
// end tag can be omitted », plus `<li>`, `<dd>`, `<dt>` qui le referment aussi) ouvert alors qu'un `<p>` est l'élément COURANT
// referme ce `<p>` D'OFFICE dans tout navigateur conforme — le `<div>` devient
// un FRÈRE du `<p>`, pas un enfant. Le chemin calculé ici visait un enfant qui
// n'existe jamais dans l'arbre réel : CRASH au montage. Plutôt
// que reproduire la refermeture implicite (comme `implicitTableWrap` le fait
// pour `<tbody>`/`<tr>`, un calcul de chemins totalement différent), on REFUSE
// la compilation : geste d'auteur presque toujours involontaire.
const P_CLOSING_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre',
  'search', 'section', 'summary', 'table', 'ul', 'xmp',
])

// numéro de ligne (1-based) du caractère d'index `pos` dans `html` — pour nommer
// la ligne fautive d'une erreur de compilation
function computeLine(html: string, pos: number): number {
  let line = 1
  const end = Math.min(pos, html.length)
  for (let k = 0; k < end; k++) if (html[k] === '\n') line++
  return line
}

// lignes du fichier `.mjs` portées jusqu'ici : le générateur fait précéder chaque balise et chaque texte du gabarit d'une
// marque `\u0000<ligne>\u0000` (marqueLigne), retirée avant toute lecture (retireLignes) — un message cite alors la ligne du
// fichier, pas celle du morceau de gabarit lu (un bloc `{if}`/`{for}` est construit à part, sans les lignes qui le précèdent)
const MARQUE_LIGNE_RE = /\u0000(\d+)\u0000/g

export interface LignesDuGabarit { positions: number[], lignes: number[] }

export function marqueLigne(ligne: number | undefined): string {
  return ligne === undefined ? '' : `\u0000${ligne}\u0000`
}

// HTML sans ses marques, et la ligne du fichier de chaque position marquée (null : aucune marque)
export function retireLignes(html: string): { html: string, lignes: LignesDuGabarit | null } {
  if (!html.includes('\u0000')) return { html, lignes: null }
  const positions: number[] = []
  const lignes: number[]    = []
  let retire = 0
  const propre = html.replace(MARQUE_LIGNE_RE, (marque: string, ligne: string, at: number) => {
    positions.push(at - retire)
    lignes.push(Number(ligne))
    retire += marque.length
    return ''
  })
  return { html: propre, lignes: { positions, lignes } }
}

// le gabarit racine sort du générateur sans ses marques (compile, cf. retenirLignesRacine) et revient ici par le transpileur :
// ses lignes sont gardées à part, retrouvées par son texte
let racine: { html: string, lignes: LignesDuGabarit } | null = null

export function retenirLignesRacine(html: string): string {
  const lu = retireLignes(html)
  racine = lu.lignes === null ? null : { html: lu.html, lignes: lu.lignes }
  return lu.html
}

// ligne du fichier de ce qui commence en `pos` : celle de la dernière marque posée avant ; sans marque, la ligne comptée
// dans le morceau
function ligneDuFichier(html: string, lignes: LignesDuGabarit | null, pos: number): number {
  if (lignes === null || lignes.positions.length === 0 || lignes.positions[0] > pos) return computeLine(html, pos)
  let bas  = 0
  let haut = lignes.positions.length - 1
  while (bas < haut) {
    const milieu = (bas + haut + 1) >> 1
    if (lignes.positions[milieu] <= pos) bas = milieu
    else haut = milieu - 1
  }
  return lignes.lignes[bas]
}

// la garde `checkFlowInsideP` ne regardait QUE le SOMMET de
// pile (`stack[stack.length - 1].tag === 'p'`) : `<p>a<b>x<div>y</div>z</b>b</p>`
// passait (l'élément COURANT à l'ouverture du `<div>` est `<b>`, pas `<p>`)
// alors qu'un navigateur conforme referme le `<p>` ET le `<b>` (« button scope »,
// arbre éclaté, chemins faux). On refuse dès qu'un `<p>`
// est ouvert dans la pile en deçà de la portée « button » du standard : un `<button>`,
// une cellule, un `<template>`… arrêtent la recherche, le navigateur ne referme pas un `<p>`
// situé au-delà (`<p>Texte <button><div>…</div></button></p>` garde sa `<div>`). Helper COMMUN
// aux deux marcheurs — `extractPaths` posait déjà
// la garde (au sommet seul, corrigé ici) ; `generateCreateFnBodyImperative` ne
// la posait PAS DU TOUT (atteint par `{await}{success}` contenant un `{for}`,
// qui force le mode impératif — le même DOM éclaté passait sans erreur).
// La ligne n'est calculée qu'au moment de lever : recomptée à chaque balise ouvrante, elle
// rendait le coût quadratique sur la taille du gabarit.
const P_SCOPE_STOP = new Set([
  'button', 'td', 'th', 'caption', 'table', 'html', 'marquee', 'object', 'applet', 'template',
  'foreignobject', 'desc', 'title', 'mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml',
])

function checkFlowInsideP(stack: { tag: string }[], tagName: string, line: () => number): void {
  if (!P_CLOSING_TAGS.has(tagName)) return
  for (let k = stack.length - 1; k >= 0; k--) {
    if (P_SCOPE_STOP.has(stack[k].tag)) return
    if (stack[k].tag === 'p') throw new Error(t('generator.p-contenu-interdit', { tag: tagName, ligne: line() }))
  }
}

// fermetures implicites du standard HTML : ouvrir un `<li>` referme le `<li>` encore ouvert, de même
// `<dt>`/`<dd>`, une cellule `<td>`/`<th>`, une rangée `<tr>`, une `<option>`/`<optgroup>` — le navigateur
// en fait des FRÈRES, jamais un élément imbriqué dans le précédent. Rend le nombre de niveaux à refermer
// avant d'ouvrir `tag`. La recherche d'un `<li>`/`<dt>`/`<dd>` s'arrête au premier élément « spécial » du
// standard (hors address, div, p) : une liste imbriquée garde ses propres éléments
const LIST_ITEM_STOP = new Set([
  'applet', 'article', 'aside', 'blockquote', 'body', 'button', 'caption', 'center', 'colgroup', 'dd',
  'details', 'dir', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frameset', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'html', 'li', 'listing', 'main', 'marquee',
  'menu', 'nav', 'noscript', 'object', 'ol', 'pre', 'search', 'section', 'select', 'summary', 'table',
  'tbody', 'td', 'template', 'tfoot', 'th', 'thead', 'tr', 'ul', 'mi', 'mo', 'mn', 'ms', 'mtext',
  'annotation-xml', 'foreignobject', 'desc',
])
// éléments « spéciaux » du standard qui restent ouverts : une fermante d'élément ordinaire (`</span>`) ne remonte pas
// au-delà
const SPECIAL_TAGS = new Set([...LIST_ITEM_STOP, 'address', 'div', 'p', 'iframe', 'noembed', 'noframes', 'plaintext', 'xmp'])
// bornes de la portée par défaut du standard (« has an element in scope ») : la recherche d'un élément ouvert s'y arrête
const SCOPE_STOP = new Set([
  'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'foreignobject', 'desc', 'title',
  'mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml',
])
// éléments de mise en forme du standard, et les bornes de leur liste (un `<a>` ouvert au-delà n'est plus vu)
const FORMATTING_TAGS    = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u'])
const FORMATTING_MARKERS = new Set(['applet', 'caption', 'html', 'marquee', 'object', 'td', 'template', 'th'])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
// refermés d'office dans un `<ruby>` avant `<rb>`/`<rtc>`/`<rp>`/`<rt>` (« generate implied end tags » du standard)
const IMPLIED_END_TAGS = new Set(['dd', 'dt', 'li', 'optgroup', 'option', 'p', 'rb', 'rp', 'rt', 'rtc'])
const TABLE_STRUCTURE  = new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'])

function implicitCloseCount(stack: { tag: string }[], tag: string): number {
  const top = stack.length - 1
  if (tag === 'li' || tag === 'dt' || tag === 'dd') {
    for (let k = top; k >= 1; k--) {
      const ouvert = stack[k].tag
      if (tag === 'li' ? ouvert === 'li' : (ouvert === 'dt' || ouvert === 'dd')) return stack.length - k
      if (LIST_ITEM_STOP.has(ouvert)) return 0
    }
    return 0
  }
  if (tag === 'option' || tag === 'optgroup') {
    let n = stack[top].tag === 'option' ? 1 : 0
    if (tag === 'optgroup' && top - n >= 1 && stack[top - n].tag === 'optgroup') n++
    return n
  }
  if (TABLE_STRUCTURE.has(tag)) return tableCloseCount(stack, tag)
  // un `<button>` (un `<a>`) encore ouvert se referme : les deux sont frères — un `<a>` mal imbriqué (bloc ou mise en
  // forme entre les deux) est refusé avant, par checkNesting
  if (tag === 'button' || tag === 'a') {
    for (let k = top; k >= 1; k--) {
      if (stack[k].tag === tag) return stack.length - k
      if ((tag === 'a' ? FORMATTING_MARKERS : SCOPE_STOP).has(stack[k].tag)) return 0
    }
    return 0
  }
  // un titre ouvert juste en dessous d'un autre titre se referme
  if (HEADINGS.has(tag)) return HEADINGS.has(stack[top].tag) ? 1 : 0
  if (tag === 'rb' || tag === 'rtc' || tag === 'rp' || tag === 'rt') {
    if (!hasInScope(stack, 'ruby')) return 0
    let n = 0
    while (top - n >= 1 && IMPLIED_END_TAGS.has(stack[top - n].tag) && !(stack[top - n].tag === 'rtc' && (tag === 'rp' || tag === 'rt'))) n++
    return n
  }
  // un `<colgroup>` ne garde que des `<col>` : toute autre balise le referme
  return stack[top].tag === 'colgroup' && tag !== 'col' && tag !== 'template' ? 1 : 0
}

function hasInScope(stack: { tag: string }[], tag: string): boolean {
  for (let k = stack.length - 1; k >= 1; k--) {
    if (stack[k].tag === tag) return true
    if (SCOPE_STOP.has(stack[k].tag)) return false
  }
  return false
}

// tableau : une cellule referme la cellule ouverte (et ce qu'elle contient encore), une rangée la rangée, une section
// (`<thead>`, `<tbody>`, `<tfoot>`, `<caption>`, `<colgroup>`) la section ouverte, comme le fait le navigateur ; la
// recherche ne sort ni du tableau le plus proche ni d'un `<template>`
function tableCloseCount(stack: { tag: string }[], tag: string): number {
  for (let k = stack.length - 1; k >= 1; k--) {
    const ouvert = stack[k].tag
    if (ouvert === 'template' || ouvert === 'html') return 0
    if (ouvert === 'table') return stack.length - 1 - k
    if (tag === 'td' || tag === 'th') {
      if (ouvert === 'td' || ouvert === 'th') return stack.length - k
      if (ouvert === 'tr' || TABLE_SECTIONS.has(ouvert)) return stack.length - 1 - k
    }
    else if (tag === 'tr') {
      if (ouvert === 'tr') return stack.length - k
      if (TABLE_SECTIONS.has(ouvert)) return stack.length - 1 - k
    }
    else if (tag === 'col' && ouvert === 'colgroup') return stack.length - 1 - k
    else if (TABLE_SECTIONS.has(ouvert) || ouvert === 'caption' || ouvert === 'colgroup') return stack.length - k
  }
  return 0
}

// fermante `</tag>` : nombre de niveaux qu'elle referme, 0 quand le navigateur l'ignore — aucun élément de ce nom ouvert
// dans sa portée (fermante orpheline, ou en double après une fermeture implicite : `<li>a<li>b</li></li>`, que le
// compilateur écrit en refermant chaque balise). Avant, elle refermait TOUT jusqu'à la racine : la suite du gabarit
// changeait de parent et ses chemins visaient des nœuds absents. Une fermante de tableau ne sort pas du tableau,
// `</li>` pas d'une liste, `</p>` pas d'un `<button>`, une fermante d'élément ordinaire pas d'un élément spécial ;
// `</h2>` referme le titre ouvert, quel que soit son niveau
function endTagCloseCount(stack: { tag: string }[], tag: string): number {
  const special = SPECIAL_TAGS.has(tag)
  const tableau = tag === 'table' || TABLE_STRUCTURE.has(tag)
  for (let k = stack.length - 1; k >= 1; k--) {
    const ouvert = stack[k].tag
    if (ouvert === tag || (HEADINGS.has(tag) && HEADINGS.has(ouvert))) return stack.length - k
    if (tableau ? (ouvert === 'table' || ouvert === 'template' || ouvert === 'html') : special ? (SCOPE_STOP.has(ouvert) || (tag === 'li' && (ouvert === 'ol' || ouvert === 'ul')) || (tag === 'p' && ouvert === 'button')) : SPECIAL_TAGS.has(ouvert)) return 0
  }
  return 0
}

// balises HTML qui font sortir du contenu SVG/MathML : le navigateur referme les éléments étrangers ouverts jusqu'au
// premier élément HTML ou point d'intégration (`<foreignObject>`, `<desc>`, `<title>`, `<mi>`…) — `<svg><span>` pose le
// `<span>` APRÈS le `<svg>`, pas dedans
const FOREIGN_BREAKOUT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's',
  'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
])
const INTEGRATION_POINTS = new Set(['foreignobject', 'desc', 'title', 'mi', 'mo', 'mn', 'ms', 'mtext'])

function foreignBreakoutCount(stack: { tag: string }[], tag: string, tagInner: string): number {
  if (!FOREIGN_BREAKOUT.has(tag) && !(tag === 'font' && /\s(?:color|face|size)(?=[\s=/]|$)/i.test(tagInner))) return 0
  if (!stack.some(s => FOREIGN_ROOTS.has(s.tag))) return 0
  let n = 0
  for (let k = stack.length - 1; k >= 1 && !INTEGRATION_POINTS.has(stack[k].tag) && foreignNamespace(stack[k].tag, stack.slice(0, k)); k--) n++
  return n
}

// vrai si une balise ouvrante s'insère en contenu SVG/MathML (élément courant étranger, hors point d'intégration) : les
// règles HTML (fermetures implicites, `<image>`, tableaux…) ne s'y appliquent pas
function inForeignContent(stack: { tag: string }[], root: string | null): boolean {
  if (INTEGRATION_POINTS.has(stack[stack.length - 1].tag)) return false
  const ns = foreignNamespace('', stack)
  return !!(ns === null ? root : ns)
}

// vrai si l'élément courant est SVG/MathML (point d'intégration compris) : `<![CDATA[` y ouvre une section de texte,
// fermée par `]]>` — ailleurs c'est un commentaire
function currentIsForeign(stack: { tag: string }[], root: string | null): boolean {
  const ns = foreignNamespace(stack[stack.length - 1].tag, stack.slice(0, -1))
  return !!(ns === null ? root : ns)
}

// `<html>`, `<head>`, `<body>`, `<frameset>` dans un gabarit : le navigateur les ignore, leur contenu va au parent
const IGNORED_TAGS = new Set(['body', 'frameset', 'head', 'html'])

// un tableau ne garde que ses rangées, cellules, sections, `<caption>`, `<col>`/`<colgroup>`, `<template>`, `<script>`,
// `<style>` et `<input type="hidden">` : tout autre élément (composant compris) ou texte placé directement dans un
// `<table>`, `<tbody>`, `<thead>`, `<tfoot>` ou `<tr>` est retiré du tableau par le navigateur, qui le pose AVANT lui
// (« foster parenting » du standard) — l'arbre réel n'est plus celui du gabarit : refusé à la construction
const TABLE_CONTEXT = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr'])
const TABLE_CONTENT = new Set(['caption', 'col', 'colgroup', 'script', 'style', 'tbody', 'td', 'template', 'tfoot', 'th', 'thead', 'tr'])

function checkTableContent(stack: { tag: string }[], tagName: string, tagInner: string, line: () => number): void {
  const parent = stack[stack.length - 1].tag
  if (!TABLE_CONTEXT.has(parent) || TABLE_CONTENT.has(tagName)) return
  if (tagName === 'input' && /\stype\s*=\s*(['"]?)hidden\1(?=[\s/]|$)/i.test(tagInner)) return
  // un <form> reste dans le tableau, vide et refermé sur place ; son contenu sort du formulaire
  if (tagName === 'form') throw new Error(t('generator.hors-tableau-form', { parent, ligne: line() }))
  throw new Error(t('generator.hors-tableau', { tag: tagName, parent, ligne: line() }))
}

// texte (hors blancs) posé directement dans un tableau : retiré du tableau par le navigateur, comme un élément
function checkTableText(stack: { tag: string }[], textChunk: string, line: () => number): void {
  const parent = stack[stack.length - 1].tag
  if (!(TABLE_CONTEXT.has(parent) || parent === 'colgroup') || isPureWhitespace(textChunk) || textChunk.includes('${')) return
  throw new Error(t('generator.texte-hors-tableau', { parent, ligne: line() }))
}

// `<form>` dans un `<form>`, `<select>` dans un `<select>`, `<a>` dans un `<a>` à travers un bloc ou une mise en forme :
// le navigateur ignore le second `<form>`, referme le premier `<select>` en ignorant le second, déplace les éléments
// pris entre les deux `<a>` — un arbre que le gabarit ne dit pas : refusé à la construction
function checkNesting(stack: { tag: string }[], tagName: string, line: () => number): void {
  if (tagName !== 'form' && tagName !== 'select' && tagName !== 'a') return
  for (let k = stack.length - 1; k >= 1; k--) {
    const ouvert = stack[k].tag
    if (ouvert === tagName) {
      let refus = tagName !== 'a'
      for (let j = k + 1; j < stack.length && !refus; j++) refus = SPECIAL_TAGS.has(stack[j].tag) || FORMATTING_TAGS.has(stack[j].tag)
      if (refus) throw new Error(t('generator.imbrication-refusee', { tag: tagName, ligne: line() }))
      return
    }
    if (ouvert === 'template' || (tagName === 'a' && FORMATTING_MARKERS.has(ouvert))) return
  }
}

// le contenu d'un `<template>` part dans `template.content`, hors de l'arbre du composant : une valeur, un
// bloc ou un gestionnaire posé dedans viserait un nœud que le chemin calculé ne peut pas atteindre (plantage
// au montage) — refusé à la construction. Un `<template>` entièrement statique reste permis
const DYNAMIC_IN_TEMPLATE_RE = /\$\{|type\s*=\s*['"]mjs\/marker['"]|\smjs-(?:l-)?id\s*=/

function checkTemplateStatic(html: string, from: number, line: () => number): void {
  const balise = /<(\/?)template(?=[\s/>])/gi
  balise.lastIndex = from
  let depth = 1
  let end   = html.length
  let m: RegExpExecArray | null
  while ((m = balise.exec(html)) !== null) {
    depth += m[1] ? -1 : 1
    if (depth === 0) { end = m.index; break }
  }
  if (DYNAMIC_IN_TEMPLATE_RE.test(html.slice(from, end))) throw new Error(t('generator.template-dynamique', { ligne: line() }))
}

// `<?…>`, `<!…>` (hors DOCTYPE) et `<![CDATA[…]]>` hors SVG/MathML : le navigateur en fait un COMMENTAIRE,
// un nœud de plus que le chemin doit compter. Un DOCTYPE ne laisse aucun nœud ; un CDATA en SVG/MathML
// devient du texte (compté par les marcheurs, cf. currentIsForeign)
function declarationMakesComment(html: string, i: number, foreign: boolean): boolean {
  if (html[i + 1] === '?') return true
  if (/^<!doctype/i.test(html.slice(i, i + 9))) return false
  return !(foreign && html.startsWith('<![CDATA[', i))
}

// Tags block-level dans lesquels le whitespace inter-balises n'est
// PAS visuellement significatif (ni en CSS default ni en sémantique HTML).
// Pour ces parents, on peut éliminer les text nodes purement whitespace entre
// leurs children sans changer le rendu. Pour les inline (span/a/em/...), on
// PRÉSERVE les whitespaces car ils peuvent être visuellement importants
// (espace entre deux <span>, par ex).
//
// La liste est conservative : on inclut les containers de layout courants
// (div, table, tbody, tr, ul, ol, dl, section, article, header, footer,
// main, nav, aside, figure, fieldset, form, etc.). Pour `<p>` on garde le
// whitespace car le user pourrait avoir du texte mixte avec des balises
// inline ; idem pour `<h1..h6>`, `<label>`, `<button>`.
//
// `pre` volontairement ABSENT : white-space: pre, chaque blanc est significatif (cf. WS_PRESERVING_TAGS).
const BLOCK_CONTAINERS = new Set([
  '#root',
  'html', 'head', 'body',
  'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'menu',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'caption',
  'form', 'fieldset', 'legend',
  'figure', 'figcaption',
  'details', 'summary',
  'blockquote',
  'hgroup', 'address',
  'select', 'optgroup',
  'video', 'audio', 'picture',
  'template', 'slot',
])

// Détection ultra-rapide : la string ne contient QUE \n, \t, espaces, \r.
function isPureWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false
  }
  return true
}

// blancs SIGNIFICATIFS — sous un ancêtre <pre> (white-space: pre) ou <textarea>,
// un text node 100 % blanc fait partie du rendu : jamais de strip whitespace, même
// si le parent DIRECT est un BLOCK_CONTAINER (<pre><div>…</div></pre>). textarea
// est raw-text (contenu jamais re-parsé ici) mais gardé par défense en profondeur
const WS_PRESERVING_TAGS = new Set(['pre', 'textarea'])

// un navigateur conforme ignore le PREMIER `\n`
// (ou `\r\n`) collé juste après une balise ouvrante `<pre>`/`<textarea>` (règle
// HTML5, confort d'écriture) ; happy-dom ne le fait pas (angle mort connu, même
// famille que le tbody implicite ci-dessus). On le retire ICI,
// dans la STRING source elle-même (émission ET calcul de chemin), avant tout
// autre traitement : plus aucun DOM (réel ou happy-dom) ne voit ce caractère,
// donc le chemin calculé reste valable dans les deux mondes. Un seul retrait :
// un éventuel second `\n` reste (il est, lui, un vrai retour à la ligne voulu).
function skipLeadingPreNewline(html: string, pos: number): number {
  if (html.startsWith('\r\n', pos)) return pos + 2
  if (html.startsWith('\n', pos)) return pos + 1
  return pos
}

// vrai si un niveau de la pile (ancêtres du chunk courant) préserve les blancs
function stackKeepsWhitespace(stack: { tag: string }[]): boolean {
  for (let s = stack.length - 1; s >= 0; s--) if (WS_PRESERVING_TAGS.has(stack[s].tag)) return true
  return false
}

// repère les spans DÉJÀ quotés (valeur d'un AUTRE attribut) dans un `tagInner` — les
// guillemets ne délimitent QUE des valeurs d'attribut dans cette grammaire (apostrophe
// littérale toujours encodée `&#39;`, cf. `staticAttr`, attributes/index.ts) : un scan naïf
// caractère par caractère suffit, sans échappement à gérer. Sert à distinguer un VRAI
// marqueur `mjs-id=`/`mjs-l-id=` d'une occurrence citée EN PROSE dans la valeur d'un autre
// attribut (`title='exemple mjs-id="demo" ici'`), que la regex seule ne peut pas voir.
function quotedSpans(s: string): [number, number][] {
  const spans: [number, number][] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '"' || ch === "'") {
      const close = s.indexOf(ch, i + 1)
      const end   = close === -1 ? s.length : close + 1
      spans.push([i, end])
      i = end
    } else {
      i++
    }
  }
  return spans
}

function isInsideQuotedSpan(pos: number, spans: [number, number][]): boolean {
  return spans.some(([start, end]) => pos > start && pos < end)
}

// ============================================================================
// extractPaths — LEGACY. Conservé pour rétrocompat des tests
// qui vérifient `data.surgicalHtml` et `data.pathsStr`. Toujours utilisé par le
// transpiler/index.ts pour produire le surgicalHtml affiché par debug.
//
// Avec `stripWhitespace=true`, retire les text nodes purement whitespace
// dans les BLOCK_CONTAINERS (même principe qu'en mode impératif). Réduit la taille
// du DOM cloné et accélère le parse HTML interne du browser.
// ============================================================================
export function extractPaths(html: string, opts: { stripWhitespace?: boolean, lignes?: LignesDuGabarit | null } = {}): PathInfo {
  const stripWs = opts.stripWhitespace ?? false
  const lignesFichier = opts.lignes ?? null
  const out: string[] = []
  const paths: Record<string, number[]> = {}
  const kinds: Record<string, NodeKind> = {}

  // `lastText` : le dernier enfant compté à ce niveau est un texte — un texte qui le suit sans nœud entre eux
  // (`a < b` lu en deux morceaux, section CDATA) s'y soude dans le navigateur, sans nœud de plus
  const stack: { tag: string; myIndex: number; nextChild: number; implicit?: boolean; lastText?: boolean }[] = [
    { tag: '#root', myIndex: -1, nextChild: 0 },
  ]

  const recordIndex = (texte = false): number[] => {
    const p: number[] = []
    for (let s = 1; s < stack.length; s++) p.push(stack[s].myIndex)
    const top = stack[stack.length - 1]
    p.push(top.nextChild)
    top.nextChild += 1
    top.lastText = texte
    return p
  }

  let i = 0
  const len = html.length

  // Garde-fou anti-boucle-infinie : `i` doit STRICTEMENT progresser à chaque
  // tour (vécu : un `endClose=-1` non gardé pouvait ramener `i` à 0). Boucle
  // synchrone → un `mocha --timeout` est impuissant à l'interrompre (le hang
  // bloque la boucle d'event JS elle-même) ; on transforme donc tout futur
  // régression du même ordre en erreur explicite immédiate au lieu d'un gel.
  let _mjs_prevI = -1
  let _mjs_stall = 0

  while (i < len) {
    if (i === _mjs_prevI) {
      _mjs_stall += 1
      if (_mjs_stall > 2) {
        throw new Error(t('generator.extract-paths-boucle-infinie', { i, len, extrait: JSON.stringify(html.slice(Math.max(0, i - 20), i + 20)) }))
      }
    } else {
      _mjs_stall = 0
    }
    _mjs_prevI = i

    if (html.startsWith('<!--', i)) {
      const comment = readHtmlComment(html, i)
      if (comment === null) { out.push(html.slice(i)); i = len; break }
      recordIndex()
      out.push(html.slice(i, comment.end))
      i = comment.end
      continue
    }

    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      // `<![CDATA[…]]>` sous un élément SVG/MathML : un texte, fermé par `]]>`
      if (html.startsWith('<![CDATA[', i) && currentIsForeign(stack, null)) {
        const fin = html.indexOf(']]>', i + 9)
        const stop = fin === -1 ? len : fin + 3
        if ((fin === -1 ? len : fin) > i + 9 && !stack[stack.length - 1].lastText) recordIndex(true)
        out.push(html.slice(i, stop))
        i = stop
        continue
      }
      const end = html.indexOf('>', i)
      if (end === -1) { out.push(html.slice(i)); i = len; break }
      if (declarationMakesComment(html, i, !!foreignNamespace('', stack))) recordIndex()
      out.push(html.slice(i, end + 1))
      i = end + 1
      continue
    }

    if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i)
      if (end === -1) { out.push(html.slice(i)); i = len; break }
      const tagName = html.slice(i + 2, end).trim().toLowerCase()
      const n = endTagCloseCount(stack, tagName)
      // `</p>` sans `<p>` ouvert : le navigateur pose un `<p>` vide
      if (n === 0 && tagName === 'p') recordIndex()
      for (let k = n; k > 0; k--) {
        // un niveau ouvert d'office (tbody/tr implicite) se referme d'office
        const dropped = stack.pop()!
        if (dropped.implicit && k > 1) out.push(`</${dropped.tag}>`)
      }
      out.push(html.slice(i, end + 1))
      i = end + 1
      continue
    }

    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] ?? '')) {
      let j = i + 1
      let inQuote: string | null = null
      while (j < len) {
        const c = html[j]
        if (inQuote) {
          // même défaut, même parade que le scanner jumeau de
          // `generateCreateFnBodyImperative` (voir son commentaire) : `extractPaths`
          // n'est plus atteint AVEC interpolations par le pipeline compile.ts
          // (routé vers le mode impératif dès qu'une `${...}` existe), mais reste
          // exporté (legacy, rétrocompat tests) — un appelant direct avec une
          // fenêtre `${...}` à apostrophe reproduisait la même désynchronisation.
          if (c === '$' && html[j + 1] === '{') {
            const close = scanInterpWindow(html, j)
            if (close !== -1) { j = close + 1; continue }
          }
          if (c === inQuote) inQuote = null
        } else {
          if (c === '"' || c === "'") inQuote = c
          else if (c === '>') break
        }
        j++
      }
      if (j >= len) {
        // flux épuisé alors qu'un guillemet
        // d'attribut est resté OUVERT (`inQuote` non nul) : AVANT, silence total
        // (le tag fautif ET tout ce qui le suit disparaissaient du fragment
        // généré, `<template>` vide, aucune erreur). Un flux
        // simplement TRONQUÉ (pas de `>` du tout, mais aucun guillemet resté
        // ouvert) garde le comportement historique, hors périmètre ici.
        if (inQuote) {
          const openTagMatch = html.slice(i + 1).match(/^([a-zA-Z][a-zA-Z0-9_-]*)/)
          throw new Error(t('generator.attribut-guillemet-non-ferme', { tag: openTagMatch ? openTagMatch[1] : '?' }))
        }
        out.push(html.slice(i)); i = len; break
      }

      const rawTag = html.slice(i + 1, j)
      const selfClosing = rawTag.endsWith('/')
      const tagInner = selfClosing ? rawTag.slice(0, -1).trimEnd() : rawTag

      const nameMatch = tagInner.match(/^([a-zA-Z][a-zA-Z0-9_-]*)/)
      const nomLu = (nameMatch ? nameMatch[1] : '').toLowerCase()
      // balise HTML dans un SVG/MathML : les éléments étrangers se referment avant elle (cf. foreignBreakoutCount)
      for (let n = foreignBreakoutCount(stack, nomLu, tagInner); n > 0; n--) out.push(`</${stack.pop()!.tag}>`)
      const etranger = inForeignContent(stack, null)
      // hors SVG/MathML, `<image>` est lu `<img>` ; `<html>`, `<head>`, `<body>` sont ignorés (cf. IGNORED_TAGS)
      const tagName = nomLu === 'image' && !etranger ? 'img' : nomLu
      if (IGNORED_TAGS.has(tagName) && !etranger) { i = j + 1; continue }
      const isVoid = VOID_TAGS.has(tagName)
      const isScript = tagName === 'script'

      // <p> ne peut pas contenir un
      // élément de flow content : le navigateur referme le <p> tout seul avant
      // celui-ci, où qu'il soit dans la pile ouverte (cf. checkFlowInsideP plus haut).
      // Avant elle, les fermetures implicites (cf. implicitCloseCount), écrites en clair dans le HTML
      // émis : tout analyseur (navigateur, DOM des tests) bâtit alors les mêmes frères
      if (!etranger) {
        checkNesting(stack, tagName, () => ligneDuFichier(html, lignesFichier, i))
        for (let n = implicitCloseCount(stack, tagName); n > 0; n--) out.push(`</${stack.pop()!.tag}>`)
        checkFlowInsideP(stack, tagName, () => ligneDuFichier(html, lignesFichier, i))
        checkTableContent(stack, tagName, tagInner, () => ligneDuFichier(html, lignesFichier, i))
      }
      if (tagName === 'template' && !selfClosing) checkTemplateStatic(html, j + 1, () => ligneDuFichier(html, lignesFichier, i))

      if (isScript) {
        const typeMatch = tagInner.match(/\btype\s*=\s*['"]mjs\/marker['"]/)
        if (typeMatch) {
          const idMatch = tagInner.match(/\bmjs-l?-?t\s*=\s*['"]([^'"]+)['"]/)
          if (idMatch) {
            const id = idMatch[1]
            let endOfScript = j + 1
            if (!selfClosing) {
              const close = html.indexOf('</script>', endOfScript)
              if (close !== -1) endOfScript = close + '</script>'.length
            }
            // Perf, stratégie Solid/Svelte : si le slot texte est le SEUL
            // enfant de son parent (1er enfant ET fermeture immédiate après),
            // on émet un ESPACE — un vrai text node dans le clone — au lieu d'un
            // commentaire `<!--$-->`. La factory navigue alors directement
            // dessus (kind 'textslot'), SANS createTextNode + replaceChild par
            // ligne. L'espace est écrasé par la 1re mise à jour (.data) avant le
            // 1er paint (donc invisible), et il survit au strip (qui ne
            // retire que le whitespace AVEC newline). Cas non-sole (texte/slot
            // adjacent) → on garde `<!--$-->` (comportement inchangé).
            const __top = stack[stack.length - 1]
            const __sole = __top.tag !== '#root' && __top.nextChild === 0 && html.startsWith('</', endOfScript)
            paths[id] = recordIndex()
            kinds[id] = __sole ? 'textslot' : 'text'
            out.push(__sole ? ' ' : '<!--$-->')
            i = endOfScript
            continue
          }
        }
      }

      const elIdRegex = /\s+mjs-(l-)?id\s*=\s*['"]([^'"]+)['"]/g
      let cleanedTagInner = tagInner
      const foundIds: string[] = []
      // un `mjs-id=`/`mjs-l-id=` cité EN PROSE dans la valeur d'un AUTRE attribut
      // (`title='exemple mjs-id="demo" ici'`) n'est pas un vrai marqueur — la regex seule ne
      // distingue pas le nom d'un attribut du texte de sa valeur, `quotedSpans` si.
      const elIdSpans = quotedSpans(tagInner)
      let elIdMatch: RegExpExecArray | null
      while ((elIdMatch = elIdRegex.exec(tagInner)) !== null) {
        if (!isInsideQuotedSpan(elIdMatch.index, elIdSpans)) foundIds.push(elIdMatch[2])
      }
      if (foundIds.length > 0) {
        cleanedTagInner = tagInner.replace(elIdRegex, (match, _lid, _id, offset) =>
          isInsideQuotedSpan(offset, elIdSpans) ? match : ''
        )
      }

      const rebuilt = selfClosing
        ? `<${cleanedTagInner.trimEnd()}>`
        : `<${cleanedTagInner}>`

      // niveaux que le parseur du navigateur ouvre ou referme tout seul
      while (stack.length > 1 && stack[stack.length - 1].implicit && TABLE_CLOSERS.has(tagName)) {
        out.push(`</${stack.pop()!.tag}>`)
      }
      for (const wrap of implicitTableWrap(tagName, stack[stack.length - 1].tag)) {
        const wrapPath = recordIndex()
        out.push(`<${wrap}>`)
        stack.push({ tag: wrap, myIndex: wrapPath[wrapPath.length - 1], nextChild: 0, implicit: true })
      }

      const pathOfEl = recordIndex()
      const myIndex = pathOfEl[pathOfEl.length - 1]
      for (const id of foundIds) {
        paths[id] = pathOfEl
        kinds[id] = 'el'
      }

      out.push(rebuilt)

      if (!isVoid && !selfClosing) {
        stack.push({ tag: tagName, myIndex, nextChild: 0 })

        if (isRawTextTag(tagName, stack)) {
          // <textarea> est raw-text : son 1er `\n` (avalé par le
          // navigateur) se retire ICI, en amont du slice du contenu brut.
          const rawStart = tagName === 'textarea' ? skipLeadingPreNewline(html, j + 1) : j + 1
          const closeTag = `</${tagName}`
          const closeIdx = findCloseRawText(html, rawStart, closeTag)
          if (closeIdx === -1) {
            out.push(html.slice(rawStart))
            i = len
            stack.pop()
            break
          }
          if (closeIdx > rawStart) {
            stack[stack.length - 1].nextChild += 1
          }
          out.push(html.slice(rawStart, closeIdx))
          const endClose = html.indexOf('>', closeIdx)
          // `</tag` sans `>` de fermeture nulle part dans le reste du flux
          // (HTML tronqué/malformé) : endClose = -1. SANS cette garde,
          // `i = endClose + 1` vaut 0 → l'unique point de recul de l'index
          // dans toute la fonction → boucle infinie (gel du build/watcher,
          // EXIT 124). On traite comme une fin de flux, à l'identique de la
          // branche `closeIdx === -1` juste au-dessus.
          if (endClose === -1) {
            out.push(html.slice(closeIdx))
            i = len
            stack.pop()
            break
          }
          out.push(html.slice(closeIdx, endClose + 1))
          stack.pop()
          i = endClose + 1
          continue
        }
      }

      // <pre> n'est PAS raw-text (son contenu reste parsé normalement,
      // cf. isRawTextTag) : son 1er `\n` se retire en avançant le point de
      // reprise, avant que la boucle ne reparte sur son 1er enfant.
      i = (tagName === 'pre' && !isVoid && !selfClosing) ? skipLeadingPreNewline(html, j + 1) : j + 1
      continue
    }

    let next = html.indexOf('<', i)
    // `<` non consommé par les branches balise (texte littéral `a < b`) :
    // sans ceci next === i → chunk vide → i ne progresse plus → boucle
    // infinie du compilateur (gel du build/watcher sans message).
    if (next === i) next = html.indexOf('<', i + 1)
    const end = next === -1 ? len : next
    const textChunk = html.slice(i, end)
    if (textChunk.length > 0) {
      checkTableText(stack, textChunk, () => ligneDuFichier(html, lignesFichier, i + Math.max(0, textChunk.search(/\S/))))
      // Strip whitespace-only chunks dans block containers.
      // Cohérent avec le mode impératif. Réduit le DOM cloné.
      //
      // ATTENTION : ne strip QUE les whitespace contenant un newline (= pretty-
      // print indent). Un espace solitaire entre 2 balises inline (`</span> <span>`)
      // est intentionnel — le manger casse l'affichage de code coloré dans
      // les tutos/docs (ex: `-> $count` qui devient `->$count`).
      if (stripWs) {
        const parentTag = stack[stack.length - 1].tag
        // sous un ancêtre pre/textarea le blanc est significatif → préservé
        if (BLOCK_CONTAINERS.has(parentTag) && isPureWhitespace(textChunk) && /[\n\r]/.test(textChunk) && !stackKeepsWhitespace(stack)) {
          i = end
          continue
        }
      }
      // collé au texte précédent (cf. `lastText`) : même nœud, pas de rang de plus
      if (!stack[stack.length - 1].lastText) recordIndex(true)
      out.push(textChunk)
    }
    i = end
  }

  return {
    cleanHtml: out.join(''),
    paths,
    kinds,
  }
}

// cherche la balise fermante `</tag` en exigeant un délimiteur juste après le
// nom (fin de chaîne, espace, `>` ou `/`) — un `indexOf` littéral seul
// confondait `</textarea` avec le PRÉFIXE d'une balise plus longue présente
// dans le texte brut (`</textareaBoom>`) : le contenu raw-text se refermait
// au milieu du mot, et le build échouait plus loin avec un message indirect
// au lieu de fermer proprement sur la VRAIE balise fermante.
// Recherche dans le gabarit lui-même, jamais dans `html.toLowerCase()` : aucune copie du gabarit entier à
// chaque balise raw-text, et une position juste — `'İ'.toLowerCase()` fait deux unités, tout ce qui suivait
// un « İ » glissait d'autant et la vraie balise fermante n'était plus reconnue. Drapeau `i` sans `u` : seules
// les lettres ASCII se confondent, comme dans un nom de balise HTML
function findCloseRawText(html: string, start: number, closeTag: string): number {
  const re = new RegExp(closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s>/]|$)', 'gi')
  re.lastIndex = start
  return re.exec(html)?.index ?? -1
}

/**
 * Sérialise le `paths` map en littéral JS minimal pour injection dans le
 * template : `{"t1":["t",0,1,0],"e2":["e",0,2]}`.
 * LEGACY — utilisé seulement par d'anciens tests.
 */
export function serializePaths(info: PathInfo): string {
  const entries: string[] = []
  for (const id of Object.keys(info.paths)) {
    const path = info.paths[id]
    const kind = info.kinds[id]
    const k = (kind === 'text' || kind === 'textslot') ? 't' : kind === 'html' ? 'h' : 'e'
    entries.push(`"${id}":["${k}",${path.join(',')}]`)
  }
  return `{${entries.join(',')}}`
}

// ============================================================================
// generateCreateFn : génère du JS qui appelle document.createElement
// directement, sans parse HTML / cloneNode / walk paths au runtime.
//
// Input : HTML "surgical" brut (encore avec markers `mjs-id`, `mjs-l-id`,
// `<script mjs-t>`, `<span mjs-id>`). Plus une éventuelle liste de paramètres
// si la fn doit en recevoir (`item`, `index`).
//
// Output : string JS de la forme
//   `(item, index) => { const _mjs_fr = document.createDocumentFragment();
//                       const _mjs_e0 = document.createElement('div');
//                       _mjs_e0.setAttribute('class', 'foo');
//                       const _mjs_e1 = document.createTextNode('hello ');
//                       _mjs_e0.appendChild(_mjs_e1);
//                       const t1 = document.createTextNode('');
//                       _mjs_e0.appendChild(t1);
//                       _mjs_fr.appendChild(_mjs_e0);
//                       return { fragment: _mjs_fr, refs: { t1 } }; }`
//
// Notes :
//   - Les `${expr}` dans les attributs deviennent des template literals dans le
//     code émis (préservés tel quel).
//   - Les éléments annotés (mjs-id / mjs-l-id) sont alloués comme `const _refN`
//     puis exposés dans `refs`.
//   - Les `<script type='mjs/marker' ...>` et `<span mjs-id/l-id>` deviennent
//     des `document.createTextNode('')` exposés dans `refs`.
//   - VOID_TAGS et RAW_TEXT_TAGS traités comme dans extractPaths.
// ============================================================================

export interface CreateFnInfo {
  /** Source JS de la fonction (sans le wrapper de signature). */
  body: string
  /** Liste des ids exposés dans `refs`. */
  refIds: string[]
  /** Si non-null, contient le HTML statique d'un `<template>` réutilisable
   * (sans interpolations). Le caller émet alors un singleton `<template>` global
   * et utilise `cloneNode(true)` au lieu de N createElement.
   * null si le template a des interpolations `${...}` dans attrs/texte. */
  tplHtml?: string | null
  /** Code d'extraction des refs depuis un fragment cloné. */
  tplRefExtract?: string | null
  /** lignes d'update à exécuter HORS de `body`,
   * APRÈS les `branchUpdates`/`localUpdates` du consommateur (compile.ts), dans
   * le même bloc `__nodes` (ou en fin de corps si le consommateur n'en a
   * aucune) — jamais DANS `body` lui-même. Sert au `value` d'un `<select>`
   * dont les `<option>` viennent d'un `{for}` imbriqué : posé trop tôt (avant
   * que le `{for}` ne peuple les options réelles), `value` retombe sur la 1re
   * option. Chaque ligne référence l'élément via `__nodes['id']`, jamais une
   * variable locale de `body` (invisible une fois sortie de son scope).
   * Absent/vide pour le mode clone — mécanisme propre au mode impératif. */
  postUpdates?: string[]
}

/**
 * Détecte si le HTML peut être pré-créé via `<template>` + `cloneNode`.
 *
 * Conditions :
 *   - Aucune interpolation `${...}` dans les attrs/text
 *   - Pas de markers `<script type='mjs/marker'>` (ces nodes peuvent rester
 *     en placeholder text node créé par cloneNode mais on n'a pas de path
 *     fiable sans walker)
 *
 * Note : on TOLÈRE les markers car ils correspondent à des `<!--$-->` ou
 * placeholders text créés au clone, et on peut les retrouver via path walking
 * pré-calculé.
 */
function hasInterpolations(html: string): boolean {
  // Recherche `${` à l'extérieur des commentaires HTML pour détecter les
  // interpolations runtime. Si présent → fallback createElement.
  return html.includes('${')
}

/**
 * Génère un body qui utilise template + cloneNode au lieu de N createElement.
 *
 * Gain : `cloneNode(true)` d'un template parsé une fois (parser HTML browser-side)
 * est typiquement 4-5× plus rapide que N createElement + appendChild successifs.
 *
 * Stratégie :
 *   1. Au COMPILE-TIME, on extrait le `paths` map (utiliser extractPaths) qui
 *      remplace les markers par `<!--$-->` (placeholder commentaire).
 *   2. On émet :
 *        - Un singleton `__tpl_X.content` parsé via `<template>.innerHTML = ...`
 *          (encapsulé dans une IIFE lazy au premier call).
 *        - Une fonction qui clone + walk les childNodes selon les paths
 *          + remplace chaque commentaire `<!--$-->` par un text node vide.
 *
 * Note importante : le HTML peut contenir des `<span mjs-id>` (pour binding html)
 * → ils deviennent un <span> dans le clone, OK.
 *
 * Le `body` retourné UTILISE deux variables externes au callers :
 *   - `µ._mjs_cloneTpl(__tpl_X_html)` : helper runtime qui parse le HTML une fois
 *     et clone le content du template à chaque appel.
 */
// Helper Solid-style : firstChild/nextSibling pour petits index,
// childNodes[N] pour grands. Le seuil 3 est conservatif :
//   - `_p.firstChild`                 → 1 prop access (n=0)
//   - `_p.firstChild.nextSibling`     → 2 prop access (n=1)
//   - `_p.firstChild.nextSibling.nextSibling` → 3 (n=2)
//   - n >= 3 : childNodes[n] avec hash-lookup interne reste compétitif.
function childAccessExpr(parent: string, n: number): string {
  if (n === 0) return parent + '.firstChild'
  if (n === 1) return parent + '.firstChild.nextSibling'
  if (n === 2) return parent + '.firstChild.nextSibling.nextSibling'
  return parent + `.childNodes[${n}]`
}

// Longueur en OCTETS (UTF-8) du code émis : `µ` est le seul signe non-ASCII qui y passe, et il
// compte double. C'est l'octet livré qui départage les deux écritures d'un accès, pas le signe.
function byteLen(code: string): number {
  let n = code.length
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) > 127) n++
  return n
}

// Départage les deux écritures d'un même accès : la chaîne de propriétés `direct`
// (`_f.firstChild.nextSibling…`, déjà construite par l'appelant) et l'appel compact
// `µ._p(base,1,0)` (runtime mjs_dom.ts), qui descend les mêmes index et rend le MÊME nœud.
// `compact` n'est vrai que pour un corps construit UNE fois (racine, branche {if}/{await}/{key}
// hors boucle) — dans un gabarit de ligne, l'appel serait payé à chaque ligne. En deçà de trois
// octets gagnés la chaîne directe reste (`_f.firstChild` n'en rendrait que deux) : un appel de
// fonction ne se paie pas pour deux signes.
function shortestAccess(direct: string, base: string, idxs: number[], compact: boolean): string {
  if (!compact) return direct
  const court = `µ._p(${base},${idxs.join(',')})`
  return byteLen(court) + 2 < byteLen(direct) ? court : direct
}

// balises que `µ._mjs_cloneTpl` (runtime, mjs_init.ts) sait lire DANS un <svg> quand le HTML
// s'ouvre sur l'une d'elles — copie exacte de son motif `µ._mjs_svgTagRe`, pour savoir ici si le
// runtime rattrape déjà l'espace de noms d'un contenu de bloc. Le runtime part en texte brut et n'importe rien du
// compilateur : tests/motif-svg-du-runtime-et-du-generateur-d-accord.test.ts garde les deux motifs identiques
export const RUNTIME_SVG_HEAD_RE = /^\s*<(?:circle|ellipse|line|path|polygon|polyline|rect|g|text|tspan|textPath|use|defs|symbol|marker|linearGradient|radialGradient|stop|clipPath|mask|pattern|image|foreignObject|filter|fe[A-Z][a-zA-Z]*|view|switch)\b/

// balise dans laquelle lire le contenu d'un bloc ({for}/{if}/{key}/{await}) posé dans un <svg> ou un
// <math> : construit à part, sans sa balise englobante, il naîtrait en HTML (HTMLUnknownElement,
// jamais dessiné). Le runtime ne rattrape que le contenu SVG qui s'ouvre sur une balise connue ; un
// marqueur de bloc imbriqué en tête, un `<a>`, du MathML passent par leur balise d'origine. Aucun
// élément (texte seul) : rien à faire
function foreignWrapTag(cleanHtml: string, foreignNs: string | null): string | null {
  if (!foreignNs || !/<[a-zA-Z]/.test(cleanHtml)) return null
  if (foreignNs === SVG_NS) return RUNTIME_SVG_HEAD_RE.test(cleanHtml) ? null : 'svg'
  if (foreignNs === MATH_NS) return 'math'
  return null
}

function generateCloneFnBody(html: string, keepRefs?: Set<string>, compactPaths = false, foreignNs: string | null = null, lignesFichier: LignesDuGabarit | null = null): CreateFnInfo {
  // Utilise extractPaths pour obtenir le HTML propre + paths.
  // Strip whitespace-only text nodes dans les block containers, cohérent
  // avec le mode impératif. Réduit le DOM cloné et accélère le parse.
  const info = extractPaths(html, { stripWhitespace: true, lignes: lignesFichier })
  // Élagage des refs mortes : seules les refs consommées (keepRefs)
  // donnent lieu à une navigation + une entrée refs[id]. ATTENTION : les
  // placeholders 'text'/'textslot' restent TOUJOURS extraits — leur marker
  // (commentaire ou espace) est un VRAI nœud du template dont la
  // matérialisation (replaceChild) fait partie du contrat du clone.
  const refIds = Object.keys(info.paths).filter(
    (id) => !keepRefs || keepRefs.has(id) || info.kinds[id] === 'text' || info.kinds[id] === 'textslot'
  )

  // Le HTML cleanHtml contient `<!--$-->` à la place des markers + `<span mjs-id>`
  // pour les bindings html.

  const lines: string[] = []
  // Clone du template via helper runtime µ._mjs_cloneTpl (parse once, clone × N).
  // L'argument est la string HTML littérale (la clé de cache est cette string).
  // Le helper retourne un DocumentFragment cloné.
  // contenu d'un bloc dans un <svg>/<math> : lu dans sa balise d'origine, puis ses nœuds en sont
  // sortis (cf. foreignWrapTag) — les chemins restent comptés depuis `_f`
  const wrapTag = foreignWrapTag(info.cleanHtml, foreignNs)
  if (wrapTag) {
    const wrappedLiteral = chaineJs(`<${wrapTag}>${info.cleanHtml}</${wrapTag}>`)
    lines.push(`const _mjs_fr = document.createDocumentFragment(); { const _mjs_w = µ._mjs_cloneTpl(${wrappedLiteral}).firstChild; while (_mjs_w.firstChild) _mjs_fr.appendChild(_mjs_w.firstChild); }`)
  }
  else {
    const tplHtmlLiteral = chaineJs(info.cleanHtml)
    lines.push(`const _mjs_fr = µ._mjs_cloneTpl(${tplHtmlLiteral});`)
  }

  if (refIds.length === 0) {
    lines.push(`return { fragment: _mjs_fr, refs: {} };`)
    return { body: lines.join('\n'), refIds, tplHtml: info.cleanHtml }
  }

  // Walker : pour chaque id, walk childNodes via path.
  // Pour les text placeholders, on remplace le commentaire `<!--$-->` par un
  // text node vide.
  lines.push(`const _mjs_refs = {};`)

  // Path prefix sharing : factoriser les chaînes `.childNodes[X]` partagées.
  // Au lieu de générer `_f.childNodes[0].childNodes[0].childNodes[0]` à chaque
  // référence, on émet `const _p1 = _f.childNodes[0]` puis `_p2 = _p1.childNodes[0]`
  // etc. Sur un row de table (4-6 nodes profonds), gain typique 30-50% sur le
  // walk (économie N × NodeList indexed-access).
  //
  // Stratégie : on construit un map prefix → variable, indexé par la signature
  // string du préfixe. On émet une nouvelle var pour chaque prefix de longueur
  // strictement > 0 qui apparaît au moins 2 fois (sinon inline direct).
  const prefixCount = new Map<string, number>()
  for (const id of refIds) {
    const path = info.paths[id]
    // On compte chaque prefix Y COMPRIS le path complet :
    // un nœud à la fois ref directe (ex. `h.firstChild`) ET préfixe d'une autre
    // (ex. `h.firstChild.firstChild`) n'était compté qu'une fois → jamais
    // factorisé → re-walké depuis _f à chaque usage. Inclure `len === path.length`
    // le fait passer le seuil ≥2 → hissé en variable (CSE pur, sémantique
    // identique). Sur un row de table, supprime ~la moitié des firstChild.
    for (let len = 1; len <= path.length; len++) {
      const key = path.slice(0, len).join(',')
      prefixCount.set(key, (prefixCount.get(key) ?? 0) + 1)
    }
  }
  const prefixVar = new Map<string, string>()
  let pCounter = 0
  // Émettre les vars dans l'ordre des préfixes croissants (parent avant enfant).
  const sortedPrefixes = [...prefixCount.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => a[0].split(',').length - b[0].split(',').length)
  for (const [pkey] of sortedPrefixes) {
    const idxs = pkey.split(',').map(Number)
    // Le parent : si idxs.length === 1, c'est _f ; sinon, le prefix précédent.
    let parentVar: string
    if (idxs.length === 1) {
      parentVar = '_mjs_fr'
    } else {
      const parentKey = idxs.slice(0, -1).join(',')
      parentVar = prefixVar.get(parentKey) ?? '_mjs_fr'
      if (!prefixVar.has(parentKey)) {
        // Parent pas factorisé : on inline le chemin complet.
        parentVar = '_mjs_fr' + idxs.slice(0, -1).map(j => `.childNodes[${j}]`).join('')
      }
    }
    const lastIdx = idxs[idxs.length - 1]
    const v = `_mjs_p${pCounter++}`
    // Solid-style firstChild/nextSibling pour petits index.
    // childNodes[N] traverse la NodeList interne (LinkedList walk). Pour N petit,
    // firstChild + nextSibling chain est plus rapide (slot natif Node).
    // Parent pas factorisé : `parentVar` porte DÉJÀ tout le chemin depuis `_f` — la forme compacte,
    // elle, repart de `_f` avec la liste complète des index.
    const parentIsVar = prefixVar.has(idxs.slice(0, -1).join(','))
    lines.push(`const ${v} = ${shortestAccess(childAccessExpr(parentVar, lastIdx), parentIsVar ? parentVar : '_mjs_fr', parentIsVar ? [lastIdx] : idxs, compactPaths)};`)
    prefixVar.set(pkey, v)
  }

  // Helper : construire l'expression d'accès pour un path en utilisant les vars cachées.
  const buildAccess = (path: number[]): string => {
    // Trouver le préfixe le plus long qui a une variable.
    for (let len = path.length; len >= 1; len--) {
      const key = path.slice(0, len).join(',')
      const v = prefixVar.get(key)
      if (v) {
        const rest = path.slice(len)
        if (rest.length === 0) return v
        // Chain firstChild/nextSibling au lieu de childNodes[N].
        let expr = v
        for (const j of rest) expr = childAccessExpr(expr, j)
        return shortestAccess(expr, v, rest, compactPaths)
      }
    }
    // Chain firstChild/nextSibling au lieu de childNodes[N].
    let expr = '_mjs_fr'
    for (const j of path) expr = childAccessExpr(expr, j)
    return shortestAccess(expr, '_mjs_fr', path, compactPaths)
  }

  for (const id of refIds) {
    const path = info.paths[id]
    const kind = info.kinds[id]
    const access = path.length === 0 ? '_mjs_fr' : buildAccess(path)
    const idKey = JSON.stringify(id)
    if (kind === 'textslot') {
      // Le placeholder est DÉJÀ un text node (espace) dans le clone —
      // navigation directe, zéro createTextNode/replaceChild par ligne.
      lines.push(`_mjs_refs[${idKey}] = ${access};`)
    } else if (kind === 'text') {
      // Le marker était un commentaire `<!--$-->`. On le remplace par un text node.
      // Même remplacement des deux côtés : `µ._tm` (runtime mjs_dom.ts) tient les quatre
      // instructions du bloc en un appel, réservé aux corps construits une seule fois.
      if (compactPaths) lines.push(`_mjs_refs[${idKey}] = µ._tm(${access});`)
      else lines.push(`{ const _mjs_c = ${access}; const _mjs_t = document.createTextNode(''); _mjs_c.parentNode.replaceChild(_mjs_t, _mjs_c); _mjs_refs[${idKey}] = _mjs_t; }`)
    } else {
      // 'el' ou 'html' : l'élément réel (placeholder span pour html).
      lines.push(`_mjs_refs[${idKey}] = ${access};`)
    }
  }
  lines.push(`return { fragment: _mjs_fr, refs: _mjs_refs };`)

  return {
    body: lines.join('\n'),
    refIds,
    tplHtml: info.cleanHtml,
  }
}

export interface GenerateCreateFnBodyOpts {
  /** Si true, force l'emploi du mode cloneNode (utile pour tests). Sinon
   * la détection auto regarde si le HTML a des interpolations `${...}`. */
  forceClone?: boolean
  /** Si true, force l'emploi du mode imperative. */
  forceImperative?: boolean
  /** Ensemble des ids de refs réellement consommés (updateFn, events,
   * lookups live). Si fourni (mode clone uniquement), les refs absentes sont
   * ÉLAGUÉES : ni navigation DOM ni entrée `refs[id]` ne sont émises pour
   * elles. Les markers extraits « au cas où » par le walk (6 des 13 refs d'un
   * row de bench) disparaissent de la factory. */
  keepRefs?: Set<string>
  /** si true, les lignes différées de `<select
   * value>` partent dans `postUpdates` (jamais dans `body`) au lieu d'être
   * reposées à leur position d'origine par `popStackFrame` : le CONSOMMATEUR
   * (compile.ts) les rejoue APRÈS ses `branchUpdates`/`localUpdates`, pour
   * qu'un `{for}` imbriqué ait le temps de peupler les vraies `<option>`
   * avant que `value` ne soit posé. Défaut false = comportement HISTORIQUE
   * (inline dans `body`, position d'origine) : le créateur du DOM racine du
   * composant (transpiler/index.ts) s'appuie sur un mécanisme différent
   * (effet post-montage) et reste À L'IDENTIQUE. */
  splitSelectPostUpdates?: boolean
  /** namespace AMBIANT (SVG_NS/MATH_NS) dans
   * lequel cette fonction est appelée, quand l'appelant (compileFor/compileIf/compileKey/
   * compileAwait) sait que le fragment produit sera inséré dans un `<svg>`/`<math>` qui vit HORS
   * de `html` (ex. le contenu d'une branche `{await}` : le `<svg>` englobant
   * est dans le template STATIQUE, jamais vu par CE `html`-là). Sans ce relais,
   * `foreignNamespace` (pile LOCALE à cet appel) ne peut jamais savoir que la
   * racine du fragment est elle-même déjà « dans » un contexte SVG/MathML. Lu par les DEUX
   * modes : l'impératif crée ses éléments par createElementNS, le clone lit son HTML dans la
   * balise d'origine quand le runtime ne le ferait pas (cf. foreignWrapTag). */
  foreignNsRoot?: string | null
  /** si true, les accès aux nœuds s'écrivent `µ._p(_f,2,0)` et les marqueurs texte
   * `refs['s-if1'] = µ._tm(…)` (runtime mjs_dom.ts) dès que c'est plus court que la chaîne de
   * propriétés — ~2 Ko de source en moins sur une page réelle. Réservé aux corps construits UNE
   * fois (racine du composant, branche `{if}`/`{await}`/`{key}` hors boucle) : un gabarit de ligne
   * `{for}`, exécuté une fois PAR LIGNE, garde ses chaînes directes, sans appel de fonction.
   * Défaut false = sortie STRICTEMENT identique à l'historique. */
  compactPaths?: boolean
}

/**
 * Génère le BODY d'une fonction qui construit le DOM impérativement
 * ou via template+cloneNode.
 *
 * Critère auto : pas d'interpolations `${...}` dans le HTML → cloneNode possible.
 */
export function generateCreateFnBody(htmlMarque: string, opts: GenerateCreateFnBodyOpts = {}): CreateFnInfo {
  const lu     = retireLignes(htmlMarque)
  const html   = lu.html
  const lignes = lu.lignes ?? (racine !== null && racine.html === html ? racine.lignes : null)
  // Mode hybride : si pas d'interpolations runtime → cloneNode.
  // Sinon on émet le mode impératif createElement classique.
  if (!opts.forceImperative && (opts.forceClone || !hasInterpolations(html))) {
    return generateCloneFnBody(html, opts.keepRefs, opts.compactPaths ?? false, opts.foreignNsRoot ?? null, lignes)
  }
  return generateCreateFnBodyImperative(html, opts.splitSelectPostUpdates ?? false, opts.foreignNsRoot ?? null, lignes)
}

function generateCreateFnBodyImperative(html: string, splitSelectPostUpdates: boolean, foreignNsRoot: string | null = null, lignesFichier: LignesDuGabarit | null = null): CreateFnInfo {
  const lines: string[] = []
  const refIds: string[] = []
  // actif seulement si `splitSelectPostUpdates` :
  // lignes d'update à rejouer HORS de cette fonction, APRÈS que le
  // consommateur (compile.ts) ait exécuté ses `branchUpdates`/`localUpdates`
  // (le `_mjs_updList` d'un `{for}` imbriqué y peuple les VRAIES `<option>` d'un
  // `<select>`) : posée ICI, `value` arriverait avant elles et retomberait sur
  // la 1re option. Chaque ligne vise l'élément via `__nodes['id']` (jamais la
  // variable locale de cette fonction, invisible une fois sortie de son scope).
  const postUpdates: string[] = []
  // Compteur de variables locales _n0, _n1, _n2, ... pour éviter collisions.
  let nodeCounter = 0
  const newVar = (): string => `_mjs_e${nodeCounter++}`
  // compteur DÉDIÉ pour l'id synthétique d'un <select> sans
  // autre binding (cf. plus bas) : `nodeCounter` n'incrémente QUE via `newVar()`,
  // jamais appelé pour CET élément précis (son `primaryVar` vient de l'id tout
  // juste poussé dans `foundIds`) — deux `<select>` adjacents sans aucun autre
  // contenu consommant `newVar()` entre eux (ex. deux `<select value="…">`
  // 100% statiques, chacun juste un `{for}`) recevraient sinon le MÊME id
  // (`_mjs_sv${nodeCounter}` inchangé) → variable dupliquée → échec de
  // compilation (`Identifier '_r__mjs_svN' has already been declared`, prouvé).
  let selAutoIdCounter = 0

  // Stack : chaque niveau = { varName: string, tag: string }
  // Le root virtuel est le DocumentFragment (`_f`).
  // `deferredLines` : lignes d'émission mises de
  // côté à l'ouverture d'un niveau, reposées quand CE niveau se referme (après
  // ses enfants) — mécanisme HISTORIQUE, actif seulement quand
  // `splitSelectPostUpdates` est false (défaut, cas root — cf. plus haut).
  const stack: { varName: string; tag: string; implicit?: boolean; deferredLines?: string[] }[] = [
    { varName: '_mjs_fr', tag: '#root' },
  ]
  const popStackFrame = (): void => {
    const frame = stack.pop()
    if (frame && frame.deferredLines && frame.deferredLines.length > 0) lines.push(...frame.deferredLines)
  }

  lines.push(`const _mjs_fr = document.createDocumentFragment();`)

  let i = 0
  const len = html.length

  // Garde-fou anti-boucle-infinie : voir le commentaire jumeau dans
  // extractPaths (même risque structurel, même parade).
  let _mjs_prevI = -1
  let _mjs_stall = 0

  while (i < len) {
    if (i === _mjs_prevI) {
      _mjs_stall += 1
      if (_mjs_stall > 2) {
        throw new Error(t('generator.create-fn-body-boucle-infinie', { i, len, extrait: JSON.stringify(html.slice(Math.max(0, i - 20), i + 20)) }))
      }
    } else {
      _mjs_stall = 0
    }
    _mjs_prevI = i

    // ──────── Commentaire `<!--...-->` ────────
    if (html.startsWith('<!--', i)) {
      const comment = readHtmlComment(html, i)
      if (comment === null) {
        // Mal formé : on traite comme texte.
        const textChunk = html.slice(i)
        appendTextNode(lines, stack[stack.length - 1].varName, textChunk, newVar)
        i = len
        break
      }
      const inner = comment.data
      // Émettre un commentaire DOM. Sauf si c'est `<!--$-->` (placeholder
      // historique de paths.ts) : on émet quand même un commentaire pour préserver
      // la structure (mais ces cas ne devraient plus arriver via le nouveau
      // pipeline ; le compilateur émet directement des markers `mjs-t`).
      const parent = stack[stack.length - 1].varName
      const v = newVar()
      lines.push(`const ${v} = document.createComment(${JSON.stringify(inner)});`)
      lines.push(`${parent}.appendChild(${v});`)
      i = comment.end
      continue
    }

    // ──────── Doctype / instructions ────────
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      // `<![CDATA[…]]>` sous un élément SVG/MathML : un texte, fermé par `]]>` (cf. extractPaths)
      if (html.startsWith('<![CDATA[', i) && currentIsForeign(stack, foreignNsRoot)) {
        const fin = html.indexOf(']]>', i + 9)
        const texte = html.slice(i + 9, fin === -1 ? len : fin)
        if (texte.length > 0) appendTextNode(lines, stack[stack.length - 1].varName, texte, newVar)
        i = fin === -1 ? len : fin + 3
        continue
      }
      const end = html.indexOf('>', i)
      if (end === -1) { i = len; break }
      // un DOCTYPE n'a pas de représentation DOM dans un fragment ; `<?…>`, `<!…>` et un CDATA hors
      // SVG/MathML deviennent le commentaire qu'en fait le navigateur (cf. declarationMakesComment)
      const ns = foreignNamespace('', stack)
      if (declarationMakesComment(html, i, !!(ns === null ? foreignNsRoot : ns))) {
        const v = newVar()
        lines.push(`const ${v} = document.createComment(${JSON.stringify(html.slice(i + (html[i + 1] === '?' ? 1 : 2), end))});`)
        lines.push(`${stack[stack.length - 1].varName}.appendChild(${v});`)
      }
      i = end + 1
      continue
    }

    // ──────── Tag de fermeture `</...>` ────────
    if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i)
      if (end === -1) { i = len; break }
      const tagName = html.slice(i + 2, end).trim().toLowerCase()
      const n = endTagCloseCount(stack, tagName)
      // `</p>` sans `<p>` ouvert : le navigateur pose un `<p>` vide (cf. extractPaths)
      if (n === 0 && tagName === 'p') {
        const v = newVar()
        lines.push(`const ${v} = document.createElement('p');`)
        lines.push(`${stack[stack.length - 1].varName}.appendChild(${v});`)
      }
      for (let k = n; k > 0; k--) popStackFrame()
      i = end + 1
      continue
    }

    // ──────── Tag ouvrant `<tag ...>` ou `<tag .../>` ────────
    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] ?? '')) {
      let j = i + 1
      let inQuote: string | null = null
      while (j < len) {
        const c = html[j]
        if (inQuote) {
          // une fenêtre
          // `${...}` peut contenir le MÊME guillemet que le délimiteur HTML
          // (ex `title='${"l'été"}'` — attributes/index.ts enveloppe TOUJOURS
          // en quotes simples, cf. `dynamic()` branche "ni root ni for") : on
          // la saute D'UN BLOC (guillemets internes inertes, échappements `\`
          // respectés PAR `scanInterpWindow`) au lieu de la parcourir caractère
          // par caractère — sinon l'apostrophe interne referme le guillemet
          // HTML trop tôt et fait dérailler tout le reste du scan (l'élément
          // ET tout ce qui le suit dans la branche disparaissent, sans erreur
          // de compilation).
          if (c === '$' && html[j + 1] === '{') {
            const close = scanInterpWindow(html, j)
            if (close !== -1) { j = close + 1; continue }
          }
          if (c === inQuote) inQuote = null
        } else {
          if (c === '"' || c === "'") inQuote = c
          else if (c === '>') break
        }
        j++
      }
      if (j >= len) {
        // même garde jumelle qu'extractPaths (voir
        // son commentaire) : un guillemet resté OUVERT jusqu'à la fin du flux
        // devient une ERREUR, plus un fragment vide silencieux.
        if (inQuote) {
          const openTagMatch = html.slice(i + 1).match(/^([a-zA-Z][a-zA-Z0-9_-]*)/)
          throw new Error(t('generator.attribut-guillemet-non-ferme', { tag: openTagMatch ? openTagMatch[1] : '?' }))
        }
        i = len; break
      }

      const rawTag = html.slice(i + 1, j)
      const selfClosing = rawTag.endsWith('/')
      const tagInner = selfClosing ? rawTag.slice(0, -1).trimEnd() : rawTag

      const nameMatch = tagInner.match(/^([a-zA-Z][a-zA-Z0-9_-]*)/)
      const nomLu = (nameMatch ? nameMatch[1] : '').toLowerCase()
      // mêmes lectures qu'extractPaths : sortie du SVG/MathML, `<image>` lu `<img>`, `<html>`/`<head>`/`<body>` ignorés
      for (let n = foreignBreakoutCount(stack, nomLu, tagInner); n > 0; n--) popStackFrame()
      const etranger = inForeignContent(stack, foreignNsRoot)
      const tagName = nomLu === 'image' && !etranger ? 'img' : nomLu
      if (IGNORED_TAGS.has(tagName) && !etranger) { i = j + 1; continue }
      const isVoid = VOID_TAGS.has(tagName)
      const isScript = tagName === 'script'

      // même garde que extractPaths : ce mode
      // impératif (atteint dès qu'une branche `{await}` voisine un `{for}`, cf.
      // compileAwait) n'était PAS DU TOUT protégé — un `<p>…<div>flow</div>…</p>`
      // y compilait sans erreur. Fermetures implicites d'abord, comme dans extractPaths.
      if (!etranger) {
        checkNesting(stack, tagName, () => ligneDuFichier(html, lignesFichier, i))
        for (let n = implicitCloseCount(stack, tagName); n > 0; n--) popStackFrame()
        checkFlowInsideP(stack, tagName, () => ligneDuFichier(html, lignesFichier, i))
        checkTableContent(stack, tagName, tagInner, () => ligneDuFichier(html, lignesFichier, i))
      }
      if (tagName === 'template' && !selfClosing) checkTemplateStatic(html, j + 1, () => ligneDuFichier(html, lignesFichier, i))

      // ──────── Cas spécial : marker `<script type='mjs/marker' mjs-t='X'>` ────────
      if (isScript) {
        const typeMatch = tagInner.match(/\btype\s*=\s*['"]mjs\/marker['"]/)
        if (typeMatch) {
          const idMatch = tagInner.match(/\bmjs-l?-?t\s*=\s*['"]([^'"]+)['"]/)
          if (idMatch) {
            const id = idMatch[1]
            let endOfScript = j + 1
            if (!selfClosing) {
              const close = html.indexOf('</script>', endOfScript)
              if (close !== -1) endOfScript = close + '</script>'.length
            }
            const parent = stack[stack.length - 1].varName
            const safeId = jsIdentifier(id)
            // Pool text nodes : µ._mjs_getTextNode('') au lieu de createTextNode.
            // Réutilise les nodes libérés par _mjs_destroyNodeAndChildren.
            lines.push(`const ${safeId} = µ._mjs_getTextNode('');`)
            lines.push(`${parent}.appendChild(${safeId});`)
            refIds.push(id)
            i = endOfScript
            continue
          }
        }
      }

      // ──────── Tag normal : extraction attrs ────────
      // 1. Repérer mjs-id / mjs-l-id pour ref.
      const elIdRegex = /\s+mjs-(l-)?id\s*=\s*['"]([^'"]+)['"]/g
      const foundIds: string[] = []
      // même garde qu'extractPaths ci-dessus : un marqueur cité en prose dans la valeur
      // d'un AUTRE attribut n'est pas un vrai `mjs-id`.
      const elIdSpans = quotedSpans(tagInner)
      let m: RegExpExecArray | null
      while ((m = elIdRegex.exec(tagInner)) !== null) {
        if (!isInsideQuotedSpan(m.index, elIdSpans)) foundIds.push(m[2])
      }
      const cleanedTagInner = foundIds.length > 0
        ? tagInner.replace(elIdRegex, (match, _lid, _id, offset) =>
            isInsideQuotedSpan(offset, elIdSpans) ? match : ''
          )
        : tagInner

      // 2. Cas spécial : <span mjs-(l-)?id='X'></span> SANS autre attribut SANS
      //    children → c'est un placeholder html (`{html}` binding). On peut
      //    optimiser en créant un text node vide (plus léger qu'un <span>).
      //    Mais cela change la sémantique (innerHTML d'un text node ne marche
      //    pas). On garde l'élément ; le runtime `_mjs_updHtml` fera node.innerHTML.

      // 3. Allocation de la var — en posant d'abord les niveaux que le parseur
      // du navigateur ouvre tout seul (tbody/tr), pour que le DOM construit ici
      // soit le MÊME que celui d'un `innerHTML` (mode clone).
      while (stack.length > 1 && stack[stack.length - 1].implicit && TABLE_CLOSERS.has(tagName)) {
        popStackFrame()
      }
      for (const wrap of implicitTableWrap(tagName, stack[stack.length - 1].tag)) {
        const wrapVar = newVar()
        lines.push(`const ${wrapVar} = document.createElement(${JSON.stringify(wrap)});`)
        lines.push(`${stack[stack.length - 1].varName}.appendChild(${wrapVar});`)
        stack.push({ varName: wrapVar, tag: wrap, implicit: true })
      }
      const parent = stack[stack.length - 1].varName
      // un <select> dont la pose de `value` part en
      // `postUpdates` (exécutée HORS de cette fonction, cf. plus bas) doit
      // rester atteignable de l'extérieur via `__nodes['id']` : sans autre
      // binding sur ce tag, `foundIds` serait vide — on lui fabrique alors un
      // id dédié, jamais écrit dans le HTML (juste dans `refs`). Inutile si le
      // mécanisme historique reste actif (`splitSelectPostUpdates` false).
      if (splitSelectPostUpdates && tagName === 'select' && foundIds.length === 0) {
        foundIds.push(`_mjs_sv${selAutoIdCounter++}`)
      }
      // Si on a au moins un id, on utilise le PREMIER id comme nom de var (pour
      // simplicité ; les autres seront aliasés). Sinon var anonyme.
      let primaryVar: string
      if (foundIds.length > 0) {
        primaryVar = jsIdentifier(foundIds[0])
      } else {
        primaryVar = newVar()
      }
      // <svg>/<math> (racine ET descendants) se créent avec createElementNS,
      // jamais document.createElement (sinon namespace HTML, jamais affiché).
      // `foreignNsRoot` (relais de compileAwait) couvre le cas où LA RACINE de
      // CE `html` est elle-même un descendant SVG/MathML sans porter `<svg>`/
      // `<math>` dans SA PROPRE chaîne (ce tag-là vit hors de ce fragment).
      const foundNs   = foreignNamespace(tagName, stack)
      const primaryNs = foundNs === null ? foreignNsRoot : (foundNs || null)   // '' (sous foreignObject) = HTML, jamais le repli SVG de la racine
      // GARDE « mjs-light par INSTANCE, pas par tag » — `@lightDom`
      // (déjà réécrit en attribut littéral `mjs-light` dans `cleanedTagInner`
      // à ce stade) est une directive d'USAGE (`<@enfant @lightDom>`), jamais
      // de définition du composant : le MÊME tag peut être instancié léger
      // ici, ombre là. Si ce tag est déjà défini au moment de
      // `document.createElement` (ex. branches `{success}`/`{error}` d'un
      // `{await}`, seul chemin qui pose encore `mjs-light` en DEUX temps —
      // createElement PUIS setAttribute plus bas, cf. emitAttributes), le
      // constructeur tourne SYNCHRONE pendant cet appel, AVANT ce
      // `setAttribute` : `hasAttribute` échoue alors dans le constructeur
      // (mjs_element.ts). Un drapeau transitoire, posé juste avant CET appel
      // précis et effacé juste après, le rattrape sans jamais confondre deux
      // instances du même tag (pas de Set par tag : périmé dès la ligne
      // suivante, jamais partagé entre deux usages — une régression prouvée
      // de la 1re version de ce correctif). Pour un tag pas encore défini,
      // `createElement` ne construit rien tout de suite — l'upgrade réel n'a
      // lieu qu'à la connexion, `hasAttribute` y suffit déjà, ce drapeau n'y
      // intervient jamais.
      // masque les valeurs QUOTÉES (guillemets gardés, contenu blanchi, même recette que
      // maskAttrQuotes en amont, transpiler/index.ts) avant le test : un attribut SANS RAPPORT
      // (`title="... mjs-light ..."`) qui mentionne ce mot en PROSE (plausible pour la propre
      // doc de MJS sur SA fonctionnalité `@lightDom`) ne doit jamais forcer le mode léger — seul
      // un VRAI attribut `mjs-light` (déjà réécrit depuis `@lightDom` en amont) compte.
      const maskedForLightCheck = cleanedTagInner.replace(/"[^"]*"|'[^']*'/g, (q) => q[0] + q.slice(1, -1).replace(/[^\n]/g, ' ') + q[0])
      const isLightDomInstance = primaryNs === null && /(^|\s)mjs-light(\s|$)/.test(maskedForLightCheck)
      if (isLightDomInstance) lines.push(`µ._mjs_lightNext = ${JSON.stringify(tagName)};`)
      // dans l'espace de noms SVG la casse compte : le nom en minuscules (`tagName`, celui de la pile) reprend sa casse du standard
      // (SVG_TAG_NAMES), comme le fait l'analyseur HTML du navigateur — jamais pour un élément HTML ni MathML
      const createName = primaryNs === SVG_NS ? (SVG_TAG_NAMES.get(tagName) ?? tagName) : tagName
      lines.push(primaryNs
        ? `const ${primaryVar} = document.createElementNS(${JSON.stringify(primaryNs)}, ${JSON.stringify(createName)});`
        : `const ${primaryVar} = document.createElement(${JSON.stringify(tagName)});`)
      if (isLightDomInstance) lines.push(`µ._mjs_lightNext = null;`)

      // 4. Émettre les attributs (statiques + ${interpolations}).
      // sur un `<select>`, la pose de `value` (statique OU
      // interpolée) doit attendre que les VRAIES `<option>` existent : posée ICI
      // (juste après `createElement`), elle arriverait avant tout enfant — le
      // navigateur n'a alors rien à sélectionner et retombe sur la 1re option.
      // `deferredValueSink`, non `undefined` SEULEMENT pour ce tag, détourne la
      // ligne de `value` — vers `postUpdates` (`deferredElVar` = `__nodes['id']`,
      // exécuté par le CONSOMMATEUR après ses `branchUpdates`/`localUpdates`) si
      // `splitSelectPostUpdates`, sinon vers le tampon historique par niveau
      // (`stack`/`popStackFrame`, reposé à la fermeture du `<select>` — cas
      // root, cf. `GenerateCreateFnBodyOpts.splitSelectPostUpdates`).
      const deferredValueSink: string[] | undefined = tagName === 'select' ? [] : undefined
      const deferredElVar = (deferredValueSink && splitSelectPostUpdates) ? `__nodes[${JSON.stringify(foundIds[0])}]` : undefined
      emitAttributes(lines, primaryVar, cleanedTagInner.slice(nomLu.length), deferredValueSink, deferredElVar, primaryNs)
      if (splitSelectPostUpdates && deferredValueSink && deferredValueSink.length > 0) postUpdates.push(...deferredValueSink)

      // 5. Refs.
      for (const id of foundIds) {
        refIds.push(id)
        // Si c'est le primaryVar (= foundIds[0]), pas d'alias supplémentaire.
        const safeId = jsIdentifier(id)
        if (safeId !== primaryVar) {
          lines.push(`const ${safeId} = ${primaryVar};`)
        }
      }

      // 6. Append au parent.
      lines.push(`${parent}.appendChild(${primaryVar});`)

      // 7. Si non-void, on ouvre un niveau.
      if (!isVoid && !selfClosing) {
        // le contenu d'un `<template>` va dans `template.content`, là où le navigateur le range — ajouté à l'élément
        // lui-même, il restait hors du contenu que lit `template.content`
        const contenant = tagName === 'template' && !primaryNs ? primaryVar + '.content' : primaryVar
        stack.push({ varName: contenant, tag: tagName, deferredLines: (!splitSelectPostUpdates && deferredValueSink && deferredValueSink.length > 0) ? deferredValueSink : undefined })

        // Cas raw-text (script, style, textarea, title) : on consomme jusqu'à
        // </tag> sans parser le contenu.
        if (isRawTextTag(tagName, stack)) {
          // <textarea> est raw-text : son 1er `\n` (avalé par le
          // navigateur) se retire ICI, en amont du slice du contenu brut.
          const rawStart = tagName === 'textarea' ? skipLeadingPreNewline(html, j + 1) : j + 1
          const closeTag = `</${tagName}`
          const closeIdx = findCloseRawText(html, rawStart, closeTag)
          if (closeIdx === -1) {
            const textChunk = html.slice(rawStart)
            if (textChunk.length > 0) appendTextNode(lines, primaryVar, textChunk, newVar, tagName === 'textarea' || tagName === 'title')
            i = len
            popStackFrame()
            break
          }
          if (closeIdx > rawStart) {
            const textChunk = html.slice(rawStart, closeIdx)
            appendTextNode(lines, primaryVar, textChunk, newVar, tagName === 'textarea' || tagName === 'title')
          }
          const endClose = html.indexOf('>', closeIdx)
          // Même garde anti-boucle-infinie que extractPaths : `</tag` sans
          // `>` de fermeture nulle part dans le reste du flux → endClose=-1
          // → `i = endClose + 1` vaudrait 0 (seul point de recul de l'index)
          // → gel du build. Traité comme fin de flux.
          if (endClose === -1) {
            popStackFrame()
            i = len
            break
          }
          popStackFrame()
          i = endClose + 1
          continue
        }
      } else if (!splitSelectPostUpdates && deferredValueSink && deferredValueSink.length > 0) {
        // Élément void/self-closing (ex `<select value={x}/>`) : aucun enfant
        // ne viendra jamais — rien à gagner à différer, on pose tout de suite
        // (mécanisme historique seulement — en mode `splitSelectPostUpdates`,
        // déjà routé vers `postUpdates` plus haut).
        lines.push(...deferredValueSink)
      }

      // <pre> n'est PAS raw-text (contenu parsé normalement, cf.
      // isRawTextTag) : son 1er `\n` se retire en avançant le point de reprise.
      i = (tagName === 'pre' && !isVoid && !selfClosing) ? skipLeadingPreNewline(html, j + 1) : j + 1
      continue
    }

    // ──────── Texte ────────
    let next = html.indexOf('<', i)
    // Même garde anti-gel que le walker extractPaths : un `<` littéral en
    // texte (`a < b`) doit être consommé comme texte, pas re-scanné à vide.
    if (next === i) next = html.indexOf('<', i + 1)
    const end = next === -1 ? len : next
    const textChunk = html.slice(i, end)
    if (textChunk.length > 0) {
      checkTableText(stack, textChunk, () => ligneDuFichier(html, lignesFichier, i + Math.max(0, textChunk.search(/\S/))))
      // Skip les text nodes purement whitespace si le parent est un
      // conteneur block-level (BLOCK_CONTAINERS). Économise N createTextNode
      // + N appendChild par instance de template. Sur 1000 rows × ~8 text nodes
      // whitespace par tr, on évite 8000 allocations DOM.
      //
      // Garde-fou : ne strip que si le chunk contient un newline (= pretty-
      // print). Un espace solitaire `</span> <span>` est intentionnel.
      const parent = stack[stack.length - 1]
      // sous un ancêtre pre/textarea le blanc est significatif → préservé
      if (BLOCK_CONTAINERS.has(parent.tag) && isPureWhitespace(textChunk) && /[\n\r]/.test(textChunk) && !stackKeepsWhitespace(stack)) {
        // Skip — pas d'émission de createTextNode/appendChild.
      } else {
        appendTextNode(lines, parent.varName, textChunk, newVar, true)
      }
    }
    i = end
  }

  // filet de sécurité : un `<select>` jamais refermé (HTML
  // malformé) laisse son niveau sur la pile sans jamais passer par
  // `popStackFrame` — sans ce filet, sa ligne de `value` différée serait
  // perdue en silence plutôt que juste posée trop tôt (régression pire que le
  // bug d'origine). Ordre extérieur→intérieur, sans conséquence : au plus un
  // niveau réel porte des `deferredLines` (le `<select>` lui-même). Utile
  // SEULEMENT en mécanisme historique (`splitSelectPostUpdates` false) :
  // `deferredLines` n'est jamais posé sur `stack` sinon (cf. plus haut).
  for (const frame of stack) {
    if (frame.deferredLines && frame.deferredLines.length > 0) lines.push(...frame.deferredLines)
  }

  // Construction du retour final.
  // nom de variable toujours préfixé (`_mjs_r_…`, cf. jsIdentifier) : jamais égal à l'id, la clé est donc
  // toujours écrite en entier
  const refsObj = refIds.length > 0
    ? `{ ${refIds.map(id => `'${id}': ${jsIdentifier(id)}`).join(', ')} }`
    : `{}`
  lines.push(`return { fragment: _mjs_fr, refs: ${refsObj} };`)

  return {
    body: lines.join('\n'),
    refIds,
    postUpdates,
  }
}

// Convertit un id `mjs-l-id` ('s-for1', 'l3', 't7', 'b-1') en identifier JS
// valide pour utilisation comme nom de variable locale.
function jsIdentifier(id: string): string {
  // Remplace les caractères non-alpha-numeric par _.
  return '_mjs_r_' + id.replace(/[^a-zA-Z0-9_$]/g, '_')
}

/**
 * Émet un createTextNode + appendChild pour un chunk de texte.
 * Si le chunk contient `${...}` (template literal interpolations), on les
 * préserve dans un template literal source.
 * `decode` : texte qu'un navigateur lirait en décodant ses entités (texte courant, `<textarea>`, `<title>`,
 * jamais `<script>`/`<style>`) — `createTextNode` ne décode rien, le décodage se fait donc ici, sur le seul
 * texte statique, comme le fait le mode clone par l'analyseur HTML du navigateur.
 */
function appendTextNode(
  lines: string[],
  parentVar: string,
  textChunk: string,
  newVar: () => string,
  decode = false,
): void {
  const v = newVar()
  if (textChunk.includes('${')) {
    // Le caller a déjà escape les `\\`, `\``, `\$\{` pour le template literal de
    // sortie. Donc dans le HTML brut, `${...}` apparaît tel quel = interpolation
    // runtime. On émet un template literal qui sera évalué à chaque appel.
    // On doit toutefois ré-escape les `\` (backticks et `${` dans le texte non-
    // template auraient déjà été échappés par escapeTpl ; on les laisse).
    lines.push(`const ${v} = document.createTextNode(\`${escapeForTpl(textChunk, decode ? 'texte' : false)}\`);`)
  } else {
    lines.push(`const ${v} = document.createTextNode(${JSON.stringify(decode ? decodeHtmlEntities(textChunk, true) : textChunk)});`)
  }
  lines.push(`${parentVar}.appendChild(${v});`)
}

// repère où se referme la fenêtre `${...}` qui
// commence en `s[start]` (`s[start] === '$'`, `s[start + 1] === '{'`), en
// ignorant les `{`/`}` qui vivent dans une chaîne `'`/`"`/`` ` `` imbriquée
// (avec échappement `\`) — calque MINIMAL du scanner de `mapCodeSegments`
// (generator/utils.ts, LUI-MÊME calqué sur
// `interpolateSigils`, lexer/index.ts). Rend l'index du `}` fermant, ou -1 si
// la fenêtre n'est jamais refermée. Pas de récursion sur un `${` niché DANS
// une chaîne gabarit imbriquée (`` `${d.a + `x${y}`}` ``) — hors périmètre des
// attributs (aucun cas du genre dans le corpus), le contenu
// d'une chaîne gabarit imbriquée reste alors inerte de bout en bout.
function scanInterpWindow(s: string, start: number): number {
  let k = start + 2
  let depth = 1
  let inStr = false
  let strCh = ''
  const n = s.length
  while (k < n) {
    const c = s[k]
    if (inStr) {
      if (c === '\\') { k += 2; continue }
      if (c === strCh) inStr = false
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = true
      strCh = c
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return k
    }
    k++
  }
  return -1
}

// `value` est "nue" ssi elle n'est RIEN d'autre
// qu'une fenêtre `${...}` : ouverte en 0, refermée exactement au dernier
// caractère (aucun texte avant/après, aucune 2e fenêtre). Rend le texte SOURCE
// de l'expression (verbatim, ni échappé ni ré-échappé) ou `null` si `value`
// est mêlée (texte + interpolation(s), ou 2+ fenêtres) — le caller garde alors
// le chemin "chaîne" existant.
function bareInterpExpr(value: string): string | null {
  if (!value.startsWith('${')) return null
  const close = scanInterpWindow(value, 0)
  if (close === -1 || close !== value.length - 1) return null
  return value.slice(2, close)
}

/**
 * Émet les setAttribute pour un tagInner sans le nom de tag.
 * `tagAttrs` = chaîne après le tag name, ex: ` class='foo' data-x='${index}' disabled`.
 * On reconnaît :
 *   - `name='value'` ou `name="value"` (avec éventuelles interpolations `${expr}` dans value)
 *   - `name` (boolean attribute)
 * `deferredValueSink` — si fourni, la ligne de l'attribut
 * `value` part dans ce tampon au lieu de `lines` (report en `postUpdates`,
 * cf. `generateCreateFnBodyImperative` : ce tampon n'est PLUS reposé
 * dans `body`). `deferredElVar` — variable/expression à utiliser pour
 * CES lignes-là au lieu de `elVar` : `postUpdates` s'exécute hors du scope de
 * cette fonction, `elVar` (variable locale) y serait invisible.
 * `foreign` — espace de noms de l'élément quand il est créé en espace de noms SVG ou MathML (null pour
 * HTML) : aucun attribut ne s'y écrit en propriété, et leur nom (casse SVG, `definitionURL`) et leur
 * espace de noms (`xlink:href`, `xml:lang`…) sont ceux que donnerait l'analyseur HTML (cf. `emitAttrSet`).
 */
function emitAttributes(lines: string[], elVar: string, tagAttrs: string, deferredValueSink?: string[], deferredElVar?: string, foreign: string | null = null): void {
  // Parser caractère par caractère.
  let i = 0
  const n = tagAttrs.length
  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(tagAttrs[i])) i++
    if (i >= n) break

    // Lire le nom d'attribut (alphanum, -, _, :, @, .)
    const nameStart = i
    while (i < n && /[a-zA-Z0-9_\-:.@#]/.test(tagAttrs[i])) i++
    if (i === nameStart) {
      // Caractère exotique : on skip.
      i++
      continue
    }
    const attrName = tagAttrs.slice(nameStart, i)
    const isDeferred = deferredValueSink !== undefined && attrName.toLowerCase() === 'value'
    const sink = isDeferred ? deferredValueSink! : lines
    const sinkElVar = isDeferred && deferredElVar ? deferredElVar : elVar

    // Skip whitespace
    while (i < n && /\s/.test(tagAttrs[i])) i++

    if (i >= n || tagAttrs[i] !== '=') {
      // Boolean attribute (ex `disabled`).
      emitAttrSet(sink, sinkElVar, attrName, null, foreign, isDeferred)
      continue
    }
    i++ // skip '='

    // Skip whitespace
    while (i < n && /\s/.test(tagAttrs[i])) i++

    let value: string
    if (tagAttrs[i] === '"' || tagAttrs[i] === "'") {
      const q = tagAttrs[i]
      i++
      const start = i
      // une valeur interpolée peut contenir le MÊME guillemet
      // que le délimiteur HTML posé par le compilateur pour tout attribut
      // dynamique non-root/non-`{for}` (`attrName='${d.a + '...'}'` — voir
      // attributes/index.ts, qui enveloppe TOUJOURS en quotes simples, quel
      // que soit le guillemet utilisé dans l'expression JS d'origine) : sans
      // ce saut, `title={d.a + ' ' + d.b}` coupait la valeur au 1er guillemet
      // interne (`${d.a + `, le reste retombant comme attribut(s) suivant(s)
      // invalide(s)). On saute chaque fenêtre `${...}` D'UN BLOC (guillemets
      // internes inertes, cf. `scanInterpWindow`) avant de chercher le
      // guillemet fermant réel.
      while (i < n) {
        if (tagAttrs[i] === '$' && tagAttrs[i + 1] === '{') {
          const close = scanInterpWindow(tagAttrs, i)
          if (close === -1) { i++; continue }
          i = close + 1
          continue
        }
        if (tagAttrs[i] === q) break
        i++
      }
      value = tagAttrs.slice(start, i)
      if (i < n) i++ // skip closing quote
    } else {
      const start = i
      while (i < n && !/\s/.test(tagAttrs[i])) i++
      value = tagAttrs.slice(start, i)
    }

    emitAttrSet(sink, sinkElVar, attrName, value, foreign, isDeferred)
  }
}

// Optim : `class` et `id` statiques se posent par la propriété native (`className`, `id`), que TOUT
// élément HTML reflète en attribut. Les autres (`placeholder`, `name`, `value`, `title`, `href`…) passent
// par `setAttribute`, comme les pose le mode clone : en propriété, un élément qui ne la reflète pas
// (`<div placeholder>`, balise de composant) restait sans attribut, et `<input value>` sans valeur par
// défaut (`form.reset()` vidait le champ). Seule exception, `value` d'un `<select>` (`selectValue`) : la
// propriété choisit l'option, l'attribut n'existe pas sur ce tag.
// Jamais sur un élément SVG ou MathML (`foreign`) : `className` n'y a qu'un accesseur de
// lecture (écrire lève une TypeError) — `setAttribute` y est le seul geste juste.
function emitAttrSet(
  lines: string[],
  elVar: string,
  attrName: string,
  value: string | null,
  foreign: string | null = null,
  selectValue = false,
): void {
  // sur un élément SVG ou MathML l'attribut prend le nom et l'espace de noms que lui donnerait l'analyseur HTML (le chemin clone) : `viewbox` → `viewBox`, `xlink:href`
  // posé dans l'espace de noms de XLink. `setAttribute` crée un attribut sans espace de noms, que `<use>` ne lit pas : un attribut qui en a un se pose par `setAttributeNS`
  const adj   = adjustAttr(foreign, attrName)
  attrName    = adj.name
  const write = (val: string): string => adj.ns
    ? `${elVar}.setAttributeNS(${JSON.stringify(adj.ns)}, ${JSON.stringify(attrName)}, ${val});`
    : `${elVar}.setAttribute(${JSON.stringify(attrName)}, ${val});`
  if (value === null) {
    // Boolean attr (ex `disabled`, `checked` empty).
    lines.push(write(`''`))
    return
  }
  const hasInterp = value.includes('${')
  // SÉCURITÉ — une valeur INTERPOLÉE (donnée dynamique, souvent
  // distante, ex. branche `{await}`) passe TOUJOURS par `µ._mjs_safeAttr` (filtre
  // javascript:/data:html), prop directe ou setAttribute confondus — comme root
  // (`_mjs_updAttr`) et `{for}` (`_mjs_updAttrNode`) le font déjà. Seule une valeur
  // STATIQUE (jamais de donnée externe) garde le chemin court ci-dessous.
  // `_mjs_safeAttr` seul filtre le XSS mais IGNORE
  // la sémantique PROPS BOOLÉENNES/`value`/`aria-*` de `µ._mjs_updAttrNode` (mjs_element.ts,
  // déjà partagée par root et `{for}`) : `disabled={d.v}` restait POSÉ pour `d.v` faux
  // (stringifié `"false"`, présence d'attribut = désactivé quand même) et `value={d.txt}`
  // sur un `<textarea>` ne posait rien (pas d'attribut `value` en HTML pour ce tag, il
  // faut la PROPRIÉTÉ `.value`). On route désormais par `µ._mjs_updAttrNode` (qui appelle
  // `_mjs_safeAttr` en interne pour le filtre XSS — rien n'est perdu) ; une interpolation NUE
  // (`${ident.membres}`, ex `${_r0}`/`${d.url}`) passe la valeur BRUTE (booléen/null/
  // nombre), pas sa version stringifiée, pour que `_mjs_updAttrNode` voie le vrai type.
  //
  // la reconnaissance "nue"
  // ci-dessus (ex-regex `/^\$\{([\w$.]+)\}$/`) ratait toute expression composée :
  // `disabled={!d.v}`, `disabled={d.list[0]}`, `checked={d.a && d.b}` partaient
  // par le chemin CHAÎNE juste en dessous (stringifiées via un template literal)
  // — `'false'` reste une chaîne NON VIDE, donc vraie pour une prop booléenne,
  // le même bug que le point ci-dessus mais sur des expressions que l'ancienne
  // regex ne couvrait pas. `bareInterpExpr` reconnaît maintenant comme "nue"
  // TOUTE valeur qui n'est QU'UNE SEULE fenêtre `${...}` couvrant sa longueur
  // ENTIÈRE (comptage d'accolades conscient des chaînes internes, cf.
  // `scanInterpWindow`) : le texte de la fenêtre est passé VERBATIM en JS brut
  // — vérifié qu'aucun échappement n'est appliqué à `value` en amont de cette
  // fonction (y compris avec `\` et `` ` `` dans l'expression),
  // donc rien à inverser ; `escapeForTpl` (voir sa JSDoc) ne s'applique QUE
  // quand on émet la forme "chaîne" ci-dessous, jamais à la forme nue.
  if (hasInterp) {
    // la fonction qui pose la valeur cherche l'attribut par son nom qualifié (`setAttribute` retrouve alors celui qui existe, avec son espace de noms) : un attribut qui en a
    // un est déclaré ici, vide, comme le fait pour lui le gabarit de la racine (`xlink:href=''`), et la valeur calculée vient ensuite le remplir
    if (adj.ns) lines.push(write(`''`))
    const bareExpr = bareInterpExpr(value)
    if (bareExpr !== null) {
      lines.push(`µ._mjs_updAttrNode(${elVar}, ${JSON.stringify(attrName)}, (${bareExpr})${attrSur(attrName)});`)
    } else {
      // texte + interpolations mêlés (`class="a ${d.c}"`) ou expression complexe :
      // valeur TOUJOURS une chaîne (jamais false/null) — même choix que root/`{for}`
      // pour une prop booléenne mêlée, une chaîne non vide y reste "vraie".
      // texte fixe décodé : ce chemin ne repasse jamais par l'analyseur HTML (cf. plus bas)
      lines.push(`µ._mjs_updAttrNode(${elVar}, ${JSON.stringify(attrName)}, \`${escapeForTpl(value, true).replace(FERMANTE_SCRIPT_RE, '<\\/$1')}\`${attrSur(attrName)});`)
    }
    return
  }
  // chemin DOM (setAttribute/prop directe, JAMAIS reparsé par le
  // navigateur, contrairement au chemin HTML `staticAttr`) : décode les entités de la
  // valeur STATIQUE ICI, avant `JSON.stringify` — même sémantique que le parseur HTML,
  // pour TOUS les attributs statiques (pas seulement mjs-confirm, cf. escapeVtAttrValue
  // dans transpiler/index.ts, qui pose ces entités pour la forme objet de @confirm).
  value = decodeHtmlEntities(value)
  // `class`, `id` (et `value` d'un `<select>`) : par propriété, cf. plus haut
  if (!foreign && (attrName === 'class' || attrName === 'id' || (selectValue && attrName === 'value'))) {
    const prop = attrName === 'class' ? 'className' : attrName
    lines.push(`${elVar}.${prop} = ${chaineJs(value)};`)
    return
  }
  lines.push(write(chaineJs(value)))
}

// un `</script>` écrit dans une valeur d'attribut part dans une chaîne du JavaScript produit : écrit `<\/script>` (même
// valeur), il ne referme pas la balise <script> d'une page où ce code serait mis en ligne
const FERMANTE_SCRIPT_RE = /<\/(script)/gi

function chaineJs(texte: string): string {
  return JSON.stringify(texte).replace(FERMANTE_SCRIPT_RE, '<\\/$1')
}

/**
 * Échappe une chaîne pour qu'elle puisse être collée dans un template literal.
 * Les `${...}` sont PRESERVÉS (c'est tout l'intérêt) — et surtout jamais rééchappés : le
 * CODE JS qui y vit (ex. `d.replace(/\s/, "_")`) doit ressortir VERBATIM, un antislash de
 * regexp doublé (`/\\s/`) transformant silencieusement l'expression utilisateur. Seul le
 * texte STATIQUE autour des fenêtres `${...}` (qui vient déjà d'un HTML transité par
 * escapeTpl, `\``/`\\`/`\$\{` échappés) a besoin du retrait de double-escape ci-dessous.
 */
// `decode` : `true` pour un attribut, `'texte'` pour un nœud texte (entités historiques sans `;`, cf. decodeHtmlEntities)
function escapeForTpl(s: string, decode: boolean | 'texte' = false): string {
  let out = ''
  let i = 0
  const n = s.length
  // texte statique entre deux fenêtres : entités décodées sur demande (cf. appendTextNode), puis échappé ;
  // un `${` que seul le décodage fait apparaître (`&#36;&#123;`) reste du texte (`\${`)
  const statique = (seg: string): string => (decode ? decodeHtmlEntities(seg, decode === 'texte') : seg).replace(/[\\`]|\$(?=\{)/g, (c) => '\\' + c)
  let debut = 0
  while (i < n) {
    if (s[i] === '$' && s[i + 1] === '{') {
      const close = scanInterpWindow(s, i)
      const end   = close === -1 ? n : close + 1
      out += statique(s.slice(debut, i)) + s.slice(i, end)  // fenêtre ${...} VERBATIM : jamais rééchappée
      i = end
      debut = i
      continue
    }
    i++
  }
  return out + statique(s.slice(debut))
}
