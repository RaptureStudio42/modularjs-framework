// transpiler/ujs-form — lint « <form> sans action ni méthode, intercepté quand même
// par UJS » (lint.ujsForm : le contrat « UJS intercepte
// TOUT <form> » reste entier, mais avec un avertissement). Cf. le point de
// consommation dans transpiler/index.ts, juste après le lint a11y, même famille :
// simple AVERTISSEMENT console, jamais bloquant, jamais une erreur de build.
//
// Un `@submit.prevent` retient l'envoi : la navigation lit la soumission à la REMONTÉE, une fois
// les gestionnaires du composant joués (src/runtime/mjs_ujs.ts, µ._mjs_ujsShadowAttach), comme pour
// un lien — le formulaire est alors local, rien à signaler.
//
// Le gabarit est lu par le lecteur unique (template-tree.ts) : seuls les noms des attributs d'une vraie balise <form>
// se lisent. Un mot écrit dans un `title="… action …"`, dans une expression ou dans un commentaire n'est pas une directive.
//
// RÈGLE ZÉRO — même motif que transpiler/a11y.ts : le contenu d'un <pre> ou d'un <code> n'est pas lu. Sans ça, le site
// de doc — qui MONTRE des <form> en exemple — reçoit des dizaines de fausses alertes.

import { SIGN_RE } from '../parser/mjs-words.js'
import { t } from '../messages/index.js'
import type { Tag } from '../reader/index.js'
import { attrOf, tagsOf, readTemplate, lineOf, nameOf, valueOf } from './template-tree.js'

// RÈGLE ZÉRO — ni le contenu d'un <pre>, ni celui d'un <code>
const EXAMPLES = new Set(['pre', 'code'])

// action="…" (littérale non vide) ou action={…} (dynamique) — action="" compte comme
// ABSENTE : c'est exactement le piège, le navigateur y remet l'URL courante ; des blancs autour du `=`
// (`action = ""`) n'y changent rien
function hasAction(src: string, b: Tag): boolean {
  const attr = attrOf(b, 'action')
  if (attr === undefined) return false
  return attr.value !== 'text' || valueOf(src, attr) !== ''
}

// verbe HTTP déclaré : :method (mot de MJS source, avant compilation) ou mjs-method
// (forme déjà compilée, si la doc montre directement le HTML de sortie). Le simple
// method="post" NATIF ne compte volontairement PAS ici : la trappe reste entière
// (l'action manque toujours) — seul le marqueur MJS vaut acquiescement délibéré
const METHOD_RE = new RegExp('^(?:' + SIGN_RE + 'method|mjs-method)$', 'i')
function hasMethodDirective(b: Tag): boolean {
  return b.attrs.some(a => a.name !== null && METHOD_RE.test(a.name))
}

// opt-out explicite — le mot `:noUJS`, du signe de la table (parser/mjs-words.ts), tiret optionnel, comme le reconnaît le transpiler pour la
// directive elle-même (transpiler/index.ts, `:no-?ujs`). LA FORME COMPILÉE COMPTE
// AUTANT : ce lint tourne APRÈS la réécriture des directives d'attribut, le HTML
// analysé porte donc déjà `mjs-no-ujs` — sans elle, tout formulaire correctement
// opté dehors était signalé (prouvé au build du site : 3 faux positifs sur 3)
const NO_UJS_RE = new RegExp('^(?:' + SIGN_RE + 'no-?ujs|mjs-no-ujs)$', 'i')
function hasNoUjs(b: Tag): boolean {
  return b.attrs.some(a => a.name !== null && NO_UJS_RE.test(a.name))
}

// envoi retenu par le composant : `@submit` porte `.prevent` parmi ses modificateurs — ceux d'avant
// `.emit.<nom>`, qui clôt la liste (`@submit.emit.prevent` émet un événement nommé `prevent`). Seuls les noms
// d'attributs se lisent : `title="astuce @submit.prevent ici"` n'est pas une directive
function hasSubmitPrevent(b: Tag): boolean {
  for (const a of b.attrs) {
    const m = a.name === null ? null : /^@submit((?:\.[\w-]+)+)/i.exec(a.name)
    if (m === null) continue
    const mods = m[1].slice(1).split('.')
    const end  = mods.indexOf('emit')
    if ((end === -1 ? mods : mods.slice(0, end)).includes('prevent')) return true
  }
  return false
}

/**
 * Lint « <form> sans action ni méthode » au build — fonction pure, testable seule.
 * Rend la liste des messages d'alerte (déjà traduits, via le catalogue) ; le
 * transpiler (transpiler/index.ts) fait un `console.warn` par message. `dialecte` : false pour un gabarit `js`, lu
 * sans le dialecte de Civet, comme par le compilateur.
 */
// `firstLine` : cf. checkA11y (a11y.ts)
export function checkUjsForm(html: string, file: string, firstLine: number | ((k: number) => number | string) = 1, dialect = true): string[] {
  const tree               = readTemplate(html, dialect)
  const messages: string[] = []
  for (const b of tagsOf(tree.children, EXAMPLES)) {
    if (nameOf(b) !== 'form' || hasAction(tree.source, b) || hasMethodDirective(b) || hasNoUjs(b) || hasSubmitPrevent(b)) continue
    messages.push(t('transpiler.lint.ujs-form', { file, line: typeof firstLine === 'number' ? lineOf(tree, b.start, firstLine) : firstLine(lineOf(tree, b.start, 0)) }))
  }
  return messages
}
