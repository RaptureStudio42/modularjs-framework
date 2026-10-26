// transpiler/a11y — lint d'accessibilité au build (lint.a11y,
// ACTIVÉ PAR DÉFAUT — cf. le point de consommation dans transpiler/index.ts,
// juste après le lint maxStateVars, même famille : simple AVERTISSEMENT
// console, jamais bloquant, jamais une erreur de build).
//
// RÈGLE ZÉRO — avant toute analyse, les zones <pre>…</pre> et <code>…</code>
// (exemples de code montrés dans une doc) sont neutralisées — remplacées par des espaces de même
// longueur, `\n` préservés, pour que les numéros de ligne restent justes. Sans
// ça, un site de documentation qui MONTRE du HTML dans ses exemples reçoit des
// dizaines d'alertes fausses — exactement ce qui fait désactiver un contrôle le
// jour de sa livraison.

import { t } from '../messages/index.js'
import { tagReader } from './tag-reader.js'

// tags non-interactifs qui ne doivent jamais porter un handler @click sans role/tabindex
const NON_INTERACTIVE_TAGS = ['div', 'span', 'li', 'td', 'p', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure']

// types d'<input> jamais affichés comme un champ visible — aucune étiquette à exiger
const INPUT_TYPES_SANS_ETIQUETTE = ['hidden', 'submit', 'button', 'reset', 'image']

// neutralise un bloc (espaces même longueur, `\n` gardés) — les numéros de ligne
// restent justes quel que soit le masque appliqué
function maskBlocks(html: string, re: RegExp): string {
  return html.replace(re, m => m.replace(/[^\n]/g, ' '))
}

const COMMENT_RE = /<!--(?:-?>|[\s\S]*?--!?>)/g
// début d'une balise ouverte : `<` et son nom ; la fin se cherche par le découpage partagé (les accolades `{…}` d'un
// attribut, avec leurs chaînes, gabarits et regex, ne sont pas des valeurs)
const TAG_START_RE = /<[a-z@][^\s>\/]*/gi

// les `<` et `>` des valeurs entre guillemets d'une balise deviennent des espaces, le contenu des accolades aussi (le
// `>` d'une flèche `->` ou d'une comparaison y coupait la balise pour les `[^>]*` des contrôles) — même longueur
function neutralizeValues(attrs: string): string {
  const reader = tagReader(attrs)
  let out      = ''
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i]
    if (c === '"' || c === '\'') {
      const end = attrs.indexOf(c, i + 1)
      if (end === -1) out += c
      else {
        out += c + attrs.slice(i + 1, end).replace(/[<>]/g, ' ') + c
        i = end
      }
    }
    else if (c === '{') {
      const end = reader.braceEnd(i + 1)
      if (end === -1) out += c
      else {
        out += '{' + attrs.slice(i + 1, end).replace(/[^\n]/g, ' ') + '}'
        i = end
      }
    }
    else out += c
  }
  return out
}

// ni un commentaire HTML ni la valeur d'un attribut ne sont du balisage : le commentaire est effacé, et les `<` et
// `>` d'une valeur entre guillemets deviennent des espaces (`data-x="<input>"` n'est pas un champ) — même
// longueur, `\n` gardés, les numéros de ligne restent justes
function neutralizeNonMarkup(html: string): string {
  const texte  = maskBlocks(html, COMMENT_RE)
  const reader = tagReader(texte)
  const re     = new RegExp(TAG_START_RE.source, 'gi')
  let out      = ''
  let since    = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(texte))) {
    const start = m.index + m[0].length
    const end   = reader.tagEnd(start)
    if (end === -1) break
    out   += texte.slice(since, start) + neutralizeValues(texte.slice(start, end))
    since = end
    re.lastIndex = end
  }
  return out + texte.slice(since)
}

const PRE_RE  = /<pre\b[^>]*\/>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi
const CODE_RE = /<code\b[^>]*\/>|<code\b[^>]*>[\s\S]*?<\/code>/gi

// RÈGLE ZÉRO — masque de RECHERCHE DE BALISES : `<pre>` ET `<code>` neutralisés.
// Un site de documentation MONTRE du HTML dans ses exemples : sans ça, il reçoit
// des dizaines d'alertes fausses, exactement ce qui fait désactiver un contrôle
// le jour de sa livraison.
function maskExamples(html: string): string {
  return neutralizeNonMarkup(maskBlocks(maskBlocks(html, PRE_RE), CODE_RE))
}

