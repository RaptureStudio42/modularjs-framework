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
import type { Balise, Noeud } from '../reader/index.js'
import { attributDe, balisesDe, gabaritLu, ligneDe, nomDe, valeurDe } from './template-tree.js'

// tags non-interactifs qui ne doivent jamais porter un handler @click sans role/tabindex
const NON_INTERACTIVE_TAGS = ['div', 'span', 'li', 'td', 'p', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure']

// types d'<input> jamais affichés comme un champ visible — aucune étiquette à exiger
const INPUT_TYPES_SANS_ETIQUETTE = ['hidden', 'submit', 'button', 'reset', 'image']

// RÈGLE ZÉRO — recherche des balises : ni le contenu d'un <pre>, ni celui d'un <code>
const EXEMPLES = new Set(['pre', 'code'])

// calcul du nom accessible : <pre> seul. Mesuré sur le site de doc — 90 des 117 alertes du premier jet venaient
// d'ici : `<a href="…"><code>&lt;@tag&gt;</code></a>` est l'idiome le plus fréquent de ces pages, et sauter le
// `<code>` faisait passer un lien parfaitement nommé pour un lien vide. Le texte d'un `<code>` EST le texte visible
// du lien : il compte pour son nom, il ne compte pas comme balise à inspecter
const EXEMPLES_NOM = new Set(['pre'])

// éléments purement graphiques : leur contenu ne nomme ni un bouton ni un lien
const GRAPHIQUES = new Set(['svg', 'i', 'img'])

// tabindex lu comme le navigateur lit un entier : blancs de tête sautés, un signe, des chiffres, la suite ignorée — NaN sans chiffre (le
// navigateur ignore alors l'attribut)
function tabIndexOf(value: string | undefined): number {
  const m = /^[\t\n\f\r ]*([-+]?\d+)/.exec(value ?? '')
  return m ? parseInt(m[1], 10) : NaN
}

// présence d'un attribut, sous TOUTE forme (nu, ="…", ={…}), avec ou sans `@` devant — jamais sa valeur
function hasAttr(b: Balise, name: string): boolean {
  return attributDe(b, name) !== undefined
}

// présence d'un handler @click, avec ou sans modificateurs (@click.propagate…)
function hasClickHandler(b: Balise): boolean {
  return b.attributs.some(a => a.nom !== null && /@click(?:\.[a-z]+)*$/i.test(a.nom))
}

// présence d'un handler clavier (@keydown/@keyup/@keypress), avec ou sans modificateurs — MÊME
// famille que hasClickHandler ci-dessus (cf. hasJustifyingRole).
function hasKeyboardHandler(b: Balise): boolean {
  return b.attributs.some(a => a.nom !== null && /@key(?:down|up|press)(?:\.[a-z]+)*$/i.test(a.nom))
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
const ROLES_NON_JUSTIFICATIFS = ['presentation', 'none']
function hasJustifyingRole(src: string, b: Balise): boolean {
  const attr = attributDe(b, 'role')
  if (attr === undefined) return false
  const role = valeurDe(src, attr)
  if (role === undefined || !ROLES_NON_JUSTIFICATIFS.includes(role.toLowerCase())) return true
  return hasKeyboardHandler(b)
}

// nom accessible porté par un attribut ARIA/title — aucune des trois = pas de repli
function hasAccessibleNameAttr(b: Balise): boolean {
  return hasAttr(b, 'aria-label') || hasAttr(b, 'aria-labelledby') || hasAttr(b, 'title')
}

// le libellé d'un <@@field> nomme son champ — sauf vide : écrit en clair (`label=""`, que des espaces) ou nu
// (`label` sans valeur), il ne pose aucun aria-label ; un libellé dynamique (`label={…}`) est inconnu au
// build, cru sur parole
function hasNamingLabel(src: string, b: Balise): boolean {
  const attr = attributDe(b, 'label')
  if (attr === undefined) return false
  const valeur = valeurDe(src, attr)
  if (valeur !== undefined) return valeur.trim() !== ''
  return attr.valeur !== null
}

// champ caché aux lecteurs d'écran (aria-hidden="true") ET hors du parcours au clavier (tabindex="-1") : personne ne l'atteint, aucune
// étiquette n'y serait lue (l'ancre invisible d'une bulle de validation, le champ piège d'un formulaire contre les robots) ; caché d'un seul
// côté, il garde son alerte : aria-hidden seul sur un champ qu'on atteint au clavier le rend muet, pas inutile. aria-hidden se lit tel quel :
// Firefox ne cache que « true » exact, casse comprise, WebKit que « true » à la casse près (« true » suivi d'une espace, ou « TRUE », y laissent
// le champ à la portée d'un lecteur d'écran) ; tabindex se lit comme un entier, et tout tabindex négatif sort le champ du parcours au clavier
function isOutOfReach(src: string, b: Balise): boolean {
  return valeurDe(src, attributDe(b, 'aria-hidden')) === 'true' && tabIndexOf(valeurDe(src, attributDe(b, 'tabindex'))) < 0
}

// les balises du cœur qui portent une valeur : <@@field> les prend pour un champ, au même titre qu'un <input>
const CORE_INPUTS   = ['select', 'number', 'checkbox', 'switch', 'radio', 'knob', 'gauge', 'editor']
const NATIVE_FIELDS = new Set(['input', 'select', 'textarea'])
const FIELDS        = new Set([...NATIVE_FIELDS, ...CORE_INPUTS.flatMap(n => ['@@' + n, 'mjs-core-' + n])])

// le contenu d'un bouton ou d'un lien porte-t-il un texte visible ? Les éléments graphiques (svg, i, img) ne comptent
// pas ; le texte des autres balises compte, une expression `{…}` ou un bloc `{if …}` aussi (leur texte s'écrit à
// l'exécution) ; un commentaire HTML, jamais
function hasVisibleText(src: string, noeuds: Noeud[]): boolean {
  const pile = [...noeuds].reverse()
  while (pile.length > 0) {
    const n = pile.pop()!
    if (n.sorte === 'expression' || n.sorte === 'bloc') return true
    if (n.sorte === 'texte' && /\S/.test(src.slice(n.debut, n.fin))) return true
    if (n.sorte === 'balise' && !GRAPHIQUES.has(nomDe(n))) for (let k = n.enfants.length - 1; k >= 0; k--) pile.push(n.enfants[k])
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
export function checkA11y(html: string, moduleName: string, firstLine: number | ((k: number) => number | string) = 1, dialecte = true): string[] {
  const arbre              = gabaritLu(html, dialecte)
  const src                = arbre.source
  const balises            = balisesDe(arbre.enfants, EXEMPLES)
  const messages: string[] = []
  const ligne              = (index: number): number | string => (typeof firstLine === 'number' ? ligneDe(arbre, index, firstLine) : firstLine(ligneDe(arbre, index, 0)))
  const nommees            = (nom: string): Balise[] => balises.filter(b => nomDe(b) === nom)

  // 1. <img> sans alt sous AUCUNE forme (alt="" est VALIDE — image décorative).
  //    `<@@img>`, le module cœur, est traité comme un `<img>` : c'est exactement son
  //    rôle, et il serait absurde qu'il échappe au contrôle que la balise native subit
  for (const b of balises) {
    if ((nomDe(b) === 'img' || nomDe(b) === '@@img') && !hasAttr(b, 'alt')) messages.push(t('transpiler.a11y-img-alt-manquant', { moduleName, ligne: ligne(b.debut) }))
  }

  // 2. <iframe> sans title
  for (const b of nommees('iframe')) {
    if (!hasAttr(b, 'title')) messages.push(t('transpiler.a11y-iframe-title-manquant', { moduleName, ligne: ligne(b.debut) }))
  }

  // 3. tabindex positif (0 et -1 sont légitimes), écrit en clair, sur toute balise ; la ligne est celle de l'attribut
  for (const b of balises) {
    const attr  = attributDe(b, 'tabindex')
    const value = valeurDe(src, attr)
    if (attr && value !== undefined && tabIndexOf(value) > 0) messages.push(t('transpiler.a11y-tabindex-positif', { moduleName, ligne: ligne(attr.debut), valeur: value }))
  }

  // 4. @click sur un tag non interactif, sans role ni tabindex
  for (const b of balises) {
    if (NON_INTERACTIVE_TAGS.includes(nomDe(b)) && hasClickHandler(b) && !hasJustifyingRole(src, b) && !hasAttr(b, 'tabindex')) {
      messages.push(t('transpiler.a11y-click-non-interactif', { moduleName, ligne: ligne(b.debut), tag: b.nom }))
    }
  }

  // 5. <button> et 6. <a> sans nom accessible (contenu vide une fois les éléments graphiques retirés)
  const nommables = balisesDe(arbre.enfants, EXEMPLES_NOM)
  for (const [tag, cle] of [['button', 'transpiler.a11y-bouton-nom-manquant'], ['a', 'transpiler.a11y-lien-nom-manquant']] as const) {
    for (const b of nommables) {
      if (nomDe(b) === tag && !hasAccessibleNameAttr(b) && !hasVisibleText(src, b.enfants)) messages.push(t(cle, { moduleName, ligne: ligne(b.debut) }))
    }
  }

  // 7. champ de saisie sans étiquette — input (hors types sans étiquette)/select/textarea
  const labels = nommees('label')
  // un champ dans un <@@field label="…"> est nommé par lui (le libellé posé en aria-label à l'exécution) :
  // le premier champ seulement — input, select, textarea ou composant de saisie du cœur, comme le module ; un
  // second champ garde son alerte, et un composant du cœur en tête prend le nom que l'<input> suivant n'aura pas —
  // et jamais avec un libellé vide ou nu
  const named = new Set<Balise>()
  for (const b of balises) {
    if ((nomDe(b) !== '@@field' && nomDe(b) !== 'mjs-core-field') || !hasNamingLabel(src, b)) continue
    const first = balisesDe(b.enfants, EXEMPLES).find(c => FIELDS.has(nomDe(c)))
    if (first && NATIVE_FIELDS.has(nomDe(first))) named.add(first)
  }
  // les `for` littéraux des <label> du gabarit ; comparés à l'`id` à la lettre près, majuscules comprises,
  // comme le navigateur (`for="Nom"` ne désigne pas `id="nom"`)
  const labelFors  = labels.map(l => valeurDe(src, attributDe(l, 'for')))
  const checkField = (tag: string, b: Balise): void => {
    if (hasAccessibleNameAttr(b) || named.has(b) || isOutOfReach(src, b)) return
    const id = valeurDe(src, attributDe(b, 'id'))
    if (id !== undefined) {
      // a. id littéral : il faut un <label for="id"> quelque part dans le gabarit
      if (!labelFors.includes(id)) messages.push(t('transpiler.a11y-champ-etiquette-manquante', { moduleName, ligne: ligne(b.debut), tag }))
    }
    else if (!hasAttr(b, 'id')) {
      // b. aucun id (même dynamique) : il faut au moins un <label> quelque part
      if (labels.length === 0) messages.push(t('transpiler.a11y-champ-etiquette-manquante', { moduleName, ligne: ligne(b.debut), tag }))
    }
    // sinon (id dynamique ={…}) : on se tait, aucun des deux cas fiables ne s'applique
  }
  for (const b of nommees('input')) {
    const type = valeurDe(src, attributDe(b, 'type'))
    if (type && INPUT_TYPES_SANS_ETIQUETTE.includes(type.toLowerCase())) continue
    checkField('input', b)
  }
  for (const b of nommees('select')) checkField('select', b)
  for (const b of nommees('textarea')) checkField('textarea', b)

  return messages
}
