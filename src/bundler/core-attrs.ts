// bundler/core-attrs — un attribut écrit en dur sur la balise d'un module du cœur (`<@@x …>` ou `<mjs-core-x …>`) qui est l'écriture
// camelCase d'une prop du module arrête la construction, qui donne l'écriture à tirets : les attributs des modules du cœur n'en ont qu'une,
// celle de leur documentation. Ce n'est pas une panne évitée : le HTML met les noms d'attributs en minuscules (`emptyLabel="Rien"` arrive en
// `emptylabel`) et le module le recevrait sous son nom, comme toute prop déclarée d'un composant. Une valeur liée (`emptyLabel={$x}`) passe
// par le code et garde sa casse : permise. Les props se lisent dans les sources du module ; dans le doute, rien.
// tests/modules-coeur-attribut-camelcase-construction.test.ts

import type { TagRefAttrs } from '../parser/index.js'
import { t } from '../messages/index.js'

/** une valeur écrite d'emblée : un texte, un nombre, un booléen, null, undefined, un tableau ou un objet écrit sur la ligne */
const LITERAL = /^(?:'[^']*'|"[^"]*"|-?\d[\d_.]*(?:e-?\d+)?|true|false|null|undefined|\[.*\]|\{.*\})$/

/** les attributs natifs que l'habitude de JSX écrit en camelCase (`tabIndex`) : le navigateur les lit en minuscules, ils marchent */
const NATIVE = new Set(['tabindex', 'contenteditable', 'spellcheck', 'autofocus', 'autocomplete', 'autocapitalize', 'accesskey', 'enterkeyhint', 'inputmode', 'readonly', 'maxlength', 'minlength', 'novalidate', 'crossorigin', 'referrerpolicy', 'popovertarget', 'itemprop', 'itemscope', 'itemtype'])

/**
 * Les props en camelCase d'un module du cœur, lues dans sa source : les variables `$fooBar` de son script d'instance et de son gabarit
 * (script de module, style et lignes de commentaire ôtés), sauf celles qu'il calcule lui-même au premier niveau (`$labelText = $label ?? …`)
 * — une prop posée d'emblée par une valeur (`$okLabel = ''`), ou lue sans être posée (`$otherLabel`).
 */
export function coreCamelProps(source: string): string[] {
  const code     = source.replace(/<script module>[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const computed = new Set<string>()
  for (const m of code.matchAll(/^ {2}\$([a-z]\w*)\s*=(?!=)[ \t]*(.*)$/gm)) {
    if (!LITERAL.test(m[2].replace(/\s+#.*$/, '').trim())) computed.add(m[1])
  }
  const names = new Set<string>()
  for (const m of code.matchAll(/(?<![\w$])\$([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)/g)) {
    if (!computed.has(m[1]) && !NATIVE.has(m[1].toLowerCase())) names.add(m[1])
  }
  return [...names].sort()
}

/**
 * Les fautes d'une référence à un module du cœur, un message par attribut : un attribut écrit en texte (`emptyLabel="Rien"`, ou sans
 * valeur) qui est l'écriture camelCase d'une de ses props (`props`, cf. coreCamelProps). Une valeur liée (`{…}`) passe ; un texte
 * interpolé aussi, que le relevé des attributs ne distingue pas d'une liaison à deux sens (`!{…}`).
 */
export function camelAttrProblems(ref: { file: string, kind: string, name: string, attrs?: TagRefAttrs }, props: readonly string[]): string[] {
  const attrs = ref.attrs
  if (!attrs?.texts || props.length === 0) return []
  const tag = ref.kind === 'litteral-coeur' ? `mjs-core-${ref.name}` : `@@${ref.name}`
  const out: string[] = []
  for (const name of attrs.names) {
    if (!props.includes(name) || typeof attrs.texts[name.toLowerCase()] !== 'string') continue
    out.push(t('bundler.index.coeur-attribut-camel', { fichier: ref.file, tag, attribut: name, kebab: name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), minuscules: name.toLowerCase() }))
  }
  return out
}