// masque de CALCUL DU NOM ACCESSIBLE : `<pre>` seul. Mesuré sur le site de doc —
// 90 des 117 alertes du premier jet venaient d'ici : `<a href="…"><code>&lt;@tag&gt;</code></a>`
// est l'idiome le plus fréquent de ces pages, et masquer le `<code>` faisait passer
// un lien parfaitement nommé pour un lien vide. Le texte d'un `<code>` EST le texte
// visible du lien : il compte pour son nom, il ne compte pas comme balise à inspecter
function maskExamplesForName(html: string): string {
  return neutralizeNonMarkup(maskBlocks(html, PRE_RE))
}

// début de chaque ligne de `text` (index du premier caractère), calculé une fois : la ligne d'un index se cherche
// ensuite par dichotomie, sans reparcourir le texte à chaque balise
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

// numéro de ligne (1-based) du caractère à `index` ; `firstLine` : la ligne du fichier où commence le texte (le
// HTML d'un composant est rogné en tête, ses lignes vides ne se comptent plus)
function lineOfIndex(starts: number[], index: number, firstLine = 1): number {
  let low  = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid] <= index) low = mid
    else high = mid - 1
  }
  return firstLine + low
}

// les valeurs entre guillemets vidées (même longueur, guillemets gardés) : le texte de la valeur d'un attribut n'est pas un
// attribut (`placeholder="x aria-label y"` ne porte pas aria-label) — toutes les règles cherchent les noms d'attributs là
function blankValues(attrs: string): string {
  return attrs.replace(/"[^"]*"|'[^']*'/g, m => m[0] + ' '.repeat(m.length - 2) + m[0])
}

