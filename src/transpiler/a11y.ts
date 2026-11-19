// transpiler/a11y — lint d'accessibilité au build (lint.a11y,
// ACTIVÉ PAR DÉFAUT — cf. le point de consommation dans transpiler/index.ts,
// juste après le lint maxStateVars, même famille : simple AVERTISSEMENT
// console, jamais bloquant, jamais une erreur de build).
//
// Le gabarit est lu par le lecteur unique (template-tree.ts) : chaque contrôle est une requête sur ses balises et
// leurs attributs. Un commentaire HTML, la valeur d'un attribut, une chaîne d'une expression `{…}` ou le texte d'un
// <textarea> ne sont pas du balisage.
//
// RÈGLE ZÉRO — le contenu d'un <pre> ou d'un <code> (exemples de code montrés dans une doc) n'est pas contrôlé. Sans
// ça, un site de documentation qui MONTRE du HTML dans ses exemples reçoit des dizaines d'alertes fausses —
// exactement ce qui fait désactiver un contrôle le jour de sa livraison.

import { t } from '../messages/index.js'
import type { Tag, Node } from '../reader/index.js'
import { attrOf, tagsOf, readTemplate, lineOf, nameOf, valueOf } from './template-tree.js'

// tags non-interactifs qui ne doivent jamais porter un handler @click sans role/tabindex
const NON_INTERACTIVE_TAGS = ['div', 'span', 'li', 'td', 'p', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure']

// types d'<input> jamais affichés comme un champ visible — aucune étiquette à exiger
const INPUT_TYPES_NO_LABEL = ['hidden', 'submit', 'button', 'reset', 'image']

// RÈGLE ZÉRO — recherche des balises : ni le contenu d'un <pre>, ni celui d'un <code>
const EXAMPLES = new Set(['pre', 'code'])

// calcul du nom accessible : <pre> seul. Mesuré sur le site de doc — 90 des 117 alertes du premier jet venaient
// d'ici : `<a href="…"><code>&lt;@tag&gt;</code></a>` est l'idiome le plus fréquent de ces pages, et sauter le
// `<code>` faisait passer un lien parfaitement nommé pour un lien vide. Le texte d'un `<code>` EST le texte visible
// du lien : il compte pour son nom, il ne compte pas comme balise à inspecter
const NAMED_EXAMPLES = new Set(['pre'])

// éléments purement graphiques : leur contenu ne nomme ni un bouton ni un lien
const GRAPHICS = new Set(['svg', 'i', 'img'])

// tabindex lu comme le navigateur lit un entier : blancs de tête sautés, un signe, des chiffres, la suite ignorée — NaN sans chiffre (le
// navigateur ignore alors l'attribut)
function tabIndexOf(value: string | undefined): number {
  const m = /^[\t\n\f\r ]*([-+]?\d+)/.exec(value ?? '')
  return m ? parseInt(m[1], 10) : NaN
}

// présence d'un attribut, sous TOUTE forme (nu, ="…", ={…}), avec ou sans `@` devant — jamais sa valeur
function hasAttr(b: Tag, name: string): boolean {
  return attrOf(b, name) !== undefined
}

// présence d'un handler @click, avec ou sans modificateurs (@click.propagate…)
function hasClickHandler(b: Tag): boolean {
  return b.attrs.some(a => a.name !== null && /@click(?:\.[a-z]+)*$/i.test(a.name))
}

// présence d'un handler clavier (@keydown/@keyup/@keypress), avec ou sans modificateurs — MÊME
// famille que hasClickHandler ci-dessus (cf. hasJustifyingRole).
function hasKeyboardHandler(b: Tag): boolean {
  return b.attrs.some(a => a.name !== null && /@key(?:down|up|press)(?:\.[a-z]+)*$/i.test(a.name))
}

// role="presentation"/"none" retire EXPLICITEMENT la sémantique de
// l'élément (il ne le rend PAS interactif/focusable) : ces deux valeurs ne justifient jamais un
// handler @click sur un tag non interactif — un rôle dynamique (`role={…}`) ou toute AUTRE
// valeur littérale reste, lui, une justification valable (comportement inchangé).
// Pour éviter une régression déjà rencontrée — `presentation`/`none`
// SEUL reste non-justifiant, mais un écouteur clavier sur le MÊME élément rend l'élément
// opérable au clavier : motif ARIA standard de fond de modale (role="presentation" +
// @click.self + @keydown) —
// sans lui, une div qui EST déjà accessible au clavier recevait une fausse alerte.
const NON_JUSTIFYING_ROLES = ['presentation', 'none']
function hasJustifyingRole(src: string, b: Tag): boolean {
  const attr = attrOf(b, 'role')
  if (attr === undefined) return false
  const role = valueOf(src, attr)
  if (role === undefined || !NON_JUSTIFYING_ROLES.includes(role.toLowerCase())) return true
  return hasKeyboardHandler(b)
}

// nom accessible porté par un attribut ARIA/title — aucune des trois = pas de repli
function hasAccessibleNameAttr(b: Tag): boolean {
  return hasAttr(b, 'aria-label') || hasAttr(b, 'aria-labelledby') || hasAttr(b, 'title')
}

// le libellé d'un <@@field> nomme son champ — sauf vide : écrit en clair (`label=""`, que des espaces) ou nu
// (`label` sans valeur), il ne pose aucun aria-label ; un libellé dynamique (`label={…}`) est inconnu au
// build, cru sur parole
function hasNamingLabel(src: string, b: Tag): boolean {
  const attr = attrOf(b, 'label')
  if (attr === undefined) return false
  const value = valueOf(src, attr)
  if (value !== undefined) return value.trim() !== ''
  return attr.value !== null
}

// champ caché aux lecteurs d'écran (aria-hidden="true") ET hors du parcours au clavier (tabindex="-1") : personne ne l'atteint, aucune
// étiquette n'y serait lue (l'ancre invisible d'une bulle de validation, le champ piège d'un formulaire contre les robots) ; caché d'un seul
// côté, il garde son alerte : aria-hidden seul sur un champ qu'on atteint au clavier le rend muet, pas inutile. aria-hidden se lit tel quel :
// Firefox ne cache que « true » exact, casse comprise, WebKit que « true » à la casse près (« true » suivi d'une espace, ou « TRUE », y laissent
// le champ à la portée d'un lecteur d'écran) ; tabindex se lit comme un entier, et tout tabindex négatif sort le champ du parcours au clavier
function isOutOfReach(src: string, b: Tag): boolean {
  return valueOf(src, attrOf(b, 'aria-hidden')) === 'true' && tabIndexOf(valueOf(src, attrOf(b, 'tabindex'))) < 0
}

// les balises du cœur qui portent une valeur : <@@field> les prend pour un champ, au même titre qu'un <input>
const CORE_INPUTS   = ['select', 'number', 'checkbox', 'switch', 'radio', 'knob', 'gauge', 'editor']
const NATIVE_FIELDS = new Set(['input', 'select', 'textarea'])
const FIELDS        = new Set([...NATIVE_FIELDS, ...CORE_INPUTS.flatMap(n => ['@@' + n, 'mjs-core-' + n])])

// le contenu d'un bouton ou d'un lien porte-t-il un texte visible ? Les éléments graphiques (svg, i, img) ne comptent
// pas ; le texte des autres balises compte, une expression `{…}` ou un bloc `{if …}` aussi (leur texte s'écrit à
// l'exécution) ; un commentaire HTML, jamais
function hasVisibleText(src: string, nodes: Node[]): boolean {
  const stack = [...nodes].reverse()
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.kind === 'expression' || n.kind === 'block') return true
    if (n.kind === 'text' && /\S/.test(src.slice(n.start, n.end))) return true
    if (n.kind === 'tag' && !GRAPHICS.has(nameOf(n))) for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k])
  }
  return false
}