// présence d'un attribut, sous TOUTE forme (nu, ="…", ={…}), avec ou sans `@` devant — jamais sa valeur
function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)@?${name}(?=[\\s=/>]|$)`, 'i').test(blankValues(attrs))
}

// l'attribut écrit en valeur littérale, comme le navigateur le lit (name="…", name='…' ou name=… sans guillemets, des blancs permis autour
// de `=`, @name aussi) : la place de son nom dans `attrs` et sa valeur — undefined s'il est absent ou dynamique (={…}) ; le nom se cherche hors
// des valeurs, la valeur se lit à la même place dans le texte d'origine, jusqu'au guillemet qui l'a ouverte (sans guillemets : jusqu'au blanc)
function literalAttr(attrs: string, name: string): { at: number, value: string } | undefined {
  const m = blankValues(attrs).match(new RegExp(`(^|\\s)@?${name}\\s*=\\s*(?:(["'])|(?=[^\\s"'=<>\`{]))`, 'i'))
  if (!m) return undefined
  const start = m.index! + m[0].length
  if (!m[2]) return { at: m.index! + m[1].length, value: /^[^\s"'=<>`]*/.exec(attrs.slice(start))![0] }
  const end = attrs.indexOf(m[2], start)
  return end === -1 ? undefined : { at: m.index! + m[1].length, value: attrs.slice(start, end) }
}

// tabindex lu comme le navigateur lit un entier : blancs de tête sautés, un signe, des chiffres, la suite ignorée — NaN sans chiffre (le
// navigateur ignore alors l'attribut)
function tabIndexOf(value: string | undefined): number {
  const m = /^[\t\n\f\r ]*([-+]?\d+)/.exec(value ?? '')
  return m ? parseInt(m[1], 10) : NaN
}

// valeur littérale de l'attribut (même lecture) — undefined si absente ou dynamique (={…})
function attrValue(attrs: string, name: string): string | undefined {
  return literalAttr(attrs, name)?.value
}

// présence d'un handler @click, avec ou sans modificateurs (@click.propagate…)
function hasClickHandler(attrs: string): boolean {
  return /@click(?:\.[a-z]+)*(?=[\s=/>]|$)/i.test(blankValues(attrs))
}

// présence d'un handler clavier (@keydown/@keyup/@keypress), avec ou sans modificateurs — MÊME
// famille que hasClickHandler ci-dessus (cf. hasJustifyingRole).
function hasKeyboardHandler(attrs: string): boolean {
  return /@key(?:down|up|press)(?:\.[a-z]+)*(?=[\s=/>]|$)/i.test(blankValues(attrs))
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
function hasJustifyingRole(attrs: string): boolean {
  if (!hasAttr(attrs, 'role')) return false
  const role = attrValue(attrs, 'role')
  if (role === undefined || !ROLES_NON_JUSTIFICATIFS.includes(role.toLowerCase())) return true
  return hasKeyboardHandler(attrs)
}

// nom accessible porté par un attribut ARIA/title — aucune des trois = pas de repli
function hasAccessibleNameAttr(attrs: string): boolean {
  return hasAttr(attrs, 'aria-label') || hasAttr(attrs, 'aria-labelledby') || hasAttr(attrs, 'title')
}

// le libellé d'un <@@field> nomme son champ — sauf vide : écrit en clair (`label=""`, que des espaces) ou nu
// (`label` sans valeur), il ne pose aucun aria-label ; un libellé dynamique (`label={…}`) est inconnu au
// build, cru sur parole
function hasNamingLabel(attrs: string): boolean {
  if (!hasAttr(attrs, 'label')) return false
  const valeur = attrValue(attrs, 'label')
  if (valeur !== undefined) return valeur.trim() !== ''
  return /(?:^|\s)@?label\s*=/i.test(blankValues(attrs))
}

// champ caché aux lecteurs d'écran (aria-hidden="true") ET hors du parcours au clavier (tabindex="-1") : personne ne l'atteint, aucune
// étiquette n'y serait lue (l'ancre invisible d'une bulle de validation, le champ piège d'un formulaire contre les robots) ; caché d'un seul
// côté, il garde son alerte : aria-hidden seul sur un champ qu'on atteint au clavier le rend muet, pas inutile. aria-hidden se lit tel quel :
// Firefox ne cache que « true » exact, casse comprise, WebKit que « true » à la casse près (« true » suivi d'une espace, ou « TRUE », y laissent
// le champ à la portée d'un lecteur d'écran) ; tabindex se lit comme un entier, et tout tabindex négatif sort le champ du parcours au clavier
function isOutOfReach(attrs: string): boolean {
  return attrValue(attrs, 'aria-hidden') === 'true' && tabIndexOf(attrValue(attrs, 'tabindex')) < 0
}

// les balises du cœur qui portent une valeur : <@@field> les prend pour un champ, au même titre qu'un <input>
const CORE_INPUTS = 'select|number|checkbox|switch|radio|knob|gauge|editor'
const FIRST_FIELD_RE = new RegExp(`<(input|select|textarea|@@(?:${CORE_INPUTS})|mjs-core-(?:${CORE_INPUTS}))\\b`, 'i')

// texte "visible" du contenu d'un bouton/lien : retire svg/i/img (purement graphiques), puis toute balise, puis les espaces
function accessibleText(inner: string): string {
  return inner
    .replace(/<svg\b[^>]*\/>|<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<i\b[^>]*\/>|<i\b[^>]*>[\s\S]*?<\/i>/gi, '')
    .replace(/<img\b[^>]*\/?>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, '')
}

/**
 * Contrôles d'accessibilité au build — fonction pure, testable seule. Rend la
 * liste des messages d'alerte (déjà traduits, via le catalogue) ; le transpiler
 * (transpiler/index.ts) fait un `console.warn` par message, étiqueté `[lint.a11y]`
 * (comment couper ce contrôle, sans le répéter par composant).
 */
export function checkA11y(html: string, moduleName: string, firstLine = 1): string[] {
  const masked             = maskExamples(html)
  const maskedNom          = maskExamplesForName(html)
  const messages: string[] = []
  // les deux masques gardent les mêmes `\n` : un seul tableau de débuts de ligne
  const starts             = lineStarts(masked)

  // 1. <img> sans alt sous AUCUNE forme (alt="" est VALIDE — image décorative).
  //    `<@@img>`, le module cœur, est traité comme un `<img>` : c'est exactement son
  //    rôle, et il serait absurde qu'il échappe au contrôle que la balise native subit
  for (const m of masked.matchAll(/<(?:img|@@img)\b([^>]*)>/gi)) {
    if (!hasAttr(m[1], 'alt')) messages.push(t('transpiler.a11y-img-alt-manquant', { moduleName, ligne: lineOfIndex(starts, m.index!, firstLine) }))
  }

  // 2. <iframe> sans title
  for (const m of masked.matchAll(/<iframe\b([^>]*)>/gi)) {
    if (!hasAttr(m[1], 'title')) messages.push(t('transpiler.a11y-iframe-title-manquant', { moduleName, ligne: lineOfIndex(starts, m.index!, firstLine) }))
  }

  // 3. tabindex positif (0 et -1 sont légitimes), parmi les vrais attributs de chaque balise ; une balise s'arrête au `<` suivant (les valeurs
  //    n'en ont plus) : un `<` jamais refermé ne fait pas relire tout le reste du texte
  for (const m of masked.matchAll(/<([a-z@][^\s<>\/]*)([^<>]*)>/gi)) {
    const tab = literalAttr(m[2], 'tabindex')
    if (tab && tabIndexOf(tab.value) > 0) messages.push(t('transpiler.a11y-tabindex-positif', { moduleName, ligne: lineOfIndex(starts, m.index! + 1 + m[1].length + tab.at, firstLine), valeur: tab.value }))
  }

  // 4. @click sur un tag non interactif, sans role ni tabindex
  const nonInteractiveRe = new RegExp(`<(${NON_INTERACTIVE_TAGS.join('|')})\\b([^>]*)>`, 'gi')
  for (const m of masked.matchAll(nonInteractiveRe)) {
    const [, tag, attrs] = m
    if (hasClickHandler(attrs) && !hasJustifyingRole(attrs) && !hasAttr(attrs, 'tabindex')) {
      messages.push(t('transpiler.a11y-click-non-interactif', { moduleName, ligne: lineOfIndex(starts, m.index!, firstLine), tag }))
    }
  }

  // 5. <button> sans nom accessible (contenu vide une fois les éléments graphiques retirés)
  for (const m of maskedNom.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const [, attrs, inner] = m
    if (!hasAccessibleNameAttr(attrs) && accessibleText(inner) === '') {
      messages.push(t('transpiler.a11y-bouton-nom-manquant', { moduleName, ligne: lineOfIndex(starts, m.index!, firstLine) }))
    }
  }

  // 6. <a> sans nom accessible — même règle que 5
  for (const m of maskedNom.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const [, attrs, inner] = m
    if (!hasAccessibleNameAttr(attrs) && accessibleText(inner) === '') {
      messages.push(t('transpiler.a11y-lien-nom-manquant', { moduleName, ligne: lineOfIndex(starts, m.index!, firstLine) }))
    }
  }

  // 7. champ de saisie sans étiquette — input (hors types sans étiquette)/select/textarea
  const hasAnyLabel = /<label\b/i.test(masked)
  // un champ dans un <@@field label="…"> est nommé par lui (le libellé posé en aria-label à l'exécution) :
  // le premier champ seulement — input, select, textarea ou composant de saisie du cœur, comme le module ; un
  // second champ garde son alerte, et un composant du cœur en tête prend le nom que l'<input> suivant n'aura pas —
  // et jamais avec un libellé vide ou nu
  const nommes = new Set<number>()
  for (const m of masked.matchAll(/<(@@field|mjs-core-field)\b([^>]*)>[\s\S]*?<\/\1>/gi)) {
    if (!hasNamingLabel(m[2])) continue
    const bodyStart = 2 + m[1].length + m[2].length
    const first     = FIRST_FIELD_RE.exec(m[0].slice(bodyStart))
    if (first && /^(?:input|select|textarea)$/i.test(first[1])) nommes.add(m.index! + bodyStart + first.index)
  }
  // les `for` littéraux des <label> du gabarit, lus parmi leurs vrais attributs ; comparés à l'`id` à la lettre près, majuscules comprises,
  // comme le navigateur (`for="Nom"` ne désigne pas `id="nom"`)
  const labelFors = Array.from(masked.matchAll(/<label\b([^>]*)>/gi), l => attrValue(l[1], 'for'))
  const checkField = (tag: string, attrs: string, index: number): void => {
    if (hasAccessibleNameAttr(attrs) || nommes.has(index) || isOutOfReach(attrs)) return
    const id = attrValue(attrs, 'id')
    if (id !== undefined) {
      // a. id littéral : il faut un <label for="id"> quelque part dans le gabarit
      if (!labelFors.includes(id)) messages.push(t('transpiler.a11y-champ-etiquette-manquante', { moduleName, ligne: lineOfIndex(starts, index, firstLine), tag }))
    }
    else if (!hasAttr(attrs, 'id')) {
      // b. aucun id (même dynamique) : il faut au moins un <label> quelque part
      if (!hasAnyLabel) messages.push(t('transpiler.a11y-champ-etiquette-manquante', { moduleName, ligne: lineOfIndex(starts, index, firstLine), tag }))
    }
    // sinon (id dynamique ={…}) : on se tait, aucun des deux cas fiables ne s'applique
  }
  for (const m of masked.matchAll(/<input\b([^>]*)>/gi)) {
    const type = attrValue(m[1], 'type')
    if (type && INPUT_TYPES_SANS_ETIQUETTE.includes(type.toLowerCase())) continue
    checkField('input', m[1], m.index!)
  }
  for (const m of masked.matchAll(/<select\b([^>]*)>[\s\S]*?<\/select>/gi)) checkField('select', m[1], m.index!)
  for (const m of masked.matchAll(/<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi)) checkField('textarea', m[1], m.index!)

  return messages
}