/**
 * Contrôles d'accessibilité au build — fonction pure, testable seule. Rend la
 * liste des messages d'alerte (déjà traduits, via le catalogue) ; le transpiler
 * (transpiler/index.ts) fait un `console.warn` par message, étiqueté `[lint.a11y]`
 * (comment couper ce contrôle, sans le répéter par composant). `dialecte` : false pour un gabarit `js`, lu sans le
 * dialecte de Civet, comme par le compilateur.
 */
// `firstLine` : la ligne du fichier où commence le HTML, ou la ligne citée de sa ligne k (0 : la première), quand des partiels y sont versés
export function checkA11y(html: string, moduleName: string, firstLine: number | ((k: number) => number | string) = 1, dialect = true): string[] {
  const tree               = readTemplate(html, dialect)
  const src                = tree.source
  const tags               = tagsOf(tree.children, EXAMPLES)
  const messages: string[] = []
  const line               = (index: number): number | string => (typeof firstLine === 'number' ? lineOf(tree, index, firstLine) : firstLine(lineOf(tree, index, 0)))
  const tagsNamed          = (name: string): Tag[] => tags.filter(b => nameOf(b) === name)

  // 1. <img> sans alt sous AUCUNE forme (alt="" est VALIDE — image décorative).
  //    `<@@img>`, le module cœur, est traité comme un `<img>` : c'est exactement son
  //    rôle, et il serait absurde qu'il échappe au contrôle que la balise native subit
  for (const b of tags) {
    if ((nameOf(b) === 'img' || nameOf(b) === '@@img') && !hasAttr(b, 'alt')) messages.push(t('transpiler.a11y-img-alt-missing', { moduleName, line: line(b.start) }))
  }

  // 2. <iframe> sans title
  for (const b of tagsNamed('iframe')) {
    if (!hasAttr(b, 'title')) messages.push(t('transpiler.a11y-iframe-title-missing', { moduleName, line: line(b.start) }))
  }

  // 3. tabindex positif (0 et -1 sont légitimes), écrit en clair, sur toute balise ; la ligne est celle de l'attribut
  for (const b of tags) {
    const attr  = attrOf(b, 'tabindex')
    const value = valueOf(src, attr)
    if (attr && value !== undefined && tabIndexOf(value) > 0) messages.push(t('transpiler.a11y-tabindex-positive', { moduleName, line: line(attr.start), value }))
  }

  // 4. @click sur un tag non interactif, sans role ni tabindex
  for (const b of tags) {
    if (NON_INTERACTIVE_TAGS.includes(nameOf(b)) && hasClickHandler(b) && !hasJustifyingRole(src, b) && !hasAttr(b, 'tabindex')) {
      messages.push(t('transpiler.a11y-click-not-interactive', { moduleName, line: line(b.start), tag: b.name }))
    }
  }

  // 5. <button> et 6. <a> sans nom accessible (contenu vide une fois les éléments graphiques retirés)
  const nommables = tagsOf(tree.children, NAMED_EXAMPLES)
  for (const [tag, key] of [['button', 'transpiler.a11y-button-name-missing'], ['a', 'transpiler.a11y-link-name-missing']] as const) {
    for (const b of nommables) {
      if (nameOf(b) === tag && !hasAccessibleNameAttr(b) && !hasVisibleText(src, b.children)) messages.push(t(key, { moduleName, line: line(b.start) }))
    }
  }

  // 7. champ de saisie sans étiquette — input (hors types sans étiquette)/select/textarea
  const labels = tagsNamed('label')
  // un champ dans un <@@field label="…"> est nommé par lui (le libellé posé en aria-label à l'exécution) :
  // le premier champ seulement — input, select, textarea ou composant de saisie du cœur, comme le module ; un
  // second champ garde son alerte, et un composant du cœur en tête prend le nom que l'<input> suivant n'aura pas —
  // et jamais avec un libellé vide ou nu
  const named = new Set<Tag>()
  for (const b of tags) {
    if ((nameOf(b) !== '@@field' && nameOf(b) !== 'mjs-core-field') || !hasNamingLabel(src, b)) continue
    const first = tagsOf(b.children, EXAMPLES).find(c => FIELDS.has(nameOf(c)))
    if (first && NATIVE_FIELDS.has(nameOf(first))) named.add(first)
  }
  // les `for` littéraux des <label> du gabarit ; comparés à l'`id` à la lettre près, majuscules comprises,
  // comme le navigateur (`for="Nom"` ne désigne pas `id="nom"`)
  const labelFors  = labels.map(l => valueOf(src, attrOf(l, 'for')))
  const checkField = (tag: string, b: Tag): void => {
    if (hasAccessibleNameAttr(b) || named.has(b) || isOutOfReach(src, b)) return
    const id = valueOf(src, attrOf(b, 'id'))
    if (id !== undefined) {
      // a. id littéral : il faut un <label for="id"> quelque part dans le gabarit
      if (!labelFors.includes(id)) messages.push(t('transpiler.a11y-field-label-missing', { moduleName, line: line(b.start), tag }))
    }
    else if (!hasAttr(b, 'id')) {
      // b. aucun id (même dynamique) : il faut au moins un <label> quelque part
      if (labels.length === 0) messages.push(t('transpiler.a11y-field-label-missing', { moduleName, line: line(b.start), tag }))
    }
    // sinon (id dynamique ={…}) : on se tait, aucun des deux cas fiables ne s'applique
  }
  for (const b of tagsNamed('input')) {
    const type = valueOf(src, attrOf(b, 'type'))
    if (type && INPUT_TYPES_NO_LABEL.includes(type.toLowerCase())) continue
    checkField('input', b)
  }
  for (const b of tagsNamed('select')) checkField('select', b)
  for (const b of tagsNamed('textarea')) checkField('textarea', b)

  return messages
}
